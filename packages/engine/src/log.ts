// GameEvent stream to game-log rows. Entries are seat-keyed because the same log is shown to both
// players and across hot-seat flips; the seat-to-viewer relabel happens in the render layer
// (`viewLogEntries`). Pure, and run both client-side and in the lobby Durable Object. Hidden
// information stays hidden: draws and prize takes are counts only, and face-down setup placements
// never name the card.

import type { LogSegment, SeatLogEntry } from "@colorless/schema";
import { type DamageModifier, cardOfUid, topCardOf } from "./cards";
import type { AttackerClass } from "./effectTypes";
import type { GameEvent, StatusName } from "./events";
// promptText.ts imports nothing from this file, so there is no cycle.
import { retrieveNoun } from "./promptText";
import {
  bodyAt,
  inPlayOf,
  DEFAULT_CONFUSION_DAMAGE,
  DEFAULT_POISON_DAMAGE,
  type GameOverReason,
  type GameState,
  type Seat,
  otherSeat,
} from "./types";

export interface LogContext {
  /** Display names per seat (deck names on /play). */
  names: Record<Seat, string>;
  /**
   * The state after the events applied, used to resolve uids to card names. An attach whose host is
   * Knocked Out in the same batch is named through `knockedOutHosts`.
   */
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
  const koHosts = knockedOutHosts(events);
  for (const event of events) {
    const formatted = formatEvent(event, ctx, koHosts);
    if (formatted === null) continue;
    if (event.type === "TRAINER_PLAYED" || event.type === "TOOL_ATTACHED") {
      const card = cardOfUid(ctx.state, event.uid);
      const first = formatted[0];
      if (card && first?.kind === "action") {
        first.playedTrainer = { id: event.uid, cardId: card.id, name: card.name };
      }
    }
    entries.push(...formatted);
  }
  return entries;
}

function cardName(state: GameState, uid: string): string {
  return cardOfUid(state, uid)?.name ?? "a card";
}

/**
 * The `KNOCKED_OUT.toHand` tail, counted by what moved: Energy as "N Basic Energy", other cards as
 * "N Pokémon card(s)".
 */
function koToHandTail(state: GameState, uids: readonly string[]): string {
  const energy = uids.filter((uid) => cardOfUid(state, uid)?.category === "Energy").length;
  const pokemon = uids.length - energy;
  const parts = [
    ...(pokemon === 0 ? [] : [`${pokemon} Pokémon card${pokemon === 1 ? "" : "s"}`]),
    ...(energy === 0 ? [] : [`${energy} Basic Energy`]),
  ];
  return ` — ${parts.join(" and ")} put into the hand instead of the discard pile`;
}

/**
 * The printed attacker class as a noun modifier ("Basic", "Basic non-Colorless"). It spells type
 * names, never brace codes.
 */
function attackerClassPhrase(cls: AttackerClass): string {
  const stage = stageWord(cls.stage);
  return cls.excludingType === undefined ? stage : `${stage} non-${cls.excludingType}`;
}

/**
 * The whole printed class noun ("Basic Pokémon", "Pokémon ex"), since the ex class puts its word
 * after "Pokémon".
 */
function attackerClassNoun(cls: AttackerClass): string {
  // "Pokémon that have an Ability" also puts its class after "Pokémon".
  if (cls.stage === "hasAbility") return "Pokémon that have an Ability";
  return cls.stage === "ex" ? "Pokémon ex" : `${attackerClassPhrase(cls)} Pokémon`;
}

/**
 * "{class}'s attacks", except a class whose noun ends in a clause takes "attacks from Pokémon that
 * have an Ability".
 */
function attackerClassAttacks(cls: AttackerClass): string {
  const noun = attackerClassNoun(cls);
  return cls.stage === "hasAbility" ? `attacks from ${noun}` : `${noun}'s attacks`;
}

/** The stage word's printed CASING, and a `switch` for `attackerMatchesStage`'s
    reason (continuous.ts): the stored token is lowercase, the printed word is
    capitalised, and a new member must be given a spelling by a human rather than
    leaking its internal token into a log row. */
function stageWord(stage: AttackerClass["stage"]): string {
  switch (stage) {
    case "basic":
      return "Basic";
    case "ancient":
      return "Ancient";
    case "ex":
      return "ex";
    // Lava Wall, Flashing Barrier / Metal Block, Psy Protection.
    case "burned":
      return "Burned";
    case "evolution":
      return "Evolution";
    case "hasAbility":
      // The printed words, which FOLLOW "Pokémon" — `attackerClassNoun` places them and never asks
      // this switch for this member; the arm exists for exhaustiveness.
      return "that have an Ability";
  }
}

/** The Pokémon an attach target points at, resolved from the post-state. Safe
    for a target whose host stays put (Tools — attachTool never moves it). */
function targetName(
  state: GameState,
  seat: Seat,
  target: { spot: "active" } | { spot: "bench"; index: number },
): string {
  const side = state.players[seat];
  const pokemon = bodyAt(side, target);
  if (pokemon === undefined) return target.spot === "active" ? "the Active spot" : "the Bench";
  return topCardOf(state, pokemon)?.name ?? "a Pokémon";
}

/** Card names for a batch, repeats folded into "×N" in first-seen order —
    "Fire Energy ×2, fix-energy" rather than "Fire Energy, Fire Energy,
    fix-energy". A `count: "all"` discard is the first batch that can hold
    several copies of one card (every earlier producer emitted one uid per
    event), and a run of identical names reads as a stutter rather than a
    quantity. */
function countedNames(cardNames: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of cardNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(", ");
}

/**
 * The Pokémon carrying `energyUid`, resolved by uid rather than slot because an on-attach move (Jet
 * Energy) can compact the bench. Reads the post-state.
 *
 * The Energy each KNOCKED_OUT in this batch took out of play, keyed by the KO'd body's top uid, so
 * an attach whose host was Knocked Out in the same batch can still name it. Read only when no body
 * carries the Energy.
 */
function knockedOutHosts(events: readonly GameEvent[]): ReadonlyMap<string, string> {
  const hosts = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "KNOCKED_OUT") continue;
    for (const uid of [...event.discarded, ...(event.toHand ?? [])]) hosts.set(uid, event.uid);
  }
  return hosts;
}

function energyHostName(
  state: GameState,
  seat: Seat,
  energyUid: string,
  koHosts: ReadonlyMap<string, string>,
): string {
  const carrierOf = (owner: Seat) => {
    const side = state.players[owner];
    const carriers = inPlayOf(side);
    return carriers.find((pokemon) => pokemon.energy.includes(energyUid));
  };
  // The event's seat is the actor; a cross-seat attach puts the Energy on the other seat's body, so
  // that board is scanned after the actor's.
  const host = carrierOf(seat) ?? carrierOf(otherSeat(seat));
  if (host !== undefined) return topCardOf(state, host)?.name ?? "a Pokémon";
  // No body carries it: the host left play in this same batch.
  const knockedOut = koHosts.get(energyUid);
  return knockedOut === undefined
    ? "a Pokémon"
    : (cardOfUid(state, knockedOut)?.name ?? "a Pokémon");
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
const STATUS_LABELS: Record<StatusName, string> = {
  asleep: "Asleep",
  paralyzed: "Paralyzed",
  confused: "Confused",
  burned: "Burned",
  poisoned: "Poisoned",
};

/** Why the game ended, in log prose. A total `Record` on purpose — this replaced
    a ternary chain whose final `else` meant a NEW reason silently rendered as
    "the opponent could not draw"; a record makes an unhandled reason a compile
    error instead. Phrased from the WINNER's side, which is how the row reads
    ("<winner> wins — …"). `conceded` says "forfeited" rather than "conceded"
    because the same reason covers a player pressing concede AND an online player
    abandoning the match (P4 3c-ii) — forfeit is true of both. */
const GAME_OVER_REASONS: Record<GameOverReason, string> = {
  prizesTaken: "all prizes taken",
  noPokemon: "the opponent has no Pokémon left",
  deckOut: "the opponent could not draw",
  conceded: "the opponent forfeited",
  // A card's printed win (N's Sigilyph "Victory Symbol").
  cardEffect: "a card's effect won the game",
};

type EventOf<K extends GameEvent["type"]> = Extract<GameEvent, { type: K }>;

/** What every per-family formatter reads: the log context plus the one-row builder. */
interface LogFormat {
  names: Record<Seat, string>;
  state: GameState;
  elapsed: string;
  koHosts: ReadonlyMap<string, string>;
  row: (who: Seat | "system", segments: LogSegment[]) => SeatLogEntry[];
}

/** One event → its log rows (usually one), or null to skip it. */
function formatEvent(
  event: GameEvent,
  ctx: LogContext,
  koHosts: ReadonlyMap<string, string>,
): SeatLogEntry[] | null {
  const { names, state, elapsed } = ctx;
  const fmt: LogFormat = {
    names,
    state,
    elapsed,
    koHosts,
    row: (who, segments) => [{ kind: "action", who, elapsed, segments }],
  };
  switch (event.type) {
    case "SHUFFLE":
    case "COIN_FLIP":
    case "FIRST_PLAYER_CHOSEN":
    case "CARDS_DRAWN":
    case "MULLIGAN_REVEALED":
    case "POKEMON_PLACED":
    case "POKEMON_BENCHED":
    case "POKEMON_EVOLVED":
    case "POKEMON_DEVOLVED":
    case "COMPENSATION_DECIDED":
    case "PRIZES_SET":
    case "SETUP_READY":
    case "SETUP_REVEALED":
    case "TURN_STARTED":
    case "RETREATED":
    case "POKEMON_SWITCHED":
    case "TURN_ENDED":
    case "GAME_OVER":
      return formatGameFlowEvent(event, fmt);
    case "ATTACK_DECLARED":
    case "ATTACK_COPY_RESOLVED":
    case "ATTACK_EFFECT_SKIPPED":
    case "DAMAGE_DEALT":
    case "COUNTERS_PLACED":
    case "ATTACK_FAILED":
    case "HEALED":
      return formatAttackEvent(event, fmt);
    case "STATUS_APPLIED":
    case "STATUS_PREVENTED":
    case "STATUS_CLEARED":
      return formatStatusEvent(event, fmt);
    case "RETREAT_BLOCKED":
    case "RETREAT_BLOCK_ENDED":
    case "HAND_PLAY_BLOCKED":
    case "ATTACK_BLOCK_APPLIED":
    case "ATTACK_LOCKED":
    case "DAMAGE_REDUCTION_APPLIED":
    case "WEAKNESS_REMOVED":
    case "ATTACK_DEBUFF_APPLIED":
    case "DAMAGE_VULNERABILITY_APPLIED":
    case "WEAKNESS_RETYPED":
    case "COST_TAX_APPLIED":
    case "KO_BOUNTY_APPLIED":
    case "SIDE_ATTACKS_LOCKED":
    case "SIDE_ATTACKS_BOOSTED":
    case "SIDE_ATTACK_BLOCK_APPLIED":
    case "SIDE_ATTACK_BLOCK_ENDED":
    case "HAND_ATTACH_MARKED":
    case "PRIZE_LOOKED_AT":
    case "CHOSEN_ATTACK_SHIELD_INSTALLED":
    case "SIDE_RETREAT_LOCKED":
    case "SIDE_DAMAGE_REDUCTION_INSTALLED":
    case "HAND_DISCARD_SCHEDULED":
    case "ATTACK_AGAIN_OFFERED":
    case "EFFECT_SCHEDULED":
    case "RECOIL_ARMED":
    case "ATTACK_BOOSTED":
    case "ATTACK_EFFECT_PREVENTED":
    case "TRAINER_EFFECT_PREVENTED":
    case "ABILITY_EFFECT_PREVENTED":
      return formatInstalledEffectEvent(event, fmt);
    case "CHECKUP_COIN_FLIP":
    case "CONFUSION_CHECK":
    case "TRAINER_FLIP_LOCKED":
    case "TRAINER_FLIP_LOCK_CHECK":
    case "COINS_REFLIPPED":
    case "ATTACK_FLIP_LOCK_CHECK":
    case "ATTACK_EFFECT_COIN_FLIP":
    case "ABILITY_COIN_FLIP":
      return formatCoinEvent(event, fmt);
    case "KNOCKED_OUT":
    case "POKEMON_RETURNED":
    case "POKEMON_SWAPPED_FROM_DECK":
    case "POKEMON_SWAPPED_FROM_DISCARD":
    case "PRIZES_OWED":
    case "PRIZES_TAKEN":
    case "PRIZE_TURNED_FACE_UP":
    case "PRIZES_CYCLED":
    case "PRIZE_SWITCHED_WITH_HAND":
    case "PROMOTION_REQUIRED":
    case "POKEMON_PROMOTED":
    case "PRIZE_REDUCED":
    case "PRIZE_BONUS":
    case "PRIZE_PREVENTED":
      return formatKnockOutEvent(event, fmt);
    case "TRAINER_PLAYED":
    case "TOOL_ATTACHED":
    case "TOOLS_DISCARDED":
    case "STADIUM_DISCARDED":
    case "POKEMON_NAMED":
    case "SUPPORTER_EFFECT_USED":
    case "HP_GUESSED":
    case "BENCH_TRIMMED":
    case "ABILITY_USED":
    case "STADIUM_ABILITY_ACTIVATED":
    case "ABILITY_TRIGGERED":
      return formatTrainerAbilityEvent(event, fmt);
    case "HAND_COST_PAID":
    case "HAND_DISCARDED":
    case "FORCED_HAND_DISCARD":
    case "HAND_SHUFFLED_INTO_DECK":
    case "HAND_TO_BOTTOM_OF_DECK":
    case "HAND_REVEALED":
    case "HAND_CARDS_REVEALED":
    case "CARD_TO_BOTTOM_OF_DECK":
    case "HAND_CARD_SHUFFLED_INTO_DECK":
    case "CARD_DISCARDED_FROM_HAND":
    case "RANDOM_CARD_REVEALED":
    case "RANDOM_CARD_TAKEN":
      return formatHandEvent(event, fmt);
    case "DECK_SEARCHED":
    case "DISCARD_RETRIEVED":
    case "DECK_TOP_REVEALED":
    case "DECK_TOP_DISCARDED":
    case "DECK_BOTTOM_DISCARDED":
    case "DECK_TOP_REORDERED":
    case "DECK_TOP_TO_BOTTOM":
      return formatDeckEvent(event, fmt);
    case "ENERGY_ATTACHED":
    case "ENERGY_MOVED":
    case "ENERGY_DISCARDED":
      return formatEnergyEvent(event, fmt);
    case "EFFECT_PENDING":
      return null;
    default:
      // Fails to compile when an event type has no case; an unknown runtime event logs nothing.
      event satisfies never;
      return null;
  }
}

/** Setup, turn structure, play to the board and the game result. */
function formatGameFlowEvent(
  event: EventOf<
    | "SHUFFLE"
    | "COIN_FLIP"
    | "FIRST_PLAYER_CHOSEN"
    | "CARDS_DRAWN"
    | "MULLIGAN_REVEALED"
    | "POKEMON_PLACED"
    | "POKEMON_BENCHED"
    | "POKEMON_EVOLVED"
    | "POKEMON_DEVOLVED"
    | "COMPENSATION_DECIDED"
    | "PRIZES_SET"
    | "SETUP_READY"
    | "SETUP_REVEALED"
    | "TURN_STARTED"
    | "RETREATED"
    | "POKEMON_SWITCHED"
    | "TURN_ENDED"
    | "GAME_OVER"
  >,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { names, state, row } = fmt;
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
      // `actor` present is a cross-seat put (Mandibuzz "Look for Prey"): filed under the actor with
      // the owner named outright, since a possessive would print identically from both seats.
      return event.actor === undefined
        ? row(event.seat, [plain("benched "), strong(cardName(state, event.uid))])
        : row(event.actor, [
            plain("put "),
            strong(cardName(state, event.uid)),
            plain(` onto ${names[event.seat]}'s Bench`),
          ]);
    case "POKEMON_EVOLVED":
      // `from` is still resolvable — it stays at the bottom of the evolved
      // stack; `to` is the new top card.
      return row(event.seat, [
        plain("evolved "),
        strong(cardName(state, event.from)),
        plain(" → "),
        strong(cardName(state, event.to)),
      ]);
    // Filed under `event.actor`, which is carried rather than derived from `seat`. An absent `zone`
    // means the deck; the hand is named because no SHUFFLE row accompanies it.
    case "POKEMON_DEVOLVED":
      return row(event.actor, [
        plain("devolved "),
        strong(`${names[event.seat]}'s ${cardName(state, event.from)}`),
        plain(" → "),
        strong(cardName(state, event.to)),
        ...(event.zone === "hand" ? [plain(` — to ${names[event.seat]}'s hand`)] : []),
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
    case "POKEMON_SWITCHED":
      // Passive voice — the causing card already logged its own row (Switch /
      // Boss's Orders a TRAINER_PLAYED, Jet Energy an ENERGY_ATTACHED); `seat`
      // owns the board that changed.
      return row(event.seat, [
        strong(cardName(state, event.nowActive)),
        plain(" was switched to the Active spot"),
      ]);
    case "TURN_ENDED":
      return row(event.seat, [plain("ended their turn")]);
    case "GAME_OVER": {
      const outcome = event.outcome;
      if (outcome.result === "win") {
        const reason = GAME_OVER_REASONS[outcome.reason];
        return row("system", [strong(names[outcome.winner]), plain(` wins — ${reason}`)]);
      }
      return row("system", [strong("The game ends in a tie")]);
    }
  }
}

/** Declaring and resolving an attack: damage, counters, failure and healing. */
function formatAttackEvent(
  event: EventOf<
    | "ATTACK_DECLARED"
    | "ATTACK_COPY_RESOLVED"
    | "ATTACK_EFFECT_SKIPPED"
    | "DAMAGE_DEALT"
    | "COUNTERS_PLACED"
    | "ATTACK_FAILED"
    | "HEALED"
  >,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { state, row } = fmt;
  switch (event.type) {
    case "ATTACK_DECLARED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" used "),
        strong(event.attack),
        // A copy-attack names what it became: "used Foul Play (as Cruel Slash)".
        ...(event.as === undefined ? [] : [plain(" (as "), strong(event.as), plain(")")]),
      ]);
    case "ATTACK_COPY_RESOLVED":
      // Haughty Order / Seek Inspiration: the ATTACK_DECLARED row above already said "used".
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain("'s "),
        strong(event.attack),
        plain(" became "),
        strong(event.as),
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
      // The event's seat owns the damaged body; the dealer is `by`, which can be the same seat (an
      // own-side bench spread).
      const segments: LogSegment[] = [
        plain("dealt "),
        { text: String(event.dealt), tone: "damage" },
        plain(" damage to "),
        strong(cardName(state, event.uid)),
      ];
      // The breadcrumbs read in §8.5 PIPELINE order so the math reconstructs:
      // the attack's own printed scaling clause (Paldean Tauros "Raging Horns")
      // and then the attacker's continuous pre-W/R bonus (Vitality Band) FIRST —
      // both land at the same pre-W/R step, the scaling ahead of the continuous
      // boost — then Weakness, Resistance, then the defender's post-W/R reduction
      // (Bouffalant "Bouffer" / a defending Tool) last.
      if (event.scaled !== undefined) segments.push(plain(` · scaled +${event.scaled}`));
      if (event.bonus !== undefined) segments.push(plain(` · boosted +${event.bonus}`));
      // The attack-installed debuff or the attack's own penalty, applied before Weakness, in its
      // own crumb. It names the fact (damage reduced before Weakness), not the source, since the
      // row is filed under the defender and rendered under the attacker.
      if (event.debuff !== undefined) segments.push(plain(` · weakened −${event.debuff}`));
      if (event.weakness !== null) segments.push(plain(modifierText("weakness", event.weakness)));
      if (event.resistance !== null) {
        segments.push(plain(modifierText("resistance", event.resistance)));
      }
      if (event.reduction !== undefined) segments.push(plain(` · reduced ${event.reduction}`));
      // The installed next-turn vulnerability, at the post-W/R step, in its own crumb and sign.
      if (event.vulnerability !== undefined) {
        segments.push(plain(` · exposed +${event.vulnerability}`));
      }
      // Full prevention is the last §8.5 step and supersedes the reduction, so "· reduced 20 ·
      // prevented" reflects the pipeline. It names the fact, not the source, since several rules
      // set the flag and the dealer and damaged owner may differ.
      if (event.prevented === true) segments.push(plain(" · prevented"));
      // Rendered after `prevented`: the survival clamp runs on the finished amount, and the two are
      // mutually exclusive. It names the fact ("survived the Knock Out"), not the Ability, and
      // quotes no HP number since the event lacks the max HP.
      if (event.survived === true) segments.push(plain(" · survived the Knock Out"));
      return row(event.by, segments);
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
        case "ability":
          // Damage counters an Ability placed — a between-turns/on-play trigger
          // (Trevenant's Forest Miasma, the snipe) OR a during-turn self-attach
          // (Gardevoir's Psychic Embrace, +2 on the attached-to Pokémon). Always
          // a system row; the ABILITY_TRIGGERED/ABILITY_USED row just before
          // names the source.
          return row("system", [plain("Ability: "), amount, plain(" damage to "), strong(name)]);
        case "self":
          // An attack's own recoil ("This Pokémon also does N damage to itself" —
          // Skeledirge "Blazing Shout"). The attacker CHOSE this attack, so unlike
          // the confusion self-hit it reads in the attacker's own voice (its seat)
          // rather than as a system row; it echoes the printed sentence.
          return row(seat, [strong(name), plain(" did "), amount, plain(" damage to itself")]);
        case "moved":
          // The destination half of a counter move (Dedenne ex "Tail Swap"). System voice because
          // `seat` owns the damaged Pokémon, not the actor.
          return row("system", [plain("Moved: "), amount, plain(" damage onto "), strong(name)]);
        case "attack":
          // An attack's printed "Put {N} damage counters on …"; system voice because `seat` owns
          // the damaged Pokémon. The actor is named by the ATTACK_DECLARED row above.
          return row("system", [plain("Put: "), amount, plain(" damage onto "), strong(name)]);
        case "counterattack":
          // Reactive recoil (§9) on the attacking Pokémon, in system voice. The label names the
          // mechanism because the amount can sum an Ability and Tools; it is not "Recoil", which
          // means self-damage. No other row announces it.
          return row("system", [
            plain("Counterattack: "),
            amount,
            plain(" damage to "),
            strong(name),
          ]);
        // Counters an attack scheduled a turn ago, placed at Checkup (§13); system voice, labelled
        // to match the EFFECT_SCHEDULED row.
        case "delayed":
          return row("system", [plain("Delayed: "), amount, plain(" damage to "), strong(name)]);
        // Counters placed by an Item (Team Rocket's Venture Bomb); system voice, since on heads
        // `seat` is the opponent and on tails self-damage wording would be wrong.
        case "trainer":
          return row("system", [plain("Trainer: "), amount, plain(" damage to "), strong(name)]);
        default:
          return row(seat, [amount, plain(" damage to "), strong(name)]);
      }
    }
    case "ATTACK_FAILED":
      // "confusion" is §12's tails (self-damage follows as its own row). "requirement" is "this
      // attack does nothing" with its clause held, and "coinFlip" follows its own coin row, so it
      // states only the consequence. "preDamage" names the act because the attack failed for
      // finding nothing to discard.
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          event.reason === "confusion"
            ? "'s attack failed — Confused"
            : event.reason === "coinFlip"
              ? "'s attack did nothing — the coin flip missed"
              : event.reason === "preDamage"
                ? "'s attack did nothing — it had no Pokémon Tool to discard"
                : // "flipLock" needs an explicit arm: the default would claim a condition the printed sentence lacks.
                  event.reason === "flipLock"
                  ? "'s attack didn't happen — the flip lock's coin was tails"
                  : "'s attack did nothing — its condition was not met",
        ),
      ]);
    case "HEALED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(` healed ${event.amount} damage`),
      ]);
  }
}

/** §12 Special Conditions. */
function formatStatusEvent(
  event: EventOf<"STATUS_APPLIED" | "STATUS_PREVENTED" | "STATUS_CLEARED">,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { state, row } = fmt;
  switch (event.type) {
    // Card names resolve off the event's own uid, so a status on a Pokémon the same batch then
    // Knocks Out still names it. A §13 Checkup batch can hold recovery events that precede a
    // KNOCKED_OUT for the same uid, so animations key off the post-batch state.
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
      // A raised Confusion amount is spelled out when inflicted, as a warning before the flip.
      if (event.confusionDamage !== undefined && event.confusionDamage > DEFAULT_CONFUSION_DAMAGE) {
        segments.push(plain(` (${event.confusionDamage} damage on a missed flip)`));
      }
      return row(event.seat, segments);
    }
    case "STATUS_PREVENTED":
      // The printed sentence with the subject resolved ("Dachsbun can't be Burned"). Filed under
      // the seat that owns the refusing Pokémon.
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" can't be "),
        strong(STATUS_LABELS[event.status]),
      ]);
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
        case "recovered":
          // "benched" follows the RETREATED row; benching clears every condition at once (§11/§12).
          // "recovered" (Therapeutic Energy) shares the sentence and lists only the conditions the
          // effect names.
          return row(seat, [strong(name), plain(" recovered from "), strong(statuses)]);
        case "evolved":
          // Follows the POKEMON_EVOLVED row; evolving clears every condition
          // at once (§10). `name` is the new top card.
          return row(seat, [
            strong(name),
            plain(" shed "),
            strong(statuses),
            plain(" on evolving"),
          ]);
        case "devolved":
          // Follows POKEMON_DEVOLVED; devolving clears every condition too (§12), and `name` is the
          // new top card.
          return row(seat, [
            strong(name),
            plain(" shed "),
            strong(statuses),
            plain(" on devolving"),
          ]);
        default:
          return row(seat, [strong(name), plain(" recovered from "), strong(statuses)]);
      }
    }
  }
}

/** Effects installed on a body or a side for later turns, and their refusals. */
function formatInstalledEffectEvent(
  event: EventOf<
    | "RETREAT_BLOCKED"
    | "RETREAT_BLOCK_ENDED"
    | "HAND_PLAY_BLOCKED"
    | "ATTACK_BLOCK_APPLIED"
    | "ATTACK_LOCKED"
    | "DAMAGE_REDUCTION_APPLIED"
    | "WEAKNESS_REMOVED"
    | "ATTACK_DEBUFF_APPLIED"
    | "DAMAGE_VULNERABILITY_APPLIED"
    | "WEAKNESS_RETYPED"
    | "COST_TAX_APPLIED"
    | "KO_BOUNTY_APPLIED"
    | "SIDE_ATTACKS_LOCKED"
    | "SIDE_ATTACKS_BOOSTED"
    | "SIDE_ATTACK_BLOCK_APPLIED"
    | "SIDE_ATTACK_BLOCK_ENDED"
    | "HAND_ATTACH_MARKED"
    | "PRIZE_LOOKED_AT"
    | "CHOSEN_ATTACK_SHIELD_INSTALLED"
    | "SIDE_RETREAT_LOCKED"
    | "SIDE_DAMAGE_REDUCTION_INSTALLED"
    | "HAND_DISCARD_SCHEDULED"
    | "ATTACK_AGAIN_OFFERED"
    | "EFFECT_SCHEDULED"
    | "RECOIL_ARMED"
    | "ATTACK_BOOSTED"
    | "ATTACK_EFFECT_PREVENTED"
    | "TRAINER_EFFECT_PREVENTED"
    | "ABILITY_EFFECT_PREVENTED"
  >,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { names, state, row } = fmt;
  switch (event.type) {
    // §11 — the retreat block. Its own rows, not STATUS_* ones: it is not a
    // Special Condition, so the "is now …"/"recovered from …" phrasings (which
    // name a §12 status) would read wrong.
    case "RETREAT_BLOCKED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" can't retreat next turn"),
      ]);
    case "RETREAT_BLOCK_ENDED":
      return row(event.seat, [strong(cardName(state, event.uid)), plain(" can retreat again")]);
    // The imposed hand-play bar (§7.1/§7.2): victim-side seat, no card name. The payload is a card
    // class on most printings and an act (`"evolve"`) on Bronzong's, so the noun is chosen here.
    case "HAND_PLAY_BLOCKED":
      return row(event.seat, [
        plain("can't play "),
        strong(event.bars === "evolve" ? "Pokémon to evolve" : `${event.bars} cards`),
        plain(" next turn"),
      ]);
    // The attack-installed damage block (§11), active voice. The class filter is named because
    // evolved attackers get through. The damage cap is a trailing clause because it is independent
    // of the other fields, echoing the printed "if that damage is 40 or less".
    case "ATTACK_BLOCK_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          (event.fromClass !== undefined
            ? ` is protected from damage from ${attackerClassAttacks(event.fromClass)} during your opponent's next turn`
            : event.effects
              ? " is protected from damage and effects of attacks during your opponent's next turn"
              : " is protected from damage from attacks during your opponent's next turn") +
            (event.maxDamage === undefined ? "" : `, if that damage is ${event.maxDamage} or less`),
        ),
      ]);
    // The attack-installed lock (§8/§11), phrased from the locked Pokémon's side. "next turn" is
    // that Pokémon's own next turn under either seat. Branches: a coin-flip lock (checked first,
    // since it writes neither `attack` nor `until`), a named-attack lock ("can't use {Name}"), and
    // an until-leaves-Active lock, each because the bare wording would be false.
    case "ATTACK_LOCKED":
      // Jet of Ink's two coins get their own row.
      if (event.flip === true && event.coins === 2) {
        return row(event.seat, [
          strong(cardName(state, event.uid)),
          plain(
            " must flip 2 coins to attack next turn — if either is tails, the attack doesn't happen",
          ),
        ]);
      }
      if (event.flip === true) {
        return row(event.seat, [
          strong(cardName(state, event.uid)),
          plain(" must flip a coin to attack next turn — tails, the attack doesn't happen"),
        ]);
      }
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          event.attack === undefined
            ? " can't attack next turn"
            : event.until === "leavesActive"
              ? ` can't use ${event.attack} again until it leaves the Active Spot`
              : ` can't use ${event.attack} next turn`,
        ),
      ]);
    // The attack-installed damage reduction (§8.5/§11), active voice; the number is in the wording
    // because the next turn's DAMAGE_DEALT row reports the same figure.
    case "DAMAGE_REDUCTION_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        // Metal Block's class.
        plain(
          ` takes ${event.amount} less damage from attacks${event.fromClass === undefined ? "" : ` from ${attackerClassNoun(event.fromClass)}`} during your opponent's next turn`,
        ),
      ]);
    // The attack-installed no-Weakness bar (§8.5/§11), actor voice, so the printed "during your
    // opponent's next turn" is correct here.
    case "WEAKNESS_REMOVED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" has no Weakness during your opponent's next turn"),
      ]);
    // The attack-installed damage debuff (§8.5/§11), always victim-voiced, so it says "next turn"
    // (the victim's own) rather than the printed "your opponent's next turn".
    case "ATTACK_DEBUFF_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(`'s attacks do ${event.amount} less damage next turn`),
      ]);
    // The next-turn vulnerability (§8.5/§11), victim-voiced. The window is the installer's next
    // turn, so it says "your opponent's next turn".
    case "DAMAGE_VULNERABILITY_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(` takes ${event.amount} more damage from attacks during your opponent's next turn`),
      ]);
    // The attack-installed Weakness retype (§8.5/§11), victim-voiced, so "your opponent's next
    // turn". The type is spelled as a word.
    case "WEAKNESS_RETYPED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          `'s Weakness is now ${event.weaknessType} until the end of your opponent's next turn (${
            // Overwriting Bolt's reminder.
            event.asTimesTwo === true ? "apply Weakness as ×2" : "the amount doesn't change"
          })`,
        ),
      ]);
    // The attack-installed cost tax (§8.2/§11), victim-voiced; "next turn" is correct because the
    // window is the holder's own next turn. It names both attack and retreat costs, as printed.
    case "COST_TAX_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        // No brace code reaches the player.
        plain("'s attacks and Retreat Cost each need 1 more Colorless Energy next turn"),
      ]);
    // The attack-installed Knock Out bounty (§8.1/§11), victim-voiced, so "your opponent's next
    // turn".
    case "KO_BOUNTY_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          ` — if it is Knocked Out during your opponent's next turn, your opponent takes ${event.amount} more Prize card${event.amount === 1 ? "" : "s"}`,
        ),
      ]);
    // The attack-installed side-wide lock (§8/§11): `seat` owns the locked side and no body is
    // named. The reminder is rendered because promoting or benching a fresh body does not escape
    // it.
    case "SIDE_ATTACKS_LOCKED":
      return row(event.seat, [
        plain(
          event.maxEnergy === null
            ? "Pokémon can't attack next turn"
            : `Pokémon with ${event.maxEnergy} or less Energy attached can't attack next turn`,
        ),
        plain(" — including Pokémon that come into play"),
      ]);
    // The Trainer-installed this-turn side-wide bonus (§8.5, Black Belt's Training), installer
    // voice. It applies to the side, including later-promoted Pokémon, and is wiped at the next
    // `startTurn`. The defender noun comes from `retrieveNoun`; an attacker noun names the
    // attackers.
    case "SIDE_ATTACKS_BOOSTED":
      return row(event.seat, [
        ...(event.attacker === undefined
          ? [plain(`Pokémon's attacks do ${event.amount} more damage to the opponent's Active `)]
          : [
              plain("attacks by "),
              strong(retrieveNoun(event.attacker).plural),
              plain(` do ${event.amount} more damage to the opponent's Active `),
            ]),
        strong(retrieveNoun(event.target).plural),
        plain(" this turn (before Weakness and Resistance)"),
      ]);
    // The next-turn side-wide reduction (§8.5, Jasmine's Gaze), installer voice; "next turn" is the
    // opponent's. Miraidon "C.O.D.E.: Protect"'s side-wide block (§11) is filed the same way and
    // names the terminator so the opponent knows a gust ends it.
    case "SIDE_ATTACK_BLOCK_APPLIED":
      return row(event.seat, [
        plain(
          `${event.banner} Pokémon are protected from damage from ${attackerClassAttacks(event.fromClass)} during the opponent's next turn, while `,
        ),
        strong(cardName(state, event.uid)),
        plain(" stays in the Active Spot"),
      ]);
    case "SIDE_ATTACK_BLOCK_ENDED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" left the Active Spot — its protection ended"),
      ]);
    // The hand-attach mark (§6.2/§11), filed under the marked Pokémon's owner, victim-voiced; each
    // printed consequence is named.
    case "HAND_ATTACH_MARKED": {
      const parts = [
        ...(event.barred ? ["can't have Energy cards attached from hand"] : []),
        ...(event.endsTurn
          ? ["ends its owner's turn if an Energy card is attached to it from hand"]
          : []),
        // Electrified Incisors.
        ...(event.counters > 0
          ? [
              `takes ${event.counters} damage counters for each Energy card attached to it from hand`,
            ]
          : []),
      ];
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(` ${parts.join(" and ")} during its owner's next turn`),
      ]);
    }
    // Blipbug "Searching Eyes": slot only, because the log is broadcast to both seats. Filed under
    // the actor with the owner named.
    case "PRIZE_LOOKED_AT":
      return row(event.actor, [
        plain(`looked at ${names[event.seat]}'s face-down Prize ${event.index + 1}`),
      ]);
    // Acerola's Mischief (§11).
    case "CHOSEN_ATTACK_SHIELD_INSTALLED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          ` is protected from damage and effects of attacks by ${attackerClassNoun(event.fromClass)} during the opponent's next turn`,
        ),
      ]);
    // Roxie's Performance (§11), filed under the locked side, victim-voiced.
    case "SIDE_RETREAT_LOCKED":
      return row(event.seat, [
        plain(
          "Poisoned Pokémon can't retreat during their next turn, including newly Poisoned Pokémon",
        ),
      ]);
    case "SIDE_DAMAGE_REDUCTION_INSTALLED":
      return row(event.seat, [
        plain(
          // Iron Defender's holder type leads the row.
          `${event.pokemonType === undefined ? "" : `${event.pokemonType} `}Pokémon take ${event.amount} less damage from attacks during the opponent's next turn (after Weakness and Resistance), including Pokémon that come into play`,
        ),
      ]);
    // Amarys's scheduled end-of-turn discard (§5.3); the discard itself files a HAND_DISCARDED row.
    case "HAND_DISCARD_SCHEDULED":
      return row(event.seat, [
        plain(
          `will discard their hand at the end of this turn if it holds ${event.atLeast} or more cards`,
        ),
      ]);
    // Festival Lead's attack-again window (§5.3/§8); the Ability is named so the row explains why
    // the turn did not end.
    case "ATTACK_AGAIN_OFFERED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" may attack again (Festival Lead)"),
      ]);
    // A scheduled counter placement on the defending Pokémon (§13), filed under the victim, so "at
    // the end of your next turn". The unit is HP to match the eventual COUNTERS_PLACED row. It says
    // "scheduled" because §10 sheds the schedule if the body retreats, is switched or evolves.
    // Discard and Knock Out payloads must read differently since only a Knock Out yields a Prize
    // (§8.1).
    case "EFFECT_SCHEDULED": {
      const scheduled = event.scheduled;
      switch (scheduled.kind) {
        case "counters":
          return row(event.seat, [
            strong(cardName(state, event.uid)),
            plain(` has ${scheduled.amount} damage scheduled for the end of your next turn`),
          ]);
        case "discard":
          return row(event.seat, [
            strong(cardName(state, event.uid)),
            plain(" is scheduled to be discarded at the end of your next turn"),
          ]);
        case "knockOut":
          return row(event.seat, [
            strong(cardName(state, event.uid)),
            plain(" is scheduled to be "),
            { text: "Knocked Out", tone: "damage" },
            plain(" at the end of your next turn"),
          ]);
      }
      break;
    }
    // The attack-armed reactive recoil (§9/§11), active voice, so the printed "during your
    // opponent's next turn" is correct. The unit is damage, not counters, to match the
    // COUNTERS_PLACED row it produces. When the amount equals damage taken, the row names the rule
    // instead of a figure.
    case "RECOIL_ARMED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          event.ofDamageTaken === true
            ? ` will counterattack for the damage it takes${
                event.amount > 0 ? ` (at least ${event.amount})` : ""
              } during your opponent's next turn`
            : ` will counterattack for ${event.amount} damage during your opponent's next turn`,
        ),
      ]);
    // The attack-installed per-attack damage buff (§8.5/§11), active voice. It names the attack,
    // since a bare row would promise the bonus on every attack. Base-set mode reads "'s base damage
    // is N", the all-attacks mode names no attack, and a this-turn install says "this turn".
    case "ATTACK_BOOSTED":
      if (event.thisTurn === true) {
        return row(event.seat, [
          strong(cardName(state, event.uid)),
          plain(
            event.attack === null
              ? `'s attacks do ${event.amount} more damage this turn`
              : `'s ${event.attack} does ${event.amount} more damage this turn`,
          ),
        ]);
      }
      if (event.attack === null) {
        return row(event.seat, [
          strong(cardName(state, event.uid)),
          plain(`'s attacks do ${event.amount} more damage next turn`),
        ]);
      }
      if (event.base === true) {
        return row(event.seat, [
          strong(cardName(state, event.uid)),
          plain(`'s ${event.attack}'s base damage is ${event.amount} next turn`),
        ]);
      }
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(`'s ${event.attack} does ${event.amount} more damage next turn`),
      ]);
    case "ATTACK_EFFECT_PREVENTED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" prevented the effect of the attack"),
      ]);
    // The noun says which kind of card was blocked (Rhyperior refuses Supporters but not Items).
    case "TRAINER_EFFECT_PREVENTED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          ` prevented the effect of the ${event.trainerType === "item" ? "Item" : "Supporter"}`,
        ),
      ]);
    case "ABILITY_EFFECT_PREVENTED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" prevented the effect of the Ability"),
      ]);
  }
}

/** Coin flips outside an attack's own printed flip. */
function formatCoinEvent(
  event: EventOf<
    | "CHECKUP_COIN_FLIP"
    | "CONFUSION_CHECK"
    | "TRAINER_FLIP_LOCKED"
    | "TRAINER_FLIP_LOCK_CHECK"
    | "COINS_REFLIPPED"
    | "ATTACK_FLIP_LOCK_CHECK"
    | "ATTACK_EFFECT_COIN_FLIP"
    | "ABILITY_COIN_FLIP"
  >,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { names, state, row } = fmt;
  switch (event.type) {
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
    // The flip-to-attack lock's coin, in the declaring seat's voice; the consequence is left to the
    // ATTACK_FAILED row after tails. Seismitoad "Quaking Fist" flips at each Trainer play.
    case "TRAINER_FLIP_LOCKED":
      return row(event.seat, [
        plain("must flip a coin to use each Trainer card from hand next turn"),
      ]);
    case "TRAINER_FLIP_LOCK_CHECK":
      return row(event.seat, [
        plain("flipped for "),
        strong(cardName(state, event.uid)),
        plain(" — "),
        strong(event.result),
        plain(event.result === "tails" ? ": it is discarded instead of used" : ""),
      ]);
    // Backtrack Badge: the attack's coins are ignored and flipped again; the new faces get their
    // own rows.
    case "COINS_REFLIPPED":
      return row(event.seat, [
        plain("used "),
        strong(cardName(state, event.uid)),
        plain(
          ` — ignored ${event.count === 1 ? "the coin flip" : `${String(event.count)} coin flips`} and flipped again`,
        ),
      ]);
    case "ATTACK_FLIP_LOCK_CHECK":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" is under a flip lock — flip: "),
        strong(event.result),
      ]);
    case "ATTACK_EFFECT_COIN_FLIP":
      // A coinFlipGate flip, from an attack or a Trainer. `seat` is the seat that flipped: usually
      // the actor, but `opponentPerTails` files under the opponent. The copy stays neutral despite
      // the "ATTACK_" event id.
      return row(event.seat, [plain("flipped "), strong(event.result), plain(" for the effect")]);
    case "ABILITY_COIN_FLIP":
      // §9 — a triggered Ability's own coin flip (Glimmora "Shattering Crystal"
      // on Knock Out). Follows its ABILITY_TRIGGERED row.
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" flipped "),
        strong(event.result),
        plain(` for ${event.ability}`),
      ]);
  }
}

/** §8.1 Knock Outs, Prizes and promotion. */
function formatKnockOutEvent(
  event: EventOf<
    | "KNOCKED_OUT"
    | "POKEMON_RETURNED"
    | "POKEMON_SWAPPED_FROM_DECK"
    | "POKEMON_SWAPPED_FROM_DISCARD"
    | "PRIZES_OWED"
    | "PRIZES_TAKEN"
    | "PRIZE_TURNED_FACE_UP"
    | "PRIZES_CYCLED"
    | "PRIZE_SWITCHED_WITH_HAND"
    | "PROMOTION_REQUIRED"
    | "POKEMON_PROMOTED"
    | "PRIZE_REDUCED"
    | "PRIZE_BONUS"
    | "PRIZE_PREVENTED"
  >,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { names, state, row } = fmt;
  switch (event.type) {
    case "KNOCKED_OUT":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" was "),
        { text: "Knocked Out", tone: "damage" },
        // Cards a Knock Out sent to the hand instead of the discard pile, counted by what moved
        // (`koToHandTail`).
        ...(event.toHand === undefined ? [] : [plain(koToHandTail(state, event.toHand))]),
      ]);
    case "POKEMON_RETURNED": {
      // A benched body left play without being Knocked Out, attributed to the actor. Names the
      // Pokémon and counts the rest. The verb follows the zone ("shuffled" into a deck, "put" into
      // a hand, discard pile, or on top of the deck). The split row counts only the discarded
      // attachments, since the evolution stack may go to the hand.
      const zone = event.dest === "discard" ? "discard pile" : event.dest;
      const verb = event.dest === "deck" ? "shuffled " : "put ";
      const into = event.dest === "deckTop" ? " on top of " : " into ";
      const place = zone === "deckTop" ? "deck" : zone;
      const split = event.attachmentsTo;
      if (split !== undefined) {
        const n = split.uids.length;
        return row(event.actor, [
          plain(verb),
          strong(cardName(state, event.uid)),
          plain(`${into}${names[event.seat]}'s ${place}`),
          plain(n > 0 ? ` and discarded ${n} attached card${n === 1 ? "" : "s"}` : ""),
        ]);
      }
      const extra = event.uids.length - 1;
      return row(event.actor, [
        plain(verb),
        strong(cardName(state, event.uid)),
        plain(extra > 0 ? ` and ${extra} attached card${extra === 1 ? "" : "s"}` : ""),
        plain(`${into}${names[event.seat]}'s ${place}`),
      ]);
    }
    case "POKEMON_SWAPPED_FROM_DECK":
      // Zero to Hero's swap: both cards are named, and the SHUFFLE row that follows says the rest.
      return row(event.seat, [
        plain("switched "),
        strong(cardName(state, event.fromUid)),
        plain(" with "),
        strong(cardName(state, event.toUid)),
        plain(" from their deck"),
      ]);
    case "POKEMON_SWAPPED_FROM_DISCARD": {
      // Ogre's Mask's swap: both cards are public, and the old one goes to the discard pile.
      const incoming = cardName(state, event.toUid);
      return row(event.seat, [
        plain("switched "),
        strong(cardName(state, event.fromUid)),
        plain(" with "),
        strong(incoming),
        plain(" from their discard pile"),
      ]);
    }
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
    case "PRIZE_TURNED_FACE_UP":
      // A face-up prize is public, so it is named. A prize turned by the opponent (Bother-Bot) is
      // filed under the actor with the owner named.
      if (event.actor !== undefined) {
        return row(event.actor, [
          plain(`turned ${names[event.seat]}'s `),
          strong(cardName(state, event.uid)),
          plain(` face up (Prize ${event.index + 1})`),
        ]);
      }
      return row(event.seat, [
        plain("turned "),
        strong(cardName(state, event.uid)),
        plain(` face up (Prize ${event.index + 1})`),
      ]);
    case "PRIZES_CYCLED": {
      // Redeemable Ticket: count only, every card is hidden.
      const n = event.count;
      return row(event.seat, [
        plain(
          `put ${n} Prize card${n === 1 ? "" : "s"} on the bottom of their deck and took ${n} new ones`,
        ),
      ]);
    }
    case "PRIZE_SWITCHED_WITH_HAND":
      // Bother-Bot's switch: both cards are public, so both are named; filed under the actor, owner
      // named.
      return row(event.actor, [
        plain(`had ${names[event.seat]} switch `),
        strong(cardName(state, event.handUid)),
        plain(" with the face-up Prize "),
        strong(cardName(state, event.prizeUid)),
      ]);
    case "PROMOTION_REQUIRED":
      return row(event.seat, [plain("must promote a benched Pokémon")]);
    case "POKEMON_PROMOTED":
      return row(event.seat, [
        plain("promoted "),
        strong(cardName(state, event.uid)),
        plain(" to Active"),
      ]);
    case "PRIZE_REDUCED":
      // An on-KO Ability (Munkidori ex) reduced the Prize (§8.1). System voice, since `seat` owns
      // the dying Pokémon but the opponent takes fewer. Both numbers are stated so the change is
      // readable.
      return row("system", [
        strong(cardName(state, event.uid)),
        plain(
          ` — your opponent takes ${event.by} fewer Prize card${event.by === 1 ? "" : "s"} for it (${event.count} instead of ${event.count + event.by})`,
        ),
      ]);
    case "PRIZE_BONUS":
      // An effect on the killing side added Prize cards for this Knock Out (§8.1). System voice for
      // the same reason as above; both numbers are stated.
      return row("system", [
        strong(cardName(state, event.uid)),
        plain(
          ` — your opponent takes ${event.by} more Prize card${event.by === 1 ? "" : "s"} for it (${event.count} instead of ${event.count - event.by})`,
        ),
      ]);
    case "PRIZE_PREVENTED":
      // §8.1 — an on-KO Ability (Glimmora heads) denied the opponent the Prize
      // for the Knocked Out Pokémon; a system row, the flip above named it.
      return row("system", [
        strong(cardName(state, event.uid)),
        plain(" — no Prize card is taken for it"),
      ]);
  }
}

/** Trainer cards, Tools, Stadiums and Abilities. */
function formatTrainerAbilityEvent(
  event: EventOf<
    | "TRAINER_PLAYED"
    | "TOOL_ATTACHED"
    | "TOOLS_DISCARDED"
    | "STADIUM_DISCARDED"
    | "POKEMON_NAMED"
    | "SUPPORTER_EFFECT_USED"
    | "HP_GUESSED"
    | "BENCH_TRIMMED"
    | "ABILITY_USED"
    | "STADIUM_ABILITY_ACTIVATED"
    | "ABILITY_TRIGGERED"
  >,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { names, state, row } = fmt;
  switch (event.type) {
    case "TRAINER_PLAYED":
      return row(event.seat, [plain("played "), strong(cardName(state, event.uid))]);
    case "TOOL_ATTACHED":
      // The energy-attach row's shape — a Tool attaches the same way (§7.4).
      return row(event.seat, [
        plain("attached "),
        strong(cardName(state, event.uid)),
        plain(" → "),
        strong(targetName(state, event.seat, event.target)),
      ]);
    case "TOOLS_DISCARDED": {
      // Tool discard: filed under `event.actor`; the host comes from `event.host` because the same
      // attack can Knock it Out in this batch; the owner is named outright; the cards are named.
      // The "before doing damage" tail appears only when `when` is "preDamage", and a consumed Tool
      // gets its own tail.
      const cards = event.uids.map((uid) => cardName(state, uid));
      return row(event.actor, [
        plain("discarded "),
        { text: countedNames(cards), tone: "energy" },
        plain(" from "),
        strong(`${names[event.seat]}'s ${cardName(state, event.host)}`),
        ...(event.when === "preDamage" ? [plain(" before doing damage")] : []),
        // A consumable Tool discarded itself after its effect paid.
        ...(event.when === "consumed" ? [plain(" after it took effect")] : []),
        // Multi Adapter's trim: the owner discarded down to the cap.
        ...(event.when === "trimmed" ? [plain(" — Multi Adapter no longer applies")] : []),
      ]);
    }
    case "STADIUM_DISCARDED":
      // Follows the replacing Stadium's TRAINER_PLAYED row (§7.3); `seat` is the owner. An effect
      // discard leaves the zone empty and claims no replacement.
      return row("system", [
        strong(cardName(state, event.uid)),
        plain(event.cause === "replaced" ? " left play — replaced" : " was discarded"),
      ]);
    case "POKEMON_NAMED":
      // Tyme: the told name only; the card is face down.
      return row(event.seat, [
        plain("named "),
        strong(event.name),
        plain(" — the opponent guesses its HP"),
      ]);
    case "SUPPORTER_EFFECT_USED":
      // Look-Alike Show, filed under the attacker and named as printed; `milled` is Ninetales'
      // variant.
      if (event.milled === true) {
        return row(event.seat, [
          plain("Ninetales's Supernatural Shapeshifter used the effect of "),
          strong(cardName(state, event.uid)),
        ]);
      }
      return row(event.seat, [
        plain("Mr. Mime's Look-Alike Show used the effect of "),
        strong(cardName(state, event.uid)),
      ]);
    case "HP_GUESSED":
      // Tyme's reveal, under the player who played it.
      return row(event.seat, [
        plain("revealed "),
        strong(cardName(state, event.uid)),
        plain(` (${event.hp === null ? "no" : event.hp} HP) — the guess ${event.guess} was `),
        strong(event.right ? "right" : "wrong"),
      ]);
    case "BENCH_TRIMMED": {
      // Area Zero Underdepths' trim, under the owner (who chose). Each body is named and the pile
      // counted.
      const segments: LogSegment[] = [plain("discarded ")];
      event.uids.forEach((uid, index) => {
        if (index > 0) segments.push(plain(index === event.uids.length - 1 ? " and " : ", "));
        segments.push(strong(cardName(state, uid)));
      });
      const extra = event.discarded.length - event.uids.length;
      segments.push(plain(" from the Bench (limit 5)"));
      if (extra > 0) segments.push(plain(` with ${extra} attached card${extra === 1 ? "" : "s"}`));
      return row(event.seat, segments);
    }
    case "ABILITY_USED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" used "),
        strong(event.ability),
      ]);
    case "STADIUM_ABILITY_ACTIVATED":
      // The Stadium's own name is the effect's name, so "used <Stadium>" rather
      // than the Pokémon-Ability "<Pokémon> used <Ability>" phrasing.
      return row(event.seat, [plain("used "), strong(event.stadium)]);
    case "ABILITY_TRIGGERED":
      // A triggered Ability firing on its own (played to Bench / evolved /
      // between turns / on Knock Out) — reads like ABILITY_USED but names it as
      // automatic. The KO'd card name resolves off the event's own uid, so an
      // on-KO Ability still names its Pokémon after it left play.
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain("'s "),
        strong(event.ability),
        plain(" activated"),
      ]);
  }
}

/** Hand costs, discards, reveals and moves. */
function formatHandEvent(
  event: EventOf<
    | "HAND_COST_PAID"
    | "HAND_DISCARDED"
    | "FORCED_HAND_DISCARD"
    | "HAND_SHUFFLED_INTO_DECK"
    | "HAND_TO_BOTTOM_OF_DECK"
    | "HAND_REVEALED"
    | "HAND_CARDS_REVEALED"
    | "CARD_TO_BOTTOM_OF_DECK"
    | "HAND_CARD_SHUFFLED_INTO_DECK"
    | "CARD_DISCARDED_FROM_HAND"
    | "RANDOM_CARD_REVEALED"
    | "RANDOM_CARD_TAKEN"
  >,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { names, state, row } = fmt;
  switch (event.type) {
    case "HAND_COST_PAID": {
      // The printed hand cost (§7/§9), after the TRAINER_PLAYED / ABILITY_USED row and before
      // whatever it bought. Count only, as cards leaving the hidden hand; the verb distinguishes
      // discard from deck bottom or top.
      const n = event.uids.length;
      const cards = `${n} card${n === 1 ? "" : "s"}`;
      // Academy at Night's "on top of their deck": hidden to hidden, count only. Evidence
      // Gathering's swap sends the old top card to the hand.
      if (event.took !== undefined) {
        return row(event.seat, [
          plain(`switched ${cards} from their hand with the top card of their deck`),
        ]);
      }
      if (event.to === "deckTop") {
        return row(event.seat, [plain(`put ${cards} from their hand on top of their deck`)]);
      }
      return row(event.seat, [
        plain(
          event.to === "deckBottom"
            ? `put ${cards} from their hand on the bottom of their deck`
            : // An attack's discard is the attack's effect, not a cost.
              event.effect === true
              ? `discarded ${cards} from their hand`
              : `discarded ${cards} from their hand to pay a cost`,
        ),
      ]);
    }
    case "HAND_DISCARDED": {
      // Count only — the hand is otherwise hidden (module header), even though
      // the discard pile itself is public.
      const n = event.uids.length;
      return row(event.seat, [plain(`discarded their hand (${n} card${n === 1 ? "" : "s"})`)]);
    }
    case "FORCED_HAND_DISCARD": {
      // An opponent-side hand discard, filed under `event.seat`: the owner picked the cards (or a
      // sweep picked them), and the ATTACK_DECLARED row names the cause. The count comes from
      // `event.uids.length`. When `to` is "deck", the row must not say "discarded" or "shuffled";
      // the SHUFFLE row follows.
      const n = event.uids.length;
      const cards = `${n} card${n === 1 ? "" : "s"}`;
      return row(event.seat, [
        plain(
          event.to === "deck"
            ? `put ${cards} from their hand into their deck`
            : `discarded ${cards} from their hand`,
        ),
      ]);
    }
    case "HAND_SHUFFLED_INTO_DECK": {
      // The hand-refresh Supporter family; count only, even for the opponent's hand. A CARDS_DRAWN
      // row follows, except Celebration's post-Prize stage, which draws nothing.
      const n = event.count;
      return row(event.seat, [
        plain(`shuffled their hand (${n} card${n === 1 ? "" : "s"}) into their deck`),
      ]);
    }
    case "HAND_TO_BOTTOM_OF_DECK": {
      // The other placement in the same family (Iono) — count only for the same
      // reason, but a distinct row because the deck's order SURVIVES here, which
      // is what both players need to read off the log. It must still say
      // "shuffled": the HAND is randomized on its way under the deck, so a player
      // who watched those cards can't plan around their order (the sibling row
      // above says "into their deck" — the contrast is the destination, not
      // whether anything was shuffled).
      const n = event.count;
      return row(event.seat, [
        plain(
          `shuffled their hand (${n} card${n === 1 ? "" : "s"}) and put it on the bottom of their deck`,
        ),
      ]);
    }
    case "HAND_REVEALED": {
      // Hand reveals name their cards: once revealed, the cards are no longer hidden, and this row
      // is the only lasting record. Filed under the revealing seat.
      const n = event.uids.length;
      if (n === 0) return row(event.seat, [plain("revealed their hand — no cards")]);
      return row(event.seat, [
        plain("revealed their hand: "),
        strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
      ]);
    }
    case "HAND_CARDS_REVEALED":
      // Doublade "Weaponized Swords": the picked cards are public, so named; they stay in the hand.
      // Never emitted for an empty pick.
      return row(event.seat, [
        plain("revealed from their hand: "),
        strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
      ]);
    case "CARD_TO_BOTTOM_OF_DECK":
      // The chosen card going under its owner's deck: named, because the move happened face up.
      // Filed under the actor, the owner named outright so mirror matches differ.
      return row(event.actor, [
        plain("put "),
        strong(cardName(state, event.uid)),
        plain(` on the bottom of ${names[event.seat]}'s deck`),
      ]);
    case "HAND_CARD_SHUFFLED_INTO_DECK":
      // Watchog "Snap Inspection": the same move with a shuffle; named and filed under the actor.
      return row(event.actor, [
        plain("shuffled "),
        strong(cardName(state, event.uid)),
        plain(` into ${names[event.seat]}'s deck`),
      ]);
    case "CARD_DISCARDED_FROM_HAND":
      // The chosen pick from the opponent's revealed hand, discarded and named. "chose"
      // distinguishes it from a random take. Filed under the actor (read, never derived), owner
      // named outright.
      return row(event.actor, [
        plain("chose "),
        strong(cardName(state, event.uid)),
        plain(` from ${names[event.seat]}'s hand and discarded it`),
      ]);
    case "RANDOM_CARD_REVEALED":
      // Bother-Bot's random reveal: the card stays in the hand; named, with "random" in the row.
      return row(event.actor, [
        plain(
          `chose a random card from ${names[event.seat]}'s hand — ${names[event.seat]} revealed `,
        ),
        strong(cardName(state, event.uid)),
      ]);
    case "RANDOM_CARD_TAKEN":
      // The random pick from the opponent's hand, named because it is no longer hidden. "random"
      // distinguishes it from a chosen card. Filed under the actor, owner named outright.
      return row(event.actor, [
        plain("took "),
        strong(cardName(state, event.uid)),
        plain(
          event.to === "discard"
            ? ` at random from ${names[event.seat]}'s hand and discarded it`
            : ` at random from ${names[event.seat]}'s hand and shuffled it into their deck`,
        ),
      ]);
  }
}

/** Deck searches, retrievals and deck-top manipulation. */
function formatDeckEvent(
  event: EventOf<
    | "DECK_SEARCHED"
    | "DISCARD_RETRIEVED"
    | "DECK_TOP_REVEALED"
    | "DECK_TOP_DISCARDED"
    | "DECK_BOTTOM_DISCARDED"
    | "DECK_TOP_REORDERED"
    | "DECK_TOP_TO_BOTTOM"
  >,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { names, state, row } = fmt;
  switch (event.type) {
    case "DECK_SEARCHED": {
      // Endings: bench is count only (the card is public anyway); hand with printed `reveal` names
      // the cards; hand without reveal is count only so the hand stays private; "deckTop" is count
      // only so the arranged draws are not announced.
      const n = event.uids.length;
      if (event.dest === "bench") {
        return row(event.seat, [plain(`searched their deck — benched ${n} Pokémon`)]);
      }
      // Discard pile destination (Brilliant Blender): public, so the cards are named.
      if (event.dest === "discard") {
        return row(event.seat, [
          plain("searched their deck — discarded "),
          strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
        ]);
      }
      if (event.dest === "deckTop") {
        return row(event.seat, [
          plain(`searched their deck — put ${n} card${n === 1 ? "" : "s"} on top`),
        ]);
      }
      if (event.reveal !== true) {
        return row(event.seat, [
          plain(`searched their deck — put ${n} card${n === 1 ? "" : "s"} in hand`),
        ]);
      }
      // countedNames folds duplicates to "×N" — a search for up to 3 of one name
      // (Flamigo, Misty's Pokémon) is the common case here, and three identical
      // names in a row reads as a stutter rather than a quantity.
      return row(event.seat, [
        plain("searched their deck — revealed "),
        strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
        plain(` and put ${n === 1 ? "it" : "them"} in hand`),
      ]);
    }
    case "DISCARD_RETRIEVED": {
      // The §7.1 recovery Items; fires only with at least one card. Each destination gets its own
      // wording. Caretaker shuffles itself in instead of being discarded, so the row names it.
      if (event.played === true) {
        return row(event.seat, [
          plain("shuffled "),
          strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
          plain(" into their deck instead of discarding it"),
        ]);
      }
      const n = event.uids.length;
      const cards = `${n} card${n === 1 ? "" : "s"} from their discard pile`;
      return row(
        event.seat,
        event.dest === "hand"
          ? [plain(`took ${cards}`)]
          : event.dest === "bench"
            ? [plain(`put ${cards} onto their Bench`)]
            : [plain(`shuffled ${cards} into their deck`)],
      );
    }
    case "DECK_TOP_REVEALED": {
      // Top-of-deck looks; fires only with at least one taken card, except the empty row, which
      // tells the opponent the deck top was read. Cards are named only when the sentence prints a
      // reveal, and the destination comes from the event.
      const n = event.uids.length;
      const where =
        event.dest === "bench"
          ? "onto their Bench"
          : event.dest === "discard"
            ? "in the discard pile"
            : "in hand";
      // The row names which end was looked at (Dusk Ball looks at the bottom).
      const end = event.from === "bottom" ? "bottom" : "top";
      // Accompanying Flute: the actor looked at `seat`'s deck and benched onto `seat`'s Bench;
      // filed under the actor, placed Basics named. Haughty Order: revealed cards stay in the deck
      // and are named.
      if (event.dest === "deck") {
        // Bug Out reveals its own deck (no `actor`), so it reads "their deck".
        const owner =
          event.actor === undefined || event.actor === event.seat
            ? "their"
            : `${names[event.seat]}'s`;
        const who = event.actor ?? event.seat;
        if (n === 0)
          return row(who, [plain(`revealed the ${end} of ${owner} deck — it was empty`)]);
        return row(who, [
          plain(`revealed the ${end} ${n} card${n === 1 ? "" : "s"} of ${owner} deck: `),
          strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
        ]);
      }
      if (event.actor !== undefined) {
        const owner = names[event.seat];
        if (n === 0) {
          return row(event.actor, [
            plain(`revealed the ${end} of ${owner}'s deck — put nothing onto their Bench`),
          ]);
        }
        return row(event.actor, [
          plain(`revealed the ${end} of ${owner}'s deck — put `),
          strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
          plain(` onto ${owner}'s Bench`),
        ]);
      }
      if (n === 0) {
        // No `reveal` branch: a printed "you may reveal a … you find there" that
        // took nothing revealed nothing, so the rider has no cards to name and
        // the two renders would be the same sentence.
        return row(event.seat, [plain(`looked at the ${end} of their deck — took nothing`)]);
      }
      if (event.reveal !== true) {
        return row(event.seat, [
          plain(`looked at the ${end} of their deck — put ${n} card${n === 1 ? "" : "s"} ${where}`),
        ]);
      }
      return row(event.seat, [
        plain(`looked at the ${end} of their deck — revealed `),
        strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
        plain(` and put ${n === 1 ? "it" : "them"} ${where}`),
      ]);
    }
    case "DECK_TOP_DISCARDED": {
      // Deck-top discards, count only; `event.seat` is the deck's owner. Voice depends on `actor
      // === seat`: active when the owner did it (look-and-discard leftovers, a self-mill), passive
      // for an opponent mill. The row does not say "looked-at" because milled cards were never
      // looked at.
      const n = event.uids.length;
      const cards = `${n} card${n === 1 ? "" : "s"}`;
      return row(event.seat, [
        plain(
          event.actor === event.seat
            ? `discarded ${cards} from the top of their deck`
            : `had ${cards} discarded from the top of their deck`,
        ),
      ]);
    }
    case "DECK_BOTTOM_DISCARDED": {
      // Flustered Leap's own-deck cost from the bottom: count only, active voice.
      const n = event.uids.length;
      return row(event.seat, [
        plain(`discarded ${n} card${n === 1 ? "" : "s"} from the bottom of their deck`),
      ]);
    }
    case "DECK_TOP_REORDERED": {
      // `reorderTop`'s row: count only, because the cards went back into a deck the owner may not
      // see. Voice follows `actor === seat`. It says "looked at" because that is what the other
      // player is owed. `end: "bottom"` (Kofu) renders a different sentence: nothing was looked at,
      // but the order was chosen.
      const n = event.count;
      const cards = `${n} card${n === 1 ? "" : "s"}`;
      if (event.end === "bottom") {
        return row(event.seat, [plain(`chose the order of the bottom ${cards} of their deck`)]);
      }
      // A one-card look has no chosen order, so the ordering clause is dropped; the next row says
      // whether the deck was shuffled.
      if (n === 1) {
        return row(event.seat, [
          plain(
            event.actor === event.seat
              ? "looked at the top card of their deck"
              : "had the top card of their deck looked at",
          ),
        ]);
      }
      return row(event.seat, [
        plain(
          event.actor === event.seat
            ? `looked at the top ${cards} of their deck and put them back in a chosen order`
            : `had the top ${cards} of their deck looked at and put back in a chosen order`,
        ),
      ]);
    }
    case "DECK_TOP_TO_BOTTOM": {
      // Count only: the cards go from hidden to hidden and are shuffled, so nobody knows the order.
      // It says "shuffled to the bottom" rather than "shuffled their deck" because the rest of the
      // deck's order is untouched.
      const n = event.count;
      const cards = `${n} card${n === 1 ? "" : "s"}`;
      return row(event.seat, [
        plain(`shuffled the top ${cards} of their deck to the bottom of it`),
      ]);
    }
  }
}

/** Energy attaching, moving and discarding. */
function formatEnergyEvent(
  event: EventOf<"ENERGY_ATTACHED" | "ENERGY_MOVED" | "ENERGY_DISCARDED">,
  fmt: LogFormat,
): SeatLogEntry[] | null {
  const { names, state, koHosts, row } = fmt;
  switch (event.type) {
    case "ENERGY_ATTACHED":
      // Resolve the host by the energy's uid, NOT the target slot: Jet Energy's
      // on-attach switch (§6.1) moves its benched host to the Active Spot in
      // this same batch, so the target index would name the wrong Pokémon.
      return row(event.seat, [
        plain("attached "),
        { text: cardName(state, event.uid), tone: "energy" },
        plain(" → "),
        strong(energyHostName(state, event.seat, event.uid, koHosts)),
      ]);
    case "ENERGY_MOVED": {
      // Energy Switch / Poppy (moveEnergy): Energy moved between two of one player's Pokémon,
      // `event.seat`, who is not necessarily the actor. The source is named by uid when the event
      // carries one, because a same-reduction Knock Out can make its spot resolve to the
      // replacement Pokémon.
      const n = event.uids.length;
      const source =
        event.fromUid === undefined
          ? targetName(state, event.seat, event.from)
          : cardName(state, event.fromUid);
      const destination = targetName(state, event.seat, event.to);
      // The actor half reads `event.actor`; both targets resolve against `event.seat`, since
      // `targetName` looks a ref up on the seat it is handed.
      if (event.actor === event.seat) {
        return row(event.seat, [
          plain(`moved ${n} energy from `),
          strong(source),
          plain(" to "),
          strong(destination),
        ]);
      }
      // The cross-board row names the owner outright: the `who` chip is viewer-relative while these
      // segments are fixed text, so in a mirror match a bare "from Pikachu to Pikachu" would be
      // ambiguous.
      return row(event.actor, [
        plain(`moved ${n} energy on ${names[event.seat]}'s board, from `),
        strong(source),
        plain(" to "),
        strong(destination),
      ]);
    }
    case "ENERGY_DISCARDED": {
      // Crushing Hammer / discardEnergy and self-discard attack costs. `event.seat` owns the
      // Pokémon that lost the Energy; the line reads from `event.actor`, whose card caused it.
      const cards = event.uids.map((uid) => cardName(state, uid));
      if (event.to === "hand") {
        return row(event.actor, [
          plain("put "),
          { text: countedNames(cards), tone: "energy" },
          plain(" from "),
          strong(`${names[event.seat]}'s ${cardName(state, event.host)}`),
          plain(` into ${names[event.seat]}'s hand`),
        ]);
      }
      // `"deck"` gets its own verb so shuffling attached Energy into the deck is not logged as a
      // discard.
      if (event.to === "deck") {
        return row(event.actor, [
          plain("shuffled "),
          { text: countedNames(cards), tone: "energy" },
          plain(" from "),
          strong(`${names[event.seat]}'s ${cardName(state, event.host)}`),
          plain(` into ${names[event.seat]}'s deck`),
        ]);
      }
      return row(event.actor, [
        plain("discarded "),
        { text: countedNames(cards), tone: "energy" },
        plain(" from "),
        strong(`${names[event.seat]}'s ${cardName(state, event.host)}`),
      ]);
    }
  }
}
