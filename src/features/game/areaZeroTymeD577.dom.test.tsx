// @vitest-environment jsdom
import type { Card, RedactedGame } from "@luminous/schema";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "@luminous/engine";
import { applyAction, createGame, redactGame } from "@luminous/engine";
import { FIXTURE_POOL, battler, deckOf, must, trainerCard } from "../../../packages/engine/src/testFixtures";
import { makeInPlay } from "../../../packages/engine/src/types";
import { installDomShims } from "../../test/domShims";
import { OnlineHud } from "../online/components/OnlineHud";
import { PlayerSide } from "../playmat/components/PlayerSide";
import { benchLimitFor } from "../playmat/constants";
import type { BoardState, PlayerBoard } from "../playmat/types";
import { projectGameState, projectionFromRedacted } from "./projection";

// 🆕🆕🆕 D577 — the web half of the slice: the playmat's Bench limit is PER SEAT (Area Zero Underdepths
// widens only a side with a Tera Pokémon in play — the engine's `benchLimitOf`, written onto
// `PlayerBoard.benchLimit` by BOTH projections), and Tyme's `guessHp` dialog on the ONLINE surface (the
// opponent answers with a whole number; the prompt carries the told name and nothing else).

beforeAll(installDomShims);
afterEach(cleanup);

const UNDERDEPTHS = "sv07-131";
const TERA = "sv06-025"; // Teal Mask Ogerpon ex — a Tera Basic (banners.ts)
const FILLER = "d577w-filler";
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [UNDERDEPTHS]: {
    ...trainerCard(UNDERDEPTHS, "Stadium", "Each player who has any Tera Pokémon in play can have up to 8 Pokémon on their Bench."),
    name: "Area Zero Underdepths",
  },
  [TERA]: battler(TERA, { name: "Teal Mask Ogerpon ex", hp: 210, types: ["Grass"] }),
  [FILLER]: battler(FILLER, {
    name: "D577 Filler",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
};
const DECK = deckOf({ [UNDERDEPTHS]: 1, [TERA]: 2, [FILLER]: 40, "fix-energy": 17 });

/** p1's turn 2: p1 Active a Tera body and `bench` fillers, p2 a filler alone; Underdepths in play
    (owned by p1) when `stadium`. */
function board(bench: number, stadium: boolean): GameState {
  const created = createGame({ seed: 5777, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  let deck = [...p1.deck, ...(p1.active?.stack ?? [])];
  const take = (id: string): string => {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} left`);
    deck = deck.filter((u) => u !== uid);
    return uid;
  };
  const active = makeInPlay(take(TERA), 0);
  const benchBodies = Array.from({ length: bench }, () => makeInPlay(take(FILLER), 0));
  const stadiumUid = stadium ? take(UNDERDEPTHS) : null;
  state = { ...state, players: { ...state.players, p1: { ...p1, active, bench: benchBodies, deck } } };
  return stadiumUid === null ? state : { ...state, stadium: { uid: stadiumUid, owner: "p1" } };
}

describe("D577 web §1 — the Bench limit is per seat, and both projections carry the engine's", () => {
  it("Underdepths + a Tera Active: the viewer's side projects 8, the opponent's (no Tera) carries none (5)", () => {
    const state = board(6, true);
    const local = projectGameState(state, "p1").board;
    expect(local.you.benchLimit).toBe(8);
    expect(local.opponent.benchLimit).toBeUndefined();
    expect(benchLimitFor(local, "you")).toBe(8);
    expect(benchLimitFor(local, "opponent")).toBe(5);
    // The ONLINE board reads the same limit off the wire's public card ids.
    const online = projectionFromRedacted(redactGame(state, "p1")).board;
    expect(online.you.benchLimit).toBe(8);
    expect(online.opponent.benchLimit).toBeUndefined();
    // …and from the OPPONENT's chair the widened side is theirs to see too.
    const theirs = projectionFromRedacted(redactGame(state, "p2")).board;
    expect(theirs.opponent.benchLimit).toBe(8);
  });

  it("no Stadium: every board projects byte for byte as before (no `benchLimit` key at all)", () => {
    const local = projectGameState(board(3, false), "p1").board;
    expect("benchLimit" in local.you).toBe(false);
    expect(benchLimitFor(local, "you")).toBe(5);
  });

  it("Lumiose City (`me3-111`) still widens BOTH sides on a board that carries no engine limit", () => {
    const side: PlayerBoard = { hand: [], active: null, bench: [], prizesRemaining: 6, faceUpPrizes: [] };
    const lumiose: BoardState = {
      stadium: { id: "s", name: "Lumiose City", cardId: "me3-111", type: "stadium" },
      you: side,
      opponent: side,
    };
    expect([benchLimitFor(lumiose, "you"), benchLimitFor(lumiose, "opponent")]).toEqual([8, 8]);
  });

  it("the Bench frame is drawn for 8 slots on the widened side", () => {
    const local = projectGameState(board(7, true), "p1").board;
    const { container } = render(
      <PlayerSide owner="you" side="bottom" player={local.you} benchLimit={benchLimitFor(local, "you")} />,
    );
    const frames = Array.from(container.querySelectorAll<HTMLElement>("[style*='--card-w']"));
    expect(frames.some((el) => el.style.width.includes("(8 +"))).toBe(true);
  });
});

describe("D577 web §2 — Tyme's guess on the ONLINE surface", () => {
  function guessGame(): RedactedGame {
    const emptySide: RedactedGame["board"]["you"] = {
      hand: [],
      active: null,
      bench: [],
      prizesRemaining: 6,
      faceUpPrizes: [],
      deckCount: 50,
      discard: [],
    };
    return {
      seat: "p2",
      turn: 3,
      phase: {
        kind: "effect:choose",
        prompt: { kind: "guessHp", name: "Pikachu ex", note: "Guess the HP of your opponent's Pikachu ex." },
      },
      board: { stadium: null, you: emptySide, opponent: emptySide },
      activePlayer: "opponent",
      waitingOn: "you",
      outcome: null,
    };
  }

  it("renders the told name, holds Guess until a whole number, and dispatches the hpGuess", () => {
    const onAction = vi.fn();
    render(<OnlineHud game={guessGame()} waitingOn="you" activePlaced={false} onAction={onAction} />);
    expect(screen.getByText("Guess the HP of your opponent's Pikachu ex.")).toBeTruthy();
    const guess = screen.getByRole("button", { name: "Guess" }) as HTMLButtonElement;
    expect(guess.disabled).toBe(true);
    const input = screen.getByLabelText(/HP of Pikachu ex/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "59.5" } });
    expect(guess.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "190" } });
    expect(guess.disabled).toBe(false);
    fireEvent.click(guess);
    expect(onAction).toHaveBeenCalledWith({ type: "resolveEffect", seat: "p2", choice: { kind: "hpGuess", hp: 190 } });
  });
});
