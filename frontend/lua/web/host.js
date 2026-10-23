/* The host only boots WASM, bridges navigation/preferences, and exposes accessible links. */
const canvas = document.getElementById("canvas");
const statusElement = document.getElementById("status");
const loadingProgress = document.getElementById("loading-progress");
const loadingFill = document.getElementById("loading-fill");
let loadingValue = 0;
function updateLoadingProgress(value) {
  loadingValue = Math.max(loadingValue, Math.min(100, value));
  loadingFill.style.width = `${loadingValue}%`;
  loadingProgress.setAttribute("aria-valuenow", String(Math.round(loadingValue)));
}
// Preserve browser reload shortcuts before SDL can consume their key events.
for (const type of ["keydown", "keyup", "keypress"]) {
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
let runtime;
let ready = false;
let mailboxCreated = false;
let preferencesMailboxCreated = false;
let settingsRequest = 0;
let settingsTab = 1;
let settingsOpen = false;
let accountReady = false;
const pendingLibraryCommands = [];
const pendingBuilderCommands = [];
const pendingSandboxCommands = [];
const pendingSimulatorCommands = [];
const pendingOnlineCommands = [];
let accountRefreshPending = false;
let accountSnapshot = "";
const mailboxFiles = new Set();
function writeMailbox(name, text) {
  if (!runtime) return;
  if (mailboxFiles.has(name)) runtime.FS_unlink(`/${name}`);
  runtime.FS_createDataFile("/", name, text, true, true);
  mailboxFiles.add(name);
}
document.addEventListener("colorless:account-state", (event) => {
  accountSnapshot = event.detail;
  writeMailbox("__account.txt", accountSnapshot);
  if (accountSnapshot.split("\t")[1] !== "authenticated") finishName(true);
  if (accountSnapshot.split("\t")[1] === "authenticated") clearAuthInputs();
});
document.addEventListener("colorless:account-ready", () => {
  accountReady = true;
  void prepareTransitionArt();
  for (const command of pendingLibraryCommands.splice(0)) libraryCommand(command);
  for (const command of pendingBuilderCommands.splice(0)) builderCommand(command);
  for (const command of pendingSandboxCommands.splice(0)) sandboxCommand(command);
  for (const command of pendingSimulatorCommands.splice(0)) simulatorCommand(command);
  for (const command of pendingOnlineCommands.splice(0)) onlineCommand(command);
  if (accountRefreshPending) accountCommand("refresh");
});
function accountCommand(command) {
  if (!accountReady) {
    accountRefreshPending = true;
    return;
  }
  accountRefreshPending = false;
  document.dispatchEvent(new CustomEvent("colorless:account-command", { detail: command }));
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
      new CustomEvent("colorless:authenticate", {
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
  const stored = JSON.parse(localStorage.getItem("colorless.lua.preferences") || "null");
  if (stored?.version === 1) preferences = validatedPreferences(stored);
  else preferences.muted = localStorage.getItem("colorless.lua.muted") === "1" ? 1 : 0;
} catch (_) {}

function fail(message) {
  document.body.classList.add("failed");
  document.getElementById("loading").style.display = "flex";
  statusElement.textContent = message;
}
function syncViewport(module) {
  if (!module || !module.FS_createDataFile) return;
  // SDL sizes the drawable to the browser viewport. Lua's scene and CRT pass
  // must use that same size; a capped scene leaves the rest of it black.
  // Keep CSS-pixel dimensions (no devicePixelRatio multiplier).
  const text = `${Math.max(1, Math.round(innerWidth))} ${Math.max(1, Math.round(innerHeight))} ${motion.matches ? "1" : "0"} ${preferences.muted} ${settingsRequest} ${settingsTab}`;
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
// build:lua replaces the empty object with each /love/ file's content hash;
// the `?v=` it adds changes the URL whenever the bytes do, which is what lets
// the deployed /love/ files be cached as immutable (public/_headers).
const loveVersions = /* love-versions */ {};
globalThis.Module = {
  arguments: ["./"],
  // build:lua emits the runtime and game package under /love/ (public/love/).
  locateFile: (path) => `/love/${path}${loveVersions[path] ? `?v=${loveVersions[path]}` : ""}`,
  INITIAL_MEMORY: 134217728,
  canvas: canvas,
  preRun: [
    (module) => {
      syncViewport(module);
    },
  ],
  print: (message) => {
    if (message === "COLORLESS:ready") {
      updateLoadingProgress(100);
      ready = true;
      document.getElementById("loading").style.display = "none";
      document.title = pageTitle();
      canvas.focus({ preventScroll: true });
    } else if (message.startsWith("COLORLESS:transition-art:")) {
      const [, action, token] =
        message.match(/^COLORLESS:transition-art:(used|invalid):(\d+)$/) || [];
      if (token) void consumeTransitionArt(Number(token), action === "invalid");
    } else if (message.startsWith("COLORLESS:transition:")) {
      transitionOpen = message.endsWith(":open");
      syncModalAccessibility();
    } else if (message.startsWith("COLORLESS:page:")) {
      setPage(message.slice("COLORLESS:page:".length));
    } else if (message.startsWith("COLORLESS:builder:")) {
      builderCommand(message.slice("COLORLESS:builder:".length));
    } else if (message.startsWith("COLORLESS:simulator:")) {
      simulatorCommand(message.slice("COLORLESS:simulator:".length));
    } else if (message.startsWith("COLORLESS:online:")) {
      onlineCommand(message.slice("COLORLESS:online:".length));
    } else if (message.startsWith("COLORLESS:sandbox:")) {
      sandboxCommand(message.slice("COLORLESS:sandbox:".length));
    } else if (message.startsWith("COLORLESS:library:")) {
      libraryCommand(message.slice("COLORLESS:library:".length));
    } else if (message.startsWith("COLORLESS:auth:")) {
      authCommand(message.slice("COLORLESS:auth:".length));
    } else if (message.startsWith("COLORLESS:account:")) {
      const command = message.slice("COLORLESS:account:".length);
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
    } else if (message.startsWith("COLORLESS:announce:")) {
      document.getElementById("announcement").textContent = message.slice(
        "COLORLESS:announce:".length,
      );
    } else if (message.startsWith("COLORLESS:preferences:")) {
      const values = message.slice("COLORLESS:preferences:".length).split(" ").map(Number);
      if (values.length !== preferenceKeys.length || !values.every(Number.isFinite)) return;
      preferences = validatedPreferences(
        Object.fromEntries(preferenceKeys.map((key, i) => [key, values[i]])),
      );
      try {
        localStorage.setItem(
          "colorless.lua.preferences",
          JSON.stringify({ version: 1, ...preferences }),
        );
        localStorage.setItem("colorless.lua.muted", String(preferences.muted));
      } catch (_) {}
    } else if (message === "COLORLESS:settings:open" || message === "COLORLESS:settings:closed") {
      settingsOpen = message.endsWith(":open");
      if (!settingsOpen) {
        finishName();
        clearAuthInputs();
      }
      document.querySelector(".accessible-menu").inert = settingsOpen || libraryPage;
      document.getElementById("settings-link").setAttribute("aria-expanded", String(settingsOpen));
      if (settingsOpen) {
        finishLibraryInput();
        canvas.setAttribute("role", "dialog");
        canvas.setAttribute("aria-modal", "true");
        canvas.setAttribute(
          "aria-label",
          "Settings. Tab between controls. Arrow keys adjust values. Escape closes.",
        );
      } else {
        syncModalAccessibility();
        canvas.setAttribute("aria-label", canvasLabel());
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
// Every classic script (game package, runtime) has run by the window load event.
addEventListener("load", () => {
  if (typeof Love !== "function") return;
  Love(Module)
    .then((module) => {
      runtime = module;
      updateLoadingProgress(95);
      void prepareTransitionArt();
      syncPage();
      if (accountSnapshot) writeMailbox("__account.txt", accountSnapshot);
      // ?account and ?settings open the settings popup on the matching tab.
      const params = new URLSearchParams(location.search);
      if (params.has("account") || params.has("settings")) {
        settingsRequest++;
        settingsTab = params.has("account") ? 4 : 1;
      }
      syncViewport(runtime);
    })
    .catch((error) => {
      console.error(error);
      fail("Could not load the menu. Reload to try again.");
    });
});
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
    ((settingsOpen || libraryPage) &&
      ["Tab", "Home", "End", "Escape", "PageUp", "PageDown"].includes(event.code))
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

// Resource load errors don't bubble; listen in the capture phase.
addEventListener(
  "error",
  (event) => {
    if (event.target instanceof HTMLScriptElement)
      fail("Could not download the menu. Reload to try again.");
  },
  true,
);

// Library transport: Lua owns the page; the browser supplies text input and API I/O.
// Pages live in the path: /decks, /decks/<id> (builder), /sandbox, /sandbox/play
// (simulator), /online, /online/<code> and /online/<code>/play (match). Old
// query URLs (/?page=decks, /?lobby=CODE), /simulator, /match/<code> and
// React's /lobby/<code> still resolve and are rewritten.
const pages = ["decks", "builder", "sandbox", "simulator", "online", "match"];
const pageIds = { builder: "deck", online: "lobby", match: "lobby" };
function routeFromLocation() {
  const params = new URLSearchParams(location.search);
  const legacy = params.get("page") || (params.has("lobby") ? "online" : "");
  if (legacy) return { page: legacy, id: params.get(pageIds[legacy] || "deck") || "" };
  const [first = "", second = "", third = ""] = location.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  if (first === "decks" && second) return { page: "builder", id: second };
  if (first === "sandbox" && second === "play") return { page: "simulator", id: "" };
  if (first === "online" && second && third === "play") return { page: "match", id: second };
  if (first === "lobby") return { page: "online", id: second };
  return { page: pages.includes(first) && first !== "builder" ? first : "home", id: second };
}
function routePath(page, id) {
  if (page === "home") return "/";
  if (page === "builder") return `/decks/${encodeURIComponent(id)}`;
  if (page === "simulator") return "/sandbox/play";
  if (page === "match") return `/online/${encodeURIComponent(id)}/play`;
  return id ? `/${page}/${encodeURIComponent(id)}` : `/${page}`;
}
function routeUrl(page, id) {
  const url = new URL(location.href);
  url.pathname = routePath(page, id);
  // Only rewrite the query when a legacy parameter is present, so ?settings keeps its form.
  const legacy = ["page", ...Object.values(pageIds)].filter((param) => url.searchParams.has(param));
  for (const param of legacy) url.searchParams.delete(param);
  return url;
}
let { page: currentPage, id: pageId } = routeFromLocation();
if (!pages.includes(currentPage)) currentPage = "home";
if (!pageIds[currentPage]) pageId = "";
let libraryPage = currentPage !== "home";
history.replaceState(null, "", routeUrl(currentPage, pageId));
let pageRevision = 0;
let transitionOpen = false;
function syncModalAccessibility() {
  document.querySelector(".accessible-menu").inert = settingsOpen || libraryPage || transitionOpen;
  canvas.setAttribute("aria-busy", String(transitionOpen));
  if (settingsOpen || (libraryPage && currentPage !== "simulator" && currentPage !== "match")) {
    canvas.setAttribute("role", "dialog");
    canvas.setAttribute("aria-modal", "true");
  } else {
    canvas.removeAttribute("role");
    canvas.removeAttribute("aria-modal");
  }
}
function pageTitle() {
  return `Colorless — ${currentPage === "simulator" ? "Simulator" : currentPage === "match" ? "Online match" : currentPage === "sandbox" ? "Sandbox" : currentPage === "builder" ? "Deck builder" : currentPage === "online" ? "Online" : libraryPage ? "Decks" : "Home"}`;
}
function canvasLabel() {
  return currentPage === "simulator"
    ? "Sandbox game table. Drag cards to play. Tab selects controls and cards; Enter activates. Escape opens options."
    : currentPage === "match"
      ? "Online game table. Drag cards to play. Tab selects controls and cards; Enter activates. Escape opens options."
      : currentPage === "sandbox"
        ? "Sandbox deck selection. Tab or arrows choose controls. Enter selects a deck or activates a button. Escape returns home."
        : currentPage === "online"
          ? "Online lobby. Tab or arrows choose controls; left and right switch tabs. Enter activates. Escape goes back."
          : libraryPage
            ? "Deck library. Tab or arrows choose controls and cards. Enter opens. Escape returns home."
            : "Colorless main menu. Use Tab or arrow keys to choose; Enter to open. M toggles sound.";
}
function syncPage() {
  syncModalAccessibility();
  writeMailbox(
    "__page.txt",
    [++pageRevision, currentPage, pageId].map(encodeURIComponent).join("\t"),
  );
  document.title = pageTitle();
  canvas.setAttribute("aria-label", canvasLabel());
}
function setPage(page, push = true, id = "", saved = false) {
  if (currentPage === "builder" && !saved && (page !== currentPage || id !== pageId)) {
    finishBuilderInput();
    history.replaceState(null, "", routeUrl("builder", pageId));
    document.dispatchEvent(
      new CustomEvent("colorless:builder-leave", { detail: () => setPage(page, push, id, true) }),
    );
    return;
  }
  finishLibraryInput();
  finishBuilderInput();
  currentPage = pages.includes(page) ? page : "home";
  pageId = pageIds[currentPage] ? id : "";
  libraryPage = currentPage !== "home";
  const url = routeUrl(currentPage, pageId);
  url.searchParams.delete("account");
  url.searchParams.delete("settings");
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  syncPage();
}
addEventListener("popstate", () => {
  const { page, id } = routeFromLocation();
  setPage(page, false, id);
});
document.getElementById("decks-link").addEventListener("click", (event) => {
  if (!ready) return;
  event.preventDefault();
  setPage("decks");
  canvas.focus({ preventScroll: true });
});
document.getElementById("online-link").addEventListener("click", (event) => {
  if (!ready) return;
  event.preventDefault();
  setPage("online");
  canvas.focus({ preventScroll: true });
});
document.addEventListener("colorless:library-state", (event) =>
  writeMailbox("__library.txt", event.detail),
);
function libraryCommand(command, owner = "library") {
  if (!accountReady) {
    pendingLibraryCommands.push(command);
    return;
  }
  const [action, field, value] = command.split("\t").map(decodeURIComponent);
  if (action === "input") {
    finishLibraryInput();
    libraryInputOwner = owner;
    libraryField = field;
    const code = owner === "online" && field === "code";
    // The code field caps itself in normalizeCode, so a pasted link or "AB-CD" survives.
    libraryInput.maxLength = 100;
    libraryInput.inputMode = "text";
    if (code) {
      libraryInput.autocapitalize = "characters";
      libraryInput.spellcheck = false;
    } else {
      libraryInput.removeAttribute("autocapitalize");
      libraryInput.removeAttribute("spellcheck");
    }
    libraryInput.value = value || "";
    libraryOriginal = libraryInput.value;
    libraryInput.setAttribute(
      "aria-label",
      code ? "Lobby code" : field === "search" ? "Search decks" : "Deck name",
    );
    libraryInput.hidden = false;
    libraryInput.focus({ preventScroll: true });
    // A code typed before the field opened keeps its caret at the end.
    if (code) libraryInput.setSelectionRange(libraryInput.value.length, libraryInput.value.length);
    else libraryInput.select();
    publishLibraryInput();
  } else if (action === "finish-input") finishLibraryInput();
  else document.dispatchEvent(new CustomEvent("colorless:library-command", { detail: command }));
}
const libraryInput = document.createElement("input");
libraryInput.className = "sr-only";
libraryInput.maxLength = 100;
libraryInput.autocomplete = "off";
libraryInput.style.fontSize = "16px";
libraryInput.hidden = true;
document.querySelector("main").append(libraryInput);
let libraryInputOwner = "library";
let libraryField = "";
let libraryOriginal = "";
let libraryInputRevision = 0;
function publishLibraryInput(action = "input", field = libraryField) {
  writeMailbox(
    `__${libraryInputOwner}_input.txt`,
    [
      ++libraryInputRevision,
      field,
      libraryInput.value,
      libraryInput.selectionStart || 0,
      libraryInput.selectionEnd || 0,
      action,
    ]
      .map(encodeURIComponent)
      .join("\t"),
  );
}
function finishLibraryInput(action = "done", cancel = false) {
  if (!libraryField) return;
  const field = libraryField;
  if (cancel) libraryInput.value = libraryOriginal;
  libraryField = "";
  libraryInput.hidden = true;
  publishLibraryInput(action, field);
  canvas.focus({ preventScroll: true });
}
// Lobby codes use normalizeLobbyCode's alphabet: upper-case, no look-alikes.
const lobbyAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const normalizeCode = (value) =>
  [...value.toUpperCase()]
    .filter((c) => lobbyAlphabet.includes(c))
    .join("")
    .slice(0, 4);
libraryInput.addEventListener("input", () => {
  if (libraryInputOwner === "online" && libraryField === "code") {
    // A pasted invite link (/online/CODE, or an old /?lobby=CODE) yields its code.
    const link = /(?:[?&]lobby=|\/(?:online|lobby|match)\/)([^&#?/\s]+)/i.exec(libraryInput.value);
    const value = normalizeCode(link ? link[1] : libraryInput.value);
    const caret = link
      ? value.length
      : normalizeCode(libraryInput.value.slice(0, libraryInput.selectionStart || 0)).length;
    libraryInput.value = value;
    libraryInput.setSelectionRange(caret, caret);
  }
  publishLibraryInput();
});
libraryInput.addEventListener("select", () => {
  if (libraryField) publishLibraryInput();
});
libraryInput.addEventListener("blur", () => finishLibraryInput());
for (const type of ["keydown", "keyup", "keypress"])
  window.addEventListener(
    type,
    (event) => {
      if (event.target !== libraryInput) return;
      event.stopImmediatePropagation();
      if (type === "keyup" && libraryField) publishLibraryInput();
      if (
        type === "keydown" &&
        !event.isComposing &&
        ["Enter", "Escape", "Tab"].includes(event.key)
      ) {
        event.preventDefault();
        finishLibraryInput(event.key === "Enter" ? "enter" : "done", event.key === "Escape");
      }
    },
    true,
  );

// Deck builder: browser-native text/clipboard and artwork transport only.
document.addEventListener("colorless:route", (e) =>
  setPage(e.detail.page, !e.detail.replace, e.detail.id || ""),
);
document.addEventListener("colorless:builder-state", (e) => {
  writeMailbox("__builder.txt", e.detail);
  if (currentPage === "builder") {
    const f = e.detail.split("\n")[0].split("\t").map(decodeURIComponent);
    document.title = `Colorless — ${f[2] || "Deck builder"}`;
    canvas.setAttribute(
      "aria-label",
      `Deck builder. ${f[2]}. ${f[10]} cards. Tab selects controls. Enter inspects a card. Drag a card into your deck or use Add in its dialog.`,
    );
  }
});
const builderInput = document.createElement("textarea");
builderInput.className = "sr-only";
builderInput.hidden = true;
builderInput.style.fontSize = "16px";
document.querySelector("main").append(builderInput);
let builderField = "",
  builderOriginal = "",
  builderInputRevision = 0;
function publishBuilderInput(action = "input", field = builderField) {
  writeMailbox(
    "__builder_input.txt",
    [
      ++builderInputRevision,
      field,
      builderInput.value,
      builderInput.selectionStart,
      builderInput.selectionEnd,
      action,
    ]
      .map(encodeURIComponent)
      .join("\t"),
  );
  if (field !== "transfer") builderInput.value = builderInput.value.replace(/[\r\n]/g, " ");
  if (field === "name") dispatchBuilder("name", builderInput.value);
  else if (field === "optionQuery") dispatchBuilder("option-query", builderInput.value);
  else if (field !== "transfer") dispatchBuilder("filter", field, builderInput.value);
}
function dispatchBuilder(...args) {
  document.dispatchEvent(
    new CustomEvent("colorless:builder-command", {
      detail: args.map(encodeURIComponent).join("\t"),
    }),
  );
}
function finishBuilderInput(cancel = false) {
  if (!builderField) return;
  const field = builderField;
  builderField = "";
  if (cancel) builderInput.value = builderOriginal;
  publishBuilderInput("done", field);
  builderInput.hidden = true;
  canvas.focus({ preventScroll: true });
}
function builderCommand(command) {
  if (!accountReady) {
    pendingBuilderCommands.push(command);
    return;
  }
  const [action, field, value] = command.split("\t").map(decodeURIComponent);
  if (action === "input") {
    finishBuilderInput();
    builderField = field;
    builderInput.value = value || "";
    builderOriginal = builderInput.value;
    builderInput.maxLength = field === "transfer" ? 30000 : field === "name" ? 100 : 300;
    builderInput.setAttribute(
      "aria-label",
      field === "transfer" ? "Decklist. Paste your list here." : field,
    );
    builderInput.hidden = false;
    builderInput.focus({ preventScroll: true });
    builderInput.select();
    publishBuilderInput();
  } else if (action === "finish-input") finishBuilderInput();
  else if (action === "copy") {
    navigator.clipboard.writeText(field).then(
      () => writeMailbox("__builder_clipboard.txt", `${Date.now()}\tCopied decklist.`),
      () =>
        writeMailbox(
          "__builder_clipboard.txt",
          `${Date.now()}\tCopy failed. Select the decklist and use your copy shortcut.`,
        ),
    );
  } else document.dispatchEvent(new CustomEvent("colorless:builder-command", { detail: command }));
}
builderInput.addEventListener("input", () => publishBuilderInput());
builderInput.addEventListener("select", () => {
  if (builderField) publishBuilderInput();
});
builderInput.addEventListener("blur", () => finishBuilderInput());
for (const type of ["keydown", "keyup", "keypress"])
  window.addEventListener(
    type,
    (event) => {
      if (event.target !== builderInput) return;
      event.stopImmediatePropagation();
      if (type === "keyup" && builderField) publishBuilderInput();
      if (
        type === "keydown" &&
        !event.isComposing &&
        (event.key === "Escape" ||
          event.key === "Tab" ||
          (event.key === "Enter" && builderField !== "transfer"))
      ) {
        event.preventDefault();
        finishBuilderInput(event.key === "Escape");
      }
    },
    true,
  );
const artCache = new Map(),
  artPending = new Set(),
  artFailed = new Map();
let artRevision = 0,
  artSerial = 0,
  artActive = 0,
  wantedArt = [];
function publishArt() {
  writeMailbox(
    "__art.txt",
    [
      ++artRevision,
      ...[...artCache].map(([id, path]) => [id, path].map(encodeURIComponent).join("\t")),
    ].join("\n"),
  );
}
// The full pool stays in IndexedDB. Stage one PNG for the next transition;
// Lua acknowledges it only after retaining the image and border on the GPU.
let transitionArt = null,
  transitionArtSerial = 0,
  transitionPreparing = null,
  transitionConsuming = false;
async function prepareTransitionArt() {
  const cache = window.colorlessArtworkCache;
  if (!runtime || !cache || transitionArt || transitionConsuming) return;
  if (transitionPreparing) return transitionPreparing;
  transitionPreparing = (async () => {
    const selected = await cache.pick();
    if (!selected) return;
    const bytes = new Uint8Array(await selected.blob.arrayBuffer());
    const token = ++transitionArtSerial,
      path = `__transition_art_${token}.png`;
    runtime.FS_createDataFile("/", path, bytes, true, true);
    transitionArt = { token, id: selected.id, path };
    writeMailbox(
      "__transition_art.txt",
      [token, selected.id, path].map(encodeURIComponent).join("\t"),
    );
  })()
    .catch((error) => console.error("[colorless] prepare transition art", error))
    .finally(() => {
      transitionPreparing = null;
    });
  return transitionPreparing;
}
async function consumeTransitionArt(token, invalid) {
  if (!transitionArt || transitionArt.token !== token) return;
  transitionConsuming = true;
  const selected = transitionArt;
  transitionArt = null;
  writeMailbox("__transition_art.txt", "");
  try {
    runtime.FS_unlink(`/${selected.path}`);
  } catch {}
  const cache = window.colorlessArtworkCache;
  try {
    if (invalid) await cache?.remove(selected.id);
    else await cache?.markShown(selected.id);
  } finally {
    transitionConsuming = false;
  }
  await prepareTransitionArt();
}
async function loadArt(card) {
  artActive++;
  artPending.add(card.id);
  try {
    const cache = window.colorlessArtworkCache;
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
      c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
      if (blob && cache) void cache.put(card.id, blob).then(() => prepareTransitionArt());
    }
    if (!runtime || !blob) throw Error("art");
    const path = `__card_art_${++artSerial}.png`;
    runtime.FS_createDataFile("/", path, new Uint8Array(await blob.arrayBuffer()), true, true);
    artCache.set(card.id, path);
    while (artCache.size > 96) {
      const [id, old] = artCache.entries().next().value;
      runtime.FS_unlink(`/${old}`);
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
// Wanted lists are in priority order (LUA_ART_SLOTS in artworkCache.ts caps
// them at the 96 kept here); touch them lowest first so eviction spares the head.
document.addEventListener("colorless:art-wanted", (e) => {
  wantedArt = e.detail;
  for (const c of [...wantedArt].reverse()) {
    if (artCache.has(c.id)) {
      const path = artCache.get(c.id);
      artCache.delete(c.id);
      artCache.set(c.id, path);
    }
  }
  pumpArt();
});

// Sandbox API transport. The chooser and its controls are rendered in Lua.
document.addEventListener("colorless:sandbox-state", (event) =>
  writeMailbox("__sandbox.txt", event.detail),
);
function sandboxCommand(command) {
  if (!accountReady) {
    pendingSandboxCommands.push(command);
    return;
  }
  const action = command.split("\t")[0];
  if (action === "input" || action === "finish-input") {
    libraryCommand(command, "sandbox");
    return;
  }
  document.dispatchEvent(new CustomEvent("colorless:sandbox-command", { detail: command }));
}
document.getElementById("sandbox-link").addEventListener("click", (event) => {
  if (!ready) return;
  event.preventDefault();
  simulatorCommand("resume");
  canvas.focus({ preventScroll: true });
});

// Full Lua game page; it shares the existing image cache and local engine host.
document.addEventListener("colorless:simulator-state", (event) =>
  writeMailbox("__simulator.txt", event.detail),
);
function simulatorCommand(command) {
  if (!accountReady) {
    pendingSimulatorCommands.push(command);
    return;
  }
  document.dispatchEvent(new CustomEvent("colorless:simulator-command", { detail: command }));
}

// Online lobby transport. The modal is Lua; LuaOnline (online.ts) owns the socket.
document.addEventListener("colorless:online-state", (event) =>
  writeMailbox("__online.txt", event.detail),
);
function onlineCommand(command) {
  if (!accountReady) {
    pendingOnlineCommands.push(command);
    return;
  }
  const action = command.split("\t")[0];
  if (action === "input" || action === "finish-input") {
    libraryCommand(command, "online");
    return;
  }
  document.dispatchEvent(new CustomEvent("colorless:online-command", { detail: command }));
}
