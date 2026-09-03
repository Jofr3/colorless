import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { POKEMON_TYPE_BY_CODE, POKEMON_TYPES, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { runProgram } from "./interpreter";
import {
  DISCARD_ATTACH_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.149.1 → 0.150.0 — D234, ATTACH FROM THE DISCARD PILE: row 9 of
// `coverage-backlog-legal.md`, the biggest measured count on the D233 page, and
// the FIRST time an ATTACK produces `attachEnergyFrom` at all.
//
// ✅ THE ROW'S COUNT RE-DERIVES TO THE DIGIT, WHICH IS NEW ON THIS PAGE. Four
// rows running (D229 19→16, D230 22→25, D231 25→42, D232 35→31) carried a
// printing count nobody could reproduce. Re-measured against the remote D1
// `luminous` on 2026-08-06 — `json_each` + `GLOB` (never `LIKE`), grouped BY
// SENTENCE, over ALL THREE text columns, `legal_standard = 1`:
//
//   WHERE t GLOB '*[Aa]ttach*Energy card*from your*discard pile*'
//   -- attack 17 printings / 12 sentences · ability 13 / 6 · effect 6 / 4
//
// The row says **17 (12 sentences) · 12 · 5** and it is EXACT: the ability and
// Trainer halves are 13 and 6 minus the one printing each that is already
// authored (`sv09-024`; N's PP Up `sv09-153`).
//
// ✅ AND ITS *PREDICTION* HELD, WHICH IS THE PART WORTH TRANSFERRING. The resume
// point wrote it down so a successor could falsify it — *"the sentences vary in
// the NOUN and in the DESTINATION, not in the VERB, so D232's rule says ONE
// anchor, not twelve arms"* — and one anchor is what it is. D232's rule now has
// evidence on both sides of it: its own family differed in the VERB and needed
// three arms; this one differs in the NOUN and needs one.
//
// 🛑 12 OF THE 17, AND THE 5 LEFT ARE FOUR SEPARATE BLOCKERS RATHER THAN ONE —
// see `UNREAD` below, where each is pinned derived-to-null with the reason it is
// out of reach. **A residue is a measurement, not a remainder**: it is written
// back to the backlog as its own row rather than left as "the rest of row 9".
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did an Energy attach". `attachEnergyFrom`
// has run since M5 with six registry rows behind it and `attachEnergyFrom.test.ts`
// owns the op's own behaviour. What is NEW is a TEXT PARSER over fields that
// already exist, and its whole risk is that two of those fields are one word
// apart in print: `count: 2` (the batch onto ONE body) versus the printed "in any
// way you like" (TWO ops that may land on two bodies). A build that crossed them
// attaches two Energy, emits two `ENERGY_ATTACHED` rows and passes every generic
// assertion in this repo. Every case below that could survive a crossed build is
// paired with one that could not.

/** The eight sentences this one anchor reads, with the program each derives to
    and the printings measured for it. Both figures per row: `printings` over the
    whole remote catalog (3,786 rows / 20 sets), `legalPrintings` over the
    Standard pool (2,021 rows) — a count without a POPULATION and a LEGALITY is
    not a fact.

    ⚠️ **TWO OF THE EIGHT ARE 0 LEGAL AND ARE READ ANYWAY.** "1 of your Pokémon"
    is printed five times in the catalog and every one is rotated. That is not
    charity: *an arm transfers across sets and a registry row does not* (D180 /
    D187) — the sentence recurs, so the arm serves the H/I reprint the day one is
    ingested, at no extra cost because the destination is a row in a table the
    anchor already consults. */
const CLAUSES = [
  {
    text: "Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon.",
    program: [
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        toSelf: true,
        count: 2,
      },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon.",
    program: [{ op: "attachEnergyFrom", source: "discard", benchOnly: true }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", benchOnly: true, count: 2 },
    ] as EffectOp[],
    printings: 8,
    legalPrintings: 2,
  },
  {
    text: "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
    // 🆕 D360 — `declinable` on BOTH ops: the printed "up to" is a ceiling over a
    // floor of ZERO, so each of the two decisions may be answered "none".
    program: [
      { op: "attachEnergyFrom", source: "discard", declinable: true },
      { op: "attachEnergyFrom", source: "discard", declinable: true },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 1,
  },
  {
    text: "Attach a Basic {R} Energy card from your discard pile to 1 of your {N} Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", energyType: "Fire", targetType: "Dragon" },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Attach a Basic {F} Energy card from your discard pile to this Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", toSelf: true },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach a Basic {M} Energy card from your discard pile to this Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", energyType: "Metal", toSelf: true },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    text: "Attach up to 2 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like.",
    // 🆕 D360 — see the row above; the riders are orthogonal to the decline.
    program: [
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        benchOnly: true,
        declinable: true,
      },
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        benchOnly: true,
        declinable: true,
      },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    // ⚠️⚠️ D246 — THE NINTH SENTENCE, AND THIS ARM DID NOT GROW A LINE TO GET IT.
    // Landorus `sv08-110` "Fist of Focus" prints the BARE noun — "an Energy card"
    // rather than "a Basic Energy card" — which was `UNREAD[1]`'s whole blocker
    // and is `attachEnergyFrom.anyEnergy` now. The field was built for the HAND
    // side (Snorlax `sv06-136`), and it arrived here because both zones are ONE
    // clause: **a widened NOUN transfers across every zone the factory serves**,
    // which is the exact converse of D236's finding that a widened ZONE transfers
    // the anchor and not the family. RE-HOMED from `UNREAD`, not deleted.
    text: "Attach an Energy card from your discard pile to this Pokémon.",
    program: [
      { op: "attachEnergyFrom", source: "discard", anyEnergy: true, toSelf: true },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    // ⚠️⚠️ D248 — THE TENTH SENTENCE, AND THIS ARM DID NOT GROW A LINE FOR IT
    // EITHER. Mudsdale `sv05-092`/`sv05-175` "Mud Stock" (2 legal) was `UNREAD[0]`
    // for fourteen slices, and it was NEVER one regex away: the destination is a
    // `([^.]+)` capture, so this phrase has been MATCHING since D234 and was
    // refused only because `DISCARD_ATTACH_DESTINATIONS` held no key for it. The
    // whole slice is one MAP ROW, one op field and one interpreter fold.
    // 🆕 **A ROW THAT LOOKS LIKE A MISSING ARM CAN BE A MISSING MAP KEY** — the
    // yield of a table-driven capture, and nothing on the backlog page priced it.
    // RE-HOMED from `UNREAD`, not deleted.
    text: "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.",
    program: [
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        benchOnly: true,
        toEach: true,
      },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
] as const;

const REGI_CHARGE_TEXT = 0;
const SAND_GIFT_TEXT = 1;
const FAULT_LINE_TEXT = 2;
const PICK_AND_STICK_TEXT = 3;
const DRAGONS_FURY_TEXT = 4;
const SELF_ONE_TEXT = 5;
const METAL_SELF_TEXT = 6;
const BENCH_ANY_WAY_TEXT = 7;
const MUD_STOCK_TEXT = 9;

/** 🛑 THE FIVE LEGAL PRINTINGS THIS SLICE DOES **NOT** READ, each with the reason
    it is out of reach and its legal count. They are pinned derived-to-null so the
    residue is a fact about the code rather than a note in a doc — and they are
    FOUR different blockers, which is why they go back to the backlog as one
    measured row instead of "the rest of row 9".

    ⚠️ NONE of the four is a widening of this anchor. Three want something the OP
    cannot say and the fourth belongs to a different reader entirely. */
const UNREAD: readonly (readonly [string, number, string])[] = [
  // ⚠️ D248 REMOVED THE SPREAD ROW FROM THIS TABLE BY BUILDING IT — it is now
  // `CLAUSES`' tenth entry. The reason it was here ("`attachEnergyFrom` attaches
  // to ONE `ref`") was TRUE of the APPLY and never true of the ANCHOR, which is
  // the half nobody checked: the phrase was matching the whole time.
  // ⚠️ D246 REMOVED THE BARE-NOUN ROW FROM THIS TABLE BY BUILDING IT — it is now
  // `CLAUSES`' ninth entry, reached with no line of this arm's own. The reason it
  // was here ("`attachableEnergies` admits `energyType === \"Normal\"` only") was
  // TRUE and is the field `attachEnergyFrom.anyEnergy` lifted.
  [
    "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
    1,
    "`source` names a ZONE, never a SEAT: every target the op can produce is `ctx.seat`'s, and every card it can take is theirs too",
  ],
  [
    "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.",
    1,
    "a `programPerHeads` over a PARKING op — a shape nothing in the pool has printed, and owned by `deriveAttackCoinFlip`, a different reader",
  ],
] as const;

/** The rotated-only sentence that used to be the SAME blocker as `UNREAD[0]`
    wearing a leading clause. Kept apart from `UNREAD` because it has no legal
    printing and would otherwise inflate that table's arithmetic.

    ⚠️⚠️ **RE-HOMED AT D248, NOT DELETED** — the spread half is built, so the
    "nobody reads the spread" half of this claim EXPIRED and the claim it actually
    exists for did not: the LEADING CLAUSE is a bounded player-chosen subset, and
    `toEach` means the eligible set IS the count. The two readings disagree on
    every board with three or more Benched bodies, which is exactly the board a
    widened anchor would silently get wrong. 🆕 **AND THE SENTENCE IS NOT
    ROTATED-ONLY ANY MORE, WHICH IS THIS SLICE'S WIDENING FINDING**: Glass Trumpet
    `sv07-135`/`sv08.5-110` print it as a TRAINER (**2 legal**, `effect` column,
    behind "You can use this card only if you have any Tera Pokémon in play"), so
    the backlog cell's "0 legal" was measured in the ATTACK column alone. It is
    still not this reader's — there is no Trainer deriver at all — but a page that
    says "0 legal" about a 2-legal sentence is a claim that has rotted. */
const ROTATED_EACH_OF =
  "Choose up to 2 of your Benched Pokémon and attach a Basic {R} Energy card from your discard pile to each of them.";

/** 🛑 THE FAMILY'S REAL NEAR MISS, AND IT IS A CATALOG ROW RATHER THAN A
    CONSTRUCTION: the same verb and the same zone one word over on the SOURCE
    side. Row 12 of the backlog (16 legal attack printings) is the HAND, and this
    anchor must not touch a byte of it — a build that read `from your (hand|discard
    pile)` would attach out of the wrong zone and pass every assertion above.

    ⚠️⚠️ **RE-HOMED AT D236, NOT DELETED.** This constant used to be pinned
    DERIVED-TO-NULL, and D236 built the hand side — so the "nobody reads this"
    half of the claim EXPIRED, on schedule, exactly as the page said an unbuilt
    control eventually does. The claim it actually existed for did not expire:
    the two zones must derive to DIFFERENT `source` values off ONE shared anchor
    factory, and a build that crossed them still fails here. The assertion below
    was rewritten to say that instead. */
const HAND_SIDE_NEAR_MISS = "Attach a Basic Energy card from your hand to 1 of your Pokémon.";

// ── The board. Indices 29-34 on `fix-trainerops`, appended by D234. ──
const REGI_CHARGE = 29;
const SAND_GIFT = 30;
const FAULT_LINE = 31;
const PICK_AND_STICK = 32;
const DRAGONS_FURY = 33;
const MUD_STOCK = 34;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DISCARD_ATTACH_DECK, p2: DISCARD_ATTACH_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order and a discard pile stocked type by type. p2 is a plain body so
    nothing on the other side of the table can be reached by accident. */
function ready(
  seed: number,
  {
    bench = ["fix-basic-1", "fix-basic-1"],
    discard = {},
  }: { bench?: readonly string[]; discard?: Record<string, number> },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const [id, count] of Object.entries(discard)) {
    state = discardFromDeck(state, "p1", id, count);
  }
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `choosePokemon` prompt an attack produced, narrowed. */
function parkedTargets(state: GameState): readonly PokemonRef[] {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
  return prompt.candidates;
}

const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

/** Answer a parked `choosePokemon` with `ref`, and — 🆕 D359 — optionally with the
    printed QUANTITY. Absent `take` is the whole batch, which is what every answer
    to this prompt meant before the ceiling existed. */
function pick(
  state: GameState,
  ref: PokemonRef,
  take?: number,
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemon", ref, ...(take === undefined ? {} : { take }) },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — twelve printed sentences, ONE arm", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 15 of the row's 17 legal printings, across 10 of its 12 sentences", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one destination row would still pass every accept case above.
    // ⚠️ D246 — WAS 12 OF 8, AND THE ROW MOVED WITHOUT THIS ARM GAINING A LINE:
    // the bare-noun sentence walked from `UNREAD` into `CLAUSES` because the field
    // the HAND side needed serves both zones off one clause.
    // ⚠️ D248 — WAS 13 OF 9, AND THE ROW MOVED WITHOUT THIS ARM GAINING A LINE A
    // SECOND TIME: the spread sentence walked from `UNREAD` into `CLAUSES` on a
    // MAP KEY. Two consecutive slices have grown this table by a sentence apiece
    // with the regex byte-identical, which is the strongest evidence on this page
    // that a table-driven capture is what an anchor is FOR.
    expect(CLAUSES).toHaveLength(10);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(15);
    // …and the residue, which is the other half of the same census: 2 more legal
    // printings over 2 sentences, each pinned derived-to-null so the deferral has
    // a live subject.
    expect(UNREAD).toHaveLength(2);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(2);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    // 15 + 2 = 17, which is exactly what the backlog row measured. This is the
    // FIRST row on that page whose count survived re-derivation unchanged, and the
    // TOTAL is what has to keep holding as printings move between the two halves.
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 2).toBe(17);
    expect(CLAUSES.length + UNREAD.length).toBe(12);
  });

  it("reads 40 of the family's 43 CATALOG printings too — an arm transfers", () => {
    // The wider population, because a row that only counts the legal pool
    // under-states what an arm buys: the same GLOB over all 3,786 rows returns 43
    // printings on 26 sentences (re-derived at D248, unchanged), and this arm
    // reads 40 on 23.
    // ⚠️ D246 — WAS 37 ON 21; the bare-noun sentence is one catalog printing and
    // one sentence, and it is the SAME printing in both populations (Landorus
    // `sv08-110` is legal), which is why both totals move by exactly one.
    // ⚠️ D248 — WAS 38 ON 22; the spread sentence is TWO printings and one
    // sentence, and both are legal (`sv05-092`/`sv05-175`), so again the legal
    // and catalog totals move together. The three still refused are the
    // opponent's-pile printing, the per-heads one and the rotated leading-clause
    // "each of them" below — which is the ONE remaining place where the two
    // populations disagree.
    expect(CLAUSES.reduce((sum, c) => sum + c.printings, 0)).toBe(22);
    // ⚠️ D248 RE-RAN THE GROUPED GLOB RATHER THAN INHERITING THIS ARITHMETIC, and
    // it closes: 26 sentences / 43 printings, of which THREE sentences and THREE
    // printings are refused (the opponent's pile, the per-heads coin clause and
    // the leading-clause "each of them"), leaving **23 sentences / 40 printings**.
    // The 23 read sentences are the 10 above plus 13 more that differ ONLY in a
    // brace code or a count — all rotated, none needing a line of code. Their
    // printings are what makes 22 into 40, and the two rows below are the ones
    // whose DESTINATION has no legal printing at all, i.e. the two that would be
    // dropped by a build that only served the Standard pool.
    for (const text of [
      "Attach up to 2 Basic {R} Energy cards from your discard pile to 1 of your Pokémon.",
      "Attach up to 2 Basic {W} Energy cards from your discard pile to 1 of your Pokémon.",
    ]) {
      expect(deriveAttackEffect(text), text).toEqual([
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: text.includes("{R}") ? "Fire" : "Water",
          count: 2,
        },
      ]);
    }
    // …and the rotated-only "each of them" printing is STILL refused, and D248
    // changed WHY: the spread itself is built now, so what blocks this one is the
    // LEADING CLAUSE alone ("Choose up to 2 of your Benched Pokémon and …") — a
    // bounded subset chosen by the player, which is a park this op has no field
    // for and which `toEach`'s "the eligible set IS the count" reading contradicts
    // outright. A build that widened the anchor to eat the leading clause would
    // spread over the WHOLE Bench where the print says at most two.
    expect(deriveAttackEffect(ROTATED_EACH_OF)).toBeNull();
  });

  it("🛑 the SOURCE side is one word from row 12, and the two must not collapse", () => {
    // A CATALOG ROW, not a construction: the HAND spelling is 16 legal attack
    // printings of its own (backlog row 12) and means a different zone entirely.
    // ⚠️ BUILT AT D236 — so what is pinned is no longer "nobody reads it" but the
    // thing that always mattered: the same printed sentence with one word changed
    // derives to a DIFFERENT ZONE, off the shared `attachFromZoneAnchor` factory.
    // A build that read `from your (hand|discard pile)` in one anchor attaches out
    // of whichever pile it finds first and passes every assertion above.
    expect(HAND_SIDE_NEAR_MISS).toContain("from your hand to");
    expect(deriveAttackEffect(HAND_SIDE_NEAR_MISS)).toEqual([
      { op: "attachEnergyFrom", source: "hand" },
    ]);
    expect(
      deriveAttackEffect("Attach a Basic Energy card from your discard pile to 1 of your Pokémon."),
    ).toEqual([{ op: "attachEnergyFrom", source: "discard" }]);
    // …and the DISCARD anchor's own tail vocabulary stays empty: the heal clause
    // D236 added rides the HAND anchor alone, because no printing on this side
    // carries a trailing clause at all (measured at D234, still true).
    expect(
      deriveAttackEffect(
        "Attach a Basic {G} Energy card from your discard pile to 1 of your Benched Pokémon. If you do, heal all damage from that Pokémon.",
      ),
    ).toBeNull();
  });

  it("the NOUN and the DESTINATION are independent axes, which is why it is one arm", () => {
    // ⚠️ THE ROW'S PREDICTION, DRIVEN. If the twelve sentences were twelve arms,
    // changing the noun would be free to change something other than
    // `energyType`, and changing the destination free to change something other
    // than the riders. Both are asserted as "differs in exactly one key".
    const [bare] = deriveAttackEffect(CLAUSES[SAND_GIFT_TEXT].text) ?? [];
    const [typed] =
      deriveAttackEffect(
        "Attach a Basic {W} Energy card from your discard pile to 1 of your Benched Pokémon.",
      ) ?? [];
    expect(typed).toEqual({ ...bare, energyType: "Water" });
    const [self] = deriveAttackEffect(CLAUSES[SELF_ONE_TEXT].text) ?? [];
    const [metal] = deriveAttackEffect(CLAUSES[METAL_SELF_TEXT].text) ?? [];
    expect(metal).toEqual({ ...self, energyType: "Metal" });
    // …and the count rides the same arm at a value no card prints today, which is
    // the whole reason it is a capture rather than an alternation over 2 and 3.
    expect(
      deriveAttackEffect(
        "Attach up to 5 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
      ),
    ).toEqual([{ op: "attachEnergyFrom", source: "discard", benchOnly: true, count: 5 }]);
  });

  it("🛑 `count` and 'in any way you like' are DIFFERENT PROGRAMS, and both are printed", () => {
    // ⚠️ THE FALSIFIABILITY TEST (D231), applied to the one field a crossed build
    // could hide behind. The two sentences differ by five printed words and by the
    // SHAPE of the program: one op carrying `count: 2`, versus two ops carrying
    // none. Both values are printed AND legal, so neither branch is an unreachable
    // arm nobody can kill a mutant on.
    const batch = deriveAttackEffect(CLAUSES[FAULT_LINE_TEXT].text) ?? [];
    const spread = deriveAttackEffect(CLAUSES[BENCH_ANY_WAY_TEXT].text) ?? [];
    expect(batch).toHaveLength(1);
    expect(spread).toHaveLength(2);
    expect(batch[0]).toHaveProperty("count", 2);
    for (const op of spread) expect(op).not.toHaveProperty("count");
    // The two spread ops are IDENTICAL to each other — a distribution is N copies
    // of one decision (Koraidon ex "Dino Cry"'s authored shape), never one op that
    // knows it is the second.
    expect(spread[0]).toEqual(spread[1]);
    expect(CLAUSES[FAULT_LINE_TEXT].legalPrintings).toBeGreaterThan(0);
    expect(CLAUSES[BENCH_ANY_WAY_TEXT].legalPrintings).toBeGreaterThan(0);
  });

  it("a SINGULAR printing emits NO `count`, because absent means 1 (D205)", () => {
    // The op's rows are compared BY VALUE against hand-authored registry ones, so
    // an explicit `count: 1` here would make a derived program unequal to the
    // registry program that means the same thing.
    for (const index of [SAND_GIFT_TEXT, DRAGONS_FURY_TEXT, SELF_ONE_TEXT, METAL_SELF_TEXT]) {
      for (const op of CLAUSES[index]?.program ?? []) expect(op).not.toHaveProperty("count");
    }
    expect(deriveAttackEffect(CLAUSES[SAND_GIFT_TEXT].text)).toEqual([
      { op: "attachEnergyFrom", source: "discard", benchOnly: true },
    ]);
  });

  it("refuses the anchor, grammar, punctuation and case rewrites", () => {
    const bare = CLAUSES[SAND_GIFT_TEXT].text;
    const rewrites = [
      // A leading clause — the shape a `$`-only build eats. ⚠️ THE POOL HAS A REAL
      // ONE: `ROTATED_EACH_OF` above, and D232's own "Flip 3 coins." printing.
      `Draw a card. ${bare}`,
      // A trailing clause — the shape a `^`-only build eats. CONSTRUCTED, and said
      // so: no printing in this family carries a tail (D228's finding — a dropped
      // `$` would survive a harness fed only real rows).
      `${bare} Draw a card.`,
      // Case, both ends.
      bare.replace("Attach", "attach"),
      bare.replace("Benched", "benched"),
      // The trailing period.
      bare.slice(0, -1),
      // 🛑 THE GRAMMATICAL CROSSES, which the article/number weld exists to refuse:
      // no card prints either, and a `cards?` build would read both.
      "Attach a Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
      "Attach up to 2 Basic Energy card from your discard pile to 1 of your Benched Pokémon.",
      // A printed 0 would derive to a program that moves nothing.
      "Attach up to 0 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
      // …and past the ingested-text ceiling, which is load-bearing on the spread
      // branch: it grows the PROGRAM one op per unit.
      "Attach up to 11 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
      // The DECK, which is a different op entirely (`attachFromDeck`, row 10).
      "Attach a Basic Energy card from your deck to 1 of your Benched Pokémon.",
      // A destination the table does not name — the residue's own shape, and the
      // reason the phrase is a Map lookup rather than a `.+` the arm trusts.
      "Attach a Basic Energy card from your discard pile to your opponent's Active Pokémon.",
      // A brace code the ENERGY map refuses ({C} is the provision fallback).
      "Attach a Basic {C} Energy card from your discard pile to this Pokémon.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("carries NO new op, and exactly ONE op field this arm did not pay for", () => {
    // Every arm emits `attachEnergyFrom`, which the ABILITY path has run since M5,
    // and every key any of them sets already existed at D234: `source`/`energyType`
    // (M5), `targetType`/`benchOnly` (D204), `count`/`toSelf` (D205/D221).
    // ⚠️ D246 ADDS `anyEnergy` TO THIS SET AND THE ADDITION IS THE POINT RATHER
    // THAN BOOKKEEPING: the field was designed, driven and paid for by the HAND
    // side (Snorlax `sv06-136`), and it appears in a DISCARD program because the
    // two zones share one clause. The row that says "this arm cost nothing new"
    // stays true of D234; what is now also true is that a sibling zone's field
    // arrives here for free.
    const known = new Set([
      "op",
      "source",
      "energyType",
      "count",
      "targetType",
      "benchOnly",
      "toSelf",
      "anyEnergy",
      // ⚠️ D248 ADDS `toEach`, AND IT IS THE FIRST KEY IN THIS SET THIS ARM
      // ACTUALLY PAID FOR — `anyEnergy` arrived from the hand side for free, but
      // the spread has no sibling zone to inherit from. It is still not an ARM:
      // the anchor is byte-identical and the field rides a MAP ROW.
      "toEach",
      // 🆕🛑 D360 ADDS `declinable`, AND IT IS THE SECOND KEY TO ARRIVE HERE FOR
      // FREE — but from the REGISTRY rather than from a sibling zone, which is a
      // direction this set has never recorded before. D358 designed, drove and
      // paid for the field on two HAND-AUTHORED programs (Archaludon ex,
      // Magneton); D359 taught `interpreter.ts` to read it as the park's ceiling.
      // This arm sets it by testing ONE capture group it had already parsed, so
      // the whole engine price of reaching four more printings is that one
      // expression. **THE ROW'S ORIGINAL CLAIM — "carries NO new op" — IS STILL
      // TRUE AT ITS FIFTH SLICE**, and the count of fields this arm actually paid
      // for is still ONE (`toEach`).
      "declinable",
    ]);
    for (const { program } of CLAUSES) {
      for (const op of program) {
        expect(op.op).toBe("attachEnergyFrom");
        for (const key of Object.keys(op)) expect(known, `${key}`).toContain(key);
      }
    }
  });

  it("the brace-coded destination is generated from POKEMON_TYPE_BY_CODE, not listed", () => {
    // ⚠️ THE MAP IS TOTAL OVER `POKEMON_TYPES` BY CONSTRUCTION — a type added to
    // the schema is admitted here without an edit, which is the rule
    // `CLAUSE_POKEMON_TYPES` follows one axis over. Pinned so a hand-kept
    // alternation cannot quietly replace it.
    expect(new Set(Object.values(POKEMON_TYPE_BY_CODE))).toEqual(new Set(POKEMON_TYPES));
    expect(POKEMON_TYPE_BY_CODE.N).toBe("Dragon");
    expect(POKEMON_TYPE_BY_CODE.C).toBe("Colorless");
    for (const [code, type] of Object.entries(POKEMON_TYPE_BY_CODE)) {
      expect(
        deriveAttackEffect(
          `Attach a Basic Energy card from your discard pile to 1 of your {${code}} Pokémon.`,
        ),
        code,
      ).toEqual([{ op: "attachEnergyFrom", source: "discard", targetType: type }]);
    }
    // …and a code in NEITHER map is refused rather than silently dropped.
    expect(
      deriveAttackEffect(
        "Attach a Basic Energy card from your discard pile to 1 of your {Z} Pokémon.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FIXTURE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries six of the sentences at 29-34", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 29-34, appended and not inserted", () => {
    // 48 at D236, which appended 43-47 (attach from the HAND — row 9's own anchor
    // one word over, and the reason this file's near-miss case now points the
    // OTHER way); 43 at D235, which appended 35-42 (the deck search that ATTACHES — row 9's
    // sibling one ZONE over, and the reason this file's near-miss case matters);
    // 35 at D234, which appended 29-34; 29 at D232, which appended 25-28 (the
    // opponent-hand family); 25 at D231, 20 at D230, 17 at D229, 14 at D228, 13 at
    // D227, 9 at D189, 8 at D181. TEN slices, ten appends, zero inserts —
    // which is what every index constant in ten suites depends on.
    // ⚠️ FIFTY-FIVE AT D240; **58 at D241**, which appended 55-57 (look at the
    // top N — "Summoning Gate" / "Larimar Rain" / "Dig It Up").
    // `derivedLookAtTop.test.ts` owns 55-57. ELEVEN slices, eleven appends, zero
    // inserts.
    // 🆕🆕 **63 AT D426**, which appended **61-62** — the opponent-chooses hand
    // discard (*"Your opponent discards 2 cards from their hand."* / *"…a card…"*).
    // `opponentHandDiscard.test.ts` owns them, and the append-never-insert
    // discipline this whole paragraph exists for holds again: 0-60 are addressed by
    // constant in a dozen sibling suites and every one of them still means what it
    // meant. ⚠️ NO ORDINAL IS CLAIMED (*"the Nth slice"*) — the running count above
    // was last written at D241 and was already one append behind by D246, which is
    // exactly how a count in a comment rots. The LENGTH is the executable half and
    // it is the line below.
    // 🆕🆕 **68 AT D443**, which appended **66-67** — the OPPONENT-BOARD pair
    // (`derivedOpponentEnergyMove.test.ts` owns them). TWELVE sibling suites carry
    // this pin and all twelve were stepped in one pass, as D442 stepped eleven.
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (`derivedSpreadEnergyMove.test.ts` owns them). ELEVEN sibling suites carry this
    // same length pin and ALL of them were stepped in one pass (D431): a green run
    // after fixing the one that reddened is evidence the runner stopped early.
    expect(attacks()).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect(attacks()[REGI_CHARGE]?.effect).toBe(CLAUSES[REGI_CHARGE_TEXT].text);
    expect(attacks()[SAND_GIFT]?.effect).toBe(CLAUSES[SAND_GIFT_TEXT].text);
    expect(attacks()[FAULT_LINE]?.effect).toBe(CLAUSES[FAULT_LINE_TEXT].text);
    expect(attacks()[PICK_AND_STICK]?.effect).toBe(CLAUSES[PICK_AND_STICK_TEXT].text);
    expect(attacks()[DRAGONS_FURY]?.effect).toBe(CLAUSES[DRAGONS_FURY_TEXT].text);
    // …and the SPREAD, which was fielded at D234 as a deliberately UNREAD control
    // and is the sentence D248 built. ⚠️ **THE CONTROL BECAME THE DEMONSTRATOR**
    // — D247's fixture finding a second time, and it is why nothing was appended
    // to `fix-trainerops` this slice: the board that proved the refusal is exactly
    // the board that proves the spread.
    expect(attacks()[MUD_STOCK]?.effect).toBe(CLAUSES[MUD_STOCK_TEXT].text);
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[2]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks()[28]?.effect).toBe(
      "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
    );
  });

  it("NO printed base damage on any of the six — stated, because it is a CHOICE", () => {
    // Five of the six real printings print a bare effect; Druddigon `sv09-115`
    // prints 20 and this fixture drops it, so a Benched body receiving Energy can
    // never be Knocked Out by the same attack that fed it — a promotion prompt in
    // front of the assertion would read as a park that means something else.
    for (const index of [REGI_CHARGE, SAND_GIFT, FAULT_LINE, PICK_AND_STICK, DRAGONS_FURY, MUD_STOCK]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // …and the neighbouring index that DOES print a number still does.
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("the demonstrator's own attack rows still DERIVE to this slice's programs", () => {
    // The round trip: the fixture strings are the CLAIM, so they are read back
    // through the deriver rather than compared to the constants alone. An arm
    // authored against a paraphrase passes a test written against the same
    // paraphrase and matches no real card (D183).
    expect(deriveAttackEffect(attacks()[REGI_CHARGE]?.effect ?? "")).toEqual(
      CLAUSES[REGI_CHARGE_TEXT].program,
    );
    // ⚠️ D248 — WAS `.toBeNull()`, the round trip on the deliberately-unread
    // control. Same assertion shape, opposite verdict, and it is what pins the
    // fixture STRING against the map KEY: a destination row whose text drifted by
    // one byte from the printed phrase would derive to null again right here.
    expect(deriveAttackEffect(attacks()[MUD_STOCK]?.effect ?? "")).toEqual(
      CLAUSES[MUD_STOCK_TEXT].program,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE POINT OF THE SLICE — where the Energy lands
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — an ATTACK pulling Energy out of the discard pile", () => {
  it("the SELF target forces: no park, and the Energy lands on the attacker", () => {
    const state = ready(3, { discard: { "fix-fighting-energy": 2, "fix-water-energy": 2 } });
    const attacker = activeUid(state, "p1");
    const before = state.players.p1.discard.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: REGI_CHARGE,
    });

    // 🆕🆕 D359 — **THIS CASE USED TO ASSERT `not.toBe("effect:choose")`** under
    // the reasoning *"a `toSelf` attach can offer AT MOST ONE target, so
    // `parkOrForce` always forces"*. The premise was about CANDIDATES and the rule
    // is about ANSWERS: Regi Charge prints *"attach **up to 2** Basic {F} … to this
    // Pokémon"*, which is three answers over one body, so it now parks. The
    // discriminator against a build that dropped `toSelf` therefore moves to where
    // it is still sharp — the CANDIDATE LIST, which must be the Active alone even
    // though two Benched bodies are on the board.
    expect(parkedTargets(done)).toEqual([ACTIVE_REF]);
    const answered = pick(done, ACTIVE_REF);
    const attached = all([...events, ...answered.events], "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const e of attached) expect(e.target).toEqual({ spot: "active" });
    // 🛑 AND THE TYPE FILTER BIT: the pile holds two {F} and two {W}, and only the
    // {F} moved. A build that dropped `energyType` takes the first two cards in
    // the pile whatever they are.
    const after = answered.state;
    expect(after.players.p1.active?.energy).toHaveLength(3); // the {C} cost + two {F}
    const moved = attached.map((e) => after.cardIdByUid[e.uid]);
    expect(moved).toEqual(["fix-fighting-energy", "fix-fighting-energy"]);
    expect(after.players.p1.discard).toHaveLength(before - 2);
    expect(after.players.p1.discard.map((u) => after.cardIdByUid[u])).toEqual([
      "fix-water-energy",
      "fix-water-energy",
    ]);
    expect(activeUid(after, "p1")).toBe(attacker);
  });

  it("the BENCH-ONLY target parks on the Bench alone — the Active is not offered", () => {
    const state = ready(5, { discard: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: SAND_GIFT });

    const targets = parkedTargets(parked);
    expect(parked.phase.kind === "effect:choose" ? parked.phase.seat : undefined).toBe("p1");
    // 🛑 THE ASSERTION THE `benchOnly` RIDER IS ABOUT: two Benched bodies, and the
    // ATTACKER — which is in play, is the controller's, and would be eligible
    // under an un-narrowed set — is absent.
    expect(targets).toHaveLength(2);
    for (const ref of targets) {
      expect(ref.seat).toBe("p1");
      expect(ref.spot.spot).toBe("bench");
    }
    expect(targets).not.toContainEqual(ACTIVE_REF);

    const { state: done, events } = pick(parked, benchRef(1));
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(1);
    expect(attached[0]?.target).toEqual({ spot: "bench", index: 1 });
    expect(done.players.p1.bench[1]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(0);
  });

  it("🛑 `count: 2` puts BOTH cards on the ONE chosen body, in ONE decision", () => {
    const state = ready(7, { discard: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: FAULT_LINE });
    expect(parkedTargets(parked)).toHaveLength(2);

    const { state: done, events } = pick(parked, benchRef(0));
    // ONE park, then the whole batch lands: the attack is over.
    expect(done.phase.kind).not.toBe("effect:choose");
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const e of attached) expect(e.target).toEqual({ spot: "bench", index: 0 });
    expect(done.players.p1.bench[0]?.energy).toHaveLength(2);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(0);
  });

  it("🛑 …and 'in any way you like' asks TWICE, and the two may land APART", () => {
    // ⚠️ THE PAIR THAT MAKES THE SPLIT LOAD-BEARING, and the one case in this file
    // a crossed build cannot survive. Same board, same op, same prompt kind, same
    // two Energy — only the SHAPE of the program differs, and the observable is
    // that the second decision exists at all.
    const state = ready(7, { discard: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    });
    // Un-narrowed destination: the ATTACKER is offered here where `benchOnly`
    // excluded it two cases up.
    expect(parkedTargets(parked)).toHaveLength(3);
    expect(parkedTargets(parked)).toContainEqual(ACTIVE_REF);

    const first = pick(parked, benchRef(0));
    // 🛑 THE SECOND PARK. A `count: 2` build has finished by now.
    expect(first.state.phase.kind).toBe("effect:choose");
    expect(all(first.events, "ENERGY_ATTACHED")).toHaveLength(1);
    const second = pick(first.state, benchRef(1));
    expect(second.state.phase.kind).not.toBe("effect:choose");
    expect(all(second.events, "ENERGY_ATTACHED")).toHaveLength(1);
    // …and they landed on two DIFFERENT bodies, which is what the printed phrase
    // buys and what `count` cannot express.
    expect(second.state.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(second.state.players.p1.bench[1]?.energy).toHaveLength(1);
  });

  it("the {N} destination offers the DRAGON body and refuses the one beside it", () => {
    // ⚠️ `targetType` READS `card.types` OFF THE TOP CARD, so the discriminator has
    // to be a Bench holding one body the filter admits and one it refuses.
    // `sv03-161` (Drampa) is this pool's only Dragon.
    const state = ready(9, {
      bench: ["sv03-161", "fix-basic-1"],
      discard: { "fix-fire-energy": 2, "fix-water-energy": 2 },
    });
    expect(FIXTURE_POOL["sv03-161"]?.types).toEqual(["Dragon"]);
    expect(FIXTURE_POOL["fix-basic-1"]?.types).not.toContain("Dragon");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAGONS_FURY,
    });
    // ONE eligible target on the whole board, so `parkOrForce` forces — and the
    // forcing IS the assertion: an un-narrowed build offers three and parks.
    expect(done.phase.kind).not.toBe("effect:choose");
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(1);
    expect(attached[0]?.target).toEqual({ spot: "bench", index: 0 });
    // …and the {R} filter bit as well: the pile held {W} too.
    expect(done.cardIdByUid[attached[0]?.uid ?? ""]).toBe("fix-fire-energy");
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(0);
  });

  it("an EMPTY discard pile is a silent whiff, not a refusal — an attack is already paid for", () => {
    // 🛑 THE HALF THAT SEPARATES AN ATTACK FROM A CARD PLAY, and it is the whole
    // reason `programPlayable` prices at zero for this slice. §8: the attack was
    // declared and its cost was met, so a program that can do nothing still
    // RESOLVES — where the identical op on an Ability is refused before it starts.
    const state = ready(11, {});
    expect(state.players.p1.discard.filter((u) => state.cardIdByUid[u] !== undefined).length).toBe(
      state.players.p1.discard.length,
    );
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: SAND_GIFT,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    // …and the SAME program under the card-play gate is refused on that board,
    // which is the contrast that makes the sentence above a measurement.
    expect(programPlayable(state, CLAUSES[SAND_GIFT_TEXT].program, "p1")).toBe(false);
    const stocked = discardFromDeck(state, "p1", "fix-energy", 1);
    expect(programPlayable(stocked, CLAUSES[SAND_GIFT_TEXT].program, "p1")).toBe(true);
  });

  it("takes FEWER than `count` when the pile holds fewer, silently — the printed 'up to'", () => {
    const state = ready(13, { discard: { "fix-fighting-energy": 1 } });
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: REGI_CHARGE });
    // 🆕 D359 — and the offered CEILING is still the printed 2 on a one-card pile.
    // The discard pile is public, so no clamp would leak here; the ceiling is
    // unclamped on principle instead, because the same field is redacted over a
    // HAND-sourced park one card over (Battle-Hardened) where it would.
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.state.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBe(2);
    const { state: done, events } = pick(parked.state, ACTIVE_REF);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.active?.energy).toHaveLength(2); // the {C} cost + one {F}
    expect(done.players.p1.discard).toHaveLength(0);
  });

  it("🆕🛑 D359 — Regi Charge's printed MIDDLE answer: ONE of two, the rest left", () => {
    // The `toSelf` half of the quantity axis, driven on a real board. Two {F} sit
    // in the pile and the controller takes ONE — an answer no route on this card
    // could reach before D359, because the lone `toSelf` candidate was FORCED.
    const state = ready(13, { discard: { "fix-fighting-energy": 2 } });
    const parked = mustApply(state, { type: "attack", seat: "p1", index: REGI_CHARGE });
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const { state: done, events } = pick(parked.state, ACTIVE_REF, 1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.active?.energy).toHaveLength(2); // the {C} cost + one {F}
    // The second {F} is still in the pile — the whole point of the middle answer.
    expect(done.players.p1.discard.filter((u) => done.cardIdByUid[u] === "fix-fighting-energy"))
      .toHaveLength(1);
  });

  it("✅ D248 — the SPREAD feeds every Benched body at once and asks NOTHING", () => {
    // ⚠️⚠️ **THIS CASE USED TO ASSERT THE OPPOSITE, AND IT IS RE-HOMED RATHER THAN
    // REWRITTEN FROM SCRATCH.** From D234 to D247 it read "the UNREAD sentence is
    // on the board and resolves to NOTHING", with a stocked pile and two Benched
    // bodies in front of a real printed attack — the deliberately-unbuilt control
    // (D181's `Strafe` precedent). D248 built it, so the "nobody reads this" half
    // expired on schedule; what the case was really protecting is the BOARD, and
    // the board is unchanged. Same seed, same pile, same bench, opposite verdict.
    const state = ready(15, { discard: { "fix-fighting-energy": 3 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    // TWO bodies, TWO attachments, ONE each — and NO park: the turn ended, which
    // is the whole reason this printing cost no prompt. A build that routed the
    // spread through `parkOrForce` would leave `phase.kind` at "effect:choose".
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(2);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.bench.map((p) => p.energy.length)).toEqual([1, 1]);
    // …and the two bodies got DIFFERENT cards. The fold re-finds its Energy
    // through `attachableEnergies` against the EVOLVING state, so nothing here
    // tracks uids — this assertion is what says that actually happened rather
    // than the same uid being written onto two bodies.
    const fed = done.players.p1.bench.flatMap((p) => p.energy);
    expect(new Set(fed).size).toBe(2);
    // One of the three {F} is left in the pile, because there were only two
    // bodies: the spread takes ONE per body, never the whole pile.
    expect(done.players.p1.discard).toHaveLength(1);
    // The ACTIVE is untouched — `benchOnly` is the printed word "Benched", and it
    // is the SAME field the singular destinations use. It still holds only its
    // {C} cost.
    expect(done.players.p1.active?.energy).toHaveLength(1);
  });

  it("✅ D248 — the pile running dry mid-spread feeds as many as it can", () => {
    // The printed "do as much as you can": ONE {F} in the pile and THREE Benched
    // bodies. The first body is fed and the other two get nothing — no throw, no
    // park, no all-or-nothing refusal. A fold that resolved its Energy ONCE up
    // front and reused it would attach the same card three times and pass a
    // naive "was something attached" assertion while doing it.
    const state = ready(15, {
      bench: ["fix-basic-1", "fix-basic-1", "fix-basic-1"],
      discard: { "fix-fighting-energy": 1 },
    });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.bench.map((p) => p.energy.length)).toEqual([1, 0, 0]);
    expect(done.players.p1.discard).toHaveLength(0);
  });

  it("✅ D248 — an EMPTY Bench is a silent whiff, not a throw", () => {
    // The other end of the same fold: the eligible set is empty, so `reduce`
    // returns the seed state untouched. The pile keeps all three cards, which is
    // what separates "nothing to attach to" from "attached and lost".
    const state = ready(15, { bench: [], discard: { "fix-fighting-energy": 3 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(3);
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("✅ D248 — an EMPTY pile is the whiff guard, one step earlier", () => {
    // The guard in front of the park is shared with every other destination and
    // is unchanged by the fold: no matching {F} at all, so the op returns before
    // the eligible set is even computed. Named because the two whiffs above and
    // this one are three different early returns and only one of them is new.
    const state = ready(15, { discard: { "fix-water-energy": 3 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(3);
    expect(done.players.p1.bench.every((p) => p.energy.length === 0)).toBe(true);
  });

  it("🛑 D248 — the spread is the ATTACKER's own board, on both ends", () => {
    // The one-`otherSeat`-apart pairing, asked of the fold specifically: a build
    // that walked the OPPONENT's bench, or drew from their pile, would pass every
    // count assertion above. p2 has an Active and one Benched body here.
    const state = ready(15, { discard: { "fix-fighting-energy": 3 } });
    const opponentDiscard = state.players.p2.discard.length;
    deepFreeze(state);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: MUD_STOCK });
    expect(done.players.p2.discard).toHaveLength(opponentDiscard);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });

  it("the attach is the ATTACKER's own board, on both ends", () => {
    // The one-`otherSeat`-apart pairing every op in this family owes: a build that
    // read the opponent's discard pile, or benched the Energy on their side, would
    // pass every count assertion above. Both zones are named.
    const state = ready(17, { discard: { "fix-energy": 2 } });
    const opponentDiscard = state.players.p2.discard.length;
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: SAND_GIFT });
    for (const ref of parkedTargets(parked)) expect(ref.seat).toBe("p1");
    const { state: done } = pick(parked, benchRef(0));
    expect(done.players.p2.discard).toHaveLength(opponentDiscard);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. D248 — THE DISTRIBUTION AXIS, AND THE ONE DESIGN CALL THIS SLICE MAKES
// ─────────────────────────────────────────────────────────────────────────────

describe("D248 — `toEach` is ORTHOGONAL to `benchOnly`, not welded to it", () => {
  /** The un-narrowed spread. **NO CARD PRINTS THIS SENTENCE — 0 catalog, 0 legal,
      measured at D248 — and the destination row is read anyway**, for the reason
      "1 of your Pokémon" (0 legal, 5 catalog) is read one row up: an arm transfers
      across sets (D180/D187). It is also the ONLY board on which the design call
      below is observable at all. */
  const EACH_UNNARROWED =
    "Attach a Basic {F} Energy card from your discard pile to each of your Pokémon.";

  it("🛑 THE FLAGGED CALL, WITH THE EVIDENCE BOTH WAYS — and the mutant that installs the other reading", () => {
    // The handoff predicted ONE field named `toEachBench`. What shipped is
    // `toEach` beside the EXISTING `benchOnly`, and the argument is D131's
    // widen-don't-add rule: the printed word "Benched" already has a spelling on
    // this op, shared with `attachFromTop`/`attachFromDeck` through
    // `AttachTargetRiders`, so a welded flag would give the op two ways to say it
    // and they could disagree.
    //
    // ⚠️ THE EVIDENCE THE OTHER WAY IS REAL AND IS RECORDED RATHER THAN GLOSSED:
    // every printing of this distribution in the catalog today names the BENCH,
    // so on the printed pool the two readings are observationally IDENTICAL. That
    // is precisely why the un-narrowed row exists and why this case drives it —
    // and the other reading is installed as the mutant
    // `D248-toEach-implies-bench`, which forces `benchOnly` on every `toEach` op
    // and can ONLY die here.
    expect(deriveAttackEffect(EACH_UNNARROWED)).toEqual([
      { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", toEach: true },
    ]);
    // …and the printed sentence keeps BOTH fields, so the two are readable
    // independently rather than one implying the other.
    expect(deriveAttackEffect(CLAUSES[MUD_STOCK_TEXT].text)).toEqual([
      {
        op: "attachEnergyFrom",
        source: "discard",
        energyType: "Fighting",
        benchOnly: true,
        toEach: true,
      },
    ]);
  });

  it("the un-narrowed spread FEEDS THE ACTIVE — the board the welded reading gets wrong", () => {
    // Driven through `runProgram` directly rather than through an attack, because
    // no card prints the sentence: the op is the subject, exactly as D247 drove
    // its empty-TARGET path against a constructed board rather than declaring the
    // branch a known survivor. **An unreachable branch is either REACHED or
    // removed, never worded.**
    const state = ready(15, { discard: { "fix-fighting-energy": 3 } });
    deepFreeze(state);
    const events: GameEvent[] = [];
    const program = deriveAttackEffect(EACH_UNNARROWED) ?? [];
    const result = runProgram(state, program, { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    // THREE bodies — the Active and both Benched — and three attachments. Under
    // the welded reading this would be 2, with the Active left holding only its
    // {C} cost.
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
    expect(result.state.players.p1.active?.energy).toHaveLength(2);
    expect(result.state.players.p1.bench.map((p) => p.energy.length)).toEqual([1, 1]);
    expect(result.state.players.p1.discard).toHaveLength(0);
  });
});

describe("D248 — the distribution axis has THREE members and a print is exactly one", () => {
  it("`count`, `anyWay` and `toEach` are three different programs off three phrases", () => {
    // The axis stated rather than described. All three phrases name the Bench and
    // all three move Energy; a build that collapsed any two would pass every
    // "was something attached" assertion in this file.
    //   · "to 1 of your Benched Pokémon"        → ONE park, batch pinned (`count`)
    //   · "to your Benched Pokémon in any way"  → N ops, N parks (`anyWay`)
    //   · "to each of your Benched Pokémon"     → NO park at all (`toEach`)
    expect(deriveAttackEffect(CLAUSES[FAULT_LINE_TEXT].text)).toEqual([
      { op: "attachEnergyFrom", source: "discard", benchOnly: true, count: 2 },
    ]);
    expect(deriveAttackEffect(CLAUSES[BENCH_ANY_WAY_TEXT].text)).toHaveLength(2);
    const spread = deriveAttackEffect(CLAUSES[MUD_STOCK_TEXT].text) ?? [];
    expect(spread).toHaveLength(1);
    // Exactly one member set, on each of the three.
    for (const program of [spread]) {
      for (const op of program) {
        expect("count" in op).toBe(false);
      }
    }
  });

  it("🛑 the two CROSSES the spread destination refuses, and they refuse for PRINT reasons", () => {
    // Both are expressible at the OP level and are refused by the DERIVER, which
    // is the distinction this repo draws everywhere: a registry program may spell
    // either deliberately the day a card prints one, and no sentence gets to
    // derive to a reading nobody printed.
    //   · "up to N … to each of them" is AMBIGUOUS IN PRINT (N per body, or N
    //     shared out?). No catalog sentence spells it.
    //   · a heal tail names ONE body ("that Pokémon") and a spread fed N, so the
    //     pronoun has no referent — `anyWay`'s refusal one distribution over.
    for (const text of [
      "Attach up to 2 Basic {F} Energy cards from your discard pile to each of your Benched Pokémon.",
      "Attach up to 3 Basic Energy cards from your discard pile to each of your Pokémon.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // The heal tail is the HAND anchor's optional group, so the cross is spelled
    // in that zone — the only one whose clause carries a tail at all.
    expect(
      deriveAttackEffect(
        "Attach a Basic {F} Energy card from your hand to each of your Benched Pokémon. If you do, heal all damage from that Pokémon.",
      ),
    ).toBeNull();
    // …and the SAME hand sentence WITHOUT the tail derives, which is what says
    // the refusal above is about the tail and not about the zone. **A widened
    // MAP KEY transfers across every zone the factory serves** — D246's noun
    // finding, arriving at the destination table.
    expect(
      deriveAttackEffect(
        "Attach a Basic {F} Energy card from your hand to each of your Benched Pokémon.",
      ),
    ).toEqual([
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Fighting",
        benchOnly: true,
        toEach: true,
      },
    ]);
  });

  it("`programPlayable` needs ZERO arms for the spread — priced by grep, then driven", () => {
    // The gate already reads `attachEnergyTargets(state, seat, op)`, which is the
    // SAME set the fold walks, so a spread with no eligible body is refused with
    // no `toEach` arm of its own. Both printings are ATTACKS (which skip this
    // gate entirely), so this is structural insurance for the day an Ability
    // prints the sentence — driven rather than asserted in a comment.
    const program = deriveAttackEffect(CLAUSES[MUD_STOCK_TEXT].text) ?? [];
    const stocked = ready(15, { discard: { "fix-fighting-energy": 3 } });
    expect(programPlayable(stocked, program, "p1")).toBe(true);
    // An empty Bench: the eligible set is empty, so the attach can only whiff.
    const benchless = ready(15, { bench: [], discard: { "fix-fighting-energy": 3 } });
    expect(programPlayable(benchless, program, "p1")).toBe(false);
    // An empty pile: the other half of the same gate, unchanged by this slice.
    const empty = ready(15, { discard: {} });
    expect(programPlayable(empty, program, "p1")).toBe(false);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 6. 🆕 D360 — THE PRINTED "up to" REACHES THE SPREAD
// ─────────────────────────────────────────────────────────────────────────────
//
// D358 bought `attachEnergyFrom.declinable` for two HAND-AUTHORED spreads;
// D359 bought `count`'s ceiling for the BATCH and taught the park to read both
// through ONE prompt key (`upTo = op.count ?? (op.declinable === true ? 1 :
// undefined)`). Neither reached the spread THIS FILE's arm builds, so
// *"attach up to 2 … in any way you like"* was still an EXACT 2 on every
// printing the deriver owns: 3 sentences / 4 Standard-legal printings —
// Morpeko `sv06-072`, Lycanroc `sv05-090`, Mesprit `sv08-079`/`sv08-204`
// (remote D1 `luminous`, 2026-08-18, `$.effect` over all three text columns;
// the family's `LIKE '%ttach up to%'` census is 23 sentences / 53 printings /
// 24 legal and partitions 13 + 6 + 4 + 1).
//
// 🛑 **THE ENGINE PRICE IS ONE EXPRESSION AND ZERO NEW VOCABULARY.** No op
// field, no prompt field, no choice field, no wire byte, no schema, no new arm.
// `MATCH_RECORD_VERSION` STAYS 22: an `EffectOp` IS persisted
// (`EffectContinuation.pendingOp`), so the question is live — but a v22 record
// holding a flagless `attachEnergyFrom` reads back MANDATORY, which is exactly
// what it meant when it was written. Absence meant mandatory before and means
// mandatory after: D358's WIDENING case, not D352/D359's RENAME case.

describe("D360 §6 — the discriminator is the PRINTED word, not the derived count", () => {
  it("🛑 'up to 1' and the unhedged singular derive to the SAME op count and DIFFERENT flags", () => {
    // ⚠️ THE FALSIFIABILITY PAIR, AND IT IS A LIVE NEAR-MISS RATHER THAN A
    // CONSTRUCTED ONE. `count` is the DERIVED value and defaults to 1 when the
    // hedge is absent, so `count > 1` reads the hedge off the NUMBER instead of
    // off the PRINT — and on these two sentences the two readings disagree while
    // every other observable is identical: same arm, same op, same source, same
    // destination, same ONE op emitted. §9.1 rules that "up to N" makes every k
    // in 0..N a printed answer, so "up to 1" is {0, 1} — declinable — and the
    // article form is a mandatory 1. Both spellings of the gate compile; only
    // `match[3]` reads the print.
    const hedged = deriveAttackEffect(
      "Attach up to 1 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
    );
    const bare = deriveAttackEffect(
      "Attach a Basic Energy card from your discard pile to your Pokémon in any way you like.",
    );
    expect(hedged).toEqual([{ op: "attachEnergyFrom", source: "discard", declinable: true }]);
    expect(bare).toEqual([{ op: "attachEnergyFrom", source: "discard" }]);
    // The two are ONE op each — so a build that inferred the hedge from the
    // PROGRAM'S LENGTH, or from `count`, cannot tell them apart at all.
    expect(hedged).toHaveLength(1);
    expect(bare).toHaveLength(1);
  });

  it("the flag is scoped to the SPREAD — it never lands beside `count`", () => {
    // ⚠️ MEASURED, NOT TIDY. Hoisted into the shared `base` the flag would ride
    // the BATCH branch too, where D359's `??` already spends the same printed
    // word through `count` — so it would be behaviourally dead AND would put two
    // keys on one axis, which `attachDecline.test.ts` §1 pins across the whole
    // registry. Asserted here over every sentence this arm reads so the scoping
    // cannot rot into a comment.
    for (const { text, program } of CLAUSES) {
      const derived = (deriveAttackEffect(text) ?? []) as Record<string, unknown>[];
      expect(derived, text).toEqual(program);
      for (const op of derived) {
        expect(op.declinable === true && op.count !== undefined, text).toBe(false);
        // …and every op of a hedged SPREAD carries it, never just the first: a
        // player who could stop before the first card but not between the others
        // has not been given what "up to" says.
        if (derived.length > 1) expect(op.declinable, text).toBe(true);
      }
    }
  });

  it("🛑 the CROSS-SEAT hedge is still refused, and that is measured rather than assumed", () => {
    // Grafaiai `sv08-121` — "Attach up to 3 Energy cards from your **opponent's**
    // discard pile to **their** Pokémon in any way you like." — 1 Standard-legal
    // printing, and the one member of the family no op in this vocabulary can
    // express. It is the 24th of the 24 and it stays null: this slice widened the
    // flag, not the arm.
    expect(
      deriveAttackEffect(
        "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      ),
    ).toBeNull();
  });
});

describe("D360 §7 — Morpeko's printed {0, 1, 2}, driven on a board", () => {
  /** The spread's three answers over the same board: two eligible Bench bodies
      plus the un-narrowed attacker, and three {C} in the pile so AVAILABILITY is
      never what bounds the result. */
  const stocked = (seed: number): GameState => ready(seed, { discard: { "fix-energy": 3 } });

  it("TWO — the pre-D360 behaviour, still reachable and still the default", () => {
    const parked = mustApply(stocked(21), {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    }).state;
    const first = pick(parked, benchRef(0));
    const second = pick(first.state, benchRef(1));
    expect(all([...first.events, ...second.events], "ENERGY_ATTACHED")).toHaveLength(2);
    expect(second.state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 ONE — the printed MIDDLE answer, UNREACHABLE on this sentence before D360", () => {
    // 🛑 THE DEFECT, NAMED: the engine spent the printed "up to" against
    // AVAILABILITY (a second op with nothing left to move no-ops) and NEVER
    // against the player's WILL. On a stocked pile the second op had a candidate
    // and a source, so it resolved, and a controller who wanted ONE got two — out
    // of their own discard pile, onto their own bodies.
    const parked = mustApply(stocked(22), {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    }).state;
    const first = pick(parked, benchRef(0));
    expect(first.state.phase.kind).toBe("effect:choose"); // the second decision
    const declined = mustApply(first.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon" }, // no `ref` — the decline
    });
    expect(all(declined.events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(declined.state.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(declined.state.players.p1.bench[1]?.energy).toHaveLength(0);
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    // 🛑 THE DECLINE IS NOT A WHIFF, and this is the assertion that says so: the
    // pile still holds two legal {C} and the board still holds three eligible
    // bodies. The op could have resolved and the PLAYER said no.
    expect(declined.state.players.p1.discard).toHaveLength(2);
  });

  it("🛑 ZERO — and on an ATTACK it has no other route, which is why this half broke differently", () => {
    // ⚠️ THE HALVES OF THIS FAMILY ARE BROKEN DIFFERENTLY, WHICH D359 FOUND ONE
    // AXIS OVER AND WHICH REPEATS HERE. Koraidon ex's spread is an ABILITY with a
    // printed "you may", so declining the ABILITY already bought the zero and the
    // engine reached {0, 2}. These four printings are ATTACKS — declared and
    // resolved, with no `optional` anywhere in the program — so the zero was
    // unreachable too and the engine reached **{2} ALONE**. Same sentence shape,
    // same op, same missing flag, two different broken answer sets.
    const parked = mustApply(stocked(23), {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    }).state;
    let cur = parked;
    for (let i = 0; i < 2; i++) {
      expect(cur.phase.kind, `park ${i + 1}`).toBe("effect:choose");
      cur = mustApply(cur, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon" },
      }).state;
    }
    expect(cur.phase.kind).not.toBe("effect:choose");
    expect(cur.players.p1.bench[0]?.energy).toHaveLength(0);
    expect(cur.players.p1.bench[1]?.energy).toHaveLength(0);
    expect(cur.players.p1.active?.energy).toHaveLength(1); // the {C} attack cost, untouched
    expect(cur.players.p1.discard).toHaveLength(3); // nothing left the pile
  });

  it("the ceiling reaches the PROMPT as `upTo: 1`, which is the whole wire cost", () => {
    // D359's key, unchanged and un-widened: at this prompt `declinable` IS
    // `upTo: 1` — take the one on offer, or take none. **A SPREAD OP CARRIES NO
    // `count`**, so the `??` falls through to the flag, and the caption stays the
    // singular one ("the Energy", not "up to N Energy") because the printed count
    // sizes the PROGRAM here rather than the batch.
    const parked = mustApply(stocked(24), {
      type: "attack",
      seat: "p1",
      index: PICK_AND_STICK,
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(prompt.upTo).toBe(1);
    expect(prompt.note).toContain("the Energy");
    expect(prompt.candidates).toHaveLength(3);
  });
});
