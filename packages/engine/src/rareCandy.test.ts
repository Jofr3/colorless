import { describe, expect, it } from "vitest";
import { applyAction, rareCandyOptions } from "./index";
import type { GameState, RareCandyAction, Seat } from "./index";
import {
  RARE_CANDY_DECK,
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
  setBenchDamage,
  setConditions,
  setDamage,
  types,
} from "./testFixtures";

// Rare Candy (§7.1, M4 slice 7) — the Basic→Stage 2 evolve-skip Item. It is NOT
// an interpreter program (it evolves, and flow.ts owns every Knock Out): the
// `rareCandy` action carries the target Basic + the Stage 2 and reuses the
// shared placement (turn.ts placeEvolution) — so the SKIP, the on-evolve
// trigger and the evolve-below-HP mid-turn KO all ride the exact machinery
// `evolve` does. The fixture line is fix-basic-1 → fix-stage1 → fix-stage2; Rare
// Candy skips the middle (fix-stage1 is in the pool as the BRIDGE the chain
// check reads, but is never needed in hand — the whole point).

// Seed by scan: p1 opens RARE_CANDY_DECK with enough fix-basic-1 to place an
// Active plus a benched copy (the mid-turn-KO board's promote target).
const SEED = 4;

/** p1 (going first), both seats on RARE_CANDY_DECK with a fix-basic-1 Active,
    advanced to `turn` by passing. Turn 3 is p1's first evolve-legal turn. */
function rareCandyBoard(
  seed: number,
  { turn = 3, benchP1 = 0 }: { turn?: number; benchP1?: number } = {},
): GameState {
  let state = driveSetup(
    seed,
    { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK },
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

/** Pull a Rare Candy + a Stage 2 into `seat`'s hand; returns
    [state, rareCandyUid, stage2Uid]. */
function withRareCandy(
  state: GameState,
  seat: Seat,
  stage2Id = "fix-stage2",
): [GameState, string, string] {
  let next = handFromDeck(state, seat, "sv01-191", 1);
  next = handFromDeck(next, seat, stage2Id, 1);
  return [next, handUid(next, seat, "sv01-191"), handUid(next, seat, stage2Id)];
}

function rareCandyActive(seat: Seat, uid: string, evolutionUid: string): RareCandyAction {
  return { type: "rareCandy", seat, uid, target: { spot: "active" }, evolutionUid };
}

describe("Rare Candy: the happy path (§7.1)", () => {
  it("skips the Stage 1: the Basic evolves straight to the Stage 2", () => {
    const [state, rareUid, stage2Uid] = withRareCandy(rareCandyBoard(SEED), "p1");
    const basicUid = activeUid(state, "p1");
    const { state: next, events } = mustApply(state, rareCandyActive("p1", rareUid, stage2Uid));

    // The stack is Basic → Stage 2 with NO Stage 1 in between (the skip).
    expect(next.players.p1.active?.stack).toEqual([basicUid, stage2Uid]);
    expect(activeUid(next, "p1")).toBe(stage2Uid);
    // The Stage 2 left hand onto the stack; Rare Candy went to discard.
    expect(next.players.p1.hand).not.toContain(stage2Uid);
    expect(next.players.p1.hand).not.toContain(rareUid);
    expect(next.players.p1.discard).toContain(rareUid);
    // turnPlayed resets so it cannot evolve again this turn (§10 carry-over).
    expect(next.players.p1.active?.turnPlayed).toBe(next.turn);
    // Announced as a Trainer play THEN the evolution (the log reads both rows).
    expect(types(events)).toEqual(["TRAINER_PLAYED", "POKEMON_EVOLVED"]);
    expect(events[0]).toMatchObject({ type: "TRAINER_PLAYED", uid: rareUid, trainerType: "Item" });
    expect(events[1]).toMatchObject({
      type: "POKEMON_EVOLVED",
      seat: "p1",
      from: basicUid,
      to: stage2Uid,
      target: { spot: "active" },
    });
    // A completed play returns to the actor's turn (unbounded Item, no allowance
    // consumed — the energy attach is still available).
    expect(next.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(next.allowances.energyAttached).toBe(false);
  });

  it("skips onto a benched Basic by index", () => {
    let state = rareCandyBoard(SEED, { benchP1: 1 });
    const benchBasic = benchTopUid(state, "p1", 0);
    const [withCandy, rareUid, stage2Uid] = withRareCandy(state, "p1");
    state = withCandy;
    const { state: next } = mustApply(state, {
      type: "rareCandy",
      seat: "p1",
      uid: rareUid,
      target: { spot: "bench", index: 0 },
      evolutionUid: stage2Uid,
    });
    expect(benchTopUid(next, "p1", 0)).toBe(stage2Uid);
    expect(next.players.p1.bench[0]?.stack).toEqual([benchBasic, stage2Uid]);
  });

  it("works with only the Basic + Stage 2 in hand — the Stage 1 need not be held", () => {
    const [state, rareUid, stage2Uid] = withRareCandy(rareCandyBoard(SEED), "p1");
    // The bridge Stage 1 (fix-stage1) is in the pool but NOT in hand.
    expect(state.players.p1.hand.some((u) => state.cardIdByUid[u] === "fix-stage1")).toBe(false);
    const { state: next } = mustApply(state, rareCandyActive("p1", rareUid, stage2Uid));
    expect(activeUid(next, "p1")).toBe(stage2Uid);
  });
});

describe("Rare Candy: carry-over (§7.1/§10 — 'counts as evolving')", () => {
  it("keeps damage, Energy and Tools; clears Special Conditions with an event", () => {
    let state = rareCandyBoard(SEED);
    state = setDamage(state, "p1", 20);
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = setConditions(state, "p1", { rotation: "asleep", burned: true });
    const energyUids = [...(state.players.p1.active?.energy ?? [])];
    const [withCandy, rareUid, stage2Uid] = withRareCandy(state, "p1");
    const { state: next, events } = mustApply(withCandy, rareCandyActive("p1", rareUid, stage2Uid));

    expect(next.players.p1.active?.damage).toBe(20);
    expect(next.players.p1.active?.energy).toEqual(energyUids);
    expect(next.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
      confusionDamage: 30,
    });
    expect(types(events)).toEqual(["TRAINER_PLAYED", "POKEMON_EVOLVED", "STATUS_CLEARED"]);
    expect(events[2]).toMatchObject({
      type: "STATUS_CLEARED",
      seat: "p1",
      // The cleared event names the NEW top (events.ts).
      uid: stage2Uid,
      statuses: ["asleep", "burned"],
      reason: "evolved",
    });
  });

  it("carries an attached Tool through the skip", () => {
    let state = rareCandyBoard(SEED);
    state = handFromDeck(state, "p1", "sv02-173", 1); // Bravery Charm (a Tool)
    const toolUid = handUid(state, "p1", "sv02-173");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: toolUid,
      target: { spot: "active" },
    }).state;
    const [withCandy, rareUid, stage2Uid] = withRareCandy(state, "p1");
    const { state: next } = mustApply(withCandy, rareCandyActive("p1", rareUid, stage2Uid));
    // The Tool rides the stack (§7.4) — it stays on the evolved Pokémon.
    expect(next.players.p1.active?.tools).toContain(toolUid);
  });
});

describe("Rare Candy: the evolve-below-HP mid-turn KO (§8.1)", () => {
  it("Knocks Out a charmed Basic that drops below the Stage 2's HP on the skip", () => {
    // fix-basic-1 (60 HP) + Bravery Charm (+50 → 110 max) damaged to 100 survives
    // AS a Basic, but the frail Stage 2 (80 HP, the +50 falls off) is ≤ 100, so it
    // is Knocked Out the instant Rare Candy evolves it — a mid-turn KO.
    let state = rareCandyBoard(SEED, { benchP1: 1 });
    state = handFromDeck(state, "p1", "sv02-173", 1); // Bravery Charm
    const charmUid = handUid(state, "p1", "sv02-173");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: charmUid,
      target: { spot: "active" },
    }).state;
    state = setDamage(state, "p1", 100);
    const [withCandy, rareUid, frailUid] = withRareCandy(state, "p1", "fix-stage2-frail");

    const { state: next, events } = mustApply(withCandy, rareCandyActive("p1", rareUid, frailUid));

    // The evolved-then-KO'd Stage 2 leaves play; the opponent takes the prize.
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(events.find((e) => e.type === "KNOCKED_OUT")).toMatchObject({ seat: "p1", uid: frailUid });
    // Mid-turn KO: the opponent's prize pick is owed (§8.1) before p1 resumes.
    expect(next.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 1 });

    // Drive it out: p2 takes a prize, p1's lone bench auto-promotes, p1 resumes.
    const afterPrize = mustApply(next, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state;
    expect(afterPrize.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expect(afterPrize.players.p1.active).not.toBeNull();
  });

  it("Knocks Out a charmed BENCHED Basic that drops below the Stage 2's HP", () => {
    // The bench path: a benched charmed fix-basic-1 damaged to 100 survives, but
    // Rare Candy to the frail Stage 2 (80 HP) Knocks it Out — a benched KO owes
    // only the opponent's prize (no promotion; the bench compacts), then the
    // actor's Active-intact turn resumes.
    let state = rareCandyBoard(SEED, { benchP1: 1 });
    state = handFromDeck(state, "p1", "sv02-173", 1); // Bravery Charm
    const charmUid = handUid(state, "p1", "sv02-173");
    state = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid: charmUid,
      target: { spot: "bench", index: 0 },
    }).state;
    state = setBenchDamage(state, "p1", 0, 100);
    const [withCandy, rareUid, frailUid] = withRareCandy(state, "p1", "fix-stage2-frail");
    const { state: next, events } = mustApply(withCandy, {
      type: "rareCandy",
      seat: "p1",
      uid: rareUid,
      target: { spot: "bench", index: 0 },
      evolutionUid: frailUid,
    });
    expect(events.find((e) => e.type === "KNOCKED_OUT")).toMatchObject({ seat: "p1", uid: frailUid });
    expect(next.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    const afterPrize = mustApply(next, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state;
    expect(afterPrize.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    // The Active is untouched; the KO'd bench slot compacted away.
    expect(afterPrize.players.p1.active).not.toBeNull();
    expect(afterPrize.players.p1.bench).toHaveLength(0);
  });
});

describe("Rare Candy: timing rules (§4/§7.1)", () => {
  it("bans p1 on turn 1 (their first turn)", () => {
    const [state, rareUid, stage2Uid] = withRareCandy(rareCandyBoard(SEED, { turn: 1 }), "p1");
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    expectErr(state, rareCandyActive("p1", rareUid, stage2Uid), "FIRST_TURN_EVOLVE");
  });

  it("bans p2 on turn 2 (their first turn), but allows it on turn 4", () => {
    const [t2, rare2, s2] = withRareCandy(rareCandyBoard(SEED, { turn: 2 }), "p2");
    expect(t2.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    expectErr(t2, rareCandyActive("p2", rare2, s2), "FIRST_TURN_EVOLVE");

    const [t4, rare4, s4] = withRareCandy(rareCandyBoard(SEED, { turn: 4 }), "p2");
    const next = must(applyAction(t4, rareCandyActive("p2", rare4, s4)));
    expect(activeUid(next, "p2")).toBe(s4);
  });

  it("rejects a Basic that came into play this turn (EVOLVE_TOO_SOON)", () => {
    let state = rareCandyBoard(SEED);
    // Play a fresh Basic to the bench THIS turn (turnPlayed = current turn).
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    const freshBasic = handUid(state, "p1", "fix-basic-1");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: freshBasic }).state;
    const [withCandy, rareUid, stage2Uid] = withRareCandy(state, "p1");
    expectErr(
      withCandy,
      { type: "rareCandy", seat: "p1", uid: rareUid, target: { spot: "bench", index: 0 }, evolutionUid: stage2Uid },
      "EVOLVE_TOO_SOON",
    );
  });
});

describe("Rare Candy: chain + target rejections (§7.1)", () => {
  it("rejects targeting a non-Basic (a Stage 1 already in play)", () => {
    // Evolve the Active to fix-stage1 first (a normal evolve on turn 3), then try
    // to Rare Candy the Stage 1 — Rare Candy only evolves a Basic.
    let state = rareCandyBoard(SEED);
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    const stage1Uid = handUid(state, "p1", "fix-stage1");
    state = mustApply(state, { type: "evolve", seat: "p1", uid: stage1Uid, target: { spot: "active" } }).state;
    // Advance to p1's next turn so the Stage 1 is no longer "played this turn".
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const [withCandy, rareUid, stage2Uid] = withRareCandy(state, "p1");
    expectErr(withCandy, rareCandyActive("p1", rareUid, stage2Uid), "NOT_A_BASIC_POKEMON");
  });

  it("rejects a Stage 2 whose line does not trace to the target Basic", () => {
    // fix-basic-2 is a Basic OUTSIDE the fix-stage2 line — no Stage 1 bridges it.
    let state = rareCandyBoard(SEED);
    state = handFromDeck(state, "p1", "fix-basic-2", 1);
    const basic2 = handUid(state, "p1", "fix-basic-2");
    state = mustApply(state, { type: "playBasicToBench", seat: "p1", uid: basic2 }).state;
    // Advance a full round so the just-benched fix-basic-2 clears EVOLVE_TOO_SOON.
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const [withCandy, rareUid, stage2Uid] = withRareCandy(state, "p1");
    const benchIndex = state.players.p1.bench.findIndex(
      (p) => withCandy.cardIdByUid[p.stack[p.stack.length - 1] ?? ""] === "fix-basic-2",
    );
    expectErr(
      withCandy,
      { type: "rareCandy", seat: "p1", uid: rareUid, target: { spot: "bench", index: benchIndex }, evolutionUid: stage2Uid },
      "RARE_CANDY_NO_STAGE2",
    );
  });

  it("rejects a Stage 1 or a Basic as the evolution card (not a Stage 2)", () => {
    let state = rareCandyBoard(SEED);
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    const rareState = handFromDeck(state, "p1", "sv01-191", 1);
    const rareUid = handUid(rareState, "p1", "sv01-191");
    const stage1Uid = handUid(rareState, "p1", "fix-stage1");
    const anotherBasic = rareState.players.p1.hand.filter(
      (u) => rareState.cardIdByUid[u] === "fix-basic-1",
    )[1];
    expectErr(rareState, rareCandyActive("p1", rareUid, stage1Uid), "RARE_CANDY_NO_STAGE2");
    if (anotherBasic !== undefined) {
      expectErr(rareState, rareCandyActive("p1", rareUid, anotherBasic), "RARE_CANDY_NO_STAGE2");
    }
  });

  it("rejects an Energy card as the evolution card (not a Pokémon at all)", () => {
    let state = rareCandyBoard(SEED);
    state = handFromDeck(state, "p1", "fix-energy", 1);
    const rareState = handFromDeck(state, "p1", "sv01-191", 1);
    const rareUid = handUid(rareState, "p1", "sv01-191");
    const energyUid = handUid(rareState, "p1", "fix-energy");
    expectErr(rareState, rareCandyActive("p1", rareUid, energyUid), "RARE_CANDY_NO_STAGE2");
  });

  it("rejects an evolution uid not in hand, or the Rare Candy card itself", () => {
    const [state, rareUid, stage2Uid] = withRareCandy(rareCandyBoard(SEED), "p1");
    expectErr(state, rareCandyActive("p1", rareUid, "p1#999"), "CARD_NOT_IN_HAND");
    // Passing the Rare Candy uid as the Stage 2 is a degenerate wire input.
    expectErr(state, rareCandyActive("p1", rareUid, rareUid), "CARD_NOT_IN_HAND");
    expect(stage2Uid).toBeDefined();
  });
});

describe("Rare Candy: it is not a program Trainer (routing)", () => {
  it("rejects playTrainer on Rare Candy (it needs the rareCandy action)", () => {
    const state = handFromDeck(rareCandyBoard(SEED), "p1", "sv01-191", 1);
    const rareUid = handUid(state, "p1", "sv01-191");
    expectErr(state, { type: "playTrainer", seat: "p1", uid: rareUid }, "TRAINER_TYPE_UNSUPPORTED");
  });
});

describe("rareCandyOptions (the HUD authority)", () => {
  it("offers each legal Basic with its matching Stage 2s in hand", () => {
    const [state, , stage2Uid] = withRareCandy(rareCandyBoard(SEED), "p1");
    const options = rareCandyOptions(state, "p1");
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ target: { spot: "active" } });
    expect(options[0]?.stage2Uids).toContain(stage2Uid);
  });

  it("is empty on the first turn (the §4 ban)", () => {
    const [state] = withRareCandy(rareCandyBoard(SEED, { turn: 1 }), "p1");
    expect(rareCandyOptions(state, "p1")).toEqual([]);
  });

  it("is empty when no Basic is in play to evolve", () => {
    // Evolve the only in-play Pokémon off Basic (Active → fix-stage1, empty
    // bench): a Stage 2 in hand now has no Basic target, so nothing is offered.
    let state = rareCandyBoard(SEED);
    state = handFromDeck(state, "p1", "fix-stage1", 1);
    const stage1Uid = handUid(state, "p1", "fix-stage1");
    state = mustApply(state, { type: "evolve", seat: "p1", uid: stage1Uid, target: { spot: "active" } }).state;
    state = handFromDeck(state, "p1", "fix-stage2", 1);
    expect(rareCandyOptions(state, "p1")).toEqual([]);
  });
});

describe("Rare Candy: wire-safety (types are not validation, D14)", () => {
  it("rejects a null / garbled target without throwing", () => {
    const [state, rareUid, stage2Uid] = withRareCandy(rareCandyBoard(SEED), "p1");
    expectErr(
      state,
      { type: "rareCandy", seat: "p1", uid: rareUid, target: null, evolutionUid: stage2Uid } as unknown as RareCandyAction,
      "BAD_TARGET",
    );
    expectErr(
      state,
      {
        type: "rareCandy",
        seat: "p1",
        uid: rareUid,
        target: { spot: "sideboard" },
        evolutionUid: stage2Uid,
      } as unknown as RareCandyAction,
      "BAD_TARGET",
    );
  });

  it("rejects a string / out-of-range bench index", () => {
    const [state, rareUid, stage2Uid] = withRareCandy(rareCandyBoard(SEED), "p1");
    const badIndex = (index: unknown) =>
      ({
        type: "rareCandy",
        seat: "p1",
        uid: rareUid,
        target: { spot: "bench", index },
        evolutionUid: stage2Uid,
      }) as unknown as RareCandyAction;
    expectErr(state, badIndex("0"), "BAD_BENCH_INDEX");
    expectErr(state, badIndex(9), "BAD_BENCH_INDEX");
    expectErr(state, badIndex(0), "BAD_BENCH_INDEX"); // empty bench here
  });
});

describe("Rare Candy: phase/seat gates and purity", () => {
  it("rejects outside the action phase (BAD_PHASE)", () => {
    const setupState = mustCreate(SEED, { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK }).state;
    expectErr(setupState, rareCandyActive("p1", "p1#0", "p1#1"), "BAD_PHASE");
  });

  it("rejects the non-turn seat (WRONG_SEAT)", () => {
    const [state, rareUid, stage2Uid] = withRareCandy(rareCandyBoard(SEED), "p1");
    expectErr(state, rareCandyActive("p2", rareUid, stage2Uid), "WRONG_SEAT");
  });

  it("never mutates the input state", () => {
    const [state, rareUid, stage2Uid] = withRareCandy(rareCandyBoard(SEED), "p1");
    const frozen = deepFreeze(state);
    const snapshot = JSON.stringify(frozen);
    const result = applyAction(frozen, rareCandyActive("p1", rareUid, stage2Uid));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});
