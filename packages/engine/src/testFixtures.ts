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
  /** Weak to COLORLESS, and big enough that nothing in the multi-flip suite can
      Knock it Out (D127). Synthetic on purpose and in a way no printed card is:
      real cards have no Colorless Weakness. It exists because both faithful
      multi-flip fixtures — Tandemaus sv01-160 and Meowth sv06.5-048 — are
      Colorless Pokémon, and the pool holds no multi-flip attacker of a type any
      existing weak body already fields. What it pins is the "×" base drop landing
      PRE-Weakness: Tandemaus on two heads is (0 + 60) × 2 = 120, where a leaked
      printed base would read (30 + 60) × 2 = 180. 200 HP survives both, so the
      case measures damage and never a promotion. */
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
  // — M5 long-tail: the Mimikyu "Safeguard" cast (preventDamageFromExV). The
  //   defender is a faithful Mimikyu sv02-097 (its passive comes from the
  //   registry, keyed by id); the attackers are three named bodies so
  //   `pokemonSuffixOf` reads ex / V / VMAX off the NAME — the ex and V are
  //   prevented, the VMAX (and the plain fix-attacker) are NOT. Bite ({C} 30) is
  //   the main-hit witness; the ex also carries Spread Shot for the interpreter
  //   spread arm. —
  //   0.88.0 (D139): it also carries its PRINTED attack now — "Ghost Eye"
  //   ({P}{C}, "Put 7 damage counters on your opponent's Active Pokémon.", NO
  //   `damage` field), the first of the two printings the `COUNTER_PUT_ON_DEFENDER`
  //   anchor reads. Its `abilities` stay null on purpose: Safeguard is authored in
  //   the REGISTRY, keyed by id, and safeguard.test.ts pins it there — which makes
  //   this card the sharpest possible zero-registry-row witness, since
  //   `programFor("sv02-097")` is defined while `.attack` is not. —
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
  /** Polteageist sv03-098 — the SECOND printing of the same sentence at a
      different count (D139), and a different card rather than a second rarity of
      the same one, which is the stronger form of D121's warrant.

      A STAGE 1 (evolving from Sinistea), fielded by `setActiveFromDeck` surgery
      like every other non-Basic this suite needs — D135 invented `fix-allheal`
      only because BOTH of its printings were evolutions and it wanted a legal
      starter; here Mimikyu is the Basic and carries the end-to-end boards.

      "Pour Tea" is at INDEX 1, and index 0 is the control this fixture exists
      for as much as the mapped sentence: "Antique Collecting" starts with the
      SAME WORD ("Put …") and must stay on the loud path, so one card proves the
      anchor is a whole sentence rather than a prefix. */
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
  /** Scyther sv03-004 — "Agility" ({C}, 10 damage, index 0): the WIDE spelling of
      D142's gated PREVENT clause, *"Flip a coin. If heads, during your opponent's
      next turn, prevent all damage from and effects of attacks done to this
      Pokémon."*, one of its ELEVEN printings. Chosen out of the eleven for three
      reasons: it is a BASIC (so it can be surgeried straight onto the Active
      without an evolution chain, unlike Dugtrio sv03-104), its cost is a single
      {C} (so any Energy pays it and the seed sweep never stalls on a type), and it
      carries a printed 10 alongside the install — a D125 tail board, where the
      declaration both deals real §8.5 damage AND writes the block. Its index-1
      "Cut" ({C}{C}, 20, no effect text) is the control: the same Colorless line,
      told apart only by the INDEX, so a program that leaked across indices shows
      up as a block installed by an attack that does not print one. */
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
  /** Togedemaru sv03-151 — "Defense Curl" ({C}, NO printed damage, index 0): the
      NARROW spelling, *"Flip a coin. If heads, during your opponent's next turn,
      prevent all damage done to this Pokémon by attacks."*, one of its TWO
      printings and the whole reason `preventDamage` carries an `effects` field.
      The install is the entire visible result of the declaration (no `damage`
      field at all), which is the mirror of Scyther's tail board.

      Its W/R line is not decoration: ×2 Fire weakness AND a −30 Grass resistance,
      the only fixture in this suite carrying both, so a blocked hit can be shown
      to be 0 rather than "0 after the pipeline happened to cancel" — the §8.5
      arithmetic runs in full and the block nulls the result, which is exactly how
      Mimikyu's Safeguard behaves one line above it in attack.ts. Index-1 "Rolling
      Tackle" ({M}{C}, 50) is the control and doubles as the real hit a shielded
      Scyther has to survive. */
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
  /** Staraptor sv01-150 — "Tailspin Away" ({C}{C}, printed 60, attack INDEX 0):
      D146's ATTACKER-CLASS filter, *"During your opponent's next turn, prevent all
      damage done to this Pokémon by attacks from Basic Pokémon."*, 1 of its THREE
      printings. UNGATED — no coin is printed, so this fixture (unlike D142's two)
      installs on every declaration and its suite needs no seed table at all.

      ⚠️ THE CARD IS STARAPTOR, NOT FLETCHLING. Four remainder lists and D142's own
      effects.ts comment called sv01-150 "Fletchling"; the local D1 (2026-08-02)
      says Staraptor, a STAGE 2 from Staravia. Fletchling sv02-163 is a real card in
      this pool and prints none of this text. Checked by query, per printing, with
      the attack name, the cost, the damage and the INDEX (D144's rule).

      A STAGE 2, fielded by `setActiveFromDeck` surgery like Ninetales sv03-029 and
      Oinkologne sv01-157 before it — and its stage is doing real work rather than
      being tolerated: it is the NON-Basic attacker the other installer's block must
      let through, so the two fixtures are each other's negative case.

      Its W/R line is load-bearing twice over: ×2 LIGHTNING weakness means Pincurchin
      sv02-072's Lightning 70 doubles to 140 and is then nulled to 0, so a blocked
      hit is 0 rather than 0 by coincidence; the −30 Fighting resistance is the
      second half of the same claim. Index-1 "Power Blast" ({C}{C}{C}, 180 + a
      self-discard) is the control that proves no program leaks across indices AND
      the big NON-Basic hit that lands in full on a filtered block.

      Verbatim off the local D1: 150 HP, Colorless, Stage2 from Staravia, retreat 1,
      ×2 Lightning, −30 Fighting, no Ability. */
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
  /** Noivern ex sv02-153 — "Covert Flight" ({C}{C}, printed 70, attack INDEX 0):
      the SAME sentence as Staraptor above, on a different card from a different
      SET, which is what makes D121's second-printing warrant a fact of the fixtures
      rather than a family argument (D139's stronger form).

      ⚠️ THE CARD IS NOIVERN ex, NOT BOMBIRDIER — the same inherited misnaming as
      sv01-150. Bombirdier sv01-138/-219 and sv02-147 are real cards in this pool
      and print none of this text.

      A STAGE 1 (from Noibat), so the PAIR of installers spans both evolution
      stages: each is the other's non-matching attacker, and between them they show
      that "Basic" is read off the attacker's CURRENT identity at two different
      distances from a Basic. 260 HP is deliberate — it survives Staraptor's
      unblocked 180 with room to spare, so the "the filter FAILED and the damage
      landed" cases end with a body still on the board to assert about.

      NO printed Weakness and NO Resistance at all (verbatim off the D1), which is
      the other half of Staraptor's ×2: one installer proves a blocked hit survives
      the full §8.5 pipeline, the other proves the unblocked number is the printed
      one with nothing done to it. Index-1 "Dominating Echo" ({P}{D}, 140) carries
      an UNMAPPED sentence and stays LOUD — the live unmapped witness this slice
      adds to its own deck (D135's move), and the index control at the same time.

      Verbatim off the local D1: 260 HP, Dragon, Stage1 from Noibat, retreat 0, no
      weakness, no resistance, no Ability. */
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
  /** Swablu sv03-169 — "Fluffy Guard" ({C}, NO printed damage, attack INDEX 0):
      D147's durated DAMAGE REDUCTION at its SMALLEST printed amount, *"During your
      opponent's next turn, this Pokémon takes 20 less damage from attacks (after
      applying Weakness and Resistance)."* — 1 printing, the only 20 in the family.

      The costless-ish installer: one {C} and no printed `damage`, so a declaration
      is the install and nothing else — the control against which the three
      fixtures below (which all hit as well) show the tail placement.

      50 HP is the smallest body in this deck and it is deliberate: 20 off an
      incoming hit is the difference between two and three swings, and the KO
      arithmetic is where a reduction is actually observable to a player. ×2
      LIGHTNING and −30 FIGHTING are both printed, and both are load-bearing — the
      Weakness is what makes the printed parenthetical observable at all (it is
      MULTIPLICATIVE, where the Resistance and the reduction are both additive and
      commute), and the Resistance is the case that proves the order does NOT
      matter when nothing multiplies.

      Verbatim off the local D1 (2026-08-02, 978 cards): 50 HP, Colorless, Basic,
      retreat 1, ×2 Lightning, −30 Fighting, no Ability, index-1 "Flap" ({C}{C}, 20). */
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
  /** Pineco sv01-001 — "Guard Press" ({C}{C}, printed 10, attack INDEX 0): the
      family's most re-printed amount (30, on 10 of the 14 printings) on its
      cheapest body, and a D125 TAIL BOARD — the 10 lands through the §8.5 pipeline
      first and the install rides behind it.

      ⚠️ IT IS THE PRE-EVOLUTION OF THE 50-AMOUNT INSTALLER BELOW, which is why
      these two rather than any other pair: Forretress sv01-139 evolves from Pineco,
      so the §10 EVOLVE clear can be reached with two real cards from one set
      instead of a synthetic chain — and the evolution ALSO replaces a 30 with a 50
      on the same body, which is the sharpest statement that the record belongs to
      the Pokémon and not to the card.

      ×2 FIRE on 60 HP: `fix-attacker`'s Fire "Flame" (60) doubles to 120 and this
      body's own 30 takes it to 90, where subtracting first would give 60 — and the
      two numbers straddle nothing here (both KO), which is exactly why the
      ordering is ALSO driven on the 120 HP evolution and on Eiscue.

      Verbatim off the local D1: 60 HP, Grass, Basic, retreat 2, ×2 Fire, no
      Resistance, no Ability, ONE attack. */
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
  /** Eiscue sv02-048 — "Frigid Block" ({W}{W}{W}, printed 100, attack INDEX 1):
      D147's COMPOUND printing and the only printing of the 100 amount —

        "Discard all Energy from this Pokémon. During your opponent's next turn,
         this Pokémon takes 100 less damage from attacks (after applying Weakness
         and Resistance)."

      2 printings (sv02-048 Common / sv02-205 Illustration rare — one attack in two
      rarities, D121's second-printing warrant met by the card), and the FREE COUNT
      D145's discard census flagged: its first sentence has derived to
      `discardEnergy { count: "all" }` since 0.x, so the pair costs ONE regex.

      ⚠️ IT IS THE ORDERING PIN, and the numbers are why. ×2 METAL against
      Forretress's Metal 90: `90 × 2 − 100 = 80` on a 110 HP body — it survives,
      with 30 to spare. Subtract first and the clamp swallows the whole hit
      (`max(0, 90 − 100) × 2 = 0`), i.e. the wrong order turns a 100-point reduction
      into total immunity against a 90-point attack. That is the loudest available
      statement of what "(after applying Weakness and Resistance)" buys, and it is
      driven off two printed cards with no surgery in it.

      It is also the SELF-COST case: the discard strips the very Energy that paid
      for the attack, so the shielded body is left unable to attack again — the
      printed trade, and the reason the two ops must resolve in printed order.

      Verbatim off the local D1: 110 HP, Water, Basic, retreat 1, ×2 Metal, no
      Resistance, no Ability, index-0 "Headbutt" ({W}, 20). */
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
  /** Ninetales sv03-029 — "Nine-Tailed Dance" ({R}{R}, attack INDEX 1, NO printed
      `damage`): D143's COMPOUND printing, *"Put 9 damage counters on 1 of your
      opponent's Pokémon. During your next turn, this Pokémon can't attack."* —
      2 printings (sv03-029 Uncommon / sv03-199 Illustration rare, one attack in
      two rarities, D121's second-printing warrant met by the card).

      A STAGE 1 (evolving from Vulpix), fielded by `setActiveFromDeck` surgery like
      Polteageist sv03-098 before it — and unlike D142's two Basics, which is why
      the evolve case in `attackLock.test.ts` uses a synthetic chain rather than
      this card's own.

      THE INDEX IS 1, checked against the local D1 rather than assumed (D139 found
      Pour Tea at index 1 the same way). Index 0 is "Will-O-Wisp" ({R}, 20, no
      effect text) and it earns its place twice: it is the control that proves a
      program does not leak across indices, AND it is the attack a LOCKED Ninetales
      is refused when it tries to use it — which is how the suite shows the lock is
      on the POKÉMON rather than on the attack that installed it.

      No printed `damage` on index 1, so the counters plus the lock are the entire
      visible result of that declaration. */
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
  /** Alomomola sv01-048 — "Aqua Slash" ({W}{W}{C}, attack INDEX 1, printed 120):
      the BARE self-lock sentence, *"During your next turn, this Pokémon can't
      attack."*, one of its TWENTY printings and the reason D143 is a 22-printing
      slice rather than a 2-printing one.

      Chosen out of the twenty for three reasons. It is a BASIC, so it goes on the
      Active by surgery with no evolution chain (Miraidon ex / Koraidon ex are also
      Basics but carry rule boxes and registry rows that would muddy the board).
      It carries a printed 120 ALONGSIDE the lock — a D125 tail board, where one
      declaration deals real §8.5 damage AND installs the drawback, which the
      compound Ninetales printing cannot show (it prints no `damage` at all). And
      its index-0 "Surf" ({W}{C}, 30, no effect text) is the sharpest control in
      the slice: it is a DIFFERENT attack on the SAME card, so a locked Alomomola
      being refused Surf is the assertion that separates this family from the eight
      printings that say "this Pokémon can't use {AttackName}". */
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
  /** A synthetic Stage 1 that evolves from **Alomomola** — the one fixture D143
      invents, and it exists to make the §10 EVOLVE clear a REAL drive rather than
      a state surgery. D142 could only surgery its equivalent case, because that
      block's window is the opponent's turn and nobody evolves on someone else's;
      this lock's window is the HOLDER's own next turn, so evolving out of it is a
      line a player actually takes, and the assertion is worth the fixture. The
      catalog prints no Alomomola evolution, which is exactly why this is a `fix-`
      card and not a catalog id: the CLAIM being pinned is §10's rule, not a
      card. Its own attack is a plain 40 with no effect text, so an evolved body
      that attacks proves the lock is gone rather than merely unread. */
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
  /** Eiscue ex sv03-042 — "Scalding Block" ({W}{W}{W}, attack **INDEX 0**, printed
      160): D148's ENERGY-COST compound, *"Discard an Energy from this Pokémon.
      During your opponent's next turn, the Defending Pokémon can't attack."* —
      3 printings of ONE attack in three rarities (sv03-042 Double rare, sv03-210
      Ultra Rare, sv03-222 Special illustration rare), so D121's second-printing
      warrant is met by the card. Every field re-queried PER PRINTING against the
      local D1 (2026-08-02, 978 cards) and identical on all three.

      It is its card's ONLY attack, which is deliberate on this half of the slice:
      the "the lock is on the POKÉMON, not the attack" claim is made on the
      DEFENDER's card (Alomomola, which has two), where the sibling to refuse
      actually lives — so this fixture carries the install and Alomomola carries
      the refusal, which is the shape the sentence itself describes.

      TWO things about it are worth stating because they look like mistakes:
      the printed types are **{R} Fire** while the attack cost is {W}{W}{W}, and
      the Weakness is ×2 WATER. That is the ingested catalog verbatim; the engine
      reads that table and so does this fixture, and the mismatch is inert here —
      the cost is paid from attached Energy (§8.2) and never from the holder's
      type. And it is an `ex`, kept for D133's Skeledirge reason: `prizeValueOf`
      reads the rule box off the NAME (cards.ts), so a KO of this body takes TWO
      Prizes and the suite's KO cases say so.

      Verbatim off the local D1: 210 HP, Basic, retreat 2, ×2 Water, no
      Resistance, no Ability. */
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
  /** Houndoom ex sv03-134 — "Evil Claw" ({D}{D}, attack **INDEX 0**, printed 90):
      D148's CLASS-GATED printing, *"If the Defending Pokémon is a Basic Pokémon,
      it can't attack during your opponent's next turn."* — 1 printing, and the
      family's only sentence whose DURATION sits at the end.

      ⚠️ THE INDEX IS 0, CHECKED RATHER THAN ASSUMED, and the check mattered: the
      remainder list that specced this slice said the card "also prints a BARE
      recoil at index 1", which is TRUE — index 1 is "Hound's Fang" ({D}{D}{D},
      220, *"This Pokémon also does 30 damage to itself."*, simulated since 0.x as
      `damageSelf`) — but nothing said where "Evil Claw" was, and D139/D143/D144
      have each found a non-zero index a list did not mention. Both attacks are
      kept verbatim, so index 1 is the control that proves no program leaks across
      indices AND a live second reader on the same card.

      A STAGE 1 (from Houndour), fielded by `setActiveFromDeck` surgery like
      Ninetales sv03-029, Oinkologne sv01-157 and D146's two installers next door.
      It is an `ex` (two Prizes on a KO), kept for D133's reason.

      Verbatim off the local D1 (2026-08-02): 270 HP, Darkness, Stage1 from
      Houndour, retreat 2, ×2 Grass, no Resistance, no Ability. */
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
  /** Oinkologne sv01-157 — "Leg Stomp" ({C}{C}{C}, attack INDEX 1, printed 130):
      D144's TAILS-GATED self-lock, *"Flip a coin. If tails, during your next turn,
      this Pokémon can't attack."*, 1 of its 5 printings.

      Chosen out of the five because it is the only one with a SECOND attack the
      lock must also refuse: index 0 "Ram" ({C}{C}, 50, NO effect text) is the
      control that proves no program leaks across indices AND the attack a locked
      Oinkologne is denied — the assertion that separates this family from the
      eight "can't use {AttackName}" printings, inherited from D143's Alomomola.
      Its 130 lands alongside the gate, so one declaration exercises D125's tail
      board on BOTH faces: real §8.5 damage either way, the drawback only on tails.

      A STAGE 1 (from Lechonk), fielded by `setActiveFromDeck` surgery like
      Ninetales sv03-029 before it. Its whole cost is COLORLESS, which is why the
      deck below needs no typed line for it at all.

      Verbatim off the local D1 (2026-08-02): 120 HP, Colorless, Stage1 from
      Lechonk, retreat 2, ×2 Fighting, no Resistance, no Ability. */
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
  /** Paldean Clodsire ex sv02-130 — "Needle Bone" ({D}{C}{C}, attack **INDEX 0**,
      printed 200): the SAME D144 sentence on the other half of the family, and the
      fixture exists for the index.

      ⚠️ THE INDEX IS 0 HERE AND 1 ON ALL THREE OINKOLOGNE PRINTINGS, checked
      against the local D1 rather than assumed (D139's Pour Tea, D143's Nine-Tailed
      Dance, and now a family that is not even internally consistent). A suite
      pinned to either number alone would simulate the wrong attack on two of the
      five printings, and this fixture is what makes that impossible to write.

      It is its card's ONLY attack, which is the second reason it is here: the
      "the lock is on the POKÉMON, not the attack" claim is made on Oinkologne,
      where there is a sibling to refuse — and this card is the one where a reader
      who confused the two families would be accidentally right, exactly as
      Munkidori ex is for the per-attack lock (D143).

      ⚠️ IT IS AN `ex`, AND THAT IS KEPT ON PURPOSE (D133's Skeledirge precedent):
      `prizeValueOf` reads the rule box off the NAME (cards.ts), so a KO of this
      body takes TWO Prizes. Its printed Ability "Toxic Wetland" is kept verbatim
      too and is inert on every board here — it needs a Stadium in play AND an
      explicit `useAbility` action, and the engine has no registry row for it.

      Verbatim off the local D1 (2026-08-02): 280 HP, Darkness, Stage1 from Paldean
      Wooper, retreat 3, ×2 Fighting, no Resistance. */
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
  // — 0.93.0 → 0.94.0 (D145): the TAILS gate's other two consequents, both of
  //   them an IMMEDIATE cost on the attacker's OWN body rather than D144's
  //   durated state. Three printings across two sentences, all three at attack
  //   INDEX 1 — checked printing by printing against the local D1 (2026-08-02),
  //   because D144 found an index that is not constant WITHIN one family and an
  //   index is a per-printing fact for good. —
  /** Pikachu ex sv02-063 — "Dynamic Bolt" ({L}{L}{C}, attack INDEX 1, printed
      220): *"Flip a coin. If tails, discard all Energy from this Pokémon."*, one
      of that sentence's TWO printings.

      Three things it is here for. It is a BASIC, so it goes on the Active by
      surgery with no evolution chain. Its {L}{L}{C} cost is a MIXED attachment —
      typed and Colorless in one pile — which is what makes "discard ALL" a claim
      about the `anyEnergy` filter rather than about a single Energy line. And it
      is an `ex`, which is the whole reason this fixture rather than a second
      Beartic: `isExOrV` reads the rule box off the NAME (cards.ts), so declaring
      it into Mimikyu sv02-097's Safeguard is the one board in the pool where the
      §8.5 pipeline deals ZERO and the effect program runs anyway — the
      "does the drawback still land when the main hit is prevented?" question,
      driven rather than reasoned about. (A KO of this body also takes TWO
      Prizes, which the self-KO cases deliberately do not use it for.)

      Its index-0 "Pika Punch" ({C}, 30, NO effect text) is the control that
      proves no program leaks across indices AND the attack a stripped body can
      still afford after the drawback has taken everything.

      Verbatim off the local D1 (2026-08-02): 190 HP, Lightning, Basic, retreat 0,
      ×2 Fighting, no Resistance, no Ability. */
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
  /** Beartic sv03-054 — "Frost Purge" ({W}{W}{C}, attack INDEX 1, printed 170):
      the SAME sentence on the other printing, from a DIFFERENT SET and a
      different Energy line — which is what makes the two-printing warrant
      (D121, in D139's stronger two-cards-two-sets form) a fact of the fixtures
      rather than of the docs.

      A STAGE 1 (from Cubchoo), fielded by `setActiveFromDeck` surgery like
      Ninetales sv03-029 and Oinkologne sv01-157 before it. Its index-0 "Icicle
      Punch" ({W}, 30, NO effect text) is its control.

      Verbatim off the local D1 (2026-08-02): 150 HP, Water, Stage1 from Cubchoo,
      retreat 3, ×2 Metal, no Resistance, no Ability. */
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
  /** Oinkologne sv03-183 — "High-Impact Kick" ({C}{C}{C}, attack INDEX 1,
      printed 160): *"Flip a coin. If tails, this Pokémon also does 60 damage to
      itself."*, the sentence's ONLY printing, and a THIRD Oinkologne — a
      DIFFERENT CARD from D144's sv01-157, not another rarity of it (D135's
      Arboliva finding, applied before it could bite again).

      ⚠️ D134's FIXTURE HP TRAP IS THE REASON THE NUMBERS ARE WHAT THEY ARE. 120
      printed HP against a 60 recoil: a FRESH body survives its own attack twice
      and a body already carrying 60 does not, so the self-KO is reachable by one
      `setDamage` and is never reached by accident. Every own-board damage figure
      in the suite is read against THIS number.

      Its index-0 "Confounding Cologne" ({C}{C}, 30, *"Your opponent's Active
      Pokémon is now Confused."*) is the control, and a sharper one than an
      effect-less sibling: it is read by a DIFFERENT arm of the same deriver, so
      the two indices of one card must produce two different programs and neither
      may claim the other's string. (Its sentence is already in
      `clauseApostrophe`'s discovered census via `fix-statuser`, so this fixture
      adds an id to an existing row rather than a row.)

      Verbatim off the local D1 (2026-08-02): 120 HP, Colorless, Stage1 from
      Lechonk, retreat 2, ×2 Fighting, no Resistance, no Ability. */
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
  /** Bouffalant — a Colorless Basic whose registry entry carries the passive
      "Bouffer" (takes 20 less damage after Weakness/Resistance).

      D129 GAVE "Damage Rush" ITS PRINTED EFFECT TEXT, which it had gone without
      while every suite using this card used it as a DEFENDER (the passive is what
      those cases read; nothing declared its attack). The sentence is the UNBOUNDED
      FOLD's only ADDITIVE printing — "Flip a coin until you get tails. This attack
      does 30 more damage for each heads." against a "50+" marker — and it is the
      card that pins `bonusOnHeads` and `perHeads` apart on ONE flip count: the
      printed 50 is KEPT and the fold rides on top, where Growlithe's "30×" base is
      dropped. The attack text is verbatim off the local D1 (2026-08-01); the Ability
      text stays the ellipsis it has always been, because the registry keys "Bouffer"
      on the card id and nothing derives that string. */
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
  /** Stunfisk — a Fighting body whose registry passive "Custom Trap" is the
      Counterattack Quills variant gated on a Pokémon Tool being attached (5
      counters). No weakness on the fixture — the recoil and its Tool gate are
      what's under test. */
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
      {
        type: "Ability",
        name: "Mischievous Lock",
        effect: "Basic Pokémon in play have no Abilities.",
      },
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
  /** Ting-Lu ex — the ability-lock aura since D100, and since D140 the PUT on the
      opponent's BENCH as well. The printed attack is verbatim off the local D1
      (2026-08-02): "Land Scoop", {F}{F}{F}, **damage 150** beside the effect
      sentence, and it is the SAME attack on all four printings (sv02-127/-243/
      -263/-275). The `damage` field is load-bearing here in a way no earlier
      counter-family fixture's was — it is what makes this the family's first
      D125 tail-order board (a §8.5 hit AND a placement in one declaration). The
      Ability text stays ABBREVIATED: it is cosmetic (the registry keys on the id)
      and abilityLock.test.ts has read it that way since D100. */
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
  /** Rocky Helmet — Tool: 2 damage counters on the attacker when the holder is
      damaged while Active (the D98 `damageAttacker` family, granted by a Tool). */
  "sv01-193": trainerCard(
    "sv01-193",
    "Tool",
    "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if it is Knocked Out), put 2 damage counters on the Attacking Pokémon.",
  ),

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
  "sv02-015": battler("sv02-015", {
    name: "Meowscarada ex",
    types: ["Grass"],
    hp: 310,
    retreat: 2,
  }),
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
        effect:
          "When this Pokémon is Knocked Out, flip a coin. If heads, your opponent can't take any Prize cards for it.",
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
  "sv01-121": battler("sv01-121", {
    name: "Stonjourner",
    types: ["Fighting"],
    hp: 140,
    retreat: 2,
  }),

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
  "sv01-086": battler("sv01-086", {
    name: "Gardevoir ex",
    types: ["Psychic"],
    hp: 310,
    retreat: 2,
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
      Wooper), surgeried straight onto the Active in tests. Its second attack
      ("Muddy Hammer", {D}{C}{C}, 100) was the "one card, one derived attack"
      control while it was UNSIMULATED; D131 mapped its "Discard the top card of
      your opponent's deck." and the control is now the STRONGER one — index 1
      derives a DIFFERENT op, so retreatLock.test.ts's "does not inherit down the
      attack index" case proves the lock is keyed to the declared attack rather
      than merely to an absence. */
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
  /** Houndoom (sv06.5-008, D149) — the ATTACKER-SIDE DEBUFF's 100, and the family's
      SECOND printed sentence: "Snarl" ({R}{C}{C}, printed 100, **INDEX 1**) reads
      "During your opponent's next turn, attacks used by the Defending Pokémon do
      100 less damage (before applying Weakness and Resistance)." Index-0 "Bite"
      ({C}{C}, 50) is the plain hit and the index control on the same card.

      The 100 is the amount that makes the printed parenthetical observable at the
      MAIN HIT: Snarl leaves the debuff on a body that then swings back into
      Houndoom's ×2 WATER, where `max(0, 120 − 100) × 2 = 40` and the wrong order
      gives `120 × 2 − 100 = 140`. Two rarities print this attack byte-identically
      (sv06.5-066 is the Illustration rare), so D121's second-printing warrant is
      met by the card; only the Common is fielded, exactly as D148 fielded one of
      Eiscue ex's three. Verbatim vs the local D1 catalog (Stage 1 from Houndour,
      120 HP, Fire, retreat 2, ×2 Water, no Resistance, no Ability). */
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
  /** Pikachu (sv02-062, D149) — the attacker-side debuff's 20 on the family's FIRST
      sentence: "Growl" ({C}, NO printed damage, INDEX 0) reads "During your
      opponent's next turn, the Defending Pokémon's attacks do 20 less damage
      (before applying Weakness and Resistance)." Index-1 "Pika Bolt" ({L}{C}, 30)
      is a LIGHTNING hit, which makes this card both an INSTALLER and the debuffed
      ATTACKER a suite needs — swinging into Pidove's ×2 Lightning at
      `max(0, 30 − 20) × 2 = 20` where the wrong order gives `60 − 20 = 40`.
      A Basic. Verbatim vs the local D1 catalog (70 HP, Lightning, retreat 1,
      ×2 Fighting, no Resistance, no Ability). */
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
  /** Pidove (swsh10.5-061, D149) — the SECOND printing of the 20 sentence, and the
      one that carries a RESISTANCE. "Growl" ({C}, no printed damage, INDEX 0) is
      byte-identical to Pikachu's above (D121's warrant met by a second card rather
      than a second rarity); index-1 "Flap" ({C}{C}, 20) is the plain hit.

      Its ×2 LIGHTNING is what makes it the DEFENDER a debuffed Pikachu or Rotom
      swings into, and its −30 FIGHTING is the commuting control: Resistance and
      the debuff are both additive, so on a Fighting attacker the two placements of
      the subtraction give the same number and the parenthetical cannot bite —
      D147's own finding, read on the other side of §8.5. Verbatim vs the local D1
      catalog (Basic, 60 HP, Colorless, retreat 1). */
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
      {
        type: "Ability",
        name: "Blooming Garden",
        effect: "Your Pokémon in play have no Weakness.",
      },
    ],
    // ⚠️ D149 ADDED THE ATTACK, WHICH THIS FIXTURE HAD BEEN MISSING SINCE D104.
    // The card has exactly one, "Moonblast" ({P}{C}{C}, printed 120, INDEX 0), and
    // its effect is the 30 of the attacker-side debuff family — so this printing
    // sat in `FIXTURE_POOL` for forty-five slices with the sentence absent
    // entirely rather than present-and-unread. D147's rule ("sweep the pool before
    // costing the family") found it; the finding is the OTHER failure mode, a
    // fixture that is verbatim on everything it carries and silently PARTIAL.
    //
    // The card is also the reason the family's step order is UNOBSERVABLE on its
    // own board: Blooming Garden nulls Weakness for every Pokémon on Florges's own
    // side, and Florges's side is the side its debuffed opponent attacks INTO. So
    // the one printing that installs 30 is the one printing whose parenthetical
    // cannot bite, and the suite drives exactly that.
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
  /** FIXTURE — Basic Metal Energy, the last basic type the pool had no fixture
      for. Added for D119's Bronzong ({M}{M} "Extrasensory"); provision comes off
      the NAME exactly as its siblings' does. */
  "fix-metal-energy": typedEnergy("fix-metal-energy", "Metal"),
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
      ("Heal 30 damage from this Pokémon.") — which 0.83.0 MAPPED (D132), so the
      whole 18-printing bare-heal family now derives to `heal { target: "self" }`
      and this attack no longer keeps a loud ATTACK_EFFECT_SKIPPED row. Life
      Sucker is that slice's WITH-PRINTED-DAMAGE end-to-end occupant: it heals 30
      AND deals a flat 50, so it is where the tail placement (D125 — ops run
      AFTER the §8.5 pipeline) is asserted rather than assumed, and where a
      `target` read the wrong way round would heal the defender it just hit.
      Index 0 remains the index-keyed control for clauseTable.test.ts too — its
      text is not the scaling family, so index 1's clause cannot leak sideways —
      and it is now a control that derives a DIFFERENT op rather than none. */
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

  /** D119 — the PUBLIC-COUNT cluster: four clauses that read a COUNT nobody has
      to be shown (a hand's size, a Prize row's length) rather than anything on a
      Pokémon. Four faithful catalog rows, no registry attack rows between them.

      Absol ex sv03-135 (= sv03-214, byte-identical in rules text, one fixture for
      two ids): a Darkness Basic, 210 HP, ×2 Grass. "Cursed Slug" (+120) is the
      pool's ONLY "or fewer" clause of any kind.

      It is also faithfully awkward in two ways the suite leans on. Its index-0
      "Future Sight" is a REAL unbuilt sentence — a look-at-the-top-3 on EITHER
      player's deck, which no deriver owns — so that index stays loud while index
      1 does not, and the contrast rides on one card. And being an "… ex" it is
      itself a two-Prize body, so a KO on it MOVES the very count the cluster's
      Prize clauses read. */
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

  /** Bronzong sv03-145 — the EQUALITY clause ("Extrasensory", +90), the pool's
      only printing, and the only clause in the whole vocabulary that reads the
      same from either seat. A Metal Stage 1 from Bronzor, 140 HP, ×2 Fire, with a
      real Grass resistance.

      Its index-0 "Oracle Press" is kept verbatim and is a real unbuilt sentence
      too (a next-turn effect-prevention rider); it derives to nothing and stays
      loud, which is the index-keyed negative for this card. Note that its
      PRE-EVOLUTION, Bronzor sv03-144 "Mirror Draw", prints this card's clause
      word for word inside a DRAW effect — the near-miss the whole-sentence anchor
      exists to refuse. */
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

  /** Krokorok sv01-116 "Payback" (+90) — the single-valued Prize clause
      ("exactly 1"), and the cluster's only clause printed in the SINGULAR ("Prize
      card", not "Prize cards"), which is why the note builds its agreement from
      the parameter. A Fighting Stage 1 from Sandile, 100 HP, ×2 Grass.

      The clause sits at index 0 here and the plain attack at index 1 — the
      opposite order to the rest of the cluster, so an index the suite hard-codes
      cannot be right by accident. "Corkscrew Punch" carries NO `effect` key at
      all (not an empty string — the catalog row omits it). */
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

  /** Houndstone sv03-101 "Two Four-ocious" (+120) — the SAME member as Krokorok
      at a two-value list, and the card that makes "exactly" mean set membership
      rather than a range: on `[2, 4]` a 3-Prize board reads FALSE between two
      true ones. A Psychic Stage 1 from Greavard, 140 HP, ×2 Darkness, Fighting
      resistance; "Rear Kick" at index 0 again omits `effect` entirely. */
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

  /** D120 — the TYPE-vs-NAME pair: two clauses that vary on exactly ONE token and
      get OPPOSITE treatments, because only one of the two tokens has a CLOSED
      vocabulary to be rejected against.

      Sylveon swsh10.5-035 "Wonder Flash" (+90) — a Psychic Stage 1 from Eevee,
      120 HP, ×2 Metal, no Resistance, no Ability. The pool's ONLY printing of a
      type clause, and the only sentence in all 978 ingested rows that contains
      the word "Dragon" at all; the eleven-word type vocabulary is what lets it be
      a TEMPLATE on one printing without ever admitting a token it cannot resolve.

      Its index-0 "Souvenir" is a REAL unbuilt sentence — an unrestricted
      search-your-deck-for-2, which no deriver owns (checked: `deriveAttackEffect`
      returns null for it today) — and it carries NO `damage` key at all, so
      Sylveon holds one loud index beside its silent one and the contrast rides on
      a single card. Verbatim off the local D1. */
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

  /** Falinks sv02-119 "Reckless Charge Together" (+90) — a Fighting Basic, 110 HP,
      ×2 Psychic, no Resistance, no Ability. The other half of the D120 pair and
      the LITERAL row: its one varying token is a card NAME, which has no closed
      vocabulary to fail against, so `^(.+) is on your Bench$` would read "a Pokémon
      with an Ability is on your Bench" as a card called "a Pokémon with an Ability"
      and answer FALSE forever with no failure. One row per printing instead.

      Two facts the suite leans on. The clause names the ATTACKER'S OWN CARD, so
      arming it needs a SECOND copy on the Bench and the attacker must not count
      itself — the deck therefore runs six. And the clause is
      DEFENDER-INDEPENDENT (it reads your own Bench), which makes this the cast's
      §8.5 fold-order attacker: a Fighting body whose whole folded number doubles
      into a Fighting-weak defender. "Headbutt" at index 0 carries no `effect` key
      at all (not an empty string — the catalog row omits it). Verbatim off the
      local D1. */
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

  /** Drampa sv03-161 — the DRAGON body, and the only reason `opponentActiveHasType`
      can be armed on a real board at all: before D120 no fixture in the pool
      carried `types: ["Dragon"]` (the ten other type words all appeared; Dragon
      did not). Picked off the local D1 as the simplest Basic Dragon in
      sv01/sv02/sv03 with no Ability and at least one attack — Noibat sv02-152 (70
      HP) and Dratini sv03-157 (70 HP) are the alternatives, and Drampa's 120 HP is
      what lets Sylveon's UNARMED 90 leave it standing while the armed 180 does
      not.

      Faithful: 120 HP, Dragon, retreat 2, NO Weakness and NO Resistance — which is
      also why it is the arithmetically clean armed defender (Sylveon is a Psychic
      attacker, so §8.5 contributes nothing here and the 180 is the fold alone).
      Its single "Outrage" is kept verbatim and does derive (a
      `damageCountersOnSelf` scaler from D97) — irrelevant here, since this body
      only ever gets hit. */
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

  /** FIXTURE — a ×2 FIGHTING body (200 HP, no attacks), the D120 fold-order
      defender and the exact sibling of fix-psychic-weak / fix-water-weak: the pool
      held a ×2 Lightning, a ×2 Water, a ×2 Psychic and a ×2 Fire body but no ×2
      Fighting one that is otherwise inert (every faithful ×2 Fighting row in the
      file is a real card carrying attacks, an Ability or a rule box). Falinks is
      Fighting and its clause is defender-independent, so (70 + 90) × 2 = 320 here
      against the un-armed control's 70 × 2 = 140 — and 200 HP is chosen so the
      control leaves it standing while the armed hit Knocks it Out. A Basic, no
      rule box (1 Prize). */
  "fix-fighting-weak": battler("fix-fighting-weak", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
  }),

  // — M5 clause slice: the BOARD-WIDE Energy count (D121). Absol sv06.5-030
  //   "Darkfall" — the pool's only "at least" and only "Energy in play" sentence,
  //   read verbatim off the local D1 2026-08-01.
  /** Absol sv06.5-030 "Darkfall" (+50) — a Darkness Basic, 110 HP, retreat 1,
      ×2 Grass, NO Resistance, NO Ability (`abilities_json` is NULL on the row, not
      an empty array), reg mark H, Common, and the pool's only card named exactly
      "Absol" (the two "Absol ex" printings are a different card). Its ONE attack
      is the whole cast: {C} for 20+, and the clause counts Energy across your
      whole side rather than on the attacker, which is why the deck below can arm
      it with a Bench that Darkfall's own cost never touches. Verbatim off the
      local D1 — the effect string is PURE ASCII, 75 code points and 75 bytes: it
      names no Pokémon and carries no apostrophe of either kind. */
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
  /** A Basic Darkness Energy — the counted card. The pool prints `{D}` in effect
      text and spells "Darkness" out in cost arrays (two notation channels, D118),
      and this fixture is the cost-array side of that. */
  "fix-darkness-energy": typedEnergy("fix-darkness-energy", "Darkness"),
  /** FIXTURE (synthetic) — a 200 HP ×2 Darkness body with no attacks, for the
      §8.5 fold-order pair, on the fix-fighting-weak precedent and for the same
      reason: no faithful ×2 Darkness row in this file is inert. Absol is a
      Darkness Pokémon and its clause is DEFENDER-INDEPENDENT, so the Bench arms
      the bonus while the Weakness doubles it and the two layers cannot be
      confused: (20 + 50) × 2 = 140 against the un-armed control's 20 × 2 = 40.
      A Basic, no rule box (1 Prize). */
  "fix-darkness-weak": battler("fix-darkness-weak", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
  }),

  // — M5 clause slice: the POKÉMON TOOL clause (D122). Greedent sv01-152
  //   "Enhanced Fang" — the pool's only Tool-conditional damage sentence, read
  //   verbatim off the local D1 2026-08-01.
  /** Greedent sv01-152 "Enhanced Fang" (+80) — a Colorless STAGE 1 from Skwovet,
      120 HP, retreat 2, ×2 Fighting, NO Resistance, NO Ability (`abilities_json`
      is NULL on the row), reg mark G, Uncommon, and a singleton: no other card in
      the catalog is named "Greedent" or carries this attack text.

      TWO attacks, which is what makes the index-keyed negative real: index 0
      "Bite" ({C}{C} for a flat 50) carries NO `effect` key at all, so it derives
      to null on every path, and index 1 is the whole slice. The clause reads the
      attacker's OWN Tool, so the deck below arms it two ways — by surgery and by
      the real §7.4 `attachTool` action — and the Tool it uses must be one whose
      own passive cannot be mistaken for the bonus.

      Verbatim off the local D1 — the effect string is 77 code points / 79 UTF-8
      bytes, the two extra being the é in each "Pokémon"; it carries no apostrophe
      of either kind. */
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
  /** FIXTURE (synthetic) — a 200 HP ×2 Colorless body with no attacks, for the
      §8.5 fold-order pair, on the fix-darkness-weak / fix-fighting-weak
      precedent and for the same reason: no faithful ×2 Colorless row in this file
      is inert. Greedent is a Colorless Pokémon and its clause is
      DEFENDER-INDEPENDENT — the Tool sits on the ATTACKER — so the Weakness
      doubles a bonus the defender had no part in arming: (80 + 80) × 2 = 320
      against the un-armed control's 80 × 2 = 160. A Basic, no rule box (1 Prize),
      and 200 HP so neither number KOs it. */
  "fix-colorless-weak": battler("fix-colorless-weak", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),

  // — M5 clause slice: the SUPPORTER-PLAYED clause (D123). Pikachu swsh10.5-027
  //   "Buddy Bolt" — the pool's only printing of a clause that reads a TURN
  //   EVENT rather than a board, read verbatim off the local D1 2026-08-01.
  /** Pikachu swsh10.5-027 "Buddy Bolt" (+30) — a Lightning BASIC, 60 HP, retreat
      1, ×2 Fighting, NO Resistance, NO Ability (`abilities_json` is NULL on the
      row), reg mark F, and a HAPAX: no other card in the 978-card catalog prints
      this clause. A Basic, so it can open as the setup Active — but the deck below
      pins fix-bigbody anyway, on the TOOL_CLAUSE_DECK precedent, so no case is at
      the mercy of the deal.

      ONE attack, and the whole slice is in it. The clause is SEAT-RELATIVE and
      TURN-SCOPED, so the deck carries a real Supporter (Nemona sv01-180) to arm it
      through a genuine `playTrainer` action rather than by surgery — the flag it
      reads is one only the game sets.

      Verbatim off the local D1 — the effect string is 96 code points / 96 UTF-8
      bytes, i.e. PURE ASCII: no é (the sentence never says "Pokémon") and no
      apostrophe of either kind, in deliberate contrast to every clause row before
      it. */
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

  // — M5 clause slice: the PROMOTED clause (D124). Revavroom ex sv06.5-015 /
  //   -081 "Accelerator Flash" (+120) and Golisopod swsh10.5-026 "First
  //   Impression" (+90) — THREE printings of ONE byte-identical clause across TWO
  //   distinct cards, read verbatim off the local D1 2026-08-01. The pool sweep:
  //   "Active Spot this turn" occurs in exactly 5 cards (these 3 plus the two
  //   Palafin prints, which are the NEGATIVE twin — refused by the BONUS deriver
  //   at its outer anchor, and since D125 simulated off their own REQUIREMENT
  //   skeleton instead; Palafin sv03-062 is fielded in the D125 block below), and
  //   "moved from" in exactly these 3.
  /** Revavroom ex sv06.5-015 "Accelerator Flash" (20+, +120) — a STAGE 1 evolving
      from Varoom, 280 HP, retreat 1, ×2 Fighting, NO Resistance, NO Ability
      (`abilities_json` is NULL on the row), reg mark H, "Double rare", Standard
      legal. sv06.5-081 is the SAME CARD at "Ultra Rare" — byte-identical in every
      other field, `local_id` apart — so it is deliberately NOT a fixture: one
      print is enough to drive a clause that keys on TEXT, and the second is
      asserted only as a registry-row absence.

      THE TYPE/COST ODDITY IS FAITHFUL AND IS NOT A TYPO. `types_json` is
      ["Lightning"] while BOTH attack costs are Metal. That is what the ingest
      holds, so that is what this row holds — and it is load-bearing twice over:
      fix-metal-energy is what pays Accelerator Flash, while the §8.5 fold-order
      defender has to be ×2 LIGHTNING, because Weakness reads the attacker's TYPE
      and never its cost.

      A Stage 1, so it can NEVER be the dealt starter: every board case either
      places it by surgery or evolves a Varoom under it, and the deck below pins
      fix-bigbody as the mulligan-free Active on both sides.

      Attack 1 ("Shattering Speed", a flat 250 with "Discard this Pokémon and all
      attached cards.") is carried VERBATIM and is deliberately UNSIMULATED — it
      is here so the clause attack cannot be right merely by being the only attack
      on the card, and so index 0 has to be named.

      Verbatim off the local D1 — the clause is 101 code points / 102 UTF-8 bytes,
      the one extra byte being the é in "Pokémon". */
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
  /** Golisopod swsh10.5-026 "First Impression" (20+, +90) — the SECOND card on the
      same clause row, and the reason this slice is ONE literal row rather than a
      template: the clause is byte-identical to Revavroom ex's, and only the OUTER
      skeleton's captured amount differs (120 against 90). Nothing inside the
      clause varies, so there is nothing to parameterise.

      A Water Stage 1 evolving from Wimpod, 130 HP, retreat 2, ×2 Lightning, no
      Resistance, no Ability, reg mark F, "Holo Rare", and `legal_standard` 0 — an
      Expanded-only print, which is immaterial to a derivation that reads printed
      TEXT (`legal` is not a field any deriver consults).

      IT IS FIELDED, for one board case only: the deck below carries it and a {W}
      line, and the suite retreats into it to prove the FOLD reads the amount the
      derivation captured (20 + 90 = 110) rather than a constant learned from the
      +120 print. Everything else it could show, Revavroom ex already shows. Its
      own pre-evolution Wimpod swsh10.5-025 IS in this pool (D114's "Punk Out"
      holder), so a Wimpod → Golisopod line would be drivable — the
      evolution-survival case uses the Varoom line instead, because that one is
      the ex's OWN set and needs no second Energy type.

      Note attack 1: "Slash" (a flat 100) has NO `effect` key AT ALL on the row —
      not an empty string — so this fixture omits the field rather than spelling it
      "". Verbatim: the clause is 100 code points / 101 UTF-8 bytes. */
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
  /** Varoom sv06.5-043 — Revavroom ex's PRE-EVOLUTION, and the only reason the
      evolution-survival case can be driven at all: `placeEvolution` spreads the
      whole Pokémon (`{ ...from }`), so a `promotedTurn` stamped by a retreat has
      to survive a Stage 1 landing on top of it. Evolving is not un-moving.

      A Metal BASIC — 70 HP, retreat 1, ×2 Fire, -30 Grass Resistance, reg mark H,
      Common, Standard legal — verbatim off the D1. The pool prints six Varoom
      rows in all; this is the sv06.5 one, i.e. the ex's own set. Its `name` is
      what §10 matches against `evolveFrom: "Varoom"`, so the name field is
      load-bearing here in a way a plain fixture body's never is.

      Both attacks are carried verbatim and both are UNSIMULATED: Varoom is a body
      to be RETREATED IN and evolved, never one to attack with. The -30 Grass
      Resistance is faithful and inert — no attacker in the deck below is Grass. */
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
  /** FIXTURE (synthetic) — a 320 HP ×2 Lightning body with no attacks, the §8.5
      fold-order defender for Accelerator Flash, on the fix-colorless-weak /
      fix-water-weak precedent. Revavroom ex is a LIGHTNING attacker (its COSTS
      are Metal; Weakness reads the type), so the armed hit is (20 + 120) × 2 = 280
      against the un-armed control's 20 × 2 = 40.

      The pool's existing fix-lightning-weak is 130 HP and DIES to the armed
      number, which matters more here than in any predecessor suite: a KO parks the
      turn on a PROMOTION, i.e. on the very move this slice measures, dropping a
      second `promotedTurn` stamp into the middle of the arithmetic. 320 HP
      survives BOTH numbers, so the fold order stands alone with no KO, no prize
      take and no promotion in the way. A Basic (so it can pin as a setup Active),
      no rule box (1 Prize), no Resistance, no attacks — it only ever gets hit. */
  "fix-lightning-weak-big": battler("fix-lightning-weak-big", {
    hp: 320,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),

  // — M5 clause slice: the REQUIREMENT skeleton (D125). "If <clause>, this attack
  //   does nothing." — the clause family's SECOND CONSEQUENT, and its first that
  //   cancels rather than adds. Palafin sv03-062/-200 "Justice Kick" ({W}{W}, 210)
  //   and Lycanroc sv03-117 "Finishing Fang" ({F}, 90), read verbatim off the
  //   local D1 2026-08-01, plus BOTH printed pre-evolutions (Finizen sv03-061,
  //   Rockruff sv03-116) so `evolveFrom` names a body this pool actually holds.
  //
  //   The pool sweep behind the two rows: 19 printings say "this attack does
  //   nothing", and exactly these 3 (Palafin twice, Lycanroc once) are whole
  //   sentences of the form "If <clause>, this attack does nothing." with a clause
  //   the engine can answer. The other 16 stay LOUD — 12 coin-flip "Flip a coin.
  //   If tails, …" prints, 3 anaphoric "If you can't, …" prints, and Sharpedo
  //   sv06.5-034's named-card multi-sentence one — and attackRequirement.test.ts
  //   carries every one of those strings verbatim as a refusal witness.
  /** Palafin sv03-062 "Justice Kick" ({W}{W}, 210) — a WATER STAGE 1 evolving from
      Finizen, 150 HP, retreat 2, ×2 Lightning, NO Resistance, NO Ability
      (`abilities_json` is NULL on the row), reg mark G, "Rare", illustrator
      "Souichirou Gunjima", `legal_standard` 0 / `legal_expanded` 1. sv03-200 is
      the SAME CARD at a different rarity — byte-identical apart from `local_id` —
      so it is deliberately NOT a fixture, exactly as sv06.5-081 is not: one print
      is enough to drive a clause that keys on TEXT, and the second is asserted
      only as a registry-row absence. The Expanded-only legality is faithful and
      inert here, on the Golisopod precedent: `legal` is not a field any deriver,
      predicate or action consults, and the synthetic `battler` default (both true)
      is what the rest of this file carries.

      THE EXACT NEGATIVE TWIN of D124's Revavroom ex row, and the whole reason both
      cards sit in this file: the two sentences read the SAME `promotedTurn` stamp
      through two different consequents. The traps are printed, not invented —
      Palafin says "from the Bench" with NO possessive where Revavroom ex says
      "from your Bench", and "didn't" with an ASCII U+0027 apostrophe (the 978-card
      pool holds zero U+2019).

      A Stage 1, so it can NEVER be the dealt starter: every board case either
      places it by surgery or evolves a Finizen under it, and the deck below pins
      fix-bigbody as the mulligan-free Active on both sides.

      210 IS THE LARGEST NUMBER ANY CLAUSE SUITE HAS HAD TO LAND, and it is why the
      deck carries fix-lightning-weak-big (320 HP): fix-bigbody's 200 would be
      Knocked Out, parking the turn on a PROMOTION — i.e. on the very move Justice
      Kick's own clause reads — in the middle of the arithmetic being measured.

      Attack 0 ("Jet Punch", {W} 30, with the benched-snipe rider) is carried
      VERBATIM and is deliberately left to its own (already authored) family — it
      is here so the clause attack cannot be right merely by being the only attack
      on the card, and so index 1 has to be named.

      Verbatim off the local D1 — Justice Kick's sentence is 98 code points / 99
      UTF-8 bytes, the one extra byte being the é in "Pokémon". */
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
  /** Finizen sv03-061 — Palafin's PRE-EVOLUTION, and the body the
      evolution-survival case retreats in and evolves under. A Water BASIC, 90 HP,
      retreat 2, ×2 Lightning, no Resistance, no Ability, verbatim off the D1.

      Its `name` is what §10 matches against Palafin's `evolveFrom: "Finizen"`, so
      the name field is load-bearing here in a way a synthetic body's never is. NO
      ATTACKS are carried: Finizen is a body to be RETREATED IN and evolved, never
      one to act, and giving it an attack would only invite a case to use the wrong
      one. It retreats for 2, which is why the deck's plain {C} line is 6 deep. */
  "sv03-061": battler("sv03-061", {
    name: "Finizen",
    types: ["Water"],
    hp: 90,
    retreat: 2,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),
  /** Lycanroc sv03-117 "Finishing Fang" ({F}, 90) — the second card on this
      skeleton and a HAPAX on its clause: no other card in the 978-card catalog
      prints "has no damage counters on it before this attack does damage". A
      FIGHTING STAGE 1 evolving from Rockruff, 130 HP, retreat 2, ×2 Grass, no
      Resistance, no Ability, reg mark G — verbatim off the D1.

      THE ROW WHERE THE REQUIREMENT READING PAYS FOR ITSELF. The printed trailing
      qualifier "before this attack does damage" is discharged by the SITE, not by
      the predicate: `opponentActiveDamaged` is read at declaration and the D125
      gate sits in front of the §8.5 pipeline, so an undamaged defender cannot be
      bootstrapped into satisfying the clause by the very hit the clause gates.
      That case (attackRequirement.test.ts) is the mechanical proof.

      ATTACK 1 IS THE INDEX-KEYED NEGATIVE AND IS LOAD-BEARING TWICE. "Slashing
      Claw" ({F}{C}{C}, 100) has NO `effect` key AT ALL on the D1 row — not an
      empty string — so this fixture omits the field rather than spelling it "",
      and it must resolve as a plain 100 with no requirement and no skipped row.
      It is ALSO the suite's only honest way to put damage on a defender through a
      REAL attack before Finishing Fang is declared: Lycanroc damages with its own
      index 1 on one turn and reads that damage with index 0 two turns later.

      Verbatim off the local D1 — Finishing Fang's sentence is 120 code points /
      121 UTF-8 bytes, the one extra byte being the é in "Pokémon". */
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
  /** Rockruff sv03-116 — Lycanroc's PRE-EVOLUTION. A Fighting BASIC, 60 HP,
      retreat 1, ×2 Grass, verbatim off the D1.

      POOL-ONLY, and deliberately: it takes ZERO slots in ATTACK_REQUIREMENT_DECK,
      on the Wimpod precedent from D124. It is here because Lycanroc's `evolveFrom`
      names it and the by-NAME pool assertion in attackRequirement.test.ts checks
      that the named body exists — a Rockruff → Lycanroc line would be drivable if
      a case ever wanted one, but the evolution-survival case uses the Finizen line
      instead, because that is the one whose clause reads a promotion at all. */
  "sv03-116": battler("sv03-116", {
    name: "Rockruff",
    types: ["Fighting"],
    hp: 60,
    retreat: 1,
    weaknesses: [{ type: "Grass", value: "×2" }],
  }),
  /** Tarountula sv01-018 — the PRINTED COIN FLIP's cancel end (D126). "Surprise
      Attack" ({G}, 30): "Flip a coin. If tails, this attack does nothing."

      ELEVEN printings share that sentence char-for-char and this is the canonical
      one. A FLAT 30, not "30+" — the cancel consequent adds nothing, so there is
      no printed damage marker at all and `modifierSimulated` is never in play on
      this half of the slice (which is exactly the contrast that makes Litwick's
      "10+" worth spelling out below).

      ONE attack, so its index cannot be got wrong, and no ability. Its ×2 Fire
      Weakness is INERT against every attacker either coin fixture can face here
      (Tarountula is Grass, Litwick is Fire — and nothing attacks Tarountula in
      the suite), so no case in coinFlipDamage.test.ts is accidentally about
      Weakness. 60 HP: Firebreathing's heads 20 does not KO it, which keeps the
      seed sweep measuring damage rather than promotions.

      Verbatim off the local D1 — the sentence is pure ASCII, 48 code points /
      48 UTF-8 bytes, the family's first printed text with no é in it at all. */
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
  /** Litwick sv03-036 — the PRINTED COIN FLIP's bonus end (D126). "Firebreathing"
      ({R}, 10+): "Flip a coin. If heads, this attack does 10 more damage."

      THE "10+" IS THE LOAD-BEARING FIELD. `parseAttackDamage` splits it into base
      10 + modifier "+", and that modifier is precisely what the coin reader
      consumes — so this card is the fixture that catches a missed
      `modifierSimulated` term (it would resolve correctly AND still emit a loud
      ATTACK_EFFECT_SKIPPED row). It is typed as a STRING here because that is how
      it is printed; Tarountula's flat 30 is a number.

      10 is the SMALLEST of the seven printed N values in the pool
      ({10, 20, 30, 50, 60, 80, 90}), which is what makes the Weakness case
      readable: heads into a Fire-weak body is (10 + 10) × 2 = 40, where an
      after-W/R fold would give 10 × 2 + 10 = 30 — two numbers that cannot be
      confused for one another, and both under fix-weak's 60 HP so neither KOs.

      ONE attack, no ability, ×2 Water Weakness (inert against everything in the
      suite). Verbatim off the local D1 — pure ASCII, 55 code points / 55 bytes. */
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
  /** Tandemaus sv01-160 — the MULTI-FLIP COUNT FOLD's two-coin end (D127).
      "Double Hit" ({C}{C}, 30×): "Flip 2 coins. This attack does 30 damage for
      each heads."

      THE "30×" IS THE LOAD-BEARING FIELD, and it is load-bearing TWICE. Its digits
      ARE the per-heads amount, so the printed base must be DROPPED (0/30/60, never
      30/60/90) — the same treatment `deriveAttackDamageMultiplier`'s printings get,
      and the whole reason this shape is not the additive one. And its "×" modifier
      is what `modifierSimulated` has to claim, so this card is also the fixture
      that catches the missing term (correct damage AND a loud
      ATTACK_EFFECT_SKIPPED row on every attack — D126's trap, recurring exactly
      where D126 predicted it would).

      Two flips means THREE outcomes (0, 1, 2 heads) and therefore three distinct
      totals — 0, 30, 60 — which is what makes "the count is read, not assumed"
      observable. Verbatim off the local D1: pure ASCII, one attack, 40 HP,
      ×2 Fighting Weakness (inert against everything in the suite). */
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
  /** Meowth sv06.5-048 — the MULTI-FLIP COUNT FOLD's three-coin end (D127).
      "Fury Swipes" ({C}{C}, 20×): "Flip 3 coins. This attack does 20 damage for
      each heads."

      THE SECOND N IS THE POINT. A single printing would leave "2" indistinguishable
      from a hardcoded pair, and the rngState account (exactly `flips` steps per
      attack, no more) is only a real assertion when two different `flips` values
      are checked against the same code path. 20 ≠ 30 for the same reason: the
      totals of the two cards never collide (Meowth 0/20/40/60 against Tandemaus
      0/30/60 share only 0 and 60, and 60 needs a different heads count on each),
      so a case can never be passing for the other card's arithmetic.

      Verbatim off the local D1: pure ASCII, one attack, 70 HP, ×2 Fighting. */
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
  /** Torkoal sv01-035 — the BOARD-COUNTED FLIP COUNT's TYPED end (D128).
      "Concentrated Fire" ({R}{C}{C}, 80×): "Flip a coin for each {R} Energy
      attached to this Pokémon. This attack does 80 damage for each heads." — the
      pool's ONLY coin effect containing a brace token, and the printing that makes
      "the count is TYPED" observable at all.

      THE COST AND THE FILTER ARE DIFFERENT QUESTIONS, and this card is where they
      can be told apart on ONE board: {R}{C}{C} is MET by 1 Fire + 2 Water (the Fire
      pays {R}, the Waters pay the two {C}), but the `{R}` count is ONE, so the
      attack flips ONCE for a maximum of 80 — where a reader that counted attached
      CARDS would flip three times and could deal 240. Those two numbers cannot be
      confused for one another, which is the whole reason this fixture exists beside
      the untyped one.

      "Stampede" ({C}{C}, 30) rides along because it is printed: a plain flat number
      at index 0 keeps the flip attack at index 1 and gives the suite a control the
      coin never touches. Verbatim off the local D1: Basic Fire, 130 HP, retreat 3,
      ×2 Water (inert — nothing in the deck below is a Water attacker), rarity
      Uncommon / regulation mark G / sv01-035, none of which any reader here asks
      for (the fixture helpers supply the blank metadata every other card here uses).
      The effect sentence is NOT pure ASCII — "Pokémon" carries a U+00E9 — and its
      byte count is pinned in perEnergyFlip.test.ts. */
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
  /** Bellossom sv03-003 — the BOARD-COUNTED FLIP COUNT's UNTYPED end (D128).
      "Powerful Dance" ({G}, 90×): "Flip a coin for each Energy attached to this
      Pokémon. This attack does 90 damage for each heads." — no type filter at all,
      so the count is attached Energy CARDS and every attached card is one flip
      whatever it provides.

      A STAGE 2, which is why it is force-placed by surgery in every case rather
      than evolved: the suite is about the flip count, not about the evolution
      chain, and Gloom/Oddish are not in the deck. Its {G} cost is ONE symbol, so a
      board can hold Grass + Fire + Water and still pay — which is exactly the board
      that separates "counts cards" (3 flips) from "counts Grass" (1 flip).

      "Sleep Powder" ({C}, 30, "Your opponent's Active Pokémon is now Asleep.") rides
      along at index 0 because it is printed, which puts the flip attack at index 1
      — the same index as Torkoal's, deliberately, so one FLIP_INDEX serves both.
      Verbatim off the local D1: 130 HP, Grass, retreat 1, ×2 Fire, evolves from
      Gloom, rarity Uncommon / mark G / sv03-003. BOTH of its effect sentences carry
      the U+00E9 of "Pokémon". */
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
  /** FIXTURE — the ZERO-COUNT probe for D128's board-counted flip count, and it is
      CONSTRUCTED because no printed card can reach the branch: all three printings
      of the sentence carry a cost floor of at least one Energy, and Torkoal's `{R}`
      cost IS the `{R}` its filter counts, so a legal declaration always leaves at
      least one Energy for the filter to find. This body prints a `{C}` cost against
      a `{W}` filter — the one combination that separates "what pays" from "what
      counts" completely — so an attack that is perfectly legal with a single Fire
      attached counts ZERO and therefore flips ZERO times.
      Zero flips is not zero heads: no ATTACK_EFFECT_COIN_FLIP rows at all and no
      rngState step consumed, where D127's zero-HEADS outcome spends its flips and
      announces every one of them. Both land on the same ending. 130 HP and one
      attack, so the index cannot be got wrong and the body can also be attacked. */
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
  /** Growlithe sv01-030 — the UNBOUNDED FOLD's MULTIPLY form (D129), and the
      cheapest board in the family: ONE {R} pays "Relentless Flames", so the only
      thing varying across a seed sweep is the flip sequence itself. Verbatim off the
      local D1 (2026-08-01): 70 HP, Fire, Basic, retreat 2, ×2 Water, no Resistance,
      no Ability, exactly one attack, rarity Common / mark G.

      "30×" is the load-bearing field TWICE over, exactly as it is for D127's and
      D128's printings: its digits ARE the per-heads amount, so `scaledBase` must
      DROP the printed base (a two-heads Growlithe deals 60, not 30 + 60), and its
      "×" is the modifier `modifierSimulated` has to claim. Three of the pool's other
      four unbounded damaging printings are the same sentence with a different number
      (Rellor sv02-026 also 30, Forretress sv01-139 50, Chansey sv01-144 60), which
      is what makes this a SHAPE rather than a row. */
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
  /** Chansey sv01-144 — the SECOND multiply printing of the same sentence, with the
      family's LARGEST per (60). It is here for the reason D127 fielded two cards:
      one printing cannot tell a `per` READ off the regex from a hardcoded 30, and
      60 ≠ 30 makes every damage assertion in the suite a claim about the capture.
      Verbatim off the local D1: 110 HP, Colorless, Basic, retreat 2, ×2 Fighting,
      TWO attacks — a flat "Pound" ({C}{C}, 40) at index 0 and "Egg Rolling"
      ({C}{C}{C}, 60×) at index 1, which is also the suite's control for "the coin
      reader is keyed to the TEXT of the attack declared, not to the card". */
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
  /** Rellor sv02-026 — D129's multiply form, THIRD printing, and the one that makes
      the shape a shape: its effect sentence is BYTE-IDENTICAL to Growlithe's (same
      30, same everything), on a card of a different type, cost and set. D121's
      warrant for a parameterised reading rather than a row is "two printings with
      one token varying", and this pair does not even vary the token.

      DERIVER-ONLY, and deliberately not in any deck: a board case would re-run
      Growlithe's arithmetic on the same number and prove nothing the deriver has not
      already said. Same call perEnergyFlip.test.ts makes for Ambipom. Verbatim off
      the local D1: 50 HP, Grass, Basic, retreat 1, ×2 Fire, one attack, {C}{C}. */
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
  /** Forretress sv01-139 — D129's multiply form, FOURTH printing, at the family's
      middle per (50). Verbatim off the local D1: 120 HP, Metal, Stage 1 from Pineco,
      retreat 3, ×2 Fire, −30 Grass Resistance (the family's only printing with one),
      two attacks — "Continuous Spin" ({M}, 50×) at index 0 and "Rolling Shell" at
      index 1.

      ⚠️ NO LONGER DERIVER-ONLY, AND THE REASON IS D147: this fixture was fielded for
      its INDEX-0 multiply sentence, and its INDEX-1 "Rolling Shell" happened to be
      carrying a durated damage reduction that nothing read — a real card sitting in
      the pool with an unmapped rider. That rider is now the 50-amount printing of
      D147's family, so the card is DRIVEN (`DAMAGE_REDUCTION_DECK`) as well as
      derived, and the datum this slice needed for its index control and for its
      §10 evolve line was already here. Its pre-evolution Pineco sv01-001 is the
      30-amount printing, which is why the pair reaches the evolve clear with two
      printed cards instead of a synthetic chain. */
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
  /** Gyarados swsh10.5-022 — D130's UNBOUNDED half: "Flip a coin until you get
      tails. For each heads, discard the top 2 cards of your opponent's deck." It was
      fielded by D129 as an UNMAPPED witness (the shape ran an EffectOp per heads
      rather than folding a number, which is a different mechanism at a different
      site); D130 built that mechanism, so this card now MAPS — to
      `programPerHeads` over `flips: { kind: "untilTails" }`, expanded at the flip
      site into one `discardDeckTop { whose: "opponent", count: 2 }` per heads.

      "Wreak Havoc" is the load-bearing one: a {C} cost (paid by the same fix-energy
      line as Bouffalant's) and NO printed damage at all, so the mill is the entire
      visible result of a declaration — there is no number for a mis-read to hide
      behind, and no `damage` marker for `modifierSimulated` to have to explain.

      "Wild Splash" at index 1 IS THE SAME OP AIMED THE OTHER WAY, and since D131 it
      SIMULATES: "Discard the top 5 cards of YOUR deck" derives to
      `discardDeckTop { whose: "self", count: 5 }` off the bare-sentence reader, with
      230 printed damage in front of it. It was D130's deliberate refusal (the op was
      opponent-only by D104's minimal shape, and this sentence was the second reading
      it wanted before widening); D131 took it, so ONE fixture card now carries both
      directions of one action — index 0 mills the opponent behind a coin, index 1
      mills its own deck flat. Nothing about the fixture changed to make that true,
      which is the point: the bytes were already verbatim.

      Verbatim off the local D1 (2026-08-01): 170 HP, Water, Stage 1 from Magikarp,
      retreat 3, ×2 Lightning, and NO Resistance — the row's `resistances_json` is
      null. (An earlier version of this fixture invented a −30 Grass Resistance; it
      was never read by any assertion, which is how it survived.) */
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
  /** Wugtrio sv01-057 — D130's PRINTED half: "Flip 3 coins. For each heads, discard
      the top 3 cards of your opponent's deck." at INDEX 1, behind a flat "Headbutt"
      (30, {W}, no effect) at index 0.

      IT IS THE OTHER FLIP COUNT ON THE SAME CONSEQUENT, which is the whole reason
      D130 is a slice and not a one-off: `{ kind: "printed", count: 3 }` against
      Gyarados's `{ kind: "untilTails" }`, feeding a byte-identical
      `discardDeckTop` (count 3 against count 2). Count and consequent are
      independent axes, demonstrated on two cards rather than asserted in a comment.

      Its index-0 "Headbutt" is the control the family always fields: a bare number
      on the same card and the same board, which must take NO flip, keep its printed
      base and emit no loud row — the claim that the coin reader is keyed to the TEXT
      of the attack declared and not to the card carrying it. And its PRE-EVOLUTION
      Wiglett sv01-056 prints the sharpest near-miss in the slice ("Flip a coin. If
      heads, discard the top card of your opponent's deck." — singular, gated, one
      flip), so the two live one evolution apart in the same pool.

      Verbatim off the local D1 (2026-08-01): 90 HP, Water, Stage 1 from Wiglett,
      retreat 2, ×2 Lightning, no Resistance, no Ability. The {C}{C}{C} cost is paid
      by the fix-energy line; note that "Undersea Tunnel" prints NO `damage` field at
      all, so a mis-read has no number to land on. */
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
  /** Skwovet sv03-178 — D131's OPPONENT-side witness: "Nicked Nibble" ({C}, index 0)
      is "Discard the top card of your opponent's deck." with NO `damage` field at
      all, so the mill is the entire visible result of the declaration and no number
      can hide a mis-read.

      IT IS THE SINGULAR BRANCH. The pool prints "the top card" (7 printings) and
      "the top N cards" (9) and never "the top 1 cards", so the anchor gives the
      singular its own alternation arm rather than an optional digit group — and this
      fixture is the end-to-end case for it: the arm that captures NOTHING must still
      produce `count: 1`, which is the one place the deriver invents a number instead
      of reading one.

      "Gentle Slap" at index 1 is the control the family always fields — {C} for a
      flat 10 with no effect text, on the SAME card and the same board, which must
      mill nothing and emit no loud row. That the two attacks cost the same single {C}
      is what makes the control sharp here: nothing but the INDEX distinguishes them,
      so an implementation keyed to the card rather than to the declared attack's text
      fails on it.

      Verbatim off the local D1 (2026-08-01): 60 HP, Colorless, BASIC (no evolution
      surgery needed — it can be dealt straight into the Active Spot), retreat 1, ×2
      Fighting, no Resistance, no Ability. */
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
  /** Krookodile sv01-117 — the "For each heads, <effect>." printing that stays
      UNMAPPED after D130, and the suite's re-pointed end-to-end LOUD witness (it
      took that job from Gyarados swsh10.5-022, which D130 maps).

      "Chomp Chomp Bite" ({F}, 50) is "Flip a coin until you get tails. For each
      heads, discard an Energy from your opponent's Active Pokémon." — D129's leading
      sentence and D130's per-heads REPEAT, refused by neither of those slices for
      want of a regex but for want of a mechanism: `discardEnergy` PARKS on a choice,
      so N heads means N SEQUENTIAL PARKS across a serialized continuation, which is
      the one thing D130's expansion cannot express. (Masquerain sv03-007 is the
      other survivor, and its cost is different again: its "discard a random card
      from your opponent's hand" would be the first EffectOp to consume
      `state.rngState`.)

      IT IS FIELDED RATHER THAN MERELY DERIVED because "stays loud" is a claim about
      a declared attack, not about a null out of a deriver: the attack must reach
      ATTACK_EFFECT_SKIPPED and take NO flip at all. Its flat `damage: 50` is what
      makes it the easier of the two end-to-end (Masquerain prints no damage), and
      the 50 landing unmodified is the second half of the claim — an unmapped
      sentence must not stop the printed number.

      Verbatim off the local D1 (2026-08-01): 170 HP, Fighting, STAGE 2 from
      Krokorok, retreat 3, ×2 Grass, no Resistance, no Ability. A Stage 2 reaches the
      Active Spot here by `setActiveFromDeck` surgery, which does not care about the
      evolution line. */
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
  /** Natu swsh10.5-032 — D132's NO-PRINTED-DAMAGE witness for the bare self-heal,
      and the second of the family's four clauses ("Heal 20 damage from this
      Pokémon.", 5 printings; Ceruledge sv02-098 above already carried the 30).

      "Nap" ({C}, index 0) prints NO `damage` field at all, so the heal is the
      ENTIRE visible result of the declaration — no number can hide a mis-read, and
      the case can assert that zero DAMAGE_DEALT rows fire and the defender's damage
      never moves. That is the half Ceruledge cannot state: six of the eighteen
      printings heal and do nothing else, and an implementation that folded the heal
      into the damage pipeline rather than running it as a tail op would pass every
      Ceruledge assertion and fail here.

      "Peck" at index 1 ({P}{C}, 20) is the control the family always fields: a flat
      number with NO effect text on the SAME card. Its {P} is deliberately NOT paid
      by SELF_HEAL_DECK (which holds only Colorless Basic Energy), so it is exercised
      at the DERIVER level rather than on a board — the same arrangement Wugtrio's
      index-0 "Headbutt" has in PER_HEADS_PROGRAM_DECK, and enough for what the
      control claims: an attack with no effect text derives no op.

      Verbatim off the local D1 (2026-08-01): 50 HP, Psychic, BASIC (no evolution
      surgery needed — it can be dealt straight into the Active Spot), retreat 1, ×2
      Darkness, and a real −30 Fighting RESISTANCE, kept faithful because it is
      rare in this pool and because a Resistance on the HEALING side is exactly the
      kind of modifier a heal must not consult (§8.5 governs damage taken, not
      damage removed). No Ability. */
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
  /** Skeledirge ex sv02-037 — D133's WITH-PRINTED-DAMAGE witness for the OWN-BOARD
      heal ("Heal 30 damage from each of your Pokémon.", the larger of the family's
      two clauses; the same clause Steenee sv03-017 prints without damage).

      "Vitality Song" ({R}, index 0) heals 30 from the WHOLE own board AND deals a
      flat 50, so it is where the tail placement (D125 — ops run AFTER the §8.5
      pipeline) is asserted on this family and where the direction shows: the seat
      it heals must be the ATTACKER's, and the defender it just hit must stay hit.
      Four of the family's seven printings are this card (-037/-233/-258/-272 are
      the same attack in four rarities).

      A STAGE 2 from Crocalor, so it is NEVER played — it reaches the Active Spot
      only by `setActiveFromDeck` surgery, which does not care about the evolution
      line. Its index-1 "Burning Voice" ({R}{R}, 270−) is a scaling clause belonging
      to another family and is unpayable out of BOARD_HEAL_DECK's single Fire line
      per turn anyway.

      ⚠️ IT IS AN `ex`, AND THAT IS KEPT ON PURPOSE. `prizeValueOf` reads the rule
      box off the NAME (cards.ts), so "Skeledirge ex" is worth TWO Prizes — the only
      fixture in this deck that is. Nothing in the heal family depends on it, which
      is exactly why it is worth keeping faithful: a KO of this attacker (it cannot
      happen on these boards — 340 HP against a titan with no attacks) would take 2,
      and a fixture that quietly renamed it "Skeledirge" would make that untrue
      without any test noticing.

      Verbatim off the local D1 (2026-08-01): 340 HP, Fire, Stage2 from Crocalor,
      retreat 3, ×2 Water, no Resistance, no Ability. */
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
  /** Cresselia sv06.5-021 — D133's NO-PRINTED-DAMAGE witness for the own-board heal,
      and the second of the family's two clauses ("Heal 20 damage from each of your
      Pokémon.", 2 printings: -021 and -071).

      "Healing Pirouette" ({P}, index 0) prints NO `damage` field at all, so the
      board heal is the ENTIRE visible result — the same half Natu plays for the bare
      self-heal, and needed for the same reason: an implementation that folded the
      heal into the damage pipeline would pass every Skeledirge assertion and fail
      here. Its N is 20 rather than 30 so that a hardcoded amount cannot satisfy both
      fixtures.

      A BASIC, so no evolution surgery is needed in principle; it is still fielded by
      `setActiveFromDeck` so both attackers' boards are the same shape.

      Its index-1 "Crescent Purge" ({P}{P}{P}, 80+) is a face-up-Prize clause from a
      family nothing has mapped — unpayable out of this deck, and left faithful
      rather than trimmed so the index-keyed control has real text to be a control
      of.

      Verbatim off the local D1 (2026-08-01): 120 HP, Psychic, Basic, retreat 1, ×2
      Darkness, −30 Fighting Resistance, no Ability. */
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
  /** Fuecoco sv02-035 — D134's FLIP-GATED HEAL, and 2 of the family's 3 printings
      (-035 and -201 are one attack in two rarities). "Spacing Out" ({C}, index 0) is
      "Flip a coin. If heads, heal 30 damage from this Pokémon." with NO `damage`
      field at all, so the gated heal is the ENTIRE visible result of the declaration
      and neither face has a number to hide behind: heads moves damage, tails moves
      nothing, and the two boards differ only in the thing under test.

      IT IS THE SHARPEST NEAR-MISS THE BARE SELF-HEAL HAS (selfHeal.test.ts pinned it
      as such from 0.83.0 until this slice mapped it), which is the point of fielding
      it now: the same action, the same target, one flip in front. A reader without
      `^` would take the tail and heal unconditionally — turning a 50% effect into a
      certainty and never saying so — and the end-to-end tails case is what catches
      that, since a heads-only suite passes either way.

      "Flare" at index 1 ({R}{C}, 30, no effect text) is the control the family always
      fields: real printed damage on the SAME card, which must take NO coin at all.
      Its {R} is why FLIP_GATED_OP_DECK carries a Fire line it otherwise would not.

      Verbatim off the local D1 (2026-08-01): 90 HP, Fire, BASIC (no evolution
      surgery — it can be dealt straight into the Active Spot), retreat 3, ×2 Water,
      no Resistance, no Ability. */
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
  /** Wiglett sv01-056 — D134's FLIP-GATED MILL, the family's third printing and the
      only one of its clause. "Dig a Little" ({C}, index 0) is "Flip a coin. If heads,
      discard the top card of your opponent's deck.", again with NO `damage` field.

      ONE PRINTING, SO IT IS NOT DEFENSIBLE ALONE — D121's warrant wants two — and
      that is exactly why it ships beside Fuecoco rather than on its own: the SHAPE
      has 3 printings / 2 clauses, and the engine already reads two other instances
      of it (`FLIP_DEFENDER_NOW`, `FLIP_OPPONENT_ACTIVE_DISCARD`). Its second job is
      to prove the family is not one regex with a substitutable middle: the two
      consequents share no vocabulary at all, which is what makes the arms literal
      rather than a D120 template.

      IT HAS BEEN THIS REPO'S MOST-CITED NEAR-MISS — pinned by perHeadsProgram.test.ts
      (refused on three separate counts) and by deckTopMill.test.ts (the gated twin of
      the singular). Those files' claims survive this slice unchanged, because they
      are about OTHER readers and about the BARE anchor; what changes is only that
      `deriveAttackEffect` now returns a gated program instead of null.

      "Ram" at index 1 ({C}{C}, 20, no effect text) is the control — and a sharper one
      than usual, since it is payable out of the very same Colorless line as the gated
      attack, so nothing but the INDEX tells the two apart.

      Verbatim off the local D1 (2026-08-01): 60 HP, Water, BASIC, retreat 1, ×2
      Lightning, no Resistance, no Ability. */
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
  /** Nacli sv02-121 — D135's ANY-ZONE chosen heal, and 2 of that reading's 5
      printings (-121 and -220 are one attack in two rarities). "Salt Coating"
      ({F}, index 0) is "Heal 20 damage from 1 of your Pokémon." with NO `damage`
      field, so the PARK is the entire visible result of the declaration: the
      attack stops, asks, and everything else on the board stays where it was.

      IT IS THE ONE PRINTING WHOSE CANDIDATE SET INCLUDES THE ATTACKER. "1 of your
      Pokémon" is §1.1's reading — the Active AND the Bench — and from an attack
      the Active is the body that just declared, so a build that quietly excluded
      "this Pokémon" (a plausible reading of a heal printed on an attacker) passes
      every bench assertion in the suite and fails only on the Active pick. It was
      a NEAR-MISS witness in boardHeal.test.ts from 0.84.0 until this slice mapped
      it, for the neighbouring reason: a chosen target is not "each of your".

      Its index-1 "Tackle" ({F}{F}, 30, no effect text) is the control the family
      always fields: real printed damage on the SAME card, which must park nothing.

      Verbatim off the local D1 (2026-08-01): 70 HP, Fighting, BASIC (no evolution
      surgery — it can be dealt straight into the Active Spot), retreat 3, ×2
      Grass, no Resistance, no Ability. The 70 HP is load-bearing in the suite:
      every damage figure the attacker carries has to stay under it or the attack
      epilogue's KO sweep takes the body out from under the assertion. */
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
  /** Tropius sv01-007 — D135's BENCH-ONLY chosen heal, one of that reading's 5
      printings and the sharpest claim of the slice. "Fresh-Picked Fruit" ({G},
      index 0) is "Heal 60 damage from 1 of your Benched Pokémon." — again with NO
      `damage` field.

      THE PRINTED WORD "Benched" IS THE WHOLE DIFFERENCE from Nacli, and it is one
      optional capture in one regex that lands in one FIELD of the same op. What
      it must do downstream is drop the Active from the candidate set and change
      the prompt's heading to match; what it must NOT do is anything else. So the
      board that tests it keeps the ACTIVE DAMAGED throughout: an implementation
      that read the zone for the heading and not for the candidates, or the other
      way round, produces a prompt that lies about what it is offering, and only a
      damaged Active makes the two failures visible.

      Its 100 HP is chosen the same way Nacli's 70 is — the attacker carries
      damage in most of these cases and must stay well under its own HP.

      "Razor Leaf" at index 1 ({G}{C}, 50, no effect text) is the control.

      Verbatim off the local D1 (2026-08-01): 100 HP, Grass, BASIC, retreat 1, ×2
      Fire, no Resistance, no Ability. */
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
  /** fix-allheal — FIXTURE, and the invention is precisely and only the BODY.
      THE EFFECT STRING IS REAL AND VERBATIM: "Heal all damage from 1 of your
      Benched Pokémon." is printed by Blissey swsh10.5-052 ("Enriching Egg") and
      by Arboliva sv03-021 ("Healing Fruit") — 2 of D135's 10 printings, and the
      only clause of the family whose `amount` is not a number.

      WHY IT IS NOT SIMPLY BLISSEY. Both printings are EVOLUTIONS (Blissey is a
      Stage 1 off Chansey, Arboliva a Stage 2 off Dolliv), so driving either one
      end to end means either scripting a chain or reaching for
      `setActiveFromDeck` surgery on a card that could never legally arrive that
      way. The "all" amount is a property of the SENTENCE, not of the evolution
      line, and the file's standing convention (fix-titan, fix-condgate,
      fix-flip-filter) is to construct the body when the body is not the claim.
      Both REAL ids are still fielded — in FIXTURE_POOL nowhere, but in the
      suite's derivation table and its zero-registry-row sweep, which is where a
      printing's identity actually matters.

      120 HP and retreat 1 are ordinary; the {C} cost is the cheapest thing that
      can be paid out of one line so a board is a setup plus one attach. Index 1
      ("Blunt Hit", {C}{C}, 30, no effect text) is the control. */
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

  // — M5 op-slice: the COUNTER MOVE (D138). "Move all damage counters from 1 of
  //   your Benched Pokémon to your opponent's Active Pokémon." —
  /** Dedenne ex sv02-093 — the pool's ONLY counter-move ATTACK, and 1 of its 2
      printings (-093 Double rare / -239 Ultra Rare are one card in two rarities,
      which is what meets D121's second-printing warrant without a family
      argument).

      ⚠️ THE ATTACK IS "Tail Swap", not "Dedechange". Three remainder lists in a
      row carried the wrong name; the D1 has no printing of "Dedechange" at all.
      Pinned in the suite's fixture-bytes case for that reason.

      "Tail Swap" ({P}{P}, index 0) carries NO `damage` field, so the move — and
      the park in front of it — is the entire visible result of the declaration:
      there is no number for a half-simulation to hide behind, exactly as in
      D135's family.

      Index 1 "Wondrous Shot" ({P}{P}{P}, 170, "Discard an Energy from this
      Pokémon.") is the control, and it is a BETTER one than the family's usual
      effect-less second attack: its sentence is read by a DIFFERENT arm of the
      same deriver (the printed self-discard cost, since 0.x), so the suite can
      assert that one card's two attacks derive two different ops and that
      neither reaches the other's anchor.

      170 HP is load-bearing in one direction only — the attacker never carries
      damage in this suite (its own board's counters live on the BENCH) — but the
      "ex" in the NAME is: `pokemonSuffixOf` reads it, so this body is worth 2
      Prizes and `isExOrV` is true of it. Neither matters to any case here (it is
      never Knocked Out, and no fixture in the deck carries a prevention passive),
      and both are written down so a later case does not discover them.

      Verbatim off the local D1 (2026-08-02): 170 HP, Psychic, BASIC (so no
      evolution surgery — it can be dealt straight into the Active Spot), retreat
      1, ×2 Metal, NO Resistance, `abilities_json` NULL, reg mark G. */
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
  /** FIXTURE (synthetic) — a 200 HP ×2 PSYCHIC body with no attacks, on the
      fix-colorless-weak-big / fix-lightning-weak-big precedent and for the same
      reason: the printed Psychic-weak rows in this file all carry attacks or an
      HP that a moved counter pile would Knock Out mid-assertion.

      It exists to pin ONE claim, and it is the sharpest thing the destination
      half asserts: a MOVED counter is not attack damage, so §8.5's Weakness
      never touches it. Dedenne ex is a Psychic attacker and this defender is ×2
      Psychic, so a build that routed the placement through the damage pipeline
      would double the pile — 160 against the 80 that actually came off the
      Bench — and 200 HP survives BOTH numbers, so the case measures the amount
      and never a promotion. */
  "fix-psychic-weak-big": battler("fix-psychic-weak-big", {
    hp: 200,
    retreat: 1,
    weaknesses: [{ type: "Psychic", value: "×2" }],
  }),
  /** The OTHER side of the flat-placement claim (D139): a 200 HP body with a
      Psychic RESISTANCE and no Weakness at all. `fix-psychic-weak-big` proves a
      routed-through-§8.5 build reads too HIGH; this one proves it would read too
      LOW, and the two errors are different bugs — a build that special-cased
      Weakness alone passes the first case and fails this one. No attacks, so it
      never hits back and never truncates an assertion. */
  "fix-psychic-resist-big": battler("fix-psychic-resist-big", {
    hp: 200,
    retreat: 1,
    resistances: [{ type: "Psychic", value: "-30" }],
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

/** 0.89.0 → 0.90.0: the §9 recoil LABEL (D141). The one board neither of the two
    decks above can build — an ABILITY recoil and a TOOL recoil on the SAME holder,
    so `passivesOf` sums them into ONE number and ONE COUNTERS_PLACED row. Stunfisk
    sv03-112 "Custom Trap" (50, requiresTool) wearing Rocky Helmet sv01-193 (20) is
    50 + 20 = 70, and it is the card's OWN intended board rather than a contrivance:
    Custom Trap does not fire at all unless a Tool is attached. Cacturne sv01-006
    rides along as the Ability-only control on the same deck (30, no Tool), and
    fix-bigbody + Rocky Helmet is the Tool-only one. A DEDICATED deck because both
    older decks are seed-pinned by their own suites. fix-bigbody is the DOMINANT
    (mulligan-free) Basic + the promote target both sides; fix-energy pays Bite's
    {C}. BOTH seats run it so the holder can be surgically fielded on P2. */
export const COUNTERATTACK_DECK = deckOf({
  "fix-attacker": 8, // the plain-damage attacker (Bite = {C} 30, index 0; Yawn = index 2)
  "sv03-112": 4, // Stunfisk — Custom Trap (50, ONLY while a Pokémon Tool is attached)
  "sv01-005": 4, // Cacnea — Counterattack Quills (30, ungated)
  "sv01-006": 4, // Cacturne — Counterattack Quills (the same 30, 130 HP)
  "sv01-193": 4, // Rocky Helmet — the recoil TOOL (20), and Custom Trap's own gate
  // ALL FOUR authored `damageAttacker` producers ride this one deck on purpose:
  // the suite's guard sweeps the pool for the family and then DRIVES every member
  // it finds, so a producer that cannot be fielded here would silently skip.
  "fix-bigbody": 28, // 200 HP neutral Basic — DOMINANT setup + the bare Tool holder + promote target
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

/** 0.69.0 → 0.70.0: the PUBLIC-COUNT cluster (D119) — four clauses reading a
    COUNT rather than anything on a Pokémon: Absol ex sv03-135/-214 "Cursed Slug"
    (their hand ≤ 3, +120), Bronzong sv03-145 "Extrasensory" (the two hands equal,
    +90), Krokorok sv01-116 "Payback" (their Prizes exactly 1, +90) and Houndstone
    sv03-101 "Two Four-ocious" (exactly 2 or 4, +120).

    A DEDICATED deck for the usual reason (every existing deck is seed-pinned) and
    one specific to this slice: HAND SIZE is a thing the clauses read, so a suite
    that shared a deck would be asserting on numbers another suite's draws move.

    THE DECK IS SIZED BY THE COUNTS IT HAS TO MOVE. fix-bigbody is 30 of the 60 —
    the DOMINANT mulligan-free starter, both pinned Actives, and the arithmetically
    clean 200 HP defender every unweighted number is measured against; it carries
    NO attacks, which is why the one board that needs P2 to swing fields a real
    Krokorok there instead. Basics are 35 of 60 so the opening hand reliably holds
    the three spare Basics the ORGANIC hand-shedding case benches to get P2 down to
    exactly 3 cards. fix-psychic-weak (200 HP, ×2 Psychic) is the §8.5 fold-order
    defender — Houndstone is Psychic, so (80 + 120) × 2 = 400 against the un-armed
    control's 160.

    Energy is one line per printed COST and no plain {C} at all: the Colorless
    symbols in Cursed Slug's {D}{D}{C} and Two Four-ocious's {P}{C}{C} are paid
    with the attacker's own typed Energy, which is legal (§8.2) and keeps the deck
    down to four Energy lines. Counts are generous rather than exact because a
    seat's opening hand and Prize row hold 13 of its 60 cards, and every board here
    pulls its Energy out of what is LEFT — three copies deep on the two attacks
    that want three. No Energy in this cast ARMS anything; unlike D118's, every
    clause here reads a count no Energy can touch. Both seats run the whole deck,
    since three of the four clauses are seat-asymmetric and the asymmetry is only
    assertable if the same body can be fielded on either side. */
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

/** 0.70.0 → 0.71.0: the TYPE-vs-NAME pair (D120) — two clauses that each vary on
    exactly ONE token and get OPPOSITE treatments: Sylveon swsh10.5-035 "Wonder
    Flash" (their Active is a Dragon Pokémon, +90) is a parameterised TEMPLATE,
    Falinks sv02-119 "Reckless Charge Together" (a Falinks is on your Bench, +90)
    is a LITERAL row. The discriminator is whether the varying token has a CLOSED
    vocabulary to be rejected against; a type name has eleven, a card name has
    none.

    A DEDICATED deck for the usual reason (every existing deck is seed-pinned by
    its own suite) and one specific to this slice: the Falinks clause reads the
    attacker's own BENCH, so a shared deck would have every other suite's benched
    bodies deciding whether this one's clause is armed.

    THE DECK IS TWO CASTS THAT NEED OPPOSITE THINGS.

      • Sylveon needs a DRAGON to point at. sv03-161 Drampa is the pool's Dragon
        body — added by this slice, because before it no fixture carried
        `types: ["Dragon"]` at all — and at 120 HP with no Weakness it survives the
        un-armed 90 and dies to the armed 180, so the two boards differ visibly in
        more than a number. fix-bigbody (200 HP, COLORLESS) is the non-Dragon
        control on the same swing: the type read is `Card.types.includes`, so a
        Colorless body is a genuine negative rather than an absent field.
      • Falinks needs A SECOND FALINKS. The clause names the attacker's own card,
        so arming it means one in the Active Spot and one on the Bench, and the
        case that matters most is the one where the attacker must NOT count
        itself. Six copies, because a seat's opening hand and Prize row hold 13 of
        its 60 cards and two have to be left in the deck for the surgery to reach.

    fix-fighting-weak (200 HP, ×2 Fighting, no attacks) is the §8.5 fold-order
    defender — Falinks is a Fighting Pokémon and its clause is
    DEFENDER-INDEPENDENT, which is exactly what makes it the right attacker for
    that case: the Bench arms the bonus while the Weakness doubles it, and the two
    layers cannot be confused for each other. (70 + 90) × 2 = 320 against the
    control's 70 × 2 = 140.

    fix-bigbody is 31 of 60 — the DOMINANT mulligan-free starter, and BOTH setup
    Actives are pinned to it BY NAME (`active:`) rather than by whatever Basic the
    deal happened to put first in hand. That pin is load-bearing here and nowhere
    else in the family: every surgery below displaces the Active onto the BENCH,
    which is the zone this slice's second clause reads, so a deal-dependent starter
    would be a deal-dependent clause.

    Energy is one line per printed TYPED symbol and no plain {C} at all, the
    PUBLIC_COUNT_DECK convention: the Colorless symbols in Wonder Flash's {C}{C}{C}
    and Reckless Charge Together's {F}{C}{C} are paid with typed Energy, which is
    legal (§8.2). Each attacker draws ONE card of its own printed type and TWO of
    the other line, so no single line is ever asked for more than two — which
    matters because a seat's opening hand and Prize row hold 13 of its 60 before
    any surgery runs, and `attachFromDeck` reaches only what is LEFT. {P} also buys
    Souvenir at Sylveon's index 0, the unbuilt sibling the ATTACK_EFFECT_SKIPPED
    contrast rides on. No Energy in this cast ARMS anything: unlike D118's, neither
    clause here can be touched by an attachment. Both seats run the whole deck,
    since both clauses are seat-asymmetric and the asymmetry is only assertable if
    the same body can be fielded on either side. */
export const TYPE_NAME_DECK = deckOf({
  "sv02-119": 6, // Falinks — "Reckless Charge Together" (70+): yourBenchHasNamed, +90. Needs TWO at once.
  "swsh10.5-035": 4, // Sylveon — "Wonder Flash" (90+): opponentActiveHasType Dragon, +90
  "sv03-161": 4, // Drampa — the pool's DRAGON body (120 HP, no Weakness): the armed defender
  "fix-fighting-weak": 3, // 200 HP, ×2 Fighting — the Weakness defender for the fold-order pair
  "fix-psychic-energy": 6, // Basic {P} — pays Souvenir, and two of Reckless Charge Together's {C}{C}
  "fix-fighting-energy": 6, // Basic {F} — pays Reckless Charge Together's {F}, and two of Wonder Flash's {C}{C}{C}
  "fix-bigbody": 31, // 200 HP neutral Colorless Basic — DOMINANT pinned starter, the non-Dragon control
});

/** 0.71.0 → 0.72.0: the BOARD-WIDE Energy count (D121) — Absol sv06.5-030
    "Darkfall", "If you have at least 3 {D} Energy in play, this attack does 50
    more damage." One card, one clause, and the whole census: "at least" and
    "Energy in play" are each a hapax in 978 cards.

    A DEDICATED deck, and here the reason is unusually literal: this is the ONLY
    clause in the family whose truth is decided by how much ENERGY is on the
    board, so every other suite's deck would arm or disarm it as a side effect of
    paying its own costs. It is also the first clause a shared deck could arm
    ACCIDENTALLY — nothing has to be fielded, only attached.

    THE DECK IS BUILT TO SEPARATE FOUR THINGS THE SENTENCE COULD MEAN.

      • "IN PLAY", NOT "ATTACHED". The one word between this clause and D118's,
        and the case that proves it is 3 Darkness on the BENCH with ZERO on Absol
        — armed, though the attacker carries nothing. 12 copies of
        fix-darkness-energy, well past the 3 the threshold wants, because a seat's
        opening hand and Prize row hold 13 of its 60 before any surgery and the
        boundary cases need 2, 3 and 4 reachable on either side.
      • A THRESHOLD, NOT AN EXACT COUNT. `>=`, so 4 is armed where D119's
        `opponentPrizesRemaining` would read FALSE above its list. 2 is the
        boundary that fails.
      • CARDS, NOT UNITS. sv02-191 Luminous Energy is the wildcard: one attached
        anywhere on your side counts as a {D} Energy by PROVISION (D118's rule
        folded over the board), and TWO on the same Pokémon demote each other to
        {C} — so the same two cards, nothing moved, stop counting. 4 copies, which
        is what the demotion pair plus the provision case need at once.
      • YOUR SIDE, NOT THE TABLE. Both seats run the whole deck so the same
        Energy can be fielded opposite and assert nothing.

    THE PLAIN {C} LINE IS LOAD-BEARING, not padding. Darkfall's cost is a bare
    {C}, and paying it with a Darkness Energy would put a counted card on the
    attacker in every single case — which is exactly the confound this clause is
    about. fix-energy (Colorless, provides neither Darkness nor ANY) pays the cost
    while counting zero, so "3 on the Bench and NOTHING countable on Absol" is a
    board this deck can actually reach. Both readings get their own case: the
    attacker's own cost Energy is in play too, and when it is Darkness it counts.

    fix-darkness-weak (200 HP, ×2 Darkness, no attacks) is the §8.5 fold-order
    defender: (20 + 50) × 2 = 140 against the control's 20 × 2 = 40. fix-bigbody
    is 31 of 60 — the DOMINANT mulligan-free starter and the Bench body every
    "in play, not attached" surgery hangs its Energy on. */
export const ENERGY_IN_PLAY_DECK = deckOf({
  "sv06.5-030": 4, // Absol — "Darkfall" (20+): yourEnergyInPlayAtLeast Darkness ×3, +50
  "fix-darkness-energy": 12, // Basic {D} — the counted card
  "sv02-191": 4, // Luminous Energy — the wildcard-provision witness + the demotion pair
  "fix-energy": 6, // Basic {C} — pays Darkfall's cost while counting ZERO
  "fix-darkness-weak": 3, // 200 HP, ×2 Darkness — the Weakness defender for the fold-order pair
  "fix-bigbody": 31, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holders
});

/** 0.72.0 → 0.73.0: the POKÉMON TOOL clause (D122) — Greedent sv01-152 "Enhanced
    Fang", "If this Pokémon has a Pokémon Tool attached, this attack does 80 more
    damage." One card, one clause, one printing, no reprint.

    A DEDICATED deck, and the reason is the Tools: every other suite's deck either
    carries no Tool at all or carries Vitality Band for its own damage arithmetic,
    and a Tool line is exactly what arms or disarms this clause as a side effect.

    THE TOOL CHOICE IS THE WHOLE DESIGN OF THIS DECK. `attachTool` refuses an
    UNAUTHORED Tool (`TRAINER_NOT_SIMULATED`), so there is no Tool in the pool
    that attaches successfully while doing nothing — fix-tool cannot be used to
    arm the clause through a real action. Two real Tools are carried instead, and
    they separate the two things that could be confused:

    - **Bravery Charm sv02-173** (`basicHpBonus: 50`) is the SILENT arm. Greedent
      is a STAGE 1, so the +50 HP does not apply to it and the Tool contributes
      exactly nothing to the board except its own presence — the clean case where
      every point of the swing is the clause's.
    - **Vitality Band sv01-197** (`damageBonusBeforeWR: 10`) is the LOUD arm. It
      arms the clause AND adds its own +10 in the SAME pre-W/R step, so the pair
      pins that the two bonuses are independent and stack rather than one masking
      the other: 80 + 80 + 10 = 170 where the Charm gives 160.

    fix-colorless-weak (200 HP, ×2 Colorless, no attacks) is the §8.5 fold-order
    defender: (80 + 80) × 2 = 320 against the control's 80 × 2 = 160 — and the
    Tool sits on the ATTACKER, so the defender has no part in arming what its own
    Weakness then doubles. fix-energy pays Enhanced Fang's three {C}; there is no
    typed Energy line at all, because this clause reads no Energy and a typed one
    would only invite the confusion. fix-bigbody is 35 of 60 — the DOMINANT
    mulligan-free starter (Greedent is a Stage 1 and can never open) and the Bench
    body the "a Tool on your BENCH arms nothing" case hangs its Tool on. */
export const TOOL_CLAUSE_DECK = deckOf({
  "sv01-152": 4, // Greedent — "Enhanced Fang" (80+) at index 1: yourActiveHasToolAttached, +80
  "sv02-173": 6, // Bravery Charm — the SILENT arm (basicHpBonus, inert on a Stage 1)
  "sv01-197": 3, // Vitality Band — the LOUD arm (+10 in the same pre-W/R step)
  "fix-energy": 9, // Basic {C} — pays Enhanced Fang's {C}{C}{C}
  "fix-colorless-weak": 3, // 200 HP, ×2 Colorless — the Weakness defender for the fold-order pair
  "fix-bigbody": 35, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holder
});

/** 0.73.0 → 0.74.0: the SUPPORTER-PLAYED clause (D123) — Pikachu swsh10.5-027
    "Buddy Bolt", "If you played a Supporter card from your hand during this turn,
    this attack does 30 more damage." One card, one clause, one printing, no
    reprint.

    A DEDICATED deck, and the reason is the SUPPORTER. This clause is the first in
    the family that no surgery can honestly arm: `allowances.supporterPlayed` is
    set by `playTrainer` and by nothing else, so the board cases have to play a
    REAL Supporter through a REAL action. Nemona sv01-180 ("Draw 3 cards.") is that
    Supporter — already authored in the registry (an unauthored one would be
    refused with `TRAINER_NOT_SIMULATED`), and deliberately one whose effect
    touches NOTHING the clause or the damage arithmetic reads: it draws, and a hand
    size is invisible to every predicate in this slice. Four copies, because the
    turn-scoping case plays one on each of two different turns and the
    opponent-seat case plays a third.

    The ENERGY LINE is split on purpose. Buddy Bolt costs {L}{C}{C}, so
    fix-lightning-energy pays the typed symbol and fix-energy (the plain Colorless
    Basic) pays the two generic ones — both lines are load-bearing, and neither is
    ever counted by anything, since this clause reads no Energy at all.

    fix-lightning-weak (130 HP, ×2 Lightning) is the §8.5 fold-order defender:
    Pikachu is a {L} attacker, so an armed Buddy Bolt lands (30 + 30) × 2 = 120
    against the un-armed control's 30 × 2 = 60. 130 HP survives BOTH, so the
    Weakness math stands alone with no KO, no prize take and no promotion park in
    the way — which matters more here than usual, because a ko:* park is exactly
    where this member's seat guard changes its answer.

    fix-bigbody is 33 of 60 — the DOMINANT mulligan-free starter both Actives pin
    to (Pikachu is a Basic and COULD open, but pinning it would make every case
    hostage to the deal) and the Bench body left behind when Pikachu is set
    Active. */
export const SUPPORTER_CLAUSE_DECK = deckOf({
  "swsh10.5-027": 4, // Pikachu — "Buddy Bolt" (30+): youPlayedSupporterThisTurn, +30
  "sv01-180": 4, // Nemona (Supporter, "Draw 3 cards.") — the ONLY thing that arms the clause
  "fix-lightning-energy": 6, // Basic {L} — pays Buddy Bolt's typed symbol
  "fix-energy": 6, // Basic {C} — pays Buddy Bolt's two generic symbols
  "fix-lightning-weak": 7, // 130 HP, ×2 Lightning — the Weakness defender for the fold-order pair
  "fix-bigbody": 33, // 200 HP neutral Colorless Basic — DOMINANT pinned starter + the Bench holder
});

/** 0.74.0 → 0.75.0: the PROMOTED clause (D124) — Revavroom ex sv06.5-015
    "Accelerator Flash", "If this Pokémon moved from your Bench to the Active Spot
    this turn, this attack does 120 more damage." Three printings, two cards, one
    clause — and the family's FIRST slice that buys new state
    (`InPlayPokemon.promotedTurn`).

    A DEDICATED deck, and the reason is the ROUTES. This clause is armed by a
    MOVE, and there are three of them — `retreat` (turn.ts), `switchInto`
    (interpreter.ts: Switch, Boss's Orders, Jet Energy) and `resolvePromotion`
    after a Knock Out (flow.ts). No existing deck carries an attacker on the
    clause together with the two Trainers that drive the forced-switch routes on
    BOTH boards, and bolting them onto SUPPORTER_CLAUSE_DECK would reshuffle a
    seed-pinned suite. So: one deck holding the attacker and every road to it.

    Revavroom ex is a STAGE 1 and can therefore never be the dealt starter, so
    every case places it deliberately — by surgery, by a Trainer, or by evolving a
    Varoom. fix-bigbody is 27 of 60: the DOMINANT mulligan-free Basic both setup
    Actives pin to, the body that retreats OUT of the Active Spot to let Revavroom
    in, and the Bench filler a promotion needs a target from.

    THE ENERGY LINES ARE SPLIT THREE WAYS, and the split is the type/cost oddity
    made load-bearing: Revavroom ex is a LIGHTNING Pokémon whose Accelerator Flash
    costs a single {M}, so fix-metal-energy pays THAT attack, fix-water-energy pays
    Golisopod's {W}, and fix-energy (the plain Colorless Basic) pays the RETREAT
    that arms either of them — §11 takes any Energy. No line is ever counted; this
    clause reads no Energy at all.

    fix-lightning-weak-big (320 HP, ×2 Lightning) is the §8.5 fold-order defender:
    (20 + 120) × 2 = 280 against the control's 20 × 2 = 40, and 320 HP survives
    both — which matters more here than anywhere before it, because a KO parks the
    turn on a PROMOTION and would stamp a second `promotedTurn` in the middle of
    the arithmetic the case is measuring.

    Golisopod swsh10.5-026 is here for ONE case and pays for its slots: it is the
    SECOND card on the same clause row at a DIFFERENT amount, so retreating into
    it and reading 20 + 90 = 110 off a real attack proves attack.ts folds the
    amount the DERIVATION captured and not a constant it learned from the +120
    print. It costs a single {W}, which is the whole reason a Water line exists in
    this deck. */
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

/** 0.75.0 → 0.76.0: the REQUIREMENT skeleton (D125) — "If <clause>, this attack
    does nothing." Palafin sv03-062 "Justice Kick" ({W}{W}, 210) on
    `yourActivePromotedThisTurn` and Lycanroc sv03-117 "Finishing Fang" ({F}, 90)
    on `opponentActiveDamaged`. Two cards, two clauses, ZERO new vocabulary: both
    rows reuse a `BoardCondition` member an earlier slice already bought.

    A DEDICATED deck, and the reason is the CANCEL. Every predecessor deck in this
    family is tuned so its clause ADDS a number to a defender chosen to survive it;
    here the clause SUBTRACTS the whole attack, so each case needs a board on which
    the un-armed and armed outcomes differ by 210 or by 90 with nothing else moving.
    PROMOTED_CLAUSE_DECK holds the right STATE (`promotedTurn`) but the wrong cards
    and the wrong Energy types, and growing it would reshuffle a seed-pinned suite.

    fix-lightning-weak-big (320 HP) IS THE LOAD-BEARING SLOT. Justice Kick's 210 is
    the largest number any clause suite has had to land, and fix-bigbody's 200 dies
    to it — which would park the turn on a PROMOTION, i.e. on the very move
    Palafin's own clause reads, in the middle of the arithmetic. Its ×2 Lightning
    Weakness is INERT against both attackers here (Palafin is Water, Lycanroc is
    Fighting), which is exactly what this suite wants: no case in it is about
    Weakness, and the requirement gate sits in front of the whole §8.5 pipeline. It
    also absorbs Lycanroc's 100 + 90 = 190 across two turns without a KO, which is
    what makes the REAL damaged-defender case drivable.

    THE ENERGY LINES ARE SPLIT THREE WAYS. fix-water-energy pays Justice Kick's
    {W}{W}, fix-fighting-energy pays Finishing Fang's {F} and the first symbol of
    Slashing Claw's {F}{C}{C}, and fix-energy (the plain Colorless Basic) pays both
    Slashing Claw's two generic symbols AND the RETREAT that arms Palafin — §11
    takes any Energy, which is why the Colorless line is load-bearing in a deck
    whose attackers cost none. No line is ever counted; neither clause reads Energy.

    Finizen sv03-061 is Palafin's printed pre-evolution and earns its 3 slots on one
    case: retreat into a Finizen (which stamps `promotedTurn`), evolve Palafin on top
    of it, and Justice Kick still lands 210 — the D124 evolution-survival case run
    from the CANCEL side. Rockruff sv03-116 is in the POOL but takes ZERO slots here,
    on D124's Wimpod precedent: nothing needs the Lycanroc line evolved.

    THE TWO TRAINERS ARE THE TWO THINGS A CANCEL CAN GET WRONG, one each:

    - **Switch sv01-194** (Item, `switchActive`) is the second arming ROUTE. The
      printed verb is "move", not "retreat", so a gate that only lifted on a §11
      retreat would be wrong in the same way D124's bonus would have been.
    - **Boss's Orders sv02-172** (Supporter, `gust`) is the SEAT-ASYMMETRY case, and
      it is the ONLY way to reach the board it needs: it promotes a Pokémon on the
      OPPONENT's side DURING YOUR OWN TURN, so `yourActivePromotedThisTurn` is TRUE
      for the seat that is not attacking while the attacker's own Palafin has not
      budged. Without it that board is unreachable — a KO promotion ends the turn in
      the same apply, and a retreat only ever moves your own body.

    Both are authored in the registry (an unauthored Trainer is refused outright
    with TRAINER_NOT_SIMULATED) and both resolve without parking when the target
    Bench holds exactly one body, which is the shape every case here builds.

    fix-bigbody is 23 of 60 — the DOMINANT mulligan-free starter both Actives pin to
    (both attackers are Stage 1 and can never open), the body that retreats OUT of
    the Active Spot to let one in, and the Bench filler a promotion needs a target
    from. */
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

/** 0.76.0 → 0.77.0: the PRINTED COIN FLIP (D126) — one deck for BOTH ends of the
    mechanism, because they ARE one mechanism. Tarountula sv01-018 "Surprise
    Attack" ({G}, 30) carries "Flip a coin. If tails, this attack does nothing.";
    Litwick sv03-036 "Firebreathing" ({R}, 10+) carries "Flip a coin. If heads,
    this attack does 10 more damage." Two cards, two sentences, ZERO new
    vocabulary — the clause is a fixed literal, so there is no table and no board
    fact to field.

    A DEDICATED deck, and for the usual reason plus one new one. The usual: every
    neighbouring deck is seed-pinned and growing one would reshuffle a suite. The
    new one: THIS SUITE SWEEPS SEEDS. Its cases run `for (let seed = 0; seed < 24
    && !(sawHeads && sawTails); seed++)` to reach both faces of a real flip, so the
    deck has to open to a usable board on EVERY seed in that range, from either
    seat — which is what the dominant fix-bigbody line buys, and why nothing here
    depends on a particular opening hand.

    BOTH ATTACKERS ARE BASIC, which is the difference from ATTACK_REQUIREMENT_DECK
    (two Stage 1s, surgically fielded). They still go in by `setActiveFromDeck`
    rather than being dealt, because a swept seed cannot be relied on to deal any
    particular starter — but being Basic means no evolution line is owed and the
    deck stays four lines wide.

    fix-weak (60 HP, ×2 FIRE) IS THE LOAD-BEARING SLOT. Litwick is Fire, so it is
    the body that proves the heads bonus folds PRE-Weakness: (10 + 10) × 2 = 40,
    where an after-W/R fold would read 10 × 2 + 10 = 30. 40 < 60, so the case
    measures damage and never a Knock Out — and the same ×2 Fire is INERT against
    Tarountula (Grass), so the cancel cases never meet it.

    fix-bigbody (200 HP, no Weakness at all) is the NEUTRAL defender both faces are
    measured against — 10/20 from Litwick and 0/30 from Tarountula all land on a
    body that cannot be Knocked Out, cannot double a number, and cannot park the
    turn on a promotion in the middle of a seed sweep. It is also the DOMINANT
    (mulligan-free) starter both Active spots pin over.

    THE TWO ENERGY LINES ARE ONE SYMBOL EACH: fix-grass-energy pays Surprise
    Attack's {G}, fix-fire-energy pays Firebreathing's {R}. Neither attack reads
    Energy, and no case counts it. */
export const COIN_FLIP_DECK = deckOf({
  "sv01-018": 4, // Tarountula — "Surprise Attack" (30) at index 0: cancelOnTails
  "sv03-036": 4, // Litwick — "Firebreathing" (10+) at index 0: bonusOnHeads, per 10
  "fix-grass-energy": 6, // Basic {G} — pays Surprise Attack's single symbol
  "fix-fire-energy": 6, // Basic {R} — pays Firebreathing's single symbol
  "fix-weak": 4, // 60 HP, ×2 FIRE — the pre-Weakness fold defender for Litwick's heads
  "fix-bigbody": 36, // 200 HP neutral Colorless Basic — DOMINANT pinned starter and the neutral defender
});

/** 0.77.0 → 0.78.0: the MULTI-FLIP COUNT FOLD (D127) — "Flip N coins. This attack
    does D damage for each heads." Tandemaus sv01-160 "Double Hit" ({C}{C}, 30×)
    flips TWO; Meowth sv06.5-048 "Fury Swipes" ({C}{C}, 20×) flips THREE. Two cards
    and two different N, which is the whole reason there are two: one printing
    cannot tell a read `flips` from a hardcoded one, and the rngState account
    ("exactly `flips` steps, never more") is only an assertion when two values run
    through the same loop.

    A DEDICATED deck rather than growing COIN_FLIP_DECK, and here the usual reason
    (seed-pinned neighbours reshuffle) is joined by a sharper one: this suite sweeps
    seeds too, but it needs a WIDER sweep than D126's — reaching all three of
    Tandemaus's outcomes and all four of Meowth's takes more seeds than reaching two
    faces of one flip, and folding both suites onto one deck would couple those
    sweeps to each other.

    BOTH ATTACKERS COST {C}{C} — two generic symbols, paid by the one fix-energy
    line. Neither attack reads Energy and no case counts it; two symbols rather than
    one is simply what both cards print.

    fix-colorless-weak-big (200 HP, ×2 COLORLESS) IS THE LOAD-BEARING SLOT and is
    synthetic in a way no printed card is — see its fixture. Both attackers are
    Colorless, so it is the body that proves the "×" base drop happens PRE-Weakness:
    Tandemaus on two heads is (0 + 60) × 2 = 120, where a leaked base reads
    (30 + 60) × 2 = 180. 200 HP survives every outcome of both attackers, so no case
    is ever about a Knock Out.

    fix-bigbody (200 HP, no Weakness) is the NEUTRAL defender the raw totals are
    measured against, and the DOMINANT (mulligan-free) starter both Active spots
    pin over — 40 HP Tandemaus and 70 HP Meowth would otherwise be dealt into
    openings the sweep cannot control. */
export const MULTI_COIN_FLIP_DECK = deckOf({
  "sv01-160": 4, // Tandemaus — "Double Hit" (30×) at index 0: perHeads, flips 2, per 30
  "sv06.5-048": 4, // Meowth — "Fury Swipes" (20×) at index 0: perHeads, flips 3, per 20
  "fix-energy": 8, // Basic {C} — pays both attacks' two generic symbols
  "fix-colorless-weak-big": 4, // 200 HP, ×2 COLORLESS — the pre-Weakness fold defender
  "fix-bigbody": 40, // 200 HP neutral Colorless Basic — DOMINANT pinned starter and the neutral defender
});

/** 0.78.0 → 0.79.0: the BOARD-COUNTED FLIP COUNT (D128) — "Flip a coin for each
    [{X}] Energy attached to this Pokémon. This attack does D damage for each
    heads." Torkoal sv01-035 "Concentrated Fire" ({R}{C}{C}, 80×) counts the TYPED
    `{R}`; Bellossom sv03-003 "Powerful Dance" ({G}, 90×) counts attached CARDS; the
    constructed fix-flip-filter ({C} cost, `{W}` filter, 50×) reaches the zero-count
    branch no printing can.

    A DEDICATED deck, for MULTI_COIN_FLIP_DECK's reason and one more: every case
    here is about WHICH Energy is attached, so the deck has to hold several types at
    once and the suite has to be free to attach any mix of them. Folding that onto
    a deck whose other suite counts nothing would make one suite's attachments the
    other's noise.

    THE ENERGY LINES ARE THE POINT, not the cost payment. fix-fire-energy is both
    Torkoal's `{R}` filter AND part of what pays its cost; fix-water-energy pays the
    two {C} of that same cost WITHOUT being counted by the `{R}` filter — the pair
    is what makes "the cost is met but the count is 1" a board this deck can build,
    and it is the sharpest case in the slice (1 Fire + 2 Water → ONE flip, max 80,
    never the 240 an unfiltered count would give). fix-grass-energy pays Bellossom's
    {G} and joins the mixed pile its untyped count reads.

    sv02-191 (Luminous, the WILDCARD Special) and fix-special (an UNAUTHORED Special,
    Colorless by fallback) are here for `countAttachedEnergy`'s unit cases, which is
    where the two readings DISAGREE: a wildcard counts for every TYPE filter and is
    still exactly ONE card for the untyped reading, and a Special that provides
    nothing typed counts for the untyped reading and for no type at all. That
    disagreement is the whole reason the filter is nullable rather than defaulted.

    fix-pokemon-v-weak (210 HP, ×2 FIRE) IS THE LOAD-BEARING DEFENDER SLOT: Torkoal
    is a Fire attacker, so it is the body that proves the count lands PRE-Weakness —
    one head is 80 × 2 = 160, where an after-W/R fold reads 80. 160 < 210, so the
    case measures damage and never a Knock Out. (It is a "V" by name, which nothing
    in this suite reads.)

    fix-titan (340 HP, no Weakness, no attacks) is the NEUTRAL defender every raw
    total is measured against, and it is 340 rather than fix-bigbody's 200 because
    the totals here are much larger: three Fire on Torkoal is 240 and three mixed
    Energy on Bellossom is 270, both of which would Knock a 200 HP body Out and park
    a swept seed on a promotion. It is also the pinned Active on both sides. */
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

/** 0.79.0 → 0.80.0: the UNBOUNDED FOLD (D129) — "Flip a coin until you get tails.
    This attack does D [more] damage for each heads." Growlithe sv01-030 "Relentless
    Flames" ({R}, 30×) and Chansey sv01-144 "Egg Rolling" ({C}{C}{C}, 60×) are the
    MULTIPLY form (printed base DROPPED); Bouffalant sv03-174 "Damage Rush"
    ({C}{C}, 50+) is the pool's only ADDITIVE one (printed base KEPT).

    A DEDICATED deck, for MULTI_COIN_FLIP_DECK's reason and one sharper one: this is
    the only suite in the family whose FLIP COUNT IS UNBOUNDED, so its sweep cannot
    be reasoned about from a deck shared with a suite that flips a fixed number of
    times. Every seed here draws a different-length sequence, and the outcome
    coverage the cases assert (0, 1 and 2 heads all seen) is measured on THIS deck.

    THREE CARDS BECAUSE THE SLICE HAS TWO MEMBERS AND ONE CAPTURE. Bouffalant against
    either multiply printing is what pins `bonusOnHeads` apart from `perHeads` on the
    same flip count — 50 + 30 × heads against 30 × heads, which differ at EVERY
    outcome including zero heads (50 against nothing at all). Growlithe against
    Chansey is what pins `per` as CAPTURED rather than assumed: 30 ≠ 60 off one
    regex, and their totals share only 0.

    fix-titan (340 HP, no Weakness, no Resistance, no attacks) is the pinned Active on
    BOTH sides, as it is for PER_ENERGY_FLIP_DECK and for the same reason doubled: an
    unbounded sequence has no printed maximum, so the defender is chosen against the
    measured worst case of the sweep rather than against an arithmetic one. 340 HP
    survives 5 heads of Chansey's 60 (300) and 9 heads of Bouffalant's 50 + 30 × n
    (320), well past anything the swept seeds produce — no seed may end on a Knock Out
    and park the turn on a promotion, or the sequence assertions would be truncated.

    THE ENERGY LINES ARE COST PAYMENT AND NOTHING ELSE. No sentence in this slice
    reads the board at all — the flip count is a property of the FACES — so
    fix-fire-energy is there only to pay Relentless Flames' single {R},
    fix-fighting-energy only to pay Chomp Chomp Bite's single {F}, and fix-energy
    only to pay Damage Rush's {C}{C} and Egg Rolling's {C}{C}{C}. That is the whole
    difference from D128's deck, where which Energy was attached WAS the case.

    sv01-117 (Krookodile) IS THE UNMAPPED WITNESS, fielded rather than merely
    derived: "Flip a coin until you get tails. For each heads, discard an Energy from
    your opponent's Active Pokémon." is D129's leading sentence with a consequent
    NEITHER D129 nor D130 built, and it must still reach ATTACK_EFFECT_SKIPPED and
    take NO flip at all. A null out of the deriver says the first half; only a
    declared attack says the second. Its flat printed 50 must still land, which is
    the other half of "loud, not broken".

    IT TOOK THAT JOB FROM GYARADOS swsh10.5-022, which D130 MAPPED (the per-heads
    PROGRAM — "discard the top 2 cards of your opponent's deck" — now expands at the
    flip site). A witness that becomes mapped and is left asserting "stays loud" is a
    failing test; one that is silently deleted is worse. So the case was re-pointed
    rather than removed, and Gyarados left this deck for PER_HEADS_PROGRAM_DECK.
    fix-fighting-energy is here for exactly one reason: Chomp Chomp Bite's {F}.

    THE SWAP PRESERVES EVERY MEASURED SEED IN THE SUITE, deliberately, and that is
    why the counts look arbitrary (3 Krookodile, 4 + 3 + 8 Energy). Setup's rng
    consumption depends on exactly two things: the deck's LENGTH (the shuffle) and
    which INDICES hold a BASIC Pokémon (the mulligan loop). This list is still 60
    cards, and indices 12–29 are still eighteen consecutive non-Basics — they were
    4 Gyarados + 6 {R} + 8 {C}, they are now 3 Krookodile + 4 {R} + 3 {F} + 8 {C}.
    So every seed lands on exactly the rngState it did before, and D129's measured
    first-seed table, its `max heads = 5` pin and its "seed 0 is a first-flip tails"
    all still hold unedited. Re-measuring them would have been correct too; not
    having to is better.

    THE SPLIT ITSELF IS MEASURED, over seeds 0–31 on this deck: after the opening
    hand (7) and the prizes (6), every seed must still leave ≥1 Krookodile, ≥1 {R},
    ≥1 {F} and ≥3 {C} in P1's deck for the `*Active` surgeries to pull. Only two
    splits of the eighteen slots satisfy that — (3, 3, 4, 8) and (3, 4, 3, 8) — and
    {C} = 8 is forced by seeds 20 and 29, which take five of them between hand and
    prizes. This is the second one; the four fix-fire-energy is the slack.

    Rellor sv02-026 and Forretress sv01-139 — the slice's other two multiply printings
    — are in FIXTURE_POOL but NOT in this deck: a board case on either would re-run
    Growlithe's or Chansey's arithmetic on a number the deriver has already captured.
    Same call perEnergyFlip.test.ts makes for Ambipom. */
export const UNTIL_TAILS_FLIP_DECK = deckOf({
  "sv01-030": 4, // Growlithe — "Relentless Flames" (30×) at index 0: perHeads, untilTails, per 30
  "sv01-144": 4, // Chansey — "Egg Rolling" (60×) at index 1: perHeads, untilTails, per 60
  "sv03-174": 4, // Bouffalant — "Damage Rush" (50+) at index 0: bonusOnHeads, untilTails, per 30
  "sv01-117": 3, // Krookodile — "Chomp Chomp Bite" (50): D129's leading sentence, UNMAPPED consequent (LOUD)
  "fix-fire-energy": 4, // Basic {R} — pays Relentless Flames' single symbol
  "fix-fighting-energy": 3, // Basic {F} — pays Chomp Chomp Bite's single symbol, and nothing else
  "fix-energy": 8, // Basic {C} — pays Damage Rush's {C}{C} and Egg Rolling's {C}{C}{C}
  "fix-titan": 30, // 340 HP neutral Basic — the pinned Active on both sides, and no total here KOs it
});

/** 0.80.0 → 0.81.0: the per-heads PROGRAM (D130) — "Flip {N} coins|a coin until you
    get tails. For each heads, discard the top {M} cards of your opponent's deck."
    Wugtrio sv01-057 "Undersea Tunnel" ({C}{C}{C}, 3 flips, top 3) at index 1 and
    Gyarados swsh10.5-022 "Wreak Havoc" ({C}, until tails, top 2) at index 0 — the
    pool's only two mill-per-heads printings, and the whole reason this is a slice:
    ONE consequent reached by TWO different `AttackFlipCount` members.

    A DEDICATED deck, and here the reason is not seed hygiene but the ZONE UNDER
    TEST. Every assertion in the suite is about the OPPONENT's deck and discard
    pile — sizes, deltas, and the exact uids that moved off the top, in order — so
    the deck this slice runs on is the measuring instrument, not the setting. A
    shared deck would make "the discard grew by exactly heads × M" a claim entangled
    with whatever else the sharing suite discards.

    BOTH SEATS RUN IT, for the ordinary reason (either attacker can be fielded on
    either side by surgery) and one specific to a mill: the milled deck is the
    DEFENDER's, so the deck has to be well-stocked on the side that is NOT attacking.

    fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) is the pinned Active
    on both sides. Neither printing here deals any damage at all — neither carries a
    `damage` field — so the defender is not chosen against an arithmetic worst case
    the way D129's was; it is chosen so that nothing else happens. No KO can park a
    swept seed on a promotion, and no defender attack can interleave rows with the
    ones being counted.

    THE DECK IS DEEP ON PURPOSE, and 40 fix-titan is what makes it so (§3.1 fixes
    the total at 60). Gyarados's sequence is UNBOUNDED, so the mill it drives has no printed
    maximum: 2 cards per heads off a deck that has already lost 7 to the opening
    hand and 6 to the prizes. The sweep's worst case is what the depth is set
    against, and the clamp case reaches the shallow end DELIBERATELY, through
    `trimDeckTo` surgery rather than by hoping a seed gets there.

    fix-energy is the only Energy line: {C}{C}{C} for Undersea Tunnel, {C} for Wreak
    Havoc, and {W} for Wugtrio's index-0 "Headbutt" control is NOT paid — that
    control is declared on the same board and simply costs a Water this deck does
    not hold, so it is exercised at the deriver level instead. (Headbutt is fielded
    via fix-water-energy, which is here for that one attach.) */
export const PER_HEADS_PROGRAM_DECK = deckOf({
  "sv01-057": 4, // Wugtrio — "Undersea Tunnel" at index 1: programPerHeads, printed 3, mill 3
  "swsh10.5-022": 4, // Gyarados — "Wreak Havoc" at index 0: programPerHeads, untilTails, mill 2
  "fix-energy": 8, // Basic {C} — pays Undersea Tunnel's {C}{C}{C} and Wreak Havoc's {C}
  "fix-water-energy": 4, // Basic {W} — pays Wugtrio's index-0 "Headbutt" control, and nothing else
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

/** 0.81.0 → 0.82.0: the UNCONDITIONAL MILL, both directions (D131) — "Discard the
    top [{N} cards|card] of your [opponent's] deck." A DEDICATED deck rather than a
    reuse of PER_HEADS_PROGRAM_DECK above, for the ordinary reason (that one is
    seed-pinned to a measured sweep, and adding a line would reshuffle every case in
    it) and one specific to this slice: the sentences here take NO coin, so the suite
    needs no seed sweep at all and can be pinned on a single board.

    THE TWO CARDS ARE THE TWO DIRECTIONS, and the second is the widening's own proof:
      • Skwovet sv03-178 "Nicked Nibble" (idx 0, {C}, NO damage) — the OPPONENT
        reading, and the SINGULAR branch ("the top card", count 1 with nothing
        captured). Its idx-1 "Gentle Slap" (also {C}, 10, no effect) is the control.
      • Gyarados swsh10.5-022 "Wild Splash" (idx 1, {W}{W}{C}{C}, 230) — the OWN-deck
        reading, on the very card whose idx-0 "Wreak Havoc" mills the OPPONENT behind
        D130's coin. One card, one action, both directions, and it also carries the
        only PRINTED DAMAGE in the suite: 230 lands BEFORE the mill (D125's tail
        placement), which is what the ordering cases assert.

    BOTH SEATS RUN IT — either attacker can be surgeried onto either side, and a mill
    needs the deck stocked on whichever side is losing cards, which for the self-mill
    is the ATTACKER's own.

    fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) is the pinned Active on
    both sides, so nothing else happens: Wild Splash's 230 cannot KO it (no promotion
    park to truncate a row sequence) and no defender attack can interleave rows.

    THE DECK IS DEEP ON PURPOSE — 38 fix-titan against a 60-card total (§3.1). Wild
    Splash mills 5 of the ATTACKER's own deck per declaration off a deck that has
    already lost 7 to the opening hand and 6 to the prizes, and the deck-out cases
    reach the shallow end DELIBERATELY through `trimDeckTo` surgery rather than by
    hoping a board gets there.

    fix-water-energy is here for Wild Splash's {W}{W} and nothing else; fix-energy
    ({C}) pays its {C}{C} and both of Skwovet's single-{C} attacks. */
export const DECK_TOP_MILL_DECK = deckOf({
  "sv03-178": 4, // Skwovet — "Nicked Nibble" at idx 0: discardDeckTop, opponent, count 1 (singular)
  "swsh10.5-022": 4, // Gyarados — "Wild Splash" at idx 1: discardDeckTop, self, count 5, after 230 damage
  "fix-energy": 8, // Basic {C} — Skwovet's two attacks, and Wild Splash's {C}{C}
  "fix-water-energy": 6, // Basic {W} — Wild Splash's {W}{W}, and nothing else
  "fix-titan": 38, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

/** 0.82.0 → 0.83.0: the BARE SELF-HEAL (D132) — "Heal {N} damage from this
    Pokémon." A DEDICATED deck for the usual reason (every neighbouring deck is tuned
    to its own slice, and adding a line to one reshuffles every case in it) and one
    specific to this slice: nothing here takes a COIN, so the suite needs no seed
    sweep at all and the whole account fits on a single deterministic board.

    THE TWO CARDS ARE THE TWO HALVES OF THE CENSUS — twelve of the eighteen printings
    carry printed damage and six do not, and the pair covers both, on two different N:
      • Ceruledge sv02-098 "Life Sucker" (idx 0, {C}{C}, heal 30 AND a flat 50) — the
        WITH-DAMAGE half. It is where D125's tail placement is asserted (the 50 lands
        through the §8.5 pipeline, the heal runs after it) and where a `target` read
        the wrong way round would show up: it would heal the Pokémon it just hit.
        Ceruledge is a STAGE 1 (evolveFrom Charcadet), so it is NEVER played — it
        reaches the Active Spot only by `setActiveFromDeck` surgery, which does not
        care about the evolution line. Its idx-1 "Fighting Sword" ({P}{C}{C}) is
        unpayable out of this deck and belongs to clauseTable.test.ts anyway.
      • Natu swsh10.5-032 "Nap" (idx 0, {C}, heal 20, NO `damage` field) — the
        NO-DAMAGE half, and a second clause of the four. A Basic, so it needs no
        surgery in principle; it is still fielded by `setActiveFromDeck` so that the
        board is the same shape for both attackers. Its idx-1 "Peck" ({P}{C}, 20) is
        the effect-less control, exercised at the deriver level (no {P} in this deck).

    BOTH SEATS RUN IT — either attacker can be surgeried onto either side, which is
    what lets the `seat` on the HEALED row be asserted rather than assumed.

    fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) is the pinned Active on
    both sides: Life Sucker's 50 cannot come close to KOing it, so no promotion can
    park mid-batch and truncate a row sequence, and no defender attack can interleave
    rows with the ones being counted. The board under test is not the defender — it is
    the ATTACKER's own damage, which arrives by `setDamage` surgery rather than by
    scripting the attacks that would place it.

    fix-energy is the only Energy line, and 12 is generous on purpose: Life Sucker's
    {C}{C} and Nap's {C} are the whole demand, but a heal case declares the same
    attack from a freshly-built board several times over and an Energy-starved deck
    would fail as an attach error rather than as an assertion. */
export const SELF_HEAL_DECK = deckOf({
  "sv02-098": 4, // Ceruledge — "Life Sucker" at idx 0: heal 30, AFTER a printed 50
  "swsh10.5-032": 4, // Natu — "Nap" at idx 0: heal 20, NO printed damage at all
  "fix-energy": 12, // Basic {C} — pays Life Sucker's {C}{C} and Nap's {C}
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides
});

/** 0.83.0 → 0.84.0: the OWN-BOARD HEAL (D133) — "Heal {N} damage from each of your
    Pokémon." A DEDICATED deck rather than two lines added to SELF_HEAL_DECK, and the
    reason is specific rather than habitual: this suite is the first to need a
    populated BENCH on the attacking side (that is the whole claim — "each of your
    Pokémon" is the Active AND the Bench), so its boards are a different shape from
    the bare-heal boards and sharing a deck would reshuffle every case in that file
    for nothing. Nothing here takes a COIN either, so the suite needs no seed sweep.

    THE TWO CARDS ARE THE TWO CLAUSES AND THE TWO HALVES OF THE CENSUS — four of the
    seven printings carry printed damage and three do not:
      • Skeledirge ex sv02-037 "Vitality Song" (idx 0, {R}, heal 30 across the board
        AND a flat 50) — the WITH-DAMAGE half, and 4 of the 7 printings on its own
        (-037/-233/-258/-272 are one attack in four rarities). A STAGE 2 from
        Crocalor, so it reaches the Active Spot only by `setActiveFromDeck` surgery.
        Its idx-1 "Burning Voice" ({R}{R}) is another family's clause and unpayable.
      • Cresselia sv06.5-021 "Healing Pirouette" (idx 0, {P}, heal 20, NO `damage`
        field) — the NO-DAMAGE half and the OTHER clause, on a different N so that a
        hardcoded 30 downstream cannot satisfy both. A Basic; still fielded by
        surgery so both attackers' boards are the same shape. Its idx-1 "Crescent
        Purge" ({P}{P}{P}) is the effect-less-control's opposite — real unmapped text
        that no {P}{P}{P} in this deck can pay for.

    TWO TYPED ENERGY LINES, not one Colorless line, because both attacks print a
    TYPED single cost ({R} and {P} respectively) and Colorless cannot pay either.
    Six each is generous on purpose: a case declares the same attack from a freshly
    built board several times over, and an Energy-starved deck would fail as an
    attach error rather than as an assertion.

    BOTH SEATS RUN IT — either attacker can be surgeried onto either side, which is
    what lets the `seat` on every HEALED row be asserted rather than assumed.

    fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) does DOUBLE DUTY here
    and both jobs matter. It is the pinned Active on both sides (Vitality Song's 50
    cannot come near KOing it, so no promotion parks mid-batch and truncates a row
    sequence, and no defender attack interleaves rows with the ones being counted),
    AND it is every BENCHED body the heal has to reach — a 340 HP bench body can
    carry any damage figure a case wants without the attack epilogue's KO sweep
    removing it from under the assertion mid-count. Its damage arrives by
    `setBenchDamage` surgery rather than by scripting the attacks that would place
    it. 40 copies keeps it the DOMINANT (mulligan-free) Basic through setup. */
export const BOARD_HEAL_DECK = deckOf({
  "sv02-037": 4, // Skeledirge ex — "Vitality Song" at idx 0: heal 30 each, AFTER a printed 50
  "sv06.5-021": 4, // Cresselia — "Healing Pirouette" at idx 0: heal 20 each, NO printed damage
  "fix-fire-energy": 6, // Basic {R} — pays Vitality Song's single Fire, and nothing else
  "fix-psychic-energy": 6, // Basic {P} — pays Healing Pirouette's single Psychic, and nothing else
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active BOTH sides + every bench body
});

/** 0.84.0 → 0.85.0: the FLIP-GATED OP family (D134) — "Flip a coin. If heads,
    <action>." A DEDICATED deck, and here the reason is mechanical rather than
    stylistic: this is the first heal/mill suite that takes a COIN, so every case
    runs a SEED SWEEP and both faces must be reachable from one board. Sharing
    SELF_HEAL_DECK or DECK_TOP_MILL_DECK would have made those files' seed-free
    determinism a coincidence rather than a property.

    THE TWO CARDS ARE THE TWO CLAUSES, and they were chosen for how little they
    share — the whole argument of the slice is that the family is two LITERAL arms
    rather than one template with a substitutable consequent:
      • Fuecoco sv02-035 "Spacing Out" (idx 0, {C}, gated heal 30) — 2 of the 3
        printings, and the half whose effect is on the ATTACKER's own board. Its
        idx-1 "Flare" ({R}{C}, 30) is the effect-less control.
      • Wiglett sv01-056 "Dig a Little" (idx 0, {C}, gated mill 1 off the OPPONENT's
        deck) — the third printing, and the half whose effect is in a hidden zone on
        the other side of the table. Its idx-1 "Ram" ({C}{C}, 20) is the second
        control, payable out of the same Colorless line.

    NEITHER GATED ATTACK PRINTS `damage`, which is what makes the tails cases sharp:
    on tails the whole declaration must move NOTHING anywhere, and there is no
    printed number for a half-simulation to hide behind. The two CONTROLS do print
    damage (30 and 20), so the file can also assert that an effect-less attack on the
    same card takes no coin at all.

    BOTH ARE BASICS — no evolution surgery anywhere in the suite — so a board is a
    setup plus at most a `setActiveFromDeck`, and the seed sweep varies only the coin.

    fix-energy ({C}) is the workhorse: it pays both gated attacks' single {C} and
    Ram's {C}{C}. fix-fire-energy is here for Flare's {R} and nothing else.
    fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) is the pinned Active
    on the DEFENDING side: neither control's 30 comes near KOing it, so no promotion
    parks mid-flight and no defender attack interleaves rows. 38 copies keeps it the
    DOMINANT (mulligan-free) Basic through setup AND leaves the opponent's deck deep
    enough that a gated mill has something to take on every seed. */
export const FLIP_GATED_OP_DECK = deckOf({
  "sv02-035": 4, // Fuecoco — "Spacing Out" at idx 0: gated heal 30; "Flare" at idx 1: {R}{C} for 30
  "sv01-056": 4, // Wiglett — "Dig a Little" at idx 0: gated mill 1; "Ram" at idx 1: {C}{C} for 20
  "fix-energy": 10, // Basic {C} — pays both gated attacks' {C} and Ram's {C}{C}
  "fix-fire-energy": 4, // Basic {R} — pays Flare's Fire, and nothing else
  "fix-titan": 38, // 340 HP neutral Basic, NO attacks — the pinned Active both sides, and the mill's fodder
});

/** 0.85.0 → 0.86.0: the CHOSEN HEAL (D135) — "Heal {N|all} damage from 1 of your
    [Benched] Pokémon." A DEDICATED deck, on the house rule that a new family gets
    its own 60, and with two reasons of its own. First, this is the first HEAL suite
    whose claim is about a PROMPT rather than about a board: every case reads
    `prompt.candidates`, so the exact contents of the Bench are load-bearing in a way
    they are not even in BOARD_HEAL_DECK's file, and a shared deck would make a
    candidate list something another suite could reshuffle. Second, nothing here
    takes a COIN, so the whole account fits on one deterministic seed-free board —
    a property worth keeping separable from FLIP_GATED_OP_DECK's sweeps.

    THE THREE CARDS ARE THE THREE READINGS the one regex produces:
      • Nacli sv02-121 "Salt Coating" (idx 0, {F}, heal 20, NO `damage`) — the
        ANY-ZONE arm, where the candidate set is the Active AND the Bench and the
        ATTACKER ITSELF is a legal pick. 2 of the 5 any-zone printings (-121/-220).
        Its idx-1 "Tackle" ({F}{F}, 30) is the effect-less control.
      • Tropius sv01-007 "Fresh-Picked Fruit" (idx 0, {G}, heal 60, NO `damage`) —
        the BENCH-ONLY arm, on a DIFFERENT N so a hardcoded 20 downstream cannot
        satisfy both. Its idx-1 "Razor Leaf" ({G}{C}, 50) is the second control.
      • fix-allheal (idx 0, {C}) — the "all" amount, carrying Blissey/Arboliva's
        REAL printed sentence on an INVENTED Basic body, purely so the amount can
        be driven end to end without an evolution chain. See its FIXTURE_POOL doc.

    THREE ENERGY LINES, because all three attacks print a different single cost
    ({F}, {G}, {C}) and none of them can pay another's. Five/five/four is generous:
    a case declares the same attack from a freshly built board a dozen times over,
    and an Energy-starved deck would fail as an attach error rather than as an
    assertion. The {C} line doubles as Razor Leaf's second symbol.

    BOTH SEATS RUN IT — any of the three can be surgeried onto either side, which
    is what lets the `seat` on every HEALED row be asserted rather than assumed.

    fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) does the same double
    duty it does in BOARD_HEAL_DECK and both jobs matter more here. It is the pinned
    Active on the DEFENDING side (neither heal attack prints damage at all, so
    nothing can KO it and no promotion can park mid-flight to compete with the heal's
    own park), AND it is every BENCHED body the prompt offers — 340 HP carries any
    damage figure a case wants, including the 300 the "all" case needs, without the
    epilogue's KO sweep removing a candidate from under the assertion. 34 copies
    keeps it the DOMINANT (mulligan-free) Basic through setup. */
export const CHOSEN_HEAL_DECK = deckOf({
  "sv02-121": 4, // Nacli — "Salt Coating" at idx 0: heal 20, ANY zone; "Tackle" at idx 1: {F}{F} for 30
  "sv01-007": 4, // Tropius — "Fresh-Picked Fruit" at idx 0: heal 60, BENCH only; "Razor Leaf" at idx 1
  "fix-allheal": 4, // FIXTURE — Blissey/Arboliva's real "all" sentence on an invented Basic body
  "fix-fighting-energy": 5, // Basic {F} — pays Salt Coating's single Fighting (and Tackle's two)
  "fix-grass-energy": 5, // Basic {G} — pays Fresh-Picked Fruit's single Grass (and Razor Leaf's first)
  "fix-energy": 4, // Basic {C} — pays fix-allheal's {C}{C} line and Razor Leaf's second symbol
  "fix-titan": 34, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + every candidate body
});

/** 0.86.0 → 0.87.0: the COUNTER MOVE (D138) — "Move all damage counters from 1 of
    your Benched Pokémon to your opponent's Active Pokémon." A DEDICATED deck, on
    the house rule that a new family gets its own 60, and because this one's boards
    are unlike every heal suite's in the way that matters: the claim spans BOTH
    seats at once. Every case reads a bench body's damage, a prompt's candidates
    AND the opponent's Active, so a shared deck would let another suite reshuffle
    one end of an equality.

    ONE CARD PRINTS THE SENTENCE, and both of its attacks are in play here:
      • Dedenne ex sv02-093 "Tail Swap" (idx 0, {P}{P}, NO `damage`) — the whole
        slice. Its candidate set is the BENCH ONLY, so a lone-Active board is the
        silent whiff and every other board parks or forces.
      • "Wondrous Shot" (idx 1, {P}{P}{P}, 170) — the control, and a sharper one
        than an effect-less second attack: its "Discard an Energy from this
        Pokémon." is read by a DIFFERENT arm of the same deriver, so the two
        indices of one card must produce two different ops.
    EIGHT {P} — Tail Swap needs two attached and Wondrous Shot three, and a case
    rebuilds a board a dozen times over; an Energy-starved deck fails as an attach
    error rather than as an assertion.

    TWO DEFENDING BODIES, and the second is the point:
      • fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) is the pinned
        Active on both sides and every BENCHED body the prompt offers — 340 HP
        carries any damage figure a case wants without the epilogue's KO sweep
        removing a candidate from under the assertion, and it is the DOMINANT
        (mulligan-free) Basic through setup.
      • fix-psychic-weak-big (200 HP, ×2 Psychic, no attacks) is surgeried in as
        the DEFENDER for exactly one claim — that a MOVED counter skips §8.5 —
        against a Psychic attacker whose pile would otherwise double.
    BOTH SEATS RUN IT, so the `seat` on every HEALED and COUNTERS_PLACED row is
    asserted rather than assumed. */
export const COUNTER_MOVE_DECK = deckOf({
  "sv02-093": 4, // Dedenne ex — "Tail Swap" at idx 0 (the move, no damage); "Wondrous Shot" at idx 1 ({P}×3, 170)
  "fix-psychic-energy": 8, // Basic {P} — two pay Tail Swap, three pay Wondrous Shot
  "fix-psychic-weak-big": 4, // 200 HP ×2 Psychic, NO attacks — the flat-placement defender
  "fix-titan": 44, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + every bench candidate
});

/** 0.87.0 → 0.88.0: the PUT on the defender (D139) — "Put {N} damage counters on
    your opponent's Active Pokémon." A DEDICATED deck on the house rule that a new
    reader gets its own 60, and because this one's boards are unlike the counter
    MOVE's in the way that matters: nothing here parks, nothing here reads the
    controller's own Bench, and the whole claim is the DEFENDER's damage — so the
    two suites want opposite boards and neither should reshuffle the other.

    BOTH PRINTINGS ARE IN IT, at two different counts, which is what makes the
    × 10 conversion checkable rather than assertable:
      • Mimikyu sv02-097 "Ghost Eye" (idx 0, {P}{C}, 7 counters, NO `damage`) —
        a BASIC, so it is the attacker for every end-to-end board. It also carries
        a REGISTRY row (the Safeguard passive, D107) with no `attack` key, which
        is a sharper zero-row witness than a card with no row at all.
      • Polteageist sv03-098 "Pour Tea" (idx 1, {P}, 5 counters, NO `damage`) —
        a STAGE 1, surgeried in, and the proof that 7 → 70 is a conversion rather
        than a constant. Its idx 0 "Antique Collecting" opens with the SAME WORD
        and must stay LOUD.
    Two counts on two cards from two sets: a build that hardcoded either number,
    or that forgot the × 10 on one arm, cannot pass both.

    SIX {P} — Ghost Eye needs two attached (its {C} takes the second Psychic) and
    Pour Tea one, and a case rebuilds the board a dozen times over.

    THREE DEFENDING BODIES, and the last two exist for one claim each:
      • fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) is the pinned
        Active on both sides — 340 carries 70 twice over without the epilogue
        sweeping a body out from under an assertion, and it is the DOMINANT
        (mulligan-free) Basic through setup.
      • fix-psychic-weak-big (200 HP, ×2 Psychic) and fix-psychic-resist-big
        (200 HP, Psychic −30) are the TWO SIDES of the flat-placement claim under
        a Psychic attacker: a §8.5-routed build reads 140 on one and 40 on the
        other, and 70 on neither.
    BOTH SEATS RUN IT, so the `seat` on every COUNTERS_PLACED row is asserted
    rather than assumed. */
export const COUNTER_PUT_DECK = deckOf({
  "sv02-097": 4, // Mimikyu — "Ghost Eye" at idx 0 ({P}{C}, 7 counters, no damage); Safeguard is a REGISTRY passive
  "sv03-098": 4, // Polteageist — "Antique Collecting" at idx 0 (loud), "Pour Tea" at idx 1 ({P}, 5 counters)
  "fix-psychic-energy": 6, // Basic {P} — two pay Ghost Eye ({P}{C}), one pays Pour Tea
  "fix-psychic-weak-big": 3, // 200 HP ×2 Psychic, NO attacks — the flat-placement defender, high side
  "fix-psychic-resist-big": 3, // 200 HP Psychic −30, NO attacks — the flat-placement defender, low side
  "fix-titan": 40, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + the promote target
});

/** 0.88.0 → 0.89.0: the PUT on the opponent's BENCH (D140) — "Put {N} damage
    counters on 1 of your opponent's Benched Pokémon." A DEDICATED deck on the
    house rule that a new reader gets its own 60, and because this one's boards are
    the OPPOSITE of COUNTER_PUT_DECK's in every way that matters: this sentence
    PARKS, it reads the OPPONENT's Bench, and its attack carries a printed 150 —
    so every board here needs a populated enemy Bench AND an Active that survives
    a real §8.5 hit, which the D139 deck was built never to have.

    ONE ATTACKER, FOUR PRINTINGS OF IT, AND IT IS AN **ex** — which is not a
    detail. Ting-Lu ex sv02-127 "Land Scoop" (idx 0, {F}{F}{F}, printed **150**,
    2 counters) is the only card in the pool that prints this sentence, and its ex
    rule box is what makes Mimikyu's Safeguard a live prevention on the bench body
    below. Its own "Cursed Land" passive is live throughout (it attacks from the
    Active Spot), which is why the two Ability-carrying bench bodies are left
    UNDAMAGED in the cases that read their passives: a damaged non-ex opponent
    loses its Ability to the aura, and the assertion would then pass for the wrong
    reason.

    FOUR BENCHED BODIES, and three of them exist for exactly one claim each:
      • fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) is the pinned
        Active on BOTH sides — 340 absorbs the printed 150 without the epilogue
        sweeping the defender out from under a bench assertion — and it is the
        DOMINANT (mulligan-free) Basic through setup as well as the ordinary bench
        candidate the park offers.
      • fix-fighting-weak (200 HP, ×2 Fighting, inert) — the §8.5 claim: a FIGHTING
        attacker must place 20 on it, not 40. A build that routed the placement
        through `snipeActive` doubles it.
      • sv03-174 Bouffalant ("Bouffer", −20 after W/R) — the REDUCTION claim, and
        the sharper one, because §8.5 already flattens Weakness on the Bench for
        both readings while the reduction passive separates them: the placement
        puts 20 on it, a `deals: true` build puts **0**.
      • sv02-097 Mimikyu ("Safeguard", prevent all damage from an opponent's ex/V)
        — the PREVENTION claim, and the sharpest assertion in the slice: the
        attacker IS an ex, so a `deals: true` build prevents the hit entirely and
        emits a DAMAGE_DEALT carrying `prevented: true`, where the placement is
        untouched by it. D139 could not buy this claim at all; it is available here
        only because this sentence's attacker has a rule box.
    TWELVE {F} — Land Scoop needs three attached and a case rebuilds the board a
    dozen times over. BOTH SEATS RUN IT, so the `seat` on every COUNTERS_PLACED row
    is asserted rather than assumed. */
export const COUNTER_BENCH_PUT_DECK = deckOf({
  "sv02-127": 4, // Ting-Lu ex — "Land Scoop" at idx 0 ({F}{F}{F}, 150 damage + 2 counters); Cursed Land is a REGISTRY passive
  "fix-fighting-energy": 12, // Basic {F} — three pay each Land Scoop
  "sv03-174": 3, // Bouffalant — "Bouffer" (−20 after W/R): the reduction a placement must SKIP
  "sv02-097": 3, // Mimikyu — "Safeguard": the ex-prevention a placement must SKIP
  "fix-fighting-weak": 3, // 200 HP ×2 Fighting, inert — the Weakness a placement must SKIP
  "fix-titan": 35, // 340 HP neutral Basic, NO attacks — the pinned Active both sides + the plain bench candidate
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

/** 0.90.0 → 0.91.0: the GATED PREVENT clause (D142) — "Flip a coin. If heads,
    during your opponent's next turn, prevent all damage [from and effects of]
    attacks done to this Pokémon." A DEDICATED deck, and every card on it exists
    to make ONE claim about the block:

      • sv03-004 Scyther "Agility" ({C}, printed 10) installs the WIDE block, the
        11-printing spelling — and prints damage alongside it, so the D125 tail
        board is exercised by the installer itself;
      • sv03-151 Togedemaru "Defense Curl" ({C}, no printed damage) installs the
        NARROW one, the 2-printing spelling. The pair is the whole reason
        `preventDamage` has a field, and every "the narrow block does NOT stop
        this" assertion is a Togedemaru board;
      • sv02-072 Pincurchin "Needle Crush" ({L}{L}{L}, 70) is the sharpest single
        attack in the suite: it deals real damage AND discards an Energy from the
        defender, so ONE declaration into a wide block shows both halves refused
        and into a narrow one shows them SPLIT — 0 damage, Energy gone;
      • sv02-016 Tarountula "Bind Down" ({G}, 10) is the rider-on-the-defender
        case, and the sharpest instance of the mirror: two durated blocks meeting,
        one refusing the other;
      • sv02-097 Mimikyu "Ghost Eye" ({P}{C}, 7 counters, no `damage` field) is
        the COUNTER PUT — an effect rather than damage, so it is the case that
        separates the two spellings with nothing else moving. Its own Safeguard
        passive is on the ATTACKER here, where it is inert;
      • fix-attacker supplies the plain hits: Bite ({C}, 30) for damage with no
        effect, and Yawn (NO printed cost — free to declare on any board) for a
        §12 status with no damage;
      • fix-titan (340 HP, no attacks, no Weakness) is the DOMINANT mulligan-free
        Basic, the bench filler and the promote target — big enough that no case
        in the suite ends with a body swept out from under its assertions.

    THIS FAMILY TAKES A COIN, so the deck is its own 60 rather than shared with a
    seed-free suite: every install is `coinFlipGate`d, and the boards below are
    reached by sweeping seeds until the install lands heads. Sharing a deck with a
    seed-free suite would make that suite's determinism a coincidence. */
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

/** D143's SELF-LOCK deck (`attackLock.test.ts`). Its own 60, and for the OPPOSITE
    reason to PREVENT_BLOCK_DECK's: that family takes a coin and needed a seed
    sweep, while this one takes NONE — neither printed sentence flips anything —
    so the suite is seed-free and pins that fact by an unchanged `rngState` across
    a whole park-and-resolve. Sharing a deck would let one suite's shuffle decide
    the other's determinism either way.

      • sv01-048 Alomomola — the BARE sentence at 20 printings. "Aqua Slash"
        ({W}{W}{C}, printed 120 + the lock) at INDEX 1, "Surf" ({W}{C}, 30, no
        effect) at index 0. The index-0 control is doing two jobs: no program
        leaks across indices, AND a locked Alomomola is refused SURF — which is
        the assertion that separates this family from the eight "can't use
        {AttackName}" printings that stay LOUD;
      • sv03-029 Ninetales — the COMPOUND printing at 2. "Nine-Tailed Dance"
        ({R}{R}, INDEX 1, 9 counters, NO printed damage) is the whole reason the
        counter PUT and the lock are one anchor, and it is a Stage 1 fielded by
        surgery. "Will-O-Wisp" ({R}, 20) at index 0 is its control;
      • fix-mola-stage1 evolves from Alomomola and exists for the §10 EVOLVE
        clear, which here is a LINE OF PLAY rather than a surgery;
      • sv01-194 Switch (Item) is the other half of the reachable §10 clear:
        retreat the locked body out, Switch it back in, attack with it;
      • sv02-172 Boss's Orders is the OPPONENT's route to the same clear — the
        one place a durated effect ends because the player it hurts did something;
      • fix-attacker's costless "Yawn" is the §12 control the lock must not be
        confused with (an Asleep Active is refused by a DIFFERENT code), and Bite
        is the plain hit that Knocks a locked body out;
      • fix-titan (340 HP, no attacks) is the mulligan-free bench filler, the
        promote target after a KO and the body that proves a lock does not travel
        to whatever replaces its holder. */
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

/** D144's TAILS-GATE deck (`tailsGatedOp.test.ts`). Its own 60, and for
    PREVENT_BLOCK_DECK's reason rather than ATTACK_LOCK_DECK's: **this family takes
    a real coin**, so every end-to-end board is reached by a seed that lands the
    face the case is about. Sharing a deck with the seed-free `ATTACK_LOCK_DECK`
    would make that suite's determinism a coincidence of this one's shuffle, which
    is the exact hazard D143 wrote its unchanged-`rngState` case to pin.

      • sv01-157 Oinkologne — the gated sentence at INDEX 1 ({C}{C}{C}, printed
        130), with "Ram" ({C}{C}, 50, no effect) at index 0 as the control AND as
        the sibling attack a locked body is refused;
      • sv02-130 Paldean Clodsire ex — the same sentence at INDEX **0**
        ({D}{C}{C}, printed 200), its card's only attack. The two fixtures are the
        family's two indices, which is the fact no remainder list mentioned;
      • sv01-048 Alomomola carries D143's BARE sentence and is here purely as the
        cross-family control: the two anchors must derive DIFFERENT programs off
        the same rider, and a locked-by-tails body must be refused exactly as a
        locked-by-nothing one is;
      • fix-mola-stage1 evolves from Alomomola — the §10 evolve clear, reused;
      • sv01-194 Switch and sv02-172 Boss's Orders are the other two §10 routes;
      • fix-attacker supplies Bite ({C}, 30) for the plain hit that KOs a locked
        body and the costless Yawn for the §12 control;
      • fix-titan (340 HP, NO attacks) is the mulligan-free bench filler and the
        body every install is declared into, so no case ends with an assertion
        about a Pokémon the epilogue swept off the board. */
export const TAILS_GATE_DECK = deckOf({
  "sv01-157": 4, // Oinkologne — "Ram" idx 0 (control + refused sibling), "Leg Stomp" idx 1
  "sv02-130": 4, // Paldean Clodsire ex — "Needle Bone" idx 0, the family's OTHER index
  "sv01-048": 4, // Alomomola — D143's BARE sentence, the cross-family control
  "fix-mola-stage1": 2, // evolves from Alomomola — the §10 clear as a played line
  "sv01-194": 3, // Switch (Item) — retreat out, switch back, attack: the lock is GONE
  "sv02-172": 2, // Boss's Orders — the opponent dragging a locked body off the spot
  "fix-attacker": 3, // Bite ({C}, 30) and Yawn (costless, Asleep) — the §12 control
  "fix-dark-energy": 6, // {D} — Needle Bone's typed third; the rest is Colorless
  "fix-water-energy": 8, // {W}{W} — Aqua Slash and Bubble
  "fix-energy": 19, // Colorless Basic — pays every {C}, and Leg Stomp wants three
  "fix-titan": 5, // 340 HP neutral Basic, NO attacks — bench filler and promote target
});

/** D145's TAILS-SELF-COST deck (`tailsSelfCost.test.ts`). Its own 60, for
    `TAILS_GATE_DECK`'s reason and for one more: **this family takes a real coin**,
    so every end-to-end board is reached by a seed that lands the face the case is
    about — and D144's seed table is pinned SEED BY SEED against its own shuffle,
    so adding a card to that deck would move every one of its 40 pins. Two coin
    families, two decks, two tables, neither able to make the other's determinism
    a coincidence.

      • sv02-063 Pikachu ex — "Dynamic Bolt" at INDEX 1 ({L}{L}{C}, printed 220),
        with "Pika Punch" ({C}, 30, no effect) at index 0 as the control and as
        the attack a stripped body can still afford;
      • sv03-054 Beartic — the SAME sentence at INDEX 1 ({W}{W}{C}, printed 170),
        a different set and a different Energy line, which is what makes the
        two-printing warrant a fact of the fixtures;
      • sv03-183 Oinkologne — "High-Impact Kick" at INDEX 1 ({C}{C}{C}, printed
        160), the recoil sentence's only printing, with "Confounding Cologne" at
        index 0 (a DIFFERENT deriver arm, so the two indices must not collide);
      • sv02-097 Mimikyu carries the Safeguard passive from the REGISTRY, and is
        here for exactly one claim: Pikachu ex is an `ex`, so its main hit is
        NULLED (§8.5) while the effect program at the tail runs regardless —
        the "is the drawback still paid when the attack did nothing?" board;
      • fix-colorless-weak-big (200 HP, ×2 Colorless) is the flatness witness for
        the recoil: it doubles Oinkologne's 160 to 320 and leaves the 60 alone;
      • fix-titan (340 HP, no Weakness, no Resistance, NO ATTACKS) is the pinned
        Active on both sides — it carries 220 without the epilogue sweeping a body
        out from under an assertion, it is the DOMINANT (mulligan-free) Basic
        through setup, and it never attacks back to interleave rows;
      • fix-basic-1 is the lone bench body a self-KO force-promotes.
    THE ENERGY IS SPLIT THREE WAYS on purpose — Lightning pays Dynamic Bolt's two
    typed symbols, Water pays Frost Purge's, and Colorless pays every {C} plus
    High-Impact Kick's whole cost. A case attaches MORE than the cost on the
    discard boards (that is the only way "all" says anything), and rebuilds each
    board a dozen times over, so every line is deep. */
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

/** D146's ATTACKER-CLASS deck (`classBlock.test.ts`). Its own 60, and for
    `ATTACK_LOCK_DECK`'s reason rather than `PREVENT_BLOCK_DECK`'s — which is worth
    stating, because this family is D142's own op and shares neither property with
    D142's suite: **the sentence is UNGATED**, no printing of it flips anything, so
    every board here is reached with no seed sweep and no seed table at all, and
    the suite pins that by an unchanged `rngState` across a whole install (D143's
    move). Sharing `PREVENT_BLOCK_DECK` would make this suite's determinism a
    coincidence of that one's shuffle, and adding these cards to it would move all
    of ITS pinned heads/tails seeds.

      • sv01-150 Staraptor — the filter at attack INDEX 0 ({C}{C}, printed 60),
        with "Power Blast" ({C}{C}{C}, 180) at index 1 as the index control AND as
        the biggest NON-Basic hit in the deck. A STAGE 2;
      • sv02-153 Noivern ex — the SAME sentence on another card from another SET,
        also at INDEX 0 ({C}{C}, 70). A STAGE 1, 260 HP, and its index-1
        "Dominating Echo" carries an UNMAPPED sentence that must stay LOUD;
      • THE TWO INSTALLERS ARE EACH OTHER'S NEGATIVE CASE, which is why there is
        no bespoke "evolved attacker" fixture: a Stage 1 and a Stage 2 attacking
        into each other's block is the filter failing, driven off printed cards;
      • sv02-072 Pincurchin — a BASIC Lightning attacker ({L}{L}{L}, 70 + an Energy
        discard off the defender). Staraptor is ×2 LIGHTNING, so its 140 is nulled
        to 0 and the blocked hit is 0 rather than 0 by coincidence; and the discard
        is the NARROW reading's other half — a filtered block stops the damage and
        NOT the effect, on one declaration;
      • sv02-097 Mimikyu — a BASIC attacker whose "Ghost Eye" ({P}{C}) PLACES 7
        counters. A placed counter is not damage (D138/D139), so it goes straight
        through a filter that matched, which is the sharpest single statement of
        what the narrow reading does not cover;
      • sv03-098 Polteageist — a STAGE 1 whose "Pour Tea" ({P}, index 1) reaches
        the SAME `damageActive` op as Ghost Eye. The pair is the constructed
        wide-and-filtered case: same op, same target, two attacker stages;
      • fix-attacker supplies the plain BASIC hit (Bite, {C}, 30) and the costless
        Yawn (§12 on the defender);
      • fix-sniper's "Spread Shot" ({C}, 30 + 20 to EACH benched) is the BASIC
        spread — the per-body claim, and the witness that the §10 clear really
        cleared;
      • sv02-172 Boss's Orders drags a shielded body off the Active Spot;
      • fix-basic-1 / fix-stage1 are the §10 EVOLVE clear, unreachable in play and
        surgeried exactly as D142 surgeried it;
      • fix-titan (340 HP, NO attacks) is the mulligan-free bench filler and
        promote target, big enough that no case ends with a body swept away. */
/** D147 — the durated DAMAGE REDUCTION deck (`damageReduction.test.ts`). Its own
    60 for `CLASS_BLOCK_DECK`'s reason exactly: this family prints no coin either,
    so the suite is SEED-FREE and pins that by an unchanged `rngState` across a
    whole install — but sharing another suite's deck would move that suite's own
    pinned shuffle, and two of the neighbours (`PREVENT_BLOCK_DECK`,
    `TAILS_SELF_COST_DECK`) are pinned seed by seed.

    ALL FOUR PRINTED AMOUNTS ARE HERE, on four real cards, at two different attack
    INDICES — which is the point of the fixture set rather than a nicety, because
    the amount is the only thing that varies in the sentence and the index varies
    per printing:

      • sv03-169 Swablu — 20, {C}, NO printed damage, INDEX 0. The install alone;
        50 HP, ×2 Lightning, −30 Fighting;
      • sv06.5-043 Varoom — 30, {M}, NO printed damage, INDEX 0, and the FIFTH
        producer: it has been in `FIXTURE_POOL` since D131 as Revavroom ex's
        pre-evolution, printing this family's rider with nothing reading it. The
        producer SWEEP found it; no remainder list ever mentioned it;
      • sv01-001 Pineco — 30 (10 of the 14 printings), {C}{C}, printed 10, INDEX 0.
        A D125 tail board; 60 HP, ×2 Fire;
      • sv01-139 Forretress — 50, {M}{C}{C}, printed 90, INDEX 1. The index control
        AND Pineco's EVOLUTION, so the §10 evolve clear and the "the record belongs
        to the Pokémon" case are both driven off two printed cards; 120 HP, ×2 Fire,
        −30 Grass;
      • sv02-048 Eiscue — 100, {W}{W}{W}, printed 100, INDEX 1, and the COMPOUND
        (`Discard all Energy from this Pokémon.` first). 110 HP, ×2 METAL — so
        Forretress's Metal 90 lands at `90×2 − 100 = 80` where the wrong order
        clamps it to 0, which is the W/R ORDERING PIN of the whole slice.

    The four READ SITES are each driven by their own card, because unlike D146's
    filter this slice's diff is one `+` per site rather than one folded line, so a
    site left out would be a site a mutation could delete for free:

      • fix-attacker's Fire "Flame" ({F}{C}, 60) is the main §8.5 hit — and the
        Fire ×2 on both Pineco and Forretress is what makes the parenthetical
        observable there;
      • sv01-069 Rotom's "Linear Attack" ({C}, `opponentAny` 20, `deals`) is
        `snipeActive` — LIGHTNING into Swablu's ×2, so that site runs Weakness and
        the reduction in the same declaration;
      • fix-sniper's "Spread Shot" ({C}, 30 + 20 to each benched) is `spreadDamage`;
      • fix-bramble's benched `deals` snipe is `placeSnipe`'s damage arm.
        Both Bench sites are UNREACHABLE with a live reduction off any printing (it
        can only be installed from the Active Spot and leaving clears it), so they
        are driven with a constructed record — D146's precedent for guarding a site
        no card can reach.

    sv02-172 Boss's Orders is the reachable §10 clear (the opponent drags the
    shielded body off the spot INSIDE the window); fix-titan (340 HP, NO attacks)
    is the mulligan-free bench filler and promote target. */
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

/** D148's DEFENDER-LOCK deck (`defenderLock.test.ts`). Its own 60, for
    `ATTACK_LOCK_DECK`'s reason rather than `PREVENT_BLOCK_DECK`'s: **neither
    printed sentence flips anything**, so the suite is SEED-FREE and pins that by
    an unchanged `rngState` across a whole park-and-resolve. It cannot share
    `ATTACK_LOCK_DECK` even though it reuses three of its cards — that suite is
    also seed-free but its own shuffle decides which Basics its `armed()` finds,
    and adding two cards would move every board in it.

    ⚠️ THE TWO SEATS ARE ASYMMETRIC HERE IN A WAY NO EARLIER DECK IS, because this
    is the family's first sentence whose effect lands on the OPPONENT: the
    INSTALLERS matter on P1 and the VICTIMS matter on P2, and a case is only
    meaningful when the victim is the right STAGE.

      • sv03-042 Eiscue ex — the ENERGY-COST compound at 3 printings. "Scalding
        Block" ({W}{W}{W}, INDEX 0, printed 160) is its only attack; the discard
        half PARKS with two different Energy attached, so the defender-side install
        sits BEHIND a park — the first time in this family that it has;
      • sv03-134 Houndoom ex — the CLASS-GATED printing at 1. "Evil Claw"
        ({D}{D}, INDEX 0, printed 90) at index 0 and "Hound's Fang" ({D}{D}{D},
        220, `damageSelf` since 0.x) at index 1: the index control, and a second
        live reader on the same card;
      • sv01-048 Alomomola is the VICTIM and does three jobs at once. It is a
        BASIC, so Evil Claw's predicate HOLDS on it; it has TWO attacks, so a
        locked Alomomola refused index-0 "Surf" is the "the lock is on the
        POKÉMON, not the attack" assertion made from the other seat; and its
        index-1 "Aqua Slash" installs D143's SELF-lock, which is what makes the
        two-ops-one-stamp case a drive rather than a surgery;
      • fix-mola-stage1 evolves from Alomomola and does two jobs: it is the §10
        EVOLVE clear (the victim's own counterplay, on the victim's own turn) and,
        once evolved, the body Evil Claw's predicate FAILS on — so the filter's
        two answers are one printed line of play apart;
      • sv01-194 Switch (Item) is the victim's other §10 route out of the window;
      • sv02-172 Boss's Orders is the INSTALLER's setup rather than an escape: drag
        a Basic up on the installing turn, then lock it, which is what shows the
        gate reads the Active as of RESOLUTION;
      • fix-attacker's costless "Yawn" is the §12 control the lock must not be
        confused with (an Asleep Active is refused by a DIFFERENT error code), and
        Bite ({C}, 30) is the plain hit that Knocks a locked body out;
      • fix-titan (340 HP, NO attacks) is the mulligan-free bench filler and the
        promote target that proves a lock does not travel to its holder's
        replacement. */
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

/** D149's ATTACKER-SIDE DEBUFF deck (`attackDebuff.test.ts`). Its own 60, and
    **SEED-FREE** for `damageReduction.test.ts`'s reason: no printing of this
    family carries a coin, so a seed table would describe a shuffle rather than a
    rule, and the install cases pin that with an unchanged `rngState`.

    ⚠️ IT IS ASYMMETRIC LIKE `DEFENDER_LOCK_DECK` AND FOR THE SAME REASON — the
    effect lands on the OPPONENT — but with one extra twist this family alone has:
    the debuffed body is the one that then ATTACKS, so P2's cards must be picked
    for what they DEAL and for the Weakness lines of P1's INSTALLERS, which are the
    bodies they deal it into. Every observability claim in the suite is a fact
    about a pair of cards rather than about one.

    The INSTALLERS (P1), all four printed amounts-and-sentences the pool has:

      • sv02-062 Pikachu — 20, "Growl" {C}, NO damage, INDEX 0, sentence ONE. Also
        P2's debuffed attacker (index-1 "Pika Bolt" {L}{C}, 30 LIGHTNING), which is
        what makes the main-hit order pin a two-printing board;
      • swsh10.5-061 Pidove — 20, "Growl" {C}, NO damage, INDEX 0, sentence ONE,
        the SECOND printing of that string. ×2 LIGHTNING makes it the defender the
        pin is observable on, and its −30 FIGHTING is the commuting control;
      • sv01-093 Florges — 30, "Moonblast" {P}{C}{C}, 120, INDEX 0, sentence ONE.
        Its OWN Blooming Garden nulls Weakness on its own side, so this is the
        printing whose parenthetical CANNOT bite — driven as the negative case;
      • sv06.5-008 Houndoom — 100, "Snarl" {R}{C}{C}, 100, **INDEX 1**, sentence
        TWO. ×2 WATER, so a debuffed Water attacker swinging back at it is the
        main-hit order pin at the biggest amount.

    The VICTIMS / debuffed ATTACKERS (P2), one per READ SITE, because the diff is
    one term per site and a site left out is a site a mutation deletes for free:

      • sv02-062 Pikachu's "Pika Bolt" ({L}{C}, 30) — the §8.5 MAIN HIT;
      • sv01-069 Rotom's "Linear Attack" ({C}, `opponentAny` 20, `deals`) —
        `snipeActive`, the only interpreter site that runs Weakness;
      • fix-sniper's "Spread Shot" ({C}, 30 + 20 to each benched) — `spreadDamage`,
        where the debuff reaches and the attacker's pre-W/R BONUS deliberately
        does not (types.ts `AttackDamageDebuff.amount` gives the printed reason);
      • fix-bramble's per-40 benched `deals` snipe — `placeSnipe`'s damage arm;
      • sv01-048 Alomomola ({W}, 120 HP) — the 100 board's attacker: "Aqua Slash"
        ({W}{W}{C}, 120, INDEX 1) survives Snarl's 100 and hits back into
        Houndoom's ×2 Water, and it installs D143's SELF-lock while it does so, so
        two durated fields ride one declaration. Index-0 "Surf" ({W}{C}, 30) is the
        same board's CLAMP case. `fix-mola-stage1` evolves from it — the victim's
        §10 evolve counterplay, on a printed line;
      • sv03-030 Entei (130 HP) survives Moonblast's 120 and swings back with
        "Blaze Ball" ({C}{C}{C}, 60 + 20 per {R}) — and it is ALSO the family's
        always-on member, whose printed "Pressure" Ability this slice deliberately
        does not read, so the same board is the stays-LOUD witness.

    sv01-194 Switch is the victim's §10 route out of the window. ⚠️ THERE IS NO
    BOSS'S ORDERS IN THIS DECK, unlike every earlier durated deck, and the absence
    is the point: the FORCED half of `switchInto` is UNREACHABLE for this field.
    The window is the victim's own turn, and the installer's turn ended when they
    declared, so nobody but the victim can move the debuffed body while it is live.

    sv01-193 Rocky Helmet is the `dealt > 0` boundary (D141/D145): worn by the
    INSTALLER, it puts 2 counters on whatever damages it — so a debuffed swing that
    clamps to 0 must draw no recoil and one that gets through must, which is the
    two-sided pin that a clamped zero is not "an attack that did damage".
    fix-titan (340 HP, NO attacks) is the mulligan-free bench filler and promote
    target. */
export const ATTACK_DEBUFF_DECK = deckOf({
  "sv02-062": 4, // Pikachu — "Growl" idx 0 (the 20) AND "Pika Bolt" idx 1 (the main-hit attacker)
  "swsh10.5-061": 4, // Pidove — "Growl" idx 0 (the 20 again), ×2 Lightning / −30 Fighting
  "sv01-093": 2, // Florges — "Moonblast" idx 0 (the 30), and Blooming Garden
  "sv06.5-008": 4, // Houndoom — "Snarl" idx 1 (the 100), ×2 Water, "Bite" idx 0
  "sv01-048": 4, // Alomomola — "Surf" idx 0, "Aqua Slash" idx 1 (120, + D143's self-lock)
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

/** TEST SURGERY: empty the seat's BENCH, returning every card on it (stack,
    attached Energy and Tools) to the bottom of that seat's deck — so the result
    stays legal-shaped, with every uid still in exactly one zone.

    Needed because `setActiveFromDeck` DISPLACES the Active it replaces onto the
    bench rather than removing it, so a board built by two or three successive
    Active surgeries silently carries one benched body per surgery. That is
    invisible to a suite that only asserts the Active (most of them), and wrong
    for any suite whose claim is about the WHOLE side — a board heal, a spread, a
    bench count. Call it after the last Active surgery and before benching the
    bodies the case actually wants. */
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

/** TEST SURGERY: attach one copy of `cardId` from the seat's deck onto their
    Active (`target: "active"`) or bench[index] as a POKÉMON TOOL.

    The real §7.4 path is the `attachTool` action, and the suites that can use it
    should — but it is turn-gated and hand-scoped, so it cannot put a Tool on the
    OPPONENT's board, which is exactly what a seat-asymmetry case needs. It also
    refuses unauthored Tools (`TRAINER_NOT_SIMULATED`), so a test wanting an inert
    Tool has no action to reach for.

    Deliberately does NOT enforce §7.4's one-Tool-per-Pokémon cap: this is
    surgery, and Revavroom ex's "Tune-Up" raises that cap in the real game, so a
    predicate reading `tools` must be testable above one. Legal-shaped otherwise
    (every uid in exactly one zone). */
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

/** TEST SURGERY: shrink the seat's deck to exactly `size` cards by sending the
    surplus off the BOTTOM into their discard pile — the CLAMP cases need a deck
    shallower than the number an op wants to take (D130's mill: "discard the top 3
    cards of your opponent's deck" against a deck of 2), and no seed can be relied
    on to produce one.

    OFF THE BOTTOM, never the top, which is the whole point of the helper: the top
    is exactly what the op under test reads, so a trim that ate it would change the
    uids the assertions match against. Into the DISCARD rather than out of the game,
    because every zone must still hold every uid exactly once — the cases measure
    discard-pile DELTAS across the action, so a pre-loaded pile is not in the way.

    A `size` at or above the current deck is a no-op (never an error): a case may
    want "at most N" without asserting the deck was longer. */
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
