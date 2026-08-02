// GameEvent stream → game-log rows (`SeatLogEntry`, @luminous/schema). Entries
// are recorded SEAT-keyed because the log outlives its viewer: on /play the
// hot-seat device flips mid-game, and online the SAME array is broadcast to both
// clients — a row minted as "you" would lie to whoever ends up reading it. The
// seat→viewer relabel is the render layer's job (`viewLogEntries`,
// src/features/game/viewLog.ts), which the redactor precedent (redact.ts builds
// the wire shape, the web maps it to playmat) keeps out of the engine.
//
// PURE, and run in TWO places: /play builds rows client-side, and the lobby
// Durable Object builds them server-side with the full state (P4 online.md). So
// this is the log's SINGLE definition, shared by both — hence its move into the
// engine package alongside `redactGame`.
//
// Hidden information stays hidden in the log too: draws and prize takes are
// counts only, and face-down setup placements never name the card — the log
// persists across viewer flips, so a named draw would leak one player's hand
// to the other.

import type { LogSegment, SeatLogEntry } from "@luminous/schema";
import { type DamageModifier, cardOfUid, topCardOf } from "./cards";
import type { GameEvent, StatusName } from "./events";
import {
  DEFAULT_POISON_DAMAGE,
  type GameOverReason,
  type GameState,
  type Seat,
  otherSeat,
} from "./types";

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

function cardName(state: GameState, uid: string): string {
  return cardOfUid(state, uid)?.name ?? "a card";
}

/** The Pokémon an attach target points at, resolved from the post-state. Safe
    for a target whose host stays put (Tools — attachTool never moves it). */
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

/** Card names for a batch, repeats folded into "×N" in first-seen order —
    "Fire Energy ×2, fix-energy" rather than "Fire Energy, Fire Energy,
    fix-energy". A `count: "all"` discard is the first batch that can hold
    several copies of one card (every earlier producer emitted one uid per
    event), and a run of identical names reads as a stutter rather than a
    quantity. */
function countedNames(cardNames: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of cardNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");
}

/** The Pokémon now carrying `energyUid`, resolved by uid rather than by the
    attach target's slot — robust to an on-attach move (Jet Energy switches its
    benched host to the Active Spot in the SAME batch, compacting the bench, so
    the target index no longer names the host). Reads the post-state. */
function energyHostName(state: GameState, seat: Seat, energyUid: string): string {
  const side = state.players[seat];
  const carriers = side.active === null ? side.bench : [side.active, ...side.bench];
  const host = carriers.find((pokemon) => pokemon.energy.includes(energyUid));
  return host === undefined ? "a Pokémon" : (topCardOf(state, host)?.name ?? "a Pokémon");
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
      // Resolve the host by the energy's uid, NOT the target slot: Jet Energy's
      // on-attach switch (§6.1) moves its benched host to the Active Spot in
      // this same batch, so the target index would name the wrong Pokémon.
      return row(event.seat, [
        plain("attached "),
        { text: cardName(state, event.uid), tone: "energy" },
        plain(" → "),
        strong(energyHostName(state, event.seat, event.uid)),
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
      // The breadcrumbs read in §8.5 PIPELINE order so the math reconstructs:
      // the attack's own printed scaling clause (Paldean Tauros "Raging Horns")
      // and then the attacker's continuous pre-W/R bonus (Vitality Band) FIRST —
      // both land at the same pre-W/R step, the scaling ahead of the continuous
      // boost — then Weakness, Resistance, then the defender's post-W/R reduction
      // (Bouffalant "Bouffer" / a defending Tool) last.
      if (event.scaled !== undefined) segments.push(plain(` · scaled +${event.scaled}`));
      if (event.bonus !== undefined) segments.push(plain(` · boosted +${event.bonus}`));
      if (event.weakness !== null) segments.push(plain(modifierText("weakness", event.weakness)));
      if (event.resistance !== null) {
        segments.push(plain(modifierText("resistance", event.resistance)));
      }
      if (event.reduction !== undefined) segments.push(plain(` · reduced ${event.reduction}`));
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
    // §11 — the retreat block. Its own rows, not STATUS_* ones: it is not a
    // Special Condition, so the "is now …"/"recovered from …" phrasings (which
    // name a §12 status) would read wrong.
    case "RETREAT_BLOCKED":
      return row(event.seat, [strong(cardName(state, event.uid)), plain(" can't retreat next turn")]);
    case "RETREAT_BLOCK_ENDED":
      return row(event.seat, [strong(cardName(state, event.uid)), plain(" can retreat again")]);
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
          // D138 — the destination half of a printed counter MOVE (Dedenne ex
          // "Tail Swap"). A SYSTEM row, like the Ability placement above and for
          // a sharper version of the same reason: `seat` owns the DAMAGED
          // Pokémon, which here is the attacker's OPPONENT, and rows render
          // after their seat's name — so an active-voice row under this seat
          // would credit the victim with the move (D136's finding 1, verbatim).
          // The actor is named by the ATTACK_DECLARED row above, and the HEALED
          // row directly before this one carries the same amount coming OFF the
          // attacker's Bench, which is what makes the pair read as one move.
          return row("system", [plain("Moved: "), amount, plain(" damage onto "), strong(name)]);
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
      // Three reasons: "confusion" is §12's tails (the 30 self-damage follows as
      // its own row), "requirement" is D125's printed "this attack does
      // nothing" with its clause held — nothing follows that one, so the row
      // must say so on its own or the attack reads as a silent no-op — and
      // "coinFlip" is D126's printed "If tails, this attack does nothing." The
      // last one is PRECEDED by its own ATTACK_EFFECT_COIN_FLIP row, which
      // already named the face, so this line states the CONSEQUENCE and does not
      // repeat "tails".
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          event.reason === "confusion"
            ? "'s attack failed — Confused"
            : event.reason === "coinFlip"
              ? "'s attack did nothing — the coin flip missed"
              : "'s attack did nothing — its condition was not met",
        ),
      ]);
    case "HEALED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(` healed ${event.amount} damage`),
      ]);
    case "ATTACK_EFFECT_COIN_FLIP":
      // A coinFlipGate flip — an attack's effect OR a Trainer's (Poké Ball /
      // Pokémon Catcher, M5); `seat` is the actor. The event id keeps "ATTACK_"
      // for back-compat, but the copy stays neutral so a Trainer flip reads right.
      return row(event.seat, [plain("flipped "), strong(event.result), plain(" for the effect")]);
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
    // — M4 Trainer / Ability plays (§7/§9) and their effect ops (§15). —
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
    case "STADIUM_DISCARDED":
      // Follows the replacing Stadium's TRAINER_PLAYED row (§7.3); `seat` is
      // the OWNER whose discard pile gained the old card.
      return row("system", [
        strong(cardName(state, event.uid)),
        plain(" left play — replaced"),
      ]);
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
    case "ABILITY_COIN_FLIP":
      // §9 — a triggered Ability's own coin flip (Glimmora "Shattering Crystal"
      // on Knock Out). Follows its ABILITY_TRIGGERED row.
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" flipped "),
        strong(event.result),
        plain(` for ${event.ability}`),
      ]);
    case "PRIZE_PREVENTED":
      // §8.1 — an on-KO Ability (Glimmora heads) denied the opponent the Prize
      // for the Knocked Out Pokémon; a system row, the flip above named it.
      return row("system", [
        strong(cardName(state, event.uid)),
        plain(" — no Prize card is taken for it"),
      ]);
    case "HAND_COST_PAID": {
      // §7/§9 — the printed hand cost (Ultra Ball's "only if you discard 2 other
      // cards", Tinkaton / Meowscarada ex's "you must discard … in order to use
      // this Ability", Dendra's "put a card from your hand on the bottom of your
      // deck"). Follows the TRAINER_PLAYED / ABILITY_USED row and PRECEDES
      // whatever it bought, which is the printed sentence order.
      //
      // Count only, like every card leaving the hidden HAND (the HAND_DISCARDED
      // rule) — cards paid to the discard do land in a public pile, but the log's
      // convention is about the zone they came FROM, and a curious player can
      // read the pile itself. Cards paid to the DECK BOTTOM are hidden at both
      // ends, so the count is all there is to say; the verb is what tells the two
      // apart, and it matters — a discard is readable afterwards and a card under
      // the deck never is.
      const n = event.uids.length;
      const cards = `${n} card${n === 1 ? "" : "s"}`;
      return row(event.seat, [
        plain(
          event.to === "deckBottom"
            ? `put ${cards} from their hand on the bottom of their deck`
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
    case "HAND_SHUFFLED_INTO_DECK": {
      // The hand-refresh Supporter family (Youngster / Judge / Brassius / Katy).
      // Count only — the hand is hidden (module header), so this names no card
      // even when the op reaches the OPPONENT's hand (Judge). A separate
      // CARDS_DRAWN row (count only too) follows for the draw.
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
      // Ortega / Greavard "Underworld Stroll". The ONE hand row that is not
      // count-only, and deliberately: a reveal is the moment those cards stop
      // being hidden, so the module header's rule ("never name a card in a
      // hidden zone") does not bite — the zone is not hidden any more. Naming
      // them is also the only way the log stays useful, since the reveal is
      // transient: the hand goes back to face-down for the rest of the game and
      // this row is the only lasting record of what was in it.
      //
      // Filed under the REVEALING seat (whose hand it is), not the actor whose
      // card caused it — the TRAINER_PLAYED / ATTACK_DECLARED row directly above
      // names the cause, the HAND_COST_PAID precedent.
      const n = event.uids.length;
      if (n === 0) return row(event.seat, [plain("revealed their hand — no cards")]);
      return row(event.seat, [
        plain("revealed their hand: "),
        strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
      ]);
    }
    case "CARD_TO_BOTTOM_OF_DECK":
      // The chosen card going under its owner's deck (Ortega / Greavard). Named,
      // unlike HAND_COST_PAID's deckBottom row, because this move happened face
      // up at both ends — the hand was just revealed and the pick was made in
      // the open, so both players know what is sitting on the bottom until
      // something shuffles. That is a real piece of public information and the
      // log is where it lives.
      //
      // Filed under the ACTOR (whose card did it — the ENERGY_DISCARDED rule),
      // and the owner is named OUTRIGHT rather than by a possessive: the `who`
      // chip is viewer-relative while these segments are fixed text, so a
      // mirror match would otherwise print an identical row from both seats.
      return row(event.actor, [
        plain("put "),
        strong(cardName(state, event.uid)),
        plain(` on the bottom of ${names[event.seat]}'s deck`),
      ]);
    case "DECK_SEARCHED": {
      const n = event.uids.length;
      return row(
        event.seat,
        event.dest === "bench"
          ? [plain(`searched their deck — benched ${n} Pokémon`)]
          : [plain(`searched their deck — put ${n} card${n === 1 ? "" : "s"} in hand`)],
      );
    }
    case "DISCARD_RETRIEVED": {
      // The §7.1 recovery Items (Energy Retrieval / Pal Pad / Super Rod); only
      // fires with ≥1 card (a "take none" moves nothing and emits no event). The
      // discard pile is public, so a count would suffice, but it reads clearer
      // as an action row like DECK_SEARCHED.
      const n = event.uids.length;
      return row(
        event.seat,
        event.dest === "hand"
          ? [plain(`took ${n} card${n === 1 ? "" : "s"} from their discard pile`)]
          : [plain(`shuffled ${n} card${n === 1 ? "" : "s"} from their discard pile into their deck`)],
      );
    }
    case "DECK_TOP_REVEALED": {
      // Great Ball / Pokégear 3.0 (lookAtTopN); only fires with ≥1 taken card (a
      // "take none" moves nothing and emits no event). Honest about "looked at
      // the top" rather than DECK_SEARCHED's "searched their deck"; count only,
      // even though the taken cards are revealed — the row reads cleaner and a
      // trailing SHUFFLE row follows.
      const n = event.uids.length;
      return row(event.seat, [
        plain(`looked at the top of their deck — put ${n} card${n === 1 ? "" : "s"} in hand`),
      ]);
    }
    case "DECK_TOP_DISCARDED": {
      // THREE producers, and the wording is PROVENANCE-NEUTRAL because of it (D113's
      // rule: reuse the event, fix the message so it cannot lie):
      //   • Hydreigon "Tri Howl" (attachFromTop `discardRest`) — the looked-at
      //     cards that were NOT attached, off the actor's OWN deck.
      //   • the mill (discardDeckTop, D130 + D131) — "Discard the top N cards of
      //     your [opponent's] deck", off EITHER deck depending on the op's `whose`.
      // That third case is why the wording had to stay neutral rather than merely
      // provenance-free: one op now produces rows on both seats, so a message that
      // named the actor would be wrong half the time from a single call site.
      // The old copy said "discarded N LOOKED-AT cards", which is true of the
      // first and a flat lie about the second: nobody looked at a milled card.
      // The "looked-at" flavour is not lost — Tri Howl's own DECK_TOP_REVEALED and
      // ENERGY_ATTACHED rows sit directly above this one and carry it, which is
      // exactly why this row never needed to.
      //
      // Count only, like its DECK_TOP_REVEALED sibling: the pile is public, so a
      // curious player can read the cards themselves, and what the LOG has to
      // carry is that the cards LEFT THE DECK. `event.seat` is the deck's OWNER on
      // both producers, so the row belongs to the player who lost them — a mill
      // reads as the opponent's row, which is what it is.
      //
      // Which is exactly why the verb is PASSIVE. Every row here is rendered after
      // its seat's name, so an active verb asserts that seat DID the thing; on a
      // mill the owner is the victim, and "P2 discarded 2 cards from the top of
      // their deck" credits the milling to the player who lost the cards. Neutral
      // wording was necessary and not sufficient — dropping "looked-at" stopped the
      // row lying about PROVENANCE, and the voice is what stops it lying about the
      // ACTOR. The alternative is ENERGY_DISCARDED's: carry a separate `actor` on
      // the event and read the line off it. Passive costs no event field, and this
      // row never names the actor anyway — the producing ATTACK_DECLARED /
      // ABILITY_TRIGGERED row sits directly above and names it.
      const n = event.uids.length;
      return row(event.seat, [
        plain(`had ${n} card${n === 1 ? "" : "s"} discarded from the top of their deck`),
      ]);
    }
    case "ENERGY_MOVED": {
      // Energy Switch / Poppy (moveEnergy) — moved own-board Energy between two of
      // the player's Pokémon. Both `from`/`to` name Pokémon on the seat's own
      // board, which stayed put (no compaction), so targetName resolves them.
      const n = event.uids.length;
      return row(event.seat, [
        plain(`moved ${n} energy from `),
        strong(targetName(state, event.seat, event.from)),
        plain(" to "),
        strong(targetName(state, event.seat, event.to)),
      ]);
    }
    case "ENERGY_DISCARDED": {
      // Crushing Hammer / Giacomo / Mawile (discardEnergy), and the self-discard
      // attack cost (Houndoom "Fire Blast", Pawmot "Electro Paws"). `event.seat`
      // owns the Pokémon that LOST the Energy; the line reads from `event.actor`,
      // whose card caused it (its TRAINER_PLAYED / ABILITY_TRIGGERED /
      // ATTACK_DECLARED row sits just above and names it). The two are the SAME
      // seat for a self-discard — reading it as "the other seat", as this row did
      // before that arm existed, would credit Houndoom's own cost to its
      // opponent. Both the attached Energy and the discard pile are public, so
      // the cards are named.
      // The Energy carries the `energy` tone (ENERGY_ATTACHED's) and the HOST
      // `strong`, so the row's two names don't render identically — otherwise
      // "discarded X from Y" gives the reader no cue which is the card and
      // which is the Pokémon it came off.
      //
      // The host is named by the event's `host` UID, never by re-reading the
      // spot: an ATTACK can strip a defender its own damage Knocked Out (§8
      // resolves before the §8.1 check), and the KO lands in this same batch, so
      // `targetName(state, seat, from)` would find an EMPTY slot and print
      // "Tide's the Active spot". A uid resolves through cardIdByUid forever —
      // which is also why the Energy names above survive their own discard.
      //
      // "from" must say WHOSE Pokémon, and it names the OWNER outright. While the
      // op only reached the opponent's board, a bare "from <name>" could only mean
      // theirs; now that the same sentence serves a self-discard, a mirror match
      // prints an identical row for "their Paldean Tauros" and "my Paldean Tauros"
      // (unlike DAMAGE_DEALT's "dealt … to", which is directional on its own). A
      // possessive pronoun cannot fix it: the `who` chip is VIEWER-relative
      // ("you" / "opponent") while these segments are fixed text, so the only
      // wording true from every seat is the player's own name — the coin-flip
      // row's precedent.
      const cards = event.uids.map((uid) => cardName(state, uid));
      return row(event.actor, [
        plain("discarded "),
        { text: countedNames(cards), tone: "energy" },
        plain(" from "),
        strong(`${names[event.seat]}'s ${cardName(state, event.host)}`),
      ]);
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
    default:
      // A future engine event lands here — skipped, never a crash.
      return null;
  }
}
