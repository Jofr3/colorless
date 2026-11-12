import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import * as effects from "./effects";
import { ATTACK_READERS } from "./effects";
import { canonicalPrinting, withReprints } from "./printGroups";
import { programFor } from "./registry";
import { simulationGaps } from "./simulationGaps";
import { battler, programmedCardIds } from "./testFixtures";

const POPULATION = {
  legalRows: 2021,
  attackUnits: 1732,
  abilityUnits: 376,
  trainerUnits: 264,
  specialEnergyUnits: 11,
} as const;

const BUILT = {
  ability: 393,
  specialEnergy: 11,
} as const;

/** The legal `sv` printings whose attack plays through a registry program rather than a reader. */
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

/** The `category = 'Trainer' AND legal_standard = 1` half. */
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

describe("the non-attack columns, partitioned over the live registry (D273)", () => {
  it("the recorded lists PARTITION the live pool — the guard that reddens on a new key", () => {
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

describe("the trainer column, by card (D304)", () => {
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

describe("the `ability` column, by card (D305)", () => {
  it("the named terms PARTITION the column — both directions, nothing left over", () => {
    const listed = ABILITY_NAME_TERMS.flatMap(([, ids]) => ids);
    expect(listed.length).toBe(BUILT.ability);
    expect(new Set(listed).size).toBe(listed.length);
    const inColumn = new Set<string>(CENSUS_POKEMON_LEGAL);
    const inTerms = new Set(listed);
    expect(listed.filter((id) => !inColumn.has(id))).toEqual([]);
    expect(CENSUS_POKEMON_LEGAL.filter((id) => !inTerms.has(id))).toEqual([]);
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

describe("the `specialEnergy` column, by card (D308)", () => {
  it("the named terms PARTITION the column — both directions, nothing left over", () => {
    const listed = ENERGY_NAME_TERMS.flatMap(([, ids]) => ids);
    expect(listed.length).toBe(BUILT.specialEnergy);
    expect(new Set(listed).size).toBe(listed.length);
    const inColumn = new Set<string>(CENSUS_ENERGY_LEGAL);
    const inTerms = new Set(listed);
    expect(listed.filter((id) => !inColumn.has(id))).toEqual([]);
    expect(CENSUS_ENERGY_LEGAL.filter((id) => !inTerms.has(id))).toEqual([]);
  });
});

/** The `me` serie's legal pool, per column (the statement above, `:serie = 'me'`). */
const POPULATION_ME = {
  legalRows: 1266,
  attackUnits: 1040,
  abilityUnits: 234,
  trainerUnits: 183,
  specialEnergyUnits: 11,
} as const;

const POPULATION_D581 = {
  legalRows: 3287,
  attackUnits: 2772,
  abilityUnits: 610,
  trainerUnits: 447,
  specialEnergyUnits: 22,
} as const;

const ME_ID = /^(me\d|mep-|mee-|30th)/;

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

const CENSUS_ME_ENERGY_D583: readonly string[] = [
  "me02.5-217", // Team Rocket's Energy
];

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

/** The 2 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D586: readonly string[] = [
  "me02.5-117", // Carbink — Double Type
  "me02.5-242", // Carbink
];

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

/** The 5 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D589: readonly string[] = [
  "mep-081", // Mega Greninja ex — Mortal Shuriken
  "me04-022", // Mega Greninja ex
  "me04-100", // Mega Greninja ex
  "me04-116", // Mega Greninja ex
  "me04-122", // Mega Greninja ex
];

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

const KEYED_ATTACK_ME_D593: readonly string[] = [
  "mep-006",
  "me03-062",
  "me03-107",
  "me03-121",
  "me04-030",
];

/** The 2 `me` Pokémon keys, one printed Ability each. */
const CENSUS_ME_POKEMON_D594: readonly string[] = [
  "me03-027", // Luxio — Fighting Roar
  "me04-007", // Chesnaught — Needly Armor
];

/** The 2 attack-only `me` keys: the "[R]" Inferno X. */
const KEYED_ATTACK_ME_D597: readonly string[] = ["mep-023", "mep-029"];

const CENSUS_ME_POKEMON_D598: readonly string[] = [
  ...["me02-056", "me02.5-125", "me02.5-269", "me02.5-284", "mep-073"],
  ...["me02.5-116", "me02.5-268", "me02.5-283", "me05-041"],
  ...["me01-061", "me01-144", "me03-050", "me02.5-143"],
];

/** The 4 `me` Supporter keys. */
const CENSUS_ME_TRAINER_D599: readonly string[] = [
  "me02.5-182", // Anthea & Concordia
  "me02.5-254", // Anthea & Concordia
  "me04-077", // Emma
  "me04-107", // Emma
];

const CENSUS_ME_POKEMON_D602: readonly string[] = [
  ...["me05-070", "me05-095", "me02.5-007", "me02.5-218", "30th-008"],
  ...["me01-011", "me01-136", "me02.5-003", "30th-105"],
];

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

const CENSUS_ME_TRAINER_D606: readonly string[] = [
  ...["me04-080", "me04-111"], // Prism Tower
  ...["me01-129", "me04-114"], // Surfing Beach
  "me02.5-197", // Nighttime Mine
  ...["me03-077", "me03-111"], // Lumiose City
  ...["mep-028", "mep-120"], // Celebratory Fanfare
];

/** The 5 attack-only `30th` keys: Photon Bullets ×3, Stealthy Slash ×2 (tcgdex's `<em>` markup). */
const KEYED_ATTACK_ME_D608: readonly string[] = [
  "30th-064",
  "30th-151",
  "30th-157",
  "30th-021",
  "30th-148",
];

const CENSUS_ME_POKEMON_D610: readonly string[] = [
  ...["me01-003", "me01-155", "me01-177", "mep-013"], // Mega Venusaur ex "Solar Transfer"
  "me02.5-084", // Azumarill ex "Bubble Gathering"
  ...["me04-064", "me04-103"], // Cobalion ex "Metal Road"
  ...["me02-036", "me02-112"], // Mismagius ex "Swirling Prose"
  ...["me02.5-101", "me02.5-239"], // Team Rocket's Dugtrio "Holes"
  ...["mep-094", "30th-002", "30th-129"], // Alolan Exeggutor "Scale Up"
  ...["mep-066", "me03-045"], // Tyrantrum "Tyrannically Gutsy"
];

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

const RETIRED_ATTACK_KEYS_D612: readonly string[] = ["mep-023", "mep-029", "30th-021", "30th-148"];

const CENSUS_ME_POKEMON_D614: readonly string[] = ["mep-072", "me03-031", "me03-103", "me03-119"];

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

const CENSUS_ME_TRAINER_D618: readonly string[] = [
  ...["me02-085", "me02-116"], // Battle Cage
  ...["me01-122", "me01-172", "me02.5-194"], // Mystery Garden
  ...["me01-117", "me02.5-188", "me03-109"], // Forest of Vitality
];

const CENSUS_ME_POKEMON_D619: readonly string[] = [
  ...["me02-022", "me02-097"], // Dewgong "Thick Fat"
  ...["me02.5-064", "me02.5-229"], // Heliolisk "Frilled Generator"
];
const CENSUS_ME_TRAINER_D619: readonly string[] = [
  ...["me02-093", "me02-122"], // Sacred Charm
  "me02.5-211", // Thick Scale
];

const CENSUS_ME_TRAINER_D620: readonly string[] = [
  "me02.5-191", // Light Ball
  ...["me02-092", "me02-121"], // Punk Helmet
  "me02.5-206", // Team Rocket's Hypnotizer
  "me03-070", // Core Memory
  ...["me05-082", "me05-113"], // Tremendous Bomb
];

const CENSUS_ME_TRAINER_D621: readonly string[] = [
  ...["me05-077", "me05-108", "me05-118"], // Gladion's Final Battle
  ...["me01-124", "me01-174", "me02.5-199"], // Premium Power Pro
  ...["me01-113", "me01-165", "me01-183", "me02.5-180"], // Acerola's Mischief
  ...["me04-081", "me04-112", "me04-121"], // Roxie's Performance
  ...["me02-087", "me02-118", "me02-129"], // Dawn
];

const CENSUS_ME_TRAINER_D625: readonly string[] = [
  ...["me04-082", "me04-113"], // Special Red Card
  ...["me02-091", "me04-109"], // Jumbo Ice Cream
  ...["me05-075", "me05-106"], // Dark Bell
  ...["me01-132", "me01-176", "me01-186"], // Wally's Compassion
  ...["me02-086", "me02-117"], // Blowtorch
  "me04-078", // Great Haul Net
  "me01-128", // Strange Timepiece
];

const CENSUS_ME_POKEMON_D626: readonly string[] = [
  ...["mep-016", "me02-053", "me02-101"], // Flygon "Sandy Flapping"
  ...["mep-082", "me05-028"], // Miraidon "Photon Cord"
  ...["30th-090", "30th-154"], // Gengar ex "Fainting Spell"
];
const CENSUS_ME_TRAINER_D626: readonly string[] = ["me04-074"]; // Adversity Policy

const CENSUS_ME_POKEMON_D627: readonly string[] = ["me05-005", "me05-006", "me05-033", "me05-034"];

const CENSUS_ME_POKEMON_D628: readonly string[] = [
  ...["me03-062", "me03-107", "me03-121"], // Meowth ex "Last-Ditch Catch" (on `TUCK_TAIL`)
  "me01-101", // Latios "Lustrous Assist"
  "me02.5-175", // Larry's Komala "Lethargic Charge"
];

const CENSUS_ME_TRAINER_D630: readonly string[] = ["me01-118", "me05-110"]; // Iron Defender

const CENSUS_ME_POKEMON_D631: readonly string[] = [
  ...["mep-085", "me05-062", "me05-093"], // Bastiodon "Ancient Bulwark"
  ...["me03-012", "me03-100"], // Decidueye ex "Sniper's Eye"
  "me02.5-148", // Kingambit "Supreme Overlord"
  "me04-057", // Garbodor "Gloomy Garbage"
  "30th-100", // Yveltal "Life-Locked"
  "30th-119", // Snorlax "Good Sleep"
];

const CENSUS_ME_POKEMON_D632: readonly string[] = [
  ...["me02.5-039", "me02.5-040", "me02.5-226"], // Psyduck / Golduck / Psyduck "Damp" (Knock Out itself)
  ...["mep-007", "mep-008"], // Psyduck / Golduck "Damp" (require those Pokémon to be Knocked Out)
];

const CENSUS_ME_TRAINER_D635: readonly string[] = ["me05-076"]; // Fossil Quarry

const CENSUS_ME_POKEMON_D636: readonly string[] = ["me01-038", "me01-141"]; // Clawitzer "Fall Back to Reload"

const CENSUS_ME_TRAINER_D637: readonly string[] = ["me03-068", "me03-069", "me05-072", "me05-073"];

const CENSUS_ME_POKEMON_D638: readonly string[] = ["30th-066", "30th-152", "30th-158"]; // Mew ex "Memory Helix"

const CENSUS_ME_TRAINER_D641: readonly string[] = ["me01-120", "me01-170", "me01-185"]; // Lt. Surge's Bargain

const CENSUS_ME_POKEMON_D642: readonly string[] = ["me01-087", "me01-148", "30th-022"];
const CENSUS_ME_TRAINER_D642: readonly string[] = ["me01-127", "me02-088", "me04-075"]; // Risky Ruins, Dizzying Valley, Ange Floette

const CENSUS_ME_POKEMON_D643: readonly string[] = ["me02-029", "me02-111", "me02-126"]; // Rotom ex ×3

const CENSUS_ME_POKEMON_D644: readonly string[] = ["me01-028", "me04-070", "30th-004", "me04-063"];
const CENSUS_ME_TRAINER_D644: readonly string[] = ["me04-083"]; // Transformation Tome

const CENSUS_ME_POKEMON_D645: readonly string[] = ["me01-010", "mep-001", "me04-068", "mep-077"]; // Meganium ×2, Goodra ×2

const CENSUS_ME_TRAINER_D646: readonly string[] = ["me05-074"]; // Backtrack Badge

/** The 3 text-less `30th` Item ids keyed below. */
const CENSUS_ME_TRAINER_B04: readonly string[] = ["30th-126", "30th-127", "30th-128"];

const probe = (effect: string) =>
  battler("census-probe", {
    attacks: [{ cost: ["Colorless"], name: "Probe", damage: 10, effect }],
  });

/** Whether a reader plays the printed sentence, asked the way `simulationGaps` asks it. */
const readerBuilt = (text: string): boolean => !simulationGaps(probe(text)).includes("attack");

/** The `me` printings whose attack plays through a registry program rather than a reader. */
const ME_REGISTRY_ATTACKS: readonly (readonly [string, string])[] = [
  ["mep-006", "Put this Pokémon and all attached cards into your hand."],
  ["me03-062", "Put this Pokémon and all attached cards into your hand."],
  ["me03-107", "Put this Pokémon and all attached cards into your hand."],
  ["me03-121", "Put this Pokémon and all attached cards into your hand."],
  ["me04-030", "Put this Pokémon and all attached cards into your hand."],
  ["30th-073", "You may shuffle this Pokémon and all attached cards into your deck."],
  ["30th-136", "You may shuffle this Pokémon and all attached cards into your deck."],
  [
    "me02.5-178",
    "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.",
  ],
  [
    "30th-064",
    "This attack does 50 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  ],
  [
    "30th-151",
    "This attack does 50 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  ],
  [
    "30th-157",
    "This attack does 50 damage to each of your opponent's Pokémon ex. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  ],
];

/**
 * The printings a corpus leaves to registry programs: every sentence no reader plays, with its
 * printing count. Each must be exactly the printings `registry` keys under that text.
 */
function registryOwed(
  corpus: readonly (readonly [number, string])[],
  registry: readonly (readonly [string, string])[],
): { text: string; printed: number; keyed: number }[] {
  return corpus
    .filter(([, text]) => !readerBuilt(text))
    .map(([printed, text]) => ({
      text,
      printed,
      keyed: registry.filter(([, keyedText]) => keyedText === text).length,
    }));
}

/** Built attack printings over the sv + me Standard pool, derived live. */
function liveAttackBuilt(): number {
  const units = (corpus: readonly (readonly [number, string])[]) =>
    corpus.filter(([, text]) => readerBuilt(text)).reduce((sum, [n]) => sum + n, 0);
  return (
    units(legalAttackCorpus()) +
    units(meAttackCorpus()) +
    REGISTRY_ATTACKS.length +
    ME_REGISTRY_ATTACKS.length
  );
}

describe("the census at HEAD", () => {
  it("ATTACK_READERS is every `deriveAttack` export, each under its own name", () => {
    const exported = Object.entries(effects)
      .filter(([name, value]) => name.startsWith("deriveAttack") && typeof value === "function")
      .map(([name]) => name)
      .sort();
    expect(attackReaderSurface()).toEqual(exported);
    expect(attackReaderSurface()).toHaveLength(14);
    for (const { name, read } of ATTACK_READERS) expect(read.name).toBe(name);
  });

  it("the committed corpora are the legal attack columns: sv 640 / 1,732, me 442 / 1,040", () => {
    const sv = legalAttackCorpus();
    expect(sv.length).toBe(640);
    expect(sv.reduce((sum, [units]) => sum + units, 0)).toBe(POPULATION.attackUnits);
    expect(sv.reduce((sum, [, text]) => sum + [...text].length, 0)).toBe(60467);
    expect(new Set(sv.map(([, text]) => text)).size).toBe(sv.length);
    const me = meAttackCorpus();
    expect(me.length).toBe(442);
    expect(me.reduce((sum, [n]) => sum + n, 0)).toBe(POPULATION_ME.attackUnits);
    expect(me.reduce((sum, [, text]) => sum + text.length, 0)).toBe(41838);
    expect(POPULATION.attackUnits + POPULATION_ME.attackUnits).toBe(POPULATION_D581.attackUnits);
  });

  it("the readers play 600 sv sentences / 1,663 printings outright", () => {
    const resolved = legalAttackCorpus().filter(([, text]) => resolvedByAnyReader(text));
    expect([resolved.length, resolved.reduce((sum, [n]) => sum + n, 0)]).toEqual([600, 1663]);
  });

  it("every corpus sentence plays: a reader claims it, or a registry program keys each printing", () => {
    for (const owed of registryOwed(legalAttackCorpus(), REGISTRY_ATTACKS)) {
      expect(owed.keyed, owed.text).toBe(owed.printed);
    }
    for (const owed of registryOwed(meAttackCorpus(), ME_REGISTRY_ATTACKS)) {
      expect(owed.keyed, owed.text).toBe(owed.printed);
    }
    for (const [id] of [...REGISTRY_ATTACKS, ...ME_REGISTRY_ATTACKS]) {
      expect(Object.keys(programFor(id)?.attack ?? {}).length, id).toBeGreaterThan(0);
    }
    expect(liveAttackBuilt()).toBe(POPULATION_D581.attackUnits);
  });

  it("the registry attacks are not derivable, so their keys are owed", () => {
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

  it("the LIVE registry's attack ids ARE the recorded tables", () => {
    const rotated = ["sv02-061", "sv02-236", "sv02-261", "sv02-274"].concat([
      "swsh10.5-031",
      "swsh10.5-079",
      "swsh10.5-086",
    ]);
    const trainerGranted = ["sv08-188"];
    const meAlias = ME_REGISTRY_ATTACKS.map(([id]) => id);
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

  it("the `me` registry keys are EXACTLY the recorded lists", () => {
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
});

/**
 * Built printings over the sv + me Standard pool after each slice that moved a column, as each
 * decision recorded it. Frozen: a new slice appends one row, and only the last row is checked.
 */
const CENSUS_HISTORY: readonly {
  decision: string;
  attack: number;
  ability: number;
  trainer: number;
  specialEnergy: number;
}[] = [
  { decision: "D581", attack: 2460, ability: 376, trainer: 264, specialEnergy: 11 },
  { decision: "D582", attack: 2461, ability: 417, trainer: 318, specialEnergy: 13 },
  { decision: "D583", attack: 2461, ability: 417, trainer: 318, specialEnergy: 14 },
  { decision: "D584", attack: 2463, ability: 431, trainer: 320, specialEnergy: 14 },
  { decision: "D585", attack: 2463, ability: 450, trainer: 320, specialEnergy: 14 },
  { decision: "D586", attack: 2480, ability: 452, trainer: 320, specialEnergy: 14 },
  { decision: "D587", attack: 2480, ability: 452, trainer: 339, specialEnergy: 14 },
  { decision: "D588", attack: 2480, ability: 452, trainer: 356, specialEnergy: 14 },
  { decision: "D589", attack: 2489, ability: 457, trainer: 356, specialEnergy: 14 },
  { decision: "D590", attack: 2492, ability: 470, trainer: 356, specialEnergy: 14 },
  { decision: "D591", attack: 2492, ability: 489, trainer: 356, specialEnergy: 14 },
  { decision: "D592", attack: 2510, ability: 489, trainer: 356, specialEnergy: 14 },
  { decision: "D593", attack: 2525, ability: 489, trainer: 356, specialEnergy: 14 },
  { decision: "D594", attack: 2533, ability: 491, trainer: 356, specialEnergy: 14 },
  { decision: "D595", attack: 2544, ability: 491, trainer: 356, specialEnergy: 14 },
  { decision: "D596", attack: 2558, ability: 491, trainer: 356, specialEnergy: 14 },
  { decision: "D597", attack: 2576, ability: 491, trainer: 356, specialEnergy: 14 },
  { decision: "D598", attack: 2576, ability: 504, trainer: 356, specialEnergy: 14 },
  { decision: "D599", attack: 2576, ability: 504, trainer: 360, specialEnergy: 14 },
  { decision: "D600", attack: 2588, ability: 504, trainer: 360, specialEnergy: 14 },
  { decision: "D602", attack: 2588, ability: 513, trainer: 360, specialEnergy: 14 },
  { decision: "D603", attack: 2588, ability: 520, trainer: 364, specialEnergy: 14 },
  { decision: "D604", attack: 2588, ability: 520, trainer: 364, specialEnergy: 22 },
  { decision: "D605", attack: 2600, ability: 520, trainer: 364, specialEnergy: 22 },
  { decision: "D606", attack: 2600, ability: 520, trainer: 373, specialEnergy: 22 },
  { decision: "D607", attack: 2614, ability: 520, trainer: 373, specialEnergy: 22 },
  { decision: "D608", attack: 2632, ability: 520, trainer: 373, specialEnergy: 22 },
  { decision: "D609", attack: 2640, ability: 520, trainer: 373, specialEnergy: 22 },
  { decision: "D610", attack: 2640, ability: 536, trainer: 373, specialEnergy: 22 },
  { decision: "D611", attack: 2640, ability: 553, trainer: 373, specialEnergy: 22 },
  { decision: "D612", attack: 2661, ability: 553, trainer: 373, specialEnergy: 22 },
  { decision: "D614", attack: 2661, ability: 557, trainer: 373, specialEnergy: 22 },
  { decision: "D615", attack: 2674, ability: 557, trainer: 373, specialEnergy: 22 },
  { decision: "D616", attack: 2685, ability: 557, trainer: 373, specialEnergy: 22 },
  { decision: "D617", attack: 2685, ability: 557, trainer: 384, specialEnergy: 22 },
  { decision: "D618", attack: 2685, ability: 557, trainer: 392, specialEnergy: 22 },
  { decision: "D619", attack: 2688, ability: 561, trainer: 395, specialEnergy: 22 },
  { decision: "D620", attack: 2695, ability: 561, trainer: 402, specialEnergy: 22 },
  { decision: "D621", attack: 2695, ability: 561, trainer: 418, specialEnergy: 22 },
  { decision: "D623", attack: 2702, ability: 561, trainer: 418, specialEnergy: 22 },
  { decision: "D624", attack: 2709, ability: 561, trainer: 418, specialEnergy: 22 },
  { decision: "D625", attack: 2709, ability: 561, trainer: 431, specialEnergy: 22 },
  { decision: "D626", attack: 2709, ability: 568, trainer: 432, specialEnergy: 22 },
  { decision: "D627", attack: 2715, ability: 572, trainer: 432, specialEnergy: 22 },
  { decision: "D628", attack: 2715, ability: 577, trainer: 432, specialEnergy: 22 },
  { decision: "D629", attack: 2722, ability: 577, trainer: 432, specialEnergy: 22 },
  { decision: "D630", attack: 2733, ability: 577, trainer: 434, specialEnergy: 22 },
  { decision: "D631", attack: 2733, ability: 586, trainer: 434, specialEnergy: 22 },
  { decision: "D632", attack: 2733, ability: 591, trainer: 434, specialEnergy: 22 },
  { decision: "D633", attack: 2740, ability: 591, trainer: 434, specialEnergy: 22 },
  { decision: "D634", attack: 2748, ability: 591, trainer: 434, specialEnergy: 22 },
  { decision: "D635", attack: 2749, ability: 591, trainer: 435, specialEnergy: 22 },
  { decision: "D636", attack: 2754, ability: 593, trainer: 435, specialEnergy: 22 },
  { decision: "D637", attack: 2754, ability: 593, trainer: 439, specialEnergy: 22 },
  { decision: "D638", attack: 2757, ability: 596, trainer: 439, specialEnergy: 22 },
  { decision: "D639", attack: 2763, ability: 596, trainer: 439, specialEnergy: 22 },
  { decision: "D640", attack: 2766, ability: 596, trainer: 439, specialEnergy: 22 },
  { decision: "D641", attack: 2770, ability: 596, trainer: 442, specialEnergy: 22 },
  { decision: "D642", attack: 2770, ability: 599, trainer: 445, specialEnergy: 22 },
  { decision: "D643", attack: 2770, ability: 602, trainer: 445, specialEnergy: 22 },
  { decision: "D644", attack: 2770, ability: 606, trainer: 446, specialEnergy: 22 },
  { decision: "D645", attack: 2771, ability: 610, trainer: 446, specialEnergy: 22 },
  { decision: "D646", attack: 2771, ability: 610, trainer: 447, specialEnergy: 22 },
  {
    decision: "Catalog re-ingest 2026-11-12",
    attack: 2772,
    ability: 610,
    trainer: 447,
    specialEnergy: 22,
  },
];

describe("CENSUS_HISTORY", () => {
  it("the last recorded slice is the census at HEAD", () => {
    expect(CENSUS_HISTORY.at(-1)).toEqual({
      decision: "Catalog re-ingest 2026-11-12",
      attack: liveAttackBuilt(),
      ability: POPULATION_D581.abilityUnits,
      trainer: POPULATION_D581.trainerUnits,
      specialEnergy: POPULATION_D581.specialEnergyUnits,
    });
  });
});
