#!/usr/bin/env bun
/**
 * The browser smoke of the real page. Opt-in: not part of `check`, `release` or CI, which cannot
 * build game.data. It builds the site against its own local API on free ports, with a fresh
 * migrated D1 under a temporary directory that holds only the fixture catalog
 * (`@colorless/api/testing/fixtureCatalog`), makes its accounts and decks through that API, and
 * drives headless Chromium through:
 *   boot and keyboard input; a sandbox game to turn 3; a Lua crash mid-game and the reload that
 *   resumes it; a boot whose game.data never arrives (the stall note); an online match from
 *   create to a rematch, in two browser contexts.
 * It reads state from the mailboxes the page writes for Lua and drives Lua through the bridge's
 * own `COLORLESS:` lines, never by canvas coordinates. Every process it starts is stopped on the
 * way out, failing or not.
 *
 *   CHROMIUM=<binary> BALATRO_SOURCE=<dir> bun run e2e [--gpu] [--keep]
 *
 * CHROMIUM defaults to the first of chromium, chromium-browser, google-chrome on PATH. --gpu adds
 * the CRT parity check (frontend/lua/tests/effects_gpu.lua). --keep leaves the temporary directory
 * (site, D1 state, API log); a failed run always leaves it.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, extname, join, normalize } from "node:path";
import { FIXTURE_DECK, fixtureCatalogStatements } from "@colorless/api/testing/fixtureCatalog";
import { MAILBOXES } from "../src/host/mailboxes";
import { WIRE_ROWS, wireColumn } from "../src/lua/wireFields";
import { fail } from "./lib/cli";
import { localBin, REPO_ROOT, repoPath } from "./lib/repo";

const keep = process.argv.includes("--keep");
const gpu = process.argv.includes("--gpu");
const BOOT_MS = 60_000;
/** host.js's BOOT_STALL_MS, plus room for a busy machine. */
const STALL_NOTE_MS = 45_000 + 20_000;

const t0 = Date.now();
const log = (line: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function findChromium(): string {
  const named = process.env.CHROMIUM;
  if (named) {
    if (!existsSync(named)) fail(`CHROMIUM=${named} does not exist.`);
    return named;
  }
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"])
    for (const dir of (process.env.PATH ?? "").split(delimiter))
      if (dir && existsSync(join(dir, name))) return join(dir, name);
  return fail(
    "e2e needs Chromium: set CHROMIUM to its binary, or put chromium on PATH (with Nix:\n" +
      "  CHROMIUM=$(nix build nixpkgs#chromium --no-link --print-out-paths)/bin/chromium).",
  );
}
const chromium = findChromium();

// ---------- processes, and stopping them ----------

const root = mkdtempSync(join(tmpdir(), "colorless-e2e-"));
const started: ChildProcess[] = [];
const servers: Server[] = [];
let passed = false;

/** Starts `command` in its own process group, so stopping it takes every process it spawned. */
function start(command: string, args: string[], options: { cwd?: string; logFile?: string } = {}) {
  const out = options.logFile ? createWriteStream(options.logFile) : undefined;
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", out ? "pipe" : "ignore", out ? "pipe" : "ignore"],
    detached: true,
  });
  if (out) {
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
  }
  started.push(child);
  return child;
}
const signalGroup = (child: ChildProcess, signal: NodeJS.Signals) => {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {}
};
const groupAlive = (child: ChildProcess) => {
  try {
    if (child.pid) process.kill(-child.pid, 0);
    return child.pid !== undefined;
  } catch {
    return false;
  }
};
async function stopAll() {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  for (const child of started) signalGroup(child, "SIGTERM");
  for (let wait = 0; wait < 50 && started.some(groupAlive); wait++) await sleep(100);
  for (const child of started) signalGroup(child, "SIGKILL");
  if (passed && !keep) rmSync(root, { recursive: true, force: true });
  else console.log(`kept ${root}`);
}
// The last resort for an exit that skips the async stop: nothing may outlive the script.
process.once("exit", () => {
  for (const child of started) signalGroup(child, "SIGKILL");
});
process.once("SIGINT", () => void stopAll().then(() => process.exit(130)));
process.once("SIGTERM", () => void stopAll().then(() => process.exit(143)));

function run(command: string, args: string[], cwd = REPO_ROOT, env: Record<string, string> = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", ...env },
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}

// ---------- the site ----------

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
/** The user agent mark of a page whose game.data download never answers. */
const STALL_MARK = "colorless-e2e-stall";

/** Serves `dir` with the SPA fallback; a marked page's game.data request is held open. */
function serve(dir: string): Promise<number> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname.endsWith("/game.data") && request.headers["user-agent"]?.includes(STALL_MARK))
      return;
    let file = join(dir, normalize(pathname));
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory())
      file = join(dir, "index.html");
    response
      .writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-store",
      })
      .end(readFileSync(file));
  });
  servers.push(server);
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done((server.address() as AddressInfo).port)),
  );
}

// ---------- the browser, over the DevTools protocol ----------

type CdpMessage = {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
};
type Page = { name: string; session: string; consoleErrors: string[]; consoleLines: string[] };

let socket: WebSocket | undefined;
let serial = 0;
const pending = new Map<
  number,
  { ok: (v: Record<string, unknown>) => void; no: (e: Error) => void }
>();
const listeners: ((message: CdpMessage) => void)[] = [];

async function connectBrowser() {
  const profile = join(root, "profile");
  const debugPort = await freePort();
  start(chromium, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1280,800",
    // Two love.js pages share the CPU; a page in the background must not be throttled.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "about:blank",
  ]);
  let url = "";
  for (let attempt = 0; attempt < 100 && !url; attempt++) {
    await sleep(100);
    try {
      const version = (await (
        await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      ).json()) as {
        webSocketDebuggerUrl: string;
      };
      url = version.webSocketDebuggerUrl;
    } catch {}
  }
  if (!url) throw new Error(`Chromium (${chromium}) did not open a debugging port`);
  const opened = new WebSocket(url);
  await new Promise((done, reject) => {
    opened.addEventListener("open", done);
    opened.addEventListener("error", reject);
  });
  opened.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.id === undefined) {
      for (const listener of listeners) listener(message);
      return;
    }
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter?.no(new Error(JSON.stringify(message.error)));
    else waiter?.ok(message.result ?? {});
  });
  socket = opened;
}

function send(method: string, params: object = {}, sessionId?: string) {
  const sent = Date.now();
  return new Promise<Record<string, unknown>>((ok, no) => {
    const id = ++serial;
    pending.set(id, { ok, no });
    socket?.send(JSON.stringify({ id, method, params, sessionId }));
  }).finally(() => {
    if (Date.now() - sent > 5000) log(`slow DevTools call ${method}: ${Date.now() - sent} ms`);
  });
}

// Records the page's mailbox writes and the bridge's prints, and keeps the bridge to send through.
const HOOK = `(() => {
  const mail = {}, prints = [], errors = [];
  let host, bridge;
  window.__e2e = { mail, prints, errors, send: (line) => bridge && bridge.onPrint(line) };
  addEventListener("error", (e) => errors.push(String(e.message || e.type)));
  addEventListener("unhandledrejection", (e) => errors.push("rejection " + String(e.reason)));
  Object.defineProperty(window, "colorlessHost", { configurable: true, get: () => host, set: (h) => {
    const write = h.writeMailbox, connect = h.connect;
    h.writeMailbox = (n, t) => { mail[n] = t; return write(n, t); };
    h.connect = (b) => { const on = b.onPrint; b.onPrint = (m) => { prints.push(m); return on(m); }; bridge = b; connect(b); };
    host = h;
  } });
})();`;

async function newPage(name: string, options: { userAgentMark?: string } = {}): Promise<Page> {
  const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const session = String(sessionId);
  const page: Page = { name, session, consoleErrors: [], consoleLines: [] };
  listeners.push((message) => {
    if (message.sessionId !== session) return;
    const params = message.params ?? {};
    if (message.method === "Runtime.consoleAPICalled") {
      const args = (params.args ?? []) as { value?: unknown; description?: string }[];
      const text = args.map((arg) => String(arg.value ?? arg.description)).join(" ");
      page.consoleLines.push(text);
      if (params.type === "error") page.consoleErrors.push(text);
    }
    if (message.method === "Runtime.exceptionThrown")
      page.consoleErrors.push(`exception ${JSON.stringify(params.exceptionDetails)}`);
  });
  await send("Runtime.enable", {}, session);
  await send("Page.enable", {}, session);
  if (options.userAgentMark) {
    const { userAgent } = await send("Browser.getVersion");
    await send(
      "Network.setUserAgentOverride",
      { userAgent: `${userAgent} ${options.userAgentMark}` },
      session,
    );
  }
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
    session,
  );
  await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK }, session);
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }, session);
  return page;
}

async function evaluate<T = unknown>(page: Page, expression: string): Promise<T> {
  const reply = (await send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    page.session,
  )) as {
    result?: { value?: T };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  if (reply.exceptionDetails) {
    const detail = reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text;
    throw new Error(`${page.name}: ${detail}`);
  }
  return reply.result?.value as T;
}

const FAILED_TEXT = `document.body.classList.contains('failed') && document.getElementById('status').textContent`;

/** Polls `expression` until it is truthy; a failure overlay on the page fails the wait at once. */
async function waitFor<T>(
  page: Page,
  what: string,
  expression: string,
  ms = 30_000,
  options: { failureIsFine?: boolean } = {},
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await evaluate<T>(page, expression).catch(() => undefined);
    if (value) return value;
    if (!options.failureIsFine) {
      const failed = await evaluate<string | false>(page, FAILED_TEXT).catch(() => false);
      if (failed) throw new Error(`${page.name}: the page failed waiting for ${what}: ${failed}`);
    }
    if (Date.now() > until) throw new Error(`${page.name}: timed out waiting for ${what}`);
    await sleep(100);
  }
}

let site = "";
let apiOrigin = "";

async function open(page: Page, path: string) {
  await send("Page.navigate", { url: site + path }, page.session);
  await waitFor(
    page,
    "Lua ready",
    `performance.getEntriesByName('colorless:ready').length > 0`,
    BOOT_MS,
  );
}

const encode = (field: string) =>
  field.replace(
    /[^\w.~-]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
/** Sends `fields` on `channel` as Lua would print them. */
const lua = (page: Page, channel: string, ...fields: string[]) =>
  evaluate(
    page,
    `window.__e2e.send(${JSON.stringify(`COLORLESS:${channel}:${fields.map(encode).join("\t")}`)})`,
  );
const parseRows = (text: string) =>
  text.split("\n").map((row) => row.split("\t").map(decodeURIComponent));
const mailbox = (page: Page, name: string) =>
  evaluate<string>(page, `window.__e2e.mail[${JSON.stringify(name)}] || ''`);
const rowsOf = async (page: Page, name: string) => parseRows(await mailbox(page, name));

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const init = JSON.stringify({
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const reply = await evaluate<{ status: number; body: string }>(
    page,
    `fetch(${JSON.stringify(apiOrigin + path)}, ${init}).then(async (r) => ({ status: r.status, body: await r.text() }))`,
  );
  if (reply.status >= 300)
    throw new Error(`${page.name}: ${method} ${path} ${reply.status} ${reply.body}`);
  return JSON.parse(reply.body) as T;
}

/** A fresh account, signed in in `page`'s browser context, with one copy of the fixture deck. */
async function seedAccount(page: Page, label: string): Promise<string> {
  await api(page, "POST", "/auth/register", {
    email: `e2e-${label}-${Date.now()}@example.com`,
    password: `e2e-${label}-password`,
    displayName: `E2E ${label}`,
  });
  const deck = await api<{ id: string }>(page, "POST", "/decks", {
    name: `E2E ${label} deck`,
    tint: 90,
    format: "expanded",
    cards: FIXTURE_DECK,
  });
  return deck.id;
}

async function key(page: Page, name: string, code: string, keyCode: number) {
  for (const type of ["keyDown", "keyUp"])
    await send(
      "Input.dispatchKeyEvent",
      { type, key: name, code, windowsVirtualKeyCode: keyCode },
      page.session,
    );
}

async function assertHealthy(page: Page, step: string) {
  const errors = await evaluate<string[]>(page, "window.__e2e.errors");
  const failed = await evaluate<boolean>(page, `document.body.classList.contains('failed')`);
  const consoleErrors = page.consoleErrors.filter((line) => !/favicon|music/.test(line));
  if (failed || errors.length > 0 || consoleErrors.length > 0)
    throw new Error(
      `${page.name} is unhealthy after ${step}: failed=${failed} ${JSON.stringify([...errors, ...consoleErrors])}`,
    );
}

// ---------- the table ----------

const SIM = WIRE_ROWS.sim;
const col = wireColumn;
const HEADER = {
  revision: col(SIM.header, "revision"),
  phase: col(SIM.header, "phase"),
  turn: col(SIM.header, "turn"),
  gamePhase: col(SIM.header, "gamePhase"),
  outcome: col(SIM.header, "outcome"),
  matchId: col(SIM.header, "matchId"),
};
const table = (page: Page) => rowsOf(page, MAILBOXES.simulator);
const tableHeader = async (page: Page) => (await table(page))[0] ?? [];
/** A JS expression for a header field of the table snapshot. */
const headerField = (index: number) =>
  `(window.__e2e.mail[${JSON.stringify(MAILBOXES.simulator)}] || '').split('\\n')[0].split('\\t').map(decodeURIComponent)[${index}]`;

/** The tokens of the table's enabled buttons, in the order the smoke tries them: a prompt's footer
    and options, else End turn, the card buttons and the rest of the sidebar. */
function offers(rows: string[][]): string[] {
  const enabled = (tag: string, disabled: number, label: number) =>
    rows
      .filter((row) => row[0] === tag && row[1] && row[disabled] !== "true")
      .map((row) => ({ token: row[1] ?? "", label: row[label] ?? "", row }));
  if (rows.some((row) => row[0] === "M")) {
    const disabled = col(SIM.option, "disabled");
    const label = col(SIM.option, "label");
    const footer = enabled("F", disabled, label).filter(
      (offer) => !/cancel|back|close|undo/i.test(offer.label),
    );
    const options = enabled("O", disabled, label).filter(
      (offer) => offer.row[col(SIM.option, "selected")] !== "true",
    );
    return [...footer, ...options].map((offer) => offer.token);
  }
  const sidebar = enabled("A", col(SIM.sidebar, "disabled"), col(SIM.sidebar, "label"));
  const cards = enabled("K", col(SIM.cardAction, "disabled"), col(SIM.cardAction, "label"));
  return [...sidebar.filter((offer) => /end turn/i.test(offer.label)), ...cards, ...sidebar].map(
    (offer) => offer.token,
  );
}

/** Plays whatever the table offers, End turn first, until `done` holds for the header. */
async function play(page: Page, steps: number, done: (header: string[]) => boolean) {
  await waitFor(page, "a ready table", `${headerField(HEADER.phase)} === 'ready'`, 20_000);
  for (let step = 0; step < steps; step++) {
    const rows = await table(page);
    const header = rows[0] ?? [];
    if (done(header)) return header;
    const revision = header[HEADER.revision] ?? "";
    let moved = false;
    for (const token of offers(rows)) {
      await lua(page, "simulator", "invoke", revision, token);
      const until = Date.now() + 3000;
      while (Date.now() < until && (await tableHeader(page))[HEADER.revision] === revision)
        await sleep(50);
      if ((await tableHeader(page))[HEADER.revision] !== revision) {
        moved = true;
        break;
      }
    }
    if (!moved)
      throw new Error(
        `${page.name}: stuck on turn ${header[HEADER.turn]} (${header[HEADER.gamePhase]})`,
      );
  }
  throw new Error(`${page.name}: the table did not get there in ${steps} steps`);
}

// ---------- the online lobby ----------

const ONLINE = WIRE_ROWS.online;
async function lobby(host: Page, guest: Page, hostDeck: string, guestDeck: string) {
  await open(host, "/online");
  await lua(host, "online", "open");
  await lua(host, "online", "create");
  const code = await waitFor<string>(
    host,
    "a lobby code",
    `(location.pathname.match(/^\\/online\\/([A-Z0-9]+)$/) || [])[1] || ''`,
  );
  log(`lobby ${code}`);
  await open(guest, `/online/${code}`);
  await lua(guest, "online", "open", code);
  for (const [page, deck] of [
    [host, hostDeck],
    [guest, guestDeck],
  ] as const) {
    await lua(page, "online", "decks");
    await waitFor(
      page,
      "the online decks",
      `(window.__e2e.mail[${JSON.stringify(MAILBOXES.online)}] || '').includes(${JSON.stringify(deck)})`,
    );
    // The seat exists once the server welcomed this socket; a pick before that is dropped.
    for (let attempt = 0; ; attempt++) {
      await lua(page, "online", "select", deck);
      await sleep(200);
      const you = (await rowsOf(page, MAILBOXES.online)).find(
        (row) => row[0] === "P" && row[col(ONLINE.seat, "seat")] === "you",
      );
      if (you?.[col(ONLINE.seat, "hasDeck")] === "1") break;
      if (attempt === 50) throw new Error(`${page.name}: the seat never took the deck`);
    }
  }
  await lua(host, "online", "ready", "1");
  await lua(guest, "online", "ready", "1");
  for (const page of [host, guest])
    await waitFor(
      page,
      "the online table",
      "/^\\/online\\/[A-Z0-9]+\\/play$/.test(location.pathname)",
    );
}

// ---------- the run ----------

const results: string[] = [];
const pages: Page[] = [];
let apiLog = "";

async function smoke() {
  const apiPort = await freePort();
  const inspectorPort = await freePort();
  const dist = join(root, "dist");
  const sitePort = await serve(dist);
  site = `http://127.0.0.1:${sitePort}`;
  apiOrigin = `http://127.0.0.1:${apiPort}`;

  log("building the Lua package and the site");
  run("node", ["frontend/lua/build.mjs"]);
  run(
    localBin("vite"),
    ["build", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"],
    REPO_ROOT,
    {
      VITE_API_ORIGIN: apiOrigin,
    },
  );

  log("migrating a fresh D1 and writing the fixture catalog");
  const state = join(root, "state");
  const apiDir = repoPath("apps/api");
  const wrangler = localBin("wrangler");
  run(
    wrangler,
    ["d1", "migrations", "apply", "colorless", "--local", "--persist-to", state],
    apiDir,
  );
  const seed = join(root, "catalog.sql");
  writeFileSync(seed, `${fixtureCatalogStatements().join("\n")}\n`);
  run(
    wrangler,
    ["d1", "execute", "colorless", "--local", "--persist-to", state, "--file", seed, "--yes"],
    apiDir,
  );

  apiLog = join(root, "api.log");
  start(
    process.execPath,
    [
      repoPath("scripts/with-system-certs.ts"),
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(apiPort),
      "--inspector-port",
      String(inspectorPort),
      "--persist-to",
      state,
      "--show-interactive-dev-session=false",
      "--var",
      `APP_ORIGIN:${site}`,
    ],
    { cwd: apiDir, logFile: apiLog },
  );
  for (let attempt = 0; ; attempt++) {
    const up = await fetch(`${apiOrigin}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (up) break;
    if (attempt === 600) throw new Error("the local API did not answer /health in 60 s");
    await sleep(100);
  }
  log(`API on ${apiOrigin}, site on ${site}`);

  await connectBrowser();

  // A page whose game.data never arrives, left to sit while the rest runs.
  const stalled = await newPage("stalled", { userAgentMark: STALL_MARK });
  pages.push(stalled);
  const stallStarted = Date.now();
  await send("Page.navigate", { url: `${site}/` }, stalled.session);

  // ---- boot and real keyboard input ----
  const host = await newPage("host");
  pages.push(host);
  const bootStart = Date.now();
  await open(host, "/");
  log(`boot ready in ${Date.now() - bootStart} ms`);
  await assertHealthy(host, "boot");
  await evaluate(host, "document.getElementById('canvas').focus()");
  await key(host, "ArrowRight", "ArrowRight", 39);
  await waitFor(
    host,
    "Lua to announce the focus",
    `window.__e2e.prints.some((m) => m.startsWith('COLORLESS:announce:'))`,
    5000,
  );
  results.push("boot: ready, no failure overlay, keyboard focus announced by Lua");

  // ---- a sandbox game ----
  const hostDeck = await seedAccount(host, "host");
  await open(host, "/sandbox");
  await lua(host, "sandbox", "open");
  const sandboxPhase = col(WIRE_ROWS.sandbox.header, "phase");
  await waitFor(
    host,
    "the sandbox decks",
    `(window.__e2e.mail[${JSON.stringify(MAILBOXES.sandbox)}] || '').split('\\n')[0].split('\\t')[${sandboxPhase}] === 'ready'`,
  );
  await lua(host, "sandbox", "start");
  await waitFor(host, "the sandbox table", `location.pathname === '/sandbox/play'`);
  const reached = await play(
    host,
    120,
    (h) => Number(h[HEADER.turn]) >= 3 || h[HEADER.outcome] !== "",
  );
  await assertHealthy(host, "the sandbox game");
  results.push(`sandbox: chooser, start, played to turn ${reached[HEADER.turn]}`);

  // ---- a Lua crash mid-game, and the reload that resumes it ----
  // A snapshot cut inside a card row is the one input the table's parser does not survive.
  const snapshot = await mailbox(host, MAILBOXES.simulator);
  const cut = snapshot.slice(0, snapshot.indexOf("\nC\t") + 12);
  const revision = Number(snapshot.split("\t")[0]) + 1000;
  await evaluate(
    host,
    `window.colorlessHost.writeMailbox(${JSON.stringify(MAILBOXES.simulator)}, ${JSON.stringify(`${revision}${cut.slice(cut.indexOf("\t"))}`)})`,
  );
  const crashed = await waitFor<string>(host, "the failure overlay", FAILED_TEXT, 10_000, {
    failureIsFine: true,
  });
  if (!/^Something went wrong\. Reload to continue/.test(crashed))
    throw new Error(`a crash mid-game read "${crashed}"`);
  await open(host, "/sandbox/play");
  await waitFor(host, "the resumed table", `${headerField(HEADER.phase)} === 'ready'`, 20_000);
  const resumed = await tableHeader(host);
  if (Number(resumed[HEADER.turn]) < Number(reached[HEADER.turn]))
    throw new Error(`the reload resumed turn ${resumed[HEADER.turn]}, not ${reached[HEADER.turn]}`);
  host.consoleErrors.length = 0;
  results.push(`crash: "${crashed}", and the reload resumed turn ${resumed[HEADER.turn]}`);

  // ---- an online match, through a rematch ----
  const guest = await newPage("guest");
  pages.push(guest);
  await open(guest, "/");
  const guestDeck = await seedAccount(guest, "guest");
  await lobby(host, guest, hostDeck, guestDeck);
  log("both tabs at the online table");
  const firstMatch = await waitFor<string>(
    host,
    "an online snapshot",
    `${headerField(HEADER.phase)} === 'ready' && ${headerField(HEADER.matchId)}`,
    20_000,
  );
  await lua(host, "simulator", "concede");
  const label = col(SIM.option, "label");
  const confirm = await waitFor<string>(
    host,
    "the concede prompt",
    `(() => {
      const rows = (window.__e2e.mail[${JSON.stringify(MAILBOXES.simulator)}] || '').split('\\n').map((l) => l.split('\\t').map(decodeURIComponent));
      const option = rows.find((r) => r[0] === 'O' && /concede/i.test(r[${label}]));
      return rows.some((r) => r[0] === 'M') && option ? JSON.stringify([rows[0][${HEADER.revision}], option[1]]) : '';
    })()`,
    10_000,
  );
  const [promptRevision, token] = JSON.parse(confirm) as [string, string];
  await lua(host, "simulator", "invoke", promptRevision, token);
  for (const page of [host, guest])
    await waitFor(page, "the game over", `${headerField(HEADER.outcome)} !== ''`, 15_000);
  // Both ask at once: the race a rematch must survive.
  await Promise.all([lua(host, "simulator", "rematch"), lua(guest, "simulator", "rematch")]);
  for (const page of [host, guest])
    await waitFor(
      page,
      "the rematch",
      `${headerField(HEADER.outcome)} === '' && ${headerField(HEADER.matchId)} && ${headerField(HEADER.matchId)} !== ${JSON.stringify(firstMatch)}`,
      30_000,
    );
  await assertHealthy(host, "the online match");
  await assertHealthy(guest, "the online match");
  results.push("online: create, join, pick, ready, table, concede, game over, rematch, new match");

  // ---- the stalled boot ----
  const note = await waitFor<string>(
    stalled,
    "the stall note",
    `document.body.classList.contains('stalled') && document.getElementById('status').textContent`,
    Math.max(0, STALL_NOTE_MS - (Date.now() - stallStarted)),
  );
  const links = await evaluate<number>(
    stalled,
    `[...document.querySelectorAll('.accessible-menu a')].filter((a) => a.getBoundingClientRect().width > 1).length`,
  );
  if (links === 0) throw new Error("the stall note shows no menu links");
  results.push(
    `stall: "${note}" with ${links} menu links, after ${((Date.now() - stallStarted) / 1000).toFixed(0)} s`,
  );

  if (gpu) await gpuParity();
}

/** The CRT shader through love.js against Balatro's own draw block, pixel for pixel. */
async function gpuParity() {
  const dir = run("node", ["frontend/lua/tests/build-effects.mjs"]).trim().split("\n").at(-1);
  if (!dir || !existsSync(join(dir, "index.html")))
    throw new Error("build-effects.mjs built no page");
  const port = await serve(dir);
  const page = await newPage("gpu");
  pages.push(page);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, page.session);
  const until = Date.now() + BOOT_MS;
  while (!page.consoleLines.some((line) => /^GPU (PASS|FAIL|ERROR)/.test(line))) {
    if (Date.now() > until) throw new Error("the GPU check printed no verdict");
    await sleep(200);
  }
  rmSync(join(dir, ".."), { recursive: true, force: true });
  const verdict = page.consoleLines.find((line) => /^GPU (PASS|FAIL|ERROR)/.test(line));
  if (verdict !== "GPU PASS")
    throw new Error(
      `GPU parity: ${page.consoleLines.filter((l) => l.startsWith("GPU")).join("; ")}`,
    );
  results.push("gpu: CRT parity at three sizes and three cursor positions");
}

async function report(error: unknown) {
  log(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  for (const page of pages) {
    const state = await evaluate<string>(
      page,
      `location.pathname + ' | ' + document.body.className + ' | ' + document.getElementById('status').textContent`,
    ).catch(() => "(no answer)");
    log(`${page.name}: ${state}`);
    const prints = await evaluate<string[]>(page, "window.__e2e.prints.slice(-5)").catch(() => []);
    if (prints.length > 0) log(`${page.name} last prints: ${JSON.stringify(prints)}`);
    if (page.consoleErrors.length > 0)
      log(`${page.name} errors: ${JSON.stringify(page.consoleErrors.slice(-5))}`);
  }
  if (apiLog && existsSync(apiLog))
    log(`API log tail:\n${readFileSync(apiLog, "utf8").split("\n").slice(-20).join("\n")}`);
}

try {
  await smoke();
  passed = true;
} catch (error) {
  await report(error);
} finally {
  for (const result of results) log(`ok: ${result}`);
  socket?.close();
  await stopAll();
}
log(passed ? `PASS in ${((Date.now() - t0) / 1000).toFixed(1)} s` : "FAIL");
process.exit(passed ? 0 : 1);
