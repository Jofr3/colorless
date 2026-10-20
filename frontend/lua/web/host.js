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
const pendingLibraryCommands = [];
const pendingBuilderCommands = [];
const pendingSandboxCommands = [];
const pendingSimulatorCommands = [];
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
  for (const command of pendingLibraryCommands.splice(0)) libraryCommand(command);
  for (const command of pendingBuilderCommands.splice(0)) builderCommand(command);
  for (const command of pendingSandboxCommands.splice(0)) sandboxCommand(command);
  for (const command of pendingSimulatorCommands.splice(0)) simulatorCommand(command);
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
      document.title = `Luminous — ${currentPage === "simulator" ? "Simulator" : currentPage === "sandbox" ? "Sandbox" : currentPage === "builder" ? "Deck builder" : libraryPage ? "Decks" : "Home"}`;
      canvas.focus({ preventScroll: true });
    } else if (message.startsWith("LUMINOUS:page:")) {
      setPage(message.slice("LUMINOUS:page:".length));
    } else if (message.startsWith("LUMINOUS:builder:")) {
      builderCommand(message.slice("LUMINOUS:builder:".length));
    } else if (message.startsWith("LUMINOUS:simulator:")) {
      simulatorCommand(message.slice("LUMINOUS:simulator:".length));
    } else if (message.startsWith("LUMINOUS:sandbox:")) {
      sandboxCommand(message.slice("LUMINOUS:sandbox:".length));
    } else if (message.startsWith("LUMINOUS:library:")) {
      libraryCommand(message.slice("LUMINOUS:library:".length));
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
        canvas.setAttribute(
          "aria-label",
          libraryPage ? "Deck library. Tab or arrows choose controls and cards. Enter opens." : "Luminous main menu. Use Tab or arrow keys to choose; Enter to open. M toggles sound.",
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
      syncPage();
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
    ((settingsOpen || libraryPage) && ["Tab", "Home", "End", "Escape", "PageUp", "PageDown"].includes(event.code))
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

// Library transport: Lua owns the page; the browser supplies text input and API I/O.
let currentPage = new URLSearchParams(location.search).get("page") || "home";
let builderId = new URLSearchParams(location.search).get("deck") || "";
let libraryPage = ["decks","builder","sandbox","simulator"].includes(currentPage);
let pageRevision = 0;
function syncModalAccessibility() {
  document.querySelector(".accessible-menu").inert = settingsOpen || libraryPage;
  if (settingsOpen || (libraryPage && currentPage !== "simulator")) {
    canvas.setAttribute("role", "dialog");
    canvas.setAttribute("aria-modal", "true");
  } else {
    canvas.removeAttribute("role");
    canvas.removeAttribute("aria-modal");
  }
}
function syncPage() {
  syncModalAccessibility();
  writeMailbox("__page.txt", [ ++pageRevision, currentPage, builderId ].map(encodeURIComponent).join("\t"));
  document.title = `Luminous — ${currentPage === "simulator" ? "Simulator" : currentPage === "sandbox" ? "Sandbox" : currentPage === "builder" ? "Deck builder" : libraryPage ? "Decks" : "Home"}`;
  canvas.setAttribute("aria-label", currentPage === "simulator" ? "Sandbox game table. Drag cards to play. Tab selects controls and cards; Enter activates. Escape opens options." : currentPage === "sandbox" ? "Sandbox deck selection. Tab or arrows choose controls. Enter selects a deck or activates a button. Escape returns home." : libraryPage
    ? "Deck library. Tab or arrows choose controls and cards. Enter opens. Escape returns home."
    : "Luminous main menu. Use Tab or arrow keys to choose; Enter to open.");
}
function setPage(page, push = true, id = "", saved = false) {
  if(currentPage === "builder" && !saved && (page !== currentPage || id !== builderId)) {
    finishBuilderInput();
    const previous=new URL(location.href);previous.searchParams.set("page","builder");previous.searchParams.set("deck",builderId);
    history.replaceState(null,"",previous);
    document.dispatchEvent(new CustomEvent("luminous:builder-leave",{detail:()=>setPage(page,push,id,true)}));return;
  }
  finishLibraryInput(); finishBuilderInput();
  currentPage = ["decks","builder","sandbox","simulator"].includes(page) ? page : "home";
  builderId = currentPage === "builder" ? id : "";
  libraryPage = currentPage !== "home";
  const url = new URL(location.href);
  if (libraryPage) url.searchParams.set("page", currentPage);
  else url.searchParams.delete("page");
  if (builderId) url.searchParams.set("deck",builderId); else url.searchParams.delete("deck");
  url.searchParams.delete("account");
  if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
  syncPage();
}
addEventListener("popstate", () => setPage(new URLSearchParams(location.search).get("page"), false, new URLSearchParams(location.search).get("deck") || ""));
document.getElementById("decks-link").addEventListener("click", event => {
  if (!ready) return;
  event.preventDefault(); setPage("decks"); canvas.focus({preventScroll:true});
});
document.addEventListener("luminous:library-state", event => writeMailbox("__library.txt", event.detail));
function libraryCommand(command, owner = "library") {
  if (!accountReady) { pendingLibraryCommands.push(command); return; }
  const [action, field, value] = command.split("\t").map(decodeURIComponent);
  if (action === "input") {
    finishLibraryInput();
    libraryInputOwner = owner;
    libraryField = field;
    libraryInput.value = value || "";
    libraryOriginal = libraryInput.value;
    libraryInput.setAttribute("aria-label", field === "search" ? "Search decks" : "Deck name");
    libraryInput.hidden = false;
    libraryInput.focus({preventScroll:true}); libraryInput.select(); publishLibraryInput();
  } else if (action === "finish-input") finishLibraryInput();
  else document.dispatchEvent(new CustomEvent("luminous:library-command", {detail:command}));
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
  writeMailbox(`__${libraryInputOwner}_input.txt`, [++libraryInputRevision, field, libraryInput.value,
    libraryInput.selectionStart || 0, libraryInput.selectionEnd || 0, action].map(encodeURIComponent).join("\t"));
}
function finishLibraryInput(action = "done", cancel = false) {
  if (!libraryField) return;
  const field = libraryField;
  if (cancel) libraryInput.value = libraryOriginal;
  libraryField = "";
  libraryInput.hidden = true;
  publishLibraryInput(action, field);
  canvas.focus({preventScroll:true});
}
libraryInput.addEventListener("input", () => publishLibraryInput());
libraryInput.addEventListener("select", () => { if (libraryField) publishLibraryInput(); });
libraryInput.addEventListener("blur", () => finishLibraryInput());
for (const type of ["keydown", "keyup", "keypress"]) window.addEventListener(type, event => {
  if (event.target !== libraryInput) return;
  event.stopImmediatePropagation();
  if (type === "keyup" && libraryField) publishLibraryInput();
  if (type === "keydown" && !event.isComposing && ["Enter", "Escape", "Tab"].includes(event.key)) {
    event.preventDefault(); finishLibraryInput(event.key === "Enter" ? "enter" : "done", event.key === "Escape");
  }
}, true);

// Deck builder: browser-native text/clipboard and artwork transport only.
document.addEventListener("luminous:route", e => setPage(e.detail.page, true, e.detail.id || ""));
document.addEventListener("luminous:builder-state", e => {
  writeMailbox("__builder.txt", e.detail);
  if(currentPage === "builder") {
    const f=e.detail.split("\n")[0].split("\t").map(decodeURIComponent);
    document.title=`Luminous — ${f[2] || "Deck builder"}`;
    canvas.setAttribute("aria-label", `Deck builder. ${f[2]}. ${f[10]} cards. Tab selects controls. Enter inspects a card. Drag a card into your deck or use Add in its dialog.`);
  }
});
const builderInput = document.createElement("textarea");
builderInput.className="sr-only"; builderInput.hidden=true; builderInput.style.fontSize="16px";
document.querySelector("main").append(builderInput);
let builderField="", builderOriginal="", builderInputRevision=0;
function publishBuilderInput(action="input",field=builderField) {
  writeMailbox("__builder_input.txt",[++builderInputRevision,field,builderInput.value,builderInput.selectionStart,builderInput.selectionEnd,action].map(encodeURIComponent).join("\t"));
  if(field!=="transfer")builderInput.value=builderInput.value.replace(/[\r\n]/g," ");
  if(field==="name") dispatchBuilder("name",builderInput.value);
  else if(field==="optionQuery") dispatchBuilder("option-query",builderInput.value);
  else if(field!=="transfer") dispatchBuilder("filter",field,builderInput.value);
}
function dispatchBuilder(...args) {document.dispatchEvent(new CustomEvent("luminous:builder-command",{detail:args.map(encodeURIComponent).join("\t")}));}
function finishBuilderInput(cancel=false) {
  if(!builderField)return;
  const field=builderField;builderField="";
  if(cancel)builderInput.value=builderOriginal;
  publishBuilderInput("done",field);builderInput.hidden=true;canvas.focus({preventScroll:true});
}
function builderCommand(command) {
  if(!accountReady){pendingBuilderCommands.push(command);return;}
  const [action,field,value]=command.split("\t").map(decodeURIComponent);
  if(action==="input") {
    finishBuilderInput();builderField=field;builderInput.value=value||"";builderOriginal=builderInput.value;
    builderInput.maxLength=field==="transfer"?30000:field==="name"?100:300;
    builderInput.setAttribute("aria-label",field==="transfer"?"Decklist. Paste your list here.":field);
    builderInput.hidden=false;builderInput.focus({preventScroll:true});builderInput.select();publishBuilderInput();
  } else if(action==="finish-input")finishBuilderInput();
  else if(action==="copy") {
    navigator.clipboard.writeText(field).then(()=>writeMailbox("__builder_clipboard.txt",`${Date.now()}\tCopied decklist.`),()=>writeMailbox("__builder_clipboard.txt",`${Date.now()}\tCopy failed. Select the decklist and use your copy shortcut.`));
  } else document.dispatchEvent(new CustomEvent("luminous:builder-command",{detail:command}));
}
builderInput.addEventListener("input",()=>publishBuilderInput());
builderInput.addEventListener("select",()=>{if(builderField)publishBuilderInput();});
builderInput.addEventListener("blur",()=>finishBuilderInput());
for(const type of ["keydown","keyup","keypress"])window.addEventListener(type,event=>{
  if(event.target!==builderInput)return;
  event.stopImmediatePropagation();
  if(type==="keyup"&&builderField)publishBuilderInput();
  if(type==="keydown"&&!event.isComposing&&(event.key==="Escape"||event.key==="Tab"||(event.key==="Enter"&&builderField!=="transfer"))) {
    event.preventDefault();finishBuilderInput(event.key==="Escape");
  }
},true);
const artCache=new Map(), artPending=new Set(), artFailed=new Map();
let artRevision=0, artSerial=0, artActive=0, wantedArt=[];
function publishArt(){writeMailbox("__builder_art.txt",[++artRevision,...[...artCache].map(([id,path])=>[id,path].map(encodeURIComponent).join("\t"))].join("\n"));}
async function loadArt(card) {
  artActive++;artPending.add(card.id);
  try {
    const response=await fetch(card.url);if(!response.ok)throw Error("art");
    const bitmap=await createImageBitmap(await response.blob());
    // Twice card_dimensions.lua's 136×187 artwork area (the scan's 8:11
    // ratio), excluding the equal inset added by the Lua frame renderer.
    const c=document.createElement("canvas");c.width=272;c.height=374;
    c.getContext("2d").drawImage(bitmap,0,0,c.width,c.height);bitmap.close();
    const blob=await new Promise(resolve=>c.toBlob(resolve,"image/png"));
    if(!runtime||!blob)throw Error("art");
    const path=`__card_art_${++artSerial}.png`;
    runtime.FS_createDataFile("/",path,new Uint8Array(await blob.arrayBuffer()),true,true);
    artCache.set(card.id,path);
    while(artCache.size>64){const [id,old]=artCache.entries().next().value;runtime.FS_unlink(`/${old}`);artCache.delete(id);}
    publishArt();
  } catch {artFailed.set(card.id,Date.now());}
  finally {artPending.delete(card.id);artActive--;pumpArt();}
}
function pumpArt(){
  for(const card of wantedArt){
    if(artActive>=4)break;
    if(!artCache.has(card.id)&&!artPending.has(card.id)&&Date.now()-(artFailed.get(card.id)||0)>30000)void loadArt(card);
  }
}
document.addEventListener("luminous:builder-images",e=>{wantedArt=e.detail;for(const c of wantedArt){if(artCache.has(c.id)){const path=artCache.get(c.id);artCache.delete(c.id);artCache.set(c.id,path);}}pumpArt();});

// Sandbox API transport. The chooser and its controls are rendered in Lua.
document.addEventListener("luminous:sandbox-state", event => writeMailbox("__sandbox.txt", event.detail));
function sandboxCommand(command) {
  if (!accountReady) { pendingSandboxCommands.push(command); return; }
  const action = command.split("\t")[0];
  if (action === "input" || action === "finish-input") { libraryCommand(command, "sandbox"); return; }
  document.dispatchEvent(new CustomEvent("luminous:sandbox-command", {detail: command}));
}
document.getElementById("sandbox-link").addEventListener("click", event => {
  if (!ready) return;
  event.preventDefault(); simulatorCommand("resume"); canvas.focus({preventScroll:true});
});

// Full Lua game page; it shares the existing image cache and local engine host.
document.addEventListener("luminous:simulator-state", event => writeMailbox("__simulator.txt", event.detail));
function simulatorCommand(command) {
  if (!accountReady) { pendingSimulatorCommands.push(command); return; }
  document.dispatchEvent(new CustomEvent("luminous:simulator-command", {detail: command}));
}
