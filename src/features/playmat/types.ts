export type PlayerId = "you" | "opponent";
export type SidePosition = "top" | "bottom";
export type CardBackTone = "blue" | "red";
export type CardBackSize = "card" | "prize";

export interface CardModel {
  id: string;
  name: string;
  cardId: string;
  imageUrl?: string;
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
