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
//   - in-play Pokémon (active/bench) public, with their attached cards and
//     their damage/max HP (`pokemon` — damage counters sit on the table).
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

import type { GameOutcome, GameOverReason, GameState, InPlayPokemon, Seat } from "@luminous/engine";
import { SEATS, cardOfUid, hpOf, otherSeat, topUid } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import { cardImageUrl } from "../../lib/api";
import type { BoardState, CardModel, CardType, PlayerBoard, PlayerId } from "../playmat/types";

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

/** Public battle numbers for one in-play Pokémon. CardModel has no damage
    slot, so — like deckCount/discard on ProjectedPiles — these ride outside
    BoardState, keyed by CardModel.id (= the engine uid of the stack top). */
export interface PokemonStatus {
  /** HP of damage taken so far (counters × 10); 0 = pristine. */
  damage: number;
  /** Printed max HP of the stack's top card; null = catalog data gap (hpOf). */
  hp: number | null;
}

/** A parked mid-turn interrupt (§8.1 KO resolution) awaiting `waitingOn`'s
    decision. Without this a projection-driven client soft-locks: controls
    gate on activePlayer, which a ko:* phase does NOT move. Counts only —
    never card identity. */
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
  /** Damage/HP for EVERY in-play Pokémon — actives + benches, BOTH sides
      (public info) — keyed by CardModel.id. */
  pokemon: Record<string, PokemonStatus>;
  /** 1-based turn counter; 0 while the game is still in setup. */
  turn: number;
  /** The TURN OWNER from the viewer's perspective — which a parked ko:*
      interrupt does NOT change (the turn is still the attacker's). Null
      during setup (turn 0, nobody owns a turn) and once the game is over. */
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
  return {
    board: {
      // No stadium zone in the engine yet (lands with M4's trainers).
      stadium: null,
      you: playerBoardOf(state, viewerSeat, /* faceUpHand */ true),
      opponent: playerBoardOf(state, opponentSeat, /* faceUpHand */ false),
    },
    piles: {
      you: pilesOf(state, viewerSeat),
      opponent: pilesOf(state, opponentSeat),
    },
    pokemon: pokemonStatusOf(state),
    turn: state.turn,
    activePlayer: asPlayerId(view.activeSeat, viewerSeat),
    waitingOn: asPlayerId(view.waitingSeat, viewerSeat),
    pendingDecision: view.pendingDecision,
    outcome: view.outcome === null ? null : outcomeFor(view.outcome, viewerSeat),
  };
}

function playerBoardOf(state: GameState, seat: Seat, faceUpHand: boolean): PlayerBoard {
  const side = state.players[seat];
  return {
    hand: faceUpHand
      ? side.hand.map((uid) => cardModelOf(state, uid))
      : hiddenHand(side.hand.length),
    active: side.active === null ? null : inPlayModelOf(state, side.active),
    // Index-stable: an (engine-impossible) empty stack projects as a slot
    // placeholder rather than vanishing — compacting the bench would desync
    // every index-addressed slot (promotions, drops) from the engine's.
    bench: side.bench.map(
      (pokemon, index) => inPlayModelOf(state, pokemon) ?? emptyStackModel(seat, index),
    ),
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

/** Damage/HP for both sides' in-play Pokémon — public info, identical from
    either side of the table. An (engine-impossible) empty stack has no uid
    to key, so it is the one in-play entry without a status row — its bench
    placeholder carries no battle state either. */
function pokemonStatusOf(state: GameState): Record<string, PokemonStatus> {
  const status: Record<string, PokemonStatus> = {};
  for (const seat of SEATS) {
    const side = state.players[seat];
    for (const pokemon of [side.active, ...side.bench]) {
      if (pokemon === null) continue;
      const uid = topUid(pokemon);
      if (uid === undefined) continue;
      const card = cardOfUid(state, uid);
      status[uid] = { damage: pokemon.damage, hp: card === undefined ? null : hpOf(card) };
    }
  }
  return status;
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
    attached energy/tools ride along as face-up CardModels; its damage and
    max HP surface through GameProjection.pokemon under the same id (the
    playmat's CardModel has no damage slot). Special conditions and the lower
    stack cards (evolution, M4) still have no projection surface — they stay
    engine-side until the playmat can render them. */
function inPlayModelOf(state: GameState, pokemon: InPlayPokemon): CardModel | null {
  const uid = topUid(pokemon);
  if (uid === undefined) return null; // stacks are never empty, but stay total
  return {
    ...cardModelOf(state, uid),
    attached: {
      tools: pokemon.tools.map((toolUid) => cardModelOf(state, toolUid)),
      energies: pokemon.energy.map((energyUid) => cardModelOf(state, energyUid)),
    },
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
interface PhaseView {
  /** Turn owner; null in setup and once the game is over. */
  activeSeat: Seat | null;
  /** The seat that must act; null once the game is over. */
  waitingSeat: Seat | null;
  pendingDecision: PendingDecision | null;
  /** Unmapped engine outcome; non-null only on gameOver. */
  outcome: GameOutcome | null;
}

/** ONE exhaustive switch over the Phase union. Exhaustive on purpose: M1's
    defensive turn-parity fallback (written while M2's phases were still
    landing) guessed the TURN OWNER, which is the wrong seat to wait on
    exactly when ko:promote parks — the KO'd seat decides in the middle of
    the attacker's turn. With the union complete in-tree, a future kind is a
    compile error here instead of a wrong guess. */
function phaseViewOf(state: GameState, viewerSeat: Seat): PhaseView {
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
    // turn owner: the turn is still the attacker's, recovered from the M1
    // parity invariant "odd turns belong to firstPlayer".
    case "ko:takePrizes":
      return {
        activeSeat: turnOwnerOf(state),
        waitingSeat: phase.seat,
        pendingDecision: { kind: "takePrizes", count: phase.count },
        outcome: null,
      };
    case "ko:promote":
      return {
        activeSeat: turnOwnerOf(state),
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

/** The turn-ownership invariant: odd turns belong to firstPlayer. Null only
    before the first turn exists — never the case in the ko:* phases that
    call this (a KO happens inside somebody's turn). */
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
