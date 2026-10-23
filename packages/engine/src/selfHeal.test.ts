import { describe, expect, it } from "vitest";
import { deriveAttackCoinFlip, deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SELF_HEAL_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Heal 30 damage from this Pokémon.",
    op: { op: "heal", target: "self", amount: 30 },
    printings: 8,
  },
  {
    text: "Heal 20 damage from this Pokémon.",
    op: { op: "heal", target: "self", amount: 20 },
    // Natu swsh10.5-032 ("Nap", NO damage — the other fixture this suite drives),
    // Tropius sv02-007 / -195 ("Leaf Drain", 20), Marill sv02-044 / -204 ("Bubble
    // Drain", 20).
    printings: 5,
  },
  {
    text: "Heal 10 damage from this Pokémon.",
    op: { op: "heal", target: "self", amount: 10 },
    // Shroomish sv01-003 + Smoliv sv03-019 ("Absorb", 10), Bramblin sv02-023 / -198
    // ("Blot", 10).
    printings: 4,
  },
  {
    text: "Heal 50 damage from this Pokémon.",
    op: { op: "heal", target: "self", amount: 50 },
    printings: 1,
  },
] as const;

const REAL_NEAR_MISSES = [
  "Heal 20 damage from 1 of your Pokémon.",
  "Heal 60 damage from 1 of your Benched Pokémon.",
  "Heal all damage from 1 of your Benched Pokémon.",
  "Flip a coin. If heads, heal 30 damage from this Pokémon.",
  "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
  "This Pokémon is now Asleep. Heal 30 damage from it.",
  "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.",
] as const;

const UNMAPPED_NEAR_MISSES = [REAL_NEAR_MISSES[4], REAL_NEAR_MISSES[6]] as const;

const NBSP = "\u00a0";

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const LIFE_SUCKER_INDEX = 0;
const NAP_INDEX = 0;
const PECK_INDEX = 1;

const LIFE_SUCKER_HEAL = 30;
const LIFE_SUCKER_DAMAGE = 50;
const NAP_HEAL = 20;
/** A damaged attacker with room to spare on both sides of the heal: 100 is more than
    either N, so the heal is CLAMPED BY NOTHING here and the delta is the printed
    amount exactly. (Ceruledge has 140 HP, so 100 is damaged and alive.) */
const HURT = 100;
const NATU_HURT = 40;
/** LESS than Life Sucker's 30 — the clamp's board. */
const BARELY_HURT = 10;

function board(): GameState {
  let state = driveSetup(7, { p1: SELF_HEAL_DECK, p2: SELF_HEAL_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return state;
}

function ceruledgeActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(setActiveFromDeck(state, seat, "sv02-098"), seat, "fix-energy", 2);
  return setDamage(fielded, seat, damage);
}

/** Natu Active with Nap's single {C} paid, carrying `damage` HP of damage. A Basic,
    so `setActiveFromDeck` is a convenience here rather than a necessity — but the
    board is kept the same shape as Ceruledge's on purpose. */
function natuActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(
    setActiveFromDeck(state, seat, "swsh10.5-032"),
    seat,
    "fix-energy",
    1,
  );
  return setDamage(fielded, seat, damage);
}

describe("the anchor — 18 printings, 4 clauses, one sentence", () => {
  it("derives every distinct clause the pool prints, to the SAME single op", () => {
    for (const { text, op } of CLAUSES) {
      expect(deriveAttackEffect(text)).toEqual([op]);
    }
    expect(CLAUSES).toHaveLength(4);
    expect(CLAUSES.reduce((n, c) => n + c.printings, 0)).toBe(18);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering three clauses.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
    for (const { text } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toHaveLength(1);
      expect(ops?.[0]).toMatchObject({ op: "heal", target: "self" });
    }
  });

  it("refuses a printed ZERO — the guard every arm of this reader carries", () => {
    expect(deriveAttackEffect("Heal 0 damage from this Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Heal 999 damage from this Pokémon.")).toEqual([
      { op: "heal", target: "self", amount: 999 },
    ]);
  });

  it("refuses the TWO unmapped catalog rows that share its words", () => {
    for (const text of UNMAPPED_NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(UNMAPPED_NEAR_MISSES).toHaveLength(REAL_NEAR_MISSES.length - 5);
  });

  it("hands the CHOSEN forms to their own anchor — and none of them is a self-heal", () => {
    for (const text of [REAL_NEAR_MISSES[0], REAL_NEAR_MISSES[1], REAL_NEAR_MISSES[2]]) {
      const ops = deriveAttackEffect(text);
      expect(ops).not.toBeNull();
      expect(ops).not.toContainEqual(expect.objectContaining({ op: "heal" }));
      expect(ops).toEqual([expect.objectContaining({ op: "healChosen" })]);
    }
    expect(deriveAttackEffect(REAL_NEAR_MISSES[0])).toEqual([{ op: "healChosen", amount: 20 }]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[1])).toEqual([
      { op: "healChosen", amount: 60, zone: "bench" },
    ]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[2])).toEqual([
      { op: "healChosen", amount: "all", zone: "bench" },
    ]);
  });

  it("hands the GATED form to the flip anchor — and the heal inside it is THIS one", () => {
    const gated = REAL_NEAR_MISSES[3];
    expect(gated.startsWith("Heal")).toBe(false);
    expect(deriveAttackEffect(gated)).toEqual([
      { op: "coinFlipGate", ops: deriveAttackEffect("Heal 30 damage from this Pokémon.") },
    ]);
    // And the COIN reader still does not claim it: a gated heal is not an
    // `AttackCoinFlip` shape (those fold pre-damage). So exactly one reader answers
    // for the string, which is this family's standing invariant.
    expect(deriveAttackCoinFlip(gated)).toBeNull();
  });

  it("hands the COMPOUND Sleep form to the OTHER anchor — one reader per string", () => {
    const compound = REAL_NEAR_MISSES[5];
    const compoundOps = deriveAttackEffect(compound);
    expect(compoundOps).not.toBeNull();
    const bare = deriveAttackEffect("Heal 30 damage from this Pokémon.");
    expect(compoundOps?.[1]).toEqual(bare?.[0]);
    expect(compoundOps).toEqual([
      { op: "applyStatus", target: "self", status: "asleep" },
      { op: "heal", target: "self", amount: 30 },
    ]);
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Heal 30 damage from this Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Heal 30 damage from this Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path (Fuecoco's "…, heal 30 damage from this Pokémon." is exactly that
      // clause), and the reason no /i flag is on this regex.
      "heal 30 damage from this Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Heal${NBSP}30 damage from this Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Heal  30 damage from this Pokémon.",
      // THE PRONOUN. "from it" is the COMPOUND sentence's tail and has no referent on
      // its own — the bound pronoun is bound by a clause that is not here.
      "Heal 30 damage from it.",
      // "all" for a number: a real printed amount (Blissey, Arboliva) that this op
      // cannot carry — `amount` is a number, and "heal to full" is a reading nothing
      // in this arm expresses.
      "Heal all damage from this Pokémon.",
      "Before doing damage, heal 30 damage from this Pokémon.",
      "If this Pokémon is Burned, heal 30 damage from this Pokémon.",
      "Heal 30 damage from this Pokémon. This Pokémon is now Asleep.",
      "Heal 30 damage from this Pokémon. Then, shuffle your deck.",
      "Heal 30 damage from your Active Pokémon.",
      "Heal 30 damage from your opponent's Active Pokémon.",
      "Heal 30 damage from your opponent's Benched Pokémon.",
      // COUNTERS, not HP. "Remove N damage counters" is the older wording for the
      // same idea and a different arithmetic (§12: one counter = 10 HP); nothing in
      // this pool prints it, and a reader that guessed would be off by a factor of 10.
      "Remove 3 damage counters from this Pokémon.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not.
    expect(deriveAttackEffect("  Heal 30 damage from this Pokémon.\n")).toEqual([
      { op: "heal", target: "self", amount: 30 },
    ]);
    expect(deriveAttackEffect("\tHeal 10 damage from this Pokémon. ")).toEqual([
      { op: "heal", target: "self", amount: 10 },
    ]);
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Ceruledge sv02-098", () => {
    const lifeSucker = FIXTURE_POOL["sv02-098"]?.attacks?.[LIFE_SUCKER_INDEX];
    expect(lifeSucker).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Life Sucker",
      effect: "Heal 30 damage from this Pokémon.",
      damage: LIFE_SUCKER_DAMAGE,
    });
    expect(deriveAttackEffect(lifeSucker?.effect ?? "")).toEqual([
      { op: "heal", target: "self", amount: LIFE_SUCKER_HEAL },
    ]);
    expect(FIXTURE_POOL["sv02-098"]?.name).toBe("Ceruledge");
    // A STAGE 1, which is why every board below reaches it by surgery.
    expect(FIXTURE_POOL["sv02-098"]?.stage).toBe("Stage1");
    expect(FIXTURE_POOL["sv02-098"]?.hp).toBe(140);
  });

  it("matches FIXTURE_POOL char-for-char for Natu swsh10.5-032", () => {
    expect(FIXTURE_POOL["swsh10.5-032"]?.attacks).toEqual([
      {
        cost: ["Colorless"],
        name: "Nap",
        effect: "Heal 20 damage from this Pokémon.",
      },
      { cost: ["Psychic", "Colorless"], name: "Peck", damage: 20 },
    ]);
    expect(FIXTURE_POOL["swsh10.5-032"]?.name).toBe("Natu");
    expect(FIXTURE_POOL["swsh10.5-032"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["swsh10.5-032"]?.hp).toBe(50);
    expect(FIXTURE_POOL["swsh10.5-032"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["swsh10.5-032"]?.abilities).toBeNull();
    // "Nap" prints NO `damage` field at all (not a zero, not an empty string), so a
    // mis-read has no number to land on: the heal is the whole visible result of the
    // declaration. "Peck" is the mirror image — a number and no effect text.
    expect(FIXTURE_POOL["swsh10.5-032"]?.attacks?.[NAP_INDEX]?.damage).toBeUndefined();
    expect(FIXTURE_POOL["swsh10.5-032"]?.attacks?.[PECK_INDEX]?.effect).toBeUndefined();
    expect(
      deriveAttackEffect(FIXTURE_POOL["swsh10.5-032"]?.attacks?.[NAP_INDEX]?.effect ?? ""),
    ).toEqual([{ op: "heal", target: "self", amount: NAP_HEAL }]);
  });
});

describe("end to end — Ceruledge 'Life Sucker' (heal 30, WITH a printed 50)", () => {
  it("heals the ATTACKER by 30 and damages the DEFENDER by 50", () => {
    const state = ceruledgeActive(board(), "p1", HURT);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LIFE_SUCKER_INDEX,
    });
    expect(done.players.p1.active?.damage).toBe(HURT - LIFE_SUCKER_HEAL);
    const healed = findEvent(events, "HEALED");
    expect(healed).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: attacker,
      amount: LIFE_SUCKER_HEAL,
    });
    expect(done.players.p2.active?.damage).toBe(LIFE_SUCKER_DAMAGE);
    expect(all(events, "HEALED")).toHaveLength(1);
    expect(findEvent(events, "HEALED")?.seat).not.toBe("p2");
    // Simulated, not skipped — and the printed damage landed, so the sentence and
    // the number are both live on one declaration.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: LIFE_SUCKER_DAMAGE });
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });

  it("runs on the OTHER seat too, healing THAT seat's Active", () => {
    // Same card, opposite chair: the op resolves against `ctx.seat`, not against a
    // hardcoded seat. Cheap, and the only thing that catches a `"p1"` literal that
    // happens to be right on every P1 board.
    let state = board();
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    state = ceruledgeActive(state, "p2", HURT);
    const attacker = activeUid(state, "p2");
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p2",
      index: LIFE_SUCKER_INDEX,
    });
    expect(findEvent(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p2",
      uid: attacker,
      amount: LIFE_SUCKER_HEAL,
    });
    expect(done.players.p2.active?.damage).toBe(HURT - LIFE_SUCKER_HEAL);
    expect(done.players.p1.active?.damage).toBe(LIFE_SUCKER_DAMAGE);
  });

  it("CLAMPS to the damage present — heal 30 off 10 heals TEN, and lands at 0", () => {
    const state = ceruledgeActive(board(), "p1", BARELY_HURT);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LIFE_SUCKER_INDEX,
    });
    expect(done.players.p1.active?.damage).toBe(0);
    expect(findEvent(events, "HEALED")?.amount).toBe(BARELY_HURT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("WHIFFS SILENTLY on an undamaged attacker — no row, and still SIMULATED", () => {
    const state = ceruledgeActive(board(), "p1", 0);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LIFE_SUCKER_INDEX,
    });
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // The printed damage is unaffected by the whiff: the two halves of the
    // declaration are independent.
    expect(done.players.p2.active?.damage).toBe(LIFE_SUCKER_DAMAGE);
  });
});

describe("end to end — Natu 'Nap' (heal 20, NO printed damage)", () => {
  it("heals 20 and deals NOTHING — the heal is the whole result", () => {
    const state = natuActive(board(), "p1", NATU_HURT);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: NAP_INDEX,
    });
    expect(done.players.p1.active?.damage).toBe(NATU_HURT - NAP_HEAL);
    expect(findEvent(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: attacker,
      amount: NAP_HEAL,
    });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("uses a DIFFERENT N from Ceruledge's — 20, not 30", () => {
    const state = natuActive(board(), "p1", NATU_HURT);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: NAP_INDEX });
    expect(done.players.p1.active?.damage).toBe(NATU_HURT - NAP_HEAL);
    expect(NATU_HURT - NAP_HEAL).not.toBe(NATU_HURT - LIFE_SUCKER_HEAL);
    expect(NATU_HURT).toBeGreaterThan(LIFE_SUCKER_HEAL);
  });

  it("the index-1 control heals NOTHING — the reader is keyed to the declared text", () => {
    expect(FIXTURE_POOL["swsh10.5-032"]?.attacks?.[PECK_INDEX]?.effect).toBeUndefined();
    expect(deriveAttackEffect("")).toBeNull();
  });
});

describe("what the bare heal costs the rest of the engine — nothing", () => {
  it("consumes NO rng: the state's rngState is untouched", () => {
    // No coin, no shuffle, no random pick — "this Pokémon" is not a choice and the
    // amount is printed. That determinism is what lets this whole suite run on ONE
    // board with no seed sweep, so it is worth an assertion rather than a comment.
    const ceruledge = ceruledgeActive(board(), "p1", HURT);
    expect(
      mustApply(ceruledge, { type: "attack", seat: "p1", index: LIFE_SUCKER_INDEX }).state.rngState,
    ).toBe(ceruledge.rngState);
    const natu = natuActive(board(), "p1", NATU_HURT);
    expect(mustApply(natu, { type: "attack", seat: "p1", index: NAP_INDEX }).state.rngState).toBe(
      natu.rngState,
    );
  });

  it("never PARKS — the attack resolves to an ordinary action phase", () => {
    const { state: done } = mustApply(ceruledgeActive(board(), "p1", HURT), {
      type: "attack",
      seat: "p1",
      index: LIFE_SUCKER_INDEX,
    });
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("costs ZERO registry rows — both cards simulate off their printed text", () => {
    for (const id of ["sv02-098", "swsh10.5-032"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});
