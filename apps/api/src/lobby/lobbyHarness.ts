// A fake Durable Object runtime for driving `LobbyDO` in Node tests: Map-backed storage with one
// alarm, hibernation sockets with attachments and keepalive timestamps, and the Workers globals
// the DO constructs (`WebSocketPair`, `WebSocketRequestResponsePair`, a `Response` that accepts a
// 101 upgrade). `createLobbyHarness` installs the globals and `dispose` restores them.

import { drbgSeed } from "@colorless/engine/testing";
import type { Card, LobbyClientMessage, LobbyServerMessage } from "@colorless/schema";
import type { Env } from "../env";
import type { LoadDeckResult } from "./deckLoad";
import { DO_CREATE_PATH, DO_WS_PATH, doUrl, LOBBY_CODE_HEADER } from "./doProtocol";
import { type LobbyDeps, LobbyDO } from "./lobbyDO";
import type { MatchRng } from "./match";

/** The server end of an accepted lobby socket, recording every frame the DO sends it. */
export class FakeSocket {
  readonly sent: LobbyServerMessage[] = [];
  closed: { code: number | undefined; reason: string | undefined } | null = null;
  /** The last auto-answered keepalive, or null before the first. When null on a socket whose
      client `pings`, the runtime reads as having just answered one. */
  lastPong: Date | null = null;
  /** Whether the client keeps pinging, as the web client does every 1.5s. A test of a silent
      socket pins `lastPong`, or clears this for a client that never pinged at all. */
  pings = true;
  private attachment: unknown = null;

  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }

  send(data: string): void {
    if (this.closed !== null) throw new Error("socket is closed");
    this.sent.push(JSON.parse(data) as LobbyServerMessage);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  /** Every frame of `kind` received, oldest first. */
  framesOf<K extends LobbyServerMessage["kind"]>(
    kind: K,
  ): Extract<LobbyServerMessage, { kind: K }>[] {
    return this.sent.filter(
      (frame): frame is Extract<LobbyServerMessage, { kind: K }> => frame.kind === kind,
    );
  }

  /** The newest frame of `kind`, or undefined. */
  last<K extends LobbyServerMessage["kind"]>(
    kind: K,
  ): Extract<LobbyServerMessage, { kind: K }> | undefined {
    return this.framesOf(kind).at(-1);
  }
}

/** Durable Object storage over a Map. Values are structured-cloned in and out, as the runtime's
    are, so a caller mutating a value after `put` does not reach the stored copy. */
export class FakeStorage {
  readonly data = new Map<string, unknown>();
  alarm: number | null = null;

  async get(key: string): Promise<unknown>;
  async get(keys: string[]): Promise<Map<string, unknown>>;
  async get(keys: string | string[]): Promise<unknown> {
    if (typeof keys === "string") return this.read(keys);
    const found = new Map<string, unknown>();
    for (const key of keys) if (this.data.has(key)) found.set(key, this.read(key));
    return found;
  }

  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    const entries =
      typeof keyOrEntries === "string" ? { [keyOrEntries]: value } : { ...keyOrEntries };
    for (const [key, item] of Object.entries(entries)) this.data.set(key, structuredClone(item));
  }

  async delete(key: string): Promise<boolean>;
  async delete(keys: string[]): Promise<number>;
  async delete(keys: string | string[]): Promise<boolean | number> {
    if (typeof keys === "string") return this.data.delete(keys);
    return keys.filter((key) => this.data.delete(key)).length;
  }

  /** Every entry under `prefix`, in key order, as the runtime lists them. */
  async list({ prefix = "" }: { prefix?: string } = {}): Promise<Map<string, unknown>> {
    const keys = [...this.data.keys()].filter((key) => key.startsWith(prefix)).sort();
    return new Map(keys.map((key) => [key, this.read(key)]));
  }

  private read(key: string): unknown {
    const value = this.data.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  /** Leaves the alarm in place, as the runtime does. */
  async deleteAll(): Promise<void> {
    this.data.clear();
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(at: number | Date): Promise<void> {
    this.alarm = typeof at === "number" ? at : at.getTime();
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

/** The `DurableObjectState` surface the lobby uses. */
export class FakeState {
  readonly storage = new FakeStorage();
  readonly sockets: FakeSocket[] = [];
  autoResponse: { request: string; response: string } | null = null;

  /** `clock` is the epoch ms a pinging socket's latest keepalive reads as answered at. */
  constructor(private readonly clock: () => number = Date.now) {}

  acceptWebSocket(ws: FakeSocket): void {
    this.sockets.push(ws);
  }

  getWebSockets(): FakeSocket[] {
    return this.sockets.filter((ws) => ws.closed === null);
  }

  setWebSocketAutoResponse(pair: FakeRequestResponsePair): void {
    this.autoResponse = { request: pair.request, response: pair.response };
  }

  getWebSocketAutoResponseTimestamp(ws: FakeSocket): Date | null {
    return ws.lastPong ?? (ws.pings ? new Date(this.clock()) : null);
  }
}

class FakeWebSocketPair {
  readonly 0 = new FakeSocket();
  readonly 1 = new FakeSocket();
}

class FakeRequestResponsePair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}

/** Node's `Response` rejects status 101; the Workers one carries the client socket with it. */
function upgradeAwareResponse(Base: typeof Response): typeof Response {
  return class WorkerResponse extends Base {
    override readonly webSocket: WebSocket | null;
    private readonly upgradeStatus: number | null;

    constructor(body?: BodyInit | null, init?: ResponseInit) {
      const upgrade = init?.status === 101;
      super(body, upgrade ? { ...init, status: 200 } : init);
      this.upgradeStatus = upgrade ? 101 : null;
      this.webSocket = init?.webSocket ?? null;
    }

    override get status(): number {
      return this.upgradeStatus ?? super.status;
    }
  } as typeof Response;
}

/** Install the Workers globals the DO constructs; the returned function restores the originals. */
function installWorkerGlobals(): () => void {
  const globals = globalThis as Record<string, unknown>;
  const replaced = {
    WebSocketPair: FakeWebSocketPair,
    WebSocketRequestResponsePair: FakeRequestResponsePair,
    Response: upgradeAwareResponse(Response),
  };
  const saved = Object.keys(replaced).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(replaced)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) delete globals[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  };
}

/** The outside world the fake deps answer from. Every field may be changed mid-test. */
export interface LobbyWorld {
  /** Epoch ms the DO reads as now. */
  now: number;
  /** The RNG the next handoff mints (`drbgSeed(n)` for a fixed one). */
  seed: MatchRng;
  /** userId → account display name. */
  displayNames: Map<string, string>;
  /** deckId → its owner, flat card ids and format (absent reads as none picked). */
  decks: Map<string, { owner: string; ids: string[]; format?: string | null }>;
  /** Every card the fake catalog holds. */
  pool: Record<string, Card>;
  /** Session ids that have since ended (logged out, expired or revoked). */
  endedSessions: Set<string>;
}

/** The session id the fake deps give `userId`'s cookie. */
export function sessionIdOf(userId: string): string {
  return `session-of-${userId}`;
}

/** The fake deps over `world`: a socket's cookie `session=<userId>` authenticates as `userId`
    under `sessionIdOf(userId)`, and a deck resolves only for its owner while that session lives,
    as the D1 reads do. Decks keep their order, so a seeded match deals as `createGame` does. */
export function worldDeps(world: LobbyWorld): LobbyDeps {
  return {
    now: () => world.now,
    randomSeed: () => world.seed,
    shuffleDeck: (ids) => [...ids],
    resolveAccount: async (cookie) => {
      const userId = cookie?.match(/^session=(.+)$/)?.[1];
      return userId === undefined
        ? null
        : {
            userId,
            sessionId: sessionIdOf(userId),
            displayName: world.displayNames.get(userId) ?? null,
          };
    },
    loadDeck: async (deckId, owner): Promise<LoadDeckResult> => {
      if (owner === null)
        return { ok: false, reason: "you must be signed in to play a saved deck" };
      if (deckId === null) return { ok: false, reason: "no deck selected" };
      const deck = world.decks.get(deckId);
      if (deck === undefined || deck.owner !== owner.userId)
        return { ok: false, reason: "deck not found" };
      if (world.endedSessions.has(owner.sessionId))
        return { ok: false, reason: "sign in again to play a saved deck" };
      return { ok: true, ids: [...deck.ids], format: deck.format ?? null };
    },
    loadPool: async (ids) => {
      const pool: Record<string, Card> = {};
      for (const id of ids) {
        const card = world.pool[id];
        if (card !== undefined) pool[id] = card;
      }
      return pool;
    },
  };
}

/** A minimal Basic Pokémon. */
export function basicCard(id: string): Card {
  return {
    id,
    setId: "test",
    localId: "1",
    name: id,
    category: "Pokemon",
    image: null,
    illustrator: null,
    rarity: null,
    regulationMark: null,
    hp: 60,
    stage: "Basic",
    evolveFrom: null,
    types: ["Colorless"],
    retreat: 1,
    abilities: null,
    attacks: null,
    weaknesses: null,
    resistances: null,
    trainerType: null,
    energyType: null,
    effect: null,
    legal: { standard: true, expanded: true },
    variants: null,
  };
}

/** Fifteen Basics, the default catalog. */
const LEGAL_POOL: Record<string, Card> = Object.fromEntries(
  Array.from({ length: 15 }, (_, i) => [`basic-${i}`, basicCard(`basic-${i}`)]),
);

/** Four copies of each default Basic: a Standard-legal deck. */
export const LEGAL_DECK: readonly string[] = Object.keys(LEGAL_POOL).flatMap((id) => [
  id,
  id,
  id,
  id,
]);

export interface LobbyHarness {
  /** The current instance; `hibernate` replaces it. */
  readonly lobby: LobbyDO;
  readonly state: FakeState;
  readonly storage: FakeStorage;
  readonly world: LobbyWorld;
  /** The deps every instance is woken with. Replacing one of its functions reaches the current
      instance and every later one, e.g. to hold a D1 read open or make it fail. */
  readonly deps: LobbyDeps;
  /** POST /create for `code`. */
  create(code?: string): Promise<Response>;
  /** GET /ws, optionally signed in as `userId`; resolves to the accepted server socket. */
  connect(userId?: string): Promise<FakeSocket>;
  /** Deliver one client frame (or raw text) to the DO. */
  send(ws: FakeSocket, frame: LobbyClientMessage | string): Promise<void>;
  /** The client went away without a bye: the socket closes and the DO hears of it. */
  drop(ws: FakeSocket): Promise<void>;
  /** Move the clock to the pending alarm and run it, as the runtime does. */
  fireAlarm(): Promise<void>;
  /** Evict the instance and wake a fresh one on the same storage and sockets, as hibernation
      does: only what storage and the socket attachments hold survives. */
  hibernate(): void;
  /** Restore the globals `createLobbyHarness` replaced. */
  dispose(): void;
}

/** A fresh lobby DO on fake state, with the Workers globals installed until `dispose`. */
export function createLobbyHarness(world: Partial<LobbyWorld> = {}): LobbyHarness {
  const restore = installWorkerGlobals();
  const fullWorld: LobbyWorld = {
    now: 1_000_000,
    seed: drbgSeed(1),
    displayNames: new Map(),
    decks: new Map(),
    pool: { ...LEGAL_POOL, basic: basicCard("basic") },
    endedSessions: new Set(),
    ...world,
  };
  const state = new FakeState(() => fullWorld.now);
  const deps = worldDeps(fullWorld);
  const wake = () => new LobbyDO(state as unknown as DurableObjectState, {} as Env, deps);
  let lobby = wake();
  const socket = (ws: FakeSocket) => ws as unknown as WebSocket;

  return {
    get lobby() {
      return lobby;
    },
    state,
    storage: state.storage,
    world: fullWorld,
    deps,
    create: (code = "ABCD") =>
      lobby.fetch(
        new Request(doUrl(DO_CREATE_PATH), {
          method: "POST",
          headers: { [LOBBY_CODE_HEADER]: code },
        }),
      ),
    async connect(userId) {
      const headers: Record<string, string> = { Upgrade: "websocket" };
      if (userId !== undefined) headers.Cookie = `session=${userId}`;
      const before = state.sockets.length;
      const response = await lobby.fetch(new Request(doUrl(DO_WS_PATH), { headers }));
      const accepted = state.sockets[before];
      if (response.status !== 101 || accepted === undefined) {
        throw new Error(`upgrade refused with ${response.status}`);
      }
      return accepted;
    },
    send: (ws, frame) =>
      lobby.webSocketMessage(socket(ws), typeof frame === "string" ? frame : JSON.stringify(frame)),
    async drop(ws) {
      ws.close(1006, "gone");
      await lobby.webSocketClose(socket(ws));
    },
    async fireAlarm() {
      const at = state.storage.alarm;
      if (at === null) throw new Error("no alarm is set");
      state.storage.alarm = null;
      fullWorld.now = Math.max(fullWorld.now, at);
      await lobby.alarm();
    },
    hibernate() {
      lobby = wake();
    },
    dispose: restore,
  };
}
