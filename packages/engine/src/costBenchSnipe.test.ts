import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 0.374.0 → 0.375.0 — 🆕🆕🆕 D477: THE SELF-DISCARD COST IN FRONT OF A **BENCHED**
// SNIPE — the BENCH twin of D401's any-target compound.
//
//   file line  92 (2 printings)  "Discard 2 Energy from this Pokémon. This attack also
//                                 does 120 damage to 1 of your opponent's Benched
//                                 Pokémon. (Don't apply …)"
//   file line 109 (2 printings)  "Discard all Energy from this Pokémon, and this attack
//                                 also does 90 damage to 1 of your opponent's Benched
//                                 Pokémon. (Don't apply …)"
//   file line 121 (1 printing)   "Discard all {R} Energy from this Pokémon, and this
//                                 attack does 180 damage to 1 of your opponent's Benched
//                                 Pokémon. (Don't apply …)"
//
// 3 sentences / 5 legal printings over `legalAttackCorpus()`'s 640 / 1,732.
//
// 🛑 **ZERO NEW MECHANISM, AND THE WORK ORDER'S OWN HYPOTHESIS UNDER-COUNTED THE HAUL
// RATHER THAN OVER-COUNTING IT.** The brief named a cluster of THREE opaque rows and
// asked which of them was cheapest. Two of the three are here; the third (file line 111,
// the `ex` narrowing) is priced and LEFT. **The row that pays for the slice is one the
// brief never mentions** — file line 92, which was not in the instrument's `OPAQUE`
// section at all, because `residue-census.ts` had already classified it as the residue's
// ONE AND ONLY `COMPOSE` row (both halves build; only the join is missing). D459's own
// table calls `COMPOSE` *"the only class whose price is actually known"*, and it was sat
// in the classified half of the output while the brief was reading the unclassified half.
//
// 🛑 **AND `also` WAS NEVER A BLOCKER.** The brief diffed line 109 against the built
// neighbour and named two deltas, `also` and `Benched`. `ALSO_BENCHED_SNIPE_BODY` has
// spelled `(?:also )?` since D447 — the word is dropped on `SPREAD_EACH_BENCH`'s argument
// and derives the same op either way — so the ONLY thing refusing these three rows was
// the ZONE. §3 measures it: strip `also` from line 109 and the sentence is refused
// identically at D476's head, which is D447's *strip the token and re-ask the readers*
// run against a co-occurring token one family over.
//
// 🛑 **THE PARENTHETICAL IS THE ANCHOR'S, AND IT IS ALSO WHY LINE 92 COULD NOT COMPOSE.**
// The brief asked whether the trailing *"(Don't apply …)"* belongs to the anchor or is
// split off by `splitAttackTrailingClause`. Both, and that is one fact seen twice: every
// anchor in this family spells it as an optional trailing group, while
// `COMPOUND_CLAUSE_BREAK` splits before an opening paren — so line 92 splits into THREE
// parts and the splitter's tail is the parenthetical, which no reader claims. §4 drives
// it. The rival slice (teach the splitter to re-join a trailing parenthetical) was
// measured over the whole column at **1 sentence / 2 printings** — D447's own verdict on
// a mirror splitter, *"does not pay"* — against this anchor's 3 / 5.
//
// ⚠️ **NOTHING BELOW `deriveAttackEffect` MOVED.** No new `EffectOp` member, op FIELD, op
// VALUE, prompt, choice, event, error code, registry row, `packages/schema` byte or
// `redact.ts` byte; no interpreter byte at all — `snipeTargets`' total `switch` and
// `placeSnipe`'s ref-read bench victim are both D447's, and `opponentBench` is the oldest
// of the three `damageChosen.target` members. **NO NEW `FIXTURE_POOL` id**: the
// demonstrator lives in a file-local `cardPool` (D414/D452), so every id ladder takes a
// ZERO term.

const PURGE_SEED = 477_0477;

/** Corpus FILE LINE 92, byte for byte. The `. This` join and a NUMERIC cost. */
const TWO_THEN_120 =
  "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** Corpus FILE LINE 109, byte for byte. The `, and this` join and an `all` cost. */
const ALL_THEN_90 =
  "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** Corpus FILE LINE 121, byte for byte. The TYPED cost, and the one member of the three
    that prints NO `also` — so the two axes are crossed inside the printed set rather
    than only in the anchor. */
const TYPED_THEN_180 =
  "Discard all {R} Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** Corpus FILE LINE 110 — D401's ANY-target sibling, BUILT since that slice. It is the
    control this whole file turns on: the same head, the same cost, and the one printed
    word that decides whether the Active is a candidate. */
const ALL_THEN_ANY_120 =
  "Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** Corpus FILE LINE 111 — the fourth member of the printed family, LEFT UNBUILT and
    priced in §1. Its `ex` narrows the candidate CLASS, which `damageChosen`'s five
    riders cannot spell (D472). */
const EX_THEN_210 =
  "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const PURGE_ALL = 0;
const PURGE_TWO = 1;
const PURGE_TYPED = 2;
const PURGE_ANY = 3;
const PURGE_NONE = 4;

/** `fix-*`-shaped keys with no catalog row behind them (D425), kept out of
    `FIXTURE_POOL` entirely by a file-local `cardPool` (D414/D452).
    ⚠️ The three benched bodies carry THREE DIFFERENT HP values and are given THREE
    DIFFERENT starting damages by §5, because a snipe suite whose bench is uniform cannot
    tell *picked the wrong body* from *defaulted to the first* from *hit the Active* —
    all three answer the same numbers on a flat bench. */
const PURGE_CARDS: Record<string, Card> = {
  "d477-purger": battler("d477-purger", {
    name: "D477 Purger",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Ashfall", damage: 30, effect: ALL_THEN_90 },
      { cost: ["Colorless"], name: "Twin Purge", damage: 30, effect: TWO_THEN_120 },
      // No printed `damage`: this sentence carries no `also`, so the snipe IS the attack.
      { cost: ["Colorless"], name: "Emberdump", effect: TYPED_THEN_180 },
      // D401's shipped ANY-target sibling — the control, one printed word away.
      { cost: ["Colorless"], name: "Wide Purge", effect: ALL_THEN_ANY_120 },
      // No effect text at all: the control that separates "the program ran and found
      // nothing" from "no program ran" on the ZERO-MATCH board of §6.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 30 },
    ],
  }),
  /** The defender. Big enough that nothing in this suite Knocks it Out, so every number
      read off the board is a damage figure rather than a promotion. */
  "d477-wall": battler("d477-wall", { name: "D477 Wall", types: ["Colorless"], hp: 340 }),
  "d477-benchtall": battler("d477-benchtall", { name: "D477 Tall", types: ["Colorless"], hp: 330 }),
  "d477-benchmid": battler("d477-benchmid", { name: "D477 Mid", types: ["Colorless"], hp: 310 }),
  "d477-benchlow": battler("d477-benchlow", { name: "D477 Low", types: ["Colorless"], hp: 290 }),
};

const PURGE_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...PURGE_CARDS };

/** Its own deck (D270), 60 counted before the first run: 8 + 8 + 6 + 6 + 6 + 10 + 8 + 8.
    THREE Energy classes and that is load-bearing twice over: `Discard 2 Energy` at a
    single class of interchangeable candidates AUTO-RESOLVES (D464), so §7's park needs
    two classes on the body; and `Discard all {R} Energy` needs a NON-{R} card left
    standing afterwards or the type filter is unfalsifiable (D448). */
const PURGE_DECK = deckOf({
  "d477-purger": 8,
  "d477-wall": 8,
  "d477-benchtall": 6,
  "d477-benchmid": 6,
  "d477-benchlow": 6,
  "fix-energy": 10,
  "fix-fire-energy": 8,
  "fix-water-energy": 8,
});

function openPurgeTable(first: Seat): GameState {
  const created = createGame({
    seed: PURGE_SEED,
    decks: { p1: PURGE_DECK, p2: PURGE_DECK },
    cardPool: PURGE_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(
    applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }),
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
  return table;
}

/** p1 owns TURN 2 with the Purger Active. p2 goes first and ends turn 1 at once (§4
    forbids the going-first player's turn-1 attack). BOTH benches are cleared before
    anything is placed — every figure below is a population over a bench, so a body the
    setup shuffle happened to place would move an answer silently. */
function purgeTable(stock: readonly string[], oppBench: readonly string[]): GameState {
  let table = openPurgeTable("p2");
  table = mustApply(table, { type: "endTurn", seat: "p2" }).state;
  expect(table.turn).toBe(2);
  table = setActiveFromDeck(table, "p1", "d477-purger");
  table = setActiveFromDeck(table, "p2", "d477-wall");
  table = clearBench(table, "p1");
  table = clearBench(table, "p2");
  for (const card of stock) table = attachFromDeck(table, "p1", card, 1);
  for (const card of oppBench) table = benchFromDeck(table, "p2", card);
  return table;
}

/** The §5 board, spelled once: a DAMAGED defender and three benched bodies at three
    different HP with three different starting damages. Every wrong implementation this
    file can name answers a different vector. */
function loadBearingBoard(stock: readonly string[]): GameState {
  let table = purgeTable(stock, ["d477-benchtall", "d477-benchmid", "d477-benchlow"]);
  table = setDamage(table, "p2", 40);
  table = setBenchDamage(table, "p2", 0, 10);
  table = setBenchDamage(table, "p2", 1, 20);
  table = setBenchDamage(table, "p2", 2, 30);
  return table;
}

function swingPurge(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function benchDamages(state: GameState, seat: Seat): number[] {
  return state.players[seat].bench.map((pokemon) => pokemon.damage);
}

function activeDamage(state: GameState, seat: Seat): number {
  return state.players[seat].active?.damage ?? 0;
}

function eventTypes(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function dealtRows(events: GameEvent[]): { seat: Seat; by: Seat; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, by: e.by, dealt: e.dealt }] : [],
  );
}

/** Drains the self-discard park by taking the first `scope.count` candidates, and hands
    back the state the snipe then parks (or resolves) into. ⚠️ The count is READ off the
    prompt rather than written here: a hard-coded 2 would make this helper a second
    opinion about the printed quantifier, and the whole point of §7 is that the op's
    `count` comes from the anchor's first capture. */
function payTheCost(state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "discardEnergy") throw new Error(`expected discardEnergy, got ${prompt.kind}`);
  if (prompt.scope.kind !== "total") throw new Error("expected a total-scoped discard");
  const uids = prompt.discardable.slice(0, prompt.scope.count).map((offer) => offer.uid);
  if (uids.length < prompt.scope.count) throw new Error("a discardEnergy park short of offers");
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "discardEnergy", uids },
  });
}

function snipePrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
  }
  return prompt;
}

/** Answers the snipe park with the candidate at `pick`. */
function answerSnipe(state: GameState, pick: number) {
  const prompt = snipePrompt(state);
  const chosen = prompt.candidates[pick];
  if (chosen === undefined) throw new Error(`no candidate ${pick}`);
  return {
    prompt,
    ...mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [chosen as PokemonRef] },
    }),
  };
}

/** Counted by code point, the sibling suites' spelling. */
function utf8Length(text: string): number {
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    total += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return total;
}

const corpusRows = () => legalAttackCorpus();

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE POPULATION, MEASURED OFF THE COMMITTED COLUMN, AND THE FAMILY WHOLE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — three printed rows, and the family they belong to", () => {
  it("the column did not move, and each of the three is a corpus row at its printing count", () => {
    const rows = new Map(corpusRows().map(([units, sentence]) => [sentence, units]));
    expect(corpusRows()).toHaveLength(640);
    expect(corpusRows().reduce((n, [units]) => n + units, 0)).toBe(1732);
    expect(rows.get(TWO_THEN_120)).toBe(2);
    expect(rows.get(ALL_THEN_90)).toBe(2);
    expect(rows.get(TYPED_THEN_180)).toBe(1);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 3 AND 5** — D474's disagreed
    // at 1 and 2, D475's agreed at 1 and 1, D476's agreed at 1 and 1. Said out loud
    // because the term was DERIVED at every census site rather than carried from the two
    // slices that happened to share a shape (D451/D461/D464).
    expect([TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180]).toHaveLength(3);
    expect(
      [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180].reduce((n, s) => n + (rows.get(s) ?? 0), 0),
    ).toBe(5);
  });

  it("the bytes are the CORPUS's bytes, not a retyping, and every slot is U+0027", () => {
    // 🛑 D452's LESSON: a byte pin on a hand-typed string is green by construction, so the
    // pin is taken against the CORPUS ROW and not against the literal above.
    for (const printed of [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180, ALL_THEN_ANY_120]) {
      expect(corpusRows().some(([, s]) => s === printed), printed).toBe(true);
      expect(printed).not.toContain("’");
      expect(printed).toContain("'");
    }
    // Three `Pokémon` apiece — the cost's, the target's and the clarifier's — so each
    // UTF-8 figure runs three bytes ahead of the code-point count.
    expect(TWO_THEN_120).toHaveLength(168);
    expect(utf8Length(TWO_THEN_120)).toBe(171);
    expect(ALL_THEN_90).toHaveLength(173);
    expect(utf8Length(ALL_THEN_90)).toBe(176);
    expect(TYPED_THEN_180).toHaveLength(173);
    expect(utf8Length(TYPED_THEN_180)).toBe(176);
  });

  it("🛑 the WHOLE printed family is EIGHT rows, published as the pattern that was RUN", () => {
    // D425/D419: state the pattern, and state what it cannot see. This one is the
    // LOOSEST plausible shape — any self-discard head joined to any snipe — run over all
    // 640 rows rather than a list somebody thought of (D448).
    const family = corpusRows().filter(
      ([, s]) => /^Discard .* from this Pokémon[.,] (and )?[Tt]his attack .*damage to /.test(s),
    );
    expect(family).toHaveLength(8);
    expect(family.reduce((n, [units]) => n + units, 0)).toBe(13);
    // Four were already read by D401's `SELF_DISCARD_THEN_ANY_TARGET`; three are this
    // slice's; one is left. The partition is asserted so a ninth printed row cannot join
    // silently on either side.
    // 🆕🆕🆕 **D483 — THE PARTITION IS NOW EMPTY ON THE `left` SIDE, AND THAT IS THE
    // WHOLE OF THIS SLICE'S CLAIM ON THIS FAMILY.** The eighth row — `EX_THEN_210`, the
    // one D477 priced and declined — is claimed by the same arm through the shared
    // fragment's new class group. **The `left` rung is KEPT rather than deleted** (D438):
    // an EMPTY complement is a stronger statement than a one-element one, and it is the
    // rung that goes red the day a ninth printed row joins this family unclaimed.
    const claimed = family.filter(([, s]) => resolvedByAnyReader(s));
    expect(claimed).toHaveLength(8);
    expect(claimed.reduce((n, [units]) => n + units, 0)).toBe(13);
    const left = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(left.map(([, s]) => s)).toEqual([]);
    // ⚠️ WHAT THE PATTERN CANNOT SEE, as a QUERY that was run and not a list: it requires
    // the head to end `from this Pokémon`, so a cost spelled `from your Pokémon` or a
    // discard from the HAND is invisible to it. Both exist in the column, and neither is
    // this family — the hand one is `anyTargetSnipe.test.ts`'s standing near-miss.
    expect(
      corpusRows().filter(([, s]) => /^Discard .* from your (hand|Pokémon)\. This attack/.test(s)),
    ).not.toHaveLength(0);
  });

  it("🛑 the row that WAS left is built, and D477's own price is graded here", () => {
    // 🆕🆕🆕 **D483 — THE PARAGRAPH BELOW IS KEPT VERBATIM (D178) AND ITS VERDICT IS
    // GRADED RATHER THAN DELETED.** D477 wrote it, D472 wrote it first, and both were
    // RIGHT about the FIELD — `damageChosen.filter` is exactly the new op field on a
    // parking op they named, and the optional-vs-required question was live and was
    // answered OPTIONAL. **What both were wrong about is the ANCHOR**: *"the anchor above
    // is ONE `( ex)?` group away"* reads as a concession and was the literal truth —
    // there is no second anchor in this slice, and the group is the fragment's, so all
    // FOUR of its callers moved at once. ⚠️ **AND THE COST OF NOT ASKING WAS ONE SLICE
    // RATHER THAN THIRTY-FIVE**, which is the only reason this row is a footnote and
    // D482's was a finding.
    //
    // > D469's rule: a row you decline is worth as much as a row you build, if you write
    // > down the price. This one is *"bigger than it looks"*, and the reason is not the
    // > sentence's shape — the anchor above is ONE `( ex)?` group away from claiming it.
    // >
    // > `damageChosen` carries five riders (`optional`, `deals`, `perTakenPrize`,
    // > `perEnergyOnSelf`, `damagedOnly`) and **not one of them narrows the candidate
    // > CLASS**: `damagedOnly` narrows on a BOARD fact read off an `InPlayPokemon`, where
    // > `ex` is a CARD fact (`Card.suffix`, the column D446's `suffixPokemon` filter
    // > reads). So it needs a NEW op FIELD on a PARKING op — D334/D421's
    // > optional-vs-required question live, with a DROPPED rider degrading into "snipe any
    // > Benched body", which is D435's plausible-looking wrong answer rather than a soft
    // > landing. That is a slice, not a capture, and it is refused here rather than
    // > smuggled in.
    const program = deriveAttackEffect(EX_THEN_210) as EffectOp[];
    expect(program).toHaveLength(2);
    const snipe = program[1];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.filter).toEqual({ kind: "suffixPokemon", suffix: "ex" });
    expect(corpusRows().some(([, s]) => s === EX_THEN_210)).toBe(true);
    // …and the `ex` token is still the ONE axis (D399/D427), which is now asserted as an
    // INEQUALITY OF PROGRAMS rather than as a null (D449): strip those three bytes and the
    // same string resolves through the same arm, to an op that carries no `filter` at all.
    const stripped = EX_THEN_210.replace("Benched Pokémon ex.", "Benched Pokémon.");
    const bare = deriveAttackEffect(stripped) as EffectOp[];
    expect(bare).not.toBeNull();
    expect(bare[1]).not.toEqual(snipe);
    expect((bare[1] as { filter?: unknown }).filter).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVED PROGRAMS, AND D132's INVENTORY RULE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — two ops in printed order, and each half is the bare anchor's own output", () => {
  it("the three programs are exactly these bytes", () => {
    expect(deriveAttackEffect(TWO_THEN_120)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 120,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(ALL_THEN_90)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 90,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(TYPED_THEN_180)).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
        count: "all",
      },
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 180,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
  });

  it("🛑 D132's INVENTORY RULE: each half is BYTE-IDENTICAL to the bare anchor's output", () => {
    // The whole claim of a compound anchor is that it buys a JOIN and nothing else. If
    // either half drifted, this arm would be a second, quieter implementation of ops that
    // already ship — and the `damageChosen` half is the one that matters here, because
    // the standalone bench clause has been read by `ALSO_BENCHED_SNIPE` since D399.
    const two = deriveAttackEffect(TWO_THEN_120) as EffectOp[];
    expect(two[0]).toEqual(
      (deriveAttackEffect("Discard 2 Energy from this Pokémon.") as EffectOp[])[0],
    );
    expect(two[1]).toEqual(
      (
        deriveAttackEffect(
          "This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        ) as EffectOp[]
      )[0],
    );
    const typed = deriveAttackEffect(TYPED_THEN_180) as EffectOp[];
    expect(typed[0]).toEqual(
      (deriveAttackEffect("Discard all {R} Energy from this Pokémon.") as EffectOp[])[0],
    );
    expect(typed[1]).toEqual(
      (
        deriveAttackEffect(
          "This attack does 180 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        ) as EffectOp[]
      )[0],
    );
  });

  it("🛑 the ANY-target sibling is UNMOVED — this slice added a reader, it did not re-aim one", () => {
    // D401's four printings still answer `opponentAny`, which is the property the whole
    // suite's `opponentBench` claim is measured against. If a widening had swallowed
    // them, every board below would still pass and the engine would be aiming a Benched
    // snipe at an Active.
    for (const printed of [
      ALL_THEN_ANY_120,
      "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      "Discard all Energy from this Pokémon. This attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      const program = deriveAttackEffect(printed) as EffectOp[];
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${printed}`);
      expect(snipe.target, printed).toBe("opponentAny");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — WHAT THE GENERALITY BUYS, MEASURED OVER ALL 640 ROWS (D472).
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the anchor's generalisations claim nothing extra, and that is on purpose", () => {
  /** Re-spelled here rather than exported: the module keeps its anchors private, and a
      rung that re-implements the pattern is a rung about the pattern's REACH, which is
      exactly D472's question. The literal below is the anchor with its three shared-body
      generalisations REMOVED — no `(?:also )?`, no possessive capture, no narrowing. */
  const NARROWEST =
    /^Discard (all|\d+)(?: \{([GRWLPFDMY])\})? Energy from this Pokémon(?:\. This|, and this) attack (?:also )?does (\d+) damage to (\d+) of your opponent's Benched Pokémon\.(?: \(Don't apply Weakness and Resistance for Benched Pokémon\.\))?$/;

  it("🛑 the shared fragment's generality claims EXACTLY the rows a literal would", () => {
    // D472: measure what a generalisation would claim over the whole corpus, and if the
    // answer is "the same rows", the generality is pure RISK. It is — and it is taken
    // anyway, because the alternative is a SECOND ~100-byte spelling of one printed
    // clause, which is D416's copied-function hazard where the corpus goes QUIET rather
    // than red. The measurement is what makes that a decision instead of a habit.
    const byNarrow = corpusRows().filter(([, s]) => NARROWEST.test(s));
    expect(byNarrow.map(([, s]) => s).sort()).toEqual(
      [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180].sort(),
    );
    expect(byNarrow.reduce((n, [units]) => n + units, 0)).toBe(5);
    // …and the same three are exactly what the shipped arm claims.
    const byArm = corpusRows().filter(([, s]) => {
      const program = deriveAttackEffect(s);
      if (program === null || program.length !== 2) return false;
      const [cost, snipe] = program;
      return (
        cost?.op === "discardEnergy" &&
        snipe?.op === "damageChosen" &&
        snipe.target === "opponentBench"
      );
    });
    // 🆕🆕🆕 **D483 — THE TWO SETS COME APART FOR THE FIRST TIME, AND THAT IS THE
    // MEASUREMENT RATHER THAN A BREAKAGE.** `NARROWEST` above is the literal WITHOUT the
    // shared body's generalisations, so it still claims exactly three; the shipped ARM now
    // claims a FOURTH, `EX_THEN_210`, through the class group this slice added to that
    // body. **The gap between the two is precisely what the generality buys**, and it is
    // ONE sentence / ONE printing — the first time in this file's history that the answer
    // to D472's question is not "nothing".
    expect(byArm.map(([, s]) => s).sort()).toEqual(
      [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180, EX_THEN_210].sort(),
    );
    const bought = byArm.filter(([, s]) => !NARROWEST.test(s));
    expect(bought.map(([, s]) => s)).toEqual([EX_THEN_210]);
    expect(bought.reduce((n, [units]) => n + units, 0)).toBe(1);
  });

  it("🛑 `also` is NOT what refused these rows, and stripping it changes no answer", () => {
    // D447's rule: a surface token shared by every member of a refused family looks like
    // the gate and usually is not — STRIP THE TOKEN AND RE-ASK. The work order named
    // `also` as one of two deltas; it costs nothing, because the shared body has spelled
    // `(?:also )?` since D447 and the word only marks that a main hit precedes this one,
    // which the attack's own `damage` field carries either way.
    const bare = ALL_THEN_90.replace("attack also does", "attack does");
    expect(deriveAttackEffect(bare)).toEqual(deriveAttackEffect(ALL_THEN_90));
    // …and its converse: adding `also` to the one printed member that lacks it changes
    // nothing either. One axis, two directions (D427).
    const alsoed = TYPED_THEN_180.replace("attack does", "attack also does");
    expect(deriveAttackEffect(alsoed)).toEqual(deriveAttackEffect(TYPED_THEN_180));
    // ⚠️ AND NEITHER CONSTRUCTED STRING IS PRINTED — labelled as constructed (D440), so
    // this rung is a claim about the READER and not about the pool.
    expect(corpusRows().some(([, s]) => s === bare)).toBe(false);
    expect(corpusRows().some(([, s]) => s === alsoed)).toBe(false);
  });

  it("🛑 the SIDE is read off the printed possessive, on a CONSTRUCTED own-side compound", () => {
    // 🛑 THE FOURTH CALLER OF A SHARED FRAGMENT MUST ANSWER EVERY ONE OF ITS GROUPS
    // (D383/D437/D447), and a widening one caller honours while another drops is two
    // opinions about one printed clause. The own-side spelling is NOT printed behind a
    // discard cost — the bare own-side snipe is corpus lines 514 and 525 and neither
    // carries a cost — so this is **constructed, and labelled so** (D440): it is a claim
    // about the READER, not about the pool.
    //
    // ⚠️ AND IT IS WHAT MAKES THE POSSESSIVE READ LOAD-BEARING RATHER THAN DECORATIVE.
    // Without a rung here, an arm that hard-coded `"opponentBench"` derives every one of
    // this slice's three printed sentences correctly, and the mutation that proves the
    // ternary is doing work would have nowhere to die (D456).
    const ownSide = ALL_THEN_90.replace("1 of your opponent's Benched", "1 of your Benched");
    expect(corpusRows().some(([, s]) => s === ownSide)).toBe(false);
    const program = deriveAttackEffect(ownSide) as EffectOp[];
    expect(program).toHaveLength(2);
    const snipe = program[1];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.target).toBe("yourBench");
    // …and the printed opponent-side twin, the same string one possessive apart, is
    // still the opponent's. One axis, two answers (D427/D399).
    const printed = deriveAttackEffect(ALL_THEN_90) as EffectOp[];
    const printedSnipe = printed[1];
    if (printedSnipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(printedSnipe.target).toBe("opponentBench");
    expect(deriveAttackEffect(ownSide)).not.toEqual(deriveAttackEffect(ALL_THEN_90));
  });

  it("🛑 the type slot is `{X}` only, and the spelled-out notation would buy ZERO", () => {
    // `TYPED_SELF_DISCARD` admits both notations; this anchor admits one, and the reason
    // is the same measurement as above. Over all 640 rows the column prints NO
    // spelled-out typed discard in front of a snipe at all.
    const spelled = corpusRows().filter(([, s]) =>
      /^Discard (all|\d+) (Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Dragon|Fairy) Energy from this Pokémon/.test(
        s,
      ),
    );
    expect(spelled).toHaveLength(0);
    // …and the notation the anchor DOES read is closed over the map's keys, so the
    // observable direction is shut (D442): every `{X}` code the map carries resolves.
    for (const code of ["G", "R", "W", "L", "P", "F", "D", "M", "Y"]) {
      const constructed = TYPED_THEN_180.replace("{R}", `{${code}}`);
      expect(deriveAttackEffect(constructed), code).not.toBeNull();
    }
    // …while a code the map does NOT carry stays LOUD rather than counting every card.
    expect(deriveAttackEffect(TYPED_THEN_180.replace("{R}", "{C}"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — REFUSALS: THE THREE PRINTED ZEROES, THE TERMINATOR, THE SPLITTER, AND
//      THE DISJOINTNESS FROM D401's ANCHOR.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — what the anchor refuses, and why the two anchors cannot collide", () => {
  it("🛑 a printed 0 in ANY of the THREE positions stays LOUD, each against its own twin", () => {
    // Three separate positivity questions, asserted separately — and each refusal is ONE
    // CHARACTER from a sentence that resolves in the same `it` (D399).
    for (const [bad, good] of [
      [
        "Discard 0 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon.",
      ],
      [
        "Discard 2 Energy from this Pokémon. This attack also does 0 damage to 1 of your opponent's Benched Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack also does 1 damage to 1 of your opponent's Benched Pokémon.",
      ],
      [
        "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 0 of your opponent's Benched Pokémon.",
        "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon.",
      ],
    ] as const) {
      expect(deriveAttackEffect(bad), bad).toBeNull();
      expect(deriveAttackEffect(good), good).not.toBeNull();
    }
  });

  it("🛑 D400's number AGREEMENT rides in with the shared fragment", () => {
    // The narrowing clause is SINGULAR (*"that has any damage counters on it"*), so it
    // can only be printed against *"1 of"*. Inherited from arm 6c rather than restated —
    // and driven here, because a fourth caller that dropped the guard would resolve a
    // spelling the catalog has never printed (D190b).
    const one =
      "Discard 2 Energy from this Pokémon. This attack also does 120 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    const two = one.replace("to 1 of", "to 2 of");
    const narrowed = deriveAttackEffect(one) as EffectOp[];
    const snipe = narrowed[1];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.damagedOnly).toBe(true);
    expect(deriveAttackEffect(two)).toBeNull();
    // Both are constructed — the column prints neither — and are labelled so (D440).
    expect(corpusRows().some(([, s]) => s === one || s === two)).toBe(false);
  });

  it("🛑 the anchor's TERMINATOR: a compound that BEGINS with a printed compound is refused", () => {
    // Dropping the `$` would turn this into a PREFIX match and it would LOOK LIKE A
    // COVERAGE WIN. Driven at BOTH stopping points, because the optional clarifier is
    // exactly where a prefix match would otherwise halt.
    for (const text of [
      "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
      `${ALL_THEN_90} Your opponent's Active Pokémon is now Paralyzed.`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon, and this attack also does 90 damage to 1 of your opponent's Benched Pokémon.",
      ),
    ).not.toBeNull();
  });

  it("🛑 STRUCTURAL disjointness from D401's anchor, in BOTH directions (D467)", () => {
    // The two anchors cannot collide and there is NO GUARD, which is the preferred kind:
    // one demands `of your opponent's Pokémon.` and the other demands ` Benched Pokémon`
    // between the possessive and the period, so no string matches both. The order of the
    // two arms is therefore legibility, and the order-permutation mutant row is declared
    // `equivalent` on STRUCTURAL disjointness rather than on a guarded one.
    const benchOnes = [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180];
    const anyOnes = [ALL_THEN_ANY_120];
    for (const printed of benchOnes) {
      const program = deriveAttackEffect(printed) as EffectOp[];
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${printed}`);
      expect(snipe.target, printed).toBe("opponentBench");
    }
    for (const printed of anyOnes) {
      const program = deriveAttackEffect(printed) as EffectOp[];
      const snipe = program[1];
      if (snipe?.op !== "damageChosen") throw new Error(`not a damageChosen: ${printed}`);
      expect(snipe.target, printed).toBe("opponentAny");
    }
    // …and the two derived programs for the SAME head differ, which is what the zone word
    // buys and the only thing it buys (D449: an inequality of programs, never a null).
    expect(deriveAttackEffect(ALL_THEN_90)).not.toEqual(deriveAttackEffect(ALL_THEN_ANY_120));
  });

  it("🛑 the trailing PARENTHETICAL is the anchor's, and it is what stopped the ONE `COMPOSE` row", () => {
    // The work order asked whether the clarifier belongs to the anchor or is split off by
    // `splitAttackTrailingClause`. BOTH, and it is one fact seen twice.
    //
    // `COMPOUND_CLAUSE_BREAK` splits before a capital OR an opening paren, so line 92
    // splits into THREE parts and the splitter's TAIL is the parenthetical — which no
    // reader claims, so the tail test refuses it. That is why the residue's ONE `COMPOSE`
    // row (both halves build) never composed, for as long as the class existed.
    expect(splitAttackTrailingClause(TWO_THEN_120)).toBeNull();
    expect(splitAttackGateClause(TWO_THEN_120)).toBeNull();
    // Both halves DO build on their own, which is the whole content of the `COMPOSE`
    // class — and now the anchor claims the whole string, so the shadow refusal at the
    // top of the splitter is what refuses it and the tail test is no longer reached.
    expect(deriveAttackEffect("Discard 2 Energy from this Pokémon.")).not.toBeNull();
    expect(
      deriveAttackEffect(
        "This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).not.toBeNull();
    expect(resolvedByAnyReader(TWO_THEN_120)).toBe(true);
    // ⚠️ AND THE PARENTHETICAL IS OPTIONAL EVEN THOUGH ALL FIVE PRINTINGS CARRY IT — §8.5
    // makes it true regardless and older printings omit it, so every anchor in this file's
    // snipe family spells it `(?: \(…\))?`. A mandatory copy here would be the odd one out
    // and would refuse on an ERA rather than on a mechanism.
    expect(
      deriveAttackEffect(
        "Discard all {R} Energy from this Pokémon, and this attack does 180 damage to 1 of your opponent's Benched Pokémon.",
      ),
    ).toEqual(deriveAttackEffect(TYPED_THEN_180));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE LOAD-BEARING BOARD: A DAMAGED ACTIVE AND THREE BENCHED BODIES AT
//      THREE DIFFERENT HP AND THREE DIFFERENT DAMAGES.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the snipe lands where it was told to, on a board that can say otherwise", () => {
  it("the candidate set is the opponent's BENCH — three refs, and NOT the Active", () => {
    // 🛑 THE CENTRAL DISCRIMINATION OF THE SLICE. `opponentAny` (the neighbouring arm's
    // literal, and the nearest wrong sibling this arm has) offers FOUR candidates on this
    // board because the Active is always present during an attack. `yourBench` offers
    // p1's bodies. Three answers, three different candidate lists, read before a single
    // number is placed.
    const table = loadBearingBoard(["fix-energy", "fix-water-energy"]);
    const { state: parked } = swingPurge(table, PURGE_ALL);
    const prompt = snipePrompt(parked);
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
    expect(prompt.candidates.every((ref) => ref.spot.spot === "bench")).toBe(true);
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
  });

  it("🛑 the pick decides WHICH benched body takes it, and every wrong answer is a different vector", () => {
    const table = loadBearingBoard(["fix-energy", "fix-water-energy"]);
    // The main hit lands first: the defender starts at 40 and Ashfall prints 30.
    for (const [pick, wanted] of [
      [0, [100, 20, 30]],
      [1, [10, 110, 30]],
      [2, [10, 20, 120]],
    ] as const) {
      const { state: parked } = swingPurge(table, PURGE_ALL);
      const { state: done } = answerSnipe(parked, pick);
      expect(benchDamages(done, "p2"), `pick ${pick}`).toEqual([...wanted]);
      // …and the Active took the MAIN hit and NOTHING else. A build that applied the
      // snipe to the Active answers 160 here and leaves the bench at [10, 20, 30].
      expect(activeDamage(done, "p2"), `pick ${pick}`).toBe(70);
      expect(benchDamages(done, "p1"), `pick ${pick}`).toEqual([]);
    }
  });

  it("🛑 the benched hit is FLAT — no Weakness, no Resistance — and the Active's is not", () => {
    // §8.5 scopes W/R to the Active/Defending Pokémon. The bench body is Colorless with
    // no Weakness printed, so the honest control is the ANY-target sibling one index over:
    // the same head, the same cost, and a target set that includes the Active.
    const table = loadBearingBoard(["fix-energy", "fix-water-energy"]);
    const { state: parked } = swingPurge(table, PURGE_ANY);
    const wide = snipePrompt(parked);
    expect(wide.candidates).toHaveLength(4);
    expect(wide.candidates.filter((ref) => ref.spot.spot === "active")).toHaveLength(1);
    // Aim it at the Active and the 120 lands there; the bench does not move.
    const activeAt = wide.candidates.findIndex((ref) => ref.spot.spot === "active");
    const { state: done, events } = answerSnipe(parked, activeAt);
    expect(activeDamage(done, "p2")).toBe(160);
    expect(benchDamages(done, "p2")).toEqual([10, 20, 30]);
    expect(dealtRows(events).map((r) => r.dealt)).toEqual([120]);
  });

  it("🛑 BOTH prompts RENDER, and each names the zone its own funnel offers (D473)", () => {
    // D473: a reader can be correct while its DESCRIBER is incomplete, and only the
    // describer is user-visible — so every op a new anchor admits owes a phrase. This
    // anchor admits NO op kind that a shipped arm does not already produce (§8 pins the
    // set), and the two captions it reaches are `snipeNote`'s and the discard's. Both
    // are DRIVEN here rather than argued: a caption that said "your opponent's Pokémon"
    // over a Bench-only candidate list would be the dialog contradicting its own
    // validator, and no engine assertion about the board can see it.
    const table = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    const { state: costPark } = swingPurge(table, PURGE_TWO);
    if (costPark.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const costPrompt = costPark.phase.prompt;
    if (costPrompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(costPrompt.note).not.toBe("");
    expect(costPrompt.scope).toEqual({ kind: "total", count: 2 });
    const { state: snipePark } = payTheCost(costPark);
    const note = snipePrompt(snipePark).note;
    expect(note).toBe("Choose 1 of your opponent's Benched Pokémon (120 damage each).");
    // …and the ANY-target sibling's caption names the WIDER zone on the same board, so
    // the word is read off the op rather than hard-coded (the pair is the claim).
    const wide = snipePrompt(swingPurge(table, PURGE_ANY).state).note;
    expect(wide).toBe("Choose 1 of your opponent's Pokémon (120 damage each).");
  });

  it("the DAMAGE_DEALT row names the victim's seat and the DEALER, and the dealer is p1", () => {
    // D425: the row carries `by` rather than deriving it from `seat`, and a benched snipe
    // is exactly the shape that caught the derivation out.
    const table = loadBearingBoard(["fix-energy", "fix-water-energy"]);
    const { state: parked } = swingPurge(table, PURGE_ALL);
    const { events } = answerSnipe(parked, 1);
    expect(dealtRows(events)).toEqual([{ seat: "p2", by: "p1", dealt: 90 }]);
  });

  it("🛑 the amounts are READ, not assumed: 90, 120 and 180 land as printed", () => {
    // Three attacks, three printed amounts, one board — so an arm that hardcoded any of
    // them (or read the wrong capture) answers a number this rung names.
    const rich = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    const first = answerSnipe(swingPurge(rich, PURGE_ALL).state, 1).state;
    expect(benchDamages(first, "p2")).toEqual([10, 110, 30]);
    const second = answerSnipe(payTheCost(swingPurge(rich, PURGE_TWO).state).state, 1).state;
    expect(benchDamages(second, "p2")).toEqual([10, 140, 30]);
    const third = answerSnipe(swingPurge(rich, PURGE_TYPED).state, 1).state;
    expect(benchDamages(third, "p2")).toEqual([10, 200, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE ZERO-MATCH BOARD, WITH CONTROLS SEPARATING IT FROM SILENCE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — an empty opponent Bench is a SILENT no-op, and the silence is attributed", () => {
  it("🛑 the cost is still PAID, the attack still resolves, and nothing is sniped", () => {
    // The interpreter's `candidates.length === 0` arm returns the state untouched. That
    // reads exactly like "the program never ran", so the discard is the witness that it
    // did — and it is the half of the sentence that has nothing to do with the Bench.
    const empty = purgeTable(["fix-energy", "fix-water-energy"], []);
    expect(empty.players.p2.bench).toHaveLength(0);
    expect(empty.players.p1.active?.energy).toHaveLength(2);
    const { state: done, events } = swingPurge(empty, PURGE_ALL);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.active?.energy).toEqual([]);
    expect(activeDamage(done, "p2")).toBe(30);
    expect(dealtRows(events).map((r) => r.dealt)).toEqual([30]);
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 THE CONTROL: the SAME board with one benched body fires, and the plain attack never could", () => {
    // Two controls on two different axes, because "no snipe row" on its own is satisfied
    // by three different builds (D424's rule: a refusal rung owes an admission).
    //
    // (a) THE BENCH: one body added to the same board and the snipe parks and lands.
    const oneBody = purgeTable(["fix-energy", "fix-water-energy"], ["d477-benchmid"]);
    const { state: parked } = swingPurge(oneBody, PURGE_ALL);
    // ⚠️ ONE candidate and a MANDATORY pick auto-takes (the M1 no-choice doctrine), so
    // this board does NOT park — which is itself the tell that the arity doctrine is the
    // shipped one and not a copy.
    expect(parked.phase.kind).not.toBe("effect:choose");
    expect(benchDamages(parked, "p2")).toEqual([90]);
    // (b) THE PROGRAM: the same attacker's effect-free attack on the same empty board
    // moves the Active and files no effect row at all, so the silence in the rung above
    // is the CANDIDATE SET's and not the pipeline's.
    const empty = purgeTable(["fix-energy", "fix-water-energy"], []);
    const { state: plain, events } = swingPurge(empty, PURGE_NONE);
    expect(activeDamage(plain, "p2")).toBe(30);
    expect(plain.players.p1.active?.energy).toHaveLength(2);
    expect(eventTypes(events)).not.toContain("ENERGY_DISCARDED");
  });

  it("🛑 and the ANY-target sibling is NOT silent on the same empty board", () => {
    // The sharpest available control for the ZONE: `opponentAny` always has the Active,
    // so the same head on the same empty-bench board lands its 120. A build that read
    // `opponentAny` for the Benched sentences would be silent NOWHERE, which is exactly
    // what makes the pair of rungs discriminate.
    const empty = purgeTable(["fix-energy", "fix-water-energy"], []);
    const { state: done } = swingPurge(empty, PURGE_ANY);
    expect(activeDamage(done, "p2")).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE COST, DRIVEN INDEPENDENTLY OF THE DAMAGE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the self-discard half, on its own terms", () => {
  it("`all` empties the attacker whatever is attached, and resolves INLINE", () => {
    const three = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    expect(three.players.p1.active?.energy).toHaveLength(3);
    const { state: parked } = swingPurge(three, PURGE_ALL);
    // `all` has no decision in it, so the FIRST park a player sees is the snipe's.
    expect(snipePrompt(parked).candidates).toHaveLength(3);
    expect(parked.players.p1.active?.energy).toEqual([]);
  });

  it("🛑 the TYPED cost discards only what provides {R}, and leaves the rest standing", () => {
    // D448's rule: when the claim is "narrowed by Y", the board must hold a Y that
    // differs, or the narrowed and un-narrowed answers are the same number and the
    // mutant survives a suite that looks thorough. Two non-{R} cards stay attached.
    const mixed = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    const before = mixed.players.p1.active?.energy ?? [];
    expect(before).toHaveLength(3);
    const { state: parked } = swingPurge(mixed, PURGE_TYPED);
    const after = parked.players.p1.active?.energy ?? [];
    expect(after).toHaveLength(2);
    expect(after.every((uid) => parked.cardIdByUid[uid] !== "fix-fire-energy")).toBe(true);
    // …and the snipe behind it still fires, so the two ops are sequenced and not
    // alternatives.
    const { state: done } = answerSnipe(parked, 2);
    expect(benchDamages(done, "p2")).toEqual([10, 20, 210]);
  });

  it("🛑 the COUNT-2 cost PARKS on a genuine choice, and the snipe parks AFTER it", () => {
    // D464: `discardEnergy` collapses interchangeable candidates BEFORE it decides to
    // park, so a body holding two copies of one class presents ONE candidate and resolves
    // inline. Two DIFFERENT classes is the smallest board on which this op parks — and
    // the two parks in sequence are D401's "the first compound whose second half also
    // parks", here with the cost parking too.
    const mixed = loadBearingBoard(["fix-energy", "fix-water-energy", "fix-fire-energy"]);
    const { state: firstPark } = swingPurge(mixed, PURGE_TWO);
    expect(firstPark.phase.kind).toBe("effect:choose");
    if (firstPark.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(firstPark.phase.prompt.kind).toBe("discardEnergy");
    // The SNIPE is still in `rest` at this point — the tail the continuation carries.
    expect(firstPark.phase.cont.rest.map((op) => op.op)).toEqual(["damageChosen"]);
    const { state: secondPark } = payTheCost(firstPark);
    expect(snipePrompt(secondPark).candidates).toHaveLength(3);
    const { state: done } = answerSnipe(secondPark, 0);
    expect(benchDamages(done, "p2")).toEqual([130, 20, 30]);
    // Exactly two Energy went, and one stayed.
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("a UNIFORM pile does not park the cost, which is the control for the rung above", () => {
    // Three copies of one class: `interchangeableCandidates` collapses them, the pick is
    // forced, and the discard resolves inline — so the first prompt is the snipe's.
    const uniform = loadBearingBoard(["fix-energy"]);
    const { state: parked } = swingPurge(uniform, PURGE_TWO);
    expect(snipePrompt(parked).candidates).toHaveLength(3);
    expect(parked.players.p1.active?.energy).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — WHAT DID NOT MOVE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the surface, the version, and the mechanisms this slice did not add", () => {
  it("the reader SURFACE stands still at 13 — the arm is inside `deriveAttackEffect`", () => {
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("engineVersion is 0.379.0 and `manifest.version` agrees", () => {
    // 🆕🆕🆕 D477 — 0.374.0 → **0.375.0**, and the bump is owed for BEHAVIOUR: five legal
    // printings that derived to `null` and fell to the loud `ATTACK_EFFECT_SKIPPED` path
    // now pay a §8 cost and park a benched snipe. **`MATCH_RECORD_VERSION` STAYS 29** on
    // D463's SERIALIZED-ALPHABET argument, and NOT on reachability — this program parks
    // twice, so `phase.cont.pendingOp` and `phase.cont.rest` really are written (§7). What
    // makes the byte argument true is that every op the new arm emits is one a v29 deploy
    // already writes from a shipped anchor: `discardEnergy {from:"yourActive", filter,
    // count}` is `SELF_DISCARD_N` / `TYPED_SELF_DISCARD`'s output and `damageChosen
    // {target:"opponentBench", …}` is `ALSO_BENCHED_SNIPE`'s. No new op, no new op FIELD,
    // no new op VALUE — so there is no byte for a version to be about.
    expect(engineVersion).toBe("0.379.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the three sentences produce NO op this engine did not already emit", () => {
    // D473: for every op a widened anchor would newly admit, the describers owe it a
    // phrase. This anchor admits none — both kinds are produced by shipped arms one and
    // three screens up — so the check is the SET, asserted rather than argued.
    const kinds = new Set(
      [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180].flatMap((s) =>
        (deriveAttackEffect(s) ?? []).map((op) => op.op),
      ),
    );
    expect([...kinds].sort()).toEqual(["damageChosen", "discardEnergy"]);
  });

  it("the derived programs are frozen-safe and stable across calls", () => {
    for (const printed of [TWO_THEN_120, ALL_THEN_90, TYPED_THEN_180]) {
      const once = deepFreeze(deriveAttackEffect(printed));
      expect(deriveAttackEffect(printed)).toEqual(once);
    }
  });
});
