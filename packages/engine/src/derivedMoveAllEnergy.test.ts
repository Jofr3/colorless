import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, EffectPrompt, GameEvent, GameState, PokemonRef } from "./index";
import { redactGame } from "./index";
import {
  CLEAR_STATUS_DECK,
  FIXTURE_POOL,
  SELF_ENERGY_MOVE_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  roundTrip,
} from "./testFixtures";

const SENTENCE = "Move all Energy from this Pokémon to 1 of your Benched Pokémon.";
const DECLINABLE_SIBLING = "Move an Energy from this Pokémon to 1 of your Benched Pokémon.";

const HAPPY_CYCLONE = 0; // sv01-145 Blissey, its printed index
const VOLT_CYCLONE = 14;
const SEED = 0x2f11;

function board({
  basics = 3,
  ownBench = 2,
}: { basics?: number; ownBench?: number } = {}): GameState {
  let state = mustApply(
    driveSetup(SEED, { p1: CLEAR_STATUS_DECK, p2: CLEAR_STATUS_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  state = setActiveFromDeck(state, "p1", "sv01-145");
  if (basics > 0) state = attachFromDeck(state, "p1", "fix-energy", basics);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  return state;
}

function swing(state: GameState) {
  return mustApply(state, { type: "attack", seat: "p1", index: HAPPY_CYCLONE });
}

/** The parked moveEnergy prompt, narrowed — and it THROWS rather than returning
    undefined when nothing parked, so a forced build cannot read as an empty one. */
function parked(state: GameState): Extract<EffectPrompt, { kind: "moveEnergy" }> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  return prompt;
}

function events<T extends GameEvent["type"]>(all: GameEvent[], type: T) {
  return all.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

describe("§1 — the deriver: one anchor, and the edges it must not reach", () => {
  it("derives to the shipped route with the THIRD quantifier", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" },
    ]);
  });

  it("the DECLINABLE sibling is untouched — one determiner, two quantifiers", () => {
    const all = deriveAttackEffect(SENTENCE) as EffectOp[];
    const one = deriveAttackEffect(DECLINABLE_SIBLING) as EffectOp[];
    expect(one).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" },
    ]);
    expect({ ...(all[0] as object), max: undefined }).toEqual({
      ...(one[0] as object),
      max: undefined,
    });
  });

  it("D442 — THIS ANCHOR STILL DOES NOT REACH the multi-destination sibling", () => {
    expect(
      deriveAttackEffect(
        "Move all Energy from this Pokémon to your Benched Pokémon in any way you like.",
      ),
    ).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: "all",
        route: "selfToBench",
        anyDest: true,
      },
    ]);
    const mine = deriveAttackEffect(SENTENCE) as EffectOp[];
    expect(Object.hasOwn(mine[0] as object, "anyDest")).toBe(false);
    expect(SENTENCE.startsWith("Move all Energy from this Pokémon to ")).toBe(true);
    expect(SENTENCE.endsWith("1 of your Benched Pokémon.")).toBe(true);
  });

  it("REFUSES a TRAILING CLAUSE — the `$` witness, CONSTRUCTED and labelled so", () => {
    expect(
      deriveAttackEffect(
        "Move all Energy from this Pokémon to 1 of your Benched Pokémon. Then, shuffle your deck.",
      ),
    ).toBeNull();
    // …and the un-tailed string it is one clause away from still derives, so the
    // rung above is about the TERMINATOR and not about the sentence.
    expect(deriveAttackEffect(SENTENCE)).not.toBeNull();
  });

  it("REFUSES the TYPED near miss, which the new anchor did not re-open", () => {
    expect(
      deriveAttackEffect("Move all {D} Energy from this Pokémon to 1 of your Benched Pokémon."),
    ).toBeNull();
    expect(
      deriveAttackEffect("Move 2 {D} Energy from this Pokémon to 1 of your Benched Pokémon."),
    ).toBeNull();
  });
});

describe("§2 — the PARK: the floor crosses, and the decline stops being an answer", () => {
  it("parks with min === max === the whole movable set", () => {
    const state = board({ basics: 3, ownBench: 2 });
    const prompt = parked(swing(state).state);
    expect(prompt.movable).toHaveLength(3);
    expect(prompt.max).toBe(3);
    expect(prompt.min).toBe(3);
    expect(prompt.min).toBe(prompt.max);
    // The endpoints are still `selfToBench`'s, unchanged by the quantifier.
    expect(prompt.destinations).toHaveLength(2);
    expect(prompt.destinations.every((d) => d.seat === "p1" && d.spot.spot === "bench")).toBe(true);
  });

  it("the NOTE is the card's own sentence — no invented number", () => {
    expect(parked(swing(board({ basics: 3 })).state).note).toBe(SENTENCE);
    expect(parked(swing(board({ basics: 5 })).state).note).toBe(SENTENCE);
  });

  it("REFUSES the empty answer the family has accepted since M4", () => {
    const state = swing(board({ basics: 3, ownBench: 2 })).state;
    const dest = parked(state).destinations[0] as PokemonRef;
    expectErr(
      state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "moveEnergy", picks: [] } },
      "BAD_EFFECT_CHOICE",
    );
    // …and a SHORT answer is refused too, which the empty one alone does not prove:
    // a build enforcing only `uids.length > 0` passes the rung above and lets the
    // player keep two of the three Energy the card gives away.
    const short = [parked(state).movable[0]?.uid as string];
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: short.map((uid) => ({ uid, dest })) },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("ACCEPTS the full answer, and it lands whole on the chosen body", () => {
    const state = swing(board({ basics: 3, ownBench: 2 })).state;
    const prompt = parked(state);
    const uids = prompt.movable.map((m) => m.uid);
    const dest = prompt.destinations[1] as PokemonRef;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: uids.map((uid) => ({ uid, dest })) },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.bench[1]?.energy).toEqual(uids);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
    const rows = events(done.events, "ENERGY_MOVED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seat: "p1",
      uids,
      from: { spot: "active" },
      to: { spot: "bench", index: 1 },
    });
    // The seat control — the opponent's BOARD is untouched. (Their deck and hand
    // move because resolving this park ends the turn, which is not this op.)
    expect(done.state.players.p2.active).toEqual(state.players.p2.active);
    expect(done.state.players.p2.bench).toEqual(state.players.p2.bench);
  });

  it("THE DECLINABLE CONTROL: a park with no floor carries NO `min` KEY AT ALL", () => {
    const mandatory = parked(swing(board({ basics: 3, ownBench: 2 })).state);
    const declinable = parked(swingSibling());
    expect(Object.keys(declinable).sort()).toEqual([
      "destinations",
      "kind",
      "max",
      "movable",
      "note",
    ]);
    expect("min" in declinable).toBe(false);
    // …and the MANDATORY park carries exactly one more key, which is the diff.
    expect(Object.keys(mandatory).sort()).toEqual([
      "destinations",
      "kind",
      "max",
      "min",
      "movable",
      "note",
    ]);
    const sibling = swingSiblingState();
    const declined = mustApply(sibling, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    expect(events(declined.events, "ENERGY_MOVED")).toHaveLength(0);
  });
});

function swingSiblingState({ ownBench = 2 }: { ownBench?: number } = {}): GameState {
  let state = mustApply(
    driveSetup(SEED, { p1: SELF_ENERGY_MOVE_DECK, p2: SELF_ENERGY_MOVE_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  state = setActiveFromDeck(state, "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return mustApply(state, { type: "attack", seat: "p1", index: VOLT_CYCLONE }).state;
}

function swingSibling(): GameState {
  return swingSiblingState();
}

describe("§3 — the FORCED arm: one destination, one legal answer, no dialog", () => {
  it("does NOT park on a one-body Bench — it applies inline", () => {
    const state = board({ basics: 3, ownBench: 1 });
    const done = swing(state);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.bench[0]?.energy).toHaveLength(3);
    const rows = events(done.events, "ENERGY_MOVED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seat: "p1",
      from: { spot: "active" },
      to: { spot: "bench", index: 0 },
    });
  });

  it("and a ONE-DESTINATION board PARKS for the declinable sibling — the control", () => {
    expect(swing(board({ basics: 3, ownBench: 1 })).state.phase.kind).not.toBe("effect:choose");
    const sibling = swingSiblingState({ ownBench: 1 });
    expect(sibling.phase.kind).toBe("effect:choose");
    const prompt = parked(sibling);
    expect(prompt.destinations).toHaveLength(1);
    expect("min" in prompt).toBe(false);
  });

  it("an EMPTY Bench is a silent no-op, and the Energy stays put", () => {
    // The 0-candidate arm, unchanged by the floor: `destinations.length < needed`
    // returns before either quantifier is consulted, so nothing parks and nothing
    // moves. Asserted because the forced arm above sits one `length` apart from it.
    const state = board({ basics: 3, ownBench: 0 });
    const done = swing(state);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.active?.energy).toHaveLength(3);
  });
});

describe("§4 — the wire: the floor crosses, and its absence crosses too", () => {
  it("the redacted prompt carries `min`, and a declinable one carries no key", () => {
    const state = swing(board({ basics: 3, ownBench: 2 })).state;
    const snapshot = redactGame(state, "p1");
    const wire = snapshot.phase.kind === "effect:choose" ? snapshot.phase.prompt : null;
    if (wire === null || wire.kind !== "moveEnergy")
      throw new Error("expected a wire moveEnergy prompt");
    expect(wire.min).toBe(3);
    expect(wire.max).toBe(3);
    expect(Object.keys(wire).sort()).toEqual([
      "destinations",
      "kind",
      "max",
      "min",
      "movable",
      "note",
    ]);
  });

  it("the fixture printing is `legal_standard = 0`, so NO census figure moves for it", () => {
    expect(FIXTURE_POOL["sv01-145"]?.name).toBe("Blissey");
    expect(FIXTURE_POOL["sv01-145"]?.attacks?.[HAPPY_CYCLONE]?.effect).toBe(SENTENCE);
  });
});

describe("§5 — the persisted shape: a v29 record still means what it meant", () => {
  it("`MATCH_RECORD_VERSION` STAYS 29 — DRIVEN OVER THE BYTES, both directions", () => {
    const live = swing(board({ basics: 3, ownBench: 2 })).state;
    expect(parked(live).min).toBe(3);

    const v29: GameState = roundTrip(live);
    if (v29.phase.kind !== "effect:choose" || v29.phase.prompt.kind !== "moveEnergy") {
      throw new Error("expected a serialized moveEnergy park");
    }
    const { min: _dropped, ...withoutFloor } = v29.phase.prompt;
    const resumed: GameState = { ...v29, phase: { ...v29.phase, prompt: withoutFloor } };
    const declined = mustApply(resumed, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    // The v29 park is answerable exactly as it was: the decline goes through and
    // nothing moves. A build reading the missing key as MANDATORY would refuse a
    // player the right their record was written under, which IS the bump condition.
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    expect(events(declined.events, "ENERGY_MOVED")).toHaveLength(0);

    // (b) THE OTHER DIRECTION: the same board WITH the floor still refuses it, so
    // rung (a) is not passing because the engine accepts every empty answer.
    expectErr(
      live,
      { type: "resolveEffect", seat: "p1", choice: { kind: "moveEnergy", picks: [] } },
      "BAD_EFFECT_CHOICE",
    );

    const bytes = JSON.stringify(v29.phase.cont.pendingOp);
    expect(bytes).toContain('"max":"all"');
    expect(JSON.parse(bytes)).toEqual({
      op: "moveEnergy",
      filter: { kind: "anyEnergy" },
      max: "all",
      route: "selfToBench",
    });
  });
});
