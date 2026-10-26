#!/usr/bin/env bun
/**
 * Cold-boot timing of the production page under a throttled network: headless Chromium loads a
 * built site with an empty profile and reports when the runtime started, when its data arrived and
 * when Lua printed ready (host.js's `colorless:*` performance marks), plus when love.wasm and
 * game.data downloaded. Opt-in; not part of `check`.
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

async function cdp(debugPort: number): Promise<{
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
          result?: Record<string, unknown>;
          error?: Record<string, unknown>;
        };
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
    { stdio: "ignore" },
  );
  try {
    const { send, close } = await cdp(debugPort);
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
      marks: Object.fromEntries(performance.getEntriesByType("mark")
        .filter((m) => m.name.startsWith("colorless:")).map((m) => [m.name, m.startTime])),
      files: Object.fromEntries(performance.getEntriesByType("resource")
        .filter((e) => /\\/love\\/(love\\.wasm|game\\.data|music1\\.ogg)/.test(e.name))
        .map((e, i, all) => {
          const name = e.name.replace(/^.*\\/|\\?.*$/g, "");
          const copy = all.slice(0, i).filter((o) => o.name === e.name).length;
          return [copy ? name + " (again)" : name, { start: e.startTime, end: e.responseEnd }];
        })),
    })`;
    for (let poll = 0; poll < 600; poll++) {
      await new Promise((done) => setTimeout(done, 100));
      const result = (await send("Runtime.evaluate", { expression, returnByValue: true })) as {
        result?: { value?: string };
      };
      const sample = result.result?.value ? (JSON.parse(result.result.value) as Sample) : null;
      if (sample && sample.ready !== null) {
        // Let the post-ready music fetch show up in the resource list.
        await new Promise((done) => setTimeout(done, 200));
        const settled = (await send("Runtime.evaluate", { expression, returnByValue: true })) as {
          result?: { value?: string };
        };
        close();
        return settled.result?.value ? (JSON.parse(settled.result.value) as Sample) : sample;
      }
    }
    const state = (await send("Runtime.evaluate", {
      expression: `document.getElementById("loading")?.style.display + " | " + document.body.className + " | " + document.getElementById("status")?.textContent`,
      returnByValue: true,
    })) as { result?: { value?: string } };
    close();
    return fail(`the page never became ready (${state.result?.value ?? "no page state"})`);
  } finally {
    browser.kill();
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
        .map(([name, at]) => `${name} ${ms(at.start)}-${ms(at.end)}`)
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
