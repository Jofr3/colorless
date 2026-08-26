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
import type { AttackerClass } from "./effects";
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

/** §11 (D239) — the printed ATTACKER CLASS as a player-facing noun modifier:
    "Basic", "Basic non-Colorless". The ONE renderer of `AttackerClass`, and it
    exists rather than being an interpolation because the record's two keys are
    two printed words in a fixed order — a caller assembling them ad hoc is the
    drift `attackBlockOf`'s single-read contract exists to stop, one layer up.

    ⚠️ IT SPELLS THE TYPE NAME, NEVER THE PRINTED BRACE CODE. D238's finding: a
    dialog or a log row must not quote `{C}` at a player, so the deriver resolves
    the code through `POKEMON_TYPE_BY_CODE` at parse time and this function only
    ever sees a `PokemonType`. The printed card says "non-{C}"; the row says
    "non-Colorless"; they are the same claim in two audiences' vocabularies. */
function attackerClassPhrase(cls: AttackerClass): string {
  const stage = stageWord(cls.stage);
  return cls.excludingType === undefined ? stage : `${stage} non-${cls.excludingType}`;
}

/** The stage word's printed CASING, and a `switch` for `attackerMatchesStage`'s
    reason (continuous.ts): the stored token is lowercase, the printed word is
    capitalised, and a new member must be given a spelling by a human rather than
    leaking its internal token into a log row. */
function stageWord(stage: AttackerClass["stage"]): string {
  switch (stage) {
    case "basic":
      return "Basic";
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
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(", ");
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
      // D294 — `actor` present is the cross-seat put (Mandibuzz "Look for Prey"),
      // filed under the ACTOR with the owner named OUTRIGHT, exactly as
      // CARD_TO_BOTTOM_OF_DECK above: the `who` chip is viewer-relative while
      // these segments are fixed text, so a possessive would print an identical
      // row from both seats of a mirror match. Absent is the §5.2 own-hand play
      // and keeps its row byte for byte.
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
      // D149 — the attack-installed debuff on the ATTACKER, at the same pre-W/R
      // step as the two breadcrumbs above and therefore printed with them, before
      // Weakness. Its own crumb rather than a negative `boosted`: the two numbers
      // are different rules and a reader reconstructing the pipeline needs both
      // (events.ts `DAMAGE_DEALT.debuff`).
      //
      // D163 — the SAME crumb now also carries the attack's OWN self-scaling
      // penalty ("This attack does 20 less damage for each damage counter on this
      // Pokémon."), and the wording was READ under both seats before it was kept.
      // It survives because it names the FACT (this attack's damage was reduced
      // before Weakness) and not the RULE, the standard D159's " · prevented"
      // crumb was written to: this row is filed under the DEFENDER and rendered
      // under the ATTACKER, so a crumb naming a source ("Growl") would be false on
      // three of the four boards that now reach it, and one naming an owner would
      // be spoken from the wrong chair. NO NEW ARM: a second crumb would have to
      // be told apart by a member the event deliberately does not carry.
      if (event.debuff !== undefined) segments.push(plain(` · weakened −${event.debuff}`));
      if (event.weakness !== null) segments.push(plain(modifierText("weakness", event.weakness)));
      if (event.resistance !== null) {
        segments.push(plain(modifierText("resistance", event.resistance)));
      }
      if (event.reduction !== undefined) segments.push(plain(` · reduced ${event.reduction}`));
      // D159 — THE FLAG HAS EXISTED SINCE 0.58.0 AND NOTHING HAS EVER RENDERED IT.
      // A full prevention is the largest thing that can happen to a damage number
      // and the row said only "dealt 0 damage to <name>", which reads to a player
      // exactly like an attack that does nothing — the failure mode D142's
      // ATTACK_EFFECT_PREVENTED row exists to avoid, one field away. Found by
      // rendering the row rather than by reading the code: this slice takes the
      // ways a hit can be nulled from two to five, and three of the five are
      // invisible on the board (a benched shield's source is a different card; a
      // Stadium's is no card at all).
      //
      // LAST, because prevention is the last step of §8.5 and SUPERSEDES the
      // reduction above rather than replacing it — a row reading
      // "· reduced 20 · prevented" reconstructs the pipeline exactly as the
      // engine ran it (attack.ts computes both and lets the null win).
      //
      // ⚠️ IT NAMES THE FACT AND NOT THE RULE, WHICH IS THE VOICE ANSWER. This row
      // renders under the ATTACKER's name (`otherSeat(event.seat)`, the line below)
      // while `event.seat` owns the DAMAGED Pokémon — the one event in this family
      // whose row is filed under the opposite seat from its own contract. So a
      // crumb naming an owner ("your Pokémon is protected"), a turn, or a source
      // ("Safeguard") would be spoken from the wrong chair, and the last of those
      // is unknowable here anyway: five rules set this flag and the event carries
      // no member saying which (events.ts, deliberately). A bare past-tense
      // statement about the damage is true under both seats, which is why the
      // wording is one word. Rendered under both and read, not assumed.
      if (event.prevented === true) segments.push(plain(" · prevented"));
      // D219 — THE SAME DEFECT AS `prevented`, ONE FIELD DOWN AND ONE SLICE OLD.
      // D208 added `survived` at all four DAMAGE_DEALT write sites and nothing
      // read it, so a full-HP Pikachu ex hit for 300 rendered "dealt 300 damage to
      // Pikachu ex", NO Knock Out row followed, and the board sat at 10 HP with
      // nothing in the log saying why. That is strictly worse than the row D159
      // fixed above: there the number itself (0) at least signalled something had
      // happened; here every number in the row is the honest §8.5 output and the
      // only visible trace of the rule is a Knock Out that DIDN'T occur.
      //
      // AFTER `prevented`, because the clamp is the last thing to touch the write
      // — it runs on the pipeline's finished `dealt` — and the two are mutually
      // exclusive anyway (a prevented hit deals 0 and can never be lethal).
      //
      // ⚠️ IT NAMES THE FACT AND NOT THE RULE, for D159's reasons exactly, which
      // this event needs even harder: the row is filed under the DEFENDER's seat
      // and rendered under the ATTACKER's, and the sentence has TWO printed
      // Ability names (Pikachu ex "Resolute Heart", Crustle "Sturdy") that the
      // event carries no member to tell apart. "survived the Knock Out" is a bare
      // past-tense statement about the damage, true from either chair, and it
      // borrows the printed sentence's own words ("it is not Knocked Out").
      //
      // NO HP NUMBER, deliberately. "its remaining HP becomes 10" is printed on
      // all seven cards, but the remaining HP this row would have to quote is
      // `effectiveMaxHp − 10` against a maximum the event does not carry — the
      // Bravery Charm board is exactly where that goes wrong — and the board
      // already shows it. A crumb that can be wrong is worse than one that is short.
      if (event.survived === true) segments.push(plain(" · survived the Knock Out"));
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
    case "STATUS_PREVENTED":
      // D172 — the printed sentence, spoken back. "Dachsbun can't be Burned" IS
      // the card's own text with the subject resolved, which is the shortest row
      // that tells a reader the difference between a rule and a bug. Filed under
      // the seat that OWNS the refusing Pokémon (the event family's contract),
      // which for an attack-borne status is the DEFENDER's chair — the opposite
      // of `DAMAGE_DEALT`'s and the same as `STATUS_APPLIED`'s, because this row
      // replaces that one rather than the damage row.
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
          // "benched" follows the RETREATED row; benching clears every condition
          // at once (§11/§12), so the list can name several.
          //
          // "recovered" (D174) shares the arm because it shares the SENTENCE:
          // Therapeutic Energy sv02-193 prints "The Pokémon this card is attached
          // to RECOVERS FROM BEING Asleep, Confused, or Paralyzed", so "Pachirisu
          // recovered from Asleep" is the card's own verb with the subject
          // resolved — D172's voice rule, met by a row that already existed. A
          // second arm rendering the same words would be a second reading (D131);
          // what makes the two distinguishable to a consumer is the `reason`, and
          // what makes the list honest is that this one carries only the
          // conditions the effect NAMES.
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
        default:
          return row(seat, [strong(name), plain(" recovered from "), strong(statuses)]);
      }
    }
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
    // §7.1/§7.2 (D283) — the imposed hand-play bar. VICTIM-SIDE `seat`, exactly
    // like RETREAT_BLOCKED two lines up, and NO card name: the row's subject is
    // the barred PLAYER, and this is the one attack rider in the file with no
    // Pokémon to name (events.ts `HAND_PLAY_BLOCKED`). The class is `strong` for
    // the reason D146 gave the filtered damage block its own phrasing — a reader
    // told only "blocked" cannot work out which card in their hand just died.
    // 🆕 D285 — the payload is a `StampedPlayLockKey`, so it is a CARD CLASS on
    // three of the family's four sentences and an ACT on the fourth (Bronzong's
    // `"evolve"`). Rendering it through one template would print "can't play
    // evolve cards"; the noun is chosen HERE rather than carried on the event,
    // because a second payload field would be display text riding a rule row.
    case "HAND_PLAY_BLOCKED":
      return row(event.seat, [
        plain("can't play "),
        strong(event.bars === "evolve" ? "Pokémon to evolve" : `${event.bars} cards`),
        plain(" next turn"),
      ]);
    // §11 — the attack-installed damage block. ACTIVE voice, unlike the §9
    // counterattack row and unlike RETREAT_BLOCKED's victim-side seat: `seat`
    // here owns the shielded Pokémon AND that Pokémon is the actor's own, so
    // rendering it under the actor's name credits the right player. The two
    // printed spellings get two phrasings because the difference is the whole
    // reason the field exists — a reader who is told only "protected" cannot
    // work out whether their Poison is about to land.
    //
    // D146 adds the THIRD phrasing, and it is the one the reader needs most: a
    // class-filtered block lets every evolved attacker through at full damage, so
    // "is protected from damage from attacks" would be an outright lie about the
    // very next turn. The class is named rather than hinted at, and it is read off
    // the ROW rather than off the board — `fromClass` is the printed class, so the
    // wording cannot drift from what `attackBlockOf` will actually enforce.
    //
    // ⚠️ D239 RENDERS THE RECORD RATHER THAN INTERPOLATING IT, and that is D238's
    // caption rule doing its job on the first row that could have broken it: the
    // field carries a resolved `PokemonType`, never the printed `{C}`, so the row
    // says "Basic non-Colorless Pokémon's attacks" and a brace code cannot reach a
    // player's eyes. Interpolating the old string literal would have rendered
    // "[object Object] Pokémon's attacks" on all seven printings.
    //
    // ⚠️ D240 APPENDS THE CAP AS A TRAILING CLAUSE RATHER THAN AS A FOURTH ARM OF
    // THE CHAIN, AND THE TWO REASONS ARE DIFFERENT ONES. The first is
    // correctness: `maxDamage` is INDEPENDENT of the other two — it narrows how
    // BIG an attack may be, where `effects` widens what is refused and
    // `fromClass` narrows whose attack it is — so folding it into the ternary
    // would make one of three independent facts silently unprintable whenever
    // another was present. The second is that every existing row stays
    // BYTE-IDENTICAL: an uncapped block renders exactly the string it rendered
    // before, which is what lets the three pinned wordings keep their assertions.
    // The clause echoes the printed words ("if that damage is 40 or less") rather
    // than paraphrasing them, so a player can match the row to the card face.
    case "ATTACK_BLOCK_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          (event.fromClass !== undefined
            ? ` is protected from damage from ${attackerClassPhrase(event.fromClass)} Pokémon's attacks during your opponent's next turn`
            : event.effects
              ? " is protected from damage and effects of attacks during your opponent's next turn"
              : " is protected from damage from attacks during your opponent's next turn") +
            (event.maxDamage === undefined ? "" : `, if that damage is ${event.maxDamage} or less`),
        ),
      ]);
    // §8/§11 — the attack-installed lock. `seat` owns the LOCKED Pokémon (D136's
    // finding 1), and the WORDING is the row's whole job: this is the only one of
    // the three durated rows that reports a cost rather than a protection, and it
    // is phrased from the holder's side ("can't attack next turn") so it reads as
    // RETREAT_BLOCKED's sibling — which is exactly what it is.
    //
    // ⚠️ D148 ADDS THE OTHER DIRECTION AND CHANGES NOTHING HERE, WHICH IS THE
    // POINT. At 0.92.0 this row was ACTIVE-voiced because `seat` happened to be
    // the actor's own; the 4 opponent-side printings make it VICTIM-voiced, and
    // RETREAT_BLOCKED one screen up is that same wording under the same seat rule.
    // So the phrasing D143 chose against a hypothetical flip is the one the flip
    // needed: "<name> can't attack next turn" is true under either seat, because
    // "next turn" is the LOCKED player's next turn in both readings — the printed
    // wordings differ ("your"/"your opponent's") only because they are spoken from
    // the installer's chair, and a log row is not. A second phrasing keyed on the
    // direction would have to say something the row cannot know (whose attack
    // wrote it) to tell the reader something they already have (whose Pokémon it
    // is). Contrast the THIRD phrasing D146 had to add above: that field changed
    // what the rule DOES.
    //
    // ⚠️ D154 ADDS THE ONE BRANCH THIS ROW DOES NEED, AND THE CONTRAST WITH D148
    // IS THE ARGUMENT. That slice flipped whose Pokémon the row names and needed
    // no new wording, because "can't attack next turn" is true of a locked body
    // under either seat. This slice changes WHAT IS TRUE: a Skarmory whose
    // "Slashing Steel" is barred may still declare "Peck", so the bare wording
    // would not read stilted — it would be FALSE, and false in the direction that
    // makes a player pass a turn they could have attacked on. D153's test applied:
    // the question is not "does the row NAME the attack?" but "does it ASSERT
    // something this path makes untrue?". So the narrowing rides the event
    // (`attack`, the printed name) and the branch is on its presence, ABSENT
    // meaning the whole Pokémon (D135's absent-key rule).
    //
    // The narrow wording keeps the printed verb ("can't use {Name}") so a player
    // with the card in front of them reads back the words on it —
    // DAMAGE_REDUCTION_APPLIED's rule — and keeps "next turn" rather than the
    // printed "During your next turn", for D148's reason: under this event
    // family's seat rule "next turn" always means the NAMED player's own, which is
    // what lets one phrasing serve every path. Rendered under BOTH seats and read
    // before it was chosen (perAttackLock.test.ts), not assumed.
    //
    // 🆕🆕 D421 ADDS THE THIRD PHRASING, AND IT IS THE PARAGRAPH ABOVE APPLIED TO
    // THE OTHER HALF OF THE SENTENCE. D154's branch narrows WHAT is barred; this
    // one replaces WHEN. "This Pokémon can't use Blaze Blitz again until it leaves
    // the Active Spot." (5 legal printings — Gouging Fire ex) has no clock at all,
    // so the two-branch row would print "…can't use Blaze Blitz next turn" — not
    // stilted but FALSE, and false in the direction that costs a player a turn:
    // they wait, press the button, and are refused again, forever. Same test as
    // D154's ("does it ASSERT something this path makes untrue?"), same answer.
    //
    // The narrowing rides the EVENT (`until`, the same key the op and the record
    // carry) and the branch is on its presence — ABSENT still means the next-turn
    // window, so the two riders are two independent presence checks over one fact
    // rather than a shape somebody has to keep in sync.
    //
    // THE WORDING IS THE PRINTED ONE MINUS ITS SUBJECT, which is this family's
    // standing rule (a player with the card in front of them reads back the words
    // on it) and is also what keeps the SEAT rule intact: it names no player and
    // says no "next turn", so unlike the two branches above it does not even have
    // to be checked against whose turn is whose. Rendered under BOTH seats and
    // read before it was chosen (`untilLeavesActiveBar.test.ts`), not assumed.
    case "ATTACK_LOCKED":
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
    // §8.5/§11 — the attack-installed DAMAGE REDUCTION. ACTIVE voice for
    // ATTACK_BLOCK_APPLIED's reason (`seat` owns the protected Pokémon AND that
    // Pokémon is the actor's own), and the NUMBER is in the wording because the
    // number is the rule: four amounts share one sentence, and this row sits
    // directly above a DAMAGE_DEALT row on the next turn whose own `reduction`
    // field carries the same figure. A reader who is told only "takes less
    // damage" cannot check the arithmetic they are about to be shown.
    //
    // The phrasing is the PRINTED one minus its parenthetical — "takes {N} less
    // damage from attacks" — rather than a paraphrase, so a player who has the
    // card in front of them reads back the words on it.
    case "DAMAGE_REDUCTION_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(` takes ${event.amount} less damage from attacks during your opponent's next turn`),
      ]);
    // §8.5/§11 — the attack-installed ATTACK-DAMAGE DEBUFF (D149). VICTIM voice,
    // and it is the first row in this family that is victim-side BY CONSTRUCTION:
    // `seat` owns the debuffed Pokémon (D136's finding 1) and this op has no self
    // arm, so the row ALWAYS renders under the actor's opponent's name.
    //
    // ⚠️ WHICH IS WHY THE WORDING IS NOT DAMAGE_REDUCTION_APPLIED's, AND THAT IS
    // THE SLICE'S THIRD VOICE ANSWER. That row one screen up ends "…during your
    // opponent's next turn" — the printed words — and they are honest there
    // because the row renders under the INSTALLER's name, whose opponent's turn it
    // really is. Copied here they would render under the VICTIM's name and name
    // the wrong turn: a player would read that their own Pokémon is weakened
    // during the OTHER player's turn, which is the one turn it is not. So the
    // phrasing is D143/`ATTACK_LOCKED`'s instead — "next turn", which under this
    // event family's seat rule always means the named player's own next turn, and
    // which is exactly the reading D148 showed makes a row seat-independent. A log
    // row is never spoken from the installer's chair; the difference from D148 is
    // that here the sibling wording is installer-voiced and would have LIED.
    //
    // The verb keeps the printed shape ("…'s attacks do {N} less damage") minus
    // the parenthetical, for DAMAGE_REDUCTION_APPLIED's reason: a player with the
    // card in front of them reads back the words on it, and the number is in the
    // wording because the number is the rule.
    case "ATTACK_DEBUFF_APPLIED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(`'s attacks do ${event.amount} less damage next turn`),
      ]);
    // §9/§11 — the attack-armed REACTIVE RECOIL (D152). ACTIVE voice for
    // DAMAGE_REDUCTION_APPLIED's reason verbatim: `seat` owns the armed Pokémon
    // AND that Pokémon is the actor's own (the op has no defender arm), so the
    // PRINTED "during your opponent's next turn" is honest here in a way it was
    // not one case up — that row renders under the VICTIM's name and had to say
    // "next turn" instead. Same family, same words, opposite answer, and the
    // difference is which seat the row is filed under.
    //
    // ⚠️ THE UNIT IS THE ONE THE PLAYER WILL SEE, NOT THE ONE THE CARD PRINTS.
    // The sentence says "10 damage counters" and this row says 100 damage,
    // because the COUNTERS_PLACED row it sets up on the next turn says 100 too —
    // a reader told "10" and then shown "100" cannot check the arithmetic they
    // are being shown, which is the very reason DAMAGE_REDUCTION_APPLIED puts its
    // number in the wording at all.
    //
    // The verb names the MECHANISM ("counterattack"), matching D141's
    // COUNTERS_PLACED label, so the arming row and the row it eventually produces
    // use the same word for the same thing.
    case "RECOIL_ARMED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(` will counterattack for ${event.amount} damage during your opponent's next turn`),
      ]);
    // §8.5/§11 — the attack-installed PER-ATTACK DAMAGE BUFF (D155). ACTIVE voice
    // for RECOIL_ARMED's reason verbatim: `seat` owns the boosted Pokémon AND that
    // Pokémon is the actor's own (the op has no defender arm).
    //
    // ⚠️ IT NAMES THE ATTACK BECAUSE THE BARE ROW WOULD BE FALSE, WHICH IS D154's
    // FINDING INHERITED RATHER THAN RE-DERIVED — and here the field is REQUIRED
    // where D154's is optional, because this op's single producer cannot print the
    // sentence without a name (events.ts). "<name> does 100 more damage next turn"
    // read off a card with two attacks would promise a bonus on both, and false in
    // the direction that makes a player declare the wrong one.
    //
    // "next turn" rather than the printed "During your next turn", for D148's
    // reason and ATTACK_LOCKED's: under this family's seat rule the phrase always
    // means the NAMED player's own next turn, which is exactly what the `+ 2` stamp
    // encodes. The verb keeps the printed shape ("does {N} more damage") minus the
    // parenthetical, for DAMAGE_REDUCTION_APPLIED's reason — a player with the card
    // in front of them reads back the words on it — and the number is in the
    // wording because the number is the rule: the row it sets up on the next turn
    // reports the same figure in `DAMAGE_DEALT.bonus`.
    case "ATTACK_BOOSTED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(`'s ${event.attack} does ${event.amount} more damage next turn`),
      ]);
    case "ATTACK_EFFECT_PREVENTED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(" prevented the effect of the attack"),
      ]);
    // D259 — the row one family over, and the noun is the whole difference: the
    // player reads back WHICH KIND of card just did nothing to their Pokémon,
    // because Rhyperior's sentence refuses Supporters and lets Items through and a
    // row that said only "the effect" would leave that unreadable.
    case "TRAINER_EFFECT_PREVENTED":
      return row(event.seat, [
        strong(cardName(state, event.uid)),
        plain(
          ` prevented the effect of the ${event.trainerType === "item" ? "Item" : "Supporter"}`,
        ),
      ]);
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
        case "attack":
          // D139 — an attack's own printed "Put {N} damage counters on your
          // opponent's Active Pokémon." (Mimikyu "Ghost Eye", Polteageist "Pour
          // Tea"). A SYSTEM row for the identical reason the two above are:
          // `seat` owns the DAMAGED Pokémon, which for an attack is the
          // attacker's OPPONENT, so an active-voice row under this seat would
          // read as the victim doing it to itself. The ACTOR is named by the
          // ATTACK_DECLARED row directly above — the same argument D136's finding
          // 1 used to make the mill row passive rather than to give it an actor
          // field. The verb is the PRINTED one, as "Moved:" is for the move.
          //
          // D140 gave this arm a SECOND producer and needed no new wording:
          // Ting-Lu ex "Land Scoop" puts its counters on a CHOSEN BENCHED body
          // rather than the Active, and every word here stays true — same printed
          // verb ("Put"), same seat (the opponent's, who owns the damaged
          // Pokémon), same reason for the system voice. `name` names WHICH
          // Pokémon, which is the only thing that differed.
          return row("system", [plain("Put: "), amount, plain(" damage onto "), strong(name)]);
        case "counterattack":
          // D141 — the §9 reactive recoil (Counterattack Quills, Custom Trap,
          // Rocky Helmet): counters put on the ATTACKING Pokémon because the body
          // it just hit strikes back. A SYSTEM row like the three above, and for a
          // reason of its own on top of theirs: `seat` here is the ATTACKER's (it
          // owns the DAMAGED Pokémon, which is the attacker) while the CAUSER is
          // the DEFENDER, so an active-voice row would credit the attacker with
          // damaging itself — the mirror image of D136's finding 1.
          //
          // The label names the MECHANISM, not the provenance, because the amount
          // is a SUM over the holder's passive and its Tools and can carry both at
          // once (Stunfisk + Rocky Helmet = 70 in one row). "Ability:" was what
          // this printed before 0.90.0, and it was simply false for a Tool. It is
          // deliberately NOT worded as "Recoil", which this event already uses for
          // `"self"` — an attacker damaging ITSELF with its own printed attack is
          // the opposite direction, and the two must not read alike.
          //
          // Nothing else announces this: the recoil emits no ABILITY_TRIGGERED row
          // (it is a passive, and for a Tool there is no Ability to trigger), so
          // unlike the `"ability"` arm above there is no row overhead naming the
          // source. This row is the entire explanation a reader gets.
          return row("system", [
            plain("Counterattack: "),
            amount,
            plain(" damage to "),
            strong(name),
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
    case "POKEMON_RETURNED": {
      // 🆕 D299 — a benched body left play without being Knocked Out. Attributed
      // to the ACTOR (CARD_TO_BOTTOM_OF_DECK's rule): on Illumise's printing the
      // seat that loses the Pokémon is not the seat that did it, and a row filed
      // under the owner would read as something they chose to do.
      //
      // NAMES THE POKÉMON AND COUNTS THE REST. Every card in `uids` was face up
      // in play a moment ago, so naming them would leak nothing — but the row
      // that matters is which BODY vanished, and a six-card list of Energy would
      // bury it. The count is what tells a player how much went with it.
      //
      // 🆕 D313 — THREE ZONES AND ONE SPLIT. The verb is the zone's own printed
      // verb ("shuffled" into a deck, "put" into a hand or a discard pile — the
      // `returnBenchedNote` rule that the destination picks the verb because the
      // printings do), and the noun spells "discard pile" rather than "discard",
      // which is the zone's name in §2 and not a field value read out loud.
      //
      // 🛑 **THE SPLIT ROW COUNTS THE ATTACHMENTS AND NOT THE PILE.** On Team
      // Rocket's Crobat ex the evolution stack goes to the HAND with the body and
      // only `attachmentsTo.uids` is discarded, so `uids.length - 1` — every other
      // card that left play — would over-count the discard by the whole Golbat and
      // Zubat underneath. The two branches therefore count DIFFERENT things, which
      // is why the split is a branch rather than an extra clause.
      const zone = event.dest === "discard" ? "discard pile" : event.dest;
      const verb = event.dest === "deck" ? "shuffled " : "put ";
      const split = event.attachmentsTo;
      if (split !== undefined) {
        const n = split.uids.length;
        return row(event.actor, [
          plain(verb),
          strong(cardName(state, event.uid)),
          plain(` into ${names[event.seat]}'s ${zone}`),
          plain(n > 0 ? ` and discarded ${n} attached card${n === 1 ? "" : "s"}` : ""),
        ]);
      }
      const extra = event.uids.length - 1;
      return row(event.actor, [
        plain(verb),
        strong(cardName(state, event.uid)),
        plain(extra > 0 ? ` and ${extra} attached card${extra === 1 ? "" : "s"}` : ""),
        plain(` into ${names[event.seat]}'s ${zone}`),
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
      return row("system", [strong(cardName(state, event.uid)), plain(" left play — replaced")]);
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
    case "PRIZE_REDUCED":
      // §8.1 — an on-KO Ability (Munkidori ex "Oh No You Don't") cut, rather than
      // denied, the Prize for the Knocked Out Pokémon. SYSTEM-voiced, and the
      // reason is NOT inherited from PRIZE_PREVENTED above even though the answer
      // matches: this row's `seat` owns the DYING Pokémon while the party the
      // sentence acts on is that seat's OPPONENT (they are the one taking fewer),
      // so an active voice under `seat` describes the wrong player's loss and one
      // under the opponent credits them with their own penalty. The ABILITY_TRIGGERED
      // row immediately above already names the Ability and its owner, so nothing
      // is lost by leaving the consequence unattributed.
      //
      // It states BOTH numbers because a decrement is only readable against the
      // face value — "1 fewer" alone leaves a player who does not know the card is
      // worth 2 unable to check the prize count they are about to see.
      return row("system", [
        strong(cardName(state, event.uid)),
        plain(
          ` — your opponent takes ${event.by} fewer Prize card${event.by === 1 ? "" : "s"} for it (${event.count} instead of ${event.count + event.by})`,
        ),
      ]);
    case "PRIZE_BONUS":
      // 🆕 §8.1 (D323) — a seat-wide Ability on the KILLING side (Togekiss "Wonder
      // Kiss" heads, Hydreigon ex "Greedy Eater") added Prize cards for this Knock
      // Out. SYSTEM-voiced for PRIZE_REDUCED's reason read from the other side:
      // this row's `seat` owns the DYING Pokémon while the party the sentence acts
      // for is that seat's OPPONENT, so an active voice under `seat` credits the
      // wrong player. The ABILITY_TRIGGERED row above already named the Ability and
      // its owner.
      //
      // Both numbers, for PRIZE_REDUCED's reason exactly: an increment is only
      // readable against the face value, and a player who does not know the dead
      // card was worth 2 cannot check the 3 they are about to take.
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
    case "RANDOM_CARD_TAKEN":
      // ⚠️⚠️ D232 — the random pick out of the opponent's hand. NAMED, and it is
      // the second row in this file (after HAND_REVEALED) that names a card which
      // was in a HIDDEN zone a moment ago — allowed for the same reason and by a
      // different route: the module header's rule is "never name a card that is
      // STILL hidden", and this one is not. The `discard` route puts it in the §2
      // public pile; the `deck` route is printed as a reveal ("Your opponent
      // reveals that card"), and the SHUFFLE row that follows is what takes its
      // position back.
      //
      // ⚠️ THE WORD "random" IS IN THE ROW ON PURPOSE. Without it this reads
      // exactly like a card the ACTOR chose, which is the other half of this
      // family (CARD_TO_BOTTOM_OF_DECK above) and a materially different thing to
      // have happened to you — the log is the only place a player can tell the
      // two apart after the fact.
      //
      // Filed under the ACTOR (the ENERGY_DISCARDED / CARD_TO_BOTTOM_OF_DECK
      // rule) with the owner named OUTRIGHT rather than by a possessive, so a
      // mirror match cannot print an identical row from both seats.
      return row(event.actor, [
        plain("took "),
        strong(cardName(state, event.uid)),
        plain(
          event.to === "discard"
            ? ` at random from ${names[event.seat]}'s hand and discarded it`
            : ` at random from ${names[event.seat]}'s hand and shuffled it into their deck`,
        ),
      ]);
    case "DECK_SEARCHED": {
      // ⚠️ D225 — THE THREE ENDINGS ARE A DESTINATION AND A PRINTED CLAUSE, AND
      // ONLY ONE OF THEM IS AN INFORMATION DECISION.
      //   • bench — count only, and nothing is hidden by it: the card enters PLAY
      //     face up and is in both players' snapshots a moment later. This is the
      //     one destination D42's "public by construction" claim was true of, and
      //     no printed bench search carries the word "reveal" anyway.
      //   • hand + `reveal` — the printed "reveal it/them". NAMED, because in
      //     paper the opponent sees the cards, and until D225 they saw a number.
      //   • hand, no `reveal` — count only, DELIBERATELY. Cassiopeia, Amulet of
      //     Hope, Greninja ex and the rest search for uncategorised "cards" and
      //     print no reveal; naming those would leak a hand the print keeps
      //     private. The flag is the SENTENCE, never the destination.
      // 🆕 D342 — the FOURTH ending, and it joins the count-only side of the
      // split above for the strongest version of its reason: `"deckTop"` puts
      // the cards back into the DECK, so naming them would announce the very
      // draws the sentence was played to arrange. No printing of it carries a
      // reveal, and if one ever did the branch below would already be right.
      const n = event.uids.length;
      if (event.dest === "bench") {
        return row(event.seat, [plain(`searched their deck — benched ${n} Pokémon`)]);
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
      // The §7.1 recovery Items (Energy Retrieval / Pal Pad / Super Rod); only
      // fires with ≥1 card (a "take none" moves nothing and emits no event). The
      // discard pile is public, so a count would suffice, but it reads clearer
      // as an action row like DECK_SEARCHED.
      //
      // ⚠️⚠️ D237 — A **THIRD** ARM, AND ITS ABSENCE WOULD HAVE BEEN A LIVE
      // MIS-RENDER RATHER THAN A GAP. This row was a BINARY ternary on
      // `dest === "hand"`, so the new Bench destination would have fallen into
      // the `else` and announced a Pokémon entering play as *"shuffled 3 cards
      // from their discard pile into their deck"* — a log row stating the
      // opposite of what the board shows. A ternary whose false branch names one
      // specific outcome is a total function only until the union widens.
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
      // Great Ball / Pokégear 3.0 / Tatsugiri (lookAtTopN); only fires with ≥1
      // taken card (a "take none" moves nothing and emits no event). Honest about
      // "looked at the top" rather than DECK_SEARCHED's "searched their deck"; a
      // trailing SHUFFLE row follows either ending.
      //
      // ⚠️ D225 — THE OLD COMMENT HERE SAID "count only, EVEN THOUGH the taken
      // cards are revealed … the row reads cleaner", which conceded the leak and
      // called it typography. It was also arguing from a premise that does not
      // hold: `lookAtTopN` is not a reveal op, it is a LOOK op, and Explorer's
      // Guidance / Hassel / Drakloak all put looked-at cards into hand with no
      // reveal printed. So the same rider decides it as on DECK_SEARCHED — named
      // when the sentence prints "you may reveal a … you find there", a count
      // when it does not.
      //
      // ⚠️⚠️ D241 — TWO THINGS CHANGED AND THE SECOND IS THE FIDELITY FIX.
      //   • The DESTINATION now rides the event, so the row stops asserting
      //     "in hand" about a look that BENCHED or DISCARDED. That is exactly
      //     `DISCARD_RETRIEVED`'s D237 defect one op over: a binary render is a
      //     live mis-statement the moment the op grows a third destination.
      //   • The EMPTY row exists, and it is the whole reason this arm was on the
      //     backlog. A look that took nothing used to emit no event at all, so
      //     the opponent never learned that the top of a deck had been read. The
      //     cards went back under a shuffle, but the KNOWLEDGE did not, and the
      //     log is the only channel that can say so (the `chooseCards` prompt is
      //     resolved to the answerer alone by construction — `redact.ts`).
      const n = event.uids.length;
      const where =
        event.dest === "bench"
          ? "onto their Bench"
          : event.dest === "discard"
            ? "in the discard pile"
            : "in hand";
      if (n === 0) {
        // No `reveal` branch: a printed "you may reveal a … you find there" that
        // took nothing revealed nothing, so the rider has no cards to name and
        // the two renders would be the same sentence.
        return row(event.seat, [plain("looked at the top of their deck — took nothing")]);
      }
      if (event.reveal !== true) {
        return row(event.seat, [
          plain(`looked at the top of their deck — put ${n} card${n === 1 ? "" : "s"} ${where}`),
        ]);
      }
      return row(event.seat, [
        plain("looked at the top of their deck — revealed "),
        strong(countedNames(event.uids.map((uid) => cardName(state, uid)))),
        plain(` and put ${n === 1 ? "it" : "them"} ${where}`),
      ]);
    }
    case "DECK_TOP_DISCARDED": {
      // THREE push sites, FOUR paths, and the paths — not the sites — are what the
      // wording has to survive (D113's rule: reuse the event, fix the message so it
      // cannot lie). The old copy here said "THREE producers" and then listed two,
      // which is the miscount that made a single wording look sufficient:
      //   • Hydreigon "Tri Howl" (attachFromTop `restTo: "discard"`, 🆕 D352 — was
      //     `discardRest`) — the looked-at
      //     cards that were NOT attached, off the actor's OWN deck. actor === seat.
      //   • 🆕 D334 — Explorer's Guidance (lookAtTopN `restTo: "discard"`) — the same
      //     printed clause one op over: the looked-at cards a MANDATORY take did
      //     not take, off the actor's OWN deck. actor === seat.
      //   • the mill (discardDeckTop, D130 + D131) — "Discard the top N cards of
      //     your [opponent's] deck", and its `whose` field is a FORK, not a
      //     parameter: `"self"` (Gyarados "Wild Splash") is actor === seat, and
      //     `"opponent"` (Chi-Yu ex, Skwovet, Wugtrio) is actor !== seat.
      // So the four paths split 3–1 on agency, and NOT along the op boundary —
      // which is why "one wording per op" would not have helped either. 🆕 AND
      // D334's PATH ARRIVED WITHOUT TOUCHING A LINE OF THIS ARM, which is the
      // strongest evidence the `actor === seat` key was the right one: a per-op
      // flag would have owed a third case for a row whose voice was already decided.
      //
      // The old copy said "discarded N LOOKED-AT cards", which is true of the
      // first and a flat lie about the rest: nobody looked at a milled card.
      // The "looked-at" flavour is not lost — Tri Howl's own DECK_TOP_REVEALED and
      // ENERGY_ATTACHED rows sit directly above this one and carry it, which is
      // exactly why this row never needed to.
      //
      // Count only, like its DECK_TOP_REVEALED sibling: the pile is public, so a
      // curious player can read the cards themselves, and what the LOG has to
      // carry is that the cards LEFT THE DECK. `event.seat` is the deck's OWNER on
      // every path, so the row belongs to the player who lost them — a mill
      // reads as the opponent's row, which is what it is.
      //
      // ⚠️ AND THE VOICE IS THEN FORCED, PATH BY PATH (D153). Every row here renders
      // after its seat's name, so the voice is an assertion about agency even though
      // no segment names an actor: ACTIVE says this seat DID it, PASSIVE says it was
      // done TO them. D136 found active lying about the opponent-mill ("P2 discarded
      // 2 cards from the top of their deck" credits the milling to the victim) and
      // made the one wording passive; `/code-review` then found the mirror, because
      // passive lies about the two SELF paths — a player who looked at their own top
      // three and discarded the leftovers, or who paid Wild Splash's own-deck cost,
      // DID that, and "Ember had 5 cards discarded from the top of their deck" reads
      // as though an opponent had done it to them. There is no third wording that is
      // true of both: "the cards left the deck" is a fact both paths share, but the
      // row is grammatically a predicate on a named player and English has no voice
      // that declines to say whether that player acted.
      //
      // D136 priced ENERGY_DISCARDED's `actor` field and declined it because "this
      // row never names the actor anyway". That was the wrong test — the question is
      // not whether the row NAMES an actor but whether it ASSERTS one, and both
      // voices do. So the field is taken after all, and the renderer picks by the ONE
      // comparison the producers know and it does not: `formatEvent` sees a single
      // event with `names`/`state`/`elapsed` and no notion of whose turn it is, so
      // "compare against the acting seat" is not available here without the datum
      // riding the event. The self-mill is what makes the comparison the honest key
      // rather than a per-op flag: it is the same op as the mill and belongs on the
      // other side of the line.
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
    case "DECK_TOP_REORDERED": {
      // 🆕 D341 — `reorderTop`'s only row (Iron Valiant "Calculation"; Dottler /
      // Gothorita on the OPPONENT's deck).
      //
      // COUNT ONLY, and here — unlike its DECK_TOP_DISCARDED sibling directly above
      // — that is a confidentiality rule and not a convenience. That row is count
      // only because the discard pile is public and a curious player can read the
      // cards themselves; these cards went back into a DECK, and on three of the
      // four printings the player who must not see them is the deck's own owner.
      // Naming them here would hand back, in the open, exactly the knowledge the
      // card bought for one side.
      //
      // ⚠️ THE VOICE IS FORCED BY THE SAME `actor === seat` COMPARISON, inherited
      // rather than re-decided: `event.seat` is the deck's OWNER, so the own-deck
      // printing must read ACTIVE (that player did it) and the opponent-deck
      // printings must read PASSIVE (it was done to them). D153's finding, and this
      // op is the first one for which BOTH voices are reachable from the printed
      // text rather than from a field — which is why the field is on the event.
      //
      // ⚠️ AND THE ROW SAYS "looked at", WHICH IS THE FACT IT IS FOR. The ordering
      // itself is unobservable to everyone but the looker (the deck is face down
      // before and after); what the other player is owed, and the whole reason this
      // event fires on the paths that never park, is that their deck top was READ.
      // D241's rule on DECK_TOP_REVEALED, applied to an op that moves nothing at all.
      //
      // 🆕 D343 — `end: "bottom"` (Kofu) RENDERS A DIFFERENT SENTENCE, NOT THE
      // SAME ONE WITH A WORD SWAPPED, because on that fork BOTH halves of the top
      // phrasing are false. There was no "looked at" — the ordering seat put those
      // cards under their own deck out of their own hand one op earlier — and
      // there was no "put them BACK", since they were never there. What is true,
      // and is the whole of what the other player is owed, is that the ORDER of
      // the cards that just went under was chosen rather than incidental. The
      // top arms keep every word they had.
      const n = event.count;
      const cards = `${n} card${n === 1 ? "" : "s"}`;
      if (event.end === "bottom") {
        return row(event.seat, [plain(`chose the order of the bottom ${cards} of their deck`)]);
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
      // 🆕 D344 — `bottomDeckTop`'s only row (Deduction Kit `sv08-171`, the
      // printed second arm of its `or`).
      //
      // COUNT ONLY, and for a THIRD reason after the two rows above: the discard
      // row withholds nothing (the pile is public), the reorder row withholds the
      // cards so the deck's owner cannot read their own top — and here the cards
      // go hidden → hidden AND are shuffled, so the order is unknown to everyone
      // including the player who just looked at them.
      //
      // ⚠️ ACTIVE VOICE WITH NO `actor` COMPARISON TO MAKE, unlike both rows
      // above: the op reads the controller's own deck and has no side fork, so
      // the only voice this row can be in is the one that is always true. The day
      // a printing bottoms an OPPONENT's top, the field and the second voice are
      // bought together (D135, and DECK_TOP_REVEALED's own precedent).
      //
      // ⚠️ AND IT SAYS "shuffled … to the bottom" RATHER THAN "shuffled their
      // deck", which is the fact the other player actually needs: the deck's
      // order below the window is untouched, so the draws that were coming are
      // still coming. A `SHUFFLE` row here would say the opposite.
      const n = event.count;
      const cards = `${n} card${n === 1 ? "" : "s"}`;
      return row(event.seat, [
        plain(`shuffled the top ${cards} of their deck to the bottom of it`),
      ]);
    }
    case "ENERGY_MOVED": {
      // Energy Switch / Poppy (moveEnergy) — moved own-board Energy between two of
      // the player's Pokémon. `to` names a Pokémon that stayed put (no compaction),
      // so targetName resolves it off the post-state.
      //
      // ⚠️ THE SOURCE IS NAMED BY UID WHEN THE EVENT CARRIES ONE (D171). Exp. Share
      // moves Energy off a body the same reduction then Knocks Out, so the SPOT is
      // no longer a way to name it: on a board that auto-promotes, `{spot:"active"}`
      // resolves to the Pokémon that replaced it and the row credits the wrong
      // Pokémon. `cardName` reads `cardIdByUid`, which the KO does not touch — the
      // same route KNOCKED_OUT uses to name a card that has left play. The spot is
      // kept as the fallback for any producer that predates the uid.
      const n = event.uids.length;
      const source =
        event.fromUid === undefined
          ? targetName(state, event.seat, event.from)
          : cardName(state, event.fromUid);
      return row(event.seat, [
        plain(`moved ${n} energy from `),
        strong(source),
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
      //
      // 🆕 **D295 — `to` CHANGES THE VERB AND THE TAIL, NOT THE NAMING RULE.**
      // Absent = the pile (every row before this slice, byte-identical). `"hand"`
      // is Chill Teaser Toy `sv08-166`, and the row still NAMES the Energy: it
      // was attached and therefore public a moment before it moved, so the
      // opponent watched it go — the same reasoning RANDOM_CARD_TAKEN uses to
      // name a card that has stopped being hidden, applied to one that had not
      // started. The OWNER is named outright in the tail for the possessive
      // reason spelled out above; "into their hand" would be ambiguous in a
      // mirror match exactly as "from their Pokémon" was.
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
