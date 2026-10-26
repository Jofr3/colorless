import { DECK_SIZE, formatById, isBasicPokemon, savedDeckReasons } from "@colorless/engine";
import type { Card, Deck as SavedDeck } from "@colorless/schema";
import { ApiError, getDeck } from "../lib/api";
import type { Deck } from "../decks/data";
import { fetchCardPool } from "./cardPool";

/** What `createGame` needs to run a deck: exactly DECK_SIZE cards, every one in the pool, and a
 * Basic Pokémon to start with. Format and construction rules are not asked. */
function isPlayableDeck(deck: SavedDeck, pool: Record<string, Card>): boolean {
  let total = 0;
  let basic = false;
  for (const { cardId, count } of deck.cards) {
    const card = pool[cardId];
    if (card === undefined || !Number.isInteger(count) || count <= 0) return false;
    total += count;
    basic ||= isBasicPokemon(card);
  }
  return total === DECK_SIZE && basic;
}

/** The online verdict: legal in its own format, which is what a lobby checks at match start. */
const legalIn = (deck: SavedDeck, pool: Record<string, Card>, format: string | null) =>
  savedDeckReasons(deck.cards, format, pool).length === 0;

type Verdict = { deck: SavedDeck; playable: boolean; legal: boolean; pool: Record<string, Card> };

/** Fetch the complete candidates' contents and their card pool with bounded
 * requests, then judge each. Network failures remain retryable errors, rather
 * than silently classifying those decks as invalid; a deck deleted since the
 * summary was fetched (404) is simply absent from the result. */
async function judgeSandboxDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<Map<string, Verdict>> {
  const candidates = summaries.filter((deck) => deck.cardCount === DECK_SIZE);
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
    verdicts.set(id, {
      deck,
      playable: isPlayableDeck(deck, pool),
      legal: legalIn(deck, pool, deck.format),
      pool,
    });
  }
  return verdicts;
}

/** The decks among `summaries` a local game can run, carrying their fresh names. */
export async function validSandboxDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<Deck[]> {
  const verdicts = await judgeSandboxDecks(summaries, current);
  return summaries.flatMap((summary) => {
    const verdict = verdicts.get(summary.id);
    return verdict?.playable ? [{ ...summary, name: verdict.deck.name }] : [];
  });
}

export type PlayableDeck = Deck & {
  /** Legal in its own format, so a lobby will start a match with it. */
  online: boolean;
  /** The deck's format, by name. */
  formatName: string;
  standard: boolean;
  expanded: boolean;
};

/** {@link validSandboxDecks} plus each deck's online verdict, and its Standard and Expanded
 * verdicts for the online picker's regulation filter. */
export async function playableDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<PlayableDeck[]> {
  const verdicts = await judgeSandboxDecks(summaries, current);
  return summaries.flatMap((summary) => {
    const v = verdicts.get(summary.id);
    if (!v?.playable) return [];
    return [
      {
        ...summary,
        name: v.deck.name,
        online: v.legal,
        formatName: formatById(v.deck.format).name,
        standard: legalIn(v.deck, v.pool, "standard"),
        expanded: legalIn(v.deck, v.pool, "expanded"),
      },
    ];
  });
}

/** Per-deck legality in each deck's own format, for the library's illegal-deck
 * alert: an incomplete deck is illegal without a request; a complete one gets
 * the verdict on its fetched contents. A deck missing from the result could not
 * be judged (deleted meanwhile, or the check was superseded). */
export async function deckLegality(
  summaries: Deck[],
  current: () => boolean,
): Promise<Map<string, boolean>> {
  const legality = new Map<string, boolean>();
  for (const deck of summaries) if (deck.cardCount !== DECK_SIZE) legality.set(deck.id, false);
  const verdicts = await judgeSandboxDecks(summaries, current);
  for (const [id, verdict] of verdicts) legality.set(id, verdict.legal);
  return legality;
}
