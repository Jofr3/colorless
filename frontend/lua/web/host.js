// @ts-check
/* Boots love.js, writes Lua's mailbox files and loads card art. Everything else on the page is
   the bridge module's (src/lua/bridge.ts), which connects through window.colorlessHost. */

/** @typedef {import("../../../src/host/bridgeProtocol").ColorlessBridge} ColorlessBridge */
/** @typedef {import("../../../src/host/bridgeProtocol").ArtRequest} ArtRequest */

/** @param {string} id */
function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The host page has no #${id}.`);
  return found;
}
const canvas = /** @type {HTMLCanvasElement} */ (element("canvas"));
const loading = element("loading");
const statusElement = element("status");
const loadingProgress = element("loading-progress");
const loadingFill = element("loading-fill");
let loadingValue = 0;
/** @param {number} value */
function updateLoadingProgress(value) {
  loadingValue = Math.max(loadingValue, Math.min(100, value));
  loadingFill.style.width = `${loadingValue}%`;
  loadingProgress.setAttribute("aria-valuenow", String(Math.round(loadingValue)));
}
// Preserve browser reload shortcuts before SDL can consume their key events.
for (const type of /** @type {const} */ (["keydown", "keyup", "keypress"])) {
  window.addEventListener(
    type,
    (event) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "r") {
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}
/** @type {LoveRuntime | undefined} */
let runtime;
let ready = false;
/** @type {ColorlessBridge | undefined} */
let bridge;
// Mailboxes written before the runtime exists keep their latest text until preRun.
/** @type {Map<string, string>} */
const unwrittenMailboxes = new Map();
/** @type {Set<string>} */
const mailboxFiles = new Set();
// Lua reads only the revision list each frame (ui/mailbox.lua), so it is written after the data.
/** @type {Map<string, number>} */
const mailboxRevisions = new Map();
let mailboxSerial = 0;
/** @param {LoveRuntime} running @param {string} name @param {string} text */
function replaceFile(running, name, text) {
  if (mailboxFiles.has(name)) running.FS_unlink(`/${name}`);
  running.FS_createDataFile("/", name, text, true, true);
  mailboxFiles.add(name);
}
/** @param {string} name @param {string} text */
function writeMailbox(name, text) {
  if (!runtime || !bridge) {
    unwrittenMailboxes.set(name, text);
    return;
  }
  replaceFile(runtime, name, text);
  mailboxRevisions.set(name, ++mailboxSerial);
  const list = [...mailboxRevisions].map(([file, revision]) => `${file}\t${revision}`);
  replaceFile(runtime, bridge.mailboxes.revisions, list.join("\n"));
}
window.colorlessHost = {
  connect(connected) {
    bridge = connected;
  },
  writeMailbox,
  // Wanted lists are in priority order (LUA_ART_SLOTS in artworkCache.ts caps
  // them at the 96 kept here); touch them lowest first so eviction spares the head.
  wantArt(cards) {
    wantedArt = cards;
    for (const c of [...wantedArt].reverse()) {
      const path = artCache.get(c.id);
      if (path !== undefined) {
        artCache.delete(c.id);
        artCache.set(c.id, path);
      }
    }
    pumpArt();
  },
};
const motion = matchMedia("(prefers-reduced-motion: reduce)");

// Boot timings for devtools and scripts/bench-boot.ts.
/** @type {Set<string>} */
const bootMarks = new Set();
/** @param {"love-start" | "data-loaded" | "ready"} name */
function markBoot(name) {
  if (bootMarks.has(name)) return;
  bootMarks.add(name);
  performance.mark(`colorless:${name}`);
  if (name === "ready") performance.measure("colorless:boot", undefined, "colorless:ready");
}
const BOOT_FAILED = "The menu could not start. Reload to try again, or use the menu links.";
// After ready a Lua error stops a running page: the sandbox game is in local storage and an
// online match on the server, so a reload picks either up again.
const CRASHED = "Something went wrong. Reload to continue; a game in progress is saved.";
/** @param {string} message */
function fail(message) {
  document.body.classList.add("failed");
  loading.style.display = "flex";
  statusElement.textContent = message;
  bridge?.onFailed();
}
function syncViewport() {
  if (!bridge) return;
  // SDL sizes the drawable to the browser viewport. Lua's scene and CRT pass
  // must use that same size; a capped scene leaves the rest of it black.
  // Keep CSS-pixel dimensions (no devicePixelRatio multiplier).
  const text = `${Math.max(1, Math.round(innerWidth))} ${Math.max(1, Math.round(innerHeight))} ${motion.matches ? "1" : "0"}`;
  writeMailbox(bridge.mailboxes.viewport, text);
}
// build:lua replaces the empty object with each /love/ file's content hash;
// the `?v=` it adds changes the URL whenever the bytes do, which is what lets
// the deployed /love/ files be cached as immutable (public/_headers).
/** @type {Record<string, string>} */
const loveVersions = /* love-versions */ {};
/** @type {LoveModuleConfig} */
const loveModule = {
  arguments: ["./"],
  // build:lua emits the runtime and game package under /love/ (public/love/).
  locateFile: (path) => `/love/${path}${loveVersions[path] ? `?v=${loveVersions[path]}` : ""}`,
  INITIAL_MEMORY: 134217728,
  canvas: canvas,
  preRun: [
    (module) => {
      runtime = module;
      for (const [name, text] of unwrittenMailboxes) writeMailbox(name, text);
      unwrittenMailboxes.clear();
      syncViewport();
    },
  ],
  print: (message) => {
    if (!message.startsWith("COLORLESS:")) {
      console.log(message);
      if (/^Error:|stack traceback:/.test(message)) fail(ready ? CRASHED : BOOT_FAILED);
      return;
    }
    if (message === "COLORLESS:ready") {
      markBoot("ready");
      updateLoadingProgress(100);
      ready = true;
      loading.style.display = "none";
      void loadMusic();
    } else if (message.startsWith("COLORLESS:transition-art:")) {
      const [, action, token] =
        message.match(/^COLORLESS:transition-art:(used|invalid)\t(\d+)$/) || [];
      if (token) void consumeTransitionArt(Number(token), action === "invalid");
      return;
    }
    bridge?.onPrint(message);
  },
  printErr: (message) => {
    console.error(message);
  },
  setStatus: (message) => {
    if (ready || document.body.classList.contains("failed")) return;
    if (message) statusElement.textContent = message;
    // love.js reports downloaded bytes as "Downloading data... (loaded/total)".
    // Reserve the final 10% for runtime startup; only Lua's ready signal completes it.
    const download = message?.match(/\(([\d.]+)\/(\d+)\)/);
    if (download && Number(download[2]) > 0) {
      updateLoadingProgress(90 * Math.min(1, Number(download[1]) / Number(download[2])));
      if (Number(download[1]) >= Number(download[2])) markBoot("data-loaded");
    }
  },
  onAbort: () => {
    fail(ready ? CRASHED : BOOT_FAILED);
  },
};
globalThis.Module = loveModule;
// Download and compile the runtime while the page's scripts load. love.js would start only once
// Love() runs on window load, and a <link rel=preload> would hold that load event back and give
// up the streaming compile.
const runtimeUrl = loveModule.locateFile("love.wasm");
const compiledRuntime = WebAssembly.compileStreaming(fetch(runtimeUrl)).catch(() =>
  fetch(runtimeUrl)
    .then((response) => response.arrayBuffer())
    .then((bytes) => WebAssembly.compile(bytes)),
);
// instantiateWasm reports a failure; until love.js asks for the runtime nothing else listens.
compiledRuntime.catch(() => {});
loveModule.instantiateWasm = (imports, receive) => {
  compiledRuntime
    .then((module) =>
      WebAssembly.instantiate(module, imports).then((instance) => receive(instance, module)),
    )
    .catch((error) => {
      console.error(error);
      fail("Could not download the menu. Reload to try again.");
    });
  return {};
};
// Boot invariant: Love() starts on window load, after every classic script
// (game package, runtime) and the deferred bridge module have run, so Lua's
// first print finds the bridge connected. A bridge that failed to run would
// leave every screen dead, so show the failure overlay instead of starting.
addEventListener("load", () => {
  if (typeof Love !== "function") return;
  if (!bridge) {
    fail("Could not load the menu. Reload to try again.");
    return;
  }
  markBoot("love-start");
  Love(loveModule)
    .then(() => {
      // A package served from the loader's IndexedDB cache reports no download progress.
      markBoot("data-loaded");
      updateLoadingProgress(95);
      void prepareTransitionArt();
    })
    .catch((error) => {
      console.error(error);
      fail("Could not load the menu. Reload to try again.");
    });
});
/** @type {ReturnType<typeof setTimeout> | undefined} */
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    syncViewport();
  }, 100);
});
motion.addEventListener("change", () => {
  syncViewport();
});
canvas.addEventListener("pointerdown", () => {
  canvas.focus({ preventScroll: true });
});
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  fail("Graphics connection lost. Reload to continue.");
});

// Resource load errors don't bubble; listen in the capture phase.
addEventListener(
  "error",
  (event) => {
    if (event.target instanceof HTMLScriptElement)
      fail("Could not download the menu. Reload to try again.");
  },
  true,
);

// Lua starts the menu music once this file appears (main.lua's MUSIC).
async function loadMusic() {
  try {
    const response = await fetch(loveModule.locateFile("music1.ogg"));
    if (!response.ok) throw new Error(`music ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    runtime?.FS_createDataFile("/assets/sounds", "music1.ogg", bytes, true, false);
  } catch (error) {
    console.error("[colorless] load music", error);
  }
}

/** @type {Map<string, string>} */
const artCache = new Map();
/** @type {Set<string>} */
const artPending = new Set();
/** @type {Map<string, number>} */
const artFailed = new Map();
let artRevision = 0,
  artSerial = 0,
  artActive = 0;
/** @type {readonly ArtRequest[]} */
let wantedArt = [];
function publishArt() {
  if (!bridge) return;
  writeMailbox(
    bridge.mailboxes.art,
    [
      ++artRevision,
      ...[...artCache].map(([id, path]) => [id, path].map(encodeURIComponent).join("\t")),
    ].join("\n"),
  );
}
// The full pool stays in IndexedDB. Stage one PNG for the next transition;
// Lua acknowledges it only after retaining the image and border on the GPU.
/** @type {{ token: number, id: string, path: string } | null} */
let transitionArt = null;
let transitionArtSerial = 0;
/** @type {Promise<void> | null} */
let transitionPreparing = null;
let transitionConsuming = false;
/** @returns {Promise<void>} */
async function prepareTransitionArt() {
  const running = runtime;
  const mailboxes = bridge?.mailboxes;
  const cache = bridge?.artwork;
  if (!running || !mailboxes || !cache || transitionArt || transitionConsuming) return;
  if (transitionPreparing) return transitionPreparing;
  transitionPreparing = (async () => {
    const selected = await cache.pick();
    if (!selected) return;
    const bytes = new Uint8Array(await selected.blob.arrayBuffer());
    const token = ++transitionArtSerial,
      path = `__transition_art_${token}.png`;
    running.FS_createDataFile("/", path, bytes, true, true);
    transitionArt = { token, id: selected.id, path };
    writeMailbox(
      mailboxes.transitionArt,
      [token, selected.id, path].map(encodeURIComponent).join("\t"),
    );
  })()
    .catch((error) => console.error("[colorless] prepare transition art", error))
    .finally(() => {
      transitionPreparing = null;
    });
  return transitionPreparing;
}
/** @param {number} token @param {boolean} invalid */
async function consumeTransitionArt(token, invalid) {
  if (!transitionArt || transitionArt.token !== token || !bridge) return;
  transitionConsuming = true;
  const selected = transitionArt;
  transitionArt = null;
  writeMailbox(bridge.mailboxes.transitionArt, "");
  try {
    runtime?.FS_unlink(`/${selected.path}`);
  } catch {}
  const cache = bridge.artwork;
  try {
    if (invalid) await cache.remove(selected.id);
    else await cache.markShown(selected.id);
  } finally {
    transitionConsuming = false;
  }
  await prepareTransitionArt();
}
/** @param {ArtRequest} card */
async function loadArt(card) {
  artActive++;
  artPending.add(card.id);
  try {
    const cache = bridge?.artwork;
    let blob = await cache?.get(card.id);
    if (!blob) {
      const response = await fetch(card.url);
      if (!response.ok) throw Error("art");
      const bitmap = await createImageBitmap(await response.blob());
      // Twice card_dimensions.lua's 136×187 artwork area (the scan's 8:11
      // ratio), excluding the equal inset added by the Lua frame renderer.
      const c = document.createElement("canvas");
      c.width = 272;
      c.height = 374;
      c.getContext("2d")?.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
      if (blob && cache) void cache.put(card.id, blob).then(() => prepareTransitionArt());
    }
    const running = runtime;
    if (!running || !blob) throw Error("art");
    const path = `__card_art_${++artSerial}.png`;
    running.FS_createDataFile("/", path, new Uint8Array(await blob.arrayBuffer()), true, true);
    artCache.set(card.id, path);
    for (const [id, old] of artCache) {
      if (artCache.size <= 96) break;
      running.FS_unlink(`/${old}`);
      artCache.delete(id);
    }
    publishArt();
  } catch {
    artFailed.set(card.id, Date.now());
  } finally {
    artPending.delete(card.id);
    artActive--;
    pumpArt();
  }
}
function pumpArt() {
  for (const card of wantedArt) {
    if (artActive >= 4) break;
    if (
      !artCache.has(card.id) &&
      !artPending.has(card.id) &&
      Date.now() - (artFailed.get(card.id) || 0) > 30000
    )
      void loadArt(card);
  }
}
