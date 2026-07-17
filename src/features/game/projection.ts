// Engine → playmat projection (P3, alongside M1). The engine's GameState is
// deliberately not the playmat's BoardState — zones hold card uids resolved
// through cardIdByUid → cardPool — so this pure adapter builds the CardModel
// view the playmat renders. It is PER-VIEWER: the same hidden-information
// rule P4's server-side filter will apply. What each viewer sees:
//
//   - their own hand face-up; the opponent's hand as anonymous face-down
//     backs (count only — no card identity anywhere, not even in ids);
//   - BOTH prize sets as counts only (prizes are face-down in the real game);
//   - decks as counts; discard piles fully public (§2 — ordered and public);
//   - in-play Pokémon (active/bench) public once setup is over, with their
//     attached cards and their battle state (`CardModel.battle` — damage/max
//     HP and the §12 special conditions all sit face-up on the table).
//     DURING the setup:* phases (§3 — placements stay face-down until both
//     players ready; the engine emits SETUP_REVEALED only then) the
//     OPPONENT's active/bench project as anonymous positional backs with no
//     `battle` (a battle row would leak the printed HP); the viewer's OWN
//     placements stay face-up.
//
// Public cards keep the engine uid as CardModel.id — the Pixi layer keys its
// views off that id, so a card animates as ONE object as it moves between
// zones across successive projections (hand → bench, hand → attached, …).
//
// Built on the M1 zone surface plus M2's phases. Everything phase-derived
// (activePlayer / waitingOn / pendingDecision / outcome) comes out of ONE
// exhaustive switch over the Phase union, so a future engine phase is a
// compile error here rather than a silently wrong guess — M1's defensive
// turn-parity fallback named the wrong seat exactly when ko:promote parked.

import type {
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  Seat,
  SpecialConditions,
} from "@luminous/engine";
import { SEATS, cardOfUid, hpOf, otherSeat, topUid } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import { cardImageUrl } from "../../lib/api";
import type {
  BattleConditions,
  BattleState,
  BoardState,
  CardModel,
  CardType,
  PlayerBoard,
  PlayerId,
} from "../playmat/types";

/** The `cardId` every hidden (face-down) card carries instead of a catalog id. */
export const HIDDEN_CARD_ID = "hidden";
export const HIDDEN_CARD_NAME = "Face-down card";

/** The zones BoardState cannot carry: deck size and the public discard. */
export interface ProjectedPiles {
  /** Cards left in the deck — contents hidden, only the count is visible. */
  deckCount: number;
  /** The discard pile, fully public, oldest → newest (engine order). */
  discard: CardModel[];
}

/** A parked KO interrupt (§8.1 resolution — mid-turn from an attack, or
    between turns from the Checkup) awaiting `waitingOn`'s decision. Without
    this a projection-driven client soft-locks: the turn controls go dark
    during a ko:* park and nothing would say WHAT is being asked. Counts
    only — never card identity. */
export type PendingDecision = { kind: "takePrizes"; count: number } | { kind: "promote" };

/** The engine's GameOutcome with seats mapped into the viewer's vocabulary. */
export type ProjectedOutcome =
  | { result: "win"; winner: PlayerId; reason: GameOverReason }
  | { result: "tie"; reasons: Record<PlayerId, GameOverReason> };

export interface GameProjection {
  /** Drop-in playmat board; `you` is always the viewer's seat. */
  board: BoardState;
  /** Deck counts + public discards, per side, keyed like the board. */
  piles: Record<PlayerId, ProjectedPiles>;
  /** 1-based turn counter; 0 while the game is still in setup. */
  turn: number;
  /** The TURN OWNER from the viewer's perspective. An ATTACK-origin ko:*
      park does not change it (the turn is still the attacker's); a
      CHECKUP-origin ko:* park sits BETWEEN turns, so it is null there —
      just as during setup (turn 0) and once the game is over. */
  activePlayer: PlayerId | null;
  /** Who must act RIGHT NOW: the turn owner in turn:action, the decision
      owner in setup and ko:* phases — ko:promote belongs to the KO'd seat,
      NOT the turn owner. Null once the game is over. */
  waitingOn: PlayerId | null;
  /** The KO interrupt the game is parked on; null in every other phase. */
  pendingDecision: PendingDecision | null;
  /** How the game ended, seats viewer-mapped; null while it is running. */
  outcome: ProjectedOutcome | null;
}

/** Project the engine state into what `viewerSeat` is allowed to see. Pure:
    same state + seat in, structurally-equal projection out. */
export function projectGameState(state: GameState, viewerSeat: Seat): GameProjection {
  const opponentSeat = otherSeat(viewerSeat);
  const view = phaseViewOf(state, viewerSeat);
  // Setup placements are face-down until both players ready, so the
  // opponent's in-play stacks (their battle rows included) redact until
  // then. The viewer's own placements stay face-up — they placed them.
  const setup = inSetup(state);
  return {
    board: {
      // No stadium zone in the engine yet (lands with M4's trainers).
      stadium: null,
      you: playerBoardOf(state, viewerSeat, { faceUpHand: true, faceUpInPlay: true }),
      opponent: playerBoardOf(state, opponentSeat, { faceUpHand: false, faceUpInPlay: !setup }),
    },
    piles: {
      you: pilesOf(state, viewerSeat),
      opponent: pilesOf(state, opponentSeat),
    },
    turn: state.turn,
    activePlayer: asPlayerId(view.activeSeat, viewerSeat),
    waitingOn: asPlayerId(view.waitingSeat, viewerSeat),
    pendingDecision: view.pendingDecision,
    outcome: view.outcome === null ? null : outcomeFor(view.outcome, viewerSeat),
  };
}

/** How much of a side the viewer may see. The two redactions are
    independent: the opponent's HAND is always face-down, their IN-PLAY
    stacks only during setup (see hiddenInPlayModel). The viewer's own side
    is always fully face-up. */
interface SideVisibility {
  faceUpHand: boolean;
  faceUpInPlay: boolean;
}

function playerBoardOf(state: GameState, seat: Seat, visibility: SideVisibility): PlayerBoard {
  const side = state.players[seat];
  return {
    hand: visibility.faceUpHand
      ? side.hand.map((uid) => cardModelOf(state, uid))
      : hiddenHand(side.hand.length),
    active:
      side.active === null
        ? null
        : visibility.faceUpInPlay
          ? inPlayModelOf(state, side.active)
          : hiddenInPlayModel("opponent-active-hidden"),
    // Index-stable: an (engine-impossible) empty stack projects as a slot
    // placeholder rather than vanishing — compacting the bench would desync
    // every index-addressed slot (promotions, drops) from the engine's.
    bench: visibility.faceUpInPlay
      ? side.bench.map(
          (pokemon, index) => inPlayModelOf(state, pokemon) ?? emptyStackModel(seat, index),
        )
      : side.bench.map((_, index) => hiddenInPlayModel(`opponent-bench-${index}-hidden`)),
    // Count only — prizes are face-down for BOTH players (§3.8), so no uid or
    // catalog id of a prize card may appear anywhere in the projection.
    prizesRemaining: side.prizes.length,
  };
}

function pilesOf(state: GameState, seat: Seat): ProjectedPiles {
  const side = state.players[seat];
  return {
    deckCount: side.deck.length,
    discard: side.discard.map((uid) => cardModelOf(state, uid)),
  };
}

/** A public card: full identity, keyed by its engine uid. */
function cardModelOf(state: GameState, uid: string): CardModel {
  const card = cardOfUid(state, uid);
  if (card === undefined) {
    // Unreachable in practice (createGame validates every deck id against the
    // pool), but the adapter stays total: an identity-only placeholder that
    // still animates under its uid. "trainer" is the neutral type, the same
    // convention the animation layer uses for its synthetic backs.
    const cardId = state.cardIdByUid[uid] ?? uid;
    return { id: uid, cardId, name: cardId, type: "trainer" };
  }
  return {
    id: uid,
    cardId: card.id,
    name: card.name,
    type: cardTypeOf(card),
    // `card.image` is the asset base path or null (no scan) — the URL itself
    // comes from the one existing helper so the scheme lives in one place.
    imageUrl: card.image === null ? undefined : cardImageUrl(card.id, "high"),
  };
}

/** An in-play Pokémon: the top of the stack defines its identity (§1.2);
    attached energy/tools ride along as face-up CardModels; its battle state
    (damage, max HP, §12 special conditions — all public table facts) rides
    on the model as `battle`. Only in-play top cards ever carry `battle`, and
    only face-up ones — the setup-phase hidden backs go through
    hiddenInPlayModel instead, so redaction never leaks a printed HP. The
    lower stack cards (evolution, M4) still have no projection surface. */
function inPlayModelOf(state: GameState, pokemon: InPlayPokemon): CardModel | null {
  const uid = topUid(pokemon);
  if (uid === undefined) return null; // stacks are never empty, but stay total
  const card = cardOfUid(state, uid);
  return {
    ...cardModelOf(state, uid),
    battle: battleStateOf(pokemon, card),
    attached: {
      tools: pokemon.tools.map((toolUid) => cardModelOf(state, toolUid)),
      energies: pokemon.energy.map((energyUid) => cardModelOf(state, energyUid)),
    },
  };
}

/** The playmat-facing battle row: a field-by-field COPY (never an alias) of
    the engine values — a consumer mutating a projection must not reach back
    into game state. The playmat restates the engine's SpecialConditions as
    BattleConditions to stay engine-free; the copy alone would NOT pin that
    restatement (a field added to SpecialConditions would just be dropped
    here and silently never render), so the asserts below do. */
function battleStateOf(pokemon: InPlayPokemon, card: Card | undefined): BattleState {
  const { rotation, poisonDamage, burned } = pokemon.conditions;
  // Mutual-assignability pin, both directions: `satisfies` = the rebuilt
  // copy is still a COMPLETE SpecialConditions (an added engine field errors
  // here); the annotation = it is an exact BattleConditions (playmat-side
  // drift errors here).
  const conditions: BattleConditions = {
    rotation,
    poisonDamage,
    burned,
  } satisfies SpecialConditions;
  return {
    damage: pokemon.damage,
    hp: card === undefined ? null : hpOf(card),
    conditions,
  };
}

/** The slot-holder projected for an empty in-play stack (see playerBoardOf).
    Positional id like the hidden-hand backs; a distinct cardId, because
    "empty" is NOT a face-down card — there is nothing there. "trainer" is
    the neutral placeholder type again. */
function emptyStackModel(seat: Seat, index: number): CardModel {
  return {
    id: `${seat}-bench-${index}-empty`,
    cardId: "empty",
    name: "Empty slot",
    type: "trainer",
  };
}

/** True until the engine reveals the boards: every setup:* phase. The engine
    emits SETUP_REVEALED when the second player readies and transitions
    straight into turn:action (packages/engine/src/setup.ts), so "phase is
    setup" is exactly "placements are still face-down". */
function inSetup(state: GameState): boolean {
  switch (state.phase.kind) {
    case "setup:chooseFirst":
    case "setup:drawExtra":
    case "setup:place":
      return true;
    default:
      return false;
  }
}

/** A face-down back for an opponent in-play stack during setup. Positional
    id, NOT the engine uid — leaking the uid would let a client match the
    stack against cards it later sees move (the same rule as hiddenHand).
    When SETUP_REVEALED flips the board public the model re-keys from this
    positional id to the real uid, so the reveal is a remount rather than a
    flip animation — the same accepted trade as the opponent-hand backs.
    Only opponent stacks ever redact, hence the fixed "opponent-" ids
    (mirroring hiddenHand). */
function hiddenInPlayModel(id: string): CardModel {
  return {
    id,
    cardId: HIDDEN_CARD_ID,
    name: HIDDEN_CARD_NAME,
    type: "trainer", // neutral, mirrors the synthetic deck/prize backs
  };
}

/** Face-down backs for the opponent's hand. Ids are positional (`opponent-
    hand-N`), NOT the engine uids: a uid is stable across zones, so leaking it
    here would let a client track a specific hidden card from the moment it
    was drawn — exactly what P4's filter must prevent. */
function hiddenHand(count: number): CardModel[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `opponent-hand-${index}`,
    cardId: HIDDEN_CARD_ID,
    name: HIDDEN_CARD_NAME,
    type: "trainer" as const, // neutral, mirrors the synthetic deck/prize backs
  }));
}

/** tcgdex category/trainerType → the playmat's CardType vocabulary. */
function cardTypeOf(card: Card): CardType {
  switch (card.category) {
    case "Pokemon":
      return "pokemon";
    case "Energy":
      return "energy";
    case "Trainer":
      if (card.trainerType === "Tool") return "tool";
      if (card.trainerType === "Stadium") return "stadium";
      return "trainer";
  }
}

/** Engine seat → the viewer's vocabulary. */
function asPlayerId(seat: Seat | null, viewerSeat: Seat): PlayerId | null {
  if (seat === null) return null;
  return seat === viewerSeat ? "you" : "opponent";
}

/** Everything the projection derives from the phase (engine seats — the
    caller maps them per viewer). */
export interface PhaseView {
  /** Turn owner; null in setup, between turns (checkup-origin ko:* parks)
      and once the game is over. */
  activeSeat: Seat | null;
  /** The seat that must act; null once the game is over. */
  waitingSeat: Seat | null;
  pendingDecision: PendingDecision | null;
  /** Unmapped engine outcome; non-null only on gameOver. */
  outcome: GameOutcome | null;
}

/** THE one exhaustive switch over the Phase union — exported so
    useLocalGame's waitingSeatOf reuses it instead of duplicating the
    phase→seat mapping. Exhaustive on purpose: M1's defensive turn-parity
    fallback (written while M2's phases were still landing) guessed the TURN
    OWNER, which is the wrong seat to wait on exactly when ko:promote parks —
    the KO'd seat decides in the middle of the attacker's turn. With the
    union complete in-tree, a future kind is a compile error here instead of
    a wrong guess. */
export function phaseViewOf(state: GameState, viewerSeat: Seat): PhaseView {
  const none = { pendingDecision: null, outcome: null };
  const phase = state.phase;
  switch (phase.kind) {
    // Setup: turn 0, nobody OWNS a turn (activeSeat null) — but somebody
    // still owes a decision, which waitingSeat carries.
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
    // ko:* — phase.seat is the DECIDER (prize taker / promoter), not the
    // turn owner. Whether a turn is even in progress depends on the KO's
    // ORIGIN, which the pending queue still records — see koParkActiveSeat.
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
    case "gameOver":
      return { ...none, activeSeat: null, waitingSeat: null, outcome: phase.outcome };
  }
  // Only reachable when the switch above stops covering the Phase union —
  // then `phase` is no longer never and this line refuses to compile.
  return phase satisfies never;
}

/** The turn a parked ko:* interrupt sits INSIDE — or null when it sits
    BETWEEN turns. Attack-origin KOs park with the turn tail still queued
    behind the ko stages (pending: [ko…, endTurn, checkup, startTurn]), so
    the parity owner still owns the turn. Checkup-origin KOs park AFTER
    endTurn and checkup have already drained (pending: [ko…, startTurn])
    with the turn counter not yet bumped — parity would misreport the
    JUST-ENDED seat as active — so those parks own no turn at all. */
function koParkActiveSeat(state: GameState): Seat | null {
  const inTurn = state.pending.some(
    (stage) => stage.kind === "endTurn" || stage.kind === "checkup",
  );
  return inTurn ? turnOwnerOf(state) : null;
}

/** The turn-ownership invariant: odd turns belong to firstPlayer. Only
    meaningful while a turn is actually in progress — koParkActiveSeat guards
    the between-turns case, where this parity names the wrong seat. */
function turnOwnerOf(state: GameState): Seat | null {
  if (state.turn < 1 || state.firstPlayer === null) return null;
  return state.turn % 2 === 1 ? state.firstPlayer : otherSeat(state.firstPlayer);
}

/** Both seats can owe a simultaneous setup decision; a single waitingOn must
    pick one, and the viewer wins the tie — the client's question is "am I
    being waited on?". An empty list never happens (a fully-decided phase is
    never entered), but stay total. */
function preferViewer(undecided: Seat[], viewerSeat: Seat): Seat | null {
  if (undecided.includes(viewerSeat)) return viewerSeat;
  return undecided[0] ?? null;
}

/** Viewer-map a finished game's outcome — fresh objects, nothing aliased
    from the engine state. */
function outcomeFor(outcome: GameOutcome, viewerSeat: Seat): ProjectedOutcome {
  if (outcome.result === "win") {
    return {
      result: "win",
      winner: outcome.winner === viewerSeat ? "you" : "opponent",
      reason: outcome.reason,
    };
  }
  return {
    result: "tie",
    reasons: {
      you: outcome.reasons[viewerSeat],
      opponent: outcome.reasons[otherSeat(viewerSeat)],
    },
  };
}
