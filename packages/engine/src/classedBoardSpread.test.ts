import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import { deriveAttackDamageMultiplier, deriveAttackEffect } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.386.0 → 0.387.0 — 🆕🆕🆕 D492: THE FILTERED WHOLE-SIDE SPREAD.
//
//   file line 616 (2 printings)  "This attack does 60 damage to each of your opponent's
//                                 Pokémon ex. This attack's damage isn't affected by
//                                 Weakness or Resistance."
//   file line 539 (2 printings)  "This attack does 100 damage to each of your opponent's
//                                 Pokémon ex and Pokémon V. This attack's damage isn't
//                                 affected by Weakness or Resistance."
//
// 2 sentences / 4 legal printings over `legalAttackCorpus()`'s 640 / 1,732 — and the
// SENTENCE step and the PRINTING step DISAGREE, 2 and 4, so a `.length` chain takes
// `- 2` where a `units(…)` chain takes `- 4` (D451/D464, MEASURED in §10).
//
// 🛑 **THE RESIDUE CLASSIFIER POINTED AT THE WRONG HALF, AND SO DID THE WORK ORDER.**
// `residue-census.ts` classes both rows `COMPOUND-tail`: cut segment 1 and the remainder
// — the bare W/R suppression sentence — is claimed by `deriveAttackDamageSuppression`.
// That reads as *"the HEAD is the whole blocker; the tail is already built"*, and the
// brief said so in those words. **It is half true.** Substituting the FILTER alone onto
// its nearest BUILT spelling gives *"This attack does 100 damage to each of your
// opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance."*
// and that is REFUSED by all thirteen readers and all four splitters — because
// `splitAttackTrailingClause` requires the TAIL to be a **`deriveAttackEffect`** clause
// and a W/R suppression is a DAMAGE reader's (D466's rule, measured again in §1).
//
// **TWO BLOCKERS, AND BOTH ROWS CARRY BOTH.** §1 runs the whole 2⁵ axis-substitution
// lattice (D489/D491) on each row: the first BUILT point is at Hamming weight **TWO**
// (FILTER + TAIL), no point of weight 0 or 1 builds on either row, and the two rows'
// tables are byte-identical, which is what makes them ONE slice by D488's test rather
// than by resemblance. AMOUNT and SCOPE are measured **INERT** — 0 verdict flips over
// all 16 pairs — and the SCOPE axis is inert for D491's degenerate reason: its printed
// value (the whole side) has BUILT since D482.
//
// 🛑 **THE D482 COMPOSITION DOES NOT TRANSFER, AND EACH OF THE TWO REASONS IS FATAL
// ALONE.** D482 spelled *"…to each of your opponent's Pokémon. (Don't apply …)"* as
// `damageDefender` + `spreadDamage { opponentBench }` with **zero new ops**.
//   · **W/R.** That row's Active leg is `damageDefender`'s flat arm precisely BECAUSE
//     Weakness and Resistance DO apply there — `snipeActive(state, amount, false, …)`,
//     with the `false` spelled at the call site. These rows print the opposite. §4 drives
//     a Weakness ×2 Active and reads 100 where the composition reads 200.
//   · **CONDITIONALITY.** *"each of your opponent's Pokémon ex"* includes the Active ONLY
//     IF the Active is itself an ex. `damageDefender` has no filter and no predicate, so
//     the composition damages a non-ex Active — a WRONG BOARD, not a missing narrowing.
//     §4 drives it and reads 0 where the composition reads 100.
//
// 🛑 **WHAT IT IS INSTEAD IS ONE `damageChosen` OVER MACHINERY THAT ALREADY SHIPS.**
// `snipeTargets` walks `oppAnyRefs` (the Active AND the Bench) and narrows it by
// `op.filter` — D483's field, over `IN_PLAY_BODY_NOUNS`' `suffixPokemon`/`anyOf` values —
// and `placeSnipe` routes an Active ref through `snipeActive(…, ignoreWR)` and every
// benched ref through its flat loop. The one thing missing was the printed *"each of"*,
// which is **`count: "all"`**: one widened quantifier on a shipped field, `discardEnergy
// .count` (D361) and `moveEnergy.max` (D441) being the two precedents for exactly that
// word on exactly that kind of quantifier.
//
// ⚠️ **NOT ZERO, SAID OUT LOUD.** ONE new anchor (`SPREAD_EACH_CLASSED_OPPONENT_POKEMON`),
// ONE new arm (6a-ter), ONE new two-key shortlist over the SHIPPED `IN_PLAY_BODY_NOUNS`,
// ONE widened quantifier (`damageChosen.count: number | "all"`), ONE new local in the
// interpreter's arity block, and ONE conjunct in `cardplay.ts`. **ZERO** new `EffectOp`
// members, `CardFilter` members, `DamageCountSource` members, readers (surface still
// **13**), prompts, choice kinds, parks, deciders, events, error codes, `GameState` /
// `InPlayPokemon` fields, registry rows, `redact.ts` bytes, `packages/schema` bytes or
// `log.ts` bytes. **NO NEW `FIXTURE_POOL` id** — the demonstrator lives in a file-local
// `cardPool` (D414/D452), so every id ladder takes a ZERO term.
//
// 🛑 **`MATCH_RECORD_VERSION` STAYS 29 ON D125's WIDENING, AND BOTH HALVES ARE STATED
// (D463).** The ADDRESS persists: `damageChosen` parks, so it rides
// `phase.cont.pendingOp` into `MatchRecord.state`. `count` is a REQUIRED field gaining a
// new INHABITANT, so every value a v29 writer could put there — a number — still names
// exactly the arity it always named; there is no absent-key direction to get wrong.
// §9 drives it over a reconstructed v29 continuation that answers a DIFFERENT number.
// ⚠️ **And reachability is TRUE here as well and is NOT the argument being made**: the
// only producer returns a program of LENGTH ONE (D465's first-position form), so nothing
// can put this op behind a park — but that is a fact about today's producers, where the
// widening argument is a fact about the bytes.
//
// ⚠️ **ONE THING THE PRINT DOES NOT SAY AND THE ENGINE DOES, RECORDED RATHER THAN
// PINNED (D429).** `ignoreWR` nulls the target's `damageReductionAfterWR` and its
// installed reduction as well as Weakness and Resistance — Umbreon "Feint Attack" prints
// *", or by any effects on that Pokémon"* and these two rows do not. The engine has made
// that same call on the BARE wording since D400 at corpus file line 620, whose anchor's
// doc block states it outright, so following it is a reading with a shipped sibling
// rather than a new decision. Splitting `ignoreWR` into two flags would move that
// printing too and touches every one of its read sites in `interpreter.ts` and
// `attack.ts`. **No rung pins the over-reach**, deliberately: a guard that reddens when
// somebody separates the two flags would actively defend the gap.

const SPREAD_SEED = 492_0492;

/** Corpus FILE LINE 616, byte for byte — 2 legal printings. */
const EX_60 =
  "This attack does 60 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.";
/** Corpus FILE LINE 539, byte for byte — 2 legal printings. */
const EX_V_100 =
  "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. This attack's damage isn't affected by Weakness or Resistance.";
/** The BUILT siblings one PREPOSITION away — corpus FILE LINES 613 (2 printings) and 612
    (1). `deriveAttackDamageMultiplier` has claimed both since D446, and they are the
    collision §6 is about: *"…does 60 damage FOR each…"* and *"…does 60 damage TO each…"*
    answer the SAME NUMBER on any board whose only matching body is a Weakness-free
    Active. */
const FOR_EACH_EX_60 = "This attack does 60 damage for each of your opponent's Pokémon ex in play.";
const FOR_EACH_EX_V_60 =
  "This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play.";
/** D482's shipped whole-side spread — corpus FILE LINE 572, 1 legal printing. The
    UNFILTERED control: every board below is read through this too, because a candidate
    set is only ever wrong RELATIVE to the set the same board would otherwise offer. */
const UNFILTERED_30 =
  "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const HIT_EX_V = 0;
const HIT_EX = 1;
const COUNT_EX_V = 2;
const COUNT_EX = 3;
const UNFILTERED = 4;
const NO_EFFECT = 5;

/** `d492-*` keys with no catalog row behind them (D425), kept out of `FIXTURE_POOL`
    entirely by a file-local `cardPool` (D414/D452).

    ⚠️ **THE BENCH ORDER `ex, V, plain, ex` IS LOAD-BEARING AND IS D483's, RE-EARNED.**
    The non-matching body sits in the MIDDLE, so a build that hit a PREFIX of the bench
    (or that dropped the filter) lands on a different multiset from the correct one, and
    §5's vector separates them at a glance. A bench ordered `ex, ex, V, plain` would make
    "the first two" and "the matching ones" agree.

    ⚠️ **EVERY HP IS CHOSEN SO THAT NO CANDIDATE READING KNOCKS ANYTHING OUT** (D488: a
    board that KOs stops answering a number and starts answering a promotion). The wall's
    500 is the binding one — the `for each` reading at §5 deals 480 through a Weakness.

    ⚠️ **THE NAMES CARRY THE SUFFIX BECAUSE `pokemonSuffixOf` IS NAME-DERIVED**
    (cards.ts): that is this engine's one definition of the printed class, and a fixture
    that set some other field would be testing a mechanism the catalog does not have. */
const SPREAD_CARDS: Record<string, Card> = {
  "d492-sniper": battler("d492-sniper", {
    name: "D492 Sniper",
    types: ["Colorless"],
    hp: 320,
    retreat: 1,
    attacks: [
      // No printed `damage` on any of the five: none of these sentences carries an
      // "also", so the printed sentence IS the attack.
      { cost: ["Colorless"], name: "Rule Purge", effect: EX_V_100 },
      { cost: ["Colorless"], name: "Ex Purge", effect: EX_60 },
      { cost: ["Colorless"], name: "Pair Count", effect: FOR_EACH_EX_V_60 },
      { cost: ["Colorless"], name: "Ex Count", effect: FOR_EACH_EX_60 },
      { cost: ["Colorless"], name: "Wide Wave", effect: UNFILTERED_30 },
      // No effect text at all: the control that separates "the program ran and found
      // nothing" from "no program ran" on the ZERO-MATCH board of §7.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 30 },
    ],
  }),
  /** The defender on the load-bearing board: an `ex` **carrying a Weakness**, which is
      the single byte that makes `ignoreWR` observable on the Active. */
  "d492-wall-ex": battler("d492-wall-ex", {
    name: "D492 Wall ex",
    types: ["Colorless"],
    hp: 500,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  /** The same body with NO Weakness — §6's collision board, and the reason the collision
      is a measurement rather than a claim. */
  "d492-bare-wall-ex": battler("d492-bare-wall-ex", {
    name: "D492 Bare Wall ex",
    types: ["Colorless"],
    hp: 500,
  }),
  /** A defender with NO rule box: §4's conditionality board, where the correct build
      leaves the Active at ZERO and D482's composition does not. */
  "d492-wall": battler("d492-wall", { name: "D492 Wall", types: ["Colorless"], hp: 500 }),
  /** Bench 0 — an `ex`, and **{F}**, because Rock Chestplate `sv01-192` gates its −30 on
      the HOLDER's Fighting type. §8 uses that. */
  "d492-foe-ex": battler("d492-foe-ex", { name: "D492 Foe ex", types: ["Fighting"], hp: 330 }),
  /** Bench 1 — a `V`. The body that separates the printed PAIR from the printed
      singleton, and the body a collapsed noun map stops hitting. */
  "d492-foe-v": battler("d492-foe-v", { name: "D492 Foe V", types: ["Colorless"], hp: 320 }),
  /** Bench 2 — no rule box at all, and it must take ZERO under every printed row here.
      It is the only assertion that separates the filtered build from D482's. */
  "d492-foe": battler("d492-foe", { name: "D492 Foe", types: ["Colorless"], hp: 310 }),
  /** Bench 3 — the SECOND `ex`, so "hit one" and "hit each" differ by more than one
      body and the count reading has something to count. */
  "d492-other-ex": battler("d492-other-ex", {
    name: "D492 Other ex",
    types: ["Colorless"],
    hp: 300,
  }),
};

const SPREAD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SPREAD_CARDS };

/** Its own deck (D270), 60 counted before the first run: 6×8 + 4 + 8. */
const SPREAD_DECK = deckOf({
  "d492-sniper": 6,
  "d492-wall-ex": 6,
  "d492-bare-wall-ex": 6,
  "d492-wall": 6,
  "d492-foe-ex": 6,
  "d492-foe-v": 6,
  "d492-foe": 6,
  "d492-other-ex": 6,
  "sv01-192": 4,
  "fix-energy": 8,
});

function openSpreadTable(first: Seat): GameState {
  const created = createGame({
    seed: SPREAD_SEED,
    decks: { p1: SPREAD_DECK, p2: SPREAD_DECK },
    cardPool: SPREAD_POOL,
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
    placed — every figure below is a POPULATION over a board, so a body the setup shuffle
    happened to place would move an answer silently (`OWN_BENCH_SNIPE_DECK`'s rule). */
function spreadTable(defender: string, oppBench: readonly string[]): GameState {
  let table = openSpreadTable("p2");
  table = mustApply(table, { type: "endTurn", seat: "p2" }).state;
  expect(table.turn).toBe(2);
  table = setActiveFromDeck(table, "p1", "d492-sniper");
  table = setActiveFromDeck(table, "p2", defender);
  table = clearBench(table, "p1");
  table = clearBench(table, "p2");
  table = attachFromDeck(table, "p1", "fix-energy", 2);
  for (const card of oppBench) table = benchFromDeck(table, "p2", card);
  return table;
}

const MIXED_BENCH = ["d492-foe-ex", "d492-foe-v", "d492-foe", "d492-other-ex"] as const;

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** `[active, ...bench]` damage, which is the whole discrimination of §4–§6. */
function damageVector(state: GameState, seat: Seat): number[] {
  return [
    state.players[seat].active?.damage ?? 0,
    ...state.players[seat].bench.map((pokemon) => pokemon.damage),
  ];
}

function eventTypes(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

const corpusRows = () => legalAttackCorpus();
const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((n, [count]) => n + count, 0);

/** Every reader `censusAtHead.test.ts` sweeps with, DERIVED FROM THE MODULE (D417/D419)
    rather than hand-listed, so this file cannot claim "unread by the engine" off a stale
    copy of the surface. §11 pins the identity in both directions. */
const READERS: readonly ((t: string) => unknown)[] = attackReaderSurface().map((name) => {
  const fn = (effectsModule as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`reader ${name} is not a function on effects.ts`);
  return fn as (t: string) => unknown;
});

/** THE PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what this file means by it. */
const program = (amount: number, filter: EffectOp extends never ? never : unknown): EffectOp[] => [
  {
    op: "damageChosen",
    target: "opponentAny",
    amount,
    count: "all",
    source: "attack",
    deals: true,
    ignoreWR: true,
    filter: filter as never,
  },
];

/** The shape THIS SLICE's anchor claims, rebuilt from the same two printed nouns the
    module's `SPREAD_EACH_CLASS_NOUNS` holds. It exists for one reason: **a lattice run
    AFTER the build is not the lattice** (D491). The pre-slice verdict is DERIVED as
    `now && !NEW_ANCHOR.test(point)` rather than quoted from a session that cannot be
    re-run, and §1 additionally pins that the points this pattern claims are EXACTLY the
    ones that moved. Give it a wider alternation and the lattice reddens. */
const NEW_ANCHOR = new RegExp(
  `^This attack does (\\d+) damage to each of your opponent['’]s (Pokémon ex and Pokémon V|Pokémon ex)\\.` +
    ` This attack['’]s damage isn['’]t affected by Weakness or Resistance\\.$`,
);
/** `true` iff some reader claimed the string at the head BEFORE this slice. */
const builtBefore = (text: string) => resolvedByAnyReader(text) && !NEW_ANCHOR.test(text);

const EX_FILTER = { kind: "suffixPokemon", suffix: "ex" } as const;
const EX_V_FILTER = {
  kind: "anyOf",
  filters: [
    { kind: "suffixPokemon", suffix: "ex" },
    { kind: "suffixPokemon", suffix: "V" },
  ],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED DATA, THE 2⁵ LATTICE, AND WHAT THE ANCHOR REACHES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §1 — the two rows, measured live over the legal column", () => {
  it("🛑 both are CORPUS bytes at 2 printings each, and the two steps DISAGREE 2 / 4", () => {
    // D183/D456/D490: the specimen is the printed bytes off the committed column, and
    // its printing count is READ rather than typed — a byte pin on an invented string is
    // green by construction.
    const rows = new Map(corpusRows().map(([n, text]) => [text, n]));
    expect(corpusRows()).toHaveLength(640);
    expect(units(corpusRows())).toBe(1732);
    expect(rows.get(EX_60)).toBe(2);
    expect(rows.get(EX_V_100)).toBe(2);
    // The four neighbours this file reasons about are corpus rows too, at their counts.
    expect(rows.get(FOR_EACH_EX_60)).toBe(2);
    expect(rows.get(FOR_EACH_EX_V_60)).toBe(1);
    expect(rows.get(UNFILTERED_30)).toBe(1);
    // 2 sentences, 4 printings — so a `.length` chain takes `- 2` and a `units(…)` chain
    // takes `- 4`. MEASURED here rather than carried (D451/D461/D464/D465).
    const mine = corpusRows().filter(([, s]) => s === EX_60 || s === EX_V_100);
    expect([mine.length, units(mine)]).toEqual([2, 4]);
    // Apostrophe bytes MEASURED, never remembered (D421/D440): U+0027 in every slot.
    for (const text of [EX_60, EX_V_100]) {
      expect(text.includes("opponent's")).toBe(true);
      expect(text.includes("opponent’s")).toBe(false);
      expect(text.codePointAt(text.indexOf("'"))).toBe(0x0027);
      expect(text.codePointAt(text.lastIndexOf("'"))).toBe(0x0027);
      expect(text.codePointAt(text.indexOf("é"))).toBe(0x00e9);
    }
  });

  it("🛑 THE 2⁵ LATTICE: the first BUILT point is at Hamming weight TWO, on BOTH rows", () => {
    // 🛑 **D489/D491's method, run rather than described.** Each axis is SUBSTITUTED onto
    // its nearest BUILT spelling rather than deleted, so every one of the 32 points is a
    // sentence some reader could in principle claim; the table is then read by Hamming
    // weight. Both rows produce the IDENTICAL table, which is D488's pair-hood test
    // passing — the same test split D483's four-row cluster 2+2.
    const build = (
      amount: string,
      filterPrint: string,
      m: number,
    ): string => {
      const filter = m & 8 ? "Pokémon" : filterPrint;
      const scope = m & 4 ? "Benched " : "";
      const amt = m & 1 ? "30" : amount;
      const core =
        m & 2
          ? // nearest BUILT count spelling: the whole-side form takes " in play", the
            // Benched form (corpus file line 604) does not.
            `This attack does ${amt} damage for each of your opponent's ${scope}${filter}${
              m & 4 ? "" : " in play"
            }.`
          : `This attack does ${amt} damage to each of your opponent's ${scope}${filter}.`;
      const tail =
        m & 16
          ? " (Don't apply Weakness and Resistance for Benched Pokémon.)"
          : " This attack's damage isn't affected by Weakness or Resistance.";
      return core + tail;
    };
    for (const [amount, filterPrint, printed] of [
      ["100", "Pokémon ex and Pokémon V", EX_V_100],
      ["60", "Pokémon ex", EX_60],
    ] as const) {
      // the PRINT is point 0 by construction — checked, not assumed.
      expect(build(amount, filterPrint, 0)).toBe(printed);
      const byWeight = [0, 0, 0, 0, 0, 0];
      const builtByWeight = [0, 0, 0, 0, 0, 0];
      for (let m = 0; m < 32; m++) {
        const weight = [0, 1, 2, 3, 4].filter((b) => m & (1 << b)).length;
        byWeight[weight] = (byWeight[weight] ?? 0) + 1;
        // 🛑 **THE PRE-SLICE VERDICT IS DERIVED, NOT QUOTED (D491).** `resolvedByAnyReader`
        // at THIS head answers about the build that now exists, so the historical verdict
        // is `now && !NEW`, where `NEW` is exactly the set this slice's anchor claims —
        // which is FIVE of the 32 points on each row, not just the print (the AMOUNT axis
        // is a capture, so every amount substitution stays claimed).
        if (builtBefore(build(amount, filterPrint, m))) {
          builtByWeight[weight] = (builtByWeight[weight] ?? 0) + 1;
        }
      }
      expect(byWeight).toEqual([1, 5, 10, 10, 5, 1]);
      // NOTHING at weight 0 or 1 built before this slice: no single axis is the blocker.
      expect(builtByWeight).toEqual([0, 0, 1, 2, 1, 0]);
      // …and the points the new anchor claims are EXACTLY the ones that moved (D491's
      // second half): every point is either unchanged or newly claimed BY THIS ANCHOR.
      for (let m = 0; m < 32; m++) {
        const point = build(amount, filterPrint, m);
        expect(resolvedByAnyReader(point), point).toBe(builtBefore(point) || NEW_ANCHOR.test(point));
      }
    }
    // …and the ONE weight-2 point that builds is FILTER + TAIL together, on both rows —
    // named rather than counted, because a count cannot say WHICH pair.
    expect(
      resolvedByAnyReader(
        "This attack does 100 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
    // Each half of that pair ALONE is refused, which is the whole two-blocker finding.
    expect(
      resolvedByAnyReader(
        "This attack does 100 damage to each of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toBe(false);
    expect(
      resolvedByAnyReader(
        "This attack does 100 damage to each of your opponent's Pokémon ex and Pokémon V. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(false);
  });

  it("🛑 AMOUNT and SCOPE are INERT on the verdict; FORM, FILTER and TAIL each flip 4/16", () => {
    // D491's second reading of the lattice: an axis that never moves the verdict is not
    // carrying its dimension. SCOPE is inert for the DEGENERATE reason D491 names — its
    // printed value (the whole side, no `Benched`) has built since D482 — and AMOUNT is
    // inert because every anchor in this family captures `(\d+)`.
    const build = (m: number): string => {
      const filter = m & 8 ? "Pokémon" : "Pokémon ex and Pokémon V";
      const scope = m & 4 ? "Benched " : "";
      const amt = m & 1 ? "30" : "100";
      const core =
        m & 2
          ? `This attack does ${amt} damage for each of your opponent's ${scope}${filter}${
              m & 4 ? "" : " in play"
            }.`
          : `This attack does ${amt} damage to each of your opponent's ${scope}${filter}.`;
      return (
        core +
        (m & 16
          ? " (Don't apply Weakness and Resistance for Benched Pokémon.)"
          : " This attack's damage isn't affected by Weakness or Resistance.")
      );
    };
    const flips = [0, 1, 2, 3, 4].map((bit) => {
      let n = 0;
      for (let m = 0; m < 32; m++) {
        if (m & (1 << bit)) continue;
        if (builtBefore(build(m)) !== builtBefore(build(m | (1 << bit)))) n++;
      }
      return n;
    });
    // amount, form, scope, filter, tail — over the PRE-SLICE verdict, so the table is the
    // one that priced the slice rather than the one the slice produced.
    expect(flips).toEqual([0, 4, 0, 4, 4]);
    // …and at THIS head the FILTER and TAIL columns each gain one flip, from this slice's
    // own two rows. Stated as a second measurement rather than folded into the first, so
    // the two verdicts cannot be confused for one another.
    const flipsNow = [0, 1, 2, 3, 4].map((bit) => {
      let n = 0;
      for (let m = 0; m < 32; m++) {
        if (m & (1 << bit)) continue;
        if (resolvedByAnyReader(build(m)) !== resolvedByAnyReader(build(m | (1 << bit)))) n++;
      }
      return n;
    });
    expect(flipsNow).toEqual([0, 6, 2, 6, 6]);
  });

  it("🛑 the anchor claims EXACTLY these 2 sentences / 4 printings, and the WIDE spelling claims no more", () => {
    // 🛑 **D472's measurement, run over all 640 rows rather than argued.** Handing the
    // anchor the WHOLE 8-key `IN_PLAY_BODY_NOUNS` map claims the same rows, so the six
    // extra keys would be pure generality — which is why `SPREAD_EACH_CLASS_NOUNS` is a
    // two-key shortlist. The patterns are rebuilt here from the same two spellings the
    // module uses, so the claim is about the SHAPE and not about a private copy.
    const anchorFor = (nouns: readonly string[]) =>
      new RegExp(
        `^This attack does (\\d+) damage to each of your opponent['’]s (${nouns.join(
          "|",
        )})\\. This attack['’]s damage isn['’]t affected by Weakness or Resistance\\.$`,
      );
    const narrow = corpusRows().filter(([, s]) => anchorFor(["Pokémon ex and Pokémon V", "Pokémon ex"]).test(s));
    const wide = corpusRows().filter(([, s]) =>
      anchorFor([
        "Pokémon ex and Pokémon V",
        "Pokémon ex",
        "Evolution Pokémon",
        "Stage 1 Pokémon",
        "Stage 2 Pokémon",
        "Basic Pokémon",
        "Charjabug",
        "Pokémon",
      ]).test(s),
    );
    expect([narrow.length, units(narrow)]).toEqual([2, 4]);
    expect([wide.length, units(wide)]).toEqual([2, 4]);
    expect(new Set(narrow.map(([, s]) => s))).toEqual(new Set([EX_60, EX_V_100]));
  });

  it("🛑 STRUCTURAL disjointness from all three siblings, over the whole column (D467)", () => {
    // No guard and no order dependence: the three neighbours cannot reach a string this
    // anchor claims, for three different structural reasons stated at the declaration.
    // Measured as a population rather than asserted about a specimen (D423).
    for (const [, text] of corpusRows()) {
      const mine = text === EX_60 || text === EX_V_100;
      if (!mine) continue;
      // D482's whole-side anchor ends after a bare `Pokémon.` plus an optional
      // parenthetical; `SPREAD_EACH_BENCH` demands `Benched `; `CHOSEN_ANY_TARGET`
      // demands `to (\d+) of`. All three are refused here, and the readers agree:
      // exactly ONE of the thirteen claims each row.
      const claimers = READERS.filter((read) => read(text) !== null && read(text) !== undefined);
      expect(claimers).toHaveLength(1);
      expect(deriveAttackEffect(text)).not.toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });

  it("🆕🆕🆕 D492 — both sentences are now RESOLVED, and by exactly one reader each", () => {
    // The transition this slice IS, asserted off the MODULE surface rather than off a
    // hand-kept list (D419). ⚠️ **NAMED, NOT BOOLEAN** (D438): the owner is spelled and
    // every other reader is still required to refuse, so the rung cannot go green under a
    // mistaken widening the way `resolvedByAnyReader(x) === true` would.
    for (const text of [EX_60, EX_V_100]) {
      expect(resolvedByAnyReader(text), text).toBe(true);
      expect(deriveAttackEffect(text), text).not.toBeNull();
      for (const read of READERS) {
        if (read === deriveAttackEffect) continue;
        expect(read(text), `${read.name} / ${text}`).toBeNull();
      }
    }
    // …and the four splitters still answer `null` on both: this is a WHOLE-SENTENCE
    // anchor, not a composition (D466's rule, kept executable).
    for (const text of [EX_60, EX_V_100]) {
      expect(effectsModule.splitAttackTrailingClause(text), text).toBeNull();
      expect(effectsModule.splitAttackGateClause(text), text).toBeNull();
      expect(effectsModule.splitAttackRequirementClause(text), text).toBeNull();
      expect(effectsModule.splitAttackCancelClause(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE DERIVED PROGRAMS, AND THE NOUN MAP THEY READ.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §2 — one op, exactly these bytes", () => {
  it("the two programs are exactly these bytes", () => {
    expect(deriveAttackEffect(EX_60)).toEqual(program(60, EX_FILTER));
    expect(deriveAttackEffect(EX_V_100)).toEqual(program(100, EX_V_FILTER));
  });

  it("🛑 the filter values are the SHIPPED map's, byte for byte — one noun, one answer", () => {
    // 🛑 **D159, kept executable.** These two printed nouns are read by a SECOND anchor
    // one preposition away (corpus file lines 612/613), and the whole reason this slice
    // consults `IN_PLAY_BODY_NOUNS` rather than a private pair is that the engine must
    // not answer *"which bodies does 'Pokémon ex and Pokémon V' name"* two ways. The
    // rung is what stops the two drifting: it reads the filter off BOTH readers and
    // requires equality.
    const spread = deriveAttackEffect(EX_V_100) as EffectOp[];
    const hit = spread[0];
    if (hit?.op !== "damageChosen") throw new Error("expected a damageChosen");
    const counted = deriveAttackDamageMultiplier(FOR_EACH_EX_V_60);
    if (counted === null) throw new Error("expected the built sibling to derive");
    const countSource = counted.count as { kind: string; filter?: unknown };
    expect(countSource.kind).toBe("pokemonInPlay");
    expect(hit.filter).toEqual(countSource.filter);
    // …and the same for the singleton noun.
    const exSpread = deriveAttackEffect(EX_60) as EffectOp[];
    const exHit = exSpread[0];
    if (exHit?.op !== "damageChosen") throw new Error("expected a damageChosen");
    const exCounted = deriveAttackDamageMultiplier(FOR_EACH_EX_60);
    if (exCounted === null) throw new Error("expected the built sibling to derive");
    expect(exHit.filter).toEqual((exCounted.count as { filter?: unknown }).filter);
  });

  it("🛑 an unmapped noun and a printed 0 both stay LOUD rather than resolving on a guess", () => {
    // D190b's exact-map-or-flag rule at both of the arm's guards. Constructed strings,
    // LABELLED as constructed (D440): the column prints neither, so these are claims
    // about the READER and not about the pool.
    for (const text of [
      "This attack does 100 damage to each of your opponent's Pokémon VMAX. This attack's damage isn't affected by Weakness or Resistance.",
      "This attack does 100 damage to each of your opponent's Iono's Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      "This attack does 0 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
    // …and the ADMISSION beside the refusals, on ONE axis (D424/D427): the same skeleton
    // with a MAPPED noun and a positive amount resolves.
    expect(
      deriveAttackEffect(
        "This attack does 10 damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      ),
    ).toEqual(program(10, EX_FILTER));
  });

  it("🛑 the SHORTLIST is exactly TWO nouns — the other six map keys stay refused HERE", () => {
    // 🛑 **THE D472 DECISION, LEFT IN EXECUTABLE FORM (D477).** `IN_PLAY_BODY_NOUNS` has
    // eight exact keys and this anchor consults only two of them, because the wider
    // spelling claims the same 2 sentences / 4 printings over the whole column (§1) —
    // generality that buys nothing is pure risk. **The override a successor might want is
    // available**: every one of these six resolves to a filter that would be CORRECT for
    // the sentence, so nothing here is a wrong-card argument. It is a cost argument, and
    // this rung is what makes reversing it a decision rather than a drift.
    //
    // ⚠️ These strings are CONSTRUCTED — the column prints none of them (D440).
    for (const noun of [
      "Pokémon",
      "Basic Pokémon",
      "Evolution Pokémon",
      "Stage 1 Pokémon",
      "Stage 2 Pokémon",
      "Charjabug",
    ]) {
      const text = `This attack does 50 damage to each of your opponent's ${noun}. This attack's damage isn't affected by Weakness or Resistance.`;
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
    // …and the CONTROL on the same axis: the two nouns the shortlist DOES carry, in the
    // same skeleton at the same amount, both resolve (D424).
    for (const [noun, filter] of [
      ["Pokémon ex", EX_FILTER],
      ["Pokémon ex and Pokémon V", EX_V_FILTER],
    ] as const) {
      expect(
        deriveAttackEffect(
          `This attack does 50 damage to each of your opponent's ${noun}. This attack's damage isn't affected by Weakness or Resistance.`,
        ),
      ).toEqual(program(50, filter));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ANCHOR IS WHOLE-SENTENCE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §3 — a leading or trailing clause, a case change or a lost byte is refused", () => {
  it("the anchor is `^…$` and every printed byte in it is load-bearing", () => {
    for (const text of [
      `Draw a card. ${EX_60}`,
      `${EX_60} Your turn ends.`,
      `${EX_V_100} Draw a card.`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      EX_60.toLowerCase(),
      EX_60.toUpperCase(),
      // The W/R sentence is MANDATORY, not an optional tail — the head alone is refused
      // and so is the head under D482's parenthetical.
      "This attack does 60 damage to each of your opponent's Pokémon ex.",
      "This attack does 60 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // The trailing period is required.
      EX_60.slice(0, -1),
      // A non-numeric amount, and a missing one.
      "This attack does X damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      "This attack does damage to each of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      // The possessive is the OPPONENT's — the own-side spelling is refused, which is the
      // failure `D425-spread-side-flips` is about, one anchor over.
      "This attack does 60 damage to each of your Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      // `1 of` is `CHOSEN_ANY_TARGET`'s, not this anchor's.
      "This attack does 60 damage to 1 of your opponent's Pokémon ex. This attack's damage isn't affected by Weakness or Resistance.",
      // The W/R sentence mangled.
      EX_60.replace("Weakness or Resistance", "Weakness and Resistance"),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🛑 the U+2019 re-ingest derives the IDENTICAL program (D440)", () => {
    // The anchor spells `['’]` at all three apostrophes, so a punctuation-normalising
    // re-ingest cannot drop these rows off the built set. Measured, not asserted.
    for (const [text, expected] of [
      [EX_60, program(60, EX_FILTER)],
      [EX_V_100, program(100, EX_V_FILTER)],
    ] as const) {
      expect(deriveAttackEffect(text.replaceAll("'", "’"))).toEqual(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — WHY D482's COMPOSITION DOES NOT TRANSFER, ON THE TWO BOARDS THAT KILL IT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §4 — the two boards on which `damageDefender` + `spreadDamage` is wrong", () => {
  it("🛑 W/R: a Weakness ×2 Active takes the PRINTED number, where the composition doubles it", () => {
    // D482's Active leg is `damageDefender`'s flat arm, which runs `snipeActive(state,
    // amount, false, …)` — the full §8.5 pipeline WITH Weakness. This board has a
    // Weakness ×2 ex in the Active Spot and the printed sentence says W/R do not apply,
    // so the two readings answer 100 and 200. **The number is the claim.**
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const after = swing(board, HIT_EX_V).state;
    expect(damageVector(after, "p2")[0]).toBe(100);
    // …and the CONTROL on the same axis (D424), which is what proves the Weakness is
    // live rather than absent: D482's own shipped row on the same board doubles.
    const wide = swing(board, UNFILTERED).state;
    expect(damageVector(wide, "p2")[0]).toBe(60);
  });

  it("🛑 CONDITIONALITY: a NON-ex Active takes ZERO, where the composition hits it anyway", () => {
    // *"each of your opponent's Pokémon ex"* includes the Active only if the Active IS
    // one. `damageDefender` has no filter, so D482's composition would deal the printed
    // number here — a wrong board, not a missing narrowing.
    const board = spreadTable("d492-wall", MIXED_BENCH);
    const after = swing(board, HIT_EX_V).state;
    expect(damageVector(after, "p2")).toEqual([0, 100, 100, 0, 100]);
    // …and the CONTROL: D482's UNFILTERED row on the identical board hits everything,
    // including the Active and the no-rule-box bench body.
    expect(damageVector(swing(board, UNFILTERED).state, "p2")).toEqual([30, 30, 30, 30, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE LOAD-BEARING BOARD: SIX READINGS, SIX VECTORS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §5 — one board, and every candidate reading answers a different vector", () => {
  // 🛑 **D482/D485/D488: name the board on which the candidates differ BEFORE writing
  // any board.** The six readings and what each would answer on this board, all six
  // computed rather than asserted — the vector is `[active, b0, b1, b2, b3]` over an
  // Active `ex` with a Weakness ×2 and a bench of `ex, V, plain, ex`:
  //
  //   correct (each matching body, flat)        [100, 100, 100,   0, 100]
  //   Bench only (`target: "opponentBench"`)    [  0, 100, 100,   0, 100]
  //   filter dropped (D482's set)               [100, 100, 100, 100, 100]
  //   the pair collapsed to `ex`                [100, 100,   0,   0, 100]
  //   `ignoreWR` dropped                        [200, 100, 100,   0, 100]
  //   the `for each` fold (the built sibling)   [480,   0,   0,   0,   0]
  //
  // Six readings, six distinct vectors, and the last one is the printed sibling that §6
  // is about. A seventh — `count: 1` — does not answer a vector at all: it PARKS.
  it("🛑 the printed PAIR row: 100 to the Active and to every matching benched body, 0 to the rest", () => {
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const { state, events } = swing(board, HIT_EX_V);
    expect(damageVector(state, "p2")).toEqual([100, 100, 100, 0, 100]);
    // FOUR bodies, so FOUR rows — a build that hit one and a build that hit all four
    // cannot both be right about the count of rows.
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(4);
    // The attacker's OWN board is untouched: the side is read off the printed
    // possessive, and a flipped side is `D425-spread-side-flips`' failure.
    expect(damageVector(state, "p1")).toEqual([0]);
  });

  it("🛑 the printed SINGLETON row on the same board: the `V` takes ZERO", () => {
    // The body that separates the printed pair noun from the printed singleton, and the
    // one assertion a collapsed `IN_PLAY_BODY_NOUNS` row cannot survive.
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const { state, events } = swing(board, HIT_EX);
    expect(damageVector(state, "p2")).toEqual([60, 60, 0, 0, 60]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(3);
  });

  it("🛑 it never PARKS, and that is what `count: \"all\"` means", () => {
    // A `count: 1` reading of *"each of"* would offer a choice among four candidates.
    // The printed determiner names no number, so there is no decision — the op resolves
    // inline and the turn ends inside the same action.
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const { state, events } = swing(board, HIT_EX_V);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(eventTypes(events)).not.toContain("EFFECT_PENDING");
    // …and no `phase.cont` was ever written, which is the fact §9's version argument
    // rests on from the other end.
    expect("cont" in state.phase).toBe(false);
  });

  it("🛑 the ATTACK is not skipped and the sentence is SIMULATED", () => {
    // The loud channel is the one thing a "claimed but not built" sentence would still
    // trip (D444's half-a-sentence defect): if the anchor read the sentence and the arm
    // produced nothing, `ATTACK_EFFECT_SKIPPED` would fire naming the whole string.
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    const { events } = swing(board, HIT_EX_V);
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(eventTypes(events)).toContain("ATTACK_DECLARED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE COLLISION: `TO each` AND `FOR each`, ONE PREPOSITION APART.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §6 — the built sibling one preposition away, and the board that hides it", () => {
  it("🛑 THE COLLISION IS REAL: on a Weakness-free Active that is the only `ex`, both answer 60", () => {
    // 🛑 **D486's arithmetic-identity hazard at a PREPOSITION, demonstrated rather than
    // described.** *"…does 60 damage TO each of your opponent's Pokémon ex."* deals 60
    // to that one body flat; *"…does 60 damage FOR each of your opponent's Pokémon ex in
    // play."* multiplies 60 by a count of ONE and deals it to the Active. Same number,
    // same body, same event count. **This is the board a suite writes by default**, and
    // it separates NOTHING.
    const board = spreadTable("d492-bare-wall-ex", ["d492-foe"]);
    expect(damageVector(swing(board, HIT_EX).state, "p2")).toEqual([60, 0]);
    expect(damageVector(swing(board, COUNT_EX).state, "p2")).toEqual([60, 0]);
  });

  it("🛑 …and a WEAKNESS on the Active is what breaks the tie on that same one-body board", () => {
    // One byte apart from the board above. The `for each` fold is §8.5 damage and
    // doubles; the printed spread is flat and does not. **60 against 120 on the smallest
    // board there is.**
    const board = spreadTable("d492-wall-ex", ["d492-foe"]);
    expect(damageVector(swing(board, HIT_EX).state, "p2")).toEqual([60, 0]);
    expect(damageVector(swing(board, COUNT_EX).state, "p2")).toEqual([120, 0]);
  });

  it("🛑 a BENCHED matching body separates them without any Weakness at all", () => {
    // The other exit from the collision, and the one that does not depend on a Weakness:
    // the count fold puts everything on the Active, the spread distributes.
    const board = spreadTable("d492-bare-wall-ex", ["d492-foe-ex", "d492-foe"]);
    expect(damageVector(swing(board, HIT_EX).state, "p2")).toEqual([60, 60, 0]);
    // 60 × 2 matching bodies, all of it on the Active.
    expect(damageVector(swing(board, COUNT_EX).state, "p2")).toEqual([120, 0, 0]);
  });

  it("🛑 the built siblings still answer their OWN numbers on the load-bearing board", () => {
    // D482's rule: a slice that widens a family owes the family's shipped rows on its own
    // boards. Neither sibling moved — the count fold reads FOUR matching bodies for the
    // pair noun and THREE for the singleton, doubles through the Weakness, and lands
    // entirely on the Active.
    const board = spreadTable("d492-wall-ex", MIXED_BENCH);
    expect(damageVector(swing(board, COUNT_EX_V).state, "p2")).toEqual([480, 0, 0, 0, 0]);
    expect(damageVector(swing(board, COUNT_EX).state, "p2")).toEqual([360, 0, 0, 0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE EMPTY CANDIDATE SET.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §7 — an opponent fielding no `ex` and no `V`", () => {
  it("🛑 the attack is legal, resolves, damages nothing and files no damage row", () => {
    // The printed sentence does nothing on this board and that is not a failure: an
    // empty candidate set is a SILENT no-op, exactly as `spreadDamage`'s empty Bench is.
    // ⚠️ It is NOT `ATTACK_EFFECT_SKIPPED` either — the sentence was READ, so the loud
    // channel must stay quiet or it would report an unbuilt sentence (D444).
    const board = spreadTable("d492-wall", ["d492-foe"]);
    const { state, events } = swing(board, HIT_EX_V);
    expect(damageVector(state, "p2")).toEqual([0, 0]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(0);
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(eventTypes(events)).toContain("TURN_ENDED");
  });

  it("…and the CONTROL that keeps that from being vacuous: a printed-damage attack still hits", () => {
    // Without this, "no damage row" passes on a build where the whole attack was refused.
    const board = spreadTable("d492-wall", ["d492-foe"]);
    const { state, events } = swing(board, NO_EFFECT);
    expect(damageVector(state, "p2")).toEqual([30, 0]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE COMPOSITION D483 REFUSED, RE-DRIVEN AT THE SEAM THAT SEPARATES THEM.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §8 — `counterEachAll` names the same set and is still the wrong op", () => {
  it("🛑 the hit is DAMAGE_DEALT with a nulled W/R, never COUNTERS_PLACED", () => {
    // 🛑 **D483 §1 refused `counterEachAll` — which carries a REQUIRED `filter:
    // CardFilter` and a `side: "opponent"`, and therefore names EXACTLY this candidate
    // set — on the DAMAGE MODEL.** The printed verb is *"does N damage"*, which this
    // engine has meant `DAMAGE_DEALT` through the post-W/R fold since D159/D161.
    //
    // ⚠️ **AND THE NUMERIC DISCRIMINATOR THAT WOULD NORMALLY SETTLE IT IS UNAVAILABLE
    // HERE, WHICH IS WORTH SAYING RATHER THAN LEAVING FOR A SUCCESSOR TO REDISCOVER.**
    // D483's argument was that a damage-reduction passive tells the two apart. Under
    // `ignoreWR` it does not: `placeSnipe` reads `seatDamageReduction(…, "othersOnly")`
    // and nulls both the catalog and installed halves, so Rock Chestplate's −30 on a
    // benched holder moves NO number. The board below carries that Tool and reads 100.
    // **The discriminator that survives is the EVENT**, and it is asserted as a shape:
    // a `DAMAGE_DEALT` carrying `base`, an explicit `weakness: null` / `resistance: null`
    // and a `dealt`, which `COUNTERS_PLACED` has no fields for at all.
    let board = spreadTable("d492-wall-ex", MIXED_BENCH);
    board = attachToolFromDeck(board, "p2", 0, "sv01-192");
    const { state, events } = swing(board, HIT_EX_V);
    expect(damageVector(state, "p2")).toEqual([100, 100, 100, 0, 100]);
    expect(eventTypes(events)).not.toContain("COUNTERS_PLACED");
    const rows = events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      if (row.type !== "DAMAGE_DEALT") throw new Error("filtered wrong");
      expect(row.seat).toBe("p2");
      expect(row.by).toBe("p1");
      expect(row.base).toBe(100);
      expect(row.weakness).toBeNull();
      expect(row.resistance).toBeNull();
      expect(row.dealt).toBe(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — `MATCH_RECORD_VERSION`, DRIVEN OVER RECONSTRUCTED v29 BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §9 — the widened quantifier over a v29 record", () => {
  // 🛑 **THE ADDRESS PERSISTS AND THE ARGUMENT IS D125's WIDENING, NOT REACHABILITY.**
  // `damageChosen` PARKS, so it rides `phase.cont.pendingOp` into `MatchRecord.state`;
  // reachability is TRUE for this slice's own producer only because that producer emits
  // a program of LENGTH ONE (D465's first-position form), which is a fact about today's
  // arms rather than about the bytes. What settles the constant is that `count` is a
  // REQUIRED field gaining a new INHABITANT: every value a v29 writer could put there is
  // a NUMBER, and a number still names exactly the arity it always named. There is no
  // absent-key direction to get wrong (D441's question does not arise).
  //
  // ⚠️ The constant itself lives in `apps/api/src/lobby/match.ts` and is not exported
  // from this package, so it is not imported here; what IS driven is the claim the
  // constant protects.
  const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };
  /** The v29 spelling of the SAME op, reconstructed by hand and LABELLED as constructed
      (D440) — a byte string a v29 deploy really could have written, differing from this
      slice's output in exactly ONE key. */
  const V29_SNIPE = {
    op: "damageChosen",
    target: "opponentAny",
    amount: 100,
    count: 1,
    source: "attack",
    deals: true,
    ignoreWR: true,
    filter: EX_V_FILTER,
  } as unknown as EffectOp;

  it("🛑 the two ops differ in exactly ONE key, which is what makes this a claim about the quantifier", () => {
    const derived = (deriveAttackEffect(EX_V_100) as EffectOp[])[0];
    if (derived === undefined) throw new Error("expected a program");
    const differing = Object.keys(derived).filter(
      (k) =>
        JSON.stringify((derived as unknown as Record<string, unknown>)[k]) !==
        JSON.stringify((V29_SNIPE as unknown as Record<string, unknown>)[k]),
    );
    expect(differing).toEqual(["count"]);
    // The v29 bytes survive a JSON round trip unchanged — this is what a record holds.
    expect(JSON.parse(JSON.stringify(V29_SNIPE))).toEqual(V29_SNIPE);
  });

  it("🛑 a v29 `count: 1` over the SAME board still asks for ONE and PARKS", () => {
    // The LOSS direction, driven through the real interpreter rather than argued. Four
    // matching candidates and a printed arity of one is a genuine decision, so the op
    // parks — which is exactly what those bytes meant before this slice.
    const state = spreadTable("d492-wall-ex", MIXED_BENCH);
    const events: GameEvent[] = [];
    const run = runProgram(state, [V29_SNIPE], ctx, events);
    if (run.kind !== "parked") throw new Error("expected a park");
    if (run.prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect([run.prompt.min, run.prompt.max]).toEqual([1, 1]);
    expect(run.prompt.candidates).toHaveLength(4);
  });

  it("🛑 and the NEW byte on the SAME board answers differently — the control for both", () => {
    // Both directions or neither (D441). A rung that only drives the old bytes passes on
    // a build that ignores the new inhabitant entirely.
    const state = spreadTable("d492-wall-ex", MIXED_BENCH);
    const events: GameEvent[] = [];
    const run = runProgram(state, deriveAttackEffect(EX_V_100) as EffectOp[], ctx, events);
    expect(run.kind).toBe("done");
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([100, 100, 100, 0, 100]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — THE CENSUS, AND THE VERSION PIN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D492 §10 — the residue this slice moved, and the engine version", () => {
  it("engineVersion is 0.400.0 and `manifest.version` agrees", () => {
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe("0.400.0");
  });

  it("🛑 the reader surface is still THIRTEEN, derived from the module", () => {
    // D444: `deriveAttack…` is a RESERVED NAMESPACE with nothing but a string behind it,
    // so a new export would enrol itself as a reader. This slice added none.
    expect(attackReaderSurface()).toHaveLength(13);
    expect(READERS).toHaveLength(13);
  });

  it("🛑 the RAW residue fell by exactly 2 sentences / 4 printings", () => {
    const unbuilt = corpusRows().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([100, 154]);  // (🆕🆕🆕 **D513 −1 sentence / −1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). 🛑 **ALL FOUR SHIPPED IN-PLAY ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the opposite answer to D510's, because every one of them requires the literal `for each of your ` and this sentence's head is SEATLESS. −**1 sentence / −2 printings**, so this RAW mirror falls with it.) (🆕🆕🆕 **D510 −1 sentence / −2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 −1 sentence / −1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D505 −1 sentence / −3 printings — THE PRIZE-SCALED BENCH SPREAD, THE MISSING CELL OF A SHIPPED 2×2** — `censusAttackCorpus.ts` **FILE LINE 517**, *"This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 3 legal printings**, claimed by `deriveAttackEffect` arm **6-i** over ONE new anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`) and ONE OPTIONAL BOOLEAN RIDER on the SHIPPED `spreadDamage` (`perTakenPrize` — D448's own name spelled on a second op, so `snipeAmount`'s structural parameter folds it UNCHANGED). **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), prompts, choice kinds, parks, events, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3**, so a `.length` site takes −1 where a `units(…)` site takes −3 — the largest single printing step left in the residue's spread family, and the reason this row was worth taking before smaller ones (D451, re-paid again).) (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) 
    // …and neither of this slice's rows is in it any more, which is the only way this
    // rung reads as a measurement of THIS head (D483's move).
    expect(unbuilt.map(([, s]) => s)).not.toContain(EX_60);
    expect(unbuilt.map(([, s]) => s)).not.toContain(EX_V_100);
  });

  it("🛑 the printed rule-box class over the whole column, re-measured", () => {
    // D477/D425: publish the PATTERN, not a list. This is D483 §1's pattern verbatim, so
    // the two files cannot disagree about the population.
    const CLASS = /Pokémon (ex|V|VMAX|VSTAR|V-UNION)\b/;
    const named = corpusRows().filter(([, s]) => CLASS.test(s));
    expect([named.length, units(named)]).toEqual([20, 30]);
    const residue = named.filter(([, s]) => !resolvedByAnyReader(s));
    // 4 → 2 sentences and 6 → 2 printings: this slice took both SPREAD rows, and what is
    // left is the source-side prevention and the parenthetical gloss — neither of which
    // is a target narrowing at all.
    expect([residue.length, units(residue)]).toEqual([2, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — THE SURFACE GUARD (D417/D419/D444).
// ─────────────────────────────────────────────────────────────────────────────

// 🛑 **THE ATTRIBUTION CONTROL, RUN AT BOTH LAYERS, AND THE MAP IT PRODUCED (D491).**
// Two mutations were applied by hand, each restored in a `finally` with size AND sha256
// verified: a READER break (the arm emits `target: "opponentBench"`) and an EXECUTOR
// break (`ceiling` reads `"all"` as an arity of one). Each of four witness kinds was run
// against each, alone:
//
//   | witness kind                                   | reader | executor |
//   |------------------------------------------------|--------|----------|
//   | census (`censusAtHead.test.ts`)                 | green  | green    |
//   | loud control (`boardWideSpread.test.ts`)        | green  | green    |
//   | value re-point (`classNarrowedBenchSnipe` §1)   | **RED**| green    |
//   | behavioural (THIS FILE)                         | **RED**| **RED**  |
//
// So the census and the loud controls are blind to BOTH layers — under either break the
// sentence still reads, `resolvedByAnyReader` is still true and the residue still falls
// by 2 / 4 — the value re-point covers the READER only, and only a behavioural suite
// covers the EXECUTOR. Stated here so a later slice does not read a green family suite
// as coverage of the program this reading builds.
//
// 🛑 **AND THE DESCRIBER OBLIGATION IS EMPTY, TRACED THROUGH THE CALL SITE RATHER THAN
// ARGUED FROM THE OP'S CATEGORY (D478/D489).** `snipeNote` has exactly ONE caller —
// `interpreter.ts`'s `damageChosen` PARK branch — and `count: "all"` takes the forced
// branch above it on every board, so no caption is built. `describeBranch` and
// `describeCondition` have exactly one caller each, `withConsequence`, which returns the
// prompt unchanged unless `recordSlotOf(op)` is defined; `damageChosen` is not one of
// its seven recording ops. And `log.ts` needs nothing: the events are `DAMAGE_DEALT`,
// which every snipe and every spread in the engine already renders.

describe("D492 §11 — the reader list is the module's, in both directions", () => {
  it("🛑 every member of the surface is a function on `effects.ts`, and the SETS are equal", () => {
    const names = attackReaderSurface();
    const fromModule = Object.keys(effectsModule).filter(
      (k) =>
        k.startsWith("deriveAttack") &&
        typeof (effectsModule as unknown as Record<string, unknown>)[k] === "function",
    );
    expect(new Set(names)).toEqual(new Set(fromModule));
    expect(names.length).toBe(fromModule.length);
  });
});
