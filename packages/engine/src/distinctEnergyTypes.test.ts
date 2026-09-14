import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { energyProvidesOf } from "./cards";
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
  expectErr,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// 0.399.0 → 0.400.0 — 🆕🆕🆕 D513: THE PRINTED *"of different types"* — A PAIRWISE
// RELATION AMONG THE PICKS, AND THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS.
//
//   "Search your deck for up to 3 Basic Energy cards of different types, reveal
//    them, and put them into your hand. Then, shuffle your deck."
//                                        — 1 sentence / 1 LEGAL printing
//                                          (`censusAttackCorpus.ts` FILE LINE 473,
//                                           Sylveon ex `sv06.5-050`)
//
// 🛑 **THE HEADLINE IS THAT NO `CardFilter` COULD EVER HAVE BUILT THIS ROW, AND TWO
// SHIPPED REFUSAL COMMENTS SAID ONE WOULD.** `effects.ts` called the missing piece a
// *"distinctness `CardFilter`"* in two places, and `derivedDeckSearchAttach.test.ts`
// pinned the same words as a reason. **A `CardFilter` is answered by `matchesFilter`
// one uid at a time**; *"of different types"* is a predicate on the ANSWER SET, so it
// is false of no card and true of no card. It is a different KIND of constraint, not
// a missing member, and widening that union however far never reaches it. All three
// sites are CORRECTED IN PLACE rather than deleted (D178/D457/D466/D508), and the
// attach-family refusal they belong to is NARROWED rather than retired — `sv08-161`
// is still blocked, by the Tera banner AND by an anchor that does not admit the
// phrase at all.
//
// ✅ **WHAT DOES CARRY IT ALREADY SHIPPED, ONE LAYER DOWN.** D332 built
// `chooseCards.caps` — `{ uids, max }[]`, a cap on how many picks may come out of a
// named uid set — for Drayton's *"a Pokémon **and** a Trainer card"*, and
// `validateChoice` enforces it with its own comment saying *"this is the ONLY place
// they can be enforced"*. **A distinctness relation over a finite partition IS a set
// of caps**: partition the candidates by `energyProvidesOf` and cap every cell at
// ONE. So the engine change is ONE optional anchor group, ONE optional op key, ONE
// partition in the park and ONE caption parameter — with **ZERO new prompt fields,
// ZERO validator branches and ZERO client mirrors** (D457: a PROMPT field costs five
// mirrors, an OP field costs none — and this slice adds no prompt field at all).
//
// 🛑 **AND THE ANCHOR WAS NEVER THE BLOCKER, WHICH IS D510's RULE PAYING OUT A SECOND
// TIME AND IS DRIVEN IN §2 RATHER THAN NARRATED.** `ATTACK_HAND_SEARCH`'s
// `([^,.]+?)` plural-noun group contains neither a comma nor a period, so it has
// captured `Basic Energy cards of different types` WHOLE since D231 — **the sentence
// reached this reader for 282 decisions and died one step later, in
// `HAND_SEARCH_PLURAL.get`.** §2 reconstructs the PRE-slice pattern and execs it
// against the printed bytes, so the finding is a test and not a claim. The new group
// admits nothing the old pattern refused; it moves a phrase OUT of the noun so the
// closed table is asked about a noun it can name.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
//   §1 the PRINTED POPULATION — one corpus row, one legal printing, the byte delta
//      from the built sibling measured as bytes, and the two "printed zero times"
//      measurements §4's flip table shows this slice owes.
//   §2 the RESOLVER — the sentence is claimed by exactly ONE of thirteen readers at
//      the VALUE; the PRE-slice anchor is DRIVEN to a match (D510); the group shift
//      is driven; and the non-Energy noun is driven to a LOUD refusal.
//   §3 the BOARD — the partition, the caps, and `validateChoice` separating the four
//      answers the print distinguishes: distinct, same-type, fewer, and NONE.
//   §4 the CENSUS — the residue step, the lattice both ways, and the version.

/** The printed sentence, byte for byte off `censusAttackCorpus.ts` FILE LINE 473. */
const PRINTED =
  "Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.";

/** FILE LINE 474 — the same sentence WITHOUT the constraint, built since D231 and the
    only point of §4's lattice that built before this slice at Hamming weight ONE. It
    is the control for every rung below: a build that ignored the printed phrase would
    make these two derive to the same program, and half this file would go quiet. */
const SIBLING =
  "Search your deck for up to 3 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.";

/** FILE LINE 472 — the OTHER printing of the phrase, and it stays UNBUILT. Its
    blocker is not this one: the `Tera` banner is data (no `cardSchema` key classifies
    it, off the table for 49 slices) AND `DECK_SEARCH_ATTACH` welds `Energy cards and
    attach them`, so that pattern does not admit the phrase at all. **The two rows are
    blocked at DIFFERENT LAYERS**, which is why building one says nothing about the
    other and is asserted rather than assumed. */
const TERA_TWIN =
  "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.";

/** The printed noun carrying the phrase on a head the partition cannot key — the
    LOUD refusal, and a sentence the column prints ZERO times (§1 measures it). */
const WRONG_NOUN =
  "Search your deck for up to 3 Pokémon of different types, reveal them, and put them into your hand. Then, shuffle your deck.";

/** The twelve readers this sentence must NOT reach, so §2 asserts a NAMED owner plus
    twelve kept refusals rather than a bare `resolvedByAnyReader` (D438: a negative
    over a disjunction is a claim about every disjunct; its positive replacement is a
    claim about none of them). */
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
    filter: { kind: "basicEnergy" },
    dest: "hand",
    max: 3,
    reveal: true,
    distinctEnergyTypes: true,
  },
  { op: "shuffleDeck" },
];

// ─────────────────────────────────────────────────────────────────────────────
// The board. `d513-*` keys with no catalog row behind them, kept out of
// `FIXTURE_POOL` entirely by the file-local pool below (D414/D452/D465), so every
// id ladder in the repo takes a ZERO term from this slice.
// ─────────────────────────────────────────────────────────────────────────────

const CRYSTAL = 0;
const PLAIN = 1;
const ODD = 2;

const D513_CARDS: Record<string, Card> = {
  /** 🛑 A FOURTH BASIC ENERGY TYPE, AND IT IS WHAT MAKES §3's TOTAL RUNG NON-VACUOUS.
      With three cells the printed ceiling of 3 and the SUM of the caps are the same
      number, so a build that spelled the partition as `also` — where the park derives
      `max` as that sum — would pass every rung on a three-type board. Four cells
      separate them: the total stays the printed 3 and the sum is 4. `typedEnergy`'s
      NAME is the datum (`energyProvidesOf` parses it), so this is a real Grass. */
  "d513-grass-energy": typedEnergy("d513-grass-energy", "Grass"),
  "d513-sylveon": battler("d513-sylveon", {
    name: "D513 Sylveon",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      // 🛑 THE PRINTED BYTES, and D183's rule is why they are a constant rather than
      // retyped here: an arm authored from a PARAPHRASE passes a test written against
      // the same paraphrase and matches no real card.
      { cost: ["Colorless"], name: "Crystal Wing", effect: PRINTED },
      // The built sibling — the control that separates "the phrase was read" from
      // "a search was parked" on every rung in §3.
      { cost: ["Colorless"], name: "Plain Wing", effect: SIBLING },
      // The LOUD refusal, printed on a body that can actually attack, because a
      // guard nothing reaches is a guard nobody can trust (D200→D214).
      { cost: ["Colorless"], name: "Odd Wing", effect: WRONG_NOUN },
    ],
  }),
};

const D513_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D513_CARDS };

/** 🛑 THE DECK IS THE EXPERIMENT AND ITS COUNTS ARE LOAD-BEARING. THREE basic Energy
    types with a DUPLICATE in each: `fix-fire-energy` and `fix-water-energy` are
    `typedEnergy` (their NAME is the datum, so two copies of one id are two uids of the
    SAME type), and `fix-energy` is an unnamed Basic whose provision falls back to
    Colorless — the third cell, and the one that drives `energyProvidesOf`'s fallback
    branch rather than leaving it to the catalog.

    Three cells at ≥2 copies each is the minimum that separates all four answers the
    print distinguishes: a 3-pick that is type-distinct, a 2-pick that is NOT, a
    shorter pick, and none. A deck with one copy per type would make the same-type
    answer unreachable and half of §3 vacuous. 60 counted before the first run. */
const D513_DECK = deckOf({
  "d513-sylveon": 8,
  "fix-basic-1": 8,
  "fix-fire-energy": 9,
  "fix-water-energy": 9,
  "d513-grass-energy": 9,
  "fix-energy": 9,
  "fix-item": 8,
});

function openTable(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: D513_DECK, p2: D513_DECK },
    cardPool: D513_POOL,
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
    Bench — the search puts cards into the HAND, so a Bench body would only add noise
    to the zone assertions in §3. */
function canonical(seed = 31): GameState {
  let state = setActiveFromDeck(openTable(seed), "p1", "d513-sylveon");
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

/** The provided type of a uid — the same function the park partitions by and the same
    one `matchesFilter`'s `basicEnergy` arm reads for `filter.energyType`. */
const typeOf = (state: GameState, uid: string): string =>
  energyProvidesOf(D513_POOL[state.cardIdByUid[uid] as string] as Card);

/** N uids off the prompt, all of DIFFERENT provided types. */
function distinctPick(state: GameState, n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const uid of cardsPrompt(state).candidates) {
    const t = typeOf(state, uid);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(uid);
    if (out.length === n) break;
  }
  if (out.length < n) throw new Error(`board offers only ${out.length} distinct types`);
  return out;
}

/** TWO uids off the prompt sharing one provided type — the answer the print refuses,
    and the whole reason the deck carries duplicates. */
function sameTypePair(state: GameState): string[] {
  const byType = new Map<string, string[]>();
  for (const uid of cardsPrompt(state).candidates) {
    const t = typeOf(state, uid);
    byType.set(t, [...(byType.get(t) ?? []), uid]);
  }
  const pair = [...byType.values()].find((uids) => uids.length >= 2);
  if (pair === undefined) throw new Error("board offers no same-type pair");
  return pair.slice(0, 2);
}

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } }).state;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed sentence, its population, and the absences the axes owe.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the population, and the absences", () => {
  it("🛑 ONE corpus row, ONE legal printing, and the byte delta from the sibling is the PHRASE", () => {
    const printed = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(printed.get(PRINTED)).toBe(1);
    // …and the sibling is a row of the same column, so the pair is a MINIMAL PAIR off
    // the catalog rather than one printed sentence and one invented twin (D427/D456).
    expect(printed.get(SIBLING)).toBe(1);
    expect(printed.get(TERA_TWIN)).toBe(1);
    // 🛑 THE WHOLE DELTA, AS BYTES. `SIBLING` with the phrase spliced back in front of
    // the reveal clause is `PRINTED` exactly — so every axis this slice reads is that
    // one span, and a successor cannot mistake some other clause for the subject.
    expect(SIBLING.replace(" cards,", " cards of different types,")).toBe(PRINTED);
    expect(PRINTED.replace(" of different types", "")).toBe(SIBLING);
  });

  it("🛑 the two measurements §4's flip table says this slice OWES", () => {
    const rows = legalAttackCorpus();
    expect(rows).toHaveLength(640);
    // ⓐ THE PHRASE prints on exactly TWO rows, and BOTH are `Basic Energy cards` — so
    // the rider being defined over one noun refuses nothing the column carries.
    const phrase = rows.filter(([, s]) => s.includes("of different types"));
    expect(phrase.map(([, s]) => s).sort()).toEqual([PRINTED, TERA_TWIN].sort());
    expect(phrase.every(([, s]) => s.includes("Basic Energy cards of different types"))).toBe(true);
    // ⓑ …and NO OTHER SPELLING of a distinctness relation is printed at all: the word
    // "different" appears on exactly those two rows. **`WRONG_NOUN` is printed ZERO
    // times**, which is what makes §2's loud refusal a guard on a future print rather
    // than on a current one.
    expect(rows.filter(([, s]) => s.includes("different"))).toHaveLength(2);
    expect(printedCount(rows, WRONG_NOUN)).toBe(0);
  });

  it("the fixture pool is FILE-LOCAL, so no id ladder in the repo moves", () => {
    // D414/D452/D465 — a `FIXTURE_POOL` id is a census entry with a tax of its own.
    // This slice pays ZERO of it, and that is asserted rather than intended.
    for (const id of Object.keys(D513_CARDS)) expect(FIXTURE_POOL[id]).toBeUndefined();
    expect(D513_DECK).toHaveLength(60);
  });
});

function printedCount(rows: readonly (readonly [number, string])[], text: string): number {
  return rows.filter(([, s]) => s === text).reduce((sum, [n]) => sum + n, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the resolver: who claims it, what the PRE-slice anchor did, and the refusal.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the resolver, the anchor that was never the blocker, and the refusal", () => {
  it("🛑 exactly ONE of thirteen readers claims it, at the VALUE", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    for (const reader of OTHERS)
      expect([reader.name, reader(PRINTED)]).toEqual([reader.name, null]);
    // …and neither splitter claims it either, which matters here rather than being a
    // formality: this sentence HAS a second depth-0 segment (*"Then, shuffle your
    // deck."*), so the trailing splitter is a reader with a real opportunity to take
    // the tail (D503/D505). It declines, so `builds()`'s four arms reduce to one.
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("🛑 THE PRE-SLICE ANCHOR *MATCHED* — the blocker was the NOUN TABLE (D510), DRIVEN", () => {
    // 🛑 THIS IS THE FINDING, AND IT IS A TEST RATHER THAN A CLAIM. D510's rule is
    // *"exec the family's shipped anchors against the printed bytes BEFORE pricing the
    // slice"*, and it answers here the same way it answered there. The pattern below
    // is `ATTACK_HAND_SEARCH` **as it stood at D231**, re-transcribed with group 5
    // removed — the exact bytes this slice edited.
    const BEFORE = new RegExp(
      "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
        "|up to (\\d+) ([^,.]+?)(, reveal them,)? and put them)" +
        " into your hand\\. Then, shuffle your deck\\.$",
    );
    const before = BEFORE.exec(PRINTED);
    // It MATCHES, and the noun group swallowed the phrase whole — because `[^,.]`
    // excludes a comma and a period and the printed phrase contains neither.
    expect(before).not.toBeNull();
    expect(before?.[4]).toBe("Basic Energy cards of different types");
    // …so the sentence reached the reader and died at the closed TABLE, one step
    // later. The proof that the table is what refused it: the captured phrase is not
    // a key the sibling's own noun is, and the sibling's noun IS.
    expect(before?.[4]).not.toBe("Basic Energy cards");
    expect(BEFORE.exec(SIBLING)?.[4]).toBe("Basic Energy cards");
    // 🛑 AND THE NEW GROUP ADMITS NOTHING THE OLD PATTERN REFUSED — the claim that
    // makes "new NAME, not new MACHINE" honest, measured over all 640 legal rows
    // rather than argued from the regex. The optional group sits BETWEEN the lazy noun
    // and the reveal clause, so with the group absent the pattern is the old one byte
    // for byte; the two match sets are IDENTICAL.
    const AFTER = new RegExp(
      "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
        "|up to (\\d+) ([^,.]+?)( of different types)?(, reveal them,)? and put them)" +
        " into your hand\\. Then, shuffle your deck\\.$",
    );
    const corpus = legalAttackCorpus().map(([, s]) => s);
    const oldMatches = corpus.filter((s) => BEFORE.test(s));
    expect(oldMatches.length).toBeGreaterThan(0);
    expect(corpus.filter((s) => AFTER.test(s))).toEqual(oldMatches);
    // …and the PATTERN's match set is strictly LARGER than the reader's claimed set,
    // which is the positive form of "the table is the refusal": these sentences all
    // reach the arm and are turned away by `HAND_SEARCH_PLURAL` having no row, exactly
    // as `:473` was until this slice.
    const stillRefused = oldMatches.filter((s) => deriveAttackEffect(s) === null);
    expect(stillRefused.length).toBeGreaterThan(0);
    expect(stillRefused).not.toContain(PRINTED);
  });

  it("🛑 the GROUP SHIFT is driven: `reveal` still rides the plural clause", () => {
    // ⚠️ D458 — inserting a capture group is a RE-TRANSCRIPTION EVENT. The plural
    // reveal clause moved from group 5 to group 6, and an arm reading the old index
    // would silently drop `reveal` off every plural printing in the family. These four
    // separate the two indices: with and without the phrase, with and without reveal.
    const revealed = (text: string) =>
      (deriveAttackEffect(text)?.[0] as { reveal?: true } | undefined)?.reveal;
    expect(revealed(PRINTED)).toBe(true);
    expect(revealed(SIBLING)).toBe(true);
    expect(
      revealed(
        "Search your deck for up to 3 Basic Energy cards of different types and put them into your hand. Then, shuffle your deck.",
      ),
    ).toBeUndefined();
    expect(
      revealed(
        "Search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
      ),
    ).toBeUndefined();
    // …and the SINGULAR index is untouched, which is the half that was already correct
    // and is the control D412's rule requires: driving only the changed half proves
    // the new code runs and stays green through the whole defect.
    expect(
      revealed(
        "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.",
      ),
    ).toBe(true);
  });

  it("🛑 a NON-ENERGY noun carrying the phrase is a LOUD refusal, not an approximation", () => {
    // The partition key is `energyProvidesOf`, which answers for an Energy card and
    // for nothing else, so a Pokémon-headed distinctness has nothing to be distinct
    // OVER. Deriving it anyway would cap every Pokémon into its own cell and quietly
    // let the player take three of a kind — a wrong-but-plausible program, which
    // D190b/D199 rank strictly worse than an unbuilt one.
    expect(deriveAttackEffect(WRONG_NOUN)).toBeNull();
    // …and the control that makes that a statement about the PHRASE rather than about
    // the noun: the same noun WITHOUT the phrase builds, and has since D231.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 3, reveal: true },
      { op: "shuffleDeck" },
    ]);
    // …and a TYPED Energy noun still resolves, because its filter is `basicEnergy`
    // however narrow: the guard is on the KIND, not on the exact filter value.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 3 Basic {G} Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        dest: "hand",
        max: 3,
        reveal: true,
        distinctEnergyTypes: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 the TERA TWIN stays unbuilt, and its blocker is a DIFFERENT LAYER", () => {
    // FILE LINE 472 prints the same phrase and is NOT collected by this slice. The
    // reason is not the banner alone: `DECK_SEARCH_ATTACH` welds `Energy cards and
    // attach them`, so the attach pattern does not admit the phrase AT ALL — unlike
    // `ATTACK_HAND_SEARCH`'s open noun group, which admitted it from the first day.
    // **Two rows, one phrase, two different layers of refusal**, which is why building
    // one says nothing about the other.
    expect(deriveAttackEffect(TERA_TWIN)).toBeNull();
    expect(resolvedByAnyReader(TERA_TWIN)).toBe(false);
    // …and the minimal pair that isolates the anchor half from the banner half:
    // dropping ONLY the banner still derives to null, so the phrase really is a second
    // blocker there rather than the banner being the whole story.
    expect(deriveAttackEffect(TERA_TWIN.replace(" Tera", ""))).toBeNull();
    // …while dropping ONLY the phrase leaves a sentence that has built since D235.
    expect(
      deriveAttackEffect(TERA_TWIN.replace(" of different types", "").replace(" Tera", "")),
    ).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: the partition, the caps, and the four separated answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the partition, the caps, and the four answers the print separates", () => {
  it("🛑 the park carries ONE cap of ONE per provided type, and the cells PARTITION the offer", () => {
    const state = attack(canonical(), CRYSTAL);
    const prompt = cardsPrompt(state);
    const caps = prompt.caps ?? [];
    // FOUR cells, because the deck holds four provided types among Basic Energy —
    // Fire, Water, Grass and the Colorless fallback.
    expect(caps).toHaveLength(4);
    expect(caps.map((c) => c.max)).toEqual([1, 1, 1, 1]);
    // 🛑 A PARTITION, ASSERTED IN BOTH DIRECTIONS: the cells COVER the candidates and
    // are pairwise DISJOINT. Either half alone would pass under a real defect — a
    // cover that overlapped would refuse a legal pick, and disjoint cells that missed
    // a uid would admit an illegal one.
    const inCells = caps.flatMap((c) => [...c.uids]);
    expect([...inCells].sort()).toEqual([...prompt.candidates].sort());
    expect(new Set(inCells).size).toBe(inCells.length);
    // …and each cell is exactly one provided type, which is the property the caps
    // MEAN. A cell holding two types would cap a legal answer.
    for (const cell of caps) {
      expect(new Set(cell.uids.map((uid) => typeOf(state, uid))).size).toBe(1);
    }
    expect(new Set(caps.map((c) => typeOf(state, c.uids[0] as string))).size).toBe(4);
    // …including the FALLBACK cell: `fix-energy` is an unnamed Basic whose provision
    // `energyProvidesOf` cannot parse, so it answers "Colorless". That branch is
    // driven here rather than left to the catalog, because a partition that silently
    // dropped it would leave uids in no cell at all — which the cover rung above
    // would catch, and which this names.
    expect(caps.some((c) => typeOf(state, c.uids[0] as string) === "Colorless")).toBe(true);
    // …and the TOTAL is the printed 3, NOT the sum of the caps. This is the whole
    // reason the rider is a new key rather than nine `also` groups: the park derives
    // `max` as the SUM of the group maxes, so spelling the partition as `also` would
    // have turned the printed ceiling of 3 into 3-and-only-by-accident here and into 9
    // on a full nine-type deck. The floor is 0 — the printed *"up to"*.
    expect([prompt.min, prompt.max]).toEqual([0, 3]);
    // 🛑 AND THE TWO NUMBERS GENUINELY DIFFER ON THIS BOARD — 3 against 4 — which is
    // what makes the rung a measurement rather than a coincidence. A three-cell deck
    // would make them equal and an `also`-shaped build would pass.
    expect(caps.reduce((sum, c) => sum + c.max, 0)).toBe(4);
    expect(prompt.max).not.toBe(caps.reduce((sum, c) => sum + c.max, 0));
  });

  it("🛑 the SIBLING parks with NO caps at all — the control that makes the rung above about the PHRASE", () => {
    // D135's absent-key rule, and the reason `caps` is spread conditionally: an
    // `undefined` value is not the same wire datum as no key, and these prompts are
    // compared by value. A build that emitted caps unconditionally would pass every
    // rung above and break this one.
    const prompt = cardsPrompt(attack(canonical(), PLAIN));
    expect("caps" in prompt).toBe(false);
    expect([prompt.min, prompt.max]).toEqual([0, 3]);
    // …and the candidate sets are IDENTICAL, so the two prompts differ in the caps and
    // in nothing else. The filter did not move; only the relation among the picks did.
    const distinct = cardsPrompt(attack(canonical(), CRYSTAL));
    expect([...prompt.candidates].sort()).toEqual([...distinct.candidates].sort());
  });

  it("🛑 the FOUR answers, separated by a real board rather than by argument", () => {
    // ⚠️ "up to 3 … of different types" means *the picks are PAIRWISE TYPE-DISTINCT*,
    // NOT *three types appear*. The difference between a rule and a bug, and it is
    // separated here by FIXTURE rather than by wording: the two short answers below
    // are legal and would be rejected by a build that read the print as a floor.
    const state = attack(canonical(), CRYSTAL);
    const three = distinctPick(state, 3);
    const one = distinctPick(state, 1);
    const same = sameTypePair(state);

    // ⓐ three of different types — the full printed take.
    expect(new Set(three.map((uid) => typeOf(state, uid))).size).toBe(3);
    const took = resolve(state, three);
    for (const uid of three) expect(took.players.p1.hand).toContain(uid);
    for (const uid of three) expect(took.players.p1.deck).not.toContain(uid);
    // ⓑ TWO OF ONE TYPE — REJECTED. This is the rung the whole slice exists for, and
    // it is a wire-level refusal: `validateChoice` matches the answer against the
    // PROMPT and nothing else, so a cap the prompt did not carry is a cap a crafted
    // frame walks past (D332's own words).
    expect(new Set(same.map((uid) => typeOf(state, uid))).size).toBe(1);
    expectErr(
      state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: same } },
      "BAD_EFFECT_CHOICE",
    );
    // ⓒ FEWER — legal, because the print says *"up to"*.
    expect(resolve(state, one).players.p1.hand).toContain(one[0]);
    // ⓓ NONE — legal too, and the floor is what says so.
    const declined = resolve(state, []);
    expect(declined.phase.kind).not.toBe("effect:choose");
    expect(declined.players.p1.hand).toHaveLength(state.players.p1.hand.length);
  });

  it("🛑 the SAME pair is ACCEPTED without the phrase — the caps are what refuse it", () => {
    // The other half of the discrimination (D412's three-case rule): drive the case
    // that was already correct, or a build that rejected same-type pairs EVERYWHERE
    // would pass the rung above. Same board, same uids, different printed sentence.
    const plain = attack(canonical(), PLAIN);
    const same = sameTypePair(plain);
    expect(new Set(same.map((uid) => typeOf(plain, uid))).size).toBe(1);
    const took = resolve(plain, same);
    for (const uid of same) expect(took.players.p1.hand).toContain(uid);
  });

  it("🛑 the CAPTION carries the printed phrase, and it ROUND-TRIPS off the printed bytes", () => {
    // ⚠️ D342's recorded failure, one caption over: a heading that reads *"up to 3
    // Basic Energy cards"* over a dialog that rejects a second Fire is the dialog
    // contradicting itself in its own words, and the player has no other way to learn
    // why the pick was refused.
    //
    // 🛑 THE ASSERTION IS A ROUND TRIP RATHER THAN A LITERAL, which is what keeps
    // `effects.ts`'s noun table and `interpreter.ts`'s caption in step across two files
    // that cannot import each other: the expected string is RECONSTRUCTED from the
    // PRINTED sentence by deleting exactly the two clauses the caption does not carry
    // (the optional opener and the reveal), so it goes red from either side. That the
    // phrase survives both deletions is not luck — it sits between them.
    const noteFromPrint = (text: string) =>
      text
        .replace(/^You may search/, "Search")
        .replace(/, reveal (?:it|them),/, "")
        .replace(
          / and put (?:it|them) into your hand\. Then, shuffle your deck\.$/,
          " into your hand.",
        );
    expect(cardsPrompt(attack(canonical(), CRYSTAL)).note).toBe(noteFromPrint(PRINTED));
    expect(cardsPrompt(attack(canonical(), PLAIN)).note).toBe(noteFromPrint(SIBLING));
    // …and the reconstruction is not a tautology: it really does delete two clauses
    // and keep the phrase.
    expect(noteFromPrint(PRINTED)).toBe(
      "Search your deck for up to 3 Basic Energy cards of different types into your hand.",
    );
    expect(noteFromPrint(SIBLING)).toBe(
      "Search your deck for up to 3 Basic Energy cards into your hand.",
    );
  });

  it("🛑 the ODD noun never parks at all — the loud path, on a real board", () => {
    // The refusal §2 drives at the reader, driven again at the TABLE, because a
    // sentence no reader claims must leave through `ATTACK_EFFECT_SKIPPED` rather than
    // parking something. This is the rung that makes the guard reachable.
    const state = attack(canonical(), ODD);
    expect(state.phase.kind).not.toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the census step, the lattice, the record version, and the engine version.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the census step this slice is", () => {
  it("🛑 the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    const claimed = legalAttackCorpus().filter(([, s]) =>
      JSON.stringify(deriveAttackEffect(s) ?? []).includes("distinctEnergyTypes"),
    );
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(1);
    // …and the whole-corpus delta equals the slice (D439): the new optional group is
    // the only pattern byte that moved, and it matches a phrase one other corpus row
    // carries — on a sentence a DIFFERENT anchor owns, which is why that row did not
    // come along and §2 drives it.
    expect(resolvedByAnyReader(TERA_TWIN)).toBe(false);
  });

  it("🛑 the lattice, run BOTH WAYS and keyed on the DERIVED VALUE (D491/D503/D505)", () => {
    // FIVE binary axes — NOUN × DISTINCTNESS × REVEAL × OPENER × COUNT — and a lattice
    // run in the build's own commit is not the lattice (D491), so the PRE-state is
    // derived by SUBTRACTING what this slice's KEY claims rather than by remembering
    // it, and keyed on the derived VALUE rather than on the (module-private) anchor
    // (D505). Bit 0 of every axis is the PRINTED value.
    const NOUNS = ["Basic Energy cards", "Pokémon"];
    const DISTINCTS = [" of different types", ""];
    const REVEALS = [", reveal them,", ""];
    const OPENERS = ["Search", "You may search"];
    const COUNTS = ["3", "2"];
    const point = (m: number) =>
      `${OPENERS[(m >> 3) & 1]} your deck for up to ${COUNTS[(m >> 4) & 1]} ${NOUNS[m & 1]}${DISTINCTS[(m >> 1) & 1]}${REVEALS[(m >> 2) & 1]} and put them into your hand. Then, shuffle your deck.`;
    const points = Array.from({ length: 32 }, (_, i) => point(i));
    expect(new Set(points).size).toBe(32);
    expect(points[0]).toBe(PRINTED);
    expect(points[2]).toBe(SIBLING);

    // ⓐ the READERS-ONLY reading.
    const built = points.filter((s) => resolvedByAnyReader(s));
    expect(built).toHaveLength(24);
    // ⓑ the RESIDUE-PREDICATE reading — `builds()`'s other three arms. ⚠️ THIS IS NOT A
    // FORMALITY HERE (D505's refinement): every point has a SECOND depth-0 segment
    // whose tail a reader could claim, so the trailing splitter has a real opportunity
    // at all 32 points. It declines at every one, and so does the gate splitter — 64
    // checks — so the two readings are provably identical rather than identical by
    // luck, and no point is a REGISTRY sentence either.
    for (const s of points) {
      expect([s, splitAttackGateClause(s)]).toEqual([s, null]);
      expect([s, splitAttackTrailingClause(s)]).toEqual([s, null]);
    }
    // ⓒ the PRE-state: subtract the points this slice's key claims.
    const claims = (s: string) =>
      JSON.stringify(deriveAttackEffect(s) ?? []).includes("distinctEnergyTypes");
    const before = points.filter((s) => resolvedByAnyReader(s) && !claims(s));
    expect(before).toHaveLength(16);
    // …and the converse, or the subtraction is circular (D505): the claimed set is
    // EXACTLY the eight points that moved, and they are exactly the points where the
    // DISTINCTNESS axis is printed and the NOUN is the Energy one.
    const moved = points.filter((s) => claims(s));
    expect(moved).toHaveLength(8);
    expect(moved.every((s) => s.includes("Basic Energy cards of different types"))).toBe(true);
    expect(built.length - before.length).toBe(moved.length);

    // 🛑 THE FLIP TABLE, READ AS A PRICE (D508), AND RUN ON BOTH STATES — because this
    // lattice CHANGES SHAPE across the slice, which is the finding.
    const flips = (claimed: (s: string) => boolean) =>
      [0, 1, 2, 3, 4].map((ax) => {
        let n = 0;
        for (let m = 0; m < 32; m++) {
          if ((m >> ax) & 1) continue;
          if (claimed(point(m)) !== claimed(point(m | (1 << ax)))) n++;
        }
        return n;
      });
    const wasBuilt = (s: string) => resolvedByAnyReader(s) && !claims(s);
    // PRE — `0/1 · 1/5 · 4/10 · 6/10 · 4/5 · 1/1` = 16 of 32, and the flip table is
    // DISTINCTNESS 16/16 with FOUR axes at ZERO. **That is D505's seventh shape
    // exactly**: one blocking axis on an otherwise free 2⁴, the signature of a row
    // whose blocker is a NAME rather than a machine — which is precisely what §2
    // found at the anchor, from a different instrument.
    expect(flips(wasBuilt)).toEqual([0, 16, 0, 0, 0]);
    // POST — the NOUN axis is no longer free: the guard that refuses a non-Energy
    // distinctness makes it load-bearing, at 8/16, and DISTINCTNESS falls to 8/16 in
    // the same move. **That is D507's eighth shape, a CONJUNCTIVE PAIR** — a point
    // builds only where the noun is the Energy one OR the phrase is absent.
    expect(flips(resolvedByAnyReader)).toEqual([8, 8, 0, 0, 0]);
    // 🛑 **A LATTICE THAT CHANGES SHAPE ACROSS ITS OWN SLICE IS THE FINDING, AND IT IS
    // A PRICE.** D505's rule says a 0/16 axis is FREE to spell and every axis that
    // flips anywhere is a literal owing a *"printed zero times"* measurement. Before
    // this slice the NOUN axis was free and owed nothing; the guard made it live, so
    // it owes exactly ONE measurement — and §1 pays it (`WRONG_NOUN` is printed 0
    // times over all 640 rows). **The guard's whole price is that one measurement**,
    // and the flip table is what says so rather than a judgement.
    //
    // ⚠️ INERT IS NOT DEGENERATE (D491/D505/D508): all 32 points are distinct strings,
    // asserted above, so the three zero axes are inert on the VERDICT and not identical
    // spellings reported twice.
    expect(new Set(points.map((s) => s.length)).size).toBeGreaterThan(1);
  });

  it("🛑 `MATCH_RECORD_VERSION` HOLDS at 30, and the LOSS DIRECTION is DRIVEN", () => {
    // 🛑 THE DOOR, NAMED. `searchDeck` PARKS, so unlike a damage fold this op genuinely
    // reaches persisted storage: its literal rides `EffectContinuation.pendingOp`
    // inside `MatchRecord.state.phase.cont` (D457 — the park IS the road to storage).
    // So the fold-shaped argument D508/D512 used is NOT available here and is not
    // inherited; the question is D125's widening test, asked at a real address.
    const parked = attack(canonical(), CRYSTAL);
    const cont = continuation(parked);
    expect((cont.pendingOp as { op: string }).op).toBe("searchDeck");
    expect((cont.pendingOp as { distinctEnergyTypes?: true }).distinctEnergyTypes).toBe(true);

    // D125's test is *"can the PREVIOUS deploy's RECORD hold the new TYPE"* — i.e.
    // would an old record MEAN something else under this build. A v30 record carries
    // NO `distinctEnergyTypes`, because no v30 program could set the key. **Driven
    // rather than argued**: strip the key from the persisted op, resume, and the park
    // is byte-identical to what v30 meant — one flat cap, no partition.
    const { distinctEnergyTypes: _dropped, ...v30Op } = cont.pendingOp as EffectOp & {
      distinctEnergyTypes?: true;
    };
    const resumed = runProgram(parked, [v30Op as EffectOp], cont.ctx, []);
    if (resumed.kind !== "parked" || resumed.prompt.kind !== "chooseCards") {
      throw new Error("expected the v30 op to park a chooseCards");
    }
    const v30Prompt = resumed.prompt;
    expect("caps" in v30Prompt).toBe(false);
    expect([v30Prompt.min, v30Prompt.max]).toEqual([0, 3]);
    // …and it is the SAME prompt the sibling parks, which is the positive form of
    // "the old bytes mean what they always meant": v30's records and today's
    // unconstrained printing agree at the value.
    const sibling = cardsPrompt(attack(canonical(), PLAIN));
    expect([...v30Prompt.candidates].sort()).toEqual([...sibling.candidates].sort());
    expect(v30Prompt.note).toBe(sibling.note);
    // ⚠️ AND THE CONVERSE IS WHAT MAKES THE ABOVE A MEASUREMENT: the key is not inert.
    // With it present the same continuation parks caps, so "absent means unconstrained"
    // is a statement about behaviour rather than about a spread.
    expect(cardsPrompt(parked).caps).toHaveLength(4);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});
