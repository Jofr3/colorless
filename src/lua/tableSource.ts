import {
  applyAction,
  cardOfUid,
  createGame,
  otherSeat,
  redactGame,
  type GameAction,
  type GameState,
  type PokemonRef,
  type Seat,
} from "@colorless/engine";
import type { Card, RedactedCard, RedactedGame, SeatLogEntry } from "@colorless/schema";
import { initHost, hostReducer, stepTarget, type LocalGameSetup } from "../game/localHost";
import { projectGameState } from "../game/projection";
import type { CoinFlipBatch } from "../game/coinFlips";
import type { BoardState } from "../game/board";
import { saveSimulator, loadSimulatorSave } from "../game/simulatorSave";

/** Diffs of the last `send`, read once by the simulator right after it. */
export interface TableEvents {
  knockedOut: readonly string[];
  /** Seats whose deck or hand was shuffled. */
  shuffled: readonly Seat[];
  coin: CoinFlipBatch | null;
  /** The Adrena-Brain source just picked, so its destination menu keeps it raised. */
  counterSource?: PokemonRef;
}
export interface TableLifecycle {
  /** undo, newgame, choosedecks, concede, rematch, rematch-sent, leave */
  flags: string[];
  opponentAway: { name: string; forfeitAt: number | null } | null;
  /** The last rejected `send`, null once one is accepted. */
  error: string | null;
}
/** Where the simulator's game lives: the local hot-seat host, or a lobby. */
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
  /** null: unknown here, fall back to the view's own gates. */
  allowed(action: GameAction): boolean | null;
  send(action: GameAction, opts?: { auto?: boolean }): void;
  allowances(): { energy: boolean; supporter: boolean; retreated: boolean } | null;
  /** Cosmetic bench order key: the bottom of the stack, so evolving keeps its place. */
  benchKey(owner: "you" | "opponent", index: number): string;
  /** The board drags are translated against (moveToAction). */
  board(): BoardState;
  effectContext(): { placingCounters: boolean; invokedBy?: string; abilityName?: string };
  takeEvents(): TableEvents;
  lifecycle(): TableLifecycle;
  subscribe(onChange: () => void): () => void;
  /** The simulator let go of this table (closed or rebound). */
  release?(): void;
}
type Host = ReturnType<typeof initHost>;
type HistoryStep =
  | "previousTurn"
  | "nextTurn"
  | "undoAction"
  | "redoAction"
  | "undoTurn"
  | "redoTurn";
const NO_EVENTS: TableEvents = { knockedOut: [], shuffled: [], coin: null };

/** The hot-seat game: today's local host, with save, undo and auto-steps. */
export class LocalTableSource implements TableSource {
  readonly mode = "local";
  readonly spectating = false;
  host: Host;
  private events = NO_EVENTS;
  private before: GameState | null = null;
  constructor(setup: LocalGameSetup) {
    this.host = initHost(setup);
  }
  view() {
    return redactGame(this.host.game, this.host.viewerSeat);
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
    const beforeGame = this.host.game;
    const before = this.host.log.length;
    this.before = beforeGame;
    this.host = hostReducer(this.host, { action, at: Date.now() });
    const knockedOut = this.host.knockedOut;
    const seats = new Set<Seat>();
    for (const e of this.host.log.slice(before)) {
      if (e.kind !== "action" || e.who === "system") continue;
      const text = e.segments.map((s) => s.text).join("");
      if (/shuffled their (deck|hand)/.test(text) && !/bottom of their deck/.test(text))
        seats.add(e.who);
    }
    const coin = this.host.coinFlipPresentation ? this.host.coinFlipBatch : null;
    // The Lua coin overlay presents the flips, so settle them immediately.
    if (this.host.coinFlipPresentation && this.host.coinFlipBatch) {
      this.host = hostReducer(this.host, {
        type: "finishCoinFlip",
        id: this.host.coinFlipBatch.id,
      });
    }
    this.events = {
      knockedOut,
      shuffled: [...seats],
      coin,
      counterSource:
        beforeGame.phase.kind === "effect:choose" &&
        beforeGame.phase.cont.pendingOp.op === "moveCountersToOpponentChosen" &&
        beforeGame.phase.cont.pendingOp.from === undefined &&
        action.type === "resolveEffect" &&
        action.choice.kind === "pokemon"
          ? action.choice.ref
          : undefined,
    };
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
  board() {
    return projectGameState(this.host.game, this.host.viewerSeat).board;
  }
  effectContext() {
    const game = this.host.game;
    if (game.phase.kind !== "effect:choose") return { placingCounters: false };
    const { pendingOp, ctx } = game.phase.cont;
    const abilities = ctx?.sourceUid ? cardOfUid(game, ctx.sourceUid)?.abilities : null;
    return {
      placingCounters: pendingOp?.op === "damageChosen" && pendingOp.deals !== true,
      invokedBy: ctx?.invokedBy,
      abilityName: abilities?.length === 1 ? abilities[0]?.name : undefined,
    };
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
      error: this.host.lastError?.message ?? null,
    };
  }
  subscribe() {
    return () => {};
  }
  /** Hand cards drawn from the deck since the last `send` began a new turn. */
  turnDraws(): { seat: Seat; hand: string[]; uid: string }[] {
    const previous = this.before;
    this.before = null;
    const game = this.host.game;
    if (!previous || this.host.lastError || game.turn <= previous.turn) return [];
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
  canStep(type: "undoAction" | "redoAction" | "undoTurn" | "redoTurn") {
    return stepTarget(this.host, type) !== null;
  }
  history(type: HistoryStep) {
    this.host = hostReducer(this.host, { type });
  }
  /** False when the save did not stick (storage full). */
  persist() {
    const h = this.host;
    saveSimulator({
      state: h.game,
      events: [],
      names: h.names,
      startedAt: h.startedAt,
      resume: {
        log: h.log,
        viewerSeat: h.viewerSeat,
        turns: h.turns,
        turnIndex: h.turnIndex,
        latestTurn: h.latestTurn,
        steps: h.steps,
        stepIndex: h.stepIndex,
      },
    });
    return loadSimulatorSave()?.startedAt === h.startedAt;
  }
  /** The same decks reshuffled into a fresh game. */
  nextGame(): { ok: true; setup: LocalGameSetup } | { ok: false; message: string } {
    const h = this.host;
    // createGame assigns p1#0..59 / p2#0..59 once. This immutable mapping
    // retains the full original decks, including cards moved out of play.
    const deck = (seat: Seat) =>
      Array.from({ length: 60 }, (_, i) => h.game.cardIdByUid[`${seat}#${i}`]).filter(
        (id): id is string => id !== undefined,
      );
    const startedAt = Math.max(Date.now(), h.startedAt + 1);
    const created = createGame({
      seed: startedAt,
      decks: { p1: deck("p1"), p2: deck("p2") },
      cardPool: h.game.cardPool,
    });
    if (!created.ok) return { ok: false, message: created.error.message };
    return {
      ok: true,
      setup: { state: created.state, events: created.events, names: h.names, startedAt },
    };
  }
  /** Mulligan draws and Prize picks the hot seat takes for the player. True when
   * anything stepped (the caller saves). */
  autoSteps() {
    const drawn = this.drawMulligans();
    const taken = this.takePrizes();
    return drawn || taken;
  }
  private takePrizes() {
    let taken = false;
    while (this.host.game.phase.kind === "ko:takePrizes") {
      const h = this.host;
      const phase = h.game.phase;
      if (phase.kind !== "ko:takePrizes") break;
      const next = hostReducer(h, {
        action: {
          type: "takePrizes",
          seat: phase.seat,
          prizeIndices: Array.from(
            { length: phase.count },
            (_, i) => h.game.players[phase.seat].prizes.length - 1 - i,
          ),
        },
        at: Date.now(),
      });
      if (next.lastError || next.game === h.game) break;
      this.host = next;
      taken = true;
    }
    if (taken) {
      // Prize-taking belongs to the KO that caused it. Undo/redo must not
      // land on a pending automatic pick and immediately perform it again.
      const steps = this.host.steps.filter((step) => step.game.phase.kind !== "ko:takePrizes");
      this.host = { ...this.host, steps, stepIndex: steps.length - 1 };
    }
    return taken;
  }
  private drawMulligans() {
    let drawn = false;
    while (this.host.game.phase.kind === "setup:drawExtra") {
      const h = this.host;
      const phase = h.game.phase;
      if (phase.kind !== "setup:drawExtra") break;
      const seat = h.viewerSeat;
      const next = hostReducer(h, {
        action: { type: "setupDrawExtra", seat, count: phase.owed[seat] },
        at: Date.now(),
      });
      if (next.lastError || next.game === h.game) break;
      this.host = next;
      drawn = true;
    }
    if (drawn) {
      // Treat the automatic draws as part of completing setup. History must
      // not land on a pending draw and discard its recorded redo branch.
      const steps = this.host.steps.filter((step) => step.game.phase.kind !== "setup:drawExtra");
      this.host = { ...this.host, steps, stepIndex: steps.length - 1 };
    }
    return drawn;
  }
}
