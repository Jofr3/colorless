import { describe, expect, it } from "vitest";
import { cardOfUid, matchesFilter } from "./cards";
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
import type { BoardCondition, CardFilter, GameEvent, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./boardCondition";
import {
  BASIC_ENERGY_DISCARD_DECK,
  attachFromDeck,
  clearBench,
  discardFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** The bonus skeleton, as a labelled COPY — the reader's own pattern is
    module-private. Whole-sentence anchored at BOTH ends, like the reader's. */
const BONUS = /^If (.+), this attack does (\d+) more damage\.$/;

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

const TAKEN =
  "If you have 10 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage.";
const TAKEN_CLAUSE = "you have 10 or more Basic {R} Energy cards in your discard pile";

const DISCARD: BoardCondition = {
  kind: "yourBasicEnergyInDiscardAtLeast",
  energy: "Fire",
  count: 10,
};
/** THE SIBLING ONE ZONE OVER, at the SAME type and the SAME threshold — the member a
    reuse would have delegated to, and a shipped predicate rather than a local copy of
    one. Every board below reports it. */
const IN_PLAY: BoardCondition = { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 10 };

// ── boards ─────────────────────────────────────────────────────────────────────

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: BASIC_ENERGY_DISCARD_DECK, p2: BASIC_ENERGY_DISCARD_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The seat's opposite. Spelled once here rather than imported, because the member is
    seat-relative on the face of it and every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

function ready(seed: number, seat: Seat = "p1"): GameState {
  let state = board(seed);
  if (seat === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = setActiveFromDeck(state, seat, "fix-emberpillar");
  state = attachFromDeck(state, seat, "fix-energy", 1);
  state = setActiveFromDeck(state, other(seat), "fix-bigbody");
  return clearBench(clearBench(state, seat), other(seat));
}

/** Put `count` copies of each id into `seat`'s DISCARD PILE, off their own deck. */
function pile(state: GameState, seat: Seat, ...cards: readonly [string, number][]): GameState {
  let next = state;
  for (const [id, count] of cards) next = discardFromDeck(next, seat, id, count);
  return next;
}

/** Attack index 0 from `seat` and report the damage actually dealt. */
function damageDealt(state: GameState, seat: Seat = "p1"): number {
  const after = mustApply(state, { type: "attack", seat, index: 0 });
  const dealt = after.events.find((e: GameEvent) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** How many cards in `seat`'s pile match `filter` — the shape of the arm under test,
    with the FILTER as a parameter, so each widening below is the real predicate with
    one printed word removed rather than a hand-written approximation of one. */
function pileCount(state: GameState, seat: Seat, filter: CardFilter): number {
  let n = 0;
  for (const uid of state.players[seat].discard) {
    if (matchesFilter(cardOfUid(state, uid), filter)) n += 1;
  }
  return n;
}

function readings(
  state: GameState,
  seat: Seat,
): { member: boolean; zone: boolean; anyEnergy: boolean; untyped: boolean; wholePile: boolean } {
  return {
    member: conditionHolds(state, seat, DISCARD),
    zone: conditionHolds(state, seat, IN_PLAY),
    anyEnergy: pileCount(state, seat, { kind: "anyEnergy" }) >= 10,
    untyped: pileCount(state, seat, { kind: "basicEnergy" }) >= 10,
    wholePile: state.players[seat].discard.length >= 10,
  };
}

describe("§1 — the price, RE-DERIVED: a 1:2 step and the 2-printing band emptied", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the residue steps by exactly this ONE sentence and TWO printings", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(refused.length).toBe(0);
    expect(units(refused)).toBe(0);
    expect([refused.length + 24, units(refused) + 28]).toEqual([24, 28]);
    expect([refused.length + 25, units(refused) + 30]).toEqual([25, 30]);
    expect([refused.length + 26, units(refused) + 32]).toEqual([26, 32]);
    expect([refused.length + 27, units(refused) + 34]).toEqual([27, 34]);
    expect([refused.length + 28, units(refused) + 36]).toEqual([28, 36]);
    expect([refused.length + 30, units(refused) + 38]).toEqual([30, 38]);

    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    const band = [...byClause].filter(([, n]) => n === 2).map(([clause]) => clause);
    expect(band).toEqual([]);
    expect([...byClause.values()].filter((n) => n > 1)).toEqual([]);
    expect(byClause.size).toBe(0);
    expect(band.length + 2).toBe(2);
    expect(band.length + 3).toBe(3);
    expect([...byClause.values()]).toEqual([]);
  });

  it("ONE sentence, TWO printings — and the printed NOUN is wider than the row", () => {
    const records = corpus().filter(([, s]) => s === TAKEN);
    expect(records).toHaveLength(1);
    expect(units(records)).toBe(2);
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(2);
    const noun = corpus().filter(([, s]) => s.includes("Basic {R} Energy"));
    expect(noun).toHaveLength(4);
    expect(units(noun)).toBe(6);
    expect(noun.filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(noun.filter(([, s]) => BONUS.test(s.trim()))).toHaveLength(1);
    const zone = corpus().filter(([, s]) => s.includes("in your discard pile"));
    expect(zone).toHaveLength(7);
    expect(units(zone)).toBe(14);
    expect(zone.filter(([, s]) => BONUS.test(s.trim()))).toHaveLength(1);
  });
});

describe("§2 — the clause row, the printed BYTES, and a note that round-trips neither way", () => {
  it("maps the printed sentence onto the new member at the printed 100", () => {
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 100,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourBasicEnergyInDiscardAtLeast", energy: "Fire", count: 10 },
      },
    });
  });

  it("the KEY is the printed bytes, pinned by COUNT and PURE ASCII", () => {
    expect(TAKEN).toHaveLength(101);
    expect(TAKEN_CLAUSE).toHaveLength(63);
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
    expect([...TAKEN].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e)).toBe(
      true,
    );
    expect(TAKEN).not.toContain("é");
    expect(TAKEN).not.toContain("'");
    expect(TAKEN).not.toContain("\u2019");
  });

  it("eight constructed rewrites resolve to NOTHING — the printed words are the key", () => {
    for (const near of [
      // the CLASS word dropped — the widening §3 kills on a board
      "If you have 10 or more {R} Energy cards in your discard pile, this attack does 100 more damage.",
      // the TYPE glyph dropped — the other widening §3 kills on a board
      "If you have 10 or more Basic Energy cards in your discard pile, this attack does 100 more damage.",
      // a different type
      "If you have 10 or more Basic {W} Energy cards in your discard pile, this attack does 100 more damage.",
      // a different threshold
      "If you have 9 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage.",
      // the sibling's phrasing of the same threshold
      "If you have at least 10 Basic {R} Energy cards in your discard pile, this attack does 100 more damage.",
      // a different ZONE — the one §4 kills on a board
      "If you have 10 or more Basic {R} Energy cards in play, this attack does 100 more damage.",
      // the OPPONENT's pile
      "If your opponent has 10 or more Basic {R} Energy cards in their discard pile, this attack does 100 more damage.",
      // the singular noun
      "If you have 10 or more Basic {R} Energy card in your discard pile, this attack does 100 more damage.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
    // …and the taken sentence IS resolved, so the loop above is a statement about
    // those eight strings rather than about the reader being asleep.
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
  });

  it("the SIBLING's row still resolves to the SIBLING, one zone over", () => {
    expect(
      deriveAttackDamageBonus(
        "If you have at least 3 {D} Energy in play, this attack does 50 more damage.",
      ),
    ).toEqual({
      per: 50,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 },
      },
    });
  });

  it("the note is built from BOTH parameters and round-trips NEITHER way", () => {
    expect(conditionNote(DISCARD)).toBe(
      "you have at least 10 Basic Fire Energy cards in your discard pile",
    );
    expect(conditionNote(DISCARD)).not.toBe(TAKEN_CLAUSE);
    expect(
      resolvedByAnyReader(`If ${conditionNote(DISCARD)}, this attack does 100 more damage.`),
    ).toBe(false);
    // …and BOTH parameters are really read, so a second threshold or a second type
    // costs no note arm.
    expect(
      conditionNote({ kind: "yourBasicEnergyInDiscardAtLeast", energy: "Water", count: 3 }),
    ).toBe("you have at least 3 Basic Water Energy cards in your discard pile");
    for (const verbatim of [
      { kind: "opponentActiveHasToolAttached" },
      { kind: "inPlayTypesIntersect" },
    ] as const) {
      expect(
        deriveAttackDamageBonus(`If ${conditionNote(verbatim)}, this attack does 80 more damage.`),
      ).toEqual({ per: 80, count: { kind: "boardCondition", cond: verbatim } });
    }
    expect(
      resolvedByAnyReader(`If ${conditionNote(IN_PLAY)}, this attack does 50 more damage.`),
    ).toBe(false);
  });
});

describe("§3 — THE PROVISION AXIS: a card CLASS and a printed TYPE, never a payment", () => {
  it("THE ATTRIBUTION CONTROL: on ten Basic {R} alone, ALL FIVE readings agree", () => {
    const ten = pile(ready(8100), "p1", ["fix-fire-energy", 10]);
    expect(ten.players.p1.discard).toHaveLength(10);
    expect(readings(ten, "p1")).toEqual({
      member: true,
      zone: false,
      anyEnergy: true,
      untyped: true,
      wholePile: true,
    });
    expect(damageDealt(ten)).toBe(110);
    // …and on the EMPTY pile all five are false, so both directions of the control are
    // shown live rather than asserted in one.
    const bare = ready(8101);
    expect(bare.players.p1.discard).toEqual([]);
    expect(readings(bare, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: false,
      untyped: false,
      wholePile: false,
    });
    expect(damageDealt(bare)).toBe(10);
  });

  it("a WILDCARD SPECIAL in the pile is not a `Basic {R} Energy card` — and the SAME CARD provides {R} in play", () => {
    const nine = pile(ready(8102), "p1", ["fix-fire-energy", 9], ["sv02-191", 1]);
    expect(nine.players.p1.discard).toHaveLength(10);
    expect(readings(nine, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: true, // ← the CLASS widening, and it is TRUE here
      untyped: false,
      wholePile: true,
    });
    expect(damageDealt(nine)).toBe(10);

    // …and the OTHER half of the sentence, on a board: the very same card put IN PLAY
    // rather than in the pile makes the SIBLING true at 1, which is what "provides {R}"
    // means and where it is a correct reading. One card, two zones, two answers.
    const inPlay = attachFromDeck(ready(8103), "p1", "sv02-191", 1);
    expect(
      conditionHolds(inPlay, "p1", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 1 }),
    ).toBe(true);
    expect(conditionHolds(inPlay, "p1", DISCARD)).toBe(false);
  });

  it("an UNAUTHORED Special is refused too, by CLASS rather than by provision", () => {
    const nine = pile(ready(8104), "p1", ["fix-fire-energy", 9], ["fix-special", 1]);
    expect(readings(nine, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: true,
      untyped: false,
      wholePile: true,
    });
    expect(damageDealt(nine)).toBe(10);
  });

  it("a Basic of the WRONG TYPE is refused — the printed `{R}` is a conjunct", () => {
    const nine = pile(ready(8105), "p1", ["fix-fire-energy", 9], ["fix-water-energy", 1]);
    expect(readings(nine, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: true,
      untyped: true, // ← the TYPE widening, and it is TRUE here and false above
      wholePile: true,
    });
    expect(damageDealt(nine)).toBe(10);
  });

  it("a POKÉMON in the pile is refused — the filter is not a pile LENGTH", () => {
    const nine = pile(ready(8106), "p1", ["fix-fire-energy", 9], ["fix-basic-1", 1]);
    expect(readings(nine, "p1")).toEqual({
      member: false,
      zone: false,
      anyEnergy: false,
      untyped: false,
      wholePile: true,
    });
    expect(damageDealt(nine)).toBe(10);
  });

  it("the two Fire PRINTS are interchangeable, and the decoys do not disarm a full pile", () => {
    const mixed = pile(ready(8107), "p1", ["fix-fire-energy", 7], ["fix-fire-energy-alt", 3]);
    expect(conditionHolds(mixed, "p1", DISCARD)).toBe(true);
    expect(damageDealt(mixed)).toBe(110);

    // …and every refused card ADDED to a satisfied pile leaves it satisfied: the
    // decoys subtract nothing, which is the other half of "the predicate is a count".
    const loaded = pile(
      ready(8108),
      "p1",
      ["fix-fire-energy", 10],
      ["fix-water-energy", 2],
      ["sv02-191", 2],
      ["fix-special", 2],
      ["fix-basic-1", 2],
    );
    expect(loaded.players.p1.discard).toHaveLength(18);
    expect(conditionHolds(loaded, "p1", DISCARD)).toBe(true);
    expect(damageDealt(loaded)).toBe(110);
  });
});

describe("§4 — THE ZONE AXIS: the pile, and never the board", () => {
  it("TEN Basic {R} IN PLAY with an EMPTY pile is FALSE — and the sibling is TRUE", () => {
    const inPlay = attachFromDeck(ready(8200), "p1", "fix-fire-energy", 10);
    expect(inPlay.players.p1.active?.energy).toHaveLength(11); // 10 Fire + the {C} payer
    expect(inPlay.players.p1.discard).toEqual([]);
    expect(readings(inPlay, "p1")).toEqual({
      member: false,
      zone: true, // ← the SIBLING, and it is TRUE here
      anyEnergy: false,
      untyped: false,
      wholePile: false,
    });
    expect(damageDealt(inPlay)).toBe(10);
  });

  it("…and TEN in the PILE with none in play is TRUE, which is the same pair inverted", () => {
    // Asserted as its own rung rather than folded into §3's control, because "the two
    // members disagree" needs both directions: a member that was simply always false
    // would satisfy the rung above and fail this one.
    const inPile = pile(ready(8201), "p1", ["fix-fire-energy", 10]);
    expect(inPile.players.p1.active?.energy).toHaveLength(1);
    expect(readings(inPile, "p1")).toEqual({
      member: true,
      zone: false,
      anyEnergy: true,
      untyped: true,
      wholePile: true,
    });
    expect(damageDealt(inPile)).toBe(110);
  });

  it("a BENCHED body's Energy is in play too, and is still not in the pile", () => {
    // The `[active, ...bench]` spread is one identifier away in the sibling's own
    // helper, so the widening a reader would reach for is checked here as well: ten
    // Fire spread across the Bench does not fill a pile either.
    let benched = ready(8202);
    benched = attachFromDeck(benched, "p1", "fix-fire-energy", 5);
    expect(conditionHolds(benched, "p1", DISCARD)).toBe(false);
    expect(
      conditionHolds(benched, "p1", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 5 }),
    ).toBe(true);
    expect(damageDealt(benched)).toBe(10);
  });

  it("the OPPONENT's pile is not yours — seat-relative, driven from both sides", () => {
    // "you have … in your discard pile" is a seat-relative reading, and a p1-only file
    // cannot tell that from "p1's pile". Ten in THEIR pile makes THEIR reading true and
    // yours false, on one board.
    const theirs = pile(ready(8203), "p2", ["fix-fire-energy", 10]);
    expect(conditionHolds(theirs, "p1", DISCARD)).toBe(false);
    expect(conditionHolds(theirs, "p2", DISCARD)).toBe(true);
    expect(damageDealt(theirs)).toBe(10);

    // …and a real declaration from P2 pays the bonus off P2's own pile, so the seat is
    // driven through the attack path and not only through `conditionHolds`.
    const mine = pile(ready(8204, "p2"), "p2", ["fix-fire-energy", 10]);
    expect(conditionHolds(mine, "p2", DISCARD)).toBe(true);
    expect(damageDealt(mine, "p2")).toBe(110);
  });
});

describe("§5 — the THRESHOLD: `>=`, driven at exactly 9 and exactly 10", () => {
  it("NINE is FALSE and TEN is TRUE, on real declarations", () => {
    const nine = pile(ready(8300), "p1", ["fix-fire-energy", 9]);
    expect(nine.players.p1.discard).toHaveLength(9);
    expect(conditionHolds(nine, "p1", DISCARD)).toBe(false);
    expect(damageDealt(nine)).toBe(10);

    const ten = pile(ready(8301), "p1", ["fix-fire-energy", 10]);
    expect(ten.players.p1.discard).toHaveLength(10);
    expect(conditionHolds(ten, "p1", DISCARD)).toBe(true);
    expect(damageDealt(ten)).toBe(110);

    // …and ELEVEN is still true, which is what "or more" means and what a `===` would
    // break. The three rungs together separate `>`, `>=` and `===` on one axis.
    const eleven = pile(ready(8302), "p1", ["fix-fire-energy", 11]);
    expect(conditionHolds(eleven, "p1", DISCARD)).toBe(true);
    expect(damageDealt(eleven)).toBe(110);
  });

  it("the whole ramp 0..11 is monotone and steps EXACTLY at 10", () => {
    // One loop rather than three rungs, so the boundary is a property of the predicate
    // rather than of the three counts a case happened to pick. A `> 10` moves the step
    // to 11 and reddens here; a `>= 9` moves it to 9 and reddens here.
    for (let n = 0; n <= 11; n++) {
      const state = n === 0 ? ready(8310) : pile(ready(8310 + n), "p1", ["fix-fire-energy", n]);
      expect(conditionHolds(state, "p1", DISCARD), `${n} in the pile`).toBe(n >= 10);
    }
  });

  it("the `count` parameter is real: the same pile answers a lower threshold", () => {
    const nine = pile(ready(8320), "p1", ["fix-fire-energy", 9]);
    expect(conditionHolds(nine, "p1", DISCARD)).toBe(false);
    expect(
      conditionHolds(nine, "p1", {
        kind: "yourBasicEnergyInDiscardAtLeast",
        energy: "Fire",
        count: 9,
      }),
    ).toBe(true);
    // …and the `energy` parameter is real too, on the same board.
    expect(
      conditionHolds(nine, "p1", {
        kind: "yourBasicEnergyInDiscardAtLeast",
        energy: "Water",
        count: 1,
      }),
    ).toBe(false);
    const water = pile(nine, "p1", ["fix-water-energy", 1]);
    expect(
      conditionHolds(water, "p1", {
        kind: "yourBasicEnergyInDiscardAtLeast",
        energy: "Water",
        count: 1,
      }),
    ).toBe(true);
  });
});

describe("§6 — the boundaries the arm has to survive", () => {
  it("an UNRESOLVABLE uid in the pile contributes nothing, and does not throw", () => {
    const ten = pile(ready(8400), "p1", ["fix-fire-energy", 10]);
    const broken: GameState = {
      ...ten,
      players: {
        ...ten.players,
        p1: { ...ten.players.p1, discard: [...ten.players.p1.discard, "uid-nobody-minted"] },
      },
    };
    expect(broken.players.p1.discard).toHaveLength(11);
    expect(conditionHolds(broken, "p1", DISCARD)).toBe(true);
    // …and it does not fill a short pile either.
    const nine = pile(ready(8401), "p1", ["fix-fire-energy", 9]);
    const shortBroken: GameState = {
      ...nine,
      players: {
        ...nine.players,
        p1: { ...nine.players.p1, discard: [...nine.players.p1.discard, "uid-nobody-minted"] },
      },
    };
    expect(conditionHolds(shortBroken, "p1", DISCARD)).toBe(false);
  });

  it("an EMPTY Active Spot does not change the answer — the clause reads no body", () => {
    const ten = pile(ready(8402), "p1", ["fix-fire-energy", 10]);
    const vacated: GameState = {
      ...ten,
      players: { ...ten.players, p1: { ...ten.players.p1, active: null } },
    };
    expect(conditionHolds(vacated, "p1", DISCARD)).toBe(true);
    const bare: GameState = {
      ...ready(8403),
      players: { ...ready(8403).players, p1: { ...ready(8403).players.p1, active: null } },
    };
    expect(conditionHolds(bare, "p1", DISCARD)).toBe(false);
  });

  it("a threshold of 0 is trivially TRUE on an empty pile, and that is stated not shipped", () => {
    const bare = ready(8404);
    expect(bare.players.p1.discard).toEqual([]);
    expect(
      conditionHolds(bare, "p1", {
        kind: "yourBasicEnergyInDiscardAtLeast",
        energy: "Fire",
        count: 0,
      }),
    ).toBe(true);
    // …and no clause in the table produces one, which is what makes the line above a
    // statement about the arm and not a live path.
    expect(
      resolvedByAnyReader(
        "If you have 0 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage.",
      ),
    ).toBe(false);
  });
});
