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
let settingsRequest = 0;
let settingsTab = "game";
/** @type {ColorlessBridge | undefined} */
let bridge;
// Mailboxes written before the runtime exists keep their latest text until preRun.
/** @type {Map<string, string>} */
const unwrittenMailboxes = new Map();
/** @type {Set<string>} */
const mailboxFiles = new Set();
/** @param {string} name @param {string} text */
function writeMailbox(name, text) {
  if (!runtime) {
    unwrittenMailboxes.set(name, text);
    return;
  }
  if (mailboxFiles.has(name)) runtime.FS_unlink(`/${name}`);
  runtime.FS_createDataFile("/", name, text, true, true);
  mailboxFiles.add(name);
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

/** @param {string} message */
function fail(message) {
  document.body.classList.add("failed");
  loading.style.display = "flex";
  statusElement.textContent = message;
}
function syncViewport() {
  if (!bridge) return;
  // SDL sizes the drawable to the browser viewport. Lua's scene and CRT pass
  // must use that same size; a capped scene leaves the rest of it black.
  // Keep CSS-pixel dimensions (no devicePixelRatio multiplier).
  const text = `${Math.max(1, Math.round(innerWidth))} ${Math.max(1, Math.round(innerHeight))} ${motion.matches ? "1" : "0"} ${settingsRequest} ${settingsTab}`;
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
      if (/^Error:|stack traceback:/.test(message))
        fail("The menu could not start. Reload to try again, or use the menu links.");
      return;
    }
    if (message === "COLORLESS:ready") {
      updateLoadingProgress(100);
      ready = true;
      loading.style.display = "none";
    } else if (message.startsWith("COLORLESS:transition-art:")) {
      const [, action, token] =
        message.match(/^COLORLESS:transition-art:(used|invalid):(\d+)$/) || [];
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
    }
  },
  onAbort: () => {
    fail("The menu could not start. Reload to try again, or use the menu links.");
  },
};
globalThis.Module = loveModule;
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
  Love(loveModule)
    .then(() => {
      updateLoadingProgress(95);
      void prepareTransitionArt();
      // ?account and ?settings open the settings popup on the matching tab.
      const params = new URLSearchParams(location.search);
      if (params.has("account") || params.has("settings")) {
        settingsRequest++;
        settingsTab = params.has("account") ? "account" : "game";
      }
      syncViewport();
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
element("settings-link").addEventListener("click", (event) => {
  if (!ready || !runtime) return;
  event.preventDefault();
  settingsRequest++;
  settingsTab = "game";
  syncViewport();
  canvas.focus({ preventScroll: true });
});
element("account-link").addEventListener("click", (event) => {
  if (!ready || !runtime) return;
  event.preventDefault();
  settingsRequest++;
  settingsTab = "account";
  syncViewport();
  canvas.focus({ preventScroll: true });
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
