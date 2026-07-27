import type { FormEvent } from "react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { User } from "@luminous/schema";
import { CardImage } from "../../components/CardImage";
import { SpinnerIcon } from "../../components/icons";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { ApiError, cardImageUrl } from "../../lib/api";
import { ERROR_TEXT, GLASS_ACCENT_BUTTON, GLASS_INPUT, GLASS_PANEL } from "../../lib/glass";
import { useAuth } from "../auth/AuthProvider";
import { useDeckLibrary } from "../decks/useDeckLibrary";

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
// The favourite-deck picker, styled as the name field's pill so the two rows
// read as one form. disabled:opacity keeps it legible while the library loads.
const SELECT_CLASS = `${GLASS_INPUT} cursor-pointer px-4 py-2.5 disabled:cursor-wait disabled:opacity-50`;
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
            className="rounded font-medium text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 motion-reduce:transition-none"
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
  // The picker needs my own library — enabled unconditionally, since this form
  // only renders for a signed-in account. A load failure just leaves the select
  // disabled: a name-only save still works without it.
  const { decks, phase: decksPhase } = useDeckLibrary(true);
  const [draftName, setDraftName] = useState(user.displayName);
  const [draftFavourite, setDraftFavourite] = useState<string | null>(user.favouriteDeckId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nameId = useId();
  const favouriteId = useId();

  const trimmed = draftName.trim();
  // Same rule the server enforces; `maxLength` below keeps the upper bound from
  // ever being reachable, so name validity is really "not blank".
  const nameValid = trimmed !== "" && trimmed.length <= 64;
  const nameChanged = trimmed !== user.displayName;
  const favouriteChanged = draftFavourite !== user.favouriteDeckId;
  // Save lights up for a valid change to EITHER field — both ride one PATCH.
  const canSave = nameValid && (nameChanged || favouriteChanged);

  // The chosen deck's cover, resolved from MY loaded library (never a copy
  // stored on the account), so a rename or a re-cover shows through and a
  // favourite whose deck has since vanished simply resolves to a blank tile —
  // the same "derive on read, tolerate stale" the covers themselves use.
  const favouriteDeck = decks.find((deck) => deck.id === draftFavourite) ?? null;
  const coverUrl =
    favouriteDeck && favouriteDeck.coverCardId !== null
      ? cardImageUrl(favouriteDeck.coverCardId, "low")
      : undefined;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || saving) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      // Name + favourite in one body; the provider adopts the api's answer, so
      // the corner account control and every other reader of `user` follow
      // without a re-probe.
      await updateProfile({ displayName: trimmed, favouriteDeckId: draftFavourite });
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

      <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
        <div className="flex items-end gap-3">
          {/* Follows the field as you type — the initial is drawn from the name,
              so the face and the name can't disagree on screen. */}
          <PlayerAvatar name={draftName} seed={user.avatarSeed} className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <label htmlFor={nameId} className={LABEL_CLASS}>
              Display name
            </label>
            <input
              id={nameId}
              type="text"
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value);
                setSaved(false);
              }}
              maxLength={64}
              autoComplete="nickname"
              placeholder="Your name"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex items-end gap-3">
          {/* The chosen deck's cover — the same art the decks grid fronts it
              with (P5-3/P5-6). A neutral tile stands in for "no favourite" or a
              deck with nothing to show yet. */}
          <div className="aspect-[2.5/3.5] w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-inset ring-white/10">
            <CardImage
              fill
              imageUrl={coverUrl}
              alt={favouriteDeck ? `${favouriteDeck.name} cover` : "No favourite deck"}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor={favouriteId} className={LABEL_CLASS}>
              Favourite deck
            </label>
            <select
              id={favouriteId}
              value={draftFavourite ?? ""}
              onChange={(e) => {
                setDraftFavourite(e.target.value === "" ? null : e.target.value);
                setSaved(false);
              }}
              disabled={decksPhase !== "ready"}
              className={SELECT_CLASS}
            >
              <option value="" className="bg-surface text-white">
                No favourite
              </option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id} className="bg-surface text-white">
                  {deck.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={!canSave || saving} className={SAVE_BUTTON_CLASS}>
            {saving && <SpinnerIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
            Save
          </button>
          <output className="empty:hidden">
            {error && <p className={`text-sm ${ERROR_TEXT}`}>{error}</p>}
            {saved && !error && <p className="text-sm text-white/55">Saved.</p>}
          </output>
        </div>
      </form>

      <p className="mt-4 truncate border-t border-white/10 pt-4 text-xs text-white/35">
        Signed in as {user.email}
      </p>
    </section>
  );
}
