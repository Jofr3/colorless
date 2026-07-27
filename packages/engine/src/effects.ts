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

import { BASIC_ENERGY_TYPES, type BasicEnergyType } from "@luminous/schema";
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
  | { kind: "anyEnergy" }
  /** A SPECIAL Energy card (§6.1 — the catalog's `energyType: "Special"`), the
      exact complement of `basicEnergy` inside `anyEnergy`. The energy-removal
      family's narrow arm: Giacomo and Mawile discard "a Special Energy", where
      Crushing Hammer takes any. */
  | { kind: "specialEnergy" }
  /** An Energy that PROVIDES `energyType` (§6.3) — the printed "{L} Energy" of
      the typed energy-removal and energy-movement families (Kilowattrel
      "Discard a {L} Energy", Arcanine ex "Discard 2 {R} Energy", the swsh-era
      spelled-out "a Fire Energy"; Armarouge's "move a {R} Energy"). Two things
      make it its own kind rather than a rider on `basicEnergy`:

      **PROVISION, NOT PRINT.** "{L} Energy" is not "a Basic Lightning Energy
      card" — a Special Energy that provides {L} IS one for this purpose, and a
      Special providing only {C} is not, however Lightning-flavoured its art. So
      the predicate reads what the card GIVES on the board, which is exactly what
      §8.2's cost matcher reads (continuous.ts `providedEnergy`); the two must
      agree or a Pokémon could pay {L} with an Energy that "isn't {L}" when the
      same attack tries to discard it. A WILDCARD provider matches every type
      (Luminous Energy: "provides every type of Energy but only 1 at a time" —
      the same ANY_ENERGY unit that fills any typed cost slot).

      **IN-PLAY ONLY, and HOST-DEPENDENT.** Provision is a while-ATTACHED
      property ("As long as this card is attached to a Pokémon, it provides…"),
      and for Luminous it depends on the holder's OTHER attachments — the same
      card provides every type alone and only {C} beside another Special Energy.
      A card is therefore not enough to answer this filter: `attachedEnergies`
      (interpreter.ts) evaluates it per Energy ON ITS HOST, and the card-only
      `matchesFilter` — the deck / hand / discard scanner behind searchDeck,
      lookAtTopN and discardPileRetrieval — answers **false** for it, because a
      card in a pile is attached to nothing and provides nothing. Authoring it
      into a pile-scanning op is therefore a loud no-op, never a wrong match; use
      `basicEnergy` with an `energyType` for those (the printed "Basic {G} Energy
      CARD from your hand" really is about the print).

      `energyType` is a **`BasicEnergyType`**, not a bare string, so the one value
      this filter must never carry is UNREPRESENTABLE rather than merely forbidden
      by this comment (the `count?: never` precedent). Colorless is deliberately
      not a member (§6.1): it is a cost symbol, no card prints "discard a {C}
      Energy", and admitting it would be actively wrong — Colorless is the
      conservative provision FALLBACK for every unauthored Special Energy, so a
      `{C}` filter would quietly match cards nobody meant. The deriver cannot emit
      one, but the REGISTRY authors this filter too (Armarouge), which is exactly
      where a hand-written `"Colorless"` would otherwise have compiled.
      (`basicEnergy.energyType` beside it is still a bare string — a wider,
      pre-existing hole in a filter this slice did not touch.) */
  | { kind: "providesEnergy"; energyType: BasicEnergyType };

/** The name under which one op files WHAT IT MOVED so that a LATER op in the
    same program can read it — the interpreter's op→op data flow (the running
    record lives in `EffectContinuation.record`, interpreter.ts).

    IT EXISTS BECAUSE PRINTED SENTENCES REFER BACK TO EACH OTHER. Three wordings,
    one mechanism, and each is a clause that cannot be evaluated from the board
    alone because it asks what *this card's own earlier clause* actually did
    (rules doc §9.2):

      • "If you shuffled any cards into your deck **in this way**, draw 3 cards."
        (Miriam) — a GATE on whether the earlier op moved anything;
      • "(You can't choose a card you discarded with **the effect of this
        card**.)" (Superior Energy Retrieval) — the earlier op's uids EXCLUDED
        from a later op's candidate set;
      • "**If you do**, draw cards until you have 5." (Dendra) — the same gate as
        Miriam's, printed as the conditional the whole family opens with.

    A SLOT NAME, NOT A POSITION. The obvious cheaper design — "read the previous
    op's result" — is refuted by the very first card that needs this: Miriam
    shuffles the deck BETWEEN the retrieval and the sentence referring to it, and
    Janine's Secret Art (sv06.5-059, unauthored) prints the same shape ("Then,
    shuffle your deck. If you attached Energy … in this way, …"). A trailing
    shuffle is the single most common op in the vocabulary, so "previous op"
    would be wrong on the majority of the family.

    A CLOSED UNION so a typo is a COMPILE error rather than a silent false: an
    unrecorded slot reads as "nothing moved", which is indistinguishable from a
    real empty answer, so a mistyped `recordAs` would quietly cost Miriam its
    draw. Two members, matching the two things a program records — what it PAID
    (a `payFromHand` cost) and what it MOVED (a benefit). Add a member when a
    card needs a third. */
export type EffectSlot = "paid" | "moved";

/** How many cards a `handRefresh` draws AFTER the hand goes into the deck.
    `fixed` draws a constant (Youngster 5, Judge 4, Katy 8); `handPlus` draws the
    pre-shuffle hand size plus `delta` (Brassius "draw that many cards plus 1" =
    delta 1), measured per affected player BEFORE their hand is shuffled in;
    `prizeCount` draws one card per Prize card that player still has left (Iono
    "each player draws a card for each of their remaining Prize cards" — the count
    is that player's OWN prizes, and a Prize count is public, so it leaks nothing). */
export type HandRefreshDraw =
  | { kind: "fixed"; count: number }
  | { kind: "handPlus"; delta: number }
  | { kind: "prizeCount" };

/** A board predicate read for ONE seat — the vocabulary behind both the printed
    "You can use this card only if <condition>" play gates (CardProgram
    `playableIf`) and the "if <condition>, …" mid-program branches (the
    `conditionGate` op). Evaluated by `conditionHolds` (interpreter.ts) against
    the state at the moment it is asked: a play gate before the card leaves hand,
    a `conditionGate` at its own point in the program.

    INVARIANT — every member reads only PUBLIC state (Prize COUNTS, the Stadium
    zone's owner, Energy sitting face up on Pokémon). Both players can already
    derive the answer off the board, which is why a gate emits no event, unlike
    `coinFlipGate`, whose flip IS new information. Keep it that way: a condition
    over hidden state (a hand's CONTENTS, a deck) would leak through the gate.

    "Public" is about what a condition may DEPEND on, NOT about who can compute
    it: `conditionHolds` takes a `GameState`, so only a host holding raw engine
    state can run it (today's hot-seat HUD does). A P4 remote client holds a
    projection, which does NOT carry the Stadium's owner and redacts the prize
    arrays to counts — so the online client cannot evaluate these as written.
    That gap is P4's to close (see docs/workstreams/simulator.md); note that a
    redacted prize array still has a `.length`, so `morePrizesThanOpponent` would
    fail SILENTLY rather than loudly if this were shipped online unchanged. */
export type BoardCondition =
  /** §14 — you have strictly MORE Prize cards remaining than your opponent, i.e.
      you are BEHIND on Prizes taken (Fighting Au Lait's play gate; Defiance
      Band, Luxray and Reversal Energy read the same condition and layer later). */
  | { kind: "morePrizesThanOpponent" }
  /** §7.3 — the Stadium in the shared zone is YOURS (you played it). "If you
      have a Stadium in play" is about OWNERSHIP, not mere presence: the
      opponent's Stadium sitting in the zone does not satisfy Falkner. */
  | { kind: "yourStadiumInPlay" }
  /** None of your in-play Pokémon (Active or Benched) has ANY Energy attached —
      Basic or Special (Grusha's "if none of your Pokémon have any Energy
      attached"). Vacuously true with nothing in play. */
  | { kind: "noEnergyOnYourPokemon" };

/** The riders that narrow which of the controller's own in-play Pokémon may
    RECEIVE an attach. Spelled once and read once (`attachEnergyTargets`,
    interpreter.ts) because "is this Pokémon an eligible attach target" is ONE
    rule with two op-shaped readers — `attachEnergyFrom` (hand / discard source)
    and `attachFromTop` (the deck top). Each op declares only the riders its
    printed cards use, and is structurally an `AttachTargetRiders`; an absent
    rider is no restriction, so the base shape is "every own in-play Pokémon". */
export interface AttachTargetRiders {
  /** Only Pokémon whose TOP card is this type — Gardevoir ex's "your {P}
      Pokémon", Electric Generator's "your Benched {L} Pokémon". */
  targetType?: string;
  /** Only BASIC Pokémon (Koraidon ex's "your Basic {F} Pokémon"). */
  basicOnly?: true;
  /** Only BENCHED Pokémon — the Active is not a target (Electric Generator's
      "your **Benched** {L} Pokémon", where the attach is the whole point of
      putting Energy somewhere the turn's manual attach cannot reach). */
  benchOnly?: true;
  /** Damage counters the attach itself places on the target (Gardevoir's 2). */
  bonusCounters?: number;
  /** Exclude any target `bonusCounters` would Knock Out ("you can't use this on
      a Pokémon that would be Knocked Out"), so the placement is never lethal. */
  notIfKO?: true;
}

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
  /** Place `amount` HP of SELF-damage on the attacker's own Active — the recoil
      clause "This Pokémon also does N damage to itself" (Skeledirge sv01-038
      "Blazing Shout", after its 190 to the defender). Self-damage is OUTSIDE the
      §8.5 pipeline: no Weakness/Resistance (you have no Weakness to your own
      attack) and no reduction passive — exactly the confusion self-hit's model
      (attack.ts), which is why it lands as COUNTERS_PLACED source "self" rather
      than a DAMAGE_DEALT that would imply the W/R math ran. Like every op it only
      RAISES damage and never KOs: the resulting self-KO is caught by the attack
      epilogue's TWO-seat sweep (flow.ts finishAttack), where it prizes to the
      DEFENDER (the opponent of the KO'd side, as collectKnockOuts always owes it).
      "itself" is the source, which for a §8 attack is the attacking Active — no
      single-op derived program relocates it before this runs. */
  | { op: "damageSelf"; amount: number }
  /** Put `amount` HP of damage counters on `count` CHOSEN Benched Pokémon of
      the opponent (Hawlucha "Flying Entry" — 2 × 1 counter; Meowscarada ex
      "Bouquet Magic" — 1 × 3 counters). "Put damage counters" is NOT attack
      damage: no Weakness/Resistance AND no reduction passive — a counter placed
      by an Ability is flat (the same rule damageActive / the poison-burn ticks
      follow), so this is distinct from spreadDamage (an attack's damage, which
      Bouffer reduces). PARKS on a multi-Pokémon choice (choosePokemonMulti) when
      the opponent has MORE than `count` Benched Pokémon; hits all of them when
      the Bench holds `count` or fewer (forced — "choose 2" with 2 available is
      both), and is a no-op with an empty opponent Bench. Only raises damage; the
      Knock Out check runs in the CALLER'S sweep (flow.ts settleProgram →
      resolveMidTurnKnockOuts), a MID-TURN KO that resumes the actor's turn — so
      this, like every op, never KOs or touches the flow tail.

      **`count` IS EXACT — the printed number is a floor as well as a ceiling.**
      "Put 3 damage counters on 1 of your opponent's Benched Pokémon" means one,
      not "up to one": a card prints the words "up to" when a partial answer is
      legal, and none of this op's consumers does. So the park asks for `count` on
      the nose, and the interpreter's forced branch (a Bench no bigger than
      `count`) is the same rule under §8.6 "do as much as you can". The floor is
      what stops Meowscarada ex from paying its irreversible hand cost and then
      placing nothing.

      `optional` is the printed "**you may**" — and it only ever appears on a
      TRIGGERED Ability, where the engine auto-fires the trigger (triggers.ts) and
      the decline therefore has nowhere else to live but the pick. Hawlucha is the
      one consumer: "you may choose 2 …" is all-or-nothing, so the prompt's legal
      answers are exactly `count` refs or NONE — never one of two. Meowscarada ex
      and Radiant Blastoise carry no such word on the placement (their "may" is the
      Ability's own activation, spent by choosing to use it, and by then the cost
      is paid), so their pick is mandatory. */
  | {
      op: "damageChosen";
      /** `opponentBench` — the chosen target(s) are among the opponent's Bench
          (flat, no W/R). `opponentAny` — 1 of ALL the opponent's Pokémon (Active
          OR Bench): a target that lands on the Active takes Weakness/Resistance
          (§8.5), a Benched one does not (Fezandipiti ex "Cruel Arrow", Rotom
          "Linear Attack"). */
      target: "opponentBench" | "opponentAny";
      amount: number;
      count: number;
      /** The printed "you may" of an auto-fired trigger: taking NONE is a legal
          answer, but a partial pick still is not (Hawlucha). */
      optional?: true;
      /** Wo-Chien ex "Covetous Ivy": the hit is ATTACK DAMAGE, not a placed
          counter — emit DAMAGE_DEALT and let a benched reduction passive apply
          (spreadDamage's model), where the default put-counter snipe (Hawlucha /
          Meowscarada, an Ability) emits COUNTERS_PLACED and is flat. Benched
          Pokémon still take NO Weakness/Resistance either way (§8.5). */
      deals?: true;
      /** Wo-Chien ex "Covetous Ivy": the printed "for each Prize card your
          opponent has taken" — the effective amount is `amount × the opponent's
          TAKEN Prizes`, read from state at run time (0 taken → no damage, no pick).
          The multiply "×" of the benched-snipe family, evaluated in the interpreter
          rather than folded pre-W/R (the target is benched, never the defender). */
      perTakenPrize?: true;
      /** Umbreon "Feint Attack" (sv03-130): "This attack's damage isn't affected by
          Weakness or Resistance, or by any effects on that Pokémon." — the snipe's
          hit skips BOTH the target's Weakness/Resistance AND its `damageReductionAfterWR`
          passive (the "any effects on that Pokémon" half). The ATTACKER's own pre-W/R
          bonus is an effect on the ATTACKER, not the target, so it still applies. Only
          the `opponentAny` reader sets it (Feint Attack targets any Pokémon). */
      ignoreWR?: true;
    }
  /** "Flip a coin. If heads, …" — `then` runs on heads only. The other gate is
      `conditionGate` (below, deterministic); both are spliced by runProgram. */
  | { op: "coinFlipGate"; then: EffectOp[] }
  // — Trainer / Ability ops (M4), controller-relative. —
  /** Draw `count` from the top of the controller's deck (short-draws when the
      deck is shallower — §14.3 deck-out is a turn-START rule only). */
  | { op: "drawCards"; count: number }
  /** "Draw cards until you have `size` cards in your hand" (Grusha) — draw
      `size − hand.length`, i.e. nothing at all when the hand already holds
      `size` or more (a bigger hand is never trimmed). Fully automatic like
      drawCards, and short-draws the same way on a shallow deck (§14.3 deck-out
      is a turn-START rule). Distinct from drawCards because the count is read
      off the CURRENT hand: two of these in a row is not two draws. */
  | { op: "drawUntilHandSize"; size: number }
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
  /** Heal from the controller's own in-play Pokémon: `amount` HP, or `"all"`
      its damage. Without `upTo` it heals ONE — the printed exact "1 of your
      Pokémon" (Potion 30; Arboliva's "Enriching Oil" all) — and PARKS on a
      choosePokemon unless only the Active is in play. `upTo` is the printed
      "up to N … each" (Saguaro: "Choose up to 2 of your Pokémon and heal 50
      damage from each of them"): it parks a choosePokemonMulti {min: 0,
      max: min(upTo, in play)} — §9.1's "up to" legalizes 0, 1, … max, so this
      is the first consumer of that prompt's min:0 end, and it parks at every
      non-empty board (a take-fewer right is a decision even over one
      candidate — the declinable-snipe rule). The candidates are ALL the
      controller's Pokémon, damaged or not: the printed choose clause has no
      damaged restriction, and picking an undamaged one heals 0 and emits
      nothing (the single-arm rule). `amount` stays per-Pokémon ("from EACH of
      them"), clamped to each pick's damage. */
  | { op: "healChosen"; amount: number | "all"; upTo?: number }
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
      program runs), so a card whose own `filter` MATCHES ITS OWN CATEGORY would
      offer ITSELF as a retrieval candidate. No card in scope does — the safety is
      that each one retrieves a category it is not a member of. It is NOT, as this
      note used to say, that "every card here is an Item retrieving
      Energy/Pokémon/Supporters": **Miriam is a Supporter on this op**, and the
      only reason it is safe is that its filter is `anyPokemon`. A Supporter
      authored with `filter: {kind:"supporter"}` would put itself in its own offer
      and needs the played uid excluded first — which is what `exclude` now
      exists to express, though the played uid is not currently recorded anywhere.

      `exclude` is Superior Energy Retrieval's parenthetical, "(You can't choose
      a card you discarded with the effect of this card.)": the uids an earlier
      op filed under that `EffectSlot` are dropped from the candidate set before
      the filter runs. It is not a nicety — SER pays its hand cost INTO the very
      pile this op then reads, so without it a player could discard 2 Basic
      Energy and take the same two straight back, which turns the cost into a
      no-op and the card into a free +2. `recordAs` is the other end of the same
      wire: Miriam files what it shuffled back so its printed "in this way" has
      something to ask about. */
  | {
      op: "discardPileRetrieval";
      filter: CardFilter;
      dest: "hand" | "deck";
      max: number;
      /** File the uids actually moved under this slot (Miriam). */
      recordAs?: EffectSlot;
      /** Drop the uids filed under this slot from the candidates (SER). */
      exclude?: EffectSlot;
    }
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
  /** Look at the top `n` cards of the controller's deck and ATTACH the Energy
      among them straight onto the controller's own in-play Pokémon — the
      from-the-top variant of `attachEnergyFrom`, whose sources (hand, discard
      pile) are zones the player can already see (Electric Generator: "Look at
      the top 5 cards of your deck and attach up to 2 Basic {L} Energy cards you
      find there to your Benched {L} Pokémon in any way you like"; Hydreigon
      "Tri Howl": the top 3, any number of Energy, to your Pokémon).

      **"IN ANY WAY YOU LIKE" is what makes this its own op.** `attachEnergyFrom`
      attaches ONE fungible card and asks only where; here the cards are whatever
      the top `n` happened to hold, and each attached card names its OWN
      destination — so the answer is a MAP (card → Pokémon), not a list. That is
      the `attachCards` prompt (interpreter.ts), the first whose answer pairs each
      pick with a target of its own; moveEnergy's picks share one destination.

      `filter` scans cards sitting in the DECK, so it is about the PRINT:
      `basicEnergy` + `energyType` for Electric Generator's "Basic {L} Energy
      CARDS", `anyEnergy` for Hydreigon's "Energy cards" (Basic or Special).
      NEVER `providesEnergy` — provision is a while-ATTACHED property, so a card
      in a pile provides nothing and `matchesFilter` answers false for it (§6.5).

      `max` is the cap: a number is the printed "up to 2", `"any"` the printed
      "any number" (the cap is then the whole candidate set — a card may not be
      attached twice). Declinable EITHER way, like every "up to": attaching none
      is a legal answer, so the op parks whenever there is anything to attach and
      anywhere to put it rather than forcing a single-candidate board.

      `targetType` / `benchOnly` narrow the eligible targets ("your **Benched**
      **{L}** Pokémon"), through the same `attachEnergyTargets` reader
      `attachEnergyFrom`'s own riders use — one rule for "which of your Pokémon
      may receive an attach", two ops reading it.

      `discardRest` is the printed "**Discard** the other cards" (Hydreigon).
      Its sibling clause "**Shuffle** the other cards back into your deck"
      (Electric Generator) is NOT a field: those cards never left the deck, so a
      trailing `shuffleDeck` op — which knows nothing about the window — gets it
      exactly right, the same Nest Ball search-then-shuffle pattern lookAtTopN
      and searchDeck follow. A DISCARD cannot be expressed that way, because it
      must name exactly the looked-at cards that were NOT attached, and only this
      op knows which those were: after k are attached the window holds n − k, and
      a "discard the top 3" op would eat k cards deeper in the deck. The
      asymmetry is forced by what the two clauses have to know, not chosen.

      The leftovers clause runs on EVERY path — including the whiff (no matching
      Energy up there), the decline (attach none) and the board with no eligible
      target at all — which is the same rule as "a whiffed search still
      shuffles", except that here it is the difference between Tri Howl costing
      three cards and costing nothing.

      **NO `programPlayable` GATE, deliberately.** An earlier draft refused
      Electric Generator when the controller had no Benched {L} Pokémon, by the
      "an attach with no eligible target can only whiff" rule `attachEnergyFrom`
      follows. That was wrong, and the review that caught it is worth preserving:
      `programPlayable` is an AND over a program's ops, so vetoing on this op
      vetoes the CARD — including its second printed sentence, "Shuffle the other
      cards back into your deck", which always resolves. The ruling cardplay.ts
      quotes (ruling/284) draws exactly that line: playing a card for no effect is
      when the game state prevents ANY effect, and shuffling your deck after a
      known-bad top is an effect players deliberately buy. Two in-repo precedents
      agree — Great Ball and Pokégear (`lookAtTopN` + `shuffleDeck`) are
      unconditionally playable, and so is Nest Ball into a full Bench. The
      distinction from `attachEnergyFrom` is not the attach: it is that every card
      carrying THIS op also carries a leftovers clause that always happens, so
      "no target" is never "no effect". A future card where the attach is the
      whole effect would want a gate — and would want it as "no op in this program
      can do anything", not as a per-op veto.

      Never damages, so it never KOs; and it is not the §6.3 manual attach, so no
      allowance is touched. */
  | {
      op: "attachFromTop";
      n: number;
      filter: CardFilter;
      max: number | "any";
      targetType?: string;
      benchOnly?: true;
      discardRest?: true;
    }
  /** SEARCH the controller's whole deck for up to `max` Energy cards matching
      `filter` and ATTACH them straight onto the controller's own in-play Pokémon
      — the deck-SEARCH sibling of `attachFromTop`, which reaches only a window on
      the deck's top (Charizard ex "Infernal Reign": "search your deck for up to 3
      Basic {R} Energy cards and attach them to your Pokémon in any way you like";
      Janine's Secret Art: "Choose up to 2 of your {D} Pokémon. For each of those
      Pokémon, search your deck for a Basic {D} Energy card and attach it to that
      Pokémon").

      It shares `attachFromTop`'s answer shape — the `attachCards` MAP prompt,
      each picked card naming its OWN destination — because the printed clause is
      the same one: several cards, several places, chosen together. What differs
      is the SOURCE, and every difference below falls out of it:

      • **The candidate set is the whole deck**, so it is HIDDEN and it is BIG.
        Hidden is no new problem (the prompt goes to the controller alone, exactly
        as lookAtTopN's does, and this is the controller's OWN deck — a zone the
        printed word "search" hands them in full). Big is: a real deck holds a
        dozen Basic {R} Energy, and offering all twelve for a pick of three is one
        question wearing twelve hats. The offer is therefore COLLAPSED to at most
        `max` representatives per interchangeable class, the D42 rule the
        mandatory discards already run on — a Basic Energy keyed by what it
        PROVIDES, since the catalog prints the same Basic Fire Energy under four
        ids (sve-002/-010/-018 and sv03-230). Every distinguishable answer survives; only copies that could ONLY
        duplicate are dropped.
      • **There is no leftovers clause**, and so no `discardRest`. The cards not
        taken never left the deck and are not even a named window, so the printed
        "Then, shuffle your deck" is a trailing `shuffleDeck` op — the Nest Ball
        search-then-shuffle pattern every deck search in this vocabulary follows,
        and it runs on the whiff and the decline exactly as a whiffed search does.
      • **`n` has no meaning** — a search sees the whole deck. `max` is the
        printed "up to N", already a number (no `"any"`: no printed search says
        "any number", because a search that emptied your deck of Energy would be
        a different card).

      `maxPerTarget` is the printed "**for EACH of those Pokémon** … attach it to
      THAT Pokémon". Charizard's "in any way you like" allows every split
      including all three on one Pokémon; Janine's wording does not — its Energy
      go one apiece to distinct Pokémon, so the card is exactly "up to 2 Basic {D}
      Energy onto DISTINCT {D} Pokémon of yours". Modelling it that way (rather
      than as a choose-the-Pokémon prompt followed by a per-Pokémon search) is
      what keeps it to ONE decision: the Energy are fungible, so choosing which
      Pokémon get one and choosing which card goes where are the same choice, and
      the map prompt already expresses it. The rider is on the OP and not on
      `AttachTargetRiders` on purpose — the riders answer "which Pokémon may
      receive", a per-Pokémon question shared with `attachEnergyFrom`, while this
      is a constraint on the map as a whole.

      `toSelf` is the THIRD printed target rule — "attach it to **this Pokémon**"
      (Pawmot "Electrogenesis") — and the first op to read the context's
      `sourceUid`: the one eligible target is the Pokémon whose effect this is,
      wherever it sits (Electrogenesis is not Active-only — a benched Pawmot
      feeds itself, which is exactly what the source uid exists to say).
      Mutually exclusive with `targetType`/`benchOnly`/`maxPerTarget`: a card
      that names its own body prints no other target rule, and a per-target cap
      over one target is just `max`. With no source in the context (a Trainer
      program — the field is meaningless there) or the Pokémon no longer a board
      top, the target set is empty and the op whiffs into its trailing shuffle,
      like any other empty path.

      `filter` scans cards sitting in the DECK, so it is about the PRINT
      (`basicEnergy` + `energyType`), never `providesEnergy` — §6.5, the same rule
      `attachFromTop` states.

      `recordAs` files the uids ACTUALLY attached (§9.2), for a following
      `recordGate` to read. Janine is the consumer, through that gate's `contains:
      "yourActive"`: "If you attached Energy to your Active Pokémon in this way,
      it is now Poisoned."

      **NO `programPlayable` GATE**, for `attachFromTop`'s reason exactly: every
      card carrying this op also prints "Then, shuffle your deck", a clause that
      always resolves, so "no eligible target" is never "no effect" (ruling/284).
      Never damages, so it never KOs; and it is not the §6.3 manual attach, so no
      allowance is touched. */
  | {
      op: "attachFromDeck";
      filter: CardFilter;
      max: number;
      targetType?: string;
      benchOnly?: true;
      /** At most this many of the attached cards may land on any ONE Pokémon —
          the printed "for each of those Pokémon" (Janine's Secret Art). Absent =
          "in any way you like", no per-target limit. */
      maxPerTarget?: number;
      /** The printed "attach it to THIS Pokémon" (Pawmot "Electrogenesis"): the
          sole target is the Pokémon whose effect this is (`ctx.sourceUid`). No
          card prints it beside another target rule, and this member does not
          referee a co-authored one — it IGNORES `targetType`/`benchOnly` (the
          source ref is not filtered), while `maxPerTarget` would still cap the
          count. Authoring it alone is the rule; this doc is the enforcement. */
      toSelf?: true;
      recordAs?: EffectSlot;
    }
  /** Discard Energy attached to an in-play Pokémon — the §15 energy-removal
      ("hammer") family on the opponent's side (Crushing Hammer, Giacomo, Mawile
      "Special Eater") and the §8 self-discard attack COST on the controller's
      (Houndoom "Fire Blast", Charcadet "Ember", Pawmot "Electro Paws").
      `filter` narrows which ATTACHED Energy may be taken (`anyEnergy` /
      `specialEnergy`); the card always goes to its OWNER's discard pile.

      `from` names both the eligible Pokémon and how many are hit, spelled the way
      the cards are:
        • **`opponentActive`** — the opponent's Active alone (Mawile: "discard a
          Special Energy from your opponent's Active Pokémon");
        • **`opponentChosen`** — one Energy off ONE of the opponent's in-play
          Pokémon, the controller choosing both (Crushing Hammer: "…from 1 of your
          opponent's Pokémon"). Taking exactly one Energy collapses the two-step
          choice into one, so this is a single pick over the flat candidate list —
          picking the Energy IS picking the Pokémon;
        • **`opponentEach`** — one Energy off EVERY one of the opponent's in-play
          Pokémon that has a match (Giacomo: "…from each of your opponent's
          Pokémon"); a Pokémon holding none is simply skipped;
        • **`yourActive`** — the CONTROLLER's own Active, which for an attack
          effect is the printed "this Pokémon" (the attacker is by definition the
          Active, §8). The only arm that discards from the controller's own board,
          and the reason the discard pile is the HOST's rather than the opponent's.
          An Ability on a BENCHED Pokémon saying "this Pokémon" is NOT this member
          — it would need an arm reading `ctx.sourceUid` (which the context now
          carries — `attachFromDeck.toSelf` is its one reader), and no printed
          card wants one here yet, so that card stays unauthored.

      `count` says how many come off, and ONE is the default (absent = the printed
      "an Energy"):
        • **a number** — the exact-N discard ("Discard 2 Energy from this Pokémon"
          — Corviknight, Slither Wing; "Discard 3…" — Koraidon). Still MANDATORY,
          so N is a floor as well as a ceiling — except that a board holding fewer
          than N matching Energy gives up all of them ("do as much as you can");
        • **`"all"`** — the printed "Discard ALL Energy from this Pokémon"
          (Pawmot, Raichu): every match off every affected Pokémon, so it never
          asks anything.
      A count applies to the WHOLE pick, not per Pokémon, so pairing one with
      `opponentEach` ("one from each") is not a shape any card prints — and the
      union below makes it UNREPRESENTABLE rather than merely undocumented
      (`count?: never` on that arm): the interpreter would otherwise ignore the
      field and under-discard while the prompt captioned itself with the number.
      The deriver is the only author of a numeric count today and only ever pairs
      it with `yourActive`.

      MANDATORY, not "up to": the only decision is WHICH Energy, never whether — so
      unlike searchDeck / moveEnergy this park has NO decline. It parks only on a
      genuine choice: candidates that are the SAME printed card on the SAME
      Pokémon are interchangeable, and only as many of them survive as the pick
      could possibly want (interpreter.ts interchangeableCandidates keeps `count`
      per class) — so a Houndoom attacking with three {R} attached asks nothing,
      and neither does a Koraidon discarding 3 off four identical {F}, while two
      DIFFERENT Energy on one Pokémon do. An empty candidate set is a no-op
      (`programPlayable` also blocks a top-level discard that could only whiff —
      attacks do not consult it, since the attack was already legally declared).
      Never damages, so it never KOs. */
  | {
      op: "discardEnergy";
      from: "opponentActive" | "opponentChosen" | "yourActive";
      filter: CardFilter;
      /** How many Energy the op takes in total: absent = one (the printed "an
          Energy"), a number = exactly that many, `"all"` = every match — which
          leaves no decision, so the op never parks under it. */
      count?: "all" | number;
    }
  /** The `opponentEach` sweep, split out so a count cannot ride it: "one from
      EACH" already fixes how many come off (one per Pokémon with a match), and
      the field would be silently ignored. Giacomo is the only printed member. */
  | { op: "discardEnergy"; from: "opponentEach"; filter: CardFilter; count?: never }
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
      a play that could only whiff.

      `route` FIXES the endpoints instead of letting the player pick both:
      `benchToActive` is Armarouge's "move a {R} Energy from 1 of your BENCHED
      Pokémon to your ACTIVE Pokémon" — sources are the bench alone, the sole
      destination is the Active. One decision survives (WHICH Energy), so it
      parks on the very same compound prompt with a single-entry `destinations`;
      the dialog and the wire validator both read the prompt, so neither needs to
      know a route exists. Source and destination are disjoint by construction,
      which is why the "two Pokémon in play" rule relaxes here to "an Active and
      a benched source". Still own→own; the OPPONENT-side move (Mismagius's
      on-evolve flick) layers on later. */
  | { op: "moveEnergy"; filter: CardFilter; max: number; route?: "benchToActive" }
  /** Put the affected player(s)' whole hand back into their deck, then draw — the
      Iono/Judge hand-refresh Supporter family. `who: "you"` affects the controller
      only (Youngster: draw 5; Katy: draw 8; Brassius: draw hand+1); `who: "both"`
      affects BOTH players (Judge: "Each player shuffles their hand into their deck
      and draws 4"; Iono) — the ops that reach the OPPONENT's hand/deck. `draw` is
      how many each affected player then draws, measured off THAT player's OWN
      pre-move hand (handPlus) or Prize count (prizeCount).

      Two PLACEMENTS, and the difference is the whole strategic point of the family:
      by default the hand is shuffled INTO the deck (the combined pile is shuffled —
      the deck's order is destroyed, Youngster/Judge/Brassius/Katy); with
      `toBottom` the HAND ALONE is shuffled and placed UNDER the deck (Iono "shuffles
      their hand and puts it on the bottom of their deck"), so the deck's existing
      order — and therefore the next draws — survive untouched.

      `onlyIfAnyMoved` gates the DRAW on at least one affected player having actually
      moved a card (Iono: "If either player put any cards on the bottom of their deck
      in this way, each player draws…"): with every affected hand empty, nobody draws.
      It is an ALL-OR-NOTHING gate across the affected seats, which is why the moves
      for every seat happen before any draw does.

      Fully AUTOMATIC — there is no decision, so it never parks (like drawCards /
      discardHand / shuffleDeck), and it is always playable: NO `programPlayable`
      gate, deliberately. You may always put your hand back and draw, even from an
      empty hand. The one state where the play does nothing at all — `onlyIfAnyMoved`
      with EVERY affected hand empty — is left legal on purpose (see D39): the
      digital clients allow it, it is self-inflicted and cannot soft-lock, and gating
      it would have to reach into "playTrainer discards the played card up front"
      (the controller's hand still holds it when the gate runs). The rng reorder is intrinsic
      (the pile is shuffled here — there is no separate `shuffleDeck` op). Emits
      count-only events (HAND_SHUFFLED_INTO_DECK / HAND_TO_BOTTOM_OF_DECK per
      affected seat + CARDS_DRAWN from the draw): a hidden hand's cards stay hidden,
      so the opponent — and, for a both-player refresh, the controller about the
      opponent — learns only counts. "Your turn ends" (Katy) is NOT part of this op:
      it is the CardProgram `trainerEndsTurn` flag folded by settleProgram (the
      Koraidon `endsTurn` precedent, on the Trainer path).

      AUTHORING NOTE: the two riders are independent optionals, so combinations no
      printed card uses are representable (`onlyIfAnyMoved` without `toBottom` would
      reshuffle both decks and then draw nothing; `toBottom` with `handPlus` matches
      no card). The registry is the only author, so this is a caution, not a hole. */
  | {
      op: "handRefresh";
      who: "you" | "both";
      draw: HandRefreshDraw;
      /** Shuffle the HAND alone and put it UNDER the deck, leaving the deck's own
          order intact (Iono), instead of shuffling the hand into the deck. */
      toBottom?: true;
      /** Draw only if ≥1 affected player actually moved ≥1 card (Iono). */
      onlyIfAnyMoved?: true;
    }
  /** Pay a printed HAND COST: spend `count` cards out of the controller's own
      hand — `to: "discard"` into their discard pile, `to: "deckBottom"` under
      their deck — before the rest of the program runs. The §7/§9 "you can only
      do this if you pay" family, which prints in three wordings that mean one
      thing:

        • **Trainers** — "You can use this card **only if** you discard 2
          **other** cards from your hand." (Ultra Ball, Earthen Vessel's
          "**another** card", Superior Energy Retrieval);
        • **Abilities** — "You **must** discard a card from your hand **in order
          to use** this Ability." (Tinkaton "Gather Materials", Revavroom
          "Rumbling Engine", Meowscarada ex "Bouquet Magic", Radiant Blastoise
          "Pump Shot");
        • **the payment that is not a discard** — "Put a card from your hand on
          the bottom of your deck. **If you do**, draw cards until you have 5
          cards in your hand. (If you have no other cards in your hand, you can't
          use this card.)" (Dendra). Nothing is discarded and the sentence never
          says "cost", yet every clause of the mechanism is here: "if you do"
          makes the benefit conditional on the payment, and the parenthetical is
          the same printed PLAY GATE the Trainers state as "only if". The
          destination is the one thing that varies, so it is a field on the op and
          not a second op — WIDEN, DON'T COPY (the D44/D45/D46 pattern).

          "IF YOU DO" IS A `recordGate`, NOT SOMETHING THIS OP ENFORCES. The op
          pays what it can and returns; the ops after it run regardless (the
          short-hand branch below is "do as much as you can"). Dendra says the
          conditional out loud, so its program says it too — `recordAs: "paid"`
          here, and the draw inside a `recordGate` on that slot. The play gate
          already makes the unpaid case unreachable through the action path, so
          this changes no game a player can produce; it is the printed sentence
          being expressible at all, which is what a card making the payment
          optional would need.

      `filter` narrows WHICH cards may pay it — absent is the printed bare "a
      card" (Tinkaton, and every Trainer in the family), `anyEnergy` is "an
      Energy card" (Revavroom), `basicEnergy` + a type is "a Basic {G} Energy
      card" (Meowscarada, Radiant Blastoise). It scans cards sitting in a HAND,
      so like every pile-scanning op it reads the PRINT: never `providesEnergy`,
      which a card attached to nothing cannot answer (§6.5).

      **A COST, NOT A `BoardCondition`.** The printed "only if" is the same
      opening as Fighting Au Lait's `trainerPlayableIf`, and it is a different
      animal: a BoardCondition reads PUBLIC state and CHANGES NOTHING, while this
      spends cards out of a HIDDEN zone. It could not be a BoardCondition even in
      principle — that union's invariant is that both players can already derive
      the answer, and a hand's contents are exactly what they cannot.

      **AN OP, NOT A HANDLER FIELD — because it PARKS.** "Discard a card from
      your hand" with a mixed hand is a real decision, so the cost has to run
      through the interpreter. That is also why it is the FIRST op of its
      program rather than a field paid before the program starts, which is the
      shape `AbilityProgram.cost` used to have: that field could only express the
      FUNGIBLE case (Meowscarada's Basic {G} Energy, where copies are
      interchangeable so the first match is as good as any), and Tinkaton's "a
      card" is the general one. Both are this op now — one vocabulary, one
      payment, one event.

      **THE EVENT FOLLOWS THE DESTINATION'S VISIBILITY.** One event kind
      (HAND_COST_PAID) carries the payment either way, and its `to` is what a
      reader needs: cards paid to the DISCARD become public the moment they land,
      while cards put UNDER THE DECK go from one hidden zone to another and are
      never seen again. So the log names a count for both but a different verb for
      each, and P4's per-seat event filter has the destination to key on without
      re-deriving it from the op.

      **ORDER IS OBSERVABLE, and the printed sentence puts the cost first on
      every card in the family.** Revavroom is the witness: "discard an Energy
      card … then draw cards until you have 6 in your hand" off a hand of 5 draws
      TWO, because the payment happens first; paying afterwards would draw one.
      Dendra says the same thing about the other destination: the card put under
      the deck has LEFT the hand before "draw until you have 5" counts it, so a
      hand of 4 (Dendra included) pays 1 and draws 3.
      Tinkaton's is the quieter version — the card you discard comes from the
      pre-draw hand, so a card you are about to draw cannot pay for the draw.

      MANDATORY and EXACT: `count` is a floor as well as a ceiling, so unlike
      searchDeck / discardPileRetrieval this park has no decline (the prompt
      carries `min === max === count`). It parks only on a genuine choice —
      candidates that are the same card are interchangeable, and only as many of
      them survive as the pick could want (interpreter.ts `cardIdentity`), so
      Meowscarada with three Basic {G} Energy in hand asks nothing and neither
      does Revavroom holding two identical {R}. An offer no bigger than `count`
      auto-resolves.

      **THE PLAY GATE IS THE CARD'S OWN PRINTED RULE — which is why it vetoes,
      where D45's did not.** "You can use this card ONLY IF" makes paying a
      precondition for the WHOLE card, so an unpayable cost refuses the play
      (cardplay.ts, `handCostUnmet`) rather than resolving the rest for free.
      That is the opposite call from `attachFromTop`, and the difference is the
      text: there the veto was the ENGINE's guess that one op would whiff, applied
      through a `programPlayable` AND to a card whose other printed clause always
      resolves; here the card itself says the play is illegal. This gate is
      therefore NOT in `programPlayable` — it is checked beside
      `trainerPlayableIf`, the other printed-rule gate, and it needs something
      `programPlayable` does not have (below).

      **"OTHER" IS NOT A FIELD ON THIS OP** — it is a consequence of where the
      paying card sits, and the printed wordings agree exactly: every Trainer in
      the family says "other"/"another" and every Ability says neither, because a
      Trainer is IN THE HAND it is about to pay out of and an Ability's card is on
      the board. Dendra is the correlation's third witness and the sharpest, since
      it carries the word in its GATE rather than in its effect sentence — "(If you
      have no OTHER cards in your hand, you can't use this card.)" — which is
      exactly where the engine honours it. The apply never has to care (playTrainer
      moves the played card to the discard BEFORE the program runs, so it is not a
      candidate), but the GATE runs while it is still in hand — hence the played
      uid is excluded there, and that exclusion is the printed word "other".

      AUTHORING NOTE — the gate lives on the two PLAY paths (`playTrainer`,
      `useAbility`), which is where the printed sentence lives too: a cost is the
      price of *making a play*. `runProgram` has two other callers that gate
      nothing — attack.ts and the triggered-Ability scan (triggers.ts / flow.ts's
      on-KO stage) — so this op authored into an `attack` or a `triggered` program
      would be SKIPPED when it could not be paid rather than refusing anything,
      because a trigger has no play to refuse. No printed card does that (nothing
      charges a hand cost for a trigger firing), and if one ever appears it needs a
      decision about what an unpayable trigger even means, not a gate copied here. */
  | {
      op: "payFromHand";
      count: number;
      /** Where the paid cards go — the printed verb. `"discard"` is the whole
          discard family; `"deckBottom"` puts them UNDER the deck, in the order
          picked (Dendra). Required rather than optional so every author states
          it, the rule `chooseCards.min` set one slice earlier. */
      to: "discard" | "deckBottom";
      filter?: CardFilter;
      /** File the uids actually paid under this slot, for a later op to read —
          Superior Energy Retrieval excludes them from its retrieval, Dendra
          gates its draw on them ("if you do"). */
      recordAs?: EffectSlot;
    }
  /** REVEAL the opponent's hand, then the CONTROLLER chooses one card matching
      `filter` from it and puts it on the bottom of the OPPONENT's deck — the
      printed "Your opponent reveals their hand, and you choose a card you find
      there and put it on the bottom of their deck" (Ortega, unfiltered) and
      "…Choose a Supporter card you find there…" (Greavard "Underworld Stroll",
      the attack twin, DERIVED — see deriveAttackEffect). The first op to move a
      card between two zones the controller owns NEITHER of.

      THE REVEAL IS THE OP'S FIRST ACT and it is TOTAL: every uid in that hand
      goes out in one public `HAND_REVEALED` — that is what the printed word
      means at a table (both players see all of it), and it is emitted before
      the pick parks, so the event tells the story in the order it happened. An
      empty hand reveals honestly as zero uids (the HAND_DISCARDED "(0 cards)"
      precedent) — reachable only through the ATTACK twin, because the Trainer
      path is gated (programPlayable: an empty opponent hand is PUBLIC knowledge
      — the count shows — so "this can only whiff" is a fact the board states,
      the Catcher/Hammer class and not Poké Ball's; a FILTER's matches stay
      hidden knowledge, so the gate reads hand LENGTH and never the filter).

      The pick is MANDATORY and exactly one — "you choose a card", not "you
      may" — so the prompt is the second `min === max` chooseCards after the
      hand cost. It parks only when a real choice exists: the offer is the
      filtered hand COLLAPSED to one representative per interchangeable class
      (`cardIdentity` — the attachFromDeck key, because the catalog prints one
      Basic Energy under several ids), and a single-class offer resolves inline
      (the M1 doctrine). Collapsing is sound HERE where payFromHand must not:
      that offer names cards in a zone that stays hidden, so its collapse leaks
      the hand's duplicate structure — this hand was just revealed in full, so
      there is nothing left for the offer's shape to give away.

      The card lands UNDER the opponent's deck (their zone, their order —
      appended exactly as payFromHand's `deckBottom` appends) and is PUBLIC the
      whole way: everyone saw the reveal and watched the pick, so
      `CARD_TO_BOTTOM_OF_DECK` names the uid — the event follows the
      destination's VISIBILITY rule from the other side (Dendra's payment goes
      hidden → hidden and stays count-shaped; this one goes revealed → known
      bottom card).

      A whiff (no match for the filter — Greavard into a Supporter-less hand)
      files `[]` under `recordAs` like every recording op, so a §9.2 gate reads
      an honest no. */
  | {
      op: "bottomFromOpponentHand";
      /** Which cards may be chosen — absent is Ortega's bare "a card" (any).
          `supporter` is Greavard's printed narrowing. */
      filter?: CardFilter;
      /** File the uid actually moved under this slot for a later op to read —
          Ortega's "If you put a card on the bottom of your opponent's deck in
          this way" is a plain recordGate on it. */
      recordAs?: EffectSlot;
    }
  /** The OPPONENT of the controller may draw `count` cards — the printed "your
      opponent may draw a card" (Ortega), and the engine's first decision that
      belongs to the seat that did NOT make the play. The park carries a
      `decider` (interpreter.ts), settleProgram files it as the phase's
      `answerer`, and resolveEffect accepts only that seat's answer — the
      controller cannot answer for them, because at a table this "may" is the
      other player's to speak.

      A yes draws off the OPPONENT's own deck top (`drawToHand`, the standard
      contract); a no changes nothing and — like every decline in this engine
      (Saguaro's empty heal, a declined snipe) — emits NOTHING: no state moved,
      and the table saw the shrug.

      NEVER PARKS WHEN THE QUESTION DOES NOT EXIST: an empty opponent deck can
      only whiff the draw, so both answers are the same state and the op
      resolves silently (the M1 no-choice rule, same as drawCards' own empty-
      deck no-op). This is a DECISION rule, not a kindness — asking would park
      the game on a question with one answer.

      Deliberately NOT a rider on `drawCards`: that op is fully automatic and
      seat-fixed to the controller, and every one of its call sites relies on
      both. The name carries the printed words (the healChosen `upTo` rule) —
      a future self-side "you may draw" is a different sentence and gets its
      own field when a card prints it. */
  | { op: "opponentMayDraw"; count: number }
  /** A BOARD-CONDITION branch: run `then` when `cond` holds for the controller,
      else `otherwise` (nothing, if absent). The deterministic sibling of
      `coinFlipGate`, and spliced into the work queue by runProgram exactly the
      same way — so an op INSIDE a branch can still park, and a branch may hold
      any ops including further gates.

      One-armed is the common shape ("Draw 2 cards. If you have a Stadium in
      play, draw 2 MORE cards" — Falkner: a plain drawCards followed by a gated
      second one). `otherwise` exists for the printed "…instead", which is a real
      if/ELSE: Grusha draws to 7 when no Energy is on its board and to 5 when
      some is, and exactly ONE of those runs.

      Emits NO event, unlike coinFlipGate. A coin flip is new information both
      players must be told; a board condition is a fact they can already read off
      the table (see BoardCondition's public-state invariant), and the branch's
      own ops emit whatever actually happened. `cond` is evaluated against the
      state AS OF this op — after every earlier op in the program has applied. */
  | { op: "conditionGate"; cond: BoardCondition; then: EffectOp[]; otherwise?: EffectOp[] }
  /** AN OP-RESULT branch: run `then` when an earlier op in this same program
      filed at least one card under `slot`, else `otherwise` (nothing, if
      absent). The third and last gate, spliced into the work queue by runProgram
      exactly like the other two — so an op inside a branch can still park.

      This is the printed "**in this way**" / "**if you do**" (§9.2): Miriam's
      "If you shuffled any cards into your deck in this way, draw 3 cards" and
      Dendra's "If you do, draw cards until you have 5". `handRefresh`'s
      `onlyIfAnyMoved` rider is the same idea confined to ONE op, which is all
      Iono and Skwovet need because their move and their draw are the same op;
      this is that idea BETWEEN ops, and across a park.

      **WHY A THIRD GATE AND NOT A `BoardCondition` MEMBER.** `conditionGate` and
      the printed play gate (`trainerPlayableIf`) share one `BoardCondition`
      union, and that sharing is only sound because a board condition is a fact
      that exists BEFORE the card is played. An op result does not: nothing has
      run when a play gate is checked, so a `BoardCondition` member reading one
      would be answerable in one consumer and meaningless in the other. Keeping
      it out of that union is what makes the nonsense unrepresentable.

      Emits NO event, for `conditionGate`'s reason and one more: the branch turns
      on something the game has ALREADY announced (the recording op emitted its
      own DISCARD_RETRIEVED / HAND_COST_PAID / ENERGY_ATTACHED naming exactly
      these cards), so a gate event would be a second telling of one fact.

      **`contains` narrows WHICH of the filed cards counts** — the printed clause
      that asks not "did the earlier one do anything" but "did it reach a
      particular Pokémon". Janine's Secret Art is the one consumer: "If you
      attached Energy to your **Active** Pokémon in this way, it is now
      Poisoned", where the earlier op may well have attached two Energy and put
      neither on the Active. Absent = the plain "did anything move" test.

      `"yourActive"` holds when at least one filed uid is a card ATTACHED to the
      controller's Active right now. That is a read of the board rather than of
      the record, and it is deliberate: the record's values stay one kind of
      thing everywhere (the cards an op actually moved), and the question "where
      did it end up" is answered where every other board question is.

      **THE TWO READINGS ARE NOT THE SAME THING**, and the difference is worth
      stating exactly rather than waving at. "Was attached to the Active by that
      op" is history; "is on the Active now" is the board. They agree for every
      program that exists — but this vocabulary already contains three ops that
      would separate them if one were sequenced in between, and none of them is
      exotic: `switchActive` (a different Pokémon is now the Active, so the filed
      uids are on a BENCHED one), `moveEnergy` (own → own, which can take the
      filed card off the Active), and `discardEnergy`'s `yourActive` arm (the
      card is gone entirely). No printed card puts any of them between an attach
      and its "in this way" clause, and the one consumer — Janine's Secret Art —
      runs attach → shuffle → gate. So this is safe as authored and unsafe as a
      general rule: a new card that gates on a slot with ops like those between
      is the case to check, and the honest answer there is probably to file the
      HOST rather than to widen this. */
  | {
      op: "recordGate";
      slot: EffectSlot;
      contains?: "yourActive";
      then: EffectOp[];
      otherwise?: EffectOp[];
    };

type StatusWord = "Asleep" | "Burned" | "Confused" | "Paralyzed" | "Poisoned";

/** A Special Condition as the CARDS print it — capitalized, the form the deriver
    reads out of attack text and the form a prompt has to put back ("it is now
    Poisoned", Janine's Secret Art). The inverse of `STATUS_OF_WORD` below (the
    deriver's own `STATUS_WORDS` is a different thing — a regex alternation); both
    tables are exhaustive `Record`s over their key type, so a new condition is a
    compile error in two places rather than a silent gap in one, and a test pins
    them mutually inverse (the one drift the types cannot catch). */
export const STATUS_WORD_OF: Record<StatusName, StatusWord> = {
  asleep: "Asleep",
  burned: "Burned",
  confused: "Confused",
  paralyzed: "Paralyzed",
  poisoned: "Poisoned",
};

const STATUS_OF_WORD: Record<StatusWord, StatusName> = {
  Asleep: "asleep",
  Burned: "burned",
  Confused: "confused",
  Paralyzed: "paralyzed",
  Poisoned: "poisoned",
};

// The recognized sentence shapes, anchored end to end and compiled once
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
// own `damage` field; this clause is the secondary hit on the Bench — so the
// optional "also" ("This attack ALSO does N …", Cetoddle sv02-053 "Avalanche"
// after its 30 to the Active) is pure emphasis of that fact and derives to the
// SAME `spreadDamage` op: the only thing the word marks is that a main hit
// precedes it, which the `damage` field already carries either way. ONE rule
// for both wordings, unlike the snipe family where "1 of" vs "each of" pick
// genuinely different ops (damageChosen vs spreadDamage) — here the shape after
// "does" is identical, so a separate `ALSO_` regex would be a redundant twin.
const SPREAD_EACH_BENCH = new RegExp(
  `^This attack (?:also )?does (\\d+) damage to each of your opponent['’]s Benched Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);
// The CHOSEN-single benched hit SCALED by the opponent's taken Prizes — Wo-Chien
// ex sv02-027 "Covetous Ivy". The "×"/multiply sibling of the Prize-count family
// (Pecharunt ex, effects.ts's OPPONENT_PRIZES_MULTIPLY), but its target is one
// CHOSEN Benched Pokémon rather than the Defender, so it is a `damageChosen` op
// (count 1, `deals` + `perTakenPrize`) and not a pre-W/R damage fold. The "1 of"
// is what distinguishes it from SPREAD_EACH_BENCH's "each of"; the optional W/R
// clarifier tail is the spread family's, and true here for the same §8.5 reason.
const BENCHED_SNIPE_TAKEN_PRIZES = new RegExp(
  `^This attack does (\\d+) damage to 1 of your opponent['’]s Benched Pokémon ` +
    "for each Prize card your opponent has taken\\." +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);
// The flat, un-scaled RIDER: "This attack ALSO does N damage to 1 of your
// opponent's Benched Pokémon." — a SECONDARY snipe after the main damage (which
// rides the attack's own `damage` field). Miraidon "Lightning Laser", Pawmot,
// Bellibolt, Palafin, Decidueye ex, Tadbulb, … — one shape, any N. "also" marks
// the rider by intent, but the LOAD-BEARING separator from Covetous Ivy is the
// whole-sentence `\.$` right after "Pokémon": Covetous Ivy's clause continues
// ("… Benched Pokémon FOR EACH Prize …"), so the anchor — not the word "also" —
// keeps it off this path (and it derives via BENCHED_SNIPE_TAKEN_PRIZES anyway).
// "1 of" separates it from SPREAD_EACH_BENCH's "each of". Refuses Flamigo's "If
// Flamigo is on your Bench, …" (a board-condition gate, off the `^This` anchor),
// "2 of" (count ≠ 1), and "1 of YOUR Benched" (self-target) by the exact phrase.
const ALSO_BENCHED_SNIPE = new RegExp(
  `^This attack also does (\\d+) damage to 1 of your opponent['’]s Benched Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\))?$`,
);
// The ANY-target snipe: "This attack does N damage to 1 of your opponent's Pokémon."
// — the WHOLE attack (no `damage` field), a chosen hit on the Active OR a Benched
// Pokémon (Fezandipiti ex "Cruel Arrow", Rotom "Linear Attack", Paldean Tauros
// "Aqua Dive", Bellibolt ex, Kilowattrel). "Pokémon" (not "Benched Pokémon") is the
// tell: the target may be the Active, where Weakness/Resistance DO apply (§8.5), so
// the op is `target: "opponentAny"`. The tail is an ALTERNATION: the SAME Benched
// clarifier (true only for a Benched pick, no op change), OR — captured as group 2 —
// Umbreon "Feint Attack"'s "This attack's damage isn't affected by Weakness or
// Resistance[, or by any effects on that Pokémon]." (sv03-130), which sets `ignoreWR`.
// The ", or by any effects on that Pokémon" clause is optional so both the modern SV
// wording and the bare classic one derive the same flag. Refuses the "Benched"-only
// snipes (that clause names the zone) and Pawmot ex / Magikarp (a leading discard
// cost / coin flip, off the `^This attack does` anchor).
const CHOSEN_ANY_TARGET = new RegExp(
  `^This attack does (\\d+) damage to 1 of your opponent['’]s Pokémon\\.` +
    `(?: \\(Don['’]t apply Weakness and Resistance for Benched Pokémon\\.\\)` +
    `|( This attack['’]s damage isn['’]t affected by Weakness or Resistance` +
    "(?:, or by any effects on that Pokémon)?\\.))?$",
);
// The self-discard attack COST (§8): "an" leaves the player one pick per
// distinct Energy attached, "{N}" asks for exactly that many, "all" strips the
// lot. Deliberately NOT matching the TYPED variants ("Discard a {L} Energy…",
// "Discard 2 {R} Energy…", the older "Discard a Fire Energy…") — those need an
// energy-of-type filter this engine does not have yet, and "{L}" means an Energy
// that PROVIDES {L} rather than a Basic Lightning card, so a loose regex here
// would discard the wrong card on a real board. "this Pokémon" is the Active by
// §8 (only the Active attacks), which is what `from: "yourActive"` encodes.
const SELF_DISCARD_ONE = /^Discard an Energy from this Pokémon\.$/;
const SELF_DISCARD_N = /^Discard (\d+) Energy from this Pokémon\.$/;
const SELF_DISCARD_ALL = /^Discard all Energy from this Pokémon\.$/;
// The OPPONENT-side twin of the self-discard, printed on attacks rather than
// Trainers (Pincurchin "Needle Crush", Gumshoos "Crunch", Dragonite V "Hyper
// Beam") and half the time behind a flip (Dedenne "Energy Munch", Maschiff
// "Crunch", Tympole "Screw Tail", Yveltal "Destructive Beam"). Same op as
// Mawile's Ability, one filter wider: an attack takes ANY Energy, not just a
// Special one.
//
// Krookodile (sv01-117) is the trap these two must not fall into: "Flip a coin
// UNTIL you get tails. For each heads, discard an Energy from your opponent's
// Active Pokémon." — a repeat count this engine cannot express — ENDS in the
// bare pattern's exact words, and deriving it would silently discard once.
// TWO things keep it out, and it takes both: the leading `^`, and the fact that
// the clause reads lowercase "discard" mid-sentence where the pattern needs a
// capital. Neither alone is enough (dropping `^` still misses on the capital;
// adding /i still misses on the anchor) — so a future ingest that normalizes
// capitalisation would put the whole weight on the anchor. Do not add /i here.
const OPPONENT_ACTIVE_DISCARD = /^Discard an Energy from your opponent['’]s Active Pokémon\.$/;
const FLIP_OPPONENT_ACTIVE_DISCARD =
  /^Flip a coin\. If heads, discard an Energy from your opponent['’]s Active Pokémon\.$/;
// The reveal-and-bottom attack sentence (Greavard "Underworld Stroll") — the
// whole effect, anchored end to end like every rule here. Only the SUPPORTER
// narrowing is derived: Ortega's unfiltered Supporter form carries a second
// sentence (an opponent draw behind a §9.2 gate) that no attack prints, so it
// is registry-authored and this anchor must not loosen toward it.
const REVEAL_BOTTOM_SUPPORTER =
  /^Your opponent reveals their hand\. Choose a Supporter card you find there and put it on the bottom of their deck\.$/;
// The recoil clause (Skeledirge sv01-038 "Blazing Shout") — a self-damage the
// attack does IN ADDITION to its main numeric damage, hence the printed "also".
// Anchored verbatim like every rule here: a hypothetical "This Pokémon does N
// damage to itself." without the "also" (a pure-recoil attack with no defender
// damage — none in sv01–03), or a "This attack …" phrasing, stays on the loud
// skipped path. No /i, for the family's stated reason: capitalisation + the
// anchors are what keep a mid-sentence clause off the derived path.
const SELF_DAMAGE = /^This Pokémon also does (\d+) damage to itself\.$/;
// The additive damage-scaling family — "This attack does N more damage for each
// <resource>.", anchored end to end like every rule here. It is NOT a
// deriveAttackEffect op: this folds N × (a resource counted at declaration) into
// the printed base BEFORE the §8.5 W/R pipeline (attack.ts), where the deriver's
// ops all run AFTER damage — so it lives in its own reader (deriveAttackDamageBonus
// below), not the op switch. Two count sources read today, one regex each, told
// apart ONLY by the tail:
//   • the attacker's OWN damage counters (Paldean Tauros sv02-028 "Raging Horns",
//     fix-attacker "Rage"), and
//   • the opponent's TAKEN Prizes (Charizard ex sv03-125 "Burning Darkness").
// The word "more" is the DISCRIMINATOR between two sibling families that share a
// count evaluator but fold differently. With "more" it is ADDITIVE (`+`): fold
// `per × count` ONTO a printed base (the reader here). WITHOUT "more" it MULTIPLIES
// (`×`): the printed N is the PER-unit and `per × count` is the WHOLE damage, no
// base to add ("This attack does N damage for each Prize card your opponent has
// taken." — Pecharunt ex sv06.5-039 60×, Annihilape sv01-109 70×). That is a
// DISTINCT fold, not a `count` member, so it has its OWN regex + reader
// (OPPONENT_PRIZES_MULTIPLY / deriveAttackDamageMultiplier below) — the parse is
// the same `{per, count}` shape (the count evaluator is reused UNCHANGED), only
// attack.ts's fold differs. Each additive regex must therefore REFUSE its
// no-"more" twin (the multiply reader owns it), and vice versa. The anchored
// whole-sentence match and the capital `This` are the rest of the guard. No /i,
// for the family's stated reason: the anchors and the capital first word are what
// keep a mid-sentence clause off this path.
const SELF_COUNTER_SCALE =
  /^This attack does (\d+) more damage for each damage counter on this Pokémon\.$/;
const OPPONENT_PRIZES_SCALE =
  /^This attack does (\d+) more damage for each Prize card your opponent has taken\.$/;
// The "×"/multiply twin of OPPONENT_PRIZES_SCALE — the SAME Prize-count source, no
// "more": the whole damage is `per × count`, the printed base dropped (attack.ts).
// Refuses Wo-Chien ex's benched-target print ("… to 1 of your opponent's Benched
// Pokémon for each Prize …") by the mid-sentence text the anchors exclude, and
// Chien-Pao ex's discarded-Energy count ("… for each card you discarded in this
// way.") by the tail.
const OPPONENT_PRIZES_MULTIPLY =
  /^This attack does (\d+) damage for each Prize card your opponent has taken\.$/;
// The printed energy-type notations, BOTH of them: the modern brace CODE
// ("Discard a {L} Energy" — Kilowattrel, Arcanine ex) and the spelled-out name
// the swsh-era prints carry ("Discard a Fire Energy" — Charmeleon, Charizard).
// One map so the two can never drift, and so the accepted vocabulary is a
// single list rather than a regex alternation somebody edits by hand.
//
// {C} and {N} are ABSENT, matching BASIC_ENERGY_TYPES' own rule (§6.1: Colorless
// is a cost symbol, Dragon has no Basic Energy). No card prints "discard a {C}
// Energy", and admitting one would be actively wrong: Colorless is the
// conservative provision FALLBACK for every unauthored Special Energy, so a
// {C} filter would quietly match cards nobody meant. Unmapped codes fall
// through to the loud skipped path — energyTypesAreCanonical (the test) pins the
// values to BASIC_ENERGY_TYPES so a re-ingest adding a type is caught here.
export const ENERGY_TYPE_BY_CODE: Readonly<Record<string, BasicEnergyType>> = {
  G: "Grass",
  R: "Fire",
  W: "Water",
  L: "Lightning",
  P: "Psychic",
  F: "Fighting",
  D: "Darkness",
  M: "Metal",
  Y: "Fairy",
};
/** The spelled-out notation, keyed straight off BASIC_ENERGY_TYPES rather than
    re-listed — so the two notations cannot resolve to different vocabularies, and
    a type added to the schema is admitted here by construction. */
const ENERGY_TYPE_BY_NAME: Readonly<Record<string, BasicEnergyType>> = Object.fromEntries(
  BASIC_ENERGY_TYPES.map((type) => [type, type]),
);
// The TYPED self-discard: "Discard a|all|{N} {type} Energy from this Pokémon."
// — the same §8 attack cost as its untyped siblings above, narrowed to one
// energy type. Both notations in one pattern, and both alternations built FROM
// the map, so the regex cannot admit a code or name the map won't resolve.
//
// The near-misses this must refuse are all real catalog rows, and every one of
// them is refused by the whole-sentence anchoring rather than by the type part:
// Pawmot ex "Discard 2 {L} Energy from this Pokémon. This attack does 220
// damage to 1 of your opponent's Pokémon." (a rider clause), Bellibolt ex "YOU
// MAY discard 2 {L} Energy…" (optional, not a cost), Mewtwo VSTAR "Discard UP TO
// 3 Psychic Energy from YOUR POKÉMON." (the whole board, and declinable), and
// Decidueye "Discard a Basic {G} Energy CARD FROM YOUR HAND." (a print in hand,
// not provision on the board — the one row where `basicEnergy` would be right).
// Do NOT add /i here, for the reason spelled out on the untyped family above: a
// capitalised first word is half of what keeps a mid-sentence clause (Krookodile's
// "…, discard an Energy…") off the derived path, and the anchors are the other
// half. No catalog row false-positives under /i today, so this is latent — which
// is exactly when a warning is worth writing down.
//
// The `all|a|\d+` ordering carries NO weight (backtracking makes `a|all` behave
// identically, since `a` must be followed by a space); it reads
// longest-first only for the human.
const TYPED_SELF_DISCARD = new RegExp(
  `^Discard (all|a|\\d+) (?:\\{([${Object.keys(ENERGY_TYPE_BY_CODE).join("")}])\\}` +
    `|(${Object.keys(ENERGY_TYPE_BY_NAME).join("|")})) Energy from this Pokémon\\.$`,
);

/** Parse printed attack text into executable ops, or null when the text is
    ANYTHING but one of the fourteen recognized whole sentences (leading/trailing
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

  // 6. "This attack (also) does {N} damage to each of your opponent's Benched
  //    Pokémon." — the spread hit that the M4 KO generalization reaches (a
  //    benched Pokémon can now be Knocked Out). `damage` is HP, not counters.
  //    The optional "also" rider (Cetoddle sv02-053 "Avalanche" — 30 to the
  //    Active, then 10 to each Bench) shares this case: the main hit rides the
  //    attack's `damage` field, this clause is its secondary bench spread.
  match = SPREAD_EACH_BENCH.exec(effect);
  if (match !== null) {
    return [{ op: "spreadDamage", target: "opponentBench", amount: Number(match[1]) }];
  }

  // 6b. "This attack does N damage to 1 of your opponent's Benched Pokémon for
  //     each Prize card your opponent has taken. (Don't apply Weakness and
  //     Resistance for Benched Pokémon.)" — Wo-Chien ex "Covetous Ivy". A CHOSEN
  //     single benched target (damageChosen's count-1 park), the amount SCALED by
  //     the opponent's TAKEN Prizes and dealt as attack damage (`deals`), not a
  //     placed counter. A printed 0-per is not a real card — left on the loud path.
  match = BENCHED_SNIPE_TAKEN_PRIZES.exec(effect);
  if (match !== null) {
    const per = Number(match[1]);
    if (per >= 1) {
      return [
        {
          op: "damageChosen",
          target: "opponentBench",
          amount: per,
          count: 1,
          deals: true,
          perTakenPrize: true,
        },
      ];
    }
  }

  // 6c. "This attack also does N damage to 1 of your opponent's Benched Pokémon.
  //     (Don't apply Weakness and Resistance for Benched Pokémon.)" — the flat
  //     RIDER (Miraidon "Lightning Laser", Tadbulb, Pawmot, Bellibolt, …): the
  //     SAME count-1 `deals` snipe as Covetous Ivy but WITHOUT `perTakenPrize`
  //     (a fixed N, not Prize-scaled). The main hit rides the `damage` field; this
  //     clause is the secondary benched snipe. A printed 0 is not a real card.
  match = ALSO_BENCHED_SNIPE.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    if (amount >= 1) {
      return [{ op: "damageChosen", target: "opponentBench", amount, count: 1, deals: true }];
    }
  }

  // 6d. "This attack does N damage to 1 of your opponent's Pokémon. (Don't apply
  //     Weakness and Resistance for Benched Pokémon.)" — the ANY-target snipe
  //     (Fezandipiti ex "Cruel Arrow", Rotom "Linear Attack"): the WHOLE attack is a
  //     chosen hit on the Active OR a Bench, `target: "opponentAny"` so a hit that
  //     lands on the Active takes W/R (§8.5). A printed 0 is not a real card. When
  //     group 2 caught Umbreon "Feint Attack"'s "…isn't affected by Weakness or
  //     Resistance, or by any effects on that Pokémon." tail, the hit sets `ignoreWR`.
  match = CHOSEN_ANY_TARGET.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    if (amount >= 1) {
      return match[2] === undefined
        ? [{ op: "damageChosen", target: "opponentAny", amount, count: 1, deals: true }]
        : [{ op: "damageChosen", target: "opponentAny", amount, count: 1, deals: true, ignoreWR: true }];
    }
  }

  // 7/8/9. "Discard an Energy from this Pokémon." / "Discard {N} Energy from this
  //        Pokémon." / "Discard all Energy from this Pokémon." — the self-discard
  //        attack cost (§8), the first DERIVED attack effect that can PARK: with
  //        two different Energy attached, which one goes is a real decision, so
  //        the attack resolves through the attackEpilogue stage (attack.ts).
  //        "all" has no decision and resolves inline.
  if (SELF_DISCARD_ONE.test(effect)) {
    return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } }];
  }
  match = SELF_DISCARD_N.exec(effect);
  if (match !== null) {
    const count = Number(match[1]);
    // A printed 0 is not a real card and would derive to a silent no-op; leave
    // anything but a positive count on the loud skipped path.
    if (count >= 1) {
      return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count }];
    }
  }
  if (SELF_DISCARD_ALL.test(effect)) {
    return [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" }];
  }

  // 10. "Discard a|all|{N} {type} Energy from this Pokémon." — the TYPED
  //     self-discard, the same §8 cost narrowed to one energy type. `{L}` means
  //     an Energy that PROVIDES {L}, not a Basic Lightning card, which is the
  //     whole reason this needs `providesEnergy` rather than `basicEnergy`: a
  //     Luminous Energy attached to Kilowattrel IS a {L} Energy (until another
  //     Special Energy demotes it to {C}), and the attack that just paid its
  //     {L} cost with it must be able to discard it.
  match = TYPED_SELF_DISCARD.exec(effect);
  if (match !== null) {
    // Exactly one of the two notation groups matched; an unmapped brace code
    // cannot reach here (the character class is built from the map's keys).
    const energyType =
      match[2] === undefined
        ? ENERGY_TYPE_BY_NAME[match[3] ?? ""]
        : ENERGY_TYPE_BY_CODE[match[2]];
    const amount = match[1];
    if (energyType !== undefined && amount !== undefined) {
      const filter = { kind: "providesEnergy", energyType } as const;
      if (amount === "all") {
        return [{ op: "discardEnergy", from: "yourActive", filter, count: "all" }];
      }
      if (amount === "a") {
        return [{ op: "discardEnergy", from: "yourActive", filter }];
      }
      const count = Number(amount);
      // A printed 0 is not a real card and would derive to a silent no-op —
      // the same guard the untyped exact-N rule carries.
      if (count >= 1) {
        return [{ op: "discardEnergy", from: "yourActive", filter, count }];
      }
    }
  }

  // 11/12. "Discard an Energy from your opponent's Active Pokémon.", bare and
  //        behind a coin flip — the hammer family's attack twins, the same op
  //        Mawile's Ability runs with a wider filter.
  if (OPPONENT_ACTIVE_DISCARD.test(effect)) {
    return [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }];
  }
  if (FLIP_OPPONENT_ACTIVE_DISCARD.test(effect)) {
    return [
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ];
  }

  // 13. "Your opponent reveals their hand. Choose a Supporter card you find
  //     there and put it on the bottom of their deck." — Greavard "Underworld
  //     Stroll", the attack twin of Ortega's Supporter sentence (which is
  //     registry-authored: its second sentence gates an opponent draw no attack
  //     prints). Derived rather than registry-authored because CardProgram's
  //     `attack` field is per-CARD and Greavard has a second, effect-less
  //     attack it must not leak onto.
  if (REVEAL_BOTTOM_SUPPORTER.test(effect)) {
    return [{ op: "bottomFromOpponentHand", filter: { kind: "supporter" } }];
  }

  // 14. "This Pokémon also does {N} damage to itself." — the recoil clause
  //     (Skeledirge sv01-038 "Blazing Shout"). The engine's FIRST attack that
  //     damages its OWN board: the resulting self-KO is why the attack epilogue
  //     now sweeps both seats (flow.ts finishAttack). Never parks — placing the
  //     damage is not a decision.
  match = SELF_DAMAGE.exec(effect);
  if (match !== null) {
    const amount = Number(match[1]);
    // A printed 0 is not a real card and would derive to a silent no-op — the
    // same guard the exact-N discard rules carry; leave it on the loud path.
    if (amount >= 1) return [{ op: "damageSelf", amount }];
  }

  return null;
}

/** A count-scaled damage clause — `per × (a counted resource)`, the parsed shape
    BOTH scaling families produce (the additive "+" reader `deriveAttackDamageBonus`
    and the "×"/multiply reader `deriveAttackDamageMultiplier`). Deliberately NOT an
    `EffectOp`: it is PRE-damage math the caller computes (attack.ts), NOT a step
    the interpreter runs — every `deriveAttackEffect` op instead reads a sentence
    that runs AFTER damage, so the scaling derivers are disjoint from the op deriver
    and a card carries at most one (the whole-sentence anchor means a scaling
    sentence never also derives an op). The two families differ ONLY in attack.ts's
    fold — additive folds `per × count` onto the printed base (Paldean Tauros
    "Raging Horns" — 10 per damage counter on the attacker), multiply makes it the
    WHOLE damage with no base (Pecharunt ex "Irritated Outburst") — so they share
    this interface and the `count` evaluator. `count` is a union of two REAL readers
    — the attacker's own damage counters and, since 0.35.0, the opponent's TAKEN
    Prizes — a member each, not a second interface. */
export interface AttackDamageBonus {
  per: number;
  count: DamageCountSource;
}
/** The resource an `AttackDamageBonus` counts. Two members: the attacker's OWN
    damage counters (Paldean Tauros "Raging Horns") and the opponent's TAKEN Prizes
    (Charizard ex "Burning Darkness"), each read by its own anchored sentence. */
export type DamageCountSource =
  | { kind: "damageCountersOnSelf" }
  | { kind: "opponentPrizesTaken" };

/** Parse a printed additive damage-scaling sentence into its `per` amount and
    count source, or null when the text is anything but one of the two anchored
    sentences this reads (self damage counters, the opponent's taken Prizes) — the
    "×"/multiply Prize family (no "more"), a lowercased "this", a missing trailing
    period, and any leading/trailing text all stay on the loud ATTACK_EFFECT_SKIPPED
    path. Disjoint from `deriveAttackEffect`: this reads the SAME effect text but
    folds into the base pre-W/R rather than running after damage (attack.ts owns
    the fold). */
export function deriveAttackDamageBonus(text: string): AttackDamageBonus | null {
  const effect = text.trim();
  // A printed 0 adds nothing (either arm) — leave it on the loud
  // ATTACK_EFFECT_SKIPPED path, the guard the self-damage / exact-N discard rules
  // carry.
  const selfCounters = SELF_COUNTER_SCALE.exec(effect);
  if (selfCounters !== null) {
    const per = Number(selfCounters[1]);
    if (per >= 1) return { per, count: { kind: "damageCountersOnSelf" } };
  }
  const opponentPrizes = OPPONENT_PRIZES_SCALE.exec(effect);
  if (opponentPrizes !== null) {
    const per = Number(opponentPrizes[1]);
    if (per >= 1) return { per, count: { kind: "opponentPrizesTaken" } };
  }
  return null;
}

/** Parse a printed "×"/multiply damage-scaling sentence — "This attack does N
    damage for each Prize card your opponent has taken." (NO "more") — into the
    same `{per, count}` shape as the additive reader, or null for anything else.
    The two share the count evaluator (opponentPrizesTaken); they differ only in
    attack.ts's fold: the additive reader's `per × count` adds to a printed base,
    THIS family's IS the whole damage (the printed "N×" base is the per-unit, so
    attack.ts drops it — count 0 → 0 damage). Refuses the additive "more" twin
    (that reader owns it), Wo-Chien ex's benched-target print and Chien-Pao ex's
    discarded-Energy count (both a different shape), a lowercased "this", a missing
    trailing period, and any leading/trailing text — all stay on the loud
    ATTACK_EFFECT_SKIPPED path. Disjoint from `deriveAttackEffect` for the same
    reason the additive reader is (attack.ts owns the fold). */
export function deriveAttackDamageMultiplier(text: string): AttackDamageBonus | null {
  const opponentPrizes = OPPONENT_PRIZES_MULTIPLY.exec(text.trim());
  if (opponentPrizes !== null) {
    // A printed 0 does nothing — left loud, the guard the additive rules carry.
    const per = Number(opponentPrizes[1]);
    if (per >= 1) return { per, count: { kind: "opponentPrizesTaken" } };
  }
  return null;
}

/** The matched status word, lowercased into the event vocabulary. The regex
    alternation guarantees the word; the fallback only satisfies
    noUncheckedIndexedAccess. */
function statusOf(word: string | undefined): StatusName {
  return STATUS_OF_WORD[(word ?? "Asleep") as StatusWord];
}
