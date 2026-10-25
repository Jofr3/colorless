import type { Card } from "@colorless/schema";
import type { GameAction, GameState, InPlayPokemon, Seat } from "../index";
import { applyAction } from "../index";
import { migrateGameState, poolIdsNeededFor } from "../persist";

/** A state as an older deploy persisted it, with the version it was stamped with. */
export interface StoredState {
  version: number;
  state: GameState;
}

/** `migrateGameState` over a stored state; takes loosely typed input, as storage does. */
export function migrateStored(
  stored: { version: number; state: unknown },
  fresh: Record<string, Card> = {},
): GameState | null {
  return migrateGameState(stored.state, stored.version, fresh);
}

/** `poolIdsNeededFor` over a stored state. */
export function storedPoolIds(stored: { version: number; state: unknown }): string[] | null {
  return poolIdsNeededFor(stored.state, stored.version);
}

export function mustMigrate(
  stored: { version: number; state: unknown },
  fresh: Record<string, Card> = {},
): GameState {
  const migrated = migrateStored(stored, fresh);
  if (migrated === null) throw new Error(`v${stored.version} not migrated`);
  return migrated;
}

type Side = GameState["players"][Seat];

/**
 * `state` as a deploy at `version` wrote it, with the keys versions 42 to 44 added removed: the
 * lock keys before v45, the prize record before v44 (with a `null` side reduction), and the chosen
 * shield and side retreat lock before v43.
 */
export function storedAt(version: number, state: GameState): StoredState {
  let old = state;
  if (version <= 44) {
    const strip = (pokemon: InPlayPokemon) => {
      const { attackTwoFlipLockTurn: _a, benchedTurn: _b, ...v44 } = pokemon;
      return v44 as unknown as InPlayPokemon;
    };
    const players = { ...old.players };
    const handPlayLockedTurn = { ...old.handPlayLockedTurn };
    for (const seat of ["p1", "p2"] as const) {
      const { trainerFlipLockTurn: _t, ...rest } = players[seat];
      players[seat] = {
        ...rest,
        active: rest.active === null ? null : strip(rest.active),
        bench: rest.bench.map(strip),
      } as unknown as Side;
      const { Stadium: _s, ...locks } = handPlayLockedTurn[seat];
      handPlayLockedTurn[seat] = locks as GameState["handPlayLockedTurn"][Seat];
    }
    old = { ...old, players, handPlayLockedTurn };
  }
  if (version <= 43) {
    const players = { ...old.players };
    for (const seat of ["p1", "p2"] as const) {
      const { prizesTakenOnTurn: _p, sideDamageReduction: _s, ...v43 } = players[seat];
      players[seat] = { ...v43, sideDamageReduction: null } as unknown as Side;
    }
    old = { ...old, players };
  }
  if (version <= 42) {
    const players = { ...old.players };
    for (const seat of ["p1", "p2"] as const) {
      const { chosenAttackShield: _c, sideRetreatLock: _r, ...v42 } = players[seat];
      players[seat] = v42 as Side;
    }
    old = { ...old, players };
  }
  return { version, state: old };
}

function must(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}`);
  return result.state;
}

/**
 * Setup through the real action API with a `basic` as each Active, then p2 goes first and passes:
 * p1's first turn, turn 2.
 */
export function firstP1Turn(start: GameState, basic: string): GameState {
  let state = start;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" });
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] });
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === basic);
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(state, { type: "setupPlaceActive", seat: s, uid });
  }
  for (const s of ["p1", "p2"] as const) state = must(state, { type: "setupReady", seat: s });
  return must(state, { type: "endTurn", seat: "p2" });
}
