import type { Card } from "@luminous/schema";
import manifest from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { EffectOp } from "./effects";
import { deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import type { EffectRecord } from "./interpreter";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.385.0 → 0.386.0 — 🆕🆕🆕 D491: THE ONLY DRAW IN THE COLUMN WHOSE PRINTED SUBJECT IS
// NOT THE CONTROLLER.
//
//   file line 199 (1 printing)   "Each player draws 3 cards."
//
// 1 sentence / 1 legal printing over `legalAttackCorpus()`'s 640 / 1,732. The carrier id
// is UNRESOLVED in this checkout — there is no local D1 — and is stated as such rather
// than invented (D425). The sentence is cited by its corpus FILE LINE, this repo's
// convention (D448) and the only citation that survives the array-index confusion.
//
// 🛑 **BUILD STATE WAS DERIVED OFF `attackReaderSurface()`'s THIRTEEN `deriveAttack*`
// EXPORTS, NEVER OFF `programFor`** (D480/D482): 13 / 13 `null` before the slice, all four
// splitters `null`, no registry row. §1 pins the after-state the same way — ONE reader
// answers and the other twelve still refuse, which is strictly stronger than
// `resolvedByAnyReader === true` (D438).
//
// 🛑 **THE 2⁴ AXIS-SUBSTITUTION LATTICE SPLIT ITS SIXTEEN POINTS ON EXACTLY ONE AXIS, AND
// IT IS NOT THE ONE THE PRICE NAMED.** Substituting each axis onto its nearest BUILT
// spelling (D489) rather than deleting it, and running all 16 points × 13 readers:
//
//   | axes substituted | points | built |
//   |------------------|-------:|------:|
//   | 0 (the print)    |      1 |     0 |
//   | 1                |      4 |     1 |
//   | 2                |      6 |     3 |
//   | 3                |      4 |     3 |
//   | 4                |      1 |     1 |
//
// Every one of the EIGHT points that keeps the FINITE CLAUSE (a spelled subject with an
// inflected verb) is refused; every one of the EIGHT that substitutes the bare imperative
// builds. So **SCOPE, MOOD and COUNT are all INERT on the verdict**: *"Your opponent draws
// 3 cards."* is refused exactly as flatly as the print, and *"Draw 3 cards."* has built
// since M4, which makes the COUNT not an axis at all. The blocker was never the seat
// vocabulary — it is that **no reader anywhere takes a draw addressed to anyone but the
// controller**. §2 pins the whole lattice.
//
// 🛑 **THE RECORDED REFUSAL WAS RE-DERIVED FROM SOURCE BEFORE ANYTHING WAS PRICED AGAINST
// IT (D490), AND IT WAS A CLAIM ABOUT A FUNCTION WORN AS A CLAIM ABOUT THE ENGINE
// (D450/D456).** `opponentMayDraw`'s doc block says a seat rider is *"deliberately NOT a
// rider on `drawCards`: that op is fully automatic and seat-fixed to the controller, and
// every one of its call sites relies on both."* Both halves are still true of what that
// block refuses — a **MAY** answered by the other player needs a PARK and a `decider`, and
// a parking rider would break the *fully automatic* half at every call site. **This field
// breaks neither**: it is mandatory, it never parks, and it is OPTIONAL, so every producer
// written before it is byte-unchanged. The block is corrected in place rather than left
// standing (D442/D466), and the correction says which half survived.
//
// 🛑 **THE TRIPWIRE AUDIT CAME BACK EMPTY, WHICH IS THE SAME FINDING D490 REPORTED.** All
// **2,349** pre-existing corpus rows were needled from the MODULE (not by grep) on
// `"Each player draws"`, `"player draws"`, `"draws 3 cards"`, `"Each player"`,
// `"each player"` and `"eachPlayer"` across `id`/`decision`/`what`/`file`/`find`/`replace`
// /`survives`: **ZERO rows name this sentence** and the eight `each player` hits are all
// D490's mill. Nothing rested on the refusal — D478's loop, closed the same way for the
// second slice running.
//
// ⚠️ **WITNESS LOAD, COUNTED BEFORE PRICING (D487-ii/D488) AND PAID.**
// `grep -rln "Each player draws" --include=*.ts --include=*.tsx . | grep -v node_modules`
// returns **9 files**; two are the corpus and the fixture file and one
// (`clauseApostrophe.test.ts`) is PROSE inside a comment, so the witness count is **SIX
// FILES / 9 occurrences**, which is the figure the resume point carried and it survives
// re-derivation. Five of the six hold the sentence as an `ATTACK_EFFECT_SKIPPED`
// ATTRIBUTION CONTROL — it is printed on **four** `FIXTURE_POOL` cards (`fix-suction`
// idx 3, `fix-prizewheel` idx 3, `fix-toolstrip` idx 4, `fix-preseam` idx 5) purely so a
// *"nothing was skipped"* rung has a neighbour that DOES skip. **All of them are
// SENTENCE-QUOTING, so none amortises**, and building this row would have left every one
// of them green while it stopped testing anything — which D462 predicted, by name, for
// this exact string. Every one is re-pointed onto *"Heal 100 damage from 1 of your Benched
// Ancient Pokémon."* (corpus FILE LINE 272, 1 printing), whose blocker is **DATA** rather
// than a mechanism (D461): the `Ancient` banner is a per-PRINTING fact and `cardSchema`
// carries no column for it, so no reader at any width can ever claim it, and the day it
// goes green the thing that changed is the INGEST.

const find = (events: readonly GameEvent[], type: string): GameEvent | undefined =>
  events.find((e) => e.type === type);
const all = (events: readonly GameEvent[], type: string): GameEvent[] =>
  events.filter((e) => e.type === type);
const types = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

const PRINTED = "Each player draws 3 cards.";
const COUNT = 3;
const SEED = 20260910;

// ── The board (D414/D452: a file-local `cardPool`, and therefore NO new `FIXTURE_POOL`
//    id — which is why `opponentResistanceBonus.test.ts`'s eleven-deep id ladder takes a
//    ZERO term this slice while every reader-keyed chain takes 1). ────────────────────

/** `d491-*` keys with no catalog row behind them (D425). ⚠️ **EVERY DECK CARD IS A
    DISTINCT ID**, because the whole discrimination here is WHICH cards reached WHICH
    hand: on a symmetric table *"each player draws 3"*, *"you draw 3"* and *"your opponent
    draws 3"* are indistinguishable by hand SIZE, and a deck of interchangeable cards
    collapses them again by CONTENTS. §4 computes that collapse rather than asserting it
    away. */
const D491_CARDS: Record<string, Card> = {
  "d491-drawer": battler("d491-drawer", {
    name: "D491 Drawer",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Share Out", damage: 10, effect: PRINTED },
      // The CONTROL attack: same body, same cost, same damage, NO effect text at all. It
      // is what makes "these cards moved" a claim about the SENTENCE rather than about
      // the turn.
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
      // 🛑 THE ONE-AXIS SIBLING (D427/D399). Byte-identical in count, in cost and in
      // printed damage; it differs from index 0 in the SUBJECT and nothing else. Two
      // programs, two boards, one axis — which is what makes §4's numbers a measurement.
      { cost: ["Colorless"], name: "Solo Draw", damage: 10, effect: "Draw 3 cards." },
    ],
  }),
  /** The defender. Big enough that no reading in §4 Knocks it Out, because a KO ends the
      batch before the zones can be read. */
  "d491-wall": battler("d491-wall", { name: "D491 Wall", types: ["Colorless"], hp: 700 }),
  "d491-energy": basicEnergy("d491-energy"),
  "d491-a1": battler("d491-a1", { name: "D491 A One", types: ["Water"], hp: 60 }),
  "d491-a2": battler("d491-a2", { name: "D491 A Two", types: ["Water"], hp: 60 }),
  "d491-a3": battler("d491-a3", { name: "D491 A Three", types: ["Water"], hp: 60 }),
  "d491-a4": battler("d491-a4", { name: "D491 A Four", types: ["Water"], hp: 60 }),
  "d491-b1": battler("d491-b1", { name: "D491 B One", types: ["Fire"], hp: 60 }),
  "d491-b2": battler("d491-b2", { name: "D491 B Two", types: ["Fire"], hp: 60 }),
  "d491-b3": battler("d491-b3", { name: "D491 B Three", types: ["Fire"], hp: 60 }),
  "d491-b4": battler("d491-b4", { name: "D491 B Four", types: ["Fire"], hp: 60 }),
  "d491-filler": battler("d491-filler", { name: "D491 Filler", types: ["Colorless"], hp: 60 }),
};

const D491_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D491_CARDS };

/** Its own deck (D270/D412), 60 counted before the first run:
    4 + 4 + 4 + 8×4 + 16 = 60. Pokémon-heavy so the setup never mulligans. */
const D491_DECK = deckOf({
  "d491-drawer": 4,
  "d491-wall": 4,
  "d491-energy": 4,
  "d491-a1": 4,
  "d491-a2": 4,
  "d491-a3": 4,
  "d491-a4": 4,
  "d491-b1": 4,
  "d491-b2": 4,
  "d491-b3": 4,
  "d491-b4": 4,
  "d491-filler": 16,
});

/** ⚠️ **THE TWO DECKS ARE DISJOINT AT THE TOP AND THE HANDS ARE ASYMMETRIC.** The
    attacker's next three are `a1 a2 a3`; the defender's are `b1 b2 b3`. A build that
    draws for the controller alone, for the opponent alone, off the wrong seat's deck, or
    off the BOTTOM answers a different multiset of ids at a different hand, on this one
    board — §4 lists all seven readings and the number each answers. */
const SELF_TOP = ["d491-a1", "d491-a2", "d491-a3", "d491-a4"] as const;
const FOE_TOP = ["d491-b1", "d491-b2", "d491-b3", "d491-b4"] as const;

function openTable(first: Seat): GameState {
  const created = createGame({
    seed: SEED,
    decks: { p1: D491_DECK, p2: D491_DECK },
    cardPool: D491_POOL,
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

/** Rebuild `seat`'s DECK outright and park the rest in the HAND. The deck is the zone
    under test; the hand is only ever read as a DELTA, so its residue is inert. */
function withDeck(state: GameState, seat: Seat, deckIds: readonly string[]): GameState {
  const side = state.players[seat];
  const pool = [...side.deck, ...side.hand];
  const deck = deckIds.map((id) => {
    const at = pool.findIndex((uid) => state.cardIdByUid[uid] === id);
    if (at < 0) throw new Error(`${seat} has no spare ${id}`);
    const [uid] = pool.splice(at, 1);
    if (uid === undefined) throw new Error("splice returned nothing");
    return uid;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, deck, hand: pool } } };
}

/** `attacker` owns turn 2 with the Drawer Active and the Wall across the table, both
    libraries rebuilt in the exact orders named.

    🛑 **THE SEAT IS A PARAMETER BECAUSE THE ORDERING CLAIM IS INERT FROM P1's CHAIR**
    (D490). Controller-first and absolute `SEATS` agree on every board where p1 attacks,
    so §6 runs from p2's. */
function table(
  attacker: Seat,
  selfDeck: readonly string[],
  foeDeck: readonly string[],
): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d491-drawer");
  state = setActiveFromDeck(state, defender, "d491-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = attachFromDeck(state, attacker, "d491-energy", 1);
  state = withDeck(state, attacker, selfDeck);
  return withDeck(state, defender, foeDeck);
}

const SHARE_OUT = 0;
const PLAIN_CUFF = 1;
const SOLO_DRAW = 2;

const idOf = (uid: string, state: GameState): string => {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
};
const idsIn = (state: GameState, seat: Seat, zone: "hand" | "deck"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state));

function swing(
  state: GameState,
  seat: Seat,
  index: number,
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat, index });
}

/** 🛑 **AN ATTACK ENDS THE TURN, SO THE DEFENDER'S §5.1 TURN-START DRAW LANDS INSIDE THE
    SAME ACTION.** Every draw claim in this file therefore reads the rows whose `reason` is
    `"effect"` — the ones this op filed — and never a bare `CARDS_DRAWN` count, which would
    be off by one for the defender on every board and would have made the ORDER rungs in §6
    read `["p1","p2","p2"]`. This is the same shape as D430's *"a regex that matches a clock
    is not a regex that matches a source"*: the token appears on both sides and only one of
    them carries the meaning. */
function effectDraws(
  events: readonly GameEvent[],
  state: GameState,
): { seat: Seat; ids: string[] }[] {
  return events.flatMap((e) =>
    e.type === "CARDS_DRAWN" && e.reason === "effect"
      ? [{ seat: e.seat, ids: e.uids.map((uid) => idOf(uid, state)) }]
      : [],
  );
}


/** The ids that JOINED `seat`'s hand across the swing, in arrival order. A delta rather
    than a whole-hand pin, because the setup draw's contents are a function of the seed and
    are none of this file's business. */
function gained(before: GameState, after: GameState, seat: Seat): string[] {
  const had = new Map<string, number>();
  for (const uid of before.players[seat].hand) had.set(uid, (had.get(uid) ?? 0) + 1);
  const out: string[] = [];
  for (const uid of after.players[seat].hand) {
    const n = had.get(uid) ?? 0;
    if (n > 0) had.set(uid, n - 1);
    else out.push(idOf(uid, after));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the reader surface, and WHICH reader owns the sentence.

describe("D491 §1 — one reader claims it and the other twelve still refuse", () => {
  it("the surface is thirteen, taken off the MODULE and not off a list", () => {
    // D417/D418: a hand-kept `READERS` array cannot go red, only quiet. This figure is
    // derived from `effects.ts`'s exports by name prefix, in the module every census file
    // already imports.
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("🛑 `deriveAttackEffect` OWNS it and every other reader still says null", () => {
    // D438's polarity rule: naming the owner AND keeping the twelve refusals is strictly
    // stronger than `resolvedByAnyReader === true`, which is satisfied by a mistaken
    // widening of any reader as readily as by the real build.
    const owner = "deriveAttackEffect";
    for (const name of attackReaderSurface()) {
      const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
      if (read === undefined) throw new Error(`surface names a missing export: ${name}`);
      if (name === owner) expect(read(PRINTED), name).not.toBeNull();
      else expect(read(PRINTED), name).toBeNull();
    }
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("the specimen IS a row of the committed corpus, at its committed printing count", () => {
    // 🛑 D452/D490 — a byte pin measures an invention exactly as faithfully as the truth,
    // and D490 found a phantom specimen carrying a hand-retyped damage figure that had
    // been green in two files. Assert corpus MEMBERSHIP and read the count OFF the corpus.
    expect(legalAttackCorpus().filter(([, text]) => text === PRINTED)).toEqual([[1, PRINTED]]);
    // …and it is the SECOND of exactly two corpus sentences that spell `each player`; the
    // other is D490's mill, which is built. A third would be a third slice.
    // ⚠️ THE TEST IS CASE-INSENSITIVE ON PURPOSE (D448's `for each` lesson at one
    // character): this row CAPITALISES the phrase because it opens the sentence, and a
    // literal `includes("each player")` finds only D490's possessive — one of two, read
    // as the whole family.
    const eachPlayer = legalAttackCorpus().filter(([, text]) => /each player/i.test(text));
    expect(eachPlayer.map(([, text]) => text)).toEqual([
      "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
      PRINTED,
    ]);
  });

  it("neither splitter and no registry row is involved — the RAW summand alone", () => {
    for (const split of [
      effects.splitAttackRequirementClause,
      effects.splitAttackCancelClause,
      effects.splitAttackGateClause,
      effects.splitAttackTrailingClause,
    ]) {
      expect(split(PRINTED)).toBeNull();
    }
    // D464: building a sentence builds every `<it>. <claimed tail>` compound with it,
    // through a path that is neither the anchor nor the arm. Measured over the whole
    // column: no corpus row opens with this sentence, so that route contributes zero.
    expect(legalAttackCorpus().filter(([, t]) => t.startsWith(`${PRINTED} `))).toEqual([]);
  });

  it("derives to ONE op — the shipped `drawCards`, keyed", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      { op: "drawCards", count: COUNT, who: "eachPlayer" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the axis-substitution LATTICE, pinned rather than described.

describe("D491 §2 — the 2⁴ lattice, and the one axis that decides it", () => {
  /** The print is `[SUBJECT] [VERB] [COUNT] cards.` Each axis is substituted onto its
      nearest BUILT spelling rather than deleted (D489), so every point is a sentence some
      reader could in principle claim:
        SCOPE : "Each player" → "Your opponent"  (the corpus prints third-person subjects
                that readers DO claim — "Your opponent discards 2 cards from their hand.")
        FORM  : finite clause → the bare imperative "Draw N cards."   (built since M4)
        MOOD  : mandatory → "may"                                     ("You may draw 5 cards.")
        COUNT : 3 → 2                                                 (both built)
      ⚠️ **A FIFTH AXIS WAS LOOKED FOR AND IS NOT AVAILABLE BY THIS METHOD**: the SUBJECT
      NOUN (`player` where every built seat noun is `you`/`your opponent`) has no
      nearest-BUILT both-seats spelling to substitute onto — nothing printed or built says
      "You and your opponent each draw N cards." — so it cannot be varied independently of
      SCOPE, and saying that is the honest answer rather than inventing a point. */
  const point = (scope: boolean, form: boolean, mood: boolean, count: boolean): string => {
    const n = count ? 2 : 3;
    if (form) return mood ? `You may draw ${n} cards.` : `Draw ${n} cards.`;
    return `${scope ? "Your opponent" : "Each player"} ${mood ? "may draw" : "draws"} ${n} cards.`;
  };

  it("🛑 the 16 points, and the ONE axis that decides all of them", () => {
    // ⚠️ **THIS RUNG PINS THE POST-BUILD LATTICE, AND THE PRE-BUILD ONE IS DERIVED FROM
    // IT RATHER THAN QUOTED.** A pre-slice table is not re-runnable at this head, so
    // stating it as prose would be exactly the unfalsifiable claim D465 warns about. The
    // slice adds ONE anchor whose language is `ATTACK_EACH_PLAYER_DRAW`, so a point built
    // BEFORE the slice iff it builds now AND the new anchor does not claim it — asserted
    // below, which makes the historical table a computation instead of a memory.
    const CLAIMED = /^Each player draws (\d+) cards\.$/;
    const rows: { weight: number; text: string; now: boolean; before: boolean; form: boolean }[] =
      [];
    for (let m = 0; m < 16; m++) {
      const [scope, form, mood, count] = [1, 2, 4, 8].map((bit) => (m & bit) !== 0) as [
        boolean,
        boolean,
        boolean,
        boolean,
      ];
      const text = point(scope, form, mood, count);
      const now = resolvedByAnyReader(text);
      rows.push({
        weight: [scope, form, mood, count].filter(Boolean).length,
        text,
        now,
        before: now && !CLAIMED.test(text),
        form,
      });
    }
    expect(rows).toHaveLength(16);

    // 🛑 **BEFORE THE SLICE: FORM IS TOTAL AND THE OTHER THREE AXES ARE INERT.** All EIGHT
    // points that keep the FINITE CLAUSE were refused and all EIGHT bare imperatives
    // built — so the blocker was never SCOPE, never MOOD and never COUNT. It was that no
    // reader anywhere took a draw addressed to anyone but the controller.
    for (const row of rows) expect(row.before, `${row.text} (before)`).toBe(row.form);
    expect([0, 1, 2, 3, 4].map((w) => rows.filter((r) => r.weight === w).length)).toEqual([
      1, 4, 6, 4, 1,
    ]);
    expect(
      [0, 1, 2, 3, 4].map((w) => rows.filter((r) => r.weight === w && r.before).length),
    ).toEqual([0, 1, 3, 3, 1]);

    // 🛑 **AFTER THE SLICE the predicate is `FORM || (both seats AND mandatory)`** — the
    // two points the new anchor claims are exactly the two that moved, and every
    // OPPONENT-scoped and every MAY-mooded finite point is still refused.
    for (const row of rows) {
      expect(row.now, `${row.text} (after)`).toBe(row.form || CLAIMED.test(row.text));
    }
    expect(rows.filter((r) => r.now && !r.before).map((r) => r.text)).toEqual([
      "Each player draws 3 cards.",
      "Each player draws 2 cards.",
    ]);
  });

  it("⚠️ the COUNT axis is DEGENERATE, and that corrects the price", () => {
    // The recorded price named SCOPE, MOOD and COUNT. `Draw 3 cards.` has built since M4,
    // so substituting the count onto its nearest built spelling changes nothing on either
    // side of the split — it is not an axis of this sentence at all.
    expect(deriveAttackEffect("Draw 3 cards.")).toEqual([{ op: "drawCards", count: 3 }]);
    expect(deriveAttackEffect("Draw 2 cards.")).toEqual([{ op: "drawCards", count: 2 }]);
    expect(deriveAttackEffect("Each player draws 2 cards.")).toEqual([
      { op: "drawCards", count: 2, who: "eachPlayer" },
    ]);
  });

  it("🛑 an OPPONENT-side finite draw is STILL refused — the axis is the clause, not the seat", () => {
    // This is what makes the lattice's conclusion a claim about the engine rather than
    // about this one sentence: the engine has an opponent-draw OP (`opponentMayDraw`) and
    // no reader has ever read a sentence into it.
    expect(deriveAttackEffect("Your opponent draws 3 cards.")).toBeNull();
    expect(resolvedByAnyReader("Your opponent draws 3 cards.")).toBe(false);
    expect(deriveAttackEffect("Both players draw 3 cards.")).toBeNull();
  });

  it("the anchor claims exactly ONE corpus row, measured over all 640", () => {
    // D472: before generalising an anchor, measure what the generalisation would claim
    // over the whole corpus. Here the shipped shape and the count-captured shape claim the
    // same single row, and the capture is D121's *read a printed digit, never invent one*.
    const claimed = legalAttackCorpus().filter(([, t]) => /^Each player draws (\d+) cards\.$/.test(t));
    expect(claimed).toEqual([[1, PRINTED]]);
  });

  it("the near-misses are refused, each differing on exactly ONE axis (D427)", () => {
    for (const near of [
      "Each player draws 3 cards", // the `\.$`
      "each player draws 3 cards.", // the `^` and the case
      "Each player draws a card.", // D104 — no singular branch; nothing prints it
      "Each player draws 0 cards.", // the family's `count >= 1` guard
      "Each player may draw 3 cards.", // the MOOD; the engine's seat-crossing MAY parks
      "Each player draws 3 cards from the bottom of your deck.", // the `from` axis, unprinted
    ]) {
      expect(deriveAttackEffect(near), near).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the fixture and the anchor's disjointness from its two siblings.

describe("D491 §3 — three draw anchors, disjoint by STRUCTURE", () => {
  it("🛑 no string matches two of the three, so no ordering here can change an answer", () => {
    // D467's FIRST preference: structural disjointness carries no guard, because there is
    // nothing to delete. All three are `^…$` and disagree on a mandatory run of bytes at
    // position 0 — `Each player draws ` against `Draw `. The order-permutation row is a
    // DECLARED survivor for exactly this reason (D468's second kind).
    for (const [text, expected] of [
      [PRINTED, [{ op: "drawCards", count: 3, who: "eachPlayer" }]],
      ["Draw 3 cards.", [{ op: "drawCards", count: 3 }]],
      ["Draw 3 cards from the bottom of your deck.", [{ op: "drawCards", count: 3, from: "bottom" }]],
    ] as const) {
      expect(deriveAttackEffect(text), text).toEqual(expected);
    }
    // …and the CROSSINGS are nobody's sentence, so no anchor grew an optional group it
    // was not owed (D451: two tokens that co-vary need two anchors, not two optionals).
    expect(deriveAttackEffect("Each player draws 3 cards from the bottom of their deck.")).toBeNull();
    expect(deriveAttackEffect("Your opponent draws 3 cards from the bottom of their deck.")).toBeNull();
  });

  it("🛑 both ENDS of the anchor are pinned, and they fail DIFFERENTLY (D464)", () => {
    // ⚠️ **THE `^` END AND THE `\.$` END ARE NOT SYMMETRIC, AND ONLY ONE OF THEM STAYS ON
    // THE LOUD PATH.** A constructed near-miss with LEADING text is refused by
    // `deriveAttackEffect` AND by the whole reader surface. Its TRAILING twin is refused by
    // `deriveAttackEffect` too — but `splitAttackTrailingClause` COMPOSES it, because a
    // claimed head plus a claimed tail is what that splitter is for. So building this
    // sentence built every `<it>. <claimed tail>` compound with it, through a path that is
    // neither the anchor nor the arm.
    //
    // ⚠️ D452's one-axis rule: the leading prefix ENDS A SENTENCE, so `Each` keeps its
    // printed capital and the string varies ONLY the anchor's `^`. A lowercased probe
    // would be refused by the family's case-sensitivity and green with the caret deleted.
    expect(deriveAttackEffect("Draw a card. Each player draws 3 cards.")).toBeNull();
    expect(resolvedByAnyReader("Draw a card. Each player draws 3 cards.")).toBe(false);
    expect(deriveAttackEffect(`${PRINTED} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect("Each player draws 3 cards")).toBeNull();
    // …and the composition, asserted rather than left to be discovered.
    expect(effects.splitAttackTrailingClause(`${PRINTED} Draw a card.`)).toEqual({
      head: PRINTED,
      tail: "Draw a card.",
    });
    // ⚠️ **NOTHING IS AUTHORED WHILE NO SUCH COMPOUND PRINTS**, and that is measured over
    // the whole column rather than assumed: no corpus row opens with this sentence.
    expect(legalAttackCorpus().filter(([, t]) => t.startsWith(`${PRINTED} `))).toEqual([]);
  });

  it("the MODAL is refused by the anchor, not by a guard", () => {
    // The engine's one seat-crossing draw (`opponentMayDraw`) is a MAY that PARKS and files
    // a `decider`, so an anchor loose enough to admit `may draw` would file an AUTOMATIC op
    // for a sentence that owes a question. Nothing prints the modal here; the refusal is
    // the anchor's literal `draws`, and it is pinned in both spellings.
    expect(deriveAttackEffect("Each player may draw 3 cards.")).toBeNull();
    expect(deriveAttackEffect("Each player may draws 3 cards.")).toBeNull();
    expect(legalAttackCorpus().filter(([, t]) => /each player may/i.test(t))).toEqual([]);
  });

  it("the demonstrator prints the sentence VERBATIM and AUTHORS nothing", () => {
    const attacks = D491_POOL["d491-drawer"]?.attacks ?? [];
    expect(attacks.map((a) => a.effect)).toEqual([PRINTED, undefined, "Draw 3 cards."]);
    // Every scalar around the sentence is CHOSEN and says so; only the TEXT is read off
    // the corpus. All three carry the SAME cost and the SAME printed damage, which is what
    // makes the three-way comparison a one-axis one.
    expect(attacks.map((a) => a.damage)).toEqual([10, 10, 10]);
    expect(attacks.map((a) => a.cost)).toEqual([["Colorless"], ["Colorless"], ["Colorless"]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board. SEVEN readings, and which cards reached which hand.

describe("D491 §4 — both hands grow, and the ids say whose deck they came off", () => {
  const board = (): GameState => table("p1", SELF_TOP, FOE_TOP);

  it("🛑 the correct build moves THREE cards into EACH hand, off EACH OWN deck", () => {
    const before = board();
    const { state, events } = swing(before, "p1", SHARE_OUT);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p1", ids: ["d491-a1", "d491-a2", "d491-a3"] },
      { seat: "p2", ids: ["d491-b1", "d491-b2", "d491-b3"] },
    ]);
    // …and they are really IN the hands, not merely announced (D490: a claim read off a
    // reader's return value is blind to what the assembler did — read the ZONE too).
    for (const [seat, ids] of [
      ["p1", ["d491-a1", "d491-a2", "d491-a3"]],
      ["p2", ["d491-b1", "d491-b2", "d491-b3"]],
    ] as const) {
      const hand = idsIn(state, seat, "hand");
      for (const id of ids) expect(hand, `${seat} ${id}`).toContain(id);
    }
    // …and each deck lost exactly those, off the TOP. p2 is one further along because the
    // attack ended the turn and their §5.1 draw took `d491-b4`.
    expect(idsIn(state, "p1", "deck")).toEqual(["d491-a4"]);
    expect(idsIn(state, "p2", "deck")).toEqual([]);
  });

  /** 🛑 **SEVEN CANDIDATE READINGS, AND WHAT EACH ANSWERS ON THIS BOARD — COMPUTED BEFORE
      THE BOARD WAS CHOSEN** (D482/D485/D488). Both decks are asymmetric, so the readings
      are separated by CONTENTS as well as by count; on a symmetric table the first three
      collapse to one number and this file would prove nothing.

      | # | reading                         | p1 is dealt      | p2 is dealt      |
      |---|---------------------------------|------------------|------------------|
      | 1 | CORRECT (each own deck)         | a1 a2 a3         | b1 b2 b3         |
      | 2 | key dropped → controller only   | a1 a2 a3         | —                |
      | 3 | opponent only                   | —                | b1 b2 b3         |
      | 4 | both, but off the CONTROLLER's  | a1 a2 a3         | a4 …             |
      | 5 | count hard-coded to 1           | a1               | b1               |
      | 6 | `from: "bottom"` crossed on     | the deck's LAST 3| the deck's LAST 3|
      | 7 | absolute seat ORDER             | a1 a2 a3         | b1 b2 b3         |
      ⚠️ **READING 7 IS THE ONE NO CONTENT CAN SEPARATE** — it deals the same cards to the
      same hands — so it is separated by the LOG ORDER instead, from p2's chair, in §6.
      That is D486's rule: when two candidates agree on the measured quantity everywhere,
      the separating axis is not a quantity at all. */
  it("readings 2, 3 and 4 are separated by CONTENTS, not by a total", () => {
    const { state, events } = swing(board(), "p1", SHARE_OUT);
    const rows = effectDraws(events, state);
    // The totals are equal by construction (3 and 3), which is exactly why a hand-SIZE
    // assertion would pass on a build that dealt six cards to one seat.
    expect(rows.map((r) => r.ids.length)).toEqual([COUNT, COUNT]);
    // Reading 4 dies here: no `d491-a*` may reach p2 and no `d491-b*` may reach p1, on a
    // table whose two decks share no id at the top.
    for (const row of rows) {
      const prefix = row.seat === "p1" ? "d491-a" : "d491-b";
      expect(row.ids.every((id) => id.startsWith(prefix)), row.seat).toBe(true);
    }
    // …and reading 6 dies on the ORDER within each row: the TOP three, in deck order.
    expect(rows.map((r) => r.ids[0])).toEqual(["d491-a1", "d491-b1"]);
  });

  it("🛑 the ONE-AXIS SIBLING on the SAME board leaves the opponent's deck alone", () => {
    // `Draw 3 cards.` — same count, same cost, same printed damage, one word of subject
    // different. This is the rung that makes the key load-bearing rather than decorative:
    // a build that ignored `who` would answer THIS for the printed sentence too.
    const { state, events } = swing(board(), "p1", SOLO_DRAW);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p1", ids: ["d491-a1", "d491-a2", "d491-a3"] },
    ]);
    // p2's deck lost exactly ONE card, and it is the §5.1 turn draw rather than this op's.
    expect(idsIn(state, "p2", "deck")).toEqual(["d491-b2", "d491-b3", "d491-b4"]);
  });

  it("the CONTROL attack moves no card at all", () => {
    const { state, events } = swing(board(), "p1", PLAIN_CUFF);
    expect(effectDraws(events, state)).toEqual([]);
    expect(idsIn(state, "p1", "deck")).toEqual(SELF_TOP.slice());
    // …and it is not on the loud path either — an attack with no effect text has nothing
    // to skip, which is a different state from an unread one.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the sentence is SIMULATED, so the loud channel stays silent", () => {
    const { events } = swing(board(), "p1", SHARE_OUT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // …and the §8.5 hit still lands, because the draw is the attack's EFFECT and not its
    // damage: the printed 10 is untouched by anything this slice does.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", by: "p1", dealt: 10 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §8.6 "do as much as you can", per seat, and §14.3 deck-out.

describe("D491 §5 — the shallow decks, and who loses when a deck runs out", () => {
  it("⚠️ §8.6 — a 1-card deck deals ONE, and the other seat still takes three", () => {
    // `ptcg-rules.md` §8.6: *"An effect that names a quantity it cannot fully reach still
    // resolves as far as it can … This applies to any effect whose quantity outruns the
    // board."* `drawToHand` implements it with one clamped slice, and this op runs that
    // slice PER SEAT — so the two players need not have the same amount of deck left for
    // the sentence to resolve at all.
    const { state, events } = swing(table("p1", ["d491-a1"], FOE_TOP), "p1", SHARE_OUT);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p1", ids: ["d491-a1"] },
      { seat: "p2", ids: ["d491-b1", "d491-b2", "d491-b3"] },
    ]);
  });

  it("⚠️ an EMPTY deck emits NO row at all, rather than a `drew 0 cards` one", () => {
    const { state, events } = swing(table("p1", [], FOE_TOP), "p1", SHARE_OUT);
    // ONE row, and it is the opponent's. A seat that draws nothing is invisible in the
    // log, which is `drawToHand`'s shipped behaviour and not something this slice chose.
    expect(effectDraws(events, state)).toEqual([
      { seat: "p2", ids: ["d491-b1", "d491-b2", "d491-b3"] },
    ]);
  });

  it("🛑 §14.3 — the draw that EMPTIES a deck loses nothing; the next DRAW STEP does", () => {
    // `flow.ts` `startTurn`: *"a player who must draw from an empty deck loses the game
    // right here (§14.3 deck-out) — checked at draw time"*, and the guard reads
    // `next.players[seat].deck.length === 0` for the seat whose turn is STARTING only.
    // `ptcg-rules.md` §5.1 (*"This check happens at draw time"*) and §14.3 (*"your opponent
    // cannot draw a card at the START of their turn … Checked at the draw step"*) agree.
    //
    // 🛑 **AND AN ATTACK ENDS THE TURN, SO THAT NEXT DRAW STEP IS INSIDE THIS ACTION.** The
    // ORDER of the events is what carries the claim: both draws and the §8.5 hit land
    // FIRST, the turn changes, and only then does the game end.
    const { state, events } = swing(table("p1", ["d491-a1"], ["d491-b1"]), "p1", SHARE_OUT);
    expect(effectDraws(events, state)).toEqual([
      { seat: "p1", ids: ["d491-a1"] },
      { seat: "p2", ids: ["d491-b1"] },
    ]);
    const order = types(events);
    expect(order.indexOf("GAME_OVER")).toBeGreaterThan(order.lastIndexOf("CARDS_DRAWN"));
    expect(order.indexOf("GAME_OVER")).toBeGreaterThan(order.indexOf("DAMAGE_DEALT"));
    expect(order.indexOf("GAME_OVER")).toBeGreaterThan(order.indexOf("TURN_ENDED"));
  });

  it("🛑 …and with BOTH decks empty the DEFENDER loses, because their turn is next", () => {
    // The interesting half, and it is a RULES answer rather than an engine one: the guard
    // never consults the OTHER seat's deck, so the attacker's equally-empty library is not
    // a loss and not a tie. `ptcg-rules.md`'s sudden-death clause is for wins that land at
    // the same INSTANT, and these two do not — one is checked now and one at a draw step
    // that never arrives.
    const { state, events } = swing(table("p1", ["d491-a1"], ["d491-b1"]), "p1", SHARE_OUT);
    expect(state.phase.kind).toBe("gameOver");
    expect(find(events, "GAME_OVER")).toMatchObject({
      outcome: { result: "win", winner: "p1", reason: "deckOut" },
    });
    // …and the ATTACKER, whose deck is equally empty, is the WINNER. That is the whole
    // asymmetry, and it belongs to the rules rather than to this op.
    expect(state.players.p1.deck).toEqual([]);
    expect(state.players.p2.deck).toEqual([]);
  });

  it("the CONTROL: with both decks DEEP the same swing ends nothing", () => {
    // D424 — an "X ends the game" rung is worthless without a neighbouring "Y does not",
    // or it passes on a build that ends the game on every attack.
    const { state } = swing(table("p1", SELF_TOP, FOE_TOP), "p1", SHARE_OUT);
    expect(state.phase.kind).not.toBe("gameOver");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the seat ORDER, driven from p2's chair.

describe("D491 §6 — controller-first, and the rung runs from p2's chair", () => {
  it("🛑 from P2's chair the rows read p2 THEN p1 — absolute seats would read p1 first", () => {
    // 🛑 D490's test, applied rather than a precedent picked: the distinguishing fact
    // between the two shipped both-seats precedents is what the op emits per iteration.
    // `counterEachAll` files one `COUNTERS_PLACED` per BODY, so its absolute `SEATS` walk
    // is not a row order; this op and `handRefresh` file one row per SEAT, so the seat
    // order IS the log's order. ⚠️ AND THE CLAIM IS INERT FROM P1's CHAIR — controller-
    // first and absolute agree there — which is why this board is the other way round.
    const { state, events } = swing(table("p2", SELF_TOP, FOE_TOP), "p2", SHARE_OUT);
    // ⚠️ THE ROWS ARE FILTERED BY `reason: "effect"`. An attack ENDS THE TURN, so the
    // defender's §5.1 turn-start draw files a third `CARDS_DRAWN` inside this same action
    // — and a bare row count would read `["p2","p1","p1"]` and pass a build that walked
    // the seats either way.
    expect(effectDraws(events, state)).toEqual([
      { seat: "p2", ids: ["d491-a1", "d491-a2", "d491-a3"] },
      { seat: "p1", ids: ["d491-b1", "d491-b2", "d491-b3"] },
    ]);
  });

  it("from P1's chair the two readings AGREE, which is the control", () => {
    // D424: every "X is refused" owes a neighbouring "Y is admitted". Here the control is
    // that the distinction genuinely vanishes on the default board — otherwise the rung
    // above would look like a claim about seat order when it is a claim about the fixture.
    const { state, events } = swing(table("p1", SELF_TOP, FOE_TOP), "p1", SHARE_OUT);
    expect(effectDraws(events, state).map((row) => row.seat)).toEqual(["p1", "p2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the log, and the second player's voice.

describe("D491 §7 — the second player's wording is FREE", () => {
  it("⚠️ two rows, each filed under its OWN seat, with the same predicate", () => {
    // `log.ts`'s `CARDS_DRAWN` arm files `row(event.seat, …)` and the segments carry NO
    // subject — the subject is the seat chip, and `src/features/game/viewLog.ts` maps each
    // row to `you`/`opponent` per VIEWER. So a both-seats draw needs ZERO `log.ts` bytes
    // and cannot render the wrong voice for either player: the row is minted seat-keyed
    // and relabelled at read time (the module header's whole argument).
    const { state, events } = swing(table("p1", SELF_TOP, FOE_TOP), "p1", SHARE_OUT);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:11" };
    const rows = logFromEvents(events, ctx).flatMap((entry) =>
      entry.kind === "turn"
        ? []
        : [{ who: entry.who, text: entry.segments.map((seg) => seg.text).join("") }],
    );
    // ⚠️ `drew 3 cards` only — the defender's §5.1 turn draw renders `drew a card` off the
    // `turnStart` arm, so the plural is what separates this op's rows from the clock's.
    const drew = rows.filter((row) => row.text === "drew 3 cards");
    expect(drew.map((row) => row.who)).toEqual(["p1", "p2"]);
    // The SAME predicate under two different seat chips — the row carries no subject of
    // its own, so neither seat can be rendered in the other's voice.
    expect(new Set(drew.map((row) => row.text))).toEqual(new Set(["drew 3 cards"]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — `recordAs` over two seats, and the DESCRIBER obligation, traced.

describe("D491 §8 — the record is filed ONCE, over both seats' cards", () => {
  it("🛑 `recordMoved` ASSIGNS, so a per-seat filing would keep only the LAST seat", () => {
    // D458 measured the overwrite; D490 measured a damage number that turned on it. Nothing
    // prints `who: "eachPlayer"` with a `recordAs` today, so this is the accumulate-then-
    // assign shape chosen so the day something does, the slot is right rather than
    // plausibly wrong — driven through the real interpreter rather than argued.
    const state = table("p1", SELF_TOP, FOE_TOP);
    const record: EffectRecord = {};
    const events: GameEvent[] = [];
    const program: readonly EffectOp[] = [
      { op: "drawCards", count: COUNT, who: "eachPlayer", recordAs: "moved" },
    ];
    runProgram(state, program, { seat: "p1" }, events, record);
    expect(record.moved).toHaveLength(2 * COUNT);
    expect((record.moved ?? []).map((uid) => idOf(uid, state))).toEqual([
      "d491-a1",
      "d491-a2",
      "d491-a3",
      "d491-b1",
      "d491-b2",
      "d491-b3",
    ]);
  });

  it("⚠️ the DESCRIBER obligation is EMPTY, and it is traced rather than argued", () => {
    // 🛑 D478/D489: *"this op has a seat axis, so the describers apply"* is a CATEGORY
    // argument, and a brief has predicted describer work from one three slices running with
    // the obligation empty every time. `withConsequence` has ONE call site — `runProgram`'s
    // `"park" in stepped` branch — and it returns the prompt unchanged unless
    // `recordSlotOf(op)` is defined AND the queue holds a `recordGate` on that slot.
    // The executable half of the trace is that this program never reaches the call site at
    // all: `drawCards` cannot park, on any board, including the empty-deck ones.
    for (const [seat, self, foe] of [
      ["p1", SELF_TOP, FOE_TOP],
      ["p1", ["d491-a1"], ["d491-b1"]],
      ["p1", [], []],
      ["p2", SELF_TOP, FOE_TOP],
    ] as const) {
      const { state, events } = swing(table(seat, self, foe), seat, SHARE_OUT);
      expect(state.phase.kind).not.toBe("effect:choose");
      expect(types(events)).not.toContain("EFFECT_PENDING");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — `MATCH_RECORD_VERSION` stays 29, driven at the hard address.

describe("D491 §9 — the version question, asked at the address that persists", () => {
  it("🛑 the ADDRESS does persist, so this is NOT a no-carrier argument", () => {
    // D450/D456/D463: an `EffectOp` reaches storage through `EffectContinuation`'s
    // `pendingOp` and its `rest`, written on a park. `drawCards` never parks ITSELF, but it
    // sits in `recordGate.then` behind `payFromHand` (D473's shipped pair), which does — so
    // a v29 continuation genuinely can hold a `drawCards`. Naming which argument is being
    // made is part of making it, and the argument here is D125's WIDENING plus D441's
    // ABSENT-KEY DIRECTION, not reachability.
    expect(deriveAttackEffect("Discard a card from your hand. If you do, draw 2 cards.")).toEqual([
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-op list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
    ]);
  });

  it("🛑 a v29 byte string still means what a v29 writer meant — the LOSS direction", () => {
    // D441's question is never *"is the key optional"* but *"does the ABSENT key still say
    // what the old writer meant"*. Reconstructed by hand (delete the key the old writer
    // never wrote) and replayed through the real interpreter on the same board.
    const state = table("p1", SELF_TOP, FOE_TOP);
    const v29: readonly EffectOp[] = [{ op: "drawCards", count: COUNT }];
    const events: GameEvent[] = [];
    const record: EffectRecord = {};
    const next = runProgram(state, v29, { seat: "p1" }, events, record);
    if ("park" in next) throw new Error("drawCards must not park");
    expect(all(events, "CARDS_DRAWN")).toHaveLength(1);
    expect(gained(state, next.state, "p1")).toEqual(["d491-a1", "d491-a2", "d491-a3"]);
    expect(gained(state, next.state, "p2")).toEqual([]);
    // …and the NEW key on the SAME board answers a DIFFERENT hand count, which is what
    // makes the pair a measurement rather than a restatement (D441: both directions or
    // neither). Six cards leave the table where a v29 record moves three.
    const wide: readonly EffectOp[] = [{ op: "drawCards", count: COUNT, who: "eachPlayer" }];
    const wideEvents: GameEvent[] = [];
    const widened = runProgram(state, wide, { seat: "p1" }, wideEvents, {});
    if ("park" in widened) throw new Error("drawCards must not park");
    expect(gained(state, widened.state, "p2")).toHaveLength(COUNT);
    expect(all(wideEvents, "CARDS_DRAWN")).toHaveLength(2);
  });

  it("the engine version moved and the record version did not", () => {
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe(engineVersion);
  });
});
