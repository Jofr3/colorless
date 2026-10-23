import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackDiscardScaledBoost, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  HAND_ATTACH_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handToDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Attach a Basic Energy card from your hand to this Pokémon.",
    program: [{ op: "attachEnergyFrom", source: "hand", toSelf: true }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach a Basic Energy card from your hand to 1 of your Pokémon.",
    program: [{ op: "attachEnergyFrom", source: "hand" }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like.",
    program: [
      { op: "attachEnergyFrom", source: "hand", energyType: "Psychic", declinable: true },
      { op: "attachEnergyFrom", source: "hand", energyType: "Psychic", declinable: true },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal all damage from that Pokémon.",
    program: [
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Grass",
        benchOnly: true,
        healTarget: "all",
      },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 3,
  },
  {
    text: "Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "hand", anyEnergy: true, toSelf: true, healTarget: 60 },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
] as const;

const WRAPPED_TEXT = 0;
const LUCKY_TEXT = 1;
const FULL_HEART_TEXT = 2;
const LEAFLET_TEXT = 3;

const UNREAD: readonly (readonly [string, number, string])[] = [
  [
    "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.",
    1,
    "two sentences, an unbounded count AND an ORDERING clause ('Before doing damage') that no reader in this engine can honour — the multiply fold reads the board at declaration",
  ],
] as const;

const DISCARD_SIDE_NEAR_MISS =
  "Attach a Basic Energy card from your discard pile to 1 of your Pokémon.";

const GATED_ELSEWHERE =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.";

const UNBOUNDED_ELSEWHERE = {
  text: "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
  legalPrintings: 4,
} as const;

const WRAPPED_IN_WIND = 43;
const LUCKY_ATTACHMENT = 44;
const FULL_HEART = 45;
const LEAFLET_BLESSINGS = 46;
const TROPICAL_FRENZY = 47;

/** Every Basic Energy line this deck carries — the hand is DRAWN rather than
    placed, so a board that means "no {G} in hand" has to say which cards to send
    back, and a board that means "exactly two {P}" has to clear the draw first. */
const ENERGY_LINES = ["fix-energy", "fix-psychic-energy", "fix-grass-energy"] as const;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HAND_ATTACH_DECK, p2: HAND_ATTACH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function ready(
  seed: number,
  {
    bench = ["fix-basic-1", "fix-basic-1"],
    hand = {},
  }: { bench?: readonly string[]; hand?: Partial<Record<string, number>> },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of ENERGY_LINES) state = handToDeck(state, "p1", id);
  for (const [id, count] of Object.entries(hand)) {
    state = handFromDeck(state, "p1", id, count ?? 0);
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

/** Answer a parked `choosePokemon` with `ref`. */
function pick(state: GameState, ref: PokemonRef): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
}

describe("the anchor — four printed sentences, ONE arm, ONE word from the discard side", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 9 of the row's 16 legal printings, across 4 of its 8 sentences", () => {
    expect(CLAUSES).toHaveLength(5);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(10);
    expect(deriveAttackEffect(GATED_ELSEWHERE)).not.toBeNull();
    expect(deriveAttackEffect(UNBOUNDED_ELSEWHERE.text)).not.toBeNull();
    expect(UNREAD).toHaveLength(1);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(1);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    for (const [text] of UNREAD) {
      expect(deriveAttackDiscardScaledBoost(text), text).toEqual({
        kind: "selfHandAttach",
        per: 30,
        energyType: "Water",
      });
    }
    expect(
      CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) +
        1 +
        UNBOUNDED_ELSEWHERE.legalPrintings +
        1,
    ).toBe(16);
    expect(CLAUSES.length + 1 + 1 + UNREAD.length).toBe(8);
  });

  it("the MIRROR bought 9 of 16 where the discard side bought 12 of 17 — the finding", () => {
    const leadingOrUnbounded = UNREAD.filter(
      ([text]) => !text.startsWith("Attach ") || text.includes("any number"),
    );
    expect(leadingOrUnbounded).toEqual(UNREAD);
    expect(leadingOrUnbounded.reduce((sum, [, legal]) => sum + legal, 0)).toBe(1);
    // …and both survivors really do spell it, so the filter above is not passing
    // by accident on a predicate that no longer discriminates.
    for (const [text] of UNREAD) expect(text).toContain("any number");
  });

  it("reads 15 of the family's 24 CATALOG printings — an arm transfers across sets", () => {
    expect(CLAUSES.reduce((sum, c) => sum + c.printings, 0)).toBe(10);
    expect(
      deriveAttackEffect("Attach a Basic {F} Energy card from your hand to 1 of your Pokémon."),
    ).toEqual([{ op: "attachEnergyFrom", source: "hand", energyType: "Fighting" }]);
    expect(
      deriveAttackEffect(
        "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon.",
      ),
    ).toEqual([{ op: "attachEnergyFrom", source: "hand", energyType: "Grass", benchOnly: true }]);
    expect(
      deriveAttackEffect("Attach an Energy card from your hand to 1 of your Pokémon."),
    ).toEqual([{ op: "attachEnergyFrom", source: "hand", anyEnergy: true }]);
    expect(10 + 3 + 1 + 1).toBe(15);
  });

  it("the SOURCE side is one word from row 9, and this anchor does not touch it", () => {
    expect(deriveAttackEffect(DISCARD_SIDE_NEAR_MISS)).toEqual([
      { op: "attachEnergyFrom", source: "discard" },
    ]);
    expect(deriveAttackEffect(CLAUSES[LUCKY_TEXT].text)).toEqual([
      { op: "attachEnergyFrom", source: "hand" },
    ]);
    // The two differ in exactly ONE key, which is the whole claim the shared
    // factory makes structural.
    const [hand] = deriveAttackEffect(CLAUSES[LUCKY_TEXT].text) ?? [];
    const [discard] = deriveAttackEffect(DISCARD_SIDE_NEAR_MISS) ?? [];
    expect({ ...hand, source: "discard" }).toEqual(discard);
  });

  it("D235's DESTINATION TABLE ports VERBATIM — the control, graded", () => {
    for (const [phrase, riders] of [
      ["this Pokémon", { toSelf: true }],
      ["1 of your Pokémon", {}],
      ["1 of your Benched Pokémon", { benchOnly: true }],
      ["1 of your {P} Pokémon", { targetType: "Psychic" }],
    ] as const) {
      expect(
        deriveAttackEffect(`Attach a Basic Energy card from your hand to ${phrase}.`),
        phrase,
      ).toEqual([{ op: "attachEnergyFrom", source: "hand", ...riders }]);
    }
    expect(
      deriveAttackEffect("Attach up to 2 Basic Energy cards from your hand to 1 of your Pokémon."),
    ).toEqual([{ op: "attachEnergyFrom", source: "hand", count: 2 }]);
    expect(CLAUSES.some((c) => c.text.includes("up to") && c.text.includes("to 1 of your"))).toBe(
      false,
    );
  });

  it("refuses the anchor, grammar, punctuation and case rewrites", () => {
    const bare = CLAUSES[LUCKY_TEXT].text;
    const rewrites = [
      // A leading clause — and THE POOL HAS TWO REAL ONES (`UNREAD[2]`/`UNREAD[3]`).
      `Draw a card. ${bare}`,
      `${bare} Draw a card.`,
      `${CLAUSES[LEAFLET_TEXT].text} Draw a card.`,
      // Case, both ends.
      bare.replace("Attach", "attach"),
      bare.replace("Pokémon.", "pokémon."),
      // The trailing period.
      bare.slice(0, -1),
      "Attach a Basic Energy cards from your hand to 1 of your Pokémon.",
      "Attach up to 2 Basic Energy card from your hand to 1 of your Pokémon.",
      // A printed 0 would derive to a program that moves nothing.
      "Attach up to 0 Basic Energy cards from your hand to 1 of your Pokémon.",
      // …and past the ingested-text ceiling, load-bearing on the spread branch.
      "Attach up to 11 Basic Energy cards from your hand to your Pokémon in any way you like.",
      // A destination the table does not name.
      "Attach a Basic Energy card from your hand to your opponent's Active Pokémon.",
      // A brace code the ENERGY map refuses ({C} is the provision fallback).
      "Attach a Basic {C} Energy card from your hand to this Pokémon.",
      "Attach up to 2 Basic {G} Energy cards from your hand to your Pokémon in any way you like. If you do, heal all damage from that Pokémon.",
      "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal 60 damage from this Pokémon.",
      // …and the crossed article, which the noun weld refuses at the other end.
      "Attach an Basic Energy card from your hand to this Pokémon.",
      "Attach a Energy card from your hand to this Pokémon.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("D246 — the two axes the tail gained, each driven in BOTH directions", () => {
    expect(
      deriveAttackEffect(
        "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal 60 damage from that Pokémon.",
      ),
    ).toEqual([
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Grass",
        benchOnly: true,
        healTarget: 60,
      },
    ]);
    // …and the ABSENT number is the printed "all", the same "the absent form is
    // the printed one" reading `count` takes at the other end of the sentence.
    expect(deriveAttackEffect(CLAUSES[LEAFLET_TEXT].text)).toEqual(CLAUSES[LEAFLET_TEXT].program);
    expect(
      deriveAttackEffect(
        "Attach a Basic {G} Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.",
      ),
    ).toEqual([
      { op: "attachEnergyFrom", source: "hand", energyType: "Grass", toSelf: true, healTarget: 60 },
    ]);
    expect(
      deriveAttackEffect(
        "Attach a Basic {G} Energy card from your hand to this Pokémon. If you do, heal 60 damage from that Pokémon.",
      ),
    ).toEqual([
      { op: "attachEnergyFrom", source: "hand", energyType: "Grass", toSelf: true, healTarget: 60 },
    ]);
    expect(CLAUSES.filter((c) => c.text.includes("If you do, heal"))).toHaveLength(2);
    expect(
      CLAUSES.filter((c) => c.text.includes("If you do, heal")).reduce(
        (sum, c) => sum + c.legalPrintings,
        0,
      ),
    ).toBe(4);
  });

  it("carries TWO new op fields across two slices, and no new OP", () => {
    const known = new Set([
      "op",
      "source",
      "energyType",
      "count",
      "targetType",
      "benchOnly",
      "toSelf",
      "healTarget",
      "anyEnergy",
      "declinable",
    ]);
    for (const { program } of CLAUSES) {
      for (const op of program) {
        expect(op.op).toBe("attachEnergyFrom");
        for (const key of Object.keys(op)) expect(known, `${key}`).toContain(key);
      }
    }
    const withHeal = CLAUSES.filter(({ program }) =>
      program.some((op) => Object.hasOwn(op, "healTarget")),
    );
    expect(withHeal).toHaveLength(2);
    expect(withHeal.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(4);
    const healAmounts = CLAUSES.flatMap(({ program }) =>
      program.flatMap((op) =>
        op.op === "attachEnergyFrom" && op.healTarget !== undefined ? [op.healTarget] : [],
      ),
    );
    expect(new Set(healAmounts)).toEqual(new Set(["all", 60]));
    // …and exactly ONE sentence pays for `anyEnergy` in the LEGAL pool, which is
    // the whole reason it is a boolean on the op rather than a `CardFilter`.
    const withAnyEnergy = CLAUSES.filter(({ program }) =>
      program.some((op) => Object.hasOwn(op, "anyEnergy")),
    );
    expect(withAnyEnergy).toHaveLength(1);
    expect(withAnyEnergy[0]?.legalPrintings).toBe(1);
  });
});

describe("PROVENANCE — the demonstrator carries five of the sentences at 43-47", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 43-47, appended and not inserted", () => {
    expect(attacks()).toHaveLength(73);
    expect(attacks()[WRAPPED_IN_WIND]?.effect).toBe(CLAUSES[WRAPPED_TEXT].text);
    expect(attacks()[LUCKY_ATTACHMENT]?.effect).toBe(CLAUSES[LUCKY_TEXT].text);
    expect(attacks()[FULL_HEART]?.effect).toBe(CLAUSES[FULL_HEART_TEXT].text);
    expect(attacks()[LEAFLET_BLESSINGS]?.effect).toBe(CLAUSES[LEAFLET_TEXT].text);
    expect(attacks()[TROPICAL_FRENZY]?.effect).toBe(UNBOUNDED_ELSEWHERE.text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[29]?.effect).toBe(
      "Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon.",
    );
    expect(attacks()[42]?.effect).toBe(
      "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
    );
  });

  it("NO printed base damage on any of the five — and on ONE that is a divergence", () => {
    for (const index of [
      WRAPPED_IN_WIND,
      LUCKY_ATTACHMENT,
      FULL_HEART,
      LEAFLET_BLESSINGS,
      TROPICAL_FRENZY,
    ]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("the demonstrator's own attack rows still DERIVE to this slice's programs", () => {
    expect(deriveAttackEffect(attacks()[LEAFLET_BLESSINGS]?.effect ?? "")).toEqual(
      CLAUSES[LEAFLET_TEXT].program,
    );
    expect(deriveAttackEffect(attacks()[TROPICAL_FRENZY]?.effect ?? "")).toEqual([
      { op: "attachFromHand", filter: { kind: "basicEnergy" } },
    ]);
  });
});

describe("end to end — an ATTACK pulling Energy out of the HAND", () => {
  it("the SELF target forces: no park, and the Energy lands on the attacker", () => {
    const state = ready(3, { hand: { "fix-energy": 2 } });
    const attacker = activeUid(state, "p1");
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: WRAPPED_IN_WIND,
    });

    expect(done.phase.kind).not.toBe("effect:choose");
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(1);
    expect(attached[0]?.target).toEqual({ spot: "active" });
    expect(done.players.p1.active?.energy).toHaveLength(2); // the {C} cost + one more
    expect(done.players.p1.hand).toHaveLength(handBefore - 1);
    expect(activeUid(done, "p1")).toBe(attacker);
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
  });

  it("the UN-NARROWED destination offers every own body — the row with 0 legal at D234", () => {
    const state = ready(5, { hand: { "fix-energy": 2 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LUCKY_ATTACHMENT,
    });

    const targets = parkedTargets(parked);
    expect(targets).toHaveLength(3);
    expect(targets).toContainEqual(ACTIVE_REF);
    for (const ref of targets) expect(ref.seat).toBe("p1");

    const { state: done, events } = pick(parked, benchRef(1));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(0);
  });

  it("'in any way you like' asks TWICE, and the two may land APART", () => {
    const state = ready(7, { hand: { "fix-psychic-energy": 2, "fix-energy": 2 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: FULL_HEART });
    expect(parkedTargets(parked)).toHaveLength(3);

    const first = pick(parked, benchRef(0));
    expect(first.state.phase.kind).toBe("effect:choose");
    expect(all(first.events, "ENERGY_ATTACHED")).toHaveLength(1);
    const second = pick(first.state, benchRef(1));
    expect(second.state.phase.kind).not.toBe("effect:choose");
    expect(all(second.events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(second.state.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(second.state.players.p1.bench[1]?.energy).toHaveLength(1);
    const moved = [
      ...all(first.events, "ENERGY_ATTACHED"),
      ...all(second.events, "ENERGY_ATTACHED"),
    ];
    for (const e of moved) expect(second.state.cardIdByUid[e.uid]).toBe("fix-psychic-energy");
  });

  it("the HEAL lands on the body that was just fed, with NO second question", () => {
    let state = ready(9, {
      bench: ["fix-basic-1", "fix-basic-1"],
      hand: { "fix-grass-energy": 2 },
    });
    state = setBenchDamage(state, "p1", 0, 50);
    state = setBenchDamage(state, "p1", 1, 30);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LEAFLET_BLESSINGS,
    });
    // `benchOnly`: the attacker is not offered even though it is in play.
    const targets = parkedTargets(parked);
    expect(targets).toHaveLength(2);
    expect(targets).not.toContainEqual(ACTIVE_REF);

    const { state: done, events } = pick(parked, benchRef(0));
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    const healed = all(events, "HEALED");
    expect(healed).toHaveLength(1);
    expect(healed[0]?.amount).toBe(50);
    expect(healed[0]?.seat).toBe("p1");
    // "all" means all: the chosen body is clean, and the OTHER damaged body — the
    // one a second prompt would have let the player pick — is untouched.
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p1.bench[1]?.damage).toBe(30);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
  });

  it("'If you do' is the WHIFF path, not a gate: no Energy, no heal", () => {
    let state = ready(11, { hand: { "fix-energy": 2 } });
    state = setBenchDamage(state, "p1", 0, 50);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LEAFLET_BLESSINGS,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(50);
  });

  it("a sentence with NO heal tail heals NOTHING, on a board that is DAMAGED", () => {
    let state = ready(27, { hand: { "fix-energy": 2 } });
    state = setBenchDamage(state, "p1", 0, 50);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LUCKY_ATTACHMENT,
    });
    const { state: done, events } = pick(parked, benchRef(0));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(50);
    // …and the field really is absent from the program, not merely unset on this
    // board (the by-value comparison the registry rows depend on).
    expect(CLAUSES[LUCKY_TEXT].program[0]).not.toHaveProperty("healTarget");
  });

  it("an UNDAMAGED body heals 0 and emits NOTHING — `healChosen`'s silence, inherited", () => {
    const state = ready(13, { hand: { "fix-grass-energy": 2 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LEAFLET_BLESSINGS,
    });
    const { state: done, events } = pick(parked, benchRef(0));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
  });

  it("the once-UNREAD sentence now PARKS, and it parks on a prompt this anchor never produces", () => {
    const state = ready(15, { hand: { "fix-energy": 3, "fix-grass-energy": 2 } });
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: parked, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TROPICAL_FRENZY,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    // Nothing has moved YET — the decision is still open, so the hand is intact
    // and the assertion the old case made about the board still holds at the park.
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(parked.players.p1.hand).toHaveLength(handBefore);
    expect(parked.players.p1.bench.every((p) => p.energy.length === 0)).toBe(true);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.prompt.kind).toBe("attachCards");
    // …and the anchor this FILE owns parks on the other kind, one index over, on
    // the same body and the same board. The pair is the separation.
    const { state: other } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LUCKY_ATTACHMENT,
    });
    if (other.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(other.phase.prompt.kind).toBe("choosePokemon");
  });

  it("the attach is the ATTACKER's own board, on both ends", () => {
    // The one-`otherSeat`-apart pairing every op in this family owes: a build that
    // read the opponent's hand, or benched the Energy on their side, would pass
    // every count assertion above.
    const state = ready(17, { hand: { "fix-energy": 2 } });
    const ownHand = new Set(state.players.p1.hand);
    const opponentHand = new Set(state.players.p2.hand);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LUCKY_ATTACHMENT,
    });
    for (const ref of parkedTargets(parked)) expect(ref.seat).toBe("p1");
    const { state: done, events } = pick(parked, benchRef(0));
    for (const uid of opponentHand) expect(done.players.p2.hand).toContain(uid);
    // The card that moved came out of the ATTACKER's hand.
    const [attached] = all(events, "ENERGY_ATTACHED");
    expect(ownHand.has(attached?.uid ?? "")).toBe(true);
    expect(done.players.p1.hand).not.toContain(attached?.uid);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE READ SITES — priced by grep, driven both directions
// ─────────────────────────────────────────────────────────────────────────────

describe("the read sites this slice collides with", () => {
  it("`programPlayable` prices at ZERO for an ATTACK — but NOT because the gate is blind", () => {
    const empty = ready(23, {});
    expect(programPlayable(empty, CLAUSES[WRAPPED_TEXT].program, "p1")).toBe(false);
    const stocked = ready(23, { hand: { "fix-energy": 1 } });
    expect(programPlayable(stocked, CLAUSES[WRAPPED_TEXT].program, "p1")).toBe(true);
    // …and the attack path ignores the gate entirely: same empty hand, and the
    // attack still declares.
    deepFreeze(empty);
    const { events } = mustApply(empty, { type: "attack", seat: "p1", index: WRAPPED_IN_WIND });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
  });

  it("`MATCH_RECORD_VERSION` STAYS 12 — the derivation, not the habit", () => {
    const program = CLAUSES[LEAFLET_TEXT].program;
    expect(program).toHaveLength(1);
    for (const op of program) expect(op.op).toBe("attachEnergyFrom");
    // No new op inhabitant, and no second parking op anywhere in the family.
    for (const { program: p } of CLAUSES) {
      for (const op of p) expect(op.op).toBe("attachEnergyFrom");
    }
  });

  it("the gate reads the SOURCE ZONE, so a stocked DISCARD does not unblock a hand attach", () => {
    const state = ready(21, {});
    expect(programPlayable(state, CLAUSES[WRAPPED_TEXT].program, "p1")).toBe(false);
    expect(
      programPlayable(state, [{ op: "attachEnergyFrom", source: "discard" }] as EffectOp[], "p1"),
    ).toBe(false);
  });
});
