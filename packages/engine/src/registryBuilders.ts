import type { EffectOp, OpOf, PokemonType } from "./effectTypes";
import type { AbilityProgram, CardProgram } from "./programTypes";

// Builders for program shapes the registry repeats, so each row shows only what differs.

/** A deck search followed by the printed "Then, shuffle your deck." */
export function searchThenShuffle(search: Omit<OpOf<"searchDeck">, "op">): EffectOp[] {
  return [{ op: "searchDeck", ...search }, { op: "shuffleDeck" }];
}

/** An activated Ability usable once per turn from the Active Spot or the Bench. */
export function activated(
  spec: Omit<AbilityProgram, "oncePerTurn" | "activeOnly">,
): AbilityProgram {
  const { name, ...rest } = spec;
  return { name, oncePerTurn: true, activeOnly: false, ...rest };
}

/**
 * A type-resist Berry Tool: 60 less damage from an attacking Pokémon of `type` (after Weakness and
 * Resistance), then the Berry is discarded.
 */
export function berry(type: PokemonType): CardProgram {
  return { passive: { damageReductionAfterWRFromTypeThenDiscard: { amount: 60, type } } };
}

/**
 * Shared program for the attack and Supporter printings of this sentence. `shuffleDeck` leads
 * despite the printed order because the search answer is a set of cards, so shuffling before or
 * after removing them is equivalent. `reorderTop` is a separate op because the order is a second
 * decision.
 */
export function searchTopOrderProgram(n: number): EffectOp[] {
  return [
    { op: "shuffleDeck" },
    {
      op: "searchDeck",
      // The printed noun is plain "cards", so any card is a legal find.
      filter: { kind: "anyCard" },
      max: n,
      // Without `exact`, a short pick would let the next op reorder cards that were never searched.
      exact: true,
      dest: "deckTop",
    },
    // The reorder window is exactly what the search placed.
    { op: "reorderTop", n },
  ];
}
