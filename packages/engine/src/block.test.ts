import { describe, expect, it } from "vitest";
import {
  applyAction,
  disabledAbilityUids,
  effectiveRetreatCost,
  opposingRetreatBlocked,
  programFor,
  redactGame,
} from "./index";
import type { GameState, Seat } from "./index";
import {
  BLOCK_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  activeOf,
} from "./testFixtures";

const ABILITY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon can't retreat.";

function board(seed: number, p1Body = "fix-retreat2"): GameState {
  let state = driveSetup(seed, { p1: BLOCK_DECK, p2: BLOCK_DECK }, { first: "p1" });
  state = setActiveFromDeck(state, "p1", p1Body);
  return setActiveFromDeck(state, "p2", "fix-bigbody");
}

/** The retreat P1's Active could otherwise pay: every attached {C}, promoting the
    starter the surgery displaced. */
function p1Retreat(state: GameState) {
  return {
    type: "retreat" as const,
    seat: "p1" as const,
    discardEnergy: activeOf(state, "p1").energy,
    promoteBenchIndex: 0,
  };
}

/** P1's redacted retreat option — it rides the turn:action phase, and only the
    turn owner gets one. */
function retreatOnWire(state: GameState) {
  const phase = redactGame(state, "p1").phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.retreat;
}

function withRetreatBlocked(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = activeOf(state, seat);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, retreatBlocked: true } },
    },
  };
}

describe("Block — the registry data row (preventOpponentActiveRetreat)", () => {
  it("authors swsh10.5-055 as a bare flag", () => {
    expect(programFor("swsh10.5-055")?.passive).toEqual({ preventOpponentActiveRetreat: true });
  });

  it("keeps the fixture's printed row verbatim", () => {
    const card = FIXTURE_POOL["swsh10.5-055"];
    expect(card?.abilities?.[0]).toEqual({ type: "Ability", name: "Block", effect: ABILITY_TEXT });
    expect(card?.attacks?.[0]).toEqual({
      cost: ["Colorless", "Colorless", "Colorless", "Colorless"],
      name: "Collapse",
      damage: 150,
      effect: "This Pokémon is now Asleep.",
    });
    expect(card?.hp).toBe(150);
    expect(card?.retreat).toBe(4);
    expect(card?.stage).toBe("Basic");
    expect(card?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    // ASCII apostrophes, a real é — the bytes the local D1 holds (zero U+2019 in
    // the whole pool).
    expect(ABILITY_TEXT).toContain("opponent's");
    expect(ABILITY_TEXT).toContain("Pokémon");
    expect(ABILITY_TEXT).not.toContain("’");
  });
});

describe("Block — who imposes it, and on whom", () => {
  it("holds the opponent's Active in place", () => {
    const bare = board(1);
    expect(opposingRetreatBlocked(bare, activeOf(bare, "p1"))).toBe(false);

    const state = setActiveFromDeck(bare, "p2", "swsh10.5-055");
    expect(opposingRetreatBlocked(state, activeOf(state, "p1"))).toBe(true);
  });

  it("blocks NOTHING from the Bench — the SOURCE clause, Trap Territory's inverse", () => {
    // "As long as this Pokémon is in the Active Spot" scopes the source, where
    // Spidops ex's sentence scopes only the target and surcharges from the Bench.
    const state = benchFromDeck(board(2), "p2", "swsh10.5-055");
    // Locate it by card id, not slot — the guard is vacuous otherwise, the bench
    // already holding the starter the Active surgery displaced.
    const onBench = state.players.p2.bench.filter(
      (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "swsh10.5-055",
    );
    expect(onBench).toHaveLength(1);
    expect(opposingRetreatBlocked(state, activeOf(state, "p1"))).toBe(false);
  });

  it("reaches only the ACTIVE — a benched target reads false", () => {
    // The target clause, and it costs nothing to honor: a benched Pokémon has no
    // retreat to refuse in the first place.
    let state = setActiveFromDeck(board(3), "p2", "swsh10.5-055");
    state = benchFromDeck(state, "p1", "fix-retreat2");
    const benched = state.players.p1.bench.at(-1);
    if (benched === undefined) throw new Error("no benched body");
    expect(opposingRetreatBlocked(state, activeOf(state, "p1"))).toBe(true);
    expect(opposingRetreatBlocked(state, benched)).toBe(false);
  });

  it("is OPPONENT-side only — your own Snorlax never blocks you", () => {
    // One board, both directions: P1's Active IS the Snorlax, so it holds P2's
    // Active in place and its own retreat stays free of it.
    const state = board(4, "swsh10.5-055");
    expect(opposingRetreatBlocked(state, activeOf(state, "p1"))).toBe(false);
    expect(opposingRetreatBlocked(state, activeOf(state, "p2"))).toBe(true);
  });

  it("is gated through disabledAbilityUids (§9) — the family's FIRST positive", () => {
    const state = setActiveFromDeck(board(5, "sv01-096"), "p2", "swsh10.5-055");
    const sourceUid = state.players.p2.active?.stack.at(-1);
    if (sourceUid === undefined) throw new Error("p2 has no Active");
    expect(disabledAbilityUids(state).has(sourceUid)).toBe(true);
    expect(opposingRetreatBlocked(state, activeOf(state, "p1"))).toBe(false);

    // The control: the same Snorlax opposite a body with no lock still blocks.
    const unlocked = setActiveFromDeck(board(5), "p2", "swsh10.5-055");
    expect(opposingRetreatBlocked(unlocked, activeOf(unlocked, "p1"))).toBe(true);
  });
});

describe("Block — a block is not a cost", () => {
  it("leaves effectiveRetreatCost at the printed number", () => {
    const state = attachFromDeck(
      setActiveFromDeck(board(6), "p2", "swsh10.5-055"),
      "p1",
      "fix-energy",
      2,
    );
    expect(opposingRetreatBlocked(state, activeOf(state, "p1"))).toBe(true);
    expect(effectiveRetreatCost(state, activeOf(state, "p1"))).toBe(2);
  });

  it("shows on the wire as `can: false` with the cost unchanged", () => {
    const bare = attachFromDeck(board(7), "p1", "fix-energy", 2);
    expect(retreatOnWire(bare)).toEqual({ cost: 2, can: true });

    const blocked = setActiveFromDeck(bare, "p2", "swsh10.5-055");
    expect(retreatOnWire(blocked)).toEqual({ cost: 2, can: false });
  });
});

describe("Block — the §11 retreat gate", () => {
  it("refuses the very retreat the same board otherwise allows", () => {
    const control = attachFromDeck(board(8), "p1", "fix-energy", 2);
    const promoted = control.players.p1.bench[0]?.stack.at(-1);
    const { state: done, events } = mustApply(control, p1Retreat(control));
    expect(types(events)).toContain("RETREATED");
    expect(done.players.p1.active?.stack.at(-1)).toBe(promoted);

    // The same board, the same action, with a Snorlax across from it.
    const blocked = setActiveFromDeck(control, "p2", "swsh10.5-055");
    deepFreeze(blocked);
    expectErr(blocked, p1Retreat(blocked), "RETREAT_PREVENTED");
  });

  it("blocks retreating but NOT attacking, and applies no §12 condition", () => {
    // P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    // blocked body is fix-attacker (Bite, {C} 30) — Snorlax's 150 HP survives it.
    const opened = driveSetup(9, { p1: BLOCK_DECK, p2: BLOCK_DECK }, { first: "p2" });
    let state = must(applyAction(opened, { type: "endTurn", seat: "p2" }));
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "swsh10.5-055");
    expect(opposingRetreatBlocked(state, activeOf(state, "p1"))).toBe(true);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(activeOf(state, "p1").conditions.rotation).toBe("none");
    expect(activeOf(state, "p1").retreatBlocked).toBe(false);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("composes with D112's flag — either provenance alone still refuses", () => {
    const armed = attachFromDeck(board(10), "p1", "fix-energy", 2);
    const flagged = withRetreatBlocked(armed, "p1");

    // Both at once, then each alone: the gate reads them as two guards, not one.
    expectErr(
      setActiveFromDeck(flagged, "p2", "swsh10.5-055"),
      p1Retreat(flagged),
      "RETREAT_PREVENTED",
    );
    expectErr(flagged, p1Retreat(flagged), "RETREAT_PREVENTED");
    expectErr(
      setActiveFromDeck(armed, "p2", "swsh10.5-055"),
      p1Retreat(armed),
      "RETREAT_PREVENTED",
    );
    // …and with neither, the same retreat goes through.
    expect(types(mustApply(armed, p1Retreat(armed)).events)).toContain("RETREATED");
  });
});
