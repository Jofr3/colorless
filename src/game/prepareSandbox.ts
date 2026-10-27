import { createGame, DECK_SIZE, isBasicPokemon } from "@colorless/engine";
import type { DeckCard } from "@colorless/schema";
import type { Deck } from "../decks/data";
import { fetchCardPool } from "./cardPool";
import type { LocalGameSetup } from "./localHost";
import { deckContents } from "./sandboxDecks";
import { SandboxSetupError } from "./sandboxSetupError";

/** Expand `{cardId, count}` rows (the persisted Deck shape) into the flat id
    list createGame expects. */
function expandDeck(cards: readonly DeckCard[]): string[] {
  const ids: string[] = [];
  for (const { cardId, count } of cards) {
    for (let i = 0; i < count; i++) ids.push(cardId);
  }
  return ids;
}

/** Check two saved decks can run, whatever their format, and create the sandbox match between them.
    The contents are the ones the picker judged: the summaries' own card lists, fetched only from an
    api that predates them. */
export async function prepareSandbox(decks: readonly [Deck, Deck]): Promise<LocalGameSetup> {
  const saved = await Promise.all([deckContents(decks[0]), deckContents(decks[1])]);
  for (const [index, deck] of saved.entries()) {
    const count = deck.cards.reduce((sum, card) => sum + card.count, 0);
    if (count !== DECK_SIZE) {
      throw new SandboxSetupError(
        `Player ${index + 1} — “${deck.name}” has ${count} cards; a deck needs exactly ${DECK_SIZE}.`,
      );
    }
  }
  const cardIdsByPlayer = [expandDeck(saved[0].cards), expandDeck(saved[1].cards)] as const;
  const { pool, missing } = await fetchCardPool(cardIdsByPlayer.flat());
  if (missing.length > 0) {
    throw new SandboxSetupError(`These cards aren't in the catalog: ${missing.join(", ")}`);
  }
  for (const [index, cardIds] of cardIdsByPlayer.entries()) {
    if (
      !cardIds.some((id) => {
        const card = pool[id];
        return card !== undefined && isBasicPokemon(card);
      })
    ) {
      throw new SandboxSetupError(
        `Player ${index + 1} has no Basic Pokémon, so it can't start a game.`,
      );
    }
  }
  const startedAt = Date.now();
  const created = createGame({
    seed: startedAt,
    decks: { p1: cardIdsByPlayer[0], p2: cardIdsByPlayer[1] },
    cardPool: pool,
  });
  if (!created.ok) {
    throw new SandboxSetupError(`Couldn't start the game: ${created.error.message}`);
  }
  return {
    state: created.state,
    events: created.events,
    names: { p1: "Player 1", p2: "Player 2" },
    startedAt,
  };
}
