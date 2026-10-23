import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  BOARD_HEAL_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Heal 30 damage from each of your Pokémon.",
    op: { op: "healEach", amount: 30 },
    // Skeledirge ex sv02-037 / -233 / -258 / -272 ("Vitality Song", 50 — the fixture
    // this suite drives) + Steenee sv03-017 ("Aromatherapy", no damage).
    printings: 5,
  },
  {
    text: "Heal 20 damage from each of your Pokémon.",
    op: { op: "healEach", amount: 20 },
    // Cresselia sv06.5-021 / -071 ("Healing Pirouette", no damage — the other fixture
    // this suite drives).
    printings: 2,
  },
] as const;

const REAL_NEAR_MISSES = [
  "Heal 20 damage from 1 of your Pokémon.",
  "Heal 60 damage from 1 of your Benched Pokémon.",
  "Heal all damage from 1 of your Benched Pokémon.",
  "Flip a coin. If heads, heal 30 damage from this Pokémon.",
  "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
  "Choose up to 2 of your Pokémon and heal 50 damage from each of them.",
  "Heal 30 damage from each Pokémon (both yours and your opponent's).",
] as const;

const NBSP = "\u00a0";

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const VITALITY_SONG_INDEX = 0;
const HEALING_PIROUETTE_INDEX = 0;
const CRESCENT_PURGE_INDEX = 1;

/** The two heal amounts and the one printed damage. They are two different N
    precisely so that a hardcoded amount somewhere downstream cannot satisfy both. */
const VITALITY_SONG_HEAL = 30;
const VITALITY_SONG_DAMAGE = 50;
const HEALING_PIROUETTE_HEAL = 20;

const ACTIVE_HURT = 100;
const BENCH_HURT = 80;
/** LESS than either printed N — the clamped body. */
const BENCH_BARELY_HURT = 10;
/** The opponent's damage, on a board that must come back UNCHANGED. Distinct from
    every own-side figure so a mixed-up seat cannot land on a number that happens to
    be right. */
const OPPONENT_HURT = 70;

function board(): GameState {
  let state = driveSetup(7, { p1: BOARD_HEAL_DECK, p2: BOARD_HEAL_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

function skeledirgeActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-037"), seat),
    seat,
    "fix-fire-energy",
    1,
  );
  return setDamage(fielded, seat, damage);
}

/** Cresselia Active with Healing Pirouette's single {P} paid, carrying `damage` HP.
    A Basic, so `setActiveFromDeck` is a convenience here rather than a necessity —
    but the board is kept the same shape as Skeledirge's on purpose. */
function cresseliaActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv06.5-021"), seat),
    seat,
    "fix-psychic-energy",
    1,
  );
  return setDamage(fielded, seat, damage);
}

function benchTitans(state: GameState, seat: Seat, damages: number[]): GameState {
  let next = state;
  for (const damage of damages) {
    next = benchFromDeck(next, seat, "fix-titan");
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, damage);
  }
  return next;
}

describe("the anchor — 7 printings, 2 clauses, one sentence", () => {
  it("derives both distinct clauses the pool prints, to the SAME single op", () => {
    for (const { text, op } of CLAUSES) {
      expect(deriveAttackEffect(text)).toEqual([op]);
    }
    expect(CLAUSES).toHaveLength(2);
    expect(CLAUSES.reduce((n, c) => n + c.printings, 0)).toBe(7);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering one clause.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
    for (const { text } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toHaveLength(1);
      expect(ops?.[0]).toMatchObject({ op: "healEach" });
    }
  });

  it("refuses a printed ZERO — the guard every arm of this reader carries", () => {
    expect(deriveAttackEffect("Heal 0 damage from each of your Pokémon.")).toBeNull();
    // No CEILING, by contrast, and deliberately so: the interpreter CLAMPS PER
    // POKÉMON to the damage present, so a malformed large amount heals the board to
    // full and stops. That is a legal board state, not a runaway.
    expect(deriveAttackEffect("Heal 999 damage from each of your Pokémon.")).toEqual([
      { op: "healEach", amount: 999 },
    ]);
  });

  it("refuses the SEVEN real catalog rows that share its words", () => {
    for (const [index, text] of REAL_NEAR_MISSES.entries()) {
      if (index <= 3 || index === 6) {
        expect(deriveAttackEffect(text)).not.toContainEqual(
          expect.objectContaining({ op: "healEach" }),
        );
        continue;
      }
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackEffect(REAL_NEAR_MISSES[5])).toBeNull();
    expect(deriveAttackEffect(REAL_NEAR_MISSES[6])).toEqual([{ op: "healEachAll", amount: 30 }]);
  });

  it("is DISJOINT from the bare self-heal — neither anchor can claim the other", () => {
    expect(deriveAttackEffect("Heal 30 damage from this Pokémon.")).toEqual([
      { op: "heal", target: "self", amount: 30 },
    ]);
    expect(deriveAttackEffect("Heal 30 damage from each of your Pokémon.")).toEqual([
      { op: "healEach", amount: 30 },
    ]);
    // And the two ops are genuinely different — a build that collapsed them would
    // pass every single-Pokémon board in either suite.
    expect(deriveAttackEffect("Heal 30 damage from each of your Pokémon.")).not.toEqual(
      deriveAttackEffect("Heal 30 damage from this Pokémon."),
    );
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Heal 30 damage from each of your Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Heal 30 damage from each of your Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path (Saguaro's tail is exactly that clause), and the reason no /i flag is
      // on this regex.
      "heal 30 damage from each of your Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Heal${NBSP}30 damage from each of your Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Heal  30 damage from each of your Pokémon.",
      // THE OTHER SIDE. Healing the opponent's board is not a thing this arm can do,
      // and a reader that dropped the possessive would do it silently.
      "Heal 30 damage from each of your opponent's Pokémon.",
      // "all" for a number: a real printed amount (Blissey, Arboliva) that this op
      // cannot carry — `amount` is a number.
      "Heal all damage from each of your Pokémon.",
      "Flip a coin. If heads, heal 30 damage from each of your Pokémon.",
      "If this Pokémon is Burned, heal 30 damage from each of your Pokémon.",
      "Heal 30 damage from each of your Pokémon. This Pokémon is now Asleep.",
      "Heal 30 damage from each of your Pokémon. Then, shuffle your deck.",
      // PLURAL DRIFT in the quantifier. "each" is the printed word; "all of your" and
      // "every" are not, and a reader that accepted them would be guessing at text
      // the ingest has never produced.
      "Heal 30 damage from all of your Pokémon.",
      "Heal 30 damage from every one of your Pokémon.",
      // COUNTERS, not HP. "Remove N damage counters" is the older wording for the
      // same idea and a different arithmetic (§12: one counter = 10 HP); nothing in
      // this pool prints it, and a reader that guessed would be off by a factor of 10.
      "Remove 3 damage counters from each of your Pokémon.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(deriveAttackEffect("Heal 30 damage from each of your Benched Pokémon.")).toEqual([
      { op: "healEach", amount: 30, benchOnly: true },
    ]);
    expect(deriveAttackEffect("Heal 30 damage from each of your Benched Pokémon.")).not.toEqual(
      deriveAttackEffect("Heal 30 damage from each of your Pokémon."),
    );
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not.
    expect(deriveAttackEffect("  Heal 30 damage from each of your Pokémon.\n")).toEqual([
      { op: "healEach", amount: 30 },
    ]);
    expect(deriveAttackEffect("\tHeal 20 damage from each of your Pokémon. ")).toEqual([
      { op: "healEach", amount: 20 },
    ]);
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Skeledirge ex sv02-037", () => {
    const vitalitySong = FIXTURE_POOL["sv02-037"]?.attacks?.[VITALITY_SONG_INDEX];
    expect(vitalitySong).toEqual({
      cost: ["Fire"],
      name: "Vitality Song",
      effect: "Heal 30 damage from each of your Pokémon.",
      damage: VITALITY_SONG_DAMAGE,
    });
    expect(deriveAttackEffect(vitalitySong?.effect ?? "")).toEqual([
      { op: "healEach", amount: VITALITY_SONG_HEAL },
    ]);
    expect(FIXTURE_POOL["sv02-037"]?.name).toBe("Skeledirge ex");
    // A STAGE 2, which is why every board below reaches it by surgery.
    expect(FIXTURE_POOL["sv02-037"]?.stage).toBe("Stage2");
    expect(FIXTURE_POOL["sv02-037"]?.hp).toBe(340);
  });

  it("matches FIXTURE_POOL char-for-char for Cresselia sv06.5-021", () => {
    const pirouette = FIXTURE_POOL["sv06.5-021"]?.attacks?.[HEALING_PIROUETTE_INDEX];
    expect(pirouette).toEqual({
      cost: ["Psychic"],
      name: "Healing Pirouette",
      effect: "Heal 20 damage from each of your Pokémon.",
    });
    expect(FIXTURE_POOL["sv06.5-021"]?.name).toBe("Cresselia");
    expect(FIXTURE_POOL["sv06.5-021"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv06.5-021"]?.hp).toBe(120);
    expect(FIXTURE_POOL["sv06.5-021"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv06.5-021"]?.abilities).toBeNull();
    // "Healing Pirouette" prints NO `damage` field at all (not a zero, not an empty
    // string), so a mis-read has no number to land on: the board heal is the whole
    // visible result of the declaration.
    expect(pirouette?.damage).toBeUndefined();
    expect(deriveAttackEffect(pirouette?.effect ?? "")).toEqual([
      { op: "healEach", amount: HEALING_PIROUETTE_HEAL },
    ]);
  });
});

describe("end to end — Skeledirge ex 'Vitality Song' (heal 30 each, WITH a printed 50)", () => {
  it("heals the ACTIVE and EVERY benched body — and clamps each one separately", () => {
    let state = skeledirgeActive(board(), "p1", ACTIVE_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const attacker = activeUid(state, "p1");
    const benchA = benchTopUid(state, "p1", 0);
    const benchB = benchTopUid(state, "p1", 1);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT - VITALITY_SONG_HEAL);
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT - VITALITY_SONG_HEAL);
    // THE PER-POKÉMON CLAMP. 10 damage takes 10 of the printed 30 and lands at 0 —
    // it does not go negative, and it does not consume the other bodies' heal.
    expect(done.players.p1.bench[1]?.damage).toBe(0);
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attacker, amount: VITALITY_SONG_HEAL },
      { type: "HEALED", seat: "p1", uid: benchA, amount: VITALITY_SONG_HEAL },
      { type: "HEALED", seat: "p1", uid: benchB, amount: BENCH_BARELY_HURT },
    ]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("leaves the OPPONENT's damaged board untouched — the healEachAll boundary", () => {
    let state = skeledirgeActive(board(), "p1", ACTIVE_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    state = setDamage(state, "p2", OPPONENT_HURT);
    state = benchTitans(state, "p2", [OPPONENT_HURT]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    // The opponent's ACTIVE gains the printed 50 and loses nothing.
    expect(done.players.p2.active?.damage).toBe(OPPONENT_HURT + VITALITY_SONG_DAMAGE);
    // The opponent's BENCH is not in the attack's path at all: no damage, no heal.
    expect(done.players.p2.bench[0]?.damage).toBe(OPPONENT_HURT);
    expect(all(events, "HEALED")).toHaveLength(2);
    for (const healed of all(events, "HEALED")) expect(healed.seat).toBe("p1");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: VITALITY_SONG_DAMAGE });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("runs on the OTHER seat too, healing THAT seat's whole board", () => {
    // Same card, opposite chair: the op resolves against `ctx.seat`, not against a
    // hardcoded seat. Cheap, and the only thing that catches a `"p1"` literal that
    // happens to be right on every P1 board.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = skeledirgeActive(state, "p2", ACTIVE_HURT);
    state = benchTitans(state, "p2", [BENCH_HURT]);
    const attacker = activeUid(state, "p2");
    const benched = benchTopUid(state, "p2", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p2",
      index: VITALITY_SONG_INDEX,
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p2", uid: attacker, amount: VITALITY_SONG_HEAL },
      { type: "HEALED", seat: "p2", uid: benched, amount: VITALITY_SONG_HEAL },
    ]);
    expect(done.players.p2.active?.damage).toBe(ACTIVE_HURT - VITALITY_SONG_HEAL);
    expect(done.players.p2.bench[0]?.damage).toBe(BENCH_HURT - VITALITY_SONG_HEAL);
    expect(done.players.p1.active?.damage).toBe(VITALITY_SONG_DAMAGE);
  });

  it("WHIFFS SILENTLY per Pokémon — an undamaged body emits NO row", () => {
    let state = skeledirgeActive(board(), "p1", ACTIVE_HURT);
    state = benchTitans(state, "p1", [0, BENCH_HURT]);
    const attacker = activeUid(state, "p1");
    const damagedBench = benchTopUid(state, "p1", 1);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attacker, amount: VITALITY_SONG_HEAL },
      { type: "HEALED", seat: "p1", uid: damagedBench, amount: VITALITY_SONG_HEAL },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("WHIFFS SILENTLY on a fully undamaged board — no rows at all, still SIMULATED", () => {
    let state = skeledirgeActive(board(), "p1", 0);
    state = benchTitans(state, "p1", [0]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // The printed damage is unaffected by the whiff: the two halves of the
    // declaration are independent.
    expect(done.players.p2.active?.damage).toBe(VITALITY_SONG_DAMAGE);
  });

  it("heals an EMPTY bench without incident — the Active alone is 'each'", () => {
    // The degenerate board, and a real one: a player whose Bench is empty still has
    // one Pokémon, and the sentence still names it. A loop written over the bench
    // alone reports nothing here and would look identical to a whiff.
    const state = skeledirgeActive(board(), "p1", ACTIVE_HURT);
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(all(events, "HEALED")).toHaveLength(1);
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT - VITALITY_SONG_HEAL);
  });
});

describe("end to end — Cresselia 'Healing Pirouette' (heal 20 each, NO printed damage)", () => {
  it("heals 20 across the board and deals NOTHING — the heal is the whole result", () => {
    let state = cresseliaActive(board(), "p1", ACTIVE_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const attacker = activeUid(state, "p1");
    const benched = benchTopUid(state, "p1", 0);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: HEALING_PIROUETTE_INDEX,
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attacker, amount: HEALING_PIROUETTE_HEAL },
      { type: "HEALED", seat: "p1", uid: benched, amount: HEALING_PIROUETTE_HEAL },
    ]);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("uses a DIFFERENT N from Skeledirge's — 20, not 30", () => {
    const state = cresseliaActive(board(), "p1", ACTIVE_HURT);
    const { state: done } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: HEALING_PIROUETTE_INDEX,
    });
    expect(done.players.p1.active?.damage).toBe(ACTIVE_HURT - HEALING_PIROUETTE_HEAL);
    expect(HEALING_PIROUETTE_HEAL).not.toBe(VITALITY_SONG_HEAL);
    expect(ACTIVE_HURT).toBeGreaterThan(VITALITY_SONG_HEAL);
  });

  it("the index-1 control derives NOTHING — the reader is keyed to the declared text", () => {
    const purge = FIXTURE_POOL["sv06.5-021"]?.attacks?.[CRESCENT_PURGE_INDEX];
    expect(purge?.name).toBe("Crescent Purge");
    expect(deriveAttackEffect(purge?.effect ?? "")).toBeNull();
  });
});

describe("what the own-board heal costs the rest of the engine — nothing", () => {
  it("consumes NO rng: the state's rngState is untouched", () => {
    const skeledirge = benchTitans(skeledirgeActive(board(), "p1", ACTIVE_HURT), "p1", [
      BENCH_HURT,
    ]);
    expect(
      mustApply(skeledirge, { type: "attack", seat: "p1", index: VITALITY_SONG_INDEX }).state
        .rngState,
    ).toBe(skeledirge.rngState);
    const cresselia = cresseliaActive(board(), "p1", ACTIVE_HURT);
    expect(
      mustApply(cresselia, { type: "attack", seat: "p1", index: HEALING_PIROUETTE_INDEX }).state
        .rngState,
    ).toBe(cresselia.rngState);
  });

  it("never PARKS — the attack resolves to an ordinary action phase", () => {
    const state = benchTitans(skeledirgeActive(board(), "p1", ACTIVE_HURT), "p1", [
      BENCH_HURT,
      BENCH_BARELY_HURT,
    ]);
    const { state: done } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: VITALITY_SONG_INDEX,
    });
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("costs ZERO registry rows — both cards simulate off their printed text", () => {
    for (const id of ["sv02-037", "sv06.5-021"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });

  it("emits the SAME op Garganacl's Ability does — one action, two readers", () => {
    expect(deriveAttackEffect("Heal 20 damage from each of your Pokémon.")).toEqual(
      programFor("sv02-123")?.triggered?.[0]?.program,
    );
  });
});
