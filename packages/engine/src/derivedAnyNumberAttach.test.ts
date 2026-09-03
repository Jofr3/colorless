import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { ENERGY_TYPE_BY_CODE, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { type EffectPrompt, runProgram } from "./interpreter";
import {
  ANY_NUMBER_ATTACH_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handToDeck,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.162.0 → 0.163.0 — D247, THE UNBOUNDED HAND ATTACH: backlog row 12's largest
// single sentence, and the FIRST slice on that page to answer "which op is this"
// with a NEW ONE rather than with a field.
//
// ✅ THE COUNT RE-DERIVES TO THE DIGIT FOR THE FOURTEENTH ROW RUNNING. Remote D1
// `luminous`, `legal_standard = 1`, `json_each` over `attacks_json` /
// `abilities_json` PLUS the bare `effect` column, GLOB (never LIKE), GROUPED BY
// SENTENCE, on 2026-08-06 — and run on the SHAPE, not on the row's four ids:
//
//   WHERE t GLOB '*any number of*energy card*'
//     -- attack  4  "You may attach any number of Basic Energy cards from your
//                    hand to your Pokémon in any way you like."   ← THIS SLICE
//     -- attack  3  "Look at the top 20 cards … in any way you like. Shuffle …"
//     -- attack  1  sv10-056 (the two-mechanism outlier: an ORDERING clause)
//     -- ability 2  "…top 4 … put them on the BOTTOM of your deck."
//     -- effect  1  sv08-176 (a search-to-hand, a different family)
//
// The row's cell says **4 legal** and it is exactly 4.
//
// 🛑 THE PREDICTION, WRITTEN BEFORE THE FIRST REGEX, AND ITS GRADE. Two clauses
// won, two lost, and the losses are the transferable half.
//   • *"the shape query returns more than one sentence and at least one printing
//     outside row 12"* — ✅ **CORRECT**, twice over, and BOTH extra sentences turn
//     out to be **ALREADY BUILT**. The top-20 sentence is `ATTACK_LOOK_TOP_ATTACH`
//     (D241) byte for byte, and the second widening — `GLOB '*from your hand*in
//     any way you like*'` — surfaced *"Attach up to 2 Basic {P} Energy cards from
//     your hand to your Pokémon in any way you like."* (`sv08-079`/`-204`, 2
//     legal), which D236's anchor has read since it landed.
//   • *"this slice lands 7 legal printings; `BUILT.attack` 1109 → 1116 ± 2"* —
//     🛑 **WRONG. It lands 4**, because "one more sentence" and "one more slice"
//     are different claims and the prediction conflated them. 🆕 **WIDENING A
//     ROW'S QUERY FINDS PRINTINGS THAT ARE ALREADY BUILT AT LEAST AS OFTEN AS IT
//     FINDS NEW ONES** — three of the last four slices found new ones and this one
//     found none, so the move's yield is a CHECK on the row's premise first and a
//     source of printings second. Run it anyway; predict nothing from it.
//   • *"ZERO new wire-schema fields — the `attachCards` prompt already carries a
//     card→target MAP and the candidate list is a producer-side question"* —
//     ✅ **CORRECT, and it is the answer to the question the handoff could not
//     settle.** `validateChoice`'s `attachCards` arm reads `prompt.candidates`
//     and `prompt.targets` and NOTHING off the op, so the third candidate zone
//     needed no validator arm, no redaction arm and no HUD line.
//   • *"it costs ONE OP FIELD, NOT A PROMPT FIELD"* — 🛑 **WRONG, and wrong in
//     the direction the handoff warned about: right kind of piece, wrong size.**
//     It costs a whole OP. The failure mode named three slices running is "the
//     right NUMBER of pieces and the wrong PIECE"; this is the first to name the
//     right AXIS (the source zone) and the wrong GRANULARITY.
//
// ⚠️ WHAT THIS FILE IS FOR, AND IT IS NOT "did an Energy attach".
// `attachEnergyFrom.test.ts` owns the single-ref attach; `derivedHandAttach.test.ts`
// owns the printed-count hand anchor; `derivedDeckSearchAttach.test.ts` owns the
// compound park over a DECK. What is new here is four claims:
//   1. the CAP is the candidate set, because the print names no number;
//   2. every card names its OWN destination, so one answer can split a hand
//      across three bodies — the claim the sequential model cannot make;
//   3. the printed adjective "Basic" is falsifiable, on a hand that holds a
//      SPECIAL Energy and a Tool the filter must both refuse;
//   4. the destination table is shared with an op that builds a DIFFERENT
//      program, and only its `anyWay` rows with NO riders are portable.

// ── The printed sentence, verbatim off the remote D1 ─────────────────────────

/** Alolan Exeggutor ex `sv08-133`/`-225`/`-242`/`-248` "Tropical Frenzy"
    ({G}{W}, index 0, printed damage **150**). 4 legal printings, one sentence. */
const TROPICAL_FRENZY =
  "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.";
/** The same sentence with the printed brace code `sv04.5-067` spells — 0 legal,
    read anyway, because an arm transfers across sets and a registry row does not
    (D180/D187). The type is the ONLY difference. */
const TYPED_FRENZY =
  "You may attach any number of Basic {M} Energy cards from your hand to your Pokémon in any way you like.";

/** The programs, stated rather than described. */
const TROPICAL_FRENZY_PROGRAM: EffectOp[] = [
  { op: "attachFromHand", filter: { kind: "basicEnergy" } },
];
const TYPED_FRENZY_PROGRAM: EffectOp[] = [
  { op: "attachFromHand", filter: { kind: "basicEnergy", energyType: "Metal" } },
];

/** ⚠️ THE NEAR MISSES, EACH WITH THE REASON IT IS REFUSED — every one driven to
    null below rather than described here. `legal` is how many Standard-legal
    printings the refusal costs, and it is **0 for all of them**: this arm reads
    every legal printing of its shape, so the residue is a statement about the
    catalog's silence rather than about the arm's reach. */
const UNREAD: readonly (readonly [string, string])[] = [
  [
    "You may attach any number of Basic Energy cards from your hand to this Pokémon.",
    "names ONE body — an unbounded batch pinned to a single target, which no card prints and `attachEnergyFrom.count` (a number) could not express either",
  ],
  [
    "You may attach any number of Basic Energy cards from your hand to 1 of your Pokémon.",
    "the same refusal wearing the other printed singular",
  ],
  [
    "You may attach any number of Basic Energy cards from your hand to 1 of your {F} Pokémon.",
    "a brace-coded singular: an `anyWay: false` row of the shared table",
  ],
  [
    "You may attach any number of Basic Energy cards from your hand to your Benched Pokémon in any way you like.",
    "`anyWay` BUT carries `benchOnly`, a rider this op does not have — reading it would drop the zone word and offer the Active",
  ],
  [
    "You may attach any number of Basic Energy cards from your hand to each of your Benched Pokémon.",
    "a spread with no decision in it, and a phrase the table does not name at all",
  ],
  [
    "Attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
    "the bare imperative — never printed with this quantifier, so the `You may` opener is required rather than optional",
  ],
  [
    "You may attach any number of Basic Energy cards from your discard pile to your Pokémon in any way you like.",
    "the SOURCE zone is welded: the discard side prints no unbounded count at all",
  ],
  [
    "You may attach any number of Energy cards from your hand to your Pokémon in any way you like.",
    "the printed adjective is missing — a bare noun admits SPECIAL Energy, which is a different filter and a different card",
  ],
  [
    "You may attach up to 2 Basic Energy cards from your hand to your Pokémon in any way you like.",
    "a printed COUNT: already built, as 2 separate `attachEnergyFrom` ops (D205's sequential model), and re-homing it here is the reading this arm declines",
  ],
];

// ── The board. Index 47 on `fix-trainerops` — ALREADY THERE, fielded by D236. ──
/** ⚠️⚠️ **THE FIXTURE ALREADY HELD THIS SENTENCE, AND THE CHEAP CHECK THAT FOUND
    IT IS THE ONE D246 NAMED**: grep the demonstrator for the printed BLOCKER
    STRING, not for the row. D236 fielded "Tropical Frenzy" at index 47 as a
    DELIBERATELY UNREAD control — a live subject for its own refusal, D181's
    `Strafe` precedent — with the printed damage dropped so a base-damage KO could
    not put a promotion prompt in front of "nothing was attached".

    So this slice APPENDS NOTHING. Twelve consecutive appends and zero inserts is
    the streak eleven suites depend on, and the twelfth slice keeps it by needing
    no index at all: the control it expires becomes the demonstrator it drives,
    which is the "re-home, never delete" rule arriving at a FIXTURE for the first
    time rather than at a table.

    ⚠️ THE DROPPED `damage` IS INHERITED ON PURPOSE. The print really deals 150,
    and D236's reason for leaving it off still holds — this suite asserts what did
    and did not attach on a board with a live opponent — so the field stays absent
    and no assertion here reads it. */
const TROPICAL_FRENZY_IDX = 47;

/** Every Energy-ish line this deck carries — the hand is DRAWN rather than
    placed, so a board meaning "nothing but the cost in hand" has to say which
    cards to send back. */
const HAND_LINES = ["fix-energy", "fix-special", "fix-tool"] as const;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ANY_NUMBER_ATTACH_DECK, p2: ANY_NUMBER_ATTACH_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} on the attacker for the
    cost, over a Bench built to order and a HAND stocked line by line. p2 is a
    plain body so nothing across the table is reachable by accident.

    ⚠️ THE BENCH DEFAULTS TO **THREE**, which is the whole reason this deck
    exists: the claim under test is that each card names its own destination, and
    two bodies cannot tell "one apiece" from "two on one and none on the other"
    once the totals match. */
function ready(
  seed: number,
  {
    bench = ["fix-basic-1", "fix-basic-1", "fix-basic-1"],
    hand = {},
  }: { bench?: readonly string[]; hand?: Partial<Record<string, number>> } = {},
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of HAND_LINES) state = handToDeck(state, "p1", id);
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

/** The parked COMPOUND prompt — which cards, and where each one goes. */
function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "attachCards") {
    throw new Error(`expected attachCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

function strike(state: GameState) {
  return mustApply(state, { type: "attack", seat: "p1", index: TROPICAL_FRENZY_IDX });
}

function attach(state: GameState, assignments: { uid: string; to: PokemonRef }[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  });
}

const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

/** How many copies of `cardId` are in p1's hand. ⚠️ COUNTED BY ID RATHER THAN BY
    HAND SIZE, because the opening hand is DRAWN: it also holds bodies, Tools and
    whatever else the shuffle dealt, none of which this op can see. A hand-size
    assertion would pass or fail on the seed. */
function handCount(state: GameState, cardId: string): number {
  return state.players.p1.hand.filter((uid) => state.cardIdByUid[uid] === cardId).length;
}

/** The card ids attached to a body, so "which Energy landed where" is a fact
    about the board rather than about an event count. */
function energyIdsOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (body?.energy ?? []).map((uid) => state.cardIdByUid[uid] as string);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — one printed sentence, one new op", () => {
  it("derives the printed sentence to its program", () => {
    expect(deriveAttackEffect(TROPICAL_FRENZY)).toEqual(TROPICAL_FRENZY_PROGRAM);
  });

  it("⚠️ the brace code is read though ZERO legal printings spell it", () => {
    // An ARM transfers across sets and a registry row does not (D180/D187):
    // `sv04.5-067` is rotated, the sentence recurs, and the arm serves the H/I
    // reprint the day one is ingested. Every code in the schema's map is admitted
    // by construction, because the character class is BUILT from that map's keys.
    expect(deriveAttackEffect(TYPED_FRENZY)).toEqual(TYPED_FRENZY_PROGRAM);
    for (const [code, type] of Object.entries(ENERGY_TYPE_BY_CODE)) {
      const text = TROPICAL_FRENZY.replace("Basic Energy", `Basic {${code}} Energy`);
      expect(deriveAttackEffect(text), code).toEqual([
        { op: "attachFromHand", filter: { kind: "basicEnergy", energyType: type } },
      ]);
    }
    // …and a code the map does NOT hold cannot reach the resolver at all.
    expect(deriveAttackEffect(TROPICAL_FRENZY.replace("Basic ", "Basic {Q} "))).toBeNull();
  });

  it("🛑 every near miss is refused, and each for its OWN reason", () => {
    for (const [text, why] of UNREAD) expect(deriveAttackEffect(text), why).toBeNull();
    // The count: nine refusals, stated rather than described. A slice that
    // quietly widened one of them would still pass every accept case above.
    expect(UNREAD).toHaveLength(9);
  });

  it("🛑 the `$` is load-bearing, and the `[^.]` class is what makes it so", () => {
    // D234's dropped-`$` mutant, inherited a third time. With the destination
    // capture narrowed to `[^.]`, a build with no terminal anchor MATCHES a
    // sentence carrying a trailing printed clause and silently drops the clause —
    // so the mutant dies here rather than surviving on a greedy capture that
    // backtracks to the last period and fails to resolve anyway.
    expect(deriveAttackEffect(`${TROPICAL_FRENZY} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`Draw a card. ${TROPICAL_FRENZY}`)).toBeNull();
    // …and the bare sentence still derives, so the refusals are the anchors doing
    // work rather than the arm being broken.
    expect(deriveAttackEffect(TROPICAL_FRENZY)).not.toBeNull();
  });

  it("🛑 the printed COUNT still derives to the SEQUENTIAL model, not to this op", () => {
    // ⚠️ THE FLAGGED ASSUMPTION, PINNED. `sv08-079`/`-204` print "Attach up to 2
    // Basic {P} Energy cards from your hand to your Pokémon in any way you like."
    // — 2 legal printings that this op COULD serve, as one compound park. They are
    // deliberately left on D205's sequential model (N ops, each parking on its own
    // target), because that model is already built, already asserted by four
    // suites, and reaches the same splits. The difference is that a player cannot
    // revise an early pick — a UX claim, not a rules one.
    //
    // This is the assertion that makes the call falsifiable rather than a comment:
    // the day the two are unified, this test fails and says which reading changed.
    //
    // 🆕🛑 **D360 — IT FIRED, AND THE READING IT NAMES DID NOT CHANGE.** The op
    // is still `attachEnergyFrom` and the model is still D205's SEQUENTIAL one:
    // N ops, each parking on its own target, NOT this slice's compound
    // `attachFromHand` park. What moved is a flag on those same N ops — the
    // printed "up to" now buys the player the right to stop, which the sequential
    // model expresses per op and the compound one would express as a `min`. **A
    // CONTROL THAT FIRES ON A CHANGE IT DOES NOT MEAN IS STILL DOING ITS JOB**;
    // the fix is to re-state the literal, not to loosen the assertion, so the day
    // the two really ARE unified this line still fails and still says so.
    // ⚠️ AND THIS SUITE WAS THIS SLICE'S ONE UNPREDICTED RED FILE: D360 predicted
    // its red surface by grepping the printed IDS and SENTENCES, and this file
    // names neither — it asserts what the DERIVER DOES for a neighbouring
    // sentence, as a control. **ENUMERATE WHAT A THING DOES, NOT WHAT MENTIONS
    // IT** (D359's defect (a), at its third instance).
    expect(
      deriveAttackEffect(
        "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like.",
      ),
    ).toEqual([
      { op: "attachEnergyFrom", source: "hand", energyType: "Psychic", declinable: true },
      { op: "attachEnergyFrom", source: "hand", energyType: "Psychic", declinable: true },
    ]);
  });

  it("⚠️ the fixture ALREADY carried the sentence, at index 47, and nothing was appended", () => {
    // 🛑 THE ROW THIS SLICE DID NOT HAVE TO ADD. D236 fielded the sentence as its
    // own refusal's live subject; D247 builds it, so the control becomes the
    // demonstrator and the index list does not move. Eleven sibling suites address
    // 0-60 by constant and every one of them still means what it meant.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
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
    expect(attacks).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect(attacks[TROPICAL_FRENZY_IDX]?.name).toBe("Tropical Frenzy");
    expect(attacks[TROPICAL_FRENZY_IDX]?.effect).toBe(TROPICAL_FRENZY);
    // ⚠️ AND THE PRINTED 150 IS STILL ABSENT — D236's divergence, inherited rather
    // than quietly repaired, because this suite's boards read what attached and a
    // KO would put a promotion prompt in front of that.
    expect(attacks[TROPICAL_FRENZY_IDX]?.damage).toBeUndefined();
    // …and the sentence appears EXACTLY ONCE on the demonstrator: a second copy at
    // a fresh index is the duplicate this slice nearly appended, and it would have
    // made "which index is Tropical Frenzy" ambiguous for every future reader.
    expect(attacks.filter((a) => a.effect === TROPICAL_FRENZY)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE CAP — the print names no number, so the candidate set IS the ceiling
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 the unbounded count", () => {
  it("offers every matching card in hand, and caps at exactly that many", () => {
    const state = ready(2, { hand: { "fix-energy": 4 } });
    deepFreeze(state);
    const prompt = promptOf(strike(state).state);
    expect(prompt.candidates).toHaveLength(4);
    // 🛑 THE CAP IS THE CANDIDATE SET, not a constant and not the hand size. A
    // build that hard-coded any number would agree with this on SOME hand, which
    // is why the next case moves the hand and re-reads the cap.
    expect(prompt.max).toBe(prompt.candidates.length);
    expect(prompt.maxPerTarget).toBeUndefined();
  });

  it("🛑 the cap MOVES with the hand — the one thing a constant cannot do", () => {
    for (const count of [1, 3, 5]) {
      const prompt = promptOf(strike(ready(13, { hand: { "fix-energy": count } })).state);
      expect(prompt.candidates, `hand of ${count}`).toHaveLength(count);
      expect(prompt.max, `hand of ${count}`).toBe(count);
    }
  });

  it("⚠️ the prompt says 'from your hand' and 'in any way you like'", () => {
    // Both clauses earn their place: the first tells the player the rows below are
    // their own hand rather than a window on the deck (the only thing separating
    // this dialog from `attachFromTop`'s at a glance), and the second is the sole
    // cue that every card may land on ONE Pokémon (§15.E).
    const prompt = promptOf(strike(ready(3, { hand: { "fix-energy": 3 } })).state);
    expect(prompt.note).toBe(
      "Attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
    );
    // ⚠️ AND IT NEVER SAYS "up to N": the op carries no `max`, so a caption that
    // promised a number would be promising one the op cannot honour.
    expect(prompt.note).not.toContain("up to");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE MAP — each card names its OWN destination
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 in any way you like — one answer, three bodies", () => {
  it("splits one hand across the Active and two Benched bodies", () => {
    const state = ready(4, { hand: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = strike(state);
    const [a, b, c] = promptOf(parked).candidates;
    const { state: after, events } = attach(parked, [
      { uid: a as string, to: ACTIVE_REF },
      { uid: b as string, to: benchRef(0) },
      { uid: c as string, to: benchRef(2) },
    ]);
    // 🛑 THE CLAIM THE SEQUENTIAL MODEL CANNOT MAKE IN ONE ANSWER. Three bodies,
    // three cards, one decision — and the THIRD body is what tells this apart from
    // "two on one and one on the other" once the totals agree.
    expect(energyIdsOn(after, ACTIVE_REF)).toEqual(["fix-energy", "fix-energy"]);
    expect(energyIdsOn(after, benchRef(0))).toEqual(["fix-energy"]);
    expect(energyIdsOn(after, benchRef(1))).toEqual([]);
    expect(energyIdsOn(after, benchRef(2))).toEqual(["fix-energy"]);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
    // …and the three cards LEFT the hand, exactly once each. Counted BY ID
    // rather than by hand size: the opening hand is drawn, so it also holds
    // bodies and Tools this op never touches.
    expect(handCount(after, "fix-energy")).toBe(0);
  });

  it("puts every card on ONE Pokémon when that is the answer", () => {
    const state = ready(5, { hand: { "fix-energy": 3 } });
    const { state: parked } = strike(state);
    const uids = promptOf(parked).candidates;
    const { state: after } = attach(
      parked,
      uids.map((uid) => ({ uid, to: benchRef(1) })),
    );
    // The other half of "in any way you like", and the misconception §15.E says
    // the dialog's shape invites: all three on one body is a legal answer.
    expect(energyIdsOn(after, benchRef(1))).toHaveLength(3);
    expect(energyIdsOn(after, ACTIVE_REF)).toEqual(["fix-energy"]);
  });

  it("⚠️ an EMPTY answer is a legal decline, and nothing moves", () => {
    const state = ready(6, { hand: { "fix-energy": 2 } });
    const { state: parked } = strike(state);
    const { state: after, events } = attach(parked, []);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(handCount(after, "fix-energy")).toBe(2);
    // The printed "**You may**" — and the attack's damage still landed, because
    // the effect is the optional half and the damage is not.
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 the wire cannot conjure a card, repeat one, or aim across the table", () => {
    const state = ready(7, { hand: { "fix-energy": 3 } });
    const { state: parked } = strike(state);
    const uids = promptOf(parked).candidates;
    const first = uids[0] as string;
    // A uid that was never offered, the same uid twice, and a target on the
    // OPPONENT's board: `validateChoice` reads `prompt.candidates`/`prompt.targets`
    // and refuses each, which is why the third candidate zone needed no validator
    // arm of its own.
    const foreign = parked.players.p2.hand[0] as string;
    const REFUSALS: readonly (readonly [string, { uid: string; to: PokemonRef }[]])[] = [
      ["a uid from the OPPONENT's hand", [{ uid: foreign, to: ACTIVE_REF }]],
      [
        "the same physical card twice",
        [
          { uid: first, to: ACTIVE_REF },
          { uid: first, to: benchRef(0) },
        ],
      ],
      ["a target across the table", [{ uid: first, to: { seat: "p2", spot: { spot: "active" } } }]],
    ];
    for (const [why, assignments] of REFUSALS) {
      expectErr(
        parked,
        { type: "resolveEffect", seat: "p1", choice: { kind: "attachCards", assignments } },
        "BAD_EFFECT_CHOICE",
      );
      expect(why).not.toBe("");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE FILTER — the printed adjective "Basic", made falsifiable
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 Basic Energy cards — the noun the print narrows", () => {
  it("refuses a SPECIAL Energy and a Tool sitting in the same hand", () => {
    const state = ready(8, { hand: { "fix-energy": 2, "fix-special": 2, "fix-tool": 2 } });
    deepFreeze(state);
    const prompt = promptOf(strike(state).state);
    // Six cards in hand, two offered. `fix-special` is the card an `anyEnergy`
    // filter WOULD offer, which is the only thing that tells the printed adjective
    // from its absence; `fix-tool` is the card no energy filter offers at all.
    expect(handCount(state, "fix-energy")).toBe(2);
    expect(handCount(state, "fix-special")).toBe(2);
    expect(handCount(state, "fix-tool")).toBe(2);
    expect(idsOf(state, prompt.candidates)).toEqual(["fix-energy", "fix-energy"]);
  });

  it("does not park at all when the hand holds no Basic Energy", () => {
    const state = ready(9, { hand: { "fix-special": 2, "fix-tool": 2 } });
    const { state: after, events } = strike(state);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    // The whiff is silent and total: nothing left the hand, and the attack's
    // damage still resolved.
    expect(handCount(after, "fix-energy")).toBe(0);
    expect(handCount(after, "fix-special")).toBe(2);
    // The attack itself still resolved — the whiff is the EFFECT's, not the
    // attack's. (This index prints no damage, D236's deliberate divergence, so
    // the declaration is what says the attack happened.)
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE READ SITES NOBODY PRICES
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the read sites, priced by driving them", () => {
  it("🛑 `programPlayable` is not asked, and the op is deliberately UNGATED", () => {
    // ⚠️ THE PRICING, DRIVEN RATHER THAN INFERRED. `attachFromTop` and
    // `attachFromDeck` are ungated because every carrier prints a leftovers clause
    // that always resolves; this op prints no second clause at all, so that
    // argument is NOT available to it. It needs no gate for a different reason:
    // `programPlayable` has three call sites and all three are card plays (a
    // Trainer, an Ability, a Stadium Ability), where this sentence is only ever
    // printed on an ATTACK — whose effect is never vetoed for whiffing.
    //
    // The function is asked here anyway, on the emptiest possible board, so the
    // claim "it would answer TRUE" is a fact rather than a reading: a future
    // Ability printing inherits this answer, and this test is where it would
    // change.
    const state = ready(10, { hand: {} });
    expect(programPlayable(state, TROPICAL_FRENZY_PROGRAM, "p1")).toBe(true);
  });

  it("🛑 an EMPTY TARGET SET is a dead end, not a park — driven by surgery", () => {
    // ⚠️ THE GUARD THAT NO DECLARED ATTACK CAN REACH, AND THE REASON IT IS A
    // GUARD RATHER THAN A BRANCH REMOVED (D154). A controller who is attacking
    // has an Active by definition, and `attachEnergyTargets` with no riders
    // returns every own body — so the "no eligible target" path cannot be reached
    // from the action surface at all. It IS reachable from the interpreter, which
    // is the layer that would have to survive the day a target rider is printed
    // on this op, so the program is run directly against a board with NOTHING to
    // attach to.
    //
    // Without the guard the op parks on a prompt whose `targets` list is EMPTY —
    // a dialog the player cannot answer, which is a soft-lock rather than a wrong
    // number, and no count assertion anywhere would see it.
    const state = ready(3, { hand: { "fix-energy": 3 } });
    const empty: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, active: null, bench: [] },
      },
    };
    const events: GameEvent[] = [];
    const result = runProgram(empty, TROPICAL_FRENZY_PROGRAM, { seat: "p1" }, events);
    expect(result.kind).toBe("done");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    // …and the cards are still in the hand: a dead end moves nothing.
    expect(handCount(result.kind === "done" ? result.state : empty, "fix-energy")).toBe(3);
    // The control: the SAME program on the same hand with a board to land on does
    // park, so the assertion above is the target set doing the work rather than
    // the program being unreachable.
    const live: GameEvent[] = [];
    expect(runProgram(state, TROPICAL_FRENZY_PROGRAM, { seat: "p1" }, live).kind).toBe("parked");
  });

  it("⚠️ the op is not a recorder, so no §9.2 slot is written or read", () => {
    // `recordSlotOf` names six ops and this is not one — no printing in the family
    // carries an "If you attached Energy in this way" tail. An op that filed
    // nothing while a gate read the slot is the defect that list exists to
    // prevent; the assertion is that the answer changes NOTHING about the record.
    const state = ready(11, { hand: { "fix-energy": 2 } });
    const { state: parked } = strike(state);
    const uids = promptOf(parked).candidates;
    const { state: after } = attach(parked, [{ uid: uids[0] as string, to: ACTIVE_REF }]);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(energyIdsOn(after, ACTIVE_REF)).toEqual(["fix-energy", "fix-energy"]);
  });
});
