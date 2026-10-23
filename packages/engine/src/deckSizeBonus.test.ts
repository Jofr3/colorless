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
import type { BoardCondition, GameState, Seat } from "./index";
import { redactGame } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  DECK_SIZE_BONUS_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
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

const TAKEN = "If there are 3 or fewer cards in your deck, this attack does 200 more damage.";
const TAKEN_CLAUSE = "there are 3 or fewer cards in your deck";

const TWIN =
  "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The printed control on the SAME body — index 0, no clause, and a sentence
    `deriveAttackEffect` has read since 0.x. */
const TRIPLE_DRAW = "Draw 3 cards.";

const DECK: BoardCondition = { kind: "yourDeckAtMost", count: 3 };
/** The nearest wrong answer in the whole union: same comparator, same printed digit,
    wrong SEAT and wrong ZONE. */
const HAND: BoardCondition = { kind: "opponentHandAtMost", count: 3 };

// ── boards ─────────────────────────────────────────────────────────────────────

function ready(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: DECK_SIZE_BONUS_DECK, p2: DECK_SIZE_BONUS_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p1", "fix-counterturn");
  state = attachFromDeck(state, "p1", "fix-grass-energy", 1);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

function armed(seed: number, deck: number): GameState {
  return trimDeckTo(mustApply(ready(seed), { type: "endTurn", seat: "p2" }).state, "p1", deck);
}

/** Attack at `index` — **1** is the printed "Counterturn" and **0** the printed
    "Triple Draw" — and report the damage actually dealt. */
function damageDealt(state: GameState, index = 1): number {
  const after = mustApply(state, { type: "attack", seat: "p1", index });
  const dealt = after.events.find((e) => e.type === "DAMAGE_DEALT") as
    | { damage?: number }
    | undefined;
  return dealt?.damage ?? 0;
}

/** The seat's opposite, spelled once — every board below names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

describe("§1 — the price, RE-DERIVED off the corpus rather than inherited", () => {
  it("D419 — the hand-kept READERS list IS the module's reader surface", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("the sentence is real, is worth ONE printing, and reached the SKELETON all along", () => {
    expect(corpus().filter(([, s]) => s === TAKEN)).toHaveLength(1);
    expect(units(corpus().filter(([, s]) => s === TAKEN))).toBe(1);
    // It was refused at the CLAUSE, not at the skeleton: the bonus pattern always
    // matched it and always captured the printed 200.
    expect(BONUS.test(TAKEN)).toBe(true);
    expect(BONUS.exec(TAKEN)?.[2]).toBe("200");
    expect(BONUS.exec(TAKEN)?.[1]).toBe(TAKEN_CLAUSE);
    const clauseRows = corpus().filter(([, s]) => BONUS.exec(s.trim())?.[1] === TAKEN_CLAUSE);
    expect(clauseRows).toHaveLength(1);
    expect(units(clauseRows)).toBe(1);
  });

  it("the residue steps by exactly this ONE sentence and ONE printing, and is then EXHAUSTED", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    expect(refused.some(([, s]) => s === TAKEN)).toBe(false);
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    expect([refused.length, units(refused)]).toEqual([0, 0]);
    expect([refused.length + 8, units(refused) + 11]).toEqual([8, 11]);
    const byClause = new Map<string, number>();
    for (const [n, s] of refused) {
      const clause = BONUS.exec(s.trim())?.[1] ?? "";
      byClause.set(clause, (byClause.get(clause) ?? 0) + n);
    }
    expect(byClause.size).toBe(0);
    expect([...byClause.values()].filter((n) => n === 1)).toHaveLength(0);
    expect([...byClause.values()].filter((n) => n === 5)).toHaveLength(0);
    expect([...byClause.values()].filter((n) => n === 2)).toHaveLength(0);
  });

  it("the residue is EXHAUSTED OF BUILDABLE ROWS, and each remaining one is named and classified", () => {
    const refused = corpus().filter(([, s]) => BONUS.test(s.trim()) && !resolvedByAnyReader(s));
    const clauses = new Set(refused.map(([, s]) => BONUS.exec(s.trim())?.[1] ?? ""));
    const BANNERS = ["Ancient ", "Tera ", "Future "] as const;
    const SHAPE =
      "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)";
    const banner = [...clauses].filter((c) => BANNERS.some((b) => c.includes(b)));
    const shape = [...clauses].filter((c) => c === SHAPE);
    expect(banner).toHaveLength(0);
    expect(shape).toHaveLength(0);
    // …and the clause the bucket was built for is CLAIMED, on BOTH of its printed
    // amounts, so "the bucket is empty" cannot be satisfied by the clause vanishing
    // from the catalog instead of being read.
    for (const amount of [80, 100]) {
      expect(resolvedByAnyReader(`If ${SHAPE}, this attack does ${amount} more damage.`)).toBe(
        true,
      );
    }
    // …and the partition is EXACT: nothing is left over and nothing is double-counted.
    expect(banner.length + shape.length).toBe(clauses.size);
    for (const c of banner) expect(shape).not.toContain(c);
  });

  it("the deck-cardinality column is ONE threshold in ONE direction, which is why `count` is a parameter and the KEY is a row", () => {
    const deckClauses = corpus().filter(([, s]) => s.includes("cards in your deck"));
    expect(deckClauses).toHaveLength(2);
    expect(units(deckClauses)).toBe(2);
    for (const [, s] of deckClauses) expect(s).toContain("there are 3 or fewer cards in your deck");
    // …and the two differ ONLY in the consequent, which is the fact §5 turns on.
    expect(new Set(deckClauses.map(([, s]) => s))).toEqual(new Set([TAKEN, TWIN]));
    // The direction is the other half: the column prints no deck FLOOR at any value,
    // so `<=` is not one of two readings the catalog offers.
    expect(corpus().filter(([, s]) => /\d+ or more cards in your deck/.test(s))).toHaveLength(0);
  });
});

describe("§2 — the SHAPE question, measured on the running code rather than argued", () => {
  it("the nearest candidate is `opponentHandAtMost` and it is wrong in the SEAT and in the ZONE at once", () => {
    const state = armed(3980, 3);
    expect(conditionHolds(state, "p1", DECK)).toBe(true);
    expect(conditionHolds(state, "p1", HAND)).toBe(false);
    expect(state.players.p2.hand.length).toBeGreaterThan(3);
    expect(state.players.p2.deck.length).toBeGreaterThan(3);
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.",
      )?.count,
    ).toEqual({ kind: "boardCondition", cond: HAND });
  });

  it("the NOTE clause dissents — ONE noun apart — and it is recorded, not hidden", () => {
    expect(conditionNote(DECK)).toBe("you have 3 or fewer cards in your deck");
    expect(conditionNote(HAND)).toBe("your opponent has 3 or fewer cards in their hand");
    const slotted = (subject: string, zone: string): string =>
      `${subject} 3 or fewer cards in ${zone}`;
    expect(conditionNote(DECK)).toBe(slotted("you have", "your deck"));
    expect(conditionNote(HAND)).toBe(slotted("your opponent has", "their hand"));
    // …and the note is read off the BOARD, so it does NOT round-trip to the clause key
    // (the key's head is the expletive "there are"). Asserted rather than left for a
    // successor to "fix" one into the other.
    expect(conditionNote(DECK)).not.toBe(TAKEN_CLAUSE);
    expect(
      deriveAttackDamageBonus(`If ${conditionNote(DECK)}, this attack does 200 more damage.`),
    ).toBeNull();
  });

  it("the count is a PARAMETER: a member at another threshold answers differently on one board", () => {
    // What makes `count` a real field rather than a constant wearing a name. The
    // catalog prints one threshold today; the member is asked at three, on a board
    // where they disagree, so a build that buried the 3 in the kind fails here.
    const state = armed(3981, 5);
    expect(conditionHolds(state, "p1", DECK)).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "yourDeckAtMost", count: 5 })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourDeckAtMost", count: 4 })).toBe(false);
  });
});

describe("§3 — the INVARIANT the union got wrong: a cardinality is not a content", () => {
  it("`deckCount` crosses the wire for BOTH sides, so the member is evaluable on a projection", () => {
    const state = armed(3982, 3);
    for (const seat of ["p1", "p2"] as const) {
      const view = redactGame(state, seat);
      expect(view.board.you.deckCount).toBe(state.players[seat].deck.length);
      expect(view.board.opponent.deckCount).toBe(state.players[other(seat)].deck.length);
    }
    // …and the CONTENTS do not, which is the line the corrected invariant draws: the
    // projection carries a number and no card identity for either deck.
    const view = redactGame(state, "p1");
    expect(JSON.stringify(view.board)).not.toContain(state.players.p1.deck[0] ?? "«empty»");
    expect(view.board.you.deckCount).toBe(3);
    // The member's answer is a function of that number alone, so the host and a client
    // holding only the projection agree by construction.
    expect(conditionHolds(state, "p1", DECK)).toBe(view.board.you.deckCount <= 3);
  });
});

describe("§4 — the member on the board: seat, zone, boundary, empty deck", () => {
  it("the boundary is driven at 2, 3 and 4 — `<` and `===` are each green at one of them", () => {
    // The only mistake this one line can make, in both directions at once. `<` is green
    // at 2 and wrong at 3; `===` is green at 3 and wrong at 2; `>=` is wrong at all
    // three. Boards, not an argument.
    expect(conditionHolds(armed(3990, 2), "p1", DECK)).toBe(true);
    expect(conditionHolds(armed(3991, 3), "p1", DECK)).toBe(true);
    expect(conditionHolds(armed(3992, 4), "p1", DECK)).toBe(false);
  });

  it("an EMPTY deck is TRUE, and that board is ORDINARY rather than an edge", () => {
    const state = armed(3993, 0);
    expect(state.players.p1.deck).toHaveLength(0);
    expect(conditionHolds(state, "p1", DECK)).toBe(true);
    expect(damageDealt(state)).toBe(240);
  });

  it("own seat only — a SHORT deck on the far side pays this seat nothing", () => {
    const state = armed(3994, 3);
    expect(conditionHolds(state, "p1", DECK)).toBe(true);
    expect(conditionHolds(state, other("p1"), DECK)).toBe(false);
    expect(state.players.p2.deck.length).toBeGreaterThan(3);
  });

  it("the ZONE is the deck — a short HAND and a short DISCARD move nothing", () => {
    // The zone half. `trimDeckTo` files the trimmed cards into the DISCARD, so the
    // board below has a long discard and a short deck; the member reads only one of
    // them, and the hand it never looks at is whatever setup dealt.
    const state = armed(3995, 3);
    expect(state.players.p1.discard.length).toBeGreaterThan(3);
    expect(conditionHolds(state, "p1", DECK)).toBe(true);
    // …and on a full deck it is FALSE however small the other zones are.
    const full = armed(3996, 40);
    expect(conditionHolds(full, "p1", DECK)).toBe(false);
    expect(full.players.p1.hand.length).toBeLessThan(40);
  });
});

describe("§5 — the REFUSALS, driven from OUTSIDE the population as well as inside it", () => {
  it("the TWIN carries this clause byte for byte and is routed to a DIFFERENT reader", () => {
    expect(corpus().filter(([, s]) => s === TWIN)).toHaveLength(1);
    expect(TWIN.startsWith(`If ${TAKEN_CLAUSE}, `)).toBe(true);
    expect(BONUS.test(TWIN)).toBe(false);
    // ⒜ the twin is read, by `deriveAttackEffect` ALONE, and it carries THIS member.
    expect(resolvedByAnyReader(TWIN)).toBe(true);
    expect(deriveAttackEffect(TWIN)).toEqual([
      {
        op: "conditionGate",
        cond: DECK,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "damageChosen",
            target: "opponentBench",
            amount: 120,
            count: 2,
            source: "attack",
            deals: true,
          },
        ],
      },
    ]);
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(TWIN), read.name).toBeNull();
    }
    expect(resolvedByAnyReader(TAKEN)).toBe(true);
    expect(deriveAttackDamageBonus(TAKEN)).toEqual({
      per: 200,
      count: { kind: "boardCondition", cond: DECK },
    });
    expect(deriveAttackEffect(TAKEN)).toBeNull();
    expect(deriveAttackDamageBonus(TWIN)).toBeNull();
  });

  it("no OTHER reader claims the taken sentence, so nothing was widened by accident", () => {
    for (const read of READERS) {
      if (read === deriveAttackDamageBonus) continue;
      expect(read(TAKEN), read.name).toBeNull();
    }
  });

  it("the key is a WHOLE clause: neither a shortened nor a lengthened spelling reaches it", () => {
    const nearMisses = [
      "there are 3 or fewer cards in your hand",
      "there are 3 or fewer cards in their deck",
      "there are 3 or fewer cards in your discard pile",
      "there are 4 or fewer cards in your deck",
      "there are 3 or more cards in your deck",
      "there is 1 or fewer cards in your deck",
      "you have 3 or fewer cards in your deck",
    ];
    for (const clause of nearMisses) {
      expect(
        deriveAttackDamageBonus(`If ${clause}, this attack does 200 more damage.`),
        clause,
      ).toBeNull();
    }
  });

  it("the THREE BANNER clauses left in the residue are still refused, one at a time (D568: the two Tera ones resolve)", () => {
    for (const clause of [
      "you have any Tera Pokémon on your Bench",
      "your opponent's Active Pokémon is a Tera Pokémon",
      "you played a Future Supporter card from your hand during this turn",
      "your opponent has any Future Pokémon in play",
      "1 of your other Ancient Pokémon used an attack during your last turn",
    ]) {
      expect(resolvedByAnyReader(`If ${clause}, this attack does 100 more damage.`), clause).toBe(
        true,
      );
    }
    const banners = ["1 of your other Future Pokémon used an attack during your last turn"];
    for (const clause of banners) {
      const printed = `If ${clause}, this attack does 100 more damage.`;
      expect(deriveAttackDamageBonus(printed), clause).toBeNull();
      expect(
        corpus().some(([, s]) => BONUS.exec(s.trim())?.[1] === clause),
        clause,
      ).toBe(false);
    }
  });
});

describe("§6 — the printing end to end, at the index it is actually printed at", () => {
  it("40 on a full deck, 240 on a short one — attributable to the CLAUSE", () => {
    expect(damageDealt(armed(3997, 40))).toBe(40);
    expect(damageDealt(armed(3998, 3))).toBe(240);
  });

  it("the clause sits at INDEX 1, and the index-0 control is the one that empties the deck", () => {
    const state = armed(3999, 3);
    expect(deriveAttackDamageBonus(TRIPLE_DRAW)).toBeNull();
    expect(damageDealt(state, 0)).toBe(0);
    const drawn = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
    expect(drawn.players.p1.deck).toHaveLength(0);
    // …and the clause read at declaration on the ORIGINAL board is the one that pays.
    expect(damageDealt(state)).toBe(240);
  });
});
