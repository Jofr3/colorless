// The table's view-model: the board, piles and log every projection
// (projection.ts) produces and the Lua adapters serialize. It keeps zero
// engine imports — the engine's shapes are restated here, and the projection
// copies field-by-field so a drifting shape is a compile error there.

export type PlayerId = "you" | "opponent";

export type CardOwner = PlayerId | "global";

// Discriminated on `zone` so illegal placements are unrepresentable: active
// never carries an index, and stadium is the only zone that may be globally
// owned (the shared stadium slot) or player-owned (synthetic deck/prize backs
// routed through the same pipeline). hand/bench/attached usually carry an array
// index, but it is optional: a whole-zone container drop target (the bench
// frame / hand wrapper) has no index and means "append to the end".
export type CardPlacement =
  | { owner: PlayerId; zone: "hand" | "bench" | "attached" | "choice"; index?: number }
  | { owner: PlayerId; zone: "active" }
  /** Drop-only surface: Trainers resolve through the engine, never live here. */
  | { owner: PlayerId; zone: "playmat" }
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
  /** Printed Pokémon stage; absent on hidden cards and older sandbox models. */
  stage?: string | null;
  /** Current legal evolution hosts, computed by the engine for own hand cards. */
  evolutionTargetIds?: readonly string[];
  imageUrl?: string;
  attached?: AttachedCards;
  /** Battle numbers + conditions for an in-play Pokémon top card; absent on
      every other card (hand, piles, attachments, hidden backs, empty-slot
      placeholders). Riding ON the model keeps damage chips and status
      markers a plain read off the card they decorate. */
  battle?: BattleState;
}

/**
 * A prize turned face up, public to every viewer. `index` is the slot's position in the live prize
 * row, which compacts on every take.
 */
export interface FaceUpPrize {
  index: number;
  card: CardModel;
}

export interface PlayerBoard {
  hand: CardModel[];
  active: CardModel | null;
  bench: CardModel[];
  prizesRemaining: number;
  /**
   * The face-up slots of this side's prize row, in row order; usually `[]`. Every other prize is
   * face down and appears only in the count.
   */
  faceUpPrizes: FaceUpPrize[];
  /**
   * This side's live Bench limit as the engine reads it (8 under Area Zero Underdepths with a Tera
   * Pokémon in play, else 5). Optional: without it, the board falls back to `benchLimitFor`.
   */
  benchLimit?: number;
}

export interface BoardState {
  /** Searched Energy staged outside the hand until one is attached. */
  energyChoice?: { cards: CardModel[]; targets: CardPlacement[] };
  stadium: CardModel | null;
  you: PlayerBoard;
  opponent: PlayerBoard;
}

/** The §12 Special Conditions on an in-play Pokémon. Structurally identical
    to the engine's SpecialConditions (packages/engine/src/types.ts) —
    restated locally so the board model keeps zero engine imports. The game
    projection copies field-by-field, so a drifting shape becomes a compile
    error there, never a silent mismatch here. */
export interface BattleConditions {
  /** Asleep/Paralyzed/Confused are mutually exclusive (one card rotation);
      "none" = the card is upright. */
  rotation: "none" | "asleep" | "paralyzed" | "confused";
  /** HP placed at each Pokémon Checkup while Poisoned; 0 = not Poisoned. */
  poisonDamage: number;
  burned: boolean;
  /**
   * Damage a Confused Pokémon puts on itself when the attack flip misses; 30 unless the inflicting
   * effect raised it. Meaningful only while `rotation === "confused"`. This interface must stay
   * mutually assignable with the engine's `SpecialConditions`.
   */
  confusionDamage: number;
}

/** Public battle numbers for an in-play Pokémon, carried on its top-card
    CardModel (`battle`). Damage in HP (counters × 10); hp null = catalog
    data gap. `conditions` is required: an omitted object would silently
    read as "none" downstream — boards with nothing afflicting a Pokémon
    say so explicitly. */
export interface BattleState {
  damage: number;
  hp: number | null;
  conditions: BattleConditions;
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
      /** Public card identity captured when a Trainer is played, independent of its current zone. */
      playedTrainer?: { id: string; cardId: string; name: string };
    }
  | {
      kind: "turn";
      turn: number;
    };

// Bench capacity is normally 5; a bench-expanding stadium (e.g. Lumiose City) raises it to 8 for
// both players. Area Zero Underdepths raises it to 8 only for a player with a Tera Pokémon in play,
// which the engine computes per seat.
const DEFAULT_BENCH_LIMIT = 5;
const EXPANDED_BENCH_LIMIT = 8;
const BENCH_EXPANDING_STADIUM_CARD_IDS: ReadonlySet<string> = new Set(["me3-111"]);

export function benchLimitFor(board: BoardState, owner: PlayerId): number {
  const stadiumCardId = board.stadium?.cardId;
  if (stadiumCardId && BENCH_EXPANDING_STADIUM_CARD_IDS.has(stadiumCardId))
    return EXPANDED_BENCH_LIMIT;
  return board[owner].benchLimit ?? DEFAULT_BENCH_LIMIT;
}
