export type PlayerId = "you" | "opponent";
export type SidePosition = "top" | "bottom";
export type CardBackTone = "blue" | "red";
export type CardBackSize = "card" | "prize";

export type CardOwner = PlayerId | "global";
export type CardZone = "hand" | "active" | "bench" | "stadium" | "attached";

// Discriminated on `zone` so illegal placements are unrepresentable: active
// never carries an index, and stadium is the only zone that may be globally
// owned (the shared stadium slot) or player-owned (synthetic deck/prize backs
// routed through the same pipeline). hand/bench/attached usually carry an array
// index, but it is optional: a whole-zone container drop target (the bench
// frame / hand wrapper) has no index and means "append to the end".
export type CardPlacement =
  | { owner: PlayerId; zone: "hand" | "bench" | "attached"; index?: number }
  | { owner: PlayerId; zone: "active" }
  | { owner: CardOwner; zone: "stadium" };

export interface CardMoveRequest {
  cardId: string;
  from: CardPlacement;
  to: CardPlacement;
}

export type CardType = "pokemon" | "trainer" | "tool" | "energy" | "stadium";

export interface AttachedCards {
  tools: CardModel[];
  energies: CardModel[];
}

export interface CardModel {
  id: string;
  name: string;
  cardId: string;
  type: CardType;
  imageUrl?: string;
  attached?: AttachedCards;
  /** Battle numbers + conditions for an in-play Pokémon top card; absent on
      every other card (hand, piles, attachments, hidden backs, empty-slot
      placeholders). Riding ON the model (instead of the old side-table
      threaded PlaymatView → PlayerSide → Bench → chip) keeps damage chips
      and status markers a plain read off the card they decorate. */
  battle?: BattleState;
}

export interface PlayerBoard {
  hand: CardModel[];
  active: CardModel | null;
  bench: CardModel[];
  prizesRemaining: number;
}

export interface BoardState {
  stadium: CardModel | null;
  you: PlayerBoard;
  opponent: PlayerBoard;
}

export interface TurnInfo {
  turn: number;
  activePlayer: PlayerId;
  youName: string;
  opponentName: string;
}

/** The §12 Special Conditions on an in-play Pokémon. Structurally identical
    to the engine's SpecialConditions (packages/engine/src/types.ts) —
    restated locally so the playmat layer keeps zero engine imports (the
    /simulator mock renders boards without the engine package). The game
    projection copies field-by-field, so a drifting shape becomes a compile
    error there, never a silent mismatch here. */
export interface BattleConditions {
  /** Asleep/Paralyzed/Confused are mutually exclusive (one card rotation);
      "none" = the card is upright. */
  rotation: "none" | "asleep" | "paralyzed" | "confused";
  /** HP placed at each Pokémon Checkup while Poisoned; 0 = not Poisoned. */
  poisonDamage: number;
  burned: boolean;
}

/** Public battle numbers for an in-play Pokémon, carried on its top-card
    CardModel (`battle`). Damage in HP (counters × 10); hp null = catalog
    data gap. `conditions` is required: an omitted object would silently
    read as "none" downstream — boards with nothing afflicting a Pokémon
    say so explicitly (use NO_CONDITIONS). */
export interface BattleState {
  damage: number;
  hp: number | null;
  conditions: BattleConditions;
}

/** The empty condition set — upright, not Poisoned, not Burned. Frozen so
    the shared reference stays a pure constant for mocks and tests; anything
    that needs a mutable copy spreads it. */
export const NO_CONDITIONS: BattleConditions = Object.freeze({
  rotation: "none",
  poisonDamage: 0,
  burned: false,
});

/** What BoardState cannot carry about a side's piles: the deck size and the
    public discard (oldest → newest). Structurally the game projection's
    ProjectedPiles; optional on the view so the mock board renders unchanged. */
export interface PileState {
  deckCount: number;
  discard: CardModel[];
}

export type LogSource = PlayerId | "system";
export type LogSegmentTone = "default" | "strong" | "energy" | "damage";

export interface LogSegment {
  text: string;
  tone?: LogSegmentTone;
}

export type LogEntry =
  | {
      kind: "action";
      who: LogSource;
      elapsed: string;
      segments: LogSegment[];
    }
  | {
      kind: "turn";
      turn: number;
    };
