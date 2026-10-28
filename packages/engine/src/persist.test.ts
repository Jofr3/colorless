import { describe, expect, it } from "vitest";
import type { GameState, InPlayPokemon } from "./index";
import { GAME_STATE_VERSION, migrateGameState, withDefaultKeys } from "./persist";
import { ALL_BASIC_DECK, completeSetup, mustCreate } from "./testFixtures";
import { clearedAttackEffects, clearedSideInstalls } from "./types";

function inTurn(): GameState {
  const { state } = mustCreate(7, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK });
  return completeSetup(state);
}

function without<T extends object>(value: T, keys: readonly string[]): T {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key))) as T;
}

describe("withDefaultKeys", () => {
  it("leaves a current state equal to itself", () => {
    const state = inTurn();
    expect(withDefaultKeys(state)).toEqual(state);
  });

  it("fills every absent side install and body effect key with its cleared value", () => {
    const state = inTurn();
    const sideKeys = Object.keys(clearedSideInstalls());
    const bodyKeys = Object.keys(clearedAttackEffects());
    const strip = (pokemon: InPlayPokemon) => without(pokemon, bodyKeys);
    const players = { ...state.players };
    for (const seat of ["p1", "p2"] as const) {
      const side = without(players[seat], sideKeys);
      players[seat] = {
        ...side,
        active: side.active === null ? null : strip(side.active),
        bench: side.bench.map(strip),
      };
    }
    const filled = withDefaultKeys({ ...state, players });
    expect(filled).toEqual(state);
    for (const seat of ["p1", "p2"] as const) {
      expect(filled.players[seat]).toMatchObject(clearedSideInstalls());
      expect(filled.players[seat].active).toMatchObject(clearedAttackEffects());
    }
  });

  it("keeps a present key as written, live or not", () => {
    const state = inTurn();
    const active = state.players.p1.active as InPlayPokemon;
    const reduction = { turn: state.turn + 1, amount: 30 };
    const live: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          trainerFlipLockTurn: state.turn,
          sideDamageReduction: [
            reduction,
          ] as unknown as GameState["players"]["p1"]["sideDamageReduction"],
          active: { ...active, attackLockedTurn: state.turn, lockedAttacks: [] },
        },
      },
    };
    const filled = withDefaultKeys(live);
    expect(filled.players.p1.trainerFlipLockTurn).toBe(state.turn);
    expect(filled.players.p1.sideDamageReduction).toEqual([reduction]);
    expect(filled.players.p1.active?.attackLockedTurn).toBe(state.turn);
  });

  it("does not touch the state it was given", () => {
    const state = inTurn();
    const players = { ...state.players, p2: without(state.players.p2, ["chosenAttackShield"]) };
    const old = { ...state, players };
    const before = JSON.stringify(old);
    withDefaultKeys(old);
    expect(JSON.stringify(old)).toBe(before);
  });
});

describe("migrateGameState: the oldest migratable version is 42", () => {
  it("migrates every version from 42 to the one before the current one", () => {
    const state = inTurn();
    for (let version = 42; version < GAME_STATE_VERSION; version++) {
      expect(migrateGameState(state, version), `v${version}`).not.toBeNull();
    }
  });

  it("refuses the retired v41 and older, the current version and a newer one", () => {
    const state = inTurn();
    for (const version of [40, 41, GAME_STATE_VERSION, GAME_STATE_VERSION + 1]) {
      expect(migrateGameState(state, version), `v${version}`).toBeNull();
    }
  });

  it("refuses a value without the top-level objects every step reads", () => {
    const state = inTurn();
    for (const raw of [null, undefined, 42, "x"]) expect(migrateGameState(raw, 42)).toBeNull();
    for (const key of ["cardPool", "players", "phase"]) {
      expect(migrateGameState({ ...state, [key]: null }, 42), key).toBeNull();
    }
  });
});
