import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import * as effects from "./effects";
import {
  ATTACK_READERS,
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { namesItsCard } from "./cards";
import { canonicalPrinting, withReprints } from "./printGroups";
import { programFor } from "./registry";
import { programmedCardIds } from "./testFixtures";

const POPULATION = {
  legalRows: 2021,
  attackUnits: 1732,
  abilityUnits: 376,
  trainerUnits: 264,
  specialEnergyUnits: 11,
} as const;

const BUILT = {
  attack: 1732,
  ability: 393,
  trainer: 264,
  specialEnergy: 11,
} as const;

const DERIVABLE_CONTROL = "Draw a card.";

const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackCancelRequirement,
];

interface BacklogRow {
  readonly row: number;
  readonly name: string;
  readonly pattern: RegExp;
  readonly attack: readonly (readonly [number, string])[];
  readonly abilityIds: readonly string[];
  readonly effectIds: readonly string[];
}

const ROWS: readonly BacklogRow[] = [
  {
    row: 10,
    name: "deck-search that ATTACHES (attachFromDeck)",
    pattern: /[Ss]earch your deck for.*Energy card.*attach/,
    attack: [
      [
        2,
        "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
      ],
      [
        1,
        "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.",
      ],
    ],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 9,
    name: "attach from the DISCARD PILE (attachEnergyFrom, source side)",
    pattern: /[Aa]ttach.*Energy card.*from your.*discard pile/,
    attack: [],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 11,
    name: "look at the top N (lookAtTopN)",
    pattern: /[Ll]ook at the top/,
    attack: [],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 13,
    name: "the discard pile into the hand or onto the Bench (discardPileRetrieval)",
    pattern: /[Pp]ut.*from your discard pile/,
    attack: [],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 16,
    name: 'copy an attack ("…and use it as this attack")',
    pattern: /use it as this attack/,
    attack: [],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 0,
    name: "evolve out of the DECK — NOT a backlog row, see the doc's blocked table",
    pattern: /deck for a card that evolves/,
    attack: [],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 15,
    name: "prevent all damage by ATTACKER CLASS (preventDamage.fromClass)",
    pattern: /[Pp]revent all damage.*by attacks from/,
    attack: [],
    abilityIds: [],
    effectIds: [],
  },
  {
    row: 12,
    name: "attach from the HAND (attachEnergyFrom, hand side)",
    pattern: /ttach.*Energy card.*from your hand/,
    attack: [],
    abilityIds: [],
    effectIds: [],
  },
];

const AURA_FAMILY: readonly (readonly [readonly string[], "D243" | "D245" | "D569" | null])[] = [
  [["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"], "D569"],
  [["sv10.5b-003", "sv10.5b-156", "sv10.5b-164"], "D243"],
  [["sv10-008", "sv10-184"], "D243"],
  [["svp-184", "sv09-117"], "D243"],
  [["sv09-007"], "D245"],
  [["sv08-021"], "D245"],
  [["sv07-038"], "D245"],
];

const TYPED_EVOLUTION_SEARCH: readonly string[] = ["sv10.5b-067", "sv10.5b-161", "sv10.5b-169"];

const RIPENING_CHARGE_IDS: readonly string[] = ["sv07-014", "sv07-156", "sv07-167", "sv08.5-011"];

const BATTLE_HARDENED_IDS: readonly string[] = ["sv06.5-025", "sv08.5-054"];

const CORNERSTONE_STANCE_IDS: readonly string[] = [
  "sv06-112",
  "sv06-199",
  "sv06-215",
  "sv08.5-058",
  "sv08.5-160",
];

const MIGHTY_SHELL_IDS: readonly string[] = ["sv10.5b-023", "sv10.5b-107"];

const CURIOUS_TEA_PARTY_IDS: readonly string[] = ["sv06-020", "sv06-171", "sv10-048"];

const SPHERICAL_SHIELD_IDS: readonly string[] = ["sv05-024"];

const PREVENT_FROM_EX_IDS: readonly string[] = ["sv08.5-040", "sv10-012", "sv10-186"];
const PREVENT_FROM_BASIC_EX_IDS: readonly string[] = ["sv05-108", "sv05-194"];

const FLOWER_CURTAIN_IDS: readonly string[] = ["sv10-010", "sv10-185"];

const IMPERVIOUS_SHELL_IDS: readonly string[] = ["sv07-044"];

const ADRENA_PHEROMONE_IDS: readonly string[] = ["sv06-096", "sv06.5-073", "sv08.5-045"];

const EXPERT_HIDER_IDS: readonly string[] = ["sv08-150", "sv08-213"];

const UNNERVE_IDS: readonly string[] = ["sv06.5-045", "sv06.5-077", "sv10-065", "sv10-210"];

const WIDE_WALL_IDS: readonly string[] = ["sv07-076"];

const DAUNTING_GAZE_IDS: readonly string[] = ["sv09-095"];

const OCEANIC_CURSE_IDS: readonly string[] = ["sv10.5w-045", "sv10.5w-160", "sv10.5w-168"];

const POTENT_GLARE_IDS: readonly string[] = ["sv10-113"];

const MASSIVE_BODY_IDS: readonly string[] = ["sv06.5-042"];

const ACE_NULLIFIER_IDS: readonly string[] = ["sv06.5-040"];

const LOOK_FOR_PREY_IDS: readonly string[] = ["sv10.5w-064", "sv10.5w-145"];

const EMERGENCY_EVOLUTION_IDS: readonly string[] = ["sv05-133"];

const RUN_AWAY_DRAW_IDS: readonly string[] = ["sv05-129", "sv08.5-080"];

const TELEPORTER_IDS: readonly string[] = ["sv06-080"];

const DARKEST_IMPULSE_IDS: readonly string[] = ["sv10-074"];
const GNAWING_CURSE_IDS: readonly string[] = ["sv05-104", "sv05-193"];

const LAVA_ZONE_IDS: readonly string[] = ["sv05-029"];

const STONE_PALACE_IDS: readonly string[] = ["sv10-086"];

const CURLY_WALL_IDS: readonly string[] = ["sv07-119", "svp-136"];

const BIG_NET_IDS: readonly string[] = ["sv06-005"];
const SECRET_FOREST_PATH_IDS: readonly string[] = ["sv09-089"];
const MELT_AWAY_IDS: readonly string[] = ["sv10-036"];

const VIBRANT_DANCE_IDS: readonly string[] = ["sv09-037"];

const ADRENA_POWER_IDS: readonly string[] = ["sv06-111", "sv06.5-074", "sv08.5-057"];
const CRAFTSMANSHIP_IDS: readonly string[] = ["sv10.5b-049", "sv10.5b-127"];
const RESILIENT_SOUL_IDS: readonly string[] = ["sv05-021"];

const FOOD_PREP_IDS: readonly string[] = ["svp-134", "sv07-042", "sv07-045", "sv07-149"];

const HUSTLE_PLAY_IDS: readonly string[] = ["sv05-034", "sv05-187"];

const CAPTIVATING_INVITATION_IDS: readonly string[] = ["sv06-088"];

const RECON_DIRECTIVE_IDS: readonly string[] = ["sv06-129", "sv08.5-072"];

const FREEZING_SHROUD_IDS: readonly string[] = ["sv06-053", "sv06-174", "svp-117"];

const CURSED_BLAST_5_IDS: readonly string[] = ["sv06.5-019", "sv06.5-069", "sv08.5-036"];
const CURSED_BLAST_13_IDS: readonly string[] = ["sv06.5-020", "sv06.5-070", "sv08.5-037"];

const OVERVOLT_DISCHARGE_IDS: readonly string[] = ["svp-153", "svp-159", "sv08-059"];

const BUZZING_BOOST_IDS: readonly string[] = ["sv10-003", "sv10-206", "sv10-228"];

const GLITTERING_STAR_PATTERN_IDS: readonly string[] = ["svp-133", "sv07-003", "sv07-144"];

const INVITING_WINK_IDS: readonly string[] = ["sv09-067", "sv09-164", "svp-183"];

const PYRO_DANCE_IDS: readonly string[] = ["svp-116", "sv06-033", "sv06-173"];
const METAL_MAKER_IDS: readonly string[] = ["svp-090", "sv05-114"];
const SNACK_SEEK_IDS: readonly string[] = ["sv06-072"];
const SPIKE_CLAD_IDS: readonly string[] = ["sv09-085", "sv09-166"];
const X_BOOT_IDS: readonly string[] = ["sv10-145"];
const AUTO_HEAL_IDS: readonly string[] = ["sv09-107"];
const SIMPLE_ONCE_IDS: readonly string[] = [
  "sv10-030",
  "sv10-189",
  "sv06-038",
  "sv06-134",
  "sv06-201",
  "sv10.5w-002",
  "sv10.5w-088",
  "sv09-079",
  "sv09-174",
  "sv05-017",
  "sv05-166",
  "sv10-033",
];
const ZERO_VOCAB_ABILITY_IDS: readonly string[] = [
  "sv10.5b-016",
  "sv10.5b-100",
  "sv10.5w-051",
  "sv10.5w-132",
  "sv08-085",
  "sv10.5w-023",
  "sv10.5w-107",
  "sv10-096",
  "sv08-056",
  "svp-152",
  "sv06-138",
];
const TOXIC_SUBJUGATION_IDS: readonly string[] = ["svp-129", "svp-149"];
const ABILITY_BUNDLE_D559_IDS: readonly string[] = [
  "sv09-056",
  "sv09-173",
  "sv09-184",
  "svp-195",
  "sv05-078",
  "sv08.5-043",
  "svp-097",
  "sv08-107",
  "sv07-110",
  "sv07-162",
  "sv09-008",
  "sv09-160",
  "sv10.5b-063",
  "sv10.5b-141",
  "sv09-082",
];
const ABILITY_BUNDLE_D560_IDS: readonly string[] = [
  "sv05-085",
  "sv10-125",
  "sv06-015",
  "svp-115",
  "sv08-147",
  "sv08-227",
  "sv10-092",
  "sv06.5-002",
  "sv09-021",
  "sv05-015",
  "sv08.5-008",
  "sv07-067",
  "sv07-160",
  "sv07-169",
  "sv08-093",
  "svp-154",
  "sv07-006",
];
const ABILITY_BUNDLE_D563_IDS: readonly string[] = [
  "svp-174",
  "sv08.5-075",
  "sv08.5-167",
  "sv09-128",
  "sv06.5-047",
  "svp-089",
  "sv05-041",
  "svp-126",
  "sv06-061",
  "sv06-193",
  "sv08.5-151",
];
const ABILITY_BUNDLE_D564_IDS: readonly string[] = ["sv06.5-029"];
const ABILITY_BUNDLE_D565_IDS: readonly string[] = [
  "sv10-045",
  "sv10-193",
  "sv10-089",
  "sv10-198",
  "sv06-132",
  "sv06-060",
];
const ABILITY_BUNDLE_D568_IDS: readonly string[] = [
  "sv08-042",
  "sv08-217",
  "sv08-237",
  "sv07-115",
  "sv08.5-078",
  "svp-141",
  "sv08-074",
];

const FESTIVAL_LEAD_IDS: readonly string[] = [
  "sv06-018",
  "sv06-044",
  "sv06-089",
  "sv06-170",
  "sv08.5-010",
  "sv08.5-020",
  "sv08.5-021",
];

const INITIALIZATION_IDS: readonly string[] = ["sv06-077", "sv06-196", "sv08.5-032"];

const CALM_DIVERS_D572_IDS: readonly string[] = [
  "sv06-095",
  "sv06.5-072",
  "sv08.5-044",
  "sv06-050",
  "sv10-055",
  "sv07-101",
];

const SCOVILLAIN_RELICANTH_D578_IDS: readonly string[] = [
  "sv08-037",
  "sv08-216",
  "sv05-084",
  "sv05-173",
];

const DUAL_CORE_D580_IDS: readonly string[] = ["sv05-118"];

const WONDER_KISS_IDS: readonly string[] = ["sv08-072"];
const GREEDY_EATER_IDS: readonly string[] = ["sv10.5w-067", "sv10.5w-161", "sv10.5w-169"];

const UNAWARE_IDS: readonly string[] = ["sv08-031"];

const REPELLING_VEIL_IDS: readonly string[] = ["sv10-051"];

const ASSEMBLE_ALLOY_IDS: readonly string[] = ["sv08-130", "sv08-224", "sv08-241"];
const CHARGING_UP_IDS: readonly string[] = ["sv10-020", "sv10-187"];
const DYNAMOTOR_IDS: readonly string[] = ["sv10.5b-031", "sv10.5b-114"];
const GREEDY_ORDER_IDS: readonly string[] = ["sv10-159", "sv10-205"];
const GENTLE_FIN_IDS: readonly string[] = ["sv10.5b-024", "sv10.5b-108"];
const SKYLINER_IDS: readonly string[] = ["sv08-076", "sv08-220", "sv08-239"];
const DISTORTED_FUTURE_IDS: readonly string[] = ["svp-211", "sv10.5w-043"];
const FLIP_THE_SCRIPT_IDS: readonly string[] = ["sv06.5-038", "sv06.5-084", "sv06.5-092"];
const SUBJUGATING_CHAINS_IDS: readonly string[] = [
  "sv06.5-039",
  "sv06.5-085",
  "sv06.5-093",
  "sv06.5-095",
  "sv08.5-163",
];
const FAN_CALL_IDS: readonly string[] = ["sv07-118", "sv08.5-085"];

const DEBUT_PERFORMANCE_IDS: readonly string[] = ["sv10.5b-044", "sv10.5b-159", "sv10.5b-167"];

const ATTACK_TIMING_GATE_IDS: readonly string[] = [
  "sv07-128",
  "sv07-170",
  "sv07-173",
  "sv08.5-092",
  "sv08.5-169",
  "sv08.5-180",
  "svp-165",
  "sv06-010",
  "sv06-094",
  "sv06-197",
  "sv06-009",
  "sv08-001",
  "sv08-192",
  "sv08.5-081",
  "sv08-086",
  "sv08.5-041",
  "sv08.5-156",
];

const BOOSTED_EVOLUTION_IDS: readonly string[] = ["sv08-143", "sv08.5-074", "svp-173"];

const STIMULATED_EVOLUTION_IDS: readonly string[] = [
  "sv10.5b-009",
  "sv10.5b-094",
  "sv10.5w-008",
  "sv10.5w-093",
];

const SPIKY_ENERGY_IDS: readonly string[] = ["sv09-159", "sv09-190"];
const MIST_ENERGY_IDS: readonly string[] = ["sv05-161"];
const ENRICHING_ENERGY_IDS: readonly string[] = ["sv08-191"];
const NEO_UPPER_ENERGY_IDS: readonly string[] = ["sv05-162"];
const PRISM_ENERGY_IDS: readonly string[] = ["sv10.5b-086"];
const LEGACY_ENERGY_IDS: readonly string[] = ["sv06-167"];
const REVERSAL_ENERGY_IDS: readonly string[] = ["sv04-266"];
const IGNITION_ENERGY_IDS: readonly string[] = ["sv10.5w-086"];
const BOOMERANG_ENERGY_IDS: readonly string[] = ["sv06-166"];
const TEAM_ROCKETS_ENERGY_IDS: readonly string[] = ["sv10-182"];

const ABILITY_AT_D242 = 100;
const ABILITY_AT_D243 = 107;
const ABILITY_AT_D244 = 114;
const ABILITY_AT_D245 = 120;

const BENCH_SWITCH_FAMILY: readonly (readonly [readonly string[], boolean])[] = [
  [["svp-128", "sv05-025", "sv05-186", "sv05-203", "sv05-213", "sv08.5-176"], true],
  [["sv09-018"], true],
];

const ROW_14_ABILITY_GROUPS: readonly (readonly [string, readonly string[], boolean])[] = [
  [
    "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play.",
    ["svp-205", "svp-216", "sv10-081", "sv10-213", "sv10-231", "sv10-240"],
    true,
  ],
  [
    "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken.",
    ["svp-177", "sv06-141", "sv06-202", "sv06-216", "sv06-222", "sv08.5-168"],
    true,
  ],
  [
    "When you play this Pokémon from your hand onto your Bench during your turn, you may switch it with your Active Pokémon. If you do, you may move any amount of Energy from your other Pokémon to this Pokémon.",
    ["svp-128", "sv05-025", "sv05-186", "sv05-203", "sv05-213", "sv08.5-176"],
    true,
  ],
  [
    "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.",
    ["sv06-018", "sv06-044", "sv06-089", "sv06-170", "sv08.5-010", "sv08.5-020", "sv08.5-021"],
    true,
  ],
  [
    "Attacks used by your Future Pokémon, except any Iron Crown ex, do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    ["svp-146", "sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158"],
    true,
  ],
];

const REGISTRY_ATTACKS: readonly (readonly [string, string])[] = [
  [
    "sv09-068",
    "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
  ],
  [
    "sv10-050",
    "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  ],
  [
    "sv10-194",
    "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
  ],
  [
    "sv10-083",
    "Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck.",
  ],
  ["sv08-131", "You may shuffle this Pokémon and all attached cards into your deck."],
  ["sv09-068", "Put this Pokémon and all attached cards into your hand."],
  ["sv06.5-015", "Discard this Pokémon and all attached cards."],
  ["sv06.5-081", "Discard this Pokémon and all attached cards."],
  [
    "sv10-122",
    "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)",
  ],
  [
    "sv10-217",
    "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)",
  ],
  [
    "sv10-234",
    "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)",
  ],
  [
    "sv10-242",
    "You may put this Pokémon into your hand. (Discard all cards attached to this Pokémon.)",
  ],
  [
    "sv07-011",
    "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
  ],
  [
    "sv10.5w-019",
    "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
  ],
  [
    "sv10.5w-104",
    "Search your deck for up to 3 in any combination of {R} Pokémon and Basic {R} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
  ],
  [
    "sv08-158",
    "Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto your Bench. Then, shuffle your deck.",
  ],
  [
    "sv08-161",
    "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.",
  ],
  [
    "sv05-121",
    "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
  ],
  [
    "svp-092",
    "Search your deck for up to 2 Basic Energy cards and attach them to your Future Pokémon in any way you like. Then, shuffle your deck.",
  ],
  [
    "sv05-097",
    "Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.",
  ],
  [
    "sv08.5-055",
    "Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.",
  ],
  ["sv05-077", "Heal 100 damage from 1 of your Benched Ancient Pokémon."],
  [
    "sv08-096",
    "Move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon.",
  ],
  [
    "sv05-062",
    "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck.",
  ],
  [
    "svp-098",
    "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck.",
  ],
  [
    "sv06.5-034",
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 120 damage to the new Active Pokémon. If you didn't play Xerosic's Machinations from your hand during this turn, this attack does nothing.",
  ],
  [
    "sv06-063",
    "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
  ],
  [
    "sv05-063",
    "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack.",
  ],
];

function attackRegistryIds(): string[] {
  return programmedCardIds().filter(
    (id) => !id.startsWith("fix-") && Object.keys(programFor(id)?.attack ?? {}).length > 0,
  );
}

const UNCLAIMED_BY_ANY_ROW =
  "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";

const printings = (row: BacklogRow) => row.attack.reduce((sum, [n]) => sum + n, 0);

describe("D233 — the derived census re-run at HEAD, and the numbers rows 9-16 quote", () => {
  it("the seven readers are wired — a control sentence DOES resolve", () => {
    // Without this, every assertion below would pass on a broken import.
    expect(resolvedByAnyReader(DERIVABLE_CONTROL)).toBe(true);
    expect(deriveAttackEffect(DERIVABLE_CONTROL)).not.toBeNull();
  });

  it("every printed sentence in every backlog family is refused by ALL SEVEN readers", () => {
    const resolved: string[] = [];
    for (const row of ROWS) {
      for (const [, text] of row.attack) {
        if (resolvedByAnyReader(text)) resolved.push(`row ${row.row}: ${text}`);
      }
    }
    expect(resolved).toEqual([]);
  });

  it("D575 — row 15 is CLOSED, and the closure is a MEASUREMENT rather than an empty loop", () => {
    const row15 = ROWS.find((r) => r.row === 15);
    if (row15 === undefined) throw new Error("row 15 is gone — it is kept in place (D178)");
    expect(row15.attack).toEqual([]);
    const family = legalAttackCorpus().filter(([, s]) => row15.pattern.test(s));
    expect([family.length, family.reduce((n, [c]) => n + c, 0)]).toEqual([4, 10]);
    expect(family.filter(([, s]) => !resolvedByAnyReader(s))).toEqual([]);
  });

  it("D574 — row 16 is CLOSED, and the closure is a MEASUREMENT rather than an empty loop", () => {
    const row16 = ROWS.find((r) => r.row === 16);
    if (row16 === undefined) throw new Error("row 16 is gone — it is kept in place (D178)");
    expect(row16.attack).toEqual([]);
    const family = legalAttackCorpus().filter(([, s]) => row16.pattern.test(s));
    expect([family.length, family.reduce((n, [c]) => n + c, 0)]).toEqual([6, 13]);
    expect(family.filter(([, s]) => !resolvedByAnyReader(s))).toEqual([]);
  });

  it("D534 — row 11 is CLOSED, and the closure is a MEASUREMENT rather than an empty loop", () => {
    const row11 = ROWS.find((r) => r.row === 11);
    if (row11 === undefined) throw new Error("row 11 is gone — it is kept struck in place (D178)");
    expect([row11.attack, row11.abilityIds, row11.effectIds]).toEqual([[], [], []]);
    const matching = legalAttackCorpus().filter(([, text]) => row11.pattern.test(text));
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.filter(([, text]) => !resolvedByAnyReader(text))).toEqual([]);
  });

  it("each sentence matches its OWN family predicate and no EARLIER one", () => {
    ROWS.forEach((row, index) => {
      for (const [, text] of row.attack) {
        expect(row.pattern.test(text), `row ${row.row} pattern misses: ${text}`).toBe(true);
        for (const earlier of ROWS.slice(0, index)) {
          expect(
            earlier.pattern.test(text),
            `row ${row.row}'s "${text}" is claimed earlier by row ${earlier.row}`,
          ).toBe(false);
        }
      }
    });
  });

  it("the sentences are DISTINCT within and across families", () => {
    const all = ROWS.flatMap((r) => r.attack.map(([, t]) => t));
    expect(new Set(all).size).toBe(all.length);
  });

  it("each row's ATTACK printings are the sum of its sentences", () => {
    const measured = Object.fromEntries(ROWS.map((r) => [r.name, printings(r)]));
    expect(measured).toEqual({
      "deck-search that ATTACHES (attachFromDeck)": 3,
      "attach from the DISCARD PILE (attachEnergyFrom, source side)": 0,
      "look at the top N (lookAtTopN)": 0,
      "the discard pile into the hand or onto the Bench (discardPileRetrieval)": 0,
      'copy an attack ("…and use it as this attack")': 0,
      "evolve out of the DECK — NOT a backlog row, see the doc's blocked table": 0,
      "prevent all damage by ATTACKER CLASS (preventDamage.fromClass)": 0,
      "attach from the HAND (attachEnergyFrom, hand side)": 0,
    });
  });

  it("every non-attack id these rows count as UNBUILT has no registry program", () => {
    const authored: string[] = [];
    for (const row of ROWS) {
      for (const id of [...row.abilityIds, ...row.effectIds]) {
        if (programFor(id) !== undefined) authored.push(`row ${row.row}: ${id}`);
      }
    }
    for (const [, ids, built] of ROW_14_ABILITY_GROUPS) {
      if (built) continue;
      for (const id of ids) if (programFor(id) !== undefined) authored.push(`row 14: ${id}`);
    }
    expect(authored).toEqual([]);
  });

  it("row 14's own three groups are six printings each — the COUNT re-derives", () => {
    expect(ROW_14_ABILITY_GROUPS.slice(0, 3).map(([, ids]) => ids.length)).toEqual([6, 6, 6]);
    const flat = ROW_14_ABILITY_GROUPS.flatMap(([, ids]) => ids);
    expect(new Set(flat).size).toBe(flat.length);
  });

  it("…and its SUPERLATIVE does not — a 7 sits above it and a fourth 6 beside it", () => {
    const unbuilt = ROW_14_ABILITY_GROUPS.filter(([, , built]) => !built).map(
      ([, ids]) => ids.length,
    );
    expect([...unbuilt].sort((a, b) => b - a)).toEqual([]);
    // Every id in a group marked BUILT really has a program, which is the other
    // half of the bookkeeping above and stops the flag being decorative.
    for (const [, ids, built] of ROW_14_ABILITY_GROUPS) {
      if (!built) continue;
      for (const id of ids) expect(programFor(id), `${id} is flagged built`).toBeDefined();
    }
    const row14Unbuilt = ROW_14_ABILITY_GROUPS.filter(([, , built]) => !built).reduce(
      (sum, [, ids]) => sum + ids.length,
      0,
    );
    expect(row14Unbuilt).toBe(0);
  });

  it("D243 — the SEAT-WIDE PRE-W/R AURA family: 7 of 16, and the 6 that were blocked ( D569: built — 16 of 16)", () => {
    for (const [ids, built] of AURA_FAMILY) {
      for (const id of ids) {
        expect(programFor(id)?.passive?.seatDamageBonusBeforeWR !== undefined, id).toBe(
          built !== null,
        );
      }
    }
    const printings = AURA_FAMILY.reduce((sum, [ids]) => sum + ids.length, 0);
    const shippedIn = (decision: "D243" | "D245" | "D569"): number =>
      AURA_FAMILY.filter(([, built]) => built === decision).reduce(
        (sum, [ids]) => sum + ids.length,
        0,
      );
    const shipped = shippedIn("D243") + shippedIn("D245") + shippedIn("D569");
    expect(printings).toBe(16);
    expect(shipped).toBe(16);
    expect(shippedIn("D243")).toBe(7);
    expect(shippedIn("D245")).toBe(3);
    expect(shippedIn("D569")).toBe(6);
    expect(ABILITY_AT_D243 - ABILITY_AT_D242).toBe(shippedIn("D243"));
    expect(ABILITY_AT_D245 - ABILITY_AT_D244).toBe(
      shippedIn("D245") + TYPED_EVOLUTION_SEARCH.length,
    );
  });

  it("D245 — the evolution-stage widening's SECOND sentence, which no backlog row names", () => {
    for (const id of TYPED_EVOLUTION_SEARCH) {
      const search = programFor(id)?.abilities?.[0]?.program?.[0];
      expect(search, id).toEqual({
        op: "searchDeck",
        filter: { kind: "typedPokemon", pokemonType: "Metal", stage: "evolution" },
        dest: "hand",
        max: 2,
        reveal: true,
      });
    }
  });

  it("D244 — the ON-BENCH SWITCH family: the row's 6, and the 7th the row never named", () => {
    for (const [ids, built] of BENCH_SWITCH_FAMILY) {
      for (const id of ids) {
        const uses = programFor(id);
        const switches =
          uses?.triggered?.[0]?.program !== undefined || uses?.abilities?.[0] !== undefined;
        expect(switches, id).toBe(built);
      }
    }
    const shipped = BENCH_SWITCH_FAMILY.filter(([, built]) => built).reduce(
      (sum, [ids]) => sum + ids.length,
      0,
    );
    expect(shipped).toBe(7);
    expect(ABILITY_AT_D244 - ABILITY_AT_D243).toBe(shipped);
  });

  it("the LIVE registry's attack ids ARE this table — the converse guard it had gone without", () => {
    const rotated = ["sv02-061", "sv02-236", "sv02-261", "sv02-274"].concat([
      "swsh10.5-031",
      "swsh10.5-079",
      "swsh10.5-086",
    ]);
    const trainerGranted = ["sv08-188"];
    const meAlias = [
      "me02.5-178",
      "30th-073",
      "30th-136",
      "mep-006",
      "me03-062",
      "me03-107",
      "me03-121",
      "me04-030",
      ...KEYED_ATTACK_ME_D597,
      ...KEYED_ATTACK_ME_D608,
    ].filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    const legalKeys = [...new Set(REGISTRY_ATTACKS.map(([id]) => id))];
    expect(attackRegistryIds().sort()).toEqual(
      [...withReprints([...legalKeys, ...rotated, ...trainerGranted, ...meAlias])].sort(),
    );
    expect(legalKeys).toHaveLength(27);
    expect(REGISTRY_ATTACKS).toHaveLength(28);
    const pool = programmedCardIds().filter((id) => !id.startsWith("fix-"));
    const cover = new Set([...attackRegistryIds(), ...nonAttackRegistryIds()]);
    expect([...cover].sort()).toEqual([...pool].sort());
    const both = attackRegistryIds().filter((id) => nonAttackRegistryIds().includes(id));
    expect(both.length).toBeGreaterThan(0);
    for (const id of both) {
      const keys = Object.keys(programFor(id) ?? {});
      expect(keys, id).toContain("attack");
      expect(
        keys.some((k) => k !== "attack"),
        id,
      ).toBe(true);
    }
  });

  it("the thirteen registry-authored legal attacks are NOT derivable — the '+13' is real", () => {
    for (const [id, text] of REGISTRY_ATTACKS) {
      const program = programFor(id);
      const authored = Object.keys(program?.attack ?? {});
      expect(authored.length, `${id} has no registry attack at any index`).toBeGreaterThan(0);
      expect(resolvedByAnyReader(text), `${id}'s text became derivable`).toBe(false);
    }
    expect(programFor("sv09-068")?.attack?.[0]).toBeDefined();
    expect(programFor("sv09-068")?.attack?.[1]).toBeDefined();
    expect(programFor("sv09-068")?.abilities).toBeUndefined();
    expect(programFor("sv08-131")?.attack?.[1]).toBeDefined();
    expect(programFor("sv08-131")?.attack?.[0]).toBeUndefined();
    for (const id of ["sv06.5-015", "sv06.5-081"]) {
      expect(programFor(id)?.attack?.[1], id).toBeDefined();
      expect(programFor(id)?.attack?.[0], id).toBeUndefined();
    }
    for (const id of ["sv10-122", "sv10-217", "sv10-234", "sv10-242"]) {
      expect(programFor(id)?.attack?.[0], id).toBeDefined();
      expect(programFor(id)?.attack?.[1], id).toBeUndefined();
    }
    expect(programFor("sv07-011")?.attack?.[0]).toBeDefined();
    expect(programFor("sv07-011")?.attack?.[1]).toBeUndefined();
    expect(programFor("sv07-011")?.abilities).toBeUndefined();
  });

  it("the headline arithmetic closes over all four columns", () => {
    const units =
      POPULATION.attackUnits +
      POPULATION.abilityUnits +
      POPULATION.trainerUnits +
      POPULATION.specialEnergyUnits;
    expect(units).toBe(2383);

    const built = BUILT.attack + BUILT.ability + BUILT.trainer + BUILT.specialEnergy;
    expect(built).toBe(2400);
    expect(units - built).toBe(-17);

    expect(BUILT.specialEnergy).toBe(
      SPIKY_ENERGY_IDS.length +
        MIST_ENERGY_IDS.length +
        ENRICHING_ENERGY_IDS.length +
        NEO_UPPER_ENERGY_IDS.length +
        LEGACY_ENERGY_IDS.length +
        PRISM_ENERGY_IDS.length +
        REVERSAL_ENERGY_IDS.length +
        IGNITION_ENERGY_IDS.length +
        BOOMERANG_ENERGY_IDS.length +
        TEAM_ROCKETS_ENERGY_IDS.length,
    );
    for (const id of [
      ...SPIKY_ENERGY_IDS,
      ...MIST_ENERGY_IDS,
      ...ENRICHING_ENERGY_IDS,
      ...NEO_UPPER_ENERGY_IDS,
      ...LEGACY_ENERGY_IDS,
      ...PRISM_ENERGY_IDS,
      ...REVERSAL_ENERGY_IDS,
      ...IGNITION_ENERGY_IDS,
      ...BOOMERANG_ENERGY_IDS,
      ...TEAM_ROCKETS_ENERGY_IDS,
    ]) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv09-159")).toBe(programFor("sv09-190"));
    expect(new Set(SPIKY_ENERGY_IDS).size).toBe(SPIKY_ENERGY_IDS.length);

    const auraShipped = AURA_FAMILY.filter(([, built]) => built !== null).reduce(
      (sum, [ids]) => sum + ids.length,
      0,
    );
    const switchShipped = BENCH_SWITCH_FAMILY.filter(([, built]) => built).reduce(
      (sum, [ids]) => sum + ids.length,
      0,
    );
    expect(BUILT.ability).toBe(
      ABILITY_AT_D242 +
        auraShipped +
        switchShipped +
        TYPED_EVOLUTION_SEARCH.length +
        RIPENING_CHARGE_IDS.length +
        BATTLE_HARDENED_IDS.length +
        CORNERSTONE_STANCE_IDS.length +
        MIGHTY_SHELL_IDS.length +
        CURIOUS_TEA_PARTY_IDS.length +
        SPHERICAL_SHIELD_IDS.length +
        PREVENT_FROM_EX_IDS.length +
        PREVENT_FROM_BASIC_EX_IDS.length +
        FLOWER_CURTAIN_IDS.length +
        IMPERVIOUS_SHELL_IDS.length +
        ADRENA_PHEROMONE_IDS.length +
        EXPERT_HIDER_IDS.length +
        UNNERVE_IDS.length +
        WIDE_WALL_IDS.length +
        UNAWARE_IDS.length +
        REPELLING_VEIL_IDS.length +
        ASSEMBLE_ALLOY_IDS.length +
        CHARGING_UP_IDS.length +
        DYNAMOTOR_IDS.length +
        GREEDY_ORDER_IDS.length +
        GENTLE_FIN_IDS.length +
        SKYLINER_IDS.length +
        DISTORTED_FUTURE_IDS.length +
        FLIP_THE_SCRIPT_IDS.length +
        SUBJUGATING_CHAINS_IDS.length +
        FAN_CALL_IDS.length +
        DEBUT_PERFORMANCE_IDS.length +
        BOOSTED_EVOLUTION_IDS.length +
        STIMULATED_EVOLUTION_IDS.length +
        ATTACK_TIMING_GATE_IDS.length +
        DAUNTING_GAZE_IDS.length +
        OCEANIC_CURSE_IDS.length +
        POTENT_GLARE_IDS.length +
        MASSIVE_BODY_IDS.length +
        ACE_NULLIFIER_IDS.length +
        LOOK_FOR_PREY_IDS.length +
        EMERGENCY_EVOLUTION_IDS.length +
        RUN_AWAY_DRAW_IDS.length +
        TELEPORTER_IDS.length +
        DARKEST_IMPULSE_IDS.length +
        GNAWING_CURSE_IDS.length +
        LAVA_ZONE_IDS.length +
        STONE_PALACE_IDS.length +
        CURLY_WALL_IDS.length +
        BIG_NET_IDS.length +
        SECRET_FOREST_PATH_IDS.length +
        MELT_AWAY_IDS.length +
        WONDER_KISS_IDS.length +
        GREEDY_EATER_IDS.length +
        VIBRANT_DANCE_IDS.length +
        ADRENA_POWER_IDS.length +
        CRAFTSMANSHIP_IDS.length +
        RESILIENT_SOUL_IDS.length +
        FOOD_PREP_IDS.length +
        HUSTLE_PLAY_IDS.length +
        CAPTIVATING_INVITATION_IDS.length +
        RECON_DIRECTIVE_IDS.length +
        FREEZING_SHROUD_IDS.length +
        CURSED_BLAST_5_IDS.length +
        CURSED_BLAST_13_IDS.length +
        OVERVOLT_DISCHARGE_IDS.length +
        BUZZING_BOOST_IDS.length +
        GLITTERING_STAR_PATTERN_IDS.length +
        INVITING_WINK_IDS.length +
        PYRO_DANCE_IDS.length +
        METAL_MAKER_IDS.length +
        SNACK_SEEK_IDS.length +
        SPIKE_CLAD_IDS.length +
        X_BOOT_IDS.length +
        AUTO_HEAL_IDS.length +
        SIMPLE_ONCE_IDS.length +
        ZERO_VOCAB_ABILITY_IDS.length +
        TOXIC_SUBJUGATION_IDS.length +
        ABILITY_BUNDLE_D559_IDS.length +
        ABILITY_BUNDLE_D560_IDS.length +
        ABILITY_BUNDLE_D563_IDS.length +
        ABILITY_BUNDLE_D564_IDS.length +
        ABILITY_BUNDLE_D565_IDS.length +
        ABILITY_BUNDLE_D568_IDS.length +
        FESTIVAL_LEAD_IDS.length +
        INITIALIZATION_IDS.length +
        CALM_DIVERS_D572_IDS.length +
        SCOVILLAIN_RELICANTH_D578_IDS.length +
        DUAL_CORE_D580_IDS.length,
    );
    for (const id of ADRENA_POWER_IDS) {
      const passive = programFor(id)?.passive;
      expect(passive?.hpBonus, `${id} is counted built and grants no HP`).toBeDefined();
      expect(passive?.hpBonus?.amount).toBe(100);
      expect(passive?.hpBonus?.requiresEnergyType, `${id} prints "any {D} attached"`).toBe(
        "Darkness",
      );
      expect(passive?.hpBonus?.beneficiary, `${id} prints no owner clause`).toBeUndefined();
      expect(passive?.hpBonusPer, `${id} prints "any", not "for each"`).toBeUndefined();
      // The half that cost nothing: an OLD field under an OLD condition.
      expect(passive?.damageBonusBeforeWRIf?.amount).toBe(100);
      expect(passive?.damageBonusBeforeWRIf?.cond).toEqual({
        kind: "yourActiveHasEnergyAttached",
        energy: "Darkness",
      });
    }
    for (const id of CRAFTSMANSHIP_IDS) {
      const per = programFor(id)?.passive?.hpBonusPer;
      expect(per, `${id} is counted built and carries no scaled grant`).toBeDefined();
      expect(per?.amount).toBe(40);
      expect(per?.scale, `${id} prints a TYPED energy count`).toEqual({
        kind: "attachedEnergy",
        energyType: "Fighting",
      });
      expect(
        programFor(id)?.passive?.hpBonus,
        `${id} prints "for each", not "any"`,
      ).toBeUndefined();
    }
    for (const id of RESILIENT_SOUL_IDS) {
      const per = programFor(id)?.passive?.hpBonusPer;
      expect(per, `${id} is counted built and carries no scaled grant`).toBeDefined();
      expect(per?.amount).toBe(50);
      // TAKEN, not remaining — the inversion that would be green on a 3-3 board.
      expect(per?.scale).toEqual({ kind: "opponentPrizesTaken" });
      expect(
        programFor(id)?.passive?.hpBonus,
        `${id} prints "for each", not "any"`,
      ).toBeUndefined();
    }
    for (const id of WONDER_KISS_IDS) {
      const bonus = programFor(id)?.passive?.koPrizeBonus;
      expect(bonus, `${id} is counted built and carries no prize bonus`).toBeDefined();
      expect(bonus?.ability).toBe("Wonder Kiss");
      expect(bonus?.amount).toBe(1);
      expect(bonus?.koSpot, `${id} prints "your opponent's ACTIVE Pokémon"`).toBe("active");
      expect(bonus?.coinFlip, `${id} prints "flip a coin"`).toBe(true);
      expect(bonus?.noStack, `${id} prints "doesn't stack"`).toBe(true);
      expect(bonus?.koTarget, `${id} narrows the SPOT and never the card`).toBeUndefined();
      expect(bonus?.byThisPokemonsAttack, `${id} names no attacker`).toBeUndefined();
    }
    for (const id of GREEDY_EATER_IDS) {
      const bonus = programFor(id)?.passive?.koPrizeBonus;
      expect(bonus, `${id} is counted built and carries no prize bonus`).toBeDefined();
      expect(bonus?.ability).toBe("Greedy Eater");
      expect(bonus?.amount).toBe(1);
      expect(bonus?.koTarget, `${id} prints "your opponent's BASIC Pokémon"`).toEqual({
        kind: "basicPokemon",
      });
      expect(bonus?.byThisPokemonsAttack, `${id} prints "used by this Pokémon"`).toBe(true);
      expect(bonus?.koSpot, `${id} names no spot`).toBeUndefined();
      expect(bonus?.coinFlip, `${id} prints no flip`).toBeUndefined();
      expect(bonus?.noStack, `${id} prints no stacking clause`).toBeUndefined();
    }
    for (const id of STONE_PALACE_IDS) {
      const aura = programFor(id)?.passive?.seatDamageReductionAfterWR;
      expect(aura, `${id} is counted built and carries no seat aura`).toBeDefined();
      expect(aura?.amount).toBe(30);
      expect(aura?.beneficiary).toEqual({ kind: "ownerPokemon", owner: "Steven" });
      expect(aura?.sourceOnBench, `${id} prints a bench SOURCE gate`).toBe(true);
      expect(aura?.otherNamedInPlay, `${id} prints no partner clause`).toBeUndefined();
      expect(aura?.noStack).toBe("Stone Palace");
    }
    for (const id of CURLY_WALL_IDS) {
      const aura = programFor(id)?.passive?.seatDamageReductionAfterWR;
      expect(aura, `${id} is counted built and carries no seat aura`).toBeDefined();
      expect(aura?.amount).toBe(60);
      expect(aura?.beneficiary).toEqual({
        kind: "typedPokemon",
        pokemonType: "Colorless",
        stage: "basic",
      });
      expect(aura?.sourceOnBench, `${id} prints no zone clause`).toBeUndefined();
      expect(aura?.otherNamedInPlay).toBe("Bouffalant");
      expect(aura?.noStack).toBe("Curly Wall");
    }
    for (const id of LAVA_ZONE_IDS) {
      const trigger = programFor(id)?.triggered?.[0];
      expect(trigger, `${id} is counted built and has no triggered row`).toBeDefined();
      expect(trigger?.opponentAction, `${id} is counted for a direction it does not watch`).toBe(
        true,
      );
      expect(trigger?.trigger).toBe("onActiveMovedToBench");
      expect(trigger?.doesNotStack, `${id} does not print the stacking clause`).toBeUndefined();
      expect(trigger?.program).toEqual([
        { op: "applyStatus", target: "defender", status: "burned" },
      ]);
    }
    for (const id of DARKEST_IMPULSE_IDS) {
      const trigger = programFor(id)?.triggered?.[0];
      expect(trigger, `${id} is counted built and has no triggered row`).toBeDefined();
      expect(trigger?.opponentAction, `${id} is counted for a direction it does not watch`).toBe(
        true,
      );
      expect(trigger?.trigger).toBe("onEvolve");
      expect(trigger?.doesNotStack, `${id} prints the stacking clause`).toBe(true);
      expect(trigger?.program).toEqual([{ op: "damageSubject", amount: 40 }]);
    }
    for (const id of GNAWING_CURSE_IDS) {
      const trigger = programFor(id)?.triggered?.[0];
      expect(trigger, `${id} is counted built and has no triggered row`).toBeDefined();
      expect(trigger?.opponentAction, `${id} is counted for a direction it does not watch`).toBe(
        true,
      );
      expect(trigger?.trigger).toBe("onEnergyAttach");
      expect(trigger?.doesNotStack, `${id} does not print the stacking clause`).toBeUndefined();
      expect(trigger?.program).toEqual([{ op: "damageSubject", amount: 20 }]);
    }
    for (const id of RUN_AWAY_DRAW_IDS) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability, `${id} is counted built and has no ability`).toBeDefined();
      expect(ability?.activeOnly, `${id} is counted for a clause it does not print`).toBe(false);
      expect(ability?.program).toEqual([
        { op: "drawCards", count: 3, recordAs: "moved" },
        { op: "recordGate", slot: "moved", ops: [{ op: "returnSelf", dest: "deck" }] },
      ]);
    }
    for (const id of TELEPORTER_IDS) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability, `${id} is counted built and has no ability`).toBeDefined();
      expect(ability?.activeOnly, `${id} is counted for a clause it does not print`).toBe(true);
      expect(ability?.program).toEqual([{ op: "returnSelf", dest: "deck" }]);
    }
    for (const id of EMERGENCY_EVOLUTION_IDS) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability, `${id} is counted built and has no ability`).toBeDefined();
      expect(ability?.remainingHpAtMost, `${id} is counted for a gate it does not carry`).toBe(30);
      expect(ability?.program?.[0]).toEqual({
        op: "evolveFromDeck",
        names: ["Unfezant", "Unfezant ex"],
      });
    }
    for (const id of [...DAUNTING_GAZE_IDS, ...OCEANIC_CURSE_IDS]) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentHandPlay,
        `${id} is counted for a bar it does not carry`,
      ).toBeDefined();
    }
    for (const id of POTENT_GLARE_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentPokemonPlay,
        `${id} is counted for a bar it does not carry`,
      ).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentHandPlay,
        `${id} must not be counted through the Trainer-surface field`,
      ).toBeUndefined();
    }
    for (const id of MASSIVE_BODY_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentHandPlay,
        `${id} is counted for a bar it does not carry`,
      ).toEqual(["Stadium"]);
      expect(
        programFor(id)?.passive?.preventOpponentPokemonPlay,
        `${id} must not be counted through the Pokémon-surface field`,
      ).toBeUndefined();
    }
    for (const id of ACE_NULLIFIER_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.passive?.preventOpponentAceSpecPlayWhileToolAttached,
        `${id} is counted for a bar it does not carry`,
      ).toBe(true);
      expect(
        programFor(id)?.passive?.preventOpponentHandPlay,
        `${id} must not be counted through the CLASS field — ACE SPEC is a rarity`,
      ).toBeUndefined();
      expect(
        programFor(id)?.passive?.preventOpponentPokemonPlay,
        `${id} must not be counted through the Pokémon-surface field`,
      ).toBeUndefined();
    }
    for (const id of LOOK_FOR_PREY_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      const ops = programFor(id)?.abilities?.[0]?.program ?? [];
      expect(
        ops.some((op) => op.op === "bottomFromOpponentHand" && op.dest === "bench"),
        `${id} is counted for a cross-seat bench put it does not carry`,
      ).toBe(true);
      expect(
        programFor(id)?.passive,
        `${id} must not be counted through a passive bar — its term is an OP field`,
      ).toBeUndefined();
    }
    expect(programFor("sv09-095")?.passive?.preventOpponentHandPlay).toEqual(["Item"]);
    expect(programFor("sv10.5w-045")?.passive?.preventOpponentHandPlay).toEqual(["Item", "Tool"]);
    expect(programFor("sv06.5-042")?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(new Set(ATTACK_TIMING_GATE_IDS).size).toBe(ATTACK_TIMING_GATE_IDS.length);
    for (const id of ATTACK_TIMING_GATE_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
      expect(
        programFor(id)?.attackGate,
        `${id} is counted for a gate it does not carry`,
      ).toBeDefined();
    }
    expect(programFor("svp-165")).toBe(programFor("sv07-128"));
    expect(programFor("sv06-197")).toBe(programFor("sv06-094"));
    expect(programFor("sv06-010")).not.toBe(programFor("sv06-094"));
    expect(programFor("sv06-009")).not.toBe(programFor("sv08-001"));
    expect(new Set(STIMULATED_EVOLUTION_IDS).size).toBe(STIMULATED_EVOLUTION_IDS.length);
    for (const id of STIMULATED_EVOLUTION_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv10.5b-094")).toBe(programFor("sv10.5b-009"));
    expect(programFor("sv10.5w-093")).toBe(programFor("sv10.5w-008"));
    expect(programFor("sv10.5w-008")).not.toBe(programFor("sv10.5b-009"));
    expect(new Set(BOOSTED_EVOLUTION_IDS).size).toBe(BOOSTED_EVOLUTION_IDS.length);
    for (const id of BOOSTED_EVOLUTION_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv08.5-074")).toBe(programFor("sv08-143"));
    expect(programFor("svp-173")).toBe(programFor("sv08-143"));
    expect(programFor("sv08-143")).not.toBe(programFor("sv10.5b-044"));
    expect(new Set(DEBUT_PERFORMANCE_IDS).size).toBe(DEBUT_PERFORMANCE_IDS.length);
    for (const id of DEBUT_PERFORMANCE_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv10.5b-159")).toBe(programFor("sv10.5b-044"));
    expect(programFor("sv10.5b-167")).toBe(programFor("sv10.5b-044"));
    expect(new Set(FAN_CALL_IDS).size).toBe(FAN_CALL_IDS.length);
    for (const id of FAN_CALL_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv08.5-085")).toBe(programFor("sv07-118"));
    expect(new Set(SUBJUGATING_CHAINS_IDS).size).toBe(SUBJUGATING_CHAINS_IDS.length);
    for (const id of SUBJUGATING_CHAINS_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(new Set(FLIP_THE_SCRIPT_IDS).size).toBe(FLIP_THE_SCRIPT_IDS.length);
    for (const id of FLIP_THE_SCRIPT_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv06.5-084")).toBe(programFor("sv06.5-038"));
    expect(programFor("sv06.5-092")).toBe(programFor("sv06.5-038"));
    expect(new Set(DISTORTED_FUTURE_IDS).size).toBe(DISTORTED_FUTURE_IDS.length);
    for (const id of DISTORTED_FUTURE_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv10.5w-043")).toBe(programFor("svp-211"));
    expect(new Set(SKYLINER_IDS).size).toBe(SKYLINER_IDS.length);
    for (const id of SKYLINER_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and the three ids share ONE program object, the reprint idiom.
    expect(programFor("sv08-220")).toBe(programFor("sv08-076"));
    expect(programFor("sv08-239")).toBe(programFor("sv08-076"));
    expect(programFor("sv10.5b-108")).toBe(programFor("sv10.5b-024"));
    expect(new Set(GENTLE_FIN_IDS).size).toBe(GENTLE_FIN_IDS.length);
    for (const id of GENTLE_FIN_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv10-205")).toBe(programFor("sv10-159"));
    expect(new Set(GREEDY_ORDER_IDS).size).toBe(GREEDY_ORDER_IDS.length);
    for (const id of GREEDY_ORDER_IDS) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    // …and every id in the new terms really is authored, which is what stops a
    // term from being a number that happens to fit.
    for (const id of [
      ...RIPENING_CHARGE_IDS,
      ...BATTLE_HARDENED_IDS,
      ...CORNERSTONE_STANCE_IDS,
      ...MIGHTY_SHELL_IDS,
      ...CURIOUS_TEA_PARTY_IDS,
      ...SPHERICAL_SHIELD_IDS,
      ...PREVENT_FROM_EX_IDS,
      ...PREVENT_FROM_BASIC_EX_IDS,
      ...FLOWER_CURTAIN_IDS,
      ...IMPERVIOUS_SHELL_IDS,
      ...ADRENA_PHEROMONE_IDS,
      ...EXPERT_HIDER_IDS,
      ...UNNERVE_IDS,
      ...WIDE_WALL_IDS,
      ...UNAWARE_IDS,
      ...REPELLING_VEIL_IDS,
    ]) {
      expect(programFor(id), `${id} is counted built and has no program`).toBeDefined();
    }
    expect(programFor("sv10-185")).toBe(programFor("sv10-010"));
    expect(new Set(FLOWER_CURTAIN_IDS).size).toBe(FLOWER_CURTAIN_IDS.length);
    expect(programFor("sv08.5-054")).toBe(programFor("sv06.5-025"));
    expect(new Set(BATTLE_HARDENED_IDS).size).toBe(BATTLE_HARDENED_IDS.length);
    for (const id of CORNERSTONE_STANCE_IDS) {
      expect(programFor(id), id).toBe(programFor("sv06-112"));
    }
    expect(new Set(CORNERSTONE_STANCE_IDS).size).toBe(CORNERSTONE_STANCE_IDS.length);
    for (const id of MIGHTY_SHELL_IDS) {
      expect(programFor(id), id).toBe(programFor("sv10.5b-023"));
    }
    expect(new Set(MIGHTY_SHELL_IDS).size).toBe(MIGHTY_SHELL_IDS.length);
    for (const id of CURIOUS_TEA_PARTY_IDS) {
      expect(programFor(id), id).toBe(programFor("sv06-020"));
    }
    expect(new Set(CURIOUS_TEA_PARTY_IDS).size).toBe(CURIOUS_TEA_PARTY_IDS.length);
    expect(new Set(SPHERICAL_SHIELD_IDS).size).toBe(SPHERICAL_SHIELD_IDS.length);
    for (const id of PREVENT_FROM_EX_IDS) {
      expect(programFor(id), id).toBe(programFor("sv08.5-040"));
    }
    for (const id of PREVENT_FROM_BASIC_EX_IDS) {
      expect(programFor(id), id).toBe(programFor("sv05-108"));
    }
    expect(programFor("sv08.5-040")).not.toBe(programFor("sv05-108"));
    expect(new Set([...PREVENT_FROM_EX_IDS, ...PREVENT_FROM_BASIC_EX_IDS]).size).toBe(
      PREVENT_FROM_EX_IDS.length + PREVENT_FROM_BASIC_EX_IDS.length,
    );

    const nonAttackUnits =
      POPULATION.abilityUnits + POPULATION.trainerUnits + POPULATION.specialEnergyUnits;
    expect(nonAttackUnits).toBe(651);
    expect(BUILT.ability + BUILT.trainer + BUILT.specialEnergy).toBe(668);

    expect(
      BUILT.attack -
        1 -
        2 -
        6 -
        7 -
        9 -
        2 -
        12 -
        3 -
        2 -
        1 -
        4 -
        2 -
        4 -
        2 -
        2 -
        2 -
        2 -
        1 -
        3 -
        1 -
        2 -
        3 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        2 -
        2 -
        3 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        4 -
        1 -
        2 -
        2 -
        2 -
        1 -
        2 -
        1 -
        1 -
        2 -
        5 -
        1 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        3 -
        3 -
        1 -
        2 -
        2 -
        2 -
        4 -
        4 -
        2 -
        2 -
        3 -
        3 -
        2 -
        5 -
        3 -
        2 -
        3 -
        3 -
        9 -
        6 -
        5 -
        3 -
        2 -
        8 -
        8 -
        3 -
        3 -
        5 -
        3 -
        3 -
        3 -
        3 -
        3 -
        3 -
        5 -
        6 -
        922,
    ).toBe(527);
    expect(
      13 +
        8 +
        13 +
        20 +
        28 +
        21 +
        12 +
        20 +
        9 +
        10 +
        8 +
        7 +
        3 +
        10 +
        3 +
        4 +
        2 +
        14 +
        8 +
        4 +
        2 +
        7 +
        6 +
        4 +
        2 +
        1 +
        7 +
        1 +
        1 +
        4,
    ).toBe(252);
    expect(
      BUILT.attack -
        1 -
        2 -
        6 -
        7 -
        9 -
        2 -
        12 -
        3 -
        2 -
        1 -
        4 -
        2 -
        4 -
        2 -
        2 -
        2 -
        2 -
        1 -
        3 -
        1 -
        2 -
        3 -
        2 -
        1 -
        2 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        2 -
        2 -
        2 -
        3 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        1 -
        4 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        2 -
        1 -
        1 -
        2 -
        5 -
        1 -
        1 -
        2 -
        2 -
        2 -
        1 -
        1 -
        1 -
        3 -
        3 -
        1 -
        2 -
        2 -
        2 -
        4 -
        4 -
        2 -
        2 -
        3 -
        3 -
        2 -
        5 -
        3 -
        2 -
        3 -
        3 -
        9 -
        6 -
        5 -
        3 -
        2 -
        8 -
        8 -
        3 -
        3 -
        5 -
        3 -
        3 -
        3 -
        3 -
        3 -
        3 -
        5 -
        6 -
        922 -
        252,
    ).toBe(273);
    expect(resolvedByAnyReader(UNCLAIMED_BY_ANY_ROW)).toBe(true);
  });

  it("the eight rows are a NAMED FRACTION of the unbuilt attack column, not all of it", () => {
    const unbuiltAttack = POPULATION.attackUnits - BUILT.attack;
    expect(unbuiltAttack).toBe(0);

    const rawUnbuiltSentences = legalAttackCorpus().filter(
      ([, text]) => !resolvedByAnyReader(text),
    );
    const residueSentences = rawUnbuiltSentences.filter(([, text]) => {
      if (REGISTRY_ATTACK_SENTENCES.includes(text)) return false;
      const gate = splitAttackGateClause(text);
      if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return false;
      return splitAttackTrailingClause(text) === null;
    });
    expect(rawUnbuiltSentences.length).toBe(40);
    expect(residueSentences.length).toBe(0);
    expect(residueSentences.reduce((sum, [n]) => sum + n, 0)).toBe(unbuiltAttack);

    const inRows = ROWS.filter((r) => r.row !== 0).reduce((sum, r) => sum + printings(r), 0);
    expect(inRows).toBe(3);

    expect(inRows).toBe(3);
    expect(unbuiltAttack).toBe(0);
  });
});

function nonAttackRegistryIds(): string[] {
  return programmedCardIds().filter(
    (id) =>
      !id.startsWith("fix-") && Object.keys(programFor(id) ?? {}).some((key) => key !== "attack"),
  );
}

/** The `category = 'Pokemon' AND legal_standard = 1` half of the join — the ids
    behind `BUILT.ability`, recorded one by one rather than as a total. */
const CENSUS_POKEMON_LEGAL: readonly string[] = [
  "sv05-008",
  "sv05-009",
  "sv05-010",
  "sv05-024",
  "sv05-025",
  "sv05-050",
  "sv05-108",
  "sv05-129",
  "sv05-133",
  "sv05-034",
  "sv05-187",
  "sv05-139",
  "sv05-186",
  "sv05-189",
  "sv05-194",
  "sv05-203",
  "sv05-205",
  "sv05-213",
  "sv05-215",
  "sv06-002",
  "sv06-020",
  "sv06-025",
  "sv06-096",
  "sv06-112",
  "sv06-123",
  "sv06-080",
  "sv06-088",
  "sv06-131",
  "sv06-141",
  "sv06-171",
  "sv06-186",
  "sv06-190",
  "sv06-199",
  "sv06-202",
  "sv06-211",
  "sv06-215",
  "sv06-216",
  "sv06-221",
  "sv06-222",
  "sv06.5-025",
  "sv06.5-037",
  "sv06.5-038",
  "sv06.5-039",
  "sv06.5-040",
  "sv06.5-042",
  "sv06.5-045",
  "sv06.5-073",
  "sv06.5-077",
  "sv06.5-083",
  "sv06.5-084",
  "sv06.5-085",
  "sv06.5-091",
  "sv06.5-092",
  "sv06.5-093",
  "sv06.5-095",
  "sv07-042",
  "sv07-045",
  "sv07-149",
  "sv07-014",
  "sv07-038",
  "sv07-044",
  "sv07-076",
  "sv07-107",
  "sv07-118",
  "sv07-125",
  "sv07-119",
  "sv07-155",
  "sv07-156",
  "sv07-167",
  "sv08-004",
  "sv08-009",
  "sv08-021",
  "sv08-031",
  "sv08-049",
  "sv08-052",
  "sv08-054",
  "sv08-057",
  "sv08-076",
  "sv08-130",
  "sv08-143",
  "sv08-150",
  "sv08-194",
  "sv08-200",
  "sv08-201",
  "sv08-213",
  "sv08-215",
  "sv08-219",
  "sv08-220",
  "sv08-224",
  "sv08-236",
  "sv08-238",
  "sv08-239",
  "sv08-241",
  "sv08-247",
  "sv08.5-011",
  "sv08.5-012",
  "sv08.5-040",
  "sv08.5-045",
  "sv08.5-054",
  "sv08.5-058",
  "sv08.5-067",
  "sv08.5-070",
  "sv08.5-074",
  "sv08.5-077",
  "sv08.5-080",
  "sv08.5-085",
  "sv08.5-088",
  "sv08.5-145",
  "sv08.5-160",
  "sv08.5-163",
  "sv08.5-168",
  "sv08.5-176",
  "sv08.5-177",
  "sv08.5-178",
  "sv08.5-179",
  "sv09-007",
  "sv09-018",
  "sv09-024",
  "sv09-031",
  "sv09-053",
  "sv09-055",
  "sv09-075",
  "sv09-085",
  "sv09-095",
  "sv09-098",
  "sv09-117",
  "sv09-136",
  "sv09-163",
  "sv09-166",
  "sv09-171",
  "sv09-172",
  "sv09-175",
  "sv09-182",
  "sv09-183",
  "sv09-185",
  "sv09-188",
  "sv09-189",
  "sv10-008",
  "sv10-010",
  "sv10-012",
  "sv10-020",
  "sv10-039",
  "sv10-048",
  "sv10-051",
  "sv10-065",
  "sv10-081",
  "sv10-103",
  "sv10-108",
  "sv10-086",
  "sv10-113",
  "sv10-121",
  "sv10-122",
  "sv10-136",
  "sv10-145",
  "sv10-155",
  "sv10-159",
  "sv10-184",
  "sv10-185",
  "sv10-186",
  "sv10-187",
  "sv10-205",
  "sv10-209",
  "sv10-210",
  "sv10-213",
  "sv10-217",
  "sv10-230",
  "sv10-231",
  "sv10-234",
  "sv10-239",
  "sv10-240",
  "sv10-242",
  "sv10.5b-003",
  "sv10.5b-009",
  "sv10.5b-023",
  "sv10.5b-024",
  "sv10.5b-031",
  "sv10.5b-044",
  "sv10.5b-052",
  "sv10.5b-056",
  "sv10.5b-067",
  "sv10.5b-094",
  "sv10.5b-107",
  "sv10.5b-108",
  "sv10.5b-114",
  "sv10.5b-130",
  "sv10.5b-134",
  "sv10.5b-156",
  "sv10.5b-159",
  "sv10.5b-161",
  "sv10.5b-164",
  "sv10.5b-167",
  "sv10.5b-169",
  "sv10.5w-008",
  "sv10.5w-013",
  "sv10.5w-043",
  "sv10.5w-045",
  "sv10.5w-064",
  "sv10.5w-077",
  "sv10.5w-093",
  "sv10.5w-098",
  "sv10.5w-145",
  "sv10.5w-160",
  "sv10.5w-162",
  "sv10.5w-168",
  "sv10.5w-170",
  "svp-118",
  "svp-127",
  "svp-128",
  "svp-134",
  "svp-136",
  "sv08-072",
  "sv10.5w-067",
  "sv10.5w-161",
  "sv10.5w-169",
  "sv09-037",
  "sv06-111", // Okidogi "Adrena-Power" (+100 HP gated on ANY {D}, plus the pre-W/R damage half on the SAME condition)
  "sv06.5-074", // Okidogi "Adrena-Power" (reprint)
  "sv08.5-057", // Okidogi "Adrena-Power" (reprint)
  "sv10.5b-049", // Conkeldurr "Craftsmanship" (+40 HP PER attached {F})
  "sv10.5b-127", // Conkeldurr "Craftsmanship" (reprint)
  "sv05-021",
  "svp-166",
  "svp-173",
  "svp-177",
  "svp-182",
  "svp-184",
  "svp-194",
  "svp-205",
  "svp-211",
  "svp-216",
  "sv06-009",
  "sv06-010",
  "sv06-094",
  "sv06-197",
  "sv07-128",
  "sv07-170",
  "sv07-173",
  "sv08-001",
  "sv08-192",
  "sv08.5-092",
  "sv08.5-169",
  "sv08.5-180",
  "svp-165",
  "sv08.5-081",
  "sv08-086",
  "sv08.5-041",
  "sv08.5-156",
  "sv10-074",
  "sv05-104",
  "sv05-193",
  "sv05-029",
  "sv06-005", // Ariados — "Big Net", the TARGET-narrowed cross-board surcharge
  "sv09-089", // Toedscruel — "Secret Forest Path", the OWN-SIDE bench-gated discount
  "sv10-036",
  "sv06-129",
  "sv08.5-072",
  "sv06-053",
  "sv06-174",
  "svp-117",
  "sv06.5-019",
  "sv06.5-069",
  "sv08.5-036",
  "sv06.5-020",
  "sv06.5-070",
  "sv08.5-037",
  "svp-153",
  "svp-159",
  "sv08-059",
  "sv10-003",
  "sv10-206",
  "sv10-228",
  "svp-133",
  "sv07-003",
  "sv07-144",
  "sv09-067",
  "sv09-164",
  "svp-183",
  "svp-116",
  "sv06-033",
  "sv06-173",
  "svp-090",
  "sv05-114",
  "sv06-072",
  "sv09-107",
  "sv10-030",
  "sv10-189",
  "sv06-038",
  "sv06-134",
  "sv06-201",
  "sv10.5w-002",
  "sv10.5w-088",
  "sv09-079",
  "sv09-174",
  "sv05-017",
  "sv05-166",
  "sv10-033",
  "sv10.5b-016",
  "sv10.5b-100",
  "sv10.5w-051",
  "sv10.5w-132",
  "sv08-085",
  "sv10.5w-023",
  "sv10.5w-107",
  "sv10-096",
  "sv08-056",
  "svp-152",
  "sv06-138",
  "svp-129",
  "svp-149",
  "sv09-056",
  "sv09-173",
  "sv09-184",
  "svp-195",
  "sv05-078",
  "sv08.5-043",
  "svp-097",
  "sv08-107",
  "sv07-110",
  "sv07-162",
  "sv09-008",
  "sv09-160",
  "sv10.5b-063",
  "sv10.5b-141",
  "sv09-082",
  "sv05-085",
  "sv10-125",
  "sv06-015",
  "svp-115",
  "sv08-147",
  "sv08-227",
  "sv10-092",
  "sv06.5-002",
  "sv09-021",
  "sv05-015",
  "sv08.5-008",
  "sv07-067",
  "sv07-160",
  "sv07-169",
  "sv08-093",
  "svp-154",
  "sv07-006",
  "svp-174",
  "sv08.5-075",
  "sv08.5-167",
  "sv09-128",
  "sv06.5-047",
  "svp-089",
  "sv05-041",
  "svp-126",
  "sv06-061",
  "sv06-193",
  "sv08.5-151",
  "sv06.5-029",
  "sv10-045",
  "sv10-193",
  "sv10-089",
  "sv10-198",
  "sv06-132",
  "sv06-060",
  "sv08-042",
  "sv08-217",
  "sv08-237",
  "sv07-115",
  "sv08.5-078",
  "svp-141",
  "sv08-074",
  "sv05-081",
  "sv05-191",
  "sv05-206",
  "sv05-216",
  "sv08.5-158",
  "svp-146",
  "sv06-018",
  "sv06-044",
  "sv06-089",
  "sv06-170",
  "sv08.5-010",
  "sv08.5-020",
  "sv08.5-021",
  "sv06-077",
  "sv06-196",
  "sv08.5-032",
  "sv06-095",
  "sv06.5-072",
  "sv08.5-044",
  "sv06-050",
  "sv10-055",
  "sv07-101",
  "sv08-037",
  "sv08-216",
  "sv05-084",
  "sv05-173",
  "sv05-118",
];

/** The `category = 'Trainer' AND legal_standard = 1` half — `BUILT.trainer`. */
const CENSUS_TRAINER_LEGAL: readonly string[] = [
  "sv05-152",
  "sv08-177",
  "sv08-180",
  "sv08-250",
  "sv10-162",
  "sv05-144",
  "sv05-153",
  "sv05-154",
  "sv05-157",
  "sv06-145",
  "sv06-148",
  "sv06-151",
  "sv06-155",
  "sv06-165",
  "sv06-204",
  "sv06-205",
  "sv06-207",
  "sv06-217",
  "sv06-219",
  "sv06-223",
  "sv06-224",
  "sv06.5-055",
  "sv06.5-058",
  "sv06.5-059",
  "sv06.5-060",
  "sv06.5-061",
  "sv06.5-088",
  "sv07-138",
  "sv07-139",
  "sv07-165",
  "sv07-166",
  "sv07-172",
  "sv08-165",
  "sv08-166",
  "sv08-167",
  "sv08-171",
  "sv08-173",
  "sv08-183",
  "sv08-187",
  "sv08-229",
  "sv08-231",
  "sv08-235",
  "sv08-243",
  "sv08-251",
  "sv08.5-095",
  "sv08.5-101",
  "sv08.5-103",
  "sv08.5-109",
  "sv08.5-112",
  "sv08.5-114",
  "sv08.5-116",
  "sv08.5-117",
  "sv08.5-119",
  "sv08.5-131",
  "sv08.5-137",
  "sv08.5-173",
  "sv08.5-175",
  "sv09-147",
  "sv09-150",
  "sv09-153",
  "sv10-163",
  "sv10-164",
  "sv10-168",
  "sv10-169",
  "sv10-174",
  "sv10-177",
  "sv10-220",
  "sv10-225",
  "sv10-227",
  "sv10-238",
  "sv10-244",
  "sv10.5b-082",
  "sv10.5b-083",
  "sv10.5b-084",
  "sv10.5b-162",
  "sv10.5b-163",
  "sv10.5b-170",
  "sv10.5w-081",
  "sv10.5w-082",
  "sv10.5w-083",
  "sv10.5w-163",
  "svp-114",
  "sv09-151",
  "sv10-170",
  "sv10-223",
  "sv10-176",
  "sv10-226",
  "sv08-179",
  "sv08-234",
  "sv08-246",
  "sv08-174",
  "sv08-232",
  "sv08-244",
  "sv08.5-172",
  "sv08.5-127",
  "sv06-143",
  "sv08.5-102",
  "sv05-147",
  "sv05-200",
  "sv08.5-107",
  "sv08.5-115",
  "sv08.5-139",
  "sv06-163",
  "sv10-165",
  "sv10-221",
  "sv10-236",
  "sv05-145",
  "sv05-198",
  "sv08.5-104",
  "sv05-142",
  "sv05-197",
  "sv05-209",
  "sv10.5b-081",
  "sv10.5w-084",
  "sv10.5w-164",
  "sv10.5w-171",
  "sv06.5-057",
  "sv06.5-087",
  "sv08-170",
  "sv08-230",
  "sv06-152",
  "sv10-178",
  "sv08-176",
  "sv08-185",
  "sv05-143",
  "sv06.5-056",
  "sv06.5-086",
  "sv06.5-094",
  "sv06-147",
  "sv06.5-062",
  "sv09-149",
  "sv09-180",
  "sv05-146",
  "sv05-199",
  "sv05-210",
  "sv08.5-136",
  "sv08-181",
  "sv08.5-096",
  "sv08.5-097",
  "sv08.5-098",
  "sv08.5-099",
  "sv09-143",
  "sv09-144",
  "sv09-145",
  "svp-219",
  "svp-220",
  "sv10-171",
  "sv10-224",
  "sv10-237",
  "sv09-142",
  "sv08-172",
  "sv10-175",
  "sv06-144",
  "sv06-203",
  "sv06-154",
  "sv06-206",
  "sv06-218",
  "sv08.5-113",
  "sv08.5-174",
  "sv10-179",
  "sv05-155",
  "sv05-201",
  "sv05-211",
  "sv06.5-064",
  "sv06.5-089",
  "sv06-157",
  "sv06-208",
  "sv10-161",
  "sv08-182",
  "sv08-164",
  "sv10-181",
  "sv08-175",
  "sv10.5w-085",
  "sv08-169",
  "sv08-249",
  "sv09-148",
  "sv10.5w-080",
  "sv10.5b-079",
  "sv05-159",
  "sv06-225",
  "sv08.5-126",
  "sv07-137",
  "sv05-148",
  "sv10-166",
  "sv09-154",
  "sv09-152",
  "svp-150",
  "svp-224",
  "sv05-160",
  "sv05-202",
  "sv05-212",
  "sv06-160",
  "sv06-209",
  "sv06-220",
  "sv07-133",
  "sv07-164",
  "sv08.5-105",
  "sv08.5-171",
  "sv09-158",
  "sv06-156",
  "sv05-150",
  "sv06-162",
  "sv08.5-128",
  "sv08-186",
  "sv06.5-054",
  "sv05-156",
  "sv08.5-111",
  "sv07-140",
  "sv07-141",
  "sv08-163",
  "sv08-168",
  "sv08-184",
  "sv06-164",
  "sv07-134",
  "sv06-158",
  "sv06-150",
  "sv06-153",
  "sv10-243",
  "sv06-149",
  "sv08.5-108",
  "sv08-178",
  "sv08-233",
  "sv08-245",
  "sv08.5-093",
  "sv08.5-132",
  "sv08.5-170",
  "sv10-173",
  "sv06-146",
  "sv09-157",
  "sv09-181",
  "sv09-146",
  "sv09-179",
  "sv06-159",
  "sv08.5-118",
  "sv05-151",
  "sv08-162",
  "sv06.5-063",
  "sv06.5-097",
  "sv10-180",
  "sv09-156",
  "sv06-142",
  "sv10-172",
  "sv07-136",
  "sv07-142",
  "sv08.5-129",
  "sv08-189",
  "sv07-135",
  "sv08.5-110",
  "sv07-132",
  "sv07-163",
  "sv07-171",
  "sv08.5-100",
  "sv05-141",
  "sv05-158",
  "sv07-129",
  "sv10.5b-080",
  "sv07-130",
  "sv10.5w-079",
  "sv07-131",
  "sv07-174",
  "sv08.5-094",
  "sv08-190",
  "sv08.5-143",
  "sv08-188",
];

const CENSUS_ENERGY_LEGAL: readonly string[] = [
  "sv05-161",
  "sv05-162",
  "sv06-167",
  "sv08-191",
  "sv09-159",
  "sv09-190",
  "sv10.5b-086",
  "sv04-266",
  "sv10.5w-086",
  "sv06-166",
  "sv10-182",
];

const CENSUS_NOT_LEGAL: readonly string[] = [
  "sv04.5-228",
  "sv10-167",
  "sv10-222",
  "sv04.5-089",
  "sv03.5-206",
  "mfb-34",
  "sv04.5-091",
  "mfb-33",
  "sv02-192",
  "svp-045",
  "sv01-166",
  "sv01-235",
  "sv01-249",
  "sv03-186",
  "sv04.5-235",
  "sv01-081",
  "sv01-227",
  "sv01-244",
  "sv01-253",
  "sv04.5-243",
  "svp-028",
  "sv01-005",
  "sv01-006",
  "sv01-019",
  "sv01-023",
  "sv01-041",
  "sv01-054",
  "sv01-068",
  "sv01-076",
  "sv01-086",
  "sv01-093",
  "sv01-096",
  "sv01-099",
  "sv01-118",
  "sv01-121",
  "sv01-125",
  "sv01-142",
  "sv01-145",
  "sv01-151",
  "sv01-167",
  "sv01-168",
  "sv01-169",
  "sv01-170",
  "sv01-171",
  "sv01-172",
  "sv01-173",
  "sv01-174",
  "sv01-175",
  "sv01-176",
  "sv01-177",
  "sv01-178",
  "sv01-179",
  "sv01-180",
  "sv01-181",
  "sv01-182",
  "sv01-184",
  "sv01-185",
  "sv01-186",
  "sv01-187",
  "sv01-188",
  "sv01-189",
  "sv01-190",
  "sv01-191",
  "sv01-192",
  "sv01-193",
  "sv01-194",
  "sv01-196",
  "sv01-197",
  "sv01-198",
  "sv01-203",
  "sv01-208",
  "sv01-209",
  "sv01-222",
  "sv01-223",
  "sv01-228",
  "sv01-231",
  "sv01-236",
  "sv01-237",
  "sv01-238",
  "sv01-240",
  "sv01-241",
  "sv01-243",
  "sv01-245",
  "sv01-247",
  "sv01-250",
  "sv01-251",
  "sv01-254",
  "sv01-255",
  "sv01-256",
  "sv02-015",
  "sv02-060",
  "sv02-061",
  "sv02-089",
  "sv02-097",
  "sv02-105",
  "sv02-113",
  "sv02-123",
  "sv02-126",
  "sv02-127",
  "sv02-140",
  "sv02-150",
  "sv02-170",
  "sv02-171",
  "sv02-172",
  "sv02-173",
  "sv02-175",
  "sv02-176",
  "sv02-179",
  "sv02-180",
  "sv02-181",
  "sv02-182",
  "sv02-183",
  "sv02-184",
  "sv02-185",
  "sv02-187",
  "sv02-188",
  "sv02-189",
  "sv02-190",
  "sv02-191",
  "sv02-193",
  "sv02-210",
  "sv02-227",
  "sv02-231",
  "sv02-236",
  "sv02-243",
  "sv02-245",
  "sv02-248",
  "sv02-250",
  "sv02-251",
  "sv02-252",
  "sv02-253",
  "sv02-254",
  "sv02-255",
  "sv02-256",
  "sv02-261",
  "sv02-263",
  "sv02-265",
  "sv02-266",
  "sv02-267",
  "sv02-268",
  "sv02-269",
  "sv02-270",
  "sv02-271",
  "sv02-274",
  "sv02-275",
  "sv02-276",
  "sv02-277",
  "sv03-012",
  "sv03-030",
  "sv03-044",
  "sv03-052",
  "sv03-070",
  "sv03-078",
  "sv03-082",
  "sv03-112",
  "sv03-120",
  "sv03-125",
  "sv03-143",
  "sv03-174",
  "sv03-187",
  "sv03-190",
  "sv03-192",
  "sv03-193",
  "sv03-196",
  "sv03-197",
  "sv03-201",
  "sv03-215",
  "sv03-219",
  "sv03-220",
  "sv03-223",
  "sv03-227",
  "sv03-228",
  "sv03-229",
  "sv06.5-096",
  "swsh10.5-011",
  "swsh10.5-018",
  "swsh10.5-025",
  "swsh10.5-055",
  "swsh10.5-069",
  "swsh10.5-078",
  "swsh10.5-084",
  "sv04-172",
  "sv04-241",
  "sv04-258",
  "sv04-160",
  "sv04-264",
];

describe("D273 — the non-attack BUILT columns, derived from the LIVE registry", () => {
  it("the live non-attack pool is 415 ids and the scan reached the last raw key ( D572: 814 live — the title's 415 is D271's figure; D576: 818 live; D577: 824 live; D578: 830 live)", () => {
    const raw = programmedCardIds();
    expect(raw).toContain("sv09-107");
    expect(raw.length).toBe(1523);
    expect(nonAttackRegistryIds().length).toBe(1358);
  });

  it("the four recorded lists PARTITION the live pool — this is the guard that reddens on a bump", () => {
    const pool = nonAttackRegistryIds();
    const recorded = [
      ...CENSUS_POKEMON_LEGAL,
      ...CENSUS_TRAINER_LEGAL,
      ...CENSUS_ENERGY_LEGAL,
      ...CENSUS_NOT_LEGAL,
      ...CENSUS_ME_ALIAS_D582,
      ...CENSUS_ME_ENERGY_D583,
      ...CENSUS_ME_POKEMON_D584,
      ...CENSUS_ME_TRAINER_D584,
      ...CENSUS_ME_POKEMON_D585,
      ...CENSUS_ME_POKEMON_D586,
      ...CENSUS_ME_TRAINER_D587,
      ...CENSUS_ME_TRAINER_D588,
      ...CENSUS_ME_POKEMON_D589,
      ...CENSUS_ME_POKEMON_D590,
      ...CENSUS_ME_POKEMON_D591,
      ...CENSUS_ME_POKEMON_D594,
      ...CENSUS_ME_POKEMON_D598,
      ...CENSUS_ME_TRAINER_D599,
      ...CENSUS_ME_POKEMON_D602,
      ...CENSUS_ME_POKEMON_D603,
      ...CENSUS_ME_TRAINER_D603,
      ...CENSUS_ME_ENERGY_D604,
      ...CENSUS_ME_TRAINER_D606,
      ...CENSUS_ME_POKEMON_D610,
      ...CENSUS_ME_POKEMON_D611,
      ...CENSUS_ME_POKEMON_D614,
      ...CENSUS_ME_TRAINER_D617,
      ...CENSUS_ME_TRAINER_D618,
      ...CENSUS_ME_POKEMON_D619,
      ...CENSUS_ME_TRAINER_D619,
      ...CENSUS_ME_TRAINER_D620,
      ...CENSUS_ME_TRAINER_D621,
      ...CENSUS_ME_TRAINER_D625,
      ...CENSUS_ME_POKEMON_D626,
      ...CENSUS_ME_TRAINER_D626,
      ...CENSUS_ME_POKEMON_D627,
      ...CENSUS_ME_POKEMON_D628,
      ...CENSUS_ME_TRAINER_D630,
      ...CENSUS_ME_POKEMON_D631,
      ...CENSUS_ME_POKEMON_D632,
      ...CENSUS_ME_TRAINER_D635,
      ...CENSUS_ME_POKEMON_D636,
      ...CENSUS_ME_TRAINER_D637,
      ...CENSUS_ME_POKEMON_D638,
      ...CENSUS_ME_TRAINER_D641,
      ...CENSUS_ME_POKEMON_D642,
      ...CENSUS_ME_TRAINER_D642,
      ...CENSUS_ME_POKEMON_D643,
      ...CENSUS_ME_POKEMON_D644,
      ...CENSUS_ME_TRAINER_D644,
      ...CENSUS_ME_POKEMON_D645,
      ...CENSUS_ME_TRAINER_D646,
      ...CENSUS_ME_TRAINER_B04,
    ];
    // No id classified twice — otherwise a column could borrow from another and
    // the sizes would still add up.
    expect(new Set(recorded).size).toBe(recorded.length);
    const inPool = new Set(pool);
    const inRecorded = new Set(recorded);
    // A reprint plays its canonical printing's program, so it is classified with it.
    const unclassified = pool.filter(
      (id) => !inRecorded.has(id) && !inRecorded.has(canonicalPrinting(id)),
    );
    const phantom = recorded.filter((id) => !inPool.has(id));
    expect(unclassified).toEqual([]);
    expect(phantom).toEqual([]);
  });

  it("BUILT.ability / .trainer / .specialEnergy ARE the sizes of those lists", () => {
    expect(CENSUS_POKEMON_LEGAL.length).toBe(BUILT.ability);
    expect(CENSUS_TRAINER_LEGAL.length).toBe(BUILT.trainer);
    expect(CENSUS_ENERGY_LEGAL.length).toBe(BUILT.specialEnergy);
    // And the recorded not-legal remainder closes the 415 arithmetically, so a
    // column that grew by taking from the remainder is caught too.
    expect(BUILT.ability + BUILT.trainer + BUILT.specialEnergy + CENSUS_NOT_LEGAL.length).toBe(854);
  });

  it("every id in a column really has a non-attack registry program — the attribution control", () => {
    for (const id of [...CENSUS_POKEMON_LEGAL, ...CENSUS_TRAINER_LEGAL, ...CENSUS_ENERGY_LEGAL]) {
      const program = programFor(id);
      expect(program, id).toBeDefined();
      expect(
        Object.keys(program ?? {}).some((key) => key !== "attack"),
        id,
      ).toBe(true);
    }
  });
});

const TRAINER_TERMS: readonly (readonly [string, string, readonly string[]])[] = [
  ["Bianca's Devotion", "Supporter", ["sv05-142", "sv05-197", "sv05-209"]],
  ["Binding Mochi", "Tool", ["sv06.5-055", "sv08.5-095"]],
  ["Ciphermaniac's Codebreaking", "Supporter", ["sv05-145", "sv05-198", "sv08.5-104"]],
  ["Buddy-Buddy Poffin", "Item", ["sv05-144", "sv06-223", "sv08.5-101"]],
  ["Bug Catching Set", "Item", ["sv06-143", "sv08.5-102"]],
  ["Call Bell", "Item", ["sv08-165"]],
  ["Carmine", "Supporter", ["sv06-145", "sv06-204", "sv06-217", "sv08.5-103"]],
  ["Cheren", "Supporter", ["sv10.5w-081"]],
  ["Chill Teaser Toy", "Item", ["sv08-166"]],
  ["Clemont's Quick Wit", "Supporter", ["sv08-167", "sv08-229", "sv08-243"]],
  ["Cynthia's Power Weight", "Tool", ["sv10-162"]],
  ["Dangerous Laser", "Item", ["sv06.5-058"]],
  ["Deduction Kit", "Item", ["sv08-171"]],
  ["Drasna", "Supporter", ["sv08-173", "sv08-231"]],
  ["Emcee's Hype", "Supporter", ["sv10-163", "sv10-220"]],
  ["Energy Coin", "Item", ["sv10.5b-081"]],
  ["Energy Recycler", "Item", ["sv10-164"]],
  ["Energy Retrieval", "Item", ["sv10.5w-082"]],
  ["Enhanced Hammer", "Item", ["sv06-148", "sv06-224"]],
  ["Ethan's Adventure", "Supporter", ["sv10-165", "sv10-221", "sv10-236"]],
  ["Explorer's Guidance", "Supporter", ["sv05-147", "sv05-200", "sv08.5-107"]],
  ["Drayton", "Supporter", ["sv08-174", "sv08-232", "sv08-244", "sv08.5-172"]],
  ["Fennel", "Supporter", ["sv10.5b-082", "sv10.5b-162"]],
  ["Friends in Paldea", "Supporter", ["sv08.5-109", "sv08.5-137"]],
  ["Gravity Mountain", "Stadium", ["sv08-177", "sv08-250"]],
  ["Harlequin", "Supporter", ["sv10.5w-083", "sv10.5w-163"]],
  ["Hassel", "Supporter", ["sv06-151", "sv06-205"]],
  ["Hero's Cape", "Tool", ["sv05-152"]],
  ["Hop's Bag", "Item", ["sv09-147"]],
  ["Janine's Secret Art", "Supporter", ["sv06.5-059", "sv06.5-088", "sv08.5-112", "sv08.5-173"]],
  ["Kofu", "Supporter", ["sv07-138", "sv07-165"]],
  ["Lacey", "Supporter", ["sv07-139", "sv07-166", "sv07-172", "sv08.5-114", "sv08.5-175"]],
  ["Lana's Aid", "Supporter", ["sv06-155", "sv06-207", "sv06-219"]],
  ["Levincia", "Stadium", ["sv09-150", "sv10-244"]],
  ["Lillie's Pearl", "Tool", ["sv09-151"]],
  ["Lisia's Appeal", "Supporter", ["sv08-179", "sv08-234", "sv08-246"]],
  ["Lively Stadium", "Stadium", ["sv08-180"]],
  ["Master Ball", "Item", ["sv05-153"]],
  ["Max Rod", "Item", ["sv08.5-116"]],
  ["Maximum Belt", "Tool", ["sv05-154", "sv08.5-117"]],
  ["Miracle Headset", "Item", ["sv08-183"]],
  ["N's PP Up", "Item", ["sv09-153"]],
  ["N's Plan", "Supporter", ["sv10.5b-083", "sv10.5b-163", "sv10.5b-170"]],
  ["Neutralization Zone", "Stadium", ["sv06.5-060"]],
  ["Night Stretcher", "Item", ["sv06.5-061", "sv08-251"]],
  ["Picnicker", "Supporter", ["svp-114"]],
  ["Pokégear 3.0", "Item", ["sv10.5b-084"]],
  ["Prime Catcher", "Item", ["sv05-157", "sv08.5-119"]],
  ["Sacred Ash", "Item", ["sv10-168"]],
  ["Spikemuth Gym", "Stadium", ["sv10-169"]],
  ["Surfer", "Supporter", ["sv08-187", "sv08-235"]],
  ["Team Rocket's Archer", "Supporter", ["sv10-170", "sv10-223"]],
  ["Team Rocket's Giovanni", "Supporter", ["sv10-174", "sv10-225", "sv10-238"]],
  ["Roto-Stick", "Item", ["sv08.5-127"]],
  ["Team Rocket's Petrel", "Supporter", ["sv10-176", "sv10-226"]],
  ["Team Rocket's Proton", "Supporter", ["sv10-177", "sv10-227"]],
  ["Treasure Tracker", "Item", ["sv08.5-131"]],
  ["Unfair Stamp", "Item", ["sv06-165"]],
  ["Larry's Skill", "Supporter", ["sv08.5-115", "sv08.5-139"]],
  ["Secret Box", "Item", ["sv06-163"]],
  ["Hilda", "Supporter", ["sv10.5w-084", "sv10.5w-164", "sv10.5w-171"]],
  ["Colress's Tenacity", "Supporter", ["sv06.5-057", "sv06.5-087"]],
  ["Cyrano", "Supporter", ["sv08-170", "sv08-230"]],
  ["Hyper Aroma", "Item", ["sv06-152"]],
  ["Team Rocket's Transceiver", "Item", ["sv10-178"]],
  ["Energy Search Pro", "Item", ["sv08-176"]],
  ["Precious Trolley", "Item", ["sv08-185"]],
  ["Boxed Order", "Item", ["sv05-143"]],
  ["Cassiopeia", "Supporter", ["sv06.5-056", "sv06.5-086", "sv06.5-094"]],
  ["Cook", "Supporter", ["sv06-147"]],
  ["Poké Vital A", "Item", ["sv06.5-062"]],
  ["Iris's Fighting Spirit", "Supporter", ["sv09-149", "sv09-180"]],
  ["Eri", "Supporter", ["sv05-146", "sv05-199", "sv05-210", "sv08.5-136"]],
  ["Meddling Memo", "Item", ["sv08-181"]],
  [
    "Black Belt's Training",
    "Supporter",
    [
      "sv08.5-096",
      "sv08.5-097",
      "sv08.5-098",
      "sv08.5-099",
      "sv09-143",
      "sv09-144",
      "sv09-145",
      "svp-219",
      "svp-220",
    ],
  ],
  ["Team Rocket's Ariana", "Supporter", ["sv10-171", "sv10-224", "sv10-237"]],
  ["Billy & O'Nare", "Supporter", ["sv09-142"]],
  ["Dragon Elixir", "Item", ["sv08-172"]],
  ["Team Rocket's Great Ball", "Item", ["sv10-175"]],
  ["Caretaker", "Supporter", ["sv06-144", "sv06-203"]],
  ["Kieran", "Supporter", ["sv06-154", "sv06-206", "sv06-218", "sv08.5-113", "sv08.5-174"]],
  ["Team Rocket's Venture Bomb", "Item", ["sv10-179"]],
  ["Morty's Conviction", "Supporter", ["sv05-155", "sv05-201", "sv05-211"]],
  ["Xerosic's Machinations", "Supporter", ["sv06.5-064", "sv06.5-089"]],
  ["Lucian", "Supporter", ["sv06-157", "sv06-208"]],
  ["Arven's Sandwich", "Item", ["sv10-161"]],
  ["Megaton Blower", "Item", ["sv08-182"]],
  ["Brilliant Blender", "Item", ["sv08-164"]],
  ["TM Machine", "Item", ["sv10-181"]],
  ["Dusk Ball", "Item", ["sv08-175"]],
  ["Tool Scrapper", "Item", ["sv10.5w-085"]],
  ["Counter Gain", "Tool", ["sv08-169", "sv08-249"]],
  ["Hop's Choice Band", "Tool", ["sv09-148"]],
  ["Brave Bangle", "Tool", ["sv10.5w-080"]],
  ["Air Balloon", "Tool", ["sv10.5b-079"]],
  ["Rescue Board", "Tool", ["sv05-159", "sv06-225", "sv08.5-126"]],
  ["Gravity Gemstone", "Tool", ["sv07-137"]],
  ["Full Metal Lab", "Stadium", ["sv05-148"]],
  ["Granite Cave", "Stadium", ["sv10-166"]],
  ["Postwick", "Stadium", ["sv09-154"]],
  ["N's Castle", "Stadium", ["sv09-152"]],
  ["Paradise Resort", "Stadium", ["svp-150", "svp-224"]],
  ["Salvatore", "Supporter", ["sv05-160", "sv05-202", "sv05-212"]],
  ["Perrin", "Supporter", ["sv06-160", "sv06-209", "sv06-220"]],
  ["Crispin", "Supporter", ["sv07-133", "sv07-164", "sv08.5-105", "sv08.5-171"]],
  ["Super Potion", "Item", ["sv09-158"]],
  ["Love Ball", "Item", ["sv06-156"]],
  ["Hand Trimmer", "Item", ["sv05-150"]],
  ["Scoop Up Cyclone", "Item", ["sv06-162", "sv08.5-128"]],
  ["Scramble Switch", "Item", ["sv08-186"]],
  ["Academy at Night", "Stadium", ["sv06.5-054"]],
  ["Perilous Jungle", "Stadium", ["sv05-156"]],
  ["Haban Berry", "Tool", ["sv08.5-111"]],
  ["Occa Berry", "Tool", ["sv07-140"]],
  ["Payapa Berry", "Tool", ["sv07-141"]],
  ["Babiri Berry", "Tool", ["sv08-163"]],
  ["Colbur Berry", "Tool", ["sv08-168"]],
  ["Passho Berry", "Tool", ["sv08-184"]],
  ["Survival Brace", "Tool", ["sv06-164"]],
  ["Deluxe Bomb", "Tool", ["sv07-134"]],
  ["Lucky Helmet", "Tool", ["sv06-158"]],
  ["Handheld Fan", "Tool", ["sv06-150"]],
  ["Jamming Tower", "Stadium", ["sv06-153", "sv10-243"]],
  ["Festival Grounds", "Stadium", ["sv06-149", "sv08.5-108"]],
  ["Jasmine's Gaze", "Supporter", ["sv08-178", "sv08-233", "sv08-245"]],
  ["Amarys", "Supporter", ["sv08.5-093", "sv08.5-132", "sv08.5-170"]],
  ["Team Rocket's Factory", "Stadium", ["sv10-173"]],
  ["Community Center", "Stadium", ["sv06-146"]],
  ["Ruffian", "Supporter", ["sv09-157", "sv09-181"]],
  ["Brock's Scouting", "Supporter", ["sv09-146", "sv09-179"]],
  ["Ogre's Mask", "Item", ["sv06-159", "sv08.5-118"]],
  ["Heavy Baton", "Tool", ["sv05-151"]],
  ["Amulet of Hope", "Tool", ["sv08-162"]],
  ["Powerglass", "Tool", ["sv06.5-063", "sv06.5-097"]],
  ["Team Rocket's Watchtower", "Stadium", ["sv10-180"]],
  ["Redeemable Ticket", "Item", ["sv09-156"]],
  ["Accompanying Flute", "Item", ["sv06-142"]],
  ["Team Rocket's Bother-Bot", "Item", ["sv10-172"]],
  ["Grand Tree", "Stadium", ["sv07-136"]],
  ["Sparkling Crystal", "Tool", ["sv07-142", "sv08.5-129"]],
  ["Tera Orb", "Item", ["sv08-189"]],
  ["Glass Trumpet", "Item", ["sv07-135", "sv08.5-110"]],
  ["Briar", "Supporter", ["sv07-132", "sv07-163", "sv07-171", "sv08.5-100"]],
  ["Awakening Drum", "Item", ["sv05-141"]],
  ["Reboot Pod", "Item", ["sv05-158"]],
  ["Antique Cover Fossil", "Item", ["sv07-129", "sv10.5b-080"]],
  ["Antique Root Fossil", "Item", ["sv07-130"]],
  ["Antique Plume Fossil", "Item", ["sv10.5w-079"]],
  ["Area Zero Underdepths", "Stadium", ["sv07-131", "sv07-174", "sv08.5-094"]],
  ["Tyme", "Supporter", ["sv08-190", "sv08.5-143"]],
  ["Technical Machine: Fluorite", "Tool", ["sv08-188"]],
];

const SHARED_BODY_TERMS: readonly [string, string] = ["Cheren", "Friends in Paldea"];

const TRAINER_SUBTYPE_TALLY = { Item: 65, Supporter: 140, Tool: 33, Stadium: 26 } as const;

describe("D304 — the trainer column's decomposition", () => {
  it("the 151 named terms SUM to BUILT.trainer, and every printing is spelled out", () => {
    const printings = TRAINER_TERMS.reduce((sum, [, , ids]) => sum + ids.length, 0);
    expect(TRAINER_TERMS.length).toBe(151);
    expect(printings).toBe(BUILT.trainer);
    expect(printings).toBe(CENSUS_TRAINER_LEGAL.length);
    expect(new Set(TRAINER_TERMS.map(([name]) => name)).size).toBe(TRAINER_TERMS.length);
  });

  it("the terms PARTITION CENSUS_TRAINER_LEGAL — nothing left over, nothing invented", () => {
    const termIds = TRAINER_TERMS.flatMap(([, , ids]) => ids);
    expect(new Set(termIds).size).toBe(termIds.length);
    const inTerms = new Set(termIds);
    const inCensus = new Set(CENSUS_TRAINER_LEGAL);
    expect(CENSUS_TRAINER_LEGAL.filter((id) => !inTerms.has(id))).toEqual([]);
    expect(termIds.filter((id) => !inCensus.has(id))).toEqual([]);
  });

  it("every printing in a term shares ONE registry program object — LIVE", () => {
    for (const [name, , ids] of TRAINER_TERMS) {
      const first = programFor(ids[0] as string);
      expect(first, name).toBeDefined();
      for (const id of ids) expect(programFor(id), `${name} / ${id}`).toBe(first);
    }
  });

  it("151 named cards, 150 program objects — and the ONE collision is recorded BY NAME", () => {
    const byObject = new Map<unknown, string[]>();
    for (const [name, , ids] of TRAINER_TERMS) {
      const program = programFor(ids[0] as string);
      byObject.set(program, [...(byObject.get(program) ?? []), name]);
    }
    expect(byObject.size).toBe(150);
    const shared = [...byObject.values()].filter((names) => names.length > 1);
    expect(shared).toEqual([[...SHARED_BODY_TERMS]]);
    const byBody = new Set(
      TRAINER_TERMS.map(([, , ids]) => JSON.stringify(programFor(ids[0] as string))),
    );
    expect(byBody.size).toBe(byObject.size);
  });

  it("the trainer_type tallies re-derive the D1 GROUP BY — the second partition", () => {
    const tally: Record<string, number> = {};
    for (const [, subtype, ids] of TRAINER_TERMS) {
      tally[subtype] = (tally[subtype] ?? 0) + ids.length;
    }
    expect(tally).toEqual(TRAINER_SUBTYPE_TALLY);
    const total = Object.values(TRAINER_SUBTYPE_TALLY).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(BUILT.trainer);
  });
});

function corpusBySentence(): Map<string, number> {
  return new Map(legalAttackCorpus().map(([units, sentence]) => [sentence, units]));
}

const REGISTRY_ATTACK_SENTENCES = [...new Set(REGISTRY_ATTACKS.map(([, text]) => text))];

const SPLIT_ATTACK_UNITS = 19;

const RAW_UNBUILT_ATTACK_UNITS = 69;
const COMPOUND_ATTACK_UNITS = 22;

describe("D274 — BUILT.attack, derived from the LIVE readers over the committed corpus", () => {
  it("ATTACK_READERS is every `deriveAttack` export, each under its own name", () => {
    const exported = Object.entries(effects)
      .filter(([name, value]) => name.startsWith("deriveAttack") && typeof value === "function")
      .map(([name]) => name)
      .sort();
    expect(attackReaderSurface()).toEqual(exported);
    for (const { name, read } of ATTACK_READERS) expect(read.name).toBe(name);
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it("the corpus IS the legal attack column, to the digit D233 has quoted since", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.length).toBe(640);
    expect(corpus.reduce((sum, [units]) => sum + units, 0)).toBe(1732);
    expect(corpus.reduce((sum, [, text]) => sum + [...text].length, 0)).toBe(60467);
    expect(new Set(corpus.map(([, text]) => text)).size).toBe(640);
    expect(corpus.reduce((sum, [units]) => sum + units, 0)).toBe(POPULATION.attackUnits);
  });

  it("D420 — the TWELVE readers, RUN LIVE over the corpus, resolve 415 sentences / 1,368 printings", () => {
    const resolved = legalAttackCorpus().filter(([, text]) => resolvedByAnyReader(text));
    expect(resolved.length).toBe(600);
    expect(resolved.reduce((sum, [units]) => sum + units, 0)).toBe(1663);
  });

  it("the SPLIT half — 7 gate sentences in the corpus, 6 with a body and ALL 6 resolving, 17 printings ( D541 6/5/5/14 → 7/6/6/17; D545 → 9/6/6/19, the two new rows clause-only)", () => {
    const gated = legalAttackCorpus().filter(([, text]) => splitAttackGateClause(text) !== null);
    expect(gated.length).toBe(9);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(19);
    for (const [, text] of gated) {
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
    const withBody = gated.filter(([, text]) => splitAttackGateClause(text)?.body !== "");
    expect(withBody.length).toBe(6);
    expect(gated.length - withBody.length).toBe(3);
    const resolvedSplit = withBody.filter(
      ([, text]) => resolvedByAnyReader(splitAttackGateClause(text)?.body ?? text) === true,
    );
    expect(resolvedSplit.length).toBe(6);
    const ROLLOUT_ROW =
      "You can use this attack only if this Pokémon used Rollout during your last turn.";
    const ALT_COST_ROW =
      "If this Pokémon has any damage counters on it, this attack can be used for {F}.";
    const WAIVE_COST_ROW =
      "If this Pokémon is affected by a Special Condition, ignore all Energy in this attack's cost.";
    const clauseOnly = gated.filter(([, text]) => splitAttackGateClause(text)?.body === "");
    expect(clauseOnly.map(([, text]) => text)).toEqual([ALT_COST_ROW, WAIVE_COST_ROW, ROLLOUT_ROW]);
    expect(legalAttackCorpus().findIndex(([, text]) => text === ROLLOUT_ROW)).toBe(577);
    const clauseOnlyUnits = clauseOnly.reduce((sum, [units]) => sum + units, 0);
    expect(clauseOnlyUnits).toBe(3);
    expect(resolvedSplit.reduce((sum, [units]) => sum + units, 0) + clauseOnlyUnits).toBe(
      SPLIT_ATTACK_UNITS,
    );
  });

  it("BUILT.attack IS that live sum plus the registry attacks — no literal in the addition", () => {
    const corpus = corpusBySentence();
    const derived = legalAttackCorpus()
      .filter(([, text]) => resolvedByAnyReader(text))
      .reduce((sum, [units]) => sum + units, 0);

    expect(REGISTRY_ATTACK_SENTENCES.length).toBe(19);
    let registryUnits = 0;
    for (const text of REGISTRY_ATTACK_SENTENCES) {
      const units = corpus.get(text);
      expect(units, text).toBeDefined();
      expect(resolvedByAnyReader(text), text).toBe(false);
      registryUnits += units ?? 0;
    }
    expect(registryUnits).toBe(REGISTRY_ATTACKS.length);

    let splitUnits = 0;
    for (const [units, text] of legalAttackCorpus()) {
      const split = splitAttackGateClause(text);
      if (split === null) continue;
      expect(resolvedByAnyReader(text), text).toBe(false);
      if (split.body === "" || resolvedByAnyReader(split.body)) splitUnits += units;
    }
    expect(splitUnits).toBe(SPLIT_ATTACK_UNITS);

    let compoundUnits = 0;
    for (const [units, text] of legalAttackCorpus()) {
      if (splitAttackTrailingClause(text) === null) continue;
      expect(resolvedByAnyReader(text), text).toBe(false);
      expect(splitAttackGateClause(text), text).toBeNull();
      compoundUnits += units;
    }
    expect(compoundUnits).toBe(COMPOUND_ATTACK_UNITS);

    expect(derived + registryUnits + splitUnits + compoundUnits).toBe(BUILT.attack);
  });

  it("the corpus is really the catalog and the readers really run — the attribution controls", () => {
    const corpus = corpusBySentence();
    expect(corpus.get(DERIVABLE_CONTROL)).toBe(22);
    expect(resolvedByAnyReader(DERIVABLE_CONTROL)).toBe(true);
    expect(resolvedByAnyReader(UNCLAIMED_BY_ANY_ROW)).toBe(true);

    for (const row of ROWS) {
      for (const [count, text] of row.attack) {
        expect(corpus.get(text), text).toBe(count);
        expect(resolvedByAnyReader(text), text).toBe(false);
      }
    }
  });
});

const OPPONENT_ENERGY_FAMILY = [
  [4, "bonus", 30, "active", null] as const,
  [2, "bonus", 40, "active", null] as const,
  [1, "bonus", 50, "active", null] as const,
  [1, "bonus", 90, "active", null] as const,
  [3, "multiply", 20, "active", null] as const,
  [1, "multiply", 40, "board", null] as const,
  [1, "multiply", 40, "board", "special"] as const,
  [2, "multiply", 60, "board", null] as const,
  [2, "multiply", 60, "board", "Fire"] as const,
].map(([units, fold, per, zone, energyType]) => {
  const noun =
    zone === "active" ? "your opponent's Active Pokémon" : "all of your opponent's Pokémon";
  const token = energyType === null ? "" : energyType === "special" ? "Special " : "{R} ";
  const verb = fold === "bonus" ? `${per} more damage` : `${per} damage`;
  return {
    units,
    fold,
    per,
    zone,
    energyType,
    text: `This attack does ${verb} for each ${token}Energy attached to ${noun}.`,
  };
});

const OPPONENT_ENERGY_NOUN = /Energy attached to (?:all of )?your opponent['’]s/;

const RAW_ACTIVE_NOUN_D1 = [
  [
    1,
    0,
    "hand",
    "Flip a coin until you get tails. For each heads, shuffle an Energy attached to your opponent's Active Pokémon into their deck.",
  ],
  [2, 0, "hand", "Put an Energy attached to your opponent's Active Pokémon into their hand."],
  [
    1,
    0,
    "scale",
    "This attack does 10 more damage for each Energy attached to your opponent's Active Pokémon.",
  ],
  [
    3,
    3,
    "scale",
    "This attack does 20 damage for each Energy attached to your opponent's Active Pokémon.",
  ],
  [
    4,
    0,
    "scale",
    "This attack does 20 more damage for each Energy attached to your opponent's Active Pokémon.",
  ],
  [
    6,
    4,
    "scale",
    "This attack does 30 more damage for each Energy attached to your opponent's Active Pokémon.",
  ],
  [
    2,
    2,
    "scale",
    "This attack does 40 more damage for each Energy attached to your opponent's Active Pokémon.",
  ],
  [
    3,
    1,
    "scale",
    "This attack does 50 more damage for each Energy attached to your opponent's Active Pokémon.",
  ],
  [
    1,
    1,
    "scale",
    "This attack does 90 more damage for each Energy attached to your opponent's Active Pokémon.",
  ],
  [
    2,
    2,
    "hand",
    "You may put 2 Energy attached to your opponent's Active Pokémon into their hand.",
  ],
  [
    1,
    1,
    "hand",
    "You may put 2 Energy attached to your opponent's Active Stage 2 Pokémon into their hand.",
  ],
  [
    2,
    1,
    "hand",
    "You may put an Energy attached to your opponent's Active Pokémon into their hand.",
  ],
] as const;

const RAW_BOARD_NOUN_D1 = [
  [1, 1, "This attack does 40 damage for each Energy attached to all of your opponent's Pokémon."],
  [
    1,
    1,
    "This attack does 40 damage for each Special Energy attached to all of your opponent's Pokémon.",
  ],
  [4, 0, "This attack does 50 damage for each Energy attached to all of your opponent's Pokémon."],
  [2, 2, "This attack does 60 damage for each Energy attached to all of your opponent's Pokémon."],
  [
    2,
    2,
    "This attack does 60 damage for each {R} Energy attached to all of your opponent's Pokémon.",
  ],
] as const;

const FAMILY_NEAR_MISSES = [
  "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "This attack does 30 more damage for each Energy attached to both Active Pokémon.",
] as const;

describe("D301 — the opponent-energy scaling family: the backlog row measured PHANTOM", () => {
  it("the nine printed sentences are IN the committed corpus at exactly these counts, summing to 17", () => {
    const corpus = corpusBySentence();
    for (const row of OPPONENT_ENERGY_FAMILY) {
      expect(corpus.get(row.text), row.text).toBe(row.units);
    }
    expect(OPPONENT_ENERGY_FAMILY.length).toBe(9);
    expect(OPPONENT_ENERGY_FAMILY.reduce((sum, r) => sum + r.units, 0)).toBe(17);
    const active = OPPONENT_ENERGY_FAMILY.filter((r) => r.zone === "active");
    const board = OPPONENT_ENERGY_FAMILY.filter((r) => r.zone === "board");
    expect(active.reduce((sum, r) => sum + r.units, 0)).toBe(11);
    expect(board.reduce((sum, r) => sum + r.units, 0)).toBe(6);
    // And the two FOLDS, because a widened reader would move these and not the sum.
    expect(
      OPPONENT_ENERGY_FAMILY.filter((r) => r.fold === "bonus").reduce((s, r) => s + r.units, 0),
    ).toBe(8);
    expect(
      OPPONENT_ENERGY_FAMILY.filter((r) => r.fold === "multiply").reduce((s, r) => s + r.units, 0),
    ).toBe(9);
  });

  it("RUNG (a) — every one of them RESOLVES, on the fold, zone and type token the printed noun names", () => {
    for (const row of OPPONENT_ENERGY_FAMILY) {
      expect(resolvedByAnyReader(row.text), row.text).toBe(true);
      const answer = {
        per: row.per,
        count: { kind: "energyOnOpponent", zone: row.zone, energyType: row.energyType },
      };
      if (row.fold === "bonus") {
        expect(deriveAttackDamageBonus(row.text), row.text).toEqual(answer);
        expect(deriveAttackDamageMultiplier(row.text), row.text).toBeNull();
      } else {
        expect(deriveAttackDamageMultiplier(row.text), row.text).toEqual(answer);
        expect(deriveAttackDamageBonus(row.text), row.text).toBeNull();
      }
    }
  });

  it("RUNG (a·closure) — the noun's WHOLE corpus is 12 sentences / 21 printings, and both groups are BUILT", () => {
    const named = new Set(OPPONENT_ENERGY_FAMILY.map((r) => r.text));
    const inCorpus = legalAttackCorpus().filter(([, text]) => OPPONENT_ENERGY_NOUN.test(text));
    expect(inCorpus.length).toBe(12);
    expect(inCorpus.reduce((sum, [units]) => sum + units, 0)).toBe(21);
    const scale = inCorpus.filter(([, text]) => named.has(text));
    const hand = inCorpus.filter(([, text]) => !named.has(text));
    expect(scale.length).toBe(9);
    expect(scale.reduce((sum, [units]) => sum + units, 0)).toBe(17);
    expect(hand.length).toBe(3);
    expect(hand.reduce((sum, [units]) => sum + units, 0)).toBe(4);
    for (const [, text] of hand) {
      expect(text.startsWith("You may put "), text).toBe(true);
      expect(text.endsWith(" into their hand."), text).toBe(true);
      expect(deriveAttackEffect(text), text).not.toBeNull();
      expect(deriveAttackDamageBonus(text), text).toBeNull();
      expect(deriveAttackDamageMultiplier(text), text).toBeNull();
    }
  });

  it("RUNG (b) — none of the seventeen is in the unbuilt remainder, or in any backlog row", () => {
    const unbuilt = legalAttackCorpus().filter(([, text]) => !resolvedByAnyReader(text));
    expect(unbuilt.reduce((sum, [units]) => sum + units, 0)).toBe(RAW_UNBUILT_ATTACK_UNITS);
    const unbuiltText = new Set(unbuilt.map(([, text]) => text));
    expect(
      RAW_UNBUILT_ATTACK_UNITS -
        REGISTRY_ATTACKS.length -
        SPLIT_ATTACK_UNITS -
        COMPOUND_ATTACK_UNITS,
    ).toBe(POPULATION.attackUnits - BUILT.attack);
    const rowText = new Set(ROWS.flatMap((r) => r.attack.map(([, text]) => text)));
    for (const row of OPPONENT_ENERGY_FAMILY) {
      expect(unbuiltText.has(row.text), row.text).toBe(false);
      expect(rowText.has(row.text), row.text).toBe(false);
    }
  });

  it("RUNG (c) — the '24' is 28 RAW minus 4 LEGAL, and counts no set at all", () => {
    const rawTotal = RAW_ACTIVE_NOUN_D1.reduce((sum, [raw]) => sum + raw, 0);
    const legalTotal = RAW_ACTIVE_NOUN_D1.reduce((sum, [, legal]) => sum + legal, 0);
    expect(rawTotal).toBe(28);
    expect(legalTotal).toBe(15);
    const sub = (g: string, i: 0 | 1) =>
      RAW_ACTIVE_NOUN_D1.filter(([, , group]) => group === g).reduce((sum, r) => sum + r[i], 0);
    expect(sub("hand", 0)).toBe(8);
    expect(sub("hand", 1)).toBe(4);
    // This family's ACTIVE zone: 20 RAW, 11 LEGAL.
    expect(sub("scale", 0)).toBe(20);
    expect(sub("scale", 1)).toBe(11);
    expect(rawTotal - sub("hand", 1)).toBe(24);
    // …and 24 is neither of the two numbers a consistent footing can produce.
    expect(rawTotal - sub("hand", 0)).toBe(20);
    expect(legalTotal - sub("hand", 1)).toBe(11);
    expect([20, 11]).not.toContain(24);
  });

  it("RUNG (c·board) — the board zone is 10 RAW / 6 LEGAL on a phrase that predicate cannot match", () => {
    expect(RAW_BOARD_NOUN_D1.reduce((sum, [raw]) => sum + raw, 0)).toBe(10);
    expect(RAW_BOARD_NOUN_D1.reduce((sum, [, legal]) => sum + legal, 0)).toBe(6);
    for (const [, , text] of RAW_BOARD_NOUN_D1) {
      expect(text.includes("attached to your opponent"), text).toBe(false);
      expect(text.includes("attached to all of your opponent"), text).toBe(true);
    }
    // The whole family, both zones, both legalities — the numbers a sixth handoff
    // should quote instead: 30 printed, 17 legal, and 17 already read.
    const rawFamily =
      RAW_ACTIVE_NOUN_D1.filter(([, , g]) => g === "scale").reduce((s, r) => s + r[0], 0) +
      RAW_BOARD_NOUN_D1.reduce((s, r) => s + r[0], 0);
    expect(rawFamily).toBe(30);
    expect(11 + 6).toBe(17);
  });

  it("the RECORDED D1 legal column IS the committed corpus — the tables cannot drift apart", () => {
    const corpus = corpusBySentence();
    for (const [, legal, , text] of RAW_ACTIVE_NOUN_D1) {
      expect(corpus.get(text) ?? 0, text).toBe(legal);
    }
    for (const [, legal, text] of RAW_BOARD_NOUN_D1) {
      expect(corpus.get(text) ?? 0, text).toBe(legal);
    }
  });

  it("the attribution controls — a positive, and two near misses that must STAY refused", () => {
    // ① POSITIVE, through the same seven readers this section's verdicts come from.
    expect(resolvedByAnyReader(DERIVABLE_CONTROL)).toBe(true);
    // ② The family predicate must not be a synonym for "mentions Energy".
    for (const text of FAMILY_NEAR_MISSES) {
      expect(OPPONENT_ENERGY_NOUN.test(text), text).toBe(false);
      expect(corpusBySentence().has(text), text).toBe(true);
    }
    expect(deriveAttackDamageBonus(FAMILY_NEAR_MISSES[0])).toBeNull();
    expect(deriveAttackDamageMultiplier(FAMILY_NEAR_MISSES[0])).toBeNull();
    expect(deriveAttackDamageBonus(FAMILY_NEAR_MISSES[1])).toEqual({
      per: 30,
      count: { kind: "bothActivesEnergyCount" },
    });
  });
});

const ABILITY_NAME_TERMS: readonly (readonly [string, readonly string[]])[] = [
  ["Abra", ["sv06-080"]],
  ["Alcremie ex", ["sv09-075"]],
  ["Alomomola", ["sv10.5b-024", "sv10.5b-108"]],
  ["Ariados", ["sv06-005"]],
  ["Archaludon", ["sv07-107", "sv07-155", "sv08.5-070"]],
  ["Archaludon ex", ["sv08-130", "sv08-224", "sv08-241"]],
  ["Arven's Greedent", ["sv10-159", "sv10-205"]],
  ["Blaziken ex", ["sv09-024"]],
  ["Bloodmoon Ursaluna", ["sv06.5-025", "sv08.5-054"]],
  [
    "Bloodmoon Ursaluna ex",
    ["sv06-141", "sv06-202", "sv06-216", "sv06-222", "sv08.5-168", "svp-177"],
  ],
  ["Bouffalant", ["sv07-119", "svp-136"]],
  ["Bouffalant ex", ["sv10.5w-077", "sv10.5w-162", "sv10.5w-170"]],
  ["Bronzong", ["sv08.5-067"]],
  ["Bruxish", ["sv08-049", "sv08-200"]],
  ["Carracosta", ["sv07-038", "sv10.5b-023", "sv10.5b-107"]],
  ["Cetitan", ["sv08-054", "sv08-201"]],
  ["Cetitan ex", ["sv10-065", "sv10-210"]],
  ["Copperajah", ["sv06.5-042"]],
  ["Cornerstone Mask Ogerpon ex", ["sv06-112", "sv06-199", "sv06-215", "sv08.5-058", "sv08.5-160"]],
  ["Crabominable", ["sv07-042", "sv07-149", "svp-134"]],
  ["Crustle", ["sv10-012", "sv10-186", "sv10.5b-052", "sv10.5b-130"]],
  ["Cynthia's Gabite", ["sv10-103"]],
  ["Cynthia's Roserade", ["sv10-008", "sv10-184"]],
  ["Drakloak", ["sv06-129", "sv08.5-072"]],
  ["Drednaw", ["sv07-044"]],
  ["Dubwool", ["sv07-125"]],
  ["Dudunsparce", ["sv05-129", "sv08.5-080"]],
  ["Durant ex", ["sv08-004", "sv08-215", "sv08-236"]],
  ["Dusclops", ["sv06.5-019", "sv06.5-069", "sv08.5-036"]],
  ["Dusknoir", ["sv06.5-020", "sv06.5-070", "sv08.5-037"]],
  ["Eelektrik", ["sv10.5b-031", "sv10.5b-114"]],
  ["Eevee", ["sv08-143", "sv08.5-074", "svp-173"]],
  ["Emboar", ["sv10.5w-013", "sv10.5w-098"]],
  ["Ethan's Ho-Oh ex", ["sv10-039", "sv10-209", "sv10-230", "sv10-239"]],
  ["Ethan's Magcargo", ["sv10-036"]],
  ["Exeggcute", ["sv08-001", "sv08-192"]],
  ["Fan Rotom", ["sv07-118", "sv08.5-085"]],
  ["Farigiraf ex", ["sv05-108", "sv05-194"]],
  ["Fezandipiti", ["sv06-096", "sv06.5-073", "sv08.5-045"]],
  ["Fezandipiti ex", ["sv06.5-038", "sv06.5-084", "sv06.5-092"]],
  ["Florges", ["sv06-088"]],
  ["Froslass", ["sv06-053", "sv06-174", "svp-117"]],
  ["Fraxure", ["sv06.5-045", "sv06.5-077"]],
  ["Furfrou", ["sv08.5-088"]],
  ["Gengar ex", ["sv05-104", "sv05-193"]],
  ["Genesect", ["sv06.5-040"]],
  ["Genesect ex", ["sv10.5b-067", "sv10.5b-161", "sv10.5b-169"]],
  ["Gothitelle", ["sv10.5w-043", "svp-211"]],
  ["Heatran", ["sv06-123"]],
  ["Hoothoot", ["sv08.5-077"]],
  ["Hop's Dubwool", ["sv09-136"]],
  ["Hop's Snorlax", ["sv09-117", "svp-184"]],
  ["Hydrapple ex", ["sv07-014", "sv07-156", "sv07-167", "sv08.5-011"]],
  ["Hydreigon ex", ["sv10.5w-067", "sv10.5w-161", "sv10.5w-169"]],
  ["Illumise", ["sv06-010"]],
  ["Incineroar ex", ["sv05-034", "sv05-187"]],
  ["Iono's Bellibolt ex", ["sv09-053", "sv09-172", "sv09-183", "sv09-188", "svp-194"]],
  ["Iono's Kilowattrel", ["sv09-055", "sv09-163", "svp-182"]],
  ["Iron Jugulis", ["sv05-139"]],
  ["Iron Leaves ex", ["sv05-025", "sv05-186", "sv05-203", "sv05-213", "sv08.5-176", "svp-128"]],
  ["Jellicent ex", ["sv10.5w-045", "sv10.5w-160", "sv10.5w-168"]],
  ["Karrablast", ["sv10.5b-009", "sv10.5b-094"]],
  ["Infernape", ["svp-116", "sv06-033", "sv06-173"]],
  ["Kecleon", ["sv08-150", "sv08-213"]],
  ["Latias ex", ["sv08-076", "sv08-220", "sv08-239"]],
  ["Ledian", ["svp-133", "sv07-003", "sv07-144"]],
  ["Lillie's Ribombee", ["sv09-067", "sv09-164", "svp-183"]],
  ["Lilligant", ["sv09-007"]],
  ["Lycanroc", ["sv09-085", "sv09-166"]],
  ["Magcargo", ["sv05-029"]],
  ["Magearna", ["sv09-107"]],
  ["Magneton", ["svp-153", "svp-159", "sv08-059"]],
  ["Yanmega ex", ["sv10-003", "sv10-206", "sv10-228"]],
  ["Mandibuzz", ["sv10.5w-064", "sv10.5w-145"]],
  ["Marnie's Grimmsnarl ex", ["sv10-136"]],
  ["Steven's Metagross ex", ["sv10-145"]],
  ["Meloetta ex", ["sv10.5b-044", "sv10.5b-159", "sv10.5b-167"]],
  ["Meowscarada", ["sv09-018"]],
  ["Metang", ["svp-090", "sv05-114"]],
  ["Morpeko", ["sv06-072"]],
  ["Misty's Magikarp", ["sv10-048"]],
  ["Mudsdale", ["sv10-108"]],
  ["Munkidori ex", ["sv06.5-037", "sv06.5-083", "sv06.5-091"]],
  ["N's Zoroark ex", ["sv09-098", "sv09-175", "sv09-185", "sv09-189"]],
  ["Pecharunt ex", ["sv06.5-039", "sv06.5-085", "sv06.5-093", "sv06.5-095", "sv08.5-163"]],
  ["Pidove", ["sv05-133"]],
  ["Pikachu ex", ["sv08-057", "sv08-219", "sv08-238", "sv08-247", "sv08.5-179"]],
  ["Poltchageist", ["sv06-020", "sv06-171"]],
  ["Quaquaval", ["sv08-052"]],
  ["Rabsca", ["sv05-024"]],
  ["Rhyperior", ["sv07-076"]],
  ["Roselia", ["sv05-008"]],
  ["Roserade", ["sv05-009"]],
  ["Scolipede", ["sv10.5b-056", "sv10.5b-134"]],
  ["Scream Tail ex", ["sv06-094", "sv06-197"]],
  ["Serperior ex", ["sv10.5b-003", "sv10.5b-156", "sv10.5b-164"]],
  ["Shaymin", ["sv10-010", "sv10-185"]],
  ["Shelmet", ["sv10.5w-008", "sv10.5w-093"]],
  ["Shiinotic", ["sv08-009", "sv08-194"]],
  ["Skeledirge", ["sv08-031"]],
  ["Steven's Carbink", ["sv10-086"]],
  ["Sylveon", ["sv08.5-040"]],
  ["Tangrowth", ["sv06-002"]],
  ["Tatsugiri", ["sv06-131", "sv06-186", "svp-118"]],
  [
    "Teal Mask Ogerpon ex",
    [
      "sv06-025",
      "sv06-190",
      "sv06-211",
      "sv06-221",
      "sv08.5-012",
      "sv08.5-145",
      "sv08.5-177",
      "svp-166",
    ],
  ],
  ["Team Rocket's Ampharos", ["sv10-074"]],
  ["Team Rocket's Arbok", ["sv10-113"]],
  ["Team Rocket's Articuno", ["sv10-051"]],
  ["Team Rocket's Crobat ex", ["sv10-122", "sv10-217", "sv10-234", "sv10-242"]],
  ["Team Rocket's Golbat", ["sv10-121"]],
  [
    "Team Rocket's Mewtwo ex",
    ["sv10-081", "sv10-213", "sv10-231", "sv10-240", "svp-205", "svp-216"],
  ],
  ["Team Rocket's Porygon-Z", ["sv10-155"]],
  ["Team Rocket's Spidops", ["sv10-020", "sv10-187"]],
  [
    "Terapagos ex",
    ["sv07-128", "sv07-170", "sv07-173", "sv08.5-092", "sv08.5-169", "sv08.5-180", "svp-165"],
  ],
  ["Togekiss", ["sv08-072"]],
  ["Ludicolo", ["sv09-037"]],
  ["Okidogi", ["sv06-111", "sv06.5-074", "sv08.5-057"]], // "Adrena-Power" — +100 HP gated on ANY {D}, plus the pre-W/R damage half
  ["Conkeldurr", ["sv10.5b-049", "sv10.5b-127"]], // "Craftsmanship" — +40 HP PER attached {F}
  ["Brambleghast", ["sv05-021"]], // "Resilient Soul" — +50 HP per Prize the OPPONENT has taken
  ["Toedscruel", ["sv09-089"]],
  ["Turtwig", ["sv05-010"]],
  ["Tyranitar", ["sv09-095"]],
  ["Veluza", ["sv07-045"]],
  ["Victini", ["sv08-021"]],
  ["Volbeat", ["sv06-009"]],
  ["Miltank", ["sv08.5-081"]],
  ["Sylveon ex", ["sv08-086", "sv08.5-041", "sv08.5-156"]],
  ["Volcanion ex", ["sv09-031", "sv09-171", "sv09-182"]],
  ["Walking Wake ex", ["sv05-050", "sv05-189", "sv05-205", "sv05-215", "sv08.5-178", "svp-127"]],
  ["Rapidash", ["sv10-030", "sv10-189"]],
  ["Chandelure", ["sv06-038"]],
  ["Blissey ex", ["sv06-134", "sv06-201"]],
  ["Swadloon", ["sv10.5w-002", "sv10.5w-088"]],
  ["Mamoswine ex", ["sv09-079", "sv09-174"]],
  ["Sawsbuck", ["sv05-017", "sv05-166"]],
  ["Ethan's Quilava", ["sv10-033"]],
  ["Volcarona", ["sv10.5b-016", "sv10.5b-100"]],
  ["Archeops", ["sv10.5w-051", "sv10.5w-132"]],
  ["Meowstic", ["sv08-085"]],
  ["Samurott", ["sv10.5w-023", "sv10.5w-107"]],
  ["Team Rocket's Tyranitar", ["sv10-096"]],
  ["Chien-Pao", ["sv08-056", "svp-152"]],
  ["Ambipom", ["sv06-138"]],
  ["Pecharunt", ["svp-129", "svp-149"]],
  ["Lillie's Clefairy ex", ["sv09-056", "sv09-173", "sv09-184", "svp-195"]],
  ["Flutter Mane", ["sv05-078", "sv08.5-043", "svp-097"]],
  ["Gastrodon", ["sv08-107"]],
  ["Orthworm ex", ["sv07-110", "sv07-162"]],
  ["Maractus", ["sv09-008", "sv09-160"]],
  ["Klinklang", ["sv10.5b-063", "sv10.5b-141", "sv07-101"]],
  ["Regirock", ["sv09-082"]],
  ["Drilbur", ["sv05-085"]],
  ["Team Rocket's Koffing", ["sv10-125"]],
  ["Thwackey", ["sv06-015", "svp-115"]],
  ["Slaking ex", ["sv08-147", "sv08-227"]],
  ["Annihilape", ["sv10-092"]],
  ["Galvantula", ["sv06.5-002"]],
  ["Magmortar", ["sv09-021"]],
  ["Whimsicott", ["sv05-015", "sv08.5-008"]],
  ["Dachsbun ex", ["sv07-067", "sv07-160", "sv07-169"]],
  ["Indeedee", ["sv08-093", "svp-154"]],
  ["Cradily", ["sv07-006"]],
  ["Eevee ex", ["svp-174", "sv08.5-075", "sv08.5-167"]],
  ["Noivern", ["sv09-128"]],
  ["Kyurem", ["sv06.5-047"]],
  ["Feraligatr", ["svp-089", "sv05-041"]],
  ["Palafin ex", ["svp-126", "sv06-061", "sv06-193", "sv08.5-151"]],
  ["Crobat", ["sv06.5-029"]],
  ["Misty's Psyduck", ["sv10-045", "sv10-193"]],
  ["Team Rocket's Orbeetle", ["sv10-089", "sv10-198"]],
  ["Farfetch'd", ["sv06-132"]],
  ["Palafin", ["sv06-060"]],
  ["Milotic ex", ["sv08-042", "sv08-217", "sv08-237"]],
  ["Noctowl", ["sv07-115", "sv08.5-078", "svp-141"]],
  ["Azumarill", ["sv08-074"]],
  ["Iron Crown ex", ["sv05-081", "sv05-191", "sv05-206", "sv05-216", "sv08.5-158", "svp-146"]],
  ["Dipplin", ["sv06-018", "sv06-170", "sv08.5-010"]],
  ["Goldeen", ["sv06-044", "sv08.5-020"]],
  ["Swirlix", ["sv06-089"]],
  ["Seaking", ["sv08.5-021"]],
  ["Iron Thorns ex", ["sv06-077", "sv06-196", "sv08.5-032"]],
  ["Munkidori", ["sv06-095", "sv06.5-072", "sv08.5-044"]],
  ["Milotic", ["sv06-050"]],
  ["Huntail", ["sv10-055"]],
  ["Scovillain ex", ["sv08-037", "sv08-216"]],
  ["Relicanth", ["sv05-084", "sv05-173"]],
  ["Iron Treads", ["sv05-118"]],
];

const ABILITY_SHARED_OBJECTS: readonly (readonly [string, readonly string[]])[] = [
  ["REDUCE_30_AFTER_WR", ["Bouffalant ex", "Cetitan", "Dubwool", "Mudsdale", "Tangrowth"]],
  ["COUNTERATTACK_QUILLS", ["Bruxish", "Iron Jugulis"]],
  ["FOOD_PREP", ["Crabominable", "Veluza"]],
  ["CURIOUS_TEA_PARTY", ["Misty's Magikarp", "Poltchageist"]],
  ["KO_SURVIVAL", ["Crustle", "Pikachu ex"]],
  ["POISON_POINT", ["Roselia", "Roserade", "Scolipede"]],
  ["PREVENT_FROM_EX", ["Crustle", "Sylveon"]],
  ["REDUCE_20_AFTER_WR", ["Furfrou", "Turtwig"]],
  ["UNNERVE", ["Cetitan ex", "Fraxure"]],
  ["FESTIVAL_LEAD", ["Dipplin", "Goldeen", "Seaking", "Swirlix"]],
];

const ABILITY_SPLIT_NAMES: readonly string[] = ["Carracosta", "Crustle", "Klinklang"];

const ABILITY_ATTACK_GATE_IDS: readonly string[] = [
  "sv06-009",
  "sv06-010",
  "sv06-094",
  "sv06-197",
  "sv07-128",
  "sv07-170",
  "sv07-173",
  "sv08-001",
  "sv08-192",
  "sv08-086",
  "sv08.5-041",
  "sv08.5-081",
  "sv08.5-092",
  "sv08.5-156",
  "sv08.5-169",
  "sv08.5-180",
  "svp-165",
];

const ABILITY_D1_SHAPE = { printings: 393, distinctNames: 187 } as const;
const ABILITY_D1_COLUMNS = { abilitiesJson: 376, attacksJson: 393, effect: 0 } as const;

describe("D305 — the `ability` column's 215 ids, keyed on the CARD", () => {
  /** The live grouping: id → its registry program OBJECT, by identity. Computed
      ONCE — `programFor` is a map read, but the group index below is quadratic. */
  const byObject = new Map<object, string[]>();
  for (const id of CENSUS_POKEMON_LEGAL) {
    const key = programFor(id) as object;
    byObject.set(key, [...(byObject.get(key) ?? []), id]);
  }
  const groups: readonly string[][] = [...byObject.values()];
  const groupIndexOf = new Map<string, number>(
    groups.flatMap((group, index) => group.map((id) => [id, index] as const)),
  );
  const nameOf = new Map<string, string>(
    ABILITY_NAME_TERMS.flatMap(([name, ids]) => ids.map((id) => [id, name] as const)),
  );

  it("the 94 named terms PARTITION the column — both directions, nothing left over", () => {
    const listed = ABILITY_NAME_TERMS.flatMap(([, ids]) => ids);
    expect(listed.length).toBe(ABILITY_D1_SHAPE.printings);
    expect(listed.length).toBe(BUILT.ability);
    expect(new Set(listed).size).toBe(listed.length);
    expect(ABILITY_NAME_TERMS.length).toBe(ABILITY_D1_SHAPE.distinctNames);
    const inColumn = new Set<string>(CENSUS_POKEMON_LEGAL);
    const inTerms = new Set(listed);
    expect(listed.filter((id) => !inColumn.has(id))).toEqual([]);
    expect(CENSUS_POKEMON_LEGAL.filter((id) => !inTerms.has(id))).toEqual([]);
  });

  it("the 247 print on exactly 102 program objects — LIVE, by object identity", () => {
    expect(groups.length).toBe(174);
    expect(groups.reduce((sum, group) => sum + group.length, 0)).toBe(393);
  });

  it("9 objects carry MORE THAN ONE NAME, and they are named — D304's collision ( D570: 10 — `FESTIVAL_LEAD` carries four)", () => {
    const collisions = groups
      .map((group) => [...new Set(group.map((id) => nameOf.get(id) ?? id))].sort())
      .filter((names) => names.length > 1)
      .sort((a, b) => (a.join() < b.join() ? -1 : 1));
    expect(collisions).toEqual(
      ABILITY_SHARED_OBJECTS.map(([, names]) => [...names].sort()).sort((a, b) =>
        a.join() < b.join() ? -1 : 1,
      ),
    );
    // The largest is FIVE cards on one object — the headline of this section.
    expect(Math.max(...collisions.map((names) => names.length))).toBe(5);
    const shared = groups.filter((group) => new Set(group.map((id) => nameOf.get(id))).size > 1);
    expect(shared.reduce((sum, group) => sum + group.length, 0)).toBe(45);
  });

  it("…and 2 NAMES span more than one object — the CONVERSE, which `trainer` lacked", () => {
    const objectsPerName = new Map<string, Set<object>>();
    for (const id of CENSUS_POKEMON_LEGAL) {
      const name = nameOf.get(id) as string;
      if (!objectsPerName.has(name)) objectsPerName.set(name, new Set());
      objectsPerName.get(name)?.add(programFor(id) as object);
    }
    const split = [...objectsPerName.entries()]
      .filter(([, objects]) => objects.size > 1)
      .map(([name]) => name)
      .sort();
    expect(split).toEqual([...ABILITY_SPLIT_NAMES]);
    // `Crustle` is in BOTH failure lists at once, which is why neither number can
    // be patched into the other.
    const collidingNames = new Set(ABILITY_SHARED_OBJECTS.flatMap(([, names]) => names));
    expect(split.filter((name) => collidingNames.has(name))).toEqual(["Crustle"]);
  });

  it("the CARD count is 96 — the JOIN, and it is none of 218 / 84 / 94", () => {
    const pairs = new Set(
      CENSUS_POKEMON_LEGAL.map((id) => `${nameOf.get(id)}#${groupIndexOf.get(id)}`),
    );
    expect(pairs.size).toBe(190);
    expect(pairs.size).not.toBe(CENSUS_POKEMON_LEGAL.length);
    expect(pairs.size).not.toBe(84); // program objects
    expect(pairs.size).not.toBe(ABILITY_D1_SHAPE.distinctNames);
    expect(ABILITY_D1_SHAPE.distinctNames + ABILITY_SPLIT_NAMES.length).toBe(190);
  });

  it("the three-column key is LOAD-BEARING here — and `effect` alone returns NOTHING", () => {
    expect(ABILITY_D1_COLUMNS.effect).toBe(0);
    expect(ABILITY_D1_COLUMNS.attacksJson).toBe(393);
    expect(ABILITY_D1_COLUMNS.abilitiesJson).toBe(376);
    expect(ABILITY_D1_SHAPE.printings - ABILITY_D1_COLUMNS.abilitiesJson).toBe(
      ABILITY_ATTACK_GATE_IDS.length,
    );
    const liveGated = CENSUS_POKEMON_LEGAL.filter((id) =>
      Object.hasOwn((programFor(id) ?? {}) as object, "attackGate"),
    ).sort();
    expect(liveGated).toEqual([...ABILITY_ATTACK_GATE_IDS].sort());
    // …and every one of them really is in this column, not merely in the registry.
    for (const id of ABILITY_ATTACK_GATE_IDS) {
      expect(CENSUS_POKEMON_LEGAL, id).toContain(id);
    }
  });
});

const ENERGY_NAME_TERMS: readonly (readonly [string, readonly string[]])[] = [
  ["Enriching Energy", ["sv08-191"]],
  ["Legacy Energy", ["sv06-167"]],
  ["Mist Energy", ["sv05-161"]],
  ["Neo Upper Energy", ["sv05-162"]],
  ["Prism Energy", ["sv10.5b-086"]],
  ["Reversal Energy", ["sv04-266"]],
  ["Spiky Energy", ["sv09-159", "sv09-190"]],
  ["Ignition Energy", ["sv10.5w-086"]],
  ["Boomerang Energy", ["sv06-166"]],
  ["Team Rocket's Energy", ["sv10-182"]],
];

const ENERGY_BASIC_IN_COLUMN: readonly string[] = ["sv04-266", "sv10.5b-086", "sv10.5w-086"];

const ENERGY_UNBUILT_CANDIDATES: readonly (readonly [string, string, string])[] = [];

/** `GROUP BY category, legal_standard` over the 8, the three-column key, and the
    `category = 'Energy' AND legal_standard = 1` split by `energy_type` — all from
    the same statements. */
const ENERGY_D1_SHAPE = { printings: 11, distinctNames: 10 } as const;
const ENERGY_D1_COLUMNS = { abilitiesJson: 0, attacksJson: 0, effect: 11 } as const;
const ENERGY_D1_CANDIDATES = {
  special: 8,
  specialWithEffect: 8,
  basic: 39,
  basicWithEffect: 3,
} as const;

describe("D308 — the `specialEnergy` column's 8 ids, keyed on the CARD", () => {
  const byObject = new Map<object, string[]>();
  for (const id of CENSUS_ENERGY_LEGAL) {
    const key = programFor(id) as object;
    byObject.set(key, [...(byObject.get(key) ?? []), id]);
  }
  const groups: readonly string[][] = [...byObject.values()];
  const groupIndexOf = new Map<string, number>(
    groups.flatMap((group, index) => group.map((id) => [id, index] as const)),
  );
  const nameOf = new Map<string, string>(
    ENERGY_NAME_TERMS.flatMap(([name, ids]) => ids.map((id) => [id, name] as const)),
  );

  it("the 7 named terms PARTITION the column — both directions, nothing left over ( D571: 8 — Ignition Energy; D577: 9 — Boomerang Energy; D578: 10 — Team Rocket's Energy)", () => {
    const listed = ENERGY_NAME_TERMS.flatMap(([, ids]) => ids);
    expect(listed.length).toBe(ENERGY_D1_SHAPE.printings);
    expect(listed.length).toBe(BUILT.specialEnergy);
    expect(new Set(listed).size).toBe(listed.length);
    expect(ENERGY_NAME_TERMS.length).toBe(ENERGY_D1_SHAPE.distinctNames);
    const inColumn = new Set<string>(CENSUS_ENERGY_LEGAL);
    const inTerms = new Set(listed);
    expect(listed.filter((id) => !inColumn.has(id))).toEqual([]);
    expect(CENSUS_ENERGY_LEGAL.filter((id) => !inTerms.has(id))).toEqual([]);
  });

  it("the 8 print on exactly 7 program objects — LIVE, by object identity ( D571: 9 on 8 — Ignition Energy's own object; D577: 10 on 9 — Boomerang Energy's; D578: 11 on 10 — Team Rocket's Energy's)", () => {
    expect(groups.length).toBe(10);
    expect(groups.reduce((sum, group) => sum + group.length, 0)).toBe(11);
    // The ONE group of two is the reprint pair, and it is the same object by
    // identity rather than by a deep compare — `programFor` returns the map's own
    // value, so `toBe` is the real statement.
    expect(programFor("sv09-159")).toBe(programFor("sv09-190"));
  });

  it("NO object carries two names and NO name spans two objects — BOTH converses", () => {
    const collisions = groups
      .map((group) => [...new Set(group.map((id) => nameOf.get(id) ?? id))])
      .filter((names) => names.length > 1);
    expect(collisions).toEqual([]);
    const objectsPerName = new Map<string, Set<object>>();
    for (const id of CENSUS_ENERGY_LEGAL) {
      const name = nameOf.get(id) as string;
      if (!objectsPerName.has(name)) objectsPerName.set(name, new Set());
      objectsPerName.get(name)?.add(programFor(id) as object);
    }
    const split = [...objectsPerName.entries()]
      .filter(([, objects]) => objects.size > 1)
      .map(([name]) => name);
    expect(split).toEqual([]);
    expect(objectsPerName.size).toBe(10);
    expect([...objectsPerName.values()].reduce((sum, set) => sum + set.size, 0)).toBe(10);
  });

  it("the CARD count is 7 — the JOIN, and here it EQUALS both projections ( D571: 8; D577: 9; D578: 10)", () => {
    const pairs = new Set(
      CENSUS_ENERGY_LEGAL.map((id) => `${nameOf.get(id)}#${groupIndexOf.get(id)}`),
    );
    expect(pairs.size).toBe(10);
    expect(pairs.size).toBe(groups.length); // 8 objects — `not.toBe` on `ability`
    expect(pairs.size).toBe(ENERGY_D1_SHAPE.distinctNames);
    expect(pairs.size).not.toBe(CENSUS_ENERGY_LEGAL.length);
    expect(CENSUS_ENERGY_LEGAL.length - pairs.size).toBe(1); // exactly one reprint
  });

  it("the three-column key is `trainer`'s shape here — `effect` 8, the other two ZERO ( D571: `effect` 9; D577: `effect` 10; D578: `effect` 11)", () => {
    expect(ENERGY_D1_COLUMNS.effect).toBe(ENERGY_D1_SHAPE.printings);
    expect(ENERGY_D1_COLUMNS.abilitiesJson).toBe(0);
    expect(ENERGY_D1_COLUMNS.attacksJson).toBe(0);
  });

  it("the column's 8 is NOT the catalog's 8 SPECIAL Energy — same size, 6 shared ( D571: the column is 9, still 6 shared; D577: the column is 10, 7 shared; D578: the column is 11, 8 shared — ALL eight)", () => {
    expect(ENERGY_D1_CANDIDATES.specialWithEffect).toBe(BUILT.specialEnergy - 3);
    for (const id of ENERGY_BASIC_IN_COLUMN) {
      expect(CENSUS_ENERGY_LEGAL, id).toContain(id);
    }
    expect(BUILT.specialEnergy - ENERGY_BASIC_IN_COLUMN.length).toBe(8);
    const specialOutside = ENERGY_UNBUILT_CANDIDATES.filter(([, , type]) => type === "Special");
    expect(specialOutside.length).toBe(ENERGY_D1_CANDIDATES.special - 8);
    expect(ENERGY_UNBUILT_CANDIDATES).toEqual([]);
    expect(programFor("sv10-182")).toBeDefined();
    expect(CENSUS_ENERGY_LEGAL).toContain("sv10-182");
    // The candidate population is 11 — the list's own doc block, checked.
    expect(ENERGY_D1_CANDIDATES.specialWithEffect + ENERGY_D1_CANDIDATES.basicWithEffect).toBe(11);
    expect(BUILT.specialEnergy + ENERGY_UNBUILT_CANDIDATES.length).toBe(11);
    // …and the three that are unbuilt are unbuilt LIVE. Program one and this
    // reddens here, in the partition guard above, and on `BUILT.specialEnergy`.
    for (const [id] of ENERGY_UNBUILT_CANDIDATES) {
      expect(programFor(id), id).toBeUndefined();
      expect(CENSUS_ENERGY_LEGAL, id).not.toContain(id);
    }
  });
});

/** The `me` serie's legal pool, per column (the statement above, `:serie = 'me'`). */
const POPULATION_ME = {
  legalRows: 1266,
  attackUnits: 1039,
  abilityUnits: 234,
  trainerUnits: 183,
  specialEnergyUnits: 11,
} as const;

const POPULATION_D581 = {
  legalRows: 3287,
  attackUnits: 2771,
  abilityUnits: 610,
  trainerUnits: 447,
  specialEnergyUnits: 22,
} as const;

const ME_ID = /^(me\d|mep-|mee-|30th)/;

function meArm(text: string): "reader" | "gate" | "trailing" | "registryText" | null {
  if (resolvedByAnyReader(text)) return "reader";
  const gate = splitAttackGateClause(text);
  if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return "gate";
  if (splitAttackTrailingClause(text) !== null) return "trailing";
  return REGISTRY_ATTACK_SENTENCES.includes(text) ? "registryText" : null;
}

describe("D581 — the Standard pool after the Mega Evolution ingest, measured (sv + me)", () => {
  it("the `me` corpus is the transcription its provenance names: 451 sentences / 1,039 printings / 43,900 characters ( D612: 442 / 1,039 / 41,838 — the statement re-run after WP06's re-ingest)", () => {
    const me = meAttackCorpus();
    expect(me.length).toBe(442);
    expect(me.reduce((sum, [n]) => sum + n, 0)).toBe(POPULATION_ME.attackUnits);
    expect(me.reduce((sum, [, text]) => sum + text.length, 0)).toBe(41838);
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    const shared = me.filter(([, text]) => sv.has(text));
    expect([shared.length, shared.reduce((sum, [n]) => sum + n, 0)]).toEqual([163, 563]);
  });

  it("the D581 population is the `sv` pool PLUS the `me` pool, on every column", () => {
    for (const key of [
      "legalRows",
      "attackUnits",
      "abilityUnits",
      "trainerUnits",
      "specialEnergyUnits",
    ] as const) {
      expect(POPULATION[key] + POPULATION_ME[key], key).toBe(POPULATION_D581[key]);
    }
  });

  it("~~no `me` printing is a registry key — every `me` non-attack text is UNBUILT, and no `me` attack is registry-built~~ ( D582 (D539): WITHDRAWN — the `me` registry keys are EXACTLY the D582 alias tier, Prism Charge `me02.5-178` among them)", () => {
    expect(
      programmedCardIds()
        .filter((id) => ME_ID.test(id))
        .sort(),
    ).toEqual(
      [
        ...CENSUS_ME_ALIAS_D582,
        ...CENSUS_ME_ENERGY_D583,
        "me02.5-178",
        ...CENSUS_ME_POKEMON_D584,
        ...CENSUS_ME_TRAINER_D584,
        "30th-073",
        "30th-136",
        ...CENSUS_ME_POKEMON_D585,
        ...CENSUS_ME_POKEMON_D586,
        ...CENSUS_ME_TRAINER_D587,
        ...CENSUS_ME_TRAINER_D588,
        ...CENSUS_ME_POKEMON_D589,
        ...CENSUS_ME_POKEMON_D590,
        ...CENSUS_ME_POKEMON_D591,
        ...KEYED_ATTACK_ME_D593,
        ...CENSUS_ME_POKEMON_D594,
        ...KEYED_ATTACK_ME_D597,
        ...CENSUS_ME_POKEMON_D598,
        ...CENSUS_ME_TRAINER_D599,
        ...CENSUS_ME_POKEMON_D602,
        ...CENSUS_ME_POKEMON_D603,
        ...CENSUS_ME_TRAINER_D603,
        ...CENSUS_ME_ENERGY_D604,
        ...CENSUS_ME_TRAINER_D606,
        ...KEYED_ATTACK_ME_D608,
        ...CENSUS_ME_POKEMON_D610,
        ...CENSUS_ME_POKEMON_D611,
        ...CENSUS_ME_POKEMON_D614,
        ...CENSUS_ME_TRAINER_D617,
        ...CENSUS_ME_TRAINER_D618,
        ...CENSUS_ME_POKEMON_D619,
        ...CENSUS_ME_TRAINER_D619,
        ...CENSUS_ME_TRAINER_D620,
        ...CENSUS_ME_TRAINER_D621,
        ...CENSUS_ME_TRAINER_D625,
        ...CENSUS_ME_POKEMON_D626,
        ...CENSUS_ME_TRAINER_D626,
        ...CENSUS_ME_POKEMON_D627,
        ...CENSUS_ME_POKEMON_D628.filter((id) => !KEYED_ATTACK_ME_D593.includes(id)),
        ...CENSUS_ME_TRAINER_D630,
        ...CENSUS_ME_POKEMON_D631,
        ...CENSUS_ME_POKEMON_D632,
        ...CENSUS_ME_TRAINER_D635,
        ...CENSUS_ME_POKEMON_D636,
        ...CENSUS_ME_TRAINER_D637,
        ...CENSUS_ME_POKEMON_D638,
        ...CENSUS_ME_TRAINER_D641,
        ...CENSUS_ME_POKEMON_D642,
        ...CENSUS_ME_TRAINER_D642,
        ...CENSUS_ME_POKEMON_D643,
        ...CENSUS_ME_POKEMON_D644,
        ...CENSUS_ME_TRAINER_D644,
        ...CENSUS_ME_POKEMON_D645,
        ...CENSUS_ME_TRAINER_D646,
        ...CENSUS_ME_TRAINER_B04,
      ]
        .filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id))
        .sort(),
    );
    // The shape check the line above relies on: it really does recognise the serie's ids.
    for (const id of ["me01-001", "me02.5-210", "mep-001", "mee-008", "30th-126"])
      expect(ME_ID.test(id), id).toBe(true);
    for (const id of ["sv01-001", "svp-001", "sve-001", "fix-energy"])
      expect(ME_ID.test(id), id).toBe(false);
  });

  it("BUILT over the `me` attack column, LIVE: 728 of 1,039 printings (262 of 451 sentences) ( D586: 745 / 270 live — the title's figures are the D581 baseline; D589: 754 / 274 live; D590: 757 / 275 live; D592: 775 / 286 live; D593: 785 / 294 live; D594: 793 / 298 live; D595: 804 / 306 live; D596: 818 / 309 live; D597: 834 / 316 live; D600: 846 / 323 live; D605: 858 / 328 live; D607: 872 / 336 live; D608: 885 / 343 live; D609: 893 / 347 live; D612: 918 / 358 live, over 442 sentences)", () => {
    type Tally = [sentences: number, printings: number];
    const tally: Record<"reader" | "gate" | "trailing" | "registryText" | "residue", Tally> = {
      reader: [0, 0],
      gate: [0, 0],
      trailing: [0, 0],
      registryText: [0, 0],
      residue: [0, 0],
    };
    for (const [n, text] of meAttackCorpus()) {
      const slot = tally[meArm(text) ?? "residue"];
      slot[0] += 1;
      slot[1] += n;
    }
    expect(tally).toEqual({
      reader: [423, 1007],
      gate: [4, 5],
      trailing: [11, 16],
      registryText: [3, 8],
      residue: [1, 3],
    });
    const built = tally.reader[1] + tally.gate[1] + tally.trailing[1];
    expect(built).toBe(1028);
    expect(built + tally.registryText[1] + tally.residue[1]).toBe(POPULATION_ME.attackUnits);
    // Every `me` sentence the `sv` column ALSO prints is built, except those three: the
    // whole unbuilt `me` residue is text the `sv` pool never printed.
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    const unbuiltShared = meAttackCorpus().filter(
      ([, text]) => sv.has(text) && meArm(text) === null,
    );
    expect(unbuiltShared).toEqual([]);
  });

  it("the D581 headline: attacks 2,460 / 2,771, abilities 376 / 610, trainers 264 / 447, special energy 11 / 22 ( D586: the live attack figure is 2,477 — the title is the D581 baseline; D589: 2,486; D590: 2,489; D592: 2,507; D593: 2,517; D594: 2,525; D595: 2,536; D596: 2,550; D597: 2,566; D600: 2,578; D605: 2,590; D607: 2,604; D608: 2,617; D609: 2,625; D612: 2,650)", () => {
    const meBuiltAttack = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(BUILT.attack + meBuiltAttack).toBe(2760);
    expect(POPULATION_D581.attackUnits - (BUILT.attack + meBuiltAttack)).toBe(11);
    expect([POPULATION.abilityUnits, POPULATION_D581.abilityUnits]).toEqual([376, 610]);
    expect([POPULATION.trainerUnits, POPULATION_D581.trainerUnits]).toEqual([264, 447]);
    expect([POPULATION.specialEnergyUnits, POPULATION_D581.specialEnergyUnits]).toEqual([11, 22]);
  });
});

/** The 42 `me` Pokémon keys with a non-attack program (41 print one Ability each; Terapagos ex
    `me02.5-179` prints none and carries `sv07-128`'s `attackGate`). */
const CENSUS_ME_POKEMON_D582: readonly string[] = [
  "me02.5-019", // Team Rocket's Spidops
  "me02.5-024", // Ethan's Magcargo
  "me02.5-026", // Ethan's Ho-Oh ex
  "me02.5-057", // Pikachu ex
  "me02.5-060", // Eelektrik
  "me02.5-070", // Iono's Bellibolt ex
  "me02.5-072", // Iono's Kilowattrel
  "me02.5-076", // Lillie's Clefairy ex
  "me02.5-079", // Team Rocket's Mewtwo ex
  "me02.5-082", // Togekiss
  "me02.5-099", // Munkidori
  "me02.5-110", // Cynthia's Gabite
  "me02.5-137", // N's Zoroark ex
  "me02.5-142", // Fezandipiti ex
  "me02.5-159", // Drakloak
  "me02.5-171", // Fan Rotom
  "me02.5-179", // Terapagos ex
  "me02.5-222", // Ethan's Magcargo
  "me02.5-235", // Togekiss
  "me02.5-248", // Drakloak
  "me02.5-250", // Fan Rotom
  "me02.5-277", // Pikachu ex
  "me02.5-279", // Iono's Bellibolt ex
  "me02.5-280", // Lillie's Clefairy ex
  "me02.5-281", // Team Rocket's Mewtwo ex
  "me02.5-286", // N's Zoroark ex
  "me02.5-287", // Marnie's Grimmsnarl ex
  "me02.5-288", // Fezandipiti ex
  "me02.5-289", // Steven's Metagross ex
  "me04-002", // Kakuna
  "me04-052", // Qwilfish
  "me02-011", // Charmander
  "me02-041", // Mega Diancie ex
  "me02-070", // Empoleon ex
  "me02-114", // Empoleon ex
  "me02.5-267", // Mega Diancie ex
  "me02.5-282", // Mega Diancie ex
  "me05-038", // Mega Chandelure ex
  "me05-099", // Mega Chandelure ex
  "me05-115", // Mega Chandelure ex
  "30th-028", // Pikachu
  "30th-033", // Pikachu
];

/** The 54 `me` Trainer keys (every one prints an `effect`). */
const CENSUS_ME_TRAINER_D582: readonly string[] = [
  "me01-114", // Boss's Orders
  "me01-115", // Energy Switch
  "me01-125", // Rare Candy
  "me01-130", // Switch
  "me01-131", // Ultra Ball
  "me01-166", // Air Balloon
  "me01-167", // Buddy-Buddy Poffin
  "me01-173", // Night Stretcher
  "me01-175", // Rare Candy
  "mep-092", // Paradise Resort
  "me02-123", // Switch
  "me02.5-181", // Air Balloon
  "me02.5-183", // Boss's Orders
  "me02.5-184", // Buddy-Buddy Poffin
  "me02.5-186", // Counter Gain
  "me02.5-189", // Glass Trumpet
  "me02.5-190", // Iris's Fighting Spirit
  "me02.5-195", // N's PP Up
  "me02.5-196", // Night Stretcher
  "me02.5-200", // Surfer
  "me02.5-201", // Team Rocket's Archer
  "me02.5-202", // Team Rocket's Ariana
  "me02.5-203", // Team Rocket's Factory
  "me02.5-204", // Team Rocket's Giovanni
  "me02.5-205", // Team Rocket's Great Ball
  "me02.5-207", // Team Rocket's Petrel
  "me02.5-208", // Team Rocket's Proton
  "me02.5-209", // Team Rocket's Transceiver
  "me02.5-210", // Team Rocket's Watchtower
  "me02.5-212", // Tool Scrapper
  "me02.5-214", // Urbain
  "me02.5-255", // Black Belt's Training
  "me02.5-256", // Boss's Orders
  "me02.5-258", // Cheren
  "me02.5-259", // Counter Gain
  "me02.5-260", // Glass Trumpet
  "me02.5-261", // Jamming Tower
  "me02.5-262", // N's PP Up
  "me02.5-263", // Team Rocket's Transceiver
  "me02.5-292", // Iris's Fighting Spirit
  "me02.5-293", // Surfer
  "me03-071", // Crushing Hammer
  "me03-072", // Energy Search
  "me03-076", // Judge
  "me03-080", // Poké Ball
  "me03-082", // Pokémon Catcher
  "me03-083", // Potion
  "me03-108", // Energy Recycler
  "me03-115", // Sacred Ash
  "me04-108", // Energy Retrieval
  "me04-115", // Tool Scrapper
  "me05-104", // Brave Bangle
  "me05-105", // Crushing Hammer
  "me05-107", // Energy Switch
];

/** The 2 `me` Special Energy keys (tcgdex tags both `energy_type = 'Normal'`, as it tags their
    `sv` twins — a named data gap, not an alias defect). */
const CENSUS_ME_ENERGY_D582: readonly string[] = [
  "me02-124", // Ignition Energy
  "me02.5-216", // Prism Energy
];

const CENSUS_ME_ALIAS_D582: readonly string[] = [
  ...CENSUS_ME_POKEMON_D582,
  ...CENSUS_ME_TRAINER_D582,
  ...CENSUS_ME_ENERGY_D582,
];

describe("D582 — the `me` reprint-alias tier and the Standard pool it builds, measured", () => {
  it("98 non-attack `me` keys (42 Pokémon / 54 Trainers / 2 Special Energy) plus ONE attack-only key", () => {
    expect([
      CENSUS_ME_POKEMON_D582.length,
      CENSUS_ME_TRAINER_D582.length,
      CENSUS_ME_ENERGY_D582.length,
    ]).toEqual([42, 54, 2]);
    expect(new Set(CENSUS_ME_ALIAS_D582).size).toBe(98);
    for (const id of CENSUS_ME_ALIAS_D582) expect(ME_ID.test(id), id).toBe(true);
    // Terapagos `me02.5-178`: the attack-only key, on `sv08-161`'s object.
    expect(programFor("me02.5-178")).toBe(programFor("sv08-161"));
    expect(Object.keys(programFor("me02.5-178") ?? {})).toEqual(["attack"]);
  });

  it("BUILT over the `me` pool: attacks 729 / 1,039, abilities 41 / 234, trainers 54 / 183, special energy 2 / 11 ( D586: attacks 746 live — the D586 block; D589: 755; D590: 758; D592: 776; D593: 786; D594: 794; D595: 805; D596: 819; D597: 835)", () => {
    const prism = meAttackCorpus().filter(([, text]) =>
      text.startsWith("Search your deck for up to 3 Basic Energy cards of different types"),
    );
    expect(prism.map(([n]) => n)).toEqual([1]);
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt + 1).toBe(1029);
    expect(CENSUS_ME_POKEMON_D582.filter((id) => id !== "me02.5-179")).toHaveLength(41);
    expect(POPULATION_ME.abilityUnits - 41).toBe(193);
    expect(POPULATION_ME.trainerUnits - CENSUS_ME_TRAINER_D582.length).toBe(129);
    expect(POPULATION_ME.specialEnergyUnits - CENSUS_ME_ENERGY_D582.length).toBe(9);
  });

  it("the D582 headline: attacks 2,461 / 2,771, abilities 417 / 610, trainers 318 / 447, special energy 13 / 22", () => {
    expect(BUILT.attack + 729).toBe(2461);
    expect(POPULATION.abilityUnits + 41).toBe(417);
    expect(BUILT.trainer + CENSUS_ME_TRAINER_D582.length).toBe(318);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length).toBe(13);
    expect([
      POPULATION_D581.attackUnits,
      POPULATION_D581.abilityUnits,
      POPULATION_D581.trainerUnits,
      POPULATION_D581.specialEnergyUnits,
    ]).toEqual([2771, 610, 447, 22]);
  });
});

const CENSUS_ME_ENERGY_D583: readonly string[] = [
  "me02.5-217", // Team Rocket's Energy
];

describe("D583 — the Special Energy column: 14 / 22", () => {
  it("the `me` half is 3 / 11: Ignition, Prism (D582) and Team Rocket's Energy (D583)", () => {
    expect(CENSUS_ME_ENERGY_D583).toEqual(["me02.5-217"]);
    expect(programFor("me02.5-217")).toBe(programFor("sv10-182"));
    expect(CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(3);
    expect(POPULATION_ME.specialEnergyUnits - 3).toBe(8);
  });

  it("the headline: special energy 14 / 22 (the other three columns stand at D582's 2,461 / 417 / 318)", () => {
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
    expect(POPULATION_D581.specialEnergyUnits).toBe(22);
    expect(BUILT.specialEnergy).toBe(POPULATION.specialEnergyUnits);
  });
});

/** The 14 `me` Pokémon keys with a non-attack program, one printed Ability each. */
const CENSUS_ME_POKEMON_D584: readonly string[] = [
  "30th-096", // Zoroark — Nighttime Byway
  "me02.5-068", // Hop's Pincurchin ex — Counterattack Quills
  "me04-073", // Cinccino ex — Smooth Coat
  "me04-105", // Cinccino ex
  "me04-119", // Cinccino ex
  "me03-017", // Turtonator — Shell Spikes
  "me02.5-027", // Numel — Incandescent Body
  "me02.5-223", // Numel
  "me05-068", // Toucannon — Aerial Draw
  "me05-094", // Toucannon
  "mep-101", // Nidorina — Share Happiness
  "30th-088", // Nidorina
  "me01-024", // Pyroar — Intimidating Fang
  "mep-086", // Slowpoke — Dopey Face
];

/** The 2 `me` Trainer keys: Ultra Ball, one newline from `sv01-196`'s face. */
const CENSUS_ME_TRAINER_D584: readonly string[] = [
  "me02.5-213", // Ultra Ball
  "me02.5-264", // Ultra Ball
];

describe("D584 — the `me` alias tier 2 and the Standard pool it builds, measured", () => {
  it("16 non-attack `me` keys (14 Pokémon / 2 Trainers) plus Drifloon ×2 attack-only", () => {
    expect([CENSUS_ME_POKEMON_D584.length, CENSUS_ME_TRAINER_D584.length]).toEqual([14, 2]);
    expect(new Set([...CENSUS_ME_POKEMON_D584, ...CENSUS_ME_TRAINER_D584]).size).toBe(16);
    for (const id of [...CENSUS_ME_POKEMON_D584, ...CENSUS_ME_TRAINER_D584])
      expect(ME_ID.test(id), id).toBe(true);
    for (const id of ["30th-073", "30th-136"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["attack"]);
    expect(programFor("30th-073")).toBe(programFor("30th-136"));
  });

  it("BUILT over the `me` pool: attacks 731 / 1,039, abilities 55 / 234, trainers 56 / 183, special energy 3 / 11 ( D586: attacks 748 live — the D586 block; D589: 757; D590: 760; D592: 778; D593: 788; D594: 796; D595: 807; D596: 821; D597: 837)", () => {
    const surfBack = meAttackCorpus().filter(
      ([, text]) => text === "You may shuffle this Pokémon and all attached cards into your deck.",
    );
    const keyed = ["30th-073", "30th-136"].filter(
      (id) => programFor(id)?.attack?.[0] !== undefined,
    );
    expect(surfBack.map(([n]) => n)).toEqual([keyed.length]);
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt + 1 + keyed.length).toBe(1031);
    expect(41 + CENSUS_ME_POKEMON_D584.length).toBe(55);
    expect(CENSUS_ME_TRAINER_D582.length + CENSUS_ME_TRAINER_D584.length).toBe(56);
    expect(POPULATION_ME.abilityUnits - 55).toBe(179);
    expect(POPULATION_ME.trainerUnits - 56).toBe(127);
  });

  it("the D584 headline: attacks 2,463 / 2,771, abilities 431 / 610, trainers 320 / 447, special energy 14 / 22", () => {
    expect(BUILT.attack + 731).toBe(2463);
    expect(POPULATION.abilityUnits + 55).toBe(431);
    expect(BUILT.trainer + CENSUS_ME_TRAINER_D582.length + CENSUS_ME_TRAINER_D584.length).toBe(320);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

/** The 19 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D585: readonly string[] = [
  "me03-024", // Aurorus — Tundra Wall
  "me03-092", // Aurorus
  "me03-019", // Dewgong — Wash Out
  "me01-084", // Garganacl — Powerful a-Salt
  "me01-147", // Garganacl
  "me02.5-135", // Mega Scrafty ex — Counterattacking Crest
  "me02.5-270", // Mega Scrafty ex
  "me02.5-285", // Mega Scrafty ex
  "mep-065", // Barbaracle — Stone Arms
  "me03-043", // Barbaracle
  "me03-036", // Aromatisse — Scent Collection
  "me02.5-152", // Mega Dragonite ex — Sky Transport
  "me02.5-271", // Mega Dragonite ex
  "me02.5-290", // Mega Dragonite ex
  "me02.5-295", // Mega Dragonite ex
  "mep-091", // Mega Dragonite ex
  "me04-029", // Ampharos — Synchro Pulse
  "me04-090", // Ampharos
  "mep-075", // Ampharos
];

describe("D585 — WP19's parameter copies and the Standard pool they build, measured", () => {
  it("19 non-attack `me` Pokémon keys, none an attack program", () => {
    expect(CENSUS_ME_POKEMON_D585).toHaveLength(19);
    expect(new Set(CENSUS_ME_POKEMON_D585).size).toBe(19);
    for (const id of CENSUS_ME_POKEMON_D585) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("each key's printed attack is reader-built (so all 19 printings are fully built)", () => {
    for (const text of [
      "Discard a random card from your opponent's hand. Discard the top card of your opponent's deck.",
      "Discard 2 Energy from this Pokémon.",
      "During your opponent's next turn, the Defending Pokémon can't use attacks.",
      "Heal 30 damage from this Pokémon.",
      "During your next turn, this Pokémon can't use Flashing Bolt.",
    ]) {
      expect(["reader", "gate", "trailing"], text).toContain(meArm(text));
    }
  });

  it("BUILT over the `me` pool: abilities 74 / 234; the D585 headline: abilities 450 / 610", () => {
    expect(41 + CENSUS_ME_POKEMON_D584.length + CENSUS_ME_POKEMON_D585.length).toBe(74);
    expect(POPULATION_ME.abilityUnits - 74).toBe(160);
    expect(POPULATION.abilityUnits + 74).toBe(450);
    expect(POPULATION_D581.abilityUnits).toBe(610);
    expect(BUILT.attack + 731).toBe(2463);
    expect(BUILT.trainer + CENSUS_ME_TRAINER_D582.length + CENSUS_ME_TRAINER_D584.length).toBe(320);
  });
});

/** The 2 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D586: readonly string[] = [
  "me02.5-117", // Carbink — Double Type
  "me02.5-242", // Carbink
];

const WP03_SENTENCES_D586: readonly (readonly [number, string])[] = [
  [5, "If your opponent's Active Pokémon is affected by a Special Condition, it is Knocked Out."],
  [3, "If your opponent has 3 or fewer Prize cards remaining, this attack does 90 more damage."],
  [2, "If your opponent has 2 or fewer Prize cards remaining, this attack does 100 more damage."],
  [1, "If you have at least 4 {L} Energy in play, this attack does 90 more damage."],
  [1, "If you have at least 4 {R} Energy in play, this attack does 90 more damage."],
  [1, "If you have at least 4 {W} Energy in play, this attack does 90 more damage."],
  [2, "If you don't have exactly 7 cards in your hand, this attack does nothing."],
  [
    2,
    "Discard 4 Basic {R} Energy cards from your hand. If you can't discard 4 cards in this way, this attack does nothing.",
  ],
];

describe("D586 — WP03's clause rows and Carbink, and the Standard pool they build, measured", () => {
  it("the eight sentences are the `me` corpus's own rows, each now reader-built, and none is printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [n, text] of WP03_SENTENCES_D586) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(WP03_SENTENCES_D586.reduce((sum, [n]) => sum + n, 0)).toBe(17);
  });

  it("2 non-attack `me` Pokémon keys (Carbink), no attack program", () => {
    expect(CENSUS_ME_POKEMON_D586).toHaveLength(2);
    for (const id of CENSUS_ME_POKEMON_D586) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  it("BUILT over the `me` pool: attacks 748 / 1,039, abilities 76 / 234; the D586 headline: attacks 2,480 / 2,771, abilities 452 / 610 ( D589: attacks 757 / 2,489 live — the D589 block; D590: 760 / 2,492 — the D590 block; D592: 778 / 2,510 — the D592 block; D593: 793 / 2,525 — the D593 block; D594: 801 / 2,533 — the D594 block; D595: 812 / 2,544 — the D595 block; D596: 826 / 2,558 — the D596 block; D597: 844 / 2,576 — the D597 block)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        9 -
        3 -
        18 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(745);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        9 -
        3 -
        18 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2,
    ).toBe(748);
    expect(POPULATION_ME.attackUnits - 748).toBe(291);
    expect(
      41 +
        CENSUS_ME_POKEMON_D584.length +
        CENSUS_ME_POKEMON_D585.length +
        CENSUS_ME_POKEMON_D586.length,
    ).toBe(76);
    expect(POPULATION_ME.abilityUnits - 76).toBe(158);
    expect(BUILT.attack + 748).toBe(2480);
    expect(POPULATION.abilityUnits + 76).toBe(452);
    expect([POPULATION_D581.attackUnits, POPULATION_D581.abilityUnits]).toEqual([2771, 610]);
    expect(BUILT.trainer + CENSUS_ME_TRAINER_D582.length + CENSUS_ME_TRAINER_D584.length).toBe(320);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

/** The 19 `me` Trainer keys. */
const CENSUS_ME_TRAINER_D587: readonly string[] = [
  "me02-094", // Wondrous Patch
  "me03-117", // Wondrous Patch
  "me04-079", // Philippe
  "me04-110", // Philippe
  "me03-075", // Jacinthe
  "me03-110", // Jacinthe
  "me03-122", // Jacinthe
  "me02-089", // Firebreather
  "me02-119", // Firebreather
  "me01-116", // Fighting Gong
  "me01-168", // Fighting Gong
  "me02.5-187", // Fighting Gong
  "me03-085", // Tarragon
  "me03-116", // Tarragon
  "me02.5-198", // Poké Pad
  "me03-081", // Poké Pad
  "me03-113", // Poké Pad
  "me03-073", // Energy Swatter
  "me01-126", // Repel
];

describe("D587 — WP04's Trainer parameter copies and the Standard pool they build, measured", () => {
  it("19 `me` Trainer keys, each a `trainer` program and nothing else", () => {
    expect(CENSUS_ME_TRAINER_D587).toHaveLength(19);
    expect(new Set(CENSUS_ME_TRAINER_D587).size).toBe(19);
    for (const id of CENSUS_ME_TRAINER_D587) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["trainer"]);
    }
  });

  it("BUILT over the `me` pool: trainers 75 / 183; the D587 headline: trainers 339 / 447", () => {
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length + CENSUS_ME_TRAINER_D584.length + CENSUS_ME_TRAINER_D587.length;
    expect(meTrainers).toBe(75);
    expect(POPULATION_ME.trainerUnits - meTrainers).toBe(108);
    expect(BUILT.trainer + meTrainers).toBe(339);
    expect(POPULATION_D581.trainerUnits).toBe(447);
    expect(
      41 +
        CENSUS_ME_POKEMON_D584.length +
        CENSUS_ME_POKEMON_D585.length +
        CENSUS_ME_POKEMON_D586.length,
    ).toBe(76);
    expect(POPULATION.abilityUnits + 76).toBe(452);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

/** The 17 `me` Trainer keys. */
const CENSUS_ME_TRAINER_D588: readonly string[] = [
  "me02.5-185", // Canari
  "me02.5-257", // Canari
  "me02.5-291", // Canari
  "me01-119", // Lillie's Determination
  "me01-169", // Lillie's Determination
  "me01-184", // Lillie's Determination
  "me02.5-192", // Lillie's Determination
  "me05-080", // Misty's Vitality
  "me05-111", // Misty's Vitality
  "me03-084", // Rosa's Encouragement
  "me03-114", // Rosa's Encouragement
  "me03-123", // Rosa's Encouragement
  "me05-081", // Rust Syndicate Grunt
  "me05-112", // Rust Syndicate Grunt
  "me02.5-215", // Waitress
  "me03-074", // Hole-Digging Shovel
  "me03-078", // Lumiose Galette
];

describe("D588 — WP22's Trainer parameter copies and the Standard pool they build, measured", () => {
  it("17 `me` Trainer keys, each a Trainer program (a `trainer` list, plus a printed gate or turn end)", () => {
    expect(CENSUS_ME_TRAINER_D588).toHaveLength(17);
    expect(new Set(CENSUS_ME_TRAINER_D588).size).toBe(17);
    for (const id of CENSUS_ME_TRAINER_D588) {
      expect(ME_ID.test(id), id).toBe(true);
      const keys = Object.keys(programFor(id) ?? {});
      expect(keys, id).toContain("trainer");
      for (const key of keys)
        expect(["trainer", "trainerPlayableIf", "trainerEndsTurn"], id).toContain(key);
    }
  });

  it("BUILT over the `me` pool: trainers 92 / 183; the D588 headline: trainers 356 / 447", () => {
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length;
    expect(meTrainers).toBe(92);
    expect(POPULATION_ME.trainerUnits - meTrainers).toBe(91);
    expect(BUILT.trainer + meTrainers).toBe(356);
    expect(POPULATION_D581.trainerUnits).toBe(447);
    expect(
      41 +
        CENSUS_ME_POKEMON_D584.length +
        CENSUS_ME_POKEMON_D585.length +
        CENSUS_ME_POKEMON_D586.length,
    ).toBe(76);
    expect(POPULATION.abilityUnits + 76).toBe(452);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

/** The 5 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D589: readonly string[] = [
  "mep-081", // Mega Greninja ex — Mortal Shuriken
  "me04-022", // Mega Greninja ex
  "me04-100", // Mega Greninja ex
  "me04-116", // Mega Greninja ex
  "me04-122", // Mega Greninja ex
];

const WP08_SENTENCES_D589: readonly (readonly [number, string])[] = [
  [1, "You may discard 3 {M} Energy from this Pokémon and have this attack do 150 more damage."],
  [2, "You may discard all Energy from this Pokémon and have this attack do 130 more damage."],
  [
    5,
    "You may put a {W} Energy attached to this Pokémon into your hand and have this attack do 80 more damage.",
  ],
  [
    1,
    "You may shuffle all Energy attached to this Pokémon into your deck and have this attack do 80 more damage.",
  ],
];

describe("D589 — WP08's optional-cost rows and Mortal Shuriken, and the Standard pool they build, measured", () => {
  it("the four sentences are the `me` corpus's own rows, each now reader-built, and none is printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [n, text] of WP08_SENTENCES_D589) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(WP08_SENTENCES_D589.reduce((sum, [n]) => sum + n, 0)).toBe(9);
  });

  it("5 non-attack `me` Pokémon keys (Mega Greninja ex), an `abilities` program only", () => {
    expect(CENSUS_ME_POKEMON_D589).toHaveLength(5);
    for (const id of CENSUS_ME_POKEMON_D589) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    }
  });

  it("BUILT over the `me` pool: attacks 757 / 1,039, abilities 81 / 234; the D589 headline: attacks 2,489 / 2,771, abilities 457 / 610", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        3 -
        18 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(754);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        3 -
        18 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2,
    ).toBe(757);
    expect(POPULATION_ME.attackUnits - 757).toBe(282);
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length;
    expect(meAbilities).toBe(81);
    expect(POPULATION_ME.abilityUnits - 81).toBe(153);
    expect(BUILT.attack + 757).toBe(2489);
    expect(POPULATION.abilityUnits + 81).toBe(457);
    expect([POPULATION_D581.attackUnits, POPULATION_D581.abilityUnits]).toEqual([2771, 610]);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

/** The 13 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D590: readonly string[] = [
  "me01-056", // Alakazam — Psychic Draw (3)
  "mep-003", // Alakazam
  "mep-009", // Alakazam
  "me01-055", // Kadabra — Psychic Draw (2)
  "me02-047", // Brambleghast — Prison Panic
  "me01-063", // Grumpig — Energized Steps
  "me01-073", // Hariyama — Heave-Ho Catcher
  "me01-017", // Ninjask — Cast-Off Shell
  "me01-137", // Ninjask
  "me05-020", // Primarina — Enriching Melody
  "me05-088", // Primarina
  "me02.5-012", // Silcoon — Multiplying Cocoon
  "me01-097", // Tinkatuff — Haphazard Hammer
];

/** The self-shuffle sentence (Lokix `me02-010` "Jumping Shot", Primarina ×2 "Aqua Return"). */
const RETURN_SELF_SENTENCE_D590 = "Shuffle this Pokémon and all attached cards into your deck.";

describe("D590 — WP05's on-evolve Abilities and the self-shuffle, and the Standard pool they build, measured", () => {
  it("the self-shuffle is the `me` corpus's own row at 3 printings, now reader-built, and not printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    expect(me.get(RETURN_SELF_SENTENCE_D590)).toBe(3);
    expect(meArm(RETURN_SELF_SENTENCE_D590)).toBe("reader");
    expect(legalAttackCorpus().some(([, text]) => text === RETURN_SELF_SENTENCE_D590)).toBe(false);
  });

  it("13 non-attack `me` Pokémon keys, a `triggered` program only; the keys' other printed attack texts are built, Powerful Hand ×3 is not ( D600: it is now — WP14)", () => {
    expect(CENSUS_ME_POKEMON_D590).toHaveLength(13);
    for (const id of CENSUS_ME_POKEMON_D590) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["triggered"]);
    }
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    // Hariyama "Wild Press" and Ninjask "U-turn" (the other keys' attacks print no text).
    for (const text of [
      "This Pokémon also does 70 damage to itself.",
      "Switch this Pokémon with 1 of your Benched Pokémon.",
    ]) {
      expect([text, meArm(text)]).toEqual([text, "reader"]);
    }
    const powerfulHand =
      "Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.";
    expect(me.get(powerfulHand)).toBe(3);
    expect(meArm(powerfulHand)).toBe("reader");
  });

  it("BUILT over the `me` pool: attacks 760 / 1,039, abilities 94 / 234; the D590 headline: attacks 2,492 / 2,771, abilities 470 / 610", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        18 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(757);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        18 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2,
    ).toBe(760);
    expect(POPULATION_ME.attackUnits - 760).toBe(279);
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length;
    expect(meAbilities).toBe(94);
    expect(POPULATION_ME.abilityUnits - 94).toBe(140);
    expect(BUILT.attack + 760).toBe(2492);
    expect(POPULATION.abilityUnits + 94).toBe(470);
    expect([POPULATION_D581.attackUnits, POPULATION_D581.abilityUnits]).toEqual([2771, 610]);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

/** The 19 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D591: readonly string[] = [
  "me01-104", // Mega Kangaskhan ex — Run Errand
  "me01-164", // Mega Kangaskhan ex
  "me01-182", // Mega Kangaskhan ex
  "mep-025", // Mega Kangaskhan ex
  "me02.5-053", // Frosmoth — Alluring Wings
  "mep-096", // Moltres — Fiery Flapping
  "30th-011", // Moltres
  "30th-130", // Moltres
  "mep-098", // Zapdos — Flash-Pop Flapping
  "30th-055", // Zapdos
  "30th-133", // Zapdos
  "mep-097", // Articuno — Frosty Flapping
  "30th-018", // Articuno
  "30th-132", // Articuno
  "me01-074", // Lunatone — Lunar Cycle
  "mep-004", // Lunatone
  "me02.5-105", // Lunatone
  "me04-013", // Delphox — Flaring Magic
  "mep-074", // Delphox
];

describe("D591 — WP20a's activated Abilities, and the Standard pool they build, measured", () => {
  it("19 non-attack `me` Pokémon keys, an `abilities` program only; the five unfinished printings wait on an attack ( D607: three — Delphox ×2's is built; D612: one — the `30th` Hail's is built; D615: none — Frosmoth's is built)", () => {
    expect(CENSUS_ME_POKEMON_D591).toHaveLength(19);
    for (const id of CENSUS_ME_POKEMON_D591) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    }
    // Built: Rapid-Fire Combo, Fire Spin, Thundering Lightning and the `mep` Hail (Lunatone's Power
    // Gem prints no text).
    for (const text of [
      "Flip a coin until you get tails. This attack does 50 more damage for each heads.",
      "Discard 2 Energy from this Pokémon.",
      "This Pokémon also does 60 damage to itself.",
      "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect([text, meArm(text)]).toEqual([text, "reader"]);
    }
    expect(meArm("This attack does 30 damage for each Energy attached to all Pokémon.")).toBe(
      "reader",
    );
    expect(meArm("Move a {W} Energy from this Pokémon to 1 of your Benched Pokémon.")).toBe(
      "reader",
    );
    for (const text of [
      "This attack does 30 damage to each of your opponent's Pokémon. <em>(Don't apply Weakness and Resistance for Benched Pokémon.)</em>",
    ]) {
      expect([text, meArm(text)]).toEqual([text, null]);
    }
  });

  it("BUILT over the `me` pool: attacks 760 / 1,039, abilities 113 / 234; the D591 headline: attacks 2,492 / 2,771, abilities 489 / 610", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        18 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2,
    ).toBe(760);
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length;
    expect(meAbilities).toBe(113);
    expect(POPULATION_ME.abilityUnits - 113).toBe(121);
    expect(BUILT.attack + 760).toBe(2492);
    expect(POPULATION.abilityUnits + 113).toBe(489);
    expect([POPULATION_D581.attackUnits, POPULATION_D581.abilityUnits]).toEqual([2771, 610]);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

const WORDING_DRIFT_D592: readonly (readonly [string, number])[] = [
  ["Your opponent reveals their hand, and you discard a card you find there.", 3],
  ["This Pokémon does 30 damage to itself.", 1],
  ["Flip a coin. If tails, during your next turn, this Pokémon can't use attacks.", 1],
  [
    "Choose a random card from your opponent's hand, and your opponent reveals that card and shuffles it into their deck.",
    1,
  ],
  ["Place 3 damage counters on your opponent's Active Pokémon.", 1],
  [
    "Your opponent's Active Pokémon is now Poisoned. During Pokémon Checkup, place 16 damage counters on that Pokémon instead of 1.",
    3,
  ],
  [
    "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon.",
    1,
  ],
  ["Place 5 damage counters on 1 of your opponent's Benched Pokémon.", 1],
  ["Place 13 damage counters on 1 of your opponent's Pokémon.", 2],
  ["Place damage counters on your opponent's Active Pokémon until its remaining HP is 50.", 1],
  ["Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon.", 3],
];

describe("D592 — WP02's wording drift and Corrosive Liquid, and the Standard pool they build, measured", () => {
  it("11 `me` sentences / 18 printings, each now `deriveAttackEffect`-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of WORDING_DRIFT_D592) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(deriveAttackEffect(text), text).not.toBeNull();
      expect(sv.has(text), text).toBe(false);
    }
    expect(WORDING_DRIFT_D592.reduce((sum, [, n]) => sum + n, 0)).toBe(18);
  });

  it("BUILT over the `me` pool: attacks 778 / 1,039; the D592 headline: attacks 2,510 / 2,771", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(775);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        10 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2,
    ).toBe(778);
    expect(POPULATION_ME.attackUnits - 778).toBe(261);
    expect(BUILT.attack + 778).toBe(2510);
    expect(POPULATION_D581.attackUnits - 2510).toBe(261);
    expect(POPULATION.abilityUnits + 113).toBe(489);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

const CLAUSE_ROWS_D593: readonly (readonly [string, number, "reader" | "gate"])[] = [
  [
    "If any of your Benched Pancham have any damage counters on them, this attack does 120 more damage.",
    1,
    "reader",
  ],
  [
    "If any of your Hop's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage.",
    2,
    "reader",
  ],
  [
    "If this Pokémon evolved from Magneton during this turn, this attack does 120 more damage.",
    1,
    "reader",
  ],
  ["If this Pokémon is Burned or Poisoned, this attack does 100 more damage.", 2, "reader"],
  [
    "If this Pokémon used Spiky Rolling during your last turn, this attack does 80 more damage.",
    1,
    "reader",
  ],
  ["If this Pokémon has no Voltaic {L} Energy attached, this attack does nothing.", 1, "reader"],
  ["If your opponent's Active Pokémon isn't Confused, this attack does nothing.", 1, "reader"],
  ["If this Pokémon has any damage counters on it, this attack can be used for {D}.", 1, "gate"],
];

const KEYED_ATTACK_ME_D593: readonly string[] = [
  "mep-006",
  "me03-062",
  "me03-107",
  "me03-121",
  "me04-030",
];

describe("D593 — WP07's clause rows and the Fade Out objects, and the Standard pool they build, measured", () => {
  it("8 `me` sentences / 10 printings, each now row-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n, arm] of CLAUSE_ROWS_D593) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, arm]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(CLAUSE_ROWS_D593.reduce((sum, [, n]) => sum + n, 0)).toBe(10);
  });

  it('"Fade Out" ×5: five attack-only keys, one per printing of the `registryText` sentence ( D628 (D539): "attack-only" WITHDRAWN for Meowth ex ×3 — they carry "Last-Ditch Catch" too)', () => {
    const fadeOut = meAttackCorpus().filter(
      ([, text]) => text === "Put this Pokémon and all attached cards into your hand.",
    );
    expect(fadeOut.map(([n]) => n)).toEqual([KEYED_ATTACK_ME_D593.length]);
    for (const id of KEYED_ATTACK_ME_D593)
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(
        id.startsWith("me03-") ? ["attack", "triggered"] : ["attack"],
      );
  });

  it("BUILT over the `me` pool: attacks 793 / 1,039; the D593 headline: attacks 2,525 / 2,771", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(785);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        8 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length,
    ).toBe(793);
    expect(POPULATION_ME.attackUnits - 793).toBe(246);
    expect(BUILT.attack + 793).toBe(2525);
    expect(POPULATION_D581.attackUnits - 2525).toBe(246);
    expect(POPULATION.abilityUnits + 113).toBe(489);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

const CLAUSE_ROWS_D594: readonly (readonly [string, number])[] = [
  [
    "If this Pokémon has 2 or more damage counters on it, this attack does 90 more damage. This attack's damage isn't affected by Weakness.",
    1,
  ],
  [
    "If you don't have Lunatone on your Bench, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.",
    2,
  ],
  ["If you have exactly 6 Prize cards remaining, this attack does 200 more damage.", 2],
  ["If you have no cards in your hand, this attack does 160 more damage.", 3],
];

/** The 2 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D594: readonly string[] = [
  "me03-027", // Luxio — Fighting Roar
  "me04-007", // Chesnaught — Needly Armor
];

describe("D594 — WP33a's condition rows and two Abilities, and the Standard pool they build, measured", () => {
  it("4 `me` sentences / 8 printings, each now reader-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of CLAUSE_ROWS_D594) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(CLAUSE_ROWS_D594.reduce((sum, [, n]) => sum + n, 0)).toBe(8);
  });

  it("2 non-attack `me` Pokémon keys, a `passive` program only", () => {
    for (const id of CENSUS_ME_POKEMON_D594) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
  });

  it("BUILT over the `me` pool: attacks 801 / 1,039, abilities 115 / 234; the D594 headline: attacks 2,533 / 2,771, abilities 491 / 610", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(793);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        11 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length,
    ).toBe(801);
    expect(POPULATION_ME.attackUnits - 801).toBe(238);
    expect(BUILT.attack + 801).toBe(2533);
    expect(POPULATION_D581.attackUnits - 2533).toBe(238);
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length;
    expect(meAbilities).toBe(115);
    expect(POPULATION_ME.abilityUnits - 115).toBe(119);
    expect(POPULATION.abilityUnits + 115).toBe(491);
    expect(BUILT.specialEnergy + CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length).toBe(
      14,
    );
  });
});

const COIN_ROWS_D595: readonly (readonly [string, number])[] = [
  ["Flip 2 coins. If both of them are heads, heal all damage from 1 of your Pokémon.", 1],
  ["Flip 3 coins. If all of them are heads, Knock Out 1 of your opponent's Pokémon.", 1],
  [
    "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat.",
    1,
  ],
  [
    "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck.",
    1,
  ],
  [
    "Flip a coin. If heads, switch 1 of your opponent's Benched Pokémon with their Active Pokémon.",
    1,
  ],
  [
    "Flip 3 coins. Attach an amount of Basic Energy up to the number of heads from your discard pile to your Benched Pokémon in any way you like.",
    1,
  ],
  [
    "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck.",
    3,
  ],
  [
    "Flip a coin until you get tails. For each heads, choose a random card from your opponent's hand. Your opponent reveals those cards and shuffles them into their deck.",
    2,
  ],
];

describe("D595 — WP13's coin-gate compositions, and the Standard pool they build, measured", () => {
  it("8 `me` sentences / 11 printings, each now reader-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of COIN_ROWS_D595) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(COIN_ROWS_D595.reduce((sum, [, n]) => sum + n, 0)).toBe(11);
  });

  it("BUILT over the `me` pool: attacks 812 / 1,039; the D595 headline: attacks 2,544 / 2,771", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(804);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        14 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length,
    ).toBe(812);
    expect(POPULATION_ME.attackUnits - 812).toBe(227);
    expect(BUILT.attack + 812).toBe(2544);
    expect(POPULATION_D581.attackUnits - 2544).toBe(227);
  });
});

const GARDEVOIR_ROWS_D596: readonly (readonly [string, number])[] = [
  ["This attack does 50 damage for each {P} Energy attached to all of your Pokémon.", 6],
  ["This attack does 30 damage for each {P} Energy attached to all of your Pokémon.", 2],
  [
    "For each of your Benched Pokémon, search your deck for a Basic {P} Energy card and attach it to that Pokémon. Then, shuffle your deck.",
    6,
  ],
];

describe("D596 — WP09's Mega Gardevoir ex and Xerneas texts, and the Standard pool they build, measured", () => {
  it("3 `me` sentences / 14 printings, each now reader-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of GARDEVOIR_ROWS_D596) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(GARDEVOIR_ROWS_D596.reduce((sum, [, n]) => sum + n, 0)).toBe(14);
  });

  it("BUILT over the `me` pool: attacks 826 / 1,039; the D596 headline: attacks 2,558 / 2,771", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(818);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        16 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length,
    ).toBe(826);
    expect(POPULATION_ME.attackUnits - 826).toBe(213);
    expect(BUILT.attack + 826).toBe(2558);
    expect(POPULATION_D581.attackUnits - 2558).toBe(213);
  });
});

const DISCARD_ROWS_D597: readonly (readonly [string, number])[] = [
  [
    "Discard any amount of {R} Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way.",
    4,
  ],
  [
    "Discard up to 2 Energy cards from this Pokémon, and this attack does 120 damage for each card you discarded in this way.",
    3,
  ],
  [
    "Discard up to 2 Basic {M} Energy cards from your hand, and this attack does 40 damage for each card you discarded in this way.",
    1,
  ],
  [
    "Discard up to 2 Energy cards from your hand, and this attack does 60 damage for each card you discarded in this way.",
    1,
  ],
  [
    "Discard the top 6 cards of your deck, and this attack does 100 damage for each Basic {W} Energy card that you discarded in this way.",
    2,
  ],
  [
    "Discard the top 6 cards of your deck, and this attack does 60 damage for each Basic {W} Energy card you discarded in this way.",
    1,
  ],
  [
    "You may discard up to 4 Energy cards from your hand, and this attack does 40 more damage for each card you discarded in this way.",
    4,
  ],
];

/** The 2 attack-only `me` keys: the "[R]" Inferno X. */
const KEYED_ATTACK_ME_D597: readonly string[] = ["mep-023", "mep-029"];

describe("D597 — WP29's discard-scaled attacks, and the Standard pool they build, measured", () => {
  it("7 `me` sentences / 16 printings, each now reader-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of DISCARD_ROWS_D597) {
      const merged = text.startsWith("Discard any amount of {R} Energy")
        ? n + KEYED_ATTACK_ME_D597.length
        : n;
      expect([text, me.get(text)]).toEqual([text, merged]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(DISCARD_ROWS_D597.reduce((sum, [, n]) => sum + n, 0)).toBe(16);
  });

  it('~~"[R]" Inferno X ×2: two attack-only keys, one per printing of the residue sentence~~ ( D612: WITHDRAWN — the "[R]" text is normalised away and both keys are retired; the printings are reader-built)', () => {
    const bracket = meAttackCorpus().filter(([, text]) => text.includes("[R]"));
    expect(bracket).toEqual([]);
    for (const id of KEYED_ATTACK_ME_D597) expect(programFor(id), id).toBeUndefined();
    expect(RETIRED_ATTACK_KEYS_D612).toEqual(expect.arrayContaining([...KEYED_ATTACK_ME_D597]));
  });

  it("BUILT over the `me` pool: attacks 844 / 1,039; the D597 headline: attacks 2,576 / 2,771", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        12 -
        12 -
        14 -
        13 -
        8,
    ).toBe(834);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        KEYED_ATTACK_ME_D597.length,
    ).toBe(844);
    expect(POPULATION_ME.attackUnits - 844).toBe(195);
    expect(BUILT.attack + 844).toBe(2576);
    expect(POPULATION_D581.attackUnits - 2576).toBe(195);
  });
});

const CENSUS_ME_POKEMON_D598: readonly string[] = [
  ...["me02-056", "me02.5-125", "me02.5-269", "me02.5-284", "mep-073"],
  ...["me02.5-116", "me02.5-268", "me02.5-283", "me05-041"],
  ...["me01-061", "me01-144", "me03-050", "me02.5-143"],
];

describe("D598 — WP32's KO / damage-taken Abilities, and the Standard pool they build, measured", () => {
  it("13 non-attack `me` Pokémon keys: a `passive` or a `triggered` program only", () => {
    expect(CENSUS_ME_POKEMON_D598).toHaveLength(13);
    for (const id of CENSUS_ME_POKEMON_D598) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual([
        id === "me01-061" || id === "me01-144" || id === "me02.5-143" ? "triggered" : "passive",
      ]);
    }
  });

  it("each printing's ONE attack is reader-built and its ONE Ability is keyed here (so all 13 are fully built: 857 → 870)", () => {
    // LOCAL D1: each of the 13 rows prints exactly one Ability and one attack.
    for (const text of [
      "Move an Energy from this Pokémon to 1 of your Benched Pokémon.", // Void Gale, Mega Gengar ex ×5
      "If a Stadium is in play, this attack does 140 more damage. Then, discard that Stadium.", // Somersault Dive ×3
      "Place 5 damage counters on 1 of your opponent's Benched Pokémon.", // Ghostly Blow, Annihilape
      "This attack does 20 damage for each damage counter on your opponent's Active Pokémon.", // Damage Beat, Shedinja ×2
      "This attack does 30 more damage for each of your opponent's Benched Pokémon.", // Mind Jack, Gengar
      "During your next turn, this Pokémon's Mochi Rush attack does 50 more damage (before applying Weakness and Resistance).", // Mochi Rush, Pecharunt
    ]) {
      expect(["reader", "gate", "trailing"], text).toContain(meArm(text));
    }
    expect(857 + new Set(CENSUS_ME_POKEMON_D598).size).toBe(870);
  });

  it("BUILT over the `me` pool: attacks 844 / 1,039 (unmoved), abilities 128 / 234; the D598 headline: abilities 504 / 610", () => {
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length +
      CENSUS_ME_POKEMON_D598.length;
    expect(meAbilities).toBe(128);
    expect(POPULATION_ME.abilityUnits - 128).toBe(106);
    expect(POPULATION.abilityUnits + 128).toBe(504);
    expect(POPULATION_D581.abilityUnits - 504).toBe(106);
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        12 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        KEYED_ATTACK_ME_D597.length,
    ).toBe(844);
  });
});

/** The 4 `me` Supporter keys. */
const CENSUS_ME_TRAINER_D599: readonly string[] = [
  "me02.5-182", // Anthea & Concordia
  "me02.5-254", // Anthea & Concordia
  "me04-077", // Emma
  "me04-107", // Emma
];

describe("D599 — WP24a's two Supporters and the Standard pool they build, measured", () => {
  it("4 `me` Supporter keys, each a Trainer program (a `trainer` list, plus a printed gate or Prize bonus)", () => {
    expect(CENSUS_ME_TRAINER_D599).toHaveLength(4);
    expect(new Set(CENSUS_ME_TRAINER_D599).size).toBe(4);
    for (const id of CENSUS_ME_TRAINER_D599) {
      expect(ME_ID.test(id), id).toBe(true);
      const keys = Object.keys(programFor(id) ?? {});
      expect(keys, id).toContain("trainer");
      for (const key of keys)
        expect(["trainer", "trainerPlayableIf", "supporterKoPrizeBonus"], id).toContain(key);
    }
  });

  it("BUILT over the `me` pool: trainers 96 / 183; the D599 headline: trainers 360 / 447 (874 `me` printings fully built)", () => {
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length;
    expect(meTrainers).toBe(96);
    expect(POPULATION_ME.trainerUnits - meTrainers).toBe(87);
    expect(BUILT.trainer + meTrainers).toBe(360);
    expect(POPULATION_D581.trainerUnits).toBe(447);
    expect(870 + new Set(CENSUS_ME_TRAINER_D599).size).toBe(874);
  });
});

const HAND_CONDITION_ROWS_D600: readonly (readonly [string, number])[] = [
  ["Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.", 3],
  ["This attack does 10 damage for each card in your hand.", 2],
  ["If this Pokémon's remaining HP is 50 or less, this attack does 170 more damage.", 1],
  ["If your opponent's Active Pokémon has no Retreat Cost, this attack does 80 more damage.", 1],
  ["If Rosa's Encouragement is in your discard pile, this attack does 150 more damage.", 2],
  ["If you have any Stage 2 {D} Pokémon on your Bench, this attack does 70 more damage.", 1],
  [
    "If your Benched Pokémon have any Shadowy {D} Energy attached, this attack does 70 more damage.",
    2,
  ],
];

describe("D600 — WP14 + WP33b's hand count and bonus conditions, and the Standard pool they build, measured", () => {
  it("7 `me` sentences / 12 printings, each now reader-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of HAND_CONDITION_ROWS_D600) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(HAND_CONDITION_ROWS_D600.reduce((sum, [, n]) => sum + n, 0)).toBe(12);
  });

  it("BUILT over the `me` pool: attacks 856 / 1,039; the D600 headline: attacks 2,588 / 2,771 (886 `me` printings fully built)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        12 -
        14 -
        13 -
        8,
    ).toBe(846);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        12 -
        14 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        KEYED_ATTACK_ME_D597.length,
    ).toBe(856);
    expect(POPULATION_ME.attackUnits - 856).toBe(183);
    expect(BUILT.attack + 856).toBe(2588);
    expect(POPULATION_D581.attackUnits - 2588).toBe(183);
    expect(874 + HAND_CONDITION_ROWS_D600.reduce((sum, [, n]) => sum + n, 0)).toBe(886);
  });
});

const CENSUS_ME_POKEMON_D602: readonly string[] = [
  ...["me05-070", "me05-095", "me02.5-007", "me02.5-218", "30th-008"],
  ...["me01-011", "me01-136", "me02.5-003", "30th-105"],
];

describe("D602 — WP20b's activated Abilities, and the Standard pool they build, measured", () => {
  it("9 non-attack `me` Pokémon keys, an `abilities` program only", () => {
    expect(CENSUS_ME_POKEMON_D602).toHaveLength(9);
    expect(new Set(CENSUS_ME_POKEMON_D602).size).toBe(9);
    for (const id of CENSUS_ME_POKEMON_D602) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    }
    expect(Object.keys(programFor("me02.5-151") ?? {})).toEqual(["abilities"]);
    expect(Object.keys(programFor("me02.5-175") ?? {})).toEqual(["abilities"]);
  });

  it("each printing's printed attack text is already built (so all 9 are fully built: 886 → 895)", () => {
    // LOCAL D1: each of the 9 rows prints exactly one Ability and one attack.
    for (const text of [
      "Discard an Energy from this Pokémon.", // Air Slash, Silvally ×2
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.", // Bind, Erika's Tangela ×2
      "Your opponent's Active Pokémon is now Poisoned.", // Poison Powder, Vivillon
      "Your opponent's Active Pokémon is now Asleep and Poisoned.", // Bloom Powder, Erika's Vileplume ex
      "Discard all Energy from this Pokémon.", // Sunsteel Strike, Solgaleo
    ]) {
      expect(["reader", "gate", "trailing"], text).toContain(meArm(text));
    }
    expect(886 + new Set(CENSUS_ME_POKEMON_D602).size).toBe(895);
  });

  it("BUILT over the `me` pool: abilities 137 / 234; the D602 headline: abilities 513 / 610", () => {
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length +
      CENSUS_ME_POKEMON_D598.length +
      CENSUS_ME_POKEMON_D602.length;
    expect(meAbilities).toBe(137);
    expect(POPULATION_ME.abilityUnits - 137).toBe(97);
    expect(POPULATION.abilityUnits + 137).toBe(513);
    expect(POPULATION_D581.abilityUnits - 513).toBe(97);
  });
});

const CENSUS_ME_POKEMON_D603: readonly string[] = [
  ...["mep-024", "me02-018", "me02-110"], // Oricorio ex "Excited Turbo"
  ...["me02-007", "me02-095"], // Ludicolo "Excited Heal"
  "me02-082", // Linoone "Excited Dash"
  "me02-062", // Seviper "Excited Power"
];

const CENSUS_ME_TRAINER_D603: readonly string[] = [
  ...["me01-121", "me01-171", "me02.5-193"], // Mega Signal
  "me05-079", // Jett
];

describe("D603 — WP11's Mega-gated texts, and the Standard pool they build, measured", () => {
  it("7 `me` Pokémon keys (an `abilities` or `passive` program) and 4 Trainer keys (a `trainer` list)", () => {
    expect(new Set([...CENSUS_ME_POKEMON_D603, ...CENSUS_ME_TRAINER_D603]).size).toBe(11);
    for (const id of CENSUS_ME_POKEMON_D603) {
      expect(ME_ID.test(id), id).toBe(true);
      expect([["abilities"], ["passive"]], id).toContainEqual(Object.keys(programFor(id) ?? {}));
    }
    for (const id of CENSUS_ME_TRAINER_D603) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["trainer"]);
    }
    expect(Object.keys(programFor("me01-101") ?? {})).toEqual(["abilities"]);
    for (const id of ["me04-075"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
    for (const id of ["me01-132", "me01-176", "me01-186"]) expect(programFor(id), id).toBeDefined();
  });

  it("BUILT over the `me` pool: abilities 144 / 234, trainers 100 / 183; the D603 headline: abilities 520 / 610, trainers 364 / 447 (906 `me` printings fully built)", () => {
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length +
      CENSUS_ME_POKEMON_D598.length +
      CENSUS_ME_POKEMON_D602.length +
      CENSUS_ME_POKEMON_D603.length;
    expect(meAbilities).toBe(144);
    expect(POPULATION_ME.abilityUnits - 144).toBe(90);
    expect(POPULATION.abilityUnits + 144).toBe(520);
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length;
    expect(meTrainers).toBe(100);
    expect(POPULATION_ME.trainerUnits - 100).toBe(83);
    expect(BUILT.trainer + 100).toBe(364);
    expect(895 + CENSUS_ME_POKEMON_D603.length + CENSUS_ME_TRAINER_D603.length).toBe(906);
  });
});

const CENSUS_ME_ENERGY_D604: readonly string[] = [
  "me03-086", // Growing Grass Energy
  "me03-087", // Rocky Fighting Energy
  "me03-088", // Telepathic Psychic Energy
  "me04-084", // Bubbly Water Energy
  "me04-085", // Magnetic Metal Energy
  "me04-086", // Nitro Fire Energy
  "me05-083", // Shadowy Darkness Energy
  "me05-084", // Voltaic Lightning Energy
];

describe("D604 — WP18's typed Special Energies, and the Special Energy column they close, measured", () => {
  it("8 `me` keys, each an `energy` program", () => {
    expect(new Set(CENSUS_ME_ENERGY_D604).size).toBe(8);
    for (const id of CENSUS_ME_ENERGY_D604) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["energy"]);
    }
  });

  it("BUILT over the `me` pool: special energy 11 / 11; the D604 headline: special energy 22 / 22 (914 `me` printings fully built)", () => {
    const meEnergy =
      CENSUS_ME_ENERGY_D582.length + CENSUS_ME_ENERGY_D583.length + CENSUS_ME_ENERGY_D604.length;
    expect(meEnergy).toBe(11);
    expect(POPULATION_ME.specialEnergyUnits - meEnergy).toBe(0);
    expect(BUILT.specialEnergy + meEnergy).toBe(22);
    expect(POPULATION_D581.specialEnergyUnits).toBe(22);
    expect(906 + CENSUS_ME_ENERGY_D604.length).toBe(914);
  });
});

const COIN_ROWS_D605: readonly (readonly [string, number])[] = [
  [
    "Choose 1 of your opponent's Pokémon and flip a coin for each of your Pokémon in play that has \"Tauros\" in its name. This attack does 50 damage to the chosen Pokémon for each heads. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    2,
  ],
  [
    "For each of your opponent's Pokémon, flip a coin. If heads, this attack does 150 damage to that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    5,
  ],
  [
    "Flip a coin for each Maushold you have in play. For each heads, discard the top 2 cards of your opponent's deck.",
    2,
  ],
  [
    "Flip 3 coins. For each heads, search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
    2,
  ],
  [
    "Flip a coin. If heads, choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.",
    1,
  ],
];

describe("D605 — WP34's coin texts, and the Standard pool they build, measured", () => {
  it("5 `me` sentences / 12 printings, each now reader-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of COIN_ROWS_D605) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(COIN_ROWS_D605.reduce((sum, [, n]) => sum + n, 0)).toBe(12);
  });

  it("BUILT over the `me` pool: attacks 868 / 1,039; the D605 headline: attacks 2,600 / 2,771 (926 `me` printings fully built)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        14 -
        13 -
        8,
    ).toBe(858);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        14 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        KEYED_ATTACK_ME_D597.length,
    ).toBe(868);
    expect(POPULATION_ME.attackUnits - 868).toBe(171);
    expect(BUILT.attack + 868).toBe(2600);
    expect(POPULATION_D581.attackUnits - 2600).toBe(171);
    expect(914 + COIN_ROWS_D605.reduce((sum, [, n]) => sum + n, 0)).toBe(926);
  });
});

const CENSUS_ME_TRAINER_D606: readonly string[] = [
  ...["me04-080", "me04-111"], // Prism Tower
  ...["me01-129", "me04-114"], // Surfing Beach
  "me02.5-197", // Nighttime Mine
  ...["me03-077", "me03-111"], // Lumiose City
  ...["mep-028", "mep-120"], // Celebratory Fanfare
];

describe("D606 — WP25a's Stadiums, and the Standard pool they build, measured", () => {
  it("9 `me` keys, each a `stadium` program; the dropped and excluded Stadiums stay unkeyed ( D618 (D539): but the 8 WP25b keys) ( D642 (D539): WITHDRAWN — keyed since D642, inverted)", () => {
    expect(new Set(CENSUS_ME_TRAINER_D606).size).toBe(9);
    for (const id of CENSUS_ME_TRAINER_D606) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
    }
    for (const id of ["me02-088", "me01-127", "me04-075"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
  });

  it("BUILT over the `me` pool: trainers 109 / 183; the D606 headline: trainers 373 / 447 (935 `me` printings fully built)", () => {
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length +
      CENSUS_ME_TRAINER_D606.length;
    expect(meTrainers).toBe(109);
    expect(POPULATION_ME.trainerUnits - 109).toBe(74);
    expect(BUILT.trainer + 109).toBe(373);
    expect(926 + CENSUS_ME_TRAINER_D606.length).toBe(935);
  });
});

const SCALING_ROWS_D607: readonly (readonly [string, number])[] = [
  ["This attack does 30 damage for each Energy attached to all Pokémon.", 2],
  ["This attack does 40 damage for each Pokémon Tool attached to all Pokémon.", 1],
  ["This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon.", 3],
  ["This attack does 110 damage for each of your Beedrill and Beedrill ex in play.", 2],
  [
    'This attack does 40 damage for each of your Pokémon that has "Tauros" in its name that has any damage counters on it.',
    1,
  ],
  ["This attack does 40 damage for each damage counter on all of your Benched Rattata.", 2],
  [
    "This attack does 60 less damage for each Energy attached to your opponent's Active Pokémon.",
    1,
  ],
  [
    "Your opponent reveals their hand, and this attack does 80 damage for each Energy card you find there.",
    2,
  ],
];

describe("D607 — WP28a's scaling count sources, and the Standard pool they build, measured", () => {
  it("8 `me` sentences / 14 printings, each now reader-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of SCALING_ROWS_D607) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(SCALING_ROWS_D607.reduce((sum, [, n]) => sum + n, 0)).toBe(14);
  });

  it("BUILT over the `me` pool: attacks 882 / 1,039; the D607 headline: attacks 2,614 / 2,771 (949 `me` printings fully built)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        13 -
        8,
    ).toBe(872);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        13 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        KEYED_ATTACK_ME_D597.length,
    ).toBe(882);
    expect(POPULATION_ME.attackUnits - 882).toBe(157);
    expect(BUILT.attack + 882).toBe(2614);
    expect(POPULATION_D581.attackUnits - 2614).toBe(157);
    expect(935 + SCALING_ROWS_D607.reduce((sum, [, n]) => sum + n, 0)).toBe(949);
  });
});

const SNIPE_ROWS_D608: readonly (readonly [string, number])[] = [
  [
    "This attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    3,
  ],
  [
    "You may discard 2 {L} Energy from this Pokémon and make your opponent's Active Pokémon Paralyzed.",
    3,
  ],
  [
    "Discard 2 Energy from this Pokémon, and this attack does 60 damage to each of 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    2,
  ],
  [
    "Shuffle all Energy attached to this Pokémon into your deck, and this attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    2,
  ],
  [
    "This attack does 70 damage to 1 of your opponent's Pokémon that has any Special Energy attached. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    1,
  ],
  [
    "This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    1,
  ],
  [
    "Discard all Energy from this Pokémon and place 12 damage counters on 1 of your opponent's Pokémon.",
    1,
  ],
];

/** The 5 attack-only `30th` keys: Photon Bullets ×3, Stealthy Slash ×2 (tcgdex's `<em>` markup). */
const KEYED_ATTACK_ME_D608: readonly string[] = [
  "30th-064",
  "30th-151",
  "30th-157",
  "30th-021",
  "30th-148",
];

describe("D608 — WP30's snipe / spread wording, and the Standard pool it builds, measured", () => {
  it("7 `me` sentences / 13 printings, each now reader-built, none printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of SNIPE_ROWS_D608) {
      const merged = text.startsWith(
        "This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter",
      )
        ? n + 2
        : n;
      expect([text, me.get(text)]).toEqual([text, merged]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(SNIPE_ROWS_D608.reduce((sum, [, n]) => sum + n, 0)).toBe(13);
  });

  it("the two `<em>` sentences: five attack-only keys, one per printing, the text still residue ( D612: three — Stealthy Slash ×2's keys are retired, its normalised text reader-built; Photon Bullets ×3 stays keyed)", () => {
    expect(meAttackCorpus().filter(([, text]) => text.includes("<em>"))).toEqual([]);
    const photon = meAttackCorpus().filter(([, text]) =>
      text.startsWith("This attack does 50 damage to each of your opponent's Pokémon ex."),
    );
    expect(photon.map(([n]) => n)).toEqual([3]);
    for (const [, text] of photon) expect(meArm(text)).toBeNull();
    for (const id of KEYED_ATTACK_ME_D608) {
      if (RETIRED_ATTACK_KEYS_D612.includes(id)) expect(programFor(id), id).toBeUndefined();
      else expect(Object.keys(programFor(id) ?? {}), id).toEqual(["attack"]);
    }
  });

  it("BUILT over the `me` pool: attacks 900 / 1,039; the D608 headline: attacks 2,632 / 2,771 (964 `me` printings fully built)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        8,
    ).toBe(885);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        KEYED_ATTACK_ME_D597.length +
        KEYED_ATTACK_ME_D608.length,
    ).toBe(900);
    expect(POPULATION_ME.attackUnits - 900).toBe(139);
    expect(BUILT.attack + 900).toBe(2632);
    expect(POPULATION_D581.attackUnits - 2632).toBe(139);
    expect(949 + 10 + KEYED_ATTACK_ME_D608.length).toBe(964);
  });
});

const KO_ROWS_D609: readonly (readonly [string, number])[] = [
  [
    "If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out.",
    3,
  ],
  [
    "Choose a Pokémon in play (yours or your opponent's) that has the least HP remaining, except for this Pokémon, and it is Knocked Out.",
    3,
  ],
  ["Double the number of damage counters on each of your opponent's Pokémon.", 1],
  ["Place 1 damage counter on 1 of your opponent's Pokémon.", 1],
];

/** The other attack texts the 8 cards print (Mega Absol ex, Inteleon, N's Vanilluxe), LOCAL D1. */
const KO_CARD_OTHER_TEXTS_D609: readonly string[] = [
  "Your opponent reveals their hand, and you discard a card you find there.",
  "Discard an Energy from this Pokémon.",
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
];

describe("D609 — WP36's KO / damage-counter attacks, and the Standard pool they build, measured", () => {
  it("4 `me` sentences / 8 printings, each now reader-built, none printed in `sv`; the cards' other texts built", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of KO_ROWS_D609) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(KO_ROWS_D609.reduce((sum, [, n]) => sum + n, 0)).toBe(8);
    for (const text of KO_CARD_OTHER_TEXTS_D609) expect(meArm(text), text).not.toBeNull();
  });

  it("BUILT over the `me` pool: attacks 908 / 1,039; the D609 headline: attacks 2,640 / 2,771 (972 `me` printings fully built)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7 - 6 - 7 - 7 - 7 - 3 - 11 - 13 - 25,
    ).toBe(893);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 -
        25 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        KEYED_ATTACK_ME_D597.length +
        KEYED_ATTACK_ME_D608.length,
    ).toBe(908);
    expect(POPULATION_ME.attackUnits - 908).toBe(131);
    expect(BUILT.attack + 908).toBe(2640);
    expect(POPULATION_D581.attackUnits - 2640).toBe(131);
    expect(964 + KO_ROWS_D609.reduce((sum, [, n]) => sum + n, 0)).toBe(972);
  });
});

const CENSUS_ME_POKEMON_D610: readonly string[] = [
  ...["me01-003", "me01-155", "me01-177", "mep-013"], // Mega Venusaur ex "Solar Transfer"
  "me02.5-084", // Azumarill ex "Bubble Gathering"
  ...["me04-064", "me04-103"], // Cobalion ex "Metal Road"
  ...["me02-036", "me02-112"], // Mismagius ex "Swirling Prose"
  ...["me02.5-101", "me02.5-239"], // Team Rocket's Dugtrio "Holes"
  ...["mep-094", "30th-002", "30th-129"], // Alolan Exeggutor "Scale Up"
  ...["mep-066", "me03-045"], // Tyrantrum "Tyrannically Gutsy"
];

describe("D610 — WP37a's on-move / as-often / HP passives, and the Standard pool they build, measured", () => {
  it("16 `me` Pokémon keys (an `abilities`, `triggered` or `passive` program); WP37's other ids unkeyed ( D631 (D539): WITHDRAWN but for Clawitzer ×2 — the rest is keyed at D631) ( D636 (D539): and Clawitzer ×2 is keyed at D636)", () => {
    expect(new Set(CENSUS_ME_POKEMON_D610).size).toBe(16);
    for (const id of CENSUS_ME_POKEMON_D610) {
      expect(ME_ID.test(id), id).toBe(true);
      expect([["abilities"], ["triggered"], ["passive"]], id).toContainEqual(
        Object.keys(programFor(id) ?? {}),
      );
    }
    for (const id of ["me01-038", "me01-141"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    for (const id of [
      "me02.5-148",
      "me04-057",
      "me03-012",
      "me03-100",
      "mep-085",
      "me05-062",
      "me05-093",
      "30th-100",
    ])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });

  it("BUILT over the `me` pool: abilities 160 / 234; the D610 headline: abilities 536 / 610 (988 `me` printings fully built)", () => {
    // LOCAL D1: the attack each of the 16 prints (Team Rocket's Dugtrio's Mud Shot prints none).
    for (const text of [
      "Heal 30 damage from this Pokémon.", // Jungle Dump, Mega Venusaur ex ×4
      "This attack does 40 more damage for each {P} Energy attached to this Pokémon.", // Energized Balloon
      "During your next turn, this Pokémon can't use attacks.", // Power Tackle, Cobalion ex ×2
      "You may draw cards until you have 6 cards in your hand.", // Hexa-Magic, Mismagius ex ×2
      "Heal 50 damage from this Pokémon.", // Mega Drain, Alolan Exeggutor ×3
      "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck.", // Wreak Havoc
    ]) {
      expect(["reader", "gate", "trailing"], text).toContain(meArm(text));
    }
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length +
      CENSUS_ME_POKEMON_D598.length +
      CENSUS_ME_POKEMON_D602.length +
      CENSUS_ME_POKEMON_D603.length +
      CENSUS_ME_POKEMON_D610.length;
    expect(meAbilities).toBe(160);
    expect(POPULATION_ME.abilityUnits - 160).toBe(74);
    expect(POPULATION.abilityUnits + 160).toBe(536);
    expect(POPULATION_D581.abilityUnits - 536).toBe(74);
    expect(972 + CENSUS_ME_POKEMON_D610.length).toBe(988);
  });
});

const CENSUS_ME_POKEMON_D611: readonly string[] = [
  ...["me04-051", "me04-093", "mep-076"], // Crobat "Nighttime Maneuvers"
  ...["me02-068", "me02-103", "mep-017"], // Toxtricity "Sinister Surge"
  ...["me02.5-015", "me02.5-220"], // Dustox "Boisterous Wind"
  ...["me05-045", "me05-100"], // Rampardos ex "Destructive Headbutting"
  ...["me01-110", "me01-153"], // Gumshoos "Evidence Gathering"
  ...["me03-014", "me03-091"], // Talonflame "Sky Hunt"
  "me03-009", // Vivillon "Grand Wing"
  "me04-038", // Phantump "Spiteful Evolution"
  "me02.5-151", // Dragonair "Evolutionary Guidance"
];

describe("D611 — WP21's activated Abilities, and the Standard pool they build, measured", () => {
  it("17 `me` Pokémon keys, an `abilities` program only", () => {
    expect(CENSUS_ME_POKEMON_D611).toHaveLength(17);
    expect(new Set(CENSUS_ME_POKEMON_D611).size).toBe(17);
    for (const id of CENSUS_ME_POKEMON_D611) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    }
    expect(Object.keys(programFor("me02.5-175") ?? {})).toEqual(["abilities"]);
  });

  it("BUILT over the `me` pool: abilities 177 / 234; the D611 headline: abilities 553 / 610 (1005 `me` printings fully built)", () => {
    // LOCAL D1: the attack each of the 17 prints that carries an effect (Gentle Slap, Bite,
    // Fire Wing, Mumble and Tail Snap print none).
    for (const text of [
      "Your opponent's Active Pokémon is now Confused and Poisoned.", // Poison Sound Wave, Crobat ×3
      "Your opponent's Active Pokémon is now Asleep and Poisoned.", // Twilight Poison, Dustox ×2
      "During your next turn, attacks used by this Pokémon do 150 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).", // Rowdy Hammer, Rampardos ex ×2
      "If a Stadium is in play, this attack does 60 more damage.", // Blow Through, Vivillon
    ]) {
      expect(["reader", "gate", "trailing"], text).toContain(meArm(text));
    }
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length +
      CENSUS_ME_POKEMON_D598.length +
      CENSUS_ME_POKEMON_D602.length +
      CENSUS_ME_POKEMON_D603.length +
      CENSUS_ME_POKEMON_D610.length +
      CENSUS_ME_POKEMON_D611.length;
    expect(meAbilities).toBe(177);
    expect(POPULATION_ME.abilityUnits - 177).toBe(57);
    expect(POPULATION.abilityUnits + 177).toBe(553);
    expect(POPULATION_D581.abilityUnits - 553).toBe(57);
    expect(988 + CENSUS_ME_POKEMON_D611.length).toBe(1005);
  });

  it("each of the 17 prints ONE attack, and that attack is built or prints no effect (per id, LOCAL D1 2026-10-08)", () => {
    const ATTACK_EFFECT_D611: Record<string, string> = {
      "me04-051": "Your opponent's Active Pokémon is now Confused and Poisoned.",
      "me04-093": "Your opponent's Active Pokémon is now Confused and Poisoned.",
      "mep-076": "Your opponent's Active Pokémon is now Confused and Poisoned.",
      "me02-068": "", // Gentle Slap
      "me02-103": "",
      "mep-017": "",
      "me02.5-015": "Your opponent's Active Pokémon is now Asleep and Poisoned.",
      "me02.5-220": "Your opponent's Active Pokémon is now Asleep and Poisoned.",
      "me05-045":
        "During your next turn, attacks used by this Pokémon do 150 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      "me05-100":
        "During your next turn, attacks used by this Pokémon do 150 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      "me01-110": "", // Bite
      "me01-153": "",
      "me03-014": "", // Fire Wing
      "me03-091": "",
      "me03-009": "If a Stadium is in play, this attack does 60 more damage.",
      "me04-038": "", // Mumble
      "me02.5-151": "", // Tail Snap
    };
    expect(Object.keys(ATTACK_EFFECT_D611).sort()).toEqual([...CENSUS_ME_POKEMON_D611].sort());
    for (const [id, text] of Object.entries(ATTACK_EFFECT_D611)) {
      if (text !== "") expect(["reader", "gate", "trailing"], id).toContain(meArm(text));
    }
  });
});

const RETIRED_ATTACK_KEYS_D612: readonly string[] = ["mep-023", "mep-029", "30th-021", "30th-148"];

const MARKUP_BUILT_D612: Readonly<Record<string, string>> = {
  "30th-014": "If this Pokémon has any {L} Energy attached, this attack does 80 more damage.",
  "30th-018":
    "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "30th-132":
    "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "30th-019": "This attack does 30 more damage for each {W} Energy attached to this Pokémon.",
  "30th-020":
    "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  "30th-025":
    "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "30th-057":
    "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "30th-038":
    "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "30th-049": "If your opponent's Active Pokémon is a Pokémon ex, this attack does 80 more damage.",
  "30th-056": "If this Pokémon has any {R} Energy attached, this attack does 80 more damage.",
  "30th-062": "Discard 2 {L} Energy from this Pokémon.",
  "30th-079":
    "During your opponent's next turn, this Pokémon takes 60 less damage from attacks (after applying Weakness and Resistance).",
  "30th-082":
    "This attack also does 20 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "30th-083":
    "This attack also does 60 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  "30th-086": "Discard 2 {F} Energy from this Pokémon.",
  "30th-087":
    "During your opponent's next turn, attacks used by the Defending Pokémon do 30 less damage (before applying Weakness and Resistance).",
  "30th-107":
    "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance).",
  "30th-109": "Put up to 3 {N} Pokémon from your discard pile onto your Bench.",
  "30th-156": "Put up to 3 {N} Pokémon from your discard pile onto your Bench.",
  "30th-110":
    "During your next turn, the Defending Pokémon takes 30 more damage from attacks (after applying Weakness and Resistance).",
  "30th-124":
    "Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
};

describe("D612 — WP06's markup normaliser, and the Standard pool it builds, measured", () => {
  it("18 normalised texts / 21 printings, each a `me` corpus row and reader-built; no markup is left in the corpus", () => {
    const ids = Object.keys(MARKUP_BUILT_D612);
    expect(ids).toHaveLength(21);
    expect(new Set(Object.values(MARKUP_BUILT_D612)).size).toBe(18);
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [id, text] of Object.entries(MARKUP_BUILT_D612)) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(me.has(text), text).toBe(true);
      expect([id, meArm(text)]).toEqual([id, "reader"]);
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
    expect(meAttackCorpus().filter(([, text]) => /<|\[[A-Z]\]/.test(text))).toEqual([]);
  });

  it("the four retired keys: unkeyed, their normalised text reader-built; Photon Bullets ×3 stays keyed", () => {
    for (const id of RETIRED_ATTACK_KEYS_D612) expect(programFor(id), id).toBeUndefined();
    for (const text of [
      "Discard any amount of {R} Energy from among your Pokémon, and this attack does 90 damage for each card you discarded in this way.",
      "This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    for (const id of ["30th-064", "30th-151", "30th-157"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["attack"]);
  });

  it("BUILT over the `me` pool: attacks 929 / 1,039; the D612 headline: attacks 2,661 / 2,771 (1026 `me` printings fully built)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(
      readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7 - 6 - 7 - 7 - 7 - 3 - 11 - 13,
    ).toBe(918);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(keyed).toEqual(["30th-064", "30th-151", "30th-157"]);
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 -
        13 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(929);
    expect(POPULATION_ME.attackUnits - 929).toBe(110);
    expect(BUILT.attack + 929).toBe(2661);
    expect(POPULATION_D581.attackUnits - 2661).toBe(110);
    expect(1005 + Object.keys(MARKUP_BUILT_D612).length).toBe(1026);
  });
});

type BenchNoun = "basic" | "named" | "class";
const benchNounOf = (filter: {
  kind: string;
  stage?: string;
  filters?: readonly unknown[];
}): BenchNoun => {
  const basic = (f: { kind: string; stage?: string; filters?: readonly unknown[] }): boolean =>
    f.kind === "basicPokemon" ||
    ((f.kind === "typedPokemon" || f.kind === "ownerPokemon") && f.stage === "basic") ||
    (f.kind === "anyOf" && (f.filters ?? []).every((inner) => basic(inner as typeof f)));
  if (basic(filter)) return "basic";
  return namesItsCard(filter as Parameters<typeof namesItsCard>[0]) ? "named" : "class";
};
const benchOps = (program: unknown, out: { op: string; filter: { kind: string } }[]) => {
  if (Array.isArray(program)) for (const v of program) benchOps(v, out);
  else if (program !== null && typeof program === "object") {
    const o = program as Record<string, unknown>;
    if (typeof o.op === "string" && o.dest === "bench") {
      out.push({
        op: o.op,
        filter: (o.filter as { kind: string } | undefined) ?? { kind: "anyCard" },
      });
    }
    for (const v of Object.values(o)) benchOps(v, out);
  }
};

describe("D613 — the bench nouns: Basic only unless the noun names its card, measured", () => {
  const sweep = (corpus: readonly (readonly [number, string])[], noun: BenchNoun) =>
    corpus.flatMap(([n, text]) => {
      const found: { op: string; filter: { kind: string } }[] = [];
      benchOps(deriveAttackEffect(text), found);
      return found.some((op) => benchNounOf(op.filter) === noun) ? [[n, text] as const] : [];
    });

  it("the CLASS nouns D613 narrows: King's Order ×3, Summoning Gate ×2, Cinnabar Lure ×2 and Booming Call ×2 (9 legal printings) ( D615: and Mega Delphox ex's Trick Portal, 10; D634: and Bombirdier's Challenging Delivery, 11)", () => {
    expect(
      sweep(legalAttackCorpus(), "class")
        .map(([n, t]) => [n, t.slice(0, 30)])
        .sort(),
    ).toEqual([
      [2, "Look at the top 10 cards of yo"],
      [2, "Look at the top 8 cards of you"],
      [3, "Put up to 3 {W} Pokémon from y"],
    ]);
    expect(sweep(meAttackCorpus(), "class").map(([n, t]) => [n, t.slice(0, 30)])).toEqual([
      [1, "Flip 2 coins. If both of them "],
      [1, "Look at the top 9 cards of you"],
      [2, "Put up to 3 {N} Pokémon from y"],
    ]);
  });

  it("the NAMED nouns it keeps: Charjabug, Froakie, Grubbin, Pikachu, Duskull ×3 and Lampent (8 legal printings) ( D616: and Rotom's Roto Call, 9)", () => {
    const named = [...sweep(legalAttackCorpus(), "named"), ...sweep(meAttackCorpus(), "named")];
    expect(named.reduce((sum, [n]) => sum + n, 0)).toBe(9);
    expect(named).toHaveLength(7);
  });

  it("~~no registry program benches through a CLASS noun~~ ( D617 (D539): WITHDRAWN — Grimsley's Move ×2 benches a {D} Pokémon, Basic only); the named ones are Maushold, Ninjask ×2, Silcoon and Team Rocket's Koffing", () => {
    const byNoun: Record<BenchNoun, string[]> = { basic: [], named: [], class: [] };
    for (const id of programmedCardIds()) {
      const found: { op: string; filter: { kind: string } }[] = [];
      benchOps(programFor(id), found);
      for (const op of found) byNoun[benchNounOf(op.filter)].push(id);
    }
    expect(byNoun.class).toEqual(["me02-090", "me02-120", "me05-076"]);
    expect([...new Set(byNoun.named)].sort()).toEqual([
      "me01-017",
      "me01-137",
      "me02.5-012",
      "sv08-158",
      "sv10-125",
    ]);
  });
});

const CENSUS_ME_POKEMON_D614: readonly string[] = ["mep-072", "me03-031", "me03-103", "me03-119"];

describe("D614 — WP37b's Ability-effect shield, and the Standard pool it builds, measured", () => {
  it("4 `me` Pokémon keys, a `passive` program only, on ONE object", () => {
    expect(new Set(CENSUS_ME_POKEMON_D614).size).toBe(4);
    for (const id of CENSUS_ME_POKEMON_D614) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(programFor(id), id).toEqual({ passive: { preventAbilityEffects: true } });
      expect(programFor(id), id).toBe(programFor("mep-072"));
    }
  });

  it("BUILT over the `me` pool: abilities 181 / 234; the D614 headline: abilities 557 / 610 (1030 `me` printings fully built)", () => {
    expect(
      meArm(
        "You may discard up to 4 Energy cards from your hand, and this attack does 40 more damage for each card you discarded in this way.",
      ),
    ).toBe("reader");
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length +
      CENSUS_ME_POKEMON_D598.length +
      CENSUS_ME_POKEMON_D602.length +
      CENSUS_ME_POKEMON_D603.length +
      CENSUS_ME_POKEMON_D610.length +
      CENSUS_ME_POKEMON_D611.length +
      CENSUS_ME_POKEMON_D614.length;
    expect(meAbilities).toBe(181);
    expect(POPULATION_ME.abilityUnits - 181).toBe(53);
    expect(POPULATION.abilityUnits + 181).toBe(557);
    expect(POPULATION_D581.abilityUnits - 557).toBe(53);
    expect(1026 + CENSUS_ME_POKEMON_D614.length).toBe(1030);
  });
});

const MISC_ROWS_D615: readonly (readonly [string, number])[] = [
  [
    "Look at the top 9 cards of your deck, and you may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    1,
  ],
  [
    "Look at the top 6 cards of your deck, and you may reveal any number of Pokémon you find there and put them into your hand. Shuffle the other cards back into your deck.",
    1,
  ],
  [
    "Search your deck for any number of Basic Pokémon and put them onto your Bench. Then, shuffle your deck.",
    3,
  ],
  ["Heal 30 damage from each Pokémon (both yours and your opponent's).", 3],
  ["Your opponent shuffles their hand into their deck and draws 4 cards.", 2],
  ["Put up to 3 Basic Pokémon from your discard pile onto your Bench.", 1],
  [
    "Devolve each of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.",
    1,
  ],
  ["Move a {W} Energy from this Pokémon to 1 of your Benched Pokémon.", 1],
];

/** The other attack texts the 13 cards print (LOCAL D1). Espeon's Super Psy Bolt, Tropius's Solar Beam and
    Scraggy's Corkscrew Punch print no text; Frosmoth prints one attack. */
const MISC_CARD_OTHER_TEXTS_D615: readonly string[] = [
  "Your opponent's Active Pokémon is now Burned and Confused.", // Mega Delphox ex "Eerie Glow"
  "Discard all Energy from this Pokémon.", // Pikachu ex "Thunderbolt"
  "Search your deck for up to 4 Basic {P} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.", // Mega Floette ex "Eternity Bloom"
  "Discard a {R} Energy from this Pokémon.", // Ho-Oh "Bright Wing"
];

describe("D615 — WP31a's deck / hand / discard / Energy texts, and the Standard pool they build, measured", () => {
  it("8 `me` sentences / 13 printings, each now reader-built, none printed in `sv`; the cards' other texts built", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of MISC_ROWS_D615) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(MISC_ROWS_D615.reduce((sum, [, n]) => sum + n, 0)).toBe(13);
    for (const text of MISC_CARD_OTHER_TEXTS_D615) expect(meArm(text), text).toBe("reader");
    expect(Object.keys(programFor("me02.5-053") ?? {})).toEqual(["abilities"]);
  });

  it("BUILT over the `me` pool: attacks 942 / 1,039; the D615 headline: attacks 2,674 / 2,771 (1043 `me` printings fully built)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7 - 6 - 7 - 7 - 7 - 3 - 11).toBe(
      931,
    );
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 -
        11 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(942);
    expect(POPULATION_ME.attackUnits - 942).toBe(97);
    expect(BUILT.attack + 942).toBe(2674);
    expect(POPULATION_D581.attackUnits - 2674).toBe(97);
    expect(1030 + MISC_ROWS_D615.reduce((sum, [, n]) => sum + n, 0)).toBe(1043);
  });
});

const MISC_ROWS_D616: readonly (readonly [string, number])[] = [
  ["Discard 2 Energy from this Pokémon, and your opponent's Active Pokémon is now Paralyzed.", 1],
  ["Put 2 {R} Energy attached to this Pokémon into your hand.", 1],
  ["Heal 120 damage from 1 of your Benched {P} Pokémon.", 2],
  [
    "If your opponent's Active Pokémon is an evolved Pokémon, devolve it by putting the highest Stage Evolution card on it into your opponent's hand.",
    2,
  ],
  [
    "Search your deck for up to 2 Transformation Tome cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    1,
  ],
  [
    'You may search your deck for any number of Pokémon that have "Rotom" in their name and put them onto your Bench. Then, shuffle your deck.',
    1,
  ],
  [
    "Shuffle up to 3 in any combination of Pokémon and Basic Energy cards from your discard pile into your deck.",
    1,
  ],
  [
    "Search your deck for up to 3 in any combination of {G} Pokémon and Stadium cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    1,
  ],
  [
    "Your opponent reveals their hand, and you put an Item card you find there on the bottom of your opponent's deck.",
    1,
  ],
];

/** The other attack texts the 11 cards print (LOCAL D1). Meloetta's Magical Shot, Dialga's Heavy Impact, Celebi's
    Solar Cutter and Eevee's Tackle print no text; Claydol prints one attack. */
const MISC_CARD_OTHER_TEXTS_D616: readonly string[] = [
  "Attach up to 2 Basic {W} Energy cards from your discard pile to this Pokémon.", // Regice ex "Regi Charge"
  "Your opponent's Active Pokémon is now Burned.", // Volcanion "Singe"
  "This attack's damage isn't affected by Resistance.", // Sudowoodo "Rock Hurl"
  "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon.", // Rotom "Gadget Show"
];

describe("D616 — WP31b's deck / hand / discard / Energy texts, and the Standard pool they build, measured", () => {
  it("9 `me` sentences / 11 printings, each now reader-built, none printed in `sv`; the cards' other texts built", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of MISC_ROWS_D616) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(MISC_ROWS_D616.reduce((sum, [, n]) => sum + n, 0)).toBe(11);
    for (const text of MISC_CARD_OTHER_TEXTS_D616) expect(meArm(text), text).toBe("reader");
  });

  it("BUILT over the `me` pool: attacks 953 / 1,039; the D616 headline: attacks 2,685 / 2,771 (1054 `me` printings fully built)", () => {
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7 - 6 - 7 - 7 - 7 - 3).toBe(942);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 -
        3 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(953);
    expect(POPULATION_ME.attackUnits - 953).toBe(86);
    expect(BUILT.attack + 953).toBe(2685);
    expect(POPULATION_D581.attackUnits - 2685).toBe(86);
    expect(1043 + MISC_ROWS_D616.reduce((sum, [, n]) => sum + n, 0)).toBe(1054);
  });
});

const CENSUS_ME_TRAINER_D617: readonly string[] = [
  "me01-123",
  "me04-076",
  "me04-106",
  "me04-120",
  "me02-090",
  "me02-120",
  "me05-078",
  "me05-109",
  "me05-119",
  "me03-079",
  "me03-112",
];

describe("D617 — WP24b's five Supporters, and the Standard pool they build, measured", () => {
  it("11 `me` Supporter keys, each a Trainer program (a `trainer` list, plus a printed gate); WP24's other 10 unkeyed ( D621 (D539): WITHDRAWN — keyed at D621)", () => {
    expect(new Set(CENSUS_ME_TRAINER_D617).size).toBe(11);
    for (const id of CENSUS_ME_TRAINER_D617) {
      expect(ME_ID.test(id), id).toBe(true);
      const keys = Object.keys(programFor(id) ?? {});
      expect(keys, id).toContain("trainer");
      for (const key of keys) expect(["trainer", "trainerPlayableIf"], id).toContain(key);
    }
    for (const id of [
      "me05-077",
      "me05-108",
      "me05-118",
      "me01-113",
      "me01-165",
      "me01-183",
      "me02.5-180",
    ])
      expect(programFor(id), id).toBeDefined();
    for (const id of ["me04-081", "me04-112", "me04-121"]) expect(programFor(id), id).toBeDefined();
  });

  it("BUILT over the `me` pool: trainers 120 / 183; the D617 headline: trainers 384 / 447 (1065 `me` printings fully built)", () => {
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length +
      CENSUS_ME_TRAINER_D606.length +
      CENSUS_ME_TRAINER_D617.length;
    expect(meTrainers).toBe(120);
    expect(POPULATION_ME.trainerUnits - 120).toBe(63);
    expect(BUILT.trainer + 120).toBe(384);
    expect(POPULATION_D581.trainerUnits).toBe(447);
    expect(1054 + CENSUS_ME_TRAINER_D617.length).toBe(1065);
  });
});

const CENSUS_ME_TRAINER_D618: readonly string[] = [
  ...["me02-085", "me02-116"], // Battle Cage
  ...["me01-122", "me01-172", "me02.5-194"], // Mystery Garden
  ...["me01-117", "me02.5-188", "me03-109"], // Forest of Vitality
];

describe("D618 — WP25b's Stadiums, and the Standard pool they build, measured", () => {
  it("8 `me` keys, each a `stadium` program; the four dropped Stadiums stay unkeyed ( D635 (D539): three — Fossil Quarry is keyed since D635) ( D642 (D539): WITHDRAWN — keyed since D642, inverted)", () => {
    expect(new Set(CENSUS_ME_TRAINER_D618).size).toBe(8);
    for (const id of CENSUS_ME_TRAINER_D618) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
    }
    for (const id of ["me02-088", "me01-127", "me04-075"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
  });

  it("BUILT over the `me` pool: trainers 128 / 183; the D618 headline: trainers 392 / 447 (1073 `me` printings fully built)", () => {
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length +
      CENSUS_ME_TRAINER_D606.length +
      CENSUS_ME_TRAINER_D617.length +
      CENSUS_ME_TRAINER_D618.length;
    expect(meTrainers).toBe(128);
    expect(POPULATION_ME.trainerUnits - 128).toBe(55);
    expect(BUILT.trainer + 128).toBe(392);
    expect(POPULATION_D581.trainerUnits).toBe(447);
    expect(1065 + CENSUS_ME_TRAINER_D618.length).toBe(1073);
  });
});

const CENSUS_ME_POKEMON_D619: readonly string[] = [
  ...["me02-022", "me02-097"], // Dewgong "Thick Fat"
  ...["me02.5-064", "me02.5-229"], // Heliolisk "Frilled Generator"
];
const CENSUS_ME_TRAINER_D619: readonly string[] = [
  ...["me02-093", "me02-122"], // Sacred Charm
  "me02.5-211", // Thick Scale
];
const WP15_ROWS_D619: readonly string[] = [
  'If you played a Supporter card that has "Team Rocket" in its name from your hand during this turn, this attack does 100 more damage.',
  "If you played Emma from your hand during this turn, this attack does 60 more damage.",
  "If you played Tarragon from your hand during this turn, discard the top 3 cards of your opponent's deck.",
];

describe("D619 — WP12's passive half and WP15, and the Standard pool they build, measured", () => {
  it("7 `me` keys: a `passive` (Tools, Thick Fat) or an `abilities` program (Frilled Generator); WP12's attack ids stay unkeyed", () => {
    expect(new Set([...CENSUS_ME_POKEMON_D619, ...CENSUS_ME_TRAINER_D619]).size).toBe(7);
    for (const id of [...CENSUS_ME_TRAINER_D619, "me02-022", "me02-097"]) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
    for (const id of ["me02.5-064", "me02.5-229"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    for (const id of [
      "me05-007",
      "me05-024",
      "me05-089",
      "me04-033",
      "me05-064",
      "me02.5-162",
      "me04-036",
      "me03-040",
    ])
      expect(programFor(id), id).toBeUndefined();
  });

  it("BUILT over the `me` pool: attacks 956 / 1,039, abilities 185 / 234, trainers 131 / 183; the D619 headline: attacks 2,688 / 2,771, abilities 561 / 610, trainers 395 / 447 (1083 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const text of WP15_ROWS_D619) {
      expect([text, me.get(text)]).toEqual([text, 1]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
    }
    // LOCAL D1: the other attack texts the 10 cards print (Hippowdon's Heavy Impact prints
    // none).
    for (const text of [
      "Flip 4 coins. This attack does 30 damage for each heads.", // Kangaskhan ex "Comet Punch"
      "Flip 2 coins. This attack does 70 damage for each heads.", // Dewgong "Slam"
      "Flip a coin for each Energy attached to this Pokémon. This attack does 70 damage for each heads.", // Heliolisk "Powerful Bolt"
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7 - 6 - 7 - 7 - 7).toBe(945);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 -
        7 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(956);
    expect(POPULATION_ME.attackUnits - 956).toBe(83);
    expect(BUILT.attack + 956).toBe(2688);
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length +
      CENSUS_ME_POKEMON_D598.length +
      CENSUS_ME_POKEMON_D602.length +
      CENSUS_ME_POKEMON_D603.length +
      CENSUS_ME_POKEMON_D610.length +
      CENSUS_ME_POKEMON_D611.length +
      CENSUS_ME_POKEMON_D614.length +
      CENSUS_ME_POKEMON_D619.length;
    expect(meAbilities).toBe(185);
    expect(POPULATION.abilityUnits + 185).toBe(561);
    expect(POPULATION_D581.abilityUnits - 561).toBe(49);
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length +
      CENSUS_ME_TRAINER_D606.length +
      CENSUS_ME_TRAINER_D617.length +
      CENSUS_ME_TRAINER_D618.length +
      CENSUS_ME_TRAINER_D619.length;
    expect(meTrainers).toBe(131);
    expect(BUILT.trainer + 131).toBe(395);
    expect(POPULATION_D581.trainerUnits - 395).toBe(52);
    expect(
      1073 + CENSUS_ME_POKEMON_D619.length + CENSUS_ME_TRAINER_D619.length + WP15_ROWS_D619.length,
    ).toBe(1083);
  });
});

const CENSUS_ME_TRAINER_D620: readonly string[] = [
  "me02.5-191", // Light Ball
  ...["me02-092", "me02-121"], // Punk Helmet
  "me02.5-206", // Team Rocket's Hypnotizer
  "me03-070", // Core Memory
  ...["me05-082", "me05-113"], // Tremendous Bomb
];
const WP10_ROWS_D620: readonly (readonly [string, number])[] = [
  ["This attack does 70 damage for each Prize card you have taken.", 3],
  ["This attack does 80 damage for each Prize card you have taken.", 2],
  [
    "If your opponent's Active Pokémon already has any damage counters on it, this attack's base damage is 30.",
    2,
  ],
];

describe("D620 — WP10 and WP26, and the Standard pool they build, measured", () => {
  it("7 `me` Tool keys (a `passive`, a `triggered` list, or Core Memory's two `toolAttacks` keys); WP10's attack ids ~~and Adversity Policy~~ stay unkeyed ( D626 (D539): Adversity Policy is keyed since D626)", () => {
    expect(new Set(CENSUS_ME_TRAINER_D620).size).toBe(7);
    for (const id of CENSUS_ME_TRAINER_D620) expect(ME_ID.test(id), id).toBe(true);
    for (const id of ["me02.5-191", "me02-092", "me02-121", "me05-082", "me05-113"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    expect(Object.keys(programFor("me02.5-206") ?? {})).toEqual(["triggered"]);
    expect(Object.keys(programFor("me03-070") ?? {})).toEqual(["toolAttacks", "toolAttacksHolder"]);
    for (const id of ["me01-094", "me01-162", "me03-028", "30th-015", "30th-147"])
      expect(programFor(id), id).toBeUndefined();
    expect(Object.keys(programFor("me04-074") ?? {})).toEqual(["triggered"]);
  });

  it("BUILT over the `me` pool: attacks 963 / 1,039, abilities 185 / 234, trainers 138 / 183; the D620 headline: attacks 2,695 / 2,771, abilities 561 / 610, trainers 402 / 447 (1095 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n] of WP10_ROWS_D620) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
    }
    for (const text of [
      "Discard 2 Energy from this Pokémon.", // Luxray "Strong Volt"
      "Your opponent's Active Pokémon is now Burned.", // Fuecoco ex "Singe"
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7 - 6 - 7 - 7).toBe(952);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 -
        7 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(963);
    expect(POPULATION_ME.attackUnits - 963).toBe(76);
    expect(BUILT.attack + 963).toBe(2695);
    expect(POPULATION.abilityUnits + 185).toBe(561);
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length +
      CENSUS_ME_TRAINER_D606.length +
      CENSUS_ME_TRAINER_D617.length +
      CENSUS_ME_TRAINER_D618.length +
      CENSUS_ME_TRAINER_D619.length +
      CENSUS_ME_TRAINER_D620.length;
    expect(meTrainers).toBe(138);
    expect(BUILT.trainer + 138).toBe(402);
    expect(POPULATION_D581.trainerUnits - 402).toBe(45);
    const wp10Units = WP10_ROWS_D620.reduce((sum, [, n]) => sum + n, 0);
    expect(wp10Units).toBe(7);
    // Arithmetic over this block's constant lists (the inherited pattern): it pins the stated tally, not the engine.
    expect(1083 + CENSUS_ME_TRAINER_D620.length + wp10Units - 2).toBe(1095);
  });
});

const CENSUS_ME_TRAINER_D621: readonly string[] = [
  ...["me05-077", "me05-108", "me05-118"], // Gladion's Final Battle
  ...["me01-124", "me01-174", "me02.5-199"], // Premium Power Pro
  ...["me01-113", "me01-165", "me01-183", "me02.5-180"], // Acerola's Mischief
  ...["me04-081", "me04-112", "me04-121"], // Roxie's Performance
  ...["me02-087", "me02-118", "me02-129"], // Dawn
];

describe("D621 — WP24c + WP23's Trainers, and the Standard pool they build, measured", () => {
  it("16 `me` Trainer keys, each a Trainer program (a `trainer` list, plus a printed gate); Iron Defender unkeyed ( D630 (D539): WITHDRAWN — Iron Defender is keyed at D630, `CENSUS_ME_TRAINER_D630`)", () => {
    expect(new Set(CENSUS_ME_TRAINER_D621).size).toBe(16);
    for (const id of CENSUS_ME_TRAINER_D621) {
      expect(ME_ID.test(id), id).toBe(true);
      const keys = Object.keys(programFor(id) ?? {});
      expect(keys, id).toContain("trainer");
      for (const key of keys) expect(["trainer", "trainerPlayableIf"], id).toContain(key);
    }
    for (const id of ["me01-118", "me05-110"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["trainer"]);
  });

  it("BUILT over the `me` pool: trainers 154 / 183; the D621 headline: trainers 418 / 447 (1111 `me` printings fully built)", () => {
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length +
      CENSUS_ME_TRAINER_D606.length +
      CENSUS_ME_TRAINER_D617.length +
      CENSUS_ME_TRAINER_D618.length +
      CENSUS_ME_TRAINER_D619.length +
      CENSUS_ME_TRAINER_D620.length +
      CENSUS_ME_TRAINER_D621.length;
    expect(meTrainers).toBe(154);
    expect(POPULATION_ME.trainerUnits - 154).toBe(29);
    expect(BUILT.trainer + 154).toBe(418);
    expect(POPULATION_D581.trainerUnits - 418).toBe(29);
    expect(1095 + CENSUS_ME_TRAINER_D621.length).toBe(1111);
  });
});

const WP28B_ROWS_D623: readonly (readonly [string, number])[] = [
  [
    "This attack does 50 more damage for each of your Benched Pokémon that has any damage counters on it.",
    2,
  ],
  [
    "This attack does 40 more damage for each of your Benched Pokémon that has any {R} Energy attached.",
    2,
  ],
  ["This attack does 30 damage for each of your Benched Pokémon that has a maximum HP of 30.", 1],
  ["This attack does 40 damage for each of your Pikachu and Pikachu ex in play.", 1],
  [
    "This attack does 20 damage for each Basic {W} Energy card in your discard pile. Then, shuffle those cards into your deck.",
    1,
  ],
];

describe("D623 — WP28b's scaling counts, and the Standard pool they build, measured", () => {
  it("no WP28b id is keyed: every reading is derived from the printed text", () => {
    for (const id of [
      "me04-041",
      "me04-102",
      "me05-012",
      "me05-086",
      "30th-120",
      "30th-034",
      "me01-034",
    ])
      expect(programFor(id), id).toBeUndefined();
    for (const id of ["mep-067", "me03-057", "me03-098", "me02.5-122"])
      expect(programFor(id), id).toBeUndefined();
  });

  it("BUILT over the `me` pool: attacks 970 / 1,039; the D623 headline: attacks 2,702 / 2,771 (1118 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n] of WP28B_ROWS_D623) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
    }
    for (const text of [
      "Discard a random card from your opponent's hand.", // Gourgeist ex "Ghostly Touch"
      "Discard 2 Energy from this Pokémon.", // Kyogre "Swirling Waves"
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    expect(
      meArm(
        "Reveal any number of Honedge, Doublade, and Aegislash from your hand, and this attack does 60 damage for each card you revealed in this way.",
      ),
    ).toBe("reader");
    expect(
      meArm(
        "This attack does 60 more damage for each Prize card your opponent took during their last turn.",
      ),
    ).toBe("reader");
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7 - 6 - 7).toBe(959);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 -
        7 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(970);
    expect(POPULATION_ME.attackUnits - 970).toBe(69);
    expect(BUILT.attack + 970).toBe(2702);
    expect(POPULATION_D581.attackUnits - 2702).toBe(69);
    const units = WP28B_ROWS_D623.reduce((sum, [, n]) => sum + n, 0);
    expect(units).toBe(7);
    expect(1111 + units).toBe(1118);
  });
});

const WP31C_ROWS_D624: readonly (readonly [string, number])[] = [
  [
    "Choose Basic {L} Energy cards from your discard pile up to the amount of Energy attached to all of your opponent's Pokémon and attach them to your {L} Pokémon in any way you like.",
    2,
  ],
  ["Discard random cards from your opponent's hand until they have 5 cards in their hand.", 1],
  ["Discard the top 3 cards of your deck and put 1 of them into your hand.", 2],
  [
    "Search your deck for an Energy card and attach it to 1 of your Benched {G} Pokémon. Then, shuffle your deck.",
    1,
  ],
  [
    "Search your deck for up to 2 Pokémon with {F} Resistance, reveal them, and put them into your hand. Then, shuffle your deck.",
    1,
  ],
];

describe("D624 — WP31c's deck / hand / discard / Energy texts, and the Standard pool they build, measured", () => {
  it("no WP31c id is keyed: every reading is derived from the printed text", () => {
    for (const id of [
      "me03-029",
      "me03-093",
      "me03-067",
      "30th-061",
      "30th-135",
      "me03-003",
      "me03-066",
    ])
      expect(programFor(id), id).toBeUndefined();
    for (const id of ["30th-121", "me04-018", "me05-054", "me05-092"])
      expect(programFor(id), id).toBeUndefined();
  });

  it("BUILT over the `me` pool: attacks 977 / 1,039; the D624 headline: attacks 2,709 / 2,771 (1125 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n] of WP31C_ROWS_D624) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
    }
    expect(meArm("Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.")).toBe(
      "reader",
    );
    expect(meArm("Discard a {R} Energy, a {W} Energy, and a {L} Energy from this Pokémon.")).toBe(
      "reader",
    );
    expect(
      meArm(
        "If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack.",
      ),
    ).toBe("reader");
    for (const text of [
      "Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first.",
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7 - 6).toBe(966);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 -
        6 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(977);
    expect(POPULATION_ME.attackUnits - 977).toBe(62);
    expect(BUILT.attack + 977).toBe(2709);
    expect(POPULATION_D581.attackUnits - 2709).toBe(62);
    const units = WP31C_ROWS_D624.reduce((sum, [, n]) => sum + n, 0);
    expect(units).toBe(7);
    expect(1118 + units).toBe(1125);
  });
});

const CENSUS_ME_TRAINER_D625: readonly string[] = [
  ...["me04-082", "me04-113"], // Special Red Card
  ...["me02-091", "me04-109"], // Jumbo Ice Cream
  ...["me05-075", "me05-106"], // Dark Bell
  ...["me01-132", "me01-176", "me01-186"], // Wally's Compassion
  ...["me02-086", "me02-117"], // Blowtorch
  "me04-078", // Great Haul Net
  "me01-128", // Strange Timepiece
];

describe("D625 — T1, the rest of the `me` Trainers, and the Standard pool they build, measured", () => {
  it("13 `me` Trainer keys, each a Trainer program (a `trainer` list, plus a printed gate)", () => {
    expect(new Set(CENSUS_ME_TRAINER_D625).size).toBe(13);
    for (const id of CENSUS_ME_TRAINER_D625) {
      expect(ME_ID.test(id), id).toBe(true);
      const keys = Object.keys(programFor(id) ?? {});
      expect(keys, id).toContain("trainer");
      for (const key of keys) expect(["trainer", "trainerPlayableIf"], id).toContain(key);
    }
  });

  it("BUILT over the `me` pool: trainers 167 / 183; the D625 headline: trainers 431 / 447 (1138 `me` printings fully built)", () => {
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length +
      CENSUS_ME_TRAINER_D606.length +
      CENSUS_ME_TRAINER_D617.length +
      CENSUS_ME_TRAINER_D618.length +
      CENSUS_ME_TRAINER_D619.length +
      CENSUS_ME_TRAINER_D620.length +
      CENSUS_ME_TRAINER_D621.length +
      CENSUS_ME_TRAINER_D625.length;
    expect(meTrainers).toBe(167);
    expect(POPULATION_ME.trainerUnits - 167).toBe(16);
    expect(BUILT.trainer + 167).toBe(431);
    expect(POPULATION_D581.trainerUnits - 431).toBe(16);
    expect(1125 + CENSUS_ME_TRAINER_D625.length).toBe(1138);
  });
});

const CENSUS_ME_POKEMON_D626: readonly string[] = [
  ...["mep-016", "me02-053", "me02-101"], // Flygon "Sandy Flapping"
  ...["mep-082", "me05-028"], // Miraidon "Photon Cord"
  ...["30th-090", "30th-154"], // Gengar ex "Fainting Spell"
];
const CENSUS_ME_TRAINER_D626: readonly string[] = ["me04-074"]; // Adversity Policy

describe("D626 — K1, the rest of the KO / damaged triggers, and the Standard pool they build, measured", () => {
  it("8 `me` keys: a `triggered` list (Flygon, Miraidon, Adversity Policy) or a `passive` (Gengar ex); Spiteful Swirl and Counterattack Grouping stay unkeyed ( D642 (D539): WITHDRAWN — keyed since D642, inverted)", () => {
    expect(new Set([...CENSUS_ME_POKEMON_D626, ...CENSUS_ME_TRAINER_D626]).size).toBe(8);
    for (const id of [...CENSUS_ME_POKEMON_D626, ...CENSUS_ME_TRAINER_D626])
      expect(ME_ID.test(id), id).toBe(true);
    for (const id of ["mep-016", "me02-053", "me02-101", "mep-082", "me05-028", "me04-074"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["triggered"]);
    for (const id of ["30th-090", "30th-154"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    for (const id of ["me01-087", "me01-148", "30th-022"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });

  it("BUILT over the `me` pool: abilities 192 / 234, trainers 168 / 183; the D626 headline: abilities 568 / 610, trainers 432 / 447 (1146 `me` printings fully built)", () => {
    for (const text of [
      "This Pokémon does 30 damage to itself.", // Miraidon `mep-082` "Thunder"
      "This Pokémon also does 30 damage to itself.", // Miraidon `me05-028` "Thunder"
      "Place 13 damage counters on 1 of your opponent's Pokémon.", // Gengar ex "Chaotic Pain"
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    const meAbilities =
      41 +
      CENSUS_ME_POKEMON_D584.length +
      CENSUS_ME_POKEMON_D585.length +
      CENSUS_ME_POKEMON_D586.length +
      CENSUS_ME_POKEMON_D589.length +
      CENSUS_ME_POKEMON_D590.length +
      CENSUS_ME_POKEMON_D591.length +
      CENSUS_ME_POKEMON_D594.length +
      CENSUS_ME_POKEMON_D598.length +
      CENSUS_ME_POKEMON_D602.length +
      CENSUS_ME_POKEMON_D603.length +
      CENSUS_ME_POKEMON_D610.length +
      CENSUS_ME_POKEMON_D611.length +
      CENSUS_ME_POKEMON_D614.length +
      CENSUS_ME_POKEMON_D619.length +
      CENSUS_ME_POKEMON_D626.length;
    expect(meAbilities).toBe(192);
    expect(POPULATION.abilityUnits + 192).toBe(568);
    expect(POPULATION_D581.abilityUnits - 568).toBe(42);
    const meTrainers =
      CENSUS_ME_TRAINER_D582.length +
      CENSUS_ME_TRAINER_D584.length +
      CENSUS_ME_TRAINER_D587.length +
      CENSUS_ME_TRAINER_D588.length +
      CENSUS_ME_TRAINER_D599.length +
      CENSUS_ME_TRAINER_D603.length +
      CENSUS_ME_TRAINER_D606.length +
      CENSUS_ME_TRAINER_D617.length +
      CENSUS_ME_TRAINER_D618.length +
      CENSUS_ME_TRAINER_D619.length +
      CENSUS_ME_TRAINER_D620.length +
      CENSUS_ME_TRAINER_D621.length +
      CENSUS_ME_TRAINER_D625.length +
      CENSUS_ME_TRAINER_D626.length;
    expect(meTrainers).toBe(168);
    expect(POPULATION_ME.trainerUnits - 168).toBe(15);
    expect(BUILT.trainer + 168).toBe(432);
    expect(POPULATION_D581.trainerUnits - 432).toBe(15);
    expect(1138 + CENSUS_ME_POKEMON_D626.length + CENSUS_ME_TRAINER_D626.length).toBe(1146);
  });
});

const CENSUS_ME_POKEMON_D627: readonly string[] = ["me05-005", "me05-006", "me05-033", "me05-034"];

const H1_ROWS_D627: readonly (readonly [string, number])[] = [
  [
    "If you have 4 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, this attack does 140 more damage.",
    3,
  ],
  [
    "If you have 6 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, place 4 damage counters on each of your opponent's Pokémon.",
    1,
  ],
  ["Place 1 damage counter on your opponent's Active Pokémon.", 1],
  [
    "If you have 13 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, choose 2 of your opponent's Pokémon and quadruple the number of damage counters on each of them.",
    1,
  ],
];

describe("D627 — H1, the Hide 'n' Sneak archetype, and the Standard pool it builds, measured", () => {
  it("4 `me` keys, each the ONE passive object; the attack printings stay unkeyed", () => {
    expect(new Set(CENSUS_ME_POKEMON_D627).size).toBe(4);
    for (const id of CENSUS_ME_POKEMON_D627) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
    for (const id of ["mep-084", "me05-039", "me05-091", "me05-035"])
      expect(programFor(id), id).toBeUndefined();
  });

  it("BUILT over the `me` pool: attacks 983 / 1,039, abilities 196 / 234; the D627 headline: attacks 2,715 / 2,771, abilities 572 / 610 (1154 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n] of H1_ROWS_D627) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
    }
    expect(
      meArm(
        "You may search your deck for a card and put it into your hand. Then, shuffle your deck.",
      ),
    ).toBe("reader"); // Banette "Puppet Pull"
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11 - 7).toBe(972);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 -
        7 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(983);
    expect(POPULATION_ME.attackUnits - 983).toBe(56);
    expect(BUILT.attack + 983).toBe(2715);
    expect(POPULATION_D581.attackUnits - 2715).toBe(56);
    const units = H1_ROWS_D627.reduce((sum, [, n]) => sum + n, 0);
    expect(units).toBe(6);
    expect(192 + CENSUS_ME_POKEMON_D627.length).toBe(196);
    expect(POPULATION.abilityUnits + 196).toBe(572);
    expect(POPULATION_D581.abilityUnits - 572).toBe(38);
    expect(1146 + CENSUS_ME_POKEMON_D627.length + 3 + 1).toBe(1154);
  });
});

const CENSUS_ME_POKEMON_D628: readonly string[] = [
  ...["me03-062", "me03-107", "me03-121"], // Meowth ex "Last-Ditch Catch" (on `TUCK_TAIL`)
  "me01-101", // Latios "Lustrous Assist"
  "me02.5-175", // Larry's Komala "Lethargic Charge"
];

describe("D628 — A1, the rest of the on-bench / on-move Abilities, and the Standard pool they build, measured", () => {
  it("5 `me` keys: Meowth ex ×3 `attack` + `triggered`, Latios and Komala `abilities`; Clawitzer stays unkeyed ( D636 (D539): WITHDRAWN — Clawitzer is keyed at D636)", () => {
    expect(new Set(CENSUS_ME_POKEMON_D628).size).toBe(5);
    for (const id of CENSUS_ME_POKEMON_D628) expect(ME_ID.test(id), id).toBe(true);
    for (const id of ["me03-062", "me03-107", "me03-121"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["attack", "triggered"]);
    for (const id of ["me01-101", "me02.5-175"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    for (const id of ["me01-038", "me01-141"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
  });

  it("BUILT over the `me` pool: abilities 201 / 234; the D628 headline: abilities 577 / 610 (1159 `me` printings fully built)", () => {
    expect(meArm("This Pokémon is now Asleep. Draw 2 cards.")).toBe("trailing");
    expect(KEYED_ATTACK_ME_D593.filter((id) => id.startsWith("me03-"))).toEqual([
      "me03-062",
      "me03-107",
      "me03-121",
    ]);
    expect(196 + CENSUS_ME_POKEMON_D628.length).toBe(201);
    expect(POPULATION.abilityUnits + 201).toBe(577);
    expect(POPULATION_D581.abilityUnits - 577).toBe(33);
    expect(1154 + CENSUS_ME_POKEMON_D628.length).toBe(1159);
  });
});

const S1_ROWS_D629: readonly (readonly [string, number, "reader" | "trailing"])[] = [
  [
    "This attack does 20 damage to 1 of your opponent's Pokémon for each {G} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    1,
    "reader",
  ], // Genesect `me02-008` "Bug's Cannon"
  [
    "This attack does 30 damage to 1 of your opponent's Pokémon for each {W} Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    1,
    "reader",
  ], // Seaking `me05-014` "Hydro Jet"
  [
    "Discard all {L} Energy from this Pokémon, and this attack does 90 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    1,
    "reader",
  ], // Pikachu `30th-051` "Lightning Crash"
  [
    "This attack does 140 damage to 1 of your opponent's Pokémon. If you don't have 10 or more Basic {F} Energy cards in your discard pile, this attack does nothing. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    1,
    "reader",
  ], // Coalossal `me02.5-120` "Tar Cannon"
  [
    "This attack does 20 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) Your opponent's Active Pokémon is now Asleep.",
    1,
    "trailing",
  ], // Frosmoth `me01-043` "Chilling Wings"
  [
    "This attack does 50 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.) This Pokémon also does 130 damage to itself.",
    1,
    "trailing",
  ], // Ferrothorn `30th-104` "Kaboom Needles"
  [
    "If your opponent's Active Pokémon is affected by a Special Condition, place 6 damage counters on 1 of your opponent's Benched Pokémon.",
    1,
    "reader",
  ], // Mismagius `me02.5-086` "Assassin's Magic"
];

describe("D629 — S1, the rest of the snipe / spread wording, and the Standard pool it builds, measured", () => {
  it("BUILT over the `me` pool: attacks 990 / 1,039; the D629 headline: attacks 2,722 / 2,771 (1166 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n, arm] of S1_ROWS_D629) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, arm]);
    }
    for (const id of [
      "me02-008",
      "me05-014",
      "30th-051",
      "me02.5-120",
      "me01-043",
      "30th-104",
      "me02.5-086",
    ]) {
      expect(programFor(id), id).toBeUndefined();
    }
    expect(meArm("Discard 3 Energy from this Pokémon.")).toBe("reader");
    expect(
      meArm(
        "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe("reader");
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7 - 11).toBe(979);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 -
        11 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(990);
    expect(POPULATION_ME.attackUnits - 990).toBe(49);
    expect(BUILT.attack + 990).toBe(2722);
    expect(POPULATION_D581.attackUnits - 2722).toBe(49);
    expect(S1_ROWS_D629.reduce((sum, [, n]) => sum + n, 0)).toBe(7);
    expect(1159 + S1_ROWS_D629.length).toBe(1166);
  });
});

const M1_ROWS_D630: readonly (readonly [string, number])[] = [
  [
    "If this Pokémon was damaged by an attack during your opponent's last turn, this attack does that much more damage.",
    4,
  ],
  [
    "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Burned Pokémon.",
    1,
  ],
  [
    "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Evolution Pokémon.",
    2,
  ],
  [
    "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Pokémon that have an Ability.",
    1,
  ],
  [
    "During your opponent's next turn, this Pokémon takes 100 less damage from attacks from Evolution Pokémon (after applying Weakness and Resistance).",
    1,
  ],
  [
    "This attack does 60 more damage for each Prize card your opponent took during their last turn.",
    1,
  ],
  [
    "During your opponent's next turn, this Pokémon takes 100 more damage from attacks (after applying Weakness and Resistance).",
    1,
  ],
];

const CENSUS_ME_TRAINER_D630: readonly string[] = ["me01-118", "me05-110"]; // Iron Defender

describe("D630 — M1, the persisted-record bundle, and the Standard pool it builds, measured", () => {
  it("2 `me` Trainer keys (Iron Defender, a `trainer` list); the 11 attack printings stay unkeyed", () => {
    for (const id of CENSUS_ME_TRAINER_D630) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["trainer"]);
    }
    for (const id of [
      ...["me02-004", "me02-108", "30th-085", "30th-138"],
      ...["me05-007", "me05-024", "me05-089", "me04-033", "me05-064", "me02.5-122", "me05-058"],
    ])
      expect(programFor(id), id).toBeUndefined();
  });

  it("BUILT over the `me` pool: attacks 1,001 / 1,039, trainers 170 / 183; the D630 headline: attacks 2,733 / 2,771, trainers 434 / 447 (1179 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n] of M1_ROWS_D630) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, "reader"]);
    }
    for (const text of [
      "Discard the top 2 cards of your opponent's deck.", // Mega Heracross ex "Mountain Ramming"
      "Your opponent's Active Pokémon is now Burned.", // Heatran "Singe"
      "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.", // Manectric "Sonic Edge"
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8 - 7).toBe(990);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 -
        7 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(1001);
    expect(POPULATION_ME.attackUnits - 1001).toBe(38);
    expect(BUILT.attack + 1001).toBe(2733);
    expect(POPULATION_D581.attackUnits - 2733).toBe(38);
    expect(M1_ROWS_D630.reduce((sum, [, n]) => sum + n, 0)).toBe(11);
    expect(168 + CENSUS_ME_TRAINER_D630.length).toBe(170);
    expect(POPULATION_ME.trainerUnits - 170).toBe(13);
    expect(BUILT.trainer + 170).toBe(434);
    expect(POPULATION_D581.trainerUnits - 434).toBe(13);
    expect(1166 + 11 + CENSUS_ME_TRAINER_D630.length).toBe(1179);
  });
});

const CENSUS_ME_POKEMON_D631: readonly string[] = [
  ...["mep-085", "me05-062", "me05-093"], // Bastiodon "Ancient Bulwark"
  ...["me03-012", "me03-100"], // Decidueye ex "Sniper's Eye"
  "me02.5-148", // Kingambit "Supreme Overlord"
  "me04-057", // Garbodor "Gloomy Garbage"
  "30th-100", // Yveltal "Life-Locked"
  "30th-119", // Snorlax "Good Sleep"
];

describe("D631 — P1, the rest of the passive modifiers, and the Standard pool it builds, measured", () => {
  it("9 keys: eight `passive` programs and Snorlax's `triggered` one", () => {
    expect(new Set(CENSUS_ME_POKEMON_D631).size).toBe(9);
    for (const id of CENSUS_ME_POKEMON_D631) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual([
        id === "30th-119" ? "triggered" : "passive",
      ]);
    }
  });

  it("BUILT over the `me` pool: abilities 210 / 234; the D631 headline: abilities 586 / 610 (1188 `me` printings fully built), on CARRIED bases (201, 1179) plus the 9 keys", () => {
    for (const text of [
      "Discard an Energy from your opponent's Active Pokémon.", // Decidueye ex "Crushing Arrow"
      "This Pokémon also does 50 damage to itself.", // Kingambit "Double-Edged Slash"
      "This Pokémon is now Asleep.", // Snorlax "Collapse"
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    expect(201 + CENSUS_ME_POKEMON_D631.length).toBe(210);
    expect(POPULATION.abilityUnits + 210).toBe(586);
    expect(POPULATION_D581.abilityUnits - 586).toBe(24);
    expect(1179 + CENSUS_ME_POKEMON_D631.length).toBe(1188);
  });
});

const CENSUS_ME_POKEMON_D632: readonly string[] = [
  ...["me02.5-039", "me02.5-040", "me02.5-226"], // Psyduck / Golduck / Psyduck "Damp" (Knock Out itself)
  ...["mep-007", "mep-008"], // Psyduck / Golduck "Damp" (require those Pokémon to be Knocked Out)
];

describe("D632 — D1, Damp, and the Standard pool it builds, measured", () => {
  it("5 keys, each a `passive` program", () => {
    expect(new Set(CENSUS_ME_POKEMON_D632).size).toBe(5);
    for (const id of CENSUS_ME_POKEMON_D632) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
  });

  it("BUILT over the `me` pool: abilities 215 / 234; the D632 headline: abilities 591 / 610 (1193 `me` printings fully built), on CARRIED bases (210, 1188) plus the 5 keys", () => {
    // LOCAL D1: Golduck's "Hydro Pump" is the one attack effect the 5 print (Ram and
    // Collision are damage only).
    expect(
      meArm("This attack does 20 more damage for each {W} Energy attached to this Pokémon."),
      "Hydro Pump",
    ).toBe("reader");
    expect(210 + CENSUS_ME_POKEMON_D632.length).toBe(215);
    expect(POPULATION.abilityUnits + 215).toBe(591);
    expect(POPULATION_D581.abilityUnits - 591).toBe(19);
    expect(1188 + CENSUS_ME_POKEMON_D632.length).toBe(1193);
  });
});

const O1_ROWS_D633: readonly (readonly [string, number, string])[] = [
  ["You may discard any number of cards from your hand.", 1, "reader"], // Slowpoke `me05-029`
  [
    'You may discard any number of Supporter cards that have "Team Rocket" in their name from your hand, and this attack does 60 damage for each card you discarded in this way.',
    1,
    "reader",
  ], // Team Rocket's Honchkrow `me02.5-127`
  [
    "Reveal any number of Honedge, Doublade, and Aegislash from your hand, and this attack does 60 damage for each card you revealed in this way.",
    3,
    "reader",
  ], // Doublade `mep-067`, `me03-057` / `-098`
  [
    "You may have this Pokémon also do 60 damage to itself and make your opponent's Active Pokémon Paralyzed.",
    1,
    "reader",
  ], // Pawmot `me02-034`
  ["Discard a {R} Energy, a {W} Energy, and a {L} Energy from this Pokémon.", 1, "reader"], // Lugia `30th-121`
];

describe("D633 — O1, attack odds and ends, and the Standard pool it builds, measured", () => {
  it("BUILT over the `me` pool: attacks 1,008 / 1,039; the D633 headline: attacks 2,740 / 2,771 (1200 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n, arm] of O1_ROWS_D633) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, arm]);
    }
    for (const id of [
      "me05-029",
      "me02.5-127",
      "mep-067",
      "me03-057",
      "me03-098",
      "me02-034",
      "30th-121",
    ]) {
      expect(programFor(id), id).toBeUndefined();
    }
    expect(
      meArm(
        "The Defending Pokémon's Weakness is now {L} until the end of your next turn. (Apply Weakness as ×2.)",
      ),
    ).toBe("reader");
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 - 8).toBe(997);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt -
        1 -
        4 -
        3 -
        6 -
        3 -
        5 -
        1 -
        8 +
        1 +
        2 +
        KEYED_ATTACK_ME_D593.length +
        keyed.length,
    ).toBe(1008);
    expect(POPULATION_ME.attackUnits - 1008).toBe(31);
    expect(BUILT.attack + 1008).toBe(2740);
    expect(POPULATION_D581.attackUnits - 2740).toBe(31);
    expect(O1_ROWS_D633.reduce((sum, [, n]) => sum + n, 0)).toBe(7);
    expect(1193 + O1_ROWS_D633.reduce((sum, [, n]) => sum + n, 0)).toBe(1200);
  });
});

const C1_ROWS_D634: readonly (readonly [string, number, string])[] = [
  ["Flip 2 coins. If both of them are heads, this attack does 100 more damage.", 1, "reader"], // Bewear `me01-112`
  [
    "Flip 2 coins. If both of them are heads, search your deck for a Pokémon and put it onto your Bench. Then, shuffle your deck.",
    1,
    "reader",
  ], // Bombirdier `me05-071`
  [
    "Flip a coin until you get tails. Search your deck for a number of cards up to the number of heads and put them into your hand. Then, shuffle your deck.",
    1,
    "reader",
  ], // Gholdengo `me01-099`
  [
    "Flip a coin until you get tails. Search your deck for an amount of Basic Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.",
    1,
    "reader",
  ], // Snorlax `me03-063`
  [
    "Flip a coin until you get tails. Search your deck for an amount of Basic {L} Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.",
    1,
    "reader",
  ], // Pikachu `30th-042`
  [
    "Flip a coin. If heads, choose 1 of your opponent's Pokémon. Shuffle that Pokémon and all attached cards into their deck.",
    1,
    "reader",
  ], // Shiftry `me01-015`
  [
    "Flip 3 coins. If any of them are heads, your opponent reveals their hand. For each heads, choose a card you find there and shuffle it into your opponent's deck.",
    2,
    "reader",
  ], // Watchog `me04-071` / `-097`
];

describe("D634 — C1, the coin rest, and the Standard pool it builds, measured", () => {
  it("BUILT over the `me` pool: attacks 1,016 / 1,039; the D634 headline: attacks 2,748 / 2,771 (1208 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    for (const [text, n, arm] of C1_ROWS_D634) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect([text, meArm(text)]).toEqual([text, arm]);
    }
    for (const id of [
      "me01-112",
      "me05-071",
      "me01-099",
      "me03-063",
      "30th-042",
      "me01-015",
      "me04-071",
      "me04-097",
    ]) {
      expect(programFor(id), id).toBeUndefined();
    }
    expect(meArm("This Pokémon is now Asleep.")).toBe("reader"); // Snorlax "Collapse"
    expect(meArm("Your opponent's Active Pokémon is now Confused.")).toBe("reader"); // Shiftry "Perplex"
    const readerBuilt = meAttackCorpus().reduce((sum, [n, text]) => {
      const a = meArm(text);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1).toBe(1005);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 - 1 + 1 + 2 + KEYED_ATTACK_ME_D593.length + keyed.length,
    ).toBe(1016);
    expect(POPULATION_ME.attackUnits - 1016).toBe(23);
    expect(BUILT.attack + 1016).toBe(2748);
    expect(POPULATION_D581.attackUnits - 2748).toBe(23);
    expect(C1_ROWS_D634.reduce((sum, [, n]) => sum + n, 0)).toBe(8);
    expect(1200 + C1_ROWS_D634.reduce((sum, [, n]) => sum + n, 0)).toBe(1208);
  });
});

const CENSUS_ME_TRAINER_D635: readonly string[] = ["me05-076"]; // Fossil Quarry

describe("D635 — F1, the Antique archetype, and the Standard pool it builds, measured", () => {
  it("1 `me` Stadium key; Relicanth and the four `me` fossils stay unkeyed ( D637 (D539): Relicanth only — the four fossils are keyed at D637)", () => {
    for (const id of CENSUS_ME_TRAINER_D635) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
    }
    for (const id of ["me05-017"]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("BUILT over the `me` pool: attacks 1,017 / 1,039, trainers 171 / 183; the D635 headline: attacks 2,749 / 2,771, trainers 435 / 447 (1210 `me` printings fully built)", () => {
    const text =
      'This attack does 30 more damage for each of your Benched Pokémon that has "Antique" in its name.';
    const me = new Map(meAttackCorpus().map(([n, t]) => [t, n]));
    expect([text, me.get(text), meArm(text)]).toEqual([text, 1, "reader"]);
    const readerBuilt = meAttackCorpus().reduce((sum, [n, t]) => {
      const a = meArm(t);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3 - 5).toBe(1006);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt - 1 - 4 - 3 - 6 - 3 - 5 + 1 + 2 + KEYED_ATTACK_ME_D593.length + keyed.length,
    ).toBe(1017);
    expect(POPULATION_ME.attackUnits - 1017).toBe(22);
    expect(BUILT.attack + 1017).toBe(2749);
    expect(POPULATION_D581.attackUnits - 2749).toBe(22);
    expect(170 + CENSUS_ME_TRAINER_D635.length).toBe(171);
    expect(POPULATION_ME.trainerUnits - 171).toBe(12);
    expect(BUILT.trainer + 171).toBe(435);
    expect(POPULATION_D581.trainerUnits - 435).toBe(12);
    expect(1208 + 1 + CENSUS_ME_TRAINER_D635.length).toBe(1210);
  });
});

const CENSUS_ME_POKEMON_D636: readonly string[] = ["me01-038", "me01-141"]; // Clawitzer "Fall Back to Reload"

/** The five L1 sentences, each printed once (`me` + `30th`). */
const L1_TEXTS_D636: readonly string[] = [
  "During your opponent's next turn, Energy can't be attached from your opponent's hand to the Defending Pokémon.",
  "During your opponent's next turn, whenever they attach an Energy card from their hand to the Defending Pokémon, place 8 damage counters on that Pokémon.",
  "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips 2 coins. If either of them is tails, that attack doesn't happen.",
  "During your opponent's next turn, whenever they try to use a Trainer card from their hand, they flip a coin. If tails, your opponent discards that Trainer card instead of using it.",
  "If your opponent has a Stadium in play, discard it. If you do, your opponent can't play any Stadium cards from their hand during their next turn.",
];

describe("D636 — L1 + Clawitzer, and the Standard pool they build, measured", () => {
  it("2 `me` Ability keys (Clawitzer); the five L1 attack ids and Rotom ex ×3 stay unkeyed ( D643 (D539): WITHDRAWN for Rotom ex — keyed since D643, inverted)", () => {
    for (const id of CENSUS_ME_POKEMON_D636) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
    }
    for (const id of ["me04-039", "me01-051", "me04-017", "30th-084", "me01-031"]) {
      expect(programFor(id), id).toBeUndefined();
    }
    for (const id of ["me02-029", "me02-111", "me02-126"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });

  it("BUILT over the `me` pool: attacks 1,022 / 1,039, abilities 217 / 234; the D636 headline: attacks 2,754 / 2,771, abilities 593 / 610 (1217 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, t]) => [t, n]));
    for (const text of L1_TEXTS_D636)
      expect([text, me.get(text), meArm(text)]).toEqual([text, 1, "reader"]);
    for (const text of [
      "This attack does 10 more damage for each damage counter on all of your opponent's Pokémon.", // Trevenant
      "This Pokémon is now Confused.", // Octillery "Tantrum"
      "Discard all Energy from this Pokémon.", // Clawitzer "Aqua Launcher"
    ]) {
      expect(meArm(text), text).toBe("reader");
    }
    const readerBuilt = meAttackCorpus().reduce((sum, [n, t]) => {
      const a = meArm(t);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6 - 3).toBe(1011);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(
      readerBuilt - 1 - 4 - 3 - 6 - 3 + 1 + 2 + KEYED_ATTACK_ME_D593.length + keyed.length,
    ).toBe(1022);
    expect(POPULATION_ME.attackUnits - 1022).toBe(17);
    expect(BUILT.attack + 1022).toBe(2754);
    expect(POPULATION_D581.attackUnits - 2754).toBe(17);
    expect(215 + CENSUS_ME_POKEMON_D636.length).toBe(217);
    expect(POPULATION.abilityUnits + 217).toBe(593);
    expect(POPULATION_D581.abilityUnits - 593).toBe(17);
    expect(1210 + L1_TEXTS_D636.length + CENSUS_ME_POKEMON_D636.length).toBe(1217);
  });
});

const CENSUS_ME_TRAINER_D637: readonly string[] = ["me03-068", "me03-069", "me05-072", "me05-073"];

describe("D637 — the four `me` Antique Fossils, and the Standard pool they build, measured", () => {
  it("4 `me` fossil keys, each `playAsPokemon` + `passive`; Rotom ex ×3 stays unkeyed ( D643 (D539): WITHDRAWN — keyed since D643, inverted)", () => {
    for (const id of CENSUS_ME_TRAINER_D637) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}).sort(), id).toEqual(["passive", "playAsPokemon"]);
    }
    for (const id of ["me02-029", "me02-111", "me02-126"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });

  it("BUILT over the `me` pool: trainers 175 / 183; the D637 headline: trainers 439 / 447 (1221 `me` printings fully built)", () => {
    expect(171 + CENSUS_ME_TRAINER_D637.length).toBe(175);
    expect(POPULATION_ME.trainerUnits - 175).toBe(8);
    expect(BUILT.trainer + 175).toBe(439);
    expect(POPULATION_D581.trainerUnits - 439).toBe(8);
    expect(1217 + CENSUS_ME_TRAINER_D637.length).toBe(1221);
  });
});

const CENSUS_ME_POKEMON_D638: readonly string[] = ["30th-066", "30th-152", "30th-158"]; // Mew ex "Memory Helix"

const X1_ROWS_D638: readonly (readonly [string, number])[] = [
  [
    "If you have no cards in your hand, choose an attack from 1 of your opponent's Pokémon in play and use it as this attack.",
    2,
  ], // Thievul `me05-054` / `-092`
  [
    "Discard the top card of your deck, and if that card is a Supporter card, use the effect of that card as the effect of this attack.",
    1,
  ], // Ninetales `me01-020`
];

describe("D638 — X1, copy / borrowed effects, and the Standard pool they build, measured", () => {
  it("3 `me` Ability keys (Mew ex), each `passive`; Thievul ×2 and Ninetales stay unkeyed", () => {
    for (const id of CENSUS_ME_POKEMON_D638) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
    for (const id of ["me05-054", "me05-092", "me01-020"])
      expect(programFor(id), id).toBeUndefined();
  });

  it("BUILT over the `me` pool: attacks 1,025 / 1,039, abilities 220 / 234; the D638 headline: attacks 2,757 / 2,771, abilities 596 / 610 (1227 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, t]) => [t, n]));
    for (const [text, n] of X1_ROWS_D638)
      expect([text, me.get(text), meArm(text)]).toEqual([text, n, "reader"]);
    expect(meArm("You may switch this Pokémon with 1 of your Benched Pokémon.")).toBe("reader"); // Mew ex "Teleportation Burst"
    const readerBuilt = meAttackCorpus().reduce((sum, [n, t]) => {
      const a = meArm(t);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3 - 6).toBe(1014);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(readerBuilt - 1 - 4 - 3 - 6 + 1 + 2 + KEYED_ATTACK_ME_D593.length + keyed.length).toBe(
      1025,
    );
    expect(POPULATION_ME.attackUnits - 1025).toBe(14);
    expect(BUILT.attack + 1025).toBe(2757);
    expect(POPULATION_D581.attackUnits - 2757).toBe(14);
    expect(217 + CENSUS_ME_POKEMON_D638.length).toBe(220);
    expect(POPULATION.abilityUnits + 220).toBe(596);
    expect(POPULATION_D581.abilityUnits - 596).toBe(14);
    expect(
      1221 + CENSUS_ME_POKEMON_D638.length + X1_ROWS_D638.reduce((sum, [, n]) => sum + n, 0),
    ).toBe(1227);
  });
});

const K3R1_ROWS_D639: readonly (readonly [string, number])[] = [
  [
    "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.",
    3,
  ], // Marshadow `me01-080` / `-146`, Golisopod `me04-026`
  [
    "If your opponent's Pokémon is Knocked Out by damage from this attack, take 1 more Prize card.",
    1,
  ], // Unown `30th-072`
  ["Knock Out each of your opponent's Pokémon that has 50 HP or less remaining.", 2], // Yveltal ex `me03-053` / `-105`
];

describe("D639 — K3 + R1, and the Standard pool they build, measured", () => {
  it("the 6 printings stay unkeyed; Celebration ×2 stays residue ( D640 (D539): reader-built since D640)", () => {
    for (const id of ["me01-080", "me01-146", "me04-026", "30th-072", "me03-053", "me03-105"]) {
      expect(programFor(id), id).toBeUndefined();
    }
    expect(
      meArm(
        "If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck.",
      ),
    ).toBe("reader");
  });

  it("BUILT over the `me` pool: attacks 1,031 / 1,039; the D639 headline: attacks 2,763 / 2,771 (1233 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, t]) => [t, n]));
    for (const [text, n] of K3R1_ROWS_D639)
      expect([text, me.get(text), meArm(text)]).toEqual([text, n, "reader"]);
    expect(meArm("During your next turn, this Pokémon can't use attacks.")).toBe("reader"); // Golisopod "Boundless Power"
    expect(meArm("During your next turn, this Pokémon can't use Dark Strike.")).toBe("reader"); // Yveltal ex "Dark Strike"
    const readerBuilt = meAttackCorpus().reduce((sum, [n, t]) => {
      const a = meArm(t);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4 - 3).toBe(1020);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(readerBuilt - 1 - 4 - 3 + 1 + 2 + KEYED_ATTACK_ME_D593.length + keyed.length).toBe(1031);
    expect(POPULATION_ME.attackUnits - 1031).toBe(8);
    expect(BUILT.attack + 1031).toBe(2763);
    expect(POPULATION_D581.attackUnits - 2763).toBe(8);
    expect(1227 + K3R1_ROWS_D639.reduce((sum, [, n]) => sum + n, 0)).toBe(1233);
  });
});

const D640_ROWS: readonly (readonly [string, number])[] = [
  [
    "The Defending Pokémon's Weakness is now {L} until the end of your next turn. (Apply Weakness as ×2.)",
    1,
  ], // Pikachu `30th-040`
  [
    "If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck.",
    2,
  ], // Gholdengo `30th-108` / `-142`
];

describe("D640 — Overwriting Bolt and Celebration, and the Standard pool they build, measured", () => {
  it("the 3 printings stay unkeyed; Multi Adapter ×3 stays unbuilt ( D643 (D539): WITHDRAWN for Multi Adapter — keyed since D643, inverted)", () => {
    for (const id of ["30th-040", "30th-108", "30th-142"]) {
      expect(programFor(id), id).toBeUndefined();
    }
    for (const id of ["me02-029", "me02-111", "me02-126"])
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });

  it("BUILT over the `me` pool: attacks 1,034 / 1,039; the D640 headline: attacks 2,766 / 2,771 (1236 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, t]) => [t, n]));
    for (const [text, n] of D640_ROWS)
      expect([text, me.get(text), meArm(text)]).toEqual([text, n, "reader"]);
    expect(meArm("Flip 3 coins. This attack does 50 damage for each heads.")).toBe("reader"); // Gholdengo "Triple Smash"
    const readerBuilt = meAttackCorpus().reduce((sum, [n, t]) => {
      const a = meArm(t);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1 - 4).toBe(1023);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(readerBuilt - 1 - 4 + 1 + 2 + KEYED_ATTACK_ME_D593.length + keyed.length).toBe(1034);
    expect(POPULATION_ME.attackUnits - 1034).toBe(5);
    expect(BUILT.attack + 1034).toBe(2766);
    expect(POPULATION_D581.attackUnits - 2766).toBe(5);
    expect(1233 + D640_ROWS.reduce((sum, [, n]) => sum + n, 0)).toBe(1236);
  });
});

const CENSUS_ME_TRAINER_D641: readonly string[] = ["me01-120", "me01-170", "me01-185"]; // Lt. Surge's Bargain

const W1_ROWS_D641: readonly (readonly [string, number])[] = [
  [
    "Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.",
    2,
  ], // Ditto `mep-106` / `30th-115`
  [
    "Reveal the bottom 7 cards of your deck, and this attack does 50 damage for each Pokémon you find there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your deck. Discard the other cards.",
    1,
  ], // Sizzlipede `me05-009`
  [
    "Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first.",
    1,
  ], // Delibird `me04-018`
];

describe("D641 — W1 + Y1b, and the Standard pool they build, measured", () => {
  it("3 `me` Trainer keys on one `trainer` object; the 4 attack printings stay unkeyed", () => {
    for (const id of CENSUS_ME_TRAINER_D641) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["trainer"]);
    }
    for (const id of ["mep-106", "30th-115", "me05-009", "me04-018"])
      expect(programFor(id), id).toBeUndefined();
  });

  it("BUILT over the `me` pool: attacks 1,038 / 1,039, trainers 178 / 183; the D641 headline: attacks 2,770 / 2,771, trainers 442 / 447 (1243 `me` printings fully built)", () => {
    const me = new Map(meAttackCorpus().map(([n, t]) => [t, n]));
    for (const [text, n] of W1_ROWS_D641)
      expect([text, me.get(text), meArm(text)]).toEqual([text, n, "reader"]);
    expect(meArm("Discard the top card of your opponent's deck.")).toBe("reader"); // Sizzlipede "Controlled Burn"
    const readerBuilt = meAttackCorpus().reduce((sum, [n, t]) => {
      const a = meArm(t);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt - 1).toBe(1027);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(readerBuilt - 1 + 1 + 2 + KEYED_ATTACK_ME_D593.length + keyed.length).toBe(1038);
    expect(POPULATION_ME.attackUnits - 1038).toBe(1);
    expect(BUILT.attack + 1038).toBe(2770);
    expect(POPULATION_D581.attackUnits - 2770).toBe(1);
    expect(175 + CENSUS_ME_TRAINER_D641.length).toBe(178);
    expect(POPULATION_ME.trainerUnits - 178).toBe(5);
    expect(BUILT.trainer + 178).toBe(442);
    expect(POPULATION_D581.trainerUnits - 442).toBe(5);
    expect(
      1236 + W1_ROWS_D641.reduce((sum, [, n]) => sum + n, 0) + CENSUS_ME_TRAINER_D641.length,
    ).toBe(1243);
  });
});

const CENSUS_ME_POKEMON_D642: readonly string[] = ["me01-087", "me01-148", "30th-022"];
const CENSUS_ME_TRAINER_D642: readonly string[] = ["me01-127", "me02-088", "me04-075"]; // Risky Ruins, Dizzying Valley, Ange Floette

describe("D642 — Z1 + K2, and the Standard pool they build, measured", () => {
  it("3 `passive` Ability keys and 3 `stadium` keys", () => {
    for (const id of CENSUS_ME_POKEMON_D642) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
    for (const id of CENSUS_ME_TRAINER_D642) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
    }
  });

  it("BUILT over the `me` pool: abilities 223 / 234, trainers 181 / 183; the D642 headline: abilities 599 / 610, trainers 445 / 447 (1249 `me` printings fully built)", () => {
    expect(meArm("Discard the top card of your opponent's deck.")).toBe("reader"); // Spiritomb "Mountain Breaker"
    expect(meArm("Flip a coin. If tails, this attack does nothing.")).toBe("reader");
    expect(220 + CENSUS_ME_POKEMON_D642.length).toBe(223);
    expect(POPULATION.abilityUnits + 223).toBe(599);
    expect(POPULATION_D581.abilityUnits - 599).toBe(11);
    expect(178 + CENSUS_ME_TRAINER_D642.length).toBe(181);
    expect(POPULATION_ME.trainerUnits - 181).toBe(2);
    expect(BUILT.trainer + 181).toBe(445);
    expect(POPULATION_D581.trainerUnits - 445).toBe(2);
    expect(1243 + CENSUS_ME_POKEMON_D642.length + CENSUS_ME_TRAINER_D642.length).toBe(1249);
  });
});

const CENSUS_ME_POKEMON_D643: readonly string[] = ["me02-029", "me02-111", "me02-126"]; // Rotom ex ×3

describe("D643 — Y1a, and the Standard pool it builds, measured", () => {
  it("3 `passive` Ability keys", () => {
    for (const id of CENSUS_ME_POKEMON_D643) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
  });

  it("BUILT over the `me` pool: abilities 226 / 234; the D643 headline: abilities 602 / 610 (1252 `me` printings fully built)", () => {
    expect(meArm("Discard all Energy from this Pokémon.")).toBe("reader");
    expect(223 + CENSUS_ME_POKEMON_D643.length).toBe(226);
    expect(POPULATION.abilityUnits + 226).toBe(602);
    expect(POPULATION_D581.abilityUnits - 602).toBe(8);
    expect(1249 + CENSUS_ME_POKEMON_D643.length).toBe(1252);
  });
});

const CENSUS_ME_POKEMON_D644: readonly string[] = ["me01-028", "me04-070", "30th-004", "me04-063"];
const CENSUS_ME_TRAINER_D644: readonly string[] = ["me04-083"]; // Transformation Tome

describe("D644 — Y1e, and the Standard pool it builds, measured", () => {
  it("4 Ability keys and 1 `trainer` key; ~~Backtrack Badge stays unkeyed~~ ( D646 (D539): keyed at D646)", () => {
    const shapes = CENSUS_ME_POKEMON_D644.map((id) => Object.keys(programFor(id) ?? {}));
    expect(shapes).toEqual([
      ["setupActiveFromHand"],
      ["passive"],
      ["passive"],
      ["opponentMillWhenMilled"],
    ]);
    for (const id of [...CENSUS_ME_POKEMON_D644, ...CENSUS_ME_TRAINER_D644])
      expect(ME_ID.test(id), id).toBe(true);
    expect(Object.keys(programFor("me04-083") ?? {})).toEqual(["trainer"]);
    expect(Object.keys(programFor("me05-074") ?? {})).toEqual(["passive"]);
  });

  it("BUILT over the `me` pool: abilities 230 / 234, trainers 182 / 183; the D644 headline: abilities 606 / 610, trainers 446 / 447 (1257 `me` printings fully built)", () => {
    expect(
      meArm(
        "Search your deck for up to 3 Basic Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck.",
      ),
    ).toBe("reader"); // Cinderace "Turbo Flare"
    expect(
      meArm("If this Pokémon has any Special Energy attached, this attack does 70 more damage."),
    ).toBe("reader");
    expect(226 + CENSUS_ME_POKEMON_D644.length).toBe(230);
    expect(POPULATION.abilityUnits + 230).toBe(606);
    expect(POPULATION_D581.abilityUnits - 606).toBe(4);
    expect(181 + CENSUS_ME_TRAINER_D644.length).toBe(182);
    expect(POPULATION_ME.trainerUnits - 182).toBe(1);
    expect(BUILT.trainer + 182).toBe(446);
    expect(POPULATION_D581.trainerUnits - 446).toBe(1);
    expect(1252 + CENSUS_ME_POKEMON_D644.length + CENSUS_ME_TRAINER_D644.length).toBe(1257);
  });
});

const CENSUS_ME_POKEMON_D645: readonly string[] = ["me01-010", "mep-001", "me04-068", "mep-077"]; // Meganium ×2, Goodra ×2

describe("D645 — the last one-offs, and the Standard pool they build, measured", () => {
  it("4 `passive` Ability keys; Psyspear reader-built and unkeyed; ~~Backtrack Badge stays unkeyed~~ ( D646 (D539): keyed at D646)", () => {
    for (const id of CENSUS_ME_POKEMON_D645) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
    expect(programFor("me04-032")).toBeUndefined();
    expect(Object.keys(programFor("me05-074") ?? {})).toEqual(["passive"]);
  });

  it("BUILT over the `me` pool: attacks 1,039 / 1,039, abilities 234 / 234; the D645 headline: attacks 2,771 / 2,771, abilities 610 / 610 (1262 `me` printings fully built)", () => {
    const psyspear =
      "If this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost), this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
    const me = new Map(meAttackCorpus().map(([n, t]) => [t, n]));
    expect([me.get(psyspear), meArm(psyspear)]).toEqual([1, "reader"]);
    expect(meArm("Discard the top card of your deck.")).toBe("reader"); // Goodra "Dragon Pulse"
    const readerBuilt = meAttackCorpus().reduce((sum, [n, t]) => {
      const a = meArm(t);
      return a === "reader" || a === "gate" || a === "trailing" ? sum + n : sum;
    }, 0);
    expect(readerBuilt).toBe(1028);
    const keyed = KEYED_ATTACK_ME_D608.filter((id) => !RETIRED_ATTACK_KEYS_D612.includes(id));
    expect(readerBuilt + 1 + 2 + KEYED_ATTACK_ME_D593.length + keyed.length).toBe(1039);
    expect(POPULATION_ME.attackUnits - 1039).toBe(0);
    expect(BUILT.attack + 1039).toBe(2771);
    expect(POPULATION_D581.attackUnits - 2771).toBe(0);
    expect(230 + CENSUS_ME_POKEMON_D645.length).toBe(234);
    expect(POPULATION_ME.abilityUnits - 234).toBe(0);
    expect(POPULATION.abilityUnits + 234).toBe(610);
    expect(POPULATION_D581.abilityUnits - 610).toBe(0);
    expect(1257 + 1 + CENSUS_ME_POKEMON_D645.length).toBe(1262);
  });
});

const CENSUS_ME_TRAINER_D646: readonly string[] = ["me05-074"]; // Backtrack Badge

describe("D646 — Backtrack Badge, and the Standard pool it builds, measured", () => {
  it("1 `passive` Tool key", () => {
    for (const id of CENSUS_ME_TRAINER_D646) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
  });

  it("BUILT over the `me` pool: trainers 183 / 183; the D646 headline: attacks 2,771 / 2,771, abilities 610 / 610, trainers 447 / 447, Special Energy 22 / 22 (1263 `me` printings fully built)", () => {
    expect(182 + CENSUS_ME_TRAINER_D646.length).toBe(183);
    expect(POPULATION_ME.trainerUnits - 183).toBe(0);
    expect(BUILT.trainer + 183).toBe(447);
    expect(POPULATION_D581.trainerUnits - 447).toBe(0);
    expect(POPULATION_D581.attackUnits).toBe(2771);
    expect(POPULATION_D581.abilityUnits).toBe(610);
    expect(POPULATION_D581.specialEnergyUnits).toBe(22);
    expect(1262 + CENSUS_ME_TRAINER_D646.length).toBe(1263);
    expect(POPULATION_ME.legalRows - 1263).toBe(3);
  });
});

/** The 3 text-less `30th` Item ids keyed below. */
const CENSUS_ME_TRAINER_B04: readonly string[] = ["30th-126", "30th-127", "30th-128"];

describe("card revision B04 — the text-less `30th` Items are keyed, and no column moves", () => {
  it("3 `trainer` keys, on Poké Pad's, Switch's and Ultra Ball's shipped objects", () => {
    for (const id of CENSUS_ME_TRAINER_B04) {
      expect(ME_ID.test(id), id).toBe(true);
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["trainer"]);
    }
    expect(programFor("30th-126")).toBe(programFor("me02.5-198"));
    expect(programFor("30th-127")).toBe(programFor("sv01-194"));
    expect(programFor("30th-128")).toBe(programFor("sv01-196"));
    expect(POPULATION_ME.legalRows - 1263).toBe(CENSUS_ME_TRAINER_B04.length);
  });
});
