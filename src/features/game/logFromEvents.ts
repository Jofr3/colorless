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

import type { DamageModifier, GameEvent, GameState, Seat, StatusName } from "@luminous/engine";
import { DEFAULT_POISON_DAMAGE, cardOfUid, otherSeat, topCardOf } from "@luminous/engine";
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

/** Event vocabulary → the capitalized condition words the rules use (§12).
    UI-side single source for the labels — GameHud's status copy reads this
    map too, so the wording cannot drift between the log and the panels. */
export const STATUS_LABELS: Record<StatusName, string> = {
  asleep: "Asleep",
  paralyzed: "Paralyzed",
  confused: "Confused",
  burned: "Burned",
  poisoned: "Poisoned",
};

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
      // Hoisted for the default arm: with every DrawReason handled below,
      // TS narrows `event` to never inside it (`reason` became a GameEvent
      // discriminant when M3 events started carrying one) — the arm stays,
      // per the doctrine above, for whatever reason ships next.
      const seat = event.seat;
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
          return row(seat, [plain(`drew ${n} card${n === 1 ? "" : "s"}`)]);
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
    case "POKEMON_EVOLVED":
      // `from` is still resolvable — it stays at the bottom of the evolved
      // stack; `to` is the new top card.
      return row(event.seat, [
        plain("evolved "),
        strong(cardName(state, event.from)),
        plain(" → "),
        strong(cardName(state, event.to)),
      ]);
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
    case "ATTACK_EFFECT_SKIPPED": {
      // The event contract (events.ts): `effect` carries the UNSIMULATED
      // printed text — null means the text derived and ran (or there was
      // none); `damageModifier` is the unsimulated damage marker — null
      // means there was none. Each case claims ONLY what did not run: a
      // derived effect may have executed in this very batch (its
      // STATUS_APPLIED rows sit next to this one), so a marker-only skip
      // must not say "effect not simulated".
      const { effect, damageModifier } = event;
      const wording =
        damageModifier !== null && effect !== null
          ? ` — "${damageModifier}" damage and effect not simulated`
          : damageModifier !== null
            ? ` — "${damageModifier}" damage not simulated`
            : effect !== null
              ? ` — effect "${effect}" not simulated`
              : null;
      // All-null skips are never emitted (attack.ts) — stay total anyway.
      if (wording === null) return null;
      return row("system", [strong(event.attack), plain(wording)]);
    }
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
    // — M3 special conditions (§12) + the Pokémon Checkup (§13). Card names
    //   resolve off the event's own uid, so a status that lands on a Pokémon
    //   the same batch then KOs still names it correctly.
    //   §13 batch semantics (for future animation authors): a Checkup batch
    //   can hold recovery events that PRECEDE a KNOCKED_OUT for the SAME uid
    //   — key animations off post-batch state, never a lone STATUS_CLEARED.
    case "STATUS_APPLIED": {
      const segments: LogSegment[] = [
        strong(cardName(state, event.uid)),
        plain(" is now "),
        strong(STATUS_LABELS[event.status]),
      ];
      // Raised poison ("put 2 damage counters instead of 1") is worth
      // spelling out; the engine default stays implicit like the rulebook's.
      if (event.poisonDamage !== undefined && event.poisonDamage > DEFAULT_POISON_DAMAGE) {
        segments.push(plain(` (${event.poisonDamage} damage per Checkup)`));
      }
      return row(event.seat, segments);
    }
    case "STATUS_CLEARED": {
      // Hoisted for the default arm (the CARDS_DRAWN pattern): with every
      // known reason handled, TS narrows `event` to never inside it.
      const seat = event.seat;
      const name = cardName(state, event.uid);
      const statuses = event.statuses.map((status) => STATUS_LABELS[status]).join(", ");
      switch (event.reason) {
        case "wokeUp":
          return row(seat, [strong(name), plain(" woke up")]);
        case "burnCured":
          return row(seat, [strong(name), plain("'s Burn was cured")]);
        case "paralysisEnded":
          return row(seat, [strong(name), plain("'s Paralysis wore off")]);
        case "benched":
          // Follows the RETREATED row; benching clears every condition at
          // once (§11/§12), so the list can name several.
          return row(seat, [strong(name), plain(" recovered from "), strong(statuses)]);
        case "evolved":
          // Follows the POKEMON_EVOLVED row; evolving clears every condition
          // at once (§10). `name` is the new top card.
          return row(seat, [strong(name), plain(" shed "), strong(statuses), plain(" on evolving")]);
        default:
          return row(seat, [strong(name), plain(" recovered from "), strong(statuses)]);
      }
    }
    case "COUNTERS_PLACED": {
      // Checkup ticks and the confusion self-hit are the game's doing, not a
      // player action — system rows, like the coin toss.
      const seat = event.seat;
      const name = cardName(state, event.uid);
      const amount: LogSegment = { text: String(event.amount), tone: "damage" };
      switch (event.source) {
        case "poison":
          return row("system", [plain("Poison: "), amount, plain(" damage to "), strong(name)]);
        case "burn":
          return row("system", [plain("Burn: "), amount, plain(" damage to "), strong(name)]);
        case "confusion":
          return row("system", [
            plain("Confusion: "),
            strong(name),
            plain(" hit itself for "),
            amount,
          ]);
        default:
          return row(seat, [amount, plain(" damage to "), strong(name)]);
      }
    }
    case "CHECKUP_COIN_FLIP":
      // event.status is the "asleep" | "burned" subset of StatusName — the
      // shared label map covers it.
      return row("system", [
        plain("Checkup — "),
        strong(STATUS_LABELS[event.status]),
        plain(` flip for ${names[event.seat]}: `),
        strong(event.result),
      ]);
    case "CONFUSION_CHECK":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" is Confused — flip: "),
        strong(event.result),
      ]);
    case "ATTACK_FAILED":
      // reason is "confusion" (the only §12 attack-failure today): tails on
      // the confusion check — the 30 self-damage follows as its own row.
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain("'s attack failed — Confused"),
      ]);
    case "HEALED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(` healed ${event.amount} damage`),
      ]);
    case "ATTACK_EFFECT_COIN_FLIP":
      // seat is the ATTACKER — the flip gates their own attack's effect.
      return row(event.seat, [
        plain("flipped "),
        strong(event.result),
        plain(" for the attack effect"),
      ]);
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
