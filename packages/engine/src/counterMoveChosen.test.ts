import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  COUNTER_MOVE_CHOSEN_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

// 0.135.0 → 0.136.0 — the CHOSEN-DESTINATION COUNTER MOVE (D216). "Move all
// damage counters from 1 of your Benched Pokémon to 1 of your opponent's
// Pokémon." — Cofagrigus sv10.5w-040/-123 "Extended Damagriiigus", 2 Standard-
// legal printings, on ONE anchored regex with NO capture, ONE deriver arm and ONE
// new op with ONE never-authored field.
//
// THE FIRST PRINTED SENTENCE IN THIS ENGINE THAT ASKS TWO QUESTIONS. Everything
// else in the vocabulary is one op, one decision: `moveEnergy` looks like two and
// is not (it is a single compound prompt whose answer arrives whole), and the
// three gates branch on facts rather than on answers. This one prints "from … to
// …" with a choice at BOTH ends, and the slice is almost entirely about the seam
// that lets an answer reach a second question.
//
// ⚠️ WHAT THE RESUME POINT SAID, AND WHAT WAS TRUE — checked before anything was
// built, which is this file's first two cases:
//   • D206: "`applyChoice` returns a `GameState`, so an op that has parked ONCE
//     cannot park AGAIN." — TRUE OF ONE OP AND FALSE OF A PROGRAM, and the
//     difference is the whole slice. `runProgram(rest)` parks again the instant an
//     op in `rest` wants a decision, and a SHIPPED card already does it: Koraidon
//     "Dino Cry" attaches across two parks (dinoCry.test.ts). So a second park was
//     never the missing piece; a CHANNEL from the first answer to the second
//     question was.
//   • D206: "the engine's only two-ended decision (`moveEnergy`) dodges it with a
//     compound prompt kind, i.e. a WIRE change." — TRUE, and that is exactly why
//     this slice did NOT take that route: an `EffectPrompt` kind is mirrored in
//     `packages/schema/src/match/redacted.ts` and rendered by the HUD, neither of
//     which this slice owns. Two `choosePokemon` parks need no wire at all.
//   • D205/D206: "the family is 7 Standard-legal printings." — 8, re-derived
//     below, and only 2 of them are reachable without that wire change.
//
// WHAT IS ACTUALLY NEW HERE, and why this is not a copy of counterMove.test.ts:
//   • TWO PARKS FROM ONE OP, and each of the two questions has a FORCED ending as
//     well as a parked one — four combinations, all four driven, because the
//     forced ending of question ONE is the one that could not exist before this
//     slice (`parkOrForce` auto-resolves through a `(ref) => GameState`, which has
//     nowhere to put an answer).
//   • THE DESTINATION IS READ, NOT ASSUMED. Every assertion about where the
//     counters landed names a body that is NOT the opponent's Active, because a
//     build that quietly reused `moveCountersToDefender` passes every park
//     assertion in this file and lands the pile on the wrong Pokémon.
//   • THE §11 GATE IS CONDITIONAL. `attackEffectRefused` asks about a seat's
//     ACTIVE; on a BENCHED destination it is the wrong question, so it is not
//     asked — driven in BOTH directions on ONE board, which is the only way that
//     is a measurement rather than a claim.

/** The printed sentence, verbatim off the remote D1 (2026-08-04). */
const CLAUSE =
  "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";

/** D138's sentence — this anchor's nearest neighbour, one noun phrase away, and
    the string a loosened tail would swallow. */
const FIXED_CLAUSE =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";

/** The op, FIELD-LESS as derived: `fromBench` is the interpreter's answer to the
    first question and never appears in a derived program. */
const CHOSEN_OP = { op: "moveCountersChosen" } as const;

/** THE CENSUS, RE-DERIVED RATHER THAN INHERITED (remote D1
    `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 3,786 rows / 20 sets, 2,021 legal;
    2026-08-04; ALL THREE text columns through `json_each` — `attacks_json`,
    `abilities_json` and `effect` — with `GLOB` and never `LIKE`).

    Surfaces whose sentence MOVES damage counters: 12, over 24 printings. Of those,
    the ones whose DESTINATION is a choice — this family — are FOUR surfaces over
    EIGHT Standard-legal printings, and D205's "2" and D206's "7" are both floors
    of it. The unit is the SURFACE, not the card id (D205's rule): Munkidori's
    three printings are one sentence, and Cofagrigus's two are one attack. */
const FAMILY = [
  { surface: "attack:Extended Damagriiigus", ids: ["sv10.5w-040", "sv10.5w-123"], built: true },
  { surface: "ability:Adrena-Brain", ids: ["sv06-095", "sv06.5-072", "sv08.5-044"], built: false },
  { surface: "ability:Rocket Brain", ids: ["sv10-089", "sv10-198"], built: false },
  { surface: "attack:Strange Hacking", ids: ["sv06-082"], built: false },
] as const;

const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P1_BENCH_0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
const P1_BENCH_1: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 1 } };
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const P2_BENCH_0: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 0 } };
const P2_BENCH_1: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 1 } };

const CHOSEN_INDEX = 0;
const FIXED_INDEX = 1;
const PING_INDEX = 2;

/** The pile a case moves. 60 is under fix-victim's 30 HP doubled and over it once,
    which is what lets one number both survive on a titan and KO a victim. */
const PILE = 60;
const OTHER_PILE = 40;
/** fix-victim is 30 HP: any pile above it KOs, which is how the epilogue's sweep
    is driven off a CHOSEN BENCHED body rather than off the Active. */
const VICTIM_HP = 30;

/** ONE BOARD, NO SWEEP — nothing here takes a coin. P2 goes first and passes, so
    P1's attack step is legal (§4). Both Actives are pinned by surgery and BOTH
    BENCHES ARE EMPTIED (D133's trap: `setActiveFromDeck` DISPLACES the Active it
    replaces onto the Bench, which is invisible to a file that asserts Actives and
    fatal to one whose every claim is a CANDIDATE LIST). Every benched body below
    is put there by a case, on purpose. */
function board(): GameState {
  let state = driveSetup(11, { p1: COUNTER_MOVE_CHOSEN_DECK, p2: COUNTER_MOVE_CHOSEN_DECK }, {
    first: "p2",
  });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-cofagrigus");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(clearBench(state, "p1"), "p2");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Bench `entries` on `seat`, each with the damage it names. */
function bench(
  state: GameState,
  seat: Seat,
  entries: { id: string; damage?: number }[],
): GameState {
  let next = state;
  for (const entry of entries) {
    next = benchFromDeck(next, seat, entry.id);
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, entry.damage ?? 0);
  }
  return next;
}

function declare(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function pick(ref: PokemonRef) {
  return { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } } as const;
}

function promptOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
}

function contOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.cont;
}

function findAll<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

describe("the census — re-derived, per surface, both scopes", () => {
  it("is FOUR surfaces / EIGHT Standard-legal printings, and this slice builds ONE", () => {
    expect(FAMILY).toHaveLength(4);
    expect(FAMILY.flatMap((row) => row.ids)).toHaveLength(8);
    // Every id appears once — the wrong-row failure D200/D206/D207 each paid for
    // starts with a grouped query returning one card's id for another's sentence.
    expect(new Set(FAMILY.flatMap((row) => row.ids)).size).toBe(8);
    // ⚠️ D205 SAID 2 AND D206 SAID 7. Both are FLOORS of this sweep and both are
    // explained by scope: D205 read `attacks_json` alone (so it saw Cofagrigus and
    // nothing else), and D206 added the two ABILITY surfaces but not Alakazam's
    // attack, whose destination is chosen on the OPPONENT's own board.
    const built = FAMILY.filter((row) => row.built);
    expect(built).toHaveLength(1);
    expect(built.flatMap((row) => row.ids)).toEqual(["sv10.5w-040", "sv10.5w-123"]);
    // …and the other three are refused on a MECHANISM each, not on a predicate:
    // an amount prompt (`up to 3`), an unbounded repeat (`as often as you like`),
    // and a many-to-many assignment (`in any way you like`). Each is a wire or a
    // phase change; none is a rider this op could grow.
    expect(FAMILY.filter((row) => !row.built).flatMap((row) => row.ids)).toHaveLength(6);
  });
});

describe("the anchor — one clause, one regex, NO capture", () => {
  it("derives the printed clause to a FIELD-LESS op", () => {
    expect(deriveAttackEffect(CLAUSE)).toEqual([CHOSEN_OP]);
    const ops = deriveAttackEffect(CLAUSE);
    expect(ops).toHaveLength(1);
    // ⚠️ NO KEYS BUT `op`. `fromBench` is the INTERPRETER's answer to question one
    // and must never be authored; a deriver that emitted it (even as `undefined`)
    // would skip question one entirely and move counters off Bench slot 0.
    expect(Object.keys(ops?.[0] as object)).toEqual(["op"]);
  });

  it("is DISJOINT from D138's anchor in both directions", () => {
    // The two sentences differ only in their tail, so this is the one mistake the
    // slice is most likely to make. Both directions, because a loosened tail on
    // EITHER anchor swallows the other's string and the failure is silent: the
    // counters still move, to the wrong place or after the wrong number of
    // questions.
    expect(deriveAttackEffect(FIXED_CLAUSE)).toEqual([{ op: "moveCountersToDefender" }]);
    expect(deriveAttackEffect(FIXED_CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersChosen" }),
    );
    expect(deriveAttackEffect(CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
    // D205's rider still lands on ITS anchor and not on this one.
    expect(
      deriveAttackEffect(
        "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.",
      ),
    ).toEqual([{ op: "moveCountersToDefender", ownerPokemon: "Team Rocket" }]);
  });

  it("refuses the rewrites — including the possessive this anchor deliberately has NO capture for", () => {
    for (const text of [
      // ⚠️ THE OWNER-PREFIXED SOURCE. D205's anchor takes it; this one does NOT,
      // because the census says no chosen-destination printing prints one, and a
      // capture here would derive a reading no card has. The day such a card is
      // printed this line moves to the "derives" list, loudly.
      "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to 1 of your opponent's Pokémon.",
      // THE AMOUNT — Munkidori's shape, and this op has no field to bound it with.
      "Move up to 3 damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.",
      // THE SOURCE ZONE — dropping "Benched" would silently offer the attacker.
      "Move all damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.",
      // THE DESTINATION NARROWED to the Bench: a real reading, and not this one.
      "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Benched Pokémon.",
      // THE SEAT, swapped at the destination — this would damage the controller.
      "Move all damage counters from 1 of your Benched Pokémon to 1 of your Pokémon.",
      // THE COUNT at the source.
      "Move all damage counters from 2 of your Benched Pokémon to 1 of your opponent's Pokémon.",
      // A LOWERCASE first word — half of what keeps Munkidori's and Orbeetle's
      // mid-sentence "move" off this path, and why there is no /i flag.
      "move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.",
      // NO TRAILING PERIOD, and a leading rider sentence — `^…$` on both ends.
      "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon",
      "Flip a coin. If heads, move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.",
      "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon. This Pokémon is now Asleep.",
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("derives the CURLY apostrophe identically", () => {
    const curly = CLAUSE.replaceAll("'", "’");
    expect(curly).not.toBe(CLAUSE);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(curly)).toEqual([CHOSEN_OP]);
  });
});

describe("the fixture's printed text — the sentence is load-bearing", () => {
  it("carries BOTH counter-move sentences one attack index apart, and NO registry row", () => {
    const card = FIXTURE_POOL["fix-cofagrigus"];
    expect(card?.attacks?.[CHOSEN_INDEX]).toEqual({
      cost: ["Colorless"],
      name: "Extended Damagriiigus",
      effect: CLAUSE,
    });
    expect(card?.attacks?.[FIXED_INDEX]?.effect).toBe(FIXED_CLAUSE);
    // ONE card, two sentences, two DIFFERENT ops — the disjointness claim made on
    // the bytes an attack declaration actually reads.
    expect(deriveAttackEffect(card?.attacks?.[CHOSEN_INDEX]?.effect ?? "")).toEqual([CHOSEN_OP]);
    expect(deriveAttackEffect(card?.attacks?.[FIXED_INDEX]?.effect ?? "")).toEqual([
      { op: "moveCountersToDefender" },
    ]);
    // NO `damage` on either move, so the move (and the parks in front of it) is
    // the entire visible result of the declaration — there is no number for a
    // half-simulation to hide behind.
    expect(card?.attacks?.[CHOSEN_INDEX]?.damage).toBeUndefined();
    expect(card?.attacks?.[FIXED_INDEX]?.damage).toBeUndefined();
    // The control: an attack on this body that resolves without a program at all,
    // which is what tells "nothing parked" apart from "the attack was refused".
    expect(deriveAttackEffect(card?.attacks?.[PING_INDEX]?.effect ?? "")).toBeNull();
    // If it grew a registry row the registry would win and every assertion in this
    // file would keep passing while testing nothing about the text.
    expect(programFor("fix-cofagrigus")).toBeUndefined();
  });
});

describe("two questions, two parks — the seam", () => {
  it("PARKS on the source, then PARKS AGAIN on the destination, then lands", () => {
    let state = bench(board(), "p1", [
      { id: "fix-titan", damage: PILE },
      { id: "fix-titan", damage: OTHER_PILE },
    ]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);

    // QUESTION ONE — the controller's own Bench, both bodies offered.
    const first = declare(state, CHOSEN_INDEX);
    const sourcePrompt = promptOf(first.state);
    expect(sourcePrompt.kind).toBe("choosePokemon");
    expect(sourcePrompt).toMatchObject({ candidates: [P1_BENCH_0, P1_BENCH_1] });
    // THE NOTE SAYS A SECOND QUESTION IS COMING. Without it a player reads this as
    // the whole decision and picks a source for a destination not yet offered.
    expect(sourcePrompt.note).toContain("You will then choose where they go");
    // NOTHING HAS MOVED YET — the source answer buys an op, not a board change.
    expect(first.state.players.p1.bench[0]?.damage).toBe(PILE);
    expect(findAll(first.events, "HEALED")).toHaveLength(0);
    expect(findAll(first.events, "COUNTERS_PLACED")).toHaveLength(0);
    // …and the parked op has NO answer on it yet.
    expect(contOf(first.state).pendingOp).toEqual(CHOSEN_OP);

    // QUESTION TWO — the OPPONENT's whole board, Active included.
    const second = mustApply(first.state, pick(P1_BENCH_0));
    const destPrompt = promptOf(second.state);
    expect(destPrompt.kind).toBe("choosePokemon");
    expect(destPrompt).toMatchObject({ candidates: [P2_ACTIVE, P2_BENCH_0, P2_BENCH_1] });
    expect(destPrompt.note).toContain("opponent");
    // ⚠️ THE ANSWER TO QUESTION ONE IS ON THE PARKED OP, and this is the whole
    // channel: it is PERSISTED there (`GameState.phase.cont.pendingOp`), which is
    // what makes a resume of this match resolve the same move. A build that put it
    // anywhere else — `EffectRecord`, a module-level variable — fails here.
    expect(contOf(second.state).pendingOp).toEqual({ ...CHOSEN_OP, fromBench: 0 });

    // …and the landing.
    const third = mustApply(second.state, pick(P2_BENCH_1));
    expect(third.state.phase.kind).not.toBe("effect:choose");
    expect(third.state.players.p1.bench[0]?.damage).toBe(0);
    expect(third.state.players.p1.bench[1]?.damage).toBe(OTHER_PILE);
    // ⚠️ THE CHOSEN BODY AND NOTHING ELSE. A build that reused
    // `moveCountersToDefender` puts the pile on the Active and passes every park
    // assertion above.
    expect(third.state.players.p2.bench[1]?.damage).toBe(PILE);
    expect(third.state.players.p2.bench[0]?.damage).toBe(0);
    expect(third.state.players.p2.active?.damage).toBe(0);
  });

  it("puts the pile on the ACTIVE when the ACTIVE is what was chosen", () => {
    // The same board and the same two answers but for the last one, so the only
    // difference between this case and the one above is the destination the player
    // named. That pair is what makes "the destination is read" a measurement.
    let state = bench(board(), "p1", [
      { id: "fix-titan", damage: PILE },
      { id: "fix-titan", damage: OTHER_PILE },
    ]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const parked = mustApply(declare(state, CHOSEN_INDEX).state, pick(P1_BENCH_0));
    const done = mustApply(parked.state, pick(P2_ACTIVE));
    expect(done.state.players.p2.active?.damage).toBe(PILE);
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
    expect(done.state.players.p2.bench[1]?.damage).toBe(0);
  });

  it("emits ONE number in TWO rows — the word 'move'", () => {
    let state = bench(board(), "p1", [{ id: "fix-titan", damage: PILE }]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const sourceUid = benchTopUid(state, "p1", 0);
    const destUid = benchTopUid(state, "p2", 1);
    const parked = declare(state, CHOSEN_INDEX);
    const done = mustApply(parked.state, pick(P2_BENCH_1));
    const healed = findAll(done.events, "HEALED");
    const placed = findAll(done.events, "COUNTERS_PLACED");
    expect(healed).toHaveLength(1);
    expect(placed).toHaveLength(1);
    // The equality IS the printed verb; two different numbers would be a heal and
    // a snipe wearing one sentence.
    expect(healed[0]?.amount).toBe(PILE);
    expect(placed[0]?.amount).toBe(PILE);
    // …and each row names the body it is about, on the seat that OWNS it.
    expect(healed[0]).toMatchObject({ seat: "p1", uid: sourceUid });
    expect(placed[0]).toMatchObject({ seat: "p2", uid: destUid, source: "moved" });
  });
});

describe("the four endings of two questions", () => {
  it("a FORCED source still asks the destination — the ending that could not exist before", () => {
    // ONE benched body: the M1 no-choice doctrine says do not prompt for it, and
    // `parkOrForce`'s auto-resolve applies a `(ref) => GameState`, which has
    // nowhere to put an answer. A build that used `parkOrForce` here either
    // prompts for a decision that is not one, or loses the destination question
    // entirely and moves nothing.
    let state = bench(board(), "p1", [{ id: "fix-titan", damage: PILE }]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const first = declare(state, CHOSEN_INDEX);
    const prompt = promptOf(first.state);
    // The FIRST park a player ever sees on this board is the DESTINATION one.
    expect(prompt).toMatchObject({ candidates: [P2_ACTIVE, P2_BENCH_0, P2_BENCH_1] });
    expect(prompt.note).toContain("opponent");
    expect(contOf(first.state).pendingOp).toEqual({ ...CHOSEN_OP, fromBench: 0 });
    const done = mustApply(first.state, pick(P2_BENCH_0));
    expect(done.state.players.p2.bench[0]?.damage).toBe(PILE);
    expect(done.state.players.p1.bench[0]?.damage).toBe(0);
  });

  it("a FORCED source and a FORCED destination resolve with NO park at all", () => {
    // One benched body on each side of the question: the whole sentence has no
    // decision left in it, so it must resolve inline. A build that parked here
    // would leave a match sitting on a prompt with one button.
    const state = bench(board(), "p1", [{ id: "fix-titan", damage: PILE }]);
    const done = declare(state, CHOSEN_INDEX);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p2.active?.damage).toBe(PILE);
    expect(done.state.players.p1.bench[0]?.damage).toBe(0);
    expect(findAll(done.events, "COUNTERS_PLACED")).toHaveLength(1);
  });

  it("a CHOSEN source and a FORCED destination park exactly ONCE", () => {
    const state = bench(board(), "p1", [
      { id: "fix-titan", damage: PILE },
      { id: "fix-titan", damage: OTHER_PILE },
    ]);
    const first = declare(state, CHOSEN_INDEX);
    expect(promptOf(first.state)).toMatchObject({ candidates: [P1_BENCH_0, P1_BENCH_1] });
    const done = mustApply(first.state, pick(P1_BENCH_1));
    // The destination auto-resolved onto the lone Active — no second prompt.
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p2.active?.damage).toBe(OTHER_PILE);
    expect(done.state.players.p1.bench[1]?.damage).toBe(0);
    expect(done.state.players.p1.bench[0]?.damage).toBe(PILE);
  });

  it("an EMPTY Bench is a silent no-op — no prompt, no rows, and the attack still resolved", () => {
    const state = bench(board(), "p2", [{ id: "fix-bigbody" }]);
    const done = declare(state, CHOSEN_INDEX);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(findAll(done.events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(findAll(done.events, "HEALED")).toHaveLength(0);
    // NOT an ATTACK_EFFECT_SKIPPED: a derived program means the sentence was read
    // (D138's ending, inherited rather than re-argued).
    expect(findAll(done.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    // The control — an attack on this body CAN resolve visibly, so "nothing
    // happened" above is the sentence's doing and not a refused declaration.
    const ping = declare(bench(board(), "p2", [{ id: "fix-bigbody" }]), PING_INDEX);
    expect(findAll(ping.events, "DAMAGE_DEALT")).toHaveLength(1);
  });
});

describe("the whiff — an undamaged source costs no second question", () => {
  it("a FORCED undamaged source resolves with no prompt and no rows", () => {
    // The printed sentence offers undamaged bodies on purpose (the Potion
    // doctrine), so this is a run-time whiff and not a derivation failure. Asking
    // "where do these counters go?" about zero counters is a question with no
    // answer, which is why the check sits before the destination park.
    let state = bench(board(), "p1", [{ id: "fix-titan", damage: 0 }]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const done = declare(state, CHOSEN_INDEX);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(findAll(done.events, "HEALED")).toHaveLength(0);
    expect(findAll(done.events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("a CHOSEN undamaged source still parks ONCE, then stops", () => {
    // Two undamaged bodies: the SOURCE question is still a real decision (the
    // sentence has no damaged restriction), and the DESTINATION question dies with
    // the whiff. A build that dropped the whiff check offers a destination prompt
    // here and moves 0 counters onto whatever is picked.
    let state = bench(board(), "p1", [
      { id: "fix-titan", damage: 0 },
      { id: "fix-titan", damage: 0 },
    ]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const first = declare(state, CHOSEN_INDEX);
    expect(promptOf(first.state)).toMatchObject({ candidates: [P1_BENCH_0, P1_BENCH_1] });
    const done = mustApply(first.state, pick(P1_BENCH_1));
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(findAll(done.events, "COUNTERS_PLACED")).toHaveLength(0);
  });
});

describe("§11 — the block refuses an ACTIVE destination and has no business with a BENCHED one", () => {
  /** A live wide `{ effects: true }` block on P2's Active, for THIS turn. */
  function withBlock(state: GameState): GameState {
    const active = state.players.p2.active;
    if (active === null) throw new Error("expected a P2 Active");
    return {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: { ...active, attackBlock: { turn: state.turn, effects: true } },
        },
      },
    };
  }

  /** ONE board, TWO answers. Both destinations are offered; the block is live on
      exactly one of them, and the difference between the two runs is the pick. */
  function blockedBoard(): GameState {
    let state = bench(board(), "p1", [{ id: "fix-titan", damage: PILE }]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }]);
    return withBlock(state);
  }

  it("refuses the WHOLE move when the ACTIVE is chosen — both halves or neither", () => {
    const first = declare(blockedBoard(), CHOSEN_INDEX);
    const done = mustApply(first.state, pick(P2_ACTIVE));
    expect(done.state.players.p2.active?.damage).toBe(0);
    // ⚠️ AND THE BENCH BODY KEEPS ITS COUNTERS. Healing the source while the
    // counters never arrive would launder damage off the attacker's own board —
    // the one outcome the two-rows-one-number rule exists to prevent.
    expect(done.state.players.p1.bench[0]?.damage).toBe(PILE);
    expect(findAll(done.events, "HEALED")).toHaveLength(0);
    expect(findAll(done.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("LANDS on a BENCHED destination on the SAME board — the gate is not asked there", () => {
    // `attackEffectRefused` asks about a seat's ACTIVE. A §11 block is an
    // Active-Spot fact by construction, so on a benched destination it is the
    // wrong question — and answering it would refuse a move the printed block
    // never touched, on the evidence of a different Pokémon. A build that kept the
    // gate unconditional fails HERE and passes the case above.
    const first = declare(blockedBoard(), CHOSEN_INDEX);
    const done = mustApply(first.state, pick(P2_BENCH_0));
    expect(done.state.players.p2.bench[0]?.damage).toBe(PILE);
    expect(done.state.players.p1.bench[0]?.damage).toBe(0);
    expect(findAll(done.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });
});

describe("the epilogue still sweeps — a moved pile can KO a CHOSEN benched body", () => {
  it("KOs the picked Bench Pokémon and awards the prize", () => {
    // Every earlier counter-move KO in this engine is on the DEFENDER. This one is
    // on a benched body the attacker named, which is a different arm of the same
    // two-seat sweep — and it is reached from behind a park, because `resumeTail`
    // keeps `attackEpilogue` queued behind the question (D135).
    let state = bench(board(), "p1", [{ id: "fix-titan", damage: PILE }]);
    state = bench(state, "p2", [{ id: "fix-victim" }]);
    expect(FIXTURE_POOL["fix-victim"]?.hp).toBe(VICTIM_HP);
    expect(PILE).toBeGreaterThan(VICTIM_HP);
    const victimUid = benchTopUid(state, "p2", 0);
    const prizesBefore = state.players.p1.prizes.length;
    const first = declare(state, CHOSEN_INDEX);
    const done = mustApply(first.state, pick(P2_BENCH_0));
    expect(findAll(done.events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([victimUid]);
    expect(done.state.players.p2.bench).toHaveLength(0);
    // §8.1 — the prize is OWED, then taken by its own action. Driving it out is
    // what makes this a KO rather than a body that merely left the board.
    expect(done.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const taken = mustApply(done.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(taken.state.players.p1.prizes.length).toBe(prizesBefore - 1);
  });
});

describe("the wire belt — every offer is the legality rule", () => {
  it("refuses a source pick that is not on the controller's Bench", () => {
    let state = bench(board(), "p1", [
      { id: "fix-titan", damage: PILE },
      { id: "fix-titan", damage: OTHER_PILE },
    ]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const parked = declare(state, CHOSEN_INDEX).state;
    // The controller's own ACTIVE — a real Pokémon, on the right seat, in the
    // wrong zone. The printed source is "1 of your BENCHED Pokémon".
    expectErr(parked, pick(P1_ACTIVE), "BAD_EFFECT_CHOICE");
    // The opponent's board, which is question TWO's candidate set and not this
    // one's — the two prompts must not leak into each other.
    expectErr(parked, pick(P2_BENCH_0), "BAD_EFFECT_CHOICE");
  });

  it("refuses a destination pick on the controller's own board", () => {
    let state = bench(board(), "p1", [{ id: "fix-titan", damage: PILE }]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }]);
    const parked = declare(state, CHOSEN_INDEX).state;
    // A build that offered `oppAnyRefs` and then applied the answer against the
    // CONTROLLER's side would move counters from one of your own bodies to
    // another; the offer is what stops it, and this is that offer being the rule.
    expectErr(parked, pick(P1_BENCH_0), "BAD_EFFECT_CHOICE");
    expectErr(parked, pick(P1_ACTIVE), "BAD_EFFECT_CHOICE");
  });
});

describe("D138's op is UNCHANGED by the refactor that generalized its mover", () => {
  it("still parks once and still lands on the DEFENDER, whatever the opponent's Bench holds", () => {
    // Both ops now share one write site (`moveCountersFromBench`), so the fixed
    // destination has to be re-driven or the sharing could quietly re-aim it. The
    // opponent's Bench is POPULATED here on purpose: that is the board on which a
    // leak would be visible.
    let state = bench(board(), "p1", [
      { id: "fix-titan", damage: PILE },
      { id: "fix-titan", damage: OTHER_PILE },
    ]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const first = declare(state, FIXED_INDEX);
    expect(promptOf(first.state)).toMatchObject({ candidates: [P1_BENCH_0, P1_BENCH_1] });
    // ⚠️ AND ITS NOTE PROMISES NO SECOND QUESTION, because it has none.
    expect(promptOf(first.state).note).not.toContain("You will then choose");
    const done = mustApply(first.state, pick(P1_BENCH_0));
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p2.active?.damage).toBe(PILE);
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
    expect(done.state.players.p2.bench[1]?.damage).toBe(0);
  });
});
