/** The files the page writes into LÖVE's save directory for Lua to read. */
export const MAILBOXES = {
  viewport: "__viewport.txt",
  preferences: "__preferences.txt",
  page: "__page.txt",
  settings: "__settings.txt",
  account: "__account.txt",
  accountInput: "__account_input.txt",
  authInput: "__auth_input.txt",
  library: "__library.txt",
  libraryInput: "__library_input.txt",
  builder: "__builder.txt",
  builderInput: "__builder_input.txt",
  builderClipboard: "__builder_clipboard.txt",
  sandbox: "__sandbox.txt",
  sandboxInput: "__sandbox_input.txt",
  simulator: "__simulator.txt",
  online: "__online.txt",
  onlineInput: "__online_input.txt",
  art: "__art.txt",
  transitionArt: "__transition_art.txt",
  /** A line for Lua to show and say, with its serial: revision, message. */
  notice: "__notice.txt",
  /** Each mailbox file and its revision, rewritten after every mailbox write. */
  revisions: "__mailbox_revisions.txt",
} as const;

export type Mailbox = keyof typeof MAILBOXES;

/** The `COLORLESS:<channel>` prints from Lua (frontend/lua/ui/bridge.lua) that src/host/shell.ts
 * runs. scripts/lua-bridge-guard.ts refuses a literal channel in the Lua that no list here names. */
export const SHELL_PRINT_CHANNELS = [
  "ready",
  "page",
  "library",
  "sandbox",
  "online",
  "builder",
  "simulator",
  "auth",
  "account",
  "announce",
  "preferences",
  "settings",
  "transition",
  "field-box",
  "focus-edge",
  "credits",
] as const;

export type ShellPrintChannel = (typeof SHELL_PRINT_CHANNELS)[number];

/** The prints frontend/lua/web/host.js answers itself and does not hand the shell. */
export const HOST_PRINT_CHANNELS = ["music", "transition-art"] as const;
