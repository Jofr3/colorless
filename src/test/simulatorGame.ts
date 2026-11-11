// A seeded hot-seat game played on the local table, for the save tests and
// the save bench. Not a test file itself.

import type { GameAction } from "@colorless/engine";
import { candidateActions, drbgSeed, MIXED_DECK, mustCreate } from "@colorless/engine/testing";
import { LocalTableSource } from "../lua/tableSource";

export interface SimulatorGameOptions {
  maxMoves: number;
  /** Moves in one turn before the player ends it whenever they can. */
  turnBudget?: number;
  /** One in this many moves ends the turn early. */
  endOdds?: number;
  /** Attack only when nothing else keeps the turn going. */
  holdAttacks?: boolean;
  onOpen?: (src: LocalTableSource) => void;
  onMove?: (src: LocalTableSource, move: GameAction, moves: number) => void;
  /** Deal on ChaCha20 (`drbgSeed(seed)`), as every new game does, instead of the legacy
      generator a legacy save carries. */
  chacha?: boolean;
}

/** A fresh game on a new table, which saves into `localStorage`. */
export function openSimulatorGame(seed: number, chacha = false) {
  const created = mustCreate(chacha ? drbgSeed(seed) : seed, { p1: MIXED_DECK, p2: MIXED_DECK });
  return new LocalTableSource({
    state: created.state,
    events: created.events,
    names: { p1: "One", p2: "Two" },
    startedAt: 1_700_000_000_000,
  });
}

/** Plays the waiting seat's moves from a seeded shuffle of its candidates,
    preferring moves that keep the turn going, until the game ends or
    `maxMoves` moves were accepted. */
export function playSimulatorGame(seed: number, opts: SimulatorGameOptions) {
  const src = openSimulatorGame(seed, opts.chacha);
  opts.onOpen?.(src);
  const budget = opts.turnBudget ?? 12;
  const endOdds = opts.endOdds ?? 10;
  let rng = seed;
  const rand = (n: number) => {
    rng = (rng + 0x6d2b79f5) | 0;
    let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const rank = (a: GameAction) =>
    a.type === "endTurn" || (a.type === "attack" && opts.holdAttacks)
      ? 2
      : a.type === "attack" || a.type === "reorderBench"
        ? 1
        : 0;
  let moves = 0;
  let turn = -1;
  let inTurn = 0;
  while (moves < opts.maxMoves) {
    const { game, viewerSeat } = src.host;
    if (game.phase.kind === "gameOver") break;
    if (game.turn !== turn) {
      turn = game.turn;
      inTurn = 0;
    }
    const pool = candidateActions(game, viewerSeat).filter(
      (a) =>
        a.type !== "concede" && (a.type !== "reorderBench" || game.phase.kind === "turn:action"),
    );
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [pool[i], pool[j]] = [pool[j] as GameAction, pool[i] as GameAction];
    }
    pool.sort((a, b) => rank(a) - rank(b));
    if (inTurn >= budget || rand(endOdds) === 0) pool.reverse();
    const move = pool.find((a) => src.allowed(a));
    if (!move) break;
    src.send(move);
    moves++;
    inTurn++;
    opts.onMove?.(src, move, moves);
  }
  return { src, moves };
}
