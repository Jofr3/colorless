import { describe, expect, it } from "vitest";
import { redactedAttackSchema } from "@luminous/schema";
import { topUid } from "./cards";
import {
  disabledAbilityUids,
  effectiveAttackCost,
  opposingAttackCostSurcharge,
  selfAttackCostDiscount,
  stadiumEffectsOf,
} from "./continuous";
import { applyAction, programFor, redactGame } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deckOf,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
} from "./testFixtures";

// 0.113.0 → 0.114.0 — THE FIRST ATTACK-COST DISCOUNT AND ITS SURCHARGE SIBLING
// (P3-M5 long tail, D169). One mechanism, opposite signs, two printings:
//
//   "As long as this Pokémon is in the Active Spot, attacks used by your
//    opponent's Active Pokémon cost {C} more."      (Seismitoad sv03-052
//                                                    "Quaking Zone")
//   "This Pokémon's attacks cost Colorless less for each Prize card your
//    opponent has taken."                           (Radiant Charizard
//                                                    swsh10.5-011 "Excited Heart")
//
// ⚠️ THE FAMILY CLOSES AT 3/3 AND THE THIRD MEMBER WAS ALREADY BUILT. Censused as
// its own question against the local D1 (978 cards / 6 sets, 2026-08-03, all three
// text columns): the printed strings "cost {C} more" / "cost Colorless less" occur
// on THREE rows over THREE distinct sentences — these two ABILITIES plus Pokémon
// League Headquarters sv03-192, a STADIUM (`StadiumEffects.basicAttackCostSurcharge`,
// shipped in M4). `attacks_json` contributes nothing to this family: no attack in
// the pool modifies a cost.
//
// ⚠️ BOTH SIGNS WERE ALREADY EXPRESSIBLE, AND NO TYPE CHANGED. `effectiveAttackCost`
// returns `readonly string[]` of literal energy symbols with "Colorless" a
// distinguished member — `costMet` (attack.ts) buckets it by exactly that string
// compare — so a surcharge APPENDS and a discount REMOVES. **The array floors
// itself**: a removal loop can only remove symbols that are present, so a 6-Prize
// discount against a printed {W}{W} leaves {W}{W}. That is the sharpest structural
// difference from `effectiveRetreatCost`, whose cost is a NUMBER and which must
// clamp at `Math.max(0, …)`. Driven below rather than asserted in prose.
//
// ⚠️ AND THE ONE BEHAVIOUR CHANGE TO EXISTING CODE IS A GATE THAT MOVED. The old
// body opened `if (top === undefined || !isBasicPokemon(top)) return cost;` — a
// clause belonging to League HQ's printed "each BASIC Pokémon in play" and to
// nothing else. Neither new sentence prints a stage, and Seismitoad is itself a
// STAGE 2, so a surviving early return would have switched the surcharge off
// against every Stage 1/2 Active it aims at. The Basic test is now a per-TERM gate
// (`stadiumRetreatDelta`'s move, one seam over), and the board that separates the
// two — a Stage 2 facing a Stage 2 under League HQ — is driven below.

/** The printed sentences, byte-for-byte off the fielded rows. */
const QUAKING_ZONE =
  "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon cost {C} more.";
const EXCITED_HEART =
  "This Pokémon's attacks cost Colorless less for each Prize card your opponent has taken.";

/** Radiant Charizard's one attack, index 0. */
const COMBUSTION_BLAST = ["Fire", "Colorless", "Colorless", "Colorless", "Colorless"] as const;
/** Seismitoad's one attack, index 0. */
const ECHOED_VOICE = ["Water", "Water"] as const;

/** One seed for the whole suite: nothing in this family flips a coin, so a seed
    table would describe a shuffle rather than a rule (D143's move, inherited by
    every long-tail slice since). */
const SEED = 7;

// ⚠️ THE DECK LIVES HERE AND NOT IN `testFixtures.ts`, WHICH IS A DEVIATION WORTH
// ONE PARAGRAPH. Every other suite's 60 is a `testFixtures` export; this one is
// built from the exported `deckOf` in this file, for two reasons that both point
// the same way. The cast this slice needs — both printings PLUS League HQ PLUS a
// §9 lock each — exists in no current deck and spans three of them
// (`RADIANT_LOCK_DECK` has the Charizard, `PER_ATTACK_BUFF_DECK` the Seismitoad
// and Ting-Lu ex, `STADIUM_TOOL_DECK` the Stadium), and every one of those is
// dealt off a pinned shuffle that growing it would move. And no fixture CARD is
// owed: all five real ids below were already fielded verbatim, with their printed
// Abilities and with the simplification stated out loud beside each. The web-side
// `GameHud.dom.test.tsx` already builds its 60 this way, so the idiom is not new.
const ATTACK_COST_DECK = deckOf({
  "swsh10.5-011": 4, // Radiant Charizard — "Excited Heart": the DISCOUNT, on a BASIC
  "sv03-052": 4, // Seismitoad — "Quaking Zone": the SURCHARGE, on a STAGE 2
  "sv03-192": 2, // Pokémon League Headquarters — the Stadium already on this seam
  "sv01-096": 3, // Klefki — "Mischievous Lock": the §9 lock that reaches the BASIC
  "sv02-127": 3, // Ting-Lu ex — "Cursed Land": the §9 lock the STAGE 2 needs
  "fix-titan": 24, // 340 HP neutral Basic, NO attacks — DOMINANT starter + every neutral body
  "fix-fire-energy": 6, // {R} — Combustion Blast's typed symbol
  "fix-water-energy": 6, // {W}{W} — Echoed Voice
  "fix-energy": 8, // Colorless Basic — the {C}{C}{C}{C} behind Combustion Blast
});

/** Field `cardId` in `seat`'s Active spot, sending the displaced body back to the
    bottom of the deck so the bench stays empty and no board below inherits one. */
function active(state: GameState, seat: Seat, cardId: string): GameState {
  return clearBench(setActiveFromDeck(state, seat, cardId), seat);
}

/** Setup on P1's turn 3 (two passes past the §4 first-turn ban), both seats on the
    same 60, both Active spots NORMALISED to the inert 340 HP body and both benches
    emptied — so every board below is exactly what its own surgeries put on it. The
    normalisation is not cosmetic: three of this deck's Basics carry Abilities that
    would otherwise arrive as a starter (a Klefki in the opposing spot silences
    Excited Heart outright). */
function board(): GameState {
  let state = driveSetup(SEED, { p1: ATTACK_COST_DECK, p2: ATTACK_COST_DECK }, { first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = active(state, "p1", "fix-titan");
  return active(state, "p2", "fix-titan");
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const spot = state.players[seat].active;
  if (spot === null) throw new Error(`${seat} has no Active`);
  return spot;
}

/** Play `cardId` from P1's deck into the shared Stadium zone (§7.3). */
function withStadium(state: GameState, cardId: string): GameState {
  const next = handFromDeck(state, "p1", cardId, 1);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid: handUid(next, "p1", cardId) })
    .state;
}

/** "Your opponent has taken N Prizes" — their pile is 6 − N (types.ts
    `takenPrizes`), which is the count Excited Heart scales on. */
function opponentTook(state: GameState, seat: Seat, taken: number): GameState {
  return setPrizes(state, seat, 6 - taken);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE DATA ROWS — two registry entries, and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("the registry rows", () => {
  it("authors sv03-052 as a cross-board attack-cost surcharge, and NOTHING else", () => {
    expect(programFor("sv03-052")).toEqual({
      passive: { opponentActiveAttackCostSurcharge: 1 },
    });
    // ⚠️ PASSIVE-ONLY, AND THE ABSENCE IS THE ASSERTION. The card's ATTACK
    // ("Echoed Voice", D155's per-attack damage buff) is derived from its printed
    // text by `deriveAttackEffect`; the attack seam reads
    // `programFor(id)?.attack?.[index]` FIRST and an `attack` map here would have
    // silently taken that derivation over.
    expect(programFor("sv03-052")?.attack).toBeUndefined();
  });

  it("authors swsh10.5-011 as a per-opponent-Prize discount, and NOTHING else", () => {
    expect(programFor("swsh10.5-011")).toEqual({
      passive: { attackCostDiscountPerOpponentPrize: 1 },
    });
    // Same absence, same reason: "Combustion Blast" carries D154's per-attack LOCK
    // in its printed text and `perAttackLock.test.ts` drives it off that derivation.
    expect(programFor("swsh10.5-011")?.attack).toBeUndefined();
  });

  it("both rows key cards whose printed text is fielded VERBATIM", () => {
    expect(FIXTURE_POOL["sv03-052"]?.abilities?.[0]).toEqual({
      type: "Ability",
      name: "Quaking Zone",
      effect: QUAKING_ZONE,
    });
    expect(FIXTURE_POOL["swsh10.5-011"]?.abilities?.[0]?.name).toBe("Excited Heart");
    expect(FIXTURE_POOL["swsh10.5-011"]?.abilities?.[0]?.effect).toBe(EXCITED_HEART);
    // The two COSTS this whole suite is about, off the rows rather than typed.
    expect(FIXTURE_POOL["swsh10.5-011"]?.attacks?.[0]?.cost).toEqual([...COMBUSTION_BLAST]);
    expect(FIXTURE_POOL["sv03-052"]?.attacks?.[0]?.cost).toEqual([...ECHOED_VOICE]);
    // …and the STAGES, which is why the Basic gate had to move off the fold.
    expect(FIXTURE_POOL["swsh10.5-011"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv03-052"]?.stage).toBe("Stage2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DISCOUNT — the slice's one real novelty.
// ─────────────────────────────────────────────────────────────────────────────

describe("Excited Heart — the DISCOUNT", () => {
  it("takes nothing off at 0 taken Prizes, and returns the PRINTED ARRAY ITSELF", () => {
    const state = active(board(), "p1", "swsh10.5-011");
    const printed = [...COMBUSTION_BLAST];
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
    // Reference identity, not deep equality: `effectiveAttackCost` documents that
    // it hands back the caller's own array when the net delta is zero, and
    // `redactedAttacksOf` leans on that to keep the wire frame unchanged.
    expect(effectiveAttackCost(state, activeOf(state, "p1"), printed)).toBe(printed);
  });

  it("removes one {C} per Prize the OPPONENT has taken, leaving the typed symbol", () => {
    let state = active(board(), "p1", "swsh10.5-011");
    state = opponentTook(state, "p2", 2);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(2);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), COMBUSTION_BLAST)).toEqual([
      "Fire",
      "Colorless",
      "Colorless",
    ]);
  });

  it("scales all the way down to the typed symbol at 4 taken", () => {
    let state = active(board(), "p1", "swsh10.5-011");
    state = opponentTook(state, "p2", 4);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), COMBUSTION_BLAST)).toEqual(["Fire"]);
  });

  it("SELF-FLOORS past the last Colorless — 6 taken still owes {R}, never a negative", () => {
    // ⚠️ THE STRUCTURAL CLAIM OF THE WHOLE SLICE, DRIVEN. `effectiveRetreatCost`
    // needs `Math.max(0, …)` because its cost is a NUMBER; this cost is an ARRAY,
    // and the removal loop simply runs out of Colorless to spend itself on. There
    // is no floor in `effectiveAttackCost` and this is why none is owed.
    let state = active(board(), "p1", "swsh10.5-011");
    state = opponentTook(state, "p2", 6);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(6);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), COMBUSTION_BLAST)).toEqual(["Fire"]);
    // …and it never eats a TYPED symbol, which is what "cost Colorless less" means.
    // A cost of pure typed symbols is untouched by a 6-Prize discount.
    expect(effectiveAttackCost(state, activeOf(state, "p1"), ECHOED_VOICE)).toEqual([
      "Water",
      "Water",
    ]);
  });

  it("counts the OPPONENT's taken Prizes and not the holder's", () => {
    let state = active(board(), "p1", "swsh10.5-011");
    // P1 — the HOLDER — has taken five. The print says "your opponent has taken".
    state = setPrizes(state, "p1", 1);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
    // Mirror the board onto the other seat: the same card on P2 reads P1's pile.
    let mirrored = active(board(), "p2", "swsh10.5-011");
    mirrored = opponentTook(mirrored, "p1", 3);
    expect(selfAttackCostDiscount(mirrored, activeOf(mirrored, "p2"))).toBe(3);
  });

  it("is SELF-ONLY — a teammate beside the holder pays the printed cost", () => {
    // The single assertion that separates this shape from an aura. Charizard is
    // Active, a neutral body is benched, the opponent has taken four.
    let state = active(board(), "p1", "swsh10.5-011");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = opponentTook(state, "p2", 4);
    const teammate = state.players.p1.bench[0];
    if (teammate === undefined) throw new Error("expected a benched teammate");
    expect(selfAttackCostDiscount(state, teammate)).toBe(0);
    expect(effectiveAttackCost(state, teammate, COMBUSTION_BLAST)).toEqual([...COMBUSTION_BLAST]);
  });

  it("has NO Active clause — a BENCHED holder discounts too (the print scopes neither end)", () => {
    // Contrast the surcharge below, whose sentence Active-gates BOTH ends. Nothing
    // observable turns on this today (a benched Pokémon cannot attack), but a scan
    // that gated it would be enforcing a clause the card does not print.
    let state = active(board(), "p1", "fix-titan");
    state = benchFromDeck(state, "p1", "swsh10.5-011");
    state = opponentTook(state, "p2", 2);
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("expected a benched Charizard");
    expect(selfAttackCostDiscount(state, benched)).toBe(2);
  });

  it("is LIVE-READ — taking a Prize during the game changes the cost with no restamp", () => {
    const state = active(board(), "p1", "swsh10.5-011");
    const before = effectiveAttackCost(state, activeOf(state, "p1"), COMBUSTION_BLAST);
    const after = effectiveAttackCost(
      opponentTook(state, "p2", 3),
      activeOf(state, "p1"),
      COMBUSTION_BLAST,
    );
    expect(before).toHaveLength(5);
    expect(after).toHaveLength(2);
    // Nothing was written onto the body: the same `InPlayPokemon` answers both.
    expect(state.players.p1.active).toBe(activeOf(state, "p1"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SURCHARGE — `opposingAttackDebuff`'s scan with one field renamed.
// ─────────────────────────────────────────────────────────────────────────────

describe("Quaking Zone — the cross-board SURCHARGE", () => {
  it("adds one {C} to the attacks of the Active it faces", () => {
    let state = active(board(), "p1", "fix-titan");
    state = active(state, "p2", "sv03-052");
    expect(opposingAttackCostSurcharge(state, activeOf(state, "p1"))).toBe(1);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), ECHOED_VOICE)).toEqual([
      "Water",
      "Water",
      "Colorless",
    ]);
  });

  it("does NOT surcharge its own holder — the print says 'your opponent's'", () => {
    let state = active(board(), "p1", "fix-titan");
    state = active(state, "p2", "sv03-052");
    expect(opposingAttackCostSurcharge(state, activeOf(state, "p2"))).toBe(0);
    const printed = [...ECHOED_VOICE];
    expect(effectiveAttackCost(state, activeOf(state, "p2"), printed)).toBe(printed);
  });

  it("SOURCE clause: a BENCHED Seismitoad surcharges nothing", () => {
    // The half `opposingRetreatSurcharge` does NOT have (Spidops ex imposes its
    // retreat surcharge from the Bench, because that sentence scopes only the
    // target). This sentence opens "As long as this Pokémon is in the Active Spot".
    let state = active(board(), "p1", "fix-titan");
    state = active(state, "p2", "fix-titan");
    state = benchFromDeck(state, "p2", "sv03-052");
    expect(opposingAttackCostSurcharge(state, activeOf(state, "p1"))).toBe(0);
  });

  it("TARGET clause: a BENCHED body on the surcharged side is untouched", () => {
    let state = active(board(), "p1", "fix-titan");
    state = active(state, "p2", "sv03-052");
    state = benchFromDeck(state, "p1", "fix-titan");
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("expected a benched body");
    expect(opposingAttackCostSurcharge(state, benched)).toBe(0);
  });

  it("is STAGE-AGNOSTIC on the target — the regression the moved Basic gate owes", () => {
    // ⚠️ THIS IS THE BOARD THAT WOULD HAVE PASSED SILENTLY UNDER THE OLD FOLD. Two
    // Seismitoads facing each other: both targets are STAGE 2, so the surviving
    // `!isBasicPokemon(top)` early return would have returned the printed cost and
    // dropped the aura entirely — on the one card whose own stage guarantees the
    // case comes up.
    let state = active(board(), "p1", "sv03-052");
    state = active(state, "p2", "sv03-052");
    expect(effectiveAttackCost(state, activeOf(state, "p1"), ECHOED_VOICE)).toEqual([
      "Water",
      "Water",
      "Colorless",
    ]);
    expect(effectiveAttackCost(state, activeOf(state, "p2"), ECHOED_VOICE)).toEqual([
      "Water",
      "Water",
      "Colorless",
    ]);
  });

  it("is LIVE-READ on BOTH ends — promoting either body out of the spot ends it", () => {
    let state = active(board(), "p1", "fix-titan");
    state = active(state, "p2", "sv03-052");
    expect(opposingAttackCostSurcharge(state, activeOf(state, "p1"))).toBe(1);
    // Move the SOURCE to the bench by fielding something else Active: the surcharge
    // is gone on the next read, with nothing unstamped anywhere.
    const moved = setActiveFromDeck(state, "p2", "fix-titan");
    expect(opposingAttackCostSurcharge(moved, activeOf(moved, "p1"))).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE FOLD — three sources, two signs, one array.
// ─────────────────────────────────────────────────────────────────────────────

describe("effectiveAttackCost — the ± fold", () => {
  it("nets a surcharge against a discount: +1 − 2 leaves ONE {C} off the print", () => {
    let state = active(board(), "p1", "swsh10.5-011");
    state = active(state, "p2", "sv03-052");
    state = opponentTook(state, "p2", 2);
    expect(opposingAttackCostSurcharge(state, activeOf(state, "p1"))).toBe(1);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(2);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), COMBUSTION_BLAST)).toEqual([
      "Fire",
      "Colorless",
      "Colorless",
      "Colorless",
    ]);
  });

  it("EXACT CANCELLATION returns the printed array itself — the two-fields proof", () => {
    // ⚠️ THE ASSERTION THAT REFUSES A SIGN-OVERLOADED FIELD. +1 and −1 must sum to
    // "no change", and a single field carrying both directions could not tell this
    // board apart from a board with no modifier at all — which is exactly the
    // failure a `<= 0` early return produces (D163). The reference identity is the
    // pin: the fold recognised the net as zero rather than rebuilding the array.
    let state = active(board(), "p1", "swsh10.5-011");
    state = active(state, "p2", "sv03-052");
    state = opponentTook(state, "p2", 1);
    const printed = [...COMBUSTION_BLAST];
    expect(effectiveAttackCost(state, activeOf(state, "p1"), printed)).toBe(printed);
  });

  it("folds ALL THREE sources — Stadium + aura − discount", () => {
    let state = active(board(), "p1", "swsh10.5-011");
    state = active(state, "p2", "sv03-052");
    state = withStadium(state, "sv03-192");
    state = opponentTook(state, "p2", 3);
    expect(stadiumEffectsOf(state)?.basicAttackCostSurcharge).toBe(1);
    // +1 (League HQ, the holder being a Basic) +1 (Quaking Zone) −3 = −1.
    expect(effectiveAttackCost(state, activeOf(state, "p1"), COMBUSTION_BLAST)).toEqual([
      "Fire",
      "Colorless",
      "Colorless",
      "Colorless",
    ]);
  });

  it("the Stadium stays Basic-only while the aura does not — the separating board", () => {
    // League HQ prints "each BASIC Pokémon in play"; Quaking Zone prints no stage.
    // On a STAGE 2 target only one of the two fires, which is the whole content of
    // making the Basic test a per-term gate.
    let state = active(board(), "p1", "sv03-052");
    state = active(state, "p2", "sv03-052");
    state = withStadium(state, "sv03-192");
    expect(effectiveAttackCost(state, activeOf(state, "p1"), ECHOED_VOICE)).toEqual([
      "Water",
      "Water",
      "Colorless",
    ]);
    // …and the CONTROL, on the same Stadium: a BASIC target takes both, so "one
    // {C}" above is not passing because the Stadium is somehow inert.
    let basicTarget = active(board(), "p1", "fix-titan");
    basicTarget = active(basicTarget, "p2", "sv03-052");
    basicTarget = withStadium(basicTarget, "sv03-192");
    expect(effectiveAttackCost(basicTarget, activeOf(basicTarget, "p1"), ECHOED_VOICE)).toEqual([
      "Water",
      "Water",
      "Colorless",
      "Colorless",
    ]);
  });

  it("a discount can eat a Stadium's own surcharge — the two meet in one array", () => {
    let state = active(board(), "p1", "swsh10.5-011");
    state = withStadium(state, "sv03-192");
    state = opponentTook(state, "p2", 2);
    // +1 − 2 = −1: four printed Colorless become three.
    expect(effectiveAttackCost(state, activeOf(state, "p1"), COMBUSTION_BLAST)).toEqual([
      "Fire",
      "Colorless",
      "Colorless",
      "Colorless",
    ]);
  });

  it("floors at the printed typed symbols even with the Stadium adding — net −4 on {W}{W}", () => {
    // A Stage 2 body carrying Charizard's discount cannot exist in the pool, so the
    // flooring case with a surcharge present is driven on the printed cost the
    // holder does NOT have: `effectiveAttackCost` takes the cost as an argument, and
    // this is the arm where "remove more Colorless than exist" has to be total.
    let state = active(board(), "p1", "swsh10.5-011");
    state = opponentTook(state, "p2", 6);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), ["Water", "Water"])).toEqual([
      "Water",
      "Water",
    ]);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), [])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — free on both cards, by two DIFFERENT locks.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 suppression — and the two cards need different locks", () => {
  it("Klefki silences Excited Heart: the BASIC holder pays the printed cost again", () => {
    let state = active(board(), "p1", "swsh10.5-011");
    state = active(state, "p2", "sv01-096"); // Klefki, Active — "Mischievous Lock"
    state = opponentTook(state, "p2", 3);
    const charizard = activeOf(state, "p1");
    expect(disabledAbilityUids(state).has(topUid(charizard) ?? "")).toBe(true);
    expect(selfAttackCostDiscount(state, charizard)).toBe(0);
    const printed = [...COMBUSTION_BLAST];
    expect(effectiveAttackCost(state, charizard, printed)).toBe(printed);
    // …and the CONTROL: bench the Klefki and the discount is back, so the zero
    // above is the LOCK and not the board.
    const unlocked = setActiveFromDeck(state, "p2", "fix-titan");
    expect(selfAttackCostDiscount(unlocked, activeOf(unlocked, "p1"))).toBe(3);
  });

  it("Klefki CANNOT reach Quaking Zone — Seismitoad is a Stage 2", () => {
    // D113's rule: the reachability follows the SOURCE's stage. Mischievous Lock
    // silences "Basic Pokémon in play", and this holder is not one — the negative
    // that explains why the second lock below is a different card.
    let state = active(board(), "p1", "sv01-096");
    state = active(state, "p2", "sv03-052");
    expect(disabledAbilityUids(state).has(topUid(activeOf(state, "p2")) ?? "")).toBe(false);
    expect(opposingAttackCostSurcharge(state, activeOf(state, "p1"))).toBe(1);
  });

  it("Ting-Lu ex silences Quaking Zone once the holder is DAMAGED", () => {
    let state = active(board(), "p1", "sv02-127"); // Ting-Lu ex, Active — "Cursed Land"
    state = active(state, "p2", "sv03-052");
    // UNDAMAGED first — Cursed Land's `requiresDamage` clause is the boundary, so
    // the surcharge is still on and the next assertion is about the damage alone.
    expect(opposingAttackCostSurcharge(state, activeOf(state, "p1"))).toBe(1);
    const damaged = setDamage(state, "p2", 10);
    expect(disabledAbilityUids(damaged).has(topUid(activeOf(damaged, "p2")) ?? "")).toBe(true);
    expect(opposingAttackCostSurcharge(damaged, activeOf(damaged, "p1"))).toBe(0);
    const printed = [...ECHOED_VOICE];
    expect(effectiveAttackCost(damaged, activeOf(damaged, "p1"), printed)).toBe(printed);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE §8.2 PAYABILITY GATE — the seam's first consumer.
// ─────────────────────────────────────────────────────────────────────────────

describe("the §8 declaration gate charges the EFFECTIVE cost", () => {
  /** Radiant Charizard Active with {R}{C}{C} attached — three of the five printed
      symbols, so the declaration turns entirely on the discount. */
  function shortPaid(taken: number): GameState {
    let state = active(board(), "p1", "swsh10.5-011");
    state = active(state, "p2", "fix-titan");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    return opponentTook(state, "p2", taken);
  }

  it("REFUSES Combustion Blast at 0 taken Prizes — {R}{C}{C} is two short", () => {
    expectErr(shortPaid(0), { type: "attack", seat: "p1", index: 0 }, "ATTACK_COST_UNMET");
  });

  it("ALLOWS it at 2 taken — the discount is what pays the difference", () => {
    const state = shortPaid(2);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(true);
    must(result);
  });

  it("REFUSES a printed-cost board once the opposing aura surcharges it", () => {
    // Seismitoad's own attack, paid to the printed {W}{W}, opposite a Seismitoad:
    // the surcharge makes it {W}{W}{C} and the gate says so.
    let state = active(board(), "p1", "sv03-052");
    state = active(state, "p2", "sv03-052");
    state = attachFromDeck(state, "p1", "fix-water-energy", 2);
    expectErr(state, { type: "attack", seat: "p1", index: 0 }, "ATTACK_COST_UNMET");
    // …and the CONTROL: bench the source and the same board attacks.
    const freed = clearBench(setActiveFromDeck(state, "p2", "fix-titan"), "p2");
    expect(applyAction(freed, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PROJECTION — `playable`, and the sibling wire field the discount forced.
// ─────────────────────────────────────────────────────────────────────────────

/** The acting viewer's own attack rows off the wire snapshot. */
function attackRows(state: GameState, seat: Seat) {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks;
}

describe("redactedAttacksOf — payability AND the cost the player is shown", () => {
  it("marks the short-paid Combustion Blast playable exactly when the gate does", () => {
    let bare = active(board(), "p1", "swsh10.5-011");
    bare = attachFromDeck(bare, "p1", "fix-fire-energy", 1);
    bare = attachFromDeck(bare, "p1", "fix-energy", 2);
    expect(attackRows(bare, "p1")[0]).toMatchObject({ name: "Combustion Blast", playable: false });
    const discounted = opponentTook(bare, "p2", 2);
    expect(attackRows(discounted, "p1")[0]).toMatchObject({ playable: true });
  });

  it("omits `effectiveCost` when nothing modifies the cost — `cost` is the print", () => {
    const state = active(board(), "p1", "swsh10.5-011");
    const row = attackRows(state, "p1")[0];
    expect(row?.cost).toEqual([...COMBUSTION_BLAST]);
    expect(row?.effectiveCost).toBeUndefined();
  });

  it("carries `effectiveCost` BESIDE the printed `cost` once a discount bites", () => {
    // ⚠️ THE DIVERGENCE THIS FIELD CLOSES. `playable` has been computed from the
    // EFFECTIVE cost since this projection was written, while `cost` published the
    // PRINTED one and nothing carried the difference. Harmless while the pool's only
    // modifier was a SURCHARGE (a greyed button and no explanation); wrong in the
    // worse direction the moment a DISCOUNT can light the button up while the dots
    // still show a cost the player has not paid.
    const state = opponentTook(active(board(), "p1", "swsh10.5-011"), "p2", 2);
    const row = attackRows(state, "p1")[0];
    expect(row?.cost).toEqual([...COMBUSTION_BLAST]);
    expect(row?.effectiveCost).toEqual(["Fire", "Colorless", "Colorless"]);
  });

  it("carries it for a SURCHARGE too — the direction that has shipped un-rendered", () => {
    let state = active(board(), "p1", "sv03-052");
    state = active(state, "p2", "sv03-052");
    const row = attackRows(state, "p1")[0];
    expect(row?.cost).toEqual([...ECHOED_VOICE]);
    expect(row?.effectiveCost).toEqual(["Water", "Water", "Colorless"]);
  });

  it("omits it when the two signs CANCEL, and when a discount removes nothing", () => {
    // The field means "this cost DIFFERS from the print", not "a modifier exists" —
    // so a +1/−1 board and a discount with no Colorless to eat both omit it.
    let cancelled = active(board(), "p1", "swsh10.5-011");
    cancelled = active(cancelled, "p2", "sv03-052");
    cancelled = opponentTook(cancelled, "p2", 1);
    expect(attackRows(cancelled, "p1")[0]?.effectiveCost).toBeUndefined();
    // Klefki's board: a live discount, silenced, so the print stands.
    let silenced = active(board(), "p1", "swsh10.5-011");
    silenced = active(silenced, "p2", "sv01-096");
    silenced = opponentTook(silenced, "p2", 4);
    expect(attackRows(silenced, "p1")[0]?.effectiveCost).toBeUndefined();
  });

  it("every row it emits still parses as a RedactedAttack — and so does one without the field", () => {
    // The backward-compatibility claim, driven rather than asserted: the field is
    // OPTIONAL, so a frame written before it existed is still valid. That is also
    // the whole reason no `MATCH_RECORD_VERSION` question arises — this shape is a
    // wire projection rebuilt from `GameState` every frame and persisted nowhere.
    const state = opponentTook(active(board(), "p1", "swsh10.5-011"), "p2", 2);
    for (const row of attackRows(state, "p1")) {
      expect(redactedAttackSchema.safeParse(row).success).toBe(true);
    }
    expect(
      redactedAttackSchema.safeParse({
        index: 0,
        name: "Combustion Blast",
        cost: [...COMBUSTION_BLAST],
        damage: "250",
        playable: false,
      }).success,
    ).toBe(true);
  });

  it("leaks nothing to the opponent — their view of the same turn is still []", () => {
    const state = opponentTook(active(board(), "p1", "swsh10.5-011"), "p2", 2);
    const phase = redactGame(state, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(phase.attacks).toEqual([]);
  });
});
