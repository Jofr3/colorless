import type { Card } from "@luminous/schema";
import type { DrawReason, GameEvent } from "./events";

// The whole GameState is a plain JSON-safe value — no classes, no Date, no
// functions — so snapshots serialize, replay and structurally share. Nothing
// in the engine ever mutates a state it was given; reducers build the next
// state out of spreads over the old one.

export type Seat = "p1" | "p2";

/** Seat labels are NOT turn order — the coin-flip winner chooses who goes
    first (rules §3.3), recorded in `GameState.firstPlayer`. */
export const SEATS: readonly Seat[] = ["p1", "p2"];

export function otherSeat(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

// Rule constants (docs/reference/ptcg-rules.md §2–§3).
export const DECK_SIZE = 60;
export const HAND_SIZE = 7;
export const PRIZE_COUNT = 6;
export const BENCH_MAX = 5;

/** §12 condition shape: {Asleep, Paralyzed, Confused} are mutually exclusive
    (one card rotation), Poisoned/Burned coexist. A placeholder until M3 —
    M1 never sets anything, but the slot exists so states don't change shape.
    Poison carries its counter amount rather than a bool because §12/§13.1
    let effects raise it ("Poisoned; put 2 damage counters instead of 1"). */
export interface SpecialConditions {
  rotation: "none" | "asleep" | "paralyzed" | "confused";
  /** Damage placed on it at each Checkup while Poisoned; 0 = not Poisoned. */
  poisonDamage: number;
  burned: boolean;
}

export function noConditions(): SpecialConditions {
  return { rotation: "none", poisonDamage: 0, burned: false };
}

/** An in-play Pokémon is a stack of physical cards, not one card (§1.2):
    the top uid defines its identity (name, HP, retreat cost, …); damage,
    energy and tools persist through evolution (M4). */
export interface InPlayPokemon {
  /** Card uids, bottom → top. */
  stack: string[];
  /** Attached Energy uids. */
  energy: string[];
  /** Attached Pokémon Tool uids (the attach flow lands with trainers, M4). */
  tools: string[];
  /** HP of damage taken (counters × 10). Placed by attacks from M2 on. */
  damage: number;
  conditions: SpecialConditions;
  /** Effect markers ("can't attack next turn", …) — M3+. */
  markers: string[];
  /** Turn it entered play; 0 = during setup. M2's evolution timing ("not the
      turn it came into play", §10) reads this — the separate "no evolving on
      your own first turn" rule is a turn/firstPlayer check, not this field. */
  turnPlayed: number;
}

export function makeInPlay(uid: string, turnPlayed: number): InPlayPokemon {
  return {
    stack: [uid],
    energy: [],
    tools: [],
    damage: 0,
    conditions: noConditions(),
    markers: [],
    turnPlayed,
  };
}

export interface PlayerSide {
  /** Card uids; index 0 is the top of the deck. */
  deck: string[];
  hand: string[];
  /** Order preserved (§2 — the discard pile is ordered and public). */
  discard: string[];
  /** Face-down prize uids, 6 at setup (§3.8). Taken on KOs from M2 on. */
  prizes: string[];
  active: InPlayPokemon | null;
  /** Dense (no empty slots), capped at BENCH_MAX. */
  bench: InPlayPokemon[];
  /** Setup mulligan count — drives the opponent's compensation draw. */
  mulligans: number;
}

/** Where an action points on the actor's own board. */
export type PokemonTarget = { spot: "active" } | { spot: "bench"; index: number };

/** M1's only way to lose; M2 adds prize-out and no-Pokémon (plus the
    simultaneous/tie outcome, §14). */
export type GameOverReason = "deckOut";

// The phase is the discriminant every action is validated against: mandatory
// steps auto-resolve inside the reducer, so a distinct phase only exists
// where some player owes a decision (locked design: choices are actions).
export type Phase =
  | { kind: "setup:chooseFirst"; coinWinner: Seat }
  /** Mulligan compensation (§3.5): each player may draw 1 card per OPPONENT
      mulligan — mulliganing yourself does not forfeit it, so BOTH seats can
      be owed at once. `owed` is per seat (0 = nothing to decide); `decided`
      tracks who has answered. Seats owed 0 are pre-decided, and a phase where
      nobody is owed is never entered at all. */
  | { kind: "setup:drawExtra"; owed: Record<Seat, number>; decided: Record<Seat, boolean> }
  | { kind: "setup:place"; ready: Record<Seat, boolean> }
  // Per-turn allowances live on the phase — replacing the phase object at
  // turn start IS the allowance reset.
  | { kind: "turn:action"; seat: Seat; energyAttached: boolean; retreated: boolean }
  | { kind: "gameOver"; winner: Seat; reason: GameOverReason };

/** The in-turn phase, narrowed — the shape every turn action is gated on. */
export type TurnPhase = Extract<Phase, { kind: "turn:action" }>;

export interface GameState {
  /** mulberry32 state (signed int32) — every shuffle/flip advances it. */
  rngState: number;
  /** 1-based turn counter; 0 while in setup. Odd turns belong to firstPlayer. */
  turn: number;
  /** Chosen by the coin winner; null only during setup:chooseFirst. */
  firstPlayer: Seat | null;
  phase: Phase;
  players: Record<Seat, PlayerSide>;
  /** uid → catalog card id; fixed for the whole game at createGame. */
  cardIdByUid: Record<string, string>;
  /** The slice of the injected pool the two decks actually use. Carried in
      the state so applyAction stays a pure (state, action) pair and
      snapshots are self-contained/replayable. */
  cardPool: Record<string, Card>;
}

export function withSide(state: GameState, seat: Seat, side: PlayerSide): GameState {
  return { ...state, players: { ...state.players, [seat]: side } };
}

/** Remove one card uid from a zone array (uids are unique by construction). */
export function without(zone: readonly string[], uid: string): string[] {
  return zone.filter((entry) => entry !== uid);
}

/** Move up to `count` cards deck-top → hand and record a CARDS_DRAWN event.
    Callers that care about deck-out (the turn draw, §14.3) check emptiness
    themselves — this helper just draws what is there. */
export function drawToHand(
  state: GameState,
  seat: Seat,
  count: number,
  reason: DrawReason,
  events: GameEvent[],
): GameState {
  if (count <= 0) return state;
  const side = state.players[seat];
  const drawn = side.deck.slice(0, count);
  if (drawn.length === 0) return state;
  events.push({ type: "CARDS_DRAWN", seat, uids: drawn, reason });
  return withSide(state, seat, {
    ...side,
    deck: side.deck.slice(count),
    hand: [...side.hand, ...drawn],
  });
}
