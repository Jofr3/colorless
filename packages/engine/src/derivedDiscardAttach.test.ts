import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { POKEMON_TYPE_BY_CODE, POKEMON_TYPES, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
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
    program: [
      { op: "attachEnergyFrom", source: "discard" },
      { op: "attachEnergyFrom", source: "discard" },
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
    program: [
      { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", benchOnly: true },
      { op: "attachEnergyFrom", source: "discard", energyType: "Fighting", benchOnly: true },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
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

/** 🛑 THE FIVE LEGAL PRINTINGS THIS SLICE DOES **NOT** READ, each with the reason
    it is out of reach and its legal count. They are pinned derived-to-null so the
    residue is a fact about the code rather than a note in a doc — and they are
    FOUR different blockers, which is why they go back to the backlog as one
    measured row instead of "the rest of row 9".

    ⚠️ NONE of the four is a widening of this anchor. Three want something the OP
    cannot say and the fourth belongs to a different reader entirely. */
const UNREAD: readonly (readonly [string, number, string])[] = [
  [
    "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.",
    2,
    "a spread with NO decision in it — `attachEnergyFrom` attaches to ONE `ref`, and the 'in any way you like' expansion still asks WHERE each card goes",
  ],
  [
    "Attach an Energy card from your discard pile to this Pokémon.",
    1,
    "`attachableEnergies` admits `energyType === \"Normal\"` only, so a Special Energy is out of reach of the OP rather than of the anchor",
  ],
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

/** The rotated-only sentence that is the SAME blocker as `UNREAD[0]` wearing a
    leading clause. Kept apart from `UNREAD` because it has no legal printing and
    would otherwise inflate that table's arithmetic. */
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

/** Answer a parked `choosePokemon` with `ref`. */
function pick(state: GameState, ref: PokemonRef): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
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

  it("adds up: 12 of the row's 17 legal printings, across 8 of its 12 sentences", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one destination row would still pass every accept case above.
    expect(CLAUSES).toHaveLength(8);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(12);
    // …and the residue, which is the other half of the same census: 5 more legal
    // printings over 4 sentences, each pinned derived-to-null so the deferral has
    // a live subject.
    expect(UNREAD).toHaveLength(4);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(5);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    // 12 + 5 = 17, which is exactly what the backlog row measured. This is the
    // FIRST row on that page whose count survived re-derivation unchanged.
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 5).toBe(17);
    expect(CLAUSES.length + UNREAD.length).toBe(12);
  });

  it("reads 37 of the family's 43 CATALOG printings too — an arm transfers", () => {
    // The wider population, because a row that only counts the legal pool
    // under-states what an arm buys: the same GLOB over all 3,786 rows returns 43
    // printings on 26 sentences, and this arm reads 37 on 21.
    expect(CLAUSES.reduce((sum, c) => sum + c.printings, 0)).toBe(19);
    // The 21 read sentences are the 8 above plus 13 more that differ ONLY in a
    // brace code or a count — all rotated, none needing a line of code. Their
    // printings are what makes 19 into 37, and the two rows below are the ones
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
    // …and the rotated-only "each of them" printing is refused for `UNREAD[0]`'s
    // reason, wearing a leading clause.
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

  it("carries NO new op and NO new op FIELD — the honest price of the arm", () => {
    // Every arm emits `attachEnergyFrom`, which the ABILITY path has run since M5,
    // and every key any of them sets already existed: `source`/`energyType` (M5),
    // `targetType`/`benchOnly` (D204), `count`/`toSelf` (D205/D221).
    const known = new Set([
      "op",
      "source",
      "energyType",
      "count",
      "targetType",
      "benchOnly",
      "toSelf",
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
    expect(attacks()).toHaveLength(54);
    expect(attacks()[REGI_CHARGE]?.effect).toBe(CLAUSES[REGI_CHARGE_TEXT].text);
    expect(attacks()[SAND_GIFT]?.effect).toBe(CLAUSES[SAND_GIFT_TEXT].text);
    expect(attacks()[FAULT_LINE]?.effect).toBe(CLAUSES[FAULT_LINE_TEXT].text);
    expect(attacks()[PICK_AND_STICK]?.effect).toBe(CLAUSES[PICK_AND_STICK_TEXT].text);
    expect(attacks()[DRAGONS_FURY]?.effect).toBe(CLAUSES[DRAGONS_FURY_TEXT].text);
    // …and the one that is DELIBERATELY UNREAD, fielded so the refusal has a live
    // subject on a real board rather than a comment (D181's `Strafe` precedent).
    expect(attacks()[MUD_STOCK]?.effect).toBe(UNREAD[0]?.[0]);
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
    expect(deriveAttackEffect(attacks()[MUD_STOCK]?.effect ?? "")).toBeNull();
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

    // ⚠️ A `toSelf` attach can offer AT MOST ONE target, so `parkOrForce` always
    // forces — the attack finishes in one action. That is the discriminator
    // against a build that dropped `toSelf` and let a class rider stand in: with
    // two Benched bodies here, THAT build parks.
    expect(done.phase.kind).not.toBe("effect:choose");
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    for (const e of attached) expect(e.target).toEqual({ spot: "active" });
    // 🛑 AND THE TYPE FILTER BIT: the pile holds two {F} and two {W}, and only the
    // {F} moved. A build that dropped `energyType` takes the first two cards in
    // the pile whatever they are.
    expect(done.players.p1.active?.energy).toHaveLength(3); // the {C} cost + two {F}
    const moved = attached.map((e) => done.cardIdByUid[e.uid]);
    expect(moved).toEqual(["fix-fighting-energy", "fix-fighting-energy"]);
    expect(done.players.p1.discard).toHaveLength(before - 2);
    expect(done.players.p1.discard.map((u) => done.cardIdByUid[u])).toEqual([
      "fix-water-energy",
      "fix-water-energy",
    ]);
    expect(activeUid(done, "p1")).toBe(attacker);
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
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: REGI_CHARGE,
    });
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.active?.energy).toHaveLength(2); // the {C} cost + one {F}
    expect(done.players.p1.discard).toHaveLength(0);
  });

  it("🛑 the UNREAD sentence is on the board and resolves to NOTHING", () => {
    // The refusal with a live subject. `Mud Stock` is a real printed attack on the
    // demonstrator with a stocked pile and two Benched bodies in front of it — and
    // the effect is SKIPPED, because no reader resolves it. A slice that widened
    // this anchor to swallow "each of your Benched Pokémon" would turn this red.
    const state = ready(15, { discard: { "fix-fighting-energy": 3 } });
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: MUD_STOCK,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(3);
    expect(done.players.p1.bench.every((p) => p.energy.length === 0)).toBe(true);
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
