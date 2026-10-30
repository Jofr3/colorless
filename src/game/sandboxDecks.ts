import { DECK_SIZE, formatById, isBasicPokemon, savedDeckReasons } from "@colorless/engine/rules";
import type { Card, Deck as SavedDeck } from "@colorless/schema";
import { ApiError, getDeck } from "../lib/api";
import type { Deck } from "../decks/data";
import { fetchCardPool } from "./cardPool";

/** What judging a deck reads: a summary's own fields, or the fetched deck's. */
type DeckContents = Pick<SavedDeck, "name" | "format" | "cards">;

/** What `createGame` needs to run a deck: exactly DECK_SIZE cards, every one in the pool, and a
 * Basic Pokémon to start with. Format and construction rules are not asked. */
function isPlayableDeck(deck: DeckContents, pool: Record<string, Card>): boolean {
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
const legalIn = (deck: DeckContents, pool: Record<string, Card>, format: string | null) =>
  savedDeckReasons(deck.cards, format, pool).length === 0;

/** What every deck screen reads about one complete deck: the sandbox's (playable), the online
 * picker's (legal in its own format, and in Standard and Expanded) and the library alert's
 * (legal). */
export type DeckVerdict = {
  /** The name on the judged contents, fresher than a summary fetched before them. */
  name: string;
  playable: boolean;
  legal: boolean;
  /** The deck's format, by name. */
  formatName: string;
  standard: boolean;
  expanded: boolean;
};

/** The contents behind `summary`: the card list GET /decks sends on a complete deck, or, from an
    api that predates it, a fetch of the deck. */
export async function deckContents(summary: Deck): Promise<DeckContents> {
  return summary.cards === undefined ? getDeck(summary.id) : { ...summary, cards: summary.cards };
}

/** Read the complete candidates' contents (fetching only those the list left out) and their card
 * pool with bounded requests, then judge each. Network failures remain retryable errors, rather
 * than silently classifying those decks as invalid; a deck deleted since the
 * summary was fetched (404) is simply absent from the result. */
export async function judgeDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<Map<string, DeckVerdict>> {
  const candidates = summaries.filter((deck) => deck.cardCount === DECK_SIZE);
  const queue = candidates.values();
  const saved = new Map<string, DeckContents>();
  const verdicts = new Map<string, DeckVerdict>();
  let failed = false;
  async function worker() {
    for (const deck of queue) {
      if (failed || !current()) return;
      try {
        saved.set(deck.id, await deckContents(deck));
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
      name: deck.name,
      playable: isPlayableDeck(deck, pool),
      legal: legalIn(deck, pool, deck.format),
      formatName: formatById(deck.format).name,
      standard: legalIn(deck, pool, "standard"),
      expanded: legalIn(deck, pool, "expanded"),
    });
  }
  return verdicts;
}

/** The decks among `summaries` a local game can run, carrying their fresh names. */
export function sandboxDecksFrom(summaries: Deck[], verdicts: Map<string, DeckVerdict>): Deck[] {
  return summaries.flatMap((summary) => {
    const verdict = verdicts.get(summary.id);
    return verdict?.playable ? [{ ...summary, name: verdict.name }] : [];
  });
}

export async function validSandboxDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<Deck[]> {
  return sandboxDecksFrom(summaries, await judgeDecks(summaries, current));
}

export type PlayableDeck = Deck & {
  /** Legal in its own format, so a lobby will start a match with it. */
  online: boolean;
  /** The deck's format, by name. */
  formatName: string;
  standard: boolean;
  expanded: boolean;
};

/** {@link sandboxDecksFrom} plus each deck's online verdict, and its Standard and Expanded
 * verdicts for the online picker's regulation filter. */
export function playableDecksFrom(
  summaries: Deck[],
  verdicts: Map<string, DeckVerdict>,
): PlayableDeck[] {
  return summaries.flatMap((summary) => {
    const v = verdicts.get(summary.id);
    if (!v?.playable) return [];
    const { name, legal, formatName, standard, expanded } = v;
    return [{ ...summary, name, online: legal, formatName, standard, expanded }];
  });
}

export async function playableDecks(
  summaries: Deck[],
  current: () => boolean,
): Promise<PlayableDeck[]> {
  return playableDecksFrom(summaries, await judgeDecks(summaries, current));
}

/** Per-deck legality in each deck's own format, for the library's illegal-deck alert: an
 * incomplete deck is illegal without a request; a complete one gets the verdict on its fetched
 * contents. A deck missing from the result could not be judged (deleted meanwhile, or the check
 * was superseded). */
export function legalityFrom(
  summaries: Deck[],
  verdicts: Map<string, DeckVerdict> = new Map(),
): Map<string, boolean> {
  const legality = new Map<string, boolean>();
  for (const deck of summaries) {
    const verdict = verdicts.get(deck.id);
    if (deck.cardCount !== DECK_SIZE) legality.set(deck.id, false);
    else if (verdict) legality.set(deck.id, verdict.legal);
  }
  return legality;
}

export async function deckLegality(
  summaries: Deck[],
  current: () => boolean,
): Promise<Map<string, boolean>> {
  return legalityFrom(summaries, await judgeDecks(summaries, current));
}
