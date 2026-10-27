// Resolves a lobby seat's name from the account rather than trusting the hello frame, so a player
// cannot present as someone else.

/** An account's stored display name as a lobby should use it: trimmed, or null
    when there is nothing usable.

    Null rather than a fallback, because the ONE fallback that suggests itself
    here — the email, which `AccountButton` uses — must never be taken: that
    control shows a user their OWN address, while a lobby name is broadcast to
    the opponent (and to spectators since P4 3c-vii). A blank name is a cosmetic
    problem; a published email address is not. The caller falls back to the
    client-announced handle instead. Pure. */
export function lobbyDisplayName(stored: string | null | undefined): string | null {
  const trimmed = (stored ?? "").trim();
  return trimmed === "" ? null : trimmed;
}
