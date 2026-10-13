import { LuaAccount } from "./account";

const account = new LuaAccount((snapshot) => {
  document.dispatchEvent(new CustomEvent("luminous:account-state", { detail: snapshot }));
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
