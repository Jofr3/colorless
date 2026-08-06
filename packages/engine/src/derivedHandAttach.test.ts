import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  HAND_ATTACH_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handToDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

// 0.151.0 → 0.152.0 — D236, ATTACH FROM THE HAND: row 12 of
// `coverage-backlog-legal.md`, D234's anchor with ONE WORD CHANGED, and the
// CONTROL for D235's own finding.
//
// ✅ THE ROW'S COUNT RE-DERIVES TO THE DIGIT, AND FOR THE THIRD ROW RUNNING THE
// WHOLE ROW DOES. Remote D1 `luminous`, `json_each` + `GLOB` (never `LIKE`),
// grouped BY SENTENCE, over ALL THREE text columns, `legal_standard = 1`, on
// 2026-08-06:
//
//   WHERE t GLOB '*ttach*Energy card*from your hand*'
//   -- attack 16 printings / 8 sentences · ability 29 / 8 · effect 0 / 0
//
// The row says **16 (8 sentences) · 10 · 0**. The attack half is exact on BOTH
// figures; the ability half is 29 minus the 19 already authored (Teal Dance's
// 8-printing sentence, Iono's 5, Ethan's 4, the two `sv10.5w` reprints); the
// Trainer column is a measured ZERO rather than a subtraction — a first on this
// page. **26 = 26.**
//
// 🛑 AND THE POINT OF THE SLICE IS THE GRADE, NOT THE PRINTINGS. D235 found that
// *"a destination table is not portable between two ops just because its keys
// are"*, and named row 12 as the control: SAME op, so the table SHOULD port. It
// does — `DISCARD_ATTACH_DESTINATIONS` is reused VERBATIM, not one new key —
// **and it bought almost nothing.**
//
// 🆕 **A SOURCE-ZONE MIRROR TRANSFERS THE ANCHOR, NOT THE FAMILY.** D234 read 12
// of 17 with this shape. The same shape reads **9 of 16** here, and only 6 of
// those without a new op field, because the two zones are printed in DIFFERENT
// GRAMMAR: the discard side spells bare imperatives, the hand side wraps them in
// *"You may …"*, *"any number of"*, *"Before doing damage, …"* and *"Switch this
// Pokémon … If you do, …"*. Six of this row's sixteen printings are blocked by a
// LEADING CLAUSE or an UNBOUNDED COUNT — two categories the discard side does not
// print even once. **The ratio a family earned in one zone does not travel with
// its anchor.**
//
// ⚠️ WHAT THIS FILE IS FOR. `attachEnergyFrom` has run since M5 and
// `attachEnergyFrom.test.ts` owns the op's own behaviour; `derivedDiscardAttach.test.ts`
// owns the anchor's shape one zone over. What is NEW here is (a) that the two
// zones are ONE factory rather than two regexes that could drift, and (b) the
// `healTarget` field, whose whole risk is that the obvious cheaper build —
// `recordAs` → `recordGate` → `healChosen` — heals a Pokémon the card never
// named. Every case below that could survive that build is paired with one that
// could not.

/** The four sentences this arm reads, with the program each derives to and the
    printings measured for it. Both figures per row: `printings` over the whole
    remote catalog (3,786 rows / 20 sets), `legalPrintings` over the Standard pool
    (2,021 rows) — a count without a POPULATION and a LEGALITY is not a fact. */
const CLAUSES = [
  {
    text: "Attach a Basic Energy card from your hand to this Pokémon.",
    program: [{ op: "attachEnergyFrom", source: "hand", toSelf: true }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach a Basic Energy card from your hand to 1 of your Pokémon.",
    program: [{ op: "attachEnergyFrom", source: "hand" }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like.",
    program: [
      { op: "attachEnergyFrom", source: "hand", energyType: "Psychic" },
      { op: "attachEnergyFrom", source: "hand", energyType: "Psychic" },
    ] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    text: "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal all damage from that Pokémon.",
    program: [
      {
        op: "attachEnergyFrom",
        source: "hand",
        energyType: "Grass",
        benchOnly: true,
        healTarget: "all",
      },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 3,
  },
] as const;

const WRAPPED_TEXT = 0;
const LUCKY_TEXT = 1;
const FULL_HEART_TEXT = 2;
const LEAFLET_TEXT = 3;

/** 🛑 THE SEVEN LEGAL PRINTINGS THIS SLICE DOES **NOT** READ, each with the
    reason it is out of reach and its legal count. Pinned derived-to-null, so the
    residue is a fact about the code rather than a note in a doc.

    ⚠️ **NOT ONE OF THEM IS ABOUT THE DESTINATION** — every one names a phrase
    `DISCARD_ATTACH_DESTINATIONS` already spells. That is the third clause of
    D235's written prediction, graded CORRECT. What blocks them is the NOUN, the
    COUNT and the LEADING CLAUSE, and the last two are categories the discard side
    does not print at all. */
const UNREAD: readonly (readonly [string, number, string])[] = [
  [
    "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
    4,
    "an UNBOUNDED count under an optional wrapper: the spread branch grows the program one op per printed unit, and 'any number' names no unit — the shape `attachFromTop.max: \"any\"` expresses one op over, where the park answers with a MAP from card to target",
  ],
  [
    "Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.",
    1,
    "`attachableEnergies` admits `energyType === \"Normal\"` only, so a Special Energy is out of reach of the OP rather than of the anchor — D234's residue, printed again one zone over",
  ],
  [
    "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.",
    1,
    "a LEADING clause, and a gated one: `switchActive {recordAs}` → `recordGate` → this attach is expressible today, but it is a different SENTENCE SHAPE and therefore its own arm (D232)",
  ],
  [
    "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.",
    1,
    "two sentences, an unbounded count AND an ORDERING clause ('Before doing damage') that no reader in this engine can honour — the multiply fold reads the board at declaration",
  ],
] as const;

/** 🛑 THE FAMILY'S NEAR MISS, AND IT IS A CATALOG ROW RATHER THAN A CONSTRUCTION:
    the same verb and the same destination with the SOURCE zone flipped back.
    `derivedDiscardAttach.test.ts` holds the mirror of this assertion, so neither
    anchor can grow into the other without one of the two suites going red. */
const DISCARD_SIDE_NEAR_MISS =
  "Attach a Basic Energy card from your discard pile to 1 of your Pokémon.";

// ── The board. Indices 43-47 on `fix-trainerops`, appended by D236. ──
const WRAPPED_IN_WIND = 43;
const LUCKY_ATTACHMENT = 44;
const FULL_HEART = 45;
const LEAFLET_BLESSINGS = 46;
const TROPICAL_FRENZY = 47;

/** Every Basic Energy line this deck carries — the hand is DRAWN rather than
    placed, so a board that means "no {G} in hand" has to say which cards to send
    back, and a board that means "exactly two {P}" has to clear the draw first. */
const ENERGY_LINES = ["fix-energy", "fix-psychic-energy", "fix-grass-energy"] as const;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: HAND_ATTACH_DECK, p2: HAND_ATTACH_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order and a HAND stocked line by line — every drawn Energy is
    returned to the deck first, so what the hand holds is exactly what `hand` says
    and never what the shuffle happened to deal. p2 is a plain body so nothing on
    the other side of the table can be reached by accident. */
function ready(
  seed: number,
  {
    bench = ["fix-basic-1", "fix-basic-1"],
    hand = {},
  }: { bench?: readonly string[]; hand?: Partial<Record<string, number>> },
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of ENERGY_LINES) state = handToDeck(state, "p1", id);
  for (const [id, count] of Object.entries(hand)) {
    state = handFromDeck(state, "p1", id, count ?? 0);
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
// 1. THE ANCHOR — one word from row 9, and the arithmetic that says so
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — four printed sentences, ONE arm, ONE word from the discard side", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 9 of the row's 16 legal printings, across 4 of its 8 sentences", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one destination row would still pass every accept case above.
    expect(CLAUSES).toHaveLength(4);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(9);
    // …and the residue, which is the other half of the same census: 7 more legal
    // printings over 4 sentences, each pinned derived-to-null so the deferral has
    // a live subject.
    expect(UNREAD).toHaveLength(4);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(7);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    // 9 + 7 = 16 on 4 + 4 = 8 sentences, which is exactly what the backlog row
    // measured. THREE rows running whose count survived re-derivation unchanged.
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) + 7).toBe(16);
    expect(CLAUSES.length + UNREAD.length).toBe(8);
  });

  it("🆕 the MIRROR bought 9 of 16 where the discard side bought 12 of 17 — the finding", () => {
    // ⚠️ THE NUMBER THIS SLICE EXISTS TO PIN. The anchor is the same factory call
    // with a different zone phrase, and the yield is not the same, because the
    // BLOCKERS are not the same: six of the seven refused printings carry a
    // leading clause or an unbounded count, and the discard family prints neither
    // shape even once. A future census that re-prices a "mirror" row off its
    // sibling's ratio has to walk past this assertion.
    const leadingOrUnbounded = UNREAD.filter(
      ([text]) => !text.startsWith("Attach ") || text.includes("any number"),
    );
    expect(leadingOrUnbounded).toHaveLength(3);
    expect(leadingOrUnbounded.reduce((sum, [, legal]) => sum + legal, 0)).toBe(6);
    // …and the ONE remaining blocker is the one the discard side ALSO printed
    // (D234's residue, second row): a Special Energy noun the OP cannot express.
    expect(UNREAD[1]?.[0]).toContain("Attach an Energy card");
  });

  it("reads 13 of the family's 24 CATALOG printings — an arm transfers across sets", () => {
    // The wider population, because a row that only counts the legal pool
    // under-states what an arm buys: the same GLOB over all 3,786 rows returns 24
    // printings on 13 sentences, and this arm reads 13 on 6.
    expect(CLAUSES.reduce((sum, c) => sum + c.printings, 0)).toBe(9);
    // The two extra sentences are ROTATED-ONLY and cost nothing — one is a brace
    // code on a destination the table already spells, the other is the heal row's
    // sentence WITHOUT its tail, which is the optional group doing its job.
    expect(
      deriveAttackEffect("Attach a Basic {F} Energy card from your hand to 1 of your Pokémon."),
    ).toEqual([{ op: "attachEnergyFrom", source: "hand", energyType: "Fighting" }]);
    expect(
      deriveAttackEffect(
        "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon.",
      ),
    ).toEqual([{ op: "attachEnergyFrom", source: "hand", energyType: "Grass", benchOnly: true }]);
    // 9 + 3 + 1 = 13 read printings over the catalog.
    expect(9 + 3 + 1).toBe(13);
  });

  it("🛑 the SOURCE side is one word from row 9, and this anchor does not touch it", () => {
    // A CATALOG ROW, not a construction. `derivedDiscardAttach.test.ts` asserts
    // the same thing pointing the other way, so a build that widened either
    // anchor to `from your (hand|discard pile)` turns BOTH suites red.
    expect(deriveAttackEffect(DISCARD_SIDE_NEAR_MISS)).toEqual([
      { op: "attachEnergyFrom", source: "discard" },
    ]);
    expect(deriveAttackEffect(CLAUSES[LUCKY_TEXT].text)).toEqual([
      { op: "attachEnergyFrom", source: "hand" },
    ]);
    // The two differ in exactly ONE key, which is the whole claim the shared
    // factory makes structural.
    const [hand] = deriveAttackEffect(CLAUSES[LUCKY_TEXT].text) ?? [];
    const [discard] = deriveAttackEffect(DISCARD_SIDE_NEAR_MISS) ?? [];
    expect({ ...hand, source: "discard" }).toEqual(discard);
  });

  it("✅ D235's DESTINATION TABLE ports VERBATIM — the control, graded", () => {
    // 🛑 THE ASSERTION THIS SLICE WAS SCHEDULED FOR. D235 could not express
    // "attach them to 1 of your Pokémon" at count > 1 because `attachFromDeck`
    // has no `count`; the claim was that the phrases were never the problem. Here
    // the op DOES have `count`, and every destination row behaves — including the
    // one that had ZERO legal printings when D234 wrote it.
    for (const [phrase, riders] of [
      ["this Pokémon", { toSelf: true }],
      ["1 of your Pokémon", {}],
      ["1 of your Benched Pokémon", { benchOnly: true }],
      ["1 of your {P} Pokémon", { targetType: "Psychic" }],
    ] as const) {
      expect(
        deriveAttackEffect(`Attach a Basic Energy card from your hand to ${phrase}.`),
        phrase,
      ).toEqual([{ op: "attachEnergyFrom", source: "hand", ...riders }]);
    }
    // …and `count`, the field whose ABSENCE was D235's whole blocker, is
    // available here and pins the batch onto one body exactly as it does one zone
    // over. ⚠️ NO LEGAL ATTACK PRINTING IN THIS FAMILY SPELLS IT — the control is
    // therefore UNEXERCISED by the pool rather than confirmed by it, which is
    // recorded rather than glossed: a prediction can be vacuous as well as wrong.
    expect(
      deriveAttackEffect("Attach up to 2 Basic Energy cards from your hand to 1 of your Pokémon."),
    ).toEqual([{ op: "attachEnergyFrom", source: "hand", count: 2 }]);
    expect(
      CLAUSES.some((c) => c.text.includes("up to") && c.text.includes("to 1 of your")),
    ).toBe(false);
  });

  it("refuses the anchor, grammar, punctuation and case rewrites", () => {
    const bare = CLAUSES[LUCKY_TEXT].text;
    const rewrites = [
      // A leading clause — and THE POOL HAS TWO REAL ONES (`UNREAD[2]`/`UNREAD[3]`).
      `Draw a card. ${bare}`,
      // A trailing clause. ⚠️ THIS IS WHAT MAKES THE `$` OBSERVABLE HERE: the
      // optional heal group means an unrecognised tail is not refused by accident
      // (D234's dropped-`$` mutant survived until the destination class was
      // narrowed; this anchor's cannot).
      `${bare} Draw a card.`,
      `${CLAUSES[LEAFLET_TEXT].text} Draw a card.`,
      // Case, both ends.
      bare.replace("Attach", "attach"),
      bare.replace("Pokémon.", "pokémon."),
      // The trailing period.
      bare.slice(0, -1),
      // 🛑 THE GRAMMATICAL CROSSES the article/number weld exists to refuse.
      "Attach a Basic Energy cards from your hand to 1 of your Pokémon.",
      "Attach up to 2 Basic Energy card from your hand to 1 of your Pokémon.",
      // A printed 0 would derive to a program that moves nothing.
      "Attach up to 0 Basic Energy cards from your hand to 1 of your Pokémon.",
      // …and past the ingested-text ceiling, load-bearing on the spread branch.
      "Attach up to 11 Basic Energy cards from your hand to your Pokémon in any way you like.",
      // A destination the table does not name.
      "Attach a Basic Energy card from your hand to your opponent's Active Pokémon.",
      // A brace code the ENERGY map refuses ({C} is the provision fallback).
      "Attach a Basic {C} Energy card from your hand to this Pokémon.",
      // The Special-Energy noun — `UNREAD[1]`'s blocker without its tail.
      "Attach an Energy card from your hand to 1 of your Pokémon.",
      // 🛑 THE HEAL TAIL ON A SPREAD: "that Pokémon" names ONE body, and a
      // distribution has N. Refused to the loud path rather than guessing.
      "Attach up to 2 Basic {G} Energy cards from your hand to your Pokémon in any way you like. If you do, heal all damage from that Pokémon.",
      // …and a tail this anchor does not spell at all.
      "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal 60 damage from that Pokémon.",
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("carries ONE new op field and no new OP — the honest price of the arm", () => {
    // Every arm emits `attachEnergyFrom`, which the ABILITY path has run since M5.
    // `source`/`energyType` (M5), `targetType`/`benchOnly` (D204), `count`/`toSelf`
    // (D205/D221) all existed; `healTarget` did NOT, and this slice predicted in
    // writing that it would not need one. ⚠️ THE PREDICTION LOST, and the field is
    // named here so the loss is a fact in the suite rather than a line in a doc.
    const known = new Set([
      "op",
      "source",
      "energyType",
      "count",
      "targetType",
      "benchOnly",
      "toSelf",
      "healTarget",
    ]);
    for (const { program } of CLAUSES) {
      for (const op of program) {
        expect(op.op).toBe("attachEnergyFrom");
        for (const key of Object.keys(op)) expect(known, `${key}`).toContain(key);
      }
    }
    // …and exactly ONE of the four sentences pays for it.
    const withHeal = CLAUSES.filter(({ program }) =>
      program.some((op) => Object.hasOwn(op, "healTarget")),
    );
    expect(withHeal).toHaveLength(1);
    expect(withHeal[0]?.legalPrintings).toBe(3);
    // The ONLY amount this column prints is "all" — the numeric arm of the field
    // belongs to the row's Ability half and rides `healChosen`'s already-driven
    // clamp, so no deriver emits a number today.
    for (const { program } of CLAUSES) {
      for (const op of program) {
        if (op.op === "attachEnergyFrom" && op.healTarget !== undefined) {
          expect(op.healTarget).toBe("all");
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FIXTURE — the printings, present and pinned
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — the demonstrator carries five of the sentences at 43-47", () => {
  const attacks = () => FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];

  it("fields the family at indices 43-47, appended and not inserted", () => {
    // 48 at D236, which appended 43-47; 43 at D235, which appended 35-42; 35 at
    // D234 (29-34); 29 at D232 (25-28); 25 at D231, 20 at D230, 17 at D229, 14 at
    // D228, 13 at D227, 9 at D189, 8 at D181. TEN slices, ten appends, zero
    // inserts — which is what every index constant in ten suites depends on.
    // ⚠️ FIFTY-FIVE AT D240; **58 at D241**, which appended 55-57 (look at the
    // top N — "Summoning Gate" / "Larimar Rain" / "Dig It Up").
    // `derivedLookAtTop.test.ts` owns 55-57. ELEVEN slices, eleven appends, zero
    // inserts.
    expect(attacks()).toHaveLength(58);
    expect(attacks()[WRAPPED_IN_WIND]?.effect).toBe(CLAUSES[WRAPPED_TEXT].text);
    expect(attacks()[LUCKY_ATTACHMENT]?.effect).toBe(CLAUSES[LUCKY_TEXT].text);
    expect(attacks()[FULL_HEART]?.effect).toBe(CLAUSES[FULL_HEART_TEXT].text);
    expect(attacks()[LEAFLET_BLESSINGS]?.effect).toBe(CLAUSES[LEAFLET_TEXT].text);
    // …and the one that is DELIBERATELY UNREAD, fielded so the refusal has a live
    // subject on a real board rather than a comment (D181's `Strafe` precedent).
    expect(attacks()[TROPICAL_FRENZY]?.effect).toBe(UNREAD[0]?.[0]);
    // The indices the sibling suites address by constant did not move.
    expect(attacks()[29]?.effect).toBe(
      "Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon.",
    );
    expect(attacks()[42]?.effect).toBe(
      "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
    );
  });

  it("NO printed base damage on any of the five — and on ONE that is a divergence", () => {
    for (const index of [
      WRAPPED_IN_WIND,
      LUCKY_ATTACHMENT,
      FULL_HEART,
      LEAFLET_BLESSINGS,
      TROPICAL_FRENZY,
    ]) {
      expect(attacks()[index]?.damage, `index ${index}`).toBeUndefined();
    }
    // Alolan Exeggutor ex really prints 150 on `TROPICAL_FRENZY`; dropped so a
    // base-damage KO cannot put a promotion prompt in front of the assertion that
    // NOTHING was attached. The neighbouring index that DOES print a number still
    // does, so the omission is a choice rather than a fixture that lost its field.
    expect(attacks()[3]?.damage).toBe(60);
  });

  it("the demonstrator's own attack rows still DERIVE to this slice's programs", () => {
    // The round trip: the fixture strings are the CLAIM, so they are read back
    // through the deriver rather than compared to the constants alone. An arm
    // authored against a paraphrase passes a test written against the same
    // paraphrase and matches no real card (D183).
    expect(deriveAttackEffect(attacks()[LEAFLET_BLESSINGS]?.effect ?? "")).toEqual(
      CLAUSES[LEAFLET_TEXT].program,
    );
    expect(deriveAttackEffect(attacks()[TROPICAL_FRENZY]?.effect ?? "")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE POINT OF THE SLICE — where the Energy lands, and what it heals
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — an ATTACK pulling Energy out of the HAND", () => {
  it("the SELF target forces: no park, and the Energy lands on the attacker", () => {
    const state = ready(3, { hand: { "fix-energy": 2 } });
    const attacker = activeUid(state, "p1");
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: WRAPPED_IN_WIND,
    });

    // ⚠️ A `toSelf` attach can offer AT MOST ONE target, so `parkOrForce` always
    // forces. That is the discriminator against a build that dropped `toSelf` and
    // let an un-narrowed set stand in: with two Benched bodies here, THAT build
    // parks.
    expect(done.phase.kind).not.toBe("effect:choose");
    const attached = all(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(1);
    expect(attached[0]?.target).toEqual({ spot: "active" });
    expect(done.players.p1.active?.energy).toHaveLength(2); // the {C} cost + one more
    expect(done.players.p1.hand).toHaveLength(handBefore - 1);
    expect(activeUid(done, "p1")).toBe(attacker);
    // 🛑 THE ZONE ASSERTION, and it is the one this whole slice is about: the card
    // came out of the HAND and the discard pile never moved.
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
  });

  it("the UN-NARROWED destination offers every own body — the row with 0 legal at D234", () => {
    const state = ready(5, { hand: { "fix-energy": 2 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LUCKY_ATTACHMENT,
    });

    // Three candidates: the attacker and both Benched bodies. `benchOnly` excludes
    // the first, `toSelf` collapses to it — this row is neither, and it is the
    // destination phrase D234 could only read on rotated printings.
    const targets = parkedTargets(parked);
    expect(targets).toHaveLength(3);
    expect(targets).toContainEqual(ACTIVE_REF);
    for (const ref of targets) expect(ref.seat).toBe("p1");

    const { state: done, events } = pick(parked, benchRef(1));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(done.players.p1.bench[1]?.energy).toHaveLength(1);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(0);
  });

  it("🛑 'in any way you like' asks TWICE, and the two may land APART", () => {
    // D234's falsifiability pair, re-driven on this zone: the printed phrase is N
    // SEPARATE decisions, and the observable is that the second one exists.
    const state = ready(7, { hand: { "fix-psychic-energy": 2, "fix-energy": 2 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: FULL_HEART });
    expect(parkedTargets(parked)).toHaveLength(3);

    const first = pick(parked, benchRef(0));
    expect(first.state.phase.kind).toBe("effect:choose");
    expect(all(first.events, "ENERGY_ATTACHED")).toHaveLength(1);
    const second = pick(first.state, benchRef(1));
    expect(second.state.phase.kind).not.toBe("effect:choose");
    expect(all(second.events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(second.state.players.p1.bench[0]?.energy).toHaveLength(1);
    expect(second.state.players.p1.bench[1]?.energy).toHaveLength(1);
    // 🛑 AND THE TYPE FILTER BIT: the hand held two {P} and two {C}, and only the
    // {P} moved. A build that dropped `energyType` takes the first two Basic
    // Energy in hand order, whatever they are.
    const moved = [...all(first.events, "ENERGY_ATTACHED"), ...all(second.events, "ENERGY_ATTACHED")];
    for (const e of moved) expect(second.state.cardIdByUid[e.uid]).toBe("fix-psychic-energy");
  });

  it("🛑 the HEAL lands on the body that was just fed, with NO second question", () => {
    // ⚠️ THE ASSERTION `healTarget` EXISTS FOR, and the one a `recordGate` →
    // `healChosen` build cannot pass. TWO damaged Benched bodies: the printed
    // clause says "that Pokémon", so the damage that clears is the one on the body
    // the attach chose, and the program is OVER — a gate-plus-healChosen build
    // parks a SECOND time here and lets the controller heal bench[1] instead.
    let state = ready(9, { bench: ["fix-basic-1", "fix-basic-1"], hand: { "fix-grass-energy": 2 } });
    state = setBenchDamage(state, "p1", 0, 50);
    state = setBenchDamage(state, "p1", 1, 30);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LEAFLET_BLESSINGS,
    });
    // `benchOnly`: the attacker is not offered even though it is in play.
    const targets = parkedTargets(parked);
    expect(targets).toHaveLength(2);
    expect(targets).not.toContainEqual(ACTIVE_REF);

    const { state: done, events } = pick(parked, benchRef(0));
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    const healed = all(events, "HEALED");
    expect(healed).toHaveLength(1);
    expect(healed[0]?.amount).toBe(50);
    expect(healed[0]?.seat).toBe("p1");
    // "all" means all: the chosen body is clean, and the OTHER damaged body — the
    // one a second prompt would have let the player pick — is untouched.
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(done.players.p1.bench[1]?.damage).toBe(30);
    expect(done.players.p1.bench[0]?.energy).toHaveLength(1);
  });

  it("🛑 'If you do' is the WHIFF path, not a gate: no Energy, no heal", () => {
    // The same attack on a hand with no {G} at all. The attach cannot happen, so
    // the heal must not either — and the early returns inside `attachEnergyFrom`
    // ARE the printed condition. A build that healed first, or that healed
    // unconditionally after the attach call, clears 60 damage off a card that
    // moved nothing.
    let state = ready(11, { hand: { "fix-energy": 2 } });
    state = setBenchDamage(state, "p1", 0, 50);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LEAFLET_BLESSINGS,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(50);
  });

  it("🛑 a sentence with NO heal tail heals NOTHING, on a board that is DAMAGED", () => {
    // ⚠️ THE CONTROL THE MUTANT CORPUS ASKED FOR, AND IT WAS A REAL GAP: every
    // heal assertion above runs on the ONE sentence that prints the clause, so a
    // build whose heal was UNCONDITIONAL — `healChosen` on every
    // `attachEnergyFrom`, including the six registry Abilities that have carried
    // the op since M5 — passed all of them. Six of this row's nine printings print
    // no heal, and this is the board where that is observable.
    let state = ready(27, { hand: { "fix-energy": 2 } });
    state = setBenchDamage(state, "p1", 0, 50);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LUCKY_ATTACHMENT,
    });
    const { state: done, events } = pick(parked, benchRef(0));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(50);
    // …and the field really is absent from the program, not merely unset on this
    // board (the by-value comparison the registry rows depend on).
    expect(CLAUSES[LUCKY_TEXT].program[0]).not.toHaveProperty("healTarget");
  });

  it("an UNDAMAGED body heals 0 and emits NOTHING — `healChosen`'s silence, inherited", () => {
    // The single-arm rule: a heal that moves no damage is not an event. Pinned
    // because it is the one path where "the heal ran" and "the heal was visible"
    // come apart, and a future reader counting HEALED rows would otherwise be
    // measuring the board rather than the op.
    const state = ready(13, { hand: { "fix-grass-energy": 2 } });
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LEAFLET_BLESSINGS,
    });
    const { state: done, events } = pick(parked, benchRef(0));
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(1);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
  });

  it("🛑 the UNREAD sentence is on the board and resolves to NOTHING", () => {
    // The refusal with a live subject. `Tropical Frenzy` is the row's LARGEST
    // printed sentence (4 legal), on a real board with a stocked hand and two
    // Benched bodies in front of it — and the effect is SKIPPED, because no reader
    // resolves it. A slice that widened this anchor to swallow "any number" would
    // turn this red.
    const state = ready(15, { hand: { "fix-energy": 3, "fix-grass-energy": 2 } });
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TROPICAL_FRENZY,
    });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(done.players.p1.hand).toHaveLength(handBefore);
    expect(done.players.p1.bench.every((p) => p.energy.length === 0)).toBe(true);
  });

  it("the attach is the ATTACKER's own board, on both ends", () => {
    // The one-`otherSeat`-apart pairing every op in this family owes: a build that
    // read the opponent's hand, or benched the Energy on their side, would pass
    // every count assertion above.
    const state = ready(17, { hand: { "fix-energy": 2 } });
    const ownHand = new Set(state.players.p1.hand);
    const opponentHand = new Set(state.players.p2.hand);
    deepFreeze(state);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: LUCKY_ATTACHMENT,
    });
    for (const ref of parkedTargets(parked)) expect(ref.seat).toBe("p1");
    const { state: done, events } = pick(parked, benchRef(0));
    // ⚠️ p2's hand is compared as a SUPERSET, not by length: the pick finishes the
    // attack, which ends the turn, and p2 then DRAWS. A length assertion here
    // measures the turn boundary rather than the zone, which is the exact shape of
    // vacuous guard this repo keeps deleting.
    for (const uid of opponentHand) expect(done.players.p2.hand).toContain(uid);
    // The card that moved came out of the ATTACKER's hand.
    const [attached] = all(events, "ENERGY_ATTACHED");
    expect(ownHand.has(attached?.uid ?? "")).toBe(true);
    expect(done.players.p1.hand).not.toContain(attached?.uid);
    expect(done.players.p2.bench.every((p) => p.energy.length === 0)).toBe(true);
    expect(done.players.p2.active?.energy).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE READ SITES — priced by grep, driven both directions
// ─────────────────────────────────────────────────────────────────────────────

describe("the read sites this slice collides with", () => {
  it("🛑 `programPlayable` prices at ZERO for an ATTACK — but NOT because the gate is blind", () => {
    // ⚠️ THE ONE REAL DIFFERENCE FROM D234/D235's PRICING, and the resume point
    // called it: `attachEnergyFrom` IS gated in `cardplay.ts`, and the HAND is a
    // zone that gate can genuinely find empty. It prices at zero here only because
    // §8 says an attack is already declared and paid for — so the identical
    // program is REFUSED as a card play on the same board where the attack
    // resolves to a silent whiff. Both directions, on one board.
    const empty = ready(23, {});
    expect(programPlayable(empty, CLAUSES[WRAPPED_TEXT].program, "p1")).toBe(false);
    const stocked = ready(23, { hand: { "fix-energy": 1 } });
    expect(programPlayable(stocked, CLAUSES[WRAPPED_TEXT].program, "p1")).toBe(true);
    // …and the attack path ignores the gate entirely: same empty hand, and the
    // attack still declares.
    deepFreeze(empty);
    const { events } = mustApply(empty, { type: "attack", seat: "p1", index: WRAPPED_IN_WIND });
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
  });

  it("⚠️ `MATCH_RECORD_VERSION` STAYS 12 — the derivation, not the habit", () => {
    // D205's reading, a fifth time and the first in three slices that could have
    // owed a bump: `healTarget` is an OPTIONAL rider on an op that DOES park, so
    // an old continuation simply lacks the key and reads back as "attach and heal
    // nothing" — exactly what it meant when it was written, because no deploy
    // before this one had a producer that could set it. The old record's TYPE is
    // not a lie, so there is nothing to retire.
    //
    // 🛑 AND THE DESIGN THAT WOULD HAVE BUMPED IT IS THE ONE THIS SLICE REFUSED
    // FOR A DIFFERENT REASON. `recordGate` → `healChosen` grows the program a
    // SECOND park, and a version-12 record parked mid-attack would resume into a
    // prompt that deploy never wrote. The fidelity argument and the record-shape
    // argument point the same way, which is worth noticing rather than assuming.
    const program = CLAUSES[LEAFLET_TEXT].program;
    expect(program).toHaveLength(1);
    for (const op of program) expect(op.op).toBe("attachEnergyFrom");
    // No new op inhabitant, and no second parking op anywhere in the family.
    for (const { program: p } of CLAUSES) {
      for (const op of p) expect(op.op).toBe("attachEnergyFrom");
    }
  });

  it("the gate reads the SOURCE ZONE, so a stocked DISCARD does not unblock a hand attach", () => {
    // The zone assertion at the gate rather than at the op — the site D234 never
    // had to price, because a discard-source program is unblocked by a discard
    // pile and this pool's discard pile is never empty by accident.
    const state = ready(21, {});
    expect(programPlayable(state, CLAUSES[WRAPPED_TEXT].program, "p1")).toBe(false);
    expect(
      programPlayable(state, [{ op: "attachEnergyFrom", source: "discard" }] as EffectOp[], "p1"),
    ).toBe(false);
  });
});
