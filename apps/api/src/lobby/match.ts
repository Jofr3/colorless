// The lobby → engine handoff (online.md). When a lobby's countdown ends with both
// players ready, the DO starts a real match: it instantiates the engine server-side
// and owns the RNG seed + hidden info. This module is the seam.
//
// The lobby has no p1/p2 concept — seats are "host"/"guest" — so the mapping to the
// engine's Seat is minted HERE, at match start: the host is p1, the guest is p2.
// Kept pure (no DO/storage/D1) so it unit-tests without a Worker: the DO loads the
// decks and card pool from D1, calls `beginMatch`, persists the record and sends each
// socket its `matchFrameFor` view. It is the only lobby module that imports the engine.

import {
  type CreateErrorCode,
  type CreateGameResult,
  type GameAction,
  type GameEvent,
  type GameState,
  type Seat,
  applyAction,
  createGame,
  formatById,
  formatElapsed,
  GAME_STATE_VERSION,
  logFromEvents,
  migrateGameState,
  poolIdsNeededFor,
  redactGame,
  savedDeckReasons,
} from "@colorless/engine";
import type {
  Card,
  LobbyServerMessage,
  LobbySnapshot,
  SeatLogEntry,
  WireAction,
} from "@colorless/schema";
import { z } from "zod";
import { slotOf } from "./logic";

export type { Seat };

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

export interface BeginMatchOptions extends StartMatchOptions {
  /** The lobby players' display names, which the log's system rows read. */
  names: { host: string; guest: string };
  /** The format each deck was built for, which it must be legal in; null plays Standard. */
  formats: { host: string | null; guest: string | null };
  /** The seat that chooses the play order (`settleFirstPlayer`), or null for the coin. */
  chooser: Seat | null;
  /** Epoch ms the match starts, the log's elapsed origin. */
  now: number;
}

export type BeginMatchResult = { ok: true; record: MatchRecord } | { ok: false; reason: string };

/**
 * Mint the record a lobby persists when its countdown ends: check each deck is legal in its own
 * format, create the game, settle who sets the play order, and seed the log from the settled
 * opening at elapsed +00:00. The log is seeded after the settle so a chooser's game carries no coin
 * row. An illegal deck, or one the engine refuses, comes back as a player-facing `reason`.
 */
export function beginMatch(opts: BeginMatchOptions): BeginMatchResult {
  const illegal = illegalDeckReason(opts);
  if (illegal !== null) return { ok: false, reason: illegal };
  const result = startMatch(opts);
  if (!result.ok) return { ok: false, reason: matchStartReason(result.error.code) };
  const opening = settleFirstPlayer(result.state, result.events, opts.chooser);
  const names: Record<Seat, string> = {
    [SEAT_OF_SLOT.host]: opts.names.host,
    [SEAT_OF_SLOT.guest]: opts.names.guest,
  };
  const log = logFromEvents(opening.events, {
    names,
    state: opening.state,
    elapsed: formatElapsed(0),
  });
  return {
    ok: true,
    record: {
      version: MATCH_RECORD_VERSION,
      seed: opts.seed,
      startedAt: opts.now,
      names,
      state: opening.state,
      log,
    },
  };
}

/** Why the first illegal deck, host's then guest's, can't be played, naming its player. */
function illegalDeckReason(opts: BeginMatchOptions): string | null {
  for (const slot of ["host", "guest"] as const) {
    const ids = slot === "host" ? opts.hostDeck : opts.guestDeck;
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const cards = [...counts].map(([cardId, count]) => ({ cardId, count }));
    const [first] = savedDeckReasons(cards, opts.formats[slot], opts.cardPool);
    if (first !== undefined) {
      const format = formatById(opts.formats[slot]).name;
      return `${opts.names[slot]}'s deck can't be played online, as it isn't ${format} legal: ${first}`;
    }
  }
  return null;
}

/** A player-facing reason for a `createGame` reject. Every deck that reaches `startMatch` has
    passed the legality check, which asks more, so this is a backstop. */
function matchStartReason(code: CreateErrorCode): string {
  switch (code) {
    case "BAD_DECK_SIZE":
      return "A deck must have exactly 60 cards.";
    case "NO_BASIC_POKEMON":
      return "A deck must include at least one Basic Pokémon.";
    case "UNKNOWN_CARD_ID":
      return "A deck references a card that's no longer in the catalog.";
  }
}

/** What the DO persists when a lobby becomes a match: the authoritative
    full-information `GameState` plus the seed it was created from (audit/replay).
    Seats map by `SEAT_OF_SLOT`. Stored under the DO's match key and redacted per
    seat before it crosses the wire. */
export interface MatchRecord {
  /** The persisted shape's version (`MATCH_RECORD_VERSION` at write time). Read back
      through `loadMatchRecord`: a current record is used as stored, an older one the
      engine can migrate is migrated and written back, and anything else is retired. */
  version: number;
  /** The RNG seed the DO minted for this match. */
  seed: number;
  /** Epoch ms the match started — the log's "+MM:SS" elapsed origin. */
  startedAt: number;
  /** Display names per seat (the lobby player names: host → p1, guest → p2) — the
      log's system rows read them ("Ana wins the toss"). Fixed for the match. */
  names: Record<Seat, string>;
  /** The engine's full game state — never sent whole to a client (online.md). */
  state: GameState;
  /** The accumulated game log, seat-keyed + leak-safe (@colorless/engine
      `logFromEvents`). Grows as actions apply; a socket that announced log deltas
      gets only the new entries after an action, every other frame carries it whole
      (a reconnect gets the full backlog), and each client relabels it
      for its own seat (`viewLogEntries`). It can't be rebuilt from `state` — it is
      the running record of every event since createGame — so it is persisted here
      beside the state it describes. */
  log: SeatLogEntry[];
}

/**
 * The version stamped into every `MatchRecord` this deploy writes: the engine's persisted-state
 * version, so the record and its state share one number on the wire. A mismatched record is
 * migrated when the engine can carry its state forward, and retired otherwise.
 */
export const MATCH_RECORD_VERSION = GAME_STATE_VERSION;

/**
 * The catalog ids a migratable record's state needs re-read from D1 (`poolIdsNeededFor`), or
 * `null` for anything that is not a well-formed migratable record.
 */
export function migratablePoolIdsOf(raw: unknown): string[] | null {
  const record = readMigratableRecord(raw);
  return record === null ? null : poolIdsNeededFor(record.state, record.version);
}

/**
 * Migrate an older record to this deploy's version, or `null` if it is not a well-formed migratable
 * record. The envelope is kept; the engine migrates the state.
 */
export function migrateMatchRecord(raw: unknown, fresh: Record<string, Card>): MatchRecord | null {
  const record = readMigratableRecord(raw);
  if (record === null) return null;
  const state = migrateGameState(record.state, record.version, fresh);
  return state === null ? null : { ...record, version: MATCH_RECORD_VERSION, state };
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
  // Most migratable versions need no catalog rows, and skip D1.
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
 * A record with the envelope `readMatchRecord` checks at any version, or `null`. It keeps its own
 * version, which the engine's migration branches on.
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

const migratableRecordSchema = matchRecordSchema(z.number(), storedStateSchema);

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

/** Who a match frame is for: a seated player, or a seatless spectator. */
export type MatchViewer = Seat | "spectator";

/** The side a spectator's board renders from. Every spectator sees the host's orientation; the
    seatless redaction withholds both hands either way. */
const SPECTATOR_SIDE = SEAT_OF_SLOT.host;

/**
 * The `match` frame `viewer` receives: the board redacted for their seat, or the seatless
 * redaction for a spectator, plus the shared seat-keyed log, which is leak-safe for every viewer.
 * With `logFrom`, the frame carries only the log entries from that index on.
 */
export function matchFrameFor(
  record: MatchRecord,
  viewer: MatchViewer,
  logFrom?: number,
): Extract<LobbyServerMessage, { kind: "match" }> {
  const game =
    viewer === "spectator"
      ? redactGame(record.state, SPECTATOR_SIDE, true)
      : redactGame(record.state, viewer);
  if (logFrom === undefined) return { kind: "match", game, log: record.log };
  return { kind: "match", game, log: record.log.slice(logFrom), logFrom };
}
