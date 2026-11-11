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
  findEvents,
} from "./testFixtures";

/** The printed sentence, verbatim off the remote D1. */
const CLAUSE =
  "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";

const FIXED_CLAUSE =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";

/** The op, FIELD-LESS as derived: `fromBench` is the interpreter's answer to the
    first question and never appears in a derived program. */
const CHOSEN_OP = { op: "moveCountersChosen" } as const;

const FAMILY = [
  { surface: "attack:Extended Damagriiigus", ids: ["sv10.5w-040", "sv10.5w-123"], built: true },
  { surface: "ability:Adrena-Brain", ids: ["sv06-095", "sv06.5-072", "sv08.5-044"], built: true },
  { surface: "ability:Rocket Brain", ids: ["sv10-089", "sv10-198"], built: true },
  { surface: "attack:Strange Hacking", ids: ["sv06-082"], built: true },
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

function board(): GameState {
  let state = driveSetup(
    11,
    { p1: COUNTER_MOVE_CHOSEN_DECK, p2: COUNTER_MOVE_CHOSEN_DECK },
    {
      first: "p2",
    },
  );
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
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
}

function contOf(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.cont;
}

describe("the census — re-derived, per surface, both scopes", () => {
  it("is FOUR surfaces / EIGHT Standard-legal printings, and this slice builds ONE", () => {
    expect(FAMILY).toHaveLength(4);
    expect(FAMILY.flatMap((row) => row.ids)).toHaveLength(8);
    expect(new Set(FAMILY.flatMap((row) => row.ids)).size).toBe(8);
    const built = FAMILY.filter((row) => row.built);
    expect(built).toHaveLength(4);
    expect(built.flatMap((row) => row.ids)).toEqual([
      "sv10.5w-040",
      "sv10.5w-123",
      "sv06-095",
      "sv06.5-072",
      "sv08.5-044",
      "sv10-089",
      "sv10-198",
      "sv06-082",
    ]);
    expect(programFor("sv06-095")?.abilities?.[0]?.program).toEqual([
      { op: "moveCountersToOpponentChosen", upTo: 3 },
    ]);
    expect(programFor("sv10-089")?.abilities?.[0]?.program).toEqual([
      { op: "moveCounterOwnChosen", ownerPokemon: "Team Rocket" },
    ]);
    expect(FAMILY.filter((row) => !row.built).flatMap((row) => row.ids)).toHaveLength(0);
  });
});

describe("the anchor — one clause, one regex, NO capture", () => {
  it("derives the printed clause to a FIELD-LESS op", () => {
    expect(deriveAttackEffect(CLAUSE)).toEqual([CHOSEN_OP]);
    const ops = deriveAttackEffect(CLAUSE);
    expect(ops).toHaveLength(1);
    expect(Object.keys(ops?.[0] as object)).toEqual(["op"]);
  });

  it("is DISJOINT from D138's anchor in both directions", () => {
    expect(deriveAttackEffect(FIXED_CLAUSE)).toEqual([{ op: "moveCountersToDefender" }]);
    expect(deriveAttackEffect(FIXED_CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersChosen" }),
    );
    expect(deriveAttackEffect(CLAUSE)).not.toContainEqual(
      expect.objectContaining({ op: "moveCountersToDefender" }),
    );
    expect(
      deriveAttackEffect(
        "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.",
      ),
    ).toEqual([{ op: "moveCountersToDefender", ownerPokemon: "Team Rocket" }]);
  });

  it("refuses the rewrites — including the possessive this anchor deliberately has NO capture for", () => {
    for (const text of [
      "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to 1 of your opponent's Pokémon.",
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
    expect(findEvents(first.events, "HEALED")).toHaveLength(0);
    expect(findEvents(first.events, "COUNTERS_PLACED")).toHaveLength(0);
    // …and the parked op has NO answer on it yet.
    expect(contOf(first.state).pendingOp).toEqual(CHOSEN_OP);

    // QUESTION TWO — the OPPONENT's whole board, Active included.
    const second = mustApply(first.state, pick(P1_BENCH_0));
    const destPrompt = promptOf(second.state);
    expect(destPrompt.kind).toBe("choosePokemon");
    expect(destPrompt).toMatchObject({ candidates: [P2_ACTIVE, P2_BENCH_0, P2_BENCH_1] });
    expect(destPrompt.note).toContain("opponent");
    expect(contOf(second.state).pendingOp).toEqual({ ...CHOSEN_OP, fromBench: 0 });

    // …and the landing.
    const third = mustApply(second.state, pick(P2_BENCH_1));
    expect(third.state.phase.kind).not.toBe("effect:choose");
    expect(third.state.players.p1.bench[0]?.damage).toBe(0);
    expect(third.state.players.p1.bench[1]?.damage).toBe(OTHER_PILE);
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
    const healed = findEvents(done.events, "HEALED");
    const placed = findEvents(done.events, "COUNTERS_PLACED");
    expect(healed).toHaveLength(1);
    expect(placed).toHaveLength(1);
    // The equality IS the printed verb; two different numbers would be a heal and
    // a snipe wearing one sentence.
    expect(healed[0]?.amount).toBe(PILE);
    expect(placed[0]?.amount).toBe(PILE);
    expect(healed[0]).toMatchObject({ seat: "p1", uid: sourceUid });
    expect(placed[0]).toMatchObject({ seat: "p2", uid: destUid, source: "moved" });
  });
});

describe("the four endings of two questions", () => {
  it("a FORCED source still asks the destination — the ending that could not exist before", () => {
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
    expect(findEvents(done.events, "COUNTERS_PLACED")).toHaveLength(1);
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
    expect(findEvents(done.events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(findEvents(done.events, "HEALED")).toHaveLength(0);
    expect(findEvents(done.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    // The control — an attack on this body CAN resolve visibly, so "nothing
    // happened" above is the sentence's doing and not a refused declaration.
    const ping = declare(bench(board(), "p2", [{ id: "fix-bigbody" }]), PING_INDEX);
    expect(findEvents(ping.events, "DAMAGE_DEALT")).toHaveLength(1);
  });
});

describe("the whiff — an undamaged source costs no second question", () => {
  it("a FORCED undamaged source resolves with no prompt and no rows", () => {
    let state = bench(board(), "p1", [{ id: "fix-titan", damage: 0 }]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const done = declare(state, CHOSEN_INDEX);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(findEvents(done.events, "HEALED")).toHaveLength(0);
    expect(findEvents(done.events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("a CHOSEN undamaged source still parks ONCE, then stops", () => {
    let state = bench(board(), "p1", [
      { id: "fix-titan", damage: 0 },
      { id: "fix-titan", damage: 0 },
    ]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const first = declare(state, CHOSEN_INDEX);
    expect(promptOf(first.state)).toMatchObject({ candidates: [P1_BENCH_0, P1_BENCH_1] });
    const done = mustApply(first.state, pick(P1_BENCH_1));
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(findEvents(done.events, "COUNTERS_PLACED")).toHaveLength(0);
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
    expect(done.state.players.p1.bench[0]?.damage).toBe(PILE);
    expect(findEvents(done.events, "HEALED")).toHaveLength(0);
    expect(findEvents(done.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("LANDS on a BENCHED destination on the SAME board — the gate is not asked there", () => {
    const first = declare(blockedBoard(), CHOSEN_INDEX);
    const done = mustApply(first.state, pick(P2_BENCH_0));
    expect(done.state.players.p2.bench[0]?.damage).toBe(PILE);
    expect(done.state.players.p1.bench[0]?.damage).toBe(0);
    expect(findEvents(done.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });
});

describe("the epilogue still sweeps — a moved pile can KO a CHOSEN benched body", () => {
  it("KOs the picked Bench Pokémon and awards the prize", () => {
    let state = bench(board(), "p1", [{ id: "fix-titan", damage: PILE }]);
    state = bench(state, "p2", [{ id: "fix-victim" }]);
    expect(FIXTURE_POOL["fix-victim"]?.hp).toBe(VICTIM_HP);
    expect(PILE).toBeGreaterThan(VICTIM_HP);
    const victimUid = benchTopUid(state, "p2", 0);
    const prizesBefore = state.players.p1.prizes.length;
    const first = declare(state, CHOSEN_INDEX);
    const done = mustApply(first.state, pick(P2_BENCH_0));
    expect(findEvents(done.events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([victimUid]);
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
    let state = bench(board(), "p1", [
      { id: "fix-titan", damage: PILE },
      { id: "fix-titan", damage: OTHER_PILE },
    ]);
    state = bench(state, "p2", [{ id: "fix-bigbody" }, { id: "fix-bigbody" }]);
    const first = declare(state, FIXED_INDEX);
    expect(promptOf(first.state)).toMatchObject({ candidates: [P1_BENCH_0, P1_BENCH_1] });
    expect(promptOf(first.state).note).not.toContain("You will then choose");
    const done = mustApply(first.state, pick(P1_BENCH_0));
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p2.active?.damage).toBe(PILE);
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
    expect(done.state.players.p2.bench[1]?.damage).toBe(0);
  });
});
