import { describe, expect, it } from "vitest";
import { benchShieldedFromDamage, benchShieldedFromEffects } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  SPHERICAL_SHIELD_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.169.0 → 0.170.0 — Rabsca "Spherical Shield" (P3-M5 long tail, D254):
// "Prevent all damage from and effects of attacks from your opponent's Pokémon
// done to your Benched Pokémon."
//
// THE LAST RUNG OF THE "AND EFFECTS OF ATTACKS" LADDER. D252 censused the family
// on the remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a) and got NINE
// legal printings on FOUR sentences; D252 took 2, D253 took 3, this takes the
// last 1, and the 3-printing TERA group stays permanently unbuildable ("Tera" is a
// printed BANNER and no ingested column carries it). ✅ THE CENSUS WAS RE-RUN AT
// THIS COMMIT — D253 met `403 / code 7403` on every query and had to INCREMENT
// `BUILT.ability` 133 → 136 from a transcribed row, flagging the gap in four
// places. D1 answered this session: the family measures 9-on-4 unchanged, this row
// is the 1 (`sv05-024`), and the 376-unit `programFor` join returns 136 at D253's
// commit and 137 here. The increment was right; it was still never a measurement,
// so the re-derivation streak RESUMES at D254 rather than being back-dated.
//
// 🛑 AND THE SLICE'S FINDING IS THAT THE HANDOFF'S SHAPE CALL WAS HALF WRONG, IN
// THE HALF THAT COSTS. Three separate comment blocks re-homed `sv05-024` as
// "`benchShieldedByActive`'s shape". Read the printed string (D245's rule, seventh
// consecutive slice it has paid on) and the two sentences share exactly ONE clause:
//
//   Thundurus sv03-070   SOURCE: "As long as this Pokémon is in the Active Spot"
//                        TARGET: "your Benched Pokémon"
//   Rabsca    sv05-024   SOURCE: — (none printed)
//                        TARGET: "your Benched Pokémon"
//
// So this is neither `benchShieldedByActive`'s shape (which gates the source) nor
// `hasFreeRetreatAura`'s (which gates neither end) — it is the HYBRID, and
// `continuous.ts seatDamageReduction`'s doc block had already argued that exact
// fork in the abstract without a printing to hang it on.
//
// 🛑 WHICH MAKES THIS THE FIRST MEMBER OF THE BENCH-SHIELD FAMILY WHOSE SOURCE SET
// CONTAINS ITS TARGET SET, AND THAT IS WHAT THE SLICE ACTUALLY COST. A benched
// Rabsca is one of "your Benched Pokémon", so it shields ITSELF — where Thundurus,
// standing in the Active Spot, is structurally immune to its own shield. D151's
// Feint Attack reading ("not affected … by any effects on that Pokémon") therefore
// splits per BOARD rather than per SITE for the first time in this family: a sniped
// Rabsca loses its own shield, a sniped TEAMMATE keeps it, off one declaration of
// one printed attack. Hence `scope`, copied verbatim from `seatDamageReduction`,
// required rather than defaulted.
//
// ✅ AND THE READ SITES COST NOTHING, WHICH IS THE FUNNEL RULE PAYING. The handoff
// priced FOUR new damage disjuncts. `benchShieldedFromDamage` was already the sole
// funnel at all four damage arms (it has been since D159), so the second sentence
// is a widening INSIDE one function plus one argument at each call — no new
// disjunct anywhere. The one genuinely new disjunct is the EFFECTS half at
// `attackEffectRefused`.
//
// 🛑 THE FIVE READ SITES AND THEIR LIVE/DEAD SPLIT, ASSERTED BELOW RATHER THAN
// ASSUMED — and note that THREE of them were already dead for Thundurus, because
// the TARGET clause the two sentences share is what kills them:
//   • attack.ts main hit          — DEAD (defender is the ACTIVE, §8)
//   • interpreter.ts spread       — LIVE  (maps `side.bench`)
//   • interpreter.ts placeSnipe   — LIVE  (maps `side.bench`) 🛑 and the ONE site
//                                          where `scope` is observable
//   • interpreter.ts snipeActive  — DEAD (`target.active`)
//   • interpreter.ts attackEffect — DEAD (`state.players[seat].active`)
//     Refused
// All five are guarded (TOTAL, not case-covering); the three dead ones carry NO
// mutants, because an unkillable mutant is a corpus defect rather than coverage.
//
// ⚠️ FIXTURE DIVERGENCE THAT NARROWS ONE TEST: `fix-spherical` is a BASIC where the
// real Rabsca is a Stage 1 (it evolves from Rellor). Klefki's "Mischievous Lock"
// names Basic Pokémon, so the §9 test below shows the field is gated through
// `disabledAbilityUids` AT ALL — not that Klefki beats Rabsca, which against the
// real printing it would not. Stated here and at the fixture rather than left to be
// discovered.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // {C}, 30 — the ACTIVE hit
const spread = { type: "attack", seat: "p1", index: 1 } as const; // 20 to each Benched
const yawn = { type: "attack", seat: "p1", index: 4 } as const; // Asleep — an effect op
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

const PEBBLE_TOSS = 2; // 40 to 1 of your opponent's Pokémon
const FEINT_ATTACK = 3; // 50 to 1, `ignoreWR` — the scope-observable arm

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function cardIdAt(state: GameState, p: { stack: string[] }): string | undefined {
  return idOf(state, p.stack.at(-1));
}

/** Find a P2 body on the BENCH by card id. Setup auto-benches the dominant
    `fix-bigbody`, so nothing here may assume `bench[0]` (D252's helper, re-keyed
    for the third time). */
function onBench(state: GameState, cardId: string) {
  return state.players.p2.bench.find((p) => cardIdAt(state, p) === cardId);
}

/** THE CASE BOARD, AND THE ONE THUNDURUS CANNOT BUILD: the holder standing on P2's
    BENCH beside a benched teammate, with a plain body in the Active Spot.

    🛑 EVERY CLAIM THIS SLICE MAKES THAT D159's DID NOT IS ON THIS BOARD. Thundurus
    on the Bench shields nothing at all (asserted in attackerFilter.test.ts and
    still green); Rabsca on the Bench shields the whole Bench INCLUDING the square
    it is standing on. A build that reused `preventBenchDamageWhileActive` would
    pass every Active-holder test below and fail here, which is exactly why the
    Active-holder tests are not enough on their own. */
function holderBenched(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(
    1,
    { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", "fix-spherical");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** THE SECOND CASE BOARD: the holder in P2's ACTIVE spot, shielding a Bench it is
    not standing on. This is the half Thundurus DOES print, and it is here to prove
    the widening did not trade one source clause for the other — a build that moved
    the source from "Active" to "Bench" instead of removing it would pass
    `holderBenched` and fail this. */
function holderActive(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(
    1,
    { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-spherical");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Declare a chosen-target attack and resolve the prompt onto the P2 body whose
    card id is `cardId` (or onto the Active). An `opponentAny` snipe with more than
    one candidate PARKS in `effect:choose` — the two-step is the shape, not an
    accident of this board (D251's helper, reused for the fourth slice running). */
function snipeAt(state: GameState, index: number, spot: "active" | string) {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find((c) => {
          if (c.spot.spot !== "bench") return false;
          const body = parked.players.p2.bench[c.spot.index];
          return body !== undefined && cardIdAt(parked, body) === spot;
        });
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("Spherical Shield — the registry data row", () => {
  // ✅ RE-DERIVED, NOT INHERITED. The census behind the 1 was re-run at this commit
  // (the file header states the query and the result), which is the first time in
  // two slices that this sentence could be written.
  it("authors the single printing as a bare preventBenchDamageAndEffects passive", () => {
    expect(programFor("sv05-024")?.passive).toEqual({ preventBenchDamageAndEffects: true });
  });

  // ⚠️ AND NO ATTACK PROGRAM, WHICH IS A CLAIM ABOUT `BUILT.attack` AND NOT A
  // DETAIL. Rabsca prints "Psychic" — a per-Energy rider the seven text readers
  // already resolve — so authoring an attack row here would take a sentence away
  // from the derivers and move a column this slice reports as UNCHANGED for the
  // ninth time running.
  it("authors NO attack program, so the deriver keeps the printed Psychic", () => {
    expect(programFor("sv05-024")?.attack).toBeUndefined();
  });

  // 🛑 THE MERGE THIS FIELD REFUSES, ASSERTED IN BOTH DIRECTIONS AND AGAINST THE
  // FIELD THE HANDOFF SAID IT WOULD REUSE. Thundurus prints an Active-Spot source
  // clause and no effects half; Rabsca prints neither. Folding them would hand
  // Thundurus a bench-standing source and Rabsca an Active-only one, and BOTH
  // directions are wrong on a board this pool can build.
  it("is a SECOND field beside preventBenchDamageWhileActive, not a widening of it", () => {
    expect(programFor("sv05-024")?.passive?.preventBenchDamageWhileActive).toBeUndefined();
    expect(programFor("sv03-070")?.passive?.preventBenchDamageAndEffects).toBeUndefined();
    expect(programFor("sv03-070")?.passive).toEqual({ preventBenchDamageWhileActive: true });
  });

  // ⚠️ AND IT IS NOT D253's FIELD EITHER, WHICH IS THE OTHER NEAR-MISS. Same six
  // printed words in the middle; `preventDamageAndEffectsWhileBenched` is a HOLDER
  // rule that `passivesOf` folds, this is a TARGET rule that only a scan can reach.
  it("does not touch D253's holder-zone field, and D253's does not touch this one", () => {
    expect(programFor("sv05-024")?.passive?.preventDamageAndEffectsWhileBenched).toBeUndefined();
    expect(programFor("sv06-020")?.passive?.preventBenchDamageAndEffects).toBeUndefined();
    expect(programFor("sv10.5b-023")?.passive?.preventBenchDamageAndEffects).toBeUndefined();
  });

  it("authors nothing on the sibling prevention rows", () => {
    for (const id of ["sv02-097", "sv01-099", "sv07-038", "sv06.5-060"]) {
      expect(programFor(id)?.passive?.preventBenchDamageAndEffects, id).toBeUndefined();
    }
  });

  // D145's move: discover the fixture demonstrator from the registry rather than
  // naming it, so a second fixture added without a case fails HERE.
  it("has exactly ONE fixture demonstrator in the pool", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventBenchDamageAndEffects === true,
    );
    expect(holders).toEqual(["fix-spherical"]);
    expect(programFor("fix-spherical")).toBe(programFor("sv05-024"));
  });
});

describe("benchShieldedFromDamage — the widened same-seat scan", () => {
  it("a BENCHED holder shields a benched TEAMMATE — the board Thundurus cannot build", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
  });

  // 🛑 THE SELF-INCLUSIVE READ, AND THE SHARPEST DIFFERENCE FROM D159. Thundurus
  // is immune to its own shield by construction (its source clause puts it in the
  // Active Spot and its target clause names the Bench). Rabsca's source clause is
  // absent, so the two sets overlap and it shields the square it stands on.
  it("a BENCHED holder shields ITSELF, where Thundurus never can", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-spherical");
    if (holder === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, holder, "all")).toBe(true);
  });

  it("an ACTIVE holder still shields the Bench — the source clause was REMOVED, not moved", () => {
    const state = holderActive();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
  });

  // The TARGET clause, which is the one thing the two sentences DO share: "your
  // BENCHED Pokémon". An Active holder protects the Bench and not the spot it is
  // standing in — so the main hit is never prevented, whichever field is granting.
  it("TARGET clause: an ACTIVE body is never shielded, holder or not", () => {
    const state = holderActive();
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(benchShieldedFromDamage(state, active, "all")).toBe(false);
  });

  // 🛑 THE `scope` SPLIT, READ DIRECTLY. "othersOnly" drops exactly the sources
  // that ARE the damaged body and keeps every other — so a holder loses its own
  // shield under Feint Attack and its teammate does not, on one board, in one call
  // pair. This is the assertion the whole parameter exists for.
  it("scope 'othersOnly' drops the holder's own contribution and keeps its teammate's", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-spherical");
    const titan = onBench(state, "fix-titan");
    if (holder === undefined || titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, holder, "othersOnly")).toBe(false);
    expect(benchShieldedFromDamage(state, titan, "othersOnly")).toBe(true);
  });

  // ⚠️ AND `scope` IS VACUOUS FOR THUNDURUS, WHICH IS WHY D159's FOUR SITES COULD
  // BE CONSTANT PER SITE. Its source is an Active and its target a benched body, so
  // the uids can never collide and both answers agree.
  it("scope is VACUOUS for the Active-source field — both answers agree", () => {
    let state = driveSetup(
      1,
      { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "sv03-070");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromDamage(state, titan, "othersOnly")).toBe(true);
  });

  // OWN-SIDE, the single line that separates this member from
  // `opposingAttackDebuff`: it reads the side it FOUND and never the other one.
  it("is OWN-SIDE: the opponent's Bench is untouched by it", () => {
    let state = holderBenched();
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const acrossTheTable = state.players.p1.bench[0];
    if (acrossTheTable === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, acrossTheTable, "all")).toBe(false);
  });

  // 🛑 THE REGRESSION D254 HAD TO NOT CAUSE, AND THE LINE THAT MADE IT POSSIBLE.
  // The old scan bailed with `return false` the moment a side's Active Spot was
  // empty, because an Active was the only source it knew about. That was a correct
  // reading of ONE sentence and would silently drop every Rabsca on the Bench
  // behind an empty Active Spot — a board a KO reaches routinely.
  it("an EMPTY Active Spot no longer ends the scan — a benched source still shields", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(benchShieldedFromDamage(empty, titan, "all")).toBe(true);
  });

  it("…and with no source in play at all it reads FALSE rather than throwing", () => {
    let state = holderActive();
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(benchShieldedFromDamage(empty, titan, "all")).toBe(false);
  });
});

describe("benchShieldedFromEffects — the half preventBenchDamageWhileActive has no share in", () => {
  // 🛑 THE FIELD SPLIT, READ AT THE SCAN RATHER THAN AT THE REGISTRY. Thundurus
  // stops DAMAGE and prints no effects half; a widening that let its field reach
  // the effects site would hand one legal printing a status immunity it does not
  // print. The two calls below are the same board and disagree, which is the whole
  // claim.
  it("Thundurus's field answers TRUE for damage and FALSE for effects", () => {
    let state = driveSetup(
      1,
      { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "sv03-070");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromEffects(state, titan)).toBe(false);
  });

  it("Rabsca's field answers TRUE for BOTH halves, which is what 'and effects of' buys", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromEffects(state, titan)).toBe(true);
  });

  it("…and the TARGET clause still applies to the effects half", () => {
    const state = holderActive();
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(benchShieldedFromEffects(state, active)).toBe(false);
  });
});

describe("the LIVE read sites — the two arms that reach a Bench", () => {
  it("spread: the splash is nulled on BOTH benched bodies, and the Active takes its 30", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, spread);

    expect(done.players.p2.active?.damage).toBe(30);
    for (const body of done.players.p2.bench) {
      expect(body.damage, cardIdAt(done, body)).toBe(0);
    }
    // ⚠️ A PREVENTED BENCH HIT STILL EMITS `DAMAGE_DEALT`, WITH A ZERO — the arm
    // pushes the event unconditionally and `dealt` is what the prevention zeroes.
    // So the count is one per body the spread reached (Active + three benched) and
    // the CLAIM is in the amounts, not in the event count. Asserted this way round
    // deliberately: an assertion on the count would have been green on an engine
    // that skipped the bench arm entirely.
    const dealt = events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1 + done.players.p2.bench.length);
    // ⚠️ AND THE `prevented` FLAG IS WHERE THE CLAIM ACTUALLY LIVES — every benched
    // body's event carries it and the Active's does not, which is a stronger
    // statement than "the bench took 0" because it distinguishes a PREVENTION from
    // an attack that reached the bench and happened to compute zero.
    expect(dealt.filter((e) => e.prevented === true)).toHaveLength(done.players.p2.bench.length);
  });

  // ⚠️ THE SAME BOARD WITHOUT THE HOLDER, so "0" above is a prevention and not an
  // attack that never landed. The control is the demonstrator's negative and is
  // the only thing that makes the assertion above mean anything.
  it("…and with NO holder on the Bench the same spread lands 20 on each", () => {
    let state = driveSetup(
      1,
      { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-shellcracker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: done } = mustApply(state, spread);
    expect(onBench(done, "fix-titan")?.damage).toBe(20);
  });

  it("placeSnipe: a benched TEAMMATE is shielded", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });

  it("placeSnipe: the benched HOLDER shields itself", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-spherical");
    expect(onBench(done, "fix-spherical")?.damage).toBe(0);
  });
});

describe("Feint Attack — the ONE site where `scope` is observable", () => {
  // 🛑 THE SLICE'S SHARPEST BOARD. One printed attack, two targets, two answers,
  // and D151's clause is the only thing separating them: Rabsca's shield is "an
  // effect on that Pokémon" when Rabsca is the one being sniped and is not when a
  // teammate is. A build that passed "all" here would prevent both; a build that
  // passed "othersOnly" at the wrong level would prevent neither.
  it("a sniped HOLDER loses its own shield and takes the 50", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-spherical");
    expect(onBench(done, "fix-spherical")?.damage).toBe(50);
  });

  it("…and a sniped TEAMMATE keeps it, on the SAME board and the same attack", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });

  // ⚠️ AND WITH THE HOLDER IN THE ACTIVE SPOT, FEINT ATTACK NULLS NOTHING — the
  // source is a different body again, so D159's answer is restored. The `scope`
  // argument is doing real work only when the two sets overlap, which is the
  // narrowest true statement about it.
  it("an ACTIVE holder's shield survives Feint Attack — the source is another body", () => {
    const state = holderActive();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });
});

describe("the DEAD read sites — guarded for totality, asserted rather than assumed", () => {
  it("attack.ts main hit: the defending ACTIVE takes its 30 with a holder benched", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = mustApply(state, bite);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("snipeActive: a chosen ACTIVE target takes its 40 with a holder benched", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "active");
    expect(done.players.p2.active?.damage).toBe(40);
  });

  // 🛑 THE EFFECTS HALF IS STRUCTURALLY UNREACHABLE, AND THAT IS A MEASURED FACT
  // ABOUT TODAY'S OP SET RATHER THAN A READING OF THE PRINTING.
  // `attackEffectRefused` resolves `state.players[seat].active`, so the only board
  // this field could meet there is one where its TARGET clause is false. Yawn
  // lands. The disjunct is written at that site anyway, so the day an op aims an
  // effect at a benched body the guard is already there.
  it("attackEffectRefused: the Active is put to Sleep — no reachable board today", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, yawn);
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("§9 — a lock silences ONE source, not the scan", () => {
  /** Klefki Active on P1 (its "Mischievous Lock" is Active-gated and reaches
      across the table), with the holder and a teammate on P2's Bench. */
  function locked(): GameState {
    let state = driveSetup(
      1,
      { p1: SPHERICAL_SHIELD_DECK, p2: SPHERICAL_SHIELD_DECK },
      { first: "p2" },
    );
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    state = benchFromDeck(state, "p2", "fix-spherical");
    state = benchFromDeck(state, "p2", "fix-titan");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "sv01-096");
    return attachFromDeck(state, "p1", "fix-energy", 1);
  }

  it("a locked holder shields nothing, and unlocking it restores the shield", () => {
    const state = locked();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);
    expect(benchShieldedFromEffects(state, titan)).toBe(false);

    // The SAME board with a body that locks nothing in the Active Spot.
    const unlocked = setActiveFromDeck(state, "p1", "fix-shellcracker");
    const stillTitan = onBench(unlocked, "fix-titan");
    if (stillTitan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(unlocked, stillTitan, "all")).toBe(true);
  });

  // ⚠️ KLEFKI CARRIES ONE ATTACK AND NO SNIPE, so the lock cannot be driven at a
  // BENCH arm from the seat that is doing the locking. Its own hit lands on the
  // Active instead, which is enough: it proves the lock board is a real board that
  // an attack can be declared on, and the shield's absence is asserted at the unit
  // level above where it is exact.
  it("…and the lock board is drivable: Klefki's own hit lands on the Active", () => {
    const state = locked();
    deepFreeze(state);
    const { state: hit } = mustApply(state, joust);
    expect(hit.players.p2.active?.damage).toBe(10);
  });

  // 🛑 THE PER-SOURCE §9 GATE, WHICH IS D254's ONE DEPARTURE FROM D159's SCAN. The
  // old scan read the lock once, because it had exactly one source. This one may
  // have several, and a lock that silenced the SCAN rather than the SOURCE would
  // switch off a second, unlocked holder for free. Klefki names BASIC Pokémon and
  // both fixture holders are Basics, so this board cannot separate them — the claim
  // is made at the unit level instead, where it is exact.
  it("the gate is per SOURCE: a second unlocked source keeps the shield up", () => {
    let state = locked();
    // A Thundurus in the Active Spot is a SECOND source with a different field and
    // a different reachability. Klefki locks Basics and Thundurus is one, so this
    // asserts the shape of the read and not a divergence in what is silenced.
    state = setActiveFromDeck(state, "p2", "sv03-070");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);

    const unlocked = setActiveFromDeck(state, "p1", "fix-shellcracker");
    const stillTitan = onBench(unlocked, "fix-titan");
    if (stillTitan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(unlocked, stillTitan, "all")).toBe(true);
  });
});

describe("the fixture pool and the deck", () => {
  it("the holder prints the sentence verbatim and carries NO attacks", () => {
    const holder = FIXTURE_POOL["fix-spherical"];
    expect(holder?.abilities?.[0]?.effect).toBe(
      "Prevent all damage from and effects of attacks from your opponent's Pokémon done to your Benched Pokémon.",
    );
    // D253's trick, taken a second time: nothing this slice reads consults the
    // holder's attacks, so printing Rabsca's real "Psychic" would put a new
    // sentence in front of `clauseApostrophe.test.ts`'s sweep for no coverage.
    expect(holder?.attacks ?? []).toHaveLength(0);
  });

  it("the deck is exactly 60", () => {
    expect(SPHERICAL_SHIELD_DECK).toHaveLength(60);
  });

  // ⚠️ THE ATTACKER IS REUSED VERBATIM FOR THE THIRD SLICE RUNNING (D252 → D253 →
  // here), and this pins the two indices this suite reads by NAME rather than by
  // position, so an append to `fix-shellcracker` cannot silently re-point them.
  it("the attacker's snipe indices are the ones this suite names", () => {
    const attacks = FIXTURE_POOL["fix-shellcracker"]?.attacks ?? [];
    expect(attacks[PEBBLE_TOSS]?.name).toBe("Pebble Toss");
    expect(attacks[FEINT_ATTACK]?.name).toBe("Feint Attack");
    expect(find([], "DAMAGE_DEALT")).toBeUndefined();
  });
});
