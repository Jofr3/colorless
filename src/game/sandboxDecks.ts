import type { Card, Deck as SavedDeck } from "@luminous/schema";
import { ApiError, getDeck } from "../lib/api";
import { formatById } from "../decks/cards";
import { toBuilderCard } from "../decks/catalog";
import { validateDeck, type DeckEntry } from "../decks/deckMath";
import type { Deck } from "../decks/data";
import { fetchCardPool } from "./cardPool";

/** The deck as builder entries, or null when a card is missing or a count is bad. */
function deckEntries(deck: SavedDeck, pool: Record<string, Card>): DeckEntry[] | null {
  const entries: DeckEntry[] = [];
  for (const entry of deck.cards) {
    const card = pool[entry.cardId];
    if (!card || !Number.isInteger(entry.count) || entry.count <= 0) return null;
    entries.push({ card: toBuilderCard(card), quantity: entry.count });
  }
  return entries;
}

const legalIn = (entries: DeckEntry[] | null, format: string) =>
  entries !== null && validateDeck(entries, formatById(format)).legal;

/** Use the builder's full legality verdict, including format and copy limits. */
export function isValidSandboxDeck(deck: SavedDeck, pool: Record<string, Card>): boolean {
  return legalIn(deckEntries(deck, pool), deck.format ?? "standard");
}

type Verdict = { deck: SavedDeck; valid: boolean; entries: DeckEntry[] | null };

/** Fetch the complete candidates' contents and their card pool with bounded
 * requests, then judge each. Network failures remain retryable errors, rather
 * than silently classifying those decks as invalid; a deck deleted since the
 * summary was fetched (404) is simply absent from the result. */
async function judgeSandboxDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<Map<string, Verdict>> {
  const candidates = summaries.filter((deck) => deck.cardCount === 60);
  const queue = candidates.values();
  const saved = new Map<string, SavedDeck>();
  const verdicts = new Map<string, Verdict>();
  let failed = false;
  async function worker() {
    for (const deck of queue) {
      if (failed || !current()) return;
      try {
        saved.set(deck.id, await getDeck(deck.id));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) continue;
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
  if (!current()) return verdicts;
  const { pool } = await fetchCardPool(
    [...saved.values()].flatMap((deck) => deck.cards.map((entry) => entry.cardId)),
  );
  if (!current()) return verdicts;
  for (const [id, deck] of saved) {
    const entries = deckEntries(deck, pool);
    verdicts.set(id, { deck, valid: legalIn(entries, deck.format ?? "standard"), entries });
  }
  return verdicts;
}

/** The complete, legal decks among `summaries`, carrying their fresh names. */
export async function validSandboxDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<Deck[]> {
  const verdicts = await judgeSandboxDecks(summaries, current);
  return summaries.flatMap((summary) => {
    const verdict = verdicts.get(summary.id);
    return verdict?.valid ? [{ ...summary, name: verdict.deck.name }] : [];
  });
}

export type PlayableDeck = Deck & { standard: boolean; expanded: boolean };

/** {@link validSandboxDecks} plus each deck's Standard and Expanded verdicts,
 * for the online picker's regulation filter (a view filter only). */
export async function playableDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<PlayableDeck[]> {
  const verdicts = await judgeSandboxDecks(summaries, current);
  return summaries.flatMap((summary) => {
    const v = verdicts.get(summary.id);
    if (!v?.valid) return [];
    return [
      {
        ...summary,
        name: v.deck.name,
        standard: legalIn(v.entries, "standard"),
        expanded: legalIn(v.entries, "expanded"),
      },
    ];
  });
}

/** Per-deck legality for a library listing, for the illegal-deck alert: an
 * incomplete deck is illegal without a request; a complete one gets the
 * builder's verdict on its fetched contents. A deck missing from the result
 * could not be judged (deleted meanwhile, or the check was superseded). */
export async function deckLegality(
  summaries: Deck[],
  current: () => boolean,
): Promise<Map<string, boolean>> {
  const legality = new Map<string, boolean>();
  for (const deck of summaries) if (deck.cardCount !== 60) legality.set(deck.id, false);
  const verdicts = await judgeSandboxDecks(summaries, current);
  for (const [id, verdict] of verdicts) legality.set(id, verdict.valid);
  return legality;
}
