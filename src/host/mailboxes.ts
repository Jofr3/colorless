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
  /** Each mailbox file and its revision, rewritten after every mailbox write. */
  revisions: "__mailbox_revisions.txt",
} as const;

export type Mailbox = keyof typeof MAILBOXES;
