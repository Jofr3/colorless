import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  PRIZE_DECK,
  activeUid,
  attachFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
} from "./testFixtures";

// M5 (prize value, §8.1) — prizeValueOf turned real: a KO is worth 3 Prizes for
// a VMAX, 2 for any other rule box (ex / V / VSTAR / GX), 1 for a plain body.
// The class is read off the printed name suffix (pokemonSuffixOf, unit-tested in
// cards.test.ts). This suite pins the KO→count wiring end to end: P1's fix-attacker
// Bites a pre-damaged P2 Active to lethal and we read the Prize count the KO owes.

/** Setup then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    turn 2 is their first turn with no §4 attack restriction. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, { p1: PRIZE_DECK, p2: PRIZE_DECK }, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P1 fix-attacker (energied for Bite [C] 30) vs a P2 Active of `activeId`,
    pre-damaged so the 30 is lethal. setActiveFromDeck displaces P2's setup Active
    to the bench, so the ensuing Active KO always has a Pokémon to promote into. */
function biteVs(seed: number, activeId: string, hp: number): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1); // pays Bite [C]
  state = setActiveFromDeck(state, "p2", activeId);
  return setDamage(state, "p2", hp - 30); // Bite's 30 finishes it
}

const attack = { type: "attack", seat: "p1", index: 0 } as const;

describe("prizeValueOf — the Prizes a KO owes (§8.1)", () => {
  it("KOing a Pokémon V owes 2 Prizes", () => {
    const state = biteVs(1, "fix-pokemon-v", 210);
    const koedV = activeUid(state, "p2");
    const { state: after, events } = mustApply(state, attack);

    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: koedV });
    // §8.1 — the prize is taken before the promotion refills the board.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 2 });
    expect(after.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    // Both Prizes leave the row in ONE pick (the ex flow takes `count` at once):
    // P1's row drops 6 → 4, proving the count was real, not just the phase label.
    const next = must(applyAction(after, { type: "takePrizes", seat: "p1", prizeIndices: [0, 1] }));
    expect(next.players.p1.prizes.length).toBe(4);
  });

  it("KOing a VMAX owes 3 Prizes", () => {
    const state = biteVs(2, "fix-pokemon-vmax", 330);
    const { state: after } = mustApply(state, attack);
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 3 });
  });

  it("KOing a plain Pokémon still owes exactly 1 Prize (the contrast)", () => {
    const state = biteVs(3, "fix-victim", 30);
    const { state: after } = mustApply(state, attack);
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("clamps to the Prizes that remain — a 2-Prize KO with one Prize left wins (§14.1)", () => {
    // Without the flow's Math.min clamp, a KO worth 2 against a lone remaining
    // Prize would over-draw; instead it takes the last one and ends the game.
    let state = biteVs(4, "fix-pokemon-v", 210);
    state = setPrizes(state, "p1", 1);
    const { state: after, events } = mustApply(state, attack);
    expect(find(events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "prizesTaken",
    });
    expect(after.phase.kind).toBe("gameOver");
  });
});
