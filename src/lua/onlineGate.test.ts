import { type GameAction, type GameState, SEATS, applyAction, redactGame } from "@colorless/engine";
import { describe, expect, it } from "vitest";
import {
  EVOLVE_DECK,
  MIXED_DECK,
  RARE_CANDY_DECK,
  STADIUM_ABILITY_DECK,
  STADIUM_TOOL_DECK,
  TRAINER_DECK,
  candidateActions,
  driveSetup,
  firstBasicInHand,
  mustCreate,
  inAttackAgainWindow,
  walkGame,
} from "../../packages/engine/src/testFixtures";
import { onlineGate } from "./onlineTable";

const DECKS: [string, string[], number][] = [
  ["mixed", MIXED_DECK, 23],
  ["evolve", EVOLVE_DECK, 24],
  ["trainer", TRAINER_DECK, 25],
  ["stadium tool", STADIUM_TOOL_DECK, 26],
  ["stadium ability", STADIUM_ABILITY_DECK, 27],
  ["rare candy", RARE_CANDY_DECK, 28],
];

describe("the online gate", () => {
  it.for(DECKS)(
    "never greys out a legal action on a seeded %s walk, for both seats, inside and outside the window",
    async ([, deck, seed], { annotate }) => {
      const misses = new Map<string, string>();
      // Offered but refused: the gate defers what the wire does not carry to the server's refusal.
      const offeredRefused = new Map<string, number>();
      walkGame(mustCreate(7, { p1: deck, p2: deck }).state, seed, (state) => {
        for (const board of [state, inAttackAgainWindow(state)]) {
          if (board === null) continue;
          for (const seat of SEATS) {
            const view = redactGame(board, seat);
            for (const action of candidateActions(board, seat)) {
              const result = applyAction(board, action);
              const gated = onlineGate(action, view);
              if (result.ok && !gated)
                misses.set(`${action.type} in ${board.phase.kind}`, JSON.stringify(action));
              if (!result.ok && gated) {
                const key = `${action.type} ${result.error.code}`;
                offeredRefused.set(key, (offeredRefused.get(key) ?? 0) + 1);
              }
            }
          }
        }
      });
      await annotate(
        [...offeredRefused]
          .sort()
          .map(([key, n]) => `${key} ×${n}`)
          .join("\n"),
      );
      expect([...misses]).toEqual([]);
    },
  );

  it("offers the opening Active before any Bench placement, and only once", () => {
    let state = mustCreate(7).state;
    if (state.phase.kind === "setup:chooseFirst") {
      const winner = state.phase.coinWinner;
      const chosen = applyAction(state, { type: "chooseFirstPlayer", seat: winner, first: winner });
      if (!chosen.ok) throw new Error(chosen.error.message);
      state = chosen.state;
    }
    if (state.phase.kind !== "setup:place") throw new Error(`Got ${state.phase.kind}`);
    const [first, second] = state.players.p1.hand.filter(
      (uid) => state.cardPool[state.cardIdByUid[uid] ?? ""]?.stage === "Basic",
    );
    if (first === undefined || second === undefined) throw new Error("Expected two Basics");
    const verdicts = (s: GameState) =>
      (["setupPlaceActive", "setupPlaceBench"] as const).map((type) => {
        const action: GameAction = { type, seat: "p1", uid: second };
        return [type, applyAction(s, action).ok, onlineGate(action, redactGame(s, "p1"))];
      });
    expect(verdicts(state)).toEqual([
      ["setupPlaceActive", true, true],
      ["setupPlaceBench", false, false],
    ]);
    const placed = applyAction(state, { type: "setupPlaceActive", seat: "p1", uid: first });
    if (!placed.ok) throw new Error(placed.error.message);
    expect(verdicts(placed.state)).toEqual([
      ["setupPlaceActive", false, false],
      ["setupPlaceBench", true, true],
    ]);
  });

  it("offers only the second attack and ending the turn inside the attack-again window", () => {
    const state = driveSetup(7, undefined, { first: "p1" });
    const window = inAttackAgainWindow(state);
    if (window === null) throw new Error("Expected p1's turn");
    const basic = firstBasicInHand(state, "p1");
    const actions: GameAction[] = [
      { type: "playBasicToBench", seat: "p1", uid: basic },
      { type: "endTurn", seat: "p1" },
    ];
    const outside = redactGame(state, "p1");
    const inside = redactGame(window, "p1");
    expect(outside.phase).not.toHaveProperty("attackAgain");
    expect(inside.phase).toHaveProperty("attackAgain", true);
    expect(actions.map((a) => [applyAction(state, a).ok, onlineGate(a, outside)])).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(actions.map((a) => [applyAction(window, a).ok, onlineGate(a, inside)])).toEqual([
      [false, false],
      [true, true],
    ]);
  });
});
