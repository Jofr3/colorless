import type { Card, Deck as SavedDeck } from "@luminous/schema";
import { ApiError, getDeck } from "../../lib/api";
import { formatById } from "../builder/cards";
import { toBuilderCard } from "../builder/catalog";
import { validateDeck, type DeckEntry } from "../builder/deckMath";
import type { Deck } from "../decks/data";
import { fetchCardPool } from "../game/cardPool";

/** Use the builder's full legality verdict, including format and copy limits. */
export function isValidSandboxDeck(deck: SavedDeck, pool: Record<string, Card>): boolean {
  const entries: DeckEntry[] = [];
  for (const entry of deck.cards) {
    const card = pool[entry.cardId];
    if (!card || !Number.isInteger(entry.count) || entry.count <= 0) return false;
    entries.push({ card: toBuilderCard(card), quantity: entry.count });
  }
  return validateDeck(entries, formatById(deck.format ?? "standard")).legal;
}

/** Check complete candidates with bounded requests. Network failures remain
 * retryable errors, rather than silently classifying those decks as invalid. */
export async function validSandboxDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<Deck[]> {
  const candidates = summaries.filter((deck) => deck.cardCount === 60);
  const queue = candidates.values();
  const saved = new Map<string, SavedDeck>();
  let failed = false;
  async function worker() {
    for (const deck of queue) {
      if (failed || !current()) return;
      try {
        saved.set(deck.id, await getDeck(deck.id));
      } catch (error) {
        // A deck may have been deleted after the library summary was fetched.
        if (error instanceof ApiError && error.status === 404) continue;
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
  if (!current()) return [];
  const { pool } = await fetchCardPool(
    [...saved.values()].flatMap((deck) => deck.cards.map((entry) => entry.cardId)),
  );
  if (!current()) return [];
  return candidates.flatMap((summary) => {
    const deck = saved.get(summary.id);
    return deck && isValidSandboxDeck(deck, pool) ? [{ ...summary, name: deck.name }] : [];
  });
}
