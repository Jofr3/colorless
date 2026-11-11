import {
  engineVersion,
  isRngState,
  redactGame,
  type GameState,
  type Seat,
} from "@colorless/engine";
import { readPersisted, removePersisted, writePersisted } from "../lib/persistedState";
import {
  positionOf,
  replayHost,
  restorePosition,
  type HostPosition,
  type HostState,
  type LocalAction,
} from "./localHost";
import { SAVE_VERSION, SIMULATOR_SAVE_KEY } from "./simulatorSaveKey";

/** The save is where the match began plus the accepted actions of its current
    line of play; loading replays them. The starting state carries the card
    pool, so restoring never refetches decks or re-deals their cards. */
interface SaveRecord {
  version: number;
  engineVersion: string;
  names: Record<Seat, string>;
  startedAt: number;
  origin: HostState["origin"];
  actions: LocalAction[];
  position: HostPosition;
  /** Of the board at the end of `actions`: a replay that ends anywhere else is refused. */
  fingerprint: string;
}

// The start of a save never changes during a match, so it is encoded once.
const heads = new WeakMap<HostState["origin"], string>();
const fingerprints = new WeakMap<GameState, string>();

/** Writes the save; false when it was not stored. */
export function saveSimulator(host: HostState): boolean {
  let head = heads.get(host.origin);
  if (head === undefined) {
    const start: Omit<SaveRecord, "actions" | "position" | "fingerprint"> = {
      version: SAVE_VERSION,
      engineVersion,
      names: host.names,
      startedAt: host.startedAt,
      origin: host.origin,
    };
    head = JSON.stringify(start).slice(0, -1);
    heads.set(host.origin, head);
  }
  const rest: Pick<SaveRecord, "actions" | "position" | "fingerprint"> = {
    actions: host.actions,
    position: positionOf(host),
    fingerprint: fingerprintOf(host.latestTurn.game),
  };
  lastLoad = null;
  const stored = writePersisted(SIMULATOR_SAVE_KEY, `${head},${JSON.stringify(rest).slice(1)}`);
  // A write that did not stick leaves the save before it. An earlier point of this match is still
  // worth resuming; another match's is one the player left, which a reload must not bring back.
  // With two tabs on the simulator, the other tab's match counts as another match.
  const ownMatch = (raw: string) => raw.startsWith(`${head},`);
  if (!stored && !readPersisted(SIMULATOR_SAVE_KEY, ownMatch, true)) {
    removePersisted(SIMULATOR_SAVE_KEY);
  }
  return stored;
}

export function clearSimulatorSave(): void {
  lastLoad = null;
  removePersisted(SIMULATOR_SAVE_KEY);
}

// Resuming checks for a save and then opens it; the open reuses that replay.
let lastLoad: { raw: string; host: HostState | undefined } | null = null;

/** The saved match, replayed to where it was left; null when there is none
    or it cannot be trusted. */
export function loadSimulatorSave(): HostState | null {
  return readPersisted(
    SIMULATOR_SAVE_KEY,
    (raw) => {
      if (lastLoad?.raw !== raw) lastLoad = { raw, host: parseSave(raw) };
      return lastLoad.host;
    },
    null,
  );
}

function parseSave(raw: string): HostState | undefined {
  const record = JSON.parse(raw) as Partial<SaveRecord> | null;
  // Engine changes can alter what an action does as well as board fields.
  // Never replay a line recorded by another rules implementation.
  if (record?.version !== SAVE_VERSION || record.engineVersion !== engineVersion) return;
  const { names, startedAt, origin, actions, position } = record;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return;
  if (typeof names?.p1 !== "string" || typeof names?.p2 !== "string") return;
  if (!origin || !Array.isArray(origin.log) || !isSeat(origin.viewerSeat)) return;
  if (!validState(origin.game)) return;
  if (!Array.isArray(actions) || !actions.every(validAction)) return;
  if (!position || ![position.cursor, position.stepIndex, position.turnIndex].every(isIndex))
    return;
  const line = replayHost(
    {
      state: origin.game,
      events: [],
      names,
      startedAt,
      resume: { log: origin.log, viewerSeat: origin.viewerSeat },
    },
    actions,
  );
  if (!line || fingerprintOf(line.latestTurn.game) !== record.fingerprint) return;
  const host = restorePosition(line, position);
  if (!host || !validState(host.game)) return;
  return host;
}

const isSeat = (seat: unknown): seat is Seat => seat === "p1" || seat === "p2";
const isIndex = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

function validAction(entry: LocalAction): boolean {
  return (
    typeof entry?.action?.type === "string" &&
    typeof entry.at === "number" &&
    Number.isFinite(entry.at) &&
    (entry.auto === undefined || entry.auto === "setup:drawExtra" || entry.auto === "ko:takePrizes")
  );
}

function validState(state: GameState): boolean {
  if (
    !state ||
    !Number.isInteger(state.turn) ||
    // A legacy save carries a mulberry32 number and replays on it; any other carries a
    // ChaCha20 state. Either replays only under the generator it was recorded with.
    !isRngState(state.rngState) ||
    !state.phase ||
    !state.cardPool ||
    !state.cardIdByUid ||
    !Array.isArray(state.pending)
  )
    return false;
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players?.[seat];
    if (
      !side ||
      ![side.hand, side.deck, side.discard, side.prizes, side.bench].every(Array.isArray)
    )
      return false;
    // These are the same reads the board will make after restore. Malformed
    // snapshots throw here and readPersisted falls back to the deck picker.
    redactGame(state, seat);
  }
  return true;
}

/** A hash of the board without its card pool. Keys are sorted: a state read
    back from JSON can order them differently from the live one. */
function fingerprintOf(game: GameState): string {
  let hash = fingerprints.get(game);
  if (hash === undefined) {
    hash = hashText(canonical({ ...game, cardPool: undefined, cardIdByUid: undefined }));
    fingerprints.set(game, hash);
  }
  return hash;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v ?? null)).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** cyrb53: a fast 53-bit string hash. */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
