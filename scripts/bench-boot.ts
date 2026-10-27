#!/usr/bin/env bun
/**
 * Cold-boot timing of the production page under a throttled network: headless Chromium loads a
 * built site with an empty profile and reports when the runtime started, when its data arrived and
 * when Lua printed ready (host.js's `colorless:*` performance marks), plus when love.wasm,
 * game.data and the menu music started and finished downloading. Opt-in; not part of `check`.
 *
 *   bun scripts/bench-boot.ts [--dist <dir>] [--mbps 20,5] [--runs 3] [--latency 40]
 *
 * Without --dist it runs `vite build` into a temporary directory, with the API origin pointed at a
 * closed port so no request reaches a running API (run `bun run build:lua` first). CHROMIUM names
 * the browser binary (default `chromium`).
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { fail } from "./lib/cli";
import { localBin, REPO_ROOT } from "./lib/repo";

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fail(`--${name} needs a value`)) : fallback;
}

const runs = Number(option("runs", "3"));
const latency = Number(option("latency", "40"));
const speeds = option("mbps", "20,5").split(",").map(Number);
const chromium = process.env.CHROMIUM ?? "chromium";

let dist = option("dist", "");
const built = !dist;
if (built) {
  dist = mkdtempSync(join(tmpdir(), "colorless-boot-"));
  const vite = spawnSync(localBin("vite"), ["build", "--outDir", dist, "--emptyOutDir"], {
    cwd: REPO_ROOT,
    env: { ...process.env, VITE_API_ORIGIN: "http://127.0.0.1:9" },
    stdio: "inherit",
  });
  if (vite.status !== 0) fail("vite build failed");
}
if (!existsSync(join(dist, "index.html"))) fail(`${dist} has no index.html`);

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ogg": "audio/ogg",
};
const COMPRESSED = new Set([".html", ".js", ".css", ".json", ".wasm", ".svg"]);
const gzipped = new Map<string, Uint8Array>();

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  let file = join(dist, normalize(pathname));
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory())
    file = join(dist, "index.html");
  const type = extname(file);
  const headers: Record<string, string> = {
    "content-type": TYPES[type] ?? "application/octet-stream",
    "cache-control": "no-store",
  };
  if (!COMPRESSED.has(type)) {
    response.writeHead(200, headers).end(readFileSync(file));
    return;
  }
  const packed = gzipped.get(file) ?? gzipSync(readFileSync(file));
  gzipped.set(file, packed);
  response.writeHead(200, { ...headers, "content-encoding": "gzip" }).end(packed);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const sitePort = (server.address() as AddressInfo).port;

// Records when the loading overlay hides, so pages without the performance marks still time.
const READY_PROBE = `(() => {
  const timer = setInterval(() => {
    const loading = document.getElementById("loading");
    if (loading && loading.style.display === "none") {
      window.__bootReady = performance.now();
      clearInterval(timer);
    }
  }, 5);
})();`;

interface Sample {
  ready: number;
  marks: Record<string, number>;
  files: Record<string, { start: number; end: number }>;
}

async function cdp(
  debugPort: number,
  onEvent: (method: string, params: Record<string, unknown>) => void,
): Promise<{
  send: (method: string, params?: object) => Promise<Record<string, unknown>>;
  close: () => void;
}> {
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((done) => setTimeout(done, 100));
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      const page = targets.find((t) => t.type === "page");
      if (!page) continue;
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((done, reject) => {
        socket.addEventListener("open", done);
        socket.addEventListener("error", reject);
      });
      let serial = 0;
      const pending = new Map<number, (value: Record<string, unknown>) => void>();
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
          result?: Record<string, unknown>;
          error?: Record<string, unknown>;
        };
        if (message.method) onEvent(message.method, message.params ?? {});
        if (message.id === undefined) return;
        pending.get(message.id)?.(message.result ?? message.error ?? {});
        pending.delete(message.id);
      });
      return {
        send: (method, params = {}) =>
          new Promise((done) => {
            const id = ++serial;
            pending.set(id, done);
            socket.send(JSON.stringify({ id, method, params }));
          }),
        close: () => socket.close(),
      };
    } catch {}
  }
  return fail(`Chromium (${chromium}) did not open a debugging port`);
}

// Turn signals into a normal exit so the "exit" handlers below still kill the browsers.
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));

async function boot(mbps: number): Promise<Sample> {
  const profile = mkdtempSync(join(tmpdir(), "colorless-boot-profile-"));
  const debugPort = 20000 + Math.floor(Math.random() * 20000);
  const browser = spawn(
    chromium,
    [
      "--headless=new",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  );
  // Its own process group, so the whole browser goes even if this script is interrupted.
  const killBrowser = () => {
    try {
      if (browser.pid) process.kill(-browser.pid, "SIGKILL");
    } catch {}
  };
  process.once("exit", killBrowser);
  // Resource timing lists a file only once it has arrived, so the network events time the
  // downloads, including one still in flight when the page turns ready.
  const requests = new Map<string, { name: string; wall: number; sent: number; done?: number }>();
  const files = (timeOrigin: number) => {
    const named: Sample["files"] = {};
    for (const r of requests.values()) {
      const start = r.wall * 1000 - timeOrigin;
      const name = r.name in named ? `${r.name} (again)` : r.name;
      named[name] = {
        start,
        end: r.done === undefined ? Number.NaN : start + (r.done - r.sent) * 1000,
      };
    }
    return named;
  };
  try {
    const { send, close } = await cdp(debugPort, (method, params) => {
      const id = String(params.requestId);
      if (method === "Network.requestWillBeSent") {
        const url = String((params.request as { url?: string } | undefined)?.url);
        const name = /\/love\/(love\.wasm|game\.data|music1\.ogg)/.exec(url)?.[1];
        if (name)
          requests.set(id, { name, wall: Number(params.wallTime), sent: Number(params.timestamp) });
      } else if (method === "Network.loadingFinished") {
        const request = requests.get(id);
        if (request) request.done = Number(params.timestamp);
      }
    });
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Network.emulateNetworkConditions", {
      offline: false,
      latency,
      downloadThroughput: (mbps * 1e6) / 8,
      uploadThroughput: (5 * 1e6) / 8,
    });
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: READY_PROBE });
    await send("Page.navigate", { url: `http://127.0.0.1:${sitePort}/` });
    const expression = `JSON.stringify({
      ready: window.__bootReady ?? null,
      timeOrigin: performance.timeOrigin,
      marks: Object.fromEntries(performance.getEntriesByType("mark")
        .filter((m) => m.name.startsWith("colorless:")).map((m) => [m.name, m.startTime])),
    })`;
    for (let poll = 0; poll < 600; poll++) {
      await new Promise((done) => setTimeout(done, 100));
      const result = (await send("Runtime.evaluate", { expression, returnByValue: true })) as {
        result?: { value?: string };
      };
      const page = result.result?.value
        ? (JSON.parse(result.result.value) as Omit<Sample, "files"> & { timeOrigin: number })
        : null;
      if (page && page.ready !== null) {
        // Give the music request, which starts after ready, time to go out.
        await new Promise((done) => setTimeout(done, 200));
        close();
        return { ready: page.ready, marks: page.marks, files: files(page.timeOrigin) };
      }
    }
    const state = (await send("Runtime.evaluate", {
      expression: `document.getElementById("loading")?.style.display + " | " + document.body.className + " | " + document.getElementById("status")?.textContent`,
      returnByValue: true,
    })) as { result?: { value?: string } };
    close();
    return fail(`the page never became ready (${state.result?.value ?? "no page state"})`);
  } finally {
    killBrowser();
    process.off("exit", killBrowser);
    rmSync(profile, { recursive: true, force: true });
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};
const ms = (value: number | undefined) =>
  value === undefined || Number.isNaN(value) ? "-" : `${Math.round(value)}`;

try {
  for (const mbps of speeds) {
    const samples: Sample[] = [];
    for (let run = 0; run < runs; run++) {
      const sample = await boot(mbps);
      samples.push(sample);
      const files = Object.entries(sample.files)
        .map(([name, at]) =>
          Number.isNaN(at.end)
            ? `${name} ${ms(at.start)}-(in flight)`
            : `${name} ${ms(at.start)}-${ms(at.end)}`,
        )
        .join(", ");
      const marks = Object.entries(sample.marks)
        .map(([name, at]) => `${name.replace("colorless:", "")} ${ms(at)}`)
        .join(", ");
      console.log(
        `${mbps} Mbps run ${run + 1}: ready ${ms(sample.ready)} ms | ${marks} | ${files}`,
      );
    }
    const markNames = [...new Set(samples.flatMap((s) => Object.keys(s.marks)))];
    const markMedians = markNames
      .map((name) => {
        const values = samples.flatMap((s) => (name in s.marks ? [s.marks[name] ?? 0] : []));
        return `${name.replace("colorless:", "")} ${ms(median(values))}`;
      })
      .join(", ");
    console.log(
      `${mbps} Mbps median of ${runs}: ready ${ms(median(samples.map((s) => s.ready)))} ms${markMedians ? ` | ${markMedians}` : ""}`,
    );
  }
} finally {
  server.close();
  if (built) rmSync(dist, { recursive: true, force: true });
}
