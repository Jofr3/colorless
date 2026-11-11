import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRngState, redactGame } from "@colorless/engine";
import {
  ALL_BASIC_DECK,
  attachFromDeck,
  deckOf,
  driveSetup,
  handFromDeck,
  handUid,
  mustCreate,
} from "@colorless/engine/testing";
import { LuaSimulator } from "./simulator";
import { LocalTableSource, type TableSource } from "./tableSource";
import { WIRE_ROWS, wireColumn } from "./wireFields";
import { fullStorage, memoryStorage } from "../test/storageStub";

const ANNOUNCE = wireColumn(WIRE_ROWS.sim.header, "announce");

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());
const names = { p1: "One", p2: "Two" };
const rows = (raw: string) => raw.split("\n").map((s) => s.split("\t").map(decodeURIComponent));

describe("LocalTableSource", () => {
  it("serves the viewer's redacted game, names and match id", () => {
    const state = driveSetup(7);
    const src = new LocalTableSource({ state, events: [], names, startedAt: 100 });
    const seat = src.host.viewerSeat;
    expect(src.view()).toEqual(redactGame(state, seat));
    expect(src.names()).toEqual(
      seat === "p1" ? { you: "One", opponent: "Two" } : { you: "Two", opponent: "One" },
    );
    expect(src.matchId()).toBe("100");
    expect(src.mode).toBe("local");
    expect(src.lifecycle().error).toBeNull();
  });
  it("reports a rejected send once and keys the bench by the stack bottom", () => {
    const state = driveSetup(7, undefined, {
      bench: { p1: ["fix-basic-1"], p2: ["fix-basic-1"] },
    });
    const src = new LocalTableSource({ state, events: [], names, startedAt: 100 });
    const seat = src.host.viewerSeat;
    const other = seat === "p1" ? "p2" : "p1";
    expect(src.allowed({ type: "endTurn", seat: other })).toBe(false);
    src.send({ type: "endTurn", seat: other });
    expect(src.lifecycle().error).not.toBeNull();
    expect(src.host.game).toBe(state);
    expect(src.takeEvents()).toEqual({ knockedOut: [], shuffled: [], coin: null });
    expect(src.benchKey("you", 0)).toBe(state.players[seat].bench[0]?.stack[0]);
    expect(src.benchKey("you", 9)).toBe("");
    src.send({ type: "endTurn", seat });
    expect(src.lifecycle().error).toBeNull();
    expect(src.turnDraws().map((d) => d.seat)).toEqual([other]);
    expect(src.turnDraws()).toEqual([]);
  });
  it("answers every change through its subscribers before the call returns", () => {
    const state = driveSetup(7, undefined, { first: "p1" });
    const src = new LocalTableSource({ state, events: [], names, startedAt: 100 });
    const heard: string[] = [];
    src.subscribe(() => heard.push(src.lifecycle().error?.reason ?? src.view().phase.kind));
    src.send({ type: "endTurn", seat: "p2" });
    const refused = src.lifecycle().error;
    expect(heard).toEqual([refused?.reason]);
    src.send({ type: "endTurn", seat: "p2" });
    expect(src.lifecycle().error).not.toBe(refused);
    expect(src.lifecycle().error?.reason).toBe(refused?.reason);
    src.send({ type: "endTurn", seat: "p1" });
    expect(heard).toHaveLength(3);
    expect(heard[2]).toBe("turn:action");
    src.history.step("undoAction");
    expect(heard).toHaveLength(4);
    expect(src.host.game).toBe(state);
    expect(src.restart()).toBeNull();
    expect(heard).toHaveLength(5);
    expect(src.matchId()).not.toBe("100");
    // The new game is keyed from the CSPRNG, not the clock, even from a legacy-seeded one.
    expect(typeof state.rngState).toBe("number");
    expect(src.host.game.rngState).toMatchObject({ alg: "chacha20" });
    expect(isRngState(src.host.game.rngState)).toBe(true);
  });
  it("reports a save that did not stick as a warning beside the accepted move", () => {
    const state = driveSetup(7, undefined, { first: "p1" });
    const sim = new LuaSimulator(vi.fn(), vi.fn());
    sim.open({ state, events: [], names, startedAt: 100 });
    vi.stubGlobal("localStorage", fullStorage());
    sim.dispatch({ type: "endTurn", seat: "p1" });
    expect(sim.host?.game.turn).toBe(state.turn + 1);
    expect(sim.source?.lifecycle().error).toBeNull();
    expect(sim.message).toMatch(/^Could not save/);
  });
});

describe("LocalTableSource coin flips", () => {
  const coinTrainer = () => {
    const deck = deckOf({ "fix-basic-1": 30, "sv01-168": 20, "fix-fire-energy": 10 });
    const state = attachFromDeck(
      handFromDeck(driveSetup(7, { p1: deck, p2: deck }, { first: "p1" }), "p1", "sv01-168", 1),
      "p2",
      "fix-fire-energy",
      1,
    );
    return { state, uid: handUid(state, "p1", "sv01-168") };
  };

  it("hands the flips over once, titled by the Trainer, and leaves the table free", () => {
    const { state, uid } = coinTrainer();
    const src = new LocalTableSource({ state, events: [], names, startedAt: 100 });
    src.send({ type: "playTrainer", seat: "p1", uid });
    const coin = src.takeEvents().coin;
    expect(coin?.title).toBe(state.cardPool["sv01-168"]?.name);
    expect(coin?.flips.length).toBeGreaterThan(0);
    expect(coin?.flips.every((f) => f.player === "One" && f.seat === "p1")).toBe(true);
    expect(src.takeEvents().coin).toBeNull();
    expect(src.allowed({ type: "endTurn", seat: "p1" })).toBe(true);
  });

  it("opens the coin overlay in the simulator, and Continue returns to the table", () => {
    const { state, uid } = coinTrainer();
    let last = "";
    const sim = new LuaSimulator((raw) => {
      last = raw;
    }, vi.fn());
    sim.open({ state, events: [], names, startedAt: 100 });
    sim.dispatch({ type: "playTrainer", seat: "p1", uid });
    const menu = rows(last).find((r) => r[0] === "M");
    expect(menu?.[1]).toBe("coin");
    expect(menu?.[3]).toMatch(/^One: (Heads|Tails)/);
    sim.menu?.options[0]?.run();
    expect(sim.menu?.kind).not.toBe("coin");
  });
});

describe("LuaSimulator over a TableSource", () => {
  it("emits the same table through any source, not only the local host", () => {
    let last = "";
    const sim = new LuaSimulator((raw) => {
      last = raw;
    }, vi.fn());
    sim.open({
      state: mustCreate(7, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }).state,
      events: [],
      names,
      startedAt: 100,
    });
    const local = sim.source;
    if (!local) throw Error("Missing source");
    const before = rows(last);
    // A plain delegate is not a LocalTableSource, so only the seam is used.
    const delegate: TableSource = {
      mode: "local",
      spectating: false,
      view: () => local.view(),
      names: () => local.names(),
      log: () => local.log(),
      matchId: () => local.matchId(),
      card: (id) => local.card(id),
      face: (c) => local.face(c),
      allowed: (a) => local.allowed(a),
      send: (a) => local.send(a),
      allowances: () => local.allowances(),
      benchKey: (owner, i) => local.benchKey(owner, i),
      takeEvents: () => local.takeEvents(),
      lifecycle: () => local.lifecycle(),
      subscribe: () => () => {},
      leave: () => local.leave(),
    };
    sim.source = delegate;
    sim.emit();
    const after = rows(last);
    // Header: revision bumps; turn history (f10, f11) is local-only; the opening announcement is
    // said once.
    const same = (_: string, i: number) => i !== 0 && i !== 9 && i !== 10 && i !== ANNOUNCE;
    expect(after[0]?.filter(same)).toEqual(before[0]?.filter(same));
    const rest = (r: string[][]) => r.slice(1).filter((x) => x[0] !== "L");
    expect(rest(after)).toEqual(rest(before));
  });
});
