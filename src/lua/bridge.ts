import { LuaAccount } from "./account";
import { LuaBuilder } from "./builder";
import { LuaLibrary } from "./library";
import { LuaOnline } from "./online";
import { LuaSimulator } from "./simulator";
import { LuaSandbox } from "./sandbox";
import { launchSandbox } from "./sandboxLaunch";
import { setSessionRecoveryHandler } from "../lib/api";
import { ArtworkCache } from "./artworkCache";
import type { ArtRequest, BridgeScreen } from "../host/bridgeProtocol";
import { type Route, Router, pageLabel, pageTitle } from "../host/router";

const host = window.colorlessHost;

const router = new Router(window, {
  changed: showPage,
  holdLeave: (from, proceed) => {
    if (from.page !== "builder") return false;
    host.finishInputs();
    builder.navigate(proceed);
    return true;
  },
});

const publishTo = (screen: BridgeScreen) => (snapshot: string) => host.publish(screen, snapshot);
const route = (page: string, id?: string, replace?: boolean) => router.navigate(page, id, replace);
const wantArt = (cards: readonly ArtRequest[]) => host.wantArt(cards);

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
const sandbox = new LuaSandbox(publishTo("sandbox"), (setup) =>
  launchSandbox(setup, () => route("simulator")),
);
const online = new LuaOnline(publishTo("online"), route, { user: () => account.user });
const simulator = new LuaSimulator(publishTo("simulator"), route, wantArt, (code) =>
  online.matchSource(code),
);

const account = new LuaAccount((snapshot) => {
  publishTo("account")(snapshot);
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

function showPage(route: Route) {
  const deck =
    route.page === "builder" && builder.id === route.id && builder.name
      ? { name: builder.name, cards: [...builder.entries.values()].reduce((a, b) => a + b, 0) }
      : undefined;
  host.showPage({
    ...route,
    title: pageTitle(route.page, deck?.name),
    label: pageLabel(route.page, deck),
  });
}
showPage(router.current);

const screens: Record<BridgeScreen, { command(raw: string): unknown }> = {
  library,
  builder,
  sandbox,
  online,
  simulator,
  account,
};
host.connect({
  command: (screen, raw) => void screens[screen].command(raw),
  // Credentials stay in the native browser inputs and the API client. Lua receives only the
  // email, the name and a masked password.
  authenticate: ({ mode, email, password, name }) =>
    void account.authenticate(mode, email, password, name),
  navigate: (page) => router.navigate(page),
  artwork: new ArtworkCache(),
});
