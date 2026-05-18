import { BENCH_LIMIT } from "../constants";
import type {
  AttachedCards,
  BoardState,
  CardModel,
  CardMoveRequest,
  CardOwner,
  CardPlacement,
  CardType,
  PlayerBoard,
  PlayerId,
} from "../types";

const PLAYER_IDS: PlayerId[] = ["you", "opponent"];

function cloneCard(card: CardModel): CardModel {
  // Always return a fresh object: callers may mutate `card.attached` on the
  // clone (e.g., during attach), and returning the same reference for
  // un-attached cards lets that mutation leak back into the previous board
  // state. Under React StrictMode the updater fires twice — the second
  // fire then re-clones the now-mutated source and appends a duplicate
  // energy, producing the off-baseline "stack=1" you'd see for a Pokémon
  // that should only have a single energy attached.
  return {
    ...card,
    attached: card.attached
      ? {
          tools: [...card.attached.tools],
          energies: [...card.attached.energies],
        }
      : undefined,
  };
}

function clonePlayerBoard(player: PlayerBoard): PlayerBoard {
  return {
    ...player,
    hand: [...player.hand],
    bench: player.bench.map(cloneCard),
    active: player.active ? cloneCard(player.active) : null,
  };
}

function cloneBoard(board: BoardState): BoardState {
  return {
    stadium: board.stadium,
    you: clonePlayerBoard(board.you),
    opponent: clonePlayerBoard(board.opponent),
  };
}

function isPlayerOwner(owner: CardOwner): owner is PlayerId {
  return owner === "you" || owner === "opponent";
}

function samePlacement(a: CardPlacement, b: CardPlacement) {
  return a.owner === b.owner && a.zone === b.zone && (a.index ?? -1) === (b.index ?? -1);
}

function findCardPlacement(board: BoardState, cardId: string): CardPlacement | null {
  if (board.stadium?.id === cardId) {
    return { owner: "global", zone: "stadium" };
  }
  for (const owner of PLAYER_IDS) {
    const player = board[owner];
    if (player.active?.id === cardId) {
      return { owner, zone: "active" };
    }
    const benchIdx = player.bench.findIndex((c) => c.id === cardId);
    if (benchIdx >= 0) {
      return { owner, zone: "bench", index: benchIdx };
    }
    const handIdx = player.hand.findIndex((c) => c.id === cardId);
    if (handIdx >= 0) {
      return { owner, zone: "hand", index: handIdx };
    }
  }
  return null;
}

function cardAt(board: BoardState, placement: CardPlacement): CardModel | null {
  if (placement.zone === "stadium") return board.stadium;
  if (!isPlayerOwner(placement.owner)) return null;
  const player = board[placement.owner];
  if (placement.zone === "active") return player.active;
  if (placement.zone === "bench") {
    return placement.index != null ? player.bench[placement.index] ?? null : null;
  }
  if (placement.zone === "hand") {
    return placement.index != null ? player.hand[placement.index] ?? null : null;
  }
  return null;
}

/**
 * Whether the source card can be dropped on the target placement.
 * Single source of truth — used by the layer for cursor + filter, and
 * defended again by moveCardOnBoard before mutating.
 */
export function canPlace(
  board: BoardState,
  source: CardPlacement,
  target: CardPlacement,
  sourceType: CardType,
): boolean {
  if (samePlacement(source, target)) return false;

  // Stadium slot: only stadium-type cards (owner-agnostic, "global").
  if (target.zone === "stadium") {
    return sourceType === "stadium";
  }

  // Stadium-source can only go to stadium slot.
  if (source.zone === "stadium") return false;

  // Everything else requires same player and player ownership.
  if (!isPlayerOwner(source.owner) || source.owner !== target.owner) return false;

  // Tool / energy → attach onto an existing Pokémon at the target slot.
  // Trainers (non-tool) and stadiums cannot be attached.
  if (sourceType === "tool" || sourceType === "energy") {
    if (target.zone !== "active" && target.zone !== "bench") return false;
    if (source.zone !== "hand") return false;
    const player = board[target.owner];
    const host =
      target.zone === "active"
        ? player.active
        : target.index != null
          ? player.bench[target.index] ?? null
          : null;
    if (!host) return false;
    if (sourceType === "tool" && (host.attached?.tools.length ?? 0) > 0) return false;
    return true;
  }

  // Bench / active only accept Pokémon (after the attach branch).
  if ((target.zone === "active" || target.zone === "bench") && sourceType !== "pokemon") {
    return false;
  }

  // Bench/active cards can't be sent back to the hand by dragging.
  if (target.zone === "hand" && source.zone !== "hand") return false;

  const player = board[source.owner];

  // Bench occupancy — only matters when adding a new card to the bench.
  if (target.zone === "bench" && source.zone !== "bench") {
    if (player.bench.length >= BENCH_LIMIT) return false;
  }

  // Active occupancy — hand → active only when active is empty (no swap-out
  // of a Pokémon by simply playing another). Bench ↔ active swaps are fine.
  if (target.zone === "active" && source.zone === "hand" && player.active != null) {
    return false;
  }

  return true;
}

function swapBenchAndActive(player: PlayerBoard, benchIndex: number, benchCard: CardModel) {
  const oldActive = player.active;
  player.active = benchCard;

  if (oldActive) {
    player.bench[benchIndex] = oldActive;
  } else {
    player.bench.splice(benchIndex, 1);
  }
}

function retreatActiveToBench(player: PlayerBoard, activeCard: CardModel, requestedIndex?: number) {
  if (player.bench.length >= BENCH_LIMIT) return false;
  player.active = null;
  const insertIdx =
    requestedIndex != null
      ? Math.max(0, Math.min(requestedIndex, player.bench.length))
      : player.bench.length;
  player.bench.splice(insertIdx, 0, activeCard);
  return true;
}

function reorderBench(
  player: PlayerBoard,
  fromIndex: number,
  toIndex: number | undefined,
  card: CardModel,
) {
  player.bench.splice(fromIndex, 1);
  const insertIdx =
    toIndex != null
      ? Math.max(0, Math.min(toIndex, player.bench.length))
      : player.bench.length;
  player.bench.splice(insertIdx, 0, card);
}

function placeCard(board: BoardState, placement: CardPlacement, card: CardModel): boolean {
  if (placement.zone === "stadium") {
    // Stadium slot holds exactly one card; replacing is fine (there's
    // never more than one stadium in play).
    board.stadium = card;
    return true;
  }

  if (!isPlayerOwner(placement.owner)) return false;
  const player = board[placement.owner];

  if (placement.zone === "active") {
    if (player.active) return false;
    player.active = card;
    return true;
  }

  if (placement.zone === "bench") {
    if (player.bench.length >= BENCH_LIMIT) return false;
    const insertIdx =
      placement.index != null
        ? Math.max(0, Math.min(placement.index, player.bench.length))
        : player.bench.length;
    player.bench.splice(insertIdx, 0, card);
    return true;
  }

  // hand
  const insertIdx =
    placement.index != null
      ? Math.max(0, Math.min(placement.index, player.hand.length))
      : player.hand.length;
  player.hand.splice(insertIdx, 0, card);
  return true;
}

function removeCard(board: BoardState, source: CardPlacement, cardId: string): CardModel | null {
  if (source.zone === "stadium") {
    if (!board.stadium || board.stadium.id !== cardId) return null;
    const card = board.stadium;
    board.stadium = null;
    return card;
  }

  if (!isPlayerOwner(source.owner)) return null;
  const player = board[source.owner];

  if (source.zone === "active") {
    if (!player.active || player.active.id !== cardId) return null;
    const card = player.active;
    player.active = null;
    return card;
  }

  if (source.zone === "bench") {
    const idx = source.index ?? player.bench.findIndex((c) => c.id === cardId);
    if (idx < 0 || player.bench[idx]?.id !== cardId) return null;
    return player.bench.splice(idx, 1)[0] ?? null;
  }

  // hand
  const idx = source.index ?? player.hand.findIndex((c) => c.id === cardId);
  if (idx < 0 || player.hand[idx]?.id !== cardId) return null;
  return player.hand.splice(idx, 1)[0] ?? null;
}

export function moveCardOnBoard(board: BoardState, request: CardMoveRequest): BoardState {
  if (samePlacement(request.from, request.to)) return board;

  const cardAtFrom = cardAt(board, request.from) ?? null;
  const source: CardPlacement =
    cardAtFrom?.id === request.cardId
      ? request.from
      : findCardPlacement(board, request.cardId) ?? request.from;

  const card = cardAt(board, source);
  if (!card || card.id !== request.cardId) return board;

  // Guard at the model layer too: enforce the same rules as canPlace, so a
  // stale/invalid request can never corrupt board state.
  if (!canPlace(board, source, request.to, card.type)) return board;

  const next = cloneBoard(board);

  // Tool / energy attach: take the card from its source and slip it onto
  // the Pokémon at the target slot. Tools can only attach to Pokémon that
  // do not already have a tool; energies append.
  if (card.type === "tool" || card.type === "energy") {
    if (!isPlayerOwner(request.to.owner)) return board;
    const player = next[request.to.owner];
    const host =
      request.to.zone === "active"
        ? player.active
        : request.to.zone === "bench" && request.to.index != null
          ? player.bench[request.to.index] ?? null
          : null;
    if (!host) return board;

    const taken = removeCard(next, source, request.cardId);
    if (!taken) return board;

    const attached: AttachedCards = host.attached
      ? { tools: [...host.attached.tools], energies: [...host.attached.energies] }
      : { tools: [], energies: [] };
    if (card.type === "tool") {
      if (attached.tools.length > 0) return board;
      attached.tools = [taken];
    } else {
      attached.energies = [...attached.energies, taken];
    }
    host.attached = attached;
    return next;
  }

  // Bench → active: atomic swap.
  if (source.zone === "bench" && request.to.zone === "active") {
    if (!isPlayerOwner(source.owner)) return board;
    const player = next[source.owner];
    const benchIdx = source.index ?? -1;
    const benchCard = player.bench[benchIdx];
    if (!benchCard || benchCard.id !== request.cardId) return board;
    swapBenchAndActive(player, benchIdx, benchCard);
    return next;
  }

  // Active → bench: retreat. Reject if bench full (defended by canPlace).
  if (source.zone === "active" && request.to.zone === "bench") {
    if (!isPlayerOwner(source.owner)) return board;
    const player = next[source.owner];
    const activeCard = player.active;
    if (!activeCard || activeCard.id !== request.cardId) return board;
    if (!retreatActiveToBench(player, activeCard, request.to.index)) return board;
    return next;
  }

  // Bench → bench: reorder within the same bench.
  if (source.zone === "bench" && request.to.zone === "bench" && source.owner === request.to.owner) {
    if (!isPlayerOwner(source.owner)) return board;
    const player = next[source.owner];
    const fromIdx = source.index ?? -1;
    const benchCard = player.bench[fromIdx];
    if (!benchCard || benchCard.id !== request.cardId) return board;
    reorderBench(player, fromIdx, request.to.index, benchCard);
    return next;
  }

  // Generic take + place. No "swap into source" fallback — if placement
  // fails the move is rejected wholesale.
  const taken = removeCard(next, source, request.cardId);
  if (!taken) return board;

  if (!placeCard(next, request.to, taken)) {
    return board;
  }

  return next;
}
