import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { EvolveAction, GameState, Seat } from "./index";
import {
  EVOLVE_DECK,
  activeUid,
  attachFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  must,
  mustApply,
  mustCreate,
  setConditions,
  setDamage,
  types,
} from "./testFixtures";

// Evolution (§10) — the first M4 slice. fix-basic-1 → fix-stage1 → fix-stage2
// is the test line (testFixtures). Boards pin p1's Active (and p2's) to a
// fix-basic-1 so a fix-stage1 in hand always has a legal target; setup
// Pokémon carry turnPlayed 0, so they are evolvable from turn 3 (p1) / turn 4
// (p2) on — past the §4 first-turn ban.

// Seed chosen by scan: p1 opens with enough fix-basic-1 to place an Active
// and two benched copies (the benched-evolution board's requirement).
const SEED = 4;

/** p1 (going first), both seats on EVOLVE_DECK with a fix-basic-1 Active,
    advanced to `turn` by passing (no attacks, so the tail never parks). The
    default turn 3 is p1's first evolve-legal turn. */
function evolveBoard(
  seed: number,
  { turn = 3, benchP1 = 0 }: { turn?: number; benchP1?: number } = {},
): GameState {
  let state = driveSetup(
    seed,
    { p1: EVOLVE_DECK, p2: EVOLVE_DECK },
    {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
      bench: { p1: Array.from({ length: benchP1 }, () => "fix-basic-1") },
    },
  );
  while (state.turn < turn) {
    if (state.phase.kind !== "turn:action") {
      throw new Error(`unexpected phase ${state.phase.kind} while passing to turn ${turn}`);
    }
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return state;
}

/** Pull a fix-stage1 into `seat`'s hand and return [state, its uid]. */
function withStage1InHand(state: GameState, seat: Seat): [GameState, string] {
  const next = handFromDeck(state, seat, "fix-stage1", 1);
  return [next, handUid(next, seat, "fix-stage1")];
}

function evolveActive(seat: Seat, uid: string): EvolveAction {
  return { type: "evolve", seat, uid, target: { spot: "active" } };
}

describe("evolution: the happy path (§10)", () => {
  it("evolves the Active: new top card, stack grows, card leaves hand", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED), "p1");
    const basicUid = activeUid(state, "p1");
    const { state: next, events } = mustApply(state, evolveActive("p1", stage1Uid));

    expect(activeUid(next, "p1")).toBe(stage1Uid);
    expect(next.players.p1.active?.stack).toEqual([basicUid, stage1Uid]);
    expect(next.players.p1.hand).not.toContain(stage1Uid);
    // turnPlayed resets so it cannot evolve again this turn (§10).
    expect(next.players.p1.active?.turnPlayed).toBe(next.turn);
    expect(types(events)).toEqual(["POKEMON_EVOLVED"]);
    expect(events[0]).toMatchObject({
      type: "POKEMON_EVOLVED",
      seat: "p1",
      from: basicUid,
      to: stage1Uid,
      target: { spot: "active" },
    });
  });

  it("evolves a benched Pokémon by index", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED, { benchP1: 2 }), "p1");
    const bench0Before = benchTopUid(state, "p1", 0);
    const { state: next, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: stage1Uid,
      target: { spot: "bench", index: 1 },
    });

    expect(benchTopUid(next, "p1", 1)).toBe(stage1Uid);
    // The other benched Pokémon is untouched, and the Active too.
    expect(benchTopUid(next, "p1", 0)).toBe(bench0Before);
    expect(next.players.p1.active?.stack.length).toBe(1);
    expect(events[0]).toMatchObject({
      type: "POKEMON_EVOLVED",
      target: { spot: "bench", index: 1 },
    });
  });

  it("chains Basic → Stage 1 → Stage 2 across the owner's turns", () => {
    const [t3, stage1Uid] = withStage1InHand(evolveBoard(SEED), "p1");
    const basicUid = activeUid(t3, "p1");
    let state = mustApply(t3, evolveActive("p1", stage1Uid)).state;
    // Next own turn (p1 plays odd turns): 3 → 5.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(5);

    state = handFromDeck(state, "p1", "fix-stage2", 1);
    const stage2Uid = handUid(state, "p1", "fix-stage2");
    const { state: next } = mustApply(state, evolveActive("p1", stage2Uid));

    expect(next.players.p1.active?.stack).toEqual([basicUid, stage1Uid, stage2Uid]);
    expect(activeUid(next, "p1")).toBe(stage2Uid);
  });
});

describe("evolution: carry-over (§10)", () => {
  it("keeps damage, Energy and Tools; clears Special Conditions with an event", () => {
    let state = evolveBoard(SEED);
    state = setDamage(state, "p1", 20);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = setConditions(state, "p1", { rotation: "asleep", burned: true });
    const energyUids = [...(state.players.p1.active?.energy ?? [])];
    const [withStage1, stage1Uid] = withStage1InHand(state, "p1");
    const { state: next, events } = mustApply(withStage1, evolveActive("p1", stage1Uid));

    expect(next.players.p1.active?.damage).toBe(20);
    expect(next.players.p1.active?.energy).toEqual(energyUids);
    expect(next.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
    expect(next.players.p1.active?.markers).toEqual([]);
    expect(types(events)).toEqual(["POKEMON_EVOLVED", "STATUS_CLEARED"]);
    expect(events[1]).toMatchObject({
      type: "STATUS_CLEARED",
      seat: "p1",
      // The cleared event names the NEW top (events.ts).
      uid: stage1Uid,
      statuses: ["asleep", "burned"],
      reason: "evolved",
    });
  });

  it("emits no STATUS_CLEARED when the evolving Pokémon had no conditions", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED), "p1");
    const { events } = mustApply(state, evolveActive("p1", stage1Uid));
    expect(types(events)).toEqual(["POKEMON_EVOLVED"]);
  });
});

describe("evolution: timing rules (§4/§10)", () => {
  it("rejects evolving a Pokémon the turn it came into play", () => {
    let state = evolveBoard(SEED);
    // Play a fresh Basic to the bench THIS turn (turnPlayed = current turn).
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    const freshBasic = handUid(state, "p1", "fix-basic-1");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: freshBasic }).state;
    const [withStage1, stage1Uid] = withStage1InHand(state, "p1");
    expectErr(
      withStage1,
      { type: "evolve", seat: "p1", uid: stage1Uid, target: { spot: "bench", index: 0 } },
      "EVOLVE_TOO_SOON",
    );
  });

  it("rejects evolving the same Pokémon twice in one turn", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED), "p1");
    const evolved = mustApply(state, evolveActive("p1", stage1Uid)).state;
    const withStage2 = handFromDeck(evolved, "p1", "fix-stage2", 1);
    const stage2Uid = handUid(withStage2, "p1", "fix-stage2");
    expectErr(withStage2, evolveActive("p1", stage2Uid), "EVOLVE_TOO_SOON");
  });

  it("bans p1 from evolving on turn 1 (their first turn)", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED, { turn: 1 }), "p1");
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expectErr(state, evolveActive("p1", stage1Uid), "FIRST_TURN_EVOLVE");
  });

  it("bans p2 from evolving on turn 2 (their first turn), but allows it on turn 4", () => {
    const [t2, s1] = withStage1InHand(evolveBoard(SEED, { turn: 2 }), "p2");
    expect(t2.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expectErr(t2, evolveActive("p2", s1), "FIRST_TURN_EVOLVE");

    const [t4, s1b] = withStage1InHand(evolveBoard(SEED, { turn: 4 }), "p2");
    expect(t4.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    const next = must(applyAction(t4, evolveActive("p2", s1b)));
    expect(activeUid(next, "p2")).toBe(s1b);
  });
});

describe("evolution: legality rejections", () => {
  it("rejects when evolveFrom does not name the target's top card (mismatch)", () => {
    // fix-stage2 evolves from fix-stage1, not from the fix-basic-1 Active.
    let state = evolveBoard(SEED);
    state = handFromDeck(state, "p1", "fix-stage2", 1);
    const stage2Uid = handUid(state, "p1", "fix-stage2");
    expectErr(state, evolveActive("p1", stage2Uid), "EVOLVE_MISMATCH");
  });

  it("rejects a Basic or an Energy as the evolution card (not an evolution)", () => {
    const state = handFromDeck(evolveBoard(SEED), "p1", "fix-energy", 1);
    const basicUid = handUid(state, "p1", "fix-basic-1");
    const energyUid = handUid(state, "p1", "fix-energy");
    expectErr(state, evolveActive("p1", basicUid), "NOT_AN_EVOLUTION");
    expectErr(state, evolveActive("p1", energyUid), "NOT_AN_EVOLUTION");
  });
});

describe("evolution: wire-safety (types are not validation, D14)", () => {
  it("rejects a null / garbled target without throwing", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED), "p1");
    expectErr(
      state,
      { type: "evolve", seat: "p1", uid: stage1Uid, target: null } as unknown as EvolveAction,
      "BAD_TARGET",
    );
    expectErr(
      state,
      {
        type: "evolve",
        seat: "p1",
        uid: stage1Uid,
        target: { spot: "sideboard" },
      } as unknown as EvolveAction,
      "BAD_TARGET",
    );
  });

  it("rejects a string / out-of-range / empty bench index", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED), "p1");
    const badIndex = (index: unknown) =>
      ({
        type: "evolve",
        seat: "p1",
        uid: stage1Uid,
        target: { spot: "bench", index },
      }) as unknown as EvolveAction;
    // A wire-decoded "0" indexes the array fine but must not corrupt the write.
    expectErr(state, badIndex("0"), "BAD_BENCH_INDEX");
    expectErr(state, badIndex(9), "BAD_BENCH_INDEX");
    // The board has an empty bench here — index 0 has no Pokémon.
    expectErr(state, badIndex(0), "BAD_BENCH_INDEX");
  });

  it("rejects a uid that is not in hand", () => {
    const state = evolveBoard(SEED);
    expectErr(state, evolveActive("p1", "p1#999"), "CARD_NOT_IN_HAND");
  });
});

describe("evolution: phase and seat gates", () => {
  it("rejects outside the action phase (BAD_PHASE)", () => {
    const setupState = mustCreate(SEED, { p1: EVOLVE_DECK, p2: EVOLVE_DECK }).state;
    expectErr(setupState, evolveActive("p1", "p1#0"), "BAD_PHASE");
  });

  it("rejects the non-turn seat (WRONG_SEAT)", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED), "p1");
    // p1's turn — p2 cannot evolve. (The seat gate fires before uid checks.)
    expectErr(state, evolveActive("p2", stage1Uid), "WRONG_SEAT");
  });
});

describe("evolution: allowances and purity", () => {
  it("does not consume the energy-attach allowance", () => {
    let state = evolveBoard(SEED);
    state = handFromDeck(state, "p1", "fix-energy", 1);
    const [withStage1, stage1Uid] = withStage1InHand(state, "p1");
    const energyUid = handUid(withStage1, "p1", "fix-energy");
    const afterEvolve = mustApply(withStage1, evolveActive("p1", stage1Uid)).state;
    expect(afterEvolve.allowances.energyAttached).toBe(false);
    // The one attach per turn is still available afterward.
    const afterAttach = mustApply(afterEvolve, {
      type: "attachEnergy",
      seat: "p1",
      uid: energyUid,
      target: { spot: "active" },
    }).state;
    expect(afterAttach.allowances.energyAttached).toBe(true);
  });

  it("never mutates the input state", () => {
    const [state, stage1Uid] = withStage1InHand(evolveBoard(SEED), "p1");
    const frozen = deepFreeze(state);
    const snapshot = JSON.stringify(frozen);
    const result = applyAction(frozen, evolveActive("p1", stage1Uid));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});
