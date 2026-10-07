import type { BoardState, CardBackTone, PlayerId } from "../types";
import { opponentOf } from "./players";
import { PRIZE_COUNT } from "./piles";

export type SetupAnimationStage = "prizes" | "draw" | "turn-draw";

export interface SetupDealSnapshot {
  board: BoardState;
  blueBackPlayer: PlayerId;
  turn: number;
  activePlayer: PlayerId;
  deckCounts?: Record<PlayerId, number>;
}

export interface SetupDeal {
  tone: CardBackTone;
  kind: SetupAnimationStage;
  /** Prize slot, or the appended card's index in its owner's hand. */
  index: number;
}

/** Keep each recipient's die until their first bonus card leaves the deck. */
export function pendingMulliganDrawCounts(
  flights: readonly { deal: SetupDeal; started: boolean }[],
): Record<CardBackTone, number> {
  const counts = { blue: 0, red: 0 };
  for (const tone of ["blue", "red"] as const) {
    const draws = flights.filter(
      (flight) => flight.deal.kind === "draw" && flight.deal.tone === tone,
    );
    if (!draws.some((flight) => flight.started)) counts[tone] = draws.length;
  }
  return counts;
}

export const SETUP_DEAL_STAGGER = 0.09;
export const PRIZE_FLIP_DURATION = 0.24;
export const BONUS_TRAVEL_DURATION = 0.46;
// Leave the full release-pop envelope (0.4s) after the travel phase.
export const BONUS_DEAL_DURATION = BONUS_TRAVEL_DURATION + 0.4;

export function ownerForTone(tone: CardBackTone, blueBackPlayer: PlayerId): PlayerId {
  return tone === "blue" ? blueBackPlayer : opponentOf(blueBackPlayer);
}

/** The start-of-turn draw is the last card appended to the incoming hand. */
export function turnDrawsBetween(
  previous: SetupDealSnapshot | null,
  next: SetupDealSnapshot,
): SetupDeal[] {
  if (previous === null || next.turn < 1 || next.turn !== previous.turn + 1) return [];
  const tone = next.activePlayer === next.blueBackPlayer ? "blue" : "red";
  const previousOwner = ownerForTone(tone, previous.blueBackPlayer);
  const before = previous.board[previousOwner];
  const after = next.board[next.activePlayer];
  if (
    previous.deckCounts &&
    next.deckCounts &&
    next.deckCounts[next.activePlayer] >= previous.deckCounts[previousOwner]
  )
    return [];
  const index = after.hand.length - 1;
  const card = after.hand[index];
  // No draw on deck-out, or when navigating to a snapshot with the same hand.
  if (!card || before.hand.some((existing) => existing.id === card.id)) return [];
  return [{ tone, kind: "turn-draw", index }];
}

/** Compare physical seats, even when local hot-seat play swaps you/opponent. */
export function setupDealsBetween(
  previous: SetupDealSnapshot | null,
  next: SetupDealSnapshot,
): SetupDeal[] {
  // Mounts and restored matches show their current state without replaying setup.
  if (previous === null || previous.turn !== 0 || next.turn > 1) return [];
  const prizes: SetupDeal[] = [];
  const draws: SetupDeal[] = [];
  for (const tone of ["blue", "red"] as const) {
    const before = previous.board[ownerForTone(tone, previous.blueBackPlayer)];
    const owner = ownerForTone(tone, next.blueBackPlayer);
    const after = next.board[owner];
    if (before.prizesRemaining === 0 && after.prizesRemaining === PRIZE_COUNT) {
      for (let index = 0; index < PRIZE_COUNT; index++)
        prizes.push({ tone, kind: "prizes", index });
    }
    // Online updates can include both the last Ready and its automatic bonus.
    // A previously placed Active distinguishes that from the opening deal.
    const hadOpening = before.prizesRemaining === PRIZE_COUNT || before.active !== null;
    if (!hadOpening || after.prizesRemaining !== PRIZE_COUNT) continue;
    // A bonus with no benchable Basic can advance directly to turn one. The
    // first player's ordinary turn draw follows the bonuses in the hand.
    const turnDraw = next.turn === 1 && next.activePlayer === owner ? 1 : 0;
    const added = Math.max(0, after.hand.length - before.hand.length - turnDraw);
    for (let offset = 0; offset < added; offset++) {
      draws.push({ tone, kind: "draw", index: before.hand.length + offset });
    }
  }
  return [...prizes, ...draws];
}
