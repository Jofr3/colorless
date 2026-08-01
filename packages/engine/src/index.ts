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
export const engineVersion = "0.74.0";

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
