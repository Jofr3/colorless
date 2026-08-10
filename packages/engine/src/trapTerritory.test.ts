import { describe, expect, it } from "vitest";
import {
  applyAction,
  disabledAbilityUids,
  effectiveRetreatCost,
  opposingRetreatSurcharge,
  programFor,
} from "./index";
import type { GameEvent, GameState, InPlayPokemon } from "./index";
import {
  FIXTURE_POOL,
  TRAP_TERRITORY_DECK,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.61.0 → 0.62.0 — Spidops ex sv01-019/-223/-243 "Trap Territory" (P3-M5 long
// tail, D111): "Your opponent's Active Pokémon's Retreat Cost is {C} more."
//
// The LAST unbuilt modifier on the retreat-cost seam — a full D1 census puts the
// seam at exactly 9 card ids (4 modifier effects / 4 reader effects, Spidops ex
// in both buckets), so this closes it. It is the cross-board, delta-returning
// mirror of D108's `noRetreatCostAura`, and the three things it turns on:
//
//   • the SOURCE has no "in the Active Spot" clause — only the TARGET does. A
//     benched Spidops ex surcharges just as well.
//   • it is stage-agnostic, unlike both Stadiums, which is why
//     `effectiveRetreatCost`'s Basic-only early RETURN had to become a zero TERM.
//   • a Stadium and an aura CAN coexist, so the ± composition D109 found
//     unreachable between the two Stadiums is finally reachable here — and the
//     floor has to be applied to the SUM, not per term.
//
// Plus the one composition that lands on a single card: Spidops ex's own "Wire
// Hang" READS (D110) the very cost this Ability raises.

const ABILITY_TEXT = "Your opponent's Active Pokémon's Retreat Cost is {C} more.";
const WIRE_HANG_TEXT =
  "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup on P1's open turn, then field `body` as P1's Active (the starter is
    displaced onto the bench, which a retreat can then promote). */
function board(seed: number, body = "fix-retreat2"): GameState {
  const state = driveSetup(
    seed,
    { p1: TRAP_TERRITORY_DECK, p2: TRAP_TERRITORY_DECK },
    { first: "p1" },
  );
  return setActiveFromDeck(state, "p1", body);
}

/** P1's Active — the surcharged body every assertion below reads. */
function p1Active(state: GameState): InPlayPokemon {
  const active = state.players.p1.active;
  if (active === null) throw new Error("p1 has no Active");
  return active;
}

/** P1's Active's cost under every continuous modifier in play. */
function activeCost(state: GameState): number {
  return effectiveRetreatCost(state, p1Active(state));
}

/** Play `cardId` out of P1's deck into the shared Stadium zone (a real action on
    P1's open turn). */
function withStadium(state: GameState, cardId: string): GameState {
  const next = handFromDeck(state, "p1", cardId, 1);
  return mustApply(next, { type: "playTrainer", seat: "p1", uid: handUid(next, "p1", cardId) })
    .state;
}

describe("Trap Territory — the registry data row (opponentActiveRetreatSurcharge)", () => {
  it("authors all three printings as a flat +1 surcharge, and NO target narrowing", () => {
    // 🆕 D322 — the field stopped being a bare `number`. Ariados `sv06-005`
    // "Big Net" prints the SAME delta with one adjective added ("your opponent's
    // Active EVOLUTION Pokémon's"), so the shape is now
    // `{ amount, targetEvolution? }` and Trap Territory is the UNMARKED print
    // that makes the rider legible. The `toEqual` is kept EXACT rather than
    // loosened to a `toMatchObject`: this row's whole job is to say that the
    // bare sentence carries nothing else, and the explicit `toBeUndefined`
    // below says it in the direction a future rider would break. The rider is
    // `seatDamageBonusBeforeWR.target`'s `CardFilter` reused whole (D245), not a
    // bespoke boolean — the same printed "Active Evolution Pokémon" one seam over.
    for (const id of ["sv01-019", "sv01-223", "sv01-243"]) {
      expect(programFor(id)?.passive).toEqual({ opponentActiveRetreatSurcharge: { amount: 1 } });
      expect(programFor(id)?.passive?.opponentActiveRetreatSurcharge?.target).toBeUndefined();
    }
  });

  it("keeps the fixture's printed text verbatim — Wire Hang DERIVES off it", () => {
    // Spidops ex carries a registry row for the Ability but NOT for the attack:
    // "Wire Hang" simulates straight off its sentence (D110), so a one-character
    // drift here silently un-simulates half the card with no other failure.
    const card = FIXTURE_POOL["sv01-019"];
    expect(card?.abilities?.[0]).toEqual({
      type: "Ability",
      name: "Trap Territory",
      effect: ABILITY_TEXT,
    });
    expect(card?.attacks?.[0]).toEqual({
      cost: ["Grass", "Colorless"],
      name: "Wire Hang",
      damage: "90+",
      effect: WIRE_HANG_TEXT,
    });
    // ASCII apostrophes, a real é — the bytes the live D1 holds.
    expect(ABILITY_TEXT).toContain("opponent's");
    expect(ABILITY_TEXT).toContain("Pokémon's");
    expect(ABILITY_TEXT).not.toContain("’");
  });
});

describe("Trap Territory — who imposes it, and on whom", () => {
  it("adds {C} to the opponent's Active Pokémon's Retreat Cost", () => {
    const bare = board(1);
    expect(activeCost(bare)).toBe(2);

    const state = setActiveFromDeck(bare, "p2", "sv01-019");
    expect(activeCost(state)).toBe(3);
    expect(opposingRetreatSurcharge(state, p1Active(state))).toBe(1);
  });

  it("imposes it from the BENCH too — the source has no Active Spot clause", () => {
    // The printed sentence scopes the TARGET ("your opponent's ACTIVE Pokémon"),
    // and nothing at all scopes the source. Contrast `damageAttacker`, whose
    // Active clause sits on the holder.
    const state = benchFromDeck(board(2), "p2", "sv01-019");
    expect(state.players.p2.active?.stack.at(-1)).not.toBe(benchTopUid(state, "p2", 0));
    expect(activeCost(state)).toBe(3);
  });

  it("reaches only the ACTIVE — a benched target pays the printed cost", () => {
    let state = setActiveFromDeck(board(3), "p2", "sv01-019");
    state = benchFromDeck(state, "p1", "fix-retreat2");
    const benched = state.players.p1.bench.at(-1);
    if (benched === undefined) throw new Error("no benched body");
    expect(activeCost(state)).toBe(3);
    expect(effectiveRetreatCost(state, benched)).toBe(2);
    expect(opposingRetreatSurcharge(state, benched)).toBe(0);
  });

  it("is OPPONENT-side — your own Spidops ex never surcharges your Active", () => {
    const state = benchFromDeck(board(4), "p1", "sv01-019");
    expect(activeCost(state)).toBe(2);
    expect(opposingRetreatSurcharge(state, p1Active(state))).toBe(0);
  });

  it("SUMS its sources — two Spidops ex are {C}{C} more", () => {
    let state = setActiveFromDeck(board(5), "p2", "sv01-019");
    state = benchFromDeck(state, "p2", "sv01-019");
    expect(opposingRetreatSurcharge(state, p1Active(state))).toBe(2);
    expect(activeCost(state)).toBe(4);
  });

  it("applies on BOTH boards independently", () => {
    let state = benchFromDeck(board(6), "p1", "sv01-019");
    state = setActiveFromDeck(state, "p2", "sv01-019");
    const p2Active = state.players.p2.active;
    if (p2Active === null) throw new Error("p2 has no Active");
    // P1's Active is surcharged by P2's Spidops, and P2's own Active (a Spidops
    // ex, printed retreat 2) by P1's — the aura is not self-cancelling.
    expect(activeCost(state)).toBe(3);
    expect(effectiveRetreatCost(state, p2Active)).toBe(3);
  });
});

describe("Trap Territory — the fold in effectiveRetreatCost", () => {
  it("reaches a NON-Basic Active, where the Stadium deltas cannot", () => {
    // The regression the refold exists to prevent: `!isBasicPokemon → return
    // printed` used to short-circuit before any aura was consulted.
    const clefable = board(7, "sv03-082");
    expect(activeCost(clefable)).toBe(2);
    expect(activeCost(withStadium(clefable, "sv01-167"))).toBe(2); // Basic-only: no effect

    const state = setActiveFromDeck(clefable, "p2", "sv01-019");
    expect(activeCost(state)).toBe(3);
  });

  it("lifts a printed-0 body off a free retreat", () => {
    const state = setActiveFromDeck(board(8, "fix-basic-0"), "p2", "sv01-019");
    expect(activeCost(state)).toBe(1);
  });

  it("composes with Beach Court — the ± case two Stadiums could never reach", () => {
    // §7.3 allows one Stadium in play, so `basicRetreatDiscount` and
    // `basicRetreatSurcharge` never meet (D109). A Stadium and an aura do.
    let state = withStadium(board(9), "sv01-167");
    expect(activeCost(state)).toBe(1); // 2 − 1
    state = setActiveFromDeck(state, "p2", "sv01-019");
    expect(activeCost(state)).toBe(2); // 2 − 1 + 1
  });

  it("floors the SUM, not each term", () => {
    // A printed-0 Basic under Beach Court is −1 before the aura's +1: term-wise
    // flooring would read 1, the honest fold reads 0.
    let state = withStadium(board(10, "fix-basic-0"), "sv01-167");
    expect(activeCost(state)).toBe(0);
    state = setActiveFromDeck(state, "p2", "sv01-019");
    expect(activeCost(state)).toBe(0);
  });

  it("loses to Lunar Zone's set-to-zero", () => {
    // "No Retreat Cost" applies after the ± modifiers, so the aura that zeroes
    // beats the aura that adds — Clefable ex frees itself once it holds {P}.
    let state = setActiveFromDeck(board(11, "sv03-082"), "p2", "sv01-019");
    expect(activeCost(state)).toBe(3);
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 1);
    expect(activeCost(state)).toBe(0);
    // The surcharge is still being imposed — it is simply overruled.
    expect(opposingRetreatSurcharge(state, p1Active(state))).toBe(1);
  });

  it("is gated through disabledAbilityUids (§9) — structurally negative here", () => {
    // Klefki's Mischievous Lock narrows to BASIC Pokémon and Spidops ex is a
    // Stage 1, so no lock in the sv01–03 pool can actually reach this source.
    // Only the negative is assertable; the gate is in the scan regardless.
    let state = board(12, "sv01-096");
    state = setActiveFromDeck(state, "p2", "sv01-019");
    const sourceUid = state.players.p2.active?.stack.at(-1);
    if (sourceUid === undefined) throw new Error("p2 has no Active");
    expect(disabledAbilityUids(state).has(sourceUid)).toBe(false);
    expect(opposingRetreatSurcharge(state, p1Active(state))).toBe(1);
  });
});

describe("Trap Territory — the retreat action pays the surcharge", () => {
  it("rejects the printed cost and accepts the surcharged one", () => {
    let state = setActiveFromDeck(board(13), "p2", "sv01-019");
    state = attachFromDeck(state, "p1", "fix-energy", 3);
    const paid = state.players.p1.active?.energy ?? [];
    expect(paid).toHaveLength(3);
    const promoted = benchTopUid(state, "p1", 0);
    deepFreeze(state);

    // Printed 2 is no longer enough …
    expectErr(
      state,
      { type: "retreat", seat: "p1", discardEnergy: paid.slice(0, 2), promoteBenchIndex: 0 },
      "RETREAT_COST_MISMATCH",
    );

    // … and paying the surcharged 3 works.
    const { state: done, events } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: paid,
      promoteBenchIndex: 0,
    });
    expect(types(events)).toContain("RETREATED");
    expect(done.players.p1.active?.stack.at(-1)).toBe(promoted);
  });
});

describe("Trap Territory — Wire Hang reads the cost it raises", () => {
  it("hits for +30 off its own Ability", () => {
    // P2 goes first and passes, so P1's turn 2 has no §4 attack restriction.
    let state = must(
      applyAction(
        driveSetup(14, { p1: TRAP_TERRITORY_DECK, p2: TRAP_TERRITORY_DECK }, { first: "p2" }),
        { type: "endTurn", seat: "p2" },
      ),
    );
    state = setActiveFromDeck(state, "p1", "sv01-019");
    state = attachFromDeck(state, "p1", "fix-grass-energy", 2);
    state = setActiveFromDeck(state, "p2", "fix-bigbody");

    // The defender's PRINTED cost is 1; Trap Territory makes it 2, and Wire Hang
    // reads the effective number — one card on both sides of the same seam.
    const defender = state.players.p2.active;
    if (defender === null) throw new Error("p2 has no Active");
    expect(FIXTURE_POOL["fix-bigbody"]?.retreat).toBe(1);
    expect(effectiveRetreatCost(state, defender)).toBe(2);

    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 90, scaled: 60, dealt: 150 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});
