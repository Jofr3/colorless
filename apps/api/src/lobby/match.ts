// The lobby → engine handoff (docs/workstreams/backend-data.md §3.6). When a lobby's
// countdown ends with both players ready, the DO starts a real match: it instantiates the
// engine server-side and owns the RNG state and the hidden information. This module is the seam.
//
// The lobby has no p1/p2 concept — seats are "host"/"guest" — so the mapping to the
// engine's Seat is minted HERE, at match start: the host is p1, the guest is p2.
// Kept pure (no DO/storage/D1) so it unit-tests without a Worker: the DO loads the
// decks and card pool from D1, calls `beginMatch`, persists the record and sends each
// socket its `matchFrameFor` view. It is the only lobby module that imports the engine.

import {
  type CreateErrorCode,
  type CreateGameResult,
  type DrbgState,
  type GameAction,
  type GameEvent,
  type GameState,
  type InPlayPokemon,
  type Seat,
  applyAction,
  createGame,
  formatById,
  formatElapsed,
  freshRngState,
  GAME_STATE_VERSION,
  isRngState,
  logFromEvents,
  migrateGameState,
  type RngState,
  redactGame,
  SEATS,
  savedDeckReasons,
} from "@colorless/engine";
import type { Card, LobbyServerMessage, SeatLogEntry, WireAction } from "@colorless/schema";
import * as z from "zod";
import { slotOf } from "./logic";
import type { LobbyState } from "./snapshot";

export type { Seat };

/** A match's RNG: always a ChaCha20 state with a fresh 256-bit key. The type is the guard: a
    handoff cannot start a match on a guessable numeric seed. */
export type MatchRng = DrbgState;

/** The RNG a new match starts from, keyed from the platform CSPRNG. The key never leaves the DO:
    `matchFrameFor` sends only the redacted board and the log. */
export function freshMatchRng(): MatchRng {
  return freshRngState();
}

/** The one place the lobby's seats map to the engine's: host → p1, guest → p2. */
export const SEAT_OF_SLOT = { host: "p1", guest: "p2" } as const satisfies Record<
  "host" | "guest",
  Seat
>;

/** The engine seat whose REDACTED view the socket-holder `playerId` receives —
    host → p1, guest → p2 (SEAT_OF_SLOT), or null for a player not seated in this
    lobby (a refused/observer socket). The DO's per-viewer match broadcast keys
    each socket's redaction off this. */
export function matchSeatOf(snapshot: LobbyState, playerId: string): Seat | null {
  const slot = slotOf(snapshot, playerId);
  return slot === null ? null : SEAT_OF_SLOT[slot];
}

/** The lobby player holding engine `seat`, or null when that seat is empty. */
export function playerIdOfSeat(snapshot: LobbyState, seat: Seat): string | null {
  return seat === SEAT_OF_SLOT.host ? snapshot.host.id : (snapshot.guest?.id ?? null);
}

export interface StartMatchOptions {
  /** The authoritative RNG the DO owns for this match (shuffles and coin flips), from
      `freshMatchRng`. */
  seed: MatchRng;
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
  /** The RNG state the match was created from: the ChaCha20 state the DO minted, or the u32
      seed of an older match on the mulberry32 generator. Server-side only, like `state`. */
  seed: RngState;
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
 * Migrate an older record to this deploy's version, or `null` if it is not a well-formed migratable
 * record. The envelope is kept; the engine migrates the state. A state still on the mulberry32
 * generator (an older match) carries on under a fresh ChaCha20 key from `rekey`:
 * its 32-bit seed may already have been recovered from a player's opening hand, and nothing
 * replays an online match, so changing generator mid-match costs nothing. What the old seed already
 * decided (deck orders, Prizes) stays as dealt until the next shuffle.
 */
export function migrateMatchRecord(
  raw: unknown,
  rekey: () => MatchRng = freshMatchRng,
): MatchRecord | null {
  const record = readMigratableRecord(raw);
  if (record === null) return null;
  const migrated = migrateGameState(record.state, record.version);
  if (migrated === null) return null;
  const state =
    typeof migrated.rngState === "number" ? { ...migrated, rngState: rekey() } : migrated;
  return { ...record, version: MATCH_RECORD_VERSION, state };
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
 * back before it is returned; the record is never played unmigrated. A record at a retired version
 * (41 and older) is stale.
 */
export async function loadMatchRecord(slot: MatchSlot): Promise<MatchLoad> {
  const raw = await slot.get();
  if (raw === undefined) return { kind: "none" };
  const record = readMatchRecord(raw);
  if (record !== null) return { kind: "ok", record };
  const migrated = migrateMatchRecord(raw);
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

/** A generator state as a record may hold it: an older one's u32 seed state, or ChaCha20's. */
function isStoredRng(value: unknown): boolean {
  return (typeof value === "number" && Number.isFinite(value)) || isRngState(value);
}

/** The persisted `GameState`, checked only for the keys every reader touches first, and for a
    generator the next action can draw from: a corrupt one would refuse every action. */
const storedStateSchema = z.custom<GameState>(
  (value) =>
    isObject(value) &&
    isObject(value.phase) &&
    isObject(value.players) &&
    isStoredRng(value.rngState),
);

function matchRecordSchema(version: z.ZodType<number>, state: z.ZodType<GameState>) {
  return z.object({
    version,
    // An older record holds the u32 seed the DO minted, which can pass the int32 range.
    seed: z.custom<RngState>(isStoredRng),
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

/** The refusal for a move the online match will not run: an off-allowlist type, or one the engine
    threw on. It names nothing about the engine or the opponent. */
const UNAVAILABLE_MOVE_REASON = "That move isn't available here.";

/**
 * Apply a client action to a persisted match. The action is bound to the actor's own `seat`, never
 * the client-claimed one, gated to `SUPPORTED_MATCH_ACTIONS`, then run through the engine's total
 * `applyAction`. On accept returns the next record with the events logged at `now`; on reject
 * returns a `reason` and changes nothing. A throw out of the engine (a broken totality contract)
 * is a refusal too, carrying the caught `thrown` for the caller to log.
 */
export type MatchActionOutcome =
  | { ok: true; record: MatchRecord; logTrimmed: boolean }
  | { ok: false; reason: string; thrown?: unknown };

/**
 * The most log rows a match keeps. A legal repeatable ability (Solar Transfer moves one
 * Energy as often as you like) appends rows without end, and every reconnect is sent
 * the whole log. A real game logs a few hundred rows.
 */
export const MATCH_LOG_MAX = 2000;

/** The rows kept when the log passes `MATCH_LOG_MAX`, so it is trimmed once per 500 new rows and
    not on every action after. */
export const MATCH_LOG_KEPT = 1500;

/** The row a trimmed log starts with, in place of the rows dropped. */
export function logTrimmedRow(elapsed: string): SeatLogEntry {
  return {
    kind: "action",
    who: "system",
    elapsed,
    segments: [{ text: "Earlier log entries were trimmed." }],
  };
}

/** `log` within `MATCH_LOG_MAX` rows: as it is, or its newest `MATCH_LOG_KEPT` after a
    trimmed row. */
export function capLog(
  log: SeatLogEntry[],
  elapsed: string,
): { log: SeatLogEntry[]; trimmed: boolean } {
  if (log.length <= MATCH_LOG_MAX) return { log, trimmed: false };
  return { log: [logTrimmedRow(elapsed), ...log.slice(-MATCH_LOG_KEPT)], trimmed: true };
}

export function applyMatchAction(
  record: MatchRecord,
  seat: Seat,
  action: WireAction,
  now: number,
): MatchActionOutcome {
  // Off-allowlist types never reach the engine (the soft-lock gate) — a generic
  // reason, since there is no engine message to quote.
  if (!SUPPORTED_MATCH_ACTIONS.has(action.type)) {
    return { ok: false, reason: UNAVAILABLE_MOVE_REASON };
  }
  // The engine is meant to be total, but a crafted frame can still throw out of it. Nothing is
  // persisted before this returns, so a throw is refused like an off-allowlist move instead of
  // escaping `webSocketMessage` and leaving the actor without a reply.
  try {
    return engineOutcome(record, seat, action, now);
  } catch (thrown) {
    return { ok: false, reason: UNAVAILABLE_MOVE_REASON, thrown };
  }
}

function engineOutcome(
  record: MatchRecord,
  seat: Seat,
  action: WireAction,
  now: number,
): MatchActionOutcome {
  const result = applyAction(record.state, { ...action, seat } as GameAction);
  // The engine's own rejection message is safe to surface: it describes the
  // ACTOR's own illegal move / wrong phase, never the opponent's hidden zones.
  if (!result.ok) return { ok: false, reason: result.error.message };
  // Format the accepted events into log rows (leak-safe: counts for hidden draws,
  // names off public state) and append. The log grows; seed/startedAt/names ride on.
  const elapsed = formatElapsed(now - record.startedAt);
  const entries = logFromEvents(result.events, {
    names: record.names,
    state: result.state,
    elapsed,
  });
  // A trimmed log does not continue the one sockets hold, so the caller sends it whole.
  const { log, trimmed } = capLog([...record.log, ...entries], elapsed);
  return { ok: true, record: { ...record, state: result.state, log }, logTrimmed: trimmed };
}

/**
 * The `match` frame `viewer`'s seat receives: the board redacted for that seat, plus the shared
 * seat-keyed log, which is leak-safe for either seat. With `logFrom`, the frame carries only the
 * log entries from that index on.
 */
export function matchFrameFor(
  record: MatchRecord,
  viewer: Seat,
  logFrom?: number,
): Extract<LobbyServerMessage, { kind: "match" }> {
  const game = redactGame(record.state, viewer);
  if (logFrom === undefined) return { kind: "match", game, log: record.log };
  return { kind: "match", game, log: record.log.slice(logFrom), logFrom };
}

// What every accepted action keeps, checked by the lobby before it persists the result: the cards
// only move, and the game keeps its generator. The engine is meant to keep both; a break is an
// engine bug, and the match is retired rather than played on from a board that lost a card.

function bodyUids(pokemon: InPlayPokemon | null): string[] {
  return pokemon === null ? [] : [...pokemon.stack, ...pokemon.energy, ...pokemon.tools];
}

/** Every card uid in a zone of `state`, in no particular order. */
export function zoneUids(state: GameState): string[] {
  const uids = SEATS.flatMap((seat) => {
    const side = state.players[seat];
    return [
      ...side.deck,
      ...side.hand,
      ...side.discard,
      ...side.prizes,
      ...bodyUids(side.active),
      ...side.bench.flatMap(bodyUids),
    ];
  });
  if (state.stadium !== null) uids.push(state.stadium.uid);
  return uids;
}

/** The first rule `after` breaks against `before`, the state it was applied to, or null. The
    text names no card, seat or player, so it can go in a log line as it is. */
export function matchViolation(before: GameState, after: GameState): string | null {
  const was = zoneUids(before);
  const now = zoneUids(after);
  const held = new Set(now);
  if (held.size !== now.length) return "a card is in two zones";
  if (now.length !== was.length || !was.every((uid) => held.has(uid)))
    return "a card was lost or minted";
  if (!isRngState(after.rngState) || typeof after.rngState !== typeof before.rngState) {
    return "the game left its generator";
  }
  return null;
}
