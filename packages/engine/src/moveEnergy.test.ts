import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  MOVE_ENERGY_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  types,
} from "./testFixtures";

// M5 op-slice: moveEnergy (§6 manual Energy movement) — move Energy between your
// own Pokémon. Two real cards land on it, verified end to end:
//   • Energy Switch (sv01-173, Item) — move a Basic Energy, own → own;
//   • Poppy (sv03-193, Supporter) — move up to 2 any Energy, own → own.
// The interpreter's first op with two COUPLED decisions (which Energy + where):
// it parks on ONE compound moveEnergy prompt and applies ATOMICALLY on resolve.
// Own→own only; the fixed-endpoint / opponent-side / on-KO riders layer later.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn (so a Supporter, Poppy, is legal). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: MOVE_ENERGY_DECK, p2: MOVE_ENERGY_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}
function benchEnergy(state: GameState, seat: "p1" | "p2", index: number): string[] {
  return [...(state.players[seat].bench[index]?.energy ?? [])];
}

const P1_ACTIVE: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const P1_BENCH0: PokemonRef = { seat: "p1", spot: { spot: "bench", index: 0 } };

describe("M5 op-slice — moveEnergy", () => {
  it("registry resolves a program for each authored id (incl. Poppy reprints)", () => {
    for (const id of ["sv01-173", "sv03-193", "sv03-220", "sv03-227"]) {
      expect(programFor(id)).toBeDefined();
    }
  });

  it("Energy Switch parks on the compound prompt, then moves a Basic Energy Active → Bench", () => {
    let state = board(1);
    state = benchFromDeck(state, "p1", "fix-basic-2"); // a distinct destination
    state = attachFromDeck(state, "p1", "fix-energy", 1); // one Basic Energy on the Active
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const energyUid = activeEnergy(state, "p1")[0] as string;

    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy prompt");
    expect(parked.phase.prompt.max).toBe(1);
    expect(parked.phase.prompt.note).toBe(
      "Move a Basic Energy from 1 of your Pokémon to another of your Pokémon.",
    );
    // The one Basic Energy on the Active is the sole candidate, tagged with its source.
    expect(parked.phase.prompt.movable.map((m) => m.uid)).toEqual([energyUid]);
    expect(parked.phase.prompt.movable[0]?.from.spot).toEqual({ spot: "active" });
    // Both own Pokémon are offered destinations (the source-exclusion is per-pick).
    expect(parked.phase.prompt.destinations).toHaveLength(2);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest: P1_BENCH0 }] },
    });
    expect(done.phase.kind).toBe("turn:action");
    // The Energy left the Active and landed on the benched Pokémon (one card, moved).
    expect(activeEnergy(done, "p1")).not.toContain(energyUid);
    expect(benchEnergy(done, "p1", 0)).toContain(energyUid);
    const moved = find(events, "ENERGY_MOVED");
    expect(moved).toMatchObject({ seat: "p1", uids: [energyUid] });
    expect(moved?.from).toEqual({ spot: "active" });
    expect(moved?.to).toEqual({ spot: "bench", index: 0 });
  });

  it("moves FROM a benched Pokémon to the Active too (either endpoint)", () => {
    let state = board(2);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1); // Energy on the BENCH
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const energyUid = benchEnergy(state, "p1", 0)[0] as string;

    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy prompt");
    expect(parked.phase.prompt.movable[0]?.from.spot).toEqual({ spot: "bench", index: 0 });

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest: P1_ACTIVE }] },
    });
    expect(benchEnergy(done, "p1", 0)).not.toContain(energyUid);
    expect(activeEnergy(done, "p1")).toContain(energyUid);
    expect(find(events, "ENERGY_MOVED")?.from).toEqual({ spot: "bench", index: 0 });
    expect(find(events, "ENERGY_MOVED")?.to).toEqual({ spot: "active" });
  });

  it("moves Bench → Bench (two distinct bench indices in play at once)", () => {
    let state = board(14);
    state = benchFromDeck(state, "p1", "fix-basic-2"); // destination at index 0
    state = benchFromDeck(state, "p1", "fix-basic-1"); // source at index 1
    state = attachBenchFromDeck(state, "p1", 1, "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const energyUid = benchEnergy(state, "p1", 1)[0] as string;

    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy prompt");
    expect(parked.phase.prompt.movable[0]?.from.spot).toEqual({ spot: "bench", index: 1 });

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest: P1_BENCH0 }] },
    });
    expect(benchEnergy(done, "p1", 1)).not.toContain(energyUid); // left the source bench slot
    expect(benchEnergy(done, "p1", 0)).toContain(energyUid); // landed on the destination bench slot
    const moved = find(events, "ENERGY_MOVED");
    expect(moved?.from).toEqual({ spot: "bench", index: 1 });
    expect(moved?.to).toEqual({ spot: "bench", index: 0 });
  });

  it("Energy Switch's basicEnergy filter EXCLUDES a Special Energy on the source", () => {
    let state = board(3);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1); // Basic (movable)
    state = attachFromDeck(state, "p1", "fix-special", 1); // Special (NOT movable)
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const [basicUid, specialUid] = activeEnergy(state, "p1");

    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy prompt");
    const movable = new Set(parked.phase.prompt.movable.map((m) => m.uid));
    expect(movable.has(basicUid as string)).toBe(true);
    expect(movable.has(specialUid as string)).toBe(false);

    // The wire guard: the Special is not a candidate, so a client trying to move it fails.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: specialUid as string, dest: P1_BENCH0 }] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects a destination that is not offered (an opponent Pokémon / an out-of-range bench)", () => {
    let state = board(4);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const energyUid = activeEnergy(state, "p1")[0] as string;
    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    for (const dest of [
      { seat: "p2", spot: { spot: "active" } } as PokemonRef, // the opponent's board
      { seat: "p1", spot: { spot: "bench", index: 4 } } as PokemonRef, // no such bench slot
    ]) {
      expectErr(
        parked,
        { type: "resolveEffect", seat: "p1", choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest }] } },
        "BAD_EFFECT_CHOICE",
      );
    }
  });

  it("rejects moving a Pokémon's Energy onto ITSELF (source === destination)", () => {
    let state = board(5);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const energyUid = activeEnergy(state, "p1")[0] as string;
    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    // The Energy is on the Active; naming the Active as the destination is illegal.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest: P1_ACTIVE }] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("respects max — Energy Switch offers max 1, so moving 2 is rejected", () => {
    let state = board(6);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 2); // two Basic Energy on the Active
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const [e1, e2] = activeEnergy(state, "p1");
    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: e1 as string, dest: P1_BENCH0 }, { uid: e2 as string, dest: P1_BENCH0 }] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects the SAME Energy named twice — one card cannot fill two of a max", () => {
    // Pre-existing wire rule with no test until now (surfaced by the D43 review's
    // mutation run: deleting the duplicate-uid guard left the whole suite green).
    // Poppy moves "up to 2", so a repeated uid passes the count check and would
    // otherwise reach moveEnergyApply, which moves by uid — a Set membership test
    // that silently applies ONE move for a two-Energy answer.
    let state = board(11);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv03-193", 1); // Poppy — max 2
    const energyUid = activeEnergy(state, "p1")[0] as string;
    const uid = handUid(state, "p1", "sv03-193");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest: P1_BENCH0 }, { uid: energyUid, dest: P1_BENCH0 }] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("declining (move none) moves nothing and returns to turn:action", () => {
    let state = board(7);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const energyUid = activeEnergy(state, "p1")[0] as string;
    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(activeEnergy(done, "p1")).toContain(energyUid); // the Energy stayed put
  });

  it("is not playable with fewer than two of your Pokémon in play (no distinct destination)", () => {
    let state = board(8);
    // Energy on the Active but NO Bench — nowhere to move it to.
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const uid = handUid(state, "p1", "sv01-173");
    expectErr(state, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
  });

  it("is not playable with no Energy the filter admits (empty, or only a Special)", () => {
    let base = board(9);
    base = benchFromDeck(base, "p1", "fix-basic-2");
    base = handFromDeck(base, "p1", "sv01-173", 1);
    const uid = handUid(base, "p1", "sv01-173");
    // No Energy at all.
    expectErr(base, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
    // A Special Energy only — Energy Switch's basicEnergy filter still finds nothing.
    const specialOnly = attachFromDeck(base, "p1", "fix-special", 1);
    expectErr(specialOnly, { type: "playTrainer", seat: "p1", uid }, "NO_LEGAL_TARGET");
  });

  it("Poppy (Supporter) moves up to 2 ANY Energy — a Basic AND a Special — from one source", () => {
    let state = board(10);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1); // Basic
    state = attachFromDeck(state, "p1", "fix-special", 1); // Special
    state = handFromDeck(state, "p1", "sv03-193", 1);
    const energies = activeEnergy(state, "p1"); // [basic, special]

    const uid = handUid(state, "p1", "sv03-193");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy prompt");
    expect(parked.phase.prompt.max).toBe(2);
    expect(parked.phase.prompt.note).toBe(
      "Move up to 2 Energy from 1 of your Pokémon to another of your Pokémon.",
    );
    // anyEnergy admits BOTH the Basic and the Special.
    const movable = new Set(parked.phase.prompt.movable.map((m) => m.uid));
    expect(movable.has(energies[0] as string)).toBe(true);
    expect(movable.has(energies[1] as string)).toBe(true);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: energies.map((uid) => ({ uid, dest: P1_BENCH0 })) },
    });
    expect(activeEnergy(done, "p1")).toHaveLength(0);
    expect(benchEnergy(done, "p1", 0)).toEqual(expect.arrayContaining(energies));
    expect(find(events, "ENERGY_MOVED")?.uids).toEqual(energies);
  });

  it("Poppy may move fewer than max (1 of 2)", () => {
    let state = board(11);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 2);
    state = handFromDeck(state, "p1", "sv03-193", 1);
    const [e1, e2] = activeEnergy(state, "p1");
    const uid = handUid(state, "p1", "sv03-193");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: e1 as string, dest: P1_BENCH0 }] },
    });
    expect(benchEnergy(done, "p1", 0)).toEqual([e1]);
    expect(activeEnergy(done, "p1")).toEqual([e2]); // the un-picked Energy stays
  });

  it("APPENDS onto a destination that already holds Energy (no clobber, total conserved)", () => {
    let state = board(15);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1); // the Energy to move (on the Active)
    state = attachBenchFromDeck(state, "p1", 0, "fix-water-energy", 1); // the dest ALREADY has one
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const moved = activeEnergy(state, "p1")[0] as string;
    const alreadyThere = benchEnergy(state, "p1", 0)[0] as string;
    const totalBefore = activeEnergy(state, "p1").length + benchEnergy(state, "p1", 0).length;

    const uid = handUid(state, "p1", "sv01-173");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: moved, dest: P1_BENCH0 }] },
    });
    // The destination now holds BOTH — its own Energy plus the moved one (appended,
    // not replaced); the source is emptied; the on-board total is unchanged.
    expect(benchEnergy(done, "p1", 0)).toEqual([alreadyThere, moved]);
    expect(activeEnergy(done, "p1")).not.toContain(moved);
    expect(activeEnergy(done, "p1").length + benchEnergy(done, "p1", 0).length).toBe(totalBefore);
  });

  it("Poppy rejects picks from TWO different source Pokémon (from 1 of your Pokémon)", () => {
    let state = board(12);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1); // on the Active
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1); // on the Bench
    state = handFromDeck(state, "p1", "sv03-193", 1);
    const activeE = activeEnergy(state, "p1")[0] as string;
    const benchE = benchEnergy(state, "p1", 0)[0] as string;

    const uid = handUid(state, "p1", "sv03-193");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: activeE, dest: P1_ACTIVE }, { uid: benchE, dest: P1_ACTIVE }] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("never mutates the input state — both the play AND the move (frozen boards)", () => {
    let state = board(13);
    state = benchFromDeck(state, "p1", "fix-basic-2");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = handFromDeck(state, "p1", "sv01-173", 1);
    const uid = handUid(state, "p1", "sv01-173");
    // 1. The play up to the park.
    expect(() =>
      applyAction(deepFreeze(state), { type: "playTrainer", seat: "p1", uid }),
    ).not.toThrow();
    // 2. The RESOLVE — the deck-free strip/re-attach mutation; freezing the parked
    //    state proves moveEnergyApply copies rather than splices.
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy prompt");
    const energyUid = parked.phase.prompt.movable[0]?.uid as string;
    expect(() =>
      applyAction(deepFreeze(parked), {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: energyUid, dest: P1_BENCH0 }] },
      }),
    ).not.toThrow();
  });
});
