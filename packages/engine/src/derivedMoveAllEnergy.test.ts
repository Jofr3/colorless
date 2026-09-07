import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, EffectPrompt, GameEvent, GameState, PokemonRef } from "./index";
import { engineVersion, redactGame } from "./index";
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
} from "./testFixtures";

// 0.342.0 → 0.343.0 — D441, THE DECLINABILITY AXIS OF THE MOVE-ENERGY FAMILY.
//
//   "Move all Energy from this Pokémon to 1 of your Benched Pokémon."   (2 legal)
//
// The sentence D229 deferred, and its own note said the blocker was `max`. That
// was half right. The QUANTIFIER was one edit — `max: "all"`, the third inhabitant
// of a field that already carried `number | "any"` — and what actually stood in
// the way is that **"any amount" and "all" disagree about ZERO**. Printed "any
// amount" is a player choice with 0 among the answers; printed "all" is mandatory
// and 0 is not an answer at all. `moveEnergy` has been DECLINABLE since M4 (its
// own doc block says so, and `validateChoice` has never carried a floor), so the
// whole slice is the floor: `min` on the prompt, `min === max` for this sentence.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did the Energy move". `moveEnergyApply`
// is shared verbatim with five other printings and has four suites behind it
// already; `derivedSelfEnergyMove.test.ts` owns the ENDPOINTS. What is new is that
// an answer this op would have accepted since M4 must now be REFUSED — so every
// case below that a declinable build could also pass is paired with one it cannot.
//
// 🛑 THE ONE-DESTINATION BOARD IS A SEPARATE ARM AND NOT AN EDGE CASE. With the
// quantity fixed and one eligible destination there is exactly ONE legal answer,
// so the op FORCES (`parkOrForce`'s doctrine, reached by this op for the first
// time — it hand-rolls 0 and ≥2 and never had a 1, because a decline was always a
// second answer). §3 drives it, and §2's ≥2-bench board is its one-axis control.
//
// THE BOARD IS `CLEAR_STATUS_DECK`, REUSED AND NOT EDITED (D412). Blissey
// `sv01-145` already sits in it three times and its printed attack "Happy Cyclone"
// ({C}{C}{C}, 150) rides along at index 0 carrying this exact sentence — a real
// catalog printing, not a construction. ⚠️ It is `legal_standard = 0` (it is in
// `CENSUS_NOT_LEGAL`), so driving it moves NO census figure; the two LEGAL
// printings are Castform `sv08-020`/`-195`, which are in no fixture pool here and
// are therefore named rather than driven — the honest posture for a checkout with
// no D1.

const SENTENCE = "Move all Energy from this Pokémon to 1 of your Benched Pokémon.";
/** The DECLINABLE neighbour, one determiner away — 8 legal printings, shipped at
    D229. Every rung below that asserts a refusal is paired against this, because
    "the floor is enforced" passes trivially on a build that refuses everything
    (D424: a refusal rung owes an admission on the same axis). */
const DECLINABLE_SIBLING = "Move an Energy from this Pokémon to 1 of your Benched Pokémon.";

const HAPPY_CYCLONE = 0; // sv01-145 Blissey, its printed index
const VOLT_CYCLONE = 14; // fix-trainerops, D229's "Move an Energy…" printing
const SEED = 0x2f11;

/** p2 opens and passes, so p1 plays turn 2 with no §4 first-turn restriction.
    Blissey Active with `basics` Colorless Energy on it and `ownBench` benched
    bodies. Both sides are set explicitly — a build that reached for the other
    seat's Bench is one `otherSeat` away, and this engine's most-repeated defect. */
function board({ basics = 3, ownBench = 2 }: { basics?: number; ownBench?: number } = {}): GameState {
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
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  return prompt;
}

function events<T extends GameEvent["type"]>(all: GameEvent[], type: T) {
  return all.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

describe("§1 — the deriver: one anchor, and the edges it must not reach", () => {
  it("derives to the shipped route with the THIRD quantifier", () => {
    // 🛑 THE PROGRAM, NOT `!== null` (D438). A boolean is true under the real build
    // AND under one that crossed the route to `benchToActive` — the mirror this
    // family's own suite exists to guard against — so the rung names every field.
    expect(deriveAttackEffect(SENTENCE)).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: "all", route: "selfToBench" },
    ]);
  });

  it("the DECLINABLE sibling is untouched — one determiner, two quantifiers", () => {
    // The admission that makes §1's first rung mean something: the new anchor did
    // not swallow the family it sits beside, and the two differ in `max` and in
    // NOTHING else. A build that widened the numeric alternation to `(?:(\d+)|an|all)`
    // would have to answer which alternative matched, and the likeliest slip —
    // reading the absent capture as `max: 1` — collapses this pair.
    const all = deriveAttackEffect(SENTENCE) as EffectOp[];
    const one = deriveAttackEffect(DECLINABLE_SIBLING) as EffectOp[];
    expect(one).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" },
    ]);
    expect({ ...(all[0] as object), max: undefined }).toEqual({ ...(one[0] as object), max: undefined });
  });

  it("🆕 D442 — THIS ANCHOR STILL DOES NOT REACH the multi-destination sibling", () => {
    // *"Move all Energy from this Pokémon to your Benched Pokémon IN ANY WAY YOU
    // LIKE."* (`sv08-067` Kilowattrel, 1 legal) carries the IDENTICAL `max: "all"`
    // and used to be REFUSED here, for a reason this slice did not touch: the
    // `moveEnergy` answer was `{ uids, dest }` — ONE destination for every pick.
    //
    // 🛑 **RE-POINTED, NOT DELETED, AND NOT RE-POINTED ONTO A BOOLEAN (D438).**
    // D442 gave the answer `attachCards`' map and the sibling now derives, so
    // `toBeNull` has stopped being true — but `!== null` would be true under the
    // failure this rung actually guards, which is D441's anchor WIDENING to swallow
    // the spread sentence and deriving it as the coupled program. The claim is
    // therefore the PROGRAM, and the pair is one key apart: the spread sentence
    // carries `anyDest`, this file's own sentence does not.
    expect(
      deriveAttackEffect("Move all Energy from this Pokémon to your Benched Pokémon in any way you like."),
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
    // …and the discriminating BYTES are named, so a later widening has to walk past
    // this line too (D427: a near-miss must differ on ONE axis). The two strings
    // agree up to the destination phrase and there only.
    expect(SENTENCE.startsWith("Move all Energy from this Pokémon to ")).toBe(true);
    expect(SENTENCE.endsWith("1 of your Benched Pokémon.")).toBe(true);
  });

  it("🛑 REFUSES a TRAILING CLAUSE — the `$` witness, CONSTRUCTED and labelled so", () => {
    // D228's lesson at D229's address, re-paid for the third anchor: no member of
    // this family carries a tail in print, so the only witness for the terminator is
    // a built one — and it is a claim about the READER rather than about the pool
    // (D440). A `$`-less anchor would claim the head of a compound and silently ship
    // half the card, which is the class every anchor in `effects.ts` guards.
    expect(
      deriveAttackEffect(
        "Move all Energy from this Pokémon to 1 of your Benched Pokémon. Then, shuffle your deck.",
      ),
    ).toBeNull();
    // …and the un-tailed string it is one clause away from still derives, so the
    // rung above is about the TERMINATOR and not about the sentence.
    expect(deriveAttackEffect(SENTENCE)).not.toBeNull();
  });

  it("🛑 REFUSES the TYPED near miss, which the new anchor did not re-open", () => {
    // D229's stated hazard, re-asserted because THIS slice added the third anchor
    // to that family: `basicEnergy` narrows a CATEGORY and nothing in the op says
    // "{D}", so an anchor loose enough to admit a typed noun would move any Energy
    // at all. 0 legal printings, and a real catalog row.
    expect(deriveAttackEffect("Move all {D} Energy from this Pokémon to 1 of your Benched Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Move 2 {D} Energy from this Pokémon to 1 of your Benched Pokémon.")).toBeNull();
  });
});

describe("§2 — the PARK: the floor crosses, and the decline stops being an answer", () => {
  it("parks with min === max === the whole movable set", () => {
    const state = board({ basics: 3, ownBench: 2 });
    const prompt = parked(swing(state).state);
    expect(prompt.movable).toHaveLength(3);
    expect(prompt.max).toBe(3);
    // 🛑 THE WHOLE SLICE AT ONE FIELD. `max` alone reads identically to a "Move up
    // to 3" prompt on a board holding exactly three, so the ONLY observable that
    // tells a mandatory park from a declinable one is this number.
    expect(prompt.min).toBe(3);
    expect(prompt.min).toBe(prompt.max);
    // The endpoints are still `selfToBench`'s, unchanged by the quantifier.
    expect(prompt.destinations).toHaveLength(2);
    expect(prompt.destinations.every((d) => d.seat === "p1" && d.spot.spot === "bench")).toBe(true);
  });

  it("the NOTE is the card's own sentence — no invented number", () => {
    // D295's caption rule: a heading reading "Move up to 3 Energy" over a pick the
    // player may not shorten is the one screen telling them the wrong thing, and
    // the 3 would additionally CHANGE with the board. The print says "all".
    // Two DIFFERENT movable counts, because a build that resolved "all" to the
    // clamp would print a number that CHANGES with the board — which is exactly
    // what D244 refused for "any amount" and D333 installed as a mutant.
    expect(parked(swing(board({ basics: 3 })).state).note).toBe(SENTENCE);
    expect(parked(swing(board({ basics: 5 })).state).note).toBe(SENTENCE);
  });

  it("🛑 REFUSES the empty answer the family has accepted since M4", () => {
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
      { type: "resolveEffect", seat: "p1", choice: { kind: "moveEnergy", picks: short.map((uid) => ({ uid, dest })) } },
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
    expect(rows[0]).toMatchObject({ seat: "p1", uids, from: { spot: "active" }, to: { spot: "bench", index: 1 } });
    // The seat control — the opponent's BOARD is untouched. (Their deck and hand
    // move because resolving this park ends the turn, which is not this op.)
    expect(done.state.players.p2.active).toEqual(state.players.p2.active);
    expect(done.state.players.p2.bench).toEqual(state.players.p2.bench);
  });

  it("🛑 THE DECLINABLE CONTROL: a park with no floor carries NO `min` KEY AT ALL", () => {
    // D226's own move, and the reason `min` is SPREAD rather than written as 0: a
    // prompt from any other printing in this family must be BYTE-IDENTICAL to what
    // it was before the field existed, or the wire shape moved for every card in
    // it and the version argument in `redacted.ts` is wrong.
    //
    // ⚠️ TWO DECKS, ON PURPOSE, AND BOTH PRINTINGS ARE REAL. `CLEAR_STATUS_DECK`
    // fields the mandatory sentence (Blissey) and `SELF_ENERGY_MOVE_DECK` fields
    // the declinable one (`fix-trainerops` idx 14, "Volt Cyclone" — D229's board),
    // so neither park is constructed and neither deck is edited (D412).
    const mandatory = parked(swing(board({ basics: 3, ownBench: 2 })).state);
    const declinable = parked(swingSibling());
    expect(Object.keys(declinable).sort()).toEqual(["destinations", "kind", "max", "movable", "note"]);
    expect("min" in declinable).toBe(false);
    // …and the MANDATORY park carries exactly one more key, which is the diff.
    expect(Object.keys(mandatory).sort()).toEqual(["destinations", "kind", "max", "min", "movable", "note"]);
    // 🛑 AND THE DECLINE IS STILL A LEGAL ANSWER ON THE PROMPT WITHOUT THE FLOOR —
    // the admission that keeps §2's refusal rungs from passing on a build that
    // simply refuses every empty pick (D424). Same op, same route, same engine.
    const sibling = swingSiblingState();
    // D442 — the decline no longer names a destination (`picks: []`), so the
    // sibling's prompt is not read here at all.
    const declined = mustApply(sibling, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    expect(events(declined.events, "ENERGY_MOVED")).toHaveLength(0);
  });
});

/** D229's board, reached rather than rebuilt: `fix-trainerops` idx 14 ("Volt
    Cyclone") prints *"Move an Energy from this Pokémon to 1 of your Benched
    Pokémon."* — 8 legal printings, shipped since D229 — so the declinable control
    is a REAL park of a REAL printing on a REAL deck, not an op literal handed to
    the interpreter. It is the one thing that could tell a floor that crosses from
    a floor that is simply always present. */
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
    // `parkOrForce`'s 1-candidate rule, reached by `moveEnergy` for the first time.
    // Every declinable printing on this same board still parks (§3's next rung),
    // so the force is keyed on the FLOOR and not on the destination count.
    const state = board({ basics: 3, ownBench: 1 });
    const done = swing(state);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.active?.energy).toEqual([]);
    expect(done.state.players.p1.bench[0]?.energy).toHaveLength(3);
    const rows = events(done.events, "ENERGY_MOVED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seat: "p1", from: { spot: "active" }, to: { spot: "bench", index: 0 } });
  });

  it("🛑 and a ONE-DESTINATION board PARKS for the declinable sibling — the control", () => {
    // The pair that makes the force a DECISION rather than an accident: same op,
    // same route, same endpoints, ONE eligible destination. The mandatory printing
    // resolves inline; the declinable one must still ask, because the answer it
    // would be forced into is one the player is entitled to refuse (D47's review
    // reversal, which D358 records: honouring a decline only above the auto-resolve
    // threshold honours it "exactly where declining matters least").
    //
    // ⚠️ DRIVEN, NOT GATED. `programPlayable` answers a different question, and a
    // rung that asked it would pass on a build where the declinable arm also
    // forced — which is the whole defect this pair exists to catch.
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
    if (wire === null || wire.kind !== "moveEnergy") throw new Error("expected a wire moveEnergy prompt");
    // 🛑 THE ONLINE HALF. `ChoosePokemonDialog`'s twin defect (D358): a floor the
    // wire drops is a mandatory move the remote player is offered the right to
    // refuse, with every local assertion above still green.
    expect(wire.min).toBe(3);
    expect(wire.max).toBe(3);
    expect(Object.keys(wire).sort()).toEqual(["destinations", "kind", "max", "min", "movable", "note"]);
  });

  it("the fixture printing is `legal_standard = 0`, so NO census figure moves for it", () => {
    // D423's scoped-claim rule, applied to this file's own board. Blissey is the
    // DRIVEABLE printing; the two the census counts are Castform `sv08-020`/`-195`,
    // which no fixture here holds. Saying so is what keeps a later reader from
    // reading "2 printings" off this suite's board count.
    expect(FIXTURE_POOL["sv01-145"]?.name).toBe("Blissey");
    expect(FIXTURE_POOL["sv01-145"]?.attacks?.[HAPPY_CYCLONE]?.effect).toBe(SENTENCE);
  });
});

describe("§5 — the persisted shape: a v29 record still means what it meant", () => {
  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — DRIVEN OVER THE BYTES, both directions", () => {
    // The rule (`apps/api/src/lobby/match.ts`): *"does the OLD BYTE STRING still
    // mean what it meant"*, and *"a WIDENING is free and a RENAME is not"*. This
    // slice moves two persisted shapes and both are widenings:
    //
    //   · the OP — `moveEnergy.max` gains the inhabitant `"all"`. An `EffectOp` IS
    //     persisted (`EffectContinuation.pendingOp` rides `GameState.phase.cont`)
    //     and this op parks, so it is the address D140's 2 → 3 bump was about. D333
    //     measured NO bump for a WIDENED `max` UNION on `lookAtTopN` for exactly
    //     this reason: no v29 deploy can author `"all"`, so no old byte string is
    //     re-interpreted (D125's condition).
    //   · the PROMPT — `min` is a NEW OPTIONAL key. D334 measured no bump for an
    //     added optional `exact` on that same op, because a record missing it
    //     resumes to the pre-D334 behaviour, *"which is what the old record MEANT"*.
    //
    // 🛑 AND THAT SECOND HALF IS THE ONE WORTH DRIVING, BECAUSE D359 IS THE SAME
    // SHAPE POINTING THE OTHER WAY. `choosePokemon.upTo` DID bump 21 → 22: absent
    // came to mean MANDATORY where a v21 record's bytes meant DECLINABLE. Here
    // absent means DECLINABLE and every v29 `moveEnergy` park was declinable — the
    // arm's own doc said so and `validateChoice` carried no floor. Direction is the
    // whole of the difference, so it is EXERCISED rather than argued.
    const live = swing(board({ basics: 3, ownBench: 2 })).state;
    expect(parked(live).min).toBe(3);

    // (a) A v29 RECORD, reconstructed by deleting the key a v29 writer never wrote —
    // D326's and D309's move — and replayed through the real action API.
    const v29: GameState = JSON.parse(JSON.stringify(live)) as GameState;
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

    // (c) AND THE OP SIDE, over the serialized bytes rather than the type: a v29
    // `pendingOp` can only spell `max` as a number or `"any"`, and both still read
    // as they did. The literal `"all"` appears in NO record a v29 deploy could
    // write, which is D125's condition stated as a property of the byte string.
    const bytes = JSON.stringify(v29.phase.cont.pendingOp);
    expect(bytes).toContain('"max":"all"');
    expect(JSON.parse(bytes)).toEqual({
      op: "moveEnergy",
      filter: { kind: "anyEnergy" },
      max: "all",
      route: "selfToBench",
    });
  });

  it("the version pin — this file's own, counted rather than inherited", () => {
    // D427's mechanism, obeyed: every note counts the pins it INHERITED and never
    // the one it is about to AUTHOR. MEASURED at this head by grepping BOTH
    // `engineVersion` and `manifest.version`: **25 assertions across 25 files**
    // before this line, **26** with it, over 27 sites once `index.ts`'s declaration
    // and `packages/engine/package.json` are counted.
    expect(engineVersion).toBe("0.379.0");
  });
});
