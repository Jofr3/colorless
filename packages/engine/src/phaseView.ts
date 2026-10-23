// Phase-derived view of a game for a viewer: who owns the turn, who must act now, what interrupt is
// parked, and how the game ended. This is the one exhaustive switch over `Phase`, shared by the web
// playmat projection and the server redactor.

import type { EffectPrompt } from "./interpreter";
import { cardOfUid, isBasicPokemon } from "./cards";
import type { GameOutcome, GameState, Seat } from "./types";
import { SEATS, turnOwnerOf } from "./types";

/** A parked KO interrupt (§8.1 resolution — mid-turn from an attack, or between
    turns from the Checkup) awaiting `waitingSeat`'s decision. Without this a
    projection-driven client soft-locks: the turn controls go dark during a ko:*
    park and nothing says WHAT is being asked. Counts only — never card identity. */
export type PendingDecision =
  | { kind: "takePrizes"; count: number }
  | { kind: "promote" }
  /** A parked mid-effect decision (§15.E/G): a Trainer/Ability search or
      targeting the controller owes. `prompt` carries the legal options the HUD
      renders (search candidates, gust/switch/heal targets). The wire redactor
      strips the prompt — hidden info must not cross the network. */
  | { kind: "effectChoose"; prompt: EffectPrompt };

/** Everything the view derives from the phase (engine seats — the caller maps
    them per viewer). */
export interface PhaseView {
  /** Turn owner; null in setup, between turns (checkup-origin ko:* parks) and
      once the game is over. */
  activeSeat: Seat | null;
  /** The seat that must act; null once the game is over. */
  waitingSeat: Seat | null;
  pendingDecision: PendingDecision | null;
  /** Unmapped engine outcome; non-null only on gameOver. */
  outcome: GameOutcome | null;
}

/** THE one exhaustive switch over the `Phase` union. See the module header. */
export function phaseViewOf(state: GameState, viewerSeat: Seat): PhaseView {
  const none = { pendingDecision: null, outcome: null };
  const phase = state.phase;
  switch (phase.kind) {
    // Setup: turn 0, nobody OWNS a turn (activeSeat null) — but somebody still
    // owes a decision, which waitingSeat carries.
    case "setup:chooseFirst":
      return { ...none, activeSeat: null, waitingSeat: phase.coinWinner };
    case "setup:drawExtra":
      return {
        ...none,
        activeSeat: null,
        waitingSeat: preferViewer(
          SEATS.filter((seat) => !phase.decided[seat]),
          viewerSeat,
        ),
      };
    case "setup:place":
      return {
        ...none,
        activeSeat: null,
        waitingSeat: preferViewer(
          SEATS.filter(
            (seat) =>
              !phase.ready[seat] &&
              (phase.stage !== "opening" ||
                state.players[seat].active !== null ||
                state.players[seat].hand.some((uid) => {
                  const card = cardOfUid(state, uid);
                  return card !== undefined && isBasicPokemon(card);
                })),
          ),
          viewerSeat,
        ),
      };
    case "turn:action":
      return { ...none, activeSeat: phase.seat, waitingSeat: phase.seat };
    // ko:* — phase.seat is the DECIDER (prize taker / promoter), not the turn
    // owner. Whether a turn is even in progress depends on the KO's ORIGIN,
    // which the pending queue still records — see koParkActiveSeat.
    case "ko:takePrizes":
      return {
        activeSeat: koParkActiveSeat(state),
        waitingSeat: phase.seat,
        pendingDecision: { kind: "takePrizes", count: phase.count },
        outcome: null,
      };
    case "ko:promote":
      return {
        activeSeat: koParkActiveSeat(state),
        waitingSeat: phase.seat,
        pendingDecision: { kind: "promote" },
        outcome: null,
      };
    // effect:choose: normally the controller both owns the turn and owes the decision. `resumeTail`
    // marks the mid-tail parks, which read the turn owner off the pending queue instead
    // (`koParkActiveSeat`).
    case "effect:choose": {
      const answerer = phase.answerer ?? phase.seat;
      const withheld = phase.answerer !== undefined && phase.answerer !== viewerSeat;
      return {
        activeSeat: phase.resumeTail === true ? koParkActiveSeat(state) : phase.seat,
        waitingSeat: answerer,
        pendingDecision: withheld ? null : { kind: "effectChoose", prompt: phase.prompt },
        outcome: null,
      };
    }
    case "gameOver":
      return { ...none, activeSeat: null, waitingSeat: null, outcome: phase.outcome };
  }
  // Only reachable when the switch above stops covering the Phase union — then
  // `phase` is no longer never and this line refuses to compile.
  return phase satisfies never;
}

/** True until the engine reveals the boards: every setup:* phase. The engine
    emits SETUP_REVEALED when the second player readies and transitions straight
    into turn:action (setup.ts), so "phase is setup" is exactly "placements are
    still face-down". Consumed by the board redaction (local projection + wire
    redactor), not by phaseViewOf itself. */
export function inSetup(state: GameState): boolean {
  switch (state.phase.kind) {
    case "setup:chooseFirst":
    case "setup:drawExtra":
    case "setup:place":
      return true;
    default:
      return false;
  }
}

/** The turn a parked ko:* interrupt sits inside, or null when it sits between turns. */
function koParkActiveSeat(state: GameState): Seat | null {
  const inTurn = state.pending.some(
    (stage) =>
      stage.kind === "endTurn" ||
      stage.kind === "checkup" ||
      stage.kind === "resumeTurn" ||
      stage.kind === "attackEpilogue",
  );
  return inTurn ? turnOwnerOf(state) : null;
}

/** Both seats can owe a simultaneous setup decision; a single waitingSeat must
    pick one, and the viewer wins the tie — the client's question is "am I being
    waited on?". An empty list never happens (a fully-decided phase is never
    entered), but stay total. */
function preferViewer(undecided: Seat[], viewerSeat: Seat): Seat | null {
  if (undecided.includes(viewerSeat)) return viewerSeat;
  return undecided[0] ?? null;
}
