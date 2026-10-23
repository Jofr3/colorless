import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, EffectPrompt, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction, redactGame } from "./index";
import {
  SPREAD_ENERGY_MOVE_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const SPREAD_ALL = "Move all Energy from this Pokémon to your Benched Pokémon in any way you like.";
const SPREAD_ANY =
  "You may move any amount of Energy from your Pokémon to your other Pokémon in any way you like.";
const SPREAD_TYPED =
  "You may move any amount of {M} Energy from your Pokémon to your other Pokémon in any way you like.";
const COUPLED_SIBLING = "Move all Energy from this Pokémon to 1 of your Benched Pokémon.";

const SPREAD_CYCLONE = 63; // fix-trainerops — SPREAD_ALL
const FREE_FLOW = 64; // fix-trainerops — SPREAD_ANY
const METAL_FLOW = 65; // fix-trainerops — SPREAD_TYPED
const SEED = 0x5c21;

function board({
  basics = 2,
  metals = 0,
  ownBench = 2,
  benchEnergy = 0,
}: { basics?: number; metals?: number; ownBench?: number; benchEnergy?: number } = {}): GameState {
  let state = mustApply(
    driveSetup(SEED, { p1: SPREAD_ENERGY_MOVE_DECK, p2: SPREAD_ENERGY_MOVE_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  state = setActiveFromDeck(state, "p1", "fix-trainerops");
  if (basics > 0) state = attachFromDeck(state, "p1", "fix-energy", basics);
  if (metals > 0) state = attachFromDeck(state, "p1", "fix-metal-energy", metals);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  if (benchEnergy > 0) state = attachBenchFromDeck(state, "p1", 0, "fix-energy", benchEnergy);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
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

/** The board's refs, spelled once. */
const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const p1Bench = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

describe("§1 — the deriver: two anchors, three sentences, and the edges they must not reach", () => {
  it("derives all three to the shipped routes with the destination rider", () => {
    expect(deriveAttackEffect(SPREAD_ALL)).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: "all",
        route: "selfToBench",
        anyDest: true,
      },
    ]);
    expect(deriveAttackEffect(SPREAD_ANY)).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: "any",
        anySource: true,
        anyDest: true,
      },
    ]);
    expect(deriveAttackEffect(SPREAD_TYPED)).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "providesEnergy", energyType: "Metal" },
        max: "any",
        anySource: true,
        anyDest: true,
      },
    ]);
  });

  it("the COUPLED sibling still derives WITHOUT the rider — the one-axis control", () => {
    const coupled = deriveAttackEffect(COUPLED_SIBLING) as EffectOp[];
    const spread = deriveAttackEffect(SPREAD_ALL) as EffectOp[];
    expect(coupled).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" },
    ]);
    expect(Object.hasOwn(coupled[0] as object, "anyDest")).toBe(false);
    expect({ ...(spread[0] as object), anyDest: undefined }).toEqual({
      ...(coupled[0] as object),
      anyDest: undefined,
    });
  });

  it("the TYPED and UNTYPED spreads differ in their FILTER and in nothing else", () => {
    const untyped = deriveAttackEffect(SPREAD_ANY) as EffectOp[];
    const typed = deriveAttackEffect(SPREAD_TYPED) as EffectOp[];
    expect({ ...(untyped[0] as object), filter: undefined }).toEqual({
      ...(typed[0] as object),
      filter: undefined,
    });
    expect((typed[0] as { filter: unknown }).filter).toEqual({
      kind: "providesEnergy",
      energyType: "Metal",
    });
  });

  it("every code in the notation map derives, and {C}/{N} are refused", () => {
    const typed = (code: string) =>
      deriveAttackEffect(
        `You may move any amount of {${code}} Energy from your Pokémon to your other Pokémon in any way you like.`,
      );
    for (const [code, type] of Object.entries({
      G: "Grass",
      R: "Fire",
      W: "Water",
      L: "Lightning",
      P: "Psychic",
      F: "Fighting",
      D: "Darkness",
      M: "Metal",
      Y: "Fairy",
    })) {
      expect(typed(code), code).toEqual([
        {
          op: "moveEnergy",
          filter: { kind: "providesEnergy", energyType: type },
          max: "any",
          anySource: true,
          anyDest: true,
        },
      ]);
    }
    expect(typed("C")).toBeNull();
    expect(typed("N")).toBeNull();
  });

  it("REFUSES the near-misses — a TRAILING clause, a swapped endpoint, a lost 'other'", () => {
    expect(deriveAttackEffect(`${SPREAD_ALL} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackEffect(`${SPREAD_ANY} Then, shuffle your deck.`)).toBeNull();
    expect(
      deriveAttackEffect(
        "You may move any amount of Energy from your opponent's Pokémon to their other Pokémon in any way you like.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "You may move any amount of Energy from your Pokémon to your Pokémon in any way you like.",
      ),
    ).toBeNull();
    expect(deriveAttackEffect(SPREAD_ALL)).not.toBeNull();
    expect(deriveAttackEffect(SPREAD_ANY)).not.toBeNull();
  });
});

describe("§2 — the prompt: the rider crosses, and its absence crosses too", () => {
  it("the spread park carries `anyDest`; the coupled park carries no such key", () => {
    const spread = parked(swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state);
    expect(spread.anyDest).toBe(true);
    expect(spread.min).toBe(2);
    expect(spread.max).toBe(2);
    expect(spread.destinations).toHaveLength(2);
    expect(Object.keys(spread).sort()).toEqual([
      "anyDest",
      "destinations",
      "kind",
      "max",
      "min",
      "movable",
      "note",
    ]);
    const coupled = parked(swing(board({ basics: 2, ownBench: 2 }), 14).state);
    expect("anyDest" in coupled).toBe(false);
  });

  it("the FREE-route spread carries BOTH riders, and offers every own body at both ends", () => {
    const prompt = parked(
      swing(board({ basics: 2, ownBench: 2, benchEnergy: 1 }), FREE_FLOW).state,
    );
    expect(prompt.anySource).toBe(true);
    expect(prompt.anyDest).toBe(true);
    expect(prompt.destinations).toHaveLength(3); // Active + two benched
    expect(new Set(prompt.movable.map((m) => m.from.spot.spot))).toEqual(
      new Set(["active", "bench"]),
    );
    // DECLINABLE — the printed "You may … any amount", so no floor at all.
    expect("min" in prompt).toBe(false);
  });

  it("the note is the printed sentence, on all three", () => {
    expect(parked(swing(board(), SPREAD_CYCLONE).state).note).toBe(SPREAD_ALL);
    expect(parked(swing(board({ benchEnergy: 1 }), FREE_FLOW).state).note).toBe(
      SPREAD_ANY.replace("You may move", "Move"),
    );
    expect(parked(swing(board({ metals: 2, benchEnergy: 1 }), METAL_FLOW).state).note).toBe(
      "Move any amount of Metal Energy from your Pokémon to your other Pokémon in any way you like.",
    );
    // …and the COUPLED sibling's note keeps its "1 of", which is the coupling
    // spelled: one rider, one clause.
    expect(parked(swing(board({ basics: 2, ownBench: 2 }), 14).state).note).toBe(
      "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
    );
  });
});

describe("§3 — the answer: one map, several destinations", () => {
  it("TWO PICKS LAND ON TWO DIFFERENT BENCHED BODIES", () => {
    const state = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const prompt = parked(state);
    const [first, second] = prompt.movable.map((m) => m.uid) as [string, string];
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: first, dest: p1Bench(0) },
          { uid: second, dest: p1Bench(1) },
        ],
      },
    });
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([first]);
    expect(done.state.players.p1.bench[1]?.energy).toEqual([second]);
    const moved = events(done.events, "ENERGY_MOVED");
    expect(moved).toHaveLength(2);
    expect(moved.map((e) => e.to)).toEqual([
      { spot: "bench", index: 0 },
      { spot: "bench", index: 1 },
    ]);
    expect(moved.every((e) => e.from.spot === "active")).toBe(true);
  });

  it("a spread whose entries AGREE emits exactly the ONE row the coupled answer did", () => {
    const state = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const uids = parked(state).movable.map((m) => m.uid);
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: uids.map((uid) => ({ uid, dest: p1Bench(1) })),
      },
    });
    const moved = events(done.events, "ENERGY_MOVED");
    expect(moved).toHaveLength(1);
    expect(moved[0]?.uids).toEqual(uids);
    expect(done.state.players.p1.bench[1]?.energy).toEqual(uids);
  });

  it("the FREE route spreads ACROSS sources as well as across destinations", () => {
    const state = swing(board({ basics: 1, ownBench: 2, benchEnergy: 1 }), FREE_FLOW).state;
    const prompt = parked(state);
    const fromActive = prompt.movable.find((m) => m.from.spot.spot === "active") as {
      uid: string;
    };
    const fromBench = prompt.movable.find((m) => m.from.spot.spot === "bench") as { uid: string };
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: fromActive.uid, dest: p1Bench(1) },
          { uid: fromBench.uid, dest: P1_ACTIVE },
        ],
      },
    });
    expect(done.state.players.p1.bench[1]?.energy).toEqual([fromActive.uid]);
    expect(done.state.players.p1.active?.energy).toEqual([fromBench.uid]);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(2);
  });

  it("the printed decline names NOBODY, and it is still a decline", () => {
    const state = swing(board({ basics: 2, ownBench: 2, benchEnergy: 1 }), FREE_FLOW).state;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(0);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
  });
});

describe("§4 — validateChoice: the coupling is now ASSERTED where it used to be a SHAPE", () => {
  it("a COUPLED prompt REFUSES a two-destination answer", () => {
    const state = swing(board({ basics: 2, ownBench: 2 }), 15).state; // Jet Cyclone, max 3
    const prompt = parked(state);
    expect("anyDest" in prompt).toBe(false);
    const [first, second] = prompt.movable.map((m) => m.uid) as [string, string];
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(1) },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
    expect(
      applyAction(state, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(0) },
          ],
        },
      }).ok,
    ).toBe(true);
  });

  it("the SPREAD prompt admits the very answer the coupled one refuses", () => {
    // The other half of the pair: same frame, same shape, opposite verdict, and
    // the only difference is the prompt's rider. Without this rung the refusal
    // above passes on a build that refuses every mixed-destination answer.
    const state = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const [first, second] = parked(state).movable.map((m) => m.uid) as [string, string];
    expect(
      applyAction(state, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(1) },
          ],
        },
      }).ok,
    ).toBe(true);
  });

  it("the SELF-MOVE rule is PER PICK, and a spread cannot smuggle one past it", () => {
    const state = swing(board({ basics: 1, ownBench: 2, benchEnergy: 1 }), FREE_FLOW).state;
    const prompt = parked(state);
    const benched = prompt.movable.find((m) => m.from.spot.spot === "bench") as {
      uid: string;
      from: PokemonRef;
    };
    const active = prompt.movable.find((m) => m.from.spot.spot === "active") as { uid: string };
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: active.uid, dest: p1Bench(1) },
            { uid: benched.uid, dest: benched.from }, // onto the body it sits on
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("refuses an unoffered destination, a repeated uid, and a short mandatory answer", () => {
    const state = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const [first, second] = parked(state).movable.map((m) => m.uid) as [string, string];
    const answer = (picks: { uid: string; dest: PokemonRef }[]) => ({
      type: "resolveEffect" as const,
      seat: "p1" as const,
      choice: { kind: "moveEnergy" as const, picks },
    });
    expectErr(
      state,
      answer([{ uid: first, dest: { seat: "p2", spot: { spot: "bench", index: 0 } } }]),
      "BAD_EFFECT_CHOICE",
    );
    // One physical card cannot land on two Pokémon.
    expectErr(
      state,
      answer([
        { uid: first, dest: p1Bench(0) },
        { uid: first, dest: p1Bench(1) },
      ]),
      "BAD_EFFECT_CHOICE",
    );
    expectErr(state, answer([{ uid: first, dest: p1Bench(0) }]), "BAD_EFFECT_CHOICE");
    // …and the WHOLE answer is accepted, so none of the three passes on a build
    // that refuses everything.
    expect(
      applyAction(
        state,
        answer([
          { uid: first, dest: p1Bench(0) },
          { uid: second, dest: p1Bench(1) },
        ]),
      ).ok,
    ).toBe(true);
  });
});

describe("§5 — the typed filter: provision, not print", () => {
  it("only the {M} Energy is offered, and the untyped sibling offers both", () => {
    const base = board({ basics: 1, metals: 1, ownBench: 2, benchEnergy: 0 });
    const typed = parked(swing(base, METAL_FLOW).state);
    const untyped = parked(swing(base, FREE_FLOW).state);
    expect(untyped.movable).toHaveLength(2);
    expect(typed.movable).toHaveLength(1);
    const active = base.players.p1.active as { energy: string[] };
    const metalUid = typed.movable[0]?.uid as string;
    expect(base.cardIdByUid[metalUid]).toBe("fix-metal-energy");
    expect(active.energy).toContain(metalUid);
  });

  it("with NO Metal on the board the typed printing is a silent no-op", () => {
    // `movable.length === 0` returns before either quantifier is consulted, so
    // nothing parks and nothing moves — while its untyped sibling on the same
    // board parks. The pair is what makes the filter's emptiness observable.
    const base = board({ basics: 2, metals: 0, ownBench: 2 });
    expect(swing(base, METAL_FLOW).state.phase.kind).not.toBe("effect:choose");
    expect(swing(base, FREE_FLOW).state.phase.kind).toBe("effect:choose");
  });
});

describe("§6 — the wire: the rider crosses, and its absence crosses too", () => {
  it("the redacted prompt carries `anyDest`, and a coupled one carries no key", () => {
    const spread = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    const snapshot = redactGame(spread, "p1");
    const wire = snapshot.phase.kind === "effect:choose" ? snapshot.phase.prompt : null;
    if (wire === null || wire.kind !== "moveEnergy")
      throw new Error("expected a wire moveEnergy prompt");
    expect(wire.anyDest).toBe(true);
    expect(Object.keys(wire).sort()).toEqual([
      "anyDest",
      "destinations",
      "kind",
      "max",
      "min",
      "movable",
      "note",
    ]);
    const coupledWire = redactGame(swing(board({ basics: 2, ownBench: 2 }), 14).state, "p1");
    const coupled = coupledWire.phase.kind === "effect:choose" ? coupledWire.phase.prompt : null;
    if (coupled === null || coupled.kind !== "moveEnergy")
      throw new Error("expected a wire prompt");
    expect("anyDest" in coupled).toBe(false);
  });
});

describe("§7 — the persisted shape: `MATCH_RECORD_VERSION` stays 29", () => {
  it("DRIVEN OVER THE SERIALIZED BYTES, in BOTH directions", () => {
    const live = swing(board({ basics: 2, ownBench: 2 }), SPREAD_CYCLONE).state;
    expect(parked(live).anyDest).toBe(true);

    const v29: GameState = JSON.parse(JSON.stringify(live)) as GameState;
    if (v29.phase.kind !== "effect:choose" || v29.phase.prompt.kind !== "moveEnergy") {
      throw new Error("expected a serialized moveEnergy park");
    }
    const { anyDest: _promptRider, ...coupledPrompt } = v29.phase.prompt;
    const pendingOp = v29.phase.cont.pendingOp as Record<string, unknown>;
    expect(pendingOp.op).toBe("moveEnergy");
    expect(pendingOp.anyDest).toBe(true); // it IS in the bytes — the reason this is asked
    const { anyDest: _opRider, ...coupledOp } = pendingOp;
    const resumed: GameState = {
      ...v29,
      phase: {
        ...v29.phase,
        prompt: coupledPrompt,
        cont: { ...v29.phase.cont, pendingOp: coupledOp as unknown as EffectOp },
      },
    };
    const [first, second] = coupledPrompt.movable.map((m) => m.uid) as [string, string];
    const coupledAnswer = mustApply(resumed, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: first, dest: p1Bench(0) },
          { uid: second, dest: p1Bench(0) },
        ],
      },
    });
    expect(coupledAnswer.state.players.p1.bench[0]?.energy).toEqual([first, second]);
    expectErr(
      resumed,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(1) },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );

    // (b) THE OTHER DIRECTION: the SAME board WITH the rider accepts the spread, so
    // rung (a) is not passing because the engine refuses every mixed answer.
    expect(
      applyAction(live, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: first, dest: p1Bench(0) },
            { uid: second, dest: p1Bench(1) },
          ],
        },
      }).ok,
    ).toBe(true);
  });
});

describe("§8 — the forced arm: one destination is not a spread", () => {
  it("a MANDATORY spread onto a Bench of ONE still applies inline", () => {
    const state = board({ basics: 2, ownBench: 1 });
    const done = swing(state, SPREAD_CYCLONE);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(1);
  });

  it("the DECLINABLE spread on the same one-destination board still PARKS", () => {
    const state = board({ basics: 2, ownBench: 1 });
    const parkedFree = swing(state, FREE_FLOW).state;
    expect(parkedFree.phase.kind).toBe("effect:choose");
    expect(parked(parkedFree).destinations.length).toBeGreaterThan(1);
  });
});
