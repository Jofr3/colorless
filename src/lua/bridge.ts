import { LuaAccount } from "./account";
import { LuaBuilder } from "./builder";
import { LuaLibrary } from "./library";
import { LuaOnline } from "./online";
import { LuaSimulator } from "./simulator";
import { LuaSandbox } from "./sandbox";
import { launchSandbox } from "./sandboxLaunch";
import { setSessionRecoveryHandler } from "../lib/api";
import { ArtworkCache } from "./artworkCache";

window.colorlessArtworkCache = new ArtworkCache();

const dispatch = (name: string, detail: unknown) =>
  document.dispatchEvent(new CustomEvent(`colorless:${name}`, { detail }));
/** The publish callback for a screen: its snapshot goes out as `colorless:<screen>-state`. */
const publishTo = (screen: string) => (snapshot: string) => dispatch(`${screen}-state`, snapshot);
/** Routes `colorless:<screen>-command` string details to the screen's adapter. */
function onCommand(screen: string, run: (raw: string) => unknown) {
  document.addEventListener(`colorless:${screen}-command`, (event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") void run(event.detail);
  });
}
const route = (page: string, id?: string, replace?: boolean) =>
  dispatch("route", { page, id, replace });
const wantArt = (cards: unknown) => dispatch("art-wanted", cards);

const builder = new LuaBuilder(publishTo("builder"), () => route("decks"), wantArt);
document.addEventListener("colorless:builder-leave", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "function")
    builder.navigate(event.detail);
});
onCommand("builder", (raw) => builder.command(raw));
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
onCommand("library", (raw) => library.command(raw));

const sandbox = new LuaSandbox(publishTo("sandbox"), (setup) =>
  launchSandbox(setup, () => route("simulator")),
);
onCommand("sandbox", (raw) => sandbox.command(raw));

const online = new LuaOnline(publishTo("online"), route, { user: () => account.user });
onCommand("online", (raw) => online.command(raw));

const simulator = new LuaSimulator(publishTo("simulator"), route, wantArt, (code) =>
  online.matchSource(code),
);
onCommand("simulator", (raw) => simulator.command(raw));

const account = new LuaAccount((snapshot) => {
  dispatch("account-state", snapshot);
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
onCommand("account", (raw) => account.command(raw));
// Credentials stay in the native browser inputs/API client. Lua receives only
// the email/name and a masked password, never the password itself.
document.addEventListener("colorless:authenticate", (event) => {
  if (!(event instanceof CustomEvent)) return;
  const { mode, email, password, name } = event.detail ?? {};
  if (
    (mode !== "login" && mode !== "register") ||
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof name !== "string"
  )
    return;
  void account.authenticate(mode, email, password, name);
});
document.dispatchEvent(new Event("colorless:account-ready"));
