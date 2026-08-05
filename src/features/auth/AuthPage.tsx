import type { FormEvent } from "react";
import { useId, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AppBackdrop } from "../../components/AppBackdrop";
import { HomeButton } from "../../components/HomeButton";
import { SpinnerIcon } from "../../components/icons";
import { ApiError } from "../../lib/api";
import {
  ERROR_TEXT,
  GLASS_ACCENT_BUTTON,
  GLASS_INPUT,
  GLASS_NEUTRAL_BUTTON,
  GLASS_PANEL,
} from "../../lib/glass";
import { useAuth } from "./AuthProvider";
import { type OAuthProvider, startOAuth } from "./startOAuth";

// The /login and /register pages — one centered glass form in two modes,
// matching the OnlineHub's visual language (panel, pill inputs, accent
// submit, "or" divider). Client-side validation is deliberately minimal
// (non-empty, email shape, register's known min-8 password); the server is
// the real validator, and its ApiErrors map to friendly aria-live copy
// below the submit button.
//
// Arriving with `location.state.from` (the AccountButton sets it) sends a
// successful sign-in back where the user came from; otherwise to /decks,
// the page that actually needs an account.

type Mode = "login" | "register";

const BUTTON_LAYOUT =
  "inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
const PRIMARY_BUTTON_CLASS = `${BUTTON_LAYOUT} ${GLASS_ACCENT_BUTTON}`;
const SECONDARY_BUTTON_CLASS = `${BUTTON_LAYOUT} ${GLASS_NEUTRAL_BUTTON}`;
const PANEL_CLASS = `flex flex-col gap-4 rounded-3xl p-5 ${GLASS_PANEL}`;

// The app's shared text-input recipe (glass.ts) with this form's spacing.
const INPUT_CLASS = `${GLASS_INPUT} px-4 py-2.5 placeholder:text-white/35`;
const LABEL_CLASS = "mb-1.5 block text-xs font-medium text-white/55";

// Deliberately loose — just "looks like an email". z.email() on the server
// is the real gate; this only catches obvious slips before a round-trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Friendly copy for a failed submit (backend-data.md §6 error semantics). */
function messageForError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Couldn't reach the server — check your connection and try again.";
  }
  switch (error.status) {
    case 400: {
      // The api's terse `{error}` string when it sent one, else a generic.
      const body = error.body as { error?: unknown } | undefined;
      return typeof body?.error === "string"
        ? body.error
        : "That doesn't look right — check the fields and try again.";
    }
    case 401:
      return "Wrong email or password.";
    case 409:
      return "That email already has an account.";
    case 429:
      return "Too many attempts — wait a moment.";
    default:
      return "Something went wrong — try again.";
  }
}

const PROVIDER_NAMES: Record<OAuthProvider, string> = {
  discord: "Discord",
  google: "Google",
};

function AuthPage({ mode }: { mode: Mode }) {
  const { status, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Where a successful sign-in lands. Only in-app paths are honoured — a
  // leading "//" is a scheme-relative URL, i.e. an off-site redirect.
  const state = location.state as { from?: unknown } | null;
  const from =
    typeof state?.from === "string" && state.from.startsWith("/") && !state.from.startsWith("//")
      ? state.from
      : "/decks";

  // Already signed in — these pages have nothing to offer. Same target as the
  // submit handler below: the context flips to "authenticated" during the
  // await, so this render-time redirect can outrun `navigate(from)` — they
  // must agree on the destination.
  if (status === "authenticated") return <Navigate to={from} replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || oauthBusy) return;

    const trimmedEmail = email.trim();
    if (!EMAIL_SHAPE.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password === "") {
      setError(mode === "login" ? "Enter your password." : "Choose a password.");
      return;
    }
    // The one server rule worth catching client-side: register's min length.
    if (mode === "register" && password.length < 8) {
      setError("Passwords need at least 8 characters.");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login({ email: trimmedEmail, password });
      } else {
        const trimmedName = displayName.trim();
        await register({
          email: trimmedEmail,
          password,
          ...(trimmedName === "" ? {} : { displayName: trimmedName }),
        });
      }
      // No setBusy(false) on success — the navigation unmounts this page.
      navigate(from, { replace: true });
    } catch (submitError) {
      setError(messageForError(submitError));
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    if (busy || oauthBusy) return;
    setOauthError(null);
    setOauthBusy(provider);
    const outcome = await startOAuth(provider);
    // "redirected" means window.location is already changing — keep the
    // button disabled so nothing double-fires while the page tears down.
    if (outcome === "redirected") return;
    setOauthBusy(null);
    setOauthError(
      outcome === "unconfigured"
        ? `${PROVIDER_NAMES[provider]} sign-in isn't set up yet.`
        : `Couldn't start ${PROVIDER_NAMES[provider]} sign-in — try again.`,
    );
  };

  const title = mode === "login" ? "Sign in" : "Create account";

  return (
    <AppBackdrop>
      <HomeButton />
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
        <h1 className="sr-only">{title}</h1>

        <section className={PANEL_CLASS}>
          <div>
            <h2 className="text-base font-semibold text-white/90">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {mode === "login"
                ? "Sign in to get to your decks."
                : "Your decks follow you once you have an account."}
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
            <div>
              <label htmlFor={emailId} className={LABEL_CLASS}>
                Email
              </label>
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                autoComplete="email"
                spellCheck={false}
                placeholder="you@example.com"
                className={INPUT_CLASS}
              />
            </div>

            {mode === "register" && (
              <div>
                <label htmlFor={nameId} className={LABEL_CLASS}>
                  Display name <span className="font-normal text-white/35">(optional)</span>
                </label>
                <input
                  id={nameId}
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={busy}
                  autoComplete="nickname"
                  maxLength={64}
                  placeholder="How opponents see you"
                  className={INPUT_CLASS}
                />
              </div>
            )}

            <div>
              <label htmlFor={passwordId} className={LABEL_CLASS}>
                Password
              </label>
              <input
                id={passwordId}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                className={INPUT_CLASS}
              />
            </div>

            {/* <output> carries an implicit polite live region, so submit
                failures are announced to assistive tech. */}
            <output className="block empty:hidden">
              {error && <p className={`text-sm ${ERROR_TEXT}`}>{error}</p>}
            </output>

            <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
              {busy ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  {mode === "login" ? "Signing in…" : "Creating account…"}
                </>
              ) : (
                title
              )}
            </button>
          </form>
        </section>

        <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-white/30">
          <span className="h-px flex-1 bg-white/10" />
          or continue with
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            {(["discord", "google"] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => handleOAuth(provider)}
                disabled={busy || oauthBusy !== null}
                className={SECONDARY_BUTTON_CLASS}
              >
                {oauthBusy === provider ? (
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                ) : (
                  PROVIDER_NAMES[provider]
                )}
              </button>
            ))}
          </div>
          <output className="block empty:hidden">
            {oauthError && <p className={`text-center text-sm ${ERROR_TEXT}`}>{oauthError}</p>}
          </output>
        </div>

        <p className="text-center text-sm text-muted">
          {mode === "login" ? "New here? " : "Already have an account? "}
          {/* Carry `state.from` across so switching forms doesn't lose the
              return destination. */}
          <Link
            to={mode === "login" ? "/register" : "/login"}
            state={location.state}
            className="rounded font-medium text-white/80 underline-offset-4 transition-colors motion-reduce:transition-none hover:text-white hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </Link>
        </p>
      </main>
    </AppBackdrop>
  );
}

export function Login() {
  return <AuthPage mode="login" />;
}

export function Register() {
  return <AuthPage mode="register" />;
}
