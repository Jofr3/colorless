// Shared types and constants for the playmat-v9 components.
//
// These were previously colocated at the top of Body.tsx; they are split
// into a leaf module so reducer / physics / component files can depend on
// them without pulling in the orchestrator.

export type EnergyType =
  | "grass"
  | "fire"
  | "water"
  | "lightning"
  | "psychic"
  | "fighting"
  | "darkness"
  | "metal"
  | "fairy"
  | "dragon"
  | "colorless";

export const CARD_W = 140;
export const WRAPPER_CLASSES =
  "playmat-wrapper w-full h-screen flex flex-col text-white relative overflow-hidden";

export const CENTER_LINE_TOP = "calc((100vh - var(--hand-h)) / 2)";

export const SLOT_BASE =
  "relative rounded-xl bg-white/[0.045] backdrop-blur-[3px] ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]";

export type CardBackTone = "blue" | "red";

export type CardBackSize = "card" | "prize";

export interface PokeState {
  id: string;
  name: string;
  cardId: string;
  hp?: number;
  type?: EnergyType;
  damage?: number;
}

export type PlayerId = "you" | "opponent";
export type SidePosition = "top" | "bottom";

export interface PlayerBoardState {
  active: PokeState | null;
  bench: PokeState[];
  prizesRemaining: number;
}

export interface BoardState {
  hand: PokeState[];
  stadium: PokeState | null;
  you: PlayerBoardState;
  opponent: PlayerBoardState;
}

export type CardLocation =
  | { kind: "hand"; owner: PlayerId; index: number }
  | { kind: "bench"; owner: PlayerId; index: number }
  | { kind: "active"; owner: PlayerId };

export type DropTarget =
  | { kind: "hand"; owner: PlayerId; index?: number }
  | { kind: "bench"; owner: PlayerId; index?: number }
  | { kind: "active"; owner: PlayerId }
  | { kind: "stadium" };

export interface DragCardData {
  card: PokeState;
  location: CardLocation;
}

export interface DropTargetData {
  target: DropTarget;
}

export type RowDropPreview = Extract<DropTarget, { kind: "hand" | "bench" }> & { index: number };

export interface DragRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ReleaseMotion {
  rect: DragRect;
  velocityX: number;
  velocityY: number;
}

export interface DragMotionSample {
  rect: DragRect;
  time: number;
  velocityX: number;
  velocityY: number;
}

export interface DragState {
  card: PokeState;
  rect: DragRect;
}

export type ReleaseRectsRef = { current: Map<string, ReleaseMotion> };

export const BENCH_LIMIT = 5;
export const BALATRO_LAYOUT_DURATION = 0.42;
// The release-animation z-index lives in index.css (.balatro-release-lift)
// rather than as a JS constant — the lift uses class toggles instead of
// inline-style writes for React-reconciliation safety.
export const DRAG_OVERLAY_Z_INDEX = 1200;
export const CARD_DRAG_HOVER_SUPPRESSION_MS = 600;
export const CARD_DRAG_INTERACTION_EVENT = "tcg-card-drag-start";

export interface TurnInfo {
  turn: number;
  activePlayer: PlayerId;
  youName: string;
  opponentName: string;
}

export type LogSource = "you" | "opponent" | "system";

export type LogSegmentTone = "default" | "strong" | "energy" | "damage";

export interface LogSegment {
  text: string;
  tone?: LogSegmentTone;
}

export interface LogActionEntry {
  kind: "action";
  who: LogSource;
  elapsed: string;
  segments: LogSegment[];
}

export interface LogTurnDivider {
  kind: "turn";
  turn: number;
}

export type LogEntry = LogActionEntry | LogTurnDivider;
