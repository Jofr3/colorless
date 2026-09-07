import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, EffectPrompt, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction, engineVersion, redactGame } from "./index";
import { moveEnergyPlayable } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  OPPONENT_ENERGY_MOVE_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";
import type { Seat } from "./types";

// 0.344.0 → 0.345.0 — D443, THE OTHER SIDE OF THE TABLE.
//
//   "Move an Energy from 1 of your opponent's Pokémon to another of their
//    Pokémon."                                                         (2 legal)
//   "You may move an Energy from your opponent's Active Pokémon to 1 of their
//    Benched Pokémon."                                                 (3 legal)
//
// THE SLICE IS ONE FIELD: `moveEnergy.side?: "opponent"`. The endpoints are two
// ALREADY-SHIPPED readings — the FREE route and `selfToBench` — read off the other
// seat's board, so neither sentence needs a `route` value that did not exist, and
// `moveEndpoints` did not gain a branch: its `seat` parameter simply became the
// BOARD, and the two call sites pass `moveBoardSeat(op, ctx.seat)`.
//
// 🛑 WHAT THE SEAT ACTUALLY COST, WHICH IS NOT THE ENDPOINTS.
//   · §11. A `moveEnergy` op had never named a body its controller does not own,
//     so the refusal gate had never been asked about this op. It is asked now, as
//     a FILTER over both endpoint lists (D259's placement rule) — §4.
//   · `ENERGY_MOVED`. Its `seat` was the controller AND the board, true by
//     accident for all four producers, and `log.ts` resolved BOTH targets against
//     it. That is D425's derived-fact defect one event over, and it is why the
//     event grew a required `actor` — §5.
//   · Both HUDs. All four `moveEnergy` dialogs lacked the `ref.seat !== viewerSeat`
//     marker every sibling public-ref dialog carries. In a mirror match that is two
//     identical rows for two different boards — D412's third-read-site shape.
//
// ⚠️ WHAT THIS FILE IS **NOT** FOR. The endpoints are `derivedSelfEnergyMove`'s
// subject and the quantifiers are `derivedMoveAllEnergy`'s; "the Energy moved" is
// not the claim. What is new is WHOSE board it moved on, so every rung below that
// an own-board build could also pass is paired with one it cannot, and the
// controller's own board is the control on every one of them.

const OPP_FREE = "Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon.";
const OPP_ACTIVE_TO_BENCH =
  "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.";
/** The OWN-board twin of `OPP_FREE`, one possessive away — Energy Switch's printed
    sentence. Every refusal rung below is paired against it, because "the opponent
    sentence derives" passes trivially on a build that derives everything (D424). */
const OWN_FREE_TWIN = "Move an Energy from 1 of your Pokémon to another of your Pokémon.";

const STATIC_FLICK = 66; // fix-trainerops — OPP_FREE
const DRAINING_SAP = 67; // fix-trainerops — OPP_ACTIVE_TO_BENCH
const SELF_TO_BENCH = 14; // fix-trainerops — D229's own-board "Move an Energy from this Pokémon…"
const SEED = 0x5c43;
const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

/** p2 opens and passes, so p1 plays turn 2 with no §4 first-turn restriction.
    p1's `fix-trainerops` Active carries the {C} that pays every attack here; the
    board that MATTERS is p2's, and it is built explicitly on every case.

    ⚠️ BOTH SIDES ARE SET EXPLICITLY AND BOTH CARRY ENERGY. A board where only the
    opponent holds movable Energy cannot tell a correct build from one that reads
    `otherSeat` in the offer and `ctx.seat` in the apply, and a board where only the
    controller holds it cannot tell this slice from the one before it. `oppEnergy`
    puts Energy on p2's Active and `oppBenchEnergy` on their bench index 0, so the
    free route's sources span two bodies. */
function board({
  ownEnergy = 2,
  oppBench = 2,
  oppEnergy = 2,
  oppBenchEnergy = 1,
  mistOnBench,
  mistOnOppActive = false,
}: {
  ownEnergy?: number;
  oppBench?: number;
  oppEnergy?: number;
  oppBenchEnergy?: number;
  mistOnBench?: number;
  mistOnOppActive?: boolean;
} = {}): GameState {
  let state = mustApply(
    driveSetup(
      SEED,
      { p1: OPPONENT_ENERGY_MOVE_DECK, p2: OPPONENT_ENERGY_MOVE_DECK },
      { first: "p2" },
    ),
    { type: "endTurn", seat: "p2" },
  ).state;
  state = setActiveFromDeck(state, "p1", "fix-trainerops");
  if (ownEnergy > 0) state = attachFromDeck(state, "p1", "fix-energy", ownEnergy);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p2", "fix-basic-1");
  if (oppEnergy > 0) state = attachFromDeck(state, "p2", "fix-energy", oppEnergy);
  if (oppBenchEnergy > 0 && oppBench > 0) {
    state = attachBenchFromDeck(state, "p2", 0, "fix-energy", oppBenchEnergy);
  }
  if (mistOnOppActive) state = attachFromDeck(state, "p2", "fix-mist-energy", 1);
  if (mistOnBench !== undefined) {
    state = attachBenchFromDeck(state, "p2", mistOnBench, "fix-mist-energy", 1);
  }
  return state;
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** The parked moveEnergy prompt, narrowed — and it THROWS rather than returning
    undefined when nothing parked, so a whiffed build cannot read as an empty one. */
function parked(state: GameState): Extract<EffectPrompt, { kind: "moveEnergy" }> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  return prompt;
}

function events<T extends GameEvent["type"]>(all: GameEvent[], type: T) {
  return all.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const p2Active: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const p2Bench = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const p1Bench = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

describe("§1 — the deriver: two anchors, two sentences, and the possessive that decides the board", () => {
  it("derives both to shipped routes with the seat rider — as PROGRAMS, not booleans", () => {
    // 🛑 THE PROGRAM, NOT `!== null` (D438). A boolean is true under the real build
    // AND under one that dropped `side`, which is exactly the build that moves the
    // ATTACKER's Energy around while every "the sentence is claimed" rung stays
    // green — this slice's whole defect, invisible to any census.
    expect(deriveAttackEffect(OPP_FREE)).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, side: "opponent" },
    ]);
    expect(deriveAttackEffect(OPP_ACTIVE_TO_BENCH)).toEqual([
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: 1,
        route: "selfToBench",
        side: "opponent",
      },
    ]);
  });

  it("🛑 REFUSES the own-board twin, a swapped possessive, and a trailing clause", () => {
    // THE NEAR MISS IS ONE WORD, AND IT IS A REAL REGISTRY SENTENCE. Energy Switch
    // prints `OWN_FREE_TWIN`; a build whose anchor read `your (?:opponent's )?
    // Pokémon` would claim it and move Energy on the wrong board, with the printed
    // card still "working" and nothing red anywhere.
    expect(deriveAttackEffect(OWN_FREE_TWIN)).toBeNull();
    // The DESTINATION possessive is load-bearing too, and separately: a sentence
    // that opens on the opponent and closes on "your" is not printed, and claiming
    // it would build a cross-BOARD move `moveEndpoints` cannot express.
    expect(
      deriveAttackEffect(
        "Move an Energy from 1 of your opponent's Pokémon to another of your Pokémon.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "You may move an Energy from your opponent's Active Pokémon to 1 of your Benched Pokémon.",
      ),
    ).toBeNull();
    // The `$` witness (D228 at D229's address): no member of this family carries a
    // tail in print, so the terminator's witness is CONSTRUCTED and says so.
    expect(deriveAttackEffect(`${OPP_FREE} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackEffect(`${OPP_ACTIVE_TO_BENCH} Then, shuffle your deck.`)).toBeNull();
    // …and both untailed strings are still claimed, so none of the five refusals
    // above is passing on a reader that refuses everything (D424).
    expect(deriveAttackEffect(OPP_FREE)).not.toBeNull();
    expect(deriveAttackEffect(OPP_ACTIVE_TO_BENCH)).not.toBeNull();
  });

  it("the curled re-ingest derives the identical program (both apostrophes, both anchors)", () => {
    // D189/D227's standing rule for a sentence containing `opponent's`. The corpus
    // bytes are U+0027 — MEASURED here rather than remembered (D421/D440), because
    // "it looks like a straight quote" is exactly the check that has failed before.
    const [rawFree] = legalAttackCorpus().filter(([, text]) => text === OPP_FREE);
    const [rawSap] = legalAttackCorpus().filter(([, text]) => text === OPP_ACTIVE_TO_BENCH);
    expect(rawFree?.[1].codePointAt(38)).toBe(0x27);
    expect(rawSap?.[1].codePointAt(41)).toBe(0x27);
    expect(deriveAttackEffect(OPP_FREE.replace("'", "’"))).toEqual(
      deriveAttackEffect(OPP_FREE),
    );
    expect(deriveAttackEffect(OPP_ACTIVE_TO_BENCH.replace("'", "’"))).toEqual(
      deriveAttackEffect(OPP_ACTIVE_TO_BENCH),
    );
  });

  it("the corpus prints these two sentences at 2 and 3 legal printings, and no others cross the table", () => {
    // THE POPULATION, NOT A SPECIMEN (D423). The printing counts are read off the
    // corpus module rather than asserted from prose, and the sweep below is what
    // makes the enumeration a claim about the POOL instead of about two strings.
    const corpus = legalAttackCorpus();
    expect(corpus.find(([, text]) => text === OPP_FREE)?.[0]).toBe(2);
    expect(corpus.find(([, text]) => text === OPP_ACTIVE_TO_BENCH)?.[0]).toBe(3);
    // Every corpus sentence naming BOTH an Energy move and the opponent, and what
    // each one is. The pattern is `/mov/i` narrowed by `opponent` — its edge, stated
    // (D424/D425): it cannot see a printing spelling the action `Switch`, `Attach`
    // or `Put`, so this is a floor on the family and not a census of it.
    const crossing = corpus
      .filter(([, text]) => /mov/i.test(text) && /opponent/.test(text))
      .map(([, text]) => text);
    expect(crossing.sort()).toEqual(
      [
        // The two this slice builds.
        OPP_FREE,
        OPP_ACTIVE_TO_BENCH,
        // …and the damage-COUNTER movers, which are `moveCountersChosen` and a
        // different family entirely. Named so a survey that drops them is not
        // mistaken for one that never saw them.
        "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.",
        "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.",
        "Move all damage counters from 1 of your Benched Team Rocket's Pokémon to your opponent's Active Pokémon.",
        "You may move any number of damage counters from your opponent's Benched Pokémon to their Active Pokémon.",
        "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
      ].sort(),
    );
  });

  it("🛑 NO reader emits `anyDest` and `side` together — the falsifier both spread dialogs cite", () => {
    // BOTH `MoveEnergySpreadDialog`s DELIBERATELY LACK THE `opponent` MARKER their
    // coupled twins gained, on the grounds that no printed sentence reaches them
    // across the table. That is a claim about the POOL, so it is executable here
    // rather than left as a comment (D428: a refusal written as prose rots; one
    // written as a test cannot). The day this goes red, both dialogs owe the marker.
    const both = legalAttackCorpus()
      .flatMap(([, text]) => deriveAttackEffect(text) ?? [])
      .filter(
        (op): op is Extract<EffectOp, { op: "moveEnergy" }> =>
          op.op === "moveEnergy" && op.anyDest === true && op.side === "opponent",
      );
    expect(both).toEqual([]);
    // THE CONTROL: the sweep does see `moveEnergy` ops, and it sees each rider
    // alone — so the emptiness above is about the PAIR and not about the sweep.
    const movers = legalAttackCorpus()
      .flatMap(([, text]) => deriveAttackEffect(text) ?? [])
      .filter((op): op is Extract<EffectOp, { op: "moveEnergy" }> => op.op === "moveEnergy");
    expect(movers.filter((op) => op.anyDest === true).length).toBeGreaterThan(0);
    expect(movers.filter((op) => op.side === "opponent")).toHaveLength(2);
  });
});

describe("§2 — the park: the offer is on the other board, and nobody else is asked", () => {
  it("every offered source AND destination sits on p2, and p1's own board is offered nothing", () => {
    const prompt = parked(swing(board(), STATIC_FLICK).state);
    // 🛑 THE SEATS, NOT THE COUNTS. A build that read `ctx.seat` would offer the
    // same SHAPE of prompt — some movable Energy, some destinations — off the wrong
    // board, and a length assertion cannot tell the two apart.
    expect(prompt.movable.every((offer) => offer.from.seat === "p2")).toBe(true);
    expect(prompt.destinations.every((ref) => ref.seat === "p2")).toBe(true);
    // The free route's `needed: 2` is the printed "another", made structural: every
    // one of p2's in-play bodies is a destination, Active included.
    expect(prompt.destinations).toEqual([p2Active, p2Bench(0), p2Bench(1)]);
    // The sources span TWO bodies (p2's Active and their bench 0), which is what
    // makes "one shielded body drops out and the rest stay" observable in §4.
    expect(new Set(prompt.movable.map((offer) => offer.from.spot.spot)).size).toBe(2);
    // THE CONTROL, ON THE SAME BOARD AND THE SAME ATTACKER: D229's own-board
    // sentence offers p1 and only p1. Without it, "the refs say p2" would pass on a
    // build that had simply crossed every `moveEnergy` in the engine.
    const own = parked(swing(board(), SELF_TO_BENCH).state);
    expect(own.movable.every((offer) => offer.from.seat === "p1")).toBe(true);
    expect(own.destinations.every((ref) => ref.seat === "p1")).toBe(true);
  });

  it("`selfToBench` on the other board is their Active → their Bench", () => {
    const prompt = parked(swing(board(), DRAINING_SAP).state);
    expect(prompt.movable.map((offer) => offer.from)).toEqual([p2Active, p2Active]);
    expect(prompt.destinations).toEqual([p2Bench(0), p2Bench(1)]);
  });

  it("the caption is the printed sentence, and the coupled key set is unchanged", () => {
    // The note is the card's own words (D295 — the one screen that tells the player
    // what their pick does must not contradict the card). `Draining Sap`'s drops the
    // printed "You may", which is this function's standing rule and NOT a claim that
    // the floor honours it (see below).
    expect(parked(swing(board(), STATIC_FLICK).state).note).toBe(OPP_FREE);
    expect(parked(swing(board(), DRAINING_SAP).state).note).toBe(
      "Move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.",
    );
    // 🛑 `side` RIDES THE OP AND **NOT** THE PROMPT, WHICH IS THE OPPOSITE CALL FROM
    // `anySource` (D226) AND `anyDest` (D442) — and the key set is what pins it. Those
    // two are COUPLINGS: invisible in the candidate lists, so a prompt that dropped
    // them was a rider nothing downstream could honour. This one is spelled by every
    // candidate's own absolute `seat`, so a prompt field would be a second answer to
    // a question the refs already answer (D159).
    expect(Object.keys(parked(swing(board(), STATIC_FLICK).state)).sort()).toEqual([
      "destinations",
      "kind",
      "max",
      "movable",
      "note",
    ]);
  });

  it("🛑 the CONTROLLER answers — no `decider`, no `answerer`, and that is §9.4's rule", () => {
    // `ptcg-rules.md` §9.4: "Almost every printed effect is decided by the player
    // resolving it, even when it reaches across the table … the target is theirs,
    // the choice is yours. A small family inverts that, and the wording is the tell:
    // **'your opponent may …'**." Neither sentence prints a chooser, so neither files
    // one — the same call `knockOutChosen` (D416) and `discardEnergy`'s
    // `opponentChosen` arm already make about picks on the other seat's board.
    const state = swing(board(), STATIC_FLICK).state;
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.answerer).toBeUndefined();
    expect(state.phase.seat).toBe("p1");
    // Driven from BOTH chairs, because "no answerer" is a claim about who is
    // REFUSED as much as about who is accepted (D426's gate, one prompt over).
    const uid = parked(state).movable[0]?.uid as string;
    const pick = { kind: "moveEnergy" as const, picks: [{ uid, dest: p2Bench(1) }] };
    expectErr(state, { type: "resolveEffect", seat: "p2", choice: pick }, "WRONG_SEAT");
    expect(applyAction(state, { type: "resolveEffect", seat: "p1", choice: pick }).ok).toBe(true);
  });

  it("the printed 'You may' buys nothing — and neither op carries a floor", () => {
    // ⚠️ THIS RUNG RECORDS A KNOWN GAP RATHER THAN A DECISION, AND SAYS SO. §9.1
    // makes `Static Flick`'s printed number EXACT (no "up to", no "you may") while
    // `Draining Sap` prints "You may"; the engine offers BOTH as declinable, because
    // `moveFloor` answers 0 for every `max` that is not `"all"`. That gap is the
    // family's standing approximation — it already covers 13 shipped own-board
    // printings (the op's doc has recorded it since D229) — and closing it needs a
    // mandatory-EXACT spelling on `max` that D441 deliberately refused. A slice
    // about the SEAT is the wrong place to move 13 printings' declinability.
    // 🛑 THE LINE BELOW WILL GO RED THE DAY SOMEBODY FIXES IT, AND THAT IS CORRECT
    // (D429: do not pin a defect's behaviour as though it were intended) — it is
    // here so the two sentences' floors are stated, not so they are defended.
    expect(parked(swing(board(), STATIC_FLICK).state).min).toBeUndefined();
    expect(parked(swing(board(), DRAINING_SAP).state).min).toBeUndefined();
  });

  it("a whiff is silent: no movable Energy, and a bench too short for 'another'", () => {
    // The op's own no-op test, on the other board. An opponent holding no Energy
    // offers nothing; an opponent with ONE body in play has no distinct destination
    // for the free route's printed "another" (`needed: 2`).
    expect(swing(board({ oppEnergy: 0, oppBenchEnergy: 0 }), STATIC_FLICK).state.phase.kind).not.toBe(
      "effect:choose",
    );
    expect(swing(board({ oppBench: 0 }), STATIC_FLICK).state.phase.kind).not.toBe("effect:choose");
    // …and `selfToBench` whiffs on an EMPTY opponent bench for the mirrored reason.
    expect(swing(board({ oppBench: 0 }), DRAINING_SAP).state.phase.kind).not.toBe("effect:choose");
  });
});

describe("§3 — the apply: the Energy moves on THEIR board and nothing of yours moves", () => {
  it("one pick, one row, and both boards are read", () => {
    const state = swing(board(), STATIC_FLICK).state;
    const before = state.players.p1.active?.energy ?? [];
    const uid = parked(state).movable.find((offer) => offer.from.spot.spot === "active")
      ?.uid as string;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p2Bench(1) }] },
    });
    // The Energy left p2's Active and landed on p2's bench 1.
    expect(done.state.players.p2.active?.energy).not.toContain(uid);
    expect(done.state.players.p2.bench[1]?.energy).toContain(uid);
    // 🛑 AND THE ATTACKER'S OWN BOARD IS UNTOUCHED — the assertion a build that
    // crossed only ONE of the offer and the apply would fail, and the one that
    // makes "it moved" mean something.
    expect(done.state.players.p1.active?.energy).toEqual(before);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
    const [row] = events(done.events, "ENERGY_MOVED");
    expect(row?.seat).toBe("p2");
    expect(row?.actor).toBe("p1");
    expect(row?.from).toEqual({ spot: "active" });
    expect(row?.to).toEqual({ spot: "bench", index: 1 });
  });

  it("the wire belt: a destination on the ATTACKER's board is refused, not silently dropped", () => {
    // `validateChoice` is entirely PROMPT-relative and has no seat test of its own,
    // which is what let it widen for free — so the thing that refuses a p1
    // destination here is that the prompt does not OFFER one. The same rung passes
    // on an own-board park for a p2 destination (`derivedSpreadEnergyMove` §4), and
    // the pair is what shows the refusal follows the offer rather than a hardcoded
    // side.
    const state = swing(board(), STATIC_FLICK).state;
    const uid = parked(state).movable[0]?.uid as string;
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid, dest: p1Bench(0) }] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // The printed "another": a pick may not land on the body it came off, and on
    // the other board that is the SAME per-pick rule rather than a new one.
    const fromActive = parked(state).movable.find(
      (offer) => offer.from.spot.spot === "active",
    )?.uid as string;
    expectErr(
      state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: fromActive, dest: p2Active }] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and the WHOLE legal answer goes through, so neither refusal passes on a
    // build that refuses everything.
    expect(
      applyAction(state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: fromActive, dest: p2Bench(0) }] },
      }).ok,
    ).toBe(true);
  });

  it("the decline moves nothing on either board", () => {
    const state = swing(board(), DRAINING_SAP).state;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.state.players.p2.active?.energy).toHaveLength(2);
    expect(done.state.players.p2.bench[0]?.energy).toHaveLength(1);
    expect(events(done.events, "ENERGY_MOVED")).toEqual([]);
  });
});

describe("§4 — §11: the shield this op had never been asked about", () => {
  it("a shielded DESTINATION drops out of the offer and files one prevention row", () => {
    // `fix-mist-energy` prints "Prevent all effects of attacks used by your
    // opponent's Pokémon done to the Pokémon this card is attached to." Moving
    // Energy ONTO a body is an effect of an attack done to it, and the shields carry
    // no valence — no printing says "all HARMFUL effects" — so the model answers
    // both endpoints with one question (D424: prefer the refusal the model
    // re-derives over the one listed against it).
    const swung = swing(board({ mistOnBench: 1 }), STATIC_FLICK);
    expect(parked(swung.state).destinations).toEqual([p2Active, p2Bench(0)]);
    expect(events(swung.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    // 🛑 THE CONTROL, ONE AXIS AWAY (D424/D437): the SAME board without the Mist
    // Energy offers all three, so the rung above is not passing on a build that
    // offers nobody — and it is not passing because a shield refuses the whole op.
    expect(parked(swing(board(), STATIC_FLICK).state).destinations).toHaveLength(3);
    expect(events(swing(board(), STATIC_FLICK).events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
  });

  it("a shielded SOURCE drops its Energy from the offer too — the same body, both lists", () => {
    // The Mist Energy is itself a movable {C}, so a shielded body is a source AND a
    // destination on the free route. Both must go, and exactly ONE row is filed —
    // the dedupe the arm's Map exists for (`discardEnergy`'s distinct-body pass,
    // spelled differently on purpose so `precheck` stays clean).
    const swung = swing(board({ mistOnOppActive: true }), STATIC_FLICK);
    const prompt = parked(swung.state);
    expect(prompt.movable.every((offer) => offer.from.spot.spot === "bench")).toBe(true);
    expect(prompt.destinations).toEqual([p2Bench(0), p2Bench(1)]);
    expect(events(swung.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("a shielded opponent ACTIVE makes `selfToBench` a silent whiff", () => {
    // The route's only source is their Active; shield it and the op has nothing to
    // offer. It still ANNOUNCES — the shield refuses, it does not un-name (D437) —
    // and then resolves silently rather than parking on an empty prompt.
    const swung = swing(board({ mistOnOppActive: true }), DRAINING_SAP);
    expect(swung.state.phase.kind).not.toBe("effect:choose");
    expect(events(swung.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(events(swung.events, "ENERGY_MOVED")).toEqual([]);
  });

  it("the OWN-board family still asks nobody — the gate is `seat !== ctx.seat`, not `moveEnergy`", () => {
    // D430's rule: a shield printed against your opponent's cards does not protect
    // against your own. `effectRefusedOn` answers `false` outright when
    // `seat === ctx.seat`, so an own-board move files nothing even with a Mist
    // Energy on the mover — and the §11 filter is skipped entirely at the arm.
    // Without this the rung above proves only that SOMETHING refuses.
    let own = board();
    own = attachFromDeck(own, "p1", "fix-mist-energy", 1);
    const swung = swing(own, SELF_TO_BENCH);
    expect(events(swung.events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
    expect(parked(swung.state).movable.length).toBeGreaterThan(0);
  });
});

describe("§4b — the playability gate: the funnel and the offer answer about ONE board", () => {
  it("`moveEnergyPlayable` reads the OP's board, not the caller's", () => {
    // ⚠️ THIS RUNG EXISTS BECAUSE NO PRINTED SENTENCE CAN REACH THE GATE, AND
    // SAYING SO IS THE POINT (D420 — check the mutation is observable before you
    // believe anything about it). `programPlayable` consults `moveEnergyPlayable`
    // for a TRAINER or an ABILITY play; both of this slice's sentences are ATTACK
    // text, so no board in this file drives that call. The gate still HAD to move
    // with the offer — `moveEndpoints`' whole reason is that the two cannot
    // disagree (D222) — so it is driven DIRECTLY here rather than left as a line
    // no test can see. The falsifier for the indirection: a Trainer or an Ability
    // printing an opponent-board Energy move, at which point this becomes a board.
    const oppOnly = board({ ownEnergy: 0 });
    const crossing = { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, side: "opponent" } as const;
    const ownBoard = { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1 } as const;
    // p1 holds NO Energy and p2 holds three across two bodies, so the two answers
    // are opposite on one board — which is what makes this a measurement and not a
    // tautology. A gate reading the caller's seat answers `false` for both.
    expect(moveEnergyPlayable(oppOnly, "p1", crossing)).toBe(true);
    expect(moveEnergyPlayable(oppOnly, "p1", ownBoard)).toBe(false);
    // …and the mirror, from p2's chair: the same two ops swap answers.
    expect(moveEnergyPlayable(oppOnly, "p2", crossing)).toBe(false);
    expect(moveEnergyPlayable(oppOnly, "p2", ownBoard)).toBe(true);
  });
});

describe("§5 — the log: the row reads from the ACTOR and names the OWNER's board", () => {
  const ctx = (state: GameState): LogContext => ({ names: NAMES, state, elapsed: "+00:07" });
  const texts = (state: GameState, all: GameEvent[]) =>
    logFromEvents(all, ctx(state)).flatMap((entry) =>
      entry.kind === "turn" ? [] : [entry.segments.map((segment) => segment.text).join("")],
    );
  /** Which player the row is filed under — `who`, the field the HUD turns into the
      viewer-relative "you"/"opponent" chip. */
  const whoOf = (state: GameState, all: GameEvent[]) =>
    logFromEvents(all, ctx(state)).flatMap((entry) => (entry.kind === "turn" ? [] : [entry.who]));

  it("a cross-board move says WHOSE board, and the row belongs to the attacker", () => {
    const state = swing(board(), STATIC_FLICK).state;
    const uid = parked(state).movable.find((offer) => offer.from.spot.spot === "active")
      ?.uid as string;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p2Bench(1) }] },
    });
    const moved = events(done.events, "ENERGY_MOVED");
    const [line] = texts(done.state, moved);
    // 🛑 D425's DEFECT, NAMED: before this slice `log.ts` resolved BOTH targets
    // against the row's one seat, so a cross-board row would have named the
    // ATTACKER's Pokémon at the DEFENDER's spots. The names below are p2's bodies
    // (`fix-bigbody` Active, `fix-basic-1` bench) and the possessive is theirs —
    // `ENERGY_DISCARDED`'s rule, because the `who` chip is VIEWER-relative and a
    // mirror match would otherwise print a sentence true from neither seat.
    expect(line).toBe("moved 1 energy on Tide's board, from fix-bigbody to fix-basic-1");
    expect(whoOf(done.state, moved)).toEqual(["p1"]);
  });

  it("an own-board move renders BYTE-IDENTICALLY to the row it always rendered", () => {
    // THE REGRESSION HALF, and the reason `log.ts` forks on `actor === seat` rather
    // than on a flag (`DECK_TOP_DISCARDED`'s stated rule). Every row this event has
    // emitted since M4 is on this arm, so a slice that "improved" the wording would
    // have moved rows in twelve suites for two printings' benefit.
    const state = swing(board(), SELF_TO_BENCH).state;
    const uid = parked(state).movable[0]?.uid as string;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p1Bench(0) }] },
    });
    const [line] = texts(done.state, events(done.events, "ENERGY_MOVED"));
    expect(line).toBe("moved 1 energy from fix-trainerops to fix-basic-1");
  });
});

describe("§6 — the wire: the prompt reaches the CONTROLLER, carrying the opponent's refs", () => {
  it("the answerer's snapshot carries p2's refs and uids; the other seat gets null", () => {
    const state = swing(board(), STATIC_FLICK).state;
    const mine = redactGame(state, "p1");
    const wire = mine.phase.kind === "effect:choose" ? mine.phase.prompt : null;
    if (wire === null || wire.kind !== "moveEnergy") throw new Error("expected a wire prompt");
    // The refs cross with their ABSOLUTE seats, which is what the wire ref's own doc
    // promises ("the client resolves a ref to a board Pokémon by comparing
    // `ref.seat` to that own seat") and what makes the HUD's `opponent` marker able
    // to fire at all.
    expect(wire.destinations.every((ref) => ref.seat === "p2")).toBe(true);
    expect(wire.movable.every((offer) => offer.from.seat === "p2")).toBe(true);
    // 🛑 AND NOTHING HIDDEN CROSSED. These are attached-Energy uids on a public
    // board — `redactedInPlayOf` emits `attached` for BOTH sides unconditionally —
    // so this stays the PUBLIC-REF family and needs no `decider`-style gate. The uid
    // is QUOTED against the opponent's own snapshot rather than substring-tested
    // (D426: `p2#4` is a prefix of `p2#42`).
    const theirs = redactGame(state, "p2");
    const oppBodies = [theirs.board.you.active, ...theirs.board.you.bench];
    const publicUids = new Set(
      oppBodies.flatMap((body) => body?.attached?.energies.map((card) => card.id) ?? []),
    );
    for (const offer of wire.movable) expect(publicUids.has(offer.uid)).toBe(true);
    // The prompt itself goes to the ANSWERER alone, and the answerer is the
    // controller — `redactedPromptOf`'s `phase.answerer ?? phase.seat`.
    expect(theirs.phase.kind === "effect:choose" ? theirs.phase.prompt : "absent").toBeNull();
  });
});

describe("§7 — the persisted shape: `MATCH_RECORD_VERSION` stays 29", () => {
  it("a reconstructed v29 park still means the CONTROLLER's board, and a v30 one does not", () => {
    // 🛑 ASKED AT THE RIGHT ADDRESS (D442's finding, re-verified rather than
    // inherited): a `MatchRecord` is `{version, seed, startedAt, names, state, log}`;
    // `state.phase` holds the PROMPT and the `EffectContinuation`
    // (`{pendingOp, rest, ctx, record?}`); `log` is the RENDERED `SeatLogEntry[]`.
    // So of this slice's three shape changes, exactly ONE lands in bytes:
    //   · `moveEnergy.side` — on the OP, inside `phase.cont.pendingOp`. PERSISTED.
    //   · `ENERGY_MOVED.actor` — a `GameEvent`, and no `GameEvent` is in a
    //     `MatchRecord` at all. NOT persisted, which is why REQUIRED was free.
    //   · the prompt — UNCHANGED; `side` rides the op alone, so no wire key moved.
    // The constant therefore turns on one question: does an ABSENT `side` still mean
    // what a v29 writer meant? It does — v29 had no opponent-board move to write —
    // so this is D334's added optional and the INVERSE of D359's `upTo`, where an
    // absent key came to mean MANDATORY against bytes that had meant declinable.
    const live = swing(board(), STATIC_FLICK).state;

    // (a) THE OLD BYTES. A v29 record is reconstructed by deleting the key a v29
    // writer never wrote — from the persisted OP — and replayed through the real
    // action API. The prompt is left exactly as it is, because a v29 prompt IS this
    // prompt: `side` never reached it.
    const serialized: GameState = JSON.parse(JSON.stringify(live)) as GameState;
    if (serialized.phase.kind !== "effect:choose") throw new Error("expected a serialized park");
    const pendingOp = serialized.phase.cont.pendingOp as Record<string, unknown>;
    expect(pendingOp.op).toBe("moveEnergy");
    expect(pendingOp.side).toBe("opponent"); // it IS in the bytes — the reason this is asked
    const { side: _rider, ...ownBoardOp } = pendingOp;
    // The v29 park is one an OWN-board sentence could have written, so it is
    // answered on the OWN board — and the prompt's p2 refs, which a v29 record could
    // never have carried, are now unanswerable. Both halves are the point: absent
    // means own, at the APPLY as well as at the offer.
    const resumed: GameState = {
      ...serialized,
      phase: {
        ...serialized.phase,
        cont: { ...serialized.phase.cont, pendingOp: ownBoardOp as unknown as EffectOp },
      },
    };
    const uid = parked(resumed).movable[0]?.uid as string;
    const replayed = mustApply(resumed, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p2Bench(1) }] },
    });
    // Nothing moved: `moveEnergyApply` reads the OP's board, and a pick naming the
    // other seat is dropped. The opponent's board is exactly as it was.
    expect(replayed.state.players.p2.bench[1]?.energy).toEqual([]);
    expect(events(replayed.events, "ENERGY_MOVED")).toEqual([]);

    // (b) THE OTHER DIRECTION, ON THE SAME BOARD AND THE SAME ANSWER (D441 — both
    // directions or neither). WITH the rider the identical frame moves the Energy,
    // so (a) is not passing because the engine refuses this answer generally.
    const withRider = mustApply(live, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: p2Bench(1) }] },
    });
    expect(withRider.state.players.p2.bench[1]?.energy).toEqual([uid]);
    expect(events(withRider.events, "ENERGY_MOVED")).toHaveLength(1);
  });
});

describe("§8 — the version block", () => {
  it("the engine version was bumped in the same commit as the behaviour", () => {
    // D208's debt and D275's mutant: `engineVersion` and `packages/engine/package.json`
    // are one fact with two spellings, and the pin is authored HERE rather than
    // inherited (D427 — every note counts the pins it inherited and never the one it
    // is about to author; this is D443's own).
    expect(engineVersion).toBe("0.379.0");
  });
});
