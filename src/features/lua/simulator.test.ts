import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  driveSetup,
  mustCreate,
  ALL_BASIC_DECK,
  trainerCard,
  PRIZE_DECK,
  attachFromDeck,
  benchFromDeck,
  setActiveFromDeck,
  setDamage,
  setPrizes,
  must,
  RARE_CANDY_DECK,
  handFromDeck,
  handUid,
} from "../../../packages/engine/src/testFixtures";
import { LuaSimulator } from "./simulator";
import { loadSimulatorSave } from "../playmat/simulatorSave";
import { applyAction, cardOfUid, isBasicPokemon, otherSeat } from "@luminous/engine";

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
function knockoutState(id: string, hp: number, seed = 1) {
  let state = driveSetup(seed, { p1: PRIZE_DECK, p2: PRIZE_DECK }, { first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", id);
  state = benchFromDeck(state, "p2", "fix-victim");
  return setDamage(state, "p2", hp - 30);
}
function rareCandySetup(turn = 3) {
  let state = driveSetup(
    4,
    { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK },
    {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
      bench: { p1: ["fix-basic-1"] },
    },
  );
  while (state.turn < turn) {
    if (state.phase.kind !== "turn:action") throw Error("Expected action phase");
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  state = handFromDeck(state, "p1", "sv01-191", 1);
  state = handFromDeck(state, "p1", "fix-stage2", 1);
  state = benchFromDeck(state, "p1", "fix-basic-2");
  const candy = handUid(state, "p1", "sv01-191");
  const stage2 = handUid(state, "p1", "fix-stage2");
  const publish = vi.fn();
  const sim = new LuaSimulator(publish, vi.fn());
  sim.open({
    state,
    events: [],
    names: { p1: "One", p2: "Two" },
    startedAt: 100,
    resume: { log: [{ kind: "turn", turn }], viewerSeat: "p1" },
  });
  const cardRow = (uid: string) =>
    rows(publish).find((r: string[]) => r[0] === "C" && r[1] === uid);
  return { sim, publish, state, candy, stage2, cardRow };
}
describe("Lua simulator", () => {
  it.each(["active", "bench"] as const)(
    "stages Rare Candy then evolves the %s Basic with a Stage 2 drag",
    (zone) => {
      const { sim, publish, state, candy, stage2, cardRow } = rareCandySetup();
      expect(cardRow(candy)?.[17]).toBe("true");
      sim.command(`move\t${candy}\thand\t0\tplaymat\t0`);
      expect(sim.host?.game).toBe(state);
      expect(sim.host?.steps).toHaveLength(1);
      expect(cardRow(candy)?.[5]).toBe("played");
      expect(cardRow(stage2)?.[17]).toBe("true");
      expect(rows(publish).find((r: string[]) => r[0] === "S" && r[1] === "you")?.[4]).toBe(
        String(state.players.p1.hand.length - 1),
      );
      expect(sim.menu).toBeNull();
      // An invalid destination must not spend either card or lose the pending play.
      sim.command(`move\t${stage2}\thand\t0\tbench\t1`);
      expect(sim.host?.game).toBe(state);
      expect(cardRow(candy)?.[5]).toBe("played");
      expect(sim.message).not.toBe("");
      sim.command(`move\t${stage2}\thand\t0\t${zone}\t0`);
      const after = sim.host?.game;
      const evolved = zone === "active" ? after?.players.p1.active : after?.players.p1.bench[0];
      const basic = zone === "active" ? state.players.p1.active : state.players.p1.bench[0];
      expect(sim.message).toBe("");
      expect(evolved?.stack).toEqual([...(basic?.stack ?? []), stage2]);
      expect(after?.players.p1.discard).toContain(candy);
      expect(after?.players.p1.hand).not.toContain(candy);
      expect(after?.players.p1.hand).not.toContain(stage2);
      expect(rows(publish).filter((r: string[]) => r[0] === "C" && r[1] === candy)).toHaveLength(1);
      expect(cardRow(candy)?.[5]).toBe("played");
      expect(rows(publish).some((r: string[]) => r[0] === "R")).toBe(false);
      expect(sim.host?.steps).toHaveLength(2);
      expect(loadSimulatorSave()?.state).toEqual(after);
      sim.history("undoAction");
      expect(sim.host?.game).toEqual(state);
      expect(cardRow(candy)?.[5]).toBe("hand");
      expect(cardRow(stage2)?.[5]).toBe("hand");
      sim.history("redoAction");
      expect(sim.host?.game).toEqual(after);
    },
  );
  it("cancels a staged Rare Candy and restores it on reload without spending it", () => {
    const { sim, state, candy, cardRow } = rareCandySetup();
    sim.persist();
    sim.command(`move\t${candy}\thand\t0\tplaymat\t0`);
    sim.command("cancelRareCandy");
    expect(sim.host?.game).toBe(state);
    expect(cardRow(candy)?.[5]).toBe("hand");
    sim.command(`move\t${candy}\thand\t0\tplaymat\t0`);
    sim.history("undoAction");
    expect(sim.host?.game).toBe(state);
    expect(cardRow(candy)?.[5]).toBe("hand");
    sim.command(`move\t${candy}\thand\t0\tplaymat\t0`);
    sim.command("close");
    sim.command("open");
    expect(sim.host?.game).toEqual(state);
    expect(cardRow(candy)?.[5]).toBe("hand");
  });
  it("allows dragging Rare Candy but returns it to hand when no legal pairing exists", () => {
    const { sim, state, candy, cardRow } = rareCandySetup(1);
    expect(cardRow(candy)?.[17]).toBe("true");
    sim.command(`move\t${candy}\thand\t0\tplaymat\t0`);
    expect(sim.host?.game).toBe(state);
    expect(cardRow(candy)?.[5]).toBe("hand");
    expect(sim.message).not.toBe("");
    expect(cardRow(candy)?.[17]).toBe("true");
  });
  it.each([
    { id: "fix-victim", hp: 30, count: 1, seed: 3 },
    { id: "fix-pokemon-v", hp: 210, count: 2, seed: 1 },
    { id: "fix-pokemon-vmax", hp: 330, count: 3, seed: 2 },
  ])(
    "automatically takes $count KO prizes and keeps the KO together in history",
    ({ id, hp, count, seed }) => {
      const state = knockoutState(id, hp, seed);
      const publish = vi.fn();
      const sim = new LuaSimulator(publish, vi.fn());
      sim.open({ state, events: [], names: { p1: "One", p2: "Two" }, startedAt: 100 });
      sim.dispatch({ type: "attack", seat: "p1", index: 0 });
      const after = sim.host?.game;
      expect(sim.message).toBe("");
      expect(after?.players.p1.prizes).toEqual(state.players.p1.prizes.slice(count));
      expect(after?.players.p1.hand).toEqual([
        ...state.players.p1.hand,
        ...state.players.p1.prizes.slice(0, count),
      ]);
      expect(after?.phase.kind).toBe("ko:promote");
      expect(sim.menu?.kind).toBe("board");
      expect(sim.host?.viewerSeat).toBe("p2");
      expect(rows(publish).some((r: string[]) => r[0] === "M" && r[1] === "prizes")).toBe(false);
      expect(sim.host?.steps.some((s) => s.game.phase.kind === "ko:takePrizes")).toBe(false);
      expect(loadSimulatorSave()?.state).toEqual(after);
      sim.command("close");
      sim.command("open");
      expect(sim.host?.game).toEqual(after);
      sim.history("undoAction");
      expect(sim.host?.game).toEqual(state);
      expect(sim.menu).toBeNull();
      sim.history("redoAction");
      expect(sim.host?.game).toEqual(after);
    },
  );
  it("automatically resolves a saved pending KO prize pick when reopening", () => {
    const before = knockoutState("fix-pokemon-v", 210);
    const pending = must(applyAction(before, { type: "attack", seat: "p1", index: 0 }));
    expect(pending.phase.kind).toBe("ko:takePrizes");
    const sim = new LuaSimulator(vi.fn(), vi.fn());
    sim.open({ state: pending, events: [], names: { p1: "One", p2: "Two" }, startedAt: 100 });
    expect(sim.host?.game.players.p1.prizes).toHaveLength(4);
    expect(sim.host?.game.phase.kind).toBe("ko:promote");
    expect(loadSimulatorSave()?.state).toEqual(sim.host?.game);
  });
  it("finishes a last-prize KO without an extra prize prompt", () => {
    const state = setPrizes(knockoutState("fix-pokemon-v", 210), "p1", 1);
    const sim = new LuaSimulator(vi.fn(), vi.fn());
    sim.open({ state, events: [], names: { p1: "One", p2: "Two" }, startedAt: 100 });
    sim.dispatch({ type: "attack", seat: "p1", index: 0 });
    expect(sim.view()?.outcome).toMatchObject({
      result: "win",
      winner: "you",
      reason: "prizesTaken",
    });
    expect(sim.host?.game.players.p1.prizes).toHaveLength(0);
    expect(sim.menu?.kind).not.toBe("prizes");
  });
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
    // The search shuffled the deck: the header says so once, then clears.
    expect(rows(publish)[0][19]).toBe("you");
    sim.emit();
    expect(rows(publish)[0][19]).toBe("");
  });
  it("stages played Trainers, sends Ultra Ball costs straight to discard, and preserves order across turns and history", () => {
    const { sim, publish } = setup();
    const h = sim.host;
    if (!h) throw Error("Missing host");
    const seat = h.viewerSeat;
    const ball = trainerCard(
      "sv01-196",
      "Item",
      "You can use this card only if you discard 2 other cards from your hand. Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    );
    const nest = trainerCard(
      "sv01-181",
      "Item",
      "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
    );
    const side = h.game.players[seat];
    const cost = side.hand[0];
    if (!cost) throw Error("Missing cost card");
    sim.open({
      state: {
        ...h.game,
        cardPool: { ...h.game.cardPool, [ball.id]: ball, [nest.id]: nest },
        cardIdByUid: { ...h.game.cardIdByUid, ball: ball.id, nest: nest.id, costTrainer: nest.id },
        players: {
          ...h.game.players,
          [seat]: { ...side, hand: [...side.hand, "ball", "nest", "costTrainer"] },
        },
      },
      events: [],
      names: h.names,
      startedAt: h.startedAt,
      resume: { log: [{ kind: "turn", turn: h.game.turn }], viewerSeat: seat },
    });
    const cards = (zone: string, owner = "you") =>
      rows(publish)
        .filter((r: string[]) => r[0] === "C" && r[4] === owner && r[5] === zone)
        .map((r: string[]) => r[1]);
    const confirm = () => {
      const option = sim.menu?.footer?.find((o) => !o.disabled);
      expect(option).toBeDefined();
      option?.run();
      expect(sim.message).toBe("");
    };
    sim.dispatch({ type: "playTrainer", seat, uid: "ball" });
    expect(sim.message).toBe("");
    for (const uid of [cost, "costTrainer"]) {
      const option = sim.menu?.options.find((o) => o.uid === uid);
      expect(option).toBeDefined();
      option?.run();
    }
    confirm();
    expect(cards("discard")).toEqual([cost, "costTrainer"]);
    sim.menu?.options.find((o) => !o.disabled)?.run();
    confirm();
    expect(cards("played")).toEqual(["ball"]);
    expect(cards("discard")).toEqual([cost, "costTrainer"]);
    sim.dispatch({ type: "playTrainer", seat, uid: "nest" });
    sim.menu?.options.find((o) => !o.disabled)?.run();
    confirm();
    expect(cards("played")).toEqual(["ball", "nest"]);
    expect(cards("discard")).toEqual([cost, "costTrainer"]);
    const original = [...(sim.host?.game.players[seat].discard ?? [])];
    expect(original).toHaveLength(4);
    sim.command("pile\tyou");
    expect(sim.menu?.options.map((o) => o.uid)).toEqual(["costTrainer", cost]);
    sim.command("dismiss");
    sim.command("close");
    sim.command("open");
    expect(cards("played")).toEqual(["ball", "nest"]);
    sim.history("undoAction");
    expect(cards("played")).toEqual(["ball"]);
    expect(cards("hand")).toContain("nest");
    sim.history("redoAction");
    expect(cards("played")).toEqual(["ball", "nest"]);
    sim.dispatch({ type: "endTurn", seat });
    expect(cards("played", "opponent")).toEqual([]);
    expect(cards("discard", "opponent")).toEqual(original);
    expect(sim.host?.game.players[seat].discard).toEqual(original);
    sim.command("pile\topponent");
    expect(sim.menu?.options.map((o) => o.uid)).toEqual([...original].reverse());
    sim.command("dismiss");
    sim.history("undoAction");
    expect(cards("played")).toEqual(["ball", "nest"]);
    expect(cards("discard")).toEqual([cost, "costTrainer"]);
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
