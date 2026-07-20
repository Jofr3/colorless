// The effect-op vocabulary (D8's "primitive ops authored as data") and the
// conservative text→ops deriver. M3 shipped the first sliver — status/heal
// ops derived from exact attack sentences. M4 grows the union with the board
// and deck ops that Trainers and Abilities need (draw, search, switch, gust,
// heal-a-chosen-Pokémon) and moves EXECUTION into a shared, resumable
// interpreter (interpreter.ts) that both attacks and card plays run through.
//
// This module stays PURE data: the op union (below) plus `deriveAttackEffect`
// (printed text → ops, unchanged from M3). It knows nothing about GameState —
// interpreter.ts owns every state transition and the mid-effect decision
// parking. Registry-authored programs (registry.ts) are the same op arrays,
// just hand-written instead of text-derived, and sit ABOVE the deriver at the
// one attack call site (`programFor(id).attack ?? deriveAttackEffect(text)`).

import type { StatusName } from "./events";

/** A declarative card predicate for deck searches (§15.E). Deliberately tiny
    — the representative cards need only "a Basic Pokémon", "any Pokémon", "a
    Basic Energy [of a type]" and "a card named X"; the union grows one entry
    per new shape. */
export type CardFilter =
  | { kind: "basicPokemon" }
  | { kind: "anyPokemon" }
  /** A basic Energy card; `energyType` (a BASIC_ENERGY_TYPES member) narrows
      it to one type (Chien-Pao's "Basic {W} Energy"), else any basic energy. */
  | { kind: "basicEnergy"; energyType?: string }
  /** A card matched by exact NAME (Flamigo's "Insta-Flock" searches its own
      copies — "search your deck for up to 3 Flamigo"). */
  | { kind: "byName"; name: string }
  /** A Supporter Trainer card (Pal Pad shuffles Supporters from the discard
      pile back into the deck). */
  | { kind: "supporter" }
  /** A Pokémon OR a Basic Energy card — Super Rod's "any combination of Pokémon
      and Basic Energy cards" (a basic Energy is `energyType: "Normal"`; a
      Special Energy is excluded). */
  | { kind: "pokemonOrBasicEnergy" }
  /** Any Energy card — Basic OR Special (Poppy "Move up to 2 Energy", which
      unlike Energy Switch's "a Basic Energy" moves either kind). Distinct from
      `basicEnergy` (basics only) and `pokemonOrBasicEnergy` (which excludes
      Special Energy and admits Pokémon). */
  | { kind: "anyEnergy" };

/** How many cards a `handRefresh` draws AFTER the hand goes into the deck.
    `fixed` draws a constant (Youngster 5, Judge 4, Katy 8); `handPlus` draws the
    pre-shuffle hand size plus `delta` (Brassius "draw that many cards plus 1" =
    delta 1), measured per affected player BEFORE their hand is shuffled in. */
export type HandRefreshDraw =
  | { kind: "fixed"; count: number }
  | { kind: "handPlus"; delta: number };

/** One effect operation — the engine's instruction set (D8). Attack-derived
    programs use the first three (targets are relative to the attacker: "self"
    = the attacker's Active, "defender" = the Defending Pokémon); Trainer /
    Ability programs use the rest (targets relative to the controller — the
    seat playing the card — resolved by the interpreter). The whole union is
    JSON-safe so a parked program (interpreter.ts) serializes into the phase. */
export type EffectOp =
  // — Attack ops (M3), attacker-relative. —
  | {
      op: "applyStatus";
      target: "defender" | "self";
      status: StatusName;
      /** Only for "poisoned": HP placed per Checkup when raised above 10. */
      poisonDamage?: number;
    }
  | { op: "heal"; target: "self"; amount: number }
  /** Heal `amount` HP from EACH of the controller's own in-play Pokémon
      (Garganacl "Blessed Salt" — a between-turns triggered Ability). No target
      choice, so it never parks; one HEALED per Pokémon that actually healed. */
  | { op: "healEach"; amount: number }
  /** Place `amount` HP of damage on the OPPONENT's Active Pokémon (Trevenant
      "Forest Miasma" — 1 damage counter between turns). A COUNTER placement,
      not attack damage: no Weakness/Resistance (§8.5), emitted as
      COUNTERS_PLACED source "ability". Never parks; can KO — the caller sweeps
      (the Checkup's KO sweep does, flow.ts). */
  | { op: "damageActive"; amount: number }
  /** Spread damage (§8.5): place `amount` HP of damage on EACH of the
      opponent's Benched Pokémon. Weakness/Resistance NEVER apply to Benched
      Pokémon, so this is flat. A SECONDARY damage clause, distinct from the
      attack's main numeric damage; the interpreter only PLACES it (one
      DAMAGE_DEALT per benched Pokémon) — the Knock Out check runs afterwards in
      the attack epilogue (attack.ts finishAttack), which sweeps the whole
      board, so the interpreter still never KOs or touches the flow tail. This
      is what the M4 KO generalization off the Active exists to reach. */
  | { op: "spreadDamage"; target: "opponentBench"; amount: number }
  /** Put `amount` HP of damage counters on `count` CHOSEN Benched Pokémon of
      the opponent (Hawlucha "Flying Entry" — 2 × 1 counter; Meowscarada ex
      "Bouquet Magic" — 1 × 3 counters). "Put damage counters" is NOT attack
      damage: no Weakness/Resistance AND no reduction passive — a counter placed
      by an Ability is flat (the same rule damageActive / the poison-burn ticks
      follow), so this is distinct from spreadDamage (an attack's damage, which
      Bouffer reduces). PARKS on a multi-Pokémon choice (choosePokemonMulti, up
      to `count`) when the opponent has MORE than `count` Benched Pokémon; hits
      all of them when the Bench holds `count` or fewer (forced — "choose 2" with
      2 available is both), and is a no-op with an empty opponent Bench. Only
      raises damage; the Knock Out check runs in the CALLER'S sweep (flow.ts
      settleProgram → resolveMidTurnKnockOuts), a MID-TURN KO that resumes the
      actor's turn — so this, like every op, never KOs or touches the flow tail. */
  | { op: "damageChosen"; target: "opponentBench"; amount: number; count: number }
  /** "Flip a coin. If heads, …" — `then` runs on heads only. */
  | { op: "coinFlipGate"; then: EffectOp[] }
  // — Trainer / Ability ops (M4), controller-relative. —
  /** Draw `count` from the top of the controller's deck (short-draws when the
      deck is shallower — §14.3 deck-out is a turn-START rule only). */
  | { op: "drawCards"; count: number }
  /** Discard the controller's whole hand (Professor's Research precedes a draw). */
  | { op: "discardHand" }
  /** Shuffle the controller's deck (the tail of every search). */
  | { op: "shuffleDeck" }
  /** Search the controller's deck for up to `max` cards matching `filter` and
      move them to `dest`. "Up to" — the player may take fewer (or none), so
      this PARKS on a card choice unless the deck holds no candidate. */
  | { op: "searchDeck"; filter: CardFilter; dest: "bench" | "hand"; max: number }
  /** Switch the controller's Active with one of their Benched Pokémon (§G).
      PARKS on the bench choice unless exactly one is benched. */
  | { op: "switchActive" }
  /** Gust: switch one of the OPPONENT's Benched Pokémon into their Active spot
      (Boss's Orders). PARKS on the opponent-bench choice unless forced. */
  | { op: "gust" }
  /** Heal from one of the controller's own in-play Pokémon: `amount` HP, or
      `"all"` its damage (Potion heals 30; Arboliva's "Enriching Oil" heals
      all). PARKS on the target choice unless only the Active is in play. */
  | { op: "healChosen"; amount: number | "all" }
  /** Attach ONE Basic Energy from a SOURCE zone (the controller's hand or
      discard pile) to a CHOSEN own in-play Pokémon — the §6 energy-acceleration
      Ability family (Quaquaval "Energy Carnival" from hand; Baxcalibur "Super
      Cold" a {W} from hand). `energyType` restricts it to a Basic Energy of that
      type (undefined = any Basic Energy). Same-type Basic Energy cards are
      fungible, so the ONLY decision is the TARGET: this PARKS on a choosePokemon
      unless exactly one Pokémon is in play, and a source holding no matching
      Energy is a no-op (programPlayable also blocks activating an Ability that
      could only whiff). Single-energy — MULTI-attach ("attach up to N in any way
      you like", Koraidon "Dino Cry") is just N of these ops in one program: the
      interpreter parks on each attach's target in turn, and an op finding no more
      matching Energy no-ops, so the program attaches min(N, available) — the
      "may attach fewer" is auto-maxed (pure-upside, the auto-take doctrine). The
      deck-search / look-at-top-N sources layer later ops on this primitive.

      Riders: `targetType` restricts the eligible targets to the controller's own
      Pokémon whose top card is that type ({P}/{F}); `basicOnly` further requires
      the target be a Basic Pokémon (Koraidon's "your Basic {F} Pokémon");
      `bonusCounters` puts that many HP of damage counters on the Pokémon just
      attached to (Gardevoir's 2 = 20); `notIfKO` excludes any target the
      bonusCounters would Knock Out ("can't use on a Pokémon that would be Knocked
      Out"), so the placed counters are always non-lethal — this op never KOs. */
  | {
      op: "attachEnergyFrom";
      source: "hand" | "discard";
      energyType?: string;
      targetType?: string;
      basicOnly?: true;
      bonusCounters?: number;
      notIfKO?: true;
    }
  /** Retrieve up to `max` cards matching `filter` from the controller's DISCARD
      pile into `dest` (their hand or their deck) — the §7.1 recovery-Item family
      (Energy Retrieval: 2 Basic Energy → hand; Pal Pad: 2 Supporters → deck;
      Super Rod: 3 Pokémon/Basic Energy → deck). The discard-pile mirror of
      `searchDeck`: like it this is "up to" (the player may take fewer, or none),
      so it PARKS on the SAME chooseCards prompt unless the discard holds no
      candidate (then it is a no-op). `dest: "deck"` appends the returned cards to
      the deck — the printed "Shuffle … into your deck" is this op followed by a
      `shuffleDeck` op (the Nest Ball search-then-shuffle authoring pattern), so a
      whiffed retrieval still shuffles, exactly as a whiffed search does.
      `dest: "hand"` just appends to hand. Reuses resolveEffect's chooseCards
      validation and, for the deck destination, the one vetted `shuffleDeck`.

      AUTHORING NOTE: `playTrainer` discards the played card UP FRONT (before its
      program runs), so a card whose own `filter` MATCHES ITSELF would offer
      itself as a retrieval candidate. Every card in scope is an Item retrieving
      Energy/Pokémon/Supporters, so none self-matches — but a future Supporter
      authored with `filter: {kind:"supporter"}` (or a card retrieving its own
      category) would need the played uid excluded first. */
  | { op: "discardPileRetrieval"; filter: CardFilter; dest: "hand" | "deck"; max: number }
  /** Look at the top `n` cards of the controller's deck and put up to `max`
      matching `filter` into their HAND (Great Ball: top 7, a Pokémon; Pokégear
      3.0: top 7, a Supporter — "you may reveal … and put it into your hand").
      The top-of-deck twin of `searchDeck`: like it this is "up to" (the player
      may take fewer, or none), so it PARKS on the SAME chooseCards prompt — but
      the candidates are only the cards matching `filter` among the top `n` (in
      current deck order; index 0 is the top), NOT the whole deck. An empty top-`n`
      match is a no-op. "Shuffle the other cards back into your deck" is NOT part
      of this op — it is the trailing `shuffleDeck` op (the Nest Ball
      search-then-shuffle authoring pattern), so a whiff still shuffles, exactly
      as a whiffed search does. The taken cards are revealed (public) — the printed
      "reveal" — so naming them (DECK_TOP_REVEALED) leaks nothing the opponent
      would not see in paper. Reuses resolveEffect's chooseCards validation (the
      candidate set is the top-`n` matches, so a client cannot reach a deeper card)
      and the one vetted `shuffleDeck`. */
  | { op: "lookAtTopN"; n: number; filter: CardFilter; max: number }
  /** Move up to `max` Energy from ONE of the controller's own in-play Pokémon
      to ANOTHER of their own in-play Pokémon — the §6 manual Energy-movement
      family (Energy Switch: a Basic Energy; Poppy: up to 2 any Energy). `filter`
      narrows which Energy may move (`basicEnergy` / `anyEnergy`). BOTH the taken
      Energy AND the destination are the player's choice, and every taken Energy
      comes from the SAME source Pokémon (the printed "from 1 of your Pokémon to
      another"), so this is the interpreter's first op with two COUPLED decisions:
      it PARKS on a compound `moveEnergy` prompt (the movable Energy tagged by its
      source Pokémon + the eligible destinations) and applies ATOMICALLY on resolve
      — a half-moved Energy (detached but not re-attached) is never a resting state,
      so it never splits across two parks. "Up to"/declinable like searchDeck: the
      player may move none. Not playable (programPlayable) when no Energy matches or
      the controller has fewer than two Pokémon in play (no distinct destination) —
      a play that could only whiff. Own→own only; the fixed-endpoint / opponent-side
      / from-provided-type riders (Armarouge's benched→Active {R}, Mismagius's
      opponent move) layer on later. */
  | { op: "moveEnergy"; filter: CardFilter; max: number }
  /** Shuffle the affected player(s)' whole hand into their deck, then draw — the
      Iono/Judge/Marnie hand-refresh Supporter family. `who: "you"` affects the
      controller only (Youngster: draw 5; Katy: draw 8; Brassius: draw hand+1);
      `who: "both"` affects BOTH players (Judge: "Each player shuffles their hand
      into their deck and draws 4") — the first op to reach the OPPONENT's
      hand/deck. `draw` is how many each affected player then draws, measured off
      THAT player's OWN pre-shuffle hand (handPlus). Fully AUTOMATIC — there is no
      decision, so it never parks (like drawCards / discardHand / shuffleDeck), and
      it is always playable (you may always shuffle-and-draw, even from an empty
      hand). The rng reorder is intrinsic (the combined pile is shuffled — there is
      no separate `shuffleDeck` op). Emits count-only events
      (HAND_SHUFFLED_INTO_DECK per affected seat + CARDS_DRAWN from the draw): a
      shuffled or drawn card is hidden, so the opponent — and, for the both-player
      Judge, the controller about the opponent — learns only counts. "Your turn
      ends" (Katy) is NOT part of this op: it is the CardProgram `trainerEndsTurn`
      flag folded by settleProgram (the Koraidon `endsTurn` precedent, on the
      Trainer path). Own-deck reshuffle-and-draw only; the bottom-of-deck /
      prize-count-draw variants (Iono, Marnie) layer on later. */
  | { op: "handRefresh"; who: "you" | "both"; draw: HandRefreshDraw };

type StatusWord = "Asleep" | "Burned" | "Confused" | "Paralyzed" | "Poisoned";

const STATUS_OF_WORD: Record<StatusWord, StatusName> = {
  Asleep: "asleep",
  Burned: "burned",
  Confused: "confused",
  Paralyzed: "paralyzed",
  Poisoned: "poisoned",
};

// The five recognized sentence shapes, anchored end to end and compiled once
// (no /g flag — exec is stateless, so module scope is safe). Catalog rows use
// the straight apostrophe ("opponent's"); the character class also admits
// the typographic one so a re-ingest changing only punctuation cannot
// silently un-derive every status attack. {X} = the five status words;
// {N} = a positive integer.
const STATUS_WORDS = "Asleep|Burned|Confused|Paralyzed|Poisoned";
// SELF-inflicted statuses deliberately EXCLUDE Paralyzed. Official timing
// (ptcg-rules.md §12/§13.4): paralysis recovers at the Checkup after its
// owner's next turn — only if it was Paralyzed since the BEGINNING of that
// turn. Paralysis applied by the owner's own attack (i.e. at their own
// turn's end) must therefore SURVIVE the immediately-following Checkup, but
// the engine's §13.4 clear is unconditional for the ended seat (correct for
// every opponent-inflicted case). Until the condition carries an
// applied-this-turn stamp, self-paralyzing text derives to null and stays on
// the loud ATTACK_EFFECT_SKIPPED path.
const SELF_STATUS_WORDS = "Asleep|Burned|Confused|Poisoned";
const DEFENDER_NOW = new RegExp(`^Your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`);
const FLIP_DEFENDER_NOW = new RegExp(
  `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${STATUS_WORDS})\\.$`,
);
const SELF_NOW = new RegExp(`^This Pokémon is now (${SELF_STATUS_WORDS})\\.$`);
const SELF_SLEEP_HEAL = /^This Pokémon is now Asleep\. Heal (\d+) damage from it\.$/;
const DEFENDER_POISON_N =
  /^Your opponent['’]s Active Pokémon is now Poisoned\. During Pokémon Checkup, put (\d+) damage counters on that Pokémon instead of 1\.$/;
// Spread damage — the whole effect sentence, with the era's optional
// "(Don't apply Weakness and Resistance for Benched Pokémon.)" clarifier
// (§8.5 makes it true regardless). The main numeric damage rides the attack's
// own `damage` field; this clause is the secondary hit on the Bench.
const SPREAD_EACH_BENCH = new RegExp(
  `^This attack does (\\d+) damage to each of your opponent['’]s Benched Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);

/** Parse printed attack text into executable ops, or null when the text is
    ANYTHING but one of the five recognized whole sentences (leading/trailing
    whitespace excepted) — null keeps the attack on the skipped-effect path. */
export function deriveAttackEffect(text: string): EffectOp[] | null {
  const effect = text.trim();

  // 1. "Your opponent's Active Pokémon is now {X}."
  let match = DEFENDER_NOW.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "defender", status: statusOf(match[1]) }];
  }

  // 2. "Flip a coin. If heads, your opponent's Active Pokémon is now {X}."
  match = FLIP_DEFENDER_NOW.exec(effect);
  if (match !== null) {
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: statusOf(match[1]) }],
      },
    ];
  }

  // 3. "This Pokémon is now {X}." — {X} excludes Paralyzed (see
  //    SELF_STATUS_WORDS: the §13.4 self-paralysis timing gap).
  match = SELF_NOW.exec(effect);
  if (match !== null) {
    return [{ op: "applyStatus", target: "self", status: statusOf(match[1]) }];
  }

  // 4. "This Pokémon is now Asleep. Heal {N} damage from it."
  match = SELF_SLEEP_HEAL.exec(effect);
  if (match !== null) {
    return [
      { op: "applyStatus", target: "self", status: "asleep" },
      { op: "heal", target: "self", amount: Number(match[1]) },
    ];
  }

  // 5. "Your opponent's Active Pokémon is now Poisoned. During Pokémon
  //    Checkup, put {N} damage counters on that Pokémon instead of 1."
  match = DEFENDER_POISON_N.exec(effect);
  if (match !== null) {
    // Counters → HP (one counter = 10, §12).
    return [
      {
        op: "applyStatus",
        target: "defender",
        status: "poisoned",
        poisonDamage: Number(match[1]) * 10,
      },
    ];
  }

  // 6. "This attack does {N} damage to each of your opponent's Benched
  //    Pokémon." — the spread hit that the M4 KO generalization reaches (a
  //    benched Pokémon can now be Knocked Out). `damage` is HP, not counters.
  match = SPREAD_EACH_BENCH.exec(effect);
  if (match !== null) {
    return [{ op: "spreadDamage", target: "opponentBench", amount: Number(match[1]) }];
  }

  return null;
}

/** The matched status word, lowercased into the event vocabulary. The regex
    alternation guarantees the word; the fallback only satisfies
    noUncheckedIndexedAccess. */
function statusOf(word: string | undefined): StatusName {
  return STATUS_OF_WORD[(word ?? "Asleep") as StatusWord];
}
