import type { BasicEnergyType } from "@luminous/schema";
import { ANY_ENERGY } from "./cards";
import type { PokemonSuffix, PreventedAttackerClass } from "./cards";
import type { BoardCondition, CardFilter, EffectOp, PokemonType } from "./effects";
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
  /** §9/§15.J — usable once per turn per Pokémon (tracked in TurnAllowances). */
  oncePerTurn: boolean;
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
      the Energy this sentence moves — to the discard pile. */
export type TriggerTiming =
  | "onPlayToBench"
  | "onEvolve"
  | "betweenTurns"
  | "onKnockOut"
  | "onDamagedByAttack"
  | "onAllyActiveKnockOut";

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
  onKoPrizeReduction?: { by: number; requiresInPlay: string };
}

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
      printed cards rather than off a constructed record. */
  seatDamageReductionAfterWR?: number;
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
      Sinistcha `sv10-048`.

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
      it first. */
  noRetreatCostAura?: { requiresEnergyType?: BasicEnergyType };
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
      Stadium ± deltas it also reaches a non-Basic Active. */
  opponentActiveRetreatSurcharge?: number;
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
      same line). */
  noRetreatCostSelf?: { requiresOpponentSuffixInPlay?: PokemonSuffix };
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
  /** 🆕 D262 — Neo Upper Energy `sv05-162`: the units provided INSTEAD when the
      HOLDER is a **Stage 2** Pokémon (*"If this card is attached to a Stage 2
      Pokémon, this card provides every type of Energy but provides only 2 Energy
      at a time."*).

      THE SECOND CONDITIONAL PROVISION AND THE SIBLING OF THE FIELD ABOVE, and it
      is deliberately a SECOND FIELD rather than a widened first one: both answer
      *"provides X instead when <condition about the holder>"*, but the conditions
      are about different things — one about the holder's OTHER attached Energy,
      one about the holder's printed STAGE — and a single field would have to carry
      a discriminant to say which. Two optional fields make the pair a compiler
      fact; `continuous.ts unitsOf` reads them in field order and NO printing in
      this pool carries both, so the order is unobservable and is documented there
      rather than asserted.

      ⚠️ THE VALUE IS A **MULTISET OF UNITS**, WHICH IS THE HALF THAT CAN GO WRONG.
      `[ANY_ENERGY, ANY_ENERGY]` is TWO wildcard units — "every type of Energy but
      only **2** at a time" — and not one wildcard worth two. `costMet` (attack.ts)
      consumes the flat list, so a row with a single entry pays every one-symbol
      cost and fails only a two-symbol one; a mutant that drops the second entry is
      in the corpus for exactly that reason. */
  promoteOnStage2Holder?: string[];
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

export interface CardProgram {
  /** Registry-authored attack programs, keyed by ATTACK INDEX (the position in
      the card's printed `attacks` list — the same index the `attack` action
      carries). A card authors only the attacks whose printed sentence the deriver
      refuses; the rest fall back to `deriveAttackEffect` (or stay unsimulated).
      Sits ABOVE the deriver (D8): `programFor(id)?.attack?.[index] ?? derive`.
      Chien-Pao ex "Hail Blade" (sv02-061 idx 0, D96) was the first; Mewtwo VSTAR
      "Psy Purge" (swsh10.5-031 idx 0, D97) the second — and the first on a
      MULTI-attack card, which is WHY this is index-keyed: its idx-1 "Star Raid"
      must fall through to unsimulated, not inherit Psy Purge's program. */
  attack?: { readonly [attackIndex: number]: EffectOp[] };
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
    authored (not derived) because the printed sentence is a variable-count park
    the deriver deliberately refuses (effects.ts). The printed "60×" base is
    suppressed (attack.ts) — the program owns the damage. */
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
    (`cap: 3` bounds the `count: "any"` up-to). Registry-authored at INDEX 0 — the
    deriver refuses the sentence exactly as it does Hail Blade's, and this is the
    first authored attack on a MULTI-attack card: index 1 "Star Raid" (the VSTAR
    Power spread onto opponent's Pokémon V) is NOT authored, so it falls through to
    unsimulated rather than inheriting Psy Purge's program. See D97. */
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

/** Poltchageist (sv06-020/-171) "Curious Tea Party" and Sinistcha (sv10-048)
    "Curious Tea Party" — "As long as this Pokémon is on your Bench, prevent all
    damage from and effects of attacks from your opponent's Pokémon done to this
    Pokémon." THREE Standard-legal printings on ONE sentence, ONE object shared by
    all three (an evolution LINE plus a reprint — Sinistcha evolves from
    Poltchageist and reprints the Ability verbatim, which is why the two rows are
    not two programs).

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
const TRAP_TERRITORY: CardProgram = { passive: { opponentActiveRetreatSurcharge: 1 } };

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
    not modify its holder alone. */
const HARIYAMA: CardProgram = { passive: { seatDamageReductionAfterWR: 10 } };

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
    two attachEnergyFrom ops in a row (each parks on its own Basic {F} target; the
    second no-ops if a single {F} was in the discard), and `endsTurn` folds the
    turn end. once/turn, not Active-only. */
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
        },
        {
          op: "attachEnergyFrom",
          source: "discard",
          energyType: "Fighting",
          targetType: "Fighting",
          basicOnly: true,
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
    - "**Discard** the other cards" → `discardRest`. That clause is the card's
      real cost, and it is charged on every path — including a whiffed look and a
      declined attach — which is exactly why it lives on the op rather than in a
      trailing op the way Electric Generator's shuffle does.

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
        { op: "attachFromTop", n: 3, filter: { kind: "anyEnergy" }, max: "any", discardRest: true },
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
    - playable with nothing damaged anywhere — `programPlayable` has never had
      a heal branch (Potion and Fighting Au Lait's heal are the same call), so
      a full-HP board can spend the turn's Supporter on nothing; the prompt's
      honest "Take none" is the mitigation, and the wart stays on the
      carried-forward list with its two siblings.
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
const BITING_SPREE: CardProgram = {
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
    `BATTLE_HARDENED`'s does — the attach itself PARKS and a park is declinable
    by construction, so nothing is forced on the controller. ZERO new ops, ZERO
    new op fields: `onEvolve` (M4 slice 6 / D250), `energyType`, `targetType`
    (D235) and `source: "discard"` (D234) were all lying around. */
const ASSEMBLE_ALLOY: CardProgram = {
  triggered: [
    {
      name: "Assemble Alloy",
      trigger: "onEvolve",
      optional: true,
      program: [
        { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },
        { op: "attachEnergyFrom", source: "discard", energyType: "Metal", targetType: "Metal" },
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
    is the same. 2 legal printings of 2. */
const KOFU: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 2, to: "deckBottom", recordAs: "paid" },
    {
      op: "recordGate",
      slot: "paid",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      then: [{ op: "drawCards", count: 4 }],
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
  energy: { provides: ["Colorless"], promoteOnStage2Holder: [ANY_ENERGY, ANY_ENERGY] },
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
    it was written about; this is the Pokémon one, and it does.) Index 1 "Fade
    Out" is left unauthored. 1 legal printing of 1. */
const INVITING_FLOWERS: CardProgram = {
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
    ex in play are two independent uses, which is the print. `activeOnly: false`:
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

/** card id → program. Reprints of the same card (identical text) map to the
    same program object; keyed by id per D8, so an unauthored reprint id simply
    falls through to the loud "not simulated" path until its id is added. */
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
  "sv10-122": BITING_SPREE, // Team Rocket's Crobat ex — "Biting Spree" (mark I)
  "sv10-217": BITING_SPREE, // (reprint)
  "sv10-234": BITING_SPREE, // (reprint)
  "sv10-242": BITING_SPREE, // (reprint)
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
  "sv06.5-061": NIGHT_STRETCHER, // Night Stretcher (Item, mark H)
  "sv08-251": NIGHT_STRETCHER, // (reprint)
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
  // FIXTURE demonstrators — synthetic `fix-*` bodies (never catalog rows) that
  // carry the 28 programs so `legalNonAttackPrograms.test.ts` can DRIVE each one
  // through the real engine. D190's idiom and D190's reason: a fixture id naming
  // a real printing must appear in `catalogManifest.ts`, which is generated off
  // the LOCAL sqlite — absent in this clone (`SQLITE_CANTOPEN`) and measuring a
  // 978-row / 6-set catalog that holds none of sv05 / sv07 / sv08 / sv08.5 /
  // sv09 / sv10 / sv10.5b / sv10.5w / svp anyway. `createGame` takes its
  // `cardPool` as a PARAMETER, so the demonstrator pool stays local to the suite
  // and `FIXTURE_POOL` is not touched.
  "fix-bitingspree": BITING_SPREE,
  "fix-sneakybite": SNEAKY_BITE,
  "fix-attractcustomers": ATTRACT_CUSTOMERS,
  "fix-scaldingsteam": SCALDING_STEAM,
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
  // D200 — the owner-prefix subgroup rows (5 programs / 6 Standard-legal
  // printings). Real ids first, then their `fix-*` demonstrators, D190's idiom.
  "sv10-103": CHAMPIONS_CALL, // Cynthia's Gabite — "Champion's Call" (Ability, mark I)
  "sv10-050": SWIM_TOGETHER, // Misty's Lapras — "Swim Together" (attack 0, mark I)
  "sv10-194": SWIM_TOGETHER, // Misty's Lapras (illustration rare) — same sentence
  "sv09-147": HOPS_BAG, // Hop's Bag (Item, mark I)
  "sv10-083": SUMMONING_SIGN, // Steven's Baltoy — "Summoning Sign" (attack 0, mark I)
  "sv09-068": INVITING_FLOWERS, // Lillie's Comfey — "Inviting Flowers" (attack 0, mark I)
  "fix-championscall": CHAMPIONS_CALL,
  "fix-swimtogether": SWIM_TOGETHER,
  "fix-hopsbag": HOPS_BAG,
  "fix-summoningsign": SUMMONING_SIGN,
  "fix-invitingflowers": INVITING_FLOWERS,
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
  "sv08.5-168": SEASONED_SKILL,
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
  // D253 — Poltchageist / Sinistcha "Curious Tea Party", the LARGEST row of the
  // 4-sentence family D252 censused: the same WIDE spelling with the attacker
  // predicate gone and a holder-ZONE gate in its place. THREE printings on ONE
  // sentence. ✅ THE COUNT WAS D252's TRANSCRIBED ROW AT D253 AND IS RE-DERIVED AT
  // D254 — the row measures 3 on these three ids.
  // ✅ AND THE FAMILY'S LAST PRINTING IS TAKEN BELOW: `sv05-024`, a seat-wide aura
  // over your BENCHED Pokémon. ⚠️ The note this block used to carry called it
  // "`benchShieldedByActive`'s shape"; it shares that scan's TARGET clause and
  // prints NO source clause at all, which is the whole of D254's finding.
  "sv06-020": CURIOUS_TEA_PARTY, // Poltchageist — "Curious Tea Party"
  "sv06-171": CURIOUS_TEA_PARTY, // (reprint)
  "sv10-048": CURIOUS_TEA_PARTY, // Sinistcha — the evolution, same sentence
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
};

/** The authored program for a catalog card id, or undefined when the card has
    none (an unsimulated Trainer/Ability, or a Pokémon whose attacks are wholly
    text-derived). */
export function programFor(cardId: string): CardProgram | undefined {
  return REGISTRY[cardId];
}
