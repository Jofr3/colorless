import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import { POKEMON_TYPE_BY_CODE } from "./deriver/vocabulary";
import { POKEMON_TYPES } from "./effectTypes";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { runProgram } from "./interpreter";
import {
  DISCARD_ATTACH_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon.",
    program: [
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        toSelf: true,
        count: 2,
      },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon.",
    program: [{ op: "attachEnergyFrom", source: "discard", benchOnly: true }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", benchOnly: true, count: 2 },
    ] as EffectOp[],
    printings: 8,
    legalPrintings: 2,
  },
  {
    text: "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
    program: [
      { op: "attachEnergyFrom", source: "discard", declinable: true },
      { op: "attachEnergyFrom", source: "discard", declinable: true },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 1,
  },
  {
    text: "Attach a Basic {R} Energy card from your discard pile to 1 of your {N} Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", energyType: "Fire", targetType: "Dragon" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Attach a Basic {F} Energy card from your discard pile to this Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", toSelf: true },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach a Basic {M} Energy card from your discard pile to this Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", energyType: "Metal", toSelf: true },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Attach up to 2 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like.",
    program: [
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        benchOnly: true,
        declinable: true,
      },
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        benchOnly: true,
        declinable: true,
      },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Attach an Energy card from your discard pile to this Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", anyEnergy: true, toSelf: true },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.",
    program: [
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        benchOnly: true,
        toEach: true,
      },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
] as const;

const REGI_CHARGE_TEXT = 0;
const SAND_GIFT_TEXT = 1;
const FAULT_LINE_TEXT = 2;
const PICK_AND_STICK_TEXT = 3;
const DRAGONS_FURY_TEXT = 4;
const SELF_ONE_TEXT = 5;
const METAL_SELF_TEXT = 6;
const BENCH_ANY_WAY_TEXT = 7;
const MUD_STOCK_TEXT = 9;

const UNREAD: readonly (readonly [string, number, string])[] = [] as const;

const BUILT_ELSEWHERE: readonly (readonly [string, number, string])[] = [
  [
    "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.",
    1,
    'BUILT at D528 on `deriveAttackCoinFlip` (`ATTACK_COIN_ATTACH_UP_TO_HEADS`) as `programPerHeads` over one `attachEnergyFrom { discard, Lightning, benchOnly, declinable }` — this arm\'s own op for the printed-digit sibling, with N = heads; THIS anchor never spans the "Flip N coins." head',
  ],
] as const;

const LITERAL: readonly (readonly [string, number, string])[] = [
  [
    "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
    1,
    'BUILT at D532 on `deriveAttackEffect` (`ATTACK_OPPONENT_DISCARD_ATTACH`, a separate zero-capture literal) as D360\'s spread one key over — `whose: "opponent"` on the op and on `AttachTargetRiders`, read through `attachSeat` for the pile and the board together',
  ],
] as const;

const ROTATED_EACH_OF =
  "Choose up to 2 of your Benched Pokémon and attach a Basic {R} Energy card from your discard pile to each of them.";

const HAND_SIDE_NEAR_MISS = "Attach a Basic Energy card from your hand to 1 of your Pokémon.";

const REGI_CHARGE = 29;
const SAND_GIFT = 30;
const FAULT_LINE = 31;
const PICK_AND_STICK = 32;
const DRAGONS_FURY = 33;
const MUD_STOCK = 34;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DISCARD_ATTACH_DECK, p2: DISCARD_ATTACH_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order and a discard pile stocked type by type. p2 is a plain body so
    nothing on the other side of the table can be reached by accident. */
function ready(
  seed: number,
  {
    bench = ["fix-basic-1", "fix-basic-1"],
    discard = {},
  }: { bench?: readonly string[]; discard?: Record<string, number> },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const [id, count] of Object.entries(discard)) {
    state = discardFromDeck(state, "p1", id, count);
  }
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `choosePokemon` prompt an attack produced, narrowed. */
function parkedTargets(state: GameState): readonly PokemonRef[] {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemon")
    throw new Error(`expected choosePokemon, got ${prompt.kind}`);
  return prompt.candidates;
}

const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

function pick(
  state: GameState,
  ref: PokemonRef,
  take?: number,
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — twelve printed sentences, ONE arm", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 15 of the row's 17 legal printings, across 10 of its 12 sentences", () => {
    expect(CLAUSES).toHaveLength(10);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(15);
    expect(UNREAD).toHaveLength(0);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(0);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    expect(BUILT_ELSEWHERE).toHaveLength(1);
    expect(BUILT_ELSEWHERE.reduce((sum, [, legal]) => sum + legal, 0)).toBe(1);
    for (const [text] of BUILT_ELSEWHERE) {
      // THIS anchor still refuses it (the "Flip N coins." head defeats `^Attach`); the coin reader
      // claims it — the positive reading lives in `headsCeilingDiscardAttach.test.ts`.
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(deriveAttackCoinFlip(text)?.kind, text).toBe("programPerHeads");
    }
    expect(LITERAL).toHaveLength(1);
    expect(LITERAL.reduce((sum, [, legal]) => sum + legal, 0)).toBe(1);
    for (const [text] of LITERAL) {
      const derived = deriveAttackEffect(text);
      expect(derived, text).not.toBeNull();
      expect(derived, text).toHaveLength(3);
      for (const op of derived ?? []) {
        expect(op, text).toEqual({
          op: "attachEnergyFrom",
          source: "discard",
          anyEnergy: true,
          declinable: true,
          whose: "opponent",
        });
      }
      expect(text.includes(" from your discard pile"), text).toBe(false);
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 0 + 1 + 1).toBe(17);
    expect(CLAUSES.length + UNREAD.length).toBe(10);
    expect(CLAUSES.length + UNREAD.length + BUILT_ELSEWHERE.length + LITERAL.length).toBe(12);
  });

  it("reads 40 of the family's 43 CATALOG printings too — an arm transfers", () => {
    expect(CLAUSES.reduce((sum, c) => sum + c.printings, 0)).toBe(22);
    for (const text of [
      "Attach up to 2 Basic {R} Energy cards from your discard pile to 1 of your Pokémon.",
      "Attach up to 2 Basic {W} Energy cards from your discard pile to 1 of your Pokémon.",
    ]) {
      expect(deriveAttackEffect(text), text).toEqual([
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: text.includes("{R}") ? "Fire" : "Water",
          count: 2,
        },
      ]);
    }
    expect(deriveAttackEffect(ROTATED_EACH_OF)).toBeNull();
  });

  it("the SOURCE side is one word from row 12, and the two must not collapse", () => {
    expect(HAND_SIDE_NEAR_MISS).toContain("from your hand to");
    expect(deriveAttackEffect(HAND_SIDE_NEAR_MISS)).toEqual([
      { op: "attachEnergyFrom", source: "hand" },
    ]);
    expect(
      deriveAttackEffect("Attach a Basic Energy card from your discard pile to 1 of your Pokémon."),
    ).toEqual([{ op: "attachEnergyFrom", source: "discard" }]);
    expect(
      deriveAttackEffect(
        "Attach a Basic {G} Energy card from your discard pile to 1 of your Benched Pokémon. If you do, heal all damage from that Pokémon.",
      ),
    ).toBeNull();
  });

  it("the NOUN and the DESTINATION are independent axes, which is why it is one arm", () => {
    const [bare] = deriveAttackEffect(CLAUSES[SAND_GIFT_TEXT].text) ?? [];
    const [typed] =
      deriveAttackEffect(
        "Attach a Basic {W} Energy card from your discard pile to 1 of your Benched Pokémon.",
      ) ?? [];
    expect(typed).toEqual({ ...bare, energyType: "Water" });
    const [self] = deriveAttackEffect(CLAUSES[SELF_ONE_TEXT].text) ?? [];
    const [metal] = deriveAttackEffect(CLAUSES[METAL_SELF_TEXT].text) ?? [];
    expect(metal).toEqual({ ...self, energyType: "Metal" });
    // …and the count rides the same arm at a value no card prints today, which is
    // the whole reason it is a capture rather than an alternation over 2 and 3.
    expect(
      deriveAttackEffect(
        "Attach up to 5 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
      ),
    ).toEqual([{ op: "attachEnergyFrom", source: "discard", benchOnly: true, count: 5 }]);
  });

  it("`count` and 'in any way you like' are DIFFERENT PROGRAMS, and both are printed", () => {
    const batch = deriveAttackEffect(CLAUSES[FAULT_LINE_TEXT].text) ?? [];
    const spread = deriveAttackEffect(CLAUSES[BENCH_ANY_WAY_TEXT].text) ?? [];
    expect(batch).toHaveLength(1);
    expect(spread).toHaveLength(2);
    expect(batch[0]).toHaveProperty("count", 2);
    for (const op of spread) expect(op).not.toHaveProperty("count");
    // The two spread ops are IDENTICAL to each other — a distribution is N copies
    // of one decision (Koraidon ex "Dino Cry"'s authored shape), never one op that
    // knows it is the second.
    expect(spread[0]).toEqual(spread[1]);
    expect(CLAUSES[FAULT_LINE_TEXT].legalPrintings).toBeGreaterThan(0);
    expect(CLAUSES[BENCH_ANY_WAY_TEXT].legalPrintings).toBeGreaterThan(0);
  });

  it("a SINGULAR printing emits NO `count`, because absent means 1 (D205)", () => {
    // The op's rows are compared BY VALUE against hand-authored registry ones, so
    // an explicit `count: 1` here would make a derived program unequal to the
    // registry program that means the same thing.
    for (const index of [SAND_GIFT_TEXT, DRAGONS_FURY_TEXT, SELF_ONE_TEXT, METAL_SELF_TEXT]) {
      for (const op of CLAUSES[index]?.program ?? []) expect(op).not.toHaveProperty("count");
    }
    expect(deriveAttackEffect(CLAUSES[SAND_GIFT_TEXT].text)).toEqual([
      { op: "attachEnergyFrom", source: "discard", benchOnly: true },
    ]);
  });

  it("refuses the anchor, grammar, punctuation and case rewrites", () => {
    const bare = CLAUSES[SAND_GIFT_TEXT].text;
    const rewrites = [
      `Draw a card. ${bare}`,
      `${bare} Draw a card.`,
      // Case, both ends.
      bare.replace("Attach", "attach"),
      bare.replace("Benched", "benched"),
      // The trailing period.
      bare.slice(0, -1),
      "Attach a Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
      "Attach up to 2 Basic Energy card from your discard pile to 1 of your Benched Pokémon.",
      // A printed 0 would derive to a program that moves nothing.
      "Attach up to 0 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
      // …and past the ingested-text ceiling, which is load-bearing on the spread
      // branch: it grows the PROGRAM one op per unit.
      "Attach up to 11 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
      "Attach a Basic Energy card from your deck to 1 of your Benched Pokémon.",
      // A destination the table does not name — the residue's own shape, and the
      // reason the phrase is a Map lookup rather than a `.+` the arm trusts.
      "Attach a Basic Energy card from your discard pile to your opponent's Active Pokémon.",
      // A brace code the ENERGY map refuses ({C} is the provision fallback).
      "Attach a Basic {C} Energy card from your discard pile to this Pokémon.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("carries NO new op, and exactly ONE op field this arm did not pay for", () => {
    const known = new Set([
      "op",
      "source",
      "energyType",
      "count",
      "targetType",
      "benchOnly",
      "toSelf",
      "anyEnergy",
      "toEach",
      "declinable",
    ]);
    for (const { program } of CLAUSES) {
      for (const op of program) {
        expect(op.op).toBe("attachEnergyFrom");
        for (const key of Object.keys(op)) expect(known, `${key}`).toContain(key);
      }
    }
  });

  it("the brace-coded destination is generated from POKEMON_TYPE_BY_CODE, not listed", () => {
    expect(new Set(Object.values(POKEMON_TYPE_BY_CODE))).toEqual(new Set(POKEMON_TYPES));
    expect(POKEMON_TYPE_BY_CODE.N).toBe("Dragon");
    expect(POKEMON_TYPE_BY_CODE.C).toBe("Colorless");
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackEffect(
          `Attach a Basic Energy card from your discard pile to 1 of your {${code}} Pokémon.`,
        ),
        code,
      ).toEqual([{ op: "attachEnergyFrom", source: "discard", targetType: type }]);
    }
    // …and a code in NEITHER map is refused rather than silently dropped.
    expect(
      deriveAttackEffect(
        "Attach a Basic Energy card from your discard pile to 1 of your {Z} Pokémon.",
      ),
    ).toBeNull();
  });
});

describe("PROVENANCE — the demonstrator carries six of the sentences at 29-34", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 29-34, appended and not inserted", () => {
    expect(attacks()).toHaveLength(73);
    expect(attacks()[REGI_CHARGE]?.effect).toBe(CLAUSES[REGI_CHARGE_TEXT].text);
    expect(attacks()[SAND_GIFT]?.effect).toBe(CLAUSES[SAND_GIFT_TEXT].text);
    expect(attacks()[FAULT_LINE]?.effect).toBe(CLAUSES[FAULT_LINE_TEXT].text);
    expect(attacks()[PICK_AND_STICK]?.effect).toBe(CLAUSES[PICK_AND_STICK_TEXT].text);
    expect(attacks()[DRAGONS_FURY]?.effect).toBe(CLAUSES[DRAGONS_FURY_TEXT].text);
    expect(attacks()[MUD_STOCK]?.effect).toBe(CLAUSES[MUD_STOCK_TEXT].text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks()[28]?.effect).toBe(
      "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
    );
  });

  it("NO printed base damage on any of the six — stated, because it is a CHOICE", () => {
    for (const index of [
      REGI_CHARGE,
      SAND_GIFT,
      FAULT_LINE,
      PICK_AND_STICK,
      DRAGONS_FURY,
      MUD_STOCK,
    ]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does.
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("the demonstrator's own attack rows still DERIVE to this slice's programs", () => {
    expect(deriveAttackEffect(attacks()[REGI_CHARGE]?.effect ?? "")).toEqual(
      CLAUSES[REGI_CHARGE_TEXT].program,
    );
    expect(deriveAttackEffect(attacks()[MUD_STOCK]?.effect ?? "")).toEqual(
      CLAUSES[MUD_STOCK_TEXT].program,
    );
  });
});

describe("end to end — an ATTACK pulling Energy out of the discard pile", () => {
  it("the SELF target forces: no park, and the Energy lands on the attacker", () => {
    const state = ready(3, { discard: { "fix-fighting-energy": 2, "fix-water-energy": 2 } });
    const attacker = activeUid(state, "p1");
    const before = state.players.p1.discard.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: REGI_CHARGE,
    });

    expect(parkedTargets(done)).toEqual([ACTIVE_REF]);
    const answered = pick(done, ACTIVE_REF);
    const attached = all([...events, ...answered.events], "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const e of attached) expect(e.target).toEqual({ spot: "active" });
    const after = answered.state;
    expect(after.players.p1.active?.energy).toHaveLength(3); // the {C} cost + two {F}
    const moved = attached.map((e) => after.cardIdByUid[e.uid]);
    expect(moved).toEqual(["fix-fighting-energy", "fix-fighting-energy"]);
    expect(after.players.p1.discard).toHaveLength(before - 2);
    expect(after.players.p1.discard.map((u) => after.cardIdByUid[u])).toEqual([
      "fix-water-energy",
      "fix-water-energy",
    ]);
    expect(activeUid(after, "p1")).toBe(attacker);
  });

  it("the BENCH-ONLY target parks on the Bench alone — the Active is not offered", () => {
    const state = ready(5, { discard: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: SAND_GIFT });

    const targets = parkedTargets(parked);
    expect(parked.phase.kind === "effect:choose" ? parked.phase.seat : undefined).toBe("p1");
    expect(targets).toHaveLength(2);
    for (const ref of targets) {
      expect(ref.seat).toBe("p1");
      expect(ref.spot.spot).toBe("bench");
    }
    expect(targets).not.toContainEqual(ACTIVE_REF);

    const { state: done, events } = pick(parked, benchRef(1));
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(1);
    expect(attached[0]?.target).toEqual({ spot: "bench", index: 1 });
    expect(done.players.p1.bench[1]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(0);
  });

  it("`count: 2` puts BOTH cards on the ONE chosen body, in ONE decision", () => {
    const state = ready(7, { discard: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: FAULT_LINE });
    expect(parkedTargets(parked)).toHaveLength(2);

    const { state: done, events } = pick(parked, benchRef(0));
    // ONE park, then the whole batch lands: the attack is over.
    expect(done.phase.kind).not.toBe("effect:choose");
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const e of attached) expect(e.target).toEqual({ spot: "bench", index: 0 });
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(0);
  });

  it("…and 'in any way you like' asks TWICE, and the two may land APART", () => {
    const state = ready(7, { discard: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    });
    // Un-narrowed destination: the ATTACKER is offered here where `benchOnly`
    // excluded it two cases up.
    expect(parkedTargets(parked)).toHaveLength(3);
    expect(parkedTargets(parked)).toContainEqual(ACTIVE_REF);

    const first = pick(parked, benchRef(0));
    expect(first.state.phase.kind).toBe("effect:choose");
    expect(all(first.events, "ENERGY_ATTACHED")).toHaveLength(1);
    const second = pick(first.state, benchRef(1));
    expect(second.state.phase.kind).not.toBe("effect:choose");
    expect(all(second.events, "ENERGY_ATTACHED")).toHaveLength(1);
    // …and they landed on two DIFFERENT bodies, which is what the printed phrase
    // buys and what `count` cannot express.
    expect(second.state.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(second.state.players.p1.bench[1]?.energy).toHaveLength(1);
  });

  it("the {N} destination offers the DRAGON body and refuses the one beside it", () => {
    const state = ready(9, {
      bench: ["sv03-161", "fix-basic-1"],
      discard: { "fix-fire-energy": 2, "fix-water-energy": 2 },
    });
    expect(FIXTURE_POOL["sv03-161"]?.types).toEqual(["Dragon"]);
    expect(FIXTURE_POOL["fix-basic-1"]?.types).not.toContain("Dragon");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAGONS_FURY,
    });
    // ONE eligible target on the whole board, so `parkOrForce` forces — and the
    // forcing IS the assertion: an un-narrowed build offers three and parks.
    expect(done.phase.kind).not.toBe("effect:choose");
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(1);
    expect(attached[0]?.target).toEqual({ spot: "bench", index: 0 });
    // …and the {R} filter bit as well: the pile held {W} too.
    expect(done.cardIdByUid[attached[0]?.uid ?? ""]).toBe("fix-fire-energy");
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(0);
  });

  it("an EMPTY discard pile is a silent whiff, not a refusal — an attack is already paid for", () => {
    const state = ready(11, {});
    expect(state.players.p1.discard.filter((u) => state.cardIdByUid[u] !== undefined).length).toBe(
      state.players.p1.discard.length,
    );
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SAND_GIFT,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    // …and the SAME program under the card-play gate is refused on that board,
    // which is the contrast that makes the sentence above a measurement.
    expect(programPlayable(state, CLAUSES[SAND_GIFT_TEXT].program, "p1")).toBe(false);
    const stocked = discardFromDeck(state, "p1", "fix-energy", 1);
    expect(programPlayable(stocked, CLAUSES[SAND_GIFT_TEXT].program, "p1")).toBe(true);
  });

  it("takes FEWER than `count` when the pile holds fewer, silently — the printed 'up to'", () => {
    const state = ready(13, { discard: { "fix-fighting-energy": 1 } });
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: REGI_CHARGE });
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBe(2);
    const { state: done, events } = pick(parked.state, ACTIVE_REF);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.active?.energy).toHaveLength(2); // the {C} cost + one {F}
    expect(done.players.p1.discard).toHaveLength(0);
  });

  it("D359 — Regi Charge's printed MIDDLE answer: ONE of two, the rest left", () => {
    const state = ready(13, { discard: { "fix-fighting-energy": 2 } });
    const parked = mustApply(state, { type: "attack", seat: "p1", index: REGI_CHARGE });
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const { state: done, events } = pick(parked.state, ACTIVE_REF, 1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.active?.energy).toHaveLength(2); // the {C} cost + one {F}
    // The second {F} is still in the pile — the whole point of the middle answer.
    expect(
      done.players.p1.discard.filter((u) => done.cardIdByUid[u] === "fix-fighting-energy"),
    ).toHaveLength(1);
  });

  it("D248 — the SPREAD feeds every Benched body at once and asks NOTHING", () => {
    const state = ready(15, { discard: { "fix-fighting-energy": 3 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.bench.map((p) => p.energy.length)).toEqual([1, 1]);
    const fed = done.players.p1.bench.flatMap((p) => p.energy);
    expect(new Set(fed).size).toBe(2);
    // One of the three {F} is left in the pile, because there were only two
    // bodies: the spread takes ONE per body, never the whole pile.
    expect(done.players.p1.discard).toHaveLength(1);
    // The ACTIVE is untouched — `benchOnly` is the printed word "Benched", and it
    // is the SAME field the singular destinations use. It still holds only its
    // {C} cost.
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("D248 — the pile running dry mid-spread feeds as many as it can", () => {
    const state = ready(15, {
      bench: ["fix-basic-1", "fix-basic-1", "fix-basic-1"],
      discard: { "fix-fighting-energy": 1 },
    });
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    if (parked.phase.kind !== "effect:choose")
      throw new Error(`expected a park, got ${parked.phase.kind}`);
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti")
      throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    expect(prompt.candidates).toEqual([benchRef(0), benchRef(1), benchRef(2)]);
    const { state: done, events: fed } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(2)] },
    });
    expect(all(fed, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.bench.map((p) => p.energy.length)).toEqual([0, 0, 1]);
    expect(done.players.p1.discard).toHaveLength(0);
  });

  it("D248 — an EMPTY Bench is a silent whiff, not a throw", () => {
    // The other end of the same fold: the eligible set is empty, so `reduce`
    // returns the seed state untouched. The pile keeps all three cards, which is
    // what separates "nothing to attach to" from "attached and lost".
    const state = ready(15, { bench: [], discard: { "fix-fighting-energy": 3 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(3);
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("D248 — an EMPTY pile is the whiff guard, one step earlier", () => {
    const state = ready(15, { discard: { "fix-water-energy": 3 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(3);
    expect(done.players.p1.bench.every((p) => p.energy.length === 0)).toBe(true);
  });

  it("D248 — the spread is the ATTACKER's own board, on both ends", () => {
    // The one-`otherSeat`-apart pairing, asked of the fold specifically: a build
    // that walked the OPPONENT's bench, or drew from their pile, would pass every
    // count assertion above. p2 has an Active and one Benched body here.
    const state = ready(15, { discard: { "fix-fighting-energy": 3 } });
    const opponentDiscard = state.players.p2.discard.length;
    deepFreeze(state);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: MUD_STOCK });
    expect(done.players.p2.discard).toHaveLength(opponentDiscard);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });

  it("the attach is the ATTACKER's own board, on both ends", () => {
    // The one-`otherSeat`-apart pairing every op in this family owes: a build that
    // read the opponent's discard pile, or benched the Energy on their side, would
    // pass every count assertion above. Both zones are named.
    const state = ready(17, { discard: { "fix-energy": 2 } });
    const opponentDiscard = state.players.p2.discard.length;
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: SAND_GIFT });
    for (const ref of parkedTargets(parked)) expect(ref.seat).toBe("p1");
    const { state: done } = pick(parked, benchRef(0));
    expect(done.players.p2.discard).toHaveLength(opponentDiscard);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });
});

describe("D248 — `toEach` is ORTHOGONAL to `benchOnly`, not welded to it", () => {
  const EACH_UNNARROWED =
    "Attach a Basic {F} Energy card from your discard pile to each of your Pokémon.";

  it("THE FLAGGED CALL, WITH THE EVIDENCE BOTH WAYS — and the mutant that installs the other reading", () => {
    expect(deriveAttackEffect(EACH_UNNARROWED)).toEqual([
      { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", toEach: true },
    ]);
    // …and the printed sentence keeps BOTH fields, so the two are readable
    // independently rather than one implying the other.
    expect(deriveAttackEffect(CLAUSES[MUD_STOCK_TEXT].text)).toEqual([
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        benchOnly: true,
        toEach: true,
      },
    ]);
  });

  it("the un-narrowed spread FEEDS THE ACTIVE — the board the welded reading gets wrong", () => {
    const state = ready(15, { discard: { "fix-fighting-energy": 3 } });
    deepFreeze(state);
    const events: GameEvent[] = [];
    const program = deriveAttackEffect(EACH_UNNARROWED) ?? [];
    const result = runProgram(state, program, { seat: "p1" }, {}, events);
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    // THREE bodies — the Active and both Benched — and three attachments. Under
    // the welded reading this would be 2, with the Active left holding only its
    // {C} cost.
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
    expect(result.state.players.p1.active?.energy).toHaveLength(2);
    expect(result.state.players.p1.bench.map((p) => p.energy.length)).toEqual([1, 1]);
    expect(result.state.players.p1.discard).toHaveLength(0);
  });
});

describe("D248 — the distribution axis has THREE members and a print is exactly one", () => {
  it("`count`, `anyWay` and `toEach` are three different programs off three phrases", () => {
    expect(deriveAttackEffect(CLAUSES[FAULT_LINE_TEXT].text)).toEqual([
      { op: "attachEnergyFrom", source: "discard", benchOnly: true, count: 2 },
    ]);
    expect(deriveAttackEffect(CLAUSES[BENCH_ANY_WAY_TEXT].text)).toHaveLength(2);
    const spread = deriveAttackEffect(CLAUSES[MUD_STOCK_TEXT].text) ?? [];
    expect(spread).toHaveLength(1);
    // Exactly one member set, on each of the three.
    for (const program of [spread]) {
      for (const op of program) {
        expect("count" in op).toBe(false);
      }
    }
  });

  it("the two CROSSES the spread destination refuses, and they refuse for PRINT reasons", () => {
    for (const text of [
      "Attach up to 2 Basic {F} Energy cards from your discard pile to each of your Benched Pokémon.",
      "Attach up to 3 Basic Energy cards from your discard pile to each of your Pokémon.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // The heal tail is the HAND anchor's optional group, so the cross is spelled
    // in that zone — the only one whose clause carries a tail at all.
    expect(
      deriveAttackEffect(
        "Attach a Basic {F} Energy card from your hand to each of your Benched Pokémon. If you do, heal all damage from that Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Attach a Basic {F} Energy card from your hand to each of your Benched Pokémon.",
      ),
    ).toEqual([
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Fighting",
        benchOnly: true,
        toEach: true,
      },
    ]);
  });

  it("`programPlayable` needs ZERO arms for the spread — priced by grep, then driven", () => {
    const program = deriveAttackEffect(CLAUSES[MUD_STOCK_TEXT].text) ?? [];
    const stocked = ready(15, { discard: { "fix-fighting-energy": 3 } });
    expect(programPlayable(stocked, program, "p1")).toBe(true);
    // An empty Bench: the eligible set is empty, so the attach can only whiff.
    const benchless = ready(15, { bench: [], discard: { "fix-fighting-energy": 3 } });
    expect(programPlayable(benchless, program, "p1")).toBe(false);
    const empty = ready(15, { discard: {} });
    expect(programPlayable(empty, program, "p1")).toBe(false);
  });
});

describe("D360 §6 — the discriminator is the PRINTED word, not the derived count", () => {
  it("'up to 1' and the unhedged singular derive to the SAME op count and DIFFERENT flags", () => {
    const hedged = deriveAttackEffect(
      "Attach up to 1 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
    );
    const bare = deriveAttackEffect(
      "Attach a Basic Energy card from your discard pile to your Pokémon in any way you like.",
    );
    expect(hedged).toEqual([{ op: "attachEnergyFrom", source: "discard", declinable: true }]);
    expect(bare).toEqual([{ op: "attachEnergyFrom", source: "discard" }]);
    // The two are ONE op each — so a build that inferred the hedge from the
    // PROGRAM'S LENGTH, or from `count`, cannot tell them apart at all.
    expect(hedged).toHaveLength(1);
    expect(bare).toHaveLength(1);
  });

  it("the flag is scoped to the SPREAD — it never lands beside `count`", () => {
    for (const { text, program } of CLAUSES) {
      const derived = (deriveAttackEffect(text) ?? []) as Record<string, unknown>[];
      expect(derived, text).toEqual(program);
      for (const op of derived) {
        expect(op.declinable === true && op.count !== undefined, text).toBe(false);
        // …and every op of a hedged SPREAD carries it, never just the first: a
        // player who could stop before the first card but not between the others
        // has not been given what "up to" says.
        if (derived.length > 1) expect(op.declinable, text).toBe(true);
      }
    }
  });

  it('D532 — the CROSS-SEAT hedge is BUILT (re-pointed in place, D418): three declinable ops carrying `whose: "opponent"` and `anyEnergy` on its OWN anchor, and the D234 anchor still cannot match it', () => {
    const cross =
      "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.";
    const derived = deriveAttackEffect(cross);
    expect(derived).toHaveLength(3);
    for (const op of derived ?? []) {
      expect(op).toEqual({
        op: "attachEnergyFrom",
        source: "discard",
        anyEnergy: true,
        declinable: true,
        whose: "opponent",
      });
    }
    expect(cross.includes(" from your discard pile")).toBe(false);
    expect(
      deriveAttackEffect(
        "Attach up to 3 Energy cards from your discard pile to your Pokémon in any way you like.",
      ),
    ).toBeNull();
  });
});

describe("D360 §7 — Morpeko's printed {0, 1, 2}, driven on a board", () => {
  /** The spread's three answers over the same board: two eligible Bench bodies
      plus the un-narrowed attacker, and three {C} in the pile so AVAILABILITY is
      never what bounds the result. */
  const stocked = (seed: number): GameState => ready(seed, { discard: { "fix-energy": 3 } });

  it("TWO — the pre-D360 behaviour, still reachable and still the default", () => {
    const parked = mustApply(stocked(21), {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    }).state;
    const first = pick(parked, benchRef(0));
    const second = pick(first.state, benchRef(1));
    expect(all([...first.events, ...second.events], "ENERGY_ATTACHED")).toHaveLength(2);
    expect(second.state.phase.kind).not.toBe("effect:choose");
  });

  it("ONE — the printed MIDDLE answer, UNREACHABLE on this sentence before D360", () => {
    const parked = mustApply(stocked(22), {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    }).state;
    const first = pick(parked, benchRef(0));
    expect(first.state.phase.kind).toBe("effect:choose"); // the second decision
    const declined = mustApply(first.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" }, // no `ref` — the decline
    });
    expect(all(declined.events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(declined.state.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(declined.state.players.p1.bench[1]?.energy).toHaveLength(0);
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    expect(declined.state.players.p1.discard).toHaveLength(2);
  });

  it("ZERO — and on an ATTACK it has no other route, which is why this half broke differently", () => {
    const parked = mustApply(stocked(23), {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    }).state;
    let cur = parked;
    for (let i = 0; i < 2; i++) {
      expect(cur.phase.kind, `park ${i + 1}`).toBe("effect:choose");
      cur = mustApply(cur, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon" },
      }).state;
    }
    expect(cur.phase.kind).not.toBe("effect:choose");
    expect(cur.players.p1.bench[0]?.energy).toHaveLength(0);
    expect(cur.players.p1.bench[1]?.energy).toHaveLength(0);
    expect(cur.players.p1.active?.energy).toHaveLength(1); // the {C} attack cost, untouched
    expect(cur.players.p1.discard).toHaveLength(3); // nothing left the pile
  });

  it("the ceiling reaches the PROMPT as `upTo: 1`, which is the whole wire cost", () => {
    const parked = mustApply(stocked(24), {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBe(1);
    expect(prompt.note).toContain("the Energy");
    expect(prompt.candidates).toHaveLength(3);
  });
});
