import type { User } from "@colorless/schema";
import { ApiError, login, register, logout, me, updateProfile } from "../lib/api";
import { startOAuth } from "../lib/startOAuth";

export const encodeFields = (fields: (string | number)[]) =>
  fields.map((v) => encodeURIComponent(String(v))).join("\t");

/** The Lua scene owns the UI; this adapter shares the typed API client
 * and cookie session. No credentials or profile data go into localStorage. */
export class LuaAccount {
  user: User | null = null;
  status = "loading";
  busy = false;
  message = "";
  private operation = 0;
  private revision = 0;
  constructor(private publish: (snapshot: string) => void) {}

  private emit() {
    const u = this.user;
    this.publish(
      encodeFields([
        ++this.revision,
        this.status,
        this.busy ? 1 : 0,
        this.message,
        u?.id ?? "",
        u?.displayName ?? "",
        u?.email ?? "",
      ]),
    );
  }

  async refresh() {
    if (this.busy) return;
    const op = ++this.operation;
    this.busy = true;
    this.message = "";
    this.emit();
    try {
      const user = await me();
      if (op !== this.operation) return;
      this.user = user;
      this.status = "authenticated";
    } catch (error) {
      if (op !== this.operation) return;
      this.user = null;
      this.status = error instanceof ApiError && error.status === 401 ? "anonymous" : "error";
      this.message = this.status === "error" ? "Could not reach the server. Try again." : "";
    } finally {
      if (op === this.operation) {
        this.busy = false;
        this.emit();
      }
    }
  }

  async save(name: string) {
    if (this.busy || !this.user) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 64) {
      this.message = "Use 1 to 64 characters for your name.";
      this.emit();
      return;
    }
    const op = ++this.operation;
    this.busy = true;
    this.message = "Saving...";
    this.emit();
    try {
      const user = await updateProfile({ displayName: trimmed });
      if (op !== this.operation) return;
      this.user = user;
      this.message = "Saved.";
    } catch (error) {
      if (op !== this.operation) return;
      if (error instanceof ApiError && error.status === 401) {
        this.user = null;
        this.status = "anonymous";
        this.message = "Your session expired. Sign in again.";
      } else {
        this.message =
          error instanceof ApiError && error.status === 400
            ? "Check your name, then try again."
            : "Could not save. Try again.";
      }
    } finally {
      if (op === this.operation) {
        this.busy = false;
        this.emit();
      }
    }
  }

  async signOut() {
    if (this.busy || !this.user) return;
    const op = ++this.operation;
    this.busy = true;
    this.message = "Signing out...";
    this.emit();
    try {
      try {
        await logout();
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      if (op !== this.operation) return;
      this.user = null;
      this.status = "anonymous";
      this.message = "";
    } catch {
      if (op === this.operation) this.message = "Could not sign out. Try again.";
    } finally {
      if (op === this.operation) {
        this.busy = false;
        this.emit();
      }
    }
  }

  async authenticate(mode: "login" | "register", email: string, password: string, name: string) {
    if (this.busy) return;
    const trimmedEmail = email.trim();
    this.message = "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) || trimmedEmail.length > 254)
      this.message = "Enter a valid email address.";
    else if (!password) this.message = "Enter your password.";
    else if (mode === "register" && password.length < 8)
      this.message = "Passwords need at least 8 characters.";
    else if (password.length > 256) this.message = "Password is too long.";
    else if (mode === "register" && name.trim().length > 64)
      this.message = "Use up to 64 characters for your name.";
    if (this.message) {
      this.emit();
      return;
    }
    const op = ++this.operation;
    this.busy = true;
    this.emit();
    try {
      const user =
        mode === "login"
          ? await login({ email: trimmedEmail, password })
          : await register({
              email: trimmedEmail,
              password,
              ...(name.trim() ? { displayName: name.trim() } : {}),
            });
      if (op !== this.operation) return;
      this.user = user;
      this.status = "authenticated";
      this.message = "";
    } catch (error) {
      if (op !== this.operation) return;
      const status = error instanceof ApiError ? error.status : 0;
      this.message =
        status === 401
          ? "Wrong email or password."
          : status === 409
            ? "That email already has an account."
            : status === 429
              ? "Too many attempts. Wait a moment."
              : status === 400
                ? "Check the fields and try again."
                : "Could not connect. Please try again.";
    } finally {
      if (op === this.operation) {
        this.busy = false;
        this.emit();
      }
    }
  }

  async google() {
    if (this.busy) return;
    const op = ++this.operation;
    this.busy = true;
    this.message = "";
    this.emit();
    const result = await startOAuth(
      "google",
      undefined,
      typeof location !== "undefined" &&
        ["decks", "builder", "sandbox", "simulator", "online", "match"].includes(
          new URLSearchParams(location.search).get("page") ??
            (new URLSearchParams(location.search).has("lobby") ? "online" : ""),
        )
        ? `/${location.search}${location.search ? "&" : "?"}account`
        : "/?account",
    );
    if (op !== this.operation || result === "redirected") return;
    this.busy = false;
    this.message =
      result === "unconfigured"
        ? "Google sign-in is not set up yet."
        : "Could not start Google sign-in. Try again.";
    this.emit();
  }

  async command(raw: string) {
    let fields: string[];
    try {
      fields = raw.split("\t").map(decodeURIComponent);
    } catch {
      return;
    }
    const [action, name] = fields;
    if (action === "refresh") await this.refresh();
    if (action === "save" && name !== undefined) await this.save(name);
    if (action === "logout") await this.signOut();
    if (action === "google") await this.google();
    if (action === "clear-message" && !this.busy) {
      this.message = "";
      this.emit();
    }
  }
}
