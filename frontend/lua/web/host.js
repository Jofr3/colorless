// @ts-check
/* Boots love.js, writes Lua's mailbox files and loads card art. Everything else on the page is
   the bridge module's (src/lua/bridge.ts), which connects through window.colorlessHost. */

/** @typedef {import("../../../src/host/bridgeProtocol").ColorlessBridge} ColorlessBridge */
/** @typedef {import("../../../src/host/bridgeProtocol").ArtRequest} ArtRequest */
/** @typedef {import("../../../src/host/bridgeProtocol").DegradedState} DegradedState */

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
// The overlay's one control: shown while the boot stalls or after a failure, the only way to
// start again that a keyboard can reach once the runtime is dead.
const reloadButton = document.createElement("button");
reloadButton.type = "button";
reloadButton.id = "reload";
reloadButton.textContent = "Reload";
reloadButton.hidden = true;
loading.append(reloadButton);

/** @type {LoveRuntime | undefined} */
let runtime;
let ready = false;
let failed = false;
let stalled = false;
/** @type {ColorlessBridge | undefined} */
let bridge;
/** The last state told to the bridge, replayed to a bridge that connects after it. */
/** @type {DegradedState | undefined} */
let degraded;
/** @param {DegradedState} state */
function degrade(state) {
  degraded = state;
  bridge?.onDegraded(state);
}

const UNSUPPORTED =
  "Colorless needs WebGL and WebAssembly. Turn on hardware acceleration or try another browser.";
const BOOT_FAILED = "The menu could not start. Reload to try again.";
const DOWNLOAD_FAILED = "Could not download the menu. Reload to try again.";
const LOAD_FAILED = "Could not load the menu. Reload to try again.";
const GRAPHICS_LOST = "Graphics connection lost. Reload to continue.";
// After ready a Lua error stops a running page: the sandbox game is in local storage and an
// online match on the server, so a reload picks either up again.
const CRASHED = "Something went wrong. Reload to continue; a game in progress is saved.";
const STALLED = "Still loading… Keep waiting, or reload to try again.";
const STARTING = "Starting…";
/** @param {number} percent */
const loadingText = (percent) =>
  percent > 0 ? `Loading the menu… ${percent}%` : "Loading the menu…";
// The failure text is written this long after the overlay is shown again, once the status
// region is back in the accessibility tree: text that arrives with the region is often not read.
const ANNOUNCE_DELAY_MS = 100;

// ---- the boot bar ----
// One bar for the two downloads, each weighted by its expected transfer; the last tenth is the
// runtime starting (the package unpacked at 95%, Lua's ready at 100%). The live region gets only
// milestones, each quarter and the start, never byte counts.
const DOWNLOAD_SHARE = 90;
const MILESTONES = [25, 50, 75];
let loadingValue = 0;
let ariaValue = 0;
let milestone = "";
/** @param {number} value */
function updateLoadingProgress(value) {
  const next = Math.max(loadingValue, Math.min(100, value));
  if (next <= loadingValue) return;
  loadingValue = next;
  watchBoot();
  loadingFill.style.width = `${loadingValue}%`;
  const whole = Math.floor(loadingValue);
  if (whole !== ariaValue) {
    ariaValue = whole;
    loadingProgress.setAttribute("aria-valuenow", String(whole));
  }
  const reached =
    loadingValue >= DOWNLOAD_SHARE
      ? STARTING
      : loadingText(MILESTONES.filter((m) => loadingValue >= m).pop() ?? 0);
  if (reached !== milestone) {
    milestone = reached;
    if (!ready && !failed && !stalled) statusElement.textContent = milestone;
  }
}
/** build:lua replaces the empty object with the byte sizes the bar weighs (build.mjs). */
/** @type {Partial<Record<"wasm" | "wasmTransfer" | "data" | "packed", number>>} */
const loveSizes = /* love-sizes */ {};
/** @type {Record<"wasm" | "data", number>} */
const downloaded = { wasm: 0, data: 0 };
/** @param {"wasm" | "data"} part @param {number} bytes @param {number | undefined} expected */
function download(part, bytes, expected) {
  downloaded[part] = Math.max(downloaded[part], Math.min(1, expected ? bytes / expected : 0));
  const wasm = loveSizes.wasmTransfer || 1;
  const data = loveSizes.packed || 1;
  updateLoadingProgress(
    (DOWNLOAD_SHARE * (downloaded.wasm * wasm + downloaded.data * data)) / (wasm + data),
  );
}
/** A response whose body reports its running byte count as it is read. Body chunks are decoded
 * bytes, whatever the transfer encoding.
 * @param {Response} response @param {(bytes: number) => void} onBytes @param {HeadersInit} [headers] */
function counted(response, onBytes, headers) {
  if (!response.body || typeof TransformStream !== "function") return response;
  let bytes = 0;
  const body = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        onBytes(bytes);
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, { headers });
}

// Nothing times out a download that stops moving, so after a while without progress the page
// says so and offers Reload, and keeps waiting: any progress takes the note down again.
const BOOT_STALL_MS = 45000;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let bootStallTimer;
function watchBoot() {
  clearTimeout(bootStallTimer);
  if (stalled && !failed) {
    stalled = false;
    document.body.classList.remove("stalled");
    if (document.activeElement === reloadButton) canvas.focus({ preventScroll: true });
    reloadButton.hidden = true;
    if (!ready) statusElement.textContent = milestone;
    degrade("recovered");
  }
  if (ready || failed) return;
  bootStallTimer = setTimeout(() => {
    stalled = true;
    document.body.classList.add("stalled");
    statusElement.textContent = STALLED;
    // Shown, not focused: the download may still finish, and a stall must not take focus away.
    reloadButton.hidden = false;
    degrade("stalled");
  }, BOOT_STALL_MS);
}

/** @param {string} message */
function fail(message) {
  // The first failure is the cause; what breaks after it is a consequence.
  if (failed) return;
  failed = true;
  clearTimeout(bootStallTimer);
  stalled = false;
  document.body.classList.remove("stalled");
  document.body.classList.add("failed");
  loading.style.display = "flex";
  statusElement.setAttribute("aria-live", "assertive");
  statusElement.textContent = "";
  setTimeout(() => {
    statusElement.textContent = message;
  }, ANNOUNCE_DELAY_MS);
  reloadButton.hidden = false;
  reloadButton.focus({ preventScroll: true });
  degrade("failed");
}
// A boot that failed may have cached a package that does not belong with this runtime (a deploy
// in the middle of a boot), so its reload starts from an empty package cache. The delete waits
// for game.js's open connection, which closes as the page unloads.
reloadButton.addEventListener("click", () => {
  if (ready || !failed) {
    location.reload();
    return;
  }
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  setTimeout(reload, 1000);
  try {
    const request = indexedDB.deleteDatabase("EM_PRELOAD_CACHE");
    request.onsuccess = request.onerror = request.onblocked = reload;
  } catch {
    reload();
  }
});

// ---- keys the browser keeps ----
/** Browser shortcuts SDL's window listeners would swallow. Lua binds none of them: no function
 * keys, and nothing with Ctrl, Cmd or Alt. @param {KeyboardEvent} event */
function browserShortcut(event) {
  const key = event.key ?? "";
  if (["F5", "F6", "F11", "F12"].includes(key)) return true;
  const command = event.ctrlKey || event.metaKey;
  if (command && !event.altKey && ["r", "=", "+", "-", "0", "l", "f"].includes(key.toLowerCase()))
    return true;
  return event.altKey && !command && (key === "ArrowLeft" || key === "ArrowRight");
}
// A capture listener on the window runs before SDL's (window, bubbling), so stopping an event
// here keeps it from SDL without preventing what the browser does with it.
for (const type of /** @type {const} */ (["keydown", "keyup", "keypress"])) {
  window.addEventListener(
    type,
    (event) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key?.toLowerCase() === "r") {
        event.stopImmediatePropagation();
        return;
      }
      const focused = document.activeElement;
      // A text proxy (src/host/textProxy.ts) takes its own keys, Tab included, in a later
      // capture listener.
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;
      if (
        browserShortcut(event) ||
        focused === reloadButton ||
        // Tab moves between the page's own controls (the links, the overlay's Reload) unless
        // the running menu has focus.
        (event.key === "Tab" && (focused !== canvas || !ready || failed))
      )
        event.stopImmediatePropagation();
    },
    true,
  );
}
// Ctrl+wheel zooms the page; SDL's wheel listener on the canvas would prevent it.
window.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) event.stopImmediatePropagation();
  },
  { capture: true, passive: true },
);

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
    if (degraded && degraded !== "recovered") connected.onDegraded(degraded);
  },
  writeMailbox,
  // Wanted lists are in priority order, capped at the bridge's artSlots; touch
  // them lowest first so eviction spares the head.
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
// A touch screen as the primary pointer: Lua suggests turning a phone held sideways.
const coarsePointer = matchMedia("(pointer: coarse)");

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
function syncViewport() {
  if (!bridge) return;
  // The canvas fills the viewport. Lua renders at its CSS size times the full device pixel
  // ratio, so text and art are drawn at the screen's own resolution, and lays out from the
  // CSS size, so the page looks the same at every ratio.
  const width = Math.max(1, Math.round(innerWidth));
  const height = Math.max(1, Math.round(innerHeight));
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const device = `${Math.max(1, Math.round(width * ratio))} ${Math.max(1, Math.round(height * ratio))}`;
  writeMailbox(
    bridge.mailboxes.viewport,
    `${width} ${height} ${motion.matches ? "1" : "0"} ${device} ${coarsePointer.matches ? "1" : "0"}`,
  );
}
/** @type {MediaQueryList | undefined} */
let pixelRatio;
// Moving the window to a screen of another pixel ratio changes no CSS size, so no resize event
// comes. This query matches only the current ratio; it is replaced at each change.
function watchPixelRatio() {
  pixelRatio?.removeEventListener("change", pixelRatioChanged);
  pixelRatio = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  pixelRatio.addEventListener("change", pixelRatioChanged);
}
function pixelRatioChanged() {
  watchPixelRatio();
  syncViewport();
}
watchPixelRatio();
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
      if (/^Error:|stack traceback:/.test(message)) {
        console.error(message);
        fail(ready ? CRASHED : BOOT_FAILED);
      } else console.log(message);
      return;
    }
    if (message === "COLORLESS:ready") {
      markBoot("ready");
      ready = true;
      watchBoot();
      updateLoadingProgress(100);
      loading.style.display = "none";
      void loadTransitionCards();
      if (musicAsked) void loadMusic();
    } else if (message.startsWith("COLORLESS:music:want\t")) {
      askForMusic(message.slice("COLORLESS:music:want\t".length));
      return;
    } else if (message.startsWith("COLORLESS:art-size:")) {
      const [, w, h] = message.match(/^COLORLESS:art-size:(\d+)\t(\d+)$/) || [];
      if (w) setArtSize(Number(w), Number(h));
      return;
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
    if (!ready && message.includes("Unable to create OpenGL window")) fail(UNSUPPORTED);
  },
  onAbort: () => {
    fail(ready ? CRASHED : BOOT_FAILED);
  },
  // game.js asks for the package here (build.mjs patches its loader). The gzip copy is about a
  // third smaller and the host counts its bytes into the bar; the plain package is the fallback.
  fetchPackage: (url, receive) => {
    fetchPackage(url).then(
      (bytes) => {
        markBoot("data-loaded");
        receive(bytes);
      },
      (error) => {
        console.error(error);
        fail(DOWNLOAD_FAILED);
      },
    );
  },
};
globalThis.Module = loveModule;
// A page being left aborts its downloads (Firefox reports a NetworkError); the plain package
// is then not worth starting.
let leaving = false;
window.addEventListener("pagehide", () => {
  leaving = true;
});
/** @param {string} url */
async function fetchPackage(url) {
  if (typeof DecompressionStream === "function") {
    try {
      const response = await fetch(loveModule.locateFile("game.data.gz"));
      if (!response.ok) throw new Error(`game.data.gz: HTTP ${response.status}`);
      // A server that labels the file with its encoding has the browser decode it already.
      const decoded = response.headers.has("Content-Encoding");
      const body = counted(response, (bytes) =>
        download("data", bytes, decoded ? loveSizes.data : loveSizes.packed),
      );
      if (decoded || !body.body) return await body.arrayBuffer();
      return await new Response(
        body.body.pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer();
    } catch (error) {
      if (leaving) return new Promise(() => {});
      console.error("[colorless] packed game data", error);
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`game.data: HTTP ${response.status}`);
  return counted(response, (bytes) => download("data", bytes, loveSizes.data)).arrayBuffer();
}

// SDL alerts when it cannot open its window: before ready, that is the missing-WebGL failure.
const alertNatively = window.alert.bind(window);
window.alert = (message) => {
  if (ready) {
    alertNatively(message);
    return;
  }
  console.error(message);
  fail(/OpenGL|WebGL|EGL/i.test(String(message)) ? UNSUPPORTED : BOOT_FAILED);
};

/** WebGL on a throwaway canvas: the page's own would keep the context it was asked for. */
function hasWebGL() {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") || probe.getContext("webgl");
  if (!gl) return false;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}
// Download and compile the runtime while the page's scripts load. love.js would start only once
// Love() runs on window load, and a <link rel=preload> would hold that load event back and give
// up the streaming compile.
/** @param {AbortSignal | undefined} signal */
async function compileRuntime(signal) {
  const url = loveModule.locateFile("love.wasm");
  const onBytes = (/** @type {number} */ bytes) => download("wasm", bytes, loveSizes.wasm);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`love.wasm: HTTP ${response.status}`);
  try {
    return await WebAssembly.compileStreaming(
      counted(response, onBytes, { "Content-Type": "application/wasm" }),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("[colorless] streaming compile", error);
  }
  const retry = await fetch(url, { signal });
  if (!retry.ok) throw new Error(`love.wasm: HTTP ${retry.status}`);
  return WebAssembly.compile(await counted(retry, onBytes).arrayBuffer());
}
watchBoot();
try {
  if (typeof WebAssembly !== "object") fail(UNSUPPORTED);
  else {
    // The runtime's request goes out before the WebGL probe: a browser's first context can take
    // half a second to create, which would hold back every boot's download. Without WebGL the
    // request is cancelled and nothing else downloads.
    const cancel = typeof AbortController === "function" ? new AbortController() : undefined;
    const compiledRuntime = compileRuntime(cancel?.signal);
    // A runtime that will not download fails the page at once, before the package downloads.
    compiledRuntime.catch((error) => {
      if (failed) return;
      console.error(error);
      fail(DOWNLOAD_FAILED);
    });
    loveModule.instantiateWasm = (imports, receive) => {
      compiledRuntime.then(
        (module) =>
          WebAssembly.instantiate(module, imports)
            .then((instance) => receive(instance, module))
            .catch((error) => {
              console.error(error);
              fail(BOOT_FAILED);
            }),
        () => {},
      );
      return {};
    };
    if (!hasWebGL()) {
      fail(UNSUPPORTED);
      cancel?.abort();
    }
  }
} catch (error) {
  console.error(error);
  fail(BOOT_FAILED);
}
// Boot invariant: Love() starts on window load, after every classic script
// (game package, runtime) and the deferred bridge module have run, so Lua's
// first print finds the bridge connected. A bridge that failed to run would
// leave every screen dead, so show the failure overlay instead of starting.
addEventListener("load", () => {
  if (failed || typeof Love !== "function") return;
  if (!bridge) {
    fail(LOAD_FAILED);
    return;
  }
  markBoot("love-start");
  try {
    Love(loveModule)
      .then(() => {
        // A package served from the loader's IndexedDB cache reports no download progress.
        markBoot("data-loaded");
        updateLoadingProgress(95);
        void prepareTransitionArt();
      })
      .catch((error) => {
        console.error(error);
        fail(LOAD_FAILED);
      });
  } catch (error) {
    console.error(error);
    fail(LOAD_FAILED);
  }
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
// A context lost in a background tab (the GPU process reclaimed it) comes back with a reload
// once the tab is shown again, at most once a minute so a failing GPU cannot loop.
const CONTEXT_RELOAD_KEY = "colorless.host.contextReload";
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  fail(GRAPHICS_LOST);
  if (!document.hidden) return;
  const shown = () => {
    if (document.hidden) return;
    document.removeEventListener("visibilitychange", shown);
    try {
      if (Date.now() - Number(sessionStorage.getItem(CONTEXT_RELOAD_KEY) ?? 0) < 60000) return;
      sessionStorage.setItem(CONTEXT_RELOAD_KEY, String(Date.now()));
    } catch {
      return;
    }
    location.reload();
  };
  document.addEventListener("visibilitychange", shown);
});

// Resource load errors don't bubble; listen in the capture phase.
addEventListener(
  "error",
  (event) => {
    if (event.target instanceof HTMLScriptElement) fail(DOWNLOAD_FAILED);
  },
  true,
);

// ---- the menu music ----
// Lua asks for the music only when the player would hear it (main.lua askForMusic), so a muted
// player or one whose volume is at zero never downloads its 2.9 MB. Lua's 'start' ask downloads
// after ready, and not at all under Save-Data; a 'change' is the player unmuting or turning a
// volume up, which downloads at once whatever the connection.
let musicAsked = false;
/** @type {"idle" | "loading" | "done"} */
let music = "idle";
/** @param {string} reason */
function askForMusic(reason) {
  if (reason !== "change" && navigator.connection?.saveData === true) return;
  musicAsked = true;
  if (ready) void loadMusic();
}
// Lua starts the menu music once this file appears (main.lua's MUSIC).
async function loadMusic() {
  if (music !== "idle") return;
  music = "loading";
  try {
    const response = await fetch(loveModule.locateFile("music1.ogg"));
    if (!response.ok) throw new Error(`music ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    runtime?.FS_createDataFile("/assets/sounds", "music1.ogg", bytes, true, false);
    music = "done";
  } catch (error) {
    // A later ask tries again.
    music = "idle";
    console.error("[colorless] load music", error);
  }
}

// ---- the transition scans ----
// The screen wipe's eight fallback scans download after ready instead of inside game.data, each
// under its content hash like music1.ogg. Lua's fallback lists only the scans written so far
// (ui/transition_art.lua), and a wipe before the first arrives burns the card face down, so a
// slow first visit never waits for them.
const TRANSITION_CARDS = "transition_cards";
async function loadTransitionCards() {
  const running = runtime;
  const names = Object.keys(loveVersions).filter((name) => name.startsWith(`${TRANSITION_CARDS}/`));
  if (!running || names.length === 0) return;
  // The package holds no scan, so their folder is made here.
  running.FS_createPath("/assets", TRANSITION_CARDS, true, true);
  await Promise.all(
    names.map(async (name) => {
      try {
        const response = await fetch(loveModule.locateFile(name));
        if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        running.FS_createDataFile(
          `/assets/${TRANSITION_CARDS}`,
          name.slice(TRANSITION_CARDS.length + 1),
          bytes,
          true,
          false,
        );
      } catch (error) {
        console.error("[colorless] load transition card", error);
      }
    }),
  );
}

/** @type {Map<string, string>} */
const artCache = new Map();
/** @type {Set<string>} */
const artPending = new Set();
/** @type {Map<string, number>} */
const artFailed = new Map();
/** Staged scans at an older size, still shown until their replacement is staged. @type {Set<string>} */
const artStale = new Set();
// The scan raster Lua asks for (Card.scanSize, from Settings' Card Quality); Performance's
// 272×374 until Lua says otherwise.
const DEFAULT_ART_SIZE = "272x374";
let artWidth = 272,
  artHeight = 374;
/** @param {number} w @param {number} h */
function setArtSize(w, h) {
  if (w === artWidth && h === artHeight) return;
  artWidth = w;
  artHeight = h;
  for (const id of artCache.keys()) artStale.add(id);
  artFailed.clear();
  pumpArt();
}
/** The artwork cache key of a card's scan at the current size; Performance's keeps the bare id.
 * @param {string} id */
function artKey(id) {
  const size = `${artWidth}x${artHeight}`;
  return size === DEFAULT_ART_SIZE ? id : `${id}@${size}`;
}
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
  const width = artWidth,
    height = artHeight,
    key = artKey(card.id);
  try {
    const cache = bridge?.artwork;
    let blob = await cache?.get(key);
    if (!blob) {
      const response = await fetch(card.url);
      if (!response.ok) throw Error("art");
      const bitmap = await createImageBitmap(await response.blob());
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      c.getContext("2d")?.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
      if (blob && cache) void cache.put(key, blob).then(() => prepareTransitionArt());
    }
    const running = runtime;
    if (!running || !blob) throw Error("art");
    const path = `__card_art_${++artSerial}.png`;
    running.FS_createDataFile("/", path, new Uint8Array(await blob.arrayBuffer()), true, true);
    const replaced = artCache.get(card.id);
    if (replaced !== undefined) running.FS_unlink(`/${replaced}`);
    artCache.delete(card.id);
    artCache.set(card.id, path);
    if (width === artWidth && height === artHeight) artStale.delete(card.id);
    else artStale.add(card.id);
    for (const [id, old] of artCache) {
      if (artCache.size <= (bridge?.artSlots ?? artCache.size)) break;
      running.FS_unlink(`/${old}`);
      artCache.delete(id);
      artStale.delete(id);
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
      (!artCache.has(card.id) || artStale.has(card.id)) &&
      !artPending.has(card.id) &&
      Date.now() - (artFailed.get(card.id) || 0) > 30000
    )
      void loadArt(card);
  }
}
