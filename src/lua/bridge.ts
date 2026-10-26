import { LuaAccount } from "./account";
import { LuaBuilder } from "./builder";
import { LuaLibrary } from "./library";
import { LuaOnline } from "./online";
import { LuaSimulator } from "./simulator";
import { LuaSandbox } from "./sandbox";
import { launchSandbox } from "./sandboxLaunch";
import { setSessionRecoveryHandler } from "../lib/api";
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

const builder = new LuaBuilder(
  (snapshot) => {
    host.writeMailbox(MAILBOXES.builder, snapshot);
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
const library = new LuaLibrary(
  (snapshot) => host.writeMailbox(MAILBOXES.library, snapshot),
  (id) => route("builder", id),
);
const sandbox = new LuaSandbox(
  (snapshot) => host.writeMailbox(MAILBOXES.sandbox, snapshot),
  (setup) => launchSandbox(setup, () => route("simulator")),
);
const online = new LuaOnline((snapshot) => host.writeMailbox(MAILBOXES.online, snapshot), route, {
  user: () => account.user,
});
const simulator = new LuaSimulator(
  (snapshot) => host.writeMailbox(MAILBOXES.simulator, snapshot),
  route,
  wantArt,
  (code) => online.matchSource(code),
);

const account = new LuaAccount((snapshot) => {
  shell.accountChanged(snapshot);
  const status = account.status;
  const userId = account.user?.id ?? "";
  for (const screen of [library, builder, sandbox, online]) screen.session(status, userId);
});
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

const screens: Record<BridgeScreen, { command(raw: string): unknown }> = {
  library,
  builder,
  sandbox,
  online,
  simulator,
  account,
};

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
