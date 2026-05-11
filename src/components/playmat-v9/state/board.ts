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
    case "pokemon":
      return target.slot === "active"
        ? `drop-${target.owner}-active-pokemon`
        : `drop-${target.owner}-bench-${target.index}-pokemon`;
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
    stadium: board.stadium,
    you: {
      ...board.you,
      hand: [...board.you.hand],
      bench: [...board.you.bench],
    },
    opponent: {
      ...board.opponent,
      hand: [...board.opponent.hand],
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

function getPokemonAtTarget(board: BoardState, target: Extract<DropTarget, { kind: "pokemon" }>) {
  return target.slot === "active"
    ? board[target.owner].active
    : (board[target.owner].bench[target.index] ?? null);
}

export function canAttachCardToPokemon(card: PokeState | null | undefined, pokemon: PokeState | null | undefined) {
  if (!card || !pokemon || pokemon.cardType !== "pokemon") return false;

  if (card.cardType === "energy") return true;
  if (card.cardType === "tool") return !pokemon.attachedTool;

  return false;
}

function attachCardToPokemon(board: BoardState, target: Extract<DropTarget, { kind: "pokemon" }>, card: PokeState) {
  const pokemon = getPokemonAtTarget(board, target);
  if (!pokemon || !canAttachCardToPokemon(card, pokemon)) return false;

  const nextPokemon =
    card.cardType === "energy"
      ? { ...pokemon, attachedEnergy: [...(pokemon.attachedEnergy ?? []), card] }
      : { ...pokemon, attachedTool: card };

  if (target.slot === "active") {
    board[target.owner].active = nextPokemon;
  } else {
    board[target.owner].bench[target.index] = nextPokemon;
  }

  return true;
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

export function canDropCardOnTarget(card: PokeState | null | undefined, target: DropTarget) {
  if (!card) return true;

  switch (target.kind) {
    case "hand":
      return true;
    case "bench":
    case "active":
      return card.cardType === "pokemon";
    case "pokemon":
      return card.cardType === "energy" || card.cardType === "tool";
    case "stadium":
      return card.cardType === "stadium";
  }
}

function canSourceMoveToTarget(source: CardLocation, target: DropTarget) {
  switch (source.kind) {
    case "hand":
      if (target.kind === "stadium") return true;
      return source.owner === target.owner;
    case "bench":
      return (target.kind === "bench" || target.kind === "active") && source.owner === target.owner;
    case "active":
      return target.kind === "bench" && source.owner === target.owner;
  }
}

function hasTargetCapacity(board: BoardState, source: CardLocation, target: DropTarget) {
  if (target.kind !== "bench") return true;
  if (source.kind === "bench" && source.owner === target.owner) return true;

  return board[target.owner].bench.length < BENCH_LIMIT;
}

export function canActivePlayerMoveCard(
  board: BoardState,
  card: PokeState,
  source: CardLocation,
  target: DropTarget,
  activePlayer: PlayerId,
) {
  const targetAcceptsCard =
    target.kind === "pokemon"
      ? canAttachCardToPokemon(card, getPokemonAtTarget(board, target))
      : canDropCardOnTarget(card, target);

  return (
    sourceBelongsToPlayer(source, activePlayer) &&
    targetBelongsToPlayer(target, activePlayer) &&
    canSourceMoveToTarget(source, target) &&
    targetAcceptsCard &&
    hasTargetCapacity(board, source, target)
  );
}

export function canPreviewRowDrop(
  board: BoardState,
  card: PokeState,
  source: CardLocation,
  target: Extract<DropTarget, { kind: "hand" | "bench" }>,
  activePlayer: PlayerId,
) {
  return canActivePlayerMoveCard(board, card, source, target, activePlayer);
}

export function moveCard(board: BoardState, source: CardLocation, target: DropTarget): BoardState {
  if (source.kind === "hand" && target.kind === "hand" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const sourceHand = next[source.owner].hand;
    const [sourceCard] = sourceHand.splice(source.index, 1);
    if (!sourceCard) return board;
    insertCardAt(sourceHand, target.index, sourceCard);
    return next;
  }

  if (source.kind === "hand") {
    const sourceCard = board[source.owner].hand[source.index];
    if (!sourceCard) return board;

    const next = cloneBoard(board);
    const sourceHand = next[source.owner].hand;

    if (target.kind === "pokemon") {
      if (!attachCardToPokemon(next, target, sourceCard)) return board;
      sourceHand.splice(source.index, 1);
      return next;
    }

    if (!canDropCardOnTarget(sourceCard, target)) return board;
    sourceHand.splice(source.index, 1);

    if (target.kind === "bench") {
      if (next[target.owner].bench.length >= BENCH_LIMIT) return board;
      insertCardAt(next[target.owner].bench, target.index, sourceCard);
      return next;
    }

    if (target.kind === "active" || target.kind === "stadium") {
      const displacedCard = getSingleCardTarget(next, target);
      setSingleCardTarget(next, target, sourceCard);
      if (displacedCard) insertCardAt(sourceHand, source.index, displacedCard);
      return next;
    }

    return board;
  }

  if (source.kind === "bench" && target.kind === "bench" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const [sourceCard] = next[source.owner].bench.splice(source.index, 1);
    if (!sourceCard || !canDropCardOnTarget(sourceCard, target)) return board;
    insertCardAt(next[source.owner].bench, target.index, sourceCard);
    return next;
  }

  if (source.kind === "bench" && target.kind === "active" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const [sourceCard] = next[source.owner].bench.splice(source.index, 1);
    if (!sourceCard || !canDropCardOnTarget(sourceCard, target)) return board;

    const displacedActive = next[source.owner].active;
    next[source.owner].active = sourceCard;
    if (displacedActive) insertCardAt(next[source.owner].bench, source.index, displacedActive);
    return next;
  }

  if (source.kind === "active" && target.kind === "bench" && source.owner === target.owner) {
    if (board[source.owner].bench.length >= BENCH_LIMIT) return board;

    const next = cloneBoard(board);
    const sourceCard = next[source.owner].active;
    if (!sourceCard || !canDropCardOnTarget(sourceCard, target)) return board;

    next[source.owner].active = null;
    insertCardAt(next[source.owner].bench, target.index, sourceCard);
    return next;
  }

  return board;
}
