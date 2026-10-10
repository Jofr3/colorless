// @vitest-environment jsdom
// 🆕🆕🆕 D642 — Ange Floette `me04-075`'s Stadium row on the LOCAL HUD (`playableTrainers`), the twin of
// redact.ts's wire row (`stadiumWatchedMeD642.test.ts` §6): greyed with no Prism Tower in play (R-ANF1), lit over
// one, and lit after the player's own Prism Tower play this turn (R-ANF2) — while any other spent Stadium play
// still greys it. Each case is paired with `applyAction`'s own answer on the same board.
import type { Card } from "@luminous/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameState, Seat } from "@luminous/engine";
import { applyAction, createGame } from "@luminous/engine";
import { FIXTURE_POOL, battler, deckOf, must, trainerCard } from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const ANGE = "me04-075";
const TOWER = "me04-080";
const VALLEY = "me02-088";
const FILLER = "d642h-filler";
const stadiumCard = (id: string, name: string): Card => ({ ...trainerCard(id, "Stadium", `${name}.`), name });
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [ANGE]: stadiumCard(ANGE, "Ange Floette"),
  [TOWER]: stadiumCard(TOWER, "Prism Tower"),
  [VALLEY]: stadiumCard(VALLEY, "Dizzying Valley"),
  [FILLER]: battler(FILLER, {
    name: "D642 Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
};
const DECK = deckOf({ [ANGE]: 4, [TOWER]: 4, [VALLEY]: 4, [FILLER]: 28, "fix-energy": 20 });
const NAMES = { p1: "Ember", p2: "Tide" } as const;

/** p1's turn 2 (p2 went first and passed), p1's hand exactly `hand`; `zone` (owned by `owner`) in play. */
function board(hand: readonly string[], zone?: { id: string; owner: Seat }): GameState {
  const created = createGame({ seed: 6421, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  if (zone !== undefined) {
    const side = state.players[zone.owner];
    const uid = side.deck.find((u) => state.cardIdByUid[u] === zone.id) as string;
    state = {
      ...state,
      stadium: { uid, owner: zone.owner },
      players: { ...state.players, [zone.owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
    };
  }
  const side = state.players.p1;
  let deck = [...side.deck];
  const newHand: string[] = [];
  for (const id of hand) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} left`);
    deck = deck.filter((u) => u !== uid);
    newHand.push(uid);
  }
  return { ...state, players: { ...state.players, p1: { ...side, hand: newHand, deck } } };
}

const uidOf = (state: GameState, id: string) => state.players.p1.hand.find((u) => state.cardIdByUid[u] === id) as string;
const playStadium = (state: GameState, id: string) =>
  must(applyAction(state, { type: "playTrainer", seat: "p1", uid: uidOf(state, id) }));

/** The local row's `disabled` for Ange Floette, and the engine's own answer on the same board. */
function angeRow(state: GameState): { disabled: boolean; accepted: boolean } {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, "p1")}
      viewerSeat="p1"
      names={NAMES}
      dispatch={() => {}}
      onPlayAgain={() => {}}
    />,
  );
  const heading = screen.getByText("Trainers");
  const button = within(heading.parentElement as HTMLElement).getByRole("button", {
    name: "Ange Floette",
  }) as HTMLButtonElement;
  const accepted = applyAction(state, { type: "playTrainer", seat: "p1", uid: uidOf(state, ANGE) }).ok;
  cleanup();
  return { disabled: button.disabled, accepted };
}

describe("GameHud — Ange Floette's Stadium row (D642)", () => {
  it("greyed with no Stadium, or another Stadium, in play (R-ANF1)", () => {
    expect(angeRow(board([ANGE]))).toEqual({ disabled: true, accepted: false });
    expect(angeRow(board([ANGE], { id: VALLEY, owner: "p2" }))).toEqual({ disabled: true, accepted: false });
  });

  it("lit over the opponent's Prism Tower", () => {
    expect(angeRow(board([ANGE], { id: TOWER, owner: "p2" }))).toEqual({ disabled: false, accepted: true });
  });

  it("lit after the player's own Prism Tower play this turn (R-ANF2); greyed after any other Stadium play", () => {
    expect(angeRow(playStadium(board([TOWER, ANGE]), TOWER))).toEqual({ disabled: false, accepted: true });
    expect(angeRow(playStadium(board([VALLEY, ANGE], { id: TOWER, owner: "p2" }), VALLEY))).toEqual({
      disabled: true,
      accepted: false,
    });
  });
});
