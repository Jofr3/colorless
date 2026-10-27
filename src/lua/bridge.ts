import { LuaAccount } from "./account";
import { LuaBuilder } from "./builder";
import { LuaLibrary } from "./library";
import { LuaOnline } from "./online";
import { LuaSandbox } from "./sandbox";
import { LazyScreen, type Screen } from "./lazyScreen";
import { setSessionRecoveryHandler } from "../lib/api";
import { reportError } from "../lib/reportError";
import { ArtworkCache } from "./artworkCache";
import type { ArtRequest } from "../host/bridgeProtocol";
import { MAILBOXES } from "../host/mailboxes";
import { type Route, Router, pageLabel, pageTitle } from "../host/router";
import { type BridgeScreen, HostShell } from "../host/shell";

const host = window.colorlessHost;

const shell = new HostShell(document, host, {
  command: (screen, raw) => void screens[screen].command(raw),
  navigate: (page) => router.navigate(page),
  // Credentials stay in the native browser inputs and the API client. Lua receives only the
  // email, the name and a masked password.
  authenticate: ({ mode, email, password, name }) =>
    void account.authenticate(mode, email, password, name),
  deleteAccount: (password) => void account.deleteAccount(password),
});
const router = new Router(window, {
  changed: showPage,
  holdLeave: (from, proceed) => {
    if (from.page !== "builder") return false;
    shell.finishInputs();
    builder.navigate(proceed);
    return true;
  },
});

const route = (page: string, id?: string, replace?: boolean) => router.navigate(page, id, replace);
const wantArt = (cards: readonly ArtRequest[]) => host.wantArt(cards);
/** A screen's snapshots go to the mailbox named after it. */
const publishTo = (screen: BridgeScreen) => (snapshot: string) =>
  host.writeMailbox(MAILBOXES[screen], snapshot);

const builder = new LuaBuilder(
  (snapshot) => {
    publishTo("builder")(snapshot);
    if (router.current.page === "builder") showPage(router.current);
  },
  () => route("decks"),
  wantArt,
);
window.addEventListener("beforeunload", (event) => {
  if (
    builder.id &&
    builder.phase === "ready" &&
    builder.saveStatus &&
    builder.saveStatus !== "saved"
  ) {
    void builder.command("retry-save");
    event.preventDefault();
  }
});
const library = new LuaLibrary(publishTo("library"), (id) => route("builder", id));
const sandbox = new LuaSandbox(publishTo("sandbox"), async () => {
  const { launchSandbox } = await import("./sandboxLaunch");
  return (setup) => launchSandbox(setup, () => route("simulator"));
});
const online = new LuaOnline(publishTo("online"), route, { user: () => account.user });
// The game table and the rules engine behind it load when Lua first opens or asks about a table.
const simulator = new LazyScreen(async () => {
  const [{ LuaSimulator }, { LuaOnlineMatch }] = await Promise.all([
    import("./simulator"),
    import("./onlineTable"),
  ]);
  return new LuaSimulator(publishTo("simulator"), route, wantArt, (code) =>
    online.matchSource(code, LuaOnlineMatch),
  );
}, screenLoadFailed);
const account = new LuaAccount((snapshot) => {
  shell.accountChanged(snapshot);
  const status = account.status;
  const userId = account.user?.id ?? "";
  for (const screen of Object.values(screens)) screen.session?.(status, userId);
});

/** Lua's `COLORLESS:<screen>:` commands and the account's session go to these adapters. */
const screens: Record<BridgeScreen, Screen> = {
  library,
  builder,
  sandbox,
  online,
  simulator,
  account,
};

{
  const url = new URL(location.href);
  const authError = url.searchParams.get("authError");
  if (authError !== null) {
    account.noteAuthError(authError);
    url.searchParams.delete("authError");
    history.replaceState(history.state, "", url);
  }
}
setSessionRecoveryHandler(async () => {
  await account.refresh();
  return account.status === "authenticated";
});

/** A screen chunk that will not load most likely went away with a deploy under this tab: reload
 * onto the new build, at most once a minute so a broken build cannot loop. */
function screenLoadFailed(error: unknown) {
  reportError("load a screen", error);
  const key = "colorless:screen-reload";
  try {
    if (Date.now() - Number(sessionStorage.getItem(key)) < 60_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  location.reload();
}

function showPage(route: Route) {
  const deck =
    route.page === "builder" && builder.id === route.id && builder.name
      ? { name: builder.name, cards: [...builder.entries.values()].reduce((a, b) => a + b, 0) }
      : undefined;
  shell.showPage({
    ...route,
    title: pageTitle(route.page, deck?.name),
    label: pageLabel(route.page, deck),
  });
}
showPage(router.current);

host.connect({
  onPrint: (message) => shell.onPrint(message),
  artwork: new ArtworkCache(),
  mailboxes: MAILBOXES,
});
// Ask who is signed in while the runtime downloads; Lua's navigation refreshes reuse the answer.
void account.refresh();
