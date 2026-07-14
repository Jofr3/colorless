import type { Card } from "@luminous/schema";
import type { ApplyResult } from "./actions";
import { err } from "./actions";
import type { GameState, InPlayPokemon, Seat } from "./types";

// The engine reads catalog data only through these accessors, so the exact
// Card surface M1 depends on (category, stage, retreat) stays one small,
// auditable module.

export function cardOfUid(state: GameState, uid: string): Card | undefined {
  const id = state.cardIdByUid[uid];
  return id === undefined ? undefined : state.cardPool[id];
}

/** `stage` uses the tcgdex vocabulary ("Basic" | "Stage1" | "Stage2" | …). */
export function isBasicPokemon(card: Card): boolean {
  return card.category === "Pokemon" && card.stage === "Basic";
}

/** Basic and Special energy both occupy the one attach per turn (§6.3);
    Special-energy rules text is M4+. */
export function isEnergyCard(card: Card): boolean {
  return card.category === "Energy";
}

/** Printed retreat cost; null (nothing printed / non-Pokémon) = free (§11). */
export function retreatCostOf(card: Card): number {
  return card.retreat ?? 0;
}

/** The top of the stack defines the Pokémon's identity (§1.2). Stacks are
    never empty, but indexing has to admit undefined. */
export function topUid(pokemon: InPlayPokemon): string | undefined {
  return pokemon.stack[pokemon.stack.length - 1];
}

export function topCardOf(state: GameState, pokemon: InPlayPokemon): Card | undefined {
  const uid = topUid(pokemon);
  return uid === undefined ? undefined : cardOfUid(state, uid);
}

/** The "a Basic Pokémon out of your own hand" check shared by the two setup
    placements and the in-turn bench play (§3.6–§3.7, §5.2). Returns the
    rejection, or null when the play is legal. M2's evolution play adds its
    own timing rules on top of the same hand/uid resolution. */
export function basicFromHandError(state: GameState, seat: Seat, uid: string): ApplyResult | null {
  if (!state.players[seat].hand.includes(uid)) {
    return err("CARD_NOT_IN_HAND", `${uid} is not in ${seat}'s hand`);
  }
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    return err("UNKNOWN_CARD", `no catalog card for uid ${uid}`);
  }
  if (!isBasicPokemon(card)) {
    return err("NOT_A_BASIC_POKEMON", `${card.name} is not a Basic Pokémon`);
  }
  return null;
}
