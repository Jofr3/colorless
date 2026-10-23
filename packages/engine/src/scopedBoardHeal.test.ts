import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, programFor } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SCOPED_HEAL_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setBenchDamage,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

const BASIC_TEXT = "Heal 100 damage from each of your Basic Pokémon.";
const BENCH_TEXT = "Heal 100 damage from each of your Benched Pokémon.";
const BARE_TEXT = "Heal 30 damage from each of your Pokémon.";
const BARE_TEXT_UNPRINTED = "Heal 100 damage from each of your Pokémon.";
const ANCIENT_TEXT = "Heal 100 damage from 1 of your Benched Ancient Pokémon.";

/** The two attack indices on both `fix-scopedheal` bodies, in printed order. */
const BASIC_SALVE = 0;
const BENCH_SALVE = 1;

const HEAL = 100;
const ACTIVE_HURT = 250;
const BASIC_BENCH_HURT = 200;
const EVO_BENCH_HURT = 180;
/** LESS than the printed heal — the clamped body. */
const CLAMPED = 40;
/** The opponent's damage, on a board that must come back UNCHANGED. */
const OPPONENT_HURT = 70;

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function board(): GameState {
  const state = driveSetup(
    7,
    { p1: SCOPED_HEAL_DECK, p2: SCOPED_HEAL_DECK },
    { first: "p2", active: { p1: "fix-titan", p2: "fix-titan" } },
  );
  const opened = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return clearBench(clearBench(opened, "p1"), "p2");
}

function attacker(state: GameState, seat: Seat, id: string, damage: number): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, id), seat),
    seat,
    "fix-energy",
    2,
  );
  return setDamage(fielded, seat, damage);
}

/** Bench `bodies.length` cards on `seat`, in order, each with its own damage. */
function benchBodies(state: GameState, seat: Seat, bodies: [string, number][]): GameState {
  let next = state;
  for (const [id, damage] of bodies) {
    next = benchFromDeck(next, seat, id);
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, damage);
  }
  return next;
}

function threeBodies(): GameState {
  return benchBodies(attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT), "p1", [
    ["fix-titan", BASIC_BENCH_HURT],
    ["fix-scopedheal-evo", EVO_BENCH_HURT],
  ]);
}

describe("§1 — the two anchors, the corpus, and the disjointness", () => {
  it("both sentences are CORPUS rows at the printed counts, and both were UNBUILT", () => {
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(BASIC_TEXT)).toBe(2);
    expect(corpus.get(BENCH_TEXT)).toBe(2);
    expect(corpus.get(BARE_TEXT)).toBe(3);
    // …and the bare sentence at THIS family's amount is not printed at all, which is
    // why the narrowing has no same-N twin to be compared against on a board.
    expect(corpus.get(BARE_TEXT_UNPRINTED)).toBeUndefined();
    expect(deriveAttackEffect(BARE_TEXT_UNPRINTED)).toEqual([{ op: "healEach", amount: HEAL }]);
    expect([BASIC_TEXT, BENCH_TEXT].length).toBe(2);
    expect((corpus.get(BASIC_TEXT) ?? 0) + (corpus.get(BENCH_TEXT) ?? 0)).toBe(4);
  });

  it("THE FAMILY IS CLOSED AT TWO ADJECTIVES, measured over all 640 corpus rows", () => {
    const loose = /^Heal (\d+) damage from each of your (.+) Pokémon\.$/;
    const hits = legalAttackCorpus()
      .filter(([, text]) => loose.test(text))
      .map(([units, text]) => [text, units] as const);
    expect(hits).toEqual([
      [BASIC_TEXT, 2],
      [BENCH_TEXT, 2],
    ]);
    const family = legalAttackCorpus().filter(([, text]) =>
      /[Hh]eal .* from (each|\d+|all|any) of your/.test(text),
    );
    expect(family).toHaveLength(9);
    expect(family.filter(([, text]) => !resolvedByAnyReader(text)).map(([, t]) => t)).toEqual([
      ANCIENT_TEXT,
    ]);
    for (const text of [BASIC_TEXT, BENCH_TEXT]) expect(resolvedByAnyReader(text)).toBe(true);
  });

  it("derives each sentence to ONE `healEach` differing from the bare one by ONE KEY", () => {
    expect(deriveAttackEffect(BASIC_TEXT)).toEqual([
      { op: "healEach", amount: HEAL, basicOnly: true },
    ]);
    expect(deriveAttackEffect(BENCH_TEXT)).toEqual([
      { op: "healEach", amount: HEAL, benchOnly: true },
    ]);
    expect(deriveAttackEffect(BARE_TEXT)).toEqual([{ op: "healEach", amount: 30 }]);
    const keysOf = (text: string) => Object.keys(deriveAttackEffect(text)?.[0] ?? {}).sort();
    expect(keysOf(BARE_TEXT)).toEqual(["amount", "op"]);
    expect(keysOf(BASIC_TEXT)).toEqual(["amount", "basicOnly", "op"]);
    expect(keysOf(BENCH_TEXT)).toEqual(["amount", "benchOnly", "op"]);
  });

  it("the two anchors are DISJOINT — neither can claim the other's text", () => {
    const narrowed = /^Heal (\d+) damage from each of your ((?!opponent)[^.]+) Pokémon\.$/;
    const bare = /^Heal (\d+) damage from each of your Pokémon\.$/;
    expect(narrowed.test(BARE_TEXT)).toBe(false);
    expect(bare.test(BASIC_TEXT)).toBe(false);
    expect(bare.test(BENCH_TEXT)).toBe(false);
    // And the derived values differ, which is the same claim from the value side: a
    // build that collapsed the two anchors would pass every one-Basic board.
    expect(deriveAttackEffect(BASIC_TEXT)).not.toEqual(deriveAttackEffect(BARE_TEXT));
    expect(deriveAttackEffect(BENCH_TEXT)).not.toEqual(deriveAttackEffect(BARE_TEXT));
  });

  it("REFUSES an adjective the map does not know — the map is the vocabulary", () => {
    for (const text of [
      "Heal 100 damage from each of your Ancient Pokémon.",
      "Heal 100 damage from each of your Tera Pokémon.",
      "Heal 100 damage from each of your Stage 1 Pokémon.",
      "Heal 100 damage from each of your Benched Basic Pokémon.",
      "Heal 100 damage from each of your {L} Pokémon.",
      "Heal 100 damage from each of your Team Rocket's Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("REFUSES the opponent's board — the `(?!opponent)` lookahead, both ways", () => {
    const narrowed = /^Heal (\d+) damage from each of your ((?!opponent)[^.]+) Pokémon\.$/;
    expect(narrowed.test("Heal 100 damage from each of your opponent's Pokémon.")).toBe(false);
    expect(deriveAttackEffect("Heal 100 damage from each of your opponent's Pokémon.")).toBeNull();
    expect(
      deriveAttackEffect("Heal 100 damage from each of your opponent's Benched Pokémon."),
    ).toBeNull();
  });

  it("REFUSES the anchor, punctuation, case and compound rewrites", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Heal 100 damage from each of your Basic Pokémon",
      // A LOWERCASE first word: half of what keeps a mid-sentence clause off this
      // path, and the reason no /i flag is on either regex.
      "heal 100 damage from each of your Basic Pokémon.",
      // "all" for a number: a real printed amount on the neighbouring `healChosen`
      // sentence that `healEach.amount` cannot carry.
      "Heal all damage from each of your Basic Pokémon.",
      "Flip a coin. If heads, heal 100 damage from each of your Basic Pokémon.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for, and
      // the shape the `[^.]+` capture cannot span whatever the `$` did.
      "Heal 100 damage from each of your Basic Pokémon. Then, shuffle your deck.",
      "Heal 100 damage from each of your Benched Pokémon. This Pokémon is now Asleep.",
      "This Pokémon is now Asleep. Heal 100 damage from each of your Basic Pokémon.",
      // The DETERMINER: "1 of your" is `healChosen`'s sentence, a park and a choice.
      "Heal 100 damage from 1 of your Basic Pokémon.",
      // PLURAL DRIFT in the quantifier: "each" is the printed word.
      "Heal 100 damage from all of your Basic Pokémon.",
      // COUNTERS, not HP — a different arithmetic (§12) and off by a factor of ten.
      "Remove 10 damage counters from each of your Basic Pokémon.",
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not.
    expect(deriveAttackEffect("  Heal 100 damage from each of your Benched Pokémon.\n")).toEqual([
      { op: "healEach", amount: HEAL, benchOnly: true },
    ]);
  });

  it("matches FIXTURE_POOL char-for-char on both bodies, at both indices", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned — on BOTH fixtures, because the
    // evolved twin is what drives the attacker-excludes-itself case in §4.
    for (const id of ["fix-scopedheal", "fix-scopedheal-evo"]) {
      const attacks = FIXTURE_POOL[id]?.attacks;
      expect(attacks?.[BASIC_SALVE]).toEqual({
        cost: ["Colorless", "Colorless"],
        name: "Basic Salve",
        effect: BASIC_TEXT,
      });
      expect(attacks?.[BENCH_SALVE]).toEqual({
        cost: ["Colorless", "Colorless"],
        name: "Bench Salve",
        effect: BENCH_TEXT,
      });
      // NO printed `damage` on either, so the heal is the entire visible result.
      expect(attacks?.[BASIC_SALVE]?.damage).toBeUndefined();
      expect(attacks?.[BENCH_SALVE]?.damage).toBeUndefined();
    }
    // The two fixtures differ in STAGE and in nothing else that matters here.
    expect(FIXTURE_POOL["fix-scopedheal"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["fix-scopedheal-evo"]?.stage).toBe("Stage1");
  });
});

describe("§2 — one op, two axes: the shape can say what the catalog does not print", () => {
  it("the CROSSING is expressible by the op and refused by the reader", () => {
    const crossing: EffectOp = { op: "healEach", amount: HEAL, basicOnly: true, benchOnly: true };
    expect(crossing).toEqual({ op: "healEach", amount: HEAL, basicOnly: true, benchOnly: true });
    expect(
      deriveAttackEffect("Heal 100 damage from each of your Benched Basic Pokémon."),
    ).toBeNull();
  });

  it("ABSENT means UNNARROWED on both riders, and not `false`", () => {
    const blessedSalt = programFor("sv02-123")?.triggered?.[0]?.program?.[0];
    expect(blessedSalt).toMatchObject({ op: "healEach" });
    expect(Object.keys(blessedSalt ?? {}).sort()).toEqual(["amount", "op"]);
  });
});

describe("§3 — the BENCH scope: the Active is out of the set, whatever it is", () => {
  it("heals every benched body and LEAVES THE ATTACKER DAMAGED", () => {
    const state = threeBodies();
    const attackerUid = activeUid(state, "p1");
    const benchA = benchTopUid(state, "p1", 0);
    const benchB = benchTopUid(state, "p1", 1);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BENCH_SALVE,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(done.players.p1.bench[0]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    // The EVOLVED bench body heals too — "Benched" says nothing about stage, and a
    // build that shared one rider between the two sentences fails here.
    expect(done.players.p1.bench[1]?.damage).toBe(EVO_BENCH_HURT - HEAL);
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: benchA, amount: HEAL },
      { type: "HEALED", seat: "p1", uid: benchB, amount: HEAL },
    ]);
    expect(all(events, "HEALED").map((e) => e.uid)).not.toContain(attackerUid);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the ACTIVE SPOT KEEPS ITS BODY — 'not in the set' is not 'not on the board'", () => {
    // The mistake this rider invites is nulling the Active instead of skipping it,
    // which would read as a body that left play: no Knock Out, no Prize, no
    // promotion, and a seat with an empty Active Spot mid-turn.
    const { state: done } = mustApply(threeBodies(), {
      type: "attack",
      seat: "p1",
      index: BENCH_SALVE,
    });
    expect(done.players.p1.active).not.toBeNull();
    expect(done.players.p1.bench).toHaveLength(2);
    expect(done.players.p1.active?.healedTurn).toBeNull();
    expect(types(done.players.p1.active === null ? [] : [])).toEqual([]);
  });

  it("excludes an EVOLVED attacker for the same reason — the rider reads the SPOT", () => {
    // Same sentence, evolved Active. `benchOnly` never asks what the body is, so this
    // board and the one above must agree about the Active; they disagree only in §4.
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal-evo", ACTIVE_HURT), "p1", [
      ["fix-titan", BASIC_BENCH_HURT],
    ]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BENCH_SALVE,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(done.players.p1.bench[0]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    expect(all(events, "HEALED")).toHaveLength(1);
  });
});

describe("§4 — the BASIC filter: the Active is IN the set when it is a Basic", () => {
  it("heals the BASIC Active and the BASIC bench body, and SKIPS the evolved one", () => {
    // The same three bodies as §3, the other sentence, and the sets are NOT NESTED:
    // this one takes the Active and bench 0, that one took bench 0 and bench 1. No
    // single rider and no one enum can produce both readings.
    const state = threeBodies();
    const attackerUid = activeUid(state, "p1");
    const benchA = benchTopUid(state, "p1", 0);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BASIC_SALVE,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT - HEAL);
    expect(done.players.p1.bench[0]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    // THE EVOLVED BODY IS SKIPPED — as silently as an undamaged one, and WITHOUT
    // truncating the walk, which is why it sits after a body that does heal.
    expect(done.players.p1.bench[1]?.damage).toBe(EVO_BENCH_HURT);
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attackerUid, amount: HEAL },
      { type: "HEALED", seat: "p1", uid: benchA, amount: HEAL },
    ]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("an EVOLVED attacker EXCLUDES ITSELF — the card's own printed noun refuses it", () => {
    // The case a Basic-attacker-only suite cannot see. `fix-scopedheal-evo` prints
    // the same sentence at the same index and is not a Basic, so the heal skips the
    // body that used the attack.
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal-evo", ACTIVE_HURT), "p1", [
      ["fix-titan", BASIC_BENCH_HURT],
      ["fix-scopedheal-evo", EVO_BENCH_HURT],
    ]);
    const benchA = benchTopUid(state, "p1", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BASIC_SALVE,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(done.players.p1.bench[0]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    expect(done.players.p1.bench[1]?.damage).toBe(EVO_BENCH_HURT);
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: benchA, amount: HEAL },
    ]);
  });

  it("the STAGE is read off the TOP CARD, not off the stack's bottom", () => {
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT), "p1", [
      ["fix-scopedheal-evo", EVO_BENCH_HURT],
    ]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BASIC_SALVE,
    });
    expect(done.players.p1.bench[0]?.damage).toBe(EVO_BENCH_HURT);
    expect(all(events, "HEALED")).toHaveLength(1);
    expect(all(events, "HEALED")[0]?.uid).toBe(activeUid(state, "p1"));
  });
});

describe("§5 — what ZERO means, and it is the SHIPPED guard rather than a fourth one", () => {
  it("REFUSES a printed zero at the producer — the guard every arm here carries", () => {
    expect(deriveAttackEffect("Heal 0 damage from each of your Basic Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Heal 0 damage from each of your Benched Pokémon.")).toBeNull();
    // No CEILING, by contrast, and deliberately so: the interpreter clamps PER BODY
    // to the damage present, so a malformed large amount heals the set to full and
    // stops. A legal board state, not a runaway.
    expect(deriveAttackEffect("Heal 999 damage from each of your Benched Pokémon.")).toEqual([
      { op: "healEach", amount: 999, benchOnly: true },
    ]);
  });

  it("CLAMPS PER BODY — the shipped `healed <= 0` skip, and no new guard beside it", () => {
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT), "p1", [
      ["fix-titan", CLAMPED],
      ["fix-titan", BASIC_BENCH_HURT],
    ]);
    const benchA = benchTopUid(state, "p1", 0);
    const benchB = benchTopUid(state, "p1", 1);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: BENCH_SALVE,
    });
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p1.bench[1]?.damage).toBe(BASIC_BENCH_HURT - HEAL);
    // The clamped body reports what MOVED (40), not what was printed (100). A shared
    // clamp, or one read once off the first body, passes a one-body board and fails
    // exactly here.
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: benchA, amount: CLAMPED },
      { type: "HEALED", seat: "p1", uid: benchB, amount: HEAL },
    ]);
  });

  it("WHIFFS SILENTLY per body, and the skip does not truncate the walk", () => {
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT), "p1", [
      ["fix-titan", BASIC_BENCH_HURT],
      ["fix-titan", 0],
      ["fix-titan", CLAMPED],
    ]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: BENCH_SALVE });
    expect(all(events, "HEALED").map((e) => e.amount)).toEqual([HEAL, CLAMPED]);
  });

  it("AN EMPTY SET is the all-whiffed board, not a new case — both riders", () => {
    const emptyBench = attacker(board(), "p1", "fix-scopedheal", ACTIVE_HURT);
    const benchRun = mustApply(emptyBench, { type: "attack", seat: "p1", index: BENCH_SALVE });
    expect(benchRun.state.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(all(benchRun.events, "HEALED")).toEqual([]);
    expect(types(benchRun.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(benchRun.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // (b) `basicOnly` on an ALL-EVOLVED side — the filter matches nothing at all.
    const allEvolved = benchBodies(
      attacker(board(), "p1", "fix-scopedheal-evo", ACTIVE_HURT),
      "p1",
      [["fix-scopedheal-evo", EVO_BENCH_HURT]],
    );
    const basicRun = mustApply(allEvolved, { type: "attack", seat: "p1", index: BASIC_SALVE });
    expect(basicRun.state.players.p1.active?.damage).toBe(ACTIVE_HURT);
    expect(basicRun.state.players.p1.bench[0]?.damage).toBe(EVO_BENCH_HURT);
    expect(all(basicRun.events, "HEALED")).toEqual([]);
    expect(types(basicRun.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(basicRun.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("an UNDAMAGED set heals nothing and still reports as simulated", () => {
    // Zero damage rather than zero bodies: the third way to reach "nothing moved",
    // and the one that must not be told apart from the other two at the log.
    const state = benchBodies(attacker(board(), "p1", "fix-scopedheal", 0), "p1", [
      ["fix-titan", 0],
    ]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: BASIC_SALVE });
    expect(all(events, "HEALED")).toEqual([]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("§6 — the SEAT boundary, and what the narrowing costs the rest of the engine", () => {
  it("leaves the OPPONENT's damaged board untouched — the healEachAll boundary", () => {
    for (const index of [BASIC_SALVE, BENCH_SALVE]) {
      let state = threeBodies();
      state = setDamage(state, "p2", OPPONENT_HURT);
      state = benchBodies(state, "p2", [
        ["fix-titan", OPPONENT_HURT],
        ["fix-scopedheal-evo", OPPONENT_HURT],
      ]);
      const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(done.players.p2.active?.damage).toBe(OPPONENT_HURT);
      expect(done.players.p2.bench[0]?.damage).toBe(OPPONENT_HURT);
      expect(done.players.p2.bench[1]?.damage).toBe(OPPONENT_HURT);
      for (const healed of all(events, "HEALED")) expect(healed.seat).toBe("p1");
    }
  });

  it("runs on the OTHER seat too — the op resolves against `ctx.seat`", () => {
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = benchBodies(attacker(state, "p2", "fix-scopedheal", ACTIVE_HURT), "p2", [
      ["fix-titan", BASIC_BENCH_HURT],
    ]);
    const benched = benchTopUid(state, "p2", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p2",
      index: BENCH_SALVE,
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p2", uid: benched, amount: HEAL },
    ]);
    expect(done.players.p2.active?.damage).toBe(ACTIVE_HURT);
  });

  it("consumes NO rng and never PARKS — which is why one board is the whole account", () => {
    for (const index of [BASIC_SALVE, BENCH_SALVE]) {
      const state = threeBodies();
      const { state: done } = mustApply(state, { type: "attack", seat: "p1", index });
      expect(done.rngState).toBe(state.rngState);
      expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    }
  });

  it("costs ZERO registry rows — both bodies simulate off their printed text", () => {
    for (const id of ["fix-scopedheal", "fix-scopedheal-evo"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});

describe("§7 — the record-shape derivation, made rather than inherited", () => {
  it("`MATCH_RECORD_VERSION` STAYS 29 — the reachability argument, driven", () => {
    for (const text of [BASIC_TEXT, BENCH_TEXT]) {
      expect(deriveAttackEffect(text)).toHaveLength(1);
    }
  });

  it("driven over the SERIALIZED BYTES, in three directions", () => {
    const state = threeBodies();
    const healTurn = state.turn;
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: BASIC_SALVE });
    const bytes = JSON.stringify(done);
    // (a) FORWARD — the CONSEQUENCE is in the bytes, so this is not a vacuous grep
    //     over a state that records nothing at all. `healedBody` stamps the turn.
    expect(bytes).toContain("healedTurn");
    expect(bytes).toContain(`"damage":${ACTIVE_HURT - HEAL}`);
    // (b) ABSENCE — neither the op nor either new field reaches them. An op that had
    //     parked would put the literal `"healEach"` into `phase.cont`.
    expect(bytes).not.toContain("healEach");
    expect(bytes).not.toContain("basicOnly");
    expect(bytes).not.toContain("benchOnly");
    const roundTripped = JSON.parse(bytes) as GameState;
    expect(roundTripped.players.p1.active?.damage).toBe(ACTIVE_HURT - HEAL);
    expect(roundTripped.players.p1.active?.healedTurn).toBe(healTurn);
    expect(roundTripped.players.p1.bench[1]?.damage).toBe(EVO_BENCH_HURT);
    expect(roundTripped.players.p1.bench[1]?.healedTurn).toBeNull();
  });
});

describe("§8 — the REFUSAL, with its own reason and its own falsifier", () => {
  it("the `Ancient` row is a CORPUS row, is UNBUILT, and stays unbuilt ( D569: by the deriver — the registry builds it)", () => {
    // The third member of the printed family, refused for a reason that is not this
    // package's to fix.
    const corpus = new Map(legalAttackCorpus().map(([units, text]) => [text, units]));
    expect(corpus.get(ANCIENT_TEXT)).toBe(1);
    expect(deriveAttackEffect(ANCIENT_TEXT)).toBeNull();
    expect(resolvedByAnyReader(ANCIENT_TEXT)).toBe(false);
    expect(deriveAttackEffect("Heal 100 damage from 1 of your Benched Pokémon.")).toEqual([
      { op: "healChosen", amount: HEAL, zone: "bench" },
    ]);
  });

  it("THE BANNER'S PRICE IS 7 SENTENCES / 10 PRINTINGS, and the falsifier is INGEST", () => {
    const ancient = legalAttackCorpus().filter(([, text]) => /Ancient/.test(text));
    expect(ancient).toHaveLength(7);
    expect(ancient.reduce((sum, [units]) => sum + units, 0)).toBe(10);
    const readerClaimed = ancient.filter(([, text]) => resolvedByAnyReader(text));
    expect(readerClaimed.map(([, text]) => text).sort()).toEqual(
      [
        "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.",
        "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.",
        "This attack does 10 more damage for each Ancient card in your discard pile.",
        "This attack does 30 damage for each of your Ancient Pokémon in play.",
      ].sort(),
    );
    // The falsifier, stated so it can be checked rather than remembered: when the
    // catalog grows a banner column, this rung is what should go red first.
    const CARD_FIELDS_TODAY = Object.keys(FIXTURE_POOL["fix-titan"] ?? {});
    expect(CARD_FIELDS_TODAY).not.toContain("banner");
    expect(CARD_FIELDS_TODAY).not.toContain("subtypes");
  });
});
