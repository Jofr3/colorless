import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { EffectOp } from "./effects";
import {
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  discardScaledBoostProgram,
} from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import type { EffectRecord } from "./interpreter";
import { runProgram } from "./interpreter";
import { logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  firstBasicInHand,
  itemTrainer,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.384.0 → 0.385.0 — 🆕🆕🆕 D490: THE MILL OF **BOTH** DECKS, SCALED BY THE ENERGY AMONG
// WHAT IT MILLED.
//
//   file line 130 (2 printings)  "Discard the top card of each player's deck. This
//                                 attack does 140 more damage for each Energy card
//                                 discarded in this way."
//
// 1 sentence / 2 legal printings over `legalAttackCorpus()`'s 640 / 1,732, and the LAST
// unbuilt member of the `discarded in this way` family (12 sentences / 27 printings, all
// twelve now claimed). The carrier ids are UNRESOLVED in this checkout — there is no
// local D1 — and are stated as such rather than invented (D425). The sentence is cited by
// its corpus FILE LINE, which is this repo's convention (D448) and the only citation that
// survives the array-index confusion.
//
// 🛑 **BUILD STATE WAS DERIVED OFF `attackReaderSurface()`'s THIRTEEN `deriveAttack*`
// EXPORTS, NEVER OFF `programFor`** (D480/D482): 13 / 13 `null` before the slice, all four
// splitters `null`, no registry row. §1 pins the after-state the same way — ONE reader
// answers and the other twelve still refuse, which is strictly stronger than
// `resolvedByAnyReader === true` (D438: a positive re-point over a disjunction discards
// every refusal the negative carried).
//
// 🛑 **THE PRICE THIS SLICE INHERITED WAS HALF WRONG, AND THE HALF THAT WAS RIGHT WAS
// SMALLER THAN IT SOUNDED.** D489 recorded the price as *"a both-decks recording mill
// **plus** the additive `damageDefender.base` path"*. The additive path has shipped since
// **D403** and has two live printings riding it; `damageDefender.base` is consumed at
// `interpreter.ts`'s `damageDefender` arm (`op.amount ?? (op.base ?? 0) + scoredSlot(…) *
// op.per`) and asserted by `benchDiscardBoost.test.ts`. And the *recording* half had also
// already shipped, at **D488** (`discardDeckTop.recordAs`). What was genuinely missing was
// exactly ONE thing: the two-deck WALK. `whose` gains a third value.
//
// 🛑 **THE AXIS-SUBSTITUTION LATTICE (§2) RUNS ALL 2⁵ POINTS × 13 READERS AND EXACTLY ONE
// OF THE 32 BUILDS** — the point where all five axes move. Each axis is substituted onto
// its nearest BUILT spelling rather than deleted, so no point is refused merely for not
// being a sentence (D489's refinement of D488's axis-deletion test). ⚠️ **AND THE AXES ARE
// COUNTED FROM THE PRINT: there are FIVE, where the work order named four.** The one it
// did not name is the JOINER — this sentence is period-joined where D488's mill compound
// prints `, and` — and it is a real axis: the additive family's other head IS
// period-joined, so the two are not redundant.
//
// 🛑 **ONE OP, NOT TWO SEQUENTIAL MILLS, AND THE §9.2 RECORD IS WHAT DECIDES IT** (§7,
// driven rather than argued). `recordMoved` ASSIGNS — `record[slot] = [...uids]` — because
// an op that ran and moved nothing must overwrite a stale value. So two sequential
// `discardDeckTop`s filing into `discarded` leave only the SECOND deck's card in the slot,
// and the damage counts one card where the sentence counts two. D458 measured that
// overwrite on a different pair; this is the first printing whose DAMAGE NUMBER turns on
// it. Two slots is no escape: `damageDefender.count` is ONE `EffectSlot`.
//
// 🛑 **THE READER IS WIDENED TO A TWO-MEMBER UNION RATHER THAN A FOURTEENTH READER, AND
// THE ARGUMENT IS MEASURED MARGINAL SITES (D424).** `censusAttackCorpus.ts` derives the
// reader surface from `effects.ts` BY NAME PREFIX (D444), so a new `deriveAttack*` export
// enrols itself — and at this head that would have moved **75 `expect(
// attackReaderSurface()).toHaveLength(13)` assertions across 74 files**, plus each of those
// files' hand-listed `READERS` array. Riding `deriveAttackDiscardScaledBoost` costs **ZERO
// bytes in `attack.ts`**: `scaledBase`, `effectSimulated` and `modifierSimulated` are each
// spelled `discardScaledBoost !== null`, and the assembler is already called with the
// printed `base` in scope. ⚠️ **And it cannot be a `deriveAttackEffect` arm at any price** —
// D403's argument verbatim: the printed *"more"* KEEPS the base, and `deriveAttackEffect`
// takes only a string, so an arm there would emit a `damageDefender` whose `base` nothing
// could populate.
//
// ⚠️ **THE DESCRIBER OBLIGATION IS EMPTY, TRACED RATHER THAN ARGUED FROM CATEGORY**
// (D478/D489). `withConsequence` has exactly ONE call site — `runProgram`'s `"park" in
// stepped` branch — and it returns the prompt unchanged unless `recordSlotOf(op)` is
// defined AND the queue holds a `recordGate` on that slot. `recordSlotOf` lists seven ops
// and `discardDeckTop` is not among them; this program holds no gate and, more decisively,
// **neither of its two ops can park at all** (§9 drives that). Parking is not the trigger;
// a gate is.
//
// 🛑 **`MATCH_RECORD_VERSION` STAYS 29 ON REACHABILITY, AND THE FIRST-POSITION FORM OF IT**
// (D450/D465). An `EffectOp` reaches a saved `MatchRecord` only through
// `EffectContinuation`'s `pendingOp` and its `rest`, both written only on a PARK. The sole
// producer of `whose: "eachPlayer"` returns a program of length TWO whose ops are
// `discardDeckTop` (never parks — no choice in "the top card") and `damageDefender` (never
// parks — `snipeActive` returns a `GameState`), so no continuation is ever written for it.
// §9 drives BOTH halves anyway (D452): the reachability half, and the LOSS direction — a
// v29 byte string spelling `whose: "self"` still mills one deck and still means what a v29
// writer meant.

/** The printed sentence, byte for byte. §1 asserts it is a row of the committed corpus
    rather than trusting these bytes (D452/D456: a byte pin on an invented string is green
    by construction, and `deckTopMill.test.ts` carried exactly such a phantom for this very
    sentence — at **100** more damage — from D131 until this slice corrected it). */
const MILL_BOTH =
  "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.";

/** The printed base of the demonstrator. Chosen so every candidate reading of §4 answers a
    DIFFERENT number: with `per = 140`, `base + N × 140` is 50 / 190 / 330 across N = 0/1/2
    and the base-dropping reading answers 0 / 140 / 280 — eight distinct values in all,
    computed in §4 rather than asserted here (D482: an assertion can be vacuous by
    arithmetic coincidence). */
const PRINTED_BASE = 50;
const PER = 140;

const SEED = 20260909;

// ── The board (D414/D452: a file-local `cardPool`, and therefore NO new `FIXTURE_POOL`
//    id — which is why `opponentResistanceBonus.test.ts`'s eleven-deep id ladder takes a
//    ZERO term this slice while every reader-keyed chain takes 1 or 2). ────────────────

/** `d490-*` keys with no catalog row behind them (D425). Every card is a DISTINCT id
    rather than N copies of one, because every figure here is a claim about WHICH cards
    moved and off WHOSE deck — a deck of identical cards collapses the readings of §4. */
const D490_CARDS: Record<string, Card> = {
  "d490-miller": battler("d490-miller", {
    name: "D490 Miller",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      // ⚠️ THE PRINTED DAMAGE IS AN ADDEND, WHICH IS THE ADDITIVE FAMILY'S SHAPE (D403):
      // "50+". `attack.ts` re-homes it into `damageDefender.base` (so the sum is ONE §8.5
      // pass — Resistance and the survival clamp are per-hit) and drops it from the
      // pre-program pipeline. §5 drives that by ARITHMETIC: a dropped base is a distinct
      // total on every board, not merely a missing event.
      { cost: ["Colorless"], name: "Twin Mill", damage: "50+", effect: MILL_BOTH },
      // The CONTROL attack: same body, same cost, no effect text at all. It is what makes
      // "the mill moved these cards" a claim about the SENTENCE rather than about the turn.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
    ],
  }),
  /** The defender. Big enough that no reading in §4 — correct or wrong — Knocks it Out,
      because a KO ends the batch before the zones can be read. */
  "d490-wall": battler("d490-wall", { name: "D490 Wall", types: ["Colorless"], hp: 700 }),
  "d490-energy-1": basicEnergy("d490-energy-1"),
  "d490-energy-2": basicEnergy("d490-energy-2"),
  "d490-energy-3": basicEnergy("d490-energy-3"),
  "d490-energy-4": basicEnergy("d490-energy-4"),
  "d490-item-1": itemTrainer("d490-item-1"),
  "d490-item-2": itemTrainer("d490-item-2"),
  "d490-item-3": itemTrainer("d490-item-3"),
  "d490-item-4": itemTrainer("d490-item-4"),
  "d490-body-1": battler("d490-body-1", { name: "D490 Body One", types: ["Water"], hp: 60 }),
  "d490-body-2": battler("d490-body-2", { name: "D490 Body Two", types: ["Water"], hp: 60 }),
  "d490-filler": battler("d490-filler", { name: "D490 Filler", types: ["Colorless"], hp: 60 }),
};

const D490_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D490_CARDS };

/** Its own deck (D270/D412), 60 counted before the first run:
    4 + 4 + 4×4 + 4×2 + 2×4 + 20 = 60. Pokémon-heavy so the setup never mulligans. */
const D490_DECK = deckOf({
  "d490-miller": 4,
  "d490-wall": 4,
  "d490-energy-1": 4,
  "d490-energy-2": 4,
  "d490-energy-3": 4,
  "d490-energy-4": 4,
  "d490-item-1": 2,
  "d490-item-2": 2,
  "d490-item-3": 2,
  "d490-item-4": 2,
  "d490-body-1": 4,
  "d490-body-2": 4,
  "d490-filler": 20,
});

// ── The boards. ⚠️ **THE TWO DECKS MUST DIFFER AT THE TOP, and at least one board must
//    have exactly ONE of the two be an Energy** — otherwise *count both*, *count mine* and
//    *count theirs* collapse into one number and the suite proves nothing (§4 computes the
//    collapse rather than asserting it away). ──────────────────────────────────────────

/** BOARD A — the ATTACKER's top card is an Energy and the OPPONENT's is a Pokémon. */
const A_SELF_DECK = ["d490-energy-1", "d490-item-1", "d490-filler"] as const;
const A_FOE_DECK = ["d490-body-1", "d490-item-2", "d490-filler"] as const;

/** BOARD B — the mirror: the OPPONENT's top card is the Energy. A build that counts only
    the attacker's own milled card answers 190 on A and 50 on B; one that counts only the
    opponent's answers 50 and 190. The correct build answers 190 on both. */
const B_SELF_DECK = ["d490-item-1", "d490-energy-1", "d490-filler"] as const;
const B_FOE_DECK = ["d490-energy-2", "d490-body-1", "d490-filler"] as const;

/** BOARD C — BOTH tops are Energy, so the correct build is the only one that reaches
    N = 2. It is what separates "count both" from every one-sided reading by QUANTITY. */
const C_SELF_DECK = ["d490-energy-1", "d490-item-1", "d490-filler"] as const;
const C_FOE_DECK = ["d490-energy-2", "d490-item-2", "d490-filler"] as const;

/** 🛑 **THE PRE-SEEDED PILES ARE THE POINT OF THIS PAIR, NOT DECORATION** (D488). *"Count
    what the mill recorded"* and *"count the discard pile afterwards"* are the SAME NUMBER
    for every deck and every noun when the pile starts empty, because the pile afterwards
    IS what the mill moved. On an empty pile this whole file would be green under a build
    that re-scans the board. The attacker's pile holds TWO Energy and the opponent's ONE. */
const SELF_PILE = ["d490-energy-2", "d490-energy-3", "d490-item-3"] as const;
const FOE_PILE = ["d490-energy-4", "d490-item-4"] as const;

function openTable(first: Seat): GameState {
  const created = createGame({
    seed: SEED,
    decks: { p1: D490_DECK, p2: D490_DECK },
    cardPool: D490_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }));
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
  return table;
}

/** Rebuild `seat`'s DECK **and DISCARD PILE** outright and park the rest in the HAND.
    ⚠️ Both zones are rebuilt, because the discard pile is a ZONE UNDER TEST here — it is
    what tells a record count from a pile count — so a residual card would move a figure
    silently. The hand is read by nothing in this file. */
function withZones(
  state: GameState,
  seat: Seat,
  deckIds: readonly string[],
  discardIds: readonly string[],
): GameState {
  const side = state.players[seat];
  const pool = [...side.deck, ...side.hand, ...side.discard];
  const take = (ids: readonly string[]): string[] =>
    ids.map((id) => {
      const at = pool.findIndex((uid) => state.cardIdByUid[uid] === id);
      if (at < 0) throw new Error(`${seat} has no spare ${id}`);
      const [uid] = pool.splice(at, 1);
      if (uid === undefined) throw new Error("splice returned nothing");
      return uid;
    });
  const deck = take(deckIds);
  const discard = take(discardIds);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, deck, discard, hand: pool } },
  };
}

/** p1 owns TURN 2 with the Miller Active and the Wall across the table, both libraries
    and both discard piles rebuilt in the exact orders named. */
function table(
  selfDeck: readonly string[],
  foeDeck: readonly string[],
  selfPile: readonly string[] = SELF_PILE,
  foePile: readonly string[] = FOE_PILE,
): GameState {
  let state = openTable("p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "d490-miller");
  state = setActiveFromDeck(state, "p2", "d490-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "d490-energy-1", 1);
  state = withZones(state, "p1", selfDeck, selfPile);
  return withZones(state, "p2", foeDeck, foePile);
}

const TWIN_MILL = 0;
const PLAIN_CUFF = 1;

const idOf = (uid: string, state: GameState): string => {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
};
const idsIn = (state: GameState, seat: Seat, zone: "hand" | "deck" | "discard"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state));

function swing(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}
function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Every reader on the module surface, called BY NAME — the D480/D482 oracle. Not
    `programFor`, which answers a REGISTRY question and would call an attack "built" for a
    card whose Ability happens to have a row (D204/D439). */
function readersClaiming(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
    if (read === undefined) throw new Error(`no reader ${name}`);
    return read(text) !== null;
  });
}

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

const dealtOn = (state: GameState): number => {
  const { events } = swing(state, TWIN_MILL);
  const row = find(events, "DAMAGE_DEALT");
  if (row === undefined) throw new Error("no DAMAGE_DEALT row");
  return row.dealt;
};

describe("D490 §1 — the printed row, off the column rather than off this file", () => {
  it("🛑 the sentence is a corpus row at exactly 2 printings, and its apostrophe is U+0027", () => {
    const hit = legalAttackCorpus().filter(([, s]) => s === MILL_BOTH);
    expect(hit).toHaveLength(1);
    expect(units(hit)).toBe(2);
    // MEASURED with `codePointAt`, never by eye (D421/D440). The whole 640-row column
    // carries ZERO U+2019, so the anchor's `['’]` arm is latent by design and
    // `clauseApostrophe.test.ts`'s re-ingest sweep is the only thing that drives it.
    expect(MILL_BOTH.codePointAt(MILL_BOTH.indexOf("player") + 6)).toBe(0x27);
    expect(legalAttackCorpus().filter(([, s]) => s.includes("’"))).toEqual([]);
    // …and it is the ONE row in the whole column that mills both decks. A second such
    // row would mean this anchor's literal spellings are a pool of one no longer.
    expect(legalAttackCorpus().filter(([, s]) => s.includes("each player's deck"))).toHaveLength(1);
  });

  it("🛑 ONE reader claims it and the other TWELVE still refuse — both polarities", () => {
    // D438: re-pointing a thirteen-way refusal onto a bare `resolvedByAnyReader === true`
    // discards every one of the thirteen refusals, because the positive claim is true
    // under a mistaken widening and under the real build alike. Name the owner AND keep
    // the refusals.
    expect(readersClaiming(MILL_BOTH)).toEqual(["deriveAttackDiscardScaledBoost"]);
    expect(resolvedByAnyReader(MILL_BOTH)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 no SPLITTER composes it, before the build or after", () => {
    // D464: building a sentence builds every `⟨it⟩. ⟨claimed tail⟩` compound with it,
    // through a path that is neither the anchor nor the arm — so the four splitters are
    // asked directly. The HEAD half of this sentence (*"Discard the top card of each
    // player's deck."*) is claimed by NOTHING (the bare `DECK_TOP_MILL` spells `your` /
    // `your opponent's` and nothing else), so no split is available in either direction.
    const e = effects as unknown as Record<string, (t: string) => unknown>;
    for (const name of [
      "splitAttackGateClause",
      "splitAttackTrailingClause",
      "splitAttackRequirementClause",
      "splitAttackCancelClause",
    ]) {
      expect(e[name]?.(MILL_BOTH), name).toBeNull();
    }
    expect(resolvedByAnyReader("Discard the top card of each player's deck.")).toBe(false);
    expect(deriveAttackEffect("Discard the top card of each player's deck.")).toBeNull();
  });

  it("🛑 the `discarded in this way` family is 12 / 27 and NONE of it is left unread", () => {
    // The family population is a fact about the COLUMN and does not move when a reader is
    // added — which is what tells "D490 built the last one" from "the ingest changed".
    // The four arms sum: D402's 6 / 13 + D403's 2 / 8 + D488's 2 / 2 + D489's 1 / 2 +
    // D490's 1 / 2 = 12 / 27.
    const family = legalAttackCorpus().filter(([, s]) => s.includes("discarded in this way"));
    expect(family).toHaveLength(12);
    expect(units(family)).toBe(27);
    expect(family.filter(([, s]) => !resolvedByAnyReader(s))).toEqual([]);
  });
});

// ── §2 — THE AXIS-SUBSTITUTION LATTICE ────────────────────────────────────────────────
//
// 🛑 **THE WHOLE SECTION IS ONE MEASUREMENT, AND IT IS THE ONE D483 SHOWS YOU CANNOT
// SKIP.** Two residue sentences that LOOK like one mechanism may be one slice or several,
// and the sentences cannot tell you which; D483's four-row cluster split 2 + 2 under
// exactly this test while D488's pair did not split at all.
//
// D489 sharpened it twice and both refinements are honoured here:
//
//   • **SUBSTITUTE, DO NOT DELETE.** Removing a clause outright confounds *"this axis is
//     the blocker"* with *"the remainder is not a sentence the corpus would ever print"*.
//     Every axis below is replaced by its nearest **already-built** spelling, so each of
//     the 32 points is a string some reader could in principle claim.
//   • **RUN THE LATTICE, NOT THE LIST.** One-axis substitutions answer *"is any single
//     axis the blocker"*; only the full 2ⁿ answers *"does any proper SUBSET of this
//     sentence already build"*, which is what justifies a whole-sentence anchor over a
//     composition.
//
// ⚠️ **AND THE AXES ARE COUNTED FROM THE PRINT.** The work order named FOUR — the
// both-decks mill, the ownerless filter, the additive `more`, and the count. Diffing the
// printed bytes against D488's built mill compound gives **FIVE**: the fifth is the
// JOINER (`. This attack` where D488 prints `, and this attack`), and it is not
// redundant with the `more` axis, because the OTHER built head of this very reader is
// period-joined. A brief that folds the two together cannot see that the point where only
// the joiner moves is still refused.

/** The five axes, each `[printed, nearest BUILT spelling]`. The all-five substitution is
    D488's corpus line 126 at this slice's count and amount, which is why the lattice's
    top corner is the only point that builds. */
const AXES: readonly (readonly [string, string, string])[] = [
  ["MILL-SIDE", "each player's", "your"],
  ["COUNT", "the top card of", "the top 3 cards of"],
  ["JOINER", "deck. This attack", "deck, and this attack"],
  ["FOLD", "140 more damage", "140 damage"],
  ["POSSESSOR", "Energy card discarded", "Energy card you discarded"],
];

function latticePoint(mask: number): string {
  let text = MILL_BOTH;
  AXES.forEach(([name, printed, built], i) => {
    if (((mask >> i) & 1) === 0) return;
    if (!text.includes(printed)) throw new Error(`axis ${name}: "${printed}" absent from ${text}`);
    text = text.replace(printed, () => built);
  });
  return text;
}
const popcount = (n: number): number => {
  let c = 0;
  let v = n;
  while (v > 0) {
    c += v & 1;
    v >>= 1;
  }
  return c;
};

describe("D490 §2 — the AXIS-SUBSTITUTION LATTICE: does any proper subset already build?", () => {
  it("🛑 all 2⁵ points × 13 readers, and EXACTLY ONE of the 32 builds", () => {
    const built: number[] = [];
    const byWeight = [0, 0, 0, 0, 0, 0];
    for (let mask = 0; mask < 1 << AXES.length; mask++) {
      const text = latticePoint(mask);
      if (readersClaiming(text).length > 0) {
        built.push(mask);
        byWeight[popcount(mask)] = (byWeight[popcount(mask)] ?? 0) + 1;
      }
    }
    // 🛑 **BY HAMMING WEIGHT, IN THE POST-BUILD FORM, AND THE MIDDLE FOUR ROWS ARE THE
    // CLAIM.** Weight 0 is the PRINT and is built — by this slice, and by nothing else, as
    // §1 pins. Weight 5 is D488's shipped compound. **Weights 1 through 4 are THIRTY
    // points and NOT ONE of them is claimed by any of the thirteen readers**, which is the
    // measurement: *"no proper subset of this sentence already builds"* is strictly
    // stronger than *"one point builds"*, and it is what justifies a whole-sentence anchor
    // over a composition. ⚠️ Measured against the tree at HEAD the same table read
    // `[0, 0, 0, 0, 0, 1]` — weight 0 was refused too, by all thirteen — so this rung is
    // also the record of what the slice changed and what it did not.
    expect(byWeight).toEqual([1, 0, 0, 0, 0, 1]);
    expect(built).toEqual([0, (1 << AXES.length) - 1]);
    expect(byWeight.slice(1, 5)).toEqual([0, 0, 0, 0]);
  });

  it("🛑 the ALL-FIVE point is D488's shipped compound, and it is the only one claimed", () => {
    const whole = latticePoint((1 << AXES.length) - 1);
    expect(whole).toBe(
      "Discard the top 3 cards of your deck, and this attack does 140 damage for each Energy card you discarded in this way.",
    );
    // …and it is claimed by `deriveAttackEffect`, NOT by this slice's reader — which is
    // what makes the lattice a statement about the ENGINE rather than about this anchor.
    expect(readersClaiming(whole)).toEqual(["deriveAttackEffect"]);
    expect(deriveAttackEffect(whole)).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3, recordAs: "discarded" },
      { op: "damageDefender", per: 140, count: "discarded", countFilter: { kind: "anyEnergy" } },
    ]);
  });

  it("⚠️ the PRINT itself is claimed only after the build, and each axis alone is not", () => {
    // The point of a lattice over a list: `mask = 0` is the printed sentence, which THIS
    // slice claims, and every weight-1 point is a string nothing claims. A rung that only
    // checked the print would be green under a reader far wider than this one.
    expect(readersClaiming(latticePoint(0))).toEqual(["deriveAttackDiscardScaledBoost"]);
    for (let i = 0; i < AXES.length; i++) {
      const only = AXES[i]?.[0] ?? "?";
      expect(readersClaiming(latticePoint(1 << i)), only).toEqual([]);
    }
  });

  it("⚠️ the JOINER is a real axis, which the four-axis reading cannot see", () => {
    // The additive family's OTHER printed head is period-joined, so *"a period joiner is
    // already built"* is true of the VOCABULARY and false of the SENTENCE — D489's fifth
    // axis, one family over. Both of these are period-joined and neither is claimed:
    for (const text of [
      // the printed head with the FOLD and the POSSESSOR moved but the joiner left alone
      "Discard the top card of each player's deck. This attack does 140 damage for each Energy card you discarded in this way.",
      // the shipped mill head, PERIOD-joined instead of comma-joined
      "Discard the top 3 cards of your deck. This attack does 140 damage for each Energy card you discarded in this way.",
      // …and the shipped BENCH head with this sentence's filtered noun
      "You may discard up to 2 Energy from your Benched Pokémon. This attack does 140 more damage for each Energy card discarded in this way.",
    ]) {
      expect(readersClaiming(text), text).toEqual([]);
    }
  });
});

describe("D490 §3 — the parse and the program", () => {
  it("the reading is the SECOND member of a two-member union, discriminated by `kind`", () => {
    expect(deriveAttackDiscardScaledBoost(MILL_BOTH)).toEqual({ kind: "eachDeckMill", per: PER });
    // The sibling, beside it, so the discriminator reads as a PARTITION rather than as a
    // field one arm happens to carry. Asymmetric payloads ⇒ two members (D440/D461): the
    // bench reading carries a declinable ceiling and a MOVEMENT filter; this one carries
    // neither, because its mill is mandatory and unfiltered.
    expect(
      deriveAttackDiscardScaledBoost(
        "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      ),
    ).toEqual({ kind: "benchDiscard", cap: 2, per: 60, filter: { kind: "anyEnergy" } });
  });

  it("🛑 the assembler builds the mill and the ONE additive hit, in printed order", () => {
    expect(discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE)).toEqual([
      { op: "discardDeckTop", whose: "eachPlayer", count: 1, recordAs: "discarded" },
      {
        op: "damageDefender",
        base: PRINTED_BASE,
        per: PER,
        count: "discarded",
        countFilter: { kind: "anyEnergy" },
      },
    ]);
    // ⚠️ THE PRINTED ORDER IS LOAD-BEARING, not cosmetic: the damage READS what the mill
    // filed (`recordAs: "discarded"` is the printed *"in this way"* — an op→op §9.2 record
    // and not a re-scan of the board), so a swapped order counts an empty slot and deals
    // the bare base forever.
    const [head] = discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE);
    expect(head?.op).toBe("discardDeckTop");
    // …and the BASE is spelled even at zero, which is the sibling arm's rule (D403): an
    // ABSENT `base` already means something specific — the multiply family's DROPPED base.
    expect(discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, 0)[1]).toMatchObject({
      base: 0,
    });
  });

  it("🛑 every non-amount token is a LITERAL, and each is refused one axis at a time", () => {
    // D121 on a pool of ONE sentence: the count, the seats, the joiner and the counted
    // noun each vary in ZERO printed rows, so capturing any of them would author sentences
    // the column does not print (D440/D361). Each near-miss below differs from the print on
    // EXACTLY ONE axis (D427), so it says which byte did the refusing.
    for (const text of [
      // NO TRAILING PERIOD, and a "!" for it — the `$`.
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way",
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way!",
      // A LOWERCASE first word — half of what keeps a whole-sentence reader off a
      // mid-sentence clause, and the reason there is no /i flag.
      "discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      // THE COUNT. The plural spelling is a THIRD-PARTY reading nothing prints, and
      // `deckTopMill.test.ts` already pins its bare form as refused.
      "Discard the top 2 cards of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      // THE SEATS, one word at a time.
      "Discard the top card of your deck. This attack does 140 more damage for each Energy card discarded in this way.",
      "Discard the top card of your opponent's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      "Discard the top card of each player's hand. This attack does 140 more damage for each Energy card discarded in this way.",
      // THE FOLD. Without "more" this is the MULTIPLY family, which DROPS the printed base
      // — a different reader and a different number on every board.
      "Discard the top card of each player's deck. This attack does 140 damage for each Energy card discarded in this way.",
      // THE COUNTED NOUN. `Energy card` is a literal here; a captured noun would claim
      // sentences this column does not print (D440's `Ancient card` refusal).
      "Discard the top card of each player's deck. This attack does 140 more damage for each card discarded in this way.",
      "Discard the top card of each player's deck. This attack does 140 more damage for each Item card discarded in this way.",
      // THE ANAPHOR. Without "in this way" the clause is a BOARD read of the pile, which is
      // a different number on every board whose pile was not empty.
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card in your discard pile.",
      // A PRINTED ZERO — a silent no-op where the loud path is the whole point (D145).
      "Discard the top card of each player's deck. This attack does 0 more damage for each Energy card discarded in this way.",
      // 🛑 **LEADING TEXT, AND THE PREFIX MUST END A SENTENCE — D452's TRAP, PAID.** The
      // obvious probe is *"Before doing damage, **d**iscard the top card…"*, and it is
      // green with the `^` DELETED: the lowercase `d` means the string is refused by the
      // family's case-sensitivity, so that rung pins the CASE while its comment claims the
      // anchor. **The first probe of `D490-anchor-loses-its-caret` SURVIVED against exactly
      // that rung.** The prefix below ends a sentence, so the capital `D` survives and the
      // `^` is the ONLY thing refusing it — measured, not reasoned: the caret-less pattern
      // matches this string and does not match the lowercase one.
      "Draw a card. Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      // …and the lowercase form is KEPT, because it is a real and separate claim (the
      // family carries no /i flag) — it is simply not evidence about the caret.
      "Before doing damage, discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      // TRAILING text — the `$`. ⚠️ D464's asymmetry: a `^`-end refusal can be demonstrated
      // on the loud path and a `$`-end one cannot once the head derives, so §1 asserts the
      // trailing SPLITTER is null as well rather than resting on this line alone.
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way. Then, shuffle your deck.",
    ]) {
      expect(deriveAttackDiscardScaledBoost(text), text).toBeNull();
    }
    // …and the SIBLING readers do not pick any of them up either — D382's strong form, on
    // the two that are nearest to a shipped family.
    for (const text of [
      "Discard the top card of each player's deck. This attack does 140 damage for each Energy card discarded in this way.",
      "Discard the top card of each player's deck. This attack does 140 more damage for each card discarded in this way.",
    ]) {
      expect(readersClaiming(text), text).toEqual([]);
    }
  });

  it("⚠️ the CURLY apostrophe IS read, and the ASCII one is what the column prints", () => {
    // The family's standing choice (`['’]`), pinned so it reads as deliberate rather than
    // accidental. The pool holds zero U+2019, so this arm is latent by design — and it is
    // exactly what `clauseApostrophe.test.ts`'s re-ingest sweep requires of every derivable
    // apostrophe-bearing sentence (D440: a bare `.get` on an apostrophe-bearing KEY loses
    // the row under a punctuation-normalising re-ingest, and no board can see it).
    const curly = MILL_BOTH.replace("player's", () => "player’s");
    expect(curly).not.toBe(MILL_BOTH);
    expect(deriveAttackDiscardScaledBoost(curly)).toEqual(
      deriveAttackDiscardScaledBoost(MILL_BOTH),
    );
    // An NBSP where an ASCII space is printed is NOT accepted — byte-different and
    // invisible in a diff, which is why the case names it instead of carrying it.
    expect(
      deriveAttackDiscardScaledBoost(MILL_BOTH.replace("top card", () => "top card")),
    ).toBeNull();
    // Outer whitespace survives by design (the reader trims).
    expect(deriveAttackDiscardScaledBoost(`  ${MILL_BOTH}\n`)).toEqual({
      kind: "eachDeckMill",
      per: PER,
    });
  });
});

// ── §4 — THE CANDIDATE READINGS, COMPUTED BEFORE ANY BOARD IS CHOSEN ──────────────────
//
// 🛑 D482/D485/D488: *when two implementations are available, name the board on which they
// differ BEFORE you write any board at all.* An assertion can be vacuous by arithmetic
// coincidence, and on the NATURAL board — one card off each deck, both the same kind —
// *"count both"*, *"count mine"* and *"count theirs"* collapse into one number. So the
// readings are enumerated as pure functions of the two milled lists, evaluated on the
// three boards, and the table is asserted to SEPARATE them. A candidate no board separates
// by quantity is separated by CONTENTS instead, and §5 asserts which pile each card
// landed in for exactly that reason.

/** A candidate reading: `(mineMilled, theirsMilled, minePileBefore, theirsPileBefore)` →
    the damage it would deal. Every one is a real build someone could ship. */
type Reading = (
  mine: readonly string[],
  theirs: readonly string[],
  minePile: readonly string[],
  theirsPile: readonly string[],
) => number;

const isEnergy = (id: string): boolean => D490_POOL[id]?.category === "Energy";
const energies = (ids: readonly string[]): number => ids.filter(isEnergy).length;

const READINGS: readonly (readonly [string, Reading])[] = [
  // THE BUILD. Mill one off EACH deck, count the Energy across BOTH, keep the printed base.
  ["both-filtered-base", (m, t) => PRINTED_BASE + PER * (energies(m) + energies(t))],
  // The `you` that the print does NOT carry — count only the attacker's own milled card.
  ["mine-only", (mine) => PRINTED_BASE + PER * energies(mine)],
  // Its mirror.
  ["theirs-only", (_mine, theirs) => PRINTED_BASE + PER * energies(theirs)],
  // The `countFilter` dropped: every milled card scores, not only the Energy.
  ["both-unfiltered", (m, t) => PRINTED_BASE + PER * (m.length + t.length)],
  // The MULTIPLY family's fold: the printed base DROPPED rather than kept (`more` unread).
  ["both-filtered-nobase", (m, t) => PER * (energies(m) + energies(t))],
  // A board re-scan instead of the §9.2 record: count the attacker's whole pile afterwards.
  ["my-pile-after", (m, _t, mp) => PRINTED_BASE + PER * (energies(mp) + energies(m))],
  // …and both piles afterwards.
  [
    "both-piles-after",
    (m, t, mp, tp) =>
      PRINTED_BASE + PER * (energies(mp) + energies(tp) + energies(m) + energies(t)),
  ],
];

/** The three boards as `[mineMilled, theirsMilled]` — one card off each deck's TOP. */
const BOARD_MILLS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ["A", [A_SELF_DECK[0]], [A_FOE_DECK[0]]],
  ["B", [B_SELF_DECK[0]], [B_FOE_DECK[0]]],
  ["C", [C_SELF_DECK[0]], [C_FOE_DECK[0]]],
];

describe("D490 §4 — the readings table: how many does each board separate?", () => {
  it("🛑 board A ALONE separates 5 of 7, and A+B separate all 7 — MEASURED", () => {
    const on = (board: number): number[] =>
      READINGS.map(([, read]) =>
        read(
          BOARD_MILLS[board]?.[1] ?? [],
          BOARD_MILLS[board]?.[2] ?? [],
          SELF_PILE,
          FOE_PILE,
        ),
      );
    // Board A: the attacker's top is an Energy, the opponent's is a Pokémon.
    expect(on(0)).toEqual([190, 190, 50, 330, 140, 470, 610]);
    // ⚠️ **`mine-only` COLLIDES WITH THE BUILD ON BOARD A**, which is precisely the
    // algebraic identity the work order warned about — and the reason board B exists.
    expect(new Set(on(0)).size).toBe(6);
    // Board B: the mirror. `mine-only` answers 50 where the build answers 190.
    expect(on(1)).toEqual([190, 50, 190, 330, 140, 330, 610]);
    // …and the PAIR separates every one of the seven, which no single board does.
    const pairs = READINGS.map((_, i) => `${on(0)[i]}/${on(1)[i]}`);
    expect(new Set(pairs).size).toBe(READINGS.length);
    expect(pairs).toEqual(["190/190", "190/50", "50/190", "330/330", "140/140", "470/330", "610/610"]);
  });

  it("🛑 board C is the only one where the BUILD reaches N = 2, and it is 330", () => {
    // Two Energy off two decks. Every one-sided reading is capped at ONE card by
    // construction, so this is the board that separates "count both" from "count either"
    // by quantity rather than by which side.
    const on = READINGS.map(([, read]) =>
      read(BOARD_MILLS[2]?.[1] ?? [], BOARD_MILLS[2]?.[2] ?? [], SELF_PILE, FOE_PILE),
    );
    expect(on).toEqual([330, 190, 190, 330, 280, 470, 750]);
    expect(on[0]).toBe(PRINTED_BASE + 2 * PER);
  });

  it("⚠️ two candidates NO board separates by quantity, and they are separated by CONTENTS", () => {
    // A MILL-SIDE filter (filter as the cards leave the deck, rather than as the record is
    // scored) and a SELF-ONLY / OPPONENT-ONLY walk all answer numbers this table already
    // holds. What tells them apart is WHICH CARDS LEFT WHICH DECK, so §5 asserts the two
    // decks and the two piles by id and not only the damage (D488's rule). This rung is
    // the statement that the quantity axis is EXHAUSTED, so a successor does not read §5's
    // contents assertions as belt-and-braces.
    const mineOnlyMill = READINGS[1]?.[1];
    const theirsOnlyMill = READINGS[2]?.[1];
    if (mineOnlyMill === undefined || theirsOnlyMill === undefined) throw new Error("no reading");
    // A self-only WALK deals what a both-decks walk with a `you` count deals; an
    // opponent-only walk deals what a "theirs" count deals. Identical on every board.
    expect(mineOnlyMill([A_SELF_DECK[0]], [], SELF_PILE, FOE_PILE)).toBe(
      mineOnlyMill([A_SELF_DECK[0]], [A_FOE_DECK[0]], SELF_PILE, FOE_PILE),
    );
    expect(theirsOnlyMill([], [A_FOE_DECK[0]], SELF_PILE, FOE_PILE)).toBe(
      theirsOnlyMill([A_SELF_DECK[0]], [A_FOE_DECK[0]], SELF_PILE, FOE_PILE),
    );
  });
});

describe("D490 §5 — the three boards, driven end to end", () => {
  it("🛑 BOARD A — one Energy off MY deck, a Pokémon off THEIRS: 190", () => {
    const state = table(A_SELF_DECK, A_FOE_DECK);
    const { state: done, events } = swing(state, TWIN_MILL);
    // `base` on the row is the OP's own amount (the whole `base + per × N` sum dealt as
    // ONE §8.5 pass), not the attack's printed 50 — which is the point of re-homing the
    // addend: Resistance and the §8.1 survival clamp are subtractions paid once PER HIT.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", by: "p1", base: 190, dealt: 190 });
    expect(done.players.p2.active?.damage).toBe(190);
    // ⚠️ **CONTENTS, NOT ONLY THE NUMBER.** One card off EACH deck, each into ITS OWN
    // owner's pile — which is what separates the build from a mill-side filter (the
    // opponent's Pokémon would not have moved) and from a single-deck walk.
    //
    // ⚠️ **AND THE DEFENDER'S DECK IS READ AFTER THEIR TURN-START DRAW.** An attack ends
    // the turn, so `done` is already p2's turn and p2 has drawn the card the mill left on
    // top. The attacker's deck is untouched by that (it is not their turn), and neither
    // DISCARD PILE is — which is why the piles carry the load-bearing half of this claim.
    expect(idsIn(done, "p1", "deck")).toEqual(["d490-item-1", "d490-filler"]);
    expect(idsIn(done, "p2", "deck")).toEqual(["d490-filler"]);
    expect(idsIn(done, "p2", "hand")).toContain("d490-item-2");
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE, "d490-energy-1"]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE, "d490-body-1"]);
    // TWO mill rows, one per seat, each filed under the deck's OWNER with the ATTACKER as
    // the actor — so the log's voice ternary sees one self path and one victim path.
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.seat, r.actor, r.uids.length])).toEqual([
      ["p1", "p1", 1],
      ["p2", "p1", 1],
    ]);
    // …and the ATTACKER's row comes FIRST. Controller-first is `handRefresh`'s precedent,
    // not `counterEachAll`'s absolute `SEATS` — see the op's doc block for the distinction.
    expect(rows[0]?.seat).toBe("p1");
  });

  it("🛑 the walk is CONTROLLER-FIRST, which only a board with the OTHER attacker can show", () => {
    // 🛑 **THE TWO SHIPPED `both seats` PRECEDENTS DISAGREE AND THIS RUNG IS THE
    // DISCRIMINATOR** (D433: a split set is a distinction you have not found yet).
    // `counterEachAll`'s `side: "both"` walks the ABSOLUTE `SEATS` (`["p1","p2"]`);
    // `handRefresh`'s `who: "both"` walks `[ctx.seat, otherSeat(ctx.seat)]`. On every board
    // in §5 the attacker IS p1, so the two are BYTE-IDENTICAL there and no rung above can
    // tell them apart — D445's point that a mirror board is not decoration but the only
    // available evidence. Run through `runProgram` with the OTHER seat as the controller:
    // absolute seats would still emit p1's row first, and the ROW ORDER is the log's order.
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const events: GameEvent[] = [];
    runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p2" },
      events,
      {},
    );
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows.map((r) => [r.seat, r.actor])).toEqual([
      ["p2", "p2"],
      ["p1", "p2"],
    ]);
    // …and the CONTROL is the same program from p1's chair on the same board, which is
    // what makes this a claim about the walk rather than about the fixture (D424).
    const mirror: GameEvent[] = [];
    runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      mirror,
      {},
    );
    expect(all(mirror, "DECK_TOP_DISCARDED").map((r) => [r.seat, r.actor])).toEqual([
      ["p1", "p1"],
      ["p2", "p1"],
    ]);
  });

  it("🛑 BOARD B — the mirror: a Pokémon off MY deck, one Energy off THEIRS: still 190", () => {
    const state = table(B_SELF_DECK, B_FOE_DECK);
    const { state: done, events } = swing(state, TWIN_MILL);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 190 });
    // 🛑 **THIS IS THE BOARD THAT ANSWERS THE RULES QUESTION WITH A DAMAGE NUMBER
    // ATTACHED.** The printed clause says *"for each Energy card discarded in this way"*
    // with **no "you"** — every built sibling that counts only your own says *"you
    // discarded"* — so the count spans BOTH decks. A build that read the missing "you" as
    // implicit deals 50 here and 190 on board A; this one deals 190 on both.
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE, "d490-item-1"]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE, "d490-energy-2"]);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(2);
    expect(idsIn(done, "p1", "deck")).toEqual(["d490-energy-1", "d490-filler"]);
  });

  it("🛑 BOARD C — an Energy off BOTH decks: 330, the only N = 2 in the family", () => {
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const { state: done, events } = swing(state, TWIN_MILL);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 330 });
    expect(done.players.p2.active?.damage).toBe(330);
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE, "d490-energy-1"]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE, "d490-energy-2"]);
  });

  it("🛑 the PRE-SEEDED piles are load-bearing: a pile re-scan answers 470, not 190", () => {
    // D488's rule, and the reason every board here seeds its piles: on an EMPTY pile
    // *"count what the mill recorded"* and *"count the pile afterwards"* are the same
    // number for every deck and every noun, because the pile afterwards IS what the mill
    // moved. The attacker's pile holds two Energy before the swing and three after.
    const state = table(A_SELF_DECK, A_FOE_DECK);
    expect(idsIn(state, "p1", "discard").filter(isEnergy)).toHaveLength(2);
    expect(dealtOn(state)).toBe(190);
    // …and with the piles EMPTIED the two readings agree — stated so the seeding cannot be
    // "simplified" away by a successor who sees no rung depending on it.
    const bare = table(A_SELF_DECK, A_FOE_DECK, [], []);
    const readByRecord = READINGS[0]?.[1];
    const readByPile = READINGS[5]?.[1];
    if (readByRecord === undefined || readByPile === undefined) throw new Error("no reading");
    expect(readByPile([A_SELF_DECK[0]], [A_FOE_DECK[0]], [], [])).toBe(
      readByRecord([A_SELF_DECK[0]], [A_FOE_DECK[0]], [], []),
    );
    expect(dealtOn(bare)).toBe(190);
  });

  it("⚠️ the CONTROL attack on the same body mills nothing and deals its printed 10", () => {
    // Without this, "the mill moved these cards" is a claim about the TURN rather than
    // about the SENTENCE — D214's attribution control, at a board.
    const state = table(A_SELF_DECK, A_FOE_DECK);
    const { state: done, events } = swing(state, PLAIN_CUFF);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
    expect(all(events, "DECK_TOP_DISCARDED")).toEqual([]);
    expect(idsIn(done, "p1", "deck")).toEqual([...A_SELF_DECK]);
    // The defender's deck is one shorter than the board's, and that ONE card is their own
    // turn-start draw rather than anything this attack did — the discard piles, which the
    // draw cannot touch, are byte-identical to the board.
    expect(idsIn(done, "p2", "deck")).toEqual([...A_FOE_DECK].slice(1));
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE]);
  });
});

describe("D490 §6 — an EMPTY deck on either side, and on both", () => {
  it("🛑 my deck empty: ONE row, the opponent's card still counts, 190", () => {
    // "Do as much as you can" (§8.6). The walk skips the seat that has nothing and files
    // only what actually moved — a build whose empty-deck path RETURNED instead of
    // continuing would mill neither deck and deal the bare 50.
    const state = table([], A_FOE_DECK.slice(0, 2));
    const { state: done, events } = swing(state, TWIN_MILL);
    const rows = all(events, "DECK_TOP_DISCARDED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seat: "p2", actor: "p1" });
    // The opponent's top here is a Pokémon, so the count is ZERO and the printed base is
    // what lands — the arithmetic IS the decline arm (D403), and no second op is owed.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE });
    expect(idsIn(done, "p1", "deck")).toEqual([]);
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE]);
  });

  it("🛑 my deck empty and THEIR top is an Energy: still 190 — the count is not my deck's", () => {
    const state = table([], ["d490-energy-2", "d490-filler"]);
    const { events } = swing(state, TWIN_MILL);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(1);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + PER });
  });

  it("🛑 BOTH decks empty: NO mill row at all, and the printed base alone", () => {
    // ⚠️ D455's row (`the mill announces an empty deck`) is the defect this pins: with the
    // zero guard deleted the board is byte-identical, every count assertion still passes,
    // and the only casualty is TWO log rows about nothing having happened.
    const state = table([], []);
    const { state: done, events } = swing(state, TWIN_MILL);
    expect(all(events, "DECK_TOP_DISCARDED")).toEqual([]);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE });
    // 🛑 **MILLING TO ZERO DOES NOT END THE GAME *ON THE SPOT*, AND THIS BOARD SHOWS BOTH
    // HALVES OF THAT RULE.** §14.3 deck-out is a turn-START rule checked at the DRAW
    // (`flow.ts startTurn`), never at the instant the deck runs dry — so the program itself
    // finishes with both decks empty and the game still live (driven through `runProgram`,
    // which does not flip the turn), and the loss then lands at the very next draw step,
    // which an attack hands straight to the DEFENDER. ⚠️ This is the first op in the engine
    // that can empty BOTH decks at once, so the rule is re-driven rather than inherited.
    const midEvents: GameEvent[] = [];
    const mid = runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      midEvents,
      {},
    );
    expect(mid.kind).toBe("done");
    if (mid.kind !== "done") throw new Error("expected done");
    expect(mid.state.phase.kind).not.toBe("gameOver");
    expect(idsIn(mid.state, "p1", "deck")).toEqual([]);
    expect(idsIn(mid.state, "p2", "deck")).toEqual([]);
    // …and end to end, the defender draws into an empty deck and loses — which is the
    // ATTACKER's win, not a draw, and the asymmetry is entirely in the rule rather than in
    // the op (the two directions run the same code).
    expect(done.phase.kind).toBe("gameOver");
    expect(idsIn(done, "p1", "deck")).toEqual([]);
    expect(idsIn(done, "p2", "deck")).toEqual([]);
  });

  it("⚠️ the SLOT is filed even when nothing moved — the record does not go stale", () => {
    // `discardPileRetrieval`'s rule, which `attachFromDeck` repeats: an op that RAN and
    // moved nothing must OVERWRITE its slot, or a stale value from an earlier writer
    // survives and the count answers for the wrong op. Driven through `runProgram` with a
    // pre-seeded record, because no printed program sequences two writers to `discarded`
    // today — so a board cannot reach it and only this drives it.
    const state = table([], []);
    const record: EffectRecord = { discarded: ["p1#0", "p1#1", "p1#2"] };
    const events: GameEvent[] = [];
    const run = runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      events,
      record,
    );
    expect(run.kind).toBe("done");
    expect(record.discarded).toEqual([]);
    // 50, not 50 + 3 × 140: the three stale uids are NOT counted.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE });
  });
});

describe("D490 §7 — why it is ONE op: two sequential mills OVERWRITE one slot", () => {
  it("🛑 the two-mill program files only the SECOND deck's card, and deals 190 → 50", () => {
    // 🛑 **THIS IS THE MEASUREMENT THAT DECIDED THE DESIGN**, and it is driven rather than
    // argued. `recordMoved` ASSIGNS (`record[slot] = [...uids]`), so a program spelling the
    // sentence as `[mill self, mill opponent, damage]` leaves ONLY the opponent's card in
    // `discarded`. On board C — an Energy off BOTH decks — the printed sentence is 330 and
    // the sequential spelling deals 190. D458 measured the overwrite on a different pair;
    // this is the first printing whose DAMAGE NUMBER turns on it.
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const sequential: readonly EffectOp[] = [
      { op: "discardDeckTop", whose: "self", count: 1, recordAs: "discarded" },
      { op: "discardDeckTop", whose: "opponent", count: 1, recordAs: "discarded" },
      {
        op: "damageDefender",
        base: PRINTED_BASE,
        per: PER,
        count: "discarded",
        countFilter: { kind: "anyEnergy" },
      },
    ];
    const record: EffectRecord = {};
    const events: GameEvent[] = [];
    runProgram(state, sequential, { seat: "p1" }, events, record);
    // BOTH decks were milled — the zones are right and only the RECORD is wrong, which is
    // exactly why no board-shaped assertion could have found this.
    expect(record.discarded).toHaveLength(1);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + PER });
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(2);
    // …against the shipped one-op spelling on the SAME board.
    const oneOp: EffectRecord = {};
    const oneOpEvents: GameEvent[] = [];
    runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      oneOpEvents,
      oneOp,
    );
    expect(oneOp.discarded).toHaveLength(2);
    expect(find(oneOpEvents, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + 2 * PER });
  });

  it("⚠️ two SLOTS is no escape either — `damageDefender.count` is ONE address", () => {
    // The other spelling a successor would reach for: file the two mills under `paid` and
    // `discarded` and have the damage add them. The op cannot express it — `count` is a
    // single `EffectSlot` — so the fold would need a second field and a second read, which
    // is a mechanism rather than a widening. Driven as the number it would actually deal.
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const twoSlots: readonly EffectOp[] = [
      { op: "discardDeckTop", whose: "self", count: 1, recordAs: "paid" },
      { op: "discardDeckTop", whose: "opponent", count: 1, recordAs: "discarded" },
      {
        op: "damageDefender",
        base: PRINTED_BASE,
        per: PER,
        count: "discarded",
        countFilter: { kind: "anyEnergy" },
      },
    ];
    const record: EffectRecord = {};
    const events: GameEvent[] = [];
    runProgram(state, twoSlots, { seat: "p1" }, events, record);
    expect(record.paid).toHaveLength(1);
    expect(record.discarded).toHaveLength(1);
    // 190, not 330 — half the sentence, silently.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + PER });
  });

  it("⚠️ the state is THREADED through the walk — the second write does not clobber the first", () => {
    // D429's stale WRITE-BACK, which is the strictly worse form of D428's stale read: a
    // second `withSide(state, …)` taken from a snapshot captured before the first mill puts
    // the attacker's milled card back on top of their deck ~one iteration later. One
    // physical card, two zones. The damage is IDENTICAL under both builds — the record is
    // filed from `milled`, not from the board — so only the ZONES can see it.
    // Read through `runProgram` rather than through a full swing, so the defender's
    // turn-start draw is not in the way of the zone claim — the write-back this rung is
    // about happens inside the op's own walk.
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const events: GameEvent[] = [];
    const run = runProgram(
      state,
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
      { seat: "p1" },
      events,
      {},
    );
    if (run.kind !== "done") throw new Error("expected done");
    const done = run.state;
    expect(idsIn(done, "p1", "deck")).toEqual(["d490-item-1", "d490-filler"]);
    expect(idsIn(done, "p1", "discard")).toEqual([...SELF_PILE, "d490-energy-1"]);
    expect(idsIn(done, "p2", "deck")).toEqual(["d490-item-2", "d490-filler"]);
    expect(idsIn(done, "p2", "discard")).toEqual([...FOE_PILE, "d490-energy-2"]);
    // …and the two decks each lost EXACTLY one card, which a clobbering write-back fails
    // on the attacker's side while leaving every damage figure untouched.
    expect(done.players.p1.deck).toHaveLength(C_SELF_DECK.length - 1);
    expect(done.players.p2.deck).toHaveLength(C_FOE_DECK.length - 1);
  });
});

describe("D490 §8 — the LOG: two rows, two voices, and no wording moved", () => {
  it("🛑 the attacker's own deck reads ACTIVE and the opponent's reads PASSIVE", () => {
    // ⚠️ **THE SLICE ADDS A THIRD `whose` VALUE AND CHANGES NOT ONE BYTE OF `log.ts`, AND
    // THAT IS A MEASUREMENT RATHER THAN LUCK.** The renderer's voice hangs off
    // `actor === seat` and NOT off the op's field (D153/D334) — so a walk that emits one
    // row per seat gets both wordings for free, and a per-op flag would have owed a third
    // case for rows whose voice was already decided.
    const state = table(A_SELF_DECK, A_FOE_DECK);
    const { state: done, events } = swing(state, TWIN_MILL);
    const rows = logFromEvents(
      all(events, "DECK_TOP_DISCARDED"),
      { names: { p1: "Ash", p2: "Misty" }, state: done, elapsed: "+00:07" },
    );
    expect(rows).toHaveLength(2);
    const text = (entry: (typeof rows)[number]): string =>
      entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join("");
    expect(rows.map((r) => [r.kind === "action" ? r.who : "turn", text(r)])).toEqual([
      ["p1", "discarded 1 card from the top of their deck"],
      ["p2", "had 1 card discarded from the top of their deck"],
    ]);
    // Stated once more as SHAPE, so a re-wording that keeps the split but loses the grammar
    // still fails: the self row leads with the verb, the victim row does not.
    expect(text(rows[0] as (typeof rows)[number])).toMatch(/^discarded /);
    expect(text(rows[1] as (typeof rows)[number])).toMatch(/^had /);
  });

  it("⚠️ the DAMAGE row credits the attacker and names the defender as the victim", () => {
    // D425: a consumer that DERIVES the dealer from the victim's seat is asserting an
    // invariant nobody declared. Pinned here because this op's two mill rows put the
    // ATTACKER's own seat on a row in the same batch, which is exactly the board that
    // makes an "other seat" derivation look right and be wrong.
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const { events } = swing(state, TWIN_MILL);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", by: "p1", dealt: 330 });
  });

  it("🛑 the loud channel does NOT fire — the sentence and the `+` marker are both simulated", () => {
    // `attack.ts` flags an unsimulated effect or an unexplained damage MARKER loudly.
    // This reading claims both (`effectSimulated` and `modifierSimulated` are each spelled
    // `discardScaledBoost !== null`), so a build that read the sentence and forgot to claim
    // the printed "50+" would fire this row while every board number stayed right.
    const state = table(A_SELF_DECK, A_FOE_DECK);
    const { events } = swing(state, TWIN_MILL);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toEqual([]);
    // …and the base is dealt ONCE, inside the program, not twice. A kept pre-program base
    // would show as a SECOND `DAMAGE_DEALT` row, which is the double hit
    // `damageDefender.base` exists to avoid (D403).
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(1);
  });
});

describe("D490 §9 — `MATCH_RECORD_VERSION` stays 29: reachability, driven", () => {
  it("🛑 the program is TWO ops and NEITHER can park, so no continuation is ever written", () => {
    // 🛑 **THE ARGUMENT IS REACHABILITY (D450) IN ITS FIRST-POSITION FORM (D465), NOT
    // "THIS BYTE ALREADY SHIPS" (D452) — which is FALSE here**, because `whose:
    // "eachPlayer"` is a genuinely new value no v29 deploy could write. An `EffectOp`
    // reaches a saved `MatchRecord` by exactly one route: `EffectContinuation`'s
    // `{pendingOp, rest}`, written only on a PARK. This program's mill is at index 0 (so
    // there is no earlier op to park in front of it) and its damage op returns a
    // `GameState`, so the continuation is never written at all.
    const program = discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE);
    expect(program).toHaveLength(2);
    expect(program.map((op) => op.op)).toEqual(["discardDeckTop", "damageDefender"]);
    // DRIVEN on a board where the op FIRES and on one where it WHIFFS — a whiff is not a
    // park and the two are easy to confuse in a `stepOp` arm (D465).
    for (const state of [table(C_SELF_DECK, C_FOE_DECK), table([], [])]) {
      const events: GameEvent[] = [];
      const run = runProgram(state, program, { seat: "p1" }, events, {});
      expect(run.kind).toBe("done");
      const { state: done } = swing(state, TWIN_MILL);
      expect(done.phase.kind).not.toBe("effect:choose");
      expect("cont" in done.phase).toBe(false);
    }
  });

  it("🛑 `\"eachPlayer\"` has exactly ONE producer in the whole engine, at index 0", () => {
    // The reachability claim is about the PRODUCERS, not about the op (D450), so it is
    // measured over every program the engine can build for the whole legal column: the new
    // value appears once, at the FRONT of a two-op program, and nowhere behind a park.
    const sites: string[] = [];
    const walk = (ops: readonly EffectOp[], where: string): void => {
      ops.forEach((op, i) => {
        if (op.op === "discardDeckTop" && op.whose === "eachPlayer") sites.push(`${where}[${i}]`);
        for (const key of ["then", "otherwise", "ops"] as const) {
          const sub = (op as unknown as Record<string, unknown>)[key];
          if (Array.isArray(sub)) walk(sub as EffectOp[], `${where}.${op.op}.${key}`);
        }
      });
    };
    for (const [, text] of legalAttackCorpus()) {
      const derived = deriveAttackEffect(text);
      if (derived !== null) walk(derived, "deriveAttackEffect");
      const reading = deriveAttackDiscardScaledBoost(text);
      if (reading !== null) walk(discardScaledBoostProgram(reading, PRINTED_BASE), "assembler");
    }
    expect(sites).toEqual(["assembler[0]"]);
  });

  it("🛑 a v29 byte string still means what a v29 writer meant — the LOSS direction", () => {
    // D441's question is never *"is the key optional"* but *"does the ABSENT key still say
    // what the old writer meant"*. Here the field is REQUIRED and pre-existing; what is new
    // is one INHABITANT. So the honest test is that a v29 value still resolves the old way —
    // reconstructed by hand and replayed through the real interpreter on the same board.
    const state = table(C_SELF_DECK, C_FOE_DECK);
    const v29: readonly EffectOp[] = [
      { op: "discardDeckTop", whose: "self", count: 1, recordAs: "discarded" },
      {
        op: "damageDefender",
        base: PRINTED_BASE,
        per: PER,
        count: "discarded",
        countFilter: { kind: "anyEnergy" },
      },
    ];
    const record: EffectRecord = {};
    const events: GameEvent[] = [];
    runProgram(state, v29, { seat: "p1" }, events, record);
    // ONE deck, ONE row, ONE card: exactly what a v29 deploy did, on a board this slice's
    // value answers 330 for.
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(1);
    expect(record.discarded).toHaveLength(1);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: PRINTED_BASE + PER });
    // …and the NEW value on the SAME board answers a DIFFERENT number, which is what makes
    // the pair a measurement rather than a restatement (D441: both directions or neither).
    expect(dealtOn(table(C_SELF_DECK, C_FOE_DECK))).toBe(PRINTED_BASE + 2 * PER);
  });

  it("⚠️ the DESCRIBER obligation is empty, and it is traced rather than argued", () => {
    // 🛑 D478/D489: *"this op files a §9.2 slot, so the describers apply"* is a CATEGORY
    // argument. `withConsequence` has ONE call site — `runProgram`'s `"park" in stepped`
    // branch — and it returns the prompt unchanged unless `recordSlotOf(op)` is defined AND
    // the queue holds a `recordGate` on that slot. `recordSlotOf` lists SEVEN ops and
    // `discardDeckTop` is not one of them. The executable half of that trace is that this
    // program never reaches the call site at all: no park, on any board.
    for (const state of [
      table(A_SELF_DECK, A_FOE_DECK),
      table(B_SELF_DECK, B_FOE_DECK),
      table(C_SELF_DECK, C_FOE_DECK),
      table([], []),
    ]) {
      const events: GameEvent[] = [];
      const run = runProgram(
        state,
        discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE),
        { seat: "p1" },
        events,
        {},
      );
      expect(run.kind).toBe("done");
    }
    // …and the program holds NO gate for a describer to phrase, which is the other half of
    // the condition — stated so a successor who adds a gate here knows the obligation
    // becomes live in the same edit.
    expect(
      discardScaledBoostProgram({ kind: "eachDeckMill", per: PER }, PRINTED_BASE).some(
        (op) => op.op === "recordGate",
      ),
    ).toBe(false);
  });

  it("engineVersion is 0.400.0 and `manifest.version` agrees — the bump is for BEHAVIOUR", () => {
    // 🆕🆕🆕 D490 — 0.384.0 → **0.385.0**. A card can reach it: one printed sentence that
    // derived to `null` on all thirteen readers and fell to the loud
    // `ATTACK_EFFECT_SKIPPED` path now mills BOTH decks and deals a number proportional to
    // the Energy among what it milled. ⚠️ **THIS SUITE AUTHORS THE PIN, WHICH IS THE HALF
    // EVERY VERSION-TAX COUNT MISSES** (D427: every note counts the pins it INHERITED and
    // never the one it is about to AUTHOR). Re-measured at this head AFTER the edit rather
    // than forecast (D489): **85 occurrences / 63 files / 18 `it(…)` titles**, with SEVEN
    // history occurrences of `0.384.0` left alone. ⚠️ **D489's own exception list said FOUR
    // and there were FIVE** — it named "this heading" for the paragraph INSIDE its
    // changelog entry and missed the entry's actual `0.383.0 → 0.384.0` heading, which is
    // D488's rule fired a second time: *a prose census of exceptions is self-referential
    // the moment it is written down, and the count is taken before the sentence exists.*
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe(engineVersion);
    expect(deriveAttackDiscardScaledBoost(MILL_BOTH)).not.toBeNull();
  });
});
