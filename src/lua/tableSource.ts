import {
  applyAction,
  cardOfUid,
  createGame,
  deckCardIdsOf,
  freshRngState,
  otherSeat,
  redactGame,
  type GameAction,
  type GameState,
  type Seat,
} from "@colorless/engine";
import type { Card, RedactedCard, RedactedGame, SeatLogEntry } from "@colorless/schema";
import {
  dropAutoSteps,
  hostReducer,
  initHost,
  stepTarget,
  type AutoPhase,
  type LocalGameSetup,
} from "../game/localHost";
import { saveSimulator } from "../game/simulatorSave";
import {
  autoStepFor,
  counterSourcePicked,
  eventsFromLog,
  NO_EVENTS,
  type TableEvents,
} from "./tableEvents";

export type LifecycleFlag =
  | "undo"
  | "newgame"
  | "choosedecks"
  | "concede"
  | "rematch"
  | "rematch-sent"
  | "leave";
export interface TableLifecycle {
  flags: LifecycleFlag[];
  opponentAway: { name: string; forfeitAt: number | null } | null;
  /** The refusal to show: a new object per refused `send`, null once one is
   * accepted. A refused automatic step is never shown. */
  error: { readonly reason: string } | null;
  /** A standing problem that is not a refusal. */
  warning?: string;
}
export type HistoryStep =
  | "previousTurn"
  | "nextTurn"
  | "undoAction"
  | "redoAction"
  | "undoTurn"
  | "redoTurn";
/** The hot-seat game's turn and action history. */
export interface TableHistory {
  turns(): { index: number; count: number };
  canStep(type: Exclude<HistoryStep, "previousTurn" | "nextTurn">): boolean;
  step(type: HistoryStep): void;
}
/** Where the simulator's game lives: the local hot-seat host, or a lobby.
 * Every change, including the answer to a `send`, reaches the simulator
 * through `subscribe`: a local table answers before `send` returns, an online
 * one when the server does. The optional members are what only some tables
 * can do. */
export interface TableSource {
  readonly mode: "local" | "online";
  readonly spectating: boolean;
  view(): RedactedGame | null;
  names(): { you: string; opponent: string };
  log(): readonly SeatLogEntry[];
  /** Header f21: a new id means a fresh table. */
  matchId(): string;
  /** Catalogue face for `I` rows. */
  card(cardId: string): Card | undefined;
  /** The face behind a visible card (stage fallback, types, Energy provides). */
  face(card: Pick<RedactedCard, "id" | "cardId">): Card | undefined;
  allowed(action: GameAction): boolean;
  send(action: GameAction): void;
  allowances(): { energy: boolean; supporter: boolean; retreated: boolean } | null;
  /** Cosmetic bench order key: the bottom of the stack, so evolving keeps its place. */
  benchKey(owner: "you" | "opponent", index: number): string;

  takeEvents(): TableEvents;
  lifecycle(): TableLifecycle;
  subscribe(onChange: () => void): () => void;
  /** Walk away from the table for good. */
  leave(): void;
  /** The simulator let go of this table (closed or rebound). */
  release?(): void;
  history?: TableHistory;
  /** The same decks reshuffled into a fresh game; the reason when it cannot start. */
  restart?(): string | null;
  rematch?(): void;
  /** Hand cards drawn from the deck since the last accepted `send` began a new turn. */
  turnDraws?(): { seat: Seat; hand: string[]; uid: string }[];
}
type Host = ReturnType<typeof initHost>;

const SAVE_FAILED = "Could not save this game. Browser storage may be full.";

/** The hot-seat game: the local host, with save, undo and auto-steps. */
export class LocalTableSource implements TableSource {
  readonly mode = "local";
  readonly spectating = false;
  readonly history: TableHistory = this;
  host: Host;
  private events = NO_EVENTS;
  private before: GameState | null = null;
  private refused: { reason: string } | null = null;
  private saved = true;
  private listeners = new Set<() => void>();
  /** A fresh match from its setup, or a restored one. */
  constructor(setup: LocalGameSetup | Host) {
    this.host = "origin" in setup ? setup : initHost(setup);
    // A match opened on a decision the table takes for the player resumes past it.
    if (this.autoSteps()) this.persist();
  }
  private seen: { game: GameState; seat: Seat; view: RedactedGame } | null = null;
  view() {
    const { game, viewerSeat } = this.host;
    if (this.seen?.game !== game || this.seen.seat !== viewerSeat)
      this.seen = { game, seat: viewerSeat, view: redactGame(game, viewerSeat) };
    return this.seen.view;
  }

  names() {
    const h = this.host;
    return { you: h.names[h.viewerSeat], opponent: h.names[otherSeat(h.viewerSeat)] };
  }
  log() {
    return this.host.log;
  }
  matchId() {
    return String(this.host.startedAt);
  }
  card(cardId: string) {
    return this.host.game.cardPool[cardId];
  }
  face(card: Pick<RedactedCard, "id" | "cardId">) {
    return cardOfUid(this.host.game, card.id);
  }
  allowed(action: GameAction) {
    return applyAction(this.host.game, action).ok;
  }
  send(action: GameAction) {
    const counterSource = counterSourcePicked(this.view(), action);
    const beforeGame = this.host.game;
    const before = this.host.log.length;
    this.host = hostReducer(this.host, { action, at: Date.now() });
    const error = this.host.lastError;
    if (error) {
      this.refused = { reason: error.message };
      this.events = NO_EVENTS;
      this.notify();
      return;
    }
    this.refused = null;
    this.before = beforeGame;
    const { knockedOut, shuffled, coin } = eventsFromLog(
      this.host.log.slice(before),
      (seat) => this.host.names[seat],
    );
    // A Trainer flip-locked to tails is discarded unplayed, so only the action still names it.
    const trainer = action.type === "playTrainer" ? cardOfUid(beforeGame, action.uid) : undefined;
    this.events = {
      knockedOut,
      shuffled,
      coin: coin && trainer ? { ...coin, title: trainer.name } : coin,
      counterSource,
    };
    this.settle();
  }
  allowances() {
    const a = this.host.game.allowances;
    return { energy: a.energyAttached, supporter: a.supporterPlayed, retreated: a.retreated };
  }
  benchKey(owner: "you" | "opponent", index: number) {
    const h = this.host;
    const seat = owner === "you" ? h.viewerSeat : otherSeat(h.viewerSeat);
    return h.game.players[seat].bench[index]?.stack[0] ?? "";
  }

  takeEvents() {
    const events = this.events;
    this.events = NO_EVENTS;
    return events;
  }
  lifecycle(): TableLifecycle {
    return {
      flags: ["undo", "newgame", "choosedecks", "concede", "leave"],
      opponentAway: null,
      error: this.refused,
      ...(this.saved ? {} : { warning: SAVE_FAILED }),
    };
  }
  subscribe(onChange: () => void) {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
  leave() {
    this.persist();
  }
  turnDraws(): { seat: Seat; hand: string[]; uid: string }[] {
    const previous = this.before;
    this.before = null;
    const game = this.host.game;
    if (!previous || game.turn <= previous.turn) return [];
    return (["p1", "p2"] as const).flatMap((seat) => {
      const hand = game.players[seat].hand;
      const old = previous.players[seat];
      return hand
        .filter((uid) => !old.hand.includes(uid) && old.deck.includes(uid))
        .map((uid) => ({ seat, hand, uid }));
    });
  }
  turns() {
    return { index: this.host.turnIndex, count: this.host.turns.length };
  }
  canStep(type: Exclude<HistoryStep, "previousTurn" | "nextTurn">) {
    return stepTarget(this.host, type) !== null;
  }
  step(type: HistoryStep) {
    this.host = hostReducer(this.host, { type });
    this.fresh();
  }
  restart() {
    const h = this.host;
    const startedAt = Math.max(Date.now(), h.startedAt + 1);
    const created = createGame({
      seed: freshRngState(),
      decks: { p1: deckCardIdsOf(h.game, "p1"), p2: deckCardIdsOf(h.game, "p2") },
      cardPool: h.game.cardPool,
    });
    if (!created.ok) return created.error.message;
    this.host = initHost({
      state: created.state,
      events: created.events,
      names: h.names,
      startedAt,
    });
    this.fresh();
    return null;
  }
  /** Writes the save; false when it did not stick (storage full). */
  persist() {
    this.saved = saveSimulator(this.host);
    return this.saved;
  }

  /** A board reached without a `send`: nothing to animate, nothing refused. */
  private fresh() {
    this.events = NO_EVENTS;
    this.before = null;
    this.refused = null;
    this.settle();
  }
  private settle() {
    this.autoSteps();
    this.persist();
    this.notify();
  }
  private notify() {
    for (const fn of [...this.listeners]) fn();
  }
  /** Mulligan draws and Prize picks the hot seat takes for the player. True when
   * anything stepped. */
  private autoSteps() {
    const drawn = this.stepWhile("setup:drawExtra");
    const taken = this.stepWhile("ko:takePrizes");
    return drawn || taken;
  }
  private stepWhile(kind: AutoPhase) {
    let stepped = false;
    while (this.host.game.phase.kind === kind) {
      const action = autoStepFor(this.view());
      if (!action) break;
      const next = hostReducer(this.host, { action, at: Date.now(), auto: kind });
      if (next.lastError || next.game === this.host.game) break;
      this.host = next;
      stepped = true;
    }
    if (stepped) this.host = dropAutoSteps(this.host, kind);
    return stepped;
  }
}
