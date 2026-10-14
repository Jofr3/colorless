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
    const rows = (publish.mock.lastCall?.[0] ?? "")
      .split("\n")
      .map((s: string) => s.split("\t").map(decodeURIComponent));
    const token = rows.find((r: string[]) => r[0] === "A" && r[2] === "End turn")?.[1];
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
  it("keeps the board unchanged on invalid drags and surfaces the engine reason", () => {
    const { sim } = setup();
    const before = sim.host?.game;
    sim.command("move\tnot-a-card\thand\t0\tactive\t0");
    expect(sim.host?.game).toBe(before);
    const h = sim.host;
    if (!h) throw Error("Missing host");
    const uid = h.game.players[h.viewerSeat].hand.find(
      (uid) => cardOfUid(h.game, uid)?.category === "Energy",
    );
    if (!uid) throw Error("Energy expected in fixture");
    sim.command(`move\t${uid}\thand\t0\tactive\t0`);
    expect(sim.host?.game).not.toBe(before);
    expect(sim.host?.game.players[sim.host.viewerSeat].active?.energy).toContain(uid);
  });
  it("resolves an engine search prompt without losing the running game", () => {
    const { sim } = setup();
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
    sim.inspect(uid);
    sim.menu?.options.find((o) => o.label === "Play card")?.run();
    expect(sim.host?.game.phase.kind).toBe("effect:choose");
    expect(sim.menu?.mandatory).toBe(true);
    sim.command("dismiss");
    expect(sim.menu?.mandatory).toBe(true);
    const option = sim.menu?.options.find((o) => !o.disabled);
    expect(option).toBeDefined();
    option?.run();
    const confirm = sim.menu?.footer?.find((o) => !o.disabled);
    expect(confirm).toBeDefined();
    confirm?.run();
    expect(sim.host?.game.phase.kind).toBe("turn:action");
    expect(sim.host?.game.players[h.viewerSeat].bench).toHaveLength(1);
    expect(sim.menu).toBeNull();
  });
  it("dispatches attacks through the engine and advances to the opponent", () => {
    const { sim } = setup();
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
    sim.inspect(uid);
    const attack = sim.menu?.options.find((o) => o.label.startsWith("Hit"));
    expect(attack?.disabled).toBe(false);
    attack?.run();
    expect(sim.host?.game.turn).toBe(3);
    expect(sim.host?.viewerSeat).toBe(otherSeat(h.viewerSeat));
    expect(sim.host?.game.players[otherSeat(h.viewerSeat)].active?.damage).toBe(10);
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
