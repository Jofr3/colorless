import { drbgSeed } from "@colorless/engine/testing";
import type { LobbyClientMessage } from "@colorless/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLogThrottle } from "../http/log";
import { attachedPlayer } from "./attachment";
import {
  createLobbyHarness,
  type FakeSocket,
  LEGAL_DECK,
  type LobbyHarness,
  seatIdOf,
  seatSecret,
} from "./lobbyHarness";
import { readSnapshot } from "./logic";
import { readMatchRecord } from "./match";
import { MatchStore } from "./matchStore";

// Seeded random lobby lifecycles: two players whose tabs open, drop, say hello, pick decks, ready,
// concede, leave and rematch, while alarms fire, time passes and the instance hibernates or is
// redeployed. The lobby's invariants are checked after every step.

const SEEDS = 20;
const STEPS = 300;

/** A small seeded generator in [0, 1). */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPS = [
  "open",
  "open",
  "open",
  "open",
  "drop",
  "bye",
  "deck",
  "ready",
  "ready",
  "unready",
  "concede",
  "rematch",
  "alarm",
  "alarm",
  "alarm",
  "time",
  "hibernate",
  "redeploy",
] as const;

type Player = { label: "h" | "g"; user: string; deck: string; ws: FakeSocket | null };

let h: LobbyHarness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
  vi.restoreAllMocks();
  resetLogThrottle();
});

/** The first invariant `seed`'s lifecycle breaks, with the steps that led there, or null. */
async function lifecycle(seed: number): Promise<string | null> {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const lobby = createLobbyHarness({
    seed: drbgSeed(seed),
    decks: new Map([
      ["deck-ana", { owner: "ana", ids: [...LEGAL_DECK] }],
      ["deck-bo", { owner: "bo", ids: [...LEGAL_DECK] }],
    ]),
  });
  h = lobby;
  const random = generator(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  await lobby.create();
  const players: Player[] = [
    { label: "h", user: "ana", deck: "deck-ana", ws: null },
    { label: "g", user: "bo", deck: "deck-bo", ws: null },
  ];
  const trace: string[] = [];
  const broke = (why: string) => `seed ${seed}: ${why} after ${trace.slice(-8).join(" ")}`;
  /** Alarms fired while each seat showed connected with no socket and no grace. */
  const orphanedFor = new Map<string, number>();
  const send = async (p: Player, frame: LobbyClientMessage) => {
    if (p.ws !== null && p.ws.closed === null) await lobby.send(p.ws, frame);
  };
  for (let step = 0; step < STEPS; step++) {
    const p = pick(players);
    const op = pick(OPS);
    trace.push(`${p.label}:${op}`);
    const from = seatIdOf(p.label);
    try {
      if (op === "open" && (p.ws === null || p.ws.closed !== null)) {
        p.ws = await lobby.connect(p.user);
        await send(p, { kind: "hello", from: seatSecret(p.label), name: p.label });
      } else if (op === "drop" && p.ws !== null && p.ws.closed === null) await lobby.drop(p.ws);
      else if (op === "bye")
        await send(p, { kind: "bye", from, slot: p.label === "h" ? "host" : "guest" });
      else if (op === "deck") {
        const intent = { type: "select-deck", deckId: p.deck, deckName: p.deck } as const;
        await send(p, { kind: "intent", from, intent });
      } else if (op === "ready" || op === "unready") {
        const intent = { type: "set-ready", ready: op === "ready" } as const;
        await send(p, { kind: "intent", from, intent });
      } else if (op === "concede") await send(p, { kind: "action", action: { type: "concede" } });
      else if (op === "rematch") await send(p, { kind: "rematch", from });
      // With no socket left the next alarm may wipe the lobby, ending the run early; it is left
      // for a step that has one.
      else if (
        op === "alarm" &&
        lobby.storage.alarm !== null &&
        lobby.state.getWebSockets().length > 0
      ) {
        await lobby.fireAlarm();
        for (const [id, alarms] of orphanedFor) orphanedFor.set(id, alarms + 1);
      } else if (op === "time") lobby.world.now += Math.floor(random() * 20_000);
      else if (op === "hibernate") lobby.hibernate();
      else if (op === "redeploy") lobby.redeploy();
    } catch (error) {
      // A connect to a lobby that expired is refused: the lifecycle is over.
      if (String(error).includes("404")) return null;
      return broke(`a step threw ${String(error)}`);
    }

    const snapshot = readSnapshot(await lobby.storage.get("snapshot"));
    if (snapshot === null) continue;
    const record = readMatchRecord(await new MatchStore(lobby.storage).get());
    if (snapshot.phase === "in-game" && record === null) return broke("in-game without a match");
    if (snapshot.phase !== "in-game" && record !== null) return broke("a match outside in-game");
    const live = lobby.state.getWebSockets();
    if (live.length > 0 && lobby.storage.alarm === null) return broke("a live socket and no alarm");
    const pending = ((await lobby.storage.get("pendingDisconnects")) ?? []) as {
      playerId: string;
    }[];
    for (const seat of [snapshot.host, snapshot.guest]) {
      if (seat === null) continue;
      const held = live.some((ws) => attachedPlayer(ws as unknown as WebSocket) === seat.id);
      const graced = pending.some((entry) => entry.playerId === seat.id);
      if (!seat.connected || held || graced) orphanedFor.delete(seat.id);
      else if (!orphanedFor.has(seat.id)) orphanedFor.set(seat.id, 0);
      // The first alarm after a seat lost its socket unseen gives it a grace.
      if ((orphanedFor.get(seat.id) ?? 0) > 1) return broke(`seat ${p.label} connected unheld`);
    }
  }
  return null;
}

describe("LobbyDO — seeded lifecycles", () => {
  it(`keeps its invariants over ${SEEDS} seeded lifecycles of ${STEPS} steps`, async () => {
    const broken: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const failure = await lifecycle(seed);
      if (failure !== null) broken.push(failure);
      h?.dispose();
      h = null;
      vi.restoreAllMocks();
      resetLogThrottle();
    }
    expect(broken).toEqual([]);
  });
});
