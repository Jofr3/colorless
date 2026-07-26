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
  /** Printed HP; null on Trainers and Energy. */
  hp: number | null;
  /** Whether the catalog has a scan for it (`cards.image_url`). */
  hasImage: boolean;
};

/** A deck's cover card, or null when nothing in it qualifies (an empty deck, or
    one with no Pokémon scan yet) — the caller falls back to the card back, which
    is also exactly right for a deck you have only just created.

    **The rule: the Pokémon with the highest printed HP.** HP is the best proxy
    the catalog offers for "the card this deck is built around", and it is a
    single number rather than a taxonomy to interpret: an ex/V/VMAX or a Stage 2
    outranks the Basics that fetch it, WITHOUT needing to rank the `stage` values
    against each other — which is what makes it beat the obvious alternatives.
    Ranking by STAGE alone gets a Basic-ex deck wrong (a 330 HP Basic ex is the
    deck's payoff, and would lose to any Stage 2 tech line); ranking by COUNT
    alone gets almost every evolution deck wrong (the 4-of Basic beats the 3-of
    Stage 2 it evolves into). Count still breaks HP ties, so between two equal
    bodies the one the deck actually runs more of wins, and the card id breaks
    the rest so the same deck always shows the same face.

    It is a HEURISTIC and will occasionally pick a wall over the attacker beside
    it. That is acceptable for a DEFAULT — since P5-6 the owner can pin their own
    (see `effectiveCoverCardId`), and this is what a deck wears until they do.
    Cards with no scan are skipped rather than picked and rendered blank. */
export function pickCoverCardId(candidates: readonly CoverCandidate[]): string | null {
  let best: CoverCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.category !== "Pokemon" || !candidate.hasImage) continue;
    if (best === null || outranks(candidate, best)) best = candidate;
  }
  return best === null ? null : best.cardId;
}

/** The card a deck's grid tile actually draws: **the owner's pick wins**, and
    everything else falls back to the derived default.

    P5-6 — the follow-up P5-3 left room for. The pin is honoured only while it
    names a card that is still IN the deck and still has a scan, which is why
    this is a resolution rather than a plain `??`. PATCH keeps the first half
    true (a pinned card removed from the deck drops the pin with it), so the
    membership check here is a belt-and-braces on a row edited by some other
    path — but the SCAN half is live: the catalog is re-ingested, and a deck must
    never front a blank rectangle because a picture moved. Both checks run
    against the candidate list the default is derived from anyway, so honouring
    a choice costs no query at all. */
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
