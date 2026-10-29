#!/usr/bin/env bun
/**
 * The browser smoke of the real page. Opt-in: not part of `check`, `release` or CI, which cannot
 * build game.data. It builds the site against its own local API on free ports, with a fresh
 * migrated D1 under a temporary directory that holds only the fixture catalog
 * (`@colorless/api/testing/fixtureCatalog`), makes its accounts and decks through that API, and
 * drives headless Chromium (or Firefox, with --firefox) through:
 *   boot and keyboard input, and the Tab that leaves home past its last button; a sandbox game
 *   to turn 3; a Lua crash mid-game and the reload that resumes it; a builder edit saved as the
 *   page is hidden, navigated away and closed (keepalive); a deep link whose game.data never
 *   arrives (the stall note, live links); an online match from create to a
 *   rematch, in two browser contexts, whose guest socket goes silent and is replaced mid-match;
 *   an invite link to a code that names no lobby.
 * It reads state from the mailboxes the page writes for Lua and drives Lua through the bridge's
 * own `COLORLESS:` lines, never by canvas coordinates. Every process it starts is stopped on the
 * way out, failing or not.
 *
 *   CHROMIUM=<binary> BALATRO_SOURCE=<dir> bun run e2e [--gpu] [--keep]
 *   FIREFOX=<binary> BALATRO_SOURCE=<dir> bun run e2e --firefox [--gpu] [--keep]
 *
 * CHROMIUM defaults to the first of chromium, chromium-browser, google-chrome on PATH, FIREFOX to
 * firefox. Headless Firefox makes no WebGL context, so --firefox runs it on a private Xvfb (XVFB,
 * else Xvfb on PATH, else nixpkgs#xorg.xvfb), with Mesa's software GL (MESA, else nixpkgs#mesa)
 * where the system has none in /run/opengl-driver. --gpu adds the CRT parity check
 * (frontend/lua/tests/effects_gpu.lua). --keep leaves the temporary directory (site, D1 state, API
 * log); a failed run always leaves it.
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
import {
  type Browser,
  launchChromium,
  launchFirefox,
  type Page,
  type PageOptions,
} from "./lib/browser";
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

const firefox = process.argv.includes("--firefox");

/** The browser binary: $CHROMIUM or $FIREFOX, else the first of its usual names on PATH. */
function findBrowser(): string {
  const variable = firefox ? "FIREFOX" : "CHROMIUM";
  const named = process.env[variable];
  if (named) {
    if (!existsSync(named)) fail(`${variable}=${named} does not exist.`);
    return named;
  }
  const names = firefox
    ? ["firefox"]
    : ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];
  for (const name of names)
    for (const dir of (process.env.PATH ?? "").split(delimiter))
      if (dir && existsSync(join(dir, name))) return join(dir, name);
  const [label, attr] = firefox ? ["Firefox", "firefox"] : ["Chromium", "chromium"];
  return fail(
    `e2e needs ${label}: set ${variable} to its binary, or put ${attr} on PATH (with Nix:\n` +
      `  ${variable}=$(nix build nixpkgs#${attr} --no-link --print-out-paths)/bin/${attr}).`,
  );
}
const binary = findBrowser();

// ---------- processes, and stopping them ----------

const root = mkdtempSync(join(tmpdir(), "colorless-e2e-"));
const started: ChildProcess[] = [];
const servers: Server[] = [];
let passed = false;

/** Starts `command` in its own process group, so stopping it takes every process it spawned. */
function start(
  command: string,
  args: string[],
  options: { cwd?: string; logFile?: string; env?: Record<string, string> } = {},
) {
  const out = options.logFile ? createWriteStream(options.logFile) : undefined;
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", ...options.env },
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

// ---------- the browser ----------

// Records the page's mailbox writes, the bridge's prints, its non-GET fetches and its WebSockets,
// and keeps the bridge to send through. `muteSockets()` makes every open socket deaf: frames still
// leave, but none arrive. The server keeps hearing the pings, so its own silence sweep (5 s while two
// seats are held, 10 s of silence) never closes the socket first; when both ends went silent it
// sometimes did, the page only saw a close and reconnected, and the watchdog step timed out.
const HOOK = `(() => {
  const mail = {}, prints = [], errors = [], fetches = [], sockets = [];
  let host, bridge;
  window.__e2e = { mail, prints, errors, fetches, sockets, send: (line) => bridge && bridge.onPrint(line),
    muteSockets: () => sockets.filter((s) => s.open && !s.closedByPage).map((s) => { s.mutedAt = Date.now(); return s.url; }).length };
  addEventListener("error", (e) => errors.push(String(e.message || e.type)));
  addEventListener("unhandledrejection", (e) => errors.push("rejection " + String(e.reason)));
  // Any violation is an error, zod's eval probe too: the page sets zod jitless so it never probes.
  addEventListener("securitypolicyviolation", (e) => errors.push("csp " + e.violatedDirective + " " + e.sourceFile + ":" + e.lineNumber + " " + e.sample));
  Object.defineProperty(window, "colorlessHost", { configurable: true, get: () => host, set: (h) => {
    const write = h.writeMailbox, connect = h.connect;
    h.writeMailbox = (n, t) => { mail[n] = t; return write(n, t); };
    h.connect = (b) => { const on = b.onPrint; b.onPrint = (m) => { prints.push(m); return on(m); }; bridge = b; connect(b); };
    host = h;
  } });
  const nativeFetch = window.fetch;
  window.fetch = (input, init) => {
    const method = (init && init.method) || "GET";
    if (method !== "GET") fetches.push({ at: Date.now(), method, url: String(input), keepalive: !!(init && init.keepalive), bytes: init && typeof init.body === "string" ? init.body.length : 0 });
    return nativeFetch(input, init);
  };
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      const record = { url: String(url), created: Date.now(), open: 0, closedByPage: 0, closed: 0, mutedAt: 0, pings: [], pongs: 0, received: 0 };
      sockets.push(record);
      this.__record = record;
      super.addEventListener("open", () => { record.open = Date.now(); });
      super.addEventListener("close", () => { record.closed = Date.now(); });
    }
    get onmessage() { return this.__onmessage || null; }
    set onmessage(handler) {
      this.__onmessage = handler;
      const record = this.__record;
      super.onmessage = handler && ((event) => {
        if (record.mutedAt) return;
        record.received++;
        if (event.data === "pong") record.pongs++;
        handler.call(this, event);
      });
    }
    send(data) {
      if (data === "ping") this.__record.pings.push(Date.now());
      super.send(data);
    }
    close(code, reason) {
      if (!this.__record.closedByPage) this.__record.closedByPage = Date.now();
      super.close(code, reason);
    }
  };
})();`;

let browser: Browser | undefined;
function driver(): Browser {
  if (!browser) throw new Error("no browser yet");
  return browser;
}

/** A nixpkgs package's store path, fetched or built the first time. */
function nixPackage(attr: string): string {
  const built = spawnSync("nix", ["build", `nixpkgs#${attr}`, "--no-link", "--print-out-paths"], {
    encoding: "utf8",
  });
  const path = built.stdout?.trim().split("\n")[0];
  if (built.status !== 0 || !path)
    throw new Error(`nix build nixpkgs#${attr} failed:\n${built.stderr}`);
  return path;
}

const onPath = (name: string) =>
  (process.env.PATH ?? "")
    .split(delimiter)
    .map((dir) => join(dir, name))
    .find((file) => existsSync(file));

/** The environment Firefox gets WebGL in: its own Xvfb display, and where the system has no GL
    driver of its own (NixOS keeps it in /run/opengl-driver), Mesa's software rasterizer from MESA or
    nixpkgs. Headless Firefox makes no WebGL context at all, so love.js could not start. */
async function firefoxDisplay(): Promise<Record<string, string>> {
  const xvfb = process.env.XVFB ?? onPath("Xvfb") ?? `${nixPackage("xorg.xvfb")}/bin/Xvfb`;
  const server = spawn(
    xvfb,
    ["-displayfd", "3", "-screen", "0", "1280x800x24", "-nolisten", "tcp"],
    {
      stdio: ["ignore", "ignore", "ignore", "pipe"],
      detached: true,
    },
  );
  started.push(server);
  const display = await new Promise<string>((done, reject) => {
    let text = "";
    server.stdio[3]?.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      if (text.includes("\n")) done(text.trim());
    });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Xvfb (${xvfb}) exited with ${code}`)));
    setTimeout(() => reject(new Error("Xvfb named no display in 10 s")), 10_000);
  });
  const env: Record<string, string> = { DISPLAY: `:${display}` };
  const mesa =
    process.env.MESA ??
    (existsSync("/run/opengl-driver/lib") || !onPath("nix") ? undefined : nixPackage("mesa"));
  if (mesa)
    Object.assign(env, {
      __EGL_VENDOR_LIBRARY_DIRS: `${mesa}/share/glvnd/egl_vendor.d`,
      __GLX_VENDOR_LIBRARY_NAME: "mesa",
      LIBGL_DRIVERS_PATH: `${mesa}/lib/dri`,
      GBM_BACKENDS_PATH: `${mesa}/lib/gbm`,
      LD_LIBRARY_PATH: `${mesa}/lib`,
    });
  log(`Firefox on Xvfb display :${display}${mesa ? ` with ${mesa}` : ""}`);
  return env;
}

async function launchBrowser() {
  const env = firefox ? await firefoxDisplay() : {};
  const options = {
    binary,
    profile: join(root, "profile"),
    port: await freePort(),
    start: (command: string, args: string[]) => start(command, args, { env }),
    headless: !firefox,
    hook: HOOK,
    log,
  };
  browser = await (firefox ? launchFirefox(options) : launchChromium(options));
  log(`browser ${browser.version}`);
}

const newPage = (name: string, options?: PageOptions) => driver().newPage(name, options);
const evaluate = <T = unknown>(page: Page, expression: string) =>
  driver().evaluate<T>(page, expression);

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
  await driver().navigate(page, site + path);
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

// ---------- the deck builder's last save ----------

const BUILDER = WIRE_ROWS.builder.header;
const builderField = (field: (typeof BUILDER.fields)[number]) =>
  `(window.__e2e.mail[${JSON.stringify(MAILBOXES.builder)}] || '').split('\\n')[0].split('\\t').map(decodeURIComponent)[${col(BUILDER, field)}]`;

/** Polls the server, through `reader`'s cookie, until deck `id` is named `name`. */
async function serverHas(reader: Page, id: string, name: string, ms = 8000) {
  const until = Date.now() + ms;
  for (;;) {
    const deck = await api<{ name: string }>(reader, "GET", `/decks/${id}`);
    if (deck.name === name) return;
    if (Date.now() > until) throw new Error(`the server kept "${deck.name}", not "${name}"`);
    await sleep(200);
  }
}

/** A builder tab on deck `id`, in `owner`'s cookie jar, ready to edit. */
async function builderTab(owner: Page, id: string, name: string) {
  const page = await newPage(name, { beside: owner });
  pages.push(page);
  await open(page, `/decks/${id}`);
  await lua(page, "builder", "open", id);
  await waitFor(page, "the builder", `${builderField("phase")} === 'ready'`, 20_000);
  return page;
}

/** A rename sent inside the save debounce, then the page hidden, navigated away or closed: each
    save must still reach the server, in a fetch marked keepalive (src/host/unsavedEdits.ts). */
async function builderSaves(owner: Page) {
  const { id } = await api<{ id: string }>(owner, "POST", "/decks", {
    name: "E2E builder",
    tint: 10,
    format: "expanded",
    cards: FIXTURE_DECK,
  });
  // The 600 ms save debounce is the whole window, so act the moment the builder holds the edit
  // rather than after a fixed sleep a busy machine can outlast (the save would leave before it).
  const rename = async (page: Page, name: string) => {
    await lua(page, "builder", "name", name);
    await waitFor(
      page,
      "the edit to be pending",
      `${builderField("saveStatus")} === 'pending'`,
      5000,
    );
  };
  const patches = (page: Page) =>
    evaluate<{ keepalive: boolean; bytes: number }[]>(
      page,
      `window.__e2e.fetches.filter((f) => f.method === 'PATCH' && f.url.includes(${JSON.stringify(id)}))`,
    );

  // Hidden: synthetic, as a headless tab is never hidden; the page stays, so its fetch is visible.
  const page = await builderTab(owner, id, "builder");
  await rename(page, "E2E hidden");
  await evaluate(
    page,
    `(Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }), document.dispatchEvent(new Event('visibilitychange')))`,
  );
  await serverHas(owner, id, "E2E hidden");
  const sent = await patches(page);
  if (sent.length !== 1 || !sent[0]?.keepalive)
    throw new Error(`the hidden save sent ${JSON.stringify(sent)}, not one keepalive PATCH`);
  await waitFor(page, "the save to settle", `${builderField("saveStatus")} !== 'saving'`, 10_000);
  await evaluate(page, "delete document.visibilityState");

  // Navigated away: an ordinary fetch would be cancelled with the page.
  await rename(page, "E2E navigated");
  await driver().navigate(page, "about:blank");
  await serverHas(owner, id, "E2E navigated");
  pages.splice(pages.indexOf(page), 1);
  await driver().closePage(page);

  // Closed.
  const closing = await builderTab(owner, id, "builder-close");
  await rename(closing, "E2E closed");
  pages.splice(pages.indexOf(closing), 1);
  await driver().closePage(closing);
  await serverHas(owner, id, "E2E closed");
  results.push(
    `builder: a save inside the debounce reached the server when hidden (keepalive, ${sent[0].bytes} bytes), navigated away and closed`,
  );
}

// ---------- the online lobby ----------

const ONLINE = WIRE_ROWS.online;
async function lobby(host: Page, guest: Page, hostDeck: string, guestDeck: string) {
  // Lua opens /online on its Create tab, which makes the lobby (frontend/lua/ui/online.lua). An
  // `open` sent after that lobby exists would drop it for a second one, after the guest has the
  // first code.
  await open(host, "/online");
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
  // The route and the table's mailbox change before Lua has opened the table, which a busy
  // machine can hold back for seconds; a press before that goes to no table, as no player's can.
  const opened = JSON.stringify(`COLORLESS:simulator:open\tonline\t${code}`);
  for (const page of [host, guest])
    await waitFor(page, "Lua to open the online table", `window.__e2e.prints.includes(${opened})`);
}

/** The online header's `step`, as a JS expression. */
const onlineStep = `(window.__e2e.mail[${JSON.stringify(MAILBOXES.online)}] || '').split('\\n')[0].split('\\t').map(decodeURIComponent)[${col(ONLINE.header, "step")}]`;

/** An old-style invite link to a code no lobby holds: the server says so at once, so the modal
    shows "not found" well inside the 4 s the client used to wait before guessing it. */
async function deadCode(page: Page) {
  await open(page, "/?lobby=ZZZZ");
  const asked = Date.now();
  await lua(page, "online", "open", "ZZZZ");
  await waitFor(page, "the not-found step", `${onlineStep} === 'not-found'`, 10_000);
  const took = Date.now() - asked;
  if (took > 3000)
    throw new Error(`${page.name}: "not found" took ${took} ms, not a definite answer`);
  return took;
}

type SocketRecord = {
  url: string;
  open: number;
  closedByPage: number;
  pings: number[];
  pongs: number;
};

/** The lobby socket's pings and pongs, then the watchdog: a socket that hears nothing back is given
    up after SOCKET_SILENCE_MS (src/online/channel.ts) for a new one, and the match goes on. */
async function socketWatchdog(page: Page) {
  const lobbySockets = `window.__e2e.sockets.filter((s) => s.url.includes('/lobby/'))`;
  await waitFor(
    page,
    "five pings",
    `${lobbySockets}.some((s) => s.open && !s.closedByPage && s.pings.length >= 5)`,
    15_000,
  );
  const live = (await evaluate<SocketRecord[]>(page, lobbySockets)).find(
    (s) => s.open && !s.closedByPage,
  );
  if (!live) throw new Error(`${page.name}: no open lobby socket`);
  const gaps = live.pings.slice(1).map((at, i) => at - (live.pings[i] ?? at));
  const gap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;
  if (gap < 1200 || gap > 2000) throw new Error(`${page.name}: pings ${gap} ms apart, not 1500`);
  if (live.pongs < live.pings.length - 2)
    throw new Error(`${page.name}: ${live.pongs} pongs for ${live.pings.length} pings`);
  const muted = await evaluate<number>(page, "window.__e2e.muteSockets()");
  if (muted !== 1) throw new Error(`${page.name}: muted ${muted} sockets, not one`);
  const given = await waitFor<number>(
    page,
    "the watchdog to give up the silent socket",
    "(() => { const s = window.__e2e.sockets.find((s) => s.mutedAt); return s && s.closedByPage ? s.closedByPage - s.mutedAt : 0; })()",
    20_000,
  );
  if (given < 9000 || given > 14_000)
    throw new Error(`${page.name}: the silent socket was given up after ${given} ms`);
  const back = await waitFor<number>(
    page,
    "a new socket that hears the server",
    `(() => { const old = window.__e2e.sockets.find((s) => s.mutedAt); const s = ${lobbySockets}.find((s) => s.open > old.closedByPage && s.pongs > 0); return s ? s.open - old.closedByPage : 0; })()`,
    15_000,
  );
  return `pings ${gap} ms apart, each answered; a silent socket given up after ${(given / 1000).toFixed(1)} s and replaced ${back} ms later`;
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

  await launchBrowser();

  // A page whose game.data never arrives, left to sit while the rest runs.
  const stalled = await newPage("stalled", { userAgentMark: STALL_MARK });
  pages.push(stalled);
  const stallStarted = Date.now();
  await driver().navigate(stalled, `${site}/decks/e2e-stall`);

  // ---- boot and real keyboard input ----
  const host = await newPage("host");
  pages.push(host);
  const bootStart = Date.now();
  await open(host, "/");
  log(`boot ready in ${Date.now() - bootStart} ms`);
  await assertHealthy(host, "boot");
  await evaluate(host, "document.getElementById('canvas').focus()");
  await driver().key(host, "ArrowRight");
  await waitFor(
    host,
    "Lua to announce the focus",
    `window.__e2e.prints.some((m) => m.startsWith('COLORLESS:announce:'))`,
    5000,
  );
  results.push("boot: ready, no failure overlay, keyboard focus announced by Lua");

  // ---- Tab past home's last button leaves the canvas ----
  // ArrowRight focused Sandbox; four Tabs reach Settings, the ring's last button.
  for (let i = 0; i < 4; i++) await driver().key(host, "Tab");
  await waitFor(
    host,
    "Lua to report the last focus edge",
    `window.__e2e.prints.includes('COLORLESS:focus-edge:last')`,
    5000,
  );
  const heardBefore = await evaluate<number>(host, "window.__e2e.prints.length");
  await driver().key(host, "Tab");
  const left = await waitFor<string>(
    host,
    "Tab to leave the canvas",
    `document.activeElement && document.activeElement.id !== 'canvas' && document.activeElement.id`,
    5000,
  );
  await sleep(200);
  const heardAfter = await evaluate<string[]>(
    host,
    `window.__e2e.prints.slice(${heardBefore}).filter((m) => m.startsWith('COLORLESS:announce:') || m.startsWith('COLORLESS:focus-edge:'))`,
  );
  if (left !== "sandbox-link" || heardAfter.length > 0)
    throw new Error(
      `Tab from Settings went to #${left}, and Lua heard ${JSON.stringify(heardAfter)}`,
    );
  results.push("tab: Tab past Settings left the canvas for the Sandbox link; Lua never saw it");

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

  // ---- the builder's last save, as the page hides or goes ----
  await builderSaves(host);

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
  const watchdog = await socketWatchdog(guest);
  for (const page of [host, guest])
    await waitFor(
      page,
      "the same match after the new socket",
      `${headerField(HEADER.phase)} === 'ready' && ${headerField(HEADER.matchId)} === ${JSON.stringify(firstMatch)} && ${headerField(HEADER.outcome)} === ''`,
      10_000,
    );
  results.push(`watchdog: ${watchdog}; the match went on`);
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

  // ---- an invite to a code no lobby holds ----
  const took = await deadCode(guest);
  await assertHealthy(guest, "the dead lobby code");
  results.push(`dead code: /?lobby=ZZZZ showed "not found" ${took} ms after the modal opened`);

  // ---- the stalled boot ----
  const note = await waitFor<string>(
    stalled,
    "the stall note",
    `document.body.classList.contains('stalled') && document.getElementById('status').textContent`,
    Math.max(0, STALL_NOTE_MS - (Date.now() - stallStarted)),
  );
  // On a deep link the links must be live and focusable (not inert under the builder), with a way
  // Home; a Reload button, where the overlay has one, takes focus too.
  const stall = await evaluate<{
    links: number;
    inert: boolean;
    home: boolean;
    canvasTab: number;
    reload: boolean | null;
  }>(
    stalled,
    `(() => {
      const nav = document.querySelector('.accessible-menu');
      const home = document.getElementById('home-link');
      home.focus();
      const focused = document.activeElement === home;
      const reload = document.querySelector('#loading button');
      if (reload) reload.focus();
      return {
        links: [...nav.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().width > 1).length,
        inert: nav.inert,
        home: focused,
        canvasTab: document.getElementById('canvas').tabIndex,
        reload: reload ? document.activeElement === reload : null,
      };
    })()`,
  );
  if (stall.links === 0) throw new Error("the stall note shows no menu links");
  if (stall.inert || !stall.home || stall.canvasTab !== -1 || stall.reload === false)
    throw new Error(`the stalled deep link is not usable: ${JSON.stringify(stall)}`);
  results.push(
    `stall: "${note}" on /decks/e2e-stall with ${stall.links} live menu links (Home focusable${stall.reload ? ", Reload focusable" : ", no Reload button"}), after ${((Date.now() - stallStarted) / 1000).toFixed(0)} s`,
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
  await driver().navigate(page, `http://127.0.0.1:${port}/`);
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
    const prints = await evaluate<string[]>(page, "window.__e2e.prints.slice(-15)").catch(() => []);
    if (prints.length > 0) log(`${page.name} last prints: ${JSON.stringify(prints)}`);
    for (const name of [MAILBOXES.simulator, MAILBOXES.online]) {
      const rows = await rowsOf(page, name).catch(() => []);
      const shown = rows.filter(
        (row, i) => i === 0 || row[0] === "L" || row[0] === "P" || row[0] === "A",
      );
      if (rows.length > 0) log(`${page.name} ${name}: ${JSON.stringify(shown)}`);
    }
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
  browser?.close();
  await stopAll();
}
log(passed ? `PASS in ${((Date.now() - t0) / 1000).toFixed(1)} s` : "FAIL");
process.exit(passed ? 0 : 1);
