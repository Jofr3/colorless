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

const builder = new LuaBuilder(
  (snapshot) =>
    document.dispatchEvent(new CustomEvent("colorless:builder-state", { detail: snapshot })),
  () => document.dispatchEvent(new CustomEvent("colorless:route", { detail: { page: "decks" } })),
  (cards) => document.dispatchEvent(new CustomEvent("colorless:builder-images", { detail: cards })),
);
document.addEventListener("colorless:builder-leave", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "function")
    builder.navigate(event.detail);
});
document.addEventListener("colorless:builder-command", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "string")
    void builder.command(event.detail);
});
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
  (snapshot) => {
    document.dispatchEvent(new CustomEvent("colorless:library-state", { detail: snapshot }));
  },
  (id) =>
    document.dispatchEvent(new CustomEvent("colorless:route", { detail: { page: "builder", id } })),
);
document.addEventListener("colorless:library-command", (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
  void library.command(event.detail);
});

const sandbox = new LuaSandbox(
  (snapshot) =>
    document.dispatchEvent(new CustomEvent("colorless:sandbox-state", { detail: snapshot })),
  (setup) =>
    launchSandbox(setup, () =>
      document.dispatchEvent(new CustomEvent("colorless:route", { detail: { page: "simulator" } })),
    ),
);
document.addEventListener("colorless:sandbox-command", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "string")
    void sandbox.command(event.detail);
});

const route = (page: string, id?: string, replace?: boolean) =>
  document.dispatchEvent(new CustomEvent("colorless:route", { detail: { page, id, replace } }));
const online = new LuaOnline(
  (snapshot) =>
    document.dispatchEvent(new CustomEvent("colorless:online-state", { detail: snapshot })),
  route,
  { user: () => account.user },
);
document.addEventListener("colorless:online-command", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "string")
    void online.command(event.detail);
});

const simulator = new LuaSimulator(
  (snapshot) =>
    document.dispatchEvent(new CustomEvent("colorless:simulator-state", { detail: snapshot })),
  route,
  (cards) => document.dispatchEvent(new CustomEvent("colorless:builder-images", { detail: cards })),
  (code) => online.matchSource(code),
);
document.addEventListener("colorless:simulator-command", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "string")
    simulator.command(event.detail);
});

const account = new LuaAccount((snapshot) => {
  document.dispatchEvent(new CustomEvent("colorless:account-state", { detail: snapshot }));
  const fields = snapshot.split("\t").map(decodeURIComponent);
  library.session(fields[1] ?? "loading", fields[4] ?? "");
  builder.session(fields[1] ?? "loading", fields[4] ?? "");
  sandbox.session(fields[1] ?? "loading", fields[4] ?? "");
  online.session(fields[1] ?? "loading", fields[4] ?? "");
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
document.addEventListener("colorless:account-command", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "string")
    void account.command(event.detail);
});
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
