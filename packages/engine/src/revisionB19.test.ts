import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { seatDamageReduction } from "./continuous";
import type { GameAction, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  battler,
  completeSetup,
  deckOf,
  typedEnergy,
  mustApply as must,
  roundTrip,
  programmedCardIds,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const AUTO_HEAL =
  "As long as this Pokémon is in the Active Spot, whenever you attach an Energy card from your hand to 1 of your Pokémon, heal 90 damage from that Pokémon.";
const GNAWING_CURSE =
  "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.";
const TEAL_DANCE =
  "Once during your turn, you may attach a Basic {G} Energy card from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card.";
const LETHARGIC_CHARGE =
  "Once during your turn, if this Pokémon is on your Bench, you may use this Ability. Attach an Energy card from your hand to your Active Larry's Pokémon.";
const DEFIANT_HORN =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
const HEAVE_HO =
  "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
const GLITTERING =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch in 1 of your opponent's Benched Pokémon that has 90 HP or less remaining to the Active Spot.";
const TUNDRA_WALL =
  "All of your Pokémon that have any {W} Energy attached take 50 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Tundra Wall doesn't stack.";
const HEAT_WAVE =
  "This attack also does 30 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const MAGEARNA = "sv09-107";
const GENGARS = ["sv05-104", "sv05-193"] as const;
const OGERPON = "sv06-025";
const KOMALA = "me02.5-175";
const DUBWOOL = "sv09-136";
const WOOLOO = "sv09-135";
const HARIYAMA = "me01-073";
const MAKUHITA = "me01-072";
const LEDIANS = ["svp-133", "sv07-003", "sv07-144"] as const;
const LEDYBA = "sv07-002";
const AURORUS = ["me03-024", "me03-092"] as const;
const CENTISKORCH = "sv08-028";
const LARRY = "b19-larry";
const FILLER = "b19-filler";
const SMALL = "b19-small";
const G = "b19-grass";
const W = "b19-water";
const R = "b19-fire";

const ability = (name: string, effect: string) => [{ type: "Ability", name, effect }];
const TAP = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  [MAGEARNA]: battler(MAGEARNA, {
    name: "Magearna",
    types: ["Metal"],
    hp: 90,
    abilities: ability("Auto Heal", AUTO_HEAL),
    attacks: [{ cost: ["Colorless"], name: "Spike Draw", effect: "Draw 2 cards.", damage: 20 }],
  }),
  ...Object.fromEntries(
    GENGARS.map((id) => [
      id,
      battler(id, {
        name: "Gengar ex",
        types: ["Darkness"],
        hp: 310,
        stage: "Stage2",
        abilities: ability("Gnawing Curse", GNAWING_CURSE),
        attacks: TAP,
      }),
    ]),
  ),
  [OGERPON]: battler(OGERPON, {
    name: "Teal Mask Ogerpon ex",
    types: ["Grass"],
    hp: 210,
    abilities: ability("Teal Dance", TEAL_DANCE),
    attacks: TAP,
  }),
  [KOMALA]: battler(KOMALA, {
    name: "Larry's Komala",
    types: ["Colorless"],
    hp: 100,
    abilities: ability("Lethargic Charge", LETHARGIC_CHARGE),
    attacks: TAP,
  }),
  [LARRY]: battler(LARRY, {
    name: "Larry's B19 Body",
    types: ["Colorless"],
    hp: 300,
    attacks: TAP,
  }),
  [WOOLOO]: battler(WOOLOO, { name: "Hop's Wooloo", types: ["Colorless"], hp: 70, attacks: TAP }),
  [DUBWOOL]: battler(DUBWOOL, {
    name: "Hop's Dubwool",
    types: ["Colorless"],
    hp: 120,
    stage: "Stage1",
    evolveFrom: "Hop's Wooloo",
    abilities: ability("Defiant Horn", DEFIANT_HORN),
    attacks: TAP,
  }),
  [MAKUHITA]: battler(MAKUHITA, { name: "Makuhita", types: ["Fighting"], hp: 80, attacks: TAP }),
  [HARIYAMA]: battler(HARIYAMA, {
    name: "Hariyama",
    types: ["Fighting"],
    hp: 150,
    stage: "Stage1",
    evolveFrom: "Makuhita",
    abilities: ability("Heave-Ho Catcher", HEAVE_HO),
    attacks: TAP,
  }),
  [LEDYBA]: battler(LEDYBA, { name: "Ledyba", types: ["Grass"], hp: 50, attacks: TAP }),
  ...Object.fromEntries(
    LEDIANS.map((id) => [
      id,
      battler(id, {
        name: "Ledian",
        types: ["Grass"],
        hp: 90,
        stage: "Stage1",
        evolveFrom: "Ledyba",
        abilities: ability("Glittering Star Pattern", GLITTERING),
        attacks: TAP,
      }),
    ]),
  ),
  ...Object.fromEntries(
    AURORUS.map((id) => [
      id,
      battler(id, {
        name: "Aurorus",
        types: ["Water"],
        hp: 170,
        stage: "Stage1",
        abilities: ability("Tundra Wall", TUNDRA_WALL),
        attacks: TAP,
      }),
    ]),
  ),
  [CENTISKORCH]: battler(CENTISKORCH, {
    name: "Centiskorch",
    types: ["Fire"],
    hp: 130,
    stage: "Stage1",
    attacks: [
      { cost: ["Fire"], name: "Billowing Heat Wave", effect: HEAT_WAVE, damage: 130 },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Heat Blast", damage: 80 },
    ],
  }),
  [FILLER]: battler(FILLER, { name: "B19 Filler", hp: 300, types: ["Colorless"], attacks: TAP }),
  [SMALL]: battler(SMALL, { name: "B19 Small", hp: 60, types: ["Colorless"], attacks: TAP }),
  [G]: typedEnergy(G, "Grass"),
  [W]: typedEnergy(W, "Water"),
  [R]: typedEnergy(R, "Fire"),
};

const DECK = deckOf({ [FILLER]: 20, [G]: 40 });

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 1919, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

interface Spec {
  id: string;
  energy?: readonly string[];
  damage?: number;
}
interface SideSpec {
  active: Spec;
  bench?: readonly Spec[];
  hand?: readonly string[];
}

/** TEST SURGERY — fresh uids for every card placed; both boards replaced. */
function table(p1: SideSpec, p2: SideSpec): GameState {
  const state: GameState = roundTrip(base());
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b19#${n++}`;
    state.cardIdByUid[uid] = id;
    const card = LOCAL[id];
    if (card === undefined) throw new Error(`no local face for ${id}`);
    state.cardPool = { ...state.cardPool, [id]: card };
    return uid;
  };
  const body = (spec: Spec): InPlayPokemon => ({
    ...makeInPlay(alloc(spec.id), 1),
    energy: (spec.energy ?? []).map(alloc),
    damage: spec.damage ?? 0,
  });
  for (const [seat, spec] of [
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    const side = state.players[seat];
    state.players[seat] = {
      ...side,
      active: body(spec.active),
      bench: (spec.bench ?? []).map(body),
      hand: (spec.hand ?? []).map(alloc),
      deck: Array.from({ length: 10 }, () => alloc(FILLER)),
    };
  }
  return state;
}

function rejection(state: GameState, action: GameAction): string | undefined {
  const result = applyAction(state, action);
  return result.ok ? undefined : result.error.code;
}

const benchAt = (state: GameState, seat: Seat, index: number): InPlayPokemon => {
  const body = state.players[seat].bench[index];
  if (body === undefined) throw new Error(`no ${seat} bench ${index}`);
  return body;
};
const activeOf = (state: GameState, seat: Seat): InPlayPokemon => {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`no ${seat} Active`);
  return body;
};
const idOf = (state: GameState, body: InPlayPokemon): string | undefined =>
  state.cardIdByUid[body.stack.at(-1) ?? ""];

const tealDance: GameAction = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Teal Dance",
};

// ─────────────────────────────────────────────────────────────────────────────

describe("B19 §1 — an EFFECT's attach from the hand is an attach from the hand (Auto Heal, Gnawing Curse)", () => {
  it("the programs: both rows watch `onEnergyAttach`, and nothing else in the registry does", () => {
    expect(programFor(MAGEARNA)?.triggered).toEqual([
      {
        name: "Auto Heal",
        trigger: "onEnergyAttach",
        activeOnly: true,
        program: [{ op: "healSubject", amount: 90 }],
      },
    ]);
    for (const id of GENGARS) {
      expect(programFor(id)?.triggered, id).toEqual([
        {
          name: "Gnawing Curse",
          trigger: "onEnergyAttach",
          opponentAction: true,
          program: [{ op: "damageSubject", amount: 20 }],
        },
      ]);
    }
    const watchers = programmedCardIds().filter((id) =>
      (programFor(id)?.triggered ?? []).some((t) => t.trigger === "onEnergyAttach"),
    );
    expect(watchers.filter((id) => !id.startsWith("fix-")).sort()).toEqual(
      [...GENGARS, MAGEARNA].sort(),
    );
  });

  it("Teal Dance onto a benched Ogerpon at 100 damage, Magearna Active: healed 90, ends at 10", () => {
    const state = table(
      { active: { id: MAGEARNA }, bench: [{ id: OGERPON, damage: 100 }], hand: [G] },
      { active: { id: FILLER } },
    );
    const { state: after, events } = must(state, tealDance);
    const ogerpon = benchAt(after, "p1", 0);
    expect(ogerpon.energy).toHaveLength(1);
    expect(ogerpon.damage).toBe(10);
    expect(
      events
        .filter((e) => e.type === "ABILITY_TRIGGERED")
        .map((e) => e.type === "ABILITY_TRIGGERED" && e.ability),
    ).toEqual(["Auto Heal"]);
    expect(events.filter((e) => e.type === "HEALED")).toHaveLength(1);
    // The Ability's own rider still resolves: one card drawn.
    expect(after.players.p1.hand).toHaveLength(1);
  });

  it("the heal is clamped to the damage present (Ogerpon at 40 ends at 0)", () => {
    const state = table(
      { active: { id: MAGEARNA }, bench: [{ id: OGERPON, damage: 40 }], hand: [G] },
      { active: { id: FILLER } },
    );
    expect(benchAt(must(state, tealDance).state, "p1", 0).damage).toBe(0);
  });

  it('control: Magearna on the BENCH heals nothing ("As long as this Pokémon is in the Active Spot")', () => {
    const state = table(
      {
        active: { id: FILLER },
        bench: [{ id: OGERPON, damage: 100 }, { id: MAGEARNA }],
        hand: [G],
      },
      { active: { id: FILLER } },
    );
    const { state: after, events } = must(state, tealDance);
    expect(benchAt(after, "p1", 0).damage).toBe(100);
    expect(events.some((e) => e.type === "HEALED")).toBe(false);
  });

  for (const id of GENGARS) {
    it(`${id}: Teal Dance under the opponent's Gengar ex puts 2 damage counters on that Ogerpon`, () => {
      const state = table(
        { active: { id: FILLER }, bench: [{ id: OGERPON, damage: 0 }], hand: [G] },
        { active: { id } },
      );
      const { state: after, events } = must(state, tealDance);
      expect(benchAt(after, "p1", 0).damage).toBe(20);
      expect(events.find((e) => e.type === "ABILITY_TRIGGERED")).toMatchObject({
        seat: "p2",
        ability: "Gnawing Curse",
      });
    });
  }

  it("both at once: the attaching player's Auto Heal first, then Gnawing Curse (100 → 10 → 30)", () => {
    const state = table(
      { active: { id: MAGEARNA }, bench: [{ id: OGERPON, damage: 100 }], hand: [G] },
      { active: { id: GENGARS[0] } },
    );
    const { state: after, events } = must(state, tealDance);
    expect(benchAt(after, "p1", 0).damage).toBe(30);
    expect(
      events
        .filter((e) => e.type === "ABILITY_TRIGGERED")
        .map((e) => e.type === "ABILITY_TRIGGERED" && e.ability),
    ).toEqual(["Auto Heal", "Gnawing Curse"]);
  });

  it("the attachFromHand path too: Lethargic Charge onto the Active Larry's Pokémon heals it and Gengar ex curses it", () => {
    const state = table(
      { active: { id: LARRY, damage: 100 }, bench: [{ id: KOMALA }], hand: [G] },
      { active: { id: GENGARS[1] } },
    );
    let { state: after } = must(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Lethargic Charge",
    });
    if (after.phase.kind === "effect:choose") {
      const uid = state.players.p1.hand[0] as string;
      after = must(after, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [{ uid, to: { seat: "p1", spot: { spot: "active" } } }],
        },
      }).state;
    }
    const larry = activeOf(after, "p1");
    expect(larry.energy).toHaveLength(1);
    // Gnawing Curse only: Magearna is not in play on this board.
    expect(larry.damage).toBe(120);
  });

  it("R-EIC1's order on the effect path: the watched triggers, THEN Electrified Incisors' counters (heal 0, then 80)", () => {
    const marked = table(
      { active: { id: MAGEARNA }, bench: [{ id: OGERPON, damage: 0 }], hand: [G] },
      { active: { id: FILLER } },
    );
    const bench0 = benchAt(marked, "p1", 0);
    marked.players.p1.bench[0] = {
      ...bench0,
      handAttachMark: {
        turn: marked.turn,
        barred: false,
        endsTurn: false,
        tripped: false,
        counters: 8,
      },
    };
    const viaEffect = must(marked, tealDance).state;
    const viaAction = must(marked, {
      type: "attachEnergy",
      seat: "p1",
      uid: marked.players.p1.hand[0] as string,
      target: { spot: "bench", index: 0 },
    }).state;
    expect(benchAt(viaAction, "p1", 0).damage).toBe(80);
    expect(benchAt(viaEffect, "p1", 0).damage).toBe(80);
  });

  it("control: the §6.2 attach action still heals exactly once", () => {
    const state = table(
      { active: { id: MAGEARNA }, bench: [{ id: OGERPON, damage: 100 }], hand: [G] },
      { active: { id: FILLER } },
    );
    const { state: after, events } = must(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: state.players.p1.hand[0] as string,
      target: { spot: "bench", index: 0 },
    });
    expect(benchAt(after, "p1", 0).damage).toBe(10);
    expect(events.filter((e) => e.type === "HEALED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const EVOLVERS = [
  { id: DUBWOOL, from: WOOLOO, name: "Defiant Horn" },
  { id: HARIYAMA, from: MAKUHITA, name: "Heave-Ho Catcher" },
  ...LEDIANS.map((id) => ({ id, from: LEDYBA, name: "Glittering Star Pattern" })),
] as const;

function evolveBoard(evolver: (typeof EVOLVERS)[number], opponentBench: number): GameState {
  return table(
    { active: { id: FILLER }, bench: [{ id: evolver.from }], hand: [evolver.id] },
    { active: { id: FILLER }, bench: Array.from({ length: opponentBench }, () => ({ id: SMALL })) },
  );
}

const evolve = (state: GameState): GameAction => ({
  type: "evolve",
  seat: "p1",
  uid: state.players.p1.hand[0] as string,
  target: { spot: "bench", index: 0 },
});

describe('B19 §2 — "you may switch in 1 of your opponent\'s Benched Pokémon" can be declined', () => {
  for (const evolver of EVOLVERS) {
    it(`${evolver.id} "${evolver.name}": one opposing Benched Pokémon is ASKED, and the decline keeps the Active`, () => {
      const state = evolveBoard(evolver, 1);
      const { state: parked } = must(state, evolve(state));
      expect(parked.phase.kind).toBe("effect:choose");
      if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
      expect(parked.phase.prompt).toMatchObject({ kind: "choosePokemon", upTo: 1 });
      const declined = must(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon" },
      }).state;
      expect(declined.phase.kind).toBe("turn:action");
      expect(idOf(declined, activeOf(declined, "p2"))).toBe(FILLER);
      expect(declined.players.p2.bench).toHaveLength(1);
    });

    it(`${evolver.id}: two opposing Benched Pokémon — the decline is accepted, and taking one still gusts it`, () => {
      const state = evolveBoard(evolver, 2);
      const { state: parked } = must(state, evolve(state));
      expect(
        rejection(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } }),
      ).toBeUndefined();
      const taken = must(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
      }).state;
      expect(idOf(taken, activeOf(taken, "p2"))).toBe(SMALL);
      expect(idOf(taken, benchAt(taken, "p2", 1))).toBe(FILLER);
    });

    it(`${evolver.id}: control — no opposing Bench, nothing is asked`, () => {
      const state = evolveBoard(evolver, 0);
      const { state: after } = must(state, evolve(state));
      expect(after.phase.kind).toBe("turn:action");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe("B19 §3 — Tundra Wall shields only from the OPPONENT's attacks", () => {
  const SEAT_AURA_IDS = [
    "sv02-113",
    "sv10-086",
    "sv07-119",
    "svp-136",
    "sv10.5b-063",
    "sv10.5b-141",
    "me05-072",
    "me03-024",
    "me03-092",
    "sv08.5-067",
  ];

  it('every `seatDamageReductionAfterWR` row is one of the ids whose print says "from attacks from your opponent\'s Pokémon"', () => {
    const rows = programmedCardIds().filter(
      (id) =>
        !id.startsWith("fix-") && programFor(id)?.passive?.seatDamageReductionAfterWR !== undefined,
    );
    expect(rows.sort()).toEqual([...SEAT_AURA_IDS].sort());
  });

  for (const id of AURORUS) {
    it(`${id}: Billowing Heat Wave's own-Bench 30 is NOT reduced on the {W} bodies`, () => {
      const state = table(
        {
          active: { id: CENTISKORCH, energy: [R] },
          bench: [{ id, energy: [W] }, { id: FILLER, energy: [W] }, { id: FILLER }],
        },
        { active: { id: FILLER } },
      );
      const { state: after } = must(state, { type: "attack", seat: "p1", index: 0 });
      expect([0, 1, 2].map((i) => benchAt(after, "p1", i).damage)).toEqual([30, 30, 30]);
      expect(activeOf(after, "p2").damage).toBe(130);
    });

    it(`${id}: control — the opponent's attack on a {W} body is still reduced by 50`, () => {
      const state = table(
        { active: { id: FILLER }, bench: [{ id, energy: [W] }] },
        { active: { id: FILLER, energy: [W] }, bench: [{ id: FILLER }] },
      );
      const watered = activeOf(state, "p2");
      // p2's Active is shielded by nothing (no Aurorus on p2's side); p1's {W} body by Tundra Wall.
      expect(seatDamageReduction(state, benchAt(state, "p1", 0), "all", "p2")).toBe(50);
      expect(seatDamageReduction(state, benchAt(state, "p1", 0), "all", "p1")).toBe(0);
      expect(seatDamageReduction(state, watered, "all", "p1")).toBe(0);
    });
  }
});
