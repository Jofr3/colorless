import { HIDDEN_CARD_ID } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter } from "./effects";
import { engineVersion, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction } from "./index";
import { conditionHolds, countCardsInDiscardPile, countCardsInHand } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  DISCARD_ATTACH_DECK,
  FIXTURE_POOL,
  OPPONENT_HAND_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  handFromDeck,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.346.0 → 0.347.0 — 🆕🆕 D445: "YOUR OPPONENT REVEALS THEIR HAND", AND WHAT
// HAPPENS NEXT — the first damage fold over a zone the other player cannot see, and
// the family's first destination outside the owner's deck and Bench.
//
//   "Your opponent reveals their hand. This attack does 50 damage
//    for each Trainer card you find there."                                        3
//   "Your opponent reveals their hand. Discard a card you find there."             2
//   "This attack does 30 damage for each card in your opponent's hand."            1
//                                          — 3 sentences / 6 LEGAL printings
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
//   ⑴ **THE DUAL CLAIM.** Row 675 is the FIRST string in the 640-row corpus claimed
//      by TWO readers — `deriveAttackEffect` for the reveal and
//      `deriveAttackDamageMultiplier` for the fold. §2 asserts both owners BY NAME
//      and the remaining eleven refusals beside them (D438: a positive replacement
//      for a negated disjunction is a claim about none of the disjuncts), and §4
//      drives a board where dropping either half changes the observable outcome.
//   ⑵ **THE ZONE.** The HAND, not the discard pile, not the board, not the deck. The
//      canonical board is shaped so every one of those four answers a DIFFERENT
//      number on the same swing: hand 250/210, pile 100/60, in play 50/30.
//   ⑶ **THE SEAT.** The member spells `Opponent` in its NAME and the arm reads
//      `defenderSeat`. Both attacks move under an inversion — 250/210 becomes
//      50/120 — so a build reading the attacker's own hand is a different number on
//      every rung rather than a coincidence on some.
//   ⑷ **THE FILTER.** `trainerCard` against `anyCard`, and the hand is shaped so
//      every neighbouring member is a different count: any 7, trainerCard 5, item 3,
//      supporter 1, toolCard 1, anyPokemon 1, anyEnergy 1, stadium 0.
//   ⑸ **THE SHARED WALK.** `countCardsInHand` is D420's own loop, generalised in
//      place, so the `BoardCondition` THRESHOLD and this COUNT cannot drift. §3
//      drives both names on ONE board.
//   ⑹ **THE DESTINATION.** `bottomFromOpponentHand.dest: "discard"` — the park, the
//      forced single-class board, the empty-hand whiff, the new event's ATTRIBUTION
//      and the log row that has to distinguish a CHOSEN discard from a RANDOM one.
//   ⑺ **WHERE THE INFORMATION GOES**, which is the question this family is actually
//      about. §7 drives it from both chairs.
//
// 🛑 **THE INFORMATION ARGUMENT, WHICH IS THE REASON THE SLICE IS TWO SENTENCES AND
// NOT ONE.** Every other `DamageCountSource` member counts something both seats can
// see; D440 wrote that invariant down for the pile (*"ordered and public (§2), so
// the opponent-side read leaks nothing"*). A HAND is hidden and the damage number is
// public, so the fold itself is a channel — and the two printed rows keep the
// invariant by two DIFFERENT routes:
//   · corpus 564 counts the WHOLE hand, whose SIZE the board already shows;
//   · corpus 675 counts a FILTERED hand and REVEALS it first, which is what makes
//     the counted fact public.
// **Build only one and the argument is unfalsifiable.** With both, §6 can pin the
// rule on the POPULATION — no corpus sentence carries a filtered hand count without
// a printed reveal — instead of on a hand-written specimen (D423).
//
// ⚠️ **THE REVEAL RUNS AT THE TAIL, AFTER THE DAMAGE, AND THAT IS A DECISION.**
// §4 pins it so a successor meets a test rather than an apparent oversight (D426).

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes, off `legalAttackCorpus()` — the committed `legal_standard = 1`
// attack column. ⚠️ ONLY `HAND_COUNT` CARRIES AN APOSTROPHE, and its byte is
// **U+0027 at index 45**, measured with `codePointAt` over the corpus row and not
// remembered (D421). The anchor spells the class `['’]` anyway, per D137.
// ─────────────────────────────────────────────────────────────────────────────
const REVEAL_TRAINER_SCALE =
  "Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.";
const REVEAL_DISCARD = "Your opponent reveals their hand. Discard a card you find there.";
const HAND_COUNT = "This attack does 30 damage for each card in your opponent's hand.";

/** The three, in fixture-attack order (68, 69, 70). */
const CLAIMED = [REVEAL_TRAINER_SCALE, REVEAL_DISCARD, HAND_COUNT] as const;

/** 🛑 THE TWO SENTENCES OF THIS FAMILY THIS SLICE **REFUSES**, each with its own
    reason and its own falsifier — never one reason applied twice (D441).

    · `REVEAL_SWEEP` (1 legal printing) is refused for its SHAPE, not its filter.
      `{ kind: "anyOf", filters: [item, toolCard] }` spells the printed noun with
      ZERO new `CardFilter` members, so the vocabulary is not what blocks it. What
      blocks it is that *"Discard **all** … you find there"* is a MANDATORY TOTAL
      SWEEP with no pick at all, and `bottomFromOpponentHand` is a park-shaped op
      whose whole middle is an OFFER — filtered, collapsed to one representative per
      interchangeable class, then asked. A sweep has no offer to collapse and no
      question to ask, so routing it through this op means disabling the collapse,
      the arity check and the auto-resolve on a new field — five conditionals for one
      printing, in an op whose `upTo` field is named for the printed words *"up to"*
      and would have to hold a value that is not a ceiling (D441's refusal of a
      quantifier that answers two questions, arriving from the other side).
      ⚠️ **THE FALSIFIER IS EXECUTABLE**: §6 pins the sentence as claimed by no
      reader, so the day a mandatory-sweep op exists — or a second printing makes the
      shape worth its own op — that rung goes RED.
    · `REVEAL_COPY` (1 legal printing) is refused as a member of the ATTACK-COPY
      family, re-argued for a SUPPORTER rather than inherited (D436's defect is a
      refusal carried without re-argument). See §6 for the argument in full. */
const REVEAL_SWEEP =
  "Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.";
const REVEAL_COPY =
  "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.";

/** 🛑 THE CELL THE COLUMN DOES NOT PRINT, **CONSTRUCTED AND LABELLED SO**, which is
    `bodiesInPlayScaling.test.ts` §2's and `discardPileScaling.test.ts` §2's posture.
    A reader is a function of TEXT, so this is a claim about the READER and not about
    the pool — and it is the only rung that can show the anchors refuse the seat this
    member has no field for. */
const CONSTRUCTED_YOUR_HAND = "This attack does 30 damage for each card in your hand.";

/** The eleven readers these three sentences must NOT reach, so §2 can assert NAMED
    owners plus eleven kept refusals rather than a bare `resolvedByAnyReader`
    (D438). ⚠️ `deriveAttackEffect` and `deriveAttackDamageMultiplier` are the two
    OWNERS and are deliberately absent from this list. */
const OTHERS = [
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
] as const;

const SEED = 20260901;

/** The three fixture attack indices on `fix-trainerops` (D445 appended 68-70). */
const HAND_READ = 68;
const SNATCH = 69;
const HAND_COUNT_IDX = 70;

const TRAINER: CardFilter = { kind: "trainerCard" };
const ANY_CARD: CardFilter = { kind: "anyCard" };

/** 🛑 **THE DEFENDER'S HAND, AND EVERY NEIGHBOURING FILTER IS A DIFFERENT NUMBER.**

      fix-item ×3   fix-tool ×1   fix-gatedsup ×1   fix-energy ×1   fix-basic-1 ×1

      anyCard 7 · trainerCard 5 · item 3 · toolCard 1 · supporter 1 · stadium 0
      anyEnergy 1 · basicEnergy 1 · anyPokemon 1

    So `Hand Read` (50 × trainerCard) deals **250** and every wrong filter is a
    different number: item 150, anyCard 350, supporter/tool/Pokémon 50, stadium 0.
    `Hand Count` (30 × anyCard) deals **210** and trainerCard would be 150.

    ⚠️ **THE THREE `fix-item` COPIES ARE LOAD-BEARING TWICE OVER**: they make `item`
    (3) differ from every other member, and they are what gives §5's park an
    interchangeable class to COLLAPSE — a hand of seven distinct ids would offer
    seven candidates and could never show the collapse happening. */
const FOE_HAND = [
  "fix-item",
  "fix-item",
  "fix-item",
  "fix-tool",
  "fix-gatedsup",
  "fix-energy",
  "fix-basic-1",
] as const;

/** 🛑 **THE ATTACKER'S OWN HAND, SHAPED SO A SEAT INVERSION IS A DIFFERENT NUMBER ON
    BOTH ATTACKS**: 4 cards, of which 1 is a Trainer. Hand Read would deal 50 (not
    250) and Hand Count 120 (not 210). Without this the attacker's hand would be
    whatever the setup dealt, and a seat mistake would be a coincidence. */
const OWN_HAND = ["fix-stadium", "fix-energy", "fix-energy", "fix-basic-1"] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Rebuild `seat`'s HAND outright — every dealt card back into the deck, then exactly
    `ids` dealt off it (`opponentHandFamily.test.ts`'s `withHand`, which this file
    needs for the same reason: the hand is the zone under test at BOTH seats). */
function withHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, seat, id, 1);
  return next;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both Actives are placed by surgery and BOTH Benches are cleared —
    every number here is a POPULATION, and a body the setup shuffle happened to place
    would still be noise. One {C} pays the printed cost of all three attacks.

    ⚠️ **BOTH DISCARD PILES ARE STOCKED, AND THAT IS THE ⑵ ZONE CONTROL.** The
    defender's pile holds TWO Items (trainerCard 2, anyCard 2), so a build reading the
    pile instead of the hand deals 100 and 60 where the print says 250 and 210 — a
    NON-ZERO wrong number, which is the only kind a suite can distinguish from an
    empty-board accident. */
function board(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: OPPONENT_HAND_DECK, p2: OPPONENT_HAND_DECK }, { first: foe }),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-trainerops");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-basic-1");
  state = clearBench(state, foe);
  // ⚠️ THE HANDS ARE REBUILT BEFORE THE PILES ARE STOCKED, and the order is not
  // cosmetic: `withHand` puts every dealt card BACK in the deck first, so stocking a
  // pile beforehand competes with the setup deal for the same four copies.
  state = withHand(state, by, OWN_HAND);
  state = withHand(state, foe, FOE_HAND);
  state = discardFromDeck(state, foe, "fix-stadium", 2);
  return discardFromDeck(state, by, "fix-tool", 1);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(state: GameState, index: number, seat: Seat = "p1"): number | undefined {
  return find(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

/** The flattened text of the one action row a batch produced that mentions `needle`. */
function rowText(state: GameState, events: GameEvent[], needle: string): string {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  const row = logFromEvents(events, ctx).find(
    (r) => r.kind === "action" && r.segments.some((s) => s.text.includes(needle)),
  );
  if (row === undefined || row.kind !== "action") throw new Error(`no row mentioning ${needle}`);
  return row.segments.map((s) => s.text).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, the population, and the fixture that carries it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the three printed sentences, their population, and the fixture", () => {
  it("the column prints the three on three records, 6 legal printings in all", () => {
    const rows = CLAIMED.map((text) => legalAttackCorpus().filter(([, s]) => s === text));
    expect(rows.map((r) => r.length)).toEqual([1, 1, 1]);
    expect(rows.map((r) => r[0]?.[0])).toEqual([3, 2, 1]);
    expect(rows.reduce((sum, r) => sum + (r[0]?.[0] ?? 0), 0)).toBe(6);
  });

  it("🛑 the WHOLE 'reveals their hand' family, printed whole and classified", () => {
    // ⚠️ THE PATTERN, PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425): every corpus row
    // containing the literal `reveals their hand`. Every hit is read and named. What
    // this pattern CANNOT see: a sentence spelling the act any other way ("have your
    // opponent reveal their hand" — the Ability column's wording, which is not this
    // column), and a hand count that names no reveal at all (which is why
    // `HAND_COUNT` is listed separately in the rung above rather than here).
    const family = legalAttackCorpus().filter(([, s]) => s.includes("reveals their hand"));
    expect(family.map(([n, s]) => `${n} ${s}`).sort()).toEqual(
      [
        "1 Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
        "1 Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.",
        "1 Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
        "2 Your opponent reveals their hand. Discard a card you find there.",
        "2 Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench.",
        "3 Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.",
        "7 Your opponent reveals their hand.",
      ].sort(),
    );
    // 17 legal printings carry the literal; D445 claims 5 of them (rows 672 + 675)
    // and leaves 2 refused (rows 673 + 676), each with its own reason in §6.
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(17);
  });

  it("carries fix-trainerops' three appended attacks, `50×`/`30×` markers included", () => {
    // D183's rule: an arm written from a paraphrase passes a test written against the
    // same paraphrase and matches no real card. The strings above are asserted to be the
    // FIXTURE's bytes, and the fixture is asserted to be the CORPUS's.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect([HAND_READ, SNATCH, HAND_COUNT_IDX].map((i) => attacks[i]?.effect)).toEqual([
      ...CLAIMED,
    ]);
    // The printed damage markers: `50×` and `30×` on the two folds, and NOTHING on the
    // discard — which is the corpus row, and is what makes §4's "the base is dropped"
    // rung about the FOLD rather than about an absent number.
    expect([HAND_READ, SNATCH, HAND_COUNT_IDX].map((i) => attacks[i]?.damage)).toEqual([
      "50×",
      undefined,
      "30×",
    ]);
    // 🛑 AND THE FIXTURE AUTHORS NOTHING — every printing is read off the TEXT, so a
    // registry row could not be quietly doing the work.
    expect(programFor("fix-trainerops")?.attack).toBeUndefined();
  });

  it("🛑 the apostrophe byte is U+0027, measured and not remembered", () => {
    const row = legalAttackCorpus().find(([, s]) => s === HAND_COUNT);
    const text = row?.[1] ?? "";
    expect(text.indexOf("'")).toBe(57);
    expect(text.codePointAt(57)).toBe(0x27);
    // The other two carry none at all — so this is the only one of the three the
    // re-ingest sweep in `clauseApostrophe.test.ts` can see.
    expect(REVEAL_TRAINER_SCALE.includes("'")).toBe(false);
    expect(REVEAL_DISCARD.includes("'")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the anchors, the vocabulary, and THE DUAL CLAIM.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — two anchors, one noun map, and the first two-reader sentence", () => {
  it("🛑 THE DUAL CLAIM: row 675 is owned by TWO readers and refused by the other eleven", () => {
    // D438's rule, applied: a positive replacement for a negated disjunction is a
    // claim about NONE of the disjuncts, so the OWNERS are named and the eleven
    // refusals are kept beside them. Only this shape reddens on a widening.
    expect(deriveAttackEffect(REVEAL_TRAINER_SCALE)).toEqual([{ op: "revealOpponentHand" }]);
    expect(deriveAttackDamageMultiplier(REVEAL_TRAINER_SCALE)).toEqual({
      per: 50,
      count: { kind: "cardsInOpponentHand", filter: TRAINER },
    });
    for (const read of OTHERS) expect(read(REVEAL_TRAINER_SCALE)).toBeNull();
  });

  it("🛑 …and it is the ONLY sentence in the 640-row column with two owners", () => {
    // ⚠️ THE CLAIM IS A POPULATION CLAIM, NOT A SPECIMEN ONE (D423). Before D445 the
    // count was ZERO — `attack.ts`'s own comment says *"a card carries at most one
    // scaling clause OR a program: the whole-sentence anchor means a scaling sentence
    // never also derives an op"*, which was a HABIT and not a property (D431). It is
    // now false, deliberately, and this rung is what stops it becoming false by
    // ACCIDENT somewhere else: a widening that made a second sentence dual-claimed
    // would land here rather than in whichever suite happened to drive it.
    const readers = [
      deriveAttackEffect,
      deriveAttackDamageMultiplier,
      ...OTHERS,
    ] as const;
    const dual = legalAttackCorpus().filter(
      ([, text]) => readers.filter((read) => read(text) !== null).length > 1,
    );
    expect(dual.map(([, s]) => s)).toEqual([REVEAL_TRAINER_SCALE]);
  });

  it("the bare-reveal and bare-count sentences keep exactly ONE owner each", () => {
    // The CONTROL for the rung above: two new arms landed in front of D232's bare
    // reveal, and it still owns its own string and nothing else's.
    expect(deriveAttackEffect("Your opponent reveals their hand.")).toEqual([
      { op: "revealOpponentHand" },
    ]);
    expect(deriveAttackDamageMultiplier("Your opponent reveals their hand.")).toBeNull();
    expect(deriveAttackDamageMultiplier(HAND_COUNT)).toEqual({
      per: 30,
      count: { kind: "cardsInOpponentHand", filter: ANY_CARD },
    });
    expect(deriveAttackEffect(HAND_COUNT)).toBeNull();
    for (const read of OTHERS) expect(read(HAND_COUNT)).toBeNull();
  });

  it("the discard destination derives with NO filter and NO upTo", () => {
    // D135: an absent field means what the sentence means. The print says "a card",
    // the article and not a number, so the pick is the op's M5 mandatory single.
    expect(deriveAttackEffect(REVEAL_DISCARD)).toEqual([
      { op: "bottomFromOpponentHand", dest: "discard" },
    ]);
    expect(deriveAttackDamageMultiplier(REVEAL_DISCARD)).toBeNull();
    for (const read of OTHERS) expect(read(REVEAL_DISCARD)).toBeNull();
  });

  it("🛑 the noun map REFUSES what it cannot spell, and the sentence stays LOUD", () => {
    // The map is closed and the regex is not the thing doing the refusing (D440's
    // rule): a noun the map has no row for falls through to `null` on BOTH anchors.
    expect(
      deriveAttackDamageMultiplier(
        "Your opponent reveals their hand. This attack does 50 damage for each Ancient card you find there.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each Ancient card in your opponent's hand.",
      ),
    ).toBeNull();
    // …and the reveal half is refused WITH it, so a card printing an unreadable noun
    // does not resolve half of what it says (D190b's exact-map-or-flag rule).
    expect(
      deriveAttackEffect(
        "Your opponent reveals their hand. This attack does 50 damage for each Ancient card you find there.",
      ),
    ).toBeNull();
  });

  it("🛑 THE SEAT the member has no field for: a YOUR-hand fold is refused", () => {
    // Constructed, and labelled so. The column prints no fold over your own hand
    // (§6 pins that as a population claim), so this rung is a claim about the READER:
    // the anchors carry the possessive as a LITERAL, not as a capture, which is what
    // makes the missing `seat` field safe rather than lucky.
    expect(deriveAttackDamageMultiplier(CONSTRUCTED_YOUR_HAND)).toBeNull();
    expect(deriveAttackDamageBonus(CONSTRUCTED_YOUR_HAND)).toBeNull();
  });

  it("the whole-sentence anchors hold at both ends, on the capital, and on the zero", () => {
    for (const text of CLAIMED) {
      const lowered = `If heads, ${text[0]?.toLowerCase()}${text.slice(1)}`;
      expect(deriveAttackEffect(lowered)).toBeNull();
      expect(deriveAttackDamageMultiplier(lowered)).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`)).toBeNull();
      expect(deriveAttackDamageMultiplier(`${text} Draw a card.`)).toBeNull();
    }
    // The printed-zero guard every arm in both families carries.
    expect(
      deriveAttackDamageMultiplier(
        "Your opponent reveals their hand. This attack does 0 damage for each Trainer card you find there.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageMultiplier("This attack does 0 damage for each card in your opponent's hand."),
    ).toBeNull();
  });

  it("🛑 the U+2019 spelling resolves IDENTICALLY on the one sentence that has one", () => {
    // D137's class, on the ONE row of the three that carries an apostrophe.
    const curly = HAND_COUNT.replaceAll("'", "’");
    expect(curly).not.toBe(HAND_COUNT);
    expect(deriveAttackDamageMultiplier(curly)).toEqual(deriveAttackDamageMultiplier(HAND_COUNT));
  });

  it("🛑 no splitter composes on any of the three, before OR after this slice", () => {
    // ⚠️ THE TRAILING SPLITTER IS THE ONE THAT LOOKS LIKE IT SHOULD, AND IT MUST NOT.
    // Row 675 is an EFFECT head with a DAMAGE tail, which is the exact mirror of
    // `splitAttackTrailingClause`'s predicate — its guard requires the TAIL to be a
    // clause `deriveAttackEffect` claims. Both before this slice (nothing claimed the
    // whole string, and the tail was unread) and after it (the shadow refusal fires
    // first, because two readers now claim the whole string) the answer is null, and
    // the two nulls have DIFFERENT causes. That is why the rung is here rather than
    // inferred from the census.
    for (const text of CLAIMED) {
      expect(splitAttackTrailingClause(text)).toBeNull();
      expect(splitAttackGateClause(text)).toBeNull();
      expect(splitAttackRequirementClause(text)).toBeNull();
      expect(splitAttackCancelClause(text)).toBeNull();
    }
    // …and the tail of row 675 really is a clause `deriveAttackEffect` refuses, which
    // is the half of the splitter's guard that does the refusing here.
    expect(
      deriveAttackEffect("This attack does 50 damage for each Trainer card you find there."),
    ).toBeNull();
  });
});

/** The board §3's delegation rung needs, and NOTHING else uses. `OPPONENT_HAND_DECK`
    holds no TYPED Basic Energy, and D420's `BoardCondition` takes a printed type — so a
    "the two agree" rung on the canonical board would be two zeroes agreeing. This deck
    already carries three Basic types (D234's), so p2's hand can hold three {F} beside one
    {W} and the count, the threshold and the type filter all discriminate at once. */
function typedEnergyHands(): GameState {
  const state = must(
    applyAction(
      driveSetup(SEED, { p1: DISCARD_ATTACH_DECK, p2: DISCARD_ATTACH_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  return withHand(
    withHand(state, "p1", ["fix-water-energy"]),
    "p2",
    ["fix-fighting-energy", "fix-fighting-energy", "fix-fighting-energy", "fix-water-energy"],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — `countCardsInHand`: the zone, the filter, and the SHARED walk.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `countCardsInHand`: the hand, seat-relative, filtered", () => {
  it("🛑 the canonical hands answer 7 / 5 / 3 / 1 / 1 / 1 / 0 and 4 / 1", () => {
    const state = board();
    const foe = (f: CardFilter) => countCardsInHand(state, "p2", f);
    expect(foe(ANY_CARD)).toBe(7);
    expect(foe(TRAINER)).toBe(5);
    expect(foe({ kind: "item" })).toBe(3);
    expect(foe({ kind: "toolCard" })).toBe(1);
    expect(foe({ kind: "supporter" })).toBe(1);
    expect(foe({ kind: "anyPokemon" })).toBe(1);
    expect(foe({ kind: "stadium" })).toBe(0);
    // …and the ATTACKER's own hand is a DIFFERENT number on both printed filters, so a
    // seat mistake is never a coincidence.
    expect(countCardsInHand(state, "p1", ANY_CARD)).toBe(4);
    expect(countCardsInHand(state, "p1", TRAINER)).toBe(1);
  });

  it("🛑 THE ZONE: the same filters over the PILE and the BOARD are different numbers", () => {
    // ⑵'s control, and it is what makes a walk over the wrong zone a visible wrong
    // ANSWER rather than an empty one.
    const state = board();
    expect(countCardsInDiscardPile(state, "p2", TRAINER)).toBe(2);
    expect(countCardsInDiscardPile(state, "p2", ANY_CARD)).toBe(2);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(state.players.p2.active).not.toBeNull();
  });

  it("🛑 an EMPTY hand is 0 and an UNRESOLVABLE uid contributes 0, on every filter", () => {
    const state = board();
    const empty = { ...state, players: { ...state.players, p2: { ...state.players.p2, hand: [] } } };
    for (const f of [ANY_CARD, TRAINER, { kind: "item" } as CardFilter]) {
      expect(countCardsInHand(empty, "p2", f)).toBe(0);
    }
    // `cardOfUid` answers undefined and `matchesFilter`'s first line answers false, so a
    // uid the catalog cannot resolve is skipped rather than thrown on.
    const ghost = {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, hand: [...state.players.p2.hand, "no-such-uid"] },
      },
    };
    expect(countCardsInHand(ghost, "p2", ANY_CARD)).toBe(7);
    expect(countCardsInHand(ghost, "p2", TRAINER)).toBe(5);
  });

  it("🛑 the GENERALISED walk and D420's threshold cannot disagree", () => {
    // ⑸. `yourBasicEnergyInHandAtLeast` is now a DELEGATION to this function, so the
    // `BoardCondition` THRESHOLD and the `DamageCountSource` COUNT are one
    // implementation. Driven on ONE board through BOTH names — the rung D440 wrote for
    // the pile, at the zone it deferred.
    // ⚠️ **A SECOND BOARD, AND IT IS NOT A CONVENIENCE.** D420's member takes a printed
    // TYPE (`energy: BasicEnergyType`), and `OPPONENT_HAND_DECK` carries only the
    // Colorless `fix-energy` — so the threshold would answer 0 on every type on the
    // canonical board and the "agreement" would be two zeroes agreeing. The board below
    // holds a typed Basic Energy at THREE copies beside a different type at ONE, so the
    // count, the threshold and the type filter all discriminate. **A shared `*_DECK` is
    // never edited to make a board work (D412) — a second board is the cheaper answer.**
    const state = typedEnergyHands();
    const fighting: CardFilter = { kind: "basicEnergy", energyType: "Fighting" };
    const held = countCardsInHand(state, "p2", fighting);
    expect(held).toBe(3);
    for (let n = 0; n <= 5; n += 1) {
      expect(
        conditionHolds(state, "p2", {
          kind: "yourBasicEnergyInHandAtLeast",
          energy: "Fighting",
          count: n,
        }),
        `count ${n}`,
      ).toBe(held >= n);
    }
    // The TYPE really narrows — the same hand answers 1 for Water and 0 for Grass, so a
    // walk that dropped the filter would be a different number at every threshold.
    expect(countCardsInHand(state, "p2", { kind: "basicEnergy", energyType: "Water" })).toBe(1);
    expect(countCardsInHand(state, "p2", { kind: "basicEnergy", energyType: "Grass" })).toBe(0);
    // …and the threshold reads the ASKER's own hand, so the two seats answer differently
    // on one board: p1 holds none of it.
    expect(countCardsInHand(state, "p1", fighting)).toBe(0);
    expect(
      conditionHolds(state, "p1", {
        kind: "yourBasicEnergyInHandAtLeast",
        energy: "Fighting",
        count: 1,
      }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the fold, and the ORDER of the reveal.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the fold: two attacks, two numbers, one board", () => {
  it("🛑 the canonical board deals 250 and 210", () => {
    const state = board();
    expect(dealt(state, HAND_READ)).toBe(250); // 50 × 5 Trainers
    expect(dealt(state, HAND_COUNT_IDX)).toBe(210); // 30 × 7 cards
  });

  it("🛑 every wrong ZONE, SEAT and FILTER is a different number on the same swing", () => {
    // ⑵/⑶/⑷ in one rung, stated as the arithmetic each mistake would produce:
    //   pile  →  50 × 2 = 100  and 30 × 2 =  60
    //   board →  50 × 1 =  50  and 30 × 1 =  30
    //   own hand → 50 × 1 = 50 and 30 × 4 = 120
    //   item  →  50 × 3 = 150 · anyCard on Hand Read → 350 · trainerCard on Hand Count → 150
    const state = board();
    const foeHand = countCardsInHand(state, "p2", TRAINER);
    expect([
      countCardsInDiscardPile(state, "p2", TRAINER) * 50,
      countCardsInHand(state, "p1", TRAINER) * 50,
      countCardsInHand(state, "p2", { kind: "item" }) * 50,
      countCardsInHand(state, "p2", ANY_CARD) * 50,
    ]).toEqual([100, 50, 150, 350]);
    expect(foeHand * 50).toBe(250);
    expect([
      countCardsInDiscardPile(state, "p2", ANY_CARD) * 30,
      countCardsInHand(state, "p1", ANY_CARD) * 30,
      countCardsInHand(state, "p2", TRAINER) * 30,
    ]).toEqual([60, 120, 150]);
  });

  it("🛑 the SAME two numbers from the other chair — the mirror board", () => {
    // `board("p2")` builds the identical table with the seats swapped, so p2 attacking
    // reads p1's seven-card hand and both numbers are unchanged. ⚠️ **THIS IS NOT THE
    // SEAT-INVERSION RUNG** — that is the arithmetic one above, where reading the
    // ATTACKER's hand on the SAME board is 50 and 120. This one says the fold is
    // seat-RELATIVE rather than hard-wired to p2, which is a different claim and would
    // pass on a build that hard-coded `defenderSeat` correctly.
    const state = board("p2");
    expect(dealt(state, HAND_READ, "p2")).toBe(250);
    expect(dealt(state, HAND_COUNT_IDX, "p2")).toBe(210);
    // …and the inversion evidence, re-read on the mirror board: the attacker's own hand
    // is 1 Trainer / 4 cards there too, so a build reading it deals 50 and 120.
    expect(countCardsInHand(state, "p2", TRAINER) * 50).toBe(50);
    expect(countCardsInHand(state, "p2", ANY_CARD) * 30).toBe(120);
  });

  it("🛑 the MULTIPLY fold DROPS the printed base — an EMPTY hand deals NOTHING", () => {
    // ⑸. Both sentences carry `×` markers, so `scaledBase` is 0 and a zero count is no
    // `DAMAGE_DEALT` row at all rather than a bare printed base. This is also what makes
    // the empty-hand board a real case rather than a curiosity: the printed floor.
    const state = withHand(board(), "p2", []);
    expect(countCardsInHand(state, "p2", ANY_CARD)).toBe(0);
    expect(dealt(state, HAND_READ)).toBeUndefined();
    expect(dealt(state, HAND_COUNT_IDX)).toBeUndefined();
    // …and the reveal STILL happens on the damage-scaling sentence, honestly, as zero
    // uids — D232's rule, which the fold must not swallow.
    const out = swing(state, HAND_READ);
    expect(find(out.events, "HAND_REVEALED")?.uids).toEqual([]);
  });

  it("🛑 BOTH HALVES OF ROW 675 RESOLVE, and dropping either is observable", () => {
    // ⑴ driven on a board. A build reading only the fold deals 250 and files no
    // HAND_REVEALED; a build reading only the reveal deals 0 (the `×` base is dropped)
    // and reveals. Only the real build does both.
    const state = board();
    const out = swing(state, HAND_READ);
    expect(find(out.events, "DAMAGE_DEALT")?.dealt).toBe(250);
    expect(find(out.events, "HAND_REVEALED")?.seat).toBe("p2");
    expect(find(out.events, "HAND_REVEALED")?.uids).toEqual(state.players.p2.hand);
    // …and the CONTROL: the sentence with no printed reveal files no reveal.
    const bare = swing(state, HAND_COUNT_IDX);
    expect(find(bare.events, "DAMAGE_DEALT")?.dealt).toBe(210);
    expect(find(bare.events, "HAND_REVEALED")).toBeUndefined();
  });

  it("🛑 THE REVEAL RUNS AFTER THE DAMAGE, AND THAT IS A DECISION (D426)", () => {
    // The printed order is reveal-then-damage; the engine's is damage-then-reveal,
    // because an effect program runs at `attack()`'s TAIL and the fold lands before
    // §8.5. **NO NUMBER MOVES**: the reveal mutates no zone, so the fold reads the
    // identical hand either way, and both rows land in ONE action batch.
    //
    // ⚠️ **PINNED RATHER THAN LEFT AS AN APPARENT OVERSIGHT.** The alternative is a
    // fifth `AttackPreDamage` member, and it is refused: every one of that union's four
    // members exists because it MOVES A NUMBER before §8.5 (a discarded Tool changes
    // `damageReductionAfterWR` and `effectiveMaxHp`), and a reveal moves none — so the
    // seam would buy row ORDER for a union member. **The falsifier is executable**: the
    // day a printed sentence reveals AND changes something the §8.5 pipeline reads, it
    // needs that seam and this arm is the wrong home for it.
    const out = swing(board(), HAND_READ);
    const order = out.events.map((e) => e.type);
    expect(order).toContain("DAMAGE_DEALT");
    expect(order).toContain("HAND_REVEALED");
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("HAND_REVEALED"));
    // …and the hand the fold counted is the hand the reveal named, byte for byte, which
    // is the property that makes the order unobservable in the numbers.
    expect(find(out.events, "HAND_REVEALED")?.uids).toHaveLength(7);
    expect(find(out.events, "DAMAGE_DEALT")?.dealt).toBe(250);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the DISCARD destination: the park, the arity, the event, the log.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — `bottomFromOpponentHand.dest: \"discard\"`", () => {
  it("🛑 parks the pick with the card's OWN printed sentence as the note", () => {
    // The round trip that `bottomFromOpponentHandNote` is grown one printed form per
    // card for: the caption is this card's text, character for character, and the two
    // files are checked against each other by driving rather than by eye.
    const state = board();
    const before = [...state.players.p2.hand];
    const { state: parked, events } = swing(deepFreeze(state), SNATCH);
    expect(find(events, "HAND_REVEALED")?.uids).toEqual(before);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.note).toBe(REVEAL_DISCARD);
    // The pick is MANDATORY and exactly one — the printed article, not a number.
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    // …and the prompt's `dest` is the OP's, so the dialog cannot promise a bottom-of-deck
    // over a card going to a pile (D294's pair of rows, at a third destination).
    expect(prompt.dest).toBe("discard");
    // 🛑 THE OFFER COLLAPSES INTERCHANGEABLE COPIES: three `fix-item` in a seven-card
    // hand offer FIVE candidates, not seven — one representative per class, because the
    // unmarked op's cap is 1.
    expect(prompt.candidates).toHaveLength(5);
  });

  it("🛑 the ANSWER moves the card into the OWNER's pile and files the event", () => {
    const state = board();
    const { state: parked } = swing(deepFreeze(state), SNATCH);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const uid = prompt.candidates[0] as string;
    const resolved = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    // The card left the OWNER's hand for the OWNER's own pile — never the actor's.
    expect(resolved.state.players.p2.hand).not.toContain(uid);
    expect(resolved.state.players.p2.discard).toContain(uid);
    expect(resolved.state.players.p1.discard).not.toContain(uid);
    // ⚠️ EXACTLY ONE of the seven left, and it is counted against the ORIGINAL hand
    // rather than against a length: the attack ends p1's turn (§5.3), so p2's turn-start
    // draw lands in that hand in the same batch and a bare `toHaveLength(6)` would be
    // asserting the draw as much as the discard.
    const kept = state.players.p2.hand.filter((u) => resolved.state.players.p2.hand.includes(u));
    expect(kept).toHaveLength(6);
    expect(state.players.p2.hand.filter((u) => !kept.includes(u))).toEqual([uid]);
    // 🛑 THE ATTRIBUTION: `seat` is the OWNER, `actor` is the chooser. A row that
    // swapped them would read as the defender discarding a card of their own.
    const row = find(resolved.events, "CARD_DISCARDED_FROM_HAND");
    expect(row).toEqual({ type: "CARD_DISCARDED_FROM_HAND", seat: "p2", uid, actor: "p1" });
    // …and the reveal rode the action that PARKED, not the answer (D294's rule).
    expect(find(resolved.events, "HAND_REVEALED")).toBeUndefined();
  });

  it("🛑 ONE interchangeable class resolves INLINE — the M1 no-choice rule", () => {
    // D416's rule: an op that can park is untested on parks unless some board offers
    // TWO candidates and some board offers ONE. The rung above is the park; this is the
    // forced arm, and the two together are what make the arity real.
    const state = withHand(board(), "p2", ["fix-item", "fix-item"]);
    const { state: done, events } = swing(deepFreeze(state), SNATCH);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(find(events, "HAND_REVEALED")?.uids).toHaveLength(2);
    const row = find(events, "CARD_DISCARDED_FROM_HAND");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    // One of the two left the hand (the turn-start draw replaces it — see the rung above
    // for why the count is taken against the original hand).
    expect(state.players.p2.hand.filter((u) => done.players.p2.hand.includes(u))).toHaveLength(1);
    expect(done.players.p2.discard).toHaveLength(3); // the board's two Stadiums + this one
  });

  it("🛑 an EMPTY hand WHIFFS — the reveal still happens, nothing moves, no park", () => {
    const state = withHand(board(), "p2", []);
    const { state: done, events } = swing(deepFreeze(state), SNATCH);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(find(events, "HAND_REVEALED")?.uids).toEqual([]);
    expect(find(events, "CARD_DISCARDED_FROM_HAND")).toBeUndefined();
    expect(done.players.p2.discard).toHaveLength(2);
  });

  it("🛑 the LOG says CHOSE, which is what tells it from the RANDOM twin", () => {
    // `RANDOM_CARD_TAKEN`'s own block states the rule: without the distinguishing word
    // a chosen discard and a random one are the same row, and they are materially
    // different things to have happened to you. Filed under the ACTOR, with the owner
    // named OUTRIGHT rather than by a possessive so a mirror match cannot print an
    // identical row from both seats.
    const state = withHand(board(), "p2", ["fix-item", "fix-item"]);
    const { state: done, events } = swing(deepFreeze(state), SNATCH);
    expect(find(events, "CARD_DISCARDED_FROM_HAND")?.uid).toBeDefined();
    // The row names the CARD, resolved through `cardName` — not the uid, which is what
    // every other card-naming row in `log.ts` does.
    expect(rowText(done, events, "chose")).toBe("chose fix-item from Tide's hand and discarded it");
    const ctx: LogContext = { names: NAMES, state: done, elapsed: formatElapsed(0) };
    const row = logFromEvents(events, ctx).find(
      (r) => r.kind === "action" && r.segments.some((s) => s.text.includes("chose")),
    );
    expect(row?.kind === "action" ? row.who : null).toBe("p1");
    // …and it does NOT say "random", which is the neighbouring row's word.
    expect(rowText(done, events, "chose")).not.toContain("random");
  });

  it("🛑 the hand stays HIDDEN afterwards, and EXACTLY the discarded card is public", () => {
    // D426's redaction rule: "the actor could not see the opponent's hand before the
    // attack either", so the case that carries the claim is the one AFTER the answer —
    // exactly the discarded card becomes public and the rest stay shut. ⚠️ The uids are
    // QUOTED, because `p2#4` is a prefix of `p2#42` (D426).
    const state = board();
    const { state: parked } = swing(deepFreeze(state), SNATCH);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const uid = prompt.candidates[0] as string;
    const resolved = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    const seen = redactGame(resolved.state, "p1");
    // The discarded card IS in the opponent's public pile, by uid (the `id` field on a
    // `RedactedCard` is the engine uid).
    expect(seen.board.opponent.discard.map((c) => c.id)).toContain(uid);
    // …and every card STILL in that hand is absent from the whole snapshot.
    const wire = JSON.stringify(seen);
    for (const still of resolved.state.players.p2.hand) {
      expect(wire.includes(`"${still}"`), still).toBe(false);
    }
    // The projection reports a COUNT and no identities — `redact.ts` hides the opponent's
    // hand unconditionally, which is what makes the printed reveal INSTANTANEOUS rather
    // than a durable flag. **There is no "revealed" field anywhere and this rung is what
    // says so**: a build that added one would have to keep this green.
    // The count is whatever the live hand holds (six kept plus p2's turn-start draw), and
    // EVERY slot is a face-down back — the projection is a COUNT and no identities.
    expect(seen.board.opponent.hand).toHaveLength(resolved.state.players.p2.hand.length);
    expect(new Set(seen.board.opponent.hand.map((c) => c.cardId))).toEqual(
      new Set([HIDDEN_CARD_ID]),
    );
    expect(JSON.stringify(resolved.state)).not.toContain("revealed");
  });

  it("🛑 the OPPONENT never receives the prompt — the answerer gate", () => {
    // The candidates are the DEFENDER's own hand cards, resolved to identities for the
    // ATTACKER because the hand was just revealed. The gate is `answerer`, and the
    // defender is not it.
    const state = board();
    const { state: parked } = swing(deepFreeze(state), SNATCH);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const mine = redactGame(parked, "p1");
    const theirs = redactGame(parked, "p2");
    expect(mine.phase.kind).toBe("effect:choose");
    expect(mine.phase.kind === "effect:choose" ? mine.phase.prompt : "absent").not.toBeNull();
    expect(theirs.phase.kind === "effect:choose" ? theirs.phase.prompt : "absent").toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the census, the two REFUSALS, and the information rule as a POPULATION.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the population claims this slice rests on", () => {
  it("🛑 NO corpus sentence carries a FILTERED hand count without a printed reveal", () => {
    // 🛑 **THE INFORMATION RULE, PINNED ON THE POPULATION AND NOT ON A SPECIMEN (D423).**
    // The `DamageCountSource` union's standing invariant is that every member counts
    // something both seats can see; this member's zone is hidden, and what keeps the
    // invariant is the PRINT. So the claim that has to be executable is *"a filtered hand
    // count is always preceded by a reveal"* — asserted over the whole column, so the day
    // a printing breaks it this rung goes RED and the member's doc block stops being true
    // LOUDLY. An assertion about one hand-written sentence could never say this.
    // ⚠️ **THE PATTERN AND ITS EDGES (D424/D425)**: `/damage for each .*(in your
    // opponent's hand|you find there)\./` over all 640 rows. It returns THREE hits and
    // every one is read. The third is NOT this family and is named rather than filtered
    // away silently — *"Reveal the top 5 cards of your deck. This attack does 70 damage
    // for each Future card you find there. …"* (2 printings) is a DECK window, where
    // *"there"* is the five revealed cards; it is refused for its noun (the Ancient/Future
    // banner is in no catalog column — D440's permanent data block) and would be refused
    // for its zone anyway. What the pattern CANNOT see: a fold spelling the zone without
    // the word *hand* and without *you find there*.
    const DECK_WINDOW_FUTURE =
      "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck.";
    const allFolds = legalAttackCorpus().filter(([, s]) =>
      /damage for each .*(in your opponent's hand|you find there)\./.test(s),
    );
    expect(allFolds.map(([, s]) => s).sort()).toEqual(
      [HAND_COUNT, REVEAL_TRAINER_SCALE, DECK_WINDOW_FUTURE].sort(),
    );
    expect(resolvedByAnyReader(DECK_WINDOW_FUTURE)).toBe(false);
    const handFolds = allFolds.filter(([, s]) => s !== DECK_WINDOW_FUTURE);
    expect(handFolds.map(([, s]) => s).sort()).toEqual([HAND_COUNT, REVEAL_TRAINER_SCALE].sort());
    for (const [, s] of handFolds) {
      const count = deriveAttackDamageMultiplier(s)?.count;
      if (count?.kind !== "cardsInOpponentHand") throw new Error(`not a hand fold: ${s}`);
      // The bare `anyCard` reading needs no reveal — a hand's SIZE is public. Anything
      // NARROWER must print one, and must have it SIMULATED (a printed reveal the engine
      // does not perform would be the same leak with better manners).
      if (count.filter.kind === "anyCard") continue;
      expect(s, s).toContain("Your opponent reveals their hand.");
      expect(deriveAttackEffect(s), s).toEqual([{ op: "revealOpponentHand" }]);
    }
  });

  it("🛑 NO corpus sentence folds damage over YOUR OWN hand — the missing `seat` field", () => {
    // The falsifier for the member having no `seat`: the day the column prints a fold
    // over your own hand this goes RED and the member gains a sibling. ⚠️ The pattern is
    // the LOOSEST plausible one — any "for each … hand" fold — and every hit is read.
    // What it cannot see: a fold spelling the zone without the word *hand*.
    const yourHand = legalAttackCorpus().filter(
      ([, s]) => /damage for each .*in your hand\./.test(s) || /damage for each .*in their hand\./.test(s),
    );
    expect(yourHand).toEqual([]);
  });

  it("🛑 REFUSAL 1 — the mandatory SWEEP is claimed by NO reader, and the reason is SHAPE", () => {
    // ⚠️ **NOT A VOCABULARY REFUSAL, WHICH IS WHY THE FILTER IS SPELLED HERE.** The
    // printed noun is `anyOf` two members that already exist, with ZERO new `CardFilter`
    // members — so the union is not what blocks it. What blocks it is that *"Discard
    // **all** … you find there"* is a mandatory TOTAL sweep with no pick, while
    // `bottomFromOpponentHand`'s whole middle is an OFFER that is filtered, collapsed to
    // one representative per interchangeable class, and then asked. Routing a sweep
    // through a park-shaped op means disabling the collapse, the arity check and the
    // auto-resolve on a field whose name (`upTo`) is the printed words of a CEILING.
    // **The falsifier is this rung**: the day a mandatory-sweep op exists, or a second
    // printing makes the shape worth its own op, this goes RED.
    expect(legalAttackCorpus().filter(([, s]) => s === REVEAL_SWEEP)).toHaveLength(1);
    expect(resolvedByAnyReader(REVEAL_SWEEP)).toBe(false);
    expect(splitAttackTrailingClause(REVEAL_SWEEP)).toBeNull();
    expect(splitAttackGateClause(REVEAL_SWEEP)).toBeNull();
    // …and the FILTER really is expressible, which is the half that makes this a shape
    // refusal rather than a vocabulary one. A rung that only asserted the refusal could
    // not tell the two apart.
    const printed: CardFilter = { kind: "anyOf", filters: [{ kind: "item" }, { kind: "toolCard" }] };
    expect(printed.kind).toBe("anyOf");
  });

  it("🛑 REFUSAL 2 — the Supporter COPY, re-argued for a SUPPORTER rather than inherited", () => {
    // 🛑 **D436's DEFECT IS A REFUSAL CARRIED WITHOUT RE-ARGUMENT, so the attack-copy
    // family's reasons are re-derived here for a SUPPORTER and both come out STRONGER.**
    //
    //   ⑴ **THE REACH.** The copy family is refused because a copy op can only splice
    //      `deriveAttackEffect`'s output, and 44% of the attack column resolves through
    //      other readers into `attack()` locals no op can reach. For a SUPPORTER the
    //      figure is worse, not better: there is NO Trainer text deriver at all — Trainers
    //      are REGISTRY rows keyed by card id — so a copy op would answer for the authored
    //      rows and for nothing else, and *"the effect of a Supporter card you find there"*
    //      would silently do nothing for every unauthored Supporter in the opponent's hand.
    //   ⑵ **THE INSTRUMENT.** `effectSimulated` is computed from the COPIER's sentence, so
    //      the moment this anchor claims the string `ATTACK_EFFECT_SKIPPED` can never fire
    //      for this attack again — the engine's one honest failure channel switched off
    //      exactly where it is needed most, while `BUILT.attack` stepped for it.
    //   ⑶ **AND ONE THE ATTACK FAMILY DOES NOT HAVE**: the copied program would run with
    //      an `EffectContext` whose `invokedBy` is `"attack"` over a Supporter's ops, and
    //      several of those ops are gated on the §7.2 one-Supporter-per-turn rule the
    //      attack seam never asks about. A copy that ignored it would let an attack play a
    //      Supporter on a turn the player already spent theirs.
    //
    // **THE FALSIFIER IS THE SAME ONE THE ATTACK FAMILY CARRIES, ONE COLUMN OVER**: this
    // reverses when a Trainer TEXT deriver exists, at which point ⑴ dissolves and ⑵ and ⑶
    // become the whole argument.
    expect(legalAttackCorpus().filter(([, s]) => s === REVEAL_COPY)).toHaveLength(1);
    expect(resolvedByAnyReader(REVEAL_COPY)).toBe(false);
    expect(splitAttackTrailingClause(REVEAL_COPY)).toBeNull();
    // The head of the compound IS claimed — which is what makes the refusal a decision
    // about the TAIL rather than an accident of the anchor.
    expect(deriveAttackEffect("Your opponent reveals their hand.")).not.toBeNull();
  });

  it("🛑 the family's arithmetic still adds up: 5 claimed, 2 refused, 17 printings", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("reveals their hand"));
    const claimed = family.filter(([, s]) => resolvedByAnyReader(s));
    const refused = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect([claimed.length, claimed.reduce((n, [u]) => n + u, 0)]).toEqual([5, 15]);
    expect(refused.map(([, s]) => s).sort()).toEqual([REVEAL_SWEEP, REVEAL_COPY].sort());
    expect(refused.reduce((n, [u]) => n + u, 0)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` STAYS 29, driven in both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — `MATCH_RECORD_VERSION` STAYS 29, driven over the bytes", () => {
  // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from this
  // package; what is driven HERE is the engine-side fact it is about. The rule at that
  // constant is *does the old byte string still mean what it meant*: a WIDENING is free, a
  // RENAME or a new REQUIRED key on a persisted structure is not.
  //
  // 🛑 THIS SLICE HAS THREE SHAPE CHANGES AND THEY SIT AT THREE DIFFERENT ADDRESSES
  // (D443's rule — "the version question" is not one question):
  //   · `DamageCountSource.cardsInOpponentHand` — a PARSE-TIME type, derived from card
  //     text and consumed in the same tick. No op carries one, no field stores one, no
  //     event names one. **Not persisted.**
  //   · `CARD_DISCARDED_FROM_HAND` — a `GameEvent`, and no `GameEvent` is in a
  //     `MatchRecord` at all (`{version, seed, startedAt, names, state, log}`; `state` is a
  //     `GameState`, which holds no events, and `log` is RENDERED). **Not persisted**, so
  //     the required `actor` is free.
  //   · `bottomFromOpponentHand.dest: "discard"` — inside `phase.cont.pendingOp`, inside
  //     `state`, inside a `MatchRecord`. **PERSISTED**, and the only one of the three that
  //     owes an argument: it is a NEW VALUE on an existing optional field, so a v29
  //     continuation carries `dest` ABSENT or `"bench"` and both still mean exactly what
  //     they meant. A widening, not a rename.

  it("🛑 DIRECTION 1 — a v29 record with NO `dest` still replays as the bottom-of-deck pick", () => {
    // The old byte string, reconstructed: a parked `bottomFromOpponentHand` written by a
    // deploy that had never heard of `"discard"`. It is replayed through the REAL action
    // API and must still put the card under the opponent's deck.
    const state = board();
    const { state: parked } = swing(deepFreeze(state), 28); // D232's THIEVING_SWIPE, `dest` absent
    const wire = JSON.parse(JSON.stringify(parked)) as GameState;
    if (wire.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    // ⚠️ **THE ABSENCE IS ASSERTED ON THE PERSISTED OP AND NOT ON THE WHOLE RECORD**: the
    // PROMPT carries a `dest` unconditionally (`"deckBottom"` here), so a whole-state
    // string search would be answering about the wrong key. The op is the address the
    // version question is asked at.
    expect(JSON.stringify(wire.phase.cont.pendingOp)).not.toContain('"dest"');
    const prompt = wire.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const uid = prompt.candidates[0] as string;
    const resolved = mustApply(wire, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    expect(resolved.state.players.p2.deck.at(-1)).toBe(uid);
    expect(resolved.state.players.p2.discard).not.toContain(uid);
  });

  it("🛑 DIRECTION 2 — the NEW value round-trips and lands in the pile, not the deck", () => {
    const state = board();
    const { state: parked } = swing(deepFreeze(state), SNATCH);
    const wire = JSON.parse(JSON.stringify(parked)) as GameState;
    // The literal key anchor D294 used: the new value really is IN the serialized bytes,
    // which is what makes this a persisted address rather than an argument about one.
    expect(JSON.stringify(wire)).toContain('"dest":"discard"');
    if (wire.phase.kind !== "effect:choose") throw new Error("expected the pick park");
    const prompt = wire.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const uid = prompt.candidates[0] as string;
    const resolved = mustApply(wire, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid] },
    });
    expect(resolved.state.players.p2.discard).toContain(uid);
    expect(resolved.state.players.p2.deck).not.toContain(uid);
  });

  it("🛑 DIRECTION 3 — nothing the COUNT produces is on the board at all", () => {
    // Driven as a property of the SERIALIZED bytes rather than reasoned from the type's
    // name (D427: choosing a carrier does not duck persistence). ⚠️ **AND THE SENTENCE
    // TEXT IS DELIBERATELY NOT ASSERTED ABSENT** — `GameState` embeds `cardPool`, so the
    // printed effect string IS in every record and has been since long before v29 (D444
    // paid for that mistake). What must be absent is the derived SHAPE.
    const before = board();
    const after = swing(before, HAND_READ).state;
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("cardsInOpponentHand");
    expect(wire).not.toContain("trainerCard");
    // …the control: the sentence text IS there, so the rung above is about the SHAPE and
    // not about a string that happens to be missing.
    expect(wire).toContain("for each Trainer card you find there");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — purity, and the engine version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the frozen board and the engine version", () => {
  it("hands the FROZEN board back untouched — the purity pair", () => {
    const state = deepFreeze(board());
    expect(dealt(state, HAND_READ)).toBe(250);
    expect(dealt(state, HAND_COUNT_IDX)).toBe(210);
    expect(state.players.p2.hand).toHaveLength(7);
  });

  it("the engine version moved with the behaviour, and the two files agree", () => {
    // BEHAVIOUR moved inside `packages/engine` (a `DamageCountSource` member, a shared
    // walk, two anchors, three reader arms, an op field value, an apply branch, a note
    // branch, a `GameEvent` and a log row), so the number moves. The manifest and the
    // exported constant are asserted TOGETHER — the tie IS the assertion, and either
    // drifting alone is the defect (D275).
    expect(manifest.version).toBe(engineVersion);
    expect(manifest.version).not.toBe("0.345.0");
    expect(manifest.version).not.toBe("0.346.0");
  });
});
