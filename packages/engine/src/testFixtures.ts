// Inline card fixtures + drivers for the engine tests: a tiny fake catalog
// (nothing fetched) and helpers that script the deterministic setup flow.
// Not exported from the package index — test-only, but framework-free
// (plain throws) so any suite can use it.

import type { Card } from "@luminous/schema";
import type {
  ApplyResult,
  ErrorCode,
  GameAction,
  GameEvent,
  GameState,
  Seat,
  SpecialConditions,
} from "./index";
import { SEATS, applyAction, cardOfUid, createGame, isBasicPokemon, topUid } from "./index";
import { makeInPlay, withActive } from "./types";

const blank: Omit<Card, "id" | "name" | "category"> = {
  setId: "fix",
  localId: "0",
  image: null,
  illustrator: null,
  rarity: null,
  regulationMark: null,
  hp: null,
  stage: null,
  evolveFrom: null,
  types: null,
  retreat: null,
  abilities: null,
  attacks: null,
  weaknesses: null,
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legal: { standard: true, expanded: true },
  variants: null,
};

export function basicPokemon(id: string, retreat: number): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Basic",
    hp: 60,
    types: ["Colorless"],
    retreat,
  };
}

export function stage1Pokemon(id: string): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Stage1",
    hp: 90,
    types: ["Colorless"],
    retreat: 2,
    evolveFrom: "fix-basic-1",
  };
}

/** A Stage 2 that evolves from `fix-stage1` — the top of the M4 evolution
    chain (fix-basic-1 → fix-stage1 → fix-stage2). */
export function stage2Pokemon(id: string): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Stage2",
    hp: 140,
    types: ["Colorless"],
    retreat: 3,
    evolveFrom: "fix-stage1",
  };
}

export function basicEnergy(id: string): Card {
  return { ...blank, id, name: id, category: "Energy", energyType: "Normal" };
}

/** A Basic Energy of a real type. The NAME is the datum ("Fire Energy"):
    catalog basics carry no `types`, so the engine derives provision from it
    (cards.ts energyProvidesOf) — the unnamed `basicEnergy` above therefore
    provides Colorless, which the M1 suites rely on. */
export function typedEnergy(id: string, type: string): Card {
  return { ...blank, id, name: `${type} Energy`, category: "Energy", energyType: "Normal" };
}

export function itemTrainer(id: string): Card {
  return { ...blank, id, name: id, category: "Trainer", trainerType: "Item" };
}

/** A Special Energy (energyType "Special"). Used with the REAL catalog ids the
    M4 slice-5 registry authors (sv02-190 Jet, sv02-191 Luminous) so
    programFor(id) finds the EnergyProgram; the effect text is cosmetic (the
    registry keys on the id). An unauthored one (fix-special) exercises the
    Colorless fallback. */
export function specialEnergy(id: string, name: string): Card {
  return { ...blank, id, name, category: "Energy", energyType: "Special" };
}

/** A Trainer of a given type. Used with the REAL catalog ids the M4 registry
    authors (sv01-189, …) so `programFor(id)` finds the program — the `effect`
    text is cosmetic here (the registry keys on the id, not the text). */
export function trainerCard(id: string, trainerType: string, effect: string): Card {
  return { ...blank, id, name: id, category: "Trainer", trainerType, effect };
}

/** A battle-ready Basic: a 60 HP Colorless body whose combat data (attacks,
    types, hp, weakness/resistance) each M2 matchup overrides. */
export function battler(id: string, overrides: Partial<Card> = {}): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Basic",
    hp: 60,
    types: ["Colorless"],
    retreat: 1,
    ...overrides,
  };
}

export const FIXTURE_POOL: Record<string, Card> = {
  "fix-basic-0": basicPokemon("fix-basic-0", 0),
  "fix-basic-1": basicPokemon("fix-basic-1", 1),
  "fix-basic-2": basicPokemon("fix-basic-2", 2),
  "fix-stage1": stage1Pokemon("fix-stage1"),
  "fix-stage2": stage2Pokemon("fix-stage2"),
  "fix-energy": basicEnergy("fix-energy"),
  "fix-item": itemTrainer("fix-item"),
  "fix-fire-energy": typedEnergy("fix-fire-energy", "Fire"),
  "fix-water-energy": typedEnergy("fix-water-energy", "Water"),
  // The M2 cast: one Fire attacker with a spread of printed-attack shapes,
  // and defenders that exercise each §8.5 damage-pipeline branch.
  "fix-attacker": battler("fix-attacker", {
    types: ["Fire"],
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      { cost: ["Fire", "Colorless"], name: "Flame", damage: 60 },
      // The canonical modern print — effects.ts derives it (M3), so Yawn
      // actually puts the defender to sleep.
      { name: "Yawn", effect: "Your opponent's Active Pokémon is now Asleep." },
      {
        cost: ["Colorless"],
        name: "Rage",
        damage: "10+",
        effect: "This attack does 10 more damage for each damage counter on this Pokémon.",
      },
      // A base-0 self-counter scaler (index 4) — no real card prints "does N MORE
      // damage" off a 0 base, so this is a deliberate PROBE: per 20 ≠ 10 pins that
      // the fold multiplies by the CAPTURED per (not the literal 10 every real
      // reader happens to print), and the absent base pins that attack.ts's widened
      // `base + scaled > 0` guard fires on the scaling clause alone (0.34.0).
      {
        cost: ["Colorless"],
        name: "Fury",
        effect: "This attack does 20 more damage for each damage counter on this Pokémon.",
      },
      // A per-50 opponentPrizesTaken scaler (index 5) — the Prize-source twin of the
      // Fury probe. Charizard "Burning Darkness" is the only real card on this source
      // and always prints per 30, so an APPLY test at per ≠ 30 is the only thing that
      // pins the fold multiplies by the CAPTURED per here (a `* 30` literal — the
      // value a careless author would hard-code — otherwise survives; 0.35.0).
      {
        cost: ["Colorless"],
        name: "Bounty",
        damage: "40+",
        effect: "This attack does 50 more damage for each Prize card your opponent has taken.",
      },
    ],
  }),
  /** The M3 cast: one derivable status sentence (effects.ts) per attack, on
      a tanky costless body so self-inflicted conditions don't KO it. */
  "fix-statuser": battler("fix-statuser", {
    hp: 120,
    attacks: [
      { name: "Hypnosis", effect: "Your opponent's Active Pokémon is now Asleep." },
      { name: "Confuse Ray", effect: "Your opponent's Active Pokémon is now Confused." },
      {
        name: "Numbing Bolt",
        damage: 10,
        effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
      },
      { name: "Overheat", effect: "This Pokémon is now Burned." },
      { name: "Rest", effect: "This Pokémon is now Asleep. Heal 30 damage from it." },
      {
        name: "Toxic",
        effect:
          "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, put 2 damage counters on that Pokémon instead of 1.",
      },
      // The classic OLD-ERA phrasing effects.ts deliberately does NOT
      // derive, with no damage and no modifier — pins the pure-text
      // ATTACK_EFFECT_SKIPPED path.
      { name: "Lullaby", effect: "The Defending Pokémon is now Asleep." },
    ],
  }),
  /** OHKO'd by Bite — the e2e prize-race fodder. No attacks of its own. */
  "fix-victim": battler("fix-victim", { hp: 30 }),
  /** Plain wall: no weakness, no resistance, survives several Bites. */
  "fix-wall": battler("fix-wall", { hp: 120 }),
  /** Weak to Fire — Bite hits for 60 and exactly KOs it. */
  "fix-weak": battler("fix-weak", { hp: 60, weaknesses: [{ type: "Fire", value: "×2" }] }),
  /** Resists Fire — Bite is floored to 0. */
  "fix-tough": battler("fix-tough", {
    hp: 120,
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  /** Both weak AND resistant to Fire — pins the §8.5 order:
      (30 × 2) − 30 = 30, where the wrong order gives (30 − 30) × 2 = 0. */
  "fix-weak-tough": battler("fix-weak-tough", {
    hp: 120,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Fire", value: "-30" }],
  }),
  /** Old-era ADDITIVE weakness (the dp5-4 print): Bite deals 30 + 20 = 50,
      where a misread ×2 would deal 60. */
  "fix-weak-plus": battler("fix-weak-plus", {
    hp: 120,
    weaknesses: [{ type: "Fire", value: "+20" }],
  }),
  /** A Pokémon V — `pokemonSuffixOf` reads the "V" off the NAME (fixtures
      default `name` to their id, so the id-named defenders above are non-V).
      Choice Belt's +30 target for the "is a V" arm. */
  "fix-pokemon-v": battler("fix-pokemon-v", { name: "Fixmon V", hp: 210 }),
  /** A Pokémon V that is ALSO Fire-weak — pins Choice Belt's +30 lands BEFORE
      W/R: (30 + 30) × 2 = 120, where an after-W/R fold reads 30 × 2 + 30 = 90. */
  "fix-pokemon-v-weak": battler("fix-pokemon-v-weak", {
    name: "Weakmon V",
    hp: 210,
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  /** A Pokémon VMAX — its name ends in "VMAX", not " V", so Choice Belt's "V"
      gate must NOT fire on it (the whole point of reading the suffix literally). */
  "fix-pokemon-vmax": battler("fix-pokemon-vmax", { name: "Fixmon VMAX", hp: 330 }),
  // — M5 long-tail: the Mimikyu "Safeguard" cast (preventDamageFromExV). The
  //   defender is a faithful Mimikyu sv02-097 (its passive comes from the
  //   registry, keyed by id); the attackers are three named bodies so
  //   `pokemonSuffixOf` reads ex / V / VMAX off the NAME — the ex and V are
  //   prevented, the VMAX (and the plain fix-attacker) are NOT. Bite ({C} 30) is
  //   the main-hit witness; the ex also carries Spread Shot for the interpreter
  //   spread arm. —
  "sv02-097": battler("sv02-097", {
    name: "Mimikyu",
    types: ["Psychic"],
    hp: 70,
    weaknesses: [{ type: "Metal", value: "×2" }],
    retreat: 1,
  }),
  "fix-attacker-ex": battler("fix-attacker-ex", {
    name: "Fixmon ex",
    types: ["Fire"],
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      {
        cost: ["Colorless"],
        name: "Spread Shot",
        damage: 30,
        effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
      },
    ],
  }),
  "fix-attacker-v": battler("fix-attacker-v", {
    name: "Guardmon V",
    types: ["Fire"],
    hp: 120,
    attacks: [{ cost: ["Colorless"], name: "Bite", damage: 30 }],
  }),
  "fix-attacker-vmax": battler("fix-attacker-vmax", {
    name: "Bigmon VMAX",
    types: ["Fire"],
    hp: 120,
    attacks: [{ cost: ["Colorless"], name: "Bite", damage: 30 }],
  }),
  /** hp printed as 0 — a catalog data gap schema/ingest let through, read as
      null by hpOf: never KO'd (a KO requires printed hp > 0). */
  "fix-zero-hp": battler("fix-zero-hp", { hp: 0 }),
  /** M4 slice 4 — the spread attacker: Spread Shot does 30 to the Active AND
      20 to EACH of the opponent's Benched Pokémon (the effect sentence the
      deriver recognizes → the spreadDamage op). The card that proves the KO
      generalization off the Active catches BENCH Knock Outs. */
  "fix-sniper": battler("fix-sniper", {
    types: ["Fire"],
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Spread Shot",
        damage: 30,
        effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
      },
    ],
  }),

  // — M4 slice 2: the representative Trainer/Ability cast (real catalog ids so
  //   the registry finds their authored programs). —
  "sv01-189": trainerCard("sv01-189", "Supporter", "Discard your hand and draw 7 cards."),
  "sv01-181": trainerCard(
    "sv01-181",
    "Item",
    "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
  ),
  "sv02-172": trainerCard(
    "sv02-172",
    "Supporter",
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
  ),
  "sv01-194": trainerCard("sv01-194", "Item", "Switch your Active Pokémon with 1 of your Benched Pokémon."),
  "sv01-188": trainerCard("sv01-188", "Item", "Heal 30 damage from 1 of your Pokémon."),
  "sv01-184": trainerCard(
    "sv01-184",
    "Item",
    "Heal 30 damage from each Pokémon (both yours and your opponent's).",
  ),
  "sv01-175": trainerCard(
    "sv01-175",
    "Supporter",
    "Search your deck for up to 2 Evolution Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  ),
  "sv01-172": trainerCard(
    "sv01-172",
    "Item",
    "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),
  /** An UNAUTHORED Stadium — pins the TRAINER_NOT_SIMULATED reject (an
      unregistered Stadium cannot be played; coverage strategy). */
  "fix-stadium": {
    ...blank,
    id: "fix-stadium",
    name: "fix-stadium",
    category: "Trainer",
    trainerType: "Stadium",
    effect: "A test Stadium.",
  } satisfies Card,
  /** An UNAUTHORED Tool — the attachTool twin of fix-stadium. */
  "fix-tool": trainerCard("fix-tool", "Tool", "A test Tool."),
  /** Chien-Pao ex — a Water Basic whose registry entry carries the activated
      "Shivery Chill" Ability (search up to 2 Basic {W} Energy → hand) AND the
      registry-authored "Hail Blade" attack (discard any amount of {W} → 60× the
      count). Attack text is the VERBATIM sv02-061 print (the deriver refuses it;
      the registry program is authoritative). */
  "sv02-061": battler("sv02-061", {
    name: "Chien-Pao ex",
    types: ["Water"],
    hp: 220,
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [{ type: "Ability", name: "Shivery Chill", effect: "…search for up to 2 Basic {W} Energy…" }],
    attacks: [
      {
        cost: ["Water", "Water"],
        name: "Hail Blade",
        damage: "60×",
        effect:
          "You may discard any amount of {W} Energy from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
      },
    ],
  }),
  /** Bouffalant — a Colorless Basic whose registry entry carries the passive
      "Bouffer" (takes 20 less damage after Weakness/Resistance). */
  "sv03-174": battler("sv03-174", {
    name: "Bouffalant",
    types: ["Colorless"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [{ type: "Ability", name: "Bouffer", effect: "This Pokémon takes 20 less damage…" }],
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Damage Rush", damage: "50+" }],
  }),

  /** Cacnea / Cacturne — Grass bodies whose registry entry carries the passive
      "Counterattack Quills" (§9 reactive recoil: 3 damage counters on the
      Attacking Pokémon when the Active is damaged, even if Knocked Out). No Fire
      weakness on the fixtures, so the Fire attacker's Bite lands a clean 30 and
      the recoil math is isolated from the §8.5 pipeline. */
  "sv01-005": battler("sv01-005", {
    name: "Cacnea",
    types: ["Grass"],
    hp: 60,
    abilities: [
      { type: "Ability", name: "Counterattack Quills", effect: "…put 3 damage counters on the Attacking Pokémon." },
    ],
  }),
  "sv01-006": battler("sv01-006", {
    name: "Cacturne",
    types: ["Grass"],
    hp: 130,
    abilities: [
      { type: "Ability", name: "Counterattack Quills", effect: "…put 3 damage counters on the Attacking Pokémon." },
    ],
  }),
  /** Stunfisk — a Fighting body whose registry passive "Custom Trap" is the
      Counterattack Quills variant gated on a Pokémon Tool being attached (5
      counters). No weakness on the fixture — the recoil and its Tool gate are
      what's under test. */
  "sv03-112": battler("sv03-112", {
    name: "Stunfisk",
    types: ["Fighting"],
    hp: 120,
    abilities: [
      { type: "Ability", name: "Custom Trap", effect: "…put 5 damage counters on the Attacking Pokémon." },
    ],
  }),
  /** Armarouge (sv03-044) — a Fire body whose registry entry carries the
      `onDamagedByAttack` TRIGGER "Scorching Armor" (Burn the Attacking Pokémon
      when this Active is damaged, even if Knocked Out). The Fire attacker's Bite
      is Colorless, so no Weakness is engaged and the Burn is isolated; 120 HP so
      a bare Bite (30) leaves it standing (the KO cases pre-damage it). */
  "sv03-044": battler("sv03-044", {
    name: "Armarouge",
    types: ["Fire"],
    hp: 120,
    abilities: [
      { type: "Ability", name: "Scorching Armor", effect: "…the Attacking Pokémon is now Burned." },
    ],
  }),

  /** Klawf ex (sv03-120) — a Fighting Basic ex (220 HP, retreat 3, the REAL
      print) whose registry entry carries the `onDamagedByAttack` TRIGGER
      "Counterattacking Pincer" (a PARKING discard of an Energy from the Attacking
      Pokémon when this Active is damaged, even if Knocked Out). No `attacks`: it is
      always the DEFENDER in the tests, so Falling Press is never paid; 220 HP so a
      bare Bite (30) leaves it standing (the KO case pre-damages it to 190). Being
      an `ex` it prizes 2 when Knocked Out (§8.1, D93). */
  "sv03-120": battler("sv03-120", {
    name: "Klawf ex",
    types: ["Fighting"],
    hp: 220,
    retreat: 3,
    abilities: [
      {
        type: "Ability",
        name: "Counterattacking Pincer",
        effect: "…discard an Energy from the Attacking Pokémon.",
      },
    ],
  }),

  // — M5 op-slice: disableAbilities continuous Ability-lock auras (D100). HP /
  //   retreat / stage are the REAL prints (queried off the live D1); the printed
  //   `abilities` NAME matters mechanically — it is what Mischievous Lock's
  //   "except for Mischievous Lock" matches against, so a mirror-match Klefki
  //   keeps its own lock on.
  //   ONE DELIBERATE DEVIATION: Klefki's real attack is "Joust" ({C}, 10, "Before
  //   doing damage, discard all Pokémon Tools from your opponent's Active
  //   Pokémon" — an unsimulated effect). It carries fix-attacker's plain
  //   Bite ({C}, 30) instead so the lock-ON / lock-OFF pairs can compare the SAME
  //   printed 30 with Klefki attacking in one arm and fix-attacker in the other
  //   (Klefki must be the Active to emit its aura, so it has to be the attacker). —
  "sv01-096": battler("sv01-096", {
    name: "Klefki",
    types: ["Fairy"],
    hp: 70,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Bite", damage: 30 }],
    abilities: [
      { type: "Ability", name: "Mischievous Lock", effect: "Basic Pokémon in play have no Abilities." },
    ],
  }),
  "sv02-089": battler("sv02-089", {
    name: "Spiritomb",
    types: ["Darkness"],
    hp: 60,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Fettered in Misfortune",
        effect: "Basic Pokémon V in play have no Abilities.",
      },
    ],
  }),
  "sv02-127": battler("sv02-127", {
    name: "Ting-Lu ex",
    types: ["Fighting"],
    hp: 240,
    retreat: 4,
    abilities: [
      {
        type: "Ability",
        name: "Cursed Land",
        effect: "…your opponent's damaged Pokémon have no Abilities, except for Pokémon ex.",
      },
    ],
  }),

  // — M4 slice 3: the persistent-zone cast (real catalog ids so the registry
  //   finds their continuous effects; names are the REAL card names because
  //   the §7.3 same-name rule compares names, not ids). —
  /** Beach Court — Stadium: Basic retreat cost {C} less (both players). */
  "sv01-167": {
    ...blank,
    id: "sv01-167",
    name: "Beach Court",
    category: "Trainer",
    trainerType: "Stadium",
    effect: "The Retreat Cost of each Basic Pokémon in play (both yours and your opponent's) is {C} less.",
  } satisfies Card,
  /** Calamitous Wasteland — Stadium: Basic non-{F} retreat cost {C} more. */
  "sv02-175": {
    ...blank,
    id: "sv02-175",
    name: "Calamitous Wasteland",
    category: "Trainer",
    trainerType: "Stadium",
    effect:
      "The Retreat Cost of each Basic non-{F} Pokémon in play (both yours and your opponent's) is {C} more.",
  } satisfies Card,
  /** Pokémon League Headquarters — Stadium: Basic attacks cost {C} more. */
  "sv03-192": {
    ...blank,
    id: "sv03-192",
    name: "Pokémon League Headquarters",
    category: "Trainer",
    trainerType: "Stadium",
    effect: "Attacks used by each Basic Pokémon in play (both yours and your opponent's) cost {C} more.",
  } satisfies Card,
  /** Artazon — Stadium ACTIVATED ability (D102): once per player-turn, search a
      no-Rule-Box Basic → Bench. */
  "sv02-171": {
    ...blank,
    id: "sv02-171",
    name: "Artazon",
    category: "Trainer",
    trainerType: "Stadium",
    effect:
      "Once during each player's turn, that player may search their deck for a Basic Pokémon that doesn't have a Rule Box and put it onto their Bench. Then, that player shuffles their deck.",
  } satisfies Card,
  /** Mesagoza — Stadium ACTIVATED ability (D102): once per player-turn, flip a
      coin; heads → search a Pokémon → hand (the Poké Ball coin gate). */
  "sv01-178": {
    ...blank,
    id: "sv01-178",
    name: "Mesagoza",
    category: "Trainer",
    trainerType: "Stadium",
    effect:
      "Once during each player's turn, that player may flip a coin. If heads, that player searches their deck for a Pokémon, reveals it, and puts it into their hand. Then, that player shuffles their deck.",
  } satisfies Card,
  /** Town Store — Stadium ACTIVATED ability (D102): once per player-turn, search
      a Pokémon Tool card → hand. */
  "sv03-196": {
    ...blank,
    id: "sv03-196",
    name: "Town Store",
    category: "Trainer",
    trainerType: "Stadium",
    effect:
      "Once during each player's turn, that player may search their deck for a Pokémon Tool card, reveal it, and put it into their hand. Then, that player shuffles their deck.",
  } satisfies Card,
  /** Vitality Band — Tool: attacks do 10 more damage (before W/R). */
  "sv01-197": trainerCard("sv01-197", "Tool", "The attacks of the Pokémon this card is attached to do 10 more damage…"),
  /** Defiance Band — Tool: +30 before W/R while behind on Prizes. */
  "sv01-169": trainerCard("sv01-169", "Tool", "If you have more Prize cards remaining than your opponent, the attacks of the Pokémon this card is attached to do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."),
  /** Bravery Charm — Tool: the Basic holder gets +50 HP. */
  "sv02-173": trainerCard("sv02-173", "Tool", "The Basic Pokémon this card is attached to gets +50 HP."),
  /** Choice Belt — Tool: +30 before W/R vs a defending Pokémon V. */
  "sv02-176": trainerCard("sv02-176", "Tool", "The attacks of the Pokémon this card is attached to do 30 more damage to your opponent's Active Pokémon V (before applying Weakness and Resistance)."),
  /** Rocky Helmet — Tool: 2 damage counters on the attacker when the holder is
      damaged while Active (the D98 `damageAttacker` family, granted by a Tool). */
  "sv01-193": trainerCard("sv01-193", "Tool", "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if it is Knocked Out), put 2 damage counters on the Attacking Pokémon."),

  // — M4 slice 5: Special Energy (real catalog ids so the registry finds their
  //   EnergyProgram; names are the REAL names, though provision keys on the id). —
  /** Jet Energy — {C} + switch-on-bench-attach. */
  "sv02-190": specialEnergy("sv02-190", "Jet Energy"),
  /** Luminous Energy — wildcard (any 1 type), {C} if another Special attached. */
  "sv02-191": specialEnergy("sv02-191", "Luminous Energy"),
  /** An UNAUTHORED Special Energy — pins the Colorless provision fallback. */
  "fix-special": specialEnergy("fix-special", "fix-special"),

  // — M4 slice 6: the triggered-Ability cast (real catalog ids so the registry
  //   finds their programs; NAMES are the real card names — Flamigo's search
  //   matches its own name, so a fixture name change would un-target it — but
  //   the stages/evolveFrom are simplified to the fixture line for the tests
  //   (the registry keys on the id, not the stage). —
  /** Flamigo — Insta-Flock (on-play-to-Bench: search up to 3 Flamigo → hand).
      A Basic so playBasicToBench places it; NAME "Flamigo" is what the byName
      search matches, so every copy is a search target. */
  "sv02-170": battler("sv02-170", { name: "Flamigo", hp: 110, retreat: 1 }),
  /** Arboliva — Enriching Oil (on-evolve: heal all from 1 of your Pokémon).
      evolveFrom fix-basic-1 (the fixture line) so a fix-basic-1 Active evolves
      straight into it — the trigger fires on the evolve, not the stage. */
  "sv01-023": {
    ...blank,
    id: "sv01-023",
    name: "Arboliva",
    category: "Pokemon",
    stage: "Stage1",
    hp: 150,
    types: ["Colorless"],
    retreat: 2,
    evolveFrom: "fix-basic-1",
  } satisfies Card,
  /** Garganacl — Blessed Salt (between-turns: heal 20 from EACH of your
      Pokémon). A Basic so it sits Active or benched without an evolution. */
  "sv02-123": battler("sv02-123", { name: "Garganacl", hp: 180, retreat: 2 }),
  /** Trevenant — Forest Miasma (between-turns, Active-only: 1 counter on the
      opponent's Active). A Basic for the same reason. */
  "sv03-012": battler("sv03-012", { name: "Trevenant", hp: 140, retreat: 2 }),

  // — M4 slice 7: Rare Candy (§7.1 — the Basic→Stage 2 evolve-skip). The real
  //   catalog id so the registry marks it; the fixture line (fix-basic-1 →
  //   fix-stage1 → fix-stage2) is what it skips THROUGH — the bridge Stage 1
  //   (fix-stage1) is in the pool but need never be in hand. fix-stage2-frail is
  //   a low-HP Stage 2 for the evolve-below-HP mid-turn KO (a Bravery Charm's
  //   Basic-only +50 falling off drops the max below the carried damage). —
  /** Rare Candy — the Basic→Stage 2 evolve-skip Item (registry marks it). */
  "sv01-191": {
    ...blank,
    id: "sv01-191",
    name: "Rare Candy",
    category: "Trainer",
    trainerType: "Item",
    effect:
      "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1.",
  } satisfies Card,
  /** A frail Stage 2 (evolves from fix-stage1) — 80 HP so a charmed fix-basic-1
      (60 + 50 = 110 max) damaged to 100 survives AS a Basic but is Knocked Out
      the instant Rare Candy evolves it (the +50 falls off → 80 max ≤ 100). */
  "fix-stage2-frail": {
    ...blank,
    id: "fix-stage2-frail",
    name: "fix-stage2-frail",
    category: "Pokemon",
    stage: "Stage2",
    hp: 80,
    types: ["Colorless"],
    retreat: 3,
    evolveFrom: "fix-stage1",
  } satisfies Card,

  // — M4 slice 8: the mid-turn-damage snipe cast (real catalog ids so the
  //   registry finds their programs; the opponent's Benched Pokémon are the
  //   targets). —
  /** Hawlucha — "Flying Entry" (onPlayToBench: choose 2 of the opponent's
      Benched Pokémon, 1 counter each). A Basic so playBasicToBench places it and
      fires the trigger; the registry carries the program (keyed by id). */
  "sv01-118": battler("sv01-118", { name: "Hawlucha", types: ["Fighting"], hp: 70, retreat: 1 }),
  /** Meowscarada ex — "Bouquet Magic" (activated, once/turn: discard a Basic
      {G} Energy from hand, then 3 counters on 1 of the opponent's Benched
      Pokémon). A Basic HERE (surgery places it as an Active/bench body — the
      registry keys on the id, not the stage) though the real card is a Stage 2.
      Not Active-only, so it fires from the Bench too. */
  "sv02-015": battler("sv02-015", { name: "Meowscarada ex", types: ["Grass"], hp: 310, retreat: 2 }),
  /** A Basic Grass Energy — the discard Meowscarada's Bouquet Magic costs. The
      NAME "Grass Energy" is what energyProvidesOf derives "Grass" from. */
  "fix-grass-energy": typedEnergy("fix-grass-energy", "Grass"),

  // — M4 slice 9: on-KO triggered Abilities (§9 — fire when Knocked Out). —
  /** Glimmora — "Shattering Crystal" (on-KO: flip a coin; heads → opponent takes
      no Prize for it). The real catalog id so the registry finds the program; a
      Basic body here (surgery places it — the registry keys on the id, not the
      stage) though the real card is a Stage 1. 30 HP so Bite (30) Knocks it Out
      in one hit — the whole point is the KO, not the fight. */
  "sv02-126": battler("sv02-126", {
    name: "Glimmora",
    types: ["Fighting"],
    hp: 30,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Shattering Crystal",
        effect: "When this Pokémon is Knocked Out, flip a coin. If heads, your opponent can't take any Prize cards for it.",
      },
    ],
  }),
  /** fix-onko — the FIXTURE on-KO PARKER (registry FIX_ONKO): "Last Wish" searches
      the deck for a Basic Pokémon → hand when Knocked Out, so it PARKS mid-KO-
      sweep (the resume-the-tail path no real SV on-KO Ability exercises). 30 HP
      for a one-Bite KO. */
  "fix-onko": battler("fix-onko", { name: "fix-onko", hp: 30 }),

  // — M5 coverage pass #1: cards authored from existing ops (real catalog ids so
  //   the registry finds the programs; the effect/ability text is cosmetic). —
  /** Poké Ball (Item) — coin-gated search a Pokémon → hand. */
  "sv01-185": trainerCard(
    "sv01-185",
    "Item",
    "Flip a coin. If heads, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),
  /** Pokémon Catcher (Item) — coin-gated gust. */
  "sv01-187": trainerCard(
    "sv01-187",
    "Item",
    "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
  ),
  /** Nemona (Supporter) — draw 3. */
  "sv01-180": trainerCard("sv01-180", "Supporter", "Draw 3 cards."),
  /** Copperajah ex — passive "Bronze Body" (−30 damage after W/R). A tanky body
      so an attack lands with the reduction visible without a KO. */
  "sv02-150": battler("sv02-150", { name: "Copperajah ex", types: ["Metal"], hp: 280, retreat: 3 }),
  /** Stonjourner — passive "Exoskeleton" (−20 damage after W/R). */
  "sv01-121": battler("sv01-121", { name: "Stonjourner", types: ["Fighting"], hp: 140, retreat: 2 }),

  // — M5 op-slice: attachEnergyFrom (real ids so the registry finds the abilities;
  //   Basic bodies here — surgery places them, the registry keys on the id). —
  /** Quaquaval — "Energy Carnival" (attach a Basic Energy from hand to a chosen). */
  "sv01-054": battler("sv01-054", { name: "Quaquaval", types: ["Water"], hp: 170, retreat: 2 }),
  /** Baxcalibur — "Super Cold" (attach a Basic {W} from hand, repeatable). */
  "sv02-060": battler("sv02-060", { name: "Baxcalibur", types: ["Water"], hp: 160, retreat: 2 }),
  /** fix-attacher — FIXTURE for the DISCARD-source attach (a Basic Fire Energy). */
  "fix-attacher": battler("fix-attacher", { name: "fix-attacher", hp: 120, retreat: 1 }),
  /** Gardevoir ex — "Psychic Embrace" (attachEnergyFrom riders: {P} from discard
      + 2 counters + not-if-KO). Psychic type, so it is its own {P} target. */
  "sv01-086": battler("sv01-086", { name: "Gardevoir ex", types: ["Psychic"], hp: 310, retreat: 2 }),
  /** A Basic Psychic {P} Pokémon — a Psychic Embrace target; 60 HP so a damaged
      one exercises the not-if-KO exclusion (50 + 20 counters ≥ 60). */
  "fix-psychic-1": battler("fix-psychic-1", { name: "fix-psychic-1", types: ["Psychic"], hp: 60, retreat: 1 }),
  /** A Basic Psychic Energy — the Psychic Embrace attach source. */
  "fix-psychic-energy": typedEnergy("fix-psychic-energy", "Psychic"),
  /** Clefable ex (sv03-082, D108) — "Lunar Zone": "All of your Pokémon that have
      {P} Energy attached have no Retreat Cost." The `noRetreatCostAura` source
      (registry). A Psychic Stage 1 (260 HP, ×2 Metal, retreat 2), VERBATIM off
      the live D1 — its retreat 2 is what its own aura frees, self-inclusively,
      once it holds {P}. An ex, so Ting-Lu ex "Cursed Land" (opponent's damaged
      NON-ex) can never lock it; abilityLock coverage stays with Florges. */
  "sv03-082": battler("sv03-082", {
    name: "Clefable ex",
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Clefairy",
    hp: 260,
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Lunar Zone",
        effect: "All of your Pokémon that have {P} Energy attached have no Retreat Cost.",
      },
    ],
  }),
  /** A neutral Basic with retreat 2 — the Lunar Zone beneficiary/control body:
      it pays 2 bare, 0 once it holds {P} beside a Clefable ex. */
  "fix-retreat2": battler("fix-retreat2", { name: "fix-retreat2", hp: 120, retreat: 2 }),

  // — the retreat-LOCK seam (D112): "During your opponent's next turn, the
  //   Defending Pokémon can't retreat." A CONDITION on the Pokémon, not a cost
  //   modifier — nothing to do with the D108–D111 cost seam above. Both cards
  //   DERIVE off their sentence (no registry row at all), so the effect text is
  //   LOAD-BEARING and must stay char-for-char with the D1 rows. —
  /** Tarountula sv02-016 — "Bind Down" ({G}, 10): the bare rider, and the
      cheapest carrier of the 15-printing wording. A Basic, so it fields without
      surgery. Its ONLY attack, so index 0 is the lock and there is no second
      attack to confuse the index-keyed assertions. */
  "sv02-016": battler("sv02-016", {
    name: "Tarountula",
    types: ["Grass"],
    hp: 50,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass"],
        name: "Bind Down",
        damage: 10,
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
    ],
  }),
  /** Paldean Clodsire sv03-128 — "Poison Ring" ({D}, 20): the TWO-CLAUSE
      printing, where the lock hides behind a Poison and the second sentence says
      "that Pokémon" rather than "the Defending Pokémon". A Stage 1 (from Paldean
      Wooper), surgeried straight onto the Active in tests. Its second attack is
      unsimulated on purpose — the "one card, one derived attack" control. */
  "sv03-128": {
    ...blank,
    id: "sv03-128",
    name: "Paldean Clodsire",
    category: "Pokemon",
    stage: "Stage1",
    evolveFrom: "Paldean Wooper",
    hp: 140,
    types: ["Darkness"],
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness"],
        name: "Poison Ring",
        damage: 20,
        effect:
          "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.",
      },
      {
        cost: ["Darkness", "Colorless", "Colorless"],
        name: "Muddy Hammer",
        damage: 100,
        effect: "Discard the top card of your opponent's deck.",
      },
    ],
  } satisfies Card,
  /** Snorlax swsh10.5-055 — "Block": the L3 shape of the same seam (D113), and
      the only continuous-Ability retreat lock in the pool. VERBATIM off the local
      D1 (150 HP, retreat 4, {C}, ×2 {F}, ASCII apostrophes): the Ability text is
      pinned by the suite even though the card DOES carry a registry row, because
      the row and the sentence must not drift apart. A Basic, so it fields without
      surgery — and, being a Basic, it is also the first source in the aura family
      an Active Klefki's Basic-only "Mischievous Lock" can actually silence. Its
      one attack "Collapse" is unsimulated (the Asleep rider is a §12 self-status,
      not this seam) and is carried only so the printed row is complete. The first
      swsh10.5 card here to carry an ABILITY — the four already in the pool
      (-009/-010/-018/-031) are all attack casts. */
  "swsh10.5-055": battler("swsh10.5-055", {
    name: "Snorlax",
    types: ["Colorless"],
    hp: 150,
    retreat: 4,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Block",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon can't retreat.",
      },
    ],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless", "Colorless"],
        name: "Collapse",
        damage: 150,
        effect: "This Pokémon is now Asleep.",
      },
    ],
  }),

  /** Wimpod swsh10.5-025 — "Punk Out": the TENTH and last print on the
      retreat-COST seam (D114), and the only SELF-only set-to-zero on it. VERBATIM
      off the local D1 (70 HP, retreat 3, {W}, ×2 {L}, one attack "Gnaw" with no
      effect key): the printed sentence is load-bearing only through the REGISTRY
      here — nothing derives off it — but the suite pins it char-for-char anyway so
      the row and the sentence cannot drift apart. Two byte facts worth naming: the
      text contains NO apostrophe of either kind (ASCII or U+2019), which makes it
      the pool's cleanest verbatim guard, and its "Pokémon" is a real U+00E9 é. Its
      retreat 3 is deliberately its own, not a neighbour's: it is what the Ability
      zeroes and what Beach Court's −1 must lose to. A Basic, so it fields with one
      surgery — and being a Basic it is also reachable by an Active Klefki's
      Basic-only "Mischievous Lock", which is what makes the §9 gate assertable as
      a POSITIVE. */
  "swsh10.5-025": battler("swsh10.5-025", {
    name: "Wimpod",
    types: ["Water"],
    hp: 70,
    retreat: 3,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Punk Out",
        effect: "If your opponent has any Pokémon V in play, this Pokémon has no Retreat Cost.",
      },
    ],
    attacks: [{ cost: ["Water"], name: "Gnaw", damage: 10 }],
  }),

  // — the retreat-cost READERS (D110): the two arithmetic shapes of "for each {C}
  //   in your opponent's Active Pokémon's Retreat Cost". Faithful to the D1 rows;
  //   the effect text is LOAD-BEARING here (both cards derive from the sentence —
  //   neither carries a registry program), so it must stay char-for-char. —
  /** Heracross sv01-002 — "Superpowered Throw" (10+, 30 more per {C} of the
      defender's Retreat Cost): the ADDITIVE arm, printed base kept. Its second
      attack is a plain number, the "one card, one scaled attack" control. */
  "sv01-002": battler("sv01-002", {
    name: "Heracross",
    types: ["Grass"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass", "Colorless"],
        name: "Superpowered Throw",
        damage: "10+",
        effect:
          "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      },
      { cost: ["Grass", "Grass", "Colorless"], name: "Horn Attack", damage: 90 },
    ],
  }),
  /** Stoutland sv03-172 — "Chomp Chomp Panic" (50×, 50 per {C}, NO base): the
      MULTIPLY arm, the odd one out of the four readers. A Stage 2 (evolves from
      Herdier), surgeried straight onto the Active in tests. */
  "sv03-172": {
    ...blank,
    id: "sv03-172",
    name: "Stoutland",
    category: "Pokemon",
    stage: "Stage2",
    evolveFrom: "Herdier",
    hp: 160,
    types: ["Colorless"],
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Chomp Chomp Panic",
        damage: "50×",
        effect:
          "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Sharp Fang", damage: 140 },
    ],
  } satisfies Card,
  /** Spidops ex sv01-019 — the ONE card on both sides of the retreat-cost seam
      (D111): the Ability "Trap Territory" raises the opponent's Active's Retreat
      Cost (registry `opponentActiveRetreatSurcharge`), and the attack "Wire Hang"
      READS that same cost off the derived sentence (D110, no registry row — so
      its effect text is LOAD-BEARING and must stay char-for-char). A Grass Stage 1
      from Tarountula, 260 HP, ×2 Fire, retreat 2 — VERBATIM off the live D1, where
      -019/-223/-243 are byte-identical in rules text. */
  "sv01-019": battler("sv01-019", {
    name: "Spidops ex",
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Tarountula",
    hp: 260,
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Trap Territory",
        effect: "Your opponent's Active Pokémon's Retreat Cost is {C} more.",
      },
    ],
    attacks: [
      {
        cost: ["Grass", "Colorless"],
        name: "Wire Hang",
        damage: "90+",
        effect:
          "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      },
    ],
  }),

  // — attachEnergyFrom multi + endsTurn: Koraidon ex "Dino Cry". —
  /** Koraidon ex — "Dino Cry" (multi-attach up to 2 Basic {F} from discard to
      Basic {F} Pokémon; then the turn ends). Basic Fighting, so it is its own
      valid Basic {F} target. */
  "sv01-125": battler("sv01-125", { name: "Koraidon ex", types: ["Fighting"], hp: 230, retreat: 1 }),
  /** A Basic Fighting {F} Pokémon — a valid Dino Cry target. */
  "fix-fighting-1": battler("fix-fighting-1", { name: "fix-fighting-1", types: ["Fighting"], hp: 70, retreat: 1 }),
  /** A NON-Basic Fighting {F} Pokémon (Stage 2) — the right type but excluded by
      `basicOnly` (Dino Cry targets only your Basic {F}). */
  "fix-fighting-evo": {
    ...blank,
    id: "fix-fighting-evo",
    name: "fix-fighting-evo",
    category: "Pokemon",
    stage: "Stage2",
    hp: 150,
    types: ["Fighting"],
    retreat: 2,
  } satisfies Card,
  /** A Basic Fighting Energy — the Dino Cry attach source. */
  "fix-fighting-energy": typedEnergy("fix-fighting-energy", "Fighting"),

  // — M5 op-slice: discardPileRetrieval (real catalog ids so the registry finds
  //   the programs; the effect text is cosmetic — the registry keys on the id). —
  /** Energy Retrieval (Item) — up to 2 Basic Energy from the discard → hand. */
  "sv01-171": trainerCard(
    "sv01-171",
    "Item",
    "Put up to 2 Basic Energy cards from your discard pile into your hand.",
  ),
  /** Pal Pad (Item) — up to 2 Supporter cards from the discard → deck (shuffle). */
  "sv01-182": trainerCard(
    "sv01-182",
    "Item",
    "Shuffle up to 2 Supporter cards from your discard pile into your deck.",
  ),
  /** Super Rod (Item) — up to 3 Pokémon/Basic Energy from the discard → deck. */
  "sv02-188": trainerCard(
    "sv02-188",
    "Item",
    "Shuffle up to 3 in any combination of Pokémon and Basic Energy cards from your discard pile into your deck.",
  ),

  // — M5 op-slice: lookAtTopN (real catalog ids so the registry finds the
  //   programs; the effect text is cosmetic — the registry keys on the id). —
  /** Great Ball (Item) — look at the top 7, reveal a Pokémon → hand (shuffle). */
  "sv02-183": trainerCard(
    "sv02-183",
    "Item",
    "Look at the top 7 cards of your deck. You may reveal a Pokémon you find there and put it into your hand. Shuffle the other cards back into your deck.",
  ),
  /** Pokégear 3.0 (Item) — look at the top 7, reveal a Supporter → hand (shuffle). */
  "sv01-186": trainerCard(
    "sv01-186",
    "Item",
    "Look at the top 7 cards of your deck. You may reveal a Supporter card you find there and put it into your hand. Shuffle the other cards back into your deck.",
  ),

  // — M5 op-slice: moveEnergy (real catalog ids so the registry finds the
  //   programs; the effect text is cosmetic — the registry keys on the id). —
  /** Energy Switch (Item) — move a Basic Energy, own → own. */
  "sv01-173": trainerCard(
    "sv01-173",
    "Item",
    "Move a Basic Energy from 1 of your Pokémon to another of your Pokémon.",
  ),
  /** Poppy (Supporter) — move up to 2 any Energy, own → own. */
  "sv03-193": trainerCard(
    "sv03-193",
    "Supporter",
    "Move up to 2 Energy from 1 of your Pokémon to another of your Pokémon.",
  ),

  // — M5 op-slice: handRefresh (real catalog ids so the registry finds the
  //   programs; the effect text is cosmetic — the registry keys on the id). —
  /** Youngster (Supporter) — shuffle hand into deck, draw 5. */
  "sv01-198": trainerCard(
    "sv01-198",
    "Supporter",
    "Shuffle your hand into your deck. Then, draw 5 cards.",
  ),
  /** Judge (Supporter) — each player shuffles hand into deck, draws 4. */
  "sv01-176": trainerCard(
    "sv01-176",
    "Supporter",
    "Each player shuffles their hand into their deck and draws 4 cards.",
  ),
  /** Brassius (Supporter) — shuffle hand into deck, draw (hand size + 1). */
  "sv03-187": trainerCard(
    "sv03-187",
    "Supporter",
    "Count the cards in your hand, shuffle those cards into your deck, then draw that many cards plus 1.",
  ),
  /** Katy (Supporter) — shuffle hand into deck, draw 8, your turn ends. */
  "sv01-177": trainerCard(
    "sv01-177",
    "Supporter",
    "Shuffle your hand into your deck. Then, draw 8 cards. Your turn ends.",
  ),
  /** Iono (Supporter) — each player's hand to the BOTTOM, draw their Prize count. */
  "sv02-185": trainerCard(
    "sv02-185",
    "Supporter",
    "Each player shuffles their hand and puts it on the bottom of their deck. If either player put any cards on the bottom of their deck in this way, each player draws a card for each of their remaining Prize cards.",
  ),

  // — M5 op-slice: board conditions (real catalog ids so the registry finds the
  //   programs; the effect text is cosmetic — the registry keys on the id). —
  /** Fighting Au Lait (Item) — the printed PLAY GATE + heal 60. */
  "sv02-181": trainerCard(
    "sv02-181",
    "Item",
    "You can use this card only if you have more Prize cards remaining than your opponent. Heal 60 damage from 1 of your Pokémon.",
  ),
  /** Falkner (Supporter) — draw 2, +2 more if YOUR Stadium is in play. */
  "sv02-180": trainerCard(
    "sv02-180",
    "Supporter",
    "Draw 2 cards. If you have a Stadium in play, draw 2 more cards.",
  ),
  /** Grusha (Supporter) — draw to 5 in hand, to 7 instead if no Energy on your board. */
  "sv02-184": trainerCard(
    "sv02-184",
    "Supporter",
    "Draw cards until you have 5 cards in your hand. If none of your Pokémon have any Energy attached, draw cards until you have 7 cards in your hand instead.",
  ),
  /** fix-condgate — FIXTURE Item (registry FIX_CONDGATE): a conditionGate whose
      BOTH arms hold a PARKING op, proving a branch can park like any other step. */
  "fix-condgate": itemTrainer("fix-condgate"),
  /** fix-gateorder — FIXTURE Item (registry FIX_GATEORDER): an attach BEFORE the
      gate (so it flips the condition), a two-op arm, and an op AFTER the gate. */
  "fix-gateorder": itemTrainer("fix-gateorder"),
  /** fix-gatedsup — FIXTURE Supporter (registry FIX_GATEDSUP): the only gated
      SUPPORTER, pinning that a rejected gate does not burn the §7.2 allowance. */
  "fix-gatedsup": trainerCard("fix-gatedsup", "Supporter", "Gated draw 1 (fixture)."),

  // — M5 op-slice: discardEnergy (real catalog ids so the registry finds the
  //   programs; Trainer effect text is cosmetic — the registry keys on the id). —
  /** Crushing Hammer (Item) — coin-gated: an Energy off 1 of the opponent's. */
  "sv01-168": trainerCard(
    "sv01-168",
    "Item",
    "Flip a coin. If heads, discard an Energy from 1 of your opponent's Pokémon.",
  ),
  /** Giacomo (Supporter) — a Special Energy off EACH of the opponent's Pokémon. */
  "sv02-182": trainerCard(
    "sv02-182",
    "Supporter",
    "Discard a Special Energy from each of your opponent's Pokémon.",
  ),
  /** Mawile (Basic {M}, registry MAWILE) — "Special Eater", an onPlayToBench
      trigger that discards a Special Energy from the opponent's Active. The
      printed stats are the catalog's (90 HP, retreat 1, Sharp Fang 90); the
      Ability lives in the registry, so the card needs no `abilities` here. */
  "sv03-143": battler("sv03-143", {
    name: "Mawile",
    hp: 90,
    types: ["Metal"],
    retreat: 1,
    attacks: [{ cost: ["Metal", "Colorless", "Colorless"], name: "Sharp Fang", damage: 90 }],
  }),
  /** fix-hammer — FIXTURE Item (registry FIX_HAMMER): the `opponentChosen` discard
      WITHOUT Crushing Hammer's coin gate, so the arm's park / forced pick / whiff
      gate are testable without threading a seeded flip. */
  "fix-hammer": itemTrainer("fix-hammer"),
  /** A second Special Energy print, so one Pokémon can carry TWO distinct Special
      Energy cards — the only board on which Giacomo's per-Pokémon pick is a real
      choice rather than a forced one. */
  "fix-special-2": specialEnergy("fix-special-2", "fix-special-2"),
  /** M5 op-slice: attack effect programs can PARK. The self-discard attack cost
      is a DERIVED effect (effects.ts reads the printed sentence — there is no
      registry row), so unlike every registry-authored card above these two carry
      their attack `effect` text VERBATIM from the catalog: change a character and
      the derivation, and the test, correctly stops happening.

      Both are real sv01–03 BASICS, so they reach the Active spot straight out of
      setup with no evolution scaffolding. Printed stats verified against the
      local D1 ingest, 2026-07-21. */
  "sv02-028": battler("sv02-028", {
    name: "Paldean Tauros",
    hp: 130,
    types: ["Fire"],
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      // "20+" — the self-counter scaling clause is now SIMULATED (0.34.0,
      // deriveAttackDamageBonus): Raging Horns folds 10 per damage counter on this
      // Pokémon into its base before W/R, so it is off the ATTACK_EFFECT_SKIPPED path.
      {
        cost: ["Colorless", "Colorless"],
        name: "Raging Horns",
        damage: "20+",
        effect: "This attack does 10 more damage for each damage counter on this Pokémon.",
      },
      {
        cost: ["Fire", "Fire", "Colorless"],
        name: "Blaze Dash",
        damage: 120,
        effect: "Discard an Energy from this Pokémon.",
      },
    ],
  }),
  "sv01-039": battler("sv01-039", {
    name: "Charcadet",
    hp: 60,
    types: ["Fire"],
    retreat: 1,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire"],
        name: "Ember",
        damage: 30,
        effect: "Discard an Energy from this Pokémon.",
      },
    ],
  }),
  /** M5: `damageSelf` + the two-seat attack epilogue. Skeledirge sv01-038's
      "Blazing Shout" is the engine's FIRST self-damaging attack — 190 to the
      defender, then "This Pokémon also does 30 damage to itself.", a DERIVED
      recoil (so the text is verbatim from the catalog: change a character and
      the derivation, and the test, correctly stops). Its first attack
      "Passionate Singing" attaches Energy from the discard, which no rule
      derives, so it stays on the loud ATTACK_EFFECT_SKIPPED path — kept so the
      card's real attack list is its own. A Stage 2, fielded via setActiveFromDeck
      (which bypasses the evolution scaffolding). Printed stats verified against
      the local D1 ingest, 2026-07-23. */
  "sv01-038": battler("sv01-038", {
    name: "Skeledirge",
    hp: 180,
    types: ["Fire"],
    stage: "Stage2",
    evolveFrom: "Crocalor",
    retreat: 3,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire"],
        name: "Passionate Singing",
        damage: 50,
        effect:
          "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
      },
      {
        cost: ["Fire", "Fire", "Colorless"],
        name: "Blazing Shout",
        damage: 190,
        effect: "This Pokémon also does 30 damage to itself.",
      },
    ],
  }),
  /** FIXTURE — a SECOND catalog print of Fire Energy. The real catalog carries
      Basic Fire Energy under three ids (sve-002 / sve-010 / sve-018), all
      identical in play, so the interchangeability key must read what a Basic
      PROVIDES rather than its id. Same name as fix-fire-energy, different id —
      exactly that shape. */
  "fix-fire-energy-alt": typedEnergy("fix-fire-energy-alt", "Fire"),
  /** FIXTURE — a body big enough to SURVIVE Blaze Dash's 120, so the epilogue's
      no-KO path (the plain §5.3 turn end) can be pinned separately from its KO
      path. fix-wall's 120 HP is exactly lethal to it, which is the trap. */
  "fix-bigbody": battler("fix-bigbody", { hp: 200 }),
  /** FIXTURE — the "Discard all Energy from this Pokémon." arm on a BASIC body.
      Every real print of that sentence is an evolution (Pawmot Stage 2, Raichu
      Stage 1), and the arm has no decision to test, so the board case runs on a
      fixture while the real cards' text is pinned by the deriver unit tests.
      Costed {C} so it can attack holding any mix of Energy. */
  "fix-alldiscard": battler("fix-alldiscard", {
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Full Discharge",
        damage: 40,
        effect: "Discard all Energy from this Pokémon.",
      },
    ],
  }),

  // — M5 op-slice: the discardEnergy ATTACK arms (name / stage / hp / retreat /
  //   type and the WHOLE attack row verified verbatim against the local catalog
  //   2026-07-21 — the printed effect text IS the program here, since attacks
  //   derive rather than read a registry row). Two deliberate simplifications,
  //   declared so a later reader does not trust more than is here: printed
  //   WEAKNESS is omitted (these cards only ever ATTACK in these suites, and a
  //   defender's weakness is what damage math reads), and the cards with two
  //   printed attacks carry only the discarding one — so a fixture's
  //   `index: 0` is Slither Wing's and Koraidon's SECOND printed attack. —
  /** Pincurchin (sv02-072) — "Needle Crush" [L][L][L] 70: the bare
      opponent-side twin, on a Basic body. */
  "sv02-072": battler("sv02-072", {
    name: "Pincurchin",
    hp: 80,
    types: ["Lightning"],
    retreat: 2,
    attacks: [
      {
        cost: ["Lightning", "Lightning", "Lightning"],
        name: "Needle Crush",
        damage: 70,
        effect: "Discard an Energy from your opponent's Active Pokémon.",
      },
    ],
  }),
  /** Tympole (sv03-050) — "Screw Tail" [W] 10: the same twin behind a coin flip,
      on the cheapest printed cost in the family (one Energy, so a seeded flip is
      all the board setup a heads/tails pair needs). */
  "sv03-050": battler("sv03-050", {
    name: "Tympole",
    hp: 70,
    types: ["Water"],
    retreat: 1,
    attacks: [
      {
        cost: ["Water"],
        name: "Screw Tail",
        damage: 10,
        effect: "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
      },
    ],
  }),
  /** Slither Wing (sv06.5-026) — "Smashing Wing" [F][F][C] 130: the exact-N
      self-discard at N=2, on a Basic body. */
  "sv06.5-026": battler("sv06.5-026", {
    name: "Slither Wing",
    hp: 140,
    types: ["Fighting"],
    retreat: 3,
    attacks: [
      {
        cost: ["Fighting", "Fighting", "Colorless"],
        name: "Smashing Wing",
        damage: 130,
        effect: "Discard 2 Energy from this Pokémon.",
      },
    ],
  }),
  /** Koraidon (sv01-124, the non-ex Basic) — "Rampaging Fang" [F][F][F][C] 190:
      the exact-N self-discard at N=3, the biggest printed count in the family. */
  "sv01-124": battler("sv01-124", {
    name: "Koraidon",
    hp: 130,
    types: ["Fighting"],
    retreat: 2,
    attacks: [
      {
        cost: ["Fighting", "Fighting", "Fighting", "Colorless"],
        name: "Rampaging Fang",
        damage: 190,
        effect: "Discard 3 Energy from this Pokémon.",
      },
    ],
  }),
  /** FIXTURE — an exact-N discard whose N EXCEEDS what the attack costs, so the
      SHORT board ("do as much as you can") is reachable at all. Every printed
      exact-N card pays a cost at least as big as its own discard (Slither Wing
      3 Energy / discard 2; Koraidon 4 / 3), which makes the shortfall unreachable
      through a real attack — but the rule is real and a future card need not be
      so tidy, so it runs on a fixture: [C] to attack, "Discard 4 Energy". */
  "fix-discard4": battler("fix-discard4", {
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Overdraw",
        damage: 20,
        effect: "Discard 4 Energy from this Pokémon.",
      },
    ],
  }),
  /** A Basic Lightning Energy — pays Needle Crush's [L][L][L]. */
  "fix-lightning-energy": typedEnergy("fix-lightning-energy", "Lightning"),
  /** FIXTURE — a SECOND catalog print of Fighting Energy, the fix-fire-energy-alt
      shape for the {F} attackers: same provision, different id, so a board can
      hold interchangeable copies whose collapse an exact-N pick must survive. */
  "fix-fighting-energy-alt": typedEnergy("fix-fighting-energy-alt", "Fighting"),

  // — M5 op-slice: the providesEnergy filter (name / stage / evolveFrom / hp /
  //   retreat / type and the WHOLE attack row verified verbatim against the
  //   local catalog 2026-07-21). Unlike the slice above, these keep their REAL
  //   stages — every one of them is an Evolution, and the suites place them by
  //   surgery rather than by evolving, which reads the stack top and not the
  //   stage. Two declared simplifications, the same two as above: printed
  //   WEAKNESS is omitted (these cards only ATTACK here), and a card with two
  //   printed attacks carries only the discarding one — so Kilowattrel's
  //   `index: 0` is its SECOND printed attack. —
  /** Kilowattrel (sv01-079) — "Thunder Blast" [L][C][C] 140: the typed
      self-discard at count 1, in the modern brace notation. Its {L} cost is what
      makes the Luminous case sharp — the same wildcard Energy can PAY the cost
      and then be taken by the discard, which is the whole point of reading
      provision rather than the print. */
  "sv01-079": battler("sv01-079", {
    name: "Kilowattrel",
    hp: 120,
    stage: "Stage1",
    evolveFrom: "Wattrel",
    types: ["Lightning"],
    retreat: 1,
    attacks: [
      {
        cost: ["Lightning", "Colorless", "Colorless"],
        name: "Thunder Blast",
        damage: 140,
        effect: "Discard a {L} Energy from this Pokémon.",
      },
    ],
  }),
  /** Arcanine ex (sv01-032) — "Bright Flame" [R][R][R] 250: the typed discard at
      an exact N (2), so the count and the type constrain the same pick. */
  "sv01-032": battler("sv01-032", {
    name: "Arcanine ex",
    hp: 280,
    stage: "Stage1",
    evolveFrom: "Growlithe",
    types: ["Fire"],
    retreat: 3,
    attacks: [
      {
        cost: ["Fire", "Fire", "Fire"],
        name: "Bright Flame",
        damage: 250,
        effect: "Discard 2 {R} Energy from this Pokémon.",
      },
    ],
  }),
  /** Charmeleon (swsh10.5-009) — "Flamethrower" [R][R][C][C] 100: the SPELLED-OUT
      notation at count 1 ("a Fire Energy"), the swsh-era wording the same rule
      has to read. */
  "swsh10.5-009": battler("swsh10.5-009", {
    name: "Charmeleon",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Charmander",
    types: ["Fire"],
    retreat: 2,
    attacks: [
      {
        cost: ["Fire", "Fire", "Colorless", "Colorless"],
        name: "Flamethrower",
        damage: 100,
        effect: "Discard a Fire Energy from this Pokémon.",
      },
    ],
  }),
  /** Charizard (swsh10.5-010) — "Flare Blitz" [R][R][C][C] 170: the spelled-out
      notation at count "all". The typed "all" is the one that proves the filter
      is doing work in the APPLY and not just the prompt — every Fire comes off
      and everything else stays attached, where the untyped "all" strips the lot.

      A THIRD simplification, beyond the two the header declares, and it is the
      one worth knowing about: the printed **Ability "Burn Brightly"** ("Each
      basic Fire Energy attached to your Pokémon provides {R}{R} Energy") is
      dropped. It is unauthored in the registry either way, so the engine already
      treats it as not-simulated — but it is itself a PROVISION modifier, and
      `continuous.ts unitsOf` has no hook for a Pokémon Ability that changes what
      attached Energy provides (provision is print + EnergyProgram only). Authoring
      it would therefore widen the provision model that both this filter and §8.2's
      cost matcher read, not just add a row. */
  "swsh10.5-010": battler("swsh10.5-010", {
    name: "Charizard",
    hp: 170,
    stage: "Stage2",
    evolveFrom: "Charmeleon",
    types: ["Fire"],
    retreat: 3,
    attacks: [
      {
        cost: ["Fire", "Fire", "Colorless", "Colorless"],
        name: "Flare Blitz",
        damage: 170,
        effect: "Discard all Fire Energy from this Pokémon.",
      },
    ],
  }),
  /** FIXTURE — a typed discard whose type its own COST does not require, so the
      "nothing of that type is attached" no-op is reachable at all. Every printed
      card in this family discards a type it must already have paid with
      (Kilowattrel's [L][C][C] discards {L}; Arcanine ex's [R][R][R] discards
      {R}), so a real attack ALWAYS has at least one match — the mirror of the
      fix-discard4 argument one slice earlier, and the reason both fixtures exist:
      the rule is real even where the printed pool cannot reach it. [C] to attack,
      "Discard a {W} Energy". */
  "fix-typeddiscard": battler("fix-typeddiscard", {
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Rinse",
        damage: 20,
        effect: "Discard a {W} Energy from this Pokémon.",
      },
    ],
  }),
  /** FIXTURE Item — carries the registry's fix-pilescan program: a
      `providesEnergy` filter handed to a DECK search, which must match nothing. */
  "fix-pilescan": itemTrainer("fix-pilescan"),
  /** FIXTURE Special Energy providing TWO distinct concrete types ({R} + {W}) —
      the multi-unit EnergyProgram shape no authored card exercises. */
  "fix-blend": specialEnergy("fix-blend", "fix-blend"),
  /** FIXTURE — a defender that outlives every printed damage in this slice's deck
      (Arcanine ex hits for 250, the biggest here). A survivor keeps the §8.1 KO
      tail out of the way, so a test about WHICH Energy came off is only ever
      about that. fix-wall (120) and fix-bigbody (200) both die to Bright Flame. */
  "fix-titan": battler("fix-titan", { hp: 340, retreat: 4 }),
  /** Armarouge (sv01-041) — the filter's SECOND consumer, and the only one with a
      registry row: "Fire Off" (Ability) — "As often as you like during your turn,
      you may move a {R} Energy from 1 of your Benched Pokémon to your Active
      Pokémon." Its printed attack rides along because a fixture Pokémon that
      cannot attack makes an awkward Active. */
  "sv01-041": battler("sv01-041", {
    name: "Armarouge",
    hp: 130,
    stage: "Stage1",
    evolveFrom: "Charcadet",
    types: ["Fire"],
    retreat: 2,
    attacks: [
      {
        cost: ["Fire", "Fire", "Colorless"],
        name: "Flame Cannon",
        damage: 90,
        effect: "Your opponent's Active Pokémon is now Burned.",
      },
    ],
  }),

  // — M5 op-slice: attachFromTop (the from-the-top ATTACH). The Item's fixture
  //   is a plain trainerCard (the registry keys on the id; its effect text is
  //   cosmetic), and the Pokémon's name / stage / evolveFrom / hp / retreat /
  //   type and whole attack row are verified verbatim against the local catalog
  //   2026-07-21. Printed WEAKNESS is omitted, as in the two slices above —
  //   Hydreigon is only ever the ATTACHER here, never a defender. —
  /** Electric Generator (sv01-170, Item) — the top 5, up to 2 Basic {L} Energy
      cards, onto your Benched {L} Pokémon; the leftovers shuffle back. */
  "sv01-170": trainerCard(
    "sv01-170",
    "Item",
    "Look at the top 5 cards of your deck and attach up to 2 Basic {L} Energy cards you find there to your Benched {L} Pokémon in any way you like. Shuffle the other cards back into your deck.",
  ),
  /** Hydreigon (sv02-140) — "Tri Howl" (Ability): the top 3, any number of Energy
      cards, onto ANY of your Pokémon, and the other cards are DISCARDED. Its
      printed attack rides along because a fixture Pokémon that cannot attack makes
      an awkward Active — and Tri Howl is usable from the Bench, so the suites need
      it in both spots. */
  "sv02-140": battler("sv02-140", {
    name: "Hydreigon",
    hp: 180,
    stage: "Stage2",
    evolveFrom: "Zweilous",
    types: ["Darkness"],
    retreat: 3,
    attacks: [{ cost: ["Darkness", "Darkness", "Colorless"], name: "Dark Cutter", damage: 160 }],
  }),
  /** FIXTURE — a Lightning-typed body, the target Electric Generator's printed
      "your Benched {L} Pokémon" needs. The pool's other Lightning Pokémon
      (Kilowattrel, Pincurchin) carry attacks whose effects derive, which would put
      an unrelated discard in the middle of an attach test. */
  "fix-lightning-1": battler("fix-lightning-1", { types: ["Lightning"], hp: 70, retreat: 1 }),
  // — M5 op-slice: payFromHand. Every field below (name / stage /
  //   evolveFrom / hp / retreat / type / trainerType and the whole attack and
  //   effect rows) is verified verbatim against the local catalog 2026-07-21.
  //   Printed WEAKNESS is omitted, as in the slices above — none of these is ever
  //   a defender here. The two Pokémon carry their printed attacks so a fixture
  //   Active is not one that cannot attack; neither attack DERIVES (a coin-flip
  //   damage bonus and a Special-Energy damage bonus are both shapes this engine
  //   does not express), so neither can put an unrelated effect into a cost test. —
  /** Ultra Ball (sv01-196, Item) — the cost family's Trainer form: discard 2
      OTHER cards, then search the deck for a Pokémon. */
  "sv01-196": trainerCard(
    "sv01-196",
    "Item",
    "You can use this card only if you discard 2 other cards from your hand.\n\nSearch your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),
  /** Earthen Vessel (sv06.5-096, Item) — the same at count 1 ("another card"),
      over a Basic Energy search that takes up to 2. */
  "sv06.5-096": trainerCard(
    "sv06.5-096",
    "Item",
    "You can use this card only if you discard another card from your hand.\n\nSearch your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
  ),
  /** Revavroom (sv01-142) — "Rumbling Engine": discard an ENERGY card, then draw
      until you hold 6. The family's ORDER witness (the draw counts the hand after
      the payment) and its first cost whose candidates are not all
      interchangeable (`anyEnergy` spans Basic and Special). */
  "sv01-142": battler("sv01-142", {
    name: "Revavroom",
    hp: 140,
    stage: "Stage1",
    evolveFrom: "Varoom",
    types: ["Metal"],
    retreat: 2,
    attacks: [
      {
        cost: ["Metal", "Colorless", "Colorless", "Colorless"],
        name: "Knock Away",
        effect: "Flip a coin. If heads, this attack does 90 more damage.",
        damage: "90+",
      },
    ],
  }),
  /** Tinkaton (sv02-105) — "Gather Materials": discard ANY card, then draw 3. The
      cost's general form, and the one the pre-op `AbilityCost` field could not
      express.

      SINCE D118 it is also the fourth printing of the parameterised energy clause
      (see Scovillain / Galvantula / Cetitan at the end of this pool), and the only
      STAGE 2 in that cast: "Special Hammer" (90+, +90 while any Special Energy is
      attached to it) is the CLASS arm at a second N, the pair that proves the
      pattern carries the condition and never the amount. Its Ability is
      registry-authored (that is the slice above) but the registry row carries NO
      `attack` key at all, so the attack is pure text and the printed sentence IS
      the wiring — it is the cast's one card where the two coexist on one id, and
      energyClause.test.ts pins that split. The ×2 Metal Weakness is
      faithful and inert for both slices — nothing in this pool attacks with a
      Metal body. */
  "sv02-105": battler("sv02-105", {
    name: "Tinkaton",
    hp: 140,
    stage: "Stage2",
    evolveFrom: "Tinkatuff",
    types: ["Psychic"],
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Gather Materials",
        effect:
          "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 3 cards.",
      },
    ],
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Special Hammer",
        effect:
          "If this Pokémon has any Special Energy attached, this attack does 90 more damage.",
        damage: "90+",
      },
    ],
  }),
  /** Radiant Blastoise (swsh10.5-018) — "Pump Shot": Meowscarada's Ability one
      type and one counter apart, so it proves the cost is DATA. */
  "swsh10.5-018": battler("swsh10.5-018", {
    name: "Radiant Blastoise",
    hp: 150,
    stage: "Basic",
    types: ["Water"],
    retreat: 2,
    attacks: [
      {
        cost: ["Water", "Water", "Colorless"],
        name: "Torrential Cannon",
        effect: "During your next turn, this Pokémon can't use Torrential Cannon.",
        damage: 170,
      },
    ],
  }),
  // — M5 op-slice: the hand cost that is NOT a discard. Both rows verified
  //   verbatim against the local catalog 2026-07-21. —
  /** Dendra (sv02-179, Supporter) — the payment that goes UNDER THE DECK, and the
      printed play gate stated as its contrapositive. */
  "sv02-179": trainerCard(
    "sv02-179",
    "Supporter",
    "Put a card from your hand on the bottom of your deck. If you do, draw cards until you have 5 cards in your hand. (If you have no other cards in your hand, you can't use this card.)",
  ),
  /** Skwovet (sv01-151) — "Nest Stash": the same destination reached by the WHOLE
      hand, which is `handRefresh` with Iono's two riders. Its printed attack is a
      plain 20 with no effect text, so a Skwovet Active cannot put an unrelated
      effect into an Ability test. */
  "sv01-151": battler("sv01-151", {
    name: "Skwovet",
    hp: 60,
    stage: "Basic",
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Bite", damage: 20 }],
  }),
  // — M5 op-slice: §9.2 op→op data flow. Both rows verified verbatim against the
  //   local catalog 2026-07-22. —
  /** Miriam (sv01-179, Supporter) — the "in this way" gate, with the deck shuffle
      sitting between the clause and the op it refers to. */
  "sv01-179": trainerCard(
    "sv01-179",
    "Supporter",
    "Shuffle up to 5 Pokémon from your discard pile into your deck. If you shuffled any cards into your deck in this way, draw 3 cards.",
  ),
  /** Superior Energy Retrieval (sv02-189, Item) — the hand cost that pays INTO
      the pile its own next clause reads. */
  "sv02-189": trainerCard(
    "sv02-189",
    "Item",
    "You can use this card only if you discard 2 other cards from your hand.\n\nPut up to 4 Basic Energy cards from your discard pile into your hand. (You can't choose a card you discarded with the effect of this card.)",
  ),
  // — M5 op-slice: attachFromDeck. Both card rows verified verbatim against the
  //   local catalog 2026-07-22; printed WEAKNESS is omitted as in the slices
  //   above (Charizard ex only ever ATTACHES here, never defends). —
  /** Charizard ex (sv03-125) — "Infernal Reign", the onEvolve deck search that
      attaches "in any way you like".

      **`evolveFrom` is the ONE deliberate deviation from the print.** The real
      card evolves from Charmeleon; here it evolves from `fix-stage1`, so the
      suite can drive a real `evolve` action off the pool's existing
      fix-basic-1 → fix-stage1 chain instead of carrying two more Fire bodies
      whose only job is to be evolved through. The trigger under test fires on
      the EVOLVE, and the evolve rule reads `evolveFrom` against the top card's
      NAME — so what the chain is made of is exactly the part this slice does not
      test. Its printed attack rides along verbatim (an Active that cannot attack
      is an awkward fixture); as of 0.35.0 "Burning Darkness" DERIVES a Prize-count
      scaling bonus (opponentPrizesTaken), but the attach tests never DECLARE the
      attack, so it never fires inside one.

      Note the card is **{D}**, not {R}: Charizard ex from Obsidian Flames is a
      DARKNESS Pokémon that attacks with Fire Energy and accelerates Basic {R}.
      Its op carries no `targetType`, so its own type changes nothing about this
      slice — but the field is the catalog's, and a "verified verbatim" banner
      over a quietly invented Fire type is exactly the kind of false claim this
      repo treats as a defect. */
  "sv03-125": battler("sv03-125", {
    name: "Charizard ex",
    hp: 330,
    stage: "Stage2",
    evolveFrom: "fix-stage1",
    types: ["Darkness"],
    retreat: 2,
    attacks: [
      {
        cost: ["Fire", "Fire"],
        name: "Burning Darkness",
        damage: "180+",
        effect: "This attack does 30 more damage for each Prize card your opponent has taken.",
      },
    ],
  }),
  /** Entei (sv03-030) — the anchor-guard witness that REPLACES Charizard once
      "Burning Darkness" became simulated (0.35.0). "Blaze Ball" (60+, "This attack
      does 20 more damage for each {R} Energy attached to this Pokémon.") is an
      additive "+" whose count source — Energy attached to itself — no reader
      simulates, so it STAYS on the loud ATTACK_EFFECT_SKIPPED path, keeping the
      deriver-is-narrow witness the two Prize/self-counter readers would otherwise
      leave uncovered. Verbatim vs the local D1 catalog (Basic Fire, 130 HP,
      {C}{C}{C}, ×2 Water). */
  "sv03-030": battler("sv03-030", {
    name: "Entei",
    hp: 130,
    types: ["Fire"],
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Blaze Ball",
        damage: "60+",
        effect: "This attack does 20 more damage for each {R} Energy attached to this Pokémon.",
      },
    ],
  }),
  /** Pecharunt ex (sv06.5-039) — the "×"/multiply Prize family (0.36.0): "Irritated
      Outburst" (60×, "This attack does 60 damage for each Prize card your opponent
      has taken.", NO "more") does 60 × (the opponent's TAKEN Prizes) as the WHOLE
      damage, its printed "60×" base dropped (deriveAttackDamageMultiplier). A Basic,
      so it reaches the Active straight out of setup; force-placed by surgery here to
      control the board. The printed STATS and the attack row are verbatim vs the
      local D1 catalog (Basic Darkness, 190 HP, retreat 1, ×2 Fighting, {D}{D}); its
      "Subjugating Chains" Ability is OMITTED — it has no registry row and no test
      declares it (this slice exercises only the attack), the same reason the
      attacher fixtures above omit an unexercised printed field rather than claim a
      verbatim card while quietly dropping one. */
  "sv06.5-039": battler("sv06.5-039", {
    name: "Pecharunt ex",
    hp: 190,
    types: ["Darkness"],
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness", "Darkness"],
        name: "Irritated Outburst",
        damage: "60×",
        effect: "This attack does 60 damage for each Prize card your opponent has taken.",
      },
    ],
  }),
  /** Annihilape (sv01-109) — the "×"/multiply family's per-70 twin (0.36.0): "Rage
      Fist" (70×, same Prize-count source, NO "more") does 70 × (taken Prizes), so
      per 70 ≠ Pecharunt's 60 pins the fold reads the CAPTURED per here too. Its
      second attack "Dynamite Punch" (170 + a 50 recoil) is a `damageSelf` already
      simulated (0.33.0), kept so the card's real attack list is its own. A Stage 2
      (from Primeape), fielded via setActiveFromDeck. Verbatim vs the local D1
      catalog (140 HP, Fighting, retreat 2, ×2 Psychic). */
  "sv01-109": battler("sv01-109", {
    name: "Annihilape",
    hp: 140,
    stage: "Stage2",
    evolveFrom: "Primeape",
    types: ["Fighting"],
    retreat: 2,
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Rage Fist",
        damage: "70×",
        effect: "This attack does 70 damage for each Prize card your opponent has taken.",
      },
      {
        cost: ["Fighting", "Fighting"],
        name: "Dynamite Punch",
        damage: 170,
        effect: "This Pokémon also does 50 damage to itself.",
      },
    ],
  }),
  /** Wo-Chien ex (sv02-027) — the "×"/multiply family's benched-TARGET sibling
      (0.37.0): "Covetous Ivy" ({G}{G}{C}, no `damage` field) does 60 × (the
      opponent's TAKEN Prizes) to 1 CHOSEN Benched Pokémon, dealt as attack damage
      with NO Weakness/Resistance (§8.5, Benched) — a `damageChosen` op (count 1,
      `deals` + `perTakenPrize`), NOT the pre-W/R Defender fold Pecharunt uses.
      Its second attack "Forest Blast" ({G}{G}{G}{C}, 220) is a plain hit, kept so
      the card's real attack list is its own. A Basic. Verbatim vs the local D1
      catalog (230 HP, Grass, retreat 4, ×2 Fire). */
  "sv02-027": battler("sv02-027", {
    name: "Wo-Chien ex",
    hp: 230,
    types: ["Grass"],
    retreat: 4,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass", "Grass", "Colorless"],
        name: "Covetous Ivy",
        effect:
          "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      { cost: ["Grass", "Grass", "Grass", "Colorless"], name: "Forest Blast", damage: 220 },
    ],
  }),
  /** FIXTURE — a per-40 benched-snipe-scaled probe. Wo-Chien is the only real card
      on this reader and always prints per 60, so an APPLY test at per ≠ 60 is the
      only thing that pins the interpreter multiplies the CAPTURED `amount` (not a
      hard-coded 60) — the false-coverage the "×"/multiply and additive families
      each closed with a synthetic probe. "Bramble" carries the derived text
      verbatim at 40, so a character change stops the derivation and the test. */
  "fix-bramble": battler("fix-bramble", {
    hp: 120,
    types: ["Grass"],
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Bramble",
        effect:
          "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.",
      },
    ],
  }),
  /** Miraidon (sv01-080) — the flat benched-snipe RIDER family (0.38.0): "Lightning
      Laser" ({L}{L}{C}, 90) hits the Defender AND, via "This attack also does 30
      damage to 1 of your opponent's Benched Pokémon.", snipes one chosen benched
      body for a fixed 30 (a `damageChosen` count-1 `deals` op, NO `perTakenPrize` —
      Covetous Ivy minus the Prize scaling). Its "Sharp Fang" ({C}{C}, 30) is a plain
      hit, kept so the attack list is its own. A Basic. Verbatim vs the local D1
      catalog (120 HP, Lightning, retreat 1, ×2 Fighting). */
  "sv01-080": battler("sv01-080", {
    name: "Miraidon",
    hp: 120,
    types: ["Lightning"],
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Sharp Fang", damage: 30 },
      {
        cost: ["Lightning", "Lightning", "Colorless"],
        name: "Lightning Laser",
        damage: 90,
        effect:
          "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  /** Tadbulb (sv03-076) — the rider family's small-N twin (+10, main 20): "Shake and
      Discharge" ({L}{C}, 20) with the same "also does 10 damage to 1 … Benched"
      clause. per 10 ≠ Miraidon's 30 pins the derive captures the amount. A Basic.
      Verbatim vs the local D1 catalog (60 HP, Lightning, retreat 2, ×2 Fighting). */
  "sv03-076": battler("sv03-076", {
    name: "Tadbulb",
    hp: 60,
    types: ["Lightning"],
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Lightning", "Colorless"],
        name: "Shake and Discharge",
        damage: 20,
        effect:
          "This attack also does 10 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  /** Rotom (sv01-069) — the ANY-target snipe family (0.39.0): "Linear Attack" ({C},
      no `damage` field) does 20 damage to 1 of your opponent's Pokémon — the ACTIVE
      or a Benched one. A Lightning attacker, so vs a {L}-weak Active it lands 40
      (W/R applies to the Active, §8.5) but only 20 on the SAME body Benched — the
      discriminating pair. A Basic. Verbatim vs the local D1 catalog (60 HP,
      Lightning, retreat 1, ×2 Fighting). */
  "sv01-069": battler("sv01-069", {
    name: "Rotom",
    hp: 60,
    types: ["Lightning"],
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Linear Attack",
        effect:
          "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  /** Fezandipiti ex (sv06.5-038) — the any-target family's big twin: "Cruel Arrow"
      ({C}{C}{C}, 100) to 1 of your opponent's Pokémon. A Darkness attacker (so no
      Weakness against the {L}-weak bodies here — a flat 100 either zone), it pins
      the amount ≠ Rotom's 20 and an auto-take on an all-but-Active-empty board. A
      Basic. Verbatim vs the local D1 catalog (210 HP, Darkness, retreat 1, ×2
      Fighting). */
  "sv06.5-038": battler("sv06.5-038", {
    name: "Fezandipiti ex",
    hp: 210,
    types: ["Darkness"],
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Cruel Arrow",
        effect:
          "This attack does 100 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  /** FIXTURE — a {L}-weak body (130 HP, ×2 Lightning), the any-target snipe's W/R
      witness: sniped as the Active by a Lightning attacker it takes double, sniped
      Benched it takes flat, and 130 HP survives both (40 / 20) so the math stands
      alone. Basic, so it pins as a setup Active. */
  "fix-lightning-weak": battler("fix-lightning-weak", {
    types: ["Grass"],
    hp: 130,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),
  /** FIXTURE — a synthetic {L} "Feint Attack" witness for the `ignoreWR` snipe. The
      real print is Umbreon sv03-130 (Darkness), but the W/R skip is type-agnostic, so
      typing it {L} lets fix-lightning-weak — the family's existing W/R witness — show
      the Weakness that `ignoreWR` NULLS (it would double to 100 on the {L}-weak Active
      without the flag; 50 flat with it). The attack text is the card's VERBATIM SV
      wording, so it derives through the same `CHOSEN_ANY_TARGET` path as the real
      card. A Basic; {C} cost so fix-lightning-energy pays. */
  "fix-feint": battler("fix-feint", {
    types: ["Lightning"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Feint Attack",
        effect:
          "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      },
    ],
  }),
  /** FIXTURE — a ×2 WATER body (200 HP), the Hail Blade W/R witness: Chien-Pao ex
      is a {W} attacker, so its `damageDefender` hit DOUBLES here (60 × k × 2),
      which is the proof that the op re-enters the full §8.5 pipeline rather than
      putting flat counters. 200 HP survives the doubled one-card discard (120),
      so the Weakness math stands alone with no KO in the way. A Basic, no rule
      box (1 Prize), no attacks — it only ever gets hit. */
  "fix-water-weak": battler("fix-water-weak", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  /** The ×2 Psychic witness for Mewtwo VSTAR "Psy Purge" (200 HP survives a
      1-card 90 × 2 = 180 hit, so the doubling stands alone without a KO). */
  "fix-psychic-weak": battler("fix-psychic-weak", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Psychic", value: "×2" }],
  }),
  /** Florges (sv01-093, D104) — "Blooming Garden": "Your Pokémon in play have no
      Weakness." The `removeWeakness` continuous own-board aura source (registry).
      A Psychic Stage 2 (140 HP, ×2 Metal), VERBATIM off the live D1 — never a
      starter, so tests place it via benchFromDeck surgery. Non-ex, so Ting-Lu ex
      "Cursed Land" can lock it (the §9-gating witness in bloomingGarden.test.ts). */
  "sv01-093": battler("sv01-093", {
    name: "Florges",
    types: ["Psychic"],
    stage: "Stage2",
    hp: 140,
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      { type: "Ability", name: "Blooming Garden", effect: "Your Pokémon in play have no Weakness." },
    ],
  }),
  /** Mewtwo VSTAR (swsh10.5-031) — a Psychic Stage VSTAR (280 HP) whose registry
      entry authors "Psy Purge" at INDEX 0 (discard up to 3 {P} → 90× the count,
      the CAPPED Hail Blade shape) and leaves index-1 "Star Raid" unsimulated.
      Both attacks carry the VERBATIM print. Placed active in tests via
      setActiveFromDeck (a VSTAR never STARTS a game), so its non-Basic stage never
      blocks setup — the deck's fix-bigbody is the mulligan-free starter. Its 280
      HP survives the max 270 (90 × 3), so it doubles as Psy Purge's own defender. */
  "swsh10.5-031": battler("swsh10.5-031", {
    name: "Mewtwo VSTAR",
    stage: "VSTAR",
    types: ["Psychic"],
    hp: 280,
    retreat: 2,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Psy Purge",
        damage: "90×",
        effect:
          "Discard up to 3 Psychic Energy from your Pokémon. This attack does 90 damage for each card you discarded in this way.",
      },
      {
        cost: ["Psychic", "Colorless"],
        name: "Star Raid",
        effect:
          "This attack does 120 damage to each of your opponent's Pokémon V. This damage isn't affected by Weakness or Resistance. (You can't use more than 1 VSTAR Power in a game.)",
      },
    ],
  }),
  /** Janine's Secret Art (sv06.5-059, Supporter) — up to 2 Basic {D} Energy out
      of the deck, one apiece onto your {D} Pokémon, and the §9.2 clause that
      poisons your own Active if one landed there. */
  "sv06.5-059": trainerCard(
    "sv06.5-059",
    "Supporter",
    "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a Basic {D} Energy card and attach it to that Pokémon. Then, shuffle your deck. If you attached Energy to your Active Pokémon in this way, it is now Poisoned.",
  ),
  /** A Basic Darkness Energy — what Janine's `basicEnergy` + `energyType`
      filter admits. Provision comes off the NAME (cards.ts energyProvidesOf), so
      "Darkness Energy" is what makes this a {D}. */
  "fix-dark-energy": typedEnergy("fix-dark-energy", "Darkness"),
  /** FIXTURE — a SECOND catalog print of Basic Darkness Energy (the
      fix-fire-energy-alt shape). The real catalog prints this card under four ids
      (sve-007/-015/-023, sv06.5-098), and the interchangeable collapse keys a
      Basic by what it PROVIDES rather than by id — so a deck holding both prints
      is what proves the collapse crosses the id boundary instead of merely
      de-duplicating one id. */
  "fix-dark-energy-alt": typedEnergy("fix-dark-energy-alt", "Darkness"),
  /** FIXTURE — a Darkness-typed BASIC body, the target Janine's printed "your
      {D} Pokémon" needs. The pool's only other {D} Pokémon is Hydreigon, a Stage
      2 that has to be placed by surgery and carries its own attaching Ability —
      both wrong for a test about which Pokémon may RECEIVE an attach. */
  "fix-dark-1": battler("fix-dark-1", { types: ["Darkness"], hp: 70, retreat: 1 }),

  // — M5 op-slice: EffectContext.sourceUid. Both Pawmot rows verified verbatim
  //   against the local catalog 2026-07-22 — stage, evolveFrom, type, HP,
  //   retreat 0, the Ability text, the whole attack row and the Fighting
  //   weakness are all the print's own. The suites place it by surgery
  //   (setActiveFromDeck/benchFromDeck), so the real `evolveFrom: "Pawmo"`
  //   costs nothing to keep: no test evolves into it, and a pool Pawmo whose
  //   only job is to be evolved through is what the Charizard fixture's
  //   declared deviation exists to avoid. —
  /** Pawmot (sv01-076) — "Electrogenesis", the printed "this Pokémon" attach. */
  "sv01-076": battler("sv01-076", {
    name: "Pawmot",
    hp: 130,
    stage: "Stage2",
    evolveFrom: "Pawmo",
    types: ["Lightning"],
    retreat: 0,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Electrogenesis",
        effect:
          "Once during your turn, you may search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      },
    ],
    attacks: [
      {
        cost: ["Lightning", "Lightning", "Colorless"],
        name: "Electro Paws",
        damage: 230,
        effect: "Discard all Energy from this Pokémon.",
      },
    ],
  }),
  /** Pawmot (sv01-209) — the reprint, byte-identical in the catalog. */
  "sv01-209": battler("sv01-209", {
    name: "Pawmot",
    hp: 130,
    stage: "Stage2",
    evolveFrom: "Pawmo",
    types: ["Lightning"],
    retreat: 0,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Electrogenesis",
        effect:
          "Once during your turn, you may search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      },
    ],
    attacks: [
      {
        cost: ["Lightning", "Lightning", "Colorless"],
        name: "Electro Paws",
        damage: 230,
        effect: "Discard all Energy from this Pokémon.",
      },
    ],
  }),
  /** FIXTURE — a SECOND catalog print of Basic Lightning Energy (the
      fix-dark-energy-alt shape): the collapse keys a Basic by what it PROVIDES,
      and a deck holding both prints is what proves Pawmot's one-card offer
      crosses the id boundary. */
  "fix-lightning-energy-alt": typedEnergy("fix-lightning-energy-alt", "Lightning"),

  // — M5 op-slice: healChosen "up to N". All three Saguaro rows verified
  //   verbatim against the local catalog (identical text on every print). —
  /** Saguaro (Supporter) — heal 50 from up to 2 of your Pokémon. */
  "sv02-187": trainerCard(
    "sv02-187",
    "Supporter",
    "Choose up to 2 of your Pokémon and heal 50 damage from each of them.",
  ),
  /** Saguaro (sv02-255) — the reprint, byte-identical in the catalog. */
  "sv02-255": trainerCard(
    "sv02-255",
    "Supporter",
    "Choose up to 2 of your Pokémon and heal 50 damage from each of them.",
  ),
  /** Saguaro (sv02-270) — the second reprint, byte-identical in the catalog. */
  "sv02-270": trainerCard(
    "sv02-270",
    "Supporter",
    "Choose up to 2 of your Pokémon and heal 50 damage from each of them.",
  ),

  // — M5 op-slice: bottomFromOpponentHand + the opponent-seat decision (Ortega /
  //   Greavard). All three rows verified verbatim against the local catalog
  //   2026-07-22 (Ortega's text identical on both prints). —
  /** Ortega (Supporter) — reveal the opponent's hand, bottom a chosen card,
      "in this way" → the OPPONENT may draw. */
  "sv03-190": trainerCard(
    "sv03-190",
    "Supporter",
    "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck. If you put a card on the bottom of your opponent's deck in this way, your opponent may draw a card.",
  ),
  /** Ortega (sv03-219) — the reprint, byte-identical in the catalog. */
  "sv03-219": trainerCard(
    "sv03-219",
    "Supporter",
    "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck. If you put a card on the bottom of your opponent's deck in this way, your opponent may draw a card.",
  ),
  /** Greavard (sv01-105) — "Underworld Stroll", the DERIVED attack twin of
      Ortega's first sentence (Supporter-filtered, no gate, no draw). Sharp
      Fang is the plain second attack the card-level registry `attack` field
      could not have coexisted with — the reason the twin derives from text. */
  "sv01-105": battler("sv01-105", {
    name: "Greavard",
    hp: 80,
    stage: "Basic",
    types: ["Psychic"],
    retreat: 3,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Underworld Stroll",
        effect:
          "Your opponent reveals their hand. Choose a Supporter card you find there and put it on the bottom of their deck.",
      },
      { cost: ["Psychic", "Colorless", "Colorless"], name: "Sharp Fang", damage: 30 },
    ],
  }),

  // — the CONDITIONAL flat attack-damage bonus (D115): "If <clause>, this attack
  //   does N more damage." One printed card per mapped clause, each transcribed
  //   VERBATIM off the local D1 this session and checked CHAR-FOR-CHAR. The
  //   printed sentence is LOAD-BEARING on every one of them: these cards DERIVE
  //   (not one carries a registry row), so a single drifted character — a U+2019
  //   apostrophe for an ASCII one, a lookalike for the é in "Pokémon", a lost
  //   trailing period — does not fail loudly, it silently UN-simulates the card
  //   and drops it back onto the ATTACK_EFFECT_SKIPPED path with its "+" intact.
  //   That is why conditionalDamage.test.ts pins each sentence against this pool
  //   rather than only against the deriver. —
  /** Palossand sv02-096 — "Earthen Power" (80+, +80 with YOUR Stadium out): the
      `yourStadiumInPlay` clause, and the fixture that proves the OWNERSHIP
      reading through a whole attack (the shared zone holding the OPPONENT's Beach
      Court leaves the printed 80 alone). A Psychic Stage 1 from Sandygast, so it
      is always surgeried in; it is also one of the pool's few rows carrying a
      NON-EMPTY resistance (Fighting −30, a real fold factor when it is the
      DEFENDER) and it mixes an int-damage attack with a string-damage one in the
      same array — both kept faithful. */
  "sv02-096": battler("sv02-096", {
    name: "Palossand",
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Sandygast",
    hp: 150,
    retreat: 4,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      { cost: ["Psychic", "Colorless"], name: "Spooky Shot", damage: 40 },
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Earthen Power",
        effect: "If you have a Stadium in play, this attack does 80 more damage.",
        damage: "80+",
      },
    ],
  }),
  /** Gyarados sv02-043 — "Revengeful Storm" (80+, +100 when you are BEHIND on
      Prizes taken): the `morePrizesThanOpponent` clause, the §14 comeback shape.
      A Water Stage 1 from Magikarp. Its second attack "Berserker Tackle" is a
      plain 200 carrying the ALREADY-DERIVED recoil sentence, which is why it is
      kept: it is the same card's control that this slice's deriver must NOT
      swallow (`deriveAttackEffect` owns that sentence, the bonus reader owns
      index 0), and the two must stay disjoint. */
  "sv02-043": battler("sv02-043", {
    name: "Gyarados",
    types: ["Water"],
    stage: "Stage1",
    evolveFrom: "Magikarp",
    hp: 180,
    retreat: 4,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Revengeful Storm",
        effect:
          "If you have more Prize cards remaining than your opponent, this attack does 100 more damage.",
        damage: "80+",
      },
      {
        cost: ["Water", "Water", "Colorless", "Colorless"],
        name: "Berserker Tackle",
        effect: "This Pokémon also does 50 damage to itself.",
        damage: 200,
      },
    ],
  }),
  /** Gyarados ex sv01-045 — "Tyrannical Tail" (180+, +180 against an ALREADY
      damaged Active): the `opponentActiveDamaged` clause, and the whole reason
      the indicator is read at DECLARATION. An undamaged defender takes 180, NOT
      360 — the attack's own hit cannot bootstrap the condition that scales it,
      which is exactly what the printed "already" says. A Water Stage 1 from
      Magikarp with NO abilities (verified — the ex carries none), 300 HP, and a
      five-symbol attack cost, the deepest in this cast. */
  "sv01-045": battler("sv01-045", {
    name: "Gyarados ex",
    types: ["Water"],
    stage: "Stage1",
    evolveFrom: "Magikarp",
    hp: 300,
    retreat: 4,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      { cost: ["Water", "Water", "Water"], name: "Waterfall", damage: 100 },
      {
        cost: ["Water", "Water", "Water", "Colorless", "Colorless"],
        name: "Tyrannical Tail",
        effect:
          "If your opponent's Active Pokémon already has any damage counters on it, this attack does 180 more damage.",
        damage: "180+",
      },
    ],
  }),
  /** Seviper sv02-137 — "Cross-Cut" (50+, +50 against an EVOLUTION Active): the
      `opponentActiveIsEvolution` clause, the pair that proves the D105
      `evolveFromOf` reading (a Basic Active is the negative, a fielded Palossand
      or Gyarados the positive). A Darkness BASIC, so it is the one card in this
      cast that could legally start a game — which is precisely why both Active
      spots are pinned to fix-bigbody before every surgery. */
  "sv02-137": battler("sv02-137", {
    name: "Seviper",
    types: ["Darkness"],
    stage: "Basic",
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Sharp Fang", damage: 20 },
      {
        cost: ["Darkness", "Colorless"],
        name: "Cross-Cut",
        effect:
          "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.",
        damage: "50+",
      },
    ],
  }),
  /** Talonflame sv02-030 — "Fiery Breeze" (70+, +90 while IT is damaged): the
      `yourActiveDamaged` clause (D116), i.e. the printed "this Pokémon" resolved
      to the attacker's own Active. A Fire Stage 2 from Fletchinder, so it is
      always force-placed. Its index-0 "Clutch" is kept faithful and is doing real
      work: that sentence is D112's retreat-LOCK rider, which `deriveAttackEffect`
      already owns — so one card carries a DERIVED PROGRAM at index 0 and a
      DERIVED SCALING CLAUSE at index 1, and the index-keyed disjointness of the
      two derivers is assertable without leaving the fixture. */
  "sv02-030": battler("sv02-030", {
    name: "Talonflame",
    types: ["Fire"],
    stage: "Stage2",
    evolveFrom: "Fletchinder",
    hp: 150,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Fire"],
        name: "Clutch",
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
        damage: 50,
      },
      {
        cost: ["Fire"],
        name: "Fiery Breeze",
        effect: "If this Pokémon has any damage counters on it, this attack does 90 more damage.",
        damage: "70+",
      },
    ],
  }),
  /** Darmanitan sv03-035 — "Damage Counterpunch" (60+, +60 while IT is damaged):
      the SECOND printing of the same `yourActiveDamaged` clause at a DIFFERENT N,
      which is what proves the table maps a clause rather than a card. A Fire
      Stage 1 from Darumaka. Its "Heat Blast" carries NO `effect` key at all (not
      an empty string — the row simply omits it), the plain-vanilla control that
      must stay silent on the skipped-effect path. */
  "sv03-035": battler("sv03-035", {
    name: "Darmanitan",
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Darumaka",
    hp: 140,
    retreat: 3,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire", "Colorless", "Colorless"],
        name: "Damage Counterpunch",
        effect: "If this Pokémon has any damage counters on it, this attack does 60 more damage.",
        damage: "60+",
      },
      { cost: ["Fire", "Colorless", "Colorless", "Colorless"], name: "Heat Blast", damage: 140 },
    ],
  }),
  /** Tyranitar ex sv03-066 — "Lightning Rampage" (150+, +100 while any of YOUR
      BENCHED Pokémon is damaged): the `yourBenchDamaged` clause, the only member
      of this family that reads the Bench at all. sv03-211 is a second printing
      whose rules text is BYTE-IDENTICAL (verified: one distinct `hex(attacks_json)`
      across both, `abilities_json` NULL on both — only id/local id/rarity differ),
      so ONE fixture serves the pair. A Stage 2 from Pupitar, force-placed.
      Faithfully odd: the card is typed {L} but both attacks cost {F} and it is
      weak to Fighting — that is what tcgdex ships, and it is kept, so the Energy
      the deck pays with is Fighting despite the Lightning body. */
  "sv03-066": battler("sv03-066", {
    name: "Tyranitar ex",
    types: ["Lightning"],
    stage: "Stage2",
    evolveFrom: "Pupitar",
    hp: 340,
    retreat: 4,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Mountain Hurl",
        effect: "Discard the top 2 cards of your deck.",
        damage: 120,
      },
      {
        cost: ["Fighting", "Fighting"],
        name: "Lightning Rampage",
        effect:
          "If your Benched Pokémon have any damage counters on them, this attack does 100 more damage.",
        damage: "150+",
      },
    ],
  }),
  /** Seviper sv01-128 — "Venoshock" (60+, +120 into a POISONED Active): the
      `opponentActivePoisoned` clause. A DIFFERENT Seviper from sv02-137 above
      (same name, different print, different clause), which is why every assertion
      about either goes by card ID. Self-contained: its index-0 "Spit Poison"
      Poisons the opponent's Active and deals no damage at all (no `damage` key),
      so the suite can arm the very condition index 1 reads without a surgery. */
  "sv01-128": battler("sv01-128", {
    name: "Seviper",
    types: ["Darkness"],
    stage: "Basic",
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness"],
        name: "Spit Poison",
        effect: "Your opponent's Active Pokémon is now Poisoned.",
      },
      {
        cost: ["Darkness", "Colorless", "Colorless"],
        name: "Venoshock",
        effect: "If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.",
        damage: "60+",
      },
    ],
  }),
  /** Sableye sv02-136 — "Unseen Claw" (20+, +70 into an Active affected by ANY
      Special Condition): the `opponentActiveHasSpecialCondition` clause, the
      pool's only printing of it. The perfect companion to Seviper because its own
      index-0 "Night Eyes" applies ASLEEP, not Poison — so one board proves the
      clause is "any condition" rather than a Poison alias, and proves Venoshock
      does NOT fire on the same board. A Darkness Basic, 70 HP. */
  "sv02-136": battler("sv02-136", {
    name: "Sableye",
    types: ["Darkness"],
    stage: "Basic",
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Night Eyes",
        effect: "Your opponent's Active Pokémon is now Asleep.",
      },
      {
        cost: ["Darkness"],
        name: "Unseen Claw",
        effect:
          "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 70 more damage.",
        damage: "20+",
      },
    ],
  }),
  /** Okidogi ex sv06.5-036 — "Chain-Crazed" (130+, +130 while IT is Poisoned):
      the `yourActivePoisoned` clause, the SELF twin of Venoshock's. sv06.5-082
      and sv06.5-090 are further printings whose rules text is BYTE-IDENTICAL
      (verified: one distinct `hex(attacks_json)` across all three, `abilities_json`
      NULL on all three — only id/local id/rarity/illustrator differ), so ONE
      fixture serves three ids. A Darkness Basic, 250 HP, and — being named
      "… ex" — itself an `isExOrV` body, which is why it doubles as the target
      Ceruledge's clause reads. Its index-0 "Poisonous Musculature" is kept
      faithful and is DELIBERATELY unbuilt: a deck search, an attach, a shuffle
      and a conditional self-Poison in one sentence pair, which neither deriver
      owns, so it stays on the loud ATTACK_EFFECT_SKIPPED path. The Poison this
      card's own clause reads therefore has to arrive the way the real game
      delivers it — from across the table. */
  "sv06.5-036": battler("sv06.5-036", {
    name: "Okidogi ex",
    types: ["Darkness"],
    stage: "Basic",
    hp: 250,
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Poisonous Musculature",
        effect:
          "Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.",
      },
      {
        cost: ["Darkness", "Darkness", "Colorless"],
        name: "Chain-Crazed",
        effect: "If this Pokémon is Poisoned, this attack does 130 more damage.",
        damage: "130+",
      },
    ],
  }),
  /** Ceruledge sv02-098 — "Fighting Sword" (100+, +100 into an ex or V Active):
      the `opponentActiveIsExOrV` clause, the pool's only printing of it. A
      Psychic Stage 1 from Charcadet, so it is always force-placed. Faithfully
      odd in two ways worth keeping: it carries a real RESISTANCE (-30 Fighting,
      rare in this pool), and its index-0 "Life Sucker" is a bare self-HEAL
      ("Heal 30 damage from this Pokémon.") that is UNBUILT — the op deriver owns
      only the compound `SELF_SLEEP_HEAL` form, so this sentence derives to null
      on every path and keeps its loud ATTACK_EFFECT_SKIPPED row. It is kept
      faithful anyway: it is the index-keyed control proving index 1's clause does
      not leak sideways, and a standing marker for the bare-heal sentence family. */
  "sv02-098": battler("sv02-098", {
    name: "Ceruledge",
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Charcadet",
    hp: 140,
    retreat: 2,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Life Sucker",
        effect: "Heal 30 damage from this Pokémon.",
        damage: 50,
      },
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Fighting Sword",
        effect:
          "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 100 more damage.",
        damage: "100+",
      },
    ],
  }),

  // — 0.68.0 → 0.69.0 (D118): the conditional-damage family's first
  //   PARAMETERISED clause, "If this Pokémon has any <energy> Energy attached,
  //   this attack does N more damage." Four printings on ONE shape, differing in
  //   exactly one token — two TYPES ({R}, {L}) and two of the CARD CLASS
  //   (Special). Tinkaton, the fourth, already lives in the payFromHand slice
  //   above and is annotated there rather than duplicated here. —
  /** Scovillain sv01-029 — "Super Spicy Breath" (90+, +90 while a {R} Energy is
      attached to IT): the parameterised clause's TYPE arm, and the family's
      biggest printed swing (90 → 180). sv01-202 is a second printing whose rules
      text is BYTE-IDENTICAL (verified: one distinct `hex(attacks_json)` across
      the pair, `abilities_json` NULL on both — only id/local id/rarity differ),
      so ONE fixture serves both ids, exactly as it does for Tyranitar ex and
      Okidogi ex above.

      Faithfully odd, and load-bearing for the suite: Scovillain is a GRASS
      Pokémon whose bonus reads FIRE Energy, so the Energy that arms the clause is
      never the Energy that pays the cost ({G}{C}{C}). That separation is what
      lets the provision case attach a wildcard Luminous Energy as the ONLY {R}
      on the board while the printed cost still resolves. Its index-0 "Hot Bite"
      is a built status setter (a plain Burn), which makes it this cast's only
      index-0 that is simulated for a reason OTHER than a scaling clause. A Stage
      1 from Capsakid, so surgery always force-places it. */
  "sv01-029": battler("sv01-029", {
    name: "Scovillain",
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Capsakid",
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Hot Bite",
        effect: "Your opponent's Active Pokémon is now Burned.",
        damage: 20,
      },
      {
        cost: ["Grass", "Colorless", "Colorless"],
        name: "Super Spicy Breath",
        effect: "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.",
        damage: "90+",
      },
    ],
  }),
  /** Galvantula sv06.5-002 — "Shocking Web" (50+, +80 while a {L} Energy is
      attached to IT): the SECOND printing of the type arm, at a different token
      AND a different N, which is what proves the pattern captures a token rather
      than mapping a card. Also a Grass Pokémon reading an off-type Energy (see
      Scovillain), and the cast's cheapest attack — {G}{C} — so the clause Energy
      is unambiguously a rider on the cost rather than part of it.

      Its Ability "Compound Eyes" is kept VERBATIM and is INERT: it carries no
      registry row, and no deriver reads ability text at all, so nothing in the
      engine sees it. It is here because the printed card has it and because a
      body with an Ability is worth having in a pool where several auras and
      clauses ask "does this Pokémon have an Ability" — but the +50 it promises
      is NOT simulated, and the ZERO-registry-rows case in energyClause.test.ts is
      what pins that. A Stage 1 from Joltik. */
  "sv06.5-002": battler("sv06.5-002", {
    name: "Galvantula",
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Joltik",
    hp: 100,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Compound Eyes",
        effect:
          "Attacks used by this Pokémon do 50 more damage to your opponent's Active Pokémon that has an Ability (before applying Weakness and Resistance).",
      },
    ],
    attacks: [
      {
        cost: ["Grass", "Colorless"],
        name: "Shocking Web",
        effect: "If this Pokémon has any {L} Energy attached, this attack does 80 more damage.",
        damage: "50+",
      },
    ],
  }),
  /** Cetitan sv02-055 — "Special Horn" (80+, +140 while ANY Special Energy is
      attached to IT): the CLASS arm of the same clause, and the family's largest
      printed bonus anywhere (80 → 220). "Special" is not a tenth energy type —
      it is the card class — which is exactly why the clause's parameter is
      `BasicEnergyType | "special"` and why this card and Scovillain, run over one
      identical board, answer OPPOSITE.

      Faithfully odd: its index-0 "Icicle Missile" carries NO `effect` key at all
      (not an empty string — the row simply omits it), the Darmanitan precedent
      above. That makes it the cast's plain-vanilla index-keyed negative: a real
      attack that derives to nothing on every path and must stay SILENT on the
      skipped-effect path. A Water Stage 1 from Cetoddle, 180 HP — the cast's only
      body that survives its own 220. */
  "sv02-055": battler("sv02-055", {
    name: "Cetitan",
    types: ["Water"],
    stage: "Stage1",
    evolveFrom: "Cetoddle",
    hp: 180,
    retreat: 3,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      { cost: ["Water", "Colorless"], name: "Icicle Missile", damage: 50 },
      {
        cost: ["Water", "Water", "Colorless"],
        name: "Special Horn",
        effect:
          "If this Pokémon has any Special Energy attached, this attack does 140 more damage.",
        damage: "80+",
      },
    ],
  }),
};

/** Expand `{ id: count }` into a flat deck list. */
export function deckOf(counts: Record<string, number>): string[] {
  const ids: string[] = [];
  for (const [id, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) ids.push(id);
  }
  return ids;
}

export const ALL_BASIC_DECK = deckOf({ "fix-basic-1": 60 });

/** One Basic in 60 — mulligans are near-certain, used with searched seeds. */
export const ONE_BASIC_DECK = deckOf({ "fix-basic-1": 1, "fix-energy": 59 });

export const MIXED_DECK = deckOf({
  "fix-basic-0": 8,
  "fix-basic-1": 20,
  "fix-basic-2": 8,
  "fix-stage1": 4,
  "fix-energy": 16,
  "fix-item": 4,
});

/** The full fix-basic-1 → fix-stage1 → fix-stage2 line for the M4 evolution
    suite: 24 fix-basic-1 make a fix-basic-1 opening hand near-certain (so a
    board can pin one as the Active), and the deck reliably still holds copies
    of each evolution card for handFromDeck to pull post-setup. */
export const EVOLVE_DECK = deckOf({
  "fix-basic-1": 24,
  "fix-stage1": 12,
  "fix-stage2": 8,
  "fix-energy": 16,
});

/** M4 slice 2 Trainer suite: reliable fix-basic-1 openings + Nest Ball search
    targets, every representative Trainer in multiples (handFromDeck pulls them
    post-setup), and Water/Colorless energy for the search filters. */
export const TRAINER_DECK = deckOf({
  "fix-basic-1": 20,
  "sv01-189": 2,
  "sv01-181": 2,
  "sv02-172": 2,
  "sv01-194": 2,
  "sv01-188": 2,
  "sv01-172": 2,
  "fix-water-energy": 20,
  "fix-energy": 8,
});

/** M4 slice 3 Stadium/Tool suite: fix-attacker Basics to fight with (Fire
    type, Bite [C] 30), the fix-basic-1 → fix-stage1 line for the Tool
    carry-over, every representative Stadium/Tool in multiples (handFromDeck
    pulls them post-setup), and the two unauthored rejects. */
export const STADIUM_TOOL_DECK = deckOf({
  "fix-attacker": 12,
  "fix-basic-1": 8,
  "fix-stage1": 4,
  "fix-victim": 2,
  "fix-weak": 2,
  "fix-wall": 2,
  "sv01-167": 3,
  "sv03-192": 3,
  "sv01-197": 3,
  "sv02-173": 3,
  "fix-stadium": 1,
  "fix-tool": 1,
  "fix-energy": 16,
});

/** 0.52.0 → 0.53.0: the "once during each player's turn" Stadium activated-ability
    row (D102 — Artazon / Mesagoza / Town Store). Carries all three Stadiums plus
    one search CANDIDATE per card AND the negative control Artazon must exclude:
      • fix-bigbody — the DOMINANT (mulligan-free) starter both seats open on.
      • fix-basic-0 — a plain no-Rule-Box Basic: Artazon's positive candidate.
      • sv02-061 (Chien-Pao ex) — a Basic WITH a Rule Box: Artazon's negative
        control (a Basic the `noRuleBox` filter must drop), also a Mesagoza
        `anyPokemon` candidate.
      • fix-tool — a Pokémon Tool: Town Store's candidate.
      • sv01-167 (Beach Court) — a CONTINUOUS-only Stadium (no activated ability),
        the STADIUM_ABILITY_UNAVAILABLE control.
    Both seats run the SAME deck so the "each player's turn" re-arm can be driven
    from either side. Mesagoza's coin is seed-driven (the Poké Ball pattern —
    loop seeds to see both faces). */
export const STADIUM_ABILITY_DECK = deckOf({
  "fix-bigbody": 30,
  "sv02-171": 3, // Artazon
  "sv01-178": 3, // Mesagoza
  "sv03-196": 3, // Town Store
  "sv01-167": 3, // Beach Court — a CONTINUOUS-only Stadium (no activated ability)
  "fix-basic-0": 3, // no-Rule-Box Basic — Artazon takes it
  "sv02-061": 3, // Chien-Pao ex — a Basic WITH a Rule Box — Artazon drops it
  "fix-tool": 6, // a Pokémon Tool — Town Store takes it
  "fix-energy": 6,
});

/** M5 (Defiance Band): a DEDICATED 60 so the conditional-bonus tests never
    perturb STADIUM_TOOL_DECK's fragile opening-hand seeds (shared by 5 suites).
    All-Basic bodies (fix-attacker) make setup mulligan-free; fix-wall / fix-weak
    are the two defenders the tests set as P2's Active; sv01-169 is the Tool and
    fix-energy pays the attack cost — both pulled post-setup by id, so seed does
    not matter. */
export const DEFIANCE_DECK = deckOf({
  "fix-attacker": 30,
  "fix-wall": 4,
  "fix-weak": 4,
  "sv01-169": 6,
  "fix-energy": 16,
});

/** M5 (Choice Belt): a DEDICATED 60, same reasoning as DEFIANCE_DECK. All-Basic
    bodies (fix-attacker) make setup mulligan-free; the defenders the tests set
    as P2's Active are fix-pokemon-v / fix-pokemon-v-weak (Pokémon V), a plain
    fix-wall (non-V) and fix-pokemon-vmax (a VMAX the "V" gate must skip); sv02-176
    is the Tool, fix-energy pays the cost — all pulled post-setup by id. */
export const CHOICE_DECK = deckOf({
  "fix-attacker": 28,
  "fix-pokemon-v": 4,
  "fix-pokemon-v-weak": 2,
  "fix-pokemon-vmax": 2,
  "fix-wall": 2,
  "sv02-176": 6,
  "fix-energy": 16,
});

/** M5 (prize value, §8.1): a DEDICATED 60, same reasoning as DEFIANCE_DECK /
    CHOICE_DECK. All-Basic bodies (fix-attacker, whose Bite [C] 30 is the
    single-target KO attack) make setup mulligan-free; the rule-box defenders the
    tests set as P2's Active — fix-pokemon-v (a V → 2 Prizes), fix-pokemon-vmax (a
    VMAX → 3) and plain fix-victim (→ 1, the contrast) — are pre-damaged to lethal
    with setDamage and pulled post-setup by id, so the shuffle seed doesn't
    matter; fix-energy pays the cost. */
export const PRIZE_DECK = deckOf({
  "fix-attacker": 32,
  "fix-pokemon-v": 4,
  "fix-pokemon-vmax": 4,
  "fix-victim": 4,
  "fix-energy": 16,
});

/** M4 slice 4 (KO generalized off the Active): the spread attacker (fix-sniper,
    Spread Shot [C] 30 + 20 to each opponent Benched), small-HP bodies the
    spread can finish (fix-victim 30 HP, fix-weak 60 HP), the fix-basic-1 →
    fix-stage1 line + Bravery Charm for the evolve-below-HP mid-turn KO, and
    energy. */
export const KNOCKOUT_DECK = deckOf({
  "fix-sniper": 10,
  "fix-victim": 8,
  "fix-weak": 4,
  "fix-wall": 2,
  "fix-basic-1": 8,
  "fix-stage1": 4,
  "sv02-173": 4,
  "sv03-174": 2, // Bouffalant — passive "Bouffer" reduces spread on the bench too
  "fix-energy": 18,
});

/** M4 slice 5 (Special Energy): the Fire attacker (Flame [Fire][Colorless] 60,
    a typed cost a Luminous wildcard can help pay), benchable bodies for the Jet
    switch, Jet + Luminous + an unauthored special (fallback), and basic Fire /
    Colorless energy. */
export const SPECIAL_ENERGY_DECK = deckOf({
  "fix-attacker": 8,
  "fix-basic-1": 12,
  "fix-victim": 4,
  "sv02-190": 6,
  "sv02-191": 6,
  "fix-special": 2,
  "fix-fire-energy": 6,
  "fix-energy": 16,
});

/** M4 slice 6 triggered-Ability suite: fix-basic-1 bodies (Active/bench + the
    Arboliva evolve target), Flamigo ×6 (Insta-Flock search targets — one
    benched leaves ≥3 in deck), Arboliva/Garganacl/Trevenant in multiples
    (surgery pulls them from the deck), low-HP fix-victim for Trevenant's KO,
    and energy. */
export const TRIGGER_DECK = deckOf({
  "fix-basic-1": 16,
  "sv02-170": 6,
  "sv01-023": 3,
  "sv02-123": 3,
  "sv03-012": 3,
  "fix-victim": 4,
  "sv03-174": 2, // Bouffalant — "Bouffer" reduces ATTACK damage only, NOT counters
  "fix-energy": 23,
});

/** M4 slice 7 Rare Candy suite: reliable fix-basic-1 openings (the evolve-skip
    target), fix-basic-2 as a Basic OUTSIDE the fix-stage2 line (the chain-
    mismatch reject), the fix-stage2 the skip places (+ fix-stage2-frail for the
    evolve-below-HP KO), Rare Candy + Bravery Charm in multiples (surgery pulls
    them), and energy. fix-stage1 is present but never needed in hand — the whole
    point is skipping it. */
export const RARE_CANDY_DECK = deckOf({
  "fix-basic-1": 16,
  "fix-basic-2": 2,
  "fix-stage1": 4,
  "fix-stage2": 6,
  "fix-stage2-frail": 2,
  "sv01-191": 4,
  "sv02-173": 2, // Bravery Charm — the evolve-below-HP mid-turn KO tool
  "fix-energy": 24,
});

/** M4 slice 8 (mid-turn-damage snipe): fix-basic-1 bodies for both boards (the
    opponent's Bench are the snipe targets — surgery places them), Hawlucha ×6
    (played from hand — the onPlayToBench snipe), Meowscarada ex ×4 (surgery-
    placed — the activated snipe) with Basic {G} Energy ×6 for its discard cost,
    low-HP fix-victim (30 HP) bench fodder for the mid-turn KO, and energy.
    Radiant Blastoise ×2 (+ Basic {W} ×4) joined for the exact-`count` floor: it
    is the second card printing "on 1 of your opponent's Benched Pokémon" behind a
    paid cost, so it is where "the floor is DATA, not Meowscarada's special case"
    is asserted. */
export const SNIPE_DECK = deckOf({
  "fix-basic-1": 14,
  "sv01-118": 6,
  "sv02-015": 4,
  "swsh10.5-018": 2,
  "fix-victim": 6,
  "fix-grass-energy": 6,
  "fix-water-energy": 4,
  "fix-energy": 18,
});

/** M4 slice 9 (on-KO triggered Abilities): a Fire attacker to KO with (Bite [C]
    30 one-shots the 30-HP on-KO bodies; Flame [Fire][C] 60 too), Glimmora ×4
    (Shattering Crystal — the coin-flip Prize guard) and fix-onko ×4 (the parking
    demonstrator), fix-basic-1 bodies (bench fodder / promote targets / the
    Basic the fix-onko search finds), fix-victim fodder, and energy. */
export const ONKO_DECK = deckOf({
  "fix-attacker": 8,
  "sv02-126": 4,
  "fix-onko": 4,
  "fix-basic-1": 12,
  "fix-victim": 4,
  "fix-energy": 28,
});

/** M5 op-slice attachEnergyFrom: Quaquaval (any Basic from hand) + Baxcalibur
    ({W} from hand, repeatable) + the fix-attacher discard demonstrator, fix-basic-1
    bench bodies (attach targets), and Basic energy of three types — {W} for
    Baxcalibur, Fire for fix-attacher's discard pull, Colorless as an any-Basic. */
export const ATTACH_DECK = deckOf({
  "sv01-054": 3,
  "sv02-060": 3,
  "fix-attacher": 3,
  "fix-basic-1": 12,
  "fix-water-energy": 20,
  "fix-fire-energy": 6,
  "fix-energy": 13,
});

/** M5 attachEnergyFrom RIDERS (Gardevoir ex "Psychic Embrace"): Gardevoir ex
    (Psychic, its own {P} target), fix-psychic-1 {P} bench targets, fix-basic-1
    NON-{P} bodies (excluded from the {P}-only targets), Basic Psychic Energy (the
    discard-attach source), and Colorless filler. */
export const GARDEVOIR_DECK = deckOf({
  "sv01-086": 3,
  "fix-psychic-1": 8,
  "fix-basic-1": 8,
  "fix-psychic-energy": 20,
  "fix-energy": 21,
});

/** M5 attachEnergyFrom multi + endsTurn (Koraidon ex "Dino Cry"): Koraidon ex
    (Basic {F}, its own target), fix-fighting-1 Basic {F} bench targets,
    fix-fighting-evo (Stage {F}, excluded by basicOnly), fix-basic-1 non-{F}
    (excluded by targetType), Basic Fighting Energy (the discard source), filler. */
export const KORAIDON_DECK = deckOf({
  "sv01-125": 3,
  "fix-fighting-1": 6,
  "fix-fighting-evo": 2,
  "fix-basic-1": 6,
  "fix-fighting-energy": 20,
  "fix-energy": 23,
});

/** M5 op-slice discardPileRetrieval (§7.1 recovery Items): the three Items in
    multiples (handFromDeck pulls them), Professor's Research ×4 (the Supporter
    Pal Pad retrieves) + fix-item (a non-Supporter Trainer the supporter filter
    excludes), basic Energy of two real types + Colorless (Energy Retrieval /
    Super Rod sources; discardFromDeck seeds them), and fix-basic-1 bodies (both
    the Active/bench and the Pokémon Super Rod retrieves). */
export const DISCARD_RETRIEVAL_DECK = deckOf({
  "fix-basic-1": 12,
  "sv01-171": 3,
  "sv01-182": 3,
  "sv02-188": 3,
  "sv01-189": 4,
  "fix-item": 2,
  "fix-fire-energy": 8,
  "fix-water-energy": 8,
  "fix-energy": 17,
});

/** M5 op-slice lookAtTopN (§15.E, Great Ball / Pokégear 3.0): reliable
    fix-basic-1 openings that double as the Great Ball Pokémon candidates,
    fix-basic-2 as a second Pokémon (a deep deck-top marker), the two Items in
    multiples (handFromDeck pulls them), Professor's Research ×4 (the Supporter
    Pokégear reveals) + fix-item (a non-Supporter Trainer the supporter filter
    excludes), and abundant fix-energy filler (non-Pokémon, non-Supporter — used
    with `toDeckTop` to fill the top N with non-candidates). */
export const LOOK_AT_TOP_DECK = deckOf({
  "fix-basic-1": 16,
  "fix-basic-2": 4,
  "sv02-183": 3,
  "sv01-186": 3,
  "sv01-189": 4,
  "fix-item": 2,
  "fix-energy": 28,
});

/** M5 op-slice moveEnergy (Energy Switch / Poppy): fix-basic-1 Actives + fix-basic-2
    bench bodies (distinct names for the source/destination refs), the two Trainers
    in multiples (handFromDeck pulls them), and a spread of energy — basic Colorless
    (fix-energy) / Fire / Water for the movable candidates, plus fix-special (a
    Special Energy) so Energy Switch's `basicEnergy` filter can EXCLUDE it while
    Poppy's `anyEnergy` includes it. */
export const MOVE_ENERGY_DECK = deckOf({
  "fix-basic-1": 12,
  "fix-basic-2": 4,
  "sv01-173": 3,
  "sv03-193": 3,
  "fix-energy": 20,
  "fix-fire-energy": 6,
  "fix-water-energy": 6,
  "fix-special": 6,
});

/** M5 op-slice: handRefresh — the hand-refresh Supporter family. A Basic body to
    lead (fix-basic-1) plus all five cards and enough bulk (energy) that the deck
    stays deep after the setup draws, so the refresh-and-draw counts are exact.
    Youngster / Judge / Brassius / Katy / Iono all read their program by id. */
export const HAND_REFRESH_DECK = deckOf({
  "fix-basic-1": 8,
  "sv01-198": 3, // Youngster
  "sv01-176": 3, // Judge
  "sv03-187": 3, // Brassius
  "sv01-177": 3, // Katy
  "sv02-185": 3, // Iono
  "fix-energy": 37,
});

/** M5 op-slice: board conditions. The three cards that read a BoardCondition,
    plus Beach Court (sv01-167) so a Stadium can actually be put in play to swing
    Falkner's gate — from EITHER seat, which is how the "the opponent's Stadium
    does not count" case is built. Basic bodies to lead and bulk energy so the
    deck stays deep enough for Grusha's draw-to-7 to be exact. */
export const BOARD_CONDITION_DECK = deckOf({
  "fix-basic-1": 8,
  "sv02-181": 3, // Fighting Au Lait
  "sv02-180": 3, // Falkner
  "sv02-184": 3, // Grusha
  "sv01-167": 3, // Beach Court (Stadium)
  "fix-condgate": 3, // FIXTURE — a parking op inside each gate arm
  "fix-gateorder": 3, // FIXTURE — gate timing, splice order, surviving tail
  "fix-gatedsup": 3, // FIXTURE — a gated Supporter (the §7.2 allowance ordering)
  "fix-energy": 31,
});

/** M5 op-slice: discardEnergy — the energy-removal family. Both seats run it, so
    the OPPONENT's board can be dressed with the Energy to strip: basic
    (fix-energy) for Crushing Hammer's `anyEnergy`, and two DISTINCT Special
    Energy prints (fix-special / fix-special-2) so a single Pokémon can hold two
    and make Giacomo's per-Pokémon pick a real choice. Mawile (sv03-143) is a Basic
    body, benched from hand to fire its trigger. */
export const DISCARD_ENERGY_DECK = deckOf({
  "fix-basic-1": 6,
  "fix-basic-2": 4, // distinct bench bodies, so the opponent's board can hold several
  "sv01-168": 3, // Crushing Hammer
  "sv02-182": 3, // Giacomo
  "sv03-143": 4, // Mawile — Special Eater
  "fix-hammer": 3, // FIXTURE — the opponentChosen arm, no coin gate
  "fix-special": 6,
  "fix-special-2": 6,
  "fix-energy": 25,
});

/** M5 op-slice: attack effect programs can PARK — the self-discard attack cost.
    Two real Basics whose printed sentence derives to `discardEnergy yourActive`
    (Paldean Tauros' Blaze Dash [R][R][C] 120, Charcadet's Ember [R] 30) plus the
    "all" fixture, and THREE distinct Energy prints so the attacker can hold a mix
    that is a genuine choice (two copies of one print collapse to a single
    candidate). fix-victim / fix-wall give the defender both a KO and a survival
    outcome, since the whole point is that the epilogue still runs after the park. */
export const ATTACK_PARK_DECK = deckOf({
  "sv02-028": 4, // Paldean Tauros — Blaze Dash
  "sv01-039": 4, // Charcadet — Ember
  "fix-alldiscard": 3,
  "fix-victim": 3, // 30 HP — OHKO'd, so the epilogue's KO sweep runs
  "fix-bigbody": 5, // 200 HP — survives, so the plain turn-end tail runs
  "fix-basic-1": 3,
  "fix-fire-energy": 14, // pays Blaze Dash's {R}{R} and Ember's {R}
  "fix-fire-energy-alt": 4, // a second Fire print — same type, different id
  "fix-special": 3, // a Special Energy, so the two identity spaces can be split
  "fix-energy": 17, // a DIFFERENT print, so a mixed attach is a real choice
});

/** M5: `damageSelf` + the two-seat attack epilogue. Skeledirge's "Blazing Shout"
    (190 + 30 recoil) drives every case: a defender KO the recoil survives, a
    self-KO the defender survives (prized to the defender), the both-boards double
    KO, and the §14 tie now reachable from the attack path. fix-victim (30 HP)
    dies to the 190, fix-bigbody (200 HP) survives it (so a self-KO stands alone),
    and fix-basic-1 seeds legal openings + the promotion bodies each seat needs.
    Skeledirge is a Stage 2 (fielded via setActiveFromDeck), so the Basics carry
    the setup. */
export const SELF_DAMAGE_DECK = deckOf({
  "sv01-038": 4, // Skeledirge — Blazing Shout (190 + 30 self)
  "fix-victim": 4, // 30 HP — OHKO'd by the 190
  "fix-bigbody": 4, // 200 HP — survives the 190, isolating a self-KO
  "fix-basic-1": 20, // Basics for setup + the bench bodies a KO promotes
  "fix-fire-energy": 20, // pays Blazing Shout's {R}{R}
  "fix-energy": 8, // Colorless for the {C}
});

/** 0.34.0 → 0.35.0: count-scaled attack damage (the additive "+" family), both
    count sources. fix-attacker's "Rage" (base 10) and Paldean Tauros's "Raging
    Horns" (base 20) scale 10 per damage counter on the attacker; Charizard ex
    "Burning Darkness" (base 180) scales 30 per Prize the OPPONENT has taken
    (0.35.0 — the union's second member). Entei's "Blaze Ball" (base 60) is the
    anchor-guard witness whose count source (attached Energy) no reader simulates,
    so its "+" STAYS skipped — replacing Charizard in that role. fix-wall (120 HP)
    survives the self-counter attackers and fix-bigbody (200 HP) survives Entei's
    base 60, so a scaling test is only ever about the damage math; the Charizard
    mirror (330 HP) survives its own Prize-scaled hit; fix-weak (60 HP, ×2 Fire) is
    the scaling-times-weakness defender. fix-basic-1 seeds the setup Actives (the
    scaling attackers are Basics fielded by surgery; Charizard is a Stage 2) and the
    promotion bodies, and fix-fire-energy pays every cost. */
export const SCALED_DAMAGE_DECK = deckOf({
  "fix-attacker": 4, // Rage (index 3, base 10) — the default scaling attacker
  "sv02-028": 4, // Paldean Tauros — Raging Horns (index 0, base 20)
  "sv03-125": 4, // Charizard ex — Burning Darkness (opponentPrizesTaken, base 180); 330 HP mirror wall
  "sv03-030": 4, // Entei — Blaze Ball (an unsimulated "+", the anchor-guard witness)
  "fix-wall": 4, // 120 HP — survives the self-counter attackers' hits here
  "fix-weak": 4, // 60 HP, ×2 Fire — the scaling × weakness defender
  "fix-bigbody": 4, // 200 HP — survives Entei's base 60
  "fix-basic-1": 16, // Basics for setup + the bench bodies a KO promotes
  "fix-fire-energy": 16, // pays every cost here ({C}/{R}/{F}); ≥3 for Entei's {C}{C}{C}
});

/** 0.35.0 → 0.36.0: the "×"/multiply Prize family — "This attack does N damage for
    each Prize card your opponent has taken." (NO "more"). Pecharunt ex sv06.5-039
    "Irritated Outburst" (60×) and Annihilape sv01-109 "Rage Fist" (70×) both do
    per × (the opponent's TAKEN Prizes) as the WHOLE damage, the printed "N×" base
    dropped. Two different pers (60, 70) on one count source pin the fold reads the
    CAPTURED per. fix-bigbody (200 HP) survives both at ≤2 Prizes taken (120 / 140),
    keeping the §8.1 KO tail out so the math stands alone; fix-basic-1 seeds the
    setup Actives (Pecharunt is a Basic, Annihilape a Stage 2 — both force-placed by
    surgery) and the promotion bodies. Pecharunt costs {D}{D} and Rage Fist {F}, so
    Darkness and Fighting Energy pay them (Fire cannot). */
export const MULTIPLY_DAMAGE_DECK = deckOf({
  "sv06.5-039": 4, // Pecharunt ex — Irritated Outburst (opponentPrizesTaken, per 60)
  "sv01-109": 4, // Annihilape — Rage Fist (opponentPrizesTaken, per 70)
  "fix-bigbody": 4, // 200 HP — survives 60×2 / 70×2, isolating the damage math
  "fix-basic-1": 16, // Basics for setup + the bench bodies a KO promotes
  "fix-dark-energy": 16, // pays Pecharunt's {D}{D}
  "fix-fighting-energy": 16, // pays Rage Fist's {F}
});

/** 0.36.0 → 0.37.0: the "×"/multiply family's benched-TARGET sibling — Wo-Chien ex
    sv02-027 "Covetous Ivy" does 60 × (the opponent's TAKEN Prizes) to 1 CHOSEN
    Benched Pokémon (a `damageChosen` op, `deals` + `perTakenPrize`). fix-grass-energy
    pays {G}{G}{C} (Grass covers the {C} too). The opponent's Bench holds the targets:
    fix-bigbody (200 HP) survives the scaled hit so the damage math stands alone,
    fix-victim (30 HP) is the body a scaled hit KOs through the attack epilogue, and
    fix-basic-1 fills the Bench so the count-1 pick is a real choice. fix-bramble is
    the per-40 probe (a body fielded as the ATTACKER) pinning the CAPTURED amount. */
export const COVETOUS_IVY_DECK = deckOf({
  "sv02-027": 4, // Wo-Chien ex — Covetous Ivy (opponentPrizesTaken, per 60, benched)
  "fix-bramble": 4, // the per-40 benched-snipe probe (attacker)
  "fix-bigbody": 6, // 200 HP — a benched target that survives the scaled hit
  "fix-victim": 4, // 30 HP — a benched target a scaled hit KOs
  "sv03-174": 2, // Bouffalant — "Bouffer" (−20 after W/R): the benched reduction target
  "fix-basic-1": 20, // setup Actives + Bench filler so the count-1 pick is real
  "fix-grass-energy": 20, // pays Covetous Ivy's {G}{G}{C} and Bramble's {C}
});

/** 0.37.0 → 0.38.0: the flat benched-snipe RIDER family — "This attack ALSO does N
    damage to 1 of your opponent's Benched Pokémon." after the main hit. Miraidon
    sv01-080 "Lightning Laser" (90 + 30 rider) and Tadbulb sv03-076 "Shake and
    Discharge" (20 + 10 rider) — two Ns pin the captured amount; both {L}-cost, so
    fix-lightning-energy pays. **fix-bigbody is abundant so BOTH setup Actives pin to
    it** (driveSetup `active`): the Defender is then a deterministic 200 HP body that
    survives the main hit, with an EMPTY Bench (no seed-dependent displaced body), so
    the benched targets are exactly what a test places. fix-victim (30 HP) is the body
    the rider KOs, fix-basic-1 fills the Bench so the count-1 pick is a real choice. */
export const ALSO_SNIPE_DECK = deckOf({
  "sv01-080": 4, // Miraidon — Lightning Laser (90 + a flat 30 benched rider)
  "sv03-076": 4, // Tadbulb — Shake and Discharge (20 + a flat 10 benched rider)
  "fix-bigbody": 32, // 200 HP — DOMINANT so BOTH setup Actives pin to it; also the survivor bench targets
  "fix-victim": 4, // 30 HP — the benched body the rider KOs
  "fix-lightning-energy": 16, // pays {L}{L}{C} / {L}{C}
});

/** 0.38.0 → 0.39.0: the ANY-target snipe family — "This attack does N damage to 1 of
    your opponent's Pokémon." (the Active OR a Bench). Rotom sv01-069 "Linear Attack"
    (Lightning, 20) is the W/R witness: against a {L}-weak body it lands 40 as the
    ACTIVE (W/R applies, §8.5) but 20 Benched, the discriminating pair. Fezandipiti ex
    sv06.5-038 "Cruel Arrow" (Darkness, 100) is the big flat twin. **fix-lightning-weak
    is DOMINANT so BOTH setup Actives pin to it** (a deterministic {L}-weak Defender,
    130 HP, empty Bench — no seed-dependent displaced body). fix-victim (30 HP) is the
    body a snipe KOs. {C}-only costs, so fix-lightning-energy pays. */
export const ANY_SNIPE_DECK = deckOf({
  "sv01-069": 4, // Rotom — Linear Attack (opponentAny, 20, Lightning)
  "sv06.5-038": 4, // Fezandipiti ex — Cruel Arrow (opponentAny, 100, Darkness)
  "fix-lightning-weak": 30, // ×2 Lightning, 130 HP — DOMINANT pinned Active (the W/R target) + bench targets
  "fix-victim": 4, // 30 HP — the body a snipe KOs
  "sv01-197": 2, // Vitality Band — the attacker's pre-W/R +10 (an Active-snipe bonus witness)
  "fix-lightning-energy": 16, // pays Cruel Arrow's {C}{C}{C} and Linear Attack's {C}
});

/** 0.46.0: Umbreon "Feint Attack"'s ignoreWR snipe. A SEPARATE deck from
    ANY_SNIPE_DECK so the (seed-sensitive) opening-hand pins of the existing snipe
    suite are left byte-identical. fix-feint (a synthetic {L} Feint Attack) is the
    ignoreWR witness; fix-lightning-weak is DOMINANT so BOTH setup Actives pin to it
    (the {L}-weak body whose Weakness ignoreWR nulls); sv03-174 (Bouffalant, "Bouffer"
    −20 after W/R) is the benched reduction the "any effects on that Pokémon" clause
    skips; sv01-197 (Vitality Band) proves the ATTACKER's own bonus still lands. */
export const FEINT_DECK = deckOf({
  "fix-feint": 4, // synthetic {L} Feint Attack — the ignoreWR witness (opponentAny, 50)
  "fix-lightning-weak": 34, // ×2 Lightning, 130 HP — DOMINANT pinned Active (the W/R target) + bench targets
  "sv03-174": 4, // Bouffalant — "Bouffer" (−20 after W/R): the reduction ignoreWR SKIPS
  "sv01-197": 2, // Vitality Band — the attacker's pre-W/R +10 (an Active-snipe bonus witness)
  "fix-lightning-energy": 16, // pays Feint Attack's {C}
});

/** 0.47.0: Chien-Pao ex "Hail Blade" — the variable-count discard whose damage
    scales off it. A DEDICATED 60 (the FEINT_DECK reasoning: ABILITY_DECK already
    holds sv02-061, but growing it would reshuffle the seed-pinned Ability suite).
    sv02-061 is BOTH ends of the slice — P1's attacker, and the ex the D93 Prize
    case Knocks Out. fix-bigbody is DOMINANT (a 200 HP neutral body: mulligan-free
    setup, and a defender the 60× math never accidentally KOs); fix-water-weak is
    the ×2 Water witness the §8.5 pipeline doubles into; fix-water-energy is both
    Hail Blade's {W}{W} cost AND its discard fuel (a cost is not spent, so every
    Energy paying it is discardable); fix-energy is the plain Colorless Basic the
    `providesEnergy` {W} filter must never offer. */
export const HAIL_BLADE_DECK = deckOf({
  "sv02-061": 4, // Chien-Pao ex — Hail Blade (the attacker, and the ex defender)
  "fix-water-weak": 4, // ×2 Water, 200 HP — the Weakness the damage doubles into
  "fix-bigbody": 28, // 200 HP neutral — DOMINANT (mulligan-free) + the plain defender
  "fix-water-energy": 16, // pays {W}{W} and IS the discardable {W}
  "fix-energy": 8, // plain Colorless Basic Energy — never offered by the {W} filter
});

/** 0.47.0 → 0.48.0: Mewtwo VSTAR "Psy Purge" — the CAPPED Hail Blade shape
    (discard up to 3 {P} → 90× the count). Mirrors HAIL_BLADE_DECK exactly, one
    element {P}-flavoured: swsh10.5-031 is BOTH the attacker AND (at 280 HP) the
    defender that survives the max 270; fix-psychic-weak is the ×2 Psychic witness;
    fix-bigbody is the DOMINANT Basic (mulligan-free setup + starting Active, since
    a VSTAR cannot start); fix-psychic-energy is Psy Purge's {P}{C} cost AND its
    discard fuel; fix-energy is the plain Colorless the `providesEnergy` {P} filter
    must never offer. */
export const PSY_PURGE_DECK = deckOf({
  "swsh10.5-031": 4, // Mewtwo VSTAR — Psy Purge (attacker AND the 280 HP defender)
  "fix-psychic-weak": 4, // ×2 Psychic, 200 HP — the Weakness the damage doubles into
  "fix-bigbody": 28, // 200 HP neutral Basic — DOMINANT (mulligan-free) starting Active
  "fix-psychic-energy": 16, // pays {P}{C} and IS the discardable {P}
  "fix-energy": 8, // plain Colorless Basic Energy — never offered by the {P} filter
});

/** 0.48.0 → 0.49.0: the `damageAttacker` reactive-recoil row. A plain-damage
    attacker (fix-attacker's Bite — Colorless {C}, 30, no effect) hits a P2 Active
    that carries the recoil passive: Cacnea/Cacturne "Counterattack Quills" (30)
    or Stunfisk "Custom Trap" (50, only while a Tool is attached — Vitality Band
    is the inert Tool, since a non-attacking Stunfisk never fires its +10).
    fix-bigbody is the DOMINANT (mulligan-free) Basic + the bench body BOTH sides
    promote into after a KO. fix-energy pays Bite's {C}. BOTH seats run it so the
    defender can be surgically fielded on P2. */
export const DAMAGE_ATTACKER_DECK = deckOf({
  "sv01-005": 4, // Cacnea — Counterattack Quills (30 recoil)
  "sv01-006": 4, // Cacturne — Counterattack Quills (same 30)
  "sv03-112": 4, // Stunfisk — Custom Trap (50 recoil, requires a Tool)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0)
  "sv01-197": 3, // Vitality Band — the inert Tool for the Custom Trap gate
  "fix-bigbody": 29, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

/** 0.56.0 → 0.57.0: the Rocky Helmet row — the D98 `damageAttacker` recoil on a
    TOOL rather than an Ability (D106). A DEDICATED deck (the DAMAGE_ATTACKER_DECK
    is seed-pinned): the plain-damage attacker (fix-attacker's Bite — {C} 30 at
    index 0, Yawn at index 2) hits a plain P2 Active (fix-bigbody, no passive of
    its own) that carries Rocky Helmet, so the ONLY source of recoil is the Tool.
    fix-bigbody is the DOMINANT (mulligan-free) Basic + the holder + the promote
    target both sides; fix-energy pays Bite's {C}. BOTH seats run it so the holder
    can be surgically fielded on P2. */
export const ROCKY_HELMET_DECK = deckOf({
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0)
  "sv01-193": 4, // Rocky Helmet — the recoil TOOL (2 counters = 20 HP)
  "fix-bigbody": 40, // 200 HP neutral Basic — DOMINANT setup + the holder + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

/** 0.57.0 → 0.58.0: the Mimikyu "Safeguard" row — a holder-side full-prevention
    passive gated on the ATTACKER's rule-box class (preventDamageFromExV, D107).
    A DEDICATED deck (the others are seed-pinned): P2 fields the Mimikyu defender
    (sv02-097) Active or benched; P1 attacks with one of the three named bodies so
    `pokemonSuffixOf` reads the class off the NAME. The ex/V Bites are prevented,
    the VMAX Bite and the plain fix-attacker Bite are NOT (the ex/V-only gate). The
    ex's Spread Shot + fix-sniper's Spread Shot drive the interpreter spread arm.
    fix-bigbody is the DOMINANT (mulligan-free) Basic + the P2 Active in front of a
    benched Mimikyu; fix-energy pays every {C}. BOTH seats run it so Mimikyu can be
    surgically fielded on P2. */
export const SAFEGUARD_DECK = deckOf({
  "sv02-097": 4, // Mimikyu — Safeguard (the preventDamageFromExV defender)
  "fix-attacker-ex": 4, // ex attacker — Bite ({C} 30, idx 0) + Spread Shot (idx 1)
  "fix-attacker-v": 4, // V attacker — Bite ({C} 30)
  "fix-attacker-vmax": 4, // VMAX attacker — Bite ({C} 30): the ex/V-only gate's negative
  "fix-attacker": 4, // plain attacker — Bite ({C} 30): the not-prevented control
  "fix-sniper": 4, // plain spread attacker — Spread Shot: the spread not-prevented control
  "fix-energy": 8, // Colorless Basic Energy — pays every Bite/Spread Shot {C}
  "fix-bigbody": 28, // 200 HP neutral Basic — DOMINANT starter + the P2 Active over a benched Mimikyu
});

/** 0.58.0 → 0.59.0: the `noRetreatCostAura` row (Clefable ex "Lunar Zone", D108).
    A DEDICATED deck — every other retreat-cost suite (turn.test.ts, stadiumTool)
    is seed-pinned, and this one needs a Stadium plus two Energy types in the same
    60. Clefable ex (sv03-082) is the aura source, surgeried in from the deck (a
    Stage 1 never starts); fix-retreat2 is the retreat-2 beneficiary and the
    aura-off control; fix-psychic-energy satisfies the {P} clause and fix-energy
    ({C}) is the WRONG-type negative; Beach Court (sv01-167) proves the
    set-to-zero is read before its ± Basic discount. fix-bigbody (retreat 1) is
    the DOMINANT mulligan-free starter and the bench body a retreat needs. */
export const LUNAR_ZONE_DECK = deckOf({
  "sv03-082": 4, // Clefable ex — Lunar Zone (the noRetreatCostAura source; retreat 2 itself)
  "fix-retreat2": 4, // retreat-2 neutral Basic — the beneficiary and the no-aura control
  "fix-psychic-energy": 8, // Basic {P} — satisfies the aura's requiresEnergyType clause
  "fix-energy": 8, // Basic {C} — the wrong-type negative (attached, still pays full cost)
  "sv02-191": 3, // Luminous Energy (ANY) — the wildcard-provision witness
  "sv01-167": 3, // Beach Court — the ± Basic discount the set-to-zero must beat
  "sv01-096": 3, // Klefki — Mischievous Lock: the §9 gate's (structurally negative) witness
  "fix-bigbody": 27, // 200 HP neutral Basic — DOMINANT mulligan-free starter + bench body
});

/** 0.59.0 → 0.60.0: the `basicRetreatSurcharge` row (Calamitous Wasteland,
    D109). A DEDICATED deck — STADIUM_TOOL_DECK and LUNAR_ZONE_DECK are both
    seed-pinned, and this one needs the Stadium plus one body per branch of the
    clause: fix-retreat2 (non-{F} Basic, retreat 2 → 3) is the surcharged
    beneficiary, fix-fighting-1 ({F} Basic) is the type EXEMPTION, fix-stage1
    (Colorless Stage 1, retreat 2) is the Basic-only gate's negative, and
    fix-basic-0 (retreat 0) proves a free retreater is pushed to 1. Beach Court
    (sv01-167) is the ± twin — only one Stadium is ever in play, so the two are
    tested by REPLACING each other, not stacking. Clefable ex (sv03-082) +
    fix-psychic-energy prove the set-to-zero still beats the surcharge.
    fix-bigbody is the DOMINANT mulligan-free starter and the bench body a
    retreat promotes. */
export const CALAMITOUS_WASTELAND_DECK = deckOf({
  "sv02-175": 3, // Calamitous Wasteland — the surcharge Stadium
  "sv01-167": 3, // Beach Court — the ± twin it replaces in the shared zone
  "fix-retreat2": 4, // non-{F} Basic, retreat 2 — the surcharged body
  "fix-fighting-1": 4, // {F} Basic, retreat 1 — the type exemption
  "fix-basic-0": 4, // retreat-0 Basic — a free retreater pushed to 1
  "fix-stage1": 4, // Colorless Stage 1, retreat 2 — the Basic-only negative
  "sv03-082": 2, // Clefable ex — the set-to-zero that still wins
  "fix-psychic-energy": 4, // Basic {P} — satisfies Lunar Zone's clause
  "fix-energy": 8, // Basic {C} — pays the surcharged retreat
  "fix-bigbody": 24, // 200 HP neutral Basic — DOMINANT starter + bench body
});

/** 0.60.0 → 0.61.0: the retreat-cost READERS (D110) — the `opponentActiveRetreatCost`
    count source. A DEDICATED deck: SCALED_DAMAGE_DECK and MULTIPLY_DAMAGE_DECK are
    seed-pinned, and CALAMITOUS_WASTELAND_DECK carries no attackers. Both arms of the
    shape are here — Heracross sv01-002 (10+, ADDITIVE) and Stoutland sv03-172 (50×,
    MULTIPLY) — plus the defender ladder they read: fix-retreat2 (2), fix-fighting-1
    (1, and Calamitous Wasteland's {F} exemption), fix-basic-0 (0 — the multiply arm's
    zero-damage case). BOTH retreat-cost Stadiums are in the 60 because the whole
    point of one derivation point is that the readers see the MODIFIED cost: Beach
    Court (sv01-167) drops it, Calamitous Wasteland (sv02-175) raises it. Grass Energy
    pays Superpowered Throw's {G}{C}, fix-energy pays Chomp Chomp Panic's {C}, and
    fix-bigbody is the DOMINANT mulligan-free starter both Actives displace. */
export const RETREAT_SCALING_DECK = deckOf({
  "sv01-002": 4, // Heracross — "Superpowered Throw" 10+, the additive arm
  "sv03-172": 4, // Stoutland — "Chomp Chomp Panic" 50×, the multiply arm
  "fix-retreat2": 4, // retreat-2 Basic — the main defender
  "fix-fighting-1": 4, // retreat-1 {F} Basic — the Calamitous exemption, read through
  "fix-basic-0": 4, // retreat-0 Basic — the multiply arm's 0-damage case
  "sv01-167": 3, // Beach Court — the discount the readers must see
  "sv02-175": 3, // Calamitous Wasteland — the surcharge the readers must see
  "fix-grass-energy": 6, // Basic {G} — pays Superpowered Throw
  "fix-energy": 8, // Basic {C} — pays Chomp Chomp Panic
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT starter + bench body
});

/** 0.61.0 → 0.62.0: the LAST retreat-cost modifier (Spidops ex "Trap Territory",
    D111) — the cross-board `opponentActiveRetreatSurcharge` aura. A DEDICATED deck:
    LUNAR_ZONE_DECK and RETREAT_SCALING_DECK are both seed-pinned, and this suite
    needs Spidops ex on BOTH boards plus the whole composition ladder in one 60.
    Spidops ex (sv01-019) is the aura source AND — via its own "Wire Hang" — the
    reader that sees the cost it raises; it is a Stage 1, so it is always surgeried
    in. The targets: fix-retreat2 (2, the main body), fix-basic-0 (printed 0 — the
    surcharge lifts it to 1, so a "free" retreater stops being free) and Clefable ex
    (sv03-082, a Stage 1) — the NON-BASIC target that the old Basic-only early-out
    would have let escape, and the set-to-zero that beats the surcharge once it holds
    {P}. Beach Court (sv01-167) is here because a Stadium and an aura CAN coexist:
    it is the ± composition D109 found unreachable between the two Stadiums. Klefki
    (sv01-096) is the §9 gate's (structurally negative) witness. Grass + fix-energy
    pay Wire Hang's {G}{C}. fix-bigbody is the DOMINANT mulligan-free starter. */
export const TRAP_TERRITORY_DECK = deckOf({
  "sv01-019": 4, // Spidops ex — Trap Territory (the aura) + Wire Hang (the reader)
  "fix-retreat2": 4, // retreat-2 Basic — the surcharged body
  "fix-basic-0": 4, // retreat-0 Basic — a free retreater the surcharge lifts to 1
  "sv03-082": 3, // Clefable ex — the NON-Basic target + Lunar Zone's set-to-zero
  "fix-psychic-energy": 4, // Basic {P} — arms Lunar Zone's clause
  "sv01-167": 3, // Beach Court — the −1 the +1 aura composes with (both reachable)
  "sv01-096": 3, // Klefki — Mischievous Lock: the §9 gate's negative witness
  "fix-grass-energy": 6, // Basic {G} — pays Wire Hang's {G}
  "fix-energy": 8, // Basic {C} — pays Wire Hang's {C} and the surcharged retreat
  "fix-bigbody": 21, // 200 HP neutral Basic — DOMINANT starter + bench body
});

/** 0.62.0 → 0.63.0: the retreat-LOCK seam (D112) — "During your opponent's next
    turn, the Defending Pokémon can't retreat." A DEDICATED deck (every retreat-COST
    deck above is seed-pinned, and this suite needs BOTH lockers plus a defender
    that could otherwise retreat). Tarountula (sv02-016) is the bare rider and a
    Basic, so it fields with one surgery; Paldean Clodsire (sv03-128) is the
    two-clause "Poison Ring" printing and a Stage 1, always surgeried in.
    fix-retreat2 is the LOCKED body — 120 HP so it survives both attacks and the
    Poison ticks, retreat 2 so a paid retreat is a real, otherwise-legal action the
    block is the only thing refusing. The two EARLY-clear paths (an effect of an
    attack ends when the Pokémon leaves the Active Spot or evolves) need their own
    bodies: fix-basic-1 → fix-stage1 is the evolution pair, and Switch (sv01-194)
    moves a locked Active to the Bench — which the rules allow, since the block
    refuses RETREATING, not being switched. Grass pays Bind Down's {G}, Darkness
    pays Poison Ring's {D}, and plain {C} pays the locked body's retreat.
    fix-bigbody is the DOMINANT mulligan-free starter. BOTH seats run it so a
    locker can be fielded on either board. */
export const RETREAT_LOCK_DECK = deckOf({
  "sv02-016": 4, // Tarountula — "Bind Down": the bare 15-printing rider
  "sv03-128": 3, // Paldean Clodsire — "Poison Ring": the two-clause printing
  "fix-retreat2": 4, // retreat-2 Basic — the locked body (a retreat it could pay)
  "fix-basic-1": 4, // retreat-1 Basic — the locked body on the EVOLVE clear path
  "fix-stage1": 3, // evolves from fix-basic-1 — §10 sheds the block
  "sv01-194": 3, // Switch — the leaving-the-Active-Spot clear
  "fix-grass-energy": 6, // Basic {G} — pays Bind Down
  "fix-dark-energy": 6, // Basic {D} — pays Poison Ring
  "fix-energy": 10, // Basic {C} — pays the locked body's retreat cost
  "fix-bigbody": 17, // 200 HP neutral Basic — DOMINANT starter + bench body
});

/** 0.63.0 → 0.64.0: Snorlax swsh10.5-055 "Block" (D113) — the L3, continuous
    shape of the retreat-lock seam. A DEDICATED deck: LUNAR_ZONE_DECK,
    TRAP_TERRITORY_DECK and RETREAT_LOCK_DECK are all seed-pinned, and this suite
    needs a cast none of them holds. Snorlax is a Basic, so it fields with one
    surgery onto either Active spot; fix-retreat2 (120 HP, retreat 2) is the
    BLOCKED body, chosen because its retreat is one a real board can actually pay —
    so the CONTROL (the same board with no Snorlax across from it) retreats for
    real and the block is the only thing that ever refuses. fix-energy pays that
    2, and Klefki (sv01-096) is the §9 witness — the FIRST assertable POSITIVE in
    the aura family, since its Basic-only "Mischievous Lock" reaches a Basic
    Snorlax where it could never reach Stage 1 Clefable ex or Spidops ex.
    fix-attacker is the blocked body for the one case fix-retreat2 cannot carry —
    a blocked Pokémon still ATTACKS — since its Bite ({C}, 30) leaves Snorlax's
    150 HP standing. fix-bigbody is the DOMINANT mulligan-free starter, and it is
    also what BOTH Active spots are pinned to before each test's surgery, so no
    assertion depends on which Basic the seed happened to start. BOTH seats run
    the whole cast so either board can host the aura. */
export const BLOCK_DECK = deckOf({
  "swsh10.5-055": 4, // Snorlax — "Block": the continuous retreat lock
  "fix-retreat2": 4, // retreat-2 Basic — the blocked body (a retreat it could pay)
  "sv01-096": 4, // Klefki — "Mischievous Lock": the §9 gate's POSITIVE witness
  "fix-attacker": 4, // Bite ({C}, 30) — the blocked body that still attacks
  "fix-energy": 12, // Basic {C} — pays the blocked body's retreat cost and Bite
  "fix-bigbody": 32, // 200 HP neutral Basic — DOMINANT starter + both pinned Actives
});

/** 0.64.0 → 0.65.0: Wimpod swsh10.5-025 "Punk Out" (D114) — the SELF-only
    set-to-zero with a cross-board predicate, and the last print on the retreat-COST
    seam. A DEDICATED deck: LUNAR_ZONE_DECK, TRAP_TERRITORY_DECK, RETREAT_LOCK_DECK
    and BLOCK_DECK are all seed-pinned, and none of them holds the rule-box ladder
    this predicate has to be separated against. Wimpod (retreat 3) is the holder and
    a Basic, so one surgery fields it on either board. The trigger is Guardmon V
    (fix-attacker-v) — fielded Active or BENCHED, since "in play" carries no Active
    clause — and the two NEGATIVES that prove "Pokémon V" is literal are Bigmon VMAX
    (fix-attacker-vmax) and Fixmon ex (fix-attacker-ex), neither of which
    `pokemonSuffixOf` calls a "V". fix-retreat2 is the SELF-only control: on the very
    board where Wimpod reads 0 it must still read 2, which is the assertion that
    would catch modelling this as an aura. Klefki (sv01-096) is the §9 POSITIVE —
    Wimpod is a Basic, so "Mischievous Lock" really silences Punk Out. Beach Court
    (sv01-167) is the ± delta the set-to-zero has to beat (3 → 2 bare, 0 with a V
    out). fix-energy pays the retreat the control still owes, and fix-bigbody is the
    DOMINANT mulligan-free starter both Active spots pin to before each surgery.
    BOTH seats run the whole cast so either board can host the holder or the V. */
export const PUNK_OUT_DECK = deckOf({
  "swsh10.5-025": 4, // Wimpod — "Punk Out": the holder (retreat 3)
  "fix-attacker-v": 2, // Guardmon V — the cross-board trigger (Active or Bench)
  "fix-attacker-vmax": 2, // Bigmon VMAX — the V-only negative
  "fix-attacker-ex": 2, // Fixmon ex — the other rule-box negative
  "sv01-096": 2, // Klefki — "Mischievous Lock": the §9 gate's POSITIVE witness
  "sv01-167": 2, // Beach Court — the ± Stadium the set-to-zero must beat
  "fix-retreat2": 2, // retreat-2 Basic — the SELF-only control (it still pays)
  "fix-energy": 12, // Basic {C} — pays the control's retreat
  "fix-bigbody": 32, // 200 HP neutral Basic — DOMINANT starter + both pinned Actives
});

/** 0.65.0 → 0.66.0: the CONDITIONAL flat attack-damage bonus (D115) — "If
    <clause>, this attack does N more damage.", the `boardCondition` 0-or-1
    indicator count. A DEDICATED deck: SCALED_DAMAGE_DECK, MULTIPLY_DAMAGE_DECK,
    RETREAT_SCALING_DECK, BOARD_CONDITION_DECK, PUNK_OUT_DECK and every other
    neighbour is seed-pinned, and none of them holds even one of these four
    printings — so growing one to reach this cast would reshuffle a suite that has
    nothing to do with it. BOTH seats run the WHOLE cast, because every clause has
    to be assertable from either board (the ownership case literally needs the same
    Beach Court played by the opponent) and the Evolution clause needs an Evolution
    fielded on the DEFENDING side.

    One printing per mapped clause: Palossand (sv02-096, `yourStadiumInPlay`),
    Gyarados (sv02-043, `morePrizesThanOpponent`), Gyarados ex (sv01-045,
    `opponentActiveDamaged`) and Seviper (sv02-137, `opponentActiveIsEvolution`).
    Palossand and Gyarados double as the EVOLUTION Active that satisfies Cross-Cut
    — the deck's only non-Basic bodies, which is what makes fix-bigbody the
    clause's negative rather than an accident of the seed.

    Beach Court (sv01-167) is the Stadium the first clause reads, and the Stadium
    ZONE is SHARED — so the same card played by the OPPONENT sits in the very same
    zone and must NOT satisfy "you have a Stadium in play". fix-bigbody is doing
    three jobs at once: the DOMINANT mulligan-free starter, the body BOTH Active
    spots are pinned to before each surgery (so no assertion depends on which Basic
    the seed dealt), and — being a neutral 200 HP Colorless BASIC with no Weakness
    and no Resistance — both the Evolution clause's NEGATIVE and the arithmetically
    clean defender every damage assertion is measured against.

    The Energy pays the printed costs symbol-for-symbol rather than leaning on
    typed Energy to cover the Colorless halves: {W} for Revengeful Storm and
    Tyrannical Tail (which needs THREE, on top of two {C} — the deepest cost in the
    cast), {P} for Earthen Power, {D} for Cross-Cut, and plain {C} (fix-energy) for
    every Colorless symbol. */
export const CONDITIONAL_DAMAGE_DECK = deckOf({
  "sv02-096": 3, // Palossand — "Earthen Power" (80+): the Stadium clause + an Evolution body
  "sv02-043": 3, // Gyarados — "Revengeful Storm" (80+): the Prize clause + an Evolution body
  "sv01-045": 3, // Gyarados ex — "Tyrannical Tail" (180+): the "already damaged" clause
  "sv02-137": 3, // Seviper — "Cross-Cut" (50+): the Evolution clause
  "sv01-167": 3, // Beach Court — the Stadium the ownership case needs on EITHER side
  "fix-water-energy": 8, // Basic {W} — Tyrannical Tail alone wants three
  "fix-psychic-energy": 4, // Basic {P} — pays Earthen Power
  "fix-dark-energy": 4, // Basic {D} — pays Cross-Cut
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 21, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the Basic defender
});

/** 0.66.0 → 0.67.0: the SECOND wave of conditional-damage clauses (D116) — the
    two damage-counter clauses that read YOUR OWN board (`yourActiveDamaged`,
    `yourBenchDamaged`) and the two §12 clauses that read the opponent's Active
    (`opponentActivePoisoned`, `opponentActiveHasSpecialCondition`). A DEDICATED
    deck rather than a grown CONDITIONAL_DAMAGE_DECK: that one is seed-pinned by
    conditionalDamage.test.ts, and this cast shares none of its printings anyway.

    One printing per clause, and the cast is chosen so that every condition can be
    armed BY THE GAME rather than only by surgery: Seviper's index-0 "Spit Poison"
    Poisons, Sableye's index-0 "Night Eyes" puts the same spot ASLEEP, and damage
    counters land through any ordinary attack. Darmanitan is in as the SECOND
    printing of Talonflame's clause at a different N — the pair that proves the
    table maps a printed CLAUSE, not a card.

    Both seats run the WHOLE cast: `yourActiveDamaged`/`yourBenchDamaged` are
    seat-relative, so the asymmetry ("damage on the DEFENDER's bench scores
    nothing") is only assertable if the same body can be fielded on either side.

    Energy pays the printed symbols: {R} for Talonflame and Darmanitan, {F} for
    Tyranitar ex (typed {L}, costed {F} — faithful to the row), {D} for both
    Venoshock and Unseen Claw, plain {C} for the Colorless slots. fix-bigbody is
    the DOMINANT mulligan-free starter, the body both Actives pin to, the damaged
    BENCH body Lightning Rampage reads, and — 200 HP, no Weakness, no Resistance —
    the arithmetically clean defender every damage assertion is measured against.
    Seviper and Sableye are the only Basics in the cast besides it, which is
    exactly why the pinning matters. */
export const CONDITION_CLAUSE_DECK = deckOf({
  "sv02-030": 3, // Talonflame — "Fiery Breeze" (70+): yourActiveDamaged, +90
  "sv03-035": 3, // Darmanitan — "Damage Counterpunch" (60+): the same clause, +60
  "sv03-066": 3, // Tyranitar ex — "Lightning Rampage" (150+): yourBenchDamaged
  "sv01-128": 3, // Seviper — "Venoshock" (60+): opponentActivePoisoned, and its own Poison setter
  "sv02-136": 3, // Sableye — "Unseen Claw" (20+): the ANY-condition clause, and its Asleep setter
  "fix-fire-energy": 6, // Basic {R} — pays Fiery Breeze and Damage Counterpunch
  "fix-fighting-energy": 6, // Basic {F} — pays Lightning Rampage's {F}{F}
  "fix-dark-energy": 6, // Basic {D} — pays Venoshock and Unseen Claw
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 19, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the bench body
});

/** 0.67.0 → 0.68.0: the THIRD wave of conditional-damage clauses (D117) — the
    SELF-scoped Poison clause (Okidogi ex sv06.5-036/-082/-090 "Chain-Crazed",
    +130) and the rule-box clause (Ceruledge sv02-098 "Fighting Sword", +100). A
    DEDICATED deck: CONDITION_CLAUSE_DECK is seed-pinned, and this cast needs two
    bodies (`fix-pokemon-v`, `fix-pokemon-vmax`) that no clause suite before it
    wanted anywhere near a board.

    The cast exists so BOTH clauses can be armed BY THE GAME rather than only by
    surgery, and for the Poison one that is the whole point: Okidogi's own index-0
    "Poisonous Musculature" is unbuilt (a search + attach + conditional
    self-Poison), so the only honest way to Poison your OWN Active is the way the
    real game does it — the opponent Poisons you. Seviper sv01-128's index-0
    "Spit Poison" is that source, fielded on the other seat, with §13.1's Checkup
    then ticking the Poison it applied. Okidogi ex doubles as Ceruledge's target
    (it is an "ex"), so one board can carry both clauses at once; `fix-pokemon-v`
    and `fix-pokemon-vmax` are the pair that pins the printed reading — V counts,
    VMAX does NOT (`isExOrV`, not `hasRuleBox`).

    Energy pays the printed symbols: {D} for Chain-Crazed's {D}{D} and Spit
    Poison's {D}, {P} for Fighting Sword's {P}, plain {C} for every Colorless
    slot. fix-bigbody is the DOMINANT mulligan-free starter, the body both Actives
    pin to, and — 200 HP, no Weakness, no Resistance — the arithmetically clean
    NON-ex defender every control is measured against. Ceruledge is a Stage 1 and
    is always force-placed. */
export const CLAUSE_TABLE_DECK = deckOf({
  "sv06.5-036": 3, // Okidogi ex — "Chain-Crazed" (130+): yourActivePoisoned, and an ex target
  "sv02-098": 3, // Ceruledge — "Fighting Sword" (100+): opponentActiveIsExOrV
  "sv01-128": 3, // Seviper — "Spit Poison": the only in-game route to a Poisoned OWN Active
  "fix-pokemon-v": 2, // 210 HP Fixmon V — the other half of the printed "ex or V"
  "fix-pokemon-vmax": 2, // 330 HP Fixmon VMAX — the body the clause does NOT name
  "fix-dark-energy": 6, // Basic {D} — pays Chain-Crazed and Spit Poison
  "fix-psychic-energy": 6, // Basic {P} — pays Fighting Sword's {P}
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 27, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the clean control
});

/** 0.68.0 → 0.69.0: the conditional-damage family's first PARAMETERISED clause
    (D118) — "If this Pokémon has any <energy> Energy attached, this attack does N
    more damage." on all four of the pool's printings: Scovillain sv01-029/-202
    ({R}, +90), Galvantula sv06.5-002 ({L}, +80), Cetitan sv02-055 (Special, +140)
    and Tinkaton sv02-105 (Special, +90). A DEDICATED deck for the usual reason —
    every existing deck is seed-pinned by its own suite — and for one specific to
    this slice: no clause deck before it needed SPECIAL Energy on the board at all,
    and adding it to CLAUSE_TABLE_DECK would change what every one of its seeds
    deals.

    THE ENERGY LIST IS THE CAST. Two axes meet here and the deck has to separate
    them, so it carries three kinds of Energy at once:

      • the Energy that PAYS — {G} for Scovillain's {G}{C}{C} and Galvantula's
        {G}{C}, {W} for Cetitan's {W}{W}{C}, {P} for Tinkaton's {P}{C}, and plain
        {C} (fix-energy) for every Colorless symbol;
      • the Energy that ARMS the TYPE clauses — {R} for Scovillain, {L} for
        Galvantula. Both attackers are GRASS Pokémon reading an OFF-TYPE Energy,
        so an arming Energy is never mistakable for a cost one;
      • the two SPECIALS. **Luminous** (sv02-191) is the wildcard: alone on a
        Pokémon it PROVIDES every type, so it satisfies the {R} clause without
        being a Fire card at all — the reading is provision, not the printed name,
        the same answer §8.2's cost check gives. **Jet** (sv02-190) is the second
        Special whose mere presence DEMOTES Luminous to {C}, which turns the {R}
        clause back off on a board where nothing moved. That one pair of cards is
        the slice's sharpest case, and on that very board the CLASS clause is TRUE
        while the TYPE clause is FALSE — the two axes, pinned against each other.

    fix-psychic-weak (200 HP, ×2 Psychic, no attacks) is the §8.5 fold-order
    defender: Tinkaton is Psychic, so (90 + 90) × 2 = 360 there and the un-armed
    control is 90 × 2 = 180. fix-bigbody is the DOMINANT mulligan-free starter, the
    body both Active spots pin to before each surgery, the BENCHED body the
    "Energy on the Bench does not count" case attaches to, and — 200 HP, Colorless,
    no Weakness, no Resistance — the arithmetically clean defender every other
    damage number is measured against. All four attackers are Stage 1 or Stage 2
    and are always force-placed, so no evolution bases are needed; both seats run
    the whole cast, since the clause is seat-relative and the asymmetry is only
    assertable if the same body can be fielded on either side. */
export const ENERGY_CLAUSE_DECK = deckOf({
  "sv01-029": 3, // Scovillain — "Super Spicy Breath" (90+): the {R} clause, +90
  "sv06.5-002": 3, // Galvantula — "Shocking Web" (50+): the {L} clause, +80
  "sv02-055": 3, // Cetitan — "Special Horn" (80+): the Special CLASS clause, +140
  "sv02-105": 3, // Tinkaton — "Special Hammer" (90+): the same clause, +90, on a Stage 2
  "fix-psychic-weak": 2, // 200 HP, ×2 Psychic — the Weakness defender for the fold-order pair
  "fix-grass-energy": 3, // Basic {G} — pays Super Spicy Breath and Shocking Web
  "fix-fire-energy": 3, // Basic {R} — ARMS Scovillain's clause; never pays its cost
  "fix-lightning-energy": 3, // Basic {L} — ARMS Galvantula's clause; never pays its cost
  "fix-water-energy": 4, // Basic {W} — Special Horn alone wants two
  "fix-psychic-energy": 3, // Basic {P} — pays Special Hammer
  "fix-energy": 5, // Basic {C} — pays every Colorless symbol in the cast
  "sv02-191": 4, // Luminous Energy — the WILDCARD Special: provides every type, alone
  "sv02-190": 4, // Jet Energy — the second Special that DEMOTES Luminous to {C}
  "fix-bigbody": 17, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the bench body
});

/** 0.49.0 → 0.50.0: the `onDamagedByAttack` reactive-TRIGGER row (Armarouge
    "Scorching Armor", D99). A DEDICATED deck (the DAMAGE_ATTACKER_DECK is
    seed-pinned; growing it to hold Armarouge would reshuffle that suite): the
    plain-damage attacker (fix-attacker's Bite — Colorless {C}, 30, no effect;
    Yawn at index 2 is the 0-damage status) hits a P2 Active carrying the
    Scorching Armor trigger, which Burns the ATTACKER. fix-bigbody is the
    DOMINANT (mulligan-free) Basic + the bench body BOTH sides promote into after
    a KO. fix-energy pays Bite's {C}. BOTH seats run it so Armarouge can be
    surgically fielded on P2. */
export const SCORCHING_ARMOR_DECK = deckOf({
  "sv03-044": 4, // Armarouge — Scorching Armor (onDamagedByAttack → Burn the attacker)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "fix-bigbody": 40, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

/** 0.51.0 → 0.52.0: the `onDamagedByAttack` PARKING reactive-trigger row (Klawf ex
    "Counterattacking Pincer", D101). A DEDICATED deck (SCORCHING_ARMOR_DECK is
    tuned for the non-parking Burn): the plain-damage attacker (fix-attacker's Bite
    — Colorless {C}, 30, no effect; Yawn at index 2 is the 0-damage status) hits a
    P2 Active carrying Counterattacking Pincer, which makes the DEFENDER discard an
    Energy from the ATTACKER. The attacker is fielded with TWO DIFFERENT Energy —
    fix-energy (Colorless, pays Bite) + fix-fire-energy (Fire) — so the discard is a
    real CHOICE and PARKS (two identical Energy would collapse to a forced pick and
    auto-resolve). fix-bigbody is the DOMINANT (mulligan-free) Basic + the bench body
    BOTH sides promote into after a KO. BOTH seats run it so Klawf ex can be
    surgically fielded on P2 while fix-attacker attacks from P1. */
export const COUNTERATTACKING_PINCER_DECK = deckOf({
  "sv03-120": 4, // Klawf ex — Counterattacking Pincer (onDamagedByAttack → PARKING discard)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "fix-bigbody": 30, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 9, // Colorless Basic Energy — pays Bite's {C}, one discard candidate
  "fix-fire-energy": 9, // Fire Basic Energy — the SECOND, DIFFERENT candidate that forces a PARK
});

/** 0.50.0 → 0.51.0: the `disableAbilities` continuous Ability-lock row (D100 —
    Klefki "Mischievous Lock" / Spiritomb "Fettered in Misfortune" / Ting-Lu ex
    "Cursed Land"). Carries the three aura SOURCES plus one target per read site
    and per predicate field, all fielded by surgery (`setActiveFromDeck` /
    `benchFromDeck` pull from the DECK, so a copy or two of each is enough):
      • Bouffalant / Copperajah ex — a printed passive (`damageReductionAfterWR`),
        the `passivesOf` read site; Copperajah ex doubles as Ting-Lu's `exemptSuffix`.
      • Chien-Pao ex — an activated, ACTIVE-ONLY Ability (Shivery Chill), the
        `useAbility` + redactor sites AND the check-ORDER proof (a locked bench
        copy must report the lock, not the Active-only gate).
      • Tinkaton — a STAGE 2 activated Ability: only Ting-Lu (no stage clause) can
        reach it, so it separates Cursed Land from the two Basic-only locks.
      • Armarouge — a triggered Ability (Scorching Armor), the `triggersOf` site.
      • Fixmon V / Fixmon VMAX — Spiritomb's `suffix` membership and its near-miss.
      • fix-stage1 — a non-Basic the two Basic-only locks must skip.
      • Vitality Band — the TOOL that must keep working on a locked Pokémon.
    fix-bigbody is the DOMINANT (mulligan-free) setup Basic both sides open with —
    the `board()` helper in abilityLock.test.ts ASSERTS that, because any other
    opening Active would smuggle a live aura (or a lock target) onto the board and
    silently pollute every `disabledAbilityUids` assertion. fix-attacker's Bite
    ({C}, 30) is the lock-OFF arm of each pair, fix-energy pays it. BOTH seats run
    the deck — every aura here reaches across the table. */
export const ABILITY_LOCK_DECK = deckOf({
  "sv01-096": 2, // Klefki — Mischievous Lock (Basic, both sides, Active-only)
  "sv02-089": 2, // Spiritomb — Fettered in Misfortune (Basic V, both sides, from the bench too)
  "sv02-127": 2, // Ting-Lu ex — Cursed Land (opponent's damaged non-ex, Active-only)
  "sv02-061": 2, // Chien-Pao ex — "Shivery Chill" (an activated, Active-only Ability)
  "sv02-105": 2, // Tinkaton — "Gather Materials" (a STAGE 2 activated Ability)
  "sv02-150": 2, // Copperajah ex — "Bronze Body" (a passive, and Ting-Lu's ex exemption)
  "sv03-044": 2, // Armarouge — "Scorching Armor" (a triggered Ability)
  "sv03-174": 2, // Bouffalant — "Bouffer" (−20 after W/R, the passive read site)
  "fix-pokemon-v": 2, // Fixmon V — Spiritomb's target
  "fix-pokemon-vmax": 2, // Fixmon VMAX — the suffix near-miss Spiritomb must skip
  "fix-stage1": 2, // a NON-Basic target (Klefki/Spiritomb exclude it by stage)
  "sv01-197": 2, // Vitality Band — the Tool a locked Pokémon keeps
  "fix-attacker": 4, // the plain-damage attacker (Bite = {C} 30, index 0)
  "fix-energy": 6, // Colorless Basic Energy — pays Bite's {C}
  "fix-water-energy": 4, // what Shivery Chill searches for — without it the redactor
  //                        greys the row as "No legal target" and the lock is invisible
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT setup Active + the displaced body
});

/** M5 op-slice: the `removeWeakness` continuous own-board aura (Florges "Blooming
    Garden", D104). fix-bigbody is the DOMINANT mulligan-free starter both seats
    open on (the `board()` helper asserts it — Ting-Lu ex is a Basic ex that could
    otherwise open Active and smuggle a live Cursed Land lock, and fix-weak /
    fix-water-weak opening Active would pre-place a defender). Every specific body
    is surgeried in from the deck: fix-attacker (Fire, Bite {C} 30) vs fix-weak
    (60 HP ×2 Fire) is the main §8.5 path; Chien-Pao ex (sv02-061, Water) "Hail
    Blade" vs fix-water-weak (200 HP ×2 Water) is the interpreter.ts snipeActive
    path; Florges (sv01-093) is the aura, Ting-Lu ex (sv02-127) the §9 lock. */
export const REMOVE_WEAKNESS_DECK = deckOf({
  "sv01-093": 3, // Florges — Blooming Garden (the removeWeakness aura source)
  "fix-attacker": 3, // Fire attacker — Bite ({C}, 30), fix-weak's Fire weakness doubles it
  "fix-weak": 3, // 60 HP ×2 Fire defender — the main-hit weakness witness
  "sv02-061": 3, // Chien-Pao ex (Water) — "Hail Blade" drives the snipeActive path
  "fix-water-weak": 3, // 200 HP ×2 Water defender — the snipeActive weakness witness
  "sv02-127": 3, // Ting-Lu ex — Cursed Land (locks a damaged Florges: the §9-gating witness)
  "fix-fire-energy": 8, // pays Bite's {C} and colours fix-attacker's hit
  "fix-water-energy": 8, // pays Hail Blade's {W}{W} and is its discard fuel
  "fix-bigbody": 26, // 200 HP neutral Basic — DOMINANT mulligan-free starter + displaced body
});

/** M5 op-slice: the discardEnergy ATTACK arms. Four real Basics whose printed
    sentence derives — Pincurchin (the bare opponent-side twin), Tympole (the same
    behind a coin flip), Slither Wing (discard 2) and Koraidon (discard 3) — with
    the Energy their costs need. BOTH seats run it, so the opponent's Active can be
    dressed with the Energy an attack twin strips. fix-victim (30 HP) dies to every
    printed damage here and fix-bigbody (200 HP) survives all of it, which is how
    the "strip a defender the same attack just Knocked Out" case is built. Two
    Fighting prints (…-energy / …-energy-alt) plus colorless fix-energy and a
    Special let an exact-N pick face both interchangeable copies and real choices. */
export const ATTACK_DISCARD_DECK = deckOf({
  "sv02-072": 4, // Pincurchin — Needle Crush
  "sv03-050": 4, // Tympole — Screw Tail (coin-gated)
  "sv06.5-026": 4, // Slither Wing — Smashing Wing (discard 2)
  "sv01-124": 4, // Koraidon — Rampaging Fang (discard 3)
  "fix-discard4": 3, // FIXTURE — discard 4 for a [C] cost, the short-board path
  "fix-victim": 2, // 30 HP — OHKO'd by every attack here
  "fix-bigbody": 3, // 200 HP — survives all of it
  "fix-lightning-energy": 6, // pays Needle Crush's [L][L][L]
  "fix-water-energy": 4, // pays Screw Tail's [W]
  "fix-fighting-energy": 10, // pays the two {F} costs
  "fix-fighting-energy-alt": 4, // a second {F} print — same provision, different id
  "fix-special": 4, // a Special Energy — a distinct identity in the same pick
  "fix-energy": 8, // basic Colorless — the "different print" a mixed board needs
});

/** M5 op-slice: the `providesEnergy` filter. The four DERIVED typed attackers
    (Kilowattrel {L}×1, Arcanine ex {R}×2, Charmeleon "a Fire", Charizard "all
    Fire") plus Armarouge, whose Ability is the filter's second consumer.

    The Energy list is the point of this deck: alongside the basics each cost
    needs, it carries **Luminous** (sv02-191, the wildcard that PROVIDES every
    type — so it is a {L} Energy on Kilowattrel and a {R} one on Armarouge's
    bench), **Jet** (sv02-190, a second Special whose mere presence DEMOTES
    Luminous to {C} and takes it back out of the offer), and an **unauthored**
    Special (fix-special, the conservative Colorless fallback, which is therefore
    never typed). Those three are what make the filter's answer depend on the
    HOST rather than on the card. fix-fire-energy-alt is a second Fire print, so
    an exact-N typed pick can face interchangeable copies; fix-water-energy and
    fix-energy are the non-matching Energy every typed discard must leave alone.
    fix-titan (340 HP) outlives every printed damage here — Arcanine ex's 250 goes
    through both fix-wall (120) and fix-bigbody (200) — so the §8.1 KO tail never
    crowds a test that is about which Energy came off. */
export const PROVIDES_ENERGY_DECK = deckOf({
  "sv01-079": 3, // Kilowattrel — Thunder Blast (a {L} Energy)
  "sv01-032": 3, // Arcanine ex — Bright Flame (2 {R} Energy)
  "swsh10.5-009": 3, // Charmeleon — Flamethrower (a Fire Energy, spelled out)
  "swsh10.5-010": 3, // Charizard — Flare Blitz (all Fire Energy, spelled out)
  "sv01-041": 3, // Armarouge — Fire Off (the moveEnergy consumer)
  "fix-basic-1": 4, // plain bodies: bench sources for Fire Off, setup Basics
  "fix-titan": 5, // 340 HP — survives every printed damage here
  "fix-typeddiscard": 2, // FIXTURE — discards a type its own cost does not need
  "fix-pilescan": 2, // FIXTURE — the filter in a DECK search: matches nothing
  "fix-blend": 2, // FIXTURE — a Special providing TWO distinct types
  "fix-lightning-energy": 4, // pays Thunder Blast's {L}
  "fix-fire-energy": 8, // pays the three Fire costs
  "fix-fire-energy-alt": 2, // a second Fire print — same provision, different id
  "fix-water-energy": 3, // a typed NON-match, to be left attached
  "fix-energy": 5, // basic Colorless — pays the {C} slots, never typed
  "sv02-191": 4, // Luminous Energy — the WILDCARD: provides every type
  "sv02-190": 2, // Jet Energy — a second Special, which demotes Luminous to {C}
  "fix-special": 2, // an UNAUTHORED Special — the Colorless fallback, never typed
});

/** M5 op-slice: attachFromTop (Electric Generator / Hydreigon "Tri Howl"). The
    two authored cards, both target shapes (fix-lightning-1 bodies for the printed
    "your Benched {L} Pokémon", fix-basic-1 Colorless ones that the same filter
    must REFUSE), and an Energy spread that separates what each card may attach:
    fix-lightning-energy is the only Basic {L} — so Electric Generator's candidate
    set is exactly it, while fix-fire-energy / fix-energy / fix-special are the
    three near-misses (wrong type, untyped Colorless, and a SPECIAL Energy, which
    Hydreigon's `anyEnergy` takes and Electric Generator's `basicEnergy` does not).
    fix-item is the non-Energy filler `toDeckTop` uses to fill a window with
    non-candidates, and to be the "other cards" Tri Howl discards. */
export const ATTACH_FROM_TOP_DECK = deckOf({
  "sv01-170": 4, // Electric Generator (Item)
  "sv02-140": 4, // Hydreigon — Tri Howl
  "fix-lightning-1": 8, // the {L} bodies Electric Generator may attach to
  "fix-basic-1": 8, // Colorless bodies — bench targets the {L} filter excludes
  "fix-lightning-energy": 10, // the only Basic {L}: Electric Generator's candidates
  "fix-fire-energy": 8, // a Basic of the WRONG type
  "fix-energy": 6, // basic Colorless — a near-miss for the typed filter
  "fix-special": 6, // a Special Energy — anyEnergy takes it, basicEnergy does not
  "fix-item": 6, // non-Energy filler: window padding + Tri Howl's leftovers
});

/** M5 op-slice: payFromHand — the printed hand COST, in both of its
    wordings. Carries all four newly authored cards plus Meowscarada ex (migrated
    onto the same op, and the FUNGIBLE end of its range).

    The energy spread is what the suite's filters need to be separable:
    fix-grass-energy is Meowscarada's Basic {G}, fix-water-energy Radiant
    Blastoise's Basic {W}, and both are near-misses for the other. fix-special is
    a SPECIAL Energy — Revavroom's `anyEnergy` takes it where the two typed costs
    do not, and it is what makes a Revavroom hand ask a real question instead of
    collapsing. fix-item is the non-Energy filler every unfiltered cost (Ultra
    Ball, Earthen Vessel, Tinkaton) pays with, and fix-basic-1 the Pokémon Ultra
    Ball's own search then has something to find. */
export const HAND_COST_DECK = deckOf({
  "sv01-196": 4, // Ultra Ball (Item) — discard 2 OTHER cards
  "sv06.5-096": 4, // Earthen Vessel (Item) — discard ANOTHER card
  "sv01-142": 4, // Revavroom — Rumbling Engine (an Energy card → draw to 6)
  "sv02-105": 4, // Tinkaton — Gather Materials (a card → draw 3)
  "swsh10.5-018": 2, // Radiant Blastoise — Pump Shot (a Basic {W} → 2 counters)
  "sv02-015": 2, // Meowscarada ex — Bouquet Magic (a Basic {G} → 3 counters)
  "fix-basic-1": 12, // bodies, and what Ultra Ball's search looks for
  "fix-grass-energy": 8, // Meowscarada's Basic {G}
  "fix-water-energy": 8, // Radiant Blastoise's Basic {W}
  "fix-special": 6, // a SPECIAL Energy — anyEnergy only
  "fix-item": 6, // non-Energy filler for the unfiltered costs
});

/** M5 op-slice: the hand cost that is NOT a discard — Dendra (a chosen card from
    hand → the deck's BOTTOM, then draw to 5) and Skwovet (the whole hand to the
    same place, then draw 1).

    The mix is what makes both destinations legible. `fix-item` and `fix-basic-1`
    are the interchangeable bulk a hand pays with, so a hand of copies collapses
    to one candidate and asks nothing; the three ENERGY rows exist to make the
    other kind of hand — one where the pick is a real question — reachable without
    surgery, and to be identifiable at the bottom of a deck afterwards (the whole
    point of `to: "deckBottom"` is that the card is still in the deck, so a test
    must be able to name it there). Skwovet doubles as an Active with a plain
    attack; `fix-attacker` is the opponent body its Bench-side tests need. */
export const DECK_BOTTOM_DECK = deckOf({
  "sv02-179": 4, // Dendra (Supporter) — pay 1 to the bottom, draw to 5
  "sv01-151": 4, // Skwovet — Nest Stash (the whole hand to the bottom, draw 1)
  "fix-attacker": 4, // an opponent body / a second Pokémon in hand
  "fix-basic-1": 12, // interchangeable bulk
  "fix-item": 12, // more interchangeable bulk — the unfiltered cost's usual payer
  "fix-grass-energy": 8, // a distinguishable class the pick can prefer
  "fix-water-energy": 8, // a second one, so a hand can hold three classes
  "fix-energy": 8, // Colorless basics — the filler that fills a deck out
});

/** M5 op-slice §9.2 op→op data flow (Miriam / Superior Energy Retrieval): the
    two Trainers in multiples (handFromDeck pulls them), fix-basic-1 + fix-basic-2
    as the Pokémon Miriam shuffles back (two names, so a pick is distinguishable
    in the discard), fix-item as the plain card a hand cost prefers to pay, and
    THREE basic Energy classes — the exclusion is only observable when the discard
    can hold both a barred copy and an identical-print sibling that is still
    takeable, which needs several of one type as well as several types. */
/** M5 op-slice: attachFromDeck — the deck SEARCH that attaches.
 *
 *  The energy mix is the whole point of this list. **Two prints of Basic {D}**
 *  (fix-dark-energy / -alt) is what makes the interchangeable collapse
 *  observable: they are different ids providing the same type, so a collapse
 *  keyed on the id would offer them separately and this deck would catch it.
 *  The count is deliberately far above any card's `max` — a real list runs a
 *  dozen Energy, and offering twelve rows for a pick of three is exactly the
 *  question the collapse exists to stop being asked.
 *
 *  fix-fire-energy is Charizard's, and each of the two typed classes is a
 *  near-miss for the other card's filter; fix-energy (Colorless basics) and
 *  fix-special are near-misses for BOTH, since `basicEnergy` + a type admits
 *  neither. fix-dark-1 supplies Janine's {D} targets and fix-basic-1 the
 *  Colorless bodies her `targetType` must exclude, while the
 *  fix-basic-1 → fix-stage1 chain is what a real `evolve` action drives to fire
 *  Charizard's onEvolve trigger. */
export const ATTACH_FROM_DECK_DECK = deckOf({
  "sv06.5-059": 4, // Janine's Secret Art (Supporter)
  "sv03-125": 4, // Charizard ex — Infernal Reign (onEvolve)
  "fix-stage1": 4, // what Charizard ex evolves from in this pool
  "fix-basic-1": 8, // Colorless bodies: the chain's base, and non-{D} attach targets
  "fix-dark-1": 6, // the {D} bodies Janine's targetType admits
  "fix-dark-energy": 8, // Janine's Basic {D}
  "fix-dark-energy-alt": 4, // a SECOND print of it — the collapse crosses ids
  "fix-fire-energy": 8, // Charizard's Basic {R}, and a near-miss for Janine
  "fix-energy": 10, // Colorless basics — near-misses for both typed filters
  "fix-special": 4, // a Special Energy — `basicEnergy` admits none of them
});

/** M5 op-slice EffectContext.sourceUid: Pawmot (an Ability the suite drives
    from the Active AND the Bench), two prints of Basic {L} (the collapse
    crosses ids), Flamigo (an onPlayToBench trigger that PARKS — its search
    needs more Flamigo in the deck to find) and Nest Ball (a TRAINER that parks
    — the context that must carry NO source). fix-basic-1 supplies the bodies
    and Nest Ball's searchable Basics. */
export const SOURCE_UID_DECK = deckOf({
  "sv01-076": 4, // Pawmot — Electrogenesis
  "sv01-209": 1, // Pawmot (reprint)
  "sv02-170": 4, // Flamigo — Insta-Flock (onPlayToBench park)
  "sv01-181": 3, // Nest Ball (a parking Trainer)
  "fix-basic-1": 12,
  "fix-lightning-energy": 6,
  "fix-lightning-energy-alt": 4, // the second print — the collapse crosses ids
  "fix-energy": 26,
});

/** M5 op-slice: healChosen "up to N" — all three Saguaro prints (the reprint
    rows are load-bearing: each is driven through playTrainer by id), fix-basic-1
    bodies to damage and heal, and a Potion so the single-arm regression rides
    the same board. */
export const HEAL_UPTO_DECK = deckOf({
  "sv02-187": 3, // Saguaro
  "sv02-255": 2, // Saguaro (reprint)
  "sv02-270": 2, // Saguaro (reprint)
  "sv01-188": 2, // Potion — the exact-1 single arm, unchanged
  "fix-basic-1": 12,
  "fix-energy": 39,
});

/** M5 op-slice: healEachAll (Picnic Basket, sv01-184). Both boards are healed,
    so the deck (shared by both seats) just needs plenty of fix-basic-1 to field
    Active + bench on each side and copies of Picnic Basket to draw into hand. */
export const PICNIC_BASKET_DECK = deckOf({
  "sv01-184": 4, // Picnic Basket
  "fix-basic-1": 20, // bodies for BOTH boards (Active + bench each)
  "fix-energy": 36,
});

/** M5 long-tail: the `evolutionPokemon` CardFilter (Jacq, sv01-175). fix-basic-1
    gives a reliable Basic opening (the Active) and the Basic NON-candidates the
    search must drop; the fix-stage1 → fix-stage2 line is the Evolution Pokémon
    candidate pool (12 + 8 leaves plenty in the deck past the opening hand +
    prizes); Jacq copies are pulled into hand with handFromDeck; fix-energy is
    the non-Pokémon filler the filter also rejects. */
export const JACQ_DECK = deckOf({
  "fix-basic-1": 24, // reliable Basic Active + Basic non-candidates
  "fix-stage1": 12, // Evolution Pokémon candidates
  "fix-stage2": 8, // more Evolution Pokémon candidates
  "sv01-175": 4, // Jacq — pulled into hand post-setup
  "fix-energy": 12, // non-Pokémon filler (rejected)
});

/** M5 op-slice: bottomFromOpponentHand + opponentMayDraw (Ortega / Greavard).

    The OPPONENT's hand is the zone under test, so the mix is about what a hand
    can be made to hold: `fix-item` + `fix-basic-1` in multiples are the
    same-id duplicates the collapse folds; the TWO PRINTS of Basic {D}
    (fix-dark-energy / -alt) are the cross-id class the collapse must also fold
    (the ATTACH_FROM_DECK_DECK trick, aimed at a hand); fix-grass-energy is a
    second distinguishable class so a pick can be a real question. Miriam is
    the SECOND Supporter class beside Ortega's own prints — Greavard's filtered
    pick only parks when the revealed hand holds two distinct Supporters — and
    fix-attacker is the body that attacks. Both Ortega prints are load-bearing
    (each is driven through playTrainer by id). */
export const REVEAL_BOTTOM_DECK = deckOf({
  "sv03-190": 3, // Ortega
  "sv03-219": 2, // Ortega (reprint)
  "sv01-105": 4, // Greavard — Underworld Stroll (the derived attack twin)
  "sv01-179": 3, // Miriam — a second Supporter class for Greavard's pick
  "fix-attacker": 4, // the body that attacks / an opponent Active
  "fix-basic-1": 8, // interchangeable non-Supporter bulk
  "fix-item": 8, // more same-id bulk — the collapse's plainest case
  "fix-grass-energy": 6, // a distinguishable class
  "fix-dark-energy": 6, // Basic {D}, print one…
  "fix-dark-energy-alt": 4, // …and print two: the collapse crosses ids in a HAND
  "fix-psychic-energy": 2, // the {P} Greavard's SECOND attack costs — the plain one
  "fix-energy": 10, // Colorless filler
});

export const OP_RECORD_DECK = deckOf({
  "fix-basic-1": 10,
  "fix-basic-2": 4,
  "sv01-179": 4, // Miriam (Supporter)
  "sv02-189": 4, // Superior Energy Retrieval (Item)
  "fix-item": 6,
  "fix-fire-energy": 12,
  "fix-water-energy": 8,
  "fix-energy": 12,
});

/** M5 coverage pass #1: a Fire attacker (Bite [C] 30 / Flame [Fire][C] 60) to
    hit the passive defenders, the 5 authored cards, fix-basic-1 bodies (bench
    targets for Catcher's gust + Pokémon in the deck for Poké Ball's search), and
    energy. */
export const COVERAGE_DECK = deckOf({
  "fix-attacker": 8,
  "sv01-185": 4,
  "sv01-187": 4,
  "sv01-180": 4,
  "sv02-150": 3,
  "sv01-121": 3,
  "fix-basic-1": 11,
  "fix-energy": 23,
});

/** M4 slice 2 Ability suite: Chien-Pao ex and Bouffalant are both Basics (so
    either can be an Active), plus Water energy for Shivery Chill to search. */
export const ABILITY_DECK = deckOf({
  "sv02-061": 4,
  "sv03-174": 4,
  "fix-basic-1": 12,
  "fix-water-energy": 24,
  "fix-energy": 16,
});

/** TEST SURGERY: make a fresh copy of `cardId` (pulled from the seat's deck)
    the Active, sending the current Active (if any) to the bench end — Ability
    tests need a specific Active without hunting for a setup seed. Bench must
    have room; the result stays legal-shaped (every uid in exactly one zone). */
export function setActiveFromDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  const benched = side.active === null ? side.bench : [...side.bench, side.active];
  if (benched.length > 5) throw new Error("no bench room to displace the current Active");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: makeInPlay(uid, 0),
        bench: benched,
      },
    },
  };
}

/** TEST SURGERY: put a fresh copy of `cardId` (pulled from the seat's deck)
    on the seat's bench end — bench-damage / spread / KO tests need specific
    benched Pokémon without scripting bench plays. Bench must have room; the
    result stays legal-shaped (every uid in exactly one zone). Mirror of
    setActiveFromDeck. */
export function benchFromDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (side.bench.length >= 5) throw new Error("no bench room");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        bench: [...side.bench, makeInPlay(uid, 0)],
      },
    },
  };
}

/** TEST SURGERY: set bench[index]'s damage outright (setDamage's bench twin) —
    spread/lethality tests need damaged benched Pokémon without scripting the
    attacks that would place it. */
export function setBenchDamage(
  state: GameState,
  seat: Seat,
  index: number,
  damage: number,
): GameState {
  const side = state.players[seat];
  if (side.bench[index] === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: side.bench.map((pokemon, i) => (i === index ? { ...pokemon, damage } : pokemon)),
      },
    },
  };
}

export function mustCreate(
  seed: number,
  decks: { p1: string[]; p2: string[] } = { p1: MIXED_DECK, p2: MIXED_DECK },
): { state: GameState; events: GameEvent[] } {
  const result = createGame({ seed, decks, cardPool: FIXTURE_POOL });
  if (!result.ok) throw new Error(`createGame failed: ${result.error.code}`);
  return { state: result.state, events: result.events };
}

export function must(result: ApplyResult): GameState {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.state;
}

/** applyAction that throws on rejection and hands back state + events. */
export function mustApply(
  state: GameState,
  action: GameAction,
): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) {
    throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  }
  return { state: result.state, events: result.events };
}

/** applyAction that must REJECT with exactly `code` — mustApply's negative
    twin, shared by the suites' wire/validation tests. */
export function expectErr(state: GameState, action: GameAction, code: ErrorCode): void {
  const result = applyAction(state, action);
  if (result.ok) {
    throw new Error(`expected ${action.type} to be rejected with ${code}, but it applied`);
  }
  if (result.error.code !== code) {
    throw new Error(
      `expected ${action.type} to fail with ${code}, got ${result.error.code}: ${result.error.message}`,
    );
  }
}

/** Event log → its type names — the shape every suite's order pins assert. */
export function types(events: GameEvent[]): string[] {
  return events.map((event) => event.type);
}

/** The stack-top uid of `seat`'s Active — throws when the spot is empty. */
export function activeUid(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  const uid = active === null ? undefined : topUid(active);
  if (uid === undefined) throw new Error(`${seat} has no Active Pokémon`);
  return uid;
}

/** The stack-top uid of `seat`'s bench[index] — throws when the slot is
    empty (the bench is dense, so a valid index always holds a Pokémon). */
export function benchTopUid(state: GameState, seat: Seat, index: number): string {
  const pokemon = state.players[seat].bench[index];
  const uid = pokemon === undefined ? undefined : topUid(pokemon);
  if (uid === undefined) throw new Error(`${seat} has no benched Pokémon at index ${index}`);
  return uid;
}

export function handUid(state: GameState, seat: Seat, cardId: string): string {
  const uid = state.players[seat].hand.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) {
    throw new Error(`${seat} has no ${cardId} in hand — pick a seed that provides one`);
  }
  return uid;
}

export function handUids(state: GameState, seat: Seat, cardId: string, count: number): string[] {
  const uids = state.players[seat].hand
    .filter((u) => state.cardIdByUid[u] === cardId)
    .slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} has ${uids.length} ${cardId} in hand, needed ${count}`);
  }
  return uids;
}

export function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((u) => {
    // Resolved through the engine's own accessor, so fixtures can never
    // disagree with the engine about what card a uid is.
    const card = cardOfUid(state, u);
    return card !== undefined && isBasicPokemon(card);
  });
  if (uid === undefined) throw new Error(`${seat} has no Basic Pokémon in hand`);
  return uid;
}

export interface SetupOptions {
  /** Who goes first (the winner's pick); defaults to the winner themselves. */
  first?: Seat;
  /** Card ids to bench per seat after the active is placed. */
  bench?: Partial<Record<Seat, string[]>>;
  /** Specific card id to use as the active (defaults to any Basic in hand). */
  active?: Partial<Record<Seat, string>>;
  /** Compensation cards to draw per seat when owed (defaults to all owed). */
  extraDraw?: Partial<Record<Seat, number>>;
}

/** Scripts a full setup: choose first, resolve compensation, place actives
    (+ requested benches), ready both. Returns the state on turn 1. */
export function driveSetup(
  seed: number,
  decks: { p1: string[]; p2: string[] } = { p1: MIXED_DECK, p2: MIXED_DECK },
  opts: SetupOptions = {},
): GameState {
  let state = mustCreate(seed, decks).state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  const winner = state.phase.coinWinner;
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: winner, first: opts.first ?? winner }),
  );
  // Both seats can be owed compensation (each off the other's mulligans), so
  // every undecided seat has to answer before placement opens.
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = SEATS.find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    const count = opts.extraDraw?.[seat] ?? phase.owed[seat];
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count }));
  }
  for (const seat of SEATS) {
    const activeId = opts.active?.[seat];
    const uid =
      activeId === undefined ? firstBasicInHand(state, seat) : handUid(state, seat, activeId);
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid }));
    for (const benchId of opts.bench?.[seat] ?? []) {
      const benchUid = handUid(state, seat, benchId);
      state = must(applyAction(state, { type: "setupPlaceBench", seat, uid: benchUid }));
    }
  }
  for (const seat of SEATS) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** TEST SURGERY: move `count` copies of `cardId` from the seat's deck onto
    the Active's energy, bypassing the one-attach-per-turn rule — attack
    matchups need multi-energy boards without scripting N turns of attaches.
    The result stays a legal-shaped state (every uid in exactly one zone). */
export function attachFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  if (side.active === null) throw new Error(`${seat} has no Active Pokémon`);
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        active: { ...side.active, energy: [...side.active.energy, ...uids] },
      },
    },
  };
}

/** TEST SURGERY: attach `count` copies of `cardId` from the seat's deck onto
    their bench[index]'s energy — the moveEnergy tests need Energy on a BENCHED
    Pokémon (an alternate source, or two sources for the same-source check), which
    attachFromDeck (Active-only) can't set. Mirror of attachFromDeck; legal-shaped
    (every uid in exactly one zone). */
export function attachBenchFromDeck(
  state: GameState,
  seat: Seat,
  index: number,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  if (side.bench[index] === undefined) throw new Error(`${seat} has no benched Pokémon at ${index}`);
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        bench: side.bench.map((pokemon, i) =>
          i === index ? { ...pokemon, energy: [...pokemon.energy, ...uids] } : pokemon,
        ),
      },
    },
  };
}

/** TEST SURGERY: move `count` copies of `cardId` from the seat's deck into
    their HAND — evolution/trainer tests need specific cards in hand without
    hunting for a seed that deals them. Mirror of attachFromDeck; the result
    stays legal-shaped (every uid in exactly one zone). */
export function handFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        hand: [...side.hand, ...uids],
      },
    },
  };
}

/** TEST SURGERY: move `count` copies of `cardId` from the seat's deck into their
    DISCARD pile — the discard-source ops (attachEnergyFrom source:"discard") need
    specific cards in the discard without scripting the KOs/discards that would
    place them there. Mirror of handFromDeck; legal-shaped (every uid in exactly
    one zone). */
export function discardFromDeck(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((uid) => !taken.has(uid)),
        discard: [...side.discard, ...uids],
      },
    },
  };
}

/** TEST SURGERY: move `count` copies of `cardId` to the TOP (front) of the
    seat's deck — the lookAtTopN ops (Great Ball / Pokégear 3.0) look at the top
    N, so a test needs known cards there without hunting for a seed. The cards
    stay in the deck (index 0 = the top, per drawToHand); calls COMPOSE by
    prepending, so seed the DEEPEST layer first and the shallowest last (push a
    filler layer to bury a marker below the window, then push the top
    candidates). Legal-shaped: every uid stays in exactly one zone. */
export function toDeckTop(
  state: GameState,
  seat: Seat,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((uid) => state.cardIdByUid[uid] === cardId).slice(0, count);
  if (uids.length < count) {
    throw new Error(`${seat} deck has ${uids.length} ${cardId}, needed ${count}`);
  }
  const taken = new Set(uids);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: [...uids, ...side.deck.filter((uid) => !taken.has(uid))],
      },
    },
  };
}

/** TEST SURGERY: return every copy of `cardId` from the seat's HAND to the
    bottom of their deck — the inverse of handFromDeck, for tests that need a
    card ABSENT from hand (Meowscarada's cost-unmet reject needs no {G} Energy
    in hand, but the deck deals some). Legal-shaped: every uid stays in exactly
    one zone. */
export function handToDeck(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const moved = side.hand.filter((uid) => state.cardIdByUid[uid] === cardId);
  if (moved.length === 0) return state;
  const movedSet = new Set(moved);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        hand: side.hand.filter((uid) => !movedSet.has(uid)),
        deck: [...side.deck, ...moved],
      },
    },
  };
}

/** TEST SURGERY: overwrite fields of the Active's Special Conditions —
    checkup tests need conditioned boards without scripting the status
    attacks (and coin flips) that would inflict them. The null guard stays:
    withActive takes a non-null Pokémon. */
export function setConditions(
  state: GameState,
  seat: Seat,
  conditions: Partial<SpecialConditions>,
): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return withActive(state, seat, {
    ...active,
    conditions: { ...active.conditions, ...conditions },
  });
}

/** TEST SURGERY: set the Active's damage outright — heal/lethality tests
    need damaged boards without scripting the attacks that would place it. */
export function setDamage(state: GameState, seat: Seat, damage: number): GameState {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active Pokémon`);
  return withActive(state, seat, { ...active, damage });
}

/** TEST SURGERY: shrink a seat's prize row to `count`, returning the surplus
    to the bottom of the deck (still legal-shaped) — win-condition tests need
    "one prize from victory" boards without playing five KOs first. */
export function setPrizes(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        prizes: side.prizes.slice(0, count),
        deck: [...side.deck, ...side.prizes.slice(count)],
      },
    },
  };
}

/** Recursively freeze a value (strict mode makes any later mutation throw). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
