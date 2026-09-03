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

// 0.161.0 → 0.162.0 — D246, THE GATED ATTACH AND THE BARE NOUN: the last two
// single printings on the D233 backlog page's attach rows, plus a THIRD the page
// never named.
//
// ✅ THE COUNT RE-DERIVES TO THE DIGIT FOR THE THIRTEENTH ROW RUNNING — and it
// re-derives to **3**, where the two backlog cells this slice was handed said
// **2**. Remote D1 `luminous`, `legal_standard = 1`, `json_each` over
// `attacks_json`/`abilities_json` PLUS the bare `effect` column, GLOB (never
// LIKE), GROUPED BY SENTENCE, on 2026-08-06:
//
//   WHERE t GLOB '*If you do, attach*'   -- attack 1/1 legal · effect 3/1 rotated
//   WHERE t GLOB '*ttach an Energy card*'
//     -- attack: sv06-136 (hand, 1 legal) · sv08-110 (DISCARD, 1 legal)
//     --         sv03-166 (hand, 1 rotated)
//
// 🆕 **THE THIRD PRINTING IS THE FINDING, AND IT COST NOTHING.** Landorus
// `sv08-110` "Fist of Focus" prints the bare noun one ZONE over, and no cell on
// the backlog page mentions it: the row-12 cell named `sv06-136` and the row-9
// cell had the sentence sitting in its own `UNREAD` table with the right reason
// beside it, and nothing connected the two. **WIDENING THE ROW'S QUERY FROM ITS
// IDS TO THE PRINTED NOUN** is what joined them — the third slice in four where
// that move found a printing the row did not have.
//
// 🆕 **A WIDENED NOUN TRANSFERS ACROSS EVERY ZONE THE FACTORY SERVES**, which is
// the exact converse of D236's finding. That slice mirrored a family's SOURCE
// ZONE and found the ratio did NOT transfer with the anchor (12 of 17 became 9 of
// 16, because the two zones print different grammar). This one widens the NOUN
// instead, and the widening lands on both zones by construction, because the noun
// is in the shared clause and the zone is the argument. **Mirror the argument and
// you get one family; widen the shared part and you get all of them.**
//
// ✅ AND BOTH `needs` CELLS WERE RIGHT, WHICH HAS NOT HAPPENED ON THIS PAGE
// BEFORE. `sv06-136` was priced "one `anyEnergy` rider away" and it is exactly
// that; `sv08-068` was priced "EVERY OP IT NEEDS EXISTS" — a sentence that has
// been printed five times on that page and been wrong four times — and this time
// it survives being checked FIELD BY FIELD rather than by name.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did an Energy attach".
// `attachEnergyFrom.test.ts` owns the op; `derivedHandAttach.test.ts` and
// `derivedDiscardAttach.test.ts` own the two bare anchors and the arithmetic.
// What is NEW here is three claims that are all about WHICH BODY and WHEN:
//   1. the §9.2 GATE — the clause NEITHER cell priced. An attacker with an empty
//      Bench cannot switch, so nothing attaches. A build that emitted the two ops
//      without the gate accelerates on a board where the printed card does
//      nothing, and passes every "two Energy attached" assertion in the repo;
//   2. `toSelf` AFTER a self-switch — "this Pokémon" is the ATTACKER, which by
//      the time the attach runs is on the BENCH. Every prior `toSelf` printing
//      feeds a body that has not moved, so this is the first board on which
//      `sourceRef`'s "wherever it sits" is observable rather than merely true;
//   3. the printed BARE NOUN — a SPECIAL Energy is in reach, and it is the only
//      thing that tells `anyEnergy` from the absent field.

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
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
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

// ── The board. Indices 58-60 on `fix-trainerops`, appended by D246. ──
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

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order, a HAND stocked line by line and (optionally) a stocked DISCARD
    pile. p2 is a plain body so nothing across the table is reachable by accident.

    ⚠️ THE BENCH DEFAULTS TO **TWO**, which is the whole reason this deck exists:
    `switchActive` only PARKS at two or more candidates, and the park is where the
    §9.2 describer clause lives. */
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

/** 🆕🆕 D359 — **RETURN CHARGE NOW PARKS TWICE, AND THE SECOND PARK IS THE
    SLICE.** The program is `switchActive` (a mandatory `choosePokemon` over the
    Bench) then a `recordGate` whose `then` is the `toSelf` attach — and that
    attach prints *"attach **up to 2** Basic {L} … to this Pokémon"*, which is
    three answers over one body, so `parkOrForce` no longer forces it. Answers the
    attach park with `take` (absent = the whole printed batch) and folds both event
    batches together, so every assertion below still reads one list. A board where
    the gate holds nothing back never parks a second time and comes back as it is. */
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

  it("⚠️ ONE new arm for three printings, and the other two came off a WIDENED clause", () => {
    // 🛑 THE EDIT ESTIMATE, GRADED. The resume point predicted "ONE new deriver
    // arm at most", and that held — but it predicted the arm would be for
    // `sv06-136`, and it is not: the bare noun is a widening of the SHARED clause
    // that both zone anchors already call, so it costs no arm at all, and the one
    // new arm is the GATED sentence's. **Right number, wrong sentence.**
    //
    // The property, driven rather than asserted in prose: strip the leading clause
    // off Return Charge and the remainder is a sentence the HAND anchor already
    // read before this slice, which is what makes "the gated arm is a wrapper"
    // checkable.
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
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      then: deriveAttackEffect(consequent) ?? [],
    });
  });

  it("🛑 the LEADING clause is anchored, so neither half is readable alone", () => {
    // The `^…$` convention, on the one sentence in this family that has TWO
    // clauses. A build anchored only at `^` reads the switch and drops the attach;
    // one anchored only at `$` reads the attach and drops the switch. Both are
    // silent, and both are refused.
    expect(deriveAttackEffect(`${RETURN_CHARGE} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`Draw a card. ${RETURN_CHARGE}`)).toBeNull();
    // …and the bare antecedent still derives to its own one-op program, so the
    // refusals above are the anchor doing work rather than the arm being broken.
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).toEqual([
      { op: "switchActive" },
    ]);
    expect(deriveAttackEffect(RETURN_CHARGE)).not.toEqual([{ op: "switchActive" }]);
    // 🛑 AND THE CASE OF THE CONSEQUENT'S VERB IS LOAD-BEARING. The printed
    // "If you do, **a**ttach" is lowercase; the two bare anchors print a capital.
    // A `[Aa]` class in the shared clause would let a sentence that merely begins
    // mid-clause derive as a whole-string match.
    expect(
      deriveAttackEffect(RETURN_CHARGE.replace("If you do, attach", "If you do, Attach")),
    ).toBeNull();
    expect(deriveAttackEffect("attach an Energy card from your hand to this Pokémon.")).toBeNull();
  });

  it("🛑 the BARE noun and the BASIC noun are two different narrowings, both ways", () => {
    // ⚠️ THE PAIR THAT MAKES `anyEnergy` FALSIFIABLE AT THE TEXT LEVEL. One word
    // apart in print, one field apart in the program — and the article moves with
    // the noun, which is why this is a third alternative rather than an optional
    // "Basic ".
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
    // 🛑 AND THE BARE NOUN NEVER CARRIES A TYPE, which is a fact about the catalog
    // rather than about the regex: no printing spells "an {L} Energy card", so the
    // two fields never co-occur and are left independently readable.
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

describe("🛑 Return Charge — the §9.2 gate, and the body that MOVED", () => {
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
    // ⚠️ THE NEW `describeBranch` ARM, DRIVEN. `withConsequence` reads the gate out
    // of the queue and appends the clause; without the arm the dialog announces the
    // switch and stays silent about the Energy, which is the entire reason to use
    // the attack. 🛑 THE STANDING LESSON APPLIED: an arm nobody parks into is an
    // undrivable line — this one is reached by a real printing on a real board.
    expect(promptOf(parked).note).toContain("If you do");
    expect(promptOf(parked).note).toContain("attach up to 2 Energy to this Pokémon");
  });

  it("🛑 the two Energy land on the ATTACKER — which is now on the BENCH", () => {
    // ⚠️⚠️ THE ASSERTION THIS SLICE EXISTS FOR. The printed "this Pokémon" is the
    // attacker, and by the time the attach runs the attacker has SWITCHED ITSELF
    // OFF THE ACTIVE SPOT. `toSelf` reads `sourceRef`, which finds the body by uid
    // wherever it sits — every prior `toSelf` printing feeds a body that has not
    // moved, so this is the first board on which that is observable.
    //
    // A build that resolved "this Pokémon" as "the Active Spot" attaches two
    // Energy, emits two ENERGY_ATTACHED rows, empties the same hand and is wrong
    // about WHICH Pokémon got them.
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

  it("🛑 an EMPTY Bench switches nothing, so the gate holds NOTHING BACK — and attaches none", () => {
    // ⚠️ THE PAIR THAT MAKES THE GATE LOAD-BEARING, and the clause neither `needs`
    // cell priced. Same attack, same hand, same two {L}: a Bench of ZERO means
    // `switchActive` finds no candidate, `parkOrForce` takes its silent
    // zero-candidate ending, NOTHING is filed under "moved", `recordGateHolds`
    // reads the empty slot as false, and the attach never runs.
    //
    // A build that emitted the two ops WITHOUT the gate attaches two Energy here
    // and passes every assertion in the case above.
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
    // D205's rule on the op, reached from a gated program for the first time:
    // fewer than `count` is normal, not a failure — the print says UP TO.
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

  it("🆕🛑 D359 — the printed MIDDLE answer behind the §9.2 gate: ONE of two", () => {
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

describe("🛑 the printed bare noun reaches a SPECIAL Energy, in both zones", () => {
  it("But First, Food attaches a SPECIAL Energy out of the hand", () => {
    // ⚠️ THE ONLY OBSERVABLE `anyEnergy` HAS. `attachableEnergies` filtered on
    // `card.energyType === "Normal"` — a Basic Energy — so before this slice the
    // op could not see a Special at all, in any zone, on any board. The hand here
    // holds ONE card and it is the Special, so a build with the field dropped
    // attaches nothing and the difference is the whole event count.
    const state = ready(11, { hand: { "fix-special": 1 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BUT_FIRST_FOOD_IDX,
    });
    // ⚠️ A `toSelf` attach offers at most one target, so `parkOrForce` FORCES and
    // this never parks — which is also the discriminator against a build that lost
    // `toSelf` and started asking a question the card does not.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(energyIdsOn(done, { seat: "p1", spot: { spot: "active" } })).toEqual([
      "fix-energy",
      "fix-special",
    ]);
  });

  it("Fist of Focus attaches one out of the DISCARD PILE — the zone nobody sent this slice to", () => {
    // The printing NO backlog cell names, reached by the SAME field with no arm of
    // its own. Its 30 printed damage rides along, which is what says the reader
    // took the whole card rather than just its effect string.
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
    // 🛑 THE CONTROL THAT MAKES THE FIELD FALSIFIABLE RATHER THAN DECORATIVE. Same
    // hand, one Special and nothing else; the program is the bare-noun one with
    // `anyEnergy` removed, i.e. exactly what the sibling sentence "Attach a Basic
    // Energy card from your hand to this Pokémon." derives to. It cannot see the
    // card. Driven through `programPlayable`, where the same helper answers.
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

  it("⚠️ the widened noun is a LIFT, not a swap — a Basic is still in reach", () => {
    // The third direction, and the one a "Special only" build would fail: the
    // printed "an Energy card" means the whole category, so a hand holding only
    // Basics still attaches. `specialEnergy` is the filter that would mean the
    // other thing, and it lives one vocabulary over.
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

  it("🛑 an EMPTY hand attaches nothing, so the printed 'If you do' heals NOTHING", () => {
    // ⚠️ THE SECOND GATE IN THIS SLICE, and it is the op's early returns rather
    // than a `recordGate` — see `attachEnergyFrom`'s doc. Same damage, same
    // attack, no Energy: a build that healed unconditionally passes the two cases
    // above and gives the card a free 60 on every whiff.
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
    // Fist of Focus is the same noun and the same destination one zone over, and
    // it prints NO tail. The whole `*If you do, heal*` family is two sentences and
    // both are hand-source (remote D1, all three text columns, 2026-08-06), which
    // is why the discard anchor's `tail` argument is still the empty string.
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

// ─────────────────────────────────────────────────────────────────────────────
// 5. PROVENANCE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries the three sentences at 58-60", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields them at 58-60, appended and not inserted", () => {
    // 61 at D246, which appended 58-60; 58 at D241 (55-57); 48 at D236 (43-47); 43
    // at D235 (35-42); 35 at D234 (29-34); 29 at D232 (25-28); 25 at D231, 20 at
    // D230, 17 at D229, 14 at D228, 13 at D227, 9 at D189, 8 at D181. ELEVEN
    // slices, eleven appends, zero inserts — which is what every index constant in
    // eleven suites depends on.
    // 🆕🆕 **63 AT D426**, which appended **61-62** — the opponent-chooses hand
    // discard (*"Your opponent discards 2 cards from their hand."* / *"…a card…"*).
    // `opponentHandDiscard.test.ts` owns them, and the append-never-insert
    // discipline this whole paragraph exists for holds again: 0-60 are addressed by
    // constant in a dozen sibling suites and every one of them still means what it
    // meant. ⚠️ NO ORDINAL IS CLAIMED (*"the Nth slice"*) — the running count above
    // was last written at D241 and was already one append behind by D246, which is
    // exactly how a count in a comment rots. The LENGTH is the executable half and
    // it is the line below.
    // 🆕🆕 **68 AT D443**, which appended **66-67** — the OPPONENT-BOARD pair
    // (`derivedOpponentEnergyMove.test.ts` owns them). TWELVE sibling suites carry
    // this pin and all twelve were stepped in one pass, as D442 stepped eleven.
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (`derivedSpreadEnergyMove.test.ts` owns them). ELEVEN sibling suites carry this
    // same length pin and ALL of them were stepped in one pass (D431): a green run
    // after fixing the one that reddened is evidence the runner stopped early.
    expect(attacks()).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
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

  it("⚠️ the printed DAMAGE is the catalog's — 30 on one of the three and none on two", () => {
    // Off the remote D1 rather than invented (D227's corrected fixture is the
    // precedent). It matters here because "Fist of Focus" is the only printing in
    // this slice whose attack does anything at all on an empty zone.
    expect(attacks()[RETURN_CHARGE_IDX]?.damage).toBeUndefined();
    expect(attacks()[BUT_FIRST_FOOD_IDX]?.damage).toBeUndefined();
    expect(attacks()[FIST_OF_FOCUS_IDX]?.damage).toBe(30);
  });

  it("⚠️ the FIXTURE is a Basic where two of the prints are not, and nothing depends on it", () => {
    // The standing rule: say which claim is the FIXTURE's shape and which is the
    // PRINT's. Kilowattrel ex `sv08-068` is a STAGE 1 and Landorus `sv08-110` a
    // Basic; this demonstrator is a Basic for all three. No assertion in this file
    // reads the attacker's stage — `toSelf` asks for a UID and the switch offers
    // the controller's whole Bench, neither of which is stage-sensitive.
    expect(FIXTURE_POOL["fix-trainerops"]?.stage).toBe("Basic");
    for (const program of Object.values(PROGRAMS)) {
      for (const op of program) {
        if (op.op === "attachEnergyFrom") expect(op).not.toHaveProperty("basicOnly");
      }
    }
  });
});
