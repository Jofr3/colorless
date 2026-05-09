// Pure board reducers and predicates. No React, no DOM access — these
// just transform BoardState given a CardLocation/DropTarget pair, and
// answer permission questions like "can the active player move this?".

import {
  BENCH_LIMIT,
  type BoardState,
  type CardBackTone,
  type CardLocation,
  type DragCardData,
  type DropTarget,
  type DropTargetData,
  type PlayerId,
  type PokeState,
} from "../types";

export function dropTargetId(target: DropTarget) {
  switch (target.kind) {
    case "hand":
      return `drop-${target.owner}-hand`;
    case "bench":
      return `drop-${target.owner}-bench`;
    case "active":
      return `drop-${target.owner}-active`;
    case "stadium":
      return "drop-stadium";
  }
}

export function cardRowKey(kind: "hand" | "bench", owner: PlayerId) {
  return `${kind}-${owner}`;
}

export function playerBackTone(player: PlayerId): CardBackTone {
  return player === "you" ? "blue" : "red";
}

export function otherPlayer(player: PlayerId): PlayerId {
  return player === "you" ? "opponent" : "you";
}

export function isDragCardData(data: unknown): data is DragCardData {
  return Boolean(data && typeof data === "object" && "card" in data && "location" in data);
}

export function isDropTargetData(data: unknown): data is DropTargetData {
  return Boolean(data && typeof data === "object" && "target" in data);
}

export function cloneBoard(board: BoardState): BoardState {
  return {
    hand: [...board.hand],
    stadium: board.stadium,
    you: {
      ...board.you,
      bench: [...board.you.bench],
    },
    opponent: {
      ...board.opponent,
      bench: [...board.opponent.bench],
    },
  };
}

function getSingleCardTarget(board: BoardState, target: Extract<DropTarget, { kind: "active" | "stadium" }>) {
  return target.kind === "active" ? board[target.owner].active : board.stadium;
}

function setSingleCardTarget(
  board: BoardState,
  target: Extract<DropTarget, { kind: "active" | "stadium" }>,
  card: PokeState | null,
) {
  if (target.kind === "active") {
    board[target.owner].active = card;
  } else {
    board.stadium = card;
  }
}

export function clampInsertIndex(index: number | undefined, length: number) {
  return Math.max(0, Math.min(length, index ?? length));
}

function insertCardAt(cards: PokeState[], index: number | undefined, card: PokeState) {
  cards.splice(clampInsertIndex(index, cards.length), 0, card);
}

export function sourceBelongsToPlayer(source: CardLocation, player: PlayerId) {
  return source.owner === player;
}

function targetBelongsToPlayer(target: DropTarget, player: PlayerId) {
  return target.kind === "stadium" || target.owner === player;
}

export function canActivePlayerMove(source: CardLocation, target: DropTarget, activePlayer: PlayerId) {
  return sourceBelongsToPlayer(source, activePlayer) && targetBelongsToPlayer(target, activePlayer);
}

export function canPreviewRowDrop(
  board: BoardState,
  source: CardLocation,
  target: Extract<DropTarget, { kind: "hand" | "bench" }>,
  activePlayer: PlayerId,
) {
  if (!canActivePlayerMove(source, target, activePlayer)) return false;

  if (target.kind === "hand") {
    return source.kind === "hand" && source.owner === target.owner;
  }

  if (source.kind === "hand") {
    return board[target.owner].bench.length < BENCH_LIMIT;
  }

  if (source.kind === "bench") {
    return source.owner === target.owner;
  }

  if (source.kind === "active") {
    return source.owner === target.owner && board[target.owner].bench.length < BENCH_LIMIT;
  }

  return false;
}

export function moveCard(board: BoardState, source: CardLocation, target: DropTarget): BoardState {
  if (source.kind === "hand" && target.kind === "hand" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const [sourceCard] = next.hand.splice(source.index, 1);
    if (!sourceCard) return board;
    insertCardAt(next.hand, target.index, sourceCard);
    return next;
  }

  if (source.kind === "hand") {
    const sourceCard = board.hand[source.index];
    if (!sourceCard) return board;

    const next = cloneBoard(board);
    next.hand.splice(source.index, 1);

    if (target.kind === "bench") {
      if (next[target.owner].bench.length >= BENCH_LIMIT) return board;
      insertCardAt(next[target.owner].bench, target.index, sourceCard);
      return next;
    }

    if (target.kind === "active" || target.kind === "stadium") {
      const displacedCard = getSingleCardTarget(next, target);
      setSingleCardTarget(next, target, sourceCard);
      if (displacedCard) insertCardAt(next.hand, source.index, displacedCard);
      return next;
    }

    return board;
  }

  if (source.kind === "bench" && target.kind === "bench" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const [sourceCard] = next[source.owner].bench.splice(source.index, 1);
    if (!sourceCard) return board;
    insertCardAt(next[source.owner].bench, target.index, sourceCard);
    return next;
  }

  if (source.kind === "bench" && target.kind === "active" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const [sourceCard] = next[source.owner].bench.splice(source.index, 1);
    if (!sourceCard) return board;

    const displacedActive = next[source.owner].active;
    next[source.owner].active = sourceCard;
    if (displacedActive) insertCardAt(next[source.owner].bench, source.index, displacedActive);
    return next;
  }

  if (source.kind === "active" && target.kind === "bench" && source.owner === target.owner) {
    if (board[source.owner].bench.length >= BENCH_LIMIT) return board;

    const next = cloneBoard(board);
    const sourceCard = next[source.owner].active;
    if (!sourceCard) return board;

    next[source.owner].active = null;
    insertCardAt(next[source.owner].bench, target.index, sourceCard);
    return next;
  }

  return board;
}
