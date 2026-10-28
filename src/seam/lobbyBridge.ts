// The lobby seam: the real web client (channel, LobbyClient, the Lua online adapters) joined to the
// real LobbyDO on the api's fake Durable Object runtime. Every socket a tab's channel opens reaches
// the DO through a BridgeSocket, which delivers each way a task later, answers pings as the
// runtime's auto-response does, and can lose its path without a close (a half-open link). Delivery
// into the DO is serialized, as one instance handles one event at a time. Time is vitest's fake
// clock, which the DO reads too, and `run` fires the DO's alarm when it comes due. Not a test file
// itself; `tsconfig.seam.json` typechecks this directory with both the DOM and the Workers types.

import { drbgSeed } from "@colorless/engine/testing";
import {
  createLobbyHarness,
  type FakeSocket,
  LEGAL_DECK,
  type LobbyHarness,
  type LobbyWorld,
  resetLogThrottle,
  seatSecret,
} from "@colorless/api/testing/lobbyHarness";
import { LOBBY_WS_PING, LOBBY_WS_PONG } from "@colorless/schema";
import { vi } from "vitest";
import { createLobbyChannel } from "../online/channel";
import { LobbyClient, type LobbyClientOptions } from "../online/lobbyClient";
import { LuaOnline } from "../lua/online";
import { LuaOnlineMatch } from "../lua/onlineTable";

export const SEAM_CODE = "ABCD";

/** One browser tab: the account its cookie upgrades a socket as (undefined when signed out),
    whether its network is down (a new socket fails to connect), how long a new socket takes to
    reach the DO (a slow cold start), and every socket its channels opened, oldest first. */
export type Tab = {
  user: string | undefined;
  offline: boolean;
  connectDelayMs: number;
  readonly sockets: BridgeSocket[];
};

/** The client end of one lobby socket, as `createLobbyChannel` drives a WebSocket. Frames the
    server sent before it closed still arrive, ahead of the close. */
export class BridgeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  /** The DO's end, once the upgrade is accepted. */
  server: FakeSocket | null = null;
  /** The path is dead without a close either way: nothing crosses it any more. */
  blackholed = false;
  readonly user: string | undefined;
  /** The client closed this end: nothing reaches it any more. */
  private clientClosed = false;
  /** The server end closed, or never opened. */
  private serverClosed = false;

  constructor(
    private readonly seam: Bridge,
    tab: Tab,
  ) {
    this.user = tab.user;
    const offline = tab.offline;
    const upgrade = () =>
      seam.deliver(async () => {
        try {
          if (offline) throw new Error("offline");
          const server = await seam.h.connect(this.user);
          // Closed by the client while it connected: the server end goes as the close reaches it.
          if (this.clientClosed) return await seam.h.drop(server);
          this.server = server;
          const send = server.send.bind(server);
          server.send = (data: string) => {
            send(data);
            this.toClient(() => this.onmessage?.({ data }));
          };
          const close = server.close.bind(server);
          server.close = (code?: number, reason?: string) => {
            close(code, reason);
            if (this.serverClosed) return;
            this.serverClosed = true;
            this.toClient(() => this.onclose?.({ code: code ?? 1005 }));
          };
          this.toClient(() => this.onopen?.());
        } catch {
          this.serverClosed = true;
          this.toClient(() => this.onclose?.({ code: 1006 }));
        }
      });
    if (tab.connectDelayMs > 0) setTimeout(upgrade, tab.connectDelayMs);
    else upgrade();
  }

  send(data: string): void {
    const server = this.server;
    if (this.clientClosed || this.serverClosed || this.blackholed || server === null) return;
    if (data === LOBBY_WS_PING) {
      server.lastPong = new Date(Date.now());
      this.toClient(() => this.onmessage?.({ data: LOBBY_WS_PONG }));
      return;
    }
    this.seam.deliver(() => this.seam.h.send(server, data));
  }

  close(code?: number): void {
    if (this.clientClosed) return;
    this.clientClosed = true;
    const server = this.server;
    if (!this.blackholed && server !== null && server.closed === null)
      this.seam.deliver(() => this.seam.h.drop(server));
    queueMicrotask(() => this.onclose?.({ code: code ?? 1005 }));
  }

  /** Run `event` on the client a task later, unless the path is dead or the client closed by then. */
  private toClient(event: () => void): void {
    if (this.blackholed) return;
    queueMicrotask(() => {
      if (!this.blackholed && !this.clientClosed) event();
    });
  }
}

/** One tab's Lua online modal, its routes and published snapshots, and the table it opens. */
export type OnlineTab = Tab & {
  readonly online: LuaOnline;
  readonly route: ReturnType<typeof vi.fn<(page: string, id: string, replace: boolean) => void>>;
  readonly publish: ReturnType<typeof vi.fn<(snapshot: string) => void>>;
  /** The live match as the table takes it, or null when there is none to take. */
  table(): LuaOnlineMatch | null;
  /** The client the modal holds. */
  client(): LobbyClient;
};

export type Bridge = {
  readonly h: LobbyHarness;
  /** Queue `work` on the DO, after everything delivered before it. */
  deliver(work: () => Promise<void>): void;
  /** A tab signed in as `user`, or signed out. */
  tab(user: string | undefined): Tab;
  /** A LobbyClient whose channel opens its sockets from `tab`. */
  client(tab: Tab, opts: LobbyClientOptions): LobbyClient;
  /** A tab holding a Lua online modal on the seam's lobby, opened as `label` in `role` with the
      seat secret `seatSecret(label)`, announcing `name` (the label by default). */
  online(tab: Tab, role: "host" | "guest", label: string, name?: string): Promise<OnlineTab>;
  /** Let `ms` of fake time pass in 100ms steps, settling every delivery and due alarm. */
  run(ms: number): Promise<void>;
  /** Settle the deliveries and microtasks pending now, without moving the clock. */
  settle(): Promise<void>;
  /** Restore the clock and the globals, then fail on any frame the DO sent off the wire schema. */
  dispose(): void;
};

/** The lobby `SEAM_CODE` on a fresh DO whose clock is the fake timers', with two accounts, ana and
    bo, each holding a legal deck. */
export async function openBridge(world: Partial<LobbyWorld> = {}): Promise<Bridge> {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Reconnect delays at the middle of their jitter, so runs repeat exactly.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const stores = { session: memoryStore(), local: memoryStore() };
  vi.stubGlobal("sessionStorage", stores.session);
  vi.stubGlobal("localStorage", stores.local);
  const h = createLobbyHarness({
    seed: drbgSeed(42),
    decks: new Map([
      ["deck-ana", { owner: "ana", ids: [...LEGAL_DECK] }],
      ["deck-bo", { owner: "bo", ids: [...LEGAL_DECK] }],
    ]),
    ...world,
  });
  Object.defineProperty(h.world, "now", {
    get: () => Date.now(),
    set: () => {},
    configurable: true,
  });
  let queue: Promise<void> = Promise.resolve();
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await queue;
      await Promise.resolve();
    }
  };
  const bridge: Bridge = {
    h,
    deliver(work) {
      queue = queue.then(work).catch(() => {});
    },
    tab: (user) => ({ user, offline: false, connectDelayMs: 0, sockets: [] }),
    client(tab, opts) {
      let client: LobbyClient | null = null;
      const channel = createLobbyChannel(opts.code, {
        onLobbyClosed: () => client?.lobbyClosed(),
        openSocket: () => {
          const socket = new BridgeSocket(bridge, tab);
          tab.sockets.push(socket);
          return socket as unknown as WebSocket;
        },
      });
      client = new LobbyClient(opts, { channel });
      return client;
    },
    async online(tab, role, label, name = label) {
      const route = vi.fn<(page: string, id: string, replace: boolean) => void>();
      const publish = vi.fn<(snapshot: string) => void>();
      const online = new LuaOnline(publish, route, {
        client: (opts) => bridge.client(tab, opts),
        cards: async (ids) => ({
          pool: Object.fromEntries(
            ids.flatMap((id) => (h.world.pool[id] ? [[id, h.world.pool[id]]] : [])),
          ),
        }),
      });
      // The seat this tab staked when it created or joined the lobby, as its sessionStorage holds.
      stores.session.setItem(
        `online.identity.${SEAM_CODE}`,
        JSON.stringify({ secret: seatSecret(label), role, name }),
      );
      await online.command(`open\t${SEAM_CODE}`);
      const client = () => {
        if (online.client === null) throw new Error(`${label} holds no lobby client`);
        return online.client;
      };
      return Object.assign(tab, {
        online,
        route,
        publish,
        client,
        table: () => online.matchSource(SEAM_CODE, LuaOnlineMatch),
      });
    },
    async run(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        vi.advanceTimersByTime(100);
        await settle();
        const at = h.storage.alarm;
        if (at !== null && at <= Date.now()) {
          h.storage.alarm = null;
          bridge.deliver(() => h.lobby.alarm());
          await settle();
        }
      }
    },
    settle,
    dispose() {
      vi.useRealTimers();
      resetLogThrottle();
      h.dispose();
    },
  };
  await h.create(SEAM_CODE);
  return bridge;
}

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
