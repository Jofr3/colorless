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

/** Public battle numbers for an in-play Pokémon, keyed by CardModel.id — the
    shape the game projection's `pokemon` map already carries (damage in HP,
    hp null = catalog data gap). CardModel has no damage slot on purpose; the
    view threads this beside the board. */
export interface CardStatus {
  damage: number;
  hp: number | null;
}

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
