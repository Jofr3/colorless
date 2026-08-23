import type { BasicEnergyType } from "@luminous/schema";
import { ANY_ENERGY } from "./cards";
import type { PokemonSuffix, PreventedAttackerClass } from "./cards";
import { searchTopOrderProgram } from "./effects";
import type {
  BoardCondition,
  CardFilter,
  EffectOp,
  HandPlayClass,
  PokemonPlayAct,
  PokemonType,
} from "./effects";
import type { StatusName } from "./events";
import { BENCH_MAX } from "./types";

// The id-keyed card-program registry (D8, "op programs are keyed by card id").
// It sits ABOVE the text deriver: attacks resolve `programFor(id)?.attack ??
// deriveAttackEffect(text)` (effects.ts), and Trainers/Abilities have no text
// deriver at all — an unauthored Trainer simply can't be played, an unauthored
// Ability can't be used (both surface loudly rather than guessing).
//
// This is the REPRESENTATIVE set (M4 slice 2), one card per archetype so the
// interpreter and both action paths are exercised end to end. Broad coverage
// across the SV pool is a later Workflow fan-out that adds rows here — the
// mechanics live in interpreter.ts, so a new card in a known family is a few
// lines of op data, exactly as D8 intended.

/** A card's activated Ability (§9). Passive/continuous abilities are `passive`
    below; triggered abilities are `triggered` (TriggeredAbility).

    NOTE — there is no `cost` FIELD. The printed "You must discard … from your
    hand in order to use this Ability" is the first op of `program`
    (`payFromHand`), because the general form of that cost PARKS: a field
    resolved before the program ran could only ever express the FUNGIBLE case
    (Meowscarada's Basic {G} Energy, where the copies are interchangeable and the
    first match is as good as any), and Tinkaton's "a card" is a real choice over
    the whole hand. `useAbility` still refuses the use when the cost cannot be
    paid — see cardplay.ts `handCostUnmet`. */
export interface AbilityProgram {
  name: string;
  /** §9/§15.J — usable once per turn per Pokémon (tracked in TurnAllowances).
      `true` is the DEFAULT SCOPE and the right reading for every Ability built
      before D272: the printed "Once during your turn" limits THIS BODY, so two
      Munkidori each move damage counters on the same turn.

      🆕 `"sharedByName"` is the SAME RULE AT A WIDER SCOPE — the printed "You
      can't use more than 1 <Ability name> Ability each turn" (Fezandipiti ex's
      "Flip the Script", Pecharunt ex's "Subjugating Chains", Fan Rotom's "Fan
      Call": 10 legal printings measured 2026-08-07 on `%You can't use more than
      1%`). That sentence is keyed on the ABILITY'S NAME ALONE, so three copies of
      Fezandipiti ex on one Bench share ONE use per turn.

      ⚠️ IT IS A SECOND READING OF THIS FIELD, NOT A SECOND FIELD. The scope is
      a property of the `abilitiesUsed` KEY and of nothing else, so it is spelled
      where the key is built (`abilityUsedKey`, cardplay.ts) and the three readers
      that gate on it — `useAbility`, `redactedAbilitiesOf` and the local HUD —
      all call that one helper. A separate boolean beside `oncePerTurn` could be
      set to `true` alongside `oncePerTurn: false`, which is a state with no
      printed meaning; a widened value cannot express it. */
  oncePerTurn: boolean | "sharedByName";
  /** §9 — the Ability's own PRINTED board gate, the clause between "Once during
      your turn," and the effect: Fezandipiti ex's "IF ANY OF YOUR POKÉMON WERE
      KNOCKED OUT DURING YOUR OPPONENT'S LAST TURN". Shares `BoardCondition` and
      `conditionHolds` with `trainerPlayableIf` — the same rule printed on a
      Trainer — exactly as this file's `trainerPlayableIf` doc block predicted:
      an Ability-level gate "needs its own check on `useAbility`, sharing the same
      `conditionHolds`". Checked by `useAbility` AFTER the once-per-turn lock, so
      an already-spent Ability reports `ABILITY_ALREADY_USED` rather than being
      masked by a board that happens to have gone quiet.

      ⚠️ IT IS A BOARD READ, AND MOST PRINTED "Once during your turn, if …" GATES
      ARE NOT. Of the 29 legal printings on `%Once during your turn, if %`
      (measured 2026-08-07), 15 are the Active-Spot clause `activeOnly` already
      covers, and of the 14 that remain, NINE name THIS POKÉMON — "if this Pokémon
      is on your Bench" (Meowscarada sv09-018, Misty's Psyduck sv10-045/-193), "if
      this Pokémon has any {D} Energy attached" (Munkidori ×3), "if this Pokémon's
      remaining HP is 30 or less" (Pidove sv05-133), "if this Pokémon is in your
      hand" (Klinklang sv07-101, which additionally needs the in-hand Ability
      surface this engine does not have). A per-BODY predicate is a different
      mechanism and must NOT be forced through this field: `conditionHolds` takes
      a seat and no uid, so a self-pronoun has no referent in it.

      🆕🆕 **D347 — THAT LAST RULE HAS ONE NAMED EXCEPTION, AND IT IS THE
      CONJUNCTION RATHER THAN THE PREDICATE.** This field's legal population is
      **6 printings on 2 cards and 2 `BoardCondition` members** — the 3 Fezandipiti
      ex (`yourPokemonKoedOnOpponentsLastTurn`) plus Yanmega ex `sv10-003`/
      `sv10-206`/`sv10-228` "Buzzing Boost" (`yourActivePromotedThisTurn`), whose
      printed gate is *"when this Pokémon moves from your Bench to the Active
      Spot"*. ⚠️ **`activeOnly: true` GIVES THE SELF-PRONOUN ITS REFERENT**: it pins
      the host to the one body `conditionHolds` reads, so *"your Active moved up
      this turn"* ∧ *"this Pokémon IS the Active"* is exactly *"this Pokémon moved
      up this turn"*. A per-body gate whose subject is NECESSARILY the Active is a
      board read once the spot clause is spent — which is why the nine printings
      counted above still do not belong here (none of them names the Active Spot,
      and `activeOnly` is what would have to be true, not what happens to be). */
  playableIf?: BoardCondition;
  /** 🆕 **D310 — §9's PER-BODY printed gate, and the field the block above asked
      for by name.** *"Once during your turn, if this Pokémon's remaining HP is 30
      or less, …"* — Pidove `sv05-133` "Emergency Evolution", the **only** legal
      printing of a remaining-HP clause in the catalog (`instr(abilities_json,
      'remaining HP is') > 0` over all 3,786 rows returns exactly this one, remote
      D1 `luminous`, 2026-08-10).

      🛑 **IT IS A SEPARATE FIELD FROM `playableIf` BECAUSE `conditionHolds` TAKES A
      SEAT AND NO UID**, which is exactly the argument the `playableIf` doc block
      above already makes against forcing a self-pronoun through a board read. That
      block counted NINE such printings among the 14 non-Active-Spot gates and said
      *"a per-BODY predicate is a different mechanism"*. This is that mechanism, and
      it is deliberately the NARROWEST possible spelling of it — a number, not a
      combinator. The other eight printings are three different predicates ("has
      any {D} Energy attached", "is on your Bench", "is in your hand"), so a
      general per-body condition type would be four mechanisms authored on the
      evidence of one. **When the second per-body printing lands, THAT is the slice
      that generalises this** (D190b's exact-map rule: whatever is authored is what
      the card does forever, so a narrow field that cannot be wrong beats a wide
      one that can).

      🆕🆕 **D347 ASKED WHETHER IT WAS THAT SLICE AND THE ANSWER IS NO — RECORDED
      HERE SO THE QUESTION IS NOT RE-ASKED FROM SCRATCH.** Yanmega ex "Buzzing
      Boost" prints *"when this Pokémon moves from your Bench to the Active Spot"*,
      which LOOKS like the second per-body printing and is not one: its subject is
      necessarily the ACTIVE, so `activeOnly: true` resolves the pronoun and the
      gate is expressible as `playableIf: { kind: "yourActivePromotedThisTurn" }`
      in the shared vocabulary. **A printing that the shared field can already say
      is not evidence for a private one** — that is this block's own argument read
      forward. This field therefore still serves exactly ONE printing, and the
      three predicates named above ("has any {D} Energy attached", "is on your
      Bench", "is in your hand") are still the population a generalising slice
      would have to serve.

      ⚠️ **REMAINING HP IS `effectiveMaxHp − damage`, NOT `hpOf − damage`.** The
      printed word is *"remaining"*, and a Bravery Charm on the holder moves the
      maximum — so a body at 30 damage under a Charm has 40 remaining, not 30, and
      must NOT qualify. `effectiveMaxHp` returning `null` (the catalog data gap it
      owns) makes the gate FAIL rather than pass: an unknown maximum cannot be
      shown to satisfy a printed threshold, which is `hpOf`'s own null rule and the
      direction that refuses rather than affords.

      ⚠️ **READ BY THREE SURFACES, AS `playableIf` IS**: `useAbility` (the reject),
      `redactedAbilitiesOf` (the online HUD) and `GameHud` (the local one). A gate
      only the engine can see is an afford-then-reject (D190/D222). */
  remainingHpAtMost?: number;
  /** The Ability may only be used while this Pokémon is the Active (Chien-Pao's
      "if this Pokémon is in the Active Spot"). */
  activeOnly: boolean;
  /** The Ability ENDS the controller's turn once its program completes
      (Koraidon "Dino Cry": "If you use this Ability, your turn ends."). Folded by
      flow.ts settleProgram — instead of returning to turn:action, it seeds the
      turn tail. Assumes the program does not damage (Koraidon attaches Energy). */
  endsTurn?: true;
  /** The op program `useAbility` runs (may park like a Trainer's). */
  program: EffectOp[];
}

/** When a triggered Ability (§9) fires. The four scan points:
    - `onPlayToBench` — a Basic played from hand onto the Bench during the
      controller's turn (turn.ts playBasicToBench — NOT a setup placement);
    - `onEvolve` — the controller evolved one of their Pokémon (turn.ts evolve);
    - `betweenTurns` — the Pokémon Checkup (§13, flow.ts runCheckup);
    - `onKnockOut` — this Pokémon was Knocked Out (§8.1, flow.ts KO sweep). It
      fires during the OPPONENT's turn, mid-KO-sweep, which is why the program
      folds through settleProgram with `resumeTail`: a decision PARKS and the
      sweep RESUMES draining the remaining prize/promotion stages afterwards;
    - `onDamagedByAttack` — this Pokémon, in the Active Spot, was DAMAGED by the
      opponent's attack (§9, attack.ts main-hit, even if Knocked Out — the scan
      runs BEFORE the §8.1 sweep). Fires a reactive program on the ATTACKING
      Pokémon. It ran INLINE at D99, when it was non-parking by construction (a
      Special Condition on the attacker); since Klawf ex's parking discard it goes
      through flow.ts `runDamagedTrigger` → settleProgram like the rest, which
      leaves `betweenTurns` as the ENGINE'S ONLY inline program runner (D176);
    - `onAllyActiveKnockOut` (D171) — **the controller's ACTIVE Pokémon is about
      to be Knocked Out by damage from an opponent's attack**, read on a card
      carried by a DIFFERENT, SURVIVING body (Exp. Share sv01-174, a Pokémon
      TOOL: "When your Active Pokémon is Knocked Out by damage from an attack
      from your opponent's Pokémon, you may move a Basic Energy from that Pokémon
      to the Pokémon this card is attached to").

      ⚠️ IT IS NOT `onKnockOut` WITH A DIFFERENT CONSEQUENT, AND THE DIFFERENCE IS
      **WHOSE CARD IS READ**. Every other timing above is a property of the body
      the event happened TO, so all of them are found by looking at that body's
      top card. This one is printed on a card attached to SOMEONE ELSE — the
      subject of the sentence ("your Active Pokémon") and the bearer of the
      sentence (the Tool's holder) are two different Pokémon, and only one of
      them is dying. That is why it needs its OWN board scan
      (`koToolTriggersOf`, triggers.ts) and its own stage (`koToolTrigger`,
      flow.ts) rather than a new arm on the KO sweep: by the time any `koTrigger`
      runs, `knockOut` has already sent the dying body's whole stack — INCLUDING
      the Energy this sentence moves — to the discard pile.

      🆕 D319 — AND `onEnergyAttach` IS THE SEVENTH, THE ONE MOMENT IN THIS UNION
      THAT NO CARD WATCHES FROM ITS OWN SIDE. An Energy card was attached FROM
      HAND to a Pokémon (turn.ts attachEnergy, the §6.2 once-per-turn attach —
      NOT `attachFromDeck` / `attachFromTop` / `moveEnergy`, which are other
      zones and other verbs). It exists because Gengar ex's sentence needs a
      MOMENT to hang on, and it is read ONLY in the opponent direction today
      (`opponentAction`, below) — the self direction is spelled and unpopulated,
      exactly like a union member waiting for its first printing. */
export type TriggerTiming =
  | "onPlayToBench"
  | "onEvolve"
  | "betweenTurns"
  | "onKnockOut"
  | "onDamagedByAttack"
  | "onAllyActiveKnockOut"
  | "onEnergyAttach"
  /** 🆕 D320 — the moment a seat's ACTIVE Pokémon moves to the Bench (Magcargo
      `sv05-029` "Lava Zone"). A MOMENT like every other member, and the third
      one D319's `opponentAction` direction is read against.

      🛑 IT IS THE MOVE AND NOT THE ROUTE. Retreat, a Switch/Escape Rope, an
      attack's own `switchSelf` and a Boss's Orders all reach the one funnel
      (`switchInto`, interpreter.ts) and all four are the same printed event;
      the §8.1 promotion after a Knock Out is NOT one, because the body that
      left the Active Spot went to the DISCARD and never touched the Bench. */
  | "onActiveMovedToBench";

/** A card's triggered Ability (§9) — one that FIRES on a game event rather than
    being player-activated. The framework runs `program` through the shared
    interpreter (triggers.ts): a board trigger (onPlayToBench/onEvolve, the
    controller's turn) PARKS on effect:choose like a Trainer and resumes to
    turn:action; a betweenTurns trigger is NON-PARKING by construction (a
    heal-each / a fixed counter placement) and runs synchronously inside the
    one Checkup reduction. */
export interface TriggeredAbility {
  name: string;
  trigger: TriggerTiming;
  /** The op program to run (interpreter EffectOps). */
  program: EffectOp[];
  /** "You may …": the trigger is optional. The framework currently AUTO-FIRES
      optional triggers (every representative is pure upside — search / heal /
      snipe — so declining is never strategically needed); where the underlying
      op is "up to" (searchDeck), the player can still take none. A yes/no
      confirm for a trigger with a downside is the follow-up. */
  optional?: boolean;
  /** Fires only while this Pokémon is in the Active Spot (Trevenant's "if this
      Pokémon is in the Active Spot"). Not consulted for `onKnockOut` — a
      Knocked Out Pokémon has left play, so its "when Knocked Out" Ability fires
      regardless of where it sat. */
  activeOnly?: boolean;
  /** 🆕 D319 — THE SCAN DIRECTION, AND IT IS NOT A SEVENTH TIMING.
      *"**Whenever your opponent** plays a Pokémon from their hand to evolve 1 of
      their Pokémon…"* (Team Rocket's Ampharos sv10-074 "Darkest Impulse") and
      *"**Whenever your opponent** attaches an Energy card from their hand to 1 of
      their Pokémon…"* (Gengar ex sv05-104/-193 "Gnawing Curse") name the SAME
      MOMENTS the union above already spells — an evolve, an attach — and differ
      from every other member on WHOSE ACTION is watched, which is an orthogonal
      axis. So the timing keeps naming the moment and this names the direction:
      the ability sits on the OTHER seat's board and is found by sweeping it
      (triggers.ts `runWatchedTriggers`), not by reading the body the event
      happened to.

      🛑 IT IS A GATE IN BOTH DIRECTIONS, AND THE SECOND ONE IS THE LIVE BUG IT
      PREVENTS. Ampharos is a Stage 2 that carries an `onEvolve` trigger, so the
      SELF scan (`runBoardTrigger`) would find its own row the moment its
      controller evolved Flaaffy into it and put 4 counters on the Ampharos
      itself. `triggersOf` therefore partitions on this field rather than
      filtering after the fact — one choke, two disjoint populations, and the
      §9 ability-lock still applies to both. */
  opponentAction?: true;
  /** 🆕 D319 — *"The effect of {name} doesn't stack."* — the printed clause that
      makes a SECOND copy of the same Ability contribute nothing. For a trigger
      that means the board sweep fires the ability NAME at most once, however
      many bodies print it (two Ampharos put 4 counters, not 8).

      ⚠️ THIS IS THE TRIGGER HALF OF A SIX-ABILITY QUESTION AND NOT THE WHOLE OF
      IT. Eight legal printings across six Abilities print the clause (re-measured
      at HEAD, D321, `instr(abilities_json,'oesn''t stack') > 0`); the other five
      are AURAS/passives (Bouffalant sv07-119/svp-136 "Curly Wall", Togekiss
      sv08-072 "Wonder Kiss", Ludicolo sv09-037 "Vibrant Dance", Hop's Snorlax
      sv09-117/svp-184 "Extra Helpings", Steven's Carbink sv10-086 "Stone
      Palace").

      🛑 **D321 — AND THE SENTENCE THAT USED TO STAND HERE, *"where idempotence is
      a question about `passivesOf`'s FOLD and not about a scan"*, WAS FALSE FOR
      FOUR OF THOSE FIVE.** `passivesOf` folds PER BODY over [holder passive,
      Tools, Energies] and its own comment (continuous.ts) names
      `seatDamageReductionAfterWR` and `seatDamageBonusBeforeWR` among the fields
      it does NOT carry — every aura here is SEAT-WIDE and none of them rides that
      fold. Idempotence for them is a `capped` ledger inside the SEAT SCAN, which
      `seatPreWRDamageBonus` has had since D243 and `seatDamageReduction` has had
      since D321. Only Togekiss `sv08-072` is neither a fold nor an aura scan (it
      is a PRIZE modifier on the §8.1 KO sweep) and it is the only one of the six
      whose clause still needs new code. **A doc comment that names the mechanism
      of a card it does not build is a prediction, and it rots exactly like a
      count.**

      🛑 AND ITS ABSENCE IS DRIVEN, NOT ASSUMED. Gnawing Curse does NOT print the
      clause, so two Gengar ex on one board put 2 counters EACH. The two rows are
      each other's control: same scan, same op, one flag. */
  doesNotStack?: true;
  /** `onKnockOut` only — a coin-flip Prize denial (Glimmora "Shattering
      Crystal": "flip a coin; if heads, your opponent can't take any Prize cards
      for it"). Resolved by the KO sweep itself (flow.ts collectKnockOuts), NOT
      the interpreter: it modifies the KO's Prize, and the prize/KO tail is
      flow.ts's alone (the interpreter never touches it). Kept separate from
      `program` (a general on-KO effect run as a koTrigger stage) — an on-KO
      Ability carries at most one of the two in the representative set. */
  onKoPrizeGuard?: "coinFlipPrevent";
  /** `onKnockOut` only — a CAUSE-CONDITIONED Prize REDUCTION (Munkidori ex
      sv06.5-037/-083/-091 "Oh No You Don't": "If this Pokémon is Knocked Out by
      damage from an attack from your opponent's Pokémon, and if you have any
      Pecharunt ex in play, your opponent takes 1 fewer Prize card."). Like
      `onKoPrizeGuard` it is resolved by the KO sweep (flow.ts planPrizes) rather
      than the interpreter, because it modifies the KO's Prize.

      ⚠️ A SIBLING OF `onKoPrizeGuard`, NOT A SECOND MEMBER OF ITS UNION — the two
      read sites MUTUALLY REFUSE each other's payment (D155's rule, the same shape
      that forced `damageAttackerOnKo` apart from `damageAttacker` at D164's
      predecessor D158):

        • Glimmora's clause is "When this Pokémon is Knocked Out" with NO cause
          qualifier, so it MUST still deny the Prize when its holder dies to
          poison at the Checkup or to an evolve. This field must NOT.
        • This clause names its cause ("by damage from an attack from your
          opponent's Pokémon"), so it must be REFUSED on every non-attack KO —
          and it has no coin flip, where Glimmora's is unconditional-but-flipped.
        • Glimmora ZEROES the Prize ("can't take ANY Prize cards"); this one
          DECREMENTS it ("1 FEWER"), which on an ex is 2 → 1 and not 2 → 0.

      One field carrying both would put an attack gate on Glimmora (breaking the
      Checkup KO it is printed for) and a coin flip on this one. Driven both ways.

      `requiresInPlay` is the printed board condition, matched on the card NAME
      because that is what the sentence names and the card has FOUR printings
      (Pecharunt ex sv06.5-039/-085/-093/-095). Read against the KO'd body's OWN
      side, "you" being this Ability's controller. */
  onKoPrizeReduction?: KoPrizeReduction;
}

/** 🆕 D298 — §8.1's CAUSE-CONDITIONED PRIZE REDUCTION, EXTRACTED from
    `TriggeredAbility` so an ATTACHED CARD can carry the identical sentence. The
    printed antecedent is one string with three carriers in the legal pool:

      • an ABILITY — Munkidori ex `sv06.5-037`/`-083`/`-091` (D164), which adds
        the `requiresInPlay` clause;
      • a POKÉMON TOOL — Lillie's Pearl `sv09-151`, which adds `requiresHolderOwner`;
      • a SPECIAL ENERGY — Legacy Energy `sv06-167`, which adds `oncePerGame`.

    🛑 **EVERY RIDER IS OPTIONAL AND NO PRINTING CARRIES TWO**, which is the whole
    reason this is one type rather than three: the SHARED half is the antecedent
    (*"is Knocked Out by damage from an attack from your opponent's Pokémon"*) and
    the `by` decrement, and that half is byte-identical on all three. D164 wrote
    `requiresInPlay` as REQUIRED because one carrier printed it; two more carriers
    print two DIFFERENT clauses, so requiring any of them is what would be wrong.

    ⚠️ **THE ATTACHED CARRIERS RIDE `PassiveEffects`, NOT THIS INTERFACE**, and
    that is not a second vocabulary — it is `passivesOf`'s existing `sources` array,
    which has walked the holder's Tools since §7.4 and its Energy since D174. The
    read site (flow.ts `planPrizes`) is D164's, unmoved. */
export interface KoPrizeReduction {
  /** How many Prize cards fewer. `1` on all three carriers today; CLAMPED at 0 by
      the read site, so "1 fewer" than a 1-Prize Pokémon is 0 and never −1. */
  by: number;
  /** Munkidori ex's board clause — *"if you have any Pecharunt ex in play"* —
      matched on the card NAME, scanned on the KO'd body's OWN side. */
  requiresInPlay?: string;
  /** 🆕 Lillie's Pearl `sv09-151` — *"If the **Lillie's** Pokémon this card is
      attached to is Knocked Out …"*. The OWNER PREFIX (D200/D267's subgroup
      vocabulary) read off the HOLDER's top card name, exact-case, trailing space
      load-bearing. A gate on the BODY THIS CARD IS ATTACHED TO, which is a
      different question from `requiresInPlay`'s gate on the seat's whole board —
      and the reason both riders exist rather than one. */
  requiresHolderOwner?: string;
  /** 🆕 Legacy Energy `sv06-167` — *"This effect of your Legacy Energy can't be
      applied more than once per game."* The value NAMES THE PRINTED EFFECT and is
      SHARED BY EVERY PRINTING OF IT (`sv06-167` and `fix-legacy-energy` map to one
      program and therefore to one latch), which is what the sentence says: the cap
      is on the EFFECT, not on the card instance. It is the key stamped into
      `GameState.oncePerGameSpent[seat]`.

      🛑 **THE VALUE RIDES THE FIELD BECAUSE THE FOLD DESTROYS PROVENANCE** —
      `passivesOf` returns aggregates and cannot say which attached card produced
      one. `preventDamageOnCoinFlip`'s `{ ability }` (D258) solved the identical
      problem the identical way, and it is the precedent this borrows rather than a
      new idea. Measured: `instr(effect,'once per game')` at `legal_standard = 1`
      returns exactly **1** row in the whole catalog, so the latch has one writer
      and the key is not speculative generality — it is the only shape that lets a
      SECOND printing of the cap arrive without a rename. */
  oncePerGame?: string;
}

/** §8.1 (D325) — WHAT a `PassiveEffects.hpBonusPer` counts to scale its max-HP
    grant by. Two members, one per printed sentence in the legal pool, and the
    field's own doc-block argues at length why this is not `DamageCountSource`.

    • `attachedEnergy` — *"for each {F} Energy attached to it"* (Conkeldurr
      "Craftsmanship"). Delegates to `countAttachedEnergy`, so it counts CARDS by
      PROVISION exactly as §6.3's readings of the same printed noun do: a wildcard
      Special that provides {F} counts, and one Special paying for two {F} is still
      one card. `energyType` and not a bare count — the printed sentence carries a
      type and a build that dropped it would pay a Conkeldurr for its {W}.
    • `opponentPrizesTaken` — *"for each Prize card your opponent has taken"*
      (Brambleghast "Resilient Soul"). TAKEN, not remaining: `takenPrizes`
      (types.ts) is `PRIZE_COUNT − prizes.length`, which is the same direction
      `DamageCountSource`'s identically-named member reads and the OPPOSITE of
      `BoardCondition.opponentPrizesRemaining`. Three readings of one pile, and
      naming this member after the existing one is what keeps them from drifting. */
export type MaxHpScale =
  | { kind: "attachedEnergy"; energyType: BasicEnergyType }
  | { kind: "opponentPrizesTaken" };

/** Continuous modifiers read by the pipeline while the Pokémon is in play.
    Carried by a Pokémon's own printed passive Ability (Bouffalant) OR by an
    attached Pokémon Tool (§7.4) — continuous.ts aggregates the top card's
    entry with every attached Tool's, so both sources feed one read site. */
export interface PassiveEffects {
  /** Flat HP subtracted from the attack damage this Pokémon TAKES, applied
      AFTER Weakness and Resistance (Bouffalant "Bouffer", §8.5/§15.B). */
  damageReductionAfterWR?: number;
  /** `damageReductionAfterWR` GATED on the HOLDER's own printed TYPE (Rock
      Chestplate sv01-192, a Pokémon TOOL: "The {F} Pokémon this card is attached
      to takes 30 less damage from attacks from your opponent's Pokémon (after
      applying Weakness and Resistance)."). 1 printing, and the local D1's ONLY
      Tool whose gate is an energy type on the body it is attached to.

      ⚠️ IT IS `basicHpBonus`'s PLACEMENT AND NOT `preventDamageFromType`'s, AND
      THE DIFFERENCE IS WHOSE BODY THE GATE NAMES. D159 moved a gate "from the
      printed NAME to the `Card.types` datum" and then had to resolve it at the
      READ SITES, because the body it names is the ATTACKER and `passivesOf` has
      no attacker. This gate names the HOLDER — the very body `passivesOf` is
      folding — so it is resolved INSIDE that fold against `topCardOf(...)?.types`,
      exactly as `basicHpBonus` resolves "The Basic Pokémon this card is attached
      to" against `isBasicPokemon(top)`. The DATUM is reused from D159
      (`Card.types`, `PokemonType`); the PLACEMENT is Bravery Charm's. Consequence:
      the four §8.5 read sites take a ZERO diff — the number simply arrives inside
      `damageReductionAfterWR`, which is what "one reading, one implementation"
      (D131) buys when the new source feeds a number the sites already read.

      PARAMETERISED ON THE TOKEN (D118's rule, D159's precedent): `PokemonType`
      and not `BasicEnergyType`, because the READ is `Card.types` and Colorless
      and Dragon are real Pokémon types with no Basic Energy.

      A SCALAR that SUMS, where `preventDamageFromType` had to COLLECT: two
      sources contributing two TYPES cannot be folded to one type, but two sources
      contributing two AMOUNTS fold to their sum with nothing lost — which is
      `damageReductionAfterWR`'s own idiom one field up, not a new one.

      LIVE-READ like every gate in that fold: evolving a {F} Basic into a
      non-{F} Stage 1 ends the reduction with the Tool still attached, which is
      `basicHpBonus`'s documented behaviour on the same axis. And because a Tool
      is not an Ability, a §9 Ability-lock CANNOT reach it (`passivesOf` suppresses
      only the holder's own printed passive) — the third value on the axis D159's
      table has "SUPPRESSES / SUPPRESSES / cannot reach (a Stadium)" in. */
  damageReductionAfterWRIfType?: { amount: number; type: PokemonType };
  /** §8.5 continuous OWN-SIDE seat-wide AURA: while this Pokémon is in play,
      EVERY one of its controller's in-play Pokémon takes this many HP less attack
      damage, after Weakness and Resistance (Hariyama sv02-113 "Arm Thrust
      Practice": "All of your Pokémon take 10 less damage from attacks from your
      opponent's Pokémon (after applying Weakness and Resistance)."). 1 printing.

      SHAPE — `noRetreatCostAura`'s, NOT `preventBenchDamageWhileActive`'s, and the
      printed clauses are the whole reason. Thundurus's aura scopes its SOURCE ("As
      long as this Pokémon is in the Active Spot") and its TARGET ("your BENCHED
      Pokémon"); this sentence scopes NEITHER. So the scan is `hasFreeRetreatAura`'s
      — any of the seat's own in-play Pokémon is a source, Active or Bench, and every
      one of the seat's Pokémon is a target, the source INCLUDED — with
      `opposingRetreatSurcharge`'s SUM over sources, because two Hariyama in play are
      two printed effects and a first-match scan would silently drop one. It is the
      aura-scan family's NINTH member (continuous.ts `seatDamageReduction`).

      §9-SUPPRESSIBLE through `disabledAbilityUids` like every non-lock Ability
      surface, and only a TOP card grants it (this is a printed Pokémon Ability, not
      a Tool). Hariyama is a STAGE 1, which is what decides WHICH lock can drive
      that gate: Klefki/Spiritomb reach Basics only, so the assertable lock is
      Ting-Lu ex "Cursed Land" ("your opponent's Pokémon in play that have any
      damage counters on them", any stage, except ex).

      ⚠️ FEINT ATTACK's `ignoreWR` ANSWERS PER BOARD RATHER THAN PER SITE, WHICH IS
      NEW. D151 settled the reading — "any effects on THAT Pokémon" nulls an aura
      whose SOURCE is the damaged body and leaves one whose source is another body —
      and every member since has had a constant answer because its source could never
      BE its target (Entei is the opponent's Active; Thundurus is Active and shields
      only the Bench). This aura is SELF-INCLUSIVE, so its source set CONTAINS its
      target set: a sniped Hariyama has the effect on itself and is nulled, a sniped
      TEAMMATE does not and stands. The scan therefore takes an explicit scope
      argument at the two `ignoreWR` sites rather than answering the same way at
      both (D146's required-parameter enforcement: a new site must say which).

      REACHABLE ON THE BENCH, unlike every reduction the engine has had so far.
      D147's installed half can only be live on an ACTIVE (installing needs an attack
      and leaving the spot clears it), so `spreadDamage` and `placeSnipe`'s bench arm
      have carried its term unreachably since 0.96.0. "All of your Pokémon" reaches
      them for the first time, which is why those two sites are DRIVEN here off
      printed cards rather than off a constructed record.

      🆕 **D321 — A RECORD RATHER THAN A BARE `number`, WHICH IS EXACTLY THE MOVE
      ITS PRE-W/R SIBLING BELOW MADE AT D243, AND IT BUYS THE OTHER TWO PRINTINGS
      OF THIS SENTENCE.** Hariyama's was the unmarked print — no source clause, no
      beneficiary clause, no stacking clause — so a bare amount was the honest
      shape while it was the only holder. Two legal printings narrow it and both
      cap it:

        • Steven's Carbink `sv10-086` "Stone Palace" (1 legal printing) — *"As
          long as this Pokémon is on your Bench, all of your Steven's Pokémon take
          30 less damage from attacks from your opponent's Pokémon (after applying
          Weakness and Resistance). The effect of Stone Palace doesn't stack."*
        • Bouffalant `sv07-119`/`svp-136` "Curly Wall" (2 legal printings) — *"As
          long as you have at least 1 other Bouffalant in play, all of your Basic
          {C} Pokémon take 60 less damage … The effect of Curly Wall doesn't
          stack."*

      🛑 **AND THE WIDENING COSTS THE READ SITES NOTHING, WHICH IS THE MEASURED
      REASON IT IS CHEAP RATHER THAN A HOPE.** `seatDamageReduction` is already
      handed the body being DAMAGED and already walks that seat's holders, so all
      four riders are answerable inside the one scan: the beneficiary clause is
      `matchesFilter` against the DAMAGED body's top card, the source-zone clause
      is `isOnBench` (continuous.ts, D253's predicate, in the same file), the
      "1 other" clause is a top-uid comparison against the source, and the
      stacking clause is the `capped` ledger `seatPreWRDamageBonus` has carried
      since D243. Hariyama is `legal_standard = 0`, so the field's only prior
      holder is ROTATED and the widening's whole blast radius is this file's own
      row plus that scan.

      • `beneficiary` — the printed narrowing on WHOSE POKÉMON TAKE LESS, matched
        against the DAMAGED body and against nothing else. Absent = "all of your
        Pokémon", Hariyama's bare sentence. ⚠️ **IT NARROWS THE TARGET, WHERE THE
        SIBLING FIELD'S IDENTICALLY-NAMED RIDER NARROWS THE BENEFICIARY OF AN
        ATTACK** — the two fields are on opposite ends of the damage step and the
        word means the printed subject of "take less" here. On BOTH printings the
        SOURCE is itself inside the set it pays (a Steven's Carbink is a Steven's
        Pokémon; a Bouffalant is a Basic {C} Pokémon), so a build that applied the
        filter to the SOURCE instead would be green on every board this pool can
        build — the same trap D243 wrote up one field down, arriving on the mirror
        image.
      • `sourceOnBench` — the printed *"As long as this Pokémon is on your
        Bench"*, a SOURCE-ZONE gate, and the first one any member of the aura-scan
        family has carried. ⚠️ **IT GATES THE SOURCE, NOT THE TARGET**: a benched
        Carbink shields the ACTIVE Steven's Pokémon, which is the whole point of
        the printing, and the day the Carbink is promoted the aura stops for every
        body including itself. `isOnBench` is seat-blind by construction (D253),
        so the scan needs no seat it does not already have.
      • `otherNamedInPlay` — the printed *"As long as you have at least 1 other
        Bouffalant in play"*, and the ONE rider here with no sibling anywhere.
        🛑 **IT IS SELF-EXCLUDING, WHICH IS WHY IT IS NOT `BoardCondition`'s
        `yourNamedPokemonInPlay`**: that member would be satisfied by the source
        itself and Curly Wall would pay on a lone Bouffalant, which is the exact
        board the print refuses. `conditionHolds` takes a SEAT AND NO UID — the
        argument `playableIf`'s doc block above makes against forcing a
        self-pronoun through a board read, third application — and the scan is the
        one place that HAS the uid. Compared by TOP UID against the source holder
        and matched with `byName`, so it is the printed card name and not a
        registry key.
        ⚠️ **NOT SPELLED AS "at least 2 Bouffalant in play".** That is arithmetic
        that happens to be true because the sentence is printed on a Bouffalant,
        and D190b's rule is that whatever is authored is what the card does
        forever — an exclusion is what the card prints, so an exclusion is what it
        gets.
      • `noStack` — the printed *"The effect of {AbilityName} doesn't stack."*,
        keyed by the printed ABILITY NAME for its sibling's reason: two DIFFERENT
        non-stacking auras on one board still stack with each other. **Two
        Bouffalant is the sharpest board in the family** — each sees the other, so
        `otherNamedInPlay` holds for BOTH and the pair caps at 60 rather than
        summing to 120, while a lone Bouffalant pays 0. The two riders are
        therefore each other's control on one board. */
  seatDamageReductionAfterWR?: {
    amount: number;
    beneficiary?: CardFilter;
    sourceOnBench?: true;
    otherNamedInPlay?: string;
    noStack?: string;
  };
  /** §8.5 (D243) — the SEAT-WIDE pre-W/R damage AURA: "Attacks used by your
      Pokémon do {N} more damage to your opponent's Active Pokémon (before
      applying Weakness and Resistance)" (Serperior ex `sv10.5b-003` "Regal
      Cheer", and its two owner-prefixed reprint groups below).

      🛑 IT IS `seatDamageReductionAfterWR`'s SHAPE, NOT `damageBonusBeforeWR`'s,
      AND THE PRINTED SUBJECT IS THE WHOLE REASON. Every pre-W/R bonus field above
      is folded by `passivesOf(attacker)` and therefore modifies its HOLDER alone —
      correct for a Tool ("the Pokémon this card is attached to") and for
      "attacks used by THIS Pokémon". This sentence's SOURCE is one body and its
      BENEFICIARIES are every Pokémon the seat owns, so it is read by a dedicated
      own-side scan (`seatPreWRDamageBonus`, continuous.ts) and is deliberately
      NOT in `passivesOf`'s loop. A build that folded it there would credit the
      bonus only when the Serperior itself attacked, which is the one board the
      printing is least often used on (it is a Stage 2 support body).

      §9-SUPPRESSIBLE through `disabledAbilityUids` like every non-lock Ability
      surface, and only a TOP card grants it — all seven printings are printed
      Pokémon ABILITIES, none is a Tool. The scan enforces that; the read site
      does not have to know.

      SOURCES ARE SUMMED (`seatDamageReductionAfterWR`'s answer, for its reason:
      a deck may run four copies and two in play are two printed effects) —
      EXCEPT where the print says otherwise, which is what `noStack` is.

      • `beneficiary` — the printed narrowing on WHOSE ATTACKS get the bonus,
        evaluated against the ATTACKING body's top card via `matchesFilter`.
        Absent = "your Pokémon", the bare sentence. Present = the owner-prefixed
        subgroup groups ("your Cynthia's Pokémon", "your Hop's Pokémon"), which
        reuse D200's `ownerPokemon` filter rather than growing a second spelling
        of the same possessive.
        ⚠️ IT NARROWS THE BENEFICIARY, NEVER THE SOURCE. "Attacks used by your
        Cynthia's Pokémon" says nothing about which body prints the Ability, and
        on the real card the source IS in the subgroup — so a scan that applied
        the filter to the source too would be green on every legal board and
        wrong on the printed sentence. The filter is applied ONCE, to the
        attacker.
      • `noStack` — the printed "The effect of {AbilityName} doesn't stack."
        (Hop's Snorlax "Extra Helpings"). Sources sharing a `noStack` key
        contribute their LARGEST amount once instead of summing. Stored as the
        printed ABILITY NAME rather than as a boolean because that is what the
        sentence names: two DIFFERENT non-stacking auras on one board still
        stack with each other, and a boolean would silently merge them.
        ⚠️ THE TARGET CLAUSE ("to your opponent's Active Pokémon") IS ENFORCED BY
        THE READ SITES and needs no field, exactly as `damageBonusBeforeWR`'s
        identical clause does: both pre-W/R sites hit the opponent's Active by
        construction (attack.ts's main hit, interpreter.ts `snipeActive`), and
        the three bench-reaching damage sites never fold this family at all. */
  seatDamageBonusBeforeWR?: {
    amount: number;
    beneficiary?: CardFilter;
    /** D245 — the printed narrowing on WHO IS BEING HIT, where `beneficiary`
        narrows whose attacks get the bonus: Carracosta `sv07-038` "Primal
        Knowledge" — *"Attacks used by your Pokémon do 30 more damage to your
        opponent's **Active Evolution** Pokémon"*. Matched against the DEFENDER's
        top card at the read site, which is the only place that knows it.

        🛑 **IT IS NOT `damageBonusBeforeWRIfTarget`, AND THE BACKLOG ROW THAT
        SAID SO NAMED THE WRONG SEAM.** That field is a HOLDER passive: it is
        folded by `passivesOf(attacker)`, so its source and its beneficiary are
        one body (Choice Belt, attached to the attacker). This sentence is an
        AURA — printed on a Carracosta that need not be attacking, paid to every
        body the seat owns — so it can only live on the seat-scanned field, beside
        `beneficiary`. 🆕 **A `needs` COLUMN CAN NAME A REAL FIELD AND STILL BE
        WRONG, BECAUSE THE FIELD IT NAMES IS ON THE OTHER SIDE OF A FOLD.**

        ⚠️ **AND IT IS A `CardFilter`, WHERE THE HOLDER FIELD STORES A BARE
        `PokemonSuffix`.** The printed noun here is a STAGE ("Active Evolution
        Pokémon"), which no suffix can spell; `evolutionPokemon` already spells it
        and is re-used whole, so this rider costs no new filter member. The
        "Active" word needs no field for `amount`'s own reason two doc-comments
        up: both pre-W/R read sites hit the opponent's Active by construction. */
    target?: CardFilter;
    noStack?: string;
  };
  /** 🆕 §8.1 (D323) — the SEAT-WIDE **PRIZE BONUS**: an Ability on the
      PRIZE-TAKING side that adds Prize cards for a Knock Out on the other board.
      *"When your opponent's Active Pokémon is Knocked Out, flip a coin. If heads,
      take 1 more Prize card. The effect of Wonder Kiss doesn't stack."* (Togekiss
      `sv08-072`) and *"If your opponent's Basic Pokémon is Knocked Out by damage
      from an attack used by this Pokémon, take 1 more Prize card."* (Hydreigon ex
      `sv10.5w-067`/`-161`/`-169` "Greedy Eater"). **TWO sentences, FOUR legal
      printings, and they are the WHOLE legal population** — remote D1 `luminous`,
      2026-08-10: `instr(abilities_json,'more Prize') > 0` returns 7 rows / 4
      legal, and the four are exactly these. (The three illegal ones are two
      Luxray "Swelling Flash", which reads *"more Prize cards **remaining**"* as a
      BOARD COMPARISON and grants nothing, and a rotated Chansey.)

      🛑 **IT IS THE FIRST MEMBER OF THE §8.1 PRIZE FAMILY THAT IS NOT ON THE
      DYING BODY, AND THAT IS THE WHOLE REASON IT IS A SEAT SCAN RATHER THAN A
      SIBLING OF `onKoPrizeReduction`.** Every prize modifier the engine has had
      — Munkidori ex's `onKoPrizeReduction`, Glimmora's `onKoPrizeGuard`, D298's
      attached `Legacy Energy`/`Lillie's Pearl` reductions — is read off the
      Knocked Out Pokémon itself (`onKnockOutTrigger(state, ref.uid)`, its own
      attachments). These two are printed on a body that is merely IN PLAY on the
      OPPONENT of the KO'd seat, and it need not be Active, need not be damaged,
      and (for Wonder Kiss) need not have attacked. So the read is
      `seatKoPrizeBonuses` (continuous.ts), the aura-scan family's ELEVENTH
      member, walking `otherSeat(ref.seat)`'s holders.

      • `ability` — the printed Ability NAME, and REQUIRED, unlike the two
        `noStack: string` siblings above. The log owes an `ABILITY_TRIGGERED` row
        naming the Ability (the coin flip is player-visible and rng-advancing, so
        a silent +1 is not an option), and no passive field carries a name today.
        Given the name is here anyway, `noStack` is a BOOLEAN and keys the ledger
        on `ability` — the same key the sibling fields store by hand, spelled once.
      • `koSpot` — the printed *"your opponent's **ACTIVE** Pokémon"* (Wonder
        Kiss). ⚠️ **NOT VACUOUS**: the Checkup sweep and the mid-turn evolve sweep
        both scan FULL BOARDS, so a benched body can be the `ref` here (a
        `spreadDamage`/`placeSnipe` counter finishing a Bench sitter at the
        Checkup). Absent = any spot, which is Greedy Eater's sentence — it says
        "your opponent's Basic Pokémon" with no spot word at all.
      • `koTarget` — the printed narrowing on the DYING body (Greedy Eater's
        *"Basic Pokémon"*), matched with `matchesFilter` against the KO'd card and
        against nothing else. `basicPokemon` already spells it, so this rider
        costs no new filter member — the same reuse D322 made when it replaced a
        draft's bespoke `targetEvolution` with the existing `CardFilter`.
      • `byThisPokemonsAttack` — the printed *"by damage from an attack used by
        **this Pokémon**"* (Greedy Eater). 🛑 **A STRICTLY NARROWER CLAUSE THAN
        `onKoPrizeReduction`'s, WHICH IS WHY IT IS A NEW ARGUMENT AND NOT A REUSE
        OF `attackerSeat`.** Munkidori ex reads "by an attack from your opponent's
        Pokémon" — a SEAT question, which `attackerSeat` answers. This one names
        the attacking BODY, so `collectKnockOuts` now threads `attackerUid`
        beside `attackerSeat` (`finishAttack` already has it in hand for the
        `koRecoilOf` counterattack, so the thread costs one parameter and no new
        lookup, and the other two call sites omit BOTH).
      • `coinFlip` — Wonder Kiss's *"flip a coin. If heads"*. Resolved inside
        `planPrizes`, which already threads rng through `flipCoin` for Glimmora's
        guard, so the flip happens exactly once per KO and the §14 tie guard sees
        the post-flip count. Absent = the bonus is unconditional (Greedy Eater).
      • `noStack` — the printed *"The effect of Wonder Kiss doesn't stack."*
        **THE SIXTH AND LAST OF THE SIX ABILITIES THAT PRINT THAT CLAUSE**
        (re-measured at HEAD, D323: `instr(abilities_json,'oesn''t stack') > 0` is
        still 10 rows / 8 legal / 6 Abilities). Two Togekiss flip ONCE and pay
        ONCE, where two Hydreigon ex — which print no such clause — are each
        other's control and pay TWICE. */
  koPrizeBonus?: {
    ability: string;
    amount: number;
    koSpot?: "active";
    koTarget?: CardFilter;
    byThisPokemonsAttack?: true;
    coinFlip?: true;
    noStack?: true;
  };
  /** Flat HP added to the attack damage this Pokémon DEALS to the opponent's
      Active, applied BEFORE Weakness and Resistance (Vitality Band). Only
      attacks that already do damage get it (a 0-damage attack stays 0). */
  damageBonusBeforeWR?: number;
  /** Like `damageBonusBeforeWR`, but applied ONLY while a board condition holds
      for the ATTACKING seat (Defiance Band — "If you have more Prize cards
      remaining than your opponent, the attacks of the Pokémon this card is
      attached to do 30 more damage to your opponent's Active Pokémon (before
      applying Weakness and Resistance)"). The D40 `BoardCondition` vocabulary's
      third consumer (a passive, after the `trainerPlayableIf` play gate and the
      `conditionGate` branch op). Aggregated seat-FREE by continuous.ts; the
      condition is evaluated at the two pre-W/R read sites (attack.ts main hit,
      interpreter.ts snipeActive) via the shared `conditionHolds` — the only
      sites that know the attacker's seat, which a BoardCondition is relative to. */
  damageBonusBeforeWRIf?: { amount: number; cond: BoardCondition };
  /** Like `damageBonusBeforeWR`, but applied ONLY when the DEFENDER (the
      opponent's Active being hit) is a Pokémon of a given rule-box suffix
      (Choice Belt — "…do 30 more damage to your opponent's Active Pokémon V
      (before applying Weakness and Resistance)"). The target-gated sibling of
      `damageBonusBeforeWRIf`: that one reads the ATTACKER's seat-relative board
      (a `BoardCondition`), this one reads the DEFENDER's printed suffix
      (`pokemonSuffixOf`), so it is a distinct field rather than the D40
      vocabulary. Aggregated seat-free by continuous.ts; the defender is known
      only at the two pre-W/R read sites, which fold it via `attackerPreWRBonus`
      (interpreter.ts) exactly like the board-condition one. */
  damageBonusBeforeWRIfTarget?: { amount: number; targetSuffix: PokemonSuffix };
  /** Max-HP added while the holder's TOP card is a Basic Pokémon (Bravery
      Charm — "The Basic Pokémon this card is attached to gets +50 HP");
      evolving the holder ends it, the Tool staying attached notwithstanding.
      This is the one effect that can LOWER effective max HP on evolution: a
      charmed Basic damaged into the window is Knocked Out the instant it
      evolves (§8.1), which `evolve` now checks via the mid-turn KO flow (M4
      slice 4 — turn.ts evolve → flow.ts resolveMidTurnKnockOuts). */
  basicHpBonus?: number;
  /** §8.1 (D324) — max-HP added to the holder with NO STAGE CLAUSE AT ALL: "The
      Pokémon this card is attached to gets +100 HP" (Hero's Cape `sv05-152`), and
      the same sentence with a printed OWNER on the beneficiary ("The Cynthia's
      Pokémon this card is attached to gets +70 HP", Cynthia's Power Weight
      `sv10-162`). Two legal printings, both Tools.

      🛑 IT IS A SECOND FIELD AND NOT A LOOSENING OF `basicHpBonus` ONE LINE UP,
      AND THE FOLD ITSELF PREDICTED THIS EXACT ROW. `passivesOf`'s D174 source
      audit says of `basicHpBonus`: *"an Energy-borne +HP would end on evolution
      exactly as Bravery Charm's does. That is the right reading of 'the BASIC
      Pokémon this card is attached to' and the WRONG one for a printing that said
      only 'this Pokémon' — such a printing must use a stage-free field, not this
      one."* Hero's Cape is that printing. Widening `basicHpBonus` by dropping its
      `isBasic` gate would have given Bravery Charm a bonus that survives evolution
      — the one behaviour its own doc-block says is load-bearing — so the two
      numbers are summed at the same accumulator and gated separately.

      ⚠️ THE OBSERVABLE DIFFERENCE IS EVOLUTION, AND IT IS DRIVEN BOTH WAYS. A
      Basic under a Bravery Charm LOSES its +50 the instant it evolves (and can be
      Knocked Out mid-turn for it, §8.1); a Basic under a Hero's Cape KEEPS its
      +100 through the same evolution with the same Tool attached. One board,
      two Tools, opposite answers.

      • `beneficiary` — Cynthia's Power Weight's printed *"The **Cynthia's**
        Pokémon"*. `matchesFilter` against the holder's TOP card, so it is live-read
        like every other holder clause in the fold: a Cynthia's Basic that evolves
        into a non-Cynthia's Stage 1 loses the +70 while keeping the Tool, which is
        `basicHpBonus`'s behaviour on the OTHER axis of the same idiom. `undefined`
        (an unreadable top card) fails the filter — `matchesFilter`'s conservative
        direction everywhere in this file, and here it means an unreadable body
        gets LESS HP, never more.

      • `requiresEnergyType` (D325) — Okidogi "Adrena-Power" `sv06-111` /
        `sv06.5-074` / `sv08.5-057`, *"If this Pokémon has any {D} Energy attached,
        it gets +100 HP, …"*. THREE legal printings, and the FOURTH holder-gate
        axis this fold carries: `isBasic` is STAGE, `holderTypes` is TYPE, `onBench`
        is SPOT, and this is ATTACHED ENERGY. It sits on THIS field rather than
        earning its own because the printed grant is character-for-character the
        stage-free one — *"it gets +100 HP"* with no stage clause and no owner —
        and only the leading `If` is new; `beneficiary` is the precedent for
        exactly that move one bullet up.

        ⚠️ **IT IS `hasAttachedEnergy` AND NOT `countAttachedEnergy`** — the
        printed word is *"any"*, so ONE {D} pays the whole +100 and four pay the
        same +100. The per-energy reading is the field below, and the two must not
        be confused: Conkeldurr prints *"for each"* and this prints *"any"*.

        🛑 **IT IS THE FIRST HP TERM IN THE ENGINE THAT CAN SHRINK WITHOUT THE
        HOLDER CHANGING CARD.** Bravery Charm's +50 ends on EVOLUTION and Cynthia's
        Power Weight's +70 ends when the top card stops matching — both are changes
        to `top`. This one ends when the last {D} Energy LEAVES, which moves no card
        in the stack at all, and §8.1 says a body whose max HP drops to or below its
        damage is Knocked Out. `resolveMidTurnKnockOuts` has exactly THREE call
        sites (turn.ts) and a discard-from-play is not necessarily one of them, so
        this is RECORDED rather than claimed: the shrink is observable through
        `effectiveMaxHp` immediately, and whether a mid-turn sweep runs for it is
        the same open seam D324 recorded for Gravity Mountain on the play. */
  hpBonus?: { amount: number; beneficiary?: CardFilter; requiresEnergyType?: BasicEnergyType };
  /** §8.1 (D325) — max HP added to the holder ONCE PER SOMETHING COUNTED ON THE
      LIVE BOARD, where every other field in this family is FLAT. Two printed
      sentences, both the holder's own Ability:

      • Conkeldurr "Craftsmanship" `sv10.5b-049` / `sv10.5b-127` — *"This Pokémon
        gets +40 HP for each {F} Energy attached to it."* TWO legal printings.
      • Brambleghast "Resilient Soul" `sv05-021` — *"This Pokémon gets +50 HP for
        each Prize card your opponent has taken."* ONE legal printing.

      🛑 **`MaxHpScale` IS A NEW TWO-MEMBER UNION AND DELIBERATELY *NOT*
      `DamageCountSource`**, which already prints both of these counts
      (`energyOnSelf`, `opponentPrizesTaken`) and would have been free to import.
      It is refused because that union has TWELVE members and TEN of them are
      meaningless as a max-HP multiplier — `damageCountersOnSelf` would make max HP
      a function of the damage measured against it (a body that takes damage grows
      the bar the damage is compared to, which is not a printed sentence anywhere
      and is a live feedback loop through `effectiveMaxHp`), and `boardCondition`
      is a predicate rather than a count at all. D131's rule pointed at a TYPE: a
      read site must not be handed channels its pool cannot mean. The two members
      here are the two the pool prints, and a third arrives with its printing.

      ⚠️ **THE ARITHMETIC IS `amount × count` AND THE COUNT IS ZERO-ABLE**, which
      is the whole reason this needs no floor of its own: a Conkeldurr with no {F}
      attached and a Brambleghast on the first turn both add EXACTLY 0, so the
      field is an ADDEND in every board state and `effectiveMaxHp`'s D324
      `Math.max` invariant is untouched by it. Gravity Mountain remains the
      engine's only subtrahend.

      🛑 **AND THE TWO MEMBERS DIFFER ON MONOTONICITY, WHICH IS OBSERVABLE.**
      `attachedEnergy` can go DOWN — a discarded {F} costs Conkeldurr 40 max HP
      with no card in its stack moving, exactly the shrink `requiresEnergyType`
      one field up records. `opponentPrizesTaken` can only go UP: `takenPrizes` is
      `PRIZE_COUNT − prizes.length` and no rule in §8.1 puts a Prize back, so
      Brambleghast's grant is MONOTONE and can never Knock its own holder Out.
      One field, two answers to "can this KO the body it is written on", and the
      difference is printed rather than chosen. */
  hpBonusPer?: { amount: number; scale: MaxHpScale };
  /** §8.1 (D324) — the SEAT-WIDE max-HP AURA: *"All of your Pokémon in play get
      +40 HP. The effect of Vibrant Dance doesn't stack."* (Ludicolo `sv09-037`,
      ONE legal printing, and the SIXTH and LAST of the `doesNotStack` Abilities).

      🛑 IT IS AN AURA AND NOT A `hpBonus`, WHICH IS THE WHOLE OF THE DIFFERENCE
      BETWEEN THIS FIELD AND THE ONE ABOVE. `hpBonus` is folded by `passivesOf`
      out of the body's OWN sources (its top card, its Tools, its Energy); this is
      a fact about a DIFFERENT body standing beside it, so it is read by a board
      scan (`seatMaxHpBonus`, continuous.ts) exactly as `seatDamageReductionAfterWR`
      is. A Ludicolo raises the HP of every teammate including ITSELF — the printed
      subject is "all of your Pokémon in play" and the source is inside that set —
      so the scan's scope is `all` and there is no `othersOnly` twin.

      • `ability` — the printed name, carried for `noStack`'s ledger key rather
        than for a log row (this aura writes no event; a max-HP change is observed
        through `effectiveMaxHp`, never announced).
      • `noStack` — the printed *"The effect of Vibrant Dance doesn't stack."*
        ⚠️ **AND IT IS THE LEDGER'S SHAPE THAT IS THE CLAIM, NOT ITS PRESENCE**:
        keyed on the ABILITY NAME, so two Ludicolo cap at +40 while a Ludicolo
        standing beside a hypothetical differently-named non-stacking HP aura would
        still take both. `seatDamageReduction`'s `Math.max` ledger verbatim — the
        LARGEST single contribution per key — and not `seatKoPrizeBonuses`' entry
        cap, because this is arithmetic and that one is not (a coin flip is not an
        amount, an HP total is).

      🛑 **AND IT IS THE FIELD THAT MADE `effectiveMaxHp`'s FLOOR NECESSARY** —
      see `StadiumEffects.hpDelta` below, which is where the negative arrives. */
  seatHpBonus?: { amount: number; ability: string; noStack?: true };
  /** §9 reactive recoil: when this Pokémon is DAMAGED by an opponent's attack
      while in the Active Spot, this many HP of damage counters land on the
      Attacking Pokémon — even if this Pokémon is Knocked Out. attack.ts folds it
      in right after DAMAGE_DEALT, BEFORE finishAttack's §8.1 both-board sweep, so
      a lethal retaliation KOs the attacker and is prized to this Pokémon's side.
      Counterattack Quills (Cacnea/Cacturne, `amount: 30`) fires whenever the
      Active is damaged; Custom Trap (Stunfisk, `amount: 50` + `requiresTool`)
      fires only while the holder has a Pokémon Tool attached. The "in the Active
      Spot" clause is enforced by the READ SITE — only the main-hit Active
      defender retaliates (a benched holder damaged by spread does not) — so no
      `activeOnly` flag is needed. Aggregated seat-free by continuous.ts, which
      evaluates `requiresTool` against the holder's board so the read site stays
      a plain summed number. (Snipe/spread hits on the Active are a follow-up: the
      recoil is folded only at the §8.5 main hit for now.) */
  damageAttacker?: { amount: number; requiresTool?: boolean };
  /** §8.1 KO-conditioned recoil — the SIBLING of `damageAttacker` above, and a
      sibling rather than an arm of it because the two consumers MUTUALLY REFUSE
      each other's payment (D155's rule, grounded in the READ sites):

        • `damageAttacker` pays on `dealt > 0` at the §8.5 main hit and REFUSES a
          KO that its own damage did not cause. Vengeful Punch must not fire when
          its holder is merely damaged.
        • this one pays on "lethal at the §8.1 sweep" and REFUSES mere damage.
          Rocky Helmet must fire on a hit its holder SURVIVES.

      Folding them into one field would fire Rocky Helmet twice on a lethal hit
      (once at §9, once at the sweep) and fire Vengeful Punch on every scratch. So
      it is a second field with a second read site, not a flag on the first.

      The one printing is Vengeful Punch sv03-197, a Pokémon TOOL: "If the Pokémon
      this card is attached to is Knocked Out by damage from an attack from your
      opponent's Pokémon, put 4 damage counters on the Attacking Pokémon." Stored
      in HP like all four of `damageAttacker`'s printings (4 printed counters =
      `amount: 40`), so the two numbers stay summable in the units the read sites
      already speak.

      ⚠️ AND NOTE THE CLAUSE THAT IS NOT PRINTED HERE. Rocky Helmet says "is in
      the Active Spot"; this card does not. So a BENCHED holder finished off by a
      snipe or a spread retaliates just as an Active one does — which is why the
      read site scans the KO'd side's WHOLE board (flow.ts `koRecoilOf`) where
      `damageAttacker`'s reads only the main-hit Active. The absent clause is the
      whole difference between the two scans, and it is asserted in
      vengefulPunch.test.ts rather than left to the reader.

      No `requiresTool` arm: the Tool IS the source (the Rocky Helmet precedent),
      and no printing gates this shape on a second Tool. A field nothing reads is
      the D156 defect, so it is not speculatively added. */
  damageAttackerOnKo?: { amount: number };
  /** 🆕 §8.1 (D298) — the CAUSE-CONDITIONED PRIZE REDUCTION borne by an ATTACHED
      CARD. See `KoPrizeReduction` for the vocabulary; the two printings that reach
      this field are

        • Lillie's Pearl `sv09-151` — a Pokémon TOOL: *"If the Lillie's Pokémon
          this card is attached to is Knocked Out by damage from an attack from
          your opponent's Pokémon, that player takes 1 fewer Prize card."*
        • Legacy Energy `sv06-167` — a Special ENERGY carrying the same sentence
          without the owner clause and with a once-per-game cap
          (`energy.passive`, D174's third source class).

      🛑 **THE SIBLING DIRECTLY ABOVE IS WHY THIS FIELD IS FREE**, and it is not an
      analogy — `damageAttackerOnKo` is Vengeful Punch `sv03-197`, whose printed
      antecedent is BYTE-IDENTICAL to these two (*"If the Pokémon this card is
      attached to is Knocked Out by damage from an attack from your opponent's
      Pokémon…"*) and whose read site (flow.ts `koRecoilOf`) already proves that a
      §8.1 sweep can fold an attached card's clause off a body it is about to
      destroy. This field is that read, one consequent over.

      ⚠️ **AND IT IS COLLECTED AS A LIST, NOT SUMMED**, unlike its sibling. Two
      attached sources on one body can genuinely disagree about their RIDERS (one
      capped, one not; one owner-gated, one not), so the fold must hand the read
      site every entry and let each answer its own antecedent. A summed `by` would
      spend Legacy Energy's once-per-game latch on a Prize that Lillie's Pearl
      reduced. */
  onKoPrizeReduction?: KoPrizeReduction;
  /** §8.1 KO SURVIVAL — "If this Pokémon has full HP and would be Knocked Out by
      damage from an attack, it is not Knocked Out, and its remaining HP becomes
      10." (Pikachu ex "Resolute Heart" sv08-057/-219/-238/-247, sv08.5-179;
      Crustle "Sturdy" sv10.5b-052/-130 — 7 printings, 7 Standard-legal, TWO
      Ability names for ONE byte-identical sentence.)

      ⚠️ THIS IS A CLAMP AT THE DAMAGE WRITE, NOT A FIFTH KO-DETECTION SITE, AND
      THE ANTECEDENT IS THE WHOLE REASON. "has full HP" is a fact about the
      PRE-damage board. The engine's four KO/post-KO detection sites
      (`onKnockOutTrigger`, `triggersOf`, `passivesOf`'s sweep readers,
      `koToolTriggersOf`) and flow.ts's ONE lethality test `isLethallyDamaged` all
      read `pokemon.damage` AFTER the hit has been added, so by the time any of
      them runs the pre-hit value is GONE and "did this body have full HP" is
      unanswerable. D199's remainder row filed this as a hook on the KO sweep for
      exactly that reason and the placement is wrong: the sweep cannot see the
      antecedent. It is read instead at the four sites where the pre-damage value
      is still in scope — the §8.5 damage WRITES (continuous.ts `koSurvivalClamp`,
      called from attack.ts's main hit and interpreter.ts's `spreadDamage`,
      `placeSnipe`'s `deals` arm and `snipeActive`) — which needs no new detection
      site at all. D171 bought the FOURTH at a high price; this slice buys none.

      A BARE FLAG in this fold rather than a read off `top`, and that buys the §9
      answer: both printings are ABILITIES, so an Ability-lock must switch the
      clamp off — which the `disabled` drop on `sources[0]` already does. That is
      `suppressTargetEffectsOnAttack`'s reasoning (D192) verbatim.

      ⚠️ "damage from an attack" IS THE ENGINE'S EXISTING BOUNDARY, NOT A NEW ONE.
      A PLACED COUNTER IS NOT DAMAGE (D138/D139/D142, and the catalog prints the
      rule on Bronzong sv03-145: "(Damage is not an effect.)"), so every
      `COUNTERS_PLACED` write — the put-counter snipe, `counterPut`, the counter
      MOVE, `damageSelf`'s recoil, and the Checkup's poison and burn (flow.ts) —
      is correctly OUT of this clamp's reach and gets no call. The clamp rides the
      four `DAMAGE_DEALT` emitters and nothing else, which is the same line the
      §8.5 pipeline already draws for Weakness, Resistance and every reduction
      passive.

      ⚠️ THE TOOL TWIN IS A SEPARATE SLICE AND IS DELIBERATELY NOT BUILT. Survival
      Brace sv06-164 (1 Standard-legal) prints this sentence with "from your
      opponent's Pokémon" narrowing the attacker AND a second sentence — "Then,
      discard this card." — that this field cannot express: a passive fold has no
      way to consume its own source, and the discard is a STATE WRITE that would
      have to happen at the clamp site with the Tool's uid in hand. It needs a
      self-discard rider; flagged, priced, not taken. */
  survivesKoAtFullHp?: true;
  /** §9 continuous Ability-lock AURA: while this Pokémon is in play (and, when
      `requiresActive`, in the Active Spot), every in-play Pokémon matching the
      target predicate "has no Abilities" — the engine suppresses its activated /
      passive / triggered Abilities at every read site (continuous.ts
      `disabledAbilityUids`, consulted by useAbility, passivesOf, triggersOf and
      the HUD redactor by top uid). Unlike every other `PassiveEffects` field this
      one does NOT modify its holder — it reaches OTHER Pokémon — so continuous.ts
      reads it through a dedicated both-boards scan rather than the per-Pokémon
      `passivesOf` aggregation, and it is a printed Pokémon Ability so only the TOP
      card grants it (never an attached Tool). Klefki "Mischievous Lock" (Basic,
      both sides, except itself), Spiritomb "Fettered in Misfortune" (Basic V, both
      sides), Ting-Lu ex "Cursed Land" (the opponent's DAMAGED Pokémon, except ex).
      The aura is collected UNGATED (a lock never turns itself — or another lock —
      off): the aura-disables-aura fixpoint (e.g. Ting-Lu ex vs a damaged Klefki) is
      a documented follow-up, not this slice. */
  disableAbilities?: {
    /** Target must be this stage (Klefki/Spiritomb: "Basic"); omitted = any stage
        (Ting-Lu, whose "Pokémon in play" carries no stage restriction). */
    stage?: "Basic";
    /** Target must carry this printed rule-box suffix (Spiritomb: "V"). */
    suffix?: PokemonSuffix;
    /** Which side the lock reaches: "both" (Klefki/Spiritomb — "both yours and
        your opponent's") or the source's "opponent" (Ting-Lu — "your opponent's
        Pokémon"). */
    side: "both" | "opponent";
    /** Target must have damage counters on it (Ting-Lu — "that have any damage
        counters on them"). */
    requiresDamage?: boolean;
    /** The aura is live only while the SOURCE is in the Active Spot ("As long as
        this Pokémon is in the Active Spot" — Klefki/Ting-Lu). Spiritomb omits it. */
    requiresActive?: boolean;
    /** A target with this rule-box suffix keeps its Abilities (Ting-Lu: "ex" —
        "except for Pokémon ex"). */
    exemptSuffix?: PokemonSuffix;
    /** A target whose printed Ability is named this keeps it (Klefki:
        "Mischievous Lock" — "except for Mischievous Lock"). Matched against the
        target CARD's printed abilities; keeps a mirror-match Klefki's own lock on. */
    exemptAbilityNamed?: string;
  };
  /** §8.5 continuous own-board AURA: while this Pokémon is in play, every one of
      its CONTROLLER's in-play Pokémon "has no Weakness" — the two Weakness read
      sites (attack.ts main hit, interpreter.ts snipeActive) null this seat's
      defenders' Weakness before the pipeline (Resistance is untouched). Like
      `disableAbilities` it reaches OTHER Pokémon rather than modifying its holder,
      so continuous.ts reads it through the dedicated `seatRemovesWeakness` scan,
      not the per-Pokémon `passivesOf` aggregation, and only a TOP card's printed
      Ability grants it. Florges sv01-093 "Blooming Garden" ("Your Pokémon in play
      have no Weakness") is the only print in the sv01–03 pool: own board only,
      unconditional, and NO "in the Active Spot" clause (it works from the Bench),
      so a bare flag carries it — a future opponent-side or conditional print
      would add fields then. Bench Pokémon never take Weakness-modified damage in
      the first place (§8.5 applies only to the Active/Defending Pokémon), so the
      only observable effect is on the seat's Active while it defends. */
  removeWeakness?: true;
  /** §8.5 continuous ATTACKER-side suppression (D192): "Damage from attacks used
      by this Pokémon isn't affected by any effects on your opponent's Active
      Pokémon." — Walking Wake ex "Azure Seas" (sv05-050/-189/-205/-215,
      sv08.5-178, svp-127; **6 printings, all 6 Standard-legal**, and the ONLY
      sentence in the whole legal pool that prints this rule as an Ability,
      measured over `abilities_json` against the remote D1 `luminous` on
      2026-08-04).

      ⚠️ **THE FIRST HOLDER-MODIFYING PASSIVE THAT MODIFIES THE HOLDER'S OWN
      ATTACKS RATHER THAN WHAT IT TAKES.** Every other `passivesOf` field on this
      interface is read off the DEFENDER (`damageReductionAfterWR`,
      `preventDamageFromExV`, `statusImmunities`) or off the attacker as a NUMBER
      folded by `attackerPreWRBonus`. This one is a BOOLEAN read off the attacker,
      so attack.ts gained an attacker-side `passivesOf` read it did not have —
      reached through continuous.ts `attackerSuppressesTargetEffects`, the shape
      `boostedAttackDamage` and `installedAttackDebuffOf` already use to ask the
      attacker a question.

      ⚠️ **IT RIDES `passivesOf` AND NOT A DEDICATED SCAN, WHICH IS THE WHOLE
      REASON IT IS THIS FIELD AND NOT `removeWeakness`'s SHAPE.** `removeWeakness`
      reaches OTHER Pokémon (a seat-wide aura) so it needs its own board walk;
      this one modifies its holder and nothing else, so `passivesOf` is the right
      home — and the §9 Ability-lock drop comes for free, which is load-bearing:
      "Azure Seas" IS an Ability, and Klefki "Mischievous Lock" must silence it.

      ⚠️ **STORAGE IS NOT SHARED WITH THE ATTACK HALF, THE READ SITE IS.** The
      printed attack sentence ("This attack's damage isn't affected by any effects
      on your opponent's Active Pokémon.", 15 legal printings) sets
      `AttackDamageSuppression.targetEffects` — a PARSE of one attack's text,
      alive for one declaration. This is a CATALOG fact about a body, alive while
      it is in play and §9-suppressible. The two meet at exactly one `||` in
      attack.ts's §8.5 block, which is this repo's standing rule: the unit of
      sharing is decided by the READ SITE, the unit of storage by the WRITE
      SITES. */
  suppressTargetEffectsOnAttack?: true;
  /** §8.5 continuous holder-modifying PREVENTION: prevent ALL attack damage this
      Pokémon TAKES from an opponent's Pokémon ex / Pokémon V (Mimikyu sv02-097
      "Safeguard"). The defender-side twin of `damageReductionAfterWR` — a full
      null instead of a flat subtraction — but GATED on the ATTACKER's rule-box
      class (`isExOrV`, i.e. ex or V, NOT VMAX/VSTAR/GX). Because the attacker's
      class is known only at the read sites, continuous.ts just reports whether
      the holder carries the aura; the sites gate it on `isExOrV(attacker)`. Like
      the reduction it modifies only its holder, so it rides `passivesOf` and is
      honored at EVERY attack-damage site (main hit, spread, both snipe arms):
      Safeguard has NO "in the Active Spot" clause, so it protects the holder on
      the Bench too. The only ex/V-gated total-prevention print in the sv01–03
      pool — the type-gated Dachsbun/Bellibolt "prevent all damage from {R}/{L}"
      are a separate family needing an energy-type gate, not this one (they landed
      at D159 as `preventDamageFromType` directly below, and this sentence is why
      they are a SIBLING field rather than a widening of this one). A bare flag:
      unconditional once the holder is in play. */
  preventDamageFromExV?: true;
  /** §8.5 continuous holder-modifying PREVENTION, gated on the ATTACKER's printed
      TYPE: prevent ALL attack damage this Pokémon TAKES from an opponent's
      Pokémon of `type` (Dachsbun sv01-099 "Well-Baked Body" — `{R}`; Bellibolt
      sv03-078/-201 "Insulator" — `{L}`; 3 printings / 2 sentences, censused
      against the local D1 as its own question).

      `preventDamageFromExV`'s TWIN one field up on every axis but the gate, and
      deliberately a SIBLING rather than a widening of it. Three grounds, all
      structural rather than stylistic:
        • the two gates read DIFFERENT CATALOG COLUMNS. The rule box is derived
          from the printed NAME (`pokemonSuffixOf`, and D146's `Ancient` finding is
          precisely about what happens when a class has no column at all); a type
          is the `Card.types` datum Weakness and Resistance already read. One is a
          name parse, the other a field;
        • the two FOLD differently. The ex/V flag ORs to a boolean over
          `passivesOf`'s sources; a type must COLLECT, because two sources can name
          two types and a scalar fold would silently be last-wins (the shape
          `damageBonusBeforeWRIf` is already under — an optional scalar HERE, a
          list in the aggregation);
        • merging them would change the return type `passivesOf` hands three read
          sites that have nothing to do with this printing, for no printed gain.

      PARAMETERISED ON THE TOKEN rather than split into `preventDamageFromFire` /
      `preventDamageFromLightning`, which is D118's rule applied where the evidence
      is thinnest and `opponentActiveHasType` (effects.ts) is the direct precedent:
      exactly one token varies, it is byte-identical to a value in `Card.types`,
      and the vocabulary is CLOSED at eleven names. `PokemonType` and not
      `BasicEnergyType` because the READ is `Card.types.includes` — Colorless and
      Dragon are real Pokémon types with no Basic Energy, so typing the field with
      the energy vocabulary would make a `{C}`/Dragon printing unspellable while
      buying nothing.

      Like the ex/V flag it modifies only its HOLDER, so it rides `passivesOf`
      (and is therefore §9-suppressible, and nulled by Feint Attack's `ignoreWR`
      at the two snipe arms — both are effects ON the damaged Pokémon), and the
      attacker is known only at the read SITES, which resolve it through
      continuous.ts `preventsAttackerType`. Neither printing carries an "in the
      Active Spot" clause, so it protects a benched holder too.

      ⚠️ DACHSBUN'S SENTENCE IS THE SECOND HALF OF ITS PRINTED ABILITY. The first —
      "This Pokémon can't be Burned." — is `statusImmunities` one field down, built
      at D172. It gates the §12 APPLICATION path rather than the §8.5 damage pipeline,
      which is why the two clauses of ONE printed Ability are TWO fields on this
      interface and share nothing but the card. */
  preventDamageFromType?: PokemonType;
  /** §8.5 continuous holder-modifying PREVENTION, gated on whether the ATTACKER
      HAS AN ABILITY: "Prevent all damage from attacks done to this Pokémon by your
      opponent's Pokémon that have an Ability." — Cornerstone Mask Ogerpon ex
      "Cornerstone Stance" `sv06-112`/`-199`/`-215` and `sv08.5-058`/`-160`, **5 printings on ONE sentence, all 5 Standard-legal**,
      measured over `abilities_json` with `legal_standard = 1` against the remote D1
      `luminous` on 2026-08-07. The BIGGEST cheap unbuilt ability group in the pool
      at D251.

      THE THIRD MEMBER OF THE ATTACKER-PROPERTY PREVENT FAMILY and a SIBLING field
      for `preventDamageFromType`'s three grounds re-run one attribute over:
        • the gates read DIFFERENT CATALOG COLUMNS. `preventDamageFromExV` is a NAME
          parse (`pokemonSuffixOf`), the type gate is `Card.types`, and this one is
          `Card.abilities` — an ingested nullable array, read by `cards.ts
          hasPrintedAbility`. **That column is the reason this row is cheap where
          D243's Ancient/Future banner was unbuildable: the banner has no column at
          all, this one does;**
        • it FOLDS like the ex/V flag and not like the type list. A boolean OR,
          because the gate names no VALUE — two sources cannot disagree about it, so
          the fold is lossless where a scalar type fold would be last-wins
          (continuous.ts `PassiveEffects.preventDamageFromHasAbility` argues it in
          full, and the writer count is the standing rule it applies);
        • merging it into either neighbour would change the return type `passivesOf`
          hands read sites with nothing to do with this printing, for no printed gain
          — D172's "two printings, two gates, two fields" verbatim.

      ⚠️ THE PRINTED SENTENCE IS "PREVENT ALL DAMAGE **FROM ATTACKS**", NOT "FROM AND
      EFFECTS OF ATTACKS", AND THE DIFFERENCE IS WHY THIS FIELD IS NOT WIDER. Its
      nearest neighbour on the same axis — `sv10.5b-023`/`-107`, "…by your opponent's
      Pokémon that have any Special Energy attached" — DOES carry the effects half,
      so it is a second RULE rather than a second value of this gate and is
      deliberately not spellable here. A bare flag: unconditional once the holder is
      in play, no Active-Spot clause, so it protects a benched holder too. */
  preventDamageFromHasAbility?: true;
  /** §8.5/§11 FULL PREVENTION, GATED ON THE ATTACKER'S ATTACHED ENERGY — AND THE
      FIRST MEMBER OF THIS FAMILY THAT STOPS EFFECTS AS WELL AS DAMAGE. Carracosta
      "Mighty Shell" `sv10.5b-023`/`-107`:

        "Prevent all damage from and effects of attacks done to this Pokémon by
         your opponent's Pokémon that have any Special Energy attached."

      **2 printings on ONE sentence, both Standard-legal**, measured over
      `abilities_json` with `legal_standard = 1` against the remote D1 `luminous` on
      2026-08-07, GROUPED BY SENTENCE.

      THE FOURTH MEMBER OF THE ATTACKER-PROPERTY PREVENT FAMILY, and the three
      grounds D251 gave for a sibling field re-run one attribute over:
        • the gates read DIFFERENT THINGS, and this one does not read a CATALOG
          COLUMN at all. `preventDamageFromExV` is a NAME parse, the type gate is
          `Card.types`, D251's is `Card.abilities` — this one is the BOARD
          (`continuous.ts attackerHasSpecialEnergy` → `hasAttachedEnergy(…,
          "special")`). **That is the reason this row is cheap where D243's
          Ancient/Future banner was unbuildable, arriving by a different route: the
          banner has no column AND no board fact; this gate needs no column because
          the board already answers it;**
        • it FOLDS like the ex/V flag and D251's — a boolean OR, because the gate
          names no VALUE;
        • merging it into `preventDamageFromHasAbility` would be the WORST of the
          three merges available, because the two differ on the EFFECTS half rather
          than on the attacker predicate: five printings would silently acquire a
          protection their text does not print.

      ⚠️ **THE PRINTED "FROM AND EFFECTS OF" IS THE FIELD'S WHOLE POINT, AND THE
      ENGINE ALREADY HAD THE FUNNEL.** interpreter.ts `attackEffectRefused` is the
      one gate all eight attack-borne effect ops consult, and it read only the
      INSTALLED §11 block (`attackBlockOf(...).effects`) until this row; the aura
      channel now joins it there. So the effects half costs ONE gate and not eight,
      which is the measured answer to the question D251's handoff called "the whole
      unknown". A bare flag: unconditional once the holder is in play, no
      Active-Spot clause, so the DAMAGE half protects a benched holder too. */
  preventDamageAndEffectsFromSpecialEnergy?: true;
  /** §8.5 + §11 PREVENTION, THE WIDE SPELLING WITH NO ATTACKER PROPERTY AND A
      HOLDER-ZONE GATE (D253):

        "As long as this Pokémon is on your Bench, prevent all damage from and
         effects of attacks from your opponent's Pokémon done to this Pokémon."

      **3 printings on ONE sentence** — Poltchageist `sv06-020`/`sv06-171` and
      ⚠️ 🛑 **`sv10-048`, WHICH IS `Misty's Magikarp` AND NOT `Sinistcha`** —
      corrected at D305, having read "Sinistcha `sv10-048`" here since D253. Remote
      D1 `luminous`, 2026-08-09: `sv10-048` is `Misty's Magikarp`, its Ability is
      **"So Submerged"**, and its `evolve_from` is **NULL**, so it is not an
      evolution of anything. The real `Sinistcha` is **`sv06-022`** and is not in
      this registry at all. **THE COUNT OF 3 AND THE SHARED OBJECT ARE BOTH
      CORRECT** — all three printings really do print this one sentence — which is
      exactly why D254's re-derivation of the COUNT could not catch it.

      ✅ **THE COUNT WAS UNVERIFIED AT D253 AND IS MEASURED AT D254.** The remote
      D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a) answered `403 code 7403`
      ("account is not authorized") to every query at D253, so the 3/1 was D252's
      transcribed row. D254 re-ran it (`abilities_json`, `legal_standard = 1`,
      `LIKE '%and effects of attacks%'`, GROUPED BY SENTENCE) and the row returns
      **3** on these exact three ids, inside a family of **9 printings on 4
      sentences**. The `programFor` join over the 376 legal ability units returns
      **136** at D253's commit, agreeing with the increment to the digit.
      ⚠️ **AGREEING IS NOT THE SAME AS HAVING BEEN MEASURED**, which is why D253's
      flag was worth carrying for a commit and why the streak resumes at D254
      rather than being back-dated over it.

      THE FIFTH MEMBER OF THE PREVENT FAMILY AND THE FIRST WHOSE GATE NAMES NEITHER
      THE ATTACKER NOR A CARD:
        • the four before it all narrow the ATTACKER (`isExOrV`, `Card.types`,
          `Card.abilities`, the board's Special Energy) and all four therefore pay a
          predicate call at every read site. This one narrows only WHERE ITS OWN
          BODY IS STANDING, so it is resolved once inside `passivesOf` — which can
          answer it because that function takes `(GameState, InPlayPokemon)` and
          locating a body needs exactly those two. **The rule this settles, and it
          is D161's line generalised: a HOLDER gate folds; an ATTACKER gate cannot
          fold anywhere but a read site.**
        • it FOLDS like all four — a boolean OR, because the gate names no VALUE;
        • merging it into `preventDamageAndEffectsFromSpecialEnergy` would break in
          BOTH directions at once: Carracosta's two printings would acquire a
          protection needing no Special Energy, and these three would acquire one
          that needs it. Two disjoint antecedents on one consequent are two fields.

      ⚠️ **AND THE BENCH CLAUSE IS WHAT MAKES THREE OF THE FIVE READ SITES DEAD.**
      §8 aims an attack at an ACTIVE, so `attack.ts`'s main hit, `snipeActive` and
      `attackEffectRefused` (which resolves `state.players[seat].active`) can never
      see this flag true — the EFFECTS half of the printed sentence is structurally
      unreachable on today's op set. It is guarded at all five anyway and only the
      two BENCH arms (spread, `placeSnipe`) carry mutants. */
  preventDamageAndEffectsWhileBenched?: true;
  /** §8.5 continuous holder-modifying PREVENTION, GATED ON THE ATTACKER'S PRINTED
      RULE-BOX CLASS — the SIXTH member of the prevent family and the first whose
      gate is PARAMETERISED since D159's type list. TWO Standard-legal sentences,
      FIVE printings, measured over `abilities_json` with `legal_standard = 1`
      against the remote D1 `luminous` on 2026-08-07, GROUPED BY SENTENCE:

        "Prevent all damage done to this Pokémon by attacks from your opponent's
         Pokémon ex."                              — 3 printings
          Sylveon `sv08.5-040` "Safeguard"; Crustle `sv10-012`/`-186`
          "Mysterious Rock Inn"

        "Prevent all damage done to this Pokémon by attacks from your opponent's
         Basic Pokémon ex."                        — 2 printings
          Farigiraf ex `sv05-108`/`-194` "Armor Tail"

      🛑 **IT IS NOT `preventDamageFromExV`, AND THE ONE-CHARACTER DISTANCE IS THE
      REASON THIS IS A FIELD AND NOT A REUSE.** Mimikyu `sv02-097` prints "…your
      opponent's Pokémon ex **and Pokémon V**"; these five print ex ALONE. Handing
      them `preventDamageFromExV` would silently widen all five printings to stop
      every Pokémon V in the pool — a protection none of them prints — which is the
      exact failure D251 refused when it declined to merge into `preventDamageFrom
      Type`. Two disjoint printed classes on one consequent are two fields.

      ⚠️ **A LIST HERE AND A SCALAR-PER-WRITER, WHICH IS `preventDamageFromType`'s
      SHAPE AND NOT D251's.** The standing rule is that the unit of STORAGE is
      decided by the WRITE SITES, and the question a gate asks its writers is "can
      two of you disagree": `preventDamageFromHasAbility` and `preventDamageAnd
      EffectsFromSpecialEnergy` name no VALUE, so an OR over N sources is lossless
      and both are flags. THIS GATE NAMES A VALUE — `{ suffix: "ex" }` and
      `{ suffix: "ex", stage: "basic" }` are two different printed classes — so a
      scalar fold in `passivesOf` could only be last-wins the day two SOURCES land on
      one body. Hence an optional SCALAR on this interface (one printing, one class)
      collected to a LIST in the aggregation, exactly as the type gate has been since
      D159. ⚠️ **NO SUCH BOARD EXISTS TODAY** — no Tool and no Energy writes this
      field, and two HOLDERS are two separate folds, which is a distinction the first
      draft of the aggregation's doc block got wrong and the mutation harness caught.
      The list is the aggregation's SHAPE, not an observable behaviour;
      `PassiveEffects.preventDamageFromAttackerClasses` argues it in full.

      ⚠️ **A RECORD AND NOT A FLAT `"ex" | "basicEx"`** — `AttackerClass`'s D239
      cross-product argument, re-derived on this vocabulary in `cards.ts
      PreventedAttackerClass`, which also argues why `stage` is ABSENT rather than
      `null` and why `suffix` is required where `stage` is not.

      ⚠️ **THE PRINTED SENTENCE IS "PREVENT ALL DAMAGE", NOT "FROM AND EFFECTS OF",
      SO THIS IS THE NARROW SPELLING AND HAS FOUR READ SITES RATHER THAN FIVE** —
      `preventDamageFromExV`/`FromType`/`FromHasAbility`'s shape, not D252's.
      `interpreter.ts attackEffectRefused` is deliberately NOT widened: none of the
      five printings carries the effects half, and a field that reached that funnel
      would hand them a protection their text does not print.

      Like every member of the family it modifies only its HOLDER, so it rides
      `passivesOf` (and is therefore §9-suppressible — all five printings ARE
      Abilities — and nulled by Feint Attack's `ignoreWR` at the two snipe arms).
      The ATTACKER is known only at the read SITES, which resolve it through
      `cards.ts preventsAttackerClass`. Neither sentence carries an "in the Active
      Spot" clause, so both protect a benched holder too. */
  preventDamageFromAttackerClass?: PreventedAttackerClass;
  /** §8.5 FULL DAMAGE PREVENTION ABOVE A PRINTED THRESHOLD (D257):

        "Prevent all damage done to this Pokémon by attacks from your opponent's
         Pokémon if that damage is 200 or more."

      **1 printing on ONE sentence** — Drednaw `sv07-044` "Impervious Shell",
      backlog row **15-B** and the LAST buildable member of the `%prevent all
      damage%` ability census (22 printings on 9 sentences; the only other residue
      is the permanently unbuildable 3-printing TERA group).

      🛑 **THE FIRST GATE IN THIS FAMILY WHOSE SUBJECT IS THE NUMBER.** Its seven
      predecessors narrow by a fact about a CARD (`preventDamageFromExV`,
      `preventDamageFromType`, `preventDamageFromHasAbility`,
      `preventDamageFromAttackerClass`), about the BOARD
      (`preventDamageAndEffectsFromSpecialEnergy`), or about a ZONE
      (`preventDamageAndEffectsWhileBenched`, `preventBenchDamage*`). This one
      narrows by the ARITHMETIC of §8.5 — which is why it could not be priced by
      asking what a read site knows about the attacker, and why it is cheap: D240
      already hoisted the number and named it `wouldDeal` at all four damage arms
      for the INSTALLED cap, so the aura channel arrives to a binding already in
      scope at every site.

      ⚠️ **A NUMBER, NOT A BOOLEAN AND NOT A LIST** — this family's third
      aggregation shape, and the standing rule (*"a gate that names a VALUE cannot
      be a boolean"*) picks it out for a reason worth spelling. A BOOLEAN loses
      which threshold. A LIST — D255's answer for `preventDamageFromAttackerClass`
      — would be right if two entries described two DISJOINT antecedents both of
      which must be tested; two thresholds describe two NESTED damage sets, so
      exactly one of them can ever matter and the fold can decide which. It is
      `Math.min`: the LOWER threshold shields strictly more, so keeping it is the
      only fold under which both sources' printed sentences remain true.
      ⚠️ UNREACHABLE today (one printing; no Tool or Energy writer), so the min is
      DECLARED in the mutation corpus rather than driven — `preventDamageFromType`'s
      standing precedent, and D255's lesson applied before the harness had to teach
      it again.

      ⚠️ **IT IS INCLUSIVE, AND THE INCLUSIVITY IS THE PRINTED WORD.** *"200 or
      more"* — an exactly-200 hit is prevented. `AttackBlock.maxDamage` (D240) is
      the OPPOSITE polarity on the identical clause, and the two are deliberately
      NOT one field: that one is a §11 INSTALLATION with a turn's life written onto
      the target's own record, this is a catalog AURA with none, and the attack
      column prints ZERO `or more` sentences (re-measured at D257) so a merged
      comparator would have a writer on one side only. **Price the CHANNEL, not the
      token** — D240's own finding, collected here.

      §9-suppressible: the one printing IS a Pokémon Ability, so it rides
      `passivesOf` and Klefki's lock switches it off. Read at the FOUR damage sites
      and NOT at `attackEffectRefused` — an EFFECT has no damage for a threshold to
      be about, which is D240's ruling for the installed twin, verbatim. */
  preventDamageAtOrAbove?: number;
  /** §8.5 FULL DAMAGE PREVENTION ON A COIN FLIP (D258) — the EIGHTH member of the
      prevent family and the FIRST WHOSE ANSWER IS NOT A FUNCTION OF THE BOARD:

        "If this Pokémon has any {D} Energy attached and is damaged by an attack,
         flip a coin. If heads, prevent that damage."   Fezandipiti `sv06-096` /
                                                        `sv06.5-073` / `sv08.5-045`
                                                        "Adrena-Pheromone" — 3;
        "If any damage is done to this Pokémon by attacks, flip a coin. If heads,
         prevent that damage."                          Kecleon `sv08-150`/`-213`
                                                        "Expert Hider" — 2.

      **5 Standard-legal printings on TWO sentences**, backlog row **15-C**, and the
      row was found only because D257 WIDENED THE VERB: every rung of D255's ladder
      swept *"prevent **all** damage"* and these five say *"prevent **that**
      damage"*, so a census that had been correctly re-run four times could never
      have returned them.

      ⚠️ **THE SECOND SENTENCE IS THE FIRST WITH ITS ANTECEDENT DROPPED, SO IT IS ONE
      FIELD AND NOT TWO.** Kecleon prints no Energy clause; Fezandipiti's is *"has
      any {D} Energy attached"* — a fact about the HOLDER's attachments, which is
      `damageAttacker.requiresTool`'s shape exactly (D98: the conjunct is resolved
      inside `passivesOf`, which already holds the body AND the state, so the read
      sites never see it). `requiresEnergyType` ABSENT means *"any damage"*, which is
      what every printing without the clause means — D205's optional-key rule.
      ⚠️ **AND IT IS THE HOLDER'S SIDE, NOT THE ATTACKER'S**: D252's
      `attackerHasSpecialEnergy` reads the ATTACKING body's attachments and is the
      wrong function; this reads the DEFENDING body's, through the standing
      `hasAttachedEnergy` predicate (continuous.ts, D118) — by PROVISION, so a
      wildcard Luminous Energy counts for exactly as long as it provides {D}.

      🛑 **`ability` IS DATA ON THE FIELD, AND THAT IS THE ONE THING THIS RECORD DOES
      THAT NO OTHER PASSIVE FIELD DOES.** Every sibling above folds to a value the
      read site consumes silently; this one has to ANNOUNCE itself, because a flip
      the player cannot see is indistinguishable from a rule that fired for no
      reason — and `GameEvent`'s `ABILITY_COIN_FLIP` (which already exists, for
      Glimmora's on-KO flip) carries an `ability` string. A fold DESTROYS provenance
      (attack.ts's `damageAttacker` block is this repo's standing statement of that:
      one number, two possible granting cards, no label that could be true), so the
      name cannot be recovered downstream and must travel WITH the entry or not at
      all.

      ⚠️ **A LIST ON THE FOLD, AND THE REASON IS NOT THE ONE THE FAMILY HAS USED SO
      FAR.** D251's rule: the unit of storage is decided by the WRITE SITES, and the
      question is not "how many" but "can two of you disagree". D255's two sentences
      disagree about a VALUE; these two do not — they name the same flip and the same
      consequence. But two sources on one body still print two separate *"flip a
      coin"* instructions, so they disagree about **how many coins are drawn**, which
      is the first time in this family that an OR over N sources is LOSSY for a
      reason other than a parameter. The fold therefore collects and the funnel flips
      once per entry, in order. ⚠️ UNREACHABLE today (no Tool and no Energy prints the
      sentence, and no Pokémon prints it twice), so the per-entry flip is DECLARED in
      the mutation corpus rather than driven — D255's lesson, applied up front.

      §9-suppressible: all five printings ARE Pokémon Abilities, so this rides
      `passivesOf` and Klefki's lock switches it off — which matters more here than
      anywhere else in the family, because a suppressed holder must not burn an RNG
      step (a replay that draws a different number of coins is not a replay).
      Read at the FOUR damage sites through ONE funnel (`coinFlipShieldPrevents`) and
      NOT at `attackEffectRefused`: *"prevent that damage"* has no effects half, so
      the field is the NARROW spelling like D251's and D255's, not D252's. */
  preventDamageOnCoinFlip?: { ability: string; requiresEnergyType?: BasicEnergyType };
  /** §12 STATUS IMMUNITY: the printed Special Conditions this body can never be
      given (Dachsbun sv01-099 "Well-Baked Body" — "This Pokémon can't be Burned.";
      Pachirisu sv01-068/-208 "Electricity Pouches" — "This Pokémon can't be
      Paralyzed."; Therapeutic Energy sv02-193 — "…can't be affected by those
      Special Conditions", meaning Asleep, Confused and Paralyzed). 4 printings /
      3 sentences authored here, ONE read site (interpreter.ts `applyStatus`), and
      NOTHING in the §8.5 pipeline.

      ⚠️ IT GATES THE APPLICATION AND NOT THE CHECKUP, AND THAT IS A MEASURED
      CLAIM RATHER THAN A SIMPLIFICATION. Every remainder list since D159 priced
      this family as "one gate at `applyStatus` AND the Checkup". `applyStatus` is
      the ENGINE'S ONLY WRITER of a §12 condition — flow.ts `runCheckup` and
      turn.ts/interpreter.ts's three `noConditions()` sites only ever CLEAR — so a
      body that cannot be given a status cannot arrive at the Checkup carrying one.
      The one route that could have made the Checkup gate real is a §9 lock that is
      live when the status lands and dead by the Checkup, and it is UNREACHABLE in
      this pool for a reason worth writing down: every status source and every
      §9 lock source must occupy an ACTIVE SPOT, and there are only two of those
      (statusImmunity.test.ts drives the argument). A Checkup gate would therefore
      be a second reading of the same rule that no board could ever disagree with —
      D131's drift, bought for nothing.

      ⚠️ A LIST SINCE D174, AND THE WIDENING IS THE RULE APPLIED RATHER THAN A
      PREFERENCE. D172 made this a SCALAR here and a list in `passivesOf`, which is
      `preventDamageFromType`'s shape one field up, and it counted its WRITERS to get
      there: two, each naming exactly one condition, so nothing that existed needed
      to spell two. The repo's rule is *the unit of SHARING is decided by the READ
      site, the unit of STORAGE by the WRITE sites* — and D174 adds the THIRD writer,
      Therapeutic Energy sv02-193, which names THREE. The scalar could no longer
      SPELL a writer, so it widened. D172 named this exact counter-case and declined
      it on the ground that the writer "cannot reach it": an Energy is not a top card
      and not a Tool, so `passivesOf` could not see it. `EnergyProgram.passive` (one
      interface down) is what closed that gap, so the reason to keep the scalar
      expired with it. The alternative — a plural field on the ENERGY surface beside
      a scalar here — would be two shapes for ONE reading feeding ONE fold, which is
      exactly the drift D131 warns about.

      `StatusName[]` and not a bespoke union because the READ is `op.status` on
      `applyStatus`, whose vocabulary is the closed five-value union already —
      D159's "type the field with the datum the read site uses" on the other
      pipeline. ⚠️ AND IT IS THE TOKEN LIST RATHER THAN "the rotation slot", even
      though sv02-193's three names are EXACTLY `SpecialConditions.rotation`'s three
      non-none values: that coincidence is a fact about one printing, and a build
      that keyed on the slot would be unable to spell a printing naming two of the
      three (D118's parameterise-on-the-token rule).

      §9-SUPPRESSIBLE only for the sources that are ABILITIES, which is decided by
      `passivesOf`'s fold and not here: a locked holder's own printed passive is
      dropped, an attached Tool's is kept, and an attached ENERGY's is kept (D174 —
      an Energy is not an Ability). */
  statusImmunities?: StatusName[];
  /** §12 RECOVERY (D174): the printed Special Conditions this body is CLEARED of
      while this effect is live — Therapeutic Energy sv02-193's first clause, "The
      Pokémon this card is attached to RECOVERS FROM BEING Asleep, Confused, or
      Paralyzed…". One printing, one read site (flow.ts `recoverStatuses`).

      ⚠️ A SECOND FIELD BESIDE `statusImmunities` AND NOT A FLAG ON IT, because the
      card prints TWO clauses and the other two printings in the family print only
      one of them. Dachsbun and Pachirisu say "can't be Burned/Paralyzed" and say
      NOTHING about recovering, so an immunity that implied a recovery would make
      those two cards clear a condition their text never mentions. That is D172's own
      call on Dachsbun's two clauses ("two printed sentences, two fields") pointed at
      a card whose two clauses happen to name the SAME tokens — and "those Special
      Conditions" naming the same three is a fact about this printing, not about the
      mechanism, which is why the two lists are written out twice rather than derived
      from each other.

      ⚠️ IT IS A WRITE AND NOT A DERIVED VIEW, WHICH IS THE WHOLE REASON IT IS NOT
      "another `applyStatus` gate". "Recovers from" is a ONE-WAY state change: a
      Pokémon that has recovered is not Asleep again when the Energy is later
      discarded. A build that subtracted the list at the condition READ sites would
      resurrect the condition the moment the source left, which no printing says. So
      the condition is genuinely REMOVED, and the invariant "no body carries a
      condition a live effect recovers it from" is restored at the named moments an
      effect can newly arrive (flow.ts). */
  statusRecovery?: StatusName[];
  /** §8.5 continuous OWN-SIDE cross-body AURA: while this Pokémon is in the Active
      Spot, every one of its CONTROLLER's BENCHED Pokémon takes no attack damage at
      all (Thundurus sv03-070 "Adverse Weather" — "As long as this Pokémon is in
      the Active Spot, prevent all damage done to your Benched Pokémon by attacks
      from your opponent's Pokémon"). One printing, and the pool's only zone-scoped
      prevention.

      ⚠️ IT IS IN THE ATTACKER-FILTER FAMILY BY CENSUS ADJACENCY AND FILTERS NO
      ATTACKER AT ALL. §D146 grouped it with Dachsbun/Bellibolt because the four
      sentences share the string "by attacks from"; this one's object is "your
      opponent's Pokémon", i.e. every attacker there is. What it narrows is the
      PROTECTED body — the Bench — which is why it cannot be a `preventDamageFrom…`
      refinement and is a scan instead.

      SHAPE — `seatRemovesWeakness`'s, not `passivesOf`'s, and for that field's
      reason verbatim: it does NOT modify its holder (the holder is the ACTIVE and
      the protection lands on the BENCH), so continuous.ts reads it through a
      dedicated own-side scan (`benchShieldedFromDamage`). It is the EIGHTH member of
      the aura-scan family and inherits its three answers: the DERIVED SEAT (find
      the side holding this top uid — here the side is the holder's OWN, which is
      what makes it the family's first same-seat cross-body member), BOTH clauses
      ENFORCED BY THE SCAN rather than by an `activeOnly` field (the SOURCE must be
      Active, the TARGET must be Benched), and the §9 gate through
      `disabledAbilityUids`, this being a printed Pokémon Ability that only a TOP
      card grants.

      NOT nulled by Feint Attack's `ignoreWR`, unlike every field above it: that
      clause scopes "any effects on THAT Pokémon" and this aura's source is a
      different body entirely — the holder's own Active. D151's reading at
      `placeSnipe`'s bench arm, applied to a prevention instead of a subtraction.
      ⚠️ **THAT ANSWER IS A FACT ABOUT *THIS* FIELD'S SOURCE CLAUSE, NOT ABOUT THE
      SCAN**, which D254 discovered by giving the scan a second field whose source
      clause is absent — see `preventBenchDamageAndEffects` and the `scope`
      parameter `benchShieldedFromDamage` now takes. */
  preventBenchDamageWhileActive?: true;
  /** §8.5 + §11 PREVENTION, THE WIDE SPELLING OVER THE WHOLE OWN BENCH, WITH NO
      ATTACKER PROPERTY AND NO SOURCE CLAUSE AT ALL (D254):

        "Prevent all damage from and effects of attacks from your opponent's
         Pokémon done to your Benched Pokémon."

      **1 printing on ONE sentence** — Rabsca `sv05-024` "Spherical Shield", the
      LAST rung of the 4-sentence "and effects of attacks" family D252 censused
      (9 printings; 6 of 6 addressable now built, the 3-printing TERA group
      permanently out of reach). Re-derived at this commit.

      ⚠️ **IT IS *NOT* `preventBenchDamageWhileActive` IN A WIDER SPELLING, AND THE
      SLICE THAT ASSUMED IT WAS WOULD HAVE SHIPPED A DIFFERENT CARD.** Two D253
      handoffs and two comment blocks in this file re-homed `sv05-024` as
      "`benchShieldedByActive`'s shape". It shares that field's TARGET clause
      ("your Benched Pokémon") and has NO source clause whatsoever, where Thundurus
      prints "As long as this Pokémon is in the Active Spot". D245's rule caught
      it: the answer is in the printed string, and the printed string was one
      query away. Merging the two would hand Thundurus a bench-standing source it
      does not print and hand Rabsca an Active-only one it does not print either —
      two disjoint antecedents on one consequent are TWO FIELDS (D252/D253's rule,
      third application).

      ⚠️ **ITS SOURCE SET CONTAINS ITS TARGET SET, WHICH NO EARLIER MEMBER OF THE
      AURA-SCAN FAMILY MANAGED EXCEPT `seatDamageReductionAfterWR`.** A benched
      Rabsca is one of "your Benched Pokémon", so it shields ITSELF — where
      Thundurus, standing in the Active Spot, is structurally immune to its own
      shield. That is the exact condition `seatDamageReduction`'s doc block says
      forces a `scope` argument, and D151's Feint Attack reading then splits per
      BOARD rather than per site: a sniped Rabsca loses its own shield
      ("othersOnly"), a sniped TEAMMATE keeps it ("all"), off one declaration of
      one printed attack. `benchShieldedFromDamage` therefore takes `scope` and
      `benchShieldedFromEffects` does not — `ignoreWR` scopes an attack's DAMAGE
      and has nothing to say about a status or a forced switch.

      READ AT FIVE SITES like its four `passivesOf` siblings, but through a SCAN
      and not the fold, for `preventBenchDamageWhileActive`'s reason verbatim: it
      does not modify its HOLDER, it reaches other bodies. ⚠️ **AND IT COSTS THE
      READ SITES NOTHING**, because `benchShieldedFromDamage` was already the SOLE
      FUNNEL at all four damage arms — the widening happens inside one function
      instead of as four new disjuncts. The EFFECTS half needs the fifth site and
      is STRUCTURALLY DEAD there (`attackEffectRefused` resolves
      `state.players[seat].active`, so a Bench-scoped refusal has no reachable
      board today); it is written for TOTALITY and carries no mutant, D253's rule.

      A BOOLEAN, by the standing rule its siblings settled: the gate names no
      VALUE, so an OR over N sources is lossless. §9-suppressible per SOURCE
      through `disabledAbilityUids` — this is a printed Pokémon Ability, so only a
      TOP card grants it and a lock silences that one source without touching the
      others. */
  preventBenchDamageAndEffects?: true;
  /** §8.5 PREVENTION OVER THE OWN BENCH, NARROWED ON THE *PROTECTED* BODY'S PRINTED
      RULE BOX (D256):

        "Prevent all damage done to your Benched Pokémon that don't have a Rule Box
         by attacks from your opponent's Pokémon. (Pokémon ex, Pokémon V, etc. have
         Rule Boxes.)"

      **2 printings on ONE sentence** — Shaymin `sv10-010`/`-185` "Flower Curtain",
      the LARGEST buildable row left in the `%prevent all damage%` ability census
      (22 printings on 9 sentences, re-derived at this commit) and its FIRST member
      whose narrowing sits on the DEFENDING side of a bench-wide aura.

      ⚠️ **THE THIRD FIELD ON `benchShieldedFromDamage`, AND THE FIRST THAT IS NOT
      A NEW SOURCE CLAUSE.** The three differ on a 3-vector of printed clauses and
      no two agree on all of it:

        field                             SOURCE          HALF            TARGET
        preventBenchDamageWhileActive     own Active      damage          your Bench
        preventBenchDamageAndEffects      (none)          damage+effects  your Bench
        preventBenchDamageNoRuleBox       (none)          damage          your Bench
                                                                          ∧ no Rule Box

      It takes Rabsca's absent source clause and Thundurus's damage-only half, so it
      is a *new combination of old answers plus one genuinely new conjunct* — which
      is precisely why it is a third boolean rather than a rider. A merge into
      either neighbour is observable on a real board in BOTH directions: folded into
      `preventBenchDamageAndEffects` it would give Shaymin a bench-wide status
      immunity it does not print; folded the other way it would strip the Rule-Box
      conjunct and shield the opponent-facing Pokémon ex on the Bench, which is the
      exact body the sentence is written to EXCLUDE.

      ⚠️ **AND IT COSTS THE READ SITES NOTHING, THE FUNNEL RULE PAYING A SECOND
      TIME.** `benchShieldedFromDamage` has been the SOLE funnel at all four damage
      arms since D159 and gained `scope` at D254; this sentence is a widening INSIDE
      that one function — **zero new disjuncts at `attack.ts` or `interpreter.ts`,
      zero signature changes, zero new predicates** (`cards.ts hasRuleBox` is the
      target filter and has existed since D159's Neutralization Zone).

      A BOOLEAN, by the standing rule: the gate names no VALUE, so an OR over N
      sources is lossless. §9-suppressible per SOURCE through `disabledAbilityUids`
      — a printed Pokémon Ability, so only a TOP card grants it. Its source set
      CONTAINS its target set for the second time in this family (a benched Shaymin
      has no Rule Box, so it shields itself), which is why the `scope` argument
      D254 added is REQUIRED here rather than merely available. */
  preventBenchDamageNoRuleBox?: true;
  /** §11 continuous HOLDER-relative PREVENTION whose SOURCE IS A TRAINER — the
      first member of the prevent family that is not about an attack at all:

        "Whenever your opponent plays an Item or Supporter card from their hand,
         prevent all effects of that card done to this Pokémon."

      **4 legal printings on ONE sentence** — Fraxure `sv06.5-045`/`sv06.5-077`
      "Unnerve"; Cetitan ex `sv10-065`/`sv10-210` "Snow Camouflage" — measured over
      `abilities_json` with `legal_standard = 1` against the remote D1 `luminous`
      (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-07, GROUPED BY SENTENCE,
      with the attack and effect columns returning ZERO for the same predicate.

      ⚠️ **A HOLDER RULE, THEREFORE A `passivesOf` FOLD** — the printed object is
      *"this Pokémon"*, the body the fold is already about. Contrast
      `preventSupporterEffectsWhileActive` directly below, whose object is a body
      the holder is NOT and which therefore cannot ride this fold at all. Same
      family, same funnel, opposite sides of the fold/scan line — the split D159
      first drew and D253/D254 last exercised.

      ⚠️ **AND ITS TARGET CAN BE ON THE BENCH, WHICH IS WHAT MAKES IT THE FIRST
      LIVE BENCH ARM THIS FUNNEL HAS EVER HAD.** D253's and D254's effects halves
      are structurally dead because every ATTACK-borne op aims at an Active. A
      Trainer does not: Crushing Hammer's `opponentChosen` discard and Boss's
      Orders' gust both name a BENCHED body. So `effectRefused` had to stop
      resolving `state.players[seat].active` and start taking the target, and this
      field is the reason.

      ⚠️ **EFFECTS ONLY, AND THE SENTENCE HAS NO DAMAGE HALF AT ALL** — no legal
      Item or Supporter in scope deals damage, so there is nothing for a damage
      half to be about. Nothing in the §8.5 pipeline reads this.

      A BOOLEAN by the standing rule: the gate names no VALUE, so an OR over N
      sources is lossless — and unlike D258's coin flip it consumes nothing, so a
      second writer would change neither the answer nor the cost.
      §9-suppressible: all four printings ARE Pokémon Abilities, so this rides
      `passivesOf` and Klefki's lock switches it off. */
  preventTrainerEffects?: true;
  /** §11 continuous SEAT-WIDE PREVENTION whose SOURCE IS A TRAINER — the
      `preventTrainerEffects` sentence with both of its clauses moved:

        "As long as this Pokémon is in the Active Spot, whenever your opponent
         plays a Supporter card from their hand, prevent all effects of that card
         done to all of your Pokémon."

      **1 legal printing** — Rhyperior `sv07-076` "Wide Wall", the other row of the
      same 2026-08-07 census. It differs from the field above on BOTH printed
      clauses and on neither by accident:

        field                                SOURCE       TRIGGER          TARGET
        preventTrainerEffects                (anywhere)   Item|Supporter   the holder
        preventSupporterEffectsWhileActive   own Active   Supporter only   the whole seat

      ⚠️ **SO IT IS A SCAN AND NOT A FOLD.** `passivesOf` folds PER BODY (read its
      signature — it takes an `InPlayPokemon` and no seat), and a rule about bodies
      the holder is not cannot be expressed there; `seatShieldedFromSupporterEffects`
      is its read, `hasFreeRetreatAura`'s shape rather than
      `benchShieldedFromDamage`'s, because the target clause names the seat's WHOLE
      board and not just its Bench — a Rhyperior in the Active Spot shields itself
      too, so no `scope` argument is expressible or needed.

      ⚠️ **AND THE TRIGGER NARROWING IS OBSERVABLE IN BOTH DIRECTIONS ON A REAL
      BOARD**, which is why it is a second field and not a rider on the first.
      Merged into `preventTrainerEffects` it would give Rhyperior an ITEM immunity
      it does not print (Crushing Hammer lands on a Wide Wall board and is the
      slice's sharpest observable claim); merged the other way it would strip
      Fraxure's Item half. Two disjoint antecedents on two different consequents
      are two fields — D252's rule, third application.

      §9-suppressible per SOURCE like every printed Ability in this family. */
  preventSupporterEffectsWhileActive?: true;
  /** §7.1/§7.4 (D284) — the CONTINUOUS seat-wide BAR ON THE PLAY ITSELF, whose
      window is the holder's own Active Spot and whose object is the OPPONENT's
      hand:

        "As long as this Pokémon is in the Active Spot, your opponent can't play
         any Item cards from their hand."                       (Tyranitar sv09-095)
        "As long as this Pokémon is in the Active Spot, your opponent can't play
         any Item cards or Pokémon Tool cards from their hand." (Jellicent ex ×3)

      **4 legal printings on 2 sentences**, measured over `abilities_json` with
      `legal_standard = 1` against the remote D1 `luminous`
      (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-08 — and measured by
      the MECHANISM (`instr(abilities_json, "your opponent can't play")`), which
      returns SEVEN rows of which these 4 are the ones this vocabulary reaches.
      The other three are refused BY NAME in the block below.

      🛑 **IT IS `preventSupporterEffectsWhileActive`'s WINDOW ON A DIFFERENT
      VERB, WHICH IS THE ONE THING D283 GOT RIGHT ABOUT IT.** That field's object
      is a played card's EFFECTS; this one refuses the PLAY, so the two never meet
      at a read site: the shield is folded inside a resolving program, the bar is
      a GATE in front of one. Same source clause, same scan, same §9 rule,
      disjoint consequents — D252's two-fields rule, one more time.

      ⚠️ **AN ARRAY AND NOT A FLAG, BECAUSE ONE PRINTED SENTENCE NAMES TWO
      CLASSES.** Jellicent ex prints *"Item cards **or** Pokémon Tool cards"* — a
      SET where D283's stamp held a single key — so the value is the class list
      itself and `handPlayBarred` asks `includes`. A pair of booleans would make
      Tyranitar's one-class sentence and Jellicent's two-class sentence two
      different SHAPES of the same rule, and the day a third class is printed the
      shape changes again.

      🛑 **AND THE CLASS VOCABULARY IS `HandPlayClass`, WHICH IS *NOT*
      `StampedHandPlayClass`** (effects.ts). `"Tool"` is reachable from this field
      and from nothing else, which is why widening the QUESTION cost no persisted
      byte: `GameState.handPlayLockedTurn` keeps its two keys and
      `MATCH_RECORD_VERSION` does not move.

      ⚠️ **REFUSED, WITH THE MISSING MECHANISM NAMED, AND EACH FOR ITS OWN
      REASON** — the other three rows of the same census:
        • Copperajah `sv06.5-042` (1) — *"…can't play any **Stadium** cards…"*.
          `"Stadium"` IS a `Card.trainerType`, so the CLASS is spellable; the
          READ is not. `playTrainer` hands a Stadium to `playStadium` on the line
          ABOVE this gate, `redactedTrainersOf` skips Stadium rows entirely
          ("Stadiums play by the board DRAG, not a button here"), and the drag
          affordance in `src/features/game/placement.ts` answers off a REDACTED
          board with no `GameState` to ask. **The missing mechanism is a Stadium
          payability mirror on the wire** — the online HUD has no Stadium row to
          grey, so honouring the bar there means building that row first.
        • Team Rocket's Arbok `sv10-113` (1) — *"…can't play any Pokémon that has
          an Ability from their hand, **except for Team Rocket's Pokémon**"*.
          Not a `trainerType` at all: the object is a POKÉMON play (§7.5 bench
          placement AND §10 evolution), narrowed by a `CardFilter` and then
          re-widened by an owner-prefix exception. **The missing mechanism is a
          play-from-hand gate for the Pokémon surface**, which this family has
          none of — the same seam Bronzong `sv05-069` was refused at by D283.
        • ✅ Genesect `sv06.5-040` (1) — **BUILT BY D291 IN THE FIELD BELOW, NOT
          HERE, AND THAT IS THE WHOLE POINT.** *"**If this Pokémon has a Pokémon
          Tool attached**, your opponent can't play any **ACE SPEC** cards from
          their hand."* Both of its misses are real and neither is a width of THIS
          union: its window is HOLDER-STATE and readable from ANY zone (D283
          recorded all seven printings as carrying *"while this Pokémon is in the
          Active Spot"* and this one does NOT), and **ACE SPEC is a RARITY axis
          orthogonal to `trainerType`**, so it is a SECOND PREDICATE ANDed with
          the class question rather than a fifth member of it.
          `preventOpponentAceSpecPlayWhileToolAttached` below is that second
          dimension; see its block for the census that settled it.

      §9-suppressible per SOURCE (`disabledAbilityUids`) like every printed
      Ability in this family: Klefki's lock takes the bar down and the Item lands. */
  preventOpponentHandPlay?: readonly HandPlayClass[];
  /** §7.1/§7.4 (D291) — CONTINUOUS, seat-wide bar on the OPPONENT playing any
      **ACE SPEC** card out of their hand, for as long as this body has a Pokémon
      Tool attached. **1 legal printing and there is no second one anywhere in the
      catalog** — Genesect `sv06.5-040` "ACE Nullifier":

        "If this Pokémon has a Pokémon Tool attached, your opponent can't play any
         ACE SPEC cards from their hand."

      🛑 **A SECOND FIELD AND NOT A WIDENING OF `preventOpponentHandPlay` ABOVE,
      AND THE D252 TWO-FIELDS TEST IS MET ON BOTH HALVES INDEPENDENTLY.**
      **(i) THE VOCABULARY.** That field holds `Card.trainerType` words and this
      one asks about `Card.rarity`; the two axes are ORTHOGONAL, so an ACE SPEC
      arm added to `HandPlayClass` would parallel a predicate instead of crossing
      two — the union is exactly `Card.trainerType` (D287) and must stay that way.
      **(ii) THE WINDOW.** `handPlayBarredByOpponentActive` collapses its holder
      loop to ONE read because its printed clause is *"As long as this Pokémon is
      in the Active Spot"*. This sentence's clause is *"If this Pokémon has a
      Pokémon Tool attached"* — a HOLDER-STATE window with no zone in it at all,
      so a BENCHED Genesect with a Tool bars just as hard as an Active one and the
      scan must walk Active **and** Bench. **A WINDOW IS NOT A PREDICATE YOU CAN
      WIDEN** (D283's finding), which is why the reader is its own function.

      🛑 **THE CLASSIFIER IS A DERIVED READ OVER `Card.rarity` AND NOT A NEW
      FIELD**, and the census that made that safe is the first thing D291 ran.
      Remote D1 `luminous` (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-08,
      `rarity LIKE '%ACE SPEC%'` with NO legality filter, split by `trainer_type`
      and by registry membership:

        Item     20  (8 already carry a registry row)
        Tool      8  (2)
        Stadium   2  (1)
        Energy    3  (2)   ← `category = 'Energy'`, `trainer_type` NULL
        —————————————
        total    33  (13),  ALL `legal_standard = 1`, ALL regulation mark **H**

      ⚠️ **THE INHERITED "33 LEGAL ROWS" HELD EXACTLY — AND THE SPLIT IS THE
      FINDING, NOT THE TOTAL.** Three facts no note anywhere stated: `rarity` takes
      **exactly one** distinct ACE SPEC value (`'ACE SPEC Rare'`), so the predicate
      is a discriminator and not a family of spellings; **ZERO of the 33 is a
      Supporter and ZERO is a Pokémon**; and the catalog holds **no illegal ACE
      SPEC printing at all**, so unlike D290's 81-row fold there is no legality
      question hiding behind the count.

      🛑 **AND THE PRICE OF THE PARTIAL BUILD, STATED RATHER THAN ELIDED: THIS
      REACHES 30 OF THE 33.** The three ACE SPEC **Special Energy** printings
      (`sv05-162` Neo Upper Energy, `sv08-191` Enriching Energy, `sv06-167`) are
      played by `attachEnergy` (turn.ts), which asks NO hand-play bar of any kind
      — the same seam the POKÉMON surface sat at until D285 built it. **MISSING:
      an energy-surface play-from-hand gate.** It is a missing CODE mechanism, not
      a missing catalog fact, and it is one function in turn.ts plus this reader
      the day someone wants it.

      ⚠️ **`isAceSpec` IS A SUBSTRING TEST AND THAT IS DELIBERATE**, matching
      `src/features/builder/cards.ts`'s deck-validator predicate byte for byte
      rather than inventing a second reading of the same label: the deck builder
      has enforced the one-per-deck ACE SPEC rule off this exact string since P2,
      so the engine disagreeing with it about what an ACE SPEC *is* would be a bug
      no board could show you. **THE RULES PROPERTY WAS ALREADY READ OFF THE
      RARITY LABEL IN THIS REPO** — D284's refusal note called that "an ingest
      decision this slice does not get to make alone", and the decision turns out
      to have been made at P2 and never re-read. D290's rule, one slice on: BEFORE
      REFUSING A MECHANISM, GREP THE TREE FOR CODE THAT ALREADY IMPLEMENTS IT.

      §9-suppressible per SOURCE (`disabledAbilityUids`) like every printed Ability
      in this family: Klefki's lock takes the bar down and the ACE SPEC lands. */
  preventOpponentAceSpecPlayWhileToolAttached?: true;
  /** §7.5/§10 (D285) — CONTINUOUS, seat-wide bar on the OPPONENT playing POKÉMON
      out of their hand while this body is in the Active Spot. **1 legal
      printing** — Team Rocket's Arbok `sv10-113` "Potent Glare", measured over
      `abilities_json` with `legal_standard = 1` against the remote D1 `luminous`
      (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-08:

        "As long as this Pokémon is in the Active Spot, your opponent can't play
         any Pokémon that has an Ability from their hand, except for Team
         Rocket's Pokémon."

      🛑 **A SECOND FIELD AND NOT A WIDENING OF `preventOpponentHandPlay` ABOVE**,
      which is the D252 two-fields test met on both halves rather than assumed.
      The VOCABULARY differs — that one holds `Card.trainerType` words, this one
      holds ACTS the board performs — and so does the ARITY of the question: a
      Trainer bar is answered from the class alone, and this one cannot be
      answered without the CARD, because the noun is narrowed twice. Sharing one
      array would mean a `HandPlayClass` union with two members that are not
      `trainerType` values, and the `only`/`except` riders would then hang off a
      field three of whose four members can never carry them.

      **`acts` IS A LIST FOR `preventOpponentHandPlay`'s REASON EXACTLY**: this
      sentence bars the play itself, so it reaches BOTH acts (§7.5 bench placement
      and §10 evolution) and the value is the list. Bronzong's ATTACK-side twin
      names only `"evolve"`, so the two members are separately printed and a
      single `"pokemon"` value would let one sentence bar what the other's does
      not mention.

      **`only` AND `except` ARE THE TWO PRINTED CLAUSES, ONE FIELD EACH.**
      *"that has an Ability"* NARROWS the noun (`CardFilter.abilityPokemon`,
      D285, answered by `hasPrintedAbility`) and *"except for Team Rocket's
      Pokémon"* SUBTRACTS from the result (`CardFilter.ownerPokemon`, D200's arm,
      a FIFTH reuse). A single filter would need a `not`/`allOf` combinator pair
      the catalog prints nowhere else; two absent-by-default riders cost one
      `matchesFilter` call each and read in the order the card is printed.

      ⚠️ **THE MIRRORS DO NOT GROW A TERM AND THAT IS NOT A GAP** — a Pokémon
      leaves hand by DRAG on both surfaces, and `src/features/game/placement.ts`
      is contractually COARSE ("fine-grained legality … stays with applyAction,
      whose rejection surfaces as the page's error pill"). Evolution timing
      (§4/§10) and the evolve-from name match already live on that side of the
      line, so an imposed bar joining them changes nothing about what the online
      HUD offers. **THAT COSTS A GREYED ROW THE PLAYER NEVER SEES**: a barred
      seat learns the bar by dragging and reading the pill, exactly as it learns
      that a Stage 1 does not evolve from the wrong Basic.

      §9-suppressible per SOURCE (`disabledAbilityUids`), like every printed
      Ability in this family. */
  preventOpponentPokemonPlay?: {
    readonly acts: readonly PokemonPlayAct[];
    readonly only?: CardFilter;
    readonly except?: CardFilter;
  };
  /** §11 continuous HOLDER-relative PREVENTION of an ATTACK's EFFECTS, with NO
      damage half at all — the family's first sentence that says so in print:

        "Prevent all effects of attacks used by your opponent's Pokémon done to
         this Pokémon. (Damage is not an effect.)"

      **1 legal printing** — Skeledirge `sv08-031` "Unaware", measured over
      `abilities_json` with `legal_standard = 1` against the remote D1 `luminous`
      (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-07, GROUPED BY SENTENCE,
      at three ladder rungs across all three text columns.

      ⚠️ **IT IS `preventDamageAndEffectsWhileBenched` (D253) WITH THE DAMAGE HALF
      AND THE ZONE CLAUSE BOTH DROPPED**, which is what makes it the cheapest row
      in the whole `%prevent%` seam: a HOLDER rule, so `passivesOf` folds it, and
      an EFFECTS-ONLY rule, so NOTHING in the §8.5 pipeline may read it. The
      printed parenthetical *"(Damage is not an effect.)"* is not reminder text
      here — it is the only thing standing between this field and four damage
      sites, and a field that reached them would give Skeledirge a total immunity
      no printing grants.

      ⚠️ **AND ITS TARGET IS ALWAYS THE HOLDER, SO THE ZONE IT STANDS IN IS
      IRRELEVANT AND NOT MERELY UNCHECKED.** D253's twin resolves "on your Bench"
      inside the fold; this sentence prints no antecedent of any kind, so a benched
      Skeledirge and an Active one answer identically — which since D259's
      per-candidate filter is an OBSERVABLE difference and not a vacuous one, a
      gusted benched holder still refusing the gust.

      A BOOLEAN by the standing rule: the gate names no VALUE, so an OR over N
      sources is lossless. §9-suppressible — the printing IS a Pokémon Ability, so
      it rides this fold and Klefki's lock switches it off. */
  preventAttackEffects?: true;
  /** §11 continuous TARGET-GROUP PREVENTION of an ATTACK's EFFECTS — the field
      directly above with its object moved off the holder and onto a NAMED SUBGROUP
      of the holder's own board:

        "Prevent all effects of attacks used by your opponent's Pokémon done to
         your Basic Team Rocket's Pokémon. (Existing effects are not removed.
         Damage is not an effect.)"

      **1 legal printing** — Team Rocket's Articuno `sv10-051` "Repelling Veil",
      the other row of the same 2026-08-07 census.

        field                        SOURCE       HALF      TARGET
        preventAttackEffects         (anywhere)   effects   the holder
        preventAttackEffectsForGroup (anywhere)   effects   a printed subgroup

      ⚠️ **SO IT IS A SCAN AND NOT A FOLD, SETTLED BY READING `passivesOf`'s
      SIGNATURE**: that function takes an `InPlayPokemon` and no seat, so a rule
      about bodies the holder is not has nowhere to live in it. The read is
      `continuous.ts groupShieldedFromAttackEffects`.

      ⚠️ **A `CardFilter` AND NOT A BOOLEAN, WHICH IS THE ONE SHAPE DECISION THIS
      ROW HAD TO MAKE.** D256's `preventBenchDamageNoRuleBox` bakes its target
      conjunct into the scan because `hasRuleBox` is a universal property of a
      card; *"Basic Team Rocket's"* is CATALOG DATA — a stage word and an
      owner prefix — and `matchesFilter`'s `ownerPokemon` arm already spells
      exactly that pair (`{ kind: "ownerPokemon", owner, stage }`, D200/D245).
      Carrying the filter here transcribes the printed noun phrase into the
      registry row where a reader can check it against the print, and the row adds
      **ZERO new predicates**.

      ⚠️ **ITS TARGET SET IS THE WHOLE OWN BOARD AND NOT JUST THE BENCH** — the
      printed noun phrase carries no zone word, so an Active member of the group is
      shielded too, and no `scope` argument is expressible: Team Rocket's Articuno
      is itself a BASIC Team Rocket's Pokémon (catalog `stage = "Basic"`), so its
      source set CONTAINS its target set and there is no reading under which it is
      excluded from its own aura.

      ⚠️ **AND THE PRINTED *"(Existing effects are not removed.)"* IS A REAL CLAUSE
      COSTING ZERO LINES.** It says the aura is a GATE at application time and
      never a SWEEP over already-installed conditions — which is what
      `effectRefused` has been since D142, so the correct implementation of that
      sentence is to write nothing and DRIVE it (poison a body, then bring the
      shield up, and watch the poison survive).

      §9-suppressible PER SOURCE like every printed Ability in this family. */
  preventAttackEffectsForGroup?: CardFilter;
  /** §11 continuous own-board AURA: while this Pokémon is in play, every one of
      its CONTROLLER's in-play Pokémon that satisfies `requiresEnergyType` has NO
      Retreat Cost. Like `removeWeakness` it reaches OTHER Pokémon rather than
      modifying its holder, so continuous.ts reads it through a dedicated scan
      (`hasFreeRetreatAura`) rather than the per-Pokémon `passivesOf` fold — but
      unlike that seat-wide flag the clause is evaluated PER TARGET, so the scan
      takes the Pokémon, not just the seat. Clefable ex sv03-082 "Lunar Zone"
      ("All of your Pokémon that have {P} Energy attached have no Retreat Cost")
      is the only "no Retreat Cost" print in the whole local pool: own board,
      stage-agnostic, self-inclusive (Clefable ex qualifies iff it too carries
      {P}), and no "in the Active Spot" clause. The energy clause is a
      PROVISION read (continuous.ts `providesEnergyType`, the `providesEnergy`
      CardFilter's predicate), so a wildcard Luminous Energy counts as {P} —
      the same rule that lets it pay a {P} cost. `requiresEnergyType` is an
      OPTIONAL refinement (the `basicEnergy.energyType` idiom): a future
      unconditional "your Pokémon have no Retreat Cost" print omits it. This is
      a SET-TO-ZERO, so it wins over the ± Stadium deltas (Beach Court's
      `basicRetreatDiscount`, and any future surcharge) — the read site checks
      it first.

      🆕 D267 — `stage` IS THE SECOND OPTIONAL REFINEMENT, AND IT IS A SIBLING OF
      `requiresEnergyType` RATHER THAN A REPLACEMENT FOR IT. Latias ex
      sv08-076/-220/-239 "Skyliner" prints *"Your Basic Pokémon in play have no
      Retreat Cost."* — the same own-board, self-inclusive, zone-word-free aura
      with the energy clause swapped for a STAGE one. Both fields are per-TARGET
      predicates evaluated inside the same scan, and an ABSENT field means
      UNGATED on its axis — never a default. (Defaulting `stage` to `"Basic"`
      would silently un-build Lunar Zone's printed *"All of your Pokémon"*, which
      frees an EVOLUTION carrying {P}; the suite drives both sentences on ONE
      board so that mistake is observable.)

      ⚠️ THE VALUE IS `"Basic"` AND NOT A `CardFilter`. `matchesFilter`'s `stage`
      vocabulary names this axis and is the wrong INSTRUMENT twice over: it is a
      CARD read (deck/hand/discard) where this gate walks IN-PLAY bodies, and its
      else-arm means "any Evolution", which cannot express Stage 2 (D245, D262,
      D266). The spelling copies `disableAbilities.stage?: "Basic"` — the one
      other stage-narrowed aura in this interface — verbatim, so the two read
      alike (`aura.stage === "Basic" && !isBasicPokemon(top)`), and the read is
      `cards.ts isBasicPokemon` on the TARGET's TOP card, which is what makes it
      move with an evolve. */
  noRetreatCostAura?: { requiresEnergyType?: BasicEnergyType; stage?: "Basic" };
  /** §11 continuous OPPONENT-side aura: this many {C} are ADDED to the Retreat
      Cost of the opposing side's ACTIVE Pokémon (Spidops ex sv01-019/-223/-243
      "Trap Territory" — "Your opponent's Active Pokémon's Retreat Cost is {C}
      more"), the last unbuilt modifier on the retreat-cost seam and the
      sign-flipped, cross-board mirror of `noRetreatCostAura`. Like that one it
      reaches OTHER Pokémon, so continuous.ts reads it through a dedicated scan
      (`opposingRetreatSurcharge`) rather than `passivesOf`; unlike it the return
      is a DELTA, so the scan sums every live source and `effectiveRetreatCost`
      folds it with the Stadium deltas before the single floor at 0.
      A bare number, not an object (the D104 rule): the print is unconditional.
      Note the two Active clauses are NOT symmetric — the TARGET must be the
      opponent's Active, but the SOURCE has no "in the Active Spot" clause, so a
      BENCHED Spidops ex imposes it just as well (contrast `damageAttacker`,
      whose Active clause is on the holder). Stage-agnostic, so unlike the
      Stadium ± deltas it also reaches a non-Basic Active.

      🆕 D322 — A RECORD RATHER THAN A BARE NUMBER, because a SECOND sentence
      prints the same delta with a TARGET narrowing. Ariados `sv06-005` "Big Net"
      is *"Your opponent's Active Evolution Pokémon's Retreat Cost is {C} more."*,
      which is Trap Territory's sentence with one adjective added, so the widening
      is D104's minimal shape taken one step: `amount` carries what the bare number
      carried and `target` is the adjective. Both prior holders (Spidops ex
      `sv01-019`/`-223`/`-243`) are `legal_standard = 0`, so the blast radius is
      one rotated row in this file plus the one conjunct in
      `opposingRetreatSurcharge`.
      • `target` — the printed *"Evolution"*, and it is **`seatDamageBonusBeforeWR
        .target`'s FIELD NAME, TYPE AND FILTER MEMBER REUSED WHOLE.** D245 built
        that rider for Carracosta `sv07-038` "Primal Knowledge" — *"…do 30 more
        damage to your opponent's **Active Evolution** Pokémon"* — which is the
        SAME printed noun phrase on the damage seam, stored as
        `CardFilter { kind: "evolutionPokemon" }` and answered by
        `matchesFilter(<the target's TOP card>, …)`. 🛑 **SO THE OBJECTION THAT
        `matchesFilter` IS "A CARD READ FOR DECK/HAND/DISCARD" IS FALSE HERE AND
        THE ENGINE HAS SAID SO FOR SEVENTY-SEVEN SESSIONS**: `matchesFilter` takes
        a `Card`, an in-play body's `topCardOf` IS a `Card`, and D245's read site
        hands it exactly that. A bespoke `targetEvolution?: true` would have been
        a second spelling of a member that already exists — D319's rule run
        forwards, and the reason this widening costs no new filter member.
        ⚠️ **IT NARROWS THE TARGET AND NOT THE SOURCE.** Ariados is itself a
        Stage 1, so a build that tested the SOURCE would be green on every board
        where the surcharge is imposed at all, and would part from this one only
        when a BASIC printed the sentence — `seatDamageReductionAfterWR
        .beneficiary`'s trap arriving on the retreat seam. Absent means UNGATED,
        which is Trap Territory's bare sentence. */
  opponentActiveRetreatSurcharge?: { amount: number; target?: CardFilter };
  /** §11 continuous OWN-BOARD aura: this many {C} are SUBTRACTED from the Retreat
      Cost of the HOLDER'S OWN side's ACTIVE Pokémon (Toedscruel `sv09-089`
      "Secret Forest Path" — *"As long as this Pokémon is on your Bench, your
      Active Pokémon's Retreat Cost is {C}{C} less."*). The SIGN-FLIPPED, OWN-SIDE
      mirror of `opponentActiveRetreatSurcharge` directly above and the ELEVENTH
      print on the retreat-cost seam, and it is its own field rather than a
      negative `amount` on that one for the reason the two scans differ: that field
      is read across the table and this one down the holder's own side, so a shared
      field would need a direction discriminant that no printing varies.

      🛑 **IT IS NOT `noRetreatCostAura`'s SHAPE EITHER.** That field SETS the cost
      to zero for every teammate satisfying a per-target clause; this one is a
      DELTA on exactly one body, the seat's Active, and must be summed with the
      Stadium terms and floored ONCE — conflating them would make a single benched
      Toedscruel free the whole board's retreat.
      • `sourceOnBench` — the printed *"As long as this Pokémon is on your
        Bench"*, the SAME rider `seatDamageReductionAfterWR` gained at D321,
        answered by the same seat-blind `isOnBench` (continuous.ts, D253). ⚠️ **IT
        GATES THE SOURCE, NOT THE TARGET**, and here the two ends are on opposite
        zones by construction: the source must be BENCHED and the beneficiary is
        the ACTIVE, so promoting the Toedscruel ends the discount for the body it
        just replaced. Absent means UNGATED, for a future print with no zone
        clause. */
  ownActiveRetreatDiscount?: { amount: number; sourceOnBench?: true };
  /** §11 continuous OPPONENT-side aura: while BOTH this Pokémon and the target
      are in the Active Spot, the opposing side's Active Pokémon CANNOT RETREAT
      (Snorlax swsh10.5-055 "Block" — "As long as this Pokémon is in the Active
      Spot, your opponent's Active Pokémon can't retreat"). A bare flag per D104's
      minimal-shape rule: one print, and unconditional once both ends are Active,
      so there is nothing left to parameterise. Like its two neighbours it does
      NOT modify its holder — it reaches across the board — so continuous.ts reads
      it through a dedicated scan (`opposingRetreatBlocked`) rather than the
      per-Pokémon `passivesOf` fold, and being a printed Pokémon ABILITY only the
      TOP card of a stack grants it (never an attached Tool).
      The point worth recording is where it parts from `opponentActiveRetreatSurcharge`
      directly above: that print's sentence scopes only the TARGET, so a BENCHED
      Spidops ex still imposes it — whereas this print opens with "As long as this
      Pokémon is in the Active Spot", which scopes the SOURCE too. Both ends are
      therefore Active-gated, and that clause is enforced by the SCAN rather than
      by a new `activeOnly` field (the `damageAttacker` precedent: an Active clause
      on the holder is honored at the read site). */
  preventOpponentActiveRetreat?: true;
  /** §11 continuous SELF-only set-to-zero: while this Pokémon is in play THIS
      Pokémon — and only this one — has NO Retreat Cost, optionally gated on the
      OPPONENT having a Pokémon of a given rule-box suffix in play (Wimpod
      swsh10.5-025 "Punk Out" — "If your opponent has any Pokémon V in play, this
      Pokémon has no Retreat Cost"). The last unbuilt print on the retreat-cost
      seam, and a shape with no precedent here: every retreat modifier above either
      reaches OTHER Pokémon through a dedicated aura scan or modifies its holder
      through the seat-free `passivesOf` fold — this one modifies only its holder
      yet must LOOK across the table, so it gets its own scan
      (continuous.ts `hasFreeRetreatSelf`) that reads the holder's own passive.
      It is deliberately NOT a refinement of `noRetreatCostAura` above: that field
      frees ALL OF YOUR Pokémon that satisfy its clause, this one frees exactly its
      holder, and conflating them behind one flag would silently free the whole
      board the moment a Wimpod hit the Bench.
      The predicate is a bespoke optional field rather than a `BoardCondition`
      (D40) member for two reasons. The direct precedent is
      `damageBonusBeforeWRIfTarget: { targetSuffix: PokemonSuffix }` in this same
      interface: when the gate is a PRINTED SUFFIX rather than a seat-relative
      board fact, `PassiveEffects` carries the suffix directly. And structurally it
      has to — `conditionHolds` lives in interpreter.ts, which imports
      continuous.ts, so reading a `BoardCondition` from a continuous scan would
      close an import cycle.
      `requiresOpponentSuffixInPlay` is OPTIONAL per D104's minimal-shape rule: a
      future unconditional "this Pokémon has no Retreat Cost" print simply omits
      it. And `PokemonSuffix === "V"` excludes VMAX/VSTAR BY CONSTRUCTION —
      `pokemonSuffixOf` matches " VMAX"/" VSTAR" before the bare " V" arm — which
      is exactly what the printed "Pokémon V" means (Choice Belt's gate draws the
      same line).

      🆕 D322 — `requiresNoEnergyAttached`, the SECOND gate and the first that
      looks at the HOLDER rather than across the table. Ethan's Magcargo
      `sv10-036` "Melt Away" is *"If this Pokémon has no Energy attached, it has no
      Retreat Cost."* — the same consequent as Punk Out under a different
      antecedent, so it is a rider and not a field (D104). The two riders are
      INDEPENDENT and both optional: a print carrying neither is unconditional, a
      print carrying both would need both to hold, and no printing in the pool
      carries both. The read is `pokemon.energy.length === 0` at the scan, which
      already has the body — counting ATTACHED CARDS and not provided units, since
      the print says "Energy attached" and one attached Luminous Energy is one
      attached Energy however many types it provides. */
  noRetreatCostSelf?: {
    requiresOpponentSuffixInPlay?: PokemonSuffix;
    requiresNoEnergyAttached?: true;
  };
  /** §8.5 continuous OPPONENT-side aura: while BOTH this Pokémon and the attacker
      are in the Active Spot, every damage the OPPOSING side's Active Pokémon's
      attacks do is reduced by this much, BEFORE Weakness and Resistance (Entei
      sv03-030 "Pressure" — "As long as this Pokémon is in the Active Spot, attacks
      used by your opponent's Active Pokémon do 20 less damage (before applying
      Weakness and Resistance)"). The ALWAYS-ON member of D149's attacker-side
      debuff family, and the ONLY printing of it in the pool (censused as its own
      question against the local D1: 1 of the 6 printings of "…less damage (before
      applying Weakness and Resistance)" is an Ability, and it is this one).
      A bare number, not an object (the D104 rule): the print is unconditional once
      both ends are Active.
      SHAPE — it is `preventOpponentActiveRetreat`'s twin two fields up rather than
      a `passivesOf` fold, and for that field's reason verbatim: it does NOT modify
      its holder, it reaches across the board, so continuous.ts reads it through a
      dedicated scan (`opposingAttackDebuff`) — `passivesOf` reads the HOLDER and
      this must be asked of the holder's OPPONENT. Both Active clauses are enforced
      by the SCAN rather than by an `activeOnly` field, exactly as they are there.
      Being a printed Pokémon ABILITY only the TOP card of a stack grants it (never
      an attached Tool), and it is §9-suppressible (`disabledAbilityUids`) — which
      is the sharpest difference from D149's stamped `InPlayPokemon.attackDamageDebuff`,
      an attack INSTALLATION that no Ability-lock can reach. Same sentence, same
      step, two sources: the read sites SUM them. */
  opponentActiveAttackDebuff?: number;
  /** §8.2 continuous OPPONENT-side aura: while BOTH this Pokémon and the attacker
      are in the Active Spot, every attack the OPPOSING side's Active Pokémon uses
      costs this many {C} MORE (Seismitoad sv03-052 "Quaking Zone" — "As long as
      this Pokémon is in the Active Spot, attacks used by your opponent's Active
      Pokémon cost {C} more"). `opponentActiveAttackDebuff`'s twin one field up,
      printed sentence for printed sentence — same opening clause, same
      "attacks used by your opponent's Active Pokémon" subject — with the predicate
      moved from the DAMAGE step to the COST step. So it is read through a dedicated
      scan (`opposingAttackCostSurcharge`) with that field's scan copied verbatim:
      the derived seat, BOTH Active clauses enforced by the scan rather than by an
      `activeOnly` field, the §9 gate through `disabledAbilityUids`, and no source
      loop (the source clause is the opponent's Active ALONE, so a loop would
      describe a board that cannot exist).
      A bare number, not an object (the D104 rule): the print is unconditional once
      both ends are Active.
      ⚠️ STAGE-AGNOSTIC ON BOTH ENDS, which is the one thing it does NOT share with
      the Stadium already on this seam. `StadiumEffects.basicAttackCostSurcharge`
      (League HQ) prints "each BASIC Pokémon in play"; this sentence prints no stage
      at all — and Seismitoad is itself a Stage 2, so a scan inheriting the
      Stadium's Basic gate would have been silently switched off by its own holder.
      That is why `effectiveAttackCost`'s Basic test became a per-TERM gate rather
      than the function's early return (`stadiumRetreatDelta`'s move, one seam
      over). */
  opponentActiveAttackCostSurcharge?: number;
  /** §8.2 continuous SELF-only cost DISCOUNT: THIS Pokémon's attacks cost this many
      {C} less FOR EACH Prize card its owner's opponent has already taken (Radiant
      Charizard swsh10.5-011 "Excited Heart" — "This Pokémon's attacks cost Colorless
      less for each Prize card your opponent has taken"). The engine's FIRST cost
      discount on the attack seam, and the sign-flipped mirror of the two surcharges
      that share it.
      A PER-UNIT rate, not a total: the printed sentence is "for each", so the field
      is what ONE taken Prize is worth and the read site multiplies by
      `takenPrizes(state, opponentSeat)`. Naming the count source in the field name
      is deliberate — the count is not implied by "discount", and this is the same
      vocabulary `AttackDamageBonus`'s `opponentPrizesTaken` count kind already
      uses for the identical reading of "your opponent has taken" (attack.ts).
      SHAPE — `noRetreatCostSelf`'s, not `passivesOf`'s, and for that field's reason
      verbatim: it modifies ONLY its holder yet must LOOK ACROSS THE TABLE to
      evaluate its count, and `passivesOf` has no seat to resolve "your opponent"
      with. So it gets its own scan (continuous.ts `selfAttackCostDiscount`) which
      derives the seat the way all nine of its aura-scan siblings do. Being a printed
      Pokémon ABILITY only the TOP card of a stack grants it (never an attached
      Tool), and it is §9-suppressible — Radiant Charizard is a BASIC, so an Active
      Klefki sv01-096 "Mischievous Lock" really does silence it and the printed cost
      snaps back (D113's rule: the reachability follows the SOURCE's stage).
      NO FLOOR IS OWED, unlike every ± field on the retreat seam. That seam's cost is
      a NUMBER and `effectiveRetreatCost` must clamp it at `Math.max(0, …)`; this
      seam's cost is an ARRAY OF SYMBOLS, and a discount can only remove symbols that
      are there. The structure floors itself, which is the one asymmetry between the
      two seams worth stating out loud. */
  attackCostDiscountPerOpponentPrize?: number;

  /** 🆕 **D327 — §8.2 continuous SELF-only cost DISCOUNT, COUNTED OVER THE
      HOLDER'S OWN DISCARD PILE BY CARD NAME**: this Pokémon's attacks cost
      `amount` {C} less for each card named `name` in its owner's discard pile
      (Crabominable `svp-134`/`sv07-042`/`-149` **and Veluza `sv07-045`** "Food
      Prep" — *"Attacks used by this Pokémon cost {C} less for each Kofu card in
      your discard pile."*, **4 legal printings on ONE byte-identical
      `abilities_json`**, and the row `legalNonAttackPrograms.test.ts`'s `DROPPED`
      table has carried since D162).

      🛑 **THE SECOND COUNT SOURCE ON THIS SEAM, AND ITS OWN FIELD RATHER THAN A
      PARAMETER ON THE FIRST — WHICH IS THE CHOICE THE `DROPPED` ROW LEFT OPEN.**
      That row priced this at *"a second field or a parameterised one"* and named
      D162's rule for why `attackCostDiscountPerOpponentPrize` spells its
      multiplicand in its NAME: the count is not implied by "discount". Turning
      the shipped field into `{ amount, scale }` would have retyped a value read
      by three test files and two doc blocks to buy nothing this sentence needs —
      D135's unread-field trap, from the other end. The sibling shape is also
      already this file's idiom on the damage seam, where `damageBonusBeforeWR`,
      `…If` and `…IfTarget` are THREE fields for one printed verb.

      ⚠️ **AN OBJECT, NOT A BARE NUMBER, BECAUSE THE NAME IS HALF THE SENTENCE.**
      `attackCostDiscountPerOpponentPrize` can be a number because its count source
      is fixed by its name; this one's count source is a card name the print
      supplies, so the rate alone would not say what to count. `amount` is what ONE
      such card is worth, per the printed "for each".

      ⚠️ **THE PILE IS THE HOLDER'S OWN, NOT THE TABLE'S.** The print says "**your**
      discard pile", and the scan resolves "your" to the seat that holds the body —
      the same derivation its Prize-counting sibling makes for "your opponent".
      A Kofu in the OPPONENT's discard discounts nothing.

      ⚠️ **THE COUNT IS BY PRINTED NAME AND SPANS BOTH KOFU PRINTINGS.** `Kofu` is a
      Supporter with TWO Standard-legal ids (`sv07-138`/`sv07-165`, remote D1
      `luminous`, 2026-08-11), so a name test — and not an id test — is what the
      sentence means; a discard holding one of each counts TWO. */
  attackCostDiscountPerNamedInDiscard?: { name: string; amount: number };

  /** 🆕 **D327 — §8.2 continuous SELF-only cost DISCOUNT, COUNTED OVER THE
      OPPOSING BENCH**: this Pokémon's attacks cost this many {C} less for each
      Pokémon on its owner's opponent's Bench (Incineroar ex `sv05-034`/`sv05-187`
      "Hustle Play" — *"Attacks used by this Pokémon cost {C} less for each of your
      opponent's Benched Pokémon."*, **2 legal printings**).

      🛑 **THIS ROW WAS NEVER IN THE `DROPPED` TABLE AND WAS FOUND BY THE
      ORTHOGONAL-WIDTH PROBE, NOT BY THE ORDERED ONE.** The census literal the Food
      Prep row carries is `for each Kofu` (4 legal); the SHORTER noun `less for
      each` returns **12**, and the difference set of 8 is 6 built Bloodmoon
      Ursaluna ex printings plus these 2. Building both closes the whole
      `%less for each%` cost family at 12 of 12 with an EMPTY residue.

      A BARE NUMBER, the D104 rule: the print is unconditional and its count source
      is fixed by the field name, exactly as `attackCostDiscountPerOpponentPrize`'s
      is — so it needs no object.

      ⚠️ **THE COUNT IS THE BENCH ONLY AND EXCLUDES THE ACTIVE.** `bench` is a
      dense `InPlayPokemon[]`, so its `length` IS the printed "Benched Pokémon"
      with no filtering; a facing Active is not a Benched Pokémon and an empty
      Bench discounts nothing, which is the arm that separates this field from a
      count of "Pokémon in play". */
  attackCostDiscountPerOpponentBenched?: number;

  /** §8/§9 continuous SELF-only ATTACK GATE (D242): the holder **can't attack**
      unless this board condition holds ("This Pokémon can't attack unless you
      have 4 or more Team Rocket's Pokémon in play" — Team Rocket's Mewtwo ex
      `svp-205`/`-216`/`sv10-081`/`-213`/`-231`/`-240` "Power Saver", **six legal
      printings**, the biggest reprint group in the ABILITY column with no
      registry program).

      ⚠️ **AN `unless`, SO THE STORED CONDITION IS THE PERMISSION AND THE GATE
      NEGATES IT.** The field could equally have held the BAR ("can't attack
      WHILE …") and every printing would then need its condition inverted at
      authoring time. The printed word is `unless`, `BoardCondition` has no `not`
      member, and inventing one to store the opposite polarity would make every
      author of this field ask "which way round is this row?" — so the field
      means what the card says and the single read site (`attackBarredByAbility`,
      interpreter.ts) is the one place the sense flips.

      ⚠️ **A `BoardCondition` AND NOT A COUNT, WHICH IS THE THING THIS FIELD BUYS
      BEYOND ITS SIX PRINTINGS.** The one printed sentence is a subgroup count,
      and a `{ owner, count }` pair would have served it exactly — and served
      nothing else. The shared vocabulary is already 24 members wide, evaluated by
      one function, rendered by `conditionNote`, and reused by
      `damageBonusBeforeWRIf` for the identical "a passive gated on the board"
      shape one file over. Widening it by one member (`yourOwnerPokemonInPlayAtLeast`)
      costs the same and admits the whole vocabulary here.

      ⚠️ **COLLECTED RAW BY `passivesOf`, EVALUATED AT THE READ SITE**, exactly
      like `damageBonusBeforeWRIf`: the condition is seat-relative and that fold
      has no seat. It is in the fold's LOOP rather than read off `top` for
      `survivesKoAtFullHp`'s reason verbatim — a §9 Ability-lock (Klefki
      `sv01-096`) must SILENCE this gate, since Power Saver is a printed Ability,
      and a build that read the catalog row directly at the three payability sites
      would be shorter and would get that wrong silently.

      ⚠️ **NO `MATCH_RECORD_VERSION` BUMP IS OWED.** Nothing here is persisted:
      the gate is a CATALOG fact re-derived from the board on every read, unlike
      the two attack-installed locks it sits beside (`attackLockedTurn`,
      `lockedAttacks`), which are `InPlayPokemon` fields. */
  cantAttackUnless?: BoardCondition;

  /** §4 continuous SELF-only ATTACK **LICENCE** (D277): the holder MAY attack on
      the going-first player's first turn, lifting the ban `attack` imposes on
      every body ("If you go first, this Pokémon can use attacks during your first
      turn." — Meloetta ex `sv10.5b-044`/`-159`/`-167` "Debut Performance",
      **three legal printings**).

      🛑 **THE POLARITY IS THE OPPOSITE OF `cantAttackUnless` ONE FIELD UP, AND
      THAT IS THE POINT OF A SECOND FIELD RATHER THAN A WIDER ONE.** That field
      stores a PERMISSION and the read site negates it to produce a BAR; this one
      stores an EXEMPTION and the read site consumes it to LIFT a bar the rules
      already impose. A single field cannot hold both senses without every author
      asking "which way round is this row?" — the objection `cantAttackUnless`'s
      own doc block raises against inverting its polarity, restated.

      ⚠️ **IT IS `trainerFirstTurnExempt`'s ATTACK TWIN — NAMED AS OWED SINCE
      D230 (effects.ts, Volbeat `sv06-009`) AND BUILT HERE — BUT IT IS NOT ITS
      SHAPE.** That flag is a `CardProgram` field because a Trainer card has ONE
      program and the licence is a property of the CARD. This one is a
      `PassiveEffects` field because the printed sentence is an **Ability on a
      Pokémon** ("*this* Pokémon can use attacks"), so it is a property of the
      BODY and must ride the §9-suppressible `passivesOf` scan — a Klefki
      `sv01-096` Ability-lock silences "Debut Performance" and hands the §4 ban
      back, which a build reading the catalog row straight off `top` at the three
      payability sites would get wrong silently (`survivesKoAtFullHp`'s rule).

      ⚠️ **STILL NOT VOLBEAT'S SHAPE EITHER, AND THE CENSUS SAYS SO.** Volbeat
      `sv06-009` and Exeggcute `sv08-001`/`sv08-192` print the same licence on ONE
      ATTACK ("you can use *this attack* during your first turn") — a PER-INDEX
      field beside `CardProgram.attack`, not this one. ⚠️ **AND THE ARGUMENT IS
      THE SENTENCE, NOT THE BODY COUNT — a re-query corrected an inherited claim
      here.** Volbeat carries a second attack ("Coordinated Strike") the licence
      must not reach, but **Exeggcute carries exactly ONE attack on both
      printings**, so "both bodies have a second attack" was false and would have
      made the per-index case rest on an accident of Volbeat's layout. The real
      reason is the referent: *"this attack"* names an INDEX and *"this Pokémon
      can use attacks"* names the BODY, and a per-body flag on Exeggcute would be
      indistinguishable today and wrong on the next reprint that adds an attack.

      ⚠️ **"If you go first" IS DESCRIPTIVE, NOT A SECOND CONJUNCT** — turn 1 is
      by construction the going-first player's turn (`trainerFirstTurnExempt`'s
      doc block makes the identical argument about the identical clause), so the
      going-second seat can never reach the ban this lifts and the flag needs no
      `BoardCondition` beside it. A `{ kind: "yourFirstTurn" }` here would be a
      SECOND reading of one rule (D131): the §4 attack ban is `state.turn === 1`
      and is NOT `isFirstTurnOf`, because the going-second seat's first turn is
      turn 2 and is unrestricted.

      ⚠️ **NO `MATCH_RECORD_VERSION` BUMP IS OWED**, for `cantAttackUnless`'s
      reason verbatim: nothing is persisted, the licence is a CATALOG fact
      re-derived from the board on every read. */
  attackFirstTurnExempt?: true;
  /** §4/§10 (D278) — the holder's own printed Ability LICENSES it to EVOLVE
      EARLY, in the ACTIVE SPOT: Eevee `sv08-143`/`sv08.5-074`/`svp-173`
      "Boosted Evolution", *"As long as this Pokémon is in the Active Spot, it
      can evolve during your first turn **or the turn you play it**."* — 3 legal
      printings on 1 byte-identical `abilities_json`.

      🛑 **IT IS NOT NAMED `evolveFirstTurnExempt`, AND THE NAME IS THE WHOLE
      SAFETY ARGUMENT.** The sentence lifts **TWO** standing bans, not one, and
      they live 53 lines apart in `evolve` (turn.ts):

        1. §4/§10 — `isFirstTurnOf(state, seat)`, *"cannot evolve on your first
           turn"* (`FIRST_TURN_EVOLVE`);
        2. §10 — `target.turnPlayed >= state.turn`, *"came into play this turn"*
           (`EVOLVE_TOO_SOON`).

      A field called `evolveFirstTurnExempt` would name the first and invite
      every future author to wire only the first — and **a build that lifts only
      the first is GREEN on every turn-1 board in this repo**, because a SETUP
      Pokémon carries `turnPlayed = 0` (turn.ts says so explicitly) and `0 >= 1`
      is false, so ban 2 never fires on the board the licence is most obviously
      tested on. The failure is only visible on a LATER turn, on a body played
      THAT turn and promoted into the Active Spot. `evolveEarlyExempt` names the
      pair. **The printed reminder text on Eevee ex `sv08.5-075`/`-167`/`svp-174`
      corroborates the pair from the other side** — *"(This Pokémon can't evolve
      during your first turn or the turn you play it.)"* is the exact negation of
      this sentence, which is why those 3 printings are a false positive on the
      phrase and carry no program.

      🆕 **D279 WIDENED THIS FROM `true` TO A RECORD, AND THE RECORD HAS TWO KEYS
      BECAUSE THE POOL PRINTS TWO ANTECEDENTS.** `activeOnly` is Eevee's *"As long
      as this Pokémon is in the Active Spot"*; `ifInPlay` is Karrablast's and
      Shelmet's *"If you have <name> in play"* (their partner's name). **A record
      with both keys OMITTED is a licence with no antecedent at all — legal, and
      currently unprinted.** Widened rather than joined by a second boolean field
      (D131): it is ONE printed permission with one read site, and two fields
      would give the read site two channels for one reading.

      🛑 **THE ZONE CLAUSE IS PER-PRINTING, AND D278's BUILD MADE IT LOOK LIKE A
      PROPERTY OF THE FIELD.** `activeOnly` is `preventDamageAndEffectsWhileBenched`'s
      placement (D253) with the sign flipped: `passivesOf` already computes
      `onBench`, the clause names THIS body, and answering it there keeps the read
      site free of zones. LIVE, like every gate in that fold — retreating the
      licensed Eevee off the Active Spot ends the licence mid-turn. But Karrablast
      and Shelmet print NO such clause, and a build that kept the fold's
      unconditional `&& !onBench` would REFUSE a benched Karrablast the card
      licenses. ⚠️ **THAT IS THE MIRROR OF THIS FIELD'S ORIGINAL TRAP: it fails by
      being TOO STRICT, so every "the licence works" assertion — all of which are
      naturally written on an ACTIVE body — stays green.**

      ⚠️ **`ifInPlay` IS NOT RESOLVED IN THE FOLD AND CANNOT BE.** It is
      seat-relative and `passivesOf` has no seat, so the fold lifts it into a
      `BoardCondition` (`yourNamedPokemonInPlay`) and `evolveEarlyLicensed`
      (interpreter.ts) evaluates it — `cantAttackUnless`'s split verbatim. A
      `string` here rather than a `BoardCondition` because the printed clause has
      exactly one degree of freedom, the partner's NAME, and letting a registry
      author write any condition would invite gates no printing carries.

      §9-SUPPRESSIBLE like every flag in that loop: the licence IS a printed
      Ability, so a Klefki `sv01-096` Ability-lock silences "Boosted Evolution"
      and hands both bans back. Reading `programFor(top.id)` straight off the
      target at the five ban lines would be shorter and would get that wrong
      silently (`attackFirstTurnExempt`'s rule one field up).

      ✅ **KARRABLAST `sv10.5b-009`/`-094` AND SHELMET `sv10.5w-008`/`-093` (4
      printings) ARE BUILT AS OF D279** — the two mechanisms D278 named are the
      two that were needed and no more. ⚠️ **THEY ARE FOUR PRINTINGS ON *TWO*
      SENTENCES, NOT ONE**: Karrablast names Shelmet and Shelmet names Karrablast,
      so there are TWO `CardProgram` objects here, unlike Eevee's one. ⚠️ An
      inherited note called their gate *"`yourBenchHasNamed`'s sentence on a field
      that does not exist"*; the member DOES exist (effects.ts) and it is
      **BENCH-ONLY BY CONSTRUCTION**, so the answer was a SECOND member
      (`yourNamedPokemonInPlay`) and not a wider reading of the first — its sole
      consumer, Falinks `sv02-119`, reads its own name off its own Bench while a
      Falinks is Active, and widening it would make that +90 unconditional.
      (⚠️ The inherited note said Falinks `sv06-160`; that is the wrong id.)

      ⚠️ **NO `MATCH_RECORD_VERSION` BUMP IS OWED**, for `attackFirstTurnExempt`'s
      reason verbatim: nothing is persisted, the licence is a CATALOG fact
      re-derived from the live board on every read. */
  evolveEarlyExempt?: { activeOnly?: true; ifInPlay?: string };
}

/** A Stadium's "once during each player's turn" ACTIVATED ability (§7.3) —
    Artazon / Mesagoza / Town Store. Unlike the continuous fields beside it this
    runs an op `program` when the turn's own player activates it (the
    `useStadiumAbility` action, cardplay.ts), so it may PARK on a search choice
    like any Trainer/Ability program. There is no `oncePerTurn`/`activeOnly`
    field: a Stadium ability is ALWAYS once-per-player-turn (tracked by the
    per-turn `TurnAllowances.stadiumAbilityUsed` flag) and belongs to no Pokémon
    spot. `label` is the Stadium's own name, for the log/HUD. */
export interface StadiumAbility {
  label: string;
  program: EffectOp[];
}

/** A Stadium's effects (§7.3) — applied while the card sits in the shared zone.
    The two continuous fields are read by continuous.ts off `GameState.stadium`
    for BOTH players' boards; the optional `ability` is the activated "once during
    each player's turn" effect (Artazon / Mesagoza / Town Store), run by the
    `useStadiumAbility` action for the turn's own player. */
export interface StadiumEffects {
  /** §11 retreat costs THIS much less for every Basic Pokémon in play
      (Beach Court), floored at a free retreat. */
  basicRetreatDiscount?: number;
  /** §11 retreat costs `amount` MORE for every Basic Pokémon in play
      (Calamitous Wasteland), except one exempt type — the print reads "each
      Basic non-{F} Pokémon". An OBJECT rather than a bare number twin of
      `basicRetreatDiscount` because this print NARROWS where Beach Court's
      does not; `excludesType` is the optional refinement (the
      `noRetreatCostAura.requiresEnergyType` idiom), so an ungated surcharge
      would just omit it. Matched against the Pokémon's own `Card.types`, whose
      vocabulary is the same word list ("Fighting" for {F}). */
  basicRetreatSurcharge?: { amount: number; excludesType?: BasicEnergyType };
  /** Attacks of every Basic Pokémon in play cost this many {C} more
      (Pokémon League Headquarters). */
  basicAttackCostSurcharge?: number;
  /** §8.5 — prevent ALL attack damage done to any Pokémon WITHOUT a Rule Box, on
      BOTH boards, when the attacker is a Pokémon ex or a Pokémon V (Neutralization
      Zone sv06.5-060 — "Prevent all damage done to Pokémon that don't have a Rule
      Box (both yours and your opponent's) by attacks from the opponent's Pokémon
      ex and Pokémon V."). The pool's only Stadium on the damage pipeline, and the
      first `StadiumEffects` field read by anything other than the retreat/attack
      COST seam.

      A BARE FLAG per D104's minimal-shape rule: both filters are printed
      constants of the one printing, so there is nothing left to parameterise. The
      NAME carries both, deliberately — a `preventDamage: {...}` record would
      invite the next Stadium to reuse a shape whose two halves are this card's
      alone.

      THE TWO PREDICATES ARE THE ENGINE'S EXISTING ONES, NOT A SECOND ANSWER:
        • "don't have a Rule Box" is `cards.ts hasRuleBox` NEGATED — the suffix
          families ∪ the "Radiant " prefix, i.e. exactly the predicate Artazon's
          `basicPokemon.noRuleBox` search filter already reads, and exactly what
          this card's own reminder text ("Pokémon ex, Pokémon V, etc. have Rule
          Boxes.") describes. Note the card is itself an ACE SPEC, which is a
          TRAINER subtype and reaches no Pokémon-only check;
        • "the opponent's Pokémon ex and Pokémon V" is `cards.ts isExOrV` — D107's
          predicate reused verbatim, narrower than `hasRuleBox` (no VMAX/VSTAR/GX),
          which is the asymmetry the sentence itself prints: the PROTECTED side is
          filtered by rule box, the ATTACKING side by the ex/V pair.
      Reading either a second time would be a second chance to disagree with §8.1's
      prize-value work about what a Rule Box is.

      "THE OPPONENT'S" IS SATISFIED BY CONSTRUCTION rather than by a check: all
      four attack-damage sites damage the DEFENDING side, so the attacker is always
      the protected Pokémon's opponent. A Pokémon's own `damageSelf` recoil never
      routes through them, which is what keeps the possessive honest without a seat
      argument.

      NOT §9-suppressible (a Stadium is not an Ability, so `disabledAbilityUids`
      has nothing to say about it) and NOT nulled by Feint Attack's `ignoreWR`,
      which scopes "any effects on that Pokémon" — a Stadium is an effect on the
      shared zone and on no Pokémon at all. Both are the sharpest lines between
      this field and the two `PassiveEffects` preventions it sits beside.

      ⚠️ THE CARD'S SECOND SENTENCE STAYS LOUD. "This card can't be put into your
      hand or deck from the discard pile." is a DISCARD-PILE RETRIEVAL restriction
      with one sibling in the pool (Poké Vital A sv06.5-062) and no reader anywhere
      in the engine: no op, no filter and no search path consults a card's own
      retrievability. Naming it here would be inventing a mechanism. */
  preventDamageToNoRuleBoxFromExV?: true;
  /** §7.3/§8.1 (D324) — the in-play Stadium's ± to the max HP of every Pokémon of
      ONE STAGE, on BOTH sides: *"Each Basic Pokémon in play (both yours and your
      opponent's) gets +30 HP"* (Lively Stadium `sv08-180`) and *"Each Stage 2
      Pokémon in play (both yours and your opponent's) gets -30 HP"* (Gravity
      Mountain `sv08-177`/`sv08-250`). Three legal printings, two sentences, and
      the two sentences differ in exactly two places — the SIGN and the STAGE — so
      they are each other's control on every board either one reaches.

      🛑 ONE SIGNED FIELD AND NOT A `hpDiscount`/`hpSurcharge` PAIR, WHICH IS THE
      OPPOSITE OF `basicRetreatDiscount`/`basicRetreatSurcharge` TWO SCREENS UP,
      AND THE DIFFERENCE IS PRINTED. Those two are split because the surcharge
      carries a rider the discount does not (`excludesType`), so a single field
      would have to carry a clause half its writers never print. These two carry no
      riders at all beyond the stage they name, so a pair would be two fields whose
      only distinction is which way the number leans — and the read site would then
      have to re-add them, which is the D131 two-channels-for-one-reading defect.

      🛑 NO SEAT IS DERIVED AND THERE IS NO §9 GATE, for `stadiumPreventsDamage`'s
      reasons verbatim: the print says *"both yours and your opponent's"*, so there
      is no side to find, and a Stadium is not an Ability, so a Klefki lock that
      silences Ludicolo's aura one field away leaves this untouched. That pair —
      an Ability aura and a Stadium delta summing into the SAME number at the SAME
      read site with OPPOSITE answers to a lock — is the sharpest board this slice
      builds.

      ⚠️ 🛑 **AND THE NEGATIVE PRINTING IS WHY `effectiveMaxHp` NOW FLOORS.** That
      function's return has been documented as NEVER NON-POSITIVE since D205, and
      a DELETED dead branch in `koSurvivalClamp` depends on it (`0 + dealt >= hp`
      can only hold for `dealt >= 1`). Gravity Mountain is the first term in the
      engine that can push it DOWN, so the invariant is now maintained by an
      explicit `Math.max` rather than by the absence of a subtrahend. ⚠️ **THE
      FLOOR IS UNREACHABLE AND IS DECLARED RATHER THAN DRIVEN** (D257's precedent):
      the MINIMUM printed HP over all **169** Standard-legal Stage 2 Pokémon is
      **120**, so the only sentence that subtracts bottoms out at 90. */
  hpDelta?: { amount: number; stage: "basic" | "stage2" };
  /** The "once during each player's turn" activated ability (Artazon / Mesagoza
      / Town Store). A Stadium WITH this can be activated; the continuous-only
      Stadiums (Beach Court / League HQ) leave it undefined. */
  ability?: StadiumAbility;
}

/** A Special Energy's on-attach effect (§6.1) — runs the moment it is attached
    from hand. Kept a tiny tagged union (not an EffectOp program) because these
    read the ATTACH context, which the {seat}-only interpreter doesn't carry. */
export type EnergyOnAttach =
  /** Jet Energy: attaching to a Benched Pokémon switches it to the Active Spot. */
  | { kind: "switchIfBenched" }
  /** D261 — Enriching Energy `sv08-191`: *"When you attach this card from your
      hand to a Pokémon, draw 4 cards."* THE UNION'S SECOND MEMBER, and its first
      since M4 slice 5.

      🛑 UNGATED BY SPOT, WHICH IS THE SHARPEST DIFFERENCE FROM THE ARM ABOVE. Jet
      prints *"to 1 of your Benched Pokémon"* and its read site guards on
      `spot === "bench"`; this one prints *"to a Pokémon"*, so a build that copied
      that guard would be green on a bench board and silently dead on every Active
      attach. Both spots are driven in `mistEnergy.test.ts`.

      ⚠️ `count` IS CATALOG DATA ON THE ROW, NOT A LITERAL IN THE ARM, by D260's
      test for which way to go: a second printing of this mechanism would need a
      different number, so the number belongs to the registry row. */
  | { kind: "draw"; count: number };

/** A Special Energy's rules text (§6.1), read while attached. `provides` is the
    units it contributes to attack costs (a concrete type, or `ANY_ENERGY` for
    a wildcard — Luminous "every type of Energy but 1 at a time"); multi-unit is
    allowed. A Special Energy WITH this entry provisions through it; one WITHOUT
    falls back to the conservative Colorless provider (cards.ts energyProvidesOf),
    so an unauthored special energy stays playable (energy always provides
    something) rather than loudly rejecting like a Trainer. */
export interface EnergyProgram {
  provides: string[];
  /** Luminous: the units provided INSTEAD when the holder already has another
      Special Energy attached ("this card provides {C} Energy instead"). */
  demoteWithOtherSpecial?: string[];
  /** D262 — the units provided INSTEAD when the HOLDER's printed STAGE matches.
      Two legal printings carry this shape and they differ ONLY in the two values
      below:

        Neo Upper Energy `sv05-162` — *"If this card is attached to a **Stage 2**
        Pokémon, this card provides every type of Energy but provides only **2**
        Energy at a time."*
        🆕 Prism Energy `sv10.5b-086` (D300) — *"If this card is attached to a
        **Basic** Pokémon, this card provides every type of Energy but provides
        only **1** Energy at a time."*

      🆕 **D300 WIDENED THIS FROM `promoteOnStage2Holder?: string[]`, AND THE
      RENAME IS THE ROW.** D262 wrote the stage word into the FIELD NAME because
      one printing carried it; the second printing makes that name a lie on half
      its users. The stage is now a VALUE, which is this repo's settled spelling
      for exactly this (`disableAbilities.stage`, `noRetreatCostAura.stage`,
      `ownerPokemon.stage`, `typedPokemon.stage` — four riders that already carry a
      stage word as data), so a THIRD stage costs a value and not a field.

      ⚠️ IT IS STILL A SIBLING OF `demoteWithOtherSpecial` AND NOT A WIDENING OF
      IT, for D262's reason unchanged: that field's condition is about the holder's
      OTHER ATTACHED ENERGY and this one's is about the holder's PRINTED STAGE, so
      merging them would need a discriminant to say WHICH question is being asked.
      Merging Basic with Stage 2 needs no discriminant — it is the SAME question
      with a different answer, which is the whole reason one widens and the other
      does not. `continuous.ts unitsOf` reads the two fields in field order and NO
      printing in this pool carries both.

      ⚠️ THE VALUE IS A **MULTISET OF UNITS**, WHICH IS THE HALF THAT CAN GO WRONG.
      `[ANY_ENERGY, ANY_ENERGY]` is TWO wildcard units — "every type of Energy but
      only **2** at a time" — and not one wildcard worth two. `costMet` (attack.ts)
      consumes the flat list, so a row with a single entry pays every one-symbol
      cost and fails only a two-symbol one; a mutant that drops the second entry is
      in the corpus for exactly that reason. 🆕 Prism's `units` is `[ANY_ENERGY]`
      — ONE — so the two printings are each other's control on that axis too.

      🆕 **D302 WIDENED THIS A SECOND TIME, AND THE WIDENING IS TWO OPTIONAL
      RIDERS PLUS A THIRD STAGE VALUE — NOT A RENAME.** Reversal Energy
      `sv04-266` prints the same promotion behind a THREE-TERM antecedent:

        *"If you have more Prize cards remaining than your opponent, and if this
        card is attached to an **Evolution** Pokémon that **doesn't have a Rule
        Box** (Pokémon ex, Pokémon V, etc. have Rule Boxes), this card provides
        every type of Energy but provides only **3** Energy at a time."*

      `stage: "Evolution"` is D300's own price paid exactly as D300 quoted it —
      *"a third stage word costs one case in `continuous.ts unitsOf`'s ternary
      and a registry row — not a field"* — and the two extra terms are the only
      genuinely new things, so they are OPTIONAL riders on this same object.

      🛑 **THE NAME STAYS, AND THE DISTINCTION IS THE ONE D300's RENAME WAS
      ABOUT.** D262's `promoteOnStage2Holder` was a LIE: it baked a VALUE
      (`Stage2`) into the name, and half its users were `Basic`. This name bakes
      no value — every one of the three printings IS gated on the holder's
      printed stage, and the riders NARROW that gate rather than replacing it.
      An incomplete name is not a false one, and renaming a field whose two
      mutation rows quote its declaration line would have bought churn and no
      honesty.

      🛑 **`whileMorePrizesRemaining` IS A BESPOKE OPTIONAL FLAG AND NOT A
      `BoardCondition`, AND IT HAS TO BE — THIS IS `noRetreatCostSelf`'s
      RECORDED REASON VERBATIM, ONE INTERFACE UP.** The vocabulary DOES carry
      this exact clause (`BoardCondition.morePrizesThanOpponent`, whose own doc
      block has named *"Defiance Band, Luxray and Reversal Energy"* since D40,
      and whose clause table maps this card's printed words verbatim), so the
      reuse is tempting and is UNAVAILABLE: `conditionHolds` lives in
      interpreter.ts, which IMPORTS continuous.ts, so reading a `BoardCondition`
      from the provision scan would close an import cycle. ⚠️ **THAT IS THE
      WHOLE OF D300's REFUSAL, AND IT WAS TYPED AS MISSING COMPOSITION WHEN IT
      WAS NEVER A COMPOSITION QUESTION**: the flag needs no combinator, no
      `allOf`, and no new member — `state.players[seat].prizes.length` is one
      read, and continuous.ts already imports `takenPrizes` from the same module.
      The polarity is the trap: *"more Prize cards REMAINING"* means you are
      **BEHIND** on Prizes taken, which is why the flag is named for the printed
      word and not for "ahead".

      ⚠️ **`noRuleBox` READS THE HOLDER'S TOP CARD, WHICH IS WHY IT IS HERE AND
      NOT A SECOND STAGE VALUE.** "Evolution that doesn't have a Rule Box" is a
      CONJUNCTION and not a fourth stage word: a Charizard ex is an Evolution
      WITH a Rule Box, and folding the two into one value would need a value per
      combination. `hasRuleBox` was already imported by continuous.ts. */
  promoteOnHolderStage?: {
    stage: "Basic" | "Stage2" | "Evolution";
    /** D302 — the holder must ALSO have no Rule Box (Reversal `sv04-266`). */
    noRuleBox?: true;
    /** D302 — AND you must have strictly more Prize cards REMAINING than your
        opponent, i.e. you are BEHIND on Prizes taken (Reversal `sv04-266`). */
    whileMorePrizesRemaining?: true;
    units: string[];
  };
  /** Effect run on attach from hand (Jet's switch). */
  onAttach?: EnergyOnAttach;
  /** ⚠️ THE CONTINUOUS SURFACE (D174) — the one field on this interface that is
      read while the card merely SITS ATTACHED. The three above are all read at
      ATTACH time (`onAttach`) or at COST time (`provides` /
      `demoteWithOtherSpecial`), which is exactly why D172 could price Therapeutic
      Energy `sv02-193` as "a surface" rather than "a third registry row":

        "As long as this card is attached to a Pokémon, it provides {C} Energy.
         The Pokémon this card is attached to recovers from being Asleep, Confused,
         or Paralyzed and can't be affected by those Special Conditions."

      ⚠️ IT IS `PassiveEffects` AND NOT A NARROWER §12-ONLY FIELD, WHICH IS A
      DELIBERATE CHOICE WITH A PRICE PAID IN AN AUDIT. The narrow option
      (`statusImmunities?: StatusName[]` here) would have bought a smaller blast
      radius and cost a SECOND vocabulary for one reading — continuous.ts
      `passivesOf` would have to fold two differently-shaped source types into one
      answer, which is D131's drift with an Energy hat on. Reusing the interface
      makes the Energy the fold's THIRD SOURCE CLASS on equal terms with the top
      card and the Tools, and every one of the twelve fields that fold READS thereby
      gains an attached-Energy contributor. **That is not free, and D174 did not
      take it for free**: each of the twelve was re-read against "can an Energy reach
      it, and is that reading right", and the audit is written out in continuous.ts
      `passivesOf` beside the `sources` array it widened.

      ⚠️ §9 STATED THE OTHER WAY ROUND FROM A POKÉMON's. A printed passive on a
      Pokémon IS an Ability and a §9 lock suppresses it; a TOOL is not, and
      `passivesOf` has always kept Tools under a lock. AN ENERGY IS NOT AN ABILITY
      EITHER, so this source is EXEMPT from the same drop — by construction (it is
      appended after the tools, past the `disabled` term) and, because construction
      is what D172's own three wrong claims were made of, DRIVEN: a lock proved live
      on the holder's uid first, with the holder's OWN printed immunity dying in the
      same call while the Energy's survives (therapeuticEnergy.test.ts). */
  passive?: PassiveEffects;
}

/** §4/§8 (D281) — the printed timing clause on ONE attack index. THREE members,
    of which the first two are ONE clause at OPPOSITE POLARITY over the same
    condition and the third carries no condition at all.

    🛑 **`barredIf` IS NOT `onlyIf` OF A NEGATION, AND THAT IS WHY THERE ARE TWO
    MEMBERS RATHER THAN A `not`.** `BoardCondition` has refused a `not` member
    since D125 and the refusal STANDS — D280 re-derived it and found both of its
    stated premises wrong (its price is 2 recursion arms, not 5; its population
    is 7 legal printings, not 0) while its conclusion held: polarity belongs in
    the CONSEQUENT, where exactly one reader has to know about it, rather than in
    the vocabulary, where every consumer of every condition would. Terapagos ex's
    7 printings ARE that population, and this member is what they get instead.

    ⚠️ **`firstTurnExempt` LIFTS §4's BAN; IT DOES NOT GATE ANYTHING.** The other
    two members can only ever REMOVE a declaration the rules allow; this one only
    ever ADDS one. A build that spelled Volbeat's *"If you go first, you can use
    this attack during your first turn"* as `onlyIf allOf([…, yourFirstTurn])`
    would be green on the only board anyone writes for it (turn 1, going first)
    and would forbid "Quick Sign" on every other turn of the game — the D278/D279
    too-strict failure, which the whole suite you would naturally write cannot
    see. The board where it is DENIED is asserted first in this slice's suite. */
export type AttackTimingGate =
  /** *"You can use this attack only if <condition>."* — the index is barred
      unless the condition holds. Illumise / Scream Tail ex. */
  | { kind: "onlyIf"; condition: BoardCondition }
  /** *"If <condition>, you can't use this attack."* — the index is barred while
      the condition holds. Terapagos ex ×7. */
  | { kind: "barredIf"; condition: BoardCondition }
  /** *"If you go first, you can use this attack during your first turn."* — §4's
      turn-1 attack ban is lifted for THIS index only. Volbeat / Exeggcute. */
  | { kind: "firstTurnExempt" };

export interface CardProgram {
  /** Registry-authored attack programs, keyed by ATTACK INDEX (the position in
      the card's printed `attacks` list — the same index the `attack` action
      carries). A card authors the attacks the deriver does not read; the rest fall
      back to `deriveAttackEffect` (or stay unsimulated).
      Sits ABOVE the deriver (D8): `programFor(id)?.attack?.[index] ?? derive`.
      Chien-Pao ex "Hail Blade" (sv02-061 idx 0, D96) was the first; Mewtwo VSTAR
      "Psy Purge" (swsh10.5-031 idx 0, D97) the second — and the first on a
      MULTI-attack card, which is WHY this is index-keyed: its idx-1 "Star Raid"
      must fall through to unsimulated, not inherit Psy Purge's program.

      🆕🆕 **D402 — "AUTHORED" AND "DERIVABLE" ARE NO LONGER EXCLUSIVE, AND THE `??`
      IS WHY THAT COSTS NOTHING.** The sentence above used to say a card authors only
      the attacks the deriver REFUSES. Both examples it names are now read by
      `deriveAttackEffect` too — into the identical program — because D402 spent a
      refusal D96 wrote on the day its ops were invented. The row still wins, so no
      board moves; what changed is that the two producers can now be asserted AGAINST
      each other (`hailBlade.test.ts`, `psyPurge.test.ts`), which is a stronger rung
      than either had alone. ⚠️ **AND THAT IS THE REASON THE ROWS ARE KEPT RATHER
      THAN RETIRED**: a registry row is legality-keyed and both cards have rotated,
      so the rows serve ZERO Standard-legal printings (D187) — but Mewtwo VSTAR's is
      this engine's only index-keyed multi-attack witness, and deleting it would
      delete the proof that "Star Raid" does not inherit index 0's program. */
  attack?: { readonly [attackIndex: number]: EffectOp[] };
  /** §4/§8 (D281) — the printed TIMING clause on ONE attack, keyed by the SAME
      ATTACK INDEX `attack` above is keyed by. **13 legal printings on 5 bodies
      and 3 printed shapes** (re-derived at D281, remote D1, `json_each`):

        BAN     7  Terapagos ex `sv07-128`/`-170`/`-173`/`sv08.5-092`/`-169`/
                   `-180`/`svp-165` idx 0 "Unified Beatdown" — *"If you go
                   second, you can't use this attack during your first turn."*
        GATE    3  Illumise `sv06-010` idx 0 "Slowing Perfume", Scream Tail ex
                   `sv06-094`/`-197` idx 0 "Scream" — *"You can use this attack
                   only if you go second, and only during your first turn."*
        LICENCE 3  Volbeat `sv06-009` idx 0 "Quick Sign", Exeggcute `sv08-001`/
                   `-192` idx 0 "Precocious Evolution" — *"If you go first, you
                   can use this attack during your first turn."*

      🛑 **ONE FIELD, NOT TWO OR THREE, AND THE ARGUMENT IS THE SENTENCE FAMILY
      RATHER THAN THE READ SITE.** `cantAttackUnless` and `attackFirstTurnExempt`
      are two `PassiveEffects` fields because their two senses come from two
      unrelated printed sentences on two different cards, and a single field
      would make every author ask "which way round is this row?". Here the BAN
      and the GATE are **the same clause with one printed word changed** ("can"
      / "can't") over **the same condition** — `allOf([youGoSecond,
      yourFirstTurn])`, authored identically on both — so a polarity TOKEN is the
      honest carrier and two parallel index maps would be one map with the
      discriminator hoisted into a field name. ⚠️ The two index SETS are in fact
      disjoint per body (measured: no body prints two of these clauses), so two
      maps would have been *green*; that is an accident of today's pool and not a
      reason.

      🆕🆕 **D395 — "every one of the 13 is at index 0" WAS ALSO IN THAT SENTENCE
      AND IS NO LONGER TRUE.** Miltank `sv08.5-081`'s gate is at index **1**
      ("Moomoo Rolling"), and the attack its clause NAMES is at index 0 on the same
      card. That is the first printing on which this record's KEY can be wrong: for
      all 13 rows before it an index-blind read answered identically, so the
      `[attackIndex: number]` half of this type had no falsifying board anywhere in
      the repo. It has one now, and the failure it catches is total — an index-blind
      read gates "Rollout", which is the only attack that can ever satisfy the
      gate.

      🛑 **THE LICENCE IS THE THIRD ARM AND IT CARRIES NO `BoardCondition` AT
      ALL** — D223/D277/D280 each established independently that *"If you go
      first"* is DESCRIPTIVE: turn 1 IS the going-first player's turn, so the
      antecedent is unfalsifiable at the moment the clause can matter and a
      condition here would be a SECOND reading of §4 (D131). It is in this field
      rather than beside `attackFirstTurnExempt` because the printed subject is
      *"this **attack**"* and not *"this Pokémon"* — the referent names an INDEX
      (registry.ts's `attackFirstTurnExempt` doc block argued exactly this, and
      Volbeat's second attack "Coordinated Strike" is the body that would inherit
      the licence wrongly from a per-body flag).

      🛑 **READ OFF THE CARD AND *NOT* THROUGH `passivesOf`, WHICH IS THE EXACT
      INVERSE OF `attackFirstTurnExempt`'s RULE AND THE EASIEST THING HERE TO GET
      WRONG.** That flag rides the §9-suppressible passive fold because the
      licence is printed as an **Ability** ("Debut Performance"), so a Klefki
      `sv01-096` Ability-lock silences it. Every clause in THIS field is printed
      as **attack text**, and §9 locks Abilities only — a Klefki must NOT hand
      Terapagos its "Unified Beatdown" back, nor take Volbeat's licence away. So
      `attackGateOf` (continuous.ts) reads `programFor(top.id)` directly, and the
      difference is DRIVEN under a live lock rather than asserted.

      ⚠️ **NO `MATCH_RECORD_VERSION` BUMP IS OWED**, for `cantAttackUnless`'s
      reason and one more of its own: nothing is persisted (the gate is a CATALOG
      fact re-derived from the board on every read), and the value carries **no
      `EffectOp`**, so unlike a `conditionGate.cond` it cannot ride a parked
      `EffectContinuation.pendingOp` into a record. Both halves are swept. */
  attackGate?: { readonly [attackIndex: number]: AttackTimingGate };
  /** Activated Abilities printed on this card. */
  abilities?: AbilityProgram[];
  /** The Trainer's play effect (Item/Supporter — §7.1/§7.2). */
  trainer?: EffectOp[];
  /** The printed "You can use this card only if <board condition>" legality gate
      (Fighting Au Lait: "…only if you have more Prize cards remaining than your
      opponent"). playTrainer checks it BEFORE the card leaves hand, so a failed
      gate costs the player nothing — a printed RULE, categorically different
      from `programPlayable`'s would-only-whiff heuristics (which are the
      engine's judgement about ops that would do nothing, not text on the card).
      The condition reads only public state (BoardCondition), so the HUD greys
      the card out with the same evaluator instead of offering a dead button.

      NAMED `trainer…` BECAUSE IT IS HONOURED ON EXACTLY ONE PATH — playTrainer's
      Item/Supporter branch. `playStadium`, the `rareCandy` action, `attachTool`
      and `useAbility` all return before it and would ignore it SILENTLY, so an
      Ability-level gate (Luxray's "if you have more Prize cards remaining",
      which also needs an in-hand Ability surface this engine does not have) must
      NOT be authored here — it needs its own check on useAbility, sharing the
      same `conditionHolds`. The `trainerEndsTurn` flag above is scoped the same
      way for the same reason. */
  trainerPlayableIf?: BoardCondition;
  /** Triggered Abilities printed on this card (§9) — fire on a game event
      (played to Bench / evolved / between turns), not player-activated. */
  triggered?: TriggeredAbility[];
  /** Continuous/passive modifiers (a Pokémon's passive Ability, or a Tool's
      effect on its holder — read while in play). A Tool is attachable when it
      carries THIS entry **or** a `triggered` one; a Tool with neither is "not
      simulated" (coverage strategy). ⚠️ That disjunction is D171's correction:
      this field alone was the attachability test until Exp. Share sv01-174 became
      the first Tool whose whole printed sentence is a triggered program (see
      cardplay.ts `attachTool`). */
  passive?: PassiveEffects;
  /** The Stadium's continuous effects (§7.3). A Stadium with this entry is
      playable; one without is "not simulated" (coverage strategy). */
  stadium?: StadiumEffects;
  /** A Special Energy's rules text (§6.1). */
  energy?: EnergyProgram;
  /** Marks the Rare Candy Item (§7.1): the Basic→Stage 2 evolve-skip. It runs
      no op program (it evolves, which the interpreter must never do — flow.ts
      owns every Knock Out), so it is NOT a `trainer` array; the dedicated
      `rareCandy` action (cardplay.ts) carries the target Basic + the Stage 2,
      reuses the shared evolution placement (turn.ts placeEvolution), and
      resolves the mid-turn evolve-below-HP KO + the on-evolve trigger through
      the same machinery as `evolve`. `programFor(id)?.rareCandy === true` is
      how playTrainer rejects it (like a Tool) and how the HUD knows to open the
      Rare Candy dialog instead of dispatching playTrainer. */
  rareCandy?: true;
  /** The `trainer` play ENDS the controller's turn once its program completes
      (Katy: "Shuffle your hand into your deck. Then, draw 8 cards. Your turn
      ends."). playTrainer passes this to flow.ts settleProgram, which folds it
      EXACTLY like AbilityProgram.endsTurn — instead of returning to turn:action it
      seeds the turn tail. Only meaningful alongside `trainer`; assumes the program
      does not damage (Katy only draws), so no mid-turn KO sweep is owed. */
  trainerEndsTurn?: true;
  /** The printed EXEMPTION from §4's going-first Supporter lock: "If you go
      first, you may use this card during your first turn." (Carmine sv06-145 and
      its three reprints, D223; Team Rocket's Proton sv10-177/-227 prints the
      same sentence and was authored at D224 — the transfer D223 predicted, and
      the whole of that slice's engine cost).

      ⚠️ IT LIFTS EXACTLY ONE REFUSAL AND NOTHING ELSE. cardplay.ts's Supporter
      branch returns `FIRST_TURN_SUPPORTER` on `state.turn === 1`; this flag makes
      that ONE `err` not fire for this card. The §7.2 once-per-turn allowance is
      checked immediately below it and is deliberately OUTSIDE the exemption — the
      printed sentence licenses the TIMING, not a second Supporter — so a turn-1
      Carmine still consumes `allowances.supporterPlayed` and a second Supporter
      that turn is still refused.

      ⚠️ THE "IF YOU GO FIRST" HALF NEEDS NO SEPARATE TEST, AND THAT IS A CLAIM
      ABOUT THE TURN MACHINE RATHER THAN A SHORTCUT. Turn 1 IS the going-first
      seat's turn by construction (phaseViewOf: odd turns belong to
      `state.firstPlayer`) and `turnGate` has already proved the actor owns the
      phase, so `state.turn === 1` implies `action.seat === state.firstPlayer`.
      Spelling the second half into the condition would add a conjunct that no
      board can make false — a guard that cannot go red (conventions.md). It is
      DRIVEN instead: carmine.test.ts plays the card on a `first: "p2"` board and
      shows the going-second seat can never reach turn 1 at all.

      NAMED `trainer…` for the reason `trainerPlayableIf` / `trainerEndsTurn`
      carry the prefix: it is honoured on exactly ONE path, playTrainer's
      Item/Supporter branch. ⚠️ AND IT HAS TWO MIRRORS, which is the half a
      one-line field always under-prices (D222): both HUDs grey a Supporter row
      out on turn 1 themselves (`redact.ts` redactedTrainersOf for the online
      client, `GameHud.tsx` playableTrainers for the local one), so a flag read
      only by the engine would leave the card ENGINE-LEGAL AND UNCLICKABLE on the
      one turn it is printed for — the afford-then-reject defect with its sign
      flipped. All three read sites carry it. */
  trainerFirstTurnExempt?: true;
}

// ── The programs, authored from the printed text (verified vs the live
//    catalog, 2026-07-17) — see docs/workstreams/simulator.md "M4 slice 2". ──

/** "Discard your hand and draw 7 cards." (Supporter) */
const PROFESSORS_RESEARCH: CardProgram = {
  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 7 }],
};

/** "Search your deck for a Basic Pokémon and put it onto your Bench. Then,
    shuffle your deck." (Item) */
const NEST_BALL: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
    { op: "shuffleDeck" },
  ],
};

/** "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."
    (Supporter — the gust archetype) */
const BOSSS_ORDERS: CardProgram = { trainer: [{ op: "gust" }] };

/** "Switch your Active Pokémon with 1 of your Benched Pokémon." (Item)

    ⚠️ D206 — ALL THREE PRINTINGS OF THIS SENTENCE ARE `legal_standard = 0`
    (`sv01-194`, `sv03.5-206`, `mfb-34`, re-queried 2026-08-04). The op is NOT
    idle — D189's `ATTACK_SELF_SWITCH` deriver reads "Switch this Pokémon with 1
    of your Benched Pokémon." on 7 Standard-legal attack printings — but the
    TRAINER seam this row is, and which D205's Giovanni flag drove, had no legal
    card behind it until the two rows below. */
const SWITCH: CardProgram = { trainer: [{ op: "switchActive" }] };

/** D206 — Surfer `sv08-187/-235` (Supporter, 2 legal): "Switch your Active
    Pokémon with 1 of your Benched Pokémon. **If you do,** draw cards until you
    have 5 cards in your hand."

    THE WHOLE ROW IS `SWITCH` PLUS §9.2. Both ops in the consequent already
    existed and the gate is Miriam's, unchanged; the only new thing in the engine
    is that `switchActive` may now say which slot it files. That is why this row
    rather than Giovanni's is the one that prices the `recordAs` rider: it needs
    NOTHING else, so the seam is measured on its own before a second field is
    laid over it.

    ⚠️ `drawUntilHandSize` NEVER TRIMS, so a hand already holding 5 or more draws
    nothing — and the card is still PLAYABLE there, because the switch is a
    printed effect that happens. The would-whiff gate is `switchActive`'s alone
    (cardplay.ts), which is the same division `coinFlipGate`'s doc draws. */
const SURFER: CardProgram = {
  trainer: [
    { op: "switchActive", recordAs: "moved" },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    { op: "recordGate", slot: "moved", then: [{ op: "drawUntilHandSize", size: 5 }] },
  ],
};

/** D206 — Team Rocket's Giovanni `sv10-174/-225/-238` (Supporter, 3 legal):
    "Switch your Active **Team Rocket's** Pokémon with 1 of your Benched **Team
    Rocket's** Pokémon. **If you do,** switch in 1 of your opponent's Benched
    Pokémon to the Active Spot."

    The SECOND sentence is `BOSSS_ORDERS`' whole program, byte-identical — this
    row is that Supporter bought with a narrowed self-switch — and the *"If you
    do"* is load-bearing rather than decorative: on a board whose Active is not a
    Team Rocket's Pokémon (or whose Bench holds none), Giovanni must NOT gust.
    D205 flagged this row at exactly those two pieces and both are paid here from
    existing vocabulary.

    ⚠️ ONE `ownerPokemon` FOR TWO PRINTED NOUNS — see the op's doc. The narrowing
    is what makes the gate real: without it the program would be `SWITCH` plus a
    free Boss's Orders, the wrong-but-plausible build the exact-map-or-flag
    doctrine forbids, and it would look right on every board where the controller
    happens to be playing a Team Rocket's deck. */
/** D206 — Prime Catcher `sv05-157`/`sv08.5-119` (Item, ACE SPEC, 2 legal):
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. **If you
    do,** switch your Active Pokémon with 1 of your Benched Pokémon."

    ⚠️ **GIOVANNI'S TWO OPS IN THE OPPOSITE ORDER, WITH NEITHER END NARROWED** —
    which is what makes the §9.2 seam SYMMETRIC rather than a `switchActive`
    peculiarity, and why `gust` gains the same optional `recordAs` from the same
    shared helper. Both ops are `switchInto` on two different seats.

    The consequent is `SWITCH`'s whole program byte for byte, exactly as
    Giovanni's is `BOSSS_ORDERS`'. ⚠️ And its play gate is the RIGHT way round
    without a line of new code: `programPlayable` refuses a `gust` into an empty
    opponent Bench (the whole card whiffs), and does NOT scan a `recordGate`
    branch — so Prime Catcher with an empty OWN Bench is playable and does the
    half it prints, which is what the card does.

    ACE SPEC is a deckbuilding rule this engine does not model and has already
    authored around (Neutralization Zone `sv06.5-060`, D-era Stadium). */
const PRIME_CATCHER: CardProgram = {
  trainer: [
    { op: "gust", recordAs: "moved" },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    { op: "recordGate", slot: "moved", then: [{ op: "switchActive" }] },
  ],
};

const TEAM_ROCKETS_GIOVANNI: CardProgram = {
  trainer: [
    { op: "switchActive", ownerPokemon: "Team Rocket", recordAs: "moved" },
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
    { op: "recordGate", slot: "moved", then: [{ op: "gust" }] },
  ],
};

/** "Heal 30 damage from 1 of your Pokémon." (Item) */
const POTION: CardProgram = { trainer: [{ op: "healChosen", amount: 30 }] };

/** "Heal 30 damage from each Pokémon (both yours and your opponent's)." (Item —
    a no-choice whole-table heal, so it never parks and — like Potion — has no
    would-whiff play gate: legal to play even with nothing damaged.) */
const PICNIC_BASKET: CardProgram = {
  trainer: [{ op: "healEachAll", amount: 30 }],
};

/** "Search your deck for a Basic Energy card, reveal it, and put it into your
    hand. Then, shuffle your deck." (Item) */
const ENERGY_SEARCH: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "basicEnergy" }, dest: "hand", max: 1, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** Jacq — "Search your deck for up to 2 Evolution Pokémon, reveal them, and put
    them into your hand. Then, shuffle your deck." (Supporter). The Flamigo
    search-to-hand shape (`max: 2` = "up to 2"; ⚠️ **"reveal them" is NOT
    implicit in a to-hand search — that claim was measured FALSE at D224 and the
    gap is PAID at D225 by the `reveal: true` rider below, which is what makes
    the log name the two cards; annotated rather than deleted, D178**), narrowed
    by the new `evolutionPokemon` filter. Like every
    search Trainer it has no would-whiff play gate — legal to play even with no
    Evolution Pokémon in the deck (it just reveals nothing, then shuffles). */
const JACQ: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "evolutionPokemon" }, dest: "hand", max: 2, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** Chien-Pao ex — "Shivery Chill": once/turn, Active-only, "search your deck
    for up to 2 Basic {W} Energy cards … put them into your hand. Then, shuffle."
    and "Hail Blade" ({W}{W}, "60×"): "You may discard any amount of {W} Energy
    from your Pokémon. This attack does 60 damage for each card you discarded in
    this way." — the family's hardest damage card, and the FIRST registry-authored
    attack. Two ops: a DECLINABLE, whole-own-board, {W}-provision discard that
    FILES its count under the `discarded` §9.2 slot, then a `damageDefender` that
    reads that count and deals 60× it through the full W/R pipeline. Registry-
    authored (not derived) because on the day this row landed the printed sentence
    was a variable-count park the deriver could not read — 🆕🆕 **D402 SPENT THAT
    REFUSAL** (`ENERGY_DISCARD_SCALED_DAMAGE`, effects.ts, 6 sentences / 13 legal
    printings) and now derives this exact pair from this exact text. The row is
    KEPT and still wins (`programFor(id)?.attack?.[index] ?? derive`); what it buys
    beyond the arm is the AGREEMENT rung in `hailBlade.test.ts`. The printed "60×"
    base is suppressed (attack.ts) — the program owns the damage. */
const CHIEN_PAO: CardProgram = {
  attack: {
    0: [
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Water" },
        count: "any",
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ],
  },
  abilities: [
    {
      name: "Shivery Chill",
      oncePerTurn: true,
      activeOnly: true,
      program: [
        {
          op: "searchDeck",
          filter: { kind: "basicEnergy", energyType: "Water" },
          dest: "hand",
          max: 2,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Mewtwo VSTAR (swsh10.5-031) — "Psy Purge" ({P}{C}, "90×"): "Discard up to 3
    Psychic Energy from your Pokémon. This attack does 90 damage for each card you
    discarded in this way." The Hail Blade shape one step further: the SAME
    declinable whole-own-board discard feeding `damageDefender`, but CAPPED at 3
    (`cap: 3` bounds the `count: "any"` up-to). Registry-authored at INDEX 0 — and
    this is the first authored attack on a MULTI-attack card: index 1 "Star Raid"
    (the VSTAR Power spread onto opponent's Pokémon V) is NOT authored, so it falls
    through to unsimulated rather than inheriting Psy Purge's program. See D97.
    🆕🆕 **D402 — "the deriver refuses the sentence exactly as it does Hail Blade's"
    CAME OUT OF THE LINE ABOVE, AND THE PARALLEL IT DREW HELD TO THE END**: the
    deriver now reads BOTH, into both programs, and this printing is what pins the
    SPELLED-OUT notation (`Psychic`) and the `cap` against a hand-authored row. */
const MEWTWO_VSTAR: CardProgram = {
  attack: {
    0: [
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Psychic" },
        count: "any",
        cap: 3,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 90, count: "discarded" },
    ],
  },
};

/** Bouffalant — "Bouffer": "This Pokémon takes 20 less damage from attacks
    (after applying Weakness and Resistance)." (passive) */
const BOUFFALANT: CardProgram = { passive: { damageReductionAfterWR: 20 } };

/** Cacnea / Cacturne — "Counterattack Quills": "If this Pokémon is in the Active
    Spot and is damaged by an attack from your opponent's Pokémon (even if this
    Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon."
    (passive reactive recoil, §9). Byte-identical on both prints, so one const. */
const COUNTERATTACK_QUILLS: CardProgram = { passive: { damageAttacker: { amount: 30 } } };

/** Stunfisk — "Custom Trap": "If this Pokémon is in the Active Spot, has a
    Pokémon Tool attached, and is damaged by an attack from your opponent's
    Pokémon (even if this Pokémon is Knocked Out), put 5 damage counters on the
    Attacking Pokémon." — Counterattack Quills with the extra `requiresTool` gate
    (evaluated in continuous.ts against the holder's board). */
const STUNFISK: CardProgram = { passive: { damageAttacker: { amount: 50, requiresTool: true } } };

/** Klefki — "Mischievous Lock": "As long as this Pokémon is in the Active Spot,
    Basic Pokémon in play (both yours and your opponent's) have no Abilities,
    except for Mischievous Lock." (continuous Ability-lock aura, §9) */
const MISCHIEVOUS_LOCK: CardProgram = {
  passive: {
    disableAbilities: {
      stage: "Basic",
      side: "both",
      requiresActive: true,
      exemptAbilityNamed: "Mischievous Lock",
    },
  },
};

/** Spiritomb (sv02-089) — "Fettered in Misfortune": "Basic Pokémon V in play
    (both yours and your opponent's) have no Abilities." — no "in the Active Spot"
    clause, so the lock works from the Bench too. (The other Spiritomb, sv01-129,
    has no Ability and is not registered.) */
const FETTERED_IN_MISFORTUNE: CardProgram = {
  passive: { disableAbilities: { stage: "Basic", suffix: "V", side: "both" } },
};

/** Ting-Lu ex (sv02-127 + reprints) — "Cursed Land": "As long as this Pokémon is
    in the Active Spot, your opponent's Pokémon in play that have any damage
    counters on them have no Abilities, except for Pokémon ex." */
const CURSED_LAND: CardProgram = {
  passive: {
    disableAbilities: {
      side: "opponent",
      requiresDamage: true,
      requiresActive: true,
      exemptSuffix: "ex",
    },
  },
};

/** Florges (sv01-093) — "Blooming Garden": "Your Pokémon in play have no
    Weakness." — a continuous own-board aura (no "in the Active Spot" clause, so
    it works from the Bench). The only "no Weakness" Ability in the sv01–03 pool. */
const BLOOMING_GARDEN: CardProgram = { passive: { removeWeakness: true } };

/** Mimikyu (sv02-097) — "Safeguard": "Prevent all damage done to this Pokémon by
    attacks from your opponent's Pokémon ex and Pokémon V." — a holder-modifying
    full-prevention passive gated on the ATTACKER's rule-box class (ex/V, not
    VMAX/VSTAR/GX). Honored at every attack-damage read site (no "Active Spot"
    clause). The only ex/V-gated total-prevention print in the sv01–03 pool. */
const SAFEGUARD: CardProgram = { passive: { preventDamageFromExV: true } };

/** Cornerstone Mask Ogerpon ex (sv06-112/-199/-215, sv08.5-058/-160) —
    "Cornerstone Stance": "Prevent all damage from attacks done to this Pokémon by
    your opponent's Pokémon that have an Ability." FIVE Standard-legal printings on
    ONE sentence, and ONE object shared by all five (they are byte-identical
    reprints of a single card). `SAFEGUARD`'s twin one attribute over — a
    holder-modifying full prevention gated on a property of the ATTACKER, resolved
    at the four damage read sites through `cards.ts hasPrintedAbility`.

    ⚠️ THE HOLDER IS ITSELF AN ex WITH AN ABILITY, which is the fact that makes the
    gate's DIRECTION assertable rather than merely typed: nothing about the aura
    reads the holder, so a mirror match prevents in BOTH directions and a
    plain-Pokémon attacker with no Ability is prevented by NEITHER. A build that
    accidentally read the DEFENDER's `abilities` would pass every board where the
    holder is the only card on the table. */
const CORNERSTONE_STANCE: CardProgram = { passive: { preventDamageFromHasAbility: true } };

/** Carracosta (sv10.5b-023/-107) — "Mighty Shell": "Prevent all damage from and
    effects of attacks done to this Pokémon by your opponent's Pokémon that have any
    Special Energy attached." TWO Standard-legal printings on ONE sentence, and ONE
    object shared by both (byte-identical reprints of a single card).

    `CORNERSTONE_STANCE`'s twin one attribute over AND one printed clause wider —
    the attacker gate moves from the CATALOG (`hasPrintedAbility`) to the BOARD
    (`attackerHasSpecialEnergy`), and the prevention grows the effects half. Both
    changes are argued in full at `PassiveProgram.
    preventDamageAndEffectsFromSpecialEnergy` above.

    ⚠️ THE HOLDER IS AN ORDINARY STAGE 1 WITH NO RULE BOX AND NO ENERGY OF ITS OWN
    REQUIRED, which is what makes the gate's DIRECTION assertable rather than merely
    typed: nothing about the aura reads the holder's OWN attachments, so a Carracosta
    with a Special Energy on it is not thereby immune to a Special-Energy-free
    attacker, and a mirror match prevents in whichever direction the Special Energy
    happens to be. A build that read the DEFENDER's attachments would pass every
    board where only the holder is carrying Energy. */
const MIGHTY_SHELL: CardProgram = {
  passive: { preventDamageAndEffectsFromSpecialEnergy: true },
};

/** Poltchageist (sv06-020/-171) and Misty's Magikarp (sv10-048) — "As long as
    this Pokémon is on your Bench, prevent all damage from and effects of attacks
    from your opponent's Pokémon done to this Pokémon." THREE Standard-legal
    printings on ONE sentence, ONE object shared by all three.

    🛑 **THIS CONSTANT'S NAME IS WRONG AND SO WAS EVERY NAME IN THIS BLOCK UNTIL
    D305 — the BINDING was right the whole time.** Queried against remote D1
    `luminous`, 2026-08-09:
      • `instr(abilities_json, 'Curious Tea Party') > 0` returns **ZERO rows over
        all 3,786 rows**. **NO CARD IN THE CATALOG PRINTS AN ABILITY BY THAT
        NAME.** Poltchageist's Ability is **"Storehouse Hideaway"**.
      • `sv10-048` is **`Misty's Magikarp`** ("So Submerged"), **not `Sinistcha`**,
        and its `evolve_from` is **NULL** — so the "evolution LINE plus a reprint"
        this block used to claim is not the reason the three share an object. They
        share it because they print the same SENTENCE, full stop, which is D190's
        rule and needed no evolution story.
      • The real `Sinistcha` is **`sv06-022`** (`evolve_from = 'Poltchageist'`,
        `legal_standard = 1`) and **is not in this registry at all**.
    ⚠️ **THE NAME IS LEFT IN PLACE DELIBERATELY**, as `NEMONA` was at D304: renaming
    it would hide the lesson. **A CONSTANT'S NAME IS NOT EVIDENCE ABOUT ANYTHING**,
    and D305's census block in `censusAtHead.test.ts` asserts this object's card
    set by CATALOG NAME so that the names cannot rot again undetected.

    `MIGHTY_SHELL`'s twin with the attacker predicate REMOVED and a zone clause
    ADDED, and the whole slice is that swap: the printed object here is "your
    opponent's Pokémon", which is every attacker there is, so there is no attacker
    narrowing to express at all. Argued in full at `PassiveProgram.
    preventDamageAndEffectsWhileBenched` above.

    ⚠️ THE ZONE CLAUSE IS THE ONLY THING PROTECTING THIS BODY, AND IT IS ALSO WHAT
    MAKES THE CARD PLAYABLE RATHER THAN BROKEN — a printing that prevented all
    damage and effects unconditionally would be unanswerable, and the printed
    antecedent is exactly what keeps it beatable: drag the holder into the Active
    Spot (Boss's Orders) and the prevention is gone the same instant, with nothing
    to clear, because `passivesOf` re-reads the board on every damage step. That
    direction — ACTIVE holder prevents NOTHING — is the sharpest observable claim
    this program makes and is driven on a real board in curiousTeaParty.test.ts. */
const CURIOUS_TEA_PARTY: CardProgram = {
  passive: { preventDamageAndEffectsWhileBenched: true },
};

/** §11 PREVENTION, THE TRAINER-BORNE SPELLING — Fraxure `sv06.5-045`/`sv06.5-077`
    "Unnerve" and Cetitan ex `sv10-065`/`sv10-210` "Snow Camouflage", **4 legal
    printings on ONE sentence** and the largest row left in the `%prevent%` ability
    census D258 completed:

      "Whenever your opponent plays an Item or Supporter card from their hand,
       prevent all effects of that card done to this Pokémon."

    ⚠️ **THE FIRST PREVENTION IN THIS ENGINE WHOSE SOURCE IS NOT AN ATTACK**, and
    the reason the whole slice is a funnel widening rather than a new field with a
    read site: `EffectContext.invokedBy` already carried "what kind of thing is
    doing this", and every effect op already asked ONE function. Two shared objects
    across four printings rather than one, because the two sentences are byte-
    identical but the CARDS are not related (D190's rule cuts the other way here —
    the sharing is per PRINTED SENTENCE, and these four print one).

    ⚠️ **REACHABILITY WAS CHECKED BEFORE THE ROW WAS PROMISED** (D207's hazard) and
    the answer is REACHABLE, abundantly: `discardEnergy` off `opponentActive` /
    `opponentChosen` / `opponentEach` (Crushing Hammer, Giacomo), `applyStatus`
    (Dangerous Laser `sv06.5-058`) and `gust` (Boss's Orders, Pokémon Catcher) all
    aim a played Trainer's effect at an opposing body today. */
const UNNERVE: CardProgram = {
  passive: { preventTrainerEffects: true },
};

/** §11 PREVENTION, THE SEAT-WIDE TRAINER-BORNE SPELLING — Rhyperior `sv07-076`
    "Wide Wall", **1 legal printing**, and `UNNERVE`'s sibling with both clauses
    moved:

      "As long as this Pokémon is in the Active Spot, whenever your opponent plays
       a Supporter card from their hand, prevent all effects of that card done to
       all of your Pokémon."

    ⚠️ **A SCAN AND NOT A FOLD, SETTLED BY READING `passivesOf`'s SIGNATURE RATHER
    THAN BY ANALOGY**: that function takes an `InPlayPokemon` and no seat, so a
    rule whose object is "all of YOUR Pokémon" has nowhere to live in it. The read
    is `continuous.ts seatShieldedFromSupporterEffects`, argued in full on the
    field. Its Item half is ABSENT from the printed sentence, and the observable
    consequence — a Crushing Hammer landing on a Wide Wall board while a Boss's
    Orders does not — is this row's sharpest claim.

    A SINGLETON: no reprint, so there is no shared-object claim to make. */
const WIDE_WALL: CardProgram = {
  passive: { preventSupporterEffectsWhileActive: true },
};

/** §7.1 (D284) — the CONTINUOUS BAR ON THE PLAY, ONE-CLASS SPELLING. Tyranitar
    `sv09-095` "Daunting Gaze", **1 legal printing**:

      "As long as this Pokémon is in the Active Spot, your opponent can't play any
       Item cards from their hand."

    `WIDE_WALL`'s window and `WIDE_WALL`'s scan on a different VERB — that one
    lets the Supporter resolve and eats its effects, this one refuses the play
    outright, so the observable difference is whether the card leaves the hand at
    all. A SINGLETON: no reprint.

    ⚠️ A ONE-MEMBER ARRAY AND NOT A NAKED KEY. The shape is the printed CLASS
    LIST; Jellicent ex below prints two in the same slot, and one sentence being
    shorter than the other is not a different mechanism. */
const DAUNTING_GAZE: CardProgram = {
  passive: { preventOpponentHandPlay: ["Item"] },
};

/** §7.1/§7.4 (D284) — the same bar with the class list at length TWO, and the
    printing that made `HandPlayClass` wider than `StampedHandPlayClass`.
    Jellicent ex `sv10.5w-045`/`-160`/`-168` "Oceanic Curse", **3 legal printings
    of ONE sentence**, byte-identical across the three:

      "As long as this Pokémon is in the Active Spot, your opponent can't play any
       Item cards or Pokémon Tool cards from their hand."

    🛑 **THE TOOL HALF IS A FOURTH READ SITE AND THE OTHER PRINTING NEEDS NONE OF
    IT.** A Pokémon Tool never reaches `playTrainer`'s Item/Supporter branch —
    `cardplay.ts` routes it to `attachTool` two lines earlier (§7.4) — so a bar
    that only widened the Trainer gate would refuse Jellicent's Items and let its
    Tools through, which is the printed sentence honoured at exactly half. There
    is no HUD term to match it: Tools attach by DRAG, and
    `src/features/game/placement.ts` deliberately leaves "fine legality … to the
    engine (the pill)", so the affordance is coarse by design and the engine's
    refusal is the whole of the feedback.

    SHARED BY ID ACROSS THE THREE PRINTINGS — one object, three rows, the
    reprint idiom this file has used since M4. */
const OCEANIC_CURSE: CardProgram = {
  passive: { preventOpponentHandPlay: ["Item", "Tool"] },
};

/** §7.3 (D287) — the SAME continuous bar on the FOURTH and LAST `trainerType`,
    and the printing D284 refused BY NAME while recording that the class was
    already spellable. Copperajah `sv06.5-042` "Massive Body", **1 legal printing
    of ONE sentence, and the ONLY row in the catalog at any legality** (remote D1
    `luminous` `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 2026-08-08:
    `instr(abilities_json,'play any Stadium')>0` returns exactly this id with
    `legal_standard = 1`; the attack and effect columns return 0 — so no reprint
    and no attack-borne twin):

      "As long as this Pokémon is in the Active Spot, your opponent can't play any
       Stadium cards from their hand."

    🛑 **`DAUNTING_GAZE`'s BODY WITH ONE NOUN CHANGED, AND THE WHOLE COST OF THE
    ROW IS THE READ SITE D284 SAID WAS MISSING.** That refusal's stated reason was
    exact to the line: `playTrainer` hands a Stadium to `playStadium` BEFORE its
    `handPlayBarred` gate, so the widest imaginable class list could not have
    reached a Stadium play. **A REFUSAL WHOSE STATED REASON NAMES A LINE IS THE
    CHEAPEST KIND TO CASH** — the fix is one gate inside `playStadium` asking the
    SAME funnel, and `handPlayBarred` itself takes a zero-line diff.

    ⚠️ **THE GATE GOES INSIDE `playStadium`, NOT ON `playTrainer`'S DISPATCH
    LINE** — `attachTool`'s placement (D284) rather than the Item/Supporter gate's
    (D283). The rule is about PLAYING A STADIUM, so it belongs to the handler that
    owns that play; a future second caller of `playStadium` inherits it there and
    would not inherit a gate written on the dispatch line above.

    ⚠️ **WHAT THIS BAR CAN ACTUALLY STOP, MEASURED ON THE BARRED SIDE TOO** (D286's
    rule — query both sides of an interaction): **26 legal Stadium printings under
    19 distinct names**, so unlike D286's Rare Candy the barred population is large
    and the two cards genuinely meet on a Standard board.

    ⚠️ **THE HUD MIRROR IS HALF-WIRED ON PURPOSE AND THE HALF IS NAMED.** The LOCAL
    `playableTrainers` (GameHud.tsx) DOES list Stadium rows and therefore gains the
    term — without it a barred Stadium stays lit, is clicked, and is refused. The
    ONLINE `redactedTrainersOf` (redact.ts) skips Stadium rows ENTIRELY, so there
    is no row to grey and it takes a ZERO-line diff. **STILL MISSING, AND STILL
    NAMED: a Stadium payability mirror on the wire** — the gap D284's refusal note
    named, unchanged by this slice, because a bar cannot grey a row a projection
    never emits. It blocks the WIRE half only: the engine gate is authoritative on
    both transports, so an online seat is never allowed an illegal play, it merely
    learns the bar by dragging and reading the pill — the coarse-affordance
    contract `src/features/game/placement.ts` already states (D285's precedent).

    A SINGLETON, and §9-suppressible per SOURCE like every other printing of this
    field: a printed Pokémon Ability, so Klefki's lock takes the bar down. */
const MASSIVE_BODY: CardProgram = {
  passive: { preventOpponentHandPlay: ["Stadium"] },
};

/** §7.1/§7.4 (D291) — the RARITY axis of the same seat-wide bar, and the LAST
    row of D284's seven-sentence census. Genesect `sv06.5-040` "ACE Nullifier",
    **1 legal printing**, and the catalog holds **exactly one row whose printed
    text contains the words "ACE SPEC" at all** — measured across all three text
    columns with NO legality filter against the remote D1 `luminous`
    (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-08, which is D283's
    query-the-mechanism rule spent rather than re-learned:

      "If this Pokémon has a Pokémon Tool attached, your opponent can't play any
       ACE SPEC cards from their hand."

    ⚠️ **A BARE `true` AND NOT A CLASS LIST**, which is the inverse of
    `preventOpponentHandPlay`'s array argument and for the inverse reason: that
    field's value is a set because one printed sentence names two classes; this
    sentence names NO class, it names a rarity, and every class is barred at once.
    The Tool window is baked into the FIELD NAME (`preventSupporterEffectsWhileActive`'s
    precedent) rather than carried as data, because with one printing a data
    window would be a value no second row can differ on — D135's absent-key rule
    read from the other end.

    A SINGLETON, and §9-suppressible per SOURCE like every other printing in this
    family: a printed Pokémon Ability, so Klefki's lock takes the bar down. */
const ACE_NULLIFIER: CardProgram = {
  passive: { preventOpponentAceSpecPlayWhileToolAttached: true },
};

/** §7.5/§10 (D285) — the SAME continuous window, the SAME Active-Spot clause and
    the SAME seat-wide object, aimed at the POKÉMON surface instead of the Trainer
    one. Team Rocket's Arbok `sv10-113` "Potent Glare", **1 legal printing**:

      "As long as this Pokémon is in the Active Spot, your opponent can't play any
       Pokémon that has an Ability from their hand, except for Team Rocket's
       Pokémon."

    🛑 **THE ROW IS FOUR DATA FIELDS AND ZERO NEW PREDICATES, WHICH IS WHAT THE
    GATE SURFACE BOUGHT.** `acts` names both halves of a Pokémon play because the
    sentence bars the play itself; `only` is D285's `abilityPokemon` filter over
    D251's `hasPrintedAbility`; `except` is D200's `ownerPokemon` arm, its FIFTH
    reuse, spelling *"Team Rocket's"* the way five other rows already spell it.

    ⚠️ **THE EXCEPTION IS SUBTRACTED FROM THE NOUN AND NOT CONJOINED WITH IT, AND
    THE DIRECTION IS OBSERVABLE.** Team Rocket's Mimikyu HAS an Ability, so a
    reading that AND-ed the two clauses would bar it — the printed sentence lets
    it through, and the fixtures drive exactly that body.

    ⚠️ **`acts` IS BOTH MEMBERS AND THAT IS THE HALF BRONZONG DOES NOT SHARE.**
    Bronzong `sv05-069` stamps `"evolve"` alone (*"to evolve their Pokémon"*), so
    the two printings of this one mechanism are NOT the same rule with two
    sources — they are two sentences that happen to funnel through one reader. */
const POTENT_GLARE: CardProgram = {
  passive: {
    preventOpponentPokemonPlay: {
      acts: ["evolve", "bench"],
      only: { kind: "abilityPokemon" },
      except: { kind: "ownerPokemon", owner: "Team Rocket" },
    },
  },
};

/** §11 PREVENTION, THE ATTACK-BORNE EFFECTS-ONLY SPELLING — Skeledirge `sv08-031`
    "Unaware", **1 legal printing on ONE sentence** and backlog row 15-E's first
    half:

      "Prevent all effects of attacks used by your opponent's Pokémon done to this
       Pokémon. (Damage is not an effect.)"

    ⚠️ **THE WHOLE ROW IS A FUNNEL WIDENING AND NOTHING ELSE.** `effectRefused`
    (interpreter.ts) has been the sole reader of every effects-half aura since
    D142 and was widened again at D259; this sentence adds ONE disjunct inside it
    and takes a **ZERO diff at `attack.ts` and at all four §8.5 damage arms**,
    which is the printed parenthetical's doing rather than an economy — *"(Damage
    is not an effect.)"* is the sentence refusing the damage pipeline in print.

    ⚠️ **A HOLDER RULE, THEREFORE A `passivesOf` FOLD** (its signature takes an
    `InPlayPokemon` and no seat), and the opposite side of the fold/scan line from
    `REPELLING_VEIL` directly below — two sentences, six shared words in the
    middle, two shapes. D259's split, second consecutive slice.

    A SINGLETON: no reprint, so there is no shared-object claim to make. */
const UNAWARE: CardProgram = {
  passive: { preventAttackEffects: true },
};

/** §11 PREVENTION, THE TARGET-GROUP SPELLING — Team Rocket's Articuno `sv10-051`
    "Repelling Veil", **1 legal printing on ONE sentence** and backlog row 15-E's
    second half:

      "Prevent all effects of attacks used by your opponent's Pokémon done to your
       Basic Team Rocket's Pokémon. (Existing effects are not removed. Damage is
       not an effect.)"

    ⚠️ **ZERO NEW PREDICATES, AND THAT IS THE ROW'S HEADLINE.** The printed noun
    phrase is a STAGE word conjoined with an OWNER PREFIX, and `matchesFilter`'s
    `ownerPokemon` arm has spelled exactly that pair since D200 (the prefix, D245
    (the stage) — `{ kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" }`.
    So the program carries the filter as DATA and `continuous.ts
    groupShieldedFromAttackEffects` calls the arm that already exists. The third
    consecutive prevention row to write no new card predicate.

    ⚠️ **THE STAGE CONJUNCT IS OBSERVABLE AND NOT DECORATIVE**: the Standard pool
    holds **34 Basic** and **35 non-Basic** "Team Rocket's" Pokémon (remote D1,
    2026-08-07), so dropping `stage` would shield 35 printed bodies this sentence
    does not name. The suite drives both cells.

    ⚠️ **SELF-INCLUSIVE, AND THE CATALOG IS THE ARGUMENT**: `sv10-051` is itself a
    `stage = "Basic"` card named `Team Rocket's Articuno`, so it satisfies its own
    filter and no `scope` argument (D254's) is expressible here.

    A SINGLETON. */
const REPELLING_VEIL: CardProgram = {
  passive: {
    preventAttackEffectsForGroup: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
  },
};

/** §8.5 + §11 PREVENTION, THE SEAT-WIDE SPELLING — Rabsca `sv05-024` "Spherical
    Shield", ONE legal printing on ONE sentence and the LAST rung of the "and
    effects of attacks" ladder D252 censused:

      "Prevent all damage from and effects of attacks from your opponent's
       Pokémon done to your Benched Pokémon."

    Re-derived at this commit against the remote D1 `luminous`
    (735f0fb5-cdc3-494d-8b97-74a8ade0124a): the family is 9 printings on 4
    sentences and this row is the 1. **6 of 6 addressable printings are now built**
    (2 at D252, 3 at D253, 1 here); the 3-printing TERA group stays UNBUILDABLE for
    D252's measured reason.

    ⚠️ **`preventBenchDamageAndEffects`, NOT `preventDamageAndEffectsWhileBenched`,
    AND THE NAMES ARE ONE WORD APART FOR A REASON WORTH THE LINE.** D253's field is
    a HOLDER rule — the holder stands on the Bench and protects ITSELF — so
    `passivesOf` folds it and the read sites see a bare boolean. This one is a
    TARGET rule: the holder stands anywhere and protects a DIFFERENT body, so
    `passivesOf` cannot express it at all and it rides the `benchShieldedFromDamage`
    scan. Same six printed words in the middle, opposite sides of the fold/scan
    line, which is `preventBenchDamageWhileActive`'s split since D159.

    ⚠️ **AND IT IS NOT `preventBenchDamageWhileActive` EITHER**, which is the
    correction this slice landed: it shares that field's TARGET clause and prints
    NO source clause, so a BENCHED Rabsca shields the Bench it is standing on —
    including itself. See the field's own doc block, and `scope`.

    NO ATTACK PROGRAM: the printed "Psychic" is a per-Energy rider the deriver
    already reads, so authoring one here would take a sentence away from the seven
    text readers and quietly move `BUILT.attack`. The card is an ABILITY row and
    nothing else. */
const SPHERICAL_SHIELD: CardProgram = {
  passive: { preventBenchDamageAndEffects: true },
};

/** §8.5 PREVENTION OVER THE OWN BENCH, NARROWED ON THE PROTECTED BODY'S RULE BOX —
    Shaymin `sv10-010`/`-185` "Flower Curtain", **2 Standard-legal printings on ONE
    sentence** and backlog row 15-A:

      "Prevent all damage done to your Benched Pokémon that don't have a Rule Box
       by attacks from your opponent's Pokémon. (Pokémon ex, Pokémon V, etc. have
       Rule Boxes.)"

    Re-derived at this commit against the remote D1 `luminous`
    (735f0fb5-cdc3-494d-8b97-74a8ade0124a): the `%prevent all damage%` ability
    census is **22 printings on 9 sentences, unchanged**, and this row is the 2.

    ⚠️ **A *TARGET* RULE, WHICH IS WHAT PUTS IT ON THE SCAN AND NOT ON `passivesOf`.**
    D253's line: a gate naming the HOLDER folds into `passivesOf`; a gate naming the
    ATTACKER pays a predicate call per site; a rule about a body that is NEITHER
    cannot ride the fold at all. The protected body here is "your Benched Pokémon
    that don't have a Rule Box" and the holder is Shaymin, so this is D254's side of
    the line — `preventBenchDamageNoRuleBox` on `benchShieldedFromDamage`. **ZERO new
    read-site disjuncts**, because that scan has been the sole funnel at all four
    damage arms since D159.

    ⚠️ **THE PARENTHETICAL IS REMINDER TEXT AND ENCODES NO RULE.** "(Pokémon ex,
    Pokémon V, etc. have Rule Boxes.)" describes `cards.ts hasRuleBox` — which is
    WIDER than the pair it names (VMAX/VSTAR/GX and the "Radiant " prefix are rule
    boxes too, and the "etc." is the print admitting it). A build that read the
    parenthetical literally would be `isExOrV` and would shield a benched Radiant
    Greninja that this sentence does not protect. The predicate is the rule; the
    sentence in brackets is a gloss on it.

    NO ATTACK PROGRAM: the card is an ABILITY row and nothing else, so its printed
    attack stays with the seven text readers and `BUILT.attack` cannot move. */
const FLOWER_CURTAIN: CardProgram = {
  passive: { preventBenchDamageNoRuleBox: true },
};

/** §8.5 FULL DAMAGE PREVENTION ABOVE A PRINTED THRESHOLD — Drednaw `sv07-044`
    "Impervious Shell", **1 Standard-legal printing on ONE sentence** and backlog
    row 15-B:

      "Prevent all damage done to this Pokémon by attacks from your opponent's
       Pokémon if that damage is 200 or more."

    Re-derived at this commit against the remote D1 `luminous`
    (735f0fb5-cdc3-494d-8b97-74a8ade0124a): `LIKE '%if that damage is%'` over
    `json_each` and all three text columns, `legal_standard = 1`, GROUPED BY
    SENTENCE, returns **ability 1 / 1** (this card), **attack 3 / 2** (Shuckle
    `sv10.5w-046`/`-127` at 40 and Skarmory `sv09-002` at 60 — the `or less`
    polarity, BUILT at D240) and **effect 0 / 0**. Swept wider on D239's rule:
    `%damage is%` minus that phrase returns **18 further sentences and every one is
    a false positive** (*"this attack's damage isn't affected by…"*, *"(damage is
    not an effect.)"*, *"…base damage is 240"*), and a prevention-verb ∧
    comparator sweep returns those same four rows and nothing else. **There is no
    fifth threshold printing in the pool.**

    ⚠️ **A *HOLDER* RULE, WHICH IS WHAT PUTS IT ON `passivesOf` AND NOT ON A SCAN —
    THE EXACT MIRROR OF D256 ONE SLICE EARLIER.** D253's line: a gate naming the
    HOLDER folds; a gate naming the ATTACKER pays a predicate call per site; a rule
    about a body that is NEITHER cannot ride the fold at all. The protected body
    here is *"this Pokémon"* — the holder itself — so it folds, and the auditors
    say so rather than the author: `therapeuticEnergy.test.ts`'s fold-key list owes
    a NINETEENTH key and `attackerFilter.test.ts`'s `preventBenchDamage*` sweep owes
    NOTHING, which are precisely the two answers D256 got the other way round.

    ⚠️ **THE PRINTED "from your opponent's Pokémon" IS NOT MODELLED, AND THAT IS
    THIS FAMILY'S STANDING READING RATHER THAN AN OMISSION.** Every damage site that
    reads this field is reached only from an attack resolution, and an attack in
    this engine is declared by the opposing Active (§8) — so the clause is true
    wherever the gate is asked. D251's *"Cornerstone Stance"*, D255's two sentences
    and D256's all print the identical words and all spell it as a bare flag; a
    conjunct here would be a fourth spelling of a fact three fields already treat as
    vacuous (D131).

    NO ATTACK PROGRAM: the card prints "Hard Crunch" (`80+`, a damage rider the
    seven text readers already own), so `BUILT.attack` cannot move. */
const IMPERVIOUS_SHELL: CardProgram = {
  passive: { preventDamageAtOrAbove: 200 },
};

/** §8.5 COIN-FLIP DAMAGE PREVENTION, the ENERGY-GATED spelling (D258) —
    Fezandipiti `sv06-096` / `sv06.5-073` / `sv08.5-045` "Adrena-Pheromone",
    **3 Standard-legal printings on ONE sentence**:

      "If this Pokémon has any {D} Energy attached and is damaged by an attack,
       flip a coin. If heads, prevent that damage."

    Measured over `abilities_json` with `legal_standard = 1` against remote D1
    `luminous` on 2026-08-07, GROUPED BY SENTENCE: this row is 3 and its
    antecedent-dropped twin below is 2, and the `%prevent%` ∧ `%coin%` sweep over all
    three text columns returns those two rows plus the 21-printing DURATED §11 attack
    family (built since D142) and NOTHING else. Backlog row **15-C**.

    ⚠️ **THE {D} CONJUNCT IS RESOLVED IN THE FOLD, NOT AT THE READ SITES**, because it
    names the HOLDER — D253's line, which is also why this rides `passivesOf` at all.
    `passivesOf` holds the body and the state, so `hasAttachedEnergy(state, pokemon,
    "Darkness")` is answerable exactly where `damageAttacker`'s `requiresTool` is
    answered, and the four damage arms get a list with the conjunct already applied.

    ⚠️ **THE PRINTED "is damaged by an attack" IS THE GATE THE FUNNEL SPELLS AS
    `damage > 0`, AND IT IS NOT VACUOUS** — unlike the family's "from your opponent's
    Pokémon" clause, which every member treats as true-wherever-asked. A body whose
    damage is already prevented by a Stadium, by a sibling aura or by a reduction that
    floors it at 0 is NOT damaged, so no coin is drawn and no RNG step is burned. That
    is the difference between a flip and a boolean: an unnecessary read costs nothing,
    an unnecessary flip desynchronises every subsequent draw in the game.

    NO ATTACK PROGRAM: "Energy Feather" is `30×` per attached Energy, a self-scaling
    rider the seven text readers have owned since D57, so `BUILT.attack` cannot move. */
const ADRENA_PHEROMONE: CardProgram = {
  passive: {
    preventDamageOnCoinFlip: { ability: "Adrena-Pheromone", requiresEnergyType: "Darkness" },
  },
};

/** §8.5 COIN-FLIP DAMAGE PREVENTION, the UNGATED spelling (D258) — Kecleon
    `sv08-150`/`sv08-213` "Expert Hider", **2 Standard-legal printings on ONE
    sentence**:

      "If any damage is done to this Pokémon by attacks, flip a coin. If heads,
       prevent that damage."

    ⚠️ **THE SAME RULE WITH ITS ANTECEDENT DROPPED, WHICH IS WHY IT IS THE SAME FIELD
    WITH ONE KEY ABSENT AND NOT A SECOND FIELD** — D255's finding verbatim: two
    sentences differing by a KEY rather than by a RULE ride one field. A SEPARATE
    `CardProgram` object from `ADRENA_PHEROMONE` above (never a shared one), because
    the two carry different `ability` names and `legalNonAttackPrograms.test.ts`
    asserts reprints share an object while distinct printings do not.

    ⚠️ **THREE MORE PRINTINGS PRINT THIS EXACT SENTENCE AND ARE NOT AUTHORED**:
    Skiploom `sv02-002` and Jumpluff `sv02-003` ("Drifting Dodge") and Ambipom
    `swsh10.5-057` ("Primate Dexterity") are all `legal_standard = 0`, measured at
    D258 rather than inherited from `coverage-backlog.md`'s stale 2-printing count.
    They are ROTATED OUT, not unbuildable — the field would carry them unchanged the
    day the format moves, which is a different residue from the TERA group's.

    NO ATTACK PROGRAM: "Lick Whip" is a 30-damage `opponentAny` snipe with the
    printed W/R parenthetical, built since D57. */
const EXPERT_HIDER: CardProgram = {
  passive: { preventDamageOnCoinFlip: { ability: "Expert Hider" } },
};

/** §8.5 PREVENTION GATED ON THE ATTACKER'S PRINTED RULE-BOX CLASS, the UNGATED-BY-
    STAGE spelling — Sylveon `sv08.5-040` "Safeguard" and Crustle `sv10-012`/`-186`
    "Mysterious Rock Inn", **3 Standard-legal printings on ONE sentence**:

      "Prevent all damage done to this Pokémon by attacks from your opponent's
       Pokémon ex."

    Measured over `abilities_json` with `legal_standard = 1` against the remote D1
    `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a) on 2026-08-07, GROUPED BY
    SENTENCE — the LARGEST unbuilt row of the `%prevent all damage%` census, and the
    census's own transcript is in `preventedAttackerClass.test.ts`'s header.

    ⚠️ **TWO ABILITY NAMES, ONE PROGRAM, AND THE PROGRAM IS NAMED FOR NEITHER** —
    `RESOLUTE_HEART`'s idiom above. The three rows are byte-identical through the
    full stop; the engine reads the SENTENCE, and two names for one rule is a fact
    about the printing rather than about the rule.

    🛑 **AND "Safeguard" IS ALSO MIMIKYU'S ABILITY NAME, WHICH IS PRECISELY WHY THE
    OBJECT IS NOT CALLED THAT.** `SAFEGUARD` (sv02-097) is the ex-**and-V** gate;
    this is the ex-ONLY gate. Same printed name, one printed clause apart, and a
    program named after the name rather than the rule would have made the collision
    invisible. */
const PREVENT_FROM_EX: CardProgram = {
  passive: { preventDamageFromAttackerClass: { suffix: "ex" } },
};

/** The same gate with the printed STAGE conjunct — Farigiraf ex `sv05-108`/`-194`
    "Armor Tail", **2 Standard-legal printings on ONE sentence**:

      "Prevent all damage done to this Pokémon by attacks from your opponent's
       Basic Pokémon ex."

    `PREVENT_FROM_EX`'s neighbour one printed word over, and a SECOND VALUE of one
    field rather than a second field — which is the whole reason
    `preventDamageFromAttackerClass` is a record: the two differ by a conjunct the
    record has a key for, so nothing about the fold, the aggregation or the four read
    sites moves to serve it. **That is the measured cost of the parameterisation: the
    2-printing row is one object and one map entry pair.**

    ⚠️ **THE HOLDER IS ITSELF A POKÉMON ex, which makes the gate's DIRECTION
    assertable rather than merely typed** (`CORNERSTONE_STANCE`'s note verbatim, one
    axis over): nothing about the aura reads the holder, so a Farigiraf-vs-Farigiraf
    mirror prevents in BOTH directions. A build that read the DEFENDER's suffix would
    pass every board where the holder is the only rule-box card on the table. */
const PREVENT_FROM_BASIC_EX: CardProgram = {
  passive: { preventDamageFromAttackerClass: { suffix: "ex", stage: "basic" } },
};

/** §8.1 KO SURVIVAL — ONE printed sentence, TWO Ability names, SEVEN printings,
    all seven Standard-legal:

      "If this Pokémon has full HP and would be Knocked Out by damage from an
       attack, it is not Knocked Out, and its remaining HP becomes 10."

    Pikachu ex "Resolute Heart" (sv08-057, sv08-219, sv08-238, sv08-247,
    sv08.5-179) and Crustle "Sturdy" (sv10.5b-052, sv10.5b-130), measured against
    the remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows /
    20 sets, 2,021 legal) on 2026-08-04 with `json_each(abilities_json)` and an
    EQUALITY on the effect string — not `LIKE`, which is case-insensitive here,
    and not a grouped `attacks_json` scan, which is how D206 and D207 each
    attributed a sentence to the wrong row.

    ⚠️ TWO NAMES, ONE PROGRAM, AND THE PROGRAM IS NAMED FOR NEITHER. The rows are
    byte-identical through the full stop, so a single `CardProgram` is the honest
    shape and naming it after either Ability would make the other one's row read
    as a reprint of a card it has nothing to do with. `KO_SURVIVAL` names the
    MECHANISM, which is D141's judgement applied to a registry constant.

    ⚠️ THE SWEEP ALSO SURFACED TWO NEIGHBOURS THIS PROGRAM MUST REFUSE, and both
    are refusals rather than omissions:
      • Machamp sv03.5-068 "Guts" — the same consequent with NO "full HP"
        antecedent and a COIN FLIP in front of it ("…flip a coin. If heads, this
        Pokémon is not Knocked Out…"). Mark G, `legal_standard = 0`. A flag cannot
        carry a flip, and authoring it here would make a 50% effect unconditional.
      • Survival Brace sv06-164 — the TOOL twin, 1 Standard-legal, which adds
        "Then, discard this card." See `survivesKoAtFullHp`'s doc block: it needs
        a self-discard rider this field does not have. Flagged, not built. */
const KO_SURVIVAL: CardProgram = { passive: { survivesKoAtFullHp: true } };

/** Clefable ex (sv03-082) — "Lunar Zone": "All of your Pokémon that have {P}
    Energy attached have no Retreat Cost." — a continuous own-board aura, gated
    PER TARGET on the target carrying {P} (so Clefable ex frees itself only while
    it too holds a Psychic Energy). Stage-agnostic and with no "in the Active
    Spot" clause; the only "no Retreat Cost" print in the pool. */
const LUNAR_ZONE: CardProgram = {
  passive: { noRetreatCostAura: { requiresEnergyType: "Psychic" } },
};

/** Spidops ex (sv01-019/-223/-243) — "Trap Territory": "Your opponent's Active
    Pokémon's Retreat Cost is {C} more." — a continuous CROSS-BOARD aura and the
    last modifier on the retreat-cost seam. The target must be the opponent's
    Active; the source needs only to be in play (no "in the Active Spot" clause),
    and neither end is Basic-gated. Its own "Wire Hang" READS the very cost it
    raises (the `opponentActiveRetreatCost` count source, D110), so a Spidops ex
    in the Active Spot hits for +30 off its own Ability. */
const TRAP_TERRITORY: CardProgram = { passive: { opponentActiveRetreatSurcharge: { amount: 1 } } };

/** 🆕 D322 — Ariados (sv06-005) — "Big Net": "Your opponent's Active Evolution
    Pokémon's Retreat Cost is {C} more." — Trap Territory's sentence with ONE
    adjective added, and the first printing to narrow the cross-board surcharge.
    Like that one the SOURCE has no zone clause, so a benched Ariados imposes it;
    unlike it the TARGET must be an Evolution, so an opposing BASIC Active pays
    nothing at all. Ariados is itself a Stage 1, which is exactly why the rider is
    read off the target: on every board this print can reach, source and target
    both satisfy it, and only a Basic Active separates the two readings.

    The filter is `evolutionPokemon`, D245's member on the SAME printed noun
    phrase ("your opponent's Active Evolution Pokémon") one seam over — reused
    whole, so this printing adds no filter vocabulary at all. */
const BIG_NET: CardProgram = {
  passive: {
    opponentActiveRetreatSurcharge: { amount: 1, target: { kind: "evolutionPokemon" } },
  },
};

/** 🆕 D322 — Toedscruel (sv09-089) — "Secret Forest Path": "As long as this
    Pokémon is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less."
    — the ELEVENTH print on the retreat-cost seam and the OWN-SIDE, sign-flipped
    mirror of Trap Territory. Two clauses, both narrowings the seam already has a
    vocabulary for: the SOURCE-zone gate D321 built one field over
    (`seatDamageReductionAfterWR.sourceOnBench`), and a delta on the seat's Active
    that is summed with the Stadium terms and floored ONCE — never a set-to-zero,
    which is what keeps a lone Toedscruel from freeing a {C}{C}{C} Active. Sources
    are SUMMED like the surcharge's, so two benched Toedscruel are {C}{C}{C}{C}
    less; no reprint. */
const SECRET_FOREST_PATH: CardProgram = {
  passive: { ownActiveRetreatDiscount: { amount: 2, sourceOnBench: true } },
};

/** Snorlax (swsh10.5-055) — "Block": "As long as this Pokémon is in the Active
    Spot, your opponent's Active Pokémon can't retreat." — the L3 shape of the
    retreat-LOCK seam, and the only continuous-Ability retreat lock in the pool
    (no reprint). The seam's two attack-rider shapes were built by D112 as the
    turn-scoped `InPlayPokemon.retreatBlocked` flag plus a bare `preventRetreat`
    op; this shares nothing with them but the effect, because it is a CONTINUOUS
    aura with no turn duration — it rides neither the flag nor an op, but a
    passive read live at the retreat gate, and it lapses the instant either end
    leaves the Active Spot. Unlike Trap Territory beside it, BOTH ends are
    Active-scoped: the opening clause scopes the source, the sentence's object
    scopes the target. */
const BLOCK: CardProgram = { passive: { preventOpponentActiveRetreat: true } };

/** Wimpod (swsh10.5-025) — "Punk Out": "If your opponent has any Pokémon V in
    play, this Pokémon has no Retreat Cost." — the TENTH and last print on the
    retreat-cost seam, and the only SELF-only set-to-zero on it. Unlike Lunar Zone
    (own-board aura) and Trap Territory (cross-board aura) it frees nobody but its
    own holder, yet its condition is read across the table — "in play" being
    Active + Bench, since the sentence carries no Active clause at either end. One
    printing, no reprint. */
const PUNK_OUT: CardProgram = {
  passive: { noRetreatCostSelf: { requiresOpponentSuffixInPlay: "V" } },
};

/** 🆕 D322 — Ethan's Magcargo (sv10-036) — "Melt Away": "If this Pokémon has no
    Energy attached, it has no Retreat Cost." — the SECOND self-only set-to-zero
    and Punk Out's antecedent-twin: same consequent, same scan, a gate that reads
    the HOLDER instead of the opposing board. The condition is LIVE and not
    turn-scoped, so attaching an Energy takes the freedom away in the same breath
    and discarding one gives it back — which is the sharpest control this rider
    has, because a board that never moves an Energy cannot tell it from an
    unconditional print. One printing, no reprint. */
const MELT_AWAY: CardProgram = {
  passive: { noRetreatCostSelf: { requiresNoEnergyAttached: true } },
};

/** Entei (sv03-030) — "Pressure": "As long as this Pokémon is in the Active Spot,
    attacks used by your opponent's Active Pokémon do 20 less damage (before
    applying Weakness and Resistance)." — the ALWAYS-ON member of D149's
    attacker-side pre-W/R debuff family, and the only printing of that mechanism
    in the pool that is not an attack rider (1 printing, no reprint).
    AUTHORED HERE RATHER THAN DERIVED, and the reason is the family's own rule:
    `deriveAttackEffect` reads ATTACK text into a one-shot op program, and this
    sentence is a printed ABILITY with no duration — deriving it would install a
    one-turn stamp for a permanent aura AND write it onto the wrong body (the aura
    is re-read off the source's opponent every turn, where a stamp is written once
    onto one record). attackDebuff.test.ts pinned exactly that refusal at D149;
    this row is the other half of it. The sentence therefore stays LOUD as attack
    text and the datum arrives through the registry, like every other continuous
    Ability on the aura-scan seam (Blooming Garden, Lunar Zone, Trap Territory,
    Block, Punk Out). */
const PRESSURE: CardProgram = { passive: { opponentActiveAttackDebuff: 20 } };

/** Walking Wake ex — "Azure Seas": "Damage from attacks used by this Pokémon
    isn't affected by any effects on your opponent's Active Pokémon." (D192)

    THE ABILITY HALF of the main-hit suppression family, and its whole population:
    6 printings, all 6 Standard-legal, all one card, ONE sentence. Authored here
    rather than derived for `PRESSURE`'s reason one block up — it is printed ABILITY
    text with no duration, and `deriveAttackEffect` reads ATTACK text into a
    one-shot op program. The attack half of the same rule IS derived
    (`deriveAttackDamageSuppression`), which is exactly the split this seam has
    carried since D149: same rule, two printed homes, two acquisition paths, ONE
    read site.

    The 6 real ids get rows and no fixture: `catalogManifest.ts` is generated off
    the LOCAL sqlite (absent in this container — the generator dies
    `SQLITE_CANTOPEN`) and measures a 978-row / 6-set catalog holding none of
    sv05 / sv08.5 / svp, so a real-card fixture could not be diffed against its
    printing. D190's Tier-1 idiom exactly: real ids in the map, a synthetic `fix-*`
    demonstrator carrying the byte-identical sentence to drive it. */
const AZURE_SEAS: CardProgram = { passive: { suppressTargetEffectsOnAttack: true } };

/** FIXTURE ONLY (D192) — the −30 post-W/R reduction on the synthetic defenders
    `fix-suppresswall` / `fix-resistwall`, so the ORDER witness has a body that
    carries BOTH a Weakness (or a Resistance) and a reduction. Copperajah ex's
    "Bronze Body" number on a synthetic body: no real card in the pool prints a
    Weakness AND a reduction Ability, and adding one to a real-card fixture would
    field a printing the catalog does not have (D151's rule). Its OWN const rather
    than the shared `COPPERAJAH_EX`, so a later edit to Bronze Body cannot silently
    move this suite's arithmetic. */
const FIX_SUPPRESS_WALL: CardProgram = { passive: { damageReductionAfterWR: 30 } };

/** Dachsbun (sv01-099) — "Well-Baked Body": "This Pokémon can't be Burned.
    Prevent all damage done to this Pokémon by attacks from your opponent's {R}
    Pokémon." — SAFEGUARD's twin with the gate moved from the printed NAME to the
    `Card.types` datum.

    ⚠️ TWO PRINTED SENTENCES, TWO FIELDS, TWO PIPELINES — and D172 CLOSED the card
    by building the first one. D159 authored only the prevention and declared "can't
    be Burned" a LOUD omission because no field on `PassiveEffects` could carry it;
    `statusImmunity` is now that field, and the two clauses share nothing but this
    object. The prevention is read at the four §8.5 damage sites through
    `preventsAttackerType`; the immunity is read ONCE, at interpreter.ts
    `applyStatus`, and never touches damage at all. **A card is not a family**: the
    printed adjacency of these two sentences is the only thing they have in common,
    which is why the census that found the second one had to be run separately from
    the census that found the first.

    The type token is `{R}`, which the printed sentence spells as a brace code and
    `Card.types` spells as "Fire". Nothing parses it: an ABILITY string never
    reaches `deriveAttackEffect`, so the decode happens exactly once, HERE, by an
    author who queried the row. The STATUS token is the same call on the other
    clause: the printed word is "Burned" and `StatusName` spells it "burned". */
const WELL_BAKED_BODY: CardProgram = {
  passive: { statusImmunities: ["burned"], preventDamageFromType: "Fire" },
};

/** Pachirisu (sv01-068/-208) — "Electricity Pouches": "This Pokémon can't be
    Paralyzed." (D172) — the §12 status-immunity family's SECOND sentence and its
    ONLY whole-Ability printing: where Dachsbun's immunity is one clause of a
    two-clause Ability, this card's printed Ability IS the immunity, so the row
    authors the WHOLE card and nothing about it is a declared omission.

    TWO PRINTINGS (Uncommon `sv01-068` / Illustration rare `sv01-208`), ONE program
    object shared by id — Bellibolt's arrangement six rows up, and D121's
    second-printing warrant met by the card itself rather than by a synthetic body.

    ⚠️ ITS PRINTED ATTACK CARRIES TWO UNMAPPED CLAUSES AND THAT IS DELIBERATE:
    "Everyone Discharge" ({L}{C}, "10+") prints *"This attack does 20 more damage
    for each of your Benched {L} Pokémon. This attack's damage isn't affected by
    Weakness."* — a typed bench COUNT the per-type fold has no reader for, plus
    Feint Attack's `ignoreWR` clause with the RESISTANCE half missing. Neither is
    this slice's sentence; both are carried verbatim on the fixture so a sweep can
    SEE them (D135's rule), and no `attack` entry is authored, so index 0 falls
    through to the deriver and stays unsimulated. */
const ELECTRICITY_POUCHES: CardProgram = { passive: { statusImmunities: ["paralyzed"] } };

/** Bellibolt (sv03-078/-201) — "Insulator": "Prevent all damage done to this
    Pokémon by attacks from your opponent's {L} Pokémon." — Dachsbun's sentence
    minus the status clause, which is what makes the two of them a FAMILY rather
    than two cards: strip Well-Baked Body's first sentence and the remainder is
    this one with a different token. Two printings (Uncommon / Illustration rare),
    one program, D121's second-printing warrant met by the card itself. */
const INSULATOR: CardProgram = { passive: { preventDamageFromType: "Lightning" } };

/** Thundurus (sv03-070) — "Adverse Weather": "As long as this Pokémon is in the
    Active Spot, prevent all damage done to your Benched Pokémon by attacks from
    your opponent's Pokémon." — the pool's only ZONE-scoped prevention, and the
    aura-scan family's first SAME-SEAT cross-body member (the Active protects the
    Bench). It filters no attacker at all: "your opponent's Pokémon" is every
    attacker there is, so unlike the two rows above it the narrowing is entirely on
    the PROTECTED side. Read through continuous.ts `benchShieldedFromDamage`. */
const ADVERSE_WEATHER: CardProgram = { passive: { preventBenchDamageWhileActive: true } };

/** Seismitoad (sv03-052) — "Quaking Zone": "As long as this Pokémon is in the
    Active Spot, attacks used by your opponent's Active Pokémon cost {C} more." —
    PRESSURE's sentence with the predicate moved from the damage step to the COST
    step, and therefore its scan with one field changed.

    ⚠️ THE CARD ALREADY HAD A ROW'S WORTH OF ENGINE IN IT AND NO ROW. Its attack
    ("Echoed Voice", idx 0) is D155's per-attack damage BUFF, derived from the
    printed text by `deriveAttackEffect` and needing no registry entry; the fixture
    has carried this Ability verbatim since then with `effectiveAttackCost has no
    shape for a cross-board cost aura` stated out loud beside it. This row is that
    admission discharged, and it is passive-ONLY: the derived attack is untouched,
    because the attack seam reads `programFor(id)?.attack?.[index]` and this program
    authors no `attack` map. */
const QUAKING_ZONE: CardProgram = { passive: { opponentActiveAttackCostSurcharge: 1 } };

/** Radiant Charizard (swsh10.5-011) — "Excited Heart": "This Pokémon's attacks
    cost Colorless less for each Prize card your opponent has taken." — the FIRST
    cost DISCOUNT anywhere on the attack seam, and QUAKING_ZONE's opposite sign.

    ⚠️ THIS ID'S INERTNESS WAS PINNED, NOT ASSUMED, AND THE PIN IS WHY THE ROW IS
    CHEAP. `perAttackLock.test.ts` has asserted `programFor("swsh10.5-011")`
    UNDEFINED since D162 precisely so that authoring it would be a RED test rather
    than a silent behaviour change on every board this card is on — and it went red
    on this slice, exactly as designed. It is re-pointed at the passive field this
    row defines, so the id still cannot gain a program without a test saying which.

    THE RATE IS 1 AND THE COUNT IS THE OPPONENT'S TAKEN PRIZES, both printed. The
    holder's OTHER printed clause is D154's per-attack lock ("During your next turn,
    this Pokémon can't use Combustion Blast."), which is ATTACK text derived by
    `deriveAttackEffect` — so like QUAKING_ZONE this program is passive-only and the
    two halves of the card do not meet in the registry at all. */
const EXCITED_HEART: CardProgram = { passive: { attackCostDiscountPerOpponentPrize: 1 } };

// ── M4 slice 3: the persistent-zone Trainers (Stadium §7.3, Tool §7.4). ──

/** Beach Court — "The Retreat Cost of each Basic Pokémon in play (both yours
    and your opponent's) is {C} less." (Stadium) */
const BEACH_COURT: CardProgram = { stadium: { basicRetreatDiscount: 1 } };

/** Pokémon League Headquarters — "Attacks used by each Basic Pokémon in play
    (both yours and your opponent's) cost {C} more." (Stadium) */
const POKEMON_LEAGUE_HQ: CardProgram = { stadium: { basicAttackCostSurcharge: 1 } };

/** Calamitous Wasteland — "The Retreat Cost of each Basic non-{F} Pokémon in
    play (both yours and your opponent's) is {C} more." (Stadium) — Beach Court's
    negative twin, plus the type exemption that keeps {F} Pokémon at their
    printed cost. Note League HQ above shares the sentence skeleton but bites on
    the ATTACK-cost seam, not this one. */
const CALAMITOUS_WASTELAND: CardProgram = {
  stadium: { basicRetreatSurcharge: { amount: 1, excludesType: "Fighting" } },
};

/** Neutralization Zone (sv06.5-060) — "Prevent all damage done to Pokémon that
    don't have a Rule Box (both yours and your opponent's) by attacks from the
    opponent's Pokémon ex and Pokémon V. (Pokémon ex, Pokémon V, etc. have Rule
    Boxes.)" (Stadium, ACE SPEC) — the first Stadium in the pool to reach the §8.5
    DAMAGE pipeline; every other one bites a cost seam.

    Beach Court's both-boards shape with the filters moved onto the two ENDS of an
    attack: `hasRuleBox` negated on the body being hit, `isExOrV` on the body
    hitting it. Both are `cards.ts` predicates already in service (Artazon's search
    filter and Mimikyu's Safeguard), so this row introduces no new reading of what
    a Rule Box is.

    ⚠️ ITS SECOND SENTENCE STAYS LOUD, exactly as Dachsbun's first does. "This card
    can't be put into your hand or deck from the discard pile." restricts DISCARD-
    PILE RETRIEVAL — one sibling in the pool (Poké Vital A sv06.5-062) and no
    reader anywhere: no search filter, no op and no zone rule consults a card's own
    retrievability, so authoring it would be inventing a mechanism rather than
    reading one. */
const NEUTRALIZATION_ZONE: CardProgram = {
  stadium: { preventDamageToNoRuleBoxFromExV: true },
};

/** Lively Stadium `sv08-180` — "Each Basic Pokémon in play (both yours and your
    opponent's) gets +30 HP." (Stadium) — Beach Court's both-boards, Basic-only
    skeleton on the §8.1 MAX-HP seam rather than a cost one, and the first Stadium
    in the pool to reach that seam at all.

    ⚠️ IT RAISES THE BAR A KO MUST CLEAR *AND* THE HP A BODY IS LEFT HOLDING, which
    is Bravery Charm's documented behaviour with the ownership inverted: this one
    is on the shared zone, so it does it for the OPPONENT's Basics too, and playing
    it can hand the other player a survival. `effectiveMaxHp` is the single read
    site, so the KO check, the HUD and the evolve-below-HP window all see it
    without a line of their own. */
const LIVELY_STADIUM: CardProgram = { stadium: { hpDelta: { amount: 30, stage: "basic" } } };

/** Gravity Mountain `sv08-177`/`sv08-250` — "Each Stage 2 Pokémon in play (both
    yours and your opponent's) gets -30 HP." (Stadium) — Lively Stadium's twin
    directly above, differing in the SIGN and in the STAGE and in nothing else, so
    the two are each other's control on every board either reaches.

    🛑 **THE ONLY NEGATIVE MAX-HP TERM IN THE ENGINE, AND IT IS WHY
    `effectiveMaxHp` NOW FLOORS.** Its doc-block carries the argument; the number
    to keep here is that the floor is UNREACHABLE — 169 Standard-legal Stage 2
    Pokémon, minimum printed HP 120, so this bottoms out at 90.

    ⚠️ 🛑 **AND IT DOES *NOT* KILL ON THE PLAY, WHICH IS A GREP AND NOT AN
    INTUITION.** A Stage 2 already damaged past its reduced maximum is the obvious
    board, and the obvious reading — "the §8.1 sweep an evolution under a Bravery
    Charm triggers, arriving from the shared zone" — is FALSE here.
    `resolveMidTurnKnockOuts` has exactly THREE call sites (turn.ts: the
    energy-attach watch, the evolve-below-HP check, the on-evolve watch) and
    `playStadium` is none of them. So the body stays standing until the next
    Checkup collects it or the next damage lands, and the difference between this
    row and Bravery Charm's is a call site rather than a rule. Driven both ways in
    `hpAura.test.ts` §7 rather than left to this comment. */
const GRAVITY_MOUNTAIN: CardProgram = { stadium: { hpDelta: { amount: -30, stage: "stage2" } } };

/** Artazon — "Once during each player's turn, that player may search their deck
    for a Basic Pokémon that doesn't have a Rule Box and put it onto their Bench.
    Then, that player shuffles their deck." (Stadium activated ability) — the Nest
    Ball search-to-Bench + trailing shuffle, narrowed to no-Rule-Box Basics
    (`noRuleBox`). */
const ARTAZON: CardProgram = {
  stadium: {
    ability: {
      label: "Artazon",
      program: [
        {
          op: "searchDeck",
          filter: { kind: "basicPokemon", noRuleBox: true },
          dest: "bench",
          max: 1,
        },
        { op: "shuffleDeck" },
      ],
    },
  },
};

/** Mesagoza — "Once during each player's turn, that player may flip a coin. If
    heads, that player searches their deck for a Pokémon, reveals it, and puts it
    into their hand. Then, that player shuffles their deck." (Stadium activated
    ability) — the Poké Ball program exactly: the search AND the shuffle are BOTH
    gated on heads, so shuffleDeck sits INSIDE the coin gate's `then`. */
const MESAGOZA: CardProgram = {
  stadium: {
    ability: {
      label: "Mesagoza",
      program: [
        {
          op: "coinFlipGate",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [
            {
              op: "searchDeck",
              filter: { kind: "anyPokemon" },
              dest: "hand",
              max: 1,
              reveal: true,
            },
            { op: "shuffleDeck" },
          ],
        },
      ],
    },
  },
};

/** Town Store — "Once during each player's turn, that player may search their
    deck for a Pokémon Tool card, reveal it, and put it into their hand. Then,
    that player shuffles their deck." (Stadium activated ability) — a `toolCard`
    search-to-hand + the trailing shuffle. */
const TOWN_STORE: CardProgram = {
  stadium: {
    ability: {
      label: "Town Store",
      program: [
        { op: "searchDeck", filter: { kind: "toolCard" }, dest: "hand", max: 1, reveal: true },
        { op: "shuffleDeck" },
      ],
    },
  },
};

/** Vitality Band — "The attacks of the Pokémon this card is attached to do 10
    more damage to your opponent's Active Pokémon (before applying Weakness
    and Resistance)." (Tool) */
const VITALITY_BAND: CardProgram = { passive: { damageBonusBeforeWR: 10 } };

/** FIXTURE (D155) — `fix-booster-ability`'s printed "Resonance": the same flat
    pre-W/R bonus as Vitality Band above, but as the HOLDER'S OWN PRINTED PASSIVE
    rather than as a Tool. That distinction is the whole reason the row exists:
    `passivesOf` suppresses a locked Pokémon's own printed passive and leaves its
    Tools contributing, so Vitality Band cannot be switched off by a §9
    Ability-lock aura and this can. It is what makes D155's argument for keeping
    an attack-INSTALLED buff out of `attackerPreWRBonus` a board rather than a
    paragraph — the local five sets print `damageBonusBeforeWR` on exactly one
    card and that card is a Tool (`fix-onko`'s precedent for a fixture program:
    a rule this engine implements that no printing exercises). */
const FIX_BOOSTER_ABILITY: CardProgram = { passive: { damageBonusBeforeWR: 30 } };

/** Defiance Band — "If you have more Prize cards remaining than your opponent,
    the attacks of the Pokémon this card is attached to do 30 more damage to
    your opponent's Active Pokémon (before applying Weakness and Resistance)."
    (Tool) The conditional twin of Vitality Band, gated on the existing
    `morePrizesThanOpponent` board condition — the D40 vocabulary's third
    consumer, and the first PASSIVE reader of it. */
const DEFIANCE_BAND: CardProgram = {
  passive: { damageBonusBeforeWRIf: { amount: 30, cond: { kind: "morePrizesThanOpponent" } } },
};

/** Choice Belt — "The attacks of the Pokémon this card is attached to do 30
    more damage to your opponent's Active Pokémon V (before applying Weakness
    and Resistance)." (Tool) The target-gated twin of Vitality Band: the bonus
    is unconditional on the holder's own board but applies ONLY when the
    DEFENDER is a Pokémon V — a defender-suffix gate (`pokemonSuffixOf`), not a
    `BoardCondition`, so a sibling passive field rather than the D40 vocabulary.
    "V" is read literally: a VMAX/VSTAR defender is untouched. */
const CHOICE_BELT: CardProgram = {
  passive: { damageBonusBeforeWRIfTarget: { amount: 30, targetSuffix: "V" } },
};

/** Bravery Charm — "The Basic Pokémon this card is attached to gets +50 HP."
    (Tool) */
const BRAVERY_CHARM: CardProgram = { passive: { basicHpBonus: 50 } };

/** Hero's Cape `sv05-152` — "The Pokémon this card is attached to gets +100 HP."
    (Tool) — Bravery Charm one line up WITH THE STAGE CLAUSE DELETED, and the
    deletion is the whole row: this is the printing `passivesOf`'s D174 source
    audit named in advance as the one that "must use a stage-free field, not this
    one". It keeps its +100 through an evolution that strips Bravery Charm's +50,
    with both Tools still attached — one board, two Tools, opposite answers. */
const HEROS_CAPE: CardProgram = { passive: { hpBonus: { amount: 100 } } };

/** Cynthia's Power Weight `sv10-162` — "The Cynthia's Pokémon this card is
    attached to gets +70 HP." (Tool) — Hero's Cape with an OWNER clause instead of
    a stage clause, which is why it shares that field and gates on `beneficiary`
    rather than earning a third one.

    ⚠️ THE FILTER IS `ownerPokemon` — D200's owner-prefix member, the SAME one
    Steven's Carbink's `beneficiary` and Team Rocket's group clauses use — and NOT
    a new prefix reading. `owner: "Cynthia"` (no apostrophe-s; the member owns the
    possessive) so this cannot disagree with the Cynthia's aura rows about what a
    Cynthia's Pokémon is.

    ⚠️ AND IT IS LIVE-READ OFF THE HOLDER'S TOP CARD, so the +70 tracks evolution
    the way Bravery Charm's stage gate does on the other axis: a Cynthia's Pokémon
    that evolves into a body without the owner prefix loses the bonus with the Tool
    still attached, and one that evolves INTO the prefix gains it. */
const CYNTHIAS_POWER_WEIGHT: CardProgram = {
  passive: { hpBonus: { amount: 70, beneficiary: { kind: "ownerPokemon", owner: "Cynthia" } } },
};

/** Okidogi "Adrena-Power" `sv06-111` / `sv06.5-074` / `sv08.5-057` — "If this
    Pokémon has any {D} Energy attached, it gets +100 HP, and the attacks it uses
    do 100 more damage to your opponent's Active Pokémon (before applying Weakness
    and Resistance)." (Ability, THREE legal printings)

    🛑 **TWO CLAUSES ON ONE CONDITION, AND THE SECOND HALF NEEDED NO NEW CODE AT
    ALL.** The damage half is `damageBonusBeforeWRIf` — Defiance Band's field,
    verbatim, down to the parenthetical — and its condition is
    `BoardCondition.yourActiveHasEnergyAttached`, which effects.ts has carried
    since D118 and `energyClause.test.ts` already asserts this card's exact
    sentence against. So the row's real cost was the HP half and one optional key,
    and the price fell by half the moment `damageBonusBeforeWRIf` was grepped
    rather than assumed new.

    ⚠️ **THE DAMAGE CONDITION IS SEAT-RELATIVE AND THAT IS ONLY SOUND BECAUSE THE
    HOLDER IS THE ATTACKER.** `yourActiveHasEnergyAttached` asks about the
    ATTACKING SEAT's Active, not about the card carrying the passive; the printed
    clause asks about *"this Pokémon"*. The two agree because
    `damageBonusBeforeWRIf` is aggregated out of `passivesOf(attacker)` and an
    attacker IS its seat's Active — a Benched Okidogi contributes nothing because
    it never attacks. It would be the WRONG condition on a Tool that granted the
    bonus to a teammate, and there is no such printing.

    ⚠️ **THE TWO HALVES DISAGREE ON WHAT COUNTS AS "ANY", AND BOTH ARE RIGHT.**
    The HP half gates on `hasAttachedEnergy` through `requiresEnergyType`; the
    damage half re-asks the same question at the attack step through
    `conditionHolds`. One printed condition, two evaluation sites, because max HP
    is continuous and a damage bonus is per-attack — and an Okidogi that loses its
    last {D} between declaring and resolving is the board where that matters. */
const OKIDOGI_ADRENA_POWER: CardProgram = {
  passive: {
    hpBonus: { amount: 100, requiresEnergyType: "Darkness" },
    damageBonusBeforeWRIf: {
      amount: 100,
      cond: { kind: "yourActiveHasEnergyAttached", energy: "Darkness" },
    },
  },
};

/** Conkeldurr "Craftsmanship" `sv10.5b-049` / `sv10.5b-127` — "This Pokémon gets
    +40 HP for each {F} Energy attached to it." (Ability, TWO legal printings)

    The first PER-ENERGY max-HP grant, and the sharp contrast with Okidogi one
    program up: *"any"* pays once and *"for each"* pays per card, so a Conkeldurr
    under four {F} is at +160 where an Okidogi under four {D} is still at +100.
    They are two printings of the same board fact with two different multipliers
    and they must not share a field.

    ⚠️ **AND IT IS THE ROW THAT MAKES THE GRANT SHRINKABLE IN STEPS.** Okidogi's
    +100 is all-or-nothing on the last {D}; this one falls 40 at a time, so a
    damaged Conkeldurr can be walked into §8.1's max-HP window by an opponent
    discarding its Energy one card at a time. */
const CONKELDURR_CRAFTSMANSHIP: CardProgram = {
  passive: {
    hpBonusPer: { amount: 40, scale: { kind: "attachedEnergy", energyType: "Fighting" } },
  },
};

/** Brambleghast "Resilient Soul" `sv05-021` — "This Pokémon gets +50 HP for each
    Prize card your opponent has taken." (Ability, ONE legal printing)

    🛑 **THIS PAGE CALLED THIS ROW BUILT FOR THREE HANDOFFS AND IT HAD NEVER BEEN
    BUILT.** D323's resume point listed it among *"Prize-COUNT reads … built at
    D208"*; `git grep sv05-021 -- packages/` at D325's HEAD returned exactly ONE
    hit and it was D324's own enumeration COMMENT. It is keyed here, and the
    lesson it cost is that a count of grep hits is not a count of keys.

    ⚠️ **MONOTONE, AND THAT IS THE FIELD'S ONLY NON-SHRINKING WRITER.** Taken
    Prizes never go back down, so this grant only ever grows — a Brambleghast
    cannot be Knocked Out by its own Ability the way a Conkeldurr can, and it is
    at +0 on the turn it is played and at +250 with five Prizes gone. The scale
    reads the HOLDER's opponent, resolved from the holder's seat, so the same
    printed sentence pays each side off the other's pile. */
const BRAMBLEGHAST_RESILIENT_SOUL: CardProgram = {
  passive: { hpBonusPer: { amount: 50, scale: { kind: "opponentPrizesTaken" } } },
};

/** Rocky Helmet — "If the Pokémon this card is attached to is in the Active Spot
    and is damaged by an attack from your opponent's Pokémon (even if it is
    Knocked Out), put 2 damage counters on the Attacking Pokémon." (Tool) The
    Tool twin of Counterattack Quills — it rides D98's `damageAttacker` machinery
    verbatim: `passivesOf` already folds an attached Tool's `damageAttacker` into
    its seat-free sum, and attack.ts places the counters on the main-hit Active
    defender's attacker, so this is a pure data row (no new op). 2 counters = 20
    HP; unconditional once attached (the Tool IS the source, so no `requiresTool`,
    unlike Custom Trap). */
const ROCKY_HELMET: CardProgram = { passive: { damageAttacker: { amount: 20 } } };

/** Vengeful Punch — "If the Pokémon this card is attached to is Knocked Out by
    damage from an attack from your opponent's Pokémon, put 4 damage counters on
    the Attacking Pokémon." (Tool) Verbatim off the local D1 row (`sv03-197`,
    `trainer_type = Tool`, reg-mark G, `legal_standard = 0`), re-queried
    2026-08-03 against a catalog of 890 rows / 5 sets.

    The §9 recoil family's SECOND Tool and the last of its always-on printings.
    Rocky Helmet's twin one step later in the sequence: same mechanism, same
    `COUNTERS_PLACED source: "counterattack"` row, same "the Tool IS the source"
    (no `requiresTool`) — and a DIFFERENT condition, which is the whole slice. It
    pays on the KO rather than on the damage, so it reads at flow.ts's §8.1 sweep
    rather than attack.ts's `dealt > 0` block, through the sibling field
    `damageAttackerOnKo` (see its doc block for why the two cannot share one).

    4 printed counters = 40 HP, converted HERE at the authoring site exactly as
    Rocky Helmet's 2 and Counterattack Quills' 3 are — this family's registry rows
    have stored HP since 0.x, and D152's deriver-side conversion exists only
    because a REGEX capture has no other place to do it. */
const VENGEFUL_PUNCH: CardProgram = { passive: { damageAttackerOnKo: { amount: 40 } } };

/** Exp. Share — "When your Active Pokémon is Knocked Out by damage from an attack
    from your opponent's Pokémon, you may move a Basic Energy from that Pokémon to
    the Pokémon this card is attached to." (Tool) Verbatim off the local D1 row
    (`sv01-174`, `trainer_type = Tool`, `abilities_json` and `attacks_json` both
    EMPTY — the sentence is in `effect`), re-queried 2026-08-03 against the
    restored catalog of 978 rows / 6 sets. D171, and the LAST unread member of
    D158's KO-antecedent census.

    ⚠️ THE FIRST TOOL IN THIS REGISTRY WHOSE WHOLE PRINTED SENTENCE IS A
    `triggered` PROGRAM RATHER THAN A `passive` NUMBER, and that is the entire
    reason it costs more than Vengeful Punch two blocks up. Both read the SAME
    printed antecedent at the SAME instant; the difference is where the answer has
    to be written:

      • Vengeful Punch's consequent is a NUMBER put on a body that survives, so
        `passivesOf` — the one existing site that walks `pokemon.tools` — folds it
        and flow.ts `koRecoilOf` reads it synchronously. No decision, no park.
      • This consequent MOVES A CARD off the dying body, and the player CHOOSES
        which. So it needs the interpreter, a park, and a controller — and its
        holder is a body the sweep has no reason to look at.

    `optional: true` is the printed "you MAY", and it costs nothing: optional
    triggers auto-fire (see the field's own doc) and the underlying `moveEnergy`
    park is DECLINABLE (an empty pick is a legal answer, cardplay.ts
    validateChoice), so "may" is expressed by the answer rather than by a
    confirm arm. `route: "koedActiveToToolHolder"` pins BOTH endpoints the printed
    sentence names — "from that Pokémon" (the dying Active) and "to the Pokémon
    this card is attached to" (this Tool's holder) — leaving exactly ONE decision,
    WHICH Basic Energy, which is what the existing compound prompt already asks. */
const EXP_SHARE: CardProgram = {
  triggered: [
    {
      name: "Exp. Share",
      trigger: "onAllyActiveKnockOut",
      optional: true,
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "basicEnergy" },
          max: 1,
          route: "koedActiveToToolHolder",
        },
      ],
    },
  ],
};

// ── M4 slice 5: Special Energy (§6.1). ──

/** Jet Energy — "provides {C} Energy. When you attach this card from your hand
    to 1 of your Benched Pokémon, switch that Pokémon with your Active Pokémon." */
const JET_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], onAttach: { kind: "switchIfBenched" } },
};

/** Luminous Energy — "provides every type of Energy but provides only 1 Energy
    at a time. If the Pokémon this card is attached to has any other Special
    Energy attached, this card provides {C} Energy instead." */
const LUMINOUS_ENERGY: CardProgram = {
  energy: { provides: [ANY_ENERGY], demoteWithOtherSpecial: ["Colorless"] },
};

/** Therapeutic Energy (sv02-193, D174) — "As long as this card is attached to a
    Pokémon, it provides {C} Energy. / The Pokémon this card is attached to recovers
    from being Asleep, Confused, or Paralyzed and can't be affected by those Special
    Conditions."

    ⚠️ THE §12 FAMILY'S THIRD SENTENCE AND ITS ONLY ENERGY, and the first Special
    Energy in this registry with a CONTINUOUS clause: Jet's sentence is read at
    ATTACH, Luminous's at COST, and this one is read for as long as the card sits
    there. It is therefore the first writer of `EnergyProgram.passive`, the first
    non-Pokémon non-Tool contributor `passivesOf` has ever had, and the writer whose
    existence widened `PassiveEffects.statusImmunity` into a list (see there).

    ⚠️ TWO PRINTED CLAUSES, TWO FIELDS, AND THE SAME THREE TOKENS WRITTEN TWICE.
    "…recovers from being A, C, or P" is `statusRecovery`; "…and can't be affected by
    THOSE Special Conditions" is `statusImmunities`, and the word "those" is the only
    reason the two lists are equal. They are spelled out rather than derived from one
    another because the OTHER two printings in the family (Dachsbun, Pachirisu) write
    the immunity and NOT the recovery — an implication in either direction would put
    a clause on a card that does not print it.

    ⚠️ AND THE THREE TOKENS ARE THE PRINTED WORDS, NOT `SpecialConditions.rotation`.
    They happen to be exactly that slot's three non-none values; keying on the slot
    would be one character shorter, behave identically on every board this pool can
    build, and be unable to spell a printing that named two of the three.

    `provides: ["Colorless"]` is Jet's line for Jet's reason — the printed "{C}
    Energy" with no rider — so the cost half of this card needs no new mechanism at
    all. Its `legal_standard` is 0 on the local D1 (regulation mark G); the engine has
    never gated on legality, and the fixture carries the value rather than the
    judgement. */
const THERAPEUTIC_ENERGY: CardProgram = {
  energy: {
    provides: ["Colorless"],
    passive: {
      statusRecovery: ["asleep", "confused", "paralyzed"],
      statusImmunities: ["asleep", "confused", "paralyzed"],
    },
  },
};

// ── M4 slice 6: triggered Abilities (§9) — fire on a game event. ──

/** Flamigo — "Insta-Flock": "When you play this Pokémon from your hand onto
    your Bench during your turn, you may search your deck for up to 3 Flamigo,
    reveal them, and put them into your hand. Then, shuffle your deck." */
const FLAMIGO: CardProgram = {
  triggered: [
    {
      name: "Insta-Flock",
      trigger: "onPlayToBench",
      optional: true,
      program: [
        {
          op: "searchDeck",
          filter: { kind: "byName", name: "Flamigo" },
          dest: "hand",
          max: 3,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Arboliva — "Enriching Oil": "When you play this Pokémon from your hand to
    evolve 1 of your Pokémon during your turn, you may heal all damage from 1 of
    your Pokémon." */
const ARBOLIVA: CardProgram = {
  triggered: [
    {
      name: "Enriching Oil",
      trigger: "onEvolve",
      optional: true,
      program: [{ op: "healChosen", amount: "all" }],
    },
  ],
};

/** Garganacl — "Blessed Salt": "During Pokémon Checkup, heal 20 damage from
    each of your Pokémon." (mandatory; non-parking, so it fires from anywhere in
    play — Active or Bench) */
const GARGANACL: CardProgram = {
  triggered: [
    {
      name: "Blessed Salt",
      trigger: "betweenTurns",
      program: [{ op: "healEach", amount: 20 }],
    },
  ],
};

/** Trevenant — "Forest Miasma": "During Pokémon Checkup, if this Pokémon is in
    the Active Spot, put 1 damage counter on your opponent's Active Pokémon."
    (mandatory; active-only; the placed counter can KO — the Checkup's own KO
    sweep resolves it)

    The `amount: 10` is the printed ONE COUNTER converted to HP at the site that
    reads it (§12), which is the same conversion `COUNTER_PUT_ON_DEFENDER`'s
    deriver arm makes for the attack printings; `source: "ability"` is what the
    log row may honestly say about a Checkup trigger, and it became a field the
    day an ATTACK gained the same op (D139). */
const TREVENANT: CardProgram = {
  triggered: [
    {
      name: "Forest Miasma",
      trigger: "betweenTurns",
      activeOnly: true,
      program: [{ op: "damageActive", amount: 10, source: "ability" }],
    },
  ],
};

/** 🆕 D340 — Froslass (`sv06-053` / `sv06-174` / `svp-117`) "Freezing Shroud":
    *"During Pokémon Checkup, put 1 damage counter on each Pokémon that has an
    Ability (both yours and your opponent's), except any Froslass."*
    **3 Standard-legal printings on ONE sentence, and that is the whole legal
    population** — remote D1 `luminous`, 2026-08-15, `instr(abilities_json,'except
    any') > 0` across all three text columns.

    🛑 **THE ROW EXISTS BECAUSE THE *EXEMPTION GRAMMAR* WAS CENSUSED, NOT THE
    CARD.** `except any` is **20 printings / 5 sentences / 5 cards**, and only three
    of those sentences are Standard-legal: Iron Crown ex (6, BLOCKED — its base noun
    is the Ancient/Future banner, which NO catalog column classifies: `suffix` holds
    only NULL 3,157 + `ex` 629 = 3,786, the whole table), Pecharunt ex (5, **BUILT at
    D273**) and this one. **The grammar the backlog priced as a missing engine
    capability was already built; what was actually missing was this card.**

    ⚠️ **MANDATORY AND NON-PARKING**, so it fires from anywhere in play — Active or
    Bench — exactly like `GARGANACL`'s "Blessed Salt" two rows up. No `activeOnly`:
    the printed sentence carries no spot clause, and `TREVENANT`'s does, which is
    the whole difference between the two Checkup rows.

    ⚠️ **`amount: 10` IS THE PRINTED *1 damage counter* CONVERTED TO HP AT THE
    REGISTRY (§12)**, `TREVENANT`'s conversion verbatim — the interpreter never sees
    the printed unit, so the ×10 cannot happen twice.

    ⚠️ **`abilityPokemon` IS THE PRINTED NOUN AND IT COST NOTHING** — the
    `CardFilter` member already existed (D285 authored it for the Pokémon-play bar),
    so *"each Pokémon that has an Ability"* is a reuse and not a widening.

    🛑 **AND FROSLASS EXEMPTS ITSELF, WHICH IS WHY THE ROW CAN GO RED.** Froslass
    HAS an Ability, so it satisfies the noun and is removed only by `exceptNamed` —
    a build that conjoined the two predicates instead of subtracting, or that simply
    dropped the rider, would counter every Froslass on the table. The name is
    spelled out rather than derived from the source card (D273's rule: the op is
    handed a CARD and never a source, so a self-referential rider's only witness
    would be the coincidence that the printed name matches). */
const FREEZING_SHROUD: CardProgram = {
  triggered: [
    {
      name: "Freezing Shroud",
      trigger: "betweenTurns",
      program: [
        {
          op: "counterEachAll",
          amount: 10,
          filter: { kind: "abilityPokemon" },
          exceptNamed: "Froslass",
        },
      ],
    },
  ],
};

/** Armarouge (sv03-044) — "Scorching Armor": "If this Pokémon is in the Active
    Spot and is damaged by an attack from your opponent's Pokémon (even if this
    Pokémon is Knocked Out), the Attacking Pokémon is now Burned." The general
    `onDamagedByAttack` trigger the D98 `damageAttacker` passive deliberately did
    NOT build (that one is flat, program-free counter placement read seat-free;
    this one runs an EffectOp reactively, which is what TriggeredAbility.program
    is for). `activeOnly` carries the "in the Active Spot" clause; the trigger
    program runs under the DAMAGED Pokémon's seat, so `applyStatus target:
    "defender"` Burns the ATTACKER's Active (otherSeat). Mandatory ("is now
    Burned"), so no `optional`. attack.ts fires it at the same main-hit spot as
    the recoil, gated on `dealt > 0`, BEFORE the §8.1 sweep — so "even if Knocked
    Out" is free (a lethally-damaged Armarouge still Burns the attacker). This is
    the SV-era Armarouge WITH the ability; sv01-041/-203 (`ARMAROUGE`, "Fire
    Off") is a different print with a different Ability. */
const SCORCHING_ARMOR: CardProgram = {
  triggered: [
    {
      name: "Scorching Armor",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: [{ op: "applyStatus", target: "defender", status: "burned" }],
    },
  ],
};

/** Klawf ex (sv03-120) — "Counterattacking Pincer": "If this Pokémon is in the
    Active Spot and is damaged by an attack from your opponent's Pokémon (even if
    this Pokémon is Knocked Out), discard an Energy from the Attacking Pokémon."
    The `onDamagedByAttack` twin of Scorching Armor (D99), and the card that made
    the trigger PARK: its reactive program is a `discardEnergy from:"opponentActive"`
    (the Mawile op, reused verbatim), and — since the program runs under the DAMAGED
    seat — `opponentActive` resolves to the ATTACKER's Active (`otherSeat`), so the
    DEFENDER chooses which of the attacker's Energy to discard. That choice PARKS
    during the OPPONENT's turn: attack.ts stages it as a `damagedTrigger` and folds
    it through settleProgram with `resumeTail` (flow.ts `runDamagedTrigger`), so the
    DEFENDER is the answerer (the koTrigger routing) and the attackEpilogue behind it
    resumes after the pick. `filter: anyEnergy` — the print says "an Energy", not a
    Special (that would be `specialEnergy`, Mawile's "Special Eater"). `activeOnly`
    carries the "in the Active Spot" clause; mandatory ("discard an Energy"), so no
    `optional`. "Even if Knocked Out" is free — the stage runs before finishAttack's
    §8.1 sweep, and Klawf ex being a rule-box ex prizes 2 to the attacker (§8.1). */
const COUNTERATTACKING_PINCER: CardProgram = {
  triggered: [
    {
      name: "Counterattacking Pincer",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
    },
  ],
};

// ── M4 slice 8: the mid-turn-damage snipe (§9). ──

/** Hawlucha — "Flying Entry": "When you play this Pokémon from your hand onto
    your Bench during your turn, you may choose 2 of your opponent's Benched
    Pokémon and put 1 damage counter on each of them." A TRIGGERED Ability
    (onPlayToBench); the placed counters are flat (not attack damage) and can
    KO — triggers.ts folds the result through settleProgram, which sweeps the
    board for a mid-turn Knock Out.

    The printed "you may" is on the op as well as on the trigger, and the two
    spellings do different jobs: the TRIGGER's `optional` is what the framework
    auto-fires past (every representative is pure upside), so the op's `optional`
    is where the decline actually survives — take 2, or take none. It is the only
    consumer of `damageChosen` that carries the word; the Ability-activated
    snipes below spend their "may" on choosing to use the Ability. */
const HAWLUCHA: CardProgram = {
  triggered: [
    {
      name: "Flying Entry",
      trigger: "onPlayToBench",
      optional: true,
      program: [
        {
          op: "damageChosen",
          target: "opponentBench",
          amount: 10,
          count: 2,
          source: "ability",
          optional: true,
        },
      ],
    },
  ],
};

/** Meowscarada ex — "Bouquet Magic": "You must discard a Basic {G} Energy card
    from your hand in order to use this Ability. Once during your turn, you may
    put 3 damage counters on 1 of your opponent's Benched Pokémon." An ACTIVATED
    Ability with an activation COST; usable from anywhere in play (not
    Active-only), once per turn. The counters are flat and can KO — useAbility
    folds through settleProgram's mid-turn sweep.

    The cost is the program's FIRST op (the printed sentence order), and it is the
    FUNGIBLE end of that op's range: every Basic {G} Energy card in hand is
    interchangeable, so they collapse to one candidate and the Ability asks
    nothing — the same no-prompt behaviour the pre-op `AbilityCost` field had, now
    a consequence of the general rule instead of a special case. */
const MEOWSCARADA: CardProgram = {
  abilities: [
    {
      name: "Bouquet Magic",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "basicEnergy", energyType: "Grass" },
        },
        { op: "damageChosen", target: "opponentBench", amount: 30, count: 1, source: "ability" },
      ],
    },
  ],
};

/** Radiant Blastoise (swsh10.5-018) — "Pump Shot": "You must discard a Water
    Energy card from your hand in order to use this Ability. Once during your
    turn, you may put 2 damage counters on 1 of your opponent's Benched Pokémon."
    Meowscarada's Ability one type and one counter apart, so it lands as data.

    FILTER — A DOCUMENTED DEVIATION, not a settled reading. The print says "a
    **Water** Energy card" where Meowscarada says "a **Basic** {G} Energy card",
    and the engine maps both to `basicEnergy` + a type, so the printed word
    "Basic" is doing no work. By §6.5 a typed reference means an Energy that
    PROVIDES that type, so the faithful answer would also admit a Special Energy
    providing {W} sitting in hand — and the engine cannot ask that question,
    because provision is a while-ATTACHED property and `matchesFilter` (the
    pile scanner) answers false for `providesEnergy` by construction.

    So `basicEnergy` is the CONSERVATIVE approximation: it will refuse Pump Shot
    to a player holding only a Special Energy that provides {W}. That is
    unreachable today (no such card is authored) and it fails in the safe
    direction — a refused Ability, never a wrong card discarded. The real fix is a
    pile-side "would provide" predicate, which §6.5 explicitly leaves open;
    tracked in reference/coverage-backlog.md. */
const RADIANT_BLASTOISE: CardProgram = {
  abilities: [
    {
      name: "Pump Shot",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "basicEnergy", energyType: "Water" },
        },
        { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "ability" },
      ],
    },
  ],
};

/** Revavroom (sv01-142) — "Rumbling Engine": "You must discard an Energy card
    from your hand in order to use this Ability. Once during your turn, you may
    draw cards until you have 6 cards in your hand."

    The family's ORDER WITNESS, and the reason the cost is an op rather than
    something paid after the fact: the draw counts the hand AFTER the payment, so
    a hand of 5 pays 1 and draws 2, not 1. `anyEnergy` (Basic OR Special — the
    print says "an Energy card", not "a Basic Energy card"), which also makes this
    the first cost whose candidates are not all interchangeable: a Basic {R} and a
    Double Turbo Energy in hand is a real question. */
const REVAVROOM: CardProgram = {
  abilities: [
    {
      name: "Rumbling Engine",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "payFromHand", count: 1, to: "discard", filter: { kind: "anyEnergy" } },
        { op: "drawUntilHandSize", size: 6 },
      ],
    },
  ],
};

/** Tinkaton (sv02-105) — "Gather Materials": "You must discard a card from your
    hand in order to use this Ability. Once during your turn, you may draw 3
    cards." The cost's GENERAL form — no filter at all, so every card in hand is a
    candidate and a mixed hand always asks. This is the one the pre-op
    `AbilityCost` field could not express. */
const TINKATON: CardProgram = {
  abilities: [
    {
      name: "Gather Materials",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "payFromHand", count: 1, to: "discard" },
        { op: "drawCards", count: 3 },
      ],
    },
  ],
};

/** Fezandipiti ex (sv06.5-038 / sv06.5-084 / sv06.5-092) — "Flip the Script":
    "Once during your turn, if any of your Pokémon were Knocked Out during your
    opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip
    the Script Ability each turn." (3 legal printings, one byte-identical
    `abilities_json` across all three — re-queried 2026-08-07.)

    THE ROW THAT NEEDED BOTH NEW PIECES AND NO NEW OPS. The draw is Tinkaton's
    `drawCards` (the printed "you may" is not modelled for a pure-upside draw —
    the same reading Tinkaton's "Once during your turn, you may draw 3 cards"
    already takes), and the gate's `BoardCondition` was built whole at D271 for
    Unfair Stamp and Hassel. What this card adds is the two SCOPES:

    * `playableIf` — the first time a `BoardCondition` gates an ABILITY rather
      than a Trainer or an attack. The condition, `conditionHolds` and
      `conditionNote` all take a byte-zero diff; the fourth consumer is the point.
    * `oncePerTurn: "sharedByName"` — the printed second sentence. A player who
      benches two Fezandipiti ex gets ONE draw, not two, and the lock is what says
      so. `true` here would be a live bug on any board with a second copy, which
      is exactly why the test drives it with two. */
const FLIP_THE_SCRIPT: CardProgram = {
  abilities: [
    {
      name: "Flip the Script",
      oncePerTurn: "sharedByName",
      activeOnly: false,
      playableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
      program: [{ op: "drawCards", count: 3 }],
    },
  ],
};

/** Pecharunt ex (sv06.5-039 / sv06.5-085 / sv06.5-093 / sv06.5-095 /
    sv08.5-163) — "Subjugating Chains": "Once during your turn, you may switch 1
    of your Benched {D} Pokémon, except any Pecharunt ex, with your Active
    Pokémon. If you do, the new Active Pokémon is now Poisoned. You can't use
    more than 1 Subjugating Chains Ability each turn."

    **5 Standard-legal printings on ONE byte-identical `abilities_json`** — the
    BIGGEST single-sentence ability group left on the name-lock sweep, re-derived
    rather than inherited (`GROUP BY lower(j.value ->> 'effect')` over
    `json_each(abilities_json)` with `legal_standard = 1`, remote D1 `luminous`,
    2026-08-07: the whole `%You can't use more than 1%` ladder returns **10** —
    Pecharunt 5, Fezandipiti 3 BUILT at D272, Fan Rotom 2 still blocked).

    THREE PRINTED CLAUSES AND THE MIDDLE ONE IS THE ONLY NEW WORK:
      • *"You can't use more than 1 … Ability each turn"* — `oncePerTurn:
        "sharedByName"`, D272's field VERBATIM, zero engine code. Two Pecharunt
        ex on one board get ONE switch between them.
      • *"switch 1 of your Benched **{D}** Pokémon, **except any Pecharunt ex**,
        with your Active Pokémon"* — `switchActive` with D273's two new candidate
        riders. This is the slice.
      • *"**If you do**, the new Active Pokémon is now Poisoned"* — the §9.2
        `recordGate` on the `moved` slot plus `applyStatus target: "self"`, both
        shipped since Janine's Secret Art. ⚠️ THE PAIRING IS EXACT RATHER THAN
        CONVENIENT: `switchActive`'s `recordAs` files the uid that ACTUALLY became
        Active and files `[]` when the switch did not happen, and `applyStatus`
        `"self"` resolves to `state.players[ctx.seat].active` — which, inside the
        gate, IS the newly promoted body. The printed "the new Active Pokémon" and
        the op's subject are the same Pokémon by construction, not by ordering
        luck.

    ⚠️ **`activeOnly: false` AND NO `playableIf`.** The sentence puts no condition
    on Pecharunt itself — it may sit on the Bench and still chain — so the only
    gate is the candidate set, and `programPlayable` refuses the activation when
    that set is empty (a Bench with no non-Pecharunt {D} body). The printed
    exclusion therefore also does the work of "this Pokémon can't switch itself
    in", with no self-guard: an Active Pecharunt is not on the Bench, and a benched
    one is excluded BY NAME.

    ⚠️ **NO `optional` OP WRAPPER**, unlike Iron Leaves' trigger: this is an
    ACTIVATED Ability, so the printed "you may" is the decision to use it at all —
    the same reading "Showtime" takes for the same op one program up. */
const SUBJUGATING_CHAINS: CardProgram = {
  abilities: [
    {
      name: "Subjugating Chains",
      oncePerTurn: "sharedByName",
      activeOnly: false,
      program: [
        {
          op: "switchActive",
          targetType: "Darkness",
          exceptNamed: "Pecharunt ex",
          recordAs: "moved",
        },
        {
          op: "recordGate",
          slot: "moved",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
        },
      ],
    },
  ],
};

/** Fan Rotom (sv07-118 / sv08.5-085) — "Fan Call": "Once during your **first**
    turn, you may search your deck for up to 3 {C} Pokémon with 100 HP or less,
    reveal them, and put them into your hand. Then, shuffle your deck. You can't
    use more than 1 Fan Call Ability during your turn."

    **THE LAST ROW ON THE `%You can't use more than 1%` NAME-LOCK SWEEP.** That
    ladder returns TEN legal printings on THREE sentences (remote D1 `luminous`,
    re-queried 2026-08-08, `GROUP BY lower(j.value ->> 'effect')` over
    `json_each(abilities_json)` at `legal_standard = 1`): Pecharunt ex 5 (D273),
    Fezandipiti ex 3 (D272) and these **2**. Both printings are `legal_standard =
    1`, `types_json ["Colorless"]`, `hp` **70** — checked, because a `pokemonType`
    the card does not carry would be an arm no board can reach.

    🛑 **FOUR PRINTED CLAUSES, AND EXACTLY ONE OF THEM WAS NEW.**
      • *"You can't use more than 1 Fan Call Ability during your turn"* —
        `oncePerTurn: "sharedByName"`, D272's field VERBATIM. ⚠️ NOTE THE PRINTED
        WORDING DIFFERS from the other two carriers ("during your turn" vs "each
        turn") and the FIELD DOES NOT CARE: the lock is keyed on the ability NAME,
        and two Fan Rotom on one Bench share one use either way. **A field is
        keyed on what a sentence MEANS, not on how it spells it.**
      • *"search your deck for up to 3 {C} Pokémon with 100 HP or less, reveal
        them, and put them into your hand"* — `searchDeck` with `dest: "hand"`,
        `max: 3`, `reveal: true`: Genesect ex's "Metallic Signal" program with a
        different filter. The `{C}` is `typedPokemon` (D238) and the *"with 100 HP
        or less"* is D265's `maxHp` rider, which until this slice existed only on
        `basicPokemon` — **ONE optional property, on the member D265's own doc
        block said would need it.**
      • *"Then, shuffle your deck"* — `shuffleDeck`, since M4.
      • *"Once during your **first** turn"* — THE SLICE. See
        `BoardCondition.yourFirstTurn` (effects.ts) and `isFirstTurnOf`
        (types.ts): a per-seat turn ORDINAL, DERIVED from `state.turn` and
        `state.firstPlayer` rather than stored, because both operands were already
        on `GameState` and a field would only have been a cached subtraction.

    ⚠️ **THE TWO GATES ARE DIFFERENT MECHANISMS AND BOTH ARE OWED**, which is what
    made this row look like two slices. `oncePerTurn` bounds HOW MANY TIMES per
    turn across copies; `playableIf` bounds WHICH TURN. Drop either and the card
    is wrong in a direction no board would notice quickly: without the ordinal it
    is a turn-9 tutor, without the name lock a second copy doubles the opening.

    ⚠️ **`activeOnly: false`** — the sentence puts Fan Rotom nowhere in
    particular, and the printed line is the whole gate. ⚠️ **NO `optional` op
    wrapper**: this is an ACTIVATED Ability, so the printed "you may" is the
    decision to use it at all (SHOWTIME's reading, and SUBJUGATING_CHAINS's). */
const FAN_CALL: CardProgram = {
  abilities: [
    {
      name: "Fan Call",
      oncePerTurn: "sharedByName",
      activeOnly: false,
      playableIf: { kind: "yourFirstTurn" },
      program: [
        {
          op: "searchDeck",
          filter: { kind: "typedPokemon", pokemonType: "Colorless", maxHp: 100 },
          dest: "hand",
          max: 3,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Ultra Ball (sv01-196) — "You can use this card only if you discard 2 other
    cards from your hand. / Search your deck for a Pokémon, reveal it, and put it
    into your hand. Then, shuffle your deck." (Item)

    The cost family's Trainer form: same mechanism as the Abilities above, printed
    as "only if" instead of "you must", and carrying the "OTHER" that says the
    Ultra Ball itself may not pay — which it never can, since playTrainer moves it
    to the discard before the program runs, and which the play GATE honours by
    excluding the played uid (cardplay.ts). Two ops after the cost: Great Ball's
    search, then the Nest Ball trailing shuffle. */
const ULTRA_BALL: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 2, to: "discard" },
    { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 1, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** Earthen Vessel (sv06.5-096) — "You can use this card only if you discard
    another card from your hand. / Search your deck for up to 2 Basic Energy
    cards, reveal them, and put them into your hand. Then, shuffle your deck."
    (Item) Ultra Ball at count 1 — the printed "**another** card" is the singular
    of "2 other cards", not a different rule — over a Basic Energy search. */
const EARTHEN_VESSEL: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 1, to: "discard" },
    { op: "searchDeck", filter: { kind: "basicEnergy" }, dest: "hand", max: 2, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** 🆕 **D336 — Larry's Skill `sv08.5-115`/`-139` (Supporter, 2 legal)** —
    *"Discard your hand and search your deck for **a Pokémon, a Supporter card,
    and a Basic Energy card**, reveal them, and put them into your hand. Then,
    shuffle your deck."*

    **THE FIRST THREE-NOUN SEARCH, AND THE PROGRAM IS THREE OPS OF WHICH ONLY THE
    MIDDLE ONE IS NEW.** Professor's Research's `discardHand` opens it, Ultra Ball's
    `searchDeck … reveal` is the shape of the middle, and Nest Ball's trailing
    `shuffleDeck` closes it. What is new is `also`: three groups, each capped at
    ONE, so the flat total of 3 cannot be answered with three Pokémon.

    ⚠️ **ORDER IS THE PRINT'S**, and it is load-bearing for the CAPTION rather than
    for the rules: `searchNote` walks the groups in order, so the dialog reads
    *"…for a Pokémon, a Supporter card, and a Basic Energy card into your hand."* —
    the printed nouns in the printed sequence. The candidate set and the caps are
    order-free, which is exactly why the order can carry the sentence.

    ⚠️ **`discardHand` RUNS FIRST AND THAT IS NOT A DETAIL** — the printed "Discard
    your hand **and** search" means the deck search happens with an empty hand, so
    the three cards found are the whole hand afterwards. Ordering the ops the other
    way would discard what the search just found. */
const LARRYS_SKILL: CardProgram = {
  trainer: [
    { op: "discardHand" },
    {
      op: "searchDeck",
      filter: { kind: "anyPokemon" },
      dest: "hand",
      max: 1,
      reveal: true,
      also: [
        { filter: { kind: "supporter" }, max: 1 },
        { filter: { kind: "basicEnergy" }, max: 1 },
      ],
    },
    { op: "shuffleDeck" },
  ],
};

/** 🆕 **D336 — Secret Box `sv06-163` (Item, 1 legal)** — *"You can use this card
    only if you discard 3 other cards from your hand. / Search your deck for **an
    Item card, a Pokémon Tool card, a Supporter card, and a Stadium card**, reveal
    them, and put them into your hand. Then, shuffle your deck."*

    **THE FOUR-NOUN SEARCH, AND IT IS ULTRA BALL'S PROGRAM WITH A WIDER MIDDLE.**
    The cost is `payFromHand{count: 3, to: "discard"}` — the same op Ultra Ball
    pays 2 of and Earthen Vessel 1 of — and the printed *"3 **other** cards"* needs
    no rider for the same reason Ultra Ball's does not: `playTrainer` moves the
    played card to the discard before the program runs, so the Item can never pay
    for itself, and the play GATE excludes the played uid (cardplay.ts).

    ⚠️ **FOUR GROUPS IS WHY THE FIELD IS A LIST AND NOT A SECOND `also`**, which is
    the whole argument in effects.ts: an arity-2 pair (the sibling op's shape) could
    not spell this row at all, and this is the row Standard actually prints. All
    four Trainer subtypes are mutually exclusive, so the conservative overlap rule
    never fires here. */
const SECRET_BOX: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 3, to: "discard" },
    {
      op: "searchDeck",
      filter: { kind: "item" },
      dest: "hand",
      max: 1,
      reveal: true,
      also: [
        { filter: { kind: "toolCard" }, max: 1 },
        { filter: { kind: "supporter" }, max: 1 },
        { filter: { kind: "stadium" }, max: 1 },
      ],
    },
    { op: "shuffleDeck" },
  ],
};

/** 🆕 **D337 — Ethan's Adventure `sv10-165`/`-221`/`-236` (Supporter, 3 legal)** —
    *"Search your deck for up to 3 **in any combination of** Ethan's Pokémon and
    Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle
    your deck."*

    **THE OTHER GRAMMAR, AND IT IS D336's EXACT OPPOSITE ONE FIELD OVER.** Larry's
    Skill spells *"a Pokémon, a Supporter card, **and** a Basic Energy card"* — one
    cap PER NOUN, which is `also`. This spells *"up to 3 **in any combination of** X
    and Y"* — ONE FLAT cap over a UNION, which is `anyOf` (D245) under a bare `max`.
    The two printed sentences are one clause apart and mean opposite things about a
    legal answer: `also` here would refuse the three-Ethan's-Pokémon take the card
    explicitly permits, and a flat cap on Larry's Skill would permit three Pokémon
    the card explicitly refuses. **`also` IS DELIBERATELY ABSENT**, and that absence
    is the row.

    ✅ **ZERO ENGINE CODE, AND THE CAPTION IS THE THIRD WITNESS RATHER THAN A NEW
    DECISION.** `retrieveNoun`'s `anyOf` arm joins `" or "` where all three cards
    print "and" — Lana's Aid `sv06-155`/`-207`/`-219` (D264) settled it and Bug
    Catching Set `sv06-143`/`sv08.5-102` (D333) inherited it, both printing this very
    *"in any combination of … and …"* grammar. The disagreement is the ESTABLISHED
    READING and not a defect: the predicate is a union asked about ONE card, and an
    English "and" between two noun phrases there reads as a conjunction the filter
    does not mean. This row renders *"Search your deck for up to 3 Ethan's Pokémon or
    Basic Fire Energy cards into your hand."* — `searchNote`'s SINGLE-group arm,
    which is the pre-D336 function byte for byte and knows nothing of filter kinds.

    ⚠️ **IT IS THE FIRST `anyOf` UNDER `searchDeck`.** Its two prior consumers are
    `discardPileRetrieval` (Lana's Aid) and `lookAtTopN` (Bug Catching Set), so the
    combinator has now been read by three different ops and gained a line for none of
    them — which is what a filter member being a FILTER rather than an op field is
    supposed to buy.

    ⚠️ **`ownerPokemon` WITHOUT A `stage`, AND `basicEnergy` WITH AN `energyType`.**
    The print says *"Ethan's Pokémon"* (any stage — so an Ethan's Evolution must be
    admitted, which is the case that separates this from `stage: "basic"`) and
    *"**Basic** {R} Energy cards"* (so a Special Energy must be refused, and so must a
    Basic Energy of another type). `ownerPokemon`'s `category === "Pokemon"` conjunct
    is load-bearing on THIS card in particular: Team Rocket's Energy `sv10-182` is the
    printed proof that an owner prefix does not make a Pokémon, and the {R} arm of
    this very union is where such a card would otherwise land twice.

    NO cost op — nothing is discarded or paid — and the trailing `shuffleDeck` is
    Nest Ball's. 3 legal printings on 1 byte-identical sentence, which is the whole
    Standard-legal population of the owner-prefixed combination search. */
const ETHANS_ADVENTURE: CardProgram = {
  trainer: [
    {
      op: "searchDeck",
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "ownerPokemon", owner: "Ethan" },
          { kind: "basicEnergy", energyType: "Fire" },
        ],
      },
      dest: "hand",
      max: 3,
      reveal: true,
    },
    { op: "shuffleDeck" },
  ],
};

/** 🆕 **D338 — Heatmor `sv10.5w-019`/`-104` "Licking Catch" (attack index 0, 2 legal)** —
    *"Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R}
    Energy cards, reveal them, and put them into your hand. Then, shuffle your deck."*

    **ETHAN'S ADVENTURE'S SENTENCE WITH EXACTLY ONE NOUN CHANGED, ONE SURFACE OVER.**
    D337 built the `effect` printing of this grammar; this is the `attacks_json` one,
    and the only difference in the program is which way the union's Pokémon member is
    narrowed: `typedPokemon{Fire}` for the printed *"{R} Pokémon"* where that card
    prints *"Ethan's Pokémon"* and takes `ownerPokemon{Ethan}`. Same `anyOf`, same flat
    `max: 3`, same `dest: "hand"`, same printed reveal, same trailing shuffle.

    🛑 **AND THAT ONE NOUN IS WHY THE TWO ROWS LIVE IN DIFFERENT SUMMANDS OF DIFFERENT
    CENSUS COLUMNS.** Ethan's Adventure is a Supporter and moved `BUILT.trainer`, which
    has ONE summand. This is an ATTACK and moves `BUILT.attack`, which has THREE — and
    it moves the **REGISTRY** one (13 → 15), never the raw one: `rawUnitsAtHead()` runs
    the `deriveAttack*` readers over the committed legal corpus with `programFor`
    nowhere in the addition (D307/D315), so an authored row buys it no printings at all.
    `derivedHandSearch.test.ts`'s `DEFERRED` still refuses the sentence by name — *"a
    typed DISJUNCTION (sv10.5w-019/-104)"* — and that refusal is UNCHANGED by building
    it, because *"refused by the deriver"* and *"unbuilt"* have never been the same
    claim (D314).

    ✅ **ZERO ENGINE CODE, AND THE CAPTION IS THE FOURTH WITNESS.** `retrieveNoun`'s
    `anyOf` arm joins `" or "` where the card prints "and" — Lana's Aid (D264), Bug
    Catching Set (D333) and Ethan's Adventure (D337) each print this very *"in any
    combination of … and …"* grammar and each caption `" or "`. This renders *"Search
    your deck for up to 3 Fire Pokémon or Basic Fire Energy cards into your hand."*:
    `typedPokemon` writes the brace code out in FULL (D238's deliberate departure from
    the printed bytes — the rows the player clicks are card NAMES), so the caption says
    "Fire" where the card says `{R}`, exactly as the Energy member has since D337.

    ⚠️ **BOTH MEMBERS ARE NARROWED BY THE SAME TYPE, WHICH IS THE INVERSE OF D337's ROW
    AND THE REASON ITS FIXTURE CAST SEPARATES THIS BUILD WITH EVERY VERDICT FLIPPED.**
    There the Pokémon member was narrowed by OWNER and the Energy member by TYPE, so a
    build that let `{R}` leak onto the Pokémon member was invisible; here the leak that
    hides is the opposite one — an owner or stage rider this print does not carry. A
    `{L}` Pokémon must be REFUSED and an un-prefixed `{R}` Pokémon ADMITTED, which is
    precisely where `ownerPokemon{Ethan}` and `typedPokemon{Fire}` disagree.

    ⚠️ **NO `stage` RIDER.** The print says *"{R} Pokémon"* (any stage), so a {R}
    Evolution must be admitted — the case that separates this from `stage: "basic"`,
    which three other rows on this filter DO carry. And *"**Basic** {R} Energy cards"*
    keeps `basicEnergy`'s `energyType`, so a Special Energy and a Basic Energy of
    another type are both refused.

    INDEX-KEYED: index 1 "Fire Claws" (60, **no `effect` key at all**) contributes zero
    attack units and must stay unclaimed, which is Eldegoss's rule at D314. 2 legal
    printings of 2 — the whole Standard-legal population of the typed combination
    search. */
const LICKING_CATCH: CardProgram = {
  attack: {
    0: [
      {
        op: "searchDeck",
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "typedPokemon", pokemonType: "Fire" },
            { kind: "basicEnergy", energyType: "Fire" },
          ],
        },
        dest: "hand",
        max: 3,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ],
  },
};

/** 🆕 **D339 — Maushold `sv08-158` "Familial March" (attack index 0, 1 legal)** —
    *"Search your deck for up to 2 in any combination of Maushold and Maushold ex and
    put them onto your Bench. Then, shuffle your deck."*

    🛑 **THE SIXTH AND LAST PRINTING OF *"search … in any combination of"* IN THE
    CATALOG — THIS ROW CLOSES THE GRAMMAR AT 6 OF 6.** Re-queried against remote D1
    `luminous` rather than inherited: `attacks_json` 3 legal of 3 (Heatmor
    `sv10.5w-019`/`-104`, D338, and this one), `effect` 3 legal of 3 (Ethan's
    Adventure `sv10-165`/`-221`/`-236`, D337), `abilities_json` **0**. `3 + 3 + 0 =
    6` ✅. ⚠️ THE WIDE NET IS NOT THE GRAMMAR: `instr(effect,'in any combination of')`
    is 15 rows / 10 legal, but only THREE of them open with *"Search your deck for"* —
    the other twelve are `Put` / `Shuffle` / `Look at` / `provides`, a different verb
    over the same joiner. **The verb is the grammar; the joiner is not.**

    ✅ **ZERO ENGINE DIFF, AND EVERY MEMBER WAS GREPPED RATHER THAN RECALLED.**
    `anyOf` shipped at D337 and ran on the ATTACK surface at D338; `byName` has been
    exact since D200 (`{ kind: "byName"; name: string; cardNoun?: true }`);
    `dest: "bench"` + trailing `shuffleDeck` is Nest Ball's shape. Nothing in
    `effects.ts`, `interpreter.ts`, `cardplay.ts` or `packages/schema` moves, and
    `MATCH_RECORD_VERSION` stays **20** — no new op, no new filter member, no new
    `GameState` key, nothing persisted changing shape.

    🛑 **NO `reveal` KEY, AND THAT IS THE PRINT AND NOT AN OMISSION.** The sentence
    puts the cards onto the BENCH and prints no reveal clause — a bench move is public
    by the move itself. So this row lands in `revealClause.test.ts`'s **`NOT_REVEALING`**
    table (10 → 11), where D337's and D338's landed in `REVEALING` (which stands still
    at 28). It is the FIRST row in this run of slices to move the other table.

    ⚠️ **`byName` IS WHY THE DISJUNCTION IS PRINTED AT ALL**, and it is exact in paper
    for the same reason it is exact here: *"Maushold ex"* is a different card NAME from
    *"Maushold"*, and the card says so in so many words. Neither member takes
    `cardNoun` — both name POKÉMON and print bare, which is Flamigo's rule (D200);
    `cardNoun: true` is for the Item-shaped nouns (Arven's Sandwich).

    🛑 **NEITHER MEMBER HAS A STANDARD-LEGAL CATALOG BODY EXCEPT THE ATTACKER ITSELF,
    WHICH IS SHARPER THAN THE HANDOFF SAID AND IS WHY THE CAST IS LOCAL.** All eight
    Maushold-family printings were queried: `Maushold ex` `sv04-155`/`sv04-233` are
    BOTH `legal_standard = 0`, and so are `Maushold` `sv01-161`, `sv02-168`,
    `sv02-226`, `sv04.5-074`, `sv04.5-210` — **`sv08-158` is the ONLY legal `Maushold`
    in the catalog.** The filter must still be authored because the card prints it, but
    the fixture cast reaches for LOCAL `cardPool` bodies (D275's idiom) for both
    members. **THAT IS A CENSUS DECISION, NOT A TIDINESS ONE**: `sv08` is not among
    `catalogManifest`'s six sets, so a shared-pool body would owe a `fix-*` key AND
    redden `revealClause`'s `swept.size`. Nothing enters `FIXTURE_POOL`, so
    `swept.size` stays **27** and `raw.length` is **1** wide rather than 2.
    🛑 **D343 — THE SECOND HALF OF THAT SENTENCE IS DEAD, AND SO IS THE RULE IT
    STATES.** `revealClause`'s sweep no longer reads `FIXTURE_POOL`; its
    population is `registryCardIds()` ∪ the pool, and `swept.size` is **103**,
    not 27. A registry-keyed program is now swept WHETHER OR NOT its suite seats
    a shared body, so "nothing enters the pool, therefore the sweep stands still"
    is false in the number AND in the mechanism. The `catalogManifest` half and
    the `raw.length` half are untouched and still correct — only the sweep clause
    rotted. Left in place rather than deleted because five consecutive slices
    copied this reasoning forward and the copy is the thing worth marking.

    ⚠️ **`max: 2` IS A FLAT CAP OVER THE UNION, NOT TWO CAPS.** "Up to 2 in any
    combination" means the two may be split 2/0, 1/1 or 0/2 — the same least-structured
    answer D337 and D338 measured, and it is STILL a SET rather than an order, which is
    the comparison Deduction Kit's backlog row kept failing to get past.
    🆕 **D341 GOT PAST IT, AND THE FOUR COMPARISONS WERE ALL CORRECT.** D336-D339
    each concluded that no arrangement of caps over `chooseCards` yields an order,
    and every one of them was right: the answer was already a `string[]`, and what
    was missing was a CONSUMER THAT READS THE INDICES. The new `orderCards` prompt
    is that consumer. **FOUR SESSIONS OF RE-PRICING THE SAME TRUE PREMISE IS WHAT A
    BACKLOG ROW LOOKS LIKE WHEN THE QUESTION IS AIMED AT THE ANSWER'S SHAPE INSTEAD
    OF AT WHO READS IT.**

    INDEX-KEYED: index 1 "Incessant Incisors" is *"Flip 4 coins. This attack does 30
    damage for each heads."* with `damage: "30×"` — a coin-scaled body this row must
    leave unclaimed, which is Eldegoss's rule at D314 and Heatmor's at D338.

    🛑 **THIS MOVES `BUILT.attack`'s REGISTRY SUMMAND ALONE, 15 → 16.** The raw summand
    stays **1,164** — `rawUnitsAtHead()` runs the `deriveAttack*` readers over the
    committed legal corpus with `programFor` nowhere in the addition (D307/D315), so an
    authored row buys it nothing — and the split term stays **13**, since this sentence
    carries no gate clause for `splitAttackGateClause` to find.
    `1,164 + 16 + 13 = 1,193` ✅, re-added from the parts rather than incremented. */
const FAMILIAL_MARCH: CardProgram = {
  attack: {
    0: [
      {
        op: "searchDeck",
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "byName", name: "Maushold" },
            { kind: "byName", name: "Maushold ex" },
          ],
        },
        dest: "bench",
        max: 2,
      },
      { op: "shuffleDeck" },
    ],
  },
};

/** Dendra (sv02-179) — "Put a card from your hand on the bottom of your deck. If
    you do, draw cards until you have 5 cards in your hand. (If you have no other
    cards in your hand, you can't use this card.)" (Supporter)

    The hand cost whose destination is NOT the discard, and the card that proves
    the mechanism is about the PAYMENT rather than the pile: nothing here is
    discarded, the sentence never says "cost", and every clause still lands on the
    same three pieces — a mandatory exact pick out of hand (`payFromHand`), a
    benefit conditional on it ("if you do"), and the printed play gate, which
    Dendra states as its contrapositive ("if you have no other cards … you can't
    use this card") and which `handCostUnmet` already answers, "other" included.

    The two ops must stay in this order for the same reason Revavroom's must: the
    paid card leaves the hand BEFORE "until you have 5" counts it. Holding Dendra
    + 3 others, the hand is 3 after the play, 2 after the payment, and the draw is
    THREE. Ordering them the other way would draw two and end at 4 — an off-by-one
    the printed sentence rules out by writing the payment first.

    `drawUntilHandSize` never trims, so a hand already above 5 after paying simply
    draws nothing (Grusha's rule, unchanged) — a real Dendra line late in a game,
    and the only one where the Supporter is spent for a single card rotation.

    "IF YOU DO" IS NOW SAID OUT LOUD (§9.2). The draw sits inside a `recordGate`
    on the payment, which is what the card prints. It changes no game a player can
    reach — `handCostUnmet` refuses the play when there is nothing to pay with, so
    the payment either happens or the card is never played — and that is exactly
    why it is worth stating: the conditional's correctness currently rests on a
    gate in another file agreeing with it, and this makes the program true on its
    own. Running the program directly against an empty hand (which the tests do,
    and only they can) now draws nothing instead of filling to 5. */
const DENDRA: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 1, to: "deckBottom", recordAs: "paid" },
    {
      op: "recordGate",
      slot: "paid",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [{ op: "drawUntilHandSize", size: 5 }],
    },
  ],
};

/** Skwovet (sv01-151) — "Nest Stash": "Once during your turn, you may shuffle
    your hand and put it on the bottom of your deck. If you put any cards on the
    bottom of your deck in this way, draw a card."

    Dendra's family member that needed NO new op: the same printed destination
    reached by the WHOLE hand rather than one chosen card, which is `handRefresh`
    with the riders Iono already built — `toBottom` (the hand alone is shuffled and
    placed under the deck, so the deck's order survives) and `onlyIfAnyMoved` (the
    printed "if you put any cards … in this way", which is the difference between
    an empty hand drawing 1 and drawing 0). An ABILITY rather than a Supporter, so
    it is the first `handRefresh` outside the Trainer path — and, being once per
    turn per Pokémon, the first that can run twice in a turn off two copies.

    Sits on the BENCH as happily as the Active (`activeOnly: false`, as printed).
    An empty hand still spends the allowance for nothing, which is D39's recorded
    call for this family: a hand refresh is always playable. */
const SKWOVET: CardProgram = {
  abilities: [
    {
      name: "Nest Stash",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "handRefresh",
          who: "you",
          draw: { kind: "fixed", count: 1 },
          toBottom: true,
          onlyIfAnyMoved: true,
        },
      ],
    },
  ],
};

// ── M4 slice 9: on-KO triggered Abilities (§9) — fire when Knocked Out. ──

/** Glimmora — "Shattering Crystal": "When this Pokémon is Knocked Out, flip a
    coin. If heads, your opponent can't take any Prize cards for it." A TRIGGERED
    Ability firing on Knock Out (during the OPPONENT's turn, mid-KO-sweep). The
    coin-flip Prize denial is `onKoPrizeGuard` (resolved by the KO sweep, not the
    interpreter) — it has no op program, so no koTrigger stage is queued for it. */
const GLIMMORA: CardProgram = {
  triggered: [
    {
      name: "Shattering Crystal",
      trigger: "onKnockOut",
      program: [],
      onKoPrizeGuard: "coinFlipPrevent",
    },
  ],
};

/** Munkidori ex sv06.5-037/-083/-091 — "Oh No You Don't" (D164): "If this Pokémon
    is Knocked Out by damage from an attack from your opponent's Pokémon, and if
    you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card."

    THE SECOND consumer of the KO antecedent D158 censused, and the FIRST that
    could not use D158's read site. D158 discharged "by an attack" by PLACEMENT —
    its line sits in `finishAttack`, which only the attack epilogue reaches. This
    consequent modifies a PRIZE, and prizes are planned inside `collectKnockOuts`
    (planPrizes), which the Checkup and the mid-turn evolve path ALSO reach. So the
    cause cannot be discharged by placement here and is threaded as a parameter
    instead — see flow.ts `collectKnockOuts`' `attackerSeat`.

    Three printings, ONE body: the D1 rows for -037 (Double rare), -083 (Ultra
    Rare) and -091 (Special illustration rare) are byte-identical on every column
    but `rarity` (re-queried D164 — a single `count(distinct …)` over name, hp,
    stage, types, retreat, abilities, attacks, weaknesses, resistances, reg mark
    and legality returns 1). D162 mapped the same three ids onto ONE fixture for
    the per-attack lock on "Dirty Headbutt"; this row joins that program rather
    than replacing it, so the card carries BOTH of its printed sentences. */
const MUNKIDORI_EX: CardProgram = {
  triggered: [
    {
      name: "Oh No You Don't",
      trigger: "onKnockOut",
      program: [],
      onKoPrizeReduction: { by: 1, requiresInPlay: "Pecharunt ex" },
    },
  ],
};

/** FIXTURE-ONLY demonstrator (id `fix-koprize`, D164) for the CLAMP in
    `koPrizeReduction` (flow.ts), and it takes TWO constructed values to reach it,
    which is the finding rather than an accident of the fixture.

    The clamp fires only when `by` EXCEEDS the body's face-value Prize. Munkidori
    ex prints `by: 1` and has a Rule Box (2 Prizes), so the printed card is always
    2 → 1; and no body in the game is worth less than 1, so `by: 1` can never
    exceed it either. **The clamp is therefore unreachable from ANY board the
    catalog can build** — a first mutation pass deleted it and nothing failed,
    including a 1-Prize body, because 1 − 1 is 0 with or without the `Math.max`.

    So this demonstrator carries `by: 2` on a 1-Prize body: 1 − 2 = −1, clamped to
    0. It is the `fix-onko` pattern (a fixture proves machinery the printed cast
    cannot reach) and the clamp is kept rather than deleted for the reason that
    makes it cheap: the field is data, and the FIRST printing that reduces by more
    than one — or any printing of this Ability on a no-Rule-Box body — turns a
    silent negative Prize count into a real one. */
const FIX_KOPRIZE: CardProgram = {
  triggered: [
    {
      name: "Oh No You Don't",
      trigger: "onKnockOut",
      program: [],
      onKoPrizeReduction: { by: 2, requiresInPlay: "Pecharunt ex" },
    },
  ],
};

/** FIXTURE-ONLY demonstrator (id `fix-onko`) for the resume-the-tail on-KO
    PARKING path: an on-KO Ability whose program needs a DECISION, so it parks
    mid-KO-sweep on effect:choose (the KO'd player searches their deck) and the
    sweep resumes draining prizes/promotions afterwards. No real SV-era on-KO
    Ability requires a decision (Glimmora / Munkidori are a coin flip / a fixed
    condition), so — like the fix-sniper spread demonstrator (slice 4) — a fixture
    proves the machinery until a live card lands with the coverage fan-out. */
const FIX_ONKO: CardProgram = {
  triggered: [
    {
      name: "Last Wish",
      trigger: "onKnockOut",
      optional: true,
      program: [
        { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "hand", max: 1 },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

// ── M4 slice 7: Rare Candy (§7.1) — the Basic→Stage 2 evolve-skip Item. ──

/** Rare Candy — "Choose 1 of your Basic Pokémon in play. If you have a Stage 2
    card in your hand that evolves from that Pokémon, put that card onto the
    Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card
    during your first turn or on a Basic Pokémon that was put into play this
    turn." (Item) — a marker, not a program (see CardProgram.rareCandy). */
const RARE_CANDY: CardProgram = { rareCandy: true };

// ── M5 coverage pass #1 (2026-07-19): the cards across the SV01–03 pool whose
//    printed text maps EXACTLY onto the existing op vocabulary — authored from a
//    classify→verify Workflow fan-out (the 5 authorable of 140; the other 113
//    need new ops, tracked in docs/reference/coverage-backlog.md). ──

/** Poké Ball — "Flip a coin. If heads, search your deck for a Pokémon, reveal it,
    and put it into your hand. Then, shuffle your deck." (Item) — the search AND
    the shuffle are BOTH gated on heads (tails does nothing), so shuffleDeck sits
    INSIDE the gate's `then`, not after it. */
const POKE_BALL: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [
        { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 1, reveal: true },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Pokémon Catcher — "Flip a coin. If heads, switch in 1 of your opponent's
    Benched Pokémon to the Active Spot." (Item — a coin-gated gust). */
const POKEMON_CATCHER: CardProgram = {
  // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
  trainer: [{ op: "coinFlipGate", then: [{ op: "gust" }] }],
};

/** Nemona — "Draw 3 cards." (Supporter) */
const NEMONA: CardProgram = { trainer: [{ op: "drawCards", count: 3 }] };

/** Copperajah ex — "Bronze Body": "This Pokémon takes 30 less damage from
    attacks (after applying Weakness and Resistance)." (passive — the Bouffalant
    "Bouffer" shape, a bigger flat reduction). */
const COPPERAJAH_EX: CardProgram = { passive: { damageReductionAfterWR: 30 } };

/** Stonjourner — "Exoskeleton": "This Pokémon takes 20 less damage from attacks
    (after applying Weakness and Resistance)." (passive) */
const STONJOURNER: CardProgram = { passive: { damageReductionAfterWR: 20 } };

/** Rock Chestplate (sv01-192) — a Pokémon TOOL: "The {F} Pokémon this card is
    attached to takes 30 less damage from attacks from your opponent's Pokémon
    (after applying Weakness and Resistance)." The always-on, HOLDER-TYPE-GATED
    member of the family Bouffalant/Stonjourner/Copperajah ex open and D147
    durated — the gate is resolved inside `passivesOf` against the holder's own
    `Card.types`, so the four §8.5 read sites take no diff at all. */
const ROCK_CHESTPLATE: CardProgram = {
  passive: { damageReductionAfterWRIfType: { amount: 30, type: "Fighting" } },
};

/** Hariyama (sv02-113) — "Arm Thrust Practice": "All of your Pokémon take 10 less
    damage from attacks from your opponent's Pokémon (after applying Weakness and
    Resistance)." The SEAT-WIDE member of the same family: no Active clause on the
    source, no zone clause on the target, self-inclusive, read through the
    dedicated own-side scan `seatDamageReduction` (continuous.ts) because it does
    not modify its holder alone.

    🆕 **D321 — THE UNMARKED PRINT, AND IT IS NOW THE FIELD'S CONTROL RATHER THAN
    ITS ONLY ROW.** Every rider the record gained is ABSENT here because Hariyama
    prints none of the three clauses, so this row is what a bare amount means:
    pays every body on its side, from either spot, and SUMS with a second copy.
    `legal_standard = 0` (rotated), which is why the two printings that DO narrow
    the sentence are the ones the census moves for. */
const HARIYAMA: CardProgram = { passive: { seatDamageReductionAfterWR: { amount: 10 } } };

/** Steven's Carbink (`sv10-086`) — "Stone Palace": "As long as this Pokémon is on
    your Bench, all of your Steven's Pokémon take 30 less damage from attacks from
    your opponent's Pokémon (after applying Weakness and Resistance). The effect of
    Stone Palace doesn't stack." **1 legal printing.**

    THREE of the record's four riders on one sentence, and the interesting one is
    the source-zone gate: this is the first one any member of the aura-scan family
    carries, and it is `isOnBench`'s second customer (D253 built that predicate for
    Poltchageist's HOLDER-zone gate, which is the same printed clause read about
    the same body from the other side of a fold).

    ⚠️ SELF-INCLUSIVE, LIKE HARIYAMA AND FOR A NARROWER REASON: a Steven's Carbink
    IS one of "your Steven's Pokémon", so a benched Carbink shields itself as well
    as its team — which is the board `seatDamageReduction`'s `scope` argument
    exists to split (D151's Feint Attack reading). */
const STONE_PALACE: CardProgram = {
  passive: {
    seatDamageReductionAfterWR: {
      amount: 30,
      beneficiary: { kind: "ownerPokemon", owner: "Steven" },
      sourceOnBench: true,
      noStack: "Stone Palace",
    },
  },
};

/** Bouffalant (`sv07-119`/`svp-136`) — "Curly Wall": "As long as you have at least
    1 other Bouffalant in play, all of your Basic {C} Pokémon take 60 less damage
    from attacks from your opponent's Pokémon (after applying Weakness and
    Resistance). The effect of Curly Wall doesn't stack." **2 legal printings.**

    🛑 **THE TWO RIDERS ARE EACH OTHER'S CONTROL ON ONE BOARD, WHICH IS WHY THIS
    ROW IS WORTH MORE THAN ITS TWO PRINTINGS.** One Bouffalant in play satisfies
    nothing and pays ZERO; a second one makes the antecedent true for BOTH bodies
    at once, so a summing scan would pay 120 and the printed "doesn't stack" caps
    the pair at 60. Neither rider can be checked without the other, and the board
    that separates them is the only board this card is ever played on.

    ⚠️ THE BENEFICIARY IS THE PRINTED "Basic {C} Pokémon" AND COSTS NO NEW FILTER —
    `typedPokemon` has carried its `stage` rider since D238 and admits `"basic"`.
    Bouffalant is itself `types_json = ["Colorless"]` / `stage = "Basic"`, so the
    source is inside its own beneficiary set here too. */
const CURLY_WALL: CardProgram = {
  passive: {
    seatDamageReductionAfterWR: {
      amount: 60,
      beneficiary: { kind: "typedPokemon", pokemonType: "Colorless", stage: "basic" },
      otherNamedInPlay: "Bouffalant",
      noStack: "Curly Wall",
    },
  },
};

// ── D243 — the SEAT-WIDE PRE-W/R DAMAGE AURA (backlog row 14-B(b)), Hariyama's
//    mirror image one step earlier in §8.5 and on the other sign. Three programs,
//    SEVEN legal printings, one `PassiveEffects` field, one seat scan.
//
//    ⚠️ THE ROW'S NAMED HALF IS NOT HERE AND CANNOT BE. 14-B(b) names the SIX
//    `Future` printings ("Attacks used by your Future Pokémon, except any Iron
//    Crown ex, do 20 more damage…") and calls the bare Serperior sentence its
//    cheap entry point, on the expectation that the Future version then becomes a
//    RIDER on this field. It cannot: `beneficiary` is a `CardFilter`, every member
//    of which reads an INGESTED column, and the Ancient/Future banner is printed on
//    the card FACE and appears in NO column (D146, D204/D205, re-verified at D243 —
//    `select distinct suffix … where legal_standard = 1` returns exactly `NULL` and
//    `ex`). The by-name exemption ("except any Iron Crown ex") is expressible today
//    and the SUBGROUP it exempts from is not, so the sentence is blocked on the
//    ingest, not on this field. What replaced it as the rider proof are the two
//    OWNER-PREFIXED groups below, whose subgroup the catalog CAN answer.

/** Serperior ex (`sv10.5b-003`/`-156`/`-164`) — "Regal Cheer": "Attacks used by
    your Pokémon do 20 more damage to your opponent's Active Pokémon (before
    applying Weakness and Resistance)." **3 legal printings**, the BARE member: no
    beneficiary narrowing, no non-stacking clause, nothing but the aura. */
const REGAL_CHEER: CardProgram = { passive: { seatDamageBonusBeforeWR: { amount: 20 } } };

/** Cynthia's Roserade (`sv10-008`/`-184`) — "Cheer On to Glory": "Attacks used by
    your Cynthia's Pokémon do 30 more damage to your opponent's Active Pokémon
    (before applying Weakness and Resistance)." **2 legal printings**, and the
    member that proves the BENEFICIARY seam on a datum the catalog holds: D200's
    `ownerPokemon` filter, matched against the ATTACKER's top card. The source is
    itself a `Cynthia's ` body, which is exactly why the filter must not be applied
    to the source as well — it would pass on every board this pool can build and
    still be the wrong reading. */
const CHEER_ON_TO_GLORY: CardProgram = {
  passive: {
    seatDamageBonusBeforeWR: {
      amount: 30,
      beneficiary: { kind: "ownerPokemon", owner: "Cynthia" },
    },
  },
};

/** Hop's Snorlax (`svp-184`/`sv09-117`) — "Extra Helpings": "Attacks used by your
    Hop's Pokémon do 30 more damage to your opponent's Active Pokémon (before
    applying Weakness and Resistance). **The effect of Extra Helpings doesn't
    stack.**" **2 legal printings**, and the only one in the family whose printed
    text overrides the summing rule. `noStack` carries the printed ABILITY NAME, so
    two Hop's Snorlax on the Bench are 30 and not 60 while a Snorlax standing beside
    a Roserade is still 30 + 30. */
const EXTRA_HELPINGS: CardProgram = {
  passive: {
    seatDamageBonusBeforeWR: {
      amount: 30,
      beneficiary: { kind: "ownerPokemon", owner: "Hop" },
      noStack: "Extra Helpings",
    },
  },
};

// ── D323 — the §8.1 SEAT-WIDE PRIZE BONUS. Two sentences, FOUR legal printings,
//    one new `PassiveEffects` field, one new seat scan, and the SIXTH AND LAST of
//    the six Abilities that print *"doesn't stack"* (D319/D320/D321 built the
//    other five). The two rows are each other's control on every rider the field
//    has: one flips and caps, the other is unconditional and SUMS. ──

/** Togekiss (`sv08-072`) — "Wonder Kiss": "When your opponent's Active Pokémon is
    Knocked Out, flip a coin. If heads, take 1 more Prize card. **The effect of
    Wonder Kiss doesn't stack.**" **1 legal printing.**

    🛑 **THE LAST UNBUILT SIXTH OF THE *"doesn't stack"* ROW, AND THE ONLY ONE OF
    THE SIX THAT IS NEITHER A `passivesOf` FOLD NOR A DAMAGE-AURA SCAN.** The
    registry's own doc-block above (`doesNotStack`) has predicted since D321 that
    this one "is a PRIZE modifier on the §8.1 KO sweep and it is the only one of
    the six whose clause still needs new code". That prediction is now DISCHARGED,
    and it was right about the seam and understated the row — the closure query
    the resume point ordered found a SECOND unbuilt sentence on the same field.

    ⚠️ **THE `koSpot` CLAUSE IS DRIVEN, NOT DECORATIVE.** "your opponent's ACTIVE
    Pokémon" refuses a Bench KO, and a Bench KO is reachable: the Checkup sweep and
    the mid-turn evolve sweep both hand `collectKnockOuts` FULL BOARDS, so a
    `placeSnipe`/`spreadDamage` counter that finishes a benched sitter arrives here
    as a `ref` whose uid is not `players[ref.seat].active`.

    THE STACKING CLAUSE IS A FLIP COUNT, NOT ONLY A PRIZE COUNT — two Togekiss make
    ONE flip, so the row is observable in the rng as well as in the prize pile, and
    a build that capped the prize after flipping twice would drift the rng for
    every later coin in the game. */
const WONDER_KISS: CardProgram = {
  passive: {
    koPrizeBonus: {
      ability: "Wonder Kiss",
      amount: 1,
      koSpot: "active",
      coinFlip: true,
      noStack: true,
    },
  },
};

/** Ludicolo `sv09-037` — "Vibrant Dance": *"All of your Pokémon in play get +40
    HP. The effect of Vibrant Dance doesn't stack."* **1 legal printing**, and the
    **SIXTH AND LAST** of the `doesNotStack` Abilities — the family this file's
    `doesNotStack` doc-block has tracked since D243 is CLOSED by this row.

    🛑 **AND IT IS THE ROW THIS PAGE CALLED BUILT FOR THREE SESSIONS WITHOUT EVER
    BEING BUILT.** D320, D321 and D322 all recorded the family as *"five of the six
    are now built or closed"*; D323 ran `git grep sv09-037 -- packages/` while
    writing a test row that asserted it and got TWO COMMENTS AND NO KEY, then
    pinned `programFor("sv09-037")` UNDEFINED so the claim could not rot again.
    D324 re-ran the same grep — still comments and the pin, nothing else — and
    built it. **The lesson keyed here rather than in a doc bullet: a row listed as
    DONE is a claim about this map, and it costs one `git grep` in either
    direction.**

    THE THREE CLAUSES, EACH REFUSED SEPARATELY BY `seatMaxHpBonus` (continuous.ts):
      • *"All of your Pokémon in play"* — SEAT-WIDE membership, Active and Bench,
        and the source is INSIDE the set (a lone Ludicolo is at printed + 40). That
        is why the scan takes no `othersOnly` scope: Feint Attack's exclusion,
        copied here, would under-pay the only board this card is played on;
      • *"get +40 HP"* — `amount`, summed into `effectiveMaxHp`, which is the
        single read site the KO check, the HUD, the evolve-below-HP window and the
        `koSurvivalClamp` all already go through;
      • *"The effect of Vibrant Dance doesn't stack."* — `noStack`, on a
        largest-wins ledger keyed by `ability`. Two Ludicolo give +40, not +80; a
        Ludicolo beside a differently-named non-stacking HP aura would give both.

    ⚠️ **IT IS AN ABILITY, SO §9 SWITCHES IT OFF — AND THAT IS OBSERVABLE ON A
    BOARD NO OTHER FIELD IN THIS FAMILY REACHES.** A Klefki lock over the Ludicolo
    takes +40 off EVERY body on its side at once, and a teammate already damaged
    into the 40 is Knocked Out for it by the §8.1 sweep. Compare
    `StadiumEffects.hpDelta`, which sums into the same number at the same read site
    and is immune to the same lock because a Stadium is not an Ability. */
const VIBRANT_DANCE: CardProgram = {
  passive: { seatHpBonus: { ability: "Vibrant Dance", amount: 40, noStack: true } },
};

/** Hydreigon ex (`sv10.5w-067`/`-161`/`-169`) — "Greedy Eater": "If your
    opponent's **Basic** Pokémon is Knocked Out **by damage from an attack used by
    this Pokémon**, take 1 more Prize card." **3 legal printings.**

    🆕 **THE SENTENCE THE HANDOFF NEVER NAMED, AND THE CLOSURE QUERY IS WHY IT IS
    HERE.** D322's rule — a count is a closure proof only when the WIDER query
    returns the same set — applied to a row priced off `'oesn''t stack'`: the bare
    noun `'more Prize'` returns 4 legal printings, of which Togekiss is ONE. This
    card prints no stacking clause, so two Hydreigon ex that both attacked… cannot
    both have attacked, which is the point below.

    🛑 **`byThisPokemonsAttack` IS WHY THIS ROW IS NOT `attackerSeat` AGAIN.**
    Munkidori ex's D164 antecedent is "by an attack from your opponent's Pokémon" —
    a SEAT question, and `attackerSeat` is exactly its answer. "an attack used by
    THIS Pokémon" names the attacking BODY, so it needs the attacker's uid, which
    `finishAttack` has had in hand since D42 and never passed on. The Checkup and
    mid-turn paths omit it exactly as they omit `attackerSeat`, and the clause is
    refused there — so a Hydreigon ex whose opponent's Basic dies to poison at the
    Checkup takes NO extra prize, which is what the print says.

    ⚠️ **THE `koTarget` FILTER IS ON THE DYING BODY AND ON NOTHING ELSE.** A
    Hydreigon ex is itself a Stage 2, so a build that matched the filter against the
    HOLDER would pay ZERO on every board this pool can make and would look like a
    working card that simply never triggers — the GREEN-AND-DEAD shape D310/D314/
    D318 each paid for once. */
const GREEDY_EATER: CardProgram = {
  passive: {
    koPrizeBonus: {
      ability: "Greedy Eater",
      amount: 1,
      koTarget: { kind: "basicPokemon" },
      byThisPokemonsAttack: true,
    },
  },
};

// ── D245: the aura family's three DEFERRED singles (backlog row 14-B(b)-R), and
//    the fourth printing of the field one of them widens. Three sentences, three
//    different narrowings, and each names a different piece — which is why they
//    were a residue rather than three more rows on D243's table. ──

/** Lilligant `sv09-007` — "Sunny Day": "Attacks used by your **{G} Pokémon and
    {R} Pokémon** do 20 more damage to your opponent's Active Pokémon (before
    applying Weakness and Resistance)." **1 legal printing**, and the only card in
    the Standard pool that spells a filter DISJUNCTION on this seam.

    The narrowing is `beneficiary` at D245's new `anyOf` combinator, over two
    `typedPokemon` filters. ⚠️ **THE SOURCE IS ITSELF A `{G}` BODY**, which is
    `CHEER_ON_TO_GLORY`'s trap one member up: a scan that applied the beneficiary
    filter to the SOURCE as well would pass on every board this pool can build and
    still encode the wrong sentence. The scan matches `attackerCard` alone.

    🛑 **AND THE PRINTED "and" IS AN "or" IN THE PREDICATE.** See `CardFilter`'s
    `anyOf` doc: a `{G}`-only Lilligant attacking gets the 20, and an intersection
    reading would pay only dual-type Grass/Fire bodies, of which the legal pool
    holds NONE — the aura would be a sentence that pays nobody. */
const SUNNY_DAY: CardProgram = {
  passive: {
    seatDamageBonusBeforeWR: {
      amount: 20,
      beneficiary: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Grass" },
          { kind: "typedPokemon", pokemonType: "Fire" },
        ],
      },
    },
  },
};

/** Victini `sv08-021` — "Victory Cheer": "Attacks used by your **Evolution {R}**
    Pokémon do 10 more damage to your opponent's Active Pokémon (before applying
    Weakness and Resistance)." **1 legal printing.**

    The narrowing is `typedPokemon` at BOTH its axes, and the `stage: "evolution"`
    half is the value D238 measured as unprinted and D245 measured as printed —
    2 sentences, 4 legal printings (`METALLIC_SIGNAL` below is the other 3).

    ⚠️ **VICTINI IS A BASIC, SO IT NEVER PAYS ITSELF**, which makes this the one
    aura in the family whose source is provably outside its own beneficiary set —
    the board `CHEER_ON_TO_GLORY` cannot build and the separating fixture the
    `anyOf`/`beneficiary` split has wanted since D243. */
const VICTORY_CHEER: CardProgram = {
  passive: {
    seatDamageBonusBeforeWR: {
      amount: 10,
      beneficiary: { kind: "typedPokemon", pokemonType: "Fire", stage: "evolution" },
    },
  },
};

/** Carracosta `sv07-038` — "Primal Knowledge": "Attacks used by your Pokémon do
    30 more damage to your opponent's **Active Evolution** Pokémon (before applying
    Weakness and Resistance)." **1 legal printing.**

    The family's first TARGET-side narrowing — `target`, not `beneficiary` — and
    the filter is `evolutionPokemon`, which has existed since Jacq. See the field's
    doc-comment for why the backlog row's `damageBonusBeforeWRIfTarget` is the
    wrong seam: that one is folded by `passivesOf(attacker)` and this sentence's
    source need not be attacking at all. */
const PRIMAL_KNOWLEDGE: CardProgram = {
  passive: {
    seatDamageBonusBeforeWR: {
      amount: 30,
      target: { kind: "evolutionPokemon" },
    },
  },
};

/** Genesect ex `sv10.5b-067`/`-161`/`-169` — "Metallic Signal": "Once during your
    turn, you may search your deck for up to 2 **Evolution {M}** Pokémon, reveal
    them, and put them into your hand. Then, shuffle your deck." **3 legal
    printings**, byte-identical on all three (remote D1 `luminous`, 2026-08-06).

    🆕 **NOT AN AURA, AND IT IS HERE BECAUSE THE FIELD IS, NOT BECAUSE THE ROW
    WAS.** Backlog row 14-B(b)-R names ONE printing needing `typedPokemon.stage`
    to admit `"evolution"`; running that widening's own query over the printed
    IDIOM rather than the row's id returns **2 sentences / 4 printings**, and the
    backlog page names only one of them. **A ROW IS A SET OF IDS AND A FIELD IS A
    SET OF SENTENCES** (D244's lesson, second outing) — building the field and not
    these would leave three printings unbuilt on a widening that already serves
    them.

    🛑 **AND THIS SENTENCE *WAS* NAMED, ON A DIFFERENT PAGE, AND ITS `needs` HAS
    BEEN SATISFIABLE SINCE D238.** D199 filed it in `legalNonAttackPrograms.test.ts`'s
    `DROPPED` list needing *"a POKÉMON-TYPE refinement on the Pokémon `CardFilter`
    kinds"* — which is `typedPokemon`, built at D238, **seven decisions ago**. What
    D238 left behind was one VALUE of one rider (`stage: "evolution"`), and because
    the `DROPPED` row priced the TYPE axis and not the STAGE axis, nothing went red
    when the type axis landed. 🆕 **A `needs` STRING GOES STALE SILENTLY WHEN THE
    PIECE IT NAMES IS BUILT AT A DIFFERENT GRAIN THAN THE SENTENCE NEEDS** — the
    Lacey shape (D207) with the failure mode inverted: that row named a piece that
    already existed, this one named a piece that then got built and still did not
    unblock the card. **The backlog page and the `DROPPED` list disagreed about the
    same three ids for seven decisions and neither could see the other.**

    ZERO new engine code beyond the `stage` value: it is `JACQ`'s program with a
    type on the filter and an ABILITY wrapper — "Once during your turn" →
    `oncePerTurn`, no "in the Active Spot" clause → `activeOnly: false`, "up to 2"
    → `max: 2` on a park whose own `min: 0` is what makes "up to" mean up to,
    "reveal them" → `reveal: true` (D225's `DECK_SEARCHED` log rider), and the
    trailing `shuffleDeck` that runs on the whiff and the decline alike. */
const METALLIC_SIGNAL: CardProgram = {
  abilities: [
    {
      name: "Metallic Signal",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "searchDeck",
          filter: { kind: "typedPokemon", pokemonType: "Metal", stage: "evolution" },
          dest: "hand",
          max: 2,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

// ── M5 op-slice: attachEnergyFrom (§6 energy acceleration) — the top backlog
//    unlock; this slice covers the clean single-attach-from-hand core, the
//    discard/deck/multi/rider variants layer later ops on top. ──

/** Quaquaval — "Energy Carnival": "Once during your turn, you may attach a Basic
    Energy card from your hand to 1 of your Pokémon." (activated, once/turn) */
const QUAQUAVAL: CardProgram = {
  abilities: [
    {
      name: "Energy Carnival",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "hand" }],
    },
  ],
};

/** Baxcalibur — "Super Cold": "As often as you like during your turn, you may
    attach a Basic {W} Energy card from your hand to 1 of your Pokémon."
    (activated, REPEATABLE → oncePerTurn:false, so it never locks out). */
const BAXCALIBUR: CardProgram = {
  abilities: [
    {
      name: "Super Cold",
      oncePerTurn: false,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "hand", energyType: "Water" }],
    },
  ],
};

/** FIXTURE (id fix-attacher): the DISCARD-source + type-filter branch of
    attachEnergyFrom (attach a Basic Fire Energy from the discard pile to a chosen
    Pokémon). The clean real discard-attach card without extra riders; Koraidon
    "Dino Cry" (multi + "your turn ends") still needs later ops. */
const FIX_ATTACHER: CardProgram = {
  abilities: [
    {
      name: "Recharge",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "discard", energyType: "Fire" }],
    },
  ],
};

/** Koraidon ex — "Dino Cry": "Once during your turn, you may attach up to 2 Basic
    {F} Energy cards from your discard pile to your Basic {F} Pokémon in any way
    you like. If you use this Ability, your turn ends." — MULTI-attach (up to 2) is
    two attachEnergyFrom ops in a row (each parks on its own Basic {F} target), and
    `endsTurn` folds the turn end. once/turn, not Active-only.

    🆕🛑 **D360 — `declinable` ON BOTH OPS, AND THIS ROW IS WHY THE FAMILY DID NOT
    CLOSE WHEN THREE SLICES SAID IT WOULD.** This doc used to end *"the second
    no-ops if a single {F} was in the discard"*, which is the whole defect written
    down as if it were the design: the engine spent the printed *"up to"* against
    what was AVAILABLE and never against what the player WANTED. On a full discard
    pile the second op forced, so *"up to 2"* resolved as an exact 2 and the
    printed middle answer — attach ONE, keep the other {F} in the pile for
    Gardevoir ex — was unreachable.

    🛑 **AND IT IS THE SECOND PRODUCER OF ONE SENTENCE, WHICH IS THE ONLY REASON
    IT SURVIVED D358 AND D359 BOTH.** `attachFromZoneProgram` builds the identical
    spread for three DERIVED sentences and cites THIS ROW by name as the shape it
    copies (*"Koraidon ex 'Dino Cry''s authored shape, verbatim"*), so flagging the
    deriver and not this row would leave the engine's two producers DISAGREEING
    about what one printed sentence means. D358 measured this row and excluded it
    for `legal_standard = 0` (`attachDecline.test.ts` §0's population note says so
    in as many words) — **a defensible filter for a POPULATION figure and the wrong
    one for a CONSISTENCY invariant.** Rotation decides who may play a card; it
    does not decide what the card says, and `programFor` is not legality-gated.

    ⚠️ **THE FLAG IS PER OP** (`attachDecline.test.ts` §1): a row flagging only its
    first op would let the player stop BEFORE the first card and never BETWEEN the
    two, which is not what *"up to"* says.
    ⚠️ **AND IT BREAKS THE OTHER WAY FROM THE DERIVED THREE.** This is an ABILITY
    with `oncePerTurn` and a printed *"you may"*, so declining the Ability already
    bought the zero: it reached {0, 2} against a printed {0, 1, 2}. The three
    derived printings are ATTACKS — declared and resolved, no `optional` anywhere —
    so they reached **{2} alone**. D359 found the same split one axis over; the
    halves of this family have now been broken differently TWICE. */
const KORAIDON_EX: CardProgram = {
  abilities: [
    {
      name: "Dino Cry",
      oncePerTurn: true,
      activeOnly: false,
      endsTurn: true,
      program: [
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: "Fighting",
          targetType: "Fighting",
          basicOnly: true,
          declinable: true,
        },
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: "Fighting",
          targetType: "Fighting",
          basicOnly: true,
          declinable: true,
        },
      ],
    },
  ],
};

/** Gardevoir ex — "Psychic Embrace": "As often as you like during your turn, you
    may attach a Basic {P} Energy card from your discard pile to 1 of your {P}
    Pokémon. If you attached Energy to a Pokémon in this way, put 2 damage counters
    on that Pokémon. You can't use this Ability on a Pokémon that would be Knocked
    Out." — the attachEnergyFrom RIDERS: discard source + {P} energy + {P}-only
    targets + 20 HP (2 counters) + the not-would-be-KO'd guard; REPEATABLE. */
const GARDEVOIR_EX: CardProgram = {
  abilities: [
    {
      name: "Psychic Embrace",
      oncePerTurn: false,
      activeOnly: false,
      program: [
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: "Psychic",
          targetType: "Psychic",
          bonusCounters: 20,
          notIfKO: true,
        },
      ],
    },
  ],
};

/** Blissey sv01-145 — "Busybody Nurse": "Once during your turn, you may use this
    Ability. Your Active Pokémon recovers from all Special Conditions." (D177)

    The ABILITY half of the `clearStatus` family; Gardevoir ex's "Miracle Force"
    (sv01-086 / -228 / -245) is the ATTACK half and needs no row here — its whole
    printed effect is one anchored sentence, so effects.ts derives it and all three
    printings ride one arm. Two entry points, ONE op, D169's ± pair shape.

    ⚠️ `activeOnly: false`, AND IT IS A READING OF THE PRINT RATHER THAN A DEFAULT.
    The sentence says "YOUR ACTIVE Pokémon", not "this Pokémon" — the SUBJECT of
    the recovery and the BEARER of the Ability are two different bodies, exactly as
    Exp. Share's are (D171). So a BENCHED Blissey heals the Active in front of it,
    which is the whole point of the card, and an `activeOnly` here would have
    silently required Blissey to be the very body it is meant to nurse. The card
    prints no "if this Pokémon is in the Active Spot" clause; Chien-Pao and
    Trevenant do, and that is the difference the field exists to carry.

    `oncePerTurn: true` — the printed "Once during your turn", tracked per Pokémon
    in `TurnAllowances`, so two Blisseys are two uses (the allowance key is
    `uid:name`). Not "as often as you like" (Gardevoir/Baxcalibur's `false`).

    ⚠️ NOT GATED BY `programPlayable`, which is a DOCTRINE CALL and not an omission.
    `useAbility` refuses a program that could only whiff, and "your Active carries
    no Special Condition" is a public board fact of exactly the Crushing
    Hammer/Catcher shape. It is deliberately NOT added: the engine's nearest
    precedent is `healChosen`, whose own doc block refuses to filter to DAMAGED
    bodies because "the printed sentence carries no damaged restriction, so
    filtering would be a rule the card does not print" (the Potion doctrine). The
    same sentence-level argument holds here — this card names no precondition — and
    the op resolves SILENTLY on a clean body, so a use that recovers nothing costs
    the player their once-per-turn and nothing else. Widening the whiff gate to a
    third op is the kind of rule that should arrive with a printing that needs it. */
const BLISSEY: CardProgram = {
  abilities: [
    {
      name: "Busybody Nurse",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "clearStatus" }],
    },
  ],
};

// ── M5 op-slice: discardPileRetrieval (§7.1 recovery Items) — the discard-pile
//    mirror of searchDeck; the next-biggest new-op unlock after attachEnergyFrom.
//    (verified vs the local catalog 2026-07-20). ──

/** Energy Retrieval — "Put up to 2 Basic Energy cards from your discard pile
    into your hand." (Item) — a single retrieval to hand, no shuffle. */
const ENERGY_RETRIEVAL: CardProgram = {
  trainer: [{ op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 2 }],
};

/** Pal Pad — "Shuffle up to 2 Supporter cards from your discard pile into your
    deck." (Item) — retrieve to deck, then shuffle (the Nest Ball
    search-then-shuffle pattern; a whiff still shuffles, like a whiffed search). */
const PAL_PAD: CardProgram = {
  trainer: [
    { op: "discardPileRetrieval", filter: { kind: "supporter" }, dest: "deck", max: 2 },
    { op: "shuffleDeck" },
  ],
};

/** Super Rod — "Shuffle up to 3 in any combination of Pokémon and Basic Energy
    cards from your discard pile into your deck." (Item) — the pokemonOrBasicEnergy
    filter is the "any combination" (each pick is independently a Pokémon or a
    Basic Energy); retrieve to deck, then shuffle. */
const SUPER_ROD: CardProgram = {
  trainer: [
    { op: "discardPileRetrieval", filter: { kind: "pokemonOrBasicEnergy" }, dest: "deck", max: 3 },
    { op: "shuffleDeck" },
  ],
};

// ── M5 op-slice: §9.2 op→op data flow — the clause that refers back to what an
//    earlier clause of the SAME card actually did. Three printed wordings, one
//    running record: Miriam's "in this way", Superior Energy Retrieval's "with
//    the effect of this card", Dendra's "if you do" (above).
//    (verified vs the local catalog 2026-07-22). ──

/** Miriam (sv01-179/-238/-251) — "Shuffle up to 5 Pokémon from your discard pile
    into your deck. If you shuffled any cards into your deck in this way, draw 3
    cards." (Supporter)

    The card that makes the record a NAMED SLOT rather than "the previous op's
    result", and it does so with its own middle op. Miriam prints TWO ADJACENT
    sentences — the gap is the ENGINE's, because "shuffle up to 5 Pokémon … into
    your deck" is authored as a move to the deck plus a trailing `shuffleDeck`
    (the Pal Pad / Super Rod pattern), which puts the op the "in this way" clause
    is about TWO ops upstream. That decomposition is not incidental: the shuffle
    has to run before the draw, or the returned Pokémon sit at the BOTTOM of the
    deck in the order they were picked — precisely what the printed word
    "shuffle" denies. Janine's Secret Art (sv06.5-059, unauthored) prints the
    non-adjacency outright ("Then, shuffle your deck. If you attached Energy … in
    this way, …"), so positional reading fails at the print level too.

    The retrieval is "up to", so declining it is legal and records nothing — and
    then the gate is FALSE and the card draws nothing at all. That is the whole
    point of the printed conditional: a player who wants only the shuffle cannot
    also have the 3 cards.

    NOT gated by `programPlayable` (an empty discard pile), for the reason
    `attachFromTop` established: the trailing `shuffleDeck` always resolves, so
    "no Pokémon to shuffle back" is never "no effect" — and it is the same
    already-shipped call as Pal Pad and Super Rod into a discard holding nothing
    they match.

    THAT PRECEDENT IS WEAKER HERE THAN IT LOOKS, and the review was right to say
    so: Pal Pad and Super Rod are ITEMS, where a whiff costs one card, and Miriam
    is the first SUPPORTER on this op, where a whiff costs the turn's only
    Supporter play (§7.2). The doctrine is about EFFECT, not price — ruling/284
    asks whether the game state prevents any effect, and a deck shuffle is one
    players deliberately buy — so the call stands. But the cost of being wrong
    just went up, and the honest mitigation is the PROMPT rather than the gate:
    the note now states the draw the answer buys, so a player declining into
    nothing is doing it knowingly (interpreter.ts `withConsequence`). */
const MIRIAM: CardProgram = {
  trainer: [
    {
      op: "discardPileRetrieval",
      filter: { kind: "anyPokemon" },
      dest: "deck",
      max: 5,
      recordAs: "moved",
    },
    { op: "shuffleDeck" },
    {
      op: "recordGate",
      slot: "moved",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [{ op: "drawCards", count: 3 }],
    },
  ],
};

/** Ortega (sv03-190/-219) — "Your opponent reveals their hand, and you choose a
    card you find there and put it on the bottom of their deck. If you put a
    card on the bottom of your opponent's deck in this way, your opponent may
    draw a card."

    The Miriam shape verbatim — a recording op, then a plain recordGate on its
    slot — with both halves on the OTHER side of the table: the pick reads a
    zone the controller does not own (revealed by the op), and the gated draw
    is answered by a seat that did not make the play (the phase's `answerer`,
    this card's whole reason to exist). Ungated by any printed rule; the
    would-only-whiff gate (an empty opponent hand — public via the count) is
    programPlayable's, not this card's text. The attack twin of the first
    sentence (Greavard "Underworld Stroll", a Supporter-filtered pick with no
    second sentence) is DERIVED, not authored — see deriveAttackEffect. */
const ORTEGA: CardProgram = {
  trainer: [
    { op: "bottomFromOpponentHand", recordAs: "moved" },
    {
      op: "recordGate",
      slot: "moved",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [{ op: "opponentMayDraw", count: 1 }],
    },
  ],
};

/** Superior Energy Retrieval (sv02-189/-277) — "You can use this card only if
    you discard 2 other cards from your hand. / Put up to 4 Basic Energy cards
    from your discard pile into your hand. (You can't choose a card you discarded
    with the effect of this card.)" (Item)

    The `payFromHand` family's last row, and the one card whose two ops touch the
    SAME pile in sequence: the cost pays INTO the discard, and the retrieval then
    reads it. Without the exclusion a player pays two Basic Energy and takes the
    same two back — the cost self-refunds, the card becomes a strict +2, and the
    parenthetical the printer added precisely to stop it means nothing. So this
    is not a cosmetic filter; it is the only thing making the cost a cost.

    Note what is NOT excluded: Basic Energy already in the discard before the
    play, and the OTHER kind of card paid (paying a Pokémon and an Energy bars
    only the Energy from the offer, since the Pokémon was never a candidate).
    The record is uid-keyed, so a second copy of the very same printed Energy
    sitting in the pile stays takeable — correct, and the reason the record
    carries uids rather than card ids.

    UNGATED, like the rest of the family, and here the `attachFromTop` argument
    does NOT apply — there is no trailing shuffle, so SER into a discard with no
    Basic Energy really does spend 2 cards for nothing. It matches shipped Energy
    Retrieval (sv01-171: same `dest: "hand"`, no shuffle, ungated), so this is the
    family's standing doctrine question rather than a call this card makes; the
    prompt is the mitigation again, since the cost's dialog names what it buys the
    moment the retrieval offer is empty (it resolves with no second park at all). */
const SUPERIOR_ENERGY_RETRIEVAL: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 2, to: "discard", recordAs: "paid" },
    {
      op: "discardPileRetrieval",
      filter: { kind: "basicEnergy" },
      dest: "hand",
      max: 4,
      exclude: "paid",
    },
  ],
};

// ── M5 op-slice: lookAtTopN (§15.E deck-top look) — the top-of-deck twin of
//    searchDeck; candidates are only the top-N matches, then shuffle. The clean
//    "reveal → hand" cards land now; the from-the-top ATTACH variants (Electric
//    Generator, Hydreigon) layer a later op. (verified vs the local catalog
//    2026-07-20). ──

/** Great Ball — "Look at the top 7 cards of your deck. You may reveal a Pokémon
    you find there and put it into your hand. Shuffle the other cards back into
    your deck." (Item) — lookAtTopN then the trailing shuffle (the Nest Ball
    search-then-shuffle pattern; a whiff still shuffles). */
const GREAT_BALL: CardProgram = {
  trainer: [
    { op: "lookAtTopN", n: 7, filter: { kind: "anyPokemon" }, max: 1, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** Pokégear 3.0 — "Look at the top 7 cards of your deck. You may reveal a
    Supporter card you find there and put it into your hand. Shuffle the other
    cards back into your deck." (Item) — the `supporter` filter (added with
    Pal Pad) narrows Great Ball's shape to Supporters. */
const POKEGEAR: CardProgram = {
  trainer: [
    { op: "lookAtTopN", n: 7, filter: { kind: "supporter" }, max: 1, reveal: true },
    { op: "shuffleDeck" },
  ],
};

// ── M5 op-slice: attachFromTop (§15.E + §6) — the from-the-top ATTACH variant
//    the lookAtTopN slice deferred: look at the deck top and attach the Energy
//    you find there onto your own Pokémon, "in any way you like". Two consumers,
//    an Item and an activated Ability, differing in every rider the op has.
//    (verified vs the local catalog 2026-07-21). ──

/** Electric Generator — "Look at the top 5 cards of your deck and attach up to 2
    Basic {L} Energy cards you find there to your Benched {L} Pokémon in any way
    you like. Shuffle the other cards back into your deck." (Item)

    `basicEnergy` + `energyType`, NOT `providesEnergy`: the printed noun is "Basic
    {L} Energy CARDS", and these cards are sitting in the DECK, attached to
    nothing. Provision is a while-attached property (§6.5), so there is nothing to
    read here but the PRINT — the Decidueye rule from the other side, and the one
    filter choice this card could get wrong. (Authoring `providesEnergy` here
    would be a loud no-op, never a wrong card: `matchesFilter` answers false for
    it — see fix-pilescan.)

    Two target riders off one printed phrase, "your **Benched** **{L}** Pokémon":
    `benchOnly` (the Active is not a target, which is the card's whole point —
    it reaches the Bench, where the turn's one manual attach usually cannot go)
    and `targetType: "Lightning"`. The leftovers are the trailing `shuffleDeck`
    op — they never left the deck, so a whiff still shuffles, exactly as a whiffed
    search does (the Nest Ball pattern). */
const ELECTRIC_GENERATOR: CardProgram = {
  trainer: [
    {
      op: "attachFromTop",
      n: 5,
      filter: { kind: "basicEnergy", energyType: "Lightning" },
      max: 2,
      targetType: "Lightning",
      benchOnly: true,
    },
    { op: "shuffleDeck" },
  ],
};

/** Hydreigon — "Tri Howl": "Once during your turn, you may look at the top 3
    cards of your deck and attach any number of Energy cards you find there to
    your Pokémon in any way you like. Discard the other cards."

    The op's other three settings, each straight off the printed words:
    - "Once during your turn" → `oncePerTurn`, and "you may" is the op's own
      decline (attaching none is a legal answer to the park);
    - "any number of **Energy cards**" → `max: "any"` with the `anyEnergy` filter,
      so a Special Energy up there is attachable too — unlike Electric Generator,
      which prints "Basic {L}";
    - "to **your Pokémon**" → no target rider at all: the Active is a target, and
      so is every benched one;
    - "**Discard** the other cards" → `restTo: "discard"` (🆕 D352 — was
      `discardRest: true`; the boolean became the two-valued leftovers DESTINATION
      the day Metang's "shuffle them to the bottom" landed on the same op, which is
      the widening `effects.ts` priced in advance at D335). That clause is the
      card's real cost, and it is charged on every path — including a whiffed look
      and a declined attach — which is exactly why it lives on the op rather than in
      a trailing op the way Electric Generator's shuffle does.

    The text never says "if this Pokémon is in the Active Spot", so
    `activeOnly: false` (§9 — Abilities work from the Bench unless the card says
    otherwise). */
const HYDREIGON: CardProgram = {
  abilities: [
    {
      name: "Tri Howl",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "attachFromTop",
          n: 3,
          filter: { kind: "anyEnergy" },
          max: "any",
          // 🆕 D352 — was `discardRest: true`; the same rename `lookAtTopN` took at D335.
          restTo: "discard",
        },
      ],
    },
  ],
};

// ── M5 op-slice: moveEnergy (§6 manual Energy movement) — move Energy between
//    your own Pokémon. The clean own→own Trainers land now; the fixed-endpoint
//    ({R} benched→Active, Armarouge) / opponent-side (Mismagius) / on-KO Tool
//    (Exp. Share) riders layer later ops. (verified vs the local catalog
//    2026-07-20). ──

/** Energy Switch — "Move a Basic Energy from 1 of your Pokémon to another of
    your Pokémon." (Item) — a single Basic Energy, own → own. */
const ENERGY_SWITCH: CardProgram = {
  trainer: [{ op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1 }],
};

/** Poppy — "Move up to 2 Energy from 1 of your Pokémon to another of your
    Pokémon." (Supporter) — up to 2 ANY Energy (Basic or Special → the anyEnergy
    filter), both off the SAME source Pokémon, own → own. */
const POPPY: CardProgram = {
  trainer: [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 2 }],
};

/** N's Plan — "Move up to 2 Energy from your Benched Pokémon to your Active
    Pokémon." (Supporter, `sv10.5b-083`/`-163`/`-170`, regulation mark I, all
    three `legal_standard = 1` and byte-identical — remote D1 `luminous`,
    2026-08-05). D190's LAST `DROPPED` work order, collected at D226.

    Poppy with two words changed, and both changes are fields:
    - `route: "benchToActive"` — the endpoints are PRINTED here ("from your
      Benched Pokémon to your Active Pokémon") rather than chosen, which is
      Armarouge's route exactly;
    - `anySource: true` — the printed noun is PLURAL. Every other member of this
      family says "from **1 of** your Pokémon", and `cardplay.ts` enforced that
      verbatim, so without the rider a player answering with one Energy off each
      of two benched bodies — the ordinary use of this card — is REFUSED at the
      wire. That is the *EXACT MAP OR FLAG* case: authoring the route alone would
      have shipped a silent NARROWING of a printed rule, which is why D190 dropped
      the row rather than approximate it.

    ⚠️ AND NOT `max: 2` ALONE. Armarouge's single-source coupling is invisible at
    `max: 1` (one pick has one source however the rule reads), so the coupling had
    never been exercised by a printed card that could violate it until this one. */
const NS_PLAN: CardProgram = {
  trainer: [
    {
      op: "moveEnergy",
      filter: { kind: "anyEnergy" },
      max: 2,
      route: "benchToActive",
      anySource: true,
    },
  ],
};

// ── M5 op-slice: the providesEnergy filter — "an Energy that PROVIDES {X}".
//    Its second consumer (the first is the typed self-discard family, which is
//    DERIVED and so has no rows here): the moveEnergy fixed-endpoint route the
//    row above deferred. (verified vs the local catalog 2026-07-21). ──

/** fix-blend — FIXTURE Special Energy, no printed card in the sv01–03 pool: one
    that provides TWO DISTINCT concrete types ({R} and {W}), the multi-unit shape
    `EnergyProgram.provides: string[]` has always promised and no authored card
    has ever exercised. Both authored Special Energies today are single-valued
    (Jet `["Colorless"]`, Luminous `[ANY_ENERGY]`), so without this the
    `providesEnergy` predicate's "is this type among the units" would be
    indistinguishable from "is it the FIRST unit" — a distinction that only starts
    to matter with a Blend/Reversal-style print, and one nobody would notice
    breaking. */
const FIX_BLEND: CardProgram = {
  energy: { provides: ["Fire", "Water"] },
};

/** 🆕 D391 — fix-grassdouble — FIXTURE Special Energy providing the SAME concrete
    type TWICE ({G}{G}). `FIX_BLEND` above is this shape on the other axis (two
    DISTINCT types), and the two are not interchangeable: a `{G}` question asked of a
    blend gets the same answer from a CARD count and a UNIT count, because the blend
    contributes one of each. This row is the one board where those two readings
    disagree — one card, two units — and `countAttachedEnergy` answers **1**, because
    "one Energy card is one Energy however many units it provides" (continuous.ts).

    The pool prints no such card: every multi-unit Special in it is Colorless (Double
    Turbo, Jet) or a wildcard (Luminous, Legacy), so the duplicate-type shape
    `EnergyProgram.provides: string[]` allows has never been exercised. `providedEnergy`
    is a `flatMap`, so the duplicate SURVIVES and a units reading really would see two —
    which is what makes `typedEnergyThreshold.test.ts` §4 a measurement rather than an
    assertion about a shape nothing can build. */
const FIX_GRASSDOUBLE: CardProgram = {
  energy: { provides: ["Grass", "Grass"] },
};

/** fix-pilescan — FIXTURE Item, no printed card and none imaginable: a
    `providesEnergy` filter handed to a DECK search, which is the one authoring
    mistake this filter invites. Provision is a while-attached property, so a card
    sitting in a deck provides nothing and matches nothing — the search finds no
    candidates and the play is a loud no-op rather than a quiet grab of "a Basic
    Fire Energy card", which is what guessing here would have taken. Pinned by a
    fixture because a REGISTRY row is the only way to author it (the deriver never
    emits this pairing), and an unpinned safety property is one refactor from
    silently becoming a wrong match. */
const FIX_PILESCAN: CardProgram = {
  trainer: [
    {
      op: "searchDeck",
      filter: { kind: "providesEnergy", energyType: "Fire" },
      dest: "hand",
      max: 1,
    },
    { op: "shuffleDeck" },
  ],
};

/** Armarouge — "Fire Off": "As often as you like during your turn, you may move
    a {R} Energy from 1 of your Benched Pokémon to your Active Pokémon."

    THREE readings the flags encode, each from the printed words:
    - "As often as you like" → NOT `oncePerTurn`, so the allowance is never
      stamped and the Ability may be used again and again in one turn (each use
      moves one Energy: `max: 1`);
    - the text never says "if this Pokémon is in the Active Spot", so
      `activeOnly: false` — Abilities work from the Bench unless the card says
      otherwise (§9), and this one names its endpoints outright rather than
      saying "this Pokémon", so a benched Armarouge moving its OWN {R} to the
      Active is a legal and correct use (the EffectContext-has-no-source-uid gap
      simply does not apply here);
    - "a {R} Energy" is `providesEnergy`, not a Basic Fire print: a Luminous
      Energy on the Bench provides every type and so IS a {R} Energy to move —
      until another Special Energy beside it demotes it to {C}. */
const ARMAROUGE: CardProgram = {
  abilities: [
    {
      name: "Fire Off",
      oncePerTurn: false,
      activeOnly: false,
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "providesEnergy", energyType: "Fire" },
          max: 1,
          route: "benchToActive",
        },
      ],
    },
  ],
};

// ── M5 op-slice: handRefresh (the Iono/Judge hand-refresh Supporter family) —
//    put your hand back into your deck, then draw. The reshuffle-and-draw
//    Supporters landed first; Iono (the bottom-of-deck placement + the
//    prize-count draw + the any-moved draw gate) closes the family — the SV-era
//    catalog holds no Marnie. (verified vs the local catalog 2026-07-20/21). ──

/** Youngster — "Shuffle your hand into your deck. Then, draw 5 cards."
    (Supporter) — the self-only fixed refresh. */
const YOUNGSTER: CardProgram = {
  trainer: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 5 } }],
};

/** Judge — "Each player shuffles their hand into their deck and draws 4 cards."
    (Supporter) — the both-player refresh (the first op to reach the OPPONENT's
    hand/deck; count-only events keep every shuffled/drawn card hidden). */
const JUDGE: CardProgram = {
  trainer: [{ op: "handRefresh", who: "both", draw: { kind: "fixed", count: 4 } }],
};

/** Brassius — "Count the cards in your hand, shuffle those cards into your deck,
    then draw that many cards plus 1." (Supporter) — handPlus draws the PRE-shuffle
    hand size + 1 (net +1 card, reshuffled). */
const BRASSIUS: CardProgram = {
  trainer: [{ op: "handRefresh", who: "you", draw: { kind: "handPlus", delta: 1 } }],
};

/** Katy — "Shuffle your hand into your deck. Then, draw 8 cards. Your turn ends."
    (Supporter) — the fixed refresh + the `trainerEndsTurn` fold (the Koraidon
    `endsTurn` precedent, now on the Trainer path). */
const KATY: CardProgram = {
  trainer: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
  trainerEndsTurn: true,
};

/** Iono — "Each player shuffles their hand and puts it on the bottom of their
    deck. If either player put any cards on the bottom of their deck in this way,
    each player draws a card for each of their remaining Prize cards." (Supporter)
    — the both-player refresh that leaves BOTH decks' order intact (`toBottom`),
    draws by each player's own remaining Prizes (`prizeCount` — so the player
    behind on Prizes draws more), and draws nothing at all if both hands were
    already empty (`onlyIfAnyMoved`). */
const IONO: CardProgram = {
  trainer: [
    {
      op: "handRefresh",
      who: "both",
      toBottom: true,
      draw: { kind: "prizeCount" },
      onlyIfAnyMoved: true,
    },
  ],
};

// ── M5 op-slice: board conditions (2026-07-21) — one BoardCondition vocabulary
//    with two consumers: the printed PLAY GATE (`trainerPlayableIf`, checked before the
//    card leaves hand) and the mid-program `conditionGate` branch. ──

/** Fighting Au Lait — "You can use this card only if you have more Prize cards
    remaining than your opponent. / Heal 60 damage from 1 of your Pokémon."
    (Item) — the first `trainerPlayableIf` card. The condition is the card's printed
    LEGALITY line, so it blocks the play outright (and greys the HUD button)
    rather than letting the card be spent on nothing; the effect itself is the
    Potion op at a bigger number. */
const FIGHTING_AU_LAIT: CardProgram = {
  trainerPlayableIf: { kind: "morePrizesThanOpponent" },
  trainer: [{ op: "healChosen", amount: 60 }],
};

/** D280 — Call Bell `sv08-165` (Item): *"You can use this card only if you go
    second, and only during your first turn. / Search your deck for a Supporter
    card, reveal it, and put it into your hand. Then, shuffle your deck."*
    **ONE Standard-legal printing, no reprint** — and the `BoardCondition`
    COMBINATOR's first and only consumer.

    🛑 **THE GATE IS THE SLICE; THE BODY IS THREE EXISTING OPS.** `trainerPlayableIf`
    is Fighting Au Lait's field at its second card (D131: the existing sole funnel,
    widened by the VALUE rather than by a parallel field), and the value is an
    `allOf` of two members that both already had to exist: `yourFirstTurn` (D275,
    Fan Rotom) and `youGoSecond` (new here). The effect is `searchDeck` →
    `shuffleDeck` at the shape 20 other rows in this file already spell.

    🛑 **BOTH CONJUNCTS ARE LOAD-BEARING, WHICH IS EXACTLY WHAT MAKES THIS THE
    COMBINATOR'S WARRANT AND NOT ANOTHER DESCRIPTIVE CLAUSE.** Contrast D223's
    Carmine and D277's Meloetta ex, where *"If you go first"* is DESCRIPTIVE and
    drops out: turn 1 is the going-first player's turn by construction, so a
    §4-ban licence needs no going-order conjunct. Here the direction is reversed
    and the collapse does not happen —

      • `yourFirstTurn` ALONE would admit **turn 1** for the going-first seat;
      • `youGoSecond` ALONE would admit **every turn of the game** for that seat.

    The conjunction is TURN 2, and only for the seat that went second. Neither
    member implies the other and no single member of the vocabulary spells it.
    (⚠️ **A build that spelled the conjunction as `state.turn === 2` would be
    right on the board and wrong in the vocabulary** — the second conjunct would
    have no seat in it, and `conditionNote` would have nothing to say.)

    ⚠️ **IT IS AN ITEM, SO §4's SUPPORTER BAN NEVER TOUCHES IT** — `trainerFirstTurnExempt`
    (D223) is not on this row and must not be added. That flag lifts a ban on
    SUPPORTERS played on turn 1 by the going-first player; Call Bell is an Item
    played on turn 2 by the going-second player, so the ban's antecedent is false
    twice over. The card it FETCHES is a Supporter, and the fetch is a search, not
    a play — §7.2's one-per-turn allowance is likewise untouched.

    ⚠️ **`reveal: true` IS PRINTED** (*"reveal it"*), and `max: 1` is the printed
    singular *"a Supporter card"* — authored from the bytes, not inferred from the
    filter's narrowness (`searchDeck`'s own doc block forbids that inference).

    🛑 **THE ELEVEN OTHER GOING-ORDER PRINTINGS ARE REFUSED, AND EACH ONE IS
    NAMED WITH THE MECHANISM IT WANTS** — see this file's going-order census note
    (the `DEBUT_PERFORMANCE` block) for the population, and D280 in decisions.md
    for the refusals. In short: ✅ **Chill Teaser Toy `sv08-166` shares this exact
    gate and wanted an op that moves an Energy off an OPPONENT'S Pokémon into
    THEIR hand — BUILT AT D295** as `discardEnergy`'s optional `to: "hand"`, so
    this combinator has TWO consumers now and needed no widening to gain the
    second (see `CHILL_TEASER_TOY` below); Illumise `sv06-010` and Scream Tail ex
    `sv06-094`/`-197` print the same conjunction on *"this **attack**"*, and
    Terapagos ex `sv07-128` ×7 prints its NEGATION there — all four bodies carry
    **TWO** attacks (measured, D1 `json_array_length(attacks_json)`), so
    `cantAttackUnless` would gate the wrong one and the per-INDEX field D277
    priced is still not built. ✅ **D281 BUILT THAT FIELD** (`attackGate`), and
    those three ids plus Terapagos ex ×7 are now GATED — their BODIES are still
    refused, each on a named mechanism (see the five blocks below). 🆕 ⚠️ **AND
    THE SENTENCE THAT USED TO END THIS BLOCK — *"Chill Teaser Toy is untouched:
    its blocker is the op, not the gate"* — WAS EXACTLY RIGHT AND IS NOW SPENT.**
    D280 typed that blocker as CODE-on-the-op fifteen slices before anyone built
    it, and the field D295 added is the one it named. **A REFUSAL WHOSE BLOCKER IS
    TYPED PRECISELY ENOUGH IS A WORK ITEM**, which is the whole reason this file
    writes them down. */
const CALL_BELL: CardProgram = {
  trainerPlayableIf: {
    kind: "allOf",
    conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
  },
  trainer: [
    { op: "searchDeck", filter: { kind: "supporter" }, dest: "hand", max: 1, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** 🆕 **D295 — Chill Teaser Toy `sv08-166` (Item): *"You can use this card only if
    you go second, and only during your first turn. / Put an Energy attached to 1
    of your opponent's Pokémon into their hand."* ONE Standard-legal printing, no
    reprint** (remote D1 `luminous`, 2026-08-08, re-queried in full rather than
    inherited). The card D280 named by id and refused, closed — **and its blocker
    was exactly the one D280 wrote down**: *"wants an op that moves an Energy off
    an OPPONENT'S Pokémon into THEIR hand, which no `EffectOp` spells"*.

    🛑 **THE GATE IS ALREADY BUILT AND IS SHARED BYTE-FOR-BYTE WITH CALL BELL.**
    `trainerPlayableIf: allOf[youGoSecond, yourFirstTurn]` — the SAME two
    conjuncts, for the SAME reason (neither member implies the other; the
    conjunction is turn 2 and only for the seat that went second). D280 built the
    combinator with one consumer and said so; **this is its second, and it needed
    no widening of any kind.** ⚠️ It is an ITEM, so `trainerFirstTurnExempt`
    (D223) is not on this row and must not be added — Call Bell's paragraph
    applies unchanged, and the ban's antecedent is false twice over here too.

    🛑 **THE BODY IS `discardEnergy` WITH ONE OPTIONAL FIELD, AND THE FIELD IS A
    ZONE RATHER THAN A SEAT.** `from: "opponentChosen"` is Crushing Hammer's own
    arm (`fix-hammer`, Energy Hammer `sv04-148`) and already resolves EVERY zone
    it writes against the VICTIM — the hammer family discards into the opponent's
    OWN pile. So the seat was never the open question and `to: "hand"` changes
    only WHICH of that seat's zones. ⚠️ **THE BACKLOG CALLED THIS CARD PART OF A
    "CROSS-SEAT ZONE" ROW WITH Mandibuzz AND Illumise SINCE D282, AND IT DOES NOT
    CROSS A SEAT AT ALL** — D294's `bottomFromOpponentHand.dest` genuinely does
    (source and destination sit on different sides); this one is a victim-zone
    widening that the hammer arm had already paid for.

    ⚠️ **`filter: anyEnergy` IS THE PRINTED "an Energy" AND NOT A NARROWING.** The
    sentence names no type and no Basic/Special split, so the filter is the widest
    one — `specialEnergy` is Giacomo's word and `basicEnergy` is Energy Switch's,
    and reading either in here would be authoring text the card does not print.

    ⚠️ **`count` IS ABSENT, WHICH IS THE PRINTED SINGULAR "an Energy"** — one
    Energy in total, mandatory, so the op auto-resolves on a forced board and
    parks on a genuine choice (the `parkOrForce` doctrine), exactly as the hammer
    does. There is no decline: the sentence does not say "you may".

    🛑 **AND THE ONE BOARD FACT THAT MAKES THIS DIFFERENT FROM THE HAMMER IT
    REUSES: THE ENERGY GOES SOMEWHERE THE OPPONENT CAN PLAY IT AGAIN.** A
    discarded Energy is spent; this one is in their hand and re-attachable next
    turn under §6.2. Nothing in the engine has to know that — but it is why the
    printed card gates itself to turn 2, and it is the reason the caption and the
    log row name the destination instead of saying "discarded". */
const CHILL_TEASER_TOY: CardProgram = {
  trainerPlayableIf: {
    kind: "allOf",
    conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
  },
  trainer: [
    { op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" }, to: "hand" },
  ],
};

// ── D281 — THE PER-ATTACK-INDEX TIMING GATE: 14 legal printings, 6 bodies ─────
//    (13 / 5 until D395 added Miltank `sv08.5-081`, the first at a NON-ZERO index)
//
// 🛑 **ALL FOURTEEN SHIP GATE-ONLY, AND THAT IS TWO NUMBERS AND NOT ONE.**
// **14 printings whose GATE is built; 0 whose BODY is.** Each of the first five
// printed bodies is refused on a mechanism this slice does not have, NAMED here
// rather than left as a gap — the effect stays on the loud ATTACK_EFFECT_SKIPPED
// path while the gate is honoured at the §8 declaration seam, which is the
// coverage strategy this repo has used since M4 and not a shortcut invented here.
// 🆕🆕 **THE SIXTH IS GATE-ONLY FOR THE OPPOSITE REASON**: Miltank's printed text
// IS the clause, so there is no body to refuse and nothing stays loud — see that
// row's own block.
//
// ⚠️ **A GATE-ONLY ROW MOVES NO `BUILT.attack` UNIT**, deliberately: that column
// is "the printed attack SENTENCE resolves", and half a sentence does not. What it
// does move is the non-attack registry pool, because the census's pool predicate
// is the NEGATIVE one ("any key that is not `attack`") — `attackGate` is the
// EIGHTH non-attack surface `censusAtHead.test.ts` warned would arrive, and it is
// the first that is not an Ability. See that file's D281 note.
//
// ⚠️ **EVERY ONE OF THE FIRST 13 IS AT INDEX 0** (measured, `json_each(attacks_json)`
// with the key returned) — asserted from the CATALOG in the suite rather than
// trusted here, because a per-INDEX field authored off a reprint's assumed layout
// is the one way this shape fails silently: four of the five bodies carry a
// SECOND attack that must not inherit the clause. 🆕🆕 **AND UNTIL D395 THAT WAS
// TRUE OF ALL OF THEM, WHICH MADE THE MAP'S KEY UNFALSIFIABLE ON EVERY BOARD IN
// THE REPO.** Miltank's gate is at index **1**, and the attack its clause names is
// at index 0 on the same card — so an index-blind read locks the card out of the
// game entirely. The 14th row is the one that gives the key a board.

/** Terapagos ex `sv07-128`/`-170`/`-173`/`sv08.5-092`/`-169`/`-180`/`svp-165`
    (**7 legal printings**, one byte-identical `attacks_json`) — idx 0 "Unified
    Beatdown": *"If you go second, you can't use this attack during your first
    turn. This attack does 30 damage for each of your Benched Pokémon."*

    THE GATE is the `barredIf` polarity over D280's `allOf` — the SAME condition
    Call Bell authors 40 lines up, at the opposite sign. It bites on exactly one
    turn of any game: the going-second seat's first turn is turn 2, which §4 does
    NOT ban, so this clause is the only thing standing between that player and the
    attack. On turn 4 and after, and for the going-first seat at every moment, the
    condition is false and the attack is live.

    🛑 **THE BODY IS REFUSED AND THE MISSING MECHANISM IS `DamageCountSource.
    yourBenchCount`.** The multiply fold (`deriveAttackDamageMultiplier`,
    effects.ts) has EIGHT count sources including `opponentBenchCount` and
    `bothSidesBenchCount`, and **no member counts YOUR OWN Bench as bodies** —
    the nearest is `damageCountersOnYourBench`, which tallies COUNTERS on that
    zone and is a different number on every board with a damaged Bench. A second
    blocker rides with it: every anchor in that fold is WHOLE-SENTENCE, and this
    printing's damage sentence is preceded by the gate clause, so even with the
    member the text would have to be split first. Two additions, not one. */
const TERAPAGOS_EX_UNIFIED_BEATDOWN: CardProgram = {
  attackGate: {
    0: {
      kind: "barredIf",
      condition: {
        kind: "allOf",
        conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
      },
    },
  },
};

/** Illumise `sv06-010` (**1 legal printing**) — idx 0 "Slowing Perfume": *"You
    can use this attack only if you go second, and only during your first turn.
    Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their
    deck."*

    THE GATE is the `onlyIf` polarity over the SAME `allOf` the row above bars on
    — the printed word is the whole difference, which is the argument for one
    field carrying a polarity token rather than two index maps.

    🛑 **THE BODY IS REFUSED AND THE MISSING MECHANISM IS A CROSS-SEAT
    PUT-INTO-DECK.** No `EffectOp` moves an OPPONENT'S benched Pokémon (with its
    attached cards) into the OPPONENT'S deck: `searchMove`/`retrieveMove` hard-code
    `ctx.seat`'s own zones, and the `dest` union means *your* zones at every
    reader. **THE MISSING PIECE IS CODE — AN OP THAT UNMAKES AN IN-PLAY BODY** (a
    whole stack, its attached Energy and Tools, its damage and its status, back
    into a library zone), which is a thing no op in this engine does at all:
    §10's evolve stacks GROW, KO tears one down through the prize path, and
    nothing else removes one.

    🆕 ⚠️ **D294 — THE SECOND PARAGRAPH THIS COMMENT USED TO CARRY WAS WRONG, AND
    IT PRICED FOUR HANDOFFS.** It read *"It is the same schema-boundary refusal
    Mandibuzz `sv10.5w-064`/`-145` carries — an opponent-side zone crosses
    `redact.ts`, a `z.enum` in `packages/schema/src/match/redacted.ts` and two
    `src/` HUDs — so it is priced as a SCHEMA-BOUNDARY slice"*. **MANDIBUZZ IS
    BUILT (D294) AND IT WAS NEVER THAT SLICE.** Its sentence moves a card out of
    the opponent's HAND, so it never touches `searchMove`/`retrieveMove` at all;
    it is `bottomFromOpponentHand` with one new destination; `chooseCards.dest`
    already carried `"bench"`, so `packages/schema`, `redact.ts` and both `src/`
    HUDs took a **ZERO** diff. **The two cards share the words "your opponent's"
    and nothing else** — grouping them cost every handoff since D282 a price that
    was never real. *Two refusals that quote the same phrase are not one refusal;
    the test is which ZONE and which SOURCE, not which possessive.* */
const ILLUMISE_SLOWING_PERFUME: CardProgram = {
  attackGate: {
    0: {
      kind: "onlyIf",
      condition: {
        kind: "allOf",
        conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
      },
    },
  },
};

/** 🆕 **D294 — Mandibuzz `sv10.5w-064`/`-145` "Look for Prey"** (Stage 1, **2
    legal printings on ONE byte-identical sentence** — remote D1 `luminous`,
    re-queried 2026-08-08, `GROUP BY lower(j.value ->> 'effect')` over
    `json_each(abilities_json)` at `legal_standard = 1`, which returns exactly
    these two ids and nothing else):

    *"Once during your turn, you may use this Ability. Your opponent reveals their
    hand, and you put a Basic Pokémon with 70 HP or less that you find there onto
    your opponent's Bench."*

    🛑 **THE WHOLE SLICE IS ONE OPTIONAL FIELD, AND THAT IS THE FINDING.** Four
    handoffs priced this as a SCHEMA-BOUNDARY row crossing `redact.ts`, a wire
    `z.enum` and two `src/` HUDs (see ILLUMISE_SLOWING_PERFUME above, whose
    comment said so and is now corrected). It is `bottomFromOpponentHand` —
    Ortega's and Greavard's op since M5 — with `dest: "bench"`:
      • *"Your opponent reveals their hand"* — that op's FIRST LINE, unchanged,
        through the shared `revealHand`.
      • *"a Basic Pokémon with 70 HP or less"* — `{ kind: "basicPokemon", maxHp:
        70 }`, D265's rider on D159's member. **D265's OWN DOC BLOCK NAMES THESE
        TWO IDS** as *"blocked on other machinery"*; this is that machinery, and
        the filter cost ZERO.
      • *"that you find **there**"* — the op's offer already scans the OPPONENT's
        hand and collapses interchangeable copies to one representative.
      • *"onto your opponent's Bench"* — the one new word, and the one new field.

    ⚠️ **`activeOnly: false`** — the sentence puts Mandibuzz nowhere in particular.
    ⚠️ **`oncePerTurn: true`, NOT `"sharedByName"`** — the printed line is the
    plain *"Once during your turn"* with no *"You can't use more than 1 …"* rider,
    so two Mandibuzz on one Bench each get a use. D272's field is keyed on the
    sentence that is printed, and this card does not print it.
    ⚠️ **NO `optional` OP WRAPPER** — *"you may use this Ability"* is the decision
    to use it at all (FAN_CALL's and SHOWTIME's reading).

    🛑 **WHY IT HELPS THE OPPONENT AND IS BUILT ANYWAY.** Putting a body on their
    Bench hands them a target — it is a DISRUPTION card (it strips a Basic they
    were holding and gives you something to snipe). Nothing in the program is
    conditioned on that being good for anybody, which is the point: the engine
    executes the printed sentence.

    ⚠️ **THE MECHANISM'S LEGAL POPULATION IS 4, NOT 2, AND THE OTHER HALF IS
    REFUSED.** The widened query (`%onto your opponent's Bench%` over all three
    text columns, `legal_standard = 1`) returns TWO MORE printings the backlog
    never named: **Lickitung `sv05-124`/`sv05-180` "Tongue Pull"** — *"Your
    opponent reveals their hand. Put up to **2** Basic Pokémon you find there onto
    your opponent's Bench."* Same destination, same source, an ATTACK rather than
    an Ability — and **REFUSED, on a COUNT.** This op parks `min: 1, max: 1` and
    its offer keeps ONE representative per interchangeable class, which is sound
    only while exactly one card is picked: *"up to 2"* may legally take two copies
    of the same Basic, and a collapsed offer cannot express that. The missing
    piece is CODE — a `count`/`max` on this op **plus** `payFromHand`'s
    per-class-representative rule ported into its offer — and it is a real
    backlog row rather than a rider here. */
const LOOK_FOR_PREY: CardProgram = {
  abilities: [
    {
      name: "Look for Prey",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "bottomFromOpponentHand",
          filter: { kind: "basicPokemon", maxHp: 70 },
          dest: "bench",
        },
      ],
    },
  ],
};

/** Scream Tail ex `sv06-094`/`-197` (**2 legal printings**) — idx 0 "Scream":
    *"You can use this attack only if you go second, and only during your first
    turn. Your opponent can't play any Supporter cards from their hand during
    their next turn."*

    THE GATE is byte-identical to Illumise's one block up — the same sentence, so
    the same authored value, and the two are deliberately NOT shared as one const:
    they are two cards printing one clause, and a shared object would make a later
    divergence on either body silently impossible to express.

    ✅ **THE BODY IS BUILT AT D283 AND THIS ROW NEEDS NO `attack` PROGRAM FOR IT.**
    `EffectOp` `preventHandPlay` + `GameState.handPlayLockedTurn` (types.ts) are
    the turn-scoped imposed hand-play lock the refusal below named, and the
    sentence behind the gate — *"Your opponent can't play any Supporter cards from
    their hand during their next turn."* — is DERIVED off an `^…$` anchor once
    D282's `splitAttackGateClause` has taken the gate clause off the front. So the
    seam that carries this card is TEXT-keyed at both ends and the row stays a
    bare `attackGate`: the whole reason the split exists is that a gate authored
    HERE licenses the deriver to read the remainder THERE.

    🛑 **THE REFUSAL'S CONCLUSION HELD AND ONE HALF OF ITS STATED REASON DID NOT
    — RE-DERIVED AT D283, WHICH IS THE POINT OF WRITING REASONS DOWN.**
    `preventSupporterEffectsWhileActive` was called wrong TWICE OVER: (a) it is a
    CONTINUOUS passive read off a body in the Active Spot, and (b) its object is
    the EFFECT of a Supporter already played rather than the PLAY. **(a) IS
    LOAD-BEARING AND (b) IS NOT.** Read at continuous.ts: that flag's object is
    indeed a Supporter's effect, but a bar on the PLAY would have been reachable
    from the same passive with one predicate — what makes the flag unusable here
    is its WINDOW. It is live exactly while its holder sits in the Active Spot,
    and this sentence's window opens after an attack has resolved, survives the
    attacker being Knocked Out, retreated or evolved, and closes by arithmetic at
    the end of one named turn. A window is not a predicate you can widen.

    ⚠️ AND THE OTHER HALF OF THE REFUSAL — *"`TurnAllowances` carries no per-seat
    'supporters barred until turn N' field"* — was right for a reason it did not
    give: the bag is not merely missing the field, it CANNOT hold it, because
    `freshAllowances()` wipes it at every `startTurn` and this window's whole job
    is to cross that boundary. The field went on `GameState`, and the
    `MATCH_RECORD_VERSION` bump the refusal predicted (14 → 15) is what it cost. */
const SCREAM_TAIL_EX_SCREAM: CardProgram = {
  attackGate: {
    0: {
      kind: "onlyIf",
      condition: {
        kind: "allOf",
        conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
      },
    },
  },
};

/** Volbeat `sv06-009` (**1 legal printing**) — idx 0 "Quick Sign": *"If you go
    first, you can use this attack during your first turn. Search your deck for up
    to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."*

    THE LICENCE, and the reason it is per-INDEX: Volbeat's idx 1 "Coordinated
    Strike" prints no such clause and must stay §4-banned on turn 1. A per-BODY
    flag (`PassiveEffects.attackFirstTurnExempt`, D277) would license both, and on
    Exeggcute below — which carries exactly ONE attack — the two shapes would be
    indistinguishable forever. The referent decides it, not the body count:
    *"this attack"* names an index.

    🛑 **THE BODY IS REFUSED AND THE MISSING MECHANISM IS A SPLIT ANCHOR.**
    effects.ts's bench-search reader named this printing by id as one of four legal
    deferrals and gave the reason: its anchor is whole-sentence and the licence
    clause sits in front of the sentence it reads. That is unchanged by this slice
    — the gate is now expressible, the TEXT is still one string with two sentences
    in it, and teaching the derivers to strip a leading printed clause is a reader
    change with its own blast radius across all seven of them. */
const VOLBEAT_QUICK_SIGN: CardProgram = {
  attackGate: { 0: { kind: "firstTurnExempt" } },
};

/** Exeggcute `sv08-001`/`-192` (**2 legal printings**) — idx 0 "Precocious
    Evolution": *"If you go first, you can use this attack during your first turn.
    Search your deck for a card that evolves from this Pokémon and put it onto
    this Pokémon to evolve it. Then, shuffle your deck."*

    THE LICENCE again, on a body with exactly ONE attack — so nothing on this card
    can tell a per-index field from a per-body one today, which is precisely why
    the argument was made from the printed referent above and not from a count.

    🛑 **THE BODY IS REFUSED AND THE MISSING MECHANISM IS A `searchDeck` `dest`
    THAT EVOLVES.** `dest` is a zone union; "put it onto this Pokémon to evolve
    it" is a PLACEMENT onto a specific in-play body that runs the evolution
    machinery (`placeEvolution`, turn.ts) including the mid-turn evolve-below-HP
    KO and the on-evolve trigger — which the interpreter must never do directly
    (flow.ts owns every Knock Out). ⚠️ **AND THE SUBJECT IS ITS OWN OBJECT**: the
    searching Pokémon is also the evolution target, so the op would need a
    self-reference the `dest` union has no spelling for.
    ⚠️ **NOTE THE SECOND-ORDER READING NOBODY IS OWED YET**: this attack would
    EVOLVE on turn 1, which §4/§10's evolve ban forbids for plays FROM HAND. The
    ban is on playing an Evolution card, not on an attack effect placing one, so
    the two rules do not collide — but a build that routed this through `evolve`
    would inherit the ban and refuse the card its own licence just bought.

    🆕 🛑 **D306 — THE SENTENCE IS NOT THIS CARD'S, THE REFUSAL'S TYPE IS
    COMPOSITION, AND BOTH TAILS ARE NOW DRIVEN** (`precociousEvolution.test.ts`).
    Three corrections to the paragraphs above, each measured rather than argued:
      ① **THE POPULATION IS SIX LEGAL PRINTINGS ON FOUR CARDS, NOT TWO.** Remote
        D1, 2026-08-09, `instr(attacks_json,'put it onto this Pok') > 0`: Eevee
        `sv06-135`/`-188` "Ascension" (and a SECOND attack, "Quick Attack"),
        Dwebble `sv10-011` "Ascension", Team Rocket's Pupitar `sv10-095`
        "Explosive Ascension" (Stage 1, `damage: 30`) and these two. The other
        four printings carry NO registry row, so this family is **2 of 6**.
      ② **THE `dest` UNION IS `"bench" | "hand"` AND NOTHING ELSE** — the old
        parenthetical said *"hand / bench / discard / …"*, and a registry-wide
        walk over every authored op returns exactly those two. The stale third
        member made the widening look cheaper than it is.
      ③ **THE BLOCKER IS NOT "the interpreter must not evolve" AS A RULE — IT IS
        A RETURN CHANNEL.** `placeEvolution` ends in one of two `ApplyResult`
        calls, and the suite drives BOTH on real boards: `runBoardTrigger(…,
        "onEvolve", …)` PARKS (Arboliva `sv01-023` → `effect:choose`) and
        `resolveMidTurnKnockOuts` seeds `pending` (a charmed Basic dropping under
        the Stage 2's HP → `ko:takePrizes`). `stepOp` returns
        `{ done: GameState } | { park: EffectPrompt }`; neither tail fits.
      🆕 **AND WHAT IT WOULD BE WORTH, SETTLED**: `BUILT.attack`'s raw summand is
        keyed on the READER over the whole legal corpus (D274's addition names no
        registry term), so an anchor on the bare sentence collects **4** printings
        and the split collects these **2** — **1151 → 1157**, a move of SIX. */
const EXEGGCUTE_PRECOCIOUS_EVOLUTION: CardProgram = {
  attackGate: { 0: { kind: "firstTurnExempt" } },
};

/** 🆕🆕 D395 — Miltank `sv08.5-081` (**1 legal printing**) — idx **1** "Moomoo
    Rolling" ({C}{C}, flat `100`): *"You can use this attack only if this Pokémon
    used Rollout during your last turn."* Its own idx 0 is "Rollout" ({C}, 20, no
    effect text) — the attack the clause NAMES is printed on the same card, one
    index up.

    🛑 **THE FIRST GATE IN THIS FIELD THAT IS NOT AT INDEX 0, AND THAT IS THE
    REASON THIS PRINTING IS WORTH MORE THAN ITS ONE UNIT.** D281's own comment
    recorded that every one of its 13 is at index 0 and called that "an accident of
    today's pool and not a reason" — so until this row, a build that ignored the
    index entirely (`Object.values(attackGate)[0]`, or a per-BODY flag) was green on
    every assertion in `attackIndexGate.test.ts`. The `attackGate` map's KEY had no
    board that could falsify it. Miltank is that board: an index-blind read gates
    "Rollout" itself, and "Rollout" is the only way to satisfy the gate — so the
    card becomes permanently unusable, which is the deadlock §2 of
    `rolloutGate.test.ts` drives.

    🛑 **THE GATE IS A REGISTRY ROW AND NOT A DERIVED ONE, AND THE SHAPE QUESTION
    WAS SETTLED FROM THE CATALOG BEFORE A LINE WAS WRITTEN.** `attackGate` has no
    deriver behind it — `attackGateOf` (continuous.ts) reads `programFor(top.id)`
    and nothing else — so building one would be new machinery, and the measurement
    that decides it is how many legal printings it would buy that a row does not:
    **ZERO.** The clause is 1 legal printing on 1 id (`legalAttackCorpus()`), and
    the three shapes a deriver would also have to absorb are the 13 that already
    carry rows. D180/D187's rule ("an arm transfers across sets; a row does not")
    prices a FUTURE reprint, and against that stands D282's own refusal of a
    generic composer for a family of one — plus a live cost the arm would incur
    here and not there: the split at attack.ts fires only when a row REPRESENTS the
    clause, so a derived gate would collapse that two-key check into a tautology
    and re-install the "too loose" build `D282-split-fires-without-a-gate` exists
    to refuse.

    ✅ **THE BODY IS NOT REFUSED — THERE IS NO BODY**, and this row is the first of
    the six that can say so. Every gate before it ships GATE-ONLY because its
    printed body needs a mechanism the engine lacks; this one is gate-only because
    the printed text is the gate and nothing else. D282's splitter now answers it
    `{clause, body: ""}` (its own comment named this printing as the future one its
    empty-body refusal was guarding against), so the whole sentence is accounted for
    and `ATTACK_EFFECT_SKIPPED` does not fire.

    ⚠️ **AND `BUILT.attack` STILL DOES NOT MOVE**, which is bookkeeping rather than
    modesty: that column's split summand counts printings whose BODY a reader
    resolves, and `resolvedByAnyReader("")` is false because every reader in
    effects.ts is `^…$` anchored on a non-empty pattern. The census gains a THIRD
    class here — gated, refused whole, and with no body to resolve — and
    `censusAtHead.test.ts`'s gate section names it rather than folding it into
    either of the two it already had. */
const MILTANK_MOOMOO_ROLLING: CardProgram = {
  attackGate: {
    1: {
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    },
  },
};

/** 🆕🆕 **D396 — Sylveon ex `sv08-086` / `sv08.5-041` / `sv08.5-156`** (Stage 1
    from Eevee, 270 HP, {P}, ×2 {M} weakness, retreat 2 — **3 legal printings on
    ONE byte-identical `attacks_json`**, every field re-read off tcgdex
    2026-08-22) — idx **1** "Angelite" ({W}{L}{P}, NO printed damage):

    *"Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all
    attached cards into your opponent's deck. If 1 of your Pokémon used Angelite
    during your last turn, this attack can't be used."*

    🛑 **THE CONSEQUENT IS NOT A THIRD SHAPE — IT IS `barredIf`, AND THE HANDOFF
    THAT SAID OTHERWISE WAS RE-CHECKED RATHER THAN INHERITED.** D394's handoff
    priced *"this attack can't be used"* as a THIRD consequent the union does not
    spell. It is the PASSIVE VOICE of the one Terapagos ex's seven printings
    already carry (*"…you can't use this attack during your first turn"*): both bar
    the index while the condition HOLDS, and the polarity token is the whole of it.
    Measured on the corpus: *"can't be used"* is **1 sentence / 3 printings** (this
    one) and *"you can't use this attack"* is **1 sentence / 7 printings**
    (Terapagos), so the two spellings are two rows of one shape and neither needs a
    reader. **The row is materially cheaper than it was priced.**

    🛑 **THE SECOND NON-ZERO INDEX, AND THAT IS WHY THESE THREE PRINTINGS ARE WORTH
    MORE THAN THREE UNITS.** D395 gave `attackGate`'s `[attackIndex: number]` key
    its first falsifying board; a KEY WITH ONE falsifying board is a key that could
    still be right by accident. These three are the second, on a different card, a
    different polarity and a different opposite index: the gate is at 1 and the
    attack the clause NAMES is also at 1 — Angelite bars ITSELF — where Miltank's
    gate at 1 names index 0. So an index-blind read fails DIFFERENTLY here (it bars
    "Magical Charm", the attack the card is otherwise played for, and leaves
    "Angelite" unconditionally legal) and the two cards together pin the key from
    both sides.

    🛑 **THE BODY IS REFUSED AND THE GATE SHIPS ALONE — AND *"no split"* IS A
    MEASUREMENT, NOT A CONVENIENCE.** The clause is TRAILING, and
    `splitAttackGateClause` is a LEADING-clause matcher anchored at `^` by
    deliberate policy. Adding a trailing stripper would buy **ZERO**: all nine live
    readers were run at this head over the body *"Choose 2 of your opponent's
    Benched Pokémon. Shuffle those Pokémon and all attached cards into your
    opponent's deck."* and **every one of them refuses it**, so the split summand
    would gain nothing and `ATTACK_EFFECT_SKIPPED` would name the same printing
    either way. ⚠️ **AND THE INHERITED REASON FOR THAT WAS STALE**: the handoff said
    the body was Illumise `sv06-010`'s refusal verbatim (*"no `EffectOp` moves an
    OPPONENT'S benched Pokémon … into the OPPONENT'S deck"*), and **D299 built that
    op** — `returnBenched { whose: "opponent", dest: "deck" }`, which is exactly what
    Illumise's body derives to today. What refuses THIS body is the **COUNT**
    (*"Choose **2**"*, against an op that parks `min: 1, max: 1`) and the two-sentence
    choose-then-shuffle shape with its *"those Pokémon"* back-reference — Lickitung
    `sv05-124`/`-180`'s refusal, one op over. Same conclusion, different reason; the
    conclusion was re-derived by running the readers rather than by quoting the
    comment.

    ⚠️ **ONE PROGRAM OBJECT FOR THREE IDS — D281's REPRINT IDIOM, WHICH IS TERAPAGOS'S
    TREATMENT AND NOT ILLUMISE / SCREAM TAIL's.** Those two print ONE clause on TWO
    cards and are deliberately kept as two consts, because a later divergence on
    either body must stay expressible. These three are one CARD reprinted, with a
    byte-identical `attacks_json`, so they share the object exactly as Terapagos ex's
    seven do.

    ⚠️ **NO `MATCH_RECORD_VERSION` BUMP IS OWED, ASKED OF ALL THREE HALVES.** The
    registry row persists nothing (`attackGate` is a catalog fact re-derived on every
    read, and it carries no `EffectOp`, so it cannot ride a parked `pendingOp` into a
    record); the new `BoardCondition` member is a widening no v25 record can contain,
    because no v25 card authors it; and the stamp it reads
    (`InPlayPokemon.usedAttack`) has been REQUIRED since D394's own bump. **Stays 25.** */
const SYLVEON_EX_ANGELITE: CardProgram = {
  attackGate: {
    1: {
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    },
  },
};

/** Falkner — "Draw 2 cards. If you have a Stadium in play, draw 2 more cards."
    (Supporter) — a ONE-ARMED conditionGate: the base draw is unconditional and
    the bonus is a SECOND drawCards inside the gate. Two ops rather than one
    computed count, so the log shows the two draws exactly as they happen and
    the gate is evaluated after the base draw (drawing cannot move a Stadium, so
    the order is immaterial — but this is the order the card is written in). */
const FALKNER: CardProgram = {
  trainer: [
    { op: "drawCards", count: 2 },
    {
      op: "conditionGate",
      cond: { kind: "yourStadiumInPlay" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/** Grusha — "Draw cards until you have 5 cards in your hand. If none of your
    Pokémon have any Energy attached, draw cards until you have 7 cards in your
    hand INSTEAD." (Supporter) — the printed "instead" is a genuine if/ELSE, so
    this is the one card using the gate's `otherwise` arm: exactly one of the two
    draws ever runs, and the condition is measured on the board as it stands
    before any card is drawn (drawing to hand cannot attach Energy either way). */
const GRUSHA: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "noEnergyOnYourPokemon" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "drawUntilHandSize", size: 7 }],
      otherwise: [{ op: "drawUntilHandSize", size: 5 }],
    },
  ],
};

/** fix-condgate — FIXTURE demonstrator, no printed card: a conditionGate whose
    BOTH arms hold a PARKING op. Neither real card needs this (Falkner and Grusha
    branch into automatic draws only), but runProgram splices a branch into the
    work queue precisely so an op inside one can still park — this is the fixture
    that proves it, on both the `then` and the `otherwise` side. */
const FIX_CONDGATE: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "morePrizesThanOpponent" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "healChosen", amount: 30 }],
      otherwise: [{ op: "gust" }],
    },
  ],
};

/** fix-gateorder — FIXTURE demonstrator, no printed card. Pins the three claims
    about the gate that no REAL card can exercise, because Falkner's gate is last
    in its program, Grusha's gate IS its whole program, and neither arm holds
    more than one op:
      1. the gate is evaluated against the board AS OF the gate — the leading
         attach BREAKS `noEnergyOnYourPokemon`, so the `otherwise` arm runs (a
         gate reading the program's ENTRY state would take `then` instead);
      2. an arm's ops are spliced to the FRONT of the queue (draw 1 then 4 come
         before the trailing draw 2, not after it);
      3. the ops AFTER the gate survive the splice (the trailing draw 2 fires).
    Each claim shows up as a different CARDS_DRAWN sequence, so one assertion on
    the ordered draw counts kills all three mutants. */
const FIX_GATEORDER: CardProgram = {
  trainer: [
    { op: "attachEnergyFrom", source: "hand" },
    {
      op: "conditionGate",
      cond: { kind: "noEnergyOnYourPokemon" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "drawCards", count: 3 }],
      otherwise: [
        { op: "drawCards", count: 1 },
        { op: "drawCards", count: 4 },
      ],
    },
    { op: "drawCards", count: 2 },
  ],
};

/** fix-gatedsup — FIXTURE demonstrator: a gated SUPPORTER. Every real card with
    a `trainerPlayableIf` is an Item, so nothing else pins that the gate is
    checked BEFORE `allowances.supporterPlayed` is written — a rejected gated
    Supporter must not burn the one-Supporter-per-turn allowance (§7.2). */
const FIX_GATEDSUP: CardProgram = {
  trainerPlayableIf: { kind: "morePrizesThanOpponent" },
  trainer: [{ op: "drawCards", count: 1 }],
};

// ── M5 op-slice: discardEnergy (the §15 energy-removal "hammer" family) —
//    discard Energy off the OPPONENT's Pokémon. All three `from` arms land with a
//    real printed card. The SELF-discard attacks ("Discard an Energy from this
//    Pokémon") landed with the attackEpilogue slice (engine 0.22.0) and need NO
//    registry row at all — effects.ts derives them from the printed sentence.
//    (verified vs the local catalog 2026-07-21). ──

/** Crushing Hammer — "Flip a coin. If heads, discard an Energy from 1 of your
    opponent's Pokémon." (Item) — the coin-gated hammer, and the `opponentChosen`
    arm: the controller picks the Energy, which IS picking the Pokémon (exactly one
    comes off). The discard sits INSIDE the gate, so a tails play does nothing at
    all — but the play into an Energy-LESS board is rejected outright, because
    `programPlayable` descends into a coin gate's `then` (§7 / Compendium 906: the
    flip is procedure, not effect, so it cannot make a target-less card playable). */
const CRUSHING_HAMMER: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" } }],
    },
  ],
};

/** Giacomo — "Discard a Special Energy from each of your opponent's Pokémon."
    (Supporter) — the `opponentEach` sweep: EVERY one of the opponent's in-play
    Pokémon that holds a Special Energy loses exactly one (a Pokémon with none is
    skipped, one carrying several is the player's choice — rare, and the only
    reason this parks at all). A TOP-LEVEL op, so the whiff gate applies: with no
    Special Energy anywhere on the opponent's board the play is rejected rather
    than burning the turn's one Supporter. */
const GIACOMO: CardProgram = {
  trainer: [{ op: "discardEnergy", from: "opponentEach", filter: { kind: "specialEnergy" } }],
};

/** Mawile — "Special Eater": "When you play this Pokémon from your hand onto your
    Bench during your turn, you may discard a Special Energy from your opponent's
    Active Pokémon." — a TRIGGERED (onPlayToBench) Ability and the `opponentActive`
    arm. Auto-fires like every optional trigger (pure upside — it only takes from
    the opponent); with no Special Energy on their Active the op is a no-op, so the
    ABILITY_TRIGGERED row stands alone (the Flamigo-into-an-empty-deck precedent). */
const MAWILE: CardProgram = {
  triggered: [
    {
      name: "Special Eater",
      trigger: "onPlayToBench",
      optional: true,
      program: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "specialEnergy" } }],
    },
  ],
};

/** fix-hammer — FIXTURE Item, no printed card: Crushing Hammer's `opponentChosen`
    discard WITHOUT the coin gate. Every real card that reaches this arm is behind
    a flip, so the fixture is what pins the arm's own behaviour — the park, the
    forced auto-resolve and the `programPlayable` whiff gate — without threading a
    seeded coin flip through each assertion. */
const FIX_HAMMER: CardProgram = {
  trainer: [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" } }],
};

// ── M5 op-slice: attachFromDeck — SEARCH your deck for Energy and attach it
//    straight onto your Pokémon. The deck-search sibling of attachFromTop, and
//    the two printed target rules it has to tell apart: "in any way you like"
//    (Charizard ex) and "for each of those Pokémon" (Janine's Secret Art).
//    Deferred with reasons in the workstream doc: Forretress ex "Exploding
//    Energy" (a §9.2 gate into a self-KO, which the interpreter cannot do),
//    Geeta ("your Pokémon can't attack this turn" — a turn-scoped restriction
//    that does not exist yet). Pawmot "Electrogenesis" was deferred here on
//    "EffectContext carries no source uid" and landed one slice later (D50,
//    the `toSelf` rule below).
//    (verified vs the local catalog 2026-07-22). ──

/** Charizard ex — "Infernal Reign": "When you play this Pokémon from your hand
    to evolve 1 of your Pokémon during your turn, you may search your deck for up
    to 3 Basic {R} Energy cards and attach them to your Pokémon in any way you
    like. Then, shuffle your deck." (sv03-125/-215/-223/-228)

    The op's plain arm, and every setting is straight off the printed words:
    - "search your deck" → `attachFromDeck`, not `attachFromTop`: no window, the
      whole list is reachable;
    - "up to 3 **Basic {R} Energy cards**" → `max: 3` with `basicEnergy` +
      `energyType` — the PRINT, never `providesEnergy`, since these cards sit in
      the deck attached to nothing (§6.5, the Electric Generator rule);
    - "to **your Pokémon**" → no target rider: the Active is a target and so is
      every benched one;
    - "**in any way you like**" → no `maxPerTarget`, so all three may land on one
      Pokémon;
    - "Then, shuffle your deck" → the trailing `shuffleDeck`, which runs on the
      whiff and the decline too (the Nest Ball pattern).

    An `onEvolve` triggered Ability, so it also fires through Rare Candy — D28's
    shared `placeEvolution` is what both paths run, and this card is exactly the
    Basic→Stage 2 shape Rare Candy exists for. "You may" is `optional`, which the
    framework AUTO-FIRES (D27); the decline the word actually buys survives in
    the op's own "up to", where taking none is a legal answer to the park. */
const CHARIZARD_EX: CardProgram = {
  triggered: [
    {
      name: "Infernal Reign",
      trigger: "onEvolve",
      optional: true,
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Fire" },
          max: 3,
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Janine's Secret Art — "Choose up to 2 of your {D} Pokémon. For each of those
    Pokémon, search your deck for a Basic {D} Energy card and attach it to that
    Pokémon. Then, shuffle your deck. If you attached Energy to your Active
    Pokémon in this way, it is now Poisoned." (Supporter, sv06.5-059/-088)

    THREE PRINTED SENTENCES, THREE OPS, IN ORDER — and the middle one is the
    reason the first is not a `choosePokemonMulti`. Read literally the card asks
    two questions (which Pokémon, then which card for each), but the second has no
    content: same-type Basic Energy is fungible (the `attachEnergyFrom` doctrine),
    so "which Basic {D} Energy" is never a decision. What remains is one map — up
    to 2 Energy onto distinct {D} Pokémon of yours — which is exactly what the
    `attachCards` prompt already says, so the card parks ONCE.

    `maxPerTarget: 1` is "for **each** of those Pokémon … attach it to **that**
    Pokémon": one apiece, never both on one. That is the whole distinction from
    Charizard ex's "in any way you like" above, and it is a real one — a player
    who could stack both on the Active would.

    `targetType: "Darkness"` is "your **{D}** Pokémon", read off the TOP card's
    types by the shared `attachEnergyTargets`.

    The last sentence is §9.2 and needs the gate's `contains` narrowing: not "did
    you attach anything" but "did anything land on your ACTIVE". `recordAs:
    "moved"` files the uids actually attached and the gate asks where they are —
    so poisoning happens exactly when the printed clause says, including the case
    a player attaches both Energy to the Bench and takes no poison at all.

    Self-poison is the point, not a drawback to route around: it is how the deck
    turns on its own Poison payoffs. `applyStatus` with `target: "self"` resolves
    to the CONTROLLER's Active (the interpreter reads `ctx.seat`), which is the
    first registry program to author that op — every earlier one came from the
    attack deriver.

    NOT gated by `programPlayable`, per the op's doc — a board with no {D} Pokémon
    still shuffles. This is the sharpest form of that call in the repo so far: a
    SUPPORTER (§7.2 — one per turn) that can be spent on a bare shuffle. Recorded
    rather than special-cased, with the prompt as the mitigation. */
const JANINES_SECRET_ART: CardProgram = {
  trainer: [
    {
      op: "attachFromDeck",
      filter: { kind: "basicEnergy", energyType: "Darkness" },
      max: 2,
      targetType: "Darkness",
      maxPerTarget: 1,
      recordAs: "moved",
    },
    { op: "shuffleDeck" },
    {
      op: "recordGate",
      slot: "moved",
      contains: "yourActive",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [{ op: "applyStatus", target: "self", status: "poisoned" }],
    },
  ],
};

// ── M5 op-slice: EffectContext.sourceUid — the printed "this Pokémon" (D50).
//    The context now names the Pokémon whose effect is running, and
//    `attachFromDeck.toSelf` is its first reader.
//    (verified vs the local catalog 2026-07-22). ──

/** Pawmot — "Electrogenesis": "Once during your turn, you may search your deck
    for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle
    your deck." (sv01-076/-209)

    The card the source uid was built for: "this Pokémon" with no Active-spot
    wording, so a BENCHED Pawmot feeds itself — the exact target neither of the
    op's other two rules can name (`attachEnergyTargets` answers "which of your
    Pokémon may receive", and this card's answer is "the one using the
    Ability"). Every other setting is straight off the printed words:
    - "Once during your turn" → `oncePerTurn` (§9, per Pokémon);
    - no "in the Active Spot" clause → `activeOnly: false`;
    - "a Basic {L} Energy card" → the PRINT (`basicEnergy` + `energyType`),
      §6.5, with `max: 1` — the printed article is the count;
    - "attach it to this Pokémon" → `toSelf`;
    - "Then, shuffle your deck" → the trailing `shuffleDeck` (the Nest Ball
      pattern — it runs on the whiff and the decline too).
    The "you may" is spent by choosing to use the Ability; the park it opens is
    still declinable (a search of a hidden zone may be failed on purpose — the
    attachCards prompt's standing rule), which is strictly more permissive than
    asking again and costs the player nothing they didn't already have. */
const PAWMOT: CardProgram = {
  abilities: [
    {
      name: "Electrogenesis",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Lightning" },
          max: 1,
          toSelf: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

// ── M5 op-slice: healChosen's "up to N" arm — §9.1's min: 0 end (D51).
//    (verified vs the local catalog 2026-07-22). ──

/** Saguaro — "Choose up to 2 of your Pokémon and heal 50 damage from each of
    them." (Supporter, sv02-187/-255/-270 — identical text on all three prints.)

    The first consumer of choosePokemonMulti's "up to" end, the range the
    prompt has carried since D47 with every consumer at `min === max`: "up to
    2" legalizes 0, 1 or 2 (§9.1), so the park is {min: 0, max: 2}, §8.6
    clamping the ask to the board. `amount: 50` is per Pokémon — "from EACH of
    them" — clamped to each pick's damage like every heal.

    Deliberately UNGATED, twice over, both following shipped doctrine rather
    than deciding it here:
    - playable with nothing damaged anywhere — so a full-HP board can spend the
      turn's Supporter on nothing; the prompt's honest "Take none" is the
      mitigation, and the wart stays on the carried-forward list with its two
      siblings.
      🛑 **D349 — THIS BULLET USED TO SAY "`programPlayable` HAS NEVER HAD A HEAL
      BRANCH", AND THAT HALF IS SPENT.** It has one now (`healChosenTargets`,
      added for Bianca's Devotion's printed `remainingHpAtMost`). **The BULLET's
      CLAIM IS UNCHANGED** and is asserted rather than argued
      (`remainingHpWindow.test.ts` §5): with no rider the funnel returns every own
      in-play Pokémon, a set §1.1 makes non-empty at every legal board, so the new
      line cannot fire on Saguaro, Potion or Fighting Au Lait. Recorded as SPENT
      rather than re-pointed at some other reason the wart survives — the reason
      is the same one it always was, and only the sentence about the code rotted.
    - the candidates are ALL your Pokémon, damaged or not — the printed choose
      clause has no damaged restriction, and an undamaged pick heals 0 and
      emits nothing (the single-arm rule since M4). */
const SAGUARO: CardProgram = {
  trainer: [{ op: "healChosen", amount: 50, upTo: 2 }],
};

// ── D190 — TIER 1's REGISTRY-ONLY PROGRAMS: Abilities whose printed effect maps
//    ENTIRELY onto ops that ALREADY EXIST. No new op, no new field, no new
//    `CardFilter` kind — which is the whole admission test, and four of the
//    census's seven candidates FAILED it and were dropped rather than
//    approximated (see `registryOnlyPrograms.test.ts`, which names each one and
//    the exact piece of engine it needs). 11 Standard-legal printings over three
//    programs, every count measured against the remote D1 on 2026-08-04.
//
//    ⚠️ THE DOCTRINE THAT DROPPED THE OTHER FOUR IS *EXACT MAP OR FLAG*. A
//    registry row has no deriver behind it to refuse a sentence it cannot parse:
//    whatever is authored here IS what the card does, forever, and an unauthored
//    Ability at least surfaces loudly. So a program that is CLOSE is strictly
//    worse than none. ──

/** Roselia sv05-008 / Roserade sv05-009 / Scolipede sv10.5b-056/-134 — "Poison
    Point": "If this Pokémon is in the Active Spot and is damaged by an attack
    from your opponent's Pokémon (even if this Pokémon is Knocked Out), the
    Attacking Pokémon is now Poisoned."

    Armarouge's `SCORCHING_ARMOR` (sv03-044, D99) with ONE token changed — the
    antecedent is byte-identical and the consequent differs only in the
    `StatusName`. It is a SEPARATE const rather than a shared object precisely
    because the sentences are NOT byte-identical: sharing would be the Tier-0
    idiom applied where Tier 0 does not hold, and a later edit to the Burn
    program would silently move the Poison one. 4 legal printings of 4 in the
    catalog. */
const POISON_POINT: CardProgram = {
  triggered: [
    {
      name: "Poison Point",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: [{ op: "applyStatus", target: "defender", status: "poisoned" }],
    },
  ],
};

/** N's Zoroark ex sv09-098/-175/-185/-189 — "Trade": "You must discard a card
    from your hand in order to use this Ability. Once during your turn, you may
    draw 2 cards."

    Tinkaton's `GATHER_MATERIALS` shape exactly (sv02-105), with `drawCards`
    2 for 3: the cost is the program's first op (`payFromHand`, no filter — "a
    card", so the whole hand is a candidate and a mixed hand always asks), and
    `useAbility` refuses the use when it cannot be paid (cardplay.ts
    `handCostUnmet`). 4 legal printings of 4 in the catalog. */
const NS_ZOROARK_EX: CardProgram = {
  abilities: [
    {
      name: "Trade",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "payFromHand", count: 1, to: "discard" },
        { op: "drawCards", count: 2 },
      ],
    },
  ],
};

/** Archaludon sv07-107/-155 and sv08.5-070 — "Metal Bridge": "All of your
    Pokémon that have {M} Energy attached have no Retreat Cost."

    Clefable ex's `LUNAR_ZONE` (sv03-082) with `Metal` for `Psychic` — a PURE
    DATA ROW, and the first evidence that `noRetreatCostAura.requiresEnergyType`
    was worth having as an optional refinement rather than hardcoding {P}. The
    clause is a PROVISION read (continuous.ts `providesEnergyType`), so a
    wildcard Special Energy that provides {M} satisfies it exactly as it would
    pay a {M} cost. 3 legal printings of 3 in the catalog. */
const METAL_BRIDGE: CardProgram = {
  passive: { noRetreatCostAura: { requiresEnergyType: "Metal" } },
};

/** D267 — Latias ex sv08-076/-220/-239 — "Skyliner": "Your Basic Pokémon in play
    have no Retreat Cost."

    The THIRD row on this field and the first to use its OTHER refinement: no
    energy clause at all, a STAGE one instead. `LUNAR_ZONE` and `METAL_BRIDGE`
    print "All of your Pokémon **that have {X} Energy attached**"; this prints
    "Your **Basic** Pokémon in play", so what narrows the target set is
    `isBasicPokemon` on its top card rather than a provision read. Everything
    else about the aura is identical: own board, no "in the Active Spot" clause
    on either end, §9-suppressible per source, and SELF-INCLUSIVE — Latias ex is
    itself a Basic (210 HP, printed Retreat Cost 2), so unlike Clefable ex it
    satisfies its own clause unconditionally and frees its own retreat.

    ⚠️ IT DOES NOT SHARE AN OBJECT WITH EITHER NEIGHBOUR. The reprint idiom shares
    on BYTE-IDENTICAL text and this sentence is neither of theirs; sharing would
    make an edit to one card silently move a card that never printed the words.
    3 legal printings of 3 in the catalog (remote D1 `luminous`, `%no Retreat
    Cost%` over all three text columns, `legal_standard = 1`, 2026-08-07):
    `sv08-076` and its two alternate-art reprints. */
const SKYLINER: CardProgram = { passive: { noRetreatCostAura: { stage: "Basic" } } };

/** D268 — Gothitelle svp-211/sv10.5w-043 — "Distorted Future": "Once during your
    turn, if this Pokémon is in the Active Spot, you may have your opponent
    shuffle their hand into their deck and draw 3 cards."

    `handRefresh` with its THIRD `who` member. Judge already reaches the
    opponent's hand and deck (`who: "both"`), so nothing about the ZONES is new
    here — what is new is that the controller's own hand is NOT touched, which is
    a NARROWING of the seat list rather than a new mechanism. Everything else on
    the sentence was already vocabulary: "Once during your turn" is `oncePerTurn`,
    "if this Pokémon is in the Active Spot" is `activeOnly` (Attract Customers,
    Gentle Fin), the printed "you may" is the player's choice to use the Ability at
    all (this op never parks — no decision), and "draw 3 cards" is
    `draw: { kind: "fixed", count: 3 }`.

    ⚠️ NO `toBottom` AND NO `onlyIfAnyMoved`. The printed verb is "shuffle their
    hand INTO their deck" — Judge's placement, which destroys the deck's order —
    and there is no "if they do" clause, so an opponent holding no cards still
    reshuffles and still draws 3. Both riders are Iono's and neither is printed
    here; either would be a wrong-but-plausible card.

    ⚠️ AND IT IS THE SECOND `handRefresh` OUTSIDE THE TRAINER PATH (Skwovet was the
    first) and the first that reaches ACROSS the table from an Ability — so it is
    once per turn PER POKÉMON and two copies in the Active Spot across two turns
    is two refreshes.

    2 legal printings of 2 in the catalog (remote D1 `luminous`, `%hand into%deck%`
    over all three text columns, `legal_standard = 1`, 2026-08-07): the `svp-211`
    promo and the `sv10.5w-043` set printing, byte-identical text, ONE sentence. */
const DISTORTED_FUTURE: CardProgram = {
  abilities: [
    {
      name: "Distorted Future",
      oncePerTurn: true,
      activeOnly: true,
      program: [{ op: "handRefresh", who: "opponent", draw: { kind: "fixed", count: 3 } }],
    },
  ],
};

// ── D199 — THE SECOND REGISTRY-ONLY SWEEP, AND THE FIRST ONE WHOSE CANDIDATE
//    LIST WAS DERIVED RATHER THAN INHERITED. D190 worked the seven candidates
//    `docs/reference/coverage-backlog-legal.md` had already named and exhausted
//    them (3 built / 4 dropped). This slice re-censused **all 651 Standard-legal
//    non-attack printings** against the remote D1 `luminous`
//    (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`; 3,786 rows / 20 sets, 2,021 legal)
//    on 2026-08-04 — every distinct sentence in `abilities_json` and in `effect`,
//    grouped by text and ranked by legal printings — and asked ONE question of
//    each: does it map onto ops that ALREADY EXIST, with no new op, no new field,
//    no new `CardFilter` kind and no change to any file outside this one?
//
//    ANSWER: **28 programs / 47 legal printings** — 7.2 % of the 651. The other
//    ~604 are OP-BOUND, not authoring-bound, and the twenty-odd cheapest of them
//    are named with their exact missing piece in `legalNonAttackPrograms.test.ts`
//    (`DROPPED`), which is this slice's real output: a ranked work order for the
//    engine changes that would unlock the next tranche.
//
//    ⚠️ THE DOCTRINE IS STILL *EXACT MAP OR FLAG* (D190). Nothing here is close;
//    a sentence that was close was dropped. Every row below is either a pure DATA
//    re-parameterisation of a program already in this file, or a two-op sequence
//    whose ops are each already driven by a shipped card.
//
//    ⚠️ AND EVERY COUNT IS A **LEGAL** COUNT. A registry row is keyed by CARD ID,
//    so it serves exactly the ids it names and legality is a hard filter — D190's
//    correction to D180, applied from the start here. ──

/** Team Rocket's Crobat ex sv10-122/-217/-234/-242 — "Biting Spree": "When you
    play this Pokémon from your hand to evolve 1 of your Pokémon during your
    turn, you may choose 2 of your opponent's Pokémon and put 2 damage counters
    on each of them."

    Hawlucha's `FLYING_ENTRY` (sv01-118) with TWO tokens changed and a third
    deliberately NOT changed. The amount is 20 HP (the printed 2 counters × 10,
    converted at the producer as every registry row does); the trigger is
    `onEvolve` where Hawlucha's is `onPlayToBench`; and the target is
    **`opponentAny`**, not `opponentBench` — the printed noun is "your opponent's
    Pokémon" with no zone word, so the Active is a candidate too (the Ninetales /
    Fezandipiti reading, D143). `optional: true` on BOTH the trigger and the op is
    Hawlucha's shape verbatim: the framework auto-fires the trigger, so the
    printed "you may" has nowhere to live but the pick, and the pick is
    all-or-nothing (2 refs or none, never one). 4 legal printings of 4 in the
    catalog — the biggest single row in this slice. */
/** 🆕 **D313 — Team Rocket's Crobat ex `sv10-122`/`-217`/`-234`/`-242`, THE CARD
    RATHER THAN THE SENTENCE**, because it now prints TWO mechanisms this registry
    programs. Attack index **0** "Assassin's Return", cost two {D}, `damage: 120`:
    *"You may put this Pokémon into your hand. (Discard all cards attached to this
    Pokémon.)"* **4 legal printings — the LARGEST single row in the self-removal
    family**, and the printings D312's word-order sweep found.

    🛑 **IT IS THE SPLIT DESTINATION, AND IT IS WHY `returnSelf` HAS A `dest` AT ALL
    NOW.** The body pile goes to the HAND and the attachments go to the DISCARD, so
    it is neither Lillie's Comfey's all-to-hand nor Revavroom ex's all-to-discard.
    D311 and D312 both REFUSED the field on the grounds that any enum authored over
    the destinations then known would not fit the next spelling; this slice authors
    it over **all four printed spellings at once** and drives every one — see the
    `returnSelf` block in `effects.ts` for the table and for why it is one zone plus
    an override rather than two free zones.

    ⚠️ **THE `optional` WRAPPER IS THE PRINTED *"You may"*, `SURF_BACK`'s reason
    verbatim** — an attack is DECLARED before its program runs, the Energy is spent
    and the 120 is already dealt, so the decision exists nowhere else and without the
    wrapper the card bounces itself against its controller's will. ⚠️ **AND THE
    PARENTHETICAL IS NOT A SECOND DECISION**: *"(Discard all cards attached…)"* is a
    reminder of the consequence of the first, so it lives inside the wrapper as a
    FIELD and never as its own gate.

    🛑 **THE CONST IS RENAMED FROM `BITING_SPREE` TO THE CARD, AND `fix-bitingspree`
    STAYS ON IT — WHICH THIS SLICE GOT WRONG FIRST AND THE SUITE CORRECTED.** D313's
    first draft gave the four printings a NEW object and left the demonstrator on a
    triggered-only one, reasoning that a demonstrator should not carry a program for
    an index its constructed card does not print. `legalNonAttackPrograms.test.ts`
    reddened on the spot: *"the demonstrator carries the SAME object, so what is
    driven below is literally what the printings resolve to — never a copy of it."*
    ⚠️ **A `fix-*` DEMONSTRATOR IS NOT A SMALLER PROGRAM, IT IS THE SAME PROGRAM ON
    A CONSTRUCTED BODY** — split them and every rung driven through the fixture is
    evidence about an object no printing resolves to. The inert index-0 entry on that
    fixture costs nothing (a program is only ever reached by declaring an attack the
    card prints); a divergent object would have cost the suite its meaning. */
const TEAM_ROCKETS_CROBAT_EX: CardProgram = {
  triggered: [
    {
      name: "Biting Spree",
      trigger: "onEvolve",
      optional: true,
      program: [
        {
          op: "damageChosen",
          target: "opponentAny",
          amount: 20,
          count: 2,
          source: "ability",
          optional: true,
        },
      ],
    },
  ],
  attack: {
    0: [
      {
        op: "optional",
        note: "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "returnSelf", dest: "hand", attachmentsTo: "discard" }],
      },
    ],
  },
};

/** Team Rocket's Golbat sv10-121 — "Sneaky Bite": the SAME sentence one line up
    with `count: 1` ("put 2 damage counters on 1 of your opponent's Pokémon").
    A separate const rather than a shared object because the sentences are not
    byte-identical — D190's rule, and the pre-evolution of the very card above,
    so a shared object would be the easiest wrong edit in the file. 1 legal
    printing. */
const SNEAKY_BITE: CardProgram = {
  triggered: [
    {
      name: "Sneaky Bite",
      trigger: "onEvolve",
      optional: true,
      program: [
        {
          op: "damageChosen",
          target: "opponentAny",
          amount: 20,
          count: 1,
          source: "ability",
          optional: true,
        },
      ],
    },
  ],
};

/** Tatsugiri svp-118 / sv06-131 / sv06-186 — "Attract Customers": "Once during
    your turn, if this Pokémon is in the Active Spot, you may look at the top 6
    cards of your deck, reveal a Supporter card you find there, and put it into
    your hand. Shuffle the other cards back into your deck."

    Pokégear 3.0's program (`sv01-186`) with `n: 6` for 7, lifted onto the
    ABILITY surface — the first `lookAtTopN` consumer that is not a Trainer. Every
    clause maps: "if this Pokémon is in the Active Spot" → `activeOnly`, "Once
    during your turn" → `oncePerTurn`, "a Supporter card" → `max: 1` with the
    `supporter` filter, "Shuffle the other cards back" → the trailing
    `shuffleDeck` op (the Nest Ball pattern: a whiff still shuffles).
    3 legal printings of 3 in the catalog. */
const ATTRACT_CUSTOMERS: CardProgram = {
  abilities: [
    {
      name: "Attract Customers",
      oncePerTurn: true,
      activeOnly: true,
      program: [
        { op: "lookAtTopN", n: 6, filter: { kind: "supporter" }, max: 1, reveal: true },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Volcanion ex sv09-031/-171/-182 — "Scalding Steam": "Once during your turn,
    if this Pokémon is in the Active Spot, you may make your opponent's Active
    Pokémon Burned."

    ⚠️ THE FIRST ACTIVATED ABILITY IN THIS REGISTRY THAT APPLIES A §12 CONDITION,
    and it needs nothing: `applyStatus`'s `"defender"` arm resolves to
    `otherSeat(ctx.seat)`'s Active (interpreter.ts), which in a Trainer/Ability
    program IS "your opponent's Active Pokémon". The arm has been controller-
    relative since M4 — Armarouge's `SCORCHING_ARMOR` already drives it from a
    TRIGGERED Ability — so the only new thing here is which surface authors it.
    3 legal printings of 3 in the catalog. */
const SCALDING_STEAM: CardProgram = {
  abilities: [
    {
      name: "Scalding Steam",
      oncePerTurn: true,
      activeOnly: true,
      program: [{ op: "applyStatus", target: "defender", status: "burned" }],
    },
  ],
};

/** Shiinotic sv08-009/-194 — "Calming Light": the sentence directly above with
    **Asleep** for Burned. Separate const, D190's rule (not byte-identical), and
    the token difference is load-bearing in a way the Burn one is not: Asleep is
    the §12 ROTATION slot and Burned is its own flag, so a copy-paste that kept
    `"burned"` would leave the rotation slot untouched and the test would see it.
    2 legal printings of 2 in the catalog. */
const CALMING_LIGHT: CardProgram = {
  abilities: [
    {
      name: "Calming Light",
      oncePerTurn: true,
      activeOnly: true,
      program: [{ op: "applyStatus", target: "defender", status: "asleep" }],
    },
  ],
};

/** Durant ex sv08-004/-215/-236 — "Sudden Shearing": "When you play this Pokémon
    from your hand onto your Bench during your turn, you may discard the top card
    of your opponent's deck."

    Flamigo's `onPlayToBench` trigger carrying D130's `discardDeckTop` — two
    shipped mechanisms meeting for the first time. `whose: "opponent"` is the
    printed possessive; `count: 1` is the printed singular; `optional: true` is
    the printed "you may" (auto-fired, and the op has no decline of its own — it
    never parks — so the "may" is honoured by the trigger flag alone, which is the
    same reading `optional` gets on every non-parking trigger). 3 legal printings
    of 3 in the catalog. */
const SUDDEN_SHEARING: CardProgram = {
  triggered: [
    {
      name: "Sudden Shearing",
      trigger: "onPlayToBench",
      optional: true,
      program: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
    },
  ],
};

/** Hop's Dubwool sv09-136 — "Defiant Horn": "When you play this Pokémon from
    your hand to evolve 1 of your Pokémon during your turn, you may switch in 1
    of your opponent's Benched Pokémon to the Active Spot."

    A bare `gust` on the `onEvolve` trigger — Boss's Orders' one op, fired by
    Arboliva's timing. 1 legal printing. */
const DEFIANT_HORN: CardProgram = {
  triggered: [
    { name: "Defiant Horn", trigger: "onEvolve", optional: true, program: [{ op: "gust" }] },
  ],
};

/** 🆕 D319 — Team Rocket's Ampharos sv10-074 — "Darkest Impulse": *"Whenever your
    opponent plays a Pokémon from their hand to evolve 1 of their Pokémon, put 4
    damage counters on that Pokémon. The effect of Darkest Impulse doesn't stack."*

    **1 legal printing, Stage 2, evolves from Team Rocket's Flaaffy** — remote D1
    `luminous`, `instr(abilities_json,'to evolve 1 of their') > 0` over all 3,786
    rows returns exactly this one, and it is the EVOLVE half of a two-verb family
    whose other half is `GNAWING_CURSE` below.

    THREE FIELDS AND EACH ONE IS A DIFFERENT CLAUSE OF THE SENTENCE:
      • `trigger: "onEvolve"` — *"…to evolve 1 of their Pokémon"*, the same MOMENT
        Arboliva's "Enriching Oil" watches;
      • `opponentAction: true` — *"Whenever **your opponent**…"*, the direction,
        which is also what stops the SELF scan firing this row on the Ampharos
        the moment its own controller evolves Flaaffy into it;
      • `doesNotStack: true` — the printed last sentence.
    And *"from their hand"* is a clause with NO field, because the SCAN SITE is
    the gate: turn.ts `placeEvolution` is reached only by the two hand routes.

    NOT `optional` — the sentence has no *"you may"*, and unlike every other
    trigger in this file the consequent is a DOWNSIDE for the seat being asked.
    The auto-fire note on `TriggeredAbility.optional` reasons from "every
    representative is pure upside"; this one is not, and it does not need to be,
    because it is not optional at all. */
const DARKEST_IMPULSE: CardProgram = {
  triggered: [
    {
      name: "Darkest Impulse",
      trigger: "onEvolve",
      opponentAction: true,
      doesNotStack: true,
      program: [{ op: "damageSubject", amount: 40 }],
    },
  ],
};

/** 🆕 D319 — Gengar ex sv05-104/-193 — "Gnawing Curse": *"Whenever your opponent
    attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage
    counters on that Pokémon."*

    **2 legal printings on ONE sentence** (`sv05-104` and its `-193` reprint;
    remote D1 `luminous`, 2026-08-10). The ATTACH half of the family — the same
    direction, the same op, a different moment and a different amount.

    🛑 **AND IT IS THE ROW THAT MAKES `doesNotStack` A CLAIM RATHER THAN A
    DEFAULT: THIS SENTENCE DOES NOT PRINT THE CLAUSE**, so two Gengar ex on one
    board place 2 counters EACH. The handoff priced this verb at ZERO on the
    ground that its only printing was the rotated Minun `sv04-061`/`-194` "Buddy
    Pulse"; Minun is in fact THIS sentence with *"If you have Plusle in play,"*
    prefixed and the stacking clause appended, and the LEGAL member of the pair
    is Gengar ex. **A price can be right about a family and wrong about which of
    its members is standing.**

    `onEnergyAttach` is a new TIMING because the moment is new; the direction is
    the same `opponentAction` field the evolve half carries, which is exactly the
    "a second row, not a second mechanism" the handoff asked for. */
const GNAWING_CURSE: CardProgram = {
  triggered: [
    {
      name: "Gnawing Curse",
      trigger: "onEnergyAttach",
      opponentAction: true,
      program: [{ op: "damageSubject", amount: 20 }],
    },
  ],
};

/** 🆕 D356 — Magearna sv09-107 — "Auto Heal": *"**As long as this Pokémon is in
    the Active Spot,** whenever you attach an Energy card from your hand to 1 of
    your Pokémon, heal 90 damage from that Pokémon."*

    **THE FIRST PRINTING OF `onEnergyAttach`'s SELF DIRECTION**, which D319 spelled
    and left unpopulated in this very file: *"the self direction is spelled and
    unpopulated, exactly like a union member waiting for its first printing."*

    🛑 **AND THAT SENTENCE IS WHY THE TWO PRIOR REFUSALS WERE PRICED WRONG.** D354
    and D355 both refused this row as *"a whole new `triggers.ts` trigger point for
    1 legal printing"*. The RATIO was right — remote D1 `luminous`, 2026-08-16:
    `'whenever you attach'` returns **3** rows over `abilities_json` and **0** over
    `attacks_json` and `effect`, and of the 3 only this one is `legal_standard = 1`
    (Minior `sv04-099`/`sv04-201` are rotated out, and are the SAME timing with a
    switch consequent). The PRICE was not: the timing, the moment's fire site
    (turn.ts §6.2), the direction partition (`triggersOf`'s `watch`) and the
    Active-Spot gate (`activeOnly`) all already existed. What was actually owed was
    a self-direction sweep and a subject-targeted heal.
    **A REFUSAL INHERITED IS NOT A MEASUREMENT — AND THE THING IT WAS INHERITED
    ABOUT HERE WAS THE COST, NOT THE POPULATION.**

    ⚠️ **THE PRINTED SENTENCE CARRIES A CLAUSE EVERY PRIOR QUOTE OF IT DROPPED.**
    Three test files and the resume point all quoted this ability starting at
    *"whenever you attach"*; the card actually opens *"As long as this Pokémon is
    in the Active Spot,"*. That clause is `activeOnly: true`, a field that has
    existed since M4 slice 6 — so the dropped words were themselves part of why
    the price read high.

    Two fields, both already spelled, and ONE new op:
      • `trigger: "onEnergyAttach"` — D319's timing, unchanged;
      • `activeOnly: true` — the Active-Spot clause;
      • `opponentAction` ABSENT — *"whenever **you** attach"*, so the sweep is the
        self direction and the default (false) is the whole spelling of it.
    `doesNotStack` is NOT printed, and cannot matter here anyway: `activeOnly`
    means at most one Magearna can ever be a bearer. */
const AUTO_HEAL: CardProgram = {
  triggered: [
    {
      name: "Auto Heal",
      trigger: "onEnergyAttach",
      activeOnly: true,
      program: [{ op: "healSubject", amount: 90 }],
    },
  ],
};

/** 🆕 D320 — Magcargo sv05-029 — "Lava Zone": *"Whenever your opponent's Active
    Pokémon moves to the Bench during their turn, their new Active Pokémon is now
    Burned."*

    **1 legal printing on ONE sentence, and the family CLOSES at 1 of 1.** The
    literal `'moves to the Bench'` returns exactly ONE row over all 3,786 across
    `abilities_json`, `attacks_json` AND `effect`; so does `'during their turn'`
    over `abilities_json` (remote D1 `luminous`, 2026-08-10). The wider
    `'new Active'` sweep returns 44 legal rows and every other one of them is a
    switch-out attack's parenthetical *"(Your opponent chooses the new Active
    Pokémon.)"* or an ACTIVATED Ability — no *"Whenever"* among them — which is
    why a census on the consequent side alone could never have priced this row.

    THE THIRD VERB OF D319's OPPONENT-ACTION FAMILY, AND THE FIRST WHOSE
    CONSEQUENT IS NOT DAMAGE. Two fields, both already spelled:
      • `trigger: "onActiveMovedToBench"` — the new MOMENT, which is a board
        move rather than a hand play, so *"from their hand"*'s scan-site gate
        (D319) has no analogue here;
      • `opponentAction: true` — *"Whenever **your opponent's** Active…"*, the
        direction, so the row is found by sweeping the OTHER seat's board.
    NOT `doesNotStack`: this sentence does not print the clause, so two Magcargo
    are two firings — and Burned is idempotent on the board anyway, which is
    precisely why the flag must be read off the PRINT and never off the
    observable effect.

    🛑 **THE CONSEQUENT IS `applyStatus target: "defender"` AND NOT
    `damageSubject`, AND THE DIFFERENCE IS WHICH BODY THE SENTENCE NAMES.**
    D319's op resolves `ctx.subjectUid` — the body the watched action was
    performed ON. Here that body is the one that MOVED TO THE BENCH, and the
    sentence's consequent is about *"their **new** Active Pokémon"*, a different
    body in a different spot. `applyStatus`'s `defender` arm is
    `otherSeat(ctx.seat).active`, and `ctx.seat` in a watched trigger is the
    WATCHER — so `defender` IS the printed noun, exactly, with no new op.

    ⚠️ NOT `optional` — no *"you may"* — and like Darkest Impulse the consequent
    is a DOWNSIDE for the seat being asked, so the auto-fire note on
    `TriggeredAbility.optional` does not have to cover it. */
const LAVA_ZONE: CardProgram = {
  triggered: [
    {
      name: "Lava Zone",
      trigger: "onActiveMovedToBench",
      opponentAction: true,
      program: [{ op: "applyStatus", target: "defender", status: "burned" }],
    },
  ],
};

/** Iron Leaves ex svp-128/sv05-025/-186/-203/-213/sv08.5-176 — "Rapid Vernier":
    "When you play this Pokémon from your hand onto your Bench during your turn,
    you may switch it with your Active Pokémon. If you do, you may move any
    amount of Energy from your other Pokémon to this Pokémon."

    **6 Standard-legal printings on ONE sentence** (`GROUP BY` over
    `json_each(abilities_json)` with `legal_standard = 1`, remote D1 `luminous`,
    2026-08-06 — the ids are exactly the six `coverage-backlog-legal.md` row 14-R
    names, re-derived rather than inherited). Backlog row 14-R, and the last
    third of row 14.

    THE SENTENCE IS THREE PRINTED CLAUSES AND EACH IS ONE OP:
      • *"When you play this Pokémon … onto your Bench during your turn"* — the
        `onPlayToBench` timing, shipped since M4 slice 6 (Flamigo, Durant ex).
      • *"you may switch **it** with your Active Pokémon"* — `switchActive`
        with D244's `fromSource`, the printed PRONOUN. `recordAs: "moved"` files
        the uid that actually became Active.
      • *"**If you do**, you may move **any amount** of Energy from your **other**
        Pokémon to **this** Pokémon"* — the §9.2 `recordGate` on that slot, over
        `moveEnergy` on D244's `othersToSelf` route with `max: "any"`.

    ⚠️ **THE OUTER `optional` OP IS THE PRINTED "YOU MAY", AND IT IS THE FIRST
    TRIGGER IN THIS REGISTRY TO NEED ONE.** `TriggeredAbility.optional` AUTO-FIRES
    (its own doc: "every representative is pure upside … a yes/no confirm for a
    trigger with a downside is the follow-up"). This is that follow-up: switching
    a just-benched body into the Active Spot is a REAL downside — it exposes a
    fresh Pokémon to the opponent's next attack and sends the current Active to
    the Bench — so auto-firing would take a decision away from the player rather
    than hand them upside. The flag stays `true` beside it because it is still the
    printed "you may"; the OP is where the answer lives.

    ⚠️ **AND THE SECOND "you may" NEEDS NO WRAPPER**, which is the `optional` op's
    own rule read off the card: `moveEnergy` PARKS WITH A LEGAL EMPTY ANSWER, so
    the decline the wrapper would grant is one its prompt already offers, and
    wrapping it would ask the same question twice.

    ⚠️ **THE FILTER IS `anyEnergy`** — the sentence says "Energy", unqualified,
    so Special Energy moves too (the `basicEnergy` narrowing is a different
    printed word, and Energy Switch is the card that prints it).

    ⚠️ **`anySource` IS THE PRINTED PLURAL** ("your other Pokémon", not "1 of your
    other Pokémon"), so one answer may sweep Energy off several bodies at once —
    N's Plan's rider at its second route. Without it `validateChoice` would refuse
    exactly the answer the card describes. */
const RAPID_VERNIER: CardProgram = {
  triggered: [
    {
      name: "Rapid Vernier",
      trigger: "onPlayToBench",
      optional: true,
      program: [
        {
          op: "optional",
          note: "You may switch this Pokémon with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon.",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [
            { op: "switchActive", fromSource: true, recordAs: "moved" },
            {
              op: "recordGate",
              slot: "moved",
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
              then: [
                {
                  op: "moveEnergy",
                  filter: { kind: "anyEnergy" },
                  max: "any",
                  route: "othersToSelf",
                  anySource: true,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** Meowscarada sv09-018 — "Showtime": "Once during your turn, if this Pokémon is
    on your Bench, you may switch it with your Active Pokémon."

    **1 Standard-legal printing**, and it is here because it is the SECOND printed
    sentence of `switchActive.fromSource` rather than because a backlog row asked
    for it — the row-14-R census widened from the row's own ids to the printed
    PRONOUN found it (`LIKE '%you may switch it with your active pok%'` over
    `json_each(abilities_json)`: 7 legal on 2 sentences, plus 2 rotated Minior
    printings whose antecedent is an ATTACH and which stay unbuilt).

    ⚠️ **IT IS WHAT MAKES THE `programPlayable` READ SITE DRIVABLE**, which is the
    whole reason it is worth its five lines. Iron Leaves' program is a TRIGGER and
    never passes through that gate; "Showtime" is player-ACTIVATED, so
    `switchActiveTargets`' new `sourceUid` parameter is exercised by a real card
    on a real board — and the printed *"if this Pokémon is on your Bench"* is
    enforced BY that gate rather than by a flag, because a source in the Active
    Spot has no bench ref to switch with. Delete the parameter and an Active
    Meowscarada offers a switch with itself.

    ⚠️ **NO ENERGY TAIL** — this is the bare pronoun switch, which is exactly the
    contrast worth keeping: the `fromSource` rider is one field and it is not
    welded to Iron Leaves' second clause. */
const SHOWTIME: CardProgram = {
  abilities: [
    {
      name: "Showtime",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "switchActive", fromSource: true }],
    },
  ],
};

/** ⚠️ **A CONSTRUCTED PROGRAM — NO PRINTED CARD CARRIES IT, AND IT EXISTS TO PIN
    A FLAGGED EQUIVALENCE.** `moveEnergy { route: "othersToSelf" }` behind Iron
    Leaves' switch is INDISTINGUISHABLE from `benchToActive` + `anySource`: the
    tail runs only after the `recordGate`, by which point the source IS the Active,
    so "every own body except the source" is the Bench and "the source" is the
    Active on all six printed boards.

    The separating board is a bare `othersToSelf` used from the BENCH — sources
    then INCLUDE the Active and the destination is a benched body, which
    `benchToActive` reverses exactly. `fix-othersmove` is that board, and
    `D244-othersToSelf-is-benchToActive` is the mutant installing the other
    reading. Same doctrine as the tails-gated Trainer in `programPlayable`'s doc:
    a rule with no card gets a constructed case rather than a silent assumption.

    Registered on a `fix-*` id ONLY — the manifest generator skips those, and a
    program with no printing behind it must never be reachable from a real card
    (D190b: whatever is authored is what the card does forever). */
const GATHER_INWARD: CardProgram = {
  abilities: [
    {
      name: "Gather Inward",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "anyEnergy" },
          max: "any",
          route: "othersToSelf",
          anySource: true,
        },
      ],
    },
  ],
};

/** Emboar sv10.5w-013/-098 — "Inferno Fandango": "As often as you like during
    your turn, you may attach a Basic {R} Energy card from your hand to 1 of your
    Pokémon."

    Baxcalibur's `SUPER_COLD` (sv02-060) with `"Fire"` for `"Water"` — the printed
    sentence is otherwise byte-identical, including "As often as you like" →
    `oncePerTurn: false` (so it never locks out) and "1 of your Pokémon" → no
    target rider at all. A PURE DATA ROW. 2 legal printings of 2 in the catalog. */
const INFERNO_FANDANGO: CardProgram = {
  abilities: [
    {
      name: "Inferno Fandango",
      oncePerTurn: false,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "hand", energyType: "Fire" }],
    },
  ],
};

/** Blaziken ex sv09-024 — "Seething Spirit": "Once during your turn, you may
    attach a Basic Energy card from your discard pile to 1 of your Pokémon."

    ⚠️ THE REAL CARD `fix-attacher` WAS STANDING IN FOR. That fixture was invented
    at the `attachEnergyFrom` slice because the local catalog held no printed
    discard-source attach with no riders; this is exactly that sentence, one type
    filter LOOSER (the fixture attaches a Basic Fire), and it is Standard-legal.
    1 legal printing. */
const SEETHING_SPIRIT: CardProgram = {
  abilities: [
    {
      name: "Seething Spirit",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "discard" }],
    },
  ],
};

/** ⚠️⚠️ D263 — Team Rocket's Spidops sv10-020/sv10-187 — "Charging Up": "Once
    during your turn, you may attach a Basic Energy card from your discard pile
    to **this Pokémon**." **2 Standard-legal printings on ONE sentence.**

    `SEETHING_SPIRIT` with `toSelf` — and the rider is the WHOLE difference
    between the two rows rather than a decoration. Blaziken ex prints *"1 of your
    Pokémon"*, a CLASS with every own body in it, which PARKS; this prints the
    UID question (D221), which forces. On a board with a Bench the two programs
    do observably different things, which is what `legalNonAttackPrograms.test.ts`
    drives and what `D263-charging-up-loses-toself` mutates. */
const CHARGING_UP: CardProgram = {
  abilities: [
    {
      name: "Charging Up",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "attachEnergyFrom", source: "discard", toSelf: true }],
    },
  ],
};

/** ⚠️⚠️ D263 — Eelektrik sv10.5b-031/sv10.5b-114 — "Dynamotor": "Once during
    your turn, you may attach a Basic {L} Energy card from your discard pile to
    **1 of your Benched Pokémon**." **2 Standard-legal printings on ONE
    sentence.**

    The same op as `CHARGING_UP` wearing the OTHER two riders the print spells:
    `energyType` for the brace code and `benchOnly` for the zone word. ⚠️ THE
    ZONE WORD IS LOAD-BEARING ON THIS CARD IN A WAY IT IS NOT ON N's PP Up (the
    only other `benchOnly` attach in the registry): the Ability's HOLDER is
    usually the Active, so a dropped `benchOnly` feeds the holder itself — the
    exact defect `D263-dynamotor-loses-benchonly` installs, and the reason the
    driven board keeps the Active at ZERO Energy rather than only asserting that
    the Bench gained one. */
const DYNAMOTOR: CardProgram = {
  abilities: [
    {
      name: "Dynamotor",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "attachEnergyFrom", source: "discard", energyType: "Lightning", benchOnly: true },
      ],
    },
  ],
};

/** ⚠️⚠️ D263 — Archaludon ex sv08-130/sv08-224/sv08-241 — "Assemble Alloy":
    "When you play this Pokémon from your hand to evolve 1 of your Pokémon during
    your turn, you may attach up to 2 Basic {M} Energy cards from your discard
    pile to your {M} Pokémon **in any way you like**." **3 Standard-legal
    printings on ONE sentence** — the largest row the D263 ladder found, and the
    largest zero-seam row left in backlog row 9's ability half.

    🛑 **TWO OPS AND NOT `count: 2`, WHICH IS D205's DISTINCTION ARRIVING ON THE
    TRIGGER SURFACE FOR THE FIRST TIME.** `count` pins a batch to the ONE body
    the print names; the printed *"in any way you like"* is N INDEPENDENT
    decisions that may land on N different bodies. `attachFromZoneProgram` emits
    exactly this expansion for the ATTACK half of the same family
    (`destination.anyWay ? Array.from({length: count}, …) : [ … count … ]`), so
    this hand-authored row is that deriver's own output written out — the two
    cannot disagree about what the phrase means, because the shape is quoted.

    ⚠️ **`energyType` AND `targetType` ARE THE SAME PRINTED BRACE CODE ON TWO
    DIFFERENT NOUNS, AND BOTH ARE SPELLED.** `{M}` first narrows WHICH card comes
    out of the pile (a Basic Metal Energy) and then WHICH bodies may receive it
    (a {M} Pokémon, read off `topCardOf` by `attachEnergyTargets`). Dropping
    either leaves a program that still attaches something, which is why they are
    mutated separately.

    ⚠️ **`optional: true` IS THE PRINTED "you may" AND IT AUTO-FIRES**, exactly as
    `BATTLE_HARDENED`'s does — the attach itself PARKS ~~and a park is declinable
    by construction, so nothing is forced on the controller~~. ZERO new ops, ZERO
    new op fields: `onEvolve` (M4 slice 6 / D250), `energyType`, `targetType`
    (D235) and `source: "discard"` (D234) were all lying around.

    🛑🛑 **D351 — THE STRUCK CLAUSE IS FALSE, AND IT WAS FALSE WHEN IT WAS
    WRITTEN.** It is STRUCK rather than rewritten (D178) because the sentence
    around it is still true and because a claim that was never driven should stay
    visible as one. `parkOrForce` has three arms and NONE is a decline: zero
    candidates is a silent no-op, ONE candidate is FORCED (the M1 no-choice rule),
    and two or more park a `choosePokemon` whose only legal answer is
    `{ kind: "pokemon", ref }` — `EffectPrompt` has no optional/`min: 0` member and
    `resolveEffect` refuses anything else with `BAD_EFFECT_CHOICE`. So this row's
    printed *"up to 2"* resolves as EXACTLY 2 whenever the pile holds two, and the
    controller is never asked. ⚠️ **NOT TRUE OF EVERY PARK, WHICH IS WHY THE CLAIM
    READ AS OBVIOUS**: three prompt kinds really ARE declinable and say so in their
    own docs — `chooseCards`, `moveEnergy` ("an empty `uids` is a decline") and,
    sharpest of all, **`attachCards`**, the compound park the OTHER THREE attach
    ops produce ("an empty list is a legal decline"). So the word is right on every
    attach route except the one this op takes, which is exactly the shape of claim
    that survives review. Driven and pinned in `pyroDance.test.ts` §5, on the row
    that shares this printed grammar. **The missing capability is a DECLINABLE
    POKÉMON PARK** — a prompt member, a choice member, a wire-schema field and a
    validator arm — and the whole pool drives it with this sentence and Pyro
    Dance's, 5 legal printings between them. Unbought, and named here rather than
    discovered a third time. */
const ASSEMBLE_ALLOY: CardProgram = {
  triggered: [
    {
      name: "Assemble Alloy",
      trigger: "onEvolve",
      optional: true,
      program: [
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: "Metal",
          targetType: "Metal",
          declinable: true,
        },
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: "Metal",
          targetType: "Metal",
          declinable: true,
        },
      ],
    },
  ],
};

/** Alcremie ex sv09-075 — "Confectionary Gift": "Once during your turn, you may
    heal 30 damage from 1 of your Pokémon."

    Potion's op (`healChosen`, amount 30, no `zone`, no `upTo` — the printed exact
    "1 of your Pokémon") on the Ability surface. 1 legal printing. */
const CONFECTIONARY_GIFT: CardProgram = {
  abilities: [
    {
      name: "Confectionary Gift",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "healChosen", amount: 30 }],
    },
  ],
};

/** Hoothoot sv08.5-077 — "Insomnia": "This Pokémon can't be Asleep."

    Pachirisu's `ELECTRICITY_POUCHES` with one `StatusName` changed. ⚠️ IT IS THE
    §12 IMMUNITY FAMILY'S FOURTH SENTENCE, and D174 closed that family "at 3 of 3
    sentences and 4 of 4 printings" — a claim measured over the LOCAL 978-row /
    6-set catalog, which holds no `sv08.5`. The claim is true of that population
    and false of the Standard-legal one; `statusImmunity.test.ts` sweeps
    `FIXTURE_POOL`, so it does not go red, and saying so here is the alternative
    to letting a stale "CLOSED" read as a measurement of the legal pool.
    1 legal printing. */
const INSOMNIA: CardProgram = { passive: { statusImmunities: ["asleep"] } };

/** Team Rocket's Porygon-Z sv10-155 — "Reconstitute": "You must discard 2 cards
    from your hand in order to use this Ability. Once during your turn, you may
    draw a card."

    N's Zoroark ex's `TRADE` (D190) with the two numbers swapped — pay 2, draw 1.
    The cost is the program's first op and `useAbility` refuses the use when it
    cannot be paid (cardplay.ts `handCostUnmet`). 1 legal printing. */
const RECONSTITUTE: CardProgram = {
  abilities: [
    {
      name: "Reconstitute",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "payFromHand", count: 2, to: "discard" },
        { op: "drawCards", count: 1 },
      ],
    },
  ],
};

/** Quaquaval sv08-052 — "Up-Tempo": "You must put a card from your hand on the
    bottom of your deck in order to use this Ability. Once during your turn, you
    may draw cards until you have 5 cards in your hand."

    ⚠️ THE FIRST ABILITY IN THIS REGISTRY WHOSE HAND COST IS NOT A DISCARD.
    `payFromHand.to` has carried `"deckBottom"` since Dendra (a SUPPORTER), and
    `useAbility`'s refusal message was already written to read the destination
    rather than hard-code the word "discard" — cardplay.ts says so in a comment
    that ends "no printed Ability pays anywhere but the discard today". This is
    that card, and the generality it was written for is now exercised.
    Note the ORDER: the payment happens first, so `drawUntilHandSize` measures the
    hand AFTER it shrank, which is what the printed sentence order means.
    1 legal printing. (The id collides in NAME only with `sv01-054` Quaquaval
    "Energy Carnival" — a different printing with a different Ability, and the
    registry is keyed by id.) */
const UP_TEMPO: CardProgram = {
  abilities: [
    {
      name: "Up-Tempo",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "payFromHand", count: 1, to: "deckBottom" },
        { op: "drawUntilHandSize", size: 5 },
      ],
    },
  ],
};

/** Enhanced Hammer sv06-148/-224 — "Discard a Special Energy from 1 of your
    opponent's Pokémon." (Item)

    `fix-hammer`'s program — the `opponentChosen` discard with NO coin gate — with
    Giacomo's `specialEnergy` filter for `anyEnergy`. The fixture was invented at
    the `discardEnergy` slice precisely because the local catalog held no printed
    ungated `opponentChosen` discard; this is one, it is Standard-legal, and it
    NARROWS to Special Energy. `count` absent = the printed singular "a".
    `discardEnergyPlayable` refuses the play into a board with no Special Energy —
    Crushing Hammer's gate, reached without the coin. 2 legal printings of 2. */
const ENHANCED_HAMMER: CardProgram = {
  trainer: [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "specialEnergy" } }],
};

/** Fennel sv10.5b-082/-162 — "Heal 40 damage from each of your Pokémon."
    (Supporter)

    Garganacl's `healEach` at 40 — the CONTROLLER's Active and whole Bench, each
    heal clamped independently. Deliberately NOT `healEachAll` (Picnic Basket),
    whose sentence prints "(both yours and your opponent's)": the absent
    parenthetical is the entire difference between the two ops, and it is the one
    thing a plausible mis-authoring gets wrong. 2 legal printings of 2. */
const FENNEL: CardProgram = { trainer: [{ op: "healEach", amount: 40 }] };

/** Clemont's Quick Wit sv08-167 / sv08-229 / sv08-243 — "Heal 60 damage from
    each of your {L} Pokémon." (Supporter)

    Fennel's op with D266's TYPE GATE and nothing else: `healEach` already had
    the seat, the per-Pokémon clamp and the silent whiff, and Fennel is the
    UNGATED printing of the same sentence that proves the op was otherwise
    right — which is exactly what this row's `needs` string in
    `legalNonAttackPrograms.test.ts` claimed, re-read against the code before it
    was built rather than inherited.

    ⚠️ **`pokemonType` IS A `PokemonType` AND THE FIELD IS THE GUARD.** The
    printed `{L}` is the brace code `POKEMON_TYPE_BY_CODE` maps to `Lightning`;
    there is no DERIVER on this path — the row is hand-authored — so what refuses
    a mis-spelled type here is the TYPE, not a regex. `"Electric"` or `"{L}"`
    does not compile.

    ⚠️ **NOT `healEachAll`** (Picnic Basket) for Fennel's reason restated: the
    absent parenthetical "(both yours and your opponent's)" is the whole
    difference, and the OPPONENT's {L} Pokémon are not "your {L} Pokémon".
    3 legal printings of 3 — `-229` and `-243` are the set's two alternate-art
    reprints of `-167`, one sentence. */
const CLEMONTS_QUICK_WIT: CardProgram = {
  trainer: [{ op: "healEach", amount: 60, pokemonType: "Lightning" }],
};

/** Night Stretcher sv06.5-061 / sv08-251 — "Put a Pokémon or a Basic Energy card
    from your discard pile into your hand." (Item)

    Super Rod's `pokemonOrBasicEnergy` filter — the "any combination" predicate —
    pointed at the HAND with `max: 1` (the printed singular "a"), and with NO
    trailing shuffle, because nothing goes back to the deck. 2 legal printings. */
const NIGHT_STRETCHER: CardProgram = {
  trainer: [
    { op: "discardPileRetrieval", filter: { kind: "pokemonOrBasicEnergy" }, dest: "hand", max: 1 },
  ],
};

/** Max Rod sv08.5-116 — "Put up to 5 in any combination of Pokémon and Basic
    Energy cards from your discard pile into your hand." (Item) — Night
    Stretcher's op with the printed "up to 5". 1 legal printing. */
const MAX_ROD: CardProgram = {
  trainer: [
    { op: "discardPileRetrieval", filter: { kind: "pokemonOrBasicEnergy" }, dest: "hand", max: 5 },
  ],
};

/** Lana's Aid sv06-155 / sv06-207 / sv06-219 — "Put up to 3 in any combination
    of Pokémon that don't have a Rule Box and Basic Energy cards from your discard
    pile into your hand. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)"
    (Supporter)

    **MAX ROD's PROGRAM WITH ONE NARROWER HALF.** Same op, same destination, same
    "up to N in any combination" grammar; the only printed difference is that the
    Pokémon side excludes Rule-Box cards, and that is a `CardFilter` question the
    vocabulary already knew how to ask — one member over.

    ⚠️ **IT IS `anyOf`, NOT `pokemonOrBasicEnergy`, AND THAT IS THE CHEAPER
    ANSWER RATHER THAN THE MORE GENERAL ONE.** D245's combinator already spells
    "a set built from two nouns"; hanging a `noRuleBox` rider on the hand-rolled
    `pokemonOrBasicEnergy` would have put a second, private copy of the axis on a
    member that exists only because the combinator did not yet. This is the first
    `anyOf` in the registry, and the first anywhere that a PROMPT can reach — the
    only prior printing carrying one is a passive aura that parks nothing, so its
    caption arm had no witness until now.

    ⚠️ **`noRuleBox` RIDES `anyPokemon` AND NOT `basicPokemon`.** Artazon's filter
    names "a **Basic** Pokémon that doesn't have a Rule Box"; this sentence names
    "Pokémon", any stage. The Basic-only filter would compile, caption almost
    right, and silently refuse every Stage 1 / Stage 2 in the pile — which is
    exactly the mutant this row ships with.

    NO trailing shuffle (nothing goes back to the deck) and NO `recordAs`: the
    printed parenthetical defines "Rule Box" rather than adding a clause.
    3 legal printings on 1 sentence. */
const LANAS_AID: CardProgram = {
  trainer: [
    {
      op: "discardPileRetrieval",
      filter: {
        kind: "anyOf",
        filters: [{ kind: "anyPokemon", noRuleBox: true }, { kind: "basicEnergy" }],
      },
      dest: "hand",
      max: 3,
    },
  ],
};

/** Arven's Greedent sv10-159 / sv10-205 — "Greedy Order": "When you play this
    Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may
    put up to 2 Arven's Sandwich cards from your discard pile into your hand."

    **ARCHALUDON's TRIGGER OVER NIGHT STRETCHER's OP, AND ZERO ENGINE CODE
    BETWEEN THEM.** `onEvolve` (D250) with `optional: true` for the printed "you
    may" — the retrieval PARKS, so the offer is declinable by construction and
    nothing is forced — and one `discardPileRetrieval` at `max: 2` into the hand.

    ⚠️ **THE FILTER IS `byName` AND THE CARD IT NAMES IS REACHABLE**: Arven's
    Sandwich `sv10-161` is a Standard-legal Item, checked against the catalog
    before this row was written, because a `byName` filter over a name no legal
    card carries is a program that can never do anything (the D207 shape).

    ⚠️ **`cardNoun: true` IS THE PRINTED "cards" AND IT IS THIS ROW'S ONLY NEW
    BYTE OF VOCABULARY.** Flamigo's `byName` names a POKÉMON and prints bare ("up
    to 3 Flamigo"); a TRAINER name prints the noun after it. Without the rider the
    prompt would read "Put up to 2 Arven's Sandwich from your discard pile into
    your hand." — the dialog spelling the card's own sentence differently from the
    card. 2 legal printings on 1 sentence. */
const GREEDY_ORDER: CardProgram = {
  triggered: [
    {
      name: "Greedy Order",
      trigger: "onEvolve",
      optional: true,
      program: [
        {
          op: "discardPileRetrieval",
          filter: { kind: "byName", name: "Arven's Sandwich", cardNoun: true },
          dest: "hand",
          max: 2,
        },
      ],
    },
  ],
};

/** 🆕🆕 **D350 — Lillie's Ribombee `sv09-067` / `sv09-164` / `svp-183` — "Inviting
    Wink"** (Stage 1, **3 legal printings on ONE byte-identical sentence** — remote
    D1 `luminous`, 2026-08-15, `json_each(abilities_json)` keyed on `$.effect` and
    grouped so the unit is a SENTENCE; the three ids are the whole population):

    *"When you play this Pokémon from your hand to evolve 1 of your Pokémon during
    your turn, you may have your opponent reveal their hand and you put any number
    of Basic Pokémon you find there onto their Bench."*

    🛑 **MANDIBUZZ'S OP ON ARVEN'S GREEDENT'S TRIGGER, AND THE ENGINE DIFF IS ONE
    UNION MEMBER.** Every other piece was lying around:
      • `trigger: "onEvolve"` (D250) + `optional: true` — GREEDY_ORDER's two lines,
        the printed *"When you play this Pokémon from your hand to evolve … you
        may"*, and the NINTH `onEvolve` row in this file.
      • *"have your opponent reveal their hand"* — `bottomFromOpponentHand`'s FIRST
        LINE since M5, through the shared `revealHand`.
      • *"Basic Pokémon you find there"* — `{ kind: "basicPokemon" }`, D159's
        member with **no `maxHp` rider**: Mandibuzz's 70 is that card's word and
        this sentence does not carry it (D135 — an absent field means what the
        sentence means).
      • *"onto their Bench"* — `dest: "bench"` (D294), the cross-seat destination,
        with its bench-space clamp, its `POKEMON_BENCHED { actor }` row and its
        `programPlayable` arms already in place.
      • *"any number of"* — `upTo: "any"` (D350), **the whole cost**.

    🛑 **THE ROW CLOSES THE MECHANISM AT 3 OF 3 LEGAL SENTENCES / 7 OF 7 LEGAL
    PRINTINGS.** The widened query (`reveal…hand` AND (`onto their Bench` OR `onto
    your opponent's Bench`), all three text columns, remote D1 2026-08-15) returns
    4 sentences / 10 printings / 7 legal: this ×3, Lickitung "Tongue Pull" ×2
    (ATTACK, built D297), Mandibuzz "Look for Prey" ×2 (Ability, built D294) and
    Erika's Invitation ×3 (`effect`, **0 legal** — out of Standard, and it prints a
    second clause besides). D294's own doc block called that population "4, not 2";
    it is 7, and the three it did not name are this card.

    ⚠️ **`optional: true` ON THE TRIGGER, NOT AN `optional` OP.** The printed
    *"you may"* attaches to the whole clause, and a board trigger's own decline is
    where that lives (GREEDY_ORDER's and DEFIANT_HORN's reading). Contrast
    LOOK_FOR_PREY, whose *"you may use this Ability"* is the decision to activate
    at all and therefore carries neither.

    ⚠️ **`programPlayable` COSTS ZERO HERE, STRUCTURALLY** — a board trigger never
    passes through that gate at all. Its two `bottomFromOpponentHand` arms (a full
    opponent Bench, an empty opponent hand) are for the ACTIVATED surface; the
    trigger reaches the same refusals through the op's own offer, which returns
    EMPTY on a full Bench and whiffs on a matchless hand.

    ⚠️ **NO `fix-*` DEMONSTRATOR.** The suite drives the three REAL ids on a LOCAL
    `cardPool` (D275's idiom, D344/D349's practice): `FIXTURE_POOL` is a CENSUSED
    POPULATION in `catalogManifest.test.ts` and `clauseApostrophe.test.ts`, and
    neither `sv09` nor `svp` is among `catalogManifest`'s six sets anyway. */
const INVITING_WINK: CardProgram = {
  triggered: [
    {
      name: "Inviting Wink",
      trigger: "onEvolve",
      optional: true,
      program: [
        {
          op: "bottomFromOpponentHand",
          filter: { kind: "basicPokemon" },
          dest: "bench",
          upTo: "any",
        },
      ],
    },
  ],
};

/** ⚠️⚠️ D351 — Infernape svp-116 / sv06-033 / sv06-173 — "Pyro Dance": "Once
    during your turn, you may attach a Basic {R} Energy card, a Basic {F} Energy
    card, **or 1 of each** from your hand to your Pokémon in any way you like."
    **3 Standard-legal printings on ONE byte-identical sentence** — the whole
    population of the sentence, and three of backlog row 12's four remaining
    `abilityIds`.

    🛑 **THE PRINTED DISJUNCTION IS TWO OPS, NOT A FILTER — AND THE ROW'S OWN
    RESIDUE NOTE SAID OTHERWISE FOR 101 DECISIONS.** `censusAtHead`'s row 12 cell
    (and `coverage-backlog-legal.md`'s) priced this as *"a disjunction over energy
    TYPES `attachFromHand.filter` has no spelling for, plus a cap D247's op
    deliberately has none of"*. Read against the print, that is the wrong road:
    *"in any way you like"* means each card names its OWN destination, which is
    `ASSEMBLE_ALLOY`'s reading since D263 — N independent `attachEnergyFrom` ops —
    and two ops with two `energyType`s spell the disjunction AND its cap at once.
    The three printed outcomes are exactly the three the pair produces, because
    each attach PARKS and a park is declinable: `{R}` alone, `{F}` alone, or one of
    each. `attachFromHand` is the wrong op here for the reason its own doc gives —
    it is deliberately UNBOUNDED, and under it a hand of four Basic {R} attaches
    four. **A CELL CAN BE RIGHT ABOUT THE OBSTACLE AND WRONG ABOUT THE ROAD**
    (D249's finding), and this is that at its second instance on this very row.

    ⚠️ **NO TARGET RIDER, AND THAT IS THE PRINT** — the bare *"to your Pokémon"*,
    no zone word, no type, no owner prefix, so `attachEnergyTargets` is asked
    un-narrowed. This is the ONE thing that makes Infernape cheaper than the other
    printing of the same clause: Steven's Metagross ex `sv10-145` "X-Boot" prints
    the identical *"…, or 1 of each"* over `searchDeck`, but ALSO prints *"attach
    them to your {P} Pokémon **and** {M} Pokémon"* — a disjunction on the TARGET
    axis, where `AttachTargetRiders.targetType` is a single `string`. Same clause,
    one column, 4 legal printings; 3 of them need no new vocabulary and 1 needs a
    union. `instr(abilities_json,'or 1 of each')` is **4 printings / 4 legal / 2
    sentences**, with `effect` **0** and `attacks_json` **0** (remote D1
    `luminous`, 2026-08-15, keyed on `$.effect`).

    ⚠️ **`energyType` IS THE FULL NAME AND NOT THE BRACE CODE** — "Fire" for {R}
    and "Fighting" for {F}, read by `attachableEnergies`, exactly as
    `ASSEMBLE_ALLOY` spells "Metal" for {M}. `anyEnergy` is ABSENT, which is what
    makes the printed word *"Basic"* true: absent, only Basic Energy is reachable
    (the op's own doc, D246).

    ⚠️ **THE ENGINE DIFF IS ONE PREDICATE AND IT IS A CORRECTNESS FIX, NOT A
    FEATURE** — `programPlayable`'s attach gate became PROGRAM-scoped
    (`attachAlternativesAllWhiff`, cardplay.ts). An ABILITY reaches that gate where
    an attack never does and a trigger never does, so this is the first printed row
    that could ever see the defect. ZERO new ops, ZERO new op fields, ZERO new
    `CardFilter` members, ZERO prompt kinds, ZERO events, ZERO error codes, ZERO
    wire-schema bytes, ZERO `EffectSlot` members, ZERO deriver arms;
    `MATCH_RECORD_VERSION` STAYS 20.

    ⚠️ NO `fix-*` DEMONSTRATOR and nothing enters `FIXTURE_POOL` — Pokémon BODIES
    driven on a LOCAL `cardPool` (D275's idiom), asserted by id in
    `pyroDance.test.ts` §7. **A FIXTURE IS A CENSUS POPULATION** (D348):
    `catalogManifest.test.ts` and `clauseApostrophe.test.ts` both sweep it, and
    neither `sv06` nor `svp` is among `catalogManifest`'s six sets anyway. */
const PYRO_DANCE: CardProgram = {
  abilities: [
    {
      name: "Pyro Dance",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "attachEnergyFrom", source: "hand", energyType: "Fire" },
        { op: "attachEnergyFrom", source: "hand", energyType: "Fighting" },
      ],
    },
  ],
};

/** 🆕🆕 D352 — Metang svp-090 / sv05-114 — "Metal Maker": "Once during your turn,
    you may look at the top 4 cards of your deck and attach any number of Basic {M}
    Energy cards you find there to your Pokémon in any way you like. **Shuffle the
    other cards and put them on the bottom of your deck.**"
    **2 Standard-legal printings on ONE byte-identical sentence — and they are the
    ENTIRE Standard-legal population of `attachFromTop`.**

    🛑 **THE ATTACH WAS NEVER WHAT BLOCKED THEM, AND D335 SAID SO IN ADVANCE.**
    These two ids sat in census row 11's `abilityIds` from D241 to here under the
    assumption that the ATTACH was missing. Every attach field they need —
    `n`, `filter`, `max: "any"`, the un-narrowed `to your Pokémon` — has been built
    since M5. What was missing is the LEFTOVERS DESTINATION: the identical printed
    clause `lookAtTopN` has carried as `restTo: "shuffledBottom"` since D335, one op
    over, on a card (Rika) with FEWER legal printings than this one — three, all
    `legal_standard = 0`. **A RESIDUE NOTE THAT NAMES A MECHANISM IS A PRICE A
    LATER SLICE CAN SPEND**, and `effects.ts` wrote this one out to the member:
    *"the day Metang lands the field becomes `restTo?: "discard" | "shuffledBottom"`
    … and nothing else, because the apply below is shared in shape."* It did.

    ⚠️ **THE WHOLE ENGINE DIFF IS ONE RENAMED FIELD AND ONE TRANSFERRED FORK.**
    `attachFromTop.discardRest?: true` → `restTo?: "discard" | "shuffledBottom"`
    (NET ZERO new fields), plus `attachFromTopApply`'s `toPile`/`underneath` fork
    lifted from `revealFromTop`. **ZERO new ops, ZERO new `CardFilter` members,
    ZERO prompt kinds, ZERO choice kinds, ZERO events, ZERO error codes, ZERO
    `GameState` fields, ZERO wire-schema bytes, ZERO regexes, ZERO deriver arms,
    ZERO `EffectSlot` members, ZERO `programPlayable` arms.**

    🛑 **BUT `MATCH_RECORD_VERSION` MOVES, 20 → 21, AND THAT IS THE PART THE
    PRE-PRICE DID NOT NAME.** An `EffectOp` is persisted inside
    `EffectContinuation.pendingOp` and this op PARKS, so a v20 record can hold
    `attachFromTop{…, discardRest: true}` — which under this deploy reads as
    `restTo === undefined` and silently leaves on top of the deck the cards Tri Howl
    printed *"Discard the other cards"* about. D309's rename case, D335's own
    argument one op over. **A PRICE THAT NAMES A FIELD HAS NOT THEREBY NAMED WHAT
    PERSISTS IT.**

    THE CENSUS THIS ROW IS SIZED BY (remote D1 `luminous`, 2026-08-15, `json_each`
    over all three text columns, ability key `$.effect` verified against these very
    rows before any zero was believed):
      • `instr(txt,'and put them on the bottom of your deck')` — **4 sentences /
        7 printings / 4 legal**: this one (2 legal, UNBUILT), Deduction Kit
        `sv08-171` (1 legal, BUILT D344), the Prize reset `sv09-156` (1 legal, a
        different mechanism — Prizes, not a deck-top window) and Rika ×3 (**0
        legal**, BUILT D335). So the clause's whole unbuilt legal residue is this.
      • The SENTENCE it rests on, `instr(txt,'look at the top') AND
        instr(txt,'attach')` — **4 sentences / 7 printings / 2 legal**, and both
        legal printings are Metang. The other three sentences are the two Bidoof-line
        `onEvolve` reprints and Hydreigon "Tri Howl" `sv02-140`, all `legal_standard
        = 0`. **The card this row was sent for is not merely the cheapest thing the
        sentence buys — it is the only legal thing it buys.**

    The op's settings, each straight off the printed words:
    - "Once during your turn" → `oncePerTurn`, and "you may" is the op's own
      decline (attaching none is a legal answer to the park);
    - "the top **4** cards" → `n: 4`;
    - "any number of **Basic {M} Energy cards**" → `max: "any"` with
      `basicEnergy` + `energyType: "Metal"` — the FULL NAME, not the brace code
      (`ASSEMBLE_ALLOY`'s spelling), and `basicEnergy` rather than `anyEnergy`
      because the print says *"Basic"*;
    - "to **your Pokémon** in any way you like" → NO target rider at all (the
      Active is a target and so is every benched one) and the `attachCards` MAP
      answer, which is the whole reason this op exists;
    - "**Shuffle** the other cards and put them on the bottom of your deck" →
      `restTo: "shuffledBottom"`. Charged on EVERY path — the whiff, the decline
      and the board with no eligible target — which is why it lives on the op.

    The text never says "if this Pokémon is in the Active Spot", so
    `activeOnly: false` (§9 — Abilities work from the Bench unless the card says
    otherwise).

    ⚠️ NO `fix-*` DEMONSTRATOR and nothing enters `FIXTURE_POOL` — Pokémon BODIES
    driven on a LOCAL `cardPool` (D275's idiom), asserted by id in
    `metalMaker.test.ts` §8. **A FIXTURE IS A CENSUS POPULATION** (D348):
    `catalogManifest.test.ts` and `clauseApostrophe.test.ts` both sweep it, and
    neither `svp` nor `sv05` is among `catalogManifest`'s six sets anyway. */
const METAL_MAKER: CardProgram = {
  abilities: [
    {
      name: "Metal Maker",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "attachFromTop",
          n: 4,
          filter: { kind: "basicEnergy", energyType: "Metal" },
          max: "any",
          restTo: "shuffledBottom",
        },
      ],
    },
  ],
};

/** 🆕 D352 — Morpeko sv06-072 — "Snack Seek": "Once during your turn, you may look
    at the top card of your deck. You may discard that card."
    **1 Standard-legal printing, and it costs NOTHING AT ALL.**

    🛑 **THE ABILITY SURFACE OF A SENTENCE THE ATTACK DERIVER HAS READ SINCE D241.**
    `ATTACK_LOOK_TOP_DISCARD` (effects.ts) matches the identical two clauses on
    `attacks_json` and builds this exact op, field for field — Rockruff and Litwick,
    3 legal printings. An Ability is not text-derived (conventions.md), so the
    printing needs a registry key and nothing else: **ZERO new ops, ZERO new op
    fields, ZERO of anything.** It rides in this slice because it is the OTHER
    member of census row 11's `abilityIds`, and taking it closes that half of the
    row rather than leaving a one-id remainder behind.

    - "Once during your turn" → `oncePerTurn`; "you may" is the ability's own decline;
    - "the top **card**" (singular) → `n: 1`;
    - the print names NO noun ("that card") → `filter: { kind: "anyCard" }`;
    - "**You may** discard that card" → `max: 1` with `dest: "discard"`. The second
      "you may" is the PARK's decline, not a second op: the player is shown one card
      and answers with it or with nothing.
    - **NO trailing `shuffleDeck`, and the absence is printed** — a one-card window
      has no leftovers, and on the DECLINE a shuffle would scramble a top the player
      deliberately kept. `restTo` is absent for the same reason.

    ⚠️ **THIS IS THE ONE ID IN THE SLICE THAT MOVES `revealClause`'s SWEEP**, and it
    is the FILTER rather than the population that decides it: `searchOps` counts
    `searchDeck` and `lookAtTopN` and NOT `attachFromTop`, so Morpeko enters
    `swept` and Metang ×2 do not. It is tabled `NOT_REVEALING` — the print names no
    reveal, and the looker is the only seat that learns anything.

    `activeOnly: false` (§9). NO `fix-*` demonstrator; local `cardPool`. */
const SNACK_SEEK: CardProgram = {
  abilities: [
    {
      name: "Snack Seek",
      oncePerTurn: true,
      activeOnly: false,
      program: [{ op: "lookAtTopN", n: 1, filter: { kind: "anyCard" }, max: 1, dest: "discard" }],
    },
  ],
};

/** 🆕🆕 D353 — Lycanroc sv09-085 / sv09-166 — "Spike-Clad": "When you play this
    Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may
    attach up to 2 Spiky Energy cards from your discard pile to this Pokémon."
    **2 Standard-legal printings on ONE sentence** — backlog row 9's live pair,
    and the row's whole `abilityIds` half.

    🛑 **THE ONE NEW THING IS `attachEnergyFrom.energyName`, THE PRINTED PROPER
    NAME**, and it is bought for the ENTIRE Standard-legal population of the
    narrowing rather than merely for the cheapest member of it. The by-name attach
    clause censused over ALL THREE text columns (remote D1 `luminous`, `json_each`
    keyed on `$.effect`, 2026-08-16) is **2 sentences / 4 printings / 2 LEGAL**,
    and both legal printings are the two ids below. The other sentence is
    Wigglytuff `sv02-084`/`sv04.5-147` *"attach a **Therapeutic Energy** card from
    your hand to 1 of your Pokémon"* — a DIFFERENT source zone and a DIFFERENT
    target shape, both `legal_standard = 0`. So the field is not a one-card special
    case even though only one sentence is legal: it is the whole clause, and the
    rotated half proves the field is orthogonal to `source` and to the riders.

    Everything else was lying around and is named rather than assumed:
    - "When you play this Pokémon from your hand to evolve 1 of your Pokémon
      during your turn" → `trigger: "onEvolve"` (D250), the eighth row to carry it;
    - "**you may**" → `optional: true`, the trigger's own decline;
    - "up to 2" → `count: 2` (D205) — ONE decision, N Energy, ONE body;
    - "from your discard pile" → `source: "discard"` (D234);
    - "to **this Pokémon**" → `toSelf: true` (D221), which is why the row carries
      NONE of `targetType`/`basicOnly`/`ownerPokemon`/`benchOnly`.
    `BATTLE_HARDENED` already spells `count: 2` + `toSelf`; `ASSEMBLE_ALLOY`
    already spells `onEvolve` + `optional` + `source: "discard"`. The intersection
    is new, the vocabulary is not.

    🛑 **AND THE THREE SPELLINGS THAT WOULD HAVE AVOIDED THE FIELD ARE REFUTED
    FROM SOURCE, NOT ARGUED** (`spikeClad.test.ts` §3 drives all three):
    - `energyType: "Colorless", anyEnergy: true` — `energyProvidesOf` (cards.ts)
      returns `"Colorless"` for EVERY Special Energy and for every `Normal`-typed
      Energy whose name is not a basic type word, which in Standard is **7 Special
      names** (Boomerang, Enriching, Legacy, Mist, Neo Upper, Spiky, Team Rocket's)
      **plus 3 `Normal`-typed oddballs** (Ignition, Prism, Reversal). The print
      names ONE card; the spelling reaches ten, and the driven case attaches the
      wrong one.
    - `anyEnergy: true` alone — strictly broader still: any Energy card at all.
    - `energyType: "Spiky"` — matches the EMPTY set, because `energyProvidesOf`
      only ever returns a member of `BASIC_ENERGY_TYPES`. A silent whiff plus a
      `programPlayable` refusal, which is the loudest-quiet failure this engine has.

    🆕🆕 **D358 BOUGHT THE DECLINABLE PARK AND THIS ROW IS STILL OVER-RESOLVED —
    FOR A DIFFERENT REASON THAN THIS NOTE USED TO GIVE.** The old text said the
    obstacle was `toSelf` never parking; `parkOrForce` now parks a DECLINABLE pick
    even over one candidate, so that half is spent. The live obstacle is `count: 2`:
    ONE op, ONE named body, ONE batch, so a decline buys {0, 2} where the printed
    *"up to 2"* means {0, 1, 2} (`ptcg-rules.md` §9.1). **THE MISSING CAPABILITY IS
    A QUANTITY AXIS, NOT A DECLINE AXIS**, and it cannot be respelled as two ops
    because `count` exists to pin a batch to the one body a print NAMES (D205).
    ⚠️ **AND THE POPULATION FIGURE HERE WAS WRONG** — "5 legal printings to 7" over
    a list of 6, carried by five handoffs. Re-derived at D358: **17 legal printings**
    over-resolved, 6 bought (Archaludon ex ×3, Magneton ×3) and 11 refused, of which
    this card is one of EIGHT `count: 2` printings alongside Bloodmoon Ursaluna ×2
    and Ethan's Ho-Oh ex ×4 — neither previously counted.

    ⚠️ **NO `fix-*` DEMONSTRATOR.** `catalogManifest.ts` is generated off a local
    sqlite this clone does not have and measures a 978-row / 6-set catalog holding
    no `sv09` row at all, so the real ids are driven on a LOCAL `cardPool` (D275's
    idiom) and `FIXTURE_POOL` is left untouched — asserted BY ID in
    `spikeClad.test.ts` §8 rather than described. */
const SPIKE_CLAD: CardProgram = {
  triggered: [
    {
      name: "Spike-Clad",
      trigger: "onEvolve",
      optional: true,
      program: [
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyName: "Spiky Energy",
          count: 2,
          toSelf: true,
        },
      ],
    },
  ],
};

/** Buddy-Buddy Poffin sv05-144 / sv06-223 / sv08.5-101 — "Search your deck for
    up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then,
    shuffle your deck." (Item, 3 legal printings on 1 sentence)

    **NEST BALL's PROGRAM WITH TWO NUMBERS CHANGED AND ONE RIDER ADDED**, and the
    rider is the whole slice: `max: 2` instead of 1 and `basicPokemon.maxHp: 70`
    instead of the bare noun. No new op, no new op field, no anchor.

    ⚠️ **IT IS NOT A TIER-0 ALIAS OF `NEST_BALL`** — sharing the object would drop
    the threshold AND the count, which is the loud-and-quiet pair on one line: a
    player would be offered one card instead of two (loud) and a 200 HP Basic
    would be among them (quiet). Its own object, for D183's reason.

    ⚠️ **`dest: "bench"` PLUS THE TRAILING `shuffleDeck`** is Nest Ball's shape
    verbatim: the shuffle is a SEPARATE op because a whiffed search still shuffles,
    and the printed "Then, shuffle your deck." is its own sentence. */
const BUDDY_BUDDY_POFFIN: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "basicPokemon", maxHp: 70 }, dest: "bench", max: 2 },
    { op: "shuffleDeck" },
  ],
};

/** Alomomola sv10.5b-024 / sv10.5b-108 — "Gentle Fin": "Once during your turn,
    if this Pokémon is in the Active Spot, you may put a Basic Pokémon with 70 HP
    or less from your discard pile onto your Bench." (2 legal printings on 1
    sentence)

    **THE SAME FILTER ON A DIFFERENT OP, WHICH IS WHY THE THRESHOLD IS A
    `CardFilter` RIDER AND NOT A FIELD ON EITHER OP.** Buddy-Buddy Poffin searches
    the DECK from a Trainer; this retrieves from the DISCARD PILE from an activated
    Ability. The two ops share no field and no read site except `matchesFilter` and
    `retrieveNoun` — so a `maxHp` on `searchDeck` would have bought three printings
    and left these two still asking.

    **EVERY OTHER CLAUSE WAS ALREADY VOCABULARY.** `discardPileRetrieval` with
    `dest: "bench"` was built at D238 (the work order in
    `legalNonAttackPrograms.test.ts` claimed otherwise for twenty-six decisions and
    was wrong); "if this Pokémon is in the Active Spot" is `activeOnly`, which the
    Ability surface has carried since Chien-Pao ex; "Once during your turn" is
    `oncePerTurn`; and the printed "you may" is the player's choice to use the
    Ability at all, plus the retrieval's own PARK, which is declinable by taking
    none. `max: 1` — the printed noun is singular.

    ⚠️ **NO `shuffleDeck`.** Nothing goes back to the deck; the Bench arm's cards
    come out of the pile and enter play. The mutant that appends one is a Trainer's
    habit landing on an Ability. */
const GENTLE_FIN: CardProgram = {
  abilities: [
    {
      name: "Gentle Fin",
      oncePerTurn: true,
      activeOnly: true,
      program: [
        {
          op: "discardPileRetrieval",
          filter: { kind: "basicPokemon", maxHp: 70 },
          dest: "bench",
          max: 1,
        },
      ],
    },
  ],
};

/** Miracle Headset sv08-183 — "Put up to 2 Supporter cards from your discard
    pile into your hand." (Item) — Pal Pad's filter with Energy Retrieval's
    destination: to HAND, so no shuffle. Safe on the op's own authoring note (a
    card whose filter matches its own category would offer ITSELF): this is an
    ITEM retrieving SUPPORTERS. 1 legal printing. */
const MIRACLE_HEADSET: CardProgram = {
  trainer: [{ op: "discardPileRetrieval", filter: { kind: "supporter" }, dest: "hand", max: 2 }],
};

/** Energy Recycler sv10-164 — "Shuffle up to 5 Basic Energy cards from your
    discard pile into your deck." (Item) — Energy Retrieval's filter with Pal
    Pad's destination and shuffle. 1 legal printing. */
const ENERGY_RECYCLER: CardProgram = {
  trainer: [
    { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "deck", max: 5 },
    { op: "shuffleDeck" },
  ],
};

/** Sacred Ash sv10-168 — "Shuffle up to 5 Pokémon from your discard pile into
    your deck." (Item)

    ⚠️ MIRIAM's FIRST SENTENCE, BYTE FOR BYTE — and NOT a Tier-0 alias of it,
    because Miriam prints a SECOND sentence ("If you shuffled any cards into your
    deck in this way, draw 3 cards.") that this card does not. Sharing the object
    would give an Item a Supporter's draw. The `recordAs: "moved"` and the
    `recordGate` are therefore absent here, which is the whole diff. 1 legal
    printing. */
const SACRED_ASH: CardProgram = {
  trainer: [
    { op: "discardPileRetrieval", filter: { kind: "anyPokemon" }, dest: "deck", max: 5 },
    { op: "shuffleDeck" },
  ],
};

/** Master Ball sv05-153 — "Search your deck for a Pokémon, reveal it, and put it
    into your hand. Then, shuffle your deck." (Item) — Poké Ball's program with
    the coin gate REMOVED, i.e. Mesagoza's gated pair lifted to the top level.
    1 legal printing. */
const MASTER_BALL: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 1, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** Treasure Tracker sv08.5-131 — "Search your deck for up to 5 Pokémon Tool
    cards, reveal them, and put them into your hand. Then, shuffle your deck."
    (Item) — Town Store's `toolCard` filter searched to HAND at `max: 5`.
    1 legal printing. */
const TREASURE_TRACKER: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "toolCard" }, dest: "hand", max: 5, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** Dangerous Laser sv06.5-058 — "Your opponent's Active Pokémon is now Burned
    and Confused." (Item)

    TWO `applyStatus` ops, not one with a list: the op's `status` is a single
    `StatusName` and the printed conjunction is two applications. They land in two
    different places on the model — Burn is its own flag, Confusion is the
    ROTATION slot — so neither overwrites the other, and both are asserted.
    1 legal printing. */
const DANGEROUS_LASER: CardProgram = {
  trainer: [
    { op: "applyStatus", target: "defender", status: "burned" },
    { op: "applyStatus", target: "defender", status: "confused" },
  ],
};

/** Kofu sv07-138/-165 — "Put 2 cards from your hand on the bottom of your deck
    in any order. If you put 2 cards on the bottom of your deck in this way, draw
    4 cards. (If you can't put 2 cards from your hand on the bottom of your deck,
    you can't use this card.)" (Supporter)

    Dendra's shape at 2-for-4: `payFromHand` to the deck BOTTOM filing under the
    §9.2 `paid` slot, then a `recordGate` on it. The parenthetical is not a
    separate mechanism — it is `handCostUnmet`, which playTrainer already checks
    BEFORE the card leaves hand and with the played uid excluded (the printed
    "from your hand" cannot mean Kofu itself). Because the play is refused unless
    both cards can be paid, the gate is true on every path it is reached on; it is
    authored anyway, since that is what the sentence says and Dendra's precedent
    is the same. 2 legal printings of 2.

    🆕🆕 **D343 ADDED THE THIRD OP, AND THE CLAUSE IT BUYS WAS SILENTLY DROPPED
    BY EVERY EARLIER HEAD.** The printed sentence is *"Put 2 cards from your hand
    on the bottom of your deck **in any order**"*, and the two-op program above
    honoured every word of it except the last three.

    🛑 **THE ORDER COULD NOT RIDE THE `payFromHand` ANSWER, AND THE TWO REASONS
    ARE BOTH IN THE SOURCE.** It very nearly can: `payFromHandApply` builds `paid`
    by iterating the answer's uids and appends it with `deck: [...side.deck,
    ...paid]`, so the array order is already consumed. It is refused because
    1. **`chooseCards`'s validator is documented as free to treat the array as a
       SET** (D341, index.ts) — every other consumer only MOVES the cards, so two
       answers naming the same uids are the same board and a client may reorder
       one. Resting a printed clause on that would be D341's own rule broken:
       **a prompt kind is a claim about what an answer MEANS**, and `chooseCards`
       means *which*, never *in what sequence*.
    2. **`payFromHand` AUTO-RESOLVES when the offer is no bigger than the count**
       ("the only decision is WHICH cards", interpreter.ts). On the commonest
       Kofu line — Kofu plus exactly two other cards — no prompt is shown at all
       and the pair lands in raw hand order. The clause is not under-specified
       there; it is **absent**.
    ⚠️ **AND KOFU IS THE ONLY PRINTING IN THE WHOLE HAND→BOTTOM FAMILY WITH A
    COUNT ABOVE ONE**, which is exactly why neither fact has ever been wrong
    before. Re-derived at this head: `instr(<col>,'from your hand on the bottom of
    your deck')` returns Dendra ×3 (count 1, 0 legal), Kofu ×2 (count 2) and
    Quaquaval `sv08-052` "Up-Tempo" (count 1, an Ability) — and ZERO on
    `attacks_json`. At count 1 there is one ordering and nothing to say.

    🛑 **SO THE ORDERING IS A SECOND PARK, AND ITS CHANNEL IS THE BOARD — D342's
    TRICK AT THE OTHER END OF THE SAME DECK.** After `payFromHand{to:"deckBottom"}`
    the two paid cards ARE the last two cards of the deck by construction, so
    `reorderTop { n: 2, from: "bottom" }` reads exactly them and nothing else. The
    D342 handoff recorded this row as the family's first member where "the channel
    is the board" was NOT available, because `reorderTop` reads `deck.slice(0, n)`.
    That was right about the reader and wrong about the trick: **the board was a
    channel here too; only the reader could not reach that end of it.**

    🛑 **THE ORDERING SITS INSIDE THE `recordGate`, AHEAD OF THE DRAW, AND THAT
    PLACEMENT IS THE OP-PAIR'S ONLY GUARD.** `recordGateHolds` is `filed.length >
    0`, so a program run against a hand that paid nothing opens no ordering window
    over two cards nobody put there. It is a weaker guarantee than D342's `exact`,
    which made its own pair self-sufficient: here the window's DOMAIN (2) and the
    payment's FLOOR (`min(handSize, 2)`) agree only because `handCostUnmet` — in
    cardplay.ts, a different file — refuses the play otherwise. Stated rather than
    assumed, because the gate is "any paid" and not "2 paid": a direct program run
    that paid ONE would still open a 2-card window holding one stranger. No action
    path reaches it, and the honest fix if one ever does is the gate learning a
    count, not this op learning `exact`.

    ⚠️ **THE DRAW STAYS LAST AND THE ORDER OF THE THREE OPS IS PRINTED.** Dendra's
    note explains why the payment precedes the draw; the same argument puts the
    ordering between them — the print finishes the putting sentence ("…in any
    order") before it starts the drawing one, and a draw in between would let a
    drawn card sit above cards the player is still sequencing. */
/** 🆕🆕 Deduction Kit sv08-171 — *"Look at the top 3 cards of your deck and put
    them back in any order, **or** shuffle them and put them on the bottom of your
    deck."* (Item, mark H, **1 legal printing of 1**)

    **THE LAST LEGAL MEMBER OF THE *"IN ANY ORDER"* FAMILY**, re-derived from
    remote D1 `luminous` at this head rather than inherited: `instr(<col>,'in any
    order') > 0` over all three text columns returns **15 printings / 11 legal /
    7 distinct sentences** (`effect` 8/6 · `attacks_json` 7/5 · `abilities_json`
    0/0). Four of the seven were built — the two `ATTACK_REORDER_TOP` sentences
    (D341), the search-to-top one (D342) and Kofu's hand→bottom one (D343) — this
    is the fifth, and the two that remain are Raifort `sv06-161`/`sv08.5-142` and
    Absol ex `sv03-135`/`-214`, **both `legal_standard = 0`**. So this row closes
    the family on Standard.

    ⚠️ **AND THE INHERITED "FIVE OF SEVEN BUILT" WAS ONE TOO MANY.** The D342
    handoff recorded it, D343 flagged it as unreconciled and did not re-derive it;
    counted off `registry.ts` and `effects.ts` at this head it was **FOUR**. The
    honest form of the figure is the one that separates the axes: **of the FIVE
    sentences with any legal printing, four were built and this is the fifth.**

    🛑 **THE PROGRAM IS ONE OP, AND THE `or` IS TWO OPTIONAL FIELDS ON IT.** The
    cheap reading is `optional { then: [reorderTop], otherwise: [bottomDeckTop] }`
    — a two-armed branch on a human answer, shipped since D316 — and it is
    **REFUSED, because it asks the question BLIND.** An `optional` parks
    `{ kind: "confirm", note }`, which carries no candidates; the print hands the
    information over FIRST (*"**Look at the top 3 cards** of your deck **and** put
    them back in any order, or …"*), so the player is entitled to see the three
    cards before choosing between the arms. **THE PROMPT THAT ASKS THE `or` HAS TO
    BE THE PROMPT THAT DELIVERS THE LOOK.**

    **WHAT THAT COST IS A CAPTION AND A SPLICE, NOT A PROMPT KIND.** `confirm`'s
    own doc block already settles the meaning — *"a confirm answer means run
    `then` … a fact about the program"* — so a binary answer choosing between two
    printed arms needed no new kind anywhere. `reorderTop` gained `otherwise`
    (the arm's ops) and `otherwiseNote` (its printed words); `orderCards` gained
    `alt`; the answer is the EMPTY ordering, a value `validateChoice` refused
    before and now admits exactly when `alt` is present.

    ⚠️ **NO PLAY GATE, AND THAT IS THE FAMILY'S OWN PRECEDENT RATHER THAN AN
    OVERSIGHT.** `programPlayable` has no `reorderTop` arm and needs none: a deck
    of fewer than 2 cards makes the op resolve inline (M1), so the Item is
    playable and does nothing — which is `lookAtTopN`'s behaviour on a short deck
    and Poké Ball's on an empty one (*"a deck search is always playable enough"*).
    The refusals that file DOES make are about a board that can offer no target at
    all; a deck is a target even when it is thin. */
const DEDUCTION_KIT: CardProgram = {
  trainer: [
    {
      op: "reorderTop",
      n: 3,
      // The printed second arm, and the `n` is deliberately the SAME number: the
      // sentence's "them" is the window, so a divergence here would silently
      // bottom a different set of cards than the one the player was shown.
      otherwise: [{ op: "bottomDeckTop", n: 3 }],
      otherwiseNote: "Shuffle them and put them on the bottom of your deck.",
    },
  ],
};

const KOFU: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 2, to: "deckBottom", recordAs: "paid" },
    {
      op: "recordGate",
      slot: "paid",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [
        { op: "reorderTop", n: 2, from: "bottom" },
        { op: "drawCards", count: 4 },
      ],
    },
  ],
};

/** Maximum Belt sv05-154 / sv08.5-117 — "Attacks used by the Pokémon this card
    is attached to do 50 more damage to your opponent's Active Pokémon ex (before
    applying Weakness and Resistance)." (Tool)

    Choice Belt's `damageBonusBeforeWRIfTarget` with `"ex"` for `"V"` and 50 for
    30 — a PURE DATA ROW on the defender-suffix seam, and the field's second
    printing (D107's `pokemonSuffixOf` reused, so "ex" here means the same thing
    it means to Mimikyu's Safeguard and to §8.1's prize value). 2 legal printings
    of 2 — and note the SUFFIX is what makes this row worth more than Choice
    Belt's: `"V"` names a class with **zero** Standard-legal printings. */
const MAXIMUM_BELT: CardProgram = {
  passive: { damageBonusBeforeWRIfTarget: { amount: 50, targetSuffix: "ex" } },
};

/** Binding Mochi sv06.5-055 / sv08.5-095 — "Attacks used by the **Poisoned**
    Pokémon this card is attached to do 40 more damage to your opponent's Active
    Pokémon (before applying Weakness and Resistance)." (Tool)

    Defiance Band's `damageBonusBeforeWRIf` with the `yourActivePoisoned` board
    condition (D116's member, printed on Okidogi ex's "Chain-Crazed").

    ⚠️ THE GATE THE CARD PRINTS IS ABOUT THE **HOLDER**, AND THE MEMBER READS THE
    SEAT'S **ACTIVE** — AND THE TWO CANNOT DISAGREE AT THIS FIELD'S READ SITES.
    `damageBonusBeforeWRIf` is folded by `attackerPreWRBonus` out of
    `passivesOf(attacker)`, so the contribution exists only when the HOLDER is the
    body attacking; and a body attacking is the seat's Active by definition (§8).
    Both read sites (attack.ts's main hit, interpreter.ts's `snipeActive`) resolve
    the attacker that way, so "the holder is Poisoned" and "your Active is
    Poisoned" are the same proposition wherever this number is read. A Tool on a
    BENCHED body contributes nothing at all — not because the condition is false,
    but because that body never reaches the fold — which is exactly what the
    printed sentence means and is asserted rather than left to this note. D116's
    own rule licenses the naming: a member is named for what it READS, and the
    printed pronoun is resolved by the anchor. 2 legal printings of 2. */
const BINDING_MOCHI: CardProgram = {
  passive: { damageBonusBeforeWRIf: { amount: 40, cond: { kind: "yourActivePoisoned" } } },
};

/** Levincia sv09-150 / sv10-244 — "Once during each player's turn, that player
    may put up to 2 Basic {L} Energy cards from their discard pile into their
    hand." (Stadium)

    ⚠️ THE FIRST STADIUM ABILITY THAT IS NOT A DECK SEARCH. Artazon / Mesagoza /
    Town Store all run `searchDeck`; this one runs `discardPileRetrieval`, and it
    needed nothing — `StadiumAbility.program` is a plain `EffectOp[]` and the
    per-player turn flag (`TurnAllowances.stadiumAbilityUsed`) already carries
    "once during EACH player's turn", so the opponent activates the same Stadium
    on their own turn with no non-active-seat routing. Everything else is
    Energy Retrieval's row with the `energyType` refinement: `basicEnergy` and NOT
    `providesEnergy`, because the cards are sitting in a PILE attached to nothing
    and the printed noun is "Basic {L} Energy CARDS" (Electric Generator's reading
    of the same choice, one zone over). No trailing shuffle — the destination is a
    hand. 2 legal printings of 2. */
const LEVINCIA: CardProgram = {
  stadium: {
    ability: {
      label: "Levincia",
      program: [
        {
          op: "discardPileRetrieval",
          filter: { kind: "basicEnergy", energyType: "Lightning" },
          dest: "hand",
          max: 2,
        },
      ],
    },
  },
};

/** Spiky Energy sv09-159/-190 — "As long as this card is attached to a Pokémon,
    it provides {C} Energy. / If the Pokémon this card is attached to is in the
    Active Spot and is damaged by an attack from your opponent's Pokémon (even if
    this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon."

    ⚠️ THE SECOND WRITER OF `EnergyProgram.passive` EVER, AND THE FIRST FROM A
    FIELD OTHER THAN §12. D174 bought that surface for Therapeutic Energy and
    AUDITED all twelve `passivesOf` fields for reachability from an Energy source;
    `damageAttacker` was marked *reachable ⚠️* with exactly one caveat — its
    `requiresTool` rider would ask a question about the BOARD rather than about
    the source — and this printing does not carry that rider, so the caveat is
    not reached. The audit's "No writer today; named so it is not discovered
    later" is now spent as intended.

    Both clauses are shipped mechanisms: `provides: ["Colorless"]` is Jet
    Energy's line for Jet Energy's reason, and the second sentence's antecedent is
    BYTE-IDENTICAL to Cacnea/Cacturne's "Counterattack Quills" — the "in the
    Active Spot" clause is enforced by the READ SITE (attack.ts's main hit only),
    which is why no `activeOnly` flag exists or is needed. `amount: 20` is the
    printed 2 counters in HP, the unit every `damageAttacker` printing is stored
    in.

    ⚠️ AND ITS §9 ANSWER IS THE OPPOSITE OF THE POKÉMON PRINTING'S, FOR FREE. An
    Energy is not an Ability, so `passivesOf` never drops this source under a lock
    — a Klefki aura silences Cacturne's identical sentence and cannot touch this
    one. That falls out of where the source sits in the fold; it is asserted
    rather than assumed. 2 legal printings of 2. */
const SPIKY_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], passive: { damageAttacker: { amount: 20 } } },
};

/** D261 — Mist Energy `sv05-161`: "As long as this card is attached to a Pokémon,
    it provides {C} Energy. / Prevent all effects of attacks used by your
    opponent's Pokémon done to the Pokémon this card is attached to. (Existing
    effects are not removed. Damage is not an effect.)"

    🛑 THE WHOLE OF THIS ROW'S ENGINE DIFF IS THIS OBJECT — the slice's central
    claim, PREDICTED before the first edit and GREPPED before the row was promised.
    D174 made an attached Energy the THIRD SOURCE CLASS of `passivesOf` (`sources`
    walks `pokemon.energy` and reads `programFor(id)?.energy?.passive`), and D260
    put `if (passive.preventAttackEffects === true)` inside that very fold loop and
    wired the flag into `interpreter.ts effectRefusedOn`. The printed object — "the
    Pokémon this card is attached to" — IS the body the fold is about. So there is
    no `continuous.ts`, no `interpreter.ts`, no `attack.ts`, no `cards.ts`, no
    `effects.ts` and no `types.ts` diff, no new read site and no new event.

    ⚠️ THE THIRD PRINTING OF ONE SENTENCE, AND THE FIRST NOT ON A POKÉMON. D260
    built the two ABILITY spellings (`sv08-031` "Unaware", `sv10-051` "Repelling
    Veil"); this is the same rule borne by a SPECIAL ENERGY, which D260's own
    rung-1 ladder turned up as a false positive and wrote down as a WORK ORDER.

    🛑 AND ITS §9 ANSWER IS THE OPPOSITE OF `sv08-031`'s, ON THE SAME FOLD FIELD.
    An Energy is not an Ability, so `passivesOf` never drops this source under a
    lock — it is appended past the `disabled` term. `preventAttackEffects` is
    therefore the FIRST field in this engine with writers on both sides of §9, and
    one board in `mistEnergy.test.ts` reads both in a single pair of calls: a
    Klefki lock silences the Skeledirge on the bench while this Energy's shield
    stands. Driven rather than argued, because construction is what D172's three
    wrong claims were made of. 1 legal printing of 1. */
const MIST_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], passive: { preventAttackEffects: true } },
};

/** D261 — Enriching Energy `sv08-191`: "As long as this card is attached to a
    Pokémon, it provides {C} Energy. / When you attach this card from your hand to
    a Pokémon, draw 4 cards."

    THE SECOND `EnergyOnAttach` ARM EVER, and the union's first new member since
    M4 slice 5 authored Jet. The clause is read at the same `turn.ts attachEnergy`
    site, and it takes a GUARD and not a FILTER: the op names ONE seat and ONE
    body, so there is no set to narrow. ⚠️ UNGATED BY SPOT — see `EnergyOnAttach`.

    ⚠️ NO NEW EVENT. `CARDS_DRAWN` with `reason: "effect"` already carries every
    non-turn-start draw in the engine, so the arm is one call to `types.ts
    drawToHand` and the log, projection and redaction paths take a ZERO diff.
    1 legal printing of 1. */
const ENRICHING_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], onAttach: { kind: "draw", count: 4 } },
};

/** 🆕 D262 — Neo Upper Energy `sv05-162`: "As long as this card is attached to a
    Pokémon, it provides {C} Energy. / If this card is attached to a Stage 2
    Pokémon, this card provides every type of Energy but provides only 2 Energy at
    a time."

    THE COLUMN'S CONDITIONAL PROVISION, and a RE-PARAMETERISATION rather than a new
    seam: it is `demoteWithOtherSpecial`'s shape with the antecedent changed from
    "another Special is attached" to "the holder is a Stage 2", so the engine diff
    is `continuous.ts unitsOf` (one signature widening, one arm) plus the
    `isStage2Pokemon` card read. `interpreter.ts`, `attack.ts`, `effects.ts`,
    `types.ts`, `turn.ts`, `redact.ts` and `log.ts` all take a ZERO diff — no new
    op, no new event, no new read site.

    🛑 THE PROVISION IS LIVE-READ AND NOT STAMPED, which is the sharpest thing this
    row asserts. `unitsOf` resolves the holder's TOP card on every call, so
    evolving a Stage 1 into a Stage 2 with this card ALREADY attached upgrades it
    on the spot — and devolving would demote it. A stamped implementation (a unit
    list frozen at attach time) would pass every static board in this suite and be
    silently wrong on the one that evolves; `neoUpperEnergy.test.ts` drives a real
    `evolve` action across the boundary rather than arguing it.

    ⚠️ AND BOTH HALVES OF THE PRINT ARE HERE. The first paragraph is Jet's, Spiky's
    and Mist's line verbatim (`provides: ["Colorless"]`) and was already built; the
    second is the new field. 1 legal printing of 1. */
const NEO_UPPER_ENERGY: CardProgram = {
  energy: {
    provides: ["Colorless"],
    promoteOnHolderStage: { stage: "Stage2", units: [ANY_ENERGY, ANY_ENERGY] },
  },
};

/** 🆕 D300 — Prism Energy `sv10.5b-086`, and it is `NEO_UPPER_ENERGY` above with
    BOTH of its values changed and nothing else:

      "As long as this card is attached to a Pokémon, it provides {C} Energy.

       If this card is attached to a Basic Pokémon, this card provides every type
       of Energy but provides only 1 Energy at a time."

    🛑 **THE CARD WAS READ END TO END BEFORE THIS ROW WAS WRITTEN, AND IT PRINTS
    TWO PARAGRAPHS AND NOT THE ONE THE BACKLOG QUOTED.** `length(effect) = 194`
    against a ~130-character quoted sentence; the 64 unaccounted characters are the
    FIRST paragraph, which is Jet's, Spiky's, Mist's and Neo Upper's line verbatim
    (`provides: ["Colorless"]`) and was already built. So the second clause is the
    only new thing here, and it is a VALUE on an existing field.

    ⚠️ **`energy_type` IS `'Normal'` ON THIS PRINTING, NOT `'Special'`, AND IT DOES
    NOT MATTER — THAT WAS CHECKED AS A JOIN AND NOT GUESSED.** `BUILT.specialEnergy`
    is the size of `censusAtHead.test.ts`'s `CENSUS_ENERGY_LEGAL`, which partitions
    the live registry pool by **`cards.category`** (the list's own doc: *"the
    population is 11 and not 8 because this column splits by `cards.category`: 8
    Special Energy plus 3 BASIC energy carrying effect text"*). `category` is
    `'Energy'`, so this printing lands in that column exactly as `sv05-162` does.

    THE POPULATION, RE-QUERIED AND NOT INHERITED (remote D1 `luminous`,
    `instr(effect,'provides every type of Energy') > 0 AND legal_standard = 1`,
    2026-08-09): **4 printings** — `sv04-266` Reversal, `sv05-162` Neo Upper,
    `sv06-167` Legacy, `sv10.5b-086` Prism. ⚠️ **TWO of the four were ALREADY
    BUILT** (`sv05-162` D262, `sv06-167` D298), not the one the handoff predicted,
    so this row's reachable size is **1 of the remaining 2** — Reversal Energy
    `sv04-266` (337 characters) conjoins a PRIZE COMPARISON with *"an Evolution
    Pokémon that doesn't have a Rule Box"* and is refused on its antecedent, not on
    its provision. 1 legal printing of 1. */
const PRISM_ENERGY: CardProgram = {
  energy: {
    provides: ["Colorless"],
    promoteOnHolderStage: { stage: "Basic", units: [ANY_ENERGY] },
  },
};

/** 🆕 D302 — Reversal Energy `sv04-266`, the LAST unbuilt member of the *"provides
    every type of Energy"* string family (D262 `sv05-162`, D298 `sv06-167`, D300
    `sv10.5b-086` are the other three), and a row that two handoffs refused:

      "As long as this card is attached to a Pokémon, it provides {C} Energy.

       If you have more Prize cards remaining than your opponent, and if this card
       is attached to an Evolution Pokémon that doesn't have a Rule Box (Pokémon
       ex, Pokémon V, etc. have Rule Boxes), this card provides every type of
       Energy but provides only 3 Energy at a time."

    🛑 **THE CARD WAS READ END TO END OUT OF THE D1 BEFORE THIS ROW EXISTED, AND
    IT PRINTS TWO PARAGRAPHS.** `length(effect) = 337`, and the FIRST paragraph is
    Jet's, Spiky's, Mist's, Neo Upper's and Prism's line verbatim
    (`provides: ["Colorless"]`) — already built since M4. Every price quoted for
    this card across five resume points described the SECOND paragraph and charged
    it for all 337 characters. This is the second consecutive Energy row where
    opening the card removed a paragraph from the bill (D300's `sv10.5b-086` was
    the first), which is now a pattern rather than an anecdote: **every Special
    Energy in this family prints the provision line first.**

    🛑 **D300 REFUSED THIS AS MISSING *COMPOSITION* — *"no `EnergyProgram` field
    carries a two-term board predicate"* — AND THE REFUSAL WAS WRONG IN ITS TYPE,
    NOT MERELY IN ITS SIZE.** There was never a composition to find. The three
    terms are not a `BoardCondition` conjunction needing `allOf`; they are three
    direct reads, and continuous.ts had ALREADY IMPORTED the data for two of them
    before this slice began (`hasRuleBox` at line 5, `takenPrizes` from types.ts).
    ⚠️ **AND THE ONE STRUCTURAL OBSTACLE IS THE OPPOSITE OF THE ONE NAMED**: the
    vocabulary DOES carry the prize clause — `BoardCondition.morePrizesThanOpponent`,
    whose doc block has listed *"Defiance Band, Luxray and Reversal Energy"* since
    D40 and whose clause table maps this card's printed words verbatim — and it is
    unreachable HERE because `conditionHolds` (interpreter.ts) imports
    continuous.ts. So the honest type of the old blocker was neither COMPOSITION
    nor MISSING CODE at a read site: it was a bespoke-flag decision this repo had
    already made and written down once, at `noRetreatCostSelf`.

    ⚠️ **THE COST IS TWO OPTIONAL RIDERS, ONE STAGE VALUE AND ONE PREDICATE** —
    `promoteOnHolderStage` gains `noRuleBox?` and `whileMorePrizesRemaining?`,
    `stage` gains `"Evolution"` (D300's own quoted price for a third stage word),
    and cards.ts gains `isEvolutionPokemon`. ZERO new `BoardCondition` members,
    ZERO new `EffectOp`s, ZERO new `GameState` fields, ZERO changes to any
    exported signature — the seat the prize comparison needs is DERIVED inside
    continuous.ts by `hasFreeRetreatAura`'s top-uid trick.

    ⚠️ **`units` IS THREE WILDCARDS AND THAT IS THE MULTISET, NOT A COUNT.**
    `[ANY_ENERGY, ANY_ENERGY, ANY_ENERGY]` is "only 3 Energy at a time" — the
    family's third distinct value (Prism 1, Neo Upper 2, this 3), so the three
    printings are now each other's controls on the arity axis.

    ⚠️ **THE CARD IS ITS OWN BEST TRAP ON POLARITY.** "More Prize cards REMAINING"
    is BEHIND on Prizes taken, and a board with equal prizes promotes NOTHING
    either way — so the natural single-board test passes under an inverted
    operator. `reversalEnergy.test.ts` drives ahead, behind AND level.
    2 printings, **1 legal** (`sv02-192` is `legal_standard = 0`); 1 of 1. */
const REVERSAL_ENERGY: CardProgram = {
  energy: {
    provides: ["Colorless"],
    promoteOnHolderStage: {
      stage: "Evolution",
      noRuleBox: true,
      whileMorePrizesRemaining: true,
      units: [ANY_ENERGY, ANY_ENERGY, ANY_ENERGY],
    },
  },
};

/** 🆕 D298 — Legacy Energy `sv06-167`, the ACE SPEC Special Energy and the LAST of
    D261's residue that was ever going to be cheap:

      "As long as this card is attached to a Pokémon, it provides every type of
       Energy but provides only 1 Energy at a time.
       If the Pokémon this card is attached to is Knocked Out by damage from an
       attack from your opponent's Pokémon, that player takes 1 fewer Prize card.
       This effect of your Legacy Energy can't be applied more than once per game."

    🛑 **THE FIRST PARAGRAPH IS ALREADY BUILT AND IS NOT A CLAUSE OF THIS ROW.**
    `provides: [ANY_ENERGY]` is Luminous Energy's line VERBATIM (M4 slice 5) — the
    printed string *"provides every type of Energy but provides only 1 Energy at a
    time"* IS one wildcard unit, and `costMet` has consumed it since. Four legal
    printings carry that string (`sv04-266`, `sv05-162`, `sv06-167`,
    `sv10.5b-086`); this is the only one that carries it UNCONDITIONALLY, which is
    why it needs no rider where Neo Upper and 🆕 Prism `sv10.5b-086` (D300, now
    BUILT) each need a `promoteOnHolderStage`. Of the four, only `sv04-266`
    Reversal Energy is still unbuilt.

    🛑 **AND THE SECOND PARAGRAPH IS D164's SENTENCE ON A NEW CARRIER, WHICH IS
    WHY THE INHERITED REFUSAL WAS HALF STALE.** `mistEnergy.test.ts` recorded this
    row as *"needs a prize hook AND a per-game latch; §14 has neither"* for five
    slices. The prize hook is §8.1's, not §14's, and it has existed since D164
    (`koPrizeReduction`, flow.ts `planPrizes`) for the byte-identical Munkidori ex
    antecedent; the attached-card SCAN has existed since D174 (`passivesOf`'s third
    source class) and its §8.1 KO-time twin since D141 (`koRecoilOf`, Vengeful
    Punch `sv03-197`, the same antecedent on a TOOL). **Only the latch was real** —
    `GameState.oncePerGameSpent`, one field, one writer, one reader.

    ⚠️ THE CAP KEY IS THE PRINTED EFFECT'S NAME AND IS SHARED WITH THE FIXTURE
    DEMONSTRATOR, because the sentence caps the EFFECT and not the printing. 1 legal
    printing of 1. */
const LEGACY_ENERGY: CardProgram = {
  energy: {
    provides: [ANY_ENERGY],
    passive: { onKoPrizeReduction: { by: 1, oncePerGame: "Legacy Energy" } },
  },
};

/** 🆕 D298 — Lillie's Pearl `sv09-151`, a Pokémon TOOL: *"If the Lillie's Pokémon
    this card is attached to is Knocked Out by damage from an attack from your
    opponent's Pokémon, that player takes 1 fewer Prize card."*

    🛑 **THE SECOND CARRIER OF ONE SENTENCE, AND IT IS WHY THE FIELD SITS ON
    `PassiveEffects` RATHER THAN ON `EnergyProgram`.** Legacy Energy alone would
    have justified an Energy-only field and been silently wrong the moment this Tool
    was read; `passivesOf` folds Tools and Energy through ONE `sources` array, so one
    field reaches both and the read site never learns which slot the card sat in.
    **These two are the WHOLE population of the printed sentence** (D1, 2026-08-09).

    ⚠️ **AND IT PRINTS A GATE THE ENERGY DOES NOT, WHICH IS THE POINT OF BUILDING
    BOTH.** *"the **Lillie's** Pokémon this card is attached to"* is D200/D267's
    owner-prefix subgroup vocabulary on the HOLDER, so a Pearl attached to any other
    body reduces nothing — and a build that took Legacy Energy alone and reused it
    here would grant that. D279's standing rule: reusing a mechanism copies the
    sentence it was written for. NO once-per-game cap: this one may fire every turn.
    1 legal printing of 1. */
const LILLIES_PEARL: CardProgram = {
  passive: { onKoPrizeReduction: { by: 1, requiresHolderOwner: "Lillie" } },
};

// ── D200 — THE OWNER-PREFIX SUBGROUP FILTER's own rows. Five programs / SIX
//    Standard-legal printings, every one a `searchDeck` whose only new datum is
//    the `ownerPokemon` filter. Counts measured against the remote D1 `luminous`
//    (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows / 20 sets, 2,021 of them
//    `legal_standard = 1`) on 2026-08-04; each row's `ids` is the COMPLETE set of
//    catalog printings carrying that exact sentence, legal or not.
//
//    ⚠️ AND SIX IS THE FINDING. The censuses that named this filter the largest
//    gap in the project counted 80 legal TEXT UNITS across the three columns —
//    and the filter alone finishes six printings, because almost every other
//    sentence needs a SECOND piece that does not exist: an in-play TARGET filter
//    on `attachEnergyFrom` / `switchActive` / `counterMove` (no op takes one), a
//    `coinFlipGate` `otherwise` branch, the first-turn-Supporter exemption flag
//    D199 flagged for Carmine, a passive scoped to a subgroup, or an owner-prefix
//    ENERGY predicate. `ownerPrefix.test.ts` names each with its missing piece
//    and asserts the id still unbuilt. This is D186's shape repeating: a gate
//    priced at 78 whose true yield was 12.

/** Cynthia's Gabite sv10-103 — "Champion's Call": "Once during your turn, you
    may search your deck for a Cynthia's Pokémon, reveal it, and put it into your
    hand. Then, shuffle your deck." (Ability)

    THE MINIMAL ROW OF THIS SLICE, and the one that shows the filter is the whole
    difference: strip the owner off the noun and this is Mesagoza's line. `max: 1`
    is the printed singular; `dest: "hand"` the printed destination; the trailing
    `shuffleDeck` the Nest Ball pattern, which runs on the whiff and on the
    decline exactly as every search in this vocabulary does. ⚠️ **"Reveal it"
    needs no op, but the reason written here — "a search that ends in the hand is
    public by construction (D42)" — was measured FALSE at D224**: the opponent
    got a count-only `DECK_SEARCHED` row and never learned the card. Annotated
    rather than deleted (D178): the claim is the record of what this row was
    authored on. **PAID at D225** — `reveal: true` below is the printed clause,
    and the log row now names the Cynthia's Pokémon.
    No `activeOnly`: the printed sentence carries no Active clause, and Gabite is
    a Stage 1 that plays from the Bench. 1 legal printing of 1. */
const CHAMPIONS_CALL: CardProgram = {
  abilities: [
    {
      name: "Champion's Call",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "searchDeck",
          filter: { kind: "ownerPokemon", owner: "Cynthia" },
          dest: "hand",
          max: 1,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Misty's Lapras sv10-050 / sv10-194 — "Swim Together" (attack index 0):
    "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into
    your hand. Then, shuffle your deck."

    The same two ops at the printed `max: 3`, on the ATTACK path rather than the
    Ability one — which is what makes this row worth having beside Gabite's: the
    deriver has no "Search your deck …" anchor at all (every deck search in the
    engine is registry-authored), so an attack carrying this sentence is
    unsimulated until a row names it. INDEX-KEYED, so index 1 "Surf" (60, no
    effect text) still falls through to the plain damage path — authoring `{0:…}`
    must not adopt it. 2 legal printings of 2. */
const SWIM_TOGETHER: CardProgram = {
  attack: {
    0: [
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Misty" },
        dest: "hand",
        max: 3,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ],
  },
};

/** Hop's Bag sv09-147 — "Search your deck for up to 2 Basic Hop's Pokémon and
    put them onto your Bench. Then, shuffle your deck." (Item)

    THE FIRST WRITER OF `stage: "basic"`, and Nest Ball's own program with the
    noun narrowed twice. `dest: "bench"` is the printed destination, and the
    interpreter already clamps a bench-bound search to `benchSpace` before
    anything leaves the deck, so a full Bench makes this a no-op that still
    shuffles rather than a card-destroying overflow. 1 legal printing of 1. */
const HOPS_BAG: CardProgram = {
  trainer: [
    {
      op: "searchDeck",
      filter: { kind: "ownerPokemon", owner: "Hop", stage: "basic" },
      dest: "bench",
      max: 2,
    },
    { op: "shuffleDeck" },
  ],
};

/** Steven's Baltoy sv10-083 — "Summoning Sign" (attack index 0): "Search your
    deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then,
    shuffle your deck."

    Hop's Bag's program on an attack — the two are byte-identical apart from the
    owner, and are DELIBERATELY separate consts rather than one shared object:
    they are near-twins printed on different cards, and sharing would let a later
    edit to one silently move the other (D199's rule for its own near-twins).
    Index 1 "Psychic Sphere" (20) stays on the plain damage path. 1 legal
    printing of 1. */
const SUMMONING_SIGN: CardProgram = {
  attack: {
    0: [
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Steven", stage: "basic" },
        dest: "bench",
        max: 2,
      },
      { op: "shuffleDeck" },
    ],
  },
};

/** Lillie's Comfey sv09-068 — "Inviting Flowers" (attack index 0): "You may
    search your deck for any number of Basic Lillie's Pokémon and put them onto
    your Bench. Then, shuffle your deck."

    ⚠️ TWO PRINTED WORDINGS THAT LOOK LIKE MISSING MECHANISMS AND ARE NOT.

    "**You may** search" is D186's fourth gate — and D186's own census puts this
    sentence in the 34 printings it calls ALREADY FREE: `searchDeck` parks with
    `min: 0`, so the decline the wrapper grants is one the op's own prompt already
    offers, and wrapping it in an `optional` would ask the same question twice.

    "**Any number**" has no cap of its own, and `searchDeck.max` is a number — but
    the destination supplies the only cap that exists. A bench-bound search is
    clamped to `benchSpace` in TWO places (the park's `max` and `searchMove`'s
    slice), so `BENCH_MAX` is not an approximation of "any number": it is the
    largest value the printed sentence can ever mean, and every smaller board
    clamps below it anyway. (effects.ts's `attachFromDeck` note says "no printed
    search says 'any number'" — true of ENERGY searches, which is the population
    it was written about; this is the Pokémon one, and it does.) 1 legal printing
    of 1.

    🆕 🛑 **D313 — INDEX 1 "Fade Out" IS NO LONGER UNAUTHORED, AND THE CONST IS
    RENAMED TO THE CARD** (`CHIEN_PAO`/`IONOS_BELLIBOLT_EX`'s shape: a sentence name
    for a one-sentence program, a CARD name once the object carries two). *"Put this
    Pokémon and all attached cards into your hand."*, cost {P}, `damage: 30`.

    ⚠️ **IT IS THE `dest: "hand"` MEMBER, AND IT TAKES NO `optional` WRAPPER**, which
    is the exact control for Crobat ex two hundred lines up: this sentence prints no
    *"you may"* at all, so the bounce is compulsory and a confirm prompt would invent
    a decision the card does not offer. Crobat ex prints one and gets one. **The two
    rows differ on the wrapper because the PRINTINGS differ, and they are in the same
    slice so that neither can be mistaken for house style.**

    ⚠️ **AND NO `attachmentsTo`**: *"and all attached cards into your hand"* sends the
    whole pile one way, so the field's ABSENCE is the printed sentence and not an
    omission — which is the half of the field D313 could not have driven from Crobat
    ex alone. */
const LILLIES_COMFEY: CardProgram = {
  attack: {
    0: [
      {
        op: "searchDeck",
        filter: { kind: "ownerPokemon", owner: "Lillie", stage: "basic" },
        dest: "bench",
        max: BENCH_MAX,
      },
      { op: "shuffleDeck" },
    ],
    1: [{ op: "returnSelf", dest: "hand" }],
  },
};

/** 🆕 **D313 — Revavroom ex `sv06.5-015`/`-081` "Shattering Speed"** (attack index
    **1**), cost three {M}, `damage: 250`: *"Discard this Pokémon and all attached
    cards."* **2 legal printings**, and it is the THIRD ZONE — the one neither
    `returnSelf` nor `returnBenched` could write before this slice.

    🛑 **A SELF-DISCARD IS NOT A KNOCK OUT AND THE DIFFERENCE IS PRIZES.** The body
    leaves play for the discard pile exactly as a Knocked Out one does, but §8.1's
    prize is taken by the player whose opponent's Pokémon was Knocked Out, and
    nobody Knocked this one out — so this op emits `POKEMON_RETURNED` and NOT
    `KNOCKED_OUT`, and the opponent takes nothing. The §8.1 promotion is still owed
    and is still queued by the seam D312 gave `finishAttack`, because that seam
    sweeps for an EMPTY ACTIVE SPOT and never asks why it is empty.

    ⚠️ **NO `optional` WRAPPER**: the sentence prints no *"you may"* — Revavroom ex
    deals 250 and then discards itself whether its controller likes it or not, which
    is the printed cost of the number. ⚠️ **AND INDEX 1 ONLY**: index 0 is
    "Accelerator Flash", a moved-from-the-Bench-this-turn conditional this engine
    does not read, and it must stay UNSIMULATED rather than inherit this program. */
const SHATTERING_SPEED: CardProgram = {
  attack: {
    1: [{ op: "returnSelf", dest: "discard" }],
  },
};

// ── D204 — the IN-PLAY TARGET filter (`AttachTargetRiders.ownerPokemon`) ──────
//
//    D200 landed the CARD half of the owner-prefix mechanic and measured its
//    yield at six printings, naming the reason exactly: `CardFilter` answers
//    "does this card match" for a deck / hand / discard scan, and NO OP TOOK A
//    PREDICATE FOR AN IN-PLAY TARGET. This slice buys the other half — one rider
//    on `AttachTargetRiders`, the interface that already spells "which of your
//    own in-play Pokémon may receive an attach" once for all three attach ops.
//
//    Verified against the live D1 (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786
//    rows / 20 sets, 2,021 `legal_standard = 1`) on 2026-08-04 with GLOB, never
//    LIKE — SQLite's LIKE is ASCII case-insensitive and D200's own finding is
//    that it turns a 6-row census into a 95-row one.

/** Spikemuth Gym sv10-169 — "Once during each player's turn, that player may
    search their deck for a Marnie's Pokémon, reveal it, and put it into their
    hand. Then, that player shuffles their deck." (Stadium)

    ⚠️ **THE ROW THAT NEEDED NOTHING NEW**, held back by D200 for scope and named
    in its flag table as free. Verified rather than taken on trust: this is
    `CHAMPIONS_CALL`'s two ops verbatim with the owner changed, moved from
    `abilities` onto `StadiumAbility.program` — and Levincia already proved that
    surface takes an arbitrary `EffectOp[]` and that `TurnAllowances`'
    `stadiumAbilityUsed` carries the printed "once during EACH player's turn"
    with no non-active-seat routing of its own. So the only D200 machinery this
    row uses is the `ownerPokemon` CARD filter, which shipped.

    A SEPARATE CONST from `CHAMPIONS_CALL` even though the op list differs only
    in the owner string, for D199's near-twin rule (and D200's, applied to
    Summoning Sign / Hop's Bag): two sentences printed on two different cards
    that happen to coincide must not share an object, or a later edit to one
    silently moves the other. `max: 1` is the printed singular, `dest: "hand"`
    the printed destination, the trailing `shuffleDeck` the Nest Ball pattern
    that runs on the whiff and on the decline alike. ⚠️ "Reveal it" needed no op —
    but "a search ending in the hand is public by construction (D42)" is FALSE as
    measured at D224 (annotated, not deleted — D178), and **PAID at D225**: the
    `reveal: true` rider below is that clause, and the log row names the card for
    BOTH seats — which matters more here than anywhere else in the family, since
    a Stadium's ability is usable by the opponent too. 1 legal printing of 1. */
const SPIKEMUTH_GYM: CardProgram = {
  stadium: {
    ability: {
      label: "Spikemuth Gym",
      program: [
        {
          op: "searchDeck",
          filter: { kind: "ownerPokemon", owner: "Marnie" },
          dest: "hand",
          max: 1,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  },
};

/** Iono's Bellibolt ex sv09-053/-172/-183/-188, svp-194 — "Electric Streamer":
    "As often as you like during your turn, you may attach a Basic {L} Energy
    card from your hand to 1 of your Iono's Pokémon." (Ability)

    ⚠️ **THE PRINTING D199 RANKED AS THE SINGLE HIGHEST-VALUE MISSING PIECE IN
    THE CATALOG, AND THE ONE D200 EXPLICITLY COULD NOT DELIVER.** Everything
    except the target noun was already here: Baxcalibur "Super Cold" is this
    sentence one owner short — same op, same source, same `oncePerTurn: false`
    for the printed "as often as you like", same `activeOnly: false`. The whole
    difference is `ownerPokemon: "Iono"`, which is the whole point of the slice.

    `oncePerTurn: false` is the printed "as often as you like" and NOT an
    oversight: the allowance is never consumed, so the Ability may be activated
    until the hand runs out of Basic {L} Energy, at which point
    `firstAttachableEnergy` makes it unplayable rather than a repeatable no-op.
    No zone rider — the printed noun says "1 of your Iono's Pokémon" with no
    "Benched", and §1.1 makes the Active one of your Pokémon (D120: honour the
    printed zone word, and only that word). 5 legal printings of 5. */
const IONOS_BELLIBOLT_EX: CardProgram = {
  abilities: [
    {
      name: "Electric Streamer",
      oncePerTurn: false,
      activeOnly: false,
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Lightning",
          ownerPokemon: "Iono",
        },
      ],
    },
  ],
};

/** N's PP Up sv09-153 — "Attach a Basic Energy card from your discard pile to 1
    of your Benched N's Pokémon." (Item)

    ⚠️ **THE PRINTING D200'S FLAG TABLE MISSED.** Its in-play-target row names
    "Iono's / Ethan's" at 5 + 4 and nothing else, but this Item is the same
    sentence a third time, and the CLEANEST of the three — one Energy, one
    target, no count to pin. It is also the row that exercises BOTH riders at
    once: the discard source (Fire Charge's arm) and `benchOnly`, which is the
    printed word "Benched" and drops the Active from the candidate set.

    `energyType` is ABSENT on purpose. The print says "a Basic Energy card",
    unqualified, so any Basic Energy in the discard is a legal source — and
    because same-type Basic Energy is fungible the op's only decision is still
    the target. (It is `basicEnergy`-shaped and never `providesEnergy`: the card
    sits in a pile attached to nothing and provides nothing — §6.5.)

    ⚠️ THIS IS THE ROW THAT MAKES THE `programPlayable` GATE LOAD-BEARING. An
    Item whose only op can no longer find a target must not be offered: with the
    rider in place, a board holding no benched N's Pokémon makes the attach a
    guaranteed whiff, and `attachEnergyFrom` is one of the ops that IS gated
    (cardplay.ts) precisely because it prints no trailing shuffle to charge for.
    Playing this into an all-Bellibolt Bench would otherwise burn the card for
    nothing. 1 legal printing of 1. */
const NS_PP_UP: CardProgram = {
  trainer: [
    {
      op: "attachEnergyFrom",
      source: "discard",
      benchOnly: true,
      ownerPokemon: "N",
    },
  ],
};

/** Marnie's Grimmsnarl ex sv10-136 — "Punk Up": "When you play this Pokémon from
    your hand to evolve 1 of your Pokémon during your turn, you may search your
    deck for up to 5 Basic {D} Energy cards and attach them to your Marnie's
    Pokémon in any way you like. Then, shuffle your deck." (Ability)

    ⚠️ **ALSO ABSENT FROM D200'S FLAG TABLE**, and the row that proves the rider
    belongs on `AttachTargetRiders` rather than on `attachEnergyFrom`: it is
    Charizard ex "Infernal Reign" with a target noun, on a DIFFERENT op
    (`attachFromDeck`) reading the SAME eligibility rule. One rider, two ops, no
    drift — which is the property `attachEnergyTargets` was factored out to keep.

    Every setting is straight off the print, and every one of them is Charizard's:
    - "search your deck" → `attachFromDeck` (no window, the whole list reachable);
    - "up to 5 **Basic {D} Energy cards**" → `max: 5` with `basicEnergy` +
      `energyType`, the PRINT and never `providesEnergy` (§6.5);
    - "**in any way you like**" → no `maxPerTarget`, so all five may land on one
      Marnie's Pokémon;
    - "**you may**" → `optional: true`, the framework auto-firing the trigger
      (D27) — and the decline the word buys also survives in the op's own "up to";
    - "Then, shuffle your deck" → the trailing `shuffleDeck`, which runs on the
      whiff, on the decline, and on the NO-TARGET board alike.
    - "to **your Marnie's** Pokémon" → the rider, and the only new word.

    An `onEvolve` trigger, so it fires through Rare Candy too (D28's shared
    `placeEvolution`) — and Grimmsnarl ex is a Stage 2, exactly the shape Rare
    Candy exists for. NOT gated by `programPlayable`: `attachFromDeck` never is
    (the trailing shuffle always resolves), and a board with no Marnie's Pokémon
    is a live path that no-ops into that shuffle. 1 legal printing of 1. */
const MARNIES_GRIMMSNARL_EX: CardProgram = {
  triggered: [
    {
      name: "Punk Up",
      trigger: "onEvolve",
      optional: true,
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Darkness" },
          max: 5,
          ownerPokemon: "Marnie",
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

// ── D205 — the SAME-TARGET ATTACH COUNT (`attachEnergyFrom.count`) ────────────
//
//    D204 landed the in-play target rider and measured, correctly, that it does
//    NOT finish this row: the print pins BOTH Energy to ONE body, where the
//    engine's multi-attach model was N independent ops each parking on their own
//    target. That model is right for Koraidon "Dino Cry"'s printed "in any way
//    you like" and wrong here, and the gap is exactly one field wide.
//
//    Re-derived against the live D1 (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786
//    rows / 20 sets, 2,021 `legal_standard = 1`) on 2026-08-04 with GLOB, never
//    LIKE. D204's ids for this row are CONFIRMED id-by-id against the catalog —
//    all four resolve to `Ethan's Ho-Oh ex` and all four are legal.

/** Ethan's Ho-Oh ex sv10-039/-209/-230/-239 — "Golden Flame": "Once during your
    turn, you may attach up to 2 Basic {R} Energy cards from your hand to 1 of
    your Benched Ethan's Pokémon." (Ability)

    ⚠️ **THE ROW D200 PRICED AT ZERO NEW PIECES AND D204 PROVED NEEDED ONE.**
    D200's flag table said the in-play target rider "plus nothing else —
    `attachEnergyFrom` already has `benchOnly` for the printed zone word **and a
    count of 2**". It does not and never did: `count` did not exist, and the only
    multi-attach the engine could spell was N separate ops, each with its own
    park and its own free choice of target. Authored that way this Ability would
    have let a player put one Energy on each of two different Ethan's Pokémon —
    a legal-looking program playing a rule the card does not print, which is the
    exact-map-or-flag doctrine's own failure case. D204 flagged it with the piece
    named; this slice builds the piece.

    Every setting is straight off the print:
    - "Once during your turn, you may" → `oncePerTurn: true`, and NOT `endsTurn`
      (that is Dino Cry's separate printed sentence, absent here);
    - "attach **up to 2**" → `count: 2`, ONE decision pinning the batch;
    - "**Basic {R} Energy** cards" → `energyType: "Fire"`, the PRINT and never
      `providesEnergy` (§6.5 — a card in hand provides nothing);
    - "from your **hand**" → `source: "hand"`;
    - "to 1 of your **Benched**" → `benchOnly: true`, so this Ho-Oh cannot feed
      the Active and cannot feed itself while Active;
    - "**Ethan's** Pokémon" → D204's `ownerPokemon` rider, unchanged.

    `activeOnly: false` because the print names no spot for the USER — Ho-Oh may
    be Benched itself and still use this. Note the two riders then interact
    exactly as printed: a Benched Ho-Oh is an "Ethan's Pokémon" on its own Bench,
    so it is a legal target for its own Ability, and the card says nothing that
    excludes it ("1 of your Benched Ethan's Pokémon" — no "other").

    ⚠️ GATED BY `programPlayable` ONLY ON THE ONE-CARD QUESTION, and that is
    deliberate: "up to 2" with a single {R} in hand attaches one, exactly as
    printed, so the gate that would refuse the Ability unless TWO were available
    is the wrong gate — see `firstAttachableEnergy` (interpreter.ts).
    4 legal printings of 4. */
const ETHANS_HO_OH_EX: CardProgram = {
  abilities: [
    {
      name: "Golden Flame",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Fire",
          count: 2,
          ownerPokemon: "Ethan",
          benchOnly: true,
        },
      ],
    },
  ],
};

// ── D207 — THE OPPONENT'S REMAINING-PRIZE GATE, WHICH NEEDED NO ENGINE CODE ───
//
// ⚠️ THE FINDING IS THAT THERE WAS NOTHING TO BUILD. D199's `DROPPED` row for
// Lacey priced this family at "ONE new `BoardCondition` union member", naming
// only `morePrizesThanOpponent` as the member that could not carry it — and
// `opponentPrizesRemaining { counts }` was ALREADY IN THE UNION at D199's own
// commit (`git show 21623b5:packages/engine/src/effects.ts`, three hits: the
// member at effects.ts:329 and Krokorok's / Houndstone's damage-bonus rows).
// `interpreter.ts` has folded it since the M5 board-condition slice, in BOTH
// consumers (`conditionHolds` for `conditionGate`, and the same call for
// `trainerPlayableIf`). Seven Standard-legal printings sat behind a flag that
// said "new union member" and meant "two registry rows".
//
// ⚠️ TWO SPELLINGS EXIST AND THEY ARE NOT THE SAME NUMBER. `prizes.length` is
// REMAINING (what is still face down); `opponentPrizesTaken` (a
// `DamageCountSource`, attack.ts:148) is `6 − remaining`. Both read the same
// array from the same seat and mean opposite ends of it. Both sentences below
// print the word "remaining", so both are the `BoardCondition`, and the test
// file asserts the two are not crossed at the value where it would show.
//
// Counts re-derived against the remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`; 3,786 rows / 20 sets, 2,021
// `legal_standard = 1`) on 2026-08-04, ⚠️ with `GLOB` and never `LIKE`, and over
// `json_each(abilities_json)` / `json_each(attacks_json)` rather than a grouped
// query on the JSON blob — D206 attributed a sentence to the wrong card that way
// two slices ago. `effect GLOB '*Prize cards remaining, draw*'` → exactly 7 rows,
// all `legal_standard = 1`, marks H and I:
//   ✅ "Shuffle your hand into your deck. Then, draw 4 cards. If your opponent
//      has 3 or fewer Prize cards remaining, draw 8 cards instead."
//      Lacey sv07-139/-166/-172, sv08.5-114/-175 — **5 legal. TAKEN.**
//   ✅ "Draw 2 cards. If your opponent has 3 or fewer Prize cards remaining,
//      draw 2 more cards."  Emcee's Hype sv10-163/-220 — **2 legal. TAKEN.**
//   ⏹️ "You can use this card only if your opponent has exactly 2 Prize cards
//      remaining. / Your opponent's Active **Tera** Pokémon is Knocked Out…"
//      Briar sv07-132/-163/-171, sv08.5-100 — 4 legal. **REFUSED.** The GATE is
//      free (`trainerPlayableIf: { counts: [2] }`, Fighting Au Lait's idiom at
//      the exact arity the member was built for), but the SECOND sentence needs a
//      **Tera** predicate, and the catalog has no way to answer it.
//
//      ⚠️ AND THE USUAL PHRASING OF THAT FLAG — "'Tera' is in no ingested
//      column" — IS FALSE AS WRITTEN, so it is narrowed here rather than
//      repeated. `name GLOB '*Tera*'` is 10 rows and `effect GLOB '*Tera *'` is
//      12. What those hits are is the whole point: the `name` rows are the
//      SPECIES Terapagos (plus the Item "Tera Orb"), and the `effect` rows are
//      five Trainers ASKING for Tera Pokémon (Briar ×4, Area Zero Underdepths,
//      Glass Trumpet, Sparkling Crystal, Tera Orb). Every hit is DEMAND. The
//      SUPPLY side — a column that marks a Pokémon AS Tera — does not exist, and
//      the demonstration is a card the engine already authors: Charizard ex
//      `sv03-125` IS a Tera Pokémon, and its row is `stage: "Stage2"`,
//      `types_json: ["Darkness"]`, `rarity: "Double rare"`, `regulation_mark:
//      "G"`, name "Charizard ex" — indistinguishable, field for field, from a
//      non-Tera Stage 2. The marker is a card-FRAME attribute the ingest drops.
//
//      An op authored over an absent datum has a permanently EMPTY candidate set,
//      which `programPlayable` turns into a card that can NEVER be played:
//      strictly worse than the loud "not simulated" path Briar takes today.
//      Flagged in `docs/reference/coverage-backlog-legal.md`'s dead-datum
//      section, driven, and left unbuilt.

/** Lacey — "Shuffle your hand into your deck. Then, draw 4 cards. If your
    opponent has 3 or fewer Prize cards remaining, draw 8 cards instead."
    (Supporter, mark H; sv07-139/-166/-172, sv08.5-114/-175 — 5 Standard-legal).

    Grusha's shape exactly, one condition over: the printed "**instead**" is a
    genuine if/ELSE, so this is the gate's `otherwise` arm and exactly one of the
    two `handRefresh` ops ever runs. The shuffle is inside BOTH arms because the
    card shuffles either way — only the DRAW COUNT is what "instead" replaces.

    ⚠️ `counts: [0, 1, 2, 3]` is the literal reading of "3 or fewer", and the
    member's doc block is right that it is set MEMBERSHIP rather than a threshold:
    a threshold ENCODING would be a second field, and enumerating the set is how
    this union spells an inequality. `0` is in the set for exactness and is
    UNREACHABLE in a legal game (taking the sixth Prize ends it), so it is pinned
    at the `conditionHolds` level — where it is observable — and NOT claimed as a
    game-level difference. */
const LACEY: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
      otherwise: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 4 } }],
    },
  ],
};

/** Picnicker — "Flip a coin. If heads, draw 4 cards. If tails, draw 2 cards."
    (Supporter, mark H; svp-114 — **1 Standard-legal printing**, a promo with no
    set twin: the `%If tails%` census over `abilities_json` + `effect` returns 9
    legal printings on 6 sentences and this name accounts for exactly one of them).

    **D269's SIMPLEST POSSIBLE WITNESS FOR `coinFlipGate.otherwise`** — the whole
    card is the field. Two `drawCards`, one in each arm, and nothing else: no
    shuffle, no condition, no rider, no second op before or after the gate. If the
    losing face spliced nothing (the pre-D269 meaning of an absent `otherwise`)
    this card would draw 4 or draw NOTHING, and the difference is one number in
    one hand.

    ⚠️ TWO `drawCards` IN TWO ARMS, NOT ONE `drawCards` WITH A COMPUTED COUNT.
    Exactly one runs, so the log carries exactly one CARDS_DRAWN row of 4 or of 2 —
    which is how the card reads. (Emcee's Hype one program up is the OTHER
    reading, and the two are not interchangeable: its second draw is printed
    "**more**", so its rows are additive and BOTH fire.) */
const PICNICKER: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "drawCards", count: 4 }],
      otherwise: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/** Drasna — "Shuffle your hand into your deck. Then, flip a coin. If heads, draw
    8 cards. If tails, draw 3 cards." (Supporter, mark I; sv08-173/-231 — 2
    Standard-legal printings, one set number and one alternate art of the SAME
    sentence).

    **LACEY'S SHAPE EXACTLY, WITH A COIN FOR A CONDITION.** A whole `handRefresh`
    sits in each arm, because the shuffle happens on BOTH faces and the only thing
    the second sentence replaces is the DRAW COUNT — the same reason Lacey's
    printed "instead" puts the op in both arms rather than gating a bare draw. The
    op's shuffle is intrinsic (there is no separate `shuffleDeck`), so hoisting it
    out of the arms is not available even if it read better.

    ⚠️ THE FLIP IS TAKEN BEFORE THE SHUFFLE, AND THE PRINT SAYS "Then". That is a
    LOG-ORDER difference and not a rules one — `coinFlipGate` announces the coin
    before it consults a branch, so ATTACK_EFFECT_COIN_FLIP precedes
    HAND_SHUFFLED_INTO_DECK here where the card prints them the other way round.
    Nothing about the outcome depends on it: the coin does not read the deck and
    the shuffle does not read the coin, and both orders consume the same two rng
    steps. Said out loud rather than left for a reader to notice, because it is the
    one place this authoring departs from the printed sequence. */
const DRASNA: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
      otherwise: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 3 } }],
    },
  ],
};

/** Harlequin — "Each player shuffles their hand into their deck. Then, flip a
    coin. If heads, you draw 5 cards, and your opponent draws 3 cards. If tails,
    you draw 3 cards, and your opponent draws 5 cards." (Supporter, mark I;
    sv10.5w-083/-163 — 2 Standard-legal printings, one set number and one
    alternate art of the SAME sentence).

    **DRASNA'S PROGRAM WITH TWO SEATS INSTEAD OF ONE, AND THE ONLY NEW THING IS
    THE DRAW.** A whole `handRefresh` sits in each arm for the reason Lacey's and
    Drasna's do — the shuffle happens on BOTH faces and the second sentence
    replaces only the counts — and the seat set is `who: "both"` because the card
    opens "Each player". D270's `HandRefreshDraw.perSeat` is what the two printed
    PAIRS need: 5/3 on heads, 3/5 on tails.

    🛑 **THE TAILS ARM IS THE HEADS ARM WITH THE PAIR SWAPPED, WHICH IS WHY BOTH
    NUMBERS APPEAR TWICE AND NEITHER CARD-LEVEL ABBREVIATION IS AVAILABLE.** The
    two 5s are not the same 5 (one is the controller's, one is the opponent's), so
    a build that read `you` for every seat, or that gated on the wrong face, still
    deals 5 and 3 to SOMEBODY on every board. Only reading BOTH hands on BOTH
    faces tells the four candidate mis-builds apart — which is what the suite does.

    ⚠️ AND THE TWO SENTENCES THAT LOOK IDENTICAL ARE STILL UNBUILT, FOR A REASON
    THAT IS NOT THIS FIELD. Unfair Stamp `sv06-165` ("you draw 5 cards, and your
    opponent draws 2 cards") and Team Rocket's Archer `sv10-170`/`-223` (5/3) print
    exactly this mechanism — their DRAW is expressible as of this slice — but both
    open "You can use this card only if any of your Pokémon were Knocked Out during
    your opponent's last turn", a PLAY GATE that reads a datum `GameState` does not
    carry (grepped: no last-turn-KO field, and the five `BoardCondition` kinds are
    prize count, stadium, self-energy, defender damage and defender stage). That is
    a STATE change plus a condition member — two more mechanisms — so they are
    priced and declined here rather than forced.

    ⚠️ THE FLIP IS TAKEN BEFORE THE SHUFFLE AND THE PRINT SAYS "Then", exactly as
    Drasna's block records: a LOG-ORDER difference, not a rules one. */
const HARLEQUIN: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
      otherwise: [
        { op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 3, opponent: 5 } },
      ],
    },
  ],
};

// ── D271 — the LAST-TURN-KO play gate (`yourPokemonKoedOnOpponentsLastTurn`).
//    THREE legal printings on ONE printed sentence and TWO different second
//    halves, which is the whole reason the gate is worth a `GameState` field:
//    it is the first `BoardCondition` that reads TURN HISTORY, and the two cards
//    behind it share nothing else at all. (verified vs the live D1 2026-08-07 —
//    both `legal_standard = 1`.) ──

/** Unfair Stamp — "You can use this card only if any of your Pokémon were
    Knocked Out during your opponent's last turn. / Each player shuffles their
    hand into their deck. Then, you draw 5 cards, and your opponent draws 2
    cards." (Item; sv06-165 — 1 Standard-legal printing).

    **THE ROW THAT NEEDED BOTH HALVES OF TWO SEPARATE SLICES.** Its DRAW is
    D270's `HandRefreshDraw.perSeat` — the asymmetric printed pair, `who: "both"`
    because the sentence opens *"Each player…"* and only the COUNT splits — and
    its GATE is this slice's `trainerPlayableIf`. Neither existed at D269; the
    draw arrived at D270 and D270 measured this card as still blocked, naming
    exactly the missing datum. It is the first `trainerPlayableIf` whose condition
    is not answerable off the board in front of the player.

    ⚠️ 5/2 AND NOT 5/3 — Team Rocket's Archer prints 5/3 behind a gate that is
    this one NARROWED (D326, two rows down). Getting the pair wrong between the
    two cards would be invisible on any board where only one is in the deck, so
    the numbers are read off each card's own D1 row rather than off the sibling,
    and `archerDrawsOneMore` in `lastKoOwnerMark.test.ts` reads BOTH hands on ONE
    board to keep them apart. */
const UNFAIR_STAMP: CardProgram = {
  trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
  trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 2 } }],
};

/** 🆕 D326 — Team Rocket's Archer — "You can use this card only if any of your
    **Team Rocket's** Pokémon were Knocked Out during your opponent's last turn. /
    Each player shuffles their hand into their deck. Then, you draw 5 cards, and
    your opponent draws 3 cards." (Supporter; sv10-170/-223 — 2 Standard-legal
    printings, byte-identical `effect`, read off the remote D1 rather than
    quoted from this page: **no handoff had ever printed this sentence**, which
    is why it sat unpriced through five of them).

    **THE OLDEST UNPRICED ROW ON `docs/progress.md`, AND IT COST ONE FIELD.**
    D270 declined it, D271 declined it again and wrote down exactly why — the
    gate narrows the KO SET to an owner subgroup and `lastKoTurn` records WHEN a
    seat lost a Pokémon, never WHICH. That was TRUE at head and still is; D326
    added the per-body record (`GameState.lastKoMarks`) it said the prefix would
    want, and the gate is then D271's own member with one optional field set.

    ⚠️ **THE SECOND HALF WAS ALREADY SPELLABLE AND IS BYTE-FOR-BYTE UNFAIR
    STAMP'S, ONE NUMBER APART** — `handRefresh` `who: "both"` with D270's
    `perSeat` draw at the printed 5/**3**. Zero new ops, zero new op fields. The
    whole slice on the Trainer surface is the `owner` key.

    ⚠️ AND THE OWNER IS THE BARE SUBGROUP "Team Rocket", NOT "Team Rocket's" —
    `CardFilter.ownerPokemon`'s convention, so the gate and the five other rows
    in this file that name the subgroup spell it once. */
const TEAM_ROCKETS_ARCHER: CardProgram = {
  trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" },
  trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
};

/** Hassel — "You can use this card only if any of your Pokémon were Knocked Out
    during your opponent's last turn. / Look at the top 8 cards of your deck and
    put up to 3 of them into your hand. Shuffle the other cards back into your
    deck." (Supporter; sv06-151/-205 — 2 Standard-legal printings, one set number
    and one alternate art of ONE sentence).

    **ZERO ENGINE CODE BEYOND THE GATE.** The second half is `lookAtTopN` at the
    printed 8/3 with `{ kind: "anyCard" }` — the sentence says "cards", not a
    class — followed by the trailing `shuffleDeck` that every look-then-keep
    Trainer in this file already carries (Great Ball, Pokégear): "Shuffle the
    other cards back into your deck" is NOT a field on the op, because those
    cards never left the deck (see the op's own note). No `reveal`: this sentence
    prints none, and `reveal` is absent rather than `false` (D135).

    ⚠️ IT IS THE PROOF THAT THE GATE IS A VOCABULARY AND NOT A CARD. Unfair Stamp
    and Hassel share ONE printed sentence and no other machinery whatsoever — a
    `handRefresh` Item against a `lookAtTopN` Supporter — so a gate built as a
    field on `handRefresh` (the tempting shortcut, since the Stamp was the row
    that motivated it) would have bought one printing instead of three. */
const HASSEL: CardProgram = {
  trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
  trainer: [{ op: "lookAtTopN", n: 8, filter: { kind: "anyCard" }, max: 3 }, { op: "shuffleDeck" }],
};

/** Emcee's Hype — "Draw 2 cards. If your opponent has 3 or fewer Prize cards
    remaining, draw 2 more cards." (Supporter, mark I; sv10-163/-220 — 2
    Standard-legal).

    Falkner's shape exactly, one condition over: a ONE-ARMED gate whose base draw
    is unconditional and whose bonus is a SECOND `drawCards` inside it. Printed
    "draw 2 **more**" is additive where Lacey's "instead" is replacing, and the
    two ops rather than one computed count keep the log reading as the card does
    (two CARDS_DRAWN rows of 2, not one of 4). */
const EMCEES_HYPE: CardProgram = {
  trainer: [
    { op: "drawCards", count: 2 },
    {
      op: "conditionGate",
      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/** Teal Mask Ogerpon ex — "Teal Dance": "Once during your turn, you may attach a
    Basic {G} Energy card from your hand to this Pokémon. If you attached Energy
    to a Pokémon in this way, draw a card." (Ability, marks H+I; svp-166,
    sv06-025/-190/-211/-221, sv08.5-012/-145/-177 — **8 Standard-legal
    printings**, the top row of `docs/reference/coverage-backlog-legal.md`'s
    ranked backlog and the best printings-per-edit left in that file).

    ⚠️ **D190 PRICED THIS AS TIER 1 AND REFUSED IT, AND THE REFUSAL WAS RIGHT** —
    the census said every op existed; two fields did not. Both are D221's, both
    are on `attachEnergyFrom`, and the row below is what they buy:

      • **`toSelf`** — the printed "to **this Pokémon**". The riders that existed
        (`targetType`/`basicOnly`/`ownerPokemon`) all name a CLASS, and on a board
        with two {G} bodies a class rider offers the wrong one. `sourceRef` reads
        `ctx.sourceUid`, so a BENCHED Ogerpon feeds itself — the sentence carries
        no Active clause, and `activeOnly: false` says the same thing on the other
        end.
      • **`recordAs`** — the op filed nothing, so the §9.2 gate had nothing to
        read. `recordGate` is the printed "**If you attached Energy** … in this
        way", and it is a plain gate (no `contains`): the print says "to a
        Pokémon", and the only Pokémon this attach can reach is the source.

    The draw is INSIDE the gate rather than beside it, and that is the whole
    conditional: an empty hand of {G} makes the Ability whiff, and a whiff must
    not draw. `programPlayable` refuses the activation outright in that case
    (`firstAttachableEnergy`), so the gate's false arm is reachable only through
    a mid-program change of state — kept anyway, because the print says it.

    ⚠️ `oncePerTurn: true` is the printed "**Once during your turn**", not a
    default: Baxcalibur's "As often as you like" is the same op with the flag
    false, and the two are one word apart in the print and one boolean apart
    here. */
const TEAL_DANCE: CardProgram = {
  abilities: [
    {
      name: "Teal Dance",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Grass",
          toSelf: true,
          recordAs: "moved",
        },
        {
          op: "recordGate",
          slot: "moved",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [{ op: "drawCards", count: 1 }],
        },
      ],
    },
  ],
};

/** Hydrapple ex — "Ripening Charge": "Once during your turn, you may attach a
    Basic {G} Energy card from your hand to 1 of your Pokémon. If you attached
    Energy to a Pokémon in this way, heal 30 damage from that Pokémon." (Ability,
    mark H; `sv07-014`/`sv07-156`/`sv07-167`/`sv08.5-011` — **4 Standard-legal
    printings**, the ability half of backlog row 12 and the sentence that page
    calls *"the cheapest single program left in the pool"*).

    ⚠️ **THE SENTENCE IS TEAL DANCE'S ABOVE WITH TWO WORDS CHANGED, AND BOTH
    CHANGES ARE STRUCTURAL.** Read the two rows side by side:

      • **"to 1 of your Pokémon"** where Teal Dance prints **"to this Pokémon"**.
        That is the difference between a UID answer and a QUESTION: `toSelf` is
        absent here, so `attachEnergyFrom` falls through to
        `attachEnergyTargets` — every own body, no class rider — and the op
        PARKS on a `choosePokemon`. Teal Dance's whole slice (D221) was buying
        the field that makes the park go away; this row is what the park was
        always for, and the two rows are the falsifiability pair for `toSelf`
        (D231): one printing spells each side.
      • **"heal 30 damage from that Pokémon"** where Teal Dance prints **"draw a
        card"**. Teal Dance reaches its tail through `recordAs` → `recordGate`,
        and this one CANNOT: `recordAs` files the ENERGY uids, never the body, so
        a §9.2 gate could only reach `healChosen`, which parks and would let the
        controller heal a Pokémon the card never fed. The printed word is *"THAT
        Pokémon"* — the one just chosen, no second decision — and that is
        `attachEnergyFrom.healTarget` (D236), applied by the op that already
        knows the ref.

    🛑 **AND THAT IS WHY THIS ROW SHIPS NO `recordAs` AND NO `recordGate`, WHICH
    IS THE OPPOSITE OF WHAT THE BACKLOG PAGE AND `legalNonAttackPrograms.test.ts`
    BOTH PRESCRIBED.** Both said "`attachEnergyFrom.recordAs` … AND a heal that
    reads the recorded TARGET". The blocker they named was real and the REMEDY
    was wrong on both halves: no record is needed at all, and the heal reads the
    op's own `ref` rather than anything filed. D236 shipped `healTarget` as
    `bonusCounters`' mirror for exactly this reason and left the NUMBER arm
    unconsumed, saying in the field's own doc that it was "driven at the op
    level, where its consumer will be". **This is that consumer.**

    ⚠️ `healTarget: 30` IS THE PRINTED NUMBER AND NOT A CLAMP — `healChosen`
    already answers `min(30, damage)` and stays silent at zero damage, so a body
    with 10 damage heals 10 and an undamaged one is fed and emits no `HEALED`.
    The "if you attached Energy … in this way" antecedent needs no gate of its
    own: every whiff path in `attachEnergyFrom` returns BEFORE the heal.

    ⚠️ `oncePerTurn: true` is the printed "Once during your turn", and the stamp
    is keyed `${uid}:${ability.name}` — by BODY, not by CARD — so two Hydrapple
    ex in play are two independent uses, which is the print. That per-body
    reading is `true`'s and stays `true`'s: D272's `"sharedByName"` is the OTHER
    scope, taken only by a card that prints the second sentence Hydrapple ex does
    not ("You can't use more than 1 <name> Ability each turn"). `activeOnly: false`:
    the sentence carries no Active clause, so a benched Hydrapple ex charges. */
const RIPENING_CHARGE: CardProgram = {
  abilities: [
    {
      name: "Ripening Charge",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Grass",
          healTarget: 30,
        },
      ],
    },
  ],
};

/** Bloodmoon Ursaluna `sv06.5-025`/`sv08.5-054` — "Battle-Hardened": "When you
    play this Pokémon from your hand onto your Bench during your turn, you may
    attach up to 2 Basic {F} Energy cards from your hand to this Pokémon."
    (Ability, mark H — **2 Standard-legal printings on ONE sentence**, the
    triggered-attach third of backlog row 12's ability half.)

    The count was re-derived on the SHAPE and not on those two ids — `LIKE '%when
    you play this pok%onto your bench%attach%'`, `legal_standard = 1`, swept over
    `json_each(abilities_json)` / `json_each(attacks_json)` / `effect` and GROUPED
    BY SENTENCE (remote D1 `luminous`, 2026-08-07). Exactly 2, the SEVENTEENTH row
    running to survive re-derivation.

    ⚠️ **THE TWO PRINTINGS ARE BYTE-IDENTICAL CARDS, NOT MERELY A SHARED
    SENTENCE** — same name, HP (150), stage (Basic), type ({F}), retreat (4),
    Weakness (×2 Grass), no Resistance, the same "Mad Bite" attack and the same
    Ability. So one program object serves both by construction, and there is no
    second body for a reader to get wrong.

    🛑 **EVERY PIECE OF THIS PROGRAM WAS BUILT BY A DIFFERENT SLICE FOR A
    DIFFERENT CARD, WHICH IS WHY IT COSTS NOTHING BUT THIS OBJECT** — the second
    slice running with that shape, after D249:
      • *"When you play this Pokémon from your hand onto your Bench during your
        turn"* — `trigger: "onPlayToBench"`, shipped at M4 slice 6 (Flamigo,
        Durant ex, Hawlucha).
      • *"up to 2 … cards"* — `attachEnergyFrom.count` (D205, Ethan's Ho-Oh ex).
        D205's rule is that `count` parks ONCE and pins the batch to the ONE
        chosen body, which is exactly what a single-destination print wants; the
        printed hedge is honoured by the op's own `min(count, available)`, so a
        hand holding one {F} attaches one and a hand holding none whiffs.
      • *"to **this** Pokémon"* — `toSelf` (D221, Teal Mask Ogerpon ex), read
        through `sourceRef`.
      • *"Basic {F} Energy"* — `energyType: "Fighting"`, and NO `anyEnergy`,
        because the printed noun carries "Basic" (D246's boolean is the other
        reading and this sentence is not it).

    ⚠️ **`toSelf` + `count` IS THE FIRST TIME THOSE TWO FIELDS CO-OCCUR, AND IT IS
    THE ONE THING THIS ROW HAD TO CHECK RATHER THAN ASSUME.** `toSelf` resolves
    the destination to AT MOST ONE ref, so `parkOrForce` forces and this op never
    parks — which means the batch of 2 lands on the host with no prompt at all,
    and the `count`-naming caption (D205's *"Attach up to 2 …"*) is unreachable
    here exactly as its own comment says. The two fields are orthogonal (one is
    the DESTINATION, one is the BATCH SIZE) and neither reads the other, so the
    cross needed no referee — but it needed driving, and it is driven both ways
    (a hand with 3 {F} attaches 2; a hand with 1 attaches 1).

    ⚠️ **AND `ctx.sourceUid` IS PRESENT ON THE TRIGGER PATH, WHICH IS THE CLAUSE
    THIS SLICE WAS TOLD WAS MOST LIKELY TO COST AN ENGINE LINE.** `toSelf` reads
    `sourceRef(state, ctx)`, and D221 built it for an ACTIVATED Ability where
    `useAbility` sets the uid explicitly. `runBoardTrigger` (triggers.ts) sets it
    too — `runProgram(state, ability.program, { seat, sourceUid: uid }, events)`,
    where `uid` is `topUid(pokemon)` of the body that just landed — so the field
    was already on the board-trigger context and the cross costs zero engine
    lines. **Read, not inferred**: the risk was real and the answer was no.

    ⚠️ `optional: true` IS THE PRINTED "you may" AND IT AUTO-FIRES, which is the
    same reading `Sudden Shearing` takes on the same timing: the flag's own doc
    says every representative is pure upside, and attaching your own Energy to
    your own body is upside with no downside to decline. It is NOT the `optional`
    OP (`Rapid Vernier`'s), which exists because SWITCHING a fresh body into the
    Active Spot is a real cost. There is nothing to decline here, and a whiffing
    attach (an empty hand) already returns before anything happens.

    ⚠️ **NO `activeOnly`** — the sentence's timing clause names the BENCH, so the
    body is benched by construction and an `activeOnly: true` would refuse every
    firing there is. Stated because it is the field the two neighbouring rows in
    this family both carry.

    ⚠️ **AND NO `recordAs`/`recordGate`** — this row has no second clause to gate.
    Said out loud because the row above it (Ripening Charge) is the slice on which
    a `needs` string prescribed exactly that pair on a sentence that wanted
    neither. */
const BATTLE_HARDENED: CardProgram = {
  triggered: [
    {
      name: "Battle-Hardened",
      trigger: "onPlayToBench",
      optional: true,
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Fighting",
          count: 2,
          toSelf: true,
        },
      ],
    },
  ],
};

/** Iono's Kilowattrel — "Flashing Draw": "You must discard a Basic {L} Energy
    from this Pokémon in order to use this Ability. Once during your turn, you may
    draw cards until you have 6 cards in your hand." (Ability, marks H+I; svp-182,
    sv09-055, sv09-163 — **3 Standard-legal printings**, row 3 of
    `docs/reference/coverage-backlog-legal.md`'s ranked table and the SECOND of
    D190's four `DROPPED` rows to be collected).

    ⚠️ **D190 PRICED THIS AS TIER 1 AND REFUSED IT, AND THE REFUSAL WAS RIGHT** —
    the census said every op existed; the `from` member did not. D222 built it, and
    the row below is what it buys:

      • **`discardEnergy { from: "self" }`** — the printed "from **this Pokémon**".
        The nearest existing member, `yourActive`, means that only inside an
        ATTACK, where §8 makes the actor the Active. This sentence is an ABILITY's
        and carries **no Active clause** (`activeOnly: false` says so on the other
        end), so with `yourActive` a BENCHED Kilowattrel would pay its cost off
        whichever body happened to be Active — and would be USABLE while holding
        no {L} at all. It reads `sourceRef`, the same 0-or-1 ref list
        `attachFromDeck.toSelf` (D171) and `attachEnergyFrom.toSelf` (D221) read.
      • **`programPlayable`'s `sourceUid`** — the piece the resume point told this
        slice to price BEFORE writing the op, and it was the larger half. "You
        MUST discard … IN ORDER TO USE this Ability" is a COST, so a host holding
        no Basic {L} may not activate at all; that gate could not ask "does THIS
        body hold one" (it took no uid), and a gate that asks about the wrong
        Pokémon is worse than no gate.

    ⚠️ **THE DISCARD IS THE FIRST OP, WHICH IS THIS ENGINE'S SPELLING OF A COST**
    — there is no `cost` FIELD (the AbilityProgram doc block's doctrine, and
    Trade's `payFromHand` shape exactly). The difference from every existing
    Ability cost is only WHERE it is paid from: `payFromHand` empties the HAND and
    is refused by `handCostUnmet`, this one empties the BOARD and is refused by
    `programPlayable`. Both refuse before anything is committed, so the draw can
    never be had for free.

    ⚠️ **`drawUntilHandSize 6`, NOT `drawCards`, and it NEVER TRIMS** (D181): a
    hand already holding six or more draws NOTHING and the cost is still paid.
    That is the print — the sentence names a target hand size, not a number of
    cards — and the gate deliberately does not refuse it: a draw is "playable
    enough" in this engine (the deck is not public knowledge), and refusing on
    hand size would be inventing a clause the card does not print.

    ⚠️ `oncePerTurn: true` is the printed "Once during your turn"; the "you may"
    in that clause is the ACTIVATION, not an `optional` op — the player's "no" is
    simply not using the Ability, which is Trade's reading of the same words and
    the whole reason `optional` (D186) exists for printed "you may"s INSIDE a
    program instead. */
const FLASHING_DRAW: CardProgram = {
  abilities: [
    {
      name: "Flashing Draw",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "discardEnergy",
          from: "self",
          filter: { kind: "basicEnergy", energyType: "Lightning" },
        },
        { op: "drawUntilHandSize", size: 6 },
      ],
    },
  ],
};

/** D223 — CARMINE (Supporter). "If you go first, you may use this card during
    your first turn.\n\nDiscard your hand and draw 5 cards." — sv06-145 /
    sv06-204 / sv06-217 / sv08.5-103, all four `legal_standard = 1`, all four
    byte-identical (remote D1 `luminous`, 2026-08-05).

    ⚠️ TWO SENTENCES, TWO MECHANISMS, AND THE FIRST ONE IS NOT DECORATION. D190's
    census recorded the first-turn clause as "INERT — the engine has no going-first
    Supporter lock for it to lift". The lock has existed since M4, so authoring the
    second sentence alone would have made this card REFUSED on the one turn it is
    printed to be legal on — strictly worse than unbuilt, which is exactly why
    D190 dropped the row instead of approximating it (*EXACT MAP OR FLAG*).
    `trainerFirstTurnExempt` is that first sentence; see its doc on `CardProgram`.

    ⚠️ NOT `PROFESSORS_RESEARCH` WITH A DIFFERENT NUMBER, AND DELIBERATELY ITS OWN
    OBJECT. The two are near-twins ("Discard your hand and draw 7 cards.") and
    sharing would let a later edit to one silently move a card that never printed
    those words — D190's stated reason for giving each Tier-1 program its own
    const, and it bites harder here because this row carries a FLAG the other must
    never gain. */
const CARMINE: CardProgram = {
  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 5 }],
  trainerFirstTurnExempt: true,
};

/** D224 — TEAM ROCKET'S PROTON (Supporter). "If you go first, you may use this
    card during your first turn.\n\nSearch your deck for up to 3 Basic Team
    Rocket's Pokémon, reveal them, and put them into your hand. Then, shuffle
    your deck." — sv10-177 / sv10-227, both `legal_standard = 1`, both
    byte-identical, and the ONLY two rows in the catalog carrying this sentence
    (remote D1 `luminous`, 2026-08-05).

    ⚠️ **TWO SENTENCES, TWO SLICES, AND THIS ROW IS THE PLACE THEY MEET.** The
    first is D223's `trainerFirstTurnExempt` verbatim — an engine piece bought for
    Carmine that transfers here for nothing, which is the *an arm transfers, a row
    does not* rule running in the direction that pays. The second is D200's
    `ownerPokemon` filter at its `stage: "basic"` narrowing, `dest: "hand"`, on
    `searchDeck`'s printed "up to" (`max: 3`, and the park's own `min: 0` is what
    makes "up to" mean *up to*, including none). The trailing `shuffleDeck` is the
    Nest Ball pattern, which runs on the whiff and on the decline alike. So: **one
    registry row, zero new engine code.**

    ⚠️ **ITS OWN OBJECT, NOT `HOPS_BAG`'s WITH THE OWNER CHANGED** (D199/D200's
    near-twin rule, and it bites hardest on the flag): Hop's Bag is the same op at
    `dest: "bench"`, `max: 2`, and prints no going-first licence. A shared object
    would hand an Item a §4 exemption it never printed.

    ✅ **THE PRINTED "REVEAL THEM" IS MODELLED AS OF D225** — the `reveal: true`
    rider below, read in `log.ts`'s `DECK_SEARCHED` arm, so the opponent now reads
    *"searched their deck — revealed Team Rocket's Meowth ×2, Team Rocket's
    Mimikyu and put them in hand"* where they used to read a bare count. The
    paragraphs that follow are D224's measurement, kept verbatim as the record of
    what this row shipped on (D178) — read them in the past tense.

    🛑 **THE PRINTED "REVEAL THEM" IS NOT MODELLED — SAID OUT LOUD, BECAUSE
    THE CLAIM THIS FILE USED TO MAKE ABOUT IT IS FALSE.** Three rows here assert
    that a reveal "needs no op — a search that ends in the hand is public by
    construction", and JACQ's says it is "implicit in a to-hand search". Measured
    instead of assumed (D224): the search prompt is redacted to the ACTOR ALONE
    (redact.ts's hidden-candidate family), the hand is withheld from the opponent,
    and the only thing that crosses is the `DECK_SEARCHED` log row — which is
    **count-only** ("put 3 cards in hand"). The opponent learns a number. In paper
    they see the cards.

    ⚠️ It is nonetheless **not** an *EXACT MAP OR FLAG* refusal, and the reason is
    a measurement rather than a preference: the clause moves no card, changes no
    zone, gates no legality and files no §9.2 record — it is an INFORMATION debt,
    it is **shared by all 16 authored `searchDeck {dest:"hand"}` rows**, and
    dropping this row for it would refuse a mechanic the engine already ships
    everywhere else. What the measurement DOES kill is the cheap fix: of the **41
    Standard-legal printings** that search the deck into hand, **4 print no reveal
    at all** (Cassiopeia sv06.5-056/-086/-094 and Amulet of Hope sv08-162 — all
    four search for *"cards"*, unfiltered, where a reveal would be a real leak).
    **So the reveal is a property of the printed SENTENCE, not of the
    DESTINATION**, and naming the cards in the `DECK_SEARCHED` row wholesale would
    make those four lie. The honest shape is a rider on the op read at the log
    site — a field plus its read sites, which is a slice, not a footnote. Pinned
    red-able in `proton.test.ts` rather than left as prose.

    ⚠️ **D225 CORRECTED TWO OF D224's NUMBERS AND KEPT ITS CONCLUSION.** The
    census above read the `effect` column only; re-run over all three text
    columns with `json_each` (the D206 rule), the Standard-legal population is
    **100 printings / 55 sentences**, of which **15 printings / 8 sentences print
    no reveal** — not 41 and 4. The extra eleven are Thwackey, Eldegoss, Scrafty,
    Greninja ex, Noctowl and Serperior ex, every one of them searching for
    uncategorised *"cards"* exactly as Cassiopeia does. The conclusion the number
    was used for got STRONGER, which is the good case; the lesson is that a
    single-column census is a floor. */
const TEAM_ROCKETS_PROTON: CardProgram = {
  trainer: [
    {
      op: "searchDeck",
      filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
      dest: "hand",
      max: 3,
      reveal: true,
    },
    { op: "shuffleDeck" },
  ],
  trainerFirstTurnExempt: true,
};

/** D242 — Team Rocket's Mewtwo ex "Power Saver": *"This Pokémon can't attack
    unless you have 4 or more Team Rocket's Pokémon in play."*
    `svp-205`/`svp-216`/`sv10-081`/`sv10-213`/`sv10-231`/`sv10-240` — **SIX
    Standard-legal printings**, the biggest reprint group left in the ABILITY
    column and backlog row 14's first third.

    A `passive` and NOT an `abilities` entry, which is the whole classification:
    the printed sentence has no "Once during your turn", nothing to activate and
    no cost — it is a continuous drawback that reads off the board whenever the
    board is read. So it rides `passivesOf` (the §9-suppressible CATALOG scan)
    and the §8 attack gate consults it, rather than the player invoking anything.

    ⚠️ **THE COUNT IS 4 AND IT INCLUDES THE MEWTWO ITSELF.** The printed words are
    "you have 4 or more Team Rocket's Pokémon in play" — an unqualified count of
    the holder's own side, and the holder is one of them (its own name carries the
    prefix). A reading that excluded the holder would need "OTHER", which the card
    does not print; every other owner-prefix printing in the pool that means
    "other" says so. That makes the real requirement three more on the board.

    ⚠️ **AND IT COUNTS POKÉMON, SO `Team Rocket's Energy` sv10-182 DOES NOT.** The
    filter is D200's `ownerPokemon`, whose first conjunct is
    `category === "Pokemon"`, and the prefixed Special Energy is the exact card
    that conjunct was written for. */
const POWER_SAVER: CardProgram = {
  passive: {
    cantAttackUnless: {
      kind: "yourOwnerPokemonInPlayAtLeast",
      owner: "Team Rocket",
      count: 4,
    },
  },
};

/** D277 — Meloetta ex "Debut Performance": *"If you go first, this Pokémon can
    use attacks during your first turn."* `sv10.5b-044`/`-159`/`-167` — **THREE
    Standard-legal printings on ONE sentence**, and the only §4 ATTACK licence in
    the pool that is a property of the BODY rather than of one attack.

    A `passive` and NOT an `abilities` entry, for POWER_SAVER's classification
    reason verbatim: no "Once during your turn", nothing to activate, no cost —
    a continuous licence read whenever the §4 gate is read. It is POWER_SAVER's
    MIRROR IMAGE at the same gate (that Ability takes an attack away, this one
    hands one back), which is why the field sits beside it and why the read site
    is the same three payability projections.

    ⚠️ **THE CENSUS THIS ROW CAME OUT OF, AND WHAT IT DID *NOT* FIND.** The remote
    D1 `luminous` at `legal_standard = 1` on 2026-08-08, `GLOB '*during your first
    turn*'` over all THREE text columns: **ability 15 / attack 13 / effect 8 = 36
    printings on 15 names and 10 distinct first-turn CLAUSES** (15 distinct full
    column texts, one per name); the second rung (`'*your first turn*'` MINUS the
    first) returns **ZERO** — the phrase is spelled exactly one way, so rung 1 is
    the whole population and no third rung exists. 🛑 **AND NOT ONE OF THE 36 IS A
    SECOND CONSUMER OF `BoardCondition.yourFirstTurn`.** Fan Rotom's *"Once during
    your first turn"* (D275, 2 printings) is the only BARE gate in the pool; every
    other printing either LIFTS a §4 ban (this row ×3; Eevee `sv08-143` ×3,
    Karrablast / Shelmet ×4, Volbeat `sv06-009` ×1 and Exeggcute `sv08-001` ×2)
    or qualifies the phrase with a going-order clause the member cannot spell
    ("only if you go second, and only during your first turn" — Illumise
    `sv06-010`, Scream Tail ex `sv06-094` ×2, Call Bell `sv08-165`, Chill Teaser
    Toy `sv08-166`; "if you go second, you can't" — Terapagos ex `sv07-128` ×7),
    or is REMINDER text (Eevee ex `svp-174` ×3). 3+3+4+1+2+5+7+3 = **28**, plus
    Carmine ×4 and Proton ×2 already BUILT = 34, plus Fan Rotom's 2 = **36**.
    **THE MEMBER'S POPULATION IS STILL 2, AND THE PHRASE'S IS 36** — see
    effects.ts's `yourFirstTurn` doc, whose "whole population of `%during your
    first turn%` this engine can spell" claim this census corrected.

    ⚠️ **THE ROW IS THE ABILITY AND NOT THE CARD.** Meloetta ex's only attack,
    "Echoed Voice", prints *"During your next turn, this Pokémon's Echoed Voice
    attack does 80 more damage"* — a NEXT-TURN buff keyed on the ATTACK'S OWN
    NAME and stamped on one body. `InPlayPokemon` carries no per-attack-name
    damage stamp (`attackLockedTurn` / `lockedAttacks` are the two per-body attack
    stamps and both are prohibitions), so that sentence is **REFUSED AND NAMED**:
    it wants a per-body, per-attack-name, next-turn damage rider. The printed
    30 damage still resolves from the catalog with the effect skipped, which is
    what makes the licence testable without it. */
const DEBUT_PERFORMANCE: CardProgram = {
  passive: { attackFirstTurnExempt: true },
};

/** D278 — Eevee "Boosted Evolution": *"As long as this Pokémon is in the Active
    Spot, it can evolve during your first turn or the turn you play it."*
    `sv08-143`/`sv08.5-074`/`svp-173` — **THREE Standard-legal printings on ONE
    byte-identical `abilities_json`**, and the §4 EVOLVE licence to D277's §4
    ATTACK licence.

    THE CENSUS, RE-QUERIED RATHER THAN CARRIED (remote D1 `luminous`
    `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, `legal_standard = 1`, 2026-08-08) —
    the ladder is transcribed rung by rung in `boostedEvolution.test.ts`'s
    header. The short form: the phrase `%evolve during your first turn%` over all
    three text columns returns **10 printings on 4 names**, which split
    **3 Eevee (this row) + 2 Karrablast + 2 Shelmet (partner-gated, REFUSED) +
    3 Eevee ex (REMINDER text, nothing to build)** — 3+2+2+3 = 10, an
    enumeration that adds up. `%the turn you play it%` returns the SAME 10, so
    the second half of the sentence is spelled exactly one way in this pool.

    🛑 **THE ROW IS THE ABILITY AND NOT THE CARD.** Eevee's attack "Reckless
    Charge" (*"This Pokémon also does 10 damage to itself."*) is unrelated and
    already derivable; nothing here touches it.

    ⚠️ **THE LICENCE REACHES `rareCandy` TOO, AND THAT IS DELIBERATE THOUGH
    UNREACHABLE.** Rare Candy (§7.1) carries the identical pair of bans, and
    *"it can evolve"* does not distinguish how. It cannot fire on these bodies
    today — **the pool contains ZERO Standard-legal Stage 2 whose `evolveFrom`
    names any Stage 1 that evolves from Eevee, Karrablast or Shelmet** (measured,
    not assumed: the nested `evolve_from` join returns an empty set) — so the
    licence is wired there so the invariant is a property of the ENGINE rather
    than of what the registry happens to contain, which is `recoverStatuses`'
    standing precedent on a Tool (cardplay.ts). */
const BOOSTED_EVOLUTION: CardProgram = {
  passive: { evolveEarlyExempt: { activeOnly: true } },
};

/** D279 — Karrablast/Shelmet "Stimulated Evolution": *"If you have Shelmet in
    play, this Pokémon can evolve during your first turn or the turn you play
    it."* `sv10.5b-009`/`-094` (Karrablast, naming Shelmet) and `sv10.5w-008`/
    `-093` (Shelmet, naming Karrablast) — **FOUR Standard-legal printings on TWO
    sentences**, `BOOSTED_EVOLUTION`'s licence under a partner gate instead of a
    zone gate.

    🛑 **TWO OBJECTS, NOT ONE, AND THE CENSUS IS WHY.** The reprint idiom shares
    ONE `CardProgram` across printings whose `abilities_json` the catalog proves
    byte-identical (Eevee's three do). These four do NOT: the two Karrablast rows
    are byte-identical to each other and the two Shelmet rows to each other, but
    the pairs name different partners. Sharing one object across all four would
    hand Shelmet Karrablast's gate, which reads TRUE off the holder itself and
    would make the licence unconditional — the exact failure the split prevents.

    ⚠️ **NO `activeOnly`, AND ITS ABSENCE IS THE LOAD-BEARING PART.** Neither
    sentence prints an Active-Spot clause, so the licence holds on the Bench too.
    Copying `BOOSTED_EVOLUTION`'s key here would be silent: a benched Karrablast
    would be refused an evolution the card allows, and no assertion written on an
    Active body could ever see it. `stimulatedEvolution.test.ts` drives the
    benched board, and a mutant re-adds the key to prove the board can see it.

    ⚠️ **THE PARTNER IS READ OFF THE STACK TOP AND IS THEREFORE LIVE.** Evolving
    your Shelmet into Accelgor ends your Karrablast's licence mid-turn (§1.2), and
    that is the printed answer: "in play" names a Pokémon, and a Pokémon's name is
    its top card's.

    ⚠️ **THE GATE IS NOT SELF-SATISFYING AND THE CATALOG SAYS SO.** A Karrablast
    checks for *Shelmet*, never for another Karrablast — so a lone licensed body
    is NOT licensed, which is a real board and is asserted. The reflexive shape
    ("another copy of me") is `yourBenchHasNamed`'s hazard, not this one's. */
const STIMULATED_EVOLUTION_KARRABLAST: CardProgram = {
  passive: { evolveEarlyExempt: { ifInPlay: "Shelmet" } },
};

/** Stimulated Evolution's other half — Shelmet `sv10.5w-008`/`-093`, gating on
    Karrablast. See `STIMULATED_EVOLUTION_KARRABLAST` above for why this is a
    second object rather than a shared one. */
const STIMULATED_EVOLUTION_SHELMET: CardProgram = {
  passive: { evolveEarlyExempt: { ifInPlay: "Karrablast" } },
};

/** D242 — Bloodmoon Ursaluna ex "Seasoned Skill": *"Blood Moon used by this
    Pokémon costs {C} less for each Prize card your opponent has taken."*
    `svp-177`/`sv06-141`/`-202`/`-216`/`-222`/`sv08.5-168` — **SIX Standard-legal
    printings**, and backlog row 14's second third.

    ✅ **ZERO ENGINE CODE, AND THAT CLAIM WAS CHECKED RATHER THAN BELIEVED.** The
    field is D218's `attackCostDiscountPerOpponentPrize`, written for Radiant
    Charizard `swsh10.5-011` "Excited Heart" — *"This Pokémon's attacks cost
    {C} less for each Prize card your opponent has taken"* — a PER-UNIT rate the
    cost seam multiplies by `takenPrizes(state, opponentSeat)`. Same rate, same
    count source, same sign, same read site.

    🛑 **BUT THE TWO SENTENCES ARE NOT THE SAME SENTENCE, AND THE DIFFERENCE IS
    RECORDED HERE RATHER THAN GLOSSED (D242, a FLAGGED ASSUMPTION).** Radiant
    Charizard says *"this Pokémon's attacks"* — every attack it has. Bloodmoon
    Ursaluna names ONE: *"**Blood Moon** used by this Pokémon"*. The field is
    UNSCOPED, so it discounts every attack on the holder, and the two readings
    coincide only while the holder has exactly one attack.

    ✅ **THEY COINCIDE ON ALL SIX PRINTINGS, MEASURED.** Every one of the six rows
    has `json_array_length(attacks_json) = 1` and that attack is named *Blood
    Moon* (remote D1 `luminous`, 2026-08-06 — the query is in
    `abilityAttackGate.test.ts`'s header). So the unscoped field is EXACT on the
    whole legal pool of this sentence, today.

    ⚠️ **THE OTHER READING IS PINNED RATHER THAN ARGUED**: `abilityAttackGate.test.ts`
    drives a FIXTURE with a SECOND attack and asserts the discount reaches it, so
    the day a two-attack printing of this sentence is ingested the control fails
    loudly and the field earns an `attack?: string` scope. A `{ amount, attack }`
    retype today would be an unread field on every printing in the pool (D135). */
const SEASONED_SKILL: CardProgram = {
  passive: { attackCostDiscountPerOpponentPrize: 1 },
};

/** 🆕 **D327 — "Food Prep"**: *"Attacks used by this Pokémon cost {C} less for
    each Kofu card in your discard pile."* — `svp-134`, `sv07-042`, `sv07-045`,
    `sv07-149`, **FOUR Standard-legal printings on ONE byte-identical
    `abilities_json`** (remote D1 `luminous`, re-queried 2026-08-11, all four
    `legal_standard = 1`, `category = 'Pokemon'`, `types_json = ["Water"]`), and
    the `DROPPED` row `legalNonAttackPrograms.test.ts` has asserted UNBUILT since
    D162.

    🛑 **FOUR PRINTINGS, *TWO* CARD NAMES — WHICH IS WHY THE CENSUS GROUPS BY
    SENTENCE AND NOT BY CARD.** Three are **Crabominable** (Stage 1 off
    Crabrawler, 160 HP, one attack "Haymaker"); `sv07-045` is **Veluza**, a
    **BASIC** with 130 HP and a different attack ("Sonic Edge"). A reader that
    assumed a reprint group is one card would have keyed three ids and called the
    row done, and the byte-identical `abilities_json` is the only thing that says
    otherwise. The shared object is shared because the SENTENCE is identical, not
    because the cards are.

    ✅ **THE UNSCOPED FIELD IS EXACT HERE RATHER THAN MERELY CONVENIENT, AND THE
    CONTRAST WITH `SEASONED_SKILL` ABOVE IS THE POINT.** That row's sentence names
    ONE attack (*"**Blood Moon** used by this Pokémon costs…"*) and rests on a
    flagged assumption — every printing happens to have exactly one attack. This
    sentence's subject is *"**Attacks** used by this Pokémon"*, PLURAL and
    unqualified, so the field's own scope IS the printed scope and there is no
    assumption to flag. (Both here have one attack apiece anyway —
    `json_array_length(attacks_json) = 1` on all four — but that fact is not load
    bearing for this row, and that is the whole difference.)

    ⚠️ **`amount: 1` IS THE PER-UNIT RATE, NOT A TOTAL.** The print is "for each",
    so one Kofu in the pile is one {C} off and four Kofu are four; the read site
    (continuous.ts `selfAttackCostDiscount`) does the multiplication. Veluza's
    printed {C}{C}{C}{C} therefore becomes FREE at four Kofu, which is a real board
    — Kofu has two Standard ids and a deck may hold four of the name. */
const FOOD_PREP: CardProgram = {
  passive: { attackCostDiscountPerNamedInDiscard: { name: "Kofu", amount: 1 } },
};

/** 🆕 **D327 — Incineroar ex `sv05-034`/`sv05-187` "Hustle Play"**: *"Attacks
    used by this Pokémon cost {C} less for each of your opponent's Benched
    Pokémon."* — **TWO Standard-legal printings on one byte-identical
    `abilities_json`** (remote D1 `luminous`, 2026-08-11).

    🛑 **THIS ROW WAS INVISIBLE TO EVERY BACKLOG THIS REPO KEEPS, AND ONLY THE
    ORTHOGONAL-WIDTH PROBE FOUND IT.** It is in no `DROPPED` row, no `needs`
    string and no session log; `git grep sv05-034 -- packages/` returned NOTHING
    AT ALL, the one grep result that is unambiguous in a way a non-zero count
    never is. What surfaced it was widening the Food Prep census to the SHORTER
    noun `%less for each%` (12 legal) and NAMING the difference set instead of
    counting it: 6 Bloodmoon Ursaluna ex (built D242), 4 Food Prep, **2 of these**.

    ✅ **ZERO NEW READ SITE.** It is the third summand at `selfAttackCostDiscount`,
    beside the Prize count and the discard count, and it needed a field only
    because its count source is a third one. The §9 gate, the seat derivation, the
    top-card-only rule and the no-floor argument are all inherited from that scan
    unchanged — and the §9 positive is REAL here for the same reason it is for
    Radiant Charizard, except stronger: Incineroar ex is a **Stage 2**, so an
    Active Klefki `sv01-096` "Mischievous Lock" (Basic-only) does NOT silence it,
    which is the first NEGATIVE control this seam has had. D113's rule cuts both
    ways and this row is the other way. */
const HUSTLE_PLAY: CardProgram = {
  passive: { attackCostDiscountPerOpponentBenched: 1 },
};

/** 🆕 **D330 — Florges `sv06-088` "Captivating Invitation"**: *"Once during your
    turn, you may flip a coin. If heads, switch in 1 of your opponent's Benched
    Pokémon to the Active Spot, and the new Active Pokémon is now Confused."* —
    **ONE Standard-legal printing, and it is the whole population**:
    `instr(abilities_json,'Captivating Invitation') > 0` returns exactly this row
    over all 3,786 (remote D1 `luminous`, 2026-08-13).

    ✅ **ZERO NEW ENGINE FIELDS — every member of the program shipped, and this is
    the row `legalNonAttackPrograms.test.ts` named as the cheapest on the page.**
    It is Pokémon Catcher's `coinFlipGate{ then: [gust] }` with `SCALDING_STEAM`'s
    `applyStatus` appended INSIDE the gate, lifted onto the Ability surface.

    🛑 **THE `defender` ARM IS THE LOAD-BEARING READ AND IT IS NOT ATTACK-BOUND.**
    interpreter.ts's §9.2 note-builder says *"the `defender` arm belongs to an
    ATTACK program"*; that is true of the NOTE and false of the OP. `applyStatus`
    resolves `op.target === "self" ? ctx.seat : otherSeat(ctx.seat)` and then reads
    `state.players[seat].active` **at op time** — so running it AFTER the `gust` in
    the same program lands the Confusion on the body the gust just promoted, which
    is the printed *"the new Active Pokémon"* with no `recordAs` and no §9.2 gate.
    D320's Lava Zone reaches the same printed noun from a Stadium, and
    `SCALDING_STEAM` already drives this arm from an ACTIVATED Ability.

    🛑 **AND THE EMPTY-BENCH BOARD — THE ONE THAT WOULD CONFUSE THE WRONG BODY —
    COSTS NOTHING TO CLOSE, BECAUSE THE GATE IS ALREADY SHARED.** With no opponent
    Bench the `gust` is a no-op and a bare `applyStatus` would then fire on the
    Active that was ALREADY there — a wrong card. `programPlayable` (cardplay.ts)
    descends into `coinFlipGate.then` and refuses a `gust` whose opponent Bench is
    empty, and an activated Ability is put through that same call, so the Ability
    is simply not usable on that board and the wrong-body arm is unreachable.
    Both halves are pinned in `captivatingInvitation.test.ts`.

    `activeOnly: false` — the printed text carries NO *"if this Pokémon is in the
    Active Spot"* clause, unlike `SCALDING_STEAM` and `ATTRACT_CUSTOMERS` directly
    above it, so Florges may do this from the Bench and the flag is written out
    rather than omitted because `AbilityProgram` requires it. `oncePerTurn` is the
    printed *"Once during your turn"*, and the *"you may"* is the activation
    itself. **A Benched Florges gusting is a real board and is pinned**, because
    the two neighbours this program was assembled from are both Active-only and a
    copied `true` would be invisible to every other assertion. */
const CAPTIVATING_INVITATION: CardProgram = {
  abilities: [
    {
      name: "Captivating Invitation",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "coinFlipGate",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [{ op: "gust" }, { op: "applyStatus", target: "defender", status: "confused" }],
        },
      ],
    },
  ],
};

/** 🆕 **D331 — Lisia's Appeal `sv08-179`/`sv08-234`/`sv08-246`** (Supporter):
    *"Switch in 1 of your opponent's Benched **Basic** Pokémon to the Active Spot.
    If you do, the new Active Pokémon is now Confused."* — **THREE Standard-legal
    printings on one byte-identical `effect`, and they are the whole population**:
    `instr(effect,'Benched Basic Pok') > 0` returns exactly these 3 rows of 3,786,
    all `legal_standard = 1` (remote D1 `luminous`, 2026-08-13).

    ✅ **FLORGES' PROGRAM WITH THE COIN GATE TAKEN OFF AND ONE ADJECTIVE PUT ON.**
    `CAPTIVATING_INVITATION` (D330) is `coinFlipGate` over
    `[gust, applyStatus defender confused]` on the Ability surface; this is the
    same two ops, ungated, on the TRAINER surface — the printed difference exactly.
    Everything D330 argued for that pair carries over unchanged: `applyStatus`
    reads `otherSeat(ctx.seat).active` at OP TIME, so AFTER the gust it IS the
    printed *"the new Active Pokémon"*, and no `recordAs`/`recordGate` is needed to
    name it. The *"If you do"* is discharged by `programPlayable`.

    🛑 **THE ONE THING THAT WAS *NOT* FREE, AGAINST A HANDOFF THAT SAID IT WAS.**
    The row was priced as *"ONE Basic rider on `gust`'s candidate scan, shared with
    `programPlayable`'s empty-Bench refusal, so the whiff arm follows for free"*.
    The rider is real; the sharing was not. That refusal read a raw bench LENGTH
    and could not see a rider, so this card would have been playable into an
    opponent Bench of pure Evolutions. The slice therefore buys **two** pieces —
    `gust.basicOnly` and the `gustTargets` funnel both readers now ask
    (interpreter.ts, cardplay.ts). See `lisiasAppeal.test.ts`.

    ⚠️ **THE `basicOnly: true` HERE IS `gust.basicOnly`'s ONLY REGISTRY CONSUMER,
    AND THAT IS CHECKED RATHER THAN ASSUMED** — D330's `{kind:"trainerCard"}` was
    a fully wired union member with ZERO consumers, green on every line and dead to
    every printed card. These three keys are what keep this field from being that. */
const LISIAS_APPEAL: CardProgram = {
  trainer: [
    { op: "gust", basicOnly: true },
    { op: "applyStatus", target: "defender", status: "confused" },
  ],
};

/** 🆕 **D332 — Drayton `sv08-174`/`sv08-232`/`sv08-244`/`sv08.5-172`** (Supporter):
    *"Look at the top 7 cards of your deck. You may reveal a Pokémon and a Trainer
    card you find there and put them into your hand. Shuffle the other cards back
    into your deck."* — **FOUR Standard-legal printings on one byte-identical
    `effect`, and they are the whole population**: `instr(effect,'a Pokémon and a
    Trainer card') > 0` returns exactly these 4 rows of 3,786, all
    `legal_standard = 1`; the same literal over `attacks_json` and
    `abilities_json` returns 0, and so does the reversed word order *"a Trainer
    card and a Pokémon"* over all three columns (remote D1 `luminous`,
    2026-08-14).

    ✅ **GREAT BALL'S PROGRAM WITH A SECOND NOUN ON IT.** `GREAT_BALL` is
    `lookAtTopN{n 7, anyPokemon, max 1, reveal}` + `shuffleDeck`; this is the same
    two ops with `also: { filter: trainerCard, max: 1 }`. The trailing shuffle is
    the printed *"Shuffle the other cards back into your deck"* and sits AFTER the
    look rather than inside it — the Nest Ball search-then-shuffle pattern this op
    has followed since D131, and the reason a whiff still shuffles.

    🛑 **THE `DROPPED` ROW PRICED THIS AT "ONE OP FIELD OR A SECOND `max`" AND THE
    SECOND HALF WAS THE FALSE ONE.** A second `max` on the op is forwarded to
    `prompt.max`, and `validateChoice` enforces one FLAT total — so under a cap of
    2 a client takes TWO Pokémon and the printed *"and"* is gone. The cap had to
    reach the PROMPT (`chooseCards.caps`), which is shared by six producers and has
    a wire tail; the candidate SET, which the row treated as the obstacle, was free
    from `anyOf` all along. **The row named the right op and the wrong piece of
    it.**

    ⚠️ **`{ kind: "trainerCard" }` GETS ITS SECOND REGISTRY CONSUMER HERE**, after
    D330 gave it its first. It is the member that spent this whole run wired at
    every site and dead to every printed card, and a filter with two consumers on
    two different ops is no longer one field away from being deleted by mistake.
    ⚠️ **AND `also` IS `also`'s ONLY REGISTRY CONSUMER, CHECKED RATHER THAN
    ASSUMED** — these four keys plus the `fix-drayton` demonstrator are what keep
    D330's green-and-dead shape from repeating one op over. See
    `draytonWindow.test.ts`. */
const DRAYTON: CardProgram = {
  trainer: [
    {
      op: "lookAtTopN",
      n: 7,
      filter: { kind: "anyPokemon" },
      max: 1,
      also: { filter: { kind: "trainerCard" }, max: 1 },
      reveal: true,
    },
    { op: "shuffleDeck" },
  ],
};

/** 🆕 **D333 — Roto-Stick `sv08.5-127`**: *"Look at the top 4 cards of your deck.
    You may reveal **any number of** Supporter cards you find there and put them
    into your hand. Shuffle the other cards back into your deck."* (Item)

    **ONE Standard-legal printing, and the SENTENCE has three** —
    `instr(effect,'reveal any number of') > 0` returns exactly 3 rows of 3,786
    (remote D1 `luminous`, 2026-08-14): this one and Bill's Transfer
    `sv03.5-156`/`-194`, which print the identical clause over *"Pokémon"* at a
    top-8 window and are **`legal_standard = 0`**. The same literal over
    `attacks_json` and `abilities_json` returns 0 rows. So the row is 1 legal of a
    3-printing family, and the two that are out of Standard are exactly what the
    `"any"` member will serve for free the day they rotate back.

    ✅ **POKÉGEAR'S PROGRAM WITH THE CAP TAKEN OFF.** `POKEGEAR` is
    `lookAtTopN{n 7, supporter, max 1, reveal}` + `shuffleDeck`; this is the same
    two ops at `n: 4` with `max: "any"`. The trailing shuffle is the printed
    *"Shuffle the other cards back into your deck"* and sits AFTER the look, the
    Nest Ball pattern this op has followed since D131.

    🛑 **THE RESUME POINT PRICED THE RESOLUTION AND THE RESOLUTION WAS NEARLY
    FREE.** It read: *"`prompt.max` … is a `number` on the wire, so the park must
    resolve it to a concrete cap the way `attachFromTopOffer` does. **That
    resolution is the whole row, and it is where the cost is.**"* Grepping every
    reader of this op's `max` returns THREE sites, all inside one `case` block,
    and the clamp has three precedents in the same file (`attachFromTopOffer`,
    `moveCap` — whose doc already says the clamp is what keeps `prompt.max` a
    number — and `attachNote`, which spells the string *"any number of"*
    verbatim). What the price never mentioned is the half that actually cost:
    **D241 had already spelled this printed phrase as `max: n`, under a test named
    *"'any number of' is the WINDOW, not a new union member"***. So the row is not
    a missing resolution; it is a **REVERSAL of a pinned decision**, and the thing
    that forces it is the CAPTION — `lookNote` printed *"up to 4"* over a sentence
    carrying no number, which is precisely what D244 refused for `moveEnergy`.
    D241's arm is re-pointed in the same commit, so one op has one spelling.

    ⚠️ **`max: "any"` IS NOT `max: 4`, AND THE BOARD THAT TELLS THEM APART IS A
    WINDOW WITH FEWER SUPPORTERS THAN CARDS.** As a PREDICATE they agree — the
    candidate set is a subset of the top 4 either way — so every filter assertion
    passes on both. They differ in the two places the player can see: the parked
    `max` (4 versus the number of Supporters up there) and the note. `rotoStick.
    test.ts` drives both, and Pokégear is on the same board as the attribution
    control. 1 legal printing. */
const ROTO_STICK: CardProgram = {
  trainer: [
    { op: "lookAtTopN", n: 4, filter: { kind: "supporter" }, max: "any", reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** 🆕 **D333 — Bug Catching Set `sv06-143`/`sv08.5-102`**: *"Look at the top 7
    cards of your deck. You may reveal **up to 2 in any combination of {G} Pokémon
    and Basic {G} Energy cards** you find there and put them into your hand.
    Shuffle the other cards back into your deck."* (Item)

    **TWO Standard-legal printings on one byte-identical `effect`, and they are
    the whole population of the sentence** (remote D1 `luminous`, 2026-08-14).

    ✅ **ZERO NEW ENGINE CODE — NOT ONE LINE.** `lookAtTopN`, `anyOf`,
    `typedPokemon` and `basicEnergy` all predate this row, and the printed *"up to
    2 in any combination of"* is a FLAT cap over a UNION, which is what the op's
    plain `max` has always meant. **It deliberately does NOT use D332's `also`**:
    `also` is a SECOND cap for a second noun (Drayton takes one of each), where
    this sentence takes two of EITHER in any mixture, so `also` here would refuse
    the two-Grass-Pokémon answer the card explicitly permits. **The two fields
    read almost identically off the print and mean opposite things about the
    answer** — "a Pokémon and a Trainer card" versus "2 in any combination".

    🛑 **AND THE PRICE SAID THIS WOULD BE `anyOf`'s FIRST LIVE PROMPT CONSUMER.
    IT IS THE SECOND.** `LANAS_AID` (D264) is `discardPileRetrieval` over
    `anyOf[anyPokemon.noRuleBox, basicEnergy]` and parks a `chooseCards` whose
    note is `retrieveNoun`'s `anyOf` arm — asserted byte for byte in
    `legalNonAttackPrograms.test.ts`. Lana's Aid ALSO prints *"in any combination
    of … **and** …"* and ALSO captions *" or "*, so the joiner disagreement the
    work order expected to cost prose here **was settled two years of decisions
    ago and is the established reading**: a union asked about ONE card is a
    disjunction. What was actually owed was a COMMENT repair — `retrieveNoun`'s
    arm still claimed to be unreachable, D264 never moved the sentence, and D332
    quoted the dead claim forward into two more files. **A STALE COMMENT
    PROPAGATES FURTHER THAN A STALE NUMBER, BECAUSE NOTHING CAN GO RED ON IT.**

    ⚠️ **`typedPokemon` WITHOUT A `stage`, AND `basicEnergy` WITH AN `energyType`.**
    The print says *"{G} Pokémon"* (any stage — so `fix-grass-stage1` must be
    admitted, which is the case that separates this from `stage: "basic"`) and
    *"**Basic** {G} Energy cards"* (so a Special Energy must be refused, and so
    must a Basic Energy of another type). Four refusals, four printed words, and
    `bugCatchingSet.test.ts` drives each one against a card that differs from an
    admitted one in exactly that word. 2 legal printings on 1 sentence. */
const BUG_CATCHING_SET: CardProgram = {
  trainer: [
    {
      op: "lookAtTopN",
      n: 7,
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Grass" },
          { kind: "basicEnergy", energyType: "Grass" },
        ],
      },
      max: 2,
      reveal: true,
    },
    { op: "shuffleDeck" },
  ],
};

/** 🆕 **D334 — Explorer's Guidance `sv05-147`/`sv05-200`/`sv08.5-107`**: *"Look at
    the top 6 cards of your deck and put 2 of them into your hand. **Discard the
    other cards.**"* (Supporter)

    **THREE Standard-legal printings on one byte-identical 95-char `effect`, and
    they are the whole population of the sentence** — `instr(effect,'Discard the
    other cards') > 0` returns 4 rows of 3,786 and the fourth is Hydreigon "Tri
    Howl" on `abilities_json`, out of Standard and BUILT since M5 on
    `attachFromTop.restTo` (🆕 D352 — was `discardRest`); `attacks_json` returns 0 for the clause, as does
    *"Discard the rest"* over `effect` (remote D1 `luminous`, 2026-08-14). **So this
    row closes the printed population of "Discard the other cards" outright.**

    ✅ **GREAT BALL'S PROGRAM WITH THE "up to" TAKEN OFF AND THE SHUFFLE TRADED FOR
    A DISCARD.** `GREAT_BALL` is `lookAtTopN{n 7, anyPokemon, max 1, reveal}` +
    `shuffleDeck`; this is one op at `n: 6` with `anyCard`, `max: 2`, `exact` and
    `restTo: "discard"` (D334 spelled that value `discardRest: true`; D335 widened the
    key), and **NO trailing `shuffleDeck` — the absence is printed, not
    forgotten.** Every other row on this op ends *"Shuffle the other cards back into
    your deck"*, which is a trailing op precisely because those cards never left the
    deck. Here they leave it, so there is nothing on top to scramble and the
    sentence spells no shuffle. `attachFromTop`'s doc has made this same asymmetry
    argument for the same two clauses since M5.

    🛑 **NO FILTER, WHICH IS THE PRINT AND NOT A SHORTCUT.** The sentence names no
    noun at all — *"put 2 of **them**"* — so `anyCard` is the member, the same one
    D241's *"You may discard that card"* arm reads for the same reason: an
    uncategorised "them" admits the whole window.

    🛑 **THE `exact` IS THE PRINTED SENTENCE AND `chooseCards.min` IS ONLY HALF OF
    IT.** The work order priced the mandatory take as *"a way for the OP to say it,
    not a wire field"*, because `chooseCards.min` is required and already has
    non-zero producers. True — and it misses that `lookNote` reads the SAME number
    and captions `max > 1` as *"up to 2 cards"*, which is precisely the defect D333
    repaired one field over on `"any"`. **A FIELD THAT FEEDS BOTH A PREDICATE AND A
    STRING OWES BOTH ARMS**, so this row cost a validator value, a caption arm AND
    the first floor on this prompt that a short zone can make unanswerable.

    ⚠️ **AND THE ARM REACHES FURTHER THAN THE ROW.** `instr(effect,'of them into
    your hand') > 0` returns 12 rows / 9 legal and `instr(abilities_json, …)` 2
    rows / 2 legal (remote D1, 2026-08-14); stripping the *"up to"* prints
    (Hassel ×2) and the `searchDeck` sentence (Crispin ×4) leaves the mandatory
    family: these 3, Drakloak *"Recon Directive"* `sv06-129`/`sv08.5-072` (2 legal,
    leftovers to the deck BOTTOM) and Rika `sv04-172`/`-241`/`-258` (3 printings,
    out of Standard, leftovers shuffled to the bottom). **8 printings / 5 legal for
    the `exact` arm against 3 for this row** — D187's rule that an arm crosses sets
    and a registry row does not. The other two families are blocked on a leftovers
    DESTINATION this op has no field for, never on the take.
    ✅ **D335 BUILT BOTH OF THEM** on `restTo`, so `exact` now has its whole measured
    population: 8 printings / 5 legal across three registry rows, and this one is the
    3. The prediction that the blocker was the destination and not the take held. */
const EXPLORERS_GUIDANCE: CardProgram = {
  trainer: [
    {
      op: "lookAtTopN",
      n: 6,
      filter: { kind: "anyCard" },
      max: 2,
      exact: true,
      // 🆕 D335 — was `discardRest: true`; the boolean became the three-valued
      // `restTo` when the family's other two printed destinations arrived, and this
      // spelling is the SAME value D334 shipped rather than a new reading.
      restTo: "discard",
    },
  ],
};

/** 🆕🆕 **D335 — Drakloak `sv06-129`/`sv08.5-072` "Recon Directive"**: *"Once during
    your turn, you may look at the top 2 cards of your deck and put 1 of them into
    your hand. **Put the other card on the bottom of your deck.**"* (Ability, Stage 1
    over Dreepy) — **TWO Standard-legal printings on one byte-identical 205-char
    `abilities_json`**, and `instr(abilities_json,'the other card on the bottom') > 0`
    returns exactly 3 rows of 3,786: these two and Gothitelle `sv02-092` (remote D1
    `luminous`, 2026-08-14).

    ✅ **EXPLORER'S GUIDANCE'S PROGRAM WITH THE WINDOW NARROWED AND THE LEFTOVERS
    SENT SOMEWHERE ELSE.** `lookAtTopN{n 6, anyCard, max 2, exact, restTo:"discard"}`
    becomes `{n 2, anyCard, max 1, exact, restTo:"bottom"}`, and **NO trailing
    `shuffleDeck` — the absence is printed on this card too**, for a different reason
    than D334's: Explorer's Guidance has nothing left on top to scramble, and this
    card has put the one leftover somewhere a shuffle would undo.

    🛑 **THE PRINTED *"you may"* IS THE ABILITY'S OWN DECLINE, AND THE TAKE INSIDE IT
    IS STILL MANDATORY.** That is the `exact` + optional interaction nothing in the
    suite had exercised: a player may leave Recon Directive unused all turn, but a
    player who uses it does not get to look at two cards and take neither.
    `oncePerTurn: true` is the printed first clause; `activeOnly: false` because no
    clause says "in the Active Spot".

    🛑 **AND IT IS THE FIRST `exact` ROW WHERE THE FLAG IS INVISIBLE IN THE CAPTION.**
    `lookNote`'s exactness arm only strips the words *"up to"*, which appear solely
    when `max > 1`; at `max: 1` the caption is the SINGULAR *"put a card into your
    hand"* either way, so the whole observable difference between `exact` and its
    absence on this row is `prompt.min` — 1 against 0. D334's row could not tell
    those two consumers apart because its `max` was 2 and both moved together.

    ⚠️ **NO `reveal`** — the sentence never prints the word, which is D225's
    correlation showing through once more: it takes uncategorised *"them"*, and there
    is nothing for an opponent to verify. */
const DRAKLOAK: CardProgram = {
  abilities: [
    {
      name: "Recon Directive",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "lookAtTopN",
          n: 2,
          filter: { kind: "anyCard" },
          max: 1,
          exact: true,
          restTo: "bottom",
        },
      ],
    },
  ],
};

/** 🆕🆕 **D335 — Rika `sv04-172`/`sv04-241`/`sv04-258`**: *"Look at the top 4 cards
    of your deck and put 2 of them into your hand. **Shuffle the other cards and put
    them on the bottom of your deck.**"* (Supporter) — **THREE printings on one
    byte-identical 135-char `effect`, and all three are `legal_standard = 0`**
    (remote D1 `luminous`, 2026-08-14).

    ⚠️ **OUT OF STANDARD, AND THAT IS WHY IT IS IN NO COLUMN OF `censusAtHead` AND NO
    ROW OF `LANDED`** — the Hydreigon "Tri Howl" precedent exactly (`sv02-140` has
    carried this op's leftovers key since M5 — `discardRest` until D352 renamed it to
    `restTo` — and sits only in `CENSUS_NOT_LEGAL`).
    It is authored anyway because it is the ONLY printing in the catalog that reaches
    `restTo: "shuffledBottom"` on THIS op, and a union value no card reaches is the
    thing D331 forbids. ⚠️ **THE VALUE ITSELF IS NOT OUT OF STANDARD**: Metang
    *"Metal Maker"* `sv05-114`/`svp-090` prints the identical clause with **2 legal
    printings**, one op over on `attachFromTop` — see that op's doc block.

    🛑 **THE SHUFFLE IS A SECOND PRINTED DECISION ABOUT THE SAME CARDS, WHICH IS WHY
    THE AXIS COULD NOT BE A BOOLEAN.** Drakloak's leftover keeps the window's order;
    Rika's is randomized first. Those are different games — a player who saw a Boss's
    Orders go under the deck knows exactly where it is in the first case and not in
    the second — so `"bottom"` and `"shuffledBottom"` are two values and not one.

    ✅ **ZERO NEW ENGINE CODE BEYOND THE VALUE.** It is Explorer's Guidance's program
    at `n: 4` / `max: 2` with the third `restTo`, and like it there is **no trailing
    `shuffleDeck`**: the print's own shuffle reaches the WINDOW and not the deck. */
const RIKA: CardProgram = {
  trainer: [
    {
      op: "lookAtTopN",
      n: 4,
      filter: { kind: "anyCard" },
      max: 2,
      exact: true,
      restTo: "shuffledBottom",
    },
  ],
};

/** 🆕 **D330 — Team Rocket's Petrel `sv10-176`/`sv10-226`**: *"Search your deck
    for a Trainer card, reveal it, and put it into your hand. Then, shuffle your
    deck."* (Supporter) — **TWO Standard-legal printings on one byte-identical
    `effect`** (remote D1 `luminous`, 2026-08-13).

    🛑 **THIS ROW WAS RECORDED AS BLOCKED AND THE THING BLOCKING IT HAD SHIPPED.**
    `legalNonAttackPrograms.test.ts`'s `lookAtTopN` `DROPPED` row prices itself at
    *"a `trainer` `CardFilter` kind — `supporter` and `toolCard` exist, the
    supertype does not (**which alone drops Team Rocket's Petrel, 2 legal**)"*.
    `{ kind: "trainerCard" }` is a full member of the union (effects.ts) and is
    wired at all three sites it needs — `matchesFilter` (cards.ts), `retrieveNoun`
    and `HAND_SEARCH_NOUNS` — with, until this row, **ZERO registry consumers**:
    a filter member that was GREEN AND DEAD. The parenthetical was false, and
    nothing could go red to say so, because the ids it names are in no `ids` array
    on the page. **THE ASSERTION GUARDS THE ROW'S ids AND NOT ITS PROSE.**

    ✅ **ZERO NEW ENGINE FIELDS.** It is `POKE_BALL`'s program with the filter
    swapped and the coin gate dropped — the search AND the shuffle are both
    unconditional here, so `shuffleDeck` sits AFTER the search rather than inside a
    gate. `reveal: true` is the printed *"reveal it"*; `max: 1` is the printed
    singular *"a Trainer card"*; `dest` is absent, which is D135's spelling of the
    hand. NOT gated by `programPlayable`, on `POKE_BALL`'s reason exactly: a deck
    search reads a zone the gate never looks in, so an all-whiff deck is a silent
    no-op and not a refusal. */
const TRAINER_SEARCH: CardProgram = {
  trainer: [
    { op: "searchDeck", filter: { kind: "trainerCard" }, dest: "hand", max: 1, reveal: true },
    { op: "shuffleDeck" },
  ],
};

/** card id → program. Reprints of the same card (identical text) map to the
    same program object; keyed by id per D8, so an unauthored reprint id simply
    falls through to the loud "not simulated" path until its id is added. */
/** 🆕 **D310 — Pidove (sv05-133) "Emergency Evolution"**: *"Once during your turn,
    if this Pokémon's remaining HP is 30 or less, you may search your deck for an
    Unfezant or Unfezant ex and put it onto this Pidove to evolve it. Then, shuffle
    your deck."* **ONE legal printing, the whole population** — the sentence has no
    reprint and the remaining-HP clause has no sibling anywhere in the catalog.

    🛑 **THE PRINTED PAIR IS NOT A NARROWING OF THE EVOLUTION CHAIN — IT REPLACES
    IT, AND THAT IS THE WHOLE POINT OF THE ROW.** `evolveFromDeck`'s standing
    candidate predicate is §10's chain match asked of the deck; for a Pidove body
    it selects **Tranquill**. The named card is **Unfezant**, a **Stage 2** whose
    `evolve_from` is **Tranquill** — so this sentence licenses a SKIPPED STAGE, Rare
    Candy's shape printed on an Ability, and a `names` filter conjoined with the
    chain would select nothing on any board ever built. The op's doc block in
    `effects.ts` carries the argument in full.

    ⚠️ **"Unfezant ex" HAS ZERO PRINTINGS IN THE CATALOG** (four `Unfezant`, no
    `Unfezant ex`, over all 3,786 rows). It is authored anyway: a registry row is an
    EXACT MAP of the print (D190b), the unreachable name costs nothing, and the
    array is a claim about the CARD rather than about the catalog.

    ⚠️ **THE `you may` IS THE PARK's `min: 0`, NOT AN `optional` OP.**
    `evolveFromDeck` already parks at `min: 0` on every printing — declining is a
    legal answer and the trailing `shuffleDeck` fires on the decline and on the
    whiff alike — so wrapping it would be a second way to say one thing.

    ⚠️ **AND `activeOnly` IS FALSE**: the printed clause is about this Pokémon's HP
    and says nothing about where it stands, so a damaged benched Pidove evolves
    itself. That is the shape of the card — it is a Basic taking 30 damage on the
    Bench and answering with a Stage 2. */
const EMERGENCY_EVOLUTION: CardProgram = {
  abilities: [
    {
      name: "Emergency Evolution",
      oncePerTurn: true,
      activeOnly: false,
      remainingHpAtMost: 30,
      program: [
        { op: "evolveFromDeck", names: ["Unfezant", "Unfezant ex"] },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** 🆕 **D311 — Dudunsparce (sv05-129 / sv08.5-080) "Run Away Draw"**: *"Once
    during your turn, you may draw 3 cards. If you drew any cards in this way,
    shuffle this Pokémon and all attached cards into your deck."* **TWO legal
    printings**, and the two rows share this one object.

    🛑 **THE ROW EXISTS BECAUSE A CENSUS WAS RE-DERIVED RATHER THAN QUOTED.** The
    `returnBenched` doc block in `effects.ts` has carried a refused list since D299
    whose quoted statement sweeps `attacks_json` alone; sweeping `abilities_json`
    too found this card (D310), and widening the LITERAL to the pronoun spelling
    found Abra `sv06-080` as well (D311). See that block for the corrected
    nine-printing family.

    ⚠️ **`activeOnly` IS FALSE, AND THAT IS THE PRINT AND NOT A CONVENIENCE.** The
    sentence carries no Active-Spot clause — Abra `sv06-080` prints the identical
    removal WITH one, which is the control — so a BENCHED Dudunsparce may run away
    and an ACTIVE one may too. The Active case is what owed the §8.1 promotion this
    slice supplies (`resolveMidTurnKnockOuts`, flow.ts), and it is the reason the
    row could not be built as "the Bench half" without inventing a clause the card
    does not print.

    🛑 **THE `recordGate` IS THE PRINTED "IN THIS WAY" AND IT IS NOT DECORATION.**
    An empty deck draws nothing, and the card then does NOT shuffle itself away —
    so the sentence's two halves come apart on a real board (the last-turns board
    where a Dudunsparce is exactly what a player is holding). `drawCards.recordAs`
    files the cards this draw actually took; a `conditionGate` on deck size would
    have asked about the deck BEFORE the op that shortens it.

    ⚠️ **AND `oncePerTurn` IS `true` RATHER THAN `"sharedByName"`** — the printed
    limiter is the bare *"Once during your turn"*, with no *"You can't use more than
    1 Run Away Draw Ability each turn"* rider, so two Dudunsparce each run away on
    the same turn. */
const RUN_AWAY_DRAW: CardProgram = {
  abilities: [
    {
      name: "Run Away Draw",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "drawCards", count: 3, recordAs: "moved" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        { op: "recordGate", slot: "moved", then: [{ op: "returnSelf", dest: "deck" }] },
      ],
    },
  ],
};

/** 🆕 **D312 — Abra `sv06-080` "Teleporter"**: *"Once during your turn, if this
    Pokémon is in the Active Spot, you may shuffle **it** and all attached cards
    into your deck."* **ONE legal printing**, and it CLOSES the self-removal
    family's ABILITY half at **3 of 3**.

    🛑 **THE ROW IS THE PRONOUN, AND THE PRONOUN IS WHY IT TOOK THREE SESSIONS TO
    FIND.** D299's refused list swept `attacks_json` alone; D310 widened the
    COLUMNS and handed the count over as eight; D311 widened the LITERAL to
    `'it and all attached cards'` and found THIS card. See the `returnSelf` block
    in `effects.ts` for the family as it now stands — and for the FOURTH width
    D312 swept, which found four printings more.

    ⚠️ **`activeOnly` IS `true`, AND IT IS THE PRINT — THE EXACT CONTROL FOR
    DUDUNSPARCE.** `RUN_AWAY_DRAW` sets it FALSE because the sentence carries no
    Active-Spot clause; this sentence carries one (*"if this Pokémon is in the
    Active Spot"*), and the two cards printing the SAME removal with and without
    it is the reason neither flag is a convenience. A benched Abra may not
    teleport.

    🛑 **AND THAT MAKES THIS ROW THE FAMILY'S ONLY *GUARANTEED* PROMOTION.** A
    Dudunsparce may run away from either zone, so its §8.1 promotion is a
    conditional consequence of where it happened to be standing; Abra can only
    ever remove itself from the Active Spot, so **every single use of this Ability
    owes the promotion D311 queued**. The op is unchanged and the seam is
    unchanged — this row is the one that makes both unconditional.

    ⚠️ **NO `optional` WRAPPER FOR THE PRINTED *"you may"***, `EMERGENCY_EVOLUTION`
    and `RUN_AWAY_DRAW`'s rule: §9 already gives an Ability its own optionality
    (not using it is always a legal answer), and a confirm prompt in front of a
    one-op program would ask the player to agree to the thing they just chose.
    ⚠️ **AND `oncePerTurn` IS `true` RATHER THAN `"sharedByName"`** — the printed
    limiter is the bare *"Once during your turn"* with no per-name rider, so two
    Abra each teleport on the same turn. */
const TELEPORTER: CardProgram = {
  abilities: [
    {
      name: "Teleporter",
      oncePerTurn: true,
      activeOnly: true,
      program: [{ op: "returnSelf", dest: "deck" }],
    },
  ],
};

/** 🆕 **D312 — Gholdengo `sv08-131` "Surf Back"** (attack index **1**): *"You may
    shuffle this Pokémon and all attached cards into your deck."*, `damage: 100`.
    **ONE legal printing**, and it opens the self-removal family's ATTACK half.

    🛑 **IT IS A REGISTRY ROW AND NOT A DERIVER ARM, DELIBERATELY.** The sentence
    is one printing; an anchor for *"You may shuffle this Pokémon and all attached
    cards into your deck."* would read exactly one string in the whole legal
    catalog, and the three OTHER attack printings of this mechanism (Poliwrath
    `sv06-043`, Eldegoss `sv07-011`, Lillie's Comfey `sv09-068`) each carry a
    second clause a shared anchor could not honour. So this moves `BUILT.attack`'s
    **`+4` REGISTRY summand to `+5`** and leaves the READER-keyed raw summand
    (1,146 printings over 303 sentences) exactly where it was.

    ⚠️ **INDEX 1 ONLY, AND THE INDEX-PRECISION IS THE POINT** (`CardProgram.attack`'s
    own rule, and D187's inflated intermediate result). Index 0 is *"Strike It
    Rich"* — *"If this Pokémon evolved from Gimmighoul during this turn, this
    attack does 90 more damage."*

    🆕🆕 **D393 — AND THAT SENTENCE IS NOW READ, WHICH SHARPENS THIS ROW RATHER
    THAN RETIRING IT.** D312 wrote *"an evolved-this-turn conditional this engine
    does not read"*, and D393 built it (`yourActiveEvolvedFromThisTurn`, a DERIVED
    bonus off `CONDITIONAL_DAMAGE_CLAUSES`). **THIS IS THE FIRST CARD IN THE
    CATALOG WITH A REGISTRY ATTACK AT ONE INDEX AND A DERIVED ONE AT ANOTHER**, so
    the index-precision claim now has teeth in BOTH directions: authoring index 0
    here would not merely leave "Surf Back" unsimulated, it would MASK a bonus the
    deriver already pays, because `programFor(id)?.attack` wins over
    `deriveAttackEffect`. The claim is unchanged and its consequence is worse —
    which is why the row is re-transcribed and not rewritten.

    🛑 **THE `optional` WRAPPER IS THE PRINTED "You may", AND HERE IT IS REAL
    WHERE AN ABILITY'S WOULD NOT BE.** `TELEPORTER` above takes no wrapper because
    §9 makes declining an Ability free. An ATTACK has already been DECLARED by the
    time its program runs — the Energy is committed, the 100 damage is dealt, the
    turn is ending — so *"you may"* names a decision that exists nowhere else, and
    without the wrapper the card would shuffle itself away against its
    controller's will. The two rows differ on this field for a reason that is
    about §8 versus §9 and not about house style.

    ⚠️ **AND THE ORDER IS DAMAGE-THEN-CHOICE, WHICH IS §8's AND NOT A CHOICE OF
    MINE.** `damage: 100` is applied at §8.5 before step 4 runs the program, so a
    Gholdengo that shuffles itself away has already Knocked the defender out; the
    §8.1 sweep in `finishAttack` then finds the defender lethal AND the attacker's
    spot empty, which is the exact board D312's promotion seam was written for. */
const SURF_BACK: CardProgram = {
  attack: {
    1: [
      {
        op: "optional",
        note: "You may shuffle this Pokémon and all attached cards into your deck.",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "returnSelf", dest: "deck" }],
      },
    ],
  },
};

/** 🆕 **D314 — Eldegoss `sv07-011` "Breezy Gift"** (attack index **0**): *"Put
    this Pokémon and all attached cards into your deck. If you do, search your
    deck for up to 3 cards and put them into your hand. Then, shuffle your
    deck."* **ONE legal printing**, no printed `damage`, and it takes the
    self-removal family to **12 of 13**.

    🛑 **THE HANDOFF PRICED THIS ROW AS "A `recordAs` ON `returnSelf` ITSELF" AND
    IT DOES NOT NEED ONE — THE PRINTED *"IF YOU DO"* HAS NO SEPARATING BOARD ON
    THIS CARD.** `drawCards.recordAs` (D311) earned its `recordGate` because an
    empty deck really does draw nothing, so Dudunsparce's two halves come apart
    on a board a player actually reaches. Ask the same question here and the
    answer is the other one. `returnSelf` (interpreter.ts) can decline to move
    exactly three ways — `sourceRef` yields no ref, the spot holds no body, the
    body has no top uid — and **an ATTACK program cannot reach any of them**:
    §8 declares the attack off the attacker's own Active body, "Breezy Gift"
    deals no damage and so Knocks nothing out, and nothing between the
    declaration and step 4 can empty that spot. A gate whose antecedent cannot
    fail is D310's *"a FILTER may be a SUBSTITUTION"* wearing §9.2's clothes: it
    would ship green, dead, and unkillable. So the row spends **no `recordAs`,
    no `recordGate` and no new field on any op** — and `breezyGift.test.ts` §4
    asserts that ABSENCE against the live program rather than leaving it as
    prose, because an absence nobody asks about is the one a later author
    "fixes".

    ⚠️ **THE VERB IS *PUT* AND NOT *SHUFFLE*, AND IT IS THE ONLY ONE IN THE
    FAMILY.** The other four deck printings (Dudunsparce ×2, Abra, Gholdengo,
    and the unbuilt Poliwrath) all say *"shuffle … into your deck"*; this one
    says *"Put … into your deck"* and then ends *"Then, shuffle your deck."*
    `returnSelf`'s deck arm shuffles as it places, so this program emits **TWO**
    `SHUFFLE` events where the sentence prints one shuffle. That is not a lie
    and it is not papered over with a field: the log reports what the ENGINE
    did, the engine really did randomise twice, and randomising EARLIER than the
    print can change no outcome — `searchDeck` scans the whole deck, so its
    candidate set is order-blind, and the printed trailing shuffle is the one
    that matters (it is what hides the order a player has just seen). Both
    SHUFFLEs are DRIVEN in §3, in order, with the count pinned.

    🛑 **THE ROW'S REAL CONTENT IS A BOARD, NOT AN OP: THIS IS THE FIRST PROGRAM
    IN THIS ENGINE THAT *PARKS* AFTER EMPTYING ITS OWN ACTIVE SPOT.** D311 and
    D312 removed the actor and finished; the §8.1 promotion D312 queued in
    `finishAttack` was therefore always reached with the program already
    settled. Here `searchDeck` asks a question FIRST — an `effect:choose`
    interrupt is announced, the opponent's board is untouched, and the attacker's
    Active Spot stands EMPTY across the whole interrupt — and the promotion is
    queued only when the answer comes back and `shuffleDeck` has run. §5 drives
    that ordering (no `PROMOTION_REQUIRED` while the choice is outstanding), and
    §6 drives the §14.2 ending on a Bench of none, where the controller loses
    only after their own search resolves.

    ⚠️ **AND `searchDeck`'s SILENT ZERO-CANDIDATE ENDING IS UNREACHABLE FROM THIS
    ROW, WHICH IS THE ONE THING THE OP ORDER BUYS.** The op above has just put at
    least this Pokémon into the deck, so the `anyCard` candidate set is never
    empty and the search always parks — including on a board whose deck was empty
    when the attack was declared, where the only card to find is the Eldegoss
    itself. Driven in §3.

    ⚠️ **`max: 3` AND NO `reveal`, BOTH OFF THE PRINT.** *"up to 3 cards"* is
    `anyCard` at `max: 3`, and `anyCard` is precisely the group `derivedHandSearch`
    measures as the only no-reveal printings in the whole to-hand search family —
    a `reveal: true` here would caption `DECK_SEARCHED` with cards this sentence
    never shows. The trailing `{ op: "shuffleDeck" }` is the printed *"Then,
    shuffle your deck."*, authored the way every other search row authors it.

    🛑 **A REGISTRY ROW AND NOT A DERIVER ARM, AND THE DERIVER SAYS SO ITSELF.**
    `ATTACK_HAND_SEARCH` (effects.ts) already names this exact string among the
    fourteen legal printings it refuses — *"a §9.2 LEADING clause"* — and it is
    that family's leading-`^` witness on the record. Reading it would mean
    swallowing a prefix, which is the one thing that family's safety property
    forbids. So this moves `BUILT.attack`'s **REGISTRY** summand alone, 12 → 13,
    and leaves the READER-keyed raw summand (1,146 printings over 303 sentences)
    and the split term (13) exactly where they were.

    ⚠️ **INDEX 0 ONLY.** Index 1 is "Leafage", `damage: 50` with **no `effect`
    key at all**, so it contributes zero attack units and must stay unclaimed. */
const BREEZY_GIFT: CardProgram = {
  attack: {
    0: [
      { op: "returnSelf", dest: "deck" },
      { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: 3 },
      { op: "shuffleDeck" },
    ],
  },
};

/** 🆕🆕 **D342 — "Search your deck for 2 cards, shuffle your deck, then put those
    cards on top of it in any order."** Ciphermaniac's Codebreaking `sv05-145` /
    `sv05-198` / `sv08.5-104` — Supporter, mark H, **3 legal printings, ONE
    object**, and the `effect`-column half of a sentence whose `attacks_json`
    half (Dialga `sv08-135` "Time Manipulation") is read by a DERIVER.

    🛑 **THE PROGRAM IS NOT WRITTEN HERE — IT IS `searchTopOrderProgram(2)`, THE
    SAME CALL `deriveAttackEffect` MAKES.** One printed sentence owes one
    reading, and two hand-typed copies in two files are two things that can
    drift with nothing in the repo going red. This is the first registry row in
    the file to import its program from the deriver's own factory rather than
    spell it out, and the suite asserts the two entry points are `toEqual` so
    the sharing is observable from outside rather than only true by inspection.

    ⚠️ **A SUPPORTER, SO THE §7.2 ONE-PER-TURN GATE IS THE CATALOG's**, not this
    row's: nothing here licenses anything, exactly as every other Supporter
    program in this file. And NO `programPlayable` arm — `searchDeck` has never
    carried one (a search of an empty deck is a silent no-op, the standing
    reading), so Ciphermaniac's off an empty deck plays, shuffles nothing and
    ends, which is what the print does. */
const CIPHERMANIACS_CODEBREAKING: CardProgram = { trainer: searchTopOrderProgram(2) };

/** 🆕🆕 **D345 — "CURSED BLAST": THE PRINTED SELF-KNOCK-OUT COST.**
    Dusclops `sv06.5-019`/`sv06.5-069`/`sv08.5-036` — *"Once during your turn, you
    may put **5** damage counters on 1 of your opponent's Pokémon. **If you use
    this Ability, this Pokémon is Knocked Out.**"* — and Dusknoir
    `sv06.5-020`/`sv06.5-070`/`sv08.5-037`, the same sentence at **13**.
    **6 legal printings, 2 sentences, 2 objects** (D199's near-twin rule: two
    printed sentences, two objects, and the only field between them is the
    amount).

    🛑 **THE ROW WAS CHOSEN BY CENSUSING THE CLAUSE, NOT THE CARD (D340), AND THE
    CARD IT WAS SENT FOR WAS NOT THE CHEAPEST MEMBER (D341).** `censusAtHead`'s
    largest live residue is row 9 (attach from the discard pile, 5 `abilityIds` +
    5 `effectIds`), whose ability half is blocked — by that row's own note — on
    *"NO op in this engine knocks out its own host"*. Censused over ALL THREE text
    columns on remote D1 `luminous` (2026-08-15),
    `instr(<col>, 'If you use this Ability, this Pokémon is Knocked Out') > 0`
    returns `effect` **0** + `abilities_json` **9 printings / 9 legal / 3
    sentences** + `attacks_json` **0** = **9 / 9 / 3**. The three sentences are
    Dusclops (3), Dusknoir (3) and Magneton "Overvolt Discharge" (3) — and
    **Magneton is the EXPENSIVE one**: it owes this op *plus* an *"in any way you
    like"* DISTRIBUTION of up to 3 Energy across several {L} bodies, which
    `attachEnergyFrom` cannot spell (D205's `count` lands the whole batch on ONE
    picked target; D248's `toEach` is a fold with no pick in it). **So the op is
    built here, on the two-thirds of its own family that owes nothing else, and
    row 9's residue note is re-priced rather than spent.**

    🛑 **THE ORDER IS THE PRINTED ORDER AND IT IS LOAD-BEARING.** `damageChosen`
    PARKS (`opponentAny`, a pick over the whole opposing board), so the Knock Out
    resolves on the RESUME — after the counters land, never before. Authoring the
    KO first would kill the host while its own Ability was still mid-decision, and
    §8.1 would collect a body whose program has not finished.

    ⚠️ **THE COUNTERS ARE COUNTERS, NOT DAMAGE**: no `deals`, so `placeSnipe`
    emits `COUNTERS_PLACED` flat — no Weakness/Resistance even on the Active, and
    no `damageReductionAfterWR` passive. The `× 10` (§12) is done HERE, at the
    site that reads the printed number, exactly as `damageChosen`'s own doc
    requires: 5 counters → **50**, 13 counters → **130**.

    ⚠️ **NO `optional` ON THE OP, AND THAT IS THE PRINT.** The printed "you may"
    governs USING the Ability (the player declines by not using it); once used,
    the placement is mandatory and so is the cost. `damageChosen.optional` is
    Hawlucha's auto-fired TRIGGER shape and means something else entirely.

    ⚠️ **NO `activeOnly`** — the sentence names no spot, so a benched Dusclops
    blasts and dies on the Bench (which is how the card is played). `oncePerTurn`
    is `true`, the DEFAULT PER-BODY scope: nothing here prints *"you can't use
    more than 1 Cursed Blast Ability each turn"*, so two Dusclops on one board are
    two uses and two Prizes. */
const CURSED_BLAST_5: CardProgram = {
  abilities: [
    {
      name: "Cursed Blast",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "damageChosen", target: "opponentAny", amount: 50, count: 1, source: "ability" },
        { op: "knockOutSelf" },
      ],
    },
  ],
};

/** Dusknoir's printing of `CURSED_BLAST_5`'s sentence, ONE number apart (13
    counters, 130 HP). A separate object because D199's near-twin rule is about
    printed SENTENCES and these are two — and because the pair is each other's
    control for the op below them: same program shape, same seam, one field. */
const CURSED_BLAST_13: CardProgram = {
  abilities: [
    {
      name: "Cursed Blast",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "damageChosen", target: "opponentAny", amount: 130, count: 1, source: "ability" },
        { op: "knockOutSelf" },
      ],
    },
  ],
};

/** ⚠️⚠️ D346 — Magneton `svp-153`/`svp-159`/`sv08-059` — "Overvolt Discharge":
    *"Once during your turn, you may attach up to 3 Basic Energy cards from your
    discard pile to your {L} Pokémon **in any way you like**. If you use this
    Ability, this Pokémon is Knocked Out."* **3 Standard-legal printings on ONE
    sentence, and ZERO engine diff** — `registry.ts` is the whole build.

    🛑🛑 **THIS CARD WAS BUILDABLE THE MOMENT D345 SHIPPED `knockOutSelf`, AND
    D345's OWN HANDOFF SAID IT WAS NOT.** The residue note it wrote — *"what
    actually blocks these three ids is … a DISTRIBUTION across several bodies …
    the printed phrase needs a multi-destination assignment prompt"* — **reversed
    a correct earlier note** sitting in `legalNonAttackPrograms.test.ts` since
    D263: *"the attach is expressible (3 ops, `targetType: "Lightning"`), but the
    second printed clause is 'If you use this Ability, this Pokémon is Knocked
    Out' and NO OP IN THE ENGINE KNOCKS OUT ITS OWN HOST."* D263 named the ONE
    blocker; D345 spent it and then named a different one that had been spent 82
    decisions earlier. **A RESIDUE NOTE CAN ROT BY BEING REWRITTEN, NOT ONLY BY
    STANDING STILL** — and the rewrite is the more expensive rot, because it
    overwrites a measurement with a guess and looks fresher for it.

    🛑 **THREE OPS AND NOT `count: 3`, WHICH IS `ASSEMBLE_ALLOY`'s CALL AT A
    THIRD UNIT.** `count` pins a batch to the ONE body a print NAMES (D205); the
    printed *"in any way you like"* is N INDEPENDENT decisions that may land on N
    different bodies. This is `attachFromZoneProgram`'s own `destination.anyWay`
    expansion written out by hand, exactly as D263 wrote Archaludon's two — so the
    hand-authored and the derived readings of one phrase still cannot drift.
    **`attachEnergyFrom` does NOT reach the `attachCards` assignment prompt, and
    must not**: that MAP is for *"any number"*, which names no unit to unroll
    (`attachFromHand`'s own doc), and this sentence prints a count.

    ⚠️ **NO `energyType`, AND THE ABSENCE IS THE PRINT.** The noun is *"Basic
    Energy cards"* with no brace code, which is `attachableEnergies`' default
    (`card.energyType === "Normal"`, no `anyEnergy`) — every Basic Energy in the
    pile and no Special one. `targetType: "Lightning"` is the OTHER printed noun
    (*"your {L} Pokémon"*), read off `topCardOf`. Archaludon spells the same brace
    code on BOTH nouns; this card spells it on one, which is why they are separate
    fields and are mutated separately.

    ⚠️ **`knockOutSelf` IS LAST, FOR `CURSED_BLAST`'s REASON AND A STRONGER ONE.**
    Every `attachEnergyFrom` PARKS, so the KO resolves on the final resume — after
    all three attaches land, never before. Authoring it first would kill the host
    mid-decision and §8.1 would collect a body whose program has not finished; here
    it would additionally destroy a legal attach TARGET (a {L} Magneton may receive
    its own Energy) while the prompt offering it was still open.

    ⚠️ **`programPlayable` REFUSES THIS ABILITY WHEN THE ATTACH CAN ONLY WHIFF** —
    an empty Basic-Energy discard, or no {L} Pokémon in play — because the gate is
    on the op and this program's other clause is a COST rather than an effect.
    Strictly, the printed rules permit using it and dying for nothing. **The
    doctrine is taken deliberately** (D222's afford-then-reject, the `switchActive`
    gate beside it): an Ability whose only reachable outcome is a self-KO is not
    "the first half of what it prints" the way Giovanni's bare switch is. Flagged
    rather than hidden — a later slice that wants the literal reading changes one
    gate, not this row.

    ⚠️ **`oncePerTurn` IS THE DEFAULT PER-BODY SCOPE and `activeOnly` is absent**:
    nothing prints *"you can't use more than 1 Overvolt Discharge Ability each
    turn"*, and the sentence names no spot, so two Magneton on one board are two
    uses and two Prizes given up. ZERO new ops, ZERO new op fields: `source:
    "discard"` (D234), `targetType` (D235) and `knockOutSelf` (D345) were all lying
    around, and the youngest of the three is one decision old. */
const OVERVOLT_DISCHARGE: CardProgram = {
  abilities: [
    {
      name: "Overvolt Discharge",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
        { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
        { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
        { op: "knockOutSelf" },
      ],
    },
  ],
};

/** 🆕🆕 D347 — Yanmega ex `sv10-003`/`sv10-206`/`sv10-228` — "Buzzing Boost":
    *"Once during your turn, **when this Pokémon moves from your Bench to the
    Active Spot**, you may search your deck for up to 3 Basic {G} Energy cards and
    attach them to this Pokémon. Then, shuffle your deck."*

    **3 Standard-legal printings, ONE byte-identical sentence, ONE object, and a
    ZERO ENGINE DIFF** — backlog row 10's ability residue, and the row's largest
    live block (its fourth `abilityId`, Steven's Metagross ex `sv10-145`, owes the
    *"or 1 of each"* grammar AND two `targetType`s in one sentence and stays out).

    ── THE CLAUSE CENSUS, TRANSCRIBED SO IT CAN BE RE-RUN ─────────────────────
    Remote D1 `luminous` (uuid 735f0fb5-cdc3-494d-8b97-74a8ade0124a), 2026-08-15,
    `instr(<col>, 'from your Bench to the Active Spot') > 0` over ALL THREE text
    columns — D340's rule, census the SENTENCE and not the card:

      effect          0 printings /  0 legal / 0 sentences
      abilities_json 13 printings /  3 legal / 4 sentences
      attacks_json    6 printings /  5 legal / 2 sentences

    The 3 legal ability printings are exactly these three ids. The other ten are
    Weavile ×2, Iron Moth ×2 and Iron Valiant ex ×6, ALL `legal_standard = 0`.

    🛑 **AND THE ATTACK HALF OF THIS CLAUSE SHIPPED AT D124, WHICH IS WHY THIS ROW
    IS THREE PRINTINGS FOR NO ENGINE LINE.** The five legal attack printings —
    Revavroom ex `sv06.5-015`/`-081` (+120) and Keldeo ex `sv10.5w-030`/`-159`/
    `-167` (+90) — print *"**If** this Pokémon **moved** from your Bench to the
    Active Spot this turn, this attack does {N} more damage"*, the same board fact
    in the indicative. D124 bought it as `InPlayPokemon.promotedTurn` (a TURN STAMP,
    so no boundary clear and §8.1 falls out free) and
    `BoardCondition.yourActivePromotedThisTurn`. The Ability half is the unbought
    remainder of one sentence, and it costs one `playableIf`.

    ── 🛑🛑 THE DESIGN CALL, AND IT IS A NAMED EXCEPTION TO THIS FILE'S OWN RULE ──
    `playableIf`'s doc block above says a per-body predicate **must not** be forced
    through this field, because *"`conditionHolds` takes a seat and no uid, so a
    self-pronoun has no referent in it"* — and it counts NINE legal printings whose
    *"Once during your turn, if …"* gate names THIS POKÉMON. That rule is right,
    and this card is the one shape it does not cover:

    ⚠️ **`activeOnly: true` GIVES THE SELF-PRONOUN ITS REFERENT.** It pins the
    Ability's host to the single body `conditionHolds` reads. *"Your Active moved up
    this turn"* ∧ *"this Pokémon IS the Active"* ⟹ *"this Pokémon moved up this
    turn"*, for every seat, consumer and phase, because `promotedTurn` is stamped on
    the Pokémon (D124's own totality argument). **The exception is not the
    predicate, it is the CONJUNCTION** — a per-body gate whose subject is
    necessarily the Active is a BOARD read once the spot clause is spent.

    ⚠️ **SO D310's STANDING QUESTION IS ANSWERED, AND THE ANSWER IS NO.**
    `remainingHpAtMost`'s doc says *"when the second per-body printing lands, THAT
    is the slice that generalises this"*. This is not that printing. Pidove
    `sv05-133` prints no spot clause, so its subject genuinely cannot be resolved
    from a seat; Yanmega's can, and a card whose gate is expressible in the shared
    vocabulary must not buy a private one (D190b — whatever is authored is what the
    card does forever). `remainingHpAtMost` stays the narrowest possible spelling of
    one printing, and the generalising slice is still ahead.

    ── EVERY OTHER SETTING IS STRAIGHT OFF THE PRINTED WORDS ──────────────────
    - *"Once during your turn"* → `oncePerTurn: true`, §9's DEFAULT per-body scope;
      nothing prints *"you can't use more than 1 Buzzing Boost Ability each turn"*,
      so two Yanmega ex are two uses — though only one can be Active, which the
      gate already says.
    - *"up to 3 Basic {G} Energy cards"* → `basicEnergy` + `energyType: "Grass"`
      with `max: 3`. The brace code is printed, unlike Magneton's bare noun one row
      up, so the narrowing is an assertion rather than a default.
    - *"attach them to **this Pokémon**"* → `toSelf`, Pawmot's field (D171) at its
      second registry row and its FIRST above `max: 1`. `toSelf` ignores
      `targetType`/`benchOnly` and yields a one-element target list, so the
      `attachCards` prompt maps up to 3 cards onto one body — which is the printed
      batch, and is why this row does NOT need the `attachEnergyFrom.count` gap
      `derivedDeckSearchAttach.test.ts`'s `UNREAD[0]` names one family over.
    - *"Then, shuffle your deck"* → the trailing `shuffleDeck`, the Nest Ball
      pattern: it runs on the whiff and on the decline too.
    - the *"you may"* is spent by choosing to use the Ability; the park it opens is
      still declinable, which is Pawmot's own recorded reading.

    ⚠️ **THE RECORDED LIMITATION, FLAGGED RATHER THAN HIDDEN.** The print is a
    MOMENT (*"when this Pokémon moves"*) and this models it as a GATE re-checked at
    use time. The two differ on exactly one board: a Yanmega that moves up and is
    then switched back DOWN in the same turn loses the use here and keeps it on
    paper. The divergence REFUSES rather than affords (D222's direction), it needs
    a second switch effect in one turn to reach, and buying the literal reading
    means a new `TriggerTiming` plus an optional-trigger confirm — a mechanism
    authored on the evidence of a board no printing rewards. A later slice that
    wants it changes this row, not the engine.

    ⚠️ **`programPlayable` DOES NOT GATE THIS**, per `attachFromDeck`'s own doc: the
    card prints *"Then, shuffle your deck"*, a clause that always resolves, so an
    empty deck of Basic {G} is never "no effect". The `playableIf` gate is separate
    and DOES refuse — through `useAbility`, `redactedAbilitiesOf` AND `GameHud`, the
    three surfaces `remainingHpAtMost`'s doc names — so the online HUD says *"Only
    if your Active Pokémon moved from your Bench to the Active Spot this turn"*
    rather than affording a use the engine will reject (D190/D222).

    **ZERO new ops, ZERO new op fields, ZERO new `BoardCondition` members, ZERO new
    `TriggerTiming`s, ZERO new prompt kinds, ZERO new events, ZERO new error codes,
    ZERO wire fields. `MATCH_RECORD_VERSION` STAYS 20** — `playableIf` is read at
    use time and never persisted. Both pieces were lying around: `toSelf` is D171
    and `yourActivePromotedThisTurn` is D124, so the YOUNGER of the two is 223
    decisions old. That is the whole reason this row is three printings for a
    registry diff. */
const BUZZING_BOOST: CardProgram = {
  abilities: [
    {
      name: "Buzzing Boost",
      oncePerTurn: true,
      activeOnly: true,
      playableIf: { kind: "yourActivePromotedThisTurn" },
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Grass" },
          max: 3,
          toSelf: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** 🆕🆕 D349 — Ledian `svp-133`/`sv07-003`/`sv07-144` — "Glittering Star Pattern":
    *"When you play this Pokémon from your hand to evolve 1 of your Pokémon during
    your turn, you may switch in 1 of your opponent's Benched Pokémon **that has 90
    HP or less remaining** to the Active Spot."* **3 Standard-legal printings on ONE
    sentence** (remote D1 `luminous`, 2026-08-15, `json_each(abilities_json)` on
    `$.effect`).

    🛑 **IT IS `DEFIANT_HORN` WITH ONE RELATIVE CLAUSE ON IT, AND THAT CLAUSE IS THE
    WHOLE ENGINE DIFF.** Hop's Dubwool `sv09-136` prints this sentence with no
    window — `onEvolve` + `optional` + a bare `gust` — so everything about the
    TRIGGER was already paid for (D250) and everything about the SWITCH was already
    paid for (Boss's Orders). What was missing was the ability to say *"that has 90
    HP or less remaining"* about a candidate, which `CardFilter` cannot say at any
    width: `matchesFilter` is handed a `Card` and current HP is a board read (D181,
    measured, not asserted).

    ⚠️ **`optional: true` ON THE TRIGGER FOR THE PRINTED *"you may"*, and NOT on
    the op** — the sentence offers the whole switch or nothing, and `gust` has no
    decline of its own. `DEFIANT_HORN`'s shape verbatim.

    ⚠️ **90 IS THE PRINTED NUMBER AND IT IS NOT LEDIAN'S OWN HP** — Ledian is
    printed at 90 HP too, which is a coincidence of the card and not a relationship
    the program may lean on. The window is measured against the OPPONENT's body
    through `effectiveMaxHp`, so a Bravery Charm on their Benched Pokémon lifts it
    out of reach and a Gravity Mountain drops one in. */
const GLITTERING_STAR_PATTERN: CardProgram = {
  triggered: [
    {
      name: "Glittering Star Pattern",
      trigger: "onEvolve",
      optional: true,
      program: [{ op: "gust", remainingHpAtMost: 90 }],
    },
  ],
};

/** 🆕🆕 D349 — Bianca's Devotion `sv05-142`/`sv05-197`/`sv05-209` (Supporter):
    *"Heal all damage from 1 of your Pokémon **that has 30 HP or less remaining**."*
    **3 Standard-legal printings on ONE sentence**, byte-identical across all three
    (remote D1 `luminous`, 2026-08-15, a 72-char `effect` with `abilities_json` and
    `attacks_json` both NULL on every one, so no ability reader and no attack reader
    can see this sentence at all and `BUILT.ability`/`BUILT.attack` cannot move on
    it).

    🛑 **POTION'S OP AT `amount: "all"` PLUS THE SAME WINDOW LEDIAN PRINTS ONE
    FAMILY OVER, WHICH IS WHY THIS ROW IS IN THE SAME SLICE AS THAT ONE.** *"N HP
    or less remaining"* as a CANDIDATE narrowing is **6 legal printings on 2 legal
    sentences** over two text columns and two ops; a slice that built only the row
    that sent it here would have authored the predicate and left half its yield on
    the table (D181's *"a vocabulary item's yield is not bounded by the row that
    prompted it"*, on the second op it has ever applied to).

    ⚠️ **THE SUPPORTER IS WHY `programPlayable` GAINED ITS FIRST `healChosen`
    LINE.** §7.2 allows one Supporter a turn; a board whose every body is above the
    window makes this card's prompt empty, and affording it would spend that
    Supporter on nothing. `healChosenTargets` answers both the offer and the
    refusal, so they cannot disagree (D331's repair, on its third op).

    ⚠️ **NO `zone`, NO `upTo`.** The print says *"1 of your Pokémon"* — the Active
    is one of your Pokémon (§1.1), the count is an exact one, and neither word is
    on this card. Honour the printed words and only those (D120). */
const BIANCAS_DEVOTION: CardProgram = {
  trainer: [{ op: "healChosen", amount: "all", remainingHpAtMost: 30 }],
};

/** 🆕🆕 D354 — Steven's Metagross ex `sv10-145` — "X-Boot": *"Once during your
    turn, you may search your deck for a Basic {P} Energy card, a Basic {M} Energy
    card, or 1 of each and attach them to your {P} Pokémon **and** {M} Pokémon in
    any way you like. Then, shuffle your deck."*
    **1 printing, 1 card, 1 sentence, `legal_standard = 1`** — the WHOLE
    Standard-legal population of the two-type attach target, over all three text
    columns (remote D1 `luminous`, 2026-08-16, keyed on `$.effect`).

    🛑 **THE RULES QUESTION WAS SETTLED BEFORE THE PRICE, WHICH IS WHY THIS ROW
    COSTS ANYTHING AT ALL.** D351 left this cell holding *"a disjunction on the
    TARGET axis, where `AttachTargetRiders.targetType` is a single `string`"*, and
    D353 asked the sharper question: which reading does the CARD print? If the
    print pairs the {P} Energy to a {P} body and the {M} to a {M} body, the row is
    **FREE** — two `attachFromDeck` ops each carrying its own single-string
    `targetType`, and no engine diff at all. Only the UNION reading buys anything.

    **THE PRINT SAYS UNION, AND THE PROOF IS TWO CENSUSES RATHER THAN AN ARGUMENT
    ABOUT THE ENGINE** (see `AttachTargetRiders.targetType`, effects.ts, for both
    in full): the *"attach them to `<NOUN>` in any way you like"* template is 31
    printings and its `<NOUN>` slot holds exactly ONE set description in every one
    — **the catalog contains no pairing form at all** — and the construction
    *"your {X} Pokémon and {Y} Pokémon"* appears on exactly one other card,
    Lilligant `sv09-007`, whose sentence admits no pairing reading whatsoever.

    ⚠️ **TWO OPS, AND THE SECOND REASON IS NOT THE FIRST ONE.** D351's Pyro Dance
    reading gives the DISJUNCTION: each attach PARKS, a park is declinable, so
    *"a Basic {P}, a Basic {M}, or 1 of each"* is exactly what the pair produces.
    But `max: 1` on each op is carrying something else — **the printed PER-TYPE
    CAP**. The tempting one-op spelling (`{ kind: "anyOf", filters: [{P},{M}] }`
    with `max: 2`) reads the same three words and silently legalises a FOURTH
    outcome the card does not print: **two Basic {P} Energy**. The `anyOf` filter
    exists and was refused here for that, not for want of a spelling.

    ⚠️ **BOTH OPS CARRY THE SAME UNION `targetType`, AND THAT IS THE WHOLE POINT
    OF THE ROW.** Giving op 1 `"Psychic"` and op 2 `"Metal"` would be the pairing
    reading wearing the union's clothes — it type-checks, it passes any test that
    only ever attaches one card, and it is wrong on the board the card is for: a
    Basic {P} Energy may land on a {M} body, and that is the difference the print
    turns on.

    ⚠️ **NO `programPlayable` GATE**, by `attachFromDeck`'s own doc: every card
    carrying the op prints "Then, shuffle your deck", a clause that always
    resolves, so "no eligible target" is never "no effect" (ruling/284). A board
    with neither a {P} nor a {M} body still shuffles — and this Pokémon is itself
    `types: ["Metal"]`, so its own body is always in the target set while it is in
    play, which is why that path is a rule about EMPTY BOARDS and not about this
    card. Contrast Pyro Dance, whose gate D351 had to make program-scoped.

    ZERO new ops, prompt kinds, choice kinds, events, error codes, `GameState`
    fields, `CardFilter` members, `EffectSlot` members, regexes, deriver arms or
    `programPlayable` arms. `MATCH_RECORD_VERSION` **STAYS 21** — the diff widens
    the TYPE of an in-memory op field, programs are re-derived from the card id
    rather than persisted, and no record gains, loses or re-reads a byte. */
const X_BOOT: CardProgram = {
  abilities: [
    {
      name: "X-Boot",
      oncePerTurn: true,
      activeOnly: false,
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Psychic" },
          max: 1,
          targetType: ["Psychic", "Metal"],
        },
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Metal" },
          max: 1,
          targetType: ["Psychic", "Metal"],
        },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Energy Coin — "Flip 2 coins. If both of them are heads, search your deck for a
    Basic Energy card and attach it to 1 of your Pokémon. Then, shuffle your
    deck." (Item, `sv10.5b-081` — 1 Standard-legal printing)

    THE ATTACH HALF WAS ALREADY BUILT AND ONLY THE GATE WAS MISSING, which is why
    this row is ≈1 item: `attachFromDeck` with a bare `basicEnergy` filter (no
    `energyType` — the print says "a Basic Energy card", unqualified) and
    `max: 1` ("attach **it** to **1** of your Pokémon"), with no `targetType`,
    no `benchOnly` and no `maxPerTarget` — "1 of your Pokémon" is the whole set,
    Active included, and one card cannot be split anyway.

    🛑 `coins: 2` IS THE ONLY NEW THING ON THIS CARD, and it is `coinFlipGate`'s
    D355 widening: the gate takes the printed number of coins and runs `then` when
    they are unanimous on the winning face. See the op's doc for why that is one
    key rather than a count plus a predicate.

    🛑 `shuffleDeck` SITS **INSIDE** THE GATE, and that is `POKE_BALL`'s ruling
    rather than a fresh call. "Flip a coin. If heads, search your deck … Then,
    shuffle your deck." is the identical template, and this file already carries
    the answer on that row: the search AND the shuffle are both gated, because on
    the losing face nothing was searched and there is nothing to shuffle. Hoisting
    it out would shuffle the deck on a failed flip — a real difference on a seeded
    engine, not a cosmetic one, since the deck ORDER is the next draw.

    ⚠️ **NO `programPlayable` GATE**, by `attachFromDeck`'s own doc and by the
    gate above it: the card is playable on any board. A deck holding no Basic
    Energy still flips, and a tails result still spends the Item — which is what
    an Item that gambles prints.

    ZERO new ops, prompt kinds, choice kinds, events, error codes, `GameState`
    fields, `CardFilter` members, `EffectSlot` members, regexes, deriver arms or
    `programPlayable` arms; ONE optional field on an op that already existed.
    `MATCH_RECORD_VERSION` **STAYS 21** — D144's shape exactly (an optional field
    on this same op), so an `EffectContinuation` authored before this slice simply
    lacks the key and reads as one coin. */
const ENERGY_COIN: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      coins: 2,
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      then: [
        { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1 },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

const REGISTRY: Record<string, CardProgram> = {
  // Professor's Research (SV base prints)
  "sv01-189": PROFESSORS_RESEARCH,
  "sv01-190": PROFESSORS_RESEARCH,
  "sv01-240": PROFESSORS_RESEARCH,
  "sv01-241": PROFESSORS_RESEARCH,
  // …and its two swsh10.5 prints (D180). ⚠️ MEASURED, not carried: both
  // `abilities`-free Supporter rows read "Discard your hand and draw 7 cards."
  // byte-identically to sv01-189/-190/-240/-241, queried against the 978-row /
  // 6-set catalog on 2026-08-04. ⚠️ AND BOTH ARE ROTATED OUT OF STANDARD —
  // `swsh10.5` is regulation mark F, 0 of its 88 rows Standard-legal — so this
  // row is playable-catalog completeness, not Standard coverage.
  "swsh10.5-078": PROFESSORS_RESEARCH,
  "swsh10.5-084": PROFESSORS_RESEARCH,
  // Nest Ball
  "sv01-181": NEST_BALL,
  "sv01-255": NEST_BALL,
  // Boss's Orders
  "sv02-172": BOSSS_ORDERS,
  "sv02-248": BOSSS_ORDERS,
  "sv02-265": BOSSS_ORDERS,
  // Switch — ⚠️ rotated OUT of Standard (see the program's doc).
  "sv01-194": SWITCH,
  // D206 — the "Switch … . If you do, …" seam. Surfer (Supporter, 2 legal) and
  // Team Rocket's Giovanni (Supporter, 3 legal), ids re-queried against the live
  // D1 on 2026-08-04 with GLOB and never LIKE; both effect strings match the
  // programs above verbatim.
  "sv08-187": SURFER,
  "sv08-235": SURFER,
  "sv10-174": TEAM_ROCKETS_GIOVANNI,
  "sv10-225": TEAM_ROCKETS_GIOVANNI,
  "sv10-238": TEAM_ROCKETS_GIOVANNI,
  // …and the seam's MIRROR — the same two ops, the other way round.
  "sv05-157": PRIME_CATCHER,
  "sv08.5-119": PRIME_CATCHER,
  // Potion
  "sv01-188": POTION,
  // Picnic Basket
  "sv01-184": PICNIC_BASKET,
  // Energy Search
  "sv01-172": ENERGY_SEARCH,
  // Chien-Pao ex — Shivery Chill (activated ability)
  "sv02-061": CHIEN_PAO,
  "sv02-236": CHIEN_PAO,
  "sv02-261": CHIEN_PAO,
  "sv02-274": CHIEN_PAO,
  // Mewtwo VSTAR — Psy Purge (registry-authored attack index 0, D97). Three
  // prints, all identical.
  "swsh10.5-031": MEWTWO_VSTAR,
  "swsh10.5-079": MEWTWO_VSTAR,
  "swsh10.5-086": MEWTWO_VSTAR,
  // Bouffalant — Bouffer (passive)
  "sv03-174": BOUFFALANT,
  // — M4 slice 3: Stadiums + Tools (verified vs local D1 2026-07-18). —
  // Beach Court (Stadium)
  "sv01-167": BEACH_COURT,
  // Pokémon League Headquarters (Stadium)
  "sv03-192": POKEMON_LEAGUE_HQ,
  // Calamitous Wasteland (Stadium) — D109, verified vs local D1 2026-07-31
  "sv02-175": CALAMITOUS_WASTELAND,
  // — Stadium activated abilities (D102, verified vs local D1 2026-07-28). —
  "sv06.5-060": NEUTRALIZATION_ZONE, // Neutralization Zone — the only Stadium on the §8.5 DAMAGE seam (ACE SPEC)
  // D324 — the §8.1 MAX-HP seam's Stadium half: one signed field, two prints,
  // opposite signs and different stages, both sides of the board, no §9 gate.
  "sv08-180": LIVELY_STADIUM, // Lively Stadium — each BASIC in play gets +30 HP
  "sv08-177": GRAVITY_MOUNTAIN, // Gravity Mountain — each STAGE 2 in play gets -30 HP
  "sv08-250": GRAVITY_MOUNTAIN,
  "sv02-171": ARTAZON, // Artazon — search a no-Rule-Box Basic → Bench
  "sv03-229": ARTAZON, // Artazon (reprint)
  "sv01-178": MESAGOZA, // Mesagoza — coin-gated search a Pokémon → hand
  "sv03-196": TOWN_STORE, // Town Store — search a Pokémon Tool → hand
  // Vitality Band (Tool)
  "sv01-197": VITALITY_BAND,
  "fix-booster-ability": FIX_BOOSTER_ABILITY, // FIXTURE — a §9-SUPPRESSIBLE pre-W/R bonus (D155)
  "sv01-169": DEFIANCE_BAND, // +30 before W/R while behind on Prizes (morePrizesThanOpponent)
  "sv02-176": CHOICE_BELT, // +30 before W/R vs a defending Pokémon V (name-derived suffix)
  // Bravery Charm (Tool)
  "sv02-173": BRAVERY_CHARM,
  // D324 — Bravery Charm's STAGE-FREE twins, the printing its own fold audit
  // named in advance. Hero's Cape survives the evolution that ends the Charm.
  "sv05-152": HEROS_CAPE, // Hero's Cape — +100 HP, NO stage clause
  "sv10-162": CYNTHIAS_POWER_WEIGHT, // Cynthia's Power Weight — +70 HP, OWNER clause
  // Rocky Helmet (Tool) — reactive recoil, the Tool twin of Counterattack Quills (D98 damageAttacker)
  "sv01-193": ROCKY_HELMET,
  // Vengeful Punch (Tool) — the SAME recoil on a KO condition (D158 damageAttackerOnKo),
  // verified vs the local D1 2026-08-03 (890 rows / 5 sets). The family's last always-on
  // printing; it reads at flow.ts's §8.1 sweep, not attack.ts's `dealt > 0` block.
  "sv03-197": VENGEFUL_PUNCH,
  // Exp. Share (Tool) — the SAME KO antecedent a THIRD time (D171), and the first Tool
  // whose sentence is a `triggered` program rather than a `passive` number: it runs on a
  // new board scan (triggers.ts koToolTriggersOf) at a new stage (flow.ts koToolTrigger),
  // because its bearer is a SURVIVING body and the dying one is only the Energy's source.
  "sv01-174": EXP_SHARE,
  // — M4 slice 5: Special Energy (verified vs local D1 2026-07-18). —
  // Jet Energy — {C} + switch-on-bench-attach
  "sv02-190": JET_ENERGY,
  // Luminous Energy — wildcard (any 1 type), {C} if another Special attached
  "sv02-191": LUMINOUS_ENERGY,
  // — D174: the first Special Energy with a CONTINUOUS clause (verified vs local
  // D1 2026-08-03). Therapeutic Energy — {C} + the §12 recovery/immunity pair.
  "sv02-193": THERAPEUTIC_ENERGY,
  // — M4 slice 6: triggered Abilities (verified vs local D1 2026-07-18). —
  // Flamigo — Insta-Flock (on-play-to-Bench: search up to 3 Flamigo)
  "sv02-170": FLAMIGO,
  "sv02-227": FLAMIGO,
  // Arboliva — Enriching Oil (on-evolve: heal all from 1 of your Pokémon)
  "sv01-023": ARBOLIVA,
  // Garganacl — Blessed Salt (between-turns: heal 20 from each of your Pokémon)
  "sv02-123": GARGANACL,
  // Trevenant — Forest Miasma (between-turns, Active-only: 1 counter on opp Active)
  "sv03-012": TREVENANT,
  // — M4 slice 7: Rare Candy (verified vs local D1 2026-07-18). —
  // Rare Candy — Basic→Stage 2 evolve-skip Item
  "sv01-191": RARE_CANDY,
  "sv01-256": RARE_CANDY,
  // …and its swsh10.5 print (D180) — MEASURED byte-identical to sv01-191/-256
  // ("Choose 1 of your Basic Pokémon in play. …"), same 2026-08-04 query, and
  // rotated out of Standard for the same reason as the two rows above.
  "swsh10.5-069": RARE_CANDY,
  // — M4 slice 8: the mid-turn-damage snipe (verified vs the live api 2026-07-19). —
  // Hawlucha — Flying Entry (onPlayToBench: choose 2 opp Benched, 1 counter each)
  "sv01-118": HAWLUCHA,
  // Meowscarada ex — Bouquet Magic (activated, {G}-discard cost: 3 counters on 1 opp Benched)
  "sv02-015": MEOWSCARADA,
  "sv02-231": MEOWSCARADA, // (reprint — same Bouquet Magic, byte-identical in the catalog)
  "sv02-256": MEOWSCARADA,
  "sv02-271": MEOWSCARADA, // (reprint)
  // — M4 slice 9: on-KO triggered Abilities (verified vs the live catalog 2026-07-19). —
  // Glimmora — Shattering Crystal (on-KO: flip; heads → opponent takes no prize for it)
  "sv02-126": GLIMMORA,
  // fix-onko — FIXTURE demonstrator: an on-KO Ability that PARKS (resume-the-tail)
  "fix-onko": FIX_ONKO,
  // Munkidori ex — Oh No You Don't (on-KO, ATTACK-CONDITIONED: 1 fewer Prize while a
  // Pecharunt ex is in play). D164, verified vs the local D1 2026-08-03 (978 rows / 6
  // sets). THREE printings, one byte-identical body; the same three ids also carry
  // D154's per-attack lock on "Dirty Headbutt", which is TEXT-derived and untouched.
  "sv06.5-037": MUNKIDORI_EX,
  "sv06.5-083": MUNKIDORI_EX,
  "sv06.5-091": MUNKIDORI_EX,
  "sv06.5-038": FLIP_THE_SCRIPT, // Fezandipiti ex — "Flip the Script" (D271's KO gate on the ABILITY surface + the cross-copy name lock)
  "sv06.5-084": FLIP_THE_SCRIPT, // (reprint)
  "sv06.5-092": FLIP_THE_SCRIPT, // (reprint)
  // — D273 — Pecharunt ex "Subjugating Chains": the {D}-narrowed, name-excluding
  // bench switch plus the §9.2 poison. FIVE Standard-legal printings on ONE
  // byte-identical `abilities_json`, re-queried 2026-08-07 (`GROUP BY
  // lower(j.value ->> 'effect')` over `json_each(abilities_json)`,
  // `legal_standard = 1` — the ids re-derive to the digit).
  "sv06.5-039": SUBJUGATING_CHAINS,
  "sv06.5-085": SUBJUGATING_CHAINS, // (reprint)
  "sv06.5-093": SUBJUGATING_CHAINS, // (reprint)
  "sv06.5-095": SUBJUGATING_CHAINS, // (reprint)
  "sv08.5-163": SUBJUGATING_CHAINS, // (reprint)
  // — D275 — Fan Rotom "Fan Call": the name-lock sweep's LAST row, and the one
  // that needed a per-seat turn ORDINAL. TWO Standard-legal printings on ONE
  // byte-identical `abilities_json` (remote D1 `luminous`, 2026-08-08 — the same
  // `GROUP BY` as the block above; both rows carry `types_json ["Colorless"]`
  // and `hp` 70, which is what licenses the `pokemonType` on the filter).
  "sv07-118": FAN_CALL,
  "sv08.5-085": FAN_CALL, // (reprint)
  // 🆕 D294 — Mandibuzz "Look for Prey": the cross-seat DESTINATION, one optional
  // field on an M5 op. TWO Standard-legal printings on ONE byte-identical
  // `abilities_json` (remote D1 `luminous`, 2026-08-08), and the whole legal
  // population of the sentence.
  "sv10.5w-064": LOOK_FOR_PREY,
  "sv10.5w-145": LOOK_FOR_PREY, // (reprint)
  // fix-koprize — FIXTURE demonstrator: the same reduction on a ONE-Prize body,
  // the only way to reach the clamp (Munkidori ex is worth two). D164.
  "fix-koprize": FIX_KOPRIZE,
  // — M5 coverage pass #1: existing-op cards (verified vs the local catalog 2026-07-19). —
  "sv01-185": POKE_BALL, // Poké Ball — coin-gated search a Pokémon → hand
  "sv01-187": POKEMON_CATCHER, // Pokémon Catcher — coin-gated gust
  "sv01-180": NEMONA, // Nemona — draw 3 (Supporter)
  "sv02-150": COPPERAJAH_EX, // Copperajah ex — Bronze Body (−30 after W/R)
  // (reprint — D180). MEASURED: both `abilities_json` rows carry exactly
  // [{"type":"Ability","name":"Bronze Body","effect":"This Pokémon takes 30 less
  // damage from attacks (after applying Weakness and Resistance)."}]. Mark G,
  // i.e. rotated out of Standard like the other three D180 ids.
  "sv02-245": COPPERAJAH_EX,
  "sv01-121": STONJOURNER, // Stonjourner — Exoskeleton (−20 after W/R)
  // — M5 op-slice: damageAttacker reactive recoil (verified vs the live D1 2026-07-27). —
  "sv01-005": COUNTERATTACK_QUILLS, // Cacnea — Counterattack Quills (3 counters on the attacker)
  "sv01-006": COUNTERATTACK_QUILLS, // Cacturne — Counterattack Quills (same program)
  "sv03-112": STUNFISK, // Stunfisk — Custom Trap (5 counters, only while a Tool is attached)
  "sv03-044": SCORCHING_ARMOR, // Armarouge — Scorching Armor (onDamagedByAttack → Burn the attacker)
  "sv03-120": COUNTERATTACKING_PINCER, // Klawf ex — Counterattacking Pincer (onDamagedByAttack → PARKING discard from the attacker)
  // — M5 op-slice: disableAbilities continuous Ability-lock auras (verified vs the live D1 2026-07-27). —
  "sv01-096": MISCHIEVOUS_LOCK, // Klefki — Mischievous Lock (Basic, both sides, Active-only, except itself)
  "sv02-089": FETTERED_IN_MISFORTUNE, // Spiritomb — Fettered in Misfortune (Basic V, both sides)
  "sv02-127": CURSED_LAND, // Ting-Lu ex — Cursed Land (opponent's damaged non-ex, Active-only)
  "sv02-243": CURSED_LAND, // (reprint)
  "sv02-263": CURSED_LAND, // (reprint)
  "sv02-275": CURSED_LAND, // (reprint)
  // — M5 op-slice: removeWeakness continuous own-board aura (verified vs the live D1 2026-07-28). —
  "sv01-093": BLOOMING_GARDEN, // Florges — Blooming Garden ("Your Pokémon in play have no Weakness")
  // — M5 long-tail: preventDamageFromExV holder passive (verified vs the live D1 2026-07-28). —
  "sv02-097": SAFEGUARD, // Mimikyu — Safeguard ("Prevent all damage from opponent's Pokémon ex/V")
  // — M5 long-tail: noRetreatCostAura continuous own-board aura (verified vs the live D1 2026-07-31). —
  "sv03-082": LUNAR_ZONE, // Clefable ex — Lunar Zone ("All of your Pokémon that have {P} Energy attached have no Retreat Cost")
  // — M5 long-tail: opponentActiveRetreatSurcharge, the last retreat-cost modifier (verified vs the live D1 2026-07-31). —
  "sv01-019": TRAP_TERRITORY, // Spidops ex — Trap Territory ("Your opponent's Active Pokémon's Retreat Cost is {C} more")
  "sv01-223": TRAP_TERRITORY, // (reprint)
  "sv01-243": TRAP_TERRITORY, // (reprint)
  // — M5 long-tail: preventOpponentActiveRetreat, the L3 shape of the retreat-lock seam (verified vs the local D1 2026-08-01). —
  "swsh10.5-055": BLOCK, // Snorlax — Block ("As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon can't retreat")
  // — M5 long-tail: noRetreatCostSelf, the LAST print on the retreat-cost seam, closing it at 10/10 (verified vs the local D1 2026-08-01). —
  "swsh10.5-025": PUNK_OUT, // Wimpod — Punk Out ("If your opponent has any Pokémon V in play, this Pokémon has no Retreat Cost")
  // — M5 long-tail: opponentActiveAttackDebuff, the ALWAYS-ON member of D149's pre-W/R debuff family (verified vs the local D1 2026-08-02). —
  "sv03-030": PRESSURE, // Entei — Pressure ("As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance)")
  // — P3-M5 (D192): the ABILITY half of the main-hit damage-modifier suppression
  //   family. ONE sentence, ONE card, 6 printings, all 6 Standard-legal —
  //   the whole population of "Damage from attacks used by this Pokémon isn't
  //   affected by …" over `abilities_json`, measured against the remote D1
  //   `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows / 20 sets,
  //   2,021 legal) on 2026-08-04. No fixture for the real ids: they are outside
  //   the local 6-set manifest (D190's Tier-1 idiom). —
  "sv05-050": AZURE_SEAS, // Walking Wake ex — Azure Seas
  "sv05-189": AZURE_SEAS, // (reprint)
  "sv05-205": AZURE_SEAS, // (reprint)
  "sv05-215": AZURE_SEAS, // (reprint)
  "sv08.5-178": AZURE_SEAS, // (reprint)
  "svp-127": AZURE_SEAS, // (reprint — promo)
  "fix-azureseas": AZURE_SEAS, // FIXTURE — the synthetic demonstrator that DRIVES the row
  // — P3-M5 (D208): the §8.1 KO-SURVIVAL clamp. ONE sentence, TWO Ability names,
  //   7 printings, all 7 Standard-legal — the whole population of "…has full HP
  //   and would be Knocked Out by damage from an attack…" over `abilities_json`,
  //   measured against the remote D1 `luminous`
  //   (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows / 20 sets, 2,021 legal)
  //   on 2026-08-04 by `json_each` + an EQUALITY on the effect string. No fixture
  //   for the real ids: all seven are outside the local 6-set manifest, which
  //   CANNOT be regenerated (SQLITE_CANTOPEN), so the behaviour is driven on
  //   synthetic bodies carrying the identical program (D190's Tier-1 idiom,
  //   D192's `fix-azureseas` two lines up). —
  "sv08-057": KO_SURVIVAL, // Pikachu ex — Resolute Heart
  "sv08-219": KO_SURVIVAL, // (reprint)
  "sv08-238": KO_SURVIVAL, // (reprint)
  "sv08-247": KO_SURVIVAL, // (reprint)
  "sv08.5-179": KO_SURVIVAL, // (reprint)
  "sv10.5b-052": KO_SURVIVAL, // Crustle — Sturdy (a DIFFERENT Ability name, the SAME sentence)
  "sv10.5b-130": KO_SURVIVAL, // (reprint)
  "fix-sturdy": KO_SURVIVAL, // FIXTURE — 120 HP Basic, the demonstrator that DRIVES the row
  "fix-sturdytiny": KO_SURVIVAL, // FIXTURE — 20 HP Basic: the CHECKUP-boundary witness
  "fix-suppresswall": FIX_SUPPRESS_WALL, // FIXTURE — ×2 Fire AND −30 after W/R: the order witness
  // FIXTURE (D240) — the damage-CAP installer carrying a printed −30, and the ONE
  // body in `damageCapBlock.test.ts` on which "post-Weakness" and "post-REDUCTION"
  // give different answers. The program is SHARED rather than re-declared: the
  // printed reading is the same one, and a second literal 30 would be a second
  // chance to disagree with it.
  "fix-carapace-tough": FIX_SUPPRESS_WALL,
  "fix-resistwall": FIX_SUPPRESS_WALL, // FIXTURE — −30 Fire Resistance AND −30 after W/R
  // — M5 long-tail: the ALWAYS-ON ATTACKER FILTERS — the always-on half of §D146's
  //   census, re-queried as its own question against the local D1 (890 rows / 5
  //   sets, 2026-08-03) plus FIXTURE_POOL swept SEPARATELY. Six rows print
  //   "prevent all damage … by attacks from" outside an attack; one of the six is
  //   Mimikyu's SAFEGUARD above, already simulated since 0.58.0, so this batch is
  //   FIVE printings over FOUR sentences and three distinct mechanisms. —
  "sv01-099": WELL_BAKED_BODY, // Dachsbun — Well-Baked Body (BOTH clauses since D172: the Burn immunity + the {R} prevention)
  "sv03-078": INSULATOR, // Bellibolt — Insulator ("Prevent all damage done to this Pokémon by attacks from your opponent's {L} Pokémon")
  "sv03-201": INSULATOR, // (reprint — Illustration rare)
  "sv03-070": ADVERSE_WEATHER, // Thundurus — Adverse Weather (the Active shields the BENCH; no attacker filter at all)
  // — M5 long-tail: the §12 STATUS-IMMUNITY family (D172), re-censused as its own
  //   question against the local D1 (978 rows / 6 sets, 2026-08-03) over ALL THREE
  //   text columns and with FIXTURE_POOL swept as a separate population: FOUR
  //   printings over THREE sentences. Dachsbun's `statusImmunities` above is the
  //   first; these two are the second; the third (Therapeutic Energy sv02-193, a
  //   SPECIAL ENERGY that also RECOVERS) was deliberately NOT built at D172 —
  //   ✅ **it is BUILT AT D174** (`THERAPEUTIC_ENERGY` above), which bought
  //   `EnergyProgram.passive`, `passivesOf`'s third source class, the §9 exemption
  //   stated the other way round, and flow.ts `recoverStatuses`. THE FAMILY IS
  //   CLOSED at 4/4 printings and 3/3 sentences. —
  "sv01-068": ELECTRICITY_POUCHES, // Pachirisu — Electricity Pouches ("This Pokémon can't be Paralyzed")
  "sv01-208": ELECTRICITY_POUCHES, // (reprint — Illustration rare)
  // — M5 long-tail: the DISCRETE `recovers from ALL Special Conditions` family
  //   (D177), re-censused as its own question against the local D1
  //   (978 cards / 6 sets, 2026-08-04) over ALL THREE columns and a WIDENED VERB SET
  //   (`%recovers from%`, not just `%can't be%` — the predicate that hid this
  //   family for fifteen decisions): FOUR printings over TWO sentences, both
  //   DISCRETE. Only ONE needs a row here — Gardevoir ex's three printings are an
  //   ATTACK whose whole effect derives (effects.ts `SELF_RECOVERS_ALL`). —
  "sv01-145": BLISSEY, // Blissey — Busybody Nurse ("Your Active Pokémon recovers from all Special Conditions")
  // — M5 long-tail: the ATTACK-COST ± family, both signs in one slice. Censused as
  //   its own question against the local D1 (978 cards / 6 sets, 2026-08-03, all
  //   three text columns): "cost {C} more"/"cost Colorless less" prints on THREE
  //   rows over THREE distinct sentences — Pokémon League Headquarters sv03-192
  //   (a Stadium, `StadiumEffects.basicAttackCostSurcharge`, built since M4) and
  //   these two. `attacks_json` contributes nothing; both of these are ABILITIES. —
  "sv03-052": QUAKING_ZONE, // Seismitoad — Quaking Zone ("As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon cost {C} more")
  "swsh10.5-011": EXCITED_HEART, // Radiant Charizard — Excited Heart ("This Pokémon's attacks cost Colorless less for each Prize card your opponent has taken")
  // — M5 long-tail: the evolutionPokemon CardFilter (verified vs the live D1 2026-07-28). —
  "sv01-175": JACQ, // Jacq — search up to 2 Evolution Pokémon → hand, then shuffle (Supporter)
  "sv01-236": JACQ, // (reprint)
  "sv01-250": JACQ, // (reprint)
  // — M5 op-slice: attachEnergyFrom (verified vs the local catalog 2026-07-19). —
  "sv01-054": QUAQUAVAL, // Quaquaval — Energy Carnival (attach a Basic Energy from hand)
  "sv02-060": BAXCALIBUR, // Baxcalibur — Super Cold (attach a Basic {W} from hand, repeatable)
  "sv02-210": BAXCALIBUR, // Baxcalibur (reprint)
  "fix-attacher": FIX_ATTACHER, // FIXTURE — the discard-source attach branch
  // — attachEnergyFrom riders: Gardevoir ex (targetType + bonusCounters + notIfKO). —
  "sv01-086": GARDEVOIR_EX, // Gardevoir ex — Psychic Embrace
  "sv01-228": GARDEVOIR_EX, // (reprint)
  "sv01-245": GARDEVOIR_EX, // (reprint)
  // — attachEnergyFrom multi + endsTurn: Koraidon ex "Dino Cry" (the sv01 prints
  //   carry the ability; sv03-124 is a different Koraidon ex without it). —
  "sv01-125": KORAIDON_EX,
  "sv01-231": KORAIDON_EX,
  "sv01-247": KORAIDON_EX,
  "sv01-254": KORAIDON_EX,
  // — M5 op-slice: discardPileRetrieval (verified vs the local catalog 2026-07-20). —
  "sv01-171": ENERGY_RETRIEVAL, // Energy Retrieval — 2 Basic Energy from discard → hand
  "sv01-182": PAL_PAD, // Pal Pad — 2 Supporters from discard → deck (shuffle)
  "sv02-188": SUPER_ROD, // Super Rod — 3 Pokémon/Basic Energy from discard → deck (shuffle)
  "sv02-276": SUPER_ROD, // Super Rod (reprint)
  // — M5 op-slice: §9.2 op→op data flow — a clause that reads what an earlier
  //   clause of the same card DID (verified vs the local catalog 2026-07-22).
  //   Both are also discardPileRetrieval rows: this is the op the mechanism was
  //   missing at both ends, recording for Miriam and reading for SER. —
  "sv01-179": MIRIAM, // Miriam — up to 5 Pokémon discard → deck, shuffle, "in this way" → draw 3
  "sv01-238": MIRIAM, // Miriam (reprint)
  "sv01-251": MIRIAM, // Miriam (reprint)
  "sv03-190": ORTEGA, // Ortega — reveal opponent's hand, bottom a chosen card, "in this way" → they may draw
  "sv03-219": ORTEGA, // Ortega (reprint)
  "sv02-189": SUPERIOR_ENERGY_RETRIEVAL, // Superior Energy Retrieval — pay 2, then up to 4 Basic Energy back, minus the 2 just paid
  "sv02-277": SUPERIOR_ENERGY_RETRIEVAL, // Superior Energy Retrieval (reprint)
  // — M5 op-slice: lookAtTopN (verified vs the local catalog 2026-07-20). —
  "sv02-183": GREAT_BALL, // Great Ball — look at top 7, reveal a Pokémon → hand (shuffle)
  "sv01-186": POKEGEAR, // Pokégear 3.0 — look at top 7, reveal a Supporter → hand (shuffle)
  // — M5 op-slice: moveEnergy (verified vs the local catalog 2026-07-20). —
  "sv01-173": ENERGY_SWITCH, // Energy Switch — move a Basic Energy, own → own
  "sv03-193": POPPY, // Poppy — move up to 2 any Energy, own → own (Supporter)
  "sv03-220": POPPY, // Poppy (reprint)
  "sv03-227": POPPY, // Poppy (reprint)
  // — M5 op-slice: handRefresh (the hand-refresh Supporter family; verified vs
  //   the local catalog 2026-07-20). —
  "sv01-198": YOUNGSTER, // Youngster — shuffle hand into deck, draw 5
  "sv01-176": JUDGE, // Judge — each player shuffles hand into deck, draws 4
  "sv03-187": BRASSIUS, // Brassius — shuffle hand into deck, draw (hand size + 1)
  "sv01-177": KATY, // Katy — shuffle hand into deck, draw 8, your turn ends
  "sv01-237": KATY, // Katy (reprint)
  "sv02-185": IONO, // Iono — each player's hand to the BOTTOM, draw their Prize count
  "sv02-254": IONO, // Iono (reprint)
  "sv02-269": IONO, // Iono (reprint)
  // — M5 op-slice: board conditions (verified vs the local catalog 2026-07-21). —
  "sv02-181": FIGHTING_AU_LAIT, // Fighting Au Lait — play gate: more Prizes left; heal 60
  "sv02-180": FALKNER, // Falkner — draw 2, +2 more if YOUR Stadium is in play
  "sv02-251": FALKNER, // Falkner (reprint)
  "sv02-184": GRUSHA, // Grusha — draw until 5 in hand, until 7 if no Energy on your board
  "sv02-253": GRUSHA, // Grusha (reprint)
  "sv02-268": GRUSHA, // Grusha (reprint)
  "fix-condgate": FIX_CONDGATE, // FIXTURE — a parking op inside each gate arm
  "fix-gateorder": FIX_GATEORDER, // FIXTURE — gate timing, splice order, surviving tail
  "fix-gatedsup": FIX_GATEDSUP, // FIXTURE — a GATED Supporter (the allowance ordering)
  // — M5 op-slice: discardEnergy (verified vs the local catalog 2026-07-21). —
  "sv01-168": CRUSHING_HAMMER, // Crushing Hammer — coin-gated: an Energy off 1 opp Pokémon
  "sv02-182": GIACOMO, // Giacomo — a Special Energy off EACH of the opponent's Pokémon
  "sv02-252": GIACOMO, // Giacomo (reprint)
  "sv02-267": GIACOMO, // Giacomo (reprint)
  "sv03-143": MAWILE, // Mawile — Special Eater (on-bench: a Special Energy off their Active)
  "fix-hammer": FIX_HAMMER, // FIXTURE — the opponentChosen arm without the coin gate
  // — M5 op-slice: the providesEnergy filter (verified vs the local catalog
  //   2026-07-21). The typed self-discard family it also lands is DERIVED from
  //   printed text (Kilowattrel, Arcanine ex ×2, Charmeleon, Charizard), so it
  //   adds no rows here — these two are the filter's SECOND consumer. —
  "sv01-041": ARMAROUGE, // Armarouge — Fire Off ({R} benched→Active, as often as you like)
  "sv01-203": ARMAROUGE, // Armarouge (reprint)
  "fix-pilescan": FIX_PILESCAN, // FIXTURE — the filter handed to a DECK search: no match
  "fix-blend": FIX_BLEND, // FIXTURE — a Special providing TWO distinct types
  "fix-grassdouble": FIX_GRASSDOUBLE, // FIXTURE — a Special providing ONE type TWICE
  // — M5 op-slice: attachFromTop (verified vs the local catalog 2026-07-21). —
  "sv01-170": ELECTRIC_GENERATOR, // Electric Generator — top 5, up to 2 Basic {L} → Benched {L}
  "sv02-140": HYDREIGON, // Hydreigon — Tri Howl (top 3, any Energy → your Pokémon, discard rest)
  // — M5 op-slice: payFromHand (verified vs the local catalog
  //   2026-07-21). Meowscarada ex is ABOVE (M4 slice 8) and migrated onto this
  //   op in place — the two printed wordings, "you must discard … in order to
  //   use this Ability" and "you can use this card only if you discard … other
  //   cards", are one mechanism. —
  "sv01-196": ULTRA_BALL, // Ultra Ball — discard 2 other cards, search a Pokémon → hand
  "sv06.5-096": EARTHEN_VESSEL, // Earthen Vessel — discard another card, search 2 Basic Energy
  // — 🆕 D336 op-slice: the THREE- and FOUR-NOUN search (`searchDeck.also`, a
  //   LIST of further filter/cap pairs). 3 legal printings on 2 cards, the whole
  //   Standard-legal population of the multi-noun conjunction; the 2-noun arity
  //   (Arven ×5) is printed but entirely OUT of Standard. —
  "sv08.5-115": LARRYS_SKILL, // Larry's Skill — discard hand, search a Pokémon + a Supporter + a Basic Energy → hand
  "sv08.5-139": LARRYS_SKILL, // Larry's Skill (reprint)
  "sv06-163": SECRET_BOX, // Secret Box — discard 3 other cards, search an Item + a Tool + a Supporter + a Stadium → hand
  // — 🆕 D337 op-slice: the OTHER multi-noun grammar, and it is D336's inverse —
  //   ONE FLAT cap over a UNION (`anyOf`) where `also` is one cap PER NOUN. 3 legal
  //   printings on 1 card, and `anyOf`'s FIRST consumer on this op (Lana's Aid reads
  //   it through `discardPileRetrieval`, Bug Catching Set through `lookAtTopN`). —
  "sv10-165": ETHANS_ADVENTURE, // Ethan's Adventure — search up to 3 in any combination of Ethan's Pokémon + Basic {R} Energy → hand
  "sv10-221": ETHANS_ADVENTURE, // Ethan's Adventure (reprint)
  "sv10-236": ETHANS_ADVENTURE, // Ethan's Adventure (reprint)
  "sv01-142": REVAVROOM, // Revavroom — Rumbling Engine (discard an Energy card, draw to 6)
  "sv02-105": TINKATON, // Tinkaton — Gather Materials (discard a card, draw 3)
  "swsh10.5-018": RADIANT_BLASTOISE, // Radiant Blastoise — Pump Shot (discard a {W}, 2 counters)
  // — M5 op-slice: the hand cost that is NOT a discard (verified vs the local
  //   catalog 2026-07-21). Dendra pays to the BOTTOM OF THE DECK — the same op,
  //   one field wider; Skwovet reaches the same destination with the WHOLE hand
  //   and needed no new op at all (Iono's handRefresh riders). —
  "sv02-179": DENDRA, // Dendra — a card from hand → deck bottom, then draw to 5
  "sv02-250": DENDRA, // Dendra (reprint)
  "sv02-266": DENDRA, // Dendra (reprint)
  "sv01-151": SKWOVET, // Skwovet — Nest Stash (hand → deck bottom, draw 1 if any moved)
  "sv01-222": SKWOVET, // Skwovet (reprint)
  // — M5 op-slice: attachFromDeck (verified vs the local catalog 2026-07-22).
  //   Search the deck for Energy and attach it; the two printed target rules are
  //   "in any way you like" (Charizard) and "for each of those" (Janine). —
  "sv03-125": CHARIZARD_EX, // Charizard ex — Infernal Reign (onEvolve: up to 3 Basic {R} → your Pokémon)
  "sv03-215": CHARIZARD_EX, // Charizard ex (reprint)
  "sv03-223": CHARIZARD_EX, // Charizard ex (reprint)
  "sv03-228": CHARIZARD_EX, // Charizard ex (reprint)
  "sv06.5-059": JANINES_SECRET_ART, // Janine's Secret Art — up to 2 Basic {D}, one per {D} Pokémon, Active → Poisoned
  "sv06.5-088": JANINES_SECRET_ART, // Janine's Secret Art (reprint)
  // — M5 op-slice: EffectContext.sourceUid (verified vs the local catalog 2026-07-22). —
  "sv01-076": PAWMOT, // Pawmot — Electrogenesis (search a Basic {L} → THIS Pokémon)
  "sv01-209": PAWMOT, // Pawmot (reprint)
  // — M5 op-slice: healChosen "up to N" (verified vs the local catalog 2026-07-22). —
  "sv02-187": SAGUARO, // Saguaro — heal 50 from up to 2 of your Pokémon
  "sv02-255": SAGUARO, // Saguaro (reprint)
  "sv02-270": SAGUARO, // Saguaro (reprint)
  // — P3-M5 long tail: the ALWAYS-ON post-W/R DAMAGE REDUCTIONS (D161), the last
  //   two rows of §D147's 20-printing "after applying Weakness and Resistance"
  //   group. Re-queried against the RESTORED local D1 (2026-08-03, 978 rows /
  //   6 sets) and both are still exactly ONE printing: `from attacks from your
  //   opponent's Pokémon` returns these two rows and nothing else in the catalog. —
  "sv01-192": ROCK_CHESTPLATE, // Rock Chestplate (Tool) — 30 less, gated on the HOLDER's {F}
  "sv02-113": HARIYAMA, // Hariyama — Arm Thrust Practice (10 less, SEAT-WIDE)
  "sv10-086": STONE_PALACE, // Steven's Carbink — Stone Palace (30 less, Steven's only, BENCH SOURCE, DOESN'T STACK)
  "sv07-119": CURLY_WALL, // Bouffalant — Curly Wall (60 less, Basic {C} only, 1 OTHER Bouffalant, DOESN'T STACK)
  "svp-136": CURLY_WALL, // Bouffalant (reprint)
  // ── D243 — the SEAT-WIDE PRE-W/R DAMAGE AURA, backlog row 14-B(b). 7 legal
  //    printings on THREE sentences, verified by `GROUP BY` over
  //    `json_each(abilities_json)` with `legal_standard = 1` against the remote D1
  //    `luminous` on 2026-08-06: 3 · 2 · 2. All seven are printed Pokémon
  //    ABILITIES and every one is §9-suppressible; none is a Tool. —
  "sv10.5b-003": REGAL_CHEER, // Serperior ex — Regal Cheer (20 more, SEAT-WIDE, bare)
  "sv10.5b-156": REGAL_CHEER, // Serperior ex (reprint)
  "sv10.5b-164": REGAL_CHEER, // Serperior ex (reprint)
  "sv10-008": CHEER_ON_TO_GLORY, // Cynthia's Roserade — Cheer On to Glory (30, Cynthia's only)
  "sv10-184": CHEER_ON_TO_GLORY, // Cynthia's Roserade (reprint)
  "svp-184": EXTRA_HELPINGS, // Hop's Snorlax — Extra Helpings (30, Hop's only, DOESN'T STACK)
  "sv09-117": EXTRA_HELPINGS, // Hop's Snorlax (reprint)
  // ── D323 — the §8.1 SEAT-WIDE PRIZE BONUS. Four legal printings on TWO
  //    sentences, and they are the WHOLE legal population of the seam (remote D1
  //    `luminous`, 2026-08-10: `instr(abilities_json,'more Prize') > 0` returns
  //    7 rows / 4 legal, and the other 3 are rotated or read the noun as a board
  //    comparison rather than as a grant). —
  "sv08-072": WONDER_KISS, // Togekiss — Wonder Kiss (+1 Prize, ACTIVE KO only, COIN FLIP, DOESN'T STACK)
  // D324 — the SIXTH and LAST `doesNotStack` Ability, and the row this page
  // called BUILT for three sessions without a key ever existing for it.
  "sv09-037": VIBRANT_DANCE, // Ludicolo — Vibrant Dance (+40 HP SEAT-WIDE, DOESN'T STACK)
  // ── D325 — the §8.1 SELF-SCALING max-HP grants, and they CLOSE the seam: the
  //    bare HP noun over all three columns at HEAD (remote D1 `luminous`,
  //    2026-08-11) is 24 `abilities_json` / 21 `effect` / 5 `attacks_json` legal
  //    rows, every one enumerated and classified, and after these six printings
  //    the difference set is EMPTY. Where D324's six rows are FLAT, all three of
  //    these read the LIVE BOARD — one gated, two multiplied. —
  "sv06-111": OKIDOGI_ADRENA_POWER, // Okidogi — Adrena-Power (+100 HP *and* +100 damage, gated on ANY {D})
  "sv06.5-074": OKIDOGI_ADRENA_POWER, // Okidogi (reprint)
  "sv08.5-057": OKIDOGI_ADRENA_POWER, // Okidogi (reprint)
  "sv10.5b-049": CONKELDURR_CRAFTSMANSHIP, // Conkeldurr — Craftsmanship (+40 HP per attached {F})
  "sv10.5b-127": CONKELDURR_CRAFTSMANSHIP, // Conkeldurr (reprint)
  "sv05-021": BRAMBLEGHAST_RESILIENT_SOUL, // Brambleghast — Resilient Soul (+50 HP per Prize the OPPONENT has taken)
  "sv10.5w-067": GREEDY_EATER, // Hydreigon ex — Greedy Eater (+1 Prize, BASIC KO, by THIS Pokémon's attack)
  "sv10.5w-161": GREEDY_EATER, // Hydreigon ex (reprint)
  "sv10.5w-169": GREEDY_EATER, // Hydreigon ex (reprint)
  // D245 — the aura family's three deferred singles, one printing each.
  "sv09-007": SUNNY_DAY, // Lilligant — Sunny Day (20, {G} OR {R} — the anyOf)
  "sv08-021": VICTORY_CHEER, // Victini — Victory Cheer (10, Evolution {R})
  "sv07-038": PRIMAL_KNOWLEDGE, // Carracosta — Primal Knowledge (30, TARGET Evolution)
  // D245 — the `stage: "evolution"` widening's OTHER sentence, which no row named.
  "sv10.5b-067": METALLIC_SIGNAL, // Genesect ex — Metallic Signal (deck → hand, 2 Evolution {M})
  "sv10.5b-161": METALLIC_SIGNAL, // Genesect ex (reprint)
  "sv10.5b-169": METALLIC_SIGNAL, // Genesect ex (reprint)
  // ── D190 — THE **STANDARD-LEGAL** REPRINT-ALIAS MAP (Tier 0 of
  //    `docs/reference/coverage-backlog-legal.md`). 22 printings, 9 map targets,
  //    ZERO new code: every row below prints a sentence that is already authored
  //    on a registered id, byte-for-byte.
  //
  //    ⚠️ MEASURED, NOT CARRIED. The text-equality sweep of unbuilt-against-built
  //    was RE-RUN against the REMOTE D1 `luminous`
  //    (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 3,786 rows / 20 sets) on
  //    2026-08-04, PER COLUMN — `abilities_json` and `effect` each joined against
  //    the built texts of the ids whose program reads THAT column, which is
  //    D180's per-column read predicate rather than a bare `programFor(id)`
  //    exists. It reproduced the census exactly: 9 sentences, 22 legal printings,
  //    and NOTHING ELSE across all three columns (`attacks_json` returns one
  //    group — Hail Blade's text on two rotated rows — and **zero** legal ones).
  //
  //    ⚠️ AND THE POINT D180 MISSED: EVERY ROW HERE CARRIES A MEASURED **LEGAL**
  //    PRINTING COUNT. D180's four aliases are all rotated (`sv02`/`swsh10.5`,
  //    marks G/F) and serve zero Standard-legal printings; a registry row is
  //    keyed by CARD ID and serves exactly the ids it names, so legality is a
  //    HARD filter here in a way it never is for a deriver arm. Candidate
  //    sentences whose legal count measured **0** were SKIPPED — see
  //    `reprintAliasLegal.test.ts` for the four that were.
  // — "This Pokémon takes 30 less damage from attacks (after applying Weakness
  //   and Resistance)." — 8 legal printings (14 in the whole catalog). —
  "sv06-002": COPPERAJAH_EX, // Tangrowth — "Thicket Body" (mark H)
  "sv07-125": COPPERAJAH_EX, // Dubwool — "Soft Wool" (mark H)
  "sv08-054": COPPERAJAH_EX, // Cetitan — "Solid Body" (mark H)
  "sv08-201": COPPERAJAH_EX, // Cetitan (reprint)
  "sv10-108": COPPERAJAH_EX, // Mudsdale — "Mud Coat" (mark I)
  "sv10.5w-077": COPPERAJAH_EX, // Bouffalant ex — "Bouffer" (mark I)
  "sv10.5w-162": COPPERAJAH_EX, // Bouffalant ex (reprint)
  "sv10.5w-170": COPPERAJAH_EX, // Bouffalant ex (reprint)
  // — "This Pokémon takes 20 less damage …" — 2 legal printings (2 in the
  //   catalog). Both `sv01-121` Stonjourner and `sv03-174` Bouffalant already
  //   carry this text; STONJOURNER is the anchor named by the census. —
  "sv05-010": STONJOURNER, // Turtwig — "Solid Shell" (mark H)
  "sv08.5-088": STONJOURNER, // Furfrou — "Fur Coat" (mark H)
  // — "If this Pokémon is in the Active Spot and is damaged by an attack from
  //   your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage
  //   counters on the Attacking Pokémon." — 3 legal printings (4 in the catalog). —
  "sv05-139": COUNTERATTACK_QUILLS, // Iron Jugulis — "Automated Combat" (mark H)
  "sv08-049": COUNTERATTACK_QUILLS, // Bruxish — "Counterattack" (mark H)
  "sv08-200": COUNTERATTACK_QUILLS, // Bruxish (reprint)
  // — the same antecedent with a BURN consequent — 1 legal printing (1 in the
  //   catalog); the trigger, not the passive. —
  "sv06-123": SCORCHING_ARMOR, // Heatran — "Incandescent Body" (mark H)
  // — "All of your Pokémon take 10 less damage from attacks from your opponent's
  //   Pokémon (after applying Weakness and Resistance)." — 1 legal printing. —
  "sv08.5-067": HARIYAMA, // Bronzong — "Protective Bell" (mark H)
  // — Trainers. "Draw 3 cards." — 3 legal printings (6 in the catalog), on two
  //   card NAMES that are neither of them Nemona: the sentence is the key, not
  //   the name. —
  "sv08.5-109": NEMONA, // Friends in Paldea (Supporter, mark H)
  "sv08.5-137": NEMONA, // Friends in Paldea (reprint)
  "sv10.5w-081": NEMONA, // Cheren (Supporter, mark I)
  // — Janine's Secret Art — 2 legal printings beyond the two already authored. —
  "sv08.5-112": JANINES_SECRET_ART, // Janine's Secret Art (mark H)
  "sv08.5-173": JANINES_SECRET_ART, // Janine's Secret Art (reprint)
  // — Energy Retrieval — 1 legal printing. —
  "sv10.5w-082": ENERGY_RETRIEVAL, // Energy Retrieval (Item, mark I)
  // — Pokégear 3.0 — 1 legal printing. —
  "sv10.5b-084": POKEGEAR, // Pokégear 3.0 (Item, mark I)
  // ── D190 — TIER 1's REGISTRY-ONLY PROGRAMS. 11 Standard-legal printings over
  //    three programs whose every op already exists (see the consts above). —
  "sv05-008": POISON_POINT, // Roselia — "Poison Point" (mark H)
  "sv05-009": POISON_POINT, // Roserade — "Poison Point" (mark H)
  "sv10.5b-056": POISON_POINT, // Scolipede — "Poison Point" (mark I)
  "sv10.5b-134": POISON_POINT, // Scolipede (reprint)
  "sv09-098": NS_ZOROARK_EX, // N's Zoroark ex — "Trade" (mark H)
  "sv09-175": NS_ZOROARK_EX, // N's Zoroark ex (reprint)
  "sv09-185": NS_ZOROARK_EX, // N's Zoroark ex (reprint)
  "sv09-189": NS_ZOROARK_EX, // N's Zoroark ex (reprint)
  "sv07-107": METAL_BRIDGE, // Archaludon — "Metal Bridge" (mark H)
  "sv07-155": METAL_BRIDGE, // Archaludon (reprint)
  "sv08.5-070": METAL_BRIDGE, // Archaludon (mark H)
  // FIXTURE demonstrators — synthetic `fix-*` bodies (never catalog rows) that
  // carry the three programs above so `registryOnlyPrograms.test.ts` can DRIVE
  // each one through the real engine. The eleven printings cannot be fielded
  // themselves: a fixture id naming a real printing must appear in
  // `catalogManifest.ts`, which is generated off the LOCAL sqlite — absent in
  // this clone, and measuring a 978-row / 6-set catalog that holds none of
  // `sv05`/`sv07`/`sv08.5`/`sv09`/`sv10.5b` anyway.
  "fix-poisonpoint": POISON_POINT,
  "fix-trade": NS_ZOROARK_EX,
  "fix-metalbridge": METAL_BRIDGE,
  // ── D199 — THE DERIVED REGISTRY-ONLY SWEEP. 28 programs / 47 Standard-legal
  //    printings, every id below verified against the remote D1 `luminous`
  //    (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 3,786 rows / 20 sets) on
  //    2026-08-04: each group returned `legal_standard = 1` on EVERY id, exactly
  //    ONE distinct printed sentence and exactly ONE card name, so no group below
  //    is silently two cards sharing an object. Marks H and I only.
  //
  //    Ranked by legal printings, largest first — the order the census produced
  //    and the order they were built in. ──
  // — 4 printings: the biggest row in the slice. —
  "sv10-122": TEAM_ROCKETS_CROBAT_EX, // T.R.'s Crobat ex — "Biting Spree" + 🆕 D313 "Assassin's Return"
  "sv10-217": TEAM_ROCKETS_CROBAT_EX, // (reprint)
  "sv10-234": TEAM_ROCKETS_CROBAT_EX, // (reprint)
  "sv10-242": TEAM_ROCKETS_CROBAT_EX, // (reprint)
  // — 3 printings each. —
  "svp-118": ATTRACT_CUSTOMERS, // Tatsugiri — "Attract Customers" (promo, mark H)
  "sv06-131": ATTRACT_CUSTOMERS, // (reprint)
  "sv06-186": ATTRACT_CUSTOMERS, // (reprint)
  "sv09-031": SCALDING_STEAM, // Volcanion ex — "Scalding Steam" (mark I)
  "sv09-171": SCALDING_STEAM, // (reprint)
  "sv09-182": SCALDING_STEAM, // (reprint)
  "sv08-004": SUDDEN_SHEARING, // Durant ex — "Sudden Shearing" (mark H)
  "sv08-215": SUDDEN_SHEARING, // (reprint)
  "sv08-236": SUDDEN_SHEARING, // (reprint)
  // — 2 printings each. —
  "sv08-009": CALMING_LIGHT, // Shiinotic — "Calming Light" (mark H)
  "sv08-194": CALMING_LIGHT, // (reprint)
  "sv10.5w-013": INFERNO_FANDANGO, // Emboar — "Inferno Fandango" (mark I)
  "sv10.5w-098": INFERNO_FANDANGO, // (reprint)
  "sv06-148": ENHANCED_HAMMER, // Enhanced Hammer (Item, mark H)
  "sv06-224": ENHANCED_HAMMER, // (reprint)
  "sv10.5b-082": FENNEL, // Fennel (Supporter, mark I)
  "sv10.5b-162": FENNEL, // (reprint)
  "sv08-167": CLEMONTS_QUICK_WIT, // Clemont's Quick Wit (Supporter, mark I)
  "sv08-229": CLEMONTS_QUICK_WIT, // (reprint)
  "sv08-243": CLEMONTS_QUICK_WIT, // (reprint)
  "sv08-076": SKYLINER, // Latias ex — "Skyliner" (Ability, mark H) — D267
  "sv08-220": SKYLINER, // Latias ex (special illustration rare) — same sentence
  "sv08-239": SKYLINER, // Latias ex (hyper rare) — same sentence
  // D268 — `handRefresh.who: "opponent"`, the union's third member. A PROMO and a
  // SET printing of the same card rather than an alternate-art pair.
  "svp-211": DISTORTED_FUTURE, // Gothitelle — "Distorted Future" (Ability, promo)
  "sv10.5w-043": DISTORTED_FUTURE, // Gothitelle (set printing) — same sentence
  // D269 — `coinFlipGate.otherwise`, the printed "If tails, …". 2 programs / 3
  // Standard-legal printings on 2 sentences, both on the TRAINER surface. The
  // three ids were re-queried against the remote D1 `luminous` on 2026-08-07:
  // all `legal_standard = 1`, Picnicker one sentence under one name, Drasna the
  // same sentence twice under one name.
  "svp-114": PICNICKER, // Picnicker (Supporter, mark H) — flip: draw 4, else draw 2
  "sv08-173": DRASNA, // Drasna (Supporter, mark I) — shuffle-and-draw 8, else 3
  "sv08-231": DRASNA, // Drasna (alternate art) — same sentence
  // D270 — `HandRefreshDraw.perSeat`, the printed "you draw N cards, and your
  // opponent draws M cards". 1 program / 2 Standard-legal printings on ONE
  // sentence, on the TRAINER surface. Both ids were re-queried against the remote
  // D1 `luminous` on 2026-08-07: `legal_standard = 1`, `trainer_type = Supporter`,
  // one byte-identical sentence under one name.
  "sv10.5w-083": HARLEQUIN, // Harlequin (Supporter, mark I) — 5/3 on heads, 3/5 on tails
  "sv10.5w-163": HARLEQUIN, // Harlequin (alternate art) — same sentence
  // D271 — the last-turn-KO play gate (`yourPokemonKoedOnOpponentsLastTurn`).
  // 2 programs / 3 Standard-legal printings on ONE printed sentence, on the
  // TRAINER surface. All three ids were re-queried against the remote D1
  // `luminous` on 2026-08-07: `legal_standard = 1`, and the `trainer_type`s
  // DIFFER (Item / Supporter / Supporter), which is the point — the gate is a
  // vocabulary, not a rider on one card's second half.
  // 🆕 D326 — and Team Rocket's Archer's OWNER-PREFIXED narrowing of the same
  // gate lands here too, taking the family to 3 programs / 5 legal printings.
  "sv06-165": UNFAIR_STAMP, // Unfair Stamp (Item, mark H) — gate + 5/2 perSeat refresh
  "sv06-151": HASSEL, // Hassel (Supporter, mark H) — gate + lookAtTopN 8/3
  "sv06-205": HASSEL, // Hassel (full art) — same sentence
  "sv10-170": TEAM_ROCKETS_ARCHER, // Team Rocket's Archer (Supporter, mark I) — owner-gated 5/3
  "sv10-223": TEAM_ROCKETS_ARCHER, // (alternate art) — byte-identical effect
  "sv06.5-061": NIGHT_STRETCHER, // Night Stretcher (Item, mark H)
  "sv08-251": NIGHT_STRETCHER, // (reprint)
  "sv08-171": DEDUCTION_KIT, // Deduction Kit (Item, mark H) — 1 legal printing of 1
  "sv07-138": KOFU, // Kofu (Supporter, mark H)
  "sv07-165": KOFU, // (reprint)
  "sv05-154": MAXIMUM_BELT, // Maximum Belt (Tool, mark H)
  "sv08.5-117": MAXIMUM_BELT, // (reprint)
  "sv06.5-055": BINDING_MOCHI, // Binding Mochi (Tool, mark H)
  "sv08.5-095": BINDING_MOCHI, // (reprint)
  "sv09-150": LEVINCIA, // Levincia (Stadium, mark I)
  "sv10-244": LEVINCIA, // (reprint)
  "sv09-159": SPIKY_ENERGY, // Spiky Energy (Special Energy, mark I)
  "sv09-190": SPIKY_ENERGY, // (reprint)
  // D261 — THE SPECIAL ENERGY COLUMN's two cheapest remaining rows. The column
  // census (remote D1 `luminous` `735f0fb5-cdc3-494d-8b97-74a8ade0124a`,
  // `legal_standard = 1`, `category='Energy' AND energy_type='Special'`, GROUPED BY
  // `effect`, 2026-08-07) is 7 sentences / 8 printings, of which Spiky's 2 were
  // already built. These are 1 + 1 on TWO sentences; the four left are named, with
  // their blockers, in `mistEnergy.test.ts`'s header.
  "sv05-161": MIST_ENERGY, // Mist Energy — the effects-only shield, borne by an ENERGY
  "sv08-191": ENRICHING_ENERGY, // Enriching Energy — draw 4 on attach from hand
  // FIXTURE demonstrators — `fix-spherical`'s reason verbatim: the manifest holds
  // no `sv05`/`sv08` Energy row, and the manifest generator cannot run (§ the
  // top-of-file note in progress.md), so a REAL-id fixture may not be added.
  "fix-mist-energy": MIST_ENERGY,
  "fix-enriching-energy": ENRICHING_ENERGY,
  // 🆕 D262 — the column's THIRD row in two slices. Re-derived from the SAME
  // column query above (not a ladder — D261 closed the column): 7 sentences / 8
  // printings legal, 4 built at HEAD, this is the 5th. The three left are
  // `sv06-166`, `sv06-167` and `sv10-182`, each still named with its blocker in
  // `mistEnergy.test.ts`'s header.
  "sv05-162": NEO_UPPER_ENERGY, // Neo Upper Energy — the CONDITIONAL provision (Stage 2)
  "fix-neo-upper-energy": NEO_UPPER_ENERGY,
  "sv10.5b-086": PRISM_ENERGY, // 🆕 D300 — Prism Energy — the SAME shape, gated on Basic
  "fix-prism-energy": PRISM_ENERGY,
  // 🆕 D302 — Reversal Energy `sv04-266`, the family's LAST unbuilt printing and
  // the same shape behind a THREE-TERM antecedent (Evolution + no Rule Box +
  // more Prizes remaining). 2 printings, 1 legal — `sv02-192` is not Standard.
  "sv04-266": REVERSAL_ENERGY,
  "fix-reversal-energy": REVERSAL_ENERGY,
  // 🆕 D298 — the SAME PRINTED SENTENCE on two attach classes, and the column's
  // FIRST movement since D262. `instr(effect,'fewer Prize') > 0 AND
  // legal_standard = 1` (remote D1 `luminous`, 2026-08-09) returns 9 rows: these
  // two, plus Lacey ×5 and Emcee's Hype ×2 printing an unrelated *"3 or fewer
  // Prize cards remaining"* board condition. So the family CLOSES at 2 of 2.
  // The two `fix-*` demonstrators are `fix-mist-energy`'s reason verbatim: the
  // committed manifest holds sv01/sv02/sv03/sv06.5 rows only — no `sv06` and no
  // `sv09` at all — and the manifest generator cannot run in this clone.
  "sv06-167": LEGACY_ENERGY, // Legacy Energy (ACE SPEC Special Energy, mark H)
  "fix-legacy-energy": LEGACY_ENERGY,
  "sv09-151": LILLIES_PEARL, // Lillie's Pearl (Pokémon Tool, mark I)
  "fix-lillies-pearl": LILLIES_PEARL,
  // — 1 printing each. Cheap because each is a re-parameterisation of a program
  //   already above; kept because a registry row is keyed by id and a printing
  //   nobody names stays unsimulated forever. —
  "sv10-121": SNEAKY_BITE, // Team Rocket's Golbat — "Sneaky Bite" (mark I)
  "sv09-136": DEFIANT_HORN, // Hop's Dubwool — "Defiant Horn" (mark I)
  "sv09-024": SEETHING_SPIRIT, // Blaziken ex — "Seething Spirit" (mark H)
  // D263 — the ability half of backlog row 9 (attach from the DISCARD PILE).
  "sv10-020": CHARGING_UP, // Team Rocket's Spidops — "Charging Up" (mark I)
  "sv10-187": CHARGING_UP, // (reprint)
  "sv10.5b-031": DYNAMOTOR, // Eelektrik — "Dynamotor" (mark I)
  "sv10.5b-114": DYNAMOTOR, // (reprint)
  "sv08-130": ASSEMBLE_ALLOY, // Archaludon ex — "Assemble Alloy" (mark H)
  "sv08-224": ASSEMBLE_ALLOY, // (reprint)
  "sv08-241": ASSEMBLE_ALLOY, // (reprint)
  "sv09-075": CONFECTIONARY_GIFT, // Alcremie ex — "Confectionary Gift" (mark H)
  "sv08.5-077": INSOMNIA, // Hoothoot — "Insomnia" (mark H)
  "sv10-155": RECONSTITUTE, // Team Rocket's Porygon-Z — "Reconstitute" (mark I)
  "sv08-052": UP_TEMPO, // Quaquaval — "Up-Tempo" (mark H)
  "sv08.5-116": MAX_ROD, // Max Rod (Item, mark H)
  "sv08-183": MIRACLE_HEADSET, // Miracle Headset (Item, mark H)
  "sv10-164": ENERGY_RECYCLER, // Energy Recycler (Item, mark I)
  "sv10-168": SACRED_ASH, // Sacred Ash (Item, mark I)
  "sv05-153": MASTER_BALL, // Master Ball (Item, mark H)
  "sv08.5-131": TREASURE_TRACKER, // Treasure Tracker (Item, mark H)
  "sv06.5-058": DANGEROUS_LASER, // Dangerous Laser (Item, mark H)
  // D264 — the ABILITY and TRAINER halves of backlog row 13 (the discard pile
  // into the hand), the two sentences of its residue that a `CardFilter` rider
  // reaches. What is left of the row is Alomomola's HP threshold.
  "sv06-155": LANAS_AID, // Lana's Aid (Supporter, mark H)
  "sv06-207": LANAS_AID, // (reprint)
  "sv06-219": LANAS_AID, // (reprint)
  "sv10-159": GREEDY_ORDER, // Arven's Greedent — "Greedy Order" (mark I)
  "sv10-205": GREEDY_ORDER, // (reprint)
  // D265 — the HP-THRESHOLD `CardFilter` rider (`basicPokemon.maxHp`), the last
  // thing standing between backlog row 13's residue and the deck-search family.
  // FIVE legal printings on TWO sentences across TWO OPS, on one union rider.
  "sv05-144": BUDDY_BUDDY_POFFIN, // Buddy-Buddy Poffin (Item, mark G→H reprint chain)
  "sv06-223": BUDDY_BUDDY_POFFIN, // (reprint)
  "sv08.5-101": BUDDY_BUDDY_POFFIN, // (reprint)
  "sv10.5b-024": GENTLE_FIN, // Alomomola — "Gentle Fin" (mark I)
  "sv10.5b-108": GENTLE_FIN, // (reprint)
  // FIXTURE demonstrators — synthetic `fix-*` bodies (never catalog rows) that
  // carry the 28 programs so `legalNonAttackPrograms.test.ts` can DRIVE each one
  // through the real engine. D190's idiom and D190's reason: a fixture id naming
  // a real printing must appear in `catalogManifest.ts`, which is generated off
  // the LOCAL sqlite — absent in this clone (`SQLITE_CANTOPEN`) and measuring a
  // 978-row / 6-set catalog that holds none of sv05 / sv07 / sv08 / sv08.5 /
  // sv09 / sv10 / sv10.5b / sv10.5w / svp anyway. `createGame` takes its
  // `cardPool` as a PARAMETER, so the demonstrator pool stays local to the suite
  // and `FIXTURE_POOL` is not touched.
  "fix-bitingspree": TEAM_ROCKETS_CROBAT_EX,
  "fix-sneakybite": SNEAKY_BITE,
  "fix-attractcustomers": ATTRACT_CUSTOMERS,
  "fix-scaldingsteam": SCALDING_STEAM,
  "fix-captivatinginvitation": CAPTIVATING_INVITATION,
  // 🆕 D331 — and this key is NOT decoration. `lisiasAppeal.test.ts` plays the
  // card off `FIXTURE_POOL`, so without a demonstrator row every board in that
  // suite dies on `TRAINER_NOT_SIMULATED` — which is exactly how this omission
  // was found, the three `sv08` keys being green and the printed fixture dead.
  // D330's finding one turn further on: a program can be reachable from the
  // catalog and still unreachable from the only pool the tests own.
  "fix-lisiasappeal": LISIAS_APPEAL,
  // 🆕 D332 — the same rule, applied without having to be taught it again:
  // `draytonWindow.test.ts` plays the Supporter off `FIXTURE_POOL`, so the four
  // `sv08` keys below are useless to it and this one is what the boards run on.
  "fix-drayton": DRAYTON,
  // 🆕 D333 — the same rule again: `rotoStick.test.ts` and `bugCatchingSet.test.ts`
  // play their Items off `FIXTURE_POOL`, and the generated manifest holds no
  // `sv06` or `sv08.5` row, so these two are what the boards actually run on.
  "fix-rotostick": ROTO_STICK,
  "fix-bugcatchingset": BUG_CATCHING_SET,
  // 🆕 D334 — the same rule a third time: `explorersGuidance.test.ts` plays the
  // Supporter off `FIXTURE_POOL` and the manifest holds no `sv05` row either.
  "fix-explorersguidance": EXPLORERS_GUIDANCE,
  // 🆕 D335 — TWO demonstrators for two cards, and the Pokémon owes one where
  // D327's rule says a Pokémon usually does not. The reason is not the surface but
  // the SET: `catalogManifest.test.ts` classifies every real-looking fixture id
  // against a generated manifest of six sets, and neither `sv06` nor `sv04` is one
  // of them — so both bodies are keyed `fix-*` exactly as D334's `sv05` Supporter
  // was. This is why `raw.length` steps by TWO more than the catalog ids do.
  "fix-drakloak": DRAKLOAK,
  "fix-rika": RIKA,
  // 🆕 D336 — the same rule a fifth time, and for the SAME reason as D333's two:
  // `larrysSkill.test.ts` plays both Trainers off `FIXTURE_POOL`, and the
  // generated manifest holds neither an `sv08.5` nor an `sv06` row, so these are
  // the keys the boards actually run on. THE KEY IS THE SET, NOT THE SURFACE.
  "fix-larrysskill": LARRYS_SKILL,
  "fix-secretbox": SECRET_BOX,
  // 🆕 D337 — the same rule a sixth time: `ethansAdventure.test.ts` plays the
  // Supporter off `FIXTURE_POOL`, and the generated manifest holds no `sv10` row —
  // so this is the key the boards actually run on. ONE card, so ONE key, where D333,
  // D335 and D336 each owed two. THE KEY IS THE SET, NOT THE SURFACE.
  "fix-ethansadventure": ETHANS_ADVENTURE,
  "fix-trainersearch": TRAINER_SEARCH,
  "fix-calminglight": CALMING_LIGHT,
  "fix-suddenshearing": SUDDEN_SHEARING,
  "fix-defianthorn": DEFIANT_HORN,
  "fix-infernofandango": INFERNO_FANDANGO,
  "fix-seethingspirit": SEETHING_SPIRIT,
  "fix-chargingup": CHARGING_UP,
  "fix-dynamotor": DYNAMOTOR,
  "fix-assemblealloy": ASSEMBLE_ALLOY,
  "fix-confectionarygift": CONFECTIONARY_GIFT,
  "fix-insomnia": INSOMNIA,
  "fix-reconstitute": RECONSTITUTE,
  "fix-uptempo": UP_TEMPO,
  "fix-enhancedhammer": ENHANCED_HAMMER,
  "fix-fennel": FENNEL,
  "fix-clemontsquickwit": CLEMONTS_QUICK_WIT,
  "fix-nightstretcher": NIGHT_STRETCHER,
  "fix-maxrod": MAX_ROD,
  "fix-miracleheadset": MIRACLE_HEADSET,
  "fix-energyrecycler": ENERGY_RECYCLER,
  "fix-sacredash": SACRED_ASH,
  "fix-masterball": MASTER_BALL,
  "fix-treasuretracker": TREASURE_TRACKER,
  "fix-dangerouslaser": DANGEROUS_LASER,
  "fix-kofu": KOFU,
  "fix-maximumbelt": MAXIMUM_BELT,
  "fix-bindingmochi": BINDING_MOCHI,
  "fix-levincia": LEVINCIA,
  "fix-spikyenergy": SPIKY_ENERGY,
  "fix-lanasaid": LANAS_AID, // D264
  "fix-greedyorder": GREEDY_ORDER, // D264
  "fix-buddybuddypoffin": BUDDY_BUDDY_POFFIN, // D265
  "fix-gentlefin": GENTLE_FIN, // D265
  "fix-skyliner": SKYLINER, // D267
  "fix-distortedfuture": DISTORTED_FUTURE, // D268
  "fix-picnicker": PICNICKER, // D269
  "fix-drasna": DRASNA, // D269
  "fix-harlequin": HARLEQUIN, // D270
  "fix-unfairstamp": UNFAIR_STAMP, // D271
  "fix-hassel": HASSEL, // D271
  "fix-archer": TEAM_ROCKETS_ARCHER, // 🆕 D326 — the OWNER-PREFIXED gate at 5/3
  "fix-stamp": UNFAIR_STAMP, // 🆕 D326 — the 5/2 sibling, on ONE board with the above

  // D200 — the owner-prefix subgroup rows (5 programs / 6 Standard-legal
  // printings). Real ids first, then their `fix-*` demonstrators, D190's idiom.
  "sv10-103": CHAMPIONS_CALL, // Cynthia's Gabite — "Champion's Call" (Ability, mark I)
  "sv10-050": SWIM_TOGETHER, // Misty's Lapras — "Swim Together" (attack 0, mark I)
  "sv10-194": SWIM_TOGETHER, // Misty's Lapras (illustration rare) — same sentence
  "sv09-147": HOPS_BAG, // Hop's Bag (Item, mark I)
  "sv10-083": SUMMONING_SIGN, // Steven's Baltoy — "Summoning Sign" (attack 0, mark I)
  "sv09-068": LILLIES_COMFEY, // Lillie's Comfey — "Inviting Flowers" (attack 0) + 🆕 D313 "Fade Out" (attack 1)
  "fix-championscall": CHAMPIONS_CALL,
  "fix-swimtogether": SWIM_TOGETHER,
  "fix-hopsbag": HOPS_BAG,
  "fix-summoningsign": SUMMONING_SIGN,
  "fix-invitingflowers": LILLIES_COMFEY,
  // D204 — the IN-PLAY TARGET rider (4 programs / 8 Standard-legal printings).
  // Spikemuth Gym needs only D200's CARD filter; the other three are the first
  // writers of `AttachTargetRiders.ownerPokemon`, across BOTH attach ops.
  "sv10-169": SPIKEMUTH_GYM, // Spikemuth Gym (Stadium, mark I) — nothing new
  "sv09-053": IONOS_BELLIBOLT_EX, // Iono's Bellibolt ex — "Electric Streamer"
  "sv09-172": IONOS_BELLIBOLT_EX, // Iono's Bellibolt ex (reprint)
  "sv09-183": IONOS_BELLIBOLT_EX, // Iono's Bellibolt ex (reprint)
  "sv09-188": IONOS_BELLIBOLT_EX, // Iono's Bellibolt ex (reprint)
  "svp-194": IONOS_BELLIBOLT_EX, // Iono's Bellibolt ex (promo)
  "sv09-153": NS_PP_UP, // N's PP Up (Item, mark I)
  "sv10-136": MARNIES_GRIMMSNARL_EX, // Marnie's Grimmsnarl ex — "Punk Up"
  "fix-spikemuthgym": SPIKEMUTH_GYM,
  "fix-electricstreamer": IONOS_BELLIBOLT_EX,
  "fix-nsppup": NS_PP_UP,
  "fix-punkup": MARNIES_GRIMMSNARL_EX,
  // D205 — the SAME-TARGET attach count (1 program / 4 Standard-legal printings).
  // Team Rocket's Wobbuffet's counter move, the slice's other landed row, needs
  // NO registry entry: its sentence is read by the widened
  // `COUNTER_MOVE_TO_DEFENDER` anchor (effects.ts), which is the deriver path and
  // not this one.
  "sv10-039": ETHANS_HO_OH_EX, // Ethan's Ho-Oh ex — "Golden Flame"
  "sv10-209": ETHANS_HO_OH_EX, // Ethan's Ho-Oh ex (reprint)
  "sv10-230": ETHANS_HO_OH_EX, // Ethan's Ho-Oh ex (reprint)
  "sv10-239": ETHANS_HO_OH_EX, // Ethan's Ho-Oh ex (reprint)
  "fix-goldenflame": ETHANS_HO_OH_EX,
  // D207 — the OPPONENT'S REMAINING-PRIZE gate (2 programs / 7 Standard-legal
  // printings, and ZERO new engine code: `opponentPrizesRemaining` was already
  // in the union and already folded in both consumers). No `fix-*` demonstrator
  // rows — every claim in `opponentPrizeGate.test.ts` is driven through a REAL
  // printed id, so a look-alike would only be a second name for the same program.
  "sv07-139": LACEY, // Lacey — shuffle hand into deck, draw 4 (8 instead if opp ≤ 3 Prizes)
  "sv07-166": LACEY, // Lacey (reprint)
  "sv07-172": LACEY, // Lacey (reprint)
  "sv08.5-114": LACEY, // Lacey (reprint)
  "sv08.5-175": LACEY, // Lacey (reprint)
  "sv10-163": EMCEES_HYPE, // Emcee's Hype — draw 2, +2 more if opp has ≤ 3 Prizes left
  "sv10-220": EMCEES_HYPE, // Emcee's Hype (reprint)
  // D221 — TEAL DANCE. 1 program / **8 Standard-legal printings**, the largest
  // single row landed on this branch and the top of the ranked backlog. The eight
  // ids are `coverage-backlog-legal.md`'s own enumeration (D219, measured against
  // the remote D1 `luminous` on 2026-08-04), carried rather than re-queried —
  // ⚠️ SAID OUT LOUD BECAUSE THIS PAGE'S OWN RULE IS THAT CARRIED IDS ROT (D206's
  // wrong-row failure, D219's four corrections to D187). The network policy
  // refuses `api.tcgdex.net` and this session has no D1 access, so a re-query was
  // not available; what IS asserted instead is the shape a wrong id would break —
  // `tealDance.test.ts` drives every one of the eight through `programFor`, so a
  // typo'd or duplicated id fails loudly rather than silently serving nothing.
  "svp-166": TEAL_DANCE, // Teal Mask Ogerpon ex — "Teal Dance" (promo, mark H)
  "sv06-025": TEAL_DANCE, // Teal Mask Ogerpon ex (mark H)
  "sv06-190": TEAL_DANCE, // (reprint)
  "sv06-211": TEAL_DANCE, // (reprint)
  "sv06-221": TEAL_DANCE, // (reprint)
  "sv08.5-012": TEAL_DANCE, // Teal Mask Ogerpon ex (mark H)
  "sv08.5-145": TEAL_DANCE, // (reprint)
  "sv08.5-177": TEAL_DANCE, // (reprint)
  // FIXTURE demonstrator — D190's idiom and D190's reason (the manifest is
  // generated off a local sqlite this clone does not have, and holds none of
  // `svp`/`sv06`/`sv08.5` anyway), so the eight printings above cannot be fielded
  // and a synthetic body carries the program instead.
  "fix-tealdance": TEAL_DANCE,
  // D249 — RIPENING CHARGE. 1 program / **4 Standard-legal printings**, the
  // ability half of backlog row 12 and the sentence that page ranks as the
  // cheapest single program left in the pool. ⚠️ THE FOUR IDS WERE RE-QUERIED
  // AGAINST THE REMOTE D1 `luminous` ON 2026-08-07, NOT CARRIED — the query was
  // run on the SHAPE (`LIKE '%if you attached energy to a pok%in this way%'`
  // over `json_each(abilities_json)` / `json_each(attacks_json)` / `effect`,
  // `legal_standard = 1`, GROUPED BY SENTENCE) rather than on these ids, and it
  // returns exactly these four and no others. The same sweep names the two
  // sentences that are NOT this one: the 8-printing Teal Dance group above
  // (same clause, `draw a card` tail) and a 3-printing DECK-search attack
  // (`sv06.5-036`/`-082`/`-090`) whose tail is a status, not a heal.
  "sv07-014": RIPENING_CHARGE, // Hydrapple ex — "Ripening Charge" (mark H)
  "sv07-156": RIPENING_CHARGE, // (reprint)
  "sv07-167": RIPENING_CHARGE, // (reprint)
  "sv08.5-011": RIPENING_CHARGE, // (reprint)
  // FIXTURE demonstrator — D190's idiom and D190's reason (the manifest is
  // generated off a local sqlite this clone does not have, and holds none of
  // `sv07`/`sv08.5` anyway), so the four printings above cannot be fielded and a
  // synthetic body carries the program instead.
  "fix-ripening": RIPENING_CHARGE,
  // D250 — BATTLE-HARDENED. 1 program / **2 Standard-legal printings on ONE
  // sentence**, the triggered-attach third of backlog row 12's ability half. The
  // ids are the SENTENCE's, re-derived on the shape (`LIKE '%when you play this
  // pok%onto your bench%attach%'` over all three text columns with `json_each`,
  // `legal_standard = 1`, GROUPED BY SENTENCE — remote D1 `luminous`, 2026-08-07)
  // and not carried from the row. The same sweep's ONLY other hit on that shape
  // is `sv06-132`, a Pokémon-Tool DECK search on the same opening — a different
  // mechanism, named here rather than left as a claim. Both cards below are
  // Bloodmoon Ursaluna and are byte-identical, so no `fix-` demonstrator is owed:
  // `sv06.5-025` has been in `FIXTURE_POOL` since D168 with this Ability carried
  // verbatim and declared UNSIMULATED, and this row is what retires that word.
  "sv06.5-025": BATTLE_HARDENED, // Bloodmoon Ursaluna — "Battle-Hardened" (mark H)
  "sv08.5-054": BATTLE_HARDENED, // (reprint, byte-identical)
  // D222 — FLASHING DRAW. 1 program / **3 Standard-legal printings**, row 3 of
  // the ranked backlog and the second of D190's `DROPPED` rows collected. The
  // three ids are `registryOnlyPrograms.test.ts`'s own `DROPPED` enumeration
  // (D190, measured against the remote D1 `luminous` on 2026-08-04), carried
  // rather than re-queried — ⚠️ SAID OUT LOUD BECAUSE THIS REPO'S RULE IS THAT
  // CARRIED IDS ROT (D206's wrong-row failure). The network policy refuses
  // `api.tcgdex.net` and this session has no D1 access, so what is asserted
  // instead is the shape a wrong id would break: `flashingDraw.test.ts` drives
  // every one of the three through `programFor`, and the same three are asserted
  // to have LEFT the `DROPPED` table, so a typo'd id fails on both sides.
  "svp-182": FLASHING_DRAW, // Iono's Kilowattrel — "Flashing Draw" (promo, mark I)
  "sv09-055": FLASHING_DRAW, // Iono's Kilowattrel (mark I)
  "sv09-163": FLASHING_DRAW, // (reprint)
  // FIXTURE demonstrator — D190's idiom and D190's reason (the manifest is
  // generated off a local sqlite this clone does not have, and holds none of
  // `svp`/`sv09` anyway).
  "fix-flashingdraw": FLASHING_DRAW,
  // D223 — Carmine, all FOUR Standard-legal printings (sv06 ×3 + the sv08.5
  // reprint), plus the FIXTURE demonstrator: `catalogManifest.ts` is generated off
  // a local sqlite this clone does not have and measures a 978-row / 6-set catalog
  // holding neither sv06 nor sv08.5, so the real ids cannot be fielded.
  // D280 — Call Bell, the ONE Standard-legal printing plus the FIXTURE
  // demonstrator, for Carmine's manifest reason verbatim: the 978-row / 6-set
  // catalog `catalogManifest.ts` measures holds no `sv08` row at all.
  "sv08-165": CALL_BELL,
  "fix-callbell": CALL_BELL,
  // 🆕 D295 — Chill Teaser Toy, the ONE Standard-legal printing plus the FIXTURE
  // demonstrator, for Call Bell's manifest reason VERBATIM and in the same set:
  // the 978-row / 6-set catalog `catalogManifest.ts` measures holds no `sv08` row
  // at all, so a suite that seeded only the real id would exercise nothing.
  "sv08-166": CHILL_TEASER_TOY,
  "fix-chillteaser": CHILL_TEASER_TOY,
  // D281 — the per-attack-index timing gate, all 13 Standard-legal printings.
  // ⚠️ NO `fix-*` DEMONSTRATOR ON ANY OF THEM, unlike Call Bell / Carmine /
  // Proton above, and the difference is what the suite needs rather than an
  // oversight: those three are TRAINERS whose programs are exercised through
  // `playTrainer` against `FIXTURE_POOL`, while these are Pokémon bodies driven
  // on a LOCAL `cardPool` (D275's idiom, D277's precedent with Meloetta ex) —
  // real ids, real printed bytes, and `FIXTURE_POOL` left untouched, so no
  // fixture-sweeping suite anywhere reddens.
  "sv07-128": TERAPAGOS_EX_UNIFIED_BEATDOWN,
  "sv07-170": TERAPAGOS_EX_UNIFIED_BEATDOWN,
  "sv07-173": TERAPAGOS_EX_UNIFIED_BEATDOWN,
  "sv08.5-092": TERAPAGOS_EX_UNIFIED_BEATDOWN,
  "sv08.5-169": TERAPAGOS_EX_UNIFIED_BEATDOWN,
  "sv08.5-180": TERAPAGOS_EX_UNIFIED_BEATDOWN,
  "svp-165": TERAPAGOS_EX_UNIFIED_BEATDOWN,
  "sv06-010": ILLUMISE_SLOWING_PERFUME,
  "sv06-094": SCREAM_TAIL_EX_SCREAM,
  "sv06-197": SCREAM_TAIL_EX_SCREAM,
  "sv06-009": VOLBEAT_QUICK_SIGN,
  "sv08-001": EXEGGCUTE_PRECOCIOUS_EVOLUTION,
  "sv08-192": EXEGGCUTE_PRECOCIOUS_EVOLUTION,
  "sv08.5-081": MILTANK_MOOMOO_ROLLING,
  // 🆕🆕 D396 — Sylveon ex, all THREE Standard-legal printings on ONE program
  // object (one byte-identical `attacks_json`), Terapagos ex's reprint treatment
  // above rather than Illumise / Scream Tail's two-consts one. No `fix-*`
  // demonstrator, for the D281 reason two blocks up: these are Pokémon bodies
  // driven on a LOCAL `cardPool` (D275's idiom), so `FIXTURE_POOL` is untouched.
  "sv08-086": SYLVEON_EX_ANGELITE,
  "sv08.5-041": SYLVEON_EX_ANGELITE,
  "sv08.5-156": SYLVEON_EX_ANGELITE,
  "sv06-145": CARMINE,
  "sv06-204": CARMINE,
  "sv06-217": CARMINE,
  "sv08.5-103": CARMINE,
  "fix-carmine": CARMINE,
  // D224 — Team Rocket's Proton, BOTH Standard-legal printings plus the FIXTURE
  // demonstrator, for the same manifest reason as Carmine above (the 978-row /
  // 6-set catalog holds no `sv10` row at all). Both ids carry D223's flag AND
  // D200's filter; neither piece is new.
  "sv10-177": TEAM_ROCKETS_PROTON,
  "sv10-227": TEAM_ROCKETS_PROTON,
  "fix-proton": TEAM_ROCKETS_PROTON,
  // D226 — N's Plan, all THREE Standard-legal printings plus the FIXTURE
  // demonstrator, for the same manifest reason as Carmine and Proton above (the
  // 978-row / 6-set catalog the local manifest measures holds no `sv10.5b` row).
  "sv10.5b-083": NS_PLAN,
  "sv10.5b-163": NS_PLAN,
  "sv10.5b-170": NS_PLAN,
  "fix-nsplan": NS_PLAN,
  // ── D242 — backlog row 14, two of its three groups. TWELVE Standard-legal
  // printings across two programs, the biggest single non-attack yield any slice
  // has taken. ⚠️ THE IDS ARE RE-QUERIED, NOT CARRIED (D206's rule): both groups
  // came out of a `GROUP BY` on the ability column of the remote D1 `luminous`
  // with `legal_standard = 1` on 2026-08-06, ordered by printings — the query and
  // its full output are transcribed in `abilityAttackGate.test.ts`'s header.
  "svp-205": POWER_SAVER, // Team Rocket's Mewtwo ex — "Power Saver" (promo)
  "svp-216": POWER_SAVER,
  "sv10-081": POWER_SAVER,
  "sv10-213": POWER_SAVER,
  "sv10-231": POWER_SAVER,
  "sv10-240": POWER_SAVER,
  "svp-177": SEASONED_SKILL, // Bloodmoon Ursaluna ex — "Seasoned Skill" (promo)
  "sv06-141": SEASONED_SKILL,
  "sv06-202": SEASONED_SKILL,
  "sv06-216": SEASONED_SKILL,
  "sv06-222": SEASONED_SKILL,
  // ── D277 — Meloetta ex "Debut Performance", ALL THREE Standard-legal printings.
  // ⚠️ THE IDS ARE RE-QUERIED, NOT CARRIED (D206's rule): they came out of the
  // `%during your first turn%` census of the remote D1 `luminous` on 2026-08-08,
  // whose full ladder is transcribed in `debutPerformance.test.ts`'s header. No
  // FIXTURE demonstrator — the test drives a LOCAL `cardPool` (D275's idiom), so
  // `FIXTURE_POOL` and `catalogManifest.test.ts` both take a zero diff.
  "sv10.5b-044": DEBUT_PERFORMANCE, // Meloetta ex — "Debut Performance"
  "sv10.5b-159": DEBUT_PERFORMANCE,
  "sv10.5b-167": DEBUT_PERFORMANCE,
  // ── D278 — Eevee "Boosted Evolution", ALL THREE Standard-legal printings.
  // ⚠️ THE IDS ARE RE-QUERIED, NOT CARRIED (D206's rule): they came out of the
  // `%evolve during your first turn%` census of the remote D1 `luminous` on
  // 2026-08-08, whose ladder is transcribed in `boostedEvolution.test.ts`'s
  // header, and all three returned one byte-identical `abilities_json`. No
  // FIXTURE demonstrator — the suite drives a LOCAL `cardPool` (D275's idiom, and
  // D277's), so `FIXTURE_POOL` and `catalogManifest.test.ts` both take a zero diff.
  "sv08-143": BOOSTED_EVOLUTION, // Eevee — "Boosted Evolution"
  "sv08.5-074": BOOSTED_EVOLUTION,
  "svp-173": BOOSTED_EVOLUTION,
  "sv10.5b-009": STIMULATED_EVOLUTION_KARRABLAST, // Karrablast — "Stimulated Evolution"
  "sv10.5b-094": STIMULATED_EVOLUTION_KARRABLAST,
  "sv10.5w-008": STIMULATED_EVOLUTION_SHELMET, // Shelmet — "Stimulated Evolution"
  "sv10.5w-093": STIMULATED_EVOLUTION_SHELMET,
  "sv08.5-168": SEASONED_SKILL,
  // 🆕 D327 — the cost seam's SECOND and THIRD count sources, spliced beside the
  // first rather than appended, so the `LAST-KEY` rung does not move. FOUR
  // printings and TWO card names share `FOOD_PREP` because the SENTENCE is one:
  // three Crabominable (Stage 1) and `sv07-045` **Veluza**, a Basic — the group a
  // reader keyed on card name would have closed one id short.
  "svp-134": FOOD_PREP, // Crabominable — "Food Prep" (promo)
  "sv07-042": FOOD_PREP,
  "sv07-045": FOOD_PREP, // Veluza — the SAME sentence on a different card
  "sv07-149": FOOD_PREP,
  // D327 — the row no backlog carried; found by the orthogonal-width probe alone.
  "sv05-034": HUSTLE_PLAY, // Incineroar ex — "Hustle Play"
  "sv05-187": HUSTLE_PLAY, // (reprint)
  // 🆕 D330 — the two rows the `DROPPED` re-pricing freed, spliced HERE rather
  // than appended so the `LAST-KEY` rung does not move (D323's finding: where a
  // key lands decides that rung, not how many keys there are).
  "sv06-088": CAPTIVATING_INVITATION, // Florges — the coin-gated gust + Confusion
  "sv10-176": TRAINER_SEARCH, // Team Rocket's Petrel — `trainerCard`'s first consumer
  "sv10-226": TRAINER_SEARCH, // (reprint)
  "sv08-179": LISIAS_APPEAL, // Lisia's Appeal — `gust.basicOnly`'s only consumer
  "sv08-234": LISIAS_APPEAL, // (reprint)
  "sv08-246": LISIAS_APPEAL, // (reprint)
  "sv08-174": DRAYTON, // Drayton — `lookAtTopN.also`'s only consumer
  "sv08-232": DRAYTON, // (reprint)
  "sv08-244": DRAYTON, // (reprint)
  "sv08.5-172": DRAYTON, // (reprint)
  // 🆕 D333 — census row 11's two cheapest residue shapes, spliced beside D332's
  // for the same reason: where a key lands decides the `LAST-KEY` rung (D323).
  "sv08.5-127": ROTO_STICK, // Roto-Stick — `lookAtTopN.max: "any"`'s only registry consumer
  "sv06-143": BUG_CATCHING_SET, // Bug Catching Set — `anyOf`'s SECOND live prompt consumer
  "sv08.5-102": BUG_CATCHING_SET, // (reprint)
  // 🆕 D334 — census row 11's last cheap shape, spliced beside D332's and D333's
  // for the same reason: where a key lands decides the `LAST-KEY` rung (D323).
  "sv05-147": EXPLORERS_GUIDANCE, // Explorer's Guidance — `exact` and `lookAtTopN.restTo: "discard"`'s only consumer
  "sv05-200": EXPLORERS_GUIDANCE, // (reprint)
  "sv08.5-107": EXPLORERS_GUIDANCE, // (reprint)
  // 🆕🆕 D335 — the mandatory-take family's OTHER HALF, and the leftovers
  // DESTINATION rather than the take. Spliced beside D334's for the `LAST-KEY`
  // reason (D323); Drakloak is an ABILITY and Rika a Supporter, so the two rows sit
  // in different columns of every census downstream of here.
  "sv06-129": DRAKLOAK, // Drakloak "Recon Directive" — `lookAtTopN.restTo: "bottom"`'s only consumer
  "sv08.5-072": DRAKLOAK, // (reprint)
  "sv04-172": RIKA, // Rika — `lookAtTopN.restTo: "shuffledBottom"`'s only consumer (OUT OF STANDARD)
  "sv04-241": RIKA, // (reprint)
  "sv04-258": RIKA, // (reprint)
  // FIXTURE demonstrators — D190's idiom and D190's reason (the manifest is
  // generated off a local sqlite this clone does not have, and holds neither
  // `svp`/`sv10` nor `sv06`/`sv08.5` anyway). `fix-powersaver` carries the gate;
  // `fix-seasoned` carries the discount AND a SECOND attack, which is the control
  // that pins the unscoped-field assumption above.
  "fix-powersaver": POWER_SAVER,
  "fix-seasoned": SEASONED_SKILL,
  // D243 FIXTURE demonstrators — the same idiom and the same reason: the manifest
  // holds no `sv10.5b`, `sv10`, `sv09` or `svp` row. `fix-cynthia-body` and
  // `fix-plain-body` deliberately carry NO program, because they are the
  // BENEFICIARIES the filter is read against and a program on them would make
  // "the filter matched" indistinguishable from "a second aura landed".
  "fix-regalcheer": REGAL_CHEER,
  "fix-cynthia-aura": CHEER_ON_TO_GLORY,
  "fix-hop-aura": EXTRA_HELPINGS,
  // ── D245 — the aura family's three deferred singles, one demonstrator each.
  "fix-sunnyday": SUNNY_DAY,
  "fix-victorycheer": VICTORY_CHEER,
  "fix-primalknowledge": PRIMAL_KNOWLEDGE,
  "fix-metallicsignal": METALLIC_SIGNAL,
  // ── D244 — backlog row 14-R (Iron Leaves ex's on-bench switch), the LAST third
  // of row 14, plus the second printed sentence of the same op field. SEVEN
  // Standard-legal ABILITY printings across two programs. ⚠️ THE IDS ARE
  // RE-QUERIED, NOT CARRIED (D206's rule): `GROUP BY` over
  // `json_each(abilities_json)` with `legal_standard = 1` on the remote D1
  // `luminous`, 2026-08-06 — the row's six ids re-derive to the digit, and
  // WIDENING the same query from those ids to the printed PRONOUN turns up a
  // SEVENTH legal printing the row never named. The query and its full output are
  // transcribed in `benchSwitchTrigger.test.ts`'s header.
  "svp-128": RAPID_VERNIER, // Iron Leaves ex — "Rapid Vernier" (promo)
  "sv05-025": RAPID_VERNIER,
  "sv05-186": RAPID_VERNIER,
  "sv05-203": RAPID_VERNIER,
  "sv05-213": RAPID_VERNIER,
  "sv08.5-176": RAPID_VERNIER,
  "sv09-018": SHOWTIME, // Meowscarada — "Showtime" (mark I)
  // FIXTURE demonstrators — D190's idiom and reason (the manifest holds no
  // `sv05`, `sv08.5`, `sv09` or `svp` row). `fix-rapidvernier` is a BASIC, which
  // is what an `onPlayToBench` trigger requires; `fix-showtime` is a Stage 2 in
  // the catalog and a Basic here, and the suite says so out loud rather than
  // letting the fixture's shape be mistaken for the print's (D243's rule).
  "fix-rapidvernier": RAPID_VERNIER,
  "fix-showtime": SHOWTIME,
  // ⚠️ A `fix-*` ID AND NOTHING ELSE — a constructed program, deliberately
  // unreachable from any printed card. See `GATHER_INWARD`'s doc.
  "fix-othersmove": GATHER_INWARD,
  // — M5 long-tail (D251): the attacker-HAS-AN-ABILITY prevent, the third member
  // of the attacker-property prevent family and the biggest cheap unbuilt ability
  // group in the legal pool. FIVE printings on ONE sentence, re-derived by
  // `GROUP BY lower(j.value ->> 'effect')` over `json_each(abilities_json)` with
  // `legal_standard = 1` on the remote D1 `luminous`, 2026-08-07 — the row's five
  // ids re-derive to the digit, and the same query WIDENED to the bare
  // `%prevent all damage%` returns 9 ability sentences, five of them carrying the
  // "from and effects of" half this field deliberately cannot spell. The query
  // and its full output are transcribed in `cornerstoneStance.test.ts`'s header.
  "sv06-112": CORNERSTONE_STANCE, // Cornerstone Mask Ogerpon ex — "Cornerstone Stance"
  "sv06-199": CORNERSTONE_STANCE, // (reprint)
  "sv06-215": CORNERSTONE_STANCE, // (reprint)
  "sv08.5-058": CORNERSTONE_STANCE, // (reprint)
  "sv08.5-160": CORNERSTONE_STANCE, // (reprint)
  // FIXTURE demonstrator — D190's idiom: the manifest holds no `sv06` or
  // `sv08.5` row, so the behaviour suite needs a local body carrying the aura.
  "fix-cornerstone": CORNERSTONE_STANCE,
  // D252 — Carracosta "Mighty Shell", the WIDE spelling of the sentence three
  // lines up and the half D251 refused to build. TWO printings on ONE sentence,
  // re-derived by `GROUP BY lower(json_extract(a.value,'$.effect'))` over
  // `json_each(abilities_json)` with `legal_standard = 1` and
  // `LIKE '%and effects of attacks%'` on the remote D1 `luminous`, 2026-08-07 —
  // 9 printings on 4 sentences, of which this row is the 2, and the row's two ids
  // re-derive to the digit. The full output is transcribed in
  // `mightyShell.test.ts`'s header, including WHY the 3-printing Tera group at the
  // top of it is unbuildable.
  "sv10.5b-023": MIGHTY_SHELL, // Carracosta — "Mighty Shell"
  "sv10.5b-107": MIGHTY_SHELL, // (reprint)
  // FIXTURE demonstrator — D190's idiom, `fix-cornerstone`'s reason verbatim: the
  // manifest holds no `sv10.5b` row either.
  "fix-mightyshell": MIGHTY_SHELL,
  // D253 — Poltchageist / Misty's Magikarp (⚠️ NOT Sinistcha — D305), the LARGEST row of the
  // 4-sentence family D252 censused: the same WIDE spelling with the attacker
  // predicate gone and a holder-ZONE gate in its place. THREE printings on ONE
  // sentence. ✅ THE COUNT WAS D252's TRANSCRIBED ROW AT D253 AND IS RE-DERIVED AT
  // D254 — the row measures 3 on these three ids.
  // ✅ AND THE FAMILY'S LAST PRINTING IS TAKEN BELOW: `sv05-024`, a seat-wide aura
  // over your BENCHED Pokémon. ⚠️ The note this block used to carry called it
  // "`benchShieldedByActive`'s shape"; it shares that scan's TARGET clause and
  // prints NO source clause at all, which is the whole of D254's finding.
  "sv06-020": CURIOUS_TEA_PARTY, // Poltchageist — "Storehouse Hideaway" (D305: NOT "Curious Tea Party")
  "sv06-171": CURIOUS_TEA_PARTY, // (reprint)
  "sv10-048": CURIOUS_TEA_PARTY, // ⚠️ Misty's Magikarp — "So Submerged", the SAME sentence. NOT Sinistcha, and not an evolution (D305)
  // FIXTURE demonstrator — `fix-mightyshell`'s reason verbatim: the manifest holds
  // no `sv06` or `sv10` row either.
  "fix-teaparty": CURIOUS_TEA_PARTY,
  // D254 — Rabsca "Spherical Shield", the LAST row of the 4-sentence family D252
  // censused and the only one whose protection lands on a body that is not its
  // holder. ONE printing, RE-DERIVED at this commit. A SINGLETON: no reprint, so
  // there is no shared-object claim to make here, unlike the four terms above it.
  "sv05-024": SPHERICAL_SHIELD, // Rabsca — "Spherical Shield"
  // FIXTURE demonstrator — `fix-teaparty`'s reason verbatim: the manifest holds no
  // `sv05-024` row either (it is the ROTATED six-set population).
  "fix-spherical": SPHERICAL_SHIELD,
  // D259 — BACKLOG ROW 15-D, the TRAINER-BORNE effect shield. The `%prevent%`
  // ability census (remote D1 `luminous` `735f0fb5-cdc3-494d-8b97-74a8ade0124a`,
  // `abilities_json`, `legal_standard = 1`, GROUPED BY SENTENCE, 2026-08-07)
  // measures this row at **4 + 1 printings on TWO sentences**, with the attack and
  // effect columns returning ZERO for the same three-rung predicate. RE-DERIVED at
  // this commit, not transcribed.
  "sv06.5-045": UNNERVE, // Fraxure — "Unnerve"
  "sv06.5-077": UNNERVE, // (reprint)
  "sv10-065": UNNERVE, // Cetitan ex — "Snow Camouflage", the SAME printed sentence
  "sv10-210": UNNERVE, // (reprint)
  "sv07-076": WIDE_WALL, // Rhyperior — "Wide Wall", the Supporter-only seat rule
  // FIXTURE demonstrators — `fix-spherical`'s reason verbatim: the manifest holds
  // no `sv06.5`/`sv07`/`sv10` row either. TWO of them, because this row is TWO
  // printed sentences and one demonstrator could show neither the Item/Supporter
  // split nor the holder/seat split.
  "fix-unnerve": UNNERVE,
  "fix-widewall": WIDE_WALL,
  // ── D284 — the CONTINUOUS BAR ON THE PLAY (`preventOpponentHandPlay`). 4 legal
  // printings of 2 sentences, the reach of `HandPlayClass` over the 7-row census;
  // Copperajah `sv06.5-042`, Team Rocket's Arbok `sv10-113` and Genesect
  // `sv06.5-040` are the three REFUSED rows, each named on the field.
  "sv09-095": DAUNTING_GAZE, // Tyranitar — "Daunting Gaze", Items only
  "sv10.5w-045": OCEANIC_CURSE, // Jellicent ex — "Oceanic Curse", Items AND Tools
  "sv10.5w-160": OCEANIC_CURSE, // (reprint)
  "sv10.5w-168": OCEANIC_CURSE, // (reprint)
  // ── D285 — the POKÉMON-SURFACE PLAY GATE (`preventOpponentPokemonPlay`). 1
  // legal printing, the CONTINUOUS half of a 2-printing mechanism whose other
  // half is Bronzong `sv05-069`'s text-derived attack. ⚠️ ITS COMMENT USED TO SAY
  // "Copperajah `sv06.5-042` and Genesect `sv06.5-040` remain the two refused
  // rows" — D287 built Copperajah, so GENESECT IS THE LAST ONE and the sentence
  // is corrected here rather than left to rot beside a row that contradicts it.
  "sv10-113": POTENT_GLARE, // Team Rocket's Arbok — "Potent Glare"
  // FIXTURE demonstrator — `fix-spherical`'s reason verbatim (the manifest holds
  // no `sv10` row). ONE, because this row is ONE printed sentence.
  "fix-potentglare": POTENT_GLARE,
  // ── D287 — the STADIUM CLASS of the SAME `preventOpponentHandPlay` field, and
  // the row D284 refused BY NAME with its missing mechanism ("a Stadium payability
  // mirror on the wire") written on the field. 1 legal printing, no reprint, and
  // the LAST Trainer-surface row of D284's 7-sentence census: only Genesect
  // `sv06.5-040` is still refused, and it is refused on a RARITY axis (ACE SPEC)
  // that `HandPlayClass` cannot express at any width. ⚠️ NO `fix-*` DEMONSTRATOR,
  // on D284's own terms rather than D285's: this is a Pokémon BODY driven on a
  // LOCAL `cardPool` (D275's idiom), not a Trainer played against `FIXTURE_POOL`,
  // so the real id carries the program and the two census lines move by +1 each.
  "sv06.5-042": MASSIVE_BODY, // Copperajah — "Massive Body", Stadiums only
  // ── D291 — the RARITY AXIS of the same seat-wide bar
  // (`preventOpponentAceSpecPlayWhileToolAttached`), and **THE LAST ROW OF D284's
  // SEVEN-SENTENCE CENSUS: 7 BUILT / 0 REFUSED.** 1 legal printing, no reprint,
  // and no second row in the catalog whose text names ACE SPEC at all. It is a
  // SECOND FIELD rather than a fifth `HandPlayClass` member on two independent
  // grounds (vocabulary and window) — see the field's block. ⚠️ NO `fix-*`
  // DEMONSTRATOR, on D287's terms exactly: a Pokémon BODY driven on a LOCAL
  // `cardPool` (D275's idiom), so the real id carries the program and the two
  // census lines move by +1 each. ⚠️ **AND IT IS A 30-OF-33 BUILD**: the three
  // ACE SPEC Special Energy printings are played by `attachEnergy`, which asks no
  // hand-play bar — refused and named on the field.
  "sv06.5-040": ACE_NULLIFIER, // Genesect — "ACE Nullifier", every ACE SPEC at once
  // D260 — BACKLOG ROW 15-E, the ATTACK-BORNE EFFECTS-ONLY shield, and the whole
  // remaining BUILDABLE residue of the `%prevent%` ability seam. The same census
  // (remote D1 `luminous` `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, GROUPED BY
  // SENTENCE, `legal_standard = 1`, 2026-08-07) measures this row at **1 + 1
  // printings on TWO sentences** in the ABILITY column, RE-DERIVED at this commit
  // over a THREE-RUNG ladder across all three text columns. The wide rung's false
  // positives are named in `repellingVeil.test.ts`'s header — including the one
  // that is NOT an ability: `sv05-161`, a Special Energy printing the same
  // sentence about the body it is attached to, which stays UNBUILT and is now the
  // seam's only buildable remainder.
  "sv08-031": UNAWARE, // Skeledirge — "Unaware", the HOLDER rule
  "sv10-051": REPELLING_VEIL, // Team Rocket's Articuno — "Repelling Veil", the GROUP rule
  // FIXTURE demonstrators — `fix-spherical`'s reason verbatim (no `sv08`/`sv10`
  // row in the manifest). TWO, because this row is TWO printed sentences and one
  // body could show neither the fold/scan split nor the target-group filter.
  "fix-unaware": UNAWARE,
  "fix-repellingveil": REPELLING_VEIL,
  // D255 — the ATTACKER'S PRINTED RULE-BOX CLASS, the two rows the `%prevent all
  // damage%` census (remote D1 `luminous`, 2026-08-07, `abilities_json`,
  // `legal_standard = 1`, GROUPED BY SENTENCE) left as the biggest BUILDABLE
  // residue: 22 printings on 9 sentences, of which 11 on 4 were already built and
  // the 3-printing TERA row is permanently unbuildable. These two are the 3 and the
  // 2. The full ranked transcript, with the built/unbuilt split measured by running
  // `programFor` over every returned id, is in `preventedAttackerClass.test.ts`.
  "sv08.5-040": PREVENT_FROM_EX, // Sylveon — "Safeguard" (NOT Mimikyu's ex-and-V one)
  "sv10-012": PREVENT_FROM_EX, // Crustle — "Mysterious Rock Inn", same sentence
  "sv10-186": PREVENT_FROM_EX, // (reprint)
  "sv05-108": PREVENT_FROM_BASIC_EX, // Farigiraf ex — "Armor Tail"
  "sv05-194": PREVENT_FROM_BASIC_EX, // (reprint)
  // FIXTURE demonstrators — `fix-spherical`'s reason verbatim: the manifest holds no
  // `sv05`/`sv08.5`/`sv10` row either. TWO of them, because this row is TWO printed
  // sentences and a single demonstrator could not show the stage conjunct at all.
  "fix-safeguardex": PREVENT_FROM_EX,
  "fix-armortail": PREVENT_FROM_BASIC_EX,
  // D256 — Shaymin "Flower Curtain", backlog row 15-A and the LARGEST buildable
  // row left in the same `%prevent all damage%` census D255 ran (re-derived at this
  // commit: 22 printings on 9 sentences, unchanged, this row the 2). TWO printings
  // of ONE card, so ONE object shared by both ids — a second object would inflate
  // this slice's share of `BUILT.ability` while looking identical to a count.
  "sv10-010": FLOWER_CURTAIN, // Shaymin — "Flower Curtain"
  "sv10-185": FLOWER_CURTAIN, // (reprint)
  // FIXTURE demonstrator — `fix-spherical`'s reason verbatim: the manifest holds no
  // `sv10` row either.
  "fix-flowercurtain": FLOWER_CURTAIN,
  // D257 — Drednaw "Impervious Shell", backlog row 15-B and the LAST buildable
  // member of the `%prevent all damage%` ability census D255 measured (re-derived
  // at this commit: 22 printings on 9 sentences, unchanged; the only residue after
  // this row is the permanently unbuildable 3-printing TERA group). A SINGLETON —
  // one printed id, no reprint — so there is no shared object to argue about.
  "sv07-044": IMPERVIOUS_SHELL, // Drednaw — "Impervious Shell"
  // FIXTURE demonstrator — `fix-flowercurtain`'s reason verbatim: the manifest
  // holds no `sv07` row either.
  "fix-imperviousshell": IMPERVIOUS_SHELL,
  // The SAME program on a body that differs by ONE printed field (a {G} Weakness
  // ×2), which is what turns "the threshold is read against the number that would
  // ACTUALLY be placed" into a controlled comparison rather than an assertion.
  "fix-imperviousweak": IMPERVIOUS_SHELL,
  // D258 — the COIN-FLIP defensive Ability, backlog row 15-C and the largest row of
  // the census D257 opened by WIDENING THE VERB: `%prevent that damage%` ∪
  // `%flip a coin%prevent%` over all three text columns (remote D1 `luminous`,
  // `legal_standard = 1`, GROUPED BY SENTENCE, re-run at this commit) returns
  // **5 ability printings on 2 sentences** — these — and 21 attack printings on 3
  // sentences, every one of them the DURATED §11 spelling built since D142. A wider
  // rung (`%prevent%` ∧ `%coin%`, same three columns) returns the identical five
  // rows and nothing else, so the row has NO false positives at any width.
  // TWO objects, because these are two printed sentences by two cards — a shared one
  // would report the wrong Ability name in half the ABILITY_COIN_FLIP rows.
  "sv06-096": ADRENA_PHEROMONE, // Fezandipiti — "Adrena-Pheromone" ({D}-gated)
  "sv06.5-073": ADRENA_PHEROMONE, // (reprint)
  "sv08.5-045": ADRENA_PHEROMONE, // (reprint)
  "sv08-150": EXPERT_HIDER, // Kecleon — "Expert Hider" (the antecedent dropped)
  "sv08-213": EXPERT_HIDER, // (reprint)
  // FIXTURE demonstrators — `fix-imperviousshell`'s reason verbatim: the manifest
  // holds no `sv06`/`sv08` row either. TWO of them, because this row is TWO printed
  // sentences and one demonstrator could not show the Energy conjunct at all.
  "fix-adrenapheromone": ADRENA_PHEROMONE,
  "fix-experthider": EXPERT_HIDER,
  // 🆕 D310 — the evolve-from-deck family's ABILITY printing, and the only
  // remaining-HP gate in the catalog. ONE legal printing, no reprint anywhere:
  // `instr(abilities_json,'remaining HP is 30 or less') > 0` returns exactly
  // `sv05-133` over all 3,786 rows (remote D1 `luminous`, 2026-08-10).
  "sv05-133": EMERGENCY_EVOLUTION,
  // FIXTURE demonstrator — the manifest holds no `sv05` row (`fix-imperviousshell`'s
  // reason verbatim). ONE, because this row is ONE printed sentence.
  "fix-emergencyevolution": EMERGENCY_EVOLUTION,
  // 🆕 D311 — the SELF-removal family's Ability half, and the first printing in
  // this engine that can empty the Active Spot without a Knock Out. TWO legal
  // printings and no third: the union of `instr(abilities_json,'this Pokémon and
  // all attached cards') > 0` and `instr(abilities_json,'it and all attached
  // cards') > 0` over all 3,786 rows returns these two plus Abra `sv06-080`
  // (remote D1 `luminous`, 2026-08-10). NO `fix-*` demonstrator: this is a Pokémon
  // BODY driven on a LOCAL `cardPool` (D275's idiom), not a Trainer played against
  // `FIXTURE_POOL`.
  "sv05-129": RUN_AWAY_DRAW,
  "sv08.5-080": RUN_AWAY_DRAW, // (reprint)
  // 🆕 D312 — the SELF-removal family's Ability half CLOSED at 3 of 3. ONE legal
  // printing and no reprint: `instr(abilities_json,'it and all attached cards') > 0`
  // returns exactly `sv06-080` over all 3,786 rows (remote D1 `luminous`,
  // 2026-08-10). NO `fix-*` demonstrator, for `RUN_AWAY_DRAW`'s reason verbatim.
  "sv06-080": TELEPORTER,
  // 🆕 D312 — the family's ATTACK half opened, at index 1 ONLY. ONE legal printing:
  // `instr(attacks_json,'You may shuffle this Pokémon and all attached cards') > 0`
  // returns exactly `sv08-131` over all 3,786 rows (remote D1, 2026-08-10). ⚠️ THIS
  // ROW IS `attack`-ONLY, so it moves `registryCardIds()` and does NOT move
  // `nonAttackRegistryIds()` — the first row in this run where the two pools step
  // by different amounts, and `censusAtHead.test.ts` says so in both places.
  "sv08-131": SURF_BACK,
  // 🆕 D313 — the family's DISCARD destination, at index 1 ONLY. TWO legal
  // printings and no third: `instr(attacks_json,'Discard this Pokémon and all
  // attached cards') > 0` returns exactly `sv06.5-015`/`-081` over all 3,786 rows
  // (remote D1 `luminous`, 2026-08-10). ⚠️ **THESE ARE THE ONLY TWO IDS THIS SLICE
  // ADDS TO `registryCardIds()` AT ALL** — Team Rocket's Crobat ex ×4 and Lillie's
  // Comfey are already keys (for "Biting Spree" and "Inviting Flowers"), so seven
  // new printings buy **+2** on `raw.length`. And this row is `attack`-ONLY, like
  // `SURF_BACK`, so `nonAttackRegistryIds()` moves by **ZERO**: the two pools step
  // by different amounts for the SECOND time in this run, and in a different shape
  // from D312's (+2/+0 where that was +2/+1). NO `fix-*` demonstrator — a Pokémon
  // BODY driven on a LOCAL `cardPool` (D275's idiom).
  "sv06.5-015": SHATTERING_SPEED,
  "sv06.5-081": SHATTERING_SPEED, // (reprint)
  // 🆕 D314 — the family's LAST reachable printing, at index 0 ONLY. ONE legal
  // printing: `instr(attacks_json,'Put this Pokémon and all attached cards into
  // your deck') > 0` returns exactly `sv07-011` over all 3,786 rows (remote D1
  // `luminous`, 2026-08-10). ⚠️ A NEW id carrying an `attack`-ONLY program, so
  // `raw.length` steps by **+1** and `nonAttackRegistryIds()` by **ZERO** — the
  // THIRD consecutive slice on which the two pools disagree, and the third
  // distinct reason (D312: an attack-only program on an id already present;
  // D313: seven printings on ids that were already keys; here: a brand-new id
  // whose program has no non-attack half). NO `fix-*` demonstrator — a Pokémon
  // BODY driven on a LOCAL `cardPool` (D275's idiom), and `sv07` is not one of
  // `catalogManifest`'s six sets either.
  "sv07-011": BREEZY_GIFT,
  // 🆕 D319 — THE OPPONENT-ACTION TRIGGER FAMILY, CLOSED AT 2 OF 2 LEGAL
  // SENTENCES / 3 OF 3 LEGAL PRINTINGS. The consequent is what bounds it:
  // `instr(abilities_json,'on that Pok') > 0` returns ELEVEN rows over all 3,786
  // and exactly THREE with `legal_standard = 1` — `sv10-074` and `sv05-104`/
  // `-193` (remote D1 `luminous`, 2026-08-10). ⚠️ THE ANTECEDENT SIDE AGREES AND
  // IS WIDER: `instr(abilities_json,'Whenever your opponent') > 0` returns EIGHT
  // rows, all eight legal, and the other five are two DIFFERENT mechanisms —
  // Magcargo `sv05-029` "Lava Zone" (the opponent's Active moving to the Bench,
  // a third verb with a Special Condition consequent) and the already-built
  // Trainer-shield pair Fraxure `sv06.5-045`/`-077` + Cetitan ex `sv10-065`/
  // `-210`, which are `preventDamage effects` passives and not triggers at all.
  // ⚠️ THREE NEW IDS, ALL NON-ATTACK, so `nonAttackRegistryIds()` and
  // `raw.length` step by **+3 each** — the first slice in this run where the two
  // pools agree since D311. NO `fix-*` demonstrator: Pokémon BODIES driven on a
  // LOCAL `cardPool` (D275's idiom), and neither `sv05` nor `sv10` is one of
  // `catalogManifest`'s six sets.
  "sv10-074": DARKEST_IMPULSE, // Team Rocket's Ampharos — the EVOLVE verb
  "sv05-104": GNAWING_CURSE, // Gengar ex — the ATTACH verb
  "sv05-193": GNAWING_CURSE, // (reprint)
  // 🆕 D320 — THE THIRD OPPONENT-ACTION VERB, and the one D319 named as left
  // over from its own eight-row antecedent sweep. `instr(abilities_json,
  // 'moves to the Bench') > 0` returns ONE row over all 3,786 — and so does the
  // same literal over `attacks_json` and `effect` (ZERO each), so no text reader
  // can see this sentence and `BUILT.attack` cannot move. ⚠️ ONE NEW ID, NON-
  // ATTACK, so `nonAttackRegistryIds()` and `raw.length` step by **+1 each** for
  // the second slice running. NO `fix-*` demonstrator: a Pokémon BODY driven on
  // a LOCAL `cardPool` (D275's idiom), and `sv05` is not one of
  // `catalogManifest`'s six sets.
  "sv05-029": LAVA_ZONE, // Magcargo — the BENCH-MOVE verb
  // 🆕 D322 — THE RETREAT-COST DELTA'S THREE UNBUILT SENTENCES. The handoff
  // priced this row at TWO printings off `instr(abilities_json,'Retreat Cost
  // is') > 0` (5 rows / 2 legal, which re-derives at HEAD); the WIDER
  // `instr(abilities_json,'Retreat Cost') > 0` returns 24 / **9 legal** on SIX
  // sentences, of which Metal Bridge ×3 and Skyliner ×3 are BUILT — so the
  // third unbuilt printing is Ethan's Magcargo `sv10-036` "Melt Away", whose
  // sentence the narrow literal cannot see ("it HAS NO Retreat Cost" carries no
  // "is"). ⚠️ THREE NEW IDS, ALL NON-ATTACK, so `nonAttackRegistryIds()` and
  // `raw.length` step by **+3 each** for the second slice running. NO `fix-*`
  // demonstrator: Pokémon BODIES driven on a LOCAL `cardPool` (D275's idiom),
  // and neither `sv06` nor `sv09` nor `sv10` is one of `catalogManifest`'s six
  // sets. (Verified vs the remote D1 `luminous`, 3,786 rows, 2026-08-10.) —
  "sv06-005": BIG_NET, // Ariados — the TARGET-NARROWED cross-board surcharge
  "sv09-089": SECRET_FOREST_PATH, // Toedscruel — the OWN-SIDE discount, bench-gated
  "sv10-036": MELT_AWAY, // Ethan's Magcargo — the self-only zero under a HOLDER gate

  // 🆕 D338 — the TYPED combination search, D337's sentence one surface over. TWO
  // ids on ONE sentence and ONE program object, and NO `fix-*` demonstrator: the
  // suite drives the real ids on a LOCAL `cardPool` (D275's idiom), so
  // `catalogManifest` never sees them and `revealClause`'s FIXTURE_POOL sweep
  // cannot reach them. This is the pair that moves `BUILT.attack`'s REGISTRY
  // summand 13 → 15 and leaves its reader-keyed raw summand at 1,164.
  "sv10.5w-019": LICKING_CATCH, // Heatmor — "Licking Catch" (attack 0, mark I)
  "sv10.5w-104": LICKING_CATCH, // Heatmor (reprint) — same sentence, same object

  // 🆕 D339 — the NAMED combination search, and **THE ROW THAT CLOSES THE GRAMMAR AT
  // 6 OF 6**. ONE id, ONE sentence, ONE program object, and NO `fix-*` demonstrator:
  // the suite drives the real id on a LOCAL `cardPool` (D275's idiom), so
  // `catalogManifest` never classifies it and `revealClause`'s FIXTURE_POOL sweep
  // cannot reach it. This is the row that moves `BUILT.attack`'s REGISTRY summand
  // 15 → 16 and leaves its reader-keyed raw summand at 1,164 and its split at 13.
  // ⚠️ IT IS APPENDED LAST ON PURPOSE AND THAT IS LOAD-BEARING: `censusAtHead`'s
  // `raw[raw.length - 1]` rung is keyed on INSERTION ORDER, not on any count, so it
  // moves from `sv10.5w-104` to `sv08-158` — one of the two rungs D338's price
  // missed precisely because no grep of the census FIGURES can reach it.
  "sv08-158": FAMILIAL_MARCH, // Maushold — "Familial March" (attack 0)

  // 🆕 D340 — the SELF-EXEMPTING CHECKUP AURA, and the FIRST row in four slices to
  // carry an engine diff (one new `EffectOp`, `counterEachAll`). THREE ids on ONE
  // sentence and ONE program object, and NO `fix-*` demonstrator: the suite drives
  // the real ids on a LOCAL `cardPool` (D275's idiom, D338's and D339's practice),
  // so `catalogManifest` never classifies them and `revealClause`'s FIXTURE_POOL
  // sweep cannot reach them — which is what keeps `swept.size` at 27.
  // 🛑 **D343: THAT CLAUSE IS RETIRED.** The sweep is no longer a `FIXTURE_POOL`
  // sweep; its population is `registryCardIds()` ∪ the pool and `swept.size` is
  // **103**. Froslass `sv06-053`/`sv06-174`/`svp-117` are registry ids and are
  // swept today. The `catalogManifest` clause below is unaffected and still
  // correct — the SET rule survives, the pool rule does not. ⚠️ THAT IS A
  // CENSUS DECISION, NOT A TIDINESS ONE: neither `sv06` nor `svp` is among the
  // manifest's six sets, so a shared-pool body would owe a `fix-froslass` key AND
  // redden `swept.size`, exactly as D335's `fix-drakloak` (also a Pokémon, also
  // `sv06`) did. THE KEY IS THE SET, NOT THE SURFACE.
  // This is the trio that moves `BUILT.ability` 249 → 252 and leaves all three of
  // `BUILT.attack`'s summands (1,164 raw / 16 registry / 13 split) standing still —
  // measured, not assumed: every id carries `effect IS NULL` against a 65-char
  // `attacks_json` holding a bare attack with no effect text, so NO attack reader
  // can resolve anything on any of the three (remote D1, 2026-08-15).
  // ⚠️ APPENDED LAST ON PURPOSE, D339's note one slice on: `censusAtHead`'s
  // `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and moves from
  // `sv08-158` to `svp-117` — no grep of the census FIGURES reaches it.
  "sv06-053": FREEZING_SHROUD, // Froslass — "Freezing Shroud" (Stage 1, {W})
  "sv06-174": FREEZING_SHROUD, // Froslass (reprint) — same sentence, same object
  "svp-117": FREEZING_SHROUD, // Froslass (promo reprint) — same sentence, same object
  // 🆕🆕 D342 — CIPHERMANIAC'S CODEBREAKING, 3 legal printings on ONE object and
  // ONE card name, the `effect` half of a 4-printing sentence. This trio moves
  // `BUILT.trainer` 105 → 108 and leaves `BUILT.ability` and all three of
  // `BUILT.attack`'s summands untouched by these ids — measured, not assumed:
  // every one carries `attacks_json IS NULL` AND `abilities_json IS NULL`
  // against a byte-identical 96-char `effect` (remote D1, 2026-08-15), so no
  // attack reader and no ability reader can see the sentence at all. The +1 on
  // `BUILT.attack`'s RAW summand this session is Dialga `sv08-135`, a different
  // id in a different column, read by a deriver and not by this table.
  // ⚠️ APPENDED LAST ON PURPOSE, D339/D340's note two slices on: `censusAtHead`'s
  // `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and moves from
  // `svp-117` to `sv08.5-104` — no grep of the census FIGURES reaches it, and it
  // has now gone red on an untouched constant three times.
  "sv05-145": CIPHERMANIACS_CODEBREAKING, // Ciphermaniac's Codebreaking (Supporter, mark H)
  "sv05-198": CIPHERMANIACS_CODEBREAKING, // Ciphermaniac's Codebreaking (reprint)
  "sv08.5-104": CIPHERMANIACS_CODEBREAKING, // Ciphermaniac's Codebreaking (reprint)
  // 🆕🆕 D345 — CURSED BLAST, **6 legal printings on TWO objects and TWO card
  // names**, the whole buildable two-thirds of the self-KO clause's family. These
  // six move `BUILT.ability` 252 → 258 and leave `BUILT.trainer`,
  // `BUILT.specialEnergy` and all three of `BUILT.attack`'s summands untouched —
  // measured, not assumed: every one of the six carries `effect IS NULL` and
  // `category = 'Pokemon'` on the remote D1 (2026-08-15), so no Trainer reader
  // and no Energy reader can see them at all, and neither id-map entry carries an
  // `attack` key, so the registry summand cannot move either.
  // ⚠️ APPENDED LAST ON PURPOSE, D339/D340/D342's note four slices on:
  // `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `sv08.5-104` to `sv08.5-037` — no grep of the census FIGURES
  // reaches it, and it has now gone red on an untouched constant four times.
  "sv06.5-019": CURSED_BLAST_5, // Dusclops — "Cursed Blast" (Stage 1, {P}, 5 counters)
  "sv06.5-069": CURSED_BLAST_5, // Dusclops (reprint) — same sentence, same object
  "sv08.5-036": CURSED_BLAST_5, // Dusclops (Prismatic Evolutions reprint) — same object
  "sv06.5-020": CURSED_BLAST_13, // Dusknoir — "Cursed Blast" (Stage 2, {P}, 13 counters)
  "sv06.5-070": CURSED_BLAST_13, // Dusknoir (reprint) — same sentence, same object
  "sv08.5-037": CURSED_BLAST_13, // Dusknoir (Prismatic Evolutions reprint) — same object
  // 🆕 D346 — Magneton "Overvolt Discharge" ×3, ONE object. `censusAtHead`'s
  // `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and moves from
  // `sv08.5-037` to `sv08-059` — no grep of the census FIGURES reaches it, and it
  // has now gone red on an untouched constant five times. It is on this slice's
  // prediction because the prediction was built by grepping the FILE, not the name.
  "svp-153": OVERVOLT_DISCHARGE, // Magneton — "Overvolt Discharge" (Stage 1, {L})
  "svp-159": OVERVOLT_DISCHARGE, // Magneton (promo reprint) — same sentence, same object
  "sv08-059": OVERVOLT_DISCHARGE, // Magneton (Surging Sparks) — same object
  // 🆕 D347 — Yanmega ex "Buzzing Boost" ×3, ONE object. `censusAtHead`'s
  // `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and moves from
  // `sv08-059` to `sv10-228` — the SIXTH consecutive slice on which that constant
  // goes red without being touched, and no grep of the census FIGURE NAMES reaches
  // it. It is on this slice's prediction for D346's reason: grep the FILE for what
  // a registry insert moves, not the names of the numbers.
  // ⚠️ THREE NEW IDS, ALL NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length`
  // step by **+3 each** and stay 0 apart, for the EIGHTH slice running. NO `fix-*`
  // demonstrator: Pokémon BODIES driven on a LOCAL `cardPool` (D275's idiom), and
  // `sv10` is not one of `catalogManifest`'s six sets (sv01/sv02/sv03/sv06.5/sve/
  // swsh10.5), so a shared-pool body would have owed a `fix-*` key here.
  "sv10-003": BUZZING_BOOST, // Yanmega ex — "Buzzing Boost" (Stage 1 out of Yanma, {G})
  "sv10-206": BUZZING_BOOST, // Yanmega ex (illustration rare) — same sentence, same object
  "sv10-228": BUZZING_BOOST, // Yanmega ex (special illustration rare) — same object
  // 🆕🆕 D349 — THE REMAINING-HP WINDOW, ON TWO OPS AND IN TWO COLUMNS. Ledian ×3
  // (`ability`) and Bianca's Devotion ×3 (`effect`) are the WHOLE legal population
  // of *"HP or less remaining"* as a CANDIDATE narrowing — 6 legal printings on 2
  // legal sentences across all three text columns, `json_each`-grouped so the unit
  // is a SENTENCE (remote D1 `luminous`, 2026-08-15). The only other printing is
  // Vanilluxe `sv06-039` (*"Your opponent's Pokémon that have 40 HP or less
  // remaining can't attack."*), which is NOT Standard-legal and is an aura rather
  // than a narrowing.
  // ⚠️ SIX NEW IDS, ALL NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length`
  // step by **+6 each** and stay 0 apart for the NINTH slice running.
  // ⚠️ `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `sv10-228` to `sv05-209` — the SEVENTH consecutive slice on which
  // that constant goes red without being touched. It is on this slice's prediction
  // because the prediction was built by grepping the FILE, not the figure names.
  // ⚠️ AND THIS IS THE FIRST SLICE IN NINE TO MOVE **TWO** `BUILT` SUMMANDS —
  // `.ability` +3 AND `.trainer` +3 — which is D342's shape from one sentence
  // printed in two columns, arriving here from TWO sentences that share a CLAUSE.
  // 🛑 NO `fix-*` DEMONSTRATOR FOR EITHER ROW, INCLUDING THE TRAINER — and the
  // Trainer is the decision, because a Supporter has to be PLAYED out of a hand and
  // the reflex is to put it in `FIXTURE_POOL`. `deductionKit.test.ts` (D344) shows
  // the alternative: a LOCAL `cardPool` carrying the REAL id (D275's idiom), which
  // is strictly stronger — there is no second body that could drift from the one the
  // printings resolve to. It also keeps this slice out of `FIXTURE_POOL` entirely,
  // and `FIXTURE_POOL` IS A CENSUSED POPULATION in `catalogManifest.test.ts` and
  // `clauseApostrophe.test.ts` (D348 paid two red suites for a body nobody grepped).
  // Neither `sv05`, `sv07` nor `svp` is among `catalogManifest`'s six sets
  // (sv01/sv02/sv03/sv06.5/sve/swsh10.5), so a real-card fixture is forbidden here
  // anyway and a synthetic one would have been the only shared-pool option.
  "svp-133": GLITTERING_STAR_PATTERN, // Ledian (promo) — "Glittering Star Pattern"
  "sv07-003": GLITTERING_STAR_PATTERN, // Ledian (Stellar Crown) — same sentence, same object
  "sv07-144": GLITTERING_STAR_PATTERN, // Ledian (illustration rare) — same object
  "sv05-142": BIANCAS_DEVOTION, // Bianca's Devotion — Supporter
  "sv05-197": BIANCAS_DEVOTION, // (reprint)
  "sv05-209": BIANCAS_DEVOTION, // (reprint)
  // 🆕🆕 D350 — THE OPPONENT'S OWN BASICS ONTO THE OPPONENT'S OWN BENCH, AT A
  // COUNT THE CARD DOES NOT NAME. Lillie's Ribombee ×3 is the whole legal
  // population of its sentence and the LARGEST of the mechanism's three legal
  // sentences; with it, `bottomFromOpponentHand`'s bench arm closes at 3 of 3
  // legal sentences / 7 of 7 legal printings across all three text columns.
  // ⚠️ THREE NEW IDS, ALL NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length`
  // step by **+3 each** and stay 0 apart, for the TENTH slice running.
  // ⚠️ `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `sv05-209` to `svp-183` — the EIGHTH consecutive slice on which that
  // constant goes red without being touched, and it is on this slice's prediction
  // because the prediction was built by grepping the FILE, not the figure names.
  // ⚠️ NO `fix-*` DEMONSTRATOR: Pokémon BODIES driven on a LOCAL `cardPool`
  // (D275's idiom), and neither `sv09` nor `svp` is one of `catalogManifest`'s six
  // sets (sv01/sv02/sv03/sv06.5/sve/swsh10.5), so a shared-pool body would have
  // owed a `fix-*` key here — and `FIXTURE_POOL` IS A CENSUSED POPULATION
  // (`catalogManifest.test.ts`, `clauseApostrophe.test.ts`), which is D348's
  // two-red-suite lesson standing.
  "sv09-067": INVITING_WINK, // Lillie's Ribombee — "Inviting Wink" (Stage 1 out of Lillie's Cutiefly)
  "sv09-164": INVITING_WINK, // Lillie's Ribombee (illustration rare) — same sentence, same object
  "svp-183": INVITING_WINK, // Lillie's Ribombee (promo) — same object
  // 🆕🆕 D351 — THE PRINTED TWO-TYPE DISJUNCTION, READ AS TWO OPS. Infernape ×3 is
  // the whole legal population of its sentence and three of backlog row 12's four
  // remaining `abilityIds`; with it the row's ability half falls 4 → 1 and what is
  // left is `sv09-107`'s *"whenever you attach"* TRIGGER KIND alone.
  // ⚠️ THREE NEW IDS, ALL NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length`
  // step by **+3 each** and stay 0 apart, for the ELEVENTH slice running.
  // ⚠️ `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `svp-183` to `sv06-173` — the NINTH consecutive slice on which that
  // constant goes red without being touched. It was on this slice's prediction
  // because the prediction split the two things called `raw` into two paragraphs
  // (a REGISTRY-keyed figure and a READER-keyed one) before copying either.
  "svp-116": PYRO_DANCE, // Infernape (promo) — "Pyro Dance"
  "sv06-033": PYRO_DANCE, // Infernape — same sentence, same object
  "sv06-173": PYRO_DANCE, // Infernape (illustration rare) — same object
  // 🆕🆕 D352 — BACKLOG ROW 11's ABILITY HALF, CLOSED. Metang ×2 is the entire
  // Standard-legal population of `attachFromTop`, and Morpeko ×1 is the Ability
  // surface of a sentence the attack deriver has read since D241. With these three
  // the row's `abilityIds` is EMPTY (its `effectIds` closed at D344), so row 11's
  // whole non-attack residue is 0 and `ROWS`' total falls 13 → 10.
  // ⚠️ THREE NEW IDS, ALL NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length`
  // step by **+3 each** and stay 0 apart, for the TWELFTH slice running.
  // ⚠️ TWO CARD NAMES, NOT ONE — so `ABILITY_D1_SHAPE.distinctNames` steps **+2**
  // and `groups.length` steps **+2**, breaking the 3:1:1 shape five consecutive
  // slices ran on. A step's SHAPE is a property of the row, not of the run.
  // ⚠️ `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `sv06-173` to `sv06-072` — the TENTH consecutive slice on which that
  // constant goes red without being touched, and the sixth to have it predicted.
  "svp-090": METAL_MAKER, // Metang (promo) — "Metal Maker"
  "sv05-114": METAL_MAKER, // Metang — same sentence, same object
  "sv06-072": SNACK_SEEK, // Morpeko — "Snack Seek"
  // 🆕🆕 D353 — BACKLOG ROW 9's ABILITY HALF, CLOSED. Lycanroc ×2 is the entire
  // Standard-legal population of the by-NAME attach narrowing, so row 9's
  // `abilityIds` goes 2 → EMPTY and `ROWS`' non-attack total falls 10 → 8. The
  // five `effectIds` that remain are the two REFUSED banner rows (Reboot Pod,
  // Glass Trumpet — no catalog column classifies Ancient/Future) and Powerglass
  // ×2, refused on price; none is reachable by an engine slice today.
  // ⚠️ TWO NEW IDS, BOTH NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length`
  // step by **+2 each** and stay 0 apart, for the THIRTEENTH slice running.
  // ⚠️ ONE CARD NAME AND ONE PROGRAM OBJECT, so `ABILITY_D1_SHAPE.distinctNames`
  // and `groups.length` each step **+1** — the 2:1:1 shape, not D352's 3:2:2.
  // ⚠️ `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `sv06-072` to `sv09-166` — the ELEVENTH consecutive slice on which
  // that constant goes red without being touched, and the seventh predicted.
  "sv09-085": SPIKE_CLAD, // Lycanroc — "Spike-Clad"
  "sv09-166": SPIKE_CLAD, // Lycanroc (illustration rare) — same sentence, same object
  // 🆕🆕 D354 — BACKLOG ROW 10's ABILITY HALF, CLOSED. Steven's Metagross ex is
  // the entire Standard-legal population of the TWO-TYPE attach target (1 of 1
  // over all three columns), so row 10 falls 2 → 1 and `ROWS`' non-attack total
  // falls 8 → 7. The id that remains is row 10's `effectIds` half, Energy Coin
  // `sv10.5b-081` — *"Flip 2 coins. If both of them are heads, …"*, a coin GATE
  // on a Trainer, which this slice does not touch.
  // ⚠️ ONE NEW ID, NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length` step
  // by **+1 each** and stay 0 apart, for the FOURTEENTH slice running.
  // ⚠️ ONE PRINTING, ONE CARD NAME, ONE PROGRAM OBJECT — a 1:1:1 step, narrower
  // than D353's 2:1:1 and D352's 3:2:2. A step's SHAPE is a property of the row.
  // ⚠️ `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `sv09-166` to `sv10-145` — the TWELFTH consecutive slice on which
  // that constant goes red without being touched, and the eighth predicted.
  "sv10-145": X_BOOT, // Steven's Metagross ex — "X-Boot"
  // 🆕🆕 D355 — BACKLOG ROW 10 IS **CLOSED**. Energy Coin `sv10.5b-081` is the
  // `effectIds` half D354 left, and it is the entire Standard-legal population of
  // its clause: *"both of them are heads"* over all three text columns is 6
  // printings / 5 sentences / **1 legal** (`effect` 2/2/1, `attacks_json` 4/3/0,
  // `abilities_json` 0), and the one legal printing is this card. Row 10 falls
  // 1 → **0** and `ROWS`' non-attack total falls **7 → 6**, leaving rows 9 (five
  // ids, ALL refused on grounds no engine slice can reach) and 12 (Magearna
  // `sv09-107`, a whole new trigger point) — so the LIVE residue is **1**.
  // 🛑 D356 — **THAT PARENTHETICAL WAS WRONG WHEN IT WAS WRITTEN, AND IS LEFT
  // STANDING SO THE ERROR IS READABLE.** `sv09-107` was not "a whole new trigger
  // point": `onEnergyAttach` had been a `TriggerTiming` since D319 and this file
  // said so eight lines under the union. The row is built below.
  // ⚠️ ONE NEW ID, NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length` step
  // by **+1 each** and stay 0 apart, for the FIFTEENTH slice running.
  // ⚠️ A **TRAINER**, so every ABILITY instrument stands still — and for a THIRD
  // distinct reason rather than D353's or D350's: this card has NO `attacks_json`
  // and NO `abilities_json` at all, so there is no sentence for either reader to
  // be given or denied. `ABILITY_D1_SHAPE`, `ABILITY_D1_COLUMNS`, `groups.length`
  // and `pairs.size` are all unmoved BY MEASUREMENT, not by assumption.
  // ⚠️ `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `sv10-145` to `sv10.5b-081` — the THIRTEENTH consecutive slice on
  // which that constant goes red without being touched, and the ninth predicted.
  "sv10.5b-081": ENERGY_COIN, // Energy Coin — two-coin gate → search a Basic Energy → attach
  // 🆕🆕 D356 — BACKLOG ROW 12's ABILITY HALF, CLOSED, AND WITH IT THE `ROWS`
  // TABLE'S LAST LIVE RESIDUE. Magearna `sv09-107` "Auto Heal" is the entire
  // Standard-legal population of *"whenever you attach"*: 3 rows over
  // `abilities_json`, 0 over `attacks_json`, 0 over `effect`, and 2 of the 3 are
  // `legal_standard = 0` (Minior `sv04-099`/`sv04-201`, the SAME timing with a
  // switch consequent). `ROWS`' non-attack total falls **6 → 5** and the LIVE
  // residue falls **1 → 0** — what is left is row 9's five ids, every one refused
  // on grounds no engine slice can reach.
  // 🛑 THE PRICE THE TWO PRIOR SLICES REFUSED WAS NEVER OWED. D354 and D355 both
  // called this "a whole new trigger point"; `onEnergyAttach`, its fire site, the
  // `watch` partition and `activeOnly` all already existed, and D319's own comment
  // on the union member says the self direction was "waiting for its first
  // printing". What was owed was a self-direction sweep and one new op.
  // ⚠️ ONE NEW ID, NON-ATTACK, so `nonAttackRegistryIds()` and `raw.length` step
  // by **+1 each** and stay 0 apart, for the SIXTEENTH slice running.
  // ⚠️ AN **ABILITY**, so every ability instrument MOVES — the opposite of D355's
  // Trainer, and the reason its "third distinct ground" paragraph does not apply
  // here. `BUILT.ability` and the three-column sum both step +1, and the
  // three-column sum is an ABILITY mover BECAUSE OF WHAT IT SUMS, not where it sits.
  // ⚠️ ONE PRINTING, ONE CARD NAME, ONE PROGRAM OBJECT — a 1:1:1 step.
  // ⚠️ `censusAtHead`'s `raw[raw.length - 1]` rung is keyed on INSERTION ORDER and
  // moves from `sv10.5b-081` to `sv09-107` — the FOURTEENTH consecutive slice on
  // which that constant goes red without being touched, and the tenth predicted.
  "sv09-107": AUTO_HEAL, // Magearna — "Auto Heal", the self direction's first printing
};

/** The authored program for a catalog card id, or undefined when the card has
    none (an unsimulated Trainer/Ability, or a Pokémon whose attacks are wholly
    text-derived). */
export function programFor(cardId: string): CardProgram | undefined {
  return REGISTRY[cardId];
}

/** Every catalog id this registry programs. NOT re-exported from the package
    index — `REGISTRY` itself stays private, and no runtime consumer should be
    iterating card programs — but an in-suite AUDITOR over the authored pool has
    no other way to be real. D272 needed one and would otherwise have shipped a
    guard that enumerated a fixture list instead of the registry, which is the
    vacuous-guard defect this repo has caught eight times: a pool claim asserted
    against a hand-written pool cannot go red when the POOL grows. */
export function registryCardIds(): string[] {
  return Object.keys(REGISTRY);
}
