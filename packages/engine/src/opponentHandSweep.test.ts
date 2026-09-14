import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { matchesFilter } from "./cards";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { CardFilter, EffectOp } from "./effects";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  must,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  types,
} from "./testFixtures";

// 0.379.0 → 0.380.0 — 🆕🆕🆕 D485: THE MANDATORY FILTERED SWEEP OF THE OPPONENT'S HAND.
//
//   file line 673 (1 printing)  "Your opponent reveals their hand. Discard all Item
//                                cards and Pokémon Tool cards you find there."
//
// 1 sentence / 1 legal printing over `legalAttackCorpus()`'s 640 / 1,732. The carrier id
// is UNRESOLVED and is stated as such rather than invented — this checkout has no D1
// (D425's standing limitation).
//
// 🛑 **BUILD STATE WAS SETTLED FIRST, WITH THE ORACLE THIS SURFACE ACTUALLY HAS (D480).**
// For an ATTACK sentence `programFor` is not the oracle — `refusedPrintings.ts`'s own
// limit 1 says so in writing, and the table deliberately carries no `"attack"` surface.
// The oracle is the THIRTEEN readers off `attackReaderSurface()`, run programmatically
// against the printed string: **13 / 13 null at HEAD**, and both splitters null too, so
// the row survived every one of the census's four subtractions. §2 re-runs that.
//
// 🛑 **THE COMPOSITION QUESTION WAS ASKED FIRST AND DRIVEN, AND SO WAS D483's
// COUNTERWEIGHT** — *a composition that matches on the boards you happen to build is not
// a composition that matches.* Three shipped ops touch the opponent's hidden hand:
//   · `opponentDiscardsFromHand { count }` — a STATIC count, UNFILTERED, and answered by
//     the OPPONENT. The printed quantity here is a predicate, not a number.
//   · `randomFromOpponentHand { to }` — one card, chosen by the RNG.
//   · `bottomFromOpponentHand { filter, dest: "discard" }` — **the near-miss, and it takes
//     the same `filter` into the same pile.** 🛑 **On any board whose opponent hand holds
//     exactly ONE matching card the two are BYTE-IDENTICAL**: a single-class offer
//     auto-resolves (the M1 doctrine), so there is not even a park to separate them. That
//     is the board a suite reaches for first, and it would have made this whole file
//     vacuous. **They differ the moment the hand holds TWO matches** — this op takes both
//     and asks nothing; that one takes exactly one and PARKS to ask which. §5 fields that
//     board and DRIVES both readings rather than arguing them.
//
// 🛑 **AND THE ROW IS `COMPOUND-head`, SO D466's RULE APPLIED: DRIVE THE SPLITTER BEFORE
// PRICING.** Driven — the printed string splits at its one period into a head
// `deriveAttackEffect` has claimed since M5 (`revealOpponentHand`) and this tail, so **a
// TAIL-ONLY anchor would have freed the row through `splitAttackTrailingClause` with no
// compound anchor at all.** It was refused anyway, and §7 is that refusal driven: *"you
// find there"* is an ANAPHOR whose antecedent is the reveal, and a standalone tail arm
// would let the splitter compose it behind **any** claimed head — *"Draw 3 cards. Discard
// all Item cards and Pokémon Tool cards you find there."* would empty half the opponent's
// hand off a sentence that never revealed it. **So this row is NOT one of D466's
// "building the head does not free the row" cases; it is the opposite one — the row would
// have come free too cheaply, in the wrong direction.**
//
// ⚠️ **WHAT THIS SLICE COST, NAMED AS ZEROES SO THE CLAIM IS CHECKABLE:** ONE new
// `EffectOp` member (`discardFromOpponentHand`), ONE new anchor, ONE new
// `deriveAttackEffect` arm and ONE new `interpreter.ts` op arm. **ZERO** new `CardFilter`
// members (the printed noun phrase is `anyOf` over the shipped `item` and `toolCard`),
// readers (the surface stands still at **13**), prompts, choice kinds, events, error
// codes, `GameState` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`,
// D414), `redact.ts` bytes or `packages/schema` bytes.
//
// SEED-FREE: neither op consumes RNG. The one seed below feeds setup's shuffle, and every
// board rebuilds the hand under test outright.

/** The printed sentence, byte for byte off `legalAttackCorpus()` (§1 asserts it, so a
    re-ingest disagrees with this line rather than with a number). */
const SWEEP =
  "Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.";
/** Its two halves at the one printed period — used by §7 and by nothing else. */
const SWEEP_HEAD = "Your opponent reveals their hand.";
const SWEEP_TAIL = "Discard all Item cards and Pokémon Tool cards you find there.";

/** The printed noun phrase as a filter: `anyOf` of two SHIPPED members. */
const SWEEP_FILTER: CardFilter = {
  kind: "anyOf",
  filters: [{ kind: "item" }, { kind: "toolCard" }],
};

/** The whole derived program, written out so §3 reads the arm against a value rather
    than against a re-typed expectation. */
const SWEEP_PROGRAM: readonly EffectOp[] = [
  { op: "revealOpponentHand" },
  { op: "discardFromOpponentHand", filter: SWEEP_FILTER },
];

const SEED = 20260907;

// ── The board (D414: a file-local `cardPool`, no `FIXTURE_POOL` id). ─────────────────
const SWEEP_ATTACK = 0;
const NO_EFFECT_AT_ALL = 1;

/** `d485-*` keys with no catalog row behind them (D425).

    🛑 **THE HAND IS EIGHT DISTINCT IDS AND ITS COMPOSITION IS COMPUTED, NOT CHOSEN.**
    §5 lists six readings of the printed sentence and requires their answers to be six
    DIFFERENT numbers on this one board — D482's arithmetic-coincidence class, whose
    symptom is a control PASSING. Three Items, two Tools and two Trainers of the OTHER
    two printed subtypes is what makes that true: drop one Item and *items-only* answers
    2, colliding with *tools-only*; drop the Supporter and the Stadium and *every
    Trainer* answers 5, colliding with *correct*. **§5 computes all six answers, and both
    near-misses, off this table rather than trusting this paragraph.** */
const SWEEP_CARDS: Record<string, Card> = {
  /** The attacker. Index 0 prints the sentence; index 1 prints NO effect text at all,
      which is §6's control separating *the program ran and found nothing* from *no
      program ran* — two silences that look identical in a hand count. */
  "d485-thief": battler("d485-thief", {
    name: "D485 Thief",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Hand Sweep", effect: SWEEP },
      { cost: ["Colorless"], name: "Plain Cuff", damage: 30 },
    ],
  }),
  /** The defender. Big enough that nothing here Knocks it Out — this attack prints no
      damage box, and a KO would end the batch before the hand could be read. */
  "d485-wall": battler("d485-wall", { name: "D485 Wall", types: ["Colorless"], hp: 340 }),
  "d485-item-a": trainerCard("d485-item-a", "Item", "The first test Item."),
  "d485-item-b": trainerCard("d485-item-b", "Item", "The second test Item."),
  "d485-item-c": trainerCard("d485-item-c", "Item", "The third test Item."),
  "d485-tool-a": trainerCard("d485-tool-a", "Tool", "The first test Tool."),
  "d485-tool-b": trainerCard("d485-tool-b", "Tool", "The second test Tool."),
  /** A Supporter and a Stadium: the two OTHER printed Trainer subtypes. They are in the
      hand because `item` and `toolCard` are `trainerType` reads (cards.ts), so a build
      that tested `category === "Trainer"` alone would sweep them too — and a hand whose
      only non-matches were Energy could not tell that build from the right one. */
  "d485-sup": trainerCard("d485-sup", "Supporter", "A test Supporter."),
  "d485-stadium": trainerCard("d485-stadium", "Stadium", "A test Stadium."),
  "d485-nrg": basicEnergy("d485-nrg"),
};

const SWEEP_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SWEEP_CARDS };

/** Its own deck (D270/D412), 60 counted before the first run: 8+8+6+6+6+6+6+4+4+6. */
const SWEEP_DECK = deckOf({
  "d485-thief": 8,
  "d485-wall": 8,
  "d485-item-a": 6,
  "d485-item-b": 6,
  "d485-item-c": 6,
  "d485-tool-a": 6,
  "d485-tool-b": 6,
  "d485-sup": 4,
  "d485-stadium": 4,
  "d485-nrg": 6,
});

/** 🛑 THE LOAD-BEARING HAND. Three Items, two Tools, and three non-matching cards of
    three different kinds. Read as a POPULATION by §5 rather than as a list. */
const LOADED_HAND = [
  "d485-item-a",
  "d485-item-b",
  "d485-item-c",
  "d485-tool-a",
  "d485-tool-b",
  "d485-sup",
  "d485-stadium",
  "d485-nrg",
] as const;

/** No Item and no Tool — §6's ZERO-MATCH board. */
const BARREN_HAND = ["d485-sup", "d485-stadium", "d485-nrg"] as const;

function openTable(first: Seat): GameState {
  const created = createGame({
    seed: SEED,
    decks: { p1: SWEEP_DECK, p2: SWEEP_DECK },
    cardPool: SWEEP_POOL,
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
    table = must(applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  return table;
}

/** Rebuild `seat`'s HAND outright (`opponentHandDiscard.test.ts`'s `withHand`, needed
    here for its reason — the opponent's hand IS the zone under test, and every board
    below has to field it at an exact composition). */
function withHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, seat, id, 1);
  return next;
}

/** p1 owns TURN 2 with the Thief Active and `oppHand` in the other seat's hand.
    ⚠️ **BOTH hands are rebuilt and both benches cleared** — every figure below is a
    population over a hand, so a card the setup shuffle happened to deal would move an
    answer silently. p1's own hand is loaded with a matching pair on purpose: it is the
    board on which a SEAT-inverted build is observable at all (§5). */
function table(
  oppHand: readonly string[] = LOADED_HAND,
  attacker: Seat = "p1",
): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d485-thief");
  state = setActiveFromDeck(state, defender, "d485-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = attachFromDeck(state, attacker, "d485-nrg", 1);
  state = withHand(state, attacker, ["d485-item-a", "d485-tool-a", "d485-nrg"]);
  return withHand(state, defender, oppHand);
}

/** The card id behind a uid, off the two persisted maps the state actually carries
    (`interpreter.ts`'s own `cardOf`, spelled here because it is private there). */
function idOf(uid: string, state: GameState): string {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
}

const idsIn = (state: GameState, seat: Seat, zone: "hand" | "discard"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state)).sort();

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE CENSUS, MEASURED OVER THE POPULATION (D423)
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the sentence, and the family it lands in, measured not quoted", () => {
  it("the printed sentence is IN the legal attack column at exactly 1 printing", () => {
    const row = legalAttackCorpus().find(([, sentence]) => sentence === SWEEP);
    expect(row).toBeDefined();
    expect(row?.[0]).toBe(1);
  });

  it("🛑 the WHOLE `reveals their hand` family, printed whole and classified", () => {
    // ⚠️ THE PATTERN, PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425): every corpus row
    // containing the literal `reveals their hand`. What it CANNOT see: a sentence that
    // spells the act any other way ("have your opponent reveal their hand" — the Ability
    // column's wording, which is not this column), and a hand read that names no reveal.
    // This is `opponentHandScaling.test.ts` §-family's own sweep, re-run here because
    // this slice MOVES one of its rows out of the refused half.
    const family = legalAttackCorpus().filter(([, s]) => s.includes("reveals their hand"));
    expect(family.map(([n, s]) => `${n} ${s}`).sort()).toEqual(
      [
        "1 Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
        "1 Your opponent reveals their hand. Discard all Item cards and Pokémon Tool cards you find there.",
        "1 Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
        "2 Your opponent reveals their hand. Discard a card you find there.",
        "2 Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench.",
        "3 Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.",
        "7 Your opponent reveals their hand.",
      ].sort(),
    );
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(17);
    // 🛑 THE SHARE, RE-DERIVED RATHER THAN CARRIED. D445 claimed 5 of the 17 and left 2
    // refused; this slice claims a sixth row, so the refused remainder is ONE printing —
    // the attack-COPY sentence, which stays refused for its own re-argued reason
    // (`opponentHandScaling.test.ts` §6). Measured through the readers, not asserted.
    const refused = family.filter(([, s]) => !resolvedByAnyReader(s));
    expect(refused.map(([, s]) => s)).toEqual([
      "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
    ]);
    expect(refused.reduce((sum, [n]) => sum + n, 0)).toBe(1);
  });

  it("⚠️ NO APOSTROPHE OF EITHER CLASS on the sentence, so the BEARING census stands still", () => {
    // The sentence says *their hand* and never *your opponent's hand*, so there is no
    // `['’]` slot for a punctuation-normalising re-ingest to curl. `clauseApostrophe`'s
    // sweep moves on FIXTURE additions as well as reader ones (D425), and this slice adds
    // one fixture sentence: the prediction that it does NOT move is asserted, not assumed.
    expect(SWEEP).not.toContain("'");
    expect(SWEEP).not.toContain("’");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — BUILD STATE, AND WHAT THE ANCHOR CLAIMS OVER ALL 640 ROWS (D472/D480)
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the oracle, and the anchor's yield measured over the whole column", () => {
  it("🛑 the anchor claims EXACTLY this row — 1 sentence / 1 printing over 640", () => {
    const claimed = legalAttackCorpus().filter(([, s]) => deriveAttackEffect(s) !== null);
    const mine = claimed.filter(([, s]) => s.includes("Discard all Item cards"));
    expect(mine.map(([, s]) => s)).toEqual([SWEEP]);
    expect(mine.reduce((sum, [n]) => sum + n, 0)).toBe(1);
  });

  it("🛑 the TEMPLATED alternative claims the IDENTICAL 1 / 1, so the capture buys nothing", () => {
    // D121's warrant wants TWO printings with one token varying before a parameter is
    // justified. The wider form is MEASURED rather than argued about: over all 640 rows a
    // `^Discard all (…) cards and (…) cards you find there\.$` template — here spelled as
    // the sweep it would license, with the leading reveal kept — matches the same single
    // row. A capture with one witness is D424's shape, and it would owe a printed-noun
    // table on top.
    const WIDE =
      /^Your opponent reveals their hand\. Discard all ([A-Za-zé ]+) cards and ([A-Za-zé ]+) cards you find there\.$/;
    const wide = legalAttackCorpus().filter(([, s]) => WIDE.test(s));
    expect(wide.map(([, s]) => s)).toEqual([SWEEP]);
    expect(wide.reduce((sum, [n]) => sum + n, 0)).toBe(1);
    // …and the two captures it would have bought are exactly the two printed nouns, so
    // the equality above is a statement about the POOL and not about a lucky regex.
    const m = WIDE.exec(SWEEP);
    expect([m?.[1], m?.[2]]).toEqual(["Item", "Pokémon Tool"]);
  });

  it("the reader surface is still THIRTEEN, derived off the module", () => {
    // The oracle this slice used, pinned so a fourteenth reader cannot arrive unnoticed
    // and quietly change what "13 / 13 null" meant.
    expect(attackReaderSurface()).toHaveLength(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE ARM
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the derived program", () => {
  it("the printed sentence derives to the reveal AND the sweep, in printed order", () => {
    expect(deriveAttackEffect(SWEEP)).toEqual(SWEEP_PROGRAM);
  });

  it("🛑 the filter is `anyOf` of two SHIPPED members, and they are DISJOINT", () => {
    // ⚠️ THE DISJOINTNESS IS WHY THE PRINT NAMES BOTH, and it is asserted on CARDS rather
    // than described: `item` and `toolCard` are two values of one `trainerType` column
    // (cards.ts; D231 measured 116 Item rows and 60 Tool rows with no row both). So
    // `anyOf`'s `.some` is the only reading that pays anybody — an intersection reading
    // would sweep nothing at all, which is one of §5's six answers.
    const item = SWEEP_CARDS["d485-item-a"] as Card;
    const tool = SWEEP_CARDS["d485-tool-a"] as Card;
    const sup = SWEEP_CARDS["d485-sup"] as Card;
    expect(matchesFilter(item, { kind: "item" })).toBe(true);
    expect(matchesFilter(item, { kind: "toolCard" })).toBe(false);
    expect(matchesFilter(tool, { kind: "toolCard" })).toBe(true);
    expect(matchesFilter(tool, { kind: "item" })).toBe(false);
    expect(matchesFilter(item, SWEEP_FILTER)).toBe(true);
    expect(matchesFilter(tool, SWEEP_FILTER)).toBe(true);
    // …and the third printed Trainer subtype is NOT swept, which is the rung that
    // separates a `trainerType` read from a bare `category === "Trainer"` one.
    expect(matchesFilter(sup, SWEEP_FILTER)).toBe(false);
  });

  it("neither near-miss spelling is claimed — the anchor is the WHOLE sentence", () => {
    // The head alone still derives to the bare reveal it has derived to since M5…
    expect(deriveAttackEffect(SWEEP_HEAD)).toEqual([{ op: "revealOpponentHand" }]);
    // …and the TAIL alone is claimed by NOBODY, which is §7's whole subject.
    expect(deriveAttackEffect(SWEEP_TAIL)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE OP, DRIVEN AT UNIT LEVEL
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — `discardFromOpponentHand`, driven off a program", () => {
  it("sweeps every match out of the OPPONENT's hand and NEVER parks", () => {
    const state = table();
    const events: GameEvent[] = [];
    const result = runProgram(deepFreeze(state), SWEEP_PROGRAM, { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("the sweep must not park");
    expect(idsIn(result.state, "p2", "hand")).toEqual(
      ["d485-nrg", "d485-stadium", "d485-sup"].sort(),
    );
    expect(idsIn(result.state, "p2", "discard")).toEqual(
      ["d485-item-a", "d485-item-b", "d485-item-c", "d485-tool-a", "d485-tool-b"].sort(),
    );
    // The reveal is FIRST and the discard SECOND — the printed order, filed as two rows.
    expect(types(events)).toEqual(["HAND_REVEALED", "FORCED_HAND_DISCARD"]);
  });

  it("🛑 the CONTROLLER's own hand is untouched, on a board where it holds matches", () => {
    // The seat axis, observable only because `table()` loads p1's hand with an Item and a
    // Tool. A build that read `ctx.seat` instead of `otherSeat(ctx.seat)` would empty this
    // hand and leave the other one whole, and both halves are asserted.
    const state = table();
    const before = idsIn(state, "p1", "hand");
    const events: GameEvent[] = [];
    const result = runProgram(deepFreeze(state), SWEEP_PROGRAM, { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("the sweep must not park");
    expect(idsIn(result.state, "p1", "hand")).toEqual(before);
    expect(idsIn(result.state, "p1", "discard")).toEqual(idsIn(state, "p1", "discard"));
  });

  it("an EMPTY hand reveals honestly and discards nothing", () => {
    const state = table([]);
    const events: GameEvent[] = [];
    const result = runProgram(deepFreeze(state), SWEEP_PROGRAM, { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("the sweep must not park");
    // The reveal still fires — "they showed me nothing" is a real thing that happened at
    // the table (`revealOpponentHand`'s own rule) — and the sweep files nothing.
    expect(types(events)).toEqual(["HAND_REVEALED"]);
    expect(result.state).toBe(state);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE LOAD-BEARING BOARD: SIX READINGS, SIX DIFFERENT ANSWERS
// ─────────────────────────────────────────────────────────────────────────────

/** The six readings a builder could plausibly ship, each with the number of cards it
    takes out of `LOADED_HAND`. 🛑 **THE ANSWERS ARE DERIVED FROM THE HAND BELOW, NEVER
    TYPED** — D482's arithmetic-coincidence class, whose symptom is a control PASSING. */
const READINGS: readonly (readonly [string, CardFilter | null])[] = [
  ["correct — anyOf(item, toolCard)", SWEEP_FILTER],
  ["filter dropped — discard EVERYTHING", { kind: "anyCard" }],
  ["toolCard dropped — items only", { kind: "item" }],
  ["item dropped — tools only", { kind: "toolCard" }],
  ["category-only — every Trainer", { kind: "trainerCard" }],
  ["anyOf read as an INTERSECTION — discard nothing", null],
];

describe("§5 — the discriminating board, computed BEFORE it is asserted", () => {
  it("🛑 the six readings answer six DIFFERENT numbers on this one hand", () => {
    const cards = LOADED_HAND.map((id) => SWEEP_CARDS[id] as Card);
    const swept = READINGS.map(([, filter]) =>
      filter === null
        ? // the `.every` reading of `anyOf`: item AND tool, which no card satisfies
          cards.filter(
            (c) => matchesFilter(c, { kind: "item" }) && matchesFilter(c, { kind: "toolCard" }),
          ).length
        : cards.filter((c) => matchesFilter(c, filter)).length,
    );
    // 5 correct · 8 everything · 3 items-only · 2 tools-only · 7 every Trainer · 0
    // intersection. **SIX READINGS, SIX DIFFERENT NUMBERS**, so no pair of them can be
    // confused on this board and none of the rungs below is vacuous by coincidence.
    expect(swept).toEqual([5, 8, 3, 2, 7, 0]);
    expect(new Set(swept).size).toBe(READINGS.length);
    // ⚠️ **THE HAND IS WHAT MAKES THAT TRUE, AND IT IS ASSERTED RATHER THAN DESCRIBED.**
    // Drop one Item and *items-only* answers 2, colliding with *tools-only*; drop the
    // Supporter and the Stadium and *every Trainer* answers 5, colliding with *correct*.
    // Both near-misses are computed here so the composition of `LOADED_HAND` is a
    // MEASUREMENT of what it has to be and not a preference.
    const without = (drop: string) =>
      cards
        .filter((c) => c.id !== drop)
        .filter((c) => matchesFilter(c, { kind: "item" })).length;
    expect(without("d485-item-a")).toBe(2);
    const trainersWithoutTheOthers = cards
      .filter((c) => c.id !== "d485-sup" && c.id !== "d485-stadium")
      .filter((c) => matchesFilter(c, { kind: "trainerCard" })).length;
    expect(trainersWithoutTheOthers).toBe(5);
  });

  it("🛑 the NEAR-MISS shipped op is separated by this board, and would NOT be by a smaller one", () => {
    // D483's counterweight, driven rather than asserted. `bottomFromOpponentHand` takes
    // the SAME filter into the SAME pile, so on a ONE-MATCH hand it is byte-identical to
    // the sweep — no park, one card, same destination. Both halves are driven here.
    const ONE_MATCH = ["d485-item-a", "d485-sup", "d485-nrg"];
    for (const program of [
      SWEEP_PROGRAM,
      [{ op: "revealOpponentHand" }, { op: "bottomFromOpponentHand", filter: SWEEP_FILTER, dest: "discard" }],
    ] as readonly (readonly EffectOp[])[]) {
      const events: GameEvent[] = [];
      const result = runProgram(deepFreeze(table(ONE_MATCH)), program, { seat: "p1" }, events);
      if (result.kind !== "done") throw new Error("a one-match hand asks nobody anything");
      expect(idsIn(result.state, "p2", "discard")).toEqual(["d485-item-a"]);
      expect(idsIn(result.state, "p2", "hand")).toEqual(["d485-nrg", "d485-sup"].sort());
    }
    // 🛑 …AND ON THE LOADED HAND THEY DIVERGE IN BOTH OBSERVABLE WAYS. The sweep finishes;
    // the near-miss PARKS to ask which single card to move. That is the board this file's
    // §4 and §6 are built on, and naming it is what makes the composition refusal a
    // measurement rather than a preference.
    const near: readonly EffectOp[] = [
      { op: "revealOpponentHand" },
      { op: "bottomFromOpponentHand", filter: SWEEP_FILTER, dest: "discard" },
    ];
    const parked = runProgram(deepFreeze(table()), near, { seat: "p1" }, []);
    expect(parked.kind).toBe("parked");
    const done = runProgram(deepFreeze(table()), SWEEP_PROGRAM, { seat: "p1" }, []);
    expect(done.kind).toBe("done");
  });

  it("the real ATTACK produces the CORRECT reading's board, end to end", () => {
    const { state, events } = mustApply(table(), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    // ⚠️ READ THE DISCARD PILE, NOT THE HAND: an attack ends the turn, so the opponent has
    // already drawn for their own turn by the time this state exists. The pile is the
    // zone the sentence writes and the only one that cannot be moved by the draw.
    expect(idsIn(state, "p2", "discard")).toEqual(
      ["d485-item-a", "d485-item-b", "d485-item-c", "d485-tool-a", "d485-tool-b"].sort(),
    );
    // No park anywhere in the batch, and the turn simply ended.
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).toContain("HAND_REVEALED");
    expect(types(events)).toContain("FORCED_HAND_DISCARD");
    // …and the sentence was NOT flagged loud, which is the rung that would go red if the
    // anchor were removed while the ops stayed.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 the LOG row this op reaches, driven — D478's call-path obligation", () => {
    // ⚠️ **DESCRIBER OBLIGATIONS FOLLOW THE CALL PATH (D478), AND THIS OP REACHES A
    // DESCRIBER IT DID NOT AUTHOR.** `FORCED_HAND_DISCARD` is D426's row, written for a
    // sentence whose OWNER picked the cards; this op reaches it with a sentence where
    // nobody picked anything. The rendering is asserted rather than assumed, and the
    // number in it is the one the BOARD produced — a describer that had rendered the op's
    // printed count would have had no number to render, because this op prints none.
    const { state, events } = mustApply(table(), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    const ctx: LogContext = {
      names: { p1: "Ember", p2: "Tide" },
      state,
      elapsed: formatElapsed(0),
    };
    const rows = logFromEvents(events, ctx).filter(
      (r) => r.kind === "action" && r.segments.some((seg) => seg.text.includes("from their hand")),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined || row.kind !== "action") throw new Error("no hand-discard row");
    expect(row.segments.map((seg) => seg.text).join("")).toContain(
      "discarded 5 cards from their hand",
    );
    // …and it is filed under the SEAT THAT LOST THE CARDS, not under the attacker — the
    // row carries no `actor`, so a describer cannot derive one (D425's closed-world trap).
    expect(row.who).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE ZERO-MATCH BOARD, WITH ITS CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — zero matches, and the controls that say WHY it is silent", () => {
  it("a hand with no Item and no Tool loses NOTHING, and files no discard row", () => {
    const { state, events } = mustApply(table(BARREN_HAND), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    expect(idsIn(state, "p2", "discard")).toEqual([]);
    expect(types(events)).not.toContain("FORCED_HAND_DISCARD");
  });

  it("🛑 CONTROL ONE — the program DID run: the reveal fired on the same board", () => {
    // The first of the two silences. `HAND_REVEALED` is the op that cannot whiff, so its
    // presence separates *the sweep ran and matched nothing* from *nothing ran*.
    const { events } = mustApply(table(BARREN_HAND), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    expect(types(events)).toContain("HAND_REVEALED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 CONTROL TWO — an attack with NO effect text on the SAME board reveals nothing", () => {
    // The other silence, fielded so the two are distinguishable. Same board, same seat,
    // same hand; the only difference is the printed sentence.
    const { events } = mustApply(table(BARREN_HAND), {
      type: "attack",
      seat: "p1",
      index: NO_EFFECT_AT_ALL,
    });
    expect(types(events)).not.toContain("HAND_REVEALED");
    expect(types(events)).not.toContain("FORCED_HAND_DISCARD");
  });

  it("🛑 CONTROL THREE — one Item in the same hand and exactly one card moves", () => {
    // The silence is about the BOARD and not about the op: swap one non-match for a match
    // and the same program on the same seat files the row it withheld a moment ago.
    const { state, events } = mustApply(table(["d485-item-a", "d485-sup", "d485-nrg"]), {
      type: "attack",
      seat: "p1",
      index: SWEEP_ATTACK,
    });
    expect(idsIn(state, "p2", "discard")).toEqual(["d485-item-a"]);
    expect(types(events)).toContain("FORCED_HAND_DISCARD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE SPLITTER, DRIVEN (D466) — AND THE TAIL-ONLY ANCHOR REFUSED (D472)
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — why the compound is anchored WHOLE and not composed", () => {
  it("🛑 the printed string splits into a head that BUILDS and this tail", () => {
    // D466's rule: drive `splitAttackTrailingClause` before pricing any `COMPOUND-*` row.
    // Driven with the real string rather than reasoned from the class name.
    expect(SWEEP).toBe(`${SWEEP_HEAD} ${SWEEP_TAIL}`);
    expect(resolvedByAnyReader(SWEEP_HEAD)).toBe(true);
  });

  it("🛑 the splitter DOES compose this shape — proved on a tail that already builds", () => {
    // The counterfactual, executed: with a tail `deriveAttackEffect` claims, the same head
    // composes today. So a tail-only anchor WOULD have freed the row — the refusal below
    // is a design choice and not a limitation, and this rung is what makes that checkable.
    const composed = splitAttackTrailingClause(`${SWEEP_HEAD} Draw 3 cards.`);
    expect(composed).toEqual({ head: SWEEP_HEAD, tail: "Draw 3 cards." });
  });

  it("🛑 THE TAIL IS AN ANAPHOR, so nothing claims it alone — and nothing may", () => {
    // ⚠️ *"you find there"* points at the reveal. A standalone tail arm would let the
    // splitter compose this effect behind ANY claimed head, and the sentence below is the
    // board that would be wrong: a draw that empties half the opponent's hand. Asserted as
    // `toBeNull` in BOTH directions — the tail unread, and the bogus compound unread —
    // so the day a tail-only anchor is written this file names it.
    expect(deriveAttackEffect(SWEEP_TAIL)).toBeNull();
    const BOGUS = `Draw 3 cards. ${SWEEP_TAIL}`;
    expect(deriveAttackEffect(BOGUS)).toBeNull();
    expect(splitAttackTrailingClause(BOGUS)).toBeNull();
    expect(resolvedByAnyReader(BOGUS)).toBe(false);
  });

  it("the compound is claimed WHOLE, so neither splitter ever sees it", () => {
    // The shadow refusal: a string a reader claims is that reader's, and composition never
    // gets a look at it. Both splitters are driven, not inferred from the guard.
    expect(resolvedByAnyReader(SWEEP)).toBe(true);
    expect(splitAttackTrailingClause(SWEEP)).toBeNull();
    expect(splitAttackGateClause(SWEEP)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — `MATCH_RECORD_VERSION` STAYS 29, DRIVEN RATHER THAN QUOTED
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the persisted record cannot hold this op", () => {
  it("🛑 REACHABILITY IS EMPTY: neither op in the program can park", () => {
    // A `MatchRecord` is `{version, seed, startedAt, state, log, names}`; the only address
    // an `EffectOp` reaches is `state.phase.cont` (`{pendingOp, rest, ctx, record?}`) on an
    // `effect:choose` phase. `pendingOp` is the op that PARKED and `rest` is what queued
    // BEHIND one — so an op can be persisted only if it parks, or if something ahead of it
    // does. Both are driven here on the real boards this program can reach: every hand
    // composition in this file, run through the whole program, ends `done`.
    for (const hand of [LOADED_HAND, BARREN_HAND, [], ["d485-item-a"], ["d485-tool-a", "d485-tool-b"]]) {
      const result = runProgram(deepFreeze(table(hand)), SWEEP_PROGRAM, { seat: "p1" }, []);
      expect(result.kind, JSON.stringify(hand)).toBe("done");
    }
    // …and through the real action API, where a park would surface as the phase.
    for (const hand of [LOADED_HAND, BARREN_HAND, []]) {
      const { state } = mustApply(table(hand), { type: "attack", seat: "p1", index: SWEEP_ATTACK });
      expect(state.phase.kind, JSON.stringify(hand)).toBe("turn:action");
    }
  });

  it("🛑 the SERIALIZED ALPHABET does not grow: a round trip is byte-identical", () => {
    // The other half of D463's pair. A v29 record written by an older deploy cannot carry
    // this op (it did not exist), and a record written by THIS deploy cannot either — the
    // rung above says why. So the bytes a record holds are unchanged, driven by round
    // tripping the post-attack state through JSON and replaying the comparison.
    const { state } = mustApply(table(), { type: "attack", seat: "p1", index: SWEEP_ATTACK });
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(round).toEqual(state);
    expect(JSON.stringify(state)).not.toContain("discardFromOpponentHand");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE VERSION PINS
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — the version, and what it is owed for", () => {
  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // A sentence that derived to `null` derives to a two-op program, and a new `EffectOp`
    // member runs in the interpreter. That is behaviour, so the bump is owed.
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe(engineVersion);
  });
});
