import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  GATED_ATTACH_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  handToDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// ── The printed sentences, verbatim off the remote D1 ────────────────────────

/** Kilowattrel ex `sv08-068` "Return Charge" ({L}, index 0, no printed damage). */
const RETURN_CHARGE =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.";
/** Snorlax `sv06-136` "But First, Food" ({C}, index 0, no printed damage). */
const BUT_FIRST_FOOD =
  "Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.";
/** Landorus `sv08-110` "Fist of Focus" ({F}, index 0, printed damage **30**). */
const FIST_OF_FOCUS = "Attach an Energy card from your discard pile to this Pokémon.";

/** The three programs, stated rather than described. */
const PROGRAMS: Record<string, EffectOp[]> = {
  [RETURN_CHARGE]: [
    { op: "switchActive", recordAs: "moved" },
    {
      op: "recordGate",
      slot: "moved",
      then: [
        { op: "attachEnergyFrom", source: "hand", energyType: "Lightning", toSelf: true, count: 2 },
      ],
    },
  ],
  [BUT_FIRST_FOOD]: [
    { op: "attachEnergyFrom", source: "hand", anyEnergy: true, toSelf: true, healTarget: 60 },
  ],
  [FIST_OF_FOCUS]: [{ op: "attachEnergyFrom", source: "discard", anyEnergy: true, toSelf: true }],
};

const RETURN_CHARGE_IDX = 58;
const BUT_FIRST_FOOD_IDX = 59;
const FIST_OF_FOCUS_IDX = 60;

/** Every Energy line this deck carries — the hand is DRAWN rather than placed, so
    a board meaning "no {L} in hand" has to say which cards to send back. */
const ENERGY_LINES = ["fix-energy", "fix-lightning-energy", "fix-special"] as const;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: GATED_ATTACH_DECK, p2: GATED_ATTACH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function ready(
  seed: number,
  {
    bench = ["fix-basic-1", "fix-basic-1"],
    hand = {},
    discard = {},
    damage = 0,
  }: {
    bench?: readonly string[];
    hand?: Partial<Record<string, number>>;
    discard?: Partial<Record<string, number>>;
    damage?: number;
  } = {},
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of ENERGY_LINES) state = handToDeck(state, "p1", id);
  for (const [id, count] of Object.entries(hand)) {
    state = handFromDeck(state, "p1", id, count ?? 0);
  }
  for (const [id, count] of Object.entries(discard)) {
    state = discardFromDeck(state, "p1", id, count ?? 0);
  }
  if (damage > 0) state = setDamage(state, "p1", damage);
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

function promptOf(state: GameState): { note: string; candidates: readonly PokemonRef[] } {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemon")
    throw new Error(`expected choosePokemon, got ${prompt.kind}`);
  return { note: prompt.note, candidates: prompt.candidates };
}

const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

function takeAttach(
  from: { state: GameState; events: GameEvent[] },
  take?: number,
): { state: GameState; events: GameEvent[] } {
  if (from.state.phase.kind !== "effect:choose") return from;
  const prompt = from.state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  const ref = prompt.candidates[0];
  if (ref === undefined) throw new Error("expected a candidate");
  const answered = mustApply(from.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  });
  return { state: answered.state, events: [...from.events, ...answered.events] };
}

function pick(state: GameState, ref: PokemonRef): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
}

/** The card ids attached to a body, so "which Energy landed" is a fact about the
    board rather than about an event count. */
function energyIdsOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (body?.energy ?? []).map((uid) => state.cardIdByUid[uid] as string);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchors — three printed sentences, ONE new arm", () => {
  it("derives each printed sentence to its program", () => {
    for (const [text, program] of Object.entries(PROGRAMS)) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("ONE new arm for three printings, and the other two came off a WIDENED clause", () => {
    const consequent = "Attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.";
    expect(RETURN_CHARGE).toContain(
      `If you do, ${consequent[0]?.toLowerCase()}${consequent.slice(1)}`,
    );
    expect(deriveAttackEffect(consequent)).toEqual([
      { op: "attachEnergyFrom", source: "hand", energyType: "Lightning", toSelf: true, count: 2 },
    ]);
    // …and the gated program's CONSEQUENT is that program, byte for byte. A build
    // that re-parsed the tail with its own copy of the noun logic could drift on
    // the article weld and nothing here would say so.
    const gated = deriveAttackEffect(RETURN_CHARGE);
    expect(gated?.[1]).toMatchObject({
      op: "recordGate",
      slot: "moved",
      then: deriveAttackEffect(consequent) ?? [],
    });
  });

  it("the LEADING clause is anchored, so neither half is readable alone", () => {
    expect(deriveAttackEffect(`${RETURN_CHARGE} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`Draw a card. ${RETURN_CHARGE}`)).toBeNull();
    // …and the bare antecedent still derives to its own one-op program, so the
    // refusals above are the anchor doing work rather than the arm being broken.
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).toEqual([
      { op: "switchActive" },
    ]);
    expect(deriveAttackEffect(RETURN_CHARGE)).not.toEqual([{ op: "switchActive" }]);
    expect(
      deriveAttackEffect(RETURN_CHARGE.replace("If you do, attach", "If you do, Attach")),
    ).toBeNull();
    expect(deriveAttackEffect("attach an Energy card from your hand to this Pokémon.")).toBeNull();
  });

  it("the BARE noun and the BASIC noun are two different narrowings, both ways", () => {
    expect(
      deriveAttackEffect("Attach a Basic Energy card from your hand to this Pokémon."),
    ).toEqual([{ op: "attachEnergyFrom", source: "hand", toSelf: true }]);
    expect(deriveAttackEffect("Attach an Energy card from your hand to this Pokémon.")).toEqual([
      { op: "attachEnergyFrom", source: "hand", anyEnergy: true, toSelf: true },
    ]);
    // …and the two grammatical crosses no card prints are refused by the weld.
    expect(
      deriveAttackEffect("Attach an Basic Energy card from your hand to this Pokémon."),
    ).toBeNull();
    expect(deriveAttackEffect("Attach a Energy card from your hand to this Pokémon.")).toBeNull();
    expect(
      deriveAttackEffect("Attach an {L} Energy card from your hand to this Pokémon."),
    ).toBeNull();
    for (const program of Object.values(PROGRAMS)) {
      for (const op of program) {
        if (op.op === "attachEnergyFrom" && op.anyEnergy === true) {
          expect(op.energyType).toBeUndefined();
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE GATE — the clause NEITHER backlog cell priced
// ─────────────────────────────────────────────────────────────────────────────

describe("Return Charge — the §9.2 gate, and the body that MOVED", () => {
  it("parks the switch, and the park says what answering it BUYS", () => {
    const state = ready(3, { hand: { "fix-lightning-energy": 2 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RETURN_CHARGE_IDX,
    });
    // Two Benched bodies, so `parkOrForce` parks rather than forcing — which is
    // the board this whole describer half needs and the reason the deck is not
    // shared with a sibling suite.
    expect(promptOf(parked).candidates).toHaveLength(2);
    expect(promptOf(parked).note).toContain("If you do");
    expect(promptOf(parked).note).toContain("attach up to 2 Energy to this Pokémon");
  });

  it("the two Energy land on the ATTACKER — which is now on the BENCH", () => {
    const state = ready(3, { hand: { "fix-lightning-energy": 2 } });
    const attackerUid = state.players.p1.active?.stack[0];
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RETURN_CHARGE_IDX,
    });
    const { state: done, events } = takeAttach(pick(parked, benchRef(0)));

    // The switch happened: a Benched body is Active and the attacker is benched.
    expect(done.players.p1.active?.stack[0]).not.toBe(attackerUid);
    const attackerSpot = done.players.p1.bench.findIndex((b) => b?.stack[0] === attackerUid);
    expect(attackerSpot).toBeGreaterThanOrEqual(0);
    // …and BOTH Energy are on the benched attacker, not on the new Active.
    expect(energyIdsOn(done, benchRef(attackerSpot))).toEqual([
      "fix-energy", // the attack's own cost, attached before the switch
      "fix-lightning-energy",
      "fix-lightning-energy",
    ]);
    expect(energyIdsOn(done, { seat: "p1", spot: { spot: "active" } })).toEqual([]);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
  });

  it("an EMPTY Bench switches nothing, so the gate holds NOTHING BACK — and attaches none", () => {
    const state = ready(3, { bench: [], hand: { "fix-lightning-energy": 2 } });
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RETURN_CHARGE_IDX,
    });
    // The attack is DECLARED — §8 says an attack is declared against its Energy
    // cost, never against whether its effect can do anything.
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.hand).toHaveLength(handBefore);
    expect(energyIdsOn(done, { seat: "p1", spot: { spot: "active" } })).toEqual(["fix-energy"]);
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("the printed {L} filter is real — a hand of Colorless attaches NOTHING", () => {
    // The typed narrowing, driven against the line the deck carries for the cost.
    // A build that dropped `energyType` attaches two {C} here and is invisible on
    // a single-type hand, which is why this deck holds both.
    const state = ready(5, { hand: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RETURN_CHARGE_IDX,
    });
    const { state: done, events } = pick(parked, benchRef(0));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.hand.filter((u) => done.cardIdByUid[u] === "fix-energy")).toHaveLength(
      3,
    );
    // …and a MIXED hand takes only the {L}, so the filter is not passing because
    // the zone was empty.
    const mixed = ready(5, { hand: { "fix-energy": 2, "fix-lightning-energy": 1 } });
    deepFreeze(mixed);
    const { state: mixedParked } = mustApply(mixed, {
      type: "attack",
      seat: "p1",
      index: RETURN_CHARGE_IDX,
    });
    const { events: mixedEvents } = takeAttach(pick(mixedParked, benchRef(0)));
    expect(all(mixedEvents, "ENERGY_ATTACHED")).toHaveLength(1);
  });

  it("'up to 2' with ONE {L} in hand attaches ONE, silently", () => {
    const state = ready(7, { hand: { "fix-lightning-energy": 1 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RETURN_CHARGE_IDX,
    });
    const { events } = takeAttach(pick(parked, benchRef(0)));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
  });

  it("D359 — the printed MIDDLE answer behind the §9.2 gate: ONE of two", () => {
    // The quantity axis at its hardest reachable site: the attach is not the
    // program's first op, it is the `then` of a `recordGate`, and it targets the
    // body the FIRST park moved. Two {L} in hand, the controller takes ONE.
    const state = ready(7, { hand: { "fix-lightning-energy": 2 } });
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RETURN_CHARGE_IDX,
    });
    const switched = pick(parked, benchRef(0));
    // The second park carries the printed ceiling and names ONE body.
    if (switched.state.phase.kind !== "effect:choose") throw new Error("expected a second park");
    const prompt = switched.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.upTo).toBe(2);
    const { state: done, events } = takeAttach(switched, 1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(
      done.players.p1.hand.filter((u) => done.cardIdByUid[u] === "fix-lightning-energy"),
    ).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE BARE NOUN — the one thing `anyEnergy` is for
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed bare noun reaches a SPECIAL Energy, in both zones", () => {
  it("But First, Food attaches a SPECIAL Energy out of the hand", () => {
    const state = ready(11, { hand: { "fix-special": 1 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BUT_FIRST_FOOD_IDX,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(energyIdsOn(done, { seat: "p1", spot: { spot: "active" } })).toEqual([
      "fix-energy",
      "fix-special",
    ]);
  });

  it("Fist of Focus attaches one out of the DISCARD PILE — the zone nobody sent this slice to", () => {
    const state = ready(13, { discard: { "fix-special": 1 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FIST_OF_FOCUS_IDX,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(energyIdsOn(done, { seat: "p1", spot: { spot: "active" } })).toEqual([
      "fix-energy",
      "fix-special",
    ]);
    expect(done.players.p1.discard).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("…and the BASIC-noun sibling on the same board attaches NOTHING", () => {
    const state = ready(11, { hand: { "fix-special": 1 } });
    const bare: EffectOp[] = [
      { op: "attachEnergyFrom", source: "hand", anyEnergy: true, toSelf: true },
    ];
    const basicOnly: EffectOp[] = [{ op: "attachEnergyFrom", source: "hand", toSelf: true }];
    expect(programPlayable(state, bare, "p1")).toBe(true);
    expect(programPlayable(state, basicOnly, "p1")).toBe(false);
    // …and a Basic in hand is visible to BOTH, so the false above is about the
    // NOUN and not about an empty zone.
    const withBasic = ready(11, { hand: { "fix-energy": 1 } });
    expect(programPlayable(withBasic, bare, "p1")).toBe(true);
    expect(programPlayable(withBasic, basicOnly, "p1")).toBe(true);
  });

  it("the widened noun is a LIFT, not a swap — a Basic is still in reach", () => {
    const state = ready(11, { hand: { "fix-energy": 1 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BUT_FIRST_FOOD_IDX,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(energyIdsOn(done, { seat: "p1", spot: { spot: "active" } })).toEqual([
      "fix-energy",
      "fix-energy",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE NUMERIC HEAL TAIL
// ─────────────────────────────────────────────────────────────────────────────

describe("the heal tail's NUMBER — printed 60, clamped by the board", () => {
  it("heals exactly 60 off a body carrying more", () => {
    const state = ready(11, { hand: { "fix-special": 1 }, damage: 100 });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BUT_FIRST_FOOD_IDX,
    });
    expect(done.players.p1.active?.damage).toBe(40);
    expect(all(events, "HEALED")).toHaveLength(1);
  });

  it("…and CLAMPS to what is there, rather than going negative", () => {
    // `healChosen`'s clamp, inherited rather than re-implemented — the whole
    // argument for `healTarget` being a field on the attaching op.
    const state = ready(11, { hand: { "fix-special": 1 }, damage: 30 });
    deepFreeze(state);
    const { state: done } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BUT_FIRST_FOOD_IDX,
    });
    expect(done.players.p1.active?.damage).toBe(0);
  });

  it("an EMPTY hand attaches nothing, so the printed 'If you do' heals NOTHING", () => {
    const state = ready(11, { damage: 100 });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BUT_FIRST_FOOD_IDX,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(100);
  });

  it("the tail is on ONE zone, measured — the discard printing carries none", () => {
    const state = ready(13, { discard: { "fix-special": 1 }, damage: 100 });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FIST_OF_FOCUS_IDX,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(100);
  });
});

describe("PROVENANCE — the demonstrator carries the three sentences at 58-60", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields them at 58-60, appended and not inserted", () => {
    expect(attacks()).toHaveLength(73);
    expect(attacks()[RETURN_CHARGE_IDX]?.effect).toBe(RETURN_CHARGE);
    expect(attacks()[BUT_FIRST_FOOD_IDX]?.effect).toBe(BUT_FIRST_FOOD);
    expect(attacks()[FIST_OF_FOCUS_IDX]?.effect).toBe(FIST_OF_FOCUS);
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks()[43]?.effect).toBe(
      "Attach a Basic Energy card from your hand to this Pokémon.",
    );
  });

  it("the printed DAMAGE is the catalog's — 30 on one of the three and none on two", () => {
    expect(attacks()[RETURN_CHARGE_IDX]?.damage).toBeUndefined();
    expect(attacks()[BUT_FIRST_FOOD_IDX]?.damage).toBeUndefined();
    expect(attacks()[FIST_OF_FOCUS_IDX]?.damage).toBe(30);
  });

  it("the FIXTURE is a Basic where two of the prints are not, and nothing depends on it", () => {
    expect(FIXTURE_POOL["fix-trainerops"]?.stage).toBe("Basic");
    for (const program of Object.values(PROGRAMS)) {
      for (const op of program) {
        if (op.op === "attachEnergyFrom") expect(op).not.toHaveProperty("basicOnly");
      }
    }
  });
});
