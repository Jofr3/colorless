import { ANY_ENERGY, constrainedEnergyUnit } from "./cards";
import { canonicalPrinting } from "./printGroups";
import { PROGRAM_ALIAS } from "./registryAliases.generated";
import type { CardProgram } from "./programTypes";
import { activated, berry, searchThenShuffle, searchTopOrderProgram } from "./registryBuilders";
import { BENCH_CEILING } from "./types";

export type {
  AbilityProgram,
  AttackTimingGate,
  CardProgram,
  EnergyOnAttach,
  EnergyProgram,
  KoPrizeReduction,
  MaxHpScale,
  PassiveEffects,
  StadiumAbility,
  StadiumEffects,
  TriggeredAbility,
  TriggerTiming,
} from "./programTypes";

// The id-keyed card-program registry. It sits above the text deriver: attacks resolve
// `programFor(id)?.attack ?? deriveAttackEffect(text)`, and Trainers/Abilities have no deriver, so
// unauthored ones can't be played.

// ── The programs, authored from the printed text. ──

/** "Discard your hand and draw 7 cards." (Supporter) */
const PROFESSORS_RESEARCH: CardProgram = {
  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 7 }],
};

/** "Search your deck for a Basic Pokémon and put it onto your Bench. Then,
    shuffle your deck." (Item) */
const NEST_BALL: CardProgram = {
  trainer: searchThenShuffle({ filter: { kind: "basicPokemon" }, dest: "bench", max: 1 }),
};

/** "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."
    (Supporter — the gust archetype) */
const BOSSS_ORDERS: CardProgram = { trainer: [{ op: "gust" }] };

/** Counter Catcher — play only while you have more Prize cards remaining than
    your opponent, then switch in one of their Benched Pokémon. */
const COUNTER_CATCHER: CardProgram = {
  trainerPlayableIf: { kind: "morePrizesThanOpponent" },
  trainer: [{ op: "gust" }],
};

const SWITCH: CardProgram = { trainer: [{ op: "switchActive" }] };

/**
 * Surfer. `drawUntilHandSize` never trims, so with 5 or more cards nothing is drawn, but the card
 * is still playable because the switch happens.
 */
const SURFER: CardProgram = {
  trainer: [
    { op: "switchActive", recordAs: "moved" },
    { op: "recordGate", slot: "moved", ops: [{ op: "drawUntilHandSize", size: 5 }] },
  ],
};

/**
 * Team Rocket's Giovanni: the gust happens only if the narrowed self-switch did. Prime Catcher: the
 * same two ops in the opposite order; it is playable with an empty own Bench because only the gust
 * gates play.
 */
const PRIME_CATCHER: CardProgram = {
  trainer: [
    { op: "gust", recordAs: "moved" },
    { op: "recordGate", slot: "moved", ops: [{ op: "switchActive" }] },
  ],
};

const TEAM_ROCKETS_GIOVANNI: CardProgram = {
  trainer: [
    { op: "switchActive", ownerPokemon: "Team Rocket", recordAs: "moved" },
    { op: "recordGate", slot: "moved", ops: [{ op: "gust" }] },
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
  trainer: searchThenShuffle({
    filter: { kind: "basicEnergy" },
    dest: "hand",
    max: 1,
    reveal: true,
  }),
};

/**
 * Jacq: search for up to 2 Evolution Pokémon to hand, revealed. Playable even if the deck has none.
 */
const JACQ: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "evolutionPokemon" },
    dest: "hand",
    max: 2,
    reveal: true,
  }),
};

/**
 * Chien-Pao ex. "Hail Blade" discards any amount of {W} Energy from your Pokémon and deals 60 for
 * each; the printed base is suppressed because the program owns the damage.
 */
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
      program: searchThenShuffle({
        filter: { kind: "basicEnergy", energyType: "Water" },
        dest: "hand",
        max: 2,
        reveal: true,
      }),
    },
  ],
};

/**
 * Mewtwo VSTAR "Psy Purge": capped discard of up to 3 Psychic Energy, 90 damage each. Authored only
 * at index 0, so "Star Raid" stays unsimulated rather than inheriting it.
 */
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

/**
 * Iron Thorns ex "Initialization": while Active, Rule Box Pokémon in play have no Abilities, except
 * Future Pokémon.
 */
const INITIALIZATION: CardProgram = {
  passive: {
    disableAbilities: {
      side: "both",
      requiresActive: true,
      ruleBox: true,
      exemptBanner: "Future",
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

/**
 * Cornerstone Mask Ogerpon ex "Cornerstone Stance": prevent attack damage from opposing Pokémon
 * that have an Ability. The gate reads the attacker, not the holder.
 */
const CORNERSTONE_STANCE: CardProgram = { passive: { preventDamageFromHasAbility: true } };

/**
 * Carracosta "Mighty Shell": prevent damage and effects of attacks from opposing Pokémon with any
 * Special Energy attached. The gate reads the attacker's attachments, not the holder's.
 */
const MIGHTY_SHELL: CardProgram = {
  passive: { preventDamageAndEffectsFromSpecialEnergy: true },
};

/**
 * Poltchageist and Misty's Magikarp: while Benched, prevent all damage and effects of the
 * opponent's attacks. The constant's name does not match any printed Ability; the cards share it
 * because they print the same sentence.
 */
const CURIOUS_TEA_PARTY: CardProgram = {
  passive: { preventDamageAndEffectsWhileBenched: true },
};

/**
 * Fraxure "Unnerve" and Cetitan ex "Snow Camouflage": prevent all effects of the opponent's Items
 * and Supporters on this Pokémon.
 */
const UNNERVE: CardProgram = {
  passive: { preventTrainerEffects: true },
};

/**
 * Rhyperior "Wide Wall": while Active, prevent effects of the opponent's Supporters on all your
 * Pokémon. Items are not covered.
 */
const WIDE_WALL: CardProgram = {
  passive: { preventSupporterEffectsWhileActive: true },
};

/** Tyranitar "Daunting Gaze": while Active, the opponent cannot play Items. */
const DAUNTING_GAZE: CardProgram = {
  passive: { preventOpponentHandPlay: ["Item"] },
};

/**
 * Jellicent ex "Oceanic Curse": while Active, the opponent cannot play Items or Tools. Tools are
 * checked in `attachTool`, since they never reach the Item/Supporter branch.
 */
const OCEANIC_CURSE: CardProgram = {
  passive: { preventOpponentHandPlay: ["Item", "Tool"] },
};

/**
 * Copperajah "Massive Body": while Active, the opponent cannot play Stadiums. Checked inside
 * `playStadium`.
 */
const MASSIVE_BODY: CardProgram = {
  passive: { preventOpponentHandPlay: ["Stadium"] },
};

/**
 * Genesect "ACE Nullifier": while it has a Tool attached, the opponent cannot play ACE SPEC cards.
 */
const ACE_NULLIFIER: CardProgram = {
  passive: { preventOpponentAceSpecPlayWhileToolAttached: true },
};

/**
 * Team Rocket's Arbok "Potent Glare": while Active, the opponent cannot play Pokémon with an
 * Ability from hand, except Team Rocket's Pokémon. The exception is subtracted, so Team Rocket's
 * Mimikyu is allowed.
 */
const POTENT_GLARE: CardProgram = {
  passive: {
    preventOpponentPokemonPlay: {
      acts: ["evolve", "bench"],
      only: { kind: "abilityPokemon" },
      except: { kind: "ownerPokemon", owner: "Team Rocket" },
    },
  },
};

/**
 * Skeledirge "Unaware": prevent all effects of the opponent's attacks on this Pokémon; damage is
 * not an effect.
 */
const UNAWARE: CardProgram = {
  passive: { preventAttackEffects: true },
};

/**
 * Team Rocket's Articuno "Repelling Veil": prevent effects of the opponent's attacks on your Basic
 * Team Rocket's Pokémon, including itself.
 */
const REPELLING_VEIL: CardProgram = {
  passive: {
    preventAttackEffectsForGroup: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
  },
};

/**
 * Rabsca "Spherical Shield": prevent damage and effects of the opponent's attacks on your Benched
 * Pokémon. It has no source-zone clause, so a Benched Rabsca also shields itself.
 */
const SPHERICAL_SHIELD: CardProgram = {
  passive: { preventBenchDamageAndEffects: true },
};

/**
 * Shaymin "Flower Curtain": prevent attack damage to your Benched Pokémon without a Rule Box. Uses
 * `hasRuleBox`, which is wider than the ex/V pair the reminder text names.
 */
const FLOWER_CURTAIN: CardProgram = {
  passive: { preventBenchDamageNoRuleBox: true },
};

/** Drednaw "Impervious Shell": prevent attack damage to this Pokémon if it is 200 or more. */
const IMPERVIOUS_SHELL: CardProgram = {
  passive: { preventDamageAtOrAbove: 200 },
};

/**
 * Fezandipiti "Adrena-Pheromone": if it has {D} Energy and is damaged by an attack, flip a coin;
 * heads prevents the damage. No coin is flipped when the damage is already 0, so the RNG is not
 * advanced.
 */
const ADRENA_PHEROMONE: CardProgram = {
  passive: {
    preventDamageOnCoinFlip: { ability: "Adrena-Pheromone", requiresEnergyType: "Darkness" },
  },
};

/** Kecleon "Expert Hider": the same coin-flip prevention without the Energy condition. */
const EXPERT_HIDER: CardProgram = {
  passive: { preventDamageOnCoinFlip: { ability: "Expert Hider" } },
};

/**
 * Sylveon "Safeguard" and Crustle "Mysterious Rock Inn": prevent attack damage from the opponent's
 * Pokémon ex. Not named `SAFEGUARD`, which is Mimikyu's ex-and-V version.
 */
const PREVENT_FROM_EX: CardProgram = {
  passive: { preventDamageFromAttackerClass: { suffix: "ex" } },
};

/** Farigiraf ex "Armor Tail": prevent attack damage from the opponent's Basic Pokémon ex. */
const PREVENT_FROM_BASIC_EX: CardProgram = {
  passive: { preventDamageFromAttackerClass: { suffix: "ex", stage: "basic" } },
};

/**
 * Pikachu ex "Resolute Heart" and Crustle "Sturdy": if at full HP and would be Knocked Out by
 * attack damage, survive with 10 HP.
 */
const KO_SURVIVAL: CardProgram = { passive: { survivesKoAtFullHp: true } };

/** Clefable ex (sv03-082) — "Lunar Zone": "All of your Pokémon that have {P}
    Energy attached have no Retreat Cost." — a continuous own-board aura, gated
    PER TARGET on the target carrying {P} (so Clefable ex frees itself only while
    it too holds a Psychic Energy). Stage-agnostic and with no "in the Active
    Spot" clause; the only "no Retreat Cost" print in the pool. */
const LUNAR_ZONE: CardProgram = {
  passive: { noRetreatCostAura: { requiresEnergyType: "Psychic" } },
};

/**
 * Spidops ex "Trap Territory": the opponent's Active's Retreat Cost is {C} more. The source can be
 * anywhere in play.
 */
const TRAP_TERRITORY: CardProgram = { passive: { opponentActiveRetreatSurcharge: { amount: 1 } } };

/**
 * Ariados "Big Net": the opponent's Active Evolution Pokémon's Retreat Cost is {C} more; a Basic
 * Active pays nothing.
 */
const BIG_NET: CardProgram = {
  passive: {
    opponentActiveRetreatSurcharge: { amount: 1, target: { kind: "evolutionPokemon" } },
  },
};

/**
 * Toedscruel "Secret Forest Path": while Benched, your Active's Retreat Cost is {C}{C} less. Summed
 * with other deltas and floored once, and multiple sources stack.
 */
const SECRET_FOREST_PATH: CardProgram = {
  passive: { ownActiveRetreatDiscount: { amount: 2, sourceOnBench: true } },
};

/**
 * Snorlax "Block": while Active, the opponent's Active can't retreat. A continuous aura read at the
 * retreat gate, not the turn-scoped `retreatBlocked` flag.
 */
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

/** Ethan's Magcargo "Melt Away": no Retreat Cost while it has no Energy attached. */
const MELT_AWAY: CardProgram = {
  passive: { noRetreatCostSelf: { requiresNoEnergyAttached: true } },
};

/**
 * Entei "Pressure": while Active, the opponent's Active's attacks do 20 less damage before W/R.
 * Authored rather than derived because it is a permanent Ability, not attack text.
 */
const PRESSURE: CardProgram = { passive: { opponentActiveAttackDebuff: 20 } };

/** Walking Wake ex "Azure Seas": its attack damage ignores effects on the opponent's Active. */
const AZURE_SEAS: CardProgram = { passive: { suppressTargetEffectsOnAttack: true } };

/**
 * Dachsbun "Well-Baked Body": can't be Burned, and prevent attack damage from the opponent's {R}
 * Pokémon.
 */
const WELL_BAKED_BODY: CardProgram = {
  passive: { statusImmunities: ["burned"], preventDamageFromType: "Fire" },
};

/** Pachirisu "Electricity Pouches": can't be Paralyzed. Its attack is left unauthored. */
const ELECTRICITY_POUCHES: CardProgram = { passive: { statusImmunities: ["paralyzed"] } };

/** Bellibolt "Insulator": prevent attack damage from the opponent's {L} Pokémon. */
const INSULATOR: CardProgram = { passive: { preventDamageFromType: "Lightning" } };

/** Thundurus "Adverse Weather": while Active, prevent attack damage to your Benched Pokémon. */
const ADVERSE_WEATHER: CardProgram = { passive: { preventBenchDamageWhileActive: true } };

/** Seismitoad "Quaking Zone": while Active, the opponent's Active's attacks cost {C} more. */
const QUAKING_ZONE: CardProgram = { passive: { opponentActiveAttackCostSurcharge: 1 } };

/**
 * Radiant Charizard "Excited Heart": its attacks cost {C} less for each Prize card the opponent has
 * taken.
 */
const EXCITED_HEART: CardProgram = { passive: { attackCostDiscountPerOpponentPrize: 1 } };

// ── The persistent-zone Trainers (Stadium §7.3, Tool §7.4). ──

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

/** Neutralization Zone. Its second sentence is the card-level `discardPileLocked`. */
const NEUTRALIZATION_ZONE: CardProgram = {
  stadium: { preventDamageToNoRuleBoxFromExV: true },
  discardPileLocked: true,
};

/** Lively Stadium: each Basic Pokémon in play gets +30 HP, on both sides. */
const LIVELY_STADIUM: CardProgram = { stadium: { hpDelta: { amount: 30, stage: "basic" } } };

/**
 * Gravity Mountain: each Stage 2 Pokémon in play gets -30 HP. Playing it does not trigger a Knock
 * Out check, so an over-damaged Stage 2 stays until the next Checkup or damage.
 */
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
      program: searchThenShuffle({
        filter: { kind: "basicPokemon", noRuleBox: true },
        dest: "bench",
        max: 1,
      }),
    },
  },
};

/** Mesagoza — "Once during each player's turn, that player may flip a coin. If
    heads, that player searches their deck for a Pokémon, reveals it, and puts it
    into their hand. Then, that player shuffles their deck." (Stadium activated
    ability) — the Poké Ball program exactly: the search AND the shuffle are BOTH
    gated on heads, so shuffleDeck sits INSIDE the coin gate's `ops`. */
const MESAGOZA: CardProgram = {
  stadium: {
    ability: {
      label: "Mesagoza",
      program: [
        {
          op: "coinFlipGate",
          ops: searchThenShuffle({
            filter: { kind: "anyPokemon" },
            dest: "hand",
            max: 1,
            reveal: true,
          }),
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
      program: searchThenShuffle({
        filter: { kind: "toolCard" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    },
  },
};

/** Vitality Band — "The attacks of the Pokémon this card is attached to do 10
    more damage to your opponent's Active Pokémon (before applying Weakness
    and Resistance)." (Tool) */
const VITALITY_BAND: CardProgram = { passive: { damageBonusBeforeWR: 10 } };

/**
 * Defiance Band: +30 damage to the opponent's Active before W/R while you have more Prize cards
 * remaining.
 */
const DEFIANCE_BAND: CardProgram = {
  passive: { damageBonusBeforeWRIf: { amount: 30, cond: { kind: "morePrizesThanOpponent" } } },
};

/**
 * Choice Belt: +30 damage before W/R when the defender is a Pokémon V. VMAX and VSTAR defenders are
 * not included.
 */
const CHOICE_BELT: CardProgram = {
  passive: { damageBonusBeforeWRIfTarget: { amount: 30, targetSuffix: "V" } },
};

/** Bravery Charm — "The Basic Pokémon this card is attached to gets +50 HP."
    (Tool) */
const BRAVERY_CHARM: CardProgram = { passive: { basicHpBonus: 50 } };

/** Hero's Cape: +100 HP regardless of stage. */
const HEROS_CAPE: CardProgram = { passive: { hpBonus: { amount: 100 } } };

/**
 * Cynthia's Power Weight: +70 HP to a Cynthia's Pokémon, read off the holder's top card so it
 * tracks evolution.
 */
const CYNTHIAS_POWER_WEIGHT: CardProgram = {
  passive: { hpBonus: { amount: 70, beneficiary: { kind: "ownerPokemon", owner: "Cynthia" } } },
};

/**
 * Okidogi "Adrena-Power": with any {D} Energy attached, +100 HP and +100 damage before W/R. The
 * damage condition checks the attacking seat's Active, which is correct only because the holder is
 * the attacker.
 */
const OKIDOGI_ADRENA_POWER: CardProgram = {
  passive: {
    hpBonus: { amount: 100, requiresEnergyType: "Darkness" },
    damageBonusBeforeWRIf: {
      amount: 100,
      cond: { kind: "yourActiveHasEnergyAttached", energy: "Darkness" },
    },
  },
};

/** Conkeldurr "Craftsmanship": +40 HP for each {F} Energy attached. */
const CONKELDURR_CRAFTSMANSHIP: CardProgram = {
  passive: {
    hpBonusPer: { amount: 40, scale: { kind: "attachedEnergy", energyType: "Fighting" } },
  },
};

/** Brambleghast "Resilient Soul": +50 HP for each Prize card the holder's opponent has taken. */
const BRAMBLEGHAST_RESILIENT_SOUL: CardProgram = {
  passive: { hpBonusPer: { amount: 50, scale: { kind: "opponentPrizesTaken" } } },
};

/**
 * Rocky Helmet: while Active and damaged by an opposing attack (even if Knocked Out), put 2 damage
 * counters on the attacker.
 */
const ROCKY_HELMET: CardProgram = { passive: { damageAttacker: { amount: 20 } } };

/**
 * Vengeful Punch: when Knocked Out by an opposing attack, put 4 damage counters on the attacker.
 */
const VENGEFUL_PUNCH: CardProgram = { passive: { damageAttackerOnKo: { amount: 40 } } };

/**
 * Exp. Share: when your Active is Knocked Out by an opposing attack, you may move a Basic Energy
 * from it to this Tool's holder. An empty pick declines.
 */
const EXP_SHARE: CardProgram = {
  triggered: [
    {
      name: "Exp. Share",
      trigger: "onAllyActiveKnockOut",
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

// ── Special Energy (§6.1). ──

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

/**
 * Therapeutic Energy: provides {C}; its holder recovers from and can't be affected by Asleep,
 * Confused or Paralyzed. Recovery and immunity are listed separately because other cards print only
 * the immunity.
 */
const THERAPEUTIC_ENERGY: CardProgram = {
  energy: {
    provides: ["Colorless"],
    passive: {
      statusRecovery: ["asleep", "confused", "paralyzed"],
      statusImmunities: ["asleep", "confused", "paralyzed"],
    },
  },
};

// ── Triggered Abilities (§9) — fire on a game event. ──

/** Flamigo — "Insta-Flock": "When you play this Pokémon from your hand onto
    your Bench during your turn, you may search your deck for up to 3 Flamigo,
    reveal them, and put them into your hand. Then, shuffle your deck." */
const FLAMIGO: CardProgram = {
  triggered: [
    {
      name: "Insta-Flock",
      trigger: "onPlayToBench",
      program: searchThenShuffle({
        filter: { kind: "byName", name: "Flamigo" },
        dest: "hand",
        max: 3,
        reveal: true,
      }),
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

/**
 * Trevenant "Forest Miasma": during Checkup, if Active, put 1 damage counter on the opponent's
 * Active. The Checkup's KO sweep handles any Knock Out.
 */
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

/**
 * Froslass "Freezing Shroud": during Checkup, put 1 damage counter on each Pokémon with an Ability
 * on both sides, except any Froslass. Fires from anywhere in play.
 */
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
          // `side: "both"` is the printed "(both yours and your opponent's)"; `source: "ability"`
          // is the provenance on the `COUNTERS_PLACED` row.
          side: "both",
          source: "ability",
          exceptNamed: "Froslass",
        },
      ],
    },
  ],
};

/**
 * Armarouge "Scorching Armor": while Active and damaged by an opposing attack (even if Knocked
 * Out), the attacker is Burned. `target: "attacker"` because the attacker may have switched out and
 * been replaced in the Active Spot.
 */
const SCORCHING_ARMOR: CardProgram = {
  triggered: [
    {
      name: "Scorching Armor",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: [{ op: "applyStatus", target: "attacker", status: "burned" }],
    },
  ],
};

/**
 * Klawf ex "Counterattacking Pincer": while Active and damaged by an opposing attack (even if
 * Knocked Out), discard an Energy from the attacker; the defender chooses. `from: "attacker"`
 * targets the attacking Pokémon wherever it now sits.
 */
const COUNTERATTACKING_PINCER: CardProgram = {
  triggered: [
    {
      name: "Counterattacking Pincer",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: [{ op: "discardEnergy", from: "attacker", filter: { kind: "anyEnergy" } }],
    },
  ],
};

// ── The mid-turn-damage snipe (§9). ──

/**
 * Hawlucha — "Flying Entry". The trigger auto-fires, so the printed "you may" survives as the op's
 * own `optional`: take 2 or none.
 */
const HAWLUCHA: CardProgram = {
  triggered: [
    {
      name: "Flying Entry",
      trigger: "onPlayToBench",
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

/**
 * Meowscarada ex — "Bouquet Magic". The discard cost is the first op; Basic {G} Energy cards are
 * interchangeable, so paying it asks nothing.
 */
const MEOWSCARADA: CardProgram = {
  abilities: [
    activated({
      name: "Bouquet Magic",
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "basicEnergy", energyType: "Grass" },
        },
        { op: "damageChosen", target: "opponentBench", amount: 30, count: 1, source: "ability" },
      ],
    }),
  ],
};

/**
 * Radiant Blastoise — "Pump Shot". "a Water Energy card" is approximated as Basic {W}: a Special
 * Energy providing {W} in hand cannot be matched because provision is only read while attached.
 * This fails safe (the Ability is refused).
 */
const RADIANT_BLASTOISE: CardProgram = {
  abilities: [
    activated({
      name: "Pump Shot",
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "basicEnergy", energyType: "Water" },
        },
        { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "ability" },
      ],
    }),
  ],
};

/**
 * Revavroom — "Rumbling Engine". The cost runs first, so the draw counts the hand after payment.
 * `anyEnergy` because the print says "an Energy card", not Basic.
 */
const REVAVROOM: CardProgram = {
  abilities: [
    activated({
      name: "Rumbling Engine",
      program: [
        { op: "payFromHand", count: 1, to: "discard", filter: { kind: "anyEnergy" } },
        { op: "drawUntilHandSize", size: 6 },
      ],
    }),
  ],
};

/** Tinkaton (sv02-105) — "Gather Materials": "You must discard a card from your
    hand in order to use this Ability. Once during your turn, you may draw 3
    cards." The cost's GENERAL form — no filter at all, so every card in hand is a
    candidate and a mixed hand always asks. This is the one the pre-op
    `AbilityCost` field could not express. */
const TINKATON: CardProgram = {
  abilities: [
    activated({
      name: "Gather Materials",
      program: [
        { op: "payFromHand", count: 1, to: "discard" },
        { op: "drawCards", count: 3 },
      ],
    }),
  ],
};

/**
 * Fezandipiti ex — "Flip the Script". `sharedByName` enforces "You can't use more than 1 Flip the
 * Script Ability each turn" across copies.
 */
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

/**
 * Pecharunt ex — "Subjugating Chains". Inside the gate, `applyStatus` "self" resolves to the newly
 * promoted Active, which is the printed "new Active Pokémon". Usable from the Bench; the activation
 * is refused when no non-Pecharunt {D} body is benched.
 */
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
          ops: [{ op: "applyStatus", target: "self", status: "poisoned" }],
        },
      ],
    },
  ],
};

/**
 * Fan Rotom — "Fan Call". `playableIf: yourFirstTurn` limits it to the first turn and
 * `sharedByName` limits it to one use across copies; both are needed.
 */
const FAN_CALL: CardProgram = {
  abilities: [
    {
      name: "Fan Call",
      oncePerTurn: "sharedByName",
      activeOnly: false,
      playableIf: { kind: "yourFirstTurn" },
      program: searchThenShuffle({
        filter: { kind: "typedPokemon", pokemonType: "Colorless", maxHp: 100 },
        dest: "hand",
        max: 3,
        reveal: true,
      }),
    },
  ],
};

/**
 * Ultra Ball. The "2 other cards" cost cannot include Ultra Ball itself: it is already in the
 * discard when the program runs, and the play gate excludes its uid.
 */
const ULTRA_BALL: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 2, to: "discard" },
    ...searchThenShuffle({ filter: { kind: "anyPokemon" }, dest: "hand", max: 1, reveal: true }),
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
    ...searchThenShuffle({ filter: { kind: "basicEnergy" }, dest: "hand", max: 2, reveal: true }),
  ],
};

/**
 * Larry's Skill. `also` caps each printed noun at one. `discardHand` must run before the search so
 * the found cards are not discarded.
 */
const LARRYS_SKILL: CardProgram = {
  trainer: [
    { op: "discardHand" },
    ...searchThenShuffle({
      filter: { kind: "anyPokemon" },
      dest: "hand",
      max: 1,
      reveal: true,
      also: [
        { filter: { kind: "supporter" }, max: 1 },
        { filter: { kind: "basicEnergy" }, max: 1 },
      ],
    }),
  ],
};

/** Arven's rotated printings remain usable in existing decks. One search with
    separate caps lets the player take an Item, a Tool, either one, or neither. */
const ARVEN: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "item" },
    dest: "hand",
    max: 1,
    reveal: true,
    also: [{ filter: { kind: "toolCard" }, max: 1 }],
  }),
};

/**
 * Secret Box. Ultra Ball's cost at 3 plus a four-group `also` search; the played card can never pay
 * for itself.
 */
const SECRET_BOX: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 3, to: "discard" },
    ...searchThenShuffle({
      filter: { kind: "item" },
      dest: "hand",
      max: 1,
      reveal: true,
      also: [
        { filter: { kind: "toolCard" }, max: 1 },
        { filter: { kind: "supporter" }, max: 1 },
        { filter: { kind: "stadium" }, max: 1 },
      ],
    }),
  ],
};

// Deck-search Trainers built from existing ops; each ends with the printed "Then, shuffle your
// deck."

/**
 * Hilda. One cap per noun; declinable (`min: 0`). "an Energy card" is `anyEnergy`, Special
 * included.
 */
const HILDA: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "evolutionPokemon" },
    dest: "hand",
    max: 1,
    reveal: true,
    also: [{ filter: { kind: "anyEnergy" }, max: 1 }],
  }),
};

/** Colress's Tenacity. Hilda's shape with a Stadium as the first noun. */
const COLRESSS_TENACITY: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "stadium" },
    dest: "hand",
    max: 1,
    reveal: true,
    also: [{ filter: { kind: "anyEnergy" }, max: 1 }],
  }),
};

/** Cyrano. `suffixPokemon` "ex" matches only Pokémon ex, not Pokémon V. */
const CYRANO: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "suffixPokemon", suffix: "ex" },
    dest: "hand",
    max: 3,
    reveal: true,
  }),
};

/** Hyper Aroma. Stage 1 Pokémon only. */
const HYPER_AROMA: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "stagePokemon", stage: "Stage1" },
    dest: "hand",
    max: 3,
    reveal: true,
  }),
};

/**
 * Team Rocket's Transceiver. Matches Supporters whose name contains "Team Rocket" (case-sensitive),
 * not Team Rocket's Items.
 */
const TEAM_ROCKETS_TRANSCEIVER: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "supporterNameContaining", fragment: "Team Rocket" },
    dest: "hand",
    max: 1,
    reveal: true,
  }),
};

/**
 * Energy Search Pro. `prompt.max` is the deck's Basic Energy count, not its type count, so the
 * dialog ceiling can exceed any legal answer; the validator refuses a repeated type.
 */
const ENERGY_SEARCH_PRO: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "basicEnergy" },
    dest: "hand",
    max: "any",
    reveal: true,
    distinctEnergyTypes: true,
  }),
};

/**
 * Precious Trolley. `max: "any"` is clamped to bench space. On a full Bench it still plays, takes
 * nothing, and shuffles.
 */
const PRECIOUS_TROLLEY: CardProgram = {
  trainer: searchThenShuffle({ filter: { kind: "basicPokemon" }, dest: "bench", max: "any" }),
};

/**
 * Boxed Order. `trainerEndsTurn` is carried across the park and the turn ends on an answer, a
 * decline, or no park at all.
 */
const BOXED_ORDER: CardProgram = {
  trainer: searchThenShuffle({ filter: { kind: "item" }, dest: "hand", max: 2, reveal: true }),
  trainerEndsTurn: true,
};

/**
 * Cassiopeia. "The last card in your hand" is checked while the card is still in hand, so the hand
 * must be exactly 1. No reveal is printed.
 */
const CASSIOPEIA: CardProgram = {
  trainerPlayableIf: { kind: "yourHandExactly", count: 1 },
  trainer: searchThenShuffle({ filter: { kind: "anyCard" }, dest: "hand", max: 2 }),
};

/** Cook. Heals the controller's Active; playable even when the Active is undamaged. */
const COOK: CardProgram = {
  trainer: [{ op: "heal", target: "self", amount: 70 }],
};

/**
 * Poké Vital A. Any own Pokémon may be chosen, damaged or not. The second sentence is enforced by
 * the card's `discardPileLocked`.
 */
const POKE_VITAL_A: CardProgram = {
  trainer: [{ op: "healChosen", amount: 150 }],
  discardPileLocked: true,
};

/**
 * Iris's Fighting Spirit. The cost is the first op, so the draw counts the hand after payment; a
 * hand holding only Iris is refused.
 */
const IRISS_FIGHTING_SPIRIT: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 1, to: "discard" },
    { op: "drawUntilHandSize", size: 6 },
  ],
};

/**
 * Eri. Reveals the opponent's hand, then the player may discard up to 2 Items. Refused on an empty
 * opponent hand; with no Items it still plays and whiffs.
 */
const ERI: CardProgram = {
  trainer: [
    {
      op: "bottomFromOpponentHand",
      filter: { kind: "item" },
      dest: "discard",
      upTo: 2,
    },
  ],
};

/**
 * Meddling Memo. "If they do" needs no `onlyIfAnyMoved`: an empty hand moves nothing and draws 0.
 */
const MEDDLING_MEMO: CardProgram = {
  trainer: [
    {
      op: "handRefresh",
      who: "opponent",
      toBottom: true,
      draw: { kind: "handPlus", delta: 0 },
    },
  ],
};

/**
 * Ethan's Adventure. "up to 3 in any combination of" is one flat cap over an `anyOf` union, not
 * `also`. `ownerPokemon` admits any stage; the Energy side is Basic {R} only.
 */
const ETHANS_ADVENTURE: CardProgram = {
  trainer: searchThenShuffle({
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
  }),
};

/**
 * Heatmor — "Licking Catch" (attack index 0). Flat `max: 3` over `anyOf` of {R} Pokémon (any stage)
 * and Basic {R} Energy. Index 1 has no effect text.
 */
const LICKING_CATCH: CardProgram = {
  attack: {
    0: searchThenShuffle({
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
    }),
  },
};

/**
 * Maushold — "Familial March" (attack index 0). Flat `max: 2` over exact `byName` Maushold and
 * Maushold ex, onto the Bench; no reveal is printed.
 */
const FAMILIAL_MARCH: CardProgram = {
  attack: {
    0: searchThenShuffle({
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "byName", name: "Maushold" },
          { kind: "byName", name: "Maushold ex" },
        ],
      },
      dest: "bench",
      max: 2,
    }),
  },
};

/**
 * Dendra. The payment must precede the draw so "until you have 5" counts the hand after it. The
 * draw sits in a `recordGate` for "If you do" (§9.2).
 */
const DENDRA: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 1, to: "deckBottom", recordAs: "paid" },
    {
      op: "recordGate",
      slot: "paid",
      ops: [{ op: "drawUntilHandSize", size: 5 }],
    },
  ],
};

/**
 * Skwovet — "Nest Stash". `toBottom` keeps the deck order and `onlyIfAnyMoved` makes an empty hand
 * draw nothing. Usable from the Bench.
 */
const SKWOVET: CardProgram = {
  abilities: [
    activated({
      name: "Nest Stash",
      program: [
        {
          op: "handRefresh",
          who: "you",
          draw: { kind: "fixed", count: 1 },
          toBottom: true,
          onlyIfAnyMoved: true,
        },
      ],
    }),
  ],
};

// ── On-KO triggered Abilities (§9) — fire when Knocked Out. ──

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

/**
 * Munkidori ex — "Oh No You Don't". Prizes are planned in `collectKnockOuts`, which also runs
 * outside attacks, so the attack cause is passed as `attackerSeat`.
 */
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

// ── Rare Candy (§7.1) — the Basic→Stage 2 evolve-skip Item. ──

/** Rare Candy — "Choose 1 of your Basic Pokémon in play. If you have a Stage 2
    card in your hand that evolves from that Pokémon, put that card onto the
    Basic Pokémon to evolve it, skipping the Stage 1. You can't use this card
    during your first turn or on a Basic Pokémon that was put into play this
    turn." (Item) — a marker, not a program (see CardProgram.rareCandy). */
const RARE_CANDY: CardProgram = { rareCandy: true };

// ── Cards whose printed text maps EXACTLY onto the existing op vocabulary, with no op of
//    their own. ──

/** Poké Ball — "Flip a coin. If heads, search your deck for a Pokémon, reveal it,
    and put it into your hand. Then, shuffle your deck." (Item) — the search AND
    the shuffle are BOTH gated on heads (tails does nothing), so shuffleDeck sits
    INSIDE the gate's `then`, not after it. */
const POKE_BALL: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      ops: searchThenShuffle({
        filter: { kind: "anyPokemon" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    },
  ],
};

/** Pokémon Catcher — "Flip a coin. If heads, switch in 1 of your opponent's
    Benched Pokémon to the Active Spot." (Item — a coin-gated gust). */
const POKEMON_CATCHER: CardProgram = {
  trainer: [{ op: "coinFlipGate", ops: [{ op: "gust" }] }],
};

/** Nemona — "Draw 3 cards." (Supporter) */
const NEMONA: CardProgram = { trainer: [{ op: "drawCards", count: 3 }] };

/**
 * "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)." Printed
 * under several Ability names (Bronze Body, Bouffer, Thicket Body, Soft Wool, ...).
 */
const REDUCE_30_AFTER_WR: CardProgram = { passive: { damageReductionAfterWR: 30 } };

/**
 * "This Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance)." Printed
 * under several Ability names (Exoskeleton, Bouffer, Solid Shell, Fur Coat, ...).
 */
const REDUCE_20_AFTER_WR: CardProgram = { passive: { damageReductionAfterWR: 20 } };

/** Rock Chestplate. The {F} gate is resolved in `passivesOf` against the holder's types. */
const ROCK_CHESTPLATE: CardProgram = {
  passive: { damageReductionAfterWRIfType: { amount: 30, type: "Fighting" } },
};

/**
 * Hariyama — "Arm Thrust Practice". Seat-wide and self-inclusive; with no riders it applies from
 * any spot and sums with a second copy.
 */
const HARIYAMA: CardProgram = { passive: { seatDamageReductionAfterWR: { amount: 10 } } };

/**
 * Steven's Carbink — "Stone Palace". Applies only while the source is on the Bench, and is
 * self-inclusive.
 */
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

/**
 * Bouffalant — "Curly Wall". Needs another Bouffalant in play; doesn't stack, so two copies give
 * 60, not 120.
 */
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

/** Serperior ex (`sv10.5b-003`/`-156`/`-164`) — "Regal Cheer": "Attacks used by
    your Pokémon do 20 more damage to your opponent's Active Pokémon (before
    applying Weakness and Resistance)." **3 legal printings**, the BARE member: no
    beneficiary narrowing, no non-stacking clause, nothing but the aura. */
const REGAL_CHEER: CardProgram = { passive: { seatDamageBonusBeforeWR: { amount: 20 } } };

/**
 * Cynthia's Roserade — "Cheer On to Glory". The `ownerPokemon` filter is matched against the
 * attacker only, never the source.
 */
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

/**
 * Togekiss — "Wonder Kiss". Bench KOs (from Checkup or mid-turn sweeps) do not count. Doesn't
 * stack: two Togekiss make one flip, not two.
 */
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

/**
 * Ludicolo — "Vibrant Dance". Includes the source; doesn't stack. As an Ability it can be switched
 * off, which can Knock Out damaged teammates.
 */
const VIBRANT_DANCE: CardProgram = {
  passive: { seatHpBonus: { ability: "Vibrant Dance", amount: 40, noStack: true } },
};

/**
 * Hydreigon ex — "Greedy Eater". Needs the attacking body's uid, so KOs at Checkup or mid-turn
 * never qualify. The `koTarget` filter applies to the Knocked Out body, not the holder.
 */
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

/**
 * Lilligant — "Sunny Day". The printed "and" is a union (`anyOf`), and the filter is matched
 * against the attacker, not the source.
 */
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

/** Victini — "Victory Cheer". Victini is a Basic, so it never boosts itself. */
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

/**
 * Genesect ex — "Metallic Signal". `min: 0` makes "up to" optional; the shuffle runs on a whiff or
 * decline.
 */
const METALLIC_SIGNAL: CardProgram = {
  abilities: [
    activated({
      name: "Metallic Signal",
      program: searchThenShuffle({
        filter: { kind: "typedPokemon", pokemonType: "Metal", stage: "evolution" },
        dest: "hand",
        max: 2,
        reveal: true,
      }),
    }),
  ],
};

// ── attachEnergyFrom (§6 energy acceleration) — the clean single-attach-from-hand core;
//    the discard/deck/multi/rider variants layer further ops on top. ──

/** Quaquaval — "Energy Carnival": "Once during your turn, you may attach a Basic
    Energy card from your hand to 1 of your Pokémon." (activated, once/turn) */
const QUAQUAVAL: CardProgram = {
  abilities: [
    activated({
      name: "Energy Carnival",
      program: [{ op: "attachEnergyFrom", source: "hand" }],
    }),
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

/** Koraidon ex — "Dino Cry". Two attach ops, each `declinable`, so "up to 2" allows 0, 1 or 2. */
const KORAIDON_EX: CardProgram = {
  abilities: [
    activated({
      name: "Dino Cry",
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
    }),
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

/**
 * Blissey — "Busybody Nurse". Usable from the Bench because it heals your Active, not this Pokémon.
 * Deliberately not refused when the Active has no Special Condition.
 */
const BLISSEY: CardProgram = {
  abilities: [
    activated({
      name: "Busybody Nurse",
      program: [{ op: "clearStatus" }],
    }),
  ],
};

// ── discardPileRetrieval (§7.1 recovery Items) — the discard-pile mirror of searchDeck. ──

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

// ── §9.2 op→op data flow — the clause that refers back to what an earlier clause of the
//    SAME card actually did. Three printed wordings, one running record: Miriam's "in this
//    way", Superior Energy Retrieval's "with the effect of this card", Dendra's "if you do"
//    (above). ──

/**
 * Miriam. The shuffle must run before the draw, so the gate reads a named record two ops upstream.
 * Declining the retrieval records nothing and skips the draw.
 */
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
      ops: [{ op: "drawCards", count: 3 }],
    },
  ],
};

/** Ortega. The gated draw is answered by the opponent, the phase's `answerer`. */
const ORTEGA: CardProgram = {
  trainer: [
    { op: "bottomFromOpponentHand", recordAs: "moved" },
    {
      op: "recordGate",
      slot: "moved",
      ops: [{ op: "opponentMayDraw", count: 1 }],
    },
  ],
};

/**
 * Superior Energy Retrieval. The paid cards are excluded from the retrieval by uid so the cost
 * cannot refund itself; Energy already in the discard stays takeable.
 */
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

// ── lookAtTopN (§15.E deck-top look) — the top-of-deck twin of searchDeck; candidates are
//    only the top-N matches, then shuffle. The clean "reveal → hand" cards; the from-the-top
//    ATTACH variants (Electric Generator, Hydreigon) use attachFromTop below. ──

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

// ── attachFromTop (§15.E + §6) — the from-the-top ATTACH variant of lookAtTopN: look at
//    the deck top and attach the Energy you find there onto your own Pokémon, "in any way you
//    like". Two consumers, an Item and an activated Ability, differing in every rider the op
//    has. ──

/**
 * Electric Generator. Uses the printed Basic {L} filter, not `providesEnergy`, because deck cards
 * are attached to nothing. `benchOnly` excludes the Active.
 */
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

/**
 * Hydreigon — "Tri Howl". `anyEnergy` admits Special Energy; `restTo: "discard"` discards the rest
 * even on a whiff or decline.
 */
const HYDREIGON: CardProgram = {
  abilities: [
    activated({
      name: "Tri Howl",
      program: [
        {
          op: "attachFromTop",
          n: 3,
          filter: { kind: "anyEnergy" },
          max: "any",
          restTo: "discard",
        },
      ],
    }),
  ],
};

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

/**
 * N's Plan. `anySource` is the printed plural: Energy may come from several benched Pokémon in one
 * answer.
 */
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

// ── The providesEnergy filter — "an Energy that PROVIDES {X}". Its second consumer (the
//    first is the typed self-discard family, which is DERIVED and so has no rows here): the
//    moveEnergy fixed-endpoint route. ──

/**
 * Armarouge — "Fire Off". No once-per-turn limit; usable from the Bench. "a {R} Energy" is
 * `providesEnergy`, so Luminous Energy qualifies.
 */
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

// ── handRefresh (the Iono/Judge hand-refresh Supporter family) — put your hand back into
//    your deck, then draw: the reshuffle-and-draw Supporters, and Iono (the bottom-of-deck
//    placement + the prize-count draw + the any-moved draw gate). ──

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

// ── Board conditions — one BoardCondition vocabulary
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

/**
 * Call Bell. The gate is `allOf[youGoSecond, yourFirstTurn]` — turn 2 for the seat that went
 * second; neither conjunct alone is enough. As an Item it needs no `trainerFirstTurnExempt`.
 */
const CALL_BELL: CardProgram = {
  trainerPlayableIf: {
    kind: "allOf",
    conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
  },
  trainer: searchThenShuffle({ filter: { kind: "supporter" }, dest: "hand", max: 1, reveal: true }),
};

/**
 * Chill Teaser Toy. Call Bell's gate; `discardEnergy` from the opponent's Pokémon with `to:
 * "hand"`.
 */
const CHILL_TEASER_TOY: CardProgram = {
  trainerPlayableIf: {
    kind: "allOf",
    conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
  },
  trainer: [
    { op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" }, to: "hand" },
  ],
};

// Per-attack-index timing gates. The effect body is derived separately; an index-blind read would
// gate the wrong attack.

/**
 * Terapagos ex — "Unified Beatdown" (index 0). `barredIf` over Call Bell's condition. Only the gate
 * is authored here; the body is derived.
 */
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

/** Illumise — "Slowing Perfume" (index 0). `onlyIf` over the same `allOf` condition. */
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

/**
 * Mandibuzz — "Look for Prey". `bottomFromOpponentHand` with `dest: "bench"`. Plain once per turn
 * (not shared by name); usable from anywhere.
 */
const LOOK_FOR_PREY: CardProgram = {
  abilities: [
    activated({
      name: "Look for Prey",
      program: [
        {
          op: "bottomFromOpponentHand",
          filter: { kind: "basicPokemon", maxHp: 70 },
          dest: "bench",
        },
      ],
    }),
  ],
};

/**
 * Scream Tail ex — "Scream" (index 0). Kept separate from Illumise's identical gate so either card
 * can diverge. The body is derived.
 */
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

/** Volbeat — "Quick Sign" (index 0). The licence is per index: index 1 stays banned on turn 1. */
const VOLBEAT_QUICK_SIGN: CardProgram = {
  attackGate: { 0: { kind: "firstTurnExempt" } },
};

/**
 * Exeggcute — "Precocious Evolution" (index 0). First-turn licence only; the evolve-from-deck body
 * is not built.
 */
const EXEGGCUTE_PRECOCIOUS_EVOLUTION: CardProgram = {
  attackGate: { 0: { kind: "firstTurnExempt" } },
};

/**
 * Miltank — "Moomoo Rolling" (index 1). Gated on Rollout, which is index 0 on the same card; there
 * is no further body.
 */
const MILTANK_MOOMOO_ROLLING: CardProgram = {
  attackGate: {
    1: {
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    },
  },
};

/**
 * Sylveon ex — "Angelite" (index 1). "this attack can't be used" is `barredIf`. Also derived from
 * text; the registry row must match it.
 */
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
      ops: [{ op: "drawCards", count: 2 }],
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
      ops: [{ op: "drawUntilHandSize", size: 7 }],
      otherwise: [{ op: "drawUntilHandSize", size: 5 }],
    },
  ],
};

// ── discardEnergy (the §15 energy-removal "hammer" family) — discard Energy off the
//    OPPONENT's Pokémon. Each of the three `from` arms has a real printed card. The
//    SELF-discard attacks ("Discard an Energy from this Pokémon") need NO registry row at
//    all — effects.ts derives them from the printed sentence. ──

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
      ops: [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" } }],
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
      program: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "specialEnergy" } }],
    },
  ],
};

/**
 * Charizard ex — "Infernal Reign". No `maxPerTarget`, so all three may go on one Pokémon. The
 * trigger auto-fires; the decline lives in the op's "up to".
 */
const CHARIZARD_EX: CardProgram = {
  triggered: [
    {
      name: "Infernal Reign",
      trigger: "onEvolve",
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

/**
 * Janine's Secret Art. `maxPerTarget: 1` is "attach it to that Pokémon". The poison gate checks
 * whether an attached Energy landed on the Active (§9.2).
 */
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
      ops: [{ op: "applyStatus", target: "self", status: "poisoned" }],
    },
  ],
};

/**
 * Pawmot — "Electrogenesis". `toSelf` attaches to the Pokémon using the Ability, including a
 * benched one.
 */
const PAWMOT: CardProgram = {
  abilities: [
    activated({
      name: "Electrogenesis",
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Lightning" },
          max: 1,
          toSelf: true,
        },
        { op: "shuffleDeck" },
      ],
    }),
  ],
};

/** Saguaro. "up to 2" parks at `min: 0, max: 2`; any own Pokémon may be chosen, damaged or not. */
const SAGUARO: CardProgram = {
  trainer: [{ op: "healChosen", amount: 50, upTo: 2 }],
};

// Abilities mapped exactly onto existing ops. A registry row is what the card does, so a close
// approximation is worse than none.

/**
 * Roselia / Roserade / Scolipede — "Poison Point". Separate from Scorching Armor because the text
 * differs.
 */
const POISON_POINT: CardProgram = {
  triggered: [
    {
      name: "Poison Point",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: [{ op: "applyStatus", target: "attacker", status: "poisoned" }],
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
    activated({
      name: "Trade",
      program: [
        { op: "payFromHand", count: 1, to: "discard" },
        { op: "drawCards", count: 2 },
      ],
    }),
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

/** Latias ex — "Skyliner". Self-inclusive: Latias ex is itself Basic. */
const SKYLINER: CardProgram = { passive: { noRetreatCostAura: { stage: "Basic" } } };

/**
 * Gothitelle — "Distorted Future". Only the opponent's hand is refreshed; no `toBottom` or
 * `onlyIfAnyMoved`, so an empty hand still reshuffles and draws 3.
 */
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

/**
 * Team Rocket's Crobat ex. "Biting Spree" targets any opposing Pokémon (no zone word); 2 refs or
 * none. "Assassin's Return" sends this Pokémon to hand and its attachments to the discard, behind
 * an `optional` for "You may". `fix-bitingspree` shares this object.
 */
const TEAM_ROCKETS_CROBAT_EX: CardProgram = {
  triggered: [
    {
      name: "Biting Spree",
      trigger: "onEvolve",
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
        ops: [{ op: "returnSelf", dest: "hand", attachmentsTo: "discard" }],
      },
    ],
  },
};

/** Team Rocket's Golbat — "Sneaky Bite". Kept separate from Crobat ex because the text differs. */
const SNEAKY_BITE: CardProgram = {
  triggered: [
    {
      name: "Sneaky Bite",
      trigger: "onEvolve",
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

/** Tatsugiri — "Attract Customers". */
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

/** Volcanion ex — "Scalding Steam". */
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

/** Shiinotic — "Calming Light". */
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

/**
 * Durant ex — "Sudden Shearing". The op never parks, so the trigger flag alone carries "you may".
 */
const SUDDEN_SHEARING: CardProgram = {
  triggered: [
    {
      name: "Sudden Shearing",
      trigger: "onPlayToBench",
      program: [{ op: "discardDeckTop", whose: "opponent", count: 1 }],
    },
  ],
};

/**
 * Hop's Dubwool — "Defiant Horn". The trigger auto-fires, so `gust.optional` carries the "you may",
 * even with one candidate.
 */
const DEFIANT_HORN: CardProgram = {
  triggered: [
    {
      name: "Defiant Horn",
      trigger: "onEvolve",
      program: [{ op: "gust", optional: true }],
    },
  ],
};

/**
 * Team Rocket's Ampharos — "Darkest Impulse". `opponentAction` keeps it from firing on its own
 * controller's evolve. "from their hand" needs no field: `placeEvolution` is reached only from
 * hand. Not optional.
 */
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

/** Gengar ex — "Gnawing Curse". No "doesn't stack", so two copies each place counters. */
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

/**
 * Magearna — "Auto Heal". `activeOnly` is the printed "As long as this Pokémon is in the Active
 * Spot".
 */
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

/**
 * Magcargo — "Lava Zone". `defender` resolves to the opponent's new Active, not the subject that
 * moved. Not optional.
 */
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

/**
 * Iron Leaves ex — "Rapid Vernier". The outer `optional` op carries the first "you may" because the
 * switch has a downside; the second needs none because `moveEnergy` accepts an empty answer.
 * `anySource` is the printed plural.
 */
const RAPID_VERNIER: CardProgram = {
  triggered: [
    {
      name: "Rapid Vernier",
      trigger: "onPlayToBench",
      program: [
        {
          op: "optional",
          note: "You may switch this Pokémon with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon.",
          ops: [
            { op: "switchActive", fromSource: true, recordAs: "moved" },
            {
              op: "recordGate",
              slot: "moved",
              ops: [
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

/**
 * Meowscarada — "Showtime". "if this Pokémon is on your Bench" is enforced by `programPlayable` (an
 * Active source has no bench ref), not by `benchOnly`.
 */
const SHOWTIME: CardProgram = {
  abilities: [
    activated({
      name: "Showtime",
      program: [{ op: "switchActive", fromSource: true }],
    }),
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

/** Blaziken ex — "Seething Spirit". */
const SEETHING_SPIRIT: CardProgram = {
  abilities: [
    activated({
      name: "Seething Spirit",
      program: [{ op: "attachEnergyFrom", source: "discard" }],
    }),
  ],
};

/**
 * Team Rocket's Spidops — "Charging Up". `toSelf` forces the target, unlike "1 of your Pokémon",
 * which parks.
 */
const CHARGING_UP: CardProgram = {
  abilities: [
    activated({
      name: "Charging Up",
      program: [{ op: "attachEnergyFrom", source: "discard", toSelf: true }],
    }),
  ],
};

/** Eelektrik — "Dynamotor". `benchOnly` stops the usually-Active holder from feeding itself. */
const DYNAMOTOR: CardProgram = {
  abilities: [
    activated({
      name: "Dynamotor",
      program: [
        { op: "attachEnergyFrom", source: "discard", energyType: "Lightning", benchOnly: true },
      ],
    }),
  ],
};

/**
 * Archaludon ex — "Assemble Alloy". "in any way you like" is two ops, not `count: 2`. `{M}` narrows
 * both the card (`energyType`) and the target (`targetType`). The Pokémon park is not declinable,
 * so "up to 2" resolves as exactly 2 when two are available.
 */
const ASSEMBLE_ALLOY: CardProgram = {
  triggered: [
    {
      name: "Assemble Alloy",
      trigger: "onEvolve",
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
    activated({
      name: "Confectionary Gift",
      program: [{ op: "healChosen", amount: 30 }],
    }),
  ],
};

/** Hoothoot — "Insomnia". */
const INSOMNIA: CardProgram = { passive: { statusImmunities: ["asleep"] } };

/**
 * Team Rocket's Porygon-Z — "Reconstitute". The cost is the first op; the use is refused when it
 * cannot be paid.
 */
const RECONSTITUTE: CardProgram = {
  abilities: [
    activated({
      name: "Reconstitute",
      program: [
        { op: "payFromHand", count: 2, to: "discard" },
        { op: "drawCards", count: 1 },
      ],
    }),
  ],
};

/**
 * Quaquaval — "Up-Tempo". The cost goes to the bottom of the deck, not the discard, and is paid
 * before the draw is measured.
 */
const UP_TEMPO: CardProgram = {
  abilities: [
    activated({
      name: "Up-Tempo",
      program: [
        { op: "payFromHand", count: 1, to: "deckBottom" },
        { op: "drawUntilHandSize", size: 5 },
      ],
    }),
  ],
};

/** Enhanced Hammer. Refused when the opponent has no Special Energy attached. */
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

/** Clemont's Quick Wit. Heals only your own {L} Pokémon. */
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

/** Lana's Aid. `anyOf` of `anyPokemon` with `noRuleBox` (any stage) and Basic Energy. */
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

/**
 * Arven's Greedent — "Greedy Order". `cardNoun: true` makes the caption read "Arven's Sandwich
 * cards".
 */
const GREEDY_ORDER: CardProgram = {
  triggered: [
    {
      name: "Greedy Order",
      trigger: "onEvolve",
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

/**
 * Lillie's Ribombee — Inviting Wink: "When you play this Pokémon from your hand to evolve 1 of your
 * Pokémon during your turn, you may have your opponent reveal their hand and you put any number of
 * Basic Pokémon you find there onto their Bench."
 */
const INVITING_WINK: CardProgram = {
  triggered: [
    {
      name: "Inviting Wink",
      trigger: "onEvolve",
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

/**
 * Infernape — Pyro Dance: "Once during your turn, you may attach a Basic {R} Energy card, a Basic
 * {F} Energy card, or 1 of each from your hand to your Pokémon in any way you like."
 */
const PYRO_DANCE: CardProgram = {
  abilities: [
    activated({
      name: "Pyro Dance",
      // `atLeastOne` over one `recordAs` slot: {R}, {F} or 1 of each are all reachable, and the
      // empty answer is not.
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Fire",
          recordAs: "moved",
          atLeastOne: true,
        },
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Fighting",
          recordAs: "moved",
          atLeastOne: true,
        },
      ],
    }),
  ],
};

/**
 * Metang — Metal Maker: look at the top 4 cards, attach any number of Basic {M} Energy found there
 * to your Pokémon, then shuffle the rest and put them on the bottom of the deck.
 */
const METAL_MAKER: CardProgram = {
  abilities: [
    activated({
      name: "Metal Maker",
      program: [
        {
          op: "attachFromTop",
          n: 4,
          filter: { kind: "basicEnergy", energyType: "Metal" },
          max: "any",
          restTo: "shuffledBottom",
        },
      ],
    }),
  ],
};

/**
 * Morpeko — Snack Seek: "Once during your turn, you may look at the top card of your deck. You may
 * discard that card."
 */
const SNACK_SEEK: CardProgram = {
  abilities: [
    activated({
      name: "Snack Seek",
      program: [{ op: "lookAtTopN", n: 1, filter: { kind: "anyCard" }, max: 1, dest: "discard" }],
    }),
  ],
};

/**
 * Lycanroc — Spike-Clad: "When you play this Pokémon from your hand to evolve 1 of your Pokémon
 * during your turn, you may attach up to 2 Spiky Energy cards from your discard pile to this
 * Pokémon."
 */
const SPIKE_CLAD: CardProgram = {
  triggered: [
    {
      name: "Spike-Clad",
      trigger: "onEvolve",
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

/**
 * Buddy-Buddy Poffin: "Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them
 * onto your Bench. Then, shuffle your deck."
 */
const BUDDY_BUDDY_POFFIN: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "basicPokemon", maxHp: 70 },
    dest: "bench",
    max: 2,
  }),
};

/**
 * Alomomola — Gentle Fin: "Once during your turn, if this Pokémon is in the Active Spot, you may
 * put a Basic Pokémon with 70 HP or less from your discard pile onto your Bench."
 */
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

/** Sacred Ash: "Shuffle up to 5 Pokémon from your discard pile into your deck." */
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
  trainer: searchThenShuffle({
    filter: { kind: "anyPokemon" },
    dest: "hand",
    max: 1,
    reveal: true,
  }),
};

/** Treasure Tracker sv08.5-131 — "Search your deck for up to 5 Pokémon Tool
    cards, reveal them, and put them into your hand. Then, shuffle your deck."
    (Item) — Town Store's `toolCard` filter searched to HAND at `max: 5`.
    1 legal printing. */
const TREASURE_TRACKER: CardProgram = {
  trainer: searchThenShuffle({ filter: { kind: "toolCard" }, dest: "hand", max: 5, reveal: true }),
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

/**
 * Kofu: "Put 2 cards from your hand on the bottom of your deck in any order. If you put 2 cards on
 * the bottom of your deck in this way, draw 4 cards." Unplayable without 2 cards in hand.
 */
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
      ops: [
        { op: "reorderTop", n: 2, from: "bottom" },
        { op: "drawCards", count: 4 },
      ],
    },
  ],
};

/**
 * Maximum Belt: attacks do 50 more damage to the opponent's Active Pokémon ex, before Weakness and
 * Resistance.
 */
const MAXIMUM_BELT: CardProgram = {
  passive: { damageBonusBeforeWRIfTarget: { amount: 50, targetSuffix: "ex" } },
};

/**
 * Binding Mochi: attacks by the Poisoned holder do 40 more damage to the opponent's Active Pokémon,
 * before Weakness and Resistance.
 */
const BINDING_MOCHI: CardProgram = {
  passive: { damageBonusBeforeWRIf: { amount: 40, cond: { kind: "yourActivePoisoned" } } },
};

/**
 * Levincia: "Once during each player's turn, that player may put up to 2 Basic {L} Energy cards
 * from their discard pile into their hand."
 */
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

/**
 * Spiky Energy: provides {C}; when the Active holder is damaged by an opponent's attack (even if
 * Knocked Out), put 2 damage counters on the Attacking Pokémon.
 */
const SPIKY_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], passive: { damageAttacker: { amount: 20 } } },
};

/**
 * Mist Energy: provides {C}; prevents all effects of the opponent's attacks done to the holder.
 * Damage is not an effect.
 */
const MIST_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], passive: { preventAttackEffects: true } },
};

/**
 * Boomerang Energy: provides {C}; if discarded by an effect of the holder's attack, it is
 * reattached to that Pokémon after attacking.
 */
const BOOMERANG_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], returnAfterAttackDiscard: true },
};

/**
 * Area Zero Underdepths: a player with any Tera Pokémon in play can have up to 8 Benched Pokémon.
 */
const AREA_ZERO_UNDERDEPTHS: CardProgram = { stadium: { benchLimitWithTera: BENCH_CEILING } };

/**
 * Tyme: the opponent guesses the HP of a Pokémon from your hand; right, they draw 4, wrong, you
 * draw 4.
 */
const TYME: CardProgram = { trainer: [{ op: "opponentGuessesHp", draw: 4 }] };

/** Scovillain ex — Double Type: "As long as this Pokémon is in play, it is {G} and {R} type." */
const DOUBLE_TYPE: CardProgram = { passive: { typesInPlay: ["Grass", "Fire"] } };

/**
 * Iron Treads — Dual Core: {F} and {M} type while it has a Future Booster Energy Capsule attached.
 * Its own Weakness and Resistance stay as printed.
 */
const DUAL_CORE: CardProgram = {
  passive: {
    typesInPlay: ["Fighting", "Metal"],
    typesInPlayWhileToolNamed: "Future Booster Energy Capsule",
  },
};

/**
 * Team Rocket's Energy: attachable only to Team Rocket's Pokémon (discarded otherwise); provides 2
 * in any combination of {P} and {D}.
 */
const TEAM_ROCKETS_ENERGY: CardProgram = {
  energy: {
    provides: [
      constrainedEnergyUnit(["Psychic", "Darkness"]),
      constrainedEnergyUnit(["Psychic", "Darkness"]),
    ],
    attachOnlyToOwner: "Team Rocket",
  },
};

/**
 * Relicanth — Memory Dive: each of your evolved Pokémon can use any attack from its previous
 * Evolutions.
 */
const MEMORY_DIVE: CardProgram = { passive: { memoryDive: true } };

/** Mew ex — Memory Helix: can use the attacks of any of your Benched Pokémon. */
const MEMORY_HELIX: CardProgram = { passive: { memoryHelix: true } };

/**
 * Lt. Surge's Bargain: the opponent is asked whether each player takes a Prize card; if yes each
 * player takes one, if no you draw 4 cards.
 */
const LT_SURGES_BARGAIN: CardProgram = {
  trainer: [
    {
      op: "optional",
      note: "Your opponent played Lt. Surge's Bargain: may each player take a Prize card? If you say no, they draw 4 cards.",
      askOpponent: true,
      ops: [{ op: "eachPlayerTakesPrize" }],
      otherwise: [{ op: "drawCards", count: 4 }],
      labels: { yes: "Yes: each player takes a Prize card", no: "No: they draw 4 cards" },
    },
  ],
};

/**
 * Spiritomb — Spiteful Swirl: 1 damage counter on the Attacking Pokémon when your Active {D}
 * Pokémon is damaged by an attack.
 */
const SPITEFUL_SWIRL: CardProgram = {
  passive: { damageAttackerWatched: { amount: 10, activeType: "Darkness" } },
};

/**
 * Wishiwashi — Counterattack Grouping: 3 damage counters on the Attacking Pokémon when your Active
 * Wishiwashi or Wishiwashi ex is damaged by an attack.
 */
const COUNTERATTACK_GROUPING: CardProgram = {
  passive: { damageAttackerWatched: { amount: 30, activeNames: ["Wishiwashi", "Wishiwashi ex"] } },
};

/**
 * Risky Ruins: 2 damage counters on each Basic non-{D} Pokémon a player puts onto their own Bench
 * during their turn.
 */
const RISKY_RUINS: CardProgram = {
  stadium: { benchArrivalCounters: { amount: 20, excludesType: "Darkness" } },
};

/** Dizzying Valley: Confused Pokémon stay Confused through evolution or devolution. */
const DIZZYING_VALLEY: CardProgram = { stadium: { confusionSurvivesStageChange: true } };

/**
 * Ange Floette: can be played only over a Prism Tower, even on the turn that Prism Tower was
 * played; each Mega Floette ex in play gets +150 HP.
 */
const ANGE_FLOETTE: CardProgram = {
  stadium: {
    playOnlyOverStadium: "Prism Tower",
    hpDelta: { amount: 150, stage: "basic", name: "Mega Floette ex" },
  },
};

/**
 * Rotom ex — Multi Adapter: each of the owner's Pokémon with "Rotom" in its name may carry 2 Tools;
 * when the Ability goes away the owner discards down to 1 on each.
 */
const MULTI_ADAPTER: CardProgram = {
  passive: { toolCapForName: { nameContains: "Rotom", cap: 2 } },
};

/** Cinderace — Explosiveness: may be put face down into the Active Spot at setup. */
const EXPLOSIVENESS: CardProgram = { setupActiveFromHand: "Explosiveness" };

/** Patrat — Watchful Eye: no damage counter on any Pokémon can be moved. */
const WATCHFUL_EYE: CardProgram = { passive: { countersCantMove: true } };

/**
 * Illumise — Supereffective Pheromones: with a Volbeat in its owner's play, Weakness for both
 * Active Pokémon is applied as ×3.
 */
const SUPEREFFECTIVE_PHEROMONES: CardProgram = {
  passive: { weaknessTimesWithNamedInPlay: { name: "Volbeat", amount: 3 } },
};

/**
 * Ferrothorn — Startling Drop: when discarded from its owner's deck by the opponent's effect during
 * the opponent's turn, the opponent discards the top 8 cards of their deck.
 */
const STARTLING_DROP: CardProgram = {
  opponentMillWhenMilled: { ability: "Startling Drop", count: 8 },
};

/**
 * Transformation Tome: two copies must be played at once (the second is a hand cost); switches a
 * Basic Pokémon in the discard pile with one of your Basic Pokémon in play, keeping attached cards,
 * damage and effects.
 */
const TRANSFORMATION_TOME: CardProgram = {
  trainer: [
    {
      op: "payFromHand",
      count: 1,
      to: "discard",
      filter: { kind: "byName", name: "Transformation Tome", cardNoun: true },
    },
    { op: "switchWithDiscardNamed", filter: { kind: "basicPokemon" } },
  ],
};

/** Meganium — Wild Growth: each Basic {G} Energy on its owner's Pokémon provides {G}{G}. */
const WILD_GROWTH: CardProgram = { passive: { basicEnergyProvidesTwice: "Grass" } };

/**
 * Goodra — Slimy Sliding: the opponent's retreat flips a coin; on tails the Active and its Energy
 * stay.
 */
const SLIMY_SLIDING: CardProgram = { passive: { retreatFailsOnTails: "Slimy Sliding" } };

/**
 * Backtrack Badge: once during your turn, after the {C} holder's attack flips coins, you may ignore
 * them and flip again.
 */
const BACKTRACK_BADGE: CardProgram = {
  passive: { reflipAttackCoins: { name: "Backtrack Badge", holderType: "Colorless" } },
};

/**
 * Technical Machine: Fluorite: the holder can use the attack "Fluorite" (discard all Energy from
 * this Pokémon and heal all damage from each of your Tera Pokémon); discarded at the end of your
 * turn.
 */
const TM_FLUORITE: CardProgram = {
  toolAttacks: true,
  attack: {
    0: [
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "healEach", amount: "all", banner: "Tera" },
    ],
  },
  toolDiscardAtEndOfYourTurn: true,
};

/**
 * Walking Wake — Undulating Slice: "Put up to 9 damage counters on this Pokémon. This attack does
 * 20 damage for each damage counter you placed in this way."
 */
const UNDULATING_SLICE: CardProgram = {
  attack: {
    1: [
      { op: "putCountersOnSelfChosen", upTo: 9 },
      { op: "damageDefender", per: 20, count: "placed" },
    ],
  },
};

/**
 * Mr. Mime — Look-Alike Show: "Your opponent reveals their hand. You may use the effect of a
 * Supporter card you find there as the effect of this attack."
 */
const MR_MIME_LOOK_ALIKE_SHOW: CardProgram = {
  attack: { 0: [{ op: "revealOpponentHand" }, { op: "useOpponentSupporterEffect" }] },
};

/** Enriching Energy: provides {C}; when attached from your hand to a Pokémon, draw 4 cards. */
const ENRICHING_ENERGY: CardProgram = {
  energy: { provides: ["Colorless"], onAttach: { kind: "draw", count: 4 } },
};

/**
 * Neo Upper Energy: provides {C}; on a Stage 2 Pokémon it provides every type of Energy but only 2
 * Energy at a time.
 */
const NEO_UPPER_ENERGY: CardProgram = {
  energy: {
    provides: ["Colorless"],
    promoteOnHolderStage: { stage: "Stage2", units: [ANY_ENERGY, ANY_ENERGY] },
  },
};

/** Prism Energy: same shape as `NEO_UPPER_ENERGY` with different values. */
const PRISM_ENERGY: CardProgram = {
  energy: {
    provides: ["Colorless"],
    promoteOnHolderStage: { stage: "Basic", units: [ANY_ENERGY] },
  },
};

/** Reversal Energy. */
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

/** Legacy Energy: provides every type of Energy but only 1 Energy at a time. */
const LEGACY_ENERGY: CardProgram = {
  energy: {
    provides: [ANY_ENERGY],
    passive: { onKoPrizeReduction: { by: 1, oncePerGame: "Legacy Energy" } },
  },
};

/**
 * Lillie's Pearl: if the Lillie's Pokémon it is attached to is Knocked Out by damage from an
 * opponent's attack, that player takes 1 fewer Prize card.
 */
const LILLIES_PEARL: CardProgram = {
  passive: { onKoPrizeReduction: { by: 1, requiresHolderOwner: "Lillie" } },
};

/** Miraidon ex — Tandem Unit. Each copy may search once per turn from either
    spot; the shared search interpreter clamps the take to available Bench space.
    Photon Blaster's printed damage and next-turn lock already derive from text. */
const TANDEM_UNIT: CardProgram = {
  abilities: [
    activated({
      name: "Tandem Unit",
      program: searchThenShuffle({
        filter: { kind: "typedPokemon", pokemonType: "Lightning", stage: "basic" },
        dest: "bench",
        max: 2,
      }),
    }),
  ],
};

/**
 * Cynthia's Gabite — Champion's Call: "Once during your turn, you may search your deck for a
 * Cynthia's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck."
 */
const CHAMPIONS_CALL: CardProgram = {
  abilities: [
    activated({
      name: "Champion's Call",
      program: searchThenShuffle({
        filter: { kind: "ownerPokemon", owner: "Cynthia" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    }),
  ],
};

/**
 * Misty's Lapras — Swim Together: "Search your deck for up to 3 Misty's Pokémon, reveal them, and
 * put them into your hand. Then, shuffle your deck."
 */
const SWIM_TOGETHER: CardProgram = {
  attack: {
    0: searchThenShuffle({
      filter: { kind: "ownerPokemon", owner: "Misty" },
      dest: "hand",
      max: 3,
      reveal: true,
    }),
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
  trainer: searchThenShuffle({
    filter: { kind: "ownerPokemon", owner: "Hop", stage: "basic" },
    dest: "bench",
    max: 2,
  }),
};

/**
 * Steven's Baltoy — Summoning Sign: "Search your deck for up to 2 Basic Steven's Pokémon and put
 * them onto your Bench. Then, shuffle your deck."
 */
const SUMMONING_SIGN: CardProgram = {
  attack: {
    0: searchThenShuffle({
      filter: { kind: "ownerPokemon", owner: "Steven", stage: "basic" },
      dest: "bench",
      max: 2,
    }),
  },
};

/**
 * Lillie's Comfey — Inviting Flowers: "You may search your deck for any number of Basic Lillie's
 * Pokémon and put them onto your Bench. Then, shuffle your deck."
 */
const LILLIES_COMFEY: CardProgram = {
  attack: {
    0: searchThenShuffle({
      filter: { kind: "ownerPokemon", owner: "Lillie", stage: "basic" },
      dest: "bench", // `BENCH_CEILING`, not `BENCH_MAX`: Area Zero Underdepths can allow 8 Benched Pokémon, and
      // `benchSpace` still clamps to the live limit.
      max: BENCH_CEILING,
    }),
    1: [{ op: "returnSelf", dest: "hand" }],
  },
};

/** Revavroom ex — Shattering Speed: "Discard this Pokémon and all attached cards." */
const SHATTERING_SPEED: CardProgram = {
  attack: {
    1: [{ op: "returnSelf", dest: "discard" }],
  },
};

/**
 * Spikemuth Gym: "Once during each player's turn, that player may search their deck for a Marnie's
 * Pokémon, reveal it, and put it into their hand. Then, that player shuffles their deck."
 */
const SPIKEMUTH_GYM: CardProgram = {
  stadium: {
    ability: {
      label: "Spikemuth Gym",
      program: searchThenShuffle({
        filter: { kind: "ownerPokemon", owner: "Marnie" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    },
  },
};

/**
 * Iono's Bellibolt ex — Electric Streamer: "As often as you like during your turn, you may attach a
 * Basic {L} Energy card from your hand to 1 of your Iono's Pokémon."
 */
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

/**
 * N's PP Up: "Attach a Basic Energy card from your discard pile to 1 of your Benched N's Pokémon."
 */
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

/**
 * Marnie's Grimmsnarl ex — Punk Up: on evolving from hand, you may search your deck for up to 5
 * Basic {D} Energy and attach them to your Marnie's Pokémon in any way you like.
 */
const MARNIES_GRIMMSNARL_EX: CardProgram = {
  triggered: [
    {
      name: "Punk Up",
      trigger: "onEvolve",
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

/**
 * Ethan's Ho-Oh ex — Golden Flame: "Once during your turn, you may attach up to 2 Basic {R} Energy
 * cards from your hand to 1 of your Benched Ethan's Pokémon." Both Energy go to the same Pokémon.
 */
const ETHANS_HO_OH_EX: CardProgram = {
  abilities: [
    activated({
      name: "Golden Flame",
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
    }),
  ],
};

/**
 * Lacey: "Shuffle your hand into your deck. Then, draw 4 cards. If your opponent has 3 or fewer
 * Prize cards remaining, draw 8 cards instead."
 */
const LACEY: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] },
      ops: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
      otherwise: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 4 } }],
    },
  ],
};

/** Picnicker: "Flip a coin. If heads, draw 4 cards. If tails, draw 2 cards." */
const PICNICKER: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      ops: [{ op: "drawCards", count: 4 }],
      otherwise: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/**
 * Drasna: "Shuffle your hand into your deck. Then, flip a coin. If heads, draw 8 cards. If tails,
 * draw 3 cards."
 */
const DRASNA: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      ops: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
      otherwise: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 3 } }],
    },
  ],
};

/**
 * Harlequin: each player shuffles their hand into their deck; on heads you draw 5 and the opponent
 * 3, on tails you draw 3 and the opponent 5.
 */
const HARLEQUIN: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      ops: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
      otherwise: [
        { op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 3, opponent: 5 } },
      ],
    },
  ],
};

/**
 * Unfair Stamp: usable only if any of your Pokémon were Knocked Out during your opponent's last
 * turn; each player shuffles their hand into their deck, then you draw 5 and your opponent draws 2.
 */
const UNFAIR_STAMP: CardProgram = {
  trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
  trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 2 } }],
};

/**
 * Team Rocket's Archer: usable only if any of your Team Rocket's Pokémon were Knocked Out during
 * your opponent's last turn; each player shuffles their hand into their deck, then you draw 5 and
 * your opponent draws 3.
 */
const TEAM_ROCKETS_ARCHER: CardProgram = {
  trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn", owner: "Team Rocket" },
  trainer: [{ op: "handRefresh", who: "both", draw: { kind: "perSeat", you: 5, opponent: 3 } }],
};

/**
 * Hassel: usable only if any of your Pokémon were Knocked Out during your opponent's last turn;
 * look at the top 8 cards, put up to 3 into your hand, shuffle the rest back.
 */
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
      ops: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/**
 * Teal Mask Ogerpon ex — Teal Dance: "Once during your turn, you may attach a Basic {G} Energy card
 * from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card."
 */
const TEAL_DANCE: CardProgram = {
  abilities: [
    activated({
      name: "Teal Dance",
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
          ops: [{ op: "drawCards", count: 1 }],
        },
      ],
    }),
  ],
};

/**
 * Hydrapple ex — Ripening Charge: "Once during your turn, you may attach a Basic {G} Energy card
 * from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, heal 30
 * damage from that Pokémon."
 */
const RIPENING_CHARGE: CardProgram = {
  abilities: [
    activated({
      name: "Ripening Charge",
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Grass",
          healTarget: 30,
        },
      ],
    }),
  ],
};

/**
 * Bloodmoon Ursaluna — Battle-Hardened: "When you play this Pokémon from your hand onto your Bench
 * during your turn, you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon."
 */
const BATTLE_HARDENED: CardProgram = {
  triggered: [
    {
      name: "Battle-Hardened",
      trigger: "onPlayToBench",
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

/**
 * Iono's Kilowattrel — Flashing Draw: "You must discard a Basic {L} Energy from this Pokémon in
 * order to use this Ability. Once during your turn, you may draw cards until you have 6 cards in
 * your hand."
 */
const FLASHING_DRAW: CardProgram = {
  abilities: [
    activated({
      name: "Flashing Draw",
      program: [
        {
          op: "discardEnergy",
          from: "self",
          filter: { kind: "basicEnergy", energyType: "Lightning" },
        },
        { op: "drawUntilHandSize", size: 6 },
      ],
    }),
  ],
};

/**
 * Carmine: "If you go first, you may use this card during your first turn. Discard your hand and
 * draw 5 cards."
 */
const CARMINE: CardProgram = {
  trainer: [{ op: "discardHand" }, { op: "drawCards", count: 5 }],
  trainerFirstTurnExempt: true,
};

/**
 * Team Rocket's Proton: "If you go first, you may use this card during your first turn. Search your
 * deck for up to 3 Basic Team Rocket's Pokémon, reveal them, and put them into your hand. Then,
 * shuffle your deck."
 */
const TEAM_ROCKETS_PROTON: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
    dest: "hand",
    max: 3,
    reveal: true,
  }),
  trainerFirstTurnExempt: true,
};

/**
 * Team Rocket's Mewtwo ex — Power Saver: "This Pokémon can't attack unless you have 4 or more Team
 * Rocket's Pokémon in play."
 */
const POWER_SAVER: CardProgram = {
  passive: {
    cantAttackUnless: {
      kind: "yourOwnerPokemonInPlayAtLeast",
      owner: "Team Rocket",
      count: 4,
    },
  },
};

/**
 * Meloetta ex — Debut Performance: "If you go first, this Pokémon can use attacks during your first
 * turn." (§4)
 */
const DEBUT_PERFORMANCE: CardProgram = {
  passive: { attackFirstTurnExempt: true },
};

/**
 * Eevee — Boosted Evolution: "As long as this Pokémon is in the Active Spot, it can evolve during
 * your first turn or the turn you play it."
 */
const BOOSTED_EVOLUTION: CardProgram = {
  passive: { evolveEarlyExempt: { activeOnly: true } },
};

/**
 * Karrablast / Shelmet — Stimulated Evolution: "If you have Shelmet in play, this Pokémon can
 * evolve during your first turn or the turn you play it." Each names the other.
 */
const STIMULATED_EVOLUTION_KARRABLAST: CardProgram = {
  passive: { evolveEarlyExempt: { ifInPlay: "Shelmet" } },
};

/** Stimulated Evolution's other half — Shelmet `sv10.5w-008`/`-093`, gating on
    Karrablast. See `STIMULATED_EVOLUTION_KARRABLAST` above for why this is a
    second object rather than a shared one. */
const STIMULATED_EVOLUTION_SHELMET: CardProgram = {
  passive: { evolveEarlyExempt: { ifInPlay: "Karrablast" } },
};

/**
 * Bloodmoon Ursaluna ex — Seasoned Skill: "Blood Moon used by this Pokémon costs {C} less for each
 * Prize card your opponent has taken."
 */
const SEASONED_SKILL: CardProgram = {
  passive: { attackCostDiscountPerOpponentPrize: 1, attackCostDiscountAttack: "Blood Moon" },
};

/**
 * Food Prep: "Attacks used by this Pokémon cost {C} less for each Kofu card in your discard pile."
 */
const FOOD_PREP: CardProgram = {
  passive: { attackCostDiscountPerNamedInDiscard: { name: "Kofu", amount: 1 } },
};

/**
 * Incineroar ex — Hustle Play: "Attacks used by this Pokémon cost {C} less for each of your
 * opponent's Benched Pokémon."
 */
const HUSTLE_PLAY: CardProgram = {
  passive: { attackCostDiscountPerOpponentBenched: 1 },
};

/**
 * Florges — Captivating Invitation: "Once during your turn, you may flip a coin. If heads, switch
 * in 1 of your opponent's Benched Pokémon to the Active Spot, and the new Active Pokémon is now
 * Confused."
 */
const CAPTIVATING_INVITATION: CardProgram = {
  abilities: [
    activated({
      name: "Captivating Invitation",
      program: [
        {
          op: "coinFlipGate",
          ops: [{ op: "gust" }, { op: "applyStatus", target: "defender", status: "confused" }],
        },
      ],
    }),
  ],
};

/**
 * Lisia's Appeal: "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. If you
 * do, the new Active Pokémon is now Confused."
 */
const LISIAS_APPEAL: CardProgram = {
  trainer: [
    { op: "gust", basicOnly: true },
    { op: "applyStatus", target: "defender", status: "confused" },
  ],
};

/**
 * Drayton: "Look at the top 7 cards of your deck. You may reveal a Pokémon and a Trainer card you
 * find there and put them into your hand. Shuffle the other cards back into your deck."
 */
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

/**
 * Roto-Stick: "Look at the top 4 cards of your deck. You may reveal any number of Supporter cards
 * you find there and put them into your hand. Shuffle the other cards back into your deck."
 */
const ROTO_STICK: CardProgram = {
  trainer: [
    { op: "lookAtTopN", n: 4, filter: { kind: "supporter" }, max: "any", reveal: true },
    { op: "shuffleDeck" },
  ],
};

/**
 * Bug Catching Set: "Look at the top 7 cards of your deck. You may reveal up to 2 in any
 * combination of {G} Pokémon and Basic {G} Energy cards you find there and put them into your hand.
 * Shuffle the other cards back into your deck."
 */
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

/**
 * Explorer's Guidance: "Look at the top 6 cards of your deck and put 2 of them into your hand.
 * Discard the other cards."
 */
const EXPLORERS_GUIDANCE: CardProgram = {
  trainer: [
    {
      op: "lookAtTopN",
      n: 6,
      filter: { kind: "anyCard" },
      max: 2,
      exact: true,
      restTo: "discard",
    },
  ],
};

/**
 * Drakloak — Recon Directive: "Once during your turn, you may look at the top 2 cards of your deck
 * and put 1 of them into your hand. Put the other card on the bottom of your deck."
 */
const DRAKLOAK: CardProgram = {
  abilities: [
    activated({
      name: "Recon Directive",
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
    }),
  ],
};

/**
 * Rika: "Look at the top 4 cards of your deck and put 2 of them into your hand. Shuffle the other
 * cards and put them on the bottom of your deck."
 */
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

/**
 * Team Rocket's Petrel: "Search your deck for a Trainer card, reveal it, and put it into your hand.
 * Then, shuffle your deck."
 */
const TRAINER_SEARCH: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "trainerCard" },
    dest: "hand",
    max: 1,
    reveal: true,
  }),
};

/**
 * Pidove — Emergency Evolution: once during your turn, if this Pokémon's remaining HP is 30 or
 * less, you may search your deck for a Pokémon that evolves from it and evolve it.
 */
const EMERGENCY_EVOLUTION: CardProgram = {
  abilities: [
    activated({
      name: "Emergency Evolution",
      remainingHpAtMost: 30,
      program: [
        { op: "evolveFromDeck", names: ["Unfezant", "Unfezant ex"] },
        { op: "shuffleDeck" },
      ],
    }),
  ],
};

/**
 * Dudunsparce — Run Away Draw: "Once during your turn, you may draw 3 cards. If you drew any cards
 * in this way, shuffle this Pokémon and all attached cards into your deck."
 */
const RUN_AWAY_DRAW: CardProgram = {
  abilities: [
    activated({
      name: "Run Away Draw",
      program: [
        { op: "drawCards", count: 3, recordAs: "moved" },
        { op: "recordGate", slot: "moved", ops: [{ op: "returnSelf", dest: "deck" }] },
      ],
    }),
  ],
};

/**
 * Abra — Teleporter: "Once during your turn, if this Pokémon is in the Active Spot, you may shuffle
 * it and all attached cards into your deck."
 */
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

/** Gholdengo — Surf Back: "You may shuffle this Pokémon and all attached cards into your deck." */
const SURF_BACK: CardProgram = {
  attack: {
    1: [
      {
        op: "optional",
        note: "You may shuffle this Pokémon and all attached cards into your deck.",
        ops: [{ op: "returnSelf", dest: "deck" }],
      },
    ],
  },
};

/**
 * Eldegoss — "Breezy Gift": put this Pokémon and all attached cards into your deck, search for up
 * to 3 cards, then shuffle.
 */
const BREEZY_GIFT: CardProgram = {
  attack: {
    0: [
      { op: "returnSelf", dest: "deck" },
      ...searchThenShuffle({ filter: { kind: "anyCard" }, dest: "hand", max: 3 }),
    ],
  },
};

/**
 * Ciphermaniac's Codebreaking: search your deck for 2 cards, shuffle, then put those cards on top
 * in any order.
 */
const CIPHERMANIACS_CODEBREAKING: CardProgram = { trainer: searchTopOrderProgram(2) };

/**
 * Dusclops — "Cursed Blast": put 5 damage counters on 1 of your opponent's Pokémon; if you use this
 * Ability, this Pokémon is Knocked Out.
 */
const CURSED_BLAST_5: CardProgram = {
  abilities: [
    activated({
      name: "Cursed Blast",
      program: [
        { op: "damageChosen", target: "opponentAny", amount: 50, count: 1, source: "ability" },
        { op: "knockOutSelf" },
      ],
    }),
  ],
};

/** Dusknoir's version of the Cursed Blast sentence (13 counters). */
const CURSED_BLAST_13: CardProgram = {
  abilities: [
    activated({
      name: "Cursed Blast",
      program: [
        { op: "damageChosen", target: "opponentAny", amount: 130, count: 1, source: "ability" },
        { op: "knockOutSelf" },
      ],
    }),
  ],
};

/**
 * Magneton — "Overvolt Discharge": attach up to 3 Basic Energy from your discard pile to your {L}
 * Pokémon in any way you like, then this Pokémon is Knocked Out.
 */
const OVERVOLT_DISCHARGE: CardProgram = {
  abilities: [
    activated({
      name: "Overvolt Discharge",
      program: [
        { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
        { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
        { op: "attachEnergyFrom", source: "discard", targetType: "Lightning", declinable: true },
        { op: "knockOutSelf" },
      ],
    }),
  ],
};

/** Yanmega ex — "Buzzing Boost". */
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

/** Ledian — "Glittering Star Pattern". */
const GLITTERING_STAR_PATTERN: CardProgram = {
  triggered: [
    {
      name: "Glittering Star Pattern",
      trigger: "onEvolve",
      // `optional`: the printed "you may" lets the player decline the pick.
      program: [{ op: "gust", remainingHpAtMost: 90, optional: true }],
    },
  ],
};

/** Bianca's Devotion: heal all damage from 1 of your Pokémon that has 30 HP or less remaining. */
const BIANCAS_DEVOTION: CardProgram = {
  trainer: [{ op: "healChosen", amount: "all", remainingHpAtMost: 30 }],
};

/** Steven's Metagross ex — "X-Boot". */
const X_BOOT: CardProgram = {
  abilities: [
    activated({
      name: "X-Boot",
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
    }),
  ],
};

/**
 * Energy Coin: flip 2 coins; if both are heads, search your deck for a Basic Energy and attach it
 * to 1 of your Pokémon, then shuffle.
 */
const ENERGY_COIN: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      coins: 2,
      ops: [
        { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 1 },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Rapidash — "Hurried Gait": once during your turn, you may draw a card. */
const HURRIED_GAIT: CardProgram = {
  abilities: [
    activated({
      name: "Hurried Gait",
      program: [{ op: "drawCards", count: 1 }],
    }),
  ],
};

/** Chandelure — "Alluring Light": once during your turn, you may have each player draw a card. */
const ALLURING_LIGHT: CardProgram = {
  abilities: [
    activated({
      name: "Alluring Light",
      program: [{ op: "drawCards", count: 1, who: "eachPlayer" }],
    }),
  ],
};

/** Blissey ex — "Happy Switch": move a Basic Energy from 1 of your Pokémon to another. */
const HAPPY_SWITCH: CardProgram = {
  abilities: [
    activated({
      name: "Happy Switch",
      program: [{ op: "moveEnergy", filter: { kind: "basicEnergy" }, max: 1 }],
    }),
  ],
};

/** Swadloon — "Healing Leaves": once during your turn, heal 20 damage from your Active Pokémon. */
const HEALING_LEAVES: CardProgram = {
  abilities: [
    activated({
      name: "Healing Leaves",
      program: [{ op: "heal", target: "self", amount: 20 }],
    }),
  ],
};

/** Mamoswine ex — "Mammoth Hauler". */
const MAMMOTH_HAULER: CardProgram = {
  abilities: [
    activated({
      name: "Mammoth Hauler",
      program: searchThenShuffle({
        filter: { kind: "anyPokemon" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    }),
  ],
};

/** Sawsbuck sv05-017 / sv05-166 — "Changing Seasons": *"Once during your turn,
    you may search your deck for a Stadium card, reveal it, and put it into your
    hand. Then, shuffle your deck."* (Ability, 2 legal printings.)

    `MAMMOTH_HAULER` with the noun moved to the `stadium` filter; the caption is
    `retrieveNoun`'s "a Stadium card". */
const CHANGING_SEASONS: CardProgram = {
  abilities: [
    activated({
      name: "Changing Seasons",
      program: searchThenShuffle({
        filter: { kind: "stadium" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    }),
  ],
};

/**
 * Ethan's Quilava — "Bonded by the Journey": search your deck for an Ethan's Adventure card and put
 * it into your hand.
 */
const BONDED_BY_THE_JOURNEY: CardProgram = {
  abilities: [
    activated({
      name: "Bonded by the Journey",
      program: searchThenShuffle({
        filter: { kind: "byName", name: "Ethan's Adventure", cardNoun: true },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    }),
  ],
};

/** Volcarona — "Torrid Scales"; requires discarding a Basic {R} Energy from hand. */
const TORRID_SCALES: CardProgram = {
  abilities: [
    activated({
      name: "Torrid Scales",
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "basicEnergy", energyType: "Fire" },
        },
        { op: "applyStatus", target: "defender", status: "burned" },
      ],
    }),
  ],
};

/** Archeops — "Ancient Wing". */
const ANCIENT_WING: CardProgram = {
  abilities: [
    {
      name: "Ancient Wing",
      oncePerTurn: true,
      activeOnly: true,
      program: [{ op: "devolveChosen" }],
    },
  ],
};

/** Meowstic — "Beckoning Tail"; requires discarding a Chill Teaser Toy from hand. */
const BECKONING_TAIL: CardProgram = {
  abilities: [
    activated({
      name: "Beckoning Tail",
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "byName", name: "Chill Teaser Toy", cardNoun: true },
        },
        { op: "gust" },
      ],
    }),
  ],
};

/** Samurott — "Torrential Whirlpool". */
const TORRENTIAL_WHIRLPOOL: CardProgram = {
  abilities: [
    activated({
      name: "Torrential Whirlpool",
      program: [
        { op: "switchActive", recordAs: "moved" },
        { op: "recordGate", slot: "moved", ops: [{ op: "opponentSwitchOut" }] },
      ],
    }),
  ],
};

/** Team Rocket's Tyranitar — "Sand Stream". */
const SAND_STREAM: CardProgram = {
  triggered: [
    {
      name: "Sand Stream",
      trigger: "betweenTurns",
      activeOnly: true,
      program: [
        {
          op: "counterEachAll",
          amount: 20,
          filter: { kind: "basicPokemon" },
          side: "opponent",
          source: "ability",
        },
      ],
    },
  ],
};

/** Chien-Pao — "Snow Sink". */
const SNOW_SINK: CardProgram = {
  triggered: [
    {
      name: "Snow Sink",
      trigger: "onPlayToBench",
      program: [
        {
          op: "conditionGate",
          cond: { kind: "stadiumInPlay" },
          ops: [
            {
              op: "optional",
              note: "You may discard a Stadium in play.",
              ops: [{ op: "discardStadium" }],
            },
          ],
        },
      ],
    },
  ],
};

/** Ambipom — "Wicked Tail". */
const WICKED_TAIL: CardProgram = {
  triggered: [
    {
      name: "Wicked Tail",
      trigger: "onEvolve",
      program: [
        {
          op: "coinFlipGate",
          ops: [{ op: "randomFromOpponentHand", to: "deck" }],
        },
        {
          op: "coinFlipGate",
          ops: [{ op: "randomFromOpponentHand", to: "deck" }],
        },
      ],
    },
  ],
};

/** Black Belt's Training (Supporter). */
const BLACK_BELTS_TRAINING: CardProgram = {
  trainer: [
    { op: "boostSideAttacksThisTurn", amount: 40, target: { kind: "suffixPokemon", suffix: "ex" } },
  ],
};

/**
 * Team Rocket's Ariana (Supporter): draw until you have 5 cards in hand, with a conditional bonus.
 */
const TEAM_ROCKETS_ARIANA: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "yourPokemonAllOwner", owner: "Team Rocket" },
      ops: [{ op: "drawUntilHandSize", size: 8 }],
      otherwise: [{ op: "drawUntilHandSize", size: 5 }],
    },
  ],
};

/** Billy & O'Nare: draw 2 cards; then, if you have 10 or more cards in hand, draw 2 more. */
const BILLY_AND_ONARE: CardProgram = {
  trainer: [
    { op: "drawCards", count: 2 },
    {
      op: "conditionGate",
      cond: { kind: "yourHandAtLeast", count: 10 },
      ops: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/** Dragon Elixir: heal 60 damage from your Active {N} Pokémon. */
const DRAGON_ELIXIR: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "yourActiveHasType", type: "Dragon" },
      ops: [{ op: "heal", target: "self", amount: 60 }],
    },
  ],
};

/**
 * Team Rocket's Great Ball: flip a coin; if heads, search for an Evolution Team Rocket's Pokémon.
 */
const TEAM_ROCKETS_GREAT_BALL: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      ops: [
        {
          op: "searchDeck",
          filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "evolution" },
          dest: "hand",
          max: 1,
          reveal: true,
        },
      ],
      otherwise: [
        {
          op: "searchDeck",
          filter: { kind: "ownerPokemon", owner: "Team Rocket", stage: "basic" },
          dest: "hand",
          max: 1,
          reveal: true,
        },
      ],
    },
    { op: "shuffleDeck" },
  ],
};

/** Caretaker (Supporter): draw 2 cards, with a Community Center rider. */
const CARETAKER: CardProgram = {
  trainer: [
    { op: "drawCards", count: 2, recordAs: "moved" },
    {
      op: "recordGate",
      slot: "moved",
      ops: [
        {
          op: "conditionGate",
          cond: { kind: "stadiumInPlayNamed", name: "Community Center" },
          ops: [{ op: "shufflePlayedCardIntoDeck" }],
        },
      ],
    },
  ],
};

/**
 * Jasmine's Gaze: during your opponent's next turn, all of your Pokémon take 30 less damage from
 * attacks.
 */
const JASMINES_GAZE: CardProgram = {
  trainer: [{ op: "installSideDamageReductionNextTurn", amount: 30 }],
};

/**
 * Amarys: draw 4 cards; at the end of this turn, if you have 5 or more cards in hand, discard your
 * hand.
 */
const AMARYS: CardProgram = {
  trainer: [
    { op: "drawCards", count: 4 },
    { op: "scheduleEndOfTurnHandDiscard", atLeast: 5 },
  ],
};

/** Team Rocket's Factory (Stadium). */
const TEAM_ROCKETS_FACTORY: CardProgram = {
  stadium: {
    ability: {
      label: "Team Rocket's Factory",
      playableIf: { kind: "youPlayedSupporterNamedThisTurn", nameContains: "Team Rocket" },
      program: [{ op: "drawCards", count: 2 }],
    },
  },
};

/** Community Center (Stadium). */
const COMMUNITY_CENTER: CardProgram = {
  stadium: {
    ability: {
      label: "Community Center",
      playableIf: { kind: "youPlayedSupporterThisTurn" },
      program: [{ op: "healEach", amount: 10 }],
    },
  },
};

/** Crobat — "Shadowy Envoy": usable only if you played Janine's Secret Art this turn. */
const SHADOWY_ENVOY: CardProgram = {
  abilities: [
    activated({
      name: "Shadowy Envoy",
      playableIf: { kind: "youPlayedSupporterNamedThisTurn", name: "Janine's Secret Art" },
      program: [{ op: "drawUntilHandSize", size: 8 }],
    }),
  ],
};

/** Pecharunt — "Toxic Subjugation". */
const TOXIC_SUBJUGATION: CardProgram = {
  triggered: [
    {
      name: "Toxic Subjugation",
      trigger: "betweenTurns",
      activeOnly: true,
      program: [
        {
          op: "conditionGate",
          cond: { kind: "opponentActivePoisoned" },
          ops: [{ op: "damageActive", amount: 50, source: "ability" }],
        },
      ],
    },
  ],
};

/** Kieran (Supporter): choose 1 of two printed options. */
const KIERAN: CardProgram = {
  trainer: [
    {
      op: "optional",
      note: "Choose 1: • Switch your Active Pokémon with 1 of your Benched Pokémon. • During this turn, attacks used by your Pokémon do 30 more damage to your opponent's Active Pokémon ex and Active Pokémon V (before applying Weakness and Resistance).",
      labels: { yes: "Switch your Active Pokémon", no: "+30 damage to ex and V this turn" },
      ops: [{ op: "switchActive" }],
      otherwise: [
        {
          op: "boostSideAttacksThisTurn",
          amount: 30,
          target: {
            kind: "anyOf",
            filters: [
              { kind: "suffixPokemon", suffix: "ex" },
              { kind: "suffixPokemon", suffix: "V" },
            ],
          },
        },
      ],
    },
  ],
};

/**
 * Team Rocket's Venture Bomb: flip a coin; heads puts 2 damage counters on 1 of your opponent's
 * Pokémon.
 */
const TEAM_ROCKETS_VENTURE_BOMB: CardProgram = {
  trainer: [
    {
      op: "coinFlipGate",
      ops: [{ op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "trainer" }],
      otherwise: [{ op: "damageSelf", amount: 20, source: "trainer" }],
    },
  ],
};

/** Morty's Conviction: usable only if you discard another card from your hand. */
const MORTYS_CONVICTION: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 1, to: "discard" },
    { op: "drawCards", count: 1, per: { kind: "opponentBenchCount" } },
  ],
};

/** Xerosic's Machinations: your opponent discards until they have 3 cards in hand. */
const XEROSICS_MACHINATIONS: CardProgram = {
  trainer: [{ op: "opponentDiscardsFromHand", untilHandSize: 3 }],
};

/** Malamar — "Colluding Tentacles". */
const MALAMAR_COLLUDING_TENTACLES: CardProgram = {
  attack: {
    0: [
      {
        op: "conditionGate",
        cond: { kind: "youPlayedSupporterNamedThisTurn", name: "Xerosic's Machinations" },
        ops: [
          { op: "gust", recordAs: "moved" },
          {
            op: "recordGate",
            slot: "moved",
            ops: [{ op: "damageNewActive", amount: 120 }],
          },
        ],
      },
    ],
  },
};

/** Lucian (Supporter): each player shuffles their hand onto the bottom of their deck. */
const LUCIAN: CardProgram = {
  trainer: [
    {
      op: "handRefresh",
      who: "both",
      toBottom: true,
      onlyIfAnyMoved: true,
      draw: { kind: "coinFlip", heads: 6, tails: 3 },
    },
  ],
};

/**
 * Arven's Sandwich: heal 30 damage from your Active Pokémon, or 100 if it is an Arven's Pokémon.
 */
const ARVENS_SANDWICH: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "yourActiveOwner", owner: "Arven" },
      ops: [{ op: "heal", target: "self", amount: 100 }],
      otherwise: [{ op: "heal", target: "self", amount: 30 }],
    },
  ],
};

/** Megaton Blower (ACE SPEC). */
const MEGATON_BLOWER: CardProgram = {
  trainer: [
    { op: "discardTools", count: "all" },
    { op: "discardEnergy", from: "opponentEach", filter: { kind: "specialEnergy" }, count: "all" },
    { op: "discardStadium" },
  ],
};

/**
 * Brilliant Blender (ACE SPEC): search your deck for up to 5 cards and discard them, then shuffle.
 */
const BRILLIANT_BLENDER: CardProgram = {
  trainer: searchThenShuffle({ filter: { kind: "anyCard" }, dest: "discard", max: 5 }),
};

/** TM Machine: search your deck for up to 3 Technical Machine Tools. */
const TM_MACHINE: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "toolNameContaining", fragment: "Technical Machine" },
    dest: "hand",
    max: 3,
    reveal: true,
  }),
};

/**
 * Dusk Ball: look at the bottom 7 cards of your deck and you may put a Pokémon from there into your
 * hand.
 */
const DUSK_BALL: CardProgram = {
  trainer: [
    {
      op: "lookAtTopN",
      n: 7,
      from: "bottom",
      filter: { kind: "anyPokemon" },
      max: 1,
      reveal: true,
    },
    { op: "shuffleDeck" },
  ],
};

/** Tool Scrapper: discard up to 2 Pokémon Tools attached to any Pokémon. */
const TOOL_SCRAPPER: CardProgram = {
  trainer: [{ op: "discardTools", count: 2, sides: "both" }],
};

/** Counter Gain (Tool). */
const COUNTER_GAIN: CardProgram = {
  passive: { attackCostDiscount: { amount: 1, ifMorePrizesRemaining: true } },
};

/** Hop's Choice Band (Tool). */
const HOPS_CHOICE_BAND: CardProgram = {
  passive: {
    attackCostDiscount: { amount: 1, holder: { kind: "ownerPokemon", owner: "Hop" } },
    damageBonusBeforeWRIf: { amount: 30, cond: { kind: "yourActiveOwner", owner: "Hop" } },
  },
};

/** Brave Bangle (Tool): Pokémon without a Rule Box do 30 more damage. */
const BRAVE_BANGLE: CardProgram = {
  passive: {
    damageBonusBeforeWRIfTarget: {
      amount: 30,
      targetSuffix: "ex",
      holder: { kind: "anyPokemon", noRuleBox: true },
    },
  },
};

/** Air Balloon (Tool): Retreat Cost is {C}{C} less. */
const AIR_BALLOON: CardProgram = { passive: { retreatCostDiscount: { amount: 2 } } };

/** Rescue Board (Tool). */
const RESCUE_BOARD: CardProgram = {
  passive: { retreatCostDiscount: { amount: 1, freeAtRemainingHpAtMost: 30 } },
};

/** Gravity Gemstone (Tool). */
const GRAVITY_GEMSTONE: CardProgram = { passive: { activeRetreatSurchargeBoth: 1 } };

/** Full Metal Lab (Stadium). */
const FULL_METAL_LAB: CardProgram = {
  stadium: {
    damageReductionAfterWR: {
      amount: 30,
      beneficiary: { kind: "typedPokemon", pokemonType: "Metal" },
    },
  },
};

/** Granite Cave (Stadium). */
const GRANITE_CAVE: CardProgram = {
  stadium: {
    damageReductionAfterWR: {
      amount: 30,
      beneficiary: { kind: "ownerPokemon", owner: "Steven" },
    },
  },
};

/** Postwick (Stadium). */
const POSTWICK: CardProgram = {
  stadium: {
    damageBonusBeforeWR: { amount: 30, attacker: { kind: "ownerPokemon", owner: "Hop" } },
  },
};

/** N's Castle (Stadium): N's Pokémon in play have no Retreat Cost. */
const NS_CASTLE: CardProgram = {
  stadium: { retreat: { filter: { kind: "ownerPokemon", owner: "N" }, free: true } },
};

/** Paradise Resort (Stadium): each Psyduck's Retreat Cost is {C} less. */
const PARADISE_RESORT: CardProgram = {
  stadium: { retreat: { filter: { kind: "byName", name: "Psyduck" }, discount: 1 } },
};

/** Salvatore (Supporter). */
const SALVATORE: CardProgram = {
  trainer: [{ op: "evolveFromDeckChosen", noAbilities: true }, { op: "shuffleDeck" }],
};

/** Lillie's Clefairy ex — "Fairy Zone". */
const FAIRY_ZONE: CardProgram = {
  passive: { opponentWeaknessRewrite: { targetType: "Dragon", weaknessType: "Psychic" } },
};

/** Flutter Mane — "Midnight Fluttering". */
const MIDNIGHT_FLUTTERING: CardProgram = {
  passive: {
    disableAbilities: {
      side: "opponent",
      requiresActive: true,
      targetZone: "active",
      exemptAbilityNamed: "Midnight Fluttering",
    },
  },
};

/** Gastrodon — "Sticky Bind". */
const STICKY_BIND: CardProgram = {
  passive: {
    disableAbilities: { side: "both", stage: "Stage2", sourceOnBench: true, targetZone: "bench" },
  },
};

/** Orthworm ex — "Pummeling Payback". */
const PUMMELING_PAYBACK: CardProgram = {
  passive: { damageAttacker: { amount: 20, perAttachedEnergy: "Metal" } },
};

/** Maractus — "Exploding Needles". */
const EXPLODING_NEEDLES: CardProgram = {
  passive: { damageAttackerOnKo: { amount: 60, activeOnly: true } },
};

/** Klinklang — "Gear Coating". */
const GEAR_COATING: CardProgram = {
  passive: { seatDamageReductionAfterWR: { amount: 20, beneficiaryHasEnergy: "Metal" } },
};

/** Regirock — "Rock Armor". */
const ROCK_ARMOR: CardProgram = { passive: { damageReductionAfterWRIfEnergy: 30 } };

/** Drilbur — "Dig Dig Dig". */
const DIG_DIG_DIG: CardProgram = {
  triggered: [
    {
      name: "Dig Dig Dig",
      trigger: "onPlayToBench",
      program: searchThenShuffle({
        filter: { kind: "basicEnergy", energyType: "Fighting" },
        dest: "discard",
        max: 3,
      }),
    },
  ],
};

/** Team Rocket's Koffing — "Smog Signals". */
const SMOG_SIGNALS: CardProgram = {
  triggered: [
    {
      name: "Smog Signals",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: searchThenShuffle({
        filter: { kind: "pokemonNameContaining", fragment: "Koffing" },
        dest: "bench",
        max: 2,
      }),
    },
  ],
};

/** Thwackey — "Boom Boom Groove". */
const BOOM_BOOM_GROOVE: CardProgram = {
  abilities: [
    activated({
      name: "Boom Boom Groove",
      playableIf: { kind: "yourActiveHasAbility", name: "Festival Lead" },
      program: searchThenShuffle({ filter: { kind: "anyCard" }, dest: "hand", max: 1 }),
    }),
  ],
};

/**
 * Slaking ex — "Born to Slack": can't attack if your opponent has no Pokémon ex or Pokémon V in
 * play.
 */
const BORN_TO_SLACK: CardProgram = {
  passive: { cantAttackUnless: { kind: "opponentHasExOrVInPlay" } },
};

/** Annihilape — "Lose Cool". */
const LOSE_COOL: CardProgram = {
  passive: {
    damageBonusBeforeWRIf: {
      amount: 120,
      cond: { kind: "yourActiveDamageCountersAtLeast", count: 2 },
    },
  },
};

/** Galvantula — "Compound Eyes". */
const COMPOUND_EYES: CardProgram = {
  passive: { damageBonusBeforeWRIf: { amount: 50, cond: { kind: "opponentActiveHasAbility" } } },
};

/**
 * Magmortar — "Magma Surge": during Pokémon Checkup, put 3 more damage counters on your opponent's
 * Burned Pokémon.
 */
const MAGMA_SURGE: CardProgram = { passive: { opponentBurnExtraCounters: 30 } };

const WAFTING_HEAL_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may heal all damage from your Active {G} Pokémon. If you healed any damage in this way, discard all Energy from that Pokémon.";

/** Whimsicott — "Wafting Heal"; the printed "you may" is a real confirm. */
const WAFTING_HEAL: CardProgram = {
  triggered: [
    {
      name: "Wafting Heal",
      trigger: "onEvolve",
      program: [
        {
          op: "conditionGate",
          cond: { kind: "yourActiveHasType", type: "Grass" },
          ops: [
            {
              op: "conditionGate",
              cond: { kind: "yourActiveDamaged" },
              ops: [
                {
                  op: "optional",
                  note: WAFTING_HEAL_TEXT,
                  ops: [
                    { op: "heal", target: "self", amount: "all", discardEnergyFromHealed: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** Dachsbun ex — "Time to Chow Down". */
const TIME_TO_CHOW_DOWN: CardProgram = {
  triggered: [
    {
      name: "Time to Chow Down",
      trigger: "onEvolve",
      program: [
        {
          op: "optional",
          note: "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may heal all damage from each of your Evolution Pokémon. If you healed any damage in this way, discard all Energy from those Pokémon.",
          ops: [
            {
              op: "healEach",
              amount: "all",
              evolutionOnly: true,
              discardEnergyFromHealed: true,
            },
          ],
        },
      ],
    },
  ],
};

/** Indeedee — "Obliging Heal". */
const OBLIGING_HEAL: CardProgram = {
  triggered: [
    {
      name: "Obliging Heal",
      trigger: "onPlayToBench",
      program: [{ op: "heal", target: "self", amount: 30 }, { op: "recoverOneStatus" }],
    },
  ],
};

/** Cradily — "Selective Slime". */
const SELECTIVE_SLIME: CardProgram = {
  abilities: [
    activated({
      name: "Selective Slime",
      program: [
        {
          op: "coinFlipGate",
          ops: [
            {
              op: "optional",
              note: "Selective Slime: choose Burned, Confused, or Poisoned. Your opponent's Active Pokémon is now affected by that Special Condition.",
              labels: { yes: "Burned", no: "Confused or Poisoned" },
              ops: [{ op: "applyStatus", target: "defender", status: "burned" }],
              otherwise: [
                {
                  op: "optional",
                  note: "Selective Slime: choose Confused or Poisoned. Your opponent's Active Pokémon is now affected by that Special Condition.",
                  labels: { yes: "Confused", no: "Poisoned" },
                  ops: [{ op: "applyStatus", target: "defender", status: "confused" }],
                  otherwise: [{ op: "applyStatus", target: "defender", status: "poisoned" }],
                },
              ],
            },
          ],
        },
      ],
    }),
  ],
};

/** Perrin (Supporter). */
const PERRIN: CardProgram = {
  trainer: [
    {
      op: "payFromHand",
      count: "any",
      cap: 2,
      filter: { kind: "anyPokemon" },
      to: "deckBottom",
      recordAs: "paid",
    },
    {
      op: "recordGate",
      slot: "paid",
      ops: [
        {
          op: "searchDeck",
          filter: { kind: "anyPokemon" },
          dest: "hand",
          max: 2,
          maxRecorded: "paid",
          reveal: true,
        },
      ],
    },
    { op: "shuffleDeck" },
  ],
};

/** Crispin (Supporter). */
const CRISPIN: CardProgram = {
  trainer: [
    {
      op: "searchDeck",
      filter: { kind: "basicEnergy" },
      dest: "hand",
      max: 2,
      distinctEnergyTypes: true,
      reveal: true,
      recordAs: "moved",
    },
    { op: "attachEnergyFrom", source: "hand", oneOfRecorded: "moved" },
    { op: "shuffleDeck" },
  ],
};

/**
 * Super Potion: heal 60 damage from 1 of your Pokémon; if any was healed, discard an Energy from
 * it.
 */
const SUPER_POTION: CardProgram = {
  trainer: [{ op: "healChosen", amount: 60, discardEnergyFromHealed: true }],
};

/** Love Ball. */
const LOVE_BALL: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "anyPokemon" },
    dest: "hand",
    max: 1,
    reveal: true,
    sameNameAsOpponentInPlay: true,
  }),
};

/** Hand Trimmer: each player discards down to 5 cards; your opponent discards first. */
const HAND_TRIMMER: CardProgram = {
  trainer: [
    { op: "opponentDiscardsFromHand", untilHandSize: 5 },
    { op: "opponentDiscardsFromHand", untilHandSize: 5, whose: "self" },
  ],
};

/** Scoop Up Cyclone (ACE SPEC): put 1 of your Pokémon and all attached cards into your hand. */
const SCOOP_UP_CYCLONE: CardProgram = {
  trainer: [{ op: "returnBenched", whose: "self", dest: "hand", includeActive: true }],
};

/** Scramble Switch (ACE SPEC). */
const SCRAMBLE_SWITCH: CardProgram = {
  trainer: [
    { op: "switchActive", recordAs: "moved", recordDemoted: true },
    {
      op: "recordGate",
      slot: "moved",
      ops: [
        {
          op: "moveEnergy",
          filter: { kind: "anyEnergy" },
          max: "any",
          route: "benchToActive",
          sourceRecorded: "moved",
        },
      ],
    },
  ],
};

/**
 * Academy at Night (Stadium): once during each player's turn, they may put a card from hand on top
 * of their deck.
 */
const ACADEMY_AT_NIGHT: CardProgram = {
  stadium: {
    ability: {
      label: "Academy at Night",
      program: [{ op: "payFromHand", count: 1, to: "deckTop" }],
    },
  },
};

/** Perilous Jungle (Stadium). */
const PERILOUS_JUNGLE: CardProgram = {
  stadium: { poisonExtraCounters: { amount: 20, excludesType: "Darkness" } },
};

/** The six type Berries (Tools). */
const HABAN_BERRY = berry("Dragon");
const OCCA_BERRY = berry("Fire");
const PAYAPA_BERRY = berry("Psychic");
const BABIRI_BERRY = berry("Metal");
const COLBUR_BERRY = berry("Darkness");
const PASSHO_BERRY = berry("Water");

/** Survival Brace (Tool, ACE SPEC). */
const SURVIVAL_BRACE: CardProgram = {
  passive: { survivesKoAtFullHpFromOpponentThenDiscard: true },
};

/** Deluxe Bomb (Tool, ACE SPEC). */
const DELUXE_BOMB: CardProgram = { passive: { damageAttackerActiveThenDiscard: 120 } };

/** Lucky Helmet (Tool). */
const LUCKY_HELMET: CardProgram = {
  triggered: [
    {
      name: "Lucky Helmet",
      trigger: "onDamagedByAttack",
      program: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/** Handheld Fan (Tool). */
const HANDHELD_FAN: CardProgram = {
  triggered: [
    {
      name: "Handheld Fan",
      trigger: "onDamagedByAttack",
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "anyEnergy" },
          max: 1,
          route: "selfToBench",
          side: "opponent",
        },
      ],
    },
  ],
};

/** Jamming Tower (Stadium): Pokémon Tools attached to each Pokémon have no effect. */
const JAMMING_TOWER: CardProgram = { stadium: { toolsHaveNoEffect: true } };

/** Festival Grounds (Stadium). */
const FESTIVAL_GROUNDS: CardProgram = { stadium: { statusShieldIfEnergyAttached: true } };

/** Eevee ex — "Rainbow DNA". */
const RAINBOW_DNA: CardProgram = {
  passive: { evolveAsNamed: { name: "Eevee", intoSuffix: "ex" } },
};

/** Noivern — "Tuning Echo". */
const TUNING_ECHO: CardProgram = {
  passive: {
    attackCostClause: {
      attack: "Frightening Howl",
      gate: { kind: "costWaivedIf", condition: { kind: "handSizesEqual" } },
    },
  },
};

/** Kyurem — "Plasma Bane". */
const PLASMA_BANE: CardProgram = {
  passive: {
    attackCostClause: {
      attack: "Trifrost",
      gate: {
        kind: "alternateCostIf",
        condition: { kind: "opponentDiscardHasNameContaining", fragment: "Colress" },
        cost: ["Colorless"],
      },
    },
  },
};

/** Feraligatr — "Torrential Heart". */
const TORRENTIAL_HEART: CardProgram = {
  abilities: [
    activated({
      name: "Torrential Heart",
      program: [
        { op: "damageSelf", amount: 50, on: "source", source: "ability" },
        { op: "boostAttack", attack: null, amount: 120, holder: "source", thisTurn: true },
      ],
    }),
  ],
};

/** Palafin ex — "Hero's Spirit": can be put into play only with Palafin's Zero to Hero. */
const HEROS_SPIRIT: CardProgram = { intoPlayOnlyVia: "Zero to Hero" };

/** Misty's Psyduck — "Flustered Leap". */
const FLUSTERED_LEAP: CardProgram = {
  abilities: [
    activated({
      name: "Flustered Leap",
      benchOnly: true,
      program: [
        { op: "discardDeckBottom", count: 1, recordAs: "moved" },
        {
          op: "recordGate",
          slot: "moved",
          ops: [{ op: "returnSelf", dest: "deckTop", attachmentsTo: "discard" }],
        },
      ],
    }),
  ],
};

/** Team Rocket's Orbeetle — "Rocket Brain". */
const ROCKET_BRAIN: CardProgram = {
  abilities: [
    {
      name: "Rocket Brain",
      oncePerTurn: false,
      activeOnly: false,
      program: [{ op: "moveCounterOwnChosen", ownerPokemon: "Team Rocket" }],
    },
  ],
};

/** Ruffian: discard a Pokémon Tool and a Special Energy from 1 of your opponent's Pokémon. */
const RUFFIAN: CardProgram = { trainer: [{ op: "discardToolAndSpecialEnergyChosen" }] };

/** Farfetch'd — "Impromptu Carrier". */
const IMPROMPTU_CARRIER: CardProgram = {
  triggered: [
    {
      name: "Impromptu Carrier",
      trigger: "onPlayToBench",
      program: searchThenShuffle({ filter: { kind: "toolCard" }, dest: "attachToSelf", max: 1 }),
    },
  ],
};

/** Palafin — "Zero to Hero". */
const ZERO_TO_HERO: CardProgram = {
  triggered: [
    {
      name: "Zero to Hero",
      trigger: "onActiveMovedToBench",
      oncePerTurn: true,
      program: [{ op: "switchWithDeckNamed", name: "Palafin ex" }],
    },
  ],
};

/** Brock's Scouting: search for up to 2 Basic Pokémon or 1 Evolution Pokémon. */
const BROCKS_SCOUTING: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "basicPokemon" },
    max: 2,
    dest: "hand",
    reveal: true,
    orElse: { filter: { kind: "evolutionPokemon" }, max: 1 },
  }),
};

/** Ogre's Mask. */
const OGRES_MASK: CardProgram = {
  trainer: [
    {
      op: "switchWithDiscardNamed",
      filter: { kind: "pokemonNameContaining", fragment: "Ogerpon", suffix: "ex" },
    },
  ],
};

/** Heavy Baton (Tool). */
const HEAVY_BATON: CardProgram = {
  triggered: [
    {
      name: "Heavy Baton",
      trigger: "onHolderActiveKnockedOut",
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "basicEnergy" },
          max: 3,
          route: "selfToBench",
          anyDest: true,
        },
      ],
    },
  ],
};

/** Amulet of Hope (Tool). */
const AMULET_OF_HOPE: CardProgram = {
  triggered: [
    {
      name: "Amulet of Hope",
      trigger: "onHolderKnockedOut",
      program: searchThenShuffle({ filter: { kind: "anyCard" }, max: 3, dest: "hand" }),
    },
  ],
};

/** Powerglass (Tool). */
const POWERGLASS: CardProgram = {
  triggered: [
    {
      name: "Powerglass",
      trigger: "atEndOfYourTurnInActive",
      program: [{ op: "attachEnergyFrom", source: "discard", toSelf: true, declinable: true }],
    },
  ],
};

/** Team Rocket's Watchtower (Stadium): {C} Pokémon in play have no Abilities. */
const TEAM_ROCKETS_WATCHTOWER: CardProgram = {
  stadium: { disableAbilities: { side: "both", targetType: "Colorless" } },
};

/** Redeemable Ticket. */
const REDEEMABLE_TICKET: CardProgram = {
  trainer: [{ op: "cycleOwnPrizes" }],
};

/** Accompanying Flute. */
const ACCOMPANYING_FLUTE: CardProgram = {
  trainer: [
    {
      op: "lookAtTopN",
      n: 5,
      filter: { kind: "basicPokemon" },
      max: "any",
      dest: "bench",
      reveal: true,
      whose: "opponent",
    },
    { op: "shuffleDeck", whose: "opponent" },
  ],
};

/** Team Rocket's Bother-Bot. */
const TEAM_ROCKETS_BOTHER_BOT: CardProgram = {
  trainer: [
    { op: "turnPrizeFaceUp", side: "opponent", recordAs: "turnedPrize" },
    { op: "randomFromOpponentHand", to: "reveal", recordAs: "revealed" },
    {
      op: "recordGate",
      slot: "turnedPrize",
      ops: [
        {
          op: "recordGate",
          slot: "revealed",
          ops: [
            {
              op: "optional",
              note: "You may have your opponent switch the revealed card with the Prize card you turned face up.",
              ops: [{ op: "swapTurnedPrizeWithRevealed" }],
            },
          ],
        },
      ],
    },
  ],
};

/** Grand Tree (Stadium, ACE SPEC). */
const GRAND_TREE: CardProgram = {
  stadium: {
    ability: {
      label: "Grand Tree",
      program: [
        {
          op: "evolveFromDeckChosen",
          bodyStage: "Basic",
          evolveTimingGates: true,
          thenEvolveAgain: true,
        },
        { op: "shuffleDeck" },
      ],
    },
  },
};

/** Sparkling Crystal (Tool). */
const SPARKLING_CRYSTAL: CardProgram = {
  passive: {
    attackCostDiscount: {
      amount: 1,
      holder: { kind: "bannerPokemon", banner: "Tera" },
      anyType: true,
    },
  },
};

/** Tera Orb: search your deck for a Tera Pokémon and put it into your hand. */
const TERA_ORB: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "bannerPokemon", banner: "Tera" },
    dest: "hand",
    max: 1,
    reveal: true,
  }),
};

/** Glass Trumpet: usable only if you have a Tera Pokémon in play. */
const GLASS_TRUMPET: CardProgram = {
  trainer: [
    {
      op: "attachFromDiscard",
      filter: { kind: "basicEnergy" },
      max: 2,
      maxPerTarget: 1,
      targetType: "Colorless",
      benchOnly: true,
    },
  ],
  trainerPlayableIf: { kind: "yourBannerPokemonInPlay", banner: "Tera" },
};

/** Briar: usable only if your opponent has exactly 2 Prize cards remaining. */
const BRIAR: CardProgram = {
  trainer: [],
  trainerPlayableIf: { kind: "opponentPrizesRemaining", counts: [2] },
  supporterKoPrizeBonus: { amount: 1, attacker: { kind: "bannerPokemon", banner: "Tera" } },
};

/** Milotic ex — "Sparkling Scales". */
const SPARKLING_SCALES: CardProgram = {
  passive: { preventDamageAndEffectsFromBanner: "Tera" },
};

/** Noctowl — "Jewel Seeker". */
const JEWEL_SEEKER: CardProgram = {
  triggered: [
    {
      name: "Jewel Seeker",
      trigger: "onEvolve",
      program: [
        {
          op: "conditionGate",
          cond: { kind: "yourBannerPokemonInPlay", banner: "Tera" },
          ops: searchThenShuffle({
            filter: { kind: "trainerCard" },
            dest: "hand",
            max: 2,
            reveal: true,
          }),
        },
      ],
    },
  ],
};

/** Azumarill — "Glistening Bubbles": with a Tera Pokémon in play, Double-Edge costs {P}. */
const GLISTENING_BUBBLES: CardProgram = {
  passive: {
    attackCostClause: {
      attack: "Double-Edge",
      gate: {
        kind: "alternateCostIf",
        condition: { kind: "yourBannerPokemonInPlay", banner: "Tera" },
        cost: ["Psychic"],
      },
    },
  },
};

/** Terapagos — "Prism Charge". */
const PRISM_CHARGE: CardProgram = {
  attack: {
    0: [
      {
        op: "attachFromDeck",
        filter: { kind: "basicEnergy" },
        max: 3,
        distinctEnergyTypes: true,
        targetBanner: "Tera",
      },
      { op: "shuffleDeck" },
    ],
  },
};

/** Miraidon — "Peak Acceleration". */
const PEAK_ACCELERATION: CardProgram = {
  attack: {
    0: [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2, targetBanner: "Future" },
      { op: "shuffleDeck" },
    ],
  },
};

/** Great Tusk — "Land Collapse". */
const LAND_COLLAPSE: CardProgram = {
  attack: {
    0: [
      { op: "discardDeckTop", whose: "opponent", count: 1 },
      {
        op: "conditionGate",
        cond: { kind: "yourPlayedBannerSupporterThisTurn", banner: "Ancient" },
        ops: [{ op: "discardDeckTop", whose: "opponent", count: 3 }],
      },
    ],
  },
};

/** Scream Tail — "Supportive Singing": heal 100 damage from 1 of your Benched Ancient Pokémon. */
const SUPPORTIVE_SINGING: CardProgram = {
  attack: {
    0: [
      {
        op: "healChosen",
        amount: 100,
        zone: "bench",
        filter: { kind: "bannerPokemon", banner: "Ancient" },
      },
    ],
  },
};

/** Flutter Mane — "Perplexing Transfer". */
const PERPLEXING_TRANSFER: CardProgram = {
  attack: {
    0: [{ op: "moveCountersToDefender", filter: { kind: "bannerPokemon", banner: "Ancient" } }],
  },
};

/** Iron Crown ex — "Cobalt Command". */
const COBALT_COMMAND: CardProgram = {
  passive: {
    seatDamageBonusBeforeWR: {
      amount: 20,
      beneficiary: { kind: "bannerPokemon", banner: "Future" },
      exceptName: "Iron Crown ex",
    },
  },
};

/** Awakening Drum: draw a card for each of your Ancient Pokémon in play. */
const AWAKENING_DRUM: CardProgram = {
  trainer: [
    {
      op: "drawCards",
      count: 1,
      per: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "bannerPokemon", banner: "Ancient" },
      },
    },
  ],
};

/** Reboot Pod: attach a Basic Energy from your discard pile to each of your Future Pokémon. */
const REBOOT_POD: CardProgram = {
  trainer: [
    {
      op: "attachFromDiscard",
      filter: { kind: "basicEnergy" },
      max: 1,
      targetBanner: "Future",
      each: true,
    },
  ],
};

/** Festival Lead (Ability) on Dipplin, Goldeen, Swirlix and others. */
const FESTIVAL_LEAD: CardProgram = {
  passive: { attackTwiceIf: { kind: "stadiumInPlayNamed", name: "Festival Grounds" } },
};

/** Iron Thorns — "Destructo-Press". */
const DESTRUCTO_PRESS: CardProgram = {
  attack: {
    0: [
      {
        op: "revealTopDiscardMatching",
        n: 5,
        filter: { kind: "bannerCard", banner: "Future" },
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 70, count: "discarded" },
    ],
  },
};

/** Ignition Energy (Special Energy): discarded at the end of your turn. */
const IGNITION_ENERGY: CardProgram = {
  energy: {
    provides: ["Colorless"],
    promoteOnHolderStage: { stage: "Evolution", units: ["Colorless", "Colorless", "Colorless"] },
    discardAtEndOfYourTurn: true,
  },
};

/** Munkidori — "Adrena-Brain". */
const ADRENA_BRAIN: CardProgram = {
  abilities: [
    activated({
      name: "Adrena-Brain",
      requiresEnergyType: "Darkness",
      program: [{ op: "moveCountersToOpponentChosen", upTo: 3 }],
    }),
  ],
};

/**
 * Milotic — "Mentally Calm": your opponent's Pokémon in play and attached cards can't be put into
 * their hand.
 */
const MENTALLY_CALM: CardProgram = { passive: { opponentInPlayToHandBlocked: true } };

/** Huntail — "Diver's Catch". */
const DIVERS_CATCH: CardProgram = { passive: { koBasicEnergyToHand: "Water" } };

/** Klinklang — "Emergency Rotation". */
const EMERGENCY_ROTATION: CardProgram = {
  benchFromHand: {
    name: "Emergency Rotation",
    playableIf: { kind: "opponentStage2PokemonInPlay" },
  },
};

// Antique Fossils: Items played onto the Bench as 60-HP Basic {C} Pokémon via `playAsPokemon`.

/** Antique Cover Fossil — "Protective Cover". */
const PROTECTIVE_COVER: CardProgram = {
  playAsPokemon: true,
  passive: { preventAttackEffects: true },
};

/**
 * Antique Root Fossil — "Primal Root": while Active, attacks used by your opponent's Basic Pokémon
 * cost {C} more.
 */
const PRIMAL_ROOT: CardProgram = {
  playAsPokemon: true,
  passive: {
    opponentActiveAttackCostSurcharge: 1,
    opponentActiveAttackCostSurchargeBasicOnly: true,
  },
};

/**
 * Antique Plume Fossil — "Plume Protection": while on your Bench, prevent all damage done to it by
 * attacks.
 */
const PLUME_PROTECTION: CardProgram = {
  playAsPokemon: true,
  passive: { preventDamageWhileBenched: true },
};

/** Antique Jaw Fossil `me03-068` — "Intimidating Jaw": Pyroar `me01-024` "Intimidating Fang"'s sentence word for
    word (*"As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 30
    less damage (before applying Weakness and Resistance)."*) — `INTIMIDATING_FANG`'s field. */
const INTIMIDATING_JAW: CardProgram = {
  playAsPokemon: true,
  passive: { opponentActiveAttackDebuff: 30 },
};

/** Antique Sail Fossil `me03-069` — "Protective Sail": *"Whenever your opponent plays a Supporter card from their
    hand, prevent all effects of that card done to this Pokémon."* — the NEW `preventSupporterEffects` (Fraxure
    "Unnerve" without its Item half). */
const PROTECTIVE_SAIL: CardProgram = {
  playAsPokemon: true,
  passive: { preventSupporterEffects: true },
};

/** Antique Armor Fossil `me05-072` — "Protective Armor": *"As long as this Pokémon is in the Active Spot, all of
    your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and
    Resistance)."* — Hariyama `sv02-113` "Arm Thrust Practice"'s `seatDamageReductionAfterWR` with the NEW `sourceActive` rider. */
const PROTECTIVE_ARMOR: CardProgram = {
  playAsPokemon: true,
  passive: { seatDamageReductionAfterWR: { amount: 10, sourceActive: true } },
};

/** Antique Skull Fossil — "Spiny Skull". */
const SPINY_SKULL: CardProgram = {
  playAsPokemon: true,
  passive: { damageAttacker: { amount: 30 } },
};

/** Cinccino ex `me04-073` / `-105` / `-119` — "Smooth Coat": Kecleon `sv08-150` "Expert Hider"'s
    sentence word for word ("If any damage is done to this Pokémon by attacks, flip a coin. If
    heads, prevent that damage."); `EXPERT_HIDER`'s field under the printed name, which the
    `ABILITY_COIN_FLIP` row logs. */
const SMOOTH_COAT: CardProgram = {
  passive: { preventDamageOnCoinFlip: { ability: "Smooth Coat" } },
};

/** Turtonator `me03-017` — "Shell Spikes": Klawf ex `sv03-120` "Counterattacking Pincer"'s
    sentence word for word; `COUNTERATTACKING_PINCER`'s trigger under the printed name (`from:
    "attacker"`: the Energy comes off the Attacking Pokémon, not the Pokémon an attack's own
    switch promoted). */
const SHELL_SPIKES: CardProgram = {
  triggered: [
    {
      name: "Shell Spikes",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: [{ op: "discardEnergy", from: "attacker", filter: { kind: "anyEnergy" } }],
    },
  ],
};

/** Heatran and Numel — "Incandescent Body", the same sentence as Armarouge's "Scorching Armor". */
const INCANDESCENT_BODY: CardProgram = {
  triggered: [
    {
      name: "Incandescent Body",
      trigger: "onDamagedByAttack",
      activeOnly: true,
      program: [{ op: "applyStatus", target: "attacker", status: "burned" }],
    },
  ],
};

/** Toucannon `me05-068` / `-094` — "Aerial Draw": *"Once during your turn, you may use this
    Ability. Draw a card."* — Rapidash `sv10-030` "Hurried Gait" (*"…you may draw a card."*) in the
    `me` wording; `HURRIED_GAIT`'s program under the printed name (`useAbility` matches it). */
const AERIAL_DRAW: CardProgram = {
  abilities: [
    activated({
      name: "Aerial Draw",
      program: [{ op: "drawCards", count: 1 }],
    }),
  ],
};

/** Nidorina `mep-101` / `30th-088` — "Share Happiness": *"Once during your turn, you may use this
    Ability. Heal 30 damage from 1 of your Pokémon."* — Alcremie ex `sv09-075` "Confectionary
    Gift" in the `me` wording; `CONFECTIONARY_GIFT`'s program under the printed name. */
const SHARE_HAPPINESS: CardProgram = {
  abilities: [
    activated({
      name: "Share Happiness",
      program: [{ op: "healChosen", amount: 30 }],
    }),
  ],
};

/** Pyroar `me01-024` — "Intimidating Fang": Entei `sv03-030` "Pressure" with 30 for 20 (*"…do 30
    less damage (before applying Weakness and Resistance)."*). `PRESSURE`'s field at the printed
    number; nameless, like its twin. */
const INTIMIDATING_FANG: CardProgram = { passive: { opponentActiveAttackDebuff: 30 } };

/** Slowpoke `mep-086` — "Dopey Face": *"This Pokémon can't be Confused."* — Pachirisu `sv01-068`
    "Electricity Pouches" with one `StatusName` changed (Hoothoot's `INSOMNIA` idiom). */
const DOPEY_FACE: CardProgram = { passive: { statusImmunities: ["confused"] } };

/** Drifloon `30th-073` / `-136` — "Float Up" (attack index **0**, 20 damage): Gholdengo
    `sv08-131` "Surf Back"'s sentence (*"You may shuffle this Pokémon and all attached cards into
    your deck."*) at index 0, where `SURF_BACK` authors index 1 (index precision: the alias would
    leave index 0 unsimulated). The attack NAME is the card's, read off its row. */
const FLOAT_UP: CardProgram = {
  attack: {
    0: [
      {
        op: "optional",
        note: "You may shuffle this Pokémon and all attached cards into your deck.",
        ops: [{ op: "returnSelf", dest: "deck" }],
      },
    ],
  },
};

/** Aurorus `me03-024` / `-092` — "Tundra Wall": *"All of your Pokémon that have any {W} Energy
    attached take 50 less damage from attacks from your opponent's Pokémon (after applying Weakness
    and Resistance). The effect of Tundra Wall doesn't stack."* Klinklang's `GEAR_COATING` at {W}
    and 50, plus the printed `noStack` (the `seatDamageReduction` ledger caps two Aurorus at 50). */
const TUNDRA_WALL: CardProgram = {
  passive: {
    seatDamageReductionAfterWR: {
      amount: 50,
      beneficiaryHasEnergy: "Water",
      noStack: "Tundra Wall",
    },
  },
};

/** Dewgong `me03-019` — "Wash Out": *"As often as you like during your turn, you may use this
    Ability. Move a {W} Energy from 1 of your Benched Pokémon to your Active Pokémon."* Armarouge
    `sv01-041` "Fire Off" (`ARMAROUGE`) with {W} for {R}, under the printed name. */
const WASH_OUT: CardProgram = {
  abilities: [
    {
      name: "Wash Out",
      oncePerTurn: false,
      activeOnly: false,
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "providesEnergy", energyType: "Water" },
          max: 1,
          route: "benchToActive",
        },
      ],
    },
  ],
};

/** Garganacl `me01-084` / `-147` — "Powerful a-Salt": *"Attacks used by your {F} Pokémon do 30
    more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."*
    Victini `sv08-021` "Victory Cheer" (`VICTORY_CHEER`) at 30, its beneficiary without the stage. */
const POWERFUL_A_SALT: CardProgram = {
  passive: {
    seatDamageBonusBeforeWR: {
      amount: 30,
      beneficiary: { kind: "typedPokemon", pokemonType: "Fighting" },
    },
  },
};

/** Mega Scrafty ex — "Counterattacking Crest": Counterattack Quills with 5 damage counters. */
const COUNTERATTACKING_CREST: CardProgram = { passive: { damageAttacker: { amount: 50 } } };

/** Barbaracle `mep-065` / `me03-043` — "Stone Arms": *"Once during your turn, you may use this
    Ability. Attach a Basic {F} Energy card from your hand to 1 of your {F} Pokémon."* Quaquaval
    `sv01-054` "Energy Carnival" (`QUAQUAVAL`) with the printed {F} on the card and on the target
    (`targetType`, Gardevoir ex's rider). */
const STONE_ARMS: CardProgram = {
  abilities: [
    activated({
      name: "Stone Arms",
      program: [
        { op: "attachEnergyFrom", source: "hand", energyType: "Fighting", targetType: "Fighting" },
      ],
    }),
  ],
};

/** Aromatisse `me03-036` — "Scent Collection": *"Once during your turn, you may use this Ability.
    Search your deck for up to 2 Basic {P} Energy cards, reveal them, and put them into your hand.
    Then, shuffle your deck."* Chien-Pao ex `sv02-061` "Shivery Chill" (`CHIEN_PAO`'s Ability) with
    {P} for {W} and without its Active Spot clause. */
const SCENT_COLLECTION: CardProgram = {
  abilities: [
    activated({
      name: "Scent Collection",
      program: searchThenShuffle({
        filter: { kind: "basicEnergy", energyType: "Psychic" },
        dest: "hand",
        max: 2,
        reveal: true,
      }),
    }),
  ],
};

/** Mega Dragonite ex `me02.5-152` / `-271` / `-290` / `-295`, `mep-091` — "Sky Transport": *"Once
    during your turn, you may use this Ability. Switch your Active Pokémon with 1 of your Benched
    Pokémon."* Samurott `sv10.5w-023` "Torrential Whirlpool"'s first sentence (`switchActive`),
    without its "If you do" rider. */
const SKY_TRANSPORT: CardProgram = {
  abilities: [
    activated({
      name: "Sky Transport",
      program: [{ op: "switchActive" }],
    }),
  ],
};

/** Ampharos `me04-029` / `-090`, `mep-075` — "Synchro Pulse": *"If you have the same number of
    cards in your hand as your opponent, attacks used by this Pokémon do 80 more damage to your
    opponent's Active Pokémon (before applying Weakness and Resistance)."* Okidogi's
    `damageBonusBeforeWRIf` (folded off the attacker alone: "this Pokémon") at 80, on Noivern
    `sv09-128`'s printed condition `handSizesEqual`. */
const SYNCHRO_PULSE: CardProgram = {
  passive: { damageBonusBeforeWRIf: { amount: 80, cond: { kind: "handSizesEqual" } } },
};

/** Carbink — "Double Type": as long as this Pokémon is in play, it is {F} and {P} type. */
const DOUBLE_TYPE_FP: CardProgram = { passive: { typesInPlay: ["Fighting", "Psychic"] } };

/** Wondrous Patch `me02-094` / `me03-117` (Item) — *"Attach a Basic {P} Energy card from your
    discard pile to 1 of your Benched {P} Pokémon."* N's PP Up `sv09-153` (`NS_PP_UP`) with the
    printed {P} on the card (`energyType`) and on the target (`targetType` for `ownerPokemon`).
    `attachEnergyFrom` rather than Glass Trumpet's `attachFromDiscard`: the sentence is N's PP Up's
    ("to 1 of your …"), not Glass Trumpet's "to each of them". No {P} in the discard or no Benched
    {P} body refuses the Item (`attachAlternativesAllWhiff`). */
const WONDROUS_PATCH: CardProgram = {
  trainer: [
    {
      op: "attachEnergyFrom",
      source: "discard",
      energyType: "Psychic",
      targetType: "Psychic",
      benchOnly: true,
    },
  ],
};

/**
 * Philippe — "Attach up to 2 Basic {M} Energy cards from your discard pile to 1 of your {M}
 * Pokémon." The batch goes to one chosen body, and "up to" lets the player attach 0, 1 or 2.
 */
const PHILIPPE: CardProgram = {
  trainer: [
    {
      op: "attachEnergyFrom",
      source: "discard",
      energyType: "Metal",
      targetType: "Metal",
      count: 2,
    },
  ],
};

/**
 * Jacinthe — "Heal 150 damage from 1 of your {P} Pokémon." The filter reads the in-play type, so a
 * Double Type {P} counts. No {P} Pokémon in play refuses the Supporter.
 */
const JACINTHE: CardProgram = {
  trainer: [
    { op: "healChosen", amount: 150, filter: { kind: "typedPokemon", pokemonType: "Psychic" } },
  ],
};

/**
 * Firebreather — "Search your deck for up to 7 Basic {R} Energy cards, reveal them, and put them
 * into your hand. Then, shuffle your deck."
 */
const FIREBREATHER: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "basicEnergy", energyType: "Fire" },
    dest: "hand",
    max: 7,
    reveal: true,
  }),
};

/** Fighting Gong `me01-116` / `-168`, `me02.5-187` (Item) — *"Search your deck for a Basic {F}
    Energy card or a Basic {F} Pokémon, reveal it, and put it into your hand. Then, shuffle your
    deck."* Ethan's Adventure `sv10-165` (`ETHANS_ADVENTURE`)'s `anyOf` search at `max: 1`, its two
    nouns in the printed order: a Basic {F} Energy card, a BASIC {F} Pokémon (`typedPokemon`
    `stage: "basic"` — a Stage 1 {F} is not offered). */
const FIGHTING_GONG: CardProgram = {
  trainer: searchThenShuffle({
    filter: {
      kind: "anyOf",
      filters: [
        { kind: "basicEnergy", energyType: "Fighting" },
        { kind: "typedPokemon", pokemonType: "Fighting", stage: "basic" },
      ],
    },
    dest: "hand",
    max: 1,
    reveal: true,
  }),
};

/** Tarragon `me03-085` / `-116` (Supporter) — *"Put up to 4 in any combination of {F} Pokémon and
    Basic {F} Energy cards from your discard pile into your hand."* Max Rod `sv08.5-116`
    (`MAX_ROD`) at 4 and typed. `pokemonOrBasicEnergy` takes no type, so the typed pair is Lana's
    Aid's `anyOf` (`LANAS_AID`) with `typedPokemon` / `basicEnergy` at {F}; any stage. An empty
    match in the discard refuses the Supporter (`trainerProgramPlayable`). */
const TARRAGON: CardProgram = {
  trainer: [
    {
      op: "discardPileRetrieval",
      filter: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Fighting" },
          { kind: "basicEnergy", energyType: "Fighting" },
        ],
      },
      dest: "hand",
      max: 4,
    },
  ],
};

/** Poké Pad `me02.5-198`, `me03-081` / `-113` (Item) — *"Search your deck for a Pokémon that
    doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck.
    (Pokémon ex, Pokémon V, etc. have Rule Boxes.)"* Master Ball `sv05-153` (`MASTER_BALL`) with
    Lana's Aid's `noRuleBox` on `anyPokemon` (any stage; a Mega Evolution Pokémon ex is an "ex",
    `hasRuleBox`). `30th-126` is keyed by id: its "doesn’t" keeps its print_key apart. */
const POKE_PAD: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "anyPokemon", noRuleBox: true },
    dest: "hand",
    max: 1,
    reveal: true,
  }),
};

/** Energy Swatter `me03-073` (Item) — *"Your opponent reveals their hand, and you choose an Energy
    card you find there and put it on the bottom of their deck."* Ortega `sv03-190` (`ORTEGA`)'s
    first op with an `anyEnergy` filter (Greavard's `supporter` one member over) and without the
    "in this way … may draw" sentence, so no `recordAs` and no gate. An empty opponent hand refuses
    the Item; a hand with no Energy reveals and whiffs (the filtered-op rule in `programPlayable`). */
const ENERGY_SWATTER: CardProgram = {
  trainer: [{ op: "bottomFromOpponentHand", filter: { kind: "anyEnergy" } }],
};

/**
 * Repel — "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new
 * Active Pokémon.)" An empty opposing Bench refuses the play.
 */
const REPEL: CardProgram = { trainer: [{ op: "opponentSwitchOut" }] };

/** Canari `me02.5-185` / `-257` / `-291` (Supporter) — *"You can use this card only if you discard
    another card from your hand. / Search your deck for up to 4 {L} Pokémon, reveal them, and put
    them into your hand. Then, shuffle your deck."* Earthen Vessel `sv06.5-096` (`EARTHEN_VESSEL`)'s
    hand cost, then the search `deriveAttackEffect` reads off the second paragraph (`typedPokemon`
    Lightning, any stage, 4). */
const CANARI: CardProgram = {
  trainer: [
    { op: "payFromHand", count: 1, to: "discard" },
    ...searchThenShuffle({
      filter: { kind: "typedPokemon", pokemonType: "Lightning" },
      dest: "hand",
      max: 4,
      reveal: true,
    }),
  ],
};

/** Lillie's Determination `me01-119` / `-169` / `-184`, `me02.5-192` (Supporter) — *"Shuffle your
    hand into your deck. Then, draw 6 cards. If you have exactly 6 Prize cards remaining, draw 8
    cards instead."* Lacey `sv07-139` (`LACEY`)'s if/else refresh on the seat mirror
    `yourPrizesRemaining` at the printed exactly 6, drawing 8 or 6. */
const LILLIES_DETERMINATION: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "yourPrizesRemaining", counts: [6] },
      ops: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 8 } }],
      otherwise: [{ op: "handRefresh", who: "you", draw: { kind: "fixed", count: 6 } }],
    },
  ],
};

/**
 * Misty's Vitality — search up to 4 Basic {W} Energy and attach them to 1 of your Pokémon, shuffle,
 * then the turn ends.
 */
const MISTYS_VITALITY: CardProgram = {
  trainer: [
    {
      op: "attachFromDeck",
      filter: { kind: "basicEnergy", energyType: "Water" },
      max: 4,
      oneTarget: true,
    },
    { op: "shuffleDeck" },
  ],
  trainerEndsTurn: true,
};

/** Rosa's Encouragement `me03-084` / `-114` / `-123` (Supporter) — *"You can use this card only if
    you have more Prize cards remaining than your opponent. / Attach up to 2 Basic Energy cards
    from your discard pile to 1 of your Stage 2 Pokémon."* Fighting Au Lait's play gate
    (`morePrizesThanOpponent`) over Oricorio "Energy Assist"'s derived `attachEnergyFrom` (`count:
    2`, any Basic Energy) with the NEW `stage2Only` rider. No Stage 2 in play, or no Basic Energy in
    the discard, refuses the Supporter (`attachAlternativesAllWhiff`). */
const ROSAS_ENCOURAGEMENT: CardProgram = {
  trainerPlayableIf: { kind: "morePrizesThanOpponent" },
  trainer: [{ op: "attachEnergyFrom", source: "discard", count: 2, stage2Only: true }],
};

/** Rust Syndicate Grunt `me05-081` / `-112` (Supporter) — *"You can use this card only if any of
    your Pokémon were Knocked Out during your opponent's last turn. / Discard an Energy from 1 of
    your opponent's Pokémon."* Hassel's play gate (`yourPokemonKoedOnOpponentsLastTurn`) over
    Crushing Hammer's heads op without the coin (`opponentChosen`, `anyEnergy`). An Energy-less
    opponent board refuses it (`discardEnergyPlayable`). */
const RUST_SYNDICATE_GRUNT: CardProgram = {
  trainerPlayableIf: { kind: "yourPokemonKoedOnOpponentsLastTurn" },
  trainer: [{ op: "discardEnergy", from: "opponentChosen", filter: { kind: "anyEnergy" } }],
};

/** Waitress `me02.5-215` (Supporter) — *"Look at the top 6 cards of your deck and attach a Basic
    Energy card you find there to 1 of your Pokémon. Shuffle the other cards back into your deck."*
    Electric Generator `sv01-170` (`ELECTRIC_GENERATOR`)'s `attachFromTop` at 6 / 1, any Basic
    Energy, no target rider, and its trailing shuffle. */
const WAITRESS: CardProgram = {
  trainer: [
    { op: "attachFromTop", n: 6, filter: { kind: "basicEnergy" }, max: 1 },
    { op: "shuffleDeck" },
  ],
};

/** Hole-Digging Shovel `me03-074` (Item) — *"Discard the top 2 cards of your deck."* The sentence
    `deriveAttackEffect` reads, byte for byte, on the Trainer surface. */
const HOLE_DIGGING_SHOVEL: CardProgram = {
  trainer: [{ op: "discardDeckTop", whose: "self", count: 2 }],
};

/**
 * Lumiose Galette — heal 20 from your Active, then remove one Special Condition of the player's
 * choice.
 */
const LUMIOSE_GALETTE: CardProgram = {
  trainer: [{ op: "heal", target: "self", amount: 20 }, { op: "recoverOneStatus" }],
};

/**
 * Anthea & Concordia — playable only with all six named N's Pokémon in play; this turn, a KO of the
 * opponent's Active by an N's Pokémon's attack takes 3 more Prizes. The gate is checked at play
 * only: a named Pokémon leaving play later does not withdraw the bonus.
 */
const ANTHEA_AND_CONCORDIA: CardProgram = {
  trainer: [],
  trainerPlayableIf: {
    kind: "allOf",
    conditions: [
      { kind: "yourNamedPokemonInPlay", name: "N's Darmanitan" },
      { kind: "yourNamedPokemonInPlay", name: "N's Zoroark ex" },
      { kind: "yourNamedPokemonInPlay", name: "N's Vanilluxe" },
      { kind: "yourNamedPokemonInPlay", name: "N's Klinklang" },
      { kind: "yourNamedPokemonInPlay", name: "N's Reshiram" },
      { kind: "yourNamedPokemonInPlay", name: "N's Zekrom" },
    ],
  },
  supporterKoPrizeBonus: { amount: 3, attacker: { kind: "ownerPokemon", owner: "N" } },
};

/**
 * Emma — the opponent reveals their hand and you draw 1 per Pokémon card in it. A fossil Item is a
 * Trainer and is not counted; an empty hand still reveals and draws 0.
 */
const EMMA: CardProgram = {
  trainer: [
    { op: "revealOpponentHand" },
    {
      op: "drawCards",
      count: 1,
      per: { kind: "cardsInOpponentHand", filter: { kind: "anyPokemon" } },
    },
  ],
};

/** Pokémon Center Lady `me01-123` (Supporter) — *"Heal 60 damage from 1 of your Pokémon, and it
    recovers from all Special Conditions."* `healChosen` 60 with the NEW `recoverHealed`: a picked
    Active also recovers from every Special Condition (`clearStatus`); a Benched body has none. The
    recovery does not wait on the heal (an undamaged Active may be picked to cure it). */
const POKEMON_CENTER_LADY: CardProgram = {
  trainer: [{ op: "healChosen", amount: 60, recoverHealed: true }],
};

/**
 * AZ's Tranquility — switch your Active with a Benched Pokémon; if the moved Pokémon is a Pokémon
 * ex, heal 80 from it. The ex test reads the card that was moved, so a Pokémon swapped for an ex on
 * the Bench afterwards is not healed. An empty Bench refuses the play.
 */
const AZS_TRANQUILITY: CardProgram = {
  trainer: [
    { op: "switchActive", recordAs: "moved", recordDemoted: true, demotedAsMoved: true },
    {
      op: "recordGate",
      slot: "moved",
      ops: [
        {
          op: "healChosen",
          amount: 80,
          targetRecorded: "moved",
          filter: { kind: "suffixPokemon", suffix: "ex" },
        },
      ],
    },
  ],
};

/**
 * Grimsley's Move — look at the top 7, put a {D} Basic onto the Bench, shuffle the rest under the
 * deck. Not usable during your first turn.
 */
const GRIMSLEYS_MOVE: CardProgram = {
  trainer: [
    {
      op: "lookAtTopN",
      n: 7,
      filter: { kind: "typedPokemon", pokemonType: "Darkness" },
      max: 1,
      dest: "bench",
      restTo: "shuffledBottom",
    },
  ],
  trainerPlayableIf: { kind: "notYourFirstTurn" },
};

/**
 * Gwynn — discard up to 2 non-Rule-Box Pokémon from hand, draw 3 per card discarded. Discarding
 * none draws none, and the card stays playable.
 */
const GWYNN: CardProgram = {
  trainer: [
    {
      op: "payFromHand",
      count: "any",
      cap: 2,
      to: "discard",
      filter: { kind: "anyPokemon", noRuleBox: true },
      recordAs: "discarded",
    },
    { op: "drawCards", count: 3, per: { kind: "recorded", slot: "discarded" } },
  ],
};

/**
 * Naveen — optionally discard any number from hand, then draw until 5. Playable only with a
 * non-empty deck; a hand of 5 or more may draw 0.
 */
const NAVEEN: CardProgram = {
  trainer: [
    { op: "payFromHand", count: "any", cap: "any", to: "discard" },
    { op: "drawUntilHandSize", size: 5 },
  ],
  trainerPlayableIf: { kind: "yourDeckNotEmpty" },
};

/**
 * Mega Greninja ex — Mortal Shuriken: from the Active Spot, discard a Basic {W} Energy from hand to
 * place 6 damage counters on 1 of the opponent's Pokémon (no Weakness or Resistance).
 */
const MORTAL_SHURIKEN: CardProgram = {
  abilities: [
    {
      name: "Mortal Shuriken",
      oncePerTurn: true,
      activeOnly: true,
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "basicEnergy", energyType: "Water" },
        },
        { op: "damageChosen", target: "opponentAny", amount: 60, count: 1, source: "ability" },
      ],
    },
  ],
};

// On-evolve Abilities: the `onEvolve` moment is met once by construction, so no `oncePerTurn` key.
// Triggers auto-fire; consequents with a real downside carry an inner `optional` confirm.
// Programs that print "Then, shuffle" shuffle even when the "up to" pick takes nothing.

const PSYCHIC_DRAW_3_TEXT =
  "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 3 cards.";
const PSYCHIC_DRAW_2_TEXT =
  "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 2 cards.";

/** Alakazam — Psychic Draw: draw 3, behind a confirm since a forced draw can deck the owner out. */
const PSYCHIC_DRAW_3: CardProgram = {
  triggered: [
    {
      name: "Psychic Draw",
      trigger: "onEvolve",
      program: [
        {
          op: "optional",
          note: PSYCHIC_DRAW_3_TEXT,
          ops: [{ op: "drawCards", count: 3 }],
        },
      ],
    },
  ],
};

/** Kadabra — Psychic Draw at 2. */
const PSYCHIC_DRAW_2: CardProgram = {
  triggered: [
    {
      name: "Psychic Draw",
      trigger: "onEvolve",
      program: [
        {
          op: "optional",
          note: PSYCHIC_DRAW_2_TEXT,
          ops: [{ op: "drawCards", count: 2 }],
        },
      ],
    },
  ],
};

const PRISON_PANIC_TEXT =
  "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Make your opponent's Active Pokémon Confused.";

/**
 * Brambleghast — Prison Panic: Confuse the opponent's Active. Behind a confirm because
 * `applyStatus` overwrites an existing Asleep or Paralyzed.
 */
const PRISON_PANIC: CardProgram = {
  triggered: [
    {
      name: "Prison Panic",
      trigger: "onEvolve",
      program: [
        {
          op: "optional",
          note: PRISON_PANIC_TEXT,
          ops: [{ op: "applyStatus", target: "defender", status: "confused" }],
        },
      ],
    },
  ],
};

/**
 * Grumpig — Energized Steps: look at the top 4, attach any number of Basic Energy to your Pokémon,
 * shuffle the rest back.
 */
const ENERGIZED_STEPS: CardProgram = {
  triggered: [
    {
      name: "Energized Steps",
      trigger: "onEvolve",
      program: [
        { op: "attachFromTop", n: 4, filter: { kind: "basicEnergy" }, max: "any" },
        { op: "shuffleDeck" },
      ],
    },
  ],
};

/** Hariyama — Heave-Ho Catcher: a declinable `gust`. */
const HEAVE_HO_CATCHER: CardProgram = {
  triggered: [
    {
      name: "Heave-Ho Catcher",
      trigger: "onEvolve",
      program: [{ op: "gust", optional: true }],
    },
  ],
};

/** Ninjask — Cast-Off Shell: search for a Shedinja and put it onto the Bench, then shuffle. */
const CAST_OFF_SHELL: CardProgram = {
  triggered: [
    {
      name: "Cast-Off Shell",
      trigger: "onEvolve",
      program: searchThenShuffle({
        filter: { kind: "byName", name: "Shedinja" },
        dest: "bench",
        max: 1,
      }),
    },
  ],
};

/** Primarina — Enriching Melody: `healChosen` at "all". */
const ENRICHING_MELODY: CardProgram = {
  triggered: [
    {
      name: "Enriching Melody",
      trigger: "onEvolve",
      program: [{ op: "healChosen", amount: "all" }],
    },
  ],
};

/** Silcoon — Multiplying Cocoon: search for a Silcoon or Cascoon onto the Bench, then shuffle. */
const MULTIPLYING_COCOON: CardProgram = {
  triggered: [
    {
      name: "Multiplying Cocoon",
      trigger: "onEvolve",
      program: searchThenShuffle({
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "byName", name: "Silcoon" },
            { kind: "byName", name: "Cascoon" },
          ],
        },
        dest: "bench",
        max: 1,
      }),
    },
  ],
};

/**
 * Tinkatuff — Haphazard Hammer: flip a coin; if heads, discard an Energy from the opponent's
 * Active.
 */
const HAPHAZARD_HAMMER: CardProgram = {
  triggered: [
    {
      name: "Haphazard Hammer",
      trigger: "onEvolve",
      program: [
        {
          op: "coinFlipGate",
          ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
        },
      ],
    },
  ],
};

// Activated Abilities: the once-per-turn lock is `"sharedByName"` where the card prints "You can't
// use more than 1 … Ability each turn", otherwise per Pokémon. The printed "you may use this
// Ability" is the use itself (§9.1), so nothing asks again.

/**
 * Mega Kangaskhan ex — Run Errand: from the Active Spot, draw 2; the name lock stops a second
 * Kangaskhan switched in the same turn.
 */
const RUN_ERRAND: CardProgram = {
  abilities: [
    {
      name: "Run Errand",
      oncePerTurn: "sharedByName",
      activeOnly: true,
      program: [{ op: "drawCards", count: 2 }],
    },
  ],
};

/** Frosmoth — Alluring Wings: from the Active Spot, each player draws a card, controller first. */
const ALLURING_WINGS: CardProgram = {
  abilities: [
    {
      name: "Alluring Wings",
      oncePerTurn: true,
      activeOnly: true,
      program: [{ op: "drawCards", count: 1, who: "eachPlayer" }],
    },
  ],
};

/**
 * Moltres — Fiery Flapping: with Articuno and Zapdos in play (exact names), attach a Basic {R}
 * Energy from hand to this Pokémon. Per Pokémon: no name lock is printed.
 */
const FIERY_FLAPPING: CardProgram = {
  abilities: [
    activated({
      name: "Fiery Flapping",
      playableIf: {
        kind: "allOf",
        conditions: [
          { kind: "yourNamedPokemonInPlay", name: "Articuno" },
          { kind: "yourNamedPokemonInPlay", name: "Zapdos" },
        ],
      },
      program: [{ op: "attachEnergyFrom", source: "hand", energyType: "Fire", toSelf: true }],
    }),
  ],
};

/** Zapdos — Flash-Pop Flapping: Fiery Flapping at {L} over Moltres and Articuno. */
const FLASH_POP_FLAPPING: CardProgram = {
  abilities: [
    activated({
      name: "Flash-Pop Flapping",
      playableIf: {
        kind: "allOf",
        conditions: [
          { kind: "yourNamedPokemonInPlay", name: "Moltres" },
          { kind: "yourNamedPokemonInPlay", name: "Articuno" },
        ],
      },
      program: [{ op: "attachEnergyFrom", source: "hand", energyType: "Lightning", toSelf: true }],
    }),
  ],
};

/** Articuno — Frosty Flapping: Fiery Flapping at {W} over Moltres and Zapdos. */
const FROSTY_FLAPPING: CardProgram = {
  abilities: [
    activated({
      name: "Frosty Flapping",
      playableIf: {
        kind: "allOf",
        conditions: [
          { kind: "yourNamedPokemonInPlay", name: "Moltres" },
          { kind: "yourNamedPokemonInPlay", name: "Zapdos" },
        ],
      },
      program: [{ op: "attachEnergyFrom", source: "hand", energyType: "Water", toSelf: true }],
    }),
  ],
};

/**
 * Lunatone — Lunar Cycle: with Solrock in play, discard a Basic {F} Energy from hand to draw 3;
 * name-locked across copies.
 */
const LUNAR_CYCLE: CardProgram = {
  abilities: [
    {
      name: "Lunar Cycle",
      oncePerTurn: "sharedByName",
      activeOnly: false,
      playableIf: { kind: "yourNamedPokemonInPlay", name: "Solrock" },
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "basicEnergy", energyType: "Fighting" },
        },
        { op: "drawCards", count: 3 },
      ],
    },
  ],
};

/**
 * Delphox — Flaring Magic: discard a Basic {R} Energy from hand, then draw until 7. The cost is
 * paid first so the draw counts the hand after it.
 */
const FLARING_MAGIC: CardProgram = {
  abilities: [
    activated({
      name: "Flaring Magic",
      program: [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "basicEnergy", energyType: "Fire" },
        },
        { op: "drawUntilHandSize", size: 7 },
      ],
    }),
  ],
};

// "Fade Out" and the same sentence under other attack names: "Put this Pokémon and all attached
// cards into your hand." Each is its own object at its printed attack index.

/** Combee — Fade Out (attack index 0): "Put this Pokémon and all attached cards into your hand." */
const FADE_OUT: CardProgram = {
  attack: { 0: [{ op: "returnSelf", dest: "hand" }] },
};

/** Drifblim — Balloon Return (attack index 1). */
const BALLOON_RETURN: CardProgram = {
  attack: { 1: [{ op: "returnSelf", dest: "hand" }] },
};

/**
 * Meowth ex — Tuck Tail (attack index 0) and Last-Ditch Catch: when played to the Bench, search for
 * a Supporter, reveal it, put it in hand, then shuffle. Name-locked across "Last-Ditch" Abilities,
 * and behind a confirm because the shuffle loses a known deck top.
 */
const TUCK_TAIL: CardProgram = {
  attack: { 0: [{ op: "returnSelf", dest: "hand" }] },
  triggered: [
    {
      name: "Last-Ditch Catch",
      trigger: "onPlayToBench",
      oncePerTurn: "sharedByName",
      program: [
        {
          op: "optional",
          note: "You may search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.",
          ops: searchThenShuffle({
            filter: { kind: "supporter" },
            dest: "hand",
            max: 1,
            reveal: true,
          }),
        },
      ],
    },
  ],
};

/** Emolga — Sky Return (attack index 1). */
const SKY_RETURN: CardProgram = {
  attack: { 1: [{ op: "returnSelf", dest: "hand" }] },
};

/**
 * Luxio — Fighting Roar: if the opponent's Active is a Pokémon ex, this Pokémon can evolve during
 * your first turn or the turn it was played. No Active clause, so a benched Luxio is licensed too.
 */
const FIGHTING_ROAR: CardProgram = {
  passive: { evolveEarlyExempt: { ifCondition: { kind: "opponentActiveIsEx" } } },
};

/**
 * Chesnaught — Needly Armor: 3 counters on the attacker per {G} Energy attached. The recoil is only
 * read at the Active main hit, which supplies the printed Active clause; a bench read would need
 * `activeOnly` here.
 */
const NEEDLY_ARMOR: CardProgram = {
  passive: { damageAttacker: { amount: 30, perAttachedEnergy: "Grass" } },
};

/**
 * Mega Gengar ex — Shadowy Concealment: a {D} Pokémon KO'd by an opposing Pokémon ex's attack gives
 * 1 fewer Prize; doesn't stack.
 */
const SHADOWY_CONCEALMENT: CardProgram = {
  passive: {
    seatKoPrizeReduction: {
      ability: "Shadowy Concealment",
      by: 1,
      koTarget: { kind: "typedPokemon", pokemonType: "Darkness" },
    },
  },
};

/** Mega Hawlucha ex — Tenacious Body: on a KO by attack damage, flip; heads survives at 10 HP. */
const TENACIOUS_BODY: CardProgram = { passive: { survivesKoOnCoinFlip: "Tenacious Body" } };

/**
 * Annihilape — Durable Body: Tenacious Body's text; a separate object so the coin row names the
 * printed Ability.
 */
const DURABLE_BODY: CardProgram = { passive: { survivesKoOnCoinFlip: "Durable Body" } };

/** Shedinja — Fragile Husk: a KO by an opposing Pokémon ex's attack gives no Prizes. */
const FRAGILE_HUSK: CardProgram = {
  triggered: [
    {
      name: "Fragile Husk",
      trigger: "onKnockOut",
      program: [],
      onKoPrizeGuard: "pokemonExAttackPrevent",
    },
  ],
};

/**
 * Gengar — Infinite Shadow: KO'd by an attack, it goes to hand instead of the discard (attachments
 * discarded).
 */
const INFINITE_SHADOW: CardProgram = { passive: { koSelfToHand: true } };

/**
 * Pecharunt — Final Chain: KO'd by an opposing attack, search the deck for a card into hand, then
 * shuffle.
 */
const FINAL_CHAIN: CardProgram = {
  triggered: [
    {
      name: "Final Chain",
      trigger: "onKnockOut",
      byOpponentAttack: true,
      program: searchThenShuffle({ filter: { kind: "anyCard" }, dest: "hand", max: 1 }),
    },
  ],
};

/**
 * Silvally — Call a Buddy: with no cards in hand, search for a Supporter, reveal it, put it in
 * hand, shuffle.
 */
const CALL_A_BUDDY: CardProgram = {
  abilities: [
    activated({
      name: "Call a Buddy",
      playableIf: { kind: "yourHandExactly", count: 0 },
      program: searchThenShuffle({
        filter: { kind: "supporter" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    }),
  ],
};

/**
 * Erika's Tangela — Gathering of Blossoms: search for an Erika's Pokémon, reveal it, put it in
 * hand, shuffle.
 */
const GATHERING_OF_BLOSSOMS: CardProgram = {
  abilities: [
    activated({
      name: "Gathering of Blossoms",
      program: searchThenShuffle({
        filter: { kind: "ownerPokemon", owner: "Erika" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    }),
  ],
};

/**
 * Vivillon — Guiding Dance: flip; on heads search for a Pokémon and shuffle. Both the search and
 * shuffle sit inside the heads branch; the use is spent on either face.
 */
const GUIDING_DANCE: CardProgram = {
  abilities: [
    activated({
      name: "Guiding Dance",
      program: [
        {
          op: "coinFlipGate",
          ops: searchThenShuffle({
            filter: { kind: "anyPokemon" },
            dest: "hand",
            max: 1,
            reveal: true,
          }),
        },
      ],
    }),
  ],
};

/** Shuckle — Fermented Juice: with any {G} Energy attached, heal 30 from 1 of your Pokémon. */
const FERMENTED_JUICE: CardProgram = {
  abilities: [
    activated({
      name: "Fermented Juice",
      requiresEnergyType: "Grass",
      program: [{ op: "healChosen", amount: 30 }],
    }),
  ],
};

/** Erika's Vileplume ex — Lovely Fragrance: heal 30 from each of your Pokémon. */
const LOVELY_FRAGRANCE: CardProgram = {
  abilities: [
    activated({
      name: "Lovely Fragrance",
      program: [{ op: "healEach", amount: 30 }],
    }),
  ],
};

/**
 * Solgaleo — Sunrise: from the Bench, search up to 2 Basic {M} Energy and attach them to this
 * Pokémon, then shuffle.
 */
const SUNRISE: CardProgram = {
  abilities: [
    activated({
      name: "Sunrise",
      benchOnly: true,
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Metal" },
          max: 2,
          toSelf: true,
        },
        { op: "shuffleDeck" },
      ],
    }),
  ],
};

/**
 * Oricorio ex — Excited Turbo: as often as you like, with an {R} Mega Evolution Pokémon ex in play,
 * attach a Basic {R} Energy from hand to a Benched {R} Pokémon.
 */
const EXCITED_TURBO: CardProgram = {
  abilities: [
    {
      name: "Excited Turbo",
      oncePerTurn: false,
      activeOnly: false,
      playableIf: { kind: "yourMegaExInPlay", type: "Fire" },
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Fire",
          targetType: "Fire",
          benchOnly: true,
        },
      ],
    },
  ],
};

/**
 * Ludicolo — Excited Heal: with a {G} Mega Evolution Pokémon ex in play, heal 60 from 1 of your
 * Pokémon.
 */
const EXCITED_HEAL: CardProgram = {
  abilities: [
    activated({
      name: "Excited Heal",
      playableIf: { kind: "yourMegaExInPlay", type: "Grass" },
      program: [{ op: "healChosen", amount: 60 }],
    }),
  ],
};

/**
 * Linoone — Excited Dash: from the Bench, with any Mega Evolution Pokémon ex in play, switch with
 * your Active.
 */
const EXCITED_DASH: CardProgram = {
  abilities: [
    activated({
      name: "Excited Dash",
      benchOnly: true,
      playableIf: { kind: "yourMegaExInPlay" },
      program: [{ op: "switchActive", fromSource: true }],
    }),
  ],
};

/**
 * Seviper — Excited Power: with a {D} Mega Evolution Pokémon ex in play, +120 to the opponent's
 * Active before W/R.
 */
const EXCITED_POWER: CardProgram = {
  passive: {
    damageBonusBeforeWRIf: { amount: 120, cond: { kind: "yourMegaExInPlay", type: "Darkness" } },
  },
};

/** Mega Signal — search for a Mega Evolution Pokémon ex, reveal it, put it in hand, shuffle. */
const MEGA_SIGNAL: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "megaEvolutionEx" },
    dest: "hand",
    max: 1,
    reveal: true,
  }),
};

/**
 * Jett — draw 1 per opponent's Mega Evolution Pokémon ex in play. With none it draws 0 and is still
 * played.
 */
const JETT: CardProgram = {
  trainer: [
    {
      op: "drawCards",
      count: 1,
      per: { kind: "pokemonInPlay", seat: "opponent", filter: { kind: "megaEvolutionEx" } },
    },
  ],
};

// Typed Special Energies: each provides its type unconditionally, and its one extra rule applies
// only while the holder is that type (`holderType`).

/** Growing Grass Energy — provides {G}; a {G} holder gets +20 HP. */
const GROWING_GRASS_ENERGY: CardProgram = {
  energy: { provides: ["Grass"], holderType: "Grass", passive: { hpBonus: { amount: 20 } } },
};

/**
 * Rocky Fighting Energy — provides {F}; prevents effects of opposing attacks on a {F} holder
 * (damage is not an effect).
 */
const ROCKY_FIGHTING_ENERGY: CardProgram = {
  energy: {
    provides: ["Fighting"],
    holderType: "Fighting",
    passive: { preventAttackEffects: true },
  },
};

/**
 * Telepathic Psychic Energy — provides {P}; attached from hand to a {P} Pokémon, search up to 2
 * Basic {P} Pokémon onto the Bench, then shuffle.
 */
const TELEPATHIC_PSYCHIC_ENERGY: CardProgram = {
  energy: {
    provides: ["Psychic"],
    holderType: "Psychic",
    onAttach: {
      kind: "benchSearch",
      filter: { kind: "typedPokemon", pokemonType: "Psychic", stage: "basic" },
      max: 2,
    },
  },
};

/**
 * Bubbly Water Energy — provides {W}; a {W} holder recovers from and is immune to all Special
 * Conditions.
 */
const BUBBLY_WATER_ENERGY: CardProgram = {
  energy: {
    provides: ["Water"],
    holderType: "Water",
    passive: {
      statusRecovery: ["asleep", "burned", "confused", "paralyzed", "poisoned"],
      statusImmunities: ["asleep", "burned", "confused", "paralyzed", "poisoned"],
    },
  },
};

/** Magnetic Metal Energy — provides {M}; a {M} holder has no Retreat Cost. */
const MAGNETIC_METAL_ENERGY: CardProgram = {
  energy: { provides: ["Metal"], holderType: "Metal", passive: { noRetreatCostSelf: {} } },
};

/**
 * Nitro Fire Energy — provides {R}; discarded by an attack of its {R} holder, it returns to hand
 * after the attack.
 */
const NITRO_FIRE_ENERGY: CardProgram = {
  energy: { provides: ["Fire"], holderType: "Fire", returnAfterAttackDiscard: "hand" },
};

/**
 * Shadowy Darkness Energy — provides {D}; a benched {D} holder takes no damage from opposing
 * attacks.
 */
const SHADOWY_DARKNESS_ENERGY: CardProgram = {
  energy: {
    provides: ["Darkness"],
    holderType: "Darkness",
    passive: { preventDamageWhileBenched: true },
  },
};

/**
 * Voltaic Lightning Energy — provides {L}; a {L} holder's attacks do +20 to the opponent's Active
 * before W/R.
 */
const VOLTAIC_LIGHTNING_ENERGY: CardProgram = {
  energy: {
    provides: ["Lightning"],
    holderType: "Lightning",
    passive: { damageBonusBeforeWR: 20 },
  },
};

/**
 * Prism Tower — once per turn each player may discard 2 cards from hand to draw 1. Refused with
 * fewer than 2 cards in hand.
 */
const PRISM_TOWER: CardProgram = {
  stadium: {
    ability: {
      label: "Prism Tower",
      program: [
        { op: "payFromHand", count: 2, to: "discard" },
        { op: "drawCards", count: 1 },
      ],
    },
  },
};

/**
 * Surfing Beach — once per turn, switch an Active {W} Pokémon with a Benched {W} Pokémon. Refused
 * with no Benched {W}.
 */
const SURFING_BEACH: CardProgram = {
  stadium: {
    ability: {
      label: "Surfing Beach",
      playableIf: { kind: "yourActiveHasType", type: "Water" },
      program: [{ op: "switchActive", targetType: "Water" }],
    },
  },
};

/** Nighttime Mine — attacks of every Tera Pokémon cost {C} more. */
const NIGHTTIME_MINE: CardProgram = {
  stadium: {
    attackCostSurcharge: { amount: 1, attacker: { kind: "bannerPokemon", banner: "Tera" } },
  },
};

/**
 * Lumiose City — once per turn, search a Basic Pokémon onto the Bench and shuffle; the search ends
 * the turn.
 */
const LUMIOSE_CITY: CardProgram = {
  stadium: {
    ability: {
      label: "Lumiose City",
      program: searchThenShuffle({ filter: { kind: "basicPokemon" }, dest: "bench", max: 1 }),
      endsTurn: "always",
    },
  },
};

/**
 * Celebratory Fanfare — once per turn, heal 10 from each of your Pokémon; the turn ends only if
 * something was healed.
 */
const CELEBRATORY_FANFARE: CardProgram = {
  stadium: {
    ability: {
      label: "Celebratory Fanfare",
      program: [{ op: "healEach", amount: 10 }],
      endsTurn: "ifHealed",
    },
  },
};

/**
 * Battle Cage — prevents damage counters placed on Benched Pokémon by effects of the opponent's
 * attacks and Abilities; attack damage still applies.
 */
const BATTLE_CAGE: CardProgram = {
  stadium: { benchCounterShield: true },
};

/**
 * Mystery Garden — once per turn, discard an Energy card from hand to draw until the hand equals
 * your {P} Pokémon in play (counted after the discard). Usable even when that draws 0.
 */
const MYSTERY_GARDEN: CardProgram = {
  stadium: {
    ability: {
      label: "Mystery Garden",
      program: [
        { op: "payFromHand", to: "discard", count: 1, filter: { kind: "anyEnergy" } },
        {
          op: "drawUntilHandSize",
          size: 1,
          per: {
            kind: "pokemonInPlay",
            seat: "you",
            filter: { kind: "typedPokemon", pokemonType: "Psychic" },
          },
        },
      ],
    },
  },
};

/**
 * Forest of Vitality — {G} Pokémon can evolve into {G} Pokémon the turn they are played, except on
 * the first turn.
 */
const FOREST_OF_VITALITY: CardProgram = {
  stadium: { sameTurnEvolution: { type: "Grass" } },
};

/**
 * Sacred Charm — 30 less damage after W/R from opposing Pokémon that have an Ability; reads the
 * printed card.
 */
const SACRED_CHARM: CardProgram = {
  passive: {
    damageReductionAfterWRFromAttacker: { amount: 30, attacker: { kind: "abilityPokemon" } },
  },
};

/**
 * Thick Scale — a {N} holder takes 50 less after W/R from opposing {G}, {R}, {W} or {L} Pokémon
 * (in-play types).
 */
const THICK_SCALE: CardProgram = {
  passive: {
    damageReductionAfterWRFromAttacker: {
      amount: 50,
      attacker: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Grass" },
          { kind: "typedPokemon", pokemonType: "Fire" },
          { kind: "typedPokemon", pokemonType: "Water" },
          { kind: "typedPokemon", pokemonType: "Lightning" },
        ],
      },
      holderType: "Dragon",
    },
  },
};

/**
 * Dewgong — Thick Fat: 30 less after W/R from opposing {R} or {W} Pokémon. An Ability, so an
 * Ability lock silences it.
 */
const THICK_FAT: CardProgram = {
  passive: {
    damageReductionAfterWRFromAttacker: {
      amount: 30,
      attacker: {
        kind: "anyOf",
        filters: [
          { kind: "typedPokemon", pokemonType: "Fire" },
          { kind: "typedPokemon", pokemonType: "Water" },
        ],
      },
    },
  },
};

/**
 * Heliolisk — Frilled Generator: if you played Canari this turn, search up to 2 Basic {L} Energy
 * and attach them to this Pokémon, then shuffle.
 */
const FRILLED_GENERATOR: CardProgram = {
  abilities: [
    activated({
      name: "Frilled Generator",
      playableIf: { kind: "youPlayedSupporterNamedThisTurn", name: "Canari" },
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Lightning" },
          max: 2,
          toSelf: true,
        },
        { op: "shuffleDeck" },
      ],
    }),
  ],
};

/**
 * Light Ball — a Pikachu ex holder's attacks do +50 to the opponent's Active Pokémon ex before W/R.
 */
const LIGHT_BALL: CardProgram = {
  passive: {
    damageBonusBeforeWRIfTarget: {
      amount: 50,
      targetSuffix: "ex",
      holder: { kind: "byName", name: "Pikachu ex" },
    },
  },
};

/**
 * Punk Helmet — a {D} Active holder damaged by an opposing attack places 4 counters on the
 * attacker.
 */
const PUNK_HELMET: CardProgram = {
  passive: { damageAttacker: { amount: 40, holderType: "Darkness" } },
};

/**
 * Team Rocket's Hypnotizer — a Team Rocket's Active holder damaged by an opposing attack makes the
 * attacker Asleep. Targets only the body that attacked, and only while it is still Active.
 */
const TEAM_ROCKETS_HYPNOTIZER: CardProgram = {
  triggered: [
    {
      name: "Team Rocket's Hypnotizer",
      trigger: "onDamagedByAttack",
      program: [
        {
          op: "conditionGate",
          cond: { kind: "yourActiveOwner", owner: "Team Rocket" },
          ops: [{ op: "applyStatus", target: "attacker", status: "asleep" }],
        },
      ],
    },
  ],
};

/** Core Memory — a Mega Zygarde ex holder can use the Tool's attack, Geobuster. */
const CORE_MEMORY: CardProgram = {
  toolAttacks: true,
  toolAttacksHolder: { kind: "byName", name: "Mega Zygarde ex" },
};

/**
 * Tremendous Bomb — 12 counters on the attacker when one hit does 240 or more, the attacker is a
 * Mega Evolution Pokémon ex, and the holder is not.
 */
const TREMENDOUS_BOMB: CardProgram = {
  passive: {
    damageAttackerActiveThenDiscardIf: {
      amount: 120,
      minDamage: 240,
      attacker: { kind: "megaEvolutionEx" },
      holderNot: { kind: "megaEvolutionEx" },
    },
  },
};

/**
 * Gladion's Final Battle — only as the last card in hand; this turn, attacks by your non-Rule-Box
 * Pokémon do +80 before W/R. The attacker is checked at each hit, so evolving into a Rule Box
 * Pokémon loses the bonus.
 */
const GLADIONS_FINAL_BATTLE: CardProgram = {
  trainerPlayableIf: { kind: "yourHandExactly", count: 1 },
  trainer: [
    {
      op: "boostSideAttacksThisTurn",
      amount: 80,
      target: { kind: "anyPokemon" },
      attacker: { kind: "anyPokemon", noRuleBox: true },
    },
  ],
};

/**
 * Premium Power Pro — this turn, your {F} Pokémon (in-play types) do +30 before W/R. Multiple plays
 * stack.
 */
const PREMIUM_POWER_PRO: CardProgram = {
  trainer: [
    {
      op: "boostSideAttacksThisTurn",
      amount: 30,
      target: { kind: "anyPokemon" },
      attacker: { kind: "typedPokemon", pokemonType: "Fighting" },
    },
  ],
};

/**
 * Acerola's Mischief — only when the opponent has 2 or fewer Prizes left; next turn, the chosen
 * Pokémon is shielded from damage and effects of opposing Pokémon ex attacks. The shield follows
 * the body to the Bench and through evolution and ends when it leaves play.
 */
const ACEROLAS_MISCHIEF: CardProgram = {
  trainerPlayableIf: { kind: "opponentPrizesRemaining", counts: [0, 1, 2] },
  trainer: [{ op: "installChosenAttackShield", fromClass: { stage: "ex" } }],
};

/**
 * Roxie's Performance — during the opponent's next turn, their Poisoned Pokémon can't retreat,
 * including newly Poisoned ones. Always playable.
 */
const ROXIES_PERFORMANCE: CardProgram = {
  trainer: [{ op: "lockSideRetreat", status: "poisoned" }],
};

/** Dawn — search a Basic, a Stage 1 and a Stage 2 Pokémon into hand, then shuffle. */
const DAWN: CardProgram = {
  trainer: searchThenShuffle({
    filter: { kind: "basicPokemon" },
    dest: "hand",
    max: 1,
    reveal: true,
    also: [
      { filter: { kind: "stagePokemon", stage: "Stage1" }, max: 1 },
      { filter: { kind: "stagePokemon", stage: "Stage2" }, max: 1 },
    ],
  }),
};

/**
 * Special Red Card — only when the opponent has 3 or fewer Prizes left; they put their hand on the
 * bottom of their deck and, if any cards moved, draw 3. An empty hand moves nothing and draws 0.
 */
const SPECIAL_RED_CARD: CardProgram = {
  trainer: [
    {
      op: "handRefresh",
      who: "opponent",
      toBottom: true,
      draw: { kind: "fixed", count: 3 },
      onlyIfAnyMoved: true,
    },
  ],
  trainerPlayableIf: { kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] },
};

/**
 * Jumbo Ice Cream — heal 80 from your Active if it has 3 or more Energy cards attached. Playable on
 * an undamaged Active.
 */
const JUMBO_ICE_CREAM: CardProgram = {
  trainer: [{ op: "heal", target: "self", amount: 80 }],
  trainerPlayableIf: { kind: "yourActiveEnergyAtLeast", count: 3 },
};

/**
 * Dark Bell — both Active non-{D} Pokémon become Confused. The negation is a `conditionGate` with
 * an empty `ops` and the status in `otherwise`; a dual type including {D} is spared.
 */
const DARK_BELL: CardProgram = {
  trainer: [
    {
      op: "conditionGate",
      cond: { kind: "opponentActiveHasType", type: "Darkness" },
      ops: [],
      otherwise: [{ op: "applyStatus", target: "defender", status: "confused" }],
    },
    {
      op: "conditionGate",
      cond: { kind: "yourActiveHasType", type: "Darkness" },
      ops: [],
      otherwise: [{ op: "applyStatus", target: "self", status: "confused" }],
    },
  ],
};

/**
 * Wally's Compassion — heal all damage from 1 of your Mega Evolution Pokémon ex; if it healed any,
 * all its Energy goes to hand. An undamaged one may be picked and keeps its Energy.
 */
const WALLYS_COMPASSION: CardProgram = {
  trainer: [
    {
      op: "healChosen",
      amount: "all",
      filter: { kind: "megaEvolutionEx" },
      energyToHandFromHealed: true,
    },
  ],
};

/**
 * Blowtorch — discard a Basic {R} Energy from hand, then choose: discard a Tool or a Special Energy
 * from an opponent's Pokémon, or discard a Stadium in play. Branches without a target are not
 * offered.
 */
const BLOWTORCH: CardProgram = {
  trainer: [
    {
      op: "payFromHand",
      count: 1,
      to: "discard",
      filter: { kind: "basicEnergy", energyType: "Fire" },
    },
    {
      op: "chooseOneOffered",
      note: "Choose 1: discard a Pokémon Tool or a Special Energy card from 1 of your opponent's Pokémon, or discard a Stadium in play.",
      branches: [
        { op: "discardTools", count: 1 },
        { op: "discardEnergy", from: "opponentChosen", filter: { kind: "specialEnergy" } },
        { op: "discardStadium" },
      ],
      labels: ["Discard a Pokémon Tool", "Discard a Special Energy", "Discard the Stadium"],
    },
  ],
};

/**
 * Great Haul Net — shuffle up to 3 {W} Pokémon and/or up to 3 Basic {W} Energy from the discard
 * into the deck. Both bullets are offered and either may answer 0; it then shuffles once.
 */
const GREAT_HAUL_NET: CardProgram = {
  trainer: [
    {
      op: "discardPileRetrieval",
      filter: { kind: "typedPokemon", pokemonType: "Water" },
      dest: "deck",
      max: 3,
    },
    {
      op: "discardPileRetrieval",
      filter: { kind: "basicEnergy", energyType: "Water" },
      dest: "deck",
      max: 3,
    },
    { op: "shuffleDeck" },
  ],
};

/**
 * Strange Timepiece — devolve 1 of your evolved {P} Pokémon, returning 1 or more Evolution cards
 * from the top to hand. Stamping `turnPlayed` stops it evolving again this turn.
 */
const STRANGE_TIMEPIECE: CardProgram = {
  trainer: [{ op: "devolveChosen", whose: "self", pokemonType: "Psychic", depth: "any" }],
};

const SANDY_FLAPPING_TEXT =
  "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. You may also use this Ability if this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon. Discard the top 2 cards of your opponent's deck.";

/**
 * Flygon — Sandy Flapping: on evolve, and when KO'd in the Active Spot by an opposing attack, the
 * opponent discards their top 2 cards. Both halves are behind a confirm because the mill can help
 * the opponent; the KO half is not stopped by an Ability lock.
 */
const SANDY_FLAPPING: CardProgram = {
  triggered: [
    {
      name: "Sandy Flapping",
      trigger: "onEvolve",
      program: [
        {
          op: "optional",
          note: SANDY_FLAPPING_TEXT,
          ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
        },
      ],
    },
    {
      name: "Sandy Flapping",
      trigger: "onKnockOut",
      activeOnly: true,
      byOpponentAttack: true,
      program: [
        {
          op: "optional",
          note: SANDY_FLAPPING_TEXT,
          ops: [{ op: "discardDeckTop", whose: "opponent", count: 2 }],
        },
      ],
    },
  ],
};

/**
 * Miraidon — Photon Cord: KO'd in the Active Spot by an opposing attack, move up to 2 Basic {L}
 * Energy to 1 Benched Pokémon. Runs before the KO discards the stack and before the Prize is taken.
 */
const PHOTON_CORD: CardProgram = {
  triggered: [
    {
      name: "Photon Cord",
      trigger: "onSelfActiveKnockedOut",
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "basicEnergy", energyType: "Lightning" },
          max: 2,
          route: "selfToBench",
        },
      ],
    },
  ],
};

/**
 * Gengar ex — Fainting Spell: KO'd by an opposing attack, flip; on heads the attacker is Knocked
 * Out in the same batch.
 */
const FAINTING_SPELL: CardProgram = { passive: { koAttackerOnCoinFlip: "Fainting Spell" } };

/**
 * Adversity Policy — if the Active holder is weak to the opponent's Active's type and is damaged by
 * an opposing attack, draw 3.
 */
const ADVERSITY_POLICY: CardProgram = {
  triggered: [
    {
      name: "Adversity Policy",
      trigger: "onDamagedByAttack",
      program: [
        {
          op: "conditionGate",
          cond: { kind: "yourActiveWeakToOpponentActiveType" },
          ops: [{ op: "drawCards", count: 3 }],
        },
      ],
    },
  ],
};

/**
 * Hide 'n' Sneak — prevents effects of the opponent's attacks and Abilities on this Pokémon; damage
 * still applies.
 */
const HIDE_N_SNEAK: CardProgram = {
  passive: { preventAttackEffects: true, preventAbilityEffects: true },
};

/**
 * Latios — Lustrous Assist: when your Mega Latias ex moves from the Bench to the Active Spot, move
 * any amount of Energy from your Benched Pokémon to it. The moment is read as a use-time gate.
 */
const LUSTROUS_ASSIST: CardProgram = {
  abilities: [
    activated({
      name: "Lustrous Assist",
      playableIf: {
        kind: "allOf",
        conditions: [
          { kind: "yourActivePromotedThisTurn" },
          { kind: "yourActiveNamed", name: "Mega Latias ex" },
        ],
      },
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "anyEnergy" },
          max: "any",
          route: "benchToActive",
          anySource: true,
        },
      ],
    }),
  ],
};

/**
 * Larry's Komala — Lethargic Charge: from the Bench, attach an Energy card from hand to your Active
 * Larry's Pokémon.
 */
const LETHARGIC_CHARGE: CardProgram = {
  abilities: [
    activated({
      name: "Lethargic Charge",
      benchOnly: true,
      program: [
        {
          op: "attachFromHand",
          filter: { kind: "anyEnergy" },
          one: true,
          activeOnly: true,
          ownerPokemon: "Larry",
        },
      ],
    }),
  ],
};

/**
 * Iron Defender — during the opponent's next turn, your {M} Pokémon (type at the hit) take 30 less
 * after W/R. Plays stack.
 */
const IRON_DEFENDER: CardProgram = {
  trainer: [{ op: "installSideDamageReductionNextTurn", amount: 30, pokemonType: "Metal" }],
};

/** Bastiodon — Ancient Bulwark. */
const ANCIENT_BULWARK: CardProgram = {
  passive: { preventSeatDamageWhileBenchedFromEnergyAtMost: 2 },
};

/** Decidueye ex — Sniper's Eye: exactly 4 cards in the opponent's hand. */
const SNIPERS_EYE: CardProgram = { passive: { ignoreColorlessCostIfOpponentHandExactly: 4 } };

/** Kingambit — Supreme Overlord: 30 per Prize the opponent has taken. */
const SUPREME_OVERLORD: CardProgram = { passive: { damageBonusBeforeWRPerOpponentPrize: 30 } };

/** Garbodor — Gloomy Garbage: 20 off a Tool-carrying opposing Active's attacks. */
const GLOOMY_GARBAGE: CardProgram = { passive: { opponentActiveToolAttackDebuff: 20 } };

/** Yveltal — Life-Locked: the opponent's Active can't be healed. */
const LIFE_LOCKED: CardProgram = { passive: { opponentActiveCantBeHealed: true } };

/**
 * Snorlax — Good Sleep: if still Asleep at Checkup, heal all damage. Checkup triggers run after the
 * Asleep flip.
 */
const GOOD_SLEEP: CardProgram = {
  triggered: [
    {
      name: "Good Sleep",
      trigger: "betweenTurns",
      activeOnly: true,
      program: [
        {
          op: "conditionGate",
          cond: { kind: "yourActiveAsleep" },
          ops: [{ op: "heal", target: "self", amount: "all" }],
        },
      ],
    },
  ],
};

/**
 * Damp — Pokémon in play on both sides lose any Ability that Knocks Out its user, from the Bench
 * too.
 */
const DAMP_KNOCK_OUT_ITSELF: CardProgram = {
  passive: { disableAbilities: { side: "both", selfKnockOutAbility: true } },
};

/**
 * Damp (alternate wording) — read as the same class: Abilities whose use Knocks Out the user, not
 * ones that answer a Knock Out. Its own object so this wording can change alone.
 */
const DAMP_REQUIRE_KNOCKED_OUT: CardProgram = {
  passive: { disableAbilities: { side: "both", selfKnockOutAbility: true } },
};

/**
 * Fossil Quarry — once per turn, search up to 2 "Antique" Items onto the Bench as fossil bodies,
 * then shuffle. Only built fossils are offered; putting them onto the Bench is not playing an Item.
 */
const FOSSIL_QUARRY: CardProgram = {
  stadium: {
    ability: {
      label: "Fossil Quarry",
      program: searchThenShuffle({
        filter: { kind: "itemNameContaining", fragment: "Antique" },
        dest: "bench",
        max: 2,
      }),
    },
  },
};

/**
 * Clawitzer — Fall Back to Reload: usable from the Bench on the turn it moved there from the Active
 * Spot; attach up to 2 Basic {W} Energy from hand to it, as two declinable attaches.
 */
const FALL_BACK_TO_RELOAD: CardProgram = {
  abilities: [
    activated({
      name: "Fall Back to Reload",
      benchOnly: true,
      benchedThisTurn: true,
      program: [
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Water",
          toSelf: true,
          declinable: true,
        },
        {
          op: "attachEnergyFrom",
          source: "hand",
          energyType: "Water",
          toSelf: true,
          declinable: true,
        },
      ],
    }),
  ],
};

/**
 * Mewtwo ex — Photon Bullets (attack index 0): 50 to each opposing Pokémon ex. W/R still applies to
 * the Active; the parenthetical is only reminder text.
 */
const PHOTON_BULLETS: CardProgram = {
  attack: {
    0: [
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 50,
        count: "all",
        source: "attack",
        deals: true,
        filter: { kind: "suffixPokemon", suffix: "ex" },
      },
    ],
  },
};

/**
 * Mega Venusaur ex — Solar Transfer: as often as you like, move a Basic {G} Energy between your
 * Pokémon.
 */
const SOLAR_TRANSFER: CardProgram = {
  abilities: [
    {
      name: "Solar Transfer",
      oncePerTurn: false,
      activeOnly: false,
      program: [{ op: "moveEnergy", filter: { kind: "basicEnergy", energyType: "Grass" }, max: 1 }],
    },
  ],
};

/**
 * Azumarill ex — Bubble Gathering: as often as you like, move an Energy from 1 other Pokémon to
 * this one.
 */
const BUBBLE_GATHERING: CardProgram = {
  abilities: [
    {
      name: "Bubble Gathering",
      oncePerTurn: false,
      activeOnly: false,
      program: [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "othersToSelf" }],
    },
  ],
};

/**
 * Cobalion ex — Metal Road: when it moves from the Bench to the Active Spot, move any amount of {M}
 * Energy from your other Pokémon to it. The gate stays open for the rest of the turn while it is
 * Active, which is looser than the print.
 */
const METAL_ROAD: CardProgram = {
  abilities: [
    {
      name: "Metal Road",
      oncePerTurn: true,
      activeOnly: true,
      playableIf: { kind: "yourActivePromotedThisTurn" },
      program: [
        {
          op: "moveEnergy",
          filter: { kind: "providesEnergy", energyType: "Metal" },
          max: "any",
          route: "othersToSelf",
          anySource: true,
        },
      ],
    },
  ],
};

/**
 * Mismagius ex — Swirling Prose: while Active, the opponent's new Active becomes Confused whenever
 * theirs moves to the Bench during their turn.
 */
const SWIRLING_PROSE: CardProgram = {
  triggered: [
    {
      name: "Swirling Prose",
      trigger: "onActiveMovedToBench",
      opponentAction: true,
      activeOnly: true,
      program: [{ op: "applyStatus", target: "defender", status: "confused" }],
    },
  ],
};

/**
 * Team Rocket's Dugtrio — Holes: when the opponent's Active moves to the Bench during their turn,
 * place 2 counters on it. Fires from the Bench too.
 */
const HOLES: CardProgram = {
  triggered: [
    {
      name: "Holes",
      trigger: "onActiveMovedToBench",
      opponentAction: true,
      program: [{ op: "damageSubject", amount: 20 }],
    },
  ],
};

/** Alolan Exeggutor — Scale Up: +250 HP with 6 or more {G} Energy attached. */
const SCALE_UP: CardProgram = {
  passive: { hpBonus: { amount: 250, requiresEnergyType: "Grass", requiresEnergyCount: 6 } },
};

/** Tyrantrum — Tyrannically Gutsy: +150 HP with any Special Energy attached. */
const TYRANNICALLY_GUTSY: CardProgram = {
  passive: { hpBonus: { amount: 150, requiresEnergyType: "special" } },
};

/**
 * Crobat — Nighttime Maneuvers: from the Active Spot, search for a card, shuffle, then put it on
 * top.
 */
const NIGHTTIME_MANEUVERS: CardProgram = {
  abilities: [
    {
      name: "Nighttime Maneuvers",
      oncePerTurn: true,
      activeOnly: true,
      program: [
        { op: "shuffleDeck" },
        { op: "searchDeck", filter: { kind: "anyCard" }, max: 1, exact: true, dest: "deckTop" },
      ],
    },
  ],
};

/**
 * Toxtricity — Sinister Surge: search a Basic {D} Energy, attach it to a Benched {D} Pokémon,
 * shuffle, then place 2 counters on that Pokémon if anything was attached.
 */
const SINISTER_SURGE: CardProgram = {
  abilities: [
    activated({
      name: "Sinister Surge",
      program: [
        {
          op: "attachFromDeck",
          filter: { kind: "basicEnergy", energyType: "Darkness" },
          max: 1,
          targetType: "Darkness",
          benchOnly: true,
          recordAs: "moved",
        },
        { op: "shuffleDeck" },
        { op: "countersOnRecordedBody", slot: "moved", amount: 20 },
      ],
    }),
  ],
};

/**
 * Dustox — Boisterous Wind: flip; on heads an Energy on the opponent's Active returns to their
 * hand.
 */
const BOISTEROUS_WIND: CardProgram = {
  abilities: [
    activated({
      name: "Boisterous Wind",
      program: [
        {
          op: "coinFlipGate",
          ops: [
            {
              op: "discardEnergy",
              from: "opponentActive",
              filter: { kind: "anyEnergy" },
              to: "hand",
            },
          ],
        },
      ],
    }),
  ],
};

/**
 * Rampardos ex — Destructive Headbutting: from the Active Spot, flip; on heads discard an Energy
 * from the opponent's Active.
 */
const DESTRUCTIVE_HEADBUTTING: CardProgram = {
  abilities: [
    {
      name: "Destructive Headbutting",
      oncePerTurn: true,
      activeOnly: true,
      program: [
        {
          op: "coinFlipGate",
          ops: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
        },
      ],
    },
  ],
};

/**
 * Gumshoos — Evidence Gathering: swap a card from hand with the deck's top card. Refused with an
 * empty hand or deck.
 */
const EVIDENCE_GATHERING: CardProgram = {
  abilities: [
    activated({
      name: "Evidence Gathering",
      program: [{ op: "payFromHand", count: 1, to: "deckTop", swapWithTop: true }],
    }),
  ],
};

/** Talonflame — Sky Hunt: flip; on heads discard a random card from the opponent's hand. */
const SKY_HUNT: CardProgram = {
  abilities: [
    activated({
      name: "Sky Hunt",
      program: [
        {
          op: "coinFlipGate",
          ops: [{ op: "randomFromOpponentHand", to: "discard" }],
        },
      ],
    }),
  ],
};

/**
 * Vivillon — Grand Wing: the opponent puts their hand on the bottom of their deck and, if any
 * moved, draws 4.
 */
const GRAND_WING: CardProgram = {
  abilities: [
    activated({
      name: "Grand Wing",
      program: [
        {
          op: "handRefresh",
          who: "opponent",
          toBottom: true,
          onlyIfAnyMoved: true,
          draw: { kind: "fixed", count: 4 },
        },
      ],
    }),
  ],
};

/**
 * Phantump — Spiteful Evolution: evolve this Pokémon from a card in hand, then place 2 counters on
 * it. Not during your first turn.
 */
const SPITEFUL_EVOLUTION: CardProgram = {
  abilities: [
    activated({
      name: "Spiteful Evolution",
      playableIf: { kind: "notYourFirstTurn" },
      program: [
        { op: "evolveFromDeck", fromHand: true, recordAs: "moved" },
        { op: "countersOnRecordedBody", slot: "moved", amount: 20 },
      ],
    }),
  ],
};

/**
 * Dragonair — Evolutionary Guidance: with any Energy attached, search for an Evolution Pokémon,
 * reveal it, put it in hand, shuffle.
 */
const EVOLUTIONARY_GUIDANCE: CardProgram = {
  abilities: [
    activated({
      name: "Evolutionary Guidance",
      requiresEnergyType: "any",
      program: searchThenShuffle({
        filter: { kind: "evolutionPokemon" },
        dest: "hand",
        max: 1,
        reveal: true,
      }),
    }),
  ],
};

/**
 * Mega Clefable ex — Luminous Wing: prevents effects of the opponent's Abilities on this Pokémon.
 */
const LUMINOUS_WING: CardProgram = {
  passive: { preventAbilityEffects: true },
};

const REGISTRY: Readonly<Record<string, CardProgram>> = {
  // Professor's Research (SV base prints)
  "sv01-189": PROFESSORS_RESEARCH,
  // Nest Ball
  "sv01-181": NEST_BALL,
  // Boss's Orders
  "sv02-172": BOSSS_ORDERS,
  // Counter Catcher (Paradox Rift, regular and gold printings)
  "sv04-160": COUNTER_CATCHER,
  // Switch — not Standard-legal.
  "sv01-194": SWITCH,
  "sv08-187": SURFER,
  "sv10-174": TEAM_ROCKETS_GIOVANNI,
  // …and the seam's MIRROR — the same two ops, the other way round.
  "sv05-157": PRIME_CATCHER,
  // Potion
  "sv01-188": POTION,
  // Picnic Basket
  "sv01-184": PICNIC_BASKET,
  // Energy Search
  "sv01-172": ENERGY_SEARCH,
  // Chien-Pao ex — Shivery Chill (activated ability)
  "sv02-061": CHIEN_PAO,
  // Mewtwo VSTAR — Psy Purge (attack index 0).
  "swsh10.5-031": MEWTWO_VSTAR,
  // Bouffalant — Bouffer (passive)
  "sv03-174": REDUCE_20_AFTER_WR,
  // — Stadiums + Tools. —
  // Beach Court (Stadium)
  "sv01-167": BEACH_COURT,
  // Pokémon League Headquarters (Stadium)
  "sv03-192": POKEMON_LEAGUE_HQ,
  "sv02-175": CALAMITOUS_WASTELAND,
  // Stadium activated abilities.
  "sv06.5-060": NEUTRALIZATION_ZONE, // Neutralization Zone
  "sv08-180": LIVELY_STADIUM, // Lively Stadium — each BASIC in play gets +30 HP
  "sv08-177": GRAVITY_MOUNTAIN, // Gravity Mountain — each STAGE 2 in play gets -30 HP
  "sv02-171": ARTAZON, // Artazon — search a no-Rule-Box Basic → Bench
  "sv01-178": MESAGOZA, // Mesagoza — coin-gated search a Pokémon → hand
  "sv03-196": TOWN_STORE, // Town Store — search a Pokémon Tool → hand
  // Vitality Band (Tool)
  "sv01-197": VITALITY_BAND,
  "sv01-169": DEFIANCE_BAND, // +30 before W/R while behind on Prizes (morePrizesThanOpponent)
  "sv02-176": CHOICE_BELT, // +30 before W/R vs a defending Pokémon V (name-derived suffix)
  // Bravery Charm (Tool)
  "sv02-173": BRAVERY_CHARM,
  "sv05-152": HEROS_CAPE, // Hero's Cape — +100 HP, NO stage clause
  "sv10-162": CYNTHIAS_POWER_WEIGHT, // Cynthia's Power Weight — +70 HP, owner clause
  "sv01-193": ROCKY_HELMET,
  // Vengeful Punch is read at the KO sweep, not at the damage step.
  "sv03-197": VENGEFUL_PUNCH,
  // Exp. Share runs as a triggered program because its bearer is a surviving Pokémon; the KO'd one
  // is only the Energy's source.
  "sv01-174": EXP_SHARE,
  // — Special Energy. —
  // Jet Energy — {C} + switch-on-bench-attach
  "sv02-190": JET_ENERGY,
  // Luminous Energy — wildcard (any 1 type), {C} if another Special attached
  "sv02-191": LUMINOUS_ENERGY,
  "sv02-193": THERAPEUTIC_ENERGY,
  // — Triggered Abilities. —
  // Flamigo — Insta-Flock (on-play-to-Bench: search up to 3 Flamigo)
  "sv02-170": FLAMIGO,
  // Arboliva — Enriching Oil (on-evolve: heal all from 1 of your Pokémon)
  "sv01-023": ARBOLIVA,
  // Garganacl — Blessed Salt (between-turns: heal 20 from each of your Pokémon)
  "sv02-123": GARGANACL,
  // Trevenant — Forest Miasma (between-turns, Active-only: 1 counter on opp Active)
  "sv03-012": TREVENANT,
  // — Rare Candy. —
  // Rare Candy — Basic→Stage 2 evolve-skip Item
  "sv01-191": RARE_CANDY,
  // — The mid-turn-damage snipe. —
  // Hawlucha — Flying Entry (onPlayToBench: choose 2 opp Benched, 1 counter each)
  "sv01-118": HAWLUCHA,
  // Meowscarada ex — Bouquet Magic (activated, {G}-discard cost: 3 counters on 1 opp Benched)
  "sv02-015": MEOWSCARADA,
  // — On-KO triggered Abilities. —
  // Glimmora — Shattering Crystal (on-KO: flip; heads → opponent takes no prize for it)
  "sv02-126": GLIMMORA,
  // Munkidori ex — Oh No You Don't: 1 fewer Prize on a KO while a Pecharunt ex is in play.
  "sv06.5-037": MUNKIDORI_EX,
  "sv06.5-038": FLIP_THE_SCRIPT, // Fezandipiti ex — Flip the Script
  "sv06.5-039": SUBJUGATING_CHAINS,
  "sv07-118": FAN_CALL,
  "sv10.5w-064": LOOK_FOR_PREY,
  // — Cards built from existing ops. —
  "sv01-185": POKE_BALL, // Poké Ball — coin-gated search a Pokémon → hand
  "sv01-187": POKEMON_CATCHER, // Pokémon Catcher — coin-gated gust
  "sv01-180": NEMONA, // Nemona — draw 3 (Supporter)
  "sv02-150": REDUCE_30_AFTER_WR, // Copperajah ex — Bronze Body (−30 after W/R)
  "sv01-121": REDUCE_20_AFTER_WR, // Stonjourner — Exoskeleton (−20 after W/R)
  // — damageAttacker reactive recoil. —
  "sv01-005": COUNTERATTACK_QUILLS, // Cacnea — Counterattack Quills (3 counters on the attacker)
  "sv01-006": COUNTERATTACK_QUILLS, // Cacturne — Counterattack Quills (same program)
  "sv03-112": STUNFISK, // Stunfisk — Custom Trap (5 counters, only while a Tool is attached)
  "sv03-044": SCORCHING_ARMOR, // Armarouge — Scorching Armor (onDamagedByAttack → Burn the attacker)
  "sv03-120": COUNTERATTACKING_PINCER, // Klawf ex — Counterattacking Pincer (onDamagedByAttack → PARKING discard from the attacker)
  // — disableAbilities continuous Ability-lock auras. —
  "sv01-096": MISCHIEVOUS_LOCK, // Klefki — Mischievous Lock (Basic, both sides, Active-only, except itself)
  "sv02-089": FETTERED_IN_MISFORTUNE, // Spiritomb — Fettered in Misfortune (Basic V, both sides)
  "sv02-127": CURSED_LAND, // Ting-Lu ex — Cursed Land (opponent's damaged non-ex, Active-only)
  // — removeWeakness continuous own-board aura. —
  "sv01-093": BLOOMING_GARDEN, // Florges — Blooming Garden ("Your Pokémon in play have no Weakness")
  // — preventDamageFromExV holder passive. —
  "sv02-097": SAFEGUARD, // Mimikyu — Safeguard ("Prevent all damage from opponent's Pokémon ex/V")
  // — noRetreatCostAura continuous own-board aura. —
  "sv03-082": LUNAR_ZONE, // Clefable ex — Lunar Zone ("All of your Pokémon that have {P} Energy attached have no Retreat Cost")
  // — opponentActiveRetreatSurcharge, the opponent's-Active retreat-cost modifier. —
  "sv01-019": TRAP_TERRITORY, // Spidops ex — Trap Territory ("Your opponent's Active Pokémon's Retreat Cost is {C} more")
  // — preventOpponentActiveRetreat: the opponent's Active can't retreat. —
  "swsh10.5-055": BLOCK, // Snorlax — Block ("As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon can't retreat")
  // — noRetreatCostSelf, then the other passive Abilities. —
  "swsh10.5-025": PUNK_OUT, // Wimpod — Punk Out
  "sv03-030": PRESSURE, // Entei — Pressure
  "sv05-050": AZURE_SEAS, // Walking Wake ex — Azure Seas
  "sv08-057": KO_SURVIVAL, // Pikachu ex — Resolute Heart
  "sv10.5b-052": KO_SURVIVAL, // Crustle — Sturdy (a DIFFERENT Ability name, the SAME sentence)
  "sv01-099": WELL_BAKED_BODY, // Dachsbun — Well-Baked Body (Burn immunity and {R} prevention)
  "sv03-078": INSULATOR, // Bellibolt — Insulator ("Prevent all damage done to this Pokémon by attacks from your opponent's {L} Pokémon")
  "sv03-070": ADVERSE_WEATHER, // Thundurus — Adverse Weather (the Active shields the Bench)
  "sv01-068": ELECTRICITY_POUCHES, // Pachirisu — Electricity Pouches ("This Pokémon can't be Paralyzed")
  "sv01-145": BLISSEY, // Blissey — Busybody Nurse ("Your Active Pokémon recovers from all Special Conditions")
  // — The ATTACK-COST ± family, both signs. "cost {C} more" / "cost Colorless less" is printed
  //   in three distinct sentences: Pokémon League Headquarters sv03-192 (a Stadium,
  //   `StadiumEffects.basicAttackCostSurcharge`) and these two, both ABILITIES. —
  "sv03-052": QUAKING_ZONE, // Seismitoad — Quaking Zone ("As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon cost {C} more")
  "swsh10.5-011": EXCITED_HEART, // Radiant Charizard — Excited Heart ("This Pokémon's attacks cost Colorless less for each Prize card your opponent has taken")
  // — The evolutionPokemon CardFilter. —
  "sv01-175": JACQ, // Jacq — search up to 2 Evolution Pokémon → hand, then shuffle (Supporter)
  // — attachEnergyFrom. —
  "sv01-054": QUAQUAVAL, // Quaquaval — Energy Carnival (attach a Basic Energy from hand)
  "sv02-060": BAXCALIBUR, // Baxcalibur — Super Cold (attach a Basic {W} from hand, repeatable)
  // — attachEnergyFrom riders: Gardevoir ex (targetType + bonusCounters + notIfKO). —
  "sv01-086": GARDEVOIR_EX, // Gardevoir ex — Psychic Embrace
  // — attachEnergyFrom multi + endsTurn: Koraidon ex "Dino Cry" (the sv01 prints
  //   carry the ability; sv03-124 is a different Koraidon ex without it). —
  "sv01-125": KORAIDON_EX,
  // — discardPileRetrieval. —
  "sv01-171": ENERGY_RETRIEVAL, // Energy Retrieval — 2 Basic Energy from discard → hand
  "sv01-182": PAL_PAD, // Pal Pad — 2 Supporters from discard → deck (shuffle)
  "sv02-188": SUPER_ROD, // Super Rod — 3 Pokémon/Basic Energy from discard → deck (shuffle)
  // — §9.2 op→op data flow — a clause that reads what an earlier clause of the same card DID.
  //   Miriam and SER are also discardPileRetrieval rows: the op records the moved cards for
  //   Miriam and reads them back for SER. —
  "sv01-179": MIRIAM, // Miriam — up to 5 Pokémon discard → deck, shuffle, "in this way" → draw 3
  "sv03-190": ORTEGA, // Ortega — reveal opponent's hand, bottom a chosen card, "in this way" → they may draw
  "sv02-189": SUPERIOR_ENERGY_RETRIEVAL, // Superior Energy Retrieval — pay 2, then up to 4 Basic Energy back, minus the 2 just paid
  // — lookAtTopN. —
  "sv02-183": GREAT_BALL, // Great Ball — look at top 7, reveal a Pokémon → hand (shuffle)
  "sv01-186": POKEGEAR, // Pokégear 3.0 — look at top 7, reveal a Supporter → hand (shuffle)
  // — moveEnergy. —
  "sv01-173": ENERGY_SWITCH, // Energy Switch — move a Basic Energy, own → own
  "sv03-193": POPPY, // Poppy — move up to 2 any Energy, own → own (Supporter)
  // — handRefresh (the hand-refresh Supporter family). —
  "sv01-198": YOUNGSTER, // Youngster — shuffle hand into deck, draw 5
  "sv01-176": JUDGE, // Judge — each player shuffles hand into deck, draws 4
  "sv03-187": BRASSIUS, // Brassius — shuffle hand into deck, draw (hand size + 1)
  "sv01-177": KATY, // Katy — shuffle hand into deck, draw 8, your turn ends
  "sv02-185": IONO, // Iono — each player's hand to the BOTTOM, draw their Prize count
  // — Board conditions. —
  "sv02-181": FIGHTING_AU_LAIT, // Fighting Au Lait — play gate: more Prizes left; heal 60
  "sv02-180": FALKNER, // Falkner — draw 2, +2 more if YOUR Stadium is in play
  "sv02-184": GRUSHA, // Grusha — draw until 5 in hand, until 7 if no Energy on your board
  // — discardEnergy. —
  "sv01-168": CRUSHING_HAMMER, // Crushing Hammer — coin-gated: an Energy off 1 opp Pokémon
  "sv02-182": GIACOMO, // Giacomo — a Special Energy off EACH of the opponent's Pokémon
  "sv03-143": MAWILE, // Mawile — Special Eater (on-bench: a Special Energy off their Active)
  // — The providesEnergy filter. Its typed self-discard family is DERIVED from printed text
  //   (Kilowattrel, Arcanine ex ×2, Charmeleon, Charizard), so it adds no rows here — the rows
  //   below are the filter's SECOND consumer. —
  "sv01-041": ARMAROUGE, // Armarouge — Fire Off ({R} benched→Active, as often as you like)
  // — attachFromTop. —
  "sv01-170": ELECTRIC_GENERATOR, // Electric Generator — top 5, up to 2 Basic {L} → Benched {L}
  "sv02-140": HYDREIGON, // Hydreigon — Tri Howl (top 3, any Energy → your Pokémon, discard rest)
  // — payFromHand. Meowscarada ex (ABOVE, with the mid-turn-damage snipe) runs on this
  //   op too — the two printed wordings, "you must discard … in order to
  //   use this Ability" and "you can use this card only if you discard … other
  //   cards", are one mechanism. —
  "sv01-196": ULTRA_BALL, // Ultra Ball — discard 2 other cards, search a Pokémon → hand
  "sv06.5-096": EARTHEN_VESSEL, // Earthen Vessel — discard another card, search 2 Basic Energy
  "sv08.5-115": LARRYS_SKILL, // Larry's Skill — discard hand, search a Pokémon + a Supporter + a Basic Energy → hand
  "sv06-163": SECRET_BOX, // Secret Box — discard 3 other cards, search an Item + a Tool + a Supporter + a Stadium → hand
  // Explicitly support these rotated cards in existing decks as well as Standard cards.
  "sv01-166": ARVEN,
  "sv01-081": TANDEM_UNIT,
  "sv10-165": ETHANS_ADVENTURE, // Ethan's Adventure — search up to 3 in any combination of Ethan's Pokémon + Basic {R} Energy → hand
  "sv01-142": REVAVROOM, // Revavroom — Rumbling Engine (discard an Energy card, draw to 6)
  "sv02-105": TINKATON, // Tinkaton — Gather Materials (discard a card, draw 3)
  "swsh10.5-018": RADIANT_BLASTOISE, // Radiant Blastoise — Pump Shot (discard a {W}, 2 counters)
  // — The hand cost that is NOT a discard. Dendra pays to the BOTTOM OF THE DECK — the same
  //   op, one field wider; Skwovet reaches the same destination with the WHOLE hand and needs
  //   no op of its own (Iono's handRefresh riders). —
  "sv02-179": DENDRA, // Dendra — a card from hand → deck bottom, then draw to 5
  "sv01-151": SKWOVET, // Skwovet — Nest Stash (hand → deck bottom, draw 1 if any moved)
  // — attachFromDeck.
  //   Search the deck for Energy and attach it; the two printed target rules are
  //   "in any way you like" (Charizard) and "for each of those" (Janine). —
  "sv03-125": CHARIZARD_EX, // Charizard ex — Infernal Reign (onEvolve: up to 3 Basic {R} → your Pokémon)
  "sv06.5-059": JANINES_SECRET_ART, // Janine's Secret Art — up to 2 Basic {D}, one per {D} Pokémon, Active → Poisoned
  // — EffectContext.sourceUid. —
  "sv01-076": PAWMOT, // Pawmot — Electrogenesis (search a Basic {L} → THIS Pokémon)
  // — healChosen "up to N". —
  "sv02-187": SAGUARO, // Saguaro — heal 50 from up to 2 of your Pokémon
  "sv01-192": ROCK_CHESTPLATE, // Rock Chestplate (Tool) — 30 less, gated on the HOLDER's {F}
  "sv02-113": HARIYAMA, // Hariyama — Arm Thrust Practice (10 less, SEAT-WIDE)
  "sv10-086": STONE_PALACE, // Steven's Carbink — Stone Palace (30 less, Steven's only, BENCH SOURCE, DOESN'T STACK)
  "sv07-119": CURLY_WALL, // Bouffalant — Curly Wall (60 less, Basic {C} only, 1 OTHER Bouffalant, DOESN'T STACK)
  "sv10.5b-003": REGAL_CHEER, // Serperior ex — Regal Cheer (20 more, SEAT-WIDE, bare)
  "sv10-008": CHEER_ON_TO_GLORY, // Cynthia's Roserade — Cheer On to Glory (30, Cynthia's only)
  "svp-184": EXTRA_HELPINGS, // Hop's Snorlax — Extra Helpings (30, Hop's only, DOESN'T STACK)
  "sv08-072": WONDER_KISS, // Togekiss — Wonder Kiss (+1 Prize on an Active KO, coin flip, doesn't stack)
  "sv09-037": VIBRANT_DANCE, // Ludicolo — Vibrant Dance (+40 HP side-wide, doesn't stack)
  "sv06-111": OKIDOGI_ADRENA_POWER, // Okidogi — Adrena-Power (+100 HP *and* +100 damage, gated on ANY {D})
  "sv10.5b-049": CONKELDURR_CRAFTSMANSHIP, // Conkeldurr — Craftsmanship (+40 HP per attached {F})
  "sv05-021": BRAMBLEGHAST_RESILIENT_SOUL, // Brambleghast — Resilient Soul (+50 HP per Prize the OPPONENT has taken)
  "sv10.5w-067": GREEDY_EATER, // Hydreigon ex — Greedy Eater (+1 Prize, BASIC KO, by THIS Pokémon's attack)
  "sv09-007": SUNNY_DAY, // Lilligant — Sunny Day (20, {G} OR {R} — the anyOf)
  "sv08-021": VICTORY_CHEER, // Victini — Victory Cheer (10, Evolution {R})
  "sv07-038": PRIMAL_KNOWLEDGE, // Carracosta — Primal Knowledge (30, target Evolution)
  "sv10.5b-067": METALLIC_SIGNAL, // Genesect ex — Metallic Signal (deck → hand, 2 Evolution {M})
  "sv10-030": HURRIED_GAIT, // Rapidash — Hurried Gait (draw a card)
  "sv06-038": ALLURING_LIGHT, // Chandelure — Alluring Light (each player draws a card)
  "sv06-134": HAPPY_SWITCH, // Blissey ex — Happy Switch (move a Basic Energy, own → own)
  "sv10.5w-002": HEALING_LEAVES, // Swadloon — Healing Leaves (heal 20 from your Active)
  "sv09-079": MAMMOTH_HAULER, // Mamoswine ex — Mammoth Hauler (deck → hand, a Pokémon)
  "sv05-017": CHANGING_SEASONS, // Sawsbuck — Changing Seasons (deck → hand, a Stadium card)
  "sv10-033": BONDED_BY_THE_JOURNEY, // Ethan's Quilava — Bonded by the Journey
  "sv10.5w-084": HILDA, // Hilda — an Evolution Pokémon and an Energy card → hand
  "sv06.5-057": COLRESSS_TENACITY, // Colress's Tenacity — a Stadium card and an Energy card → hand
  "sv08-170": CYRANO, // Cyrano — up to 3 Pokémon ex → hand
  "sv06-152": HYPER_AROMA, // Hyper Aroma (ACE SPEC) — up to 3 Stage 1 Pokémon → hand
  "sv10-178": TEAM_ROCKETS_TRANSCEIVER, // Team Rocket's Transceiver — a "Team Rocket" Supporter → hand
  "sv08-176": ENERGY_SEARCH_PRO, // Energy Search Pro (ACE SPEC) — Basic Energy of different types → hand
  "sv08-185": PRECIOUS_TROLLEY, // Precious Trolley (ACE SPEC) — any number of Basic Pokémon → Bench
  "sv05-143": BOXED_ORDER, // Boxed Order — up to 2 Item cards → hand, your turn ends
  "sv06.5-056": CASSIOPEIA, // Cassiopeia — only as the last card in hand; up to 2 cards → hand
  "sv06-147": COOK, // Cook — heal 70 from your Active
  "sv06.5-062": POKE_VITAL_A, // Poké Vital A — heal 150 from 1 of your Pokémon
  "sv09-149": IRISS_FIGHTING_SPIRIT, // Iris's Fighting Spirit — discard another card, draw to 6
  "sv05-146": ERI, // Eri — reveal the opponent's hand, discard up to 2 Item cards
  "sv08-181": MEDDLING_MEMO, // Meddling Memo — the opponent's hand under their deck, draw that many
  "sv10.5b-016": TORRID_SCALES, // Volcarona — Torrid Scales (discard a Basic {R}: Burn)
  "sv10.5w-051": ANCIENT_WING, // Archeops — Ancient Wing (Active only: devolve 1 to hand)
  "sv08-085": BECKONING_TAIL, // Meowstic — Beckoning Tail (discard a Chill Teaser Toy: gust)
  "sv10.5w-023": TORRENTIAL_WHIRLPOOL, // Samurott — Torrential Whirlpool (switch; if you do, switch out)
  "sv10-096": SAND_STREAM, // Team Rocket's Tyranitar — Sand Stream (Checkup, Active: 2 counters on each opposing Basic)
  "sv08-056": SNOW_SINK, // Chien-Pao — Snow Sink (bench from hand: may discard a Stadium)
  "sv06-138": WICKED_TAIL, // Ambipom — Wicked Tail
  "sv08.5-096": BLACK_BELTS_TRAINING, // Black Belt's Training — +40 to the opponent's Active Pokémon ex this turn
  "sv10-171": TEAM_ROCKETS_ARIANA, // Team Rocket's Ariana — draw to 5, or to 8 if all your Pokémon are Team Rocket's
  "sv09-142": BILLY_AND_ONARE, // Billy & O'Nare — draw 2; then at 10+ cards in hand, draw 2 more
  "sv08-172": DRAGON_ELIXIR, // Dragon Elixir — heal 60 from your Active {N} Pokémon
  "sv10-175": TEAM_ROCKETS_GREAT_BALL, // Team Rocket's Great Ball — coin: Evolution / Basic Team Rocket's Pokémon → hand
  "sv06-144": CARETAKER, // Caretaker — draw 2; if you drew any and Community Center is in play, shuffle it into the deck
  "svp-129": TOXIC_SUBJUGATION, // Pecharunt — Toxic Subjugation (Checkup, Active: +50 on the opponent's Poisoned Active)
  "sv06-154": KIERAN, // Kieran — Choose 1: switch your Active, or +30 to ex / V this turn
  "sv10-179": TEAM_ROCKETS_VENTURE_BOMB, // Team Rocket's Venture Bomb — coin: 2 counters on 1 of theirs / on your Active
  "sv05-155": MORTYS_CONVICTION, // Morty's Conviction — discard 1: draw per opponent's Benched Pokémon
  "sv06.5-064": XEROSICS_MACHINATIONS, // Xerosic's Machinations — opponent discards down to 3
  "sv06.5-034": MALAMAR_COLLUDING_TENTACLES, // Malamar — Colluding Tentacles: gust + 120, only after Xerosic's Machinations
  "sv06-157": LUCIAN, // Lucian — both hands under the decks; each player flips: 6 or 3
  "sv10-161": ARVENS_SANDWICH, // Arven's Sandwich — heal 30, or 100 on an Arven's Active
  "sv08-182": MEGATON_BLOWER, // Megaton Blower — all opponent Tools + Special Energy, and a Stadium
  "sv08-164": BRILLIANT_BLENDER, // Brilliant Blender — up to 5 deck cards to the discard pile
  "sv10-181": TM_MACHINE, // TM Machine — up to 3 "Technical Machine" Tools to hand
  "sv08-175": DUSK_BALL, // Dusk Ball — a Pokémon from the bottom 7
  "sv10.5w-085": TOOL_SCRAPPER, // Tool Scrapper — up to 2 Tools off either side
  "sv08-169": COUNTER_GAIN, // Counter Gain — {C} less while you have more Prizes remaining
  "sv09-148": HOPS_CHOICE_BAND, // Hop's Choice Band — Hop's Pokémon: {C} less and +30
  "sv10.5w-080": BRAVE_BANGLE, // Brave Bangle — no Rule Box holder: +30 to an ex
  "sv10.5b-079": AIR_BALLOON, // Air Balloon — Retreat Cost {C}{C} less
  "sv05-159": RESCUE_BOARD, // Rescue Board — {C} less; free at 30 HP or less remaining
  "sv07-137": GRAVITY_GEMSTONE, // Gravity Gemstone — both Actives' Retreat Cost {C} more
  "sv05-148": FULL_METAL_LAB, // Full Metal Lab — {M} Pokémon take 30 less (after W/R)
  "sv10-166": GRANITE_CAVE, // Granite Cave — Steven's Pokémon take 30 less (after W/R)
  "sv09-154": POSTWICK, // Postwick — Hop's Pokémon do 30 more (before W/R)
  "sv09-152": NS_CASTLE, // N's Castle — N's Pokémon have no Retreat Cost
  "svp-150": PARADISE_RESORT, // Paradise Resort — each Psyduck's Retreat Cost {C} less
  "sv05-160": SALVATORE, // Salvatore — evolve 1 of your Pokémon from the deck, no Abilities
  "sv09-056": FAIRY_ZONE, // Lillie's Clefairy ex — Fairy Zone: the opponent's {N} Pokémon are {P}-weak
  "sv05-078": MIDNIGHT_FLUTTERING, // Flutter Mane — Midnight Fluttering: the opposing Active has no Abilities
  "sv08-107": STICKY_BIND, // Gastrodon — Sticky Bind: from the Bench, Benched Stage 2 have no Abilities
  "sv07-110": PUMMELING_PAYBACK, // Orthworm ex — Pummeling Payback: 2 counters per {M} Energy
  "sv09-008": EXPLODING_NEEDLES, // Maractus — Exploding Needles: 6 counters when KO'd in the Active Spot
  "sv10.5b-063": GEAR_COATING, // Klinklang — Gear Coating: {M}-Energy bodies take 20 less
  "sv09-082": ROCK_ARMOR, // Regirock — Rock Armor: 30 less with any Energy attached
  "sv05-085": DIG_DIG_DIG, // Drilbur — Dig Dig Dig: up to 3 Basic {F} Energy to the discard
  "sv10-125": SMOG_SIGNALS, // Team Rocket's Koffing — Smog Signals: 2 "Koffing" to the Bench when hit
  "sv06-015": BOOM_BOOM_GROOVE, // Thwackey — Boom Boom Groove: a card, if the Active has Festival Lead
  "sv08-147": BORN_TO_SLACK, // Slaking ex — Born to Slack: can't attack with no ex / V opposite
  "sv10-092": LOSE_COOL, // Annihilape — Lose Cool: +120 with 2 or more damage counters
  "sv06.5-002": COMPOUND_EYES, // Galvantula — Compound Eyes: +50 into an Active with an Ability
  "sv09-021": MAGMA_SURGE, // Magmortar — Magma Surge: 3 more counters on the opposing Burn
  "sv05-015": WAFTING_HEAL, // Whimsicott — Wafting Heal: heal the Active {G}, discard its Energy
  "sv07-067": TIME_TO_CHOW_DOWN, // Dachsbun ex — Time to Chow Down: heal every Evolution Pokémon
  "sv08-093": OBLIGING_HEAL, // Indeedee — Obliging Heal: heal 30 and recover from a condition
  "sv07-006": SELECTIVE_SLIME, // Cradily — Selective Slime
  "sv06-160": PERRIN, // Perrin — return up to 2 Pokémon, search that many
  "sv07-133": CRISPIN, // Crispin — 2 Basic Energy of different types: 1 to hand, 1 attached
  "sv09-158": SUPER_POTION, // Super Potion — heal 60; if healed, discard an Energy from it
  "sv06-156": LOVE_BALL, // Love Ball — a Pokémon named like one of the opponent's in play
  "sv05-150": HAND_TRIMMER, // Hand Trimmer — each player discards down to 5, opponent first
  "sv06-162": SCOOP_UP_CYCLONE, // Scoop Up Cyclone — 1 of your Pokémon and its cards to hand
  "sv08-186": SCRAMBLE_SWITCH, // Scramble Switch — switch, then move any Energy to the new Active
  "sv06.5-054": ACADEMY_AT_NIGHT, // Academy at Night — a hand card on top of the deck, once a turn
  "sv05-156": PERILOUS_JUNGLE, // Perilous Jungle — 2 more Poison counters on each non-{D}
  "sv08.5-111": HABAN_BERRY, // Haban Berry — 60 less from an opposing {N} attacker, then discard
  "sv07-140": OCCA_BERRY, // Occa Berry — 60 less from an opposing {R} attacker, then discard
  "sv07-141": PAYAPA_BERRY, // Payapa Berry — 60 less from an opposing {P} attacker, then discard
  "sv08-163": BABIRI_BERRY, // Babiri Berry — 60 less from an opposing {M} attacker, then discard
  "sv08-168": COLBUR_BERRY, // Colbur Berry — 60 less from an opposing {D} attacker, then discard
  "sv08-184": PASSHO_BERRY, // Passho Berry — 60 less from an opposing {W} attacker, then discard
  "sv06-164": SURVIVAL_BRACE, // Survival Brace — full HP survives an opposing KO at 10, then discard
  "sv07-134": DELUXE_BOMB, // Deluxe Bomb — 12 counters on the attacker, then discard
  "sv06-158": LUCKY_HELMET, // Lucky Helmet — damaged in the Active Spot: draw 2
  "sv06-150": HANDHELD_FAN, // Handheld Fan — damaged in the Active Spot: attacker's Energy to its Bench
  "sv06-153": JAMMING_TOWER, // Jamming Tower — Tools have no effect
  "sv06-149": FESTIVAL_GROUNDS, // Festival Grounds — Energy-carrying Pokémon: no Special Conditions
  "svp-174": RAINBOW_DNA, // Eevee ex — evolves into any Pokémon ex that evolves from Eevee (hand)
  "sv09-128": TUNING_ECHO, // Noivern — equal hands: Frightening Howl costs nothing
  "sv06.5-047": PLASMA_BANE, // Kyurem — a "Colress" in the opponent's discard: Trifrost for {C}
  "svp-089": TORRENTIAL_HEART, // Feraligatr — 5 counters on itself: +120 this turn
  "svp-126": HEROS_SPIRIT, // Palafin ex — into play only via Zero to Hero
  "sv08-178": JASMINES_GAZE, // Jasmine's Gaze — opponent's next turn: all your Pokémon take 30 less (after W/R)
  "sv08.5-093": AMARYS, // Amarys — draw 4; end of turn, 5+ cards in hand: discard your hand
  "sv10-173": TEAM_ROCKETS_FACTORY, // Team Rocket's Factory — played a "Team Rocket" Supporter this turn: draw 2
  "sv06-146": COMMUNITY_CENTER, // Community Center — played a Supporter this turn: heal 10 from each of your Pokémon
  "sv06.5-029": SHADOWY_ENVOY, // Crobat — played Janine's Secret Art this turn: draw until 8 in hand
  "sv10-045": FLUSTERED_LEAP, // Misty's Psyduck — on the Bench: mill the bottom card; if you did, self to deck top, attachments discarded
  "sv10-089": ROCKET_BRAIN, // Team Rocket's Orbeetle — as often as you like: 1 counter from a Team Rocket's Pokémon to another of yours
  "sv09-157": RUFFIAN, // Ruffian — a Tool and a Special Energy off 1 opponent's Pokémon
  "sv06-132": IMPROMPTU_CARRIER, // Farfetch'd — played to the Bench: search a Tool and attach it to itself
  "sv06-060": ZERO_TO_HERO, // Palafin — Active to Bench, once per turn: switch in a Palafin ex from the deck
  "sv09-146": BROCKS_SCOUTING, // Brock's Scouting — up to 2 Basic Pokémon OR 1 Evolution Pokémon
  "sv06-159": OGRES_MASK, // Ogre's Mask — switch an Ogerpon ex in play with one from the discard pile
  "sv05-151": HEAVY_BATON, // Heavy Baton — Retreat 4 Active KO'd by attack: up to 3 Basic Energy to the Bench
  "sv08-162": AMULET_OF_HOPE, // Amulet of Hope — KO'd by attack: search up to 3 cards
  "sv06.5-063": POWERGLASS, // Powerglass — end of turn in the Active: attach a Basic Energy from the discard
  "sv10-180": TEAM_ROCKETS_WATCHTOWER, // Team Rocket's Watchtower — {C} Pokémon have no Abilities
  "sv09-156": REDEEMABLE_TICKET, // Redeemable Ticket — prizes under the deck, the top N become new prizes
  "sv06-142": ACCOMPANYING_FLUTE, // Accompanying Flute — Basics from the opponent's top 5 onto their Bench
  "sv10-172": TEAM_ROCKETS_BOTHER_BOT, // Team Rocket's Bother-Bot — flip an opponent prize, reveal, may switch
  "sv07-136": GRAND_TREE, // Grand Tree — Stadium: evolve a Basic from the deck, then optionally to Stage 2
  "sv07-142": SPARKLING_CRYSTAL, // Sparkling Crystal — Tool: the Tera holder's attacks cost 1 Energy (any type) less
  "sv08-189": TERA_ORB, // Tera Orb — search a Tera Pokémon
  "sv07-135": GLASS_TRUMPET, // Glass Trumpet — Tera in play: up to 2 Benched {C} get a Basic Energy from the discard
  "sv07-132": BRIAR, // Briar — opponent at exactly 2 Prizes: a Tera attacker's Active KO takes 1 more
  "sv08-042": SPARKLING_SCALES, // Milotic ex — prevent damage and effects of the opponent's Tera Pokémon's attacks
  "sv07-115": JEWEL_SEEKER, // Noctowl — evolved from hand with a Tera in play: search up to 2 Trainers
  "sv08-074": GLISTENING_BUBBLES, // Azumarill — Tera in play: Double-Edge for {P}
  "sv08-161": PRISM_CHARGE, // Terapagos — Prism Charge: up to 3 Basic Energy of different types onto your Tera Pokémon
  "sv05-121": PEAK_ACCELERATION, // Miraidon — Peak Acceleration: up to 2 Basic Energy onto your Future Pokémon
  "sv05-097": LAND_COLLAPSE, // Great Tusk — Land Collapse: mill 1, +3 after an Ancient Supporter
  "sv05-077": SUPPORTIVE_SINGING, // Scream Tail — heal 100 from 1 of your Benched Ancient Pokémon
  "sv08-096": PERPLEXING_TRANSFER, // Flutter Mane — move a Benched Ancient's counters to the Defender
  "sv05-081": COBALT_COMMAND, // Iron Crown ex — your Future Pokémon (not Iron Crown ex) +20 to the Active
  "sv05-141": AWAKENING_DRUM, // Awakening Drum — draw a card per Ancient Pokémon in play
  "sv05-158": REBOOT_POD, // Reboot Pod — a Basic Energy from the discard onto each Future Pokémon
  "sv06-018": FESTIVAL_LEAD, // Dipplin — Festival Lead: attack twice while Festival Grounds is in play
  "sv06-044": FESTIVAL_LEAD, // Goldeen — Festival Lead
  "sv06-089": FESTIVAL_LEAD, // Swirlix — Festival Lead
  "sv08.5-021": FESTIVAL_LEAD, // Seaking — Festival Lead
  "sv06-077": INITIALIZATION, // Iron Thorns ex — Initialization: Active, Rule Box Pokémon have no Abilities, except Future
  "sv05-062": DESTRUCTO_PRESS, // Iron Thorns — Destructo-Press: 70× per Future card in the top 5, discard them
  "sv10.5w-086": IGNITION_ENERGY, // Ignition Energy — {C}, {C}{C}{C} on an Evolution, discarded at the end of your turn
  "sv06-095": ADRENA_BRAIN, // Munkidori — Adrena-Brain: with any {D} attached, move up to 3 counters own → opponent
  "sv06-050": MENTALLY_CALM, // Milotic — Mentally Calm: the opponent's in-play cards can't go to their hand
  "sv10-055": DIVERS_CATCH, // Huntail — Diver's Catch: a {W} body KO'd by an attack keeps its Basic {W} Energy in hand
  "sv07-101": EMERGENCY_ROTATION, // Klinklang — Emergency Rotation: from the hand to the Bench vs a Stage 2
  "sv07-129": PROTECTIVE_COVER, // Antique Cover Fossil — an Item played as a 60-HP Basic {C}; Protective Cover
  "sv07-130": PRIMAL_ROOT, // Antique Root Fossil — Primal Root: Active, the opponent's Basic attackers cost {C} more
  "sv10.5w-079": PLUME_PROTECTION, // Antique Plume Fossil — Plume Protection: Benched, no damage from the opponent's attacks
  "me03-068": INTIMIDATING_JAW, // Antique Jaw Fossil — Intimidating Jaw: Active, the opponent's Active does 30 less
  "me03-069": PROTECTIVE_SAIL, // Antique Sail Fossil — Protective Sail: the opponent's Supporters' effects on it prevented
  "me05-072": PROTECTIVE_ARMOR, // Antique Armor Fossil — Protective Armor: Active, all of yours take 10 less (after W/R)
  "me05-073": SPINY_SKULL, // Antique Skull Fossil — Spiny Skull: Active and damaged, 3 counters on the attacker
  "sv07-131": AREA_ZERO_UNDERDEPTHS, // Area Zero Underdepths — a Tera Pokémon in play: up to 8 on that Bench
  "sv06-166": BOOMERANG_ENERGY, // Boomerang Energy — {C}; discarded by its holder's attack: re-attached after attacking
  "sv08-190": TYME, // Tyme — name a Pokémon in hand; the opponent guesses its HP: right, they draw 4; wrong, you do
  "sv08-037": DOUBLE_TYPE, // Scovillain ex — Double Type: in play, it is {G} and {R}
  "sv08-188": TM_FLUORITE, // Technical Machine: Fluorite — a Tool granting "Fluorite"; discarded at its owner's turn end
  "sv05-084": MEMORY_DIVE, // Relicanth — Memory Dive: your evolved Pokémon use their previous Evolutions' attacks
  "sv10-182": TEAM_ROCKETS_ENERGY, // Team Rocket's Energy — 2 units of {P}/{D}; Team Rocket's Pokémon only
  "sv06-063": UNDULATING_SLICE, // Walking Wake — Undulating Slice: put up to 9 counters on itself, 20× per counter put
  "sv05-118": DUAL_CORE, // Iron Treads — Dual Core: {F} and {M} while a Future Booster Energy Capsule is attached
  "sv05-063": MR_MIME_LOOK_ALIKE_SHOW, // Mr. Mime — Look-Alike Show: reveal the opponent's hand, use 1 Supporter's effect
  "me02.5-214": NEMONA, // Urbain — twin `sv01-180` (Nemona, same text)
  "me02.5-258": NEMONA, // Cheren — twin `sv01-180` (Nemona, same text)
  // Two `30th` Items, `legal_standard = 1`, whose print_key matches no twin: Poké Pad's text spells
  // "doesn’t" with U+2019 where its twin has a straight apostrophe, and Ultra Ball's catalog row has
  // `effect = NULL`. Keyed by NAME on the shipped object: each is the reprint of that card.
  "30th-126": POKE_PAD, // Poké Pad — twin `me02.5-198`
  "30th-128": ULTRA_BALL, // Ultra Ball — twin `sv01-196`
  // — Pokémon, same Abilities —
  "me02.5-079": POWER_SAVER, // Team Rocket's Mewtwo ex — twin `svp-205`
  "me04-002": REDUCE_20_AFTER_WR, // Kakuna — twin `sv01-121` (Stonjourner, same text)
  "me04-052": POISON_POINT, // Qwilfish — twin `sv05-008` (Roselia, same text)
  // — Pokémon, same Ability text under another name, a nameless passive (11) —
  "me02-011": MELT_AWAY, // Charmander — twin `sv10-036` (Ethan's Magcargo, same text)
  "me02-041": REDUCE_30_AFTER_WR, // Mega Diancie ex — twin `sv02-150` (Copperajah ex, same text)
  "me02-070": UNAWARE, // Empoleon ex — twin `sv08-031` (Skeledirge, same text)
  "me05-038": TRAP_TERRITORY, // Mega Chandelure ex — twin `sv01-019` (Spidops ex, same text)
  "30th-028": PRESSURE, // Pikachu — twin `sv03-030` (Entei, same text)
  "30th-033": CURIOUS_TEA_PARTY, // Pikachu — twin `sv06-020` (Poltchageist, same text)
  "30th-096": SECRET_FOREST_PATH, // Zoroark "Nighttime Byway" — twin `sv09-089` (Toedscruel; tcgdex prints {C}{C} as "ColorlessColorless")
  "me02.5-068": COUNTERATTACK_QUILLS, // Hop's Pincurchin ex "Counterattack Quills" — twin `sv01-005` (Cacnea; "place" for "put")
  "me04-073": SMOOTH_COAT, // Cinccino ex "Smooth Coat" — twin `sv08-150` (Kecleon "Expert Hider")
  "me03-017": SHELL_SPIKES, // Turtonator "Shell Spikes" — twin `sv03-120` (Klawf ex "Counterattacking Pincer")
  "me02.5-027": INCANDESCENT_BODY, // Numel "Incandescent Body" — twin `sv03-044` (Armarouge "Scorching Armor"), with Heatran `sv06-123`
  "me05-068": AERIAL_DRAW, // Toucannon "Aerial Draw" — twin `sv10-030` (Rapidash "Hurried Gait")
  "mep-101": SHARE_HAPPINESS, // Nidorina "Share Happiness" — twin `sv09-075` (Alcremie ex "Confectionary Gift")
  "30th-088": SHARE_HAPPINESS, // Nidorina
  "me01-024": INTIMIDATING_FANG, // Pyroar "Intimidating Fang" — twin `sv03-030` (Entei "Pressure"), 30 for 20
  "mep-086": DOPEY_FACE, // Slowpoke "Dopey Face" — twin `sv01-068` (Pachirisu "Electricity Pouches"), Confused for Paralyzed
  "30th-073": FLOAT_UP, // Drifloon "Float Up" (attack 0) — twin `sv08-131` (Gholdengo "Surf Back", attack 1)
  "me03-024": TUNDRA_WALL, // Aurorus "Tundra Wall" — twin `sv10.5b-063` (Klinklang "Gear Coating"), {W} / 50 / no stack
  "me03-019": WASH_OUT, // Dewgong "Wash Out" — twin `sv01-041` (Armarouge "Fire Off"), {W} for {R}
  "me01-084": POWERFUL_A_SALT, // Garganacl "Powerful a-Salt" — twin `sv08-021` (Victini "Victory Cheer"), {F} / 30
  "me02.5-135": COUNTERATTACKING_CREST, // Mega Scrafty ex "Counterattacking Crest" — twin `sv01-005` (Cacnea), 5 counters for 3
  "mep-065": STONE_ARMS, // Barbaracle "Stone Arms" — twin `sv01-054` (Quaquaval "Energy Carnival"), {F} card to an {F} target
  "me03-043": STONE_ARMS, // Barbaracle
  "me03-036": SCENT_COLLECTION, // Aromatisse "Scent Collection" — twin `sv02-061` (Chien-Pao ex "Shivery Chill"), {P}, any spot
  "me02.5-152": SKY_TRANSPORT, // Mega Dragonite ex "Sky Transport" — twin `sv10.5w-023` (Samurott, first sentence)
  "me04-029": SYNCHRO_PULSE, // Ampharos "Synchro Pulse" — Okidogi's field at 80 on Noivern `sv09-128`'s `handSizesEqual`
  "mep-075": SYNCHRO_PULSE, // Ampharos
  "me02.5-117": DOUBLE_TYPE_FP, // Carbink "Double Type" — twin `sv08-037` (Scovillain ex), {F}{P} for {G}{R}
  "me02-094": WONDROUS_PATCH, // Wondrous Patch — twin `sv09-153` (N's PP Up), {P} card to a Benched {P} body
  "me04-079": PHILIPPE, // Philippe — up to 2 Basic {M} from the discard to 1 {M} body (`count: 2`)
  "me03-075": JACINTHE, // Jacinthe — twin `sv06.5-062` (Poké Vital A), 150 to a {P} body
  "me02-089": FIREBREATHER, // Firebreather — twin `sv02-061` (Chien-Pao ex "Shivery Chill"), 7 Basic {R}
  "me01-116": FIGHTING_GONG, // Fighting Gong — twin `sv10-165` (Ethan's Adventure), Basic {F} Energy or Basic {F} Pokémon
  "me03-085": TARRAGON, // Tarragon — twin `sv08.5-116` (Max Rod), 4, {F} Pokémon and Basic {F} Energy
  "me02.5-198": POKE_PAD, // Poké Pad — twin `sv05-153` (Master Ball), no Rule Box
  "me03-073": ENERGY_SWATTER, // Energy Swatter — twin `sv03-190` (Ortega), an Energy card, no draw
  "me01-126": REPEL, // Repel — the derived attack sentence's `opponentSwitchOut`
  "me02.5-185": CANARI, // Canari — twin `sv06.5-096` (Earthen Vessel), up to 4 {L} Pokémon
  "me01-119": LILLIES_DETERMINATION, // Lillie's Determination — twin `sv07-139` (Lacey), exactly 6 Prizes: 8 else 6
  "me05-080": MISTYS_VITALITY, // Misty's Vitality — up to 4 Basic {W} to 1 body (`oneTarget`), turn ends
  "me03-084": ROSAS_ENCOURAGEMENT, // Rosa's Encouragement — behind on Prizes; up to 2 Basic to 1 Stage 2 (`stage2Only`)
  "me05-081": RUST_SYNDICATE_GRUNT, // Rust Syndicate Grunt — last-turn KO gate; an Energy off 1 opponent body
  "me02.5-215": WAITRESS, // Waitress — twin `sv01-170` (Electric Generator), top 6, 1 Basic Energy
  "me03-074": HOLE_DIGGING_SHOVEL, // Hole-Digging Shovel — the derived "Discard the top 2 cards of your deck."
  "me03-078": LUMIOSE_GALETTE, // Lumiose Galette — Obliging Heal's program at 20
  "me02.5-182": ANTHEA_AND_CONCORDIA, // Anthea & Concordia — Briar's shape at 3 on N's Pokémon, six-name gate
  "me04-077": EMMA, // Emma — reveal, then a card per Pokémon in the opponent's hand (`per` cardsInOpponentHand)
  "me01-123": POKEMON_CENTER_LADY, // Pokémon Center Lady — heal 60, a picked Active recovers (`recoverHealed`)
  "me04-076": AZS_TRANQUILITY, // AZ's Tranquility — switch; heal 80 from the demoted body if it is an ex
  "me02-090": GRIMSLEYS_MOVE, // Grimsley's Move — top 7, a {D} Pokémon to the Bench, rest under; not turn one
  "me05-078": GWYNN, // Gwynn — discard up to 2 non-Rule-Box Pokémon, draw 3 each (`per` recorded)
  "me03-079": NAVEEN, // Naveen — discard any number, draw to 5; a non-empty deck to play
  "mep-081": MORTAL_SHURIKEN, // Mega Greninja ex — Meowscarada ex `sv02-015`'s shape at {W}, 60, `opponentAny`, Active only
  "me04-022": MORTAL_SHURIKEN, // Mega Greninja ex
  "me01-056": PSYCHIC_DRAW_3, // Alakazam — draw 3 (confirm)
  "mep-003": PSYCHIC_DRAW_3, // Alakazam
  "me01-055": PSYCHIC_DRAW_2, // Kadabra — draw 2 (confirm)
  "me02-047": PRISON_PANIC, // Brambleghast — Confused (confirm)
  "me01-063": ENERGIZED_STEPS, // Grumpig — top 4, any Basic Energy
  "me01-073": HEAVE_HO_CATCHER, // Hariyama — Defiant Horn's gust
  "me01-017": CAST_OFF_SHELL, // Ninjask — a Shedinja onto the Bench
  "me05-020": ENRICHING_MELODY, // Primarina — Enriching Oil's heal
  "me02.5-012": MULTIPLYING_COCOON, // Silcoon — a Silcoon or a Cascoon onto the Bench
  "me01-097": HAPHAZARD_HAMMER, // Tinkatuff — coin, then an Energy off the opponent's Active
  "me01-104": RUN_ERRAND, // Mega Kangaskhan ex — draw 2, Active only, one Run Errand per turn
  "mep-025": RUN_ERRAND, // Mega Kangaskhan ex
  "me02.5-053": ALLURING_WINGS, // Frosmoth — each player draws a card, Active only
  "mep-096": FIERY_FLAPPING, // Moltres — Articuno and Zapdos in play; a Basic {R} from hand to itself
  "30th-011": FIERY_FLAPPING, // Moltres ("Basic Fire Energy card")
  "mep-098": FLASH_POP_FLAPPING, // Zapdos — Moltres and Articuno in play; a Basic {L}
  "30th-055": FLASH_POP_FLAPPING, // Zapdos ("Basic Lightning Energy card")
  "mep-097": FROSTY_FLAPPING, // Articuno — Moltres and Zapdos in play; a Basic {W}
  "30th-018": FROSTY_FLAPPING, // Articuno ("Basic Water Energy card")
  "me01-074": LUNAR_CYCLE, // Lunatone — Solrock in play; discard a Basic {F}, draw 3; one Lunar Cycle per turn
  "mep-004": LUNAR_CYCLE, // Lunatone
  "me04-013": FLARING_MAGIC, // Delphox — discard a Basic {R}, draw until 7
  "mep-074": FLARING_MAGIC, // Delphox ("Basic Fire Energy card")
  "mep-006": BALLOON_RETURN, // Drifblim "Balloon Return" (attack 1) — twin `sv09-068` (Lillie's Comfey "Fade Out", attack 1)
  "me03-062": TUCK_TAIL, // Meowth ex — "Tuck Tail" (attack 0) and the Ability "Last-Ditch Catch"
  "me04-030": SKY_RETURN, // Emolga "Sky Return" (attack 1)
  "me06-006": FADE_OUT, // Combee "Fade Out" (attack 0)
  "me03-027": FIGHTING_ROAR, // Luxio "Fighting Roar" — evolve early if the opponent's Active is a Pokémon ex
  "me04-007": NEEDLY_ARMOR, // Chesnaught "Needly Armor" — 3 counters per {G} Energy on the Attacking Pokémon
  "me02-056": SHADOWY_CONCEALMENT, // Mega Gengar ex — 1 fewer Prize for a {D} body KO'd by an ex's attack
  "mep-073": SHADOWY_CONCEALMENT, // Mega Gengar ex
  "me02.5-116": TENACIOUS_BODY, // Mega Hawlucha ex — coin-flip survival on 10 HP
  "me05-041": DURABLE_BODY, // Annihilape — Tenacious Body's sentence
  "me01-061": FRAGILE_HUSK, // Shedinja — no Prize for a KO by an ex's attack
  "me03-050": INFINITE_SHADOW, // Gengar — KO'd by an attack, the Pokémon goes to the hand
  "me02.5-143": FINAL_CHAIN, // Pecharunt — KO'd by an attack, search the deck for a card
  "me05-070": CALL_A_BUDDY, // Silvally — no cards in hand; a Supporter from the deck
  "me02.5-007": GATHERING_OF_BLOSSOMS, // Erika's Tangela — an Erika's Pokémon from the deck
  "30th-008": GUIDING_DANCE, // Vivillon — coin; heads, a Pokémon from the deck
  "me01-011": FERMENTED_JUICE, // Shuckle — any {G} Energy on itself; heal 30 from 1 of your Pokémon
  "me02.5-003": LOVELY_FRAGRANCE, // Erika's Vileplume ex — heal 30 from each of your Pokémon
  "30th-105": SUNRISE, // Solgaleo — on the Bench; up to 2 Basic {M} from the deck to itself
  "mep-024": EXCITED_TURBO, // Oricorio ex — any {R} Mega ex in play; a Basic {R} from hand to a Benched {R}
  "me02-018": EXCITED_TURBO, // Oricorio ex
  "me02-007": EXCITED_HEAL, // Ludicolo — any {G} Mega ex in play; heal 60 from 1 of your Pokémon
  "me02-082": EXCITED_DASH, // Linoone — on the Bench, any Mega ex in play; switch with the Active
  "me02-062": EXCITED_POWER, // Seviper — any {D} Mega ex in play; its attacks +120 before W/R
  "me01-121": MEGA_SIGNAL, // Mega Signal — a Mega Evolution Pokémon ex from the deck
  "me05-079": JETT, // Jett — a card per opponent's Mega Evolution Pokémon ex in play
  "me03-086": GROWING_GRASS_ENERGY, // Growing Grass Energy — {G}; the {G} holder +20 HP
  "me03-087": ROCKY_FIGHTING_ENERGY, // Rocky Fighting Energy — {F}; the {F} holder's attack-effects shield
  "me03-088": TELEPATHIC_PSYCHIC_ENERGY, // Telepathic Psychic Energy — {P}; onto a {P}: up to 2 Basic {P} to the Bench
  "me04-084": BUBBLY_WATER_ENERGY, // Bubbly Water Energy — {W}; the {W} holder recovers / is immune
  "me04-085": MAGNETIC_METAL_ENERGY, // Magnetic Metal Energy — {M}; the {M} holder has no Retreat Cost
  "me04-086": NITRO_FIRE_ENERGY, // Nitro Fire Energy — {R}; its {R} holder's attack discards it: to the hand
  "me05-083": SHADOWY_DARKNESS_ENERGY, // Shadowy Darkness Energy — {D}; the Benched {D} holder takes no attack damage
  "me05-084": VOLTAIC_LIGHTNING_ENERGY, // Voltaic Lightning Energy — {L}; the {L} holder's attacks +20 before W/R
  "me04-080": PRISM_TOWER, // Prism Tower — discard 2 from hand, draw 1
  "me01-129": SURFING_BEACH, // Surfing Beach — Active {W} switches with a Benched {W}
  "me02.5-197": NIGHTTIME_MINE, // Nighttime Mine — each Tera Pokémon's attacks cost {C} more
  "me03-077": LUMIOSE_CITY, // Lumiose City — a Basic from the deck to the Bench; the turn ends
  "mep-028": CELEBRATORY_FANFARE, // Celebratory Fanfare — heal 10 from each; healed any: the turn ends
  "me02-085": BATTLE_CAGE, // Battle Cage — no counters onto a Benched body from the opponent's attacks / Abilities
  "me01-122": MYSTERY_GARDEN, // Mystery Garden — discard an Energy card, draw until hand = your {P} in play
  "me01-117": FOREST_OF_VITALITY, // Forest of Vitality — {G} into {G} the turn it is played, not turn one
  "me02-093": SACRED_CHARM, // Sacred Charm — 30 less from an opposing Pokémon that has an Ability
  "me02.5-211": THICK_SCALE, // Thick Scale — a {N} holder takes 50 less from an opposing {G}/{R}/{W}/{L}
  "me02-022": THICK_FAT, // Dewgong "Thick Fat" — 30 less from an opposing {R} or {W}
  "me02.5-064": FRILLED_GENERATOR, // Heliolisk — played Canari this turn: up to 2 Basic {L} from the deck to itself
  "me02.5-191": LIGHT_BALL, // Light Ball — a Pikachu ex holder does 50 more to an opposing Active ex
  "me02-092": PUNK_HELMET, // Punk Helmet — a {D} Active holder damaged: 4 counters on the attacker
  "me02.5-206": TEAM_ROCKETS_HYPNOTIZER, // Team Rocket's Hypnotizer — a Team Rocket's Active holder damaged: the attacker Asleep
  "me03-070": CORE_MEMORY, // Core Memory — a Mega Zygarde ex holder can use "Geobuster"
  "me05-082": TREMENDOUS_BOMB, // Tremendous Bomb — 240+ from an opposing Mega ex: 12 counters, then discard
  "me05-077": GLADIONS_FINAL_BATTLE, // Gladion's Final Battle — last card in hand: no-Rule-Box attackers +80 this turn
  "me01-124": PREMIUM_POWER_PRO, // Premium Power Pro — {F} attackers +30 this turn
  "me01-113": ACEROLAS_MISCHIEF, // Acerola's Mischief — one chosen body: no damage or effects from opposing ex next turn
  "me04-081": ROXIES_PERFORMANCE, // Roxie's Performance — the opponent's Poisoned Pokémon can't retreat next turn
  "me02-087": DAWN, // Dawn — search a Basic, a Stage 1 and a Stage 2 Pokémon
  "me04-082": SPECIAL_RED_CARD, // Special Red Card — opponent at 3 or fewer Prizes: their hand under, they draw 3
  "me02-091": JUMBO_ICE_CREAM, // Jumbo Ice Cream — heal 80 from your Active with 3 or more Energy
  "me05-075": DARK_BELL, // Dark Bell — both Active non-{D} Pokémon are now Confused
  "me01-132": WALLYS_COMPASSION, // Wally's Compassion — heal all from a Mega ex; if healed, its Energy to hand
  "me02-086": BLOWTORCH, // Blowtorch — discard a Basic {R}; then a Tool, a Special Energy or a Stadium
  "me04-078": GREAT_HAUL_NET, // Great Haul Net — up to 3 {W} Pokémon and up to 3 Basic {W} Energy back, shuffle
  "me01-128": STRANGE_TIMEPIECE, // Strange Timepiece — devolve your evolved {P} Pokémon; it can't evolve this turn
  "mep-016": SANDY_FLAPPING, // Flygon — on evolve, or KO'd in the Active Spot by an attack: may mill the opponent 2
  "me02-053": SANDY_FLAPPING, // Flygon
  "mep-082": PHOTON_CORD, // Miraidon — KO'd in the Active Spot by an attack: up to 2 Basic {L} to 1 Benched Pokémon
  "me05-028": PHOTON_CORD, // Miraidon
  "30th-090": FAINTING_SPELL, // Gengar ex — KO'd by an attack: flip, heads Knocks Out the Attacking Pokémon
  "me04-074": ADVERSITY_POLICY, // Adversity Policy — a Weak Active holder damaged by an attack: draw 3
  "me05-005": HIDE_N_SNEAK, // Poltchageist — prevent the opponent's attack and Ability effects on it
  "me05-006": HIDE_N_SNEAK, // Sinistcha
  "me05-033": HIDE_N_SNEAK, // Shuppet
  "me05-034": HIDE_N_SNEAK, // Banette
  "me01-101": LUSTROUS_ASSIST, // Latios — after your Mega Latias ex moved up this turn: Bench Energy to the Active
  "me02.5-175": LETHARGIC_CHARGE, // Larry's Komala — from the Bench: an Energy card from hand to your Active Larry's Pokémon
  "me01-118": IRON_DEFENDER, // Iron Defender — opponent's next turn: your {M} Pokémon take 30 less (after W/R); stacks
  "mep-085": ANCIENT_BULWARK, // Bastiodon — on your Bench: no damage to your Pokémon from attackers with 2 or less Energy
  "me05-062": ANCIENT_BULWARK, // Bastiodon
  "me03-012": SNIPERS_EYE, // Decidueye ex — opponent's hand exactly 4: ignore all {C} in this Pokémon's attack costs
  "me02.5-148": SUPREME_OVERLORD, // Kingambit — +30 before W/R per Prize the opponent has taken
  "me04-057": GLOOMY_GARBAGE, // Garbodor — the opponent's Tool-carrying Active's attacks do 20 less before W/R
  "30th-100": LIFE_LOCKED, // Yveltal — the opponent's Active can't be healed
  "30th-119": GOOD_SLEEP, // Snorlax — Checkup, still Asleep: heal all damage from it
  "me02.5-039": DAMP_KNOCK_OUT_ITSELF, // Psyduck — both sides lose any Ability that Knocks Out its own user
  "me02.5-040": DAMP_KNOCK_OUT_ITSELF, // Golduck
  "mep-007": DAMP_REQUIRE_KNOCKED_OUT, // Psyduck — the "require those Pokémon to be Knocked Out" wording
  "mep-008": DAMP_REQUIRE_KNOCKED_OUT, // Golduck
  "me05-076": FOSSIL_QUARRY, // Fossil Quarry — up to 2 Antique Items from the deck onto the Bench, then shuffle
  "me01-038": FALL_BACK_TO_RELOAD, // Clawitzer — moved Active→Bench this turn: up to 2 Basic {W} from hand to it
  "30th-066": MEMORY_HELIX, // Mew ex — Memory Helix: it can use the attacks of your Benched Pokémon
  "me01-120": LT_SURGES_BARGAIN, // Lt. Surge's Bargain — the opponent answers: each player takes a Prize, or you draw 4
  "me01-087": SPITEFUL_SWIRL, // Spiritomb — your Active {D} damaged by an attack: 1 counter on the Attacking Pokémon
  "30th-022": COUNTERATTACK_GROUPING, // Wishiwashi — your Active Wishiwashi damaged by an attack: 3 counters on it
  "me01-127": RISKY_RUINS, // Risky Ruins — a Basic non-{D} put onto its owner's Bench on their turn: 2 counters
  "me02-088": DIZZYING_VALLEY, // Dizzying Valley — Confused Pokémon stay Confused when they evolve or devolve
  "me04-075": ANGE_FLOETTE, // Ange Floette — only over a Prism Tower; each Mega Floette ex in play +150 HP
  "me02-029": MULTI_ADAPTER, // Rotom ex — each of your Rotom Pokémon may have up to 2 Pokémon Tools attached
  "me01-028": EXPLOSIVENESS, // Cinderace — may be put face down into the Active Spot at setup
  "me04-070": WATCHFUL_EYE, // Patrat — damage counters can't be moved
  "30th-004": SUPEREFFECTIVE_PHEROMONES, // Illumise — with Volbeat in play, Weakness for both Actives is ×3
  "me04-063": STARTLING_DROP, // Ferrothorn — milled by the opponent on their turn: their top 8 discarded
  "me04-083": TRANSFORMATION_TOME, // Transformation Tome — play 2 at once; switch a Basic in play with one in the discard
  "me01-010": WILD_GROWTH, // Meganium — each Basic {G} Energy on your Pokémon provides {G}{G}
  "mep-001": WILD_GROWTH, // Meganium
  "me04-068": SLIMY_SLIDING, // Goodra — the opponent's retreat flips a coin; tails, it doesn't happen
  "me05-074": BACKTRACK_BADGE, // Backtrack Badge — once a turn, the {C} holder's attack coins may be flipped again
  "30th-064": PHOTON_BULLETS, // Mewtwo ex "Photon Bullets" (attack 0) — 50 to each of the opponent's Pokémon ex
  "me01-003": SOLAR_TRANSFER, // Mega Venusaur ex — as often as you like: a Basic {G} between your Pokémon
  "mep-013": SOLAR_TRANSFER, // Mega Venusaur ex
  "me02.5-084": BUBBLE_GATHERING, // Azumarill ex — as often as you like: an Energy from another of yours to itself
  "me04-064": METAL_ROAD, // Cobalion ex — moved up this turn: any {M} from your other Pokémon to itself
  "me02-036": SWIRLING_PROSE, // Mismagius ex — Active: the opponent's new Active (after a bench move) is Confused
  "me02.5-101": HOLES, // Team Rocket's Dugtrio — 2 counters on the opponent's Active that moved to the Bench
  "mep-094": SCALE_UP, // Alolan Exeggutor — 6 or more {G} Energy attached: +250 HP
  "30th-002": SCALE_UP, // Alolan Exeggutor ("Grass Energy")
  "mep-066": TYRANNICALLY_GUTSY, // Tyrantrum — any Special Energy attached: +150 HP
  "me03-045": TYRANNICALLY_GUTSY, // Tyrantrum
  "me04-051": NIGHTTIME_MANEUVERS, // Crobat — Active: a card from the deck onto its top
  "mep-076": NIGHTTIME_MANEUVERS, // Crobat
  "me02-068": SINISTER_SURGE, // Toxtricity — a Basic {D} to a Benched {D} body, 2 counters on it
  "mep-017": SINISTER_SURGE, // Toxtricity
  "me02.5-015": BOISTEROUS_WIND, // Dustox — heads: an Energy off the opponent's Active into their hand
  "me05-045": DESTRUCTIVE_HEADBUTTING, // Rampardos ex — Active, heads: discard an Energy off the opponent's Active
  "me01-110": EVIDENCE_GATHERING, // Gumshoos — switch a hand card with the deck's top card
  "me03-014": SKY_HUNT, // Talonflame — heads: discard a random card from the opponent's hand
  "me03-009": GRAND_WING, // Vivillon — the opponent's hand under their deck; any moved: they draw 4
  "me04-038": SPITEFUL_EVOLUTION, // Phantump — evolve from hand, 2 counters on the evolved body
  "me02.5-151": EVOLUTIONARY_GUIDANCE, // Dragonair — any Energy attached: an Evolution Pokémon from the deck
  "mep-072": LUMINOUS_WING, // Mega Clefable ex — prevent the opponent's Abilities' effects done to it
  "me03-031": LUMINOUS_WING, // Mega Clefable ex
  "sv06-002": REDUCE_30_AFTER_WR, // Tangrowth — "Thicket Body" (mark H)
  "sv07-125": REDUCE_30_AFTER_WR, // Dubwool — "Soft Wool" (mark H)
  "sv08-054": REDUCE_30_AFTER_WR, // Cetitan — "Solid Body" (mark H)
  "sv10-108": REDUCE_30_AFTER_WR, // Mudsdale — "Mud Coat" (mark I)
  "sv10.5w-077": REDUCE_30_AFTER_WR, // Bouffalant ex — "Bouffer" (mark I)
  // "This Pokémon takes 20 less damage …", as on Stonjourner `sv01-121` and Bouffalant `sv03-174`.
  "sv05-010": REDUCE_20_AFTER_WR, // Turtwig — "Solid Shell" (mark H)
  "sv08.5-088": REDUCE_20_AFTER_WR, // Furfrou — "Fur Coat" (mark H)
  // — "If this Pokémon is in the Active Spot and is damaged by an attack from
  //   your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage
  //   counters on the Attacking Pokémon." — 3 legal printings (4 in the catalog). —
  "sv05-139": COUNTERATTACK_QUILLS, // Iron Jugulis — "Automated Combat" (mark H)
  "sv08-049": COUNTERATTACK_QUILLS, // Bruxish — "Counterattack" (mark H)
  // — the same antecedent with a BURN consequent — 1 legal printing (1 in the
  //   catalog); the trigger, not the passive. —
  "sv06-123": INCANDESCENT_BODY, // Heatran — "Incandescent Body"
  "sv08.5-067": HARIYAMA, // Bronzong — "Protective Bell" (mark H)
  // — Trainers. "Draw 3 cards." — 3 legal printings (6 in the catalog), on two
  //   card NAMES that are neither of them Nemona: the sentence is the key, not
  //   the name. —
  "sv08.5-109": NEMONA, // Friends in Paldea (Supporter, mark H)
  "sv05-008": POISON_POINT, // Roselia — "Poison Point" (mark H)
  "sv05-009": POISON_POINT, // Roserade — "Poison Point" (mark H)
  "sv10.5b-056": POISON_POINT, // Scolipede — "Poison Point" (mark I)
  "sv09-098": NS_ZOROARK_EX, // N's Zoroark ex — "Trade" (mark H)
  "sv07-107": METAL_BRIDGE, // Archaludon — "Metal Bridge" (mark H)
  "sv10-122": TEAM_ROCKETS_CROBAT_EX, // T.R.'s Crobat ex — "Biting Spree" and "Assassin's Return"
  // — 3 printings each. —
  "svp-118": ATTRACT_CUSTOMERS, // Tatsugiri — "Attract Customers" (promo, mark H)
  "sv09-031": SCALDING_STEAM, // Volcanion ex — "Scalding Steam" (mark I)
  "sv08-004": SUDDEN_SHEARING, // Durant ex — "Sudden Shearing" (mark H)
  // — 2 printings each. —
  "sv08-009": CALMING_LIGHT, // Shiinotic — "Calming Light" (mark H)
  "sv10.5w-013": INFERNO_FANDANGO, // Emboar — "Inferno Fandango" (mark I)
  "sv06-148": ENHANCED_HAMMER, // Enhanced Hammer (Item, mark H)
  "sv10.5b-082": FENNEL, // Fennel (Supporter, mark I)
  "sv08-167": CLEMONTS_QUICK_WIT, // Clemont's Quick Wit (Supporter, mark I)
  "sv08-076": SKYLINER, // Latias ex — "Skyliner" (Ability)
  "svp-211": DISTORTED_FUTURE, // Gothitelle — "Distorted Future" (Ability, promo)
  "sv10.5w-043": DISTORTED_FUTURE, // Gothitelle (set printing) — same sentence
  "svp-114": PICNICKER, // Picnicker (Supporter, mark H) — flip: draw 4, else draw 2
  "sv08-173": DRASNA, // Drasna (Supporter, mark I) — shuffle-and-draw 8, else 3
  "sv10.5w-083": HARLEQUIN, // Harlequin (Supporter, mark I) — 5/3 on heads, 3/5 on tails
  "sv06-165": UNFAIR_STAMP, // Unfair Stamp (Item, mark H) — gate + 5/2 perSeat refresh
  "sv06-151": HASSEL, // Hassel (Supporter, mark H) — gate + lookAtTopN 8/3
  "sv10-170": TEAM_ROCKETS_ARCHER, // Team Rocket's Archer (Supporter, mark I) — owner-gated 5/3
  "sv06.5-061": NIGHT_STRETCHER, // Night Stretcher (Item, mark H)
  "sv08-171": DEDUCTION_KIT, // Deduction Kit (Item, mark H) — 1 legal printing of 1
  "sv07-138": KOFU, // Kofu (Supporter, mark H)
  "sv05-154": MAXIMUM_BELT, // Maximum Belt (Tool, mark H)
  "sv06.5-055": BINDING_MOCHI, // Binding Mochi (Tool, mark H)
  "sv09-150": LEVINCIA, // Levincia (Stadium, mark I)
  "sv09-159": SPIKY_ENERGY, // Spiky Energy (Special Energy, mark I)
  "sv05-161": MIST_ENERGY, // Mist Energy — the effects-only shield, borne by an ENERGY
  "sv08-191": ENRICHING_ENERGY, // Enriching Energy — draw 4 on attach from hand
  "sv05-162": NEO_UPPER_ENERGY, // Neo Upper Energy — the CONDITIONAL provision (Stage 2)
  "sv10.5b-086": PRISM_ENERGY, // Prism Energy — the same shape, gated on Basic
  // Reversal Energy: the same shape behind a three-term antecedent (Evolution, no Rule Box, more
  // Prizes remaining).
  "sv04-266": REVERSAL_ENERGY,
  "sv06-167": LEGACY_ENERGY, // Legacy Energy (ACE SPEC Special Energy, mark H)
  "sv09-151": LILLIES_PEARL, // Lillie's Pearl (Pokémon Tool, mark I)
  // — 1 printing each. Cheap because each is a re-parameterisation of a program
  //   already above; kept because a registry row is keyed by id and a printing
  //   nobody names stays unsimulated forever. —
  "sv10-121": SNEAKY_BITE, // Team Rocket's Golbat — "Sneaky Bite" (mark I)
  "sv09-136": DEFIANT_HORN, // Hop's Dubwool — "Defiant Horn" (mark I)
  "sv09-024": SEETHING_SPIRIT, // Blaziken ex — "Seething Spirit"
  "sv10-020": CHARGING_UP, // Team Rocket's Spidops — "Charging Up" (mark I)
  "sv10.5b-031": DYNAMOTOR, // Eelektrik — "Dynamotor" (mark I)
  "sv08-130": ASSEMBLE_ALLOY, // Archaludon ex — "Assemble Alloy" (mark H)
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
  "sv06.5-058": DANGEROUS_LASER, // Dangerous Laser (Item)
  "sv06-155": LANAS_AID, // Lana's Aid (Supporter, mark H)
  "sv10-159": GREEDY_ORDER, // Arven's Greedent — "Greedy Order" (mark I)
  "sv05-144": BUDDY_BUDDY_POFFIN, // Buddy-Buddy Poffin (Item, mark G→H reprint chain)
  "sv10.5b-024": GENTLE_FIN, // Alomomola — "Gentle Fin" (mark I)

  "sv10-103": CHAMPIONS_CALL, // Cynthia's Gabite — "Champion's Call" (Ability, mark I)
  "sv10-050": SWIM_TOGETHER, // Misty's Lapras — "Swim Together" (attack 0, mark I)
  "sv09-147": HOPS_BAG, // Hop's Bag (Item, mark I)
  "sv10-083": SUMMONING_SIGN, // Steven's Baltoy — "Summoning Sign" (attack 0, mark I)
  "sv09-068": LILLIES_COMFEY, // Lillie's Comfey — "Inviting Flowers" (attack 0) and "Fade Out" (attack 1)
  "sv10-169": SPIKEMUTH_GYM, // Spikemuth Gym (Stadium, mark I) — nothing new
  "sv09-053": IONOS_BELLIBOLT_EX, // Iono's Bellibolt ex — "Electric Streamer"
  "sv09-153": NS_PP_UP, // N's PP Up (Item, mark I)
  "sv10-136": MARNIES_GRIMMSNARL_EX, // Marnie's Grimmsnarl ex — "Punk Up"
  // Team Rocket's Wobbuffet's counter move needs no registry entry: the `COUNTER_MOVE_TO_DEFENDER`
  // reader in effects.ts derives it.
  "sv10-039": ETHANS_HO_OH_EX, // Ethan's Ho-Oh ex — "Golden Flame"
  "sv07-139": LACEY, // Lacey — shuffle hand into deck, draw 4 (8 instead if opp ≤ 3 Prizes)
  "sv10-163": EMCEES_HYPE, // Emcee's Hype — draw 2, +2 more if opp has ≤ 3 Prizes left
  "svp-166": TEAL_DANCE, // Teal Mask Ogerpon ex — "Teal Dance" (promo, mark H)
  "sv07-014": RIPENING_CHARGE, // Hydrapple ex — "Ripening Charge" (mark H)
  "sv06.5-025": BATTLE_HARDENED, // Bloodmoon Ursaluna — "Battle-Hardened" (mark H)
  "svp-182": FLASHING_DRAW, // Iono's Kilowattrel — "Flashing Draw" (promo, mark I)
  "sv08-165": CALL_BELL,
  "sv08-166": CHILL_TEASER_TOY,
  "sv07-128": TERAPAGOS_EX_UNIFIED_BEATDOWN,
  "sv06-010": ILLUMISE_SLOWING_PERFUME,
  "sv06-094": SCREAM_TAIL_EX_SCREAM,
  "sv06-009": VOLBEAT_QUICK_SIGN,
  "sv08-001": EXEGGCUTE_PRECOCIOUS_EVOLUTION,
  "sv08.5-081": MILTANK_MOOMOO_ROLLING,
  "sv08-086": SYLVEON_EX_ANGELITE,
  "sv06-145": CARMINE,
  "sv10-177": TEAM_ROCKETS_PROTON,
  "sv10.5b-083": NS_PLAN,
  "svp-205": POWER_SAVER, // Team Rocket's Mewtwo ex — "Power Saver" (promo)
  "svp-177": SEASONED_SKILL, // Bloodmoon Ursaluna ex — "Seasoned Skill" (promo)
  "sv10.5b-044": DEBUT_PERFORMANCE, // Meloetta ex — "Debut Performance"
  "sv08-143": BOOSTED_EVOLUTION, // Eevee — "Boosted Evolution"
  "sv10.5b-009": STIMULATED_EVOLUTION_KARRABLAST, // Karrablast — "Stimulated Evolution"
  "sv10.5w-008": STIMULATED_EVOLUTION_SHELMET, // Shelmet — "Stimulated Evolution"
  // Four printings and two card names share `FOOD_PREP` because the printed sentence is the same.
  "svp-134": FOOD_PREP, // Crabominable — "Food Prep" (promo)
  "sv07-045": FOOD_PREP, // Veluza — the SAME sentence on a different card
  "sv05-034": HUSTLE_PLAY, // Incineroar ex — "Hustle Play"
  "sv06-088": CAPTIVATING_INVITATION, // Florges — the coin-gated gust + Confusion
  "sv10-176": TRAINER_SEARCH, // Team Rocket's Petrel — `trainerCard`'s first consumer
  "sv08-179": LISIAS_APPEAL, // Lisia's Appeal — `gust.basicOnly`'s only consumer
  "sv08-174": DRAYTON, // Drayton — `lookAtTopN.also`'s only consumer
  "sv08.5-127": ROTO_STICK, // Roto-Stick — `lookAtTopN.max: "any"`'s only registry consumer
  "sv06-143": BUG_CATCHING_SET, // Bug Catching Set — `anyOf`'s SECOND live prompt consumer
  "sv05-147": EXPLORERS_GUIDANCE, // Explorer's Guidance — `exact` and `lookAtTopN.restTo: "discard"`'s only consumer
  "sv06-129": DRAKLOAK, // Drakloak "Recon Directive" — `lookAtTopN.restTo: "bottom"`'s only consumer
  "sv04-172": RIKA, // Rika — `lookAtTopN.restTo: "shuffledBottom"`'s only consumer (OUT OF STANDARD)
  "svp-128": RAPID_VERNIER, // Iron Leaves ex — "Rapid Vernier" (promo)
  "sv09-018": SHOWTIME, // Meowscarada — "Showtime"
  "sv06-112": CORNERSTONE_STANCE, // Cornerstone Mask Ogerpon ex — "Cornerstone Stance"
  "sv10.5b-023": MIGHTY_SHELL, // Carracosta — "Mighty Shell"
  "sv06-020": CURIOUS_TEA_PARTY, // Poltchageist — "Storehouse Hideaway"
  "sv10-048": CURIOUS_TEA_PARTY, // Misty's Magikarp — "So Submerged", the same sentence
  "sv05-024": SPHERICAL_SHIELD, // Rabsca — "Spherical Shield"
  "sv06.5-045": UNNERVE, // Fraxure — "Unnerve"
  "sv10-065": UNNERVE, // Cetitan ex — "Snow Camouflage", the SAME printed sentence
  "sv07-076": WIDE_WALL, // Rhyperior — "Wide Wall", the Supporter-only seat rule
  "sv09-095": DAUNTING_GAZE, // Tyranitar — "Daunting Gaze", Items only
  "sv10.5w-045": OCEANIC_CURSE, // Jellicent ex — "Oceanic Curse", Items AND Tools
  "sv10-113": POTENT_GLARE, // Team Rocket's Arbok — "Potent Glare"
  "sv06.5-042": MASSIVE_BODY, // Copperajah — "Massive Body", Stadiums only
  "sv06.5-040": ACE_NULLIFIER, // Genesect — "ACE Nullifier", every ACE SPEC at once
  "sv08-031": UNAWARE, // Skeledirge — "Unaware", the HOLDER rule
  "sv10-051": REPELLING_VEIL, // Team Rocket's Articuno — "Repelling Veil", the GROUP rule
  "sv08.5-040": PREVENT_FROM_EX, // Sylveon — "Safeguard" (NOT Mimikyu's ex-and-V one)
  "sv10-012": PREVENT_FROM_EX, // Crustle — "Mysterious Rock Inn", same sentence
  "sv05-108": PREVENT_FROM_BASIC_EX, // Farigiraf ex — "Armor Tail"
  "sv10-010": FLOWER_CURTAIN, // Shaymin — "Flower Curtain"
  "sv07-044": IMPERVIOUS_SHELL, // Drednaw — "Impervious Shell"
  // Two objects because these are two printed sentences by two cards; a shared one would log the
  // wrong Ability name for half of them.
  "sv06-096": ADRENA_PHEROMONE, // Fezandipiti — "Adrena-Pheromone" ({D}-gated)
  "sv08-150": EXPERT_HIDER, // Kecleon — "Expert Hider" (the antecedent dropped)
  "sv05-133": EMERGENCY_EVOLUTION,
  "sv05-129": RUN_AWAY_DRAW,
  "sv06-080": TELEPORTER,
  "sv08-131": SURF_BACK,
  "sv06.5-015": SHATTERING_SPEED,
  "sv07-011": BREEZY_GIFT,
  "sv10-074": DARKEST_IMPULSE, // Team Rocket's Ampharos — the EVOLVE verb
  "sv05-104": GNAWING_CURSE, // Gengar ex — the ATTACH verb
  "sv05-029": LAVA_ZONE, // Magcargo — the bench-move verb
  "sv06-005": BIG_NET, // Ariados — the TARGET-NARROWED cross-board surcharge
  "sv09-089": SECRET_FOREST_PATH, // Toedscruel — the OWN-SIDE discount, bench-gated
  "sv10-036": MELT_AWAY, // Ethan's Magcargo — the self-only zero under a HOLDER gate

  "sv10.5w-019": LICKING_CATCH, // Heatmor — "Licking Catch" (attack 0, mark I)

  "sv08-158": FAMILIAL_MARCH, // Maushold — "Familial March" (attack 0)

  "sv06-053": FREEZING_SHROUD, // Froslass — "Freezing Shroud" (Stage 1, {W})
  "sv05-145": CIPHERMANIACS_CODEBREAKING, // Ciphermaniac's Codebreaking (Supporter, mark H)
  "sv06.5-019": CURSED_BLAST_5, // Dusclops — "Cursed Blast" (Stage 1, {P}, 5 counters)
  "sv06.5-020": CURSED_BLAST_13, // Dusknoir — "Cursed Blast" (Stage 2, {P}, 13 counters)
  "svp-153": OVERVOLT_DISCHARGE, // Magneton — "Overvolt Discharge" (Stage 1, {L})
  "sv10-003": BUZZING_BOOST, // Yanmega ex — "Buzzing Boost" (Stage 1 out of Yanma, {G})
  "svp-133": GLITTERING_STAR_PATTERN, // Ledian (promo) — "Glittering Star Pattern"
  "sv05-142": BIANCAS_DEVOTION, // Bianca's Devotion — Supporter
  "sv09-067": INVITING_WINK, // Lillie's Ribombee — "Inviting Wink" (Stage 1 out of Lillie's Cutiefly)
  "svp-116": PYRO_DANCE, // Infernape (promo) — "Pyro Dance"
  "svp-090": METAL_MAKER, // Metang (promo) — "Metal Maker"
  "sv06-072": SNACK_SEEK, // Morpeko — "Snack Seek"
  "sv09-085": SPIKE_CLAD, // Lycanroc — "Spike-Clad"
  "sv10-145": X_BOOT, // Steven's Metagross ex — "X-Boot"
  "sv10.5b-081": ENERGY_COIN, // Energy Coin — two-coin gate, then search a Basic Energy and attach it
  "sv09-107": AUTO_HEAL, // Magearna — "Auto Heal", the self direction's first printing
};

Object.freeze(REGISTRY);

/**
 * Each printing's program: its own REGISTRY row, else the row of its print_key group's canonical
 * printing.
 */
const PROGRAM_BY_ID: ReadonlyMap<string, CardProgram> = (() => {
  const out = new Map(Object.entries(REGISTRY));
  for (const [member, canonical] of Object.entries(PROGRAM_ALIAS)) {
    const program = Object.hasOwn(REGISTRY, canonical) ? REGISTRY[canonical] : undefined;
    if (program !== undefined && !Object.hasOwn(REGISTRY, member)) out.set(member, program);
  }
  return out;
})();

/** The fixture pool's programs; empty outside the test suite. */
let testPrograms: ReadonlyMap<string, CardProgram> = new Map();
let installedTestPrograms: Readonly<Record<string, CardProgram>> | undefined;

/** The authored program for a catalog card id, or undefined when the card has
    none (an unsimulated Trainer/Ability, or a Pokémon whose attacks are wholly
    text-derived). A reprint shares its print_key group's row. */
export function programFor(cardId: string): CardProgram | undefined {
  return PROGRAM_BY_ID.get(cardId) ?? testPrograms.get(cardId);
}

/**
 * Every id this registry programs, the registered test programs included; reprints served through
 * the print_key table are not listed. Not re-exported from the package index; it exists so
 * in-suite audits can iterate the authored pool.
 */
export function registryCardIds(): string[] {
  return [...Object.keys(REGISTRY), ...testPrograms.keys()];
}

/**
 * Installs the fixture pool's programs (`fixtures/registry.ts`) once; the setup file re-runs per
 * suite with the same record. Only the vitest setup file calls it, and it is not re-exported from
 * the package index.
 */
export function registerTestPrograms(programs: Readonly<Record<string, CardProgram>>): void {
  if (installedTestPrograms === programs) return;
  if (installedTestPrograms !== undefined) {
    throw new Error("registerTestPrograms: a different set of test programs is already installed");
  }
  const clash = Object.keys(programs).find(
    (id) => Object.hasOwn(REGISTRY, id) || canonicalPrinting(id) !== id,
  );
  if (clash !== undefined) throw new Error(`registerTestPrograms: ${clash} is a registry id`);
  installedTestPrograms = programs;
  testPrograms = new Map(Object.entries(programs));
}
