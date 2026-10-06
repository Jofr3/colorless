// @vitest-environment jsdom
// 🆕🆕🆕 D551 — THE PLAYMAT'S FACE-UP PRIZE SLOT, rendered from ONE driven board through every
// surface that paints a prize grid: OnlineMatch seated as p1, seated as p2 and spectating
// (the wire, `projectionFromRedacted`), and PlaymatView over the LOCAL projection
// (`projectGameState`) for both seats; plus the Pixi prize descriptors off the same board.
//
// ⚠️ THE BOARD IS DRIVEN, NOT CONSTRUCTED: the real Cresselia `sv06.5-021` attacks with
// "Crescent Purge" (index 1), turns p1's prize row index 3 face up and Knocks Out the 150-HP
// defender; p1 then takes the FACE-DOWN prize at row index 0, so the row compacts and the
// face-up card sits at LIVE row index 2 of FIVE. 🛑 That take is the point: with all six
// prizes present the top grid's slot `taken + i` IS slot `i`, and a mapping that ignored the
// flip would be invisible. Every rung below first asserts `prizesRemaining < 6` on the
// face-up side. File-local 60-card deck (D270); the helpers are copied from
// `GameHud.crescentPurge.dom.test.tsx`, where they are file-local.
//
// TEST SURGERY, legal-shaped (two uids swapped between p1's deck and prize row, and one
// between p2's): p1's Cresselia is put at prize row index 3 so the face-up card has a real
// name, and a declared `d551-secret` (D425) is put FACE DOWN in each seat's row so a leak of
// a face-down prize's NAME is detectable at all — every other prize name also appears
// legitimately elsewhere on this board (hands, attachments, discards).

import type { GameAction, GameState, Seat } from "@luminous/engine";
import { applyAction, createGame, redactGame } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  completeSetup,
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  must,
  mustApply,
  setActiveFromDeck,
} from "../../../packages/engine/src/testFixtures";
import { installDomShims } from "../../test/domShims";
import { projectGameState, projectionFromRedacted, type GameProjection } from "../game/projection";
import { OnlineMatch } from "../online/components/OnlineMatch";
import { PlaymatView } from "./PlaymatView";
import type { PlayerId } from "./types";
import { prizeCardDescriptors } from "./utils/cardDescriptors";
import { prizeBackId } from "./utils/piles";

beforeAll(installDomShims);
afterEach(cleanup);

const CRESSELIA = "sv06.5-021";
const SECRET = "d551-secret";
const PURGE = 1;

const LOCAL: Record<string, Card> = {
  "d548-wall": battler("d548-wall", { types: ["Colorless"], hp: 400, retreat: 1 }),
  "d548-frail": battler("d548-frail", { types: ["Colorless"], hp: 150, retreat: 1 }),
  [SECRET]: battler(SECRET, { types: ["Colorless"], hp: 70, retreat: 1 }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [CRESSELIA]: 4,
  "d548-wall": 4,
  "d548-frail": 4,
  "fix-psychic-energy": 20,
  "fix-basic-1": 8,
  "fix-energy": 19,
  [SECRET]: 1,
});

function localSetup(): GameState {
  const created = createGame({ seed: 20260924, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  state = completeSetup(state);
  return state;
}

/** TEST SURGERY: swap the first deck copy of `cardId` with the prize at row index `at`. */
function prizeFromDeck(state: GameState, seat: Seat, cardId: string, at: number): GameState {
  const side = state.players[seat];
  const from = side.deck.findIndex((uid) => state.cardIdByUid[uid] === cardId);
  if (from < 0) throw new Error(`no ${cardId} left in ${seat}'s deck`);
  const deck = [...side.deck];
  const prizes = [...side.prizes];
  const displaced = prizes[at] as string;
  prizes[at] = deck[from] as string;
  deck[from] = displaced;
  return { ...state, players: { ...state.players, [seat]: { ...side, deck, prizes } } };
}

function ready(defender: string): GameState {
  let state = localSetup();
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", CRESSELIA);
  state = attachFromDeck(state, "p1", "fix-psychic-energy", 3);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", defender);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "d548-wall");
  state = prizeFromDeck(state, "p1", CRESSELIA, 3);
  state = prizeFromDeck(state, "p1", SECRET, 4);
  return prizeFromDeck(state, "p2", SECRET, 1);
}

const act = (state: GameState, action: GameAction) => mustApply(state, action).state;
const purgeYes = (state: GameState) =>
  act(act(state, { type: "attack", seat: "p1", index: PURGE }), {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "confirm", yes: true },
  });
const pick = (state: GameState, index: number) =>
  act(state, { type: "resolveEffect", seat: "p1", choice: { kind: "prize", index } });

/** Purge turns row index 3 (Cresselia) face up and KOs the frail; p1 takes the FACE-DOWN
    prize at row index 0; p2's wall is promoted and p2 is left in turn:action. */
function purgedTaken(): GameState {
  const parked = pick(purgeYes(ready("d548-frail")), 3);
  if (parked.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
  return act(parked, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
}

const STATE = purgedTaken();
const FACE_UP_UID = STATE.players.p1.faceUpPrizes[0] as string;
/** The face-up card's LIVE row index (2) and the count taken (1). */
const ROW_INDEX = STATE.players.p1.prizes.indexOf(FACE_UP_UID);
const TAKEN = 6 - STATE.players.p1.prizes.length;
const FACE_DOWN_UIDS = (["p1", "p2"] as const).flatMap((seat) =>
  STATE.players[seat].prizes.filter((uid) => !STATE.players[seat].faceUpPrizes.includes(uid)),
);

describe("🛑 the driven board: a face-up prize on a side that has already taken one", () => {
  it("🛑 one face-up prize (Cresselia) at row index 2 of FIVE — a face-down prize was taken first", () => {
    expect(STATE.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(STATE.players.p1.faceUpPrizes).toHaveLength(1);
    expect(STATE.cardIdByUid[FACE_UP_UID]).toBe(CRESSELIA);
    expect(ROW_INDEX).toBe(2);
    expect(TAKEN).toBe(1);
    expect(STATE.players.p1.prizes.length).toBeLessThan(6);
    expect(STATE.players.p2.prizes).toHaveLength(6);
    expect(STATE.players.p2.faceUpPrizes).toEqual([]);
    // The two declared secrets are FACE DOWN in the rows, and on no other public surface.
    expect(FACE_DOWN_UIDS.filter((uid) => STATE.cardIdByUid[uid] === SECRET)).toHaveLength(2);
    expect(FACE_DOWN_UIDS).toHaveLength(10);
  });
});

const wrap = (node: ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

function renderOnline(viewer: Seat, spectating = false): HTMLElement {
  return wrap(
    <OnlineMatch
      game={redactGame(STATE, viewer, spectating)}
      log={[]}
      youName="Luna"
      opponentName="Sol"
      opponentAway={null}
      actionError={null}
      onAction={vi.fn()}
      onRematch={vi.fn()}
      spectating={spectating}
    />,
  ).container;
}

function renderLocal(viewer: Seat): HTMLElement {
  const projection: GameProjection = projectGameState(STATE, viewer);
  return wrap(
    <PlaymatView
      board={projection.board}
      turn={{
        turn: projection.turn,
        activePlayer: projection.activePlayer ?? "you",
        youName: "Luna",
        opponentName: "Sol",
      }}
      perspective="you"
      onMoveCard={vi.fn()}
      logEntries={[]}
      piles={projection.piles}
    />,
  ).container;
}

const prizeAnchors = (container: HTMLElement, owner: PlayerId) =>
  Array.from(container.querySelectorAll<HTMLElement>(`[data-card-id^="back-prize-${owner}-"]`));

/** Where p1's prize row sits for this viewer: the bottom grid (unflipped) for p1 and a
    spectator (both see p1 as "you"), the top grid (flipped) for p2. */
const SURFACES: {
  title: string;
  mount: () => HTMLElement;
  p1Is: PlayerId;
  board: () => GameProjection;
}[] = [
  {
    title: "OnlineMatch seated as p1 (the owner)",
    mount: () => renderOnline("p1"),
    p1Is: "you",
    board: () => projectionFromRedacted(redactGame(STATE, "p1")),
  },
  {
    title: "OnlineMatch seated as p2 (across the table)",
    mount: () => renderOnline("p2"),
    p1Is: "opponent",
    board: () => projectionFromRedacted(redactGame(STATE, "p2")),
  },
  {
    title: "OnlineMatch SPECTATING (p1 at the bottom)",
    mount: () => renderOnline("p1", true),
    p1Is: "you",
    board: () => projectionFromRedacted(redactGame(STATE, "p1", true)),
  },
  {
    title: "PlaymatView over the LOCAL projection as p1",
    mount: () => renderLocal("p1"),
    p1Is: "you",
    board: () => projectGameState(STATE, "p1"),
  },
  {
    title: "PlaymatView over the LOCAL projection as p2",
    mount: () => renderLocal("p2"),
    p1Is: "opponent",
    board: () => projectGameState(STATE, "p2"),
  },
];

describe("🛑 the face-up prize slot, on every surface (D551)", () => {
  for (const surface of SURFACES) {
    it(`🛑 ${surface.title}: ONE face-up anchor, named, in the mapped slot; the rest are backs`, () => {
      const board = surface.board().board;
      const p2Is: PlayerId = surface.p1Is === "you" ? "opponent" : "you";
      // The flip is VISIBLE on this board: the face-up side has taken a prize.
      expect(board[surface.p1Is].prizesRemaining).toBeLessThan(6);
      expect(board[surface.p1Is].prizesRemaining).toBe(5);

      const container = surface.mount();
      const up = Array.from(container.querySelectorAll<HTMLElement>('[data-prize-face="up"]'));
      expect(up).toHaveLength(1);
      const [anchor] = up as [HTMLElement];
      expect(anchor.getAttribute("data-card-name")).toBe("Cresselia");
      // Owner-viewer (and spectator): bottom slot i. Opponent-viewer: top slot taken + i.
      const slot = surface.p1Is === "you" ? ROW_INDEX : TAKEN + ROW_INDEX;
      expect(slot).toBe(surface.p1Is === "you" ? 2 : 3);
      expect(anchor.getAttribute("data-card-id")).toBe(prizeBackId(surface.p1Is, slot));

      // p1's grid: five anchors, the four others plain backs, in the present slots only.
      const p1Anchors = prizeAnchors(container, surface.p1Is);
      const presentSlots = surface.p1Is === "you" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
      expect(p1Anchors.map((a) => a.getAttribute("data-card-id"))).toEqual(
        presentSlots.map((s) => prizeBackId(surface.p1Is, s)),
      );
      const p1Backs = p1Anchors.filter((a) => a !== anchor);
      expect(p1Backs).toHaveLength(4);
      for (const back of p1Backs) {
        expect(back.hasAttribute("data-prize-face")).toBe(false);
        expect(back.hasAttribute("data-card-name")).toBe(false);
      }
      // p2's grid: six plain backs.
      const p2Anchors = prizeAnchors(container, p2Is);
      expect(p2Anchors).toHaveLength(6);
      for (const back of p2Anchors) {
        expect(back.hasAttribute("data-prize-face")).toBe(false);
        expect(back.hasAttribute("data-card-name")).toBe(false);
      }

      // No face-down prize uid anywhere in the rendered HTML, and no face-down prize NAME:
      // the declared secrets are prized face down in BOTH rows and on no other surface.
      const html = container.innerHTML;
      for (const uid of FACE_DOWN_UIDS) expect(html.includes(`"${uid}"`)).toBe(false);
      expect(html.includes(SECRET)).toBe(false);
      // The screen-reader mirror names the face-up card on its side.
      const summary = container.querySelector('section[aria-label="Board state"]');
      const possessive = surface.p1Is === "you" ? "Your" : "Opponent's";
      expect(summary?.textContent).toContain(
        `${possessive} prizes remaining: 5 (face up: Cresselia).`,
      );
      const p2Possessive = p2Is === "you" ? "Your" : "Opponent's";
      expect(summary?.textContent).toContain(`${p2Possessive} prizes remaining: 6.`);
    });
  }
});

describe("🛑 the Pixi prize descriptors off the same driven board (D551)", () => {
  it("🛑 the face-up slot keeps its slot id and takes the card; every other slot is a back", () => {
    const BACK = "back://twilight/blue";
    for (const viewer of ["p1", "p2"] as const) {
      const board = projectGameState(STATE, viewer).board;
      const owner: PlayerId = viewer === "p1" ? "you" : "opponent";
      const flipped = owner === "opponent";
      expect(board[owner].prizesRemaining).toBeLessThan(6);
      const descriptors = prizeCardDescriptors(board[owner], owner, flipped, "blue", BACK);
      const slot = flipped ? TAKEN + ROW_INDEX : ROW_INDEX;
      const faced = descriptors.filter((d) => d.card.imageUrl !== BACK);
      expect(faced.map((d) => [d.card.id, d.card.cardId, d.card.name])).toEqual([
        [prizeBackId(owner, slot), CRESSELIA, "Cresselia"],
      ]);
      // The fixture pool ships no scan: the face stays undefined, NOT the back.
      expect(faced[0]?.card.imageUrl).toBeUndefined();
      expect(descriptors).toHaveLength(5);
      for (const d of descriptors) expect(JSON.stringify(d)).not.toContain(SECRET);
    }
  });
});
