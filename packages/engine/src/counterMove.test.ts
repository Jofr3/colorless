import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
// `applyAction` is imported as a TYPE only: the illegal-choice case builds a
// deliberately malformed action and casts it through `Parameters<typeof applyAction>[1]`
// so the cast is anchored on the real signature rather than on `any`.
import type { GameEvent, GameState, PokemonRef, Seat, applyAction } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  COUNTER_MOVE_DECK,
  FIXTURE_POOL,
  activeUid,
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
  setDamage,
  types,
} from "./testFixtures";

const CLAUSE =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";

const SCALED_PILE_TWIN =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";

const MOVE_OP = { op: "moveCountersToDefender" } as const;

const CENSUS_IDS = ["sv02-093", "sv02-239"] as const;

const REAL_NEAR_MISSES = [
  "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.",
  "As often as you like during your turn, you may move 1 damage counter from 1 of your other Pokémon to this Pokémon.",
  "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.",
  "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
] as const;

const RSQUO = "\u2019";

/** U+00A0, likewise an escape. Byte-different from an ASCII space and INVISIBLE in
    a diff, which is exactly why the case names it instead of carrying it. */
const NBSP = "\u00a0";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `choosePokemon` prompt, narrowed — a state that did NOT park fails
    here with the reason rather than three lines later on an undefined. */
function choosePrompt(state: GameState): { candidates: PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

/** Dedenne ex prints the move FIRST and a big damaging attack second. Named rather
    than inlined, so a re-ingest that reordered the attacks fails on the fixture
    guards below rather than silently moving every case onto the wrong sentence. */
const TAIL_SWAP_INDEX = 0;
const WONDROUS_SHOT_INDEX = 1;
const WONDROUS_SHOT_DAMAGE = 170;

/** The benched pile the move carries. Chosen so that no single figure in this file
    can be confused with another: it is not the defender's HP, not a printed damage,
    and not a round multiple of anything the epilogue computes. */
const BENCH_HURT = 80;

/** A SECOND pile, on the body a case declines. Different from BENCH_HURT so a build
    that moved "whatever was on the Bench" rather than "the pick's counters" reads
    the wrong number rather than the right one by luck. */
const OTHER_BENCH_HURT = 30;

/** The defender's damage BEFORE the move, on the boards that measure an addition
    rather than a KO — so the assertion is `before + moved` and not just `moved`. */
const DEFENDER_HURT = 40;

/** fix-titan is 340 HP: 300 + BENCH_HURT is 380, so the moved pile is what tips it
    over. Written as the HP minus a margin the move covers, not as a magic number. */
const TITAN_HP = 340;
const DEFENDER_NEARLY_DEAD = 300;

const WEAK_DEFENDER_HP = 200;

const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P1_BENCH_0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };
const P1_BENCH_1: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 1 } };
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };

function board(): GameState {
  let state = driveSetup(7, { p1: COUNTER_MOVE_DECK, p2: COUNTER_MOVE_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Field Dedenne ex as `seat`'s Active with `energy` {P} paid, on a freshly emptied
    Bench. Two pays "Tail Swap"; three pays "Wondrous Shot". It is a Basic, so the
    surgery is a convenience rather than a necessity — the bench clear is not. */
function dedenneActive(state: GameState, seat: Seat, energy = 2): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-093"), seat),
    seat,
    "fix-psychic-energy",
    energy,
  );
}

/** Bench one titan per entry on `seat` and set each one's damage. fix-titan's 340
    HP carries any pile a case wants without the epilogue's KO sweep removing a
    candidate from under the assertion. */
function benchTitans(state: GameState, seat: Seat, damages: number[]): GameState {
  let next = state;
  for (const damage of damages) {
    next = benchFromDeck(next, seat, "fix-titan");
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, damage);
  }
  return next;
}

/** Declare `index` on `seat`, freezing the prior state first — the purity check
    every neighbouring suite runs, hoisted here because this file drives a dozen. */
function declare(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat, index });
}

/** The one answer every parked case gives, as an action. */
function pick(ref: PokemonRef, seat: Seat = "p1") {
  return { type: "resolveEffect", seat, choice: { kind: "pokemon", ref } } as const;
}

describe("the anchor — 2 printings, 1 clause, one regex with NO capture", () => {
  it("derives the ONE printed clause to a FIELD-LESS op", () => {
    expect(deriveAttackEffect(CLAUSE)).toEqual([MOVE_OP]);
    const ops = deriveAttackEffect(CLAUSE);
    expect(ops).toHaveLength(1);
    expect(Object.keys(ops?.[0] as object)).toEqual(["op"]);
    expect(CENSUS_IDS).toHaveLength(2);
    expect(new Set(CENSUS_IDS).size).toBe(2);
  });

  it("is NOT a healChosen, in both directions — the neighbouring anchor's shape", () => {
    expect(deriveAttackEffect(CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "healChosen" }),
    );
    // …and the sentence whose candidate set this one borrows still derives ITS own
    // op. Both anchors are `^…$` on a differing FIRST WORD, so no ordering of the
    // arms can matter.
    expect(deriveAttackEffect("Heal 60 damage from 1 of your Benched Pokémon.")).toEqual([
      { op: "healChosen", amount: 60, zone: "bench" },
    ]);
    expect(deriveAttackEffect("Heal 60 damage from 1 of your Benched Pokémon.")).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
  });

  it("refuses the FOUR real catalog rows that share its words", () => {
    for (const text of REAL_NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackEffect(REAL_NEAR_MISSES[0])).toBeNull();
    expect(deriveAttackEffect(REAL_NEAR_MISSES[1])).toBeNull();
    for (const hp of [
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
    ]) {
      expect(deriveAttackEffect(hp)?.[0]?.op, hp).toBe("counterUntilRemainingHp");
      expect(deriveAttackEffect(hp), hp).not.toEqual(deriveAttackEffect(CLAUSE));
    }
    expect(
      deriveAttackEffect(
        "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Put 3 damage counters on each of your opponent's Benched Pokémon that has any damage counters on it.",
      ),
    ).toBeNull();
    // …and the sentence that LEFT this list now derives, which is what makes the
    // re-point a fact rather than a bookkeeping preference.
    expect(
      deriveAttackEffect("Put 2 damage counters on 1 of your opponent's Benched Pokémon."),
    ).not.toBeNull();
    expect(deriveAttackEffect(SCALED_PILE_TWIN)).not.toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(SCALED_PILE_TWIN)?.map((o) => o.op)).toEqual([
      "damageChosen",
      "discardPileRetrieval",
      "shuffleDeck",
    ]);
    expect(deriveAttackEffect(CLAUSE)?.[0]?.op).toBe("moveCountersToDefender");
    expect(REAL_NEAR_MISSES).toHaveLength(4);
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path — Munkidori's and Slowbro's "move" are both lowercase and both mid
      // sentence — and the reason no /i flag is on this regex.
      "move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      "Move 3 damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      "Move up to 3 damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      // THE SOURCE ZONE. "Benched" is the printed word and the whole reason the
      // candidate set excludes the attacker; dropping it is Munkidori's source and
      // would silently offer the Active.
      "Move all damage counters from 1 of your Pokémon to your opponent's Active Pokémon.",
      // THE COUNT. "1" is the printed quantifier; "2 of your Benched Pokémon" is a
      // multi-pick this op cannot express and must not narrow to one.
      "Move all damage counters from 2 of your Benched Pokémon to your opponent's Active Pokémon.",
      // THE DESTINATION, reversed and re-aimed. Both are real readings elsewhere in
      // the pool and neither is this one.
      "Move all damage counters from 1 of your Benched Pokémon to your Active Pokémon.",
      "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Benched Pokémon.",
      // THE SEAT, swapped at the source. "1 of your opponent's Benched Pokémon" is a
      // sentence that would move THEIR damage onto THEIR Active — nonsense the
      // engine must not invent.
      "Move all damage counters from 1 of your opponent's Benched Pokémon to your opponent's Active Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed. Spelled as an ESCAPE, not
      // typed: it is byte-different from a space and INVISIBLE in a diff.
      `Move${NBSP}all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Move  all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      "Flip a coin. If heads, move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon. This Pokémon is now Asleep.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${CLAUSE}\n`)).toEqual([MOVE_OP]);
  });

  it("derives the CURLY apostrophe identically — D137's class, not D137's fold", () => {
    const curly = CLAUSE.replaceAll("'", RSQUO);
    expect(curly).not.toBe(CLAUSE);
    expect(curly).toContain(RSQUO);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(CLAUSE));
    expect(deriveAttackEffect(curly)).toEqual([MOVE_OP]);
  });
});

describe("the fixture's printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Dedenne ex sv02-093 — and it is TAIL SWAP", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here.
    const tailSwap = FIXTURE_POOL["sv02-093"]?.attacks?.[TAIL_SWAP_INDEX];
    expect(tailSwap).toEqual({
      cost: ["Psychic", "Psychic"],
      name: "Tail Swap",
      effect: CLAUSE,
    });
    expect(tailSwap?.name).not.toBe("Dedechange");
    expect(tailSwap?.damage).toBeUndefined();
    expect(deriveAttackEffect(tailSwap?.effect ?? "")).toEqual([MOVE_OP]);
    expect(FIXTURE_POOL["sv02-093"]?.name).toBe("Dedenne ex");
    expect(FIXTURE_POOL["sv02-093"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-093"]?.hp).toBe(170);
    expect(FIXTURE_POOL["sv02-093"]?.abilities).toBeNull();
  });

  it("carries a control read by a DIFFERENT arm of the SAME deriver at index 1", () => {
    const wondrousShot = FIXTURE_POOL["sv02-093"]?.attacks?.[WONDROUS_SHOT_INDEX];
    expect(wondrousShot).toEqual({
      cost: ["Psychic", "Psychic", "Psychic"],
      name: "Wondrous Shot",
      damage: WONDROUS_SHOT_DAMAGE,
      effect: "Discard an Energy from this Pokémon.",
    });
    expect(deriveAttackEffect(wondrousShot?.effect ?? "")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(deriveAttackEffect(wondrousShot?.effect ?? "")).not.toEqual(deriveAttackEffect(CLAUSE));
  });

  it("costs ZERO registry rows — both printings simulate off their printed text", () => {
    for (const id of CENSUS_IDS) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
    expect(programFor("sv02-093")).toBeUndefined();
    expect(programFor("sv02-239")).toBeUndefined();
  });
});

describe("end to end — the park, and the two halves of one move", () => {
  it("PARKS on a two-body Bench — and the attack epilogue WAITS behind the question", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_HURT);
    const { state: parked, events } = declare(state, TAIL_SWAP_INDEX);

    expect(types(events)).toContain("EFFECT_PENDING");
    expect(find(events, "EFFECT_PENDING")?.seat).toBe("p1");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides
    expect(parked.phase.resumeTail).toBe(true);
    expect(parked.phase.cont.ctx.sourceUid).toBe(find(events, "ATTACK_DECLARED")?.uid);

    // THE CANDIDATE SET IS THE BENCH AND NOTHING ELSE — the printed word "Benched",
    // and the attacker is standing right there with two Energy on it.
    const prompt = choosePrompt(parked);
    expect(prompt.candidates).toEqual([P1_BENCH_0, P1_BENCH_1]);
    expect(prompt.candidates).not.toContainEqual(P1_ACTIVE);
    expect(prompt.note).toBe("Move the damage counters off which of your Benched Pokémon?");

    // NOTHING HAS MOVED YET, on EITHER board — which is the half a one-sided build
    // gets right by accident. And no turn end: the epilogue is QUEUED, so the §8.1
    // KO sweep and §5.3's turn end are still ahead of the answer.
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(types(events)).not.toContain("TURN_ENDED");
    expect(parked.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: find(events, "ATTACK_DECLARED")?.uid,
        attack: find(events, "ATTACK_DECLARED")?.attack,
      },
    ]);
    expect(parked.players.p1.bench[0]?.damage).toBe(BENCH_HURT);
    expect(parked.players.p2.active?.damage).toBe(DEFENDER_HURT);
    // No printed damage anywhere: the move is the whole declaration.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("moves ONE pile ACROSS the seat boundary — the same number off and on", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_HURT);
    const source = benchTopUid(state, "p1", 0);
    const defender = activeUid(state, "p2");
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    deepFreeze(parked);

    const { state: done, events } = mustApply(parked, pick(P1_BENCH_0));

    const healed = all(events, "HEALED");
    const placed = all(events, "COUNTERS_PLACED");
    expect(healed).toEqual([{ type: "HEALED", seat: "p1", uid: source, amount: BENCH_HURT }]);
    expect(placed).toEqual([
      { type: "COUNTERS_PLACED", seat: "p2", uid: defender, amount: BENCH_HURT, source: "moved" },
    ]);
    expect(healed[0]?.amount).toBe(placed[0]?.amount);

    // The BOARD, on both sides: the source is at exactly zero (the printed word is
    // "all"), the defender carries what it had PLUS the pile.
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT + BENCH_HURT);
    // ONE pick: the other benched body keeps every point, and the attacker — which
    // was never a candidate — is untouched.
    expect(done.players.p1.bench[1]?.damage).toBe(OTHER_BENCH_HURT);
    expect(done.players.p1.active?.damage).toBe(0);

    expect(types(events)).toEqual([
      "HEALED",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("FORCES a single benched body — one action, no prompt at all", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const source = benchTopUid(state, "p1", 0);
    const defender = activeUid(state, "p2");
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "HEALED",
      "COUNTERS_PLACED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: source,
      amount: BENCH_HURT,
    });
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: defender,
      amount: BENCH_HURT,
      source: "moved",
    });
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p2.active?.damage).toBe(BENCH_HURT);
    expect(done.pending).toEqual([]);
  });

  it("WHIFFS SILENTLY on an EMPTY Bench — no park, no rows, and still SIMULATED", () => {
    let state = dedenneActive(board(), "p1");
    state = setDamage(state, "p2", DEFENDER_HURT);
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
    // THE DEFENDER IS UNTOUCHED, which is the half that matters here: an empty Bench
    // must not be read as "move nothing, but place something anyway".
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual(["ATTACK_DECLARED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("OFFERS an UNDAMAGED body, and picking it moves NOTHING — silently", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [0, BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_HURT);
    const { state: parked, events: attackEvents } = declare(state, TAIL_SWAP_INDEX);
    expect(choosePrompt(parked).candidates).toEqual([P1_BENCH_0, P1_BENCH_1]);
    expect(types(attackEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");

    const { state: done, events } = mustApply(parked, pick(P1_BENCH_0));
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
    // The DAMAGED body it declined keeps its pile — the whiff took the PICK, not
    // "whatever was movable".
    expect(done.players.p1.bench[1]?.damage).toBe(BENCH_HURT);
    expect(done.players.p2.active?.damage).toBe(DEFENDER_HURT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });

  it("REJECTS every illegal pick — the Active, the opponent's board, an index past the end", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    state = benchTitans(state, "p2", [OTHER_BENCH_HURT]);
    state = setDamage(state, "p1", 0);
    state = benchTitans(state, "p1", [OTHER_BENCH_HURT]);
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    const resolve = (choice: unknown) =>
      ({ type: "resolveEffect", seat: "p1", choice }) as Parameters<typeof applyAction>[1];

    expectErr(parked, resolve({ kind: "pokemon", ref: P1_ACTIVE }), "BAD_EFFECT_CHOICE");
    // THE OPPONENT'S BENCH — a real Pokémon, damaged, on the wrong side. A build that
    // dropped the seat check would move THEIR counters onto THEIR Active.
    expectErr(
      parked,
      resolve({ kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } }),
      "BAD_EFFECT_CHOICE",
    );
    expectErr(parked, resolve({ kind: "pokemon", ref: P2_ACTIVE }), "BAD_EFFECT_CHOICE");
    // AN INDEX PAST THE END — p1 has exactly two benched bodies, so index 2 names
    // nothing.
    expectErr(
      parked,
      resolve({ kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 2 } } }),
      "BAD_EFFECT_CHOICE",
    );
    // And the multi-pick shape does not answer a single prompt.
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [P1_BENCH_0] }), "BAD_EFFECT_CHOICE");
    // A rejection leaves the park exactly where it was — the question is still open.
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("consumes NO rng across the WHOLE resolution — park and resolve alike", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    expect(parked.rngState).toBe(state.rngState);
    const { state: done } = mustApply(parked, pick(P1_BENCH_0));
    expect(done.rngState).toBe(state.rngState);
  });

  it("the parked state survives a JSON round-trip and resolves identically (D14)", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    const rehydrated = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(rehydrated).toEqual(parked);
    const a = mustApply(parked, pick(P1_BENCH_1));
    const b = mustApply(rehydrated, pick(P1_BENCH_1));
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });
});

describe("the destination half — a MOVED counter is not attack damage", () => {
  it("skips WEAKNESS entirely — a ×2 Psychic defender takes what came off the Bench", () => {
    let state = dedenneActive(board(), "p1");
    state = setActiveFromDeck(state, "p2", "fix-psychic-weak-big");
    state = clearBench(state, "p2");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const defender = activeUid(state, "p2");
    expect(FIXTURE_POOL["fix-psychic-weak-big"]?.weaknesses).toEqual([
      { type: "Psychic", value: "×2" },
    ]);
    expect(FIXTURE_POOL["sv02-093"]?.types).toEqual(["Psychic"]);

    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: defender,
      amount: BENCH_HURT,
      source: "moved",
    });
    expect(done.players.p2.active?.damage).toBe(BENCH_HURT);
    expect(done.players.p2.active?.damage).not.toBe(BENCH_HURT * 2);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    // …and the body survives both readings, so this case measures the amount and
    // never a promotion.
    expect(WEAK_DEFENDER_HP).toBeGreaterThan(BENCH_HURT * 2);
    expect(FIXTURE_POOL["fix-psychic-weak-big"]?.hp).toBe(WEAK_DEFENDER_HP);
  });

  it("runs from the OTHER SEAT too — the rows are seat-derived, not hardcoded", () => {
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = dedenneActive(state, "p2");
    state = benchTitans(state, "p2", [BENCH_HURT]);
    state = setDamage(state, "p1", DEFENDER_HURT);
    const source = benchTopUid(state, "p2", 0);
    const defender = activeUid(state, "p1");
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX, "p2");

    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p2",
      uid: source,
      amount: BENCH_HURT,
    });
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p1",
      uid: defender,
      amount: BENCH_HURT,
      source: "moved",
    });
    expect(done.players.p2.bench[0]?.damage).toBe(0);
    expect(done.players.p1.active?.damage).toBe(DEFENDER_HURT + BENCH_HURT);
  });
});

describe("the KNOCK OUT the move can cause — the epilogue sweep, from both endings", () => {
  it("KOs the defender through a PARK — prize to the ATTACKER, and the turn ends last", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT, OTHER_BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_NEARLY_DEAD);
    state = benchTitans(state, "p2", [0]); // somebody to promote into
    const defender = activeUid(state, "p2");
    const { state: parked } = declare(state, TAIL_SWAP_INDEX);
    // The KO has NOT happened at the park — the pile is still on p1's Bench, so a
    // build that resolved the placement at declaration would already have swept it.
    expect(parked.players.p2.active?.damage).toBe(DEFENDER_NEARLY_DEAD);
    expect(parked.players.p1.bench[0]?.damage).toBe(BENCH_HURT);

    const { state: done, events } = mustApply(parked, pick(P1_BENCH_0));

    expect(DEFENDER_NEARLY_DEAD + BENCH_HURT).toBeGreaterThanOrEqual(TITAN_HP);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: defender });
    const order = types(events);
    expect(order).toEqual(["HEALED", "COUNTERS_PLACED", "KNOCKED_OUT", "PRIZES_OWED"]);
    expect(find(events, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // …and the turn has NOT ended: the prize pick and the opponent's promotion are
    // both still in front of §5.3's tail, which is exactly the queue `resumeTail`
    // preserved across the move's own question.
    expect(order).not.toContain("TURN_ENDED");
  });

  it("KOs the defender INLINE too — the forced ending reaches the same sweep", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    state = setDamage(state, "p2", DEFENDER_NEARLY_DEAD);
    state = benchTitans(state, "p2", [0]);
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "HEALED",
      "COUNTERS_PLACED",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
    expect(find(events, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // The source body is still at zero on the far side of a KO sweep — the removal
    // half is not undone by the board changing under it.
    expect(done.players.p1.bench[0]?.damage).toBe(0);
  });
});

describe("the log — two rows that read as one move", () => {
  it("renders the placement as a SYSTEM row, not in the victim's voice", () => {
    let state = dedenneActive(board(), "p1");
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const { state: done, events } = declare(state, TAIL_SWAP_INDEX);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: done, elapsed: "+00:11" };
    const rendered = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
    );

    const placedIndex = rendered.findIndex((r) => r.text.startsWith("Moved:"));
    const healedIndex = rendered.findIndex((r) => r.text.includes("healed"));
    expect(placedIndex).toBeGreaterThanOrEqual(0);
    expect(healedIndex).toBeGreaterThanOrEqual(0);
    const placed = rendered[placedIndex];
    const healed = rendered[healedIndex];
    expect(placed?.who).toBe("system");
    expect(placed?.text).toContain(String(BENCH_HURT));
    expect(healed?.who).toBe("p1");
    expect(healed?.text).toContain(String(BENCH_HURT));
    expect(healedIndex).toBeLessThan(placedIndex);
    expect(placed?.text).not.toContain("Ability");
  });
});
