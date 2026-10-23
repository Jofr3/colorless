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
