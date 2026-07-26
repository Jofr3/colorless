import { UserIcon } from "./icons";

// A player's face (P5-2). Generated, not uploaded: the server hands out an
// `avatarSeed` derived from the account behind it (apps/api auth/avatar.ts), and
// the same seed always draws the same face — so an opponent you meet twice looks
// the same both times, with nothing stored and nothing to upload. When real
// avatars land, an image simply wins over this.
//
// Shared (not lobby-local) since P5-5: /settings shows a player their OWN face
// from the seed on `User`, and it must be the same drawing the lobby broadcasts,
// which means the same component, not a second one that looks similar.
//
// An ANONYMOUS seat (no account, so no seed) keeps the generic figure. That is
// the honest rendering: inventing a face from a throwaway per-lobby id would
// promise an identity that changes on the player's next visit.

/** Two hues from the seed, far enough apart to read as a deliberate gradient.
    Saturation and lightness are FIXED so every generated avatar sits in the same
    register as the rest of the glass UI — the seed picks the hue, never how loud
    the result is, which is what stops one player's face glowing next to another's. */
function huesOf(seed: string): [number, number] {
  const value = Number.parseInt(seed, 16);
  const base = (Number.isNaN(value) ? 0 : value) % 360;
  return [base, (base + 55) % 360];
}

/** The letter drawn over the gradient — the same "first character of the name"
    the account control in the corner already uses, so the two read as the same
    person. Falls back to nothing rather than a placeholder letter: an empty name
    is the server's fallback case, and a bare gradient beats a wrong initial. */
function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase();
}

export function PlayerAvatar({
  name,
  seed,
  className = "",
}: {
  name: string;
  /** The account token, or null for an anonymous seat. */
  seed: string | null;
  /** Sizing/positioning from the caller; the shape and ring are fixed here. */
  className?: string;
}) {
  const shell = `flex shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-white/10 ${className}`;
  if (seed === null) {
    return (
      // aria-hidden throughout: the name sits beside it in the DOM, so a screen
      // reader announcing the avatar as well would just say it twice.
      <div className={`bg-white/[0.06] text-white/45 ${shell}`} aria-hidden="true">
        <UserIcon className="h-5 w-5" />
      </div>
    );
  }
  const [from, to] = huesOf(seed);
  return (
    <div
      className={`text-sm font-semibold text-white/90 ${shell}`}
      aria-hidden="true"
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${from} 62% 52%), hsl(${to} 62% 38%))`,
      }}
    >
      {initialOf(name)}
    </div>
  );
}
