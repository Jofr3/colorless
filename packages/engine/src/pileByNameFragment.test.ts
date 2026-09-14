import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
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
import type { CardFilter, CountSeat } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { countCardsInDiscardPile, countPokemonInPlay } from "./interpreter";
import {
  FIXTURE_POOL,
  PILE_NAME_FRAGMENT_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.397.0 → 0.398.0 — 🆕🆕🆕 D510: DAMAGE SCALED BY A COUNT OF SUPPORTERS IN YOUR
// DISCARD PILE WHOSE PRINTED NAME CONTAINS A QUOTED FRAGMENT.
//
//   "This attack does 20 damage for each Supporter card that has "Team Rocket" in
//    its name in your discard pile."      — 1 sentence / 2 LEGAL printings
//                                           (`censusAttackCorpus.ts` FILE LINE 543)
//
// 🛑 THE ANCHOR WAS NEVER THE BLOCKER, AND THAT IS A MEASUREMENT. D440's shipped
// `DISCARD_PILE_COUNT_MULTIPLY` has matched this row since the day it was written —
// its `([^.]+)` noun group swallows the whole narrowed phrase and its seat group
// captures `your` — so the sentence REACHED the reader and was refused one step
// later, by `discardPileFilter` having no way to spell the noun. That function's own
// doc block said so in as many words (*"…or `null` when this file has no way to spell
// it (Ancient, the Team Rocket name substring)"*). **So this slice adds ZERO anchors**
// and pays instead for one PARAMETERISED noun and one `CardFilter` member.
//
// 🛑 AND IT OVERTURNS A REFUSAL WHOSE FALSIFIER WAS PINNED ON THE POPULATION AND
// FIRED. `discardPileScaling.test.ts` §6 asserted *"the day a `CardFilter` member
// reads a name SUBSTRING … THIS RUNG GOES RED"*. It did, and it was re-pointed rather
// than narrowed.
//
// 🛑 THE ONE DOCTRINE THIS SLICE HAD TO CORRECT RATHER THAN INHERIT. Two shipped doc
// blocks — `CardFilter.attackNamePokemon` and `matchesFilter`'s arm for it — both
// rested on *"no `CardFilter` member does substring matching at any width"*.
// `ownerPokemon` has matched a proper PREFIX of `Card.name` since D200, and
// `scripts/opaque-anatomy.ts`'s `CARD-NAME-COUNT` marker has recorded exactly that
// since D471. The new thing here is the ANCHORING (`includes`, not `startsWith` and
// not `===`), not the column.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
//   ⑴ THE HEAD NOUN. The printed phrase is *"Supporter card that has …"*, so the
//      filter is a CONJUNCTION baked into one member. The attacker's pile holds TWO
//      `fix-trtransceiver` — an ITEM whose name carries the fragment — so a build
//      that kept only the fragment reads 5 (100) where the print reads 3 (60).
//   ⑵ THE FRAGMENT. The mirror control: ONE `fix-ethansadventure`, a Supporter whose
//      name carries nothing, so a build that kept only the noun reads 4 (80).
//   ⑶ THE ANCHORING. `.includes` and NOT `.startsWith` — the read `ownerPokemon`
//      five `case`s away really does perform. ONE `fix-trgrunt` carries the fragment
//      at a NON-ZERO offset, so a prefix build reads 2 (40).
//   ⑷ THE OPERATOR'S OTHER END. `byName`'s exact `===` on the fragment reads 0 —
//      no `DAMAGE_DEALT` row at all on the `×` fold.
//   ⑸ THE SEAT. `DiscardPileSeat` is CONTROLLER-RELATIVE and the print says *"your
//      discard pile"*. The defender's pile holds SIX of the positive: 6 (120).
//   ⑹ THE ZONE. The count walks the PILE. A Supporter is never in play, so the
//      in-play walk one `DamageCountSource` member over reads a LOUD 0 — which is
//      the opposite of D508's zone control and is stated rather than discovered.
//   ⑺ THE ANCHOR'S LITERALS, and the flip table says how many there are: on this
//      row's 2⁵ lattice, THREE axes flip and TWO are free, so the three are driven
//      as one-axis near-misses (D427) together with the measurement that says the
//      column prints each refused spelling ZERO times.

/** The one printed sentence, transcribed byte for byte from
    `censusAttackCorpus.ts` FILE LINE 543. */
const PRINTED =
  'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.';

/** The printed fragment, and the ONE string this suite's every number turns on. */
const FRAGMENT = "Team Rocket";

/** D508's row, shipped one slice ago, and the nearest BUILT point of this sentence's
    lattice — the single one that built before this slice. It differs from `PRINTED`
    on THREE axes at once (head noun, predicate, word order), which is why it is the
    lattice's warrant and not a near-miss (D427). */
const PILE_ATTACK_NAME_TWIN =
  "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.";

/** The twelve readers this sentence must NOT reach, so §2 can assert a NAMED owner
    plus eleven kept refusals rather than a bare `resolvedByAnyReader` (D438: a
    negative over a disjunction is a claim about every disjunct; its positive
    replacement is a claim about none of them). */
const OTHERS = [
  deriveAttackEffect,
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

const TR_SUPPORTER: CardFilter = { kind: "supporterNameContaining", fragment: FRAGMENT };
const SUPPORTER: CardFilter = { kind: "supporter" };
const TR_BY_NAME: CardFilter = { kind: "byName", name: FRAGMENT };
const ANY_CARD: CardFilter = { kind: "anyCard" };

/** One seed for the whole suite. Nothing here flips a coin and every card in either
    pile and on either board is placed by surgery, so a seed table would describe a
    shuffle rather than a rule. */
const SEED = 1;

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

/** The NAME reads this suite drives that `CardFilter` cannot spell — a prefix read and
    an unanchored read with no head noun. Written over the pile's own uids so they are
    the SAME walk the arm performs, one predicate apart (D508's `attacksOf().length > 0`
    control, at this member's address). */
function pileCards(state: GameState, seat: Seat) {
  return state.players[seat].discard.map((uid) => FIXTURE_POOL[state.cardIdByUid[uid] ?? ""]);
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both Actives are placed by surgery and BOTH Benches are cleared, so
    every number this suite reads is a POPULATION the test put there. One {C} is
    attached to pay the one printed cost. **BOTH PILES ARE EMPTY HERE**, which is the
    board §3 drives for the printed zero. */
function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: PILE_NAME_FRAGMENT_DECK, p2: PILE_NAME_FRAGMENT_DECK }, { first: foe }),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-pilerocket");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

/** 🛑 **THE CANONICAL BOARD — SEVEN WRONG BUILDS, SEVEN DIFFERENT NUMBERS.**

      attacker's pile (8 cards)          attacker IN PLAY        defender's pile (6)
        fix-trsupporter    ×2              Active fix-pilerocket   fix-trsupporter ×6
        fix-trgrunt        ×1              Bench EMPTY
        fix-trtransceiver  ×2
        fix-ethansadventure ×1
        fix-titan          ×2

    At the printed 20 per card: the print **60**; `startsWith` 40; the noun dropped
    100; the fragment dropped 80; the seat wrong 120; the pile LENGTH 160; the exact
    `byName` 0. The attacker's BENCH is deliberately left EMPTY — a Supporter can
    never be in play, so the zone axis is a LOUD zero and needs no body to make it
    one. */
function canonical(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = bare(by);
  state = discardFromDeck(state, by, "fix-trsupporter", 2);
  state = discardFromDeck(state, by, "fix-trgrunt", 1);
  state = discardFromDeck(state, by, "fix-trtransceiver", 2);
  state = discardFromDeck(state, by, "fix-ethansadventure", 1);
  state = discardFromDeck(state, by, "fix-titan", 2);
  return discardFromDeck(state, foe, "fix-trsupporter", 6);
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

function dealt(state: GameState, seat: Seat = "p1"): number | undefined {
  return find(swing(state, seat).events, "DAMAGE_DEALT")?.dealt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed sentence, its population, and the fixtures.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the population, and the fixtures", () => {
  it("the column prints it on exactly ONE record, for exactly TWO legal printings", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows.map(([, s]) => s)).toEqual([PRINTED]);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(2);
  });

  it('🛑 the printed delimiters are ASCII U+0022, on ALL THREE rows that print "… in its name"', () => {
    // D421's byte / D440's habit: the capture's delimiter is a printed character, so
    // it is measured with `codePointAt` over the committed corpus rather than read off
    // the page. ⚠️ **THE MEASUREMENT IS THE WHOLE FAMILY AND NOT THIS ROW**, because
    // the pattern is what a successor reuses: a curly-quote re-ingest would break the
    // capture on every one of them at once, and this rung names which three.
    const family = legalAttackCorpus().filter(([, s]) => s.includes("in its name"));
    expect(family.map(([, s]) => s).sort()).toEqual(
      [
        'If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.',
        PRINTED,
        'This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent\'s).',
      ].sort(),
    );
    expect(family).toHaveLength(3);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(5);
    for (const [, text] of family) {
      const quotes = [...text].map((c, i) => [i, c.codePointAt(0) ?? 0] as const).filter(
        ([, cp]) => cp === 0x22 || cp === 0x201c || cp === 0x201d,
      );
      // EVERY quote on the row, and EVERY one of them ASCII — not just the pair this
      // anchor reads. ⚠️ The Koffing/Weezing row carries FOUR (it quotes two fragments
      // joined by a printed "or"), so a rung that asserted a pair would have been a
      // claim about this row wearing the family's clothes.
      expect(quotes.length % 2).toBe(0);
      expect(quotes.length).toBeGreaterThanOrEqual(2);
      expect(new Set(quotes.map(([, cp]) => cp))).toEqual(new Set([0x22]));
    }
    // …and THIS row's own apostrophe question, because the anchor that reads it spells
    // a `['’]` class for the SEAT token and none for the noun: the sentence carries no
    // apostrophe at all, so nothing in the captured span depends on D137's insurance.
    expect(PRINTED.includes("'")).toBe(false);
    expect(PRINTED.includes("’")).toBe(false);
  });

  it("the holder carries the printed sentence verbatim, with the `×` marker", () => {
    // The whole attack list, so the fixture cannot be wrong by OMISSION (D156).
    // ⚠️ THE TRAILING `×` IS LOAD-BEARING: it tells attack.ts to DROP the printed base,
    // which is what makes the empty-pile board in §3 a missing row rather than a 20.
    expect(
      FIXTURE_POOL["fix-pilerocket"]?.attacks?.map((a) => [a.name, a.damage, a.effect]),
    ).toEqual([["Rocket Dossier", "20×", PRINTED]]);
    // 🛑 AND THE HOLDER IS A POKÉMON WHILE THE THING IT COUNTS IS A TRAINER, which is
    // what makes ⑹ a loud zero rather than a plausible smaller number.
    expect(FIXTURE_POOL["fix-pilerocket"]?.category).toBe("Pokemon");
  });

  it("🛑 the four pile fixtures answer FOUR DIFFERENT SUBSETS of the two conjuncts", () => {
    // The cast is the argument: each card is in the pool because it separates the
    // printed filter from ONE neighbouring build, and a card that separated nothing
    // would make a rung pass by coincidence (D424's anti-vacuity rule).
    //
    //   card                    Supporter?   name contains?   name STARTS with?
    //   fix-trsupporter             ✓              ✓                 ✓
    //   fix-trgrunt                 ✓              ✓                 ·
    //   fix-trtransceiver           ·              ✓                 ✓
    //   fix-ethansadventure         ✓              ·                 ·
    const table = [
      ["fix-trsupporter", true, true, true],
      ["fix-trgrunt", true, true, false],
      ["fix-trtransceiver", false, true, true],
      ["fix-ethansadventure", true, false, false],
    ] as const;
    for (const [id, isSupporter, contains, starts] of table) {
      const card = FIXTURE_POOL[id];
      expect([id, matchesFilter(card, SUPPORTER)]).toEqual([id, isSupporter]);
      expect([id, card?.name.includes(FRAGMENT) ?? false]).toEqual([id, contains]);
      expect([id, card?.name.startsWith(FRAGMENT) ?? false]).toEqual([id, starts]);
      // …and the member itself is exactly the CONJUNCTION of the first two columns.
      expect([id, matchesFilter(card, TR_SUPPORTER)]).toEqual([id, isSupporter && contains]);
    }
    // 🛑 THE ROW THAT MAKES `.includes` ≠ `.startsWith` A REAL DISTINCTION and not a
    // hypothetical: `fix-trgrunt` puts the fragment at a NON-ZERO offset, which is the
    // exact shape D392 found PRINTED one vocabulary over (an owner possessive in
    // front of the fragment). Constructed here, and labelled so at the fixture.
    expect(FIXTURE_POOL["fix-trgrunt"]?.name.indexOf(FRAGMENT)).toBeGreaterThan(0);
    expect(FIXTURE_POOL["fix-trsupporter"]?.name.indexOf(FRAGMENT)).toBe(0);
    // …and the printed fragment is a PROPER substring of both, never the whole name —
    // the reason `byName`'s exact read answers 0 on this pile.
    expect(FIXTURE_POOL["fix-trsupporter"]?.name).not.toBe(FRAGMENT);
    expect(matchesFilter(FIXTURE_POOL["fix-trsupporter"], TR_BY_NAME)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader: the named owner, the kept refusals, the resolver and the axes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the resolver, its owner, and the three live axes", () => {
  it("🛑 the sentence is claimed by EXACTLY `deriveAttackDamageMultiplier`, at the value", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: TR_SUPPORTER },
    });
    for (const reader of OTHERS) expect(reader(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("🛑 no splitter composes on it, before OR after this slice", () => {
    // D426's mechanism, driven rather than asserted. The sentence carries no `. `
    // joiner and no leading `If …,`, so there is no composition path any splitter
    // could have claimed a head through — which is also why the readers-only and
    // residue-predicate readings of this row's lattice are provably identical
    // (measured: 0 divergent points of 32, all four splitters null at 128/128).
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
  });

  it("🛑 the three LIVE axes are literals, and each near-miss differs on exactly ONE", () => {
    // D427: a near-miss that differs on more than one axis tests neither. ⚠️ **WHICH
    // axes are owed is read off the lattice's FLIP TABLE rather than off the sentence**
    // (D508): the SEAT and the FOLD flip 1/16 each — the anchor varies both on its own
    // and this slice spells neither — while the HEAD NOUN, the PREDICATE and the WORD
    // ORDER flip 5/16 each and are the literals `PILE_SUPPORTER_NAME_FRAGMENT` carries.
    const NEAR: readonly (readonly [string, string])[] = [
      [
        "the HEAD NOUN — an Item card, the neighbouring printed Trainer subtype",
        'This attack does 20 damage for each Item card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "the HEAD NOUN — the bare category",
        'This attack does 20 damage for each Trainer card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "the PREDICATE — a printed ATTACK name, D508's shipped narrowing",
        "This attack does 20 damage for each Supporter card that has the Round attack in your discard pile.",
      ],
      [
        "the WORD ORDER — the narrowing AFTER the zone, D508's shipped shape",
        'This attack does 20 damage for each Supporter card in your discard pile that has "Team Rocket" in its name.',
      ],
      [
        "🛑 LEADING TEXT INSIDE THE NOUN — the printed banner adjective, which the column DOES spell elsewhere",
        'This attack does 20 damage for each Ancient Supporter card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "the QUOTES — the fragment unquoted",
        "This attack does 20 damage for each Supporter card that has Team Rocket in its name in your discard pile.",
      ],
      [
        "the EMPTY fragment — the one value that would match every Supporter",
        'This attack does 20 damage for each Supporter card that has "" in its name in your discard pile.',
      ],
      [
        "the printed ZERO — the guard every arm in both families carries",
        'This attack does 0 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "a lowercased `this`",
        'this attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "a missing trailing period",
        'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile',
      ],
      [
        "leading text",
        'Flip a coin. This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
      ],
      [
        "🛑 a TRAILING CLAUSE — the compound the `$` refuses",
        'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile. Then, shuffle your deck.',
      ],
    ];
    for (const [label, text] of NEAR) {
      expect(deriveAttackDamageMultiplier(text), label).toBeNull();
      expect(deriveAttackDamageBonus(text), label).toBeNull();
      expect(resolvedByAnyReader(text), label).toBe(false);
    }
  });

  it("🛑 each refused spelling is printed ZERO times — the arms are not merely unwritten", () => {
    // `IN_PLAY_BODY_NOUNS`' rule: an arm no sentence drives is not written. The three
    // literals above are literals BECAUSE the column prints nothing else, and that is a
    // measurement over all 640 rows rather than a habit. ⚠️ This rung is also the
    // falsifier: the day the column prints one of these, it goes RED and the noun's
    // narrowness stops being true loudly (D422/D428).
    const corpus = legalAttackCorpus();
    expect(corpus).toHaveLength(640);
    const count = (re: RegExp) => corpus.filter(([, s]) => re.test(s)).length;
    // ⑴ the HEAD NOUN: no OTHER noun is printed in front of a quoted-fragment narrowing
    //    inside a discard-pile fold…
    expect(count(/for each (?!Supporter card that has ")[^.]* that has "[^"]+" in its name in your/)).toBe(0);
    // ⑵ the PREDICATE: `Supporter card` is printed with NO other narrowing in this zone…
    expect(count(/for each Supporter card (?!that has "Team Rocket" in its name)[^.]*discard pile/)).toBe(0);
    // ⑶ the WORD ORDER: the fragment narrowing is never printed AFTER the zone phrase…
    expect(count(/discard pile that has "[^"]+" in its name/)).toBe(0);
    // …and the ADMITTED case on the same axis, so the zeros are not passing because the
    // pattern matches nothing at all (D424: every "X is printed nowhere" owes a "Y is").
    expect(count(/for each Supporter card that has "[^"]+" in its name in your discard pile\./)).toBe(1);
    // …and the printed narrowing the column DOES put after the zone phrase, which is
    // what makes ⑶ a statement about the FRAGMENT rather than about the position.
    expect(count(/discard pile that has the [^.]+ attack\./)).toBe(1);
  });

  it("🛑 the LITERAL table still wins, and the two branches cannot both be reached", () => {
    // `discardPileFilter` is two passes now — the closed map, then the pattern — and
    // the order is `boardConditionForClause`'s stated rule. The claim that no string
    // reaches both is STRUCTURAL (the pattern demands ` that has "`, which no map key
    // spells), and it is driven here over the four shipped keys rather than argued.
    const KEYS = ["Energy card", "Basic Energy card", "Item card", "Ethan's Adventure card"];
    for (const key of KEYS) {
      expect([key, /^Supporter card that has "([^"]+)" in its name$/.test(key)]).toEqual([key, false]);
      // …and each key still resolves through the map, unchanged by the new branch.
      expect(
        deriveAttackDamageMultiplier(`This attack does 30 damage for each ${key} in your discard pile.`),
      ).not.toBeNull();
    }
    // …and the ONE noun that reaches the pattern resolves to the new member and to
    // nothing else, at the value. Asserted through the WHOLE derived object rather than
    // through `?.count.filter`, which does not typecheck: `DamageCountSource` has
    // filter-less members, so a property read off the union is a compile error — the
    // same total-union property that made the `Record<CardFilter["kind"], …>` gate fire.
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: TR_SUPPORTER },
    });
  });

  it("🛑 D508's row still derives to its OWN filter — this slice widened nothing", () => {
    // The control that says the new branch did not reach past its own noun: D508's
    // sentence answers `attackNamePokemon` exactly as it did, and the two derived
    // values are the same `cardsInDiscardPile` one filter apart.
    expect(deriveAttackDamageMultiplier(PILE_ATTACK_NAME_TWIN)).toEqual({
      per: 20,
      count: {
        kind: "cardsInDiscardPile",
        seat: "you",
        filter: { kind: "attackNamePokemon", attack: "United Wings" },
      },
    });
    const mine = deriveAttackDamageMultiplier(PRINTED)?.count;
    expect(mine?.kind === "cardsInDiscardPile" ? mine.filter.kind : null).toBe(
      "supporterNameContaining",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: seven wrong builds, seven different numbers.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the canonical board and the seven separated wrong builds", () => {
  it("the printed swing deals 20 × 3 = 60", () => {
    expect(dealt(canonical())).toBe(60);
  });

  it("🛑 the six wrong builds read six OTHER numbers on the SAME board", () => {
    const state = canonical();
    // the print, read through the walk the arm uses.
    expect(countCardsInDiscardPile(state, "p1", TR_SUPPORTER)).toBe(3);
    // ⑵ the FRAGMENT dropped: bare `supporter` over the same pile.
    expect(countCardsInDiscardPile(state, "p1", SUPPORTER)).toBe(4);
    // ⑷ the exact `byName` read of the same string.
    expect(countCardsInDiscardPile(state, "p1", TR_BY_NAME)).toBe(0);
    // ⑸ the SEAT: `DiscardPileSeat` is controller-relative and the print says `your`.
    expect(countCardsInDiscardPile(state, "p1", ANY_CARD)).toBe(8);
    expect(countCardsInDiscardPile(state, "p2", TR_SUPPORTER)).toBe(6);
    // ⑶ the ANCHORING and ⑴ the HEAD NOUN — neither is spellable as a `CardFilter`,
    // so both are read off the pile's own names, which is the SAME population the arm
    // walks one predicate apart (D508's `attacksOf().length > 0` control, re-used).
    const cards = pileCards(state, "p1");
    expect(cards).toHaveLength(8);
    // ⑶ the prefix build: the SAME head-noun conjunct, `startsWith` instead of
    // `includes`. `fix-trgrunt` is the only card the two readings disagree about.
    expect(
      cards.filter((c) => matchesFilter(c, SUPPORTER) && (c?.name.startsWith(FRAGMENT) ?? false)),
    ).toHaveLength(2);
    // ⑴ the head noun dropped: the fragment alone, over every card class. The two
    // `fix-trtransceiver` are Items and the print excludes them.
    expect(cards.filter((c) => c?.name.includes(FRAGMENT) ?? false)).toHaveLength(5);
    // Seven DISTINCT counts, asserted as a set so a board edit that collapsed two of
    // them cannot pass by coincidence.
    const counts = [3, 4, 0, 8, 6, 2, 5];
    expect(new Set(counts).size).toBe(counts.length);
    // At 20 per card that is 60 / 80 / — / 160 / 120 / 40 / 100, and the defender
    // survives the largest of them, so every rung reads DAMAGE_DEALT, not a Knock Out.
    expect(FIXTURE_POOL["fix-titan"]?.hp ?? 0).toBeGreaterThan(160);
  });

  it("🛑 ⑹ THE ZONE IS A LOUD ZERO, which is the OPPOSITE of D508's zone control", () => {
    // The wrong build is the member one `case` up in `attack.ts`'s own switch —
    // `countPokemonInPlay` over the identical filter. A Supporter is a Trainer and a
    // Trainer is never in play, so that walk answers 0 on EVERY board this suite can
    // build, and on the `×` fold a 0 is no `DAMAGE_DEALT` row at all.
    //
    // ⚠️ **THAT IS WHY THE ATTACKER'S BENCH IS EMPTY RATHER THAN STOCKED.** D508's
    // board had to field bodies in play to make its zone mistake a plausible smaller
    // number; here no board can make it anything but zero, so stocking one would have
    // been a decoration pretending to be a control (D424).
    const state = canonical();
    expect(countPokemonInPlay(state, "p1", TR_SUPPORTER)).toBe(0);
    expect(countPokemonInPlay(state, "p1", SUPPORTER)).toBe(0);
    expect(state.players.p1.bench.filter((b) => b !== null)).toHaveLength(0);
    // …and the ADMITTED control on the same walk, so the zero is not passing because
    // `countPokemonInPlay` answers zero to everything (D424).
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" })).toBe(1);
  });

  it("🛑 the OTHER seat swings the same 60 — the count is CONTROLLER-relative", () => {
    // `DiscardPileSeat.you` is *the seat that declared the attack*, never `p1`, so the
    // SAME derived object must follow the attacker onto the mirrored board. The mirror
    // puts THREE positives in p2's pile and SIX in p1's, so the two candidate readings
    // are different numbers: a build that hard-coded `p1` deals 120 here and a build
    // that read the declaring seat deals 60. Driven on both seats rather than asserted
    // once (D213: one side passing says nothing about the other).
    const mirror = canonical("p2");
    expect(countCardsInDiscardPile(mirror, "p2", TR_SUPPORTER)).toBe(3);
    expect(countCardsInDiscardPile(mirror, "p1", TR_SUPPORTER)).toBe(6);
    expect(dealt(mirror, "p2")).toBe(60);
  });

  it("an empty pile is a LOUD ZERO, and the `×` fold drops the printed base", () => {
    // No DAMAGE_DEALT row at all — the printed floor of a `×` sentence with a zero
    // count, and the rung that says the 60 above came from the count rather than from
    // the base.
    expect(dealt(bare())).toBeUndefined();
    expect(activeOf(swing(bare()).state, "p2").damage).toBe(0);
  });

  it("the FROZEN board is handed back untouched — the purity pair", () => {
    const frozen = deepFreeze(canonical());
    const before = frozen.players.p1.discard.length;
    const after = swing(frozen);
    expect(frozen.players.p1.discard).toHaveLength(before);
    expect(after.state.players.p1.discard).toHaveLength(before);
    expect(after.state.players.p2.discard).toHaveLength(6);
    expect(activeOf(frozen, "p2").damage).toBe(0);
    expect(activeOf(after.state, "p2").damage).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the census step, the version, and the claimed set.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the census step this slice is", () => {
  it("🛑 the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    // D439's rule: the delta of a whole-corpus sweep should equal the slice. Every
    // corpus row whose claim this build could have changed is the one row it names.
    const claimed = legalAttackCorpus().filter(([, s]) => {
      const v = deriveAttackDamageMultiplier(s) ?? deriveAttackDamageBonus(s);
      return v !== null && v.count.kind === "cardsInDiscardPile" && v.count.filter.kind === "supporterNameContaining";
    });
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(2);
  });

  it("🛑 the lattice subtraction, keyed on the DERIVED VALUE rather than on the anchor", () => {
    // D505's rule for a lattice run in the build's own commit: the pre-state is the
    // post-state minus *the points my new arm claims*, and the key must be the derived
    // value, not a module-private pattern. The 2⁵ cube is NOUN × PREDICATE × ORDER ×
    // SEAT × FOLD; measured at this head it reads **1/32 before and 5/32 after**, and
    // the four new points are exactly the ones this predicate names — which is the
    // CONVERSE assertion D505 requires, without which the subtraction is circular.
    const NOUN = ["Supporter card", "Pokémon"] as const;
    const PRED = [`that has "${FRAGMENT}" in its name`, "that has the Round attack"] as const;
    const SEAT = ["your", "your opponent's"] as const;
    const FOLD = ["damage", "more damage"] as const;
    const point = (b: number): string => {
      const noun = NOUN[b & 1] ?? "";
      const pred = PRED[(b >> 1) & 1] ?? "";
      const seat = SEAT[(b >> 3) & 1] ?? "";
      const fold = FOLD[(b >> 4) & 1] ?? "";
      return ((b >> 2) & 1) === 0
        ? `This attack does 20 ${fold} for each ${noun} ${pred} in ${seat} discard pile.`
        : `This attack does 20 ${fold} for each ${noun} in ${seat} discard pile ${pred}.`;
    };
    const points = [...Array(32).keys()].map(point);
    // ⚠️ **DISTINCT, NOT MERELY NON-INERT** (D491's identity sense vs D505's): all 32
    // points are different strings, so no axis is DEGENERATE and the vector below is a
    // 2⁵ rather than a smaller table reported twice.
    expect(new Set(points).size).toBe(32);
    expect(points[0]).toBe(PRINTED);
    const claimed = points.filter((s) => {
      const v = deriveAttackDamageMultiplier(s) ?? deriveAttackDamageBonus(s);
      return v !== null && v.count.kind === "cardsInDiscardPile" && v.count.filter.kind === "supporterNameContaining";
    });
    // THE FOUR POINTS THIS BUILD ADDED: the printed one, plus the two axes the shipped
    // anchor pair already varies on its own (SEAT and FOLD) — which is precisely why
    // those two flip 1/16 on the flip table and the other three flip 5/16.
    expect(claimed.sort()).toEqual(
      [
        PRINTED,
        'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your opponent\'s discard pile.',
        'This attack does 20 more damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
        'This attack does 20 more damage for each Supporter card that has "Team Rocket" in its name in your opponent\'s discard pile.',
      ].sort(),
    );
    const built = points.filter((s) => resolvedByAnyReader(s));
    expect(built).toHaveLength(5);
    // …and the ONE point that built BEFORE this slice: D508's row, three axes away.
    expect(built.filter((s) => !claimed.includes(s))).toEqual([
      "This attack does 20 damage for each Pokémon in your discard pile that has the Round attack.",
    ]);
    // 🛑 **AND BOTH SPLITTERS ARE NULL AT EVERY POINT**, which is what makes the
    // readers-only and residue-predicate readings of this lattice provably identical
    // (D503's rule, D505's precondition: check both splitters before claiming they
    // cannot diverge).
    for (const s of points) {
      expect(splitAttackGateClause(s), s).toBeNull();
      expect(splitAttackTrailingClause(s), s).toBeNull();
    }
  });

  it("🛑 `:583` IS BUILT AT D512 — the refusal is RE-POINTED, and its falsifier REPAIRED", () => {
    // 🆕🆕🆕 **D512 TURNED THIS ROW OVER, AND THE RE-POINT SPLITS THE VERDICT WITHOUT
    // DELETING THE EVIDENCE** (D178/D418/D438, and D508's rule about narrowing an `rx`
    // to restore an old verdict). What D510 wrote here is kept verbatim as the REASON:
    //
    //   · **THE OR WAS FREE AND STILL IS** — `anyOf` ships and is N-ary over one axis,
    //     and D512's arm wraps its two fragments in exactly that combinator;
    //   · **THE FILTER WAS THE CHEAP HALF** — D510 called a Pokémon-headed fragment
    //     member *"the second of this slice's priced pair"* and *"cheap"*, and it was:
    //     `CardFilter.pokemonNameContaining`, one `matchesFilter` arm, one `retrieveNoun`
    //     arm, one `BENCHABLE_RETRIEVAL_KINDS` row;
    //   · **THE COUNT WAS THE EXPENSIVE HALF AND THAT WAS RIGHT** — it took a new
    //     `DamageCountSource` member, `bothSidesPokemonInPlay`, the FIRST both-sides
    //     count in that union to carry a `CardFilter` at all;
    //   · **AND D507's COMPOSITION ANSWER STILL DOES NOT TRANSFER.** Two counts cannot
    //     be two ops, because `deriveAttackDamageMultiplier` returns ONE optional count
    //     and not a list — which is asserted below rather than argued, exactly as D510
    //     asserted it.
    //
    // 🛑 **WHAT DOES THE RE-POINTED RUNG STILL CATCH (D438's SECOND HALF)?** Three
    // things, none of which is "the row is unbuilt": that the row is a TWO-printing
    // sentence on ONE record; that the reader's return type is still a single optional
    // count rather than a list, which is the property D507's answer fails on; and that
    // `CountSeat` is still TWO values — now with a falsifier that fires.
    const twin =
      'This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent\'s).';
    const rows = legalAttackCorpus().filter(([, s]) => s === twin);
    expect(rows.map(([, s]) => s)).toEqual([twin]);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    // 🆕🆕🆕 D512 — the VERDICT, and the only line of this rung that moved.
    expect(resolvedByAnyReader(twin)).toBe(true);
    expect(deriveAttackDamageMultiplier(twin)?.count.kind).toBe("bothSidesPokemonInPlay");
    // …and the RETURN TYPE, which is why a composition was never available: ONE count,
    // not a list. A build that summed two counts would have had to change this shape.
    const derived = deriveAttackDamageMultiplier(twin);
    expect(Array.isArray(derived?.count)).toBe(false);
    expect(Object.keys(derived ?? {}).sort()).toEqual(["count", "per"]);
    // 🛑 **THE FALSIFIER THIS RUNG USED TO CARRY DID NOT FIRE, AND THAT IS THE FINDING
    // D512 PAID FOR.** It read `const SEAT_VALUES: readonly CountSeat[] = ["you",
    // "opponent"]` plus `expect(SEAT_VALUES).toHaveLength(2)`, under the sentence *"the
    // day `CountSeat` gains a third member, this rung goes RED"*. **It does not.** A
    // `readonly T[]` holding two literals still typechecks when `T` gains an inhabitant,
    // and the length is a property of the literal, not of the type. Measured at D512's
    // head by doing it: `CountSeat` widened to three values, `tsc -b` **exit 0**, this
    // file **20 of 20 GREEN**.
    //
    // The repair is a `Record` KEYED on the union — D446's compile-enforced enumeration
    // idiom for `CardFilter["kind"]`, in `bodiesInPlayScaling.test.ts` — which cannot
    // compile with a value missing. ⚠️ **THE GENERAL RULE, because this will happen
    // again**: an array ANNOTATED with a union is not a guard on that union. Widening a
    // union can never make a narrower array illegal; only a `Record` keyed on it fails.
    const SEATS: Record<CountSeat, Seat> = { you: "p1", opponent: "p2" };
    expect(Object.keys(SEATS).sort()).toEqual(["opponent", "you"]);
    // …driven rather than enumerated: both shipped values resolve to a real seat, and
    // `attack.ts`'s ternary is exhaustive over exactly those two — which is why D512
    // shipped a MEMBER, caught by that file's total `switch` (D447), rather than a third
    // value that ternary would have read as the OPPONENT in silence.
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: TR_SUPPORTER },
    });
    expect(
      deriveAttackDamageMultiplier(
        'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your opponent\'s discard pile.',
      ),
    ).toEqual({
      per: 20,
      count: { kind: "cardsInDiscardPile", seat: "opponent", filter: TR_SUPPORTER },
    });
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});
