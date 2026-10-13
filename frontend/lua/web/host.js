/* The host only boots WASM, bridges navigation/preferences, and exposes accessible links. */
const canvas = document.getElementById("canvas");
const statusElement = document.getElementById("status");
let runtime;
let ready = false;
let mailboxCreated = false;
let preferencesMailboxCreated = false;
let settingsRequest = 0;
let settingsTab = 1;
let settingsOpen = false;
let accountReady = false;
let accountRefreshPending = false;
let accountSnapshot = "";
const mailboxFiles = new Set();
function writeMailbox(name, text) {
  if (!runtime) return;
  if (mailboxFiles.has(name)) runtime.FS_unlink(`/${name}`);
  runtime.FS_createDataFile("/", name, text, true, true);
  mailboxFiles.add(name);
}
document.addEventListener("luminous:account-state", (event) => {
  accountSnapshot = event.detail;
  writeMailbox("__account.txt", accountSnapshot);
  if (accountSnapshot.split("\t")[1] !== "authenticated") finishName(true);
  if (accountSnapshot.split("\t")[1] === "authenticated") clearAuthInputs();
});
document.addEventListener("luminous:account-ready", () => {
  accountReady = true;
  if (accountRefreshPending) accountCommand("refresh");
});
function accountCommand(command) {
  if (!accountReady) {
    accountRefreshPending = true;
    return;
  }
  accountRefreshPending = false;
  document.dispatchEvent(new CustomEvent("luminous:account-command", { detail: command }));
}
// A native text-input proxy gives the Lua field IME, paste, selection and a
// mobile keyboard. The visible field and caret are drawn in the Lua canvas.
const nameInput = document.createElement("input");
nameInput.className = "sr-only";
nameInput.setAttribute("aria-label", "Display name");
nameInput.autocomplete = "nickname";
nameInput.maxLength = 64;
nameInput.style.fontSize = "16px";
nameInput.hidden = true;
document.querySelector("main").append(nameInput);
let editingName = false;
let originalName = "";
let inputRevision = 0;
function publishName(action = "input") {
  writeMailbox(
    "__account_input.txt",
    [
      ++inputRevision,
      action,
      nameInput.value,
      nameInput.selectionStart ?? 0,
      nameInput.selectionEnd ?? 0,
    ]
      .map((v) => encodeURIComponent(v))
      .join("\t"),
  );
}
function finishName(cancel = false) {
  if (!editingName) return;
  if (cancel) nameInput.value = originalName;
  publishName("done");
  editingName = false;
  nameInput.hidden = true;
  canvas.focus({ preventScroll: true });
}
nameInput.addEventListener("input", () => publishName());
nameInput.addEventListener("select", () => {
  if (editingName) publishName();
});
nameInput.addEventListener("blur", () => finishName());
// Keep SDL from also handling keys typed into the native input proxy.
for (const type of ["keydown", "keyup", "keypress"]) {
  window.addEventListener(
    type,
    (event) => {
      if (event.target !== nameInput) return;
      event.stopImmediatePropagation();
      if (type === "keyup") publishName();
      if (
        type === "keydown" &&
        !event.isComposing &&
        ["Enter", "Escape", "Tab"].includes(event.key)
      ) {
        event.preventDefault();
        finishName(event.key === "Escape");
      }
    },
    true,
  );
}
const authInputs = {};
let authMode = "login";
let authEditing = "";
let authOriginal = "";
let authRevision = 0;
for (const [key, label, type, maxLength] of [
  ["email", "Email", "text", 254],
  ["password", "Password", "password", 256],
  ["name", "Display name (optional)", "text", 64],
]) {
  const input = document.createElement("input");
  input.className = "sr-only";
  input.type = type;
  input.setAttribute("aria-label", label);
  input.maxLength = maxLength;
  input.style.fontSize = "16px";
  input.autocomplete =
    key === "email" ? "username" : key === "password" ? "current-password" : "nickname";
  input.autocapitalize = key === "name" ? "words" : "none";
  input.spellcheck = false;
  if (key === "email") input.inputMode = "email";
  input.hidden = true;
  document.querySelector("main").append(input);
  authInputs[key] = input;
  input.addEventListener("input", () => publishAuth());
  input.addEventListener("select", () => {
    if (authEditing === key) publishAuth();
  });
  input.addEventListener("blur", () => {
    if (authEditing === key) finishAuthInput();
  });
}
function publishAuth(action = "input", field = authEditing) {
  const input = authInputs[field];
  writeMailbox(
    "__auth_input.txt",
    [
      ++authRevision,
      authEditing,
      authInputs.email.value,
      "*".repeat(authInputs.password.value.length),
      authInputs.name.value,
      input?.selectionStart ?? 0,
      input?.selectionEnd ?? 0,
      action,
      field,
    ]
      .map((v) => encodeURIComponent(v))
      .join("\t"),
  );
}
function finishAuthInput(action = "done", cancel = false) {
  if (!authEditing) return;
  const field = authEditing;
  const input = authInputs[field];
  if (cancel) input.value = authOriginal;
  authEditing = "";
  input.hidden = true;
  publishAuth(action, field);
  canvas.focus({ preventScroll: true });
}
function clearAuthInputs() {
  authEditing = "";
  authOriginal = "";
  for (const input of Object.values(authInputs)) {
    input.value = "";
    input.hidden = true;
  }
  publishAuth("reset");
}
function authCommand(command) {
  const [action, value] = command.split("\t");
  if (action === "open") {
    finishName();
    finishAuthInput();
    authMode = value === "register" ? "register" : "login";
    authInputs.password.value = "";
    authInputs.password.autocomplete =
      authMode === "register" ? "new-password" : "current-password";
    publishAuth("reset");
    accountCommand("clear-message");
    canvas.setAttribute(
      "aria-label",
      `${authMode === "register" ? "Create account" : "Sign in"}. Tab between controls. Enter edits or activates. Escape returns to Settings.`,
    );
  } else if (action === "edit" && Object.hasOwn(authInputs, value)) {
    finishAuthInput();
    authEditing = value;
    const input = authInputs[value];
    authOriginal = input.value;
    input.hidden = false;
    input.focus({ preventScroll: true });
    input.select();
    publishAuth();
  } else if (action === "submit") {
    finishAuthInput();
    document.dispatchEvent(
      new CustomEvent("luminous:authenticate", {
        detail: {
          mode: authMode,
          email: authInputs.email.value,
          password: authInputs.password.value,
          name: authInputs.name.value,
        },
      }),
    );
  } else if (action === "google") {
    finishAuthInput();
    accountCommand("google");
  } else if (action === "close") {
    clearAuthInputs();
    canvas.focus({ preventScroll: true });
    canvas.setAttribute(
      "aria-label",
      "Settings. Tab between controls. Arrow keys adjust values. Escape closes.",
    );
  }
}
for (const type of ["keydown", "keyup", "keypress"]) {
  window.addEventListener(
    type,
    (event) => {
      if (!Object.values(authInputs).includes(event.target)) return;
      event.stopImmediatePropagation();
      if (type === "keyup" && authEditing) publishAuth();
      if (
        type === "keydown" &&
        !event.isComposing &&
        ["Enter", "Escape", "Tab"].includes(event.key)
      ) {
        event.preventDefault();
        const action =
          event.key === "Enter"
            ? "enter"
            : event.key === "Tab"
              ? event.shiftKey
                ? "previous"
                : "next"
              : "done";
        finishAuthInput(action, event.key === "Escape");
      }
    },
    true,
  );
}
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
  const text = `${Math.max(1, Math.round(innerWidth * scale))} ${Math.max(1, Math.round(innerHeight * scale))} ${motion.matches ? "1" : "0"} ${preferences.muted} ${settingsRequest} ${settingsTab}`;
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
    } else if (message.startsWith("LUMINOUS:auth:")) {
      authCommand(message.slice("LUMINOUS:auth:".length));
    } else if (message.startsWith("LUMINOUS:account:")) {
      const command = message.slice("LUMINOUS:account:".length);
      if (command.startsWith("edit\t")) {
        originalName = decodeURIComponent(command.slice(5));
        nameInput.value = originalName;
        nameInput.hidden = false;
        editingName = true;
        nameInput.focus({ preventScroll: true });
        nameInput.select();
        publishName();
      } else if (command === "finish-edit") finishName();
      else accountCommand(command);
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
      if (!settingsOpen) {
        finishName();
        clearAuthInputs();
      }
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
      if (accountSnapshot) writeMailbox("__account.txt", accountSnapshot);
      if (new URLSearchParams(location.search).has("account")) {
        settingsRequest++;
        settingsTab = 4;
      }
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
  settingsTab = 1;
  syncViewport(runtime);
  canvas.focus({ preventScroll: true });
});
document.getElementById("account-link").addEventListener("click", (event) => {
  if (!ready || !runtime) return;
  event.preventDefault();
  settingsRequest++;
  settingsTab = 4;
  syncViewport(runtime);
  canvas.focus({ preventScroll: true });
});

addEventListener("error", (event) => {
  if (event.target instanceof HTMLScriptElement)
    fail("Could not download the menu. Reload to try again.");
});
