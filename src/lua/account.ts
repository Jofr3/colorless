import {
  DISPLAY_NAME_MAX,
  OAUTH_FAILURES,
  type OAuthFailure,
  type User,
  hasControlChars,
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from "@colorless/schema";
import { ApiError, deleteAccount, login, register, logout, me, updateProfile } from "../lib/api";
import { startOAuth } from "../lib/startOAuth";
import { decodeFields, encodeFields } from "./wire";

const OAUTH_ERROR_MESSAGES: Record<OAuthFailure, string> = {
  state: "Google sign-in expired. Try again.",
  exchange: "Google sign-in failed. Try again.",
  profile: "Google sign-in failed. Try again.",
  "no-email": "Google did not share an email address.",
  "email-in-use": "That email already has an account. Sign in with your password.",
};

const EMAIL_MISMATCH = "That is not this account's email.";
const HIDDEN_CHARACTERS = "Names cannot have hidden characters.";

interface FormIssue {
  path: readonly PropertyKey[];
  code: string;
}

/** What to tell someone whose sign-in form the request schema refused, by its first issue. */
function formProblem(issue: FormIssue | undefined, mode: "login" | "register", name = "") {
  const field = issue?.path[0];
  if (field === "email") return "Enter a valid email address.";
  if (field === "displayName") {
    return hasControlChars(name)
      ? HIDDEN_CHARACTERS
      : `Use up to ${DISPLAY_NAME_MAX} characters for your name.`;
  }
  if (issue?.code === "too_big") return "Password is too long.";
  return mode === "register" ? "Passwords need at least 8 characters." : "Enter your password.";
}

/** How long a session check answers the page's navigation refreshes. A revoked session still
 * surfaces at once: any 401 from another request re-checks through the session recovery. */
export const SESSION_CHECK_MAX_AGE_MS = 60_000;

/** The Lua scene owns the UI; this adapter shares the typed API client
 * and cookie session. No credentials or profile data go into localStorage. */
export type AccountStatus = "loading" | "authenticated" | "anonymous" | "error";

export class LuaAccount {
  user: User | null = null;
  status: AccountStatus = "loading";
  busy = false;
  message = "";
  private operation = 0;
  private revision = 0;
  /** A failed Google sign-in, shown once by the next anonymous refresh. */
  private authNotice = "";
  /** When the server last answered who is signed in. */
  private checkedAt = Number.NEGATIVE_INFINITY;
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
        u?.hasPassword ? 1 : 0,
        u?.namePrompt ? 1 : 0,
      ]),
    );
  }

  /** Asks the server who is signed in, unless it answered within `maxAgeMs`. */
  async refresh(maxAgeMs = 0) {
    if (this.busy || Date.now() - this.checkedAt < maxAgeMs) return;
    const op = ++this.operation;
    this.busy = true;
    this.message = "";
    this.emit();
    try {
      const user = await me();
      if (op !== this.operation) return;
      this.user = user;
      this.status = "authenticated";
      this.checkedAt = Date.now();
    } catch (error) {
      if (op !== this.operation) return;
      this.user = null;
      this.status = error instanceof ApiError && error.status === 401 ? "anonymous" : "error";
      this.checkedAt = this.status === "anonymous" ? Date.now() : Number.NEGATIVE_INFINITY;
      this.message =
        this.status === "error" ? "Could not reach the server. Try again." : this.authNotice;
      this.authNotice = "";
    } finally {
      if (op === this.operation) {
        this.busy = false;
        this.emit();
      }
    }
  }

  noteAuthError(code: string) {
    const failure = OAUTH_FAILURES.find((known) => known === code);
    this.authNotice =
      failure === undefined ? "Google sign-in failed. Try again." : OAUTH_ERROR_MESSAGES[failure];
  }

  /** Saves `name` as the display name, by the same rule the server applies. Saving the current
   * name unchanged is how the "choose your public name" prompt's Keep answers it. */
  async save(name: string) {
    if (this.busy || !this.user) return;
    const request = updateProfileRequestSchema.safeParse({ displayName: name });
    if (!request.success) {
      this.message = hasControlChars(name.trim())
        ? HIDDEN_CHARACTERS
        : `Use 1 to ${DISPLAY_NAME_MAX} characters for your name.`;
      this.emit();
      return;
    }
    const op = ++this.operation;
    this.busy = true;
    this.message = "Saving...";
    this.emit();
    try {
      const user = await updateProfile(request.data);
      if (op !== this.operation) return;
      this.user = user;
      this.message = "Saved.";
    } catch (error) {
      if (op !== this.operation) return;
      if (error instanceof ApiError && error.status === 401) {
        this.user = null;
        this.status = "anonymous";
        this.checkedAt = Date.now();
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
      this.checkedAt = Date.now();
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

  /** Deletes the signed-in account. The password, or for an OAuth-only account the typed email,
   * comes from the shell's native fields and goes only to the API, which checks it. Success ends
   * as a sign-out does, and also drops the saved decks fetched this session, which no longer
   * exist. */
  async deleteAccount(password: string, email: string) {
    if (this.busy || !this.user) return;
    const needsPassword = this.user.hasPassword;
    const confirmEmail = email.trim();
    if (needsPassword && !password) {
      this.refuse("Enter your password.");
      return;
    }
    if (!needsPassword && !confirmEmail) {
      this.refuse("Type your email to confirm.");
      return;
    }
    if (!needsPassword && confirmEmail.toLowerCase() !== this.user.email.toLowerCase()) {
      this.refuse(EMAIL_MISMATCH);
      return;
    }
    const op = ++this.operation;
    this.busy = true;
    this.message = "Deleting your account...";
    this.emit();
    try {
      await deleteAccount(needsPassword ? { password } : { confirmEmail });
      if (op !== this.operation) return;
      this.user = null;
      this.status = "anonymous";
      this.checkedAt = Date.now();
      this.message = "Account deleted.";
    } catch (error) {
      if (op !== this.operation) return;
      const status = error instanceof ApiError ? error.status : 0;
      // Both refusals are 401s: the body tells a wrong password from a session that is gone.
      if (status === 401 && error instanceof ApiError && error.message === "unauthorized") {
        this.user = null;
        this.status = "anonymous";
        this.checkedAt = Date.now();
        this.message = "Your session expired. Sign in again.";
      } else {
        this.message =
          status === 401
            ? "Wrong password."
            : status === 403
              ? EMAIL_MISMATCH
              : status === 429
                ? "Too many attempts. Wait a moment."
                : "Could not delete your account. Try again.";
      }
    } finally {
      if (op === this.operation) {
        this.busy = false;
        this.emit();
      }
    }
  }

  async authenticate(mode: "login" | "register", email: string, password: string, name: string) {
    if (this.busy) return;
    const displayName = name.trim();
    const form = { email: email.trim(), password, ...(displayName ? { displayName } : {}) };
    if (mode === "login") {
      const request = loginRequestSchema.safeParse(form);
      if (request.success) await this.signIn(() => login(request.data));
      else this.refuse(formProblem(request.error.issues[0], mode));
    } else {
      const request = registerRequestSchema.safeParse(form);
      if (request.success) await this.signIn(() => register(request.data));
      else this.refuse(formProblem(request.error.issues[0], mode, displayName));
    }
  }

  private refuse(message: string) {
    this.message = message;
    this.emit();
  }

  private async signIn(send: () => Promise<User>) {
    const op = ++this.operation;
    this.busy = true;
    this.message = "";
    this.emit();
    try {
      const user = await send();
      if (op !== this.operation) return;
      this.user = user;
      this.status = "authenticated";
      this.checkedAt = Date.now();
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
      // Return to the current page (its path) with the account tab open.
      `${typeof location !== "undefined" ? location.pathname : "/"}?account`,
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
    const fields = decodeFields(raw);
    if (!fields) return;
    const [action, name] = fields;
    if (action === "refresh") await this.refresh(SESSION_CHECK_MAX_AGE_MS);
    if (action === "save" && name !== undefined) await this.save(name);
    // Keeps the current name, answering the one-time prompt. A name saved before today's rule may
    // not pass it; the refusal asks for a new one.
    if (action === "keep" && this.user) await this.save(this.user.displayName);
    if (action === "logout") await this.signOut();
    if (action === "google") await this.google();
    if (action === "clear-message" && !this.busy) {
      this.message = "";
      this.emit();
    }
  }
}
