// The effect-op contract: the op, condition and filter vocabulary that registry programs and the
// deriver produce and the interpreter runs. Types and pure data only; no parsing.

import type { Attack, Card } from "@colorless/schema";
import { BASIC_ENERGY_TYPES, type BasicEnergyType } from "@colorless/schema/constants";
import type { Banner } from "./banners";
import type { StatusName } from "./events";
import type { CoinFace } from "./rng";
import type { InPlayPokemon, PokemonTarget, Seat } from "./types";

/** A declarative card predicate for deck searches (§15.E). Deliberately tiny
    — the representative cards need only "a Basic Pokémon", "any Pokémon", "a
    Basic Energy [of a type]" and "a card named X"; the union grows one entry
    per new shape. */
export type CardFilter =
  /**
   * A Basic Pokémon. `noRuleBox` excludes Rule Box Pokémon; `maxHp` is the printed "with N HP or
   * less" threshold on the card's HP, and a card with unknown HP does not match.
   */
  | { kind: "basicPokemon"; noRuleBox?: true; maxHp?: number }
  /** Any Pokémon card. `noRuleBox` excludes Rule Box Pokémon at any stage (Lana's Aid). */
  | { kind: "anyPokemon"; noRuleBox?: true }
  /** An Evolution Pokémon — one that evolves from another Pokémon (Jacq's
      "search your deck for up to 2 Evolution Pokémon"). The discriminant is
      cards.ts `evolveFromOf(card) !== null`: a non-null `evolveFrom` marks a
      Stage 1 / Stage 2 (or VMAX/VSTAR) card, and the helper already returns null
      for non-Pokémon, so this is the exact complement of `basicPokemon` inside
      `anyPokemon`. */
  | { kind: "evolutionPokemon" }
  /** A Stage 1 or Stage 2 Pokémon; unlike `evolutionPokemon`, VSTAR and VMAX match neither. */
  | { kind: "stagePokemon"; stage: "Stage1" | "Stage2" }
  /**
   * A Pokémon of a printed type, by membership in `Card.types` so dual-type Pokémon match. `stage`
   * and `maxHp` narrow it.
   */
  | {
      kind: "typedPokemon";
      pokemonType: PokemonType;
      stage?: "basic" | "evolution";
      maxHp?: number;
    }
  /**
   * A union of filters: the printed "{G} Pokémon and {R} Pokémon" names a set, so a card matching
   * any member matches.
   */
  | { kind: "anyOf"; filters: readonly CardFilter[] }
  /**
   * A Pokémon whose name starts with the owner prefix ("Cynthia's "). The Pokémon category check is
   * needed because Team Rocket's Energy also carries the prefix.
   */
  | { kind: "ownerPokemon"; owner: string; stage?: "basic" | "evolution" }
  /** A Pokémon with a printed Ability, even if an Ability lock currently silences it. */
  | { kind: "abilityPokemon" }
  /** A Pokémon with a printed attack of exactly this name ("that has the Round attack"). */
  | { kind: "attackNamePokemon"; attack: string }
  /**
   * A Pokémon whose printed name contains `fragment` (case-sensitive). `suffix` additionally
   * requires a rule-box suffix ("a Pokémon ex that has Ogerpon in its name").
   */
  | { kind: "pokemonNameContaining"; fragment: string; suffix?: PokemonSuffix }
  /**
   * A Pokémon with exactly this rule-box suffix; narrower than `hasRuleBox`, so "Pokémon ex" does
   * not match Pokémon V.
   */
  | { kind: "suffixPokemon"; suffix: PokemonSuffix }
  /** A Mega Evolution Pokémon ex; every one also matches `suffixPokemon` ex. */
  | { kind: "megaEvolutionEx" }
  /**
   * A Pokémon printing a banner ("a Tera Pokémon"), looked up by card id because the banner is not
   * in the catalog.
   */
  | { kind: "bannerPokemon"; banner: Banner }
  /**
   * A card of any category printing a banner ("each Ancient card"), since Trainers carry Paradox
   * banners too.
   */
  | { kind: "bannerCard"; banner: Banner }
  /** A Pokémon Tool card (Town Store's "a Pokémon Tool card" — read off the
      catalog's `trainerType: "Tool"`, the same discriminant attachTool uses). */
  | { kind: "toolCard" }
  /** A Basic Energy card; `energyType` narrows it to one type. */
  | { kind: "basicEnergy"; energyType?: BasicEnergyType }
  /**
   * A card matched by exact name. `cardNoun` only changes the caption, adding "cards" after Trainer
   * or Energy names.
   */
  | { kind: "byName"; name: string; cardNoun?: true }
  /** A Supporter Trainer card (Pal Pad shuffles Supporters from the discard
      pile back into the deck). */
  | { kind: "supporter" }
  /** A Supporter whose printed name contains `fragment` (case-sensitive). */
  | { kind: "supporterNameContaining"; fragment: string }
  /**
   * A Pokémon Tool whose printed name contains `fragment` (TM Machine). Most Technical Machines are
   * unbuilt, so attaching one may still be refused.
   */
  | { kind: "toolNameContaining"; fragment: string }
  /** An Item whose printed name contains `fragment` (Fossil Quarry's "Antique"). */
  | { kind: "itemNameContaining"; fragment: string }
  /** An Item Trainer card; Pokémon Tools are not Items. */
  | { kind: "item" }
  /** A Stadium Trainer card. */
  | { kind: "stadium" }
  /** Any Trainer card, read from `category` so it covers every subtype. */
  | { kind: "trainerCard" }
  /** Any card. An unresolvable uid still does not match. */
  | { kind: "anyCard" }
  /** A Pokémon or a Basic Energy card (Super Rod); Special Energy is excluded. */
  | { kind: "pokemonOrBasicEnergy" }
  /** Any Energy card — Basic OR Special (Poppy "Move up to 2 Energy", which
      unlike Energy Switch's "a Basic Energy" moves either kind). Distinct from
      `basicEnergy` (basics only) and `pokemonOrBasicEnergy` (which excludes
      Special Energy and admits Pokémon). */
  | { kind: "anyEnergy" }
  /** A Special Energy card (§6.1), the complement of `basicEnergy` within `anyEnergy`. */
  | { kind: "specialEnergy" }
  /**
   * An Energy attached to a Pokémon that provides `energyType` (§6.3), matching what the cost
   * matcher reads, so a Special Energy providing that type counts and a wildcard provider matches
   * every type. Provision depends on the host, so this is evaluated per attached Energy and the
   * card-only `matchesFilter` always answers false for it; use `basicEnergy` with an `energyType`
   * for deck, hand or discard scans. Colorless is deliberately unrepresentable because it is the
   * fallback provision of unauthored Special Energy.
   */
  | { kind: "providesEnergy"; energyType: BasicEnergyType }
  /**
   * A Pokémon that prints a Resistance to `type` (Fletchling — Chirp), read off `Card.resistances`
   * rather than §8.5's `resistanceOf`, so it works on a deck card.
   */
  | { kind: "pokemonWithResistance"; type: PokemonType };

/**
 * Names under which an op records what it moved so a later op in the same program can read it ("in
 * this way", "if you do"). Slots are named rather than positional because a shuffle often sits
 * between the op and the sentence referring to it. `turnedPrize` and `revealed` feed
 * `swapTurnedPrizeWithRevealed`; `placed` holds one entry per damage counter placed (each the
 * attacker's top uid), so only its length is meaningful.
 */
export type EffectSlot = "paid" | "moved" | "discarded" | "turnedPrize" | "revealed" | "placed";

/**
 * How many cards a `handRefresh` draws after the hand goes into the deck. Counts are measured per
 * affected player before their hand is shuffled in; `perSeat` uses controller-relative
 * `you`/`opponent`; `opponentHandSize` reads the controller's opponent's hand size, and since the
 * draw pass runs after every affected seat has moved, it only makes sense with `who: "you"`.
 */
export type HandRefreshDraw =
  | { kind: "fixed"; count: number }
  | { kind: "handPlus"; delta: number }
  | { kind: "prizeCount" }
  | { kind: "perSeat"; you: number; opponent: number }
  | { kind: "opponentHandSize" }
  /**
   * Each affected player flips their own coin and draws `heads` or `tails` cards (Lucian); flips
   * are taken in seat order, controller first.
   */
  | { kind: "coinFlip"; heads: number; tails: number };

/** An Energy reading: a Basic type, any Special Energy, or any Basic Energy card. */
export type EnergyClass = BasicEnergyType | "special" | "basic";

/**
 * §6.1's full Pokémon type wheel as the catalog spells it in `Card.types`: the Basic Energy types
 * plus Dragon and Colorless. Keep it separate from the energy vocabulary, since a Pokémon can be
 * Dragon or Colorless but no Basic Energy provides those.
 */
export const POKEMON_TYPES = [...BASIC_ENERGY_TYPES, "Dragon", "Colorless"] as const;
export type PokemonType = (typeof POKEMON_TYPES)[number];

/**
 * §7: the classes of hand card a seat can be barred from playing, spelled exactly as
 * `Card.trainerType` so the card's field compares directly.
 */
export type HandPlayClass = "Item" | "Supporter" | "Tool" | "Stadium";

/**
 * §7: the subset of `HandPlayClass` a printed attack can stamp for a turn via
 * `GameState.handPlayLockedTurn`. `Tool` is only ever barred by a passive.
 */
export type StampedHandPlayClass = Extract<HandPlayClass, "Item" | "Supporter" | "Stadium">;

/**
 * §7.5/§10: the acts by which a Pokémon card goes from hand to board, asked by `pokemonPlayBarred`.
 * Evolving and benching are separate because a bar on evolving does not stop a Basic being benched.
 * Rare Candy is not a play act; it is reached by the Item bar instead.
 */
export type PokemonPlayAct = "evolve" | "bench";

/**
 * The subset of `PokemonPlayAct` a printed attack can stamp for a turn; `bench` is only barred by a
 * passive.
 */
export type StampedPokemonPlayAct = Extract<PokemonPlayAct, "evolve">;

/**
 * The key set of `GameState.handPlayLockedTurn`: everything a resolved attack can stamp for a turn,
 * across both hand-play and Pokémon-play bars.
 */
export type StampedPlayLockKey = StampedHandPlayClass | StampedPokemonPlayAct;

export interface AttackerClass {
  /**
   * The printed class word after "by attacks from". `ex` means exactly the ex suffix, not any rule
   * box; `ancient` is read by banner; `burned` reads the attacker's conditions at damage time.
   */
  readonly stage: "basic" | "ancient" | "ex" | "burned" | "evolution" | "hasAbility";
  /** The printed *"non-{X}"* exclusion, resolved through `POKEMON_TYPE_BY_CODE`.
      ABSENT = the sentence excluded nothing. */
  readonly excludingType?: PokemonType;
}

/**
 * A board predicate read for one seat, used by play gates (`playableIf`) and `conditionGate`,
 * evaluated by `conditionHolds`. Members must read only public state: counts and sizes of hands and
 * decks are fine, but never their contents or order, since a gate emits no event.
 */
export type BoardCondition =
  /** §14 — you have strictly MORE Prize cards remaining than your opponent, i.e.
      you are BEHIND on Prizes taken (Fighting Au Lait's play gate; Defiance
      Band, Luxray and Reversal Energy read the same condition and layer later). */
  | { kind: "morePrizesThanOpponent" }
  /** §7.3 — the Stadium in the shared zone is YOURS (you played it). "If you
      have a Stadium in play" is about OWNERSHIP, not mere presence: the
      opponent's Stadium sitting in the zone does not satisfy Falkner. */
  | { kind: "yourStadiumInPlay" }
  /**
   * §7.3: any Stadium is in play, owned by either player (unlike `yourStadiumInPlay`, which reads
   * ownership).
   */
  | { kind: "stadiumInPlay" }
  /** §7.3: the Stadium in play is your opponent's. */
  | { kind: "opponentStadiumInPlay" }
  /** None of your in-play Pokémon (Active or Benched) has ANY Energy attached —
      Basic or Special (Grusha's "if none of your Pokémon have any Energy
      attached"). Vacuously true with nothing in play. */
  | { kind: "noEnergyOnYourPokemon" }
  /**
   * Read at attack declaration, before this attack's own damage lands, matching the printed
   * "already".
   */
  | { kind: "opponentActiveDamaged" }
  /**
   * Your opponent's Active is an Evolution Pokémon (`evolveFromOf(topCard) !== null`). False with
   * no Active.
   */
  | { kind: "opponentActiveIsEvolution" }
  /**
   * Your opponent's Active is a Basic Pokémon, read off the top card, so an evolved Basic no longer
   * satisfies it. Named for the board fact rather than "Defending Pokémon" because play gates share
   * this union.
   */
  | { kind: "opponentActiveIsBasic" }
  /**
   * Your opponent's Active is a Stage 1 Pokémon; a Stage 2 or VSTAR is not. False with no Active.
   */
  | { kind: "opponentActiveIsStage1" }
  /** Your opponent's Active is a Stage 2 Pokémon. False with no Active. */
  | { kind: "opponentActiveIsStage2" }
  /**
   * Your Active has any damage counters on it; printed "this Pokémon" resolves to the Active
   * because an attack is declared by the Active. False with an empty Active Spot.
   */
  | { kind: "yourActiveDamaged" }
  /** Your Active has no damage counters on it. */
  | { kind: "yourActiveUndamaged" }
  /** Any ONE of your BENCHED Pokémon has damage counters on it — Tyranitar ex
      sv03-066/-211 "Lightning Rampage" (+100), printed in the plural ("If your
      Benched Pokémon have any damage counters on them"). The plural is the
      game's usual collective phrasing for "any of them", NOT a requirement that
      every benched Pokémon be damaged; an EMPTY Bench is false. Deliberately
      excludes the Active — the printed word is "Benched", and the sibling
      `yourActiveDamaged` covers the other spot. */
  | { kind: "yourBenchDamaged" }
  /**
   * Every one of your Benched Pokémon has at least 1 damage counter; deliberately false with an
   * empty Bench.
   */
  | { kind: "yourBenchAllDamaged" }
  /**
   * Some Benched Pokémon of yours named `name` has damage counters; both tests apply to the same
   * body.
   */
  | { kind: "yourBenchNamedDamaged"; name: string }
  /** §12 — your opponent's Active Pokémon is Poisoned: Seviper sv01-128 and
      Paldean Clodsire sv03-129, both printing "Venoshock" (+120). Poison is a
      COUNTER amount on the model rather than a flag (`poisonDamage`, which
      effects may raise), so "is Poisoned" is `> 0`. False with no Active. */
  | { kind: "opponentActivePoisoned" }
  /** §12 — your opponent's Active Pokémon is affected by ANY Special Condition:
      Sableye sv02-136 "Unseen Claw" (+70), the pool's only printing of this
      clause. Reuses `presentStatuses` verbatim — the same list the STATUS_CLEARED
      events and the status chips are built from — so "affected" can never drift
      from what the board shows. The rotation slot, Poison and Burn all count, and
      any ONE of them suffices. False with no Active. */
  | { kind: "opponentActiveHasSpecialCondition" }
  /** §12: your Active is affected by any Special Condition. */
  | { kind: "yourActiveHasSpecialCondition" }
  /** §12: your Active is Poisoned (`poisonDamage > 0`). False with an empty Active Spot. */
  | { kind: "yourActivePoisoned" }
  /** §12: your Active is Burned or Poisoned. False with an empty Active Spot. */
  | { kind: "yourActiveBurnedOrPoisoned" }
  /** §12: your Active is Asleep. False with an empty Active Spot. */
  | { kind: "yourActiveAsleep" }
  /** §12: your opponent's Active is Burned. */
  | { kind: "opponentActiveBurned" }
  /**
   * §12: your opponent's Active is Confused. Do not use `isImmobilized`, which excludes Confused.
   */
  | { kind: "opponentActiveConfused" }
  /**
   * Your opponent's Active is a Pokémon ex or V only, not VMAX/VSTAR/GX (`isExOrV`, derived from
   * the name suffix). False with no Active.
   */
  | { kind: "opponentActiveIsExOrV" }
  /** Your opponent's Active is a Pokémon ex and nothing else. */
  | { kind: "opponentActiveIsEx" }
  /** §6.3: your Active has at least one attached Energy of `energy`. */
  | {
      kind: "yourActiveHasEnergyAttached";
      energy: EnergyClass;
    }
  /** Your opponent's Active has at least one attached Energy of `energy`. */
  | { kind: "opponentActiveHasEnergyAttached"; energy: BasicEnergyType | "special" }
  /** Your Active has at least one attached Energy whose printed name is `name`. */
  | { kind: "yourActiveHasNamedEnergyAttached"; name: string }
  /** Any of your Benched Pokémon has an Energy named `name` attached. False with an empty Bench. */
  | { kind: "yourBenchHasNamedEnergyAttached"; name: string }
  /**
   * §3.8: your opponent's remaining Prize count is one of `counts`. This is set membership, not a
   * range: `[2, 4]` is false at 3.
   */
  | { kind: "opponentPrizesRemaining"; counts: readonly number[] }
  /** §3.8: your own remaining Prize count is one of `counts`. */
  | { kind: "yourPrizesRemaining"; counts: readonly number[] }
  /** Your opponent is holding at most `count` cards. */
  | { kind: "opponentHandAtMost"; count: number }
  /** Both players are holding the same number of cards. */
  | { kind: "handSizesEqual" }
  /** Your own hand holds exactly `count` cards. */
  | { kind: "yourHandExactly"; count: number }
  /** Your own hand holds at least one card. */
  | { kind: "yourHandNotEmpty" }
  /** Your own hand holds at least `count` cards. */
  | { kind: "yourHandAtLeast"; count: number }
  /**
   * At least one of your Prizes is still face down. Not `prizes.length > 0`: every remaining Prize
   * may already be face up.
   */
  | { kind: "yourFaceDownPrizeRemains" }
  /** Your own deck holds at most `count` cards. */
  | { kind: "yourDeckAtMost"; count: number }
  /** Your deck holds at least one card. */
  | { kind: "yourDeckNotEmpty" }
  /**
   * Both Active Pokémon have the same number of attached Energy cards (cards, not provided units).
   */
  | { kind: "activeEnergyCountsEqual" }
  /** Your Active has strictly more attached Energy cards than your opponent's Active. */
  | { kind: "moreActiveEnergyThanOpponent" }
  /**
   * Your Active has at least `count` attached Energy cards, optionally of `energy`. Used to gate an
   * optional attack cost on its payability.
   */
  | { kind: "yourActiveEnergyAtLeast"; count: number; energy?: BasicEnergyType | "special" }
  /** Your opponent's Active is a `type` Pokémon, read from `Card.types`. */
  | { kind: "opponentActiveHasType"; type: PokemonType }
  /** Your Active is a `type` Pokémon, read from `Card.types`. */
  | { kind: "yourActiveHasType"; type: PokemonType }
  /**
   * Your opponent's Active prints a Resistance to `type`, regardless of the attacker; not §8.5's
   * `resistanceOf`, which asks whether Resistance applies to a given attacker.
   */
  | { kind: "opponentActiveHasResistance"; type: PokemonType }
  /**
   * Your opponent's Active has an effective Retreat Cost of at least `count`, not the printed cost.
   */
  | { kind: "opponentActiveRetreatCostAtLeast"; count: number }
  /** Your opponent's Active has no effective Retreat Cost. False with an empty Active Spot. */
  | { kind: "opponentActiveNoRetreatCost" }
  /**
   * Your Active has effective Weakness to your opponent's Active's type (either type for a dual
   * type); false with either Active Spot empty.
   */
  | { kind: "yourActiveWeakToOpponentActiveType" }
  /** You have at least one Pokémon of type `type` on your Bench. */
  | { kind: "yourBenchHasType"; type: PokemonType }
  /**
   * You have a Stage 2 Pokémon of type `type` on your Bench; both facts are read off the same body.
   * False with an empty Bench.
   */
  | { kind: "yourBenchHasStage2OfType"; type: PokemonType }
  /** Your opponent has at least one Pokémon of type `type` anywhere in play. */
  | { kind: "opponentInPlayHasType"; type: PokemonType }
  /** Some Pokémon of yours in play shares a type with some Pokémon of your opponent's in play. */
  | { kind: "inPlayTypesIntersect" }
  /** A Pokémon named `name` is on your Bench. */
  | { kind: "yourBenchHasNamed"; name: string }
  /** A Pokémon whose printed name contains `fragment` is on your Bench. */
  | { kind: "yourBenchHasNameContaining"; fragment: string }
  /** You have a Pokémon named `name` anywhere in play, Active Spot included. */
  | { kind: "yourNamedPokemonInPlay"; name: string }
  /** You have at least `count` Energy of `energy` attached across all your Pokémon in play. */
  | { kind: "yourEnergyInPlayAtLeast"; energy: BasicEnergyType | "special" | null; count: number }
  /** At least `count` Basic Energy cards of `energy` are in your discard pile. */
  | { kind: "yourBasicEnergyInDiscardAtLeast"; energy: BasicEnergyType; count: number }
  /**
   * §6.5: your hand holds at least `count` Basic Energy cards of `energy`; gates a printed
   * hand-discard cost.
   */
  | { kind: "yourBasicEnergyInHandAtLeast"; energy: BasicEnergyType; count: number }
  /** §7.4: your Active has a Pokémon Tool attached. */
  | { kind: "yourActiveHasToolAttached" }
  /**
   * "If your opponent's Active Pokémon has a Pokémon Tool attached." Tested as `tools.length > 0`,
   * since some effects raise the one-Tool cap. False with an empty Active Spot.
   */
  | { kind: "opponentActiveHasToolAttached" }
  /**
   * You have played a Supporter card from your hand this turn (§7.2). `allowances` describes only
   * the turn owner, so this first checks that `seat` owns the turn; it reads false for both seats
   * between turns.
   */
  | { kind: "youPlayedSupporterThisTurn" }
  /**
   * "If this Pokémon moved from your Bench to the Active Spot this turn." Reads the `promotedTurn`
   * stamp, which retreat, forced switches and promotion after a Knock Out all set; it survives
   * evolution.
   */
  | { kind: "yourActivePromotedThisTurn" }
  /**
   * "If this Pokémon was healed during this turn." Reads the `healedTurn` stamp, written only when
   * a heal actually removes damage.
   */
  | { kind: "yourActiveHealedThisTurn" }
  /**
   * "If this Pokémon evolved from `name` during this turn." Uses the `evolvedTurn` stamp and the
   * card one below the top of the stack, not the card's `evolveFrom` field, because it asks what
   * happened rather than what the card says.
   */
  | { kind: "yourActiveEvolvedFromThisTurn"; name: string }
  /**
   * "This Pokémon used `attack` during your last turn" (§ two turns ago: `stamp === state.turn -
   * 2`). `attack` is an attack name, not a Pokémon name.
   */
  | { kind: "yourActiveUsedAttackLastTurn"; attack: string }
  /**
   * "1 of your Pokémon used `attack` during your last turn." Checks your Active and Bench, so a
   * Pokémon that used the attack and then retreated still counts.
   */
  | { kind: "yourPokemonUsedAttackLastTurn"; attack: string }
  /**
   * "You have `count` or more `owner`'s Pokémon in play." Counts the top cards of your Active and
   * Bench.
   */
  | { kind: "yourOwnerPokemonInPlayAtLeast"; owner: string; count: number }
  /**
   * All of your Pokémon in play (Active and Bench top cards) are `owner`'s Pokémon. An empty board
   * is false, not vacuously true.
   */
  | { kind: "yourPokemonAllOwner"; owner: string }
  /**
   * Your Active Pokémon's top card is an `owner`'s Pokémon; `owner` has no possessive. False with
   * an empty Active Spot.
   */
  | { kind: "yourActiveOwner"; owner: string }
  /**
   * "If any of your Pokémon were Knocked Out during your opponent's last turn" (§8.1), i.e. the
   * previous turn. `owner` narrows to that owner's Pokémon and `byAttack` to Knock Outs by damage
   * from an attack; absent means unnarrowed.
   */
  | { kind: "yourPokemonKoedOnOpponentsLastTurn"; owner?: string; byAttack?: true }
  /**
   * The turn in progress is your own first turn (§4), via `isFirstTurnOf`. It is the ordinal for
   * this seat, not "turn 1 or 2"; false during setup.
   */
  | { kind: "yourFirstTurn" }
  /** Complement of `yourFirstTurn`; true during setup. */
  | { kind: "notYourFirstTurn" }
  /**
   * You go second, i.e. `state.firstPlayer` is your opponent. A fact about seat assignment that
   * holds every turn, not only the first; false during setup while `firstPlayer` is null.
   */
  | { kind: "youGoSecond" }
  /** You have at least `count` Benched Pokémon; the Active is not counted. */
  | { kind: "yourBenchAtLeast"; count: number }
  /** Your opponent has at least `count` Benched Pokémon; the Active is not counted. */
  | { kind: "opponentBenchAtLeast"; count: number }
  /**
   * Your Active Pokémon's top card prints an Ability named `name`. A locked Ability still counts.
   * False with an empty Active Spot.
   */
  | { kind: "yourActiveHasAbility"; name: string }
  /** Your Active Pokémon's top card has exactly this name. False with an empty Active Spot. */
  | { kind: "yourActiveNamed"; name: string }
  /**
   * Your opponent has a Pokémon ex or Pokémon V (not VMAX, VSTAR or GX) in their Active Spot or on
   * their Bench.
   */
  | { kind: "opponentHasExOrVInPlay" }
  /**
   * Your Active Pokémon has at least `count` damage counters on it; `count` is in counters, not HP.
   * False with an empty Active Spot.
   */
  | { kind: "yourActiveDamageCountersAtLeast"; count: number }
  /** Your Active Pokémon's remaining HP is `hp` or less. False with an empty Active Spot. */
  | { kind: "yourActiveRemainingHpAtMost"; hp: number }
  /**
   * Your opponent's Active Pokémon has exactly `count` damage counters on it. False with an empty
   * Active Spot.
   */
  | { kind: "opponentActiveDamageCountersExactly"; count: number }
  /**
   * "If your opponent's Pokémon is Knocked Out by damage from this attack." Read after the damage
   * and before the §8.1 sweep: some opponent Pokémon is lethally damaged and not already being
   * Knocked Out by an effect. False outside an attack program.
   */
  | { kind: "opponentKnockedOutByDamage" }
  /**
   * Your opponent's Active Pokémon's top card prints an Ability; a locked Ability still counts.
   * False with an empty Active Spot.
   */
  | { kind: "opponentActiveHasAbility" }
  /**
   * Your opponent's discard pile has a card of any kind whose name contains `fragment`
   * (case-sensitive). Your own discard pile does not count.
   */
  | { kind: "opponentDiscardHasNameContaining"; fragment: string }
  /** A card of any kind named `name` is in your discard pile. */
  | { kind: "yourDiscardHasNamed"; name: string }
  /**
   * Your discard pile has at least `count` Pokémon cards that print an Ability named `ability`
   * (apostrophes normalized). Trainer cards that print an Ability do not count.
   */
  | { kind: "yourDiscardPokemonWithAbilityNamedAtLeast"; ability: string; count: number }
  /**
   * You played a Supporter from your hand this turn whose name is `name` or contains
   * `nameContains`; set exactly one. The played card is found in any zone, and like
   * `youPlayedSupporterThisTurn` this is false for the seat that does not own the turn.
   */
  | { kind: "youPlayedSupporterNamedThisTurn"; name?: string; nameContains?: string }
  /** The Stadium in play is named `name`, whoever played it (§7.3). */
  | { kind: "stadiumInPlayNamed"; name: string }
  /** The Stadium in play has `fragment` in its name (case-sensitive), whoever played it (§7.3). */
  | { kind: "stadiumInPlayNameContains"; fragment: string }
  /** Any of your Pokémon in play (Active or Bench top card) has `banner`. */
  | { kind: "yourBannerPokemonInPlay"; banner: Banner }
  /** Any of your Benched Pokémon has `banner`; the Active does not count. */
  | { kind: "yourBannerPokemonOnBench"; banner: Banner }
  /** Your opponent's Active Pokémon's top card has `banner`. */
  | { kind: "opponentActiveIsBanner"; banner: Banner }
  /** Any of your opponent's Pokémon in play has `banner`. */
  | { kind: "opponentBannerPokemonInPlay"; banner: Banner }
  /**
   * "1 of your other `banner` Pokémon used an attack during your last turn." Read from
   * `GameState.recentAttackers`, so a Pokémon that has since left play still counts; attacks by
   * your current Active's stack do not.
   */
  | { kind: "yourOtherBannerPokemonAttackedLastTurn"; banner: Banner }
  /**
   * You played a Supporter with `banner` from your hand this turn. False for the seat that does not
   * own the turn.
   */
  | { kind: "yourPlayedBannerSupporterThisTurn"; banner: Banner }
  /** Your opponent has a Stage 2 Pokémon in their Active Spot or on their Bench. */
  | { kind: "opponentStage2PokemonInPlay" }
  /** You have a Mega Evolution Pokémon ex in play, of type `type` when set. */
  | { kind: "yourMegaExInPlay"; type?: PokemonType }
  /**
   * Your in-play cards can currently be put into your hand (no `inPlayToHandBlocked` lock). Gates
   * optional costs that would otherwise be paid for nothing under the lock.
   */
  | { kind: "yourInPlayToHandAllowed" }
  /**
   * "This Pokémon has at least `extra` extra Energy attached (in addition to this attack's cost)."
   * Needs the declared attack's cost, so it is resolved at declaration by
   * `resolveDeclarationGates`; `conditionHolds` returns false anywhere else.
   */
  | { kind: "extraEnergyBeyondAttackCost"; extra: number }
  /**
   * Every one of `conditions` holds. The tuple type requires at least two, since an empty or
   * single-element `allOf` would be a degenerate second spelling.
   */
  | { kind: "allOf"; conditions: readonly [BoardCondition, BoardCondition, ...BoardCondition[]] };

/**
 * Riders that narrow which of the controller's in-play Pokémon may receive an attach, shared by
 * `attachEnergyFrom` and `attachFromTop` through `attachEnergyTargets`. An absent rider is no
 * restriction.
 */
export interface AttachTargetRiders {
  /**
   * Only Pokémon whose top card has this type. A list is a union: a Pokémon qualifies if it has any
   * of the listed types.
   */
  targetType?: string | readonly string[];
  /** Only BASIC Pokémon (Koraidon ex's "your Basic {F} Pokémon"). */
  basicOnly?: true;
  /** Only Stage 2 Pokémon, by the printed stage (a VSTAR is not Stage 2). */
  stage2Only?: true;
  /**
   * Only Pokémon in the owner-prefixed subgroup, given as the bare owner name ("Iono"). Matched
   * through `matchesFilter`'s `ownerPokemon` arm so deck and board agree.
   */
  ownerPokemon?: string;
  /** Only Pokémon whose top card has one of these exact names ("your Electivire and Magmortar"). */
  targetNames?: readonly [string, ...string[]];
  /** Only Pokémon whose top card has this banner. */
  targetBanner?: Banner;
  /** Only BENCHED Pokémon — the Active is not a target (Electric Generator's
      "your **Benched** {L} Pokémon", where the attach is the whole point of
      putting Energy somewhere the turn's manual attach cannot reach). */
  benchOnly?: true;
  /** Only the Active Pokémon. */
  activeOnly?: true;
  /** Damage counters the attach itself places on the target (Gardevoir's 2). */
  bonusCounters?: number;
  /** Exclude any target `bonusCounters` would Knock Out ("you can't use this on
      a Pokémon that would be Knocked Out"), so the placement is never lethal. */
  notIfKO?: true;
  /**
   * Where the attached card comes from. An attach from hand cannot target a Pokémon barred by
   * `HandAttachMark.barred`.
   */
  source?: "hand" | "discard";
  /**
   * Targets the opponent's Pokémon instead of the controller's own. `seat` stays the actor; the
   * returned refs carry the owner's seat.
   */
  whose?: "opponent";
}

/** The EffectOp variant with the given `op` tag. */
export type OpOf<K extends EffectOp["op"]> = Extract<EffectOp, { op: K }>;

type FieldOf<T> = T extends unknown ? keyof T : never;

/**
 * The fields marked engine-written below: the engine stores an answer on the parked op it
 * reschedules, so an authored or derived program never carries one.
 */
export const ENGINE_WRITTEN_FIELDS = {
  attachEnergyFrom: ["pickOnto"],
  coinFlipGate: ["faces"],
  damageChosen: ["faces", "hitRefs"],
  devolveChosen: ["bodyUid", "shed"],
  discardEnergy: ["bodyUid"],
  discardTools: ["bodyUid"],
  evolveFromDeck: ["onto"],
  lookAtPrize: ["index"],
  moveCounterOwnChosen: ["from"],
  moveCountersChosen: ["fromBench"],
  moveCountersOpponentAnyWay: ["budget", "source", "take"],
  moveCountersToOpponentChosen: ["from"],
  opponentGuessesHp: ["uid"],
  switchWithDiscardNamed: ["bodyUid"],
} as const satisfies { readonly [K in EffectOp["op"]]?: readonly FieldOf<OpOf<K>>[] };

/**
 * The ops only the engine builds: the copy-attack and coin-redo offers it parks, and the trims
 * flow.ts runs.
 */
export const ENGINE_ONLY_OPS = [
  "reflipAttackCoins",
  "reflipCoins",
  "trimBench",
  "trimTools",
  "useAttackAs",
  "useFoundAttackAs",
  "useInPlayAttackAs",
] as const satisfies readonly EffectOp["op"][];

/** One effect operation — the engine's instruction set (D8). Attack-derived
    programs use the first three (targets are relative to the attacker: "self"
    = the attacker's Active, "defender" = the Defending Pokémon); Trainer /
    Ability programs use the rest (targets relative to the controller — the
    seat playing the card — resolved by the interpreter). The whole union is
    JSON-safe so a parked program (interpreter.ts) serializes into the phase. */
export type EffectOp =
  // — Attack ops, attacker-relative. —
  | {
      op: "applyStatus";
      /**
       * `attacker` targets the opponent's Active only while it is still the Pokémon
       * `EffectContext.attackerUid` names; an attacker that has moved to the Bench is not affected.
       */
      target: "defender" | "self" | "attacker";
      status: StatusName;
      /** Only for "poisoned": HP placed per Checkup when raised above 10. */
      poisonDamage?: number;
      /**
       * Only for "confused": HP placed on itself when the confusion flip fails, if higher than
       * `DEFAULT_CONFUSION_DAMAGE`.
       */
      confusionDamage?: number;
    }
  /**
   * The controller's Active recovers from all Special Conditions at once. A one-time effect, unlike
   * the continuous `PassiveEffects.statusRecovery`.
   */
  | {
      op: "clearStatus";
      /** Clears only this condition; set only when the engine expands `recoverOneStatus`. */
      only?: StatusName;
    }
  /**
   * The controller's Active recovers from one Special Condition of the player's choice. With one
   * condition it clears directly; with two or three the choice is a chain of binary `optional`
   * prompts that each end in `clearStatus { only }`.
   */
  | { op: "recoverOneStatus" }
  /**
   * The Pokémon can't retreat during its controller's next turn (§11). Bare targets the Defending
   * Pokémon; `target: "self"` targets the attacker. This is the opposite default from
   * `preventAttack`, so don't copy the seat logic between them.
   */
  | { op: "preventRetreat"; target?: "self" }
  /**
   * The opponent can't play `bars` from their hand during their next turn. It targets the player,
   * not a Pokémon, so §11 protection does not stop it and changes to their Active do not lift it.
   */
  | { op: "preventHandPlay"; bars: StampedPlayLockKey }
  /**
   * Prevent damage to the controller's Active from attacks during the opponent's next turn.
   * `effects` also prevents effects of attacks; `fromClass` limits it to attacks from that attacker
   * class (absent means every attacker).
   */
  | { op: "preventDamage"; effects?: true; fromClass?: AttackerClass; maxDamage?: number }
  /**
   * Prevent damage from attacks by `fromClass` Pokémon to each of the controller's `banner` Pokémon
   * during the opponent's next turn; it ends if the source leaves the Active Spot. Stored on the
   * side, and the set of protected Pokémon is evaluated when damage is dealt.
   */
  | { op: "installSideAttackBlock"; banner: Banner; fromClass: AttackerClass }
  /**
   * Mark the opponent's Active for their next turn. With `barred`, Energy can't be attached to it
   * from their hand; with `endsTurn`, attaching Energy to it from their hand ends their turn.
   */
  | {
      op: "markHandAttach";
      barred?: true;
      endsTurn?: true;
      /**
       * Damage counters placed on the marked Pokémon for each Energy card attached to it from the
       * opponent's hand.
       */
      counters?: number;
    }
  /**
   * During the opponent's next turn they flip a coin for each Trainer they try to play from their
   * hand; on tails it is discarded instead. It targets the player, so §11 protection does not stop
   * it.
   */
  | { op: "flipLockTrainerPlay" }
  /**
   * Look at 1 of the opponent's face-down Prize cards without revealing it. With two or more
   * face-down Prize cards the attacker picks a slot without seeing them, and `index` is set when
   * the op resumes; only the player looking learns the card.
   */
  | { op: "lookAtPrize"; side: "opponent"; index?: number }
  /** The controller wins the game immediately (§14). */
  | { op: "winGame" }
  /**
   * The controller's Active takes `amount` less damage from attacks, after Weakness and Resistance,
   * during the opponent's next turn. Added to the same total as passive damage reductions;
   * reinstalling keeps the larger amount.
   */
  | {
      op: "reduceDamage";
      amount: number;
      /** Only reduces damage from attackers of this class; absent means every attacker. */
      fromClass?: AttackerClass;
    }
  /**
   * The controller's Active has no Weakness during the opponent's next turn. Named apart from
   * `PassiveEffects.removeWeakness`, which is a different, seat-wide effect.
   */
  | { op: "installNoWeakness" }
  /**
   * The Defending Pokémon's attacks do `amount` less damage, before Weakness and Resistance, during
   * its next turn. An effect of an attack on the Defending Pokémon, so §11 protection blocks it;
   * reinstalling keeps the larger amount.
   */
  | { op: "weakenDefenderAttacks"; amount: number }
  /**
   * During the installer's next turn, the Defending Pokémon takes `amount` more damage from attacks
   * after Weakness and Resistance. §11 protection blocks it; reinstalling keeps the larger amount.
   */
  | { op: "exposeDefender"; amount: number }
  /**
   * The controller's Active takes `amount` more damage from attacks after Weakness and Resistance
   * during the opponent's next turn. Added to any existing vulnerability for the same turn.
   */
  | { op: "exposeSelf"; amount: number }
  /**
   * Until the end of the installer's next turn, the Defending Pokémon's Weakness type becomes
   * `type` and keeps its amount. With `asTimesTwo`, its Weakness is replaced by a single `type` ×2.
   * §11 protection blocks it.
   */
  | { op: "retypeDefenderWeakness"; type: string; asTimesTwo?: true }
  /**
   * During the opponent's next turn, the Defending Pokémon's attacks and Retreat Cost each cost {C}
   * more. §11 protection blocks it.
   */
  | { op: "taxDefender" }
  /**
   * If the Defending Pokémon is Knocked Out during the installer's next turn, take `amount` more
   * Prize cards. Does not apply to a Knock Out in the Checkup at the end of that turn. §11
   * protection blocks it.
   */
  | { op: "bountyDefender"; amount: number }
  /**
   * If the opponent's Active is Knocked Out by damage from this attack, take `amount` more Prize
   * cards. Added to any existing bounty; paid at the §8.1 sweep.
   */
  | { op: "bountyThisAttack"; amount: number }
  /**
   * At the end of the opponent's next turn, place `amount` damage (HP, not counters) on the
   * Defending Pokémon (§13). §11 protection blocks it.
   */
  | { op: "scheduleCounters"; amount: number }
  /**
   * At the end of the opponent's next turn, discard the Defending Pokémon and all attached cards.
   * Unlike `scheduleKnockOut`, no Prize cards are taken.
   */
  | { op: "scheduleDiscard" }
  /**
   * At the end of the opponent's next turn, the Defending Pokémon is Knocked Out, so Prize cards
   * are taken through the §8.1 sweep. It places no damage.
   */
  | { op: "scheduleKnockOut" }
  /**
   * During the opponent's next turn, if the controller's Active is damaged by an attack, put damage
   * on the Attacking Pokémon. `amount` is HP (counters × 10), or `"damageTaken"` for the damage
   * this Pokémon took from that hit.
   */
  | { op: "installRecoil"; amount: number | "damageTaken" }
  /**
   * The Pokémon can't attack during its controller's next turn. Absent `target` means the attacker
   * itself (`state.turn + 2`); `"defender"` means the Defending Pokémon (`state.turn + 1`).
   */
  | { op: "preventAttack"; target?: "defender" }
  /**
   * During the opponent's next turn, the Defending Pokémon's attacks happen only on heads. The
   * attack can still be declared; the coin is flipped at resolution, before the Confusion flip. §11
   * protection blocks it.
   */
  | {
      op: "flipLockAttack";
      /** Flip 2 coins instead, and the attack fails if either is tails. */
      coins?: 2;
    }
  /**
   * A whole side's Pokémon can't attack during that side's next turn, including Pokémon that come
   * into play later. `maxEnergy` limits it to Pokémon with at most that many Energy cards attached,
   * counted at declaration; null locks every Pokémon. It targets a side, not a Pokémon, so §11
   * protection does not stop it.
   */
  | { op: "lockSideAttacks"; whose: "self" | "opponent"; maxEnergy: number | null }
  /**
   * The controller's Active can't use the attack named `attack` during its next turn. The name is
   * resolved to an attack index at install; a name the Pokémon lacks installs nothing. `until:
   * "leavesActive"` makes it last until the Pokémon leaves the Active Spot.
   */
  | { op: "preventAttackUse"; attack: string; until?: "leavesActive" }
  /**
   * The named attack on the controller's Active does `amount` more damage, before Weakness and
   * Resistance, during its next turn. With `base`, `amount` replaces the attack's base damage
   * instead. `attack: null` applies to every attack, and the installer rejects it together with
   * `base`.
   */
  | {
      op: "boostAttack";
      attack: string | null;
      amount: number;
      base?: true;
      /**
       * Install on the program's source Pokémon, on the Bench or in the Active Spot, instead of the
       * Active. If the source has left play, nothing is installed.
       */
      holder?: "source";
      /** Apply during the current turn instead of the holder's next turn. */
      thisTurn?: true;
    }
  /**
   * This turn, attacks by your Pokémon do `amount` more damage, before Weakness and Resistance, to
   * an opponent's Active matching `target`. `attacker` limits which attackers get it. It applies to
   * the whole side, not one Pokémon, and as a Trainer effect Ability locks do not suppress it.
   */
  | { op: "boostSideAttacksThisTurn"; amount: number; target: CardFilter; attacker?: CardFilter }
  /**
   * "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that
   * Pokémon can't use that attack." Parks on a `chooseAttack` prompt (no attacks is a no-op, one
   * attack auto-resolves) and stamps the defender's `lockedAttack` for `state.turn + 1`. Idempotent
   * and consumes no rng.
   */
  | { op: "preventChosenAttack" }
  /**
   * Heal `amount` from the controller's own Active Pokémon, clamped to its damage; a whiff emits no
   * HEALED. `"dealt"` is the §8.5 damage this attack dealt (`EffectContext.dealt`); `"all"` heals
   * all damage on the body. Never parks.
   */
  | {
      op: "heal";
      target: "self";
      amount: number | "dealt" | "all";
      /**
       * "If you healed any damage in this way, discard all Energy from that Pokémon." Energy is
       * discarded only when this heal actually healed something.
       */
      discardEnergyFromHealed?: true;
    }
  /**
   * Heal `amount` from each of the controller's in-play Pokémon, Active and Bench, each clamped to
   * its own damage. `pokemonType` gates on the body's in-play top-card types (absent is ungated,
   * not `Colorless`). Never parks.
   */
  | {
      op: "healEach";
      /** `"all"` heals each body's own damage. */
      amount: number | "all";
      pokemonType?: PokemonType;
      /**
       * "each of your Basic Pokémon": only bodies whose top card is a Basic Pokémon; an
       * unresolvable top card is skipped.
       */
      basicOnly?: true;
      /**
       * "each of your Benched Pokémon": excludes the Active. Absent includes the Active and the
       * whole Bench.
       */
      benchOnly?: true;
      /** "each of your Evolution Pokémon", Active and Bench, matched on the top card. */
      evolutionOnly?: true;
      /**
       * "If you healed any damage in this way, discard all Energy from those Pokémon." Applied per
       * body: a body that healed 0 keeps its Energy.
       */
      discardEnergyFromHealed?: true;
      /**
       * "each of your Tera Pokémon": only bodies whose top card prints the banner, Active and
       * Bench.
       */
      banner?: Banner;
    }
  /** Heal `amount` HP from EVERY in-play Pokémon on BOTH boards (Picnic Basket
      "Heal 30 damage from each Pokémon (both yours and your opponent's)"). The
      seat-blind twin of `healEach` — the whole table heals, not just the
      controller's side. No target choice, so it never parks; one HEALED per
      Pokémon that actually healed, tagged with that Pokémon's OWN seat. */
  | { op: "healEachAll"; amount: number }
  /**
   * Put `amount` HP of damage counters on every in-play body on the sides `side` names that matches
   * `filter`, except any named `exceptNamed` (e.g. Froslass "Freezing Shroud"). `amount` is HP, not
   * counters. Never KOs; the caller's KO sweep resolves Knock Outs. `damagedOnly` limits it to
   * bodies that already have damage counters.
   */
  | {
      op: "counterEachAll";
      amount: number;
      filter: CardFilter;
      side: "both" | "opponent";
      source: "ability" | "attack";
      exceptNamed?: string;
      damagedOnly?: true;
      /**
       * "Double the number of damage counters on each of your opponent's Pokémon." Each body takes
       * `amount` once per counter already on it, read before it changes.
       */
      perDamageCounterOnTarget?: true;
    }
  /**
   * "Put damage counters on ... until its remaining HP is N." Places `effectiveMaxHp - damage -
   * remainingHp` per body (in HP, no rounding), so it never knocks anything out; a null max places
   * nothing and a body already at or below the target takes nothing.
   */
  | {
      op: "counterUntilRemainingHp";
      target: "opponentActive" | "opponentBench";
      remainingHp: number;
      source: "ability" | "attack";
    }
  /**
   * Place `amount` HP of damage counters on the opponent's Active: no Weakness/Resistance (§8.5) or
   * reduction passive. `amount` is HP, converted from printed counters (§12) by the producer. Can
   * KO; the caller sweeps. `source` is the provenance the log row prints.
   */
  | {
      op: "damageActive";
      amount: number;
      source: "ability" | "attack";
      /** Alakazam "Powerful Hand": multiplies `amount` by the controller's hand size at resolve. */
      per?: Extract<DamageCountSource, { kind: "cardsInYourHand" }>;
    }
  /**
   * "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon."
   * Undamaged bodies are offered and whiff silently. The moved counters are placed, not attack
   * damage, so no Weakness/Resistance or reduction applies; the attack epilogue handles any Knock
   * Out.
   */
  | {
      op: "moveCountersToDefender";
      /**
       * Only Benched Pokémon with this owner prefix (e.g. `"Team Rocket"`) may be the source.
       * Absent = any Benched Pokémon.
       */
      ownerPokemon?: string;
      /**
       * Restricts the source to Benched bodies whose top card matches this filter (e.g. Ancient).
       */
      filter?: CardFilter;
    }
  /**
   * "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon." The
   * destination is a second choice.
   */
  | {
      op: "moveCountersChosen";
      /**
       * The Bench index the counters come off once the first choice is answered. Engine-written
       * only.
       */
      fromBench?: number;
    }
  /**
   * Team Rocket's Orbeetle "Rocket Brain": move 1 damage counter from 1 of your Team Rocket's
   * Pokémon to another of your Pokémon.
   */
  | {
      op: "moveCounterOwnChosen";
      /** The printed owner subgroup of the SOURCE, the bare owner name. Required: the one
          printing names one. */
      ownerPokemon: string;
      /** The SOURCE, once question 1 is answered. Engine-written only. */
      from?: PokemonTarget;
    }
  /**
   * Munkidori "Adrena-Brain": move up to N damage counters from 1 of your Pokémon to 1 of your
   * opponent's Pokémon.
   */
  | {
      op: "moveCountersToOpponentChosen";
      /** The printed ceiling ("up to 3"). */
      upTo: number;
      /** The SOURCE, once question 1 is answered. Engine-written only. */
      from?: PokemonTarget;
    }
  /**
   * Put a chosen number (0..`upTo`) of damage counters on this Pokémon and record how many, for a
   * following `damageDefender` to scale off (Walking Wake "Undulating Slice").
   */
  | {
      op: "putCountersOnSelfChosen";
      /** The printed ceiling ("up to 9"). */
      upTo: number;
    }
  /**
   * The copy-attack choice made at declaration time; only ever a parked `pendingOp`, never stepped.
   */
  | {
      op: "useAttackAs";
      from: AttackCopy["from"];
      owner?: AttackCopy["owner"];
      flip?: true;
      /** The copier's declared attack index. Engine-written only. */
      index: number;
      /** The SOURCE body (own Bench), once known. Engine-written only. */
      sourceRef?: PokemonTarget;
    }
  /**
   * The copy-attack choice made mid-attack (after the reveal or mill); only ever a parked
   * `pendingOp`, never stepped.
   */
  | { op: "reflipCoins"; toolUid: string; faces: CoinFace[]; retry: EffectOp }
  /**
   * Backtrack Badge offer at an attack's printed coin flip. Only ever a parked `pendingOp`,
   * resolved by attack.ts `resolveCoinRedo`; `index` is the declared attack and `copied` the copy
   * override, if any. Engine-written, never stepped.
   */
  | {
      op: "reflipAttackCoins";
      toolUid: string;
      index: number;
      faces: CoinFace[];
      copied?: AttackCopyOverride;
    }
  | {
      op: "useFoundAttackAs";
      from: ResolvedAttackCopy["from"];
      /** The copier's declared attack index. Engine-written only. */
      index: number;
      /** The eligible (card, attack) pairs found. Engine-written only. */
      candidates: { uid: string; attackIndex: number; name: string }[];
      /** Haughty Order's confirm, answered yes. Engine-written only. */
      accepted?: true;
    }
  /**
   * Mr. Mime "Look-Alike Show": use the effect of a Supporter in the opponent's revealed hand as
   * this attack's effect.
   */
  | { op: "useOpponentSupporterEffect" }
  /**
   * Ninetales "Supernatural Shapeshifter": discard the top card of your deck and, if it is a
   * Supporter whose play conditions are met, use its effect as this attack's effect. Never parks.
   */
  | { op: "useMilledSupporterEffect" }
  /**
   * Thievul "Skill Thief": the in-play copy choice, only ever a parked `pendingOp`, never stepped.
   */
  | {
      op: "useInPlayAttackAs";
      /** The copier's declared attack index. Engine-written only. */
      index: number;
      /** The eligible (body, attack) pairs. Engine-written only. */
      candidates: { uid: string; attackIndex: number; name: string }[];
    }
  /**
   * Move any number of damage counters between the opponent's own Pokémon, one at a time, under an
   * engine-written budget (Sableye "Damage Collection", Alakazam "Strange Hacking").
   */
  | {
      op: "moveCountersOpponentAnyWay";
      /** The printed SOURCE zone: `"bench"` (→ their Active) or `"any"` (→ their other Pokémon). */
      from: "bench" | "any";
      /** The counters this op may still move. Engine-written only. */
      budget?: number;
      /** This round's SOURCE, once the source question is answered. Engine-written only. */
      source?: PokemonTarget;
      /** This round's count, clamped. Engine-written only. */
      take?: number;
    }
  /**
   * Spread damage (§8.5): `amount` on each Benched Pokémon of the side `target` names, with no
   * Weakness/Resistance. Only places damage; the attack epilogue runs the KO check.
   */
  | {
      op: "spreadDamage";
      target: "opponentBench" | "yourBench";
      amount: number;
      /**
       * "for each Prize card your opponent has taken": multiplies `amount` by the opponent's taken
       * Prizes at resolve.
       */
      perTakenPrize?: true;
      /** Hits only Benched Pokémon that already have damage counters. */
      damagedOnly?: true;
    }
  /**
   * Put `amount` HP of damage counters on the Pokémon the watched action was just performed on
   * (`EffectContext.subjectUid`).
   */
  | { op: "damageSubject"; amount: number }
  /**
   * Put `amount` HP of damage counters on the controller's Pokémon holding the card an earlier op
   * recorded under `slot` ("place 2 damage counters on that Pokémon").
   */
  | { op: "countersOnRecordedBody"; slot: EffectSlot; amount: number }
  /** Heal `amount` from the Pokémon the watched action was performed on (Magearna "Auto Heal"). */
  | { op: "healSubject"; amount: number }
  /**
   * Recoil: place `amount` HP of damage on the attacker's own Active. Outside the §8.5 pipeline (no
   * Weakness/Resistance or reduction), so it logs as COUNTERS_PLACED source "self".
   */
  | {
      op: "damageSelf";
      amount: number;
      perDamageCounterOnSelf?: true;
      /** Who placed the counters, for the log row. Absent = the attack's own recoil. */
      source?: "trainer" | "ability";
      /**
       * `"source"` places on the program's source Pokémon (Active or Bench) instead of the Active;
       * a source that has left play whiffs silently.
       */
      on?: "source";
    }
  /**
   * Put `amount` HP of damage counters on `count` chosen Pokémon. Placed counters are not attack
   * damage: no Weakness/Resistance and no reduction passive.
   */
  | {
      op: "damageChosen";
      /**
       * Which Pokémon may be chosen. A target on the Active takes Weakness/Resistance (§8.5); a
       * Benched one does not.
       */
      target: "opponentBench" | "opponentAny" | "yourBench" | "yourAny";
      amount: number;
      /**
       * How many Pokémon the sentence names; `"all"` ("each of") hits every matching Pokémon
       * without a choice.
       */
      count: number | "all";
      /** The provenance the COUNTERS_PLACED row prints. Read only on the placement path. */
      source: "ability" | "attack" | "trainer";
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
      /**
       * "for each Energy attached to this Pokémon": multiplies `amount` by the Energy cards on the
       * attacker.
       */
      perEnergyOnSelf?: true;
      /**
       * "for each damage counter on that Pokémon": multiplies `amount` by the counters on the
       * chosen target.
       */
      perDamageCounterOnTarget?: true;
      /**
       * "This attack's damage isn't affected by Weakness or Resistance, or by any effects on that
       * Pokémon." Skips the target's Weakness/Resistance and its reduction passive; the attacker's
       * own bonus still applies.
       */
      ignoreWR?: true;
      /**
       * The bare "isn't affected by Weakness or Resistance" form: nulls only Weakness/Resistance,
       * so effects on the target still apply. Set together with `ignoreWR`.
       */
      wrOnly?: true;
      /** "that has any damage counters on it": narrows the candidate set only. */
      damagedOnly?: true;
      /** Narrows candidates by card class (e.g. "Benched Pokémon ex"). */
      filter?: CardFilter;
      /**
       * "for each Energy card you discarded in this way": multiplies `amount` by the number of uids
       * recorded in this slot.
       */
      perRecorded?: EffectSlot;
      /** Multiplies `amount` by the cards in the controller's discard pile matching this filter. */
      perDiscardPileCard?: CardFilter;
      /**
       * Tauros "Target Together": after the pick, flip a coin per own Pokémon in play matching this
       * filter; the hit is `amount` times heads.
       */
      perHeadsInPlay?: CardFilter;
      /**
       * Mega Zygarde ex "Nullifying Zero": one coin per candidate, all flipped before any damage;
       * heads targets take `amount`. Only used with `count: "all"`.
       */
      flipEach?: true;
      /**
       * Engine-written: coin faces kept after a declined Backtrack Badge offer, used instead of new
       * flips.
       */
      faces?: CoinFace[];
      /**
       * Engine-written: the chosen targets of a resumed pick, so the coins are flipped in `stepOp`
       * where an offer can park.
       */
      hitRefs?: PokemonRef[];
      /** "that has any Special Energy attached": narrows the candidate set. */
      specialEnergyOnly?: true;
      /**
       * "for each {G} Energy attached to this Pokémon": multiplies `amount` by the attacker's
       * Energy providing this type.
       */
      perTypedEnergyOnSelf?: BasicEnergyType;
    }
  /**
   * Deal `per × N` attack damage to the defender, where N is the number of cards recorded under the
   * `count` slot. Runs the full §8.5 pipeline.
   */
  | {
      op: "damageDefender";
      per: number;
      count: EffectSlot;
      /** Optional filter on which recorded cards count. Absent = every uid in the slot. */
      countFilter?: CardFilter;
      /**
       * "for each different type of Pokémon you revealed": N is the number of distinct Pokémon
       * types across the slot's cards rather than the number of cards.
       */
      distinctPokemonTypes?: true;
      base?: number;
      amount?: never;
    }
  /**
   * The same hit with a flat amount, decided when the program is built ("You may do N more
   * damage").
   */
  | {
      op: "damageDefender";
      per?: never;
      count?: never;
      countFilter?: never;
      distinctPokemonTypes?: never;
      amount: number;
    }
  /**
   * A §8.5 hit on whoever is the opponent's Active when this op runs ("This attack does N damage to
   * the new Active Pokémon.").
   */
  | { op: "damageNewActive"; amount: number }
  /**
   * "Flip a coin. If heads, ...": `ops` runs on the winning face only. `onTails` makes tails the
   * winning face.
   */
  | {
      op: "coinFlipGate";
      ops: EffectOp[];
      otherwise?: EffectOp[];
      onTails?: true;
      coins?: number;
      /**
       * Engine-written: coin faces kept after a declined Backtrack Badge offer, used instead of new
       * flips.
       */
      faces?: CoinFace[];
    }
  // Trainer and Ability ops, relative to the controller.
  // Draw `count` from the controller's deck, short-drawing on a shallower deck (deck-out is checked
  // only at turn start, §14.3). `recordAs` records the cards drawn.
  | {
      op: "drawCards";
      count: number;
      recordAs?: EffectSlot;
      from?: "bottom";
      who?: "eachPlayer";
      per?:
        | Extract<DamageCountSource, { kind: "opponentBenchCount" }>
        /** "Draw a card for each of your Ancient Pokémon in play." */
        | Extract<DamageCountSource, { kind: "pokemonInPlay" }>
        /**
         * "draw a card for each Pokémon you find there", counted after the opponent's hand is
         * revealed.
         */
        | Extract<DamageCountSource, { kind: "cardsInOpponentHand" }>
        /**
         * Draw per card recorded under `slot` by an earlier op; a decline records nothing and draws
         * 0.
         */
        | { kind: "recorded"; slot: EffectSlot };
    }
  /** "Draw cards until you have `size` cards in your hand" (Grusha) — draw
      `size − hand.length`, i.e. nothing at all when the hand already holds
      `size` or more (a bigger hand is never trimmed). Fully automatic like
      drawCards, and short-draws the same way on a shallow deck (§14.3 deck-out
      is a turn-START rule). Distinct from drawCards because the count is read
      off the CURRENT hand: two of these in a row is not two draws. */
  | {
      op: "drawUntilHandSize";
      size: number;
      /**
       * Mystery Garden: the target hand size is `size` times this count of Pokémon in play, read at
       * resolve.
       */
      per?: Extract<DamageCountSource, { kind: "pokemonInPlay" }>;
    }
  /** Discard the controller's whole hand (Professor's Research precedes a draw). */
  | { op: "discardHand" }
  /**
   * Amarys: "At the end of this turn, if you have 5 or more cards in your hand, discard your hand."
   * Records the threshold for `endTurn` to apply. Never parks.
   */
  | { op: "scheduleEndOfTurnHandDiscard"; atLeast: number }
  /**
   * "During your opponent's next turn, all of your Pokémon take N less damage from attacks." Adds a
   * side damage reduction stamped `state.turn + 1`, so Pokémon put into play later are covered too.
   */
  | {
      op: "installSideDamageReductionNextTurn";
      amount: number;
      /** Limits the reduction to Pokémon of this type. Absent = every Pokémon on the side. */
      pokemonType?: PokemonType;
    }
  /**
   * Acerola's Mischief: parks a choice of the controller's Pokémon and shields it from damage and
   * effects of attacks by `fromClass` Pokémon during the opponent's next turn.
   */
  | { op: "installChosenAttackShield"; fromClass: AttackerClass }
  /**
   * Roxie's Performance: "During your opponent's next turn, their Poisoned Pokémon can't retreat
   * (including newly Poisoned Pokémon)." Stamps the opponent's side with a `sideRetreatLock` for
   * the next turn. Never parks.
   */
  | { op: "lockSideRetreat"; status: "poisoned" }
  /**
   * Caretaker: "shuffle this Caretaker into your deck instead of discarding it." Moves the played
   * card (`playedUid`, not `sourceUid`) from the discard pile into the deck and shuffles; a no-op
   * when there is no played card or it has left the discard.
   */
  | { op: "shufflePlayedCardIntoDeck" }
  /**
   * Shuffle a deck (the tail of every search). Absent `whose` is the controller's own deck;
   * `"opponent"` shuffles the other seat's deck (Inkay: "You may have your opponent shuffle their
   * deck").
   */
  | { op: "shuffleDeck"; whose?: "opponent" }
  /**
   * Search the controller's deck for up to `max` cards matching `filter` and move them to `dest`.
   * The player may take fewer or none, so this parks on a card choice unless the deck holds no
   * candidate. `reveal` is the printed clause and is not implied by `dest`.
   */
  | {
      op: "searchDeck";
      filter: CardFilter;
      /**
       * `"deckTop"` puts the picks back on top of the deck in the order the answer names them
       * ("shuffle your deck, then put those cards on top of it in any order").
       */
      dest: "bench" | "hand" | "deckTop" | "discard" | "attachToSelf";
      /** `"any"` is the printed "any number of": no upper bound on the picks. */
      max: number | "any" | "yourBenchCount";
      /**
       * The printed take with no "up to": the player must take exactly the count when the deck
       * allows it. Absent, the search is declinable.
       */
      exact?: true;
      /** The printed *"reveal it/them"* — the found cards are named in the log
          (`DECK_SEARCHED`). Only meaningful with `dest: "hand"`; a bench search
          is public without it, and no printed bench search carries the word. */
      reveal?: true;
      /**
       * Multi-noun search ("a Pokémon, a Supporter card, and a Basic Energy card"): one pick per
       * group, each with its own filter.
       */
      also?: readonly { filter: CardFilter; max: number }[];
      /**
       * The printed "up to 2 Basic Pokémon or 1 Evolution Pokémon": an alternative to the op's own
       * `filter`/`max`. An answer must come wholly from one alternative and stay within its `max`.
       */
      orElse?: { filter: CardFilter; max: number };
      /**
       * The printed "of different types": a pairwise constraint among the picks rather than a
       * narrowing of any one of them.
       */
      distinctEnergyTypes?: true;
      /**
       * "Pokémon that are the same type as any Basic Energy attached to this Pokémon": the filter
       * is read from the board when the op runs.
       */
      typedAsAttachedBasicEnergy?: true;
      /**
       * Love Ball: "a Pokémon with the same name as 1 of your opponent's Pokémon in play." When the
       * op runs, group 0 is narrowed to the names on the top cards of the opponent's Active and
       * Bench.
       */
      sameNameAsOpponentInPlay?: true;
      /**
       * The printed "up to that many": group 0's ceiling is replaced by the length of what an
       * earlier op filed under this slot (Perrin).
       */
      maxRecorded?: EffectSlot;
      /**
       * File the uids this search actually moved under `slot`, so a following `recordGate` can read
       * "If you put any Pokémon onto your Bench in this way".
       */
      recordAs?: EffectSlot;
    }
  /**
   * "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to
   * evolve it. Then, shuffle your deck."
   */
  | {
      op: "evolveFromDeck";
      /** The body to evolve; absent means this Pokémon. Engine-written only. */
      onto?: PokemonTarget;
      names?: readonly string[];
      /**
       * Salvatore's "a card that has no Abilities": the offer keeps only deck cards with no
       * abilities. Optional, so a record without it is unfiltered.
       */
      noAbilities?: true;
      /**
       * Grand Tree's chained step: when this op actually places a card, one more `evolveFromDeck`
       * is queued onto the same spot (without this key, so the chain is exactly two long). A
       * decline or empty offer queues nothing.
       */
      thenEvolveAgain?: true;
      /**
       * Source zone is the hand (Phantump "Spiteful Evolution"): mandatory, forced with one
       * candidate, and refused before use when the hand holds none. No first-turn or same-turn
       * evolution ban is applied.
       */
      fromHand?: true;
      /**
       * File the evolution card actually placed (`[]` on a whiff), for "place 2 damage counters on
       * the Pokémon you evolved in this way". Read on the `fromHand` route only.
       */
      recordAs?: EffectSlot;
    }
  /**
   * "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon
   * and put it onto that Pokémon to evolve it. Then, shuffle your deck."
   */
  | { op: "evolveFromDeckEachBenched" }
  /**
   * "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon
   * to evolve it. Then, shuffle your deck."
   */
  | {
      op: "evolveFromDeckChosen";
      /**
       * Salvatore: "a card that has no Abilities". Narrows the body candidates to those the deck
       * can evolve with an Ability-free card, and carries onto the `evolveFromDeck` the answer
       * queues.
       */
      noAbilities?: true;
      /**
       * Grand Tree: Stage 1 from a Basic, optionally followed by a Stage 2, with the printed timing
       * bans.
       */
      bodyStage?: "Basic";
      /**
       * Grand Tree's printed parenthetical: a body is not offered on the controller's first turn or
       * when it was played this turn. Other evolve-from-deck ops deliberately skip these bans,
       * which apply to playing from the hand.
       */
      evolveTimingGates?: true;
      /**
       * The chained optional Stage 2 step, carried onto the `evolveFromDeck` the body answer
       * queues.
       */
      thenEvolveAgain?: true;
    }
  /**
   * "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card
   * that evolves from that Pokémon and put it onto that Pokémon to evolve it."
   */
  | { op: "evolveFromDeckEachChosen"; max: number; pokemonType: PokemonType }
  /**
   * Switch the controller's Active with one of their Benched Pokémon. Parks on the bench choice
   * unless exactly one is benched. The riders cover "Switch … . If you do, …".
   */
  | {
      op: "switchActive";
      ownerPokemon?: string;
      /** Energy-type subgroup on the benched candidates ("1 of your Benched {D} Pokémon"). */
      targetType?: PokemonType;
      /**
       * The printed exclusion by name ("except any Pecharunt ex"): an exact-case negated match on
       * `Card.name`.
       */
      exceptNamed?: string;
      /** The printed pronoun: the bench end is `ctx.sourceUid`'s body, not a
          pick. Absent = the free switch every other printing spells. */
      fromSource?: true;
      recordAs?: EffectSlot;
      /**
       * When true, `recordAs` files the demoted body (`wasActive`) instead of the promoted one
       * (Scramble Switch moves Energy from the Pokémon moved to the Bench).
       */
      recordDemoted?: true;
      /**
       * With `recordDemoted`, files the card the switch moved, not re-keyed through a later swap,
       * since AZ's Tranquility asks which card was moved to the Bench.
       */
      demotedAsMoved?: true;
    }
  /**
   * Gust: switch one of the opponent's Benched Pokémon into their Active spot. Parks on the
   * opponent-bench choice unless forced.
   */
  | {
      op: "gust";
      recordAs?: EffectSlot;
      basicOnly?: true;
      remainingHpAtMost?: number;
      optional?: true;
    }
  /**
   * Opponent-chosen switch-out: "Switch out your opponent's Active Pokémon to the Bench. (Your
   * opponent chooses the new Active Pokémon.)"
   */
  | { op: "opponentSwitchOut"; recordAs?: EffectSlot }
  /**
   * Take one Benched Pokémon off the board with everything attached and put the whole pile into its
   * owner's `dest`. `whose` picks whose Bench the candidates come from.
   */
  | {
      op: "returnBenched";
      whose: "self" | "opponent";
      dest: "deck" | "hand";
      /**
       * The printed "1 of your Pokémon": the Active joins the candidates. A returned Active leaves
       * its spot empty for the normal promotion path.
       */
      includeActive?: true;
    }
  /**
   * "Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched
   * Pokémon that you didn't choose, and all attached cards, into their deck." The pick names the
   * bodies that stay.
   */
  | { op: "returnBenchedRest"; keep: number }
  /**
   * "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into
   * your opponent's deck", as one shuffle.
   */
  | { op: "returnBenchedChosen"; count: number }
  /**
   * Area Zero Underdepths trim: the controller discards Pokémon from their own Bench until they
   * have 5. Produced only by flow.ts `runBenchTrim`, with the Bench owner as controller.
   */
  | { op: "trimBench" }
  /**
   * Tool trim: the controller discards Pokémon Tools from their first over-cap body until it
   * carries what `toolCapOf` allows. Produced only by flow.ts `runToolTrim`; the excess is re-read
   * when the op runs.
   */
  | { op: "trimTools" }
  /**
   * Tyme: the controller names a Pokémon in hand, the opponent guesses its HP, and whoever is right
   * draws 4. With `uid` absent the controller picks the card; then the opponent answers. `uid` is
   * engine-written only.
   */
  | { op: "opponentGuessesHp"; draw: number; uid?: string }
  /** Shuffle this Pokémon and all attached cards into its controller's deck. */
  | { op: "returnSelf"; dest?: "deck" | "deckTop" | "hand" | "discard"; attachmentsTo?: "discard" }
  /**
   * Zero to Hero: swap this Pokémon in place with a Palafin ex from the deck; attached cards,
   * damage, conditions and effects stay, and this card goes into the deck before the shuffle.
   */
  | { op: "switchWithDeckNamed"; name: string }
  /**
   * Ogre's Mask: swap an Ogerpon ex in play in place with an Ogerpon ex from the discard pile;
   * everything attached stays on the new Pokémon. `bodyUid`, the answered body, is engine-written
   * only.
   */
  | { op: "switchWithDiscardNamed"; filter: CardFilter; bodyUid?: string }
  /**
   * Ditto "Surprisingly Transform": swap this Pokémon in place with a chosen deck Pokémon passing
   * `filter`; the old top card goes into the deck.
   */
  | { op: "switchWithDeckChosen"; filter: CardFilter }
  /** Printed self-Knock Out cost: "If you use this Ability, this Pokémon is Knocked Out." */
  | { op: "knockOutSelf" }
  /**
   * Knock Out the opponent's Active by effect (§8.1); "Both Active Pokémon are Knocked Out" is
   * composed from this and the self Knock Out.
   */
  | { op: "knockOutDefender" }
  /**
   * Discard the opponent's Active and all attached cards (§8.6). It leaves play without being
   * Knocked Out, so no Prize is taken.
   */
  | { op: "discardDefender" }
  /** Knock Out 1 of the opponent's Pokémon chosen from a filtered candidate set (§8.1). */
  | {
      op: "knockOutChosen";
      /**
       * `opponentBench`: only the opponent's Bench. `opponentAny`: any of the opponent's Pokémon.
       * `anyExceptSelf`: every Pokémon in play except the attacker.
       */
      target: "opponentBench" | "opponentAny" | "anyExceptSelf";
      /** *"…Benched **Basic** Pokémon"*. `gust.basicOnly` verbatim, read through
          `matchesFilter`'s `basicPokemon` arm so board-side "Basic" stays ONE
          predicate. Absent = every body in scope. */
      basicOnly?: true;
      /** *"…that has **exactly 6** damage counters on it"*. The comparator is in
          the NAME (see above); the number is read off the print rather than
          hard-coded, so a second printing at a different count needs no arm.
          Absent = no counter window at all. */
      damageCountersExactly?: number;
      /**
       * "that has the least HP remaining": only bodies at the minimum remaining HP are offered; a
       * tie parks. Computed over the printed scope before the §11 filter, so a shielded least-HP
       * body is not replaced by the next one.
       */
      leastHpRemaining?: true;
    }
  /**
   * Knock Out each of the opponent's Pokémon with `remainingHpAtMost` HP or less remaining
   * (§8.1/§11). Shields are checked per body; it is an effect, not damage. Never parks.
   */
  | { op: "knockOutEach"; remainingHpAtMost: number }
  /** Take a Prize card without a Knock Out (§8.1). */
  | { op: "takePrize"; count?: number; thenShuffleHand?: true }
  /**
   * "Each player takes a Prize card" (§8.1): two `takePrizes` stages, the controller's first. If
   * both Prize rows empty, it is a §14 tie. Never parks.
   */
  | { op: "eachPlayerTakesPrize" }
  /**
   * "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card
   * on it into your opponent's deck." (§10)
   */
  | { op: "devolveEach"; toHand?: true }
  /**
   * "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it
   * into your opponent's hand."
   */
  | {
      op: "devolveChosen";
      defenderOnly?: true;
      whose?: "self";
      pokemonType?: PokemonType;
      depth?: "any";
      /** The answered own body. Engine-written only. */
      bodyUid?: string;
      /** How many cards that body sheds. Engine-written only. */
      shed?: number;
    }
  /** "Discard a Stadium in play." (§7.3) */
  | { op: "discardStadium" }
  /**
   * Heal the controller's own Pokémon: `amount` HP, or `"all"` its damage. Without `upTo` it heals
   * one and parks on a choice unless only the Active is in play; `upTo` is the printed "up to N …
   * each", which allows choosing none.
   */
  | {
      op: "healChosen";
      amount: number | "all";
      zone?: "bench";
      upTo?: number;
      remainingHpAtMost?: number;
      /**
       * Super Potion: "If you healed any damage in this way, discard an Energy from that Pokémon."
       * Both the forced and parked picks go through one helper.
       */
      discardEnergyFromHealed?: true;
      /**
       * Banner subgroup on the candidates ("1 of your Benched Ancient Pokémon"), matched on each
       * candidate's top card.
       */
      filter?: CardFilter;
      /**
       * "and it recovers from all Special Conditions": a picked Active schedules `clearStatus`; a
       * Benched pick needs nothing since Benched Pokémon carry no Special Conditions.
       */
      recoverHealed?: true;
      /**
       * Candidate pinned to a recorded body (AZ's Tranquility): only the controller's bodies
       * holding a uid filed under this slot, narrowed by `filter`, so at most one candidate and
       * never parked.
       */
      targetRecorded?: EffectSlot;
      /**
       * Wally's Compassion: "If you healed any damage in this way, put all Energy attached to that
       * Pokémon into your hand." Only fires when the healed body had damage; an undamaged pick
       * keeps its Energy.
       */
      energyToHandFromHealed?: true;
    }
  /**
   * Attach Basic Energy from the controller's hand or discard pile to a chosen own in-play Pokémon
   * (§6). Parks on a target pick unless exactly one Pokémon is in play; a source with no matching
   * Energy is a no-op. "Up to N" is auto-maxed since attaching is pure upside.
   */
  | {
      op: "attachEnergyFrom";
      source: "hand" | "discard";
      energyType?: string;
      /**
       * How many Energy this one decision attaches to the one chosen body ("attach up to 2 … to 1
       * of your Benched Pokémon"). Separate ops are used instead for "in any way you like". Absent
       * means 1; `min(count, available)` lands.
       */
      count?: number;
      /**
       * The printed "up to N" spread over N one-card ops: the player may decline this pick. Absent
       * means the pick is mandatory.
       */
      declinable?: true;
      /**
       * Disjunction "a Basic {R} Energy card, a Basic {F} Energy card, or 1 of each": ops sharing a
       * `recordAs` slot. An op becomes declinable only if an earlier op already attached or a later
       * one still can, so the result is never empty.
       */
      atLeastOne?: true;
      /**
       * The printed "an Energy card": Special Energy is reachable too. Absent means only Basic
       * Energy.
       */
      anyEnergy?: true;
      /**
       * Exact card name the attached Energy must have (e.g. "Spiky Energy"); the name subsumes the
       * Basic/Special test. Not combined with `energyType`.
       */
      energyName?: string;
      targetType?: string;
      basicOnly?: true;
      /** Only Stage 2 Pokémon may be the target. */
      stage2Only?: true;
      /** Owner-prefixed subgroup the attach may land on, e.g. "1 of your Iono's Pokémon". */
      ownerPokemon?: string;
      targetNames?: readonly [string, ...string[]];
      /** Only Benched Pokémon may be the target. */
      benchOnly?: true;
      bonusCounters?: number;
      notIfKO?: true;
      /**
       * The printed "this Pokémon": the sole target is the effect's source, wherever it sits. Other
       * target riders are ignored, and the op never parks.
       */
      toSelf?: true;
      /**
       * "Attach … to each of your Benched Pokémon": attaches to every eligible target without
       * asking, re-finding Energy per body and stopping when the pile runs dry.
       */
      toEach?: true;
      /**
       * Crispin: "put 1 of them into your hand. Attach the other to 1 of your Pokémon." The Energy
       * to attach is one of the cards filed under this slot, and the player chooses which type.
       */
      oneOfRecorded?: EffectSlot;
      /**
       * Files the Energy uids actually attached (§9.2) for a following `recordGate`; a whiff files
       * nothing.
       */
      recordAs?: EffectSlot;
      /**
       * "If you do, heal all damage from that Pokémon": heals the body just attached to, once per
       * op. `"all"` clears the damage; a number heals that much.
       */
      healTarget?: number | "all";
      /**
       * Engine-written, never authored: after the target is known and the pile holds more than one
       * card identity, the op is rescheduled with the target and take so the player picks which
       * Energy cards.
       */
      pickOnto?: { ref: PokemonRef; take: number };
      /**
       * "Attach … from your opponent's discard pile to their Pokémon": moves both the source pile
       * and the target board to the opponent. Absent means the controller's own.
       */
      whose?: "opponent";
    }
  /**
   * Retrieve up to `max` cards matching `filter` from the controller's discard pile into hand, deck
   * or Bench (§7.1). Parks on a card pick unless no candidate exists; `max: "all"` resolves forced.
   * `dest: "deck"` should be followed by `shuffleDeck`. `exclude` drops uids filed by an earlier op
   * (cards discarded by this card's own cost). A Bench destination is clamped to bench space; the
   * filter must name Pokémon, which is checked upstream.
   */
  | {
      op: "discardPileRetrieval";
      filter: CardFilter;
      dest: "hand" | "deck" | "bench";
      /** `"all"` is the printed "those": every matching card, moved without a prompt. */
      max: number | "all";
      /** File the uids actually moved under this slot (Miriam). */
      recordAs?: EffectSlot;
      /** Drop the uids filed under this slot from the candidates (SER). */
      exclude?: EffectSlot;
    }
  /** Look at the top `n` cards of a deck and put up to `max` matching `filter` into the hand. */
  | {
      op: "lookAtTopN";
      n: number;
      filter: CardFilter;
      /** `"any"` is the printed "any number of". */
      max: number | "any";
      /** Where the taken cards go. Absent means the hand. */
      dest?: "bench" | "discard";
      /** A second filter and cap over the same window ("a Pokémon and a Trainer card"). */
      also?: { filter: CardFilter; max: number };
      /** The printed "you may reveal": taken cards are named in the log. */
      reveal?: true;
      /** `max` is an exact number to take, not a ceiling ("put 2 of them into your hand"). */
      exact?: true;
      /** Where the cards not taken go. */
      restTo?: "discard" | "bottom" | "shuffledBottom";
      /** Which end of the deck is looked at. Absent means the top. */
      from?: "bottom";
      /**
       * `"opponent"` reads the opponent's deck, and the window, candidates, Bench clamp and
       * destination all move to the opponent's side together.
       */
      whose?: "opponent";
    }
  /** Look at the top `n` cards and put them back in any order. No card changes zone. */
  | {
      op: "reorderTop";
      n: number;
      side?: "opponent";
      /** Which end of the deck the window sits at. Absent means the top. */
      from?: "bottom";
      /** The printed ", or …" alternative, run when the ordering answer is empty. */
      otherwise?: EffectOp[];
      /** The printed second arm's own words, rendered as the alternative's
          button. REQUIRED-in-practice beside `otherwise` and optional in the
          type for the reason `optional.note` is authored rather than derived: a
          describer over the arm's ops would have to invent wording for every op
          it might ever hold, and the sentence is already sitting in the registry
          row. The pairing is asserted from outside rather than encoded here. */
      otherwiseNote?: string;
    }
  /** Shuffle the top `n` cards and put them on the bottom of the deck, clamped to the deck size. */
  | { op: "bottomDeckTop"; n: number }
  /**
   * Look at the top `n` cards of the controller's deck and attach Energy among them to the
   * controller's own in-play Pokémon.
   */
  | {
      op: "attachFromTop";
      n: number;
      filter: CardFilter;
      max: number | "any";
      targetType?: string;
      benchOnly?: true;
      /** Owner-prefixed subgroup the attach may land on. */
      ownerPokemon?: string;
      /** The printed "to this Pokémon": the source Pokémon is the only target; riders are ignored. */
      toSelf?: true;
      /** Where the cards not attached go. */
      restTo?: "discard" | "shuffledBottom";
    }
  /**
   * Mill: move the top `count` cards of `whose` deck into that player's discard pile in deck order
   * (§2).
   */
  | {
      op: "discardDeckTop";
      whose: "self" | "opponent" | "eachPlayer";
      count: number;
      recordAs?: EffectSlot;
    }
  /**
   * Discard the bottom `count` cards of the controller's deck, filing them under `recordAs`; an
   * empty deck files an empty list.
   */
  | {
      op: "discardDeckBottom";
      count: number;
      recordAs?: EffectSlot;
    }
  /**
   * Reveal the top `n` cards of the controller's deck, discard those matching `filter` (filed under
   * `recordAs`), and shuffle the rest back.
   */
  | {
      op: "revealTopDiscardMatching";
      n: number;
      filter: CardFilter;
      recordAs?: EffectSlot;
    }
  /**
   * Reveal the bottom `n` cards of the controller's deck, file the matches under `recordAs`,
   * discard the non-Pokémon, and shuffle the Pokémon back.
   */
  | {
      op: "revealDeckBottomCount";
      n: number;
      filter: CardFilter;
      recordAs: EffectSlot;
    }
  /**
   * Search the controller's deck for up to `max` Energy matching `filter` and attach them to the
   * controller's own in-play Pokémon.
   */
  | {
      op: "attachFromDeck";
      filter: CardFilter;
      max: number;
      /** A list allows a two-type target. */
      targetType?: string | readonly string[];
      benchOnly?: true;
      /** Owner-prefixed subgroup the attach may land on. Ignored under `toSelf`. */
      ownerPokemon?: string;
      /** Only Pokémon with this banner (e.g. Tera) may be targets. */
      targetBanner?: Banner;
      /** The attached Energy must all be of different types. */
      distinctEnergyTypes?: true;
      /** At most this many of the attached cards may land on any ONE Pokémon —
          the printed "for each of those Pokémon" (Janine's Secret Art). Absent =
          "in any way you like", no per-target limit. */
      maxPerTarget?: number;
      /**
       * The printed "attach them to 1 of your Pokémon": the whole batch lands on one body. Absent
       * allows any split.
       */
      oneTarget?: true;
      /** The printed "attach it to THIS Pokémon" (Pawmot "Electrogenesis"): the
          sole target is the Pokémon whose effect this is (`ctx.sourceUid`). No
          card prints it beside another target rule, and this member does not
          referee a co-authored one — it IGNORES `targetType`/`benchOnly` (the
          source ref is not filtered), while `maxPerTarget` would still cap the
          count. Authoring it alone is the rule; this doc is the enforcement. */
      toSelf?: true;
      /**
       * "For each of your Benched Pokémon, search … and attach it to that Pokémon": `max` is the
       * per-body count. A short answer stands, since the deck is hidden.
       */
      each?: true;
      recordAs?: EffectSlot;
    }
  /**
   * Attach cards from the controller's discard pile to chosen own Pokémon through one compound
   * pick; `maxPerTarget` caps cards per body.
   */
  | {
      op: "attachFromDiscard";
      filter: CardFilter;
      /**
       * Ceiling equal to the Energy attached to all of the opponent's Pokémon, resolved when the op
       * parks.
       */
      max: number | "opponentEnergyInPlay";
      maxPerTarget?: number;
      targetType?: string;
      benchOnly?: true;
      /** Only Pokémon with this banner (e.g. Future) may be targets. */
      targetBanner?: Banner;
      /**
       * "To each of your … Pokémon": mandatory, `max` per target. A short answer is topped up at
       * apply time with the next matching cards.
       */
      each?: true;
    }
  /**
   * Attach any number of Energy from the hand, each card choosing its own destination ("in any way
   * you like").
   */
  | {
      op: "attachFromHand";
      filter: CardFilter;
      /**
       * The printed "to this Pokémon": the sole target is the effect's source. With no source in
       * play the op files an empty record and does nothing.
       */
      toSelf?: true;
      /** Files the uids actually attached (§9.2), or an empty list on every dead end. */
      recordAs?: EffectSlot;
      /**
       * The printed singular "Attach an Energy card": exactly one card, mandatory; an empty answer
       * is topped up with the first offered card onto the first offered target.
       */
      one?: true;
      /** Only the Active Pokémon may be the target. */
      activeOnly?: true;
      /** Owner-prefixed subgroup the attach may land on. */
      ownerPokemon?: string;
      /** The printed "up to N": the cap is `min(max, candidates)`. Absent means any number. */
      max?: number;
      /**
       * Uses the opponent's hand and board, and the opponent answers the pick. Absent means the
       * controller's own.
       */
      whose?: "opponent";
    }
  /**
   * Discard Energy attached to an in-play Pokémon (§15 removal, or a §8 self-discard cost).
   * `filter` narrows which attached Energy may be taken; the card always goes to its owner's
   * discard pile.
   */
  | {
      op: "discardEnergy";
      /** `yours` is the controller's whole board; `self` is the program's own Pokémon by uid. */
      from:
        | "opponentActive"
        | "opponentChosen"
        | "yourActive"
        | "yours"
        | "yourBench"
        | "self"
        | "attacker";
      filter: CardFilter;
      /**
       * Engine-written only: the body `self` names when it is not the program's own card, e.g. the
       * Pokémon a heal just targeted.
       */
      bodyUid?: string;
      /**
       * Where the Energy goes. Absent means the discard pile; `"hand"` is the victim's own hand.
       */
      to?: "hand" | "deck";
      /** How many Energy the op takes in total: absent = one (the printed "an
          Energy"), a number = exactly that many, `"all"` = every match — which
          leaves no decision, so the op never parks under it — and `"any"` = the
          declinable "you may discard ANY amount" (Chien-Pao ex "Hail Blade"): 0
          up to every match, the player choosing HOW MANY as well as WHICH, so it
          ALWAYS parks on a non-empty board (the one count-mode with a decline). */
      count?: "all" | number | "any";
      /** Files the discarded uids under this §9.2 slot so a later op can count them. */
      recordAs?: EffectSlot;
      /** Only meaningful with `count: "any"`: an upper BOUND on the declinable
          up-to — the printed "up to N" (Mewtwo VSTAR "Psy Purge": discard up to
          3). Absent = uncapped (0..every match, Chien-Pao ex "Hail Blade"). It
          narrows ONLY the ceiling: the pick is still 0..min(cap, matches) and
          still DECLINABLE, so a capped op parks identically to the uncapped one. */
      cap?: number;
      /**
       * Types a later discard of the same sentence still needs. The offer prefers candidates whose
       * removal keeps those types matchable, so a multi-type Energy cannot fill this slot and dodge
       * a later one.
       */
      reserve?: BasicEnergyType[];
    }
  /** The `opponentEach` sweep, split out so a NUMERIC count cannot ride it: "one
      from EACH" already fixes how many come off (one per Pokémon with a match),
      and the field would be silently ignored. */
  | {
      op: "discardEnergy";
      from: "opponentEach";
      filter: CardFilter;
      /**
       * `"all"` discards every matching Energy from each opponent Pokémon; absent discards one from
       * each.
       */
      count?: "all";
      /** Not allowed here: no printed sweep returns Energy to a hand. */
      to?: never;
      recordAs?: never;
    }
  /**
   * Discard up to `count` Pokémon Tools from the opponent's Pokémon. `bodyUid`, one picked body, is
   * engine-written only.
   */
  | { op: "discardTools"; count: number | "all"; sides?: "both"; bodyUid?: string }
  /**
   * Ruffian: one pick of an opponent body, then a Tool and a Special Energy are discarded from that
   * body.
   */
  | { op: "discardToolAndSpecialEnergyChosen" }
  /**
   * Turn 1 of the actor's face-down Prize cards face up; it stays face up for the rest of the game.
   */
  | { op: "turnPrizeFaceUp"; side?: "opponent"; recordAs?: EffectSlot }
  /**
   * Shuffle the controller's Prize cards onto the bottom of the deck, then take that many from the
   * top as new Prize cards. Never parks.
   */
  | { op: "cycleOwnPrizes" }
  /**
   * Swap the revealed hand card into the turned prize's slot and put that prize into the opponent's
   * hand. Gated so it is never offered on a short board (§8.6).
   */
  | { op: "swapTurnedPrizeWithRevealed" }
  /**
   * Move up to `max` Energy from one in-play Pokémon to another on the same board (Energy Switch,
   * Poppy). The source Energy and the destination are chosen together on one compound `moveEnergy`
   * prompt and applied atomically, so a half-moved Energy is never a resting state. Declinable
   * unless `max` is `"all"`; `route` fixes the endpoints, and `anySource`/`anyDest` let one answer
   * draw from several sources or spread over several destinations.
   */
  | {
      op: "moveEnergy";
      filter: CardFilter;
      /**
       * `"any"` is the printed "any amount" and `"all"` the printed "all"; both clamp to the
       * movable count, but `"all"` also sets the prompt's `min` so it cannot be declined.
       */
      max: number | "any" | "all";
      route?: "benchToActive" | "koedActiveToToolHolder" | "selfToBench" | "othersToSelf";
      /**
       * Whose board the move happens on; absent is the controller's. With `"opponent"` both
       * endpoints are on the other seat's board, and the uid-anchored routes find no body there and
       * whiff.
       */
      side?: "opponent";
      /** Let ONE answer take Energy off SEVERAL of the offered sources (N's Plan's
          printed "from your Benched Pokémon", plural). Absent = the single-source
          coupling every other printed member of this family carries. */
      anySource?: true;
      /**
       * Lets one answer put its picks on several of the offered destinations (the printed "in any
       * way you like"). Rides the prompt as well as the op, because the wire validator and dialogs
       * read only the prompt.
       */
      anyDest?: true;
      /**
       * Narrows destinations to in-play bodies whose `stack` holds a uid filed under this slot ("to
       * the new Benched Pokémon"). Applied at the `stepOp` caller because the play gate has no
       * record to read.
       */
      destRecorded?: EffectSlot;
      /**
       * Narrows sources to in-play bodies whose `stack` holds a uid filed under this slot (Scramble
       * Switch: "from the Pokémon you moved to your Bench").
       */
      sourceRecorded?: EffectSlot;
    }
  /**
   * Put the affected players' hands back into their decks, then draw (Iono/Judge family). `draw` is
   * measured per affected seat. By default the hand is shuffled into the deck; with `toBottom` the
   * hand alone is shuffled and placed under the deck, keeping the deck's order. Never parks and is
   * always playable; events are count-only so hidden hands stay hidden.
   */
  | {
      op: "handRefresh";
      /** Which seats' hands go back: the controller, both players, or the opponent alone. */
      who: "you" | "both" | "opponent";
      draw: HandRefreshDraw;
      /** Shuffle the HAND alone and put it UNDER the deck, leaving the deck's own
          order intact (Iono), instead of shuffling the hand into the deck. */
      toBottom?: true;
      /** Draw only if ≥1 affected player actually moved ≥1 card (Iono). */
      onlyIfAnyMoved?: true;
    }
  /**
   * Pay a printed hand cost: spend exactly `count` cards from the controller's hand before the rest
   * of the program runs. Mandatory and exact; parks only on a genuine choice between
   * non-interchangeable cards. The play gate (`handCostUnmet`) refuses an unpayable cost on play
   * paths only; in an attack it pays what it can, so an attack-borne payment needs a printed cancel
   * or a `recordGate` on its own slot.
   */
  | {
      op: "payFromHand";
      count: number;
      /**
       * Where the paid cards go. `"deckBottom"` keeps the picked order; `"deckTop"` is Academy at
       * Night's top-of-deck payment.
       */
      to: "discard" | "deckBottom" | "deckTop";
      /** A ceiling on an already exact count would be silently ignored. */
      cap?: never;
      filter?: CardFilter;
      /** File the uids actually paid under this slot, for a later op to read —
          Superior Energy Retrieval excludes them from its retrieval, Dendra
          gates its draw on them ("if you do"). */
      recordAs?: EffectSlot;
      /**
       * Gumshoos "Evidence Gathering": switch a card from hand with the top card of the deck. Only
       * with `to: "deckTop"` and `count: 1`; the old top card goes to hand before the paid card
       * goes on top. An empty deck refuses the use.
       */
      swapWithTop?: true;
    }
  /**
   * The declinable hand discard ("Discard up to N ..."). The player picks 0..`cap` matching cards,
   * so it is not a cost and needs no cancel. Interchangeable copies are not collapsed below `cap`
   * because the count matters, and a non-empty offer always parks.
   */
  | {
      op: "payFromHand";
      /** The declinable quantifier — `discardEnergy.count`'s word for the same fact. */
      count: "any";
      /** The printed "up to N" ceiling, or `"any"` for "any number of cards". */
      cap: number | "any";
      /**
       * `"deckBottom"` is Perrin's "put them into your deck"; the program's trailing shuffle hides
       * the end.
       */
      to: "discard" | "deckBottom";
      filter?: CardFilter;
      recordAs?: EffectSlot;
      /** The swap is an exact one-card payment. */
      swapWithTop?: never;
    }
  /**
   * Reveal any number of matching cards from your own hand; nothing moves (Doublade "Weaponized
   * Swords"). The picked uids are shown to both players and filed under `recordAs` for a damage
   * count to read.
   */
  | {
      op: "revealFromHand";
      filter: CardFilter;
      note: string;
      recordAs: EffectSlot;
    }
  /**
   * Reveal the opponent's whole hand, then the controller picks one card matching `filter` and puts
   * it on the bottom of the opponent's deck (Ortega, Greavard). The pick is mandatory; the offer
   * collapses interchangeable copies, which is safe because the hand was just revealed.
   */
  | {
      op: "bottomFromOpponentHand";
      /** Which cards may be chosen — absent is Ortega's bare "a card" (any).
          `supporter` is Greavard's printed narrowing. */
      filter?: CardFilter;
      /** File the uid actually moved under this slot for a later op to read —
          Ortega's "If you put a card on the bottom of your opponent's deck in
          this way" is a plain recordGate on it. */
      recordAs?: EffectSlot;
      /**
       * Where the chosen card goes; absent is the bottom of the owner's deck. `"deck"` shuffles it
       * into the owner's deck.
       */
      dest?: "bench" | "discard" | "deck";
      /**
       * The printed "up to N" (or `"any"` for "any number of"); absent means exactly one mandatory
       * card. When set, the pick is declinable, a single candidate is still asked, and the offer
       * keeps `upTo` copies per interchangeable class.
       */
      upTo?: number | "any";
    }
  /**
   * "Your opponent reveals their hand." Never parks and moves nothing. The reveal is a log event
   * only; the redacted state keeps the hand hidden because the reveal is instantaneous.
   */
  | { op: "revealOpponentHand" }
  /**
   * Take a card at random from the opponent's hand, drawn from `rngState` so replays are
   * deterministic. `to` is where it goes: discard, shuffled into their deck, or `"reveal"` (stays
   * in hand, only that card shown). An empty hand emits nothing and advances no rng.
   */
  | {
      op: "randomFromOpponentHand";
      to: "discard" | "deck" | "reveal";
      recordAs?: EffectSlot;
      /**
       * Hand Trim: repeat the random discard until the hand has `untilHandSize` cards, each take
       * its own rng draw. Used only with `to: "discard"`.
       */
      untilHandSize?: number;
    }
  /**
   * The opponent discards `count` cards from their own hand and chooses which, so the park's
   * decider is the opponent and the candidates are hidden from the controller. A hand of `count` or
   * fewer is forced; an empty hand is a silent no-op. No collapse of interchangeable copies, since
   * the answerer sees their own hand.
   */
  | {
      op: "opponentDiscardsFromHand";
      count: number;
      /**
       * Absent means the discard pile; `"deck"` puts the cards into the owner's deck, with the
       * shuffle emitted as a separate op.
       */
      to?: "deck";
      untilHandSize?: never;
      whose?: never;
    }
  /**
   * The opponent discards down to `untilHandSize` cards (Xerosic's Machinations), choosing which. A
   * hand at or below the size is a silent no-op.
   */
  | {
      op: "opponentDiscardsFromHand";
      untilHandSize: number;
      count?: never;
      to?: never;
      /**
       * `"self"` applies to the controller's own hand (Hand Trimmer, authored after the opponent's
       * op). The played Trainer has already left the hand, so it is never counted.
       */
      whose?: "self";
    }
  /**
   * Discard every card in the opponent's hand matching `filter` ("Discard all Item cards and
   * Pokémon Tool cards you find there"). No pick and no park; an empty match is a silent no-op.
   */
  | { op: "discardFromOpponentHand"; filter: CardFilter }
  /**
   * The controller's opponent may draw `count` cards (Ortega). The park's decider is the opponent,
   * so only they can answer. An empty opponent deck resolves silently without asking.
   */
  | { op: "opponentMayDraw"; count: number }
  /**
   * Run `ops` when `cond` holds for the controller, else `otherwise`. Ops inside a branch can
   * still park. Emits no event, and `cond` is evaluated after every earlier op has applied.
   */
  | { op: "conditionGate"; cond: BoardCondition; ops: EffectOp[]; otherwise?: EffectOp[] }
  /**
   * Run `ops` when an earlier op in this program filed at least one card under `slot` (the printed
   * "if you do" / "in this way"), else `otherwise`. `contains: "yourActive"` requires a filed card
   * to be attached to the controller's Active now, which is a board read and can differ from
   * history if an op in between moves it.
   */
  | {
      op: "recordGate";
      slot: EffectSlot;
      contains?: "yourActive";
      ops: EffectOp[];
      otherwise?: EffectOp[];
    }
  /**
   * The printed "You may ...": a `confirm` prompt whose yes runs `ops` and no runs `otherwise`.
   * `note` is the whole printed sentence. Only needed when the inner op has no empty answer of its
   * own. `labels` replace Yes/No with captions for a "Choose 1" card.
   */
  | {
      op: "optional";
      note: string;
      ops: EffectOp[];
      otherwise?: EffectOp[];
      labels?: { yes: string; no: string };
      /** Optional card faces for a binary card choice; resolution still uses the branches. */
      cards?: { yes: string; no?: string };
      targets?: PokemonRef[];
      /**
       * The printed "Ask your opponent if ...": the opponent answers the confirm, but the branches
       * still run for the controller.
       */
      askOpponent?: true;
    }
  /**
   * The printed "Choose 1" over branches that may have nothing to do (Blowtorch). Only branches
   * with a target on the board are offered: none is a no-op, one runs forced, two or more ask via a
   * labelled `optional`. The play is refused when no branch is offered.
   */
  | {
      op: "chooseOneOffered";
      note: string;
      branches: EffectOp[];
      labels: string[];
    };

/**
 * The resource an `AttackDamageBonus` counts. Energy counts on board read provision; counts over a
 * discard pile or hand read the printed card. "In play" means Active plus Bench, unlike the
 * Bench-only counts. `boardCondition` is a 0-or-1 indicator for conditional flat bonuses.
 */
export type DamageCountSource =
  | { kind: "damageCountersOnSelf" }
  | { kind: "opponentPrizesTaken" }
  /** Prizes the attacker has taken. */
  | { kind: "yourPrizesTaken" }
  /** Prizes the attacker's opponent took during their last turn. */
  | { kind: "opponentPrizesTakenLastTurn" }
  /** Attack damage the attacker took during the opponent's last turn, in HP (`per: 1`). */
  | { kind: "attackDamageTakenLastTurnOnSelf" }
  | { kind: "opponentActiveRetreatCost" }
  | { kind: "boardCondition"; cond: BoardCondition }
  | { kind: "damageCountersOnOpponentActive" }
  /**
   * Number of Special Conditions on the opponent's Active, via `presentStatuses` (at most 3;
   * `confusionDamage` is not a condition).
   */
  | { kind: "specialConditionsOnOpponentActive" }
  /** Optional noun filter; `undefined` counts every Benched Pokémon. */
  | { kind: "damageCountersOnYourBench"; filter?: CardFilter }
  /** Damage counters on every opponent Pokémon in play (Active plus Bench). */
  | { kind: "damageCountersOnOpponentBoard" }
  | { kind: "bothSidesBenchCount" }
  | { kind: "opponentBenchCount" }
  | { kind: "yourBenchCount"; filter?: CardFilter }
  | {
      kind: "energyOnOpponent";
      zone: OpponentEnergyZone;
      /** `"basic"` matches Basic Energy cards. */
      energyType: EnergyClass | null;
    }
  | {
      kind: "energyOnSelf";
      zone?: "board";
      /**
       * `"basic"` counts Basic Energy cards, not provision, so a Special Energy providing a basic
       * type is excluded.
       */
      energyType: EnergyClass | null;
      /** Optional noun filter narrowing the board zone; only meaningful with `zone: "board"`. */
      filter?: CardFilter;
    }
  | { kind: "bothActivesEnergyCount" }
  | { kind: "toolsOnYourBoard" }
  | { kind: "extraEnergyUnitsBeyondCost"; extra: number }
  /**
   * Matching Pokémon in play on both seats. `damagedOnly` restricts the count to Pokémon with
   * damage counters.
   */
  | { kind: "pokemonInPlay"; seat: CountSeat; filter: CardFilter; damagedOnly?: true }
  | { kind: "bothSidesPokemonInPlay"; filter: CardFilter }
  | { kind: "cardsInDiscardPile"; seat: DiscardPileSeat; filter: CardFilter }
  | { kind: "cardsInOpponentHand"; filter: CardFilter }
  /** Every card in the attacker's own hand. */
  | { kind: "cardsInYourHand" }
  /** Every Energy card attached to every Pokémon in play, both seats. */
  | { kind: "energyInPlayBothSides" }
  /** Every Pokémon Tool on both boards. */
  | { kind: "toolsInPlayBothSides" }
  /**
   * Number of distinct Basic Energy types attached across the attacker's board; Special Energy adds
   * no type.
   */
  | { kind: "basicEnergyTypesOnYourBoard" }
  /** Attacker's Benched Pokémon with any damage counters; the Active is not counted. */
  | { kind: "damagedBenchedPokemon" }
  /** Attacker's Benched Pokémon with any Energy providing `energyType` attached. */
  | { kind: "benchedPokemonWithEnergy"; energyType: BasicEnergyType }
  /** Attacker's Benched Pokémon whose effective maximum HP is exactly `hp`. */
  | { kind: "benchedPokemonWithMaxHp"; hp: number };

/** Whose discard pile is counted, relative to the attacking seat. */
export type CountSeat = "you" | "opponent";
/** Alias of `CountSeat`. */
export type DiscardPileSeat = CountSeat;

/** Which opponent Pokémon an `energyOnOpponent` count walks. `"board"` is Active plus Bench. */
export type OpponentEnergyZone = "active" | "board";

/**
 * Where the copied attack comes from. `opponentActiveTera` requires the opponent's Active to be a
 * Tera Pokémon; `benchOwner` is the attacker's own Benched `<owner>'s Pokémon`. `flip` is Try to
 * Imitate's coin, taken after the choice.
 */
export interface AttackCopy {
  from: "opponentActive" | "opponentActiveTera" | "benchOwner";
  /** The printed owner prefix, `benchOwner` only ("N"). */
  owner?: "N";
  flip?: true;
}

/**
 * Copy kinds whose source is found while the attack resolves, so the choice comes after the reveal
 * or mill. `opponentDeckTop`: reveal the opponent's top 10, optionally copy an attack from a
 * Pokémon there, then shuffle them back. `ownDeckTopMill`: discard the top card; only a Pokémon
 * without a Rule Box offers its attacks, and the choice is mandatory. Separate from `AttackCopy` so
 * the persisted `useAttackAs.from` keeps its three members.
 */
export type ResolvedAttackCopy =
  | { from: "opponentDeckTop"; count: 10; may: true }
  | { from: "ownDeckTopMill"; count: 1 };

/**
 * Skill Thief: every Pokémon the opponent has in play (Active first, then the Bench in order) is a
 * source, only while the copier's controller has no cards in hand at declaration. Separate type so
 * the persisted `useAttackAs.from` keeps its three members.
 */
export interface InPlayAttackCopy {
  from: "opponentInPlay";
  ifEmptyHand: true;
}

/**
 * A specific in-play Pokémon, addressed by the board it sits on and the spot. The interpreter
 * validates the ref against the live board.
 */
export interface PokemonRef {
  seat: Seat;
  spot: PokemonTarget;
}

/** The rule-box suffix a Pokémon's name carries ("V", "VMAX", "VSTAR", "ex", "GX"). */
export type PokemonSuffix = "ex" | "V" | "VMAX" | "VSTAR" | "GX";

/**
 * The override `attack()` re-enters with. `empty` means no candidate; otherwise the source attack,
 * card, body and index. `flip` is Try to Imitate's printed coin.
 */
export type AttackCopyOverride =
  | { empty: true; flip?: true }
  | {
      empty?: undefined;
      attack: Attack;
      card: Card;
      body: InPlayPokemon;
      index: number;
      flip?: true;
      /**
       * The second half of a resolve-time copy: no declaration, no lock or Confusion coin, no
       * reveal. `body` is a one-card phantom body over the source card.
       */
      resumed?: true;
    };

/**
 * Printed timing or cost clause on one attack index. `onlyIf` and `barredIf` block,
 * `firstTurnExempt` lifts the first-turn ban, and `alternateCostIf` / `costWaivedIf` only change
 * the cost and never block.
 */
export type AttackTimingGate =
  /** *"You can use this attack only if <condition>."* — the index is barred
      unless the condition holds. Illumise / Scream Tail ex. */
  | { kind: "onlyIf"; condition: BoardCondition }
  /** *"If <condition>, you can't use this attack."* — the index is barred while
      the condition holds. Terapagos ex ×7. */
  | { kind: "barredIf"; condition: BoardCondition }
  /** *"If you go first, you can use this attack during your first turn."* — §4's
      turn-1 attack ban is lifted for THIS index only. Volbeat / Exeggcute. */
  | { kind: "firstTurnExempt" }
  /**
   * While the condition holds, `cost` is an alternate cost the attack may be paid with instead of
   * the printed one. Excluded from `BlockingAttackGate`, otherwise it would be read as a ban.
   */
  | { kind: "alternateCostIf"; condition: BoardCondition; cost: readonly string[] }
  /**
   * While the condition holds, the attack costs nothing. The waive is applied last, after every
   * surcharge. Never blocks.
   */
  | { kind: "costWaivedIf"; condition: BoardCondition };
