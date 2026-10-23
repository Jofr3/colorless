// P5-3 — which card is a deck's face in the library grid (polish.md "Deck covers
// / art"). Until now every deck rendered the same blue card back under a
// generated tint; the catalog has had real scans since P2.
//
// The whole RULE lives in this pure function rather than in SQL, so it can be
// argued with and tested. The query half hands it every card in a deck with the
// three facts the rule needs.

/** One deck row, joined to what the catalog knows about the card. */
export type CoverCandidate = {
  cardId: string;
  /** Copies in the deck. */
  count: number;
  /** "Pokemon" | "Trainer" | "Energy" — only Pokémon can be a cover. */
  category: string;
  /** Printed HP; null on Energy and most Trainers. */
  hp: number | null;
  /** Whether the catalog has a scan for it (`cards.image_url`). */
  hasImage: boolean;
};

/**
 * A deck's cover card, or null when no Pokémon with a scan qualifies. Picks the Pokémon with the
 * highest printed HP, breaking ties by copy count and then card id so the choice is stable.
 */
export function pickCoverCardId(candidates: readonly CoverCandidate[]): string | null {
  let best: CoverCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.category !== "Pokemon" || !candidate.hasImage) continue;
    if (best === null || outranks(candidate, best)) best = candidate;
  }
  return best === null ? null : best.cardId;
}

/**
 * The card a deck tile draws: the owner's pick when it is still in the deck and has a scan,
 * otherwise the derived default.
 */
export function effectiveCoverCardId(
  chosen: string | null,
  candidates: readonly CoverCandidate[],
): string | null {
  const pinned = candidates.find((candidate) => candidate.cardId === chosen);
  // A pinned TRAINER or ENERGY is fine here — the owner is allowed a signature
  // Supporter as their deck's face; only the DERIVED default is Pokémon-only,
  // because guessing needs a rule and choosing does not.
  if (pinned?.hasImage) return pinned.cardId;
  return pickCoverCardId(candidates);
}

/** Strictly better cover than `best`: more HP, else more copies, else the lower
    card id — a total order, so the pick never depends on row order. */
function outranks(candidate: CoverCandidate, best: CoverCandidate): boolean {
  const hp = candidate.hp ?? 0;
  const bestHp = best.hp ?? 0;
  if (hp !== bestHp) return hp > bestHp;
  if (candidate.count !== best.count) return candidate.count > best.count;
  return candidate.cardId < best.cardId;
}
