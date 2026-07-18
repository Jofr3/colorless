import {
  cardOfUid,
  energyProvidesOf,
  hpOf,
  isBasicPokemon,
  isSpecialEnergy,
  retreatCostOf,
  topCardOf,
} from "./cards";
import type { PassiveEffects, StadiumEffects } from "./registry";
import { programFor } from "./registry";
import type { GameState, InPlayPokemon } from "./types";

// The continuous-modifier pipeline (M4 slice 3): the one place the always-on
// effects of the shared Stadium (§7.3) and of attached Tools / printed
// passives (§7.4/§9) are aggregated and applied to a rule read. Cards.ts
// stays a pure catalog-accessor module — everything here reads STATE (which
// Stadium is out, which Tools are attached) on top of the catalog, so the
// action handlers (turn.ts retreat, attack.ts costs/damage, flow.ts KO check)
// and the web HUD all ask the same questions of the same module and cannot
// drift. Every function is pure and total: a missing card or program simply
// contributes nothing.

/** The in-play Stadium's authored continuous effects, or undefined when no
    Stadium is out (or the one out has no registry row — unreachable through
    playTrainer, which refuses to play an unauthored Stadium). */
export function stadiumEffectsOf(state: GameState): StadiumEffects | undefined {
  if (state.stadium === null) return undefined;
  const id = state.cardIdByUid[state.stadium.uid];
  return id === undefined ? undefined : programFor(id)?.stadium;
}

/** Every continuous modifier affecting one in-play Pokémon, aggregated from
    its TOP card's printed passive (Bouffalant "Bouffer") and every attached
    Tool (§7.4) — summed, since each source is its own card effect. The
    Basic-only hpBonus (Bravery Charm) counts only while the top card is a
    Basic: evolving the holder ends it even though the Tool stays attached. */
export function passivesOf(
  state: GameState,
  pokemon: InPlayPokemon,
): Required<Omit<PassiveEffects, "basicHpBonus">> & { hpBonus: number } {
  const top = topCardOf(state, pokemon);
  const sources: (PassiveEffects | undefined)[] = [
    top === undefined ? undefined : programFor(top.id)?.passive,
    ...pokemon.tools.map((uid) => {
      const id = state.cardIdByUid[uid];
      return id === undefined ? undefined : programFor(id)?.passive;
    }),
  ];
  const isBasic = top !== undefined && isBasicPokemon(top);
  let damageReductionAfterWR = 0;
  let damageBonusBeforeWR = 0;
  let hpBonus = 0;
  for (const passive of sources) {
    if (passive === undefined) continue;
    damageReductionAfterWR += passive.damageReductionAfterWR ?? 0;
    damageBonusBeforeWR += passive.damageBonusBeforeWR ?? 0;
    if (isBasic) hpBonus += passive.basicHpBonus ?? 0;
  }
  return { damageReductionAfterWR, damageBonusBeforeWR, hpBonus };
}

/** §8.1 max HP as the KO check and the HUD must read it: the printed hp plus
    any continuous bonus (Bravery Charm). A null printed hp is the catalog
    data gap (cards.ts hpOf) and STAYS null — a bonus on top of unknown HP is
    still unknown, and a data gap never KOs. */
export function effectiveMaxHp(state: GameState, pokemon: InPlayPokemon): number | null {
  const top = topCardOf(state, pokemon);
  const hp = top === undefined ? null : hpOf(top);
  if (hp === null) return hp;
  const { hpBonus } = passivesOf(state, pokemon);
  return hp + hpBonus;
}

/** §6.3/§6.4 — the flat list of energy UNITS a Pokémon's attached energies
    provide toward attack costs, evaluated per energy under its rules text:
    - a basic energy provides its one type (cards.ts energyProvidesOf);
    - an AUTHORED special energy provides its EnergyProgram's units (a concrete
      type, or ANY_ENERGY for a wildcard, and multi-unit is allowed — Double
      Turbo-likes), with Luminous's "{C} instead if another Special Energy is
      attached" evaluated against the holder's OTHER energies;
    - an UNAUTHORED special energy falls back to one Colorless (energyProvidesOf),
      so it stays playable rather than rejecting.
    The one provision read site: attack.ts's §8.2 cost check and the HUD's
    payability preview both call it, so they cannot drift (the D18 duplication
    is gone). costMet (attack.ts) consumes this flat list. */
export function providedEnergy(state: GameState, pokemon: InPlayPokemon): string[] {
  // Which attached energies are Special — for Luminous's "any OTHER Special
  // Energy attached" condition. Resolved once against the live board.
  const specialUids = pokemon.energy.filter((uid) => {
    const card = cardOfUid(state, uid);
    return card !== undefined && isSpecialEnergy(card);
  });
  const units: string[] = [];
  for (const uid of pokemon.energy) {
    const card = cardOfUid(state, uid);
    if (card === undefined) {
      units.push("Colorless"); // unresolved uid — the conservative unit
      continue;
    }
    const program = programFor(card.id)?.energy;
    if (program === undefined) {
      // Basic energy → its type; an unauthored special energy → Colorless.
      units.push(energyProvidesOf(card));
      continue;
    }
    const demote = program.demoteWithOtherSpecial;
    if (demote !== undefined && specialUids.some((other) => other !== uid)) {
      units.push(...demote);
    } else {
      units.push(...program.provides);
    }
  }
  return units;
}

/** §11 retreat cost under the in-play Stadium's continuous effects: Beach
    Court's Basic discount subtracts, floored at a free retreat. Non-Basics
    (and boards with no Stadium) pay the printed cost. */
export function effectiveRetreatCost(state: GameState, pokemon: InPlayPokemon): number {
  const top = topCardOf(state, pokemon);
  if (top === undefined) return 0;
  const printed = retreatCostOf(top);
  if (!isBasicPokemon(top)) return printed;
  const discount = stadiumEffectsOf(state)?.basicRetreatDiscount ?? 0;
  return Math.max(0, printed - discount);
}

/** §8.2 attack cost under the in-play Stadium's continuous effects: Pokémon
    League Headquarters adds {C} per surcharge point to every Basic's attacks
    (a Colorless slot — any energy pays it, §6.4). Returns the printed cost
    array itself when nothing applies, a fresh copy when something does. */
export function effectiveAttackCost(
  state: GameState,
  pokemon: InPlayPokemon,
  cost: readonly string[],
): readonly string[] {
  const top = topCardOf(state, pokemon);
  if (top === undefined || !isBasicPokemon(top)) return cost;
  const surcharge = stadiumEffectsOf(state)?.basicAttackCostSurcharge ?? 0;
  if (surcharge <= 0) return cost;
  return [...cost, ...Array.from({ length: surcharge }, () => "Colorless")];
}
