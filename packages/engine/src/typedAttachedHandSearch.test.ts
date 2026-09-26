import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { programPlayable } from "./cardplay";
import { energyProvidesOf, matchesFilter } from "./cards";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
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
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState } from "./index";
import type { EffectContext, EffectContinuation, EffectPrompt } from "./interpreter";
import { runProgram } from "./interpreter";
import { logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.416.0 → 0.417.0 — 🆕🆕🆕 D531: THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE OPTIONAL
// RIDER `typedAsAttachedBasicEnergy`, READ AT THE PARK, A WIDENING AT D513/D527's PERSISTED ADDRESS.
//
// *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to
// this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."* —
// `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), **1 sentence / 1
// legal printing** (sv07-065 per `derivedHandSearch.test.ts`'s retired DEFERRED row — not in
// `catalogManifest` / `FIXTURE_POOL` on this checkout, so the demonstrator below is DECLARED and no
// id is invented, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor
// (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, a SEPARATE literal beside `ATTACK_HAND_SEARCH_BENCH_COUNT`,
// D527's construction; the `5` is a LITERAL, not a capture — a pool of one, D121) as EXACTLY the
// flat sibling's two-op shape ONE KEY OVER:
//
//   [{ op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 5, reveal: true,
//      typedAsAttachedBasicEnergy: true },
//    { op: "shuffleDeck" }]
//
// The rider RESOLVES at the park (`interpreter.ts` `searchDeck`, STEP time — after the attack's
// damage, before the KO sweep): group 0's printed `anyPokemon` is NARROWED to
// `anyOf(typedPokemon × T)`, T being the de-duplicated types of the BASIC Energy cards attached to
// the SOURCE body (`ctx.sourceUid` → `sourceRef` → `refPokemon` → `energy` → `cardOf` →
// `matchesFilter(basicEnergy)` → `energyProvidesOf`). "Basic Energy" is the CARD CATEGORY: a Special
// Energy never counts, and the category filter runs BEFORE `energyProvidesOf` so an unauthored
// Special's *"Colorless"* fallback cannot admit Colorless Pokémon (D421, pinned in §4 (iv)). Zero
// types → `anyOf([])` → the existing `candidates.length === 0` whiff (no park, no `DECK_SEARCHED`,
// the shuffle runs) — NO fallback to `anyPokemon`. The PRINTED groups feed the caption alone: the
// note quotes the printed RULE on the plural noun (§4 (i), byte for byte). 🛑 **WHY THE PARK AND
// NOT `CardFilter`**: D231's premise — no filter could read the board — is STILL TRUE
// (`matchesFilter` is a pure predicate over ~56 call sites, D521), which is exactly why the board is
// read once, where it exists, and the predicate is handed two members it already has.
//
// 🛑 **IT IS A WIDENING AT A PERSISTED ADDRESS, AND IT IS DRIVEN RATHER THAN ARGUED.** `searchDeck`
// PARKS, so the rider rides `EffectContinuation.pendingOp` inside `MatchRecord.state.phase.cont`. A
// v30 record carries no such key, this build reads that as `undefined`, and `undefined` is the
// unconstrained search v30's writers meant — no v30 program could have parked this row. §3 drives
// it in THREE directions (D530 §3's shape), including the LOSS direction: a dropped rider is the
// flat sibling's op and the board DIFFERS — an off-type Pokémon in the deck becomes a candidate.
//
// 🛑 **THE REFUSAL ON RECORD WAS TRUE AND NAMED THE WRONG LAYER.** `derivedHandSearch.test.ts`'s
// DEFERRED table held this row as *"a BOARD-DEPENDENT noun (sv07-065) — the filter would read the
// attacker"*. The filter still does not read the attacker; the PARK does. INVERTED in place
// (D178/D418): the row leaves DEFERRED, the family total 42 is re-derived as CLAUSES 35 + DEFERRED 5
// + 2 rows built on their OWN anchors, and the retired reason is quoted beside a positive rung.

/** Corpus FILE LINE 483, byte for byte. Asserted off the corpus in §1, never retyped elsewhere. */
const PRINTED =
  "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";
/** THE CONTROL — the flat twin `ATTACK_HAND_SEARCH` has claimed since D231 (constructed; the column
    prints `up to 5 Pokémon` on this row alone — measured in §1). Differs from `PRINTED` in the
    noun's relative clause and in NOTHING else: same count, same reveal, same destination. A build
    that read the board for BOTH would make the two offers agree on every board, so every §4 rung
    that varies the attached Energy also asks this one and expects it NOT to move. */
const FLAT = "Search your deck for up to 5 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.";
/** The OTHER corpus row that prints *"the same type as"* — a damage bonus on a different reader.
    Stays where it is; §1 measures it. */
const TYPE_MATCH_BONUS =
  "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, this attack does 120 more damage.";

/** THE PROGRAM, spelled once. */
const PROGRAM: readonly EffectOp[] = [
  {
    op: "searchDeck",
    filter: { kind: "anyPokemon" },
    dest: "hand",
    max: 5,
    reveal: true,
    typedAsAttachedBasicEnergy: true,
  },
  { op: "shuffleDeck" },
];
/** The flat sibling's program — `PROGRAM` minus the rider, and nothing else. */
const FLAT_PROGRAM: readonly EffectOp[] = [
  { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 5, reveal: true },
  { op: "shuffleDeck" },
];

const READERS = [
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
];
const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

/** `ATTACK_HAND_SEARCH`'s source, COPIED (the anchor is module-private) so §1 can show the READING:
    the sibling ADMITS this sentence — group 3 "5", group 5 the whole noun phrase, group 7 the reveal
    clause — and its arm falls through because the closed noun table has no row for the phrase. The
    copy is pinned against `effects.ts`'s bytes in §6 so it cannot drift. */
const SIBLING_SOURCE =
  "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
  "|(?:up to (\\d+)|(any number of)) ([^,.]+?)( of different types)?(, reveal them,)? and put them)" +
  " into your hand\\. Then, shuffle your deck\\.$";
const SIBLING = new RegExp(SIBLING_SOURCE);

// ─────────────────────────────────────────────────────────────────────────────
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D520–D530).
// ─────────────────────────────────────────────────────────────────────────────

/** DECLARED, not read: the printing's base and cost are unresolvable here (no D1, no
    `FIXTURE_POOL` id). */
const BASE = 30;
const SCOUT = "d531-scout";
/** The defender — 400 HP, no W/R, Colorless: ALSO the deck's Colorless Pokémon control. */
const WALL = "d531-wall";
/** The deck's typed bodies: one per printed type on the board, one OFF the board, one DUAL. */
const WATER = "d531-water";
const FIRE = "d531-fire";
const GRASS = "d531-grass";
const DUAL = "d531-dual";
/** `FIXTURE_POOL`'s typed Basics and its unauthored Special (provides Colorless by fallback). */
const W_ENERGY = "fix-water-energy";
const R_ENERGY = "fix-fire-energy";
const G_ENERGY = "fix-grass-energy";
const SPECIAL = "fix-special";
const ITEM = "fix-item";

const SEARCH_CARDS: Record<string, Card> = {
  [SCOUT]: battler(SCOUT, {
    name: "D531 Scout",
    types: ["Colorless"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — FILE LINE 483 verbatim, with a DECLARED base and cost. */
      { cost: ["Colorless"], name: "Typed Call", damage: BASE, effect: PRINTED },
      /** index 1 — the CONTROL: the flat twin, every Pokémon in the deck on every board. */
      { cost: ["Colorless"], name: "Plain Call", damage: BASE, effect: FLAT },
      /** index 2 — no effect, no program. */
      { cost: ["Colorless"], name: "Jab", damage: BASE },
    ],
  }),
  [WALL]: battler(WALL, { name: "D531 Wall", types: ["Colorless"], hp: 400 }),
  [WATER]: battler(WATER, { name: "D531 Water", types: ["Water"], hp: 60 }),
  [FIRE]: battler(FIRE, { name: "D531 Fire", types: ["Fire"], hp: 60 }),
  [GRASS]: battler(GRASS, { name: "D531 Grass", types: ["Grass"], hp: 60 }),
  [DUAL]: battler(DUAL, { name: "D531 Dual", types: ["Fire", "Grass"], hp: 60 }),
};

const SEARCH_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SEARCH_CARDS };

/** Its own deck (D270), 60 counted before the first run: 4 + 4 + 5 + 5 + 5 + 5 + 6 + 7 + 7 + 6 + 6.
    SIX Pokémon kinds across FOUR printed types plus Colorless, an Item, three typed Basics and an
    unauthored Special — enough kinds that the typed offer is distinguishable from the flat one on
    every board §4 names. */
const SEARCH_DECK = deckOf({
  [SCOUT]: 4,
  [WALL]: 4,
  [WATER]: 5,
  [FIRE]: 5,
  [GRASS]: 5,
  [DUAL]: 5,
  [ITEM]: 6,
  [W_ENERGY]: 7,
  [R_ENERGY]: 7,
  [G_ENERGY]: 6,
  [SPECIAL]: 6,
});

/** The opening shuffle and the trailing `shuffleDeck` — both off this seed; nothing here is a coin.
    Stated (D523 (8)). */
const SEED = 7;

function openTable(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: SEARCH_DECK, p2: SEARCH_DECK },
    cardPool: SEARCH_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first: "p2" }));
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  // `p2` opens and passes, so `p1` attacks on a turn that carries no first-turn lock.
  return mustApply(table, { type: "endTurn", seat: "p2" }).state;
}

type Board = {
  /** Energy card ids attached to P1's Active (the attacker), in order. Default: one {W} and one {R}
      Basic — TWO printed types on the board, one printed type (Grass) OFF it. */
  readonly attached?: readonly string[];
  /** Energy card ids attached to P2's Active — the Energy the resolver must NEVER read. Default none. */
  readonly opponentAttached?: readonly string[];
  /** A P1 Bench body (index 0) with its own attached Energy — the Ability-shaped source for (ix). */
  readonly bench?: { readonly id: string; readonly attached: readonly string[] };
};

/** p1 owns turn 2 with the attacker Active holding the named Energy (a typed Basic pays the {C}
    cost); P2 went first. Both Benches are CLEARED after the Active surgeries (`setActiveFromDeck`
    displaces onto the Bench), then P1's optional Bench body is placed and energised by surgery. */
function table(board: Board = {}): GameState {
  let state = setActiveFromDeck(openTable(SEED), "p1", SCOUT);
  for (const id of board.attached ?? [W_ENERGY, R_ENERGY]) state = attachFromDeck(state, "p1", id, 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", WALL);
  for (const id of board.opponentAttached ?? []) state = attachFromDeck(state, "p2", id, 1);
  state = clearBench(state, "p2");
  if (board.bench !== undefined) {
    state = benchFromDeck(state, "p1", board.bench.id);
    for (const id of board.bench.attached) state = attachBenchFromDeck(state, "p1", 0, id, 1);
  }
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board = {}, index = 0): Swing {
  const before = table(board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

function cardsPrompt(state: GameState): Extract<EffectPrompt, { kind: "chooseCards" }> {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function continuation(state: GameState): EffectContinuation {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  return state.phase.cont;
}

/** The attacker's own `EffectContext` — read off a REAL park rather than hand-spelled, so the
    hand-authored programs below run under exactly the context `attack.ts` builds. */
function attackCtx(state: GameState): EffectContext {
  return continuation(mustApply(state, { type: "attack", seat: "p1", index: 0 }).state).ctx;
}

/** The uids of P1's deck whose card is one of `ids`, IN DECK ORDER — the shape the park offers. */
const inDeck = (state: GameState, ids: readonly string[]): string[] =>
  state.players.p1.deck.filter((uid) => ids.includes(state.cardIdByUid[uid] ?? ""));
const ALL_POKEMON = [SCOUT, WALL, WATER, FIRE, GRASS, DUAL] as const;

/** `opRecord.test.ts`'s idiom: answer the parked chooseCards. */
const pick = (state: GameState, uids: readonly string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } });

const NAMES = { p1: "P1", p2: "P2" } as const;
const rows = (events: readonly GameEvent[], state: GameState): string[] =>
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
    entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
  );

function searchedRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "DECK_SEARCHED" }> => e.type === "DECK_SEARCHED");
}
function shuffleRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "SHUFFLE" }> => e.type === "SHUFFLE");
}
function dealtRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
}

/** THE CAPTION, MEASURED ONCE and pinned byte for byte: `searchNote`'s single-group number branch
    over the PRINTED `retrieveNoun(anyPokemon).plural` ("Pokémon") carrying the printed rule, the
    printed 5 and the hand destination. The resolved types are NOT in it — the offer shows them. */
const CAPTION =
  "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon into your hand.";
/** The flat control's caption, D231's byte-identical note. */
const FLAT_CAPTION = "Search your deck for up to 5 Pokémon into your hand.";

// ─────────────────────────────────────────────────────────────────────────────
// §1 — derivation: the exact program, the only claimant, both anchor ends (the trailing splitter
// COMPOSES on the built head — D526 (5)), the one-axis near-misses, the sibling's READING, the
// census identity.
// ─────────────────────────────────────────────────────────────────────────────

describe("D531 §1 — file line 483 derives to EXACTLY the flat sibling's two-op shape with `typedAsAttachedBasicEnergy: true`", () => {
  it("🛑 the row derives to the program — `searchDeck { anyPokemon, hand, max 5, reveal, typedAsAttachedBasicEnergy }` then `shuffleDeck`, EXACTLY these six keys (`D531-arm-drops-the-rider`)", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    const got = deriveAttackEffect(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(got).toHaveLength(2);
    const [search, shuffle] = got;
    expect(shuffle).toEqual({ op: "shuffleDeck" });
    if (search?.op !== "searchDeck") throw new Error("the first op is not a searchDeck");
    expect(Object.keys(search).sort()).toEqual(["dest", "filter", "max", "op", "reveal", "typedAsAttachedBasicEnergy"]);
    expect(search.typedAsAttachedBasicEnergy).toBe(true);
    expect(search.max).toBe(5);
    expect(typeof search.max).toBe("number");
    expect(search.reveal).toBe(true);
    expect(search.filter).toEqual({ kind: "anyPokemon" });
    expect("exact" in search).toBe(false);
    expect("also" in search).toBe(false);
    expect("distinctEnergyTypes" in search).toBe(false);
    // The rider is the ONE key between the row and its flat twin — an INEQUALITY of programs, not
    // a null (the twin is a real program on the sibling anchor).
    expect(deriveAttackEffect(FLAT)).toEqual(FLAT_PROGRAM);
    expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(FLAT));
    expect({ ...search, typedAsAttachedBasicEnergy: undefined }).toEqual({ ...FLAT_PROGRAM[0], typedAsAttachedBasicEnergy: undefined });
  });

  it("🛑 `deriveAttackEffect` is the ONLY claimant — twelve readers and four splitters are null on the row — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it("🛑 the anchor is WHOLE-SENTENCE at the HEAD: a PREFIXED print is null on every reader and every splitter (D520 (3); `D531-anchor-loses-the-head`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed)).toBe(false);
    for (const reader of READERS) expect(reader(prefixed), reader.name).toBeNull();
    for (const splitter of SPLITTERS) expect(splitter(prefixed), splitter.name).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
  });

  it("🛑 …and at the TAIL: a SUFFIXED print is null on every reader, and the TRAILING splitter COMPOSES `{head: row, tail: \"Draw a card.\"}` because the head is now claimed (D426/D526 (5) — asserted, not asserted away; `D531-anchor-loses-the-tail`)", () => {
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === suffixed)).toBe(false);
    for (const reader of READERS) expect(reader(suffixed), reader.name).toBeNull();
    expect(resolvedByAnyReader(suffixed)).toBe(false);
    expect(splitAttackCancelClause(suffixed)).toBeNull();
    expect(splitAttackGateClause(suffixed)).toBeNull();
    expect(splitAttackRequirementClause(suffixed)).toBeNull();
    // MEASURED at D531 (D527's shape): the splitter composes a CLAIMED head with a trailing clause.
    // On the `$`-dropped mutant the READER swallows the whole string instead, so
    // `deriveAttackEffect(suffixed)` is the rung that goes red.
    expect(splitAttackTrailingClause(suffixed)).toEqual({ head: PRINTED, tail: "Draw a card." });
  });

  it("🛑 one-axis near-misses, all null on EVERY reader — `Special Energy`, the opponent's body, `any Energy` (no `Basic`), `up to 3`, a lowercase head, a missing final period, no reveal clause, the `You may` opener", () => {
    const controls: Record<string, string> = {
      "`Special Energy` for `Basic Energy` — the category is a literal (and the resolver's category filter is the same fact, §4 (iv))":
        "Search your deck for up to 5 Pokémon that are the same type as any Special Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      "`your opponent's Active Pokémon` for `this Pokémon` — the body is a literal (the resolver reads the SOURCE)":
        "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to your opponent's Active Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      "`any Energy` for `any Basic Energy` — the category word is a literal":
        "Search your deck for up to 5 Pokémon that are the same type as any Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      "`up to 3` for `up to 5` — the count is a LITERAL, not a capture (D121: a pool of one)":
        "Search your deck for up to 3 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      "a lowercase head — no /i on the anchor":
        "search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      "the final period missing — `\\.$` is the anchor's tail":
        "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck",
      "the reveal clause dropped — the anchor spells the printed clause, and the rider is not a reveal":
        "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon and put them into your hand. Then, shuffle your deck.",
      "`You may search` for `Search` — the sibling admits the opener; this anchor spells the printed verb only":
        "You may search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      for (const reader of READERS) expect(reader(s), `${why} — ${reader.name}`).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(legalAttackCorpus().some(([, t]) => t === s), why).toBe(false);
    }
  });

  it("🛑 THE READING RUNG: the SIBLING regex ADMITS the row (group 3 \"5\", group 5 the whole noun phrase, group 7 the reveal clause) and its closed table has no row for the phrase — so the row derives on its OWN anchor, and the `up to 3` twin (admitted the same way) derives NULL", () => {
    // The sibling's pattern is copied above and pinned against effects.ts's bytes in §6.
    const m = SIBLING.exec(PRINTED);
    if (m === null) throw new Error("the sibling anchor does not admit the row");
    expect(m[3]).toBe("5");
    expect(m[5]).toBe("Pokémon that are the same type as any Basic Energy attached to this Pokémon");
    expect(m[7]).toBe(", reveal them,");
    expect(m[1]).toBeUndefined();
    expect(m[6]).toBeUndefined();
    // The FLAT twin is the same match with the bare noun — the table HAS that row.
    expect(SIBLING.exec(FLAT)?.[5]).toBe("Pokémon");
    expect(deriveAttackEffect(FLAT)).toEqual(FLAT_PROGRAM);
    // The `up to 3` twin: the sibling admits it identically (group 3 "3", the same noun), the table
    // refuses the noun, and THIS slice's anchor refuses the digit — null from both sides. That is the
    // reading: the sibling's `exec` is not what keeps the row and its arm apart, the TABLE is.
    const three = PRINTED.replace("up to 5", "up to 3");
    expect(SIBLING.exec(three)?.[3]).toBe("3");
    expect(SIBLING.exec(three)?.[5]).toBe(m[5]);
    expect(deriveAttackEffect(three)).toBeNull();
    // …and a THIRD spelling the sibling admits with a noun the table has — `up to 3 Pokémon` — derives
    // the sibling's program at 3: the table is the discriminator, on three points.
    expect(deriveAttackEffect(FLAT.replace("up to 5", "up to 3"))).toEqual([
      { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 3, reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 the sentence is the CORPUS's bytes at exactly ONE printing, at index 430, it is RESOLVED, and the raw file line IS 483", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[1, PRINTED]]);
    expect(corpus.findIndex(([, s]) => s === PRINTED)).toBe(430);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const raw = Object.entries(RAW).find(([k]) => k.endsWith("/censusAttackCorpus.ts"))?.[1] ?? "";
    expect(raw.split("\n")[482]).toBe(`1 ${PRINTED}`);
    // The apostrophe-free sentence: no `['’]` slot exists for the anchor to class (D136/D137).
    expect(PRINTED).not.toContain("'");
    expect(PRINTED).not.toContain("’");
  });

  it("🛑 the anchor's claimed set over all 640 rows is EXACTLY {file line 483} — 1 sentence / 1 printing; `the same type as` is printed on TWO rows and the other stays on ITS reader; `up to 5 Pokémon` on this row alone", () => {
    const [n, u, claimed] = claims(
      /^Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand\. Then, shuffle your deck\.$/,
    );
    expect([n, u]).toEqual([1, 1]);
    expect(claimed).toEqual([PRINTED]);
    const all = legalAttackCorpus();
    expect(all).toHaveLength(640);
    const rider = all.filter(([, s]) =>
      (deriveAttackEffect(s) ?? []).some((op) => (op as { typedAsAttachedBasicEnergy?: unknown }).typedAsAttachedBasicEnergy === true),
    );
    expect(rider).toEqual([[1, PRINTED]]);
    // MEASURED: two rows print the phrase; the other is a damage bonus (a different reader), not a
    // search, and this slice moved nothing on it.
    const phrase = all.filter(([, s]) => s.includes("the same type as"));
    expect(phrase.map(([, s]) => s).sort()).toEqual([TYPE_MATCH_BONUS, PRINTED].sort());
    expect(deriveAttackEffect(TYPE_MATCH_BONUS)).toBeNull();
    expect(deriveAttackDamageBonus(TYPE_MATCH_BONUS)).not.toBeNull();
    expect(all.filter(([, s]) => s.includes("up to 5 Pokémon")).map(([, s]) => s)).toEqual([PRINTED]);
    // …and the flat twin is a CONSTRUCTION: the column does not print it.
    expect(all.some(([, s]) => s === FLAT)).toBe(false);
  });

  it("the fixture pool is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, and sv07-065 is unresolvable here", () => {
    expect(Object.keys(SEARCH_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(SEARCH_DECK).toHaveLength(60);
    expect(FIXTURE_POOL["sv07-065"]).toBeUndefined();
    expect(SEARCH_CARDS[SCOUT]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(SEARCH_CARDS[SCOUT]?.attacks?.[1]?.effect).toBe(FLAT);
    expect(SEARCH_CARDS[SCOUT]?.attacks?.[2]?.effect).toBeUndefined();
    // The Energy fixtures are what their names say: three typed Basics and an unauthored Special
    // whose provision is the Colorless FALLBACK — the fact §4 (iv) turns on.
    for (const [id, type] of [[W_ENERGY, "Water"], [R_ENERGY, "Fire"], [G_ENERGY, "Grass"]] as const) {
      const card = FIXTURE_POOL[id];
      if (card === undefined) throw new Error(`no ${id}`);
      expect(matchesFilter(card, { kind: "basicEnergy" }), id).toBe(true);
      expect(energyProvidesOf(card), id).toBe(type);
    }
    const special = FIXTURE_POOL[SPECIAL];
    if (special === undefined) throw new Error(`no ${SPECIAL}`);
    expect(special.energyType).toBe("Special");
    expect(matchesFilter(special, { kind: "basicEnergy" })).toBe(false);
    expect(energyProvidesOf(special)).toBe("Colorless");
    expect(SEARCH_CARDS[DUAL]?.types).toEqual(["Fire", "Grass"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the census moved in exactly ONE summand, by 1 sentence / 1 printing.
// ─────────────────────────────────────────────────────────────────────────────

describe("D531 §2 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("🛑 the reader arm reads 557 sentences / 1,599 printings, and the row is IN it", () => {
    // 🆕🆕🆕 D531's OWN literals, annotated in-slice so the next sweep sees them: the reader arm
    // 556/1598 → 557/1599 — corpus FILE LINE 483, ⚠️ sentence step 1 / printing step 1.
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([580, 1634]);  // (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: reader arm 578/1632 → 580/1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: reader arm 577/1631 → 578/1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: reader arm 573/1627 → 577/1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: reader arm 572/1625 → 573/1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: reader arm 570/1621 → 572/1625.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: reader arm 568/1619 → 570/1621.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 567/1617 → 568/1619.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 566/1615 → 567/1617.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 563/1611 → 564/1613.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 562/1608 → 563/1611.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 561/1606 → 562/1608.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1603 → 561/1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    // …and the step is THIS sentence and nothing else: remove it and the pair is D530's. ⚠️ THE
    // OWN-ROW `without` PAIR: resolved − THIS suite's ONE-printing row (D525 (5)'s trap).
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([579, 1633]);  // (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 577/1631 → 579/1633.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 576/1630 → 577/1631.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 572/1626 → 576/1630.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the `without` pair (resolved MINUS this suite's own row) 571/1624 → 572/1626.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 569/1620 → 571/1624.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 567/1618 → 569/1620.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 566/1616 → 567/1618, RE-DERIVED BY HAND rather than copied (D525(5)).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 565/1614 → 566/1616, RE-DERIVED BY HAND rather than copied (D525(5)).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: 562/1610 → 563/1612.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ THE OWN-ROW `without` PAIR, RE-DERIVED BY HAND as resolved − this suite's OWN row (D525 (5)) and never copied from the resolved pair — 561/1607 → 562/1610.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1605 → 561/1607.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 559/1602 → 560/1605.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 83 / 133 — and the row left it", () => {
    // 🆕🆕🆕 D531's OWN literal (corpus FILE LINE 483): 84/134 → 83/133.
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([60, 98]);  // (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: raw reader-only residue 62/100 → 60/98.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: raw reader-only residue 63/101 → 62/100.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: raw reader-only residue 67/105 → 63/101.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: raw reader-only residue 68/107 → 67/105.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: raw reader-only residue 70/111 → 68/107.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: raw reader-only residue 72/113 → 70/111.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 73/115 → 72/113.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 74/117 → 73/115.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 77/121 → 76/119.)  // (🆕🆕🆕 **D538 −1 sentence / −3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 78/124 → 77/121.)  // (🆕🆕🆕 **D537 −1 sentence / −2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 79/126 → 78/124.)  // (🆕🆕🆕 **D536 −1 sentence / −3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 80/129 → 79/126.)  // (🆕🆕🆕 **D535 −1 sentence / −2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 −1 sentence / −1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 −1 sentence / −1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    // The parts add up to the whole quoted in the same case.
    const all = legalAttackCorpus();
    expect(unbuilt.length + 580).toBe(all.length);  // (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the partition summand 578 → 580.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the partition summand 577 → 578.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the partition summand 573 → 577.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the partition summand 572 → 573.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the partition summand 570 → 572 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the partition summand 568 → 570 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the partition summand 567 → 568 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the partition summand 566 → 567 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: a LIVE ADDEND at the FRONT (D461's table: the tell is the left-hand side), 563 → 564.)  // (🆕🆕🆕 **D538 +1 sentence — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — + 562 → + 563. SENTENCES, so the step is 1.)  // (🆕🆕🆕 **D537 +1 sentence — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A FROZEN TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — 561 → 562.)  // (🆕🆕🆕 **D536 +1 sentence — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229`), claimed by `deriveAttackEffect` through arm 44c over ONE new zero-capture anchor `TR_ENERGY_COST_THEN_DISCARD_DEFENDER` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree HARDER than D535's 1-vs-2. THIS SITE: 561 → 562.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(units(unbuilt) + 1634).toBe(units(all));  // (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1632 → 1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1631 → 1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1627 → 1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the PRINTINGS partition summand 1625 → 1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1621 → 1625 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the PRINTINGS partition summand 1619 → 1621 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the PRINTINGS partition summand 1617 → 1619 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the PRINTINGS partition summand 1615 → 1617 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  🆕🆕🆕 **D539 +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: a LIVE ADDEND at the FRONT (D461's table: the tell is the left-hand side), 1611 → 1613.)  // (🆕🆕🆕 **D538 +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — + 1608 → + 1611. 🛑 PRINTINGS, SO THE STEP IS **3** AND NOT 1 — this is the exact site D537's automated pass got wrong by assuming the sentence step.)  // (🆕🆕🆕 **D537 +1 sentence — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A FROZEN TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — 1606 → 1608.)  // (🆕🆕🆕 **D536 +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229`), claimed by `deriveAttackEffect` through arm 44c over ONE new FIELD-FREE `EffectOp` member `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THIS IS A PRINTING-SIDE TERM, SO IT CARRIES `+ 3` WHERE THE SENTENCE-SIDE TERM ABOVE CARRIES `+ 1`** — the two steps DISAGREE, harder than D535's 1-vs-2. THIS SITE: 1603 → 1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect([all.length, units(all)]).toEqual([640, 1732]);
  });

  it("🛑 the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row itself", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted address: a WIDENING, `MATCH_RECORD_VERSION` HELD at 30, driven over v30 bytes
// in three directions (D530 §3 / D513 §4's shape) — including the LOSS direction on the board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D531 §3 — a new optional rider on a PERSISTED op, and the record version does not move", () => {
  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in three directions", () => {
    // 🛑 WHICH OF THE TWO SITUATIONS THIS IS, ASKED RATHER THAN INHERITED. `searchDeck` PARKS — §4 (i)
    // parks this very op — so the literal rides `GameState.phase.cont.pendingOp` into a stored match
    // record. It is a WIDENING: every value a v30 deploy could have written still means what it meant.
    //
    // DIRECTION 1 — every byte string a v30 deploy could have written is unchanged. No v30 record
    // carries this key, and its ABSENCE has one meaning before and after: the unconstrained search.
    // Driven through JSON, because the claim is about BYTES — and the two pre-slice strings STILL
    // DERIVE from their own printed sentences (the rider was not a rename).
    const preSlice = [
      '{"op":"searchDeck","filter":{"kind":"anyPokemon"},"dest":"hand","max":5,"reveal":true}',
      '{"op":"searchDeck","filter":{"kind":"basicEnergy"},"dest":"hand","max":3,"reveal":true,"distinctEnergyTypes":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    expect(deriveAttackEffect(FLAT)?.[0]).toEqual(JSON.parse(preSlice[0] as string));
    expect(
      deriveAttackEffect(
        "Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.",
      )?.[0],
    ).toEqual(JSON.parse(preSlice[1] as string));

    // DIRECTION 2 — the NEW value cannot appear in any record an older deploy wrote, and this deploy
    // round-trips it byte for byte.
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"searchDeck","filter":{"kind":"anyPokemon"},"dest":"hand","max":5,"reveal":true,"typedAsAttachedBasicEnergy":true}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);

    // DIRECTION 3 — a record that LOSES the key degrades LOUDLY (D421's criterion applied): the
    // dropped rider is EXACTLY the flat sibling's op, and on the board the two DIFFER — an off-type
    // Pokémon in the deck is a candidate under the dropped op and not under the fresh one. Said so,
    // and driven below on the same board.
    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "typedAsAttachedBasicEnergy" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(FLAT)?.[0]);
    expect(dropped).not.toEqual(fresh);
  });

  it("🛑 the LOSS direction ON THE BOARD: the dropped rider (the flat op, v30 bytes) parks EVERY Pokémon in the deck — the {G} body and the Colorless ones included — where the fresh op parks the {W}, {R} and dual bodies only; a reconstructed v30 op resumes under this build to the offer v30 meant", () => {
    const board = table();
    const ctx = attackCtx(board);
    const fresh = PROGRAM[0] as EffectOp;
    const v30 = JSON.parse(JSON.stringify(fresh, (k, v) => (k === "typedAsAttachedBasicEnergy" ? undefined : v))) as EffectOp;
    expect(JSON.stringify(v30)).toBe('{"op":"searchDeck","filter":{"kind":"anyPokemon"},"dest":"hand","max":5,"reveal":true}');
    const typed = runProgram(board, [fresh], ctx, []);
    const flat = runProgram(board, [v30], ctx, []);
    if (typed.kind !== "parked" || typed.prompt.kind !== "chooseCards") throw new Error("the fresh op did not park");
    if (flat.kind !== "parked" || flat.prompt.kind !== "chooseCards") throw new Error("the v30 op did not park");
    expect(typed.prompt.candidates).toEqual(inDeck(board, [WATER, FIRE, DUAL]));
    expect(flat.prompt.candidates).toEqual(inDeck(board, ALL_POKEMON));
    expect(flat.prompt.note).toBe(FLAT_CAPTION);
    expect(typed.prompt.note).toBe(CAPTION);
    // The off-type body: IN the dropped offer, OUT of the fresh one — the loss is visible.
    const grass = inDeck(board, [GRASS]);
    expect(grass.length).toBeGreaterThan(0);
    for (const uid of grass) {
      expect(flat.prompt.candidates).toContain(uid);
      expect(typed.prompt.candidates).not.toContain(uid);
    }
    expect(flat.prompt.candidates.length).toBeGreaterThan(typed.prompt.candidates.length);
    // The v30 op resumed from its bytes parks the v30 offer — no v30 inhabitant changed meaning.
    expect([flat.prompt.min, flat.prompt.max]).toEqual([0, 5]);
    expect(flat.cont.pendingOp).toEqual(v30);
  });

  it("🛑 the parked `pendingOp`'s key set, sorted, carries the rider — and the PRINTED filter, not the resolved one (the resolution lives in `candidates`)", () => {
    const parked = swing().after;
    const cont = continuation(parked);
    expect(Object.keys(cont.pendingOp).sort()).toEqual(["dest", "filter", "max", "op", "reveal", "typedAsAttachedBasicEnergy"]);
    expect((cont.pendingOp as { filter?: unknown }).filter).toEqual({ kind: "anyPokemon" });
    expect(JSON.stringify(cont.pendingOp)).toBe(JSON.stringify(PROGRAM[0]));
    expect(cont.rest).toEqual([{ op: "shuffleDeck" }]);
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "record", "rest"].filter((k) => k in cont).sort());
  });

  it("🛑 `MATCH_RECORD_VERSION` is 35 (🆕🆕🆕 D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) in `apps/api` — a widening, not a new shape", () => {
    const match = Object.entries(RAW).find(([k]) => k.endsWith("/lobby/match.ts"))?.[1] ?? "";
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(match).toContain("export const MATCH_RECORD_VERSION = 35;");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: the park over the typed subset, the answer, the flat control, the Special-only
// whiff, one type, duplicates, the opponent's Energy, no source, a Bench source, step time, the
// hand-authored `"any"`, the refusals, the decline, the rng, the replay, the control.
// ─────────────────────────────────────────────────────────────────────────────

describe("D531 §4 — the park offers EXACTLY the Pokémon whose type is a Basic Energy attached to the SOURCE, read at STEP time", () => {
  it("🛑 the board is what it says: P1's scout is Active with a {W} and a {R} Basic, P2's wall is Active, both Benches empty, turn 2, and the deck holds EVERY kind the offer must discriminate", () => {
    const before = table();
    expect(before.cardIdByUid[activeUid(before, "p1")]).toBe(SCOUT);
    expect(before.players.p1.active?.energy.map((uid) => before.cardIdByUid[uid])).toEqual([W_ENERGY, R_ENERGY]);
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe(WALL);
    expect(before.players.p2.active?.energy).toHaveLength(0);
    expect(before.players.p1.bench).toHaveLength(0);
    expect(before.players.p2.bench).toHaveLength(0);
    expect(before.turn).toBe(2);
    for (const id of [WATER, FIRE, GRASS, DUAL, WALL, SCOUT, ITEM]) {
      expect(inDeck(before, [id]).length, id).toBeGreaterThan(0);
    }
    // At most 5 typed candidates would make `max 5` un-binding; state the count so the "up to 5"
    // rungs below are read against a known offer size.
    expect(inDeck(before, [WATER, FIRE, DUAL]).length).toBeGreaterThan(0);
  });

  it("🛑 (i) {W}+{R} attached → ONE park: `chooseCards { min 0, max 5, dest \"hand\", reveal }` over EXACTLY the {W}, {R} and dual-type uids IN DECK ORDER — the {G} body, the Colorless bodies and the Item are NOT offered; the note quotes the printed RULE byte for byte; the base ALREADY dealt (`D531-resolver-reads-the-stack-not-the-energy` / `-caption-drops-the-rule`)", () => {
    const { before, after, events } = swing();
    expect(after.phase.kind).toBe("effect:choose");
    expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe("p1");
    const prompt = cardsPrompt(after);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(5);
    expect(prompt.dest).toBe("hand");
    // MEASURED: the park carries no `reveal` key — the rider lives on the op (and reaches
    // `DECK_SEARCHED` at the answer), never on the prompt (D225).
    expect("reveal" in prompt).toBe(false);
    expect(prompt.candidates).toEqual(inDeck(before, [WATER, FIRE, DUAL]));
    expect(prompt.candidates.length).toBeGreaterThan(0);
    for (const uid of inDeck(before, [GRASS, WALL, SCOUT, ITEM, W_ENERGY, R_ENERGY, G_ENERGY, SPECIAL])) {
      expect(prompt.candidates).not.toContain(uid);
    }
    expect(prompt.note).toBe(CAPTION);
    expect(prompt.note).toContain("that are the same type as any Basic Energy attached to this Pokémon");
    expect(prompt.note).not.toContain("Water");
    expect(prompt.note).not.toContain("Fire");
    expect("caps" in prompt).toBe(false);
    // The base is dealt in FULL beside the park: DAMAGE_DEALT lands BEFORE the park opens.
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({ seat: "p2", by: "p1", uid: activeUid(before, "p2"), dealt: BASE });
    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "EFFECT_PENDING"]);
    expect(searchedRows(events)).toHaveLength(0);
    expect(shuffleRows(events)).toHaveLength(0);
    // Nothing moved at the park.
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p1.deck).toEqual(before.players.p1.deck);
    expect(continuation(after).pendingOp).toEqual(PROGRAM[0]);
    expect(continuation(after).rest).toEqual([{ op: "shuffleDeck" }]);
  });

  it("🛑 (ii) pick one {W}, one {R} and the dual → the three uids to P1's HAND, the deck −3, `DECK_SEARCHED { dest: \"hand\", reveal: true }` with exactly those uids, the SHUFFLE after it under the attacker, the revealed log row MEASURED, the turn ends", () => {
    const { after: parked } = swing();
    const water = inDeck(parked, [WATER])[0];
    const fire = inDeck(parked, [FIRE])[0];
    const dual = inDeck(parked, [DUAL])[0];
    if (water === undefined || fire === undefined || dual === undefined) throw new Error("the deck lacks a body");
    const chosen = [water, fire, dual];
    for (const uid of chosen) expect(cardsPrompt(parked).candidates).toContain(uid);
    const { state, events } = pick(parked, chosen);
    expect(state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 3);
    for (const uid of chosen) expect(state.players.p1.hand).toContain(uid);
    expect(state.players.p1.deck).toHaveLength(parked.players.p1.deck.length - 3);
    for (const uid of chosen) expect(state.players.p1.deck).not.toContain(uid);
    const searched = searchedRows(events);
    expect(searched).toHaveLength(1);
    expect(searched[0]).toEqual({ type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: chosen, reveal: true });
    expect(shuffleRows(events)).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(types(events)).toEqual(["DECK_SEARCHED", "SHUFFLE", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(dealtRows(events)).toHaveLength(0); // the base was dealt BEFORE the park, not again
    expect(state.players.p2.active?.damage).toBe(BASE);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.turn).toBe(3);
    // MEASURED: `log.ts`'s REVEALED DECK_SEARCHED row names the cards — the print says "reveal them".
    const lines = rows(events, state);
    const searchedLine = lines.find((line) => line.includes("searched their deck"));
    if (searchedLine === undefined) throw new Error(`no search row in ${JSON.stringify(lines)}`);
    for (const name of ["D531 Water", "D531 Fire", "D531 Dual"]) expect(searchedLine).toContain(name);
    expect(lines).toContain("shuffled their deck");
    expect(lines).toContain("ended their turn");
  });

  it("🛑 (iii) THE FLAT CONTROL on the SAME board (index 1) offers EVERY Pokémon in the deck — {G} and Colorless included — under the byte-identical D231 caption: the two offers differ by exactly the off-type bodies (`D531-arm-drops-the-rider`)", () => {
    const typed = swing();
    const flat = swing({}, 1);
    expect(flat.before).toEqual(typed.before);
    const typedOffer = cardsPrompt(typed.after).candidates;
    const flatOffer = cardsPrompt(flat.after).candidates;
    expect(flatOffer).toEqual(inDeck(flat.before, ALL_POKEMON));
    expect(cardsPrompt(flat.after).note).toBe(FLAT_CAPTION);
    expect(cardsPrompt(flat.after).max).toBe(5);
    expect("reveal" in cardsPrompt(flat.after)).toBe(false);
    for (const uid of typedOffer) expect(flatOffer).toContain(uid);
    const extra = flatOffer.filter((uid) => !typedOffer.includes(uid));
    expect(extra).toEqual(inDeck(flat.before, [GRASS, WALL, SCOUT]));
    expect(extra.length).toBeGreaterThan(0);
    expect(continuation(flat.after).pendingOp).toEqual(FLAT_PROGRAM[0]);
  });

  it("🛑 (iv) THE DECIDED EDGE — a SPECIAL-ENERGY-ONLY attacker (an unauthored Special whose `energyProvidesOf` falls back to \"Colorless\", Colorless Pokémon IN the deck) → NO park, NO `DECK_SEARCHED`, the shuffle runs, the base dealt, the turn ends; the flat control on the same board still parks (`D531-resolver-skips-the-basic-energy-filter` / `-empty-types-fall-back-to-any-pokemon`)", () => {
    const { before, after, events } = swing({ attached: [SPECIAL] });
    expect(before.players.p1.active?.energy.map((uid) => before.cardIdByUid[uid])).toEqual([SPECIAL]);
    const attached = before.players.p1.active?.energy[0];
    if (attached === undefined) throw new Error("nothing attached");
    const card = before.cardPool[before.cardIdByUid[attached] ?? ""];
    if (card === undefined) throw new Error("no card");
    expect(energyProvidesOf(card)).toBe("Colorless"); // the fallback the category filter must run BEFORE
    expect(inDeck(before, [WALL, SCOUT]).length).toBeGreaterThan(0); // Colorless Pokémon are in the deck
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "SHUFFLE", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(searchedRows(events)).toHaveLength(0);
    expect(shuffleRows(events)).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect([...after.players.p1.deck].sort()).toEqual([...before.players.p1.deck].sort());
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    // …and the CONTROL parks every Pokémon on the same board: the whiff is the rider's, not the board's.
    const flat = swing({ attached: [SPECIAL] }, 1);
    expect(cardsPrompt(flat.after).candidates).toEqual(inDeck(flat.before, ALL_POKEMON));
  });

  it("🛑 (v) ONE type — a {R} Basic alone → the {R} bodies and the dual body only (a single `typedPokemon` cell; the dual is admitted through `types.includes`); the {W} bodies are OUT", () => {
    const { before, after } = swing({ attached: [R_ENERGY] });
    const prompt = cardsPrompt(after);
    expect(prompt.candidates).toEqual(inDeck(before, [FIRE, DUAL]));
    for (const uid of inDeck(before, [WATER, GRASS, WALL, SCOUT])) expect(prompt.candidates).not.toContain(uid);
    expect(prompt.note).toBe(CAPTION);
    expect(prompt.max).toBe(5);
    // A {G} Basic alone types the {G} body AND the dual body — the dual is a member of BOTH cells.
    const green = swing({ attached: [G_ENERGY] });
    expect(cardsPrompt(green.after).candidates).toEqual(inDeck(green.before, [GRASS, DUAL]));
  });

  it("🛑 (vi) DUPLICATES de-duplicate and a THIRD type widens: {W}+{R}+{R} offers what {W}+{R} offers; {W}+{R}+{G} offers every typed body and STILL no Colorless one; a Special beside two Basics adds nothing", () => {
    const base = swing();
    const twice = swing({ attached: [W_ENERGY, R_ENERGY, R_ENERGY] });
    expect(cardsPrompt(twice.after).candidates).toEqual(inDeck(twice.before, [WATER, FIRE, DUAL]));
    expect(cardsPrompt(twice.after).candidates.length).toBe(cardsPrompt(base.after).candidates.length);
    const three = swing({ attached: [W_ENERGY, R_ENERGY, G_ENERGY] });
    expect(cardsPrompt(three.after).candidates).toEqual(inDeck(three.before, [WATER, FIRE, GRASS, DUAL]));
    for (const uid of inDeck(three.before, [WALL, SCOUT])) expect(cardsPrompt(three.after).candidates).not.toContain(uid);
    const mixed = swing({ attached: [W_ENERGY, R_ENERGY, SPECIAL] });
    expect(cardsPrompt(mixed.after).candidates).toEqual(inDeck(mixed.before, [WATER, FIRE, DUAL]));
  });

  it("🛑 (vii) the OPPONENT's attached Energy is NEVER read: a {G} Basic on P2's Active does not type the {G} body for P1 — Special-only P1 against {G} P2 still whiffs, {W}-only P1 against {G} P2 offers the {W} bodies alone (`D531-resolver-reads-the-opponents-body`)", () => {
    const whiff = swing({ attached: [SPECIAL], opponentAttached: [G_ENERGY] });
    expect(whiff.before.players.p2.active?.energy.map((uid) => whiff.before.cardIdByUid[uid])).toEqual([G_ENERGY]);
    expect(whiff.after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(searchedRows(whiff.events)).toHaveLength(0);
    const water = swing({ attached: [W_ENERGY], opponentAttached: [G_ENERGY] });
    expect(cardsPrompt(water.after).candidates).toEqual(inDeck(water.before, [WATER]));
    for (const uid of inDeck(water.before, [GRASS, DUAL])) expect(cardsPrompt(water.after).candidates).not.toContain(uid);
  });

  it("🛑 (viii) NO SOURCE — a hand-authored run whose `ctx` carries no `sourceUid` (a Trainer-shaped context), or one whose `sourceUid` names a card that is not on the board — WHIFFS: done, no `DECK_SEARCHED`, the shuffle runs; the same op under the attacker's own `ctx` parks", () => {
    const board = table();
    const ctx = attackCtx(board);
    const { sourceUid, ...sourceless } = ctx;
    expect(sourceUid).toBe(activeUid(board, "p1"));
    const events: GameEvent[] = [];
    const none = runProgram(board, PROGRAM, sourceless, events);
    expect(none.kind).toBe("done");
    expect(searchedRows(events)).toHaveLength(0);
    expect(shuffleRows(events)).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    const deckUid = board.players.p1.deck[0];
    if (deckUid === undefined) throw new Error("empty deck");
    const offBoard = runProgram(board, PROGRAM, { ...ctx, sourceUid: deckUid }, []);
    expect(offBoard.kind).toBe("done");
    const live = runProgram(board, PROGRAM, ctx, []);
    expect(live.kind).toBe("parked");
  });

  it("🛑 (ix) A BENCH SOURCE — `sourceUid` naming a Bench body with a {G} Basic attached (an Ability-shaped context) resolves THAT body's Energy, not the Active's {W}+{R}: the {G} and dual bodies are offered, the {W} and {R} ones are not (`D531-resolver-reads-the-seats-active`)", () => {
    const board = table({ bench: { id: WALL, attached: [G_ENERGY] } });
    expect(board.players.p1.bench).toHaveLength(1);
    expect(board.players.p1.bench[0]?.energy.map((uid) => board.cardIdByUid[uid])).toEqual([G_ENERGY]);
    expect(board.players.p1.active?.energy.map((uid) => board.cardIdByUid[uid])).toEqual([W_ENERGY, R_ENERGY]);
    const ctx = attackCtx(board);
    const fromBench = runProgram(board, PROGRAM, { ...ctx, sourceUid: benchTopUid(board, "p1", 0) }, []);
    if (fromBench.kind !== "parked" || fromBench.prompt.kind !== "chooseCards") throw new Error("expected a park");
    expect(fromBench.prompt.candidates).toEqual(inDeck(board, [GRASS, DUAL]));
    for (const uid of inDeck(board, [WATER, FIRE])) expect(fromBench.prompt.candidates).not.toContain(uid);
    expect(fromBench.prompt.note).toBe(CAPTION);
    // …and the Active as source on the SAME board reads its own {W}+{R}: the two offers are disjoint
    // except for the dual body.
    const fromActive = runProgram(board, PROGRAM, ctx, []);
    if (fromActive.kind !== "parked" || fromActive.prompt.kind !== "chooseCards") throw new Error("expected a park");
    expect(fromActive.prompt.candidates).toEqual(inDeck(board, [WATER, FIRE, DUAL]));
  });

  it("🛑 (x) the Energy is read at STEP time, not when the program starts: a hand-authored program that DISCARDS the {W} Basic and THEN searches offers the {R} and dual bodies only, on a board that held {W}+{R} when the program began (`runProgram` → the same park the attack parks)", () => {
    const board = table();
    const ctx = attackCtx(board);
    const program: readonly EffectOp[] = [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "basicEnergy", energyType: "Water" }, count: 1 },
      ...PROGRAM,
    ];
    const events: GameEvent[] = [];
    let out = runProgram(board, program, ctx, events);
    // The discard may park its own pick when it has a choice; a single {W} is forced. Either way the
    // search that follows reads the board AFTER the discard.
    if (out.kind === "parked" && out.prompt.kind === "discardEnergy") {
      throw new Error("the single {W} discard parked — the rung assumes a forced discard");
    }
    if (out.kind !== "parked" || out.prompt.kind !== "chooseCards") throw new Error(`expected the search park, got ${out.kind}`);
    expect(out.state.players.p1.active?.energy.map((uid) => out.state.cardIdByUid[uid])).toEqual([R_ENERGY]);
    expect(out.prompt.candidates).toEqual(inDeck(out.state, [FIRE, DUAL]));
    for (const uid of inDeck(out.state, [WATER])) expect(out.prompt.candidates).not.toContain(uid);
    // …and the same op on the ORIGINAL board reads {W}+{R}: the types are the board's at the step.
    out = runProgram(board, PROGRAM, ctx, []);
    if (out.kind !== "parked" || out.prompt.kind !== "chooseCards") throw new Error("expected a park");
    expect(out.prompt.candidates).toEqual(inDeck(board, [WATER, FIRE, DUAL]));
  });

  it("🛑 (xi) a hand-authored `max: \"any\"` with the rider resolves its ceiling against the TYPED candidates, not the printed `anyPokemon` count — `prompt.max` equals the offer size and is SMALLER than the deck's Pokémon count (`D531-sized-reads-the-printed-groups`)", () => {
    const board = table();
    const ctx = attackCtx(board);
    const op: EffectOp = { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: "any", typedAsAttachedBasicEnergy: true };
    const out = runProgram(board, [op], ctx, []);
    if (out.kind !== "parked" || out.prompt.kind !== "chooseCards") throw new Error("expected a park");
    expect(out.prompt.candidates).toEqual(inDeck(board, [WATER, FIRE, DUAL]));
    expect(out.prompt.max).toBe(out.prompt.candidates.length);
    expect(out.prompt.max).toBeLessThan(inDeck(board, ALL_POKEMON).length);
    expect(out.prompt.note).toBe(
      "Search your deck for any number of Pokémon that are the same type as any Basic Energy attached to this Pokémon into your hand.",
    );
    // The printed row's own `max: 5` never reaches the resolved-count branch — this rung exists for
    // the hand-authored spelling alone, because the sized map is derived from the RESOLVED groups.
    const printedCount = inDeck(board, ALL_POKEMON).length;
    expect(printedCount).toBeGreaterThan(out.prompt.candidates.length);
  });

  it("🛑 (xii) the refusals at the park: a {G} uid IN THE DECK but not offered, an Energy uid, and the Active's own uid are `BAD_EFFECT_CHOICE`; DECLINE (choose []) → nothing moves, no `DECK_SEARCHED`, the deck STILL shuffles, the turn ends", () => {
    const { before, after } = swing();
    for (const uid of [inDeck(before, [GRASS])[0], inDeck(before, [W_ENERGY])[0], activeUid(after, "p1")]) {
      if (uid === undefined) throw new Error("no uid");
      const refused = applyAction(after, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [uid] } });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error("a non-candidate uid was accepted");
      expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
    }
    const { state, events } = pick(after, []);
    expect(state.players.p1.hand).toEqual(after.players.p1.hand);
    expect([...state.players.p1.deck].sort()).toEqual([...after.players.p1.deck].sort());
    expect(searchedRows(events)).toHaveLength(0);
    expect(shuffleRows(events)).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(types(events)).toEqual(["SHUFFLE", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (xiii) the OPPONENT's redacted view of the park: the prompt is NOT theirs (`prompt: null`); P1's view carries the typed candidates and the caption", () => {
    const { after: parked } = swing();
    expect(redactGame(parked, "p2").phase).toEqual({ kind: "effect:choose", prompt: null });
    const mine = redactGame(parked, "p1");
    if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "chooseCards") {
      throw new Error("P1's view does not carry the chooseCards prompt");
    }
    expect(mine.phase.prompt.candidates).toHaveLength(cardsPrompt(parked).candidates.length);
    expect(mine.phase.prompt.note).toBe(CAPTION);
  });

  it("🛑 (xiv) `rngState` is UNTOUCHED through the park and the pick — the shuffle that follows the pick is the ONLY consumer", () => {
    const { before, after } = swing();
    expect(after.rngState).toBe(before.rngState);
    const whiff = swing({ attached: [SPECIAL] });
    expect(whiff.after.rngState).not.toBe(whiff.before.rngState); // the trailing shuffle ran
  });

  it("🛑 (xv) replays identically from one seed — the same parked board and the same events twice; and the parked state JSON round-trips BYTE-EQUAL and resumes from its bytes", () => {
    const a = swing();
    const b = swing();
    expect(b.before).toEqual(a.before);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
    const persisted = JSON.parse(JSON.stringify(a.after)) as GameState;
    expect(persisted).toEqual(a.after);
    expect(JSON.stringify(persisted)).toBe(JSON.stringify(a.after));
    const [x] = cardsPrompt(a.after).candidates;
    if (x === undefined) throw new Error("no candidates");
    const live = pick(a.after, [x]);
    const replayed = pick(persisted, [x]);
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);
  });

  it("🛑 (xvi) the index-2 control: no program, no park, no shuffle, 30 dealt, the deck UNMOVED, the turn ends", () => {
    const { before, after, events } = swing({}, 2);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(after.players.p1.deck).toEqual(before.players.p1.deck);
    expect(after.players.p2.active?.damage).toBe(BASE);
  });

  it("never mutates the state it was given (purity — through the park and the pick)", () => {
    const before = table();
    const snapshot = JSON.stringify(before);
    const { state: parked } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    const parkedSnapshot = JSON.stringify(parked);
    const [x] = cardsPrompt(parked).candidates;
    if (x === undefined) throw new Error("no candidates");
    pick(parked, [x]);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(JSON.stringify(parked)).toBe(parkedSnapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — `programPlayable` is UNCHANGED: the grey-out has no `searchDeck` arm and cannot see the rider.
// ─────────────────────────────────────────────────────────────────────────────

describe("D531 §5 — the grey-out funnel has no `searchDeck` arm: the row is playable on every board, rider or not", () => {
  it("🛑 `programPlayable` is TRUE on the {W}+{R} board, TRUE on the Special-only board (the search whiffs but the attack is legal), and answers the flat sibling identically — `cardplay.ts` names no `searchDeck` at all", () => {
    for (const board of [table(), table({ attached: [SPECIAL] }), table({ attached: [R_ENERGY] })]) {
      expect(programPlayable(board, PROGRAM, "p1", activeUid(board, "p1"))).toBe(true);
      expect(programPlayable(board, FLAT_PROGRAM, "p1", activeUid(board, "p1"))).toBe(true);
      expect(programPlayable(board, PROGRAM, "p1")).toBe(programPlayable(board, FLAT_PROGRAM, "p1"));
    }
    const cardplay = Object.entries(RAW).find(([k]) => k.endsWith("/cardplay.ts"))?.[1] ?? "";
    expect(cardplay.length).toBeGreaterThan(10_000);
    expect(cardplay).not.toContain("searchDeck");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the version, the changelog heading, the literals this suite drove.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["./{censusAttackCorpus,index,effects,interpreter,cardplay}.ts", "../../../apps/api/src/lobby/match.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("D531 §6 — the version steps and the bytes this suite drove are the bytes that shipped", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.442.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision; the anchor, the arm's rider literal, the type, the resolver and the caption branch are byte for byte what this suite drove; the SIBLING pattern copied above is `effects.ts`'s", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.416.0 → **0.417.0** (D531");
    const effects = Object.entries(RAW).find(([k]) => k.endsWith("/effects.ts"))?.[1] ?? "";
    expect(effects).toContain(
      "const ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED =\n  /^Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand\\. Then, shuffle your deck\\.$/;",
    );
    expect(effects).toContain("        reveal: true,\n        typedAsAttachedBasicEnergy: true,\n      },");
    expect(effects).toContain("      typedAsAttachedBasicEnergy?: true;");
    // The sibling's source, spelled here as three JS string literals — the same three the test copies.
    expect(effects).toContain(
      '"^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +\n    "|(?:up to (\\\\d+)|(any number of)) ([^,.]+?)( of different types)?(, reveal them,)? and put them)" +\n    " into your hand\\\\. Then, shuffle your deck\\\\.$",',
    );
    const interpreter = Object.entries(RAW).find(([k]) => k.endsWith("/interpreter.ts"))?.[1] ?? "";
    expect(interpreter).toContain("function attachedBasicEnergyTypedFilter(state: GameState, ctx: EffectContext): CardFilter {");
    expect(interpreter).toContain("  const [host] = sourceRef(state, ctx);\n  const body = host === undefined ? undefined : refPokemon(state, host);");
    expect(interpreter).toContain('    if (card === undefined || !matchesFilter(card, { kind: "basicEnergy" })) continue;');
    expect(interpreter).toContain('  return { kind: "anyOf", filters: types.map((pokemonType) => ({ kind: "typedPokemon", pokemonType })) };');
    expect(interpreter).toContain("i === 0 ? { ...g, filter: attachedBasicEnergyTypedFilter(state, ctx) } : g,");
    expect(interpreter).toContain("            op.typedAsAttachedBasicEnergy === true,\n          ),");
    expect(interpreter).toContain(
      "    const plural = typedAsAttachedBasicEnergy\n      ? `${printedPlural} that are the same type as any Basic Energy attached to this Pokémon`\n      : printedPlural;",
    );
    // D513's caption line and the D336 union line are UNTOUCHED (their mutant finds still hold).
    expect(interpreter).toContain("    const many = distinctEnergyTypes ? `${plural} of different types` : plural;");
    expect(interpreter).toContain("        groups.some((g) => matchesFilter(cardOf(state, uid), g.filter)),");
    // NO new op, no new prompt kind, no new filter member: the widening is one optional key.
    expect(effects).not.toContain('op: "searchDeckTyped"');
    expect(effects).not.toContain('kind: "typedAsAttachedBasicEnergy"');
  });
});
