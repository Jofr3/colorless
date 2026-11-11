// `bun run dev:tailnet` runs the web and API dev servers on free local ports behind Tailscale Serve
// HTTPS, each told the other's origin. With --local it skips Tailscale: both listen on 127.0.0.1 on
// ports the system picks, and once both answer it prints one `web=… api=… inspector=…` line.
// Ctrl+C stops everything it started.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isRecord, parseJson } from "./lib/cli";
import { freePort, reservePorts, systemPort } from "./lib/ports";

/** Preferred local ports; the first free port at or above each is used. */
const WEB_PORT = 5175;
const API_PORT = 8787;
const INSPECTOR_PORT = 9229;
/** Preferred Tailnet HTTPS port for the frontend; the API takes the next free one. */
const WEB_HTTPS_PORT = 8446;
/** How long --local waits for both servers; a fresh worktree migrates its D1 first. */
const LOCAL_READY_MS = 120_000;

export function parseMode(args: string[]): "tailnet" | "local" {
  const unknown = args.filter((arg) => arg !== "--local");
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(" ")} (only --local)`);
  return args.includes("--local") ? "local" : "tailnet";
}

/** Vite binds 127.0.0.1, and the page and the API must share that name to be same-site. */
export const loopbackOrigin = (port: number) => `http://127.0.0.1:${port}`;

export const pairLine = (web: string, api: string, inspector: number) =>
  `web=${web} api=${api} inspector=${inspector}`;

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
      console.error(`${command} exited; stopping the dev session.`);
      stop(code ?? 1);
    }
  });
}

type ServeConfig = {
  TCP?: Record<string, unknown>;
  Foreground?: Record<string, ServeConfig>;
};

function isServeConfig(v: unknown): v is ServeConfig {
  return (
    isRecord(v) &&
    (v.TCP === undefined || isRecord(v.TCP)) &&
    (v.Foreground === undefined ||
      (isRecord(v.Foreground) && Object.values(v.Foreground).every(isServeConfig)))
  );
}

type TailscaleStatus = {
  BackendState?: string;
  Self?: { DNSName?: string };
  TailscaleIPs?: string[];
};

function isTailscaleStatus(v: unknown): v is TailscaleStatus {
  return (
    isRecord(v) &&
    (v.BackendState === undefined || typeof v.BackendState === "string") &&
    (v.Self === undefined ||
      (isRecord(v.Self) && (v.Self.DNSName === undefined || typeof v.Self.DNSName === "string"))) &&
    (v.TailscaleIPs === undefined ||
      (Array.isArray(v.TailscaleIPs) && v.TailscaleIPs.every((ip) => typeof ip === "string")))
  );
}

function tailscaleJson<T>(args: string[], guard: (v: unknown) => v is T): T {
  const text = execFileSync("tailscale", args, { encoding: "utf8" });
  return parseJson(text, `tailscale ${args.join(" ")}`, guard);
}

function servePorts(): Set<number> {
  const config = tailscaleJson(["serve", "status", "--json"], isServeConfig);
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

type Ports = { web: number; api: number; inspector: number };

function startServers(
  ports: Ports,
  webOrigin: string,
  apiOrigin: string,
  webEnv: Record<string, string> = {},
) {
  start(process.execPath, ["run", "dev", "--port", String(ports.web)], {
    ...process.env,
    VITE_API_ORIGIN: apiOrigin,
    ...webEnv,
  });
  start(
    process.execPath,
    [
      "run",
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(ports.api),
      "--inspector-port",
      String(ports.inspector),
      "--var",
      `APP_ORIGIN:${webOrigin}`,
      "--var",
      `API_ORIGIN:${apiOrigin}`,
    ],
    process.env,
    `${root}apps/api`,
  );
}

async function answers(url: string): Promise<boolean> {
  return fetch(url)
    .then((response) => response.ok)
    .catch(() => false);
}

async function local() {
  const ports = { web: await systemPort(), api: await systemPort(), inspector: await systemPort() };
  const webOrigin = loopbackOrigin(ports.web);
  const apiOrigin = loopbackOrigin(ports.api);
  console.log(`\nFrontend: ${webOrigin}/`);
  console.log(`API:      ${apiOrigin} (inspector on port ${ports.inspector})`);
  console.log("Ctrl+C stops both servers.\n");
  startServers(ports, webOrigin, apiOrigin);
  const until = Date.now() + LOCAL_READY_MS;
  while (!stopping) {
    if ((await answers(`${webOrigin}/`)) && (await answers(`${apiOrigin}/health`))) {
      console.log(pairLine(webOrigin, apiOrigin, ports.inspector));
      return;
    }
    if (Date.now() > until) throw new Error(`The servers did not answer in ${LOCAL_READY_MS} ms.`);
    await delay(250);
  }
}

async function tailnet() {
  const status = tailscaleJson(["status", "--json"], isTailscaleStatus);
  const hostname = status.Self?.DNSName?.replace(/\.$/, "");
  const ip = status.TailscaleIPs?.find((address) => !address.includes(":"));
  if (status.BackendState !== "Running" || !hostname || !ip) {
    throw new Error("Connect Tailscale with MagicDNS enabled before starting Tailnet development.");
  }

  // Skip configured Serve ports, including foreground sessions from other apps.
  reservePorts(servePorts());

  const ports = {
    web: await freePort("127.0.0.1", WEB_PORT),
    api: await freePort("127.0.0.1", API_PORT),
    inspector: await freePort("127.0.0.1", INSPECTOR_PORT),
  };
  const webHttpsPort = await freePort(ip, WEB_HTTPS_PORT, process.env.TAILNET_WEB_PORT);
  const apiHttpsPort = await freePort(ip, webHttpsPort + 1, process.env.TAILNET_API_PORT);
  const webOrigin = `https://${hostname}:${webHttpsPort}`;
  const apiOrigin = `https://${hostname}:${apiHttpsPort}`;

  console.log(`\nFrontend: ${webOrigin}/ (local port ${ports.web})`);
  console.log(`API:      ${apiOrigin} (local port ${ports.api})`);
  console.log(`Google authorized redirect URI: ${apiOrigin}/auth/oauth/google/callback`);
  console.log("Ctrl+C stops both servers and this session's Tailnet proxies.\n");

  startServers(ports, webOrigin, apiOrigin, { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: hostname });
  await startServe(webHttpsPort, ports.web);
  if (!stopping) await startServe(apiHttpsPort, ports.api);
}

if (import.meta.main) {
  process.on("SIGINT", () => stop(130));
  process.on("SIGTERM", () => stop(143));
  Promise.resolve()
    .then(() => (parseMode(process.argv.slice(2)) === "local" ? local() : tailnet()))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      stop(1);
    });
}
