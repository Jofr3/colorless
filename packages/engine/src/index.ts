// @luminous/engine — deterministic, pure PTCG game engine (P3).
//
// M1 surface: the setup sequence (shuffle, coin flip, hands + mulligans +
// compensation, placements, prizes), the turn loop with its mandatory draw
// and deck-out loss, energy attach, bench plays, retreat and pass. M2 adds
// the attack step: costs, weakness/resistance damage, Knock Outs with prize
// taking and forced promotion, and the full §14 win check — resolved through
// a staged turn tail that can park on player decisions. M3 adds the Special
// Conditions (§12) with their attack/retreat gates and the confusion flip,
// the Pokémon Checkup (§13) with its ticks, recoveries and KOs, and the
// first text-derived attack effects (effects.ts). M4 begins with evolution
// (§10): an Evolution card placed on an in-play Pokémon whose top card it
// evolves from, carrying over damage/energy/tools and clearing Special
// Conditions, under the §4/§10 timing rules. Spec:
// docs/workstreams/simulator.md; ruleset: docs/reference/ptcg-rules.md.
// Everything is (state, action) → result: no classes, no wall clock, no
// unseeded randomness — the same seed and actions replay identically. The
// package is shared by the web app (local play + the semantic animation
// event stream) and the api Worker (authoritative online matches, P4).

import type { ApplyResult, GameAction } from "./actions";
import { err } from "./actions";
import { attack, promote, takePrizes } from "./attack";
import { attachTool, playTrainer, rareCandy, resolveEffect, useAbility } from "./cardplay";
import { concede } from "./flow";
import {
  chooseFirstPlayer,
  setupDrawExtra,
  setupPlaceActive,
  setupPlaceBench,
  setupReady,
} from "./setup";
import { attachEnergy, endTurn, evolve, playBasicToBench, retreat } from "./turn";
import type { GameState, Seat } from "./types";

/** Engine milestone marker (M5 op-slice: **`attachFromTop`** — the from-the-top
    ATTACH the lookAtTopN slice deferred. Look at the top N of your own deck and
    attach the Energy you find there straight onto your Pokémon, "**in any way you
    like**" — so each attached card names its OWN destination, and the answer is a
    MAP (card → Pokémon) rather than the flat list every other card prompt takes
    (the new `attachCards` prompt). Two consumers differing in every rider the op
    has: **Electric Generator** (Item — top 5, up to 2 Basic {L} Energy CARDS, onto
    your BENCHED {L} Pokémon) and **Hydreigon "Tri Howl"** (Ability, once per turn
    — top 3, ANY number of Energy cards, onto ANY of your Pokémon).

    The leftovers clause is the design point: "Shuffle the other cards back" is a
    trailing `shuffleDeck` op (those cards never left the deck), but "**Discard**
    the other cards" must name exactly the looked-at cards that were not attached,
    so it is `discardRest` ON the op — and it fires on the whiff and the decline
    too, which is the difference between Tri Howl costing three cards and costing
    nothing. The filter reads the PRINT (`basicEnergy` / `anyEnergy`), never
    `providesEnergy`: these cards sit in a DECK, attached to nothing (§6.5).
    providesEnergy was 0.24.0; the discardEnergy attack arms 0.23.0;
    attackEpilogue/park 0.22.0; discardEnergy 0.21.0; board conditions 0.20.0).

    **0.26.0 — `payFromHand`, the printed COST that parks.** "You can use
    this card only if you discard 2 OTHER cards from your hand" (Ultra Ball,
    Earthen Vessel) and "You must discard a card from your hand in order to use
    this Ability" (Tinkaton, Revavroom, Meowscarada ex, Radiant Blastoise) are ONE
    mechanism in two printed wordings — and the "other" appears exactly when the
    paying card is itself in the hand, which is why the play GATE excludes the
    played uid and the op carries no flag. It is the FIRST op of its program, so
    the payment happens before what it buys: Revavroom pays, THEN draws to a hand
    size that counts the payment. MANDATORY and exact, so `chooseCards` gained a
    `min` (0 for every printed "up to", `count` here — the one park with no
    decline) and a `"discard"` destination; `AbilityProgram.cost` is GONE, its one
    consumer migrated onto the op it was the fungible special case of.

    **0.27.0 — the printed number is a FLOOR, and the cost that is not a
    discard.** Two mandatory-exactly-N fixes, one on each prompt that could
    already say "up to". (1) `choosePokemonMulti` gained `min`/`max` +
    `declinable`: "put 3 damage counters on **1** of your opponent's Benched
    Pokémon" is not "up to 1", so Meowscarada ex / Radiant Blastoise can no longer
    pay an irreversible hand cost and then place nothing, while Hawlucha's printed
    "**you may** choose 2" stays all-or-nothing — 2 or none, never 1 of 2 — which
    is a decline the framework's auto-fired triggers leave nowhere else to live.
    (2) `discardFromHandCost` became **`payFromHand`** with a required
    destination: `to: "deckBottom"` pays UNDER THE DECK, landing **Dendra** ×3
    ("Put a card from your hand on the bottom of your deck. If you do, draw cards
    until you have 5") — nothing is discarded, yet the mechanism is the same
    mandatory pick, the same conditional benefit and the same printed play gate,
    which Dendra states as its contrapositive. HAND_COST_PAID carries `to`,
    because a payment to the discard becomes public and one to the deck never
    does. **Skwovet** ×2 ("Nest Stash") reaches the same destination with the
    WHOLE hand and needed no new op at all — `handRefresh` with Iono's `toBottom`
    + `onlyIfAnyMoved`.

    **0.28.0 — a clause can read what an earlier clause DID (§9.2).** The
    engine's first op→op data flow: an op files the uids it moved under a named
    `EffectSlot`, and a later op in the same program reads them. Two readers, one
    record — the printed "in this way" / "if you do" is a new `recordGate` (the
    third and last gate, spliced like the other two), and "you can't choose a card
    you discarded with the effect of this card" is `discardPileRetrieval.exclude`.
    Lands **Miriam** ×3 and **Superior Energy Retrieval** ×2, and lets **Dendra**
    finally say its own "if you do". The record rides `EffectContinuation`, NOT
    `EffectContext`: it is an accumulator, sibling to `rest`, where the context is
    a constant. And it is keyed by SLOT rather than by position — Miriam shuffles
    the deck between the retrieval and the sentence about it, so "the previous op"
    would have been wrong on the very first card that needed this.

    0.29.0 — `attachFromDeck`: SEARCH your deck for Energy and attach it straight
    onto your Pokémon, the deck-search sibling of `attachFromTop`. It shares that
    op's `attachCards` MAP prompt (the printed clause is the same one) and differs
    only where the SOURCE forces it to: the candidate set is the whole deck, so it
    is COLLAPSED to `max` representatives per interchangeable class (D42's rule —
    a real list holds a dozen Basic {R}), and there is no leftovers clause, so the
    printed "Then, shuffle your deck" is the usual trailing `shuffleDeck`. Two
    printed target rules, one new field: "in any way you like" (**Charizard ex**
    ×4, an onEvolve trigger) is no rider at all, and "for each of those Pokémon"
    (**Janine's Secret Art** ×2) is `maxPerTarget: 1`. Janine also extends §9.2 —
    `recordGate.contains` narrows the gate from "did the earlier op do anything"
    to "did anything land on your ACTIVE", which is what her printed self-poison
    turns on.

    0.30.0 — `EffectContext.sourceUid`: the context now names the Pokémon whose
    effect is running — the printed "this Pokémon" — set at every run site that
    knows it (an activated Ability's own Pokémon, a trigger's, the attacker) and
    ABSENT for a Trainer program, which has no such Pokémon. Constant for the
    run, rides the continuation across parks (JSON, D14). First reader:
    `attachFromDeck.toSelf`, the third printed target rule ("attach it to THIS
    Pokémon"), which lands **Pawmot** ×2 ("Electrogenesis") — a benched Pawmot
    feeds ITSELF, the exact sentence no seat-relative target rule could say.

    0.31.0 — `healChosen.upTo`: the printed "up to N … each" heal (Saguaro ×3,
    "Choose up to 2 of your Pokémon and heal 50 damage from each of them") —
    the first consumer of choosePokemonMulti's min: 0 end (§9.1's "up to"
    legalizes 0..max), parked at every non-empty board with §8.6 clamping the
    ask.

    0.32.0 — `bottomFromOpponentHand` + `opponentMayDraw`: the opponent reveals
    their hand (a new public HAND_REVEALED — every uid, because that is what
    the printed word means), the controller bottoms a chosen card onto the
    OPPONENT's deck (CARD_TO_BOTTOM_OF_DECK, named — the whole move happened
    face up), and the gated draw is the engine's first decision ANSWERED BY THE
    NON-CONTROLLER: the park carries a decider, the phase an `answerer` (absent
    when it is the controller, so every older park is byte-identical), and
    resolveEffect admits only that seat. Ortega ×2 authored (the Miriam shape
    across the table), Greavard "Underworld Stroll" DERIVED (the Supporter-
    filtered attack twin — its second attack is why the card-level registry
    `attack` field could not carry it). programPlayable gains the public-count
    empty-opponent-hand gate (the Catcher/Hammer class) and is now EXPORTED —
    the HUD greys with the predicate that rejects.

    0.33.0 — `damageSelf` + the TWO-seat attack epilogue: the recoil clause "This
    Pokémon also does N damage to itself" (Skeledirge sv01-038 "Blazing Shout")
    is the engine's first attack that damages its OWN board, placed flat as
    COUNTERS_PLACED source "self" (the confusion self-hit's model, OUTSIDE the
    §8.5 W/R pipeline). finishAttack's KO sweep widened from the single defender
    seat to BOTH, in [defender, attacker] order so §8.1's "the player whose turn
    it is takes their Prizes first" holds, and a self-KO prizes to the defender.
    This makes the §14 double-KO tie reachable from the attack path for the first
    time — collectKnockOuts' existing speculative guard owns it (the D42 debt,
    paid).

    0.34.0 — count-scaled attack damage (the additive "+" family): the printed
    "This attack does N more damage for each damage counter on this Pokémon"
    (Paldean Tauros sv02-028 "Raging Horns", fix-attacker "Rage") is now SIMULATED
    — `deriveAttackDamageBonus` folds N × (the attacker's OWN damage counters) into
    the base BEFORE the §8.5 W/R pipeline (attack.ts), alongside the continuous
    Vitality Band bonus. The new DAMAGE_DEALT `scaled` field carries it (present
    only when it applied), and the "+"/text is no longer flagged loudly for these
    cards. Charizard ex sv03-125 "Burning Darkness" (a DIFFERENT count source — the
    opponent's taken Prizes) STAYS on the ATTACK_EFFECT_SKIPPED path, the
    anchor-guard witness proving the deriver is narrow.

    0.35.0 — the count union's SECOND member: Charizard ex sv03-125 "Burning
    Darkness" (180+, "… for each Prize card your opponent has taken") now SIMULATES,
    folding 30 × (the opponent's TAKEN Prizes = 6 − their remaining pile) into the
    base. `scaledAttackDamage` widened to reach the opponent's board; the
    unsimulated-"+" witness moved to Entei sv03-030 (an attached-Energy count
    source, still no reader). The "×"/multiply Prize family (Pecharunt ex — no
    "more") stays loud.

    0.36.0 — the "×"/multiply damage family, the additive family's sibling: "This
    attack does N damage for each Prize card your opponent has taken." (NO "more" —
    Pecharunt ex sv06.5-039 60×, Annihilape sv01-109 70×) now SIMULATES. It reuses
    the additive family's `opponentPrizesTaken` count evaluator UNCHANGED via a new
    reader `deriveAttackDamageMultiplier`; the only difference is the fold — the
    printed "N×" base is the per-unit, so it is DROPPED and `per × count` is the
    WHOLE damage (count 0 → 0 damage), where the additive family adds `per × count`
    onto a printed base. Wo-Chien ex (benched-target) and Chien-Pao ex
    (discarded-Energy count) stay loud, the anchor-guard witnesses.

    0.37.0 — the "×"/multiply family's benched-TARGET sibling: Wo-Chien ex sv02-027
    "Covetous Ivy" ("This attack does 60 damage to 1 of your opponent's Benched
    Pokémon for each Prize card your opponent has taken.") now SIMULATES. Its target
    is one CHOSEN Benched Pokémon rather than the Defender, so it is NOT the pre-W/R
    Defender fold (D56) but a `damageChosen` op — the put-counter snipe (Hawlucha /
    Meowscarada) extended with `deals` (ATTACK DAMAGE, a DAMAGE_DEALT with the
    benched reduction passive, not a flat placed counter) and `perTakenPrize` (the
    amount is `60 × the opponent's taken Prizes`, read from state in the interpreter;
    0 taken → no damage and no pick). The "6 − remaining" Prize formula is now the
    shared `takenPrizes` helper (types.ts), used by both this and the D55/D56 fold.
    Chien-Pao ex "Hail Blade" (a DISCARDED-Energy count, and a PRE-damage park) stays
    loud, the remaining "×" sibling.

    0.38.0 — the flat benched-snipe RIDER family: "This attack ALSO does N damage to 1
    of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for
    Benched Pokémon.)" now SIMULATES — a SECONDARY snipe after the main damage (which
    rides the attack's own `damage` field). It is the SAME count-1 `deals` snipe as
    D57's Covetous Ivy WITHOUT `perTakenPrize` (a fixed N, not Prize-scaled), so it is
    a new derive `ALSO_BENCHED_SNIPE` and ZERO new op/interpreter code. Lands ~15
    prints across Miraidon / Tadbulb / Pawmot / Bellibolt / Decidueye ex / Jumpluff /
    Orthworm / Palafin / Pyroar / Dartrix. Flamigo's "If Flamigo is on your Bench, …"
    (a board-condition gate) and the "each of" / "2 of" / "1 of YOUR Benched" variants
    stay loud, each a different shape.

    0.39.0 — the ANY-target snipe family: "This attack does N damage to 1 of your
    opponent's Pokémon." (the WHOLE attack — the Active OR a Bench) now SIMULATES.
    `damageChosen` gained a `target: "opponentAny"` mode (candidates = the opponent's
    Active + Bench, via `oppAnyRefs`), and `placeSnipe` an Active arm (`snipeActive`):
    a snipe that lands on the ACTIVE runs the §8.5 W/R pipeline (base → ×Weakness →
    −Resistance → −reduction), where a Benched target stays flat — the rules'
    "Weakness/Resistance apply only to the Active" made conditional on the pick.
    Fezandipiti ex sv06.5-038 "Cruel Arrow" (100), Rotom sv01-069 "Linear Attack"
    (20), Paldean Tauros "Aqua Dive", Bellibolt ex, Kilowattrel. Umbreon "Feint
    Attack" (a different W/R-immunity wording), Pawmot ex (a discard cost), and
    Magikarp (a coin flip) stay loud.

    0.40.0 — the authoritative per-viewer REDACTOR (P4 online, increment 1c). The
    engine gains `redactGame(state, seat) → RedactedGame` (redact.ts): the PURE
    server-side hidden-information filter the lobby Durable Object runs once per
    connected socket, so no full `GameState` (opponent hand/deck/prizes) ever
    crosses the network. It restates the web app's playmat redaction (opponent
    hand/prizes/decks as counts, setup in-play as anonymous backs) against the
    neutral `@luminous/schema` `RedactedGame` wire shape — no image URLs, no
    engine imports on the far side. Its subtle phase derivation (turn owner /
    who-must-act / parked interrupt / outcome) is the exhaustive `phaseViewOf`
    switch, MOVED here from that projection (phaseView.ts) so both share one
    source; the web projection now imports it. No game-logic change — this slice
    adds a read surface, not a rule.

    0.41.0 — CONCEDE (P4 online, increment 3c-ii). The first change to the win
    vocabulary since M1: `GameOverReason` gains **`conceded`** and a new
    `concede(state, action)` (flow.ts, beside `finishGame`) hands the game to the
    opponent. Unlike every other action it is legal in ANY phase but `gameOver` —
    a concede that only worked on your own turn would be useless in the situations
    it exists for (an opponent who walked away mid-turn, a park nobody can answer),
    and it is the one action that can always END a match that is otherwise stuck.
    ONE reason covers both triggers — a player pressing concede, and the P4 server
    forfeiting for a player who abandoned an online match — because to the opponent
    they are the same event, and the engine has no business knowing about sockets.
    This IS a rules-surface change (a new way a game can end), hence the minor
    bump; the two reason→prose maps (log.ts `GAME_OVER_REASONS`, the web's
    `GAME_OVER_DETAIL`) became total Records in the same pass, so a future reason
    is a compile error rather than silently rendering as "the deck ran out".

    0.42.0 — DEFIANCE BAND (P3-M5, the `conditionalDamageBonus` row). The D40
    `BoardCondition` vocabulary's third consumer, and its first PASSIVE one — the
    conditional twin of Vitality Band. `PassiveEffects` gains
    `damageBonusBeforeWRIf: { amount, cond }` (Tool: "+30 before W/R while you
    have more Prize cards remaining than your opponent"). continuous.ts stays the
    single seat-FREE aggregation point, now collecting these gated bonuses RAW in
    a `conditionalDamageBonusBeforeWR` list; the fold lives in interpreter.ts's
    new `attackerPreWRBonus`, shared by the two pre-W/R read sites (attack.ts's
    main hit + `snipeActive`), so the condition is evaluated ONCE beside the sole
    `conditionHolds` — the only place that knows the attacker's seat, which a
    BoardCondition is relative to. Kept out of the unconditional
    `damageBonusBeforeWR` so the defender-reduction / HP reads cannot be credited
    an attacker's conditional bonus. Reuses `morePrizesThanOpponent` (no new
    condition), so it is a card row + one new passive field, not a new primitive.
    No web change (damage bonuses are engine-internal, surfaced only via the
    `DAMAGE_DEALT` log event). Choice Belt — the row's other card — is a
    target-type gate ("…Active Pokémon V"), a different shape, left for its slice.

    0.43.0 — CHOICE BELT (P3-M5, the `conditionalDamageBonus` row's 2nd and last
    card). The target-gated twin of Vitality Band: +30 before W/R, but only when
    the DEFENDER is a Pokémon V. `PassiveEffects` gains a sibling field
    `damageBonusBeforeWRIfTarget: { amount, targetSuffix }`, aggregated seat-free
    by continuous.ts into a new `targetConditionalDamageBonusBeforeWR` list and
    folded at the two pre-W/R read sites via the SAME `attackerPreWRBonus`, which
    now also takes the `defenderCard` (both the main hit and `snipeActive` had it
    in hand). The "is a Pokémon V" test needs no schema/ingest/DB change: the
    suffix tcgdex drops at ingest is ALSO printed in the card NAME, which IS
    persisted, so a new `cards.ts pokemonSuffixOf` derives it from `name`,
    reading "V" LITERALLY (a VMAX/VSTAR defender is untouched). The current
    SV-era pool holds no Pokémon V, so the gate is dormant against the live
    catalog and correct — it fires once a prior-era set is ingested. Distinct
    from Defiance Band's field because the gate reads the DEFENDER, not the
    attacker's board, so it is NOT the D40 `BoardCondition` vocabulary. No
    web/API/DB/schema change (damage bonuses stay engine-internal).

    0.44.0 — PRIZE VALUE (P3-M5, §8.1). `prizeValueOf` stops returning 1 for every
    KO: a VMAX is worth 3 Prizes, any other rule box (ex / V / VSTAR / GX) 2, a
    plain body 1. The class is read off `pokemonSuffixOf` (the rule-box marker the
    NAME still carries after ingest drops tcgdex's `suffix`), so — like Choice Belt
    (0.43.0) — no schema/ingest/DB change was needed to value an ex at its two
    Prizes. The `count` this feeds was already a variable at the two prize read
    sites (flow.ts's takePrizes stage + the §14 tie-guard speculation), both of
    which clamp to the Prizes that remain, so a 2-Prize KO with one Prize left
    takes the last one and wins rather than over-drawing — no flow change. The
    feared blast radius never landed: every existing KO test knocks out a plain
    body, so the whole suite stayed green; the new behaviour is pinned by a new
    prizeValue.test.ts (the KO→count wiring, on a dedicated mulligan-free
    PRIZE_DECK) plus unit cases in cards.test.ts. No longer dormant against the
    live SV-era pool, which is full of ex Pokémon. No web/API/DB/schema change.

    0.45.0 — SPREAD "ALSO" RIDER (P3-M5, the each-of-spread rider). The word
    "also" is now optional in the `SPREAD_EACH_BENCH` deriver, so "This attack
    ALSO does N damage to each of your opponent's Benched Pokémon." derives to
    the SAME `spreadDamage` op as the bare form — Cetoddle sv02-053 "Avalanche"
    (30 to the Active, then 10 to each Bench), a real print in the live SV pool.
    A one-token regex relaxation, ZERO new op/interpreter/registry code: the
    main hit rides the attack's `damage` field either way, so "also" is pure
    emphasis, not a second op. One rule for both wordings (unlike the snipe
    family, where "1 of" vs "each of" pick genuinely different ops). Pinned by a
    derive assertion on the verbatim card text; the full §8.5 spread flow is
    already covered by fix-sniper's Spread Shot. No web/API/DB/schema change.

    0.46.0 — FEINT ATTACK: the any-target snipe that ignores W/R (P3-M5). Umbreon
    "Feint Attack" (sv03-130) prints "This attack does 50 damage to 1 of your
    opponent's Pokémon. This attack's damage isn't affected by Weakness or
    Resistance, or by any effects on that Pokémon." — the `CHOSEN_ANY_TARGET`
    deriver now captures that second sentence and sets `damageChosen.ignoreWR`,
    which nulls Weakness/Resistance AND the target's `damageReductionAfterWR`
    passive on both snipe arms (the "any effects on that Pokémon" half), while
    KEEPING the attacker's own pre-W/R bonus (an effect on the attacker, not the
    target). One flag threaded into placeSnipe/snipeActive; ZERO new op — a field
    on the existing snipe op. No web/API/DB/schema change.

    0.47.0 — HAIL BLADE: the variable-count discard whose damage scales off it,
    and the engine's FIRST registry-authored attack (P3-M5). Chien-Pao ex
    (sv02-061) "Hail Blade" prints "You may discard any amount of {W} Energy from
    your Pokémon. This attack does 60 damage for each card you discarded in this
    way." — the family's hardest damage card. THREE gaps closed together:
    (1) `discardEnergy` gains a `from: "yours"` arm (the WHOLE own board, the
    printed "your Pokémon", vs `yourActive`'s "this Pokémon") and a `count: "any"`
    mode — the one DECLINABLE discard, 0..all, a new `DiscardScope {kind:"upTo"}`
    whose pick may be empty; (2) it also gains a §9.2 `recordAs`, filing the
    discarded uids under the new `discarded` EffectSlot; (3) a new `damageDefender`
    op reads that count and deals `per × N` to the DEFENDER through snipeActive's
    full §8.5 W/R pipeline (Weakness doubles, the attacker's pre-W/R bonus adds) —
    genuine attack damage, so the printed "60×" base is SUPPRESSED (attack.ts owns
    that: a program that deals the main damage drops the base like the multiply
    family does). Model A (post-damage, record-driven) because §8 runs damage
    BEFORE the program: an attack whose number depends on a mid-attack choice
    re-enters the W/R math from inside the program, after the choice. Registry-
    AUTHORED (the deriver still refuses the variable-count sentence). No
    web/API/DB/schema change (the HUD's discard dialog gained the upTo/declinable
    branch). */
export const engineVersion = "0.47.0";

export type {
  ApplyResult,
  AttachEnergyAction,
  AttachToolAction,
  AttackAction,
  ChooseFirstPlayerAction,
  EndTurnAction,
  EngineError,
  ErrorCode,
  EvolveAction,
  GameAction,
  PlayBasicToBenchAction,
  PlayTrainerAction,
  PromoteAction,
  RareCandyAction,
  ResolveEffectAction,
  RetreatAction,
  SetupDrawExtraAction,
  SetupPlaceActiveAction,
  SetupPlaceBenchAction,
  SetupReadyAction,
  TakePrizesAction,
  UseAbilityAction,
} from "./actions";
export {
  ANY_ENERGY,
  applyDamageModifier,
  attacksOf,
  basicFromHandError,
  cardOfUid,
  energyProvidesOf,
  evolveFromOf,
  hpOf,
  isBasicPokemon,
  isEnergyCard,
  isSpecialEnergy,
  parseAttackDamage,
  pokemonSuffixOf,
  prizeValueOf,
  resistanceOf,
  retreatCostOf,
  topCardOf,
  topUid,
  weaknessOf,
} from "./cards";
export type { DamageModifier, ParsedDamage, PokemonSuffix } from "./cards";
export {
  effectiveAttackCost,
  effectiveMaxHp,
  effectiveRetreatCost,
  providedEnergy,
  stadiumEffectsOf,
} from "./continuous";
export {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
} from "./effects";
export { rareCandyOptions } from "./cardplay";
export type { RareCandyOption } from "./cardplay";
export type {
  AttachTargetRiders,
  AttackDamageBonus,
  BoardCondition,
  CardFilter,
  DamageCountSource,
  EffectOp,
  EffectSlot,
} from "./effects";
/** The one BoardCondition evaluator + its printed-text describer. Exported so a
    host holding raw engine state (today's hot-seat HUD) greys out a card whose
    printed "only if" gate is unmet using the SAME logic playTrainer rejects it
    by, and can say WHY. Both take a `GameState`: a P4 remote client holds a
    projection instead, which does not carry the Stadium's owner and redacts the
    prize arrays — see the P4 notes in docs/workstreams/simulator.md before
    reusing these online. */
export { conditionHolds, conditionNote } from "./interpreter";
/** The §7.5 hand-COST gate + its printed noun phrase. Exported for the same
    reason `conditionHolds` is: the HUD must grey out a card whose printed rule is
    unmet rather than offering a button that can only reject (D19/D29), and it has
    to do that with the SAME logic playTrainer rejects by — a second
    implementation is how a card becomes greyed while it was legal.

    SAFER to expose than `conditionHolds`, not riskier: this reads only the
    viewer's OWN hand, where the condition evaluator reads Prize counts and the
    Stadium's owner (see the P4 caveat above). Pass the played uid for a Trainer
    (the printed "OTHER cards"); omit it for an Ability, whose card is on the
    board. */
export { handCostAction, handCostUnmet } from "./interpreter";
/** The would-only-whiff playability gate (gust needs an opponent Bench, Ortega
    an opponent hand…). Exported for the two gates' reason exactly: playTrainer
    and useAbility reject with it, so the HUD must grey with it — the recurring
    review finding (D46/D47) was always a row this predicate refuses lighting
    up anyway. Reads only counts and boards the viewer can see (its own limit:
    hidden-zone CONTENTS never decide playability — the Poké Ball rule), so the
    hot-seat HUD may call it freely; the P4 projection caveat above applies. */
export { programPlayable } from "./cardplay";
export type {
  DiscardScope,
  EffectChoice,
  EffectContinuation,
  EffectPrompt,
  EffectRecord,
  PokemonRef,
} from "./interpreter";
export type {
  AbilityProgram,
  CardProgram,
  EnergyOnAttach,
  EnergyProgram,
  PassiveEffects,
  StadiumEffects,
  TriggeredAbility,
  TriggerTiming,
} from "./registry";
export { programFor } from "./registry";
export type { DrawReason, GameEvent, StatusName } from "./events";
/** The exhaustive phase→view derivation (turn owner / who-must-act / parked
    interrupt / outcome), shared by the web app's per-viewer playmat projection
    and the P4 wire redactor below. `inSetup` is the board-redaction gate both
    consumers use. Pure; engine seats (the caller maps them per viewer). */
export { inSetup, phaseViewOf } from "./phaseView";
export type { PendingDecision, PhaseView } from "./phaseView";
/** The authoritative per-viewer wire redactor (P4). Runs server-side in the
    lobby Durable Object once per socket; produces the `@luminous/schema`
    `RedactedGame` — no full `GameState` crosses the network. */
export { redactGame } from "./redact";
/** The GameEvent → game-log formatter (log.ts). PURE and shared: /play builds
    the rows client-side, the P4 lobby DO builds them server-side with the full
    state. Rows are seat-keyed `SeatLogEntry` (@luminous/schema); the seat→viewer
    relabel is the web's `viewLogEntries`. */
export { formatElapsed, logFromEvents, STATUS_LABELS } from "./log";
export type { LogContext } from "./log";
export type { CoinFace } from "./rng";
export { createGame } from "./setup";
export type { CreateErrorCode, CreateGameOptions, CreateGameResult } from "./setup";
export {
  BENCH_MAX,
  DECK_SIZE,
  DEFAULT_POISON_DAMAGE,
  HAND_SIZE,
  PRIZE_COUNT,
  SEATS,
  isImmobilized,
  otherSeat,
} from "./types";
export type {
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  PendingStage,
  Phase,
  PlayerSide,
  PokemonTarget,
  Seat,
  SpecialConditions,
  StadiumInPlay,
  TurnAllowances,
  TurnPhase,
} from "./types";
/** Exported for effect handlers: the shared turn gate every in-turn action
    runs first, and the M2 cost matcher. */
export { turnGate } from "./turn";
export { costMet } from "./attack";

/** The one reducer. Dispatches on action type; each handler validates the
    phase and acting seat itself and returns ok/err without ever throwing
    or mutating its input.

    The two guards below are unreachable through the typed API but NOT through
    the wire: P4's authoritative Worker decodes actions from a client, and the
    never-throw contract has to hold for a bogus `type` or `seat` too (an
    unknown seat would otherwise index `players` with undefined and throw). */
export function applyAction(state: GameState, action: GameAction): ApplyResult {
  // A finished game accepts nothing further.
  if (state.phase.kind === "gameOver") {
    const outcome = state.phase.outcome;
    return err(
      "GAME_OVER",
      outcome.result === "win"
        ? `the game is over (${outcome.winner} won: ${outcome.reason})`
        : "the game is over (tie)",
    );
  }
  if (!isSeat(action.seat)) {
    return err("UNKNOWN_SEAT", `"${String(action.seat)}" is not a seat`);
  }
  switch (action.type) {
    case "chooseFirstPlayer":
      return chooseFirstPlayer(state, action);
    case "setupDrawExtra":
      return setupDrawExtra(state, action);
    case "setupPlaceActive":
      return setupPlaceActive(state, action);
    case "setupPlaceBench":
      return setupPlaceBench(state, action);
    case "setupReady":
      return setupReady(state, action);
    case "attachEnergy":
      return attachEnergy(state, action);
    case "playBasicToBench":
      return playBasicToBench(state, action);
    case "evolve":
      return evolve(state, action);
    case "rareCandy":
      return rareCandy(state, action);
    case "retreat":
      return retreat(state, action);
    case "attack":
      return attack(state, action);
    case "playTrainer":
      return playTrainer(state, action);
    case "attachTool":
      return attachTool(state, action);
    case "useAbility":
      return useAbility(state, action);
    case "resolveEffect":
      return resolveEffect(state, action);
    case "takePrizes":
      return takePrizes(state, action);
    case "promote":
      return promote(state, action);
    case "endTurn":
      return endTurn(state, action);
    case "concede":
      return concede(state, action);
    default:
      return err("UNKNOWN_ACTION", `unknown action type "${(action as { type: string }).type}"`);
  }
}

function isSeat(value: unknown): value is Seat {
  return value === "p1" || value === "p2";
}
