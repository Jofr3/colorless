import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { EffectOp } from "./effects";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
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
  types,
} from "./testFixtures";

// 0.381.0 → 0.382.0 — 🆕🆕🆕 D487: THE DECK'S OTHER END.
//
//   file line 143 (1 printing)   "Draw 3 cards from the bottom of your deck."
//
// 1 sentence / 1 legal printing over `legalAttackCorpus()`'s 640 / 1,732. The carrier id
// is UNRESOLVED and is stated as such rather than invented — this checkout has no D1
// (D425's standing limitation).
//
// 🛑 **THIS SLICE STARTED AS A MEASUREMENT AND THE MEASUREMENT KILLED ITS OWN PREMISE.**
// The work order handed this row over as one of THREE deferred *"specifically because
// building them would move `MATCH_RECORD_VERSION`"*, and priced this one at *"a source the
// op cannot name … also an op field on `drawCards`"* — the field half is right and **the
// price is wrong**. `apps/api/src/lobby/match.ts`'s own discriminator is *"WOULD AN OLD
// RECORD MEAN SOMETHING ELSE, not IS THE TYPE STILL ASSIGNABLE"* (D335), with *"a WIDENING
// is free and a RENAME is not"* (D359) and *"widening an enum is not a bump; adding a
// REQUIRED key always is"* (D326). An OPTIONAL field whose ABSENCE reproduces the
// pre-slice behaviour is the first of those, not the third. §8 drives it rather than
// arguing it, **at an address that really does persist** — D473-ii's rule, *"a rule that
// turns on persistence must be applied at an address that persists"*, applied in the
// direction that makes the argument HARDER: `drawCards` never parks, but it rides
// `recordGate.then` behind `payFromHand`, which does, so a v29 record genuinely can hold
// this op and the no-bump claim has to be earned rather than dodged.
//
// 🛑 **THE COMPOSITION QUESTION, ASKED FIRST AND DRIVEN (D482).** Seven shipped ops touch
// deck ORDER — `shuffleDeck`, `bottomDeckTop`, `reorderTop`, `lookAtTopN`, `discardDeckTop`,
// `attachFromTop`, `searchDeck` — and the near-miss is `bottomDeckTop { n }`, which moves
// the top `n` UNDER the deck and would surface the bottom three for a plain `drawCards`.
// It fails for TWO independent reasons and §5 drives both: the `n` it needs is
// `deck.length − 3`, a number no printed sentence carries and no op can compute, and the
// op **SHUFFLES its window** (its own doc block: *"an RNG consumer, which only one other
// `EffectOp` is"*), so the composition destroys the very order it was reached for.
//
// 🛑 **AND THE COUNTERWEIGHT FIRED, IN D486's ARITHMETIC-IDENTITY FORM RATHER THAN AS A
// BOARD COINCIDENCE.** Both ends of the deck share ONE cut — `max(0, deck.length − count)`
// — so on a deck of `count` OR FEWER the two arms take **the same cards in the same order,
// leave the same deck and emit the same event**: a shallow deck cannot separate a bottom
// draw from a top one AT ALL. §7 computes FIVE candidate readings as pure functions and
// shows the collision growing as the deck shrinks — **at 4 cards all five differ, at 3
// three collide, at 2 four collide, and at ONE CARD ALL FIVE ARE BYTE-IDENTICAL.** The
// board this file attacks on is therefore a deck of EIGHT, chosen from that table rather
// than from taste; a suite that reached for a small deck would have been green for
// nothing.
//
// ⚠️ **WHAT THIS SLICE COST, NAMED AS ZEROES SO THE CLAIM IS CHECKABLE:** ONE new anchor,
// ONE new `deriveAttackEffect` arm, ONE OPTIONAL key on a shipped op (`drawCards.from`),
// ONE optional parameter on `drawToHand`, and ONE widened `describeBranch` case. **ZERO**
// new `EffectOp` members, prompts, prompt fields, choice kinds, parks, events, error codes,
// `GameState`/`InPlayPokemon` fields, `BoardCondition`/`CardFilter`/`DamageCountSource`
// members, readers (the surface stands still at **13**), registry rows, `FIXTURE_POOL` ids
// (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes and
// **`MATCH_RECORD_VERSION` bytes**.
//
// SEED-FREE: neither the draw nor anything on these boards consumes RNG. The one seed
// below feeds setup's shuffle, and every board rebuilds the deck under test outright.

/** The printed sentence, byte for byte off `legalAttackCorpus()` (§1 asserts it, so a
    re-ingest disagrees with this line rather than with a number). */
const BOTTOM = "Draw 3 cards from the bottom of your deck.";
/** Its shipped SIBLING — the same count off the other end, `ATTACK_DRAW`'s twelve-printing
    reading. The nearest wrong sibling of this slice's arm, and a REAL printed sentence
    rather than a constructed one. */
const TOP = "Draw 3 cards.";
/** A residue sentence no reader claims, fielded as the LOUD control: it is what makes
    "no `ATTACK_EFFECT_SKIPPED`" mean something on the boards where nothing is drawn. Its
    refusal is asserted live in §9 rather than assumed (D480). */
const LOUD = "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.";

const PROGRAM: readonly EffectOp[] = [{ op: "drawCards", count: 3, from: "bottom" }];
/** The v29 byte string: the SAME op with the key absent. §8 reads it back. */
const V29_PROGRAM: readonly EffectOp[] = [{ op: "drawCards", count: 3 }];

const SEED = 20260908;

// ── The board (D414: a file-local `cardPool`, no `FIXTURE_POOL` id). ─────────────────
const BOTTOM_DEAL = 0;
const TOP_DEAL = 1;
const NO_EFFECT_AT_ALL = 2;
const LOUD_INDEX = 3;

/** `d487-*` keys with no catalog row behind them (D425). The eight `d487-c<N>` cards are
    DISTINCT ids rather than eight copies of one, because every figure in this file is a
    statement about WHICH cards moved and in WHAT ORDER — a deck of identical cards makes
    all five candidate readings of §7 answer the same thing and every rung here vacuous. */
const BOTTOM_CARDS: Record<string, Card> = {
  "d487-diver": battler("d487-diver", {
    name: "D487 Diver",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Bottom Deal", effect: BOTTOM },
      { cost: ["Colorless"], name: "Top Deal", effect: TOP },
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
      { cost: ["Colorless"], name: "Borrowed Blow", effect: LOUD },
    ],
  }),
  /** The defender. Big enough that nothing here Knocks it Out — index 2 prints a damage
      box, and a KO would end the batch before a deck could be read. */
  "d487-wall": battler("d487-wall", { name: "D487 Wall", types: ["Colorless"], hp: 340 }),
  "d487-c1": basicEnergy("d487-c1"),
  "d487-c2": basicEnergy("d487-c2"),
  "d487-c3": basicEnergy("d487-c3"),
  "d487-c4": basicEnergy("d487-c4"),
  "d487-c5": basicEnergy("d487-c5"),
  "d487-c6": basicEnergy("d487-c6"),
  "d487-c7": basicEnergy("d487-c7"),
  "d487-c8": basicEnergy("d487-c8"),
};

const BOTTOM_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...BOTTOM_CARDS };

/** Its own deck (D270/D412), 60 counted before the first run:
    10 + 10 + 8×5 = 60. */
const BOTTOM_DECK = deckOf({
  "d487-diver": 10,
  "d487-wall": 10,
  "d487-c1": 5,
  "d487-c2": 5,
  "d487-c3": 5,
  "d487-c4": 5,
  "d487-c5": 5,
  "d487-c6": 5,
  "d487-c7": 5,
  "d487-c8": 5,
});

/** 🛑 **THE BOARD DECK, TOP FIRST — EIGHT CARDS, AND ITS DEPTH IS COMPUTED IN §7 RATHER
    THAN CHOSEN.** The three at the END are what this sentence takes; the five in front of
    them are what a top draw would take, and the file asserts both. */
const BOARD_DECK = [
  "d487-c1",
  "d487-c2",
  "d487-c3",
  "d487-c4",
  "d487-c5",
  "d487-c6",
  "d487-c7",
  "d487-c8",
] as const;
const BOTTOM_THREE = ["d487-c6", "d487-c7", "d487-c8"] as const;
const TOP_THREE = ["d487-c1", "d487-c2", "d487-c3"] as const;

function openTable(first: Seat): GameState {
  const created = createGame({ seed: SEED, decks: { p1: BOTTOM_DECK, p2: BOTTOM_DECK }, cardPool: BOTTOM_POOL });
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

/** Rebuild `seat`'s DECK outright, in the exact order named, and send every card the
    setup shuffle dealt into that deck to the DISCARD instead. The deck IS the zone under
    test here, so a residual card at an unknown depth would move a figure silently — the
    same reason `opponentHandSweep.test.ts` rebuilds a hand. */
function withDeck(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  const pool = [...side.deck];
  const picked: string[] = [];
  for (const id of ids) {
    const at = pool.findIndex((uid) => state.cardIdByUid[uid] === id);
    if (at < 0) throw new Error(`${seat} deck has no ${id}`);
    const [uid] = pool.splice(at, 1);
    if (uid === undefined) throw new Error("splice returned nothing");
    picked.push(uid);
  }
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, deck: picked, discard: [...side.discard, ...pool] } },
  };
}

/** p1 owns TURN 2 with the Diver Active and `deck` as its whole library, in order. */
function table(deck: readonly string[] = BOARD_DECK, attacker: Seat = "p1"): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d487-diver");
  state = setActiveFromDeck(state, defender, "d487-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = attachFromDeck(state, attacker, "d487-c1", 1);
  return withDeck(state, attacker, deck);
}

/** The card id behind a uid, off the two persisted maps the state carries. */
function idOf(uid: string, state: GameState): string {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
}
const idsIn = (state: GameState, seat: Seat, zone: "hand" | "deck" | "discard"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state));

function swing(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}
function find<T extends GameEvent["type"]>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The draws THIS SENTENCE caused: `reason: "effect"` on the attacking seat. An attack
    ends the turn, so every batch below also carries the OPPONENT's turn-start draw — a
    rung that merely asked whether `CARDS_DRAWN` is absent would be green on a build that
    drew for the wrong seat. */
const effectDraws = (events: GameEvent[]): GameEvent[] =>
  events.filter((e) => e.type === "CARDS_DRAWN" && e.reason === "effect" && e.seat === "p1");

/** 🛑 **THE FIVE CANDIDATE READINGS, AS PURE FUNCTIONS OF THE DECK.** Written BEFORE any
    board is chosen (D484) so §7 can prove the board separates them rather than hoping it
    does. Each answers `[handGained, deckLeft]`. */
type Reading = (deck: readonly string[], count: number) => readonly [readonly string[], readonly string[]];
const READINGS: Record<string, Reading> = {
  /** ① SHIPPED — the bottom `count`, in DECK order, cut off the bottom. */
  bottomInDeckOrder: (deck, count) => {
    const cut = Math.max(0, deck.length - count);
    return [deck.slice(cut), deck.slice(0, cut)];
  },
  /** ② THE NEAREST WRONG SIBLING — the top `count`. What `from` being dropped means. */
  top: (deck, count) => [deck.slice(0, count), deck.slice(count)],
  /** ③ the bottom `count`, BOTTOM-MOST FIRST — the other reading of the printed words,
      separated from ① only by the ORDER cards enter the hand. */
  bottomReversed: (deck, count) => {
    const cut = Math.max(0, deck.length - count);
    return [[...deck.slice(cut)].reverse(), deck.slice(0, cut)];
  },
  /** ④ THE HALF-CONVERTED BUILD — draws the bottom and cuts the TOP. The shape of a
      change that threaded `from` into the slice and forgot the splice. */
  bottomDrawTopCut: (deck, count) => {
    const cut = Math.max(0, deck.length - count);
    return [deck.slice(cut), deck.slice(count)];
  },
  /** ⑤ THE UNFLOORED CUT — `deck.slice(deck.length - count)` with a negative index, which
      on a shallow deck silently takes the WHOLE deck from the wrong end. */
  unfloored: (deck, count) => [deck.slice(deck.length - count), deck.slice(0, deck.length - count)],
};
const answer = (name: string, deck: readonly string[], count: number): string => {
  const reading = READINGS[name];
  if (reading === undefined) throw new Error(`no reading ${name}`);
  return JSON.stringify(reading(deck, count));
};

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED DATA, MEASURED OVER THE POPULATION (D423)
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §1 — the sentence and its family, measured rather than quoted", () => {
  it("the printed sentence is IN the legal attack column at exactly 1 printing", () => {
    const row = legalAttackCorpus().find(([, sentence]) => sentence === BOTTOM);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
  });

  it("🛑 it is the ONLY printed draw in the whole 640-row column that names a SOURCE", () => {
    // ⚠️ THE PATTERN, PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D428): every corpus row
    // that mentions either end of a deck. What it CANNOT see: a sentence that names an end
    // some other way ("the last card of your deck"), and a draw whose source is implied by
    // an earlier clause. TWO rows in 640, and only one of them is a DRAW — the other puts
    // a card on the bottom of the OPPONENT's deck and has been built since D232.
    const ends = legalAttackCorpus().filter(([, s]) => /bottom of|top of (?:your|their) deck/.test(s));
    expect(ends.map(([n, s]) => `${String(n)} ${s}`).sort()).toEqual(
      [
        "1 Draw 3 cards from the bottom of your deck.",
        "1 Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
      ].sort(),
    );
    // …and the whole DRAW family beside it, so "the only one" is a measurement rather
    // than a claim: every corpus row whose first word is `Draw`.
    const draws = legalAttackCorpus().filter(([, sentence]) => sentence.startsWith("Draw "));
    expect(draws.map(([n, sentence]) => `${String(n)} ${sentence}`).sort()).toEqual(
      [
        "1 Draw 3 cards from the bottom of your deck.",
        "1 Draw cards until you have 7 cards in your hand.",
        "2 Draw 3 cards.",
        "2 Draw 4 cards.",
        "22 Draw a card.",
        "9 Draw 2 cards.",
      ].sort(),
    );
    // …and the SOURCE-naming share of that family is one row in six, 1 printing in 37.
    expect(draws.reduce((sum, [n]) => sum + n, 0)).toBe(37);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — BUILD STATE, WITH THE ORACLE THIS SURFACE ACTUALLY HAS (D480)
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §2 — the thirteen readers, run rather than read", () => {
  it("🛑 EXACTLY ONE of the 13 readers claims it, and it is `deriveAttackEffect`", () => {
    // `programFor` is not the oracle for an ATTACK sentence — `refusedPrintings.ts`'s own
    // limit 1 says so and the table deliberately carries no `"attack"` surface. The oracle
    // is the reader surface, run programmatically against the printed string.
    const surface = attackReaderSurface();
    expect(surface).toHaveLength(13);
    // The surface is a list of NAMES; the readers themselves come off the module, which
    // is `residue-census.ts`'s own move — a name lookup that missed would yield
    // `undefined`, and `undefined !== null` is TRUE, so every reader would "claim"
    // everything. Resolved by VALUE: only entries that are functions are asked.
    const claimers = surface.filter((name) => {
      const read = (effects as Record<string, unknown>)[name];
      if (typeof read !== "function") throw new Error(`reader ${name} is not a function`);
      return (read as (t: string) => unknown)(BOTTOM) != null;
    });
    expect(claimers).toEqual(["deriveAttackEffect"]);
    // …and `resolvedByAnyReader`, the census's own predicate, agrees.
    expect(resolvedByAnyReader(BOTTOM)).toBe(true);
  });

  it("🛑 and NEITHER SPLITTER reaches it, so the row leaves the residue by the READER arm", () => {
    // The census subtracts four ways (reader, registry, gate splitter, trailing splitter).
    // A row freed by a splitter is a head-plus-tail claim, not an end-to-end one; this one
    // is claimed whole, and the difference is what makes §6's board mean anything.
    expect(splitAttackGateClause(BOTTOM)).toBeNull();
    expect(splitAttackTrailingClause(BOTTOM)).toBeNull();
  });

  it("the derived program is the op, the count and the end — nothing else", () => {
    expect(deriveAttackEffect(BOTTOM)).toEqual(PROGRAM);
    // …and the SIBLING still derives to the un-keyed op, which is the whole no-bump claim
    // in one line: the twelve printings that were authored before this slice are byte
    // identical after it.
    expect(deriveAttackEffect(TOP)).toEqual(V29_PROGRAM);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — WHAT THE ANCHOR CLAIMS OVER ALL 640 ROWS, AND WHAT EVERY WIDENING WOULD (D472)
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §3 — the yield, and five widenings that buy nothing", () => {
  it("🛑 the anchor claims EXACTLY this row — 1 sentence / 1 printing over 640", () => {
    const claimed = legalAttackCorpus().filter(([, s]) => {
      const program = deriveAttackEffect(s);
      return program?.some((op) => op.op === "drawCards" && op.from === "bottom") === true;
    });
    expect(claimed.map(([, s]) => s)).toEqual([BOTTOM]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(1);
  });

  it("🛑 EVERY widening of the anchor claims the IDENTICAL 1 / 1 — measured, not argued", () => {
    // D473's finding at a second address: a widening that claims the same rows buys
    // nothing and costs a wrong program. All five are asked over the whole column.
    const column = legalAttackCorpus();
    const yields = (re: RegExp): string => JSON.stringify(column.filter(([, s]) => re.test(s)).map(([, s]) => s));
    const mine = JSON.stringify([BOTTOM]);
    // ① a singular alternation, `ATTACK_DRAW`'s own shape;
    expect(yields(/^Draw (?:(\d+) cards|a card) from the bottom of your deck\.$/)).toBe(mine);
    // ② either end of the deck;
    expect(yields(/^Draw (\d+) cards from the (?:top|bottom) of your deck\.$/)).toBe(mine);
    // ③ either owner;
    expect(yields(/^Draw (\d+) cards from the bottom of (?:your|their) deck\.$/)).toBe(mine);
    // ④ an unanchored tail — the shape that reads a compound sentence as its first clause;
    expect(yields(/^Draw (\d+) cards from the bottom of your deck\./)).toBe(mine);
    // ⑤ an unanchored head.
    expect(yields(/Draw (\d+) cards from the bottom of your deck\.$/)).toBe(mine);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE ONE-AXIS REFUSALS (D484: every rung differs from its control in ONE axis)
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §4 — the axes, refused independently", () => {
  it("🛑 the SOURCE alone: `top` is the un-keyed op's reading and must not be spelled", () => {
    // The control is the shipped sentence one token away. A widened `(?:top|bottom)` would
    // derive `from: "top"` — a value the op does not carry and the interpreter would read
    // as "not bottom", i.e. correct by accident on a spelling nothing prints.
    expect(deriveAttackEffect("Draw 3 cards from the top of your deck.")).toBeNull();
    expect(deriveAttackEffect(BOTTOM)).toEqual(PROGRAM);
  });

  it("🛑 the OWNER alone, both spellings — you never draw off the other seat's deck", () => {
    expect(deriveAttackEffect("Draw 3 cards from the bottom of your opponent's deck.")).toBeNull();
    expect(deriveAttackEffect("Draw 3 cards from the bottom of their deck.")).toBeNull();
  });

  it("the ARTICLE alone — no singular branch, because no printing spells one (D104)", () => {
    // `ATTACK_DRAW` carries `(?:(\d+) cards|a card)` because BOTH spellings are printed.
    // Here only the plural is, so a singular branch would invent a `1` no census reaches
    // and no mutant can kill — D231's unkillable-arm test on an alternation.
    expect(deriveAttackEffect("Draw a card from the bottom of your deck.")).toBeNull();
    expect(legalAttackCorpus().some(([, s]) => s === "Draw a card from the bottom of your deck.")).toBe(false);
  });

  it("the COUNT alone — 0 is refused by the family's `>= 1` guard, 1 and 5 are read", () => {
    expect(deriveAttackEffect("Draw 0 cards from the bottom of your deck.")).toBeNull();
    expect(deriveAttackEffect("Draw 1 cards from the bottom of your deck.")).toEqual([
      { op: "drawCards", count: 1, from: "bottom" },
    ]);
    expect(deriveAttackEffect("Draw 5 cards from the bottom of your deck.")).toEqual([
      { op: "drawCards", count: 5, from: "bottom" },
    ]);
  });

  it("🛑 the ANCHORING alone, both ends — a compound sentence is not read as its head", () => {
    expect(deriveAttackEffect(`${BOTTOM} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackEffect(`Discard your hand. ${BOTTOM}`)).toBeNull();
    expect(deriveAttackEffect("Draw 3 cards from the bottom of your deck")).toBeNull();
  });

  it("🛑 the two anchors are STRUCTURALLY disjoint, so neither owes the other a guard", () => {
    // D467's first preference. `ATTACK_DRAW` ends at `\.$` right after its count and cannot
    // reach a string that continues; this one cannot reach a string that stops. Asserted
    // from BOTH sides, so the ORDER of the two arms is legibility rather than behaviour.
    expect(deriveAttackEffect(TOP)).toEqual(V29_PROGRAM);
    expect(deriveAttackEffect(BOTTOM)).not.toEqual(V29_PROGRAM);
    expect(BOTTOM.startsWith(TOP.slice(0, -1))).toBe(true);
    expect(TOP.endsWith(".")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE COMPOSITION QUESTION, DRIVEN (D482)
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §5 — no composition of shipped ops spells a bottom draw", () => {
  it("🛑 `bottomDeckTop` + `drawCards` needs a number no sentence carries, and SHUFFLES", () => {
    // The near-miss, driven rather than dismissed. Rotating the bottom three to the top
    // needs `n = deck.length − 3`; the op's `n` is a printed literal on an authored row,
    // and no printed sentence carries a deck size. Even given the number, the op shuffles
    // its own window (its doc block: "an RNG consumer") — so the composition destroys the
    // order it was reached for. DRIVEN: run it and watch the deck.
    const state = table();
    const events: GameEvent[] = [];
    const rotated = runProgram(
      state,
      [{ op: "bottomDeckTop", n: 5 }, { op: "drawCards", count: 3 }],
      { seat: "p1" },
      events,
    );
    const hand = idsIn(rotated.state, "p1", "hand").slice(-3);
    // The three cards DO arrive — and the deck underneath them is no longer the deck the
    // sentence left alone: the five rotated cards are in RNG order, not printed order.
    expect(hand.slice().sort()).toEqual([...BOTTOM_THREE].sort());
    expect(idsIn(rotated.state, "p1", "deck")).not.toEqual([...TOP_THREE, "d487-c4", "d487-c5"]);
    // …while the shipped arm leaves the survivors in their printed order.
    const straight: GameEvent[] = [];
    const drawn = runProgram(state, PROGRAM, { seat: "p1" }, straight);
    expect(idsIn(drawn.state, "p1", "deck")).toEqual([...TOP_THREE, "d487-c4", "d487-c5"]);
  });

  it("the RNG is the separating fact, and it is measured on `rngState` rather than argued", () => {
    const state = table();
    const a: GameEvent[] = [];
    const rotated = runProgram(state, [{ op: "bottomDeckTop", n: 5 }], { seat: "p1" }, a);
    expect(rotated.state.rngState).not.toBe(state.rngState);
    const b: GameEvent[] = [];
    const drawn = runProgram(state, PROGRAM, { seat: "p1" }, b);
    expect(drawn.state.rngState).toBe(state.rngState);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE BOARD: the op MEANS something (three cards, and WHICH three)
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §6 — the printed sentence on a real board", () => {
  it("🛑 the BOTTOM three arrive, in DECK order, and the top five are untouched", () => {
    const before = table();
    expect(idsIn(before, "p1", "deck")).toEqual([...BOARD_DECK]);
    const handBefore = idsIn(before, "p1", "hand");
    const { state, events } = swing(before, BOTTOM_DEAL);
    expect(idsIn(state, "p1", "hand")).toEqual([...handBefore, ...BOTTOM_THREE]);
    expect(idsIn(state, "p1", "deck")).toEqual([...TOP_THREE, "d487-c4", "d487-c5"]);
    // …and the EVENT names them, in the same order, so the log and the zone agree.
    const drawn = find(events, "CARDS_DRAWN");
    expect(drawn?.seat).toBe("p1");
    expect(drawn?.uids.map((uid) => idOf(uid, state))).toEqual([...BOTTOM_THREE]);
    expect(drawn?.reason).toBe("effect");
  });

  it("🛑 `recordAs` FILES THE END THE OP NAMED, not the top three that never moved", () => {
    // D311's §9.2 slot is read off the deck BEFORE the draw, by the same slice the draw
    // performs — so the moment the draw grew an end, the record had to follow it. The
    // defect is invisible to every rung above: a bottom draw whose RECORD slices the top
    // still moves the right three cards and still fires any gate behind it (three filed
    // is three filed). Only the uids differ, so only the uids can catch it.
    const record: Record<string, readonly string[]> = {};
    const run = runProgram(
      table(),
      [{ op: "drawCards", count: 3, from: "bottom", recordAs: "moved" }],
      { seat: "p1" },
      [],
      record,
    );
    expect(run.kind).toBe("done");
    expect((record.moved ?? []).map((uid) => idOf(uid, run.state))).toEqual([...BOTTOM_THREE]);
    // …and the control, one axis away: the same op with the key absent files the TOP three.
    const topRecord: Record<string, readonly string[]> = {};
    const topRun = runProgram(
      table(),
      [{ op: "drawCards", count: 3, recordAs: "moved" }],
      { seat: "p1" },
      [],
      topRecord,
    );
    expect((topRecord.moved ?? []).map((uid) => idOf(uid, topRun.state))).toEqual([...TOP_THREE]);
  });

  it("🛑 THE NEAREST WRONG SIBLING, ON THE SAME BOARD — the top three, and it is PRINTED", () => {
    // Index 1 prints "Draw 3 cards." — the shipped twelve-printing reading. Same board,
    // same count, one axis: which end. If this rung and the one above ever agree, the
    // slice has bought nothing.
    const before = table();
    const handBefore = idsIn(before, "p1", "hand");
    const { state } = swing(before, TOP_DEAL);
    expect(idsIn(state, "p1", "hand")).toEqual([...handBefore, ...TOP_THREE]);
    expect(idsIn(state, "p1", "deck")).toEqual(["d487-c4", "d487-c5", ...BOTTOM_THREE]);
  });

  it("the two arms take DISJOINT card sets on this board, which is what makes it a board", () => {
    const bottom = idsIn(swing(table(), BOTTOM_DEAL).state, "p1", "hand");
    const top = idsIn(swing(table(), TOP_DEAL).state, "p1", "hand");
    expect(bottom).not.toEqual(top);
    expect(BOTTOM_THREE.some((id) => TOP_THREE.includes(id as never))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE COUNTERWEIGHT: five readings, and the depth at which they collide (D486)
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §7 — the collision table, computed before the board was chosen", () => {
  const distinct = (deck: readonly string[]): number =>
    new Set(Object.keys(READINGS).map((name) => answer(name, deck, 3))).size;

  it("🛑 NO SINGLE DEPTH SEPARATES ALL FIVE — the table is computed, and it tops out at FOUR", () => {
    // D486's finding at a new address, and the arithmetic is the whole of it. Both ends
    // share the cut `max(0, len − count)`, so the deeper the deck the more readings come
    // apart — EXCEPT ⑤, whose defect is the FLOOR and which is therefore byte-identical to
    // ① on every deck at least as deep as the count. The two collision regimes are
    // COMPLEMENTARY: a deep board separates ① from ②③④ and cannot see ⑤; a two-card board
    // separates ① from ⑤ and cannot see ② or ④. **This file fields BOTH, and either alone
    // would have made half of it vacuous.**
    expect([0, 1, 2, 3, 4, 5, 8].map((n) => distinct(BOARD_DECK.slice(0, n)))).toEqual([
      1, 1, 3, 2, 4, 4, 4,
    ]);
  });

  it("🛑 AT A ONE-CARD DECK ALL FIVE ARE BYTE-IDENTICAL — no board there separates anything", () => {
    // An ARITHMETIC identity rather than a board coincidence: the cut is 0 whenever the
    // deck is no deeper than the count, so every reading takes the whole deck in the one
    // order it has. A suite that reached for a small deck would have been green for
    // nothing at all — which is exactly why §6 attacks on EIGHT.
    expect(new Set(Object.keys(READINGS).map((name) => answer(name, ["d487-c1"], 3))).size).toBe(1);
    expect(distinct([])).toBe(1);
  });

  it("🛑 THE ONE THAT MATTERS: ① and ② collide at THREE and part at FOUR", () => {
    // The nearest wrong sibling — a dropped `from` — is INVISIBLE on any deck of three or
    // fewer. Four is the first depth at which the defect this whole slice is about can
    // fail a board, and the file's is eight.
    for (const n of [0, 1, 2, 3]) {
      const shallow = BOARD_DECK.slice(0, n);
      expect(answer("bottomInDeckOrder", shallow, 3), String(n)).toBe(answer("top", shallow, 3));
    }
    for (const n of [4, 5, 8]) {
      const deep = BOARD_DECK.slice(0, n);
      expect(answer("bottomInDeckOrder", deep, 3), String(n)).not.toBe(answer("top", deep, 3));
    }
  });

  it("🛑 AND THE UNFLOORED CUT IS THE MIRROR IMAGE — invisible at EVERY depth but ONE", () => {
    // ⑤ is `deck.slice(deck.length − count)` without the floor: a real defect, and the
    // deep board this file needs for ② cannot see it, because a non-negative index makes
    // it the SAME EXPRESSION as ①. With count 3 it is observable at exactly one depth —
    // TWO — where the negative index takes one card off the wrong end. **A defect whose
    // only witness is the board every other rung calls degenerate.**
    const separating = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((n) => {
      const deck = BOARD_DECK.slice(0, n);
      return answer("bottomInDeckOrder", deck, 3) !== answer("unfloored", deck, 3);
    });
    expect(separating).toEqual([2]);
  });

  it("🛑 the ENGINE agrees with reading ① on the deep board and with BOTH on the shallow one", () => {
    // The pure table above is only worth something if the engine is on it. Driven at both
    // depths through the real attack, not through `runProgram`.
    const deep = swing(table(), BOTTOM_DEAL).state;
    const shipped = READINGS.bottomInDeckOrder;
    if (shipped === undefined) throw new Error("no reading ①");
    const [gainedDeep, leftDeep] = shipped(BOARD_DECK, 3);
    expect(idsIn(deep, "p1", "deck")).toEqual([...leftDeep]);
    expect(idsIn(deep, "p1", "hand").slice(-3)).toEqual([...gainedDeep]);
    // …and on a three-card deck the two PRINTED sentences become indistinguishable: same
    // hand, same empty deck. The identity is REAL, not a gap in this file.
    const shallow = BOARD_DECK.slice(0, 3);
    const viaBottom = swing(table(shallow), BOTTOM_DEAL).state;
    const viaTop = swing(table(shallow), TOP_DEAL).state;
    expect(idsIn(viaBottom, "p1", "hand")).toEqual(idsIn(viaTop, "p1", "hand"));
    expect(idsIn(viaBottom, "p1", "deck")).toEqual([]);
    expect(idsIn(viaTop, "p1", "deck")).toEqual([]);
  });

  it("🛑 the ENGINE is on ① and NOT on ⑤ at the one depth that tells them apart", () => {
    // The floor, driven on the board that can see it. Two cards, a three-card draw: the
    // shipped arm takes BOTH and empties the deck; the unfloored sibling would take one.
    const shallow = BOARD_DECK.slice(0, 2);
    const { state } = swing(table(shallow), BOTTOM_DEAL);
    const one = READINGS.bottomInDeckOrder;
    const five = READINGS.unfloored;
    if (one === undefined || five === undefined) throw new Error("missing reading");
    expect(idsIn(state, "p1", "hand").slice(-2)).toEqual([...one(shallow, 3)[0]]);
    expect(idsIn(state, "p1", "deck")).toEqual([...one(shallow, 3)[1]]);
    expect(five(shallow, 3)[1]).not.toEqual(one(shallow, 3)[1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — `MATCH_RECORD_VERSION` STAYS 29, DRIVEN AT AN ADDRESS THAT PERSISTS
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §8 — the version question, asked at the hard address", () => {
  it("🛑 `drawCards` REALLY DOES ride a persisted continuation — the claim is not dodged", () => {
    // D473-ii: a rule that turns on persistence must be applied at an address that
    // persists. `drawCards` never parks itself, but D473's pair puts it inside
    // `recordGate.then` behind `payFromHand`, which DOES — so the op lands in
    // `state.phase`, which `MatchRecord.state` saves whole. Driven, so the no-bump
    // argument below is earned rather than inherited from "it never parks".
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(
      state,
      [
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 3, from: "bottom" }] },
      ],
      { seat: "p1" },
      events,
    );
    expect(run.kind).toBe("parked");
    // 🛑 THE CONTINUATION IS THE PERSISTED OBJECT. `settleProgram` files it into
    // `state.phase`, and `MatchRecord.state` saves `GameState` whole — so the bytes below
    // are bytes a real saved match holds. The key is IN them, which is what makes §8's
    // next rung a claim about storage rather than about a type.
    const cont = run.kind === "parked" ? run.cont : null;
    expect(JSON.stringify(cont)).toContain('"from":"bottom"');
    expect(JSON.stringify(cont)).toContain('"op":"drawCards"');
  });

  it("🛑 a v29 byte string — the SAME op with the key ABSENT — still means the TOP draw", () => {
    // This block's discriminator is "would an OLD RECORD MEAN SOMETHING ELSE", not "is the
    // type still assignable". The un-keyed op is what every deploy before this slice
    // wrote; run it and it takes the top three, exactly as it did.
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, V29_PROGRAM, { seat: "p1" }, events);
    expect(idsIn(run.state, "p1", "deck")).toEqual(["d487-c4", "d487-c5", ...BOTTOM_THREE]);
    expect(idsIn(run.state, "p1", "hand").slice(-3)).toEqual([...TOP_THREE]);
  });

  it("🛑 THE DESCRIBER SAYS THE SOURCE, AND THE OBLIGATION WAS FOUND BY FOLLOWING THE CALL PATH", () => {
    // D478: a describer's obligation follows the CALL PATH, not the arm that authored the
    // op. `describeBranch` has had a `drawCards` case since §9.2 shipped, and it is
    // reached from `withConsequence` — a PARKING op that records, with a `recordGate`
    // behind it. So the moment `drawCards` grew an end, that caption could say less than
    // the program does. D473's finding exactly: a reader can be correct while its
    // describer quietly drops a clause, and only the describer is user-visible.
    const parked = (from: "bottom" | undefined): string => {
      const draw: EffectOp =
        from === undefined ? { op: "drawCards", count: 3 } : { op: "drawCards", count: 3, from };
      const run = runProgram(
        table(),
        [
          { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          { op: "recordGate", slot: "paid", then: [draw] },
        ],
        { seat: "p1" },
        [],
      );
      if (run.kind !== "parked") throw new Error("expected a park");
      return run.prompt.note;
    };
    expect(parked("bottom")).toContain("draw 3 cards from the bottom of your deck");
    // …and the control, one axis away: the same park with the key absent captions the
    // twelve-printing reading, with no source at all.
    expect(parked(undefined)).toContain("draw 3 cards");
    expect(parked(undefined)).not.toContain("bottom");
  });

  it("the ABSENT key and an explicit top draw are the same bytes — there is no `\"top\"`", () => {
    // A `from: "top"` value would be a SECOND spelling of one state, and two spellings of
    // one state is how a wire and a reader drift apart. The union has one member and the
    // absence; the corpus and the registry are swept for the other spelling.
    expect(JSON.stringify(deriveAttackEffect(TOP))).not.toContain("from");
    for (const [, sentence] of legalAttackCorpus()) {
      expect(JSON.stringify(deriveAttackEffect(sentence) ?? [])).not.toContain('"from":"top"');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE ZERO-MATCH BOARD, and the controls that separate it from silence
// ─────────────────────────────────────────────────────────────────────────────

describe("D487 §9 — an empty deck, and three silences that are not the same silence", () => {
  it("🛑 an EMPTY deck draws NOTHING and emits no `CARDS_DRAWN` — a short draw, not a throw", () => {
    // §14.3 deck-out is a turn-START rule, so attacking on an empty deck is legal and the
    // draw simply finds nothing. The shipped arm and the sibling agree here — which is
    // exactly why this board needs the controls below to mean anything.
    const { state, events } = swing(table([]), BOTTOM_DEAL);
    expect(idsIn(state, "p1", "deck")).toEqual([]);
    // ⚠️ FILTER THE EVENT, DO NOT COUNT THE TYPE. An attack ENDS THE TURN, so the
    // opponent's own turn-start draw is in this batch — a bare `not.toContain` here
    // passes on a build that draws nothing AND on one that draws for the wrong seat.
    expect(effectDraws(events)).toEqual([]);
  });

  it("🛑 THE ATTRIBUTION CONTROL — the program RAN, so no `ATTACK_EFFECT_SKIPPED` fires", () => {
    // Without this the rung above passes on a build where the arm was never reached at
    // all, which is the vacuous-guard shape this repo keeps finding (D200 → D214).
    const { events } = swing(table([]), BOTTOM_DEAL);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // …and index 3's sentence, which NO reader claims, still reports itself as unread on
    // the same body and the same board. Two silences told apart in one board.
    const loud = swing(table([]), LOUD_INDEX);
    const skipped = find(loud.events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe(LOUD);
    expect(resolvedByAnyReader(LOUD)).toBe(false);
  });

  it("the THIRD silence: an attack printing no effect text at all reports nothing either", () => {
    // `ATTACK_EFFECT_SKIPPED` is about an effect that was PRINTED and not read. Index 2
    // prints a damage box and no effect, so it is silent for a third reason — the one that
    // makes "no skip row" on the bottom-draw index a fact about the reader rather than
    // about the event.
    const { events } = swing(table([]), NO_EFFECT_AT_ALL);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(effectDraws(events)).toEqual([]);
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("a deck SHALLOWER than the count short-draws what is there, off the same cut", () => {
    const { state, events } = swing(table(BOARD_DECK.slice(0, 2)), BOTTOM_DEAL);
    expect(idsIn(state, "p1", "deck")).toEqual([]);
    const drawn = find(events, "CARDS_DRAWN");
    expect(drawn?.uids).toHaveLength(2);
  });
});
