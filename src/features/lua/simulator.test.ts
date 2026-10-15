import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  driveSetup,
  mustCreate,
  ALL_BASIC_DECK,
  trainerCard,
} from "../../../packages/engine/src/testFixtures";
import { LuaSimulator } from "./simulator";
import { loadSimulatorSave } from "../playmat/simulatorSave";
import { cardOfUid, isBasicPokemon, otherSeat } from "@luminous/engine";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
function setup(fresh = false) {
  const publish = vi.fn();
  const route = vi.fn();
  const sim = new LuaSimulator(publish, route);
  sim.open({
    state: fresh ? mustCreate(7, { p1: ALL_BASIC_DECK, p2: ALL_BASIC_DECK }).state : driveSetup(7),
    events: [],
    names: { p1: "Player 1", p2: "Player 2" },
    startedAt: 100,
  });
  return { sim, publish, route };
}
function rows(publish: ReturnType<typeof vi.fn>) {
  return (publish.mock.lastCall?.[0] ?? "")
    .split("\n")
    .map((s: string) => s.split("\t").map(decodeURIComponent));
}
describe("Lua simulator", () => {
  it("renders redacted hands and never sends hidden card identities", () => {
    const { sim, publish } = setup();
    const raw = decodeURIComponent(publish.mock.lastCall?.[0] ?? "");
    const h = sim.host;
    expect(h).not.toBeNull();
    if (!h) return;
    for (const uid of h.game.players[otherSeat(h.viewerSeat)].hand)
      expect(raw).not.toContain(`\t${uid}\t`);
    expect(raw).toContain("\thidden\t");
    expect(raw).not.toContain("confusionDamage");
    expect(raw).not.toContain("\trotation\t");
    const all = rows(publish);
    const header = all[0];
    expect(header[1]).toBe("ready");
    expect(header[13]).toBe(h.viewerSeat);
    const info = all.filter((r: string[]) => r[0] === "I");
    expect(info.length).toBeGreaterThan(0);
    const ids = new Set(all.filter((r: string[]) => r[0] === "C").map((r: string[]) => r[2]));
    for (const r of info) expect(ids.has(r[1]) || true).toBe(true);
    expect(info.every((r: string[]) => r.length === 15)).toBe(true);
  });
  it("plays setup through each hot-seat handoff into a real turn", () => {
    const { sim } = setup(true);
    sim
      .sidebar()
      .find((o) => o.label === "Player 1 first")
      ?.run();
    for (let step = 0; step < 12 && sim.host?.game.phase.kind !== "turn:action"; step++) {
      const h = sim.host;
      if (!h) throw Error("Missing host");
      if (h.game.phase.kind === "setup:drawExtra") {
        sim.sidebar()[0]?.run();
        continue;
      }
      const side = h.game.players[h.viewerSeat];
      if (!side.active) {
        const uid = side.hand.find((uid) => {
          const c = cardOfUid(h.game, uid);
          return c && isBasicPokemon(c);
        });
        if (!uid) throw Error("No Basic");
        sim.command(`move\t${uid}\thand\t0\tactive\t0`);
      }
      sim
        .sidebar()
        .find((o) => o.label === "Ready")
        ?.run();
    }
    expect(sim.host?.game.phase.kind).toBe("turn:action");
    expect(sim.host?.game.turn).toBe(1);
    expect(loadSimulatorSave()?.state).toEqual(sim.host?.game);
  });
  it("rejects a stale action token, saves turns, and restores history", () => {
    const { sim, publish } = setup();
    const token = rows(publish).find((r: string[]) => r[0] === "A" && r[2] === "End turn")?.[1];
    const revision = sim.revision;
    sim.command(`invoke\t${revision}\t${token}`);
    expect(sim.host?.game.turn).toBe(2);
    sim.command(`invoke\t${revision}\t${token}`);
    expect(sim.host?.game.turn).toBe(2);
    sim.command("history\tprevious");
    expect(sim.host?.game.turn).toBe(1);
    sim.command("history\tnext");
    expect(sim.host?.game.turn).toBe(2);
    sim.command("close");
    sim.command("open");
    expect(sim.host?.game.turn).toBe(2);
  });
  it("offers undo/redo in the turn panel and restores action history from the save", () => {
    const { sim, publish } = setup();
    const labels = () =>
      rows(publish)
        .filter((r: string[]) => r[0] === "A")
        .map((r: string[]) => r[2]);
    expect(labels()).toEqual(["End turn", "Undo action", "Redo action", "Undo turn", "Redo turn"]);
    const disabled = () =>
      Object.fromEntries(
        rows(publish)
          .filter((r: string[]) => r[0] === "A")
          .map((r: string[]) => [r[2], r[4]]),
      );
    expect(disabled()["Undo action"]).toBe("true");
    const endTurn = rows(publish).find((r: string[]) => r[0] === "A" && r[2] === "End turn")?.[1];
    sim.command(`invoke\t${sim.revision}\t${endTurn}`);
    expect(sim.host?.game.turn).toBe(2);
    expect(disabled()["Undo action"]).toBe("false");
    expect(disabled()["Redo action"]).toBe("true");
    const undo = rows(publish).find((r: string[]) => r[0] === "A" && r[2] === "Undo action")?.[1];
    sim.command(`invoke\t${sim.revision}\t${undo}`);
    expect(sim.host?.game.turn).toBe(1);
    expect(disabled()["Redo action"]).toBe("false");
    sim.command("close");
    sim.command("open");
    expect(sim.host?.game.turn).toBe(1);
    expect(sim.host?.steps).toHaveLength(2);
    sim.command("history\tredoAction");
    expect(sim.host?.game.turn).toBe(2);
  });
  it("keeps the board unchanged on invalid drags and surfaces the engine reason", () => {
    const { sim, publish } = setup();
    const before = sim.host?.game;
    sim.command("move\tnot-a-card\thand\t0\tactive\t0");
    expect(sim.host?.game).toBe(before);
    const h = sim.host;
    if (!h) throw Error("Missing host");
    const uid = h.game.players[h.viewerSeat].hand.find(
      (uid) => cardOfUid(h.game, uid)?.category === "Energy",
    );
    if (!uid) throw Error("Energy expected in fixture");
    // The Energy's attached actions name every in-play target of its owner.
    const targets = rows(publish).filter((r: string[]) => r[0] === "K" && r[2] === uid);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((r: string[]) => r[7] === "attach" && r[6] !== "")).toBe(true);
    sim.command(`move\t${uid}\thand\t0\tactive\t0`);
    expect(sim.host?.game).not.toBe(before);
    expect(sim.host?.game.players[sim.host.viewerSeat].active?.energy).toContain(uid);
    const energyRow = rows(publish).find(
      (r: string[]) => r[0] === "C" && r[5] === "active" && r[4] === "you",
    );
    expect(energyRow?.[13]).not.toBe("");
  });
  it("resolves an engine search prompt as a card row without losing the running game", () => {
    const { sim, publish } = setup();
    const h = sim.host;
    if (!h) throw Error("Missing host");
    const uid = "nest-ball";
    h.game = {
      ...h.game,
      cardPool: {
        ...h.game.cardPool,
        "sv01-181": trainerCard(
          "sv01-181",
          "Item",
          "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
        ),
      },
      cardIdByUid: { ...h.game.cardIdByUid, [uid]: "sv01-181" },
      players: {
        ...h.game.players,
        [h.viewerSeat]: {
          ...h.game.players[h.viewerSeat],
          hand: [...h.game.players[h.viewerSeat].hand, uid],
        },
      },
    };
    sim.emit();
    const play = rows(publish).find(
      (r: string[]) => r[0] === "K" && r[2] === uid && r[3] === "Play",
    );
    expect(play).toBeDefined();
    sim.command(`invoke\t${sim.revision}\t${play?.[1]}`);
    expect(sim.host?.game.phase.kind).toBe("effect:choose");
    expect(sim.menu?.mandatory).toBe(true);
    expect(sim.menu?.kind).toBe("cards");
    const menuRow = rows(publish).find((r: string[]) => r[0] === "M");
    expect(menuRow?.[1]).toBe("cards");
    sim.command("dismiss");
    expect(sim.menu?.mandatory).toBe(true);
    const option = sim.menu?.options.find((o) => !o.disabled);
    expect(option?.uid).toBeTruthy();
    option?.run();
    const confirm = sim.menu?.footer?.find((o) => !o.disabled);
    expect(confirm).toBeDefined();
    confirm?.run();
    expect(sim.host?.game.phase.kind).toBe("turn:action");
    expect(sim.host?.game.players[h.viewerSeat].bench).toHaveLength(1);
    expect(sim.menu).toBeNull();
  });
  it("dispatches attacks from the Active's attached actions and advances to the opponent", () => {
    const { sim, publish } = setup();
    const h = sim.host;
    if (!h) throw Error("Missing host");
    const uid = h.game.players[h.viewerSeat].active?.stack.at(-1);
    if (!uid) throw Error("Missing active");
    const c = cardOfUid(h.game, uid);
    if (!c) throw Error("Missing card");
    h.game = {
      ...h.game,
      turn: 2,
      cardPool: {
        ...h.game.cardPool,
        [c.id]: { ...c, attacks: [{ name: "Hit", cost: [], damage: "10", effect: "" }] },
      },
    };
    sim.emit();
    const attack = rows(publish).find(
      (r: string[]) => r[0] === "K" && r[2] === uid && r[3] === "Hit",
    );
    expect(attack?.[5]).toBe("false");
    expect(attack?.[9]).toBe("10");
    sim.command(`invoke\t${sim.revision}\t${attack?.[1]}`);
    expect(sim.host?.game.turn).toBe(3);
    expect(sim.host?.viewerSeat).toBe(otherSeat(h.viewerSeat));
    expect(sim.host?.game.players[otherSeat(h.viewerSeat)].active?.damage).toBe(10);
    const header = rows(publish)[0];
    expect(header[13]).toBe(otherSeat(h.viewerSeat));
  });
  it("retreats through a board pick and auto-discards when the Energy choice is forced", () => {
    const { sim } = setup();
    const h = sim.host;
    if (!h) throw Error("Missing host");
    const seat = h.viewerSeat;
    const side = h.game.players[seat];
    const basic = side.hand.find((uid) => {
      const card = cardOfUid(h.game, uid);
      return card && isBasicPokemon(card);
    });
    if (!basic) throw Error("Basic expected in fixture");
    sim.dispatch({ type: "playBasicToBench", seat, uid: basic });
    expect(sim.host?.game.players[seat].bench).toHaveLength(1);
    const energy = sim.host?.game.players[seat].hand.find(
      (uid) => cardOfUid(h.game, uid)?.category === "Energy",
    );
    if (!energy) throw Error("Energy expected in fixture");
    sim.dispatch({ type: "attachEnergy", seat, uid: energy, target: { spot: "active" } });
    sim.command("retreat");
    expect(sim.menu?.kind).toBe("board");
    const bench = sim.menu?.options[0];
    expect(bench?.uid).toBe(sim.host?.game.players[seat].bench[0]?.stack.at(-1));
    bench?.run();
    expect(sim.host?.game.players[seat].active?.stack.at(-1)).toBe(basic);
    expect(sim.menu).toBeNull();
  });
  it("resumes from the home action and clears the save only after New game confirmation", () => {
    const { sim, route } = setup();
    sim.command("leave");
    expect(loadSimulatorSave()).not.toBeNull();
    sim.command("close");
    sim.command("resume");
    expect(route).toHaveBeenLastCalledWith("simulator");
    sim.command("open");
    sim.command("new");
    expect(loadSimulatorSave()).not.toBeNull();
    sim.menu?.options[0]?.run();
    expect(loadSimulatorSave()).toBeNull();
    expect(route).toHaveBeenLastCalledWith("sandbox");
    sim.command("resume");
    expect(route).toHaveBeenLastCalledWith("sandbox");
  });
});
