import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import {
  battler,
  completeSetup,
  deckOf,
  specialEnergy,
  trainerCard,
  typedEnergy,
  mustApply as must,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const SWITCH_OUT =
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
const MAY_SWITCH_OUT =
  "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
const COMPOUND =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
const GOAD =
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.";
const MIST_TEXT =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nPrevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)";
const WHIRLPOOL_TEXT =
  "Once during your turn, you may switch your Active Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
const UNNERVE_TEXT =
  "Whenever your opponent plays an Item or Supporter card from their hand, prevent all effects of that card done to this Pokémon.";
const LUMINOUS_WING_TEXT =
  "Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon.";

const MIST = "sv05-161";
const REPEL = "me01-126";
const SAMUROTT = "sv10.5w-023";
const FRAXURE = "sv06.5-045";
const CLEFABLE = "mep-072";
const FILLER = "b48-filler";
const C = "b48-energy";

type Row = [
  string,
  readonly string[],
  string,
  string,
  readonly string[],
  number | undefined,
  string,
];
const BARE: readonly Row[] = [
  ["U0137", ["me01-009"], "Bayleef", "Push Down", ["Grass", "Colorless"], 50, SWITCH_OUT],
  ["U0137", ["me02.5-146"], "Pawniard", "Push Down", ["Metal"], 10, SWITCH_OUT],
  ["U0137", ["me05-044"], "Cranidos", "Push Down", ["Fighting", "Fighting"], 70, SWITCH_OUT],
  ["U0137", ["sv09-009"], "Karrablast", "Push Down", ["Colorless"], 10, SWITCH_OUT],
  ["U0137", ["sv10-105"], "Hippopotas", "Push Down", ["Fighting"], 10, SWITCH_OUT],
  [
    "U0137",
    ["sv10.5w-007", "sv10.5w-092"],
    "Sawsbuck",
    "Push Down",
    ["Colorless", "Colorless"],
    50,
    SWITCH_OUT,
  ],
  [
    "U0480",
    ["me02.5-129", "me02.5-243", "sv05-106"],
    "Mightyena",
    "Kick Away",
    ["Darkness", "Colorless"],
    50,
    SWITCH_OUT,
  ],
  ["U0720", ["me04-061"], "Metagross", "Bounce Back", ["Metal"], 60, SWITCH_OUT],
  ["U1334", ["sv07-121"], "Fletchling", "Send Back", ["Colorless"], 10, SWITCH_OUT],
  ["U1687", ["sv10-002", "sv10-183"], "Yanma", "Whirlwind", ["Colorless"], undefined, SWITCH_OUT],
  [
    "U1948",
    ["sv10.5w-075", "sv10.5w-155"],
    "Herdier",
    "Roar",
    ["Colorless"],
    undefined,
    SWITCH_OUT,
  ],
];
const MAY: readonly Row[] = [
  ["Push Down", ["sv10-160"], "Squawkabilly", "Push Down", ["Colorless"], 20, MAY_SWITCH_OUT],
  [
    "Winding Waves",
    ["svp-178"],
    "Kyogre ex",
    "Winding Waves",
    ["Water", "Colorless", "Colorless"],
    80,
    MAY_SWITCH_OUT,
  ],
];
const COMPOUNDS: readonly Row[] = [
  ["U1087", ["sv06-062"], "Iron Bundle", "Interjet", ["Water", "Colorless"], 60, COMPOUND],
  ["U0025", ["30th-020"], "Palkia", "Wormhole", ["Water", "Water", "Colorless"], 100, COMPOUND],
];
const GOAD_ROW: Row = [
  "U1314",
  ["sv07-096"],
  "Grimmsnarl",
  "Goad 'n' Grab",
  ["Colorless", "Colorless"],
  undefined,
  GOAD,
];

const LOCAL: Record<string, Card> = {};
const ENERGY_FOR: Record<string, string> = {};
for (const [, ids, name, attack, cost, damage, effect] of [
  ...BARE,
  ...MAY,
  ...COMPOUNDS,
  GOAD_ROW,
]) {
  for (const id of ids) {
    LOCAL[id] = battler(id, {
      name,
      hp: 300,
      types: ["Colorless"],
      weaknesses: [],
      resistances: [],
      retreat: 1,
      attacks: [
        { cost: [...cost], name: attack, effect, ...(damage === undefined ? {} : { damage }) },
      ],
    });
    ENERGY_FOR[id] = `b48-${cost[0]?.toLowerCase()}`;
  }
}
for (const type of ["Grass", "Metal", "Fighting", "Colorless", "Darkness", "Water"]) {
  LOCAL[`b48-${type.toLowerCase()}`] = typedEnergy(`b48-${type.toLowerCase()}`, type);
}
// No Weakness / Resistance on the defender, so the printed damage is the whole total.
LOCAL[FILLER] = battler(FILLER, {
  name: "B48 Filler",
  hp: 400,
  types: ["Colorless"],
  weaknesses: [],
  resistances: [],
  attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
});
LOCAL[C] = typedEnergy(C, "Colorless");
LOCAL[MIST] = specialEnergy(MIST, "Mist Energy", MIST_TEXT);
LOCAL[REPEL] = trainerCard(REPEL, "Item", SWITCH_OUT);
LOCAL[SAMUROTT] = battler(SAMUROTT, {
  name: "Samurott",
  hp: 300,
  types: ["Water"],
  abilities: [{ type: "Ability", name: "Torrential Whirlpool", effect: WHIRLPOOL_TEXT }],
  attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
});
LOCAL[FRAXURE] = battler(FRAXURE, {
  name: "Fraxure",
  hp: 300,
  types: ["Dragon"],
  abilities: [{ type: "Ability", name: "Unnerve", effect: UNNERVE_TEXT }],
  attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
});
LOCAL[CLEFABLE] = battler(CLEFABLE, {
  name: "Mega Clefable ex",
  hp: 300,
  types: ["Psychic"],
  abilities: [{ type: "Ability", name: "Luminous Wing", effect: LUMINOUS_WING_TEXT }],
  attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
});

const DECK = deckOf({ [FILLER]: 20, [C]: 40 });

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 4848, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

interface Table {
  attacker: string;
  energy: readonly string[];
  ownBench?: number;
  defender?: string;
  defenderEnergy?: readonly string[];
  oppBench?: number;
  hand?: readonly string[];
}

/** TEST SURGERY — P1's Active is `attacker`, P2's Active `defender` (a 400-HP Filler by default)
    carrying `defenderEnergy`, each Bench Fillers, decks 10 Fillers. Fresh uids for every card. */
function table(t: Table): GameState {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b48#${n++}`;
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
  const p1 = state.players.p1;
  const p2 = state.players.p2;
  state.players.p1 = {
    ...p1,
    active: body(t.attacker, t.energy),
    bench: Array.from({ length: t.ownBench ?? 0 }, () => body(FILLER, [])),
    hand: (t.hand ?? []).map(alloc),
    discard: [],
    deck: Array.from({ length: 10 }, () => alloc(FILLER)),
  };
  state.players.p2 = {
    ...p2,
    active: body(t.defender ?? FILLER, t.defenderEnergy ?? []),
    bench: Array.from({ length: t.oppBench ?? 1 }, () => body(FILLER, [])),
    hand: [],
    discard: [],
    deck: Array.from({ length: 10 }, () => alloc(FILLER)),
  };
  return state;
}

const cost = (id: string): string[] => {
  const attack = LOCAL[id]?.attacks?.[0];
  return (attack?.cost ?? []).map(() => ENERGY_FOR[id] ?? C);
};

/** Run `action`, then answer every park with its first legal option (a "may" is accepted),
    each by the seat the park names as answerer. */
function drive(board: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  let step = must(board, action);
  const events: GameEvent[] = [...step.events];
  for (let guard = 0; step.state.phase.kind === "effect:choose" && guard < 6; guard++) {
    const phase = step.state.phase;
    const p = phase.prompt;
    const seat: Seat = phase.answerer ?? phase.seat;
    const choice =
      p.kind === "choosePokemon"
        ? { kind: "pokemon" as const, ref: p.candidates[0] }
        : p.kind === "confirm"
          ? { kind: "confirm" as const, yes: true }
          : (() => {
              throw new Error(`unexpected prompt ${p.kind}`);
            })();
    step = must(step.state, { type: "resolveEffect", seat, choice } as GameAction);
    events.push(...step.events);
  }
  return { state: step.state, events };
}

const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const top = (p: InPlayPokemon | null | undefined): string | undefined =>
  p?.stack[p.stack.length - 1];
const idOf = (state: GameState, p: InPlayPokemon | null | undefined): string | undefined => {
  const uid = top(p);
  return uid === undefined ? undefined : state.cardIdByUid[uid];
};

const attack: GameAction = { type: "attack", seat: "p1", index: 0 };
const each = (rows: readonly Row[]) =>
  rows.flatMap(([unit, ids, name, atk, , damage]) =>
    ids.map((id) => [unit, id, name, atk, damage] as const),
  );

// ─────────────────────────────────────────────────────────────────────────────

const once = (rows: readonly Row[]) => {
  const seen = new Set<string>();
  return each(rows).filter(([unit]) => !seen.has(unit) && seen.add(unit) !== undefined);
};

describe("B48 §1 — every printing switches the Defending Pokémon out (no shield)", () => {
  it.each(each([...BARE, ...MAY]))(
    '%s %s %s "%s": the Active goes to the Bench with the printed damage',
    (_u, id, _n, _a, damage) => {
      const board = table({ attacker: id, energy: cost(id) });
      const defender = top(board.players.p2.active);
      const { state, events } = drive(board, attack);
      expect(top(state.players.p2.bench[0])).toBe(defender);
      expect(state.players.p2.bench[0]?.damage).toBe(damage ?? 0);
      expect(ofType(events, "POKEMON_SWITCHED").map((e) => e.seat)).toEqual(["p2"]);
    },
  );

  it.each(each(COMPOUNDS))(
    '%s %s %s "%s": the self-switch, then the opponent\'s switch-out',
    (_u, id, _n, _a, damage) => {
      const board = table({ attacker: id, energy: cost(id), ownBench: 1 });
      const defender = top(board.players.p2.active);
      const { state, events } = drive(board, attack);
      expect(top(state.players.p1.bench[0])).toBe(top(board.players.p1.active));
      expect(top(state.players.p2.bench[0])).toBe(defender);
      expect(state.players.p2.bench[0]?.damage).toBe(damage);
      expect(ofType(events, "POKEMON_SWITCHED").map((e) => e.seat)).toEqual(["p1", "p2"]);
    },
  );

  it("U1314 sv07-096 \"Goad 'n' Grab\": the new Active takes the printed 160", () => {
    const board = table({ attacker: "sv07-096", energy: cost("sv07-096") });
    const promoted = top(board.players.p2.bench[0]);
    const { state, events } = drive(board, attack);
    expect(top(state.players.p2.active)).toBe(promoted);
    expect(state.players.p2.active?.damage).toBe(160);
    expect(state.players.p2.bench[0]?.damage).toBe(0);
    expect(ofType(events, "POKEMON_SWITCHED")).toHaveLength(1);
  });
});

describe("B48 §2 — D227's reading on a Mist Energy Active, pinned and NOT changed (ruling deferred)", () => {
  it.each(once([...BARE, ...MAY]))(
    '%s %s %s "%s": the damage lands and the Active is still switched out',
    (_u, id, _n, _a, damage) => {
      const board = table({ attacker: id, energy: cost(id), defenderEnergy: [MIST] });
      const defender = top(board.players.p2.active);
      const { state, events } = drive(board, attack);
      expect(top(state.players.p2.bench[0])).toBe(defender);
      expect(state.players.p2.bench[0]?.damage).toBe(damage ?? 0);
      expect(ofType(events, "POKEMON_SWITCHED").map((e) => e.seat)).toEqual(["p2"]);
      expect(ofType(events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
    },
  );

  it.each(once(COMPOUNDS))('%s %s %s "%s": both switches happen', (_u, id) => {
    const board = table({ attacker: id, energy: cost(id), ownBench: 1, defenderEnergy: [MIST] });
    const defender = top(board.players.p2.active);
    const { state, events } = drive(board, attack);
    expect(top(state.players.p2.bench[0])).toBe(defender);
    expect(ofType(events, "POKEMON_SWITCHED").map((e) => e.seat)).toEqual(["p1", "p2"]);
    expect(ofType(events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
  });

  it('U1314 sv07-096 "Goad \'n\' Grab": the switch files under "moved", so the 160 lands on the promoted body', () => {
    const board = table({ attacker: "sv07-096", energy: cost("sv07-096"), defenderEnergy: [MIST] });
    const defender = top(board.players.p2.active);
    const promoted = top(board.players.p2.bench[0]);
    const { state, events } = drive(board, attack);
    expect(top(state.players.p2.active)).toBe(promoted);
    expect(state.players.p2.active?.damage).toBe(160);
    expect(top(state.players.p2.bench[0])).toBe(defender);
    expect(ofType(events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
  });
});

describe("B48 §3 — the Trainer and Ability users of the same op", () => {
  const repel = (board: GameState): GameAction => ({
    type: "playTrainer",
    seat: "p1",
    uid: board.players.p1.hand[0] as string,
  });
  const whirlpool: GameAction = {
    type: "useAbility",
    seat: "p1",
    target: { spot: "active" },
    abilityName: "Torrential Whirlpool",
  };

  it("Repel me01-126 (Item): Mist names attacks, so the Mist Energy Active is switched out", () => {
    const board = table({ attacker: FILLER, energy: [], defenderEnergy: [MIST], hand: [REPEL] });
    const defender = top(board.players.p2.active);
    const { state, events } = drive(board, repel(board));
    expect(top(state.players.p2.bench[0])).toBe(defender);
    expect(ofType(events, "POKEMON_SWITCHED")).toHaveLength(1);
  });

  it("Samurott sv10.5w-023 Torrential Whirlpool (Ability): Mist names attacks, both switches happen", () => {
    const board = table({ attacker: SAMUROTT, energy: [], ownBench: 1, defenderEnergy: [MIST] });
    const defender = top(board.players.p2.active);
    const { state, events } = drive(board, whirlpool);
    expect(top(state.players.p2.bench[0])).toBe(defender);
    expect(ofType(events, "POKEMON_SWITCHED").map((e) => e.seat)).toEqual(["p1", "p2"]);
  });

  it('Repel vs Fraxure "Unnerve" (D227 reading, pinned): Fraxure is switched out', () => {
    const board = table({ attacker: FILLER, energy: [], defender: FRAXURE, hand: [REPEL] });
    const { state, events } = drive(board, repel(board));
    expect(idOf(state, state.players.p2.bench[0])).toBe(FRAXURE);
    expect(ofType(events, "TRAINER_EFFECT_PREVENTED")).toEqual([]);
  });

  it('Torrential Whirlpool vs Mega Clefable ex "Luminous Wing" (D227 reading, pinned): Clefable is switched out', () => {
    const board = table({ attacker: SAMUROTT, energy: [], ownBench: 1, defender: CLEFABLE });
    const { state, events } = drive(board, whirlpool);
    expect(idOf(state, state.players.p1.active)).toBe(FILLER);
    expect(idOf(state, state.players.p2.bench[0])).toBe(CLEFABLE);
    expect(ofType(events, "ABILITY_EFFECT_PREVENTED")).toEqual([]);
  });
});
