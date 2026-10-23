import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import { isImmobilized } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  CROSS_BOARD_STATUS_DECK,
  attachFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setConditions,
  types,
} from "./testFixtures";
import type { SpecialConditions } from "./types";
import { presentStatuses } from "./types";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The two consequent skeletons, as labelled COPIES — the readers' own patterns are
    module-private. Whole-sentence anchored at BOTH ends, like theirs. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;
const NOTHING = /^If (.+), this attack does nothing\.$/;

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackBonusConsequent,
];

const ROASTING_HEAT =
  "If your opponent's Active Pokémon is Burned, this attack does 40 more damage.";
const MENTAL_CRUSH =
  "If your opponent's Active Pokémon is Confused, this attack does 90 more damage.";
const CHARRING_BREATH = "If your opponent's Active Pokémon isn't Burned, this attack does nothing.";

const BURNED_CLAUSE = "your opponent's Active Pokémon is Burned";
const CONFUSED_CLAUSE = "your opponent's Active Pokémon is Confused";
const NOT_BURNED_CLAUSE = "your opponent's Active Pokémon isn't Burned";

const SINGE = "Your opponent's Active Pokémon is now Burned.";
const PERPLEX = "Your opponent's Active Pokémon is now Confused.";

const BURNED: BoardCondition = { kind: "opponentActiveBurned" };
const CONFUSED: BoardCondition = { kind: "opponentActiveConfused" };
/** The member the two new ones are NARROWINGS of — the shipped `.length > 0` over the
    same projection, reported beside them on every board in §5. */
const ANY_STATUS: BoardCondition = { kind: "opponentActiveHasSpecialCondition" };
/** The nearest sibling in the printed vocabulary — one word apart, one board, and the
    two clauses are the same code-point length. */
const POISONED: BoardCondition = { kind: "opponentActivePoisoned" };

/** The five printed status words, in the order §12 lists them. THE CLOSED VOCABULARY
    the declined token would have varied over. */
const PRINTED_STATUSES = ["Asleep", "Burned", "Confused", "Paralyzed", "Poisoned"] as const;

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: CROSS_BOARD_STATUS_DECK, p2: CROSS_BOARD_STATUS_DECK },
    { first: "p2" },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

/** `board`, handed over to P2. Both members are CROSS-BOARD on the face of them, and
    a P1-only suite cannot tell "reads the OPPONENT's Active" apart from "reads p2's
    Active" — so §6 drives every reading from the far seat too. */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

/** Field `cardId` in `seat`'s Active Spot and pay `spec` onto it symbol-for-symbol.
    Must run in that order: `attachFromDeck` attaches to whatever is Active. */
function fielded(
  state: GameState,
  seat: Seat,
  cardId: string,
  spec: readonly (readonly [string, number])[],
): GameState {
  let next = setActiveFromDeck(state, seat, cardId);
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

/** Slugma's body, paid `{R}`. */
const roastheat = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-roastheat", [["fix-fire-energy", 1]]);

/** Tapu Lele's body, paid `{P}{C}{C}` — enough for either printed attack, and the
    typed slot is paid by a typed card so no board can confuse the two. */
const mindcrush = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-mindcrush", [
    ["fix-psychic-energy", 1],
    ["fix-energy", 2],
  ]);

/** Centiskorch's body, paid `{R}{R}` — enough for "Singe" or "Charring Breath". */
const charbreath = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-charbreath", [["fix-fire-energy", 2]]);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every `CHECKUP_COIN_FLIP` in a batch, as `seat:status:result` strings. §13.2's cure
    flip is what makes an in-game Burn board seed-dependent, so it is READ rather than
    assumed. */
const flips = (events: GameEvent[]): string[] =>
  events
    .filter((e): e is Extract<GameEvent, { type: "CHECKUP_COIN_FLIP" }> => {
      return e.type === "CHECKUP_COIN_FLIP";
    })
    .map((e) => `${e.seat}:${e.status}:${e.result}`);

/** The three readings of the OPPONENT's Active reported together, so a rung says WHICH
    one it separates. `anyStatus` is the shipped member both new ones narrow. */
function readings(
  state: GameState,
  seat: Seat,
): { burned: boolean; confused: boolean; poisoned: boolean; anyStatus: boolean } {
  return {
    burned: conditionHolds(state, seat, BURNED),
    confused: conditionHolds(state, seat, CONFUSED),
    poisoned: conditionHolds(state, seat, POISONED),
    anyStatus: conditionHolds(state, seat, ANY_STATUS),
  };
}

describe("§1 — the price, RE-DERIVED: a 3:3 step, and a census widened from a phrase to a WORD", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the bonus residue steps by exactly TWO sentences and TWO printings", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    // The DEPARTURE and the SIZE are asserted separately: a guard that only checked
    // 22 / 26 could not tell "the two rows landed" from "a reader broke".
    expect(refused.some(([, s]) => s === ROASTING_HEAT)).toBe(false);
    expect(refused.some(([, s]) => s === MENTAL_CRUSH)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect([refused.length + 24, units(refused) + 28]).toEqual([24, 28]);
    expect([refused.length + 25, units(refused) + 30]).toEqual([25, 30]);
    expect([refused.length + 26, units(refused) + 32]).toEqual([26, 32]);
    expect([refused.length + 27, units(refused) + 34]).toEqual([27, 34]);
  });

  it("the CANCEL residue steps too — the third printing nobody was counting", () => {
    const refused = corpus().filter(([, s]) => NOTHING.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === CHARRING_BREATH)).toBe(false);
    expect(refused).toEqual([]);
    expect([refused.length + 1, units(refused) + 2]).toEqual([1, 2]);
    expect([refused.length + 2, units(refused) + 4]).toEqual([2, 4]);
    expect([refused.length + 3, units(refused) + 5]).toEqual([3, 5]);
  });

  it("THREE sentences, ONE legal printing each — a 3:3 step, which this run has not taken", () => {
    for (const sentence of [ROASTING_HEAT, MENTAL_CRUSH, CHARRING_BREATH]) {
      const records = corpus().filter(([, s]) => s === sentence);
      expect(records, sentence).toHaveLength(1);
      expect(units(records), sentence).toBe(1);
    }
    for (const clause of [BURNED_CLAUSE, CONFUSED_CLAUSE]) {
      const rows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === clause);
      expect(rows, clause).toHaveLength(1);
      expect(units(rows), clause).toBe(1);
    }
    const cancelRows = corpus().filter(
      ([, s]) => NOTHING.exec(s.trim())?.[1] === NOT_BURNED_CLAUSE,
    );
    expect(cancelRows).toHaveLength(1);
    expect(units(cancelRows)).toBe(1);
  });

  it("THE `status` TOKEN, PRICED FROM THE CATALOG: five printed words, THREE of them read", () => {
    const read = new Map<string, { sentences: number; printings: number }>();
    for (const word of PRINTED_STATUSES) {
      const rows = corpus().filter(
        ([, s]) => s.includes(`is ${word}`) || s.includes(`isn't ${word}`),
      );
      read.set(word, { sentences: rows.length, printings: units(rows) });
    }
    expect(Object.fromEntries(read)).toEqual({
      Poisoned: { sentences: 4, printings: 8 },
      Burned: { sentences: 2, printings: 2 },
      Confused: { sentences: 1, printings: 1 },
      Asleep: { sentences: 0, printings: 0 },
      Paralyzed: { sentences: 0, printings: 0 },
    });
    const tokenServes =
      (read.get("Burned")?.printings ?? 0) + (read.get("Confused")?.printings ?? 0);
    expect(tokenServes).toBe(3);
    const setters = corpus().filter(([, s]) =>
      PRINTED_STATUSES.some((w) => s.includes(`is now ${w}`)),
    );
    expect(setters.length).toBeGreaterThan(read.get("Poisoned")?.sentences ?? 0);
    expect(resolvedByAnyReader(SINGE)).toBe(true);
    expect(resolvedByAnyReader(PERPLEX)).toBe(true);
  });

  it("the two bands above this one did NOT move — nothing here re-priced them", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    const band2 = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band2).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect(byClause.size).toBe(0);
    expect([...byClause.values()]).toEqual([]);
    expect([...byClause].filter(([, n]) => n === 1)).toHaveLength(0);
  });
});

describe("§2 — the THREE keys, the printed BYTES, and two tables that must not meet", () => {
  it("maps both printed BONUS sentences onto the new members at the printed amounts", () => {
    expect(deriveAttackDamageBonus(ROASTING_HEAT)).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveBurned" } },
    });
    expect(deriveAttackDamageBonus(MENTAL_CRUSH)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveConfused" } },
    });
  });

  it("maps the printed NEGATION onto the POSITIVE member — the skeleton owns the 'isn't'", () => {
    expect(deriveAttackRequirement(CHARRING_BREATH)).toEqual({ kind: "opponentActiveBurned" });
    const bonus = deriveAttackDamageBonus(ROASTING_HEAT);
    expect(deriveAttackRequirement(CHARRING_BREATH)).toEqual(
      bonus?.count.kind === "boardCondition" ? bonus.count.cond : null,
    );
  });

  it("the KEYS are the printed bytes, pinned by CODE-POINT COUNT", () => {
    expect(ROASTING_HEAT).toHaveLength(77);
    expect(MENTAL_CRUSH).toHaveLength(79);
    expect(CHARRING_BREATH).toHaveLength(73);
    expect(BURNED_CLAUSE).toHaveLength(40);
    expect(CONFUSED_CLAUSE).toHaveLength(42);
    expect(NOT_BURNED_CLAUSE).toHaveLength(43);
    expect(BONUS.exec(ROASTING_HEAT)?.[1]).toBe(BURNED_CLAUSE);
    expect(BONUS.exec(MENTAL_CRUSH)?.[1]).toBe(CONFUSED_CLAUSE);
    expect(NOTHING.exec(CHARRING_BREATH)?.[1]).toBe(NOT_BURNED_CLAUSE);
    for (const key of [BURNED_CLAUSE, CONFUSED_CLAUSE, NOT_BURNED_CLAUSE]) {
      expect(key, key).toContain("é");
      expect(key, key).toContain("'");
      expect(key, key).not.toContain("’");
    }
    expect([...NOT_BURNED_CLAUSE].filter((ch) => ch === "'")).toHaveLength(2);
  });

  it("the Confused key and the Poisoned key are the SAME LENGTH, one word apart", () => {
    // The sharpest near-miss in the §12 corner of `CONDITIONAL_DAMAGE_CLAUSES`: two
    // rows, one board, one field-free reading, identical shape and identical code-point
    // count. A substring-keyed lookup would be undetectable here.
    expect(CONFUSED_CLAUSE).toHaveLength(42);
    expect("your opponent's Active Pokémon is Poisoned").toHaveLength(42);
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.",
      ),
    ).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "opponentActivePoisoned" } },
    });
  });

  it("the two TABLES cannot reach each other — D125's disjointness, both directions", () => {
    expect(deriveAttackRequirement(ROASTING_HEAT)).toBeNull();
    expect(deriveAttackRequirement(MENTAL_CRUSH)).toBeNull();
    expect(deriveAttackDamageBonus(CHARRING_BREATH)).toBeNull();
    // …and the CONSTRUCTED crossings — each clause under the OTHER consequent — are
    // refused by every reader, so neither table has quietly learned the other's key.
    for (const crossed of [
      "If your opponent's Active Pokémon is Burned, this attack does nothing.",
      "If your opponent's Active Pokémon is Confused, this attack does nothing.",
      "If your opponent's Active Pokémon isn't Burned, this attack does 40 more damage.",
      "If your opponent's Active Pokémon isn't Confused, this attack does 90 more damage.",
    ]) {
      expect(resolvedByAnyReader(crossed), crossed).toBe(false);
    }
  });

  it("nine constructed rewrites resolve to NOTHING — the printed words are the key", () => {
    for (const near of [
      // the SEAT flipped — this is the same clause the pool prints for Poison on the
      // OTHER side, and the possessive is the only thing separating them.
      "If this Pokémon is Burned, this attack does 40 more damage.",
      "If this Pokémon is Confused, this attack does 90 more damage.",
      // a status the catalog never reads — the two values a token would have admitted.
      "If your opponent's Active Pokémon is Asleep, this attack does 40 more damage.",
      "If your opponent's Active Pokémon is Paralyzed, this attack does 90 more damage.",
      // the SETTER wording under a bonus consequent
      "If your opponent's Active Pokémon is now Burned, this attack does 40 more damage.",
      // the Bench instead of the Active Spot
      "If your opponent's Benched Pokémon is Burned, this attack does 40 more damage.",
      // the plural possessive dropped
      "If the Defending Pokémon is Confused, this attack does 90 more damage.",
      // "affected by" — the WIDER member's own wording, narrowed to one word
      "If your opponent's Active Pokémon is affected by Burned, this attack does 40 more damage.",
      // a curly apostrophe AND a lookalike é together is still a miss on the ROTATION
      // word, so this one proves the fold is not doing the work a wrong word would need.
      "If your opponent's Active Pokémon is Confuzed, this attack does 90 more damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // …and all three taken sentences ARE resolved, so the loop above is a statement
    // about those nine strings rather than about the readers being asleep.
    for (const taken of [ROASTING_HEAT, MENTAL_CRUSH, CHARRING_BREATH]) {
      expect(resolvedByAnyReader(taken), taken).toBe(true);
    }
  });

  it("both notes ROUND-TRIP to their bonus keys, and neither to the cancel key", () => {
    expect(conditionNote(BURNED)).toBe(BURNED_CLAUSE);
    expect(conditionNote(CONFUSED)).toBe(CONFUSED_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(BURNED)}, this attack does 40 more damage.`),
    ).toEqual({ per: 40, count: { kind: "boardCondition", cond: BURNED } });
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(CONFUSED)}, this attack does 90 more damage.`),
    ).toEqual({ per: 90, count: { kind: "boardCondition", cond: CONFUSED } });
    expect(conditionNote(BURNED)).not.toBe(NOT_BURNED_CLAUSE);
    expect(conditionNote(ANY_STATUS)).toBe(
      "your opponent's Active Pokémon is affected by a Special Condition",
    );
    expect(conditionNote(POISONED)).toBe("your opponent's Active Pokémon is Poisoned");
    expect(
      new Set([
        conditionNote(BURNED),
        conditionNote(CONFUSED),
        conditionNote(POISONED),
        conditionNote(ANY_STATUS),
      ]).size,
    ).toBe(4);
  });
});

describe("§3 — BURNED: armed by the game, and CURED by the game", () => {
  it("vs a CLEAN Active the printed 10 stands", () => {
    const state = roastheat(board(30));
    expect(state.players.p2.active?.conditions.burned).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 10, dealt: 10 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("vs a BURNED Active it adds the whole 40 → 50", () => {
    const state = setConditions(roastheat(board(31)), "p2", { burned: true });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 40, dealt: 50 });
  });

  it("is armed by the GAME — Singe one turn, Roasting Heat the next, with the CURE FLIPS read", () => {
    let state = charbreath(board(5));
    const singe = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Singe deals nothing itself — the only damage in its batch is §13.2's.
    expect(find(singe.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(singe.events)).toContain("STATUS_APPLIED");
    expect(flips(singe.events)).toEqual(["p2:burned:tails"]);
    state = singe.state;
    expect(state.players.p2.active?.conditions.burned).toBe(true);
    expect(state.players.p2.active?.damage).toBe(20); // one Checkup tick

    const back = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(flips(back.events)).toEqual(["p2:burned:tails"]);
    state = back.state;
    expect(state.players.p2.active?.conditions.burned).toBe(true);
    expect(state.players.p2.active?.damage).toBe(40); // a second tick, on the way back
    expect(state.players.p1.active?.damage).toBe(0); // Centiskorch was never Burned

    // Swap the attacker: Slugma takes the spot Centiskorch was holding. THE BURN IS
    // ON THE OTHER SIDE OF THE TABLE, so nothing about moving YOUR Active touches it.
    const { events } = mustApply(roastheat(state), { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 40, dealt: 50 });
  });

  it("THE DISARM, and it is the GAME's: a HEADS cure flip puts the bonus back to 10", () => {
    let state = charbreath(board(2));
    const singe = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(flips(singe.events)).toEqual(["p2:burned:heads"]);
    expect(types(singe.events)).toContain("STATUS_CLEARED");
    state = singe.state;
    expect(state.players.p2.active?.conditions.burned).toBe(false);
    expect(state.players.p2.active?.damage).toBe(20); // the tick landed before the cure

    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    // …and with the Burn gone there is no second tick and no second flip.
    expect(state.players.p2.active?.damage).toBe(20);
    const { events } = mustApply(roastheat(state), { type: "attack", seat: "p1", index: 0 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 10, dealt: 10 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("THE OTHER CONSEQUENT: Charring Breath CANCELS on a clean Active and lands 180 on a Burned one", () => {
    // The same member, read through `ATTACK_REQUIREMENT_CLAUSES`. A cancelled attack
    // is an attack that was USED: no damage, and the turn still ends.
    const clean = mustApply(charbreath(board(32)), { type: "attack", seat: "p1", index: 1 });
    expect(find(clean.events, "ATTACK_FAILED")).toMatchObject({
      seat: "p1",
      reason: "requirement",
    });
    expect(find(clean.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(types(clean.events)).toContain("TURN_ENDED");
    expect(types(clean.events)).not.toContain("ATTACK_EFFECT_SKIPPED");

    const burned = mustApply(setConditions(charbreath(board(32)), "p2", { burned: true }), {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    expect(find(burned.events, "ATTACK_FAILED")).toBeUndefined();
    expect(find(burned.events, "DAMAGE_DEALT")).toMatchObject({ base: 180, dealt: 180 });
  });

  it("and the cancel reads BURN specifically — Confusion does not unlock it", () => {
    const confused = setConditions(charbreath(board(33)), "p2", { rotation: "confused" });
    expect(readings(confused, "p1")).toEqual({
      burned: false,
      confused: true,
      poisoned: false,
      anyStatus: true,
    });
    const { events } = mustApply(confused, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
  });
});

describe("§4 — CONFUSED: armed by the card itself, disarmed by §11's retreat", () => {
  it("vs a CLEAN Active the printed 90 stands", () => {
    const state = mindcrush(board(34));
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("vs a CONFUSED Active it adds the whole 90 → 180", () => {
    const state = setConditions(mindcrush(board(35)), "p2", { rotation: "confused" });
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("is armed by the CARD ITSELF — Perplex one turn, Mental Crush the next, and NO cure flip", () => {
    let state = mindcrush(board(36));
    const perplex = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(perplex.events, "DAMAGE_DEALT")).toMatchObject({ base: 20, dealt: 20 });
    expect(types(perplex.events)).toContain("STATUS_APPLIED");
    expect(flips(perplex.events)).toEqual([]);
    state = perplex.state;
    expect(state.players.p2.active?.conditions.rotation).toBe("confused");

    const back = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(flips(back.events)).toEqual([]);
    state = back.state;
    expect(state.players.p2.active?.conditions.rotation).toBe("confused");

    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
    // 20 + 180 against fix-bigbody's 200 — the bonus is what makes it lethal (90 alone
    // would have left the body on 90).
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("THE DISARM, and it is the GAME's: P2 RETREATS and the bonus goes back to 90", () => {
    let state = mustApply(mindcrush(board(37)), { type: "attack", seat: "p1", index: 0 }).state;
    expect(state.players.p2.active?.conditions.rotation).toBe("confused");
    expect(conditionHolds(state, "p1", CONFUSED)).toBe(true);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const active = state.players.p2.active;
    if (active === null) throw new Error("p2 has no Active");
    // …and P2 is free to retreat while Confused, which is the §12 reading this member
    // depends on and `isImmobilized` denies for the other two rotation values.
    expect(isImmobilized(active.conditions)).toBe(false);
    const retreated = mustApply(state, {
      type: "retreat",
      seat: "p2",
      discardEnergy: [...active.energy],
      promoteBenchIndex: 0,
    });
    expect(types(retreated.events)).toContain("RETREATED");
    expect(find(retreated.events, "STATUS_CLEARED")).toMatchObject({
      seat: "p2",
      statuses: ["confused"],
    });
    state = retreated.state;
    expect(state.players.p2.active?.conditions.rotation).toBe("none");
    expect(conditionHolds(state, "p1", CONFUSED)).toBe(false);

    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 90, dealt: 90 });
    expect(dealt?.scaled).toBeUndefined();
  });
});

describe("§5 — the §12 cluster: four rows, one board, and the NESTING swept", () => {
  /** Every condition set the model can hold, as `Partial<SpecialConditions>` — the
      rotation's four values, the two independent flags, and the combinations that
      matter. The whole point is that a rung says which reading it separates. */
  const CASES: readonly (readonly [string, Partial<SpecialConditions>])[] = [
    ["clean", {}],
    ["burned", { burned: true }],
    ["confused", { rotation: "confused" }],
    ["asleep", { rotation: "asleep" }],
    ["paralyzed", { rotation: "paralyzed" }],
    ["poisoned", { poisonDamage: 10 }],
    ["burned+confused", { burned: true, rotation: "confused" }],
    ["burned+asleep", { burned: true, rotation: "asleep" }],
    ["confused+poisoned", { rotation: "confused", poisonDamage: 10 }],
    ["all three", { burned: true, rotation: "confused", poisonDamage: 10, confusionDamage: 30 }],
  ];

  it("the four members answer the WHOLE condition space, and none is an alias of another", () => {
    const table = new Map<string, ReturnType<typeof readings>>();
    for (const [label, conditions] of CASES) {
      const state = setConditions(board(40), "p2", conditions);
      table.set(label, readings(state, "p1"));
    }
    expect(Object.fromEntries(table)).toEqual({
      clean: { burned: false, confused: false, poisoned: false, anyStatus: false },
      burned: { burned: true, confused: false, poisoned: false, anyStatus: true },
      confused: { burned: false, confused: true, poisoned: false, anyStatus: true },
      asleep: { burned: false, confused: false, poisoned: false, anyStatus: true },
      paralyzed: { burned: false, confused: false, poisoned: false, anyStatus: true },
      poisoned: { burned: false, confused: false, poisoned: true, anyStatus: true },
      "burned+confused": { burned: true, confused: true, poisoned: false, anyStatus: true },
      "burned+asleep": { burned: true, confused: false, poisoned: false, anyStatus: true },
      "confused+poisoned": { burned: false, confused: true, poisoned: true, anyStatus: true },
      "all three": { burned: true, confused: true, poisoned: true, anyStatus: true },
    });
  });

  it("the NESTING is swept, not asserted once: each named status IMPLIES the wide member", () => {
    let wideAndUnnamed = 0;
    for (const [label, conditions] of CASES) {
      const state = setConditions(board(41), "p2", conditions);
      const r = readings(state, "p1");
      if (r.burned) expect(r.anyStatus, label).toBe(true);
      if (r.confused) expect(r.anyStatus, label).toBe(true);
      if (r.poisoned) expect(r.anyStatus, label).toBe(true);
      if (r.anyStatus && !r.burned && !r.confused && !r.poisoned) wideAndUnnamed += 1;
      // …and the projection the arms read is the SAME list the STATUS_CLEARED events
      // and the status chips are built from, so "is Burned" can never drift from what
      // the board shows.
      const active = state.players.p2.active;
      if (active !== null) {
        expect(presentStatuses(active.conditions).includes("burned"), label).toBe(r.burned);
        expect(presentStatuses(active.conditions).includes("confused"), label).toBe(r.confused);
      }
    }
    // Asleep and Paralyzed: two boards where the wide member is TRUE and all three
    // named ones are FALSE, which is what stops this sweep from being vacuous.
    expect(wideAndUnnamed).toBe(2);
  });

  it("ONE board carrying BOTH statuses pays BOTH bonuses, each at its own printed amount", () => {
    // The two attacks are declared off the SAME state, so nothing but the clause
    // differs between the runs — and the amounts are the printed 40 and 90, not one
    // number twice.
    const both = setConditions(board(42), "p2", { burned: true, rotation: "confused" });
    const roast = mustApply(roastheat(both), { type: "attack", seat: "p1", index: 0 }).events;
    expect(find(roast, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 40, dealt: 50 });
    const crush = mustApply(mindcrush(both), { type: "attack", seat: "p1", index: 1 }).events;
    expect(find(crush, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("a BURNED defender does NOT pay the Confused bonus, and vice versa", () => {
    // The crossing that a copied arm would silently pass. Two boards, each carrying
    // exactly one status, each read by the attack that names the OTHER one.
    const burnedOnly = setConditions(board(43), "p2", { burned: true });
    const crush = mustApply(mindcrush(burnedOnly), { type: "attack", seat: "p1", index: 1 }).events;
    const crushDealt = find(crush, "DAMAGE_DEALT");
    expect(crushDealt).toMatchObject({ base: 90, dealt: 90 });
    expect(crushDealt?.scaled).toBeUndefined();

    const confusedOnly = setConditions(board(44), "p2", { rotation: "confused" });
    const roast = mustApply(roastheat(confusedOnly), {
      type: "attack",
      seat: "p1",
      index: 0,
    }).events;
    const roastDealt = find(roast, "DAMAGE_DEALT");
    expect(roastDealt).toMatchObject({ base: 10, dealt: 10 });
    expect(roastDealt?.scaled).toBeUndefined();
  });
});

describe("§6 — the SEAT axis: cross-board, per seat, and FALSE with no Active", () => {
  it("both members read the OPPONENT's Active and answer per seat", () => {
    const burned = setConditions(board(45), "p2", { burned: true });
    expect(conditionHolds(burned, "p1", BURNED)).toBe(true);
    expect(conditionHolds(burned, "p2", BURNED)).toBe(false);
    const mirrored = setConditions(board(45), "p1", { burned: true });
    expect(conditionHolds(mirrored, "p2", BURNED)).toBe(true);
    expect(conditionHolds(mirrored, "p1", BURNED)).toBe(false);

    const confused = setConditions(board(46), "p2", { rotation: "confused" });
    expect(conditionHolds(confused, "p1", CONFUSED)).toBe(true);
    expect(conditionHolds(confused, "p2", CONFUSED)).toBe(false);
    const mirroredC = setConditions(board(46), "p1", { rotation: "confused" });
    expect(conditionHolds(mirroredC, "p2", CONFUSED)).toBe(true);
    expect(conditionHolds(mirroredC, "p1", CONFUSED)).toBe(false);
  });

  it("a P2 declaration pays the same bonuses — not a p1-shaped reading", () => {
    const burned = setConditions(boardP2(47), "p1", { burned: true });
    const roast = mustApply(roastheat(burned, "p2"), {
      type: "attack",
      seat: "p2",
      index: 0,
    }).events;
    expect(find(roast, "DAMAGE_DEALT")).toMatchObject({ base: 10, scaled: 40, dealt: 50 });

    const confused = setConditions(boardP2(48), "p1", { rotation: "confused" });
    const crush = mustApply(mindcrush(confused, "p2"), {
      type: "attack",
      seat: "p2",
      index: 1,
    }).events;
    expect(find(crush, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 90, dealt: 180 });
  });

  it("an EMPTY Active Spot answers FALSE rather than throwing — for both members", () => {
    // The live attack gate guarantees a Defending Pokémon, so no board reachable through
    // `attack` presents a null Active; only a direct `conditionHolds` call finds this
    // edge, and both new Active-reading members have to answer FALSE.
    const state = board(49);
    const side = state.players.p2;
    const active = side.active;
    if (active === null) throw new Error("p2 has no Active");
    const empty: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...side,
          active: null,
          discard: [...side.discard, ...active.stack, ...active.energy, ...active.tools],
        },
      },
    };
    expect(conditionHolds(empty, "p1", BURNED)).toBe(false);
    expect(conditionHolds(empty, "p1", CONFUSED)).toBe(false);
    // …and the wide member they narrow answers FALSE on the same board, so the three
    // agree about the edge as well as about the boards.
    expect(conditionHolds(empty, "p1", ANY_STATUS)).toBe(false);
  });
});
