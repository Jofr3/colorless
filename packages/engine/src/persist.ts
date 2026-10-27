import type { Card } from "@colorless/schema";
import {
  type GameState,
  type InPlayPokemon,
  type Seat,
  clearedAttackEffects,
  clearedSideInstalls,
} from "./types";

/**
 * The version of the persisted `GameState` shape. Bump it whenever a state written by the previous
 * deploy could be misread by this one: a new required field on persisted state, or a new required
 * field on an op that can park in `phase.cont`. Widenings (new union members, optional fields) do
 * not bump it. When the previous version can be carried forward, add its step to
 * `MIGRATION_STEPS`; a step that only adds install fields is `withDefaultKeys`. A version with no
 * step cannot be migrated, and its states are discarded. `persistShape.test.ts` pins a skeleton of
 * the persisted shape to this number.
 */
export const GAME_STATE_VERSION = 51;

/** The one version whose Trainer faces are refreshed from the catalog. */
const POOL_REFRESH_VERSION = 41;

type MigrationStep = (state: GameState, freshPool: Readonly<Record<string, Card>>) => GameState;

const unchanged: MigrationStep = (state) => state;

/**
 * Each migratable version, ascending, with the step that brings its states up to the next. A state
 * runs its own version's step and every later one, so each version takes only the keys it lacks; an
 * earlier step would clobber live values it already holds.
 */
const MIGRATION_STEPS: ReadonlyMap<number, MigrationStep> = new Map([
  [POOL_REFRESH_VERSION, withFreshTrainerFaces],
  [42, withDefaultKeys],
  [43, withRecordKeys],
  [44, withLockKeys],
  [45, unchanged],
  [46, unchanged],
  [47, unchanged],
  [48, unchanged],
  [49, withGateOpsKey],
  // 51 widened `rngState` to a ChaCha20 state (security audit MI1). A v50 state keeps its
  // mulberry32 number, which every reader still accepts; the bump is so a deploy before 51, which
  // would read a ChaCha20 state as a number, retires a v51 state instead of misreading it.
  [50, unchanged],
]);

/**
 * The catalog ids whose current rows `migrateGameState` needs as `freshPool`: the state's pool for
 * a version whose Trainer faces are refreshed, `[]` for any other migratable version, or `null`
 * when `raw` is not a migratable state at `fromVersion`.
 */
export function poolIdsNeededFor(raw: unknown, fromVersion: number): string[] | null {
  const state = migratableState(raw, fromVersion);
  if (state === null) return null;
  return fromVersion === POOL_REFRESH_VERSION ? Object.keys(state.cardPool) : [];
}

/**
 * Migrate a state persisted at `fromVersion` to `GAME_STATE_VERSION`, or `null` when it is not a
 * migratable state: an unknown or current version, or a value without the top-level objects every
 * step reads. `freshPool` holds the catalog rows `poolIdsNeededFor` names. The input is not
 * modified.
 */
export function migrateGameState(
  raw: unknown,
  fromVersion: number,
  freshPool: Readonly<Record<string, Card>> = {},
): GameState | null {
  let state = migratableState(raw, fromVersion);
  if (state === null) return null;
  for (const [version, step] of MIGRATION_STEPS) {
    if (version >= fromVersion) state = step(state, freshPool);
  }
  return state;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function migratableState(raw: unknown, fromVersion: number): GameState | null {
  if (!MIGRATION_STEPS.has(fromVersion)) return null;
  const shaped =
    isObject(raw) && isObject(raw.phase) && isObject(raw.players) && isObject(raw.cardPool);
  return shaped ? (raw as unknown as GameState) : null;
}

function withAbsentKeys<T extends object>(value: T, defaults: object): T {
  const absent = Object.entries(defaults).filter(([key]) => !Object.hasOwn(value, key));
  return absent.length === 0 ? value : { ...value, ...Object.fromEntries(absent) };
}

/**
 * Fills every side install and per-body attack effect field a state lacks with its cleared value.
 * A key that is present is kept as written, so this is safe on a state of any version.
 */
export function withDefaultKeys(state: GameState): GameState {
  const players = { ...state.players };
  for (const seat of ["p1", "p2"] as const) {
    const side = players[seat];
    const body = (pokemon: InPlayPokemon) => withAbsentKeys(pokemon, clearedAttackEffects());
    players[seat] = withAbsentKeys(
      {
        ...side,
        active: side.active === null ? null : body(side.active),
        bench: side.bench.map(body),
      },
      clearedSideInstalls(),
    );
  }
  return { ...state, players };
}

const GATE_OPS: ReadonlySet<unknown> = new Set([
  "coinFlipGate",
  "conditionGate",
  "recordGate",
  "optional",
]);

/**
 * Renames `then` to `ops` on every gate op anywhere in a v49 state (programs, parked continuations,
 * scheduled ops), keeping the key's position. Only the objects on a path to a renamed key are
 * copied; everything else is returned as it was.
 */
function withGateOpsKey(state: GameState): GameState {
  return renamedGateKeys(state) as GameState;
}

function renamedGateKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    for (const [i, item] of value.entries()) {
      const next = renamedGateKeys(item);
      if (next === item) continue;
      copy ??= [...value];
      copy[i] = next;
    }
    return copy ?? value;
  }
  const object = value as Record<string, unknown>;
  const gate = GATE_OPS.has(object.op) && Object.hasOwn(object, "then");
  let changed = gate;
  const entries = Object.entries(object).map(([key, item]): [string, unknown] => {
    const next = renamedGateKeys(item);
    if (next !== item) changed = true;
    return [gate && key === "then" ? "ops" : key, next];
  });
  return changed ? Object.fromEntries(entries) : value;
}

/** Replaces every persisted Trainer face of a v41 state with its `fresh` catalog row. */
function withFreshTrainerFaces(state: GameState, fresh: Readonly<Record<string, Card>>): GameState {
  const cardPool: Record<string, Card> = { ...state.cardPool };
  for (const [id, card] of Object.entries(cardPool)) {
    const row = fresh[id];
    if (card.category === "Trainer" && row?.category === "Trainer") cardPool[id] = row;
  }
  return { ...state, cardPool };
}

/**
 * Adds the lock keys a v44 state lacks: `trainerFlipLockTurn` and a Stadium hand-play stamp per
 * seat, and `attackTwoFlipLockTurn`, `benchedTurn` and hand-attach `counters` per in-play body.
 */
function withLockKeys(state: GameState): GameState {
  const players = { ...state.players };
  const handPlayLockedTurn = { ...state.handPlayLockedTurn };
  for (const seat of ["p1", "p2"] as const) {
    const side = players[seat];
    const body = (pokemon: InPlayPokemon): InPlayPokemon => ({
      ...pokemon,
      attackTwoFlipLockTurn: null,
      benchedTurn: null,
      handAttachMark:
        pokemon.handAttachMark === null ? null : { ...pokemon.handAttachMark, counters: 0 },
    });
    players[seat] = {
      ...side,
      trainerFlipLockTurn: null,
      active: side.active === null ? null : body(side.active),
      bench: side.bench.map(body),
    };
    handPlayLockedTurn[seat] = { ...handPlayLockedTurn[seat], Stadium: null };
  }
  return { ...state, players, handPlayLockedTurn };
}

/**
 * Adds the record keys a v43 state lacks: `prizesTakenOnTurn: null` and `sideDamageReduction` as a
 * list per seat, and `attackDamageTaken: null` per in-play body.
 */
function withRecordKeys(state: GameState): GameState {
  const players = { ...state.players };
  for (const seat of ["p1", "p2"] as const) {
    const side = players[seat];
    const old = (side as { sideDamageReduction?: unknown }).sideDamageReduction;
    const sideDamageReduction = Array.isArray(old)
      ? (old as GameState["players"][Seat]["sideDamageReduction"])
      : old === null || old === undefined
        ? []
        : [old as GameState["players"][Seat]["sideDamageReduction"][number]];
    const body = <T extends object>(pokemon: T): T => ({ ...pokemon, attackDamageTaken: null });
    players[seat] = {
      ...side,
      prizesTakenOnTurn: null,
      sideDamageReduction,
      active: side.active === null ? null : body(side.active),
      bench: side.bench.map(body),
    };
  }
  return { ...state, players };
}
