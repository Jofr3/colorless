import { LuaAccount } from "./account";
import { LuaBuilder } from "./builder";
import { LuaLibrary } from "./library";
import { setSessionRecoveryHandler } from "../../lib/api";

const builder = new LuaBuilder(
  (snapshot) =>
    document.dispatchEvent(new CustomEvent("luminous:builder-state", { detail: snapshot })),
  () => document.dispatchEvent(new CustomEvent("luminous:route", { detail: { page: "decks" } })),
  (cards) => document.dispatchEvent(new CustomEvent("luminous:builder-images", { detail: cards })),
);
document.addEventListener("luminous:builder-leave", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "function")
    builder.navigate(event.detail);
});
document.addEventListener("luminous:builder-command", (event) => {
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
    document.dispatchEvent(new CustomEvent("luminous:library-state", { detail: snapshot }));
  },
  (id) =>
    document.dispatchEvent(new CustomEvent("luminous:route", { detail: { page: "builder", id } })),
);
document.addEventListener("luminous:library-command", (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
  void library.command(event.detail);
});

const account = new LuaAccount((snapshot) => {
  document.dispatchEvent(new CustomEvent("luminous:account-state", { detail: snapshot }));
  const fields = snapshot.split("\t").map(decodeURIComponent);
  library.session(fields[1] ?? "loading", fields[4] ?? "");
  builder.session(fields[1] ?? "loading", fields[4] ?? "");
});
setSessionRecoveryHandler(async () => {
  await account.refresh();
  return account.status === "authenticated";
});
document.addEventListener("luminous:account-command", (event) => {
  if (event instanceof CustomEvent && typeof event.detail === "string")
    void account.command(event.detail);
});
// Credentials stay in the native browser inputs/API client. Lua receives only
// the email/name and a masked password, never the password itself.
document.addEventListener("luminous:authenticate", (event) => {
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
document.dispatchEvent(new Event("luminous:account-ready"));
