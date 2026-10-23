import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { applyAction, createGame } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  battler,
  completeSetup,
  deckOf,
  specialEnergy,
  typedEnergy,
  mustApply as must,
} from "./testFixtures";
import { type InPlayPokemon, type Seat, makeInPlay } from "./types";

const TEXT = "Your opponent's Active Pokémon is now Asleep and Poisoned.";
const MIST_TEXT =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nPrevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)";
const PREVENTED = " prevented the effect of the attack";

type Printing = {
  id: string;
  name: string;
  attack: string;
  index: number;
  cost: string[];
  damage: number;
};

const G = "Grass";
const C = "Colorless";
const LIVELY = {
  cost: [G],
  name: "Lively Flower",
  effect: "If this Pokémon was healed during this turn, this attack does 120 more damage.",
  damage: "60+",
};
const PRINTINGS: readonly Printing[] = [
  { id: "me02-003", name: "Vileplume", attack: "Pollen Bomb", index: 0, cost: [G], damage: 30 },
  {
    id: "me02.5-003",
    name: "Erika's Vileplume ex",
    attack: "Bloom Powder",
    index: 0,
    cost: [G, G, C],
    damage: 160,
  },
  {
    id: "me02.5-015",
    name: "Dustox",
    attack: "Twilight Poison",
    index: 0,
    cost: [G, G],
    damage: 100,
  },
  {
    id: "me02.5-220",
    name: "Dustox",
    attack: "Twilight Poison",
    index: 0,
    cost: [G, G],
    damage: 100,
  },
];

const MIST = "sv05-161";
const FILLER = "b52-filler";
const ENERGY: Record<string, string> = { Grass: "b52-grass", Colorless: "b52-colorless" };
const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function face(p: Printing): Card {
  const printed = { cost: p.cost, name: p.attack, effect: TEXT, damage: p.damage };
  return battler(p.id, {
    name: p.name,
    hp: 330,
    attacks: p.id === "me02-003" ? [printed, LIVELY] : [printed],
  });
}

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(PRINTINGS.map((p) => [p.id, face(p)])),
  // No Weakness / Resistance on the defender, so the printed damage is the whole total.
  [FILLER]: battler(FILLER, {
    name: "B52 Filler",
    hp: 400,
    types: ["Colorless"],
    weaknesses: [],
    resistances: [],
    attacks: [{ cost: [C], name: "B52 Tap", damage: 10 }],
  }),
  [MIST]: specialEnergy(MIST, "Mist Energy", MIST_TEXT),
  [ENERGY.Grass as string]: typedEnergy(ENERGY.Grass as string, "Grass"),
  [ENERGY.Colorless as string]: typedEnergy(ENERGY.Colorless as string, "Darkness"),
};

const DECK = deckOf({ [FILLER]: 60 });

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 5252, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

function table(p: Printing, defenderEnergy: readonly string[]): GameState {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b52#${n++}`;
    state.cardIdByUid[uid] = id;
    const card = LOCAL[id];
    if (card === undefined) throw new Error(`no local face for ${id}`);
    state.cardPool = { ...state.cardPool, [id]: card };
    return uid;
  };
  const body = (id: string, attached: readonly string[]): InPlayPokemon => ({
    ...makeInPlay(alloc(id), 1),
    energy: attached.map(alloc),
  });
  const fillers = (count: number) => Array.from({ length: count }, () => alloc(FILLER));
  for (const seat of ["p1", "p2"] as const) {
    state.players[seat] = {
      ...state.players[seat],
      active:
        seat === "p1"
          ? body(
              p.id,
              p.cost.map((type) => ENERGY[type] as string),
            )
          : body(FILLER, defenderEnergy),
      bench: [],
      hand: [],
      discard: [],
      deck: fillers(10),
    };
  }
  return state;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
function render(events: readonly GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [entry.segments.map((s) => s.text).join("")],
  );
}
const label = (p: Printing) => `${p.id} ${p.name} "${p.attack}"`;
const attack = (state: GameState, p: Printing) =>
  must(state, { type: "attack", seat: "p1", index: p.index });

// ─────────────────────────────────────────────────────────────────────────────

describe('B52 §1 — "is now Asleep and Poisoned" into Mist Energy: both conditions refused, one prevention row PER OP (U0264 / U0356 / U0367, deferred: D142 reading pinned, NOT changed)', () => {
  it("the census: every printing is wired, and the printed sentence is the attack's text", () => {
    expect(PRINTINGS.map((p) => p.id)).toEqual([
      "me02-003",
      "me02.5-003",
      "me02.5-015",
      "me02.5-220",
    ]);
    for (const p of PRINTINGS) expect(LOCAL[p.id]?.attacks?.[p.index]?.effect).toBe(TEXT);
  });

  it.each(PRINTINGS.map((p) => [label(p), p] as const))(
    "%s: neither condition lands, the damage does, and the log says 'prevented the effect of the attack' once per refused op (twice)",
    (_, p) => {
      const { state, events } = attack(table(p, [MIST]), p);
      const defender = state.players.p2.active;
      expect(defender?.damage).toBe(p.damage);
      expect(defender?.conditions.rotation).toBe("none");
      expect(defender?.conditions.poisonDamage).toBe(0);
      expect(ofType(events, "STATUS_APPLIED")).toEqual([]);
      const prevented = ofType(events, "ATTACK_EFFECT_PREVENTED");
      const row = { type: "ATTACK_EFFECT_PREVENTED", seat: "p2", uid: defender?.stack.at(-1) };
      expect(prevented).toEqual([row, row]);
      expect(render(events, state).filter((line) => line.endsWith(PREVENTED))).toEqual([
        `B52 Filler${PREVENTED}`,
        `B52 Filler${PREVENTED}`,
      ]);
    },
  );
});

describe("B52 §2 — the controls: with no shield both printed conditions land", () => {
  it.each(PRINTINGS.map((p) => [label(p), p] as const))(
    "%s: Asleep and Poisoned (10), the printed damage, and no prevention row",
    (_, p) => {
      const { state, events } = attack(table(p, []), p);
      const defender = state.players.p2.active;
      // The attack ends the turn, so the Pokémon Checkup between turns has already run: the Poison
      // placed its 10 on top of the printed damage, and the Asleep flip may have woken it.
      expect(defender?.damage).toBe(p.damage + 10);
      expect(defender?.conditions.poisonDamage).toBe(10);
      expect(ofType(events, "STATUS_APPLIED").map((e) => e.status)).toEqual(["asleep", "poisoned"]);
      expect(ofType(events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
      expect(render(events, state).filter((row) => row.endsWith(PREVENTED))).toEqual([]);
    },
  );
});
