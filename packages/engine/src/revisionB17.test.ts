import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackCostAt } from "./attack";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { attackMenuOf, selfAttackCostDiscount } from "./continuous";
import type { GameAction, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import { battler, completeSetup, deckOf, trainerCard, typedEnergy } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const SEASONED_SKILL =
  "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken.";
const BLOOD_MOON_TEXT = "During your next turn, this Pokémon can't attack.";
const PRIMAL_ROOT =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Basic Pokémon cost {C} more.";
const FOSSIL_RULE =
  "Play this card as if it were a 60-HP Basic {C} Pokémon. This card can't be affected by any Special Conditions and can't retreat.\n\nAt any time during your turn, you may discard this card from play.";
const TM_TEXT =
  "The Pokémon this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.) If this card is attached to 1 of your Pokémon, discard it at the end of your turn.";

const URSALUNA = ["sv06-141", "sv06-202", "sv06-216", "sv06-222", "sv08.5-168", "svp-177"] as const;
const TM = "sv08-188"; // Technical Machine: Fluorite — "Fluorite" {G}{W}{P}
const ROOT = "sv07-130"; // Antique Root Fossil — "Primal Root"
const FILLER = "b17-filler";
const G = "b17-grass";
const W = "b17-water";
const P = "b17-psychic";

const FIVE_C = ["Colorless", "Colorless", "Colorless", "Colorless", "Colorless"];
const GWP = ["Grass", "Water", "Psychic"];

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    URSALUNA.map((id) => [
      id,
      battler(id, {
        name: "Bloodmoon Ursaluna ex",
        types: ["Colorless"],
        hp: 260,
        retreat: 3,
        abilities: [{ type: "Ability", name: "Seasoned Skill", effect: SEASONED_SKILL }],
        attacks: [{ cost: FIVE_C, name: "Blood Moon", effect: BLOOD_MOON_TEXT, damage: 240 }],
      }),
    ]),
  ),
  [TM]: {
    ...trainerCard(TM, "Tool", TM_TEXT),
    name: "Technical Machine: Fluorite",
    attacks: CATALOG_MANIFEST.trainerFaces[TM]?.attacks ?? null,
  },
  [ROOT]: {
    ...trainerCard(ROOT, "Item", FOSSIL_RULE),
    name: "Antique Root Fossil",
    hp: CATALOG_MANIFEST.trainerFaces[ROOT]?.hp ?? null,
    abilities: CATALOG_MANIFEST.trainerFaces[ROOT]?.abilities ?? null,
  },
  [FILLER]: battler(FILLER, {
    name: "B17 Filler",
    hp: 300,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [G]: typedEnergy(G, "Grass"),
  [W]: typedEnergy(W, "Water"),
  [P]: typedEnergy(P, "Psychic"),
};

const DECK = deckOf({ [FILLER]: 20, [G]: 40 });

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 1717, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

/** TEST SURGERY — fresh uids for every card placed, both Actives replaced, both Benches one filler. */
function table(opts: {
  ursaluna: string;
  tm: boolean;
  fossil: boolean;
  opponentTook: number;
}): GameState {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b17#${n++}`;
    state.cardIdByUid[uid] = id;
    const card = LOCAL[id];
    if (card === undefined) throw new Error(`no local face for ${id}`);
    state.cardPool = { ...state.cardPool, [id]: card };
    return uid;
  };
  const body = (
    id: string,
    energy: readonly string[] = [],
    tools: readonly string[] = [],
  ): InPlayPokemon => ({
    ...makeInPlay(alloc(id), 1),
    energy: energy.map(alloc),
    tools: tools.map(alloc),
  });
  const p1 = state.players.p1;
  const p2 = state.players.p2;
  state.players.p1 = {
    ...p1,
    active: body(opts.ursaluna, [G, W, P], opts.tm ? [TM] : []),
    bench: [body(FILLER)],
  };
  state.players.p2 = {
    ...p2,
    active: body(opts.fossil ? ROOT : FILLER),
    bench: [body(FILLER)],
    prizes: Array.from({ length: 6 - opts.opponentTook }, () => alloc(G)),
  };
  return state;
}

function ursalunaOf(state: GameState): InPlayPokemon {
  const active = state.players.p1.active;
  if (active === null) throw new Error("p1 has no Active");
  return active;
}

function rejection(state: GameState, action: GameAction): string | undefined {
  const result = applyAction(state, action);
  return result.ok ? undefined : result.error.code;
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1" as Seat, index });

describe("B17 §1 — Seasoned Skill discounts BLOOD MOON only", () => {
  it("every printing resolves to the one scoped program", () => {
    for (const id of URSALUNA) {
      expect(programFor(id), id).toEqual({
        passive: { attackCostDiscountPerOpponentPrize: 1, attackCostDiscountAttack: "Blood Moon" },
      });
    }
    expect(new Set(URSALUNA.map((id) => programFor(id))).size).toBe(1);
    expect(CATALOG_MANIFEST.trainerFaces[TM]?.attacks?.[0]?.name).toBe("Fluorite");
    expect(CATALOG_MANIFEST.trainerFaces[TM]?.attacks?.[0]?.cost).toEqual(GWP);
    expect(CATALOG_MANIFEST.trainerFaces[ROOT]?.abilities?.[0]?.effect).toBe(PRIMAL_ROOT);
  });

  for (const id of URSALUNA) {
    it(`${id}: Primal Root's {C} stands on TM Fluorite whatever the Prize count`, () => {
      for (const took of [0, 2, 5]) {
        const state = table({ ursaluna: id, tm: true, fossil: true, opponentTook: took });
        const menu = attackMenuOf(state, "p1", ursalunaOf(state)).map((entry) => entry.attack.name);
        expect(menu).toEqual(["Blood Moon", "Fluorite"]);
        expect(attackCostAt(state, "p1", ursalunaOf(state), 1, GWP), `took ${took}`).toEqual([
          ...GWP,
          "Colorless",
        ]);
        expect(rejection(state, attack(1)), `took ${took}`).toBe("ATTACK_COST_UNMET");
      }
    });
  }

  it("Blood Moon itself still takes the per-Prize {C} off, surcharge included", () => {
    // 5 printed {C} + Primal Root's 1 − 2 taken Prizes = 4 {C}.
    const surcharged = table({ ursaluna: "sv06-141", tm: true, fossil: true, opponentTook: 2 });
    expect(attackCostAt(surcharged, "p1", ursalunaOf(surcharged), 0, GWP)).toEqual(
      FIVE_C.slice(0, 4),
    );
    // …and with no surcharge, 5 − 4 taken = 1 {C}: the three attached Energy pay it.
    const bare = table({ ursaluna: "sv06-141", tm: true, fossil: false, opponentTook: 4 });
    expect(attackCostAt(bare, "p1", ursalunaOf(bare), 0, GWP)).toEqual(["Colorless"]);
    expect(rejection(bare, attack(0))).toBeUndefined();
    // The scope reads the attack NAME: the holder's term is there for Blood Moon and not otherwise.
    expect(selfAttackCostDiscount(bare, ursalunaOf(bare), "Blood Moon")).toBe(4);
    expect(selfAttackCostDiscount(bare, ursalunaOf(bare), "Fluorite")).toBe(0);
  });

  it("control: with no surcharge in play, TM Fluorite costs its printed {G}{W}{P} and is used", () => {
    const state = table({ ursaluna: "svp-177", tm: true, fossil: false, opponentTook: 2 });
    expect(attackCostAt(state, "p1", ursalunaOf(state), 1, GWP)).toEqual(GWP);
    expect(rejection(state, attack(1))).toBeUndefined();
  });
});
