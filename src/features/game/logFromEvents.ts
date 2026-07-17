// GameEvent stream → game-log lines. Entries are recorded SEAT-keyed
// (SeatLogEntry) because the hot-seat viewer flips mid-game: a line minted as
// "you" would lie the moment the other player takes over. `viewLogEntries`
// maps the accumulated seat log into the playmat's LogEntry vocabulary for
// whoever is looking right now. Both functions are pure.
//
// Hidden information stays hidden in the log too: draws and prize takes are
// counts only, and face-down setup placements never name the card — the log
// persists across viewer flips, so a named draw would leak one player's hand
// to the other.

import type { DamageModifier, GameEvent, GameState, Seat } from "@luminous/engine";
import { cardOfUid, otherSeat, topCardOf } from "@luminous/engine";
import type { LogEntry, LogSegment } from "../playmat/types";

export type SeatLogEntry =
  | { kind: "action"; who: Seat | "system"; elapsed: string; segments: LogSegment[] }
  | { kind: "turn"; turn: number };

export interface LogContext {
  /** Display names per seat (deck names on /play). */
  names: Record<Seat, string>;
  /** The state AFTER the events applied — resolves uids to card names.
      Safe for every event below: nothing it names has left play when the
      reduction settles (attach hosts stay put, KO'd names come off the
      event's own uid, not the state). */
  state: GameState;
  /** Wall-clock stamp for the action rows, e.g. "+02:14". */
  elapsed: string;
}

/** "+MM:SS" from milliseconds since game start (clamped at 0). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `+${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function logFromEvents(events: readonly GameEvent[], ctx: LogContext): SeatLogEntry[] {
  const entries: SeatLogEntry[] = [];
  for (const event of events) {
    const formatted = formatEvent(event, ctx);
    if (formatted !== null) entries.push(...formatted);
  }
  return entries;
}

/** Seat log → the playmat's LogEntry, for the current viewer. */
export function viewLogEntries(entries: readonly SeatLogEntry[], viewerSeat: Seat): LogEntry[] {
  return entries.map((entry) => {
    if (entry.kind === "turn") return entry;
    return {
      ...entry,
      who: entry.who === "system" ? "system" : entry.who === viewerSeat ? "you" : "opponent",
    };
  });
}

function cardName(state: GameState, uid: string): string {
  return cardOfUid(state, uid)?.name ?? "a card";
}

/** The Pokémon an attach target points at, resolved from the post-state. */
function targetName(
  state: GameState,
  seat: Seat,
  target: { spot: "active" } | { spot: "bench"; index: number },
): string {
  const side = state.players[seat];
  const pokemon = target.spot === "active" ? side.active : side.bench[target.index];
  if (pokemon == null) return target.spot === "active" ? "the Active spot" : "the Bench";
  return topCardOf(state, pokemon)?.name ?? "a Pokémon";
}

function modifierText(kind: "weakness" | "resistance", modifier: DamageModifier): string {
  const symbol = modifier.op === "multiply" ? "×" : modifier.op === "add" ? "+" : "−";
  return ` · ${kind} ${symbol}${modifier.amount}`;
}

const strong = (text: string): LogSegment => ({ text, tone: "strong" });
const plain = (text: string): LogSegment => ({ text });

/** One event → its log rows (usually one), or null to skip it. The switch is
    deliberately NOT exhaustive-checked: a future engine event must fall out
    as "skipped", never as a crash (coverage doctrine, simulator.md). */
function formatEvent(event: GameEvent, ctx: LogContext): SeatLogEntry[] | null {
  const { names, state, elapsed } = ctx;
  const row = (who: Seat | "system", segments: LogSegment[]): SeatLogEntry[] => [
    { kind: "action", who, elapsed, segments },
  ];
  switch (event.type) {
    case "SHUFFLE":
      return row(event.seat, [plain("shuffled their deck")]);
    case "COIN_FLIP":
      return row("system", [
        plain("Coin flip: "),
        strong(event.result),
        plain(" — "),
        strong(names[event.winner]),
        plain(" wins the toss"),
      ]);
    case "FIRST_PLAYER_CHOSEN":
      return row("system", [strong(names[event.first]), plain(" goes first")]);
    case "CARDS_DRAWN": {
      // Counts only — never card identity (see module header).
      const n = event.uids.length;
      switch (event.reason) {
        case "opening":
          return row(event.seat, [plain(`drew ${n} cards`)]);
        case "mulligan":
          return row(event.seat, [plain(`redrew ${n} cards`)]);
        case "compensation":
          return row(event.seat, [plain(`drew ${n} extra card${n === 1 ? "" : "s"}`)]);
        case "turnStart":
          return row(event.seat, [plain("drew a card")]);
        default:
          return row(event.seat, [plain(`drew ${n} card${n === 1 ? "" : "s"}`)]);
      }
    }
    case "MULLIGAN_REVEALED":
      return row(event.seat, [
        plain("revealed a hand with no Basic Pokémon — "),
        strong("mulligan"),
      ]);
    case "POKEMON_PLACED":
      // Face-down until SETUP_REVEALED — the log must not name it.
      return row(event.seat, [
        plain(
          event.spot === "active"
            ? "placed a face-down Active Pokémon"
            : "placed a face-down Pokémon on the Bench",
        ),
      ]);
    case "POKEMON_BENCHED":
      return row(event.seat, [plain("benched "), strong(cardName(state, event.uid))]);
    case "COMPENSATION_DECIDED":
      // A draw already logged its own CARDS_DRAWN row; only the decline is
      // otherwise invisible.
      if (event.drawn > 0) return null;
      return row(event.seat, [plain("declined the mulligan draw")]);
    case "PRIZES_SET":
      return row(event.seat, [plain(`set aside ${event.uids.length} prize cards`)]);
    case "SETUP_READY":
      return row(event.seat, [plain("is ready")]);
    case "SETUP_REVEALED":
      return row("system", [plain("Both players ready — the board is revealed")]);
    case "TURN_STARTED":
      return [{ kind: "turn", turn: event.turn }];
    case "ENERGY_ATTACHED":
      return row(event.seat, [
        plain("attached "),
        { text: cardName(state, event.uid), tone: "energy" },
        plain(" → "),
        strong(targetName(state, event.seat, event.target)),
      ]);
    case "RETREATED": {
      const segments: LogSegment[] = [
        plain("retreated "),
        strong(cardName(state, event.retreated)),
        plain(" — "),
        strong(cardName(state, event.promoted)),
        plain(" is now Active"),
      ];
      if (event.discardedEnergy.length > 0) {
        segments.push(plain(` (discarded ${event.discardedEnergy.length} energy)`));
      }
      return row(event.seat, segments);
    }
    case "ATTACK_DECLARED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" used "),
        strong(event.attack),
      ]);
    case "ATTACK_EFFECT_SKIPPED":
      return row("system", [
        strong(event.attack),
        plain(
          event.damageModifier === null
            ? " — effect not simulated"
            : ` — "${event.damageModifier}" damage and effect not simulated`,
        ),
      ]);
    case "DAMAGE_DEALT": {
      // The event's seat owns the DEFENDER; the line reads from the attacker.
      const segments: LogSegment[] = [
        plain("dealt "),
        { text: String(event.dealt), tone: "damage" },
        plain(" damage to "),
        strong(cardName(state, event.uid)),
      ];
      if (event.weakness !== null) segments.push(plain(modifierText("weakness", event.weakness)));
      if (event.resistance !== null) {
        segments.push(plain(modifierText("resistance", event.resistance)));
      }
      return row(otherSeat(event.seat), segments);
    }
    case "KNOCKED_OUT":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" was "),
        { text: "Knocked Out", tone: "damage" },
      ]);
    case "PRIZES_OWED": {
      const n = event.count;
      return row(event.seat, [plain(`takes ${n} prize card${n === 1 ? "" : "s"}`)]);
    }
    case "PRIZES_TAKEN": {
      // Count only — the cards go to a hand the other player must not read.
      const n = event.uids.length;
      return row(event.seat, [
        plain(`took ${n} prize card${n === 1 ? "" : "s"} — ${event.remaining} left`),
      ]);
    }
    case "PROMOTION_REQUIRED":
      return row(event.seat, [plain("must promote a benched Pokémon")]);
    case "POKEMON_PROMOTED":
      return row(event.seat, [
        plain("promoted "),
        strong(cardName(state, event.uid)),
        plain(" to Active"),
      ]);
    case "TURN_ENDED":
      return row(event.seat, [plain("ended their turn")]);
    case "GAME_OVER": {
      const outcome = event.outcome;
      if (outcome.result === "win") {
        const reason =
          outcome.reason === "prizesTaken"
            ? "all prizes taken"
            : outcome.reason === "noPokemon"
              ? "the opponent has no Pokémon left"
              : "the opponent could not draw";
        return row("system", [strong(names[outcome.winner]), plain(` wins — ${reason}`)]);
      }
      return row("system", [strong("The game ends in a tie")]);
    }
    default:
      // A future engine event lands here — skipped, never a crash.
      return null;
  }
}
