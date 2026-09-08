import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { CardFilter, EffectOp } from "./effects";
import { deriveAttackDiscardScaledBoost, deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import { matchesFilter } from "./cards";
import { runProgram } from "./interpreter";
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
  types,
} from "./testFixtures";

// 0.382.0 → 0.383.0 — 🆕🆕🆕 D488: MILL YOUR OWN DECK, THEN SCALE BY WHAT WAS MILLED.
//
//   file line 126 (1 printing)  "Discard the top 3 cards of your deck, and this attack
//                                does 80 damage for each Energy card you discarded in
//                                this way."
//   file line 129 (1 printing)  "Discard the top 7 cards of your deck, and this attack
//                                does 70 damage for each Misty's Pokémon that you
//                                discarded in this way."
//
// 2 sentences / 2 legal printings over `legalAttackCorpus()`'s 640 / 1,732. The carrier
// ids are UNRESOLVED in this checkout (no local D1) and are stated as such rather than
// invented — D425's standing limitation.
//
// 🛑 **THE WORK ORDER ASKED WHETHER THESE TWO ROWS REALLY SHARE ONE BLOCKER, AND THE
// ANSWER IS YES — MEASURED BY AXIS DELETION RATHER THAN BY RESEMBLANCE.** D483's
// four-row cluster split 2+2 under exactly this test, so the question is not
// rhetorical. §2 deletes each axis in turn and re-runs both rows against all 13 readers
// of `attackReaderSurface()`:
//
//   • delete the FILTER — both rows collapse to the SAME string at two counts, and
//     BOTH ARE STILL REFUSED. **The noun is not what blocks either of them.**
//   • delete the MILL HEAD — put the shipped Energy-discard head under the same
//     filtered tail and it is STILL REFUSED. **The filtered count is a blocker of its
//     own.**
//   • delete the SCALING — both heads build, to the same op at two counts.
//
// **Two blockers; both rows carry both; neither is the noun.** The two filters differ in
// KIND (a card CATEGORY against an OWNER-PREFIXED name) and that difference costs
// nothing, because `CardFilter` already spells both (`anyEnergy`, `ownerPokemon`).
//
// 🛑 **THE BRIEF'S READ WAS FLAGGED AS UNVERIFIED AND IT WAS RIGHT — the sixth
// consecutive slice in which the hedged claim is the derived one.** It guessed *"the
// blocker may be a damage count source that reads a record slot"*. Half right, and the
// half it got wrong is the interesting one: `DamageCountSource` is not involved at ALL.
// The count that scales this family is not a `DamageCountSource` — it is
// `damageDefender.count`, an `EffectSlot`, on the other side of the §8 boundary (the
// fold union is read at DECLARATION, off the board; this op re-enters §8.5 from inside
// the program, after the mill). The blocker was one optional field on that op.
//
// 🛑 **THE COMPOSITION QUESTION, ASKED FIRST AND DRIVEN (D482), AND ITS COUNTERWEIGHT
// FIRED (D486).** The nearest shipped spelling is `DamageCountSource.cardsInDiscardPile
// { seat, filter }` — a FILTERED count of a pile, which is exactly the noun this
// sentence prints — reached through `deriveAttackDamageMultiplier`. It fails for two
// independent reasons and §4 drives both: that fold is computed when `attack()` builds
// the program, which is BEFORE the mill runs, and it counts the WHOLE pile rather than
// what this sentence moved. ⚠️ **On a board whose discard pile starts EMPTY the two are
// arithmetically identical**, which is why every board in §6/§7 pre-seeds the pile —
// the separating fact is not the count but WHICH cards are counted, and a suite that
// attacked from an empty pile would have been green for nothing.
//
// ⚠️ **WHAT THIS SLICE COST, NAMED AS ZEROES SO THE CLAIM IS CHECKABLE:** ONE new
// anchor, ONE new `deriveAttackEffect` arm, ONE new noun resolver, TWO OPTIONAL keys on
// two shipped ops (`discardDeckTop.recordAs`, `damageDefender.countFilter`) and ONE
// interpreter helper. **ZERO** new `EffectOp` members, `EffectSlot` members,
// `CardFilter` members, `DamageCountSource` members, `BoardCondition` members, prompts,
// prompt fields, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon`
// fields, readers (the surface stands still at **13**), registry rows, `FIXTURE_POOL`
// ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes and
// **`MATCH_RECORD_VERSION` bytes**.
//
// SEED-FREE: neither op consumes RNG. The one seed below feeds setup's shuffle, and
// every board rebuilds the zones under test outright.

/** The two printed sentences, byte for byte off `legalAttackCorpus()` (§1 asserts it, so
    a re-ingest disagrees with these lines rather than with a number). */
const MILL_ENERGY =
  "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way.";
const MILL_MISTY =
  "Discard the top 7 cards of your deck, and this attack does 70 damage for each Misty's Pokémon that you discarded in this way.";
/** The shipped SIBLING this arm is nearest to — D402's Energy discard with an
    UNFILTERED slot count. A real printed sentence rather than a constructed one, and the
    control that proves the 13 shipped printings do not move. */
const HAIL_BLADE =
  "You may discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.";
/** The shipped bare MILL — this sentence's own head, and what a dropped tail reads as. */
const BARE_MILL = "Discard the top 3 cards of your deck.";
/** A residue sentence no reader claims, fielded as the LOUD control: it is what makes
    "no `ATTACK_EFFECT_SKIPPED`" mean something on the boards where nothing scores. Its
    refusal is asserted live in §11 rather than assumed (D480). */
const LOUD = "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.";

const ENERGY_PROGRAM: readonly EffectOp[] = [
  { op: "discardDeckTop", whose: "self", count: 3, recordAs: "discarded" },
  { op: "damageDefender", per: 80, count: "discarded", countFilter: { kind: "anyEnergy" } },
];
const MISTY_PROGRAM: readonly EffectOp[] = [
  { op: "discardDeckTop", whose: "self", count: 7, recordAs: "discarded" },
  {
    op: "damageDefender",
    per: 70,
    count: "discarded",
    countFilter: { kind: "ownerPokemon", owner: "Misty" },
  },
];
/** The v29 byte strings: the SAME two ops with the new keys ABSENT. §9 reads them back
    and drives that they still mean what they meant. */
const V29_MILL: readonly EffectOp[] = [{ op: "discardDeckTop", whose: "self", count: 3 }];
const V29_SCALE: readonly EffectOp[] = [{ op: "damageDefender", per: 80, count: "discarded" }];

/** The printed HEAD this family shares, as a predicate over the column. Deliberately
    LOOSER than the anchor (it says nothing about the fold, the noun or the numbers) so
    §1 can assert the anchor takes every row of this shape and no other — the D425 rule
    that a census is only as honest as the pattern it publishes. */
const MILL_HEAD = /^Discard the top \d+ cards of your deck, and this attack does /;

const SEED = 20260908;

// ── The board (D414: a file-local `cardPool`, no `FIXTURE_POOL` id). ─────────────────
const ENERGY_SWING = 0;
const MISTY_SWING = 1;
const PLAIN_CUFF = 2;
const LOUD_SWING = 3;

/** `d488-*` keys with no catalog row behind them (D425). Every card here is a DISTINCT
    id rather than N copies of one, because every figure in this file is a statement
    about WHICH cards moved — a deck of identical cards makes all eight candidate
    readings of §5 answer the same thing and every rung vacuous. */
const D488_CARDS: Record<string, Card> = {
  "d488-miller": battler("d488-miller", {
    name: "D488 Miller",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      // ⚠️ THE PRINTED DAMAGE IS THE PER-UNIT, WHICH IS THE MULTIPLY FAMILY'S SHAPE
      // (D402): "80×" / "70×". `attack.ts`'s `programDamage` DROPS it because the
      // program owns the number, and §6/§7 drive that drop by ARITHMETIC — a kept base
      // is a distinct total on both boards, not merely an extra event.
      { cost: ["Colorless"], name: "Sediment", damage: 80, effect: MILL_ENERGY },
      { cost: ["Colorless"], name: "Tidal Sweep", damage: 70, effect: MILL_MISTY },
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
      { cost: ["Colorless"], name: "Borrowed Reach", effect: LOUD },
    ],
  }),
  /** The defender. Big enough that nothing this file's CORRECT readings do Knocks it
      Out — a KO would end the batch before the zones could be read. */
  "d488-wall": battler("d488-wall", { name: "D488 Wall", types: ["Colorless"], hp: 340 }),
  "d488-water-1": basicEnergy("d488-water-1"),
  "d488-water-2": basicEnergy("d488-water-2"),
  "d488-water-3": basicEnergy("d488-water-3"),
  "d488-water-4": basicEnergy("d488-water-4"),
  "d488-water-5": basicEnergy("d488-water-5"),
  "d488-item-1": itemTrainer("d488-item-1"),
  "d488-item-2": itemTrainer("d488-item-2"),
  "d488-item-3": itemTrainer("d488-item-3"),
  "d488-item-4": itemTrainer("d488-item-4"),
  "d488-item-5": itemTrainer("d488-item-5"),
  /** The OWNER-PREFIXED Pokémon. `ownerPokemon` is `card.name.startsWith("Misty's ")`,
      so the NAME is the datum here and the id is not — which is why these ids are not
      spelled `misty` and the names are. */
  "d488-m1": battler("d488-m1", { name: "Misty's Psyduck", types: ["Water"], hp: 60 }),
  "d488-m2": battler("d488-m2", { name: "Misty's Starmie", types: ["Water"], hp: 90 }),
  "d488-m3": battler("d488-m3", { name: "Misty's Goldeen", types: ["Water"], hp: 60 }),
  "d488-m4": battler("d488-m4", { name: "Misty's Seaking", types: ["Water"], hp: 90 }),
  "d488-m5": battler("d488-m5", { name: "Misty's Horsea", types: ["Water"], hp: 50 }),
  /** 🛑 THE WRONG-OWNER CONTROLS, and they are the rungs that keep §7 from being green
      under `anyPokemon`. A build that read the printed noun as "Pokémon" scores these
      too, and §5 shows the number that would produce. */
  "d488-e1": battler("d488-e1", { name: "Erika's Bellsprout", types: ["Grass"], hp: 60 }),
  "d488-e2": battler("d488-e2", { name: "Erika's Oddish", types: ["Grass"], hp: 60 }),
  /** A Pokémon with NO owner prefix at all — the third point of the noun triangle. */
  "d488-plain": battler("d488-plain", { name: "D488 Plain", types: ["Colorless"], hp: 60 }),
};

const D488_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D488_CARDS };

/** Its own deck (D270/D412), 60 counted before the first run:
    3 + 3 + 18×3 = 60. */
const D488_DECK = deckOf({
  "d488-miller": 3,
  "d488-wall": 3,
  "d488-water-1": 3,
  "d488-water-2": 3,
  "d488-water-3": 3,
  "d488-water-4": 3,
  "d488-water-5": 3,
  "d488-item-1": 3,
  "d488-item-2": 3,
  "d488-item-3": 3,
  "d488-item-4": 3,
  "d488-item-5": 3,
  "d488-m1": 3,
  "d488-m2": 3,
  "d488-m3": 3,
  "d488-m4": 3,
  "d488-m5": 3,
  "d488-e1": 3,
  "d488-e2": 3,
  "d488-plain": 3,
});

/** 🛑 **BOARD A — the deck for `MILL_ENERGY`, TOP FIRST, and its contents are computed
    in §5 rather than chosen.** The top THREE are what the sentence takes: ONE Energy and
    two non-Energy, so *count-matching* and *count-everything* are 1 and 3 rather than
    the same number. */
const ENERGY_DECK = [
  "d488-water-1", // milled — MATCHES `anyEnergy`
  "d488-m1", //      milled — a Pokémon, not an Energy
  "d488-item-1", //  milled — an Item, not an Energy
  "d488-water-2", // stays: what a MILL-side filter would have reached instead
  "d488-water-3",
  "d488-water-4",
  "d488-water-5",
  "d488-m2",
  "d488-plain",
] as const;
/** Board A's PRE-SEEDED discard pile — 5 cards of which 3 are Energy. It exists so that
    *count-the-whole-pile* is a DIFFERENT number from *count-the-record*; on an empty
    pile the two are identical and this file would prove nothing. */
const ENERGY_PILE = [
  "d488-water-3",
  "d488-water-4",
  "d488-water-5",
  "d488-item-2",
  "d488-item-3",
] as const;

/** 🛑 **BOARD B — the deck for `MILL_MISTY`, TOP FIRST.** The top SEVEN carry TWO
    Misty's Pokémon, TWO Erika's Pokémon (the wrong owner), ONE Energy and TWO Items, so
    *Misty's*, *any Pokémon*, *any Energy* and *everything* are 2, 4, 1 and 7 — four
    different multipliers on one board. */
const MISTY_DECK = [
  "d488-m1", //     milled — MATCHES `ownerPokemon "Misty"`
  "d488-e1", //     milled — a Pokémon, WRONG owner
  "d488-water-1", //milled — an Energy
  "d488-item-1", // milled — an Item
  "d488-m2", //     milled — MATCHES
  "d488-e2", //     milled — a Pokémon, WRONG owner
  "d488-item-2", // milled — an Item
  "d488-m3", //     stays
  "d488-item-3",
  "d488-plain",
] as const;
/** Board B's PRE-SEEDED pile — 4 cards of which 3 are Misty's. §5's reason. */
const MISTY_PILE = ["d488-m4", "d488-m5", "d488-m3", "d488-item-4"] as const;

/** The ZERO-MATCH board: the mill happens and NOTHING it moved counts. Three Items on
    top, so `anyEnergy` scores 0 while the mill itself is fully observable. */
const ZERO_DECK = [
  "d488-item-1",
  "d488-item-2",
  "d488-item-3",
  "d488-water-1",
  "d488-water-2",
  "d488-plain",
] as const;

function openTable(first: Seat): GameState {
  const created = createGame({ seed: SEED, decks: { p1: D488_DECK, p2: D488_DECK }, cardPool: D488_POOL });
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

/** Rebuild `seat`'s DECK **and DISCARD PILE** outright, in the exact orders named, and
    park every other card the setup shuffle dealt in the HAND.

    ⚠️ **BOTH zones are rebuilt and that is the point of the helper.** D487's sibling
    rebuilt only the deck and sent the leftovers to the discard; here the discard is a
    ZONE UNDER TEST — it is what tells a record count from a pile count — so a residual
    card in it would move a figure silently. The leftovers go to the HAND, which nothing
    in this file reads. */
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

/** p1 owns TURN 2 with the Miller Active, `deck` as its whole library and `pile` as its
    whole discard pile, both in order. */
function table(
  deck: readonly string[],
  pile: readonly string[] = [],
  attacker: Seat = "p1",
): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d488-miller");
  state = setActiveFromDeck(state, defender, "d488-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = attachFromDeck(state, attacker, "d488-water-1", 1);
  return withZones(state, attacker, deck, pile);
}

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
function find<T extends GameEvent["type"]>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
const countOf = <T extends GameEvent["type"]>(events: GameEvent[], type: T): number =>
  events.filter((e) => e.type === type).length;

/** Every reader on the module surface, called by name — the D480/D482 oracle. Not
    `programFor`, which answers a REGISTRY question and would call an attack "built" for
    a card whose Ability happens to have a row (D204, `refusedPrintings.ts` limit 1). */
function readersClaiming(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
    if (read === undefined) throw new Error(`no reader ${name}`);
    return read(text) !== null;
  });
}

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** How many of `ids` satisfy `filter`, read through the SHIPPED predicate rather than a
    hand-rolled one — so a rung here can never disagree with the interpreter about a
    card (D159). */
const matching = (ids: readonly string[], filter: CardFilter): number =>
  ids.filter((id) => matchesFilter(D488_POOL[id], filter)).length;

/** A candidate reading of the printed sentence, as a pure function of the board:
    `(milled, pileBefore, per, filter, printedBase) => damage`. §5 fills the table. */
type Reading = (
  milled: readonly string[],
  pileBefore: readonly string[],
  per: number,
  filter: CardFilter,
  printedBase: number,
) => number;

describe("D488 §1 — the two printed rows, off the column rather than off this file", () => {
  it("both sentences are in `legalAttackCorpus()` at exactly 1 printing each", () => {
    const rows = legalAttackCorpus();
    for (const text of [MILL_ENERGY, MILL_MISTY]) {
      const hit = rows.filter(([, s]) => s === text);
      expect(hit, text).toHaveLength(1);
      expect(units(hit), text).toBe(1);
    }
    // …and the anchor takes THOSE TWO and nothing else in the whole column. A reader
    // that claimed a third row would be authoring a card (D183).
    const taken = rows.filter(([, s]) => readersClaiming(s).length > 0 && MILL_HEAD.test(s));
    expect([...taken].sort()).toEqual(
      [
        [1, MILL_ENERGY],
        [1, MILL_MISTY],
      ].sort(),
    );
    expect(units(taken)).toBe(2);
  });

  it("the wider `discarded in this way` family is still 12 sentences / 27 printings", () => {
    // The POPULATION is a fact about the column and does not move when a reader is
    // added — this rung is what tells "D488 built two of them" from "the ingest
    // changed". `discardScaledDamage.test.ts` §1 holds the same number for the same
    // reason; the two are deliberately redundant (D465: a figure with one witness has
    // none).
    const family = legalAttackCorpus().filter(([, s]) => s.includes("discarded in this way"));
    expect(family).toHaveLength(12);
    expect(units(family)).toBe(27);
    // …and the RESOLVED half of it steps by exactly these two: 6 sentences / 13
    // printings (D402) + 2 / 8 (D403's additive pair) + 2 / 2 (here) = 10 of the 12
    // sentences and 23 of the 27 printings. ⚠️ The two counts move by DIFFERENT amounts
    // (+2 and +2 here, but 6+2+2 against 13+8+2) and are asserted separately for that
    // reason — a single figure would hide which of them a re-ingest moved.
    // 🆕🆕🆕 **D489 +1 sentence / +2 printings** — the HAND discard whose damage goes to
    // a CHOSEN body, which the line below used to name as one of the two still refused.
    // 10 / 23 → **11 / 25**, and the three arms of the resolved half now sum: D402's 6 /
    // 13 (board discard) + D403's 2 / 8 (additive) + D488's 2 / 2 (mill) + D489's 1 / 2
    // (hand) = 11 / 25.
    // 🆕🆕🆕 **D490 +1 sentence / +2 printings — THE FAMILY IS NOW WHOLLY BUILT AND THE
    // FOUR ARMS SUM EXACTLY**: D402's 6 / 13 (board discard) + D403's 2 / 8 (additive
    // bench) + D488's 2 / 2 (own-deck mill) + D489's 1 / 2 (hand) + D490's 1 / 2 (the
    // two-deck mill) = **12 / 27**, which is the whole family. The population figure
    // above is what tells "D490 built the last one" from "the ingest changed".
    const read = family.filter(([, s]) => resolvedByAnyReader(s));
    expect(read).toHaveLength(12);
    expect(units(read)).toBe(27);
    // 🛑 **THE LEFTOVER RUNG IS RE-POINTED ONTO ITS OWNER RATHER THAN DECREMENTED TO
    // ZERO** (D418's second half, D438's polarity rule). `left` being empty is TRUE under
    // a build that widened some reader onto the whole column, so the emptiness is stated
    // BESIDE the named owner and the two numbers above — the day a thirteenth member of
    // this family is printed and unread, THIS rung names it.
    const left = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(left).toEqual([]);
    const twoDeck = family.filter(
      ([, s]) =>
        s ===
        "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way.",
    );
    expect(twoDeck.map(([n]) => n)).toEqual([2]);
    // …and it is `deriveAttackDiscardScaledBoost`'s, NOT this file's subject: a build
    // that let `DECK_MILL_FILTERED_SCALED_DAMAGE` reach across the sentence break would
    // pass a bare "it is read" rung and fail this one.
    expect(deriveAttackEffect(twoDeck[0]?.[1] as string)).toBeNull();
    expect(deriveAttackDiscardScaledBoost(twoDeck[0]?.[1] as string)).toEqual({
      kind: "eachDeckMill",
      per: 140,
    });
  });

  it("the reader surface stands still at THIRTEEN — no reader was added", () => {
    // Both rows land inside `deriveAttackEffect`, so the surface is untouched. A
    // fourteenth reader would move census figures in 40 files and is exactly what this
    // rung exists to make loud (D418).
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });
});

describe("D488 §2 — AXIS DELETION: are these two rows really one row?", () => {
  // 🛑 THE WHOLE SECTION IS ONE MEASUREMENT, AND IT IS THE ONE D483 SHOWS YOU CANNOT
  // SKIP. Two sentences that LOOK alike split 2+2 there under exactly this test. Each
  // rung below deletes ONE axis and leaves the others standing (D484), and asserts the
  // verdict of all 13 readers rather than of `deriveAttackEffect` alone.

  it("deleting the FILTER collapses both rows to ONE string — which is still refused", () => {
    // The two sentences differ in their noun and in two numbers. Take the noun out and
    // they are the SAME sentence at two counts, and NEITHER of the resulting strings is
    // claimed by anything — before this slice or after it. **So the noun is not what
    // blocked either row**, and a slice that had built "the Energy one first" would
    // have found the second free.
    const unfiltered = (n: number, per: number) =>
      `Discard the top ${n} cards of your deck, and this attack does ${per} damage for each card you discarded in this way.`;
    expect(unfiltered(3, 80)).toBe(
      MILL_ENERGY.replace(" for each Energy card you", " for each card you"),
    );
    expect(unfiltered(7, 70)).toBe(
      MILL_MISTY.replace(" for each Misty's Pokémon that you", " for each card you"),
    );
    for (const text of [unfiltered(3, 80), unfiltered(7, 70)]) {
      expect(readersClaiming(text), text).toEqual([]);
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
  });

  it("deleting the MILL HEAD leaves the FILTERED COUNT refused on its own", () => {
    // The second blocker, isolated. Put the fully-SHIPPED Energy-discard head (D402's,
    // which records) under each row's filtered tail: still nothing reads it, because
    // `damageDefender.count` had no filter. **That makes the filtered count a blocker
    // in its own right rather than a rider on the mill**, and it is why building only
    // one row would not have been cheaper.
    for (const tail of [
      "This attack does 80 damage for each Energy card you discarded in this way.",
      "This attack does 70 damage for each Misty's Pokémon that you discarded in this way.",
    ]) {
      const text = `Discard all {W} Energy from this Pokémon. ${tail}`;
      expect(readersClaiming(text), text).toEqual([]);
    }
    // …and the CONTROL that makes the rung above mean something: the identical head
    // under the UNFILTERED tail has read since D402.
    expect(
      readersClaiming("Discard all {W} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way."),
    ).toEqual(["deriveAttackEffect"]);
  });

  it("deleting the SCALING leaves two heads that BOTH already built, to one op", () => {
    // The third axis, and the only one that was never a blocker. `DECK_TOP_MILL` has
    // read both heads since D131 — which is what makes these rows TAIL repairs and not
    // whole-sentence ones.
    expect(deriveAttackEffect(BARE_MILL)).toEqual([{ op: "discardDeckTop", whose: "self", count: 3 }]);
    expect(deriveAttackEffect("Discard the top 7 cards of your deck.")).toEqual([
      { op: "discardDeckTop", whose: "self", count: 7 },
    ]);
  });

  it("🛑 the verdict: ONE mechanism serves both, and the two filters are free", () => {
    // Both rows now build, through the SAME anchor and the SAME two ops, differing in
    // exactly the two things the printed text differs in — a count and a filter. If
    // this were two slices, one of them would need something the other does not; §5's
    // op comparison is what says it does not.
    const a = deriveAttackEffect(MILL_ENERGY) as EffectOp[];
    const b = deriveAttackEffect(MILL_MISTY) as EffectOp[];
    expect(a).toEqual(ENERGY_PROGRAM);
    expect(b).toEqual(MISTY_PROGRAM);
    expect(a.map((op) => op.op)).toEqual(b.map((op) => op.op));
    expect(a).toHaveLength(2);
    // ZERO new `CardFilter` members: both nouns resolve to members that shipped before
    // this slice (`anyEnergy` D231-era, `ownerPokemon` D245).
    const filters = [a[1], b[1]].map((op) =>
      op !== undefined && op.op === "damageDefender" ? op.countFilter : undefined,
    );
    expect(filters).toEqual([{ kind: "anyEnergy" }, { kind: "ownerPokemon", owner: "Misty" }]);
  });
});

describe("D488 §3 — the parse: every capture is a field, and the noun group is LAZY", () => {
  it("the three captures are the mill count, the per-unit and the noun", () => {
    expect(deriveAttackEffect(MILL_ENERGY)).toEqual(ENERGY_PROGRAM);
    expect(deriveAttackEffect(MILL_MISTY)).toEqual(MISTY_PROGRAM);
    // Vary ONE capture at a time and watch ONE field move (D484). The other two fields
    // are asserted unchanged in the same object, which is what makes this a
    // discriminating rung rather than three smoke tests.
    expect(
      deriveAttackEffect("Discard the top 5 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way."),
    ).toEqual([
      { op: "discardDeckTop", whose: "self", count: 5, recordAs: "discarded" },
      { op: "damageDefender", per: 80, count: "discarded", countFilter: { kind: "anyEnergy" } },
    ]);
    expect(
      deriveAttackEffect("Discard the top 3 cards of your deck, and this attack does 10 damage for each Energy card you discarded in this way."),
    ).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3, recordAs: "discarded" },
      { op: "damageDefender", per: 10, count: "discarded", countFilter: { kind: "anyEnergy" } },
    ]);
    expect(
      deriveAttackEffect("Discard the top 3 cards of your deck, and this attack does 80 damage for each Item card you discarded in this way."),
    ).toEqual([
      { op: "discardDeckTop", whose: "self", count: 3, recordAs: "discarded" },
      { op: "damageDefender", per: 80, count: "discarded", countFilter: { kind: "item" } },
    ]);
  });

  it("🛑 the noun group is LAZY, and corpus line 129 is the WHOLE witness for it", () => {
    // A GREEDY `(.+) (?:that )?you discarded` reads *"Misty's Pokémon that"* as the
    // noun — the relative pronoun swallowed INTO it — which resolves to `null` and
    // drops a printed row onto the loud path for a reason no reader could name. The
    // difference is INVISIBLE on corpus line 126, which prints no pronoun, so exactly
    // one of the two rows drives it. This rung is the reason the second row is not a
    // free rider on the first.
    const greedy =
      /^Discard the top (\d+) cards of your deck, and this attack does (\d+) damage for each (.+) (?:that )?you discarded in this way\.$/;
    expect(greedy.exec(MILL_MISTY)?.[3]).toBe("Misty's Pokémon that");
    expect(greedy.exec(MILL_ENERGY)?.[3]).toBe("Energy card");
    // …and what the greedy noun would have cost: nothing resolves it, so the row would
    // be refused with the anchor MATCHING — the quiet failure, not the loud one.
    const scale = deriveAttackEffect(MILL_MISTY) as EffectOp[];
    const op = scale[1];
    if (op === undefined || op.op !== "damageDefender") throw new Error("not a damageDefender");
    expect(op.countFilter).toEqual({ kind: "ownerPokemon", owner: "Misty" });
    // The pronoun is a SPELLING and not an axis: written or not, the program is the
    // same shape at the same fields.
    expect(
      deriveAttackEffect("Discard the top 7 cards of your deck, and this attack does 70 damage for each Misty's Pokémon you discarded in this way."),
    ).toEqual(MISTY_PROGRAM);
  });

  it("refuses an UNSPELLABLE noun LOUDLY rather than counting everything", () => {
    // The guard that matters most, because its failure mode is silent: an unresolved
    // noun must reach `ATTACK_EFFECT_SKIPPED`, never an unfiltered count. "Ancient" is
    // the standing example (`inPlayBodyFilter`'s own null path, 24 slices off the
    // table) and "Special Energy card" is a noun this map does not hold.
    for (const noun of ["Ancient card", "Special Energy card", "Pokémon", "Basic Pokémon"]) {
      const text = `Discard the top 3 cards of your deck, and this attack does 80 damage for each ${noun} you discarded in this way.`;
      expect(deriveAttackEffect(text), noun).toBeNull();
      expect(readersClaiming(text), noun).toEqual([]);
    }
    // 🛑 AND THE THREE NOUNS ABOVE THAT ARE PLAIN POKÉMON NOUNS ARE REFUSED ON PURPOSE.
    // `inPlayBodyFilter` would answer every one of them, and `matchesFilter` would
    // answer them correctly on a discarded card — the refusal is not a limitation of
    // the predicate, it is the D361 call not to claim sentences the column does not
    // print. Nothing here can be falsified by a card, so nothing here is claimed.
  });

  it("refuses the anchor, the fold, the direction and the singular — one axis each", () => {
    for (const text of [
      // NO TRAILING PERIOD, and a "!" for it — the `$`.
      "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way",
      "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way!",
      // A LOWERCASE first word — half of what keeps a mid-sentence clause off this path,
      // and the reason there is no /i flag (the family's standing choice).
      "discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      // THE FOLD. "more damage" is the ADDITIVE half, which keeps its printed base and
      // is a different reader entirely (D403). Claiming it here would deal the printed
      // base pre-program AND the scaled part inside it, paying Resistance twice.
      "Discard the top 3 cards of your deck, and this attack does 80 more damage for each Energy card you discarded in this way.",
      // THE DIRECTION. No printing mills the OPPONENT and scales off it; Camerupt mills
      // BOTH decks, which is a third thing again.
      "Discard the top 3 cards of your opponent's deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      "Discard the top card of each player's deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      // THE SINGULAR. `DECK_TOP_MILL` spells it as a separate branch; this compound
      // prints only the plural, so the branch is not written (arms no sentence drives).
      "Discard the top card of your deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      // THE CONNECTIVE. A PERIOD is the shape `deckTopMill.test.ts` pins the mill's `$`
      // against; this anchor demands the comma, which is what makes the two disjoint by
      // construction rather than by ordering.
      "Discard the top 3 cards of your deck. This attack does 80 damage for each Energy card you discarded in this way.",
      // THE ANAPHOR. Without "in this way" the clause is a BOARD read of the pile, which
      // is a different number on every board whose pile was not empty — D440's family,
      // and it does not print this head.
      "Discard the top 3 cards of your deck, and this attack does 80 damage for each Energy card in your discard pile.",
      // TWO PRINTED ZEROES, each a silent no-op where the loud path is the point (D145).
      "Discard the top 0 cards of your deck, and this attack does 80 damage for each Energy card you discarded in this way.",
      "Discard the top 3 cards of your deck, and this attack does 0 damage for each Energy card you discarded in this way.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // …and the SIBLING readers do not pick any of them up either — D382's strong form.
    expect(
      readersClaiming("Discard the top 3 cards of your deck, and this attack does 80 more damage for each Energy card you discarded in this way."),
    ).toEqual([]);
  });

  it("🛑 the 13 SHIPPED printings that already read a slot are BYTE-IDENTICAL", () => {
    // The widening's whole safety claim, driven rather than argued: an ABSENT
    // `countFilter` is the old behaviour, so every sentence D402/D403 already read
    // derives to an object with no such key. A `toEqual` against a literal is what
    // makes an accidentally-emitted `countFilter: undefined` red.
    expect(deriveAttackEffect(HAIL_BLADE)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Water" },
        count: "any",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ]);
    for (const [, text] of legalAttackCorpus().filter(
      ([, s]) => s.includes("discarded in this way") && deriveAttackEffect(s) !== null && !MILL_HEAD.test(s),
    )) {
      for (const op of deriveAttackEffect(text) as EffectOp[]) {
        if (op.op === "damageDefender") expect(Object.keys(op), text).not.toContain("countFilter");
        if (op.op === "discardDeckTop") expect(Object.keys(op), text).not.toContain("recordAs");
      }
    }
    // …and the bare mill, which is the same claim at the other op.
    expect(Object.keys((deriveAttackEffect(BARE_MILL) as EffectOp[])[0] ?? {})).toEqual([
      "op",
      "whose",
      "count",
    ]);
  });
});

describe("D488 §4 — the COMPOSITION question, driven, with its counterweight", () => {
  it("🛑 the nearest shipped spelling EXISTS and is DERIVABLE — and it is a different program", () => {
    // D482's rule: before pricing a row at "needs a new op", try to spell it with
    // shipped ops and DRIVE the result. The shipped spelling is real: rewrite the tail
    // as a discard-pile read and D440's reader claims it, producing a filtered count
    // over exactly the noun this sentence prints.
    const pileRead = "This attack does 80 damage for each Energy card in your discard pile.";
    expect(effects.deriveAttackDamageMultiplier(pileRead)).toEqual({
      per: 80,
      count: { kind: "cardsInDiscardPile", seat: "you", filter: { kind: "anyEnergy" } },
    });
    // Two INDEPENDENT reasons it cannot spell this sentence, and neither is a
    // preference:
    //   ① IT IS THE WRONG SIDE OF §8. `DamageCountSource` is folded when `attack()`
    //      builds the number — BEFORE the program runs — so a mill in the same
    //      sentence has not happened yet. `damageDefender` re-enters §8.5 from INSIDE
    //      the program, which is the whole reason that op exists (D96/D402).
    //   ② IT COUNTS THE WRONG SET. A pile read counts everything already there.
    // ⚠️ AND THE TWO READERS CANNOT BOTH FIRE ANYWAY: the census's structural rule is
    // one anchored reader per printed string, and `deriveAttackDamageMultiplier`
    // refuses this sentence outright — so there is no composition to reach for.
    expect(effects.deriveAttackDamageMultiplier(MILL_ENERGY)).toBeNull();
    expect(readersClaiming(MILL_ENERGY)).toEqual(["deriveAttackEffect"]);
    // …and the owner-prefixed noun is not even in that family's vocabulary, which is
    // the second half of why a map row there would have been the wrong repair.
    expect(
      effects.deriveAttackDamageMultiplier("This attack does 70 damage for each Misty's Pokémon in your discard pile."),
    ).toBeNull();
  });

  it("🛑 NAMING THE BOARD: the pile candidate and the record candidate agree on an EMPTY pile", () => {
    // D486's counterweight in its strongest form, and here it does NOT dissolve the
    // question — it constrains the board. On a pile that starts empty, "count what the
    // mill moved" and "count the pile afterwards" are the SAME NUMBER for every deck,
    // every count and every noun, by algebra rather than by coincidence: the pile
    // afterwards IS what the mill moved. **A suite that attacked from an empty pile
    // could not have told the two apart at any depth.**
    const milled = ["d488-water-1", "d488-m1", "d488-item-1"];
    const filter: CardFilter = { kind: "anyEnergy" };
    expect(matching(milled, filter)).toBe(matching([...[], ...milled], filter));
    // The separating board is therefore any board whose pile is NOT empty, and the
    // separation is a real number rather than a shape: on `ENERGY_PILE` the record
    // reading is 1 and the pile reading is 4.
    expect(matching(milled, filter)).toBe(1);
    expect(matching([...ENERGY_PILE, ...milled], filter)).toBe(4);
    // ⚠️ **THE ONE CANDIDATE NO BOARD SEPARATES IS THE MILL-SIDE FILTER** — a build
    // that milled only the MATCHING cards would deal a different number here, but on a
    // deck whose top N all match it is arithmetically identical to this one forever.
    // Its separating axis is not a quantity at all: it is WHICH CARDS LEFT THE DECK,
    // and §6 asserts the pile CONTENTS for exactly that reason.
    const topAllMatch = ["d488-water-1", "d488-water-2", "d488-water-3"];
    expect(matching(topAllMatch, filter)).toBe(3);
    expect(matching(topAllMatch.filter((id) => matchesFilter(D488_POOL[id], filter)), filter)).toBe(3);
  });
});

describe("D488 §5 — the candidate readings, computed BEFORE the boards were chosen", () => {
  // 🛑 EIGHT READINGS AS PURE FUNCTIONS (D482/D486/D487). Written down first so the
  // rungs below can PROVE the boards separate them rather than hope they do — at D487
  // five readings collided at one depth and the file needed two decks. Each answers the
  // DAMAGE the defender takes.
  const READINGS: Record<string, Reading> = {
    /** ① SHIPPED — the record, narrowed by the printed noun. */
    recordMatching: (m, _p, per, f, _base) => per * matching(m, f),
    /** ② the record, UNFILTERED — what dropping `countFilter` means. */
    recordAll: (m, _p, per) => per * m.length,
    /** ③ the record NEVER FILED — what dropping `recordAs` means. An empty slot is 0,
        and `amount <= 0` means no damage event at all. */
    noRecord: () => 0,
    /** ④ the whole pile AFTERWARDS, narrowed — the `cardsInDiscardPile` candidate of
        §4, and the reading an empty-pile board cannot tell from ①. */
    pileMatching: (m, p, per, f) => per * matching([...p, ...m], f),
    /** ⑤ the whole pile afterwards, UNFILTERED — the crudest pile read. */
    pileAll: (m, p, per) => per * (p.length + m.length),
    /** ⑥ ① with the printed base KEPT — what `programDamage` failing to drop it means.
        Its own reading because the two are one `if` apart in another file (D402). */
    baseKept: (m, _p, per, f, base) => base + per * matching(m, f),
    /** ⑦ the WRONG NOUN, widened to any Pokémon — what reading "Misty's Pokémon" as
        "Pokémon" would deal. */
    anyPokemonNoun: (m, _p, per) => per * matching(m, { kind: "anyPokemon" }),
    /** ⑧ the WRONG NOUN, narrowed to Energy — the other misresolution. */
    anyEnergyNoun: (m, _p, per) => per * matching(m, { kind: "anyEnergy" }),
  };

  it("BOARD A separates six of the eight, and the two it cannot are named", () => {
    const milled = ENERGY_DECK.slice(0, 3);
    const answers = Object.fromEntries(
      Object.entries(READINGS).map(([name, read]) => [
        name,
        read(milled, ENERGY_PILE, 80, { kind: "anyEnergy" }, 80),
      ]),
    );
    expect(answers).toEqual({
      recordMatching: 80,
      recordAll: 240,
      noRecord: 0,
      pileMatching: 320,
      pileAll: 640,
      baseKept: 160,
      // ⚠️ NAMED AS COLLISIONS RATHER THAN LEFT OUT (D400/D486): on THIS board the two
      // wrong-noun readings coincide with ① and with nothing else, because the milled
      // set holds exactly one Energy and exactly one Pokémon. Board B is where the noun
      // is separated, and it separates all eight.
      anyPokemonNoun: 80,
      anyEnergyNoun: 80,
    });
    const distinct = new Set(Object.values(answers));
    expect(distinct.size).toBe(6);
  });

  it("🛑 BOARD B separates ALL EIGHT — which is why the file fields two decks", () => {
    const milled = MISTY_DECK.slice(0, 7);
    const answers = Object.entries(READINGS).map(([name, read]) => [
      name,
      read(milled, MISTY_PILE, 70, { kind: "ownerPokemon", owner: "Misty" }, 70),
    ]);
    expect(Object.fromEntries(answers)).toEqual({
      recordMatching: 140,
      recordAll: 490,
      noRecord: 0,
      pileMatching: 350,
      pileAll: 770,
      baseKept: 210,
      anyPokemonNoun: 280,
      anyEnergyNoun: 70,
    });
    expect(new Set(answers.map(([, v]) => v)).size).toBe(8);
  });
});

describe("D488 §6 — BOARD A on a real board: the Energy noun, and the pile that separates it", () => {
  it("mills 3, counts ONE Energy among them, and deals 80 — not 240, 320 or 640", () => {
    const state = table(ENERGY_DECK, ENERGY_PILE);
    expect(idsIn(state, "p1", "deck")).toEqual([...ENERGY_DECK]);
    expect(idsIn(state, "p1", "discard")).toEqual([...ENERGY_PILE]);
    const { state: done, events } = swing(state, ENERGY_SWING);

    // THE MILL — three cards, in deck order, off the ATTACKER's own deck. `seat` is the
    // deck's owner and `actor` the player whose card did it; on a self-mill they agree,
    // which is the half of D153's rule this direction exercises.
    const milled = find(events, "DECK_TOP_DISCARDED");
    expect(milled).toMatchObject({ seat: "p1", actor: "p1" });
    expect(milled?.uids).toHaveLength(3);
    expect(idsIn(done, "p1", "deck")).toEqual([...ENERGY_DECK.slice(3)]);
    // 🛑 THE PILE CONTENTS, NOT JUST ITS SIZE — this is what separates the shipped
    // reading from a MILL-SIDE filter, which no damage number can (§4). All three
    // milled cards are in the pile, including the two that scored NOTHING.
    expect(idsIn(done, "p1", "discard")).toEqual([...ENERGY_PILE, ...ENERGY_DECK.slice(0, 3)]);

    // THE DAMAGE — 80 × 1. Every rival reading of §5 is a different number on this
    // board, so this single assertion refuses five of them at once.
    const damage = find(events, "DAMAGE_DEALT");
    expect(damage).toMatchObject({ seat: "p2", dealt: 80 });
    expect(damage?.weakness).toBeNull();
    expect(done.players.p2.active?.damage).toBe(80);
    // …and EXACTLY ONE hit, which is what refuses ⑥: a kept printed base would either
    // add 80 to this number or file a second row.
    expect(countOf(events, "DAMAGE_DEALT")).toBe(1);
    // The printed order is the op order: the mill files its cards, then the damage
    // reads what it filed.
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DECK_TOP_DISCARDED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 the ZERO-MATCH board deals NOTHING — with four controls against silence", () => {
    // The mill happens, three cards move, and not one of them is an Energy. The damage
    // is 0, which `damageDefender`'s `amount <= 0` turns into no event at all — so the
    // rung has to separate "counted zero" from "the reader never fired", "the mill
    // never ran" and "the attack was refused". Four controls, each a different silence.
    const state = table(ZERO_DECK, ENERGY_PILE);
    const { state: done, events } = swing(state, ENERGY_SWING);

    // ① THE MILL RAN — three cards left the deck and are in the pile.
    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toHaveLength(3);
    expect(idsIn(done, "p1", "deck")).toEqual([...ZERO_DECK.slice(3)]);
    expect(idsIn(done, "p1", "discard")).toEqual([...ENERGY_PILE, ...ZERO_DECK.slice(0, 3)]);
    // ② THE EFFECT WAS SIMULATED — no coverage flag, so the silence is a RESULT.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // ③ NO DAMAGE AT ALL, and the defender is untouched. A build that ignored the
    //    filter would have dealt 240 here.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(done.players.p2.active?.damage).toBe(0);
    // ④ THE TURN STILL ENDED — the attack HAPPENED and chose to do nothing, which is
    //    Hail Blade's declined-pick shape at a board that had no choice to make.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // …and the same swing on a board with ONE Energy on top deals 80, so the zero is
    // not this attack being dead.
    const live = swing(table([...ENERGY_DECK], ENERGY_PILE), ENERGY_SWING);
    expect(find(live.events, "DAMAGE_DEALT")?.dealt).toBe(80);
  });

  it("a SHORT deck mills what it has, and the count follows the board not the print", () => {
    // §8.6 "do as much as you can": the printed 3 against a deck of 2. The mill reports
    // the SHORT list and the damage scales off what actually moved — a build that
    // scaled off the printed number would deal 240 here.
    const shallow = ["d488-water-1", "d488-water-2"] as const;
    const { state: done, events } = swing(table(shallow, ENERGY_PILE), ENERGY_SWING);
    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toHaveLength(2);
    expect(idsIn(done, "p1", "deck")).toEqual([]);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(160);
    // Milling to zero does NOT end the game — §14.3 deck-out is a turn-START rule, so
    // the attacker loses at their NEXT draw and not one instant earlier.
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("an EMPTY deck mills nothing, files nothing and deals nothing", () => {
    const { state: done, events } = swing(table([], ENERGY_PILE), ENERGY_SWING);
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(idsIn(done, "p1", "discard")).toEqual([...ENERGY_PILE]);
  });
});

describe("D488 §7 — BOARD B: the OWNER-PREFIXED noun, and the wrong owner beside it", () => {
  it("mills 7, counts the TWO Misty's among them, and deals 140", () => {
    const state = table(MISTY_DECK, MISTY_PILE);
    const { state: done, events } = swing(state, MISTY_SWING);

    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toHaveLength(7);
    expect(idsIn(done, "p1", "deck")).toEqual([...MISTY_DECK.slice(7)]);
    expect(idsIn(done, "p1", "discard")).toEqual([...MISTY_PILE, ...MISTY_DECK.slice(0, 7)]);

    // 140 = 70 × 2. On this board every one of §5's eight readings is a DIFFERENT
    // number, so this assertion refuses all seven rivals at once — including both
    // wrong-noun readings, which board A could not separate.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(140);
    expect(countOf(events, "DAMAGE_DEALT")).toBe(1);
    expect(done.players.p2.active?.damage).toBe(140);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 the WRONG OWNER is milled and does not score — `anyPokemon` would have dealt 280", () => {
    // The two Erika's Pokémon are in the milled seven and land in the pile like
    // everything else; what they do not do is count. This is the rung that tells
    // `ownerPokemon` from `anyPokemon`, and §5 names the number the wrong reading gives.
    const { state: done } = swing(table(MISTY_DECK, MISTY_PILE), MISTY_SWING);
    const pile = idsIn(done, "p1", "discard");
    expect(pile).toContain("d488-e1");
    expect(pile).toContain("d488-e2");
    expect(done.players.p2.active?.damage).toBe(140);
    expect(done.players.p2.active?.damage).not.toBe(280);
    // …and the predicate that decides it is the shipped one, asserted on the cards
    // themselves so the board rung above cannot be green for a different reason (D486).
    const misty: CardFilter = { kind: "ownerPokemon", owner: "Misty" };
    expect(matchesFilter(D488_POOL["d488-m1"], misty)).toBe(true);
    expect(matchesFilter(D488_POOL["d488-e1"], misty)).toBe(false);
    expect(matchesFilter(D488_POOL["d488-plain"], misty)).toBe(false);
    // The prefix is matched WITH its trailing space and exact-case, so a card merely
    // NAMED "Misty" is not one of hers — the conjunct `ownerPokemon`'s doc names.
    expect(matchesFilter({ ...(D488_POOL["d488-m1"] as Card), name: "Mistyveil" }, misty)).toBe(false);
    // …and an owner-prefixed NON-Pokémon is not one either (Team Rocket's Energy is the
    // printed instance of that hazard).
    expect(
      matchesFilter({ ...(D488_POOL["d488-item-1"] as Card), name: "Misty's Ticket" }, misty),
    ).toBe(false);
  });
});

describe("D488 §8 — the STALE SLOT: an op that ran and moved nothing must overwrite", () => {
  it("🛑 a milled-out deck files an EMPTY answer over an earlier writer's uids", () => {
    // The rule `discardPileRetrieval` states and `attachFromDeck` repeats: an op that
    // RAN and moved nothing must OVERWRITE its slot, or a stale value survives it and
    // the count answers for the WRONG OP. On the shipped two-op program this path is
    // unreachable (nothing else writes `discarded`) — so it is driven HERE, through
    // `runProgram`'s seeded record, with a stale slot standing in for the composed
    // program the day one is written. ⚠️ Named as an unreachable-today guard rather
    // than dressed up as a board (D200/D214).
    const state = table([], ENERGY_PILE);
    const stale = state.players.p1.discard.slice(0, 3);
    expect(stale).toHaveLength(3);

    const events: GameEvent[] = [];
    const record = { discarded: [...stale] };
    const run = runProgram(state, ENERGY_PROGRAM, { seat: "p1" }, events, record);
    expect(run.kind).toBe("done");
    // The mill moved nothing, so the slot is EMPTY and the damage is zero — not the
    // 3 × 80 = 240 the stale uids would have bought.
    expect(record.discarded).toEqual([]);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(0);
  });

  it("…and a mill that DID move cards replaces the stale value rather than appending", () => {
    const state = table(ENERGY_DECK, ENERGY_PILE);
    const stale = state.players.p1.discard.slice(0, 3);
    const events: GameEvent[] = [];
    const record = { discarded: [...stale] };
    runProgram(state, ENERGY_PROGRAM, { seat: "p1" }, events, record);
    expect(record.discarded).toHaveLength(3);
    for (const uid of stale) expect(record.discarded).not.toContain(uid);
    // 80, not 320: the three stale Energy uids are NOT added to the one milled Energy.
    const dealt = events.find((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ dealt: 80 });
  });

  it("a uid the state cannot resolve does not count", () => {
    // `cardOfUid` returns undefined for a uid with no catalog id and `matchesFilter`
    // answers FALSE — the direction `hpOf`'s null takes one file over. Driven so the
    // `undefined` arm is a decision rather than an accident.
    const state = table([], ENERGY_PILE);
    const events: GameEvent[] = [];
    const record = { discarded: ["not-a-uid", "also-not-a-uid"] };
    runProgram(state, [ENERGY_PROGRAM[1] as EffectOp], { seat: "p1" }, events, record);
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(0);
    // …and the UNFILTERED arm still counts them, which is why the two branches are not
    // one call with an "everything" predicate: the 13 shipped printings must keep the
    // `.length` they always had.
    const both: GameEvent[] = [];
    runProgram(state, [{ op: "damageDefender", per: 80, count: "discarded" }], { seat: "p1" }, both, {
      discarded: ["not-a-uid", "also-not-a-uid"],
    });
    expect(both.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ dealt: 160 });
  });
});

describe("D488 §9 — `MATCH_RECORD_VERSION` stays 29, driven at the address that persists", () => {
  it("🛑 a v29 byte string with BOTH new keys absent still means what it meant", () => {
    // D473-ii's rule applied in the direction that makes the argument HARDER rather
    // than the one that dissolves it. The easy outs do not apply: the alphabet DOES
    // grow (two new optional keys) and reachability is NOT empty — `discardDeckTop`
    // rides `coinFlipGate.then` (D134) and `damageDefender` sits inside registry
    // programs, so a serialized v29 continuation really can hold either op. What is
    // true is narrower: both keys are OPTIONAL and ABSENT reproduces the prior
    // behaviour exactly, so no v29 record MEANS anything different.
    const state = table(ENERGY_DECK, ENERGY_PILE);

    // ① The v29 mill: no `recordAs`. It moves the same three cards and files NOTHING.
    const millEvents: GameEvent[] = [];
    const v29Record: { discarded?: string[] } = {};
    const milled = runProgram(state, V29_MILL, { seat: "p1" }, millEvents, v29Record);
    expect(milled.kind).toBe("done");
    expect(v29Record.discarded).toBeUndefined();
    expect(millEvents.filter((e) => e.type === "DECK_TOP_DISCARDED")).toHaveLength(1);
    if (milled.kind !== "done") throw new Error("expected done");
    expect(idsIn(milled.state, "p1", "deck")).toEqual([...ENERGY_DECK.slice(3)]);
    expect(idsIn(milled.state, "p1", "discard")).toEqual([...ENERGY_PILE, ...ENERGY_DECK.slice(0, 3)]);

    // ② The v29 scale: no `countFilter`. It counts the WHOLE slot, `.length`, exactly
    //    as it did before this slice — 3 × 80 = 240, which is §5's reading ② and is
    //    a DIFFERENT number from the filtered 80, so this rung cannot pass by accident.
    const scaleEvents: GameEvent[] = [];
    runProgram(state, V29_SCALE, { seat: "p1" }, scaleEvents, {
      discarded: [...state.players.p1.deck.slice(0, 3)],
    });
    expect(scaleEvents.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ dealt: 240 });
  });

  it("neither key is REQUIRED, and the flat arm cannot carry the new one", () => {
    // The union is where the incoherent combination is refused rather than a runtime
    // guard (`discardEnergy`'s idiom): `countFilter?: never` on the `amount` arm.
    // Asserted through the TYPE by construction — these two objects are the ones the
    // union admits, and the third is a compile error rather than a rung.
    const bare: EffectOp = { op: "discardDeckTop", whose: "self", count: 3 };
    const flat: EffectOp = { op: "damageDefender", amount: 90 };
    expect(bare).toEqual({ op: "discardDeckTop", whose: "self", count: 3 });
    expect(flat).toEqual({ op: "damageDefender", amount: 90 });
  });
});

describe("D488 §10 — the DESCRIBER obligation, resolved by following the CALL PATH", () => {
  it("🛑 neither op PARKS, so there is no caption this slice could have left incomplete", () => {
    // D478: a describer's obligation follows the call path, and D488's brief warned
    // that a §9.2 record gate is exactly the shape that DOES reach the describers. It
    // is — and this program has no gate. `withConsequence` is called only when an op
    // PARKS, `describeBranch` only from `recordGate.then`, and neither of these two ops
    // parks or is a gate. The whole swing runs to `done` with no prompt at all, which
    // is what makes the absence of a caption a FACT rather than an omission.
    const events: GameEvent[] = [];
    const run = runProgram(table(ENERGY_DECK, ENERGY_PILE), ENERGY_PROGRAM, { seat: "p1" }, events);
    expect(run.kind).toBe("done");
    const misty: GameEvent[] = [];
    expect(runProgram(table(MISTY_DECK, MISTY_PILE), MISTY_PROGRAM, { seat: "p1" }, misty).kind).toBe("done");
    // …and on the real board the state is never left pending either.
    const { state: done } = swing(table(MISTY_DECK, MISTY_PILE), MISTY_SWING);
    expect(done.pending).toEqual([]);
    expect(done.phase.kind).toBe("turn:action");
  });
});

describe("D488 §11 — the LOUD control, and the neighbours that must not have moved", () => {
  it("a residue sentence on the SAME card still flags ATTACK_EFFECT_SKIPPED", () => {
    // What makes "no `ATTACK_EFFECT_SKIPPED`" mean something everywhere above. Its
    // refusal is asserted live off the module (D480) rather than assumed.
    expect(readersClaiming(LOUD)).toEqual([]);
    expect(resolvedByAnyReader(LOUD)).toBe(false);
    const { events } = swing(table(ENERGY_DECK, ENERGY_PILE), LOUD_SWING);
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("an attack with NO effect text touches neither deck nor pile", () => {
    // The third silence: index 2 prints a damage box and nothing else, so it is the
    // control that says the mill belongs to the SENTENCE and not to the swing.
    const { state: done, events } = swing(table(ENERGY_DECK, ENERGY_PILE), PLAIN_CUFF);
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
    expect(idsIn(done, "p1", "deck")).toEqual([...ENERGY_DECK]);
    expect(idsIn(done, "p1", "discard")).toEqual([...ENERGY_PILE]);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(10);
  });

  it("the bare MILL sentence is unchanged — it neither records nor scales", () => {
    // `DECK_TOP_MILL`'s 16 printings are the population this widening had to leave
    // alone, and the assertion is the OP rather than the board: an emitted `recordAs`
    // here would be an inert key on every one of them.
    expect(deriveAttackEffect(BARE_MILL)).toEqual([{ op: "discardDeckTop", whose: "self", count: 3 }]);
    expect(deriveAttackEffect("Discard the top card of your opponent's deck.")).toEqual([
      { op: "discardDeckTop", whose: "opponent", count: 1 },
    ]);
  });
});
