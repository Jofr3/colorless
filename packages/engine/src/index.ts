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
    and "Energy in play" are each a HAPAX in the ingested 978 cards. A template
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
    978 cards asks for. If a POSITIVE clause ever appears under this consequent,
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
    Sharpedo sv06.5-034's named-card multi-sentence one.

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
    "Dedechange" and the local D1 prints no such attack anywhere in its 978 cards.
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

    CENSUS (local D1, 2026-08-02, whole effect string, 978 cards — D138's sweep
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

    CENSUS (local D1, 2026-08-02, whole effect string, 978 cards — D139's PUT
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
    (2026-08-02, 978 cards) prints "…damage counters on the Attacking Pokémon" on
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
export const engineVersion = "0.90.0";

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
  countAttachedEnergy,
  countEnergyInPlay,
  disabledAbilityUids,
  effectiveAttackCost,
  effectiveMaxHp,
  effectiveRetreatCost,
  hasAttachedEnergy,
  hasFreeRetreatAura,
  hasFreeRetreatSelf,
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
  deriveAttackEffect,
  deriveAttackRequirement,
} from "./effects";
export { rareCandyOptions } from "./cardplay";
export type { RareCandyOption } from "./cardplay";
export type {
  AttachTargetRiders,
  AttackCoinFlip,
  AttackDamageBonus,
  AttackFlipCount,
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
