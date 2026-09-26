import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter, EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D539 — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND
// IT, AND THE ONE BODY THE SHIPPED MACHINERY COULD NOT REACH.
//
// `censusAttackCorpus.ts` **FILE LINE 595** — *"This attack does 50 damage for each of
// your Drifloon and Drifblim in play. This attack also does 30 damage to each of your
// Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*
// — **1 sentence / 2 legal printings** (`legalAttackCorpus()` index **542**, leading
// count column `2`). It is the LAST UNBUILT ROW OF TWO FAMILIES AT ONCE, re-measured
// live at this head in §9: `/This attack also does /` reads **17 sentences / 41
// printings** and `/ damage to each of /` reads **11 / 20**, and :595 was the only
// unbuilt member of either.
//
// ⚠️ **NO CARD ID IS RESOLVED FOR THIS SENTENCE ON THIS CHECKOUT, AND THAT WAS
// MEASURED** (D425, conventions.md "When a card id cannot be resolved"). A whole-repo
// `git grep -F` of the printed sentence at this head returns the corpus row,
// `bodiesInPlayScaling.test.ts`'s refusal rungs and one docs paragraph — no id and no
// card name anywhere. `catalogManifest.ts:197` does hold `sv01-089 Drifloon`, but its
// attacks are `["Gust", "Balloon Blast"]`, a DIFFERENT attack, which is exactly the
// two-populations trap conventions.md:155 records. So this suite rides FILE-LOCAL
// DECLARED demonstrators, `d539-*`, in D538's `d538-pile-sniper` shape.
//
// ⚠️ **THEIR CARD *NAMES* ARE THE PRINTED ONES AND THAT IS NOT AN INVENTION.** The
// derived filter is `byName`, which compares `card.name`; a demonstrator named
// anything else would make the whole slice vacuous. The ID is declared and local; the
// NAME is the printed noun the sentence itself carries.
//
// engine 0.423.0 → 0.424.0. ONE new whole-compound anchor (`NAMED_BODIES_MULTIPLY_
// SPREAD`, with a `\2` BACKREFERENCE), ONE new `IN_PLAY_BODY_NOUNS` row (the NINTH
// exact key), ONE new arm in `deriveAttackDamageMultiplier`, ONE new arm in
// `deriveAttackEffect`, ONE new value on the persisted union `damageChosen.target`
// (`"yourAny"`) and, in the interpreter, `snipeTargets`' fourth `case`, `snipeNote`'s
// widened parameter and — the site the compiler could NOT name — `placeSnipe`'s
// own-side ACTIVE leg. **ZERO new `EffectOp` members, zero new `count` kinds, zero new
// `CardFilter` members, zero new prompt kinds, zero new events, zero new readers** —
// `attackReaderSurface()` stays **13**, and `attack.ts` takes ZERO code bytes.
//
// 🛑 **ONE ANCHOR, TWO READERS, ONE `effect` STRING — D493/D494's ROUTE FOR THE THIRD
// TIME.** `deriveAttackDamageMultiplier` claims the whole compound for the × fold and
// `deriveAttackEffect` claims the same whole compound for the own-side spread;
// `attack.ts:1708` binds `derivedHead` UNCONDITIONALLY and the `damageMultiplier`
// ternary at `attack.ts:1761-1764` is GUARDED by `damageBonus !== null`, so a sentence
// both claim reaches both bindings with no branch GIVEN `deriveAttackDamageBonus(PRINTED)`
// is null — §3 quotes BOTH bindings out of `attack.ts` and DRIVES that premise.
//
// The COMPOSITION seam was RE-PRICED at this head before it was declined and §1
// re-runs that arithmetic: the narrowest splitter widening that would reach this row
// admits **0 sentences / 0 printings** and leaves all eleven currently-split rows
// byte-identical.
//
// 🛑 **A GREEN CENSUS IS SATISFIED BY HALF THIS SLICE, AND §4 IS THE ANSWER.** The
// MULTIPLIER arm alone flips `resolvedByAnyReader`, steps `BUILT.attack` by 2 and moves
// every census figure — with the own-side spread never happening. So §4 asserts **HP on
// a board**, not op shape: the 50-per-body fold over 1/2/3 bodies, the 30 landing on
// EVERY named body INCLUDING THE ATTACKER ITSELF, a Weakness-carrying named body taking
// exactly 30, unnamed own bodies taking nothing, and the opponent's board untouched by
// the second half. `D539-effect-arm-deleted` and `D539-target-becomes-yourbench` are
// the two rows that no census figure and no caption can see.
//
// 🛑 **`MATCH_RECORD_VERSION` HELD AT 30, BOTH D450 DOORS DRIVEN OVER THE SERIALIZED
// BYTES (D427).** Door 1, the carrier: `damageChosen` rides `phase.cont.pendingOp` ONLY
// when it PARKS, and `count: "all"` resolves INLINE and never parks, so no record that
// can exist holds the new value. Door 2, the alphabet: the union WIDENS at a persisted
// address — D125's free case, and D447 added `"yourBench"` to THIS EXACT UNION and held
// the version. §7 drives both directions in `ownBenchSnipe.test.ts` §3's shape.
// ─────────────────────────────────────────────────────────────────────────────

/** The printed sentence, READ off the corpus in §1 and used as a constant everywhere
    else. Retyped ONCE, here, and §1's first rung is what proves the bytes agree. */
const PRINTED =
  "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The three printed PARTS, each on its own. The first is `IN_PLAY_BODY_MULTIPLY`'s
    shape and IS claimed on its own; the other two are not — which is the whole-compound
    claim made executable rather than asserted in prose. */
const PART_1 = "This attack does 50 damage for each of your Drifloon and Drifblim in play.";
const PART_2 = "This attack also does 30 damage to each of your Drifloon and Drifblim.";
const PART_3 = "(Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The MISMATCHED-NOUN twin: the `\2` backreference's own falsifier, CONSTRUCTED and
    labelled so (D440). Identical to `PRINTED` in every byte but the second noun. */
const MISMATCHED = PRINTED.replace(
  "to each of your Drifloon and Drifblim.",
  "to each of your Pokémon ex.",
);

/** The filter the printed noun resolves to — ONE object, and the SAME resolution both
    readers reach through `inPlayBodyFilter`. */
const PAIR_FILTER: CardFilter = {
  kind: "anyOf",
  filters: [
    { kind: "byName", name: "Drifloon" },
    { kind: "byName", name: "Drifblim" },
  ],
};

/** The derived PROGRAM, spelled once. ONE op, and NO `ignoreWR`. */
const PROGRAM: EffectOp[] = [
  {
    op: "damageChosen",
    target: "yourAny",
    amount: 30,
    count: "all",
    source: "attack",
    deals: true,
    filter: PAIR_FILTER,
  },
];

/** The derived × FOLD, spelled once. Byte-identical in shape to the arm one line up in
    `effects.ts` — nothing new is introduced on this interface. */
const FOLD = {
  per: 50,
  count: { kind: "pokemonInPlay", seat: "you", filter: PAIR_FILTER },
};

const BLIMP = "d539-drifblim";
const FRAIL_BLIMP = "d539-drifblim-frail";
const WEAK_BLIMP = "d539-drifblim-weak";
const LOON = "d539-drifloon";
const WEAK_LOON = "d539-drifloon-weak";
const PLAIN = "d539-plain";
const WALL = "d539-wall";
const ENERGY = "fix-energy";

/** The attack list every demonstrator Drifblim carries. Index 0 is the PRINTED row;
    index 1 is the CONTROL (same attacker, same cost, no effect text, a flat 10) so that
    "no park and no board change" is a claim about the op rather than about the board. */
const ATTACKS = [
  // ⚠️ **NO PRINTED `damage` ON INDEX 0, AND THAT IS A DECLARATION RATHER THAN A
  // PRINTING'S FACT** (no id is resolved, D425). `attack.ts` drops the printed base to
  // ZERO whenever a multiply reader consumed the clause, so a printed number here would
  // be unreachable anyway — it is omitted so every point of HP this suite counts came
  // from the fold or the op, and a rung reading 100 cannot be read as 90 + 10.
  { cost: ["Colorless"], name: "Balloon Swarm", effect: PRINTED },
  { cost: ["Colorless"], name: "Plain Tap", damage: 10 },
  // THE MISMATCHED-NOUN near miss, declared so §1 can drive the backreference through a
  // REAL ATTACK rather than through the deriver alone: it must reach the LOUD
  // `ATTACK_EFFECT_SKIPPED` path.
  { cost: ["Colorless"], name: "Mismatched", effect: MISMATCHED },
];

const blimp = (id: string, hp: number): Card =>
  battler(id, { name: "Drifblim", hp, retreat: 1, types: ["Colorless"], attacks: [...ATTACKS] });

const LOCAL_CARDS: Record<string, Card> = {
  [BLIMP]: blimp(BLIMP, 250),
  /** §5's attacker: 30 HP, so its OWN 30 Knocks it Out mid-attack. */
  [FRAIL_BLIMP]: blimp(FRAIL_BLIMP, 30),
  /** 🆕🛑 **THE ATTACKER ITSELF CARRYING A WEAKNESS ×2, AND IT EXISTS BECAUSE THE
      BENCH COULD NOT ASK THE QUESTION.** A Weakness on an own BENCH body is not a
      measurement of the no-`ignoreWR` reading at all: the bench loop applies W/R in NO
      build of this engine, so `WEAK_LOON` on the bench reads 30 whatever the Active leg
      does. The discriminating board is a Weakness in the ATTACKER's OWN ACTIVE SPOT,
      which is the only spot `yourAny` newly reaches and the only one where a copy of
      `placeSnipe`'s opponent-side Active arm would have doubled it. 250 HP so the rung
      reads damage and not a Knock Out. */
  [WEAK_BLIMP]: battler(WEAK_BLIMP, {
    name: "Drifblim",
    hp: 250,
    types: ["Colorless"],
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
    attacks: [...ATTACKS],
  }),
  [LOON]: battler(LOON, { name: "Drifloon", hp: 200, types: ["Colorless"], retreat: 1 }),
  /** The same printed NAME carrying a **Weakness ×2** — the single byte that makes the
      no-`ignoreWR` reading observable on a body of the attacker's own. */
  [WEAK_LOON]: battler(WEAK_LOON, {
    name: "Drifloon",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  /** An own-side body the printed noun does NOT name. It must take ZERO under every
      rung here, and it is the only assertion that separates the filtered spread from an
      unfiltered one (`D539-filter-dropped`). */
  [PLAIN]: battler(PLAIN, {
    name: "D539 Plain",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    // It carries the SAME attack list, so §6 can ask the printed sentence from a body
    // the printed noun does NOT name — the empty-candidate-set board.
    attacks: [...ATTACKS],
  }),
  /** The defender. 500 HP and NO Weakness, so every rung reads damage rather than a
      Knock Out and the × fold is not confounded by the §8.5 pipeline. */
  [WALL]: battler(WALL, { name: "D539 Wall", hp: 500, types: ["Colorless"], retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its own deck (D270's rule), 60 counted before the first run: 7 × 6 + 18. */
const DECK = deckOf({
  [BLIMP]: 6,
  [FRAIL_BLIMP]: 6,
  [WEAK_BLIMP]: 6,
  [LOON]: 6,
  [WEAK_LOON]: 6,
  [PLAIN]: 6,
  [WALL]: 6,
  [ENERGY]: 18,
});

const SEED = 539;

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["./{attack,effects,interpreter}.ts"], { query: "?raw", import: "default", eager: true });
const raw = (suffix: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(suffix))?.[1] ?? "";

function openTable(): GameState {
  const created = createGame({ seed: SEED, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  return table;
}

/** p1 owns TURN 2 with `attacker` Active and exactly `ownBench` behind it; p2 is the
    Wall with exactly `foeBench`. **BOTH benches are cleared before anything is placed**
    — every figure below is a POPULATION over a board, so a body the setup shuffle
    happened to leave in place would move an answer silently. */
function table(
  attacker: string,
  ownBench: readonly string[],
  foeBench: readonly string[] = [],
): GameState {
  let state = openTable();
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", attacker);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of ownBench) state = benchFromDeck(state, "p1", id);
  for (const id of foeBench) state = benchFromDeck(state, "p2", id);
  return fuel(state, "p1", 1);
}

/** TEST SURGERY — attach `count` copies of `fix-energy` off `seat`'s deck onto its
    Active, so the printed cost is payable. */
function fuel(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    const side = next.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    const uid = side.deck.find((u) => next.cardIdByUid[u] === ENERGY);
    if (uid === undefined) throw new Error(`${seat}'s deck lacks ${ENERGY}`);
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          active: { ...body, energy: [...body.energy, uid] },
          deck: side.deck.filter((u) => u !== uid),
        },
      },
    };
  }
  return next;
}

function swing(state: GameState, index = 0) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** `[active, ...bench]` damage — the whole discrimination of §4. */
function damageVector(state: GameState, seat: Seat): number[] {
  return [
    state.players[seat].active?.damage ?? 0,
    ...state.players[seat].bench.map((pokemon) => pokemon.damage),
  ];
}

const eventTypes = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);
const corpusRows = () => legalAttackCorpus();
const units = (rows: readonly (readonly [number, string])[]) =>
  rows.reduce((n, [count]) => n + count, 0);

/** Every reader `censusAtHead.test.ts` sweeps with, DERIVED FROM THE MODULE (D417/D419)
    rather than hand-listed, so this file cannot claim "unread by the engine" off a stale
    copy of the surface. */
const READERS: readonly ((t: string) => unknown)[] = attackReaderSurface().map((name) => {
  const fn = (effectsModule as unknown as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`reader ${name} is not a function on effects.ts`);
  return fn as (t: string) => unknown;
});
const claimedByAny = (text: string): boolean => READERS.some((read) => read(text) !== null);

/** THIS SLICE's anchor, rebuilt here from the printed bytes. It exists for one reason:
    a "what did this slice move" question asked AFTER the build is not that question
    (D491). The pre-slice verdict is DERIVED as `now && !NEW_ANCHOR.test(row)` rather
    than quoted from a session that cannot be re-run, and §9 pins that the rows this
    pattern claims are EXACTLY the ones that moved. */
const NEW_ANCHOR =
  /^This attack does (\d+) damage for each of your ((?!opponent)[^.]+) in play\. This attack also does (\d+) damage to each of your \2\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;
const builtBefore = (text: string) => resolvedByAnyReader(text) && !NEW_ANCHOR.test(text);

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE CORPUS ROW, THE ANCHOR, AND THE ROUTE THAT WAS PRICED AND DECLINED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §1 — the corpus row and the whole-compound anchor", () => {
  it("🛑 the row is READ by index and by units, never retyped (D183/D456)", () => {
    const row = corpusRows()[542];
    expect(row?.[1]).toBe(PRINTED);
    // The LEADING COUNT COLUMN is the printing count and the unit the census delta is
    // measured in — 1 sentence, 2 legal printings. ⚠️ THIS ROW IS WHY D539's sentence
    // step and printing step DISAGREE (1 against 2), the FIFTH consecutive slice on
    // which they have.
    expect(row?.[0]).toBe(2);
    // EXACTLY ONE row carries this string: the sentence is the key of the census delta,
    // so a duplicate would double-count the printings under one build.
    expect(corpusRows().filter(([, s]) => s === PRINTED)).toEqual([[2, PRINTED]]);
  });

  it("🛑 the printed BYTES: U+0027 at 150, U+00E9 at 198, length 204", () => {
    // Counted off the corpus rather than off this file's own literal, because the two
    // could disagree and the corpus is the population the census measures.
    const printed = corpusRows()[542]?.[1] ?? "";
    expect(printed).toHaveLength(204);
    expect(printed.charCodeAt(150)).toBe(0x27);
    expect(printed.charCodeAt(198)).toBe(0xe9);
    // ONE apostrophe slot, COUNTED: the sentence spells no possessive at all, only the
    // contraction in "Don't", so a successor cannot quietly add a slot it does not have.
    expect((printed.match(/'/g) ?? []).length).toBe(1);
  });

  it("🛑 the sentence is READ by `resolvedByAnyReader` — the census delta's own predicate", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("🛑 the SURFACE did not grow: a new ARM is not a new READER (D447)", () => {
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 THE `\\2` BACKREFERENCE, DRIVEN BOTH WAYS — matched nouns match", () => {
    // The mechanism: the card multiplies by the SAME bodies it then splashes on. The
    // capture is read ONCE and the second printing of the noun must be the SAME bytes.
    const m = NEW_ANCHOR.exec(PRINTED);
    expect(m?.[1]).toBe("50");
    expect(m?.[2]).toBe("Drifloon and Drifblim");
    expect(m?.[3]).toBe("30");
  });

  it("🛑 …and MISMATCHED nouns REFUSE — the falsifier, through both readers", () => {
    // CONSTRUCTED, and labelled so (D440). `MISMATCHED` differs from `PRINTED` in
    // exactly the second noun, and BOTH nouns are ones the vocabulary can spell — so
    // the refusal is the BACKREFERENCE's and not the map's. `D539-anchor-drops-the-
    // backreference` is the experiment this rung is the killer for.
    expect(MISMATCHED).not.toBe(PRINTED);
    expect(MISMATCHED.replace("Pokémon ex", "Drifloon and Drifblim")).toBe(PRINTED);
    expect(NEW_ANCHOR.test(MISMATCHED)).toBe(false);
    expect(deriveAttackEffect(MISMATCHED)).toBeNull();
    expect(deriveAttackDamageMultiplier(MISMATCHED)).toBeNull();
    expect(resolvedByAnyReader(MISMATCHED)).toBe(false);
  });

  it("🛑 …and the CONTROL on the same axis: swapping BOTH nouns together still reads", () => {
    // D424 — a refusal rung needs a control, or it passes on a build that refuses
    // everything. Both nouns moved to the SAME other vocabulary word, and the pattern
    // claims it again.
    const both = PRINTED.replaceAll("Drifloon and Drifblim", "Pokémon ex");
    expect(both).not.toBe(PRINTED);
    expect(NEW_ANCHOR.test(both)).toBe(true);
    expect(deriveAttackDamageMultiplier(both)).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "suffixPokemon", suffix: "ex" },
      },
    });
  });

  it("🛑 the `^` refuses a printed prefix and the `$` refuses a printed continuation", () => {
    // 🛑 **THIS RUNG'S FIRST DRAFT DID NOT TEST THE `^` AT ALL, AND THE PROBE SAID SO.**
    // Lower-casing the leading `T` to glue the sentence onto a prefix makes the string
    // refuse for a DIFFERENT reason — the pattern demands a capital `This` wherever it
    // starts — so `D539-anchor-loses-its-caret` SURVIVED the first probe as a real GAP.
    // The killer is a prefix that KEEPS the capital: with the `^` gone, the pattern
    // matches from the second sentence on and the engine authors a program for a card
    // whose leading clause it silently dropped. Both spellings are kept, because they
    // refuse for two different reasons and only one of them is about the anchor.
    expect(deriveAttackEffect(`Discard an Energy from this Pokémon. ${PRINTED}`)).toBeNull();
    expect(deriveAttackDamageMultiplier(`Discard an Energy from this Pokémon. ${PRINTED}`)).toBeNull();
    // …and the CONTROL that keeps it a measurement (D424): the identical string WITHOUT
    // the prefix is claimed, so the refusal is the anchor's and not the vocabulary's.
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(
      deriveAttackEffect(`Flip a coin. If heads, ${PRINTED[0]?.toLowerCase()}${PRINTED.slice(1)}`),
    ).toBeNull();
    expect(deriveAttackEffect(`${PRINTED} Then, discard an Energy from this Pokémon.`)).toBeNull();
    // …and the terminator itself: dropping the final `)` is one byte and must refuse.
    expect(deriveAttackEffect(PRINTED.slice(0, -1))).toBeNull();
    // `D539-anchor-loses-its-caret` / `D539-anchor-loses-its-terminator`.
  });

  it("🛑 the `['’]` class on `Don't` — the slot CURLS and derives IDENTICALLY (D136/D137)", () => {
    const curly = PRINTED.replace("Don't", "Don’t");
    expect(curly).not.toBe(PRINTED);
    expect((curly.match(/'/g) ?? []).length).toBe(0);
    // EQUALITY, never merely non-null: a non-null check passes on a reader that folded
    // the sentence into some other row.
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
    expect(deriveAttackEffect(curly)).toEqual(PROGRAM);
    expect(deriveAttackDamageMultiplier(curly)).toEqual(FOLD);
  });

  it("the LOOKALIKE `Pokemon` is not `Pokémon` — the one occurrence", () => {
    expect(PRINTED.split("Pokémon")).toHaveLength(2);
    expect(deriveAttackEffect(PRINTED.replace("Pokémon", "Pokemon"))).toBeNull();
  });

  it("a NON-BREAKING SPACE anywhere in the sentence is NOT this sentence", () => {
    const nbsp = PRINTED.replace("does 50", "does\u00a050");
    expect(nbsp).not.toBe(PRINTED);
    expect(deriveAttackEffect(nbsp)).toBeNull();
  });

  it("🛑 the `(?!opponent)` LOOKAHEAD is kept, and it is driven (D407)", () => {
    // The slot is a CAPTURE, so without the lookahead `for each of your ` would admit a
    // printed `opponent's …` noun and score the OPPONENT's sentence off the ATTACKER's
    // board. CONSTRUCTED, and labelled so — the column prints no such compound today,
    // which is exactly why the lookahead is insurance rather than a live refusal.
    const foe = PRINTED.replaceAll("of your Drifloon and Drifblim", "of your opponent's Pokémon");
    expect(NEW_ANCHOR.test(foe)).toBe(false);
    expect(deriveAttackEffect(foe)).toBeNull();
    // …and the CONTROL: the identical string with the owner prefix removed is claimed.
    const mine = PRINTED.replaceAll("of your Drifloon and Drifblim", "of your Pokémon");
    expect(NEW_ANCHOR.test(mine)).toBe(true);
  });

  it("🛑 the anchor claims EXACTLY 1 of 640 rows / 2 of 1,732 printings", () => {
    const rows = corpusRows();
    expect(rows).toHaveLength(640);
    expect(units(rows)).toBe(1732);
    const claimed = rows.filter(([, text]) => NEW_ANCHOR.test(text));
    expect(claimed).toEqual([[2, PRINTED]]);
    expect(units(claimed)).toBe(2);
  });

  it("🛑 DISJOINT FROM `IN_PLAY_BODY_MULTIPLY` BY `$` ALONE, in both directions", () => {
    // That anchor requires ` in play.` at END OF STRING, and its `[^.]+` cannot cross
    // the break — so it cannot reach this compound…
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(FOLD);
    expect(raw("effects.ts")).toContain(
      "const IN_PLAY_BODY_MULTIPLY =\n  /^This attack does (\\d+) damage for each of your ((?!opponent)[^.]+) in play\\.$/;",
    );
    // …and this anchor cannot reach that one's rows, which is the other direction and
    // the one a `$`-argument usually forgets.
    expect(NEW_ANCHOR.test(PART_1)).toBe(false);
    expect(deriveAttackEffect(PART_1)).toBeNull();
    // PART_1 IS claimed by the shipped anchor on its own, which is what makes the two
    // patterns a real pair rather than one pattern and one dead string.
    expect(deriveAttackDamageMultiplier(PART_1)).toEqual(FOLD);
  });

  it("🛑 …and from `IN_PLAY_BODY_SCALE`, which additionally demands ` more damage`", () => {
    const more = PART_1.replace("does 50 damage", "does 50 more damage");
    expect(deriveAttackDamageBonus(more)).toEqual(FOLD);
    expect(NEW_ANCHOR.test(more)).toBe(false);
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
  });

  it("🛑 no corpus row matches this anchor AND any other reader's whole-sentence claim", () => {
    // The anchor is new, so "claimed by something else too" is a question about the
    // BUILD and not about history: a row both this pattern and a shipped reader claim
    // would be a row whose program depends on arm order.
    for (const [, text] of corpusRows()) {
      if (!NEW_ANCHOR.test(text)) continue;
      expect(builtBefore(text)).toBe(false);
    }
  });

  it("🛑 the COMPOSITION ROUTE IS STILL REFUSED, and all three kept rungs are RE-MEASURED", () => {
    // `effects.ts:15919`'s refusal paragraph is kept as the record of a price that came
    // true (D442/D466). Every clause of it is still literally true at this head:
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(deriveAttackEffect(PART_3)).toBeNull();
    // …and the reason is the SPLIT SHAPE: THREE parts, so the tail is the parenthetical.
    expect(PRINTED.split(/(?<=\.)\s+(?=[A-Z(])/)).toEqual([PART_1, PART_2, PART_3]);
  });

  it("🛑 THE SPLITTER WIDENING WAS RE-PRICED HERE: 0 sentences / 0 printings (D493)", () => {
    // The narrowest widening that would reach this row — REGLUE a `(`-leading part onto
    // its predecessor, so the parenthetical stops being the tail. Simulated over all 640
    // rows rather than argued, because "the seam buys nothing" is a MEASUREMENT.
    const BREAK = /(?<=\.)\s+(?=[A-Z(])/;
    const widened = (text: string): { head: string; tail: string } | null => {
      const trimmed = text.trim();
      if (claimedByAny(trimmed)) return null;
      const parts: string[] = [];
      for (const part of trimmed.split(BREAK)) {
        if (part.startsWith("(") && parts.length > 0) parts[parts.length - 1] += ` ${part}`;
        else parts.push(part);
      }
      if (parts.length < 2) return null;
      const tail = parts[parts.length - 1] ?? "";
      const head = parts.slice(0, -1).join(" ");
      if (deriveAttackEffect(tail) === null) return null;
      if (!claimedByAny(head)) return null;
      return { head, tail };
    };
    let admitted = 0;
    let admittedUnits = 0;
    let changed = 0;
    let splitToday = 0;
    for (const [count, text] of corpusRows()) {
      const shipped = splitAttackTrailingClause(text);
      const wide = widened(text);
      if (shipped !== null) splitToday++;
      if (JSON.stringify(shipped) !== JSON.stringify(wide)) changed++;
      if (shipped === null && wide !== null) {
        admitted++;
        admittedUnits += count;
      }
    }
    // The seam admits NOTHING on its own and disturbs NOTHING that ships — so the
    // anchor buys the row for one regex and the shared splitter is left alone.
    expect([admitted, admittedUnits]).toEqual([0, 0]);
    expect(changed).toBe(0);
    // …and the ELEVEN currently-split rows are the population that argument is about,
    // which is the trailing-split census figure §9 pins UNMOVED.
    expect(splitToday).toBe(11);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE NINTH EXACT KEY, AND THE VOCABULARY RE-DERIVED AT THE NEW COUNT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §2 — the `IN_PLAY_BODY_NOUNS` row", () => {
  it("🛑 the printed noun resolves to the PAIR, as an `anyOf` and not an intersection", () => {
    // D245's argument for the combinator: the printed "and" names a SET each body is
    // asked about ONE AT A TIME. An intersection reading would name bodies that are both
    // a Drifloon and a Drifblim, of which the pool has none — a sentence that scores 0
    // forever. Driven through the READER, so the map row is asserted where it is used.
    expect(deriveAttackDamageMultiplier(PART_1)).toEqual(FOLD);
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("🛑 …and HALF the key is not the key: neither name alone resolves to the pair", () => {
    // `D539-map-value-single-byname` collapses the `anyOf` to one `byName` and scores
    // HALF the board. The two singular spellings are NOT map rows, so they fall to the
    // typed branch, miss `CLAUSE_POKEMON_TYPES` and reach the trailing `null`.
    for (const half of ["Drifloon", "Drifblim"]) {
      const text = `This attack does 50 damage for each of your ${half} in play.`;
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });

  it("🛑 the ninth key RESOLVES and carries no apostrophe — the half of the vocabulary this suite can reach", () => {
    // ⚠️ **NO DERIVATION IS CLAIMED HERE, AND D539 WITHDREW THE CLAIM THAT THERE WAS ONE.**
    // `IN_PLAY_BODY_NOUNS` is module-private to `effects.ts` — it is not exported, so no
    // suite can read `.size` at all — and `benchNounScaling.test.ts` §5's `9 + 11 + 11 = 31`
    // is a HAND LIST plus a HAND SUM: when the ninth key landed in this slice, both the list
    // and the literal were moved BY HAND and nothing went RED in between. What §5 DOES
    // derive is the stronger half — every listed key is driven THROUGH
    // `deriveAttackDamageMultiplier`, so a key that stops RESOLVING reddens even though a
    // key that stops EXISTING does not (`effects.ts`'s map block and `index.ts`'s D539
    // entry carry the same withdrawal).
    //
    // This rung asserts only the part that is this slice's and that it can actually reach:
    // the ninth key is a key, it reaches a reading, and it carries no apostrophe — which is
    // the whole of what `inPlayBodyFilter`'s disjointness argument (and `D439-vocabulary-
    // order-loses-the-owner`'s declared reason) needs from a new exact key.
    expect(deriveAttackDamageMultiplier(PART_1)).not.toBeNull();
    expect(/['’]s Pokémon$/.test("Drifloon and Drifblim")).toBe(false);
    // …and it does NOT reach the owner branch, which is the disjointness made executable
    // rather than argued: a key with a possessive would resolve down two branches.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 50 damage for each of your Drifloon and Drifblim's Pokémon in play.",
      ),
    ).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "ownerPokemon", owner: "Drifloon and Drifblim" },
      },
    });
  });

  it("⚠️ the CONSEQUENCE, stated rather than discovered: the other anchors read it too", () => {
    // D466/D467's own stated consequence at a third key — a reader is a function of
    // TEXT, and a noun the column does not print simply never arrives. Asserted so the
    // widening is a decision on the record rather than a surprise.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 10 damage for each of your Drifloon and Drifblim in play.",
      ),
    ).toEqual({ ...FOLD, per: 10 });
    // …and the column prints NEITHER of the two sentences that widening makes readable.
    const readable = [
      "for each of your Drifloon and Drifblim in play.",
      "for each Drifloon and Drifblim on your Bench.",
    ];
    for (const fragment of readable) {
      expect(corpusRows().filter(([, t]) => t.includes(fragment) && t !== PRINTED)).toEqual([]);
    }
  });

  it("🛑 an UNMAPPED noun leaves the sentence LOUD rather than resolving on a guess (D190b)", () => {
    // `D539-map-row-dropped` is the experiment: with the row gone, `inPlayBodyFilter`
    // answers `null`, both arms decline, and the sentence falls to the skip path.
    const ancient = PRINTED.replaceAll("Drifloon and Drifblim", "Ancient Pokémon");
    expect(NEW_ANCHOR.test(ancient)).toBe(true); // the PATTERN claims it…
    expect(deriveAttackEffect(ancient)).toBeNull(); // …and the VOCABULARY refuses it
    expect(deriveAttackDamageMultiplier(ancient)).toBeNull();
  });

  it("🛑 a printed ZERO is not a real card — the `per >= 1` guard, on both arms", () => {
    const zero = PRINTED.replace("does 50 damage for", "does 0 damage for");
    expect(deriveAttackDamageMultiplier(zero)).toBeNull();
    const zeroSpread = PRINTED.replace("also does 30 damage", "also does 0 damage");
    expect(deriveAttackEffect(zeroSpread)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — TWO READERS, ONE STRING, AND THE PROGRAM OF EACH.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §3 — both readers claim the whole compound off ONE `effect` string", () => {
  it("🛑 `deriveAttackDamageMultiplier` claims it — the exact fold", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(FOLD);
  });

  it("🛑 `deriveAttackEffect` claims it — the exact program, ONE op", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    expect(deriveAttackEffect(PRINTED)).toHaveLength(1);
  });

  it("🛑 the op carries NO `ignoreWR`, and the KEY IS ABSENT rather than false", () => {
    // §8.5 scopes W/R to the Defending Pokémon; the parenthetical is the spread family's
    // standard reminder, not a suppression. D492's opponent-side twin DOES set the flag
    // off a genuinely different printed sentence, which is what makes this a reading
    // rather than an omission. `D539-*` cannot make the key false — only present.
    const op = deriveAttackEffect(PRINTED)?.[0];
    expect(op).toBeDefined();
    expect(Object.keys(op ?? {})).toEqual([
      "op",
      "target",
      "amount",
      "count",
      "source",
      "deals",
      "filter",
    ]);
    expect("ignoreWR" in (op ?? {})).toBe(false);
  });

  it("🛑 the two readers resolve the SAME noun to the SAME filter (D159)", () => {
    const fold = deriveAttackDamageMultiplier(PRINTED);
    const op = deriveAttackEffect(PRINTED)?.[0];
    if (op === undefined || op.op !== "damageChosen") throw new Error("expected a damageChosen");
    // ONE question, ONE answer — asserted by VALUE across the two readers, because a
    // build that narrowed the fold and widened the spread would multiply by one
    // population and splash on another with every log row reading correctly.
    expect(JSON.stringify(op.filter)).toBe(
      JSON.stringify((fold?.count as { filter: CardFilter } | undefined)?.filter),
    );
  });

  it("🛑 neither PART is claimed as this compound — the whole-string claim, executable", () => {
    expect(deriveAttackEffect(PART_2)).toBeNull();
    expect(deriveAttackDamageMultiplier(PART_2)).toBeNull();
    expect(deriveAttackEffect(PART_3)).toBeNull();
    expect(claimedByAny(PART_2)).toBe(false);
  });

  it("🛑 `attack.ts` binds BOTH readers on the SAME string — the route, quoted from `attack.ts`", () => {
    // D493/D494's shape for the third time: no branch is needed because a sentence both
    // readers claim simply reaches both bindings off ONE `effect` string. `attack.ts`
    // takes ZERO code bytes this slice, so the claim is about ITS source and is quoted
    // from ITS source — the glob above carries `attack.ts` for exactly this rung.
    //
    // ⚠️ **AND THE HONEST WORD IS NOT "UNCONDITIONALLY".** Only `derivedHead` is
    // unconditional; the multiplier binding is GUARDED by `damageBonus !== null`, so the
    // route is "both readers reach this sentence GIVEN `deriveAttackDamageBonus(PRINTED)`
    // is null" — and that premise is not narrated here: this rung DRIVES it itself, in
    // its own closing `expect(deriveAttackDamageBonus(PRINTED)).toBeNull()` below.
    const source = raw("attack.ts");
    expect(source).toContain(
      '  const derivedHead = effect === null || effect === "" ? null : deriveAttackEffect(effect);',
    );
    expect(source).toContain(
      [
        "  const damageMultiplier =",
        '    damageBonus !== null || effect === null || effect === ""',
        "      ? null",
        "      : deriveAttackDamageMultiplier(effect);",
      ].join("\n"),
    );
    // The guard's premise, driven rather than assumed, so this rung cannot read as a
    // claim the shipped code does not make.
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE BOARD. THE SECTION THIS SLICE IS REALLY ABOUT.
//
// 🛑 A GREEN CENSUS IS SATISFIED BY HALF THIS SLICE: the multiplier arm alone flips
// `resolvedByAnyReader`, steps `BUILT.attack` by 2 and moves every census figure, with
// the own-side spread never happening. So every rung below asserts HP on a board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §4 — the fold, and the 30 that lands on every named body", () => {
  it("🛑 (a) the × fold over ONE named body in play: 50 to the defender", () => {
    // The attacker alone is a Drifblim, and it counts itself — "in play" is the whole
    // board, and the printed noun names the attacker.
    const { state } = swing(table(BLIMP, [PLAIN]));
    expect(damageVector(state, "p2")).toEqual([50]);
  });

  it("🛑 (a) TWO named bodies: 100", () => {
    const { state } = swing(table(BLIMP, [LOON, PLAIN]));
    expect(damageVector(state, "p2")).toEqual([100]);
  });

  it("🛑 (a) THREE named bodies: 150 — and the step is the PRINTED 50, not a constant", () => {
    const { state } = swing(table(BLIMP, [LOON, LOON, PLAIN]));
    expect(damageVector(state, "p2")).toEqual([150]);
    // `D539-multiplier-arm-deleted` deals NO base at all here, because `attack.ts` drops
    // the printed base to zero for a multiply clause and this attack prints none.
  });

  it("🛑 (b) THE ATTACKER ITSELF TAKES 30 — the mechanism `yourAny` introduces", () => {
    // 🛑 **THE RUNG THE WHOLE SLICE TURNS ON.** `target: "yourBench"` typechecks, ships,
    // logs a plausible board and SILENTLY SPARES THE ATTACKER; `count: "all"` never
    // parks, so no caption contradicts it and NO CENSUS FIGURE MOVES.
    // `D539-target-becomes-yourbench` is killable by this assertion and by nothing else
    // in this repo.
    const { state } = swing(table(BLIMP, [LOON, PLAIN]));
    expect(damageVector(state, "p1")).toEqual([30, 30, 0]);
  });

  it("🛑 (b) …and `placeSnipe` reaches the own ACTIVE even with NO own bench at all", () => {
    // The board on which the bench funnel is EMPTY: without the own-side Active leg the
    // op returns at `targeted.size === 0` and the attack deals nothing to itself, with
    // `tsc` green and no event to say so — D447's silent no-op, one spot over.
    const { state, events } = swing(table(BLIMP, []));
    expect(damageVector(state, "p1")).toEqual([30]);
    expect(damageVector(state, "p2")).toEqual([50]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(2);
  });

  it("🛑 (c) A NAMED BODY CARRYING A WEAKNESS TAKES EXACTLY 30 — the no-`ignoreWR` reading", () => {
    // Driven, not argued. ×2 on a Colorless attacker would read 60 if the own-side legs
    // ran the §8.5 pipeline; §8.5 scopes Weakness to the DEFENDING Pokémon and neither
    // an own bench body nor the attacker is it.
    //
    // ⚠️ **THIS BOARD IS THE CONTROL AND NOT THE MEASUREMENT, AND SAYING SO IS THE
    // POINT** (D424): the Weakness here is on an own BENCH body, and the own-side bench
    // loop applies W/R in NO build of this engine — so 30 on this board is consistent
    // with BOTH readings of the Active leg. The rung beneath it is the one that
    // discriminates.
    const { state } = swing(table(BLIMP, [WEAK_LOON, PLAIN]));
    expect(damageVector(state, "p1")).toEqual([30, 30, 0]);
  });

  it("🛑 (c) THE DISCRIMINATING BOARD IS THE ATTACKER'S OWN ACTIVE SPOT — still exactly 30", () => {
    // 🛑 The attacker itself carries the ×2, and the attacker's own Active is the ONE
    // spot `yourAny` newly reaches. It is also the only spot where a copy of
    // `placeSnipe`'s opponent-side Active arm — which runs the full §8.5 pipeline —
    // would have doubled the printed 30. `D539-own-active-leg-doubles-a-weakness` routes
    // this leg through `snipeActive`, and THIS is the rung that reads the reading rather
    // than the seat.
    const { state } = swing(table(WEAK_BLIMP, [PLAIN]));
    expect(damageVector(state, "p1")).toEqual([30, 0]);
    // …and the fold still COUNTED it: one named body in play is the attacker itself.
    expect(state.players.p2.active?.damage).toBe(50);
  });

  it("🛑 (c) …and that hit's DAMAGE_DEALT row reports NO Weakness, rather than a doubled one", () => {
    // The log and the board agree, which is D433's class: a row reading `base 30 / ×2 /
    // dealt 60` under a board that moved 30 would be the same defect one field over.
    const { events } = swing(table(WEAK_BLIMP, [PLAIN]));
    const own = events.filter(
      (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> =>
        e.type === "DAMAGE_DEALT" && e.seat === "p1",
    );
    expect(own.map((r) => [r.base, r.weakness, r.dealt])).toEqual([[30, null, 30]]);
  });

  it("🛑 (c) …and the WEAKNESS IS LIVE, which is what makes the rung a measurement (D424)", () => {
    // The CONTROL on the same axis: the identical Weakness in the DEFENDING spot doubles
    // the fold, off the same attacker and the same board. Without this, "30" is
    // consistent with a board that has no Weakness on it at all.
    let state = table(BLIMP, [PLAIN]);
    state = setActiveFromDeck(state, "p2", WEAK_LOON);
    // p2's Active is now a Drifloon — which the printed noun NAMES, so the fold counts
    // the attacker only: a seat-confused build would count it and read 100.
    const after = swing(state).state;
    expect(after.players.p2.active?.damage).toBe(100); // 50 × 1, ×2 Weakness
  });

  it("🛑 (d) an UNNAMED own body takes NOTHING — the filter, on a board", () => {
    // `D539-filter-dropped` hits the attacker's whole board. Three own bodies, one of
    // them unnamed, and the vector separates the two builds by one number.
    const { state } = swing(table(BLIMP, [LOON, PLAIN, PLAIN]));
    expect(damageVector(state, "p1")).toEqual([30, 30, 0, 0]);
    // 🛑 …and the ROW COUNT: two bodies took it, so there are exactly two own-side
    // `DAMAGE_DEALT` rows plus the defender's. A build that hit all four reads four.
    const { events } = swing(table(BLIMP, [LOON, PLAIN, PLAIN]));
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(3);
  });

  it("🛑 (e) THE OPPONENT'S BOARD IS UNTOUCHED BY THE SECOND HALF", () => {
    // `D539-target-becomes-opponentany` hits across the table: the defender would take
    // 100 + 30 and the opposing bench 30 each. The possessive is read off the printed
    // sentence, and a flipped side is `D425-spread-side-flips`' failure at a new op.
    const { state } = swing(table(BLIMP, [LOON], [LOON, PLAIN]));
    expect(damageVector(state, "p2")).toEqual([100, 0, 0]);
    expect(damageVector(state, "p1")).toEqual([30, 30]);
  });

  it("🛑 (e) …even when the OPPONENT fields the very bodies the noun names", () => {
    // The sharpest board for the seat: p2's bench is two Drifloon. A build reading the
    // noun without the seat splashes across the table; the printed *"your"* says it does
    // not, and the fold still counts only p1's.
    const { state } = swing(table(BLIMP, [LOON], [LOON, LOON]));
    expect(damageVector(state, "p2")).toEqual([100, 0, 0]);
    expect(damageVector(state, "p1")).toEqual([30, 30]);
  });

  it("🛑 it never PARKS, and that is what `count: \"all\"` means", () => {
    const { state, events } = swing(table(BLIMP, [LOON, PLAIN]));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(eventTypes(events)).not.toContain("EFFECT_PENDING");
    // …and no `phase.cont` was ever written, which is the fact §7's version argument
    // rests on from the other end.
    expect("cont" in state.phase).toBe(false);
  });

  it("🛑 the ATTACK is not skipped and the sentence is SIMULATED", () => {
    const { events } = swing(table(BLIMP, [LOON, PLAIN]));
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(eventTypes(events)).toContain("ATTACK_DECLARED");
  });

  it("🛑 the MISMATCHED-NOUN near miss is LOUD through a real attack, not merely null", () => {
    // Driven through the attack rather than through the deriver alone: the sentence is
    // read by nothing, so the engine says so on the loud channel.
    const { events } = swing(table(BLIMP, [LOON, PLAIN]), 2);
    expect(eventTypes(events)).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the CONTROL attack moves neither board's own side", () => {
    // Same attacker, same cost, no effect text — so every "no own-side damage" verdict
    // above is a claim about the OP rather than about the board.
    const { state } = swing(table(BLIMP, [LOON, PLAIN]), 1);
    expect(damageVector(state, "p1")).toEqual([0, 0, 0]);
    expect(damageVector(state, "p2")).toEqual([10]);
  });

  it("🛑 the DAMAGE_DEALT rows name the DAMAGED body's seat and the ATTACKER as dealer", () => {
    // D447's reading at a new member: `seat` is the damaged body's and `by` is always
    // the attacker, so on the own-side legs the two coincide and the log reads
    // "p1 dealt … to p1".
    const { events } = swing(table(BLIMP, [LOON, PLAIN]));
    const rows = events.filter(
      (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
    );
    expect(rows.map((r) => [r.seat, r.by, r.dealt])).toEqual([
      ["p2", "p1", 100],
      ["p1", "p1", 30],
      ["p1", "p1", 30],
    ]);
    // …and the own-side rows carry NO Weakness and NO Resistance, explicitly rather than
    // by omission — the field is present and null, which is what the log renders.
    for (const row of rows.slice(1)) {
      expect(row.weakness).toBeNull();
      expect(row.resistance).toBeNull();
    }
  });

  it("🛑 the ACTIVE leg is FIRST, and the order is `ownInPlayRefs`' (Active, then bench)", () => {
    // Observable rather than cosmetic: each hit files its own row, and an own-side KO is
    // swept afterwards, so the order is what a replay renders.
    const { events } = swing(table(BLIMP, [LOON]));
    const rows = events.filter(
      (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
    );
    expect(rows.map((r) => r.seat)).toEqual(["p2", "p1", "p1"]);
  });

  it("⚠️ the PLACEMENT arm of the own-side Active leg, driven through a CONSTRUCTED op", () => {
    // No printing reaches it today. It exists because `placeSnipe`'s opponent-side
    // Active leg four lines up draws the same `deals` distinction, and a function whose
    // two Active legs disagreed about it would be two readings of one rule (D131/D159).
    // CONSTRUCTED and labelled so (D440); D205's boundary is that an arm a test can
    // reach is not an arm no build can reach.
    const state = table(BLIMP, [LOON, PLAIN]);
    const events: GameEvent[] = [];
    const placed = {
      op: "damageChosen",
      target: "yourAny",
      amount: 20,
      count: "all",
      source: "attack",
      filter: PAIR_FILTER,
    } as unknown as EffectOp;
    const run = runProgram(state, [placed], { seat: "p1", invokedBy: "attack" }, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p1")).toEqual([20, 20, 0]);
    // A placed counter is NOT damage from an attack (D138/D139/D142) — so the own
    // ACTIVE files `COUNTERS_PLACED`, exactly as the bench loop's default arm does.
    expect(eventTypes(events)).toEqual(["COUNTERS_PLACED", "COUNTERS_PLACED"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE OWN-SIDE KO, MID-ATTACK.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §5 — `yourAny` can Knock Out the attacker's own Active", () => {
  it("🛑 a 30-HP attacker Knocks ITSELF Out, and the PRIZE goes to the OPPONENT", () => {
    // 🛑 **DRIVEN, NOT INHERITED FROM A PARAGRAPH.** `finishAttack` sweeps
    // `[defender, attacker]` and prizes each KO'd side's opponent — the same rule the
    // confusion self-hit and `damageSelf`'s recoil already ride. This is the first time
    // a CHOSEN-target op reaches it, so it is asserted on a board.
    const before = table(FRAIL_BLIMP, [LOON, PLAIN]);
    expect(before.players.p2.prizes).toHaveLength(6);
    const { state, events } = swing(before);
    expect(eventTypes(events)).toContain("KNOCKED_OUT");
    const ko = events.filter(
      (e): e is Extract<GameEvent, { type: "KNOCKED_OUT" }> => e.type === "KNOCKED_OUT",
    );
    // EXACTLY ONE Knock Out: the defender has 500 HP and took 100.
    expect(ko.map((e) => e.seat)).toEqual(["p1"]);
    // 🛑 **THE PRIZE IS OWED TO THE OPPONENT, AND THE OWING IS A STAGED DECISION.**
    // `finishAttack` queues `ko:takePrizes` for the KO'd side's OPPONENT — p2 — so the
    // claim is asserted where the engine makes it, at the phase, rather than at a
    // counter that has not moved yet.
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    expect(state.players.p2.prizes).toHaveLength(6);
    // …and DRIVEN to the end: p2 takes it, p1's row never moves.
    const taken = mustApply(state, {
      type: "takePrizes",
      seat: "p2",
      prizeIndices: [0],
    }).state;
    expect(taken.players.p2.prizes).toHaveLength(5);
    expect(taken.players.p1.prizes).toHaveLength(6);
  });

  it("🛑 …and the BENCH half still landed before the sweep read the board", () => {
    // The KO is the epilogue's, not the op's: every named body took its 30 first, and
    // the attacker's own damage is what made it lethal.
    const { state } = swing(table(FRAIL_BLIMP, [LOON, PLAIN]));
    expect(state.players.p1.bench[0]?.damage).toBe(30);
    expect(state.players.p1.bench[1]?.damage).toBe(0);
    expect(state.players.p2.active?.damage).toBe(100);
  });

  it("🛑 …and the DEFENDER still took the fold, so the attack was not aborted", () => {
    // A build that swept before the program finished would leave the defender at 0. The
    // fold counts the attacker even though the attacker is about to die: the count is
    // taken at DECLARATION, which is `attack.ts`'s standing rule for this family.
    const { state } = swing(table(FRAIL_BLIMP, [LOON, LOON]));
    expect(state.players.p2.active?.damage).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE EMPTY CANDIDATE SET.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §6 — no named body in play is a SILENT no-op, not a skip", () => {
  it("🛑 an attacker the noun does not name, over a bench it does not name: nothing happens", () => {
    // The fold is ZERO, so `attack.ts` deals no base; the op's candidate set is EMPTY,
    // so it places nothing and files no event. ⚠️ And it is NOT an
    // `ATTACK_EFFECT_SKIPPED`: the sentence WAS read, which is the distinction D437's
    // block draws and the one a "nothing happened" rung usually loses.
    const { state, events } = swing(table(PLAIN, [PLAIN, PLAIN]));
    expect(damageVector(state, "p1")).toEqual([0, 0, 0]);
    expect(damageVector(state, "p2")).toEqual([0]);
    expect(eventTypes(events)).not.toContain("DAMAGE_DEALT");
    expect(eventTypes(events)).not.toContain("COUNTERS_PLACED");
    expect(eventTypes(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(eventTypes(events)).toContain("ATTACK_DECLARED");
  });

  it("🛑 …and the turn still ENDS, which is what makes it a no-op rather than a stall", () => {
    const { state } = swing(table(PLAIN, [PLAIN]));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.turn).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` 30, OVER THE SERIALIZED BYTES, BOTH DIRECTIONS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §7 — the widening at a persisted address, and the version does not move", () => {
  it("🛑 DOOR 1, THE CARRIER: `count: \"all\"` never parks, so no record can hold the value", () => {
    // D427 — over the BYTES, not from the type's name. `damageChosen` rides
    // `GameState.phase.cont.pendingOp` ONLY when it PARKS; this op resolves inline, so
    // the new literal never reaches a record at all.
    const { state } = swing(table(BLIMP, [LOON, PLAIN]));
    expect("cont" in state.phase).toBe(false);
    expect(JSON.stringify(state)).not.toContain("yourAny");
  });

  it("🛑 DOOR 2, THE ALPHABET: the pre-slice values still mean what they meant", () => {
    // The LOSS direction, driven through JSON because the claim is about BYTES.
    // `ownBenchSnipe.test.ts` §3's shape, at the fourth member.
    const preSlice = [
      '{"op":"damageChosen","target":"opponentBench","amount":30,"count":1,"source":"attack","deals":true}',
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true}',
      '{"op":"damageChosen","target":"yourBench","amount":40,"count":1,"source":"attack","deals":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
  });

  it("🛑 …and the NEW value round-trips byte for byte, which is the other direction", () => {
    // Both directions or neither (D441). A rung that only drives the old bytes passes on
    // a build that ignores the new inhabitant entirely.
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"yourAny","amount":30,"count":"all","source":"attack","deals":true,"filter":{"kind":"anyOf","filters":[{"kind":"byName","name":"Drifloon"},{"kind":"byName","name":"Drifblim"}]}}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
  });

  it("🛑 a v30 `yourBench` op over THIS board still means the bench and NOT the Active", () => {
    // The sharpest LOSS direction available: the value D447 added, over the very board
    // this slice's value is about. If `yourAny` had been spelled by RENAMING `yourBench`
    // rather than by adding a member, this rung would read 30 on the attacker.
    const state = table(BLIMP, [LOON, PLAIN]);
    const events: GameEvent[] = [];
    const v30 = {
      op: "damageChosen",
      target: "yourBench",
      amount: 30,
      count: "all",
      source: "attack",
      deals: true,
      filter: PAIR_FILTER,
    } as unknown as EffectOp;
    const run = runProgram(state, [v30], { seat: "p1", invokedBy: "attack" }, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p1")).toEqual([0, 30, 0]);
  });

  it("🛑 every member of the union is inhabited by a PRINTED sentence, not just by the type", () => {
    // D205's shape: a union member no printing produces is a value no board can reach.
    // All FOUR are reached here from the catalog's own text.
    const seen = new Set<string>();
    for (const [, text] of corpusRows()) {
      for (const op of (deriveAttackEffect(text) ?? []) as EffectOp[]) {
        if (op.op === "damageChosen") seen.add(op.target);
      }
    }
    expect([...seen].sort()).toEqual(["opponentAny", "opponentBench", "yourAny", "yourBench"]);
  });

  it("the engine version moved and the two spellings agree", () => {
    expect(engineVersion).toBe("0.439.0");
    expect(manifest.version).toBe(engineVersion);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE DESCRIBER OBLIGATION, TRACED THROUGH THE CALL SITE AND EMPTY.
//
// 🛑 **AND THE DESCRIBER OBLIGATION IS EMPTY, TRACED THROUGH THE CALL SITE RATHER THAN
// ARGUED FROM THE OP'S CATEGORY (D478/D489, and `classedBoardSpread.test.ts`'s own shape
// at D492).** `snipeNote` has exactly ONE caller — `interpreter.ts`'s `damageChosen`
// PARK branch — and `count: "all"` takes the forced branch above it on every board, so
// no caption is built. `describeBranch` and `describeCondition` have exactly one caller
// each, `withConsequence`, which returns the prompt unchanged unless `recordSlotOf(op)`
// is defined; `damageChosen` is not one of its seven recording ops. And `log.ts` needs
// nothing: the events are `DAMAGE_DEALT`, which every snipe and every spread in the
// engine already renders.
//
// 🛑 **NO CAPTION RUNG IS WRITTEN AT ALL, AND THAT IS THE POINT.** A caption assertion
// that can never fail is the thing to avoid; a traced empty obligation is not a guard.
// `snipeNote`'s `target` parameter and its `zone`/`owner` ternaries were widened anyway,
// so the day a `1 of your Pokémon` printing lands they already read right.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §8 — the obligation is traced, and it is empty", () => {
  it("🛑 no prompt is built on any board this printing reaches", () => {
    for (const bench of [[], [LOON], [LOON, PLAIN], [LOON, LOON, PLAIN]]) {
      const { state } = swing(table(BLIMP, bench));
      expect(state.phase.kind).not.toBe("effect:choose");
    }
  });

  it("🛑 `snipeNote` is widened anyway, and the widening is in the source", () => {
    // The parameter and the two ternaries — asserted off the raw text, because the
    // BRANCH is unreachable and an assertion about its OUTPUT could never fail.
    const source = raw("interpreter.ts");
    expect(source).toContain(
      '  target: "opponentBench" | "opponentAny" | "yourBench" | "yourAny" = "opponentBench",',
    );
    expect(source).toContain(
      '  const zone = target === "opponentAny" || target === "yourAny" ? noun : `Benched ${noun}`;',
    );
    expect(source).toContain(
      '  const owner = target === "yourBench" || target === "yourAny" ? "your" : "your opponent\'s";',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE CENSUS DELTA, AND THE TWO FAMILIES THIS ROW CLOSES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D539 §9 — what this slice moved, measured over the legal column", () => {
  it("🛑 the step is +1 sentence / +2 printings, DERIVED from the anchor", () => {
    const moved = corpusRows().filter(([, text]) => resolvedByAnyReader(text) && !builtBefore(text));
    expect(moved).toEqual([[2, PRINTED]]);
    expect(units(moved)).toBe(2);
    // ⚠️ **THE FIFTH CONSECUTIVE SLICE WHOSE TWO STEPS DISAGREE** (D535 1-vs-2, D536
    // 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a `.length` chain takes `− 1` where a
    // `units(…)` chain takes `− 2` (D426).
    expect([moved.length, units(moved)]).toEqual([1, 2]);
  });

  it("🛑 `/This attack also does /` IS CLOSED — 17 sentences / 41 printings, all read", () => {
    // 🛑 **RE-POINTED ONTO THE POSITIVE (D536/D538's lesson).** With :595 built, an
    // `unbuilt` loop over this family goes VACUOUSLY TRUE, so the assertion that means
    // something is that EVERY member resolves — and the family's own size, asserted
    // FIRST, is what stops the loop silently shrinking to nothing.
    const family = corpusRows().filter(([, t]) => /This attack also does /.test(t));
    expect([family.length, units(family)]).toEqual([17, 41]);
    expect(family.every(([, t]) => resolvedByAnyReader(t))).toBe(true);
  });

  it("🛑 `/ damage to each of /` IS CLOSED — 11 sentences / 20 printings, all read", () => {
    const family = corpusRows().filter(([, t]) => / damage to each of /.test(t));
    expect([family.length, units(family)]).toEqual([11, 20]);
    expect(family.every(([, t]) => resolvedByAnyReader(t))).toBe(true);
  });

  it("🛑 …and :595 was the LAST unbuilt row of BOTH — what CLOSURE means here", () => {
    // The claim that makes the two rungs above a CLOSURE rather than a coincidence:
    // before this slice each family had exactly one unbuilt member and it was this row.
    for (const pattern of [/This attack also does /, / damage to each of /]) {
      const wasUnbuilt = corpusRows().filter(([, t]) => pattern.test(t) && !builtBefore(t));
      expect(wasUnbuilt).toEqual([[2, PRINTED]]);
    }
  });

  it("🛑 the SPLIT and REGISTRY census figures stand still — this row is a RAW claim", () => {
    // A whole-sentence reader claim is not a split, so `SPLIT_ATTACK_UNITS` and
    // `COMPOUND_ATTACK_UNITS` do not move and neither does the trailing-split count,
    // which §1's simulation already pinned at ELEVEN.
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
  });
});
