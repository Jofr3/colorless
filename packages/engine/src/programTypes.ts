import type { BasicEnergyType } from "@colorless/schema";
import type { Banner } from "./banners";
import type { PokemonSuffix, PreventedAttackerClass } from "./cards";
import type {
  AttackTimingGate,
  BoardCondition,
  CardFilter,
  EffectOp,
  HandPlayClass,
  PokemonPlayAct,
  PokemonType,
} from "./effectTypes";
import type { StatusName } from "./events";

// The shapes of the id-keyed card programs `registry.ts` authors.

export type { AttackTimingGate };

/**
 * A card's activated Ability (§9). Passive abilities are `passive`; triggered ones are `triggered`.
 */
export interface AbilityProgram {
  name: string;
  /**
   * §9 usable once per turn per Pokémon (tracked in TurnAllowances); "Once during your turn" limits
   * this body, so two copies can each be used.
   */
  oncePerTurn: boolean | "sharedByName";
  /**
   * §9 the Ability's printed board gate (Fezandipiti ex), sharing `BoardCondition` with
   * `trainerPlayableIf`.
   */
  playableIf?: BoardCondition;
  /**
   * §9 per-body gate: "if this Pokémon's remaining HP is 30 or less" (Pidove — Emergency
   * Evolution).
   */
  remainingHpAtMost?: number;
  /** §9 per-body gate: "if this Pokémon has any {D} Energy attached" (Munkidori — Adrena-Brain). */
  requiresEnergyType?: BasicEnergyType | "any";
  /**
   * §9 per-body gate: usable only on the turn this body moved from the Active Spot to the Bench
   * (Clawitzer — Fall Back to Reload).
   */
  benchedThisTurn?: true;
  /** The Ability may only be used while this Pokémon is the Active (Chien-Pao's
      "if this Pokémon is in the Active Spot"). */
  activeOnly: boolean;
  /**
   * The Ability may only be used while this Pokémon is on the Bench (Misty's Psyduck — Flustered
   * Leap); the mirror of `activeOnly`.
   */
  benchOnly?: true;
  /** The Ability ENDS the controller's turn once its program completes
      (Koraidon "Dino Cry": "If you use this Ability, your turn ends."). Folded by
      flow.ts settleProgram — instead of returning to turn:action, it seeds the
      turn tail. Assumes the program does not damage (Koraidon attaches Energy). */
  endsTurn?: true;
  /** The op program `useAbility` runs (may park like a Trainer's). */
  program: EffectOp[];
}

/** When a triggered Ability (§9) fires. */
export type TriggerTiming =
  | "onPlayToBench"
  | "onEvolve"
  | "betweenTurns"
  | "onKnockOut"
  | "onDamagedByAttack"
  | "onAllyActiveKnockOut"
  | "onEnergyAttach"
  /** The moment a seat's Active Pokémon moves to the Bench (Magcargo — Lava Zone). */
  | "onActiveMovedToBench"
  /**
   * A Tool's trigger when its holder is Knocked Out in the Active Spot by damage from an opponent's
   * attack (Heavy Baton); runs before the stack is discarded.
   */
  | "onHolderActiveKnockedOut"
  /**
   * A Tool's trigger when its holder, Active or Benched, is Knocked Out by damage from an
   * opponent's attack (Amulet of Hope); runs after the Knock Out.
   */
  | "onHolderKnockedOut"
  /** A Tool's end-of-turn trigger while its holder is in the Active Spot (Powerglass). */
  | "atEndOfYourTurnInActive"
  /**
   * An Ability's trigger when this Pokémon is Knocked Out in the Active Spot by damage from an
   * opponent's attack (Miraidon — Photon Cord); runs before the stack is discarded.
   */
  | "onSelfActiveKnockedOut";

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
  /** Fires only while this Pokémon is in the Active Spot (Trevenant). */
  activeOnly?: boolean;
  /**
   * Which seat's actions the trigger watches (e.g. "Whenever your opponent…"); a scan direction,
   * not a separate timing.
   */
  opponentAction?: true;
  /**
   * The printed "Once during your turn" on a triggered Ability (Palafin — Zero to Hero), keyed
   * through `abilityUsedKey`.
   */
  oncePerTurn?: true | "sharedByName";
  /**
   * "The effect of {name} doesn't stack": the board sweep fires the ability name at most once
   * however many bodies print it.
   */
  doesNotStack?: true;
  /**
   * `onKnockOut` only: a coin-flip Prize denial (Glimmora — Shattering Crystal), resolved by the KO
   * sweep rather than the interpreter.
   */
  onKoPrizeGuard?: "coinFlipPrevent" | "pokemonExAttackPrevent";
  /**
   * `onKnockOut` only: the program runs only if the Knock Out was by damage from an opponent's
   * attack (Pecharunt — Final Chain).
   */
  byOpponentAttack?: true;
  /** `onKnockOut` only: a cause-conditioned Prize reduction (Munkidori ex — Oh No You Don't). */
  onKoPrizeReduction?: KoPrizeReduction;
}

/**
 * §8.1 cause-conditioned Prize reduction, shared so an attached card can carry the same sentence.
 */
export interface KoPrizeReduction {
  /** How many Prize cards fewer. `1` on all three carriers today; CLAMPED at 0 by
      the read site, so "1 fewer" than a 1-Prize Pokémon is 0 and never −1. */
  by: number;
  /** Munkidori ex's board clause — *"if you have any Pecharunt ex in play"* —
      matched on the card NAME, scanned on the KO'd body's OWN side. */
  requiresInPlay?: string;
  /**
   * Owner-prefix gate on the holder's top card name (Lillie's Pearl: "If the Lillie's Pokémon this
   * card is attached to…"); exact case, trailing space significant.
   */
  requiresHolderOwner?: string;
  /**
   * Once-per-game latch key naming the printed effect, shared by every printing of it (Legacy
   * Energy).
   */
  oncePerGame?: string;
}

/** §8.1 what `PassiveEffects.hpBonusPer` counts to scale its max-HP grant. */
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
  /** `damageReductionAfterWR` gated on the holder's in-play type (Rock Chestplate). */
  damageReductionAfterWRIfType?: { amount: number; type: PokemonType };
  /**
   * §8.5 `damageReductionAfterWR` gated on the holder having any Energy attached (Regirock — Rock
   * Armor).
   */
  damageReductionAfterWRIfEnergy?: number;
  /**
   * §8.5 a consumable post-W/R reduction against one attacker type (the type Berries), discarded
   * after use.
   */
  damageReductionAfterWRFromTypeThenDiscard?: { amount: number; type: PokemonType };
  /**
   * §8.5 `damageReductionAfterWR` gated on the attacker's class (Sacred Charm, Thick Scale).
   * `holderAtFullHp` also requires the holder to have no damage counters when the damage is dealt.
   */
  damageReductionAfterWRFromAttacker?: {
    amount: number;
    attacker: CardFilter;
    holderType?: PokemonType;
    holderAtFullHp?: true;
  };
  /**
   * §8.1 Survival Brace: at full HP, survives a Knock Out from an opponent's attack with 10 HP,
   * then the Tool is discarded.
   */
  survivesKoAtFullHpFromOpponentThenDiscard?: true;
  /**
   * §9 Deluxe Bomb: when the Active holder is damaged by an opponent's attack, put 12 damage
   * counters on the Attacking Pokémon, then discard this card.
   */
  damageAttackerActiveThenDiscard?: number;
  /**
   * §9 Tremendous Bomb: as Deluxe Bomb, but only for a non-Mega holder taking 240 or more damage
   * from a Mega Evolution Pokémon ex.
   */
  damageAttackerActiveThenDiscardIf?: {
    amount: number;
    minDamage: number;
    attacker: CardFilter;
    holderNot: CardFilter;
  };
  /**
   * §8.5 own-side aura: while this Pokémon is in play, all its controller's Pokémon take this much
   * less attack damage after W/R (Hariyama).
   */
  seatDamageReductionAfterWR?: {
    amount: number;
    beneficiary?: CardFilter;
    /**
     * Beneficiary clause: only Pokémon with any {M} Energy attached get the reduction (Klinklang —
     * Gear Coating).
     */
    beneficiaryHasEnergy?: BasicEnergyType;
    sourceOnBench?: true;
    /** Gates the aura on the source being in its side's Active Spot (Antique Armor Fossil). */
    sourceActive?: true;
    otherNamedInPlay?: string;
    noStack?: string;
  };
  /** §8.5 seat-wide pre-W/R damage aura to the opponent's Active (Serperior ex — Regal Cheer). */
  seatDamageBonusBeforeWR?: {
    amount: number;
    beneficiary?: CardFilter;
    /**
     * Narrows which defender the bonus applies to (Carracosta: "…to your opponent's Active
     * Evolution Pokémon").
     */
    target?: CardFilter;
    noStack?: string;
    /**
     * Excludes attackers by name from the beneficiary (Iron Crown ex: "except any Iron Crown ex").
     */
    exceptName?: string;
  };
  /** §8.1 seat-wide Prize bonus for a Knock Out on the other board (Togekiss — Wonder Kiss). */
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
  /**
   * Like `damageBonusBeforeWR`, but only while a board condition holds for the attacking seat
   * (Defiance Band).
   */
  damageBonusBeforeWRIf?: { amount: number; cond: BoardCondition };
  /** §8.5 pre-W/R bonus per Prize card the opponent has taken (Kingambit — Supreme Overlord). */
  damageBonusBeforeWRPerOpponentPrize?: number;
  /**
   * Like `damageBonusBeforeWR`, but only when the defender has a given rule-box suffix (Choice
   * Belt).
   */
  damageBonusBeforeWRIfTarget?: {
    amount: number;
    targetSuffix: PokemonSuffix;
    holder?: CardFilter;
  };
  /** Max-HP added while the holder's TOP card is a Basic Pokémon (Bravery
      Charm — "The Basic Pokémon this card is attached to gets +50 HP");
      evolving the holder ends it, the Tool staying attached notwithstanding.
      This is the one effect that can LOWER effective max HP on evolution: a
      charmed Basic damaged into the window is Knocked Out the instant it
      evolves (§8.1), which `evolve` checks via the mid-turn KO flow
      (turn.ts evolve → flow.ts resolveMidTurnKnockOuts). */
  basicHpBonus?: number;
  /**
   * §8.1 flat max-HP bonus with no stage clause, optionally gated on an owner prefix (Hero's Cape,
   * Cynthia's Power Weight).
   */
  hpBonus?: {
    amount: number;
    beneficiary?: CardFilter;
    requiresEnergyType?: BasicEnergyType | "special";
    requiresEnergyCount?: number;
  };
  /** §8.1 max HP added once per something counted on the live board. */
  hpBonusPer?: { amount: number; scale: MaxHpScale };
  /**
   * Seat-wide max-HP aura: all of the holder's Pokémon in play, itself included, get `amount` more
   * HP. Read by a board scan (`seatMaxHpBonus`), not folded into `hpBonus`. `noStack` keys the
   * ledger on the ability name, so two copies of the same Ability count once.
   */
  seatHpBonus?: { amount: number; ability: string; noStack?: true };
  /**
   * §9 reactive recoil: when this Pokémon is damaged by an opponent's attack, this many HP of
   * damage counters go on the Attacking Pokémon, even if this Pokémon is Knocked Out. Applied
   * before the §8.1 sweep so a lethal recoil KOs the attacker. Only the main-hit Active defender
   * retaliates; `perAttachedEnergy` multiplies by attached Energy of that type, and `holderType`
   * gates on the holder's in-play types.
   */
  damageAttacker?: {
    amount: number;
    requiresTool?: boolean;
    perAttachedEnergy?: BasicEnergyType;
    holderType?: PokemonType;
  };
  /**
   * §8.1 recoil paid only when the holder is Knocked Out by damage from an opponent's attack, in
   * HP. A separate field from `damageAttacker` because that one pays on mere damage. The read site
   * scans the whole KO'd board, so a benched holder retaliates too unless `activeOnly` (checked
   * before the body leaves play).
   */
  damageAttackerOnKo?: { amount: number; activeOnly?: true };
  /**
   * §9 recoil from an Ability about the controller's Active: when that Active (filtered by
   * `activeType` or `activeNames`) is damaged by an opponent's attack, `amount` HP of counters go
   * on the attacker. The holder may be on the Bench; each holder pays its own amount.
   */
  damageAttackerWatched?: {
    amount: number;
    activeType?: PokemonType;
    activeNames?: readonly string[];
  };
  /**
   * §7.4 raised Tool cap: while a holder with a live Ability is in play, each of its owner's
   * Pokémon whose name contains `nameContains` may carry `cap` Tools. Multiple holders do not
   * stack; when the Ability goes away, extra Tools are discarded down to one.
   */
  toolCapForName?: { nameContains: string; cap: number };
  /**
   * §9 Damage counters on any Pokémon in play can't be moved; counter-move ops whiff while a live
   * holder is on either board.
   */
  countersCantMove?: true;
  /**
   * §8.5 While a live holder's own board has a Pokémon named `name`, Weakness for both Active
   * Pokémon applies as `amount`.
   */
  weaknessTimesWithNamedInPlay?: { name: string; amount: number };
  /**
   * §6.3 Each Basic Energy of this type attached to the holder's side provides two units. Card
   * counts do not change, and several holders do not stack.
   */
  basicEnergyProvidesTwice?: BasicEnergyType;
  /**
   * §11 When the opponent's Active retreats, they flip a coin; on tails the Active stays, keeps its
   * Energy, and the retreat is still spent. The value is the Ability name; several holders do not
   * stack.
   */
  retreatFailsOnTails?: string;
  /**
   * §8 Tool that lets the controller, once per turn, redo the coin flips of an attack by a holder
   * of `holderType`. `name` is the once-per-turn key. Silenced by Jamming Tower.
   */
  reflipAttackCoins?: { name: string; holderType: PokemonType };
  /**
   * §8.1 Prize reduction from an attached card when the holder is Knocked Out by damage from an
   * opponent's attack. Collected as a list rather than summed, because sources can differ in their
   * riders (such as a once-per-game cap).
   */
  onKoPrizeReduction?: KoPrizeReduction;
  /**
   * §8.1 If this Pokémon has full HP and would be Knocked Out by damage from an attack, it survives
   * with 10 HP. Applied as a clamp at the damage writes, because the KO sweep no longer sees the
   * pre-damage HP. Placed counters are not damage, so they bypass it.
   */
  survivesKoAtFullHp?: true;
  /**
   * If this Pokémon would be Knocked Out by damage from an attack, flip a coin; on heads it
   * survives with 10 HP. The value is the Ability name. Asked only when the full-HP clamp did not
   * apply; placed counters are not damage.
   */
  survivesKoOnCoinFlip?: string;
  /**
   * If this Pokémon is Knocked Out by damage from an opponent's attack, flip a coin; on heads the
   * Attacking Pokémon is Knocked Out (not damaged, so no survival clamp applies). The value is the
   * Ability name.
   */
  koAttackerOnCoinFlip?: string;
  /**
   * §9 Ability-lock aura: while this Pokémon is in play (and Active when `requiresActive`), every
   * in-play Pokémon matching the target predicate has no Abilities. It reaches other Pokémon, so it
   * is read by a both-boards scan, and only the top card grants it. Locks that silence each other
   * are settled by `disabledAbilityUids`.
   */
  disableAbilities?: {
    /** Target must be this stage; omitted means any stage. */
    stage?: "Basic" | "Stage2";
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
    /** The aura is live only while the source is on its Bench. */
    sourceOnBench?: true;
    /**
     * Target zone: `"active"` or `"bench"` only; omitted means both. Read live, so the target
     * changes as Pokémon move.
     */
    targetZone?: "active" | "bench";
    /** A target with this rule-box suffix keeps its Abilities (Ting-Lu: "ex" —
        "except for Pokémon ex"). */
    exemptSuffix?: PokemonSuffix;
    /** A target whose printed Ability is named this keeps it (Klefki:
        "Mischievous Lock" — "except for Mischievous Lock"). Matched against the
        target CARD's printed abilities; keeps a mirror-match Klefki's own lock on. */
    exemptAbilityNamed?: string;
    /**
     * Target must be of this printed type; omitted means any type. Reads printed types
     * deliberately, since effective types depend on `disabledAbilityUids` and would recurse.
     */
    targetType?: PokemonType;
    /** Target must have a Rule Box. */
    ruleBox?: true;
    /** A target with this banner keeps its Abilities. */
    exemptBanner?: Banner;
    /**
     * Target must have an Ability that Knocks Out the Pokémon using it (a `knockOutSelf` Ability
     * program).
     */
    selfKnockOutAbility?: true;
  };
  /**
   * §8.5 own-board aura: while this Pokémon is in play, its controller's Pokémon have no Weakness.
   * Resistance is unaffected. It reaches other Pokémon, so it is read by a dedicated scan and only
   * a top card grants it.
   */
  removeWeakness?: true;
  /**
   * §8.5 The Weakness of each opposing Pokémon of `targetType` becomes `weaknessType` ×2, replacing
   * (or granting) its printed Weakness. Effects that remove Weakness still win.
   */
  opponentWeaknessRewrite?: { targetType: PokemonType; weaknessType: PokemonType };
  /**
   * §13.2 Extra Burn damage, in HP, on the opponent's Burned Pokémon at each Checkup. Summed across
   * holders and added before the cure flip, so a Burn that heals still takes it.
   */
  opponentBurnExtraCounters?: number;
  /**
   * While a live holder is in play, the opponent's in-play Pokémon and attached cards can't be put
   * into their hand; such moves whiff. Applies to the holder's own effects too.
   */
  opponentInPlayToHandBlocked?: true;
  /**
   * When one of the holder's Pokémon of this type is Knocked Out by damage from an opponent's
   * attack, its attached Basic Energy of this type goes to the hand instead of the discard. The
   * optional effect auto-fires; multiple holders do not stack.
   */
  koBasicEnergyToHand?: BasicEnergyType;
  /**
   * If this Pokémon is Knocked Out by damage from an opponent's attack, its cards go to the hand
   * instead of the discard pile; attached Energy and Tools are discarded. The opponent still takes
   * Prizes.
   */
  koSelfToHand?: true;
  /**
   * Seat-wide Prize reduction on the KO'd side: when a matching Pokémon is Knocked Out by damage
   * from an opponent's Pokémon ex, the taker takes `by` fewer Prizes. Doesn't stack.
   */
  seatKoPrizeReduction?: { ability: string; by: number; koTarget: CardFilter };
  /**
   * §8.5 Damage from this Pokémon's attacks isn't affected by any effects on the opponent's Active
   * Pokémon. Read off the attacker through `passivesOf`, so an Ability lock silences it.
   */
  suppressTargetEffectsOnAttack?: true;
  /**
   * §8.5 Prevent all attack damage this Pokémon takes from an opponent's Pokémon ex or Pokémon V
   * (not VMAX/VSTAR). The attacker's class is checked at the read sites. No Active Spot clause, so
   * it also protects on the Bench.
   */
  preventDamageFromExV?: true;
  /**
   * §8.5 Prevent all attack damage this Pokémon takes from an opponent's Pokémon of `type`.
   * Collected as a list across sources. No Active Spot clause, so it also protects on the Bench.
   */
  preventDamageFromType?: PokemonType;
  /**
   * §8.5 Prevent all attack damage this Pokémon takes from an opponent's Pokémon that has an
   * Ability. Damage only, not effects; also protects on the Bench.
   */
  preventDamageFromHasAbility?: true;
  /**
   * §8.5/§11 Prevent all damage from and effects of attacks done to this Pokémon by opponent's
   * Pokémon with any Special Energy attached. Also protects on the Bench.
   */
  preventDamageAndEffectsFromSpecialEnergy?: true;
  /**
   * §8.5/§11 While this Pokémon is on the Bench, prevent all damage from and effects of the
   * opponent's attacks done to it.
   */
  preventDamageAndEffectsWhileBenched?: true;
  /**
   * §8.5 While this Pokémon is on the Bench, prevent all damage done to it by the opponent's
   * attacks. Damage only; effects still land. Attacks from its own side are not prevented.
   */
  preventDamageWhileBenched?: true;
  /**
   * §8.5 While the holder is on the Bench, prevent all damage done to each of its side's Pokémon by
   * attacks from opposing Pokémon with `n` or fewer Energy cards attached.
   */
  preventSeatDamageWhileBenchedFromEnergyAtMost?: number;
  /**
   * §8.5 Prevent all attack damage this Pokémon takes from opposing Pokémon of the given rule-box
   * class (e.g. ex, or Basic ex). Damage only; also protects on the Bench.
   */
  preventDamageFromAttackerClass?: PreventedAttackerClass;
  /**
   * §8.5/§11 Prevent all damage from and effects of attacks done to this Pokémon by opposing
   * Pokémon with this banner (e.g. Tera).
   */
  preventDamageAndEffectsFromBanner?: Banner;
  /**
   * §8.5 Prevent attack damage to this Pokémon from an opponent's Pokémon when that damage is this
   * amount or more (inclusive). Multiple sources take the lowest threshold.
   */
  preventDamageAtOrAbove?: number;
  /**
   * §8.5 When this Pokémon would take attack damage (and has Energy of `requiresEnergyType`, if
   * set), flip a coin; on heads prevent that damage. `ability` names the flip in the log. One flip
   * per entry; a suppressed holder flips nothing.
   */
  preventDamageOnCoinFlip?: { ability: string; requiresEnergyType?: BasicEnergyType };
  /**
   * §12 Special Conditions this Pokémon can't be given. Checked only where conditions are applied,
   * since that is the only writer of a condition.
   */
  statusImmunities?: StatusName[];
  /**
   * The opponent's Active Pokémon can't be healed while a holder is anywhere in play. Moving damage
   * counters off it is not a heal.
   */
  opponentActiveCantBeHealed?: true;
  /**
   * §12 Special Conditions this Pokémon recovers from while the effect is live. The condition is
   * actually removed, so it does not come back when the source leaves.
   */
  statusRecovery?: StatusName[];
  /**
   * §8.5 While this Pokémon is in the Active Spot, prevent all attack damage done to its
   * controller's Benched Pokémon. Read by an own-side scan; not nulled by an attack that ignores
   * effects on the target, since the source is another body.
   */
  preventBenchDamageWhileActive?: true;
  /**
   * §8.5/§11 Prevent all damage from and effects of the opponent's attacks done to the holder's
   * Benched Pokémon, the holder included. No source zone clause.
   */
  preventBenchDamageAndEffects?: true;
  /**
   * §8.5 Prevent all attack damage done to the holder's Benched Pokémon that don't have a Rule Box.
   * A benched holder shields itself.
   */
  preventBenchDamageNoRuleBox?: true;
  /**
   * §11 When the opponent plays an Item or Supporter, prevent all its effects on this Pokémon, in
   * any zone.
   */
  preventTrainerEffects?: true;
  /**
   * §11 While this Pokémon is Active, prevent all effects of the opponent's Supporters on all of
   * the holder's Pokémon, itself included.
   */
  preventSupporterEffectsWhileActive?: true;
  /** §11 When the opponent plays a Supporter, prevent all its effects on this Pokémon. */
  preventSupporterEffects?: true;
  /**
   * §7.1 While this Pokémon is in the Active Spot, the opponent can't play cards of these Trainer
   * classes from their hand.
   */
  preventOpponentHandPlay?: readonly HandPlayClass[];
  /**
   * §7.1 While this Pokémon has a Tool attached (in any zone), the opponent can't play ACE SPEC
   * cards from their hand. ACE SPEC is read from the rarity label, matching the deck builder.
   * Energy plays are not barred, since attaching Energy asks no hand-play bar.
   */
  preventOpponentAceSpecPlayWhileToolAttached?: true;
  /**
   * §7.5/§10 While this Pokémon is Active, the opponent can't play matching Pokémon from their hand
   * for the listed acts (bench, evolve). `only` narrows the Pokémon and `except` exempts from the
   * result.
   */
  preventOpponentPokemonPlay?: {
    readonly acts: readonly PokemonPlayAct[];
    readonly only?: CardFilter;
    readonly except?: CardFilter;
  };
  /**
   * §11 Prevent all effects (not damage) of the opponent's attacks done to this Pokémon. The
   * benched put-counter snipe does not ask this refusal.
   */
  preventAttackEffects?: true;
  /**
   * §11 Prevent all effects of the opponent's Pokémon's Abilities done to this Pokémon. Continuous
   * Ability auras are not refused.
   */
  preventAbilityEffects?: true;
  /**
   * §11 Prevent all effects (not damage) of the opponent's attacks on the holder's Pokémon matching
   * this filter, in any zone. Existing effects are not removed.
   */
  preventAttackEffectsForGroup?: CardFilter;
  /**
   * §11 While this Pokémon is in play, its controller's Pokémon matching `requiresEnergyType` (by
   * provision) and `stage` have no Retreat Cost. Absent fields are ungated. A set-to-zero, so it
   * wins over Stadium deltas.
   */
  noRetreatCostAura?: { requiresEnergyType?: BasicEnergyType; stage?: "Basic" };
  /**
   * §11 The opponent's Active Pokémon's Retreat Cost is `amount` {C} more, optionally only when it
   * matches `target`. A benched holder still applies it. Summed across sources and floored once.
   */
  opponentActiveRetreatSurcharge?: { amount: number; target?: CardFilter };
  /**
   * §11 The holder's side's Active Pokémon's Retreat Cost is `amount` {C} less. `sourceOnBench`
   * requires the holder to be on the Bench.
   */
  ownActiveRetreatDiscount?: { amount: number; sourceOnBench?: true };
  /**
   * §11 While both this Pokémon and the opponent's Active are in the Active Spot, the opponent's
   * Active can't retreat.
   */
  preventOpponentActiveRetreat?: true;
  /**
   * §11 This Pokémon alone has no Retreat Cost, optionally only while the opponent has a Pokémon of
   * `requiresOpponentSuffixInPlay` in play or while it has no Energy cards attached. Kept off
   * `BoardCondition` to avoid an import cycle with boardCondition.ts.
   */
  noRetreatCostSelf?: {
    requiresOpponentSuffixInPlay?: PokemonSuffix;
    requiresNoEnergyAttached?: true;
  };
  /**
   * §11 Attached Tool's discount on its holder's Retreat Cost; `freeAtRemainingHpAtMost` makes
   * retreat free at or below that remaining HP. Not §9-gated, since a Tool is not an Ability.
   */
  retreatCostDiscount?: { amount: number; freeAtRemainingHpAtMost?: number };
  /**
   * §11 While the Tool's holder is Active, both Active Pokémon's Retreat Cost is this much {C}
   * more. Stacks per Tool.
   */
  activeRetreatSurchargeBoth?: number;
  /**
   * §8.5 While both this Pokémon and the attacker are Active, the opponent's Active's attacks do
   * this much less damage before Weakness and Resistance.
   */
  opponentActiveAttackDebuff?: number;
  /**
   * §8.5 Attacks by the opponent's Active that has a Tool attached do this much less damage before
   * Weakness and Resistance. The holder may be anywhere in play.
   */
  opponentActiveToolAttackDebuff?: number;
  /**
   * §8.2 While both this Pokémon and the attacker are Active, the opponent's Active's attacks cost
   * this many {C} more. Stage-agnostic on both ends.
   */
  opponentActiveAttackCostSurcharge?: number;
  /** Narrows the surcharge above to attackers whose top card is a Basic Pokémon. */
  opponentActiveAttackCostSurchargeBasicOnly?: true;
  /**
   * §8.2 This Pokémon's attacks cost this many {C} less for each Prize the opponent has taken. No
   * floor is needed: a discount can only remove symbols that exist.
   */
  attackCostDiscountPerOpponentPrize?: number;

  /**
   * §8.2 This Pokémon's attacks cost `amount` {C} less for each card named `name` in its owner's
   * discard pile, matched by name.
   */
  attackCostDiscountPerNamedInDiscard?: { name: string; amount: number };

  /**
   * §8.2 This Pokémon's attacks cost this many {C} less for each Pokémon on the opponent's Bench.
   */
  attackCostDiscountPerOpponentBenched?: number;
  /**
   * §8.2 Attack name the self-only discounts above are limited to; absent, they apply to every
   * attack. Never scopes an attached Tool's discount.
   */
  attackCostDiscountAttack?: string;
  /**
   * §8.2 If the opponent has exactly this many cards in hand, ignore all {C} in this Pokémon's
   * attack costs, surcharges included.
   */
  ignoreColorlessCostIfOpponentHandExactly?: number;
  /**
   * §8.2 If its controller has a Pokémon of each of these names in play (Active or Bench, read off
   * the top card), ignore all {C} in this Pokémon's attack costs, surcharges included.
   */
  ignoreColorlessCostIfNamedInPlay?: readonly [string, ...string[]];
  /**
   * §8.2 Attached Tool's {C} discount on its holder's attacks. Not §9-gated. `holder` filters the
   * holder's top card; `ifMorePrizesRemaining` requires the holder's side to have strictly more
   * Prizes remaining.
   */
  attackCostDiscount?: {
    amount: number;
    holder?: CardFilter;
    ifMorePrizesRemaining?: true;
    /**
     * The discount may remove a typed Energy symbol, not only {C}; applied last, chosen against the
     * holder's attached Energy.
     */
    anyType?: true;
  };

  /**
   * §8 This Pokémon can't attack unless this condition holds. Stores the printed permission; the
   * read site negates it.
   */
  cantAttackUnless?: BoardCondition;
  /**
   * §5.3/§8 While this condition holds, this Pokémon may attack twice in a turn; if the first
   * attack Knocks Out the opponent's Active, it may attack again after a new Active is chosen.
   * Between the attacks only `attack` and `endTurn` are legal, and the second attack is a full
   * declaration.
   */
  attackTwiceIf?: BoardCondition;

  /**
   * §4 This Pokémon may attack on the going-first player's first turn. Per body, unlike per-attack
   * first-turn licences.
   */
  attackFirstTurnExempt?: true;
  /**
   * §4/§10 This Pokémon may evolve on its owner's first turn or the turn it was played, lifting
   * both bans. `activeOnly` requires it to be Active, `ifInPlay` requires a named Pokémon in play,
   * and `ifCondition` requires a board condition.
   */
  evolveEarlyExempt?: { activeOnly?: true; ifInPlay?: string; ifCondition?: BoardCondition };
  /**
   * §8.2 Cost clause an Ability prints on one of the holder's own attacks, matched by attack name.
   * Unlike `attackGate`, an Ability lock silences it.
   */
  attackCostClause?: {
    attack: string;
    gate:
      | { kind: "alternateCostIf"; condition: BoardCondition; cost: readonly string[] }
      | { kind: "costWaivedIf"; condition: BoardCondition };
  };
  /**
   * §10 This Pokémon may be evolved from the hand as if named `name`, by an evolution card with
   * suffix `intoSuffix`. Does not apply to evolving from the deck.
   */
  evolveAsNamed?: { name: string; intoSuffix: "ex" };
  /**
   * §9 The holder's full type list while in play, replacing its printed types. An Ability lock
   * restores the printed types; hand, deck and discard reads stay printed.
   */
  typesInPlay?: readonly PokemonType[];
  /**
   * Iron Treads "Dual Core": the `typesInPlay` retype applies only while a Tool with exactly this
   * card name is attached to the holder. Checked against the attached `tools` list, not
   * `toolsInEffect`, so a Tool silenced by Jamming Tower still counts; otherwise the body keeps its
   * printed card.
   */
  typesInPlayWhileToolNamed?: string;
  /**
   * Relicanth "Memory Dive": each of the seat's evolved Pokémon can also use the attacks of the
   * cards under its top card (the cards in the stack only, so a stage skipped by Rare Candy adds
   * nothing). Several holders do not stack.
   */
  memoryDive?: true;
  /**
   * Mew ex "Memory Helix": the holder can use the printed attacks of each of its controller's
   * Benched Pokémon, excluding copy-family attacks.
   */
  memoryHelix?: true;
}

/**
 * A Stadium's "once during each player's turn" activated ability (§7.3), run by the
 * `useStadiumAbility` action. It is always once per player turn (tracked by
 * `TurnAllowances.stadiumAbilityUsed`), so there is no `oncePerTurn` or `activeOnly` field. `label`
 * is the Stadium's name for the log and HUD.
 */
export interface StadiumAbility {
  label: string;
  /**
   * The printed condition between "Once during each player's turn," and the effect (Community
   * Center, Team Rocket's Factory), evaluated for the acting seat. Read by `useStadiumAbility` and
   * by both HUDs, so the option is greyed out rather than rejected after the click. Absent means
   * ungated.
   */
  playableIf?: BoardCondition;
  /**
   * When using the Stadium ends the turn: `"always"` (Lumiose City) or `"ifHealed"` (Celebratory
   * Fanfare, read off the `HEALED` rows the use emitted). Absent means the turn continues.
   */
  endsTurn?: "always" | "ifHealed";
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
  /**
   * Nighttime Mine: attacks used by Pokémon matching `attacker` (checked on the top card) cost this
   * many more {C}, added in `effectiveAttackCost`.
   */
  attackCostSurcharge?: { amount: number; attacker: CardFilter };
  /**
   * Neutralization Zone (§8.5): prevent all attack damage to Pokémon without a Rule Box, on both
   * sides, when the attacker is a Pokémon ex or V. Uses `hasRuleBox` negated for the protected body
   * and `isExOrV` for the attacker. Not suppressed by Ability locks or by `ignoreWR`, since a
   * Stadium is not an effect on a Pokémon.
   */
  preventDamageToNoRuleBoxFromExV?: true;
  /**
   * Max HP change for every Pokémon of one stage on both sides (Lively Stadium +30 Basic, Gravity
   * Mountain -30 Stage 2). One signed field. Not gated by Ability locks.
   */
  hpDelta?: {
    amount: number;
    stage: "basic" | "stage2";
    /**
     * When set, the HP change applies only to top cards with exactly this name (Ange Floette's Mega
     * Floette ex).
     */
    name?: string;
  };
  /**
   * Post-W/R reduction on attack damage to Pokémon matching `beneficiary`, on both sides (Full
   * Metal Lab, Granite Cave). Applies only to damage from the opponent's attacks:
   * `seatDamageReduction` pays nothing when the attacker's seat equals the damaged body's seat,
   * since own-bench spreads and snipes exist.
   */
  damageReductionAfterWR?: { amount: number; beneficiary: CardFilter };
  /**
   * Postwick: pre-W/R bonus on attacks by Pokémon matching `attacker`, on both sides. Stacks with
   * ability-based bonuses such as Hop's Snorlax.
   */
  damageBonusBeforeWR?: { amount: number; attacker: CardFilter };
  /**
   * Retreat Cost clause for Pokémon matching `filter`, on both sides, at any stage: `free` (N's
   * Castle) or `discount` (Paradise Resort).
   */
  retreat?: { filter: CardFilter; discount?: number; free?: true };
  /** The "once during each player's turn" activated ability (Artazon / Mesagoza
      / Town Store). A Stadium WITH this can be activated; the continuous-only
      Stadiums (Beach Court / League HQ) leave it undefined. */
  ability?: StadiumAbility;
  /**
   * Perilous Jungle: extra Poison damage (in HP) at each Checkup on both sides, skipping bodies
   * whose in-play types include `excludesType`. Summed into the single poison `COUNTERS_PLACED`
   * row.
   */
  poisonExtraCounters?: { amount: number; excludesType?: BasicEnergyType };
  /**
   * Jamming Tower: attached Tools have no effect. Read through `toolsInEffect`; Tool counts still
   * use the raw `tools` list.
   */
  toolsHaveNoEffect?: true;
  /**
   * Festival Grounds: a Pokémon with any Energy attached recovers from and cannot be affected by
   * Special Conditions.
   */
  statusShieldIfEnergyAttached?: true;
  /**
   * Team Rocket's Watchtower: {C} Pokémon in play have no Abilities. Expressed as a
   * `disableAbilities` aura so `disabledAbilityUids` and its readers handle it unchanged; it cannot
   * itself be silenced.
   */
  disableAbilities?: NonNullable<PassiveEffects["disableAbilities"]>;
  /**
   * Area Zero Underdepths: a seat with a Tera Pokémon in play may have up to this many Benched
   * Pokémon. The discard when the limit drops is handled by `benchTrimStages`.
   */
  benchLimitWithTera?: number;
  /**
   * Battle Cage: damage counters from the opponent's attack or Ability effects cannot be placed on
   * Benched Pokémon; attack damage is still taken. A move of counters onto a Benched body is
   * refused as a whole.
   */
  benchCounterShield?: true;
  /**
   * Forest of Vitality: a Pokémon whose in-play types include `type` may evolve into a card of that
   * type on the turn it was played, except during the player's first turn.
   */
  sameTurnEvolution?: { type: PokemonType };
  /**
   * Risky Ruins: whenever a player puts a Basic Pokémon (not of `excludesType`) onto their own
   * Bench during their turn, place `amount` HP of damage counters on it.
   */
  benchArrivalCounters?: { amount: number; excludesType: PokemonType };
  /** Dizzying Valley: Confused Pokémon stay Confused when they evolve or devolve. */
  confusionSurvivesStageChange?: true;
  /**
   * Ange Floette: this Stadium can be played only by discarding a Stadium with this name in play,
   * and may be played the same turn that Stadium was played.
   */
  playOnlyOverStadium?: string;
}

/** A Special Energy's on-attach effect (§6.1) — runs the moment it is attached
    from hand. Kept a tiny tagged union (not an EffectOp program) because these
    read the ATTACH context, which the {seat}-only interpreter doesn't carry. */
export type EnergyOnAttach =
  /** Jet Energy: attaching to a Benched Pokémon switches it to the Active Spot. */
  | { kind: "switchIfBenched" }
  /**
   * Enriching Energy: draw `count` cards when attached from hand to any Pokémon, Active or Benched.
   */
  | { kind: "draw"; count: number }
  /**
   * Telepathic Psychic Energy: when attached from hand to a Pokémon of `holderType`, search the
   * deck for up to `max` matching Basic Pokémon onto the Bench, then shuffle. Runs as the attach's
   * last step because its choice cannot be resumed mid-attach.
   */
  | { kind: "benchSearch"; filter: CardFilter; max: number };

/** A Special Energy's rules text (§6.1), read while attached. `provides` is the
    units it contributes to attack costs (a concrete type, or `ANY_ENERGY` for
    a wildcard — Luminous "every type of Energy but 1 at a time"); multi-unit is
    allowed. A Special Energy WITH this entry provisions through it; one WITHOUT
    falls back to the conservative Colorless provider (cards.ts energyProvidesOf),
    so an unauthored special energy stays playable (energy always provides
    something) rather than loudly rejecting like a Trainer. */
export interface EnergyProgram {
  provides: string[];
  /**
   * Boomerang Energy: when discarded by an attack of its holder, reattach it from the discard pile
   * after the attack. `"hand"` (Nitro Fire Energy) returns it to the hand instead.
   */
  returnAfterAttackDiscard?: true | "hand";
  /**
   * The type the holder must be for this Energy's other rules (`passive`, `onAttach`,
   * `returnAfterAttackDiscard`) to apply, read from its in-play types. `provides` is never gated.
   */
  holderType?: PokemonType;
  /** Luminous: the units provided INSTEAD when the holder already has another
      Special Energy attached ("this card provides {C} Energy instead"). */
  demoteWithOtherSpecial?: string[];
  /**
   * Units provided instead when the holder's printed stage matches (Neo Upper Energy, Prism Energy,
   * Reversal Energy). `units` is a multiset: `[ANY_ENERGY, ANY_ENERGY]` is two wildcard units, not
   * one worth two. `whileMorePrizesRemaining` is a flag rather than a `BoardCondition` because
   * reading conditions from continuous.ts would create an import cycle.
   */
  promoteOnHolderStage?: {
    stage: "Basic" | "Stage2" | "Evolution";
    /** The holder must also have no Rule Box. */
    noRuleBox?: true;
    /**
     * You must have more Prize cards remaining than your opponent, that is, be behind on Prizes
     * taken.
     */
    whileMorePrizesRemaining?: true;
    units: string[];
  };
  /**
   * Ignition Energy: discarded at the end of its owner's turn from any of the turn owner's Pokémon.
   */
  discardAtEndOfYourTurn?: true;
  /**
   * Team Rocket's Energy: may only sit on a Pokémon whose top card matches this owner prefix. A
   * hand attach elsewhere is refused; if it ends up elsewhere by another route it provides nothing
   * and is discarded at the next settle point.
   */
  attachOnlyToOwner?: string;
  /** Effect run on attach from hand (Jet's switch). */
  onAttach?: EnergyOnAttach;
  /**
   * Continuous effects while this Energy is attached (Therapeutic Energy). Unlike a Pokémon's
   * printed passive, it is not suppressed by Ability locks, since an Energy is not an Ability.
   */
  passive?: PassiveEffects;
}

export interface CardProgram {
  /**
   * Registry-authored attack programs keyed by attack menu index (for printed attacks, the printed
   * index). A Tool's row keys them by index into the Tool's own printed attacks. Takes precedence
   * over `deriveAttackEffect`; unauthored indexes fall back to it.
   */
  attack?: { readonly [attackIndex: number]: EffectOp[] };
  /**
   * Printed timing clause per attack index. Read straight off the card rather than through
   * `passivesOf`, because it is attack text and Ability locks must not affect it. Takes precedence
   * over the clause derived from attack text.
   */
  attackGate?: { readonly [attackIndex: number]: AttackTimingGate };
  /** Activated Abilities printed on this card. */
  abilities?: AbilityProgram[];
  /** The Trainer's play effect (Item/Supporter — §7.1/§7.2). */
  trainer?: EffectOp[];
  /**
   * Printed "You can use this card only if ..." gate, checked before the card leaves the hand and
   * mirrored by the HUD. Honoured only on `playTrainer`'s Item/Supporter path; Stadiums, Tools,
   * Rare Candy and Abilities ignore it.
   */
  trainerPlayableIf?: BoardCondition;
  /** Triggered Abilities printed on this card (§9) — fire on a game event
      (played to Bench / evolved / between turns), not player-activated. */
  triggered?: TriggeredAbility[];
  /**
   * Continuous modifiers from a Pokémon's passive Ability or a Tool's effect on its holder. A Tool
   * is attachable when it has this or a `triggered` entry.
   */
  passive?: PassiveEffects;
  /** The Stadium's continuous effects (§7.3). A Stadium with this entry is
      playable; one without is "not simulated" (coverage strategy). */
  stadium?: StadiumEffects;
  /** A Special Energy's rules text (§6.1). */
  energy?: EnergyProgram;
  /**
   * Marks Rare Candy (§7.1). It runs no op program because evolving is handled by the dedicated
   * `rareCandy` action; `playTrainer` rejects it and the HUD opens the Rare Candy dialog instead.
   */
  rareCandy?: true;
  /**
   * Antique Fossils: played onto the Bench as a 60 HP Basic {C} Pokémon. It is an Item play (Item
   * bars apply), not playing a Basic Pokémon, so Pokémon-play bars and bench-play triggers are not
   * consulted.
   */
  playAsPokemon?: true;
  /**
   * This Pokémon may be put into play only by the named Ability (Palafin ex). A card key rather
   * than a passive because it applies outside play and Ability locks must not lift it. Checked by
   * hand `evolve` and deck evolution offers.
   */
  intoPlayOnlyVia?: "Zero to Hero";
  /**
   * "This card can't be put into your hand or deck from the discard pile." Enforced by
   * `discardRetrievalCandidates`, which drops the card for hand and deck destinations.
   */
  discardPileLocked?: true;
  /**
   * Klinklang "Emergency Rotation": once per turn, put this non-Basic Pokémon from hand onto the
   * Bench when `playableIf` holds. A card key rather than an `abilities` row because every
   * `abilities` reader is an in-play surface. In-play Ability locks do not reach it.
   */
  benchFromHand?: { name: string; playableIf: BoardCondition };
  /**
   * Cinderace "Explosiveness": during setup this non-Basic Pokémon may be placed face down as the
   * Active. A hand with no Basic still mulligans.
   */
  setupActiveFromHand?: string;
  /**
   * Ferrothorn "Startling Drop": when discarded from its owner's deck by the opponent during their
   * turn, discard `count` cards from the opponent's deck.
   */
  opponentMillWhenMilled?: { ability: string; count: number };
  /** The `trainer` play ENDS the controller's turn once its program completes
      (Katy: "Shuffle your hand into your deck. Then, draw 8 cards. Your turn
      ends."). playTrainer passes this to flow.ts settleProgram, which folds it
      EXACTLY like AbilityProgram.endsTurn — instead of returning to turn:action it
      seeds the turn tail. Only meaningful alongside `trainer`; assumes the program
      does not damage (Katy only draws), so no mid-turn KO sweep is owed. */
  trainerEndsTurn?: true;
  /**
   * "If you go first, you may use this card during your first turn." Lifts only the first-turn
   * Supporter ban; the once-per-turn Supporter allowance still applies. Both HUDs read it too.
   */
  trainerFirstTurnExempt?: true;
  /**
   * This turn, if the opponent's Active is Knocked Out by damage from an attack by your Pokémon
   * matching `attacker`, take `amount` more Prize cards (Briar, Anthea & Concordia). Resolved off
   * `attackerUid`, not the Active spot.
   */
  supporterKoPrizeBonus?: { amount: number; attacker: CardFilter };
  /**
   * A Tool whose printed attacks the holder can use (Technical Machine). Listed in the attack menu
   * for every in-effect Tool; their programs are this row's `attack` entries keyed by index into
   * the Tool's attacks.
   */
  toolAttacks?: true;
  /**
   * Restricts `toolAttacks` to holders whose top card matches this filter (Core Memory). Absent
   * means any holder.
   */
  toolAttacksHolder?: CardFilter;
  /** Discard this Tool at the end of its owner's turn. */
  toolDiscardAtEndOfYourTurn?: true;
}
