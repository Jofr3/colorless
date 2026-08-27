// Phase-derived VIEW of a game: given a `GameState` and a viewer, who owns the
// turn, who must act right now, what interrupt (if any) is parked, and how the
// game ended. This is the ONE exhaustive switch over the `Phase` union, kept
// pure and engine-only so BOTH consumers share it:
//   - the web app's per-viewer playmat projection (local hot-seat play —
//     src/features/game/projection.ts), and
//   - the authoritative match redactor `redactGame` (online play — redact.ts),
//     which the lobby Durable Object runs server-side.
// It was originally authored inside the web projection; it moved here in P4 so
// the server-side redactor derives the same seats/decision from the same code
// rather than a second, drift-prone copy.
//
// Exhaustive on purpose: an M1 defensive turn-parity fallback guessed the TURN
// OWNER, which is the wrong seat to wait on exactly when ko:promote parks (the
// KO'd seat decides mid-attack). With the union complete in-tree, a future
// `Phase` kind is a compile error here instead of a wrong guess.

import type { EffectPrompt } from "./interpreter";
import type { GameOutcome, GameState, Seat } from "./types";
import { SEATS, otherSeat } from "./types";

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
          SEATS.filter((seat) => !phase.ready[seat]),
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
    // effect:choose — a Trainer/Ability parked on a decision. Normally the
    // controller (phase.seat) both owns the turn and owes the decision, so
    // activeSeat and waitingSeat are the same. `resumeTail` marks the two
    // mid-tail parks, which read the turn owner off the pending queue instead
    // (koParkActiveSeat): an on-KO trigger (§9) parks MID-KO-SWEEP during the
    // OPPONENT's turn, so phase.seat is the KO'd player and the turn owner is
    // whoever the sweep sits inside (or null, between turns from a Checkup KO);
    // an ATTACK's effect program (§8 step 4) parks with the attackEpilogue stage
    // queued, where the decider IS the turn owner — koParkActiveSeat returns the
    // same seat, so the two agree without a special case here.
    //
    // `answerer` is the THIRD way the two seats come apart, and the only one
    // where they differ while the turn runs normally: Ortega's printed "your
    // opponent may draw a card" parks a decision on the NON-controller
    // mid-play. It moves waitingSeat alone — the turn is still the
    // controller's, so activeSeat keeps reading phase.seat. An `answerer`
    // park's prompt goes ONLY to the seat that may answer it (the decision is
    // withheld from the other viewer).
    //
    // 🆕🆕 **D426 IS THE FIRST PARK TO SET `answerer` AND `resumeTail` AT ONCE, AND
    // THE TWO TERMS BELOW HANDLE IT WITHOUT A FOURTH CASE.** Ortega and D227's
    // `opponentSwitchOut` are both played from `turn:action`, so every prior
    // `answerer` park had `resumeTail` absent; *"Your opponent discards 2 cards from
    // their hand."* is an ATTACK effect, so it parks with the attackEpilogue queued.
    // `activeSeat` therefore comes off `koParkActiveSeat` rather than `phase.seat` —
    // which returns the SAME seat here, because the sweep sits inside the attacker's
    // turn. That agreement is DRIVEN rather than assumed (`opponentHandDiscard.test.ts`
    // §3 reads both fields from both chairs): a board that handed the answering seat
    // the turn glow would be lying about whose turn it is.
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

/** The turn a parked ko:* interrupt sits INSIDE — or null when it sits BETWEEN
    turns. Attack-origin KOs park with the turn tail still queued behind the ko
    stages (pending: [ko…, endTurn, checkup, startTurn]), so the parity owner
    still owns the turn. A MID-TURN KO (evolve-below-HP, a snipe ability) parks
    with a resumeTurn stage queued behind it (pending: [ko…, resumeTurn]) — still
    inside the actor's turn, so it counts too. So does an ATTACK whose effect
    program parked (pending: [attackEpilogue]): the turn tail has not even been
    seeded yet, and the attacker — who owns the turn by parity — is the one owing
    the decision.
    Checkup-origin KOs park AFTER endTurn and checkup have already drained
    (pending: [ko…, startTurn]) with the turn counter not yet bumped — parity
    would misreport the JUST-ENDED seat as active — so those parks own no turn. */
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

/** The turn-ownership invariant: odd turns belong to firstPlayer. Only
    meaningful while a turn is actually in progress — koParkActiveSeat guards
    the between-turns case, where this parity names the wrong seat.

    🛑 STILL PRIVATE AT D320, AND THE ATTEMPT TO HOIST IT IS WHY THE LINE IS
    HERE. That slice needed *"…moves to the Bench **during their turn**"* in the
    engine core and started by exporting this function; `interpreter.ts` already
    imports `phaseViewOf` for exactly that question (`conditionHolds`'s
    `youPlayedSupporterThisTurn` arm, with the reason written out at the call),
    and this module's own header forbids the parity shortcut by name. **The
    reader already existed** — so the export was reverted and the new scan asks
    `phaseViewOf(state, seat).activeSeat`, like every other core reader of the
    same question. */
function turnOwnerOf(state: GameState): Seat | null {
  if (state.turn < 1 || state.firstPlayer === null) return null;
  return state.turn % 2 === 1 ? state.firstPlayer : otherSeat(state.firstPlayer);
}

/** Both seats can owe a simultaneous setup decision; a single waitingSeat must
    pick one, and the viewer wins the tie — the client's question is "am I being
    waited on?". An empty list never happens (a fully-decided phase is never
    entered), but stay total. */
function preferViewer(undecided: Seat[], viewerSeat: Seat): Seat | null {
  if (undecided.includes(viewerSeat)) return viewerSeat;
  return undecided[0] ?? null;
}
