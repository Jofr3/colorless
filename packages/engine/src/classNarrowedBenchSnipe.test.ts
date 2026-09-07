import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, deriveAttackOptionalCostBoost } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 0.378.0 → 0.379.0 — 🆕🆕🆕 D483: THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE.
//
//   file line 111 (1 printing)  "Discard all Energy from this Pokémon, and this attack
//                                does 210 damage to 1 of your opponent's Benched
//                                Pokémon ex. (Don't apply …)"
//   file line 615 (1 printing)  "This attack does 60 damage to 1 of your opponent's
//                                Benched Pokémon ex or Benched Pokémon V. (Don't apply …)"
//
// 2 sentences / 2 legal printings over `legalAttackCorpus()`'s 640 / 1,732.
//
// 🛑 **THE WORK ORDER SAID FOUR ROWS SHARE ONE BLOCKER. THE MEASUREMENT SAYS TWO DO,
// AND THE OTHER TWO SHARE TWO.** The brief named a four-row cluster behind *"ONE class
// narrowing"*: these two SNIPES and two SPREADS (*"This attack does {60|100} damage to
// each of your opponent's Pokémon ex [and Pokémon V]. This attack's damage isn't
// affected by Weakness or Resistance."*, file lines 615/616 — 2 sentences / 4 printings).
// D458's cheap disproof — **delete one axis and re-ask the readers** — separates them:
//
//   · strip the class from EITHER snipe and the same string resolves through the same
//     arm (§7 drives both), so the class is the WHOLE blocker; but
//   · strip the class from EITHER spread and it is STILL unread, and strip the W/R
//     SENTENCE instead and it is still unread. **Two axes, and neither alone is it.**
//
// So the cluster is not one slice. §1 publishes the pattern, the counts and the split.
//
// 🛑 **AND THE COMPOSITION QUESTION WAS ASKED FIRST AND EXPLICITLY (D482), WITH A
// FINDING ON BOTH SIDES.** *"Can a sequence of shipped ops spell this?"*
//   · **For the SPREADS: nearly, and the near-miss is the useful part.**
//     `counterEachAll` ALREADY walks one whole side under a REQUIRED `filter: CardFilter`
//     with `side: "opponent"` — the exact candidate set both spreads name, already
//     spellable today with zero new anything. It is REFUSED because it is the wrong
//     DAMAGE MODEL: those sentences print *"does N damage"*, which this engine has meant
//     `DAMAGE_DEALT` through the post-W/R reduction fold since D159/D161, and
//     `counterEachAll` places flat counters and files `COUNTERS_PLACED`. **A composition
//     that produces the right board on today's fixtures and the wrong one under a
//     shipped reduction passive is D435's plausible wrong answer**, so the spreads are
//     priced and left rather than smuggled in through the counter family.
//   · **For the SNIPES: no, and the reason is exactly one field.** Every op in the
//     chosen-hit family reaches `snipeTargets`, and its two narrowings before this slice
//     — `target` (a ZONE) and `damagedOnly` (a BOARD fact off an `InPlayPokemon`) —
//     cannot ask a CARD question. That was D472's price and D477 re-confirmed it; both
//     were right about the field.
//
// ⚠️ **WHAT BOTH PRICES GOT WRONG WAS THE ANCHOR, AND THE ERROR WAS ON THE CHEAP SIDE.**
// `costBenchSnipe.test.ts` §1 wrote *"the anchor above is ONE `( ex)?` group away from
// claiming it"* as a concession; it was the literal truth. There is no new anchor in this
// slice. The group goes on `ALSO_BENCHED_SNIPE_BODY`, the SHARED fragment D383 made
// shared, so **all four of its callers move in one edit** — and two of them are the two
// printed rows, in two different anchors, which is why 2 sentences arrive for the price
// of one capture.
//
// ⚠️ **NOT ZERO, SAID OUT LOUD.** ONE new optional op FIELD (`damageChosen.filter`), ONE
// new private map (`BENCHED_SNIPE_CLASS_NOUNS`, two rows), ONE new group on the shared
// fragment, and ONE new parameter on `snipeNote`. **ZERO** new `EffectOp` members, op
// VALUES, `CardFilter` members, readers (the surface stands still at 13), anchors,
// prompts, choice kinds, events, error codes, `GameState` fields, registry rows,
// `packages/schema` bytes or `redact.ts` bytes. **NO NEW `FIXTURE_POOL` id** — the
// demonstrator lives in a file-local `cardPool` (D414/D452), so every id ladder takes a
// ZERO term.
//
// 🛑 **`MATCH_RECORD_VERSION` STAYS 29, ON `damagedOnly`'s ARGUMENT RE-DRIVEN RATHER
// THAN QUOTED** (§8): the field is read at exactly one site, `snipeTargets`, which
// `applyChoice` never calls — so a v29 record that lost the key resumes to the identical
// board, because the narrowing already happened when the prompt was built.

const CLASS_SEED = 483_0483;

/** Corpus FILE LINE 615, byte for byte. TWO printed classes, so the filter is an
    `anyOf` — and this row is the reason a scalar `suffix` field could not have done. */
const EX_OR_V_60 =
  "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex or Benched Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** Corpus FILE LINE 111, byte for byte — the row D472 priced, D477 re-priced and
    declined, and `costBenchSnipe.test.ts` fielded as a refusal witness. */
const EX_THEN_210 =
  "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The UN-NARROWED control, and it is a real corpus row (file line 587). Every board
    below is read twice — once through a narrowed arm and once through this one — because
    a candidate set is only ever wrong RELATIVE to the set the same board would otherwise
    offer. */
const PLAIN_60 =
  "This attack does 40 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The two SPREAD siblings, priced and LEFT. Corpus file lines 616 and 539. */
const SPREAD_EX_60 =
  "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.";
const SPREAD_EX_V_100 =
  "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance.";

const HIT_EX_OR_V = 0;
const HIT_EX_AFTER_PURGE = 1;
const HIT_ANY_BENCH = 2;
const NO_EFFECT_AT_ALL = 3;

/** `d483-*` keys with no catalog row behind them (D425), kept out of `FIXTURE_POOL`
    entirely by a file-local `cardPool` (D414/D452).

    ⚠️ **THE FOUR BENCHED BODIES CROSS THE CLASS AXIS WITH THE HP AXIS ON PURPOSE, AND
    THE ORDER IS LOAD-BEARING.** `ex, V, plain, ex` — so the narrowed candidate list is
    NOT a prefix of the unnarrowed one, and "picked candidate 1 of the filtered list"
    lands on a DIFFERENT body from "picked candidate 1 of the unfiltered list". A bench
    ordered `ex, ex, V, plain` would make those two readings agree at index 0 and 1 and
    the discriminator would be silently vacuous — D482's class, and §5 computes all three
    readings' answers before a number is asserted.

    ⚠️ The names carry the suffix because `pokemonSuffixOf` is NAME-derived (cards.ts):
    that is the engine's one definition of the printed class, and a fixture that set some
    other field would be testing a mechanism the catalog does not have. */
const CLASS_CARDS: Record<string, Card> = {
  "d483-sniper": battler("d483-sniper", {
    name: "D483 Sniper",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      // No printed `damage` on the three snipes: none of these sentences carries an
      // "also", so the snipe IS the attack.
      { cost: ["Colorless"], name: "Rule Break", effect: EX_OR_V_60 },
      { cost: ["Colorless"], name: "Purge Lance", effect: EX_THEN_210 },
      { cost: ["Colorless"], name: "Wide Lance", effect: PLAIN_60 },
      // No effect text at all: the control that separates "the program ran and found
      // nothing" from "no program ran" on the ZERO-MATCH board of §6.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 30 },
    ],
  }),
  /** The defender. Big enough that nothing here Knocks it Out, and deliberately NOT an
      `ex`: the Active is not a candidate for a Benched snipe whatever its class, and a
      board whose Active matched the filter could not tell the zone test from the class
      test. */
  "d483-wall": battler("d483-wall", { name: "D483 Wall", types: ["Colorless"], hp: 340 }),
  /** Bench 0 — an `ex`, and the ONLY body carrying a Weakness. §5 reads 60 off it and
      not 120, which is §8.5 (no Weakness on the Bench) driven rather than assumed. */
  "d483-foe-ex": battler("d483-foe-ex", {
    name: "D483 Foe ex",
    types: ["Colorless"],
    hp: 330,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  /** Bench 1 — a `V`. The body that separates the printed pair from the printed
      singleton, and the body a dropped filter lands on. */
  "d483-foe-v": battler("d483-foe-v", { name: "D483 Foe V", types: ["Colorless"], hp: 320 }),
  /** Bench 2 — no rule box at all. */
  "d483-foe": battler("d483-foe", { name: "D483 Foe", types: ["Colorless"], hp: 310 }),
  /** Bench 3 — the SECOND `ex`, so the narrowed set is 2 and the pick is a real
      decision rather than the M1 auto-take. */
  "d483-other-ex": battler("d483-other-ex", {
    name: "D483 Other ex",
    types: ["Colorless"],
    hp: 300,
  }),
};

const CLASS_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...CLASS_CARDS };

/** Its own deck (D270), 60 counted before the first run: 8 + 8 + 8 + 8 + 6 + 6 + 8 + 8. */
const CLASS_DECK = deckOf({
  "d483-sniper": 8,
  "d483-wall": 8,
  "d483-foe-ex": 8,
  "d483-foe-v": 8,
  "d483-foe": 6,
  "d483-other-ex": 6,
  "fix-energy": 8,
  "fix-water-energy": 8,
});

function openClassTable(first: Seat): GameState {
  const created = createGame({
    seed: CLASS_SEED,
    decks: { p1: CLASS_DECK, p2: CLASS_DECK },
    cardPool: CLASS_POOL,
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

/** p1 owns TURN 2 with the Sniper Active. BOTH benches are cleared before anything is
    placed — every figure below is a population over a bench, so a body the setup shuffle
    happened to place would move an answer silently. */
function classTable(oppBench: readonly string[]): GameState {
  let table = openClassTable("p2");
  table = mustApply(table, { type: "endTurn", seat: "p2" }).state;
  expect(table.turn).toBe(2);
  table = setActiveFromDeck(table, "p1", "d483-sniper");
  table = setActiveFromDeck(table, "p2", "d483-wall");
  table = clearBench(table, "p1");
  table = clearBench(table, "p2");
  // TWO Energy on the attacker, so §6's "the cost was paid anyway" reading is a
  // population that moves from 2 to 0 rather than a boolean.
  table = attachFromDeck(table, "p1", "fix-energy", 1);
  table = attachFromDeck(table, "p1", "fix-water-energy", 1);
  for (const card of oppBench) table = benchFromDeck(table, "p2", card);
  return table;
}

/** The §5 board: a damaged defender and FOUR benched bodies — `ex, V, plain, ex` — at
    four different HP with four different starting damages. */
const MIXED_BENCH = ["d483-foe-ex", "d483-foe-v", "d483-foe", "d483-other-ex"] as const;

function loadBearingBoard(): GameState {
  let table = classTable(MIXED_BENCH);
  table = setDamage(table, "p2", 40);
  table = setBenchDamage(table, "p2", 0, 10);
  table = setBenchDamage(table, "p2", 1, 20);
  table = setBenchDamage(table, "p2", 2, 30);
  table = setBenchDamage(table, "p2", 3, 40);
  return table;
}

function swing(state: GameState, index: number) {
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
  return { prompt, ...mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [chosen as PokemonRef] },
  }) };
}

/** The bench indices a prompt is offering, which is the whole discrimination of §5. */
function offeredBench(candidates: readonly PokemonRef[]): number[] {
  return candidates.map((ref) => {
    if (ref.seat !== "p2" || ref.spot.spot !== "bench") throw new Error("not an opponent bench ref");
    return ref.spot.index;
  });
}

const corpusRows = () => legalAttackCorpus();
const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((n, [count]) => n + count, 0);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE CLUSTER, MEASURED WITH A PUBLISHED PATTERN RATHER THAN ENUMERATED,
//      AND SPLIT BY ITS ACTUAL BLOCKERS.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed `ex`/`V` class over the whole column, and what blocks each row", () => {
  it("🛑 the PATTERN, run over all 640 rows: 20 sentences / 30 printings name the class", () => {
    // D477/D425: publish the pattern, not a list — a list is only as complete as the
    // window it was read through. This is the loosest plausible shape: the printed
    // rule-box noun anywhere in a sentence, over the whole legal attack column.
    const CLASS = /Pokémon (ex|V|VMAX|VSTAR|V-UNION)\b/;
    const named = corpusRows().filter(([, s]) => CLASS.test(s));
    expect(named).toHaveLength(20);
    expect(units(named)).toBe(30);
    // Fourteen of the twenty were already built — the ACTIVE-class damage bonus family
    // and D446's two in-play body counts — so the printed word has never been a blocker
    // on its own, only in a TARGET position.
    const built = named.filter(([, s]) => resolvedByAnyReader(s));
    expect(built).toHaveLength(16);
    expect(units(built)).toBe(24);
  });

  it("🛑 the RESIDUE half of that pattern, and the brief's four-row cluster is 4 of 6", () => {
    // ⚠️ **THE WORK ORDER SAID *"measured over the residue, FOUR rows name `Pokémon ex`
    // or `Pokémon V` as a TARGET narrowing"*. The count is right and the framing is not**
    // — SIX residue rows name the class at all, and one of the two extras names it on the
    // OPPONENT'S SIDE, which is the shape the brief's own words describe. It is a damage
    // PREVENTION whose narrowing is on the SOURCE (*"prevent all damage done to each of
    // your Future Pokémon by attacks from Pokémon ex"*), and the sixth names it inside a
    // parenthetical gloss (*"(Pokémon ex, Pokémon V, etc. have Rule Boxes.)"*). Neither
    // is this cluster; both would have been swept in by a possessive-anchored grep.
    const CLASS = /Pokémon (ex|V|VMAX|VSTAR|V-UNION)\b/;
    const residue = corpusRows().filter(([, s]) => CLASS.test(s) && !resolvedByAnyReader(s));
    expect(residue).toHaveLength(4);
    // 4 sentences / **6** printings — the brief's number, and the two counts differ
    // because both SPREAD rows are 2-printing sentences where both SNIPES were 1.
    expect(units(residue)).toBe(6);
    // …and the two this slice built have LEFT that residue, which is the only way this
    // rung can be read as a measurement of THIS head rather than of the brief's.
    expect(residue.map(([, s]) => s)).not.toContain(EX_OR_V_60);
    expect(residue.map(([, s]) => s)).not.toContain(EX_THEN_210);
  });

  it("🛑 both printed rows are real corpus rows at their measured printing counts", () => {
    // D183/D456: the specimen is the printed bytes off the committed column, never
    // retyped, and the counts are read off the corpus because a byte pin on an invented
    // string is green by construction (D452).
    const rows = new Map(corpusRows().map(([n, s]) => [s, n]));
    expect(corpusRows()).toHaveLength(640);
    expect(units(corpusRows())).toBe(1732);
    expect(rows.get(EX_OR_V_60)).toBe(1);
    expect(rows.get(EX_THEN_210)).toBe(1);
    expect(rows.get(PLAIN_60)).toBe(1);
    expect(rows.get(SPREAD_EX_60)).toBe(2);
    expect(rows.get(SPREAD_EX_V_100)).toBe(2);
  });

  it("🛑 THE SPLIT: the snipes have ONE blocker and the spreads have TWO (D458's disproof)", () => {
    // **DELETE ONE AXIS AND RE-ASK THE READERS** — the cheapest disproof this repo has,
    // and the thing that turns a four-row cluster into two slices.
    //
    // (a) THE SNIPES. Strip the class and both resolve at HEAD, so the class was the
    //     whole of it. (The stripped strings are constructed and are labelled as such —
    //     `PLAIN_60` is the printed member of the shape and is pinned above.)
    expect(
      resolvedByAnyReader(EX_OR_V_60.replace(" ex or Benched Pokémon V", "")),
    ).toBe(true);
    expect(resolvedByAnyReader(EX_THEN_210.replace("Benched Pokémon ex.", "Benched Pokémon."))).toBe(
      true,
    );
    // (b) THE SPREADS. Strip the class — STILL unread. Strip the W/R sentence instead —
    //     STILL unread. Neither axis alone is the blocker, so no single field builds them
    //     and the cluster is not one slice.
    expect(resolvedByAnyReader(SPREAD_EX_60.replace(" ex", ""))).toBe(false);
    expect(
      resolvedByAnyReader(
        SPREAD_EX_60.replace(" This attack's damage isn't affected by Weakness or Resistance.", ""),
      ),
    ).toBe(false);
    expect(resolvedByAnyReader(SPREAD_EX_V_100.replace(" ex and Pokémon V", ""))).toBe(false);
    // …and the CONTROL that keeps (b) from being vacuous: the same skeleton WITH the
    // Benched clarifier instead of the W/R sentence is D482's shipped row, so the
    // pipeline reads this family fine and the two refusals above are real (D424).
    expect(
      resolvedByAnyReader(
        "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
  });

  it("🛑 the SPREADS' composition candidate exists, is spellable TODAY, and is refused", () => {
    // 🛑 **THE COMPOSITION QUESTION, ASKED AND DRIVEN RATHER THAN ASSUMED (D482).**
    // `counterEachAll` carries a REQUIRED `filter: CardFilter` and a `side: "opponent"`,
    // so `{ op: "counterEachAll", amount: 60, filter: <the printed noun>, side:
    // "opponent", source: "attack" }` names EXACTLY the candidate set both spread rows
    // print — with zero new ops, fields or vocabulary. The blocker is not the SET.
    //
    // It is refused on the DAMAGE MODEL: the printed verb is *"does N damage"*, which
    // this engine resolves through `DAMAGE_DEALT` and the post-W/R reduction fold, and
    // `counterEachAll` places flat counters and files `COUNTERS_PLACED`. On a board with
    // no reduction passive the two are byte-identical — which is exactly what makes it
    // dangerous, and is D482's arithmetic-coincidence class arriving as a DESIGN choice
    // rather than as a test defect.
    //
    // The assertion is the SHAPE of the refusal: the class the spreads name is already
    // in the vocabulary, so nothing here is waiting on `CardFilter`.
    const narrowed = deriveAttackEffect(EX_THEN_210) as EffectOp[];
    const snipe = narrowed[1];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.filter).toEqual({ kind: "suffixPokemon", suffix: "ex" });
    // …and the spreads themselves are STILL UNBUILT at this head, which is the refusal
    // stated as a rung rather than as a paragraph (D465). Deleting either one of these
    // without building it is what a successor must not do quietly.
    expect(deriveAttackEffect(SPREAD_EX_60)).toBeNull();
    expect(deriveAttackEffect(SPREAD_EX_V_100)).toBeNull();
    expect(resolvedByAnyReader(SPREAD_EX_60)).toBe(false);
    expect(resolvedByAnyReader(SPREAD_EX_V_100)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVED PROGRAMS, AND D132's INVENTORY RULE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — two programs, exactly these bytes, and each half is the bare anchor's own", () => {
  it("the two programs are exactly these bytes", () => {
    expect(deriveAttackEffect(EX_OR_V_60)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "suffixPokemon", suffix: "ex" },
            { kind: "suffixPokemon", suffix: "V" },
          ],
        },
      },
    ]);
    expect(deriveAttackEffect(EX_THEN_210)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 210,
        count: 1,
        source: "attack",
        deals: true,
        filter: { kind: "suffixPokemon", suffix: "ex" },
      },
    ]);
  });

  it("🛑 D132's INVENTORY RULE: the narrowed op differs from the bare one in ONE key", () => {
    // The whole claim of this slice is that the class narrows a CANDIDATE SET and moves
    // nothing else — same amount, same arity, same zone, same W/R answer, same park. An
    // inequality of programs rather than a null (D449), asserted key by key.
    const narrowed = (deriveAttackEffect(EX_OR_V_60) as EffectOp[])[0];
    const bare = (deriveAttackEffect(PLAIN_60) as EffectOp[])[0];
    if (narrowed?.op !== "damageChosen" || bare?.op !== "damageChosen") {
      throw new Error("expected two damageChosen ops");
    }
    expect(narrowed.target).toBe(bare.target);
    expect(narrowed.count).toBe(bare.count);
    expect(narrowed.source).toBe(bare.source);
    expect(narrowed.deals).toBe(bare.deals);
    expect(narrowed.damagedOnly).toBeUndefined();
    expect(bare.filter).toBeUndefined();
    expect(narrowed.filter).not.toBeUndefined();
  });

  it("🛑 the compound's COST half is byte-identical to the bare discard anchor's output", () => {
    const compound = deriveAttackEffect(EX_THEN_210) as EffectOp[];
    expect(compound[0]).toEqual(
      (deriveAttackEffect("Discard all Energy from this Pokémon.") as EffectOp[])[0],
    );
  });

  it("🛑 the two printed nouns map to filters `matchesFilter` already understood (D446)", () => {
    // ZERO new `CardFilter` members: `suffixPokemon` has shipped since D446 and the pair
    // is an `anyOf`, which D245 built. The printed word here is **or** where D446's twin
    // table prints **and** — the same union spelled two ways by the catalog, which is why
    // the two noun tables share both VALUES and neither KEY.
    const pair = (deriveAttackEffect(EX_OR_V_60) as EffectOp[])[0];
    if (pair?.op !== "damageChosen" || pair.filter?.kind !== "anyOf") {
      throw new Error("expected an anyOf filter");
    }
    expect(pair.filter.filters).toHaveLength(2);
    // …and the ORDER is the printed order, `ex` then `V`, which is what the caption
    // renders in §4.
    expect(pair.filter.filters.map((f) => (f.kind === "suffixPokemon" ? f.suffix : f.kind))).toEqual(
      ["ex", "V"],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — WHAT THE GENERALITY WOULD BUY, MEASURED OVER ALL 640 ROWS (D472).
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the class group is a MAP, and the two wider forms are measured and refused", () => {
  /** The shared fragment's class group, re-spelled here rather than exported (the module
      keeps its anchors private), in the three candidate shapes. Group `[4]` of
      `ALSO_BENCHED_SNIPE_BODY`, between the noun and the damaged-body window. */
  const shape = (cls: string) =>
    new RegExp(
      `^This attack (?:also )?does (\\d+) damage to (\\d+) of (your opponent's|your) Benched Pokémon${cls}( that has any damage counters on it)?\\.(?: \\(Don't apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
    );
  const MAPPED = shape("(?: (ex or Benched Pokémon V|ex))?");
  const WHOLE_SUFFIX_VOCABULARY = shape(
    "(?: (?:ex|V|VMAX|VSTAR)(?: or Benched Pokémon (?:ex|V|VMAX|VSTAR))?)?",
  );
  const SATURATING = shape("(?: [^.]+)?");

  it("🛑 the WIDER capture claims EXACTLY the same rows, so it is pure RISK and is refused", () => {
    // D472's rule, and the override rule beside it (D477): the measurement that justified
    // the call is left in EXECUTABLE form, so a successor can re-run it and disagree.
    const mapped = corpusRows().filter(([, s]) => MAPPED.test(s));
    const wide = corpusRows().filter(([, s]) => WHOLE_SUFFIX_VOCABULARY.test(s));
    expect(mapped.map(([, s]) => s).sort()).toEqual(wide.map(([, s]) => s).sort());
    expect(units(mapped)).toBe(units(wide));
    // …and the map's own contribution over the un-narrowed literal is exactly ONE row
    // through this caller (the other printed row arrives through the self-discard anchor).
    const bare = corpusRows().filter(([, s]) => shape("").test(s));
    expect(mapped.length - bare.length).toBe(1);
  });

  it("🛑 the SATURATING form is NOT merely unpaid — it is a KNOWN WRONG ANSWER", () => {
    // D472's rule with the sign flipped, for the second slice running (D482's `(?:also )?`
    // refusal was the first). `( [^.]+)?` claims a THIRD sentence — the per-body MULTIPLY
    // — and this arm has no way to perform it, so it would derive a FLAT hit where the
    // card prints a scaled one: a silent wrong number on a shipped printing.
    const mapped = corpusRows().filter(([, s]) => MAPPED.test(s));
    const saturating = corpusRows().filter(([, s]) => SATURATING.test(s));
    const extra = saturating.filter(([, s]) => !mapped.some(([, m]) => m === s));
    expect(extra.map(([, s]) => s)).toEqual([
      "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]);
    // …and that sentence is genuinely unbuilt at this head, so the saturating form would
    // have LOOKED like a coverage win (D479's class: the census rises and the board lies).
    expect(resolvedByAnyReader(extra[0]?.[1] ?? "")).toBe(false);
  });

  it("🛑 the observable direction is CLOSED: every key the map carries resolves", () => {
    // D442's rule, `SELF_DISCARD_THEN_BENCH_SNIPE`'s move: the alternation is BUILT from
    // the map's keys, so the anchor cannot drop a noun the map carries.
    for (const noun of ["ex", "ex or Benched Pokémon V"]) {
      const constructed = `This attack does 60 damage to 1 of your opponent's Benched Pokémon ${noun}. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
      expect(deriveAttackEffect(constructed), noun).not.toBeNull();
    }
    // …while a noun the map does NOT carry stays LOUD rather than widening the hit. All
    // three are constructed and the column prints none of them (D440's labelling rule).
    for (const noun of ["V", "VMAX", "VSTAR", "GX", "ex or Benched Pokémon VMAX"]) {
      const constructed = `This attack does 60 damage to 1 of your opponent's Benched Pokémon ${noun}. (Don't apply Weakness and Resistance for Benched Pokémon.)`;
      expect(deriveAttackEffect(constructed), noun).toBeNull();
      expect(corpusRows().some(([, s]) => s === constructed), noun).toBe(false);
    }
  });

  it("🛑 THE ALTERNATION ORDER BUYS NOTHING, AND THE ROW THAT PROVED IT IS A SURVIVOR", () => {
    // 🛑 **THIS RUNG EXISTED TO PIN A CLAIM THAT TURNED OUT TO BE FALSE, AND IT IS KEPT
    // WITH THE MEASUREMENT THAT FALSIFIED IT (D178/D442/D475).** It read *"the one place in
    // this file where alternation ORDER is load-bearing: `ex` is a PREFIX of `ex or Benched
    // Pokémon V`, so a shortest-first alternation matches `ex` and strands the rest"* — and
    // its assertion (`filter?.kind === "anyOf"`) was TRUE under both orders, i.e. **silently
    // vacuous**, which is D482's class arriving in a suite for the second slice running.
    //
    // What settled it was a mutant: `D483-class-alternation-shortest-first` SURVIVED the
    // probe. **JavaScript alternation BACKTRACKS** — the short branch leaves bytes the
    // terminator cannot spend, so the engine returns and tries the long one — and the row is
    // now a DECLARED `equivalent` survivor whose reason is this paragraph. The rung is
    // re-pointed onto the property that is actually true, and it is a MEASUREMENT over the
    // whole column rather than a claim about one sentence.
    const withOrder = (nouns: readonly string[]) =>
      new RegExp(
        `^This attack (?:also )?does (\\d+) damage to (\\d+) of (your opponent's|your) Benched Pokémon(?: (${nouns.join("|")}))?( that has any damage counters on it)?\\.(?: \\(Don't apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
      );
    const longestFirst = withOrder(["ex or Benched Pokémon V", "ex"]);
    const shortestFirst = withOrder(["ex", "ex or Benched Pokémon V"]);
    const byLongest = corpusRows().filter(([, s]) => longestFirst.test(s));
    const byShortest = corpusRows().filter(([, s]) => shortestFirst.test(s));
    expect(byLongest.map(([, s]) => s)).toEqual(byShortest.map(([, s]) => s));
    expect(units(byLongest)).toBe(units(byShortest));
    // …and the CONTROL that keeps THAT from being vacuous in its turn: the set is non-empty
    // and it is the pair row that is in it, so both regexes really did reach the sentence
    // whose two keys nest (D424).
    expect(byShortest.map(([, s]) => s)).toContain(EX_OR_V_60);
    // …and the shipped arm still answers the `anyOf`, which is what the old rung asserted and
    // is kept because it is true and cheap — just not a statement about the ORDER.
    const pair = deriveAttackEffect(EX_OR_V_60) as EffectOp[];
    const snipe = pair[0];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.filter?.kind).toBe("anyOf");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE CAPTION, WHICH FOLLOWS THE CALL PATH (D478) AND MAKES A D446 ARM LIVE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the prompt names the class, and it is `retrieveNoun`'s FIRST live suffix arm", () => {
  it("🛑 the singleton caption quotes the printed noun", () => {
    const { state: parked } = swing(loadBearingBoard(), HIT_EX_AFTER_PURGE);
    expect(snipePrompt(parked).note).toBe(
      "Choose 1 of your opponent's Benched Pokémon ex (210 damage each).",
    );
  });

  it("🛑 the PAIR caption is the `anyOf` join, and the one word it does not quote is named", () => {
    // ⚠️ The card prints *"Benched Pokémon ex or **Benched** Pokémon V"*; the caption
    // writes the zone word ONCE, because the join is `retrieveNoun`'s and a second
    // spelling here would be the second answer to one question (D159). Deliberate,
    // unambiguous inside a prompt whose candidates are all Benched, and pinned so it
    // cannot drift into being an accident.
    const { state: parked } = swing(loadBearingBoard(), HIT_EX_OR_V);
    expect(snipePrompt(parked).note).toBe(
      "Choose 1 of your opponent's Benched Pokémon ex or Pokémon V (60 damage each).",
    );
    expect(snipePrompt(parked).note).not.toBe(
      "Choose 1 of your opponent's Benched Pokémon ex or Benched Pokémon V (60 damage each).",
    );
  });

  it("🛑 the UN-NARROWED caption is untouched, which is what makes the two above a claim", () => {
    // D424: every "the caption changed" owes a "and this one did not", or the rung is
    // asserting the renderer rather than the narrowing.
    const { state: parked } = swing(loadBearingBoard(), HIT_ANY_BENCH);
    expect(snipePrompt(parked).note).toBe(
      "Choose 1 of your opponent's Benched Pokémon (40 damage each).",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE LOAD-BEARING BOARD: FOUR BENCHED BODIES, `ex, V, plain, ex`, AND
//      THREE READINGS WHOSE ANSWERS ARE COMPUTED BEFORE THEY ARE ASSERTED.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the candidate set is the class, and every wrong reading is a different set", () => {
  it("🛑 THE THREE READINGS ANSWER THREE DIFFERENT CANDIDATE LISTS ON THIS BOARD", () => {
    // 🛑 **D482's LESSON, PAID IN ADVANCE: COMPUTE WHAT EACH CANDIDATE IMPLEMENTATION
    // WOULD ANSWER BEFORE CHOOSING THE VALUES, AND CONFIRM THE ANSWERS DIFFER.** The
    // symptom of a vacuous discriminator is a CONTROL PASSING, so the discriminator is
    // asserted here as a property of the BOARD, before any number is placed.
    //
    // Bench is `[ex, V, plain, ex]`, so on THIS board:
    //   · the filter honoured, `ex`        → [0, 3]
    //   · the filter honoured, `ex or V`   → [0, 1, 3]
    //   · the filter DROPPED               → [0, 1, 2, 3]
    //   · the zone widened to `opponentAny`→ the Active leads the list
    // Four readings, four lists, and no two of them agree at index 1 or index 2.
    const board = loadBearingBoard();
    const exOnly = offeredBench(snipePrompt(swing(board, HIT_EX_AFTER_PURGE).state).candidates);
    const exOrV = offeredBench(snipePrompt(swing(board, HIT_EX_OR_V).state).candidates);
    const dropped = offeredBench(snipePrompt(swing(board, HIT_ANY_BENCH).state).candidates);
    expect(exOnly).toEqual([0, 3]);
    expect(exOrV).toEqual([0, 1, 3]);
    expect(dropped).toEqual([0, 1, 2, 3]);
    // The three are pairwise DISTINCT — the property the sections below rest on, asserted
    // rather than eyeballed.
    expect(new Set([exOnly, exOrV, dropped].map((l) => l.join(","))).size).toBe(3);
    // …and none of them offers the Active, which is the zone half of the same claim.
    for (const index of [HIT_EX_AFTER_PURGE, HIT_EX_OR_V, HIT_ANY_BENCH]) {
      const prompt = snipePrompt(swing(board, index).state);
      expect(prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
      expect(prompt.candidates.every((ref) => ref.spot.spot === "bench")).toBe(true);
      expect(prompt.min).toBe(1);
      expect(prompt.max).toBe(1);
    }
  });

  it("🛑 the PAIR lands on the body a dropped filter could not reach", () => {
    // Candidate 2 of the `ex or V` list is bench 3; candidate 2 of the UNFILTERED list is
    // bench 2. Two different bodies, two different vectors, one printed index.
    const { state: after } = answerSnipe(swing(loadBearingBoard(), HIT_EX_OR_V).state, 2);
    expect(benchDamages(after, "p2")).toEqual([10, 20, 30, 100]);
    // …and the Active is untouched: this sentence carries no printed `damage` and no
    // `damageDefender`, so the whole attack is the snipe.
    expect(activeDamage(after, "p2")).toBe(40);
  });

  it("🛑 the SINGLETON lands on the second `ex`, which is bench 3 and not bench 1", () => {
    const { state: after } = answerSnipe(swing(loadBearingBoard(), HIT_EX_AFTER_PURGE).state, 1);
    expect(benchDamages(after, "p2")).toEqual([10, 20, 30, 250]);
    // ⚠️ **AND HERE IS THE ONE PLACE THE DAMAGE VECTOR CANNOT DISCRIMINATE, NAMED RATHER
    // THAN LEFT** (D482): at candidate index 1, a DROPPED filter and a filter WIDENED to
    // `ex or V` would BOTH land on bench 1 and answer `[10, 230, 30, 40]`. The vector
    // separates *correct* from *either wrong reading*; it is the candidate LIST above
    // that separates the two wrong readings from each other. Both rungs are load-bearing
    // and neither is redundant.
    expect(benchDamages(after, "p2")).not.toEqual([10, 230, 30, 40]);
  });

  it("🛑 the un-narrowed control lands where the narrowed one cannot", () => {
    // Candidate 2 of the unfiltered list is bench 2 — the plain body, which no narrowed
    // reading offers at all. If this rung and the two above ever agree, the narrowing has
    // stopped narrowing.
    const { state: after } = answerSnipe(swing(loadBearingBoard(), HIT_ANY_BENCH).state, 2);
    expect(benchDamages(after, "p2")).toEqual([10, 20, 70, 40]);
  });

  it("🛑 the hit is FLAT on the Bench: a ×2 Weakness on bench 0 does not double it", () => {
    // §8.5 scopes Weakness and Resistance to the Active/Defending Pokémon. Bench 0 is the
    // only body in the pool carrying a Weakness, and it is Weak to the attacker's own
    // type — so 60 arriving as 60 rather than as 120 is the §8.5 reading DRIVEN and not
    // the fixture being silent.
    const { state: after, events } = answerSnipe(swing(loadBearingBoard(), HIT_EX_OR_V).state, 0);
    expect(benchDamages(after, "p2")).toEqual([70, 20, 30, 40]);
    expect(eventTypes(events)).toContain("DAMAGE_DEALT");
  });

  it("🛑 a filtered set of exactly ONE is FORCED, where the same board PARKS unfiltered", () => {
    // D437's second bullet, at its second address: `stepOp`'s `!declinable &&
    // candidates.length <= op.count` arm is the M1 no-choice rule and it must read the
    // NARROWED count. One `ex` beside two non-`ex` bodies is not a decision — and the
    // proof it is the NARROWING doing this is that the un-narrowed attack on the SAME
    // board still parks with three candidates.
    const oneEx = classTable(["d483-foe-v", "d483-foe-ex", "d483-foe"]);
    const { state: forced } = swing(oneEx, HIT_EX_AFTER_PURGE);
    expect(forced.phase.kind).not.toBe("effect:choose");
    expect(benchDamages(forced, "p2")).toEqual([0, 210, 0]);
    const { state: parks } = swing(oneEx, HIT_ANY_BENCH);
    expect(parks.phase.kind).toBe("effect:choose");
    expect(offeredBench(snipePrompt(parks).candidates)).toEqual([0, 1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE ZERO-MATCH BOARD, WITH THE CONTROLS THAT SEPARATE ITS SILENCE FROM
//      SILENCE FOR ANY OTHER REASON.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — no `ex` on the opponent's side: silent, and the silence is the FILTER's", () => {
  /** No `ex` anywhere: a `V`, a plain body, a plain body. */
  const zeroMatch = () => classTable(["d483-foe-v", "d483-foe", "d483-foe"]);

  it("🛑 the narrowed snipe finds nothing, files no prompt, and is NOT `ATTACK_EFFECT_SKIPPED`", () => {
    // A filtered set can be EMPTY where the unfiltered one was not (D437's first bullet).
    // The op's own `candidates.length === 0` arm turns that into the silent no-op every
    // snipe already takes on an empty Bench — and NOT a skip, because the sentence WAS
    // read.
    const { state: after, events } = swing(zeroMatch(), HIT_EX_AFTER_PURGE);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(benchDamages(after, "p2")).toEqual([0, 0, 0]);
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 CONTROL A — the COST still ran, so the program ran and the snipe alone whiffed", () => {
    // The sharpest control available: this sentence's FIRST op is a cost, and it is paid
    // whether or not the second op finds a body. Two Energy on the attacker before, zero
    // after — a population that moves, not a boolean.
    const board = zeroMatch();
    expect(board.players.p1.active?.energy).toHaveLength(2);
    const { state: after, events } = swing(board, HIT_EX_AFTER_PURGE);
    expect(after.players.p1.active?.energy).toHaveLength(0);
    expect(eventTypes(events)).toContain("ENERGY_DISCARDED");
  });

  it("🛑 CONTROL B — the same board is NOT silent for the PAIR, so the `ex` key is the gate", () => {
    // One axis (D399/D427): the only difference between this attack and the one above is
    // which key of the noun map the sentence spells. The `V` is standing right there —
    // and it is the ONLY match, so this board takes the FORCED arm rather than parking,
    // which is a second reading of §5's M1 rung on a board built for a different purpose.
    const { state: after } = swing(zeroMatch(), HIT_EX_OR_V);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(benchDamages(after, "p2")).toEqual([60, 0, 0]);
  });

  it("🛑 CONTROL C — the same board is NOT silent unfiltered, so the BENCH is not empty", () => {
    const { state: parked } = swing(zeroMatch(), HIT_ANY_BENCH);
    expect(offeredBench(snipePrompt(parked).candidates)).toEqual([0, 1, 2]);
  });

  it("🛑 CONTROL D — an effect-FREE attack separates 'found nothing' from 'no program ran'", () => {
    // The one silence that is NOT this slice's: an attack with no effect text at all moves
    // the Active by its printed box and files no effect row of any kind. If the rung above
    // ever started looking like this one, the program would have stopped running.
    const { state: after, events } = swing(zeroMatch(), NO_EFFECT_AT_ALL);
    expect(activeDamage(after, "p2")).toBe(30);
    expect(after.players.p1.active?.energy).toHaveLength(2);
    expect(eventTypes(events)).not.toContain("ENERGY_DISCARDED");
  });

  it("🛑 CONTROL E — an EMPTY bench is silent too, and for a different reason than the filter", () => {
    // The pre-existing zero, kept beside the new one so a build that collapsed the two
    // (narrowing at the wrong layer, or an `op.filter` read as a bench-length test) has
    // somewhere to die.
    const { state: after } = swing(classTable([]), HIT_EX_OR_V);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.players.p2.bench).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — REFUSALS: THE ONE AXIS, THE UN-PRINTED PAIR, AND THE THREE OTHER CALLERS
//      OF THE SHARED FRAGMENT.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — what the class group refuses, and what it must not have moved", () => {
  it("🛑 the class is the ONE axis, asserted as an INEQUALITY of programs (D449)", () => {
    for (const [narrowed, stripped] of [
      [EX_OR_V_60, EX_OR_V_60.replace(" ex or Benched Pokémon V", "")],
      [EX_THEN_210, EX_THEN_210.replace("Benched Pokémon ex.", "Benched Pokémon.")],
    ] as const) {
      const a = deriveAttackEffect(narrowed) as EffectOp[];
      const b = deriveAttackEffect(stripped) as EffectOp[];
      expect(b, stripped).not.toBeNull();
      expect(a.length, narrowed).toBe(b.length);
      expect(a, narrowed).not.toEqual(b);
      const last = b[b.length - 1];
      expect((last as { filter?: unknown }).filter, stripped).toBeUndefined();
    }
  });

  it("🛑 the class and the damaged-body window are NEVER co-printed, and the PAIR is refused", () => {
    // `CHOSEN_ANY_TARGET`'s D448 rule verbatim: the anchor structurally admits both
    // riders, the legal column prints the composition ZERO times, and resolving it would
    // be authoring (D190b). It falls to the loud path instead of silently preferring one.
    const both =
      "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackEffect(both)).toBeNull();
    expect(corpusRows().some(([, s]) => s === both)).toBe(false);
    // …and each rider ALONE still resolves, which is what keeps the refusal about the
    // PAIR rather than about either one (D424).
    expect(
      deriveAttackEffect(
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).not.toBeNull();
    expect(
      deriveAttackEffect(
        "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).not.toBeNull();
    // The same pair behind the self-discard head, which is the FOURTH caller and the one
    // that would drift if only the first were guarded.
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon, and this attack does 210 damage to 1 of your opponent's Benched Pokémon ex that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBeNull();
  });

  it("🛑 the CLASS noun is number-INVARIANT, unlike the window beside it", () => {
    // The window is printed *"that has … on it"* and `ALSO_BENCHED_SNIPE` refuses it at
    // any count but 1 on that number agreement (D400). The class is *"Pokémon ex"* at
    // every arity — the suffix is part of the printed name and takes no "s" — so NO
    // agreement is owed and none is enforced. Both sentences are constructed and the
    // column prints neither (D440), which is why this rung says what it says rather than
    // pinning a printing.
    const two =
      "This attack does 60 damage to 2 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    const program = deriveAttackEffect(two) as EffectOp[];
    const snipe = program[0];
    if (snipe?.op !== "damageChosen") throw new Error("expected a damageChosen");
    expect(snipe.count).toBe(2);
    expect(corpusRows().some(([, s]) => s === two)).toBe(false);
  });

  it("🛑 the OTHER THREE callers of the shared fragment answer exactly as they did", () => {
    // D383's coupling is the whole reason this slice is one capture rather than two
    // anchors — and it is also the risk, because a fragment edit reaches callers this
    // slice is not about. All three are driven, and the gated one is driven THROUGH the
    // new group as well, because a caller that dropped it would be a second opinion about
    // one printed clause.
    expect(
      deriveAttackEffect(
        "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 30, count: 1, source: "attack", deals: true },
    ]);
    expect(
      deriveAttackEffect(
        "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourDeckAtMost", count: 3 },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "damageChosen", target: "opponentBench", amount: 120, count: 2, source: "attack", deals: true },
        ],
      },
    ]);
    // The GATED caller reads the class too — a constructed sentence, labelled (D440),
    // because the column prints one gated bench snipe and it carries no class.
    const gatedClass = deriveAttackEffect(
      "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ) as EffectOp[];
    const gate = gatedClass[0];
    if (gate?.op !== "conditionGate") throw new Error("expected a conditionGate");
    const inner = gate.then[0];
    if (inner?.op !== "damageChosen") throw new Error("expected a gated damageChosen");
    expect(inner.filter).toEqual({ kind: "suffixPokemon", suffix: "ex" });
    // …and the OWN-SIDE spelling is untouched by the class group (D447's side capture is
    // group 3 and the class is group 4).
    expect(
      deriveAttackEffect(
        "This attack also does 40 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      { op: "damageChosen", target: "yourBench", amount: 40, count: 1, source: "attack", deals: true },
    ]);
  });

  it("🛑 the FOURTH caller REFUSES the class, on the reason it refuses the other two riders", () => {
    // `optionalCostPayoff` is `deriveAttackOptionalCostBoost`'s payoff half, NOT
    // `deriveAttackEffect`'s — a fourth caller of the shared fragment in a DIFFERENT reader,
    // which is exactly the drift the sharing exists to prevent and exactly why it is driven
    // here. Its record is `{amount, count}` — no side, no window, no class —
    // so a narrowed payoff would have to widen `AttackOptionalCostPayoff` and
    // `costSnipeProgram` with it, for a composition NO CARD PRINTS. Dropping it silently
    // would aim a shipped payoff at bodies the card never offered, which D190b/D199 rank
    // strictly below an unbuilt sentence that at least fails loudly.
    const payoff =
      "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 60 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackOptionalCostBoost(payoff)).toBeNull();
    expect(corpusRows().some(([, s]) => s === payoff)).toBe(false);
    // 🛑 **BOTH RIDER REFUSALS ARE ASSERTED, AND THAT IS WHAT KEEPS THE TWO GROUP
    // INDICES APART.** They are adjacent lines reading `snipe[4]` and `snipe[5]`, and this
    // slice moved the second one; a build that swapped them would refuse the class and
    // honour the window — which the class rung above cannot see on its own, because the
    // class sentence is refused either way. The window's own refusal is D437's and is
    // re-driven here rather than assumed to be somebody else's problem.
    const windowed =
      "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    expect(deriveAttackOptionalCostBoost(windowed)).toBeNull();
    expect(corpusRows().some(([, s]) => s === windowed)).toBe(false);
    // …and the CONTROL: the un-narrowed payoff still resolves, so both refusals are the
    // riders' and not the anchor's (D424).
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      )?.payoff,
    ).toEqual({ kind: "benchSnipe", amount: 120, count: 1 });
    // …and THAT one is the printed row (corpus file line 660, 5 legal printings), which is
    // what makes the two refusals above narrowings of a LIVE reader rather than of a dead
    // one (D452: a byte pin on an invented string is green by construction).
    expect(
      corpusRows().some(
        ([, s]) =>
          s ===
          "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
  });

  it("🛑 a printed 0 in EITHER position still stays LOUD alongside the class", () => {
    // The guards are conjuncts of the SAME `if` the class check joined, so an author who
    // reordered them would find out here (D399's one-character rule).
    for (const [bad, good] of [
      [
        "This attack does 0 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        "This attack does 1 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ],
      [
        "This attack does 60 damage to 0 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        "This attack does 60 damage to 1 of your opponent's Benched Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ],
    ] as const) {
      expect(deriveAttackEffect(bad), bad).toBeNull();
      expect(deriveAttackEffect(good), good).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE VERSION, AND THE `MATCH_RECORD_VERSION` ARGUMENT DRIVEN RATHER THAN
//      ARGUED (D463).
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the persisted address, and why 29 does not move", () => {
  it("engineVersion is 0.379.0 and `manifest.version` agrees", () => {
    // `packages/engine` behaviour moved (a new op field, a new candidate funnel branch and
    // a new caption arm), so the version steps.
    expect(engineVersion).toBe("0.379.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 a v29 record that LOST the key resolves to the identical board", () => {
    // 🛑 **THE REACHABILITY ARGUMENT, DRIVEN.** This op PARKS, so `filter` rides
    // `GameState.phase.cont.pendingOp` while the pick is open — which is exactly the
    // shape that cost `source` a `2 → 3` bump at D137. It costs nothing here because
    // `applyChoice`'s `damageChosen` arm hands `choice.refs` straight to `placeSnipe` and
    // never re-derives a candidate set: the narrowing already happened when the prompt was
    // built. So a resumed pick reads this field at NO site.
    //
    // Driven over the SERIALIZED bytes in both directions rather than asserted: the parked
    // state is round-tripped with the key REMOVED from the pending op, and the resumed
    // board is compared with the one the intact record produces.
    const parked = swing(loadBearingBoard(), HIT_EX_AFTER_PURGE).state;
    const wire = JSON.parse(JSON.stringify(parked)) as {
      phase: { cont: { pendingOp: Record<string, unknown> } };
    };
    expect(wire.phase.cont.pendingOp.filter).toEqual({ kind: "suffixPokemon", suffix: "ex" });
    // The v29 record REBUILT without the key rather than with it deleted — same bytes, and
    // `noDelete` is a lint rule this file has no reason to argue with.
    const { filter: _dropped, ...withoutFilter } = wire.phase.cont.pendingOp;
    expect(Object.keys(withoutFilter)).not.toContain("filter");
    const stale = {
      ...wire,
      phase: { ...wire.phase, cont: { ...wire.phase.cont, pendingOp: withoutFilter } },
    } as unknown as GameState;
    const intact = answerSnipe(parked, 1);
    const resumed = answerSnipe(stale, 1);
    expect(benchDamages(resumed.state, "p2")).toEqual(benchDamages(intact.state, "p2"));
    expect(resumed.state.players.p2.bench.map((b) => b.damage)).toEqual([10, 20, 30, 250]);
    // ⚠️ **THE FALSIFIER, NAMED**: the bump is owed the day `applyChoice` re-derives
    // `snipeTargets`. That is one grep, and it is the same falsifier `damagedOnly` left.
  });
});
