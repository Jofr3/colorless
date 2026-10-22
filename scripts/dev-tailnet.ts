import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const children: ChildProcess[] = [];
let stopping = false;

function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  const signal = (child: ChildProcess, value: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  for (const child of children) signal(child, "SIGINT");
  const timeout = setTimeout(() => {
    for (const child of children) signal(child, "SIGKILL");
  }, 5000);
  timeout.unref();
}

function start(command: string, args: string[], env = process.env, cwd = root) {
  if (stopping) return;
  const child = spawn(command, args, { cwd, env, stdio: "inherit", detached: true });
  children.push(child);
  child.on("error", (error) => {
    console.error(`${command}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${command} exited; stopping the Tailnet dev session.`);
      stop(code ?? 1);
    }
  });
}

async function portAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

const selected = new Set<number>();

type ServeConfig = {
  TCP?: Record<string, unknown>;
  Foreground?: Record<string, ServeConfig>;
};

function servePorts(): Set<number> {
  const config = JSON.parse(
    execFileSync("tailscale", ["serve", "status", "--json"], { encoding: "utf8" }),
  ) as ServeConfig;
  const ports = new Set<number>();
  const collect = (entry: ServeConfig) => {
    for (const port of Object.keys(entry.TCP ?? {})) ports.add(Number(port));
    for (const foreground of Object.values(entry.Foreground ?? {})) collect(foreground);
  };
  collect(config);
  return ports;
}

async function startServe(port: number, target: number) {
  start("tailscale", ["serve", `--https=${port}`, `http://127.0.0.1:${target}`]);
  // Serve updates use optimistic locking: wait for one proxy to register
  // before adding the next, otherwise the CLI can fail with an etag mismatch.
  for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
    if (servePorts().has(port)) return;
    await delay(100);
  }
  if (!stopping) throw new Error(`Tailscale Serve did not start on port ${port}.`);
}
async function freePort(host: string, preferred: number, override?: string): Promise<number> {
  const first = override === undefined ? preferred : Number(override);
  if (!Number.isInteger(first) || first < 1024 || first > 65535) {
    throw new Error(`Invalid port: ${override}`);
  }
  const last = override === undefined ? Math.min(first + 100, 65535) : first;
  for (let port = first; port <= last; port++) {
    if (!selected.has(port) && (await portAvailable(host, port))) {
      selected.add(port);
      return port;
    }
  }
  throw new Error(`No available port on ${host} in ${first}–${last}.`);
}

async function main() {
  const status = JSON.parse(
    execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" }),
  ) as {
    BackendState?: string;
    Self?: { DNSName?: string };
    TailscaleIPs?: string[];
  };
  const hostname = status.Self?.DNSName?.replace(/\.$/, "");
  const ip = status.TailscaleIPs?.find((address) => !address.includes(":"));
  if (status.BackendState !== "Running" || !hostname || !ip) {
    throw new Error("Connect Tailscale with MagicDNS enabled before starting Tailnet development.");
  }

  // Skip configured Serve ports, including foreground sessions from other apps.
  for (const port of servePorts()) selected.add(port);

  const webPort = await freePort("127.0.0.1", 5175);
  const apiPort = await freePort("127.0.0.1", 8787);
  const inspectorPort = await freePort("127.0.0.1", 9229);
  const webHttpsPort = await freePort(ip, 8446, process.env.TAILNET_WEB_PORT);
  const apiHttpsPort = await freePort(ip, webHttpsPort + 1, process.env.TAILNET_API_PORT);
  const webOrigin = `https://${hostname}:${webHttpsPort}`;
  const apiOrigin = `https://${hostname}:${apiHttpsPort}`;

  process.on("SIGINT", () => stop(130));
  process.on("SIGTERM", () => stop(143));

  console.log(`\nFrontend: ${webOrigin}/ (local port ${webPort})`);
  console.log(`API:      ${apiOrigin} (local port ${apiPort})`);
  console.log(`Google authorized redirect URI: ${apiOrigin}/auth/oauth/google/callback`);
  console.log("Ctrl+C stops both servers and this session's Tailnet proxies.\n");

  start(process.execPath, ["run", "dev", "--port", String(webPort)], {
    ...process.env,
    VITE_API_ORIGIN: apiOrigin,
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: hostname,
  });
  start(
    process.execPath,
    [
      "run",
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(apiPort),
      "--inspector-port",
      String(inspectorPort),
      "--var",
      `APP_ORIGIN:${webOrigin}`,
      "--var",
      `API_ORIGIN:${apiOrigin}`,
    ],
    process.env,
    `${root}apps/api`,
  );
  await startServe(webHttpsPort, webPort);
  if (!stopping) await startServe(apiHttpsPort, apiPort);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
});
