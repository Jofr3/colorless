/* The host only boots WASM, bridges navigation/preferences, and exposes accessible links. */
const canvas = document.getElementById("canvas");
const statusElement = document.getElementById("status");
let runtime;
let ready = false;
let mailboxCreated = false;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let muted = false;
try {
  muted = localStorage.getItem("luminous.lua.muted") === "1";
} catch (_) {}
const routes = new Set(["/play", "/simulator", "/lobby", "/decks", "/login", "/settings"]);

function fail(message) {
  document.body.classList.add("failed");
  document.getElementById("loading").style.display = "flex";
  statusElement.textContent = message;
}
function syncViewport(module) {
  if (!module || !module.FS_createDataFile) return;
  // Cap the backing resolution; no high-DPI multiplication for the pixel-art renderer.
  const scale = Math.min(1, 1600 / innerWidth, 1200 / innerHeight);
  const text = `${Math.max(1, Math.round(innerWidth * scale))} ${Math.max(1, Math.round(innerHeight * scale))} ${motion.matches ? "1" : "0"} ${muted ? "1" : "0"}`;
  if (mailboxCreated) module.FS_unlink("/__viewport.txt");
  module.FS_createDataFile("/", "__viewport.txt", text, true, true);
  mailboxCreated = true;
}
globalThis.Module = {
  arguments: ["./"],
  INITIAL_MEMORY: 134217728,
  canvas: canvas,
  preRun: [
    (module) => {
      syncViewport(module);
    },
  ],
  print: (message) => {
    if (message === "LUMINOUS:ready") {
      ready = true;
      document.getElementById("loading").style.display = "none";
      document.title = "Luminous — Home";
      canvas.focus({ preventScroll: true });
    } else if (message.startsWith("LUMINOUS:navigate:")) {
      const route = message.slice("LUMINOUS:navigate:".length);
      if (routes.has(route)) location.assign(route);
    } else if (message.startsWith("LUMINOUS:announce:")) {
      document.getElementById("announcement").textContent = message.slice(
        "LUMINOUS:announce:".length,
      );
    } else if (message.startsWith("LUMINOUS:mute:")) {
      muted = message.endsWith("1");
      try {
        localStorage.setItem("luminous.lua.muted", muted ? "1" : "0");
      } catch (_) {}
    } else {
      console.log(message);
      if (/^Error:|stack traceback:/.test(message))
        fail("The menu could not start. Reload to try again, or use the menu links.");
    }
  },
  printErr: (message) => {
    console.error(message);
  },
  setStatus: (message) => {
    if (!ready && message) statusElement.textContent = message;
  },
  onAbort: () => {
    fail("The menu could not start. Reload to try again, or use the menu links.");
  },
};
globalThis.startLuminous = () => {
  Love(Module)
    .then((module) => {
      runtime = module;
      syncViewport(runtime);
    })
    .catch((error) => {
      console.error(error);
      fail("Could not load the menu. Reload to try again.");
    });
};
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    syncViewport(runtime);
  }, 100);
});
motion.addEventListener("change", () => {
  syncViewport(runtime);
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
// Tab remains available to native accessible links; arrows navigate inside the canvas.
canvas.addEventListener("keydown", (event) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code))
    event.preventDefault();
});

addEventListener("error", (event) => {
  if (event.target instanceof HTMLScriptElement)
    fail("Could not download the menu. Reload to try again.");
});
