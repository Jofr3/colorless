import { describe, expect, it } from "vitest";
import { effectiveRetreatCost, programFor, stadiumEffectsOf } from "./index";
import type { GameState } from "./index";
import {
  CALAMITOUS_WASTELAND_DECK,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.59.0 → 0.60.0 — Calamitous Wasteland sv02-175 (P3-M5 long tail, D109): "The
// Retreat Cost of each Basic non-{F} Pokémon in play (both yours and your
// opponent's) is {C} more."
//
// Beach Court's negative twin on the D108 retreat-cost seam: the same global,
// both-boards, Basic-only shape, but ADDING and carrying a type exemption. It is
// a pure `StadiumEffects` row plus one clause in `effectiveRetreatCost`, so all
// three readers of that one derivation point (turn.ts retreat, redact.ts, the
// web HUD) pick it up untouched. Only one Stadium is ever in play (§7.3), so the
// discount and the surcharge never stack — they REPLACE each other.

/** Setup on P1's turn with the Stadium in `seat`'s hand and played into the
    shared zone. */
function withStadium(state: GameState, cardId: string): GameState {
  const next = handFromDeck(state, "p1", cardId, 1);
  return mustApply(next, {
    type: "playTrainer",
    seat: "p1",
    uid: handUid(next, "p1", cardId),
  }).state;
}

/** Setup on P1's turn, then field `cardId` in P1's Active spot (the starter is
    displaced onto the bench, which a retreat then promotes). */
function board(seed: number, cardId: string): GameState {
  const state = driveSetup(
    seed,
    { p1: CALAMITOUS_WASTELAND_DECK, p2: CALAMITOUS_WASTELAND_DECK },
    { first: "p1" },
  );
  return setActiveFromDeck(state, "p1", cardId);
}

/** P1's Active's cost under every continuous modifier in play. */
function activeCost(state: GameState): number {
  const active = state.players.p1.active;
  if (active === null) throw new Error("p1 has no Active");
  return effectiveRetreatCost(state, active);
}

describe("Calamitous Wasteland — the registry data row (basicRetreatSurcharge)", () => {
  it("authors sv02-175 as a {F}-exempt Basic retreat surcharge", () => {
    expect(programFor("sv02-175")?.stadium).toEqual({
      basicRetreatSurcharge: { amount: 1, excludesType: "Fighting" },
    });
  });

  it("is visible through stadiumEffectsOf once played into the shared zone", () => {
    const state = withStadium(board(1, "fix-retreat2"), "sv02-175");
    expect(state.stadium).not.toBeNull();
    expect(stadiumEffectsOf(state)?.basicRetreatSurcharge).toEqual({
      amount: 1,
      excludesType: "Fighting",
    });
  });
});

describe("Calamitous Wasteland — the surcharge and its exemptions", () => {
  it("adds {C} to a Basic non-{F} Pokémon's printed cost", () => {
    const plain = board(2, "fix-retreat2");
    expect(activeCost(plain)).toBe(2);
    expect(activeCost(withStadium(plain, "sv02-175"))).toBe(3);
  });

  it("pushes a free retreater (printed 0) up to 1", () => {
    const plain = board(3, "fix-basic-0");
    expect(activeCost(plain)).toBe(0);
    expect(activeCost(withStadium(plain, "sv02-175"))).toBe(1);
  });

  it("EXEMPTS a {F} Pokémon — the non-{F} clause is a type gate", () => {
    const plain = board(4, "fix-fighting-1");
    expect(activeCost(plain)).toBe(1);
    expect(activeCost(withStadium(plain, "sv02-175"))).toBe(1);
  });

  it("does not touch a non-Basic, {F} or not (the Basic-only early-out)", () => {
    // fix-stage1 is Colorless and prints retreat 2 — it clears the type gate but
    // never reaches it, because effectiveRetreatCost returns the printed cost for
    // anything that isn't a Basic.
    const plain = board(5, "fix-retreat2");
    const stage1 = setActiveFromDeck(withStadium(plain, "sv02-175"), "p1", "fix-stage1");
    expect(activeCost(stage1)).toBe(2);
  });

  it("reaches BOTH boards — the opponent's Basic is surcharged too", () => {
    const surcharged = withStadium(board(6, "fix-retreat2"), "sv02-175");
    const state = setActiveFromDeck(surcharged, "p2", "fix-retreat2");
    const p2Active = state.players.p2.active;
    expect(p2Active).not.toBeNull();
    if (p2Active === null) throw new Error("unreachable");
    expect(effectiveRetreatCost(state, p2Active)).toBe(3);
  });
});

describe("Calamitous Wasteland — composing with the seam's other modifiers", () => {
  it("is Beach Court's sign-flipped twin, and the two can never stack", () => {
    // Same body, same printed 2 — the Stadium in the shared zone decides the sign.
    const plain = board(7, "fix-retreat2");
    expect(activeCost(withStadium(plain, "sv02-175"))).toBe(3);
    expect(activeCost(withStadium(plain, "sv01-167"))).toBe(1);

    // effectiveRetreatCost sums the ± deltas, but they can never meet: the shared
    // zone holds exactly one Stadium, and §7.3 allows one Stadium play per turn —
    // so the twin cannot even be laid down over this one.
    const surcharged = withStadium(plain, "sv02-175");
    const held = handFromDeck(surcharged, "p1", "sv01-167", 1);
    expect(stadiumEffectsOf(held)?.basicRetreatSurcharge).toBeDefined();
    expectErr(
      held,
      { type: "playTrainer", seat: "p1", uid: handUid(held, "p1", "sv01-167") },
      "STADIUM_ALREADY_PLAYED",
    );
  });

  it("loses to Lunar Zone's set-to-zero, which is read first (D108)", () => {
    let state = withStadium(board(8, "fix-retreat2"), "sv02-175");
    expect(activeCost(state)).toBe(3);
    state = benchFromDeck(state, "p1", "sv03-082");
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    expect(activeCost(state)).toBe(0);
  });
});

describe("Calamitous Wasteland — the retreat action pays the surcharge", () => {
  it("a printed-0 Basic must now discard 1 Energy to retreat", () => {
    let state = withStadium(board(9, "fix-basic-0"), "sv02-175");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const paid = state.players.p1.active?.energy ?? [];
    expect(paid).toHaveLength(1);
    const promoted = benchTopUid(state, "p1", 0);
    deepFreeze(state);

    // The free retreat the printed cost would have allowed is now rejected …
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 },
      "RETREAT_COST_MISMATCH",
    );

    // … and paying the surcharged 1 works.
    const { state: done, events } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: paid,
      promoteBenchIndex: 0,
    });
    expect(types(events)).toContain("RETREATED");
    expect(done.players.p1.active?.stack.at(-1)).toBe(promoted);
    expect(done.players.p1.discard).toContain(paid[0]);
  });
});
