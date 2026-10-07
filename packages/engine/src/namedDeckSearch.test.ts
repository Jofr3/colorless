import type { Card } from "@luminous/schema";
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
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState } from "./index";
import type { EffectContinuation, EffectPrompt } from "./interpreter";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  trainerCard,
} from "./testFixtures";

// 0.400.0 → 0.401.0 — 🆕🆕🆕 D514: THE PRINTED *"any number of"* AND A PROPER NAME AS
// THE DECK-SEARCH NOUN.
//
//   "You may search your deck for any number of Fennel cards, reveal them, and
//    put them into your hand. Then, shuffle your deck."
//                                        — 1 sentence / 2 LEGAL printings
//                                          (`censusAttackCorpus.ts` FILE LINE 657,
//                                           `sv10.5b-036` / `sv10.5b-117`)
//
// 🛑 **THE HEADLINE IS THAT BOTH HALVES OF THIS ROW'S MECHANISM ALREADY SHIPPED, AND
// THE ROAD THAT LOOKED CHEAPER WOULD HAVE PAID FOR ONE OF THEM ANYWAY.** The obvious
// build was a REGISTRY row — the sibling one destination over (`sv09-068`, corpus FILE
// LINE 656, *"…any number of Basic Lillie's Pokémon and put them onto your Bench…"*) is
// exactly that, and it is a hand-written program. **It could not have transferred**:
// `LILLIES_COMFEY` spells its printed *"any number"* as `max: BENCH_MAX` [🆕🆕🆕 D577 (D539): `max:
// BENCH_CEILING` — an Area Zero Underdepths Bench holds 8], and that is
// sound only because the DESTINATION supplies a cap (a bench-bound search is clamped to
// `benchSpace` in two places). **A HAND HAS NO CAP AT ALL.** So the hand printing has no
// number a registry author could write down — only a deck size, which is not a printed
// word — and the registry road would have had to widen `searchDeck.max` anyway or ship
// a caption the card does not carry (D190b: a wrong-but-plausible program is strictly
// worse than an unbuilt one). **The op field is not the expensive half of the reader
// road; it is the half BOTH roads pay.** What the reader road buys on top is an arm that
// serves every reprint (D187) and a NOUN the whole family shares.
//
// ✅ **AND THE NOUN HALF SHIPPED 284 DECISIONS AGO UNDER ANOTHER ANCHOR (D513's rule,
// paid a fourth time).** `CardFilter.byName` has carried `cardNoun?: true` since **D264**
// — `retrieveNoun` spells `${name} cards` for exactly that value — and
// `ATTACK_BENCH_SEARCH` has captured a proper name into `byName` since **D230**
// (*"Search your deck for a Pikachu and put it onto your Bench…"*, corpus FILE LINE 447,
// BUILT). `ATTACK_DISCARD_RETRIEVAL` does the same one zone over since D237. So "search
// for a NAMED card" was never missing; what was missing was that ONE of the three
// anchors in the family could not ask the question. **ZERO new `CardFilter` members.**
//
// 🛑 **THE ANCHOR ANSWERED NULL, AND THAT IS THE MEASUREMENT RATHER THAN THE ABSENCE OF
// ONE (D510's habit, now four-for-four).** D510's row had matched since D440 and D513's
// since D231; run against this row's printed bytes the PRE-slice `ATTACK_HAND_SEARCH`
// does **not** match — its plural branch demands a literal `up to \d+`, and *"any number
// of"* is not that. §2 reconstructs the old pattern and drives it. **But the count was
// only the FIRST of two layers**: repair the count alone and the sentence matches and
// then dies in `HAND_SEARCH_PLURAL.get`, because *"Fennel cards"* is not a category.
// §2 drives that too, and §4's flip table says the same thing from the instrument side —
// COUNT and NOUN each flip the verdict at **4 of 8** cells, D507's CONJUNCTIVE pair.
//
// ⚠️ **THE STANDING PRICING NAMED A THIRD MECHANISM THAT WAS ALREADY FREE.** The
// D473-era resume point priced this sentence at *"three mechanisms, not one — a `byName`
// filter, an unbounded count, and the `You may` optional wrapper"*. The wrapper is the
// anchor's leading `(?:You may search|Search)` alternative and has been there since
// **D231**; the OPENER axis flips the verdict at **0 of 8** cells before the slice and
// after it. **Two, not three** — and the difference is a lattice run rather than a
// reading.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
//   §1 the PRINTED POPULATION — one corpus row, two legal printings, the bench twin
//      that stays a REGISTRY row, and the "printed zero times" measurements §4's flip
//      table says the banner guard owes.
//   §2 the RESOLVER — claimed by exactly ONE of thirteen readers at the VALUE; the
//      PRE-slice anchor DRIVEN to null; the SECOND layer driven; the banner refusal
//      driven; and the ORDERING that keeps a category out of `byName`.
//   §3 the BOARD — the park, the candidates, the unbounded ceiling, the caption that
//      prints no number, and the `max: 2` sibling as the attribution control.
//   §4 the CENSUS — the residue step, the lattice both ways with the flip table on
//      BOTH sides of the edit, `MATCH_RECORD_VERSION` and the engine version.

/** The printed sentence, byte for byte off `censusAttackCorpus.ts` FILE LINE 657. */
const PRINTED =
  "You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck.";

/** FILE LINE 658 — the nearest already-BUILT spelling of the same sentence, built since
    D231, and the control for every rung below: it differs from `PRINTED` in the COUNT
    and the NOUN and in nothing else, so a build that read neither would make the two
    derive to the same program and half this file would go quiet. */
const SIBLING =
  "You may search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.";

/** FILE LINE 656 — the BENCH twin of this row's quantifier, and it stays a REGISTRY
    row (`sv09-068`). Two printed sentences, one printed phrase, TWO DIFFERENT ANCHORS:
    this one is `ATTACK_BENCH_SEARCH`'s, whose noun group is `Basic Lillie's Pokémon`
    (an `ownerPokemon` behind a possessive) and not a name. **Building the hand printing
    says nothing about it**, which is asserted rather than assumed — and the assertion
    is load-bearing, because a reader arm that claimed a registry sentence would REDDEN
    `censusAtHead`'s `registryUnits` rung (D457). */
const BENCH_TWIN =
  "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.";

/** The COUNT axis repaired and the NOUN axis left printed — the point that proves the
    two blockers are a CONJUNCTION rather than one blocker with a spare. It is a real
    sentence this build now claims and one the column prints ZERO times (§1 measures
    it): the arm transfers to a printing that does not exist yet (D187). */
const COUNT_REPAIRED =
  "You may search your deck for up to 2 Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck.";

/** The BANNER in the name slot — the one axis D440 refused `^(.+) card$` on, and the
    reason `namedCardNounFilter` carries a refusal its two sibling anchors do not.
    *"Ancient"* is printed on the card FACE and is in NO column of the persisted catalog,
    so `byName { name: "Ancient" }` would match nothing on every board forever while
    `BUILT.attack` stepped for it. Printed ZERO times (§1). */
const BANNER =
  "You may search your deck for any number of Ancient cards, reveal them, and put them into your hand. Then, shuffle your deck.";

/** The CATEGORY noun under the new quantifier — the point that proves the closed table
    is still consulted FIRST. If the name resolver ran before the table this would derive
    a search for a card literally called "Energy", which matches nothing. */
const CATEGORY_UNDER_ANY =
  "You may search your deck for any number of Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.";

/** The twelve readers this sentence must NOT reach, so §2 asserts a NAMED owner plus
    twelve kept refusals rather than a bare `resolvedByAnyReader` (D438). */
const OTHERS = [
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
] as const;

const PROGRAM: readonly EffectOp[] = [
  {
    op: "searchDeck",
    filter: { kind: "byName", name: "Fennel", cardNoun: true },
    dest: "hand",
    max: "any",
    reveal: true,
  },
  { op: "shuffleDeck" },
];

/** The `ATTACK_HAND_SEARCH` source EXACTLY as it stood at D513's head, transcribed from
    `git show 2e96a7f7:packages/engine/src/effects.ts`. §2 execs it against the printed
    bytes, so *"the anchor was the blocker"* is a TEST rather than a claim — and the
    literal is what makes the row rot loudly if the pattern is rewritten (D211's rule
    about a unique string versus a line number). */
const PRE_SLICE_HAND_SEARCH = new RegExp(
  "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
    "|up to (\\d+) ([^,.]+?)( of different types)?(, reveal them,)? and put them)" +
    " into your hand\\. Then, shuffle your deck\\.$",
);

// ─────────────────────────────────────────────────────────────────────────────
// The board. `d514-*` keys with no catalog row behind them, kept out of
// `FIXTURE_POOL` entirely by the file-local pool below (D414/D452/D465), so every
// id ladder in the repo takes a ZERO term from this slice.
// ─────────────────────────────────────────────────────────────────────────────

const ANY_NUMBER = 0;
const UP_TO_TWO = 1;
const BANNER_ATTACK = 2;

/** 🛑 THE NAME IS THE DATUM AND THE ID IS NOT. `byName` is exact equality on
    `Card.name`, so the two Fennel fixtures below share a NAME and differ in ID — which
    is what makes §3's candidate rung a statement about the filter rather than about
    `deckOf`'s key. `d514-fennell` is the near miss: one letter longer, so a build that
    used `startsWith` or `includes` (both live in this union — `ownerPokemon` and
    `supporterNameContaining`) would offer it and §3 goes red. */
const D514_CARDS: Record<string, Card> = {
  "d514-fennel-a": {
    ...trainerCard("d514-fennel-a", "Supporter", "Draw 3 cards."),
    name: "Fennel",
  },
  "d514-fennel-b": {
    ...trainerCard("d514-fennel-b", "Supporter", "Draw 2 cards."),
    name: "Fennel",
  },
  "d514-fennell": {
    ...trainerCard("d514-fennell", "Supporter", "Draw 1 card."),
    name: "Fennell",
  },
  "d514-cinccino": battler("d514-cinccino", {
    name: "D514 Cinccino",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      // 🛑 THE PRINTED BYTES, and D183's rule is why they are a constant rather than
      // retyped here: an arm authored from a PARAPHRASE passes a test written against
      // the same paraphrase and matches no real card.
      { cost: ["Colorless"], name: "Call For Family", effect: PRINTED },
      // The built sibling — the attribution control that separates "the printed
      // quantifier was read" from "a search was parked" on every rung in §3.
      { cost: ["Colorless"], name: "Plain Call", effect: SIBLING },
      // The banner, printed on a body that can actually attack, because a guard
      // nothing reaches is a guard nobody can trust (D200→D214).
      { cost: ["Colorless"], name: "Old Call", effect: BANNER },
    ],
  }),
};

const D514_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D514_CARDS };

/** 🛑 THE DECK IS THE EXPERIMENT AND ITS COUNTS ARE LOAD-BEARING. TWO distinct ids
    share the name "Fennel" and a THIRD is one letter away from it, so §3's candidate
    set separates exact equality from both substring reads this `CardFilter` union
    already ships. The Fennel count is deliberately **larger than any printed `up to N`
    in the family** (the largest is 4), so a build that resolved *"any number"* to a
    constant instead of to the candidate set would be caught by the ceiling rung rather
    than pass it by coincidence. 60 counted before the first run. */
const D514_DECK = deckOf({
  "d514-cinccino": 8,
  "fix-basic-1": 8,
  "d514-fennel-a": 7,
  "d514-fennel-b": 7,
  "d514-fennell": 6,
  "fix-energy": 16,
  "fix-item": 8,
});

function openTable(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: D514_DECK, p2: D514_DECK },
    cardPool: D514_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(
    applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first: "p2" }),
  );
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(
      applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(
      applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  // `p2` opens and passes, so `p1` attacks on a turn that carries no first-turn lock.
  return mustApply(table, { type: "endTurn", seat: "p2" }).state;
}

/** p1 fields the attacker with one Energy attached to pay a {C} cost, and an EMPTY
    Bench — the search puts cards into the HAND, so a Bench body would only add noise. */
function canonical(seed = 31): GameState {
  let state = setActiveFromDeck(openTable(seed), "p1", "d514-cinccino");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-basic-1");
  return state;
}

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index }).state;

function cardsPrompt(state: GameState): Extract<EffectPrompt, { kind: "chooseCards" }> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function continuation(state: GameState): EffectContinuation {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  return state.phase.cont;
}

const nameOf = (state: GameState, uid: string): string =>
  (D514_POOL[state.cardIdByUid[uid] as string] as Card).name;

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } }).state;

function printedCount(rows: readonly (readonly [number, string])[], text: string): number {
  return rows.filter(([, s]) => s === text).reduce((sum, [n]) => sum + n, 0);
}

/** 🛑 WHAT THIS SLICE CLAIMS, KEYED ON THE DERIVED VALUE AND NOT ON THE (module-private)
    ANCHOR — D505's rule, and the `dest` conjunct is not decoration. `byName` deck
    searches have been DERIVED since **D230**, four of them, every one onto the BENCH;
    keying on the filter alone would credit this slice with rows built 284 decisions ago
    and make §4's subtraction a lie. The two disjuncts are the two axes the slice pays
    for, and the destination names the anchor that pays for them. */
function claimsThisSlice(text: string): boolean {
  const first = (deriveAttackEffect(text) ?? [])[0] as
    | { op?: string; dest?: string; max?: unknown; filter?: { kind?: string } }
    | undefined;
  if (first?.op !== "searchDeck" || first.dest !== "hand") return false;
  return first.max === "any" || first.filter?.kind === "byName";
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed sentence, its population, and the absences the axes owe.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the population, and the absences", () => {
  it("🛑 ONE corpus row, TWO legal printings, and the delta from the sibling is TWO spans", () => {
    const printed = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(printed.get(PRINTED)).toBe(2);
    // …and both comparands are rows of the SAME column, so the axes come off the
    // catalog rather than off an invented twin (D427/D456).
    expect(printed.get(SIBLING)).toBe(1);
    expect(printed.get(BENCH_TWIN)).toBe(1);
    // 🛑 THE WHOLE DELTA, AS BYTES: the count span and the noun span, and NOTHING else.
    // The reveal clause is printed on this row and absent on the sibling, which is the
    // third difference — and it has been an optional group since D231, which is why it
    // is spelled out here rather than folded into one of the two spans this slice pays
    // for. The OPENER is byte-identical on both rows.
    expect(
      SIBLING.replace("up to 2 cards and", "any number of Fennel cards, reveal them, and"),
    ).toBe(PRINTED);
    expect(PRINTED.startsWith("You may search")).toBe(true);
    expect(SIBLING.startsWith("You may search")).toBe(true);
  });

  it("🛑 the measurements the BANNER guard owes, and the one the arm's TRANSFER owes", () => {
    const rows = legalAttackCorpus();
    expect(rows).toHaveLength(640);
    // ⓐ **THE BANNERS ARE PRINTED ZERO TIMES IN THIS SLOT** (D508: an axis that flips
    // anywhere is a literal owing a *"printed zero times"* measurement). The column
    // does print all three words — `Ancient card` and `Future card(s)` are real head
    // nouns on three rows, which is exactly why the guard is not vacuous — but never
    // as the noun of a deck search.
    for (const word of ["Ancient", "Future", "Tera"]) {
      const searches = rows.filter(
        ([, s]) => /^(?:You may search|Search) your deck/.test(s) && s.includes(`${word} card`),
      );
      expect([word, searches]).toEqual([word, []]);
    }
    // …and the banner words really are in the column, so the guard refuses something
    // the ingest can produce rather than a word this catalog has never seen.
    expect(rows.filter(([, s]) => /\b(?:Ancient|Future) cards?\b/.test(s)).length).toBeGreaterThan(
      0,
    );
    // ⓑ **THE TWO CONSTRUCTED POINTS ARE PRINTED ZERO TIMES**, which is what makes §2's
    // conjunction rung and §2's ordering rung guards on a FUTURE print rather than on a
    // current one — and what makes this arm a transfer (D187) rather than a widening
    // measured against the row it was built for.
    expect(printedCount(rows, COUNT_REPAIRED)).toBe(0);
    expect(printedCount(rows, CATEGORY_UNDER_ANY)).toBe(0);
    expect(printedCount(rows, BANNER)).toBe(0);
    // ⓒ **THE PRINTED QUANTIFIER IS TWO SENTENCES / THREE PRINTINGS ON THIS COLUMN**, and
    // that is the measurement that falsifies `attachFromDeck`'s shipped parenthetical
    // (*"no printed search says 'any number'"*, corrected in place by this slice).
    const anyNumberSearches = rows.filter(
      ([, s]) => /^(?:You may search|Search) your deck/.test(s) && s.includes("any number of"),
    );
    expect(anyNumberSearches.map(([, s]) => s).sort()).toEqual([PRINTED, BENCH_TWIN].sort());
    expect(anyNumberSearches.reduce((sum, [n]) => sum + n, 0)).toBe(3);
  });

  it("the fixture pool is FILE-LOCAL, so no id ladder in the repo moves", () => {
    // D414/D452/D465 — a `FIXTURE_POOL` id is a census entry with a tax of its own.
    // This slice pays ZERO of it, and that is asserted rather than intended.
    for (const id of Object.keys(D514_CARDS)) expect(FIXTURE_POOL[id]).toBeUndefined();
    expect(D514_DECK).toHaveLength(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the resolver: the anchor that WAS the blocker, the second layer, the guards.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchor, the second layer, and the two refusals", () => {
  it("🛑 exactly ONE of thirteen readers claims it, at the VALUE", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    for (const reader of OTHERS)
      expect([reader.name, reader(PRINTED)]).toEqual([reader.name, null]);
  });

  it("🛑 D510's HABIT, FOUR-FOR-FOUR: the PRE-slice anchor is DRIVEN, and here it says NULL", () => {
    // D510's row had matched since D440 and D513's since D231 — both times the anchor
    // was NOT the blocker. Here it is, and running it is what says so: the plural
    // branch demands a literal `up to \d+`, and *"any number of"* is not that. The
    // singular branch cannot take it either — it demands the article `an? `, and "any"
    // is not "an" followed by a space.
    expect(PRE_SLICE_HAND_SEARCH.exec(PRINTED)).toBeNull();
    // …and the pattern is not simply broken: it matches the built sibling exactly as it
    // always did, which is the attribution control for the line above (D214).
    expect(PRE_SLICE_HAND_SEARCH.exec(SIBLING)).not.toBeNull();
  });

  it("🛑 …AND THE COUNT WAS ONLY THE FIRST LAYER — the blockers are a CONJUNCTION", () => {
    // Repair the count and the PRE-slice anchor MATCHES: `([^,.]+?)` contains no comma
    // and no period, so it captures `Fennel cards` whole. The sentence then died one
    // step later in the noun table, exactly where D513's row died — which is why this
    // row needed BOTH a pattern alternative and a new resolver, and why neither alone
    // would have moved the census.
    const repaired = PRE_SLICE_HAND_SEARCH.exec(COUNT_REPAIRED);
    expect(repaired?.[4]).toBe("Fennel cards");
    // Today the noun resolves, so the count-repaired point is claimed too — with the
    // printed digit and not with `"any"`, which is the proof that the two axes are read
    // independently rather than welded (D451).
    expect(deriveAttackEffect(COUNT_REPAIRED)).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "byName", name: "Fennel", cardNoun: true },
        dest: "hand",
        max: 2,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    // …and the converse: the printed quantifier under a CATEGORY noun is claimed too,
    // with the table's filter. Both axes free, both read.
    expect(deriveAttackEffect(CATEGORY_UNDER_ANY)).toEqual([
      { op: "searchDeck", filter: { kind: "anyEnergy" }, dest: "hand", max: "any", reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 the BANNER is refused LOUDLY — D440's axis, and the one guard the siblings lack", () => {
    expect(deriveAttackEffect(BANNER)).toBeNull();
    for (const word of ["Ancient", "Future", "Tera"]) {
      const text = PRINTED.replace("Fennel cards", `${word} cards`);
      expect([word, deriveAttackEffect(text)]).toEqual([word, null]);
    }
    // …and the refusal is the BANNER SET and not the pattern: one letter more and the
    // same shape derives, so the guard discriminates rather than refusing a class of
    // strings (D200→D214 — say what turns it red).
    expect(deriveAttackEffect(PRINTED.replace("Fennel cards", "Ancients cards"))).not.toBeNull();
  });

  it("🛑 the ORDERING: the closed table is asked FIRST, so no category becomes a NAME", () => {
    // `ATTACK_DISCARD_RETRIEVAL` states the constraint from the other side — ordering
    // the alternatives table-first is what keeps "Pokémon" an `anyPokemon` rather than
    // a card called Pokémon. This anchor keeps ONE lazy noun group and orders the
    // RESOLVERS instead, so the property has to be asserted HERE rather than read off
    // the pattern. Every table noun that can wear the "cards" suffix, under the new
    // quantifier, must still resolve to its CATEGORY.
    const byCategory: readonly (readonly [string, string])[] = [
      ["Energy cards", "anyEnergy"],
      ["Item cards", "item"],
      ["Supporter cards", "supporter"],
      ["Stadium cards", "stadium"],
      ["Trainer cards", "trainerCard"],
      ["Basic Energy cards", "basicEnergy"],
      ["Pokémon Tool cards", "toolCard"],
    ];
    for (const [noun, kind] of byCategory) {
      const program = deriveAttackEffect(PRINTED.replace("Fennel cards", noun));
      const first = (program ?? [])[0] as { filter?: { kind?: string } } | undefined;
      expect([noun, first?.filter?.kind]).toEqual([noun, kind]);
    }
    // …and the brace pattern still runs BEFORE the name resolver too, so a typed noun
    // does not become a card called "Basic".
    const typed = deriveAttackEffect(PRINTED.replace("Fennel cards", "Basic {R} Energy cards"));
    expect((typed ?? [])[0]).toEqual({
      op: "searchDeck",
      filter: { kind: "basicEnergy", energyType: "Fire" },
      dest: "hand",
      max: "any",
      reveal: true,
    });
  });

  it("🛑 the NAME CLASS is `ATTACK_BENCH_SEARCH`'s, so an unspellable name stays LOUD", () => {
    // A single capitalised word — a hyphenated / spaced / apostrophised name falls
    // through to `ATTACK_EFFECT_SKIPPED` rather than being approximated. These are the
    // shapes the catalog really prints elsewhere ("Iono's Bellibolt", "Ho-Oh"), so the
    // refusal is about a real class of names and not a constructed one.
    for (const name of ["Iono's Bellibolt", "Ho-Oh", "Miraidon ex", "fennel"]) {
      const text = PRINTED.replace("Fennel cards", `${name} cards`);
      expect([name, deriveAttackEffect(text)]).toEqual([name, null]);
    }
    // …and the SINGULAR branch offers no name group at all, deliberately: the column
    // prints no *"search your deck for a ⟨Name⟩ card … put it into your hand"* (the 7
    // singular hand searches all name a category), so a branch there would be one no
    // card reaches.
    expect(
      deriveAttackEffect(
        "You may search your deck for a Fennel card, reveal it, and put it into your hand. Then, shuffle your deck.",
      ),
    ).toBeNull();
  });

  it("🛑 the BENCH TWIN does NOT come along — two printings, one phrase, two anchors", () => {
    // The registry sentence one destination over. A reader arm that claimed it would
    // REDDEN `censusAtHead`'s `registryUnits` rung (D457), so this is a guard on this
    // slice's own blast radius rather than a note about a sibling.
    expect(resolvedByAnyReader(BENCH_TWIN)).toBe(false);
    // …and the whole registry is checked, not just this one row: NO sentence
    // `REGISTRY_ATTACKS` builds became reader-claimed in this commit.
    const registrySentences = legalAttackCorpus()
      .map(([, s]) => s)
      .filter((s) => /^(?:You may search|Search) your deck/.test(s) && !resolvedByAnyReader(s));
    expect(registrySentences).toContain(BENCH_TWIN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: the offer, the unbounded ceiling, and the caption.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the offer, the ceiling, and the caption that prints no number", () => {
  it("🛑 the candidates are EXACTLY the cards NAMED Fennel — equality, not a prefix", () => {
    const prompt = cardsPrompt(attack(canonical(), ANY_NUMBER));
    expect(prompt.candidates.length).toBeGreaterThan(0);
    const names = new Set(prompt.candidates.map((uid) => nameOf(canonical(), uid)));
    // ⚠️ the uid→id map is per-state, so read the names off the SAME state the prompt
    // came from rather than off a fresh one.
    const state = attack(canonical(), ANY_NUMBER);
    const live = new Set(cardsPrompt(state).candidates.map((uid) => nameOf(state, uid)));
    expect([...live]).toEqual(["Fennel"]);
    expect(names.size).toBeGreaterThan(0);
    // …and the one-letter-longer card is in the DECK and not in the OFFER, which is
    // what separates `byName`'s equality from the two substring reads this union
    // already ships (`ownerPokemon` uses `startsWith`, `supporterNameContaining` uses
    // `includes`). A build that reached for either would offer `Fennell` and this rung
    // is the only thing that would notice.
    const deckNames = state.players.p1.deck.map((uid) => nameOf(state, uid));
    expect(deckNames).toContain("Fennell");
    expect(cardsPrompt(state).candidates.map((uid) => nameOf(state, uid))).not.toContain("Fennell");
  });

  it('🛑 *"any number"* IS THE WHOLE MATCHING SET — the ceiling is the offer, not a constant', () => {
    const state = attack(canonical(), ANY_NUMBER);
    const prompt = cardsPrompt(state);
    // The printed sentence names no ceiling, so the park's ceiling is the candidate
    // count itself. A build that resolved `"any"` to a sentinel, to a deck size, or to
    // any printed `up to N` in the family (the largest is 4) fails here.
    expect(prompt.max).toBe(prompt.candidates.length);
    expect(prompt.max).toBeGreaterThan(4);
    // …and it is still "up to": `min` is 0, so declining is a legal answer exactly as
    // it is for every other search in this vocabulary. The printed *"You may"* asks for
    // nothing the op did not already offer, which is why the OPENER axis is free.
    expect(prompt.min).toBe(0);
    // …and no caps ride this park: the two cap producers are `also` and
    // `distinctEnergyTypes`, and this program spells neither.
    expect("caps" in prompt).toBe(false);
  });

  it("🛑 taking ALL of them is a legal answer, and the hand actually gains them", () => {
    const state = attack(canonical(), ANY_NUMBER);
    const prompt = cardsPrompt(state);
    const all = [...prompt.candidates];
    const before = state.players.p1.hand.length;
    const after = resolve(state, all);
    expect(after.players.p1.hand.length).toBe(before + all.length);
    for (const uid of all) expect(after.players.p1.hand).toContain(uid);
    // …the deck lost exactly those cards and the trailing `shuffleDeck` still ran, so
    // the park is not left open.
    expect(after.players.p1.deck.length).toBe(state.players.p1.deck.length - all.length);
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 the CAPTION reproduces the printed words and invents no number", () => {
    const note = cardsPrompt(attack(canonical(), ANY_NUMBER)).note;
    expect(note).toBe("Search your deck for any number of Fennel cards into your hand.");
    // 🛑 THE ATTRIBUTION CONTROL, AND IT IS THE WHOLE REASON `"any"` IS A UNION MEMBER
    // RATHER THAN A RESOLVED CLAMP (D333): the SAME prompt built from a printed digit
    // reads "up to 2", so a build that spelled the quantifier as a number would caption
    // this card with the size of its own deck — a number the card does not print, and
    // a count of hidden cards leaked before the offer is opened.
    const sibling = cardsPrompt(attack(canonical(), UP_TO_TWO));
    expect(sibling.note).toBe("Search your deck for up to 2 cards into your hand.");
    expect(sibling.max).toBe(2);
    expect(note).not.toMatch(/\d/);
  });

  it("🛑 the BANNER attack never parks at all — the loud path, on a real board", () => {
    // The refusal §2 drives at the reader, driven again at the table: a sentence no
    // reader claims must leave through `ATTACK_EFFECT_SKIPPED` rather than parking
    // something. This is the rung that makes the guard reachable.
    const state = attack(canonical(), BANNER_ATTACK);
    expect(state.phase.kind).not.toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the census step, the lattice, the record version, and the engine version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the census step this slice is", () => {
  it("🛑 the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    const claimed = legalAttackCorpus().filter(([, s]) => claimsThisSlice(s));
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(2);
  });

  it("🛑 the NAMED deck search was ALREADY BUILT one destination over — measured, not argued", () => {
    // 🛑 THE EVIDENCE FOR THIS SLICE'S HEADLINE, AND IT IS A CENSUS RATHER THAN A
    // CITATION. `ATTACK_BENCH_SEARCH` has resolved a captured proper name to `byName`
    // since D230, and the column carries FOUR such rows today — Pikachu, Froakie,
    // Grubbin and Charjabug. They are why this slice adds ZERO `CardFilter` members, and
    // they are why `dest` is part of the key for *"what D514 claims"*: a `byName` deck
    // search that is not this slice's is a BENCH one, built 284 decisions ago.
    const named = legalAttackCorpus().filter(([, text]) => {
      const first = (deriveAttackEffect(text) ?? [])[0] as
        | { op?: string; filter?: { kind?: string } }
        | undefined;
      return first?.op === "searchDeck" && first.filter?.kind === "byName";
    });
    const byDest = new Map<string, number>();
    for (const [, text] of named) {
      const first = (deriveAttackEffect(text) ?? [])[0] as { dest?: string };
      byDest.set(first.dest ?? "?", (byDest.get(first.dest ?? "?") ?? 0) + 1);
    }
    expect([...byDest.entries()].sort()).toEqual([
      ["bench", 4],
      ["hand", 1],
    ]);
    // …and the four are not this slice's by any reading: the hand row is exactly the
    // one this slice claims, and no other.
    for (const [, text] of named) {
      const first = (deriveAttackEffect(text) ?? [])[0] as { dest?: string };
      expect([text, first.dest === "hand"]).toEqual([text, claimsThisSlice(text)]);
    }
  });

  it("🛑 the lattice, run BOTH WAYS and keyed on the DERIVED VALUE (D491/D503/D505)", () => {
    // FOUR binary axes — OPENER × COUNT × NOUN × REVEAL — counted from the PRINT and
    // not from the brief (D489). There is no fifth: the destination is the other
    // ANCHOR's axis (see `BENCH_TWIN`), so substituting it would confound "this axis
    // blocks" with "the substituted noun does not fit the other family". Bit 0 of every
    // axis is the PRINTED value, and every off-value is a spelling some reader could in
    // principle claim.
    const OPENERS = ["You may search", "Search"];
    const COUNTS = ["any number of ", "up to 2 "];
    const NOUNS = ["Fennel cards", "cards"];
    const REVEALS = [", reveal them,", ""];
    const point = (m: number) =>
      `${OPENERS[m & 1]} your deck for ${COUNTS[(m >> 1) & 1]}${NOUNS[(m >> 2) & 1]}${REVEALS[(m >> 3) & 1]} and put them into your hand. Then, shuffle your deck.`;
    const points = Array.from({ length: 16 }, (_, i) => point(i));
    expect(new Set(points).size).toBe(16);
    expect(points[0]).toBe(PRINTED);
    expect(points[14]).toBe(SIBLING);

    // ⓐ the READERS-ONLY reading — every point builds after this slice.
    expect(points.filter((s) => resolvedByAnyReader(s))).toHaveLength(16);
    // ⓑ the RESIDUE-PREDICATE reading (D503) — `builds()`'s other three arms, CHECKED
    // rather than assumed. ⚠️ THIS IS NOT A FORMALITY (D505): every point has a SECOND
    // depth-0 segment (*"Then, shuffle your deck."*) whose tail a reader could claim, so
    // the trailing splitter has a real opportunity at all 16 points. It declines at
    // every one, and so does the gate splitter — 32 checks — so the two readings are
    // provably identical rather than identical by luck.
    for (const s of points) {
      expect([s, splitAttackGateClause(s)]).toEqual([s, null]);
      expect([s, splitAttackTrailingClause(s)]).toEqual([s, null]);
    }
    // ⓒ the PRE-state: subtract the points this slice's arm claims, keyed on the derived
    // VALUE rather than on the (module-private) anchor (D505).
    const wasBuilt = (s: string) => resolvedByAnyReader(s) && !claimsThisSlice(s);
    expect(points.filter(wasBuilt)).toHaveLength(4);
    // …and the converse, or the subtraction is circular (D505): the claimed set is
    // EXACTLY the twelve points where the COUNT or the NOUN is the printed one.
    const moved = points.filter(claimsThisSlice);
    expect(moved).toHaveLength(12);
    expect(moved.every((s) => s.includes("any number of") || s.includes("Fennel cards"))).toBe(
      true,
    );
    expect(16 - 4).toBe(moved.length);

    // 🛑 THE FLIP TABLE, ON BOTH SIDES OF THE EDIT (D508's price, D513's shape change).
    const flips = (claimed: (s: string) => boolean) =>
      [0, 1, 2, 3].map((ax) => {
        let n = 0;
        for (let m = 0; m < 16; m++) {
          if ((m >> ax) & 1) continue;
          if (claimed(point(m)) !== claimed(point(m | (1 << ax)))) n++;
        }
        return n;
      });
    // PRE — `0/1 · 0/4 · 1/6 · 2/4 · 1/1` = 4 of 16, and the flip table is COUNT 4/8 and
    // NOUN 4/8 with OPENER and REVEAL at ZERO. **That is D507's eighth shape**: a
    // CONJUNCTIVE PAIR — each blocker flips only the half of its cells where the other
    // is already substituted, so neither alone reaches a built string. It is also the
    // rung that falsifies the standing pricing: the OPENER (*"You may"*) was named as a
    // third mechanism and flips NOTHING, before the slice or after it.
    expect(flips(wasBuilt)).toEqual([0, 4, 4, 0]);
    // POST — every axis is free and every point builds. **A pure widening leaves no
    // axis off zero**, so the lattice owes no new *"printed zero times"* measurement…
    expect(flips(resolvedByAnyReader)).toEqual([0, 0, 0, 0]);
    // 🛑 …AND THAT IS EXACTLY WHY THE BANNER GUARD'S PRICE IS INVISIBLE HERE. The guard
    // narrows, and a narrowing normally moves an axis off zero (D513). This one does
    // not, because the lattice's axes are the SENTENCE'S OWN variation and the banner is
    // a value this sentence never takes. **A lattice cannot price a guard on a value
    // outside its own axis set** — so §1ⓐ pays that measurement by hand, and this
    // comment is the reason a successor should not read `[0,0,0,0]` as "cost nothing".
    //
    // ⚠️ INERT IS NOT DEGENERATE (D491/D505/D508): all 16 points are distinct strings,
    // asserted above, so the zero axes are inert on the VERDICT rather than identical
    // spellings reported twice.
    expect(new Set(points.map((s) => s.length)).size).toBeGreaterThan(1);
  });

  it("🛑 `MATCH_RECORD_VERSION` HOLDS at 30, and the argument is a WIDENING", () => {
    // 🛑 THE DOOR, NAMED (D513). `searchDeck` PARKS, so unlike a damage fold this op
    // genuinely reaches persisted storage: its literal rides
    // `EffectContinuation.pendingOp` inside `MatchRecord.state.phase.cont` (D457 — the
    // park IS the road to storage). The fold-shaped argument D508/D512 used is NOT
    // available here and is not inherited.
    const parked = attack(canonical(), ANY_NUMBER);
    const cont = continuation(parked);
    expect((cont.pendingOp as { op: string }).op).toBe("searchDeck");
    expect((cont.pendingOp as { max?: unknown }).max).toBe("any");

    // 🛑 AND THE ARGUMENT SHAPE IS THE ONE THAT IS TRUE (D463): this is a type WIDENING
    // on an EXISTING field, not an added optional key, so D125's absent-key test is the
    // wrong instrument and D359's *"a widening is free and a rename is not"* is the
    // right one. No key is added and none is removed; every v30 record's
    // `pendingOp.max` is a `number`, `number` is still an inhabitant of this type, and
    // it still means what it meant.
    //
    // **Driven rather than argued**: the SIBLING's parked op is v30 bytes exactly — a
    // numeric `max`, authorable by the previous deploy — so resuming it under THIS
    // build is the loss direction, and it parks the prompt v30 meant.
    const v30 = continuation(attack(canonical(), UP_TO_TWO));
    expect((v30.pendingOp as { max?: unknown }).max).toBe(2);
    const resumed = runProgram(parked, [v30.pendingOp as EffectOp], v30.ctx, []);
    if (resumed.kind !== "parked" || resumed.prompt.kind !== "chooseCards") {
      throw new Error("expected the v30 op to park a chooseCards");
    }
    expect([resumed.prompt.min, resumed.prompt.max]).toEqual([0, 2]);
    expect(resumed.prompt.note).toBe("Search your deck for up to 2 cards into your hand.");
    // ⚠️ AND THE CONVERSE IS WHAT MAKES THE ABOVE A MEASUREMENT: the member is not
    // inert. The same continuation with the printed quantifier parks a DIFFERENT
    // ceiling and a different caption, so "a number still means a number" is a
    // statement about behaviour rather than about a type.
    expect(cardsPrompt(parked).note).not.toBe(resumed.prompt.note);
    expect(cardsPrompt(parked).max).not.toBe(2);
  });

  it('🛑 the multi-group caption carries `"any"` too — spelled, and DRIVEN', () => {
    // The `also` branch of `searchNote` is UNREACHABLE from the deriver (every
    // multi-noun anchor spells a digit, and `also[].max` is a bare `number`), so this
    // rung exists because a REGISTRY author can hand-write the pair tomorrow and the
    // alternative to the line is a caption that silently drops the printed quantifier.
    // D513 made the same call one field over for `caps`. Driven off a hand-authored op
    // rather than left as a line no test can reach (D456: a mutant with nowhere to die).
    const state = canonical();
    const op: EffectOp = {
      op: "searchDeck",
      filter: { kind: "byName", name: "Fennel", cardNoun: true },
      dest: "hand",
      max: "any",
      also: [{ filter: { kind: "item" }, max: 1 }],
    };
    const cont = continuation(attack(state, ANY_NUMBER));
    const out = runProgram(state, [op], cont.ctx, []);
    if (out.kind !== "parked" || out.prompt.kind !== "chooseCards") {
      throw new Error("expected a chooseCards park");
    }
    expect(out.prompt.note).toBe(
      "Search your deck for any number of Fennel cards and an Item card into your hand.",
    );
    // …and the TOTAL is the resolved first group plus the printed second, so the
    // caption's words and the validator's ceiling come off the same two numbers.
    expect(out.prompt.max).toBe(
      out.prompt.candidates.filter((uid) => nameOf(state, uid) === "Fennel").length + 1,
    );
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.475.0");
  });
});
