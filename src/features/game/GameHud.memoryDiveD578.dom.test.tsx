// @vitest-environment jsdom
import type { Card } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameAction, GameState } from "@luminous/engine";
import { applyAction, createGame } from "@luminous/engine";
import { FIXTURE_POOL, battler, deckOf, must } from "../../../packages/engine/src/testFixtures";
import { makeInPlay } from "../../../packages/engine/src/types";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

// 🆕🆕🆕 D578 — the LOCAL HUD lists the engine's ATTACK MENU (`attackMenuOf`): the printed attacks
// first, then Relicanth's Memory Dive rows, each button dispatching its FLAT index; a bar on a
// PRINTED index greys only that printed row (R-MD4 — a borrowed row has no printed index).
// 🆕 D578 landing (R-MD4, RULED: fixed): a borrowed row's own self-lock is NAME-keyed
// (`LockedAttack.attackName`, `lockedAttackNames`) and greys exactly the row of that name.

beforeAll(installDomShims);
afterEach(cleanup);

const RELICANTH = "sv05-084";
const LOW = "d578w-low";
const MID = "d578w-mid";
const FILLER = "d578w-filler";
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [RELICANTH]: battler(RELICANTH, {
    name: "Relicanth",
    hp: 100,
    types: ["Fighting"],
    abilities: [
      {
        type: "Ability",
        name: "Memory Dive",
        effect:
          "Each of your evolved Pokémon can use any attack from its previous Evolutions. (You still need the necessary Energy to use each attack.)",
      },
    ],
    attacks: [{ cost: ["Fighting", "Colorless"], name: "Razor Fin", damage: 30 }],
  }),
  [LOW]: battler(LOW, { name: "Low", hp: 900, types: ["Colorless"], attacks: [{ cost: [], name: "Low Strike", damage: 20 }] }),
  [MID]: battler(MID, {
    name: "Mid",
    stage: "Stage1",
    evolveFrom: "Low",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Mid Strike", damage: 40 }],
  }),
  [FILLER]: battler(FILLER, { name: "D578 Filler", hp: 900, types: ["Colorless"], attacks: [{ cost: [], name: "Tap", damage: 10 }] }),
};
const DECK = deckOf({ [RELICANTH]: 1, [LOW]: 1, [MID]: 1, [FILLER]: 40, "fix-energy": 17 });

/** p1's turn 2: p1 Active an evolved Mid (over Low), with a Relicanth on the Bench when `diver`. */
function board(diver: boolean): GameState {
  const created = createGame({ seed: 5785, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error("createGame failed");
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) break;
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => state.cardIdByUid[h] === FILLER);
    if (uid === undefined) throw new Error(`no filler in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  const p1 = state.players.p1;
  let deck = [...p1.deck, ...p1.hand, ...(p1.active?.stack ?? [])];
  const take = (id: string): string => {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} left`);
    deck = deck.filter((u) => u !== uid);
    return uid;
  };
  const stack = [take(LOW), take(MID)];
  const active = { ...makeInPlay(stack[0] ?? "", 0), stack };
  const bench = diver ? [makeInPlay(take(RELICANTH), 0)] : [];
  return { ...state, players: { ...state.players, p1: { ...p1, hand: [], active, bench, deck } } };
}

function renderHud(state: GameState, dispatch: (action: GameAction) => void = () => {}) {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={{ p1: "Diver", p2: "Other" }}
      dispatch={dispatch}
      onPlayAgain={() => {}}
    />,
  );
}

const attackButton = (name: string) => screen.getByText(name).closest("button") as HTMLButtonElement;

describe("D578 web — the TurnPanel lists the ATTACK MENU", () => {
  it("with a Relicanth on the Bench: the printed Mid Strike, then the borrowed Low Strike — which dispatches flat index 1", () => {
    const dispatch = vi.fn();
    renderHud(board(true), dispatch);
    expect(attackButton("Mid Strike").disabled).toBe(false);
    expect(attackButton("Low Strike").disabled).toBe(false);
    fireEvent.click(attackButton("Low Strike"));
    expect(dispatch).toHaveBeenCalledWith({ type: "attack", seat: "p1", index: 1 });
  });

  it("without one: the printed attack only", () => {
    renderHud(board(false));
    expect(screen.queryByText("Low Strike")).toBeNull();
    expect(attackButton("Mid Strike").disabled).toBe(false);
  });

  it("a bar on PRINTED index 0 greys Mid Strike and leaves the borrowed Low Strike live", () => {
    const state = board(true);
    const barred: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: { ...(state.players.p1.active as NonNullable<GameState["players"]["p1"]["active"]>), lockedAttacks: [{ turn: state.turn, attackIndex: 0 }] },
        },
      },
    };
    renderHud(barred);
    expect(attackButton("Mid Strike").disabled).toBe(true);
    expect(attackButton("Low Strike").disabled).toBe(false);
  });

  it("🆕 a NAME-keyed bar on the borrowed Low Strike greys Low Strike only, and only on its turn (R-MD4, fixed)", () => {
    const state = board(true);
    const named = (turn: number): GameState => ({
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          active: {
            ...(state.players.p1.active as NonNullable<GameState["players"]["p1"]["active"]>),
            lockedAttacks: [{ turn, attackIndex: -1, attackName: "Low Strike" }],
          },
        },
      },
    });
    renderHud(named(state.turn));
    expect(attackButton("Low Strike").disabled).toBe(true);
    expect(attackButton("Mid Strike").disabled).toBe(false);
    cleanup();
    renderHud(named(state.turn - 2));
    expect(attackButton("Low Strike").disabled).toBe(false);
  });
});
