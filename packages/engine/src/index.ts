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
import {
  attachTool,
  playTrainer,
  rareCandy,
  resolveEffect,
  useAbility,
  useStadiumAbility,
} from "./cardplay";
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
    branch).

    0.48.0 — PSY PURGE: the CAPPED Hail Blade shape, and the first authored attack
    on a MULTI-attack card (P3-M5). Mewtwo VSTAR (swsh10.5-031) "Psy Purge" prints
    "Discard up to 3 Psychic Energy from your Pokémon. This attack does 90 damage
    for each card you discarded in this way." — the same declinable whole-board
    discard → damageDefender as Hail Blade, plus ONE new field: `discardEnergy`
    gains `cap?: number`, which bounds the `count: "any"` up-to below the whole
    board (the printed "up to N"; the park's max becomes min(cap, offered), the
    wire validator rejecting anything over it). And the `programFor(id)?.attack`
    seam is now keyed by ATTACK INDEX — Psy Purge is authored at index 0 while its
    index-1 "Star Raid" (a VSTAR Power) falls through to unsimulated, which a
    single card-level program could not express (D97). No web/API/DB/schema change
    (swsh10.5 was already ingested; the HUD's existing upTo dialog carries the cap
    via the smaller scope.max). */

/* 0.49.0 — DAMAGE ATTACKER: the reactive counters-on-attacker recoil, as a
    defender-side PASSIVE rather than a trigger (P3-M5, D98). The whole
    `damageAttacker` backlog row (Cacnea sv01-005 / Cacturne sv01-006
    "Counterattack Quills", 30; Stunfisk sv03-112 "Custom Trap", 50) lands as one
    new `PassiveEffects` field `damageAttacker?: {amount, requiresTool?}`. It is
    read exactly like `damageReductionAfterWR` — another reactive continuous value
    folded at damage time — so "if this Pokémon is damaged by an attack, put N
    damage counters on the Attacking Pokémon" needs NO new op, trigger timing,
    action, or phase. continuous.ts sums it seat-free (evaluating Custom Trap's
    `requiresTool` against the holder's board, so the read site stays a number);
    attack.ts folds it right after DAMAGE_DEALT, placing flat counters (outside
    the §8.5 W/R pipeline, the confusion-self-hit / damageSelf model) on the
    Attacking Pokémon when `dealt > 0`. "Even if this Pokémon is Knocked Out" is
    FREE: the placement precedes finishAttack's both-board §8.1 sweep, which then
    KOs a lethally-retaliated attacker and prizes it to the defender. The "in the
    Active Spot" clause is enforced by the READ SITE — only the main-hit Active
    defender retaliates (a benched holder hit by spread does not). Chosen over the
    general `onDamagedByAttack` trigger framework (which Armarouge's Burn and Klawf
    ex's parking Energy-discard still need) because the counter-placing subset is
    strictly the passive's shape (D98). Snipe/spread hits on the Active are a
    documented follow-up (recoil folds only at the §8.5 main hit for now). No
    web/API/DB/schema change. */

/* 0.50.0 — ON DAMAGED BY ATTACK: the general reactive trigger the D98
    passive deliberately did NOT build (P3-M5, D99). A new `TriggerTiming`
    `onDamagedByAttack` + a scan point at the SAME attack.ts spot D98's recoil
    uses (right after DAMAGE_DEALT, gated on `dealt > 0`, main-hit Active only),
    firing a NON-PARKING reactive program on the ATTACKING Pokémon. Authors
    Armarouge sv03-044 "Scorching Armor": the damaged Active defender Burns the
    attacker ("even if this Pokémon is Knocked Out" — the scan precedes the §8.1
    sweep). Modelled as a `TriggeredAbility` (not a passive like D98) because the
    effect runs an EffectOp program (`applyStatus`) reactively — exactly what
    `TriggeredAbility.program` is for; the passive shape carries no program. The
    program runs under the DAMAGED Pokémon's seat so `applyStatus target:
    "defender"` lands on the attacker's Active (otherSeat); `activeOnly` carries
    the "in the Active Spot" clause. triggers.ts `runDamagedByAttackTriggers`
    threads state straight through like `runCheckupTriggers`. Klawf ex sv03-120
    (a parking opponent-side Energy discard) still deferred — the remaining
    onDamagedByAttack card. No web/API/DB/schema change. */

/* 0.51.0 — DISABLE ABILITIES: the continuous Ability-lock AURA (P3-M5,
    D100) — Klefki sv01-096 "Mischievous Lock", Spiritomb sv02-089 "Fettered in
    Misfortune", Ting-Lu ex sv02-127 (+ -243/-263/-275) "Cursed Land". A new
    `PassiveEffects.disableAbilities` predicate (stage / suffix / side /
    requiresDamage / requiresActive / exemptSuffix / exemptAbilityNamed) and, in
    continuous.ts, `disabledAbilityUids(state)` — ONE both-boards pass returning
    the top uids whose Abilities are off. It is the first passive field that does
    not modify its HOLDER, so it is read through that dedicated scan rather than
    the per-Pokémon `passivesOf` aggregation, and only a TOP CARD grants it (an
    aura is a printed Pokémon Ability, never a Tool). FOUR read sites consult the
    Set by uid: activated (cardplay.ts useAbility → the new `ABILITY_DISABLED`,
    checked BEFORE activeOnly/oncePerTurn/cost so the lock is what gets reported),
    passive (continuous.ts passivesOf — the top card's printed passive only; the
    holder's Tools keep working), triggered (triggers.ts triggersOf — the single
    choke for onPlayToBench/onEvolve/betweenTurns/onDamagedByAttack; onKnockOut is
    deliberately NOT gated, it fires as the Pokémon leaves play) and the HUD
    (redact.ts — the row greys, so the client never offers a button the engine
    refuses). Auras are collected UNGATED, so a lock never turns itself or another
    lock off: the aura-vs-aura fixpoint (Ting-Lu ex opposite a damaged Klefki) is a
    documented follow-up, pinned by a tripwire test. Empty Set on every board with
    no lock in play. No web/API/DB/schema change. */

/* 0.52.0 — COUNTERATTACKING PINCER: the PARKING `onDamagedByAttack` reactive
    trigger the D99 framework deferred (P3-M5, D101) — Klawf ex sv03-120, the last
    card on the row. Its reaction is `discardEnergy from:"opponentActive"` run under
    the DAMAGED seat, so the DEFENDER discards an Energy from the ATTACKER, and that
    choice must PARK during the OPPONENT's turn. Made the trigger a STAGED
    `damagedTrigger` PendingStage (the twin of koTrigger) instead of D99's inline
    non-parking call: attack.ts records it at damage time (only when the damaged
    Active carries such an Ability, so every other attack keeps its exact queue) and
    seeds it AFTER the attack's own effect program but BEFORE the attackEpilogue;
    flow.ts `runDamagedTrigger` folds it through settleProgram with `resumeTail`
    under the DAMAGED seat — so, exactly like an on-KO trigger, the DEFENDER is the
    answerer (no `decider`/`answerer` needed), the attacker still owns the turn
    (koParkActiveSeat reads the attackEpilogue behind the park), and finishAttack's
    §8.1 sweep + turn end resume after the pick ("even if Knocked Out" stays free;
    Klawf ex prizes 2). triggers.ts `runDamagedByAttackTriggers` (the D99 inline
    runner) became the `damagedByAttackAbility` gated lookup. Armarouge's Burn
    (non-parking) rides the same staged path, byte-identical. No web/API/DB/schema
    change (the discard surfaces via the existing ENERGY_DISCARDED event). */

/* 0.53.0 — STADIUM ACTIVATED ABILITIES: the "once during each player's turn"
    Stadium row (P3-M5, D102) — Artazon (sv02-171/-229), Mesagoza (sv01-178),
    Town Store (sv03-196), the last big op-family row. A new `useStadiumAbility`
    action activates the shared Stadium's `StadiumEffects.ability` program under
    the turn's own player, gated once-per-turn by the new
    `TurnAllowances.stadiumAbilityUsed` bool — which, resetting every turn like
    every allowance, re-arms for the opponent's own turn (so "each player's turn"
    needs NO non-active-seat routing; the turnGate admits only phase.seat). No
    Pokémon target, so a bespoke action rather than a useAbility target; the
    D100 ability-lock never touches it (a Stadium is not a Pokémon). Two new
    CardFilter kinds carry the searches: `basicPokemon.noRuleBox` (Artazon,
    cards.ts `hasRuleBox` = suffix ∪ "Radiant " prefix) and `toolCard` (Town
    Store); Mesagoza reuses `anyPokemon` inside the Poké Ball coin gate. The
    programs are the Nest Ball / Poké Ball search shapes, so no new op. New event
    STADIUM_ABILITY_ACTIVATED. ENGINE + tests only — the HUD affordance (a
    target-less "global" button + projection field) is a deferred follow-up. */

/* 0.54.0 — PICNIC BASKET (sv01-184): the first single-op long-tail slice
    after the last op-family row closed (P3-M5, D103). One new EffectOp
    `healEachAll` — the seat-blind twin of `healEach` — heals up to 30 damage
    from EVERY in-play Pokémon on BOTH boards, each heal clamped and emitting its
    own HEALED tagged with that Pokémon's own seat. Non-parking, no choice, so no
    wire/schema change; like Potion it has no would-whiff play gate. */

/* 0.55.0 — BLOOMING GARDEN (sv01-093): the first long-tail continuous PASSIVE
    aura (P3-M5, D104) — Florges "Your Pokémon in play have no Weakness", the only
    "no Weakness" Ability in the sv01–03 pool. A bare `PassiveEffects.removeWeakness`
    flag (own board, unconditional, no Active-Spot clause) read through the new
    continuous.ts `seatRemovesWeakness(state, seat)` — the own-board twin of
    `disabledAbilityUids`: it scans the seat's own Active + Bench for a top card
    granting the aura, GATED through `disabledAbilityUids` so a §9-locked Florges
    (damaged opposite Ting-Lu ex "Cursed Land" — Florges is a non-ex Stage 2) loses
    it, joining the checklist every non-lock Ability surface must. The two Weakness
    read sites null the DEFENDER's Weakness before the pipeline — attack.ts §8.5
    main hit and interpreter.ts `snipeActive` (Chien-Pao ex "Hail Blade", Fezandipiti
    "Cruel Arrow"); Resistance is untouched, and Bench snipes already carry no
    Weakness, so nothing changes there. No web/API/DB/schema change. */

/* 0.58.0 — SAFEGUARD (sv02-097): the first ATTACKER-class-gated damage
    PREVENTION passive (P3-M5 long tail, D107) — Mimikyu "Prevent all damage done
    to this Pokémon by attacks from your opponent's Pokémon ex and Pokémon V", the
    only ex/V-gated total prevention in the sv01–03 pool. A bare
    `PassiveEffects.preventDamageFromExV` flag — the defender-side twin of
    `damageReductionAfterWR` (a full null instead of a flat subtraction) that rides
    `passivesOf`, but GATED at the read sites on the ATTACKER's rule-box class via
    the new `cards.ts isExOrV` (ex or V off `pokemonSuffixOf`, NOT VMAX/VSTAR/GX).
    Honored at all four attack-damage sites like the reduction it mirrors — main
    hit (attack.ts) + spread + both snipe arms (interpreter.ts) — since Safeguard
    has no "in the Active Spot" clause and protects the holder on the Bench too;
    `ignoreWR` (Feint Attack) bypasses it as it does the reduction. A new
    `prevented` flag on DAMAGE_DEALT marks the 0 as a prevention (not a 0-damage
    attack). No web/API/DB/schema change. */

/* 0.59.0 — LUNAR ZONE (sv03-082): the first CONDITIONAL continuous aura and
    the first modifier on the RETREAT-COST seam (P3-M5 long tail, D108) — Clefable
    ex "All of your Pokémon that have {P} Energy attached have no Retreat Cost",
    the only "no Retreat Cost" print in the whole local pool. A new
    `PassiveEffects.noRetreatCostAura { requiresEnergyType? }` read through the new
    continuous.ts `hasFreeRetreatAura(state, pokemon)` — the per-TARGET cousin of
    `seatRemovesWeakness`: the clause is evaluated against each Pokémon, so the
    scan takes the Pokémon and DERIVES its seat (the aura is own-board), leaving
    `effectiveRetreatCost`'s signature and its three call sites (turn.ts retreat,
    redact.ts `redactedRetreatOf`, the web HUD) untouched — one seam, three
    readers, no drift. Source gated through `disabledAbilityUids` (§9) like every
    non-lock Ability surface; the {P} clause is a PROVISION read
    (`providesEnergyType`, the `providesEnergy` CardFilter's predicate), so a
    wildcard Luminous Energy counts. A SET-TO-ZERO, so it is checked BEFORE Beach
    Court's ± `basicRetreatDiscount` and applies to non-Basics too. No
    web/API/DB/schema change. */

/* 0.61.0 — RETREAT-COST READERS: a third `DamageCountSource`,
    `opponentActiveRetreatCost` (P3-M5 long tail, D110) — "This attack does N
    (more) damage for each {C} in your opponent's Active Pokémon's Retreat Cost",
    landing FOUR cards at once: Heracross sv01-002 "Superpowered Throw" (10+),
    Spidops ex sv01-019/-223/-243 "Wire Hang" (90+), Sharpedo sv03-047 "Aqua
    Impact" (10+) and — the "×"/multiply arm, no base — Stoutland sv03-172 "Chomp
    Chomp Panic" (50×). Two anchored regexes (the arms differ only by the word
    "more", exactly as the Prize twins do) plus one `switch` arm in attack.ts's
    `scaledAttackDamage`, which already carried `state` + `defenderSeat`. The FIRST
    count source that is DERIVED rather than read off a field: it evaluates through
    continuous.ts `effectiveRetreatCost`, so Beach Court's discount, Calamitous
    Wasteland's surcharge and Clefable ex's set-to-zero aura are all inside the
    number these attacks read — the payoff of D108's single derivation point. NO
    registry row: the cards simulate straight off their printed text. No
    web/API/DB/schema change. */

/* 0.62.0 — `opponentActiveRetreatSurcharge`: Spidops ex sv01-019/-223/-243
    "Trap Territory" ("Your opponent's Active Pokémon's Retreat Cost is {C}
    more") — the LAST unbuilt modifier on the retreat-cost seam, which closes at
    9/9 ids (P3-M5 long tail, D111). The cross-board, delta-returning mirror of
    D108's `noRetreatCostAura`, read through a new continuous.ts scan
    `opposingRetreatSurcharge` that reuses the same derived-seat trick, so all
    FOUR readers of `effectiveRetreatCost` pick it up untouched. Its two Active
    clauses are asymmetric: the TARGET must be the opponent's Active, the SOURCE
    works from the Bench. `effectiveRetreatCost` is refolded to
    `max(0, printed + Σdeltas)` with the Stadium term extracted into
    `stadiumRetreatDelta` — its Basic-only early RETURN became a zero TERM, since
    this aura is stage-agnostic and must still reach a Stage 1/2 Active. Spidops
    ex's own "Wire Hang" READS the cost it raises (D110), so the reader/modifier
    composition lands on one card. No web/API/DB/schema change. */
/* 0.63.0 — the retreat-LOCK seam: "During your opponent's next turn, the
    Defending Pokémon can't retreat." now SIMULATES on 16 printings / 14 names
    (P3-M5 long tail, D112) — a CONDITION on the Pokémon, not a cost modifier, so
    it shares nothing with the D108–D111 cost seam but the word "retreat". New
    `InPlayPokemon.retreatBlocked` (deliberately NOT a member of
    `SpecialConditions`: no Checkup tick, no status chip, no attack gate, and the
    §12 shape is pinned field-by-field by `RedactedConditions`/`BattleConditions`),
    a new bare `preventRetreat` EffectOp, two anchored deriver regexes (the plain
    rider + Paldean Clodsire's two-clause "Poison Ring"), a `RETREAT_PREVENTED`
    error code at the turn.ts gate, one `&&` in redact.ts's `can` and one in the
    web HUD, and `RETREAT_BLOCKED`/`RETREAT_BLOCK_ENDED` events. The LIFETIME is
    §13.4's paralysis clock reused verbatim — cleared in `runCheckup` for
    `endedSeat` only — plus the early clears wherever an effect of an attack ends
    (leaving the Active Spot, evolving). ZERO registry rows: every print derives
    off its printed text. No API/DB/`@luminous/schema` change; the web diff is the
    one `&&`. */

/* 0.64.0 — `preventOpponentActiveRetreat`: Snorlax swsh10.5-055 "Block" ("As
    long as this Pokémon is in the Active Spot, your opponent's Active Pokémon
    can't retreat") — the L3 shape of D112's retreat-LOCK seam, and the ONLY
    continuous-Ability retreat lock in the ingested pool (one printing, no
    reprint). It shares nothing with D112's two attack riders but the effect: no
    turn duration, so it rides neither `InPlayPokemon.retreatBlocked` nor the
    `preventRetreat` op, but a bare passive flag read LIVE through a new
    continuous.ts scan `opposingRetreatBlocked` — the FIFTH member of the
    aura-scan family and the boolean cross-board twin of D111's
    `opposingRetreatSurcharge`, sharing its derived-seat trick and its §9
    `disabledAbilityUids` gate. The asymmetry is the point: Trap Territory's
    sentence scopes only the TARGET (a benched Spidops ex still surcharges),
    while this one opens with "As long as this Pokémon is in the Active Spot", so
    BOTH ends are Active-gated and the scan enforces the source clause at the read
    site (the `damageAttacker` precedent, not a new `activeOnly` field). Read at
    the RETREAT GATE, never folded into `effectiveRetreatCost` — a block is not a
    cost, so the printed cost stands and there is simply no legal retreat to spend
    it on. One registry row, one turn.ts guard reusing the existing
    `RETREAT_PREVENTED` code (a different message: "an attack effect" would be a
    lie for an Ability), one `&&` in redact.ts's `can` and one in the web HUD. No
    new events, ops or error codes; no API/DB/`@luminous/schema` change. It is
    also the family's first §9-POSITIVE: Snorlax is a BASIC, so an Active Klefki's
    "Mischievous Lock" really does silence it — where Lunar Zone and Trap
    Territory, both Stage 1 sources, could only assert the negative. */

/* 0.65.0 — `noRetreatCostSelf`: Wimpod swsh10.5-025 "Punk Out" ("If your
    opponent has any Pokémon V in play, this Pokémon has no Retreat Cost") — the
    TENTH and last open print on the retreat-COST seam, which closes at 10/10
    within the INGESTED pool (the live remote D1 holds 3698 cards, so ingesting
    new sets reopens it). A shape with no precedent: a SELF-only set-to-zero with
    a CROSS-BOARD predicate, where every retreat modifier before it either reached
    other Pokémon through a dedicated aura scan (D108 `noRetreatCostAura`, D111
    `opponentActiveRetreatSurcharge`) or modified its holder through the seat-free
    `passivesOf` fold. So it gets its own continuous.ts scan `hasFreeRetreatSelf`
    — the SIXTH member of the aura-scan family and the first that is self-only: it
    reads the HOLDER's own passive and merely looks across the table, deriving the
    seat exactly as its siblings do, purely so "your opponent" resolves. That is
    what keeps `effectiveRetreatCost`'s signature and all FOUR of its readers
    untouched; the only edit at the read site is one `||` in the set-to-zero line,
    a tier that now has two members (an own-board aura and this self-only
    conditional), both still beating every ± Stadium/aura delta. "In play" is
    Active + BENCH — the sentence carries no Active clause at either end — and
    "Pokémon V" excludes VMAX/VSTAR by construction, `pokemonSuffixOf` matching
    " VMAX"/" VSTAR" before the bare " V". The predicate rides an optional
    `PokemonSuffix` field on `PassiveEffects` rather than a D40 `BoardCondition`:
    the precedent is `damageBonusBeforeWRIfTarget` (a printed suffix is carried
    directly), and `conditionHolds` lives in interpreter.ts, which imports
    continuous.ts, so reading one from a continuous scan would close an import
    cycle. It is also the aura family's SECOND §9 POSITIVE — Wimpod is a BASIC, so
    an Active Klefki's "Mischievous Lock" genuinely silences Punk Out and the
    printed 3 snaps back. One registry row, one new scan, one barrel export; no
    new op, event, error code or wire field, and no API/DB/`@luminous/schema`/web
    change. */

/* 0.66.0 — the CONDITIONAL flat attack-damage bonus (D115): "If <clause>,
    this attack does N more damage." now SIMULATES, where before this slice EVERY
    leading-conditional print fell onto the loud ATTACK_EFFECT_SKIPPED path with
    its "+" marker unsimulated (`deriveAttackDamageBonus` recognised only the
    trailing `for each` scaling family). The leading-`If` family is 32 distinct
    sentences / 43 printings in the ingested pool; this slice maps FOUR of them —
    11 printings across 11 card ids (7 distinct cards), on ZERO registry rows, every one deriving off
    its printed text: Palossand sv02-096 "Earthen Power" (+80, `yourStadiumInPlay`),
    Gyarados sv02-043 "Revengeful Storm" (+100, `morePrizesThanOpponent`),
    Gyarados ex sv01-045/-225 "Tyrannical Tail" (+180) and Meowscarada ex
    sv02-015/-231/-256/-271 "Scratching Nails" (+60) on a new
    `opponentActiveDamaged`, and Seviper sv02-137 "Cross-Cut" (+50) / Houndoom
    sv03-133 "Daring Strike" / Toxicroak sv06.5-024 "Clean Hit" on a new
    `opponentActiveIsEvolution`. The first two clauses REUSE `BoardCondition`
    members that already existed (D40, built for Falkner and Fighting Au Lait),
    making this family the vocabulary's FOURTH consumer and its first through
    printed ATTACK text rather than a registry row.

    The design point is the INDICATOR count. A fourth `DamageCountSource`,
    `{ kind: "boardCondition"; cond }`, is honestly degenerate — it counts 1 when
    the condition holds for the ATTACKER's seat and 0 when it does not — and that
    is exactly what lets the conditional bonus reuse the additive family WHOLE:
    `per × count` is the printed flat bonus or nothing, so attack.ts needs no new
    fold, no new branch in the §8.5 pipeline, no dropped base and no new event
    field. The printed base stands either way ("100+" with the clause true is
    100 + 120 = 220, false is 100), and `effectSimulated`/`modifierSimulated` both
    ride `scaling !== null`, so the "+" and the sentence stop being flagged WHETHER
    OR NOT the condition holds — which is correct: the engine simulated the
    sentence, it simply evaluated to zero. The one signature change is
    `scaledAttackDamage` gaining `attackerSeat`: a `BoardCondition` is relative to
    whose board it reads, and the fold knew only the defender's seat.

    "Already" (Tyrannical Tail, Scratching Nails) is a TIMING word, honoured by
    evaluating the indicator at attack DECLARATION, before this attack's own damage
    lands — an undamaged defender takes 180, not 360, so an opening hit can never
    bootstrap the bonus that scales it. "Evolution Pokémon" reuses D105's definition
    verbatim (`evolveFromOf(topCard) !== null`, the exact complement of
    `basicPokemon`) so the two readings cannot drift.

    The clause table is a `Map<string, BoardCondition>`, not an object literal:
    the key is arbitrary printed text and an object lookup on arbitrary text can
    hit `Object.prototype`. It holds exactly four entries, keyed char-for-char on
    the printed clause; the remaining ~28 printed clauses in the pool stay
    deliberately UNMAPPED and therefore LOUD — an unrecognised clause returns null
    and keeps its ATTACK_EFFECT_SKIPPED row, which is strictly better than silently
    scoring the bonus at 0, and each is a future one-row extension. The regex is
    anchored whole-sentence with a required trailing period and no /i, which is
    what keeps "Flip a coin. If heads, this attack does 20 more damage." (26
    printings — a different mechanism that must announce its flip) and Cresselia's
    "You may turn 1 of your face-down Prize cards face up. If you do, …" (a leading
    CHOICE, not a board read) off this path. `deriveAttackDamageMultiplier` is
    untouched: the pool prints no "If …, this attack does N damage." (no-"more")
    twin, and no "… more damage if …" trailing form or "N LESS damage" variant
    exists either. No new op, event, error code, registry row or wire field; no
    API/DB/`@luminous/schema`/web change. */

/* 0.67.0 — the SECOND wave of D115's clause table (D116): FOUR more printed
    clauses, 7 printings across 6 cards, again on ZERO registry rows and with no
    change to the fold, the ops, the events or the wire. `CONDITIONAL_DAMAGE_CLAUSES`
    goes 4 → 8 entries and now covers 18 of the pool's 43 leading-`If` printings.
    New: Talonflame sv02-030 "Fiery Breeze" (+90) and Darmanitan sv03-035 "Damage
    Counterpunch" (+60) on `yourActiveDamaged`; Tyranitar ex sv03-066/-211
    "Lightning Rampage" (+100) on `yourBenchDamaged`; Seviper sv01-128 and Paldean
    Clodsire sv03-129, both printing "Venoshock" (+120), on
    `opponentActivePoisoned`; Sableye sv02-136 "Unseen Claw" (+70) on
    `opponentActiveHasSpecialCondition`. All four clause strings were re-confirmed
    char-for-char against the local D1 before authoring, and each is
    anchored-unique in the pool (the census also found three damage-PLACEMENT
    sentences containing "has any damage counters on it" — Yveltal sv06.5-035,
    Vespiquen ex sv03-096/-212 — which a substring matcher would have swallowed and
    the whole-sentence anchor does not).

    THE DESIGN CALL is the SELF-SCOPED clause, which D115's resume point left open:
    "If **this Pokémon** has any damage counters on it" is the first printed clause
    whose subject is the card itself, and `BoardCondition` is shared with
    `trainerPlayableIf` and the HUD, where a self-pronoun has no referent. The
    resolution is that the member is named for what it READS — `yourActiveDamaged`,
    a plain seat-relative board fact, meaningful on every consumer — and the
    pronoun is resolved in the CLAUSE TABLE, the only layer that knows the sentence
    came off an attack. That reading is exact rather than approximate: §8 lets only
    the Active declare an attack, so on this path "this Pokémon" IS "your Active".
    No second union, no context parameter threaded through `conditionHolds`, and
    the play gate keeps its single evaluator. `yourBenchDamaged` reads the printed
    plural ("your Benched Pokémon have any damage counters on them") as the
    game's usual collective "any of them", excludes the Active, and is false on an
    empty Bench. The two §12 members read the existing model: Poison is a counter
    AMOUNT (`poisonDamage > 0`, as the Checkup reads it) and "affected by a Special
    Condition" reuses `presentStatuses` verbatim, so it can never drift from the
    status chips. Cost: 4 union members, 4 `conditionHolds` arms, 4 `conditionNote`
    arms, 4 table rows. */

/* 0.68.0 — the THIRD wave of D115's clause table (D117): TWO more printed
    clauses, 4 printings across 2 cards, again on ZERO registry rows and with no
    change to the fold, the ops, the events or the wire. `CONDITIONAL_DAMAGE_CLAUSES`
    goes 8 → 10 entries and now covers 22 of the pool's 43 leading-`If` printings.
    New: Okidogi ex sv06.5-036/-082/-090 "Chain-Crazed" (+130) on
    `yourActivePoisoned` — the SELF twin of D116's `opponentActivePoisoned`, and
    the second use of D116's pronoun rule (the member is named for the board fact
    it reads; the CLAUSE TABLE resolves the printed "this Pokémon"); and Ceruledge
    sv02-098 "Fighting Sword" (+100) on `opponentActiveIsExOrV`, which reuses
    D107's `isExOrV` verbatim, so "Pokémon ex or Pokémon V" reads exactly as
    Mimikyu "Safeguard" reads it — ex and V ONLY, never VMAX/VSTAR/GX. Both clause
    strings were re-confirmed char-for-char against the local D1 before authoring,
    and both are anchored-unique in the pool ("is Poisoned" matches exactly five
    printings, all now mapped, split 3/2 between the self and cross-board
    readings — one possessive apart, opposite boards). Cost: 2 union members, 2
    `conditionHolds` arms, 2 `conditionNote` arms, 2 table rows.

    The slice's one board-level note: Okidogi's own index-0 "Poisonous
    Musculature" self-Poisons but is UNBUILT, so the only route to a Poisoned own
    Active is the one the real game uses — the opponent Poisons you, and §13.1's
    Checkup ticks it before your attack reads it. `clauseTable.test.ts` arms it
    that way rather than by surgery. */

/* 0.69.0 — the conditional-damage family's FIRST PARAMETERISED clause (D118):
    "If this Pokémon has any <energy> Energy attached, this attack does N more
    damage." — Scovillain sv01-029/-202 "Super Spicy Breath" (+90, `{R}`),
    Galvantula sv06.5-002 "Shocking Web" (+80, `{L}`), Cetitan sv02-055 "Special
    Horn" (+140) and Tinkaton sv02-105 "Special Hammer" (+90, both `Special`).
    6 printings / 5 cards, ZERO registry rows, no new op, event, error code or
    wire field, no fold change, no web/API/DB/`@luminous/schema` diff.

    `BoardCondition` gains its first member carrying a PARAMETER —
    `{ kind: "yourActiveHasEnergyAttached"; energy: BasicEnergyType | "special" }`
    — and `boardConditionForClause` (effects.ts) gains a SECOND resolution pass:
    the literal `CONDITIONAL_DAMAGE_CLAUSES` table first, then anchored
    whole-clause TEMPLATES. Four literal rows would have covered today's four
    sentences; the pool prints nine energy codes in two rival notations, so the
    literal form costs a row and a union member per type per notation forever
    while the template costs nothing for the tenth printing. The energy token
    vocabulary is a `Map` built FROM the two existing notation maps
    (ENERGY_TYPE_BY_CODE / ENERGY_TYPE_BY_NAME) plus `Special`, so the three
    cannot drift and an arbitrary printed token cannot reach `Object.prototype`.

    The predicate is continuous.ts's new `hasAttachedEnergy`, read by PROVISION
    rather than by the printed name — an Energy that can pay a {R} cost is
    exactly an Energy this clause counts, so a wildcard Luminous Energy satisfies
    `{R}` while it provides every type and stops the moment a second Special
    demotes it to {C}. `"special"` is the CARD CLASS (`isSpecialEnergy`), a
    different axis from a type, which is why it is a string member of the
    parameter rather than a tenth type. D116's pronoun rule, third use. Cost: 1
    union member, 1 `conditionHolds` arm, 1 `conditionNote` arm (the family's
    first built from a parameter rather than returned as a literal), 1 clause
    pattern, 1 token map, 1 continuous.ts predicate. */

/* 0.70.0 — the PUBLIC-COUNT cluster (D119): the conditional-damage family's
    first clauses that read NOTHING ON A POKÉMON. Krokorok sv01-116 "Payback"
    (their Prizes exactly 1, +90), Houndstone sv03-101 "Two Four-ocious" (exactly
    2 or 4, +120), Absol ex sv03-135/-214 "Cursed Slug" (their hand 3 or fewer,
    +120) and Bronzong sv03-145 "Extrasensory" (the two hands equal, +90). 5
    printings / 4 cards / 4 clauses, ZERO registry rows, no new op, event, error
    code or wire field, no fold change, no web/API/DB/`@luminous/schema` diff.

    Three `BoardCondition` members: `opponentPrizesRemaining { counts }` (ONE
    member at two values — the printed "exactly" is set MEMBERSHIP, so `[2, 4]` is
    not the range 2..4 and a 3-Prize board reads FALSE between two true ones),
    `opponentHandAtMost { count }` and `handSizesEqual`, the vocabulary's first
    SEAT-SYMMETRIC member. A hand's SIZE is PUBLIC where its CONTENTS are not,
    which is exactly the line the union's standing invariant already drew; the
    wire agrees (redact.ts ships the opponent's hand as `hiddenHand(length)`), so
    none of the three widens the P4 gap.

    The two Prize sentences share a member but stay TWO LITERAL ROWS rather than a
    D118 template: two things vary between them, the count LIST and the
    grammatical number agreeing with it ("1 Prize card" / "2 or 4 Prize cards"),
    and a pattern loose enough for both would accept text the game never prints.
    The two HAND sentences stay two members for the same kind of reason — a
    threshold against a constant and an equality between two hands are different
    comparisons over different operands. Cost: 3 union members, 3 `conditionHolds`
    arms, 3 `conditionNote` arms (one built from its parameter, agreement and all),
    4 table rows. */

/* 0.71.0 — TYPE and NAME (D120): the conditional-damage family's two
    cheapest remaining clauses, and the pair exists to settle when a clause that
    varies on ONE token may be a TEMPLATE. Sylveon swsh10.5-035 "Wonder Flash"
    ("If your opponent's Active Pokémon is a Dragon Pokémon", +90) and Falinks
    sv02-119 "Reckless Charge Together" ("If Falinks is on your Bench", +90). 2
    printings / 2 cards / 2 clauses, ZERO registry rows, no new op, event, error
    code or wire field, no fold change, no web/API/DB/`@luminous/schema` diff.

    Both vary on exactly one token and they get OPPOSITE treatments, which is the
    slice's whole point. The discriminator is not the printing count (each is a
    singleton) and not D119's "how many things vary" — it is whether the varying
    token has a CLOSED vocabulary to be REJECTED against. A type name does: the
    new `POKEMON_TYPES` (built from BASIC_ENERGY_TYPES + Dragon + Colorless, so
    the two lists cannot drift) is eleven words, an unknown token resolves to
    null and the clause stays LOUD — which is what keeps the pattern off "is a
    Basic Pokémon". A card NAME does not: `^(.+) is on your Bench$` has nothing to
    reject against and would read any noun phrase as a card name and answer FALSE
    forever, SILENTLY. So the type is a template and the name is a literal row.

    `opponentActiveHasType { type }` reads `Card.types`, the same field Weakness
    and Resistance read two lines later in §8.5. `yourBenchHasNamed { name }` is
    the vocabulary's first member reading a card IDENTITY rather than a structural
    fact; it reads the stack TOP (§1.2), so evolving the named Pokémon stops
    satisfying it. Cost: 1 union member + 1 clause pattern + 1 token map (the
    type), 1 union member + 1 table row (the name), 2 `conditionHolds` arms, 2
    `conditionNote` arms — both round-tripping to the printed clause verbatim. */
/* 0.72.0 — the BOARD-WIDE Energy count (D121): Absol sv06.5-030 "Darkfall",
    "If you have at least 3 {D} Energy in play, this attack does 50 more damage."
    1 printing / 1 card / 1 clause, ZERO registry rows, no new op, event, error
    code or wire field, no fold change, no web/API/DB/`@luminous/schema` diff.

    ONE WORD SEPARATES IT FROM D118, AND THAT WORD IS THE SLICE. "attached" scopes
    to a single Pokémon (nine printings, four cards); "in play" means your whole
    side of the table. The PREDICATE underneath is deliberately identical — a type
    is read by PROVISION, on the holder, so a wildcard Luminous is a {D} Energy for
    this clause exactly as it is for a cost — and only the FOLD over it is new:
    continuous.ts's `countEnergyInPlay`, sitting beside `hasAttachedEnergy` so the
    two readings of one printed noun cannot drift. It counts CARDS, not units of
    provision (one Energy is one Energy however many symbols it offers), and
    Active + Bench only.

    A LITERAL ROW although the member is parameterised — D119's corollary, second
    use. Two tokens could vary here (the threshold and the energy), so D118's
    one-token test fails; and there is nothing to generalise from, since "at least"
    and "Energy in play" are each a HAPAX in the ingested 978 cards / 6 sets. A template
    would parameterise over a pool of one on both axes at once. The parameters are
    real all the same: `conditionHolds` compares a count against a threshold, and
    the printed "at least" makes it `>=` — a threshold, not D119's set membership.
    Rows are matched first, so a template can still be added over this later.

    Cost: 1 union member, 1 `conditionHolds` arm, 1 `conditionNote` arm, 1 table
    row, 1 continuous.ts helper. The note is the family's first that does NOT
    round-trip to the printed clause byte for byte: it renders "{D}" as "Darkness"
    (D118's rule — a reject message is read off the board by a person).

    0.72.0 → 0.73.0 — the POKÉMON TOOL clause (D122). Greedent sv01-152 "Enhanced
    Fang", "If this Pokémon has a Pokémon Tool attached, this attack does 80 more
    damage." (+80): one printing, one card, one clause, no reprint — and the LAST
    clause in this family that reads a field the model already carries. The table
    goes 16 → 17 literal rows + 2 templates, covering 21 of the pool's 26 distinct
    clauses / 37 of its 43 printings; every clause left needs new per-turn state,
    an ingest change, or the coin-flip mechanism.

    `yourActiveHasToolAttached` is a BARE TAG on a LITERAL row, and the cheapest
    member the vocabulary has: `InPlayPokemon.tools` is already a uid array, and
    every uid in it reached it through `attachTool`, which refused anything whose
    `trainerType` is not "Tool" before it could land. So — unlike D118's Energy
    clauses, where an Energy card can pay for a type it is not named after and the
    predicate must therefore be PROVISION — there is no reading question here at
    all, and no continuous.ts helper: a Tool is a Tool, and the predicate is a
    length test.

    The one real decision is `> 0` rather than `=== 1`. §7.4 caps a Pokémon at one
    Tool, but that cap is enforced at the ATTACH GATE, and Revavroom ex sv03-156's
    "Tune-Up" Ability raises it to 4 — so a predicate written to the cap would
    answer FALSE on a board the printed sentence plainly describes.

    D116's pronoun rule, FOURTH use: the member is named for the board fact it
    READS (your Active) and the clause table resolves the printed "this Pokémon".
    That matters more here than usual, because two OTHER cards print this clause's
    exact words under a different consequent — Genesect sv06.5-040's "ACE
    Nullifier" is byte-identical through the comma, and Stunfisk sv03-112's
    "Custom Trap" carries the same words as a middle conjunct. Both are ABILITIES;
    the whole-sentence anchor is the only thing keeping a damage bonus off them.

    Cost: 1 union member, 1 `conditionHolds` arm, 1 `conditionNote` arm, 1 table
    row, 1 test-surgery helper. No new op, event, error code, registry row, wire
    field or fold change; no continuous.ts diff; no web/API/DB/`@luminous/schema`
    diff. The note ROUND-TRIPS to the printed clause with only the pronoun swapped
    — this sentence carries no timing word and no card-face glyph.

    0.73.0 → 0.74.0 — the SUPPORTER-PLAYED clause (D123). Pikachu swsh10.5-027
    "Buddy Bolt", "If you played a Supporter card from your hand during this turn,
    this attack does 30 more damage." (+30): one printing, one card, one clause, no
    reprint. The table goes 17 → 18 literal rows + 2 templates, covering 22 of the
    pool's 26 distinct clauses / 38 of its 43 printings.

    D122 called itself the LAST clause in this family that reads a field the model
    already carries. That was true of the BOARD; this one reads a TURN EVENT, and
    the field it needs turns out to already exist too — §7.2's
    one-Supporter-per-turn cap is `state.allowances.supporterPlayed`, set by
    `playTrainer` (cardplay.ts) and cleared by `freshAllowances()` on every
    `startTurn`. So the printed "during this turn" is not a new clock: it is
    exactly the lifetime the allowances bag already has. ZERO new state — no field
    on `TurnAllowances`, none on `PlayerSide`, no serializer change, no
    `MATCH_RECORD_VERSION` bump.

    `youPlayedSupporterThisTurn` is a BARE TAG on a LITERAL row. Nothing is left to
    parameterise: the sentence names no card, no count and no type, only the card
    CLASS the §7.2 cap is already keyed on. And D116's pronoun rule does not apply
    for the first time in this family — the printed subject is "you", so a
    seat-relative predicate reads the sentence as printed and the clause table
    translates nothing.

    THE ONE REAL DECISION IS THE SEAT GUARD. `GameState.allowances` is a SINGLE bag
    describing whoever owns the current turn, not a per-seat record, while
    `conditionHolds` is seat-relative and has consumers where `seat` is NOT the
    turn owner (a `conditionGate` under a koTrigger / damagedTrigger stage
    evaluates during the OPPONENT's turn — the `resumeTail` case on
    `effect:choose`). Read unguarded, the bag would answer "your OPPONENT played a
    Supporter" as "you played a Supporter". So the arm proves ownership first, via
    `phaseViewOf(state, seat).activeSeat === seat` — THE one exhaustive switch over
    `Phase`, never a turn-parity re-derivation, which phaseView.ts's own header
    forbids for precisely the case that breaks it. A checkup-origin `ko:*` park has
    `activeSeat` null and therefore reads FALSE for BOTH seats: "during this turn"
    is vacuous between turns, which is the intended reading.

    The near-miss is real and it is an ABILITY: Crobat sv06.5-029's "Shadowy Envoy"
    is the pool's only other "you played" sentence, and it differs twice over — it
    names a SPECIFIC card ("if you played Janine's Secret Art from your hand this
    turn") and it drops the "during". The whole-sentence anchor refuses it on
    either difference alone.

    Cost: 1 union member, 1 `conditionHolds` arm, 1 `conditionNote` arm, 1 literal
    table row, 0 new state fields, 0 registry rows. No new op, event, error code,
    wire field or fold change; no continuous.ts diff; no web/API/DB/
    `@luminous/schema` diff. The note ROUND-TRIPS to the printed clause byte for
    byte — the family's first that drops nothing at all. */
/** 0.75.0 — P3-M5: the PROMOTED-THIS-TURN clause (D124). `BoardCondition` gains
    `yourActivePromotedThisTurn`, mapping "If this Pokémon moved from your Bench to
    the Active Spot this turn, this attack does N more damage." — Revavroom ex
    sv06.5-015/-081 "Accelerator Flash" (20+, +120) and Golisopod swsh10.5-026
    "First Impression" (20+, +90). THREE printings on ONE literal row, the best
    ratio in the family and the only row here that is not one or two prints. The
    table goes 18 → 19 literal rows + 2 templates, covering 23 of the pool's 26
    distinct clauses / 41 of its 43 printings. THREE CLAUSES REMAIN, and none of
    them is cheap (see progress.md's resume point).

    ONE ROW AND NOT A TEMPLATE even though the pool prints two different amounts:
    the amount is captured by the OUTER skeleton, so the clause itself is
    byte-identical across all three printings and there is nothing inside it to
    parameterise. D118's rule, read from the other end.

    THIS IS THE FIRST CLAUSE IN THE FAMILY THAT BUYS NEW STATE. D123 got its turn
    event free by reading a rule-enforcement flag; that shortcut is spent, because
    no rule caps how often a Pokémon may move up. The fact is per-Pokémon AND
    per-turn at once and nothing on the model held it — `turnPlayed` records when
    the CARD entered play, `markers` is a write-only string bag never read in
    production, and `TurnAllowances` is per-SEAT. So `InPlayPokemon` gained
    `promotedTurn: number | null` (types.ts).

    A TURN STAMP, NOT A FLAG — the decision the whole slice turns on, and it pays
    three times. (1) NO TURN-BOUNDARY CLEAR: `promotedTurn === state.turn` expires
    by arithmetic, so `startTurn` needs no walk over in-play Pokémon (it has none
    today) and no future slice can forget to reset it. (2) NO SEAT GUARD, the exact
    inverse of D123 and the generalisation to carry: **D123's guard was owed to
    seat-AMBIGUOUS STATE (`allowances` is one bag owned by the turn's owner), not
    to the words "this turn".** A fact stamped on a Pokémon is unambiguous — the
    Pokémon knows whose it is — so the predicate is total over seats, consumers and
    phases. (3) §8.1 FALLS OUT FREE: a Knock Out promotion runs during the
    OPPONENT's turn and stamps THEIR turn number, which can never equal
    `state.turn` once the controller's own turn begins.

    ALL THREE bench→Active routes stamp it and all three COUNT, because the printed
    verb is "moved", not "retreated": `retreat` (turn.ts), `switchInto`
    (interpreter.ts — Switch/Escape Rope, Boss's Orders, and Jet Energy's on-attach
    switch) and `resolvePromotion` after a KO (flow.ts). Setup placement is not a
    route (a card from the hand never came from the Bench), so `makeInPlay` stamps
    `null`. It SURVIVES EVOLUTION: `placeEvolution` spreads the Pokémon and clears
    only conditions/`retreatBlocked`/`markers`, and §10 sheds the effects of
    ATTACKS — having moved is a fact about the turn, not an effect on the card.

    The negative twin is NOT a near-miss of this row and never reaches it: Palafin
    sv03-062/-200 "Justice Kick" prints "If this Pokémon didn't move from the Bench
    to the Active Spot this turn, this attack does nothing." — a different
    CONSEQUENT (the outer anchor refuses it before the table is consulted), a
    different verb form, and no possessive on "the Bench". Same state underneath,
    and D125 (below) simulates it off its own skeleton. Weavile sv02-134's
    "Assaulting Hunt" reads the same transition as a `when` TRIGGER, not a per-turn
    query, and is a different mechanism again.

    Cost: 1 union member, 1 `conditionHolds` arm, 1 `conditionNote` arm, 1 literal
    table row, 1 NEW `InPlayPokemon` field, 3 one-line stamp sites, 0 registry rows.
    No new op, event, error code, wire field or fold change; no continuous.ts diff;
    no web/API/`@luminous/schema` diff. `redact.ts` allow-lists what crosses the
    wire, so the field is invisible to clients by construction. **MATCH_RECORD_VERSION
    1 → 2** (apps/api/src/lobby/match.ts): a record written by the previous deploy
    has in-play Pokémon with NO `promotedTurn` at all, which is a MISSING REQUIRED
    FIELD, not a widening — the one case that doc block says must bump. */
/** 0.76.0 — P3-M5: the REQUIREMENT skeleton (D125), the clause family's SECOND
    CONSEQUENT. Ten slices of "If <clause>, this attack does N more damage." are
    joined by "If <clause>, this attack does nothing." — Palafin sv03-062/-200
    "Justice Kick" ({W}{W}, 210) and Lycanroc sv03-117 "Finishing Fang" ({F}, 90)
    now SIMULATE. 3 printings / 2 cards / 2 clauses, and — the point of the slice —
    on ZERO new `BoardCondition` members: both rows reuse a fact the vocabulary
    already had (`yourActivePromotedThisTurn` from D124, `opponentActiveDamaged`
    from D115). The literal clause table is untouched at 19 rows + 2 templates.

    A NEW CONSEQUENT IS A NEW SKELETON, NOT A NEW VOCABULARY. The resume point
    forecast this as "a `conditionGate`-shaped slice" and that reading was wrong
    in a way worth recording: an effect PROGRAM runs at attack.ts's tail, strictly
    AFTER the §8.5 damage pipeline, and no op can retract damage already dealt. A
    cancel must be evaluated in FRONT of the pipeline, so it is not a program at
    all — it is a gate, and the gate the engine already had for exactly this
    ("no damage, no effects, the turn still ends") is the §8 step-3 CONFUSION
    path. D125 is that path minus the self-damage: `ATTACK_FAILED` then
    `finishAttack`. GENERALISATION: derived-text shapes are separated by WHERE IN
    RESOLUTION THEY LAND, not by how their sentence reads — a shape that must run
    before damage can never be spelled as an `EffectOp`, however naturally the
    sentence maps onto one.

    THE POLARITY LIVES IN THE SKELETON, NOT IN THE VOCABULARY — the slice's one
    real design call, and it refuses a `{ kind: "not", cond }` member. All SIX of
    the pool's distinct "does nothing" clauses are NEGATIVE sentences ("didn't
    move", "has no damage counters", "you can't", "If tails", "you didn't play",
    "you can't shuffle"), and that is the grammar of the mechanic rather than an
    accident: a card prints "does nothing" precisely to state a REQUIREMENT, and
    English states a requirement by naming its failure. So `deriveAttackRequirement`
    reads the printed NEGATIVE and returns the POSITIVE fact required, and
    attack.ts cancels on its ABSENCE. A `not` member would make `BoardCondition`
    recursive — five consumers each owing a recursion arm, and `conditionNote`
    owing a negated phrasing English does not supply — to buy a spelling nothing in
    978 cards / 6 sets asks for. If a POSITIVE clause ever appears under this consequent,
    that is the warrant, and the answer then is a second table of positive-sense
    rows, still without touching the union (D121's rule).

    LYCANROC'S TRAILING QUALIFIER IS DISCHARGED BY THE SITE, NOT BY THE PREDICATE.
    "…has no damage counters on it BEFORE THIS ATTACK DOES DAMAGE" needs no
    modelling: `opponentActiveDamaged` is committed by its own doc block to being
    read at declaration (that is what "already" means for the D115 bonus family),
    and the requirement gate sits in front of §8.5 — so the qualifier is true by
    where the check runs. An undamaged defender cannot bootstrap the clause with
    the very hit the clause gates.

    Two SEPARATE tables on purpose. `ATTACK_REQUIREMENT_CLAUSES` shares no lookup
    with `CONDITIONAL_DAMAGE_CLAUSES`: a clause meaning "80 more damage if X" must
    not be reachable from a sentence meaning "nothing if X". Two consequents, two
    vocabularies, no crossover. The whole-sentence anchor keeps the family's other
    16 printings LOUD, and on the CLAUSE rather than on the shape — the 12
    coin-flip "If tails" prints (a different mechanism, and the flip sentence in
    front already denies them `^If`), the 3 anaphoric "If you can't" prints, and
    Malamar sv06.5-034's named-card multi-sentence one.

    Cost: 1 new skeleton regex, 1 new 2-row table, 1 exported deriver, 1 reader +
    1 gate in attack.ts, 1 `effectSimulated` term, 1 ENUM WIDENING on
    `ATTACK_FAILED.reason` ("confusion" | "requirement") and its log line. ZERO
    new `BoardCondition` members, `conditionHolds`/`conditionNote` arms, ops,
    state fields, error codes, registry rows or fold changes; no continuous.ts
    diff; no web/API/DB/`@luminous/schema` diff. NO MATCH_RECORD_VERSION BUMP:
    widening an event's reason enum is a widening, not a missing required field —
    the distinction D124 had to bump for. */
/** 0.77.0 — P3-M5: the PRINTED COIN FLIP (D126), and the cheapest slice the
    derived-attack-text family has had. "Flip a coin. If heads, this attack does N
    more damage." (20 printings) and "Flip a coin. If tails, this attack does
    nothing." (11 printings) now SIMULATE — 31 printings on TWO REGEXES AND ZERO
    NEW VOCABULARY. No clause table, no `BoardCondition` member, no
    `DamageCountSource` member, no state field, no registry row. Tarountula
    sv01-018 "Surprise Attack" ({G}, 30) and Litwick sv03-036 "Firebreathing"
    ({R}, 10+) are the fixtures.

    THE CLAUSE IS A FIXED LITERAL, which is the whole reason for the price. Ten
    predecessor slices built "If <clause>, this attack does N more damage." and
    every one of them paid for a printed clause and usually a board fact to answer
    it. Here the clause is the word "heads" — and A COIN FACE IS NOT A BOARD FACT.
    It is drawn from `rngState` at resolution, so `scaledAttackDamage` stays PURE
    and state-only and `DamageCountSource` is untouched; the flip's contribution
    is a local `coinBonus` folded into the same pre-W/R step. GENERALISATION: the
    cost of a derived shape tracks WHAT ANSWERS ITS CLAUSE, not how elaborate the
    sentence looks. A clause with no referent at all is free.

    HEADS AND TAILS ARE ONE SLICE, and `AttackCoinFlip` is a 2-MEMBER UNION rather
    than two nullable readers. They are one mechanism — a single flip taken BEFORE
    the §8.5 pipeline — read from two ends; the union makes their mutual
    exclusivity STRUCTURAL, so `attack.ts` matches one value and can never flip
    twice. Split into two slices, the flip's site, its event and its fold would
    have been designed twice.

    THE FLIP IS NOT AN `EffectOp`, for D125's reason restated: a shape is
    classified by WHERE IN RESOLUTION IT LANDS. A program runs at attack.ts's
    tail, after §8.5 — it can neither raise a number already computed nor retract
    damage already dealt — so a flip that GATES damage must run in front of the
    pipeline, at the same site as §8's confusion flip. The tails branch reuses
    D125's ending exactly (`ATTACK_FAILED` → `finishAttack`, so the turn still
    ends), and the block sits AFTER the D125 requirement gate so a
    already-cancelled attack never burns an rngState step. (No pool printing
    carries both, so that order is a rules reading, not a pinned behaviour.)

    `ATTACK_EFFECT_COIN_FLIP` IS REUSED, NOT TWINNED. It names the fact "a coin
    was flipped resolving this", which is identical here and inside a
    `coinFlipGate`, and its log copy was neutralised for Trainer sharing long ago.
    A second event type would owe a new log arm and a new wire member for zero new
    information.

    THE ONE TRAP WORTH RECORDING: `modifierSimulated`. The 20 heads printings carry
    a printed "10+"-style marker, which `parseAttackDamage` splits into base 10 +
    modifier "+", and that modifier IS the flip's N — so the coin reader must be a
    term in `modifierSimulated` as well as in `effectSimulated`, or all 20 stay
    loudly ATTACK_EFFECT_SKIPPED while resolving perfectly. The term is narrowed to
    `bonusOnHeads`: the cancel printings carry a flat number and no marker at all.

    The family's LONG TAIL stays LOUD, and on the anchors rather than on a table:
    the "…, and heal 30 damage…" / "…, and your opponent's Active Pokémon is now
    Confused." second-consequent prints and Dragonite ex's added tails branch are
    refused by `$`; "Flip a coin until you get tails.", "Flip 2 coins.", "Flip 3
    coins." by the literal `^Flip a coin\.`; and the 16 "If heads, your opponent's
    Active Pokémon is now Paralyzed." printings by the CONSEQUENT — those already
    derive to a `coinFlipGate` program, and reading them here too would flip twice.

    Cost: 2 new skeleton regexes, 1 exported union + 1 exported deriver, 1 reader +
    1 flip block + 1 `scaledTotal` fold in attack.ts, 2 `*Simulated` terms, 1 ENUM
    WIDENING on `ATTACK_FAILED.reason` ("confusion" | "requirement" | "coinFlip")
    and its log arm. ZERO new `BoardCondition` members, `DamageCountSource`
    members, clause-table rows, ops, events, state fields, error codes, registry
    rows or fold changes; no continuous.ts diff; no web/API/DB/`@luminous/schema`
    diff. NO MATCH_RECORD_VERSION BUMP — the same widening-not-a-missing-field
    distinction D125 recorded. */
/** 0.78.0 — P3-M5: the MULTI-FLIP COUNT FOLD (D127). "Flip N coins. This attack
    does D damage for each heads." (22 printings: N=2 ×12, N=3 ×9, N=4 ×1) now
    SIMULATES — ONE REGEX, ONE union member, and STILL zero vocabulary. Tandemaus
    sv01-160 "Double Hit" ({C}{C}, 30×, 2 flips) and Meowth sv06.5-048 "Fury
    Swipes" ({C}{C}, 20×, 3 flips) are the fixtures.

    THIS IS D126's SEAM WITH A BOUNDED LOOP, and the point is how little that
    changes. Same reader, same union, same site (after the D125 requirement gate,
    in front of §8.5), same `coinBonus` → `scaledTotal` fold, same event. The
    diff is a `for` loop, a third union member, one term in `scaledBase` and one
    in `modifierSimulated`. GENERALISATION: once a shape's SITE is right, varying
    its cardinality is cheap — the expensive question was never "how many", it was
    "where in resolution does this land" (D125) and "what answers this clause"
    (D126).

    N FLIPS ARE ANNOUNCED AS N ROWS. `ATTACK_EFFECT_COIN_FLIP` carries exactly one
    `CoinFace`, so one event per flip in flip order is the only reading that does
    not invent an aggregate the event, the wire and the log cannot express. A
    single row carrying a heads COUNT would owe a new event type, a new wire member
    and a new log arm to say what a reader can already count off the rows — and it
    would discard the ORDER, which is the part a player watching a three-flip
    attack wants.

    IT IS THE MULTIPLY FAMILY, NOT THE ADDITIVE ONE, AND THE MARKER SAYS SO. All 22
    printings are "D×" where D is the per-heads amount, so `scaledBase` drops the
    printed base exactly as it does for `deriveAttackDamageMultiplier` — Tandemaus
    on two heads is 60, not 30 + 60. The word "more" is what separates the families,
    and the pool holds two live "more" near-misses (Melmetal swsh10.5-046, Bouffalant
    sv03-174) that the whole-sentence anchor must refuse; a substring matcher would
    score both wrong.

    AND YET NOT A `DamageCountSource` — D126's rule applied, not re-derived. The
    count comes from the flips, not from the board; no state answers it, so
    `scaledAttackDamage` stays pure and the value belongs in the coin union with its
    siblings. `bonusOnHeads` is NOT collapsed into `perHeads` with `flips: 1` even
    though the arithmetic coincides (`heads × per` is correct for both, and
    attack.ts computes them with one expression): they differ in the printed marker,
    "+" keeps the base and "×" drops it, and one flag would hide that.

    THE `modifierSimulated` TRAP RECURRED EXACTLY WHERE D126 PREDICTED. "D×" is a
    marker the reader consumes, so the term flipped from naming the one member that
    owns a modifier to naming the one that does NOT (`kind !== "cancelOnTails"`) —
    the more honest statement, and the one that keeps a future member from silently
    defaulting to "unsimulated".

    `MAX_PRINTED_FLIPS = 10` is a refusal ceiling, not a rule: the pool's maximum is
    4, and the digits come from ingested third-party text, where an unbounded `\d+`
    would let one malformed row spin the resolution loop. A refusal is LOUD; a hang
    is not. `flips >= 2` because the sentence's "coins" is plural — the one-flip
    form is printed "Flip a coin." and belongs to the two D126 patterns.

    Still LOUD after this: "Flip a coin until you get tails." (9 prints — an
    UNBOUNDED fold, a genuinely different risk) and "Flip a coin for each {R} Energy
    attached to this Pokémon." (3 prints — a BOARD-counted number of flips, which is
    where the board vocabulary would finally earn a place in this family).

    Cost: 1 skeleton regex + 1 constant, 1 union member, 1 deriver arm, 1 loop + 2
    terms in attack.ts. ZERO new events, ops, `BoardCondition`/`DamageCountSource`
    members, clause-table rows, state fields, error codes, registry rows or log
    arms; no continuous.ts diff; no web/API/DB/`@luminous/schema` diff. NO
    MATCH_RECORD_VERSION BUMP — no event shape changed at all. */
/** 0.79.0 — P3-M5: the BOARD-COUNTED FLIP COUNT (D128). "Flip a coin for each
    [{X}] Energy attached to this Pokémon. This attack does D damage for each
    heads." (3 printings) now SIMULATES: Torkoal sv01-035 "Concentrated Fire"
    ({R}{C}{C}, 80×, the TYPED `{R}` reading and the pool's only coin effect
    carrying a brace token), Ambipom swsh10.5-057 "Full Tilt Fling" ({C}, 60×) and
    Bellossom sv03-003 "Powerful Dance" ({G}, 90×) — the UNTYPED reading, two
    printings, so D121's warrant for one shared shape is met rather than assumed.

    THE FLIP COUNT IS A BOARD FACT; THE DAMAGE COUNT IS STILL NOT. D126's rule is
    untouched — `scaledAttackDamage` stays pure and state-only and gains no
    `DamageCountSource` member, because the damage still comes from the faces. What
    the board answers is HOW MANY TIMES TO FLIP, which is the one number a coin
    cannot answer, so the slice is a WIDENED `flips` (`AttackFlipCount` = printed N
    | attached Energy) rather than a fourth `AttackCoinFlip` member. The fold, the
    loop, the one-row-per-flip event sequence and the dropped printed base are all
    D127's, verbatim.

    A BOUND IS OWED TO THE SOURCE OF THE NUMBER, NOT TO THE LOOP. D127's
    `MAX_PRINTED_FLIPS` guards `printed` alone and deliberately does not travel:
    printed digits are read out of third-party ingested text and have no upper
    bound but that constant, while an attached-Energy count is read off the
    engine's own state and is bounded by the deck that produced it. A ceiling there
    would refuse a legal board rather than a malformed row.

    A ZERO COUNT MEANS ZERO FLIPS, which is not zero heads: no
    `ATTACK_EFFECT_COIN_FLIP` rows and no rngState step, where D127's zero-HEADS
    outcome spends its flips and announces every one. Both land on the same ending
    (no damage, turn still ends). No printing can reach it — every one of the three
    has a cost floor of at least one Energy, and Torkoal's `{R}` cost IS the `{R}`
    its filter counts — so the branch is defensive and `fix-flip-filter` is the
    constructed fixture that pins it.

    BOTH ENERGY NOTATIONS, through D118's `CLAUSE_ENERGY_TOKENS` rather than a
    local `{R}` lookup: the pool prints types brace-coded (sv*) and spelled out
    (swsh10.5), and reusing the map means a "for each Water Energy" reprint is
    admitted by construction. An unresolvable token — `{C}`, `{N}`, garbage — is
    told apart from the UNFILTERED sentence by the token's presence, not by the
    lookup, and falls through to the loud ATTACK_EFFECT_SKIPPED path.

    Cost: 1 skeleton regex, 1 exported union (`AttackFlipCount`), 1 deriver arm, 1
    continuous.ts counter (`countAttachedEnergy`, beside `hasAttachedEnergy`), 1
    private `flipCount` reader + 1 changed line in attack.ts. ZERO new events, ops,
    `BoardCondition`/`DamageCountSource` members, clause-table rows, state fields,
    error codes, registry rows or log arms; no web/API/DB/`@luminous/schema` diff.
    NO MATCH_RECORD_VERSION BUMP — no event shape changed at all. */
/** 0.80.0 — P3-M5: the UNBOUNDED FOLD (D129). "Flip a coin until you get tails.
    This attack does D [more] damage for each heads." (5 damaging printings) now
    SIMULATES, and with it the coin family's LAST damaging shape: Growlithe
    sv01-030 "Relentless Flames" (30×), Rellor sv02-026 "Ball Roll" (30×),
    Forretress sv01-139 "Continuous Spin" (50×), Chansey sv01-144 "Egg Rolling"
    (60×) — the MULTIPLY reading, printed base dropped — plus Bouffalant sv03-174
    "Damage Rush" ("30 MORE damage for each heads", 50+) — the ADDITIVE reading,
    printed base kept. The other 3 "until you get tails" printings run an EffectOp
    per heads rather than folding a number and stay on the loud skipped path.

    THE FLIP COUNT IS NEITHER TEXT NOR BOARD — IT IS THE FACES. `untilTails` is the
    third `AttackFlipCount` member and the first that is not a number at any point:
    D127's is known at derivation, D128's at the flip site, and this one only once
    the coin has been drawn. So `flipCount` (a reader returning a COUNT for a `for`
    loop to consume) could not express it without flipping to find out how many
    times to flip — it became `takeFlips`, returning the SEQUENCE OF FACES for all
    three members. Every member now announces its rows and tallies its heads
    through one path with no `untilTails` branch at the site at all.

    A TERMINATION ARGUMENT, NOT A CEILING — the slice's real content. Nothing in
    the text or the board bounds this count, so D127's answer (refuse the row) would
    refuse a LEGAL sentence, and a truncating cap chosen by feel would silently lie
    about the game rather than loudly skip it. The bound is therefore owed to the
    RNG that produces the faces (D128's provenance rule, third application):
    `MAX_UNTIL_TAILS_FLIPS = 64` lives in rng.ts beside `flipCoin`. mulberry32's
    pre-states advance by a fixed ODD stride, so the flips walk `n·K mod 2³²` and
    the face sequence is ONE fixed cycle whose worst case is MEASURABLE rather than
    probabilistic: scanned over all 4 294 967 296 steps (plus the wrap — the cycle
    ends "…HH" and begins "H…"), THE LONGEST RUN OF CONSECUTIVE HEADS IS 31. 64 is
    twice that, so the cap cannot fire from any seed and every sequence ends in
    tails. `flipUntilTails` takes the cap as a PARAMETER so the truncation branch
    stays reachable in a test at cap 1 and 2; the engine's own value is, by design,
    dead code.

    IT REACHES BOTH DAMAGE MEMBERS, which is the shape's one surprise and the proof
    that D126's split was load-bearing rather than incidental. 4 printings are "D×"
    (`perHeads`, base dropped) and Bouffalant is "50+" (`bonusOnHeads`, base kept) —
    one flip COUNT, two consequents. So `bonusOnHeads` GREW THE SAME `flips` FIELD
    D128 gave `perHeads` (its D126 printings derive `{ printed, 1 }`, which is what
    they always were implicitly), and the union has now stayed THREE MEMBERS ACROSS
    FOUR SHAPES: count and consequent are independent axes, and a member per pair
    would be six members and five copies of one fold.

    Cost: 2 skeleton regexes, 1 union member (`AttackFlipCount.untilTails`), 1
    widened field (`bonusOnHeads.flips`), 2 deriver arms, 1 rng.ts primitive +
    1 constant, and `flipCount` → `takeFlips` in attack.ts. ZERO new events, ops,
    `BoardCondition`/`DamageCountSource` members, clause-table rows, state fields,
    error codes, registry rows or log arms; no continuous.ts diff; no web/API/DB/
    `@luminous/schema` diff. NO MATCH_RECORD_VERSION BUMP — no event shape changed
    at all. */
/** 0.81.0 — P3-M5: the per-heads PROGRAM (D130). "Flip {N} coins|a coin until you
    get tails. For each heads, discard the top {M} cards of your opponent's deck."
    now SIMULATES — Wugtrio sv01-057 "Undersea Tunnel" (idx 1, {C}{C}{C}, 3 flips,
    mill 3) and Gyarados swsh10.5-022 "Wreak Havoc" (idx 0, {C}, until tails, mill
    2), the pool's only two mill-per-heads printings, neither of which prints a
    `damage` field at all.

    THE FIRST COIN CONSEQUENT THAT IS NOT A NUMBER. D126 built the seam (a printed
    flip is taken in FRONT of the §8.5 pipeline, because a flip that gates or scales
    damage cannot be an effect PROGRAM — programs run at attack.ts's TAIL, strictly
    after the number is computed), and D127/D128/D129 then varied only the flip
    COUNT: printed, board-read, unbounded. Every one of them FOLDED the faces into
    arithmetic. `programPerHeads` keeps the count axis untouched and moves the other
    one: "For each heads, X" runs an OP per heads and folds nothing, so the member
    carries `ops: EffectOp[]` where its two siblings carry `per: number`.

    THE CARRY IS PROGRAM EXPANSION AT THE FLIP SITE, and it is the slice's real
    content. The flips are taken in front of §8.5 and EffectOps run at the tail, and
    until now NOTHING carried a value between those two places. The obvious repair —
    thread a heads COUNT through to `runProgram` and teach the interpreter a "repeat"
    op — buys a second way to say "N times" and a new vocabulary member to say it
    with. But "For each heads, X" literally IS X repeated `heads` times, and the tail
    already runs an `EffectOp[]`: so the faces are spent AT THE FLIP SITE into a
    LONGER PROGRAM. `heads` copies of the member's ops, APPENDED to whatever program
    the attack already had (never assigned over it — a registry row must not be
    silently droppable by a coin sentence), and `heads === 0` expands to nothing,
    which is why the zero-heads outcome needs no branch and takes the existing
    no-program ending. The value that crosses the gap is the program itself.

    THAT IS ONLY LEGAL BECAUSE THE OP IS DETERMINISTIC AND NEVER PARKS.
    `discardDeckTop` (named `discardOpponentDeckTop` until D131 widened it) consumes
    no `rngState`, asks no question and clamps to
    the deck, so N copies of it is N ordinary steps. The two "For each heads"
    printings NOT built are exactly the two where that fails: Krookodile sv01-117
    discards an Energy (a `discardEnergy` that PARKS on a choice — N heads would be N
    sequential parks across a serialized continuation) and Masquerain sv03-007
    discards a RANDOM card from the hand (the first EffectOp that would consume
    `state.rngState`). Oinkologne sv03-184 shares the opening and not the shape — a
    heads COUNT read as an "up to" ceiling by one op. All three stay loudly unmapped,
    and untilTailsFlip.test.ts's end-to-end witness was RE-POINTED from Gyarados
    (which this slice maps) onto Krookodile rather than deleted.

    TWO PRINTINGS ACROSS TWO FLIP-COUNT SOURCES IS WHAT MAKES IT A SLICE, and it
    REUSES `AttackFlipCount` WHOLESALE — that union is unchanged. Wugtrio is
    `{ printed, 3 }` and Gyarados is `{ untilTails }`, feeding a byte-identical op.
    D128's doc block has claimed since it was written that the flip COUNT and the
    flip CONSEQUENT are independent axes; this is the first slice that DEMONSTRATES
    it rather than asserting it, and the union has now stayed one member per
    consequent across five shapes.

    ONE READER OWNS THE SENTENCE. The ops live on the coin member rather than being
    produced by `deriveAttackEffect` off the same string, so no invariant has to hold
    between two derivers reading one printing — the kind of invariant nothing can
    enforce and every future arm can break.

    §14.3 DECK-OUT IS A TURN-START RULE AND THE MILL DOES NOT TOUCH IT. Milling a
    deck to zero does not end the game: the milled player loses when they must DRAW
    and cannot (flow.ts `startTurn`), exactly as a short `drawCards` short-draws
    rather than losing. Attacking ends the turn, so the loss does arrive in the same
    event batch — AFTER TURN_ENDED and TURN_STARTED, with reason "deckOut", which is
    what the clamp cases pin.

    `DECK_TOP_DISCARDED` IS REUSED, NOT JOINED BY A SIBLING (D113's rule). Its game
    fact is exactly ours — these uids went from the top of `seat`'s deck to `seat`'s
    discard pile — and `seat` is the deck's OWNER on both producers, which here is
    the NON-actor. What was fixed instead is the MESSAGE: log.ts said "discarded N
    LOOKED-AT cards", true of Hydreigon "Tri Howl" and a flat lie about a mill, so
    the wording is now provenance-neutral. redact.ts needs no arm and still has none:
    it redacts STATE, and a discard pile is public in any case.
    (Provenance-neutral was necessary and not sufficient — D136 then fixed the VOICE,
    and D153 found that no single voice can be true of all three paths and gave the
    event an `actor`. The reuse claim above still holds: the event was never joined
    by a sibling. See 0.101.0.)

    Cost: 2 skeleton regexes, 1 `AttackCoinFlip` member (`programPerHeads`), 1
    `EffectOp` member (`discardOpponentDeckTop`, since renamed) + its interpreter arm, 1 new arm and
    1 `const` → `let` in attack.ts's flip block, 1 `modifierSimulated` exclusion, and
    1 reworded log line. ZERO new events, `AttackFlipCount` members,
    `BoardCondition`/`DamageCountSource` members, clause-table rows, state fields,
    prompts, error codes, registry rows or redact arms; no rng.ts diff and no
    continuous.ts diff. NO MATCH_RECORD_VERSION BUMP — no `MatchRecord`/`GameState`
    shape changed and no event shape changed. No web/API/DB/`@luminous/schema`
    diff. */
/** 0.82.0 — P3-M5: the UNCONDITIONAL MILL, both directions (D131). "Discard the
    top [{N} cards|card] of your [opponent's] deck." now SIMULATES on ONE anchored
    regex and ONE deriver arm — **16 printings / 7 distinct clauses**, the largest
    single mapping any slice in this family has taken, and the cheapest per printing.
    Censused against the local D1 (2026-08-01) over the WHOLE effect string: 7
    opponent-side (Chi-Yu ex sv02-040/-234/-259 "Jealously Singe", Garganacl
    sv02-123 + Diggersby sv03-113 "Knocking Hammer", Paldean Clodsire sv03-128
    "Muddy Hammer", Skwovet sv03-178 "Nicked Nibble") and 9 own-side (Fraxure
    sv06.5-045/-077 + Haxorus sv06.5-046 "Dragon Pulse", Gyarados swsh10.5-022 "Wild
    Splash", Tyranitar sv02-135/-222 "Dread Mountain", Tyranitar ex sv03-066/-211
    "Mountain Hurl", Diglett sv03-103 "Hole-Diggin' Noggin").

    THE OP WAS ALREADY BUILT, AND THAT IS THE HEADLINE. D130 shipped the mill for
    the coin family and wrote into its own doc block that it was OPPONENT-ONLY by
    D104's minimal shape, that the own-deck reading ("Wild Splash") was a live
    unmapped sentence, and that "the first slice that maps it widens this field then,
    with two readings in hand rather than one guessed at". This is that slice, taken
    verbatim off that note: `discardOpponentDeckTop` → `discardDeckTop` with a
    `whose: "self" | "opponent"` field, and the interpreter arm grew ONE ternary.
    **A forecast a previous slice wrote down was executable a session later without
    re-deriving anything** — which is the return on stating the widening rule at the
    time you decline to take it.

    WIDEN THE FIELD, DON'T ADD A MEMBER (D128's provenance rule in the small). The
    two sentences differ in exactly one word and everything downstream of picking the
    seat is byte-identical, so a second op member would have been two copies of one
    `slice`. Gyarados swsh10.5-022 settles it on its own: index 0 mills the OPPONENT
    (behind D130's until-tails coin), index 1 mills its OWN deck for 5 — one card,
    one action, two directions. The fixture already carried both sentences verbatim
    because D130 fielded "Wild Splash" as its refused near-miss, so the widening's
    proof case needed no new bytes.

    TWO CAPTURES IN ONE REGEX IS NOT A D119 VIOLATION. D119 ("if TWO things vary it
    is not one token") governs the clause TABLE, where a row is a lookup key and a
    two-token row is N rows in disguise. Here both varying tokens land in FIELDS of
    one op — `count` and `whose` — each has a closed reading, and the printed
    sentence is a single action. The singular gets its OWN alternation branch rather
    than an optional `(\d+)?`, because "the top card" (7 printings) and "the top N
    cards" (9) are two printed SPELLINGS: one never carries a digit, the other always
    does, and "the top cards" is neither and reads as nothing. The branch does not
    filter — "the top 1 cards" is unprinted but unambiguous, and refusing it would
    cost a digit class that exists to reject one string.

    THE SELF-MILL IS A COST, AND §14.3 STILL LANDS AT THE DRAW. Nine of the sixteen
    printings mill their OWN deck for damage (Haxorus 230 for 3 cards, Tyranitar 230
    for 4), so the op can now empty the ATTACKER's deck — and the deck-out rule is
    unchanged by that: the loss is owed at that player's next draw step (flow.ts
    `startTurn`), not the instant the deck runs dry. Attacking ends the turn, so an
    opponent-mill-out surfaces in the same event batch and a self-mill-out surfaces a
    full turn later. Both are pinned.

    NINE PRINTINGS CARRY PRINTED DAMAGE, which the tail placement (D125) already
    handles with no new thought: the ops run AFTER the §8.5 pipeline, so "230 damage,
    then discard 3 of your own" resolves in the printed order for free.

    Cost: 1 regex, 1 deriver arm, 1 RENAMED + widened `EffectOp` member, 1 ternary in
    its interpreter arm. ZERO new events, ops, `AttackCoinFlip`/`AttackFlipCount`/
    `BoardCondition`/`DamageCountSource` members, clause-table rows, state fields,
    prompts, error codes, registry rows, redact arms or log arms — the log row was
    already provenance-neutral and seat-owner-keyed (D113/D130), which is exactly the
    property that let one op start emitting on both seats with no copy change. No
    rng.ts / continuous.ts / attack.ts diff. NO MATCH_RECORD_VERSION BUMP — no
    `MatchRecord`/`GameState` shape and no event shape changed. No web/API/DB/
    `@luminous/schema` diff. */
/** 0.83.0 — P3-M5: the BARE SELF-HEAL sentence (D132). "Heal {N} damage from this
    Pokémon." now SIMULATES on ONE anchored regex and ONE deriver arm — **18
    printings / 4 distinct clauses** (N = 10, 20, 30, 50), every one of them a
    STANDALONE single sentence. Censused against the local D1 (2026-08-01) over the
    WHOLE effect string: 8 at 30 (Horsea sv06.5-010/-067 + Slowpoke swsh10.5-019
    "Hold Still", Slowbro sv01-043 + Azumarill sv02-045 "Bubble Drain", Brambleghast
    sv02-024 "Absorb Life", Ceruledge sv02-098 "Life Sucker", Dolliv sv03-020 "Sunny
    Wind"), 5 at 20 (Natu swsh10.5-032 "Nap", Tropius sv02-007/-195 "Leaf Drain",
    Marill sv02-044/-204 "Bubble Drain"), 4 at 10 (Shroomish sv01-003 + Smoliv
    sv03-019 "Absorb", Bramblin sv02-023/-198 "Blot") and 1 at 50 (Ariados
    swsh10.5-007 "Absorb").

    THE OP WAS ALREADY BUILT, AND HAS BEEN SINCE 0.x. `heal { target: "self" }` is
    one of the oldest members of `EffectOp`, shipped for the COMPOUND printing "This
    Pokémon is now Asleep. Heal {N} damage from it." (SELF_SLEEP_HEAL) and exercised
    end to end ever since. What was missing was never a mechanism — it was a READER
    for the same action printed without the Sleep clause in front of it. So this
    slice is the smallest one this family has taken and among the largest in
    printings per byte: a regex, an arm, a guard, and eighteen cards come off the
    loud ATTACK_EFFECT_SKIPPED path. It is the same lesson D131 drew from D130 in the
    other direction: **the expensive part of a sentence is its mechanism, and once
    the mechanism exists a second spelling is nearly free.**

    ONE ANCHORED READER PER PRINTED STRING, AND THE TWO ANCHORS PROVE IT. The new
    `SELF_HEAL` starts at `^Heal`; `SELF_SLEEP_HEAL` never does. Neither can claim
    the other's string, so the invariant holds by construction rather than by arm
    ordering — and the test asserts the compound's `heal` op is BYTE-IDENTICAL to the
    bare anchor's for the same N, which is what makes "one action, two sentences"
    a checkable claim rather than a description.

    THE GUARD IS THE FAMILY'S, THE CLAMP IS THE INTERPRETER'S. `amount >= 1` refuses
    a printed "Heal 0 damage" — a silent no-op that reported a simulated effect is
    strictly worse than a loud unsimulated one. There is deliberately NO ceiling and
    NO clamp in the deriver: `healSelf` already takes `Math.min(amount, damage)`, so
    the printed number is a MAXIMUM and the board decides the rest. A whiff — an
    undamaged Active — emits NO HEALED row at all, and the attack is still SIMULATED:
    "the op ran and had nothing to do" and "the sentence was never read" are
    different facts and do not share a log row.

    TWELVE OF THE EIGHTEEN CARRY PRINTED DAMAGE, which the tail placement (D125)
    handles with no new thought: the ops run AFTER the §8.5 pipeline, so Ceruledge's
    "50 damage, then heal 30" resolves in the printed order for free. The other six
    (Natu "Nap", Horsea "Hold Still") print no `damage` field at all, so the heal is
    the entire visible result of the declaration — both halves are pinned, because a
    build that folded the heal into the damage pipeline would pass the first and fail
    the second.

    Cost: 1 regex, 1 deriver arm, 1 test fixture (Natu swsh10.5-032), 1 test deck,
    1 test file, and a doc block on the ONE `EffectOp` member that had none. ZERO new
    events, ops, `EffectOp` members, `AttackCoinFlip`/`AttackFlipCount`/
    `BoardCondition`/`DamageCountSource` members, clause-table rows, state fields,
    prompts, error codes, registry rows, redact arms or log arms. NO INTERPRETER
    DIFF — `healSelf` was already correct, including its clamp and its silence. No
    rng.ts / continuous.ts / attack.ts / events.ts diff. NO MATCH_RECORD_VERSION BUMP
    — no `MatchRecord`/`GameState` shape and no event shape changed. No web/API/DB/
    `@luminous/schema` diff. */
/** 0.84.0 — P3-M5: the OWN-BOARD HEAL sentence (D133). "Heal {N} damage from each of
    your Pokémon." now SIMULATES on ONE anchored regex and ONE deriver arm — **7
    printings / 2 distinct clauses** (N = 20, 30), every one a STANDALONE single
    sentence. Censused against the local D1 (2026-08-01) over the WHOLE effect string:
    5 at 30 (Skeledirge ex sv02-037/-233/-258/-272 "Vitality Song", WITH a printed 50,
    + Steenee sv03-017 "Aromatherapy") and 2 at 20 (Cresselia sv06.5-021/-071 "Healing
    Pirouette"). THE HEAL CENSUS IS CLOSED and this slice was read straight off it —
    no new sweep was needed, only D132's own remainder list.

    D132 A SECOND TIME, EXECUTED VERBATIM. `healEach { amount }` has shipped since 0.x,
    produced by Garganacl sv02-123's between-turns "Blessed Salt" Ability; what was
    missing was a READER for the same action printed as an ATTACK. So this is the
    inventory rule applied to its own leftovers: D132 said "before pricing a shape,
    ask what an EXISTING arm already emits", wrote down which heal clauses had ops and
    which did not, and the top of that list cost exactly what it forecast — a regex,
    an arm, a guard. NO INTERPRETER DIFF, for the second slice running.

    "EACH OF YOUR POKÉMON" IS THE ACTIVE AND THE BENCH, and that reading — not the
    regex — is the only substantive content of the slice. §1.1: the Active is one of
    your Pokémon, and only the printed word "Benched" excludes it. `healEach` was
    already written that way (`side.active` then `side.bench` in index order), but it
    had only ever been reached from a CHECKUP trigger, where the Active is nobody in
    particular; from an ATTACK the Active is the ATTACKER, which is the case a build
    that healed "the rest of the board" would get wrong. So it is asserted end to end
    rather than inherited from the op's doc comment — including the degenerate
    empty-Bench board, where the Active alone IS "each".

    THE CLAMP IS PER POKÉMON, and the board is arranged to show it: {100, 80, 10}
    damage against a printed 30 heals {30, 30, 10} and emits three rows reporting
    exactly that. A shared clamp, or a clamp read once off the Active, passes every
    one-body board and fails only here. The whiff is silent PER POKÉMON too — an
    undamaged body between two damaged ones emits NO row and does not truncate the
    sequence, so the count of HEALED rows is the count of Pokémon that MOVED rather
    than the count on the board.

    THE SEAT SCOPE IS THE `healEachAll` BOUNDARY, asserted from both sides: the
    Picnic Basket sentence ("each Pokémon (both yours and your opponent's)") is
    refused at the deriver, and the end-to-end case damages the OPPONENT's Active and
    Bench so they can be asserted unhealed — invisible on an undamaged opponent, which
    is why every earlier heal board would have passed a seat-blind implementation.

    THE ANCHOR'S REAL JOB IS SAGUARO. sv02-187/-255/-270 prints "Choose up to 2 of
    your Pokémon and heal 50 damage from each of them." — the mapped words,
    mid-sentence, behind a choice. A reader without `^` would take its tail and heal
    the whole board unconditionally. It is a Supporter and never routes through this
    deriver in production; the guard is asserted anyway, because a guard that depends
    on which reader a card happens to reach is not a guard.

    FOUR OF THE SEVEN CARRY PRINTED DAMAGE (Skeledirge ex's 50), which the tail
    placement (D125) handles with no new thought; the other three print no `damage`
    field at all (Cresselia, Steenee), so the board heal is the entire visible result.
    Both halves are pinned, for the same reason D132 pinned them.

    Cost: 1 regex, 1 deriver arm, 2 test fixtures (Skeledirge ex sv02-037, Cresselia
    sv06.5-021), 1 test deck, 1 test file, and a widened doc block on the `healEach`
    member. ZERO new events, ops, `EffectOp` members, `AttackCoinFlip`/
    `AttackFlipCount`/`BoardCondition`/`DamageCountSource` members, clause-table rows,
    state fields, prompts, error codes, registry rows, redact arms or log arms. NO
    INTERPRETER DIFF — `healEach` was already correct, including its per-Pokémon clamp,
    its silence and its Active. No rng.ts / continuous.ts / attack.ts / events.ts diff.
    NO MATCH_RECORD_VERSION BUMP — no `MatchRecord`/`GameState` shape and no event
    shape changed. No web/API/DB/`@luminous/schema` diff. */
/** 0.85.0 — P3-M5: the FLIP-GATED OP family (D134). "Flip a coin. If heads,
    <action>." now SIMULATES for two more consequents, on TWO anchored regexes and
    TWO deriver arms — 3 printings / 2 distinct clauses. Censused against the local
    D1 (2026-08-01) over the WHOLE effect string: Fuecoco sv02-035/-201 "Spacing Out"
    (gated `heal 30 damage from this Pokémon`, 2 printings) and Wiglett sv01-056 "Dig
    a Little" (gated `discard the top card of your opponent's deck`, 1). Both print
    NO `damage` field, so the gated action is the entire visible result and a tails
    face moves nothing anywhere.

    D132's INVENTORY RULE FOR THE THIRD SLICE RUNNING, and the cheapest form it has
    taken: BOTH consequents already existed (`heal { target: "self" }` since 0.x,
    `discardDeckTop` since D130) and so did the gate (`coinFlipGate`, since 0.x, with
    two members already reading it — `FLIP_DEFENDER_NOW` and
    `FLIP_OPPONENT_ACTIVE_DISCARD`). What was missing was two readers. So the derived
    program's `then` is BYTE-IDENTICAL to what the bare anchor derives for the same
    clause, and that identity is asserted in both directions rather than described.
    NO INTERPRETER DIFF, for the third slice running.

    THE TWO SHIP TOGETHER, AND THAT IS THE SLICE'S ONE JUDGEMENT CALL. Fuecoco is 2
    printings and clears D121's warrant alone; Wiglett is ONE and does not. Taken
    together the SHAPE is 3 printings / 2 clauses and the engine already reads two
    other instances of it, so Wiglett is a fourth member of a family rather than a
    bespoke row for one card. The generalisation: WHEN A ONE-PRINTING SENTENCE IS AN
    INSTANCE OF A SHAPE THE ENGINE ALREADY READS, THE WARRANT IS OWED BY THE SHAPE,
    NOT BY THE PRINTING — count members of the family, not copies of the card.

    LITERAL ARMS, NOT A D120 TEMPLATE, and this is the precondition failing rather
    than a preference: the token that varies between the two anchors is the WHOLE
    CONSEQUENT — an open-ended vocabulary of everything an `EffectOp` can express —
    where D120 licenses a template only for a token with a CLOSED reading (the five
    status words, the nine energy codes). The two consequents share not one word
    after "If heads, ", which the suite asserts as a set intersection. So the gate
    prefix is spelled out once per consequent and the file now carries four copies of
    it on purpose.

    THE MILL ARM IS DELIBERATELY NARROWER THAN `DECK_TOP_MILL`, which reads both a
    plural count and either deck: exactly one gated printing exists and it is the
    SINGULAR, OPPONENT-side one, so widening would invent three readings the ingest
    has never produced. Widen it when a printing appears, with the readings in hand.

    THE TAILS FACE IS THE HALF THAT NEEDED TESTING, and every end-to-end claim here
    is a SEED SWEEP collecting both faces rather than a single board — the first
    heal-or-mill suite that needs one. Three states are distinguishable and all three
    are real: tails (the branch never ran), heads-with-nothing-to-do (it ran and
    whiffed), and skipped (the sentence was never read). A TAILS IS NOT A SKIPPED
    EFFECT — no ATTACK_EFFECT_SKIPPED on either face — and the coin is TAKEN on both,
    so `rngState` advances even when nothing happens; a build that checked the face
    before flipping would desynchronise the next coin in an online match.

    Cost: 2 regexes, 2 deriver arms, 2 test fixtures (Fuecoco sv02-035, Wiglett
    sv01-056), 1 test deck, 1 test file, 2 widened `EffectOp` doc blocks, 3
    re-pointed witnesses (selfHeal, boardHeal, deckTopMill). ZERO new events, ops,
    `EffectOp`/`AttackCoinFlip`/`AttackFlipCount`/`BoardCondition`/`DamageCountSource`
    members, clause-table rows, state fields, prompts, error codes, registry rows,
    redact arms or log arms. NO INTERPRETER DIFF — `coinFlipGate`, `heal` and
    `discardDeckTop` were all already correct. No rng.ts / continuous.ts / attack.ts /
    events.ts diff. NO MATCH_RECORD_VERSION BUMP — no `MatchRecord`/`GameState` shape
    and no event shape changed. No web/API/DB/`@luminous/schema` diff. */
/** 0.86.0 — P3-M5: the CHOSEN HEAL (D135). "Heal {N|all} damage from 1 of your
    [Benched] Pokémon." now SIMULATES — **10 printings across 7 distinct clauses** on
    ONE anchored regex, ONE deriver arm and ONE NEW FIELD, and it closes the heal
    family: every "Heal …" sentence the pool prints as an attack now has a reader
    except Iron Moth sv06.5-009's damage-echo and Floette sv01-092's compound gate.
    Censused against the local D1 (2026-08-01) over the WHOLE effect string —
    ANY-ZONE: Nacli sv02-121/-220 "Salt Coating" (20), Smoliv sv01-021 "Nutrients"
    (30), Vespiquen ex sv03-096/-212 "Healing Pheromone" (60); BENCH-ONLY: Combee
    sv03-008 "Share" (20), Chansey swsh10.5-051 "Delicious Egg" (30), Tropius sv01-007
    "Fresh-Picked Fruit" (60), Blissey swsh10.5-052 "Enriching Egg" + Arboliva
    sv03-021 "Healing Fruit" ("all"). NOT ONE of the ten carries a printed `damage`
    field, so the heal is the entire visible result every time.

    THE MECHANISM QUESTION THIS SLICE WAS PRICED ON DOES NOT EXIST. Three slices of
    notes called it "the first PARKING op the ATTACK deriver emits" and asked how
    D125's tail placement interacts with a park. It interacts perfectly, and has since
    long before: `damageChosen` (the derived snipes) and `discardEnergy` (the derived
    self-discard cost) already park from an attack tail, through the same
    `settleProgram(..., { resumeTail: true })` trainers use minus the flag. The park
    writes an `effect:choose` phase and LEAVES `attackEpilogue` on `state.pending`, so
    the KO sweep, the prizes and §5.3's turn end all wait for the choice and then run
    in order. ZERO attack.ts / flow.ts / cardplay.ts diff. The generalisation is about
    the NOTE rather than the code: A FORECAST OF COST IS NOT A MEASUREMENT OF IT — the
    note was written by a slice that never looked, carried forward verbatim three
    times, and the check took one read. Verify a forecast before letting it re-rank a
    list.

    THE ONLY NEW VOCABULARY IS `healChosen.zone?: "bench"` — the printed word
    "Benched" and nothing else (§1.1: absent, the Active is one of your Pokémon and is
    offered; present, it is not). A FIELD rather than a second op member, because
    everything downstream of picking the candidate set is byte-identical: same park,
    same choice shape, same heal, same HEALED event (D131's widen-don't-add rule).
    The interpreter diff is one ternary over `ownBenchRefs` — a helper `switchActive`
    and `gust` have used since 0.x — plus the prompt heading, which is zone-aware in
    BOTH arms on purpose: a field that silently meant nothing on the `upTo` arm would
    be a trap for the first author who combines them, and a heading that disagreed
    with its candidates would lie about what it is offering.

    ONE REGEX, TWO CAPTURES, ONE OP — D131's shape exactly, and NOT a D120 template:
    both varying tokens land in FIELDS of a single op rather than rows of a lookup
    table, so D119 does not govern and there is no table to look anything up in.
    "all" cost one alternation branch and nothing else, because `healChosen.amount`
    has taken `number | "all"` since 0.x (Arboliva's "Enriching Oil" Ability prints
    it — but on a DIFFERENT CARD: that row is keyed `sv01-023`, a 150 HP Arboliva from
    another set whose only attack is "Solar Beam", while the printing mapped here is
    `sv03-021`, 140 HP with NO Ability at all. `programFor("sv03-021")` is undefined
    entirely, and `sv01-023`'s row is untouched. Two cards, one name — checked against
    the D1 rather than inferred from the name.) The cross product is deliberately UNFILTERED: "Heal all damage from
    1 of your Pokémon." is unprinted and this anchor accepts it, the same call D131
    made for the unprinted "the top 1 cards" — a refusal would be a claim about the
    ingest rather than about the game.

    AN EMPTY BENCH IS A WHIFF, NOT A SKIP, and that is the reading worth testing.
    `parkOrForce` has three endings and all three are real: zero candidates resolves
    SILENTLY, exactly one is applied INLINE with no prompt, and two or more park. So a
    lone-Active Tropius reads its sentence, finds nobody to heal and ends the turn in
    one action — with NO `ATTACK_EFFECT_SKIPPED`, because the sentence WAS read (the
    D134 three-state distinction, on a different axis).

    Cost: 1 regex, 1 deriver arm, 1 `EffectOp` FIELD, 1 interpreter ternary + 1 note
    parameter, 3 test fixtures, 1 test deck, 1 test file, 2 re-pointed witnesses
    (selfHeal, boardHeal — 5 of selfHeal's 7 near-misses now land on a neighbour,
    which is what a family being finished looks like from the inside). ZERO new
    events, ops, `EffectOp`/`AttackCoinFlip`/`AttackFlipCount`/`BoardCondition`/
    `DamageCountSource` members, clause-table rows, state fields, PROMPTS, error
    codes, registry rows, redact arms or log arms. No rng.ts / continuous.ts /
    attack.ts / flow.ts / cardplay.ts / events.ts diff. NO MATCH_RECORD_VERSION BUMP —
    the same widening-not-a-missing-field distinction D125 recorded, and an absent
    optional field reads identically in every older record. No web/API/DB/
    `@luminous/schema` diff. */
/** 0.87.0 — P3-M5: the COUNTER MOVE (D138). "Move all damage counters from 1 of
    your Benched Pokémon to your opponent's Active Pokémon." now SIMULATES —
    **2 printings** (Dedenne ex sv02-093/-239 "Tail Swap", one attack in two
    rarities, so D121's warrant is met by the card) on ONE anchored regex with NO
    CAPTURE, ONE deriver arm and ONE NEW OP with NO FIELDS. Neither printing
    carries a `damage` field, so the move — and the park in front of it — is the
    entire visible result of the declaration.

    ⚠️ THE ATTACK IS NAMED "Tail Swap". Three consecutive remainder lists called it
    "Dedechange" and the local D1 prints no such attack anywhere in its 978 cards / 6 sets.
    That is D135's lesson landing on D135's own note: a forecast — or a name —
    copied forward gains authority from repetition alone, and checking it took one
    query.

    CENSUS (local D1, 2026-08-02, whole effect string). Attack effects containing
    "damage counter" — **56 printings / 31 distinct clauses**; the ones that MOVE
    rather than PUT — **2 printings / 1 clause**, this sentence. The whole
    counter-move neighbourhood in the pool is three clauses and the other two are
    ABILITIES on a different reader: Munkidori sv06.5-072 "Adrena-Brain" (move UP
    TO 3, from any of your Pokémon, to a CHOSEN one of your opponent's) and Slowbro
    sv01-043 "Strange Behavior" (move 1, to YOUR OWN side). They differ on three
    axes at once, which is what makes a field-less op the honest shape.

    THE RESUME POINT'S TWO CLAIMS, CHECKED BEFORE ANYTHING WAS BUILT (D135's rule).
    "The CHOICE half is free" — TRUE, and exactly: `ownBenchRefs` through
    `parkOrForce` is byte-for-byte the candidate set D135 built for
    `healChosen.zone: "bench"`, so the park, its three endings and the illegal-pick
    refusal all came for nothing. "The move half is new" — TRUE: no op in the union
    moves a counter; `damageActive` PLACES on the defender and `healChosen` REMOVES
    on your side, and this sentence is the first thing in the engine that does both
    in one action.

    A NEW OP MEMBER, WITH D131's WIDEN-DON'T-ADD RULE APPLIED AND FAILING rather
    than skipped. That rule licenses a FIELD when everything downstream of the
    candidate set is byte-identical; here the pick is the only thing shared. The op
    emits a SECOND event, on the OTHER seat's board, which can end the game — an op
    named `heal` that placed damage would be the misnaming D128's provenance rule
    exists to prevent. And it takes NO FIELDS on D104's minimal-shape rule, with
    D130's `discardOpponentDeckTop` as the precedent for putting the direction in
    the NAME; the condition that would earn `amount`/`from`/`to` is written into the
    op's doc block (D131: when you decline a widening, write down what warrants it).

    THE TWO ROWS CARRY THE SAME NUMBER, AND THAT EQUALITY IS THE WORD "MOVE" —
    `HEALED` for what came off the Bench (the body lands at exactly 0) and
    `COUNTERS_PLACED` for what went on. The placement is FLAT: a moved counter is
    not attack damage, so §8.5's Weakness and the `damageReductionAfterWR` passive
    both skip it (`damageActive`'s rule verbatim), pinned against a ×2 Psychic
    defender taking 80 rather than 160 from a Psychic attacker.

    `COUNTERS_PLACED.source` GREW A SIXTH MEMBER, `"moved"`, rather than reusing
    `"ability"` — and that is D136's finding 1 refused at the source. `seat` on this
    event owns the DAMAGED Pokémon, which here is the attacker's OPPONENT, and log
    rows render after their seat's name; an "Ability:" label would also be false
    about the provenance. The new log arm is a SYSTEM row for the same reason.

    IT CAN KNOCK THE DEFENDER OUT, and the pipeline was verified rather than
    assumed: the op only raises damage, and the attack epilogue's TWO-seat sweep
    (`finishAttack`) reads the POST-effect board — after a park just as much as
    inline, because `resumeTail` keeps `attackEpilogue` on `state.pending` until the
    choice lands. Pinned end to end: KNOCKED_OUT after COUNTERS_PLACED, the prize
    to the ATTACKER, the promotion prompt, and the turn ending only then.

    AN EMPTY BENCH IS A WHIFF AND SO IS A CLEAN PICK, neither is a SKIP (D135's
    ending, one slice on). `parkOrForce`'s three endings all mean here what they
    mean there, and the candidates are EVERY benched body damaged or not — the
    printed sentence carries no damaged restriction, so filtering would be a rule
    the card does not print (the Potion doctrine). An undamaged pick moves nothing
    and announces nothing, and NO `ATTACK_EFFECT_SKIPPED` fires on any of it,
    because a derived program means the sentence was read.

    Cost: 1 regex, 1 deriver arm, 1 `EffectOp` MEMBER, 1 interpreter case + 1
    `applyChoice` case + 1 helper, 1 event-enum member, 1 log arm, 2 test fixtures
    (Dedenne ex sv02-093 + a synthetic ×2 Psychic body), 1 test deck, 1 test file,
    1 re-pinned census count in `clauseApostrophe.test.ts` (32 → 33 — the sweep is
    DISCOVERED, so the new fixture's apostrophe landed in it automatically). ZERO
    new events, prompts, `AttackCoinFlip`/`AttackFlipCount`/`BoardCondition`/
    `DamageCountSource` members, clause-table rows, state fields, error codes,
    registry rows or redact arms. No rng.ts / continuous.ts / attack.ts / flow.ts /
    cardplay.ts diff. NO MATCH_RECORD_VERSION BUMP — a new union member and a new
    enum value are WIDENINGS, D125's distinction and D130's precedent (which added a
    whole op and did not bump either); an older record stays readable and simply
    never carries them. No web/API/DB/`@luminous/schema` diff. */
/** 0.88.0 — P3-M5: the PUT on the defender (D139). "Put {N} damage counters on
    your opponent's Active Pokémon." now SIMULATES — **2 printings / 2 distinct
    clauses**, Mimikyu sv02-097 "Ghost Eye" ({P}{C}, N = 7) and Polteageist
    sv03-098 "Pour Tea" ({P}, N = 5, attack index 1) — on ONE anchored regex with
    ONE `(\d+)` capture and ONE deriver arm. TWO DIFFERENT CARDS from two sets
    rather than one card in two rarities, which is the stronger form of D121's
    second-printing warrant. Neither carries a printed `damage` field, so the
    placement is the entire visible result of the declaration and there is no D125
    tail-order question.

    D132's INVENTORY RULE FOR THE FOURTH TIME: `damageActive` has shipped since 0.x
    behind Trevenant sv03-012's between-turns "Forest Miasma", and what was missing
    was a READER for the same action printed as an ATTACK. No new op, no new
    mechanism, no new park, no `attack.ts`/`flow.ts`/`continuous.ts`/`rng.ts` diff.

    ⚠️ BUT "NO INTERPRETER DIFF" WAS THE ONE RESUME-POINT CLAIM THAT DID NOT HOLD,
    and finding out why is the slice. `damageActive` hardcoded `COUNTERS_PLACED`
    source `"ability"`, which was correct while it had exactly one producer and
    became a LIE the moment an attack produced it: that event's `seat` owns the
    DAMAGED Pokémon (the attacker's opponent), rows render after their seat's name,
    and the `"ability"` log arm prints the literal word **Ability** on an attack.
    That is D136's finding 1, and D138 had already refused it once for the counter
    MOVE and written the obligation down — *any future producer on the opponent's
    board owes the same question*. This slice is that producer, and it inherited
    the refusal rather than re-deriving it.

    SO THE OP GREW A `source: "ability" | "attack"` FIELD, WHICH IS D131's
    WIDEN-DON'T-ADD RULE APPLIED AND **PASSING** — the exact contrast with D138,
    where the same rule was applied and FAILED. The rule licenses a field when
    everything downstream of the varying token is byte-identical; here that is
    literally everything (same target, same flat placement, same raise-only
    contract, same event, same `seat`) and the whole difference is one enum value
    in the row's provenance. A second op would have been two copies of five lines
    told apart by a log label. `COUNTERS_PLACED.source` gained a SEVENTH member and
    `log.ts` a system row in the printed verb ("Put: 70 damage onto …"), for the
    reason D136 gave the mill row rather than an actor field: the ATTACK_DECLARED
    row directly above already names the actor.

    ⚠️ THE COUNTERS ARE HP × 10 AND THAT CONVERSION LIVES AT THE PRODUCER (§12).
    `damageActive.amount` is HP; every printed sentence that reaches it counts
    COUNTERS. So the deriver multiplies once, at the site that reads the number —
    the same placement Trevenant's registry row uses when it writes `amount: 10`
    for its printed 1 counter, and the same one `DEFENDER_POISON_N` uses for
    `poisonDamage`. The interpreter never sees the printed unit and cannot convert
    twice. Pinned by a table over BOTH printings at two different counts (7 → 70,
    5 → 50), by an end-to-end board on each, and by explicit refusals of 7 and 700.

    CENSUS (local D1, 2026-08-02, whole effect string, 978 cards / 6 sets — D138's sweep
    re-read for the PUT half rather than re-run). Attack effects containing
    "damage counter": **56 printings / 31 clauses**. Of those, the ones whose
    ACTION is PUTTING counters: **24 / 15**; the ones aimed at "your opponent's
    Active Pokémon": **4 / 4**, and this anchor takes 2. The other two read the
    amount off the TARGET ("…until its remaining HP is 10." — Alolan Raticate
    swsh10.5-042 bare, Claydol sv03-095 with a self-damage rider) and no capture
    can express that. ZERO printings in the whole PUT family are coin-scaled, and
    exactly one carries "up to" (Annihilape ex sv02-242, on ITSELF).

    A BARE `(\d+)` IS NOT A D120 TEMPLATE — that rule licenses a lookup table only
    when the varying token has a CLOSED vocabulary to reject against; a count has
    none, so the number lands in a FIELD. The cross product is deliberately
    UNFILTERED beyond `>= 1` ("Put 1 damage counters …" is unprinted, ungrammatical
    and unambiguous, and the op expresses it exactly): refusing it would be a claim
    about the INGEST, not about the GAME — D131's call for "the top 1 cards" and
    D135's for the unprinted "Heal all damage …". And the SINGULAR is NOT a branch,
    which is where this differs from D131: the pool prints only the plural on
    attacks, and its one singular is Trevenant's ABILITY, already registered.

    THE PLACEMENT IS FLAT, FROM BOTH SIDES. A placed counter is not attack damage,
    so §8.5's Weakness and the `damageReductionAfterWR` passive both skip it —
    driven under a Psychic attacker against a ×2 PSYCHIC defender (70, not 140) AND
    against a PSYCHIC −30 one (70, not 40), because a build that special-cased only
    Weakness passes the first. No `DAMAGE_DEALT` row is emitted at all.

    IT CAN KNOCK THE DEFENDER OUT and, unlike D138's, it does so INLINE with no
    park anywhere: the epilogue's two-seat sweep reads the post-effect board and
    the whole declaration — placement, Knock Out, prize to the ATTACKER — lands in
    ONE event batch, stopping at `ko:takePrizes` with no `TURN_ENDED` yet.

    Cost: 1 regex, 1 deriver arm, 1 OP FIELD, 1 event-enum member, 1 log arm, 1
    registry row amended, 2 test fixtures (Mimikyu's printed attack + a synthetic
    Psychic-RESISTANT body) + 1 new pool entry (Polteageist sv03-098), 1 test deck,
    1 test file, 1 re-pointed witness in `counterMove.test.ts` and 1 re-pinned
    census count in `clauseApostrophe.test.ts` (33 → 35). ZERO new ops, prompts,
    parks, events, `BoardCondition`/`DamageCountSource` members, clause-table rows,
    state fields, error codes, registry rows or redact arms. NO
    MATCH_RECORD_VERSION BUMP — a new enum value is a WIDENING (D125's distinction,
    D130/D135/D137/D138's precedent), and the op's new field is not persisted at
    all: `damageActive` never parks, so no `EffectContinuation` has ever carried
    one. No web/API/DB/`@luminous/schema` diff.

    ⚠️ FOUND AND WRITTEN DOWN RATHER THAN FIXED — `placeSnipe` CARRIES THE SAME
    HARDCODED LABEL, AND ITS GUARD IS AN ACCIDENT. It pushes `COUNTERS_PLACED`
    source "ability" on its non-`deals` path exactly as this op did before 0.88.0.
    ⚠️ CHECKED RATHER THAN ASSUMED, and the first draft of this note was WRONG: it
    called the label a live defect, and the new suite's own near-miss list
    disproved it in one assertion. That path is reached TODAY only by Abilities
    and triggers — Hawlucha sv01-118 "Flying Entry", Meowscarada ex sv02-015
    "Bouquet Magic", Radiant Blastoise swsh10.5-018 "Pump Shot" — because every
    DERIVED attack snipe sets `deals: true` and routes to DAMAGE_DEALT instead. So
    the label is correct today and the exposure is LATENT, guarded by a flag
    chosen for an unrelated reason that nothing asserts. The printing that would
    trip it is on this slice's own census and is loud today: Ting-Lu ex sv02-127
    (+3 reprints) "Land Scoop" — "Put 2 damage counters on 1 of your opponent's
    Benched Pokémon.", 4 printings, beside a printed 150. The slice that maps it
    inherits the question, and the `"attack"` member added here is the answer
    already built. */
/** 0.89.0 — P3-M5: the PUT on the opponent's BENCH (D140). "Put {N} damage
    counters on 1 of your opponent's Benched Pokémon." now SIMULATES — **4
    printings / 1 clause**, Ting-Lu ex sv02-127/-243/-263/-275 "Land Scoop"
    ({F}{F}{F}, N = 2, attack index 0, beside a printed **150**) — on ONE anchored
    regex with ONE `(\d+)` capture and ONE deriver arm. The BENCH half of the same
    printed action D139 mapped on the Active, and the counter-PUT census is now
    closed on every target a single-Pokémon reader can reach.

    D132's INVENTORY RULE FOR THE FIFTH TIME: `damageChosen { target:
    "opponentBench", count: 1 }` has been authored since M4 slice 8 by Meowscarada
    ex sv02-015's "Bouquet Magic" registry row, at a different amount — so the
    ACTION, the PROMPT (`choosePokemonMulti` over `oppBenchRefs`), the PARK and the
    resume all existed and only a READER was missing. Zero
    `attack.ts`/`flow.ts`/`continuous.ts`/`rng.ts` diff.

    ⚠️ AND IT IS THE PRODUCER THAT RESOLVED `placeSnipe`'s LATENT LABEL — the defect
    D139 found, checked, and deliberately wrote down rather than fixed. `placeSnipe`
    pushed `COUNTERS_PLACED` source `"ability"` as a STRING LITERAL on its
    non-`deals` path. That was true while all three producers were Abilities
    (Hawlucha, Meowscarada ex, Radiant Blastoise) and becomes a LIE the moment an
    attack reaches the same line: the event's `seat` owns the DAMAGED Pokémon (the
    attacker's opponent), rows render after their seat's name, and the `"ability"`
    log arm prints the literal word **Ability**. D136's finding 1, refused at the
    source for the THIRD time (D138's `"moved"`, D139's `"attack"`, and now the op
    that carried the hardcoded string).

    ⚠️ THE FIELD, NOT A DERIVATION — AND THE DERIVATION WAS THE PART WORTH
    CHECKING. `deals` looked like a free discriminator and is not: it picks the
    EVENT (`DAMAGE_DEALT` vs `COUNTERS_PLACED`), and its FALSE arm is now taken by
    three Abilities AND one attack. One flag value, two honest labels — the
    derivation is not total, so there is nothing to read the answer off. `source`
    therefore became a REQUIRED field on `damageChosen`, the same field with the
    same two members `damageActive` grew at D139, and `placeSnipe` takes it as a
    parameter. Required rather than optional-with-a-default is the whole answer to
    "an explicit field a producer must remember": the compiler remembers, and the
    six existing producers were updated because they had to be. Nor could it ride
    `EffectContext` — that argument is STRONGER here than at D139, because unlike
    `damageActive` this op PARKS, so a provenance field there would be a wire-shape
    change on every serialized `EffectContinuation`.

    ⚠️ AND THE GUARD IS ASSERTED RATHER THAN RELIED ON, which is the part D139
    could only write down. The old safety was "every derived attack snipe happens
    to set `deals: true`" — a flag chosen for an unrelated reason that nothing
    tested. `counterBenchPut.test.ts` now sweeps EVERY attack effect in the whole
    fixture pool through the real reader and refuses `"ability"` on every op it
    produces, and pins the three registry rows still saying `"ability"` from the
    other side. Total over the pool rather than a list somebody maintains.

    ⚠️ `spreadDamage` AND `damageSelf` DO NOT SHARE THE EXPOSURE, answered with
    evidence rather than a reading. `spreadDamage` emits `DAMAGE_DEALT`, an event
    with NO provenance enum at all, so there is no label to be false.
    `damageSelf` emits `COUNTERS_PLACED` source `"self"`, whose `seat` IS
    `ctx.seat` — the actor's own — so D136's voice defect is impossible by
    construction, and `"self"` names the DIRECTION rather than the invoker, so it
    does not become false when a producer appears. Only `damageChosen` could grow
    past its hardcoded label, and it has. ⚠️ FOUND AND NOT FIXED (a FOURTH site,
    on a DIFFERENT axis): `attack.ts`'s §9 reactive recoil pushes
    `COUNTERS_PLACED` source `"ability"` for the `damageAttacker` passive, which
    Rocky Helmet **sv01-193** — a **Tool** — also produces, so that row prints
    "Ability:" for a Tool. Pre-existing, live, and pinned as intended by
    `rockyHelmet.test.ts`; it is a Tool-vs-Ability question, not the
    attack-vs-Ability one this slice closes, and it is on the remainder list.
    (The id read "sv01-172" here until D141 checked it — a doc-only slip, fixed
    where it was written rather than repeated.)

    THE COUNTERS ARE HP × 10 AT THE PRODUCER (§12), the placement D139, Trevenant's
    row, Meowscarada's row and `DEFENDER_POISON_N` all use — refused here in BOTH
    directions (2 and 200), and shown to be a CONVERSION rather than a constant by
    the capture itself (1 → 10, 13 → 130), since the pool prints this clause at one
    count only.

    ⚠️ THE PRINTED 150 MAKES THIS THE COUNTER FAMILY'S FIRST D125 TAIL BOARD.
    D138's and D139's six printings carried no `damage` field at all, so a
    placement was their entire visible result; here ONE declaration produces a real
    §8.5 hit on the Defender AND a flat placement on the Bench, in that order, with
    the epilogue behind both — driven end to end rather than assumed:
    `ATTACK_DECLARED` → `DAMAGE_DEALT` (150) → `EFFECT_PENDING`, then the pick →
    `COUNTERS_PLACED` (20) → `KNOCKED_OUT` → `PRIZES_OWED` to the ATTACKER.

    THE PLACEMENT IS FLAT, AND THE CLAIM IS PINNED BY PASSIVES RATHER THAN BY
    WEAKNESS. §8.5 already flattens Weakness on the Bench for BOTH readings, so the
    assertions that actually separate a placement from a `deals: true` hit are the
    ones a `deals` build would consult: Bouffalant's `damageReductionAfterWR` (20
    placed, where a `deals` build reads **0**) and Mimikyu's `preventDamageFromExV`
    (20 placed, where a `deals` build prevents it ENTIRELY) — the latter available
    only because this sentence's attacker HAS a rule box, which D139's did not.

    CENSUS (local D1, 2026-08-02, whole effect string, 978 cards / 6 sets — D139's PUT
    census re-read for this target rather than re-run; it is CLOSED). Of the 24
    printings / 15 clauses whose ACTION is putting counters, the ones aimed at "1 of
    your opponent's Benched Pokémon" are exactly these FOUR PRINTINGS OF ONE CARD on
    ONE clause. Every other printing of that noun phrase in the pool is an ABILITY —
    Meowscarada ex ×4 and Radiant Blastoise swsh10.5-018 — refused on CASE alone,
    and they are the sharpest refusals available because they already produce this
    op through the registry.

    Cost: 1 regex, 1 deriver arm, 1 REQUIRED op field, 1 interpreter parameter, 6
    producers updated (3 registry rows + 3 deriver arms), 1 fixture given its
    printed attack, 1 test deck, 1 test file, 2 re-pointed witnesses
    (`counterMove.test.ts` and `counterPut.test.ts` both listed this sentence as
    stays-LOUD) and 1 re-pinned census (`clauseApostrophe.test.ts`, 35 → 36). ZERO
    new ops, prompts, parks, events, EVENT-ENUM MEMBERS, log arms, clause-table
    rows, state fields, error codes, registry rows or redact arms — the `"attack"`
    member and the "Put:" row D139 built both carried over unchanged, which is the
    argument for having made `source` a field rather than minting an op per
    provenance.

    ⚠️ `MATCH_RECORD_VERSION` **2 → 3**, AND IT IS THE FIRST BUMP SINCE D124 — the
    one structural consequence this slice nearly got wrong by copying D139's note.
    D139 added the SAME field to `damageActive` and correctly bumped NOTHING,
    because `damageActive` never parks and no `EffectContinuation` has ever carried
    one. `damageChosen` DOES park: it is embedded in
    `GameState.phase.cont.pendingOp` whenever a snipe waits on its pick, which is a
    live persisted position. A record written by the previous deploy mid-park comes
    back with the REQUIRED field ABSENT, `undefined` reaches `placeSnipe`, and the
    emitted `COUNTERS_PLACED` falls off every labelled log arm onto the
    active-voice default — rendering under the DAMAGED player's name. A missing
    required field that reads back "fine" is D124's case verbatim. The test is
    never "did a type change" but "can the PREVIOUS deploy's record hold the old
    shape", and for an op that turns entirely on whether it can be sitting in
    `phase.cont` at write time. Two slices, one field, opposite answers.
    No web/API/DB/`@luminous/schema` diff beyond that one constant. */
/** 0.90.0 — P3-M5: the §9 RECOIL LABEL (D141). `attack.ts`'s reactive recoil
    pushed `COUNTERS_PLACED` source `"ability"` as a string literal, so **every
    Rocky Helmet sv01-193 — a Pokémon TOOL — has rendered "Ability: 20 damage to
    …" in every match since 0.57.0**. Found by D140, ranked rather than folded in,
    and LIVE rather than latent: no card has to be added and no clause derived for
    a player to see it. D136's finding 1 on a THIRD axis — not the row's VOICE
    (D136), not attack-vs-Ability (D138/D139/D140), but **Ability-vs-Tool**.

    ⚠️ THE JUDGEMENT IS THE WHOLE SLICE, AND THE SUM DECIDES IT. `passivesOf`
    aggregates `damageAttacker` over the holder's own passive AND every attached
    Tool into ONE seat-free number, and this site emits ONE event carrying it — so
    a single row can be an **Ability's 50 plus a Tool's 20**. That board is the
    CARD'S OWN rather than a contrivance: Stunfisk sv03-112 "Custom Trap" carries
    `requiresTool` and does not fire at all unless a Tool is attached, and Rocky
    Helmet is a Tool. **A provenance member cannot be true of that row** —
    `"tool"`, or `"ability"` kept beside it, would each be half of a number with
    two provenances and one label. So the new member names the **MECHANISM**:
    `source: "counterattack"`, the enum's first mechanism member since
    `"confusion"` (poison/burn/confusion are mechanisms; ability/moved/attack are
    provenances — the enum was always mixed, and this joins the older group).

    ⚠️ SO "SHOULD A REAL ABILITY AND A TOOL RENDER DIFFERENTLY AT ALL" IS ANSWERED
    **NO**, on structural grounds rather than on cost: the engine's own aggregation
    makes them INDISTINGUISHABLE at the read site by construction — `passivesOf`
    hands `attack.ts` a bare `number` with no provenance surviving the addition, so
    the site could not label by kind even if the product wanted it to. And what the
    reader needs from this row is why their attacker suddenly has damage on it,
    which is the mechanism; **which slot on which card granted it is not even
    well-defined** once two cards contribute.

    ⚠️ AND IT GENERALISES, which is why the axis was worth arguing. The local D1
    (2026-08-02, 978 cards / 6 sets) prints "…damage counters on the Attacking Pokémon" on
    **8 printings across 5 sentences and THREE kinds of card**: 3 Ability printings
    (Cacnea sv01-005, Cacturne sv01-006, Stunfisk sv03-112 — all authored), **2
    TOOL printings** (Rocky Helmet sv01-193 authored; **Vengeful Punch sv03-197
    unauthored**, the same mechanism on a KO condition) and **3 ATTACK printings**
    (Lycanroc ex sv02-117/-241 "Scary Fangs", Mabosstiff sv02-143 "Comeuppance" —
    §11 blocks with a DURATION, loud today). A `"tool"` member would have been
    wrong before it shipped; each of those five, when it lands, joins this label
    with **no new member**, which is the test of whether the axis was right.
    ⚠️ The resume point called Custom Trap "an attack-installed trap" — it is a
    printed **Ability** with a Tool gate; the genuinely attack-installed printings
    are Lycanroc ex's and Mabosstiff's, and they are unsimulated.

    NOT "Recoil": `COUNTERS_PLACED` already uses that word for `"self"` — an
    attacker damaging ITSELF with its own printed attack (Skeledirge "Blazing
    Shout") — which is the opposite direction and reads in the attacker's own
    voice. The two are pinned apart rather than left to collide.

    THE ROW STAYS SYSTEM-VOICED, and for a reason of its own on top of the three
    above it: `seat` here is the ATTACKER's (it owns the DAMAGED Pokémon, per the
    event's contract) while the CAUSER is the DEFENDER, so an active-voice row
    would credit the attacker with damaging itself — the MIRROR IMAGE of D136's
    finding 1. And unlike every `"ability"` placement there is **no
    ABILITY_TRIGGERED row above naming a source** (it is a passive, and a Tool has
    no Ability to trigger), so this row is the entire explanation a reader gets —
    which raises the bar on the label being true rather than lowering it.

    ⚠️ THE GUARD IS SWEPT, NOT LISTED (D140's move, and the reason this defect
    lived three versions). The old safety was the ACCIDENT that whoever wrote the
    literal was thinking of Cacnea, and `rockyHelmet.test.ts:95` then pinned the
    WRONG SIDE of it as intended — the D136 "the suite asserts the bug" pattern for
    a third time, plus two more pins in `damageAttacker.test.ts` the resume point
    did not know about. `counterattack.test.ts` DISCOVERS the family from the
    printed catalog text in `FIXTURE_POOL`, asserts the text census equals the
    authored-program census, asserts the family SPANS both `Pokemon` and `Trainer`
    (the fact the hardcoded label denied), and then DRIVES every member it found.

    NO `MATCH_RECORD_VERSION` BUMP, and the question was asked rather than assumed:
    this site is not an `EffectOp` at all — it is an inline event push, nothing
    parks on it, and no `source` value is stored in `GameState`. `MatchRecord`
    persists the RENDERED `SeatLogEntry[]`, so an in-flight match keeps its already
    written "Ability:" rows as text and the record stays fully readable; the enum
    widening is the `ATTACK_FAILED.reason` precedent. Cost: 1 enum member, 1 log
    arm, 1 literal, 1 test deck, 1 test file (16 tests), 3 moved assertions in 2
    suites, 1 added log-arm pin. ZERO new ops, prompts, parks, events, clause-table
    rows, state fields, error codes, registry rows or redact arms; no
    `effects.ts`/`interpreter.ts`/`continuous.ts`/`registry.ts`/`flow.ts` diff and
    no web/API/DB/`@luminous/schema` diff. */
/** 0.91.0 — THE GATED PREVENT CLAUSE: *"Flip a coin. If heads, during your
    opponent's next turn, prevent all damage [FROM AND EFFECTS OF] attacks done to
    this Pokémon."* — **13 printings across TWO READINGS** on two anchored
    regexes, ONE new `EffectOp`, ONE new turn-stamped `InPlayPokemon` field and
    `MATCH_RECORD_VERSION` **3 → 4** (D142). The biggest un-taken count in D134's
    gated census, and the family's first CONTINUOUS-EFFECT MECHANISM rather than a
    reader — every previous slice in this tail bought a sentence; this one buys a
    LIFETIME, and three other printed shapes are now rows on top of it.

    ⚠️ THE RESUME POINT'S COUNT HELD AND ITS DESCRIPTION DID NOT, which is the
    seventh list running to carry something wrong and the first time the miss is
    in the WORDS rather than in the numbers. "13 printings / 2 spellings" is
    exactly right (11 + 2, verified against the local D1, 2026-08-02, 978 cards / 6 sets)
    — and they are not two spellings of one sentence, they are **two different
    READINGS**: eleven say "prevent all damage FROM AND EFFECTS OF attacks done to
    this Pokémon", two say "prevent all damage done to this Pokémon **by
    attacks**", and the second stops damage and NOTHING ELSE. A slice that had
    treated them as one string would have shipped a block that refuses a Poison
    the card does not refuse. **AND THE COUNT WAS A FLOOR RATHER THAN A TOTAL**:
    D134's census was `LIKE '%Flip a coin. If heads,%'`, so it structurally could
    not see the SIX ungated / otherwise-gated printings of the same family (3
    "…by attacks from Basic Pokémon", 1 "…from Ancient Pokémon", 1 KO-gated, 1
    two-consequent coin) — 19 printings in all. Each stays LOUD and each is
    written down with the property that refuses it, so the next slice inherits the
    list. **A census run for one purpose is a floor for every other purpose.**

    ⚠️ THE §11 READING, AND THE CATALOG PRINTS IT. What splits the two halves is
    the parenthetical on Bronzong sv03-145: **"(Damage is not an effect.)"** — a
    rule found in the pool rather than reasoned from intuition, and it settles the
    question the slice turns on. **IN, damage half (both readings):** the §8.5
    main hit and every attack-dealt damage op, at the four sites Mimikyu
    "Safeguard" is honoured at. **IN, effects half (the wider reading only):** §12
    Special Conditions applied to the body, the §11 retreat rider, an Energy
    discarded off it, and — the sharpest one — damage COUNTERS PUT on it, because
    this engine has ruled since `damageActive` that a placed counter is not attack
    damage (it skips Weakness, Resistance and every reduction passive), so it
    falls entirely on the effects side. **OUT:** anything an attack does to a
    DIFFERENT Pokémon (the block is per-body — one Spread Shot is prevented on the
    shielded Active and lands on every benched one in the same declaration);
    anything done to the PLAYER rather than to a Pokémon (a mill, a hand
    disruption); the attacker's own recoil; and **everything that is not an
    ATTACK** — a Trainer, an activated Ability, a triggered one, or a §13 Checkup
    tick, all of which can land inside the window and none of which the printed
    sentence mentions.

    ⚠️ THE STATE IS A TURN STAMP, AND THE REASON IS NOT D124's. D124 chose a stamp
    to avoid a turn-boundary clear it would be easy to forget; here the boundary
    clear that already exists is actively WRONG. D112's retreat block reuses
    §13.4's paralysis clock — cleared in `runCheckup` for `endedSeat` — which
    works because that block sits on the DEFENDER's body. **This one sits on the
    INSTALLER's own**, so the first Checkup after the attack has `endedSeat` = the
    holder's seat and that clock lifts the block a full turn EARLY, before its
    window has opened at all. `InPlayPokemon.attackBlock: { turn, effects } |
    null` stamps `state.turn + 1` — an attack ENDS the turn (§5.3), so the next
    turn is the opponent's by construction — and expires by arithmetic with
    nothing anywhere to clear it. **Measured: reusing the paralysis clock fails 12
    tests; stamping the installing turn instead of the next one fails the same
    12.** The stale stamp is deliberately left sitting on the card afterwards; it
    answers nothing, and not clearing it is the whole point.

    ⚠️ "EFFECTS OF ATTACKS" IS A PROVENANCE THE TARGET CANNOT ANSWER, so it rides
    `EffectContext.invokedBy?: "attack"` — set by `attack.ts` and by nothing else.
    **This REFINES D139 rather than reversing it**: that decision put a provenance
    on the OP (`damageActive`/`damageChosen` still carry `source`) because a LOG
    LABEL is a property of the row an op emits; what rides on the context is a
    RULE that SIX ops must answer identically, and the only site that knows the
    answer is the one that started the program. D139's second objection — that
    `ctx` is serialized into every park — is exactly what makes it right here: an
    attack effect that parks and resolves three actions later is still an attack's
    effect. The two provenances are **pinned to agree** on every producer in the
    pool. Without the check, Crushing Hammer and Boss's Orders stop working inside
    the window; the sharpest witness is Trevenant's between-turns Ability reaching
    the SAME `damageActive` op an attack reaches, at the Checkup that ends the
    window turn, where the stamp cannot help and only the provenance can.

    ⚠️ `effects` IS A FIELD — D131's widen-don't-add rule applied and PASSING (the
    D139 case, not the D138 one): same install site, same holder, same stamp, same
    event, same expiry, same three early clears, and the suite asserts the two
    derived programs are byte-identical once the one field is stripped. OPTIONAL,
    and the polarity is deliberate: the printed words WIDEN the block, so a
    producer that forgets it blocks LESS rather than more. **NOT widened to a
    `damage` flag**, and the condition that would warrant it is written down —
    Bronzong sv03-145's effects-WITHOUT-damage reading, on one printing and a
    different sentence.

    ⚠️ THE EARLY CLEARS ARE §10's, AND ONE OF THEM IS FINALLY REACHABLE. Leaving
    the Active Spot and evolving both end an effect of an attack, so both null the
    field (`clearOnLeavingActive`, `switchInto`, `placeEvolution`). For the retreat
    block the switch clear was the observable one and the evolve clear reachable;
    here the EVOLVE clear is **unreachable by construction** (installing ends the
    turn, the window is the opponent's, and nobody evolves on someone else's turn)
    and is written anyway with a surgery pinning it — while the SWITCH clear is
    reachable in the sharpest possible way: a Boss's Orders played INSIDE the
    window drags the shielded body off the spot and the protection goes with it,
    pinned by a following Spread Shot landing 20 on it.

    ⚠️ THE ONLY WAY TO KNOCK OUT A SHIELDED POKÉMON is a counter PUT through the
    NARROW reading — the wide one refuses the placement and the damage half
    refuses every hit — which is the "KO'd while blocked" ordering driven end to
    end. Cost: 1 op member, 1 op impl, 1 state field + its type, 1 continuous.ts
    reader, 2 events, 2 log arms, 2 regexes, 2 deriver arms, 1 `EffectContext`
    field, 6 guarded op sites, 4 damage sites, 3 early clears, `preventBlock.test.ts`
    (32 tests) on its own `PREVENT_BLOCK_DECK`, 2 new fixtures (Scyther sv03-004,
    Togedemaru sv03-151), 1 moved census (`clauseApostrophe` 36 → 38), 1 added
    `log.test.ts` arm pin, 1 moved `match.test.ts` version pin. Mutation-checked
    seven ways: reusing D112's clock fails **12**, stamping the installing turn
    fails **12**, dropping the main-hit block fails **5**, ignoring `effects`
    fails **5**, dropping `invokedBy` fails **2**, skipping the leaves-the-Active
    clear fails **1**, system-voicing the install row fails **1**. `bun run check`
    GREEN exit 0, **184 files / 2993 tests** (was 183 / 2960). ZERO new prompts,
    parks, clause-table rows, `BoardCondition` members, error codes, registry rows
    or redact arms; no `rng.ts`/`cardplay.ts`/`registry.ts` diff and no web/DB/
    `@luminous/schema` diff beyond the one `MATCH_RECORD_VERSION` constant. */
/** 0.92.0 — THE SELF-LOCK: *"During your next turn, this Pokémon can't attack."*
    — **22 printings across TWO sentences** on two anchored regexes, ONE new bare
    `EffectOp`, ONE new turn-stamped `InPlayPokemon` field, ONE new error code and
    `MATCH_RECORD_VERSION` **4 → 5** (D143). Taken as item 1 of D142's remainder
    list, which is also the slice that shows what that list was for: the mechanism
    D142 bought is reused here with no new concept at all, and the ONLY new
    thinking is one number.

    ⚠️ THE LIST SAID "2 PRINTINGS" AND THE ANSWER IS 22 — an EIGHTH consecutive
    list carrying something wrong, and the first whose miss makes the item TEN
    TIMES BIGGER rather than smaller. The item named Ninetales sv03-029/-199
    "Nine-Tailed Dance" and its compound sentence; censusing that sentence's
    NEIGHBOURHOOD as its own question (D142's own rule — a census run for one
    purpose is a floor for every other) found that the compound's second half is
    printed BARE, as the whole effect, on **twenty** more printings: Miraidon ex
    ×4, Koraidon ex ×4, Dragonite VSTAR ×2, Alomomola, Clawitzer, Steelix,
    Kilowattrel, Tinkatuff, Victini ex, Crabominable, Umbreon, Probopass, Golbat.
    One extra `test` arm over one extra regex, and the count went from 2 to 22.
    **D142's duration table listed "an attack lock (4 + 1)" for this
    neighbourhood, which is the OPPONENT-side lock and the buff — the self-lock is
    not on it at all**, because that table was built from
    `During your opponent's next turn` and this sentence says *your*.

    ⚠️ THE STAMP IS `state.turn + 2`, VERIFIED BY DRIVING IT RATHER THAN BY
    ARGUING IT, and it is the whole slice. Declaring an attack ENDS the turn
    (§5.3), so the turn after the installing one belongs to the OPPONENT and the
    one after that is the installer's own: D142's block prints "during your
    OPPONENT's next turn" and stamps `+ 1`, this prints "during YOUR next turn"
    and stamps `+ 2`. **Every other durated printing in the pool says the
    opponent's**, so `+ 1` is exactly what a session copying the neighbour writes
    — and it fails QUIETLY in play, since a `+ 1` lock is live only on a turn its
    holder could not have acted on anyway and the card's entire printed drawback
    silently disappears. Install on turn 2 → stamp 4 → turn 3 (the opponent's) is
    untouched → turn 4 refuses BOTH of the holder's attacks → turn 6 attacks
    again. **Measured: `+ 1` fails 14 tests.**

    ⚠️ A SECOND STAMPED FIELD, NOT A WIDENING OF THE FIRST, and the reason is that
    the two windows are different NUMBERS on the same body.
    `InPlayPokemon.attackLockedTurn: number | null` sits beside `attackBlock`
    because one `turn` could hold at most one of them — asserted on a real board
    rather than in prose: a case installs the lock for real, surgeries D142's
    block onto the same Pokémon, and drives turn 3 (damage prevented, lock inert)
    and turn 4 (block expired, holder refused). **Folding the lock into
    `attackBlock.turn` fails 8 tests.** Everything ELSE is inherited unchanged:
    the stamp convention, the read-through-`continuous.ts` shape
    (`attackLocked`), the three §10 early clears and D124's no-defensive-undefined
    rule.

    ⚠️ IT NEEDS NO PROVENANCE CHANNEL, WHICH IS THE SHARPEST STRUCTURAL
    DIFFERENCE FROM D142. That block had to invent `EffectContext.invokedBy`
    because "effects of ATTACKS" is a claim about what INVOKED an effect and the
    target cannot answer it. This field is read at `attack.ts`'s §8 gate and at
    the HUD's payability projection, both of which are by construction about
    declaring an ATTACK, so there is exactly one kind of thing it can refuse and
    nothing to disambiguate. A durated effect does not automatically owe a
    provenance — only one that gates an OP does.

    ⚠️ IT GATES A DECLARATION, SO IT IS A REJECTION AND NOT AN EVENT.
    `ATTACK_PREVENTED` (actions.ts), `RETREAT_PREVENTED`'s exact mirror: §12's
    Asleep gate refuses the declaration while §12's Confusion flips at
    resolution, and "can't attack" is the first kind — nothing is spent and the
    turn does NOT end, which is the only reading a player can act on. **That in
    turn makes the HUD projection load-bearing rather than cosmetic**:
    `redactedAttacksOf`'s `banned` (redact.ts) and GameHud's `disabled` are the
    only things between a locked player and a button the server refuses, so the
    slice owes a REDACT ARM and a WEB DIFF that most in this family do not.
    Dropping the projection line fails 1 test; dropping the gate fails 9.

    ⚠️ THE §10 EARLY CLEARS ARE D142's WITH THE REACHABILITY INVERTED, and every
    one is now a LINE OF PLAY. D142's evolve clear was unreachable by construction
    (its window is the opponent's turn); this window is the HOLDER's own, so:
    **evolving frees a locked Pokémon to attack the same turn** (driven end to
    end, no surgery — the one fixture this slice invents, `fix-mola-stage1`,
    exists for it); **retreating out and Switching back in** frees it too, three
    legal actions on one turn; and a **Boss's Orders** un-locks a body the
    opponent was trying to keep off the board. Each clear fails 2 tests when
    skipped, and the three sites are SWEPT rather than listed — one case
    encumbers a Pokémon with every §10-sheddable field and asserts all three
    routes shed the same set, which is the thing that fails if a fourth stamped
    field forgets one.

    ⚠️ IT LOCKS THE POKÉMON, NOT THE ATTACK, and the pool prints the other reading
    EIGHT times ("this Pokémon can't use {AttackName}" — Munkidori ex ×3, Lucario,
    Radiant Charizard, Radiant Blastoise, Skarmory, Greedent ex). All eight stay
    LOUD, and the difference is pinned from the inside: Alomomola's index-0 "Surf"
    is refused by the lock its index-1 "Aqua Slash" installed.

    ⚠️ AND ONE THING THE ITEM CALLED FREE WAS NOT. Sentence one of the compound —
    "Put {N} damage counters on 1 of your opponent's Pokémon." — was priced as a
    one-token widening of D140's anchor, and the op (`damageChosen { target:
    "opponentAny" }`) really does exist. But **no put-counter snipe had ever
    offered the ACTIVE**: every previous producer was Bench-only, so
    `placeSnipe`'s Active branch assumed `deals` and ran the full §8.5 pipeline —
    an accident of the candidate sets, documented in a comment and asserted
    nowhere, which is the D139 → D140 shape for a THIRD time. Routing a PLACEMENT
    through it would double the counters on a Weakness and cut them on a
    Resistance, against this engine's standing ruling that a placed counter is not
    attack damage (D138/D139). The fix REUSES `damageActive` rather than writing a
    second flat-placement path — that function is already this arm to the byte,
    D142's guard included. **Routing the placement through `snipeActive` fails 2
    tests; setting `deals` fails 4.**

    ⚠️ TWO SENTENCES, ONE ANCHOR, TWO OPS IN PRINTED ORDER —
    `DEFENDER_POISON_CANT_RETREAT`'s shape (D125's two-consequent question, and
    the answer is the same). Matching sentence one as a PREFIX would place the
    counters and silently drop the drawback, shipping an attack the catalog does
    not print, which is strictly worse than leaving the card LOUD. **Dropping the
    second op fails 6 tests; reversing the order fails 6.** The order is also the
    only one that reads right in a log, since sentence one can Knock the target
    Out. Cost: 1 op member (no fields — D138's shape, with the two field warrants
    written into its doc block), 1 op impl, 1 state field + its doc, 1
    `continuous.ts` reader, 1 error code, 1 event, 1 log arm, 1 redact line, 1
    GameHud line, 2 regexes, 2 deriver arms, 1 rewritten `placeSnipe` branch, 3
    early clears, `attackLock.test.ts` (32 tests) on its own `ATTACK_LOCK_DECK`, 3
    new fixtures (Alomomola sv01-048, Ninetales sv03-029, fix-mola-stage1), 3
    re-pointed stays-LOUD witnesses (`counterPut`, `counterBenchPut`,
    `counterMove`), 1 moved census (`clauseApostrophe` 38 → 40), 1 added
    `log.test.ts` arm pin, 1 added `preventBlock.test.ts` classification row, 1
    moved `match.test.ts` version pin, 1 moved `setup.test.ts` shape pin.
    **Mutation-checked fourteen ways** (the three largest: `+ 1` fails 14,
    dropping the §8 gate fails 9, sharing `attackBlock.turn` fails 8).
    `bun run check` GREEN exit 0, **185 files / 3026 tests** (was 184 / 2993).
    ZERO new prompts, parks, clause-table rows, `BoardCondition` members, registry
    rows, `COUNTERS_PLACED` members or `EffectContext` fields; no
    `rng.ts`/`cardplay.ts`/`registry.ts`/`flow.ts` diff and no DB/
    `@luminous/schema` diff beyond the one `MATCH_RECORD_VERSION` constant. */
/** 0.93.0 — THE TAILS GATE: *"Flip a coin. If tails, during your next turn, this
    Pokémon can't attack."* — **5 printings on ONE sentence**, bought with **ONE
    OPTIONAL FIELD** (`coinFlipGate.onTails`), one regex, one deriver arm and ONE
    COMPARISON in `runProgram` (D144). Item 1 of D143's remainder list, and the
    cheapest slice this tail has taken: D132's INVENTORY RULE ON BOTH HALVES AT
    ONCE — the consequent (`preventAttack`) is D143's, the gate has spliced a
    branch since 0.x, and the only thing that did not exist is WHICH FACE unshifts
    it. **No `attack.ts` / `types.ts` / `continuous.ts` / `redact.ts` / `turn.ts` /
    `events.ts` / `log.ts` / `registry.ts` / `rng.ts` diff, no new op, no new
    event, no new error code, no new park, no web diff and NO
    `MATCH_RECORD_VERSION` bump.**

    ⚠️ THE ITEM'S ONE STRUCTURAL CLAIM WAS FALSE, AND IT WAS THE CLAIM THE WHOLE
    DESIGN CALL WAS PRICED ON. It said *"`attack.ts` reads `coinFlipGate` directly
    (D130's `programPerHeads` expansion lives there too) so read that code before
    pricing it — the gate is not purely an interpreter concern."* **`attack.ts`
    never reads this op.** Its coin family is `deriveAttackCoinFlip`'s OWN union
    (`bonusOnHeads` / `cancelOnTails` / `perHeads` / `programPerHeads`), read at a
    different site in FRONT of the §8.5 pipeline because those members retract or
    fold DAMAGE; `programPerHeads` is a member of THAT union, not of this op. The
    three mentions of `coinFlipGate` in that file are comments explaining precisely
    that disjointness. So the op has exactly TWO real readers — `runProgram`'s
    splice (interpreter.ts) and `programPlayable`'s descent (cardplay.ts) — which
    is the fact the field-vs-member call turns on. NINTH consecutive list carrying
    something wrong; the pattern is unchanged (**the CATALOG claims held exactly
    and the STRUCTURAL one did not**), and this is the first whose miss made the
    item CHEAPER rather than dearer.

    ⚠️ A FIELD, NOT A SIBLING MEMBER — D131's test applied and PASSING, and the
    census is the evidence rather than taste. Everything downstream of the face is
    byte-identical: the coin is taken either way (so `rngState` advances on both
    faces and an online match cannot desynchronise), the same
    `ATTACK_EFFECT_COIN_FLIP` row is emitted either way, the branch is spliced by
    the same `unshift` so an op inside it can still park, and `programPlayable`'s
    descent is FACE-AGNOSTIC by construction (a coin gate has no `otherwise`, so
    `then` is the only thing the card can ever do whichever face runs it). A
    sibling member would have cost a second op in the vocabulary, a duplicate
    descent, a new row in `preventBlock.test.ts`'s op-classification table, a new
    arm in the interpreter's unreachable-gate `case` list, and a choice to make
    every time a future gated sentence is mapped — to say one boolean.

    ⚠️ AND THE TAILS SHAPE GENERALISES, WHICH IS WHAT SETTLES IT. Censused for the
    FACE as its own question (D142's rule — a census run for one purpose is a floor
    for every other — applied to D143's own census, which counted these five as
    refusals of the *"can't attack"* question and therefore says nothing about the
    face): **28 printings in the pool put a consequent behind a tails, and exactly
    THREE SENTENCES / 8 PRINTINGS are the bare "Flip a coin. If tails, <one
    consequent>." shape this field buys.** The other two are *"discard all Energy
    from this Pokémon"* (2 — Pikachu ex sv02-063, Beartic sv03-054) and *"this
    Pokémon also does 60 damage to itself"* (1 — Oinkologne sv03-183), **and BOTH
    of their consequent ops already exist**, so each is now one regex and one arm.
    The remaining 20 are refused by SHAPE: 11 are D126's `cancelOnTails` (already
    simulated, by the other reader), 4 are a durated gate that makes the OPPONENT
    flip on their own turn, and 5 carry TWO consequents on one flip — an
    `otherwise` this op deliberately does not have, and one the field brings no
    closer.

    ⚠️ THE INDEX IS NOT CONSTANT ACROSS THE FIVE PRINTINGS, which no list said: **1
    on Oinkologne sv01-157 "Leg Stomp" and Oinkologne ex sv01-158/-234 "Heavy
    Stomp", 0 on Paldean Clodsire ex sv02-130/-244 "Needle Bone"**. D139 and D143
    each found a non-zero index a list had not mentioned; this is the first family
    that is not internally consistent, so a suite pinned to either number alone
    would simulate the wrong attack on two of the five. Both fixtures are here for
    it. Every printing carries a FLAT printed `damage` (130 / 210 / 200) and no
    "+"/"×" marker, so `modifierSimulated` is untouched.

    ⚠️ THE LOSING FACE IS THE ONE THAT DOES SOMETHING, and that inverts what a test
    can see. On every other gated sentence in the pool the payout is on heads, so
    "nothing happened" and "the coin missed" differ by a board delta; here the
    printed damage lands on BOTH faces and the ONLY witness is the lock row. A
    build that ignored the field would install the drawback on precisely the
    declarations that did not earn it, silently, with nothing on the board looking
    wrong — so both faces are driven end to end across the turn boundary for every
    claim. **Dropping `onTails` from the deriver fails 14 tests; reverting
    `runProgram` to compare against "heads" fails 11; dropping the gate and
    deriving the bare op fails 13; dropping `programPlayable`'s descent fails 3.**

    ⚠️ `MATCH_RECORD_VERSION` STAYS AT 5, asked rather than omitted. An OPTIONAL
    field is a WIDENING (D125's distinction) — and the question is real, because a
    `coinFlipGate` sitting behind a parking op DOES ride `EffectContinuation` into
    a persisted record: an old continuation simply lacks the key, which reads as
    "heads wins" and reproduces the pre-slice behaviour exactly. That is the
    opposite of the REQUIRED-field-on-`InPlayPokemon` case D124/D142/D143 bumped
    three times for, where the type would be a lie. Nothing else persisted moved.

    ⚠️ AND IT OWES NO NEW PROJECTIONS. D143's rule ("a gate on an ACTION owes both
    payability projections") is satisfied by D143's own lines — this slice adds a
    PRODUCER of `preventAttack`, not a gate — so `redactedAttacksOf` and
    `GameHud.tsx` are untouched. What is owed instead is EVIDENCE that the new
    producer reaches the same line, and the suite sweeps both attacks in both
    directions on BOTH faces. Cost: 1 optional op field, 1 regex, 1 deriver arm, 1
    interpreter comparison, 1 amended `cardplay.ts` comment, `tailsGatedOp.test.ts`
    (24 tests) on its own `TAILS_GATE_DECK`, 2 new fixtures (Oinkologne sv01-157,
    Paldean Clodsire ex sv02-130), 1 re-pointed stays-LOUD witness
    (`attackLock.test.ts`, moved from a NULL to a SHAPE claim), 1 moved census
    (`clauseApostrophe` 40 → 41), 1 corrected catalog count in a D125 comment
    (the `cancelOnTails` family is 11 printings, not 12 — counted while censusing).
    `bun run check` GREEN exit 0, **186 files / 3051 tests** (was 185 / 3026). */
/** 0.93.0 → 0.94.0 — P3-M5 long tail, **the TAILS-GATED SELF-COSTS**:
    *"Flip a coin. If tails, discard all Energy from this Pokémon."* (2 printings)
    and *"Flip a coin. If tails, this Pokémon also does 60 damage to itself."* (1)
    now SIMULATE on **TWO anchored regexes and TWO `deriveAttackEffect` arms**, and
    **THE BARE TAILS-GATED FAMILY IS CLOSED** — all 3 sentences / 8 printings of
    the shape `onTails` buys are read, and the other 20 tails printings in the pool
    are refused by their SHAPE rather than by any anchor's spelling (D145, engine
    0.94.0, MATCH_RECORD_VERSION UNCHANGED at 5).

    **Taken as item 1 of D144's remainder list, and the emptiest slice this tail
    has taken.** D132's INVENTORY RULE with literally nothing left over: the gate
    (`coinFlipGate`) has spliced a branch since 0.x, the `onTails` field is D144's,
    and BOTH consequent ops have been read off their BARE printings since 0.x
    (`SELF_DISCARD_ALL` → `discardEnergy { from: "yourActive", filter: anyEnergy,
    count: "all" }`, `SELF_DAMAGE` → `damageSelf { amount }`). **No new op, no new
    field, no new event, no new error code, no new park, no new prompt, no registry
    row, and no `interpreter.ts` / `attack.ts` / `types.ts` / `continuous.ts` /
    `flow.ts` / `log.ts` / `events.ts` / `redact.ts` / `registry.ts` / `rng.ts`
    diff — no web/API diff and NO `MATCH_RECORD_VERSION` bump.**

    ⚠️ **THE LIST WAS RIGHT — THE FIRST IN TEN THAT WAS.** Nine consecutive
    remainder lists carried something wrong; this one's every claim held. All three
    CATALOG claims verified printing by printing against the local D1 (2026-08-02,
    978 cards / 6 sets): the ids, the attack NAMES ("Dynamic Bolt" / "Frost Purge" /
    "High-Impact Kick"), the costs ({L}{L}{C} / {W}{W}{C} / {C}{C}{C}), the printed
    damage (220 / 170 / 160), the byte-exact effect strings — **and the INDEX,
    which is 1 on all three and was checked SEPARATELY for each** because D144
    found a family whose index is not internally constant. Both STRUCTURAL claims
    held too ("both consequent ops exist", "no mechanism, no op, no event, no
    interpreter diff), which is what a list looks like when the previous slice
    wrote it with the code open. The pattern the standing note names is therefore
    unbroken rather than refuted: what made this list right is that D144 had
    already READ the two ops it was pricing.

    ⚠️ **THE CONSEQUENT CENSUSES WERE RUN ANYWAY, AND ONE OF THEM MOVED THE
    ANCHOR'S JUSTIFICATION** (D142's rule: a census run for one purpose is a FLOOR
    for every other — D144's was run for the FACE). *Discard all Energy from this
    Pokémon*: **10 attack printings, 0 Abilities, 0 Trainers** — 4 BARE (Pawmot
    sv01-076/-209, Raichu sv02-064/-211, already simulated), 2 TAILS-gated (this
    slice), and **FOUR COMPOUND** printings that add a SECOND SENTENCE after the
    discard (Weavile sv06.5-014 + a Paralyze, Kyurem sv06.5-047 + a three-target
    snipe, Eiscue sv02-048/-205 + a durated *takes 100 less damage*). A wider
    anchor would swallow all four and ship half of each card, **and the hazard is
    LIVE rather than theoretical — Eiscue's rider is item 4 of D144's own remainder
    list**, so the day that family lands both halves derive and the compound must
    still not match. (Four MORE printings say *MOVE* all Energy — Blissey sv01-145,
    Tropius sv02-007/-195, Darkrai sv03-136 — a different verb and a different op.)
    *This Pokémon also does N damage to itself*: **48 printings, 47 of them BARE**
    (the pool's most reprinted recoil rider) and exactly ONE gated. No heads-gated
    printing of either consequent exists anywhere.

    ⚠️ **D121's WARRANT, VERIFIED RATHER THAN INHERITED — and it clears more
    easily than the list claimed.** The discard sentence is 2 printings on TWO
    CARDS FROM TWO SETS, which is D139's stronger form of the warrant and clears on
    its own. The recoil sentence is ONE printing, and D134's rule covers it —
    *when a one-printing sentence is an INSTANCE of a shape the engine already
    reads, the warrant is owed by the SHAPE* — **on BOTH axes at once**: the GATE
    has been read on 5 printings since D144 and the CONSEQUENT on 47 since 0.x. So
    it would have cleared even taken alone; the list's "⚠️ TAKE THEM TOGETHER" is
    right for a different reason (one census, one deck, one suite, one seed table).

    ⚠️ **THE PRINTED "ALSO" IS THE TAIL PLACEMENT, AND IT SETTLES TWO THINGS THE
    SENTENCE DOES NOT STATE.** An `EffectOp` runs at `attack.ts`'s tail, strictly
    after the §8.5 pipeline (D125) — which is exactly what *"this Pokémon ALSO does
    60 damage to itself"* says. **(a) The recoil is FLAT.** `damageSelf` writes
    `active.damage + amount` and emits `COUNTERS_PLACED` source `"self"`; it never
    re-enters §8.5, so no Weakness, no Resistance and no reduction touches it —
    driven by measurement rather than argued, with a ×2 Colorless defender doubling
    the main hit to **320 while the recoil stays exactly 60**. **(b) It is still
    paid when the main hit dealt ZERO.** §11 prevention nulls the DAMAGE, not the
    attack, so the program at the tail runs regardless — Pikachu ex declared into
    Mimikyu sv02-097's Safeguard deals 0 and, on a tails, still loses every Energy.
    What does NOT run it is a CANCELLED attack (D125's requirement gate and D126's
    `cancelOnTails` both return in FRONT of the program), and no printing of either
    sentence carries either clause — the anchors being whole-string.

    ⚠️ **THE SELF-KO IS REACHABLE, AND IT IS D134's FIXTURE-HP TRAP TURNED INTO A
    CASE.** Oinkologne sv03-183 is 120 HP against a 60 recoil, so a fresh body
    survives it twice and a body already carrying 60 does not. Driven: the §8.1
    sweep that catches it is `finishAttack`'s TWO-seat one (widened for `damageSelf`
    back in M5 and reached through a GATE here for the first time), the Prize is
    owed to the DEFENDER, the turn does **not** end early (`pending` is
    `[takePrizes, promote, endTurn, checkup, startTurn]`), and the HEADS
    declaration on the identical primed board leaves the body standing.

    ⚠️ **THE WHIFF IS SILENT, ASKED BECAUSE THE FAMILY OWES THE QUESTION.**
    `count: "all"` on an empty attachment set files an empty record and returns
    `done` — no `ENERGY_DISCARDED`, no `ATTACK_EFFECT_SKIPPED`, no park (D134's
    three states; D140's rule that only an UNREAD sentence is loud). It is
    UNREACHABLE from either printing, since declaring the attack pays a
    three-symbol cost, so it is driven as a CONSTRUCTED program rather than
    pretended into a board — D144's precedent for its face-agnostic descent.

    ⚠️ **THE FOUR STRUCTURAL QUESTIONS.** (1) **PARK?** Neither op parks on these
    programs — `discardEnergy count: "all"` "asks nothing" and resolves inline,
    `damageSelf` places without a decision — so neither program can ride
    `EffectContinuation` into a persisted record and **D144's persistence edge is
    not even reachable here**. Nothing persisted moved at all: `MATCH_RECORD_VERSION`
    **stays 5**, asked rather than omitted. (2) **VOICE?** Rendered under real names
    and read in sequence, twice, because the two sentences answer differently:
    *"Pikachu ex used Dynamic Bolt"* → *"dealt 220 damage to …"* → *"flipped tails
    for the effect"* → *"discarded Lightning Energy ×2, fix-energy from Ember's
    Pikachu ex"* (`ENERGY_DISCARDED` reads from its `actor`, the same seat that owns
    the stripped body, and names the owner outright so a mirror match cannot print
    two identical rows); and *"Oinkologne did 60 damage to itself"* → *"Oinkologne
    was Knocked Out"* → the prize row **under the OPPONENT's seat**
    (`COUNTERS_PLACED` source `"self"` renders in the ACTOR's own active voice
    because the attacker CHOSE this attack, unlike the confusion self-hit's system
    row). **No log diff.** (3) **GUARDS ASSERTED?** Three, all swept: each gated
    anchor is mutually exclusive with its own BARE anchor in BOTH directions (the
    capital + `^…$`, neither alone sufficient); the four compound discard printings
    are pinned as refusals in two suites; and `tailsGatedOp.test.ts`'s tails-gate
    sweep now asserts the producer SET (five ids) rather than a two-id predicate,
    so a sixth producer fails loudly. (4) **DOES THE MECHANISM EXIST?** Read, and
    yes — the second slice running where both halves already existed.

    Cost: 2 regexes, 2 deriver arms, 3 new fixtures (Pikachu ex sv02-063, Beartic
    sv03-054, Oinkologne sv03-183), 1 new deck (`TAILS_SELF_COST_DECK`),
    `tailsSelfCost.test.ts` (**28 tests**) on its own pinned seed table, and **3
    re-pointed stays-LOUD witnesses, none deleted** (`attackPark.test.ts` and
    `tailsGatedOp.test.ts` ×2, all NULL → SHAPE claims, plus 2 more compound
    refusals added to the first). `clauseApostrophe`'s DISCOVERED census stays at
    **41** — a result, not an omission: neither mapped sentence carries an
    apostrophe at all (a first for this family), and the one apostrophe-bearing
    sentence the new fixtures print is already in the census via `fix-statuser`.
    **Mutation-checked six ways: dropping `onTails` from the two new arms fails
    18, reverting `runProgram` to compare against "heads" fails 23, dropping the
    gates and deriving the bare ops fails 22, hardcoding the recoil at 60 fails 1,
    dropping the gated anchors' `$` fails 1, dropping `SELF_DISCARD_ALL`'s `$`
    fails 2.** `bun run check` GREEN exit 0, **187 files / 3079 tests** (was 186 /
    3051). */
/** 0.95.0 — THE ATTACKER-CLASS FILTER: *"During your opponent's next turn,
    prevent all damage done to this Pokémon by attacks from Basic Pokémon."* —
    **3 printings on ONE regex and ONE SECOND OPTIONAL FIELD** on D142's own
    `preventDamage` (D146). Item 1 of D145's remainder list. **No new op, no new
    event, no new error code, no new park, no new prompt, no registry row, no
    `redact.ts` / `turn.ts` / `flow.ts` / `cardplay.ts` / `rng.ts` / `registry.ts`
    diff, no web/DB/`@luminous/schema` diff and NO `MATCH_RECORD_VERSION` bump.**

    ⚠️ **THE ITEM WAS RIGHT ABOUT ITS COUNT AND WRONG ABOUT ITS CARDS, AND ITS
    ONE STRUCTURAL CLAIM WAS TRUE IN LETTER AND FALSE IN SUBSTANCE.** Four
    remainder lists (and D142's own `effects.ts` comment, and D142's own suite)
    named the printings **"Fletchling sv01-150" and "Bombirdier sv02-153/-246"**.
    The local D1 (2026-08-02, 978 cards / 6 sets) says **STARAPTOR sv01-150** ("Tailspin
    Away", {C}{C}, 60, attack **INDEX 0**) and **NOIVERN ex sv02-153/-246**
    ("Covert Flight", {C}{C}, 70, **INDEX 0**). Fletchling sv02-163 and Bombirdier
    sv01-138/-219/sv02-147 are all real cards in this pool and print none of this
    text — an error that survived four lists because a card NAME is the one field
    nobody re-queries. Iron Moth sv06.5-009 and its **index 1** were correct, and
    the reason is written on the list itself: that index is the one D142 found *by
    checking*. **The rule that catches this is D144's, applied to names as well as
    indices: verify per printing, by QUERY, never by recognition.**

    ⚠️ **`Ancient` HAS NO READER BECAUSE IT HAS NO DATUM — AND THAT INVERTS THE
    ITEM.** The list called Ancient "the only real work". It is not work at all:
    the Ancient/Future banner is printed on the card FACE from Paradox Rift (sv04)
    onward and appears in **no column of the persisted catalog and no field of
    tcgdex's own card model** — verified UPSTREAM against Roaring Moon ex
    sv04-124, the canonical Ancient print, whose payload carries `suffix: "ex"`
    for its rule box and nothing whatsoever for the banner. So no honest engine
    predicate exists to be written, and the fix is an INGEST/schema change.
    **A species-name table would be WRONG rather than incomplete**: the banner is
    a per-PRINTING fact (D135's rule at its sharpest), and Great Tusk ex
    sv01-123/-230/-246 is one of the Ancient SPECIES carrying no banner at all —
    so any name-keyed answer is wrong on three real cards **with no failure
    anywhere**, which is the outcome this family refuses. The sentence therefore
    stays LOUD, the union has exactly ONE member, and `attackerMatchesClass`
    (continuous.ts) is an EXHAUSTIVE switch so a second member cannot be added
    without the compiler demanding the predicate that reads it. **`Future` obliges
    nothing here** and is not in the union: it is a real class in the pool
    (4 printings across 2 cards, and Slither Wing sv06.5-026's "Iron Smasher" asks
    a question about it) but it is unreadable for the identical reason and its one
    printing is a DIFFERENT mechanism — a board-condition damage bonus, not a
    block. Reading one would not have read the other.

    ⚠️ **A SECOND FIELD ON THE SAME OP, ON THE OTHER AXIS — D131's test applied
    twice to one op and PASSING BOTH TIMES.** `effects` widens WHAT a block
    refuses; `fromClass` narrows WHOSE attacks it refuses at all. Strip
    `fromClass` and the derived program is byte-identical to the body of D142's
    NARROW gated arm, which is the widen-don't-add test rather than the habit.
    OPTIONAL and ABSENT-means-unfiltered (D135's rule), so the persisted record's
    old shape keeps its old meaning exactly.

    ⚠️ **THE PREDICATE IS EVALUATED AT THE READ SITES, AND IT IS FOLDED INTO THE
    SINGLE READ.** The attacker is unknowable at install time — the block is
    written on the installer's own body during the installer's own turn — which is
    the same split `PassiveEffects.preventDamageFromExV` has been under since
    D107: the aura reports itself, the SITES gate it on the attacker's class. What
    is new is that the resolution lives INSIDE `attackBlockOf` rather than beside
    it, with `attacker` a REQUIRED (nullable) parameter: a read site cannot honour
    the turn stamp and forget the filter, because there is no way to ask the first
    question without answering the second. That is also why ignoring the filter
    fails only **2** tests — all four damage sites plus the effects gate route
    through one line, so per-site duplicates would test one line five times, and
    the pool prints no evolved spread/snipe attacker to drive them apart with.

    ⚠️ **IT IS THE NARROW READING, AND THAT IS WHY D142 SHIPPED TWO.** The printed
    sentence never says "from and effects of", so a MATCHED Basic attacker has its
    damage nulled and still lands everything else it prints — Pincurchin's Energy
    discard, Mimikyu's 7 placed counters, fix-attacker's Asleep. Folding the two
    readings at D142 would have refused a discard this card does not refuse, and
    this slice is where that decision pays.

    ⚠️ **THE FOUR STRUCTURAL QUESTIONS.** (1) **PARK?** No — `preventDamage` is
    still deterministic and asks nothing, and this producer is UNGATED so its
    program is a single non-parking op. **`MATCH_RECORD_VERSION` STAYS 5**, and
    the reason is a THIRD distinct one (match.ts carries it): the new field lands
    INSIDE `AttackBlock`, a record that only exists when a block was installed, it
    is OPTIONAL, and an old record's `{ turn, effects }` reads back as "no filter"
    — which is what it meant. Contrast D142/D143, which bumped for a REQUIRED
    field on `InPlayPokemon` itself. (2) **VOICE?** The install row gains
    `fromClass` and a THIRD phrasing, for `effects`' reason made sharper: a
    filtered block lets every evolved attacker through at full damage, so a row
    saying "protected from damage from attacks" would be an outright lie about the
    very next turn. **And a block that FAILS to match emits NOTHING** — the
    attack's own `DAMAGE_DEALT` (`prevented` absent, the real number in `dealt`)
    is the whole story, and announcing a rule that declined would be announcing a
    non-event; loudness is owed to UNREAD TEXT, not to a read rule saying no
    (D140). (3) **GUARDS ASSERTED?** Yes, three ways: the vocabulary is a compiler
    fact (the exhaustive switch), the PRODUCER SET is swept out of the pool rather
    than listed (D145's move — a third producer fails loudly), and the effects
    gate — unreachable from any printing, since all three filtered printings are
    the narrow spelling — honours the filter and is pinned by a CONSTRUCTED
    program (D144's precedent). (4) **DOES THE MECHANISM EXIST?** Read first, and
    yes: D142's duration, stamp, three early clears and four damage sites are all
    reused unchanged. What did NOT exist is the DATUM for the second class token,
    which is the finding above.

    Cost: 1 regex, 1 deriver arm, 1 op field, 1 `AttackBlock` field, 1 event
    field, 1 log arm, 1 predicate, 1 changed signature (`attackBlockOf`), 2 new
    fixtures (Staraptor sv01-150, Noivern ex sv02-153), 1 new deck
    (`CLASS_BLOCK_DECK`), `classBlock.test.ts` (**27 tests**, SEED-FREE — the
    family's first ungated producer, pinned by an unchanged `rngState`), 1
    re-pointed stays-LOUD witness (`preventBlock.test.ts`, NULL → SHAPE, none
    deleted) and 1 added live unmapped witness (Noivern ex's index-1 "Dominating
    Echo", driven end to end to `ATTACK_EFFECT_SKIPPED`). `clauseApostrophe`'s
    DISCOVERED census moved **41 → 42**. **Mutation-checked eight ways: dropping
    `fromClass` from the deriver fails 8, inverting the predicate fails 7,
    ignoring the field in `attackBlockOf` fails 2, dropping the anchor's `^` fails
    1, ignoring the filter at the effects gate fails 1, keeping the filter on a
    merge disagreement fails 1, dropping the class from the install row fails 1,
    dropping it from the log arm fails 1.** `bun run check` GREEN exit 0,
    **188 files / 3106 tests** (was 187 / 3079).

    0.95.0 → 0.96.0 — **P3-M5 (long tail): the DURATED DAMAGE REDUCTION.**

      "During your opponent's next turn, this Pokémon takes {20|30|50} less
       damage from attacks (after applying Weakness and Resistance)."     (12)
      "Discard all Energy from this Pokémon. During your opponent's next turn,
       this Pokémon takes 100 less damage from attacks (after applying Weakness
       and Resistance)."                                                  ( 2)

    The largest un-taken count this tail had left (14 printings / 4 amounts) and
    the THIRD turn-stamped field on `InPlayPokemon` — which makes it the slice
    D143 deferred the GENERALISATION question to, "so the decision is made with
    three readings in hand rather than one guessed at".

    ⚠️ **THE GENERALISATION WAS RE-DERIVED AND DECLINED, AND THE PREMISE IT WAS
    PARKED ON DID NOT SURVIVE CONTACT.** D143 named the trigger precisely: this
    would be the first reading to genuinely SHARE a read path with `attackBlock`
    (the same four damage sites, one line apart), "which is the thing a union pays
    for". It does share the SITES. It does not share the QUESTION: each site asks
    two independent things at two different steps of §8.5 — the reduction is
    SUBTRACTED inside the pipeline, the block SUPERSEDES its result — and D146's
    filter makes them observably independent, since a `fromClass` block can
    DECLINE an attacker while the reduction on the same body still bites (driven).
    A discriminated union merges STORAGE, not lookups; it would have replaced
    `pokemon.attackBlock` (a field tsc checks) with a search tsc cannot check the
    totality of, at every read site, forever — to save ~3 lines at the three §10
    clear sites and a bump this slice pays either way. **A third PARALLEL field,
    and the NEW trigger is named rather than left to judgement** (decisions.md
    D147): the first caller that must ENUMERATE the installed effects instead of
    asking for one by name. The pool prints no such printing today — censused, and
    the one card that mentions removal (Toedscruel ex sv03-022) says explicitly
    that existing effects are NOT removed.

    ⚠️ **AND THE DECIDING FACT IS THAT THIS WAS NEVER A NEW READING AT ALL.** The
    pool prints this exact sentence MINUS its four-word duration prefix as an
    always-on Ability on FOUR printings — Bouffalant sv03-174 "Bouffer" (20),
    Stonjourner sv01-121 "Exoskeleton" (20), Copperajah ex sv02-150/-245 "Bronze
    Body" (30) — and all four have been simulated since 0.x as
    `PassiveEffects.damageReductionAfterWR`, read at exactly these four sites with
    exactly this clamp. So the new field is a SOURCE summed into a number the
    engine already computes (`installedReductionOf`, continuous.ts), the read-site
    diff is one `+` each, and the clamp, the `ignoreWR` bypass and
    `DAMAGE_DEALT.reduction` all come for free. **The mechanism existed, the
    datum existed, and even TWO OF THE FOURTEEN PRINTINGS were already in the
    fixture pool** as unmapped riders on cards fielded for other slices —
    Forretress sv01-139's index-1 "Rolling Shell" (D129's multiply fixture) and
    Varoom sv06.5-043's "Rigidify" (D131's promoted-clause fixture, which the
    producer SWEEP found and no remainder list ever mentioned).

    ⚠️ **KEPT OUT OF `passivesOf` DELIBERATELY**, for two structural reasons: that
    function is the CATALOG scan (printed passive + attached Tools), the
    aura/installation distinction `attackBlockOf`'s doc block draws; and it
    SUPPRESSES a holder's own printed passive under a §9 Ability-lock aura, which
    an attack INSTALLATION must be immune to. Summing at the sites makes that
    immunity structural rather than positional.

    ⚠️ **THE PRINTED PARENTHETICAL IS THE SPEC AND IT IS DRIVEN BOTH WAYS.** Every
    `DAMAGE_DEALT` row the suite produces is re-derived from its own reported
    fields in the printed order AND in the reversed one, and the two are asserted
    to differ wherever a Weakness is present. The headline board is two printed
    cards with no surgery: Forretress's Metal **90** into Eiscue's ×2 METAL body
    carrying **100** gives `90 × 2 − 100 = 80` on 110 HP, where subtracting first
    clamps the whole hit to `max(0, 90 − 100) × 2 = 0` — the wrong order turns a
    100-point reduction into TOTAL IMMUNITY. Resistance and the reduction are both
    ADDITIVE and COMMUTE, so the parenthetical can only ever bite on the
    multiplicative step, which is why the fixtures were chosen for their Weakness
    lines and why the commuting case is pinned as arithmetic rather than posed as
    a board.

    ⚠️ **A CLAMPED ZERO IS NOT A PREVENTION.** `Math.max(0, …)` was already there
    and is inherited, and the row keeps `prevented` ABSENT when a big reduction
    zeroes a hit: the same number, two different facts about how it got there
    (the block supersedes the pipeline; this one ran it). Pinned.

    ⚠️ **THE COMPOUND COST ONE REGEX.** Eiscue sv02-048/-205 "Frigid Block"
    ({W}{W}{W}, INDEX 1, printed 100) prints the rider as a SECOND sentence behind
    `Discard all Energy from this Pokémon.` — derived since 0.x — so 2 of the 14
    came free, and they are the ONLY printing of the 100 amount. D145's discard
    census flagged this exact string as one of the four compounds
    `SELF_DISCARD_ALL`'s `$` keeps out and said "the day that family lands both
    halves derive and this must still not match"; both directions are asserted,
    and the two stays-LOUD witnesses that named it were RE-POINTED (NULL → SHAPE)
    rather than deleted.

    ⚠️ **THE FOUR STRUCTURAL QUESTIONS.** (1) **PARK?** No — `reduceDamage` is
    deterministic, consumes no rng and asks nothing, so no `EffectContinuation`
    can carry it. **`MATCH_RECORD_VERSION` 5 → 6**, for D124/D142/D143's reason
    verbatim and a FOURTH time on the same trigger: a REQUIRED key on
    `InPlayPokemon` makes every body in an older record the wrong TYPE, and the
    fact that it would read back benignly is precisely the soft landing D124
    refused. (2) **VOICE?** ACTIVE — `seat` owns the protected Pokémon and that
    Pokémon is the actor's own — and the AMOUNT is in the wording, because four
    amounts share one sentence and the row sits directly above a `DAMAGE_DEALT`
    row whose `reduction` field carries the same figure. **A reduction that FIRES
    emits nothing**: `DAMAGE_DEALT.reduction` has named that fact since Bouffalant
    "Bouffer", and loudness is owed to unread text (D140/D146). (3) **GUARDS
    ASSERTED?** Four ways: the producer SET is SWEPT out of the pool rather than
    listed — **and that is what found the fifth producer nobody had listed**; the
    §8.5 ordering is asserted against a re-derived oracle on every row rather than
    against typed numbers; both BENCH read sites are guarded although a live
    reduction is unreachable there by construction (D146's precedent); and
    `preventBlock.test.ts`'s swept §11 classification table demanded a verdict on
    the new op before the suite would go green. (4) **MECHANISM?** Read first, and
    it existed twice over — see above.

    Cost: **2 regexes, 2 deriver arms, 1 new op, 1 new `InPlayPokemon` field, 1
    new `continuous.ts` reader, 4 read sites (`+` each), 3 §10 clear sites, 1 new
    event, 1 log arm** — and no `redact.ts` / `flow.ts` / `cardplay.ts` / `rng.ts`
    / `registry.ts` / `triggers.ts` diff, no new error code, no new park, no new
    prompt, no registry row and no web/DB/`@luminous/schema` diff beyond the one
    constant. 4 new fixtures (Swablu sv03-169, Pineco sv01-001, Eiscue sv02-048,
    plus Forretress sv01-139 promoted from deriver-only to driven), 1 new deck
    (`DAMAGE_REDUCTION_DECK`), `damageReduction.test.ts` (**36 tests**, SEED-FREE
    — no printing of this family carries a coin), **2 re-pointed stays-LOUD
    witnesses and none deleted** (`attackPark.test.ts`, `tailsSelfCost.test.ts`,
    both NULL → SHAPE). `clauseApostrophe`'s DISCOVERED census moved **42 → 46**,
    its largest single jump, and the first time it has swept an anchor whose token
    is a CAPTURE rather than a fixed string. **Mutation-checked fourteen ways:
    stamping `state.turn` fails 14 and `+ 2` fails 14, dropping the compound arm
    fails 12, dropping the main-hit `+` fails 8, dropping the bare anchor's `^`
    fails 6, flipping the §8.5 order at the main hit fails 3, flipping it at
    `snipeActive` fails 1, and 1 each for dropping the `+` at `snipeActive`,
    `spreadDamage` and `placeSnipe`, merging by `Math.min`, dropping the bare
    anchor's `$`, skipping the leaving-Active clear, skipping the evolve clear and
    dropping the amount from the log row.** `bun run check` GREEN exit 0,
    **189 files / 3142 tests** (was 188 / 3106).

    0.96.0 → 0.97.0 — **P3-M5 (long tail): the OPPONENT-SIDE ATTACK LOCK.**

      "Discard an Energy from this Pokémon. During your opponent's next turn,
       the Defending Pokémon can't attack."                              (3)
      "If the Defending Pokémon is a Basic Pokémon, it can't attack during
       your opponent's next turn."                                       (1)

    Item 1 of D147's remainder list, and **THE SLICE THAT ANSWERS A QUESTION D143
    WROTE DOWN AND REFUSED TO GUESS**: whether `preventAttack` should carry a
    `target`. It should — and the reason it took two readings is that the
    objection D143 raised is TRUE IN ITS FACTS AND WRONG IN ITS CONCLUSION.

    ⚠️ **`target` IS ONE AXIS, NOT TWO.** D143 declined the field because "a
    `target` would have to carry a DIFFERENT STAMP as well as a different holder
    (the defender-side window is `state.turn + 1`, this one is `+ 2`), so the
    field is two axes rather than one". Both numbers are real. They are **not
    independent**: there is exactly ONE rule — *the window is the LOCKED Pokémon's
    controller's NEXT turn* — and the two numbers are that rule evaluated on the
    two seats, because DECLARING AN ATTACK ENDS THE TURN (§5.3). The printed
    wordings differ ("during YOUR next turn" / "during your OPPONENT's next
    turn") for exactly the same reason, which is the tell. So the stamp is a pure
    FUNCTION of the holder, one field determines both, and D131's widen-don't-add
    test passes on the second reading rather than being guessed at from the first.
    **Stamping `+ 2` on both arms fails 13; `+ 1` on both fails 23; ignoring the
    field at the install site fails 17.**

    ⚠️ **AND THE STATE COSTS NOTHING — the first durated slice in four to add NO
    stamped field.** Both printings reuse `InPlayPokemon.attackLockedTurn`
    unchanged, because "on which turn may this body not attack" is ONE question
    about ONE body and whose attack wrote the answer is a fact about the OP. So
    `attackLocked` (continuous.ts), the §8 gate (attack.ts), `redactedAttacksOf`
    (redact.ts), `GameHud.tsx` and all THREE §10 clear sites take **zero diff** —
    every one of them DRIVEN anyway, from the seat that had never driven them.
    **`MATCH_RECORD_VERSION` STAYS AT 6**, and the question is live rather than
    academic: `preventAttack` never parks, but on Eiscue ex's compound it sits
    BEHIND one, so the op rides `EffectContinuation.rest` into a persisted record.
    An OPTIONAL field absent on all 22 self-lock printings is a WIDENING (D125,
    D144's worked case) — an old `{ op: "preventAttack" }` is a valid inhabitant
    of the new type and reads back as the self arm, which is what it meant.
    **This is therefore NOT D147's fifth-stamped-field trigger; it adds none.**

    ⚠️ **THE CLASS PREDICATE COSTS NO FIELD EITHER, AND IT IS D146's MIRROR.**
    Houndoom ex's "If the Defending Pokémon is a Basic Pokémon" is the SAME
    `isBasicPokemon` D146 wired — read off the DEFENDER instead of the attacker,
    and that one word changes WHERE it resolves. D146 had to defer its predicate
    to the four damage READ SITES because the attacker had not declared yet; the
    defender is on the board in front of the attack resolving, so this is a
    `BoardCondition` evaluated at INSTALL time through the `conditionGate` op that
    has spliced branches since M4. Cost: ONE union member
    (`opponentActiveIsBasic`, the exact complement of D115's
    `opponentActiveIsEvolution`) plus its `conditionHolds` and `conditionNote`
    arms. **Inverting the predicate fails 22; dropping the gated arm fails 24.**

    ⚠️ **TWO REGEXES, AND THE `then` IS THE OTHER ANCHOR'S OWN OP.** One anchored
    whole-sentence pattern per printed string (D136/D137): the two share four
    words and differ in the first clause, the gate, the subject's noun phrase and
    where the duration sits, so an alternation would be two patterns wearing one
    name. What they share is the ACTION, shared as an OP — the family's checkable
    claim, asserted byte for byte. There is deliberately **NO BARE ANCHOR**: the
    "…the Defending Pokémon can't attack." sentence is printed NOWHERE in the pool
    standalone (censused), exactly as D143's any-zone counter PUT. "Basic" is
    SPELLED rather than captured, D146's call on the same word.

    ⚠️ **IT IS THE FIRST OP IN THE FAMILY A §11 BLOCK REFUSES, AND THE SWEPT TABLE
    IS WHAT SAID SO.** `preventBlock.test.ts`'s classification moved
    `preventAttack` from `untouched` to `blocked` — its old verdict was true of
    the ops the DERIVER COULD EMIT rather than of the op — so the interpreter owes
    `attackEffectRefused`, `preventRetreat`'s check verbatim. **Dropping it fails
    2.** ⚠️ **AND THE SWEEP HAD A HOLE:** its walker descended `coinFlipGate` only,
    an accident of the candidate sets for six slices (the D139 → D140 → D143 →
    D146 shape a fifth time), and Houndoom ex is the first printed attack whose
    whole program is a `conditionGate`. Fixed, hoisted and pinned directly, since
    the pool sweep cannot see its own blindness. ⚠️ **AND A SECOND, HONEST
    FINDING: the table asserts that every op HAS a verdict, never that the verdict
    is TRUE** — flipping `blocked` back to `untouched` fails NOTHING. The
    behaviour is pinned by the driven case; the table is a forcing function.
    Written down rather than fixed, and carried forward as a remainder item.

    ⚠️ **THE §10 CLEARS ARE D143's REACHABILITY WITH THE AGENCY INVERTED — a
    FOURTH story on the same four fields.** Every route off the Active Spot is
    still a line of play on the locked player's own turn, but that player is the
    VICTIM, so retreat, Switch and evolve are COUNTERPLAY against an imposed
    effect rather than an escape from a chosen drawback; the INSTALLER can reach
    none of them, their turn having ended when they declared. **Skipping the
    leaving-Active clear fails 4, the evolve clear 3.**

    ⚠️ **ONE LOG ROW, BOTH DIRECTIONS, NO NEW PHRASING — and that is a result
    rather than a saving.** D143 phrased `ATTACK_LOCKED` from the HOLDER's side
    "so it reads as RETREAT_BLOCKED's sibling", and RETREAT_BLOCKED is a
    VICTIM-side row: the wording chosen for an active-voiced row was already the
    passive-side one, and the direction it was written to flip is the direction
    this slice added. `seat` owns the locked Pokémon (D136's finding 1) and
    "<name> can't attack next turn" is true under either seat, because "next turn"
    is the LOCKED player's in both readings. Contrast D146, which owed a THIRD
    phrasing the moment its field landed. Driven and read in sequence.

    ⚠️ **THE LIST HELD ON EVERY CATALOG CLAIM AND ITS SHARPEST WARNING PAID.** All
    4 printings ✅, both indices ✅ (both installs at **INDEX 0**, Hound's Fang at
    1 as flagged), every name, cost, damage and byte-exact effect string re-queried
    PER PRINTING. **No misnamed id anywhere** — the first slice in three where the
    name sweep found nothing, and it was still run. The `FIXTURE_POOL` sweep D147
    demanded came back EMPTY (neither sentence was already fielded), which is the
    other half of that rule working. **The census (D142's rule, SEVENTH time) DID
    pay**: the opponent-side PER-ATTACK lock — Medicham `sv01-111` and Oranguru
    `sv02-094`, "Choose 1 of your opponent's Active Pokémon's attacks. During your
    opponent's next turn, that Pokémon can't use that attack." — is on NO earlier
    list or census, and it makes that refused group 10 printings / 7 sentences
    rather than 8 / 6.

    Cost: **2 regexes, 2 deriver arms, 1 OPTIONAL op field, 1 `BoardCondition`
    member, 2 switch arms, 1 interpreter signature** — no new op, no new event, no
    new error code, no new park, no new prompt, no new state field, no registry
    row, no `attack.ts` / `continuous.ts` / `redact.ts` / `turn.ts` / `log.ts` /
    `events.ts` / `flow.ts` / `cardplay.ts` / `rng.ts` / `types.ts` behavioural
    diff and no web/DB/`@luminous/schema` diff. 2 new fixtures (Eiscue ex
    `sv03-042`, Houndoom ex `sv03-134`), 1 new deck (`DEFENDER_LOCK_DECK`),
    `defenderLock.test.ts` (**40 tests, SEED-FREE**), 3 re-pointed stays-LOUD
    witnesses (`attackLock.test.ts`, `attackPark.test.ts`, `typeNameClause.test.ts`
    — all moved NULL → SHAPE, none deleted), `clauseApostrophe`'s DISCOVERED census
    **46 → 48**. **Mutation-checked seventeen ways:** the gated arm 24, the §8 gate
    22, inverting the predicate 22, `+ 1` on both arms 23, ignoring `target` at the
    install 17, dropping `target` from the gated arm 16, `+ 2` on both arms 13, the
    whole compound arm 12, dropping `target` from the compound arm 9, reversing the
    compound's op order 6, the leaving-Active clear 4, the evolve clear 3, the
    redact projection 3, `attackEffectRefused` 2, and 1 each for the compound
    anchor's `^`, the gated anchor's `$`, the idempotence early-return and the
    sweep's `conditionGate` descent. `bun run check` GREEN exit 0, **190 files /
    3183 tests** (was 189 / 3142).

    0.97.0 → 0.98.0 — **P3-M5 (long tail): the ATTACKER-SIDE DAMAGE DEBUFF.**

      "During your opponent's next turn, the Defending Pokémon's attacks do
       {20|30} less damage (before applying Weakness and Resistance)."       (3)
      "During your opponent's next turn, attacks used by the Defending Pokémon
       do 100 less damage (before applying Weakness and Resistance)."        (2)

    Item 1 of D148's remainder list, and **D147's MIRROR ON BOTH AXES AT ONCE**: a
    durated stamp installed on the DEFENDER's body and read at the ATTACKER's
    PRE-Weakness/Resistance step. Same `{ turn, amount }` record, same `+ 1`
    window, same three §10 clears, same `Math.max` merge — opposite body, opposite
    step, and the two printed sentences are told apart from D147's twenty by ONE
    WORD inside the parenthetical.

    ⚠️ **THE LIST QUOTED ONE SENTENCE AND THE POOL PRINTS TWO.** Three of the five
    printings say "the Defending Pokémon'S ATTACKS DO" (Pikachu `sv02-062`, Pidove
    `swsh10.5-061`, Florges `sv01-093`); two say "ATTACKS USED BY the Defending
    Pokémon DO" (Houndoom `sv06.5-008`/`-066`). The list's template matched only
    the second, i.e. 2 of the 5 printings. So TWO anchors (D136/D137), sharing
    their OP and asserted to share it byte for byte. **Dropping the possessive
    anchor fails 26; dropping the "used by" anchor fails 13.**

    ⚠️ **`attackerPreWRBonus` TURNED OUT TO BE A `passivesOf` FOLD, AND THAT IS WHY
    THE DEBUFF IS A SECOND TERM RATHER THAN A SIGNED NUMBER.** The list warned the
    one pre-W/R read site is a BONUS and asked for a decision. Read first, per
    D131, and the argument is written down whichever way it goes (D148's lesson):
    folding a negative in would have been one line and zero call-site diff, and it
    is refused on THREE observable grounds. (1) `DAMAGE_DEALT.bonus` is a REPORTED
    field, emitted only when positive and documented as what continuous effects
    ADDED — a signed number would drop the debuff from the row and from the log a
    player reads. (2) That function folds `passivesOf`, the CATALOG scan, which is
    SUPPRESSED under a §9 Ability-lock aura — and an attack INSTALLATION must be
    immune to that, which is D147's own structural reason for keeping
    `installedReductionOf` out of `passivesOf`, read from the other side of the
    table. (3) Only the debuff can drive the pre-W/R subtotal NEGATIVE, so it owns
    a clamp the bonus has never needed. So: `installedAttackDebuffOf`
    (continuous.ts), `installedReductionOf`'s exact mirror, subtracted BESIDE the
    bonus at the read sites and reported in a `debuff` field of its own. It also
    leaves the always-on member somewhere to land.

    ⚠️ **FOUR READ SITES, NOT TWO — AND THE CENSUS IS THE ARGUMENT.** The list said
    "the one existing pre-W/R read site", and there are two (`attack.ts`'s main hit
    and `snipeActive`). But the debuff reaches all FOUR of D147's sites, including
    the two BENCH ones the pre-W/R BONUS deliberately does not, because every
    pre-W/R printing in the pool that ADDS damage scopes itself "to your opponent's
    Active Pokémon" (Vitality Band, Defiance Band, Choice Belt, Practice Studio,
    Binding Mochi, Kingambit, Galvantula, Okidogi, the three birds) and **NEITHER
    sentence that SUBTRACTS carries an Active clause at all**. A printed asymmetry,
    censused rather than intuited. Dropping the term fails **9** at the main hit and
    **1** each at `snipeActive`, `spreadDamage` and `placeSnipe`.

    ⚠️ **THE STEP ORDER IS PINNED BY DRIVING IT BOTH WAYS, D147's METHOD INVERTED.**
    Every `DAMAGE_DEALT` row is re-derived from its own reported fields in both
    placements through the engine's own `applyDamageModifier`, and the two are
    asserted to differ wherever a Weakness is present. The headline board is two
    printed cards: Houndoom's "Snarl" installs 100 on Alomomola `sv01-048`, which
    answers with "Aqua Slash" (120, Water) into Houndoom's ×2 WATER — `max(0, 120 −
    100) × 2 = 40` printed against `120 × 2 − 100 = 140` reversed, i.e. a body that
    lives on one reading and dies on the other. **Moving the subtraction after W/R
    fails 6 at the main hit and 1 at `snipeActive`.** The CLAMP is written at the
    pre-W/R step rather than left to the final floor; the two spellings agree on
    every board this pool can print (every catalog Weakness is ×2, every Resistance
    −30) and diverge only under the ADDITIVE weakness `DamageModifier` still
    admits, which is pinned as arithmetic — D147's move on its commuting case.

    ⚠️ **AND FLORGES IS THE FINDING NOBODY WENT LOOKING FOR.** `sv01-093` prints the
    30 AND carries "Blooming Garden" ("Your Pokémon in play have no Weakness") —
    and Florges's own side is the side its debuffed victim attacks INTO. So the ONE
    printing of the 30 is the one printing whose parenthetical CANNOT bite: the
    multiplicative step is gone and the two placements agree. Driven as a PAIR on
    one board, ± a benched Florges. ⚠️ **Its fixture had also been carrying NO
    ATTACKS AT ALL since D104** — the card has exactly one — so D147's
    sweep-the-pool rule paid in its OTHER form: not a sentence present and unread
    (D147's case) but a fixture verbatim on everything it carried and silently
    PARTIAL. Entei `sv03-030`'s fixture is missing its printed Ability the same way.

    ⚠️ **THE LOG ROW IS THE THIRD VOICE ANSWER, AND COPYING THE SIBLING WOULD HAVE
    LIED.** `seat` owns the debuffed Pokémon (D136's finding 1) and this op has NO
    self arm, so `ATTACK_DEBUFF_APPLIED` is the family's first row that is
    victim-side BY CONSTRUCTION. `DAMAGE_REDUCTION_APPLIED` ends "…during your
    opponent's next turn" — honest there, because it renders under the INSTALLER's
    name. Under the victim's name those same printed words name the wrong turn. So
    the phrasing is `ATTACK_LOCKED`'s instead ("next turn", which under this
    family's seat rule always means the named player's own), which is D148's
    seat-independence result applied where the sibling was NOT seat-independent.
    **Copying D147's wording fails 1; rendering the row under the actor fails 1.**

    ⚠️ **BLOCKED BY §11, AND THE VERDICT IS DRIVEN RATHER THAN ONLY DECLARED.** The
    op writes onto the DEFENDING Pokémon, so a wide `{ effects: true }` block
    refuses it — `preventRetreat`'s and D148's `preventAttack` check verbatim, and
    reachable off printed cards. `preventBlock.test.ts`'s table forced the verdict
    (`blocked`); because D148 measured that the table checks a verdict EXISTS and
    never that it is TRUE — **re-measured here and still true: flipping it fails
    NOTHING** — the behaviour is pinned by a live-block board in the slice suite,
    both directions (a live block refuses, an expired one does not).

    ⚠️ **THE FOURTH STAMPED FIELD, AND D147's REASONING HOLDS UNCHANGED.** Its
    three named triggers are (a) a printing that REMOVES the effects of attacks —
    re-censused, the pool still has none; (b) a projection that must SHOW the
    durated riders as a LIST — this field crosses no wire, changes no
    `redactedAttacksOf` / `GameHud` projection, and gates no action; (c) a FIFTH
    stamped field. This is the fourth, which §D147 said explicitly is NOT it. The
    deciding fact survives too: the number feeds an adjustment the read sites
    already compute, so there is no read path to unify.

    ⚠️ **SCOPED OUT, AND SAID SO: Entei `sv03-030` "Pressure"** (the always-on
    member, 20) — a printed ABILITY and a CROSS-BOARD aura with an Active clause on
    BOTH ends, which is `opposingRetreatBlocked`'s shape and not a stamp's. It
    wants a `PassiveEffects` sibling plus a scan of its own, summed beside
    `installedAttackDebuffOf` at the same four sites; nothing here has to move for
    it. It stays LOUD and is asserted to stay LOUD.

    Cost: **2 regexes, 1 deriver arm, 1 new op, 1 new REQUIRED `InPlayPokemon`
    field + its interface, 1 new reader, 1 new event, 1 new `DAMAGE_DEALT` field,
    1 log arm + 1 breadcrumb, 4 one-term read sites, 3 §10 clear lines** — no new
    prompt, park, error code, registry row, `BoardCondition` member, redact arm or
    `flow.ts` / `cardplay.ts` / `rng.ts` / `triggers.ts` / `redact.ts` diff, and no
    web/DB/`@luminous/schema` diff beyond `MATCH_RECORD_VERSION`. **`MRV` 6 → 7**
    (D124's trigger, the FIFTH time: a required key on `InPlayPokemon`). 3 new
    fixtures (Houndoom `sv06.5-008`, Pikachu `sv02-062`, Pidove `swsh10.5-061`) and
    1 COMPLETED (Florges `sv01-093` gained its only printed attack), 1 new deck
    (`ATTACK_DEBUFF_DECK`), `attackDebuff.test.ts` (**41 tests, SEED-FREE**), 1
    re-pointed stays-LOUD witness (`damageReduction.test.ts`, NULL → SHAPE, none
    deleted), `clauseApostrophe`'s DISCOVERED census **48 → 51**.
    ⚠️ **AND IT LANDED AT D151, ONE SLICE LATER, EXACTLY AS COSTED.** Nothing here
    moved for it: the four read sites each gained one `+` term and this block's
    forecast is the only thing that had to be true.

    **Mutation-checked twenty-two ways:** dropping the possessive anchor fails 26,
    writing onto `ctx.seat` 22, stamping `state.turn` 20, `+ 2` 20, dropping the
    "used by" anchor 13, dropping the main-hit term 9, dropping the row's `debuff`
    field 9, moving the main-hit subtraction after W/R 6, and 1 each for moving it
    after W/R at `snipeActive`, dropping the term at `spreadDamage` /
    `placeSnipe`, dropping `attackEffectRefused`, merging by `Math.min`, ignoring
    the turn stamp at the reader, the three §10 clears, either anchor's `^`, either
    anchor's parenthetical (2 each), anchor one's `$`, the `amount >= 1` guard, the
    log breadcrumb, the log wording and the log seat. ONE mutation SURVIVED and is
    reported rather than buried: flipping the §11 classification verdict, which is
    D148's own measured weakness and is resume item 4. `bun run check` GREEN exit
    0, **191 files / 3224 tests** (was 190 / 3183). */
/** 0.99.0 — P3-M5 long tail (**D151**): the **ALWAYS-ON ATTACKER-SIDE DAMAGE
    DEBUFF**, closing the family D149 opened one slice earlier.

      "As long as this Pokémon is in the Active Spot, attacks used by your
       opponent's Active Pokémon do 20 less damage (before applying Weakness and
       Resistance)."                                   (Entei sv03-030 "Pressure")

    **1 printing, RE-QUERIED rather than inherited** (the resume item carried an
    explicit honesty marker saying D150 had re-verified none of it). The local D1
    (2026-08-02, 978 cards / 6 sets) prints "less damage (before applying Weakness and
    Resistance)" on SIX rows — five attack riders (D149) and this one Ability —
    and the sharper query ("in the Active Spot" AND "less damage") returns Entei
    alone. Id → NAME, Ability name, the byte-exact effect string and the fixture's
    fields all re-checked: **every inherited CATALOG claim held**, which is the
    first list in this run where that is true of all of them.

    ⚠️ **IT REALLY WAS `opposingRetreatBlocked`'s SHAPE, AND READING THE CODE FIRST
    IS WHY THAT IS A FINDING RATHER THAN A CITATION.** `passivesOf` folds the
    HOLDER's own catalog row; this number belongs to the holder's OPPONENT, so no
    field on that fold could have answered it. So: one `PassiveEffects` flag
    (`opponentActiveAttackDebuff`), one cross-board scan (`opposingAttackDebuff` —
    the SEVENTH member of the aura-scan family), and one `+` term at each of the
    four sites `installedAttackDebuffOf` was already read at. Same printed
    sentence, same §8.5 step, two sources, one number and one reported field —
    which is how `passivesOf().damageReductionAfterWR` and `installedReductionOf`
    have split D147's sentence since D147.

    ⚠️ **THE §9 PAIR IS THE SHARPEST THING IN THE SLICE, AND IT IS DRIVEN ON ONE
    BOARD.** The aura is an ABILITY (gated through `disabledAbilityUids`); D149's
    `attackDamageDebuff` is an attack INSTALLATION on a record that no Ability-lock
    can reach. Ting-Lu ex "Cursed Land" locks a DAMAGED non-ex, so a single
    `damage` field switches the aura off and leaves the stamp on the SAME attacker
    paying — 150 − 40 → 150 − 20 → (no stamp) 150. That asymmetry is precisely the
    reason D149 kept its stamp out of `passivesOf`, now observable rather than
    argued. **Dropping the §9 gate fails 2.**

    ⚠️ **`ignoreWR` ANSWERS DIFFERENTLY AT THE TWO SNIPE ARMS, AND THAT IS THE ONE
    NEW READING.** Feint Attack's "isn't affected … by any effects on that
    Pokémon" scopes the TARGET. At `snipeActive` the aura's SOURCE and the target
    are the same body by construction (both are the opponent's Active), so the
    clause reaches the aura and it is nulled; at `placeSnipe`'s bench arm the pick
    is a different body entirely and the aura stands. The STAMPED half is nulled at
    neither — it lives on the attacker's record. The two halves of one number
    answering differently is the aura/installation distinction becoming observable
    a second time. Both directions are DRIVEN off one printed attack: **not nulling
    at `snipeActive` fails 1, nulling at `placeSnipe` fails 1.**

    ⚠️ **THE FIXTURE WAS PARTIAL, AND THE SWEEP FOUND IT IS NOT ALONE.** Entei has
    sat in `FIXTURE_POOL` since 0.35.0 carrying NO `abilities` array on a card with
    exactly one printed Ability — Florges's D149 omission on the other array. A
    field-by-field diff of the WHOLE pool against the D1 (978 rows) finds fixtures
    missing a printed Ability or attack, several deliberately and documented
    (Pecharunt ex), several not (Mimikyu carries `preventDamageFromExV` in the
    registry and no "Safeguard" row on the card). **No fixture NAME is wrong**, so
    D149's name sweep holds. This is a repo-wide hazard, not a one-off. ⚠️ **D151's
    "40" was never re-queried: D156 re-ran the diff against today's five-set file
    and the number is 34, plus 12 fixtures whose catalog row the file has lost.**
    Both populations are now PINNED rather than counted in prose, each entry with
    its REASON — see `catalogManifest.test.ts`, and note that the 34 is measured
    against a catalog missing `swsh10.5`, so it is a floor for the six-set one.

    ⚠️ **NO PARK, NO PERSISTED KEY, `MRV` 7 UNCHANGED — SAID EXPLICITLY.** The flag
    lives on the CATALOG (`PassiveEffects`, a registry type), the scan is pure, and
    nothing was written to `InPlayPokemon`, to any op payload or to any persisted
    shape. D124's trigger is "a required key appeared on `InPlayPokemon`" and no
    key moved at all — D148's no-bump reason, hit a second time. The VOICE question
    likewise resolves to "no row moved": the number lands in the existing
    `DAMAGE_DEALT.debuff`, whose crumb ("· weakened −N") states a subtraction and
    names neither a turn nor an installer, so unlike D147's wording it is honest
    under the VICTIM's seat — which is the seat this row always renders under
    (D136's finding 1). Rendered and read, not assumed.

    Cost: **1 `PassiveEffects` flag, 1 registry row, 1 new reader, 4 one-term read
    sites** — no new op, field, event, error code, prompt, park, regex, deriver
    arm, redact arm or projection, and no web/DB/`@luminous/schema` diff at all.
    1 fixture COMPLETED (Entei gained its printed Ability), 1 new deck
    (`PRESSURE_DECK`), `pressureAura.test.ts` (**19 tests, one SEED**), 1
    re-pointed stays-LOUD witness (`attackDebuff.test.ts` — "absent" → "landed as
    an AURA", none deleted).
    **Mutation-checked eleven ways, all eleven caught:** the registry amount 20 →
    30 fails 11, moving the main-hit subtraction after W/R fails 7, dropping the
    main-hit term 5, dropping the `placeSnipe` term 2, dropping the §9 gate 2,
    dropping the fixture's Ability 2, and 1 each for dropping the SOURCE Active
    clause, the TARGET Active clause, the `spreadDamage` term, and each direction
    of the `ignoreWR` reading. `bun run check` GREEN exit 0, **192 files / 3247
    tests** (was 191 / 3228). */
/** 0.100.0 — P3-M5 long tail (**D152**): the **ATTACK-INSTALLED REACTIVE
    RECOIL**, the §9 family's durated member and the LAST slice of a sixteen-slice
    one-day run (D137–D152).

      "During your opponent's next turn, if this Pokémon is damaged by an attack
       (even if it is Knocked Out), put 10 damage counters on the Attacking
       Pokémon."                        (Lycanroc ex sv02-117/-241 "Scary Fangs")

    ⚠️ **0.100.0 AND NOT 1.0.0.** The series is a slice counter, not a release
    train; nothing about this slice makes the engine a 1.0, so the minor keeps
    counting.

    **2 printings, RE-QUERIED rather than inherited.** Every claim on the resume
    item held to the byte: `sv02-117`/`sv02-241` really are **Lycanroc ex**, the
    attack really is **"Scary Fangs"** at **INDEX 1** on BOTH printings, {F}{C}{C},
    printed 140, and the effect string matches the local D1 (2026-08-02, 978 cards / 6 sets)
    character for character. The §9 census was re-run as its OWN question rather
    than inherited from §D141: "…damage counters on the Attacking Pokémon" returns
    **8 rows** — 4 always-on printings already simulated (Cacnea sv01-005 / Cacturne
    sv01-006 3 counters, Stunfisk sv03-112 5 `requiresTool`, Rocky Helmet sv01-193
    2), these 2, plus Vengeful Punch sv03-197 and Mabosstiff sv02-143, both
    deliberately OUT of scope and still LOUD.

    ⚠️ **IT IS `installedReductionOf`'s SIBLING, NOT ITS MIRROR, AND THE READ SITE
    IS THE ONLY THING THAT DIFFERS.** Same holder (the actor's own Active), same
    `state.turn + 1` window, same `{ turn, amount }` record, same `Math.max` merge,
    same three §10 clears, same no-`attackEffectRefused` verdict. What differs is
    which number the stamp feeds: D147's is subtracted at §8.5 step 5, this one is
    ADDED at the §9 reactive recoil — the site that has summed
    `passivesOf().damageAttacker` since 0.x. One `+` term, one line.

    ⚠️ **THE SUM IS D141's JUDGEMENT RE-RUN WITH A THIRD PROVENANCE, AND IT SURVIVES
    UNCHANGED.** D141 refused a provenance label on `COUNTERS_PLACED` because
    `passivesOf` folds a holder's Ability and every attached Tool into one number.
    An attack-installed half now joins that fold: a Lycanroc ex carrying 100 and
    wearing Rocky Helmet retaliates for **120 in ONE row** labelled
    `"counterattack"`. **No new `COUNTERS_PLACED` member**, which is the test of
    whether the mechanism axis was right — and the §9 Ability-lock makes the two
    halves observably different on one board (a locked holder keeps the installed
    100 and the Tool's 20 and loses only a printed Ability's share).

    ⚠️ **THE `dealt > 0` BOUNDARY IS D149's AND IT IS DRIVEN FROM BOTH SIDES.** The
    recoil fires on damage DEALT, not on damage attempted, so a hit clamped to 0 by
    a debuff, nulled by a §11 block or reduced to 0 draws nothing — and the armed
    stamp is still there for the next hit that gets through.

    ⚠️ **THE FIFTH STAMPED FIELD, SO §D147's COUNT TRIGGER FIRES — AND THE UNION IS
    DECLINED AGAIN, ON A GROUND THAT RETIRES COUNTING.** Three of the five fields
    are now SOURCES feeding an aggregate whose other source is the CATALOG
    (`damageReduction`→`passivesOf().damageReductionAfterWR`,
    `attackDamageDebuff`→beside `opposingAttackDebuff`,
    `installedRecoil`→`passivesOf().damageAttacker`). Their read sites do not look
    the effect up; they ADD one term. A union over `InPlayPokemon` would group by
    WHERE THE DATUM IS STORED — the one axis no read site asks about — and would
    replace five compiler-checked field accesses with five list searches it cannot
    check. What earns the union is a member the read site must DISPATCH on, which
    is the per-attack lock's `{ turn, attackIndex }` and not a fifth number. Full
    argument in decisions.md D152.

    ⚠️ **PARK? NO. MRV 7 → 8, THE SIXTH TIME ON D124's TRIGGER.**
    `InPlayPokemon.installedRecoil` is a REQUIRED key on a persisted shape.
    `installRecoil` never parks. **VOICE?** Two answers: `RECOIL_ARMED` is
    ACTOR-voiced (its op has no defender arm, so `DAMAGE_REDUCTION_APPLIED`'s
    reason applies and the PRINTED "during your opponent's next turn" is honest
    under this seat, where D149's row could not carry it); the recoil row itself
    stays SYSTEM-voiced, D141's answer re-checked and still true — `seat` is the
    attacker's, the causer is the defender, and an installation does not change
    who caused what.

    Cost: **1 op, 1 required `InPlayPokemon` field, 1 record type, 1 regex, 1
    deriver arm, 1 reader, 1 event, 1 log row, 3 §10 clears, 1 one-term read
    site** — no new `COUNTERS_PLACED` member, no park, no error code, no prompt,
    no redact arm, no projection, no registry row and no web/DB/`@luminous/schema`
    diff. 1 fixture ADDED (Lycanroc ex, verbatim vs the D1), 1 new deck
    (`INSTALLED_RECOIL_DECK`), `installedRecoil.test.ts`, 1 re-pointed stays-LOUD
    witness in `counterattack.test.ts` (none deleted). */
/** 0.101.0 — REVIEW FIX, NOT A SLICE (**D153**): `DECK_TOP_DISCARDED` gains an
    `actor: Seat`, and log.ts picks its VOICE by `actor === seat`. From
    `/code-review` over `origin/backend...HEAD` (D136–D152), finding 1 of 3 — and it
    is **D136's own fix mirroring D136's own defect**.

    D136 found the mill row in the ACTIVE voice under an owner-keyed seat ("**P2**
    discarded 2 cards from the top of their deck" credits the milling to the player
    who lost the cards) and made the one wording PASSIVE. Passive is right for the
    mill and wrong for the two SELF paths, which the review caught on Tri Howl and
    which DRIVING the log showed is worse than reported: `interpreter.ts`'s mill
    site with `whose: "self"` (Gyarados swsh10.5-022 "Wild Splash") printed
    "**Ember** had 5 cards discarded from the top of their deck" for a cost that
    player paid off their own deck. **TWO push sites, THREE paths, splitting 2–1 on
    agency and NOT along the op boundary** — so neither "one wording" nor "one
    wording per op" can be right, and the sweep found no third site.

    ⚠️ **THE ARGUMENT D136 GOT WRONG, NAMED SO THE NEXT SLICE INHERITS IT RATHER
    THAN THE VERDICT.** D136 priced ENERGY_DISCARDED's `actor` field and declined it
    because "this row never names the actor anyway". That is the wrong test. **A
    row's VOICE asserts an actor whether or not any segment names one** — every row
    renders after its seat's name, so active means "this seat did it" and passive
    means "it was done to them". Both are agency claims; there is no third wording
    that abstains, because the row is grammatically a predicate on a named player.
    Once the assertion is unavoidable, its truth value varies per path, and a fact
    that varies per path is a DATUM, not a constant. D113's rule is untouched: the
    event is still REUSED rather than joined by a sibling, and its game fact is
    unchanged — what grew is the provenance the message needs in order not to lie.

    ⚠️ **AND THE COMPARISON IS NOT AVAILABLE TO THE RENDERER WITHOUT THE FIELD**,
    which is why "compare `event.seat` against the acting seat" was never an option:
    `formatEvent` sees ONE event plus `{ names, state, elapsed }` and has no notion
    of whose turn it is. The self-mill is also what makes `actor === seat` the honest
    key rather than a per-op flag — same op as the mill, opposite side of the line.

    ⚠️ **PARK? N/A — no op changed. MRV UNCHANGED AT 8, and the persistence question
    asked properly rather than waved at.** `MatchRecord` persists the RENDERED
    `SeatLogEntry[]` and `GameState`, never events (D141); `GameEvent` appears in NO
    file outside `packages/engine/src`, so it crosses no wire and no park
    continuation carries one. A wording change therefore does NOT retroactively alter
    stored rows: an in-flight match keeps its old passive backlog and mints the new
    text from here on, which is the same cosmetic seam D141 accepted. **VOICE?** The
    general rule this slice leaves behind, which subsumes all six earlier answers:
    **a row's voice is fixed by the relation between `event.seat` and the CAUSER —
    causer === seat → ACTIVE (D141's `preventDamage`, D147), causer is always the
    other seat → VICTIM-side/PASSIVE (D149), causer is the RULES → SYSTEM (D141's
    recoil) — and when one event type has paths where that relation DIFFERS, the
    relation is a field the event must carry, never a constant the wording encodes.**
    That fourth case had no representative until now, and this defect is what it
    looks like when it is mistaken for one of the first three. **GUARD ASSERTED?**
    It was not — only the mill's row was pinned, which is exactly how D136's fix
    broke D136's other producer with nothing red. Now `log.test.ts` pins the
    renderer over **all four `Seat × Seat` pairs** AND drives **all three real
    producer paths** end to end, reading the finished rows back with their seat
    labels. Swapping the renderer's arms fails 2 tests; flipping either producer's
    `actor` fails 1 each.

    Cost: **1 event field, 1 ternary in log.ts, 2 producer lines** — no op, no state
    field, no regex, no deriver arm, no error code, no prompt, no redact arm, no
    projection, no registry row, no fixture and no web/API/DB/`@luminous/schema`
    diff. `log.test.ts` +1 case, its DECK_TOP_DISCARDED block rewritten. */
/** 0.102.0 — P3-M5 long tail (**D154**): the **PER-ATTACK LOCK** — *"During your
    next turn, this Pokémon can't use {AttackName}."* **6 catalogued printings
    across 4 names on ONE anchor with ONE capture, plus 1 fielded printing the
    catalog cannot see** — Munkidori ex `sv06.5-037`/`-083`/`-091` "Dirty Headbutt"
    (idx 0), Lucario `sv01-114` "Accelerating Stab" (idx 1), Skarmory `sv03-142`
    "Slashing Steel" (idx 1), Greedent ex `sv03-179` "Slip 'n' Roll" (idx 1), and
    Radiant Blastoise `swsh10.5-018` "Torrential Cannon" (idx 0), which is in
    `FIXTURE_POOL` and in NO catalog row.

    ⚠️ **THE REMAINDER LIST'S EIGHTH PRINTING DOES NOT EXIST, AND NEITHER DOES ITS
    SET.** Three lists and §D143's own table said "8 printings / 6 sentences",
    naming Radiant Charizard `swsh10.5-011` and Radiant Blastoise `swsh10.5-018`.
    The local D1 holds **five sets — sv01, sv02, sv03, sv06.5, sve — and NO
    swsh10.5 row at all**, so every census in this repo "run against the local D1,
    978 cards / 6 sets" has been structurally blind to that set, and any count including a
    swsh10.5 id was never verified by the query it cites (D149's "6 printings"
    named Pidove `swsh10.5-061` the same way). `swsh10.5-011` is in no fixture
    either; `swsh10.5-018` is, so this anchor reads it and the suite drives it as a
    FIELDED printing of fixture provenance.

    ⚠️ **THE FIRST DURATED RECORD THAT IS NOT A BARE NUMBER**, and the first that
    carries an ADDRESS: `InPlayPokemon.lockedAttack: { turn, attackIndex } | null`,
    the SIXTH stamped field, read through `lockedAttackIndex` (continuous.ts).
    `MATCH_RECORD_VERSION` **8 → 9** — a REQUIRED key on `InPlayPokemon`, D124's
    trigger for the SEVENTH time.

    ⚠️ **A SEPARATE OP AND A SEPARATE FIELD, AND BOTH REFUSALS ARE D131's
    WIDEN-DON'T-ADD TEST RUN IN THE DIRECTION THAT SAYS NO.** Folding it into
    `preventAttack { attack? }` fails the test: stripping the key does not yield
    the previous arm, it yields a different rule writing a different field
    (contrast D148's `target`, which passes exactly). Folding the STATE into
    `attackLockedTurn` as `{ turn, attackIndex? }` fails on REACHABILITY: a
    Skarmory that self-bars "Slashing Steel" on turn 3 (stamp 5) and is then locked
    WHOLE by an Eiscue ex on turn 4 (stamp 5, D148's defender arm) carries both
    facts on turn 5, and one record holds only the later write.

    ⚠️ **§D152's SHAPE TRIGGER FIRES ON THE PAYLOAD AND IS ANSWERED "NO", WITH A
    REPLACEMENT — the second trigger in three slices to fire and be declined, and
    the reason is the same both times: a trigger phrased on the RECORD is a proxy
    for a fact about the READ SITE.** D152 retired counting and named *a member the
    read site must DISPATCH on rather than SUM*, citing this record. The index
    genuinely is not summed — the three read sites COMPARE it. But **no site
    dispatches either**: every reader in this family knows which rider it wants
    before it looks, so a union would replace a compiler-checked field access with
    a `find` whose other members the caller must then discard. What earns it is a
    caller that receives a rider whose KIND it does not know — an ENUMERATION — and
    §D147's trigger (a) is still its only forecast producer (the pool prints none).

    ⚠️ **AND TRIGGER (b)'s PREMISE FIRES FOR THE FIRST TIME, WHICH IS THE OTHER
    HALF OF THE ANSWER.** D149 and D152 both recorded "crosses no wire, changes no
    projection, gates no ACTION". This field gates the `attack` ACTION and changes
    `redactedAttacksOf`. It still does not earn the union, because what crosses is
    the per-attack `playable` BOOLEAN the wire already carries (D143's `banned`,
    D112's `can`), not a rider. **So the projection question and the union question
    are independent, and (b) conflated them.**

    Cost: **1 op, 1 required `InPlayPokemon` field, 1 record type, 1 regex, 1
    deriver arm, 1 reader, 1 EVENT FIELD (not a new event — D113/D153), 1 log
    branch, 3 §10 clears, 1 §8 gate and BOTH payability projections** — no park, no
    new error code, no prompt, no registry row, no DB/`@luminous/schema` diff. */
/** 0.102.0 → 0.103.0 — **P3-M5 (long tail): the PER-ATTACK DAMAGE BUFF**:

      "During your next turn, this Pokémon's {AttackName} attack does {N} more
       damage (before applying Weakness and Resistance)."                    (1)

    ONE printing — Seismitoad `sv03-052` "Echoed Voice" ({W}{W}, printed 120,
    attack **INDEX 0**, its card's ONLY attack). Taken as item 1a of D154's
    remainder list, and it is D154's ADDRESSING read at D149's STEP: one anchor,
    one op, one field, one reader, one term.

    ⚠️ **THE CENSUS NAMES ITS POPULATIONS AND CORRECTS THE ONE NUMBER EVERY EARLIER
    CENSUS IN THIS REPO QUOTED.** D154 found that the local D1 holds FIVE sets and
    that `FIXTURE_POOL` fields cards from a sixth. Re-running it found the other
    half: the catalog holds **890 rows, not 978** (`select set_id, count(*)` sums
    to 890 and `select count(*)` agrees, against a file unwritten since
    2026-07-27). Against those 890 rows across all three text columns, `more
    damage (before applying` returns ONE row, and the `FIXTURE_POOL` sweep — run
    SEPARATELY, which is the half D154's finding makes mandatory — returns none.

    ⚠️ **D156 CORRECTS THE INFERENCE, NOT THE MEASUREMENT — AND IT IS THIS SLICE'S
    OWN DEFECT ONE LEVEL DOWN.** "978 matches no table in the file" is true of the
    file today and does not license "none of those comments ever measured it".
    D112 (2026-08-01) recorded the breakdown in `decisions.md`:
    **978 cards / 6 sets** — `sv01`/`sv02`/`sv03`/`sv06.5`/`sve` PLUS
    `swsh10.5` (88 rows). And
    890 + 88 = 978, while on `legal_standard = 0` this file's 763 + 88 = the 851
    the docs quote, and D147's census table (2026-08-02) lists Pidove
    `swsh10.5-061` as a query RESULT. **The catalog SHRANK between 2026-08-02 and
    2026-08-03**; no `cards`, `sets` or `series` row for the set survives and the
    .sqlite's mtime never moved, so the ingest lived in an unwritten WAL. The
    defect was a number with no SCOPE, not a number nobody measured — so the ~20
    comments now read `978 cards / 6 sets`, both states live in
    `catalogManifest.ts`, and `catalogManifest.test.ts` fails on a row count
    quoted without its set count. **Consequently the corrections below are
    THEMSELVES wrong**: §D149's "5 printings" and §D151's "six rows" counted
    Pidove, which is a real catalogued card this file has since lost — kept here,
    struck through rather than deleted, because the reasoning is the artefact.

    ~~The mirror family returns FIVE, which makes §D149's "5 printings" **4** in
    the catalog and §D151's "six rows" **5**: both counted Pidove `swsh10.5-061`,
    of fixture provenance.~~

    ⚠️ **THE FIRST TIME IN THIS FAMILY THAT D131's WIDEN-DON'T-ADD TEST PASSES ON
    THE SHAPE AND THE ANSWER IS STILL TWO FIELDS.** `InPlayPokemon.boostedAttack:
    { turn, attackIndex, amount } | null` is D154's record with one key added —
    strip `amount` and you have `LockedAttack` byte for byte — and D154's own
    ground (two facts, one record, one write) is unavailable, because the bar and
    the buff are printed on different cards and CANNOT be live together off any
    printing. So the refusal is made on the **READ**, which is the axis this family
    had not been separated on: `lockedAttackIndex`'s consumer REFUSES the index it
    returns and `boostedAttackDamage`'s PAYS it, so one field would hand
    `attack.ts`'s §8 gate the index of the attack the card just bought. **Driven on
    one board** (both records installed, the barred index refused and the boosted
    one resolving at +100), which is what a design answer owes here.
    `MATCH_RECORD_VERSION` **9 → 10** — a REQUIRED key on `InPlayPokemon`, D124's
    trigger for the EIGHTH time and the first on two consecutive slices.

    ⚠️ **A SECOND TERM, NOT A FOLD INTO `attackerPreWRBonus` — ON EXACTLY ONE OF
    D149's THREE GROUNDS, AND THE POOL CANNOT DRIVE IT.** Two of that slice's three
    reasons are silent for a number that only ever ADDS (a positive is reported
    fine, and it can never drive the subtotal negative). The third decides it: that
    function folds `passivesOf`, the CATALOG scan, whose holder half is SUPPRESSED
    under a §9 Ability-lock aura — and an attack INSTALLATION must be immune.
    Structurally true and **unobservable on this pool**, because `damageBonusBeforeWR`
    has exactly one producer in the registry (Vitality Band, a TOOL) and `passivesOf`
    suppresses only the holder's OWN printed passive. So a FIXTURE with a registry
    row makes it a board (`fix-booster-ability` + Ting-Lu ex "Cursed Land"): the 30
    vanishes on a damaged holder and the installed 100 does not.

    ⚠️ **AND IT REPORTS IN THE EXISTING `DAMAGE_DEALT.bonus`, WHERE D149's DEBUFF
    NEEDED A FIELD OF ITS OWN.** The row carries **one number per STEP AND
    DIRECTION, never one per card**: `reduction` has summed a catalog half with an
    installed one since D147 and `debuff` an installed half with an aura since
    D151. A new `boost` field would have been the first split by SOURCE, and D149's
    second field is justified by the opposite DIRECTION rather than by provenance.
    Driven with Vitality Band attached: one row, `bonus: 110`, one crumb.

    ⚠️ **ONE READ SITE, AND THE BOUNDARY IS THE ADDRESS.** D149's debuff reaches all
    four pre-W/R sites because it is a fact about a BODY; this is a fact about a
    DECLARATION, and only `attack.ts`'s main hit knows the declared index —
    `EffectContext` carries `seat`, `sourceUid` and `invokedBy` and no index.
    Unreachable rather than unbuilt: the one printing's boosted attack does its
    whole damage through the printed `damage` field and derives no damage-dealing
    op. A printing that boosts an attack whose damage comes from an OP would earn
    `EffectContext` an attack index.

    ⚠️ **IT GATES NO ACTION, CHECKED RATHER THAN ASSUMED** — the question D154 was
    the first durated field to owe. Both projections publish the attack's PRINTED
    `damage` string straight off the catalog, which no pre-W/R adjustment has ever
    moved (Vitality Band, Choice Belt, Defiance Band, Practice Studio and Binding
    Mochi are invisible there too), so surfacing this one alone would report a
    single source of a number the panel does not claim to compute. No `redact.ts`
    and no `GameHud.tsx` diff, and the suite pins that every row stays playable.

    ⚠️ **THE §D147/§D152/§D154 `attackBlock` UNION IS RE-DERIVED AND STILL NO.** The
    earning condition D154 left is an ENUMERATING caller. There is still none: this
    field's only reader asks for exactly one kind, and the slice adds a SEVENTH
    stamped field without adding a site that receives a rider whose kind it does
    not know. What it does add is the first pair of records in the family that are
    a key apart — the case a union looks most attractive for — and the separation
    ground above is precisely why one would cost rather than save.

    Cost: **1 op, 1 required `InPlayPokemon` field, 1 record type, 1 regex, 1
    deriver arm, 1 reader, 1 shared install-side resolver (extracted from D154's op
    so its one curly-named witness covers both), 1 NEW EVENT, 1 log arm, 4 §10
    clears and 1 term at ONE read site** — no park, no new error code, no prompt,
    no `DAMAGE_DEALT` member, no redact/HUD diff, no `@luminous/schema` or DB diff
    beyond the one constant.

    ---

    **0.103.1 (D156) — HARDENING, NOT A CARD SLICE: THE CATALOG CLAIMS BECOME
    CHECKABLE.** D150 is the model — a slice whose whole value is turning an
    unchecked claim into a driven proof — and this is that one level out, for the
    claims the engine makes about the CATALOG rather than about its own ops. Item
    7 of D155's remainder list, all three halves.

    ⚠️ **THE HEADLINE IS THAT D155's FINDING WAS ITSELF A CLAIM NOBODY RE-QUERIED,
    AND THE FOURTH INSTANCE OF THE DEFECT IT NAMED.** "978 matches no table in the
    file" is true of the file today; "none of those ~20 comments ever measured it"
    does not follow, and is false. **D112 (2026-08-01) recorded the breakdown in
    `decisions.md`: 978 cards / 6 sets — the five sets here PLUS `swsh10.5` (88
    rows).** Three arithmetics corroborate it: 890 + 88 = 978; on
    `legal_standard = 0` this file's 763 + 88 = the 851 the docs quote; and D147's
    census table (2026-08-02) lists Pidove `swsh10.5-061` as a query RESULT, so
    the rows were there that day. **The catalog SHRANK between 2026-08-02 and
    2026-08-03** — no `cards`, `sets` or `series` row for the set survives, and
    the .sqlite's mtime never moved, so the ingest lived in a write-ahead log that
    was never checkpointed. The defect was never a wrong number; it was a
    SCOPELESS one, which is exactly what D154 said and one level below where D155
    looked.

    ⚠️ **THE PIN, AND IT IS ONE MECHANISM RATHER THAN A SCATTERING.**
    `catalogManifest.ts` is a COMMITTED, generated measurement of the local D1
    (`bun run scripts/catalog-manifest.ts`, `--check` to diff): row count, set
    list, category split, distinct names, per-text-column counts,
    `legal_standard`, apostrophe populations, the sqlite's mtime and size, the
    printed attack/Ability NAMES of every real-card fixture, and `priorState` —
    D112's six-set catalog, marked INHERITED because no query this session could
    run produces it. `catalogManifest.test.ts` (22 tests) then fails on: a fixture
    NAME that disagrees; a MISSING printed attack or Ability; a fixture with no
    catalog row; an attack at the wrong PRINTED INDEX; and any three-or-four-digit
    "N cards" in the engine sources that is not a measured number — or that IS a
    catalog row count and does not carry its SET COUNT. Every allowlist is total in
    BOTH directions (D150's rule) and every entry carries a REASON.

    ⚠️ **THE SQLITE IS NOT A BUILD INPUT, AND THE TRADEOFF IS STATED RATHER THAN
    HIDDEN.** It lives under `apps/api/.wrangler/state/` — dev state, absent on a
    fresh clone and in CI — so a vitest case that opened it would be flaky by
    construction and, worse, VACUOUSLY green where it is missing. Hence: read once
    by a script, committed as data, checked as consequences. The manifest can go
    stale against the sqlite and no test can see that; `--check` is the one command
    that answers it for anyone who has the file.

    **Found by the diff and FIXED, both small and both false "verbatim" banners:**
    Fezandipiti ex `sv06.5-038` was missing its printed "Flip the Script" Ability
    under a doc block claiming verbatim, and Rockruff `sv03-116` was missing its
    printed "Bite" while its neighbour Finizen DECLARES the same omission. Also
    moved Pecharunt ex's doc block back onto its fixture (it had drifted above
    Lycanroc ex's at D152), so the one declared omission on that page stopped
    reading as the one fixture with no doc at all.

    **Measured, not inherited:** 890 rows / 5 sets (sv01 258, sv02 279, sv03 230,
    sv06.5 99, sve 24); Pokémon 736 / Trainer 119 / Energy 35; 519 distinct names;
    `effect` 123, `attacks_json` 736, `abilities_json` 143, union 859;
    `legal_standard = 0` 763; ZERO U+2019 anywhere; sqlite mtime 2026-07-27.
    34 fixtures omit a printed attack or Ability (D151's "40", never re-queried,
    against a catalog that has since shrunk); 12 have no catalog row left.

    Cost: **0 engine lines.** No op, field, event, error code, park, prompt,
    registry row, deck, projection or persisted shape moved, and
    `MATCH_RECORD_VERSION` stays **10** — nothing `MatchRecord`, `GameState` or any
    event embeds was touched, said explicitly rather than left to inference. The
    PATCH bump rather than D150's no-bump is the one difference from that
    precedent: D150 touched only a test file, and this adds a committed module to
    the package and rewrites ~57 provenance comments in shipped sources.

    ---

    **0.103.1 → 0.104.0 (D157) — P3-M5 long tail: the OPPONENT-SIDE PER-ATTACK
    LOCK** — *"Choose 1 of your opponent's Active Pokémon's attacks. During your
    opponent's next turn, that Pokémon can't use that attack."* — **2 printings on
    ONE anchor with NO capture, a THIRD op, a NEW PROMPT KIND, and D154's FIELD
    reused unchanged.** Item 1b of D156's remainder list, and the LAST unread
    member of the per-attack neighbourhood; D154 named it out of scope and D155
    named it again.

    ⚠️ **THE CENSUS HELD ON EVERY CLAIM, AND SAYING SO IS THE POINT.** Both
    printings re-queried against the local D1 (2026-08-03, **890 rows / 5 sets** —
    D156's measured population) across all three text columns: `LIKE '%can''t use
    that attack%'` returns exactly TWO rows, Medicham `sv01-111` "Acu-Punch-Ture"
    ({F}, 30, **INDEX 0**) and Oranguru `sv02-094` "Plotter's Command" ({P}{C}, 30,
    **INDEX 0**), and the D1 itself reports the two effect strings BYTE-IDENTICAL.
    `FIXTURE_POOL` was swept SEPARATELY (D154's finding, D156's rule) and held
    neither, so two printings means two in both populations. Repo-wide id sweep:
    clean. **Nothing on the inherited list was wrong — the first such list since
    D154's item 1a, and worth stating explicitly rather than passing over.**

    ⚠️ **A THIRD OP AND A SHARED FIELD, WHICH IS THE SAME TEST ANSWERED TWO WAYS AT
    TWO SITES.** The field is `InPlayPokemon.lockedAttack` **UNCHANGED** — D148's
    answer reached at the address: *"which of this body's attacks is barred, and on
    which turn"* is ONE question about ONE body, and whose attack wrote the answer
    is a fact about the OP. `lockedAttackIndex` is its ONE reader and REFUSES the
    index whichever op wrote it, so the reader, `attack.ts`'s §8 gate, BOTH
    payability projections and all FOUR §10 clears take **zero diff** and
    `MATCH_RECORD_VERSION` stays **10**. **D155 ran that same read-site test on
    `boostedAttack` and got the opposite answer**, because its consumer PAYS the
    index this one refuses — so the two decisions are consistent rather than in
    tension, and both were decided by the read site. The OP is separate because
    D131's widen-don't-add test FAILS on it: `preventAttackUse` REQUIRES its
    printed noun, so `{ target: "defender" }` with no `attack` is not that op minus
    a key. **And the sharper half: this op returns a `park` from `stepOp` where
    that one returns a `done`**, so one op would make "does this install ask a
    question?" a runtime property of a field.

    ⚠️ **THE FIRST PROMPT WHOSE CANDIDATES ARE NEITHER CARDS NOR POKÉMON.**
    `chooseAttack { candidates: { index, name }[], note }`, answered with
    `{ kind: "attack", index }`. **It is PUBLIC-REF by its hidden-information
    reading and HIDDEN-CANDIDATE by its mechanics, and that pair is the finding:**
    the printed attacks of a face-up Active are on the table for both players (so
    the answerer gate is a convenience, and `redactPrompt` resolves no card
    identity), yet the wire must carry a resolved LABEL because an attack INDEX
    resolves against nothing the client holds — `RedactedCard` has no attack rows
    and `RedactedAttack[]` is published for the viewer's OWN Active only. *Is the
    answerer gate load-bearing?* and *must the server resolve a label?* are
    INDEPENDENT questions, and P4's two families had never separated them.

    ⚠️ **THE `resolveEffect` ALLOWLIST INVARIANT FIRES FOR THE FIRST TIME.**
    `apps/api/src/lobby/match.ts` records that `resolveEffect` is on the DO's set
    exactly while EVERY prompt kind has an online dialog. This is the first slice
    to add an eighth kind, so the schema arm, the redactor arm, the projection arm
    and `ChooseAttackDialog` land together — and the note now says which of those
    four the compiler catches (three; the dialog chain ends in an `else`, so a
    missing arm is a type error at the fall-through rather than at the chain).

    ⚠️ **PARK YES, PERSIST NO — AND A PARKED-OP SHAPE CROSSING THE WIRE IS ITS OWN
    QUESTION, ANSWERED EXPLICITLY.** The continuation (`pendingOp`) and the prompt
    both ride `GameState.phase` into `MatchRecord`, so both cross the persisted
    boundary — and both are UNION WIDENINGS (D125's distinction, D144's worked
    case): an old record holds one of the seven existing prompt kinds and one of
    the existing ops, every one of them still a valid inhabitant. No required key
    appeared on `InPlayPokemon`, so **D124's trigger does not fire** and
    `MATCH_RECORD_VERSION` stays **10** — the seventh distinct no-bump reason, and
    the first that is a new PROMPT member.

    ⚠️ **VOICE: VICTIM-SIDE *AND* NARROWED, THE CELL OF THE CROSS-PRODUCT NOBODY
    HAD FILLED.** `ATTACK_LOCKED` has been victim-side since D148 (which added no
    `attack` field) and has carried the `attack` narrowing since D154 (whose op has
    no defender arm); this is the first path that is both. Read rather than
    inherited: "next turn" means the NAMED player's own next turn under this
    family's seat rule, the named player is the victim, and the victim's next turn
    IS the `+ 1` window — so the row is TRUE as it stands and needs no new arm.
    Rendered under BOTH seats and read: under the actor's name the identical words
    are FALSE, and the bare D148 wording is false in the other direction.

    ⚠️ **§11: `blocked`, WHERE BOTH SIBLINGS ARE `untouched`.** The first op in
    this family a wide block stops, because it is the first that writes onto the
    DEFENDING Pokémon (`preventRetreat`'s, `weakenDefenderAttacks`'s and D148's
    `preventAttack { target: "defender" }`'s verdict verbatim). The refusal sits IN
    FRONT OF the candidate scan — `discardEnergy`'s placement and its reason: a
    shielded defender must never reach the prompt, because asking a player to pick
    an attack that will not be barred is worse than not asking. Verdict AND driven
    probe (D150), plus a driven board of its own.

    ⚠️ **IT GATES AN ACTION AND OWES BOTH PROJECTIONS — WHICH TAKE ZERO DIFF, AND
    THAT WAS DRIVEN RATHER THAN ASSUMED.** `redactedAttacksOf` returns rows only
    for `viewerSeat === turnSeat` and reads that viewer's OWN Active; the locked
    seat here is the one that did NOT act, and it is the turn owner exactly during
    the window, so the same line answers. What changes is who is looking at the
    greyed button — a player who never chose the lock, D148's "sharper one to get
    wrong". Pinned from the VICTIM's chair on both sides.

    ⚠️ **THE `attackBlock` UNION, RE-DERIVED A FOURTH TIME AND STILL NO — and this
    slice is the closest call yet.** D154's earning condition is an ENUMERATING
    caller, and a prompt that must LIST something is the nearest thing to one that
    has come up. It is not one: this prompt enumerates the DEFENDER's printed
    ATTACKS, which is a fact about a CARD and not about the durated riders on a
    body. No caller in the engine receives a rider whose KIND it does not know, and
    this slice adds NO stamped field at all — the first durated slice since D148
    that does not. **Do not re-open it on a ninth field or on a second prompt.**

    Cost: **1 op (no fields), 1 regex, 1 deriver arm, 1 install, 1 shared apply, 1
    PROMPT kind, 1 CHOICE kind, 1 wire schema arm, 1 redactor arm, 1 projection
    arm, 1 HUD dialog, 1 validator arm** — no new state field, no new event, no new
    error code, no new §10 clear, no reader, no registry row, no `attack.ts` /
    `continuous.ts` / `turn.ts` / `log.ts` / `events.ts` diff, no DB diff. 2
    fixtures ADDED (both real cards), 1 new deck (`OPPONENT_ATTACK_LOCK_DECK` — its
    own 60 so D154's and D155's seeded boards stay byte-identical),
    `opponentAttackLock.test.ts` (**26 tests, SEED-FREE**), 2 new jsdom cases, and
    **two stays-LOUD witnesses RE-POINTED and none deleted** (`attackLock.test.ts`
    and `perAttackLock.test.ts` both carried this sentence as a `toBeNull` warrant
    and now assert it derives a DIFFERENT OP — which matters more here than in
    either predecessor, because this op writes the SAME record onto the SAME kind
    of body and only the derived program can tell a drifted reader apart).
    `clauseApostrophe`'s DISCOVERED census **60 → 61** — its first row exposing all
    THREE apostrophe slots at once (two possessives and a contraction). */
/** **D158 — the KO-CONDITIONED §9 recoil** (Vengeful Punch `sv03-197`, a Tool, 4
    counters): *"If the Pokémon this card is attached to is Knocked Out by damage
    from an attack from your opponent's Pokémon, put 4 damage counters on the
    Attacking Pokémon."* One registry row, a `damageAttackerOnKo` SIBLING on
    `PassiveEffects`, and a **NEW READ SITE** — `flow.ts`'s `finishAttack`, ahead of
    `collectKnockOuts` — because the condition is a **KO** rather than damage, which
    is the whole reason D152's `dealt > 0` block could not host it.

    ⚠️ **THE ORDERING IS THE SLICE, AND IT IS "BEFORE" RATHER THAN PRINTED ORDER.**
    The counters land off `lethalRefs`' OWN ref set, ahead of the sweep. Placing
    them inside the sweep loop — which is what the printed sentence reads like —
    would land them AFTER `lethalRefs` decided who dies, and then three things
    break: a lethal retaliation misses the batch and leaves a lethally-damaged
    Pokémon in play; the **§14 tie guard**, which speculates over ONE batch, could
    not see a game both players just lost; and cascade becomes live. Placed before,
    it is **ONE SIMULTANEOUS BATCH** — §8.1's own model — so there is no second
    pass to cascade into.

    The sibling field is grounded on the READ SITES, D155's standard: the two
    consumers **MUTUALLY REFUSE** each other. Rocky Helmet must fire on a hit its
    holder SURVIVES; this must not fire on one. A single shared field fires Rocky
    Helmet twice on a lethal hit.

    Driven: mutual KO (one batch, defender's board first, attacking player prizes
    first, tie included); the **BENCH** KO, which FIRES because this card does not
    print *"in the Active Spot"* — where a benched Rocky Helmet on the identical
    board pays nothing; and non-attack damage, which never fires because Checkup
    and evolve KOs call `collectKnockOuts` DIRECTLY, skipping `finishAttack`.
    **VOICE is SYSTEM** — rendered under both seats and read, and naming EITHER
    seat is wrong. No §11 verdict owed: no op was added. */
/** **D159 — the ALWAYS-ON ATTACKER FILTERS.** The half of §D146's census that
    never reaches an attack: five printings over four sentences, and **three
    mechanisms rather than one predicate with a parameter**.
    `PassiveEffects.preventDamageFromType` (Dachsbun `sv01-099` {R}, Bellibolt
    `sv03-078`/`-201` {L}) is `preventDamageFromExV`'s sibling on `passivesOf` with
    the gate moved from the printed NAME to the `Card.types` datum, resolved at the
    read sites by `preventsAttackerType`. `PassiveEffects.preventBenchDamageWhileActive`
    (Thundurus `sv03-070`) is the aura-scan family's EIGHTH member and its FIRST
    same-seat cross-body one — the Active shields its own Bench — and it filters NO
    ATTACKER at all. `StadiumEffects.preventDamageToNoRuleBoxFromExV` (Neutralization
    Zone `sv06.5-060`, an **ACE SPEC**) is the first Stadium in the pool on the §8.5
    DAMAGE seam: `hasRuleBox` NEGATED on the body being hit, `isExOrV` on the body
    hitting it, both boards, no seat to derive and no §9 gate.

    ⚠️ **THE LIST'S "6 PRINTINGS" WAS THE CENSUS FIGURE, NOT THE REMAINDER** — the
    sixth is Mimikyu's Safeguard, built at 0.58.0, and §D146's own parenthesis says
    so. Four handoffs quoted it as work left. "4 sentences" was exact.

    ⚠️ **THE SPLIT IS `ignoreWR`, AND IT IS DRIVEN OFF ONE PRINTED ATTACK.** Feint
    Attack's *"any effects on that Pokémon"* scopes the TARGET, so it nulls the
    holder-side preventions and leaves the two whose source is another body or no
    body — the same reading D151 made for a subtraction. The three mechanisms are
    grounded on the read sites, not on style: they differ in SOURCE (damaged body /
    its side's Active / no Pokémon), in whether a §9 lock can reach them
    (suppresses / suppresses / **cannot reach**) and in `ignoreWR` (nulls /
    standing / standing). A shared record would be paid by a consumer that refuses
    it — D155's test.

    ⚠️ **AND `DAMAGE_DEALT.prevented` HAS EXISTED SINCE 0.58.0 WITH NOTHING
    RENDERING IT.** A fully prevented hit logged *"dealt 0 damage to <name>"*. One
    crumb, `" · prevented"`, placed after the reduction it supersedes and naming the
    FACT rather than the rule.

    Cost: 2 `PassiveEffects` fields, 1 `StadiumEffects` field, 3 `continuous.ts`
    functions, 5 registry rows on 4 programs, 4 read sites, 1 log crumb.
    `MATCH_RECORD_VERSION` stays **10** — nothing on `InPlayPokemon`, no op payload
    and no persisted shape moved; the cached-flag dodges were priced and refused. */
/** **D160 — the CATALOG IS WHOLE AGAIN, and three downward corrections reverse.**
    A HARDENING slice with **0 engine behaviour lines** (D156's precedent for a
    patch bump). `swsh10.5` was re-ingested into the local D1 and the WAL
    CHECKPOINTED — the step whose absence lost it in the first place — so the file
    is **978 rows / 6 sets** again, `serieRows` 1 → 2, and the twelve `swsh10.5`
    fixtures have catalog rows for the first time in this repo's life.

    ⚠️ **`priorState` HAD BECOME FALSE IN EVERY FIELD IT ASSERTED**
    (`missingSet`, `missingRows`, `lastSeen`, `firstMissing`), so it is replaced by
    `history` — the episode recorded as HISTORY rather than as a live divergence:
    the dates, what the restored set CONTRIBUTES to each count (measured), D156's
    committed census of the shrunken catalog (recorded), and `censusedInTheGap`.
    The reconciliation is by SUBTRACTION on **four independent axes** — 978−88=890,
    851−88=763, 809−73=736, 359−33=326 — because a re-ingest of a DIFFERENT 88 rows
    reconciles on the row count alone.

    ⚠️ **THE MANIFEST CAUGHT ITS OWN DEFECT CLASS.** D156 asserted
    `textColumns.attacksJson === categories.Pokemon` — *"every Pokémon row carries
    attacks and nothing else does"*. True of the five-set catalog, FALSE of the
    six: **Ditto `swsh10.5-053`** prints no attacks at all (its Ability borrows them
    from the discard pile). Restated with the exceptions ENUMERATED in a generated
    `pokemonWithoutAttacks` rather than counted.

    ⚠️ **THE TWELVE FIXTURES, DIFFED FIELD BY FIELD FOR THE FIRST TIME — AND NO
    FIELD ANY OF THEM CARRIES IS WRONG.** Every attack cost, damage and effect
    string, every Ability effect, every name matches the restored row. The
    *"verbatim off the local D1"* doc blocks were telling the truth. Three
    OMISSIONS, now declared: Charizard `swsh10.5-010`'s "Burn Brightly" (already
    documented), Radiant Blastoise `swsh10.5-018`'s "Pump Shot" (registry-authored),
    and **Charmeleon `swsh10.5-009`, the SIXTH reindexed fixture** — it dropped the
    printed index-0 "Scratch", so `providesEnergy.test.ts`'s `index: 0` was the
    card's index 1. A hazard, not a bug (no registry program and no durated
    `attackIndex` keys on it), and the first one found BY the manifest table rather
    than declared into it. ✅ **FIXED AT D173**, with the other five: all six carry
    their whole printed attack list at printed indices and every declaration names
    the printed number, so the `reindexed` column of the `INCOMPLETE` table is now
    EMPTY. The column is kept — it is what says so.

    ⚠️ **THREE DOWNWARD CORRECTIONS MADE DURING THE OUTAGE ALL REVERSE.** Against
    the restored catalog, `less damage (before applying` returns **6 rows, 5 of them
    attacks** — so §D149's "5 printings" and §D151's "six rows" were both EXACT and
    D155's corrections to 4 and 5 were the missing set speaking. And D154's per-
    attack lock census returns **8 rows across 6 names**, which is §D143's inherited
    *"8 printings / 6 sentences"* exactly; D154's correction to "six across four
    names" was the same artefact. **Radiant Charizard `swsh10.5-011` really does
    print "During your next turn, this Pokémon can't use Combustion Blast."** and is
    in no fixture — an unread printing of a family the deriver already reads.

    ⚠️ **THE RESIDUE.** Every census in this repo dated 2026-08-03 — D154's, D155's,
    D156's own, D157's, D158's and D159's — ran against the 890 / 5 catalog and is a
    **FLOOR**, not a total. `history.censusedInTheGap` names them.

    Cost: the generator, the regenerated manifest, `catalogManifest.test.ts`
    (22 → 24 tests, including the state-collision guard that replaced a TS1117), one
    fixture doc block. No op, event, field, registry row or read site.
    `MATCH_RECORD_VERSION` stays **10** — nothing persisted exists to move. */
/** **D161 — the ALWAYS-ON POST-W/R DAMAGE REDUCTIONS.** The last two unread rows
    of §D147's twenty-printing *"after applying Weakness and Resistance"* group,
    and **TWO mechanisms rather than one field with a gate**.
    `PassiveEffects.damageReductionAfterWRIfType` (Rock Chestplate `sv01-192`, a
    Pokémon TOOL: *"The {F} Pokémon this card is attached to takes 30 less
    damage…"*) is resolved **INSIDE `passivesOf`** against the holder's own
    `Card.types`, so all four §8.5 read sites take a **ZERO diff** — the number
    arrives inside `damageReductionAfterWR` itself.
    `PassiveEffects.seatDamageReductionAfterWR` (Hariyama `sv02-113` "Arm Thrust
    Practice": *"All of your Pokémon take 10 less damage…"*) is the aura-scan
    family's **NINTH** member, summed at the four sites beside the catalog and
    installed halves — one printed sentence, one step, now three sources and still
    ONE number.

    ⚠️ **THE INHERITED PRICING WAS RIGHT ON THE CARDS AND WRONG ON BOTH SHAPES.**
    D159 priced Rock Chestplate as *"`preventsAttackerType` with the ends
    swapped"*: the DATUM is the same, the PLACEMENT is not — that gate names the
    ATTACKER, a body `passivesOf` has no access to, and this one names the body
    being folded, so it is `basicHpBonus`'s placement (Bravery Charm) and not a
    read-site predicate. And it priced Hariyama as *"`benchShieldedByActive` with
    the Bench clause dropped"*: dropping only the target clause leaves an
    ACTIVE-ONLY SOURCE, which this sentence does not print either. What is left
    once both clauses go is **`hasFreeRetreatAura`'s** own-board per-target scan,
    with `opposingRetreatSurcharge`'s SUM over sources.

    ⚠️ **AND THE `ignoreWR` ANSWER IS DECIDED PER BOARD, WHICH IS NEW IN KIND.**
    Every earlier member of this family answers Feint Attack the same way at every
    SITE because its source could never BE its target. This aura is
    SELF-INCLUSIVE, so its source set CONTAINS its target set: a sniped Hariyama
    loses its own 10 and keeps a teammate's, off one declaration of one printed
    attack. `seatDamageReduction`'s `scope` is REQUIRED (D146's enforcement) so a
    new read site must say which it means.

    ⚠️ **AND THE CENSUS DID NOT MOVE, WHICH IS ITSELF THE FINDING.** §D147's census
    is dated **2026-08-02** — before the outage — so it always measured six sets,
    and re-running it against the restored 978 / 6 returns 31 / 20 / 2 unchanged.
    Two scope tags in `effects.ts` were nevertheless wrong: D156's mechanical pass
    labelled two **2026-08-02** censuses *"890 cards / 5 sets"*, and the first of
    them lists Pidove `swsh10.5-061` three lines below. **A scope tag owes the DATE
    of the query it labels.** Corrected in place.

    Cost: 2 `PassiveEffects` fields, 1 `continuous.ts` function, 1 gate inside
    `passivesOf`, 2 registry rows, 4 read sites — no new op, event, error code,
    prompt, park, regex, deriver arm, redact arm or projection, and no
    web/DB/`@luminous/schema` diff. `MATCH_RECORD_VERSION` stays **10**: both
    fields live on the CATALOG, both readers are pure functions of the current
    state, and the cached-total dodge was priced and REFUSED. */
/** **D162 — the RESTORED-CATALOG RE-CENSUS, and the per-attack lock family
    CLOSES.** Two halves, both created by D160's re-ingest. (1) **Radiant Charizard
    `swsh10.5-011`** prints `During your next turn, this Pokémon can't use
    Combustion Blast.` — the sentence D154 built, on a card D154 concluded was *"in
    NEITHER the catalog nor `FIXTURE_POOL`"* because at that moment it was in
    neither. It needed **ZERO engine behaviour lines**: the anchor, `preventAttackUse`,
    `lockedAttack`, `lockedAttackIndex`, the §8 gate, the three §10 clears and both
    payability projections were each READ and each takes the printing unchanged.
    A fixture, its own `RADIANT_LOCK_DECK` (adding to `PER_ATTACK_LOCK_DECK` would
    reshuffle D154's `SEED = 13` boards) and 8 cases.

    ⚠️ **THE FAMILY IS NOW CLOSED AT 8 ROWS / 6 NAMES — §D143's INHERITED FIGURE,
    EXACTLY.** All eight are enumerated and classified, and there was no second
    unread printing: Lucario `sv01-114`, Skarmory `sv03-142`, Greedent ex
    `sv03-179`, Munkidori ex `sv06.5-037`/`-083`/`-091` (three byte-identical
    rarities), Radiant Blastoise `swsh10.5-018` — all D154 — plus this one.

    ⚠️ **AND IT INVERTS D154's OWN FINDING.** D154 had to make `ATTACK_LOCKED` NAME
    the attack, because *"can't attack next turn"* on a Pokémon that can still use
    its other attack is not stilted, it is FALSE. **Radiant Charizard has no other
    attack**, so the bare wording would be TRUE here — the branch buys SPECIFICITY,
    not correctness. Pinned, because the mutation is otherwise invisible. Two more
    cells the family never had: the projection on a ONE-ATTACK body (it greys 100%
    of the panel) and a **rule box by NAME PREFIX** worth 1 Prize — `hasRuleBox` is
    the suffix set ∪ `"Radiant "` while `prizeValueOf` reads the suffix alone.

    (2) **The four owed re-censuses all came back UNCHANGED** — D157's
    (`can't use that attack`, 2), D158's two (`damage counters on the Attacking
    Pokémon`, 8; `Knocked Out by damage from an attack`, 6) and D159's
    (`by attacks from` outside `attacks_json`, 6). **`swsh10.5` contributes ZERO
    rows to all four**, so none of those slices undercounted and no unread printing
    was revealed. One neighbourhood did grow: D154's warrant sweep `can't use` went
    **29 → 37**, the eight new rows being 2 lock sentences and 6 refusals.

    Cost: 0 engine behaviour lines, 1 fixture, 1 deck, 8 cases, and three corrected
    census scope tags in `effects.ts`. `MATCH_RECORD_VERSION` stays **10** — the
    eighth control on D124's trigger. 10 mutations run, 10 caught. */
/** **D163 — the SELF-SCALING DAMAGE PENALTY, and the `less damage` census CLOSES.**
    `This attack does {10|20} less damage for each damage counter on this Pokémon.`
    — **5 printings / 2 sentences**, the LAST unread rows of §D147's thirty-one
    printing census: Skeledirge ex `sv02-037`/`-233`/`-258`/`-272` "Burning Voice"
    (idx 1, {R}{R}, printed `"270-"`, 10 per counter) and Cetitan `sv01-060`
    "Sweeping Tackle" (idx 1, {W}{C}{C}, printed `"200-"`, 20 per counter).

    ⚠️ **THE INHERITED PRICING — *"it may be ONE REGEX AND A SIGN"* — IS RIGHT ABOUT
    THE REGEX AND WRONG ABOUT WHERE THE SIGN GOES, AND THAT IS THE WHOLE SLICE.**
    `deriveAttackDamageBonus` really does express the positive direction of this
    exact clause (`SELF_COUNTER_SCALE`, read since M2), and the count evaluator, the
    fold site, the clamp and the reported field all pre-existed. But `per` cannot
    simply go negative: the field the additive fold reports through
    (`DAMAGE_DEALT.scaled`) is **DIRECTION-COMMITTED AT BOTH OF ITS CONSUMERS** — it
    is emitted only when `scaledTotal > 0`, so a negative would VANISH from the row,
    and `log.ts` renders it ` · scaled +${n}`, so a surviving negative would print
    "+-40". So the number lands in **`debuff`**, the pre-W/R SUBTRACTION field D149
    created for exactly this direction at exactly this step, and the reader is a
    THIRD function (`deriveAttackDamagePenalty`) beside the additive and multiply
    ones — which is how this family already splits, **by FOLD**, over one shared
    `{per, count}` interface and one shared count evaluator. `+` keeps the base, `×`
    drops it, `−` keeps it and subtracts.

    ⚠️ **`debuff` GAINS ITS THIRD SOURCE AND ITS FIRST NON-INSTALLED ONE.** D149's
    attack-installed weakener, D151's always-on aura, and now a fact about the
    ATTACK BEING USED. One number per STEP AND DIRECTION, never one per card
    (D155's invariant, seventh payout) — a Cetitan swinging under an Entei's
    "Pressure" reports ONE `debuff` of 80 and no reader can attribute the HP to a
    card, which is D141's judgement unchanged. **No new event field, no new log
    crumb, no new arm.**

    ⚠️ **§9 GAINS A FOURTH ESCAPE, AND IT IS DRIVEN ON A BODY THE LOCK REACHES.**
    D159's axis read "suppresses / suppresses / cannot reach a STADIUM"; D161 added
    "cannot reach a TOOL"; this clause is printed on the **ATTACK**, so Ting-Lu ex
    "Cursed Land" is asserted LIVE on Cetitan's own uid (damaged, non-ex) and the
    number stands. `ignoreWR` sits OFF its axis entirely and structurally: a snipe's
    amount comes from its OP, while this clause modifies the attack's PRINTED
    damage, which only the main hit reads.

    ⚠️ **THE ORDER WAS MUTATED, NOT ASSUMED.** Cetitan (Water) into Skeledirge ex
    (340 HP, ×2 Water) at 3 counters is `(200 − 60) × 2 = 280` and survives; the
    reversed placement is `200 × 2 − 60 = 340`, exactly lethal. And the CLAMP is
    over the WHOLE sum rather than per term: 15 counters against a printed 200 plus
    a Vitality Band's 10 reads **0**, where a per-term floor would leave 10 doubled
    into 20.

    ⚠️ **AND THE INHERITED "3 sentences" IS WRONG IN THREE DOC SITES.** The pool
    prints exactly TWO, spanned by one `(\d+)`. Also found: `FIXTURE_POOL` had been
    carrying the Skeledirge sentence verbatim and UNREAD since D133 fielded that
    body at 0.94.0, so four of the five printings needed no fixture at all; and
    `sv02-055` is a DIFFERENT Cetitan agreeing with `sv01-060` on name, HP, stage,
    evolveFrom, types, retreat and Weakness, and differing only in its attack list.

    Cost: **1 regex, 1 reader, 2 lines in `attack.ts`'s pipeline** (one `+` on the
    `debuff` term, one term on each simulated-flag) — no new op, event, event field,
    log crumb, error code, prompt, park, field, registry row, redact arm or
    projection, and no web/DB/`@luminous/schema` diff. 1 fixture, 1 deck
    (`SELF_SCALING_PENALTY_DECK`, its own 60), `selfScalingPenalty.test.ts` (**34
    tests, SEED-FREE**), manifest regenerated (208 → **209** fixture rows, 0
    absent). `MATCH_RECORD_VERSION` stays **10** — the NINTH control on D124's
    trigger, pinned as an absence. 29 mutations run, 28 caught, 1 deliberate
    survivor (the reader's mutual-exclusion guard, free because the three regexes
    are disjoint — KEPT as the file's idiom with the unreachability turned into a
    pool-wide ASSERTION). */
/** **D164 — the KO-CONDITION ANTECEDENT AS ITS OWN FAMILY, and the PRIZE
    REDUCTION.** Munkidori ex `sv06.5-037`/`-083`/`-091` — *"…take 1 fewer Prize
    card"* on a KO by an opponent's attack — an **Ability**, byte-identical across
    all three printings (verified by `count(distinct …)` over 11 columns, not by
    eye). The antecedent census confirms **6 rows** a third time.

    ⚠️ **LUCARIO `sv01-114` IS NOT THIS ANTECEDENT, AND EVERY LIST SINCE D158 SAID
    IT WAS.** Printed: *"If any of your {F} Pokémon were Knocked Out by damage from
    an attack **during your opponent's last turn**…"* — retrospective, board-wide,
    type-filtered, and carrying **no possessive clause**. `conditionClause.test.ts`
    has held the correct account since **D115**, so the OLDER artefact was right and
    the NEWER census table was wrong: recency is not authority. D158's table also
    renders Munkidori ex in the column Lucario's *attack* sits in, when it is an
    Ability on `abilities_json`. And `FIXTURE_POOL` is **290**, not the 278 that
    header claimed for two slices.

    ⚠️ **THE FINDING, AND IT IS ABOUT D158's OWN DESIGN: PLACEMENT DISCHARGES A
    CONDITION ONLY FOR A CONSEQUENT THAT CAN LIVE AT THE PLACEMENT.** D158 satisfied
    *"by an attack"* purely by WHERE it put its line — `finishAttack`, which exactly
    one path reaches. A Prize is planned in `planPrizes`, **inside**
    `collectKnockOuts`, which **all three** paths reach. So the identical printed
    clause costs a threaded `attackerSeat?: Seat` here. The possessive is not free
    either: `finishAttack` passes BOTH seats, so `attackerSeat === ref.seat` is
    load-bearing rather than decorative.

    A SIBLING field, not a union member: Glimmora's guard and this reduction
    mutually refuse on THREE axes (cause qualifier, zero-vs-decrement, coin flip),
    and the merge mutations fail 16 and 2. The plan is made on the **pre-KO** state
    (a Pecharunt ex dying in the same batch still counts), **ahead of the §14
    speculation** (reducing only on the real pass fails 13), **per body** (2 holders
    give 2 reductions, not 4), and `ABILITY_TRIGGERED` must precede `PRIZE_REDUCED`.
    VOICE is SYSTEM, but by a different route than D158's: `PRIZE_PREVENTED` exists
    and is read, but *"no Prize card is taken"* is false when one is.

    ⚠️ **AND ONE MUTATION RESULT WORTH THE SPACE: THE CLAMP NEEDED TWO CONSTRUCTED
    VALUES.** A 1-Prize fixture alone never reaches it, because `1 - 1 = 0` whether
    or not the clamp exists — so the guard SURVIVED BEING "FIXED" ONCE before a
    second witness exposed it. A test can look like it covers a branch and provably
    not.

    Neither park nor persist; `MATCH_RECORD_VERSION` stays **10**, pinned as an
    absence over the 16-key set. No §11 verdict owed (no op). Gates no action,
    driven on both seats. **Exp. Share `sv01-174` is priced and deferred** — it
    needs a `"you may"` choice parking mid-sweep, which dominates its cost, but
    `FIX_ONKO`/`settleProgram`'s `resumeTail` may already cover that park and nobody
    has run the check; note the seam differs (`fix-onko` queues AFTER prizes, this
    must act BEFORE `knockOut`). */
/** **D165 — REVIEW FIX: `lockedAttack` had ONE READER and TWO WRITERS.** The
    field becomes `InPlayPokemon.lockedAttacks: LockedAttack[]` with one merge rule
    (`addLockedAttack` — idempotent on the `(turn, index)` pair, APPENDING on a
    differing index, PRUNING strictly-past entries) and one plural reader
    (`lockedAttackIndexes`). Both names changed deliberately so every call site is a
    COMPILE ERROR rather than silent runtime churn.

    `preventAttackUse` (D154, self-side) stamps `state.turn + 2`;
    `lockDefenderAttack` (D157, opponent-side) stamps `state.turn + 1` — **from
    adjacent turns those are the SAME turn**, and both wrote the one slot with a
    bare overwrite, so a differing index DISCARDED a live record and the §8 gate
    then allowed the very attack a card's own drawback bars.

    ⚠️ **THE IRONY IS THE TRANSFERABLE PART.** D157 shared the field because
    *"`lockedAttackIndex` is its ONLY READER"* — true, and not the question. **A
    reader count answers "can these two facts share a CONSUMER"; it says nothing
    about "can they share a SLOT".** `types.ts`'s own `LockedAttack` block refuses a
    different merge on exactly this ground, one column to the left.

    ⚠️ **AND IT IS THE ENUMERATING CALLER §D147/§D152/§D154/§D157 EACH FORECAST AND
    EACH DECLINED — arriving from the direction none of them watched.** All four
    watched rider KINDS, and that claim is still true (nothing dispatches; every
    entry means one thing). What stopped being true at D157 is that one body could
    carry only ONE bar. **A collection is earned by a MULTIPLICITY the read site
    must ENUMERATE just as much as by a UNION it must DISPATCH on.** The
    `attackBlock` union stays DECLINED; D155's `boostedAttack` refusal is untouched
    and sharpened — the list holds only addresses the gate REFUSES.

    `MATCH_RECORD_VERSION` **10 → 11**: the eighth time on D124's trigger and the
    FIRST that is a CHANGED TYPE rather than a new key, which is where *"can the
    previous deploy's RECORD hold the new TYPE"* earns its wording. No
    `@luminous/schema` diff — the wire is byte-identical, only the DO's stored
    `GameState` moves.

    ⚠️ **COMMITTED WITH AN OUTSTANDING DEBT: the mutation pass was INTERRUPTED at
    24 run / 22 caught, with TWO SURVIVORS AT THE SAME BOUNDARY and the witness
    never written.** ✅ **DISCHARGED AT D166** — the pass was re-derived rather than
    trusted (**32 run, 32 caught**) and the survivor count moved UP: **FIVE**, not
    two, every one of them the prune's `lock.turn >= now` boundary written a
    different way. Two witnesses in `lockedAttackMerge.test.ts` (a PLAYED self-side
    line, a CONSTRUCTED opponent-side one — the parity argument is in
    `addLockedAttack`'s doc block) kill all five, and the boundary is now pinned
    from both sides. **A slice's own report of its own mutation pass is on the list
    of claims a successor must re-derive.** No behaviour moved, so this version
    string did not. */
/** **D167 — THE MULTIPLY TWIN: the THIRD adjective on a count source the engine
    has read since M2.** *"This attack does {30|50} damage for each damage counter
    on this Pokémon."* — no adjective at all. **2 printings / 2 sentences**,
    measured against the local D1 (2026-08-03, 978 cards / 6 sets) across all three
    text columns: Drifloon `sv01-089` "Balloon Blast" (idx 1, {P}{P}, "30×") and
    Onix `swsh10.5-036` "Raging Swing" (idx 1, {F}{F}{C}{C}, "50×"). One `(\d+)`
    capture spans both.

    ⚠️ **THE FAMILY SPLITS BY FOLD, NOT BY COUNT SOURCE, AND THIS IS THE PRINTING
    THAT PROVES IT.** `damageCountersOnSelf` is now read by ALL THREE readers —
    "more" adds to the printed base, "less" keeps it and subtracts, and NOTHING
    makes `per × count` the whole damage with the base dropped — told apart by a
    single word. Because the split was made on the fold rather than on the source,
    the third arrival cost **one regex and one `if`**: no new `DamageCountSource`,
    no new evaluator arm, no new reader, no new fold, no branch in `attack.ts`, no
    op, event, event field, log crumb, error code, prompt, park, field, registry
    row, redact arm or projection, and no web/DB/`@luminous/schema` diff. D163's
    subtractive twin needed a whole third reader because its FOLD was new; this one
    needed none because its fold was not.

    ⚠️ **THE PLAN SAID "REUSE A FIXTURE" AND THERE WAS NOTHING TO REUSE.** Five
    bodies in `FIXTURE_POOL` already print this exact count source (`sv02-028`,
    `sv03-161`, `fix-attacker`'s Rage/Fury with "more"; `sv01-060`, `sv02-037` with
    "less") and **not one prints the bare form**; neither `sv01-089` nor
    `swsh10.5-036` was fielded anywhere in the package. **Both fixtures are authored
    fresh**, transcribed off the catalog — bending a neighbour's effect string would
    have made *"one regex spans two REAL printed amounts"* a claim about a string
    the test file wrote (D146).

    Two second-order behaviours of the `×` fold are INHERITED and now DRIVEN rather
    than discovered later: at zero counters `scaledBase + scaledTotal` is 0, so
    `attack.ts` skips the §8.5 pipeline and **no `DAMAGE_DEALT` is emitted at all**
    (rules-correct — the attack does 0 damage, and the turn still ends); and the log
    crumb renders the entire damage as ` · scaled +N` off `base 0`, as every
    existing member of this fold already does.

    Cost: **1 regex, 1 `if`**. 2 fixtures, 1 deck (`SELF_COUNTER_MULTIPLY_DECK`, its
    own 60), `selfCounterMultiply.test.ts` (**SEED-FREE**), manifest regenerated
    (209 → **211** fixture rows, 0 absent). `MATCH_RECORD_VERSION` stays **11** —
    the TENTH control on D124's trigger, pinned as an absence over the 16-key set.
    The one pin that went red is `selfScalingPenalty.test.ts`'s *"the UNREAD
    multiply twin … is STILL LOUD"*, RE-POINTED rather than deleted: the absence it
    guarded was the price of this item, so it becomes the presence. */
/** **D168 — the OPPONENT-SIDE DAMAGE-COUNTER COUNT, and the fifth
    `DamageCountSource`.** `This attack does {10|30} more damage for each damage
    counter on your opponent's Active Pokémon.` — **3 printings / 2 distinct
    sentences**, the whole family, measured against the local D1 (2026-08-03, 978
    cards / 6 sets) across all three text columns: Dedenne `sv01-095` "Second Bite"
    (idx 0, {P}{C}, `"30+"`, 10 per counter), Espeon `sv03-086` "Psychic Assault"
    (idx 0, {P}, `"30+"` — **the SAME sentence byte for byte on a second card**) and
    Bloodmoon Ursaluna `sv06.5-025` "Mad Bite" (idx 0, {F}{F}{C}, `"100+"`, 30 per
    counter). One `(\d+)` spans both amounts.

    ⚠️ **IT IS A `count` MEMBER WHERE D163's ONE-WORD-DIFFERENT SENTENCE WAS A WHOLE
    NEW READER, AND THE RULE IS THE SAME RULE.** This family splits by **FOLD** —
    `+` keeps the printed base, `×` drops it, `−` keeps it and subtracts — over one
    `{per, count}` interface and one count evaluator. D163's sentence changed the
    SIGN, so it bought a third reader. This one carries "more", so the fold is
    byte-identical to the one `deriveAttackDamageBonus` already performs and the only
    thing that varies is **which resource is tallied**, which is precisely what
    `DamageCountSource` is. The inverse answer to the inverse question, on sentences
    that differ by one word each time.

    ⚠️ **AND IT IS THE FIRST MEMBER THAT MIRRORS A MEMBER THE UNION ALREADY HAD.**
    `damageCountersOnSelf` and `damageCountersOnOpponentActive` read the identical
    field (`InPlayPokemon.damage ÷ 10`) off two different bodies. Two members rather
    than one member plus a `side` field, because every consumer dispatches on `kind`
    and nothing else — a `side` would be read by `scaledAttackDamage` anyway and the
    three members that have no side would carry a field they must ignore. The
    mirror is also the sharpest defect available, so the suite drives a board with
    **9 counters on the attacker and 3 on the defender**: self scores 270, a sum
    scores 360, the right answer is 90.

    ⚠️ **THE EVALUATOR COST NOTHING BUT ITS ARM.** `scaledAttackDamage` already took
    `(attacker, bonus, state, defenderSeat, attackerSeat)` for the Prize and
    retreat-cost members, so the defending body was already in reach — no new
    argument, no signature change, and the arm is shape-identical to the
    `opponentActiveRetreatCost` one beside it, null-Active guard included. It is
    also the repo's ONLY exhaustive switch over the union (nothing in log.ts,
    redact.ts, phaseView.ts or `apps/web` dispatches on it), so a fifth member is
    one arm and not five. `scaling !== null` already carried both terms of the
    `ATTACK_EFFECT_SKIPPED` guard, so attack.ts's flag logic took **zero** lines.

    ⚠️ **AND THE FIRST-MATCH-WINS HAZARD WAS VERIFIED, NOT ASSUMED, IN BOTH
    DIRECTIONS.** `SELF_COUNTER_SCALE` and `SELF_COUNTER_PENALTY` are the only other
    patterns in the file carrying the words "damage counter"; all are `^…$`-anchored
    and the two self ones end in the LITERAL `on this Pokémon.`, so no negative
    lookahead is needed on either side. The pool-wide "at most one reader answers"
    sweep is re-run with the three new fixtures in it. The MULTIPLY twin of THIS
    count source is an **ABSENCE rather than an unread printing** — the D1 sweep
    returns four rows for `%damage counter on your opponent%`, three attacks all
    carrying "more" plus Trevenant `sv03-012`'s placement Ability — and is pinned as
    one, because "it is one regex away" is how a slice invents a card.

    Cost: **1 regex, 1 reader arm, 1 `DamageCountSource` member, 1 evaluator arm** —
    no new op, event, event field, log crumb, error code, prompt, park, state field,
    registry row, redact arm or projection, and no web/DB/`@luminous/schema` diff.
    3 fixtures (all authored fresh — `FIXTURE_POOL` had ZERO coverage of any of the
    three cards or either sentence), 1 deck (`OPPONENT_COUNTER_DECK`, its own 60,
    fielding Tyranitar ex `sv03-066` because the defender must arrive PRE-DAMAGED
    **and survive** `100 + 30n`, which `fix-bigbody` does not),
    `opponentCounterScaling.test.ts` (**34 tests, SEED-FREE**), manifest regenerated
    (211 → **214** fixture rows, 0 absent) and `clauseApostrophe.test.ts`'s census
    62 → **64**. `MATCH_RECORD_VERSION` stays **11** — `DamageCountSource` is a
    PARSE-TIME type in effects.ts that never reaches `GameState`, which is exactly
    why a new member of it buys no bump where D165's changed `InPlayPokemon` field
    did; pinned as an absence over the 16-key set. */
/** **D169 — THE FIRST ATTACK-COST DISCOUNT AND ITS SURCHARGE SIBLING.** One
    mechanism, opposite signs, two printings, and the family CLOSES at 3/3:
    Seismitoad `sv03-052` "Quaking Zone" (*"As long as this Pokémon is in the Active
    Spot, attacks used by your opponent's Active Pokémon cost {C} more"*) and
    Radiant Charizard `swsh10.5-011` "Excited Heart" (*"This Pokémon's attacks cost
    Colorless less for each Prize card your opponent has taken"*), beside Pokémon
    League Headquarters `sv03-192`, built since M4. Two `PassiveEffects` fields, two
    registry rows, two continuous scans (`opposingAttackCostSurcharge` —
    `opposingAttackDebuff`'s scan with one field renamed — and
    `selfAttackCostDiscount`, `hasFreeRetreatSelf`'s shape), and one reworked fold.

    ⚠️ **BOTH SIGNS WERE ALREADY EXPRESSIBLE AND NEITHER NEEDED A TYPE CHANGE.** The
    seam returns `readonly string[]` of literal energy symbols with `"Colorless"` a
    distinguished member — `costMet` buckets it by exactly that string compare — so
    a surcharge APPENDS and a discount REMOVES. **The array floors itself**: a
    6-Prize discount against a printed `{W}{W}` leaves `{W}{W}`, because a removal
    loop can only remove what is present. That is the sharpest structural difference
    from `effectiveRetreatCost`, whose cost is a NUMBER and which must clamp at
    `Math.max(0, …)`.

    ⚠️ **THE TWO DIRECTIONS ARE SEPARATE FIELDS SUMMED AS ONE NET DELTA — the
    D163 trap, refused by construction.** The old body early-returned on
    `surcharge <= 0`; a field carrying both signs would have read a real discount as
    "nothing applies". `stadiumRetreatDelta`'s `added - discount` idiom, one seam
    over. The netting is EXACT, not convenient: append-N-then-remove-M and
    apply-the-net produce the same `max(0, printedColorless + N − M)`.

    ⚠️ **AND THE REWORK'S REAL BEHAVIOUR CHANGE IS THE `!isBasicPokemon` EARLY
    RETURN BECOMING A PER-TERM GATE.** Only League HQ's sentence prints "each BASIC
    Pokémon in play"; both new sentences print no stage — and **Seismitoad is itself
    a Stage 2**, so the surviving gate would have switched the aura off for every
    non-Basic Active it aims at. `stadiumRetreatDelta` made this exact move when the
    first stage-agnostic aura reached the retreat seam.

    ⚠️ **THE ITEM'S TRUE COST WAS NOT ON THE COST SEAM AT ALL — IT WAS THE RENDER
    BYPASS.** `effectiveAttackCost` is the one *payability* seam and **not** the one
    *cost* seam: the wire and both HUDs published the **PRINTED** cost while
    `playable`/`disabled` beside it was computed from the **EFFECTIVE** one. A
    shipped divergence, invisible while the pool's only modifier was a SURCHARGE
    (the button greys and the dots do not say why) and **wrong in the worse
    direction** the moment a DISCOUNT exists (the button lights up while the dots
    show a cost the player has not paid). Fixed by a **SIBLING** field
    `RedactedAttack.effectiveCost?: string[]` — *not* by widening `cost`, whose
    meaning as PRINTED is documented in `@luminous/schema` and depended on by two
    HUDs. A sibling is additive, reversible, and strictly more informative (a client
    can render "was 5, now 3"); it is emitted **only when the two differ**, so every
    board without a cost modifier puts a byte-identical frame on the wire, mirroring
    `effectiveAttackCost`'s own return-the-same-array contract. The local HUD needs
    no wire field and simply draws the array it already computed.

    **NO `MATCH_RECORD_VERSION` BUMP — 11 stands, and the answer is derived rather
    than inherited.** D124's test is *"can the PREVIOUS deploy's RECORD hold the new
    TYPE"*, and `MatchRecord` persists exactly `{version, seed, startedAt, names,
    state: GameState, log: SeatLogEntry[]}`. `RedactedAttack` is a **wire
    projection**, rebuilt from `GameState` on every frame and persisted nowhere — so
    an added field on it cannot make an old record unreadable, and the field is
    optional besides. Nothing was stamped onto `InPlayPokemon`: both prints are
    continuous ABILITIES re-read live off the current board, which is also why both
    are §9-suppressible where a stamp would not be. No `GameState` field, no
    `EffectContext` field, no `BoardCondition` member, no op, no event, no error
    code, no `EffectContinuation` inhabitant.

    **§9 CAME FREE, AND THE TWO CARDS TAKE DIFFERENT LOCKS.** Radiant Charizard is a
    **Basic**, so Klefki `sv01-096` "Mischievous Lock" silences Excited Heart and the
    printed `{R}{C}{C}{C}{C}` snaps back — the family's third assertable §9 positive
    after D113's Snorlax and D114's Wimpod. Seismitoad is a **Stage 2**, which no
    Klefki can reach (D113's rule: reachability follows the SOURCE's stage), so its
    lock is Ting-Lu ex "Cursed Land" against a DAMAGED holder. Both boards are
    driven.

    **ZERO FIXTURE CARDS.** Both printings were already fielded verbatim WITH their
    Abilities and with the simplification stated out loud beside each — *"carrying it
    means the fixture states a simplification the engine has, rather than hiding it
    behind a card that looks fully simulated"*. This slice is those two admissions
    discharged, and the pin that guarded one of them
    (`programFor("swsh10.5-011") === undefined`) went RED exactly as designed and was
    RE-POINTED at the passive field the new row defines. */
/** **D170 — the BENCH-WIDE DAMAGE-COUNTER COUNT, and the sixth
    `DamageCountSource`.** `This attack does 10 damage for each damage counter on
    all of your Benched Pokémon.` — **1 printing / 1 sentence, and the family CLOSES
    at 1/1**, measured against the local D1 (2026-08-03, 978 cards / 6 sets) across
    all three text columns: Tyranitar `swsh10.5-043` "Raging Crash" (idx 0, {C}{C},
    `"10×"`, 10 per counter). The `%for each damage counter%` neighbourhood is 19
    rows; `%on all of your Benched%` is exactly this one.

    ⚠️ **IT IS A NEW COUNT SOURCE ON AN OLD FOLD — D168's ANSWER, ON THE MULTIPLY
    READER.** The sentence carries NO adjective, so its fold is the `×` one
    `deriveAttackDamageMultiplier` has performed since 0.35.0 (the printed "10×"
    base IS the per-unit and attack.ts drops it); the only thing that varies is
    WHICH RESOURCE is tallied. D167 was a new fold on an old source, D168 a new
    source on the ADDITIVE fold, and this is the fourth corner of the same
    two-by-two: **a new source on the MULTIPLY fold.**

    ⚠️ **AND IT IS THE FIRST MEMBER THAT TALLIES OVER A ZONE RATHER THAN OFF ONE
    BODY.** `damageCountersOnYourBench` sums `damage ÷ 10` across every Pokémon on
    the ATTACKER's Bench, so an EMPTY Bench and a pristine one are the same 0 and
    neither Active is ever consulted. It also cost `scaledAttackDamage` **no
    signature change**: `attackerSeat` has been in scope since 0.66.0 for the
    `boardCondition` indicator, and this is the second thing that argument buys.

    ⚠️ **THE SEAT IS THE WHOLE DEFECT SURFACE, SO IT IS DRIVEN FROM EVERY SIDE.**
    This member counts YOUR OWN Bench while the attack that reads it damages the
    OPPONENT — count and target at opposite ends of one swing — where D168's fifth
    member counts the opponent's Active. The suite drives a board with **all four
    zones damaged and all four differently** (attacker's Active 9 counters,
    attacker's Bench 3, defender's Active 5, defender's Bench 7): every wrong zone,
    every pairwise sum and the whole-board total are distinct from the right answer
    of 30, and the mirror board from p2 makes a `defenderSeat` wiring fail on one
    side or the other rather than on neither.

    ⚠️ **NO ORDER WITNESS EXISTS IN THIS FAMILY, AND THE SUITE SAYS SO RATHER THAN
    FUDGING ONE.** D168's transferable finding is that an ordering claim needs a
    witness that does NOT COMMUTE. With the printed base DROPPED this fold has
    exactly ONE term, so `(0 + 60) × 2` and `0 × 2 + 60 × 2` agree **by
    distribution**. The ×2 Darkness board is therefore written as what it really
    witnesses — the **base drop surviving a multiply** (`(0 + 60) × 2 = 120` against
    a leaked `(10 + 60) × 2 = 140`) — and the absence of an order witness is pinned
    as its own assertion.

    **ZERO BENCH COUNTERS EMIT NO `DAMAGE_DEALT` AT ALL**, driven rather than
    discovered: `scaledBase` and `scaledTotal` are both 0, so attack.ts's
    `scaledBase + scaledTotal > 0` guard skips the whole §8.5 pipeline. Rules-correct
    (the attack does 0 damage), **the attack is still USED** so the turn passes, and
    the printed text is still SIMULATED — exactly how D167's printings and
    Stoutland's retreat-0 board already behave.

    Cost: **1 regex, 1 reader arm, 1 `DamageCountSource` member, 1 evaluator arm** —
    the same four-edit shape D168 found, and the same two edits ("one regex + one
    evaluator arm") the remainder list had again omitted. No new op, event, event
    field, log crumb, error code, prompt, park, state field, registry row, redact arm
    or projection, and no web/DB/`@luminous/schema` diff. Plus **1 fixture**
    (`swsh10.5-043`, authored fresh — `FIXTURE_POOL` had ZERO coverage — COMPLETE
    against the manifest, carrying its **UNSIMULATED** idx-1 "Earthquake" self-spread
    as the declared simplification AND as the skipped-sibling witness), **1 deck**
    (`BENCH_COUNTER_DECK`, its own 60), `benchCounterMultiply.test.ts` (**37 tests,
    SEED-FREE**) and the manifest REGENERATED (214 → **215** fixture rows, 0 absent).
    `clauseApostrophe.test.ts`'s census stays **64** — a result, not an omission:
    this sentence carries no apostrophe at all. `MATCH_RECORD_VERSION` stays **11**,
    derived rather than inherited — `DamageCountSource` is a PARSE-TIME type in
    effects.ts that never reaches `GameState`, so a new member cannot make a stored
    record unreadable; pinned as an absence over the 16-key set, now on a BENCHED
    body as well as an Active. */
/** 0.116.0 — **D171, EXP. SHARE `sv01-174`: the LAST unread member of D158's
    KO-antecedent census, and the first card in this engine whose printed sentence
    is borne by a POKÉMON TOOL on a body OTHER than the one the sentence is about.**

      *"When your Active Pokémon is Knocked Out by damage from an attack from your
       opponent's Pokémon, you may move a Basic Energy from that Pokémon to the
       Pokémon this card is attached to."*  (Trainer/Tool, `effect`)

    ⚠️ **THE `koTrigger` SEAM IS A TEMPORAL IMPOSSIBILITY, NOT A WIDENING PROBLEM.**
    `collectKnockOuts` queues every `koTrigger` AFTER `knockOut` has already run for
    the whole batch, and `knockOut` does `discardFromStack(side, side.active,
    "all")` — so by the time any on-KO stage could look, the Energy this sentence
    moves is in the discard pile. `koRecoilOf` IS a genuine before-`knockOut` hook
    (it is why Vengeful Punch works) but it is **SYNCHRONOUS and cannot park**, and
    this consequent is a player's choice. Right point, wrong mechanism.

    **THE SEAM IS A SIBLING OF `damagedTrigger`**: a new `PendingStage`
    `koToolTrigger`, seeded by attack.ts between the damagedTrigger and the
    attackEpilogue, run under the **DAMAGED, non-turn seat** (the KO'd player is who
    chooses), folded through `settleProgram` with `resumeTail` — the park machinery
    that already existed and needed **zero widening**, since `resumeTail` captures no
    KO state at all: its whole contract is *"a PendingStage is sitting behind me"*.
    The printed **"you may"** was free too — optional triggers auto-fire and
    `moveEnergy` is already declinable (an empty pick is a legal answer).

    ⚠️ **THE REAL COST WAS THAT NOTHING IN THE ENGINE RAN A TOOL'S `triggered`
    PROGRAM, AND IT NEEDED A FOURTH DETECTION SITE.** All three existing ones fail
    structurally: `onKnockOutTrigger` reads the KO'd body's TOP CARD (wrong body, and
    never tools); `triggersOf` reads `topCardOf` (a Tool is not a stack top, for ANY
    timing); `passivesOf` is the only site that walks `pokemon.tools` and folds
    `passive` into **numbers** — which is exactly why Vengeful Punch was a data row
    and this is not. So `triggers.ts koToolTriggersOf` is new: *for each of my
    in-play Pokémon, for each attached Tool, is there an `onAllyActiveKnockOut`
    program keyed on ANOTHER body's KO*. It **skips the dying body** (the printed
    sentence names two Pokémon; a self-attached Exp. Share has no destination
    distinct from its source) and takes **no §9 gate** (a Tool is not an Ability —
    `passivesOf` states the same rule, and the Klefki negative is driven).

    ⚠️ **THE ANTECEDENT IS RE-DERIVED AT RUN TIME, NOT AT THE SEED — SO THE STAGE
    CARRIES THE SEAT AND NOTHING ELSE.** It is seeded at damage time on TOOL PRESENCE
    alone, but the printed condition is LETHALITY, knowable only after the attack's
    own effect program. `runKoToolTrigger` re-reads the SUBJECT off the live board
    (the sentence is present-tense about the Active SPOT) and re-asks
    `isLethallyDamaged` — the sweep's OWN predicate, so "this will die" here cannot
    drift from what `collectKnockOuts` decides two stages later, which is
    `koRecoilOf`'s rule one stage out. That is `damagedByAttackAbility`'s idiom
    carried far enough to delete the remembered uid rather than re-validate it. The
    possessive and *"by an attack"* stay free by PLACEMENT, exactly as at D158: only
    attack.ts seeds this, and only for the defender's seat.

    **A THIRD `moveEnergy` ROUTE, `koedActiveToToolHolder`** — the first to pin its
    destination by **UID**: sources are the ACTIVE alone, the sole destination is the
    Pokémon carrying `ctx.sourceUid`, which for a Tool-borne program is the **TOOL's
    own uid**. That needed `toolHolderRef` rather than `sourceRef`: *"the Pokémon this
    card is attached to"* and *"this Pokémon"* are two phrases with two readers, and
    `sourceRef` (a TOP-uid match) returns empty for every Tool. One decision survives
    (WHICH Energy), so the compound prompt, the wire validator and `moveEnergyApply`
    are untouched.

    **TWO GATES THAT BELONGED TO ONE TERM, BOTH FOUND AND BOTH WIDENED.**
    `attachTool` tested `programFor(id)?.passive !== undefined` for *"is this Tool
    simulated"* — true of every Tool that existed and false of this one, so the engine
    would have refused to attach a card it fully simulates. And `ENERGY_MOVED` named
    its source by SPOT under a doc guarantee that *"nothing it names has left play
    when the reduction settles"*; that stopped being true here, so the event gained
    `fromUid?` and the log arm prefers it (on an auto-promoting board the spot names
    the Pokémon that REPLACED the source).

    **`MATCH_RECORD_VERSION` STAYS 11, DERIVED.** `GameState.pending` IS persisted —
    the recon's "a stage is transient" read is factually wrong — but D124's test is
    directional: *can the PREVIOUS deploy's record hold the shape the new code
    expects?* An old record cannot contain a `koToolTrigger` (nothing wrote one) and
    every kind it CAN contain is still handled; the `route` change is a WIDENED ENUM
    on an op that can sit in `phase.cont`, which D124 explicitly excludes; and no
    REQUIRED field was added to anything persisted. `fromUid` rides `GameEvent`, which
    `MatchRecord` does not store (it stores the RENDERED log).

    Cost: 1 `TriggerTiming`, 1 board scan, 1 `PendingStage` kind + its advance arm, 1
    flow runner, 1 `moveEnergy` route + 1 ref helper + 1 prompt arm, 1 optional event
    field + 1 log line, 1 widened `attachTool` gate, 1 registry row (`EXP_SHARE`),
    1 fixture (`sv01-174`) and 1 deck
    (`EXP_SHARE_DECK`, **SEED-FREE** — no coin anywhere in the card). No new event,
    no new log arm, no error code, no `@luminous/schema` diff, no DB diff, no web
    diff. Manifest **215 → 216** fixture rows. */

/** 0.117.0 — **D172, the §12 STATUS-IMMUNITY family: the OTHER half of the Ability
    D159 built, plus the printing that is nothing but this sentence.**

      *"This Pokémon can't be Burned."*      (Dachsbun `sv01-099`, clause 1 of 2)
      *"This Pokémon can't be Paralyzed."*   (Pachirisu `sv01-068`/`-208`)

    ⚠️ **THE FIRST FAMILY IN THIS BATCH WHOSE PRICING WAS WRONG IN THREE PLACES, ALL
    THREE STRUCTURAL.** The catalog claim was EXACT — the census re-derived to **4
    printings / 3 sentences** against 978 rows / 6 sets over all three text columns,
    both numbers, with two `attacks_json` false positives (Vivillon `sv01-010`
    APPLIES a chosen condition, Sableye `sv02-136` READS one) that a narrower sweep
    would have turned into phantom members. What was wrong was everything else:

      1. *"All four clauses are carried VERBATIM on the fixtures and PINNED."* **ONE
         was.** The other three lived in PROSE, in registry.ts and
         attackerFilter.test.ts comments — which no census greps and no test can go
         red on. Two are fixtures now; the third is pinned as an ABSENCE.
      2. *"It gates `applyStatus` AND the Checkup."* **It gates `applyStatus` and
         nothing else.** That site is the engine's ONLY writer of a §12 condition —
         `runCheckup` and the three `noConditions()` sites only ever CLEAR — so a
         body that cannot be given a status cannot arrive at the Checkup carrying
         one. A Checkup gate would be a second reading of one rule (D131) that no
         board could make disagree with the first.
      3. *"One `PassiveEffects` field and one gate."* A **floor**. A gate that
         refuses in SILENCE is D159's own finding wearing a §12 hat, so the slice
         also owes `STATUS_PREVENTED` and its log arm — the FIFTH way this engine
         can null an effect, and the second to be added because someone rendered
         the row rather than read the code.

    **THE FIELD IS A SCALAR AND THE AGGREGATION IS A LIST**, `preventDamageFromType`'s
    shape one field up on the same interface and the same card: every printing names
    ONE condition, while `passivesOf` folds the holder's passive plus every attached
    Tool. ⚠️ The counter-case is real and NAMED rather than absorbed — Therapeutic
    Energy `sv02-193` names THREE — but it is a SPECIAL ENERGY and writes no
    `PassiveEffects` at all, so a list today would pre-pay for a writer that cannot
    reach the field. **Deliberately NOT built**, with its price written on
    `EnergyProgram`: a continuous entry, a THIRD source class in `passivesOf`, the
    §9 exemption stated the other way round, and a RECOVERY mechanism that clears.

    **§9 IS FREE AND UNDRIVEABLE END TO END, AND BOTH HALVES ARE ASSERTED.** Riding
    `passivesOf` buys the Ability-lock gate with no line written — a build that read
    `programFor(top.id)?.passive?.statusImmunity` directly would be shorter and would
    survive Klefki. The lock is DRIVEN live over both printings (with
    `disabledAbilityUids` proved to contain the uid first, D171's rule). What cannot
    be driven is the lock letting a refused condition LAND, and the reason is a
    counting argument over **ACTIVE SPOTS**: every status source is an Active, every
    §9 lock but Spiritomb's is `requiresActive`, Spiritomb narrows to Basic **V**, and
    the immune body must itself be an Active. Three wanted, two available — D159's
    Thundurus finding, recurring on the other pipeline.

    **`MATCH_RECORD_VERSION` STAYS 11, DERIVED.** Nothing reaches `GameState`:
    `statusImmunity` is a CATALOG field, the aggregation is a pure function of the
    live board and is never stamped, and `STATUS_PREVENTED` rides `GameEvent`, which
    `MatchRecord` does not store (it stores the RENDERED log). The dodge was priced
    and REFUSED (D155): a cached flag on `InPlayPokemon` would go stale on an
    evolution, a promotion or a lock arriving.

    Cost: **1 `PassiveEffects` field, 1 `passivesOf` entry, 1 gate at `applyStatus`,
    1 event + 1 log arm**, 2 registry rows on 1 new program (`ELECTRICITY_POUCHES`)
    + 1 field added to `WELL_BAKED_BODY`, 2 fixtures (`sv01-068`/`-208`) and 1 deck
    (`STATUS_IMMUNITY_DECK`). No op, no error code, no prompt, no park, no regex, no
    deriver arm, no redact arm, no `@luminous/schema` diff, no DB diff, no web diff.
    2 re-pointed D159 pins (`attackerFilter.test.ts`), `statusImmunity.test.ts`
    (**49 tests**). Manifest **216 → 218** fixture rows.

    ⚠️ **THREE OF THIS ENTRY'S CLAIMS WERE OVERTURNED BY D174 BELOW** — the scalar
    (widened), the "writer that cannot reach the field" (it can now), and the
    unreachability half of the Checkup argument (it is reachable). Kept as written,
    with the corrections next door: this log is a record of what each slice believed
    it had proved, and a silently edited entry is a decision reversed without a
    trail. */

/** 0.118.0 — **D174, THERAPEUTIC ENERGY `sv02-193`: the §12 family's THIRD SENTENCE,
    its only SPECIAL ENERGY, and the first CONTINUOUS clause this engine reads off an
    attached Energy.**

      *"As long as this card is attached to a Pokémon, it provides {C} Energy. /
        The Pokémon this card is attached to recovers from being Asleep, Confused, or
        Paralyzed and can't be affected by those Special Conditions."*

    D172 priced this at four edits, three in code the family never touches, and every
    one of the four landed. The census held on both numbers (**4 printings / 3
    sentences**, 978 rows / 6 sets, all three text columns, `FIXTURE_POOL` swept
    separately) — ⚠️ **and widening the pattern by ONE verb found a family nobody had
    counted**: `%recovers from%` returns **four more printings** (Gardevoir ex
    `sv01-086`/`-228`/`-245` "Miracle Force", Blissey `sv01-145` "Busybody Nurse"),
    all *"recovers from ALL Special Conditions"*, all DISCRETE, none built. This card
    is the catalog's **only CONTINUOUS recovery**, which is exactly why it needed a
    mechanism instead of a field.

    **THE SCALAR WIDENED — `statusImmunity` → `statusImmunities: StatusName[]`.** The
    repo's rule applied literally (*the unit of SHARING is decided by the READ site,
    the unit of STORAGE by the WRITE sites*): D172 counted TWO writers each naming one
    condition and got a scalar, correctly, on the evidence it had. This is the THIRD
    writer and it names THREE, so the scalar could no longer SPELL a writer. D172
    declined the widening only because the writer "cannot reach the field"; the new
    `EnergyProgram.passive` is what closed that gap, so the reason expired with it.

    ⚠️ **A THIRD SOURCE CLASS IN `passivesOf`, AND THE AUDIT WAS MOST OF THE SLICE.**
    `sources` had been `[the top card's passive, ...the Tools']` since M4 and had
    never walked `pokemon.energy`. All **twelve** folded fields therefore gained an
    attached-Energy contributor at once and each was re-read (the field-by-field
    reading lives beside the `sources` array). Two findings worth the trip:
    `basicHpBonus` and `damageAttacker.requiresTool` carry gates about the HOLDER and
    the BOARD, so an Energy writing either would inherit a condition its own text
    never states; and the **eleven** fields NOT folded here (`disableAbilities`, the
    seat-wide reduction, the retreat/attack-cost auras…) are read by their own board
    scans off `programFor(top.id)?.passive` and are **UNREACHABLE** from an Energy,
    which is what bounds the audit to twelve instead of the interface's twenty-three.

    **§9 STATED THE OTHER WAY ROUND.** D172 got suppression free because a Pokémon's
    printed passive IS an Ability. An Energy is not, so the new source is EXEMPT —
    and the exemption is DRIVEN rather than assumed, on the one board that shows both
    signs at once: a Klefki-locked Pachirisu holding this Energy loses its OWN printed
    immunity and keeps the Energy's, in one `passivesOf` call. Driving it to a LANDED
    condition is still impossible for D172's counting argument over Active Spots,
    re-derived rather than inherited.

    ⚠️ **THE RECOVERY IS A WRITE, NOT A GATE AND NOT A DERIVED VIEW.** *"Can't be
    affected"* is an `applyStatus` gate and D172 built it. *"Recovers from"* is about
    a condition ALREADY THERE, which no gate on the writer can see. And it is not
    `effectiveMaxHp`'s derive-at-the-read-site idiom either, because "recovers" is a
    ONE-WAY change: a body that recovered is not Asleep again when the Energy is
    discarded, but a subtraction at the read sites would bring it straight back. So
    flow.ts `recoverStatuses` genuinely REMOVES, restoring the invariant *no in-play
    body carries a condition a live effect recovers it from* at the **two named
    moments** a source can newly arrive — the §6.2 manual attach (turn.ts) and the
    completion of any effect program (`settleProgram`, which covers
    `attachEnergyFrom` / `attachFromDeck` / `attachFromTop` / `moveEnergy`). Naming
    the moments is §8.1's own arrangement, not a shortcut. ⚠️ **AND TWO IS THE WRONG
    NUMBER — D176 (0.119.0 below) found the other two and wired them.**

    ⚠️ **D172's NO-CHECKUP-GATE CONCLUSION SURVIVES; ITS ARGUMENT NARROWS.** Half of
    that argument — *`applyStatus` is the only WRITER* — is untouched. The other half
    — *"no legal sequence puts an immunity onto a body that already carries the
    condition it refuses"* — is **FALSE as of this slice**: attaching this Energy to a
    Paralyzed Active is exactly that sequence, and it is a printed play. No gate is
    owed anyway, because the only printing that can open the window also CLOSES it in
    the same instant. **The condition under which it would fall is named**: a
    CONTINUOUS immunity with NO recovery clause — an Energy or a Tool saying only
    "can't be Paralyzed" — and the catalog has no such row (all three
    immunity-without-recovery printings are Pokémon Abilities, which arrive with the
    body). ⚠️ **And D172's armed tripwire did NOT go red**, because it was armed in a
    COMMENT: the assertion (a surgically planted Burn on Dachsbun still ticks) is
    still TRUE — an immunity alone clears nothing — while the reasoning beside it is
    now false. **A COMMENT CANNOT GO RED, caught on the slice that rule was written
    for.**

    **`MATCH_RECORD_VERSION` STAYS 11, DERIVED** on D124's DIRECTIONAL test. Nothing
    reaches `GameState`: both new fields are CATALOG (registry.ts types), the
    aggregation is a pure function of the live board and is never stamped, and the
    recovery WRITES an existing `conditions` field rather than adding one. The one
    shape that widened is `STATUS_CLEARED.reason` (a sixth value, "recovered"), and
    it rides `GameEvent`, which `MatchRecord` does not store.

    Cost: **1 `EnergyProgram` field (`passive`), 1 widened + 1 new `PassiveEffects`
    field, 1 third source class + 1 new entry in `passivesOf`, 1 new flow function at
    2 call sites, 1 widened event `reason` + 1 shared log arm**, 1 registry row
    (`THERAPEUTIC_ENERGY`), 1 fixture (`sv02-193`, the pool's first Energy carrying
    its printed `effect`), 1 optional `specialEnergy` param and 1 deck
    (`THERAPEUTIC_ENERGY_DECK`). **No op, no error code, no prompt, no park, no
    `PendingStage`, no regex, no deriver arm, no redact arm, no projection, no
    `@luminous/schema` diff, no DB diff, no web diff.** 6 re-pointed D172 pins
    (`statusImmunity.test.ts` ×5, `attackerFilter.test.ts` ×1), new
    `therapeuticEnergy.test.ts` (**52 tests**). Manifest **218 → 219** fixture rows. */

/** 0.119.0 — **D176, THE RECOVERY SEAM WAS TWO CALL SITES SHORT OF ITS OWN CLAIM.**
    A review slice with no new card, no new field and no new op: D174 shipped
    `recoverStatuses` behind a seam and wrote down *why* a seam beats an enumeration
    (D169's lesson). The seam was right and the enumeration of its MOMENTS was
    incomplete, in the one direction a comment cannot catch — **it claimed coverage
    the code did not have.**

    ⚠️ **"A TOOL OR AN ABILITY WOULD ARRIVE FOR FREE" — TRUE OF THE READ, FALSE OF THE
    MOMENT.** `passivesOf` has folded every attached Tool's passive since M4, so a
    Tool printing `statusRecovery` really is READ for free. But a Tool ARRIVES through
    cardplay.ts `attachTool`, which writes `tools: [...]` and returns `ok` straight
    out — no interpreter program, so neither `settleProgram` nor turn.ts's §6.2 attach
    can see it. The §7.4 attach is the THIRD moment and now carries the call. **The
    ABILITY half of the claim survived, and its reason is now written down instead of
    assumed**: every route by which a body comes to carry its own printed passive
    (evolution, promotion, `switchInto`) runs through `noConditions()`, so there is
    nothing left to recover from. The one uncovered Ability moment is a **§9 lock
    ENDING** over a holder that acquired a condition while suppressed — unreachable in
    this pool, and named rather than left.

    ⚠️ **"EVERY PROGRAM LANDS HERE" WAS TRUE OF EIGHT CALL SITES AND FALSE OF THE
    NINTH.** triggers.ts `runCheckupTriggers` takes `.state` off `runProgram` inline —
    deliberately, because a betweenTurns program may not park — and is the engine's
    ONLY inline program runner. Taking `.state` is exactly what dropped the recovery.
    Fixed by naming the same moment there rather than by routing through
    `settleProgram`, which returns an `ApplyResult` and owns parking, the KO tail and
    the phase: none of them a Checkup trigger may touch. **INSIDE the trigger loop and
    not after it**, so the invariant stays per-PROGRAM and a trigger that attaches an
    Energy cannot leave a stale condition for the next trigger in the same Checkup.

    **NEITHER CHANGES A BOARD IN THIS CATALOG, WHICH IS THE POINT.** No card prints
    `statusRecovery` on a Tool, and the registry's only two betweenTurns programs heal
    (Garganacl) and place a counter (Trevenant). Both fixes make the invariant a
    property of the ENGINE rather than of what the registry happens to contain — the
    same argument D174 used for the seam, applied to the seam's own edges.

    ⚠️ **AND BOTH ARE WITNESSED, BECAUSE A DIFF THAT LEAVES NO ASSERTION EXPIRES
    (D160).** MOMENT 3 attaches **Exp. Share** — chosen precisely because it has NO
    passive (its sentence is a `triggered` program, D171), so it contributes nothing
    to the fold and the recovery observed can only have come from the Energy already
    on the body: the case measures the MOMENT, not a second source. MOMENT 4 runs
    **Garganacl's "Blessed Salt"** from the bench with a NON-VACUOUS CONTROL — the
    same board with no betweenTurns Ability runs the same Checkup and the Confusion
    SURVIVES it (§13 clears Sleep on a flip and Paralysis for the ended seat, never
    Confusion), so the clear came from the program-completion seam and nowhere else in
    the phase. Both boards need `setConditions` surgery and that is UNAVOIDABLE rather
    than lazy: a recovery source on a body still carrying a named condition is exactly
    what the invariant forbids, so no legal sequence builds it. **Mutation-driven:**
    dropping either call turns its case red.

    **THE FOLD'S ARITHMETIC WAS STALE BY ONE IN BOTH DIRECTIONS, AND `statusRecovery`
    IS WHAT INVALIDATED IT.** `PassiveEffects` has **23** fields; `passivesOf` READS
    **12** of them and RETURNS **11** keys (`damageReductionAfterWRIfType` sums into
    `damageReductionAfterWR`, `basicHpBonus` into `hpBonus`); **11** are left to their
    own board scans. The audit said "10 folded / 12 not folded / 22 total" — correct
    BEFORE D174's own new field, and index.ts had folded and not-folded INVERTED on
    top of that. Re-stated at all four sites (continuous.ts, index.ts ×2,
    registry.ts) plus the four in `therapeuticEnergy.test.ts`, each now saying WHICH
    of the two counts it means. **These numbers are the checklist a future slice uses
    to decide which fields need re-reading, so an off-by-one here is a field that gets
    skipped.**

    Also corrected: registry.ts's `onDamagedByAttack` note still said it "runs inline
    like `betweenTurns` rather than through settleProgram" — true at D99, false since
    Klawf ex's parking discard moved it to `runDamagedTrigger` → `settleProgram`.

    Cost: **2 `recoverStatuses` call sites** (cardplay.ts `attachTool`, triggers.ts
    `runCheckupTriggers`), **0 new fields, ops, events, error codes or registry
    rows**; 2 cards into `THERAPEUTIC_ENERGY_DECK` (`sv01-174` Exp. Share, `sv02-123`
    Garganacl, out of `fix-bigbody` 28 → 24 — no seeded case shifted), **+2 tests**
    (`therapeuticEnergy.test.ts` 52 → 54). **No op, no field, no schema diff, no DB
    diff, no web diff, no `MATCH_RECORD_VERSION` bump** — nothing this slice touches
    reaches `GameState`. */
/** 0.120.0 — **D177, THE DISCRETE `recovers from all Special Conditions` FAMILY:
    ONE NEW OP, TWO ENTRY POINTS, AND THE OP-REUSE QUESTION ANSWERED NO THREE
    TIMES.** The family D174 found on its way past and could not build: four
    printings over two sentences, both DISCRETE, both unbuilt.

      "This Pokémon recovers from all Special Conditions."
            (Gardevoir ex sv01-086 / -228 / -245 "Miracle Force" — an ATTACK)
      "Once during your turn, you may use this Ability. Your Active Pokémon
       recovers from all Special Conditions."
            (Blissey sv01-145 "Busybody Nurse" — an activated ABILITY)

    **THE CENSUS WAS RE-DERIVED AND D174's NUMBERS HELD EXACTLY** — 4 printings, 2
    sentences, both DISCRETE, over the local D1 (978 cards / 6 sets, 2026-08-04,
    all three text columns). ⚠️ **AND THE WIDER PREDICATE FOUND A FIFTH ROW NOBODY
    HAD COUNTED, WHICH IS THE SAME LESSON PAYING OUT A SECOND TIME.** Muk sv01-127
    "Poison Sacs" — *"Your opponent's Poisoned Pokémon don't recover from that
    Special Condition when they evolve or devolve."* — the **NEGATIVE form**: a
    modifier on §10's evolution clear, carrying no op and no moment of its own.
    DELIBERATELY NOT BUILT (it is a rule about a clear this op never performs) and
    NAMED in effects.ts + the suite, on D171's Corviknight rule.

    ⚠️ **THE OPEN QUESTION — CAN THE DISCRETE OP REUSE `recoverStatuses`? — WAS
    PRICED AND ANSWERED NO, WITH THREE INDEPENDENT REASONS.** (1) **THE DRIVER IS
    WRONG**: that function is driven off `passivesOf(...).statusRecovery`, a CATALOG
    value contributed by a live CONTINUOUS source; this op has no source, its
    warrant is that it ran, and reuse would mean writing a synthetic passive onto
    the board so a function could read it back off. (2) **THE SCOPE IS WRONG**: it
    is a TWO-SEAT board sweep restoring a board-wide invariant; this is one body
    named by the printed subject at one moment. (3) **THE SET IS WRONG**: its
    per-condition filter is what makes sv02-193 wake a body and leave its Burn
    ticking, and "all Special Conditions" names nothing to filter — so
    `noConditions()` is the whole clear, the same call turn.ts's retreat and evolve
    clears already make. **What IS shared is the VOCABULARY**: both halves announce
    `STATUS_CLEARED` with `reason: "recovered"`, one log arm for one printed verb.

    ⚠️ **ONE OP AND NO FIELDS, WHICH IS D104's MINIMAL SHAPE AND HERE IT IS
    LOAD-BEARING.** No `target` — "This Pokémon" in an attack program and "Your
    Active Pokémon" in an Ability program are the SAME expression,
    `state.players[ctx.seat].active` — and the only sentence a `target` would admit
    ("your opponent's Active Pokémon recovers…") is one no card would print, since
    recovery is upside. No `statuses` — "all" is the printed quantifier over the
    closed `StatusName` union, where `statusRecovery` must carry a list because its
    printing NAMES three.

    ⚠️ **THE TWO HALVES ANSWER §9 DIFFERENTLY, ON ONE BODY.** Under a live Klefki
    lock the same Gardevoir ex is refused `Psychic Embrace` and still recovers
    through `Miracle Force` — an attack is not an Ability — so the suppression
    question belongs to the ENTRY POINT and there is no §9 check in the op at all.

    ⚠️ **AND THE ATTACK HALF CAN NEVER REACH TWO OF THE FIVE CONDITIONS IT NAMES.**
    Asleep and Paralyzed block DECLARING an attack (§8), so a Gardevoir carrying
    either never runs its own recovery; the ABILITY half reaches all five, because
    `turnGate` does not read conditions. That is the rulebook rather than a gap, and
    it is asserted rather than commented — it is exactly the claim a later slice
    would "fix" by moving the clear to declaration time.

    ⚠️ **THE D173-CLASS PREREQUISITE WAS REAL AND IT WAS THE SHARPEST FINDING.**
    Gardevoir ex sv01-086 sat in `FIXTURE_POOL` with an EMPTY `attacks` array,
    declared in `catalogManifest.test.ts`'s `INCOMPLETE` with the reason "registry
    activated Ability … same section comment" — a true statement about the SUITE and
    a false one about the CARD. **For the length of that declaration a FIXTURE_POOL
    census could not see its own subject** while the catalog census could. Fixed,
    not re-declared (the seventh entry struck out on D173/D175's rule), and the two
    reprints joined it so the text-keyed deriver claim is DRIVEN rather than pinned.

    Cost: **1 op** (`clearStatus`, field-free), **1 deriver arm + 1 anchor**
    (`SELF_RECOVERS_ALL`, covering all three ATTACK printings — the seam is
    TEXT-keyed, so the reprints need no registry row), **1 interpreter arm +
    implementation**, **1 registry row** (`BLISSEY`), **4 fixtures** (sv01-086 gains
    its printed attack; sv01-228 / sv01-245 / sv01-145 are new) and **1 deck**
    (`CLEAR_STATUS_DECK`). **No new field, event, error code, prompt, park,
    `PendingStage`, log arm, redact arm, projection, `@luminous/schema` diff, DB diff
    or web diff.** New `clearStatus.test.ts` (**36 tests**). Manifest **219 → 222**
    fixture rows (the sqlite's recorded mtime moved 2026-07-26 → 2026-08-03 with
    every count unchanged — the D160 checkpoint, measured rather than assumed).
    ⚠️ **NO `MATCH_RECORD_VERSION` BUMP, AND A NEW OP USUALLY OWES ONE**: a parked
    program lives inside `GameState.phase`, so an op that can park changes what a
    record holds. This one CANNOT park — synchronous, field-free, single-step, and
    neither producer wraps it in anything that parks — so no record written by the
    previous deploy can hold it and none this deploy writes can either. It stays
    **11**. */
/** 0.121.0 — **D180, THE REPRINT-ALIAS GAPS — AND THE SESSION THAT COULD NOT
    RE-MEASURE ITS OWN WARRANT.** Four printings whose byte-identical twin was
    already authored, on card ids the registry map did not name: `sv02-245`
    Copperajah ex (`sv02-150` was registered), `swsh10.5-069` Rare Candy
    (`sv01-191`/`-256` were) and `swsh10.5-078` + `swsh10.5-084` Professor's
    Research (`sv01-189`/`-190`/`-240`/`-241` were). Four map rows onto three
    EXISTING `CardProgram` objects, using the reprint idiom the map has carried
    since M4 — no new op, field, program, event, park, fixture or deck.

    ⚠️ **AMENDED AFTER THE FACT (same decision, D180's follow-up): ALL FOUR
    PRINTINGS ARE NOW MEASURED AND ALL FOUR HOLD**, byte-identical to their twins
    against the 978-row / 6-set catalog reached through the remote D1 — `sv02-245`
    on "Bronze Body", `swsh10.5-069` on Rare Candy's paragraph,
    `swsh10.5-078`/`-084` on "Discard your hand and draw 7 cards." ⚠️ **AND ALL
    FOUR IDS ARE ROTATED OUT OF STANDARD** (`swsh10.5` is mark F, 0 of 88 legal;
    `sv02` is mark G), so this slice serves **zero Standard-legal printings** —
    which is not a reason to revert four correct map rows, but IS the reason a
    registry row and a deriver arm must never be priced on the same scale: an arm
    is a text parser whose sentences transfer across sets (D181's four serve 34
    Standard-legal printings), a row is keyed by CARD ID. The paragraph below is
    kept as the record of how it SHIPPED, because how a claim was warranted at the
    time is the thing this repo keeps losing.

    ⚠️⚠️ **AS SHIPPED, THE BYTE-IDENTITY WAS ASSERTED FROM A DOC, NOT MEASURED.** `apps/api/.wrangler/` is gitignored
    dev state and DOES NOT EXIST in a fresh clone; this slice ran in one
    (`find / -name '*.sqlite'` → zero rows, and `scripts/catalog-manifest.ts
    --check` dies SQLITE_CANTOPEN rather than reporting staleness). It could not
    be rebuilt either — `apps/api/scripts/ingest.ts` fetches `api.tcgdex.net`,
    and the environment's network policy answers **403 to the CONNECT**. So the
    text-equality sweep of unbuilt-against-built over all three columns — the
    sweep that produced the backlog's "3 sentences / 4 printings and nothing
    else" — **was NOT re-run.** ⚠️ **AND IT STILL HAS NOT BEEN**, by anyone: the
    four rows are measured individually, the SWEEP that says there are no OTHERS
    is not. It is runnable now; nobody has run it. `reprintAlias.test.ts` carries
    the exact query the next session should run rather than a pin nobody earned.

    ⚠️ **AND NO "THE SWEEP IS EMPTY" ASSERTION WAS WRITTEN, DELIBERATELY.** The
    repo prefers pinning an emptiness to enumerating exceptions — but a pin that
    claims a measurement nobody made is worse than no pin at all: it goes green
    forever while asserting something this session never checked. D155's rule
    has a converse and this is it. What IS pinned is (1) the ALIAS RELATION,
    `toBe` on the shared program object rather than `toEqual` on a copy; (2) the
    TWINS' printed text char-for-char off `FIXTURE_POOL`, so a re-ingest that
    moves the anchor voids the alias loudly; (3) the text-equality sweep
    RESTRICTED to `FIXTURE_POOL`, which IS runnable, IS empty, and STATES ITS OWN
    SCOPE — ~200 of the catalog's 978 rows, i.e. a FLOOR that says nothing about
    the other three quarters, and one that cannot see any of the four aliased ids
    (none is a fixture, and none can become one until the manifest is
    regenerable). ⚠️ Its read predicate is PER-COLUMN, not per-id: the first draft
    asked only "does `programFor(id)` exist" and reported two FALSE POSITIVES
    (Heracross `sv01-002` vs Spidops ex `sv01-019`; Scovillain `sv01-029` vs
    Armarouge `sv01-041`) where the shared sentence is an attack the DERIVER
    reads on both sides and the registry program belongs to an Ability.

    Cost: **4 registry map rows**, new `reprintAlias.test.ts` (**9 tests**). No
    fixture added → manifest untouched (and unregenerable). **NO
    `MATCH_RECORD_VERSION` BUMP**, derived rather than assumed: a registry row is
    a lookup keyed by card id, not a persisted shape. Nothing here adds or
    removes an op, so no `EffectOp` inhabitant moved; nothing parks, so no
    `EffectPrompt`, `EffectChoice` or `EffectContinuation` shape moved; no
    `GameState` field, no event, no error code, no `@luminous/schema` diff. What
    changed is which ids the map ANSWERS FOR — a value question, not a shape one.
    It stays **11**. */
/** 0.122.0 — **D181, THE TRAINER-PATH OPS PRINTED AS ATTACK TEXT — AND THE
    BACKLOG ROW WHOSE PRICE WAS WRONG.** Four families the engine has executed on
    the Trainer path since M4 and had no ATTACK reader for. Three of them are
    D132's inventory rule with nothing left over — four anchors, four `return`s,
    and no interpreter, park, prompt, event, log, redact or registry diff:

      "Draw a card." / "Draw 2 cards."                        → `drawCards`
      "Draw cards until you have 7 cards in your hand."       → `drawUntilHandSize`
      "Switch in 1 of your opponent's Benched Pokémon to the
       Active Spot." (bare, and behind a coin)                → `gust`

    **THE CENSUS WAS RE-DERIVED AND EVERY BACKLOG FIGURE HELD EXACT** over
    `json_each(attacks_json)` at six-set scope — draw 12/2, draw-until 3/1,
    self-switch 9/3, gust 4/2 — and two of its GENERALISATIONS did not: the draw
    family's sentences are "Draw a card." (×7) and "Draw 2 cards." (×5), and the
    draw-until N is always **7**. Both arms stay parameterised, because the
    TRAINER path already prints other counts on the same ops.

    ⚠️⚠️ **THE SELF-SWITCH FAMILY IS NOT BUILT, AND THAT IS THE SLICE'S FINDING.**
    The backlog priced "Switch this Pokémon with 1 of your Benched Pokémon."
    (9 printings) at ONE REGEX AND ONE `return`, on the ground that `switchActive`
    already exists. It does. **The op is not the price.** `finishAttack` addresses
    the Attacking Pokémon as `players[attackerSeat].active`, which is sound only
    because nothing between the §8.5 hit and the epilogue can swap that seat's
    Active — and `switchActive` is the one op that can, having lived in exactly
    one `trainer:` program (Switch `sv01-194`) no attack could invoke. Derived
    from ATTACK text, the §8.1 KO-conditioned recoil (Vengeful Punch `sv03-197`)
    lands its counters on the body that was just PROMOTED. **This is not a
    deduction**: `vengefulPunch.test.ts` SWEEPS it, names the repair in advance —
    hand `finishAttack` a uid, i.e. a REQUIRED field on the `attackEpilogue`
    `PendingStage`, which rides `GameState.pending` and is PERSISTED, i.e. a
    `MATCH_RECORD_VERSION` bump — and this slice is the first to turn it red. The
    other 2 printings ("**You may** switch…") need an optional wrapper the
    vocabulary does not have (`choosePokemon` has no `declinable`;
    `damageChosen.optional` rides a different prompt kind), queued as **D186**.
    Both blockers are PINNED in the suite against a fixture that carries all three
    unread sentences and goes loud on each.

    ⚠️ **A COUNT WITHOUT A POPULATION *AND* A LEGALITY IS NOT A FACT** — a second
    axis this repo's SCOPE discipline has never had. The six-set 978-row catalog
    every census here is measured against is **rotated out**: legality tracks the
    regulation mark exactly (Standard = H and I, plus Basic Energy), and only 127
    of those 978 rows are Standard-legal. A deriver arm is a TEXT PARSER and the
    sentences transfer, so these four anchors serve **34 measured Standard-legal
    printings** against 19 in the six-set catalog. Both numbers are carried on
    every row of the suite's clause table; an unmeasured legal count is `null`,
    never zero.

    ⚠️ **THREE FALLOUT SUITES, EACH A REAL CONSEQUENCE RATHER THAN A COUNT EDIT.**
    `preventBlock.test.ts`'s TOTAL op classification demanded a §11 verdict for
    all three new ops (`drawCards`/`drawUntilHandSize` untouched — the actor's own
    deck and hand; **`gust` untouched too**, and not as a judgement call: this very
    file has DRIVEN Boss's Orders against a live block since D142, and a `blocked`
    verdict would make the clause's only reachable early clear unreachable), each
    with a driven probe. `flipGatedOp.test.ts` had transcribed the gated gust
    VERBATIM off the local D1 at D134 as a row "this reader has no op for" — it was
    RE-POINTED per its own standing note, never deleted, leaving three live LOUD
    witnesses. `clauseApostrophe.test.ts`'s U+2019 census moved 65 → 67, from a
    source no earlier entry had: a REGEX rather than a fixture.

    Cost: **4 anchors + 4 deriver arms**, 1 fixture (`fix-trainerops`, 8 attacks —
    5 built, 3 deliberately unread), 1 deck (`TRAINER_OPS_DECK`), 3 classification
    rows + 3 probes, 2 re-pointed pins. New `derivedDrawAndGust.test.ts`
    (**38 tests**). No new op, field, event, error code, prompt, park,
    `PendingStage`, log arm, redact arm, projection, registry row,
    `@luminous/schema` diff, DB diff or web diff. Manifest untouched (the fixture
    is synthetic `fix-*`). ⚠️ **NO `MATCH_RECORD_VERSION` BUMP, DERIVED RATHER THAN
    ASSUMED**: every op produced here already existed as an `EffectOp` inhabitant,
    so no persisted union moved — what widened is which values are REACHABLE from
    the attack seam, which is D125's widening-not-a-missing-field distinction. Two
    of them PARK, and that is the check worth naming: `gust`'s `choosePokemon`
    prompt and `EffectContinuation` shape are byte-identical to the ones Boss's
    Orders has parked since M4, so a record written by the previous deploy reads
    back unchanged. It stays **11**. */
/** 0.122.1 — **D184, `matchesFilter` LIFTED TO `cards.ts` — A MOVE AND AN
    `export`, NOTHING ELSE.** The pure card predicate behind every pile scan
    (searchDeck / lookAtTopN / discardPileRetrieval) was a bare unexported
    function in `interpreter.ts`. Its body is now in `cards.ts` beside
    `energyProvidesOf` **byte-for-byte** (verified by diffing the extracted old
    and new bodies — the only delta is the `export` keyword), its six
    dependencies were already exported from `cards.ts`, and `interpreter.ts`
    imports it from there. `matchesAttached` **STAYS** in `interpreter.ts`: it
    takes `GameState` + `InPlayPokemon` and answers a different question (§6.5).

    **Enabling work, zero behaviour change.** A coming slice adds a
    damage-scaling count source that tallies discard-pile cards matching a
    `CardFilter`; that consumer lives in `attack.ts`, which must not import
    `interpreter.ts` to ask a pure question about a card, and the repo forbids a
    second answer to an answered question. This is the precondition, taken alone
    so the behaviour slice lands against an unmoved predicate.

    **NO CYCLE — CHECKED, NOT ASSUMED.** `cards.ts` gains
    `import type { CardFilter } from "./effects"`. That closes a ring in the TYPE
    graph — cards → effects → events → cards, since `events.ts` imports
    `type { DamageModifier }` back from here — but **every edge of it is
    `import type` and is erased**, so the ring does not exist at runtime. Walked
    the whole 21-module engine graph with the TypeScript compiler API, counting
    only imports that survive erasure (dropping `import type` and all-`type`
    named clauses): `cards`'s sole runtime dep is `actions`, and `effects` and
    `events` have **none**. The one runtime SCC in the package is the
    pre-existing `flow ↔ triggers` pair, untouched here.

    **PATCH, not minor, and not nothing.** D150's no-bump precedent covers a
    TEST-ONLY slice, and the 0.117.0 holds covered slices whose every
    production edit was a COMMENT. This is neither — real code moves between two
    shipped modules and the package's internal export surface grows — so it
    takes the 0.103.0 → 0.103.1 precedent, which chose a PATCH precisely because
    that slice touched shipped sources rather than only a test file.
    **NOT re-exported from `index.ts`**, deliberately: the sole future consumer
    (`attack.ts`) is inside the package, nothing outside it references
    `matchesFilter`, and the public API is not widened on speculation.

    **NO `MATCH_RECORD_VERSION` BUMP — DERIVED.** A `MatchRecord` persists
    `{version, seed, startedAt, state: GameState, log, names}`, so the version
    moves when a persisted SHAPE moves: a `GameState` field, an `EffectOp`
    inhabitant (a parked program lives in `GameState.phase`), an
    `EffectPrompt`/`EffectChoice`/`EffectContinuation`, an event or the wire.
    This slice moves a FUNCTION between modules. No `CardFilter` arm changed, no
    op was added or removed, nothing parks, no `GameState` field, no event, no
    error code, no `@luminous/schema` diff — and a predicate is code, never
    serialized into a record. Because the body is byte-identical, a record
    written by the previous deploy replays identically under this one. It stays
    **11**. */
/** 0.123.0 — **D189, THE ATTACK EPILOGUE LEARNS WHO ATTACKED — AND THE
    SELF-SWITCH FAMILY D181 PRICED, REFUSED AND HANDED FORWARD.** Two slices in
    one, in the order the first one specified: pay the price, then buy the thing.

    ⚠️⚠️ **THE DEFECT, AND IT WAS PINNED RED IN ADVANCE BY THE SLICE THAT REFUSED
    TO CAUSE IT.** `finishAttack` addressed the Attacking Pokémon as
    `players[attackerSeat].active`. Sound only while nothing between the §8.5 hit
    and the epilogue could swap that seat's Active — an ACCIDENT OF THE REGISTRY
    (`switchActive` lived in exactly one `trainer:` program, Switch `sv01-194`,
    that no attack could invoke) rather than a rule, and swept as such by
    `vengefulPunch.test.ts` since D158: *"no attack program — derived OR authored —
    can move its own actor off the spot."* D181 measured that deriving the printed
    self-switch would turn that sweep red, named the repair in writing, and
    **stopped**. D189 turned it red on purpose and made **that** repair:

      • `finishAttack(state, events, attackerSeat, **attackerUid**)`;
      • `PendingStage.attackEpilogue` gains a **REQUIRED** `uid: string`;
      • the recoil is placed by `addDamageByUid`, which finds the body across
        **Active AND Bench** — because a self-switched attacker is standing on its
        own Bench when the epilogue runs and is still the Pokémon that attacked.

    ⚠️ **`MATCH_RECORD_VERSION` 11 → 12, AND IT IS THE FIRST OF THE TWELVE THAT IS
    NOT AN `InPlayPokemon` FIELD.** `pending` is a `GameState` field, `GameState`
    is `MatchRecord.state`, and a version-11 record saved MID-ATTACK (the effect
    program parked — precisely and only when that stage exists) carries
    `{ kind, seat }` and no `uid`. The soft landing was REFUSED for the tenth time
    and for a reason specific to this field: an optional `uid` would read back as
    "fall back to the Active", which is **exactly the defect**, so the type would
    carry the bug as a supported inhabitant rather than as history. Nothing else
    moved with it — `readMatchRecord` needs no arm (the version gate IS the check;
    a mismatch is `stale`, D165's precedent), no `@luminous/schema` diff
    (`PendingStage` is never projected; `koParkActiveSeat` keys on `kind`+`seat`),
    no new `EffectOp`, prompt, choice, continuation, `InPlayPokemon` key, event or
    log wording.

    **THEN THE FAMILY.** Two anchors, two `return`s: `"Switch this Pokémon with 1
    of your Benched Pokémon."` → `switchActive`, bare and behind
    `Flip a coin. If heads,`. **7 of the family's 9 six-set printings**, and — the
    number that matters — **7 Standard-legal ones against 0 at six-set scope**,
    which is the sharpest instance yet of D181's own pricing rule (an arm is a TEXT
    PARSER; a registry row is keyed by card id). The gated printing's legal count
    was the cell D181 carried as `null`; D189 MEASURED it and it is **0** (its one
    printing, Bramblin `sv02-022`, is regulation mark G).

    ⚠️ **THE SEAM'S EARLY RETURNS WERE ENUMERATED, AND ONE OF THEM WAS NEWLY
    REACHABLE.** `parkOrForce`'s zero-candidate arm was UNREACHABLE from the
    Trainer path — `programPlayable` refuses to PLAY a `switchActive` Trainer with
    an empty Bench — and is reachable and CORRECT from the attack path, because §8
    declares an attack against its Energy cost and never against whether its effect
    can accomplish anything. Driven (the attack is used, the turn ends, nobody
    moves, and nothing is flagged unread), with the Trainer seam's refusal asserted
    on the same board so the difference is a fact about the SEAM, not about the op.

    ⚠️ **AN ORDERING WITNESS THAT DOES NOT COMMUTE.** "The effect program runs
    before the §8.1 epilogue" is proved on a board where the two orders differ in
    the SHAPE OF THE TURN TAIL rather than only in which body took counters: a
    LETHAL recoil after a self-switch Knocks the attacker Out **on the Bench**, so
    the attacking seat's Active is the promoted survivor and that seat is **never
    asked to promote**. Run the epilogue first and it dies in the spot, forcing a
    `promote` stage and a `ko:promote` interrupt.

    ⚠️ **AND D181'S FIXTURE WAS MISSING THE PRINTED SHAPE THE FAMILY MOSTLY HAS.**
    Its `Slip Away` prints no damage — so no board existed on which an attacker's
    own hit could KO a body that then pays a recoil, i.e. the defect had nowhere to
    happen. Measured: of the 20 remote printings of this sentence **14 print a
    damage number** and only 6 do not. `fix-trainerops` gains a NINTH attack
    (appended, never inserted — indices 0-7 are addressed by constant): "Spin
    Turn", {C}, 10, modelled on Murkrow `sv02-131`. Synthetic `fix-*` deliberately:
    the manifest generator reads a `.wrangler` sqlite that does not exist in this
    container, so a real-card fixture could not be added at all.

    Cost: 2 anchors + 2 deriver arms, 1 required `PendingStage` field, 1
    `finishAttack` parameter, 1 helper (`addDamageByUid`), 1 fixture attack, 1
    classification row + 1 probe (`preventBlock.test.ts`), 4 stage-shape assertions
    updated across the engine and 1 in the web projection. `vengefulPunch.test.ts`'s
    addressing sweep is **INVERTED rather than deleted** — it now asserts
    `switchActive` IS reachable from attack text and drives the epilogue surviving
    it, because an invariant deliberately broken must not leave a green test still
    claiming it holds. **D186 (the generic confirm-park for "You may switch…", 2
    six-set / 3 Standard-legal printings) IS UNTOUCHED and still pinned loud.** */

/** 0.123.0 → 0.124.0, **WITH NO VERSION OF ITS OWN** — **D190, THE
    STANDARD-LEGAL REGISTRY PASS (TIER 0 + TIER 1): 25 PRINTINGS FIELDED, 18
    DROPPED WITH THE MISSING ENGINE PIECE NAMED.** Two commits (`ebd91b2`,
    `45001fa`), landed between D189's block above and D193's below. It carries no
    version because `index.ts` and `packages/engine/package.json` were both held
    by a concurrent slice when it finished and must move in step — the block was
    owed at merge and is written here by D192, which owns the file.

    **TIER 0 — the reprint-alias map.** 22 id→program rows onto NINE
    already-authored programs (Copperajah ex's −30, Stonjourner's −20,
    Counterattack Quills, Scorching Armor, Hariyama's seat-wide −10, Nemona's
    draw 3, Janine's Secret Art, Energy Retrieval, Pokégear 3.0), in the reprint
    idiom the map has carried since M4. **No code**: no op, no field, no program.
    The text-equality sweep D180 asked the next session to run was RE-RUN rather
    than carried — remote D1, per-COLUMN read predicate — and matched the census
    exactly: 9 sentences, 22 legal printings, nothing else in any of the three
    columns; `attacks_json` returns one group with ZERO legal printings, so "no
    attack aliases exist" holds too. FOUR candidate sentences were SKIPPED for
    measuring **0 legal printings**, the biggest being "Discard your hand and draw
    7 cards." (11 unbuilt catalog printings, 0 legal — the modern Professor's
    Research reprints are all mark G), and all four are asserted as unbuilt.

    **TIER 1 — the registry-only programs.** 3 programs / 11 Standard-legal
    printings, each its own const rather than the shared object the Tier-0 idiom
    suggests (they are near-twins, not byte-identical, and sharing would let a
    later edit to Armarouge or Tinkaton silently move a card that never printed
    those words): Poison Point (Roselia sv05-008, Roserade sv05-009, Scolipede
    sv10.5b-056/-134), "Trade" (N's Zoroark ex sv09-098/-175/-185/-189) and "Metal
    Bridge" (Archaludon sv07-107/-155, sv08.5-070).

    ⚠️ **AND THE FINDING IS WHAT DID NOT LAND.** The census names SEVEN Tier-1
    programs across 29 printings as needing no new engine code. Re-derived op by
    op, **FOUR do — 18 of the 29 printings, a 62 % over-price** — and every one
    would have been a SILENT NARROWING of a printed rule rather than a crash, so
    nothing in the suite would have caught it. *EXACT MAP OR FLAG*: a registry row
    has no deriver behind it to refuse what it cannot parse. Carmine needs a
    first-turn-Supporter exemption flag (the census called the clause inert; the
    lock has existed since M4 and would REFUSE the card on the one turn it is
    printed to be legal on); Teal Mask Ogerpon ex needs a SELF target and a
    `recordAs` slot on `attachEnergyFrom`; Iono's Kilowattrel needs `from:"self"`
    on `discardEnergy`; N's Plan needs `moveEnergy`'s single-source coupling
    relaxed. All 18 ids are asserted AS UNBUILT with their missing piece.

    The three landed programs are driven through the real engine on three
    synthetic `fix-*` demonstrators declared INSIDE the test file against a
    locally-composed `createGame({cardPool})` — `testFixtures.ts` untouched, no
    real-card fixture added, because `catalogManifest.ts` is generated off the
    LOCAL sqlite (absent here) and measures a 978-row / 6-set catalog holding none
    of sv05/sv07/sv08.5/sv09/sv10.5b. Eleven mutants across the two commits, all
    killed. `MATCH_RECORD_VERSION` stayed **11** (its value at the time): a
    registry row is a map lookup keyed by card id, and although three of the nine
    Tier-0 programs park, `EffectContinuation` carries `{pendingOp, rest, ctx,
    record}` — the OPS themselves, never a card id — and every op involved had
    already shipped. Cost: 2 test files (`reprintAliasLegal.test.ts`,
    `registryOnlyPrograms.test.ts`), 158 registry lines, no engine code. */

/** 0.124.0 — **D193, THREE COUNT SOURCES THAT COUNT BODIES AND ENERGY — AND A
    FOURTH DROPPED FOR A REASON THAT IS THE MOST USEFUL THING HERE.** The seventh,
    eighth and ninth `DamageCountSource`: `bothSidesBenchCount` (bodies on both
    Benches, ADD only), `opponentBenchCount` (bodies on the defender's, BOTH folds)
    and `energyOnOpponent` (`{zone, energyType}` — the opponent's attached Energy
    over the Active or the whole board, BOTH folds).

    ⚠️ **THE PRICE, RE-DERIVED AND CONFIRMED AGAINST THE FILE.** A new source is
    NOT "one regex + one evaluator arm". It is **union member + evaluator arm +
    regex const + reader arm**, and a BOTH-fold member is **two regexes and two
    reader arms — six edits**. Measured: `bothSidesBenchCount` 4, `opponentBenchCount`
    6, `energyOnOpponent` **7** — one over, because its MULTIPLY pattern carries a
    zone alternation the ADDITIVE one cannot (the additive board spelling is
    UNPRINTED) and the shared type-token resolver `attachedEnergyFilter` is a
    seventh edit. Plus **one widening outside the family**: `countEnergyInPlay`
    (continuous.ts) had no `null` arm and the untyped board reading is real
    (3 legal printings), so it gained one — additive, no existing caller can
    observe it.

    ⚠️ **EVERY COUNT WAS WRONG SOMEWHERE, AND THE POPULATION IS WHY.** Re-measured
    against the D1 (2026-08-04): 3,786 rows, **2,021 Standard-legal**; the six-set
    census population is 978 rows of which only **127** are legal. The family:
    `bothSidesBenchCount` **5 legal / 0 six-set**, `opponentBenchCount` **6 / 4**,
    `energyOnOpponent` **17 / 3**. The sharpest correction is inside this file:
    D170's BENCH_COUNTER_MULTIPLY block names Oinkologne ex sv01-158/-234 and
    Tyranitar sv02-135/-222 printing *"…30 more damage for each of your opponent's
    Benched Pokémon."* as the unread near-miss — that sentence is 9 printings and
    **0 legal**. The additive fold in the legal pool is carried by the `20 more`
    spelling (4 legal). The comment is left standing, because it is still true of
    the population it was measured on.

    ⚠️ **A FOURTH MEMBER WAS SCOPED, BUILT, MEASURED AND REVERTED.** `energyOnSelf`
    ("…for each [{X}] Energy attached to this Pokémon.", **21 buildable legal
    printings** — the biggest of the four) is BLOCKED, not unpriced. Entei
    sv03-030's "Blaze Ball" has been this engine's canonical UNSIMULATED-"+"
    witness since 0.35.0, and its sentence is exactly one of these printings.
    Building the member turns **5 assertions across 4 test files red**
    (`scaledDamage`, `perEnergyFlip`, `log`, `checkup`) — measured by implementing
    it, running the suite and counting, then reverting. The witness has an obvious
    replacement (*"…30 more damage for each Energy attached to BOTH Active
    Pokémon."*, 10 printings / **8 legal**, ADD-only) which is ALSO the largest
    unbuilt member this slice found. Re-homing then building is one slice.

    ⚠️ **AND TWO OF THE RECON'S COUNTS WERE THE RAW SENTENCE COUNT, NOT THE
    BUILDABLE ONE.** `energyOnSelf`'s 23 is 21: one row is a two-sentence printing
    the anchor refuses, one filters on `Basic Energy` — a card CATEGORY, not a type,
    which resolves to nothing and stays LOUD. `energyOnOpponent`'s 17 IS 17, because
    its category row filters on `Special`, which `CLAUSE_ENERGY_TOKENS` already
    resolves.

    **BOTH RETIRED TRAPS CONFIRMED AND STOPPED.** The *"each extra Metal Energy …
    can't add more than 120 damage in this way"* cap is **0 legal** (no cap built);
    spelled-out energy words are **0 legal** (the dual-notation arms are kept — they
    are shared with the clause and coin families — and recorded as NOT load-bearing).
    Three excluded neighbourhoods re-asserted onto their existing paths: the 3 legal
    SNIPE scales (`damageChosen`), the 3 legal counter-PLACEMENT scales, and
    `AttackFlipCount.attachedEnergy` (D128).

    ⚠️ **ORDERING: ONE WITNESS, THREE PINNED ABSENCES.** The additive fold gets a
    witness that does not commute — a Fire attacker into a ×2-Fire defender, where
    `(20 + 60) × 2 = 160` and `20 × 2 + 60 = 100`. The `×` fold **cannot have one**:
    it drops the printed base, so the sum has ONE term, and `DAMAGE_DEALT` says so
    in its own shape (`base: 0`, the whole term in `scaled`) — pinned as an absence
    rather than written as a board that passes while asserting nothing. "Read at
    declaration" is likewise unobservable here: no sentence in the family removes a
    body from a Bench or an Energy from a Pokémon.

    **MIRROR WITNESSES, because three of these members mirror another.** 3 bodies
    on the attacker's Bench and 1 on the defender's makes both-sides **4**,
    opponent-only **1** and the attacker-only mutant **3** — three distinct numbers
    on one board. 2 Energy on the defender's Active and 3 on its Bench makes the
    active zone **2**, the board zone **5** and the attacker's own **1**. 12 mutants
    were run, each copying a neighbouring arm's REAL code; **0 survived**.

    `MATCH_RECORD_VERSION` **stays 12**, derived rather than inherited:
    `DamageCountSource` is a PARSE-TIME type produced from card text and consumed in
    the same tick — no `GameState` field, no `PendingStage`, no schema projection,
    no redaction, and `scaledAttackDamage`'s switch is the repo's only dispatch over
    it. No new `EffectOp`, so nothing new can park in `GameState.phase` (D189's
    bump condition); `countEnergyInPlay`'s widened parameter is D181's
    reachability-widening precedent. `apps/api` is untouched.

    ⚠️ **AND `clauseApostrophe.test.ts`'s CENSUS MOVED 67 → 74**, which is that
    sweep behaving exactly as advertised and is attributed row by row there rather
    than bumped: 3 from `fix-benchcount`, 4 from `fix-oppenergy`, all carrying
    D143's "your opponent's" possessive. Two of the seven expose a slot shape no
    earlier row has — "Herd Charge"'s apostrophe is followed by a `)` inside a
    parenthesised clause the pattern carries as ESCAPED literals, and the two
    board-zone rows are one regex with its optional type capture absent and
    present. `fix-benchcount`'s fourth attack carries a real contraction and adds
    NOTHING, because the sweep admits only sentences a reader RESOLVES and that
    self-spread is unsimulated — D170's result, repeating.

    Cost: 3 union members + 1 `OpponentEnergyZone` type, 3 evaluator arms + 1
    `benchBodies` helper, 5 regex consts, 5 reader arms, 1 token resolver, 1
    `countEnergyInPlay` widening, 2 SYNTHETIC fixtures + 1 deck, 1 test file (37
    tests) + 1 census attribution. Synthetic `fix-*` deliberately: the manifest generator reads a
    `.wrangler` D1 that does not exist in this container (`SQLITE_CANTOPEN`), so a
    real-card fixture could not be diffed against its printing at all. */

/** 0.125.0 — **D192, MAIN-HIT DAMAGE-MODIFIER SUPPRESSION: THREE BOOLEANS, ONE
    SHARED READ SITE, TWO STORES.** The §8.5 pipeline's first sentence that removes
    STEPS rather than moving numbers. `AttackDamageSuppression {weakness?,
    resistance?, targetEffects?}` — a FOURTH deriver beside
    `deriveAttackDamageBonus`/`…Multiplier`/`…Penalty` — plus
    `PassiveEffects.suppressTargetEffectsOnAttack`, the ABILITY half, meeting the
    attack half at exactly one `||` in `attack()`.

    ⚠️ **EVERY COUNT RE-MEASURED (remote D1, 3,786 rows / 20 sets, 2,021
    Standard-legal, 2026-08-04), AND TWO OF THE THREE THE RECON QUOTED WERE
    WRONG.** The four fully anchored printed sentences are **29/15**, **17/9**,
    **10/8** and **2/2** (rows / legal) — 58 catalog, **34 legal**, which is exact.
    But the BOOLEANS: `targetEffects` **23 legal** (15 + 8) ✔ as priced;
    `weakness` **10 legal built** (8 + 2), reaching the recon's 15 only by adding
    all five DEFERRED riders; `resistance` **17 legal built** (9 + 8), and **20**
    even with the riders — the recon's 22 is reachable from no population. The
    ability half is **6 legal, all Walking Wake ex, one sentence**, exact.

    ⚠️ **AND THE THREE-BOOLEAN ARGUMENT IS HALF WRONG, WHICH IS WORTH MORE THAN
    THE COUNTS.** The scoping claim was "Weakness and Resistance each occur ALONE
    in the legal pool, so they cannot share a field". `resistance` alone is real
    and BUILT (9 legal). `weakness` alone is real in the legal pool but lives
    **entirely in the deferred riders** — inside the four sentences this slice
    builds, Weakness is only ever printed beside Resistance, so those two COULD
    have shared one field today. They do not, for two reasons that are structural
    rather than anticipatory: they are read at two DIFFERENT §8.5 steps (the
    Weakness ternary already carried a null path, `seatRemovesWeakness`; the
    Resistance one had none), and the first deferred rider to land would have to
    un-merge them. Three booleans, one of them justified differently than priced.

    ⚠️ **THE READ SITE IS SHARED, THE STORAGE IS NOT** — this repo's standing rule,
    and here both halves bite. Three §8.5 steps consult one local
    (`suppressTargetEffects`) and none can tell which half answered; the two stores
    stay apart because the attack half is a PARSE alive for one declaration and
    immune to §9 (an Ability-lock has nothing to say about attack text) and the
    ability half is a §9-SUPPRESSIBLE catalog aura. Both signs are driven on ONE
    board: under Spiritomb's "Fettered in Misfortune" the ability half reads the
    control's 90 and the attack half still reads 120.

    ⚠️ **THE ATTACKER-SIDE READ, AND WHAT IT COST.** §8.5 folded
    `passivesOf(next, defender)` only; the field is read off the ATTACKER through
    the new `attackerSuppressesTargetEffects` (continuous.ts), reached the way
    `boostedAttackDamage` / `installedAttackDebuffOf` already reach the attacker —
    and it is the FIRST of those three that is a CATALOG fold rather than a stamp
    on the attacker's record, which is exactly why it is the one §9 can switch off.
    Price: 1 `PassiveEffects` field, 1 fold key + 1 OR in `passivesOf`, 1 exported
    helper, 1 `||` at the site. `passivesOf`'s D174 Energy audit is RE-READ for the
    thirteenth field rather than bumped, and the twelfth returned key is asserted
    in `therapeuticEnergy.test.ts`.

    ⚠️ **FOUR SITES MOVED, NOT ONE — the clause's SCOPE, not its step.** Beyond
    Weakness and Resistance, `targetEffects` reaches (a) the post-W/R reduction,
    where the catalog and installed halves go and the SEAT-WIDE aura drops to
    `"othersOnly"` (D161's reading inherited whole: an ACTIVE Hariyama loses its own
    10, a BENCHED one keeps shielding its teammate — both driven), (b) the
    ON-TARGET prevention trio, with D159's OFF-TARGET pair left OUTSIDE the guard
    verbatim, and (c) — the one the brief did not name — the PRE-W/R
    `opposingAttackDebuff`, whose SOURCE *is* the opponent's Active (Entei
    "Pressure"). That is `snipeActive`'s D151 split arriving at the main hit: the
    aura half of the `debuff` sum goes, the attacker-record stamp and this attack's
    own printed penalty stand.

    ⚠️ **NOT `damageChosen.ignoreWR`, VERIFIED BEFORE CONCLUDING.** ONE writer
    (`CHOSEN_ANY_TARGET`'s group 2, Umbreon "Feint Attack") and TWO read paths
    (`snipeActive`, `placeSnipe`'s `deals` arm); it is a member of an OP and the
    main hit has NO op, and it is one boolean where three are needed. Sibling, not
    shared — asserted in both directions.

    ⚠️ **ORDERING: ONE WITNESS, TWO PINNED ABSENCES.** The witness is a Fire 60
    into a ×2-Fire / −30-after-W/R body: `60×2−30 = 90`, where reduction-first
    reads `(60−30)×2 = 60`, and the two suppressions then remove one operand each
    for **four distinct numbers on one board (90 / 120 / 30 / 60)**.
    `suppressResistance` alone **can have no order witness at all**: Resistance and
    the reduction are both subtractions under monotone floors and
    `max(0, max(0,x−a)−b) === max(0, x−a−b)` for all a,b ≥ 0 (driven as arithmetic
    over the range, not written as a board that passes while asserting nothing),
    and ordering it against WEAKNESS needs a card listing one type in BOTH columns
    — **0 of 3,786 rows**, so only the synthetic `fix-weak-tough` can, and it says so.

    **+5 LEGAL RIDER-ON-COMPOUND PRINTINGS DEFERRED AND PINNED**, refused on their
    printed text: every deriver here is fully anchored, so admitting them means a
    SENTENCE-SPLITTING seam and not a looser regex, and 4 of the 5 are blocked on
    their own leading clause anyway. `FIXTURE_POOL` already carries a sixth
    (Pachirisu sv01-068/-208, 3 catalog / 0 legal) and it stays loud.

    ⚠️ **THE FIXTURE SWEEP FOUND A CARRIER, WHICH FOUR SLICES RUNNING DID NOT.**
    Bellibolt sv03-078/-201 "Thunderous Edge" has printed sentence #1 verbatim
    since D159, declared there "a live question this slice deliberately does not
    answer". It is answered with NO fixture edit — and it was checked against
    D193's trap before landing: Bellibolt is a DEFENDER in every case
    `attackerFilter.test.ts` drives, verified by running the suite.

    **TWO SUITES OUTSIDE THIS SLICE MOVED, BOTH BY DESIGN AND BOTH REPAIRED
    RATHER THAN BUMPED.** `therapeuticEnergy.test.ts`'s eleven-key fold audit is
    now twelve, with the new key's Energy reading argued; `alwaysOnReduction.test.ts`'s
    `damageReductionAfterWR` census is PARTITIONED — the real-card list is
    unchanged and the two synthetic walls are asserted beside it, so the sweep
    stays live. `clauseApostrophe.test.ts` **74 → 78**, attributed row by row: 3
    from `fix-suppressor` and **1 from a REGEX ALONE** (Bellibolt's sentence, in
    the pool since D159 and unread until now) — the first time one slice has moved
    that census from both of its sources.

    `MATCH_RECORD_VERSION` **stays 12**, derived: `AttackDamageSuppression` is a
    parse-time value produced from card text and consumed in the same tick, and
    `PassiveEffects.suppressTargetEffectsOnAttack` is a CATALOG value read through
    `passivesOf` — neither is persisted state. No `GameState` field, no
    `InPlayPokemon` key, no `PendingStage`, no new `EffectOp` (so nothing new can
    park), no `EffectPrompt`/`EffectChoice`/`EffectContinuation`, no
    `@luminous/schema` diff, no redaction change. `DAMAGE_DEALT` is unchanged:
    `weakness: null` and `resistance: null` are already-supported inhabitants
    (`seatRemovesWeakness` and the snipe arms write both today) and `reduction` is
    already optional. D181's precedent — reachability widening is not a shape
    change — covers the widened `passivesOf` return. `apps/api` untouched.

    Cost: 1 interface + 1 regex + 1 reader (effects.ts), 1 `PassiveEffects` field +
    1 program + 9 registry rows, 1 fold key + 1 exported helper (continuous.ts),
    5 read-site edits + 1 `effectSimulated` term (attack.ts), 4 SYNTHETIC fixtures
    + 1 deck, 1 test file (32 tests), 3 census repairs. */

/** 0.126.0 — **D196, THE TWO ENERGY COUNTS THAT WERE BLOCKED BY A FIXTURE: the
    ATTACKER'S OWN attached Energy and the BOTH-ACTIVES span — and the
    unsimulated-"+" witness re-homed FIRST so they could land at all.**

    The TENTH and ELEVENTH `DamageCountSource`. `energyOnSelf {energyType}` is the
    Energy attached to the ATTACKING body, BOTH folds, with the same optional type
    filter its opponent-side mirror carries — **21 legal printings / 38 catalog**,
    the LARGEST member this family has ever taken and larger than D193's three put
    together. `bothActivesEnergyCount` sums the Energy on the TWO Actives —
    **8 legal / 10 catalog**, ADD only, and the first member whose answer BOTH
    SEATS contribute to. Re-measured against the D1 (2026-08-04): 3,786 rows,
    2,021 `legal_standard = 1`; folds MEASURED per sentence, never inferred from
    the attack name — `energyOnSelf` is ADD 12 legal / 26 catalog and MULTIPLY 9 /
    12, exactly D193's numbers.

    ⚠️ **THE HEADLINE IS A FIXTURE THAT CHANGED SIGN, NOT A MEMBER.** Entei
    sv03-030 "Blaze Ball" had been this engine's canonical UNSIMULATED-"+" witness
    since 0.35.0, and its printed sentence is one of `energyOnSelf`'s 21. D193
    built the member, ran the suite, counted **5 assertions across 4 files** going
    red, and REVERTED rather than silently retire a fixture four suites depend on.
    That refusal was correct; this slice pays for it by moving the witness FIRST.
    D193's list was re-measured by implementing the member again and is **exactly
    right**: `scaledDamage.test.ts` ×2, `perEnergyFlip.test.ts`, `log.test.ts`,
    `checkup.test.ts`. A SIXTH failure exists and could not have been on that list
    — `benchBodyScaling.test.ts`'s own pinned absence for `bothActivesEnergyCount`,
    which D193 wrote deliberately and handed forward; it is FLIPPED there, not
    deleted.

    ⚠️ **THE REPLACEMENT IS PACHIRISU sv01-068 "Everyone Discharge" ({L}{C},
    "10+"), AND IT IS UNREAD FOR THREE INDEPENDENT REASONS WHERE ENTEI HAD ONE** —
    which is the whole point, because a witness with one reason is retired by the
    first slice that answers it. (1) It is a TWO-SENTENCE printing and every reader
    in this family is whole-sentence anchored. (2) Its count is a TYPED count of
    BODIES on the attacker's own Bench, and no `DamageCountSource` member counts
    bodies with a type filter. (3) ⚠️ **AND THIS SLICE'S OWN PREMISE WAS WRONG
    HERE**: the plan said the second sentence is one D192's suppression reader
    already answers, sharpening reason 1. It is not — "This attack's damage isn't
    affected by Weakness." has **ZERO standalone printings**; the catalog prints
    that clause only as the TAIL of a two-sentence attack (3 rows), which is
    exactly why D192's four anchored spellings have no Weakness-only member. So the
    composition has no readable half at all, and the expected corroboration turned
    out to be a third independent reason. The swap is like-for-like on LEGALITY
    too: Entei's sentence is 2 printings / 0 legal, Pachirisu's 3 / 0 legal.

    **THE PRICE, VERIFIED AGAINST THE FILE AND EXACTLY AS D193 PREDICTED.** A
    single-fold member is union member + evaluator arm + regex const + reader arm =
    **4**; a both-fold member is **6** (two regex consts, two reader arms). Actual:
    `bothActivesEnergyCount` **4**, `energyOnSelf` **6**. No seventh: D193's shared
    `attachedEnergyFilter` — the resolver that tells "no filter printed" (`null`)
    from "a filter I could not read" (`undefined`) — already exists and both new
    reader arms use it unchanged. No widened signature either: both evaluator arms
    call `countAttachedEnergy` at the shape it already had, so unlike D193 this
    slice does not even need D181's reachability-widening precedent.

    ⚠️ **TWO RECON NUMBERS RE-CHECKED, AND THE 21 IS RIGHT WHERE 23 IS NOT.** Both
    rows in the gap are LEGAL, which is why a raw sentence sweep cannot be a build
    estimate: "…for each **Basic Energy** attached to this Pokémon." (1 legal)
    filters on a card CATEGORY that resolves to nothing and must stay LOUD, and
    "…for each {W} Energy attached to this Pokémon. **Before doing damage, you may
    attach** …" (1 legal) is a two-sentence printing the anchor refuses. Both are
    carried as fixture indices and driven, not argued — and the second is the ONE
    printing in the family that could make "read at DECLARATION" observable, so its
    refusal is load-bearing rather than incidental.

    ⚠️ **`bothActivesEnergyCount` IS ADD-ONLY BY LEGALITY, NOT BY ABSENCE — the
    OPPOSITE answer to `bothSidesBenchCount`.** Its bare twin IS printed and is
    **0 legal**, so a MULTIPLY arm would buy a regex and an evaluator branch for a
    card no legal deck plays; it is refused and stays LOUD, pinned. It also takes
    NO type filter: the pool prints no typed spelling in any column, so a capture
    would be a field no reader could ever set — D193's zone-capture refusal,
    mirrored into the other axis. Its coin near-miss ("Flip a coin for each Energy
    attached to both Active Pokémon. …", 1 printing / 1 LEGAL) is unread on BOTH
    sides and is NOT `AttackFlipCount.attachedEnergy` either — that member reads
    "attached to this Pokémon", one body — so it is pinned for the next slice.

    ⚠️ **THE FIXTURE SWEEP FOUND EXACTLY ONE REUSE, AND IT IS THE LOAD-BEARING
    NEGATIVE.** Five slices running have swept `FIXTURE_POOL` as a separate
    population and found ZERO; this one found `sv03-030` carrying `energyOnSelf`'s
    exact sentence — which is this slice's entire story, and would have arrived as
    five red assertions in four unowned files (what happened to D193) instead of as
    a measurement. The sweep is a test.

    **ORDERING: TWO WITNESSES THAT DO NOT COMMUTE, THREE PINNED ABSENCES.** The
    additive fold runs pre-W/R on both members — a Fire attacker into a ×2-Fire
    210 HP body reads `(30 + 50) × 2 = 160` where post-W/R reads `110`, and the
    both-Actives twin reads `(30 + 2×30) × 2 = 180` versus `120` on a board where
    the DEFENDER's own Energy is inside the number its own Weakness then doubles.
    The `×` fold **can have no witness**: it drops the printed base, so the sum has
    ONE term — asserted through `DAMAGE_DEALT`'s own shape (`base: 0`, whole term
    in `scaled`), which is sharper than the arithmetic. "Read at DECLARATION" is
    likewise unobservable for ENERGY and is pinned as such rather than faked.

    **13 mutants, each copying a neighbouring arm's REAL code. ONE survived the
    first round and it was a genuine gap**: `countEnergyInPlay(state, attackerSeat,
    …)` — the board-zone call `energyOnOpponent` really makes one line up — passed
    because the mirror board left the attacker's Bench bare. One `{R}` on
    `bench[0]` separates Active from side in BOTH readings (3 vs 4 untyped, 2 vs 3
    filtered) and kills it. A SECOND survivor is EQUIVALENT and recorded as such
    rather than dropped: reading `state.players[attackerSeat].active` instead of
    the declaration snapshot is unobservable for this member, because the only
    pre-fold mutation of the attacker is the confusion self-damage — which carries
    `energy` across untouched, and on tails never reaches the fold.

    `MATCH_RECORD_VERSION` **stays 12**, derived not inherited: `DamageCountSource`
    is a PARSE-TIME type consumed in the same tick — no `GameState` field, no
    `PendingStage`, no `@luminous/schema` projection, no redaction — and there is
    no new `EffectOp`, so nothing new can park in `GameState.phase`. The re-homing
    moves TEST scaffolding only (`FIXTURE_POOL`, `SCALED_DAMAGE_DECK`); no saved
    record names a fixture id. `apps/api` untouched.

    ⚠️ **`clauseApostrophe.test.ts` DOES NOT MOVE: 78 → 78, and that is a RESULT.**
    Not one of the four newly-readable sentences carries an apostrophe — "attached
    to this Pokémon" and "attached to both Active Pokémon" name no possessive at
    all, which is what makes this the first Energy-count slice to take no diff
    there. Both new fixtures' remaining indices add none either: the refusals stay
    refused, and the sweep admits only sentences a reader RESOLVES.

    Cost: 2 union members, 2 evaluator arms (attack.ts), 3 regex consts + 3 reader
    arms (effects.ts) = **10**. Plus 2 SYNTHETIC fixtures + 1 deck, the
    `SCALED_DAMAGE_DECK` re-home, 1 new test file (33 tests) and 5 repaired
    assertions in 5 suites this slice does not own. Repo: **224 files / 4161
    tests** green (a concurrent slice's UNCOMMITTED `legalNonAttackPrograms.test.ts`
    excluded — it is red at HEAD from its own in-progress `registry.ts` and
    reproduces without this slice's work). */

/** 0.127.0 — **D186, THE PRINTED "You may …" AS A FOURTH GATE — THE MECHANISM
    AND BOTH DIALOGS, WITH NO PRODUCER.**

    ⚠️ **THIS VERSION CARRIES TWO DECISIONS, AND THE SECOND ONE IS D199's.** That
    slice landed 28 registry programs / 47 Standard-legal printings at `21623b5`
    while this file was held by a concurrent slice, so it took NO bump and its
    workstream section records the 0.127.0 block as "owed at merge". This is that
    merge: `0.126.0 → 0.127.0` covers both, and D199's own block is owed HERE
    rather than at 0.128.0 — a version number is a deploy boundary, and those rows
    and this mechanism ship across the same one. Nothing in D199 touches anything
    below; the two are disjoint by file.

    A new op (`optional { note, then }`), a new prompt kind (`confirm`), a new
    choice kind, a wire arm, a projection arm and TWO dialogs — and nothing that
    constructs one. That is the slice, and the missing producer is the SAFETY
    PROPERTY rather than an omission: a park of a prompt kind a surface cannot
    render is a SOFT-LOCK (effect:choose swallows Escape, offers no decline and
    cannot advance without an answer), so both surfaces answer the question before
    anything can ask it. The two deriver anchors that will ask it are PINNED ABSENT
    in `optionalConfirm.test.ts`, as the red line the producer slice turns green.

    **THE HONEST PRIZE IS 12 PRINTINGS, AND THE MECHANISM IS WORTH MORE THAN
    THEM.** The printed "You may …" wrapper gates 78 legal printings, but the split
    matters: **34 are already FREE** — their inner op (`searchDeck`,
    `discardEnergy {kind:"upTo"}`, `attachCards`, `moveEnergy`) parks with a legal
    EMPTY answer, so the decline the wrapper grants is one their own prompt already
    offers, and wrapping one would ask the same question twice. **44 need a real
    confirm arm**, and only **12 are buildable today**: "You may draw cards until
    you have 6 cards in your hand." (×10) and "You may draw 5 cards." (×2). The
    other 32 wait on ops that do not exist. Two prior slices (D181, D189) deferred
    printings to this mechanism BY NAME, which is the other half of the warrant.

    **THE CRUX IS WHERE THE SPLICE LIVES, AND IT IS NOT AN APPLY ARM.**
    `applyChoice` returns a `GameState` and cannot see `rest` — the ops still to
    run — which is the only thing a gate touches. `resumeProgram` already owns both
    halves (`applyChoice(...)` then `runProgram(rest)`), so the splice is ONE
    expression there and no signature moves. `optional` is simply the FOURTH GATE:
    `runProgram` does `queue.unshift(...op.then)` for `coinFlipGate` (a coin),
    `conditionGate` (the board) and `recordGate` (what an earlier op filed); this
    gate's condition is a HUMAN ANSWER, so it is evaluated one action later and
    splices where that answer arrives. `applyChoice`'s own arm therefore returns
    the state UNCHANGED on both answers.

    ⚠️ **THE SPLICE IS A PREPEND, AND THAT IS OBSERVABLE.** An `optional` wrapping
    `drawUntilHandSize 6` in front of a plain `drawCards 1` ends at SEVEN cards
    prepended and SIX appended — the "until" op never trims. That pair is the
    suite's ordering witness rather than an argument.

    **A SIBLING OF `mayDraw`, NOT A RENAME OF IT** — three reasons, because "two
    yes/no prompts" invites the merge. The READ SITES differ (a mayDraw answer
    MOVES CARDS; a confirm answer SPLICES OPS). `count` is meaningless here: all
    four mayDraw write sites carry a printed number their dialog renders, and a
    generic confirm has none. And `kind` is a PERSISTED literal, so renaming it
    would owe a version bump where adding an inhabitant does not.

    ⚠️ **THE SLICE'S OWN PREMISE ABOUT THE SOFT-LOCK WAS WRONG, AND THE REAL
    EXPOSURE IS ON THE OTHER SURFACE.** The plan held that `GameHud`'s
    `EffectChooseDialog` was a ternary chain whose catch-all `<ChoosePokemonDialog>`
    would swallow a `confirm` and render nothing. It would not: that dialog's prop
    is `Extract<EffectPrompt, {kind:"choosePokemon"}>`, so the widened narrowing is
    a COMPILE ERROR — verified by making the change and reading it. It was
    converted to an annotated exhaustive switch anyway, because the guard it had
    was INCIDENTAL (bought from a sibling's prop type, and gone the day a catch-all
    takes `EffectPrompt` whole) rather than a statement. ⚠️ **The ONLINE router is
    the one that fails silently, and its comment claimed the opposite.**
    `OnlineHud`'s `EffectChooseDialog` has no declared return type, so an unmatched
    kind falls off the end as `undefined` — and **`chooseAttack` (D157) is on the
    wire, in the schema and in projection.ts's exhaustive rebuild with NO ARM
    there**. An online Medicham sv01-111 / Oranguru sv02-094 parks a prompt that
    client cannot render. FOUND AND RECORDED, NOT FIXED: it is a different slice's
    defect and a different dialog. The false comment was corrected in place.

    `MATCH_RECORD_VERSION` **stays 12, derived and asserted rather than inherited.**
    This adds an INHABITANT to two unions (`EffectOp`, `EffectPrompt`) and no
    required field to an existing one — D125's widening, not D136's
    `damageChosen.source`. A v12 record can only be parked on an inhabitant a v12
    build could construct, and no v12 build could construct an `optional` op; every
    pre-existing park serializes byte-identically because nothing they carry moved.
    What remains to check is the forward direction — that a park of the NEW shape
    is plain JSON — and that is driven, not argued. `apps/api` UNTOUCHED:
    `resolveEffect` is already on `SUPPORTED_MATCH_ACTIONS`, and a new prompt KIND
    is not a new action TYPE.

    **THREE DECIDED NON-CHANGES, EACH ASSERTED RATHER THAN ASSUMED.**
    `withConsequence` needs no arm — `recordSlotOf("optional")` is undefined, so
    the §9.2 describer returns at its first line and the note stays the printed
    sentence VERBATIM even with a `recordGate` sitting right behind it (driven).
    `promptKey` (GameHud) gets no arm — its `default` block already argues this
    exact case for `mayDraw`, and `ConfirmPromptDialog` gathers nothing, so there
    are no stale picks a bespoke key could reset. `programPlayable` does NOT
    descend into `then`, and there the coin gate's argument INVERTS rather than
    running short: a coin branch is all the card can ever do, while an `optional`'s
    branch is one of TWO printed outcomes — declining resolves the sentence as
    printed, so a "you may gust" into an empty Bench still plays (driven).

    ⚠️ **`TriggeredAbility.optional` IS NOT THIS MECHANISM AND WAS LEFT ALONE.** It
    is a registry-author declaration with zero engine readers (the framework
    auto-fires optional triggers), and it lives in `registry.ts` — a file a
    concurrent slice held open, so its doc comment was not retitled. That retitle
    is the one piece of D186's plan this commit does not carry.

    **9 mutants, each copying a neighbouring arm's REAL code; ZERO first-round
    survivors.** Appending instead of prepending the branch, splicing on any
    confirm answer, inverting the boolean, copying `opponentMayDraw`'s `decider`
    into the park (which would put the controller's own printed "you" on the
    OPPONENT's screen), dropping the wire's boolean check, wiring either dialog's
    No button to `answer(true)`, descending into `then` in `programPlayable`, and
    dropping the printed note for a constant — all killed. Three more are caught by
    the COMPILER (dropping `redactPrompt`'s arm, dropping `effectDecisionFromPrompt`'s
    arm, reverting the local router to its catch-all). ONE EQUIVALENT MUTANT is
    recorded as such rather than dropped: deleting `applyChoice`'s `optional` arm
    changes nothing, since its `default` also returns the state — the arm is kept
    because that default's stated reason ("synchronous ops never park") is false
    about this op.

    ⚠️ `clauseApostrophe.test.ts` **does not move: 78 → 78.** Expected, and checked
    rather than assumed: this slice adds no deriver arm at all, so the derivable
    census cannot change.

    Cost: 1 op, 1 prompt kind, 1 choice kind, 1 `stepOp` arm, 1 `applyChoice` arm,
    1 `resumeProgram` expression, 1 `validateChoice` arm, 1 redact arm, 1 schema
    member, 1 projection arm, 2 dialogs + 1 router conversion = **13**. Plus 3 new
    test files (34 tests). ZERO new events, error codes, registry rows, board
    conditions, state fields or `apps/api` diff. Repo: **225 files / 4204 tests**
    at `e34c254` (D199's landing) → **228 files / 4238 tests** green. */

/** 0.128.0 — **D200, THE OWNER-PREFIX SUBGROUP FILTER — `CardFilter.ownerPokemon`,
    AND THE MEASURED FINDING THAT THE PROJECT'S "LARGEST NAMED GAP" IS SIX
    PRINTINGS WIDE FROM THIS SIDE.**

    One `CardFilter` member — `{ kind: "ownerPokemon"; owner: string; stage?:
    "basic" | "evolution" }` — two read-site arms, five registry programs and six
    Standard-legal printings. `ownerPrefix.test.ts` (24 tests) drives every one
    through the real engine on synthetic `fix-*` bodies declared inside the suite
    against `createGame({cardPool})`, D190/D199's idiom.

    **THE CENSUS WAS RE-DERIVED AND THE PRIOR ONE WAS WRONG THREE WAYS.** Swept
    over all three text columns of the remote D1 (3,786 rows / 20 sets, 2,021
    Standard-legal) on 2026-08-04. (1) SQLite's `LIKE` is ASCII case-insensitive,
    so `'%N''s %'` matches "Pokémon's" and reports `N's` at 95 text units where
    `GLOB` reports 6 — every prior count on a short owner name is suspect for this
    reason alone. (2) D187's "67" was never attack-only: its own table totals all
    three columns, and legal ATTACK units across every owner come to 25. (3) The
    prefix list was short by five owners — `Hop's` 5, `Arven's` 3, `Marnie's` 2,
    `Janine's` 1, `Xerosic's` 1 — so the legal total is **80 text units, not 67**.
    The sweep also answers its own widest question NEGATIVELY: no printing names a
    subgroup without the possessive, and the catalog holds ZERO U+2019 in any text
    column, so no apostrophe fold is owed and `clauseApostrophe.test.ts`'s census
    does not move (it enumerates `FIXTURE_POOL` attacks a DERIVER resolves; this
    slice adds no deriver arm and no fixture).

    **THE PREDICATE READS THE CARD NAME, BECAUSE THERE IS NOTHING ELSE TO READ** —
    the ingested row carries no owner, subgroup or family column, so membership is
    the printed `<owner>'s ` prefix, exactly as `hasRuleBox` reads "Radiant " and
    `pokemonSuffixOf` reads " ex" off the same field. ⚠️ AND ONE CARD BREAKS THE
    NAME-ONLY RULE: **`Team Rocket's Energy` sv10-182**, a Special Energy carrying
    the prefix — and the card that prints *"This card can only be attached to a
    Team Rocket's Pokémon."*, so a name-only predicate makes it a legal target for
    itself. `category === "Pokemon"` is a CONJUNCT, not a tidy-up: 32 of the 214
    prefixed printings across the eleven owners with Pokémon are a Trainer or that
    Energy.

    **ONE MEMBER, TWO RIDERS, AND THE STANDING RULE DECIDED IT RATHER THAN BEING
    WAIVED.** `owner` is a PARAMETER because the set is open (zero owners through
    `sv08`, eleven by `sv10`) and every read site's code is identical across them.
    `stage` is a RIDER rather than three members because the rule's PRECONDITION
    fails: both read sites must branch on `owner` regardless, and `retrieveNoun`
    owes ONE noun phrase — "a Basic Hop's Pokémon" — that is not the concatenation
    of "a Basic Pokémon" and "a Hop's Pokémon". Three members would cost two
    exhaustive switches six arms with the owner logic copied three times; the
    rider costs two. COMPOSITION IS NEEDED (four of the six printings print a
    second axis) and the vocabulary has NO conjunction to compose with — no
    `allOf`; `pokemonOrBasicEnergy` is a bespoke disjunction and
    `basicPokemon.noRuleBox` a bespoke rider — so the filter carries it.

    ⚠️ **THE YIELD IS 6, AND THAT IS THE PRODUCT.** 80 legal text units name this
    dimension; the filter finishes six printings — Champion's Call (Cynthia's
    Gabite sv10-103), Swim Together (Misty's Lapras sv10-050/-194), Hop's Bag
    sv09-147, Summoning Sign (Steven's Baltoy sv10-083) and Inviting Flowers
    (Lillie's Comfey sv09-068). The reason is structural rather than incidental:
    **`CardFilter` is the CARD vocabulary and in-play TARGETS are not chosen with
    one.** Every consumer scans a deck, hand, discard pile or an Energy on a named
    host; a Pokémon target is picked by `targetType` (an energy-type string),
    `basicOnly` and `zone`, and no op takes a filter for it. So the sentences that
    SEARCH A DECK are finished and the sentences that POINT AT THE BOARD are not —
    including the five-printing Iono attach that D199 called the single
    highest-value missing piece in its census, which this member does NOT deliver.
    Ten more sentences / 23 legal printings are in `DROPPED` with the exact second
    piece each needs, every id asserted unbuilt: the in-play target filter (9),
    `switchActive` parameters (3), a filtered body-count `DamageCountSource` (2),
    D199's first-turn-Supporter exemption flag arriving a second time (2),
    `coinFlipGate`'s missing `otherwise` (1), a subgroup-scoped aura (1), an
    owner-prefixed ENERGY predicate (3), a `BoardCondition` on card identity (1).
    ⚠️ One of the ten needs NOTHING NEW — Spikemuth Gym sv10-169 is Champion's
    Call verbatim on `StadiumAbility.program` — and is held back for scope only;
    it is named as free so the next slice takes it first.

    ⚠️ **`MATCH_RECORD_VERSION` STAYS 12, AND THE PARK QUESTION WAS ASKED RATHER
    THAN ASSUMED.** All five programs PARK (`searchDeck` always does), and a
    parked program is persisted: `EffectContinuation` carries `{pendingOp, rest,
    ctx, record}` — the OPS themselves — so a `{kind:"ownerPokemon"}` filter does
    reach storage. It still does not bump, for D186's own stated reason one line
    over: `kind` is a persisted literal, so RENAMING one would owe a bump where
    ADDING AN INHABITANT does not. The gate protects old records against a new
    build, and no record written before this deploy can contain a filter this
    deploy invented. No `apps/api` diff.

    Cost: 1 union member, 1 `matchesFilter` arm, 1 `retrieveNoun` arm, 5 registry
    programs, 11 registry keys = **19**, plus 1 test file (24 tests). ZERO new
    ops, events, error codes, prompts, board conditions, state fields, `src/**`
    or `apps/**` diff. Repo: **229 files / 4253 tests** at `7c9cc33` →
    **230 files / 4277 tests** green. */

/** 0.129.0 — **D202, THE PRODUCER: the printed "You may …" finally ASKS.**
    Slice 2 of 2 of D186.

    TWO REGEXES AND TWO `deriveAttackEffect` ARMS, worth **12 legal printings**.
    D186 landed the fourth gate — the `optional {note, then}` op, the `confirm`
    prompt kind, the choice kind, the wire check, the redact arm, the projection
    arm and BOTH dialogs — with deliberately NOTHING that constructs one, because
    a park of a prompt kind a surface cannot render is a soft-lock and the honest
    ordering is surfaces first. Both surfaces answer it now (D201 also gave the
    online router its `never` floor), so this is the asking. ZERO new ops,
    prompts, choice kinds, events, error codes, park machinery, dialogs, registry
    rows, state fields, `src/**`, `apps/**` or `@luminous/schema` diff.

    **THE CENSUS WAS RE-DERIVED AND BOTH OF D186's FIGURES HELD EXACT.** Swept
    2026-08-04 over `json_each(attacks_json)` on the remote D1 (3,786 rows / 20
    sets, 2,021 Standard-legal): *"You may draw cards until you have 6 cards in
    your hand."* **10 printings, 10 legal** (Blissey ex sv06-134/-201, Lumineon
    sv07-036, Cynthia's Garchomp ex sv10-104/-215/-232/-241 + svp-204, Audino
    sv10.5b-074/-151) and *"You may draw 5 cards."* **2 / 2 legal** (Cyclizar ex
    sv08-159/-228). ⚠️ Run with `GLOB '*[Yy]ou may draw*'` (CASE-SENSITIVE —
    SQLite's `LIKE` is ASCII case-insensitive, the verb that cost D200 a census)
    and then deliberately re-run the wrong way with `LIKE '%you may draw%'`: THE
    SAME TWO ROWS, so no case variant exists and that is measured rather than
    assumed. Both sentences are pure ASCII (`hex()` on the rows) — no apostrophe,
    no `é` — so no character class and no fold is owed on either anchor.

    ⚠️ **AND THE SWEEP'S NEGATIVE RESULT IS THE OTHER HALF OF THE WARRANT: those
    two ARE the whole "you may draw" attack column.** No third sentence, no
    trailing-clause variant, and no singular "You may draw a card." — so the
    alternation `ATTACK_DRAW` carries is deliberately NOT copied onto the wrapper,
    which would be a branch no printing can reach.

    **THE NOTE IS THE MATCHED STRING, NOT A REBUILD.** `note: effect` — the whole
    thing the `^…$` anchor just consumed — so the sentence the player reads is
    byte-identical to the catalog by CONSTRUCTION rather than by care. Both HUDs
    render the note as the dialog's only prose (`<h2>{prompt.note}</h2>` over Yes
    and No; the "You may" on `HudDialog` / `Dialog` is an `aria-label`, not
    visible text), so the printed sentence IS the question and this slice invents
    no wording for any card. The op's own doc already required exactly that.

    **FOUR ANCHORS, NOT ONE WITH AN OPTIONAL GROUP.** A `/^(?:You may )?[Dd]raw …/`
    would be shorter and wrong in the way this repo cares about: it would park a
    question on the BARE printings, which print none — a mandatory draw turned
    into a prompt is the soft-lock-shaped defect on the other side. The `then` each
    wrapper produces is asserted BYTE-IDENTICAL to its bare sibling's whole program
    (D134/D181's inventory equality), which is what the shared group would have
    bought by construction and this buys by test instead.

    ⚠️ **`MATCH_RECORD_VERSION` STAYS 12 — DERIVED FRESHLY, BECAUSE D186's SECOND
    LEG HAS RETIRED.** D186 argued two things: (1) an INHABITANT added to two
    unions, no required field on an existing one — D125's widening; and (2) *"no
    v12 build could construct an `optional` op, so no v12 record can be parked on
    one."* **(2) IS FALSE FROM THIS COMMIT ONWARDS** and had to be re-asked rather
    than inherited. (1) still holds, and holds more simply: this slice adds no
    inhabitant at all, no `GameState` field, no `EffectContinuation` shape, no
    prompt/choice kind, no event and no wire member — it adds two REGEXES, and
    what widened is which op values are REACHABLE from the deriver seam, which is
    the exact ground on which D181 derived four ops and stayed at 11 (`apps/api/
    src/lobby/match.ts` states that precedent verbatim). What replaces (2) is
    STRONGER than it was: **the READER for this park shipped in v12 already, in
    the same version as the op**, so every v12 build — including every one that
    predates this slice and cannot produce the park — has the `stepOp` arm, the
    `applyChoice` arm, the `resumeProgram` splice, the `validateChoice` arm, the
    redact arm, the projection arm and both dialogs. A record this build writes is
    completely legible to a build that cannot write it, which is precisely what
    D186's ordering bought. Driven, not argued: the DERIVED park round-trips
    through JSON and its `phase.prompt` / `cont.pendingOp` are asserted equal to
    the hand-built shapes `optionalConfirm.test.ts` drives. `apps/api` UNTOUCHED;
    the derivation never pointed there.

    ⚠️ **THE DECLINE IS THE HALF THAT CAN BE SILENTLY WRONG, AND THE ATTACK PATH
    HAS A FAILURE THE HAND-BUILT SUITE CANNOT SEE.** An attack is USED whether or
    not its optional rider fires, so a decline that dropped the queued
    `attackEpilogue` would leave a live board on a turn that can never end — no
    §8.1 Knock Out sweep, no §5.3 turn end, damage already dealt. Every accept case
    has a decline twin, and the twins check the deck ELEMENT BY ELEMENT (a
    draw-and-put-back keeps the length and moves the order), check that the only
    `CARDS_DRAWN` in the batch is P2's `turnStart` one, check the damage stayed on
    the board, and check the KO the damage caused resolved anyway.

    **D186's PINS WERE RE-POINTED, NOT DELETED** — D181's rule, and
    `attackPark.test.ts` has moved four rows this way. The three cases that
    asserted `deriveAttackEffect(<sentence>) === null` now assert WHICH READER owns
    each sentence and that what comes back is the WRAPPER: strictly stronger,
    because a `toBeNull()` that is simply deleted takes its witness with it, while
    a shape claim still tells a correct wrapper from a build that returned the
    inner op unwrapped — the one regression that would draw the cards without
    asking. D186's safety property is kept and narrowed rather than dropped: the
    engine still produces no `optional` where no card prints one.

    **11 mutants, ONE FIRST-ROUND SURVIVOR, honestly reported and closed.**
    Dropping the wrapper on either arm (the bare arm's real code, copied);
    crossing the two adjacent arms' inner ops; rebuilding the note from the
    capture instead of using the matched string; dropping the `>= 1` guards;
    dropping `$`; adding `/i`; collapsing all four anchors into one with an
    optional `(?:You may )?` group; an EMPTY `then`; and quietly dropping the
    draw-5 anchor — all killed. ⚠️ **Dropping the leading `^` SURVIVED THE FIRST
    ROUND**, and the reason is a real property of the population rather than a
    slip: `NEAR_MISSES` is entirely real printed text and every entry carries its
    clause at the START, because the catalog holds NO sentence with either anchor
    at the END. Closed with two CONSTRUCTED trailing witnesses (a real first
    clause bolted in front of the real anchor, capital `Y` intact) and the
    construction is labelled as such — a lowercased variant would have passed for
    the WRONG reason, since the readers' case commitment refuses it independently.
    **ONE EQUIVALENT MUTANT recorded as such**: `note: match[0]` in place of `note:
    effect` changes nothing, because a `^…$` match IS the whole trimmed string —
    which is the anchoring paying for the note's correctness a second time.

    ⚠️ `clauseApostrophe.test.ts` **does not move: 78 → 78.** Checked, not assumed,
    and the reason is now two-fold: that census enumerates `FIXTURE_POOL` attacks a
    DERIVER resolves, and (a) neither new sentence carries an apostrophe, so no
    reader can newly resolve an apostrophe-bearing row, and (b) `FIXTURE_POOL` is
    UNTOUCHED — the three demonstrator bodies are synthetic `fix-*` cards declared
    inside the test file and handed to `createGame({cardPool})` (D190/D199/D200's
    idiom), because the catalog manifest cannot be regenerated (`SQLITE_CANTOPEN`)
    and it measures a 6-set catalog holding none of the twelve printings.

    Cost: 2 regex consts + 2 reader arms = **4**, plus 1 new test file (25 tests)
    and 3 re-pointed assertions in D186's suite. Repo: **230 files / 4277 tests**
    at `5abb5e4` → **231 files / 4302 tests** green. */

/** 0.130.0 — **D204, THE IN-PLAY TARGET FILTER — `AttachTargetRiders.ownerPokemon`,
    the half of the owner-prefix mechanic D200 could not reach.**

    ONE RIDER, ONE READ SITE, THREE CAPTIONS, worth **8 Standard-legal printings**
    across TWO ops. D200 landed `CardFilter.ownerPokemon`, measured its yield at
    six printings, and named the reason exactly: `CardFilter` is the CARD
    vocabulary — it answers *does this card match* for a deck / hand / discard
    scan — and **no op took a predicate for a body ON THE BOARD**, so the
    sentences that point at the board were unreachable. This is that predicate.
    ZERO new ops, prompts, choice kinds, events, error codes, park machinery,
    dialogs, state fields, `src/**`, `apps/**` or `@luminous/schema` diff.

    **THE DESIGN QUESTION WAS ANSWERED NEITHER WAY.** The standing rule — *the
    unit of sharing is decided by the READ SITE, the unit of storage by the WRITE
    SITES* — settles it, and it picks neither candidate:
      • **`filter?: CardFilter`, REFUSED.** It buys `ownerPokemon` free and admits
        **7 of `CardFilter`'s 13 members that are FALSE for every board top card
        by construction** (`basicEnergy`, `anyEnergy`, `specialEnergy`,
        `providesEnergy`, `supporter`, `toolCard`, `pokemonOrBasicEnergy` —
        `providesEnergy`'s own doc says a card-only read answers false). Authoring
        one yields an op whose candidate set is permanently empty, which
        `programPlayable` turns into **a card that can never be played**: a silent
        dead print, the exact wrong-but-plausible program the doctrine forbids. It
        also gives two ways to say "Basic" on one object, and still cannot express
        *is the Active*, *has damage on it*, *has an Energy attached*.
      • **A separate `TargetFilter` union, REFUSED.** A third vocabulary beside an
        interface that already does the job; it would re-express `targetType` /
        `basicOnly` / `benchOnly` or leave them as riders either way; and its whole
        gain is room for board axes **no legal printing narrows a target by**.
      • **CHOSEN: one flat rider.** The read site (`attachEnergyTargets`'s
        `eligible`) does not read A CARD — it reads a BOARD BODY, and already pulls
        two card facts (`targetType`, `basicOnly`) and two board facts
        (`benchOnly`, `notIfKO`) off one as flat riders. **`AttachTargetRiders` IS
        the in-play target filter this repo has.** What is shared is the
        **PREDICATE, not the type**: the rider is answered by calling
        `matchesFilter(topCard, { kind: "ownerPokemon", owner })`, D200's own arm
        with its three conjuncts intact, so the deck half and the board half can
        never disagree about who is an "Iono's Pokémon".

    ⚠️ **VALIDATION NEEDED NO ARM, AND THAT IS STRUCTURAL RATHER THAN LUCKY.**
    `attachEnergyTargets` is THE ONE GATE: four callers learn the rider for free
    (the `attachEnergyFrom` park, `attachFromTopOffer`, `attachFromDeckOffer`, and
    `programPlayable` — the last load-bearing for N's PP Up, an Item with no
    trailing shuffle to charge for), and `validateChoice` reads the PROMPT
    (`prompt.candidates` / `prompt.targets`), never the op. A body the rider
    excluded is therefore unreachable from a crafted online frame BY
    CONSTRUCTION, not by a second copy of the rule that could drift. Asserted on
    both prompt kinds. The third read site is the CAPTIONS, and one was widened
    rather than taught: `attachEnergyFrom` parked on a flat *"Attach the Energy to
    which of your Pokémon?"* naming no rider at all — merely vague while every
    rider was a type, and **false** with a subgroup (six bodies on the board, two
    rows offered). All three now share one `attachTargetNoun`.

    **THE CENSUS RE-DERIVED — D200's TOTALS HOLD, ITS ID LISTS DO NOT.** Swept all
    three text columns of the remote D1 (3,786 rows / 20 sets, 2,021 legal) on
    2026-08-04 with `GLOB` and never `LIKE`. D200's headline numbers reproduce
    EXACTLY (80 legal text units, 13 owners, 46 distinct legal sentences). What is
    wrong is the flag table, three ways:
      1. ⚠️ **SIX OF TEN FLAGGED ROWS CARRY IDS BELONGING TO OTHER CARDS**, so its
         "every id asserted unbuilt" was a **vacuous guard**. Ethan's Ho-Oh ex
         shipped as `sv10-025/-172/-206/-249` (Rabsca ex, Team Rocket's Bother-Bot,
         Yanmega ex, a non-existent id) where the real ids are
         `sv10-039/-209/-230/-239`; Arven's Sandwich as `sv09-166`, which is
         Lycanroc; N's Castle as `sv10-165`, which is Ethan's Adventure; and three
         more. Every COUNT was right, which is why nothing caught it.
      2. ⚠️ **FIVE SENTENCES / TEN LEGAL PRINTINGS ARE ABSENT ENTIRELY**, all inside
         the row D200 called its largest. The backlog is **15 sentences / 33 legal
         printings**, not 10 / 23.
      3. ⚠️ **`programFor(id) === undefined` IS THE WRONG FLAG SHAPE.** All four
         N's Zoroark ex printings ALREADY carry a program (their "Trade" Ability);
         it is the ATTACK that is unbuilt. A whole-id flag reads that card as built
         and drops it from the backlog silently — so this slice flags PER SURFACE.

    LANDED: **Spikemuth Gym** `sv10-169` (taken FIRST; verified to need nothing
    new, D200's prediction held) · **Iono's Bellibolt ex** `sv09-053/-172/-183/-188`
    + `svp-194`, D199's single highest-value item in the whole census, which needed
    TWO slices · **N's PP Up** `sv09-153` · **Marnie's Grimmsnarl ex** `sv10-136`,
    the row that proves the rider belongs on the shared interface and not on one
    op. ⚠️ **Ethan's Ho-Oh ex is NOT unlocked**, contra D200's "one field on one op
    finishes both rows": the print pins BOTH Energy to ONE body where multi-attach
    is N ops each parking on its own target.

    **`MATCH_RECORD_VERSION` STAYS 12**, and the park question was asked rather
    than assumed: both landed ops PARK and `EffectContinuation.pendingOp` is
    persisted, so the rider DOES reach storage. It is **D186's shape and not
    D136's** — D136 bumped for a REQUIRED field on a parking op, where this is
    OPTIONAL and its absence means exactly what every pre-D204 program meant. The
    candidate set is additionally materialised in `phase.prompt.candidates`, not
    recomputed from the op on resume.

    Cost: 1 rider (+3 op declarations) + 1 read-site arm + 1 shared caption helper
    + 4 registry programs, plus 1 new test file (26 tests) and 3 re-pointed
    guards in D199's / D200's suites. Repo: **231 files / 4302 tests** at
    `20670d0` → **232 files / 4328 tests** green. */

export const engineVersion = "0.130.0";

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
  attackBlockOf,
  attackLocked,
  countAttachedEnergy,
  countEnergyInPlay,
  disabledAbilityUids,
  effectiveAttackCost,
  effectiveMaxHp,
  effectiveRetreatCost,
  hasAttachedEnergy,
  hasFreeRetreatAura,
  hasFreeRetreatSelf,
  attackerSuppressesTargetEffects,
  boostedAttackDamage,
  installedReductionOf,
  lockedAttackIndexes,
  opposingRetreatBlocked,
  opposingRetreatSurcharge,
  providedEnergy,
  seatRemovesWeakness,
  stadiumEffectsOf,
} from "./continuous";
export {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
export { rareCandyOptions } from "./cardplay";
export type { RareCandyOption } from "./cardplay";
export type {
  AttachTargetRiders,
  AttackCoinFlip,
  AttackDamageBonus,
  AttackDamageSuppression,
  AttackFlipCount,
  BoardCondition,
  CardFilter,
  DamageCountSource,
  EffectOp,
  EffectSlot,
  OpponentEnergyZone,
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
  AttackBlock,
  BoostedAttack,
  DamageReduction,
  GameOutcome,
  GameOverReason,
  GameState,
  InPlayPokemon,
  LockedAttack,
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
    case "useStadiumAbility":
      return useStadiumAbility(state, action);
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
