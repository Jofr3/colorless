import { HIDDEN_CARD_ID } from "@luminous/schema";
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
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction } from "./index";
import { conditionHolds, countCardsInDiscardPile } from "./interpreter";
import {
  DISCARD_PILE_COUNT_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.341.0 → 0.342.0 — 🆕🆕 D440: DAMAGE SCALED BY A COUNT OF FILTERED CARDS IN A
// DISCARD PILE, ON EITHER SEAT.
//
//   "This attack does 20 more damage for each Energy card in your discard pile."             2
//   "This attack does 60 more damage for each Ethan's Adventure card in your discard pile."   2
//   "This attack does 30 damage for each Basic Energy card in your opponent's discard pile."  2
//   "This attack does 30 damage for each Item card in your opponent's discard pile."          2
//                                          — 4 sentences / 8 LEGAL printings
//
// THE SIXTEENTH `DamageCountSource`, the first that reads a zone neither player has
// on the board, and the first that carries a SEAT AS A FIELD rather than in its
// member name. `CardFilter` members used: `anyEnergy`, `basicEnergy`, `item`,
// `byName` — **ZERO new ones**, which is what keeps this slice out of
// `retrieveNoun`'s exhaustive switch and out of `BENCHABLE_RETRIEVAL_KINDS`.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
//   ⑴ THE SEAT. Two of the four sentences read YOUR pile and two read your
//      OPPONENT's, and the two piles below are shaped so that **all four numbers
//      move under a seat inversion** — 80/120/90/60 becomes 100/60/60/30.
//   ⑵ THE SEAT/FOLD CONFOUND. ⚠️ **MEASURED: in the buildable core the two are
//      PERFECTLY confounded** — every claimed "more" sentence is YOUR pile and
//      every claimed bare one is your OPPONENT's — so a build that derived either
//      axis from the other reads all four printed sentences and all eight printings
//      correctly. §2 breaks it on CONSTRUCTED text, labelled as constructed, which
//      is the only rung that can: a reader is a function of TEXT, and the column
//      prints no sentence that separates them.
//   ⑶ THE ZONE. The pile, not the board. A build that delegated an Energy noun to
//      `countEnergyInPlay` (the sibling members' walk, and the §6.5 hazard D376's
//      block names outright) reads the ONE `fix-energy` attached to the attacker
//      and deals 40 where the print says 80.
//   ⑷ THE FILTER. Four nouns, four `CardFilter` members, and the two piles answer
//      **different numbers on every neighbouring member**: any/basic/item/byName
//      are 3/2/1/1 on the attacker's pile and 4/3/2/0 on the defender's, with
//      `supporter` 2/1 and `trainerCard` 3/3 and the pile LENGTHS 7/8.
//   ⑸ THE FOLD. Two sentences carry "more" and KEEP the printed base; two carry
//      `30×` and DROP it. §4 drives an EMPTY pile and asserts no `DAMAGE_DEALT` at
//      all on the `×` fold and the bare printed base on the `+` one.
//   ⑹ THE VOCABULARY. Three corpus sentences reach an anchor or the family and are
//      DELIBERATELY LEFT LOUD, for three different reasons — see §2 and §6.
//
// ⚠️ **THE WALK IS D376's, GENERALISED IN PLACE.** `yourBasicEnergyInDiscardAtLeast`
// already scanned this zone with this predicate for a `BoardCondition` THRESHOLD; a
// second walk would have made a pile scan a question with two implementations, and —
// because `D376-discard-threshold-counts-the-whole-pile` quotes one of those lines
// verbatim — a byte-identical copy would also have broken a shipped mutation row into
// a `2×` ERROR without anybody touching it (D416/D437). §3 drives BOTH names on ONE
// board so they cannot disagree.

// ─────────────────────────────────────────────────────────────────────────────
// The printed bytes, off `legalAttackCorpus()` — the committed `legal_standard = 1`
// attack column. ⚠️ THE APOSTROPHES ARE **U+0027**, MEASURED WITH `codePointAt` OVER
// THE CORPUS ROWS AND NOT REMEMBERED (D421's byte): `opponent's` at index 70 and 62
// of the two `×` rows and `Ethan's` at index 46 of the additive one, three slots in
// all. The anchors spell the class `['’]` anyway, per D137, and §2 drives the U+2019
// rewrite through the vocabulary — which is where it would break, because
// `DISCARD_PILE_NOUNS` has an apostrophe in a KEY.
// ─────────────────────────────────────────────────────────────────────────────
const ENERGY_PILE = "This attack does 20 more damage for each Energy card in your discard pile.";
const ETHAN_PILE =
  "This attack does 60 more damage for each Ethan's Adventure card in your discard pile.";
const FOE_BASIC_PILE =
  "This attack does 30 damage for each Basic Energy card in your opponent's discard pile.";
const FOE_ITEM_PILE =
  "This attack does 30 damage for each Item card in your opponent's discard pile.";

/** The four, in fixture-attack order. */
const CLAIMED = [ENERGY_PILE, ETHAN_PILE, FOE_BASIC_PILE, FOE_ITEM_PILE] as const;

/** 🛑 THE SENTENCE THE ANCHOR REACHES AND THE VOCABULARY REFUSES — **DATA-BLOCKED**,
    permanently, and not unbuilt. The Ancient/Future banner is printed on the card FACE
    and is in no column of the persisted catalog and no field of tcgdex's card model
    (`types.ts`:146-149, re-read at D440). The fix is an INGEST change. */
const ANCIENT_PILE = "This attack does 10 more damage for each Ancient card in your discard pile.";

/** 🛑 THE SENTENCE THE ANCHOR REACHES AND THE VOCABULARY REFUSES FOR A COMPLETELY
    DIFFERENT REASON — **UNBUILT**, with an executable falsifier in §6. `byName` is
    exact equality (`cards.ts`:518) and no `CardFilter` member matches a name
    SUBSTRING at any width. */
const TR_NAME_PILE =
  'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.';

/** 🛑 THE FAMILY MEMBER THAT REACHES NEITHER ANCHOR, and it is a STRUCTURAL refusal
    rather than a vocabulary one: the noun is split AROUND the zone phrase, so the
    sentence does not end at "discard pile." and an `^…$` anchor cannot see it. */
const UNITED_WINGS_PILE =
  "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.";

/** 🛑 THE ONE THE LOOSE SURVEY FOUND THAT IS NOT THIS FAMILY AT ALL — a counter
    PLACEMENT whose count scales an op's amount, not the attack's damage. Kept as a
    named constant because a survey that silently drops a hit is the defect this repo
    keeps paying for (D424/D428). */
const COUNTER_PLACEMENT_PILE =
  "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";

/** 🛑 THE TWO EMPTY CELLS OF THE 2×2, **CONSTRUCTED AND LABELLED SO**, which is
    `bodiesInPlayScaling.test.ts` §2's own posture (three non-corpus sentences driven
    to positive values there, with the same note). A reader is a function of TEXT, so
    these are claims about the READER and not about the pool — and they are the only
    rungs in this file that can separate the seat axis from the fold axis, because no
    printed sentence does.

    ⚠️ **THE TWO CELLS ARE NOT EQUALLY HYPOTHETICAL, AND THAT IS WORTH STATING.**
    `CONSTRUCTED_MULTIPLY_YOURS` fills a cell the column DOES print — `TR_NAME_PILE`
    is `×` over YOUR pile, refused for its FILTER and not for its seat — so a
    fold-derived seat is a live defect waiting on one vocabulary row.
    `CONSTRUCTED_SCALE_FOES` fills the diagonal the column prints nowhere at all. */
const CONSTRUCTED_SCALE_FOES =
  "This attack does 40 more damage for each Item card in your opponent's discard pile.";
const CONSTRUCTED_MULTIPLY_YOURS =
  "This attack does 40 damage for each Energy card in your discard pile.";

/** The twelve readers this file's four sentences must NOT reach, so that §2 can assert
    a NAMED owner plus eleven kept refusals rather than a bare `resolvedByAnyReader`
    (D438: a negative over a disjunction is a claim about every disjunct, and its
    positive replacement is a claim about none of them). */
const OTHERS = [
  deriveAttackEffect,
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

/** One seed for the whole suite. Nothing here flips a coin and every card in either
    pile is placed by surgery, so a seed table would describe a shuffle rather than a
    rule. */
const SEED = 1;

const ANY_ENERGY: CardFilter = { kind: "anyEnergy" };
const BASIC_ENERGY: CardFilter = { kind: "basicEnergy" };
const ITEM: CardFilter = { kind: "item" };
const ETHAN_BY_NAME: CardFilter = { kind: "byName", name: "Ethan's Adventure" };

/** The four printed filters, in the same order as `CLAIMED`. */
const FILTERS: readonly CardFilter[] = [ANY_ENERGY, ETHAN_BY_NAME, BASIC_ENERGY, ITEM];

/** The four in NOUN order (any / basic / item / byName), which is the order the pile
    tables in §3 read — deliberately NOT the attack order, so a rung that transcribed
    one list into the other's slot is a different number rather than a coincidence. */
const NOUNS: readonly CardFilter[] = [ANY_ENERGY, BASIC_ENERGY, ITEM, ETHAN_BY_NAME];

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`${seat} has no Active`);
  return body;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both Actives are placed by surgery and BOTH Benches are cleared: every
    number this suite reads is a POPULATION, and a body the setup shuffle happened to
    place would move nothing here but a Bench that grew would still be noise. One {C}
    is attached to pay the printed cost of all four attacks — and that attachment is
    itself load-bearing, because it is what makes the ⑶ zone mistake (`countEnergyInPlay`
    over the board) answer a NON-ZERO wrong number rather than an obviously empty one.
    **BOTH DISCARD PILES ARE EMPTY HERE**, which is the `bare` board §4 drives. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: DISCARD_PILE_COUNT_DECK, p2: DISCARD_PILE_COUNT_DECK },
        { first: foe },
      ),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-discardpile");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

/** 🛑 **THE CANONICAL BOARD: TWO PILES, AND EVERY NEIGHBOURING FILTER ANSWERS A
    DIFFERENT NUMBER ON EACH.**

      attacker's pile (7 cards)          defender's pile (8 cards)
        fix-energy       ×2                fix-fire-energy    ×2
        fix-special      ×1                fix-energy         ×1
        fix-ethansadv    ×1                fix-special        ×1
        fix-ethansadventure ×1             fix-item           ×2
        fix-item         ×1                fix-ethansadventure ×1
        fix-titan        ×1                fix-titan          ×1

    In NOUN order — anyEnergy, basicEnergy, item, byName "Ethan's Adventure":

      attacker   3 / 2 / 1 / 1        supporter 2   trainerCard 3   LENGTH 7
      defender   4 / 3 / 2 / 0        supporter 1   trainerCard 3   LENGTH 8

    Every wrong answer is a different number from the right one on every attack: a
    seat inversion reads **4 / 0 / 2 / 1** where the print reads **3 / 1 / 3 / 2**;
    `anyEnergy` for `basicEnergy` reads 4 for 3; `supporter` for `byName` reads 2 for
    1; `trainerCard` for `item` reads 3 for 2; and the pile LENGTH reads 7 or 8. */
function canonical(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = bare(by);
  state = discardFromDeck(state, by, "fix-energy", 2);
  state = discardFromDeck(state, by, "fix-special", 1);
  state = discardFromDeck(state, by, "fix-ethansadv", 1);
  state = discardFromDeck(state, by, "fix-ethansadventure", 1);
  state = discardFromDeck(state, by, "fix-item", 1);
  state = discardFromDeck(state, by, "fix-titan", 1);
  state = discardFromDeck(state, foe, "fix-fire-energy", 2);
  state = discardFromDeck(state, foe, "fix-energy", 1);
  state = discardFromDeck(state, foe, "fix-special", 1);
  state = discardFromDeck(state, foe, "fix-item", 2);
  state = discardFromDeck(state, foe, "fix-ethansadventure", 1);
  return discardFromDeck(state, foe, "fix-titan", 1);
}

function swing(state: GameState, index: number, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}

function dealt(state: GameState, index: number, seat: Seat = "p1"): number | undefined {
  return find(swing(state, index, seat).events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, the population, and the fixture that carries it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the four printed sentences, their population, and the fixture", () => {
  it("the column prints the four on four records, 8 legal printings in all", () => {
    const rows = CLAIMED.map((text) => legalAttackCorpus().filter(([, s]) => s === text));
    expect(rows.map((r) => r.length)).toEqual([1, 1, 1, 1]);
    expect(rows.map((r) => r.reduce((sum, [n]) => sum + n, 0))).toEqual([2, 2, 2, 2]);
    expect(rows.flat().reduce((sum, [n]) => sum + n, 0)).toBe(8);
  });

  it("🛑 the WHOLE 'for each … discard pile' family, printed whole and classified", () => {
    // ⚠️ **THE ENUMERATION IS THE UNRELIABLE PART** (D424/D428), so this rung takes the
    // LOOSEST plausible shape — every corpus row containing BOTH "for each" and
    // "discard pile", which is deliberately looser than either anchor — and asserts the
    // WHOLE list rather than a count. It cannot be truncated on either axis, because a
    // missing row is a `toEqual` failure naming the row.
    //
    // ⚠️ AND IT IS THE RUNG THAT FOUND THE TWO ROWS A NARROWER PATTERN MISSES: the
    // United Wings row (its noun is split around the zone phrase) and the counter
    // PLACEMENT compound (not a damage fold at all). A survey shaped like the anchor
    // would have reported a six-row family and been wrong by two.
    const family = legalAttackCorpus()
      .filter(([, s]) => s.includes("for each") && s.includes("discard pile"))
      .map(([, s]) => s)
      .sort();
    expect(family).toEqual(
      [
        ENERGY_PILE,
        ETHAN_PILE,
        FOE_BASIC_PILE,
        FOE_ITEM_PILE,
        ANCIENT_PILE,
        TR_NAME_PILE,
        UNITED_WINGS_PILE,
        COUNTER_PLACEMENT_PILE,
      ].sort(),
    );
    expect(family).toHaveLength(8);
  });

  it("carries fix-discardpile's four printed attacks, `×` and `+` markers included", () => {
    // The whole list, so the fixture cannot be wrong by OMISSION (D156's failure mode).
    // ⚠️ THE TRAILING MARKERS ARE LOAD-BEARING: `×` tells attack.ts to DROP the printed
    // base and `+` tells it to keep it, and the two folds sit on the two SEATS here.
    expect(FIXTURE_POOL["fix-discardpile"]?.attacks?.map((a) => [a.damage, a.effect])).toEqual([
      ["20+", ENERGY_PILE],
      ["60+", ETHAN_PILE],
      ["30×", FOE_BASIC_PILE],
      ["30×", FOE_ITEM_PILE],
    ]);
    // 🛑 THE NAMED SUPPORTER IS THE `byName` DATUM AND ITS NEIGHBOUR IS THE CONTROL.
    // `trainerCard` names every Trainer in this pool by its ID, so D337's fixture is
    // called "fix-ethansadventure" and cannot satisfy the printed noun; the D440
    // fixture overrides `name` and does. Both sit in the attacker's pile.
    expect(FIXTURE_POOL["fix-ethansadv"]?.name).toBe("Ethan's Adventure");
    expect(FIXTURE_POOL["fix-ethansadventure"]?.name).toBe("fix-ethansadventure");
    expect(FIXTURE_POOL["fix-ethansadv"]?.trainerType).toBe("Supporter");
    expect(FIXTURE_POOL["fix-ethansadventure"]?.trainerType).toBe("Supporter");
  });

  it("AUTHORS nothing — every printing is read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the claim
    // that says the text path is the one being driven below.
    expect(programFor("fix-discardpile")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the two anchors, the vocabulary, and the seat/fold confound.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the two anchors, the vocabulary, and the seat/fold confound", () => {
  it("reads each printed noun as the `CardFilter` member that already spelled it", () => {
    expect(deriveAttackDamageBonus(ENERGY_PILE)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: ANY_ENERGY },
    });
    expect(deriveAttackDamageBonus(ETHAN_PILE)).toEqual({
      per: 60,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: ETHAN_BY_NAME },
    });
    expect(deriveAttackDamageMultiplier(FOE_BASIC_PILE)).toEqual({
      per: 30,
      count: { kind: "cardsInDiscardPile", seat: "opponent", filter: BASIC_ENERGY },
    });
    expect(deriveAttackDamageMultiplier(FOE_ITEM_PILE)).toEqual({
      per: 30,
      count: { kind: "cardsInDiscardPile", seat: "opponent", filter: ITEM },
    });
  });

  it("🛑 `basicEnergy` is UNTYPED here, which the printed noun decides", () => {
    // D376's sibling prints "Basic {R} Energy card" and its filter carries an
    // `energyType`; this one prints "Basic Energy card" and must not. A build that
    // copied the sibling's shape would count Fire-only and miss every other Basic.
    const bonus = deriveAttackDamageMultiplier(FOE_BASIC_PILE);
    expect(bonus?.count).toEqual({
      kind: "cardsInDiscardPile",
      seat: "opponent",
      filter: { kind: "basicEnergy" },
    });
    expect((bonus?.count as { filter: { energyType?: string } }).filter.energyType).toBeUndefined();
  });

  it("🛑 THE SEAT/FOLD CONFOUND, MEASURED — and then broken on CONSTRUCTED text", () => {
    // ⚠️ **THE CONFOUND IS REAL AND THIS RUNG STATES IT AS A FACT ABOUT THE POOL**
    // rather than describing it in a comment: over the whole corpus, every sentence
    // this slice CLAIMS with a "more" reads YOUR pile and every one it claims without
    // reads your OPPONENT's. So no printed row can tell a seat-from-fold build from
    // the real one, and a suite built only on printed text would pass on both.
    const claimed = legalAttackCorpus().filter(([, s]) => (CLAIMED as readonly string[]).includes(s));
    expect(claimed).toHaveLength(4);
    for (const [, s] of claimed) {
      const bonus = deriveAttackDamageBonus(s);
      const multiply = deriveAttackDamageMultiplier(s);
      const read = bonus ?? multiply;
      expect(read).not.toBeNull();
      const seat = (read?.count as { seat: string }).seat;
      expect(bonus === null ? "opponent" : "you", `${s} breaks the confound`).toBe(seat);
    }

    // …and HERE is the break. Both sentences below are CONSTRUCTED — neither is in
    // `legalAttackCorpus()` — and each fills one empty cell of the 2×2. A build that
    // hard-coded `seat: "you"` in the additive arm and `seat: "opponent"` in the
    // multiply arm passes every rung above and fails both of these.
    expect(legalAttackCorpus().some(([, s]) => s === CONSTRUCTED_SCALE_FOES)).toBe(false);
    expect(legalAttackCorpus().some(([, s]) => s === CONSTRUCTED_MULTIPLY_YOURS)).toBe(false);
    expect(deriveAttackDamageBonus(CONSTRUCTED_SCALE_FOES)).toEqual({
      per: 40,
      count: { kind: "cardsInDiscardPile", seat: "opponent", filter: ITEM },
    });
    expect(deriveAttackDamageMultiplier(CONSTRUCTED_MULTIPLY_YOURS)).toEqual({
      per: 40,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: ANY_ENERGY },
    });
  });

  it("🛑 the two vocabulary refusals are refused, and for two DIFFERENT reasons", () => {
    // Both reach an anchor — the regex matches, the `per` is fine — and both leave the
    // vocabulary as null, which is what keeps them on the loud ATTACK_EFFECT_SKIPPED
    // path. They are asserted together here and pinned apart, on the POPULATION, in §6.
    for (const text of [ANCIENT_PILE, TR_NAME_PILE]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
    // …and the ADMITTED twin on the same axis, so the refusals are not passing because
    // the reader refuses everything (D424: every "X is refused" owes a "Y is admitted").
    // One character apart from `ANCIENT_PILE` in the fold, one noun apart in the map.
    expect(
      deriveAttackDamageBonus("This attack does 10 more damage for each Item card in your discard pile."),
    ).toEqual({
      per: 10,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: ITEM },
    });
  });

  it("🛑 the United Wings row reaches NEITHER anchor, which is a STRUCTURAL refusal", () => {
    // Not a vocabulary miss: the sentence does not END at "discard pile.", because its
    // noun is split around the zone phrase. An `^…$` anchor cannot see it however wide
    // the map grows, so it is a different refusal from the two above and is stated as
    // one. 🆕🆕 **D446 — IT IS BLOCKED ONCE NOW, WHERE THIS COMMENT SAID TWICE.**
    // The second block was *"its filter would also need a `CardFilter` member reading
    // `attacksOf` — D439's refused widening one zone over"*; D446 built that member
    // (`attackNamePokemon`, for the IN-PLAY twin of this very noun), so the FILTER is
    // spellable and only the ANCHOR still refuses. Corrected in place rather than left
    // to rot, because a reader acting on the old sentence would price this row at two
    // mechanisms when it costs one. ⚠️ **AND THE RUNG IS UNCHANGED AND STILL THE RIGHT
    // ONE** — its subject was always the structural refusal, so it keeps its
    // discrimination and needed no re-pointing (D418: ask what the old claim caught).
    expect(UNITED_WINGS_PILE.endsWith("discard pile.")).toBe(false);
    expect(deriveAttackDamageBonus(UNITED_WINGS_PILE)).toBeNull();
    expect(deriveAttackDamageMultiplier(UNITED_WINGS_PILE)).toBeNull();
  });

  it("the whole-sentence anchor holds at both ends, on the capital, and on the zero", () => {
    // The family's standing near-miss set, one axis at a time (D427: a near-miss that
    // differs on more than one axis tests nothing about either).
    const NEAR = [
      // a lowercased "this"
      "this attack does 20 more damage for each Energy card in your discard pile.",
      // a missing trailing period
      "This attack does 20 more damage for each Energy card in your discard pile",
      // leading text
      "Flip a coin. This attack does 20 more damage for each Energy card in your discard pile.",
      // a printed 0 — the guard every arm in both families carries
      "This attack does 0 more damage for each Energy card in your discard pile.",
      "This attack does 0 damage for each Item card in your opponent's discard pile.",
      // the DECK, not the pile — one noun phrase over, and printed nowhere in this shape
      "This attack does 20 more damage for each Energy card in your deck.",
      // a THIRD seat phrasing the anchor does not spell
      "This attack does 20 more damage for each Energy card in each discard pile.",
      // 🛑 A TRAILING CLAUSE — the compound the `$` refuses, and the ONLY near-miss
      // that can see the terminator. A `\.` without `$` would claim the PREFIX of
      // each of these and simulate a sentence whose printed tail it never read, which
      // is the defect D207 paid for three times.
      "This attack does 20 more damage for each Energy card in your discard pile. Then, shuffle your deck.",
      "This attack does 30 damage for each Item card in your opponent's discard pile. Discard the top card of your deck.",
    ];
    for (const text of NEAR) {
      expect(deriveAttackDamageBonus(text), text).toBeNull();
      expect(deriveAttackDamageMultiplier(text), text).toBeNull();
    }
  });

  it("🛑 the U+2019 spelling resolves IDENTICALLY, and the KEY is why that is a rung", () => {
    // ⚠️ `DISCARD_PILE_NOUNS` has an apostrophe in a KEY ("Ethan's Adventure card"), so
    // a bare `Map.get` would return undefined under a punctuation-normalising re-ingest
    // and the sentence would fall silently off the built set. The lookup goes through
    // `literalClauseRow` (D137) for exactly that reason. The anchors' `['’]` class
    // covers the SEAT token; the noun capture is a character class and covers itself.
    const curly = (s: string) => s.replaceAll("'", "’");
    for (const text of CLAIMED) {
      expect(deriveAttackDamageBonus(curly(text))).toEqual(deriveAttackDamageBonus(text));
      expect(deriveAttackDamageMultiplier(curly(text))).toEqual(deriveAttackDamageMultiplier(text));
    }
    // …and at least one of them still says something, so the equality is not four nulls
    // agreeing with four nulls.
    expect(deriveAttackDamageBonus(curly(ETHAN_PILE))?.count).toEqual({
      kind: "cardsInDiscardPile",
      seat: "you",
      filter: ETHAN_BY_NAME,
    });
    expect(deriveAttackDamageMultiplier(curly(FOE_ITEM_PILE))?.per).toBe(30);
  });

  it("🛑 the sentences are claimed by EXACTLY the two readers named, and refused by the rest", () => {
    // ⚠️ **A NAMED CLAIM PLUS ELEVEN KEPT REFUSALS, AND NOT `resolvedByAnyReader === true`**
    // (D438, and the shape that produced D436's GAP): a bare `=== true` is a claim about
    // NO reader and stays green under any mistaken widening. This asserts WHICH reader
    // owns each sentence AND that every other reader still says no.
    for (const text of [ENERGY_PILE, ETHAN_PILE]) {
      expect(deriveAttackDamageBonus(text)).not.toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    for (const text of [FOE_BASIC_PILE, FOE_ITEM_PILE]) {
      expect(deriveAttackDamageMultiplier(text)).not.toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(true);
    }
    // …and the four the family leaves behind are refused by EVERY reader, which is the
    // thirteen-way negative KEPT rather than replaced.
    for (const text of [ANCIENT_PILE, TR_NAME_PILE, UNITED_WINGS_PILE, COUNTER_PLACEMENT_PILE]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      for (const reader of OTHERS) expect(reader(text)).toBeNull();
      expect(resolvedByAnyReader(text)).toBe(false);
    }
  });

  it("🛑 no splitter composes on any of the eight, before OR after this slice", () => {
    // D426's mechanism, driven rather than asserted: none of these sentences carries a
    // `. ` joiner an anchor could hide behind, so no composition path can claim a head
    // this slice made readable — and the counter-placement compound, which DOES carry
    // one, is refused by every splitter too. Measured on all four splitters (D425: the
    // requirement and cancel splitters serve zero additional sentences, so the honest
    // subtraction is gate + trailing, and this rung checks all four anyway).
    for (const text of [
      ENERGY_PILE,
      ETHAN_PILE,
      FOE_BASIC_PILE,
      FOE_ITEM_PILE,
      ANCIENT_PILE,
      TR_NAME_PILE,
      UNITED_WINGS_PILE,
      COUNTER_PLACEMENT_PILE,
    ]) {
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
      expect(splitAttackRequirementClause(text), text).toBeNull();
      expect(splitAttackCancelClause(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on a real pile: the zone, the seat and the filter.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — `countCardsInDiscardPile`: the pile, seat-relative, filtered", () => {
  it("🛑 the canonical piles answer 3 / 2 / 1 / 1 and 4 / 3 / 2 / 0", () => {
    const state = canonical();
    expect(NOUNS.map((f) => countCardsInDiscardPile(state, "p1", f))).toEqual([3, 2, 1, 1]);
    expect(NOUNS.map((f) => countCardsInDiscardPile(state, "p2", f))).toEqual([4, 3, 2, 0]);
  });

  it("🛑 every NEIGHBOURING filter answers a different number on the same piles", () => {
    // ⑷ driven rather than argued: the four printed members against the three nearest
    // members nobody printed here, plus the pile LENGTH, which is what a build that
    // skipped the noun phrase entirely would read.
    const state = canonical();
    expect(countCardsInDiscardPile(state, "p1", { kind: "supporter" })).toBe(2);
    expect(countCardsInDiscardPile(state, "p2", { kind: "supporter" })).toBe(1);
    expect(countCardsInDiscardPile(state, "p1", { kind: "trainerCard" })).toBe(3);
    expect(countCardsInDiscardPile(state, "p2", { kind: "trainerCard" })).toBe(3);
    expect(countCardsInDiscardPile(state, "p1", { kind: "specialEnergy" })).toBe(1);
    expect(state.players.p1.discard).toHaveLength(7);
    expect(state.players.p2.discard).toHaveLength(8);
    // …so `byName` and `supporter` differ on the attacker's pile, `item` and
    // `trainerCard` differ on the defender's, and `anyEnergy` and `basicEnergy` differ
    // on BOTH. No two of the four printed nouns share a value on the same pile except
    // `item` and `byName` on the attacker's, which the OTHER pile separates at 2 and 0.
  });

  it("🛑 THE PRINT, NEVER THE PROVISION — §6.5 on the one card that shows it", () => {
    // `fix-special` is an Energy CARD (`anyEnergy` admits it) that is not a Basic one
    // (`basicEnergy` refuses it), which is the printed word "Basic" made observable on
    // a single pile. And `providesEnergy` — the filter a provision reading would
    // reach for — is FALSE for every card in a pile by `matchesFilter`'s own arm, with
    // the pile argument written into that arm.
    const state = canonical();
    expect(countCardsInDiscardPile(state, "p1", ANY_ENERGY)).toBe(3);
    expect(countCardsInDiscardPile(state, "p1", BASIC_ENERGY)).toBe(2);
    // ⚠️ TWO TYPES, and the second is the sharp one: the defender's pile holds TWO
    // Basic {R} Energy, which a provision reading over an ATTACHED card would count
    // as Fire — here it is 0, because a card in a pile provides nothing at all.
    expect(countCardsInDiscardPile(state, "p1", { kind: "providesEnergy", energyType: "Water" })).toBe(0);
    expect(countCardsInDiscardPile(state, "p2", { kind: "providesEnergy", energyType: "Fire" })).toBe(0);
  });

  it("🛑 an EMPTY pile is 0 and an UNRESOLVABLE uid contributes 0, on every filter", () => {
    // Both are properties of the walk rather than of any board a game can reach, so
    // they are driven on the function. `cardOfUid` returns undefined for a uid the
    // catalog cannot resolve and `matchesFilter`'s first line answers false for it.
    const empty = bare();
    expect(NOUNS.map((f) => countCardsInDiscardPile(empty, "p1", f))).toEqual([0, 0, 0, 0]);
    const state = canonical();
    const haunted: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, discard: [...state.players.p1.discard, "p1#ghost"] },
      },
    };
    expect(haunted.players.p1.discard).toHaveLength(8);
    expect(NOUNS.map((f) => countCardsInDiscardPile(haunted, "p1", f))).toEqual([3, 2, 1, 1]);
  });

  it("🛑 the GENERALISED walk and D376's threshold cannot disagree", () => {
    // The two vocabularies, one walk. This is what a second copy of the loop would have
    // broken, and it goes red the day somebody re-inlines one of them. D376's arm asks a
    // THRESHOLD over `{ kind: "basicEnergy", energyType }`; the walk answers the COUNT.
    const state = canonical();
    // The defender's pile holds two Basic {R} and one Basic {C}, so the typed reading is
    // 2 and the untyped one is 3 — which is also the `energyType` rung ⑷ in miniature.
    const typed: CardFilter = { kind: "basicEnergy", energyType: "Fire" };
    expect(countCardsInDiscardPile(state, "p2", typed)).toBe(2);
    expect(countCardsInDiscardPile(state, "p2", BASIC_ENERGY)).toBe(3);
    for (const count of [0, 1, 2, 3]) {
      expect(
        conditionHolds(state, "p2", {
          kind: "yourBasicEnergyInDiscardAtLeast",
          energy: "Fire",
          count,
        }),
        `threshold ${count}`,
      ).toBe(countCardsInDiscardPile(state, "p2", typed) >= count);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the count actually scaling damage.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the fold: four attacks, four numbers, one board", () => {
  it("🛑 the canonical board deals 80 / 120 / 90 / 60", () => {
    const state = canonical();
    expect([0, 1, 2, 3].map((i) => dealt(state, i))).toEqual([80, 120, 90, 60]);
  });

  it("🛑 the MULTIPLY fold DROPS the printed base and the ADDITIVE one KEEPS it", () => {
    // The two `+` sentences carry their printed 20 and 60; the two `×` ones have
    // `base: 0` even though the card prints `30×`. A build that got the fold wrong
    // would be off by the base on every board above — but only this rung says WHICH
    // half of the number is which.
    const state = canonical();
    const rows = [0, 1, 2, 3].map((i) => find(swing(state, i).events, "DAMAGE_DEALT"));
    expect(rows.map((r) => r?.base)).toEqual([20, 60, 0, 0]);
    expect(rows.map((r) => r?.scaled)).toEqual([60, 60, 90, 60]);
  });

  it("🛑 the EMPTY-pile board: the `+` fold pays its base, the `×` fold deals nothing", () => {
    // Both piles empty. On the additive fold a 0 count leaves the printed base — the
    // card still hits for 20 and 60 — and on the multiply fold a 0 count means no
    // `DAMAGE_DEALT` row at all, which is rules-correct and is the printed floor.
    const state = bare();
    expect(state.players.p1.discard).toHaveLength(0);
    expect(state.players.p2.discard).toHaveLength(0);
    expect([0, 1].map((i) => dealt(state, i))).toEqual([20, 60]);
    expect(find(swing(state, 2).events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(swing(state, 3).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("🛑 THE ZONE: the attached Energy is NOT the pile, and the wrong walk is non-zero", () => {
    // ⑶ made observable. The attacker has exactly ONE Energy attached (the printed cost)
    // and THREE Energy cards in its pile, so a build that delegated the "Energy card"
    // noun to `countEnergyInPlay` — the walk every OTHER Energy-counting member of this
    // union uses — deals 40 where the print says 80. A board with an empty attachment
    // would have made that mistake look like a zero and hidden it.
    const state = canonical();
    expect(activeOf(state, "p1").energy).toHaveLength(1);
    expect(countCardsInDiscardPile(state, "p1", ANY_ENERGY)).toBe(3);
    expect(dealt(state, 0)).toBe(80);
  });

  it("🛑 THE SEAT, driven through `attack()`: all four numbers move under an inversion", () => {
    // ⑴ as arithmetic rather than as an argument. The inverted reading of each attack is
    // computed from the OTHER pile with the SAME filter, and no attack lands on its own
    // number: 80→100, 120→60, 90→60, 60→30.
    const state = canonical();
    const perAttack = [20, 60, 30, 30];
    const base = [20, 60, 0, 0];
    const wrongSeat: Seat[] = ["p2", "p2", "p1", "p1"];
    const inverted = FILTERS.map(
      (f, i) =>
        (base[i] ?? 0) +
        countCardsInDiscardPile(state, wrongSeat[i] ?? "p1", f) * (perAttack[i] ?? 0),
    );
    expect(inverted).toEqual([100, 60, 60, 30]);
    expect([0, 1, 2, 3].map((i) => dealt(state, i))).toEqual([80, 120, 90, 60]);
    for (const [i, value] of inverted.entries()) expect(dealt(state, i)).not.toBe(value);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the same four numbers from the other chair.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the same four numbers from the other chair", () => {
  it("🛑 p2 attacking reads p2's pile for 'your' and p1's for 'your opponent's'", () => {
    // The seat rung driven through `attack()` from the other end: the piles are built
    // the same way around the attacker, so the four numbers are identical while the
    // physical seats are swapped — which is what "controller-relative" means.
    const state = canonical("p2");
    expect(NOUNS.map((f) => countCardsInDiscardPile(state, "p2", f))).toEqual([3, 2, 1, 1]);
    expect(NOUNS.map((f) => countCardsInDiscardPile(state, "p1", f))).toEqual([4, 3, 2, 0]);
    expect([0, 1, 2, 3].map((i) => dealt(state, i, "p2"))).toEqual([80, 120, 90, 60]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — persistence, redaction, the pinned absences, and the version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — `MATCH_RECORD_VERSION` STAYS 29, driven in both directions", () => {
  // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and is not exported from this
  // package; what is driven HERE is the engine-side fact it is about — whether anything
  // this slice produces reaches a persisted board. The rule at that constant is *does
  // the old byte string still mean what it meant*: a WIDENING is free, a RENAME or a new
  // REQUIRED key on a persisted structure is not. This slice adds a `DamageCountSource`
  // member and renames nothing.

  it("🛑 DIRECTION 1 — a v29 record round-trips and STILL scores all four counts", () => {
    const record = JSON.parse(JSON.stringify(canonical())) as GameState;
    expect([0, 1, 2, 3].map((i) => dealt(record, i))).toEqual([80, 120, 90, 60]);
  });

  it("🛑 DIRECTION 2 — nothing this slice produces is on the board at all", () => {
    // `DamageCountSource` is a PARSE-TIME type: derived from card text and consumed in
    // the same tick by `scaledAttackDamage`. No op carries one, no field stores one, no
    // event names one. Driven as a property of the SERIALIZED bytes rather than reasoned
    // from the type's name (D427: choosing a carrier does not duck persistence).
    const before = canonical();
    const after = swing(before, 0).state;
    const wire = JSON.stringify(after);
    expect(wire).not.toContain("cardsInDiscardPile");
    expect(wire).not.toContain("anyEnergy");
    expect(wire).not.toContain("byName");
    // …and no body gained a key: the attacker's key set equals the untouched defender's
    // and equals its own from before the swing, which is the shape a new
    // `InPlayPokemon` field would break.
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(after, "p2")).sort(),
    );
    expect(Object.keys(activeOf(after, "p1")).sort()).toEqual(
      Object.keys(activeOf(before, "p1")).sort(),
    );
  });

  it("🛑 the OPPONENT-side read is ONLINE-EVALUABLE — the pile ships face up to BOTH seats", () => {
    // ⚠️ **D376's MEMBER ONLY EVER COUNTED THE ACTOR'S OWN PILE, so this is checked here
    // rather than inherited from it.** §2 makes a discard pile ordered and PUBLIC, and
    // `redact.ts` agrees at the code rather than in prose: `redactedSideOf` maps
    // `side.discard` through `redactedCardOf` unconditionally, with no `SideVisibility`
    // gate, for the viewer's side AND the opponent's. So an attacker counting the
    // defender's pile is reading something the client already renders, and this union's
    // public-state invariant holds on both values of `seat`.
    const state = canonical();
    const view = redactGame(state, "p1").board;
    expect(view.opponent.discard).toHaveLength(8);
    expect(view.you.discard).toHaveLength(7);
    // Names, not counts — the projection carries full identity, which is what makes the
    // count answerable client-side.
    expect(view.opponent.discard.filter((c) => c.trainerType === "Item")).toHaveLength(2);
    expect(view.opponent.discard.filter((c) => c.category === "Energy")).toHaveLength(4);
    expect(view.you.discard.filter((c) => c.name === "Ethan's Adventure")).toHaveLength(1);
    // …and the opponent's HAND is still shut, which is the attribution control: the
    // claim is about the PILE and not about a projection that shows everything.
    expect(view.opponent.hand.map((c) => c.cardId)).toEqual(
      Array.from(view.opponent.hand, () => HIDDEN_CARD_ID),
    );
    expect(view.opponent.hand.length).toBeGreaterThan(0);
  });

  it("🛑 the TWO REFUSALS ARE PINNED ON THE POPULATION, and they are TWO claims", () => {
    // D423: pin an absence on the population, never on a specimen. Each row is located
    // in the corpus by its own predicate and asserted unresolved — so the rung reddens
    // the day either becomes buildable, and it names WHICH one.
    //
    // ⑴ **Ancient — DATA-BLOCKED, PERMANENTLY.** The banner is in no catalog column and
    //    no tcgdex field, so no `CardFilter` at any width can express it and the fix is
    //    an INGEST change. This rung is NOT a falsifier: it is a standing statement that
    //    the row is still printed and still unclaimed.
    const ancient = legalAttackCorpus().filter(
      ([, s]) => s.includes("Ancient card") && s.includes("discard pile"),
    );
    expect(ancient.map(([, s]) => s)).toEqual([ANCIENT_PILE]);
    expect(ancient.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    expect(resolvedByAnyReader(ANCIENT_PILE)).toBe(false);

    // ⑵ **The name SUBSTRING — UNBUILT, WITH AN EXECUTABLE FALSIFIER** (D428/D422).
    //    `byName` is exact equality and no `CardFilter` member matches a substring; the
    //    day one does and `DISCARD_PILE_NOUNS` gains the row, THIS RUNG GOES RED and the
    //    refusal stops being true loudly. That is the condition, stated as a test rather
    //    than as prose.
    const substring = legalAttackCorpus().filter(
      ([, s]) => s.includes('has "Team Rocket" in its name') && s.includes("discard pile"),
    );
    expect(substring.map(([, s]) => s)).toEqual([TR_NAME_PILE]);
    expect(substring.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    expect(resolvedByAnyReader(TR_NAME_PILE)).toBe(false);
    // The predicate that would have to change, asserted at the value rather than in a
    // comment: an exact-equality filter says NO to a name that CONTAINS the fragment.
    expect(
      countCardsInDiscardPile(canonical(), "p1", { kind: "byName", name: "Ethan's" }),
    ).toBe(0);
    expect(countCardsInDiscardPile(canonical(), "p1", ETHAN_BY_NAME)).toBe(1);
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(canonical());
    const pileBefore = frozen.players.p1.discard.length;
    const after = swing(frozen, 0);
    // The count is a READ: every card it walked is still in the pile afterwards, on the
    // new board as well as on the frozen one, and only the defender moved.
    expect(frozen.players.p1.discard).toHaveLength(pileBefore);
    expect(after.state.players.p1.discard).toHaveLength(pileBefore);
    expect(after.state.players.p2.discard).toHaveLength(8);
    expect(activeOf(frozen, "p1").energy).toHaveLength(1);
    expect(activeOf(after.state, "p1").energy).toHaveLength(1);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(80);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});
