import { describe, expect, it, vi } from "vitest";
import { applyAction, redactGame, type GameAction } from "@colorless/engine";
import {
  attachFromDeck,
  benchFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  RARE_CANDY_DECK,
} from "@colorless/engine/testing";
import { cardActions, forcedRetreat } from "./simulatorActions";

function candyTable() {
  let state = driveSetup(
    4,
    { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK },
    {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
      bench: { p1: ["fix-basic-1"] },
    },
  );
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw Error("Expected action phase");
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  state = handFromDeck(state, "p1", "sv01-191", 1);
  state = handFromDeck(state, "p1", "fix-stage2", 1);
  return {
    state,
    candy: handUid(state, "p1", "sv01-191"),
    stage2: handUid(state, "p1", "fix-stage2"),
  };
}

describe("card actions", () => {
  it("offer every hand card's plays through the host's gate and send", () => {
    const { state, stage2 } = candyTable();
    const sent: GameAction[] = [];
    const host = { allowed: () => true, dispatch: (a: GameAction) => sent.push(a) };
    const actions = cardActions(redactGame(state, "p1"), host, null);
    const evolve = actions.get(stage2) ?? [];
    expect(evolve.length).toBeGreaterThan(0);
    expect(new Set(evolve.map((a) => a.group))).toEqual(new Set(["evolve", undefined]));
    const closed = cardActions(redactGame(state, "p1"), { ...host, allowed: () => false }, null);
    expect(closed.get(stage2)?.every((a) => a.disabled)).toBe(true);
    evolve[0]?.run();
    expect(sent).toHaveLength(1);
  });

  it("a staged Rare Candy offers only its evolutions and Cancel on the Candy", () => {
    const { state, candy, stage2 } = candyTable();
    const cancel = vi.fn();
    const sent: GameAction[] = [];
    const host = { allowed: () => true, dispatch: (a: GameAction) => sent.push(a) };
    const view = redactGame(state, "p1");
    if (view.phase.kind !== "turn:action") throw Error("Expected action phase");
    const stage2s = view.phase.rareCandy.flatMap((o) => o.stage2.map((e) => e.uid));
    const actions = cardActions(view, host, { uid: candy, cancel });
    expect(stage2s).toContain(stage2);
    expect([...actions.keys()].sort()).toEqual([...new Set([candy, ...stage2s])].sort());
    expect(actions.get(stage2)?.every((a) => a.group === "evolve")).toBe(true);
    actions.get(stage2)?.[0]?.run();
    expect(sent[0]).toMatchObject({ type: "rareCandy", uid: candy, evolutionUid: stage2 });
    actions.get(candy)?.[0]?.run();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("the Active's Retreat", () => {
  it("opens the Bench pick, priced and gated by the engine's retreat", () => {
    let state = driveSetup(7, undefined, { first: "p1" });
    state = attachFromDeck(benchFromDeck(state, "p1", "fix-basic-1"), "p1", "fix-energy", 2);
    const view = redactGame(state, "p1");
    if (view.phase.kind !== "turn:action") throw Error("Expected action phase");
    const retreat = vi.fn();
    const host = { allowed: () => true, dispatch: () => {}, retreat };
    const activeUid = view.board.you.active?.id ?? "";
    const find = (v: typeof view) =>
      cardActions(v, host, null)
        .get(activeUid)
        ?.find((a) => a.group === "retreat");
    view.phase.retreat = { can: true, cost: 2 };
    const live = find(view);
    expect(live).toMatchObject({
      label: "Retreat",
      disabled: false,
      cost: ["Colorless", "Colorless"],
    });
    live?.run();
    expect(retreat).toHaveBeenCalledOnce();
    view.phase.retreat = { can: false, cost: 0 };
    expect(find(view)).toMatchObject({ disabled: true, cost: [] });
    view.phase.retreat = null;
    expect(find(view)?.disabled).toBe(true);
    const benched = view.board.you.bench[0]?.id ?? "";
    const benchedActions = cardActions(view, host, null).get(benched) ?? [];
    expect(benchedActions.some((a) => a.group === "retreat")).toBe(false);
  });
});

describe("forced retreat", () => {
  it("pays from the first Energy when every attached one is alike, and asks otherwise", () => {
    let state = driveSetup(7, undefined, { first: "p1" });
    state = benchFromDeck(state, "p1", "fix-basic-1");
    const view = redactGame(state, "p1");
    if (view.phase.kind !== "turn:action") throw Error("Expected action phase");
    view.phase.retreat = { can: true, cost: 1 };
    expect(forcedRetreat(view, 0)).toMatchObject({ type: "retreat", discardEnergy: [] });
    const paid = redactGame(attachFromDeck(state, "p1", "fix-energy", 2), "p1");
    if (paid.phase.kind !== "turn:action") throw Error("Expected action phase");
    paid.phase.retreat = { can: true, cost: 1 };
    const energies = paid.board.you.active?.attached?.energies ?? [];
    expect(forcedRetreat(paid, 0)).toMatchObject({ discardEnergy: [energies[0]?.id] });
    const mixed = structuredClone(paid);
    const second = mixed.board.you.active?.attached?.energies[1];
    if (second) second.cardId = "another-energy";
    expect(forcedRetreat(mixed, 0)).toBeNull();
  });
});
