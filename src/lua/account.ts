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
import {
  ApiError,
  deleteAccount,
  login,
  logout,
  logoutAll,
  me,
  register,
  updateProfile,
} from "../lib/api";
import { startOAuth } from "../lib/startOAuth";
import { decodeFields, encodeFields } from "./wire";
import { WIRE_ROWS, wireRow } from "./wireFields";

const OAUTH_ERROR_MESSAGES: Record<OAuthFailure, string> = {
  state: "Google sign-in expired. Try again.",
  exchange: "Google sign-in failed. Try again.",
  profile: "Google sign-in failed. Try again.",
  "no-email": "Google did not share an email address.",
  "email-in-use": "That email already has an account. Sign in with your password.",
  "email-unverified": "Google has not verified that email address.",
  unavailable: "Sign-in is unavailable right now. Try again later.",
};

const EMAIL_MISMATCH = "That is not this account's email.";
const SESSION_EXPIRED = "Your session expired. Sign in again.";
const SIGNING_OUT_EVERYWHERE = "Signing out everywhere...";
const SIGNED_OUT_EVERYWHERE = "Signed out on every device.";
const SIGN_OUT_EVERYWHERE_FAILED = "Could not sign out everywhere. Try again.";
const HIDDEN_CHARACTERS = "Names cannot have hidden characters.";

interface FormIssue {
  path: readonly PropertyKey[];
  code: string;
}

/** The auth form's fields as the shell and Lua name them, in the form's order. */
type AuthField = "email" | "password" | "name";
const AUTH_FIELD_ORDER: readonly AuthField[] = ["email", "password", "name"];
const authField = (issue: FormIssue): AuthField =>
  issue.path[0] === "email" ? "email" : issue.path[0] === "displayName" ? "name" : "password";

/** What to tell someone whose sign-in form the request schema refused, by one issue. */
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

/** Every field the schema refused, in the form's order, each with what to tell the user about it
 * (its first issue): all of them at once, not one per submit (audit PG9). */
function formProblems(issues: readonly FormIssue[], mode: "login" | "register", name = "") {
  const byField = new Map<AuthField, string>();
  for (const issue of issues) {
    const field = authField(issue);
    if (!byField.has(field)) byField.set(field, formProblem(issue, mode, name));
  }
  const fields = AUTH_FIELD_ORDER.filter((field) => byField.has(field));
  return { message: fields.map((field) => byField.get(field)).join(" "), fields };
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
  /** The form fields the last failed submit refused, for Lua to mark and focus. */
  private invalid: readonly AuthField[] = [];
  /** Failed submits so far, refused here or by the server: Lua says each one, a repeat too. */
  private failures = 0;
  private operation = 0;
  private revision = 0;
  /** A failed Google sign-in, shown once by the next anonymous refresh. */
  private authNotice = "";
  /** When the server last answered who is signed in. */
  private checkedAt = Number.NEGATIVE_INFINITY;
  /** The session check in flight, until it settles. */
  private checking: Promise<void> | undefined;
  constructor(private publish: (snapshot: string) => void) {}

  private emit() {
    const u = this.user;
    this.publish(
      encodeFields(
        wireRow(WIRE_ROWS.account.header, {
          revision: ++this.revision,
          status: this.status,
          busy: this.busy ? 1 : 0,
          message: this.message,
          id: u?.id ?? "",
          displayName: u?.displayName ?? "",
          email: u?.email ?? "",
          hasPassword: u?.hasPassword ? 1 : 0,
          namePrompt: u?.namePrompt ? 1 : 0,
          invalid: this.invalid.join(" "),
          failures: this.failures,
        }),
      ),
    );
  }

  /** Asks the server who is signed in, unless it answered within `maxAgeMs`; a check already in
   * flight answers instead, so a caller that needs the server's answer (the session recovery)
   * gets it rather than the status from before. With no answer yet (booting, or after a failed
   * check, where Retry sends this) the check shows as busy. A session the page already knows is
   * revalidated in the background: neither busy nor a message, and published only when the
   * status or the user changed. */
  refresh(maxAgeMs = 0): Promise<void> {
    if (this.checking) return this.checking;
    if (this.busy || Date.now() - this.checkedAt < maxAgeMs) return Promise.resolve();
    const visible = this.status === "loading" || this.status === "error";
    const check = this.check(visible).finally(() => {
      if (this.checking === check) this.checking = undefined;
    });
    this.checking = check;
    return check;
  }

  /** Whether the session survived, by the server's answer: the session recovery's handler. */
  async recover(): Promise<boolean> {
    await this.refresh();
    return this.status === "authenticated";
  }

  private async check(visible: boolean) {
    const op = ++this.operation;
    const before = this.sessionKey();
    if (visible) {
      this.busy = true;
      this.message = "";
      this.emit();
    }
    try {
      const user = await me();
      if (op !== this.operation) return;
      this.user = user;
      this.status = "authenticated";
      this.checkedAt = Date.now();
    } catch (error) {
      if (op !== this.operation) return;
      const gone = error instanceof ApiError && error.status === 401;
      // Unreachable in the background: keep what the page knows; the next navigation asks again.
      if (!visible && !gone) return;
      this.user = null;
      this.status = gone ? "anonymous" : "error";
      this.checkedAt = gone ? Date.now() : Number.NEGATIVE_INFINITY;
      if (visible) {
        this.message =
          this.status === "error" ? "Could not reach the server. Try again." : this.authNotice;
        this.authNotice = "";
      }
    } finally {
      if (op === this.operation && visible) {
        this.busy = false;
        this.emit();
      } else if (op === this.operation && this.sessionKey() !== before) this.emit();
    }
  }

  /** What a background check compares: the status and every published field of the user. */
  private sessionKey() {
    const u = this.user;
    return JSON.stringify([
      this.status,
      u?.id,
      u?.displayName,
      u?.email,
      u?.hasPassword,
      u?.namePrompt,
    ]);
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

  /** Signs this browser out, or with `everywhere` every session of the account (AU7). A 401 means
   * this session is gone already: signed out here, though for `everywhere` the others may live on,
   * which the message says. */
  async signOut(everywhere = false) {
    if (this.busy || !this.user) return;
    const op = ++this.operation;
    this.busy = true;
    this.message = everywhere ? SIGNING_OUT_EVERYWHERE : "Signing out...";
    this.emit();
    try {
      let expired = false;
      try {
        await (everywhere ? logoutAll() : logout());
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
        expired = true;
      }
      if (op !== this.operation) return;
      this.user = null;
      this.status = "anonymous";
      this.checkedAt = Date.now();
      this.message = !everywhere ? "" : expired ? SESSION_EXPIRED : SIGNED_OUT_EVERYWHERE;
    } catch {
      if (op === this.operation) {
        this.message = everywhere ? SIGN_OUT_EVERYWHERE_FAILED : "Could not sign out. Try again.";
      }
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
      this.refuse("Enter your password.", ["password"]);
      return;
    }
    if (!needsPassword && !confirmEmail) {
      this.refuse("Type your email to confirm.", ["email"]);
      return;
    }
    if (!needsPassword && confirmEmail.toLowerCase() !== this.user.email.toLowerCase()) {
      this.refuse(EMAIL_MISMATCH, ["email"]);
      return;
    }
    const op = ++this.operation;
    this.busy = true;
    this.invalid = [];
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
        this.invalid = status === 401 ? ["password"] : status === 403 ? ["email"] : [];
        this.failures++;
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
      else this.refuseForm(formProblems(request.error.issues, mode));
    } else {
      const request = registerRequestSchema.safeParse(form);
      if (request.success) await this.signIn(() => register(request.data));
      else this.refuseForm(formProblems(request.error.issues, mode, displayName));
    }
  }

  private refuseForm({ message, fields }: ReturnType<typeof formProblems>) {
    this.refuse(message, fields);
  }

  /** A failed submit: says why, marks `fields`, and counts it, so a repeat is said again. */
  private refuse(message: string, fields: readonly AuthField[] = []) {
    this.message = message;
    this.invalid = fields;
    this.failures++;
    this.emit();
  }

  private async signIn(send: () => Promise<User>) {
    const op = ++this.operation;
    this.busy = true;
    this.message = "";
    this.invalid = [];
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
      this.invalid = status === 409 ? ["email"] : [];
      this.failures++;
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
    if (action === "logout-all") await this.signOut(true);
    if (action === "google") await this.google();
    if (action === "clear-message" && !this.busy) {
      this.message = "";
      this.invalid = [];
      this.emit();
    }
  }
}
