// What the editor persists — the shape the debounced saver diffs and PATCHes
// (see ./deckSaver.ts for the timing/ordering rules). Pure, and split out of
// DeckBuilder so the two rules living in it can be argued with in a test:
// the card ORDER (which decides whether a save fires at all) and the cover PIN
// (which decides whether the server accepts it).

import type { DeckCard } from "@luminous/schema";

/** Name kept pre-trimmed so it either matches the server's own trim or is
    omitted (empty) from the PATCH body. */
export type DeckSnapshot = {
  name: string;
  format: string;
  cards: DeckCard[];
  /** The owner's cover pick (P5-6), null for the derived default. It rides the
      SAME debounced save as everything else — a cover is an edit like any
      other, and pairing it with the card list in ONE patch is what keeps the
      two consistent. */
  chosenCoverCardId: string | null;
};

export function toSnapshot(
  name: string,
  format: string,
  entries: Map<string, number>,
  chosenCoverCardId: string | null,
): DeckSnapshot {
  return {
    name: name.trim(),
    format,
    // A pin means nothing once its card has left the deck, and sending one
    // anyway is a patch that contradicts itself: the server answers 400, so
    // EVERY later save would fail too (the saver keeps retrying the same dirty
    // snapshot). Dropping it here is what keeps a removal from wedging saves.
    chosenCoverCardId:
      chosenCoverCardId !== null && entries.has(chosenCoverCardId) ? chosenCoverCardId : null,
    // Sorted so the saver's no-op key is insertion-order-independent (addCard
    // re-appends a removed id at the Map's end; a content-identical deck must
    // serialize identically or it fires a spurious PATCH).
    cards: [...entries]
      .map(([cardId, count]) => ({ cardId, count }))
      .sort((a, b) => a.cardId.localeCompare(b.cardId)),
  };
}
