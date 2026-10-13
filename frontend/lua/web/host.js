/* The host only boots WASM, bridges navigation/preferences, and exposes accessible links. */
const canvas = document.getElementById("canvas");
const statusElement = document.getElementById("status");
let runtime;
let ready = false;
let mailboxCreated = false;
let preferencesMailboxCreated = false;
let settingsRequest = 0;
let settingsOpen = false;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const preferenceDefaults = {
  screenshake: 50,
  reducedMotion: -1,
  crt: 70,
  bloom: 0,
  volume: 50,
  musicVolume: 100,
  effectsVolume: 100,
  muted: 0,
};
const preferenceKeys = Object.keys(preferenceDefaults);
const preferenceRanges = { reducedMotion: [-1, 1], bloom: [0, 1], muted: [0, 1] };
let preferences = { ...preferenceDefaults };
function validatedPreferences(value) {
  const result = { ...preferenceDefaults };
  for (const key of preferenceKeys) {
    const number = value?.[key];
    if (typeof number !== "number" || !Number.isFinite(number)) continue;
    const [min, max] = preferenceRanges[key] || [0, 100];
    result[key] = Math.max(min, Math.min(max, Math.round(number)));
  }
  return result;
}
try {
  const stored = JSON.parse(localStorage.getItem("luminous.lua.preferences") || "null");
  if (stored?.version === 1) preferences = validatedPreferences(stored);
  else preferences.muted = localStorage.getItem("luminous.lua.muted") === "1" ? 1 : 0;
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
  const text = `${Math.max(1, Math.round(innerWidth * scale))} ${Math.max(1, Math.round(innerHeight * scale))} ${motion.matches ? "1" : "0"} ${preferences.muted} ${settingsRequest}`;
  if (mailboxCreated) module.FS_unlink("/__viewport.txt");
  module.FS_createDataFile("/", "__viewport.txt", text, true, true);
  mailboxCreated = true;
  if (preferencesMailboxCreated) module.FS_unlink("/__preferences.txt");
  module.FS_createDataFile(
    "/",
    "__preferences.txt",
    preferenceKeys.map((key) => preferences[key]).join(" "),
    true,
    true,
  );
  preferencesMailboxCreated = true;
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
    } else if (message.startsWith("LUMINOUS:preferences:")) {
      const values = message.slice("LUMINOUS:preferences:".length).split(" ").map(Number);
      if (values.length !== preferenceKeys.length || !values.every(Number.isFinite)) return;
      preferences = validatedPreferences(
        Object.fromEntries(preferenceKeys.map((key, i) => [key, values[i]])),
      );
      try {
        localStorage.setItem(
          "luminous.lua.preferences",
          JSON.stringify({ version: 1, ...preferences }),
        );
        localStorage.setItem("luminous.lua.muted", String(preferences.muted));
      } catch (_) {}
    } else if (message === "LUMINOUS:settings:open" || message === "LUMINOUS:settings:closed") {
      settingsOpen = message.endsWith(":open");
      document.querySelector(".accessible-menu").inert = settingsOpen;
      document.getElementById("settings-link").setAttribute("aria-expanded", String(settingsOpen));
      if (settingsOpen) {
        canvas.setAttribute("role", "dialog");
        canvas.setAttribute("aria-modal", "true");
        canvas.setAttribute(
          "aria-label",
          "Settings. Tab between controls. Arrow keys adjust values. Escape closes.",
        );
      } else {
        canvas.removeAttribute("role");
        canvas.removeAttribute("aria-modal");
        canvas.setAttribute(
          "aria-label",
          "Luminous main menu. Use Tab or arrow keys to choose; Enter to open. M toggles sound.",
        );
      }
      canvas.focus({ preventScroll: true });
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
  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code) ||
    (settingsOpen && ["Tab", "Home", "End", "Escape"].includes(event.code))
  )
    event.preventDefault();
});
document.getElementById("settings-link").addEventListener("click", (event) => {
  if (!ready || !runtime) return;
  event.preventDefault();
  settingsRequest++;
  syncViewport(runtime);
  canvas.focus({ preventScroll: true });
});

addEventListener("error", (event) => {
  if (event.target instanceof HTMLScriptElement)
    fail("Could not download the menu. Reload to try again.");
});
