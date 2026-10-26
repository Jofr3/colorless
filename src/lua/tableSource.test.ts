import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redactGame } from "@colorless/engine";
import { ALL_BASIC_DECK, driveSetup, mustCreate } from "@colorless/engine/testing";
import { LuaSimulator } from "./simulator";
import { LocalTableSource, type TableSource } from "./tableSource";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
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
      mode: "online",
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
      board: () => local.board(),
      takeEvents: () => local.takeEvents(),
      lifecycle: () => local.lifecycle(),
      subscribe: () => () => {},
    };
    sim.source = delegate;
    sim.emit();
    const after = rows(last);
    // Header: revision bumps; turn history (f10, f11) is local-only.
    expect(after[0]?.filter((_, i) => i !== 0 && i !== 9 && i !== 10)).toEqual(
      before[0]?.filter((_, i) => i !== 0 && i !== 9 && i !== 10),
    );
    const rest = (r: string[][]) => r.slice(1).filter((x) => x[0] !== "L");
    expect(rest(after)).toEqual(rest(before));
  });
});
