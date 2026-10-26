import { type GameState, redactGame } from "@colorless/engine";
import {
  createSnapshot,
  type LobbySnapshot,
  makePlayer,
  type RedactedEffectPrompt,
  type RedactedGame,
  type SeatLogEntry,
} from "@colorless/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveSetup } from "@colorless/engine/testing";
import { fakeLobbyChannel } from "../test/fakeLobbyChannel";
import { LobbyClient } from "../online/lobbyClient";
import { LuaOnline } from "./online";
import { onlineGate, promptGate } from "./onlineTable";
import { LuaSimulator } from "./simulator";

const CODE = "ABCD";
const store = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    keys: () => [...values.keys()],
  };
};
let local: ReturnType<typeof store>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("sessionStorage", store());
  local = store();
  vi.stubGlobal("localStorage", local);
  localStorage.setItem("online.playerName", "Ash");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const decode = (raw: string) => raw.split("\n").map((r) => r.split("\t").map(decodeURIComponent));
const snap = (me: string, over: Partial<LobbySnapshot> = {}): LobbySnapshot => ({
  ...createSnapshot(CODE, makePlayer("h", "Brock")),
  guest: makePlayer(me, "Ash"),
  phase: "in-game",
  ...over,
});
/** The viewer's frame of a real engine game, optionally edited. */
const frame = (state: GameState, edit: (g: RedactedGame) => void = () => {}) => {
  const g = structuredClone(redactGame(state, "p1"));
  edit(g);
  return g;
};

async function table(state: GameState = driveSetup(7, undefined, { first: "p1" })) {
  const fakes: ReturnType<typeof fakeLobbyChannel>[] = [];
  const route = vi.fn<(page: string, id: string, replace: boolean) => void>();
  const simRoute = vi.fn<(page: string, id?: string, replace?: boolean) => void>();
  const publish = vi.fn<(raw: string) => void>();
  const cards = vi.fn(async (ids: string[]) => ({
    pool: Object.fromEntries(
      ids.flatMap((id) => (state.cardPool[id] ? [[id, state.cardPool[id]]] : [])),
    ),
  }));
  const online = new LuaOnline(vi.fn(), route, {
    cards,
    client: (opts) => {
      const fake = fakeLobbyChannel();
      fakes.push(fake);
      return new LobbyClient(opts, { channel: fake.channel });
    },
  });
  const sim = new LuaSimulator(
    publish,
    simRoute,
    () => {},
    (code) => online.matchSource(code),
  );
  await online.command(`open\t${CODE}`);
  const fake = () => {
    const f = fakes.at(-1);
    if (!f) throw new Error("no client");
    return f;
  };
  const me = JSON.parse(sessionStorage.getItem(`online.identity.${CODE}`) ?? "{}").playerId;
  const push = (game: RedactedGame, log: SeatLogEntry[] = []) =>
    fake().push({ kind: "match", game, log });
  fake().push({ kind: "state", snapshot: snap(me) });
  push(frame(state));
  // The modal hands over: close + open online in the same tick.
  await online.command("close");
  sim.command(`open\tonline\t${CODE}`);
  const rows = () => decode(publish.mock.lastCall?.[0] ?? "");
  const tagged = (tag: string) => rows().filter((r) => r[0] === tag);
  const actions = () =>
    fake()
      .posts.filter((p) => p.kind === "action")
      .map((p) => (p.kind === "action" ? p.action : null));
  return {
    online,
    sim,
    route,
    simRoute,
    publish,
    fake,
    push,
    me,
    rows,
    tagged,
    actions,
    cards,
    state,
  };
}

describe("LuaOnlineMatch", () => {
  it("emits the header and an online L row with lobby names and a match id", async () => {
    const t = await table();
    expect(t.route).toHaveBeenCalledWith("match", CODE, true);
    const header = t.rows()[0] ?? [];
    expect(header[2]).toBe("Ash");
    expect(header[3]).toBe("Brock");
    expect(header[20]).toBe(`${CODE}:1`);
    expect(t.tagged("L")).toEqual([["L", "online", "false", "", "", "concede,leave", "partial"]]);
    // Catalogue faces arrive after the frame and add I rows; asked once each.
    await vi.waitFor(() => expect(t.tagged("I").length).toBeGreaterThan(0));
    t.push(frame(t.state));
    expect(t.cards).toHaveBeenCalledTimes(1);
  });

  it("an unknown code sends the table back to the online modal", () => {
    const route = vi.fn();
    const online = new LuaOnline(vi.fn(), vi.fn());
    const publish = vi.fn();
    const sim = new LuaSimulator(
      publish,
      route,
      () => {},
      (code) => online.matchSource(code),
    );
    sim.command("open\tonline\tWXYZ");
    expect(route).toHaveBeenCalledWith("online", "WXYZ", true);
    expect(publish).not.toHaveBeenCalled();
  });

  it("gates actions on the wire's own flags", async () => {
    const state = driveSetup(7, undefined, { first: "p1" });
    const g = frame(state, (v) => {
      if (v.phase.kind !== "turn:action") throw new Error("Expected turn:action");
      v.phase.attacks = [
        { index: 0, name: "Spark", cost: ["Lightning"], damage: "30", playable: false },
        { index: 1, name: "Tackle", cost: [], damage: "10", playable: true },
      ];
    });
    const seat = g.seat;
    expect(onlineGate({ type: "attack", seat, index: 0 }, g)).toBe(false);
    expect(onlineGate({ type: "attack", seat, index: 1 }, g)).toBe(true);
    expect(onlineGate({ type: "endTurn", seat }, { ...g, activePlayer: "opponent" })).toBe(false);
    const t = await table(state);
    t.push(g);
    const attacks = t.tagged("K").filter((r) => r[3] === "Spark" || r[3] === "Tackle");
    expect(attacks.map((r) => [r[3], r[5]])).toEqual([
      ["Spark", "true"],
      ["Tackle", "false"],
    ]);
  });

  it("the table answers the simulator's gate from the frame it holds", async () => {
    const t = await table();
    expect(t.sim.allowed({ type: "endTurn", seat: "p1" })).toBe(true);
    t.push(
      frame(t.state, (v) => {
        v.activePlayer = "opponent";
        v.waitingOn = "opponent";
      }),
    );
    expect(t.sim.allowed({ type: "endTurn", seat: "p1" })).toBe(false);
  });

  it("offers Evolve only onto the hand card's evolution targets", () => {
    const state = driveSetup(7, undefined, { first: "p1", bench: { p1: ["fix-basic-1"] } });
    const g = frame(state);
    const active = g.board.you.active;
    const bench = g.board.you.bench[0];
    const card = g.board.you.hand[0];
    if (!active || !bench || !card) throw new Error("Expected a board");
    card.evolutionTargetIds = [bench.id];
    const evolve = (target: { spot: "active" } | { spot: "bench"; index: number }) =>
      onlineGate({ type: "evolve", seat: g.seat, uid: card.id, target }, g);
    expect(evolve({ spot: "active" })).toBe(false);
    expect(evolve({ spot: "bench", index: 0 })).toBe(true);
  });

  it("gates effect answers to the prompt's shape", () => {
    const cards = {
      kind: "chooseCards",
      candidates: [],
      min: 1,
      max: 2,
      dest: "hand",
      note: "",
    } satisfies RedactedEffectPrompt;
    expect(promptGate(cards, { kind: "cards", uids: [] })).toBe(false);
    expect(promptGate(cards, { kind: "cards", uids: ["a"] })).toBe(true);
    const multi = {
      kind: "choosePokemonMulti",
      candidates: [],
      min: 2,
      max: 2,
      declinable: true,
      note: "",
    } satisfies RedactedEffectPrompt;
    expect(promptGate(multi, { kind: "pokemonMulti", refs: [] })).toBe(true);
    expect(
      promptGate(multi, { kind: "pokemonMulti", refs: [{ seat: "p1", spot: { spot: "active" } }] }),
    ).toBe(false);
    expect(promptGate({ kind: "guessHp", name: "X", note: "" }, { kind: "hpGuess", hp: -10 })).toBe(
      false,
    );
  });

  it("auto-sends the mulligan draw and Prize take once per decision", async () => {
    const t = await table();
    const draw = frame(t.state, (v) => {
      v.phase = { kind: "setup:drawExtra", owed: 2 };
      v.waitingOn = "you";
    });
    t.push(draw);
    t.push(structuredClone(draw));
    const prizes = frame(t.state, (v) => {
      v.phase = { kind: "ko:takePrizes", count: 2 };
      v.waitingOn = "you";
    });
    t.push(prizes);
    t.push(structuredClone(prizes));
    expect(t.actions()).toEqual([
      { type: "setupDrawExtra", seat: "p1", count: 2 },
      { type: "takePrizes", seat: "p1", prizeIndices: [5, 4] },
    ]);
    // An automatic step's refusal is not the player's error.
    t.fake().push({ kind: "reject-action", reason: "Already taken" });
    expect(t.rows()[0]?.[6]).toBe("");
    expect(t.tagged("M")).toHaveLength(0);
  });

  it("shows a refused action until the next frame", async () => {
    const t = await table();
    t.sim.command("concede");
    const confirm = t.tagged("O").find((r) => r[2] === "Concede");
    expect(t.tagged("M")[0]?.[2]).toBe("Concede the match?");
    t.sim.command(`invoke\t${t.rows()[0]?.[0]}\t${confirm?.[1]}`);
    expect(t.actions()).toEqual([{ type: "concede", seat: "p1" }]);
    t.fake().push({ kind: "reject-action", reason: "Not now" });
    expect(t.rows()[0]?.[6]).toBe("Not now");
    t.push(frame(t.state));
    expect(t.rows()[0]?.[6]).toBe("");
  });

  it("rebuilds a prompt per new decision and keeps half-made picks across repeats", async () => {
    const t = await table();
    const hand = frame(t.state).board.you.hand;
    const choose = (max: number) =>
      frame(t.state, (v) => {
        v.phase = {
          kind: "effect:choose",
          prompt: {
            kind: "chooseCards",
            candidates: hand,
            min: 1,
            max,
            dest: "hand",
            note: "Pick",
          },
        };
        v.waitingOn = "you";
      });
    t.push(choose(2));
    const pick = () => {
      const o = t.tagged("O")[0];
      t.sim.command(`invoke\t${t.rows()[0]?.[0]}\t${o?.[1]}`);
    };
    pick();
    expect(t.tagged("O")[0]?.[5]).toBe("true");
    t.push(choose(2));
    expect(t.tagged("O")[0]?.[5]).toBe("true");
    t.push(choose(3));
    expect(t.tagged("O")[0]?.[5]).toBe("false");
    pick();
    const confirm = t.tagged("F")[0];
    t.sim.command(`invoke\t${t.rows()[0]?.[0]}\t${confirm?.[1]}`);
    expect(t.actions().at(-1)).toEqual({
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [hand[0]?.id] },
    });
    // In flight: no menu; a refusal brings the same decision back.
    expect(t.tagged("M")).toHaveLength(0);
    t.fake().push({ kind: "reject-action", reason: "Pick another" });
    expect(t.tagged("M")).toHaveLength(1);
    expect(t.rows()[0]?.[6]).toBe("Pick another");
  });

  it("captions prompts from the frame alone: counter placement and the Ability's name", async () => {
    const t = await table();
    const parked = (phase: RedactedGame["phase"]) =>
      frame(t.state, (v) => {
        v.phase = phase;
        v.waitingOn = "you";
      });
    const target = { seat: "p2", spot: { spot: "active" } } as const;
    t.push(
      parked({
        kind: "effect:choose",
        prompt: {
          kind: "choosePokemonMulti",
          candidates: [target],
          min: 1,
          max: 1,
          declinable: false,
          unit: "counters",
          note: "",
        },
      }),
    );
    expect(t.tagged("M")[0]?.[2]).toBe("Place damage counters");
    expect(t.tagged("M")[0]?.[6]).toBe("true");
    t.push(
      parked({
        kind: "effect:choose",
        prompt: { kind: "confirm", note: "Use it?" },
        invokedBy: "ability",
        abilityName: "Drive Off",
      }),
    );
    expect(t.tagged("M")[0]?.[2]).toBe("Do you want to use Drive Off?");
  });

  it("names the opponent while waiting on them, and a reconnect keeps the table", async () => {
    const t = await table();
    t.push(
      frame(t.state, (v) => {
        v.activePlayer = "opponent";
        v.waitingOn = "opponent";
      }),
    );
    expect(t.rows()[0]?.slice(7, 9)).toEqual(["Brock's turn", "Waiting for Brock..."]);
    expect(t.tagged("A")).toHaveLength(0);
    t.route.mockClear();
    vi.advanceTimersByTime(6000);
    expect(t.online.client?.state.status).toBe("connecting");
    expect(t.route).not.toHaveBeenCalled();
  });

  it("plays Knock Outs, shuffles and coins from the new rows' cues", async () => {
    const t = await table();
    const before = frame(t.state);
    t.push(before);
    const ko = before.board.opponent.active;
    if (!ko) throw new Error("Expected an opposing Active");
    const after = structuredClone(before);
    after.board.opponent.active = null;
    after.board.opponent.discard.push(ko);
    const row = (
      cues: NonNullable<Extract<SeatLogEntry, { kind: "action" }>["cues"]>,
    ): SeatLogEntry => ({ kind: "action", who: "p2", elapsed: "0:01", segments: [], cues });
    t.push(after, [
      row([{ kind: "coin", seat: "p2", face: "tails" }]),
      row([{ kind: "knockOut", seat: "p2", uid: ko.id }]),
      row([{ kind: "shuffle", seat: "p2", zone: "deck" }]),
    ]);
    expect(t.tagged("D")).toEqual([["D", ko.id]]);
    expect(t.rows()[0]?.[19]).toBe("opponent");
    const coin = t.tagged("M")[0];
    expect(coin?.slice(1, 4)).toEqual(["coin", "Coin flip", "Brock: Tails"]);
  });

  it("treats a card leaving play for the discard pile without a Knock Out cue as no Knock Out", async () => {
    const t = await table();
    const before = frame(t.state);
    t.push(before);
    const gone = before.board.opponent.active;
    if (!gone) throw new Error("Expected an opposing Active");
    const after = structuredClone(before);
    after.board.opponent.active = null;
    after.board.opponent.discard.push(gone);
    t.push(after, [
      { kind: "action", who: "p2", elapsed: "0:01", segments: [{ text: "discarded" }], cues: [] },
    ]);
    expect(t.tagged("D")).toEqual([]);
  });

  it("still riffles a deck from a log written before cues", async () => {
    const t = await table();
    t.push(frame(t.state));
    t.push(frame(t.state), [
      {
        kind: "action",
        who: "p2",
        elapsed: "0:01",
        segments: [{ text: "Brock shuffled their deck" }],
      },
    ]);
    expect(t.rows()[0]?.[19]).toBe("opponent");
  });

  it("counts the opponent's forfeit clock in the L row", async () => {
    vi.setSystemTime(1_000_000);
    const t = await table();
    const opponent = { ...makePlayer("h", "Brock"), connected: false, forfeitAt: 1_030_000 };
    t.fake().push({ kind: "state", snapshot: snap(t.me, { host: opponent }) });
    expect(t.tagged("L")[0]?.slice(3, 5)).toEqual(["Brock", "30000"]);
    t.fake().push({
      kind: "state",
      snapshot: snap(t.me, { host: { ...opponent, forfeitAt: null } }),
    });
    expect(t.tagged("L")[0]?.[4]).toBe("-1");
  });

  it("rematch posts once, flags it, and the next match is a fresh id", async () => {
    const t = await table();
    const over = frame(t.state, (v) => {
      v.phase = { kind: "gameOver" };
      v.outcome = { result: "win", winner: "you", reason: "conceded" };
    });
    t.push(over);
    expect(t.tagged("L")[0]?.[5]).toBe("rematch,leave");
    t.sim.command("rematch");
    t.sim.command("rematch");
    expect(t.fake().posts.filter((p) => p.kind === "rematch")).toEqual([
      { kind: "rematch", from: t.me },
    ]);
    expect(t.tagged("L")[0]?.[5]).toBe("rematch,rematch-sent,leave");
    expect(t.tagged("A")[0]?.slice(2, 5)).toEqual(["Waiting...", "red", "true"]);
    // The lobby leaves the game for the rematch: both stay at the finished table.
    t.route.mockClear();
    t.fake().push({ kind: "state", snapshot: snap(t.me, { phase: "selecting" }) });
    expect(t.route).not.toHaveBeenCalled();
    expect(t.tagged("L")[0]?.[5]).toBe("rematch,rematch-sent,leave");
    // The next game starts on the same table under a fresh id.
    t.fake().push({ kind: "state", snapshot: snap(t.me) });
    t.push(frame(t.state));
    expect(t.route).not.toHaveBeenCalled();
    expect(t.rows()[0]?.[20]).toBe(`${CODE}:2`);
    expect(t.tagged("L")[0]?.[5]).toBe("concede,leave");
  });

  it("an opponent's rematch is accepted by readying, and their leaving ends the wait", async () => {
    const t = await table();
    t.push(
      frame(t.state, (v) => {
        v.phase = { kind: "gameOver" };
        v.outcome = { result: "win", winner: "you", reason: "conceded" };
      }),
    );
    // Brock asked first: the server already took the lobby out of the game.
    const asked = { ...makePlayer("h", "Brock"), ready: true };
    t.fake().push({ kind: "state", snapshot: snap(t.me, { phase: "selecting", host: asked }) });
    expect(t.tagged("L")[0]?.[5]).toBe("rematch,leave");
    t.sim.command("rematch");
    const posts = t.fake().posts;
    expect(posts.filter((p) => p.kind === "rematch")).toEqual([]);
    expect(posts.at(-1)).toEqual({
      kind: "intent",
      from: t.me,
      intent: { type: "set-ready", ready: true },
    });
    // Brock walks out instead: back to the lobby modal.
    t.route.mockClear();
    t.fake().push({
      kind: "state",
      snapshot: snap(t.me, { phase: "selecting", host: { ...asked, connected: false } }),
    });
    expect(t.route).toHaveBeenCalledWith("online", CODE, true);
  });

  it("Leave says bye, forgets the seat and goes home", async () => {
    const t = await table();
    t.sim.command("leave");
    expect(t.fake().kinds()).toContain("bye");
    expect(sessionStorage.getItem(`online.identity.${CODE}`)).toBeNull();
    expect(t.simRoute).toHaveBeenCalledWith("home");
    t.sim.command("close");
    vi.advanceTimersByTime(0);
    expect(
      t
        .fake()
        .kinds()
        .filter((k) => k === "bye"),
    ).toHaveLength(1);
  });

  it("closing the table keeps the lobby when the modal takes it back", async () => {
    const t = await table();
    t.sim.command("close");
    await t.online.command(`open\t${CODE}`);
    vi.advanceTimersByTime(0);
    expect(t.fake().kinds()).not.toContain("bye");
    // Nobody takes it: bye after the tick.
    await t.online.command("close");
    vi.advanceTimersByTime(0);
    expect(t.fake().kinds()).toContain("bye");
  });

  it("ignores hot-seat history and new game, and never writes the local save", async () => {
    const t = await table();
    const before = t.publish.mock.calls.length;
    t.sim.command("history\tundoAction");
    t.sim.command("newgame");
    t.sim.command("choosedecks");
    expect(t.publish.mock.calls.length).toBe(before);
    expect(t.tagged("A").map((r) => r[2])).toEqual(["End turn"]);
    const hand = t.tagged("C").filter((r) => r[4] === "you" && r[5] === "hand");
    const [a, b] = hand;
    if (!a || !b) throw new Error("Expected two hand cards");
    t.sim.command(`reorder\thand\t${b[1]}\t0`);
    expect(t.tagged("C").find((r) => r[1] === b[1])?.[18]).toBe("0");
    expect(local.keys().filter((k) => k.startsWith("colorless:simulator"))).toEqual([]);
  });
});
