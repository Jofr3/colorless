import type { Card } from "@colorless/schema";
import {
  basicEnergy,
  basicPokemon,
  battler,
  blank,
  itemTrainer,
  specialEnergy,
  trainerCard,
  typedEnergy,
} from "./cards";

function stage1Pokemon(id: string): Card {
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

/** A Stage 2 that evolves from `fix-stage1` — the top of the evolution
    chain (fix-basic-1 → fix-stage1 → fix-stage2). */
function stage2Pokemon(id: string): Card {
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
  // The attack cast: one Fire attacker with a spread of printed-attack shapes,
  // and defenders that exercise each §8.5 damage-pipeline branch.
  "fix-attacker": battler("fix-attacker", {
    types: ["Fire"],
    hp: 120,
    attacks: [
      { cost: ["Colorless"], name: "Bite", damage: 30 },
      { cost: ["Fire", "Colorless"], name: "Flame", damage: 60 },
      // The canonical modern print — effects.ts derives it, so Yawn
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
  /** The status cast: one derivable status sentence (effects.ts) per attack, on
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

  // — Cards authored from existing ops (real catalog ids so
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
