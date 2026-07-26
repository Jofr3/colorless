import type { FormEvent } from "react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { User } from "@luminous/schema";
import { SpinnerIcon } from "../../components/icons";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { ApiError } from "../../lib/api";
import { ERROR_TEXT, GLASS_ACCENT_BUTTON, GLASS_INPUT, GLASS_PANEL } from "../../lib/glass";
import { useAuth } from "../auth/AuthProvider";

// The account section of /settings (P5-5 — polish.md "Profiles"). P5-1 made a
// lobby seat's name the ACCOUNT's, resolved server-side and broadcast to the
// opponent and to spectators — which left a player named by whatever register
// picked, with nowhere to change it. This is that surface: the name, and the
// generated face (P5-2) drawn from the seed /auth/me now carries.
//
// It shows the REAL avatar, not a lookalike: the same component the lobby uses,
// fed the account's own seed, so "how you appear to other players" is a
// statement rather than an approximation. A rename reaches a lobby at the next
// hello (apps/api lobby/displayName.ts resolves the seat name there), so a
// player already seated elsewhere keeps the old name until they rejoin.

const PANEL_CLASS = `rounded-2xl p-5 ${GLASS_PANEL}`;
const INPUT_CLASS = `${GLASS_INPUT} px-4 py-2.5 placeholder:text-white/35`;
const LABEL_CLASS = "mb-1.5 block text-xs font-medium text-white/55";
const SAVE_BUTTON_CLASS = `inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${GLASS_ACCENT_BUTTON}`;

/** The register/login copy, narrowed to what a rename can actually fail on. */
function messageForError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Couldn't reach the server — check your connection and try again.";
  }
  switch (error.status) {
    case 400:
      return "That name doesn't fit — use 1 to 64 characters.";
    case 401:
      return "Your session expired — sign in again.";
    default:
      return "Something went wrong — try again.";
  }
}

export function ProfileSection() {
  const { status, user } = useAuth();

  // The panel keeps its place through the mount-time session probe: /settings
  // is vertically centered, so a section that appears late shifts the page.
  if (status === "loading") {
    return (
      <section className={PANEL_CLASS} aria-busy="true">
        <h2 className="text-base font-semibold text-white/90">Profile</h2>
        <p className="mt-0.5 text-sm text-muted">Checking your session…</p>
      </section>
    );
  }

  if (user === null) {
    return (
      <section className={PANEL_CLASS}>
        <h2 className="text-base font-semibold text-white/90">Profile</h2>
        <p className="mt-0.5 text-sm text-muted">
          <Link
            to="/login"
            state={{ from: "/settings" }}
            className="rounded font-medium text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
          >
            Sign in
          </Link>{" "}
          to choose the name and face other players see.
        </p>
      </section>
    );
  }

  // Keyed by account so switching users re-seeds the draft from the new name
  // instead of carrying the previous one into the field.
  return <ProfileForm key={user.id} user={user} />;
}

function ProfileForm({ user }: { user: User }) {
  const { updateProfile, refresh } = useAuth();
  const [draft, setDraft] = useState(user.displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nameId = useId();

  const trimmed = draft.trim();
  // Same rule the server enforces; `maxLength` below keeps the upper bound
  // from ever being reachable, so this is really "not blank, not unchanged".
  const canSave = trimmed !== "" && trimmed.length <= 64 && trimmed !== user.displayName;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || saving) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      // The provider adopts the api's answer, so the corner account control
      // and every other reader of `user` follow without a re-probe.
      await updateProfile({ displayName: trimmed });
      setSaved(true);
    } catch (caught) {
      setError(messageForError(caught));
      // A 401 here means the session died since the mount-time probe. /auth/*
      // is excluded from the client's retry-once recovery (there a 401 IS the
      // answer), so ask once: the app flips to signed-out and this section
      // becomes the sign-in prompt, which says it better than the error line.
      if (caught instanceof ApiError && caught.status === 401) void refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={PANEL_CLASS}>
      <h2 className="text-base font-semibold text-white/90">Profile</h2>
      <p className="mt-0.5 text-sm text-muted">How you appear to other players.</p>

      <form onSubmit={handleSubmit} noValidate className="mt-4 flex items-end gap-3">
        {/* Follows the field as you type — the initial is drawn from the name,
            so the face and the name can't disagree on screen. */}
        <PlayerAvatar name={draft} seed={user.avatarSeed} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <label htmlFor={nameId} className={LABEL_CLASS}>
            Display name
          </label>
          <input
            id={nameId}
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved(false);
            }}
            maxLength={64}
            autoComplete="nickname"
            placeholder="Your name"
            className={INPUT_CLASS}
          />
        </div>
        <button type="submit" disabled={!canSave || saving} className={SAVE_BUTTON_CLASS}>
          {saving && <SpinnerIcon className="h-4 w-4 animate-spin" />}
          Save
        </button>
      </form>

      <output className="mt-2 block empty:hidden">
        {error && <p className={`text-sm ${ERROR_TEXT}`}>{error}</p>}
        {saved && !error && <p className="text-sm text-white/55">Saved.</p>}
      </output>

      <p className="mt-4 truncate border-t border-white/10 pt-4 text-xs text-white/35">
        Signed in as {user.email}
      </p>
    </section>
  );
}
