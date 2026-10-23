import type { Card } from "@colorless/schema";
import { CATALOG_MANIFEST } from "./catalogManifest";
import type { EffectOp } from "./effects";
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

export function typedEnergy(id: string, type: string): Card {
  return { ...blank, id, name: `${type} Energy`, category: "Energy", energyType: "Normal" };
}

export function itemTrainer(id: string): Card {
  return { ...blank, id, name: id, category: "Trainer", trainerType: "Item" };
}

export function specialEnergy(id: string, name: string, effect?: string): Card {
  return {
    ...blank,
    id,
    name,
    category: "Energy",
    energyType: "Special",
    ...(effect === undefined ? {} : { effect }),
  };
}

/** A Trainer of a given type. Used with the REAL catalog ids the M4 registry
    authors (sv01-189, …) so `programFor(id)` finds the program — the `effect`
    text is cosmetic here (the registry keys on the id, not the text). */
export function trainerCard(id: string, trainerType: string, effect: string): Card {
  return { ...blank, id, name: id, category: "Trainer", trainerType, effect };
}

function printedTypesOf(id: string): string[] {
  return CATALOG_MANIFEST.printed[id]?.types ?? ["Colorless"];
}

export function battler(id: string, overrides: Partial<Card> = {}): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Basic",
    hp: 60,
    types: printedTypesOf(id),
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
      {
        cost: ["Colorless"],
        name: "Fury",
        effect: "This attack does 20 more damage for each damage counter on this Pokémon.",
      },
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
  "fix-colorless-weak-big": battler("fix-colorless-weak-big", {
    hp: 200,
    weaknesses: [{ type: "Colorless", value: "×2" }],
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
  "sv02-097": battler("sv02-097", {
    name: "Mimikyu",
    types: ["Psychic"],
    hp: 70,
    weaknesses: [{ type: "Metal", value: "×2" }],
    retreat: 1,
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Ghost Eye",
        effect: "Put 7 damage counters on your opponent's Active Pokémon.",
      },
    ],
  }),
  "sv03-098": battler("sv03-098", {
    name: "Polteageist",
    stage: "Stage1",
    evolveFrom: "Sinistea",
    types: ["Psychic"],
    hp: 70,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    retreat: 2,
    attacks: [
      {
        cost: ["Psychic"],
        name: "Antique Collecting",
        effect:
          "Put up to 2 in any combination of Item cards and Pokémon Tool cards from your discard pile into your hand.",
      },
      {
        cost: ["Psychic"],
        name: "Pour Tea",
        effect: "Put 5 damage counters on your opponent's Active Pokémon.",
      },
    ],
  }),
  "sv03-004": battler("sv03-004", {
    name: "Scyther",
    types: ["Grass"],
    hp: 80,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Agility",
        damage: 10,
        effect:
          "Flip a coin. If heads, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
      },
      { cost: ["Colorless", "Colorless"], name: "Cut", damage: 20 },
    ],
  }),
  "sv03-151": battler("sv03-151", {
    name: "Togedemaru",
    types: ["Metal"],
    hp: 80,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Defense Curl",
        effect:
          "Flip a coin. If heads, during your opponent's next turn, prevent all damage done to this Pokémon by attacks.",
      },
      { cost: ["Metal", "Colorless"], name: "Rolling Tackle", damage: 50 },
    ],
  }),
  "sv01-150": battler("sv01-150", {
    name: "Staraptor",
    stage: "Stage2",
    evolveFrom: "Staravia",
    types: ["Colorless"],
    hp: 150,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Tailspin Away",
        damage: 60,
        effect:
          "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",
      },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Power Blast",
        damage: 180,
        effect: "Discard an Energy from this Pokémon.",
      },
    ],
  }),
  "sv02-153": battler("sv02-153", {
    name: "Noivern ex",
    stage: "Stage1",
    evolveFrom: "Noibat",
    types: ["Dragon"],
    hp: 260,
    retreat: 0,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Covert Flight",
        damage: 70,
        effect:
          "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",
      },
      {
        cost: ["Psychic", "Darkness"],
        name: "Dominating Echo",
        damage: 140,
        effect:
          "During your opponent's next turn, they can't play any Special Energy or Stadium cards from their hand.",
      },
    ],
  }),
  "sv03-169": battler("sv03-169", {
    name: "Swablu",
    types: ["Colorless"],
    hp: 50,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Fluffy Guard",
        effect:
          "During your opponent's next turn, this Pokémon takes 20 less damage from attacks (after applying Weakness and Resistance).",
      },
      { cost: ["Colorless", "Colorless"], name: "Flap", damage: 20 },
    ],
  }),
  "sv01-001": battler("sv01-001", {
    name: "Pineco",
    types: ["Grass"],
    hp: 60,
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Guard Press",
        damage: 10,
        effect:
          "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
      },
    ],
  }),
  "sv02-048": battler("sv02-048", {
    name: "Eiscue",
    types: ["Water"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      { cost: ["Water"], name: "Headbutt", damage: 20 },
      {
        cost: ["Water", "Water", "Water"],
        name: "Frigid Block",
        damage: 100,
        effect:
          "Discard all Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).",
      },
    ],
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
  "sv03-029": battler("sv03-029", {
    name: "Ninetales",
    stage: "Stage1",
    evolveFrom: "Vulpix",
    types: ["Fire"],
    hp: 120,
    retreat: 1,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      { cost: ["Fire"], name: "Will-O-Wisp", damage: 20 },
      {
        cost: ["Fire", "Fire"],
        name: "Nine-Tailed Dance",
        effect:
          "Put 9 damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon can't attack.",
      },
    ],
  }),
  "sv01-048": battler("sv01-048", {
    name: "Alomomola",
    types: ["Water"],
    hp: 110,
    retreat: 2,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      { cost: ["Water", "Colorless"], name: "Surf", damage: 30 },
      {
        cost: ["Water", "Water", "Colorless"],
        name: "Aqua Slash",
        damage: 120,
        effect: "During your next turn, this Pokémon can't attack.",
      },
    ],
  }),
  "fix-mola-stage1": {
    ...blank,
    id: "fix-mola-stage1",
    name: "fix-mola-stage1",
    category: "Pokemon",
    stage: "Stage1",
    hp: 150,
    types: ["Water"],
    retreat: 2,
    evolveFrom: "Alomomola",
    attacks: [{ cost: ["Water"], name: "Bubble", damage: 40 }],
  } satisfies Card,
  "sv03-042": battler("sv03-042", {
    name: "Eiscue ex",
    types: ["Fire"],
    hp: 210,
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Water", "Water", "Water"],
        name: "Scalding Block",
        damage: 160,
        effect:
          "Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.",
      },
    ],
  }),
  "sv03-134": battler("sv03-134", {
    name: "Houndoom ex",
    stage: "Stage1",
    evolveFrom: "Houndour",
    types: ["Darkness"],
    hp: 270,
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness", "Darkness"],
        name: "Evil Claw",
        damage: 90,
        effect:
          "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.",
      },
      {
        cost: ["Darkness", "Darkness", "Darkness"],
        name: "Hound's Fang",
        damage: 220,
        effect: "This Pokémon also does 30 damage to itself.",
      },
    ],
  }),
  "sv01-157": battler("sv01-157", {
    name: "Oinkologne",
    stage: "Stage1",
    evolveFrom: "Lechonk",
    types: ["Colorless"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Ram", damage: 50 },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Leg Stomp",
        damage: 130,
        effect: "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
      },
    ],
  }),
  "sv02-130": battler("sv02-130", {
    name: "Paldean Clodsire ex",
    stage: "Stage1",
    evolveFrom: "Paldean Wooper",
    types: ["Darkness"],
    hp: 280,
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Toxic Wetland",
        effect:
          "Once during your turn, if a Stadium is in play, you may make your opponent's Active Pokémon Poisoned.",
      },
    ],
    attacks: [
      {
        cost: ["Darkness", "Colorless", "Colorless"],
        name: "Needle Bone",
        damage: 200,
        effect: "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
      },
    ],
  }),
  "sv02-063": battler("sv02-063", {
    name: "Pikachu ex",
    types: ["Lightning"],
    hp: 190,
    retreat: 0,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Pika Punch", damage: 30 },
      {
        cost: ["Lightning", "Lightning", "Colorless"],
        name: "Dynamic Bolt",
        damage: 220,
        effect: "Flip a coin. If tails, discard all Energy from this Pokémon.",
      },
    ],
  }),
  "sv03-054": battler("sv03-054", {
    name: "Beartic",
    stage: "Stage1",
    evolveFrom: "Cubchoo",
    types: ["Water"],
    hp: 150,
    retreat: 3,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      { cost: ["Water"], name: "Icicle Punch", damage: 30 },
      {
        cost: ["Water", "Water", "Colorless"],
        name: "Frost Purge",
        damage: 170,
        effect: "Flip a coin. If tails, discard all Energy from this Pokémon.",
      },
    ],
  }),
  "sv03-183": battler("sv03-183", {
    name: "Oinkologne",
    stage: "Stage1",
    evolveFrom: "Lechonk",
    types: ["Colorless"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Confounding Cologne",
        damage: 30,
        effect: "Your opponent's Active Pokémon is now Confused.",
      },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "High-Impact Kick",
        damage: 160,
        effect: "Flip a coin. If tails, this Pokémon also does 60 damage to itself.",
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
  "sv01-194": trainerCard(
    "sv01-194",
    "Item",
    "Switch your Active Pokémon with 1 of your Benched Pokémon.",
  ),
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
  "sv02-061": battler("sv02-061", {
    name: "Chien-Pao ex",
    types: ["Water"],
    hp: 220,
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      { type: "Ability", name: "Shivery Chill", effect: "…search for up to 2 Basic {W} Energy…" },
    ],
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
  "sv03-174": battler("sv03-174", {
    name: "Bouffalant",
    types: ["Colorless"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [{ type: "Ability", name: "Bouffer", effect: "This Pokémon takes 20 less damage…" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Damage Rush",
        effect: "Flip a coin until you get tails. This attack does 30 more damage for each heads.",
        damage: "50+",
      },
    ],
  }),

  "sv01-005": battler("sv01-005", {
    name: "Cacnea",
    types: ["Grass"],
    hp: 60,
    abilities: [
      {
        type: "Ability",
        name: "Counterattack Quills",
        effect: "…put 3 damage counters on the Attacking Pokémon.",
      },
    ],
  }),
  "sv01-006": battler("sv01-006", {
    name: "Cacturne",
    types: ["Grass"],
    hp: 130,
    abilities: [
      {
        type: "Ability",
        name: "Counterattack Quills",
        effect: "…put 3 damage counters on the Attacking Pokémon.",
      },
    ],
  }),
  "sv03-112": battler("sv03-112", {
    name: "Stunfisk",
    types: ["Fighting"],
    hp: 120,
    abilities: [
      {
        type: "Ability",
        name: "Custom Trap",
        effect: "…put 5 damage counters on the Attacking Pokémon.",
      },
    ],
  }),
  "sv03-044": battler("sv03-044", {
    name: "Armarouge",
    types: ["Fire"],
    hp: 120,
    abilities: [
      { type: "Ability", name: "Scorching Armor", effect: "…the Attacking Pokémon is now Burned." },
    ],
  }),

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

  "sv01-096": battler("sv01-096", {
    name: "Klefki",
    types: ["Psychic"],
    hp: 70,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Joust",
        damage: 10,
        effect:
          "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.",
      },
    ],
    abilities: [
      {
        type: "Ability",
        name: "Mischievous Lock",
        effect: "Basic Pokémon in play have no Abilities.",
      },
    ],
  }),
  "sv02-089": battler("sv02-089", {
    name: "Spiritomb",
    types: ["Psychic"],
    hp: 60,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Fade Out",
        damage: 10,
        effect: "Put this Pokémon and all attached cards into your hand.",
      },
    ],
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
    attacks: [
      {
        cost: ["Fighting", "Fighting", "Fighting"],
        name: "Land Scoop",
        effect: "Put 2 damage counters on 1 of your opponent's Benched Pokémon.",
        damage: 150,
      },
    ],
  }),
  "fix-spread-bench": battler("fix-spread-bench", {
    types: ["Psychic"],
    hp: 90,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Hex Hurl",
        effect: "Put 2 damage counters on your opponent's Benched Pokémon in any way you like.",
        damage: 90,
      },
    ],
  }),
  "fix-spread-any": battler("fix-spread-any", {
    types: ["Grass"],
    hp: 70,
    retreat: 1,
    attacks: [
      {
        cost: ["Grass"],
        name: "Cursed Drop",
        effect: "Put 4 damage counters on your opponent's Pokémon in any way you like.",
      },
    ],
  }),

  "sv01-167": {
    ...blank,
    id: "sv01-167",
    name: "Beach Court",
    category: "Trainer",
    trainerType: "Stadium",
    effect:
      "The Retreat Cost of each Basic Pokémon in play (both yours and your opponent's) is {C} less.",
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
    effect:
      "Attacks used by each Basic Pokémon in play (both yours and your opponent's) cost {C} more.",
  } satisfies Card,
  "sv02-171": {
    ...blank,
    id: "sv02-171",
    name: "Artazon",
    category: "Trainer",
    trainerType: "Stadium",
    effect:
      "Once during each player's turn, that player may search their deck for a Basic Pokémon that doesn't have a Rule Box and put it onto their Bench. Then, that player shuffles their deck.",
  } satisfies Card,
  "sv01-178": {
    ...blank,
    id: "sv01-178",
    name: "Mesagoza",
    category: "Trainer",
    trainerType: "Stadium",
    effect:
      "Once during each player's turn, that player may flip a coin. If heads, that player searches their deck for a Pokémon, reveals it, and puts it into their hand. Then, that player shuffles their deck.",
  } satisfies Card,
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
  "sv01-197": trainerCard(
    "sv01-197",
    "Tool",
    "The attacks of the Pokémon this card is attached to do 10 more damage…",
  ),
  /** Defiance Band — Tool: +30 before W/R while behind on Prizes. */
  "sv01-169": trainerCard(
    "sv01-169",
    "Tool",
    "If you have more Prize cards remaining than your opponent, the attacks of the Pokémon this card is attached to do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
  ),
  /** Bravery Charm — Tool: the Basic holder gets +50 HP. */
  "sv02-173": trainerCard(
    "sv02-173",
    "Tool",
    "The Basic Pokémon this card is attached to gets +50 HP.",
  ),
  /** Choice Belt — Tool: +30 before W/R vs a defending Pokémon V. */
  "sv02-176": trainerCard(
    "sv02-176",
    "Tool",
    "The attacks of the Pokémon this card is attached to do 30 more damage to your opponent's Active Pokémon V (before applying Weakness and Resistance).",
  ),
  "sv01-193": trainerCard(
    "sv01-193",
    "Tool",
    "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if it is Knocked Out), put 2 damage counters on the Attacking Pokémon.",
  ),
  "sv03-197": trainerCard(
    "sv03-197",
    "Tool",
    "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, put 4 damage counters on the Attacking Pokémon.",
  ),
  "sv01-192": trainerCard(
    "sv01-192",
    "Tool",
    "The {F} Pokémon this card is attached to takes 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).",
  ),
  "sv01-174": trainerCard(
    "sv01-174",
    "Tool",
    "When your Active Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, you may move a Basic Energy from that Pokémon to the Pokémon this card is attached to.",
  ),

  "sv02-190": specialEnergy("sv02-190", "Jet Energy"),
  /** Luminous Energy — wildcard (any 1 type), {C} if another Special attached. */
  "sv02-191": specialEnergy("sv02-191", "Luminous Energy"),
  /** An UNAUTHORED Special Energy — pins the Colorless provision fallback. */
  "fix-special": specialEnergy("fix-special", "fix-special"),

  "fix-mist-energy": specialEnergy(
    "fix-mist-energy",
    "Mist Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nPrevent all effects of attacks used by your opponent's Pokémon done to the Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)",
  ),
  /** Enriching Energy sv08-191 — {C} + draw 4 when attached from hand. */
  "fix-enriching-energy": specialEnergy(
    "fix-enriching-energy",
    "Enriching Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nWhen you attach this card from your hand to a Pokémon, draw 4 cards.",
  ),

  "fix-neo-upper-energy": specialEnergy(
    "fix-neo-upper-energy",
    "Neo Upper Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Stage 2 Pokémon, this card provides every type of Energy but provides only 2 Energy at a time.",
  ),

  "fix-neo-stage1": battler("fix-neo-stage1", {
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    types: ["Psychic"],
    hp: 100,
    retreat: 1,
    attacks: [
      { cost: ["Psychic"], name: "Neo Jab", damage: 20 },
      { cost: ["Psychic", "Water"], name: "Neo Smash", damage: 90 },
    ],
  }),
  /** A Stage 2 from `fix-neo-stage1` — the promoting holder. Same attacks, same
      indices, 160 HP so it survives its own mirror. */
  "fix-neo-stage2": battler("fix-neo-stage2", {
    stage: "Stage2",
    evolveFrom: "fix-neo-stage1",
    types: ["Psychic"],
    hp: 160,
    retreat: 2,
    attacks: [
      { cost: ["Psychic"], name: "Neo Jab", damage: 20 },
      { cost: ["Psychic", "Water"], name: "Neo Smash", damage: 90 },
    ],
  }),

  "fix-prism-energy": specialEnergy(
    "fix-prism-energy",
    "Prism Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to a Basic Pokémon, this card provides every type of Energy but provides only 1 Energy at a time.",
  ),
  /** The BASIC holder — the promoting body, and the evolve SOURCE that lets the
      provision be driven DOWNWARD across a stage boundary. */
  "fix-prism-basic": battler("fix-prism-basic", {
    stage: "Basic",
    types: ["Psychic"],
    hp: 110,
    retreat: 1,
    attacks: [
      { cost: ["Psychic"], name: "Prism Jab", damage: 20 },
      { cost: ["Psychic", "Water"], name: "Prism Smash", damage: 90 },
    ],
  }),
  /** A Stage 1 from `fix-prism-basic` — the NON-Basic holder. Same attacks, same
      indices, 140 HP so it survives its own mirror. */
  "fix-prism-stage1": battler("fix-prism-stage1", {
    stage: "Stage1",
    evolveFrom: "fix-prism-basic",
    types: ["Psychic"],
    hp: 140,
    retreat: 2,
    attacks: [
      { cost: ["Psychic"], name: "Prism Jab", damage: 20 },
      { cost: ["Psychic", "Water"], name: "Prism Smash", damage: 90 },
    ],
  }),

  "fix-reversal-energy": specialEnergy(
    "fix-reversal-energy",
    "Reversal Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf you have more Prize cards remaining than your opponent, and if this card is attached to an Evolution Pokémon that doesn't have a Rule Box (Pokémon ex, Pokémon V, etc. have Rule Boxes), this card provides every type of Energy but provides only 3 Energy at a time.",
  ),
  /** The BASIC holder — the stage term's denial, and the evolve SOURCE for both
      Evolution bodies below. */
  "fix-reversal-basic": battler("fix-reversal-basic", {
    stage: "Basic",
    types: ["Psychic"],
    hp: 120,
    retreat: 1,
    attacks: [
      { cost: ["Psychic", "Water", "Fighting"], name: "Reversal Strike", damage: 90 },
      { cost: ["Psychic", "Water", "Fighting", "Grass"], name: "Reversal Storm", damage: 160 },
      { cost: ["Colorless"], name: "Reversal Tap", damage: 10 },
    ],
  }),
  /** The Evolution holder with NO Rule Box — the ONLY body that promotes, and
      only while its side leads on Prizes remaining. Same attacks, same indices. */
  "fix-reversal-stage1": battler("fix-reversal-stage1", {
    stage: "Stage1",
    evolveFrom: "fix-reversal-basic",
    types: ["Psychic"],
    hp: 150,
    retreat: 2,
    attacks: [
      { cost: ["Psychic", "Water", "Fighting"], name: "Reversal Strike", damage: 90 },
      { cost: ["Psychic", "Water", "Fighting", "Grass"], name: "Reversal Storm", damage: 160 },
      { cost: ["Colorless"], name: "Reversal Tap", damage: 10 },
    ],
  }),
  "fix-reversal-ex": battler("fix-reversal-ex", {
    name: "fix-reversal ex",
    stage: "Stage1",
    evolveFrom: "fix-reversal-basic",
    types: ["Psychic"],
    hp: 150,
    retreat: 2,
    attacks: [
      { cost: ["Psychic", "Water", "Fighting"], name: "Reversal Strike", damage: 90 },
      { cost: ["Psychic", "Water", "Fighting", "Grass"], name: "Reversal Storm", damage: 160 },
      { cost: ["Colorless"], name: "Reversal Tap", damage: 10 },
    ],
  }),

  "sv02-170": battler("sv02-170", { name: "Flamigo", hp: 110, retreat: 1 }),
  "sv01-023": {
    ...blank,
    id: "sv01-023",
    name: "Arboliva",
    category: "Pokemon",
    stage: "Stage1",
    hp: 150,
    types: ["Grass"],
    retreat: 2,
    evolveFrom: "fix-basic-1",
  } satisfies Card,
  /** Garganacl — Blessed Salt (between-turns: heal 20 from EACH of your
      Pokémon). A Basic so it sits Active or benched without an evolution. */
  "sv02-123": battler("sv02-123", { name: "Garganacl", hp: 180, retreat: 2 }),
  /** Trevenant — Forest Miasma (between-turns, Active-only: 1 counter on the
      opponent's Active). A Basic for the same reason. */
  "sv03-012": battler("sv03-012", { name: "Trevenant", hp: 140, retreat: 2 }),

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

  "sv01-118": battler("sv01-118", { name: "Hawlucha", types: ["Fighting"], hp: 70, retreat: 1 }),
  "sv02-015": battler("sv02-015", {
    name: "Meowscarada ex",
    types: ["Grass"],
    hp: 310,
    retreat: 2,
  }),
  /** A Basic Grass Energy — the discard Meowscarada's Bouquet Magic costs. The
      NAME "Grass Energy" is what energyProvidesOf derives "Grass" from. */
  "fix-grass-energy": typedEnergy("fix-grass-energy", "Grass"),

  "sv02-126": battler("sv02-126", {
    name: "Glimmora",
    types: ["Fighting"],
    hp: 30,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Shattering Crystal",
        effect:
          "When this Pokémon is Knocked Out, flip a coin. If heads, your opponent can't take any Prize cards for it.",
      },
    ],
  }),
  "fix-onko": battler("fix-onko", { name: "fix-onko", hp: 30 }),
  "fix-koprize": battler("fix-koprize", { name: "fix-koprize", hp: 30 }),

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
  "sv01-121": battler("sv01-121", {
    name: "Stonjourner",
    types: ["Fighting"],
    hp: 140,
    retreat: 2,
  }),

  "sv01-054": battler("sv01-054", { name: "Quaquaval", types: ["Water"], hp: 170, retreat: 2 }),
  /** Baxcalibur — "Super Cold" (attach a Basic {W} from hand, repeatable). */
  "sv02-060": battler("sv02-060", { name: "Baxcalibur", types: ["Water"], hp: 160, retreat: 2 }),
  /** fix-attacher — FIXTURE for the DISCARD-source attach (a Basic Fire Energy). */
  "fix-attacher": battler("fix-attacher", { name: "fix-attacher", hp: 120, retreat: 1 }),
  "sv01-086": battler("sv01-086", {
    name: "Gardevoir ex",
    types: ["Psychic"],
    hp: 310,
    retreat: 2,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic", "Psychic", "Colorless"],
        name: "Miracle Force",
        effect: "This Pokémon recovers from all Special Conditions.",
        damage: 190,
      },
    ],
  }),
  "sv01-228": battler("sv01-228", {
    name: "Gardevoir ex",
    hp: 310,
    retreat: 2,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic", "Psychic", "Colorless"],
        name: "Miracle Force",
        effect: "This Pokémon recovers from all Special Conditions.",
        damage: 190,
      },
    ],
  }),
  "sv01-245": battler("sv01-245", {
    name: "Gardevoir ex",
    hp: 310,
    retreat: 2,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic", "Psychic", "Colorless"],
        name: "Miracle Force",
        effect: "This Pokémon recovers from all Special Conditions.",
        damage: 190,
      },
    ],
  }),
  "sv01-145": battler("sv01-145", {
    name: "Blissey",
    hp: 150,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Happy Cyclone",
        effect: "Move all Energy from this Pokémon to 1 of your Benched Pokémon.",
        damage: 150,
      },
    ],
  }),
  /** A Basic Psychic {P} Pokémon — a Psychic Embrace target; 60 HP so a damaged
      one exercises the not-if-KO exclusion (50 + 20 counters ≥ 60). */
  "fix-psychic-1": battler("fix-psychic-1", {
    name: "fix-psychic-1",
    types: ["Psychic"],
    hp: 60,
    retreat: 1,
  }),
  /** A Basic Psychic Energy — the Psychic Embrace attach source. */
  "fix-psychic-energy": typedEnergy("fix-psychic-energy", "Psychic"),
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

  "sv01-125": battler("sv01-125", {
    name: "Koraidon ex",
    types: ["Fighting"],
    hp: 230,
    retreat: 1,
  }),
  /** A Basic Fighting {F} Pokémon — a valid Dino Cry target. */
  "fix-fighting-1": battler("fix-fighting-1", {
    name: "fix-fighting-1",
    types: ["Fighting"],
    hp: 70,
    retreat: 1,
  }),
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
  "sv02-028": battler("sv02-028", {
    name: "Paldean Tauros",
    hp: 130,
    types: ["Fire"],
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
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
  "fix-fire-energy-alt": typedEnergy("fix-fire-energy-alt", "Fire"),
  /** FIXTURE — a body big enough to SURVIVE Blaze Dash's 120, so the epilogue's
      no-KO path (the plain §5.3 turn end) can be pinned separately from its KO
      path. fix-wall's 120 HP is exactly lethal to it, which is the trap. */
  "fix-bigbody": battler("fix-bigbody", { hp: 200 }),
  "fix-coinbonus": battler("fix-coinbonus", {
    hp: 200,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Twin Strike",
        damage: "20+",
        effect: "Flip 2 coins. This attack does 30 more damage for each heads.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Twin Crush",
        damage: "20+",
        effect: "Flip 2 coins. This attack does 50 more damage for each heads.",
      },
    ],
  }),
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
  "sv06.5-026": battler("sv06.5-026", {
    name: "Slither Wing",
    hp: 140,
    types: ["Fighting"],
    retreat: 3,
    attacks: [
      {
        cost: ["Fighting", "Colorless"],
        name: "Iron Smasher",
        damage: "20+",
        effect:
          "If your opponent has any Future Pokémon in play, this attack does 120 more damage.",
      },
      {
        cost: ["Fighting", "Fighting", "Colorless"],
        name: "Smashing Wing",
        damage: 130,
        effect: "Discard 2 Energy from this Pokémon.",
      },
    ],
  }),
  "sv01-124": battler("sv01-124", {
    name: "Koraidon",
    hp: 130,
    types: ["Fighting"],
    retreat: 2,
    attacks: [
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Claw Slash", damage: 70 },
      {
        cost: ["Fighting", "Fighting", "Fighting", "Colorless"],
        name: "Rampaging Fang",
        damage: 190,
        effect: "Discard 3 Energy from this Pokémon.",
      },
    ],
  }),
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

  "sv01-079": battler("sv01-079", {
    name: "Kilowattrel",
    hp: 120,
    stage: "Stage1",
    evolveFrom: "Wattrel",
    types: ["Lightning"],
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Skill Dive",
        effect:
          "This attack does 50 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Lightning", "Colorless", "Colorless"],
        name: "Thunder Blast",
        damage: 140,
        effect: "Discard a {L} Energy from this Pokémon.",
      },
    ],
  }),
  "sv01-032": battler("sv01-032", {
    name: "Arcanine ex",
    hp: 280,
    stage: "Stage1",
    evolveFrom: "Growlithe",
    types: ["Fire"],
    retreat: 3,
    attacks: [
      {
        cost: ["Fire", "Fire"],
        name: "Raging Claws",
        damage: "30+",
        effect: "This attack does 10 more damage for each damage counter on this Pokémon.",
      },
      {
        cost: ["Fire", "Fire", "Fire"],
        name: "Bright Flame",
        damage: 250,
        effect: "Discard 2 {R} Energy from this Pokémon.",
      },
    ],
  }),
  "swsh10.5-009": battler("swsh10.5-009", {
    name: "Charmeleon",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Charmander",
    types: ["Fire"],
    retreat: 2,
    attacks: [
      { cost: ["Fire", "Colorless"], name: "Scratch", damage: 30 },
      {
        cost: ["Fire", "Fire", "Colorless", "Colorless"],
        name: "Flamethrower",
        damage: 100,
        effect: "Discard a Fire Energy from this Pokémon.",
      },
    ],
  }),
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
  "fix-titan": battler("fix-titan", { hp: 340, retreat: 4 }),
  "fix-scopedheal": battler("fix-scopedheal", {
    hp: 340,
    retreat: 4,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Basic Salve",
        effect: "Heal 100 damage from each of your Basic Pokémon.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Bench Salve",
        effect: "Heal 100 damage from each of your Benched Pokémon.",
      },
    ],
  }),
  "fix-scopedheal-evo": battler("fix-scopedheal-evo", {
    stage: "Stage1",
    evolveFrom: "fix-scopedheal",
    hp: 340,
    retreat: 4,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Basic Salve",
        effect: "Heal 100 damage from each of your Basic Pokémon.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Bench Salve",
        effect: "Heal 100 damage from each of your Benched Pokémon.",
      },
    ],
  }),
  "fix-threshflip": battler("fix-threshflip", {
    hp: 200,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Twin Shock",
        damage: "90×",
        effect:
          "Flip 2 coins. This attack does 90 damage for each heads. If either of them is heads, your opponent's Active Pokémon is now Paralyzed.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Twin Muddle",
        damage: "90×",
        effect:
          "Flip 2 coins. This attack does 90 damage for each heads. If both of them are tails,  your opponent's Active Pokémon is now Confused.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Quad Shock",
        damage: "60×",
        effect:
          "Flip 4 coins. This attack does 60 damage for each heads. If at least 2 of them are heads, your opponent's Active Pokémon is now Paralyzed.",
      },
    ],
  }),
  "fix-crown": battler("fix-crown", {
    types: ["Colorless"],
    hp: 230,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Crown Opal",
        damage: 60,
        effect:
          "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic non-{C} Pokémon.",
      },
      // INDEX 1 — the same installation with NO exclusion, so one deck drives
      // both readings of one anchor and the optional group is observable as a
      // DIFFERENCE rather than against a second suite's board.
      {
        cost: ["Colorless"],
        name: "Plain Guard",
        damage: 20,
        effect:
          "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",
      },
    ],
  }),
  "fix-stage1-brawler": battler("fix-stage1-brawler", {
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    types: ["Fire"],
    hp: 140,
    retreat: 2,
    attacks: [{ cost: ["Colorless"], name: "Heavy Swipe", damage: 70 }],
  }),
  /** A COLORLESS Basic that can attack — the body the `non-{C}` exclusion must let
      THROUGH. `fix-titan` and `fix-basic-1` are already Colorless Basics but carry
      no attack, so neither can drive the negative half. */
  "fix-colorless-brawler": battler("fix-colorless-brawler", {
    types: ["Colorless"],
    hp: 120,
    attacks: [{ cost: ["Colorless"], name: "Cheap Shot", damage: 40 }],
  }),
  "fix-carapace": battler("fix-carapace", {
    types: ["Metal"],
    hp: 230,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Sturdy Shell",
        damage: 60,
        effect:
          "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 40 or less.",
      },
      {
        cost: ["Colorless"],
        name: "Metal Coat",
        damage: 20,
        effect:
          "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 60 or less.",
      },
    ],
  }),
  "fix-carapace-tough": battler("fix-carapace-tough", {
    types: ["Metal"],
    hp: 230,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Sturdy Shell",
        damage: 60,
        effect:
          "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 40 or less.",
      },
      {
        cost: ["Colorless"],
        name: "Metal Coat",
        damage: 20,
        effect:
          "During your opponent's next turn, prevent all damage done to this Pokémon by attacks if that damage is 60 or less.",
      },
    ],
  }),
  "fix-heavy": battler("fix-heavy", {
    types: ["Colorless"],
    hp: 140,
    attacks: [{ cost: ["Colorless"], name: "Slam", damage: 70 }],
  }),
  "fix-dual-colorless": battler("fix-dual-colorless", {
    types: ["Fire", "Colorless"],
    hp: 120,
    attacks: [{ cost: ["Colorless"], name: "Split Strike", damage: 50 }],
  }),
  "fix-trainerops": battler("fix-trainerops", {
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Collect", effect: "Draw a card." },
      {
        cost: ["Colorless"],
        name: "Stock Up",
        effect: "Draw cards until you have 7 cards in your hand.",
      },
      {
        cost: ["Colorless"],
        name: "Taunt",
        effect: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
      },
      {
        cost: ["Colorless"],
        name: "Escort",
        damage: 60,
        effect:
          "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
      },
      { cost: ["Colorless"], name: "Double Draw", effect: "Draw 2 cards." },
      {
        cost: ["Colorless"],
        name: "Slip Away",
        effect: "Switch this Pokémon with 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Ride the Wind",
        effect: "Flip a coin. If heads, switch this Pokémon with 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Strafe",
        effect: "You may switch this Pokémon with 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Spin Turn",
        damage: 10,
        effect: "Switch this Pokémon with 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Kick Away",
        effect:
          "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Winding Waves",
        effect:
          "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Interjet",
        effect:
          "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Goad 'n' Grab",
        effect:
          "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Drag Off",
        effect:
          "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Volt Cyclone",
        effect: "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Jet Cyclone",
        effect: "Move 3 Energy from this Pokémon to 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Hurricane",
        effect: "Move a Basic Energy from this Pokémon to 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Call for Family",
        effect:
          "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Form Ranks",
        effect:
          "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Parallel Placement",
        effect:
          "Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Meal Time",
        effect:
          "You may search your deck for a card and put it into your hand. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Big Meal",
        effect:
          "You may search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Energy Search",
        effect:
          "Search your deck for up to 2 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Item Hunt",
        effect:
          "Search your deck for an Item card, reveal it, and put it into your hand. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Stadium Search",
        effect:
          "Search your deck for a Stadium card, reveal it, and put it into your hand. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "See Through",
        effect: "Your opponent reveals their hand.",
      },
      {
        cost: ["Colorless"],
        name: "Knock Off",
        effect: "Discard a random card from your opponent's hand.",
      },
      {
        cost: ["Colorless"],
        name: "Astonish",
        effect:
          "Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck.",
      },
      {
        cost: ["Colorless"],
        name: "Thieving Swipe",
        effect:
          "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.",
      },
      {
        cost: ["Colorless"],
        name: "Regi Charge",
        effect: "Attach up to 2 Basic {F} Energy cards from your discard pile to this Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Sand Gift",
        effect: "Attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Fault Line",
        effect:
          "Attach up to 2 Basic Energy cards from your discard pile to 1 of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Pick and Stick",
        effect:
          "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.",
      },
      {
        cost: ["Colorless"],
        name: "Dragon's Fury",
        effect: "Attach a Basic {R} Energy card from your discard pile to 1 of your {N} Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Mud Stock",
        effect:
          "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Energy Assist",
        effect:
          "Search your deck for a Basic Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Zap Charge",
        effect:
          "Search your deck for a Basic {L} Energy card and attach it to this Pokémon. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Aqua Supply",
        effect:
          "Search your deck for up to 2 Basic {W} Energy cards and attach them to this Pokémon. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Energy Bounty",
        effect:
          "Search your deck for up to 3 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Bench Charge",
        effect:
          "Search your deck for up to 2 Basic {L} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Toxic Reserve",
        effect:
          "Search your deck for up to 2 Basic {D} Energy cards and attach them to this Pokémon. Then, shuffle your deck. If you attached Energy to a Pokémon in this way, this Pokémon is now Poisoned.",
      },
      {
        cost: ["Colorless"],
        name: "Water Draw",
        effect:
          "Search your deck for a Basic {W} Energy card and attach it to 1 of your Pokémon. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Split Supply",
        effect:
          "Search your deck for up to 2 Basic Energy cards and attach them to 1 of your Pokémon. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Wrapped in Wind",
        effect: "Attach a Basic Energy card from your hand to this Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Lucky Attachment",
        effect: "Attach a Basic Energy card from your hand to 1 of your Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Full Heart",
        effect:
          "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like.",
      },
      {
        cost: ["Colorless"],
        name: "Leaflet Blessings",
        effect:
          "Attach a Basic {G} Energy card from your hand to 1 of your Benched Pokémon. If you do, heal all damage from that Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Tropical Frenzy",
        effect:
          "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
      },
      {
        cost: ["Colorless"],
        name: "Volt Recovery",
        effect: "Put a Supporter card from your discard pile into your hand.",
      },
      {
        cost: ["Colorless"],
        name: "Rescue Call",
        effect: "Put up to 2 Pokémon from your discard pile into your hand.",
      },
      {
        cost: ["Colorless"],
        name: "Trainer Recall",
        effect: "Put a Trainer card from your discard pile into your hand.",
      },
      {
        cost: ["Colorless"],
        name: "Ghostly Gathering",
        effect: "Put up to 3 Duskull from your discard pile onto your Bench.",
      },
      {
        cost: ["Colorless"],
        name: "Salvage Call",
        effect: "Put a Pokémon from your discard pile into your hand.",
      },
      {
        cost: ["Colorless"],
        name: "Tidal Recall",
        effect: "Put up to 3 {W} Pokémon from your discard pile onto your Bench.",
      },
      {
        cost: ["Colorless"],
        name: "Salvage Grasp",
        effect: "Put a Basic {G} Energy card from your discard pile into your hand.",
      },
      {
        cost: ["Colorless"],
        name: "Summoning Gate",
        effect:
          "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Larimar Rain",
        effect:
          "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Dig It Up",
        effect: "Look at the top card of your deck. You may discard that card.",
      },
      {
        cost: ["Colorless"],
        name: "Return Charge",
        effect:
          "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "But First, Food",
        effect:
          "Attach an Energy card from your hand to this Pokémon. If you do, heal 60 damage from this Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Fist of Focus",
        damage: 30,
        effect: "Attach an Energy card from your discard pile to this Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Hand Purge",
        effect: "Your opponent discards 2 cards from their hand.",
      },
      {
        cost: ["Colorless"],
        name: "Hand Pinch",
        effect: "Your opponent discards a card from their hand.",
      },
      {
        cost: ["Colorless"],
        name: "Spread Cyclone",
        effect: "Move all Energy from this Pokémon to your Benched Pokémon in any way you like.",
      },
      {
        cost: ["Colorless"],
        name: "Free Flow",
        effect:
          "You may move any amount of Energy from your Pokémon to your other Pokémon in any way you like.",
      },
      {
        cost: ["Colorless"],
        name: "Metal Flow",
        effect:
          "You may move any amount of {M} Energy from your Pokémon to your other Pokémon in any way you like.",
      },
      {
        cost: ["Colorless"],
        name: "Static Flick",
        effect: "Move an Energy from 1 of your opponent's Pokémon to another of their Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Draining Sap",
        effect:
          "You may move an Energy from your opponent's Active Pokémon to 1 of their Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Hand Read",
        damage: "50×",
        effect:
          "Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.",
      },
      {
        cost: ["Colorless"],
        name: "Snatch and Toss",
        effect: "Your opponent reveals their hand. Discard a card you find there.",
      },
      {
        cost: ["Colorless"],
        name: "Hand Count",
        damage: "30×",
        effect: "This attack does 30 damage for each card in your opponent's hand.",
      },
      {
        cost: ["Colorless"],
        name: "Future Charge",
        effect:
          "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless"],
        name: "Split Harvest",
        effect:
          "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      },
    ],
  }),
  "fix-water-basic": battler("fix-water-basic", { types: ["Water"] }),
  "fix-dual-basic": battler("fix-dual-basic", { types: ["Fire", "Water"] }),
  "fix-grass-stage1": battler("fix-grass-stage1", {
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    hp: 90,
  }),
  "fix-grass-basic": battler("fix-grass-basic", { types: ["Grass"] }),
  "fix-duskull": battler("fix-duskull", {
    name: "Duskull",
    hp: 60,
    retreat: 1,
  }),
  "fix-charjabug": battler("fix-charjabug", {
    name: "Charjabug",
    stage: "Stage1",
    evolveFrom: "Grubbin",
    hp: 90,
    retreat: 2,
  }),
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

  "sv01-170": trainerCard(
    "sv01-170",
    "Item",
    "Look at the top 5 cards of your deck and attach up to 2 Basic {L} Energy cards you find there to your Benched {L} Pokémon in any way you like. Shuffle the other cards back into your deck.",
  ),
  "sv02-140": battler("sv02-140", {
    name: "Hydreigon",
    hp: 180,
    stage: "Stage2",
    evolveFrom: "Zweilous",
    types: ["Darkness"],
    retreat: 3,
    attacks: [{ cost: ["Darkness", "Darkness", "Colorless"], name: "Dark Cutter", damage: 160 }],
  }),
  "fix-drakloak": battler("fix-drakloak", {
    name: "Drakloak",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Dreepy",
    types: ["Dragon"],
    retreat: 1,
    attacks: [{ cost: ["Fire", "Psychic"], name: "Dragon Headbutt", damage: 70 }],
  }),
  "fix-lightning-1": battler("fix-lightning-1", { types: ["Lightning"], hp: 70, retreat: 1 }),
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
        effect: "If this Pokémon has any Special Energy attached, this attack does 90 more damage.",
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
  "sv02-179": trainerCard(
    "sv02-179",
    "Supporter",
    "Put a card from your hand on the bottom of your deck. If you do, draw cards until you have 5 cards in your hand. (If you have no other cards in your hand, you can't use this card.)",
  ),
  "sv01-151": battler("sv01-151", {
    name: "Skwovet",
    hp: 60,
    stage: "Basic",
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Bite", damage: 20 }],
  }),
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
  "sv03-030": battler("sv03-030", {
    name: "Entei",
    hp: 130,
    types: ["Fire"],
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Pressure",
        effect:
          "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon do 20 less damage (before applying Weakness and Resistance).",
      },
    ],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Blaze Ball",
        damage: "60+",
        effect: "This attack does 20 more damage for each {R} Energy attached to this Pokémon.",
      },
    ],
  }),
  "sv02-117": battler("sv02-117", {
    name: "Lycanroc ex",
    hp: 260,
    stage: "Stage1",
    evolveFrom: "Rockruff",
    types: ["Fighting"],
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      { cost: ["Fighting"], name: "Rock Throw", damage: 40 },
      {
        cost: ["Fighting", "Colorless", "Colorless"],
        name: "Scary Fangs",
        damage: 140,
        effect:
          "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put 10 damage counters on the Attacking Pokémon.",
      },
    ],
  }),
  "sv06.5-039": battler("sv06.5-039", {
    name: "Pecharunt ex",
    hp: 190,
    types: ["Darkness"],
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Subjugating Chains",
        effect:
          "Once during your turn, you may switch 1 of your Benched {D} Pokémon, except any Pecharunt ex, with your Active Pokémon. If you do, the new Active Pokémon is now Poisoned. You can't use more than 1 Subjugating Chains Ability each turn.",
      },
    ],
    attacks: [
      {
        cost: ["Darkness", "Darkness"],
        name: "Irritated Outburst",
        damage: "60×",
        effect: "This attack does 60 damage for each Prize card your opponent has taken.",
      },
    ],
  }),
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
  "sv06.5-008": battler("sv06.5-008", {
    name: "Houndoom",
    hp: 120,
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Houndour",
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Bite", damage: 50 },
      {
        cost: ["Fire", "Colorless", "Colorless"],
        name: "Snarl",
        damage: 100,
        effect:
          "During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance).",
      },
    ],
  }),
  "sv02-062": battler("sv02-062", {
    name: "Pikachu",
    hp: 70,
    types: ["Lightning"],
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Growl",
        effect:
          "During your opponent's next turn, the Defending Pokémon's attacks do 20 less damage (before applying Weakness and Resistance).",
      },
      { cost: ["Lightning", "Colorless"], name: "Pika Bolt", damage: 30 },
    ],
  }),
  "swsh10.5-061": battler("swsh10.5-061", {
    name: "Pidove",
    hp: 60,
    types: ["Colorless"],
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Growl",
        effect:
          "During your opponent's next turn, the Defending Pokémon's attacks do 20 less damage (before applying Weakness and Resistance).",
      },
      { cost: ["Colorless", "Colorless"], name: "Flap", damage: 20 },
    ],
  }),
  "sv06.5-038": battler("sv06.5-038", {
    name: "Fezandipiti ex",
    hp: 210,
    types: ["Darkness"],
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Flip the Script",
        effect:
          "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn.",
      },
    ],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Cruel Arrow",
        effect:
          "This attack does 100 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  "fix-lightning-weak": battler("fix-lightning-weak", {
    types: ["Grass"],
    hp: 130,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),
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
  "fix-twinsnipe": battler("fix-twinsnipe", {
    types: ["Lightning"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Twin Arrow",
        effect:
          "This attack does 50 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  "fix-twinfeint": battler("fix-twinfeint", {
    types: ["Lightning"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Twin Feint",
        effect:
          "This attack does 50 damage to 2 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on those Pokémon.",
      },
    ],
  }),
  "fix-costsnipe": battler("fix-costsnipe", {
    types: ["Lightning"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Cost Arrow",
        effect:
          "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  "fix-allsnipe": battler("fix-allsnipe", {
    types: ["Lightning"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Trifrost",
        effect:
          "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  "fix-allscale": battler("fix-allscale", {
    types: ["Lightning"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "All Scale",
        damage: "50×",
        effect:
          "Discard all {L} Energy from this Pokémon. This attack does 50 damage for each card you discarded in this way.",
      },
    ],
  }),
  "fix-basicscale": battler("fix-basicscale", {
    types: ["Colorless"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Basic Scale",
        damage: "70×",
        effect:
          "You may discard any amount of Basic Energy from your Pokémon. This attack does 70 damage for each card you discarded in this way.",
      },
    ],
  }),
  "fix-benchboost": battler("fix-benchboost", {
    types: ["Psychic"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Bench Boost",
        damage: "50+",
        effect:
          "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way.",
      },
    ],
  }),
  "fix-benchbasicboost": battler("fix-benchbasicboost", {
    types: ["Psychic"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Bench Basic Boost",
        damage: "30+",
        effect:
          "You may discard up to 2 Basic Energy from your Benched Pokémon. This attack does 90 more damage for each card you discarded in this way.",
      },
    ],
  }),
  "fix-handdraw": battler("fix-handdraw", {
    types: ["Water"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Hand Refresh",
        damage: "30",
        effect: "Discard your hand and draw 6 cards.",
      },
    ],
  }),
  "fix-toolscaler": battler("fix-toolscaler", {
    types: ["Fighting"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Gear Grind",
        damage: "30×",
        effect: "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon.",
      },
    ],
  }),
  "fix-selfenergyhand": battler("fix-selfenergyhand", {
    types: ["Grass"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Energy Recall",
        damage: "30",
        effect: "Put an Energy attached to this Pokémon into your hand.",
      },
    ],
  }),
  "fix-boardgrass": battler("fix-boardgrass", {
    types: ["Grass"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Verdant Surge",
        damage: "20+",
        effect:
          "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.",
      },
    ],
  }),
  "fix-lockplural": battler("fix-lockplural", {
    hp: 130,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Tail Whip", damage: 20 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Overdrive",
        damage: 90,
        effect: "During your next turn, this Pokémon can't use attacks.",
      },
    ],
  }),
  "fix-deflock": battler("fix-deflock", {
    hp: 130,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Frost Bind",
        damage: 30,
        effect: "During your opponent's next turn, the Defending Pokémon can't attack.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Glacier Hold",
        damage: 30,
        effect: "During your opponent's next turn, the Defending Pokémon can't use attacks.",
      },
    ],
  }),
  "fix-compound": battler("fix-compound", {
    hp: 340,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Prize Purge",
        damage: "40+",
        effect:
          "This attack does 50 more damage for each Prize card your opponent has taken. Discard an Energy from this Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Prize Recoil",
        damage: "40+",
        effect:
          "This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself.",
      },
      {
        cost: ["Colorless"],
        name: "Cold Shoulder",
        damage: 20,
        effect:
          "Discard 2 Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).",
      },
      {
        cost: ["Colorless"],
        name: "Full Discharge",
        damage: 20,
        effect:
          "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
      },
      {
        cost: ["Colorless"],
        name: "Venom Bind",
        damage: 20,
        effect:
          "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
      {
        cost: ["Colorless"],
        name: "Venom Bind Classic",
        damage: 20,
        effect:
          "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.",
      },
      {
        cost: ["Colorless"],
        name: "Prize Riddle",
        damage: "40+",
        effect:
          "This attack does 50 more damage for each Prize card your opponent has taken. The Defending Pokémon is now Asleep.",
      },
      {
        cost: ["Colorless"],
        name: "Scorch Bind",
        damage: 20,
        effect:
          "Your opponent's Active Pokémon is now Burned. During your opponent's next turn, that Pokémon can't retreat.",
      },
      {
        cost: ["Colorless"],
        name: "Dizzy Bind",
        damage: 20,
        effect:
          "Your opponent's Active Pokémon is now Confused. During your opponent's next turn, that Pokémon can't retreat.",
      },
      {
        cost: ["Colorless"],
        name: "Coil Rest",
        damage: 0,
        effect:
          "Heal 50 damage from this Pokémon. During your next turn, this Pokémon can't retreat.",
      },
      {
        cost: ["Colorless"],
        name: "Deep Rest",
        damage: 0,
        effect:
          "Heal 60 damage from this Pokémon. During your next turn, this Pokémon can't retreat.",
      },
    ],
  }),
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
  "sv01-093": battler("sv01-093", {
    name: "Florges",
    types: ["Psychic"],
    stage: "Stage2",
    hp: 140,
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Blooming Garden",
        effect: "Your Pokémon in play have no Weakness.",
      },
    ],
    attacks: [
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Moonblast",
        damage: 120,
        effect:
          "During your opponent's next turn, the Defending Pokémon's attacks do 30 less damage (before applying Weakness and Resistance).",
      },
    ],
  }),
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
  "fix-metal-energy": typedEnergy("fix-metal-energy", "Metal"),
  "fix-dark-energy-alt": typedEnergy("fix-dark-energy-alt", "Darkness"),
  "fix-dark-1": battler("fix-dark-1", { types: ["Darkness"], hp: 70, retreat: 1 }),

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
  "fix-lightning-energy-alt": typedEnergy("fix-lightning-energy-alt", "Lightning"),

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

  "sv01-060": battler("sv01-060", {
    name: "Cetitan",
    types: ["Water"],
    stage: "Stage1",
    evolveFrom: "Cetoddle",
    hp: 180,
    retreat: 3,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Hammer In", damage: 50 },
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Sweeping Tackle",
        effect: "This attack does 20 less damage for each damage counter on this Pokémon.",
        damage: "200-",
      },
    ],
  }),

  "sv01-089": battler("sv01-089", {
    name: "Drifloon",
    types: ["Psychic"],
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Gust", damage: 10 },
      {
        cost: ["Psychic", "Psychic"],
        name: "Balloon Blast",
        effect: "This attack does 30 damage for each damage counter on this Pokémon.",
        damage: "30×",
      },
    ],
  }),

  "swsh10.5-036": battler("swsh10.5-036", {
    name: "Onix",
    types: ["Fighting"],
    hp: 120,
    retreat: 4,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Rock Tomb",
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
        damage: 50,
      },
      {
        cost: ["Fighting", "Fighting", "Colorless", "Colorless"],
        name: "Raging Swing",
        effect: "This attack does 50 damage for each damage counter on this Pokémon.",
        damage: "50×",
      },
    ],
  }),

  "sv03-135": battler("sv03-135", {
    name: "Absol ex",
    types: ["Darkness"],
    hp: 210,
    retreat: 1,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness"],
        name: "Future Sight",
        effect: "Look at the top 3 cards of either player's deck and put them back in any order.",
      },
      {
        cost: ["Darkness", "Darkness", "Colorless"],
        name: "Cursed Slug",
        effect:
          "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.",
        damage: "100+",
      },
    ],
  }),

  "sv03-145": battler("sv03-145", {
    name: "Bronzong",
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Bronzor",
    hp: 140,
    retreat: 3,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    attacks: [
      {
        cost: ["Metal"],
        name: "Oracle Press",
        effect:
          "During your opponent's next turn, prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
        damage: 20,
      },
      {
        cost: ["Metal", "Metal"],
        name: "Extrasensory",
        effect:
          "If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.",
        damage: "70+",
      },
    ],
  }),

  "sv01-116": battler("sv01-116", {
    name: "Krokorok",
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "Sandile",
    hp: 100,
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Payback",
        effect:
          "If your opponent has exactly 1 Prize card remaining, this attack does 90 more damage.",
        damage: "30+",
      },
      { cost: ["Fighting", "Fighting"], name: "Corkscrew Punch", damage: 60 },
    ],
  }),

  "sv03-101": battler("sv03-101", {
    name: "Houndstone",
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Greavard",
    hp: 140,
    retreat: 3,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Rear Kick", damage: 30 },
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Two Four-ocious",
        effect:
          "If your opponent has exactly 2 or 4 Prize cards remaining, this attack does 120 more damage.",
        damage: "80+",
      },
    ],
  }),

  "swsh10.5-035": battler("swsh10.5-035", {
    name: "Sylveon",
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Eevee",
    hp: 120,
    retreat: 1,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic"],
        name: "Souvenir",
        effect:
          "Search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Wonder Flash",
        effect:
          "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.",
        damage: "90+",
      },
    ],
  }),

  "sv02-119": battler("sv02-119", {
    name: "Falinks",
    types: ["Fighting"],
    hp: 110,
    retreat: 2,
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Headbutt", damage: 20 },
      {
        cost: ["Fighting", "Colorless", "Colorless"],
        name: "Reckless Charge Together",
        effect: "If Falinks is on your Bench, this attack does 90 more damage.",
        damage: "70+",
      },
    ],
  }),

  "sv03-161": battler("sv03-161", {
    name: "Drampa",
    types: ["Dragon"],
    hp: 120,
    retreat: 2,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Outrage",
        effect: "This attack does 10 more damage for each damage counter on this Pokémon.",
        damage: "60+",
      },
    ],
  }),

  "fix-fighting-weak": battler("fix-fighting-weak", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
  }),

  "sv06.5-030": battler("sv06.5-030", {
    name: "Absol",
    types: ["Darkness"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Darkfall",
        effect: "If you have at least 3 {D} Energy in play, this attack does 50 more damage.",
        damage: "20+",
      },
    ],
  }),
  "fix-darkness-energy": typedEnergy("fix-darkness-energy", "Darkness"),
  "fix-darkness-weak": battler("fix-darkness-weak", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
  }),

  "sv01-152": battler("sv01-152", {
    name: "Greedent",
    stage: "Stage1",
    evolveFrom: "Skwovet",
    types: ["Colorless"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Bite", damage: 50 },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Enhanced Fang",
        effect: "If this Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
        damage: "80+",
      },
    ],
  }),
  "fix-colorless-weak": battler("fix-colorless-weak", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),

  "swsh10.5-027": battler("swsh10.5-027", {
    name: "Pikachu",
    types: ["Lightning"],
    hp: 60,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Lightning", "Colorless", "Colorless"],
        name: "Buddy Bolt",
        effect:
          "If you played a Supporter card from your hand during this turn, this attack does 30 more damage.",
        damage: "30+",
      },
    ],
  }),

  "sv06.5-015": battler("sv06.5-015", {
    name: "Revavroom ex",
    stage: "Stage1",
    evolveFrom: "Varoom",
    types: ["Lightning"],
    hp: 280,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Metal"],
        name: "Accelerator Flash",
        effect:
          "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 120 more damage.",
        damage: "20+",
      },
      {
        cost: ["Metal", "Metal", "Metal"],
        name: "Shattering Speed",
        effect: "Discard this Pokémon and all attached cards.",
        damage: 250,
      },
    ],
  }),
  "swsh10.5-026": battler("swsh10.5-026", {
    name: "Golisopod",
    stage: "Stage1",
    evolveFrom: "Wimpod",
    types: ["Water"],
    hp: 130,
    retreat: 2,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      {
        cost: ["Water"],
        name: "First Impression",
        effect:
          "If this Pokémon moved from your Bench to the Active Spot this turn, this attack does 90 more damage.",
        damage: "20+",
      },
      { cost: ["Water", "Colorless", "Colorless"], name: "Slash", damage: 100 },
    ],
  }),
  "sv06.5-043": battler("sv06.5-043", {
    name: "Varoom",
    types: ["Metal"],
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    attacks: [
      {
        cost: ["Metal"],
        name: "Rigidify",
        effect:
          "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
      },
      { cost: ["Metal", "Metal"], name: "Headbutt Bounce", damage: 20 },
    ],
  }),
  "fix-lightning-weak-big": battler("fix-lightning-weak-big", {
    hp: 320,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),

  "sv03-062": battler("sv03-062", {
    name: "Palafin",
    stage: "Stage1",
    evolveFrom: "Finizen",
    types: ["Water"],
    hp: 150,
    retreat: 2,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      {
        cost: ["Water"],
        name: "Jet Punch",
        effect:
          "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 30,
      },
      {
        cost: ["Water", "Water"],
        name: "Justice Kick",
        effect:
          "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
        damage: 210,
      },
    ],
  }),
  "sv03-061": battler("sv03-061", {
    name: "Finizen",
    types: ["Water"],
    hp: 90,
    retreat: 2,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),
  "sv03-117": battler("sv03-117", {
    name: "Lycanroc",
    stage: "Stage1",
    evolveFrom: "Rockruff",
    types: ["Fighting"],
    hp: 130,
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Finishing Fang",
        effect:
          "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
        damage: 90,
      },
      { cost: ["Fighting", "Colorless", "Colorless"], name: "Slashing Claw", damage: 100 },
    ],
  }),
  "sv03-116": battler("sv03-116", {
    name: "Rockruff",
    types: ["Fighting"],
    hp: 60,
    retreat: 1,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [{ cost: ["Fighting"], name: "Bite", damage: 20 }],
  }),
  "sv01-018": battler("sv01-018", {
    name: "Tarountula",
    types: ["Grass"],
    hp: 60,
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass"],
        name: "Surprise Attack",
        effect: "Flip a coin. If tails, this attack does nothing.",
        damage: 30,
      },
    ],
  }),
  "sv03-036": battler("sv03-036", {
    name: "Litwick",
    types: ["Fire"],
    hp: 60,
    retreat: 1,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire"],
        name: "Firebreathing",
        effect: "Flip a coin. If heads, this attack does 10 more damage.",
        damage: "10+",
      },
    ],
  }),
  "sv01-160": battler("sv01-160", {
    name: "Tandemaus",
    types: ["Colorless"],
    hp: 40,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Double Hit",
        effect: "Flip 2 coins. This attack does 30 damage for each heads.",
        damage: "30×",
      },
    ],
  }),
  "sv06.5-048": battler("sv06.5-048", {
    name: "Meowth",
    types: ["Colorless"],
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Fury Swipes",
        effect: "Flip 3 coins. This attack does 20 damage for each heads.",
        damage: "20×",
      },
    ],
  }),
  "sv01-035": battler("sv01-035", {
    name: "Torkoal",
    hp: 130,
    types: ["Fire"],
    retreat: 3,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Stampede",
        damage: 30,
      },
      {
        cost: ["Fire", "Colorless", "Colorless"],
        name: "Concentrated Fire",
        effect:
          "Flip a coin for each {R} Energy attached to this Pokémon. This attack does 80 damage for each heads.",
        damage: "80×",
      },
    ],
  }),
  "sv03-003": battler("sv03-003", {
    name: "Bellossom",
    stage: "Stage2",
    evolveFrom: "Gloom",
    hp: 130,
    types: ["Grass"],
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Sleep Powder",
        effect: "Your opponent's Active Pokémon is now Asleep.",
        damage: 30,
      },
      {
        cost: ["Grass"],
        name: "Powerful Dance",
        effect:
          "Flip a coin for each Energy attached to this Pokémon. This attack does 90 damage for each heads.",
        damage: "90×",
      },
    ],
  }),
  "fix-flip-filter": battler("fix-flip-filter", {
    hp: 130,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Filtered Flip",
        effect:
          "Flip a coin for each {W} Energy attached to this Pokémon. This attack does 50 damage for each heads.",
        damage: "50×",
      },
    ],
  }),
  "fix-benchcount": battler("fix-benchcount", {
    hp: 200,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Herd Charge",
        effect:
          "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).",
        damage: "20+",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Crowd Crush",
        effect: "This attack does 20 more damage for each of your opponent's Benched Pokémon.",
        damage: "20+",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Flank Rush",
        effect: "This attack does 30 damage for each of your opponent's Benched Pokémon.",
        damage: "30×",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Herd Stomp",
        effect:
          "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 30,
      },
    ],
  }),
  "fix-oppenergy": battler("fix-oppenergy", {
    hp: 200,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Drain Read",
        effect:
          "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.",
        damage: "30+",
      },
      {
        cost: ["Colorless"],
        name: "Siphon Blast",
        effect:
          "This attack does 20 damage for each Energy attached to your opponent's Active Pokémon.",
        damage: "20×",
      },
      {
        cost: ["Colorless"],
        name: "Field Scan",
        effect:
          "This attack does 60 damage for each Energy attached to all of your opponent's Pokémon.",
        damage: "60×",
      },
      {
        cost: ["Colorless"],
        name: "Flare Scan",
        effect:
          "This attack does 60 damage for each {R} Energy attached to all of your opponent's Pokémon.",
        damage: "60×",
      },
    ],
  }),
  "fix-selfenergy": battler("fix-selfenergy", {
    hp: 200,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Power Draw",
        effect: "This attack does 50 more damage for each Energy attached to this Pokémon.",
        damage: "30+",
      },
      {
        cost: ["Colorless"],
        name: "Flare Draw",
        effect: "This attack does 80 more damage for each {R} Energy attached to this Pokémon.",
        damage: "40+",
      },
      {
        cost: ["Colorless"],
        name: "Overflow",
        effect: "This attack does 30 damage for each Energy attached to this Pokémon.",
        damage: "30×",
      },
      {
        cost: ["Colorless"],
        name: "Basic Draw",
        effect: "This attack does 40 damage for each Basic Energy attached to this Pokémon.",
        damage: "40×",
      },
      {
        cost: ["Colorless"],
        name: "Special Draw",
        effect: "This attack does 70 damage for each Special Energy card attached to this Pokémon.",
        damage: "70×",
      },
    ],
  }),
  "fix-bothactives": battler("fix-bothactives", {
    hp: 200,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Twin Surge",
        effect: "This attack does 30 more damage for each Energy attached to both Active Pokémon.",
        damage: "30+",
      },
      {
        cost: ["Colorless"],
        name: "Twin Blast",
        effect: "This attack does 30 damage for each Energy attached to both Active Pokémon.",
        damage: "30×",
      },
      {
        cost: ["Colorless"],
        name: "Twin Flip",
        effect:
          "Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads.",
        damage: "60×",
      },
    ],
  }),
  "sv01-030": battler("sv01-030", {
    name: "Growlithe",
    types: ["Fire"],
    hp: 70,
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire"],
        name: "Relentless Flames",
        effect: "Flip a coin until you get tails. This attack does 30 damage for each heads.",
        damage: "30×",
      },
    ],
  }),
  "sv01-144": battler("sv01-144", {
    name: "Chansey",
    types: ["Colorless"],
    hp: 110,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Pound", damage: 40 },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Egg Rolling",
        effect: "Flip a coin until you get tails. This attack does 60 damage for each heads.",
        damage: "60×",
      },
    ],
  }),
  "sv02-026": battler("sv02-026", {
    name: "Rellor",
    types: ["Grass"],
    hp: 50,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Ball Roll",
        effect: "Flip a coin until you get tails. This attack does 30 damage for each heads.",
        damage: "30×",
      },
    ],
  }),
  "sv01-139": battler("sv01-139", {
    name: "Forretress",
    stage: "Stage1",
    evolveFrom: "Pineco",
    types: ["Metal"],
    hp: 120,
    retreat: 3,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    attacks: [
      {
        cost: ["Metal"],
        name: "Continuous Spin",
        effect: "Flip a coin until you get tails. This attack does 50 damage for each heads.",
        damage: "50×",
      },
      {
        cost: ["Metal", "Colorless", "Colorless"],
        name: "Rolling Shell",
        effect:
          "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance).",
        damage: 90,
      },
    ],
  }),
  "swsh10.5-022": battler("swsh10.5-022", {
    name: "Gyarados",
    stage: "Stage1",
    evolveFrom: "Magikarp",
    types: ["Water"],
    hp: 170,
    retreat: 3,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Wreak Havoc",
        effect:
          "Flip a coin until you get tails. For each heads, discard the top 2 cards of your opponent's deck.",
      },
      {
        cost: ["Water", "Water", "Colorless", "Colorless"],
        name: "Wild Splash",
        effect: "Discard the top 5 cards of your deck.",
        damage: 230,
      },
    ],
  }),
  "sv01-057": battler("sv01-057", {
    name: "Wugtrio",
    stage: "Stage1",
    evolveFrom: "Wiglett",
    types: ["Water"],
    hp: 90,
    retreat: 2,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      { cost: ["Water"], name: "Headbutt", damage: 30 },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Undersea Tunnel",
        effect: "Flip 3 coins. For each heads, discard the top 3 cards of your opponent's deck.",
      },
    ],
  }),
  "sv03-178": battler("sv03-178", {
    name: "Skwovet",
    hp: 60,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Nicked Nibble",
        effect: "Discard the top card of your opponent's deck.",
      },
      { cost: ["Colorless"], name: "Gentle Slap", damage: 10 },
    ],
  }),
  "sv01-117": battler("sv01-117", {
    name: "Krookodile",
    stage: "Stage2",
    evolveFrom: "Krokorok",
    types: ["Fighting"],
    hp: 170,
    retreat: 3,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Chomp Chomp Bite",
        effect:
          "Flip a coin until you get tails. For each heads, discard an Energy from your opponent's Active Pokémon.",
        damage: 50,
      },
      {
        cost: ["Fighting", "Fighting"],
        name: "Earthquake",
        effect:
          "This attack also does 30 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 180,
      },
    ],
  }),
  "swsh10.5-032": battler("swsh10.5-032", {
    name: "Natu",
    types: ["Psychic"],
    stage: "Basic",
    hp: 50,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Nap",
        effect: "Heal 20 damage from this Pokémon.",
      },
      { cost: ["Psychic", "Colorless"], name: "Peck", damage: 20 },
    ],
  }),
  "sv02-037": battler("sv02-037", {
    name: "Skeledirge ex",
    types: ["Fire"],
    stage: "Stage2",
    evolveFrom: "Crocalor",
    hp: 340,
    retreat: 3,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire"],
        name: "Vitality Song",
        effect: "Heal 30 damage from each of your Pokémon.",
        damage: 50,
      },
      {
        cost: ["Fire", "Fire"],
        name: "Burning Voice",
        effect: "This attack does 10 less damage for each damage counter on this Pokémon.",
        damage: "270-",
      },
    ],
  }),
  "sv06.5-021": battler("sv06.5-021", {
    name: "Cresselia",
    types: ["Psychic"],
    stage: "Basic",
    hp: 120,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Psychic"],
        name: "Healing Pirouette",
        effect: "Heal 20 damage from each of your Pokémon.",
      },
      {
        cost: ["Psychic", "Psychic", "Psychic"],
        name: "Crescent Purge",
        effect:
          "You may turn 1 of your face-down Prize cards face up. If you do, this attack does 80 more damage. (That Prize card remains face up for the rest of the game.)",
        damage: "80+",
      },
    ],
  }),
  "sv02-035": battler("sv02-035", {
    name: "Fuecoco",
    types: ["Fire"],
    stage: "Basic",
    hp: 90,
    retreat: 3,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Spacing Out",
        effect: "Flip a coin. If heads, heal 30 damage from this Pokémon.",
      },
      { cost: ["Fire", "Colorless"], name: "Flare", damage: 30 },
    ],
  }),
  "sv01-056": battler("sv01-056", {
    name: "Wiglett",
    types: ["Water"],
    stage: "Basic",
    hp: 60,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Dig a Little",
        effect: "Flip a coin. If heads, discard the top card of your opponent's deck.",
      },
      { cost: ["Colorless", "Colorless"], name: "Ram", damage: 20 },
    ],
  }),
  "sv02-121": battler("sv02-121", {
    name: "Nacli",
    types: ["Fighting"],
    stage: "Basic",
    hp: 70,
    retreat: 3,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Salt Coating",
        effect: "Heal 20 damage from 1 of your Pokémon.",
      },
      { cost: ["Fighting", "Fighting"], name: "Tackle", damage: 30 },
    ],
  }),
  "sv01-007": battler("sv01-007", {
    name: "Tropius",
    types: ["Grass"],
    stage: "Basic",
    hp: 100,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass"],
        name: "Fresh-Picked Fruit",
        effect: "Heal 60 damage from 1 of your Benched Pokémon.",
      },
      { cost: ["Grass", "Colorless"], name: "Razor Leaf", damage: 50 },
    ],
  }),
  "fix-allheal": battler("fix-allheal", {
    hp: 120,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Whole Heal",
        effect: "Heal all damage from 1 of your Benched Pokémon.",
      },
      { cost: ["Colorless", "Colorless"], name: "Blunt Hit", damage: 30 },
    ],
  }),

  "sv02-093": battler("sv02-093", {
    name: "Dedenne ex",
    types: ["Psychic"],
    stage: "Basic",
    hp: 170,
    retreat: 1,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic", "Psychic"],
        name: "Tail Swap",
        effect:
          "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      },
      {
        cost: ["Psychic", "Psychic", "Psychic"],
        name: "Wondrous Shot",
        damage: 170,
        effect: "Discard an Energy from this Pokémon.",
      },
    ],
  }),
  "fix-psychic-weak-big": battler("fix-psychic-weak-big", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Psychic", value: "×2" }],
  }),
  "fix-psychic-resist-big": battler("fix-psychic-resist-big", {
    hp: 200,
    retreat: 1,
    resistances: [{ type: "Psychic", value: "-30" }],
  }),
  "sv03-142": battler("sv03-142", {
    name: "Skarmory",
    types: ["Metal"],
    stage: "Basic",
    hp: 120,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      { cost: ["Colorless"], name: "Peck", damage: 20 },
      {
        cost: ["Metal", "Metal", "Colorless"],
        name: "Slashing Steel",
        damage: 120,
        effect: "During your next turn, this Pokémon can't use Slashing Steel.",
      },
    ],
  }),
  "fix-skarm-stage1": {
    ...blank,
    id: "fix-skarm-stage1",
    name: "fix-skarm-stage1",
    category: "Pokemon",
    stage: "Stage1",
    hp: 160,
    types: ["Metal"],
    retreat: 2,
    evolveFrom: "Skarmory",
    attacks: [{ cost: ["Metal"], name: "Wing Cut", damage: 50 }],
  } satisfies Card,
  "sv06.5-037": battler("sv06.5-037", {
    name: "Munkidori ex",
    types: ["Darkness"],
    stage: "Basic",
    hp: 210,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Oh No You Don't",
        effect:
          "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card.",
      },
    ],
    attacks: [
      {
        cost: ["Darkness", "Darkness", "Colorless"],
        name: "Dirty Headbutt",
        damage: 190,
        effect: "During your next turn, this Pokémon can't use Dirty Headbutt.",
      },
    ],
  }),
  "sv03-179": battler("sv03-179", {
    name: "Greedent ex",
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "Skwovet",
    hp: 260,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Never Ever Enough",
        effect:
          "Look at the top 3 cards of your deck. You may put those cards into your hand. If you don't, discard those cards and draw 3 cards.",
      },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Slip 'n' Roll",
        damage: 210,
        effect: "During your next turn, this Pokémon can't use Slip 'n' Roll.",
      },
    ],
  }),
  "fix-curly-barrer": battler("fix-curly-barrer", {
    hp: 200,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Tackle", damage: 20 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Slip ’n’ Roll",
        damage: 60,
        effect: "During your next turn, this Pokémon can’t use Slip ’n’ Roll.",
      },
    ],
  }),
  "sv01-114": battler("sv01-114", {
    name: "Lucario",
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "Riolu",
    hp: 130,
    retreat: 2,
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Avenging Knuckle",
        damage: "30+",
        effect:
          "If any of your {F} Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 120 more damage.",
      },
      {
        cost: ["Fighting", "Colorless", "Colorless"],
        name: "Accelerating Stab",
        damage: 120,
        effect: "During your next turn, this Pokémon can't use Accelerating Stab.",
      },
    ],
  }),
  "swsh10.5-011": battler("swsh10.5-011", {
    name: "Radiant Charizard",
    types: ["Fire"],
    stage: "Basic",
    hp: 160,
    retreat: 3,
    weaknesses: [{ type: "Water", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Excited Heart",
        effect:
          "This Pokémon's attacks cost Colorless less for each Prize card your opponent has taken.",
      },
    ],
    attacks: [
      {
        cost: ["Fire", "Colorless", "Colorless", "Colorless", "Colorless"],
        name: "Combustion Blast",
        damage: 250,
        effect: "During your next turn, this Pokémon can't use Combustion Blast.",
      },
    ],
  }),
  "sv03-052": battler("sv03-052", {
    name: "Seismitoad",
    types: ["Water"],
    stage: "Stage2",
    evolveFrom: "Palpitoad",
    hp: 170,
    retreat: 3,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Quaking Zone",
        effect:
          "As long as this Pokémon is in the Active Spot, attacks used by your opponent's Active Pokémon cost {C} more.",
      },
    ],
    attacks: [
      {
        cost: ["Water", "Water"],
        name: "Echoed Voice",
        damage: 120,
        effect:
          "During your next turn, this Pokémon's Echoed Voice attack does 100 more damage (before applying Weakness and Resistance).",
      },
    ],
  }),
  "fix-echoer": battler("fix-echoer", {
    types: ["Water"],
    hp: 150,
    retreat: 1,
    attacks: [
      { cost: ["Water"], name: "Echo Tap", damage: 20 },
      {
        cost: ["Water", "Water"],
        name: "Echo Chorus",
        damage: 100,
        effect:
          "During your next turn, this Pokémon's Echo Chorus attack does 100 more damage (before applying Weakness and Resistance).",
      },
    ],
  }),
  "fix-echoer-stage1": {
    ...blank,
    id: "fix-echoer-stage1",
    name: "fix-echoer-stage1",
    category: "Pokemon",
    stage: "Stage1",
    hp: 190,
    types: ["Water"],
    retreat: 1,
    evolveFrom: "fix-echoer",
    attacks: [{ cost: ["Water"], name: "Ripple", damage: 40 }],
  } satisfies Card,
  "fix-booster-ability": battler("fix-booster-ability", {
    types: ["Water"],
    hp: 160,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Resonance",
        effect:
          "This Pokémon's attacks do 30 more damage (before applying Weakness and Resistance).",
      },
    ],
    attacks: [
      { cost: ["Water"], name: "Hum", damage: 20 },
      { cost: ["Water", "Water"], name: "Resound", damage: 40 },
    ],
  }),
  "fix-curly-booster": battler("fix-curly-booster", {
    types: ["Water"],
    hp: 180,
    retreat: 1,
    attacks: [
      { cost: ["Water"], name: "Ripple", damage: 20 },
      {
        cost: ["Water"],
        name: "Slip ’n’ Roll",
        damage: 40,
        effect:
          "During your next turn, this Pokémon's Slip ’n’ Roll attack does 100 more damage (before applying Weakness and Resistance).",
      },
    ],
  }),
  "sv01-111": battler("sv01-111", {
    name: "Medicham",
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "Meditite",
    hp: 90,
    retreat: 1,
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Acu-Punch-Ture",
        damage: 30,
        effect:
          "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      },
      {
        cost: ["Fighting"],
        name: "Kick Shot",
        damage: 90,
        effect: "Flip a coin. If tails, this attack does nothing.",
      },
    ],
  }),
  "sv02-094": battler("sv02-094", {
    name: "Oranguru",
    types: ["Psychic"],
    stage: "Basic",
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Plotter's Command",
        damage: 30,
        effect:
          "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      },
      { cost: ["Psychic", "Colorless", "Colorless"], name: "Super Psy Bolt", damage: 80 },
    ],
  }),

  "sv01-099": battler("sv01-099", {
    name: "Dachsbun",
    stage: "Stage1",
    evolveFrom: "Fidough",
    types: ["Psychic"],
    hp: 90,
    retreat: 1,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Well-Baked Body",
        effect:
          "This Pokémon can't be Burned. Prevent all damage done to this Pokémon by attacks from your opponent's {R} Pokémon.",
      },
    ],
    attacks: [
      { cost: ["Psychic", "Colorless", "Colorless"], name: "Headbutt Bounce", damage: 100 },
    ],
  }),
  "sv03-078": battler("sv03-078", {
    name: "Bellibolt",
    stage: "Stage1",
    evolveFrom: "Tadbulb",
    types: ["Lightning"],
    hp: 140,
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Insulator",
        effect:
          "Prevent all damage done to this Pokémon by attacks from your opponent's {L} Pokémon.",
      },
    ],
    attacks: [
      {
        cost: ["Lightning", "Colorless", "Colorless"],
        name: "Thunderous Edge",
        damage: 100,
        effect:
          "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
      },
    ],
  }),
  "sv03-201": battler("sv03-201", {
    name: "Bellibolt",
    stage: "Stage1",
    evolveFrom: "Tadbulb",
    types: ["Lightning"],
    hp: 140,
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Insulator",
        effect:
          "Prevent all damage done to this Pokémon by attacks from your opponent's {L} Pokémon.",
      },
    ],
    attacks: [
      {
        cost: ["Lightning", "Colorless", "Colorless"],
        name: "Thunderous Edge",
        damage: 100,
        effect:
          "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
      },
    ],
  }),
  "sv03-070": battler("sv03-070", {
    name: "Thundurus",
    types: ["Lightning"],
    hp: 110,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Adverse Weather",
        effect:
          "As long as this Pokémon is in the Active Spot, prevent all damage done to your Benched Pokémon by attacks from your opponent's Pokémon.",
      },
    ],
    attacks: [
      {
        cost: ["Lightning", "Lightning"],
        name: "Gigantic Bolt",
        damage: 140,
        effect: "This Pokémon also does 90 damage to itself.",
      },
    ],
  }),
  "sv06.5-060": {
    ...blank,
    id: "sv06.5-060",
    name: "Neutralization Zone",
    category: "Trainer",
    trainerType: "Stadium",
    effect:
      "Prevent all damage done to Pokémon that don't have a Rule Box (both yours and your opponent's) by attacks from the opponent's Pokémon ex and Pokémon V. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)\n\nThis card can't be put into your hand or deck from the discard pile.",
  } satisfies Card,
  "sv02-113": battler("sv02-113", {
    name: "Hariyama",
    stage: "Stage1",
    evolveFrom: "Makuhita",
    types: ["Fighting"],
    hp: 140,
    retreat: 3,
    weaknesses: [{ type: "Psychic", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Arm Thrust Practice",
        effect:
          "All of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).",
      },
    ],
    attacks: [{ cost: ["Fighting", "Colorless", "Colorless"], name: "Rocket Slap", damage: 120 }],
  }),

  "sv01-095": battler("sv01-095", {
    name: "Dedenne",
    types: ["Psychic"],
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Second Bite",
        effect:
          "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.",
        damage: "30+",
      },
    ],
  }),

  "sv03-086": battler("sv03-086", {
    name: "Espeon",
    types: ["Psychic"],
    stage: "Stage1",
    evolveFrom: "Eevee",
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      {
        cost: ["Psychic"],
        name: "Psychic Assault",
        effect:
          "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.",
        damage: "30+",
      },
      {
        cost: ["Psychic", "Colorless"],
        name: "Psy Bolt",
        effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
        damage: 60,
      },
    ],
  }),

  "sv06.5-025": battler("sv06.5-025", {
    name: "Bloodmoon Ursaluna",
    types: ["Fighting"],
    hp: 150,
    retreat: 4,
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Battle-Hardened",
        effect:
          "When you play this Pokémon from your hand onto your Bench during your turn, you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon.",
      },
    ],
    attacks: [
      {
        cost: ["Fighting", "Fighting", "Colorless"],
        name: "Mad Bite",
        effect:
          "This attack does 30 more damage for each damage counter on your opponent's Active Pokémon.",
        damage: "100+",
      },
    ],
  }),

  "swsh10.5-043": battler("swsh10.5-043", {
    name: "Tyranitar",
    types: ["Darkness"],
    stage: "Stage2",
    evolveFrom: "Pupitar",
    hp: 180,
    retreat: 3,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Raging Crash",
        effect:
          "This attack does 10 damage for each damage counter on all of your Benched Pokémon.",
        damage: "10×",
      },
      {
        cost: ["Darkness", "Darkness", "Colorless", "Colorless"],
        name: "Earthquake",
        effect:
          "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 180,
      },
    ],
  }),

  "sv01-068": battler("sv01-068", {
    name: "Pachirisu",
    stage: "Basic",
    types: ["Lightning"],
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Electricity Pouches",
        effect: "This Pokémon can't be Paralyzed.",
      },
    ],
    attacks: [
      {
        cost: ["Lightning", "Colorless"],
        name: "Everyone Discharge",
        effect:
          "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.",
        damage: "10+",
      },
    ],
  }),
  "sv01-208": battler("sv01-208", {
    name: "Pachirisu",
    stage: "Basic",
    types: ["Lightning"],
    hp: 70,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Electricity Pouches",
        effect: "This Pokémon can't be Paralyzed.",
      },
    ],
    attacks: [
      {
        cost: ["Lightning", "Colorless"],
        name: "Everyone Discharge",
        effect:
          "This attack does 20 more damage for each of your Benched {L} Pokémon. This attack's damage isn't affected by Weakness.",
        damage: "10+",
      },
    ],
  }),

  "sv02-193": specialEnergy(
    "sv02-193",
    "Therapeutic Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nThe Pokémon this card is attached to recovers from being Asleep, Confused, or Paralyzed and can't be affected by those Special Conditions.",
  ),

  "fix-suppressor": battler("fix-suppressor", {
    types: ["Fire"],
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Shred",
        damage: 60,
        effect:
          "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Rock Hurl",
        damage: 60,
        effect: "This attack's damage isn't affected by Resistance.",
      },
      {
        cost: ["Colorless"],
        name: "Demolish",
        damage: 60,
        effect:
          "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Yoga Kick",
        damage: 60,
        effect: "This attack's damage isn't affected by Weakness or Resistance.",
      },
      // The control: the SAME body, the SAME printed 60, no sentence at all. Every
      // number this suite reports is a difference against this one.
      { cost: ["Colorless"], name: "Tackle", damage: 60 },
      {
        cost: ["Colorless"],
        name: "Probe Cut",
        damage: "60+",
        effect: "This attack's damage isn't affected by Resistance.",
      },
    ],
  }),
  "fix-azureseas": battler("fix-azureseas", {
    name: "Wakemon V",
    types: ["Fire"],
    hp: 120,
    abilities: [
      {
        type: "Ability",
        name: "Azure Seas",
        effect:
          "Damage from attacks used by this Pokémon isn't affected by any effects on your opponent's Active Pokémon.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Surge", damage: 60 }],
  }),
  "fix-sturdy": battler("fix-sturdy", {
    name: "Sturdymon",
    hp: 120,
    abilities: [
      {
        type: "Ability",
        name: "Sturdy",
        effect:
          "If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10.",
      },
    ],
  }),
  "fix-sturdytiny": battler("fix-sturdytiny", {
    name: "Sturdymon Jr",
    hp: 20,
    abilities: [
      {
        type: "Ability",
        name: "Sturdy",
        effect:
          "If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10.",
      },
    ],
  }),
  "fix-koblast": battler("fix-koblast", {
    name: "Blastmon",
    hp: 340,
    attacks: [
      { cost: ["Colorless"], name: "Blast", damage: 120 },
      { cost: ["Colorless"], name: "Overkill", damage: 300 },
      {
        cost: ["Colorless"],
        name: "Shockwave",
        damage: 10,
        effect: "This attack does 120 damage to each of your opponent's Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Pinpoint",
        damage: 10,
        effect:
          "This attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Arrow",
        effect:
          "This attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Sting",
        damage: 10,
        effect: "Put 12 damage counters on 1 of your opponent's Benched Pokémon.",
      },
    ],
  }),
  "fix-cofagrigus": battler("fix-cofagrigus", {
    name: "Coffinmon",
    hp: 340,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Extended Damagriiigus",
        effect:
          "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Tail Swap",
        effect:
          "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.",
      },
      { cost: ["Colorless"], name: "Ping", damage: 10 },
    ],
  }),
  "fix-suppresswall": battler("fix-suppresswall", {
    hp: 300,
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  "fix-resistwall": battler("fix-resistwall", {
    hp: 300,
    resistances: [{ type: "Fire", value: "-30" }],
  }),

  "fix-carmine": trainerCard(
    "fix-carmine",
    "Supporter",
    "If you go first, you may use this card during your first turn.\n\nDiscard your hand and draw 5 cards.",
  ),

  "fix-callbell": trainerCard(
    "fix-callbell",
    "Item",
    "You can use this card only if you go second, and only during your first turn.\n\nSearch your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),

  "fix-chillteaser": trainerCard(
    "fix-chillteaser",
    "Item",
    "You can use this card only if you go second, and only during your first turn.\n\nPut an Energy attached to 1 of your opponent's Pokémon into their hand.",
  ),

  "fix-nsplan": trainerCard(
    "fix-nsplan",
    "Supporter",
    "Move up to 2 Energy from your Benched Pokémon to your Active Pokémon.",
  ),

  "fix-powersaver": battler("fix-powersaver", {
    name: "Team Rocket's Mewtwo",
    types: ["Psychic"],
    hp: 200,
    abilities: [
      {
        type: "Ability",
        name: "Power Saver",
        effect:
          "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play.",
      },
    ],
    attacks: [
      { cost: ["Colorless"], name: "Erasure Ball", damage: 40 },
      { cost: ["Colorless", "Colorless"], name: "Second Strike", damage: 90 },
    ],
  }),
  /** A plain prefixed body — the thing the gate COUNTS, carrying no program of
      its own so a suite can tell "the count moved" from "a second gate landed". */
  "fix-tr-body": battler("fix-tr-body", {
    name: "Team Rocket's Meowth",
    types: ["Darkness"],
    attacks: [{ cost: ["Colorless"], name: "Scratch", damage: 10 }],
  }),
  "fix-tr-energy": specialEnergy("fix-tr-energy", "Team Rocket's Energy"),
  "fix-not-tr-body": battler("fix-not-tr-body", {
    name: "Rival of Team Rocket's Meowth",
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  "fix-tr-other-energy": specialEnergy("fix-tr-other-energy", "Team Rocket's Fix Energy"),
  "fix-not-tr-energy": specialEnergy("fix-not-tr-energy", "Rival of Team Rocket's Energy"),
  "fix-seasoned": battler("fix-seasoned", {
    name: "Bloodmoon Ursaluna",
    types: ["Fighting"],
    hp: 260,
    abilities: [
      {
        type: "Ability",
        name: "Seasoned Skill",
        effect:
          "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken.",
      },
    ],
    attacks: [
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Blood Moon", damage: 240 },
      { cost: ["Colorless", "Colorless"], name: "Rough Swing", damage: 60 },
    ],
  }),

  "fix-regalcheer": battler("fix-regalcheer", {
    name: "Serperior",
    types: ["Grass"],
    hp: 320,
    abilities: [
      {
        type: "Ability",
        name: "Regal Cheer",
        effect:
          "Attacks used by your Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Solar Blade", damage: 50 }],
  }),
  "fix-cynthia-aura": battler("fix-cynthia-aura", {
    name: "Cynthia's Roserade",
    types: ["Grass"],
    hp: 130,
    abilities: [
      {
        type: "Ability",
        name: "Cheer On to Glory",
        effect:
          "Attacks used by your Cynthia's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Petal Blizzard", damage: 50 }],
  }),
  /** A plain `Cynthia's ` BENEFICIARY carrying no program of its own — the body
      that separates "the filter reads the attacker" from "the filter reads the
      source". It attacks; the Roserade sits on the Bench. */
  "fix-cynthia-body": battler("fix-cynthia-body", {
    name: "Cynthia's Gible",
    attacks: [{ cost: ["Colorless"], name: "Bite", damage: 50 }],
  }),
  "fix-hop-aura": battler("fix-hop-aura", {
    name: "Hop's Snorlax",
    types: ["Colorless"],
    hp: 150,
    abilities: [
      {
        type: "Ability",
        name: "Extra Helpings",
        effect:
          "Attacks used by your Hop's Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance). The effect of Extra Helpings doesn't stack.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Body Slam", damage: 50 }],
  }),
  "fix-plain-body": battler("fix-plain-body", {
    name: "Wooper",
    attacks: [{ cost: ["Colorless"], name: "Tail Whip", damage: 50 }],
  }),

  "fix-rapidvernier": battler("fix-rapidvernier", {
    name: "Iron Leaves",
    types: ["Grass"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Rapid Vernier",
        effect:
          "When you play this Pokémon from your hand onto your Bench during your turn, you may switch it with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Prism Edge", damage: 50 }],
  }),
  "fix-showtime": battler("fix-showtime", {
    name: "Meowscarada",
    types: ["Grass"],
    hp: 160,
    abilities: [
      {
        type: "Ability",
        name: "Showtime",
        effect:
          "Once during your turn, if this Pokémon is on your Bench, you may switch it with your Active Pokémon.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Rising Bloom", damage: 50 }],
  }),
  /** A plain Energy-bearing body with NO program — the "other Pokémon" the move
      takes from, and the control that separates "the route offered every own
      body" from "the route offered the source's own Energy back to itself". */
  "fix-switch-ally": battler("fix-switch-ally", {
    name: "Sunkern",
    attacks: [{ cost: ["Colorless"], name: "Headbutt", damage: 10 }],
  }),
  "fix-othersmove": battler("fix-othersmove", {
    name: "fix-othersmove",
    abilities: [
      {
        type: "Ability",
        name: "Gather Inward",
        effect:
          "Once during your turn, you may move any amount of Energy from your other Pokémon to this Pokémon.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Nudge", damage: 10 }],
  }),

  "fix-cornerstone": battler("fix-cornerstone", {
    types: ["Fighting"],
    hp: 210,
    abilities: [
      {
        type: "Ability",
        name: "Cornerstone Stance",
        effect:
          "Prevent all damage from attacks done to this Pokémon by your opponent's Pokémon that have an Ability.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  "fix-abilitybody": battler("fix-abilitybody", {
    types: ["Fire"],
    hp: 120,
    abilities: [
      {
        type: "Ability",
        name: "Idle Hands",
        effect: "This Pokémon has an Ability and it does nothing at all.",
      },
    ],
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      {
        cost: ["Colorless"],
        name: "Spread Shot",
        damage: 30,
        effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Pebble Toss",
        effect: "This attack does 40 damage to 1 of your opponent's Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Feint Attack",
        effect:
          "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      },
    ],
  }),
  "fix-abilityv": battler("fix-abilityv", {
    name: "Fixmon V",
    types: ["Fire"],
    hp: 190,
    abilities: [
      {
        type: "Ability",
        name: "Idle Hands",
        effect: "This Pokémon has an Ability and it does nothing at all.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Bite", damage: 30 }],
  }),

  "fix-mightyshell": battler("fix-mightyshell", {
    types: ["Water"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Mighty Shell",
        effect:
          "Prevent all damage from and effects of attacks done to this Pokémon by your opponent's Pokémon that have any Special Energy attached.",
      },
    ],
  }),
  "fix-shellcracker": battler("fix-shellcracker", {
    types: ["Grass"],
    hp: 150,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      {
        cost: ["Colorless"],
        name: "Spread Shot",
        damage: 30,
        effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Pebble Toss",
        effect: "This attack does 40 damage to 1 of your opponent's Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Feint Attack",
        effect:
          "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Yawn",
        effect: "Your opponent's Active Pokémon is now Asleep.",
      },
      {
        cost: ["Colorless"],
        name: "Clutch",
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
    ],
  }),

  "fix-teaparty": battler("fix-teaparty", {
    types: ["Grass"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Curious Tea Party",
        effect:
          "As long as this Pokémon is on your Bench, prevent all damage from and effects of attacks from your opponent's Pokémon done to this Pokémon.",
      },
    ],
  }),

  "fix-spherical": battler("fix-spherical", {
    types: ["Grass"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Spherical Shield",
        effect:
          "Prevent all damage from and effects of attacks from your opponent's Pokémon done to your Benched Pokémon.",
      },
    ],
  }),

  "fix-unnerve": battler("fix-unnerve", {
    types: ["Water"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Unnerve",
        effect:
          "Whenever your opponent plays an Item or Supporter card from their hand, prevent all effects of that card done to this Pokémon.",
      },
    ],
  }),
  "fix-widewall": battler("fix-widewall", {
    types: ["Fighting"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Wide Wall",
        effect:
          "As long as this Pokémon is in the Active Spot, whenever your opponent plays a Supporter card from their hand, prevent all effects of that card done to all of your Pokémon.",
      },
    ],
  }),

  "fix-unaware": battler("fix-unaware", {
    types: ["Fire"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Unaware",
        effect:
          "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
      },
    ],
  }),
  "fix-repellingveil": battler("fix-repellingveil", {
    name: "Team Rocket's Fixicuno",
    types: ["Water"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Repelling Veil",
        effect:
          "Prevent all effects of attacks used by your opponent's Pokémon done to your Basic Team Rocket's Pokémon. (Existing effects are not removed. Damage is not an effect.)",
      },
    ],
  }),
  "fix-tr-stage1": battler("fix-tr-stage1", {
    name: "Team Rocket's Persian",
    stage: "Stage1",
    evolveFrom: "Team Rocket's Meowth",
    types: ["Darkness"],
    hp: 120,
    attacks: [{ cost: ["Colorless"], name: "Slash", damage: 20 }],
  }),
  "fix-inplaybodies": battler("fix-inplaybodies", {
    name: "Team Rocket's Fixmon",
    stage: "Stage1",
    evolveFrom: "Team Rocket's Fixling",
    types: ["Darkness"],
    hp: 200,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Full House",
        damage: "20\u00d7",
        effect: "This attack does 20 damage for each of your Pokémon in play.",
      },
      {
        cost: ["Colorless"],
        name: "Rookie Rush",
        damage: "20\u00d7",
        effect: "This attack does 20 damage for each of your Basic Pokémon in play.",
      },
      {
        cost: ["Colorless"],
        name: "Syndicate Strike",
        damage: "30\u00d7",
        effect: "This attack does 30 damage for each of your Team Rocket's Pokémon in play.",
      },
      {
        cost: ["Colorless"],
        name: "Verdant Tally",
        damage: "30\u00d7",
        effect: "This attack does 30 damage for each of your {G} Pokémon in play.",
      },
      {
        cost: ["Colorless"],
        name: "Lineage Press",
        damage: "40+",
        effect: "This attack does 40 more damage for each of your Evolution Pokémon in play.",
      },
      {
        cost: ["Colorless"],
        name: "Round",
        damage: "20\u00d7",
        effect:
          "This attack does 20 damage for each of your Pokémon in play that has the Round attack.",
      },
      {
        cost: ["Colorless"],
        name: "Rule Breaker",
        damage: "60\u00d7",
        effect: "This attack does 60 damage for each of your opponent's Pok\u00e9mon ex in play.",
      },
      {
        cost: ["Colorless"],
        name: "Class Action",
        damage: "60\u00d7",
        effect:
          "This attack does 60 damage for each of your opponent's Pok\u00e9mon ex and Pok\u00e9mon V in play.",
      },
      {
        cost: ["Colorless"],
        name: "Second Rung",
        damage: "40\u00d7",
        effect: "This attack does 40 damage for each of your Stage 1 Pok\u00e9mon in play.",
      },
    ],
  }),

  "fix-discardpile": battler("fix-discardpile", {
    types: ["Darkness"],
    hp: 340,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Ash Recall",
        damage: "20+",
        effect: "This attack does 20 more damage for each Energy card in your discard pile.",
      },
      {
        cost: ["Colorless"],
        name: "Journey's End",
        damage: "60+",
        effect:
          "This attack does 60 more damage for each Ethan's Adventure card in your discard pile.",
      },
      {
        cost: ["Colorless"],
        name: "Spent Fuel",
        damage: "30\u00d7",
        effect:
          "This attack does 30 damage for each Basic Energy card in your opponent's discard pile.",
      },
      {
        cost: ["Colorless"],
        name: "Litter Sweep",
        damage: "30\u00d7",
        effect: "This attack does 30 damage for each Item card in your opponent's discard pile.",
      },
    ],
  }),

  "fix-ethansadv": {
    ...trainerCard(
      "fix-ethansadv",
      "Supporter",
      "Search your deck for up to 3 in any combination of Ethan's Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    ),
    name: "Ethan's Adventure",
  },

  "fix-trsupporter": {
    ...trainerCard("fix-trsupporter", "Supporter", "Draw 3 cards."),
    name: "Team Rocket's Ambition",
  },

  "fix-trgrunt": {
    ...trainerCard("fix-trgrunt", "Supporter", "Draw 2 cards."),
    name: "Grunt of Team Rocket",
  },

  "fix-trtransceiver": {
    ...itemTrainer("fix-trtransceiver"),
    name: "Team Rocket's Transceiver",
  },

  "fix-weezingcanister": {
    ...itemTrainer("fix-weezingcanister"),
    name: "Weezing Gas Canister",
  },

  "fix-flowercurtain": battler("fix-flowercurtain", {
    types: ["Grass"],
    hp: 220,
    abilities: [
      {
        type: "Ability",
        name: "Flower Curtain",
        effect:
          "Prevent all damage done to your Benched Pokémon that don't have a Rule Box by attacks from your opponent's Pokémon. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
      },
    ],
  }),

  "fix-imperviousshell": battler("fix-imperviousshell", {
    types: ["Fighting"],
    hp: 340,
    abilities: [
      {
        type: "Ability",
        name: "Impervious Shell",
        effect:
          "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon if that damage is 200 or more.",
      },
    ],
  }),

  "fix-imperviousweak": battler("fix-imperviousweak", {
    types: ["Fighting"],
    hp: 340,
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Impervious Shell",
        effect:
          "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon if that damage is 200 or more.",
      },
    ],
  }),

  "fix-crusher": battler("fix-crusher", {
    types: ["Grass"],
    hp: 150,
    attacks: [
      { cost: ["Colorless"], name: "Crush", damage: 200 },
      { cost: ["Colorless"], name: "Nip", damage: 190 },
      { cost: ["Colorless"], name: "Tap", damage: 110 },
      {
        cost: ["Colorless"],
        name: "Big Spread",
        damage: 30,
        effect: "This attack does 200 damage to each of your opponent's Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Small Spread",
        damage: 30,
        effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Boulder Toss",
        effect: "This attack does 200 damage to 1 of your opponent's Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Sneak Boulder",
        effect:
          "This attack does 200 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Yawn",
        effect: "Your opponent's Active Pokémon is now Asleep.",
      },
    ],
  }),

  "fix-bonusconsequent": battler("fix-bonusconsequent", {
    types: ["Grass"],
    hp: 90,
    attacks: [
      { cost: ["Colorless"], name: "Scratch", damage: 20 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Magical Leaf",
        effect:
          "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.",
        damage: "30+",
      },
    ],
  }),

  "fix-optionalboost": battler("fix-optionalboost", {
    types: ["Fighting"],
    hp: 90,
    attacks: [
      { cost: ["Fighting"], name: "Knuckle Punch", damage: 20 },
      {
        cost: ["Fighting", "Colorless", "Colorless"],
        name: "Superpower",
        effect: "You may do 30 more damage. If you do, this Pokémon also does 30 damage to itself.",
        damage: "50+",
      },
    ],
  }),

  "fix-experthider": battler("fix-experthider", {
    types: ["Colorless"],
    hp: 340,
    abilities: [
      {
        type: "Ability",
        name: "Expert Hider",
        effect:
          "If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage.",
      },
    ],
  }),

  "fix-adrenapheromone": battler("fix-adrenapheromone", {
    types: ["Psychic"],
    hp: 340,
    abilities: [
      {
        type: "Ability",
        name: "Adrena-Pheromone",
        effect:
          "If this Pokémon has any {D} Energy attached and is damaged by an attack, flip a coin. If heads, prevent that damage.",
      },
    ],
  }),

  "fix-emergencyevolution": battler("fix-emergencyevolution", {
    name: "Pidove",
    types: ["Colorless"],
    hp: 70,
    abilities: [
      {
        type: "Ability",
        name: "Emergency Evolution",
        effect:
          "Once during your turn, if this Pokémon's remaining HP is 30 or less, you may search your deck for an Unfezant or Unfezant ex and put it onto this Pidove to evolve it. Then, shuffle your deck.",
      },
    ],
  }),

  "fix-unfezant": battler("fix-unfezant", {
    name: "Unfezant",
    types: ["Colorless"],
    hp: 160,
    stage: "Stage2",
    evolveFrom: "Tranquill",
  }),

  "fix-unfezant-ex": battler("fix-unfezant-ex", {
    name: "Unfezant ex",
    types: ["Colorless"],
    hp: 260,
    stage: "Stage2",
    evolveFrom: "Tranquill",
  }),

  "fix-tranquill": battler("fix-tranquill", {
    name: "Tranquill",
    types: ["Colorless"],
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Pidove",
  }),

  "fix-safeguardex": battler("fix-safeguardex", {
    types: ["Psychic"],
    hp: 120,
    abilities: [
      {
        type: "Ability",
        name: "Safeguard",
        effect:
          "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon ex.",
      },
    ],
  }),
  "fix-armortail": battler("fix-armortail", {
    name: "Fixgiraf ex",
    types: ["Darkness"],
    hp: 260,
    abilities: [
      {
        type: "Ability",
        name: "Armor Tail",
        effect:
          "Prevent all damage done to this Pokémon by attacks from your opponent's Basic Pokémon ex.",
      },
    ],
  }),
  "fix-exbasic": battler("fix-exbasic", {
    name: "Fixbase ex",
    types: ["Fire"],
    hp: 180,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      {
        cost: ["Colorless"],
        name: "Spread Shot",
        damage: 30,
        effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Pebble Toss",
        effect: "This attack does 40 damage to 1 of your opponent's Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Feint Attack",
        effect:
          "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      },
    ],
  }),
  "fix-exstage1": battler("fix-exstage1", {
    name: "Fixgrown ex",
    stage: "Stage1",
    types: ["Fire"],
    hp: 180,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      {
        cost: ["Colorless"],
        name: "Spread Shot",
        damage: 30,
        effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Pebble Toss",
        effect: "This attack does 40 damage to 1 of your opponent's Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Feint Attack",
        effect:
          "This attack does 50 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
      },
    ],
  }),

  /** The DISJUNCTION source — Lilligant `sv09-007` "Sunny Day", the only card in
      the Standard pool spelling a filter alternation on this seam. */
  "fix-sunnyday": battler("fix-sunnyday", {
    name: "Lilligant",
    types: ["Grass"],
    hp: 130,
    abilities: [
      {
        type: "Ability",
        name: "Sunny Day",
        effect:
          "Attacks used by your {G} Pokémon and {R} Pokémon do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Solar Beam", damage: 50 }],
  }),
  /** The `stage: "evolution"` source — Victini `sv08-021` "Victory Cheer". A
      BASIC {R} body whose own beneficiary filter REFUSES it, which is the board
      no other aura in the family can build. */
  "fix-victorycheer": battler("fix-victorycheer", {
    name: "Victini",
    types: ["Fire"],
    hp: 70,
    abilities: [
      {
        type: "Ability",
        name: "Victory Cheer",
        effect:
          "Attacks used by your Evolution {R} Pokémon do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Flare Starter", damage: 50 }],
  }),
  "fix-primalknowledge": battler("fix-primalknowledge", {
    name: "Carracosta",
    types: ["Water"],
    hp: 160,
    abilities: [
      {
        type: "Ability",
        name: "Primal Knowledge",
        effect:
          "Attacks used by your Pokémon do 30 more damage to your opponent's Active Evolution Pokémon (before applying Weakness and Resistance).",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Rock Throw", damage: 50 }],
  }),
  "fix-fire-stage1": battler("fix-fire-stage1", {
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    hp: 100,
    attacks: [{ cost: ["Colorless"], name: "Ember", damage: 50 }],
  }),
  "fix-grass-attacker": battler("fix-grass-attacker", {
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Vine Slap", damage: 50 }],
  }),
  "fix-metallicsignal": battler("fix-metallicsignal", {
    name: "Genesect",
    types: ["Metal"],
    hp: 210,
    abilities: [
      {
        type: "Ability",
        name: "Metallic Signal",
        effect:
          "Once during your turn, you may search your deck for up to 2 Evolution {M} Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Techno Blast", damage: 50 }],
  }),
  "fix-metal-stage1": battler("fix-metal-stage1", {
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "fix-basic-1",
    hp: 110,
    attacks: [{ cost: ["Colorless"], name: "Magnet Bomb", damage: 50 }],
  }),

  "fix-legacy-energy": specialEnergy(
    "fix-legacy-energy",
    "Legacy Energy",
    "As long as this card is attached to a Pokémon, it provides every type of Energy but provides only 1 Energy at a time.\n\nIf the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card. This effect of your Legacy Energy can't be applied more than once per game.",
  ),
  /** Lillie's Pearl `sv09-151` — the SAME consequent on a Pokémon TOOL, gated on
      the holder being a `Lillie's ` Pokémon and carrying NO cap. */
  "fix-lillies-pearl": trainerCard(
    "fix-lillies-pearl",
    "Tool",
    "If the Lillie's Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card.",
  ),
  /** The OWNER-PREFIXED holder — the body Lillie's Pearl's gate admits. The NAME
      is the datum and the trailing space is load-bearing (`Lillie's `), exactly as
      `fix-cynthia-body` is for the aura family. 1 Prize. */
  "fix-lillie-body": battler("fix-lillie-body", {
    name: "Lillie's Clefairy",
    hp: 70,
    attacks: [{ cost: ["Colorless"], name: "Pound", damage: 10 }],
  }),
  /** The near miss the gate must REFUSE — an unprefixed body wearing the same
      Pearl. `fix-plain-body`'s job one family over. 1 Prize. */
  "fix-pearl-nobody": battler("fix-pearl-nobody", {
    name: "Clefairy",
    hp: 70,
    attacks: [{ cost: ["Colorless"], name: "Pound", damage: 10 }],
  }),
  /** A 2-PRIZE holder, so "1 fewer" is observable as 2 → 1 rather than only as
      1 → 0 — the board that tells a DECREMENT from Glimmora's ZEROING. `ex` in
      the NAME is the whole datum (`prizeValueOf` reads the suffix off it). */
  "fix-legacy-ex": battler("fix-legacy-ex", {
    name: "Lillie's Clefable ex",
    hp: 260,
    attacks: [{ cost: ["Colorless"], name: "Moonblast", damage: 10 }],
  }),

  "fix-captivatinginvitation": battler("fix-captivatinginvitation", {
    name: "Florges",
    types: ["Psychic"],
    hp: 140,
    abilities: [
      {
        type: "Ability",
        name: "Captivating Invitation",
        effect:
          "Once during your turn, you may flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot, and the new Active Pokémon is now Confused.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Magical Shot", damage: 50 }],
  }),
  /** The SUPPORTER — Team Rocket's Petrel. `trainerCard`'s first printed
      consumer anywhere in the registry. */
  "fix-trainersearch": trainerCard(
    "fix-trainersearch",
    "Supporter",
    "Search your deck for a Trainer card, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),
  "fix-invitee": battler("fix-invitee", {
    name: "Sunkern",
    hp: 70,
    attacks: [{ cost: ["Colorless"], name: "Headbutt", damage: 10 }],
  }),
  /** The opponent's STARTING Active — the body that must be left ALONE. Without
      it, "the new Active is Confused" and "the old Active is Confused" produce
      the same board and the `gust`-then-`applyStatus` ORDER is unobservable. */
  "fix-incumbent": battler("fix-incumbent", {
    name: "Wooper",
    hp: 90,
    attacks: [{ cost: ["Colorless"], name: "Tail Whip", damage: 10 }],
  }),

  "fix-lisiasappeal": trainerCard(
    "fix-lisiasappeal",
    "Supporter",
    "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. If you do, the new Active Pokémon is now Confused.",
  ),
  "fix-evolvedinvitee": {
    ...stage1Pokemon("fix-evolvedinvitee"),
    name: "Sunflora",
    hp: 110,
    attacks: [{ cost: ["Colorless"], name: "Petal Dance", damage: 30 }],
  },

  "fix-drayton": trainerCard(
    "fix-drayton",
    "Supporter",
    "Look at the top 7 cards of your deck. You may reveal a Pokémon and a Trainer card you find there and put them into your hand. Shuffle the other cards back into your deck.",
  ),
  "fix-rotostick": trainerCard(
    "fix-rotostick",
    "Item",
    "Look at the top 4 cards of your deck. You may reveal any number of Supporter cards you find there and put them into your hand. Shuffle the other cards back into your deck.",
  ),
  "fix-bugcatchingset": trainerCard(
    "fix-bugcatchingset",
    "Item",
    "Look at the top 7 cards of your deck. You may reveal up to 2 in any combination of {G} Pokémon and Basic {G} Energy cards you find there and put them into your hand. Shuffle the other cards back into your deck.",
  ),
  "fix-explorersguidance": trainerCard(
    "fix-explorersguidance",
    "Supporter",
    "Look at the top 6 cards of your deck and put 2 of them into your hand. Discard the other cards.",
  ),
  "fix-rika": trainerCard(
    "fix-rika",
    "Supporter",
    "Look at the top 4 cards of your deck and put 2 of them into your hand. Shuffle the other cards and put them on the bottom of your deck.",
  ),

  "fix-larrysskill": trainerCard(
    "fix-larrysskill",
    "Supporter",
    "Discard your hand and search your deck for a Pokémon, a Supporter card, and a Basic Energy card, reveal them, and put them into your hand. Then, shuffle your deck.",
  ),
  "fix-secretbox": trainerCard(
    "fix-secretbox",
    "Item",
    "You can use this card only if you discard 3 other cards from your hand.\n\nSearch your deck for an Item card, a Pokémon Tool card, a Supporter card, and a Stadium card, reveal them, and put them into your hand. Then, shuffle your deck.",
  ),

  "fix-ethans-cyndaquil": battler("fix-ethans-cyndaquil", {
    name: "Ethan's Cyndaquil",
    types: ["Fire"],
  }),
  "fix-ethans-typhlosion": battler("fix-ethans-typhlosion", {
    name: "Ethan's Typhlosion",
    stage: "Stage2",
    evolveFrom: "Ethan's Quilava",
    types: ["Fire"],
    hp: 330,
  }),
  "fix-ethans-pichu": battler("fix-ethans-pichu", {
    name: "Ethan's Pichu",
    types: ["Lightning"],
  }),
  "fix-plain-cyndaquil": battler("fix-plain-cyndaquil", {
    name: "Cyndaquil",
    types: ["Fire"],
  }),
  "fix-ethansadventure": trainerCard(
    "fix-ethansadventure",
    "Supporter",
    "Search your deck for up to 3 in any combination of Ethan's Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
  ),
  "fix-crossseatdiscard": battler("fix-crossseatdiscard", {
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Singe Off",
        effect: "Discard a Special Energy from your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Firefighting",
        effect: "Discard a {R} Energy from your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Cursed Edge",
        effect: "Discard all Special Energy from all of your opponent's Pokémon.",
      },
    ],
  }),

  "fix-sawk": battler("fix-sawk", {
    hp: 120,
    types: ["Fighting"],
    attacks: [
      {
        cost: ["Fighting", "Colorless"],
        name: "Rising Chop",
        damage: 90,
        effect:
          "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.",
      },
      {
        cost: ["Colorless"],
        name: "Unread Rider",
        damage: 20,
        effect:
          "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. Then, spin the wheel of fate.",
      },
      {
        cost: ["Colorless"],
        name: "Unmapped Rider",
        damage: 20,
        effect:
          "If you don't have exactly 4 cards in your hand, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.",
      },
    ],
  }),
  "fix-ironboulder": battler("fix-ironboulder", {
    hp: 120,
    types: ["Psychic"],
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Adjusted Horn",
        damage: 170,
        effect:
          "If you don't have the same number of cards in your hand as your opponent, this attack does nothing.",
      },
    ],
  }),
  "fix-cramorant": battler("fix-cramorant", {
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Fickle Spitting",
        damage: 120,
        effect:
          "If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing.",
      },
    ],
  }),
  "fix-mesprit": battler("fix-mesprit", {
    hp: 120,
    types: ["Psychic"],
    attacks: [
      {
        cost: ["Psychic", "Psychic"],
        name: "Guardian Burst",
        damage: 160,
        effect: "If you don't have Uxie and Azelf on your Bench, this attack does nothing.",
      },
    ],
  }),
  "fix-uxie": battler("fix-uxie", { name: "Uxie", hp: 70, types: ["Psychic"] }),
  "fix-azelf": battler("fix-azelf", { name: "Azelf", hp: 70, types: ["Psychic"] }),
  "fix-lakebystander": battler("fix-lakebystander", { name: "Lake Bystander", hp: 70 }),
  "fix-victini": battler("fix-victini", {
    name: "Victini",
    hp: 80,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Fire", "Fire"],
        name: "V-Force",
        damage: 120,
        effect: "If you have 4 or fewer Benched Pokémon, this attack does nothing.",
      },
      {
        cost: ["Colorless"],
        name: "Bench Rider",
        damage: 20,
        effect:
          "If you have 4 or fewer Benched Pokémon, this attack does nothing. Then, spin the wheel of fate.",
      },
    ],
  }),
  "fix-benchfiller": battler("fix-benchfiller", { hp: 60 }),
  "fix-benchnoun": battler("fix-benchnoun", {
    hp: 200,
    types: ["Fighting"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Static Tally",
        damage: "20\u00d7",
        effect:
          "This attack does 20 damage for each damage counter on all of your Benched {F} Pok\u00e9mon.",
      },
      {
        cost: ["Colorless"],
        name: "Grub Rally",
        damage: "80+",
        effect: "This attack does 80 more damage for each of your Benched Charjabug.",
      },
    ],
  }),
  "fix-roundbody": battler("fix-roundbody", {
    hp: 60,
    attacks: [{ cost: ["Colorless"], name: "Round", damage: 10 }],
  }),
  "fix-wingsbody": battler("fix-wingsbody", {
    hp: 60,
    attacks: [{ cost: ["Colorless"], name: "United Wings", damage: 10 }],
  }),
  "fix-pilewings": battler("fix-pilewings", {
    types: ["Colorless"],
    hp: 340,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Flock Memory",
        damage: "20\u00d7",
        effect:
          "This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack.",
      },
    ],
  }),
  "fix-pilerocket": battler("fix-pilerocket", {
    types: ["Colorless"],
    hp: 340,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Rocket Dossier",
        damage: "20\u00d7",
        effect:
          'This attack does 20 damage for each Supporter card that has "Team Rocket" in its name in your discard pile.',
      },
    ],
  }),
  "fix-inplaynames": battler("fix-inplaynames", {
    types: ["Colorless"],
    hp: 340,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Gas Cloud",
        damage: "40×",
        effect:
          'This attack does 40 damage for each Pokémon in play that has "Koffing" or "Weezing" in its name (both yours and your opponent\'s).',
      },
    ],
  }),
  "fix-galarweezing": battler("fix-galarweezing", {
    types: ["Colorless"],
    name: "Galarian Weezing",
  }),
  "fix-darkkoffing": battler("fix-darkkoffing", {
    types: ["Colorless"],
    name: "Dark Koffing",
  }),
  "fix-weezingwall": battler("fix-weezingwall", {
    types: ["Colorless"],
    hp: 340,
    name: "Weezing",
  }),
  "fix-stage2body": battler("fix-stage2body", {
    stage: "Stage2",
    evolveFrom: "fix-stage1",
    hp: 200,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Deep Lineage",
        damage: "40+",
        effect: "This attack does 40 more damage for each Stage 2 Pok\u00e9mon on your Bench.",
      },
    ],
  }),
  "fix-durant": battler("fix-durant", {
    name: "Durant",
    hp: 60,
    types: ["Metal"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Bite Together",
        damage: 20,
        effect: "If Durant is on your Bench, this attack does 20 more damage.",
      },
    ],
  }),
  "fix-mightyena": battler("fix-mightyena", {
    name: "Mightyena",
    hp: 60,
    types: ["Darkness"],
    attacks: [
      {
        cost: ["Darkness"],
        name: "Hunting Pack",
        damage: 30,
        effect: "If Mightyena is on your Bench, this attack does 90 more damage.",
      },
    ],
  }),
  "fix-illumise": battler("fix-illumise", { name: "Illumise", hp: 60, types: ["Grass"] }),
  "fix-beldum": battler("fix-beldum", { name: "Beldum", hp: 60, types: ["Metal"] }),
  "fix-metang": battler("fix-metang", { name: "Metang", hp: 60, types: ["Metal"] }),
  "fix-loveimpact": {
    ...blank,
    id: "fix-loveimpact",
    name: "Team Rocket's Nidoqueen",
    category: "Pokemon",
    stage: "Stage2",
    evolveFrom: "Team Rocket's Nidorina",
    hp: 170,
    types: ["Darkness"],
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness"],
        name: "Love Impact",
        damage: "60+",
        effect:
          'If a Pokémon that has "Nidoking" in its name is on your Bench, this attack does 120 more damage.',
      },
      { cost: ["Darkness", "Darkness"], name: "Mega Kick", damage: 130 },
    ],
  },
  "fix-trnidoking": battler("fix-trnidoking", {
    name: "Team Rocket's Nidoking ex",
    hp: 60,
    types: ["Darkness"],
  }),
  "fix-nidoking": battler("fix-nidoking", { name: "Nidoking", hp: 60, types: ["Darkness"] }),
  "fix-strikeitrich": {
    ...blank,
    id: "fix-strikeitrich",
    name: "Gholdengo",
    category: "Pokemon",
    stage: "Stage1",
    evolveFrom: "Gimmighoul",
    hp: 130,
    types: ["Metal"],
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    resistances: [{ type: "Grass", value: "-30" }],
    attacks: [
      {
        cost: ["Metal"],
        name: "Strike It Rich",
        damage: "30+",
        effect:
          "If this Pokémon evolved from Gimmighoul during this turn, this attack does 90 more damage.",
      },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Surf Back",
        damage: 100,
        effect: "You may shuffle this Pokémon and all attached cards into your deck.",
      },
    ],
  },
  "fix-gimmighoul": battler("fix-gimmighoul", { name: "Gimmighoul", hp: 60, types: ["Metal"] }),
  "fix-abruptflash": {
    ...blank,
    id: "fix-abruptflash",
    name: "Misty's Starmie",
    category: "Pokemon",
    stage: "Stage1",
    evolveFrom: "Misty's Staryu",
    hp: 100,
    types: ["Water"],
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      {
        cost: ["Water"],
        name: "Abrupt Flash",
        damage: "60+",
        effect:
          "If this Pokémon evolved from Misty's Staryu during this turn, this attack does 80 more damage.",
      },
    ],
  },
  "fix-mistystaryu": battler("fix-mistystaryu", {
    name: "Misty's Staryu",
    hp: 60,
    types: ["Water"],
  }),
  "fix-alloutattack": {
    ...blank,
    id: "fix-alloutattack",
    name: "Falinks",
    category: "Pokemon",
    stage: "Basic",
    hp: 110,
    types: ["Fighting"],
    retreat: 2,
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Form Ranks",
        effect:
          "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "All-Out Attack",
        damage: "30+",
        effect:
          "If this Pokémon used Form Ranks during your last turn, this attack does 90 more damage.",
      },
    ],
  },
  "fix-crazyblast": {
    ...blank,
    id: "fix-crazyblast",
    name: "Weezing",
    category: "Pokemon",
    stage: "Stage1",
    evolveFrom: "Koffing",
    hp: 130,
    types: ["Darkness"],
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness"],
        name: "Pervasive Gas",
        damage: 30,
        effect: "Your opponent's Active Pokémon is now Confused.",
      },
      {
        cost: ["Darkness", "Colorless"],
        name: "Crazy Blast",
        damage: "50+",
        effect:
          "If this Pokémon used Pervasive Gas during your last turn, this attack does 120 more damage.",
      },
    ],
  },
  "fix-bonevengeance": {
    ...blank,
    id: "fix-bonevengeance",
    name: "Marowak",
    category: "Pokemon",
    stage: "Stage1",
    evolveFrom: "Cubone",
    hp: 120,
    types: ["Fighting"],
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Growl",
        effect:
          "During your opponent's next turn, attacks used by the Defending Pokémon do 40 less damage (before applying Weakness and Resistance).",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Bone Vengeance",
        damage: "60+",
        effect:
          "If any of your Benched Cubone have any damage counters on them, this attack does 120 more damage.",
      },
    ],
  },
  "fix-cubone": battler("fix-cubone", { name: "Cubone", hp: 60, types: ["Fighting"] }),
  "fix-counterturn": {
    ...blank,
    id: "fix-counterturn",
    name: "Rabsca",
    category: "Pokemon",
    stage: "Stage1",
    evolveFrom: "Rellor",
    hp: 70,
    types: ["Grass"],
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Triple Draw",
        effect: "Draw 3 cards.",
      },
      {
        cost: ["Grass"],
        name: "Counterturn",
        damage: "40+",
        effect: "If there are 3 or fewer cards in your deck, this attack does 200 more damage.",
      },
    ],
  },
  "fix-hazardousgreed": {
    ...blank,
    id: "fix-hazardousgreed",
    name: "Wo-Chien",
    category: "Pokemon",
    stage: "Basic",
    hp: 130,
    types: ["Grass"],
    retreat: 3,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass", "Colorless"],
        name: "Hazardous Greed",
        damage: 20,
        effect:
          "If there are 3 or fewer cards in your deck, this attack also does 120 damage to 2 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Grass", "Grass", "Colorless"],
        name: "Entangling Whip",
        damage: 130,
        effect: "Discard the top 3 cards of your deck.",
      },
    ],
  },
  "fix-mabosstiff": battler("fix-mabosstiff", {
    name: "Mabosstiff",
    hp: 60,
    types: ["Darkness"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Vigorous Tackle",
        damage: 30,
        effect: "If this Pokémon has no damage counters on it, this attack does 120 more damage.",
      },
    ],
  }),
  "fix-damagedbonus": battler("fix-damagedbonus", {
    name: "Talonflame",
    hp: 60,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Fiery Breeze",
        damage: 30,
        effect: "If this Pokémon has any damage counters on it, this attack does 90 more damage.",
      },
    ],
  }),
  "fix-oppotool": battler("fix-oppotool", {
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Tool Reader",
        damage: 10,
        effect:
          "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
      },
    ],
  }),
  "fix-benchtype": battler("fix-benchtype", {
    hp: 120,
    types: ["Metal"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Alloy Rally",
        damage: 10,
        effect: "If you have any {M} Pokémon on your Bench, this attack does 80 more damage.",
      },
    ],
  }),
  "fix-metalbody": battler("fix-metalbody", { hp: 60, types: ["Metal"] }),
  "fix-dualbody": battler("fix-dualbody", { hp: 60, types: ["Water", "Metal"] }),
  "fix-fairybody": battler("fix-fairybody", { hp: 60, types: ["Fairy"] }),
  "fix-oppresist": battler("fix-oppresist", {
    hp: 120,
    types: ["Metal"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Counter Read",
        damage: 10,
        effect:
          "If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage.",
      },
    ],
  }),
  "fix-oppresist-f": battler("fix-oppresist-f", {
    hp: 120,
    types: ["Fighting"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Counter Read",
        damage: 10,
        effect:
          "If your opponent's Active Pokémon has {F} Resistance, this attack does 50 more damage.",
      },
    ],
  }),
  "fix-fightresist": battler("fix-fightresist", {
    hp: 200,
    resistances: [{ type: "Fighting", value: "-30" }],
  }),
  "fix-grassresist": battler("fix-grassresist", {
    hp: 200,
    resistances: [{ type: "Grass", value: "-30" }],
  }),
  "fix-dualresist": battler("fix-dualresist", {
    hp: 200,
    resistances: [{ type: "Grass", value: "-30" }, { type: "Fighting" }],
  }),
  "fix-fightweak": battler("fix-fightweak", {
    hp: 200,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    resistances: null,
  }),
  "fix-sameenergy": battler("fix-sameenergy", {
    hp: 150,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Even Match",
        damage: 10,
        effect:
          "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.",
      },
    ],
  }),
  "fix-sameenergy-120": battler("fix-sameenergy-120", {
    hp: 150,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Even Match",
        damage: 10,
        effect:
          "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 120 more damage.",
      },
    ],
  }),
  "fix-moreenergy": battler("fix-moreenergy", {
    hp: 150,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Devouring Mouth",
        damage: 10,
        effect:
          "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.",
      },
    ],
  }),
  "fix-energyholder": battler("fix-energyholder", { hp: 200 }),
  "fix-benchall": battler("fix-benchall", {
    hp: 150,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Raging Cannon",
        damage: 10,
        effect:
          "If all of your Benched Pokémon have at least 1 damage counter on them, this attack does 120 more damage.",
      },
    ],
  }),
  "fix-typeshare": battler("fix-typeshare", {
    hp: 150,
    types: ["Fairy"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Love Resonance",
        damage: 10,
        effect:
          "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, this attack does 120 more damage.",
      },
    ],
  }),
  "fix-bigfairy": battler("fix-bigfairy", { hp: 200, types: ["Fairy"] }),
  "fix-triocheehoo": battler("fix-triocheehoo", {
    hp: 110,
    types: ["Metal"],
    attacks: [
      {
        name: "Trio-Cheehoo",
        damage: 120,
        effect: "If you don't have exactly 3 cards in your hand, this attack does nothing.",
      },
    ],
  }),
  "fix-mountaindrop": battler("fix-mountaindrop", {
    hp: 150,
    types: ["Fighting"],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Mountain Drop",
        damage: "70+",
        effect: "If a Stadium is in play, this attack does 70 more damage.",
      },
    ],
  }),
  "fix-assaultland": battler("fix-assaultland", {
    hp: 150,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Assault Landing",
        damage: 70,
        effect: "If there is no Stadium in play, this attack does nothing.",
      },
    ],
  }),
  "fix-blazedestruct": battler("fix-blazedestruct", {
    hp: 150,
    types: ["Fighting"],
    attacks: [{ name: "Blazing Destruction", effect: "Discard a Stadium in play." }],
  }),
  "fix-knockover": battler("fix-knockover", {
    hp: 150,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Knock Over",
        damage: 30,
        effect: "You may discard a Stadium in play.",
      },
    ],
  }),
  "fix-crushpress": battler("fix-crushpress", {
    name: "Fixceti ex",
    hp: 300,
    types: ["Water"],
    attacks: [
      {
        cost: ["Water", "Water", "Water", "Colorless"],
        name: "Crushing Press",
        damage: "140+",
        effect: "You may discard a Stadium in play. If you do, this attack does 140 more damage.",
      },
    ],
  }),
  "fix-torrent": battler("fix-torrent", {
    name: "Fixgerpon ex",
    hp: 210,
    types: ["Water"],
    attacks: [
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Torrential Pump",
        damage: 100,
        effect:
          "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  "fix-purging": battler("fix-purging", {
    name: "Fixluza ex",
    hp: 210,
    types: ["Water"],
    attacks: [
      {
        cost: ["Water", "Water", "Colorless"],
        name: "Purging Strike",
        damage: "120+",
        effect:
          "You may discard your hand. If you discarded any cards in this way, this attack does 120 more damage.",
      },
    ],
  }),
  "fix-spirited": battler("fix-spirited", {
    name: "Fixaldean Tauros",
    hp: 130,
    types: ["Fire"],
    attacks: [
      { cost: ["Fire"], name: "Rear Kick", damage: 30 },
      {
        cost: ["Fire", "Colorless", "Colorless"],
        name: "Spirited Tackle",
        damage: "90+",
        effect:
          "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
      },
    ],
  }),
  "fix-stage1-big": {
    ...blank,
    id: "fix-stage1-big",
    name: "fix-stage1-big",
    category: "Pokemon",
    stage: "Stage1",
    hp: 220,
    types: ["Colorless"],
    retreat: 2,
    evolveFrom: "fix-bigbody",
  },
  "fix-vstar-big": {
    ...blank,
    id: "fix-vstar-big",
    name: "fix-vstar-big",
    category: "Pokemon",
    stage: "VSTAR",
    hp: 260,
    types: ["Colorless"],
    retreat: 2,
    evolveFrom: "fix-bigbody",
  },
  "fix-aerochase": {
    ...blank,
    id: "fix-aerochase",
    name: "Fixalonflame",
    category: "Pokemon",
    stage: "Stage2",
    evolveFrom: "Fletchinder",
    hp: 140,
    types: ["Colorless"],
    retreat: 0,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Aero Chase",
        damage: "110+",
        effect:
          "If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage.",
      },
    ],
  },
  "fix-retreat1-titan": battler("fix-retreat1-titan", { hp: 340, retreat: 1 }),
  "fix-retreat2-titan": battler("fix-retreat2-titan", { hp: 340, retreat: 2 }),
  "fix-retreat3-titan": battler("fix-retreat3-titan", { hp: 340, retreat: 3 }),
  "fix-retreat0-titan": battler("fix-retreat0-titan", { hp: 340, retreat: 0 }),
  "fix-retreatless": {
    ...blank,
    id: "fix-retreatless",
    name: "Fixanchor",
    category: "Pokemon",
    stage: "Basic",
    hp: 340,
    types: ["Colorless"],
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Anchor Drag",
        damage: "200-",
        effect:
          "This attack does 30 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      },
      {
        cost: ["Colorless"],
        name: "Chain Slam",
        damage: "150-",
        effect:
          "This attack does 50 less damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      },
      { cost: ["Colorless"], name: "Blunt Tackle", damage: 90 },
      {
        cost: ["Colorless"],
        name: "Hook Toss",
        damage: 90,
        effect:
          "This attack does 30 less damage for each {C} in the Retreat Cost of your opponent's Active Pokémon.",
      },
    ],
  } satisfies Card,
  "fix-deletingslash": {
    ...blank,
    id: "fix-deletingslash",
    name: "Fixiron Crown",
    category: "Pokemon",
    stage: "Basic",
    hp: 130,
    types: ["Metal"],
    retreat: 2,
    attacks: [
      {
        cost: ["Metal", "Colorless"],
        name: "Deleting Slash",
        damage: "40+",
        effect: "If your opponent has 3 or more Benched Pokémon, this attack does 80 more damage.",
      },
      { cost: ["Metal", "Colorless", "Colorless"], name: "Slicing Blade", damage: 100 },
    ],
  },
  "fix-shortcircuit": {
    ...blank,
    id: "fix-shortcircuit",
    name: "Fixlectivire",
    category: "Pokemon",
    stage: "Stage1",
    evolveFrom: "Electabuzz",
    hp: 140,
    types: ["Lightning"],
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Short-Circuit Knuckle",
        damage: "40+",
        effect: "If your opponent has any {W} Pokémon in play, this attack does 120 more damage.",
      },
      {
        cost: ["Lightning", "Lightning", "Colorless", "Colorless"],
        name: "Electroslug",
        damage: 140,
      },
    ],
  },
  "fix-waterbody": battler("fix-waterbody", { hp: 60, types: ["Water"] }),
  "fix-inplaydual": battler("fix-inplaydual", { hp: 60, types: ["Fire", "Water"] }),
  "fix-frozenwood": {
    ...blank,
    id: "fix-frozenwood",
    name: "Fixomasnow",
    category: "Pokemon",
    stage: "Stage1",
    evolveFrom: "Snover",
    hp: 150,
    types: ["Water"],
    retreat: 4,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Lunge Out", damage: 90 },
      {
        cost: ["Water", "Water", "Water", "Colorless"],
        name: "Frozen Wood",
        damage: "120+",
        effect:
          "If this Pokémon has 2 or more {G} Energy attached, this attack does 120 more damage.",
      },
    ],
  },
  "fix-grassdouble": specialEnergy("fix-grassdouble", "fix-grassdouble"),
  "fix-powerpress": battler("fix-powerpress", {
    name: "Fixellicent",
    hp: 180,
    types: ["Psychic"],
    retreat: 2,
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Power Press",
        damage: "20+",
        effect:
          "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
      },
    ],
  }),
  "fix-highvoltage": battler("fix-highvoltage", {
    name: "Fixectivire",
    hp: 180,
    types: ["Lightning"],
    retreat: 2,
    attacks: [
      {
        cost: ["Lightning", "Lightning", "Colorless"],
        name: "High-Voltage Press",
        damage: "20+",
        effect:
          "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 100 more damage.",
      },
    ],
  }),
  "fix-extraprobe": battler("fix-extraprobe", {
    name: "Fixtra Probe",
    hp: 180,
    types: ["Colorless"],
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Surplus Press",
        damage: "20+",
        effect:
          "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack does 80 more damage.",
      },
    ],
  }),
  "fix-filteredsnipe": battler("fix-filteredsnipe", {
    name: "Fixquilla",
    hp: 140,
    types: ["Fire"],
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Picky Barrage",
        damage: "30",
        effect:
          "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Blunt Barrage",
        damage: "30",
        effect:
          "This attack also does 60 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Idle Barrage",
        damage: "30",
        effect:
          "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
      },
    ],
  }),
  "fix-lively": battler("fix-lively", {
    name: "Fixactus",
    hp: 100,
    types: ["Grass"],
    attacks: [
      {
        cost: ["Grass"],
        name: "Lively Needles",
        damage: "20+",
        effect: "If this Pokémon was healed during this turn, this attack does 100 more damage.",
      },
    ],
  }),
  "fix-groundmelter": battler("fix-groundmelter", {
    hp: 150,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Fire", "Colorless"],
        name: "Ground Melter",
        damage: "60+",
        effect:
          "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.",
      },
    ],
  }),
  "fix-roastheat": battler("fix-roastheat", {
    hp: 150,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Fire"],
        name: "Roasting Heat",
        damage: "10+",
        effect: "If your opponent's Active Pokémon is Burned, this attack does 40 more damage.",
      },
    ],
  }),
  "fix-mindcrush": battler("fix-mindcrush", {
    hp: 150,
    types: ["Psychic"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Perplex",
        damage: 20,
        effect: "Your opponent's Active Pokémon is now Confused.",
      },
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Mental Crush",
        damage: "90+",
        effect: "If your opponent's Active Pokémon is Confused, this attack does 90 more damage.",
      },
    ],
  }),
  "fix-charbreath": battler("fix-charbreath", {
    hp: 150,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Fire"],
        name: "Singe",
        effect: "Your opponent's Active Pokémon is now Burned.",
      },
      {
        cost: ["Fire", "Fire"],
        name: "Charring Breath",
        damage: 180,
        effect: "If your opponent's Active Pokémon isn't Burned, this attack does nothing.",
      },
    ],
  }),
  "fix-emberpillar": battler("fix-emberpillar", {
    hp: 150,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Incendiary Pillar",
        damage: 10,
        effect:
          "If you have 10 or more Basic {R} Energy cards in your discard pile, this attack does 100 more damage.",
      },
    ],
  }),
  "fix-trbonus": battler("fix-trbonus", {
    hp: 150,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Wicked Thunder",
        damage: 10,
        effect:
          "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.",
      },
    ],
  }),
  "fix-exonly": battler("fix-exonly", {
    hp: 120,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Ex Crusher",
        damage: 10,
        effect:
          "If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage.",
      },
      {
        cost: ["Colorless"],
        name: "Fully Singe",
        effect: "Discard an Energy from your opponent's Active Pokémon ex.",
      },
    ],
  }),
  "fix-gougingfire": battler("fix-gougingfire", {
    name: "fix-gougingfire ex",
    types: ["Fire"],
    stage: "Basic",
    hp: 230,
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      { cost: ["Fire", "Colorless"], name: "Heat Blast", damage: 60 },
      {
        cost: ["Fire", "Fire", "Colorless"],
        name: "Blaze Blitz",
        damage: 260,
        effect: "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot.",
      },
    ],
  }),
  "fix-gouging-stage1": {
    ...blank,
    id: "fix-gouging-stage1",
    name: "fix-gouging-stage1",
    category: "Pokemon",
    stage: "Stage1",
    hp: 260,
    types: ["Fire"],
    retreat: 2,
    evolveFrom: "fix-gougingfire ex",
    attacks: [{ cost: ["Fire"], name: "Ember Wake", damage: 50 }],
  } satisfies Card,

  "fix-glalie": battler("fix-glalie", {
    name: "fix-glalie",
    types: ["Water"],
    stage: "Stage1",
    evolveFrom: "Snorunt",
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      {
        cost: ["Water"],
        name: "Damage Beat",
        effect:
          "This attack does 20 damage for each damage counter on your opponent's Active Pokémon.",
        damage: "20×",
      },
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Crazy Headbutt",
        effect: "Discard an Energy from this Pokémon.",
        damage: 140,
      },
    ],
  }),

  "fix-flapple": battler("fix-flapple", {
    name: "fix-flapple",
    types: ["Dragon"],
    stage: "Stage1",
    evolveFrom: "Applin",
    hp: 80,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Acidic Spit",
        effect:
          "This attack does 20 damage for each damage counter on your opponent's Active Pokémon.",
        damage: "20×",
      },
      { cost: ["Grass", "Fire"], name: "Speed Dive", damage: 70 },
    ],
  }),

  "fix-oxford": battler("fix-oxford", {
    name: "fix-oxford",
    types: ["Psychic"],
    hp: 130,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Triple Bloom",
        effect: "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.",
        damage: 50,
      },
      {
        cost: ["Colorless"],
        name: "Bare Bloom",
        effect: "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.",
      },
      {
        cost: ["Colorless"],
        name: "Comma Bloom",
        effect:
          "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.",
        damage: 10,
      },
    ],
  }),

  "fix-recoil-scale": battler("fix-recoil-scale", {
    name: "fix-recoil-scale",
    types: ["Fighting"],
    hp: 200,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Counter Toll",
        effect: "This Pokémon also does 10 damage to itself for each damage counter on it.",
        damage: 20,
      },
      {
        cost: ["Colorless"],
        name: "Flat Toll",
        effect: "This Pokémon also does 10 damage to itself.",
        damage: 20,
      },
    ],
  }),

  "fix-ninetales": battler("fix-ninetales", {
    name: "fix-ninetales",
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Vulpix",
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire", "Fire"],
        name: "Eerie Glow",
        effect: "Your opponent's Active Pokémon is now Burned and Confused.",
        damage: 90,
      },
    ],
  }),

  /** Team Rocket's Houndoom `sv10-038` — the SAME sentence on a second body, and
      the one that prints NO damage. Its index 1 is a shipped `discardEnergy`
      sentence, so the card also offers a non-status attack on the same body. */
  "fix-tr-houndoom": battler("fix-tr-houndoom", {
    name: "fix-tr-houndoom",
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Team Rocket's Houndour",
    hp: 130,
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Fire"],
        name: "Cruel Coal",
        effect: "Your opponent's Active Pokémon is now Burned and Confused.",
      },
      {
        cost: ["Fire", "Colorless"],
        name: "Scorching Fire",
        effect: "Discard an Energy from this Pokémon.",
        damage: 120,
      },
    ],
  }),

  /** Ekans `sv05-100` — the coin-flipped pair at Confused+Poisoned. Index 1 "Bite"
      carries NO `effect` key at all, which is the control for "the flip arm did not
      claim a sentence that has none". */
  "fix-ekans": battler("fix-ekans", {
    name: "fix-ekans",
    types: ["Darkness"],
    stage: "Basic",
    hp: 60,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Darkness"],
        name: "Poison Blend",
        effect:
          "Flip a coin. If heads, your opponent's Active Pokémon is now Confused and Poisoned.",
      },
      { cost: ["Darkness", "Darkness"], name: "Bite", damage: 30 },
    ],
  }),

  "fix-glimmora": battler("fix-glimmora", {
    name: "fix-glimmora",
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "Glimmet",
    hp: 130,
    retreat: 3,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Stun Poison",
        effect:
          "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned.",
      },
      {
        cost: ["Fighting"],
        name: "Venoshock",
        effect: "If your opponent's Active Pokémon is Poisoned, this attack does 100 more damage.",
        damage: "30+",
      },
    ],
  }),

  "fix-accelgor": battler("fix-accelgor", {
    name: "fix-accelgor",
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Shelmet",
    hp: 100,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      {
        cost: ["Grass", "Colorless"],
        name: "Poisonous Ploy",
        effect:
          "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.",
        damage: 70,
      },
    ],
  }),

  "fix-tremor": battler("fix-tremor", {
    name: "fix-tremor",
    types: ["Fighting"],
    stage: "Basic",
    hp: 140,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Home Tremor",
        effect:
          "This attack also does 10 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 30,
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Away Tremor",
        effect:
          "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 30,
      },
    ],
  }),
  "fix-pinpoint": battler("fix-pinpoint", {
    name: "fix-pinpoint",
    types: ["Fighting"],
    stage: "Basic",
    hp: 140,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Home Pinpoint",
        effect:
          "This attack also does 10 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 30,
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Heavy Pinpoint",
        effect:
          "This attack also does 40 damage to 1 of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 30,
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Bare Pinpoint",
        effect:
          "This attack does 40 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        damage: 30,
      },
    ],
  }),
  "fix-scaledsnipe": battler("fix-scaledsnipe", {
    name: "fix-scaledsnipe",
    types: ["Lightning"],
    stage: "Basic",
    hp: 140,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Charged Arrow",
        effect:
          "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Heavy Charged Arrow",
        effect:
          "This attack does 30 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Plain Arrow",
        effect:
          "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      {
        cost: ["Colorless"],
        name: "Impossible Arrow",
        effect:
          "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. This attack's damage isn't affected by Weakness or Resistance.",
      },
    ],
  }),
  "fix-counterput": battler("fix-counterput", {
    name: "fix-counterput",
    types: ["Lightning"],
    stage: "Basic",
    hp: 140,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Grudge Placement",
        effect: "Put 2 damage counters on 1 of your opponent's Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Twin Grudge",
        effect: "Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.",
      },
      {
        cost: ["Colorless"],
        name: "Grudge Bolt",
        effect:
          "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  "fix-counterfold": battler("fix-counterfold", {
    name: "fix-counterfold",
    types: ["Lightning"],
    stage: "Basic",
    hp: 140,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Ability Blight",
        effect:
          "Put 6 damage counters on each Pokémon that has an Ability (both yours and your opponent's).",
      },
      {
        cost: ["Colorless"],
        name: "Board Blight",
        effect: "Put 2 damage counters on each of your opponent's Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Wounded Blight",
        effect:
          "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.",
      },
      { cost: ["Colorless"], name: "Plain Bolt", damage: 20 },
    ],
  }),
  "fix-hptarget": battler("fix-hptarget", {
    name: "fix-hptarget",
    types: ["Lightning"],
    stage: "Basic",
    hp: 140,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Bench Sap",
        effect:
          "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.",
      },
      {
        cost: ["Colorless"],
        name: "Deep Sap",
        effect:
          "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
      },
      {
        cost: ["Colorless"],
        name: "Shallow Sap",
        effect:
          "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      },
      { cost: ["Colorless"], name: "Plain Bolt", damage: 20 },
    ],
  }),
  "fix-idlebody": battler("fix-idlebody", {
    name: "fix-idlebody",
    types: ["Colorless"],
    stage: "Basic",
    hp: 200,
    retreat: 1,
    abilities: [{ type: "Ability", name: "D450 Idle", effect: "This Ability does nothing." }],
  }),
  "fix-suction": battler("fix-suction", {
    name: "Fixmoth",
    types: ["Fire"],
    hp: 200,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Suction",
        damage: 50,
        effect:
          "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Deep Suction",
        damage: 200,
        effect:
          "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Dry Suction",
        effect:
          "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Loud Suction",
        damage: 50,
        effect: "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
      },
    ],
  }),
  "fix-prizewheel": battler("fix-prizewheel", {
    name: "Fixwheel",
    types: ["Colorless"],
    hp: 200,
    retreat: 0,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Prize Drain",
        damage: 30,
        effect: "Discard all Energy from this Pokémon, and take a Prize card.",
      },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Deep Drain",
        damage: 130,
        effect: "Discard all Energy from this Pokémon, and take a Prize card.",
      },
      {
        cost: ["Colorless"],
        name: "Dry Drain",
        effect: "Discard all Energy from this Pokémon, and take a Prize card.",
      },
      {
        cost: ["Colorless"],
        name: "Idle Drain",
        damage: 10,
        effect: "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Pick Drain",
        damage: 10,
        effect: "Discard an Energy from this Pokémon.",
      },
    ],
  }),
  "fix-drainwall": battler("fix-drainwall", { hp: 300 }),
  "fix-drainweak": battler("fix-drainweak", {
    hp: 300,
    weaknesses: [{ type: "Fire", value: "×2" }],
  }),
  "fix-toolstrip": battler("fix-toolstrip", {
    name: "Fixlefki",
    types: ["Psychic"],
    hp: 200,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Pry Off",
        damage: 100,
        effect:
          "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.",
      },
      { cost: ["Colorless", "Colorless"], name: "Plain Swipe", damage: 100 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Pry Through",
        damage: 120,
        effect:
          "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.",
      },
      { cost: ["Colorless", "Colorless"], name: "Plain Through", damage: 120 },
      {
        cost: ["Colorless"],
        name: "Odd Job",
        damage: 10,
        effect: "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
      },
    ],
  }),
  "fix-chestwall": battler("fix-chestwall", { types: ["Fighting"], hp: 300 }),
  "fix-charmwall": battler("fix-charmwall", { hp: 100 }),
  "fix-preseam": battler("fix-preseam", {
    name: "Fixseam",
    types: ["Psychic"],
    hp: 200,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Purge Off",
        damage: 100,
        effect:
          "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Pry Off",
        damage: 100,
        effect:
          "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Shed Gear",
        damage: 100,
        effect:
          "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing.",
      },
      {
        cost: ["Colorless", "Colorless"],
        name: "Lock Off",
        damage: 100,
        effect:
          "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon. If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed.",
      },
      { cost: ["Colorless", "Colorless"], name: "Plain Blow", damage: 100 },
      {
        cost: ["Colorless"],
        name: "Odd Job",
        damage: 10,
        effect: "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
      },
    ],
  }),
  "fix-seamwall": battler("fix-seamwall", { types: ["Fighting"], hp: 300 }),
  "fix-nowk": battler("fix-nowk", {
    types: ["Water"],
    hp: 220,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless"],
        name: "Type Veil",
        damage: 10,
        effect: "During your opponent's next turn, this Pokémon has no Weakness.",
      },
      { cost: ["Colorless"], name: "Plain Veil", damage: 10 },
      {
        cost: ["Colorless"],
        name: "Copy Veil",
        damage: 10,
        effect:
          "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
      },
    ],
  }),
  "fix-tideattach": battler("fix-tideattach", {
    types: ["Water"],
    hp: 200,
    retreat: 1,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Tide Surge",
        damage: "30×",
        effect:
          "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.",
      },
      {
        cost: ["Colorless"],
        name: "Tide Mark",
        damage: 10,
        effect:
          "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)",
      },
    ],
  }),
  "fix-nowk-stage1": {
    ...blank,
    id: "fix-nowk-stage1",
    name: "fix-nowk-stage1",
    category: "Pokemon",
    stage: "Stage1",
    hp: 220,
    types: ["Water"],
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    evolveFrom: "fix-nowk",
    attacks: [{ cost: ["Colorless"], name: "Ripple", damage: 20 }],
  } satisfies Card,
  "fix-bolt": battler("fix-bolt", {
    types: ["Lightning"],
    hp: 130,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [{ cost: ["Colorless"], name: "Bolt", damage: 50 }],
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

export const PRE_DAMAGE_TOOL_DECK = deckOf({
  "fix-toolstrip": 4,
  "sv01-096": 2,
  "fix-chestwall": 4, // {F}, 300 HP — Rock Chestplate's holder
  "fix-charmwall": 4, // Basic, 100 HP — Bravery Charm's holder
  "sv01-192": 4, // Rock Chestplate (Tool) — 30 less after W/R on an {F} holder
  "sv02-173": 4, // Bravery Charm (Tool) — +50 HP on a Basic holder
  "sv01-197": 2, // Vitality Band (Tool) — an ATTACKER-side bonus: the null-effect control
  "fix-titan": 8, // 340 HP, no attacks — filler and the no-Tool control defender
  "fix-energy": 28, // Colorless Basic — every cost on this list
});

export const PRE_DAMAGE_FAMILY_DECK = deckOf({
  "fix-preseam": 6,
  "fix-seamwall": 6, // {F}, 300 HP — wears Tool + Special Energy + Basic at once
  "sv01-192": 4, // Rock Chestplate (Tool) — 30 less after W/R on an {F} holder
  "sv01-197": 4,
  "sv01-193": 4, // Rocky Helmet (Tool) — 20 counters back on the attacker, on the DEFENDER
  "sv02-193": 2, // Therapeutic Energy (Special) — the §12 Paralysis immunity control
  "fix-mist-energy": 2, // Mist Energy (Special) — the §11 "prevent all effects" control
  "fix-titan": 4, // 340 HP, no attacks — filler and the bare defender
  "fix-energy": 28, // Colorless Basic — every cost here, and the class control
});

export const SELF_HEAL_DEALT_DECK = deckOf({
  "fix-suction": 4, // the attacker — indices 0 (50), 1 (200), 2 (no damage)
  "fix-drainwall": 4, // 300 HP, no W/R — the dealt-50 control
  "fix-drainweak": 4, // 300 HP ×2 Fire — the dealt-100 board
  "sv02-113": 3, // Hariyama — seat-wide −10 after W/R: the dealt-40 board
  "fix-imperviousshell": 3, // 340 HP, prevents ≥200 — the dealt-0 board
  "fix-wall": 4, // 120 HP, no attacks — the body a 200 Knocks Out
  "fix-titan": 12, // 340 HP neutral Basic, NO attacks — filler and clean defender
  "fix-energy": 26, // Colorless Basic — every {C} slot on this list
});

export const CROSS_SEAT_DISCARD_DECK = deckOf({
  "fix-crossseatdiscard": 4,
  "fix-bigbody": 4, // 200 HP — survives everything, so no KO tail interferes
  "fix-basic-1": 4, // a second body for the opponent's Bench
  "fix-basic-2": 4,
  "fix-special": 4,
  "fix-special-2": 4,
  "fix-fire-energy": 6,
  "fix-fire-energy-alt": 4,
  "fix-water-energy": 4,
  "fix-energy": 18,
  "sv02-191": 4, // Luminous — provides every type while it is alone
});

export const EX_ONLY_DECK = deckOf({
  "fix-exonly": 4,
  "fix-bigbody": 8,
  "fix-pokemon-v": 4,
  "fix-pokemon-vmax": 2,
  "sv06.5-036": 4,
  "fix-special": 4,
  "fix-energy": 34,
});

export const OPPONENT_TOOL_DECK = deckOf({
  "fix-oppotool": 4,
  "sv01-152": 4,
  "fix-tool": 4,
  "sv01-197": 4,
  "fix-benchfiller": 4,
  "fix-bigbody": 12,
  "fix-energy": 28,
});

export const BENCH_TYPE_DECK = deckOf({
  "fix-benchtype": 4,
  "fix-metalbody": 4,
  "fix-dualbody": 4,
  "fix-fairybody": 4,
  "fix-benchfiller": 4,
  "fix-bigbody": 12,
  "fix-energy": 28,
});

export const OPPONENT_RESISTANCE_DECK = deckOf({
  "fix-oppresist": 4,
  "fix-oppresist-f": 4,
  "fix-fightresist": 8,
  "fix-grassresist": 4,
  "fix-dualresist": 4,
  "fix-fightweak": 4,
  "fix-bigbody": 8,
  "fix-energy": 24,
});

export const SAME_ENERGY_DECK = deckOf({
  "fix-sameenergy": 4,
  "fix-sameenergy-120": 4,
  "fix-energyholder": 8,
  "fix-basic-1": 8,
  "fix-blend": 8,
  "fix-energy": 28,
});

export const MORE_ENERGY_DECK = deckOf({
  "fix-moreenergy": 4,
  "fix-energyholder": 8,
  "fix-basic-1": 8,
  "fix-blend": 8,
  "fix-energy": 32,
});

export const BENCH_ALL_DAMAGED_DECK = deckOf({
  "fix-benchall": 4,
  "fix-basic-1": 24,
  "fix-bigbody": 8,
  "fix-energy": 24,
});

export const TYPE_SHARE_DECK = deckOf({
  "fix-typeshare": 4,
  "fix-bigfairy": 8,
  "fix-fairybody": 8,
  "fix-dualbody": 8,
  "fix-water-basic": 4,
  "fix-metalbody": 4,
  "fix-benchfiller": 4,
  "fix-bigbody": 8,
  "fix-energy": 12,
});

export const EXACT_HAND_SIZE_DECK = deckOf({
  "fix-triocheehoo": 4, // Alolan Dugtrio — "Trio-Cheehoo" (120, no cost): yourHandExactly 3, the CANCEL
  "sv03-135": 4, // Absol ex — "Cursed Slug" (100+): opponentHandAtMost 3, the WRONG-SEAT near miss
  "fix-energy": 6, // Basic {C} — the ordinary attachment the organic case spends
  "fix-dark-energy": 6, // Basic {D} — pays Cursed Slug's three typed symbols
  "fix-bigbody": 40, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the clean defender, the shed
});

export const STADIUM_DISCARD_DECK = deckOf({
  "fix-blazedestruct": 4, // Hisuian Growlithe — "Blazing Destruction" (free, no damage): the bare op
  "fix-knockover": 4, // Wooloo/Dubwool — "Knock Over" (30): the same op behind "You may"
  "sv01-167": 6, // Beach Court — the Stadium, played from EITHER seat and then discarded
  "fix-energy": 8, // Basic {C} — pays Knock Over's two Colorless symbols
  "fix-bigbody": 38, // 200 HP neutral Basic, retreat 1 — starter, both Actives, the clean defender
});

export const OPTIONAL_COST_BOOST_DECK = deckOf({
  "fix-crushpress": 4, // Cetitan ex — "Crushing Press" ({W}{W}{W}{C}, 140+)
  "sv01-167": 6, // Beach Court — the NEUTRAL Stadium, played from EITHER seat
  "sv06.5-060": 6, // Neutralization Zone — the Stadium that makes the ORDER observable
  "fix-water-energy": 6, // {W}{W}{W} of Crushing Press's cost
  "fix-energy": 4, // the one {C} of it
  "fix-titan": 4, // 340 HP, no attacks, no Rule Box — the defender that survives 280
  "fix-bigbody": 30, // 200 HP neutral Basic — mulligan-free starter and bench filler
});

export const PURGING_STRIKE_DECK = deckOf({
  "fix-purging": 4, // Veluza ex — "Purging Strike" ({W}{W}{C}, 120+)
  "fix-titan": 4, // 340 HP, no attacks — the defender that survives the boosted 240
  "fix-water-energy": 6, // {W}{W} of Purging Strike's cost
  "fix-energy": 4, // the one {C} of it
  "fix-bigbody": 42, // 200 HP neutral Basic — mulligan-free starter and bench filler
});

export const HEALED_THIS_TURN_DECK = deckOf({
  "fix-lively": 4, // Maractus — "Lively Needles" ({G}, 20+): the healed-this-turn bonus
  "sv01-188": 6, // Potion — heal 30 from 1 of your Pokémon (`healChosen`)
  "sv01-184": 4, // Picnic Basket — heal 30 from EVERY Pokémon, both boards (`healEachAll`)
  "fix-grass-energy": 6, // the one {G} of Lively Needles
  "fix-bigbody": 40, // 200 HP neutral Basic — starter, bench filler, and the defender
});

export const STAGE1_BONUS_DECK = deckOf({
  "fix-spirited": 4, // Paldean Tauros — "Spirited Tackle" ({R}{C}{C}, 90+): the +90
  "fix-bigbody": 8, // 200 HP neutral BASIC — starter, bench filler, the FALSE arm, the evolve base
  "fix-stage1-big": 4, // 220 HP STAGE 1 — the TRUE arm, and it evolves from fix-bigbody
  "fix-stage2": 4, // 140 HP STAGE 2 — an Evolution that is not a Stage 1
  "fix-vstar-big": 4, // 260 HP VSTAR — an Evolution that is neither Basic, Stage 1 nor Stage 2
  "fix-fire-energy": 12, // Basic {R} — the one typed symbol of Spirited Tackle
  "fix-energy": 24, // Basic {C} — the two Colorless symbols
});

export const RETREAT_COST_BONUS_DECK = deckOf({
  "fix-aerochase": 4, // Talonflame — "Aero Chase" ({C}{C}, 110+): the +110
  "fix-retreat1-titan": 6, // 340 HP, printed {C} — FALSE bare, TRUE under either ADDITIVE term
  "fix-retreat2-titan": 6, // 340 HP, printed {C}{C} — TRUE bare (the threshold exactly), FALSE under Beach Court
  "sv02-175": 4, // Calamitous Wasteland — the Stadium term (+1 on Basic non-{F})
  "sv01-019": 4, // Spidops ex — the AURA term (+1 across the table, from the Bench)
  "sv01-167": 4, // Beach Court — the SUBTRACTIVE term (-1 on Basic), the mirror
  "fix-energy": 12, // Basic {C} — the two Colorless symbols of Aero Chase
  "fix-titan": 20, // 340 HP neutral Basic, NO attacks — DOMINANT starter and bench filler
});

export const OPPONENT_BENCH_COUNT_DECK = deckOf({
  "fix-deletingslash": 4, // Iron Crown — "Deleting Slash" ({M}{C}, 40+): the +80
  "fix-benchfiller": 12, // 60 HP — the countable body, enough for a full Bench on both seats
  "fix-bigbody": 8, // 200 HP — survives the boosted 120, so no KO tail interferes
  "fix-metal-energy": 8, // Basic {M} — the first symbol of Deleting Slash
  "fix-energy": 28, // Basic {C} — the second
});

export const IN_PLAY_BODIES_DECK = deckOf({
  "fix-inplaybodies": 4, // the EIGHT-attack holder: any / Basic / TR's / {G} / Evolution / Round / their ex / their ex+V
  "fix-grass-stage1": 4, // Grass AND Evolution — the body two filters share
  "fix-stage1": 4, // Colorless Evolution — the Evolution that is not Grass
  "fix-grass-basic": 4, // Grass Basic — the Grass that is not an Evolution
  "fix-benchfiller": 4, // Colorless Basic — matches only `anyPokemon` / `basicPokemon`, and carries NO attacks
  "fix-tr-stage1": 4, // "Team Rocket's Persian" — the second prefixed body
  "fix-titan": 8,
  "fix-roundbody": 4, // attack NAMED "Round" — the `attackNamePokemon` positive
  "fix-attacker-ex": 4, // "Fixmon ex" — the suffix positive AND the has-attacks near-miss
  "fix-pokemon-v": 4, // "Fixmon V" — in for the pair, out for the bare ex
  "fix-pokemon-vmax": 4,
  "fix-stage2body": 4, // Stage 2 AND an Evolution — the ordinal that is not `evolutionPokemon`
  "fix-energy": 8, // Basic {C} — the one printed symbol of all nine attacks
});

export const BENCH_NOUN_DECK = deckOf({
  "fix-benchnoun": 4, // the attacker — two attacks, one per counting axis
  "fix-fighting-1": 4, // {F} Basic — the counter filter's positive
  "fix-benchfiller": 4, // Colorless Basic, no attacks — the counter filter's negative
  "fix-charjabug": 4, // "Charjabug", a STAGE 1 — the `byName` positive
  "fix-duskull": 4, // "Duskull", a BASIC — the `byName` negative
  "fix-stage1": 4, // Colorless Evolution — the Evolution that is NOT a Charjabug
  "fix-titan": 8, // 340 HP, no attacks — the opener and the defender
  "fix-energy": 28, // Basic {C} — the one printed symbol of both attacks
});

export const DISCARD_PILE_COUNT_DECK = deckOf({
  "fix-discardpile": 4, // the four-attack holder: your Energy / your Ethan's Adventure / their Basic Energy / their Items
  "fix-titan": 12, // 340 HP, no attacks — the defender, the only opener, and the pile's non-card-class control
  "fix-energy": 10, // Basic {C} Energy — the printed cost, and `anyEnergy` + `basicEnergy` in the pile
  "fix-fire-energy": 8, // Basic {R} Energy — the UNTYPED-`basicEnergy` control
  "fix-special": 8, // SPECIAL Energy — `anyEnergy` YES, `basicEnergy` NO (the printed word "Basic")
  "fix-item": 8, // Item Trainer — `item` YES, and NOT a Pokémon Tool
  "fix-ethansadv": 5, // the Supporter NAMED "Ethan's Adventure" — `byName` YES
  "fix-ethansadventure": 5, // a Supporter named otherwise — `byName` NO, `supporter` YES
});

export const PILE_ATTACK_NAME_DECK = deckOf({
  "fix-pilewings": 4, // the holder of the one printed sentence
  "fix-wingsbody": 12, // attack NAMED "United Wings" — the positive, in both piles and in play
  "fix-roundbody": 8, // attack NAMED "Round" — the NAME near-miss
  "fix-attacker-ex": 6, // has attacks, none of them named — the `attacksOf().length > 0` control
  "fix-benchfiller": 6, // a Pokémon with NO attacks — the other negative
  "fix-item": 6, // an Item Trainer — `attacksOf` is null, and the pile-LENGTH control
  "fix-titan": 10, // 340 HP, no attacks — the defender, the opener, the third negative
  "fix-energy": 8, // Basic {C} — the one printed symbol of the one attack
});

export const PILE_NAME_FRAGMENT_DECK = deckOf({
  "fix-pilerocket": 4, // the holder of the one printed sentence
  "fix-trsupporter": 14, // Supporter, fragment at offset 0 — the positive, in BOTH piles
  "fix-trgrunt": 8, // Supporter, fragment at a NON-ZERO offset — the `startsWith` control
  "fix-trtransceiver": 8, // an ITEM carrying the fragment — the HEAD-NOUN control
  "fix-ethansadventure": 8, // a Supporter carrying NO fragment — the FRAGMENT control
  "fix-titan": 10, // 340 HP, no attacks — the defender, the opener, the non-card-class control
  "fix-energy": 8, // Basic {C} — the one printed symbol of the one attack
});

export const IN_PLAY_NAME_FRAGMENT_DECK = deckOf({
  "fix-inplaynames": 4, // the holder of the one printed sentence — NEITHER fragment
  "fix-weezingwall": 8, // 340 HP "Weezing" — the defender's Active, the ACTIVE and PREFIX axes
  "fix-galarweezing": 14, // "Galarian Weezing" — the fragment at a NON-ZERO offset
  "fix-darkkoffing": 8, // "Dark Koffing" — the OTHER printed fragment
  "fix-benchfiller": 8, // a Pokémon carrying NEITHER fragment — the filter control
  "fix-titan": 8, // 340 HP, no attacks — the ZERO board's defending Active and the opener
  "fix-energy": 6, // Basic {C} — the one printed symbol of the one attack
  "fix-weezingcanister": 4, // an ITEM carrying a fragment — in the deck, never in play
});

export const IN_PLAY_TYPE_DECK = deckOf({
  "fix-shortcircuit": 4, // Electivire — "Short-Circuit Knuckle" ({C}{C}, 40+): the +120
  "fix-waterbody": 8, // 60 HP Water — the body the clause reads, on EITHER seat
  "fix-inplaydual": 4, // ["Fire","Water"] — Water at index 1, the `.includes` board
  "fix-fairybody": 4, // 60 HP Fairy — a real type that is not Water, the FALSE case
  "fix-bigbody": 8, // 200 HP Colorless — survives the boosted 160, and arms nothing
  "fix-lightning-energy": 4, // Basic {L} — the two Lightning symbols of the control
  "fix-energy": 28, // Basic {C} — the printed cost of "Short-Circuit Knuckle"
});

export const TYPED_ENERGY_THRESHOLD_DECK = deckOf({
  "fix-frozenwood": 4, // Abomasnow — "Frozen Wood" ({W}{W}{W}{C}, 120+) at index 1: the +120
  "fix-titan": 20, // 340 HP, no attacks — survives the boosted 240, and the only Basic
  "fix-water-energy": 12, // Basic {W} — the three typed symbols of the printed cost
  "fix-grass-energy": 12, // Basic {G} — the type the clause counts
  "fix-grassdouble": 4, // Special {G}{G} — ONE card, TWO units: the cards-vs-units board
  "fix-energy": 8, // Basic {C} — the printed Colorless symbol, and a NON-Grass filler
});

export const EXTRA_ENERGY_DECK = deckOf({
  "fix-powerpress": 4, // {P}{C}, cost 2 — the +80 sentence at Jellicent ex's recorded cost
  "fix-highvoltage": 4, // {L}{L}{C}, cost 3 — the +100 sentence at Electivire ex's recorded cost
  "fix-extraprobe": 4, // {C}{C} — the all-Colorless PROBE, for the cards-vs-units boards
  "fix-titan": 12, // 340 HP, no attacks — survives the boosted 120, and arms nothing
  "fix-grassdouble": 4, // Special {G}{G} — ONE card, TWO units: the cards-vs-units board
  "fix-psychic-energy": 8, // Basic {P} — the typed symbol of "Power Press"
  "fix-lightning-energy": 8, // Basic {L} — the two typed symbols of "High-Voltage Press"
  "fix-energy": 12, // Basic {C} — every Colorless slot, and the untyped filler
  "sv03-192": 2, // Pokémon League Headquarters — the STADIUM surcharge, Basics only
  "sv03-052": 2, // Seismitoad "Quaking Zone" — the stage-agnostic opposing surcharge
});

export const BENCH_NAME_SUBSTRING_DECK = deckOf({
  "fix-loveimpact": 3, // TR Nidoqueen — "Love Impact" ({D}, 60+) at index 0: the +120
  "fix-trnidoking": 4, // "Team Rocket's Nidoking ex" — CONTAINS the fragment, does not equal it
  "fix-nidoking": 4, // "Nidoking" — the name the two readings AGREE on
  "fix-benchfiller": 4, // no name of consequence — the FALSE case under every reading
  "fix-titan": 25, // 340 HP, no attacks — survives the boosted 180, and the dominant starter
  "fix-dark-energy": 12, // Basic {D} — the printed cost of both attacks
  "fix-energy": 8, // Basic {C} — a non-Darkness filler that pays nothing here
});

export const DECK_SIZE_BONUS_DECK = deckOf({
  "fix-counterturn": 4, // Rabsca — "Counterturn" ({G}, 40+) at index 1: the +200
  "fix-titan": 36, // 340 HP, no attacks — survives the boosted 240, and the dominant starter
  "fix-grass-energy": 20, // Basic {G} — "Counterturn"'s printed cost, and any Energy pays "Triple Draw"'s {C}
});

export const CONDITIONAL_BENCH_SNIPE_DECK = deckOf({
  "fix-hazardousgreed": 4, // Wo-Chien — "Hazardous Greed" ({G}{C}, 20) at index 0: the gated 120 × 2
  "fix-titan": 36, // 340 HP, no attacks — the Defender, every bench body, and the dominant starter
  "fix-grass-energy": 20, // Basic {G} — pays both printed costs, and any Energy pays a {C}
});

export const FILTERED_BENCH_SNIPE_DECK = deckOf({
  "fix-filteredsnipe": 4,
  "fix-titan": 24, // 340 HP, no attacks — the Defender, every ordinary bench body, the starter
  "fix-teaparty": 4,
  "fix-drainwall": 4,
  "fix-drainweak": 4,
  "fix-energy": 20, // Basic {C} — pays all three printed {C} costs
});

export const BENCH_NAMED_DAMAGED_DECK = deckOf({
  "fix-bonevengeance": 4, // Marowak — "Bone Vengeance" ({C}{C}, 60+) at index 1: the +120
  "fix-cubone": 4, // "Cubone" — the name the clause carries, and the attacker's pre-evolution
  "fix-benchfiller": 4, // no name of consequence — the FALSE case however damaged it is
  "fix-titan": 24, // 340 HP, no attacks — survives the boosted 180, and the dominant starter
  "fix-energy": 16, // Basic {C} — "Bone Vengeance"'s printed {C}{C}
  "fix-fighting-energy": 8, // Basic {F} — "Growl"'s printed cost, so the control attack is payable
});

export const EVOLVED_FROM_DECK = deckOf({
  "fix-strikeitrich": 4, // Gholdengo — "Strike It Rich" ({M}, 30+) at index 0: the +90
  "fix-gimmighoul": 4, // "Gimmighoul" — the card Gholdengo's clause names
  "fix-abruptflash": 4, // Misty's Starmie — "Abrupt Flash" ({W}, 60+) at index 0: the +80
  "fix-mistystaryu": 4, // "Misty's Staryu" — the card Misty's Starmie's clause names
  "fix-titan": 20, // 340 HP, no attacks — survives the boosted 120, and the dominant starter
  "fix-metal-energy": 12, // Basic {M} — "Strike It Rich"'s printed cost
  "fix-water-energy": 12, // Basic {W} — "Abrupt Flash"'s printed cost
});

export const USED_ATTACK_DECK = deckOf({
  "fix-alloutattack": 4, // Falinks — "Form Ranks" (idx 0) then "All-Out Attack" (30+): the +90
  "fix-crazyblast": 4, // Weezing — "Pervasive Gas" (idx 0) then "Crazy Blast" (50+): the +120
  "fix-titan": 16, // 340 HP, no attacks — survives the boosted 170, and the dominant starter
  "fix-basic-1": 8, // plain Basics for "Form Ranks" to find, and legal openings
  "fix-victim": 4, // 30 HP — OHKO'd by "Pervasive Gas"'s printed 30, so a KO can PARK
  "fix-dark-energy": 12, // Basic {D} — pays "Pervasive Gas" and half of "Crazy Blast"
  "fix-energy": 12, // Basic {C} — pays both Falinks costs and "Crazy Blast"'s {C}
});

export const STADIUM_PRESENCE_DECK = deckOf({
  "fix-mountaindrop": 4, // Probopass — "Mountain Drop" (70+): stadiumInPlay, +70
  "fix-assaultland": 4, // Fan Rotom — "Assault Landing" (70): stadiumInPlay, the CANCEL
  "sv02-096": 4, // Palossand — "Earthen Power" (80+): the OWNERSHIP reading, the near miss
  "sv01-167": 4, // Beach Court — the Stadium, played from EITHER seat
  "fix-psychic-energy": 6, // Basic {P} — pays Earthen Power's typed slot
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 30, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the clean defender
});

export const CROSS_BOARD_STATUS_DECK = deckOf({
  "fix-charbreath": 4, // Centiskorch — "Singe" (the Burn source) + "Charring Breath" (the cancel)
  "fix-roastheat": 4, // Slugma — "Roasting Heat" (10+): opponentActiveBurned, +40
  "fix-mindcrush": 4, // Tapu Lele — "Perplex" (the Confusion source) + "Mental Crush" (90+), +90
  "fix-fire-energy": 8, // Basic {R} — pays Singe, Charring Breath and Roasting Heat
  "fix-psychic-energy": 6, // Basic {P} — pays Mental Crush's typed slot
  "fix-energy": 8, // Basic {C} — pays every Colorless symbol in the cast
  "fix-bigbody": 26, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the clean defender
});

export const BASIC_ENERGY_DISCARD_DECK = deckOf({
  "fix-emberpillar": 4,
  "fix-bigbody": 4,
  "fix-basic-1": 8,
  "fix-fire-energy": 18,
  "fix-fire-energy-alt": 6,
  "fix-water-energy": 6,
  "sv02-191": 4, // Luminous — provides every type IN PLAY, and nothing at all in a pile
  "fix-special": 4,
  "fix-energy": 6,
});

export const TR_ENERGY_DECK = deckOf({
  "fix-trbonus": 4,
  "fix-tr-energy": 8,
  "fix-tr-other-energy": 8,
  "fix-not-tr-energy": 8,
  "fix-special": 4,
  "fix-basic-1": 8,
  "fix-bigbody": 8,
  "fix-energy": 12,
});

export const SAWK_SPLIT_DECK = deckOf({
  "fix-sawk": 4,
  "fix-bigbody": 8,
  "fix-pokemon-v": 4,
  "sv06.5-036": 4,
  "fix-fighting-energy": 8,
  "fix-energy": 32,
});

export const REQUIREMENT_FLOOR_DECK = deckOf({
  "fix-ironboulder": 3,
  "fix-cramorant": 3,
  "fix-mesprit": 3,
  "fix-uxie": 2,
  "fix-azelf": 2,
  "fix-lakebystander": 3,
  "fix-bigbody": 8,
  "fix-psychic-energy": 12,
  "fix-energy": 24,
});

export const BENCH_COUNT_DECK = deckOf({
  "fix-victini": 3,
  "fix-benchfiller": 8,
  "fix-bigbody": 8,
  "fix-fire-energy": 12,
  "fix-energy": 29,
});

export const BENCH_NAMED_DECK = deckOf({
  "fix-durant": 3,
  "fix-mightyena": 3,
  "fix-illumise": 3,
  "fix-beldum": 3,
  "fix-metang": 3,
  "fix-benchfiller": 4,
  "fix-bigbody": 8,
  "fix-stage1": 2,
  "fix-stage2": 2,
  "fix-dark-energy": 12,
  "fix-energy": 17,
});

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

export const EVOLVE_DECK = deckOf({
  "fix-basic-1": 24,
  "fix-stage1": 12,
  "fix-stage2": 8,
  "fix-energy": 16,
});

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

export const DEFIANCE_DECK = deckOf({
  "fix-attacker": 30,
  "fix-wall": 4,
  "fix-weak": 4,
  "sv01-169": 6,
  "fix-energy": 16,
});

export const CHOICE_DECK = deckOf({
  "fix-attacker": 28,
  "fix-pokemon-v": 4,
  "fix-pokemon-v-weak": 2,
  "fix-pokemon-vmax": 2,
  "fix-wall": 2,
  "sv02-176": 6,
  "fix-energy": 16,
});

export const PRIZE_DECK = deckOf({
  "fix-attacker": 32,
  "fix-pokemon-v": 4,
  "fix-pokemon-vmax": 4,
  "fix-victim": 4,
  "fix-energy": 16,
});

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

export const ONKO_DECK = deckOf({
  "fix-attacker": 8,
  "sv02-126": 4,
  "fix-onko": 4,
  "fix-basic-1": 12,
  "fix-victim": 4,
  "fix-energy": 28,
});

export const ATTACH_DECK = deckOf({
  "sv01-054": 3,
  "sv02-060": 3,
  "fix-attacher": 3,
  "fix-basic-1": 12,
  "fix-water-energy": 20,
  "fix-fire-energy": 6,
  "fix-energy": 13,
});

export const GARDEVOIR_DECK = deckOf({
  "sv01-086": 3,
  "fix-psychic-1": 8,
  "fix-basic-1": 8,
  "fix-psychic-energy": 20,
  "fix-energy": 21,
});

export const KORAIDON_DECK = deckOf({
  "sv01-125": 3,
  "fix-fighting-1": 6,
  "fix-fighting-evo": 2,
  "fix-basic-1": 6,
  "fix-fighting-energy": 20,
  "fix-energy": 23,
});

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

export const LOOK_AT_TOP_DECK = deckOf({
  "fix-basic-1": 16,
  "fix-basic-2": 4,
  "sv02-183": 3,
  "sv01-186": 3,
  "sv01-189": 4,
  "fix-item": 2,
  "fix-energy": 28,
});

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

export const HAND_REFRESH_DECK = deckOf({
  "fix-basic-1": 8,
  "sv01-198": 3, // Youngster
  "sv01-176": 3, // Judge
  "sv03-187": 3, // Brassius
  "sv01-177": 3, // Katy
  "sv02-185": 3, // Iono
  "fix-energy": 37,
});

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

export const SELF_DAMAGE_DECK = deckOf({
  "sv01-038": 4, // Skeledirge — Blazing Shout (190 + 30 self)
  "fix-victim": 4, // 30 HP — OHKO'd by the 190
  "fix-bigbody": 4, // 200 HP — survives the 190, isolating a self-KO
  "fix-basic-1": 20, // Basics for setup + the bench bodies a KO promotes
  "fix-fire-energy": 20, // pays Blazing Shout's {R}{R}
  "fix-energy": 8, // Colorless for the {C}
});

export const SCALED_DAMAGE_DECK = deckOf({
  "fix-attacker": 4, // Rage (index 3, base 10) — the default scaling attacker
  "sv02-028": 4, // Paldean Tauros — Raging Horns (index 0, base 20)
  "sv03-125": 4, // Charizard ex — Burning Darkness (opponentPrizesTaken, base 180); 330 HP mirror wall
  "sv03-030": 4,
  "sv01-068": 4,
  "fix-wall": 4, // 120 HP — survives the self-counter attackers' hits here
  "fix-weak": 4, // 60 HP, ×2 Fire — the scaling × weakness defender
  "fix-bigbody": 4, // 200 HP, no Weakness — survives Entei's fold and Pachirisu's base 10
  "fix-basic-1": 10, // Basics for setup + the bench bodies a KO promotes
  "fix-fire-energy": 10, // pays every {C}/{R}/{F} cost here; ≥3 for Entei's {C}{C}{C}
  "fix-lightning-energy": 8, // Pachirisu's {L}{C} — Fire cannot pay the {L}; 8 so no seed strands it
});

export const MULTIPLY_DAMAGE_DECK = deckOf({
  "sv06.5-039": 4, // Pecharunt ex — Irritated Outburst (opponentPrizesTaken, per 60)
  "sv01-109": 4, // Annihilape — Rage Fist (opponentPrizesTaken, per 70)
  "fix-bigbody": 4, // 200 HP — survives 60×2 / 70×2, isolating the damage math
  "fix-basic-1": 16, // Basics for setup + the bench bodies a KO promotes
  "fix-dark-energy": 16, // pays Pecharunt's {D}{D}
  "fix-fighting-energy": 16, // pays Rage Fist's {F}
});

export const BENCH_BODY_DECK = deckOf({
  "fix-benchcount": 4, // the three body-count sentences, indices 0-2 (+ an unsimulated 3)
  "fix-oppenergy": 4, // the four opponent-Energy sentences, indices 0-3
  "fix-titan": 20, // 340 HP — Bench filler on both sides AND the neutral defender
  "fix-energy": 12, // Colorless provision — pays every {C} cost, counts as untyped Energy
  "fix-fire-energy": 8, // {R} — what "Flare Scan" filters FOR
  "fix-water-energy": 8, // {W} — what "Flare Scan" must refuse
  "fix-pokemon-v-weak": 4, // 210 HP, ×2 Fire — the pre-W/R ordering witness
});

export const DAMAGE_SUPPRESSION_DECK = deckOf({
  "fix-suppressor": 4, // the four sentences at indices 0-3 + the no-effect control at 4
  "fix-azureseas": 4, // "Azure Seas" — the ability half, on an attack with NO text
  "fix-suppresswall": 4, // 300 HP, ×2 Fire, −30 after W/R (registry) — the order witness
  "fix-resistwall": 4, // 300 HP, −30 Fire, −30 after W/R (registry)
  "fix-weak-tough": 4, // 120 HP, ×2 Fire AND −30 Fire — synthetic, no catalog twin
  "sv03-030": 4, // Entei — "Pressure" (−20 BEFORE W/R, source = the opponent's Active)
  "sv01-099": 4, // Dachsbun — "Well-Baked Body" (prevents ALL damage from a {R} attacker)
  "sv02-113": 4, // Hariyama — the seat-wide −10 the clause splits rather than nulls
  "sv02-089": 4, // Spiritomb — "Fettered in Misfortune", the §9 gate on the ability half
  "fix-bigbody": 4, // 200 HP, no modifiers — the neutral Active a benched Hariyama shields
  "sv06.5-060": 4, // Neutralization Zone — the OFF-TARGET rule the clause must NOT reach
  "fix-basic-1": 8, // setup Actives + the bodies a KO promotes
  "fix-fire-energy": 8, // pays every {C} cost in the suite
});

export const SELF_ENERGY_DECK = deckOf({
  "fix-selfenergy": 4,
  "fix-special": 4,
  "fix-bothactives": 4, // bothActivesEnergyCount — index 0, plus two printed refusals
  "fix-oppenergy": 2,
  "fix-benchcount": 2,
  "fix-titan": 12, // 340 HP — the neutral defender AND the Bench filler (5 a side + 1)
  "fix-pokemon-v-weak": 4, // 210 HP, ×2 Fire — the pre-W/R ordering witness
  "fix-energy": 4, // Colorless provision — the "what pays is not what counts" card
  "fix-fire-energy": 12, // {R} — what "Flare Draw" filters FOR
  "fix-water-energy": 12, // {W} — what "Flare Draw" must refuse
});

export const COVETOUS_IVY_DECK = deckOf({
  "sv02-027": 4, // Wo-Chien ex — Covetous Ivy (opponentPrizesTaken, per 60, benched)
  "fix-bramble": 4, // the per-40 benched-snipe probe (attacker)
  "fix-bigbody": 6, // 200 HP — a benched target that survives the scaled hit
  "fix-victim": 4, // 30 HP — a benched target a scaled hit KOs
  "sv03-174": 2, // Bouffalant — "Bouffer" (−20 after W/R): the benched reduction target
  "fix-basic-1": 20, // setup Actives + Bench filler so the count-1 pick is real
  "fix-grass-energy": 20, // pays Covetous Ivy's {G}{G}{C} and Bramble's {C}
});

export const ALSO_SNIPE_DECK = deckOf({
  "sv01-080": 4, // Miraidon — Lightning Laser (90 + a flat 30 benched rider)
  "sv03-076": 4, // Tadbulb — Shake and Discharge (20 + a flat 10 benched rider)
  "fix-bigbody": 32, // 200 HP — DOMINANT so BOTH setup Actives pin to it; also the survivor bench targets
  "fix-victim": 4, // 30 HP — the benched body the rider KOs
  "fix-lightning-energy": 16, // pays {L}{L}{C} / {L}{C}
});

export const ANY_SNIPE_DECK = deckOf({
  "sv01-069": 4, // Rotom — Linear Attack (opponentAny, 20, Lightning)
  "sv06.5-038": 4, // Fezandipiti ex — Cruel Arrow (opponentAny, 100, Darkness)
  "fix-lightning-weak": 30, // ×2 Lightning, 130 HP — DOMINANT pinned Active (the W/R target) + bench targets
  "fix-victim": 4, // 30 HP — the body a snipe KOs
  "sv01-197": 2, // Vitality Band — the attacker's pre-W/R +10 (an Active-snipe bonus witness)
  "fix-lightning-energy": 16, // pays Cruel Arrow's {C}{C}{C} and Linear Attack's {C}
});

export const FEINT_DECK = deckOf({
  "fix-feint": 4, // synthetic {L} Feint Attack — the ignoreWR witness (opponentAny, 50)
  "fix-lightning-weak": 34, // ×2 Lightning, 130 HP — DOMINANT pinned Active (the W/R target) + bench targets
  "sv03-174": 4, // Bouffalant — "Bouffer" (−20 after W/R): the reduction ignoreWR SKIPS
  "sv01-197": 2, // Vitality Band — the attacker's pre-W/R +10 (an Active-snipe bonus witness)
  "fix-lightning-energy": 16, // pays Feint Attack's {C}
});

export const TWIN_SNIPE_DECK = deckOf({
  "fix-twinsnipe": 4, // count-2 flat snipe (opponentAny, 50) — W/R APPLIES on the Active pick
  "fix-twinfeint": 4, // count-2 ignoreWR snipe (opponentAny, 50) — W/R nulled on BOTH picks
  "fix-lightning-weak": 32, // ×2 Lightning, 130 HP — DOMINANT pinned Active + bench targets
  "sv03-174": 4, // Bouffalant — "Bouffer" (−20 after W/R): the reduction ignoreWR SKIPS
  "fix-lightning-energy": 16, // pays both {C} costs
});

export const SCALED_SNIPE_DECK = deckOf({
  "fix-scaledsnipe": 4, // the scaled any-target snipe at 20 and 30, + two controls
  "fix-lightning-weak": 30, // ×2 Lightning, 130 HP — DOMINANT pinned Active + bench targets
  "sv01-197": 2, // Vitality Band — the attacker's pre-W/R +10 through the SCALED amount
  "fix-lightning-energy": 20, // pays the {C} cost AND is the thing being counted
  "fix-energy": 4,
});

export const COUNTER_PUT_CHOSEN_DECK = deckOf({
  "fix-counterput": 4, // the two printed word orders + the deals:true control
  "fix-lightning-weak": 30, // ×2 Lightning, 130 HP — DOMINANT pinned Active + bench targets
  "sv03-078": 4, // Bellibolt — prevents all DAMAGE from {L}, and NOT a placed counter
  "fix-unaware": 4, // prevents all EFFECTS — and a placed counter IS one
  "sv03-197": 2,
  "fix-lightning-energy": 16, // pays the {C} cost AND arms Bellibolt's {L} clause
});

export const COUNTER_FOLD_DECK = deckOf({
  "fix-counterfold": 4, // the three printed folds + the printed-damage §11 control
  "fix-bigbody": 26, // 200 HP, NO printed Ability — the filter's negative witness
  "fix-idlebody": 8, // 200 HP WITH one — the filter's positive witness, both seats
  "fix-lightning-weak": 4, // ×2 Lightning, 130 HP — the flat-placement witness
  "sv03-078": 4, // Bellibolt — prevents all DAMAGE from {L}, and NOT a placed counter
  "fix-unaware": 4, // prevents all EFFECTS — and a placed counter IS one
  "sv03-197": 2,
  "fix-lightning-energy": 8, // pays the {C} cost AND arms Bellibolt's {L} clause
});

export const COUNTER_UNTIL_HP_DECK = deckOf({
  "fix-hptarget": 4, // the three printed destinations + the printed-damage §11 control
  "fix-bigbody": 26, // 200 HP, Colorless — DOMINANT (mulligan-free) and the arithmetic body
  "fix-lightning-weak": 8, // 130 HP ×2 Lightning — the below-target floor and the flatness witness
  "sv02-173": 4, // Bravery Charm — +50 HP: `effectiveMaxHp` vs the printed `hpOf`
  "sv03-078": 4, // Bellibolt — prevents all DAMAGE from {L}, and NOT a placed counter
  "fix-unaware": 4, // prevents all EFFECTS — and a placed counter IS one
  "fix-lightning-energy": 10, // pays the {C} cost AND arms Bellibolt's {L} clause
});

export const COST_SNIPE_DECK = deckOf({
  "fix-costsnipe": 4, // "Discard 2 Energy…" + a count-2 snipe — PARKS TWICE
  "fix-allsnipe": 4, // "Discard all Energy…" + a count-3 snipe — the ZERO-park control
  "fix-bigbody": 28, // 200 HP neutral — DOMINANT (mulligan-free) + the pinned Active
  "fix-lightning-weak": 8, // ×2 Lightning, 130 HP — the Bench targets, and the KO rung's Active
  "fix-lightning-energy": 8, // Basic {L} — one of the two distinguishable prints
  "fix-energy": 8, // Basic {C} — the other, which is what makes the cost a DECISION
});

export const HAND_DRAW_DECK = deckOf({
  "fix-handdraw": 4, // "Discard your hand and draw 6 cards." — the whole sentence
  "fix-bigbody": 40, // 200 HP neutral — DOMINANT (mulligan-free), and the deck's bulk
  "fix-item": 8, // a plain Item — hand bulk with no program of its own to interfere
  "fix-energy": 8, // Basic {C} — pays the printed cost
});

export const TOOL_COUNT_DECK = deckOf({
  "fix-toolscaler": 4, // "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon."
  "fix-tool": 12, // the unauthored Tool — the resource this whole suite counts
  "fix-bigbody": 36, // 200 HP neutral — DOMINANT (mulligan-free), the Bench bodies and the defender
  "fix-energy": 8, // Basic {C} — pays the printed {C}, and the Energy a Tool count must ignore
});

export const BOARD_ENERGY_DECK = deckOf({
  "fix-boardgrass": 4, // "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."
  "fix-grass-energy": 16, // Basic {G} — the resource this whole suite counts
  "fix-energy": 6, // Basic {C} — pays the printed {C}, and the Energy the {G} filter must refuse
  "sv02-191": 4, // Luminous — the wildcard, and the reason the read is PROVISION
  "fix-special": 4, // the unauthored Special — {C} only, and what DEMOTES the wildcard
  "fix-bigbody": 26, // 200 HP neutral — DOMINANT (mulligan-free), the Bench bodies and the defender
});

export const SELF_ENERGY_HAND_DECK = deckOf({
  "fix-selfenergyhand": 4, // "Put an Energy attached to this Pokémon into your hand."
  "sv01-039": 2, // Charcadet "Ember" — the BARE self-discard, the caption CONTROL
  "fix-bigbody": 26, // 200 HP neutral — DOMINANT (mulligan-free), and the deck's bulk
  "fix-energy": 8, // Basic {C} — pays the printed {C} cost, and one side of the pick
  "fix-lightning-energy": 8, // Basic {L} — the second print, which makes the pick a DECISION
  "fix-special": 8, // Special {C} — the third print, and the proof the filter is `anyEnergy`
  "fix-fire-energy": 4, // Basic {R} — pays Ember's printed cost, and nothing else
});

export const BENCH_BOOST_DECK = deckOf({
  "fix-benchboost": 4, // "…up to 2 Energy from your Benched Pokémon… 60 more…" — the bare noun
  "fix-benchbasicboost": 4, // the same sentence at `basicEnergy` and 90 — the filter's other side
  "fix-psychic-resist-big": 4, // 200 HP, −30 Psychic — the ONE body where a split hit reads differently
  "fix-bigbody": 24, // 200 HP neutral — DOMINANT (mulligan-free), the Bench holders, the plain defender
  "fix-energy": 8, // Basic {C} — pays both costs, and fuel for BOTH filters
  "fix-lightning-energy": 8, // Basic {L} — the second print, which is what makes the pick a DECISION
  "fix-special": 8, // Special {C} — fuel for the bare noun, refused by the Basic one
});

export const DISCARD_SCALED_DECK = deckOf({
  "fix-allscale": 4, // "Discard all {L} Energy…" — the inline, no-park, `count: "all"` arm
  "fix-basicscale": 4, // "You may discard any amount of Basic Energy…" — the declinable arm
  "fix-bigbody": 28, // 200 HP neutral — DOMINANT (mulligan-free) + the pinned Active
  "fix-lightning-energy": 8, // Basic {L} — the ONLY fuel the typed filter takes
  "fix-energy": 8, // Basic {C} — pays both costs, Basic fuel, never {L} fuel
  "fix-special": 8, // Special {C} — pays a cost, and is fuel for NEITHER filter
});

export const HAIL_BLADE_DECK = deckOf({
  "sv02-061": 4, // Chien-Pao ex — Hail Blade (the attacker, and the ex defender)
  "fix-water-weak": 4, // ×2 Water, 200 HP — the Weakness the damage doubles into
  "fix-bigbody": 28, // 200 HP neutral — DOMINANT (mulligan-free) + the plain defender
  "fix-water-energy": 16, // pays {W}{W} and IS the discardable {W}
  "fix-energy": 8, // plain Colorless Basic Energy — never offered by the {W} filter
});

export const PSY_PURGE_DECK = deckOf({
  "swsh10.5-031": 4, // Mewtwo VSTAR — Psy Purge (attacker AND the 280 HP defender)
  "fix-psychic-weak": 4, // ×2 Psychic, 200 HP — the Weakness the damage doubles into
  "fix-bigbody": 28, // 200 HP neutral Basic — DOMINANT (mulligan-free) starting Active
  "fix-psychic-energy": 16, // pays {P}{C} and IS the discardable {P}
  "fix-energy": 8, // plain Colorless Basic Energy — never offered by the {P} filter
});

export const DAMAGE_ATTACKER_DECK = deckOf({
  "sv01-005": 4, // Cacnea — Counterattack Quills (30 recoil)
  "sv01-006": 4, // Cacturne — Counterattack Quills (same 30)
  "sv03-112": 4, // Stunfisk — Custom Trap (50 recoil, requires a Tool)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0)
  "sv01-197": 3, // Vitality Band — the inert Tool for the Custom Trap gate
  "fix-bigbody": 29, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

export const ROCKY_HELMET_DECK = deckOf({
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0)
  "sv01-193": 4, // Rocky Helmet — the recoil TOOL (2 counters = 20 HP)
  "fix-bigbody": 40, // 200 HP neutral Basic — DOMINANT setup + the holder + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

export const COUNTERATTACK_DECK = deckOf({
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "sv03-112": 4, // Stunfisk — Custom Trap (50, ONLY while a Pokémon Tool is attached)
  "sv01-005": 4, // Cacnea — Counterattack Quills (30, ungated)
  "sv01-006": 4, // Cacturne — Counterattack Quills (the same 30, 130 HP)
  "sv01-193": 4,
  "fix-bigbody": 28, // 200 HP neutral Basic — DOMINANT setup + the bare Tool holder + promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

export const CORNERSTONE_DECK = deckOf({
  "fix-cornerstone": 4, // the holder — "Cornerstone Stance" (preventDamageFromHasAbility)
  "fix-abilitybody": 4, // Ability, NO rule box — the positive, and all four read sites
  "fix-attacker-ex": 4, // an ex with NO Ability — the gate-separating negative
  "fix-attacker": 4, // neither — the flat control
  "fix-abilityv": 3, // Basic Pokémon V with an Ability — Spiritomb's lockable attacker
  "sv02-089": 3, // Spiritomb — "Fettered in Misfortune" (§9 from the BENCH)
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 as the ATTACKER)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and promote target
  "fix-energy": 10, // Colorless Basic — every cost in this deck
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const MIGHTY_SHELL_DECK = deckOf({
  "fix-mightyshell": 4, // the holder — "Mighty Shell" (preventDamageAndEffectsFromSpecialEnergy)
  "fix-shellcracker": 4, // the attacker — six attacks, all five read sites
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 as the ATTACKER)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and promote target
  "fix-special": 4, // an UNAUTHORED Special Energy — the gate's positive
  "sv02-191": 2, // Luminous Energy — an AUTHORED Special, the same positive by class
  "fix-energy": 18, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const CURIOUS_TEA_PARTY_DECK = deckOf({
  "fix-teaparty": 4, // the holder — "Curious Tea Party" (preventDamageAndEffectsWhileBenched)
  "fix-shellcracker": 4,
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 from the ATTACKING seat)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and promote target
  "fix-energy": 24, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const SPHERICAL_SHIELD_DECK = deckOf({
  "fix-spherical": 4, // the holder — "Spherical Shield" (preventBenchDamageAndEffects)
  "fix-shellcracker": 4,
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 from the ATTACKING seat)
  "sv03-070": 3, // Thundurus — "Adverse Weather" (the OTHER field on the same scan)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and the shielded teammate
  "fix-energy": 23, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const TRAINER_SHIELD_DECK = deckOf({
  "fix-unnerve": 4, // the HOLDER rule — "Unnerve" (preventTrainerEffects)
  "fix-widewall": 4, // the SEAT rule — "Wide Wall" (preventSupporterEffectsWhileActive)
  "fix-hammer": 4, // fixture ITEM — discardEnergy from:"opponentChosen", no coin gate
  "sv02-172": 4, // Boss's Orders — the SUPPORTER, gust off the opponent's Bench
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, from the seat playing the Trainer)
  "fix-titan": 5, // 340 HP, no attacks — bench filler and the UNSHIELDED teammate
  "fix-energy": 18, // Colorless Basic — the discard fodder, not a cost
  "fix-bigbody": 18, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const ATTACK_EFFECT_SHIELD_DECK = deckOf({
  "fix-unaware": 4, // the HOLDER rule — "Unaware" (preventAttackEffects)
  "fix-repellingveil": 4, // the GROUP rule — "Repelling Veil" (preventAttackEffectsForGroup)
  "fix-tr-body": 4, // "Team Rocket's Meowth" — the shielded NON-holder group member
  "fix-not-tr-body": 4, // "Rival of Team Rocket's Meowth" — the PREFIX negative
  "fix-tr-stage1": 3, // "Team Rocket's Persian" — the STAGE negative
  "fix-shellcracker": 4, // the ATTACKER — Bite (damage), Yawn + Clutch (two effect ops)
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, from the ATTACKING seat)
  "fix-energy": 14, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const SPECIAL_ENERGY_SEAM_DECK = deckOf({
  "fix-mist-energy": 4,
  "fix-enriching-energy": 4,
  "fix-special": 3, // the UNAUTHORED Special — reaches both seams, contributes to neither
  "sv02-190": 3, // Jet Energy — the OTHER onAttach arm, for the discrimination
  "fix-unaware": 3,
  "fix-shellcracker": 4, // the ATTACKER — Bite (damage), Yawn + Clutch (two effect ops)
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, from the ATTACKING seat)
  "fix-titan": 4, // 340 HP, no attacks — bench filler and the UNSHIELDED neighbour
  "fix-energy": 12, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const NEO_UPPER_ENERGY_DECK = deckOf({
  "fix-neo-upper-energy": 6,
  "fix-neo-stage1": 6, // the NON-Stage-2 holder, and the evolve source
  "fix-neo-stage2": 6, // the Stage 2 holder, and the evolve target
  "fix-basic-1": 12, // the bottom of the line, and the BASIC holder control
  "sv02-191": 3, // Luminous — the OTHER conditional provision
  "sv02-190": 3, // Jet — a plain {C} Special, for "another Special attached"
  "fix-special": 2, // the UNAUTHORED Special — reaches the funnel, promotes nothing
  "fix-victim": 2, // 30 HP — the body the §8.2 drive hits
  "fix-energy": 4, // Colorless Basic — pays the {C} half and arms NOTHING
  "fix-bigbody": 16, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const PRISM_ENERGY_DECK = deckOf({
  "fix-prism-energy": 6,
  "fix-prism-basic": 8, // the BASIC holder, and the evolve source
  "fix-prism-stage1": 6, // the NON-Basic holder, and the evolve target
  "fix-neo-stage2": 4, // a STAGE 2 — the wrong-predicate discrimination
  "fix-neo-upper-energy": 4, // the OTHER stage word on the SAME field
  "sv02-191": 3, // Luminous — the OTHER conditional provision
  "sv02-190": 3, // Jet — a plain {C} Special, for "another Special attached"
  "fix-special": 2, // the UNAUTHORED Special — reaches the funnel, promotes nothing
  "fix-victim": 2, // 30 HP — the body the §8.2 drive hits
  "fix-energy": 4, // Colorless Basic — pays the {C} half and arms NOTHING
  "fix-bigbody": 18, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const REVERSAL_ENERGY_DECK = deckOf({
  "fix-reversal-energy": 6,
  "fix-reversal-basic": 8, // the BASIC holder, and the evolve source
  "fix-reversal-stage1": 6, // the no-Rule-Box EVOLUTION — the only promoting body
  "fix-reversal-ex": 3, // its RULE-BOX twin — the `noRuleBox` denial
  "fix-neo-stage2": 4, // a STAGE 2 — the body Neo Upper promotes on, for the cross
  "fix-neo-upper-energy": 4, // the OTHER carrier of the same field, unrider'd
  "sv02-191": 3, // Luminous — the OTHER conditional provision
  "fix-special": 2, // the UNAUTHORED Special — reaches the funnel, promotes nothing
  "fix-victim": 2, // 30 HP — the body the §8.2 drive hits
  "fix-energy": 4, // Colorless Basic — pays the {C} half and arms NOTHING
  "fix-bigbody": 18, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const PREVENTED_CLASS_DECK = deckOf({
  "fix-safeguardex": 4, // holder — "…your opponent's Pokémon ex" (PREVENT_FROM_EX)
  "fix-armortail": 4, // holder — "…Basic Pokémon ex" (PREVENT_FROM_BASIC_EX); IS an ex
  "fix-exbasic": 4, // Basic ex, four attacks — prevented by BOTH holders
  "fix-exstage1": 4, // Stage 1 ex, same four — the sentences' one disagreement
  "fix-abilityv": 3, // Basic Pokémon V — the `preventDamageFromExV` separator
  "fix-attacker": 3, // no rule box — the flat control
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 as the ATTACKER)
  "fix-titan": 3, // 340 HP, no attacks — bench filler and promote target
  "fix-energy": 10, // Colorless Basic — every cost in this deck
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const FLOWER_CURTAIN_DECK = deckOf({
  "fix-flowercurtain": 4, // the holder — "Flower Curtain" (preventBenchDamageNoRuleBox)
  "fix-shellcracker": 4,
  "fix-exbasic": 4, // "Fixbase ex" — the RULE-BOX benched body the sentence EXCLUDES
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9 from the ATTACKING seat)
  "sv03-070": 3, // Thundurus — "Adverse Weather" (the FIRST field on the same scan)
  "fix-titan": 3, // 340 HP, no attacks, no Rule Box — the SHIELDED teammate
  "fix-attacker-vmax": 2, // "Bigmon VMAX" — a Rule Box the PARENTHETICAL does not name
  "fix-energy": 17, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const IMPERVIOUS_SHELL_DECK = deckOf({
  "fix-imperviousshell": 4, // the holder — "Impervious Shell" (preventDamageAtOrAbove: 200)
  "fix-imperviousweak": 4, // the same holder, {G} Weakness ×2 — the post-W/R witness
  "fix-crusher": 4, // the attacker — eight attacks, one per read site
  "sv01-192": 3, // Rock Chestplate (Tool) — {F}-gated −30: the post-REDUCTION witness
  "fix-titan": 4, // 340 HP, no Ability — the ATTRIBUTION control
  "sv01-096": 4, // Klefki — "Mischievous Lock" (§9 from the ATTACKING seat)
  "fix-energy": 17, // Colorless Basic — pays every {C} here and arms NOTHING
  "fix-bigbody": 20, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

export const COIN_FLIP_SHIELD_DECK = deckOf({
  "fix-experthider": 4, // the ungated holder — "Expert Hider"
  "fix-adrenapheromone": 4, // the {D}-gated holder — "Adrena-Pheromone"
  "fix-crusher": 4,
  "fix-dark-energy": 4, // Basic {D} — what arms "Adrena-Pheromone"
  "fix-titan": 4, // 340 HP, no Ability — the ATTRIBUTION control
  "sv01-096": 4, // Klefki — "Mischievous Lock": the §9 gate, and the no-coin witness
  "fix-energy": 12, // Colorless Basic — pays every {C} AND is the {D} conjunct's negative
  "fix-bigbody": 24, // 200 HP neutral Basic — DOMINANT mulligan-free starter
});

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

export const RETREAT_LOCK_DECK = deckOf({
  "sv02-016": 4,
  "sv03-128": 3,
  "fix-retreat2": 4, // retreat-2 Basic — the locked body (a retreat it could pay)
  "fix-basic-1": 4, // retreat-1 Basic — the locked body on the EVOLVE clear path
  "fix-stage1": 3, // evolves from fix-basic-1 — §10 sheds the block
  "sv01-194": 3, // Switch — the leaving-the-Active-Spot clear
  "fix-grass-energy": 6, // Basic {G} — pays Bind Down
  "fix-dark-energy": 6, // Basic {D} — pays Poison Ring
  "fix-energy": 10, // Basic {C} — pays the locked body's retreat cost
  "fix-bigbody": 17, // 200 HP neutral Basic — DOMINANT starter + bench body
});

export const BLOCK_DECK = deckOf({
  "swsh10.5-055": 4, // Snorlax — "Block": the continuous retreat lock
  "fix-retreat2": 4, // retreat-2 Basic — the blocked body (a retreat it could pay)
  "sv01-096": 4, // Klefki — "Mischievous Lock": the §9 gate's POSITIVE witness
  "fix-attacker": 4, // Bite ({C}, 30) — the blocked body that still attacks
  "fix-energy": 12, // Basic {C} — pays the blocked body's retreat cost and Bite
  "fix-bigbody": 32, // 200 HP neutral Basic — DOMINANT starter + both pinned Actives
});

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

export const PUBLIC_COUNT_DECK = deckOf({
  "sv03-135": 4, // Absol ex — "Cursed Slug" (100+): opponentHandAtMost 3, +120. A 2-PRIZE body.
  "sv03-145": 4, // Bronzong — "Extrasensory" (70+): handSizesEqual, +90
  "sv01-116": 4, // Krokorok — "Payback" (30+): opponentPrizesRemaining [1], +90; and the KO swing
  "sv03-101": 4, // Houndstone — "Two Four-ocious" (80+): opponentPrizesRemaining [2, 4], +120
  "fix-psychic-weak": 4, // 200 HP, ×2 Psychic — the Weakness defender for the fold-order pair
  "fix-dark-energy": 6, // Basic {D} — pays Cursed Slug's {D}{D}{C} on its own
  "fix-metal-energy": 5, // Basic {M} — pays Extrasensory
  "fix-fighting-energy": 5, // Basic {F} — pays Payback and Corkscrew Punch
  "fix-psychic-energy": 6, // Basic {P} — pays Two Four-ocious's {P}{C}{C} on its own
  "fix-bigbody": 18, // 200 HP neutral Basic — DOMINANT starter, both pinned Actives, the control
});

export const TYPE_NAME_DECK = deckOf({
  "sv02-119": 6, // Falinks — "Reckless Charge Together" (70+): yourBenchHasNamed, +90. Needs TWO at once.
  "swsh10.5-035": 4, // Sylveon — "Wonder Flash" (90+): opponentActiveHasType Dragon, +90
  "sv03-161": 4, // Drampa — the pool's DRAGON body (120 HP, no Weakness): the armed defender
  "fix-fighting-weak": 3, // 200 HP, ×2 Fighting — the Weakness defender for the fold-order pair
  "fix-psychic-energy": 6, // Basic {P} — pays Souvenir, and two of Reckless Charge Together's {C}{C}
  "fix-fighting-energy": 6, // Basic {F} — pays Reckless Charge Together's {F}, and two of Wonder Flash's {C}{C}{C}
  "fix-bigbody": 31, // 200 HP neutral Colorless Basic — DOMINANT pinned starter, the non-Dragon control
});

export const ENERGY_IN_PLAY_DECK = deckOf({
  "sv06.5-030": 4, // Absol — "Darkfall" (20+): yourEnergyInPlayAtLeast Darkness ×3, +50
  "fix-darkness-energy": 12, // Basic {D} — the counted card
  "sv02-191": 4, // Luminous Energy — the wildcard-provision witness + the demotion pair
  "fix-energy": 6, // Basic {C} — pays Darkfall's cost while counting ZERO
  "fix-darkness-weak": 3, // 200 HP, ×2 Darkness — the Weakness defender for the fold-order pair
  "fix-bigbody": 31, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holders
});

export const TOOL_CLAUSE_DECK = deckOf({
  "sv01-152": 4, // Greedent — "Enhanced Fang" (80+) at index 1: yourActiveHasToolAttached, +80
  "sv02-173": 6, // Bravery Charm — the SILENT arm (basicHpBonus, inert on a Stage 1)
  "sv01-197": 3, // Vitality Band — the LOUD arm (+10 in the same pre-W/R step)
  "fix-energy": 9, // Basic {C} — pays Enhanced Fang's {C}{C}{C}
  "fix-colorless-weak": 3, // 200 HP, ×2 Colorless — the Weakness defender for the fold-order pair
  "fix-bigbody": 35, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holder
});

export const SUPPORTER_CLAUSE_DECK = deckOf({
  "swsh10.5-027": 4, // Pikachu — "Buddy Bolt" (30+): youPlayedSupporterThisTurn, +30
  "sv01-180": 4, // Nemona (Supporter, "Draw 3 cards.") — the ONLY thing that arms the clause
  "fix-lightning-energy": 6, // Basic {L} — pays Buddy Bolt's typed symbol
  "fix-energy": 6, // Basic {C} — pays Buddy Bolt's two generic symbols
  "fix-lightning-weak": 7, // 130 HP, ×2 Lightning — the Weakness defender for the fold-order pair
  "fix-bigbody": 33, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holder
});

export const PROMOTED_CLAUSE_DECK = deckOf({
  "sv06.5-015": 4, // Revavroom ex — "Accelerator Flash" (20+) at index 0: yourActivePromotedThisTurn, +120
  "sv06.5-043": 3, // Varoom — the pre-evolution the evolution-SURVIVES-it case retreats in and evolves
  "swsh10.5-026": 3, // Golisopod — the SAME clause at +90, the proof the fold reads the captured amount
  "sv02-172": 4, // Boss's Orders (Supporter, gust) — the switchInto route on the OPPONENT's board
  "sv01-194": 3, // Switch (Item, switchActive) — the switchInto route on YOUR OWN board
  "fix-metal-energy": 5, // Basic {M} — pays Accelerator Flash's single typed symbol
  "fix-water-energy": 3, // Basic {W} — pays First Impression's single typed symbol
  "fix-energy": 5, // Basic {C} — pays the retreat cost (§11: any Energy) that arms the clause
  "fix-lightning-weak-big": 3, // 320 HP, ×2 Lightning — the Weakness defender for the fold-order pair
  "fix-bigbody": 27, // 200 HP neutral Colorless Basic — DOMINANT pinned starter, the retreater, the promote target
});

export const ATTACK_REQUIREMENT_DECK = deckOf({
  "sv03-062": 4, // Palafin — "Justice Kick" (210) at index 1: requires yourActivePromotedThisTurn
  "sv03-061": 3, // Finizen — the pre-evolution the evolution-SURVIVES-it case retreats in and evolves
  "sv03-117": 4, // Lycanroc — "Finishing Fang" (90) at index 0: requires opponentActiveDamaged;
  //                "Slashing Claw" (100) at index 1 is the no-effect-key negative AND the real damage source
  "sv01-194": 3, // Switch (Item, switchActive) — the SECOND route that arms Justice Kick
  "sv02-172": 3, // Boss's Orders (Supporter, gust) — promotes on the OPPONENT's board: the seat-asymmetry case
  "fix-water-energy": 6, // Basic {W} — pays Justice Kick's {W}{W}
  "fix-fighting-energy": 4, // Basic {F} — pays Finishing Fang's {F} and Slashing Claw's first symbol
  "fix-energy": 6, // Basic {C} — Slashing Claw's two generic symbols, and the retreat (§11) that arms Palafin
  "fix-lightning-weak-big": 4, // 320 HP — the only body in the pool that survives 210 (its Weakness is inert here)
  "fix-bigbody": 23, // 200 HP neutral Colorless Basic — DOMINANT pinned starter, the retreater, the promote target
});

export const COIN_FLIP_DECK = deckOf({
  "sv01-018": 4, // Tarountula — "Surprise Attack" (30) at index 0: cancelOnTails
  "sv03-036": 4, // Litwick — "Firebreathing" (10+) at index 0: bonusOnHeads, per 10
  "fix-grass-energy": 6, // Basic {G} — pays Surprise Attack's single symbol
  "fix-fire-energy": 6, // Basic {R} — pays Firebreathing's single symbol
  "fix-weak": 4, // 60 HP, ×2 FIRE — the pre-Weakness fold defender for Litwick's heads
  "fix-bigbody": 36, // 200 HP neutral Colorless Basic — DOMINANT pinned starter and the neutral defender
});

export const MULTI_COIN_FLIP_DECK = deckOf({
  "sv01-160": 4, // Tandemaus — "Double Hit" (30×) at index 0: perHeads, flips 2, per 30
  "sv06.5-048": 4, // Meowth — "Fury Swipes" (20×) at index 0: perHeads, flips 3, per 20
  "fix-energy": 8, // Basic {C} — pays both attacks' two generic symbols
  "fix-colorless-weak-big": 4, // 200 HP, ×2 COLORLESS — the pre-Weakness fold defender
  "fix-bigbody": 40, // 200 HP neutral Colorless Basic — DOMINANT pinned starter and the neutral defender
});

export const COIN_BONUS_DECK = deckOf({
  "fix-coinbonus": 4, // both printed sentences, indices 0 and 1, base "20+"
  "fix-energy": 12, // Basic {C} — pays both attacks' two generic symbols
  "fix-bigbody": 44, // 200 HP neutral Basic — DOMINANT pinned starter and the defender
});

export const PER_ENERGY_FLIP_DECK = deckOf({
  "sv01-035": 4, // Torkoal — "Concentrated Fire" (80×) at index 1: perHeads, attachedEnergy {R}, per 80
  "sv03-003": 4, // Bellossom — "Powerful Dance" (90×) at index 1: perHeads, attachedEnergy null, per 90
  "fix-flip-filter": 4, // CONSTRUCTED — {C} cost, {W} filter: the only route to a ZERO count
  "fix-fire-energy": 8, // Basic {R} — Torkoal's filter AND the {R} of its own cost
  "fix-water-energy": 8, // Basic {W} — pays Torkoal's two {C} while its {R} filter ignores them
  "fix-grass-energy": 6, // Basic {G} — pays Powerful Dance, and one type of its mixed pile
  "sv02-191": 3, // Luminous Energy — the WILDCARD Special (counts for every type, one CARD)
  "fix-special": 3, // an UNAUTHORED Special — Colorless by fallback, typed by nothing
  "fix-pokemon-v-weak": 2, // 210 HP, ×2 FIRE — the pre-Weakness fold defender for Torkoal
  "fix-titan": 18, // 340 HP neutral Basic — the pinned Active on both sides, and it survives 270
});

export const UNTIL_TAILS_FLIP_DECK = deckOf({
  "sv01-030": 4, // Growlithe — "Relentless Flames" (30×) at index 0: perHeads, untilTails, per 30
  "sv01-144": 4, // Chansey — "Egg Rolling" (60×) at index 1: perHeads, untilTails, per 60
  "sv03-174": 4, // Bouffalant — "Damage Rush" (50+) at index 0: bonusOnHeads, untilTails, per 30
  "sv01-117": 3,
  "fix-fire-energy": 4, // Basic {R} — pays Relentless Flames' single symbol
  "fix-fighting-energy": 3, // Basic {F} — pays Chomp Chomp Bite's single symbol, and nothing else
  "fix-energy": 8, // Basic {C} — pays Damage Rush's {C}{C} and Egg Rolling's {C}{C}{C}
  "fix-titan": 30, // 340 HP neutral Basic — the pinned Active on both sides, and no total here KOs it
});

export const COIN_THRESHOLD_DECK = deckOf({
  "fix-threshflip": 4, // all three printed sentences, at indices 0, 1 and 2
  "fix-energy": 8, // Basic {C} — pays every one of the three {C}{C} costs
  "sv02-193": 4, // Therapeutic Energy — the §12 immunity control on the DEFENDER
  "fix-titan": 44, // 340 HP neutral Basic — DOMINANT starter and the never-KO'd defender
});

export const SCOPED_HEAL_DECK = deckOf({
  "fix-scopedheal": 4, // both printed sentences, at indices 0 and 1 — the BASIC attacker
  "fix-scopedheal-evo": 4, // the same two attacks on a Stage 1 — the evolved body/attacker
  "fix-energy": 8, // Basic {C} — pays both {C}{C} costs
  "fix-titan": 44, // 340 HP neutral BASIC — dominant starter, bench filler, defender
});

export const PER_HEADS_PROGRAM_DECK = deckOf({
  "sv01-057": 4, // Wugtrio — "Undersea Tunnel" at index 1: programPerHeads, printed 3, mill 3
  "swsh10.5-022": 4, // Gyarados — "Wreak Havoc" at index 0: programPerHeads, untilTails, mill 2
  "fix-energy": 8, // Basic {C} — pays Undersea Tunnel's {C}{C}{C} and Wreak Havoc's {C}
  "fix-water-energy": 4, // Basic {W} — pays Wugtrio's index-0 "Headbutt" control, and nothing else
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

export const DECK_TOP_MILL_DECK = deckOf({
  "sv03-178": 4, // Skwovet — "Nicked Nibble" at idx 0: discardDeckTop, opponent, count 1 (singular)
  "swsh10.5-022": 4, // Gyarados — "Wild Splash" at idx 1: discardDeckTop, self, count 5, after 230 damage
  "fix-energy": 8, // Basic {C} — Skwovet's two attacks, and Wild Splash's {C}{C}
  "fix-water-energy": 6, // Basic {W} — Wild Splash's {W}{W}, and nothing else
  "fix-titan": 38, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

export const SELF_HEAL_DECK = deckOf({
  "sv02-098": 4, // Ceruledge — "Life Sucker" at idx 0: heal 30, AFTER a printed 50
  "swsh10.5-032": 4, // Natu — "Nap" at idx 0: heal 20, NO printed damage at all
  "fix-energy": 12, // Basic {C} — pays Life Sucker's {C}{C} and Nap's {C}
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides
});

export const BOARD_HEAL_DECK = deckOf({
  "sv02-037": 4, // Skeledirge ex — "Vitality Song" at idx 0: heal 30 each, AFTER a printed 50
  "sv06.5-021": 4, // Cresselia — "Healing Pirouette" at idx 0: heal 20 each, NO printed damage
  "fix-fire-energy": 6, // Basic {R} — pays Vitality Song's single Fire, and nothing else
  "fix-psychic-energy": 6, // Basic {P} — pays Healing Pirouette's single Psychic, and nothing else
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active BOTH sides + every bench body
});

export const FLIP_GATED_OP_DECK = deckOf({
  "sv02-035": 4, // Fuecoco — "Spacing Out" at idx 0: gated heal 30; "Flare" at idx 1: {R}{C} for 30
  "sv01-056": 4, // Wiglett — "Dig a Little" at idx 0: gated mill 1; "Ram" at idx 1: {C}{C} for 20
  "fix-energy": 10, // Basic {C} — pays both gated attacks' {C} and Ram's {C}{C}
  "fix-fire-energy": 4, // Basic {R} — pays Flare's Fire, and nothing else
  "fix-titan": 38, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

export const CHOSEN_HEAL_DECK = deckOf({
  "sv02-121": 4, // Nacli — "Salt Coating" at idx 0: heal 20, ANY zone; "Tackle" at idx 1: {F}{F} for 30
  "sv01-007": 4, // Tropius — "Fresh-Picked Fruit" at idx 0: heal 60, BENCH only; "Razor Leaf" at idx 1
  "fix-allheal": 4, // FIXTURE — Blissey/Arboliva's real "all" sentence on an invented Basic body
  "fix-fighting-energy": 5, // Basic {F} — pays Salt Coating's single Fighting (and Tackle's two)
  "fix-grass-energy": 5, // Basic {G} — pays Fresh-Picked Fruit's single Grass (and Razor Leaf's first)
  "fix-energy": 4, // Basic {C} — pays fix-allheal's {C}{C} line and Razor Leaf's second symbol
  "fix-titan": 34, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + every candidate body
});

export const COUNTER_MOVE_DECK = deckOf({
  "sv02-093": 4, // Dedenne ex — "Tail Swap" at idx 0 (the move, no damage); "Wondrous Shot" at idx 1 ({P}×3, 170)
  "fix-psychic-energy": 8, // Basic {P} — two pay Tail Swap, three pay Wondrous Shot
  "fix-psychic-weak-big": 4, // 200 HP ×2 Psychic, NO attacks — the flat-placement defender
  "fix-titan": 44, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + every bench candidate
});

export const COUNTER_PUT_DECK = deckOf({
  "sv02-097": 4, // Mimikyu — "Ghost Eye" at idx 0 ({P}{C}, 7 counters, no damage); Safeguard is a REGISTRY passive
  "sv03-098": 4, // Polteageist — "Antique Collecting" at idx 0 (loud), "Pour Tea" at idx 1 ({P}, 5 counters)
  "fix-psychic-energy": 6, // Basic {P} — two pay Ghost Eye ({P}{C}), one pays Pour Tea
  "fix-psychic-weak-big": 3, // 200 HP ×2 Psychic, NO attacks — the flat-placement defender, high side
  "fix-psychic-resist-big": 3, // 200 HP Psychic −30, NO attacks — the flat-placement defender, low side
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + the promote target
});

export const COUNTER_BENCH_PUT_DECK = deckOf({
  "sv02-127": 4, // Ting-Lu ex — "Land Scoop" at idx 0 ({F}{F}{F}, 150 damage + 2 counters); Cursed Land is a REGISTRY passive
  "fix-fighting-energy": 12, // Basic {F} — three pay each Land Scoop
  "sv03-174": 3, // Bouffalant — "Bouffer" (−20 after W/R): the reduction a placement must SKIP
  "sv02-097": 3, // Mimikyu — "Safeguard": the ex-prevention a placement must SKIP
  "fix-fighting-weak": 3, // 200 HP ×2 Fighting, inert — the Weakness a placement must SKIP
  "fix-titan": 35, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + the plain bench candidate
});

export const COUNTER_SPREAD_DECK = deckOf({
  "fix-spread-bench": 4, // Hex Hurl at idx 0 ({C}{C}{C}, 90 damage + 2 counters, opponentBench)
  "fix-spread-any": 4, // Cursed Drop at idx 0 ({G}, NO damage + 4 counters, opponentAny)
  "fix-grass-energy": 6, // Basic {G} — one pays Cursed Drop
  "fix-victim": 4, // 30 HP — the body three counters KO, and the stability witness
  "fix-titan": 42, // 340 HP neutral Basic, NO attacks — pinned Active both sides + bench filler
});

export const SCORCHING_ARMOR_DECK = deckOf({
  "sv03-044": 4, // Armarouge — Scorching Armor (onDamagedByAttack → Burn the attacker)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "fix-bigbody": 40, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 8, // Colorless Basic Energy — pays Bite's {C}
});

export const COUNTERATTACKING_PINCER_DECK = deckOf({
  "sv03-120": 4, // Klawf ex — Counterattacking Pincer (onDamagedByAttack → PARKING discard)
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "fix-bigbody": 30, // 200 HP neutral Basic — DOMINANT setup + the promote target
  "fix-energy": 9, // Colorless Basic Energy — pays Bite's {C}, one discard candidate
  "fix-fire-energy": 9, // Fire Basic Energy — the SECOND, DIFFERENT candidate that forces a PARK
});

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
  "fix-water-energy": 4,
  "fix-bigbody": 22, // 200 HP neutral Basic — DOMINANT setup Active + the displaced body
});

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

export const HEAL_UPTO_DECK = deckOf({
  "sv02-187": 3, // Saguaro
  "sv02-255": 2, // Saguaro (reprint)
  "sv02-270": 2, // Saguaro (reprint)
  "sv01-188": 2, // Potion — the exact-1 single arm, unchanged
  "fix-basic-1": 12,
  "fix-energy": 39,
});

export const PICNIC_BASKET_DECK = deckOf({
  "sv01-184": 4, // Picnic Basket
  "fix-basic-1": 20, // bodies for BOTH boards (Active + bench each)
  "fix-energy": 36,
});

export const JACQ_DECK = deckOf({
  "fix-basic-1": 24, // reliable Basic Active + Basic non-candidates
  "fix-stage1": 12, // Evolution Pokémon candidates
  "fix-stage2": 8, // more Evolution Pokémon candidates
  "sv01-175": 4, // Jacq — pulled into hand post-setup
  "fix-energy": 12, // non-Pokémon filler (rejected)
});

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

export const EMERGENCY_DECK = deckOf({
  "fix-emergencyevolution": 4,
  "fix-unfezant": 4,
  "fix-unfezant-ex": 4,
  "fix-tranquill": 4,
  "sv02-173": 4,
  "fix-bigbody": 16,
  "fix-energy": 24,
});

export const ABILITY_DECK = deckOf({
  "sv02-061": 4,
  "sv03-174": 4,
  "fix-basic-1": 12,
  "fix-water-energy": 24,
  "fix-energy": 16,
});

export const PREVENT_BLOCK_DECK = deckOf({
  "sv03-004": 4, // Scyther — "Agility" idx 0 ({C}, 10 + the WIDE install), "Cut" idx 1 (control)
  "sv03-151": 4, // Togedemaru — "Defense Curl" idx 0 ({C}, the NARROW install), "Rolling Tackle" idx 1
  "sv02-072": 4, // Pincurchin — "Needle Crush" ({L}{L}{L}, 70 + an Energy discard off the defender)
  "sv02-016": 4, // Tarountula — "Bind Down" ({G}, 10 + the retreat-lock rider)
  "sv02-097": 4, // Mimikyu — "Ghost Eye" ({P}{C}, 7 counters): the PUT, an effect and not damage
  "fix-attacker": 4, // Bite ({C}, 30) and Yawn (costless, Asleep on the defender)
  "fix-sniper": 2, // "Spread Shot" ({C}, 30 + 20 to EACH benched) — "done to THIS Pokémon" in one hit
  "fix-basic-1": 2, // an evolvable Basic — the §10 clear, which no legal sequence can reach
  "fix-stage1": 2, // …and what it evolves into
  "sv03-012": 2, // Trevenant — "Forest Miasma": the SAME damageActive op as an ATTACK, as an ABILITY
  "fix-hammer": 2, // fixture Item — the SAME discardEnergy op as an ATTACK, played as a TRAINER
  "sv02-172": 2, // Boss's Orders — the gust that drags a shielded body off the Active Spot
  "fix-energy": 6, // Colorless Basic — pays every {C} in the deck
  "fix-lightning-energy": 6, // {L}{L}{L} — two Needle Crushes' worth
  "fix-grass-energy": 3, // {G} — Bind Down
  "fix-psychic-energy": 4, // {P} — two Ghost Eyes' worth (the {C} half comes off fix-energy)
  "fix-metal-energy": 2, // {M} — Rolling Tackle's typed half
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — the bench filler and promote target
});

export const ATTACK_LOCK_DECK = deckOf({
  "sv01-048": 4, // Alomomola — "Surf" idx 0 (control + the refused sibling), "Aqua Slash" idx 1
  "sv03-029": 4, // Ninetales — "Will-O-Wisp" idx 0 (control), "Nine-Tailed Dance" idx 1
  "fix-mola-stage1": 3, // evolves from Alomomola — the §10 clear as a played line
  "sv01-194": 3, // Switch (Item) — retreat out, switch back, attack: the lock is GONE
  "sv02-172": 2, // Boss's Orders — the opponent dragging a locked body off the spot
  "fix-attacker": 3, // Bite ({C}, 30) and Yawn (costless, Asleep) — the §12 control
  "fix-basic-1": 2, // a plain evolvable Basic — the promote/bench body with a chain
  "fix-stage1": 2, // …what fix-basic-1 evolves into
  "fix-water-energy": 12, // {W}{W} for Aqua Slash and Bubble; the {C} comes off fix-energy
  "fix-fire-energy": 8, // {R}{R} — two Nine-Tailed Dances' worth
  "fix-energy": 12, // Colorless Basic — pays every {C} in the deck
  "fix-titan": 5, // 340 HP neutral Basic, NO attacks — bench filler and promote target
});

export const TAILS_GATE_DECK = deckOf({
  "sv01-157": 4, // Oinkologne — "Ram" idx 0 (control + refused sibling), "Leg Stomp" idx 1
  "sv02-130": 4, // Paldean Clodsire ex — "Needle Bone" idx 0, the family's OTHER index
  "sv01-048": 4,
  "fix-mola-stage1": 2, // evolves from Alomomola — the §10 clear as a played line
  "sv01-194": 3, // Switch (Item) — retreat out, switch back, attack: the lock is GONE
  "sv02-172": 2, // Boss's Orders — the opponent dragging a locked body off the spot
  "fix-attacker": 3, // Bite ({C}, 30) and Yawn (costless, Asleep) — the §12 control
  "fix-dark-energy": 6, // {D} — Needle Bone's typed third; the rest is Colorless
  "fix-water-energy": 8, // {W}{W} — Aqua Slash and Bubble
  "fix-energy": 19, // Colorless Basic — pays every {C}, and Leg Stomp wants three
  "fix-titan": 5, // 340 HP neutral Basic, NO attacks — bench filler and promote target
});

export const TAILS_SELF_COST_DECK = deckOf({
  "sv02-063": 4, // Pikachu ex — "Pika Punch" idx 0 (control), "Dynamic Bolt" idx 1 (the discard)
  "sv03-054": 4, // Beartic — "Icicle Punch" idx 0 (control), "Frost Purge" idx 1 (the same sentence)
  "sv03-183": 4, // Oinkologne — "Confounding Cologne" idx 0 (a different arm), "High-Impact Kick" idx 1
  "sv02-097": 2, // Mimikyu — Safeguard is a REGISTRY passive: the prevented-main-hit defender
  "fix-colorless-weak-big": 2, // 200 HP ×2 Colorless — the recoil's flatness witness
  "fix-basic-1": 2, // a plain Basic — the lone bench body a self-KO promotes
  "fix-lightning-energy": 8, // Basic {L} — Dynamic Bolt's two typed symbols, and the surplus "all" strips
  "fix-water-energy": 8, // Basic {W} — Frost Purge's two typed symbols, and Icicle Punch's one
  "fix-energy": 14, // Colorless Basic — every {C}, and High-Impact Kick's whole {C}{C}{C}
  "fix-titan": 12, // 340 HP neutral Basic, NO attacks — the pinned Active both sides
});

export const DAMAGE_REDUCTION_DECK = deckOf({
  "sv03-169": 4, // Swablu — "Fluffy Guard" idx 0 ({C}, no damage): the 20
  "sv06.5-043": 2, // Varoom — "Rigidify" idx 0 ({M}, no damage): a 30 ALREADY in the pool
  "sv01-001": 4, // Pineco — "Guard Press" idx 0 ({C}{C}, 10): the 30, and Forretress's pre-evolution
  "sv01-139": 4, // Forretress — "Rolling Shell" idx 1 ({M}{C}{C}, 90): the 50 and the INDEX control
  "sv02-048": 4, // Eiscue — "Frigid Block" idx 1 ({W}{W}{W}, 100): the 100, COMPOUND
  "fix-attacker": 3, // Fire — Bite ({C}, 30) and Flame ({F}{C}, 60), the main-hit attacker
  "sv01-069": 2, // Rotom — "Linear Attack" ({C}, opponentAny 20, deals): the snipeActive site
  "fix-sniper": 2, // "Spread Shot" ({C}, 30 + 20 to each benched): the spreadDamage site
  "fix-bramble": 2, // the per-40 benched `deals` snipe: placeSnipe's damage arm
  "sv02-172": 2, // Boss's Orders — the reachable §10 clear
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-energy": 14, // Colorless — every {C} slot in the deck
  "fix-fire-energy": 4, // {F} — Flame's typed half
  "fix-metal-energy": 4, // {M} — Rolling Shell's typed half
  "fix-water-energy": 6, // {W}{W}{W} — two Frigid Blocks' worth
});
export const TYPED_CLASS_BLOCK_DECK = deckOf({
  "fix-crown": 4, // the installer — idx 0 excluded, idx 1 not
  "fix-attacker": 4, // Fire BASIC — matched, prevented
  "fix-colorless-brawler": 4, // Colorless BASIC — excluded, lands full
  "fix-dual-colorless": 3, // Fire+Colorless BASIC — the `includes` probe
  "fix-stage1-brawler": 3, // Fire STAGE 1 — the stage conjunct's negative
  "fix-titan": 8, // 340 HP neutral Basic, NO attacks — bench filler
  "fix-energy": 34, // Colorless — every cost in this deck is {C}
});
export const DAMAGE_CAP_BLOCK_DECK = deckOf({
  "fix-carapace": 4, // the installer — idx 0 caps at 40, idx 1 at 60
  "fix-carapace-tough": 3, // …the same, with a printed −30 (the reduction witness)
  "fix-attacker": 4, // Fire BASIC — Bite 30 doubles to 60 into the Weakness
  "fix-colorless-brawler": 4, // Colorless BASIC — Cheap Shot 40, the exact boundary
  "fix-heavy": 4, // Colorless BASIC — Slam 70, over both caps
  "fix-titan": 7, // 340 HP neutral Basic, NO attacks — bench filler
  "fix-energy": 34, // Colorless — every cost in this deck is {C}
});
export const CLASS_BLOCK_DECK = deckOf({
  "sv01-150": 4, // Staraptor — "Tailspin Away" idx 0 (the filter), "Power Blast" idx 1 (180, Stage 2)
  "sv02-153": 4, // Noivern ex — "Covert Flight" idx 0 (the filter), "Dominating Echo" idx 1 (LOUD)
  "sv02-072": 3, // Pincurchin — BASIC {L}{L}{L} 70 + the defender-side Energy discard
  "sv02-097": 3, // Mimikyu — BASIC {P}{C}, 7 counters PLACED (an effect, not damage)
  "sv03-098": 3, // Polteageist — STAGE 1 {P}, 5 counters on the same op as Ghost Eye
  "fix-attacker": 3, // BASIC Bite ({C}, 30) and Yawn (costless, Asleep)
  "fix-sniper": 2, // BASIC "Spread Shot" ({C}, 30 + 20 to each benched)
  "sv02-172": 2, // Boss's Orders — the reachable §10 clear
  "fix-basic-1": 2, // a plain evolvable Basic — the §10 evolve clear
  "fix-stage1": 2, // …what it evolves into
  "fix-energy": 14, // Colorless Basic — both installs, Power Blast, Bite, Spread Shot, Ghost Eye's {C}
  "fix-lightning-energy": 8, // {L}{L}{L} — two Needle Crushes' worth
  "fix-psychic-energy": 5, // {P} — Ghost Eye's typed half, Pour Tea, and Dominating Echo's half
  "fix-dark-energy": 2, // {D} — the other half of Dominating Echo, the LOUD witness's cost
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
});

export const DEFENDER_LOCK_DECK = deckOf({
  "sv03-042": 4, // Eiscue ex — "Scalding Block" idx 0: the compound, and it PARKS
  "sv03-134": 4, // Houndoom ex — "Evil Claw" idx 0 (the gate), "Hound's Fang" idx 1 (control)
  "sv01-048": 4, // Alomomola — the BASIC victim: "Surf" idx 0, "Aqua Slash" idx 1 (self-lock)
  "fix-mola-stage1": 3, // evolves from Alomomola — the §10 clear AND the non-Basic victim
  "sv01-194": 3, // Switch (Item) — the victim's other route out of the window
  "sv02-172": 2, // Boss's Orders — the installer dragging a Basic up before Evil Claw
  "fix-attacker": 3, // Bite ({C}, 30) and Yawn (costless, Asleep) — the §12 control
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-water-energy": 12, // {W}{W}{W} for Scalding Block; {W} for Surf, Aqua Slash and Bubble
  "fix-dark-energy": 8, // {D}{D} for Evil Claw, {D}{D}{D} for Hound's Fang
  "fix-energy": 13, // Colorless Basic — every {C} in the deck
});

export const BARE_ATTACK_LOCK_DECK = deckOf({
  "fix-lockplural": 4, // "During your next turn, this Pokémon can't use attacks." at INDEX 1
  "fix-deflock": 4, // the defender lock in BOTH verbs — "can't attack" idx 0, "can't use attacks" idx 1
  "fix-attacker": 4, // the victim: costless "Yawn" (idx 2) and "Bite" (idx 0), so a refusal is the LOCK
  "fix-energy": 16, // Basic {C} — pays every printed cost in this deck
  "fix-titan": 32, // 340 HP neutral Basic, NO attacks — DOMINANT (mulligan-free), filler and promote target
});

export const COMPOUND_COMPOSE_DECK = deckOf({
  "fix-compound": 8,
  "fix-attacker": 4, // "Bounty" (idx 5) prints the LEADING clause of two of them ALONE
  "fix-energy": 16,
  "fix-fire-energy": 4, // Basic {R} — pays {C} too, so it costs the boards nothing
  "fix-titan": 28, // 340 HP neutral Basic, NO attacks — DOMINANT (mulligan-free) filler
});

export const ATTACK_DEBUFF_DECK = deckOf({
  "sv02-062": 4, // Pikachu — "Growl" idx 0 (the 20) AND "Pika Bolt" idx 1 (the main-hit attacker)
  "swsh10.5-061": 4, // Pidove — "Growl" idx 0 (the 20 again), ×2 Lightning / −30 Fighting
  "sv01-093": 2, // Florges — "Moonblast" idx 0 (the 30), and Blooming Garden
  "sv06.5-008": 4, // Houndoom — "Snarl" idx 1 (the 100), ×2 Water, "Bite" idx 0
  "sv01-048": 4,
  "fix-mola-stage1": 2, // evolves from Alomomola — the §10 evolve clear as a played line
  "sv03-030": 2, // Entei — 130 HP, "Blaze Ball", and the always-on member kept LOUD
  "sv01-069": 2, // Rotom — "Linear Attack": the snipeActive site
  "fix-sniper": 2, // "Spread Shot" (30 + 20 to each benched): the spreadDamage site
  "fix-bramble": 2, // the per-40 benched `deals` snipe: placeSnipe's damage arm
  "sv01-193": 2, // Rocky Helmet (Tool) — the `dealt > 0` boundary, from both sides
  "sv01-194": 2, // Switch (Item) — the victim's own route out of the window
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-energy": 13, // Colorless — every {C} slot in the deck
  "fix-fire-energy": 3, // {R} — Snarl's typed half
  "fix-water-energy": 4, // {W} — Surf, Aqua Slash and the evolution's Bubble
  "fix-lightning-energy": 3, // {L} — Pika Bolt's typed half
  "fix-psychic-energy": 2, // {P} — Moonblast's typed half
});

export const PRESSURE_DECK = deckOf({
  "sv03-030": 2, // Entei — "Pressure" (the aura) and "Blaze Ball" idx 0 ({C}{C}{C}, 60+)
  "sv02-062": 2,
  "sv01-048": 2, // Alomomola — "Surf" idx 0 ({W}{C}, 30): the ×2-Water board
  "sv02-127": 2, // Ting-Lu ex — "Cursed Land" (the §9 lock) + "Land Scoop" idx 0
  "sv01-069": 2, // Rotom — "Linear Attack" idx 0 ({C}, opponentAny 20): snipeActive
  "fix-feint": 2, // "Feint Attack" idx 0 ({C}, 50, ignoreWR): the coincident-body site
  "fix-sniper": 2, // "Spread Shot" ({C}, 30 + 20 to each benched): spreadDamage
  "fix-bramble": 4, // the per-40 benched `deals` snipe: placeSnipe's damage arm
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-energy": 28, // Colorless — every {C} slot in the deck
  "fix-fighting-energy": 5, // {F} — Land Scoop's three
  "fix-lightning-energy": 3, // {L} — Pika Bolt's typed half
  "fix-water-energy": 3, // {W} — Surf's typed half
});

export const INSTALLED_RECOIL_DECK = deckOf({
  "sv02-117": 3, // Lycanroc ex — "Scary Fangs" idx 1 (the armer), "Rock Throw" idx 0
  "fix-attacker": 4, // "Bite" ({C}, 30); 120 HP = the armed 100 + Rocky Helmet's 20
  "sv01-193": 2, // Rocky Helmet (Tool) — the CATALOG half of the §9 sum
  "sv01-005": 2, // Cacnea — Counterattack Quills (3 counters), the always-on control
  "sv02-062": 2, // Pikachu — "Growl" idx 0 (no printed damage): the outer gate
  "sv02-172": 2, // Boss's Orders — the opponent's §10 leave-Active route
  "sv01-194": 2, // Switch (Item) — the holder's own route, outside the window
  "sv01-048": 2, // Alomomola — a real pre-evolution, for the §10 EVOLVE clear
  "fix-mola-stage1": 2,
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-energy": 28, // Colorless — every {C} slot in the deck
  "fix-fighting-energy": 6, // {F} — Scary Fangs's and Rock Throw's typed half
  "fix-lightning-energy": 2, // {L} — Pika Bolt's typed half
});

export const PER_ATTACK_LOCK_DECK = deckOf({
  "sv03-142": 3, // Skarmory — "Slashing Steel" idx 1 (the bar), "Peck" idx 0 (still legal)
  "sv06.5-037": 2, // Munkidori ex — "Dirty Headbutt" idx 0: the ONE-attack control
  "sv03-179": 2, // Greedent ex — "Slip 'n' Roll" idx 1: the apostrophe capture
  "sv01-114": 2,
  "swsh10.5-018": 2, // Radiant Blastoise — "Torrential Cannon" idx 0: the uncatalogued one
  "fix-skarm-stage1": 2, // evolves from Skarmory — the §10 EVOLVE clear, on one attack
  "sv03-042": 2,
  "sv01-194": 2, // Switch (Item) — the holder's own §10 leave-Active route
  "sv02-172": 2, // Boss's Orders — the opponent's route into the same clear
  "fix-attacker": 2, // "Bite" ({C}, 30) — the opponent's plain swing
  "fix-curly-barrer": 2, // the U+2019 RE-INGEST, as a card — the install-side fold's witness
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-metal-energy": 6, // {M}{M} for Slashing Steel
  "fix-dark-energy": 4, // {D}{D} for Dirty Headbutt
  "fix-fighting-energy": 3, // {F} for Accelerating Stab and Avenging Knuckle
  "fix-water-energy": 6, // {W}{W}{W} for Scalding Block, {W}{W} for Torrential Cannon
  "fix-energy": 14, // Colorless Basic — every {C} in the deck
});

export const RADIANT_LOCK_DECK = deckOf({
  "swsh10.5-011": 4,
  "fix-titan": 10, // 340 HP neutral Basic, NO attacks — P2's Active and the bench filler
  "fix-fire-energy": 10, // {R} — Combustion Blast's first symbol
  "fix-energy": 36, // Colorless Basic — the {C}{C}{C}{C} behind it
});

export const PER_ATTACK_BUFF_DECK = deckOf({
  "sv03-052": 3,
  "fix-echoer": 3, // the constructed two-attack witness — the per-INDEX claim
  "fix-echoer-stage1": 2, // evolves from fix-echoer — the §10 EVOLVE clear, on one attack
  "sv02-037": 4, // Skeledirge ex — 340 HP, ×2 Water: the pre-W/R ORDER board
  "sv03-142": 2,
  "sv01-194": 2, // Switch (Item) — the holder's own §10 leave-Active route
  "sv02-172": 4, // Boss's Orders — the opponent's route into the same clear
  "sv01-197": 2, // Vitality Band (Tool) — the CATALOG half of the same `bonus` field
  "fix-booster-ability": 2, // a §9-SUPPRESSIBLE printed +30: the fold-vs-second-term board
  "sv02-127": 2, // Ting-Lu ex — "Cursed Land", the §9 Ability lock that switches it off
  "fix-curly-booster": 2,
  "fix-attacker": 3, // "Bite" ({C}, 30) — the opponent's plain swing, and the damage source
  "fix-titan": 6, // 340 HP neutral Basic, NO attacks — bench filler and KO boundary
  "fix-water-energy": 16, // {W}{W} for Echoed Voice and Echo Chorus, ×3 for the retreat
  "fix-energy": 7, // Colorless Basic — every {C} in the deck
});

export const OPPONENT_ATTACK_LOCK_DECK = deckOf({
  "sv02-094": 3, // Oranguru — "Plotter's Command" idx 0 (the barrer), "Super Psy Bolt" idx 1
  "sv01-111": 2,
  "fix-attacker": 4, // FOUR attacks — the park, and the body the headline boards bar
  "fix-echoer": 3, // TWO attacks — the park's floor, and the §10 EVOLVE route's base
  "fix-echoer-stage1": 2, // evolves from fix-echoer — ONE attack: the FORCED ending
  "sv01-194": 3, // Switch (Item) — the VICTIM's own §10 leave-Active route
  "sv02-172": 3, // Boss's Orders — the INSTALLER's route into the same clear
  "fix-titan": 6, // 340 HP, NO attacks — the SILENT ending, bench filler, promote target
  "fix-psychic-energy": 8, // {P} for Plotter's Command and Super Psy Bolt
  "fix-fighting-energy": 4, // {F} for Acu-Punch-Ture
  "fix-water-energy": 8, // {W}{W} for Echo Tap / Echo Chorus / Ripple
  "fix-energy": 14, // Colorless Basic — every {C} in the deck
});

export const VENGEFUL_PUNCH_DECK = deckOf({
  "sv03-197": 4,
  "sv01-193": 2, // Rocky Helmet — the DAMAGE-conditioned sibling, at the other read site
  "fix-attacker": 4, // "Bite" ({C}, 30) idx 0; "Yawn" idx 2 (no damage) — 120 HP
  "fix-sniper": 3, // "Spread Shot" ({C}, 30 + 20 to each bench) idx 0 — the BENCH KO
  "fix-wall": 6, // 120 HP, no attacks — the holder, on the Active spot or the bench
  "fix-bigbody": 24, // 200 HP — DOMINANT setup Basic, the surviving holder, promote target
  "fix-titan": 3,
  "fix-trainerops": 2,
  "fix-energy": 12, // Colorless Basic Energy — pays Bite's, Spread Shot's and Slip Away's {C}
});

export const MUNKIDORI_DECK = deckOf({
  "sv06.5-037": 4,
  "sv06.5-039": 3, // Pecharunt ex — the printed board condition, matched by NAME
  "sv02-126": 2, // Glimmora — the on-KO sibling that must NOT acquire the cause gate
  "sv01-118": 2, // Hawlucha — "Flying Entry": the MID-TURN, NON-ATTACK KO vehicle
  "fix-koprize": 2, // FIXTURE — the same reduction on a 1-Prize body (the clamp)
  "fix-attacker": 4, // "Bite" ({C}, 30) idx 0; "Yawn" idx 2 (no damage) — 120 HP
  "fix-sniper": 3, // "Spread Shot" ({C}, 30 + 20 to each bench) idx 0 — the BENCH KO
  "fix-bigbody": 24, // 200 HP — DOMINANT setup Basic, promote target, spread-proof
  "fix-titan": 4, // 340 HP, no attacks — bench filler a 20 spread cannot KO
  "fix-energy": 12, // Colorless Basic Energy — pays Bite's and Spread Shot's {C}
});

export const EXP_SHARE_DECK = deckOf({
  "sv01-174": 4,
  "sv01-193": 2, // Rocky Helmet — a Tool with a `passive` and no trigger: the scan's negative
  "sv01-096": 2, // Klefki — "Mischievous Lock": a §9 aura that must NOT reach a Tool
  "fix-victim": 4, // 30 HP, no attacks — the DYING ACTIVE that Bite one-shots
  "fix-attacker": 4, // "Bite" ({C}, 30) idx 0; "Yawn" idx 2 (no damage) — 120 HP
  "fix-sniper": 2, // "Spread Shot" ({C}, 30 + 20 each bench) — kills the Active AND hurts the holder
  "sv02-097": 2, // Mimikyu — "Ghost Eye": NO printed damage, 7 counters. The seed-gate witness
  "fix-titan": 4, // 340 HP, no attacks — bench filler / a second holder
  "fix-special": 4, // Special Energy — what the printed "a Basic Energy" refuses
  "fix-fire-energy": 4, // a SECOND Basic Energy type, so the pick is a real choice
  "fix-psychic-energy": 4, // {P} — Ghost Eye's typed half
  "fix-energy": 12, // Colorless Basic Energy — pays Bite's and Spread Shot's {C}
  "fix-bigbody": 12, // 200 HP — DOMINANT setup Basic, the Tool HOLDER, promote target
});

export const LEGACY_PRIZE_DECK = deckOf({
  "fix-legacy-energy": 4, // Legacy Energy — the wildcard + the capped reduction
  "fix-lillies-pearl": 4, // Lillie's Pearl — the same reduction on a TOOL
  "fix-lillie-body": 4, // "Lillie's Clefairy", 70 HP, 1 Prize — the gated holder
  "fix-legacy-ex": 4, // "Lillie's Clefable ex", 260 HP, 2 Prizes — the decrement
  "fix-pearl-nobody": 4, // "Clefairy", 70 HP — the owner gate's near miss
  "sv02-126": 2, // Glimmora — the on-KO Prize GUARD this must compose with
  "sv06.5-037": 2,
  "sv06.5-039": 2, // Pecharunt ex — Munkidori's printed board clause, by NAME
  "sv01-193": 2, // Rocky Helmet — the ONLY way to kill the ATTACKER on its own
  //   sweep, which is the board the printed possessive ("from your OPPONENT'S
  //   Pokémon") is the whole content of: `finishAttack` passes BOTH seats.
  "fix-attacker": 4, // "Bite" ({C}, 30) idx 0; "Yawn" idx 2 (no damage) — 120 HP
  "fix-titan": 2, // 340 HP, no attacks — bench filler
  "fix-energy": 12, // Colorless Basic Energy — pays Bite's {C}
  "fix-bigbody": 14, // 200 HP — DOMINANT setup Basic, promote target
});

export const ATTACKER_FILTER_DECK = deckOf({
  "sv01-099": 3, // Dachsbun — "Well-Baked Body" ({R}); its Burn-immunity clause stays LOUD
  "sv03-078": 3, // Bellibolt — "Insulator" ({L})
  "sv03-201": 2, // Bellibolt (Illustration rare) — the reprint, for the id-keyed claim
  "sv03-070": 3, // Thundurus — "Adverse Weather" (Active shields the BENCH)
  "sv06.5-060": 4, // Neutralization Zone (Stadium, ACE SPEC) — both boards, no Rule Box, ex/V
  "fix-attacker": 3, // FIRE, no rule box — Dachsbun's match / Bellibolt's + the Stadium's miss
  "sv02-063": 3, // Pikachu ex — LIGHTNING *and* an ex: Bellibolt's match + the Stadium's attacker
  "fix-attacker-ex": 3, // FIRE ex — "Spread Shot" idx 1 reaches the whole opposing board
  "fix-attacker-vmax": 2, // a rule box that is NOT ex/V — the predicate-separating board
  "fix-sniper": 3, // FIRE, no rule box — the spread Thundurus's shield answers
  "fix-feint": 3, // LIGHTNING, `ignoreWR` — the on-target / off-target pair, one attack
  "sv06.5-038": 3, // Fezandipiti ex — the only ex with an `opponentAny` snipe
  "sv01-069": 3, // Rotom — its LIGHTNING, no-rule-box counterpart
  "sv02-127": 3, // Ting-Lu ex — "Cursed Land" (§9) and an ex, on one body
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 4, // 200 HP neutral Basic — the no-Rule-Box body the Stadium protects
  "fix-fighting-energy": 5, // {F}{F}{F} — Land Scoop's cost, and nothing else in the deck
  "fix-energy": 7, // Colorless Basic — every other cost here
});

export const ALWAYS_ON_REDUCTION_DECK = deckOf({
  "sv02-113": 4, // Hariyama — "Arm Thrust Practice" (10 seat-wide); {F}, Stage 1, ×2 Psychic
  "sv01-192": 4, // Rock Chestplate (Tool) — 30, gated on the HOLDER's {F}
  "sv01-139": 3, // Forretress — "Rolling Shell" idx 1 ({M}{C}{C}, 90): the INSTALLED 50, ×2 Fire, METAL
  "fix-attacker": 3, // FIRE — Bite idx 0 ({C}, 30) and Flame idx 1 ({R}{C}, 60): the main hit
  "fix-sniper": 3, // "Spread Shot" idx 0 ({C}, 30 + 20 each benched): the spreadDamage site
  "sv01-069": 3, // Rotom — "Linear Attack" idx 0 ({C}, opponentAny 20, deals): both snipe arms
  "fix-feint": 3, // "Feint Attack" idx 0 ({C}, opponentAny 50, ignoreWR): the per-board split
  "sv02-127": 3, // Ting-Lu ex — "Cursed Land" (§9) and "Land Scoop" idx 0 ({F}{F}{F}, 150)
  "fix-titan": 3, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 3, // 200 HP neutral Basic — a Colorless body the seat aura still protects
  "fix-fighting-energy": 6, // {F}{F}{F} — Land Scoop, and Rocket Slap's typed half
  "fix-fire-energy": 3, // {R} — Flame's typed half
  "fix-metal-energy": 3, // {M} — Rolling Shell's typed half
  "fix-energy": 16, // Colorless Basic — every other cost in the deck
});

export const SELF_SCALING_PENALTY_DECK = deckOf({
  "sv01-060": 4,
  "sv02-037": 4, // Skeledirge ex — "Burning Voice" idx 1 (TEN), and the ×2 Water 340 HP defender
  "sv03-030": 2, // Entei — "Pressure": the other source of the same `debuff` field
  "sv02-127": 2, // Ting-Lu ex — "Cursed Land", the §9 lock an attack's own text escapes
  "sv01-197": 2, // Vitality Band (Tool) — the ADDING half inside the same clamp
  "fix-attacker": 2, // "Rage" idx 3 / "Fury" idx 4 — the MORE twin on the same count source
  "fix-titan": 10, // 340 HP neutral Basic, NO attacks — starter, bench filler, clean defender
  "fix-water-energy": 8, // {W} — Sweeping Tackle's typed symbol
  "fix-fire-energy": 8, // {R}{R} — Burning Voice
  "fix-energy": 18, // Colorless Basic — every {C} in the deck
});

export const SELF_COUNTER_MULTIPLY_DECK = deckOf({
  "sv01-089": 4,
  "swsh10.5-036": 4,
  "sv01-060": 2, // Cetitan — "Sweeping Tackle": the LESS twin on the same count source
  "fix-attacker": 2, // "Rage" idx 3 / "Fury" idx 4 — the MORE twin on the same count source
  "fix-psychic-weak": 2, // 200 HP, ×2 Psychic — the pre-W/R ORDER board for Balloon Blast
  "fix-titan": 12, // 340 HP neutral Basic, NO attacks — starter, bench filler, clean defender
  "fix-psychic-energy": 8, // {P}{P} — Balloon Blast
  "fix-fighting-energy": 8, // {F}{F} — Raging Swing's typed symbols
  "fix-water-energy": 4, // {W} — Sweeping Tackle's typed symbol
  "fix-energy": 14, // Colorless Basic — every {C} in the deck
});

export const OPPONENT_COUNTER_DECK = deckOf({
  "sv01-095": 4,
  "sv03-086": 4, // Espeon — "Psychic Assault" idx 0: the SAME sentence, second card
  "sv06.5-025": 4, // Bloodmoon Ursaluna — "Mad Bite" idx 0: the THIRTY-per-counter one
  "sv03-066": 3, // Tyranitar ex — 340 HP ×2 Fighting: the pre-W/R ORDER witness
  "fix-titan": 10, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-psychic-energy": 8, // {P} — Second Bite, Psychic Assault, Psy Bolt
  "fix-fighting-energy": 8, // {F}{F} — Mad Bite's typed half
  "fix-energy": 19, // Colorless Basic — every {C} in the deck
});

export const OWN_BENCH_SPREAD_DECK = deckOf({
  "fix-tremor": 4, // the 10, both possessives, indices 0 and 1
  "sv01-117": 3, // Krookodile — "Earthquake" idx 1 ({F}{F}, 180 + 30 own bench)
  "swsh10.5-043": 3, // Tyranitar — "Earthquake" idx 1 ({D}{D}{C}{C}, 180 + 20 own bench)
  "fix-fighting-weak": 6, // 200 HP ×2 Fighting — the W/R witness and its Active control
  "fix-titan": 14, // 340 HP neutral Basic, NO attacks — filler, defender, un-KO-able body
  "fix-fighting-energy": 6, // {F}{F} — Krookodile's whole cost
  "fix-darkness-energy": 6, // {D}{D} — Tyranitar's typed half
  "fix-energy": 18, // Colorless — every {C} slot on this list
});

export const OWN_BENCH_SNIPE_DECK = deckOf({
  "fix-pinpoint": 4, // the three printed sentences, indices 0, 1 and 2
  "fix-fighting-weak": 6, // 200 HP ×2 Fighting — the W/R witness and its Active control
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — filler, defender, un-KO-able body
  "fix-onko": 6, // 30 HP — the body index 1's 40 Knocks Out in one hit, on either bench
  "fix-energy": 28, // Colorless — every {C} slot on this list
});

export const BENCH_COUNTER_DECK = deckOf({
  "swsh10.5-043": 4, // Tyranitar — "Raging Crash" idx 0: the whole family
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, damaged bench, clean defender
  "fix-darkness-weak": 3, // 200 HP ×2 Darkness — the base-drop-through-W/R board
  "fix-darkness-energy": 8, // {D}{D} — Earthquake's typed half, and nothing else
  "fix-energy": 29, // Colorless Basic — Raging Crash's whole cost, and every other {C}
});

export const STATUS_IMMUNITY_DECK = deckOf({
  "sv01-068": 3, // Pachirisu — "Electricity Pouches" ("can't be Paralyzed")
  "sv01-208": 2, // Pachirisu (Illustration rare) — the reprint, for the id-keyed claim
  "sv01-099": 3, // Dachsbun — "Well-Baked Body" ("can't be Burned" + the {R} prevention)
  "sv01-029": 3, // Scovillain — "Hot Bite" (idx 0, {C}, 20): the SEED-FREE Burn
  "fix-statuser": 4, // Hypnosis / Confuse Ray / Numbing Bolt / Toxic on one body
  "sv03-044": 3, // Armarouge — "Scorching Armor": the Burn that lands on the ATTACKER
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, Basic, both sides, Active-only)
  "sv02-127": 3, // Ting-Lu ex — "Cursed Land" (§9, damaged, opponent, Active-only)
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 17, // 200 HP neutral Basic — the NON-IMMUNE control, and the setup starter
  "fix-fighting-energy": 5, // {F}{F}{F} — Land Scoop's cost, and nothing else in the deck
  "fix-psychic-energy": 3, // {P} — Dachsbun's own "Headbutt Bounce" ({P}{C}{C}), the Armarouge board
  "fix-energy": 7, // Colorless Basic — Hot Bite, and Headbutt Bounce's two {C}
});

export const THERAPEUTIC_ENERGY_DECK = deckOf({
  "sv02-193": 4,
  "fix-statuser": 4, // Hypnosis / Confuse Ray / Numbing Bolt / Toxic on one body
  "sv01-029": 3, // Scovillain — "Hot Bite" ({C}, 20 + Burn): the condition NOT named
  "sv01-068": 3, // Pachirisu — the §9-SUPPRESSIBLE immunity, beside the exempt one
  "sv01-096": 3, // Klefki — "Mischievous Lock" (§9, Basic, both sides, Active-only)
  "sv02-190": 2, // Jet Energy — the other on-attach Special, for the ordering claim
  "sv03-193": 2, // Poppy — the ONLY program that can MOVE a Special Energy (anyEnergy)
  "sv01-174": 2, // Exp. Share — a Tool with NO passive: the §7.4 moment, isolated
  "sv02-123": 2, // Garganacl "Blessed Salt" — a betweenTurns program, for the Checkup moment
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 24, // 200 HP neutral Basic — the control, and the setup starter
  "fix-energy": 7, // Colorless Basic — Hot Bite's cost, and the control attach
});

export const CLEAR_STATUS_DECK = deckOf({
  "sv01-086": 3, // Gardevoir ex — "Miracle Force" (idx 0, {P}{P}{C}, 190): the ATTACK half
  "sv01-228": 2, // Gardevoir ex (Ultra Rare) — the reprint, DRIVEN not just pinned
  "sv01-245": 2, // Gardevoir ex (Special illustration rare) — the second reprint
  "sv01-145": 3, // Blissey — "Busybody Nurse": the ABILITY half, benchable
  "fix-statuser": 4, // Hypnosis / Confuse Ray / Numbing Bolt / Overheat / Toxic on one body
  "sv01-096": 2, // Klefki — "Mischievous Lock" (§9, Basic, both sides, Active-only)
  "fix-titan": 4, // 340 HP neutral Basic, NO attacks — bench filler and promote target
  "fix-bigbody": 22, // 200 HP neutral Basic — the control, and the setup starter
  "fix-psychic-energy": 10, // Basic {P} — Miracle Force's {P}{P}
  "fix-energy": 8, // Colorless Basic — Miracle Force's {C}
});

export const KO_SURVIVAL_DECK = deckOf({
  "fix-sturdy": 6, // THE demonstrator — 120 HP Basic, the printed sentence
  "fix-sturdytiny": 2, // 20 HP twin — the CHECKUP-boundary witness
  "fix-koblast": 4, // the attacker: one attack per write site + the counter control
  "sv03-197": 3, // Vengeful Punch — damageAttackerOnKo: must go SILENT on a clamp
  "sv01-193": 3, // Rocky Helmet — damageAttacker: must STILL FIRE on the same hit
  "sv02-173": 2, // Bravery Charm — +50 HP on a Basic: the effectiveMaxHp witness
  "sv01-096": 2, // Klefki — Mischievous Lock: the §9 answer, driven not read
  "fix-titan": 3, // 340 HP, no attacks — bench filler
  "fix-bigbody": 22, // 200 HP — the dominant Basic, promote target, no-Ability control
  "fix-energy": 13, // Colorless Basic — every fix-koblast attack costs one {C}
});

export const COUNTER_MOVE_CHOSEN_DECK = deckOf({
  "fix-cofagrigus": 4, // THE attacker — both sentences, one index apart
  "fix-titan": 28, // 340 HP, no attacks — interchangeable bench filler, both seats
  "fix-bigbody": 8, // 200 HP — the NAMED destination whose damage is read
  "fix-victim": 4, // 30 HP — the destination a moved stack can KO
  "fix-energy": 16, // Colorless Basic — every fix-cofagrigus attack costs one {C}
});

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

export function clearBench(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const returned = side.bench.flatMap((p) => [...p.stack, ...p.energy, ...p.tools]);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, bench: [], deck: [...side.deck, ...returned] },
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
  if (side.bench[index] === undefined)
    throw new Error(`${seat} has no benched Pokémon at ${index}`);
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

/** Complete opening placement without taking any compensation cards yet. */
export function finishOpeningSetup(initial: GameState): { state: GameState; events: GameEvent[] } {
  let state = initial;
  const events: GameEvent[] = [];
  while (state.phase.kind === "setup:place" && state.phase.stage === "opening") {
    const phase = state.phase;
    const seat = SEATS.find(
      (s) =>
        !phase.ready[s] &&
        (state.players[s].active !== null ||
          state.players[s].hand.some((uid) => {
            const card = cardOfUid(state, uid);
            return card !== undefined && isBasicPokemon(card);
          })),
    );
    if (seat === undefined) throw new Error("No player can complete opening setup");
    if (state.players[seat].active === null) {
      const placed = mustApply(state, {
        type: "setupPlaceActive",
        seat,
        uid: firstBasicInHand(state, seat),
      });
      state = placed.state;
      events.push(...placed.events);
    }
    const readied = mustApply(state, { type: "setupReady", seat });
    state = readied.state;
    events.push(...readied.events);
  }
  return { state, events };
}

/** Scripts opening placements, prizes, compensation and bonus Bench choices. */
export function driveSetup(
  seed: number,
  decks: { p1: string[]; p2: string[] } = { p1: MIXED_DECK, p2: MIXED_DECK },
  opts: SetupOptions = {},
): GameState {
  return completeSetup(mustCreate(seed, decks).state, opts);
}

/** Complete setup using the state's own card pool, including file-local test cards. */
export function completeSetup(initial: GameState, opts: SetupOptions = {}): GameState {
  let state = initial;
  if (state.phase.kind === "setup:chooseFirst") {
    const winner = state.phase.coinWinner;
    state = must(
      applyAction(state, {
        type: "chooseFirstPlayer",
        seat: winner,
        first: opts.first ?? winner,
      }),
    );
  }
  const pendingBench = { p1: [...(opts.bench?.p1 ?? [])], p2: [...(opts.bench?.p2 ?? [])] };
  while (state.turn === 0) {
    const phase = state.phase;
    if (phase.kind === "setup:drawExtra") {
      const seat = SEATS.find((s) => !phase.decided[s]);
      if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
      state = must(
        applyAction(state, {
          type: "setupDrawExtra",
          seat,
          count: opts.extraDraw?.[seat] ?? phase.owed[seat],
        }),
      );
      continue;
    }
    if (phase.kind !== "setup:place") throw new Error(`Unexpected setup phase: ${phase.kind}`);
    const seat = SEATS.find(
      (s) =>
        !phase.ready[s] &&
        (state.players[s].active !== null ||
          state.players[s].hand.some((uid) => {
            const card = cardOfUid(state, uid);
            return card !== undefined && isBasicPokemon(card);
          })),
    );
    if (seat === undefined) throw new Error("No player can complete setup");
    if (state.players[seat].active === null) {
      const activeId = opts.active?.[seat];
      const uid =
        activeId === undefined ? firstBasicInHand(state, seat) : handUid(state, seat, activeId);
      state = must(applyAction(state, { type: "setupPlaceActive", seat, uid }));
    }
    for (const benchId of [...pendingBench[seat]]) {
      const uid = state.players[seat].hand.find(
        (uid) =>
          state.cardIdByUid[uid] === benchId &&
          (phase.stage !== "bonus" || phase.bonusCards?.[seat].includes(uid)),
      );
      if (uid === undefined) continue;
      state = must(applyAction(state, { type: "setupPlaceBench", seat, uid }));
      pendingBench[seat].splice(pendingBench[seat].indexOf(benchId), 1);
    }
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  if (pendingBench.p1.length || pendingBench.p2.length)
    throw new Error("Requested setup Bench card unavailable");
  return state;
}

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

export function attachToolFromDeck(
  state: GameState,
  seat: Seat,
  target: "active" | number,
  cardId: string,
): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  if (target === "active" && side.active === null) throw new Error(`${seat} has no Active Pokémon`);
  if (target !== "active" && side.bench[target] === undefined) {
    throw new Error(`${seat} has no benched Pokémon at ${target}`);
  }
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active:
          target === "active" && side.active !== null
            ? { ...side.active, tools: [...side.active.tools, uid] }
            : side.active,
        bench:
          target === "active"
            ? side.bench
            : side.bench.map((pokemon, i) =>
                i === target ? { ...pokemon, tools: [...pokemon.tools, uid] } : pokemon,
              ),
      },
    },
  };
}

export function attachBenchFromDeck(
  state: GameState,
  seat: Seat,
  index: number,
  cardId: string,
  count: number,
): GameState {
  const side = state.players[seat];
  if (side.bench[index] === undefined)
    throw new Error(`${seat} has no benched Pokémon at ${index}`);
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

export function toDeckTop(state: GameState, seat: Seat, cardId: string, count: number): GameState {
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

export function trimDeckTo(state: GameState, seat: Seat, size: number): GameState {
  const side = state.players[seat];
  const keep = Math.max(0, size);
  if (side.deck.length <= keep) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        deck: side.deck.slice(0, keep),
        discard: [...side.discard, ...side.deck.slice(keep)],
      },
    },
  };
}

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

export function walkProgram(ops: readonly EffectOp[]): EffectOp[] {
  const out: EffectOp[] = [];
  const visit = (list: readonly EffectOp[]): void => {
    for (const op of list) {
      out.push(op);
      for (const nested of subPrograms(op)) visit(nested);
    }
  };
  visit(ops);
  return out;
}

function subPrograms(op: EffectOp): EffectOp[][] {
  const found: EffectOp[][] = [];
  for (const value of Object.values(op as unknown as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const every = value.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as { op?: unknown }).op === "string",
    );
    if (every) found.push(value as EffectOp[]);
  }
  return found;
}

export function programBranchCarriers(ops: readonly EffectOp[]): Map<string, Set<string>> {
  const carriers = new Map<string, Set<string>>();
  for (const op of walkProgram(ops)) {
    for (const [key, value] of Object.entries(op as unknown as Record<string, unknown>)) {
      if (subPrograms(op).includes(value as EffectOp[])) {
        const keys = carriers.get(op.op) ?? new Set<string>();
        keys.add(key);
        carriers.set(op.op, keys);
      }
    }
  }
  return carriers;
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

export const TRAINER_OPS_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-basic-1": 14, // both Benches — the self-switch's and the gust's
  "fix-bigbody": 16, // 200 HP control body / setup starter
  "fix-energy": 24, // Colorless Basic — every attack here costs {C}
});

export const NEW_ACTIVE_DAMAGE_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-colorless-weak": 7, // 200 HP ×2 Colorless — the promoted body under W/R
  "fix-basic-1": 7,
  "fix-bigbody": 16, // 200 HP control body / setup starter
  "fix-energy": 24, // Colorless Basic — every attack here costs {C}
});

export const SELF_ENERGY_MOVE_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-basic-1": 14,
  "fix-bigbody": 16, // 200 HP control body / setup starter
  "fix-energy": 20, // Colorless Basic — every attack here costs {C}
  "fix-special": 4, // the `basicEnergy` filter's only discriminator
});

export const SPREAD_ENERGY_MOVE_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-basic-1": 14,
  "fix-bigbody": 16, // 200 HP control body / setup starter
  "fix-energy": 16, // Colorless Basic — every attack here costs {C}
  "fix-metal-energy": 8, // the `providesEnergy {Metal}` filter's only discriminator
});

export const OPPONENT_ENERGY_MOVE_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-basic-1": 18, // the Bench population on BOTH boards — sources and destinations
  "fix-bigbody": 12, // 200 HP control body / setup starter, both seats
  "fix-energy": 18, // Colorless Basic — every attack here costs {C}, and the Energy that moves
  "fix-mist-energy": 6, // the §11 shield, and a movable {C} Energy in its own right
});

export const BENCH_SEARCH_DECK = deckOf({
  "fix-trainerops": 6,
  "fix-charjabug": 6, // the `byName` arm's only candidates — and NOT Basic
  "fix-basic-1": 18, // the `basicPokemon` arm's candidates and the Bench population
  "fix-bigbody": 12, // 200 HP control body / setup starter
  "fix-energy": 18, // Colorless Basic — every attack here costs {C}
});

export const HAND_SEARCH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 14, // `anyPokemon`'s candidates and the setup starters
  "fix-energy": 16, // Colorless Basic — `basicEnergy` AND `anyEnergy`
  "fix-special": 4, // `anyEnergy` ONLY — the pair that separates the two
  "fix-item": 6, // `item`'s only candidates
  "fix-tool": 6, // `toolCard` — and what `item` must refuse
  "fix-gatedsup": 4, // `supporter`
  "fix-stadium": 4, // `stadium`
});

export const OPPONENT_HAND_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 18, // the setup starters and the Bench population
  "fix-energy": 20, // Colorless Basic — every attack here costs {C}
  "fix-item": 4, // the four lines below exist to be TOLD APART in a hand
  "fix-tool": 4,
  "fix-gatedsup": 4,
  "fix-stadium": 4,
});

export const DISCARD_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 16, // the setup starters and the Benched targets
  "sv03-161": 2, // Drampa — the ONLY Dragon body, for the {N} destination
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — every attack's cost AND the untyped pile
  "fix-fighting-energy": 8, // {F} — Regi Charge's filter
  "fix-fire-energy": 4, // {R} — Dragon's Fury's filter
  "fix-water-energy": 4, // the type BOTH typed filters must refuse
});

export const DECK_SEARCH_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 16, // the setup starters and the Benched targets
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — every attack's cost AND the untyped searches
  "fix-water-energy": 6, // {W} — Aqua Supply's and Water Draw's filter
  "fix-lightning-energy": 6, // {L} — Zap Charge's and Bench Charge's filter
  "fix-darkness-energy": 6, // {D} — Toxic Reserve's filter, and NOTHING else's
});

export const TWO_NOUN_SEARCH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 16, // the setup starters and the Benched targets
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — the attack's cost, and NEITHER noun's filter
  "fix-grass-energy": 6, // {G} — Split Harvest's FIRST printed noun
  "fix-lightning-energy": 6, // {L} — Split Harvest's SECOND printed noun
  "fix-water-energy": 6, // {W} — named by NEITHER noun, so the filters are falsifiable
});

export const HAND_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 16, // the setup starters and the Benched targets
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — every attack's cost AND the untyped attaches
  "fix-psychic-energy": 9, // {P} — Full Heart's filter
  "fix-grass-energy": 9, // {G} — Leaflet Blessings' filter, and NOTHING else's
});

export const DERIVED_RETRIEVAL_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 8, // the setup starters and the Bench population (5 seatable)
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 8, // Colorless Basic — every attack's cost, and `energyType`'s near miss
  "fix-duskull": 7, // Duskull — the `byName` target, deep enough to bench three
  "fix-charjabug": 3,
  "fix-water-basic": 4, // Basic {W} — "up to 3 {W} Pokémon", deep enough to bench three
  "fix-dual-basic": 3, // ["Fire","Water"] — the `includes`-not-`types[0]===` witness
  "fix-grass-energy": 4, // Basic {G} — "a Basic {G} Energy card"
  "fix-water-energy": 3, // Basic {W} — a typed Energy of the WRONG type, beside the Colorless one
  "fix-gatedsup": 3, // Supporter — one of the four Trainer subtypes
  "fix-item": 3, // Item
  "fix-tool": 3, // Pokémon Tool
  "fix-stadium": 3, // Stadium — with the three above, `trainerCard` has 4 subtypes
});

export const DERIVED_LOOK_TOP_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 19, // the Bench population, the starters, and the attach window's non-Energy
  "fix-bigbody": 3, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 16, // Colorless Basic — every attack's cost, `anyEnergy`'s basic half, and
  //                   the bench window's NON-Pokémon filler
  "fix-special": 8,
  "fix-duskull": 8, // a second named Pokémon line, so "any number of Pokémon" is not one id
});

export const FIRST_TURN_SUPPORTER_DECK = deckOf({
  "fix-carmine": 4,
  "sv01-180": 4, // Nemona — the ordinary Supporter, the control
  "fix-bigbody": 20,
  "fix-energy": 32,
});

export const NS_PLAN_DECK = deckOf({
  "fix-nsplan": 4,
  "sv03-193": 4, // Poppy — the single-source control, same op, same max
  "fix-basic-1": 12,
  "fix-basic-2": 8,
  "fix-energy": 16,
  "fix-fire-energy": 8,
  "fix-water-energy": 8,
});

export const SEAT_AURA_DECK = deckOf({
  "fix-regalcheer": 8,
  "fix-cynthia-aura": 8,
  "fix-cynthia-body": 8,
  "fix-hop-aura": 8,
  "fix-plain-body": 8,
  "sv01-096": 4,
  "fix-basic-1": 8,
  "fix-energy": 8,
});

export const BENCH_SWITCH_DECK = deckOf({
  "fix-rapidvernier": 8,
  "fix-showtime": 8,
  "fix-switch-ally": 8,
  "fix-plain-body": 8,
  "fix-othersmove": 4, // the CONSTRUCTED demonstrator that separates othersToSelf from benchToActive
  "sv01-096": 4,
  "fix-basic-1": 8,
  "fix-energy": 8,
  "fix-special": 4, // the SPECIAL Energy that makes `anyEnergy` distinguishable from `basicEnergy`
});

export const AURA_NARROWING_DECK = deckOf({
  "fix-sunnyday": 6,
  "fix-victorycheer": 6,
  "fix-primalknowledge": 5,
  "fix-grass-attacker": 5,
  "fix-fire-stage1": 5,
  "fix-grass-stage1": 5,
  "fix-plain-body": 5,
  "fix-metallicsignal": 5,
  "fix-metal-stage1": 5,
  "sv01-096": 3,
  "fix-basic-1": 5,
  "fix-energy": 5,
});

export const ROW14_DECK = deckOf({
  "fix-powersaver": 8,
  "fix-tr-body": 12,
  "fix-not-tr-body": 8,
  "fix-seasoned": 6,
  "fix-tr-energy": 6,
  "sv01-096": 3, // Klefki — "Mischievous Lock": the §9 witness the CHANNEL claim needs
  "fix-basic-1": 9,
  "fix-energy": 8,
});

export const GATED_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 14, // the setup starters and the bodies the switch offers
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 18, // Colorless Basic — every attack's cost, and the typed filter's near miss
  "fix-lightning-energy": 12, // {L} — Return Charge's printed filter
  "fix-special": 8, // the SPECIAL Energy only the printed bare noun can reach
});

export const ANY_NUMBER_ATTACH_DECK = deckOf({
  "fix-trainerops": 6, // the attacker
  "fix-basic-1": 14, // the setup starters and the three Bench bodies the attach may reach
  "fix-bigbody": 2, // p2's Active — set explicitly, so nothing reaches it by accident
  "fix-energy": 22, // Colorless Basic — the attack's cost AND the cards the attach offers
  "fix-special": 8, // the SPECIAL Energy the printed "Basic" must NOT offer
  "fix-tool": 8, // a non-Energy the hand can hold, so the filter has a second near miss
});

export const CAPTIVATING_INVITATION_DECK = deckOf({
  "fix-captivatinginvitation": 6, // the Ability holder — benched AND active boards
  "fix-invitee": 6, // the opponent's Bench body the gust drags up
  "fix-incumbent": 6, // the opponent's starting Active, which must stay unconfused
  "fix-trainersearch": 6, // the Supporter under test
  "fix-tool": 6, // a Trainer the search MUST offer (Tool)
  "fix-item": 6, // a Trainer the search MUST offer (Item)
  "fix-basic-1": 12, // the setup starters, and a NON-Trainer the search must refuse
  "fix-energy": 12, // Colorless Basic — attack costs, and the other non-Trainer
});

export const LISIAS_APPEAL_DECK = deckOf({
  "fix-lisiasappeal": 6, // the Supporter under test
  "sv02-172": 6, // Boss's Orders — the SAME gust with no rider (attribution control)
  "fix-invitee": 6, // the BASIC on the opponent's Bench — must be offered
  "fix-evolvedinvitee": 6, // the STAGE 1 beside it — must NOT be offered
  "fix-incumbent": 6, // the opponent's starting Active, which must stay unconfused
  "fix-basic-1": 12, // the setup starters for both seats
  "fix-plain-body": 6, // p1's own board, so no seat runs short of bodies
  "fix-energy": 12, // Colorless Basic — attack costs and retreat
});

export const DRAYTON_WINDOW_DECK = deckOf({
  "fix-drayton": 6, // the Supporter under test
  "sv02-183": 6, // Great Ball — the SAME look with no `also` (attribution control)
  "fix-basic-1": 12, // Pokémon #1 — window fodder AND both seats' setup starters
  "fix-basic-2": 6, // Pokémon #2 — the second admissible Pokémon the cap must refuse
  "fix-item": 6, // Trainer #1 (Item)
  "sv01-189": 6, // Trainer #2 (Supporter) — the second Trainer the cap must refuse
  "fix-energy": 18, // NEITHER kind — what the union itself has to refuse
});

export const ROTO_STICK_DECK = deckOf({
  "fix-rotostick": 6, // the Item under test
  "sv01-186": 6, // Pokégear 3.0 — the SAME filter at a NUMERIC cap (attribution control)
  "sv01-189": 12, // a Supporter — what the filter admits, and the window fodder
  "fix-item": 6, // a Trainer that is NOT a Supporter — the filter's refusal witness
  "fix-basic-1": 12, // both seats' setup starters, and a non-Trainer in the window
  "fix-energy": 18, // neither a Trainer nor a Supporter
});

export const BUG_CATCHING_DECK = deckOf({
  "fix-bugcatchingset": 6, // the Item under test
  "sv02-183": 6, // Great Ball — the same look, a WIDER filter (attribution control)
  "fix-grass-basic": 6, // {G} Pokémon, Basic — admitted
  "fix-grass-stage1": 6, // {G} Pokémon, STAGE 1 — admitted; the printed noun has no stage
  "fix-grass-energy": 6, // Basic {G} Energy — admitted
  "fix-basic-1": 12, // COLORLESS Pokémon — refused by `{G}`; also both seats' starters
  "fix-energy": 6, // Basic COLORLESS Energy — refused by `{G}` on the other member
  "fix-special": 6, // SPECIAL Energy — refused by the printed "Basic"
  "fix-item": 6, // neither kind — what the union itself refuses
});

export const ETHANS_ADVENTURE_DECK = deckOf({
  "fix-ethansadventure": 6, // the Supporter under test
  "sv01-172": 6, // Energy Search — the same op, an UNTYPED Energy filter (attribution control)
  "fix-ethans-cyndaquil": 6, // Ethan's Pokémon, BASIC — admitted
  "fix-ethans-typhlosion": 6, // Ethan's Pokémon, STAGE 2 — admitted; the printed noun has no stage
  "fix-ethans-pichu": 6, // Ethan's Pokémon, {L} — admitted; the noun is owner-narrowed, not type-narrowed
  "fix-fire-energy": 6, // Basic {R} Energy — admitted
  "fix-plain-cyndaquil": 6, // {R} Pokémon, NO prefix — refused by "Ethan's"; also a setup starter
  "fix-grass-energy": 6, // Basic {G} Energy — refused by the printed {R}
  "fix-special": 6, // SPECIAL Energy — refused by the printed "Basic"
  "fix-tr-energy": 6, // an owner-prefixed NON-Pokémon — refused by BOTH members
});

export const EXPLORERS_GUIDANCE_DECK = deckOf({
  "fix-explorersguidance": 6, // the Supporter under test
  "sv02-183": 6, // Great Ball — the same op, all four fields different (attribution control)
  "fix-basic-1": 12, // Pokémon — both seats' starters, and Great Ball's ONLY candidates
  "sv01-189": 6, // a Supporter — a non-Pokémon `anyCard` admits
  "fix-item": 6, // an Item — a third card class in the window
  "fix-energy": 24, // Energy — the fourth class, and the tail the no-shuffle case reads
});

export const LEFTOVERS_DESTINATION_DECK = deckOf({
  "fix-drakloak": 4, // Drakloak "Recon Directive" — the ABILITY under test
  "fix-rika": 4, // Rika — the Supporter under test
  "sv02-183": 4, // Great Ball — no leftovers clause, and it DOES shuffle (control)
  "fix-explorersguidance": 4, // Explorer's Guidance — the OTHER `restTo` value (control)
  "fix-basic-1": 12, // Pokémon — both seats' starters, and Great Ball's only candidates
  "sv01-189": 4, // a Supporter — a non-Pokémon `anyCard` admits
  "fix-item": 4, // an Item — a third card class in the window
  "fix-energy": 24, // Energy — the fourth class, and the readable tail
});

export const MULTI_NOUN_SEARCH_DECK = deckOf({
  "fix-larrysskill": 4, // Larry's Skill — the THREE-noun Supporter under test
  "fix-secretbox": 4, // Secret Box — the FOUR-noun Item under test
  "sv06.5-096": 4, // Earthen Vessel — the SAME op with no `also` (attribution control), and Item #2
  "fix-basic-1": 12, // Pokémon #1 — a noun BOTH caps, and both seats' setup starters
  "fix-basic-2": 4, // Pokémon #2 — the second admissible Pokémon Larry's cap must refuse
  "sv01-189": 4,
  "fix-item": 4, // Item #1 — Secret Box's first noun
  "fix-tool": 4, // the Pokémon Tool — Secret Box's second noun
  "fix-stadium": 4, // the Stadium — Secret Box's fourth noun
  "fix-energy": 12, // Basic Energy #1 — Larry's third noun, plus attack costs and retreat
  "fix-fire-energy": 4, // Basic Energy #2 — the second admissible Energy Larry's cap must refuse
});

export const UNDAMAGED_BONUS_DECK = deckOf({
  "fix-mabosstiff": 4,
  "fix-damagedbonus": 4,
  "fix-benchfiller": 4,
  "fix-bigbody": 8,
  "fix-dark-energy": 12,
  "fix-energy": 28,
});

export const UNTIL_LEAVES_ACTIVE_DECK = deckOf({
  "fix-gougingfire": 4, // "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot." at INDEX 1
  "fix-gouging-stage1": 2, // the evolve route's Stage 1 — ONE attack, so a stale index points at nothing
  "sv01-194": 3, // Switch (Item, switchActive) — the switchInto route on the holder's OWN board
  "fix-fire-energy": 10, // Basic {R} — {R}{R} of Blaze Blitz, {R} of Heat Blast, and the retreat
  "fix-energy": 13, // Basic {C} — the {C} of both costs, and the retreat
  "fix-titan": 28, // 340 HP neutral Basic, NO attacks — DOMINANT (mulligan-free), filler and promote target
});

export const OPPONENT_COUNTER_MULTIPLY_DECK = deckOf({
  "fix-glalie": 4, // "Damage Beat" idx 0 ({W}, "20×") — the sentence under test
  "fix-flapple": 4, // "Acidic Spit" idx 0 ({C}, "20×") — the SAME sentence, second card
  "sv01-095": 4, // Dedenne "Second Bite" — the ADDITIVE twin on the same count source
  "fix-water-weak": 2, // 200 HP, ×2 Water — the pre-W/R ORDER board for Damage Beat
  "fix-titan": 22, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-water-energy": 8, // {W} — Damage Beat, and the typed symbol of Crazy Headbutt
  "fix-psychic-energy": 4, // {P} — Second Bite's typed symbol
  "fix-grass-energy": 3, // {G} — Speed Dive's first symbol
  "fix-fire-energy": 3, // {R} — Speed Dive's second symbol
  "fix-energy": 6, // Colorless Basic — every {C} in the deck
});

export const DEFENDER_STATUS_TRIPLE_DECK = deckOf({
  "fix-oxford": 4, // the Oxford list — idx 0 (50), idx 1 (no damage), idx 2 (loud control)
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-energy": 40, // Colorless Basic — every cost here is {C}-only
});

export const FLIP_STATUS_ENERGY_DISCARD_DECK = deckOf({
  "fix-oxford": 4,
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — a clean defender that survives
  "fix-energy": 30, // Colorless Basic — every cost here is {C}-only
  "fix-water-energy": 10, // {W} — the SECOND distinguishable Energy, so the discard can park
});

export const SELF_DAMAGE_PER_COUNTER_DECK = deckOf({
  "fix-recoil-scale": 4,
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-energy": 40, // Colorless Basic — both costs here are {C}-only
});

export const DEFENDER_STATUS_PAIR_DECK = deckOf({
  "fix-ninetales": 4, // the bare pair — {R}{R} for 90
  "fix-tr-houndoom": 4, // the bare pair on a second body — {R}, no damage
  "fix-ekans": 4, // the flip pair — Confused+Poisoned
  "fix-glimmora": 4, // the flip pair — Paralyzed+Poisoned
  "fix-accelgor": 4, // the composed compound — pair + switch tail
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, filler, clean defender
  "fix-fire-energy": 8, // {R} — Eerie Glow, Cruel Coal, Scorching Fire
  "fix-dark-energy": 4, // {D} — Poison Blend and Bite
  "fix-grass-energy": 4, // {G} — Poisonous Ploy's typed symbol
  "fix-fighting-energy": 2, // {F} — Venoshock's typed symbol
  "fix-energy": 6, // Colorless Basic — Stun Poison's {C} and Poisonous Ploy's
});

export const TAKE_PRIZE_DECK = deckOf({
  "fix-prizewheel": 8, // the attacker — indices 0 (30), 1 (130), 2 (none), 3 (skip control)
  "fix-wall": 4, // 120 HP, no attacks — the body index 1's 130 Knocks Out
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, bench, clean defender
  "fix-energy": 28, // Colorless Basic — every cost here, plus the surgery slack
  "fix-fire-energy": 4, // {R} — the SECOND energy type index 4 needs to PARK on a choice
});

export const NO_WEAKNESS_DECK = deckOf({
  "fix-nowk": 8, // the installer — idx 0 (the sentence), 1 (one-axis control), 2 (skip control)
  "fix-nowk-stage1": 4, // evolves from fix-nowk — the §10 EVOLVE clear
  "fix-bolt": 8, // {L}, printed 50 — the MAIN-HIT witness (100 unbarred / 50 barred)
  "sv01-069": 4, // Rotom "Linear Attack" ({C}, opponentAny 20, deals) — the snipeActive witness
  "sv01-194": 4, // Switch (Item) — the §10 FORCED-SWITCH clear, `interpreter.ts`'s literal
  "fix-titan": 16, // 340 HP neutral Basic, NO attacks — starter, bench, clean defender
  "fix-energy": 16, // Colorless Basic — every cost here, plus the surgery slack
});

export const RETREAT_COST_PENALTY_DECK = deckOf({
  "fix-retreatless": 4, // the demonstrator — idx 0 (30 per {C}), 1 (50 per {C}), 2 (flat), 3 (loud)
  "fix-retreat0-titan": 3, // 340 HP, printed {} — the base-KEPT rung the multiply fold fails
  "fix-retreat1-titan": 3, // 340 HP, printed {C} — the rung a flat `per` is green on
  "fix-retreat2-titan": 3, // 340 HP, printed {C}{C} — the rung a hardcoded 2 is green on
  "fix-retreat3-titan": 3, // 340 HP, printed {C}{C}{C} — the rung that separates them
  "sv02-175": 2, // Calamitous Wasteland — the fold's ADDITIVE term (+1 on Basic non-{F})
  "sv01-167": 2, // Beach Court — the fold's SUBTRACTIVE term (-1 on Basic), the mirror
  "sv01-002": 2, // Heracross "Superpowered Throw" (10+, 30 MORE per {C}) — the additive twin
  "sv03-172": 2, // Stoutland "Chomp Chomp Panic" (50×) — the multiply twin, a Stage 2 (surgery)
  "fix-grass-energy": 4, // {G} — the first symbol of Superpowered Throw's cost, and nothing else
  "fix-energy": 16, // Colorless Basic — every other cost here, plus the surgery slack
  "fix-titan": 16, // 340 HP, printed retreat 4 — DOMINANT starter, bench filler, the FLOOR board
});
