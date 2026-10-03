// @vitest-environment jsdom
// 🆕🆕🆕 D570 — FESTIVAL LEAD'S ATTACK-AGAIN WINDOW on the LOCAL hot-seat HUD.
//
// The wire half is `redactPhase`'s `mainPhase` (redact.ts, `festivalLeadD570.test.ts` §7);
// `GameHud` folds the SAME window off the live `GameState` (`allowances.attackAgainUid`) and
// the SAME second-declaration bar (`attackAgainBarred`), so this file drives real engine
// boards reached by real actions:
//   (a) before the first attack the panel offers Retreat and the Trainer list — the control;
//   (b) inside the window Retreat is greyed, the Trainer / Ability / Stadium sections are
//       gone, and the attack row is LIVE — R-FL1, mirrored;
//   (c) a window whose licence is lost (Festival Grounds left play) greys the attack row —
//       R-FL2, mirrored;
//   (d) 🆕 D570 review — a LIVE Ability row and a LIVE Stadium row on the same board with the
//       window closed, both withheld inside it (the R-FL1 mirrors (b) could not tell apart).
// ⚠️ CARRIED DISPLAY DEBT (decisions.md D570): no "attack again" banner, and the playmat's drag
// affordances (moveToAction.ts) are not pre-folded against the window.

import type { Card } from "@luminous/schema";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameState, Seat } from "@luminous/engine";
import { applyAction, createGame } from "@luminous/engine";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  must,
  setActiveFromDeck,
  trainerCard,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { projectGameState } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;
const SEAKING = "sv08.5-021";
const FESTIVAL = ["sv06-149", "sv08.5-108"] as const;
const WALL = "d570h-wall";

const FESTIVAL_TEXT =
  "Each Pokémon that has any Energy attached (both yours and your opponent's) recovers from all Special Conditions and can't be affected by any Special Conditions.";

const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  ...Object.fromEntries(
    FESTIVAL.map((id) => [id, { ...trainerCard(id, "Stadium", FESTIVAL_TEXT), name: "Festival Grounds" }]),
  ),
  [SEAKING]: battler(SEAKING, {
    name: "Seaking",
    stage: "Stage1",
    evolveFrom: "Goldeen",
    hp: 110,
    retreat: 1,
    types: ["Water"],
    abilities: [
      {
        type: "Ability",
        name: "Festival Lead",
        effect:
          "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Rapid Draw", damage: 60, effect: "Draw 2 cards." }],
  }),
  [WALL]: battler(WALL, { name: "D570 Wall", hp: 900, retreat: 1, types: ["Colorless"], weaknesses: null }),
};

const DECK = deckOf({ [FESTIVAL[0]]: 1, [FESTIVAL[1]]: 1, [SEAKING]: 2, [WALL]: 26, "fix-energy": 30 });
/** 🆕 D570 review — (d)'s own 60 (D270), so (a)–(c) keep their draws: a benchable activated
    Ability (`fix-drakloak` "Recon Directive") and a Stadium with an activated ability (Town
    Store `sv03-196`, with a `fix-tool` to find). */
const DRAKLOAK = "fix-drakloak";
const TOWN_STORE = "sv03-196";
const MAIN_PHASE_DECK = deckOf({
  [FESTIVAL[0]]: 1,
  [FESTIVAL[1]]: 1,
  [SEAKING]: 2,
  [DRAKLOAK]: 1,
  [TOWN_STORE]: 1,
  "fix-tool": 1,
  [WALL]: 24,
  "fix-energy": 29,
});

/** p1's turn 2 (p2 went first and passed): Seaking Active with two {C}, a Wall on p1's Bench,
    Festival Grounds `sv06-149` in play and its reprint `sv08.5-108` in p1's HAND. */
function board(pile: readonly string[] = DECK): GameState {
  const created = createGame({ seed: 5703, decks: { p1: [...pile], p2: [...pile] }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = pullToDeck(state, "p1", SEAKING);
  state = setActiveFromDeck(state, "p1", SEAKING);
  state = clearBench(clearBench(state, "p1"), "p2");
  state = benchFromDeck(pullToDeck(state, "p1", WALL), "p1", WALL);
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  for (const id of FESTIVAL) state = pullToDeck(state, "p1", id);
  const deck = state.players.p1.deck;
  const inPlay = deck.find((u) => state.cardIdByUid[u] === FESTIVAL[0]) as string;
  const held = deck.find((u) => state.cardIdByUid[u] === FESTIVAL[1]) as string;
  return {
    ...state,
    stadium: { uid: inPlay, owner: "p1" },
    players: {
      ...state.players,
      p1: {
        ...state.players.p1,
        deck: deck.filter((u) => u !== inPlay && u !== held),
        hand: [...state.players.p1.hand, held],
      },
    },
  };
}

/** TEST SURGERY — one copy of `id` into `seat`'s deck (from the hand or the Prizes). */
function pullToDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id}`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** 🆕 D570 review — (d)'s board, IN the window: `board(MAIN_PHASE_DECK)` plus a benched
    Drakloak, attacked once, then (TEST SURGERY) Town Store swapped in for Festival Grounds —
    the old Stadium to p1's discard, every uid in one zone. ⚠️ CONSTRUCTED for the Stadium
    half: only Festival Grounds opens a window and R-FL1 refuses the Stadium play that would
    replace it, so a live Stadium row inside a window is unreachable in play. */
function mainPhaseWindow(): GameState {
  let state = board(MAIN_PHASE_DECK);
  state = benchFromDeck(pullToDeck(state, "p1", DRAKLOAK), "p1", DRAKLOAK);
  state = pullToDeck(must(applyAction(state, { type: "attack", seat: "p1", index: 0 })), "p1", "fix-tool");
  state = pullToDeck(state, "p1", TOWN_STORE);
  const old = state.stadium;
  const side = state.players.p1;
  const store = side.deck.find((u) => state.cardIdByUid[u] === TOWN_STORE) as string;
  return {
    ...state,
    stadium: { uid: store, owner: "p1" },
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => u !== store),
        discard: old === null ? side.discard : [...side.discard, old.uid],
      },
    },
  };
}

function renderHud(state: GameState) {
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
}

const retreatButton = () => screen.getByRole("button", { name: /^Retreat/ }) as HTMLButtonElement;
const attackButton = () => screen.getByRole("button", { name: /Rapid Draw/ }) as HTMLButtonElement;

describe("GameHud — Festival Lead's attack-again window (D570)", () => {
  it("(a) the CONTROL: before the first attack the panel offers Retreat and the Trainer list", () => {
    renderHud(board());
    expect(retreatButton().disabled).toBe(false);
    expect(screen.queryByText("Trainers")).not.toBeNull();
    expect(attackButton().disabled).toBe(false);
  });

  it("(b) inside the window: Retreat greyed, no Trainer / Ability / Stadium section, the attack LIVE [🆕 D570 review: no Ability or Stadium row is live on this board — (d) drives those two]", () => {
    const inWindow = must(applyAction(board(), { type: "attack", seat: "p1", index: 0 }));
    expect(inWindow.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(inWindow.allowances.attackAgainUid).not.toBeNull();
    renderHud(inWindow);
    expect(retreatButton().disabled).toBe(true);
    expect(screen.queryByText("Trainers")).toBeNull();
    expect(screen.queryByText("Abilities")).toBeNull();
    expect(screen.queryByText("Stadium")).toBeNull();
    expect(attackButton().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Pass" })).toBeTruthy();
  });

  // 🆕 D570 REVIEW — (b) passed on its board's defaults for two of the HUD's mirrors: `board()`
  // has no activated Ability and a Stadium with no ability, so "no Abilities / Stadium section"
  // held whether or not the window was folded — MEASURED: dropping the `attackAgainWindow` fold
  // from `abilityOptions` and `stadiumAbility` stayed green. (d) puts both on the board LIVE and
  // renders the SAME state twice, the window closed and open.
  it("(d) a LIVE Ability row and a LIVE Stadium row with the window closed — both withheld inside it", () => {
    const inWindow = mainPhaseWindow();
    expect(inWindow.allowances.attackAgainUid).not.toBeNull();
    renderHud({ ...inWindow, allowances: { ...inWindow.allowances, attackAgainUid: null } });
    expect(screen.queryByText("Abilities")).not.toBeNull();
    expect((screen.getByRole("button", { name: /Recon Directive/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Stadium")).not.toBeNull();
    expect((screen.getByRole("button", { name: /Town Store/ }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    renderHud(inWindow);
    expect(screen.queryByText("Abilities")).toBeNull();
    expect(screen.queryByRole("button", { name: /Recon Directive/ })).toBeNull();
    expect(screen.queryByText("Stadium")).toBeNull();
    expect(screen.queryByRole("button", { name: /Town Store/ })).toBeNull();
  });

  it("(c) a window whose licence is LOST (Festival Grounds left play) greys the attack row", () => {
    const inWindow = must(applyAction(board(), { type: "attack", seat: "p1", index: 0 }));
    renderHud({ ...inWindow, stadium: null });
    expect(attackButton().disabled).toBe(true);
  });
});
