// P4 — the lobby → engine handoff (online.md). When a lobby's countdown ends with
// both players ready, the DO starts a real match: it instantiates the P3 engine
// server-side and owns the RNG seed + hidden info. This module is the seam.
//
// The lobby has no p1/p2 concept — seats are "host"/"guest" — so the mapping to the
// engine's Seat is minted HERE, at match start: the host is p1, the guest is p2.
// Kept pure (no DO/storage/D1) so it unit-tests without a Worker: the DO loads the
// card pool from D1 (`loadCardPool`) and calls `startMatch`, then persists + redacts
// the result.

import {
  type CreateGameResult,
  type GameAction,
  type GameEvent,
  type GameState,
  type InPlayPokemon,
  type Seat,
  applyAction,
  createGame,
  formatElapsed,
  logFromEvents,
} from "@colorless/engine";
import type { Card, LobbySnapshot, SeatLogEntry, WireAction } from "@colorless/schema";
import { z } from "zod";
import { slotOf } from "./logic";

/** The one place the lobby's seats map to the engine's: host → p1, guest → p2. */
export const SEAT_OF_SLOT = { host: "p1", guest: "p2" } as const satisfies Record<
  "host" | "guest",
  Seat
>;

/** The engine seat whose REDACTED view the socket-holder `playerId` receives —
    host → p1, guest → p2 (SEAT_OF_SLOT), or null for a player not seated in this
    lobby (a refused/observer socket). The DO's per-viewer match broadcast keys
    each socket's redaction off this. */
export function matchSeatOf(snapshot: LobbySnapshot, playerId: string): Seat | null {
  const slot = slotOf(snapshot, playerId);
  return slot === null ? null : SEAT_OF_SLOT[slot];
}

/** The lobby player holding engine `seat`, or null when that seat is empty. */
export function playerIdOfSeat(snapshot: LobbySnapshot, seat: Seat): string | null {
  return seat === SEAT_OF_SLOT.host ? snapshot.host.id : (snapshot.guest?.id ?? null);
}

export interface StartMatchOptions {
  /** The authoritative RNG seed the DO owns for this match (shuffle + coin flip). */
  seed: number;
  /** The host's 60-card deck as a flat list of catalog ids (becomes p1). */
  hostDeck: readonly string[];
  /** The guest's 60-card deck (becomes p2). */
  guestDeck: readonly string[];
  /** Every distinct card id in either deck, resolved to its full catalog Card. */
  cardPool: Record<string, Card>;
}

/** Create the engine game for a lobby handoff. A thin, deterministic wrapper over
    `createGame` that fixes the seat mapping; returns the engine's own result (which
    validates deck size + a Basic and pauses at the first-player choice, or reports
    a `CreateError`). */
export function startMatch(opts: StartMatchOptions): CreateGameResult {
  return createGame({
    seed: opts.seed,
    decks: { p1: [...opts.hostDeck], p2: [...opts.guestDeck] },
    cardPool: opts.cardPool,
  });
}

/** Who sets the play order of a lobby's game. The first game (or one after a
    tie) is decided by the coin alone: its winner goes first, with no choice to
    make. A rematch's previous LOSER chooses instead — the coin decided nothing,
    so its row is dropped from the log and the loser takes the choosing seat. */
export function settleFirstPlayer(
  state: GameState,
  events: readonly GameEvent[],
  chooser: Seat | null,
): { state: GameState; events: GameEvent[] } {
  const phase = state.phase;
  if (phase.kind !== "setup:chooseFirst") return { state, events: [...events] };
  if (chooser !== null) {
    return {
      state: { ...state, phase: { kind: "setup:chooseFirst", coinWinner: chooser } },
      events: events.filter((e) => e.type !== "COIN_FLIP"),
    };
  }
  const seat = phase.coinWinner;
  const result = applyAction(state, { type: "chooseFirstPlayer", seat, first: seat });
  if (!result.ok) return { state, events: [...events] };
  return { state: result.state, events: [...events, ...result.events] };
}

/** The seat that chooses the next game's order: the loser of a finished match,
    or null for a tie (back to the coin). */
export function rematchChooser(state: GameState): Seat | null {
  const phase = state.phase;
  if (phase.kind !== "gameOver" || phase.outcome.result !== "win") return null;
  return phase.outcome.winner === "p1" ? "p2" : "p1";
}

/** What the DO persists when a lobby becomes a match: the authoritative
    full-information `GameState` plus the seed it was created from (audit/replay).
    Seats map by `SEAT_OF_SLOT`. Stored under the DO's match key and, from
    increment 1c, redacted per seat before it crosses the wire. */
export interface MatchRecord {
  /** The persisted shape's version (`MATCH_RECORD_VERSION` at write time). Read
      back through `readMatchRecord`, which retires anything that doesn't match —
      the DO has no storage migrations (online.md), so versioning IS the migration
      story: a record the running code can't trust is dropped, not guessed at. */
  version: number;
  /** The RNG seed the DO minted for this match. */
  seed: number;
  /** Epoch ms the match started — the log's "+MM:SS" elapsed origin (2b-iii-d-ii). */
  startedAt: number;
  /** Display names per seat (the lobby player names: host → p1, guest → p2) — the
      log's system rows read them ("Ana wins the toss"). Fixed for the match. */
  names: Record<Seat, string>;
  /** The engine's full game state — never sent whole to a client (online.md). */
  state: GameState;
  /** The accumulated game log, seat-keyed + leak-safe (@colorless/engine
      `logFromEvents`). Grows as actions apply; the DO broadcasts it WHOLE on every
      match frame (a reconnect gets the full backlog), and each client relabels it
      for its own seat (`viewLogEntries`). It can't be rebuilt from `state` — it is
      the running record of every event since createGame — so it is persisted here
      beside the state it describes. */
  log: SeatLogEntry[];
}

/**
 * The version stamped into every `MatchRecord` this deploy writes. Bump it whenever a record
 * written by the previous deploy could be misread by this one: a change to the record's shape, a
 * new required field on persisted engine state, or a new required field on an op that can park in
 * `phase.cont`. Widenings (new union members, optional fields) do not bump it. A mismatched record
 * is retired and the players are told to re-ready, because the Durable Object has no migrations.
 */
export const MATCH_RECORD_VERSION = 50;

/** The oldest record version this deploy migrates; its pool is refreshed from D1. */
export const MIGRATABLE_MATCH_RECORD_VERSION = 41;

export const SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION = 42;

export const RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION = 43;

export const LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION = 44;

export const FOSSILS_MIGRATABLE_MATCH_RECORD_VERSION = 45;

export const PRIZE_STAGE_MIGRATABLE_MATCH_RECORD_VERSION = 46;

export const TOOL_TRIM_MIGRATABLE_MATCH_RECORD_VERSION = 47;

export const COIN_REDO_MIGRATABLE_MATCH_RECORD_VERSION = 48;

export const GATE_OPS_MIGRATABLE_MATCH_RECORD_VERSION = 49;

/**
 * The catalog ids a migratable record's pool holds (what `loadMatchRecord` re-reads from D1): the
 * pool for a v41 record, `[]` for a newer migratable one, or `null` for anything that is not a
 * well-formed migratable record.
 */
export function migratablePoolIdsOf(raw: unknown): string[] | null {
  const record = readMigratableRecord(raw);
  if (record === null) return null;
  return record.version === MIGRATABLE_MATCH_RECORD_VERSION
    ? Object.keys(record.state.cardPool)
    : [];
}

/**
 * Migrate an older record to this deploy's version, or `null` if it is not a well-formed migratable
 * record. A record runs its own version's step and every later one, so each version takes only the
 * key-adding steps it lacks; an earlier step would clobber live values it already holds.
 */
export function migrateMatchRecord(raw: unknown, fresh: Record<string, Card>): MatchRecord | null {
  const record = readMigratableRecord(raw);
  if (record === null) return null;
  let state = record.state;
  for (const [version, step] of MIGRATION_STEPS) {
    if (version >= record.version) state = step(state, fresh);
  }
  return { ...record, version: MATCH_RECORD_VERSION, state };
}

type MigrationStep = (state: GameState, fresh: Record<string, Card>) => GameState;

const unchanged: MigrationStep = (state) => state;

/** Each migratable version, ascending, with the step that brings its records up to the next. */
const MIGRATION_STEPS: ReadonlyMap<number, MigrationStep> = new Map([
  [MIGRATABLE_MATCH_RECORD_VERSION, withFreshTrainerFaces],
  [SIDE_KEYS_MIGRATABLE_MATCH_RECORD_VERSION, withD621SideKeys],
  [RECORD_KEYS_MIGRATABLE_MATCH_RECORD_VERSION, withD630RecordKeys],
  [LOCK_KEYS_MIGRATABLE_MATCH_RECORD_VERSION, withD636LockKeys],
  [FOSSILS_MIGRATABLE_MATCH_RECORD_VERSION, unchanged],
  [PRIZE_STAGE_MIGRATABLE_MATCH_RECORD_VERSION, unchanged],
  [TOOL_TRIM_MIGRATABLE_MATCH_RECORD_VERSION, unchanged],
  [COIN_REDO_MIGRATABLE_MATCH_RECORD_VERSION, unchanged],
  [GATE_OPS_MIGRATABLE_MATCH_RECORD_VERSION, withGateOpsKey],
]);

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

/** Replaces every persisted Trainer face of a v41 record with its `fresh` catalog row. */
function withFreshTrainerFaces(state: GameState, fresh: Record<string, Card>): GameState {
  const cardPool: Record<string, Card> = { ...state.cardPool };
  for (const [id, card] of Object.entries(cardPool)) {
    const row = fresh[id];
    if (card.category === "Trainer" && row?.category === "Trainer") cardPool[id] = row;
  }
  return { ...state, cardPool };
}

/**
 * Adds the lock keys a v44 record lacks: `trainerFlipLockTurn` and a Stadium hand-play stamp per
 * seat, and `attackTwoFlipLockTurn`, `benchedTurn` and hand-attach `counters` per in-play body.
 */
function withD636LockKeys(state: GameState): GameState {
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
 * Adds the record keys a v43 record lacks: `prizesTakenOnTurn: null` and `sideDamageReduction` as a
 * list per seat, and `attackDamageTaken: null` per in-play body.
 */
function withD630RecordKeys(state: GameState): GameState {
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

/**
 * Writes `chosenAttackShield` and `sideRetreatLock` as `null` on each seat; a v42 side has neither
 * key.
 */
function withD621SideKeys(state: GameState): GameState {
  const players = { ...state.players };
  for (const seat of ["p1", "p2"] as const) {
    players[seat] = { ...players[seat], chosenAttackShield: null, sideRetreatLock: null };
  }
  return { ...state, players };
}

/**
 * The persisted match slot `loadMatchRecord` reads and writes, narrowed from the DO's storage so
 * the step is testable without a Durable Object.
 */
export interface MatchSlot {
  get(): Promise<unknown>;
  put(record: MatchRecord): Promise<void>;
}

/**
 * Read the persisted match: absent, usable, or stale. A migratable record is migrated and written
 * back before it is returned. `loadPool` is external I/O, so the slot is re-read after it, since
 * another event may have changed the match meanwhile. A failed `loadPool` writes nothing; the
 * record is never played unmigrated.
 */
export async function loadMatchRecord(
  slot: MatchSlot,
  loadPool: (ids: readonly string[]) => Promise<Record<string, Card>>,
): Promise<MatchLoad> {
  const raw = await slot.get();
  if (raw === undefined) return { kind: "none" };
  const record = readMatchRecord(raw);
  if (record !== null) return { kind: "ok", record };
  const ids = migratablePoolIdsOf(raw);
  if (ids === null) return { kind: "stale" };
  // Only a v41 record has a pool to re-read; newer migratable records skip D1.
  const fresh = ids.length === 0 ? {} : await loadPool(ids);
  const again = await slot.get();
  if (again === undefined) return { kind: "none" };
  const current = readMatchRecord(again);
  if (current !== null) return { kind: "ok", record: current };
  const migrated = migrateMatchRecord(again, fresh);
  if (migrated === null) return { kind: "stale" };
  await slot.put(migrated);
  return { kind: "ok", record: migrated };
}

/**
 * A migratable record, or `null`. It needs the envelope `readMatchRecord` checks, at one of the
 * versions in `MIGRATION_STEPS`, and the pool its steps rewrite. The result keeps its own version,
 * which `migrateMatchRecord` branches on.
 */
function readMigratableRecord(raw: unknown): MatchRecord | null {
  const parsed = migratableRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** How a persisted match read back: absent, usable, or written by an
    incompatible deploy (`stale` — the caller decides whether to retire it). */
export type MatchLoad = { kind: "none" } | { kind: "ok"; record: MatchRecord } | { kind: "stale" };

/**
 * Read a raw storage value back as a `MatchRecord`, or `null` when this deploy cannot trust it. The
 * version gate decides compatibility; the envelope checks only keep the DO's own reads from
 * throwing on a truncated blob. The embedded `GameState` is not re-validated beyond its top level.
 */
export function readMatchRecord(raw: unknown): MatchRecord | null {
  const parsed = currentRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The persisted `GameState`, checked only for the keys every reader touches first. */
const storedStateSchema = z.custom<GameState>(
  (value) => isObject(value) && isObject(value.phase) && isObject(value.players),
);

function matchRecordSchema(version: z.ZodType<number>, state: z.ZodType<GameState>) {
  return z.object({
    version,
    seed: z.number(),
    startedAt: z.number(),
    names: z.object({ p1: z.string(), p2: z.string() }),
    state,
    log: z.array(z.custom<SeatLogEntry>(isObject)),
  }) satisfies z.ZodType<MatchRecord>;
}

const currentRecordSchema = matchRecordSchema(z.literal(MATCH_RECORD_VERSION), storedStateSchema);

const migratableRecordSchema = matchRecordSchema(
  z.number().refine((version) => MIGRATION_STEPS.has(version)),
  storedStateSchema.refine((state) => isObject(state.cardPool)),
);

/**
 * Every engine `GameAction` type and whether the online client may send it.
 * `SUPPORTED_MATCH_ACTIONS` is derived from this table, and the `satisfies` clause makes a new
 * engine action a missing key that fails the build. `"withheld"` means the engine accepts the
 * action but no client surface sends it yet; an action must not be supported before its client
 * surface exists, or online matches can soft-lock.
 */
export const MATCH_ACTION_DISPOSITION = {
  chooseFirstPlayer: "supported",
  setupDrawExtra: "supported",
  setupPlaceActive: "supported",
  setupPlaceBench: "supported",
  setupReady: "supported",
  reorderBench: "supported",
  attachEnergy: "supported",
  playBasicToBench: "supported",
  evolve: "supported",
  attachTool: "supported",
  playTrainer: "supported",
  useAbility: "supported",
  useStadiumAbility: "supported",
  rareCandy: "supported",
  concede: "supported",
  attack: "supported",
  takePrizes: "supported",
  promote: "supported",
  retreat: "supported",
  resolveEffect: "supported",
  endTurn: "supported",
  // An Antique Fossil's "discard this card from play".
  discardFromPlay: "supported",
} as const satisfies Record<GameAction["type"], "supported" | "withheld">;

/**
 * The engine action types the online client can drive and recover from; the DO rejects everything
 * else, so a crafted frame cannot push the match into a phase the online HUD has no control for.
 * Every effect prompt kind these actions can park on must have an online dialog; that is enforced
 * on the web client, not here.
 */
export const SUPPORTED_MATCH_ACTIONS: ReadonlySet<string> = new Set(
  Object.entries(MATCH_ACTION_DISPOSITION)
    .filter(([, disposition]) => disposition === "supported")
    .map(([type]) => type),
);

/**
 * Apply a client action to a persisted match. The action is bound to the actor's own `seat`, never
 * the client-claimed one, gated to `SUPPORTED_MATCH_ACTIONS`, then run through the engine's total
 * `applyAction`. On accept returns the next record with the events logged at `now`; on reject
 * returns a `reason` and changes nothing.
 */
export type MatchActionOutcome = { ok: true; record: MatchRecord } | { ok: false; reason: string };

export function applyMatchAction(
  record: MatchRecord,
  seat: Seat,
  action: WireAction,
  now: number,
): MatchActionOutcome {
  // Off-allowlist types never reach the engine (the soft-lock gate) — a generic
  // reason, since there is no engine message to quote.
  if (!SUPPORTED_MATCH_ACTIONS.has(action.type)) {
    return { ok: false, reason: "That move isn't available here." };
  }
  const result = applyAction(record.state, { ...action, seat } as GameAction);
  // The engine's own rejection message is safe to surface: it describes the
  // ACTOR's own illegal move / wrong phase, never the opponent's hidden zones.
  if (!result.ok) return { ok: false, reason: result.error.message };
  // Format the accepted events into log rows (leak-safe: counts for hidden draws,
  // names off public state) and append. The log grows; seed/startedAt/names ride on.
  const entries = logFromEvents(result.events, {
    names: record.names,
    state: result.state,
    elapsed: formatElapsed(now - record.startedAt),
  });
  return {
    ok: true,
    record: { ...record, state: result.state, log: [...record.log, ...entries] },
  };
}
