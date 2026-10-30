// First, before anything builds a zod schema: see the module.
import "@colorless/schema/jitless";
import { LuaAccount } from "./account";
import { LuaBuilder } from "./builder";
import { LuaLibrary } from "./library";
import { LuaOnline } from "./online";
import { LuaSandbox } from "./sandbox";
import { LazyScreen, loadFailureHandler, type Screen } from "./lazyScreen";
import { hasSimulatorSave } from "../game/simulatorSaveKey";
import { deckStore } from "../decks/deckStore";
import { decodeFields, encodeFields } from "./wire";
import { setSessionRecoveryHandler } from "../lib/api";
import { reportError } from "../lib/reportError";
import { ArtworkCache } from "./artworkCache";
import type { ArtRequest } from "../host/bridgeProtocol";
import { MAILBOXES } from "../host/mailboxes";
import {
  type BuilderDeck,
  type Route,
  Router,
  pageInstructions,
  pageLabel,
  pageTitle,
} from "../host/router";
import { type BridgeScreen, HostShell } from "../host/shell";
import { reloadUnlessRecent } from "../host/reloadThrottle";
import { guardUnsavedEdits } from "../host/unsavedEdits";

const host = window.colorlessHost;

const shell = new HostShell(document, host, {
  // A command that rejects is reported here; HostShell reports one that throws.
  command: (screen, raw) =>
    void Promise.resolve(screens[screen].command(raw)).catch((error: unknown) =>
      reportError(`run a ${screen} command`, error),
    ),
  navigate: (page) => router.navigate(page),
  // Credentials stay in the native browser inputs and the API client. Lua receives only the
  // email, the name and a masked password.
  authenticate: ({ mode, email, password, name }) =>
    void account.authenticate(mode, email, password, name),
  deleteAccount: (password, email) => void account.deleteAccount(password, email),
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
guardUnsavedEdits({ window, document }, builder);
const library = new LuaLibrary(publishTo("library"), (id) => route("builder", id));
const sandbox = new LuaSandbox(
  publishTo("sandbox"),
  async () => {
    const { launchSandbox } = await import("./sandboxLaunch");
    return (setup) => launchSandbox(setup, () => route("simulator"));
  },
  () => void simulator.warm(),
);
const online = new LuaOnline(publishTo("online"), route, {
  user: () => account.user,
  warmTable: () => void simulator.warm(),
});
// The game table and the rules engine behind it load when Lua first opens a table, or when a page
// heads for one (the sandbox picker, an online countdown). Resuming with no save stored needs
// neither: it goes straight to the deck picker.
const simulator = new LazyScreen(
  async () => {
    const [{ LuaSimulator }, { LuaOnlineMatch }] = await Promise.all([
      import("./simulator"),
      import("./onlineTable"),
    ]);
    return new LuaSimulator(publishTo("simulator"), route, wantArt, (code) =>
      online.matchSource(code, LuaOnlineMatch),
    );
  },
  loadFailureHandler({
    offline: () => navigator.onLine === false,
    reload: () =>
      reloadUnlessRecent(
        () => sessionStorage,
        () => location.reload(),
      ),
    notice: showNotice,
    report: (error) => reportError("load a screen", error),
  }),
  {
    answer: (raw) => {
      if (decodeFields(raw)?.[0] !== "resume" || hasSimulatorSave()) return false;
      route("sandbox");
      return true;
    },
  },
);
const account = new LuaAccount((snapshot) => {
  shell.accountChanged(snapshot);
  const status = account.status;
  const userId = account.user?.id ?? "";
  // Before the screens, so one opening now finds the signed-in user's list on its way.
  deckStore.follow(status, userId);
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
// A 401 elsewhere waits for the session check in flight, if any, rather than answering from the
// status before it.
setSessionRecoveryHandler(() => account.recover());

let noticeRevision = 0;
/** A line Lua shows and says on whatever page is open. */
function showNotice(message: string) {
  host.writeMailbox(MAILBOXES.notice, encodeFields([++noticeRevision, message]));
}

/** The builder's deck for the page's name: a deck the builder has not opened yet is loading too. */
function builderDeck(route: Route): BuilderDeck | undefined {
  if (route.page !== "builder") return undefined;
  if (builder.id !== route.id) return { name: "", loading: true };
  return {
    name: builder.phase === "ready" ? builder.name : "",
    loading: builder.phase === "loading",
  };
}

function showPage(route: Route) {
  const deck = builderDeck(route);
  shell.showPage({
    ...route,
    title: pageTitle(route.page, deck?.name),
    label: pageLabel(route.page, deck),
    instructions: pageInstructions(route.page),
  });
}
showPage(router.current);

host.connect({
  onPrint: (message) => shell.onPrint(message),
  onDegraded: (state) => {
    shell.onDegraded(state);
    if (state === "failed") online.halt();
  },
  artwork: new ArtworkCache(),
  mailboxes: MAILBOXES,
});
// Ask who is signed in while the runtime downloads; Lua's navigation refreshes reuse the answer.
void account.refresh();
