import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { programPlayable } from "./cardplay";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  ENERGY_TYPE_BY_CODE,
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
import type { GameEvent, GameState, Seat } from "./index";
import type { EffectContext, EffectContinuation, EffectPrompt, PokemonRef } from "./interpreter";
import { attachEnergyTargets, attachSeat, runProgram } from "./interpreter";
import { logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.417.0 → 0.418.0 — 🆕🆕🆕 D532: THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE
// OPTIONAL KEY `whose?: "opponent"` (on the op AND on `AttachTargetRiders`), READ THROUGH ONE RESOLVER,
// A WIDENING AT A PERSISTED ADDRESS.
//
// *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you
// like."* — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), **1 sentence /
// 1 legal printing** (Grafaiai `sv08-121` per `derivedDiscardAttach.test.ts`'s retired `UNREAD` row and
// `attachDecline.test.ts`'s population note — not in `catalogManifest` / `FIXTURE_POOL` on this
// checkout, so the demonstrator below is DECLARED and no id is invented, D425), claimed by
// `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, a
// SEPARATE literal beside the factory-built `DISCARD_ATTACH`; the `3` is a LITERAL, not a capture — a
// pool of one, D121; the apostrophe classed `['’]`, the family convention) as D360's spread ONE KEY
// OVER — THREE independent declinable one-card parks, `count` ABSENT (*"in any way you like"* denies a
// batch, D205), the bare plural *"Energy cards"* read as the whole category (`anyEnergy: true`, D246's
// reading of *"an Energy card"* applied to the plural — DECIDED and pinned, D421: a Special in the
// opponent's pile IS offered), and `whose: "opponent"`:
//
//   Array.from({ length: 3 }, () => ({ op: "attachEnergyFrom", source: "discard", anyEnergy: true,
//                                        declinable: true, whose: "opponent" }))
//
// 🛑 **THE SEAT IS RESOLVED ONCE** — `attachSeat(op, ctx.seat)` (interpreter.ts, D336's one-resolver
// rule) — and read at the park guard (the printed pile), the target funnel (`attachEnergyTargets`,
// through the riders, so the three `ctx.seat` call sites stay byte-intact), the apply (the pile drained,
// the board rewritten, the ref validated against the OWNER's seat) and `cardplay.ts`'s whiff gate. NOT
// by the events: `ENERGY_ATTACHED.seat` stays the ACTOR (every event's seat is the actor) and `target`
// is the chosen spot on the OPPONENT's board; `log.ts`'s `energyHostName` scans the other seat before
// falling back to "a Pokémon". The caption names whose board the rows are on — *"Attach the Energy to
// which of your opponent's Pokémon?"* — through `attachTargetNoun` (a shadow of `zone`, so D354's line
// and the three-line caption at the park stay byte for byte; their mutant finds hold).
//
// 🛑 **IT IS A WIDENING AT A PERSISTED ADDRESS, AND IT IS DRIVEN RATHER THAN ARGUED.** The op PARKS,
// so the key rides `EffectContinuation.pendingOp` inside `MatchRecord.state.phase.cont`. A v30 record
// carries no such key, this build reads that as `undefined`, and `undefined` is the actor's own pile
// AND own board — what every v30 writer meant. §3 drives it in THREE directions (D531 §3's shape),
// including the LOSS direction ON THE BOARD: a dropped key is the own-seat spread, and the board
// DIFFERS — the parked candidates carry the OTHER seat and the answer drains the OTHER pile.
//
// 🛑 **THE REFUSAL ON RECORD WAS TRUE OF THE FIELD AND NAMED THE WRONG LAYER.** `derivedDiscardAttach
// .test.ts`'s `UNREAD` row read *"`source` names a ZONE, never a SEAT: every target the op can produce
// is `ctx.seat`'s, and every card it can take is theirs too"*. `source` STILL names a zone; the seat was
// a fact about three `ctx.seat` READS in the interpreter, not about the type (D520 (2)) — one optional
// key and one resolver, no vocabulary. INVERTED in place (D178/D418): the row leaves `UNREAD` for a
// `LITERAL` table, the family's 17 is re-derived as CLAUSES 15 + UNREAD 0 + BUILT_ELSEWHERE 1 +
// LITERAL 1, and the retired reason is quoted beside a positive rung.
//
// ⚠️ **THE OWN-SEAT BARE-PLURAL TWIN STAYS DARK** — *"Attach up to 3 Energy cards from your discard
// pile to your Pokémon in any way you like."* derives null: the factory clause spells only *"(an)
// Energy card"* (singular) and *"up to N Basic … Energy cards"*, no bare plural. It is the SECOND AXIS
// of D489's lattice and is asserted here, not widened.

/** Corpus FILE LINE 70, byte for byte. Asserted off the corpus in §1, never retyped elsewhere. The
    corpus prints U+0027; the anchor classes `['’]` (§1 admits the curly form too). */
const PRINTED = "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.";
/** THE OWN-SEAT BARE-PLURAL TWIN — DARK (D489's second axis). Differs from `PRINTED` in the seat words
    and in NOTHING else: same count, same bare plural, same distribution. */
const TWIN = "Attach up to 3 Energy cards from your discard pile to your Pokémon in any way you like.";
/** THE BUILT SIBLING — D360's own-seat spread on `DISCARD_ATTACH` (corpus row; `Basic` printed). */
const OWN_SPREAD = "Attach up to 3 Basic Energy cards from your discard pile to your Pokémon in any way you like.";

/** THE PROGRAM, spelled once — three ops, five keys each. */
const ONE_OP = {
  op: "attachEnergyFrom",
  source: "discard",
  anyEnergy: true,
  declinable: true,
  whose: "opponent",
} as const satisfies EffectOp;
const PROGRAM: readonly EffectOp[] = [ONE_OP, ONE_OP, ONE_OP];
/** The own-seat D360 spread's program — `PROGRAM` minus `whose` and minus `anyEnergy` (the sibling
    prints `Basic`). */
const OWN_SPREAD_PROGRAM: readonly EffectOp[] = Array.from({ length: 3 }, () => ({
  op: "attachEnergyFrom",
  source: "discard",
  declinable: true,
}));
/** A v30-legal FLAGLESS op: `PROGRAM[0]` with `whose` dropped — the own pile, the own board. */
const V30_OP: EffectOp = { op: "attachEnergyFrom", source: "discard", anyEnergy: true, declinable: true };

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

/** Every reader on the module surface, called by name — the D480/D482 oracle. */
function readersClaiming(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
    if (read === undefined) throw new Error(`no reader ${name}`);
    return read(text) !== null;
  });
}

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

/** `DISCARD_ATTACH`'s source, REBUILT from `attachFromZoneClause`'s three segments (the anchor and
    the factory are module-private) so §1 can show the READING: the sibling REFUSES the row (its zone
    phrase is " from your discard pile", not a substring of the print) and REFUSES the bare-plural twin
    (the article weld: "(an) Energy card" / "up to N Basic … Energy cards" — no bare plural) while
    ADMITTING the D360 spread. The three segments are pinned against `effects.ts`'s bytes in §6. */
const CODES = Object.keys(ENERGY_TYPE_BY_CODE).join("");
/** `SOURCE_ZONE_PHRASE`, copied — the one word that keeps the sibling off this row (pinned in §6). Every
    segment below interpolates, for the lint reason the factory's own doc block names (`useTemplate` /
    `noUnusedTemplateLiteral`). */
const SOURCE_ZONE = " from your discard pile";
const CLAUSE =
  `(?:(an) Energy card|a Basic (?:\\{([${CODES}])\\} )?Energy card` +
  `|up to (\\d+) Basic (?:\\{([${CODES}])\\} )?Energy cards)` +
  `${SOURCE_ZONE} to ([^.]+)\\.`;
const SIBLING = new RegExp(`^Attach ${CLAUSE}$`);

// ─────────────────────────────────────────────────────────────────────────────
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D520–D531).
// ─────────────────────────────────────────────────────────────────────────────

/** DECLARED, not read: the printing's base and cost are unresolvable here (no D1, no
    `FIXTURE_POOL` id). */
const BASE = 30;
const GRAFAIAI = "d532-grafaiai";
/** The defender — 400 HP so nothing here Knocks it Out. */
const WALL = "d532-wall";
/** The opponent's Bench bodies (and, in (viii), the attacker's own). */
const BENCHER = "d532-bencher";
/** `FIXTURE_POOL`'s Basics (Colorless, {R}, {W}) and its unauthored Special. */
const C_ENERGY = "fix-energy";
const R_ENERGY = "fix-fire-energy";
const W_ENERGY = "fix-water-energy";
const SPECIAL = "fix-special";
const ITEM = "fix-item";

const ATTACH_CARDS: Record<string, Card> = {
  [GRAFAIAI]: battler(GRAFAIAI, {
    name: "D532 Grafaiai",
    types: ["Darkness"],
    hp: 120,
    retreat: 1,
    attacks: [
      /** index 0 — FILE LINE 70 verbatim, with a DECLARED base and cost. */
      { cost: ["Colorless"], name: "Borrowed Charge", damage: BASE, effect: PRINTED },
      /** index 1 — the DARK twin: the own-seat bare plural, no reader claims it (the LOUD control). */
      { cost: ["Colorless"], name: "Own Charge", damage: BASE, effect: TWIN },
      /** index 2 — no effect, no program. */
      { cost: ["Colorless"], name: "Jab", damage: BASE },
    ],
  }),
  [WALL]: battler(WALL, { name: "D532 Wall", types: ["Colorless"], hp: 400 }),
  [BENCHER]: battler(BENCHER, { name: "D532 Bencher", types: ["Colorless"], hp: 100 }),
};

const ATTACH_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...ATTACH_CARDS };

/** Its own deck (D270), 60 counted before the first run: 4 + 4 + 8 + 6 + 14 + 8 + 8 + 8. */
const ATTACH_DECK = deckOf({
  [GRAFAIAI]: 4,
  [WALL]: 4,
  [BENCHER]: 8,
  [ITEM]: 6,
  [C_ENERGY]: 14,
  [R_ENERGY]: 8,
  [W_ENERGY]: 8,
  [SPECIAL]: 8,
});

/** The opening shuffle alone — nothing in this op is a coin or a shuffle. Stated (D523 (8)). */
const SEED = 7;

function openTable(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: ATTACH_DECK, p2: ATTACH_DECK },
    cardPool: ATTACH_POOL,
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

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");
const SEATS = ["p1", "p2"] as const;

type Board = {
  /** Who attacks. Default p1 (turn 2); p2 attacks on turn 3 after p1 passes (D490 — both seats). */
  readonly attacker?: Seat;
  /** The OPPONENT's discard pile, in pile order. Default two {R} Basics, the Special, an Item. */
  readonly opponentPile?: readonly string[];
  /** The ATTACKER's own discard pile — the pile that must NEVER be read. Default two {W} Basics. */
  readonly ownPile?: readonly string[];
  /** How many Bench bodies the opponent fields. Default 2. */
  readonly opponentBench?: number;
  /** How many Bench bodies the attacker fields — never candidates. Default 0. */
  readonly ownBench?: number;
};

/** The attacker's Active is the demonstrator holding one {C} Basic (pays the cost); the defender's
    Active is the wall; both Benches CLEARED after the Active surgeries, then re-seeded; both piles
    seeded by surgery off the decks. */
function table(board: Board = {}): GameState {
  const attacker = board.attacker ?? "p1";
  const defender = other(attacker);
  let state = openTable(SEED);
  state = setActiveFromDeck(state, attacker, GRAFAIAI);
  state = attachFromDeck(state, attacker, C_ENERGY, 1);
  state = clearBench(state, attacker);
  state = setActiveFromDeck(state, defender, WALL);
  state = clearBench(state, defender);
  for (let i = 0; i < (board.opponentBench ?? 2); i++) state = benchFromDeck(state, defender, BENCHER);
  for (let i = 0; i < (board.ownBench ?? 0); i++) state = benchFromDeck(state, attacker, BENCHER);
  for (const id of board.opponentPile ?? [R_ENERGY, R_ENERGY, SPECIAL, ITEM]) {
    state = discardFromDeck(state, defender, id, 1);
  }
  for (const id of board.ownPile ?? [W_ENERGY, W_ENERGY]) state = discardFromDeck(state, attacker, id, 1);
  if (attacker === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board = {}, index = 0): Swing {
  const before = table(board);
  const seat = board.attacker ?? "p1";
  const { state: after, events } = mustApply(before, { type: "attack", seat, index });
  return { before, after, events };
}

function pokemonPrompt(state: GameState): Extract<EffectPrompt, { kind: "choosePokemon" }> {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function continuation(state: GameState): EffectContinuation {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  return state.phase.cont;
}

/** The attacker's own `EffectContext` — read off a REAL park rather than hand-spelled. */
function attackCtx(state: GameState, seat: Seat = "p1"): EffectContext {
  return continuation(mustApply(state, { type: "attack", seat, index: 0 }).state).ctx;
}

/** Card ids of a uid list, in order. */
const ids = (state: GameState, uids: readonly string[]): string[] => uids.map((uid) => state.cardIdByUid[uid] ?? "?");
/** The refs `attachEnergyTargets` must offer: Active first, then the bench in index order. */
const boardRefs = (state: GameState, seat: Seat): PokemonRef[] => [
  ...(state.players[seat].active === null ? [] : [{ seat, spot: { spot: "active" as const } }]),
  ...state.players[seat].bench.map((_, index) => ({ seat, spot: { spot: "bench" as const, index } })),
];

/** Answer a parked choosePokemon — with a ref, or DECLINE (no ref). */
const pick = (state: GameState, seat: Seat, ref?: PokemonRef) =>
  mustApply(state, {
    type: "resolveEffect",
    seat,
    choice: ref === undefined ? { kind: "pokemon" } : { kind: "pokemon", ref },
  });

const NAMES = { p1: "P1", p2: "P2" } as const;
const rows = (events: readonly GameEvent[], state: GameState): string[] =>
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
    entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
  );

function attachedRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "ENERGY_ATTACHED" }> => e.type === "ENERGY_ATTACHED");
}
function dealtRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
}

/** THE CAPTION, MEASURED ONCE and pinned byte for byte: `parkOrForce`'s note over `attachTargetNoun`
    carrying the printed *"their"* as "your opponent's". */
const CAPTION = "Attach the Energy to which of your opponent's Pokémon?";
/** The own-seat caption — D205's byte-identical note (the v30 flagless op parks under it). */
const OWN_CAPTION = "Attach the Energy to which of your Pokémon?";

// ─────────────────────────────────────────────────────────────────────────────
// §1 — derivation: the exact program, the only claimant, both anchor ends, the one-axis near-misses
// (the DARK own-seat twin among them — D489's second axis), the sibling's READING, the census identity.
// ─────────────────────────────────────────────────────────────────────────────

describe("D532 §1 — file line 70 derives to EXACTLY three `attachEnergyFrom { discard, anyEnergy, declinable, whose: \"opponent\" }` ops", () => {
  it("🛑 the row derives to the program — THREE ops, FIVE keys each, `count` ABSENT, the key set pinned (`D532-arm-drops-whose` / `-arm-drops-anyEnergy`)", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    const got = deriveAttackEffect(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(got).toHaveLength(3);
    for (const op of got) {
      if (op.op !== "attachEnergyFrom") throw new Error("not an attachEnergyFrom");
      expect(Object.keys(op).sort()).toEqual(["anyEnergy", "declinable", "op", "source", "whose"]);
      expect(op.whose).toBe("opponent");
      expect(op.anyEnergy).toBe(true);
      expect(op.declinable).toBe(true);
      expect(op.source).toBe("discard");
      expect("count" in op).toBe(false);
      expect("toSelf" in op).toBe(false);
      expect("toEach" in op).toBe(false);
      expect("energyType" in op).toBe(false);
      expect("energyName" in op).toBe(false);
      expect("bonusCounters" in op).toBe(false);
      expect("healTarget" in op).toBe(false);
      expect("recordAs" in op).toBe(false);
    }
    // The three are INDEPENDENT objects (D360's spread), not one object three times.
    expect(got[0]).not.toBe(got[1]);
    // The two keys between the row and the own-seat D360 spread — an INEQUALITY of programs.
    expect(deriveAttackEffect(OWN_SPREAD)).toEqual(OWN_SPREAD_PROGRAM);
    expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(OWN_SPREAD));
    expect(got.map((op) => ({ ...op, whose: undefined, anyEnergy: undefined }))).toEqual(
      OWN_SPREAD_PROGRAM.map((op) => ({ ...op, whose: undefined, anyEnergy: undefined })),
    );
  });

  it("🛑 `deriveAttackEffect` is the ONLY claimant — `readersClaiming` is exactly [deriveAttackEffect], twelve readers and four splitters null — and the surface is still THIRTEEN", () => {
    expect(readersClaiming(PRINTED)).toEqual(["deriveAttackEffect"]);
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13);
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it("🛑 the anchor is WHOLE-SENTENCE at the HEAD: a PREFIXED print is null on every reader — and the TRAILING splitter COMPOSES `{head: \"Draw a card.\", tail: row}` because BOTH halves are now claimed (measured; D531's two-sentence row did not compose) while the census still reads the compound as unresolved (`D532-anchor-loses-the-head`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed)).toBe(false);
    // On the `^`-dropped mutant `deriveAttackEffect(prefixed)` returns the program — this is the rung
    // that goes red; the composition below is the same on both builds.
    for (const reader of READERS) expect(reader(prefixed), reader.name).toBeNull();
    expect(splitAttackCancelClause(prefixed)).toBeNull();
    expect(splitAttackGateClause(prefixed)).toBeNull();
    expect(splitAttackRequirementClause(prefixed)).toBeNull();
    expect(splitAttackTrailingClause(prefixed)).toEqual({ head: "Draw a card.", tail: PRINTED });
    expect(resolvedByAnyReader(prefixed)).toBe(false);
  });

  it("🛑 …and at the TAIL: a SUFFIXED print is null on every reader, and the TRAILING splitter COMPOSES `{head: row, tail}` because the head is now claimed (D526 (5); `D532-anchor-loses-the-tail`)", () => {
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === suffixed)).toBe(false);
    for (const reader of READERS) expect(reader(suffixed), reader.name).toBeNull();
    expect(resolvedByAnyReader(suffixed)).toBe(false);
    expect(splitAttackCancelClause(suffixed)).toBeNull();
    expect(splitAttackGateClause(suffixed)).toBeNull();
    expect(splitAttackRequirementClause(suffixed)).toBeNull();
    // MEASURED at D532 (D531's shape): on the `$`-dropped mutant the READER swallows the whole string,
    // so `deriveAttackEffect(suffixed)` above is the rung that goes red.
    expect(splitAttackTrailingClause(suffixed)).toEqual({ head: PRINTED, tail: "Draw a card." });
  });

  it("🛑 one-axis near-misses, all null on EVERY reader — `Basic Energy cards`, the OWN pile to THEIR Pokémon, THEIR pile to YOUR Pokémon, `up to 2`, no `up to`, a lowercase head, no final period — and the OWN-SEAT BARE-PLURAL TWIN, which stays DARK (D489's second axis)", () => {
    const controls: Record<string, string> = {
      "`Basic Energy cards` for `Energy cards` — the bare plural is the literal (and `anyEnergy` is its reading)":
        "Attach up to 3 Basic Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      "`your discard pile` with `their Pokémon` — the two seat words move TOGETHER or not at all":
        "Attach up to 3 Energy cards from your discard pile to their Pokémon in any way you like.",
      "`your opponent's discard pile` with `your Pokémon` — the cross no card prints":
        "Attach up to 3 Energy cards from your opponent's discard pile to your Pokémon in any way you like.",
      "`up to 2` for `up to 3` — the count is a LITERAL, not a capture (D121: a pool of one)":
        "Attach up to 2 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      "no `up to` — the hedge is printed": "Attach 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      "a lowercase head — no /i on the anchor":
        "attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      "the final period missing — `\\.$` is the anchor's tail":
        "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like",
      "🛑 THE OWN-SEAT BARE-PLURAL TWIN — DARK: the factory clause spells `(an) Energy card` and `up to N Basic … Energy cards`, never a bare plural, and this slice widened neither":
        TWIN,
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      for (const reader of READERS) expect(reader(s), `${why} — ${reader.name}`).toBeNull();
      expect(readersClaiming(s), why).toEqual([]);
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(legalAttackCorpus().some(([, t]) => t === s), why).toBe(false);
    }
    // …and the curly-apostrophe spelling IS admitted — the `['’]` class is the family convention, and
    // the corpus prints U+0027 on this row (asserted in the identity rung below).
    const curly = PRINTED.replace("'", "’");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackEffect(curly)).toEqual(PROGRAM);
    expect(legalAttackCorpus().some(([, t]) => t === curly)).toBe(false);
  });

  it("🛑 THE READING RUNG: the SIBLING `DISCARD_ATTACH` (rebuilt from the factory's three segments) REFUSES the row — its zone phrase is not a substring of the print — REFUSES the bare-plural twin (the article weld) and ADMITS the D360 spread; so the row derives on its OWN anchor (keeps derivedDiscardAttach's D418 discrimination)", () => {
    expect(SIBLING.exec(PRINTED)).toBeNull();
    expect(PRINTED.includes(" from your discard pile")).toBe(false);
    expect(PRINTED.includes(" from your opponent's discard pile")).toBe(true);
    expect(SIBLING.exec(TWIN)).toBeNull();
    const m = SIBLING.exec(OWN_SPREAD);
    if (m === null) throw new Error("the sibling anchor does not admit the D360 spread");
    expect(m[3]).toBe("3");
    expect(m[5]).toBe("your Pokémon in any way you like");
    expect(m[1]).toBeUndefined();
    expect(deriveAttackEffect(OWN_SPREAD)).toEqual(OWN_SPREAD_PROGRAM);
    // The bare SINGULAR is the sibling's D246 arm (Landorus): `anyEnergy` on ONE op, no seat key.
    const landorus = "Attach an Energy card from your discard pile to this Pokémon.";
    expect(SIBLING.exec(landorus)?.[1]).toBe("an");
    expect(deriveAttackEffect(landorus)).toEqual([{ op: "attachEnergyFrom", source: "discard", anyEnergy: true, toSelf: true }]);
  });

  it("🛑 the sentence is the CORPUS's bytes at exactly ONE printing, at index 17, it is RESOLVED, the raw file line IS 70, and the corpus apostrophe is U+0027", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[1, PRINTED]]);
    expect(corpus.findIndex(([, s]) => s === PRINTED)).toBe(17);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const raw = Object.entries(RAW).find(([k]) => k.endsWith("/censusAttackCorpus.ts"))?.[1] ?? "";
    expect(raw.split("\n")[69]).toBe(`1 ${PRINTED}`);
    expect(PRINTED).toContain("'");
    expect(PRINTED).not.toContain("’");
  });

  it("🛑 the anchor's claimed set over all 640 rows is EXACTLY {file line 70} — 1 sentence / 1 printing; `whose: \"opponent\"` rides ONE derived attack row in the column; the `LIKE '%from your opponent''s discard pile to their%'` census is ONE row", () => {
    const [n, u, claimed] = claims(
      /^Attach up to 3 Energy cards from your opponent['’]s discard pile to their Pokémon in any way you like\.$/,
    );
    expect([n, u]).toEqual([1, 1]);
    expect(claimed).toEqual([PRINTED]);
    const all = legalAttackCorpus();
    expect(all).toHaveLength(640);
    const withWhose = all.filter(([, s]) =>
      (deriveAttackEffect(s) ?? []).some((op) => (op as { whose?: unknown }).whose === "opponent" && op.op === "attachEnergyFrom"),
    );
    expect(withWhose).toEqual([[1, PRINTED]]);
    expect(all.filter(([, s]) => s.includes("from your opponent's discard pile to their")).map(([, s]) => s)).toEqual([PRINTED]);
    // …and the twins are CONSTRUCTIONS: the column prints neither the bare-plural twin nor the
    // "up to 3 Basic" spread — D360's PRINTED own-seat spread is the "up to 2" one (Morpeko), and
    // it stays on the sibling arm at TWO ops, no `whose`, no `anyEnergy`.
    expect(all.some(([, s]) => s === TWIN)).toBe(false);
    expect(all.some(([, s]) => s === OWN_SPREAD)).toBe(false);
    const morpeko = "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.";
    expect(all.filter(([, s]) => s === morpeko)).toEqual([[1, morpeko]]);
    expect(deriveAttackEffect(morpeko)).toEqual(OWN_SPREAD_PROGRAM.slice(0, 2));
  });

  it("the fixture pool is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, sv08-121 is unresolvable here, and the Energy fixtures are what their names say", () => {
    expect(Object.keys(ATTACH_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(ATTACH_DECK).toHaveLength(60);
    expect(FIXTURE_POOL["sv08-121"]).toBeUndefined();
    expect(ATTACH_CARDS[GRAFAIAI]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(ATTACH_CARDS[GRAFAIAI]?.attacks?.[1]?.effect).toBe(TWIN);
    expect(ATTACH_CARDS[GRAFAIAI]?.attacks?.[2]?.effect).toBeUndefined();
    for (const id of [C_ENERGY, R_ENERGY, W_ENERGY]) expect(FIXTURE_POOL[id]?.energyType, id).toBe("Normal");
    expect(FIXTURE_POOL[SPECIAL]?.energyType).toBe("Special");
    expect(FIXTURE_POOL[ITEM]?.category).toBe("Trainer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the census moved in exactly ONE summand, by 1 sentence / 1 printing.
// ─────────────────────────────────────────────────────────────────────────────

describe("D532 §2 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("🛑 the reader arm reads 558 sentences / 1,600 printings, and the row is IN it", () => {
    // 🆕🆕🆕 D532's OWN literals, annotated in-slice so the next sweep sees them: the reader arm
    // 557/1599 → 558/1600 — corpus FILE LINE 70, ⚠️ sentence step 1 / printing step 1.
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([586, 1642]);  // (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** — Koraidon `sv05-119`/`svp-091` "Primordial Beatdown" (`IN_PLAY_BODY_NOUNS` "Ancient Pokémon"), Roaring Moon `sv05-109`/`sv08.5-065` "Vengeance Fletching" (`DISCARD_PILE_NOUNS` "Ancient card"), Iron Valiant `sv05-080` "Majestic Sword" and Slither Wing `sv06.5-026` "Iron Smasher" (two literal `CONDITIONAL_DAMAGE_CLAUSES` rows), all over `banners.ts`' widened table (582/1636 → 586/1642)) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES, NOW THAT THE BANNER HAS A WRITER** — Ho-Oh `sv08-019` "Shining Blaze" (*"If you have any Tera Pokémon on your Bench, this attack does 100 more damage."*) and Regigigas `sv08.5-086` "Jewel Breaker" (*"If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."*), one legal printing each, two literal `CONDITIONAL_DAMAGE_CLAUSES` rows over `banners.ts` (580/1634 → 582/1636)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: reader arm 578/1632 → 580/1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: reader arm 577/1631 → 578/1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: reader arm 573/1627 → 577/1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: reader arm 572/1625 → 573/1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: reader arm 570/1621 → 572/1625.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: reader arm 568/1619 → 570/1621.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 567/1617 → 568/1619.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 566/1615 → 567/1617.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 563/1611 → 564/1613.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 562/1608 → 563/1611.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 561/1606 → 562/1608.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1603 → 561/1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    // …and the step is THIS sentence and nothing else: remove it and the pair is D531's. ⚠️ THE
    // OWN-ROW `without` PAIR: resolved − THIS suite's ONE-printing row (D525 (5)'s trap).
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([585, 1641]);  // (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** (Koraidon ×2 "Primordial Beatdown", Roaring Moon ×2 "Vengeance Fletching", Iron Valiant "Majestic Sword", Slither Wing "Iron Smasher" — two noun rows and two literal clause rows over `banners.ts`); this suite's own row is unmoved.) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`), two literal rows over `banners.ts`; this suite's own row is unmoved.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 577/1631 → 579/1633.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 576/1630 → 577/1631.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 572/1626 → 576/1630.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the `without` pair (resolved MINUS this suite's own row) 571/1624 → 572/1626.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 569/1620 → 571/1624.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 567/1618 → 569/1620.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 566/1616 → 567/1618, RE-DERIVED BY HAND rather than copied (D525(5)).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 565/1614 → 566/1616, RE-DERIVED BY HAND rather than copied (D525(5)).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: 562/1610 → 563/1612.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ THE OWN-ROW `without` PAIR, RE-DERIVED BY HAND as resolved − this suite's OWN row (D525 (5)) and never copied from the resolved pair — 561/1607 → 562/1610.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1605 → 561/1607.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 559/1602 → 560/1605.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 82 / 132 — and the row left it", () => {
    // 🆕🆕🆕 D532's OWN literal (corpus FILE LINE 70): 83/133 → 82/132.
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([54, 90]);  // (🆕🆕🆕 **D569 −4 sentences / −6 printings — THE PARADOX BANNER READERS LEFT THE RAW RESIDUE** — Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing; the reader rung's +4/+6 seen from the other side (58/96 → 54/90)) (🆕🆕🆕 **D568 −2 sentences / −2 printings — THE TWO TERA CLAUSES LEFT THE RAW RESIDUE** — Ho-Oh `sv08-019` and Regigigas `sv08.5-086`, the reader rung's +2/+2 seen from the other side (60/98 → 58/96)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: raw reader-only residue 62/100 → 60/98.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: raw reader-only residue 63/101 → 62/100.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: raw reader-only residue 67/105 → 63/101.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: raw reader-only residue 68/107 → 67/105.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: raw reader-only residue 70/111 → 68/107.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: raw reader-only residue 72/113 → 70/111.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 73/115 → 72/113.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 74/117 → 73/115.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 77/121 → 76/119.)  // (🆕🆕🆕 **D538 −1 sentence / −3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 78/124 → 77/121.)  // (🆕🆕🆕 **D537 −1 sentence / −2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 79/126 → 78/124.)  // (🆕🆕🆕 **D536 −1 sentence / −3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 80/129 → 79/126.)  // (🆕🆕🆕 **D535 −1 sentence / −2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 −1 sentence / −1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    const all = legalAttackCorpus();
    expect(unbuilt.length + 586).toBe(all.length);  // (🆕🆕🆕 **D569 +4 sentences — THE PARADOX BANNER READERS** (Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing); the offset gains four.) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`), two literal rows over `banners.ts`; this suite's own row is unmoved.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the partition summand 578 → 580.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the partition summand 577 → 578.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the partition summand 573 → 577.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the partition summand 572 → 573.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the partition summand 570 → 572 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the partition summand 568 → 570 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the partition summand 567 → 568 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the partition summand 566 → 567 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: a LIVE ADDEND at the FRONT (D461's table: the tell is the left-hand side), 563 → 564.)  // (🆕🆕🆕 **D538 +1 sentence — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — + 562 → + 563. SENTENCES, so the step is 1.)  // (🆕🆕🆕 **D537 +1 sentence — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A FROZEN TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — 561 → 562.)  // (🆕🆕🆕 **D536 +1 sentence — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229`), claimed by `deriveAttackEffect` through arm 44c over ONE new zero-capture anchor `TR_ENERGY_COST_THEN_DISCARD_DEFENDER` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree HARDER than D535's 1-vs-2. THIS SITE: 561 → 562.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(units(unbuilt) + 1642).toBe(units(all));  // (🆕🆕🆕 **D569 +6 printings — THE PARADOX BANNER READERS** (Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing); the offset gains six.) (🆕🆕🆕 **D568 +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`); the offset gains two.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1632 → 1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1631 → 1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1627 → 1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the PRINTINGS partition summand 1625 → 1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1621 → 1625 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the PRINTINGS partition summand 1619 → 1621 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the PRINTINGS partition summand 1617 → 1619 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the PRINTINGS partition summand 1615 → 1617 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  🆕🆕🆕 **D539 +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: a LIVE ADDEND at the FRONT (D461's table: the tell is the left-hand side), 1611 → 1613.)  // (🆕🆕🆕 **D538 +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — + 1608 → + 1611. 🛑 PRINTINGS, SO THE STEP IS **3** AND NOT 1 — this is the exact site D537's automated pass got wrong by assuming the sentence step.)  // (🆕🆕🆕 **D537 +1 sentence — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A FROZEN TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — 1606 → 1608.)  // (🆕🆕🆕 **D536 +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229`), claimed by `deriveAttackEffect` through arm 44c over ONE new FIELD-FREE `EffectOp` member `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THIS IS A PRINTING-SIDE TERM, SO IT CARRIES `+ 3` WHERE THE SENTENCE-SIDE TERM ABOVE CARRIES `+ 1`** — the two steps DISAGREE, harder than D535's 1-vs-2. THIS SITE: 1603 → 1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
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
// in three directions (D531 §3's shape) — including the LOSS direction on the board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D532 §3 — a new optional key on a PERSISTED op, and the record version does not move", () => {
  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in three directions", () => {
    // DIRECTION 1 — every byte string a v30 deploy could have written is unchanged, and the two
    // pre-slice strings STILL DERIVE from their own printed sentences (the key was not a rename).
    const preSlice = [
      '{"op":"attachEnergyFrom","source":"discard","declinable":true}',
      '{"op":"attachEnergyFrom","source":"discard","anyEnergy":true,"toSelf":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes);
    }
    expect(deriveAttackEffect(OWN_SPREAD)?.[0]).toEqual(JSON.parse(preSlice[0] as string));
    expect(deriveAttackEffect("Attach an Energy card from your discard pile to this Pokémon.")?.[0]).toEqual(
      JSON.parse(preSlice[1] as string),
    );
    // DIRECTION 2 — the NEW value cannot appear in any record an older deploy wrote, and this deploy
    // round-trips it byte for byte.
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"attachEnergyFrom","source":"discard","anyEnergy":true,"declinable":true,"whose":"opponent"}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
    // DIRECTION 3 — a record that LOSES the key degrades LOUDLY (D421): the dropped key is a v30-legal
    // own-seat op, and on the board the two DIFFER (driven below).
    const dropped = JSON.parse(JSON.stringify(fresh, (k, v) => (k === "whose" ? undefined : v))) as EffectOp;
    expect(dropped).toEqual(V30_OP);
    expect(dropped).not.toEqual(fresh);
  });

  it("🛑 a v30 FLAGLESS parked op reads back OWN-seat candidates under the OWN caption and its answer drains the OWN pile; the fresh op parks the OPPONENT's refs and drains THEIRS — the LOSS direction ON THE BOARD (`D532-arm-drops-whose` / `-resolver-ignores-whose`)", () => {
    const board = table();
    const ctx = attackCtx(board);
    const v30 = runProgram(board, [V30_OP], ctx, []);
    const fresh = runProgram(board, [ONE_OP], ctx, []);
    if (v30.kind !== "parked" || v30.prompt.kind !== "choosePokemon") throw new Error("the v30 op did not park");
    if (fresh.kind !== "parked" || fresh.prompt.kind !== "choosePokemon") throw new Error("the fresh op did not park");
    expect(v30.prompt.candidates).toEqual(boardRefs(board, "p1"));
    expect(v30.prompt.candidates.every((ref) => ref.seat === "p1")).toBe(true);
    expect(v30.prompt.note).toBe(OWN_CAPTION);
    expect(v30.cont.pendingOp).toEqual(V30_OP);
    expect(fresh.prompt.candidates).toEqual(boardRefs(board, "p2"));
    expect(fresh.prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
    expect(fresh.prompt.note).toBe(CAPTION);
    // The two offers are DISJOINT — no ref is on both boards.
    for (const ref of v30.prompt.candidates) expect(fresh.prompt.candidates).not.toContainEqual(ref);
    // The v30 op's ANSWER (resumed through the real board) drains the OWN pile, not the opponent's.
    const ownParked = mustApply(board, { type: "attack", seat: "p1", index: 0 }).state;
    void ownParked;
    const v30Board = { ...board, phase: { kind: "effect:choose" as const, seat: "p1" as const, prompt: v30.prompt, cont: v30.cont } };
    const answered = pick(v30Board as GameState, "p1", { seat: "p1", spot: { spot: "active" } });
    expect(ids(answered.state, answered.state.players.p1.discard)).toEqual([W_ENERGY]);
    expect(ids(answered.state, answered.state.players.p2.discard)).toEqual(ids(board, board.players.p2.discard));
    expect(ids(answered.state, answered.state.players.p1.active?.energy ?? [])).toEqual([C_ENERGY, W_ENERGY]);
    expect(attachedRows(answered.events)).toEqual([
      { type: "ENERGY_ATTACHED", seat: "p1", uid: board.players.p1.discard[0], target: { spot: "active" } },
    ]);
  });

  it("🛑 the parked `pendingOp`'s key set, sorted, carries `whose` — and the continuation's `rest` is the other two ops", () => {
    const parked = swing().after;
    const cont = continuation(parked);
    expect(Object.keys(cont.pendingOp).sort()).toEqual(["anyEnergy", "declinable", "op", "source", "whose"]);
    expect(JSON.stringify(cont.pendingOp)).toBe(JSON.stringify(ONE_OP));
    expect(cont.rest).toEqual([ONE_OP, ONE_OP]);
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    expect(cont.ctx.seat).toBe("p1");
  });

  it("🛑 `MATCH_RECORD_VERSION` is 37 (🆕🆕🆕 D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) in `apps/api` — a widening, not a new shape", () => {
    const match = Object.entries(RAW).find(([k]) => k.endsWith("/lobby/match.ts"))?.[1] ?? "";
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(match).toContain("export const MATCH_RECORD_VERSION = 37;");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board, from BOTH seats (D490): the park over the opponent's refs, three sequential parks,
// the decline, the Special, the whiff, the lone Active, the own bodies, the refusals, the redacted
// views, the rng, the replay, the controls.
// ─────────────────────────────────────────────────────────────────────────────

describe("D532 §4 — the park offers EXACTLY the opponent's in-play Pokémon, and the answer moves the Energy out of THEIR pile onto THEIR body", () => {
  it("🛑 the board is what it says, from both seats: the attacker's demonstrator is Active with one {C} Basic, the defender's wall is Active with two Bench bodies, the defender's pile is [{R}, {R}, Special, Item], the attacker's pile is [{W}, {W}]", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const before = table({ attacker });
      expect(before.phase).toEqual({ kind: "turn:action", seat: attacker });
      expect(before.turn).toBe(attacker === "p1" ? 2 : 3);
      expect(before.cardIdByUid[activeUid(before, attacker)]).toBe(GRAFAIAI);
      expect(ids(before, before.players[attacker].active?.energy ?? [])).toEqual([C_ENERGY]);
      expect(before.cardIdByUid[activeUid(before, defender)]).toBe(WALL);
      expect(before.players[defender].bench.map((p) => before.cardIdByUid[p.stack[0] ?? ""])).toEqual([BENCHER, BENCHER]);
      expect(before.players[attacker].bench).toHaveLength(0);
      expect(ids(before, before.players[defender].discard)).toEqual([R_ENERGY, R_ENERGY, SPECIAL, ITEM]);
      expect(ids(before, before.players[attacker].discard)).toEqual([W_ENERGY, W_ENERGY]);
    }
  });

  it("🛑 (i) ONE park from EITHER seat: `choosePokemon { upTo 1 }` over EXACTLY the OPPONENT's refs in Active-then-bench order, every ref carrying the OPPONENT's seat, the caption pinned byte for byte, the base already dealt, nothing moved, the attacker's own bodies NOT offered (`D532-arm-drops-whose` / `-targets-ignore-whose` / `-caption-drops-opponents`)", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { before, after, events } = swing({ attacker });
      expect(after.phase.kind).toBe("effect:choose");
      expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe(attacker);
      const prompt = pokemonPrompt(after);
      expect(prompt.candidates).toEqual(boardRefs(before, defender));
      expect(prompt.candidates).toHaveLength(3);
      expect(prompt.candidates.every((ref) => ref.seat === defender)).toBe(true);
      expect(prompt.candidates).not.toContainEqual({ seat: attacker, spot: { spot: "active" } });
      expect(prompt.upTo).toBe(1);
      expect(prompt.note).toBe(CAPTION);
      expect(prompt.note).toContain("your opponent's");
      expect("decider" in after.phase).toBe(false);
      expect(dealtRows(events)).toHaveLength(1);
      expect(dealtRows(events)[0]).toMatchObject({ seat: defender, by: attacker, uid: activeUid(before, defender), dealt: BASE });
      expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "EFFECT_PENDING"]);
      expect(attachedRows(events)).toHaveLength(0);
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // Nothing moved at the park — both piles, both boards.
      expect(after.players[defender].discard).toEqual(before.players[defender].discard);
      expect(after.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(after.players[defender].active?.energy).toEqual([]);
      expect(continuation(after).pendingOp).toEqual(ONE_OP);
    }
  });

  it("🛑 (ii) THREE sequential parks, from EITHER seat: each answer moves the FIRST matching uid of the OPPONENT's pile (pile order: {R}, {R}, then the Special — `anyEnergy`) onto the chosen OPPONENT body; `ENERGY_ATTACHED { seat: attacker, uid, target: chosen spot }`; the Item stays; the attacker's own pile UNTOUCHED; the third answer ends the turn", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { before, after } = swing({ attacker });
      const pile = [...before.players[defender].discard];
      const refs = pokemonPrompt(after).candidates;
      const [first, second, third] = refs;
      if (first === undefined || second === undefined || third === undefined) throw new Error("fewer than three refs");
      // Park 1 → the Active.
      const a = pick(after, attacker, first);
      expect(types(a.events)).toEqual(["ENERGY_ATTACHED", "EFFECT_PENDING"]);
      expect(attachedRows(a.events)).toEqual([{ type: "ENERGY_ATTACHED", seat: attacker, uid: pile[0], target: { spot: "active" } }]);
      expect(ids(a.state, a.state.players[defender].active?.energy ?? [])).toEqual([R_ENERGY]);
      expect(ids(a.state, a.state.players[defender].discard)).toEqual([R_ENERGY, SPECIAL, ITEM]);
      expect(a.state.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(pokemonPrompt(a.state).candidates).toEqual(refs); // the offer is re-derived and identical
      // Park 2 → bench 0.
      const b = pick(a.state, attacker, second);
      expect(types(b.events)).toEqual(["ENERGY_ATTACHED", "EFFECT_PENDING"]);
      expect(attachedRows(b.events)).toEqual([{ type: "ENERGY_ATTACHED", seat: attacker, uid: pile[1], target: { spot: "bench", index: 0 } }]);
      expect(ids(b.state, b.state.players[defender].bench[0]?.energy ?? [])).toEqual([R_ENERGY]);
      // Park 3 → bench 1, the Special (the bare plural is the whole category), the turn ends.
      const c = pick(b.state, attacker, third);
      expect(types(c.events)).toEqual(["ENERGY_ATTACHED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
      expect(attachedRows(c.events)).toEqual([{ type: "ENERGY_ATTACHED", seat: attacker, uid: pile[2], target: { spot: "bench", index: 1 } }]);
      expect(ids(c.state, c.state.players[defender].bench[1]?.energy ?? [])).toEqual([SPECIAL]);
      expect(ids(c.state, c.state.players[defender].discard)).toEqual([ITEM]);
      expect(c.state.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(ids(c.state, c.state.players[attacker].active?.energy ?? [])).toEqual([C_ENERGY]);
      expect(c.state.phase).toEqual({ kind: "turn:action", seat: defender });
      expect(c.state.players[defender].active?.damage).toBe(BASE);
      expect(dealtRows(c.events)).toHaveLength(0);
    }
  });

  it("🛑 (iii) the LOG ROW names the OPPONENT's body through the cross-seat fallback — \"attached Fire Energy → D532 Wall\" under the ATTACKER's row (`D532-log-drops-the-other-seat`)", () => {
    for (const attacker of SEATS) {
      const { after } = swing({ attacker });
      const [first] = pokemonPrompt(after).candidates;
      if (first === undefined) throw new Error("no ref");
      const { state, events } = pick(after, attacker, first);
      const entries = logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" });
      const attached = entries.find((e) => e.kind !== "turn" && e.segments.some((s) => s.text === "attached "));
      if (attached === undefined || attached.kind === "turn") throw new Error(`no attach row in ${JSON.stringify(entries)}`);
      expect(attached.who).toBe(attacker);
      expect(attached.segments.map((s) => s.text).join("")).toBe("attached Fire Energy → D532 Wall");
      expect(attached.segments.map((s) => s.text).join("")).not.toContain("a Pokémon");
      expect(rows(events, state)).toContain("attached Fire Energy → D532 Wall");
    }
  });

  it("🛑 (iv) DECLINE at each park: no `ENERGY_ATTACHED`, nothing moves, the next op parks; three declines end the turn with BOTH piles and BOTH boards as they were", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { before, after } = swing({ attacker });
      const d1 = pick(after, attacker);
      expect(types(d1.events)).toEqual(["EFFECT_PENDING"]);
      expect(pokemonPrompt(d1.state).candidates).toEqual(boardRefs(before, defender));
      const d2 = pick(d1.state, attacker);
      expect(types(d2.events)).toEqual(["EFFECT_PENDING"]);
      const d3 = pick(d2.state, attacker);
      expect(types(d3.events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
      expect(d3.state.players[defender].discard).toEqual(before.players[defender].discard);
      expect(d3.state.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(d3.state.players[defender].active?.energy).toEqual([]);
      expect(d3.state.phase).toEqual({ kind: "turn:action", seat: defender });
    }
  });

  it("🛑 (v) a SPECIAL Energy ALONE in the opponent's pile IS offered (`anyEnergy` — the bare plural is the whole category): the op parks and the answer moves the Special; the same pile under the own-seat `Basic` sibling's op would not (`D532-arm-drops-anyEnergy`)", () => {
    const { before, after } = swing({ opponentPile: [SPECIAL] });
    expect(ids(before, before.players.p2.discard)).toEqual([SPECIAL]);
    const prompt = pokemonPrompt(after);
    expect(prompt.candidates).toEqual(boardRefs(before, "p2"));
    const [first] = prompt.candidates;
    if (first === undefined) throw new Error("no ref");
    const { state, events } = pick(after, "p1", first);
    expect(attachedRows(events)).toEqual([{ type: "ENERGY_ATTACHED", seat: "p1", uid: before.players.p2.discard[0], target: { spot: "active" } }]);
    expect(ids(state, state.players.p2.active?.energy ?? [])).toEqual([SPECIAL]);
    expect(state.players.p2.discard).toEqual([]);
    // The CONTROL: the Basic-only reading (`anyEnergy` absent) on the SAME board and pile whiffs.
    const basicOnly = runProgram(before, [{ op: "attachEnergyFrom", source: "discard", declinable: true, whose: "opponent" }], attackCtx(before), []);
    expect(basicOnly.kind).toBe("done");
  });

  it("🛑 (vi) an EMPTY opponent pile (an Item alone) is a WHIFF: no park, no `ENERGY_ATTACHED`, NO `ATTACK_EFFECT_SKIPPED` (the program derived), the base dealt, the turn ends — and the attacker's OWN stocked pile does NOT feed it", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { before, after, events } = swing({ attacker, opponentPile: [ITEM] });
      expect(ids(before, before.players[attacker].discard)).toEqual([W_ENERGY, W_ENERGY]); // the own pile IS stocked
      expect(after.phase).toEqual({ kind: "turn:action", seat: defender });
      expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(attachedRows(events)).toHaveLength(0);
      expect(after.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(after.players[defender].discard).toEqual(before.players[defender].discard);
      expect(after.players[defender].active?.damage).toBe(BASE);
      expect(after.players[attacker].active?.energy).toEqual(before.players[attacker].active?.energy);
    }
  });

  it("🛑 (vii) an opponent with ONLY an Active still PARKS (one candidate, `upTo` 1 — the forced arm stays off, D359): the decline is a live answer there", () => {
    const { before, after } = swing({ opponentBench: 0 });
    expect(before.players.p2.bench).toHaveLength(0);
    expect(after.phase.kind).toBe("effect:choose");
    const prompt = pokemonPrompt(after);
    expect(prompt.candidates).toEqual([{ seat: "p2", spot: { spot: "active" } }]);
    expect(prompt.upTo).toBe(1);
    expect(prompt.note).toBe(CAPTION);
    const declined = pick(after, "p1");
    expect(attachedRows(declined.events)).toHaveLength(0);
    expect(declined.state.players.p2.active?.energy).toEqual([]);
  });

  it("🛑 (viii) the attacker's OWN bodies are NEVER candidates: with two own Bench bodies the offer is still the opponent's three, and `attachEnergyTargets` / `attachSeat` say so directly (`D532-targets-ignore-whose` / `-resolver-ignores-whose`)", () => {
    const board = table({ ownBench: 2 });
    expect(board.players.p1.bench).toHaveLength(2);
    const { after } = { after: mustApply(board, { type: "attack", seat: "p1", index: 0 }).state };
    const prompt = pokemonPrompt(after);
    expect(prompt.candidates).toEqual(boardRefs(board, "p2"));
    for (const ref of boardRefs(board, "p1")) expect(prompt.candidates).not.toContainEqual(ref);
    // The funnel, asked directly: `seat` is the ACTOR, the refs are the OWNER's.
    expect(attachEnergyTargets(board, "p1", { whose: "opponent" })).toEqual(boardRefs(board, "p2"));
    expect(attachEnergyTargets(board, "p1", {})).toEqual(boardRefs(board, "p1"));
    expect(attachEnergyTargets(board, "p2", { whose: "opponent" })).toEqual(boardRefs(board, "p1"));
    expect(attachEnergyTargets(board, "p1", { whose: "opponent", benchOnly: true })).toEqual(boardRefs(board, "p2").slice(1));
    expect(attachSeat({ whose: "opponent" }, "p1")).toBe("p2");
    expect(attachSeat({ whose: "opponent" }, "p2")).toBe("p1");
    expect(attachSeat({}, "p1")).toBe("p1");
    expect(attachSeat({}, "p2")).toBe("p2");
  });

  it("🛑 (ix) the refusals at the park: the attacker's OWN Active ref and a Bench index the opponent does not field are `BAD_EFFECT_CHOICE`; a wrong-seat answerer is refused too (`D532-apply-guards-against-the-actor`)", () => {
    const { after } = swing();
    for (const ref of [
      { seat: "p1" as const, spot: { spot: "active" as const } },
      { seat: "p2" as const, spot: { spot: "bench" as const, index: 2 } },
    ]) {
      const refused = applyAction(after, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error("a non-candidate ref was accepted");
      expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
    }
    const wrongSeat = applyAction(after, { type: "resolveEffect", seat: "p2", choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } } });
    expect(wrongSeat.ok).toBe(false);
    // …and the legal answer against the OPPONENT's Active is accepted and MOVES the Energy — the
    // apply's guard compares the ref against the RESOLVED seat, not the actor's.
    const legal = pick(after, "p1", { seat: "p2", spot: { spot: "active" } });
    expect(attachedRows(legal.events)).toHaveLength(1);
    expect(ids(legal.state, legal.state.players.p2.active?.energy ?? [])).toEqual([R_ENERGY]);
  });

  it("🛑 (x) the redacted views: the OPPONENT's view of the park carries `prompt: null` (they do not answer); the ATTACKER's view carries the foreign-seat candidates and the caption", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { after } = swing({ attacker });
      expect(redactGame(after, defender).phase).toEqual({ kind: "effect:choose", prompt: null });
      const mine = redactGame(after, attacker);
      if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "choosePokemon") {
        throw new Error("the attacker's view does not carry the choosePokemon prompt");
      }
      expect(mine.phase.prompt.candidates).toEqual(pokemonPrompt(after).candidates);
      expect(mine.phase.prompt.candidates.every((ref) => ref.seat === defender)).toBe(true);
      expect(mine.phase.prompt.note).toBe(CAPTION);
      expect(mine.phase.prompt.upTo).toBe(1);
    }
  });

  it("🛑 (xi) `rngState` is UNTOUCHED through the park and all three answers — nothing here is a coin or a shuffle", () => {
    const { before, after } = swing();
    expect(after.rngState).toBe(before.rngState);
    let state = after;
    for (const ref of pokemonPrompt(after).candidates) state = pick(state, "p1", ref).state;
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.rngState).toBe(before.rngState);
  });

  it("🛑 (xii) replays identically from one seed — the same parked board and the same events twice; and the parked state JSON round-trips BYTE-EQUAL and resumes from its bytes", () => {
    const a = swing();
    const b = swing();
    expect(b.before).toEqual(a.before);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
    const persisted = JSON.parse(JSON.stringify(a.after)) as GameState;
    expect(persisted).toEqual(a.after);
    expect(JSON.stringify(persisted)).toBe(JSON.stringify(a.after));
    const [x] = pokemonPrompt(a.after).candidates;
    if (x === undefined) throw new Error("no candidates");
    const live = pick(a.after, "p1", x);
    const replayed = pick(persisted, "p1", x);
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);
  });

  it("🛑 (xiii) the controls on the SAME card: index 1 (the DARK own-seat twin) flags `ATTACK_EFFECT_SKIPPED` and moves nothing from EITHER pile; index 2 (no effect) has no program — both deal the base and end the turn", () => {
    const twin = swing({}, 1);
    expect(types(twin.events)).toEqual(["ATTACK_DECLARED", "ATTACK_EFFECT_SKIPPED", "DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(twin.after.players.p1.discard).toEqual(twin.before.players.p1.discard);
    expect(twin.after.players.p2.discard).toEqual(twin.before.players.p2.discard);
    expect(twin.after.players.p2.active?.damage).toBe(BASE);
    expect(readersClaiming(TWIN)).toEqual([]);
    const jab = swing({}, 2);
    expect(types(jab.events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(jab.after.players.p2.discard).toEqual(jab.before.players.p2.discard);
  });

  it("never mutates the state it was given (purity — through the park and the pick)", () => {
    const before = table();
    const snapshot = JSON.stringify(before);
    const { state: parked } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    const parkedSnapshot = JSON.stringify(parked);
    const [x] = pokemonPrompt(parked).candidates;
    if (x === undefined) throw new Error("no candidates");
    pick(parked, "p1", x);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(JSON.stringify(parked)).toBe(parkedSnapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — `programPlayable`'s whiff gate asks the printed pile's owner (cardplay.ts, D222: every read
// site) — unreachable from attack.ts, driven through the exported gate on the hand-authored program.
// ─────────────────────────────────────────────────────────────────────────────

describe("D532 §5 — the grey-out gate reads the OPPONENT's pile for a `whose: \"opponent\"` program, and the OWN pile for a flagless one", () => {
  it("🛑 `programPlayable` is TRUE when the opponent's pile holds an Energy and FALSE when it holds only an Item — while the own pile is stocked either way; the flagless twin answers off the OWN pile on the same boards (`D532-gate-reads-the-actors-pile`)", () => {
    const stocked = table();
    const empty = table({ opponentPile: [ITEM] });
    const ownEmpty = table({ ownPile: [ITEM] });
    for (const board of [stocked, empty, ownEmpty]) expect(ids(board, board.players.p1.discard).some((id) => id !== ITEM), "own pile").toBe(board !== ownEmpty);
    expect(programPlayable(stocked, PROGRAM, "p1", activeUid(stocked, "p1"))).toBe(true);
    expect(programPlayable(empty, PROGRAM, "p1", activeUid(empty, "p1"))).toBe(false);
    expect(programPlayable(ownEmpty, PROGRAM, "p1", activeUid(ownEmpty, "p1"))).toBe(true);
    // The flagless v30 op reads the OWN pile: the opposite answers on `empty` and `ownEmpty`.
    const own: readonly EffectOp[] = [V30_OP, V30_OP, V30_OP];
    expect(programPlayable(stocked, own, "p1", activeUid(stocked, "p1"))).toBe(true);
    expect(programPlayable(empty, own, "p1", activeUid(empty, "p1"))).toBe(true);
    expect(programPlayable(ownEmpty, own, "p1", activeUid(ownEmpty, "p1"))).toBe(false);
    // …and from the other seat.
    const p2 = table({ attacker: "p2", opponentPile: [ITEM] });
    expect(programPlayable(p2, PROGRAM, "p2", activeUid(p2, "p2"))).toBe(false);
    expect(programPlayable(p2, own, "p2", activeUid(p2, "p2"))).toBe(true);
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
).glob(["./{censusAttackCorpus,index,effects,interpreter,cardplay,log}.ts", "../../../apps/api/src/lobby/match.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("D532 §6 — the version steps and the bytes this suite drove are the bytes that shipped", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.455.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision; the anchor, the arm's five keys, the two `whose` declarations, the resolver, the funnel's owner, the apply's guard, the gate's seat, the log fallback and the caption shadow are byte for byte what this suite drove; the SIBLING clause copied above is `effects.ts`'s; D354's line and the three-line caption are UNTOUCHED", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.417.0 → **0.418.0** (D532");
    const effectsSrc = Object.entries(RAW).find(([k]) => k.endsWith("/effects.ts"))?.[1] ?? "";
    expect(effectsSrc).toContain(
      "const ATTACK_OPPONENT_DISCARD_ATTACH =\n  /^Attach up to 3 Energy cards from your opponent['’]s discard pile to their Pokémon in any way you like\\.$/;",
    );
    expect(effectsSrc).toContain(
      '      op: "attachEnergyFrom" as const,\n      source: "discard" as const,\n      anyEnergy: true as const,\n      declinable: true as const,\n      whose: "opponent" as const,\n    }));',
    );
    expect(effectsSrc.split('  whose?: "opponent";\n}').length - 1).toBe(1); // AttachTargetRiders
    // 🆕🆕🆕 D567 — 1 → 2: `lookAtTopN`'s NEW `whose?: "opponent"` (Accompanying Flute) is the second
    // op to END on this exact field spelling; the D532 op's own declaration is still the one pinned
    // by the factory literal above, so the count names both rather than narrowing either.
    expect(effectsSrc.split('      whose?: "opponent";\n    }').length - 1).toBe(2); // the op + lookAtTopN (D567)
    // The factory's three segments — the SIBLING copy above is the file's.
    expect(effectsSrc).toContain(
      "    `(?:(an) Energy card|a Basic (?:\\\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join(\"\")}])\\\\} )?Energy card` +\n" +
        "    `|up to (\\\\d+) Basic (?:\\\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join(\"\")}])\\\\} )?Energy cards)` +\n" +
        "    `${zonePhrase} to ([^.]+)\\\\.${tail}`",
    );
    expect(effectsSrc).toContain('const SOURCE_ZONE_PHRASE = " from your discard pile";');
    const interpreter = Object.entries(RAW).find(([k]) => k.endsWith("/interpreter.ts"))?.[1] ?? "";
    expect(interpreter).toContain('export function attachSeat(op: { readonly whose?: "opponent" }, seat: Seat): Seat {\n  return op.whose === "opponent" ? otherSeat(seat) : seat;\n}');
    expect(interpreter.split("attachSeat(").length - 1).toBe(4); // the declaration + three reads
    expect(interpreter).toContain("  const owner = attachSeat(riders, seat);\n  const side = state.players[owner];");
    expect(interpreter).toContain("    refs.push({ seat: owner, spot: { spot: \"active\" } });");
    expect(interpreter).toContain("    if (eligible(pokemon)) refs.push({ seat: owner, spot: { spot: \"bench\", index } });");
    expect(interpreter).toContain("  const seat = attachSeat(op, ctx.seat);\n  if (ref.seat !== seat) return state;");
    expect(interpreter).toContain("          attachSeat(op, ctx.seat), // 🆕 D532 — the printed pile's owner (`whose`), ONE resolver");
    expect(interpreter).toContain("  const side = state.players[seat]; // D532 — the OWNER's side (the actor's unless `whose`)");
    expect(interpreter).toContain("      ? withSide(state, seat, { ...base, active: updated })\n      : withSide(state, seat, {");
    expect(interpreter).toContain("  const zone = riders.whose === \"opponent\" ? `opponent's ${printedZone}` : printedZone;");
    // D354's line and the three-line caption at the park are UNTOUCHED (their mutant finds hold).
    expect(interpreter).toContain("  if (types.length === 0) return `${zone}${owner}Pokémon`;");
    expect(interpreter).toContain(
      "        `Attach ${op.count === undefined ? \"the Energy\" : `up to ${op.count} Energy`} to ${\n          op.toSelf === true ? \"this Pokémon\" : `which of your ${attachTargetNoun(op)}`\n        }?`,",
    );
    // The three `attachEnergyTargets(state, ctx.seat, op)` call sites are BYTE-INTACT (their finds hold).
    expect(interpreter).toContain("        op.toSelf === true ? sourceRef(state, ctx) : attachEnergyTargets(state, ctx.seat, op),");
    expect(interpreter).toContain("          done: attachEnergyTargets(state, ctx.seat, op).reduce(");
    // The events keep the ACTOR.
    expect(interpreter).toContain('      type: "ENERGY_ATTACHED",\n      seat: ctx.seat,\n      uid: energyUid,\n      target: { ...ref.spot },');
    const cardplay = Object.entries(RAW).find(([k]) => k.endsWith("/cardplay.ts"))?.[1] ?? "";
    expect(cardplay).toContain("        attachSeat(op, seat), // 🆕 D532 — the printed pile's owner; the gate asks the apply's question");
    expect(cardplay).toContain("      attachEnergyTargets(state, seat, op).length === 0,");
    const log = Object.entries(RAW).find(([k]) => k.endsWith("/log.ts"))?.[1] ?? "";
    expect(log).toContain("  const host = carrierOf(seat) ?? carrierOf(otherSeat(seat));");
    // NO new op, no new prompt kind, no new event: the widening is one optional key, twice declared.
    expect(effectsSrc).not.toContain('op: "attachOpponentEnergyFrom"');
    expect(interpreter).not.toContain('kind: "chooseOpponentPokemon"');
  });
});
