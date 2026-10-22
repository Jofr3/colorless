import { createGame, DECK_SIZE, isBasicPokemon } from "@luminous/engine";
import type { DeckCard } from "@luminous/schema";
import { getDeck } from "../lib/api";
import { fetchCardPool } from "./cardPool";
import type { LocalGameSetup } from "./localHost";
import { isValidSandboxDeck } from "./sandboxDecks";

export class SandboxSetupError extends Error {}

/** Expand `{cardId, count}` rows (the persisted Deck shape) into the flat id
    list createGame expects. */
function expandDeck(cards: readonly DeckCard[]): string[] {
  const ids: string[] = [];
  for (const { cardId, count } of cards) {
    for (let i = 0; i < count; i++) ids.push(cardId);
  }
  return ids;
}

/** Validate two saved decks and create the sandbox match between them. */
export async function prepareSandbox(
  ids: readonly [string, string],
  legalDecksOnly = false,
): Promise<LocalGameSetup> {
  const saved = await Promise.all([getDeck(ids[0]), getDeck(ids[1])]);
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
  if (legalDecksOnly) {
    for (const [index, deck] of saved.entries()) {
      if (!isValidSandboxDeck(deck, pool)) {
        throw new SandboxSetupError(
          `Player ${index + 1}'s deck is no longer valid. Choose another deck.`,
        );
      }
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
