import {
  benchLimitForIds,
  type EffectChoice,
  type GameAction,
  type PokemonRef,
} from "@colorless/engine";

import type {
  Card,
  RedactedCard,
  RedactedEffectPrompt,
  RedactedGame,
  SeatLogEntry,
} from "@colorless/schema";
import { fetchCardPool } from "../game/cardPool";

import type { ActionError, LobbyClient } from "../online/lobbyClient";

import type { LifecycleFlag, TableLifecycle, TableSource } from "./tableSource";
import { autoStepFor, counterSourcePicked, eventsFromLog, NO_EVENTS } from "./tableEvents";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Shown on a finished table whose seat was refused on reconnect: its account is signed out. */
export const SEAT_LOST = "Sign in again to take your seat back.";
/** A server that predates `benchLimit` leaves the limit to this client's own card data. */
const benchLimitOf = (v: RedactedGame) =>
  v.board.you.benchLimit ??
  benchLimitForIds(
    v.board.stadium?.cardId,
    [v.board.you.active, ...v.board.you.bench].flatMap((c) => (c ? [c.cardId] : [])),
  );
const roomOnBench = (v: RedactedGame) => v.board.you.bench.length < benchLimitOf(v);

/** An effect answer the prompt can accept; anything
 * finer (caps, legal targets) is the server's to refuse. */
export function promptGate(prompt: RedactedEffectPrompt, choice: EffectChoice): boolean {
  if (prompt.kind === "chooseCards" && choice.kind === "cards")
    return choice.uids.length >= prompt.min && choice.uids.length <= prompt.max;
  if (prompt.kind === "choosePokemonMulti" && choice.kind === "pokemonMulti")
    return (
      (choice.refs.length >= prompt.min && choice.refs.length <= prompt.max) ||
      (prompt.declinable && choice.refs.length === 0)
    );
  if (
    (prompt.kind === "discardEnergy" && choice.kind === "discardEnergy") ||
    (prompt.kind === "discardTools" && choice.kind === "discardTools")
  ) {
    const scope = prompt.scope;
    if (scope.kind === "total") return choice.uids.length === scope.count;
    if (scope.kind === "upTo") return choice.uids.length <= scope.max;
    const host = (uid: string) =>
      JSON.stringify(prompt.discardable.find((c) => c.uid === uid)?.from);
    const hosts = new Set(prompt.discardable.map((c) => host(c.uid)));
    const picked = new Set(choice.uids.map(host));
    return picked.size === choice.uids.length && picked.size === hosts.size;
  }
  if (prompt.kind === "orderCards" && choice.kind === "orderCards")
    return (
      choice.uids.length === prompt.candidates.length ||
      (prompt.alt !== undefined && choice.uids.length === 0)
    );
  if (prompt.kind === "moveEnergy" && choice.kind === "moveEnergy")
    return choice.picks.length >= (prompt.min ?? 0) && choice.picks.length <= prompt.max;
  if (prompt.kind === "attachCards" && choice.kind === "attachCards")
    return choice.assignments.length <= prompt.max;
  if (choice.kind === "hpGuess") return Number.isInteger(choice.hp) && choice.hp >= 0;
  return true;
}

/** Online there is no engine to try an action on: the redacted phase carries
 * the server's own gates. Anything it does not know is offered, and a refusal
 * comes back as `reject-action`. */
export function onlineGate(action: GameAction, v: RedactedGame): boolean {
  const p = v.phase;
  const acting = v.waitingOn === "you";
  const hand = (uid: string) => v.board.you.hand.find((c) => c.id === uid);
  const basic = (c: RedactedCard | undefined) => c?.category !== "Pokemon" || c.stage === "Basic";
  switch (action.type) {
    case "concede":
      return v.outcome === null;
    case "chooseFirstPlayer":
      return p.kind === "setup:chooseFirst" && acting;
    case "setupDrawExtra":
      return p.kind === "setup:drawExtra" && acting;
    case "setupPlaceActive":
    case "setupPlaceBench":
      return (
        p.kind === "setup:place" &&
        !p.ready.you &&
        basic(hand(action.uid)) &&
        (p.stage !== "bonus" || (p.bonusCards ?? []).includes(action.uid)) &&
        (action.type === "setupPlaceActive"
          ? v.board.you.active === null
          : v.board.you.active !== null && roomOnBench(v))
      );
    case "setupReady":
      return p.kind === "setup:place" && !p.ready.you && v.board.you.active !== null;
    case "takePrizes":
      return p.kind === "ko:takePrizes" && acting;
    case "promote":
      return p.kind === "ko:promote" && acting;
    case "resolveEffect":
      return p.kind === "effect:choose" && p.prompt !== null && promptGate(p.prompt, action.choice);
    case "reorderBench":
      return p.kind === "setup:place"
        ? !p.ready.you
        : p.kind === "turn:action" && v.activePlayer === "you";
  }
  if (p.kind !== "turn:action" || v.activePlayer !== "you") return false;
  // The attack-again window grants a second attack, not a second main phase.
  if (p.attackAgain && action.type !== "attack" && action.type !== "endTurn") return false;
  switch (action.type) {
    case "attack":
      return p.attacks.some((a) => a.index === action.index && a.playable);
    case "useAbility":
      return p.abilities.some(
        (a) => same(a.target, action.target) && a.abilityName === action.abilityName && !a.disabled,
      );
    case "useStadiumAbility":
      return !!p.stadiumAbility && !p.stadiumAbility.disabled;
    case "retreat":
      return !!p.retreat?.can;
    case "playTrainer": {
      // Offers are deduplicated per card: any copy answers for the rest.
      const cardId = hand(action.uid)?.cardId;
      const offer = p.trainers.find((t) => t.uid === action.uid || hand(t.uid)?.cardId === cardId);
      return !!offer && !offer.disabled;
    }
    case "playBasicToBench":
      return basic(hand(action.uid)) && roomOnBench(v);
    case "evolve": {
      const top =
        action.target.spot === "active"
          ? v.board.you.active
          : v.board.you.bench[action.target.index];
      return !!top && !!hand(action.uid)?.evolutionTargetIds?.includes(top.id);
    }
    case "rareCandy":
      return p.rareCandy.some(
        (o) => same(o.target, action.target) && o.stage2.some((e) => e.uid === action.evolutionUid),
      );
    case "discardFromPlay":
      return (p.discardable ?? []).some((d) => same(d.target, action.target));
    case "attachEnergy":
      return !v.allowances?.energy;
    default:
      return true;
  }
}

export type CardPool = (ids: string[]) => Promise<{ pool: Record<string, Card> }>;

/** The live lobby match as a table: RedactedGame frames in, GameActions out
 * through the one LobbyClient the modal also drives. No engine, no save. */
export class LuaOnlineMatch implements TableSource {
  readonly mode = "online";
  readonly spectating = false;
  private seen: RedactedGame | null = null;
  private match = "";
  private logLength = 0;
  private events = NO_EVENTS;
  private counter: PokemonRef | undefined;
  private pool: Record<string, Card> = {};
  private asked = new Set<string>();
  private keys = new Map<string, string>();
  private autoSent = new Set<string>();
  private auto = false;
  private error: ActionError | null = null;
  private muted: ActionError | null = null;
  private sentRematch = "";
  /** The match whose rematch this table saw the lobby take up, ready or readied once. */
  private acceptedRematch = "";
  /** What the table shows of the lobby beyond the match, as last notified. */
  private shownLobby = "";
  private released = false;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  /** A player action is in flight: no new frame or refusal yet. */
  pending = false;

  constructor(
    private client: LobbyClient,
    private hooks: { serial: () => number; release: () => void; leave: () => void },
    private deps: { cards?: CardPool } = {},
  ) {
    this.error = client.state.actionError;
    this.muted = this.error;
    this.shownLobby = this.lobbyKey();
    this.unsubscribe = client.subscribe(() => this.changed());
    this.frame(client.state.match);
  }

  view() {
    return this.seen;
  }
  names() {
    return {
      you: this.client.self?.name || "You",
      opponent: this.client.opponent?.name || "Opponent",
    };
  }
  log(): readonly SeatLogEntry[] {
    return this.client.state.matchLog;
  }
  /** A new id per in-game flip of the lobby, so a rematch is a fresh table. */
  matchId() {
    return `${this.client.code}:${this.hooks.serial()}`;
  }
  card(cardId: string) {
    return this.pool[cardId];
  }
  face(card: Pick<RedactedCard, "cardId">) {
    return this.pool[card.cardId];
  }
  allowed(action: GameAction) {
    return !!this.seen && onlineGate(action, this.seen);
  }
  send(action: GameAction, opts: { auto?: boolean } = {}) {
    this.counter = counterSourcePicked(this.seen, action) ?? this.counter;
    this.auto = !!opts.auto;
    if (!opts.auto) this.pending = true;
    this.client.sendAction(action);
  }
  allowances() {
    const v = this.seen;
    if (!v) return null;
    if (v.allowances) return v.allowances;
    // A server that sends no allowances: the Supporter one is recovered from the log.
    const discard = v.board.you.discard;
    let turn = 0;
    let supporter = false;
    for (const e of this.log()) {
      if (e.kind === "turn") turn = e.turn;
      else if (turn === v.turn && e.who === v.seat && e.playedTrainer) {
        const t = e.playedTrainer;
        const type =
          discard.find((c) => c.id === t.id)?.trainerType ?? this.pool[t.cardId]?.trainerType;
        supporter ||= type === "Supporter";
      }
    }
    return { energy: false, supporter, retreated: false };
  }
  benchKey(owner: "you" | "opponent", index: number) {
    const c = this.seen?.board[owner].bench[index];
    return c ? (this.keys.get(c.id) ?? c.id) : "";
  }

  takeEvents() {
    const events = this.events;
    this.events = NO_EVENTS;
    return events;
  }
  lifecycle(): TableLifecycle {
    const over = !!this.seen?.outcome;
    const opponent = this.client.opponent;
    const sent = this.sentRematch === this.matchId();
    // A seat refused on reconnect (a signed-out account) leaves this tab watching: no rematch.
    const seated = !this.watching();
    const flags: LifecycleFlag[] = [];
    if (this.seen && !over) flags.push("concede");
    if (over && seated) flags.push("rematch");
    if (over && seated && sent) flags.push("rematch-sent");
    flags.push("leave");
    return {
      flags,
      opponentAway:
        opponent && !opponent.connected && !over
          ? { name: opponent.name, forfeitAt: opponent.forfeitAt }
          : null,
      // An automatic step's refusal is muted.
      error: this.error !== this.muted ? this.error : null,
      ...(over && !seated && { warning: SEAT_LOST }),
    };
  }
  private watching() {
    return this.client.state.status === "spectating";
  }
  rematch() {
    if (!this.seen?.outcome || this.watching() || this.sentRematch === this.matchId()) return;
    this.sentRematch = this.matchId();
    // The opponent asked first and the lobby already left the game: agree by readying.
    if (this.client.state.snapshot?.phase === "in-game") this.client.requestRematch();
    else {
      this.acceptedRematch = this.sentRematch;
      this.client.setReady(true);
    }
    this.notify();
  }
  /** Walk out for good: bye (a forfeit if the match is live), forget the seat. */
  leave() {
    this.hooks.leave();
  }
  subscribe(onChange: () => void) {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
  release() {
    if (this.released) return;
    this.released = true;
    this.unsubscribe();
    this.listeners.clear();
    this.hooks.release();
  }

  private notify() {
    for (const fn of [...this.listeners]) fn();
  }

  /** The lobby's part of what the table shows: the names, the opponent's presence and forfeit
   * clock, the link and the match id. */
  private lobbyKey() {
    const { self, opponent } = this.client;
    return JSON.stringify([
      self?.name,
      opponent?.name,
      opponent?.connected,
      opponent?.forfeitAt,
      this.client.state.status,
      this.matchId(),
    ]);
  }

  /** Re-render only for a change the table shows; most lobby frames mid-match carry none. */
  private changed() {
    const { match, actionError } = this.client.state;
    let shown = false;
    // A rematch takes the lobby out of in-game; the finished board stays up
    // until the next game's first frame. A tab that lost its seat after the game ended is sent the
    // spectator view, which this tab's names would mislabel: it keeps the result it saw seated.
    const keepResult = !!this.seen?.outcome && (match === null || this.watching());
    if (match !== this.seen && !keepResult) {
      this.pending = false;
      this.frame(match);
      shown = true;
    }
    if (actionError !== this.error) {
      this.error = actionError;
      if (actionError) {
        if (this.auto) this.muted = actionError;
        else this.pending = false;
        // A refused rematch (a signed-out seat) is not waiting on the other player any more.
        if (this.seen?.outcome && this.sentRematch === this.matchId()) this.sentRematch = "";
      }
      shown = true;
    }
    this.acceptRematch();
    const lobby = this.lobbyKey();
    if (lobby !== this.shownLobby) {
      this.shownLobby = lobby;
      shown = true;
    }
    if (shown) this.notify();
  }

  /** Our rematch is pending and the lobby left the game for one: when it was the opponent's that
   * got there first (both pressed within a round trip) or ours was lost, this seat is not ready,
   * so it agrees by readying. Once per match, so a handoff that fails and unreadies both is left
   * to the players. */
  private acceptRematch() {
    const id = this.matchId();
    const self = this.client.self;
    if (this.sentRematch !== id || this.acceptedRematch === id || !self) return;
    if (this.client.state.snapshot?.phase !== "selecting") return;
    this.acceptedRematch = id;
    if (!self.ready) this.client.setReady(true);
  }

  /** Take a new frame: the cues of the log rows it brought, bench keys, auto-steps. */
  private frame(next: RedactedGame | null) {
    let prev = this.seen;
    this.seen = next;
    if (!next) return;
    const log = this.log();
    const id = this.matchId();
    if (id !== this.match || log.length < this.logLength) {
      this.match = id;
      this.autoSent.clear();
      this.keys.clear();
      this.logLength = log.length;
      prev = null;
    }
    const tops = (g: RedactedGame) =>
      [g.board.you, g.board.opponent].flatMap((s) =>
        [s.active, ...s.bench].flatMap((c) => (c ? [c.id] : [])),
      );
    const names = this.names();
    const fresh = eventsFromLog(log.slice(this.logLength), (seat) =>
      seat === next.seat ? names.you : names.opponent,
    );
    this.logLength = log.length;
    const held = this.events;
    this.events = {
      knockedOut: [...held.knockedOut, ...fresh.knockedOut],
      shuffled: [...new Set([...held.shuffled, ...fresh.shuffled])],
      coin:
        held.coin && fresh.coin
          ? { title: fresh.coin.title, flips: [...held.coin.flips, ...fresh.coin.flips] }
          : (fresh.coin ?? held.coin),
      counterSource: this.counter ?? held.counterSource,
    };
    this.counter = undefined;
    // Only the top uid travels: an evolution at the same bench slot inherits
    // the old stack's key, so the cosmetic order survives it.
    const inPlay = new Set(tops(next));
    for (const owner of ["you", "opponent"] as const)
      next.board[owner].bench.forEach((c, i) => {
        if (this.keys.has(c.id)) return;
        const old = prev?.board[owner].bench[i];
        this.keys.set(c.id, old && !inPlay.has(old.id) ? (this.keys.get(old.id) ?? old.id) : c.id);
      });
    this.fetch(next);
    this.autoSteps(next);
  }

  /** AutoMulliganDraw and AutoTakePrizes: once per decision, refusals muted. */
  private autoSteps(v: RedactedGame) {
    const action = autoStepFor(v);
    if (!action) return;
    const key = JSON.stringify(action);
    if (this.autoSent.has(key)) return;
    this.autoSent.add(key);
    this.send(action, { auto: true });
  }

  /** Catalogue faces for every visible card id, fetched once each. */
  private fetch(game: RedactedGame) {
    const ids = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) for (const y of x) walk(y);
      else if (x && typeof x === "object") {
        const id = (x as { cardId?: unknown }).cardId;
        if (typeof id === "string" && id !== "hidden" && id !== "empty") ids.add(id);
        for (const y of Object.values(x)) walk(y);
      }
    };
    walk(game);
    const missing = [...ids].filter((id) => !this.asked.has(id));
    if (missing.length === 0) return;
    for (const id of missing) this.asked.add(id);
    (this.deps.cards ?? fetchCardPool)(missing).then(
      ({ pool }) => {
        Object.assign(this.pool, pool);
        if (!this.released) this.notify();
      },
      () => {
        for (const id of missing) this.asked.delete(id);
      },
    );
  }
}
