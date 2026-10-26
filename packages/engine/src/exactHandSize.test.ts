import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader as readByAny,
} from "./censusAttackCorpus";
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
import type { BoardCondition, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  EXACT_HAND_SIZE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

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
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackCancelRequirement,
];

const TRIO_CHEEHOO = "If you don't have exactly 3 cards in your hand, this attack does nothing.";
const CURSED_SLUG =
  "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.";
const EXTRASENSORY =
  "If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.";

const EXACT_CLAUSE = "you don't have exactly 3 cards in your hand";

const EXACTLY_3: BoardCondition = { kind: "yourHandExactly", count: 3 };
const THEIRS_AT_MOST_3: BoardCondition = { kind: "opponentHandAtMost", count: 3 };
const HANDS_LEVEL: BoardCondition = { kind: "handSizesEqual" };

const SIZE_CEILING = [] as const;
const CEILING_TAKEN_AT_D445 = "This attack does 30 damage for each card in your opponent's hand.";

const CEILING_TAKEN_AT_D516 =
  "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand.";
const CEILING_TAKEN_AT_D385 =
  "You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage.";

// ── boards ─────────────────────────────────────────────────────────────────────

function setHandSize(state: GameState, seat: Seat, size: number): GameState {
  const side = state.players[seat];
  if (size > side.hand.length) throw new Error(`${seat} hand is ${side.hand.length}, cannot grow`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        hand: side.hand.slice(0, size),
        discard: [...side.discard, ...side.hand.slice(size)],
      },
    },
  };
}

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: EXACT_HAND_SIZE_DECK, p2: EXACT_HAND_SIZE_DECK },
    { first: "p2", extraDraw: { p1: 0, p2: 0 }, active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

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

/** Alolan Dugtrio's body. NO Energy is paid, because the card prints no cost — the
    requirement is the only thing between this body and 120 damage. */
const trioCheehoo = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "fix-triocheehoo", []);

/** Absol ex's body, paid {D}{D}{D} — the WRONG-SEAT control. */
const cursedSlug = (state: GameState, seat: Seat = "p1"): GameState =>
  fielded(state, seat, "sv03-135", [["fix-dark-energy", 3]]);

describe("§1 — the price, RE-DERIVED: the does-nothing skeleton goes EMPTY", () => {
  it("D418 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the CANCEL residue reaches ZERO — there is no sentence left to name", () => {
    const refused = corpus().filter(([, s]) => NOTHING.test(s.trim()) && !readByAny(s));
    expect(refused.some(([, s]) => s === TRIO_CHEEHOO)).toBe(false);
    expect(refused).toEqual([]);
    expect(units(refused)).toBe(0);
    expect([refused.length + 1, units(refused) + 2]).toEqual([1, 2]);
    expect([refused.length + 2, units(refused) + 4]).toEqual([2, 4]);
    expect([refused.length + 3, units(refused) + 5]).toEqual([3, 5]);
  });

  it("the BONUS residue STOOD STILL for D379 — asserted as an OFFSET, not as a head", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !readByAny(s));
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect([refused.length + 21, units(refused) + 25]).toEqual([21, 25]);
    expect([refused.length + 22, units(refused) + 26]).toEqual([22, 26]);
  });

  it("BOTH CONSEQUENTS ASKED, AND THE BONUS SIDE IS EMPTY — a first for this family", () => {
    const cancelRows = corpus().filter(([, s]) => s === TRIO_CHEEHOO);
    expect(cancelRows).toHaveLength(1);
    expect(units(cancelRows)).toBe(2);
    // No bonus sentence anywhere carries an own-hand EXACT read…
    const ownHandExactBonus = corpus().filter(([, s]) => {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      return clause.includes("exactly") && clause.includes("in your hand");
    });
    expect(ownHandExactBonus).toEqual([]);
    const handBonus = corpus().filter(([, s]) =>
      (BONUS.exec(s.trim())?.[1] ?? "").includes("hand"),
    );
    expect(handBonus).toHaveLength(4);
    expect(handBonus.filter(([, s]) => readByAny(s))).toHaveLength(4);
    for (const sentence of [CURSED_SLUG, EXTRASENSORY]) {
      expect(
        handBonus.some(([, s]) => s === sentence),
        sentence,
      ).toBe(true);
      expect(readByAny(sentence), sentence).toBe(true);
    }
    expect(handBonus.filter(([, s]) => !readByAny(s)).map(([, s]) => s)).toEqual([]);
    for (const [, s] of handBonus) {
      const bonus = deriveAttackDamageBonus(s);
      const cond = bonus?.count.kind === "boardCondition" ? bonus.count.cond : null;
      expect(cond?.kind, s).not.toBe("yourHandExactly");
    }
  });

  it("THE SHAPE ANSWER, MEASURED: 'exactly 3' is the column's ONLY own-hand exact read", () => {
    // The rung that makes `count: number` a result rather than a preference, and the
    // one that reddens if the catalog ever warrants `counts`.
    const ownHandExact = corpus().filter(
      ([, s]) => s.includes("exactly") && s.includes("cards in your hand"),
    );
    expect(ownHandExact.map(([, s]) => s)).toEqual([TRIO_CHEEHOO]);
    const prizeDisjunction = corpus().filter(([, s]) => /exactly \d+ or \d+ Prize/.test(s));
    expect(prizeDisjunction).toHaveLength(1);
    expect(corpus().filter(([, s]) => /exactly \d+ or \d+ cards in your hand/.test(s))).toEqual([]);
    // …and there is no own-hand THRESHOLD either, which is the other shape this
    // member could have been mistaken for. Every "or fewer"/"or more" hand clause in
    // the column reads the OPPONENT's hand.
    for (const [, s] of corpus().filter(([, s]) =>
      /or (fewer|more) cards in (your|their) hand/.test(s),
    )) {
      expect(s, s).toContain("in their hand");
      expect(s, s).not.toContain("in your hand");
    }
  });

  it("the requirement table's reach goes 8 s / 16 p → 9 s / 18 p, and the openers are ALL of them", () => {
    const openers = corpus().filter(([, s]) => /^If .+?, this attack does nothing\./.test(s));
    expect([openers.length, units(openers)]).toEqual([9, 18]);
    const mapped = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([mapped.length, units(mapped)]).toEqual([9, 18]);
    const unmapped = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([unmapped.length, units(unmapped)]).toEqual([0, 0]);
    // The parts sum, which is what makes a partition a partition — and here one part
    // is the whole, which is the milestone.
    expect(mapped.length + unmapped.length).toBe(openers.length);
    expect(units(mapped) + units(unmapped)).toBe(units(openers));
    expect(deriveAttackRequirement("Discard your hand and draw 6 cards.")).toBeNull();
    expect(corpus().filter(([, s]) => deriveAttackRequirement(s) !== null)).toHaveLength(9);
  });

  it("THE CEILING IS PRICED AND LEFT — no remaining hand-SIZE read is a BoardCondition", () => {
    for (const sentence of SIZE_CEILING) {
      const rows = corpus().filter(([, s]) => s === sentence);
      expect(rows, sentence).toHaveLength(1);
      expect(readByAny(sentence), sentence).toBe(false);
    }
    const sizeReads = corpus().filter(([, s]) =>
      /\bcards? in (?:your|their)(?: opponent's)? hand\b/.test(s),
    );
    expect([sizeReads.length, units(sizeReads)]).toEqual([9, 22]);
    expect(sizeReads.filter(([, s]) => !readByAny(s))).toEqual([]);
    expect(corpus().filter(([, s]) => s === CEILING_TAKEN_AT_D516)).toHaveLength(1);
    expect(readByAny(CEILING_TAKEN_AT_D516)).toBe(true);
    expect(deriveAttackEffect(CEILING_TAKEN_AT_D516)).toEqual([
      { op: "handRefresh", who: "you", draw: { kind: "opponentHandSize" } },
    ]);
    expect(deriveAttackRequirement(CEILING_TAKEN_AT_D516)).toBeNull();
    expect(corpus().filter(([, s]) => s === CEILING_TAKEN_AT_D385)).toHaveLength(1);
    expect(readByAny(CEILING_TAKEN_AT_D385)).toBe(true);
    expect(corpus().filter(([, s]) => s === CEILING_TAKEN_AT_D445)).toHaveLength(1);
    expect(readByAny(CEILING_TAKEN_AT_D445)).toBe(true);
    expect(deriveAttackDamageMultiplier(CEILING_TAKEN_AT_D445)).toEqual({
      per: 30,
      count: { kind: "cardsInOpponentHand", filter: { kind: "anyCard" } },
    });
    expect(deriveAttackDamageBonus(CEILING_TAKEN_AT_D445)).toBeNull();
    expect(SIZE_CEILING).toHaveLength(0);
    expect(deriveAttackOptionalCostBoost(CEILING_TAKEN_AT_D385)).not.toBeNull();
    expect(deriveAttackCancelRequirement(CEILING_TAKEN_AT_D385)).toBeNull();
    expect(deriveAttackDiscardScaledBoost(CEILING_TAKEN_AT_D385)).toBeNull();
    const discardHand = corpus().filter(([, s]) => s === "Discard your hand and draw 6 cards.");
    expect(discardHand).toHaveLength(1);
    expect(units(discardHand)).toBe(7);
    expect(readByAny("Discard your hand and draw 6 cards.")).toBe(true);
    expect(deriveAttackEffect("Discard your hand and draw 6 cards.")).toEqual([
      { op: "discardHand" },
      { op: "drawCards", count: 6 },
    ]);
  });
});

describe("§2 — the key, the printed BYTES, and the tables that must not meet", () => {
  it("maps the printed NEGATION onto the POSITIVE member at the printed count", () => {
    expect(deriveAttackRequirement(TRIO_CHEEHOO)).toEqual({ kind: "yourHandExactly", count: 3 });
  });

  it("the KEY is the printed bytes, pinned by CODE-POINT COUNT", () => {
    expect(TRIO_CHEEHOO).toHaveLength(73);
    expect(EXACT_CLAUSE).toHaveLength(43);
    expect(NOTHING.exec(TRIO_CHEEHOO)?.[1]).toBe(EXACT_CLAUSE);
    expect(EXACT_CLAUSE).toContain("'");
    expect(deriveAttackRequirement(TRIO_CHEEHOO.replace("don't", "don’t"))).toEqual(EXACTLY_3);
    // …and NO é, which is the ordinary case for a clause that never says "Pokémon".
    expect(EXACT_CLAUSE).not.toContain("é");
    // The printed noun is plural at 3 and the digit is a DIGIT, not a word — both are
    // transcription traps this table has paid for elsewhere.
    expect(EXACT_CLAUSE).toContain("exactly 3 cards");
    expect(EXACT_CLAUSE).not.toContain("three");
  });

  it("the two TABLES cannot reach each other — D125's disjointness, both directions", () => {
    // A clause meaning "the attack does N more damage if X" must never be reachable
    // from a sentence meaning "the attack does nothing if X", and vice versa. This
    // member sits in ONE table, so the crossing is asserted from both ends.
    expect(deriveAttackDamageBonus(`If ${EXACT_CLAUSE}, this attack does 120 more damage.`)).toBe(
      null,
    );
    expect(
      deriveAttackDamageBonus(
        "If you have exactly 3 cards in your hand, this attack does 120 more damage.",
      ),
    ).toBeNull();
    expect(deriveAttackRequirement(TRIO_CHEEHOO)).not.toBeNull();
  });

  it("refuses six constructed rewrites the catalog does not print", () => {
    // Every one of these reads like the printed sentence and is not it. A substring,
    // a fuzzy lookup or a `\d+` pattern would take at least three — and the FIRST is
    // the one `fix-sawk`'s rider drives on a real board in §6.
    for (const clause of [
      "you don't have exactly 4 cards in your hand",
      "you don't have exactly 3 cards in hand",
      "you don't have exactly 3 Pokémon in your hand",
      "you have exactly 3 cards in your hand",
      "your opponent doesn't have exactly 3 cards in their hand",
      "you don't have 3 or fewer cards in your hand",
    ]) {
      expect(deriveAttackRequirement(`If ${clause}, this attack does nothing.`), clause).toBeNull();
    }
  });

  it("the reject fragment is the POSITIVE reading, which the catalog never prints", () => {
    expect(conditionNote(EXACTLY_3)).toBe("you have exactly 3 cards in your hand");
    expect(conditionNote(EXACTLY_3)).not.toBe(EXACT_CLAUSE);
    // …and it is built from the PARAMETER, so a member buried in the name would fail
    // here. This is the only place the un-printed counts are exercised at all.
    expect(conditionNote({ kind: "yourHandExactly", count: 5 })).toBe(
      "you have exactly 5 cards in your hand",
    );
    expect(conditionNote({ kind: "yourHandExactly", count: 1 })).toBe(
      "you have exactly 1 card in your hand",
    );
    // The three hand members answer differently, which is the whole point of there
    // being three.
    expect(conditionNote(EXACTLY_3)).not.toBe(conditionNote(THEIRS_AT_MOST_3));
    expect(conditionNote(EXACTLY_3)).not.toBe(conditionNote(HANDS_LEVEL));
  });
});

describe("§3 — the predicate: STRICT equality on the ATTACKER's own hand", () => {
  it("the boundary swept 0…8 — TRUE at exactly one size, and never at 2 or 4", () => {
    // The rung the comparator lives or dies on. `>=` is green at 3 and wrong at 4…8;
    // `<=` is green at 3 and wrong at 0…2. Both are one board away from correct, so
    // the sweep asserts the WHOLE curve rather than the true point.
    const base = board(90);
    const trueSizes: number[] = [];
    for (let size = 0; size <= 7; size += 1) {
      const state = setHandSize(base, "p1", size);
      expect(state.players.p1.hand).toHaveLength(size);
      if (conditionHolds(state, "p1", EXACTLY_3)) trueSizes.push(size);
    }
    expect(trueSizes).toEqual([3]);
  });

  it("reads the ATTACKER's hand and not the far one — the seat half of the near miss", () => {
    let state = setHandSize(board(91), "p1", 4);
    state = setHandSize(state, "p2", 3);
    expect([state.players.p1.hand.length, state.players.p2.hand.length]).toEqual([4, 3]);
    expect(conditionHolds(state, "p1", EXACTLY_3)).toBe(false);
    expect(conditionHolds(state, "p1", THEIRS_AT_MOST_3)).toBe(true);
    // …and the mirror: P1 at 3, P2 at 7. An arm reading the far hand answers false on
    // the line the printed card resolves.
    let mirror = setHandSize(board(92), "p1", 3);
    expect(mirror.players.p2.hand.length).toBe(7);
    expect(conditionHolds(mirror, "p1", EXACTLY_3)).toBe(true);
    expect(conditionHolds(mirror, "p1", THEIRS_AT_MOST_3)).toBe(false);
    mirror = setHandSize(mirror, "p2", 5);
    expect(conditionHolds(mirror, "p1", EXACTLY_3)).toBe(true);
    expect(conditionHolds(mirror, "p2", EXACTLY_3)).toBe(false);
  });

  it("it is not `handSizesEqual` in disguise — the level board is the discriminator", () => {
    let level = setHandSize(board(93), "p1", 5);
    level = setHandSize(level, "p2", 5);
    expect(conditionHolds(level, "p1", HANDS_LEVEL)).toBe(true);
    expect(conditionHolds(level, "p1", EXACTLY_3)).toBe(false);
    // …and both true at once only when the shared size IS 3, which the sweep pins so
    // "they agree here" is a fact about the board and not about the members.
    let three = setHandSize(board(94), "p1", 3);
    three = setHandSize(three, "p2", 3);
    expect(conditionHolds(three, "p1", HANDS_LEVEL)).toBe(true);
    expect(conditionHolds(three, "p1", EXACTLY_3)).toBe(true);
  });

  it("the parameter is honoured — the same board, three different counts", () => {
    const state = setHandSize(board(95), "p1", 4);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 3 })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 4 })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourHandExactly", count: 5 })).toBe(false);
  });
});

describe("§4 — on a board: 2 / 3 / 4 cards in hand, and 120 lands on exactly one", () => {
  it("CANCELS with TWO cards in hand — the `<=` reading's board", () => {
    const state = setHandSize(trioCheehoo(board(96)), "p1", 2);
    expect(state.players.p1.hand).toHaveLength(2);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("RESOLVES with THREE — the whole printed 120, off a body that paid NO Energy", () => {
    const state = setHandSize(trioCheehoo(board(97)), "p1", 3);
    expect(state.players.p1.hand).toHaveLength(3);
    // The attacker carries no Energy at all, because the card prints no cost. Nothing
    // else on this board could explain the 120.
    expect(state.players.p1.active?.energy).toEqual([]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 120, dealt: 120 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("CANCELS with FOUR — the `>=` reading's board, one card the other way", () => {
    const state = setHandSize(trioCheehoo(board(98)), "p1", 4);
    expect(state.players.p1.hand).toHaveLength(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("P1 at FOUR and P2 at THREE: Trio-Cheehoo CANCELS while Cursed Slug FIRES", () => {
    let base = setHandSize(board(99), "p1", 4);
    base = setHandSize(base, "p2", 3);
    const cancelled = mustApply(trioCheehoo(base), { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(cancelled.events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(cancelled.events)).not.toContain("DAMAGE_DEALT");
    const control = mustApply(cursedSlug(base), { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(control.events, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      scaled: 120,
      dealt: 220,
    });
    // Neither is flagged: both sentences are read, they just answer differently.
    expect(types(cancelled.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(control.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("cancels and resolves identically from the FAR SEAT", () => {
    const short = setHandSize(trioCheehoo(boardP2(100), "p2"), "p2", 2);
    const cancelled = mustApply(short, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(cancelled.events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    const exact = setHandSize(trioCheehoo(boardP2(101), "p2"), "p2", 3);
    expect(exact.players.p1.hand.length).not.toBe(3);
    const { events } = mustApply(exact, { type: "attack", seat: "p2", index: 0 });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 120, dealt: 120 });
  });
});

describe("§5 — ARMED BY THE GAME: the hand played down to three, with no surgery", () => {
  it("P1 benches Basics and attaches an Energy — and the count the clause reads is the game's", () => {
    let state = board(3);
    // Field the attacker FIRST: `setActiveFromDeck` displaces the current Active onto
    // the Bench, and the shed below fills that Bench.
    state = trioCheehoo(state);
    expect(state.players.p1.hand.length).toBe(7);
    while (state.players.p1.hand.length > 4 && state.players.p1.bench.length < 5) {
      const uid = state.players.p1.hand.find(
        (u) => FIXTURE_POOL[state.cardIdByUid[u] ?? ""]?.stage === "Basic",
      );
      if (uid === undefined) break;
      state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    }
    expect(state.players.p1.hand.length).toBe(4);
    // …and the last card goes as the turn's one Energy attachment. It pays nothing —
    // Trio-Cheehoo has no cost — so its only effect on the outcome is the card it
    // removes from the hand, which is exactly the quantity under test.
    const energyUid = state.players.p1.hand.find(
      (u) => FIXTURE_POOL[state.cardIdByUid[u] ?? ""]?.category === "Energy",
    );
    expect(energyUid).toBeDefined();
    state = mustApply(state, {
      type: "attachEnergy",
      seat: "p1",
      uid: energyUid ?? "",
      target: { spot: "active" },
    }).state;
    expect(state.players.p1.hand.length).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_FAILED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 120, dealt: 120 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("one bench play SHORT of three and the same board cancels — the shed is what armed it", () => {
    // The control that stops the case above being "an attack that always resolves":
    // the identical script, stopped one play earlier, leaves FOUR in hand and the
    // attack is refused for the printed reason.
    let state = trioCheehoo(board(3));
    while (state.players.p1.hand.length > 4 && state.players.p1.bench.length < 5) {
      const uid = state.players.p1.hand.find(
        (u) => FIXTURE_POOL[state.cardIdByUid[u] ?? ""]?.stage === "Basic",
      );
      if (uid === undefined) break;
      state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
    }
    expect(state.players.p1.hand.length).toBe(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "ATTACK_FAILED")).toMatchObject({ reason: "requirement" });
    expect(types(events)).not.toContain("DAMAGE_DEALT");
  });
});

describe("§6 — the guard this slice EXPIRED, and what it did NOT buy", () => {
  it("the accounting guard's subject is now CONSTRUCTED — and the construction still works", () => {
    const rider = FIXTURE_POOL["fix-sawk"]?.attacks?.[2]?.effect ?? "";
    expect(rider).toContain("exactly 4 cards in your hand");
    expect(deriveAttackRequirement(rider)).toBeNull();
    expect(deriveAttackRequirement(TRIO_CHEEHOO)).not.toBeNull();
    expect(
      deriveAttackRequirement(
        "If you don't have exactly 4 cards in your hand, this attack does nothing.",
      ),
    ).toBeNull();
    expect(corpus().filter(([, s]) => s.includes("exactly 4 cards in your hand"))).toEqual([]);
  });

  it("bought no bonus row, no second hand member, and no hand-CONTENTS read", () => {
    expect(deriveAttackDamageBonus(TRIO_CHEEHOO)).toBeNull();
    // …and the union's public-state invariant is intact: this member reads a LENGTH.
    // Sizes are public (both players watched every draw and play that set them),
    // contents are not — which is why the whole family survives P4 redaction.
    const state = setHandSize(board(102), "p1", 3);
    expect(conditionHolds(state, "p1", EXACTLY_3)).toBe(true);
    // The same board with the same COUNT but entirely different cards answers the
    // same, which is the invariant driven rather than restated.
    const reordered: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, hand: [...state.players.p1.hand].reverse() },
      },
    };
    expect(conditionHolds(reordered, "p1", EXACTLY_3)).toBe(true);
  });

  it("bought no play GATE — this member reaches the board through printed ATTACK text only", () => {
    // `conditionNote` is the reject fragment for a play gate, and no card carries this
    // one as one today. Pinned directly (as `boardCondition.test.ts` pins the other
    // unreachable arms) so a typo in player-facing copy cannot ship unseen.
    expect(conditionNote(EXACTLY_3)).toBe("you have exactly 3 cards in your hand");
  });
});
