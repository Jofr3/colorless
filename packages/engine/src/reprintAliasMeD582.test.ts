import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { bannerOf } from "./banners";
import { isTeraPokemon } from "./cards";
import { CATALOG_MANIFEST as M } from "./catalogManifest";
import type { GameState } from "./index";
import { applyAction, createGame } from "./index";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf, trainerCard } from "./testFixtures";

// ── 🆕🆕🆕 D582 — THE MEGA EVOLUTION SERIE'S REPRINT-ALIAS TIER ──
//
// D190's idiom on the `me` serie: a `me` printing whose text is ALREADY built on a registry id
// is keyed to that id's program OBJECT (`toBe`, never a copy), with no new op, field or object.
// Measured on the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-07: every
// `legal_standard = 1` row of `serie_id = 'me'` joined against every registry id's own row —
//
//   • "face"    — a Trainer / Special Energy whose whole printed face is the twin's: `effect`,
//                 `trainer_type`, `energy_type`, `hp`, `abilities_json`, `attacks_json`, and the
//                 ACE SPEC rarity. 56 rows (54 Trainers, 2 Special Energy).
//   • "pokemon" — a Pokémon whose `abilities_json` is the twin's (Ability NAMES and texts), whose
//                 attacks at every index the twin's program authors are the twin's, and whose
//                 program names no Ability but the printed one. 32.
//   • "text"    — a Pokémon whose one Ability prints the twin's TEXT under another NAME, kept only
//                 where the twin's program is a bare `passive` that names no Ability. 11.
//
// The printed bytes live in the LOCAL D1 and in this table's provenance; no `me` row is a fixture
// (the manifest's fixture slice is the six-set one), so this file pins the RELATION and the counts.

/** [me id, twin id, tier, printed name] — the twin is the WARRANT. */
const ALIASES: readonly (readonly [string, string, "face" | "pokemon" | "text", string])[] = [
  ["me01-114", "sv02-172", "face", "Boss's Orders"],
  ["me01-115", "sv01-173", "face", "Energy Switch"],
  ["me01-125", "sv01-191", "face", "Rare Candy"],
  ["me01-130", "sv01-194", "face", "Switch"],
  ["me01-131", "sv01-196", "face", "Ultra Ball"],
  ["me01-166", "sv10.5b-079", "face", "Air Balloon"],
  ["me01-167", "sv05-144", "face", "Buddy-Buddy Poffin"],
  ["me01-173", "sv06.5-061", "face", "Night Stretcher"],
  ["me01-175", "sv01-191", "face", "Rare Candy"],
  ["mep-092", "svp-150", "face", "Paradise Resort"],
  ["me02-123", "sv01-194", "face", "Switch"],
  ["me02-124", "sv10.5w-086", "face", "Ignition Energy"],
  ["me02.5-019", "sv10-020", "pokemon", "Team Rocket's Spidops"],
  ["me02.5-024", "sv10-036", "pokemon", "Ethan's Magcargo"],
  ["me02.5-026", "sv10-039", "pokemon", "Ethan's Ho-Oh ex"],
  ["me02.5-057", "sv08-057", "pokemon", "Pikachu ex"],
  ["me02.5-060", "sv10.5b-031", "pokemon", "Eelektrik"],
  ["me02.5-070", "sv09-053", "pokemon", "Iono's Bellibolt ex"],
  ["me02.5-072", "svp-182", "pokemon", "Iono's Kilowattrel"],
  ["me02.5-076", "sv09-056", "pokemon", "Lillie's Clefairy ex"],
  ["me02.5-079", "svp-205", "pokemon", "Team Rocket's Mewtwo ex"],
  ["me02.5-082", "sv08-072", "pokemon", "Togekiss"],
  ["me02.5-099", "sv06-095", "pokemon", "Munkidori"],
  ["me02.5-110", "sv10-103", "pokemon", "Cynthia's Gabite"],
  ["me02.5-137", "sv09-098", "pokemon", "N's Zoroark ex"],
  ["me02.5-142", "sv06.5-038", "pokemon", "Fezandipiti ex"],
  ["me02.5-159", "sv06-129", "pokemon", "Drakloak"],
  ["me02.5-171", "sv07-118", "pokemon", "Fan Rotom"],
  ["me02.5-178", "sv08-161", "pokemon", "Terapagos"],
  ["me02.5-179", "sv07-128", "pokemon", "Terapagos ex"],
  ["me02.5-181", "sv10.5b-079", "face", "Air Balloon"],
  ["me02.5-183", "sv02-172", "face", "Boss's Orders"],
  ["me02.5-184", "sv05-144", "face", "Buddy-Buddy Poffin"],
  ["me02.5-186", "sv08-169", "face", "Counter Gain"],
  ["me02.5-189", "sv07-135", "face", "Glass Trumpet"],
  ["me02.5-190", "sv09-149", "face", "Iris's Fighting Spirit"],
  ["me02.5-195", "sv09-153", "face", "N's PP Up"],
  ["me02.5-196", "sv06.5-061", "face", "Night Stretcher"],
  ["me02.5-200", "sv08-187", "face", "Surfer"],
  ["me02.5-201", "sv10-170", "face", "Team Rocket's Archer"],
  ["me02.5-202", "sv10-171", "face", "Team Rocket's Ariana"],
  ["me02.5-203", "sv10-173", "face", "Team Rocket's Factory"],
  ["me02.5-204", "sv10-174", "face", "Team Rocket's Giovanni"],
  ["me02.5-205", "sv10-175", "face", "Team Rocket's Great Ball"],
  ["me02.5-207", "sv10-176", "face", "Team Rocket's Petrel"],
  ["me02.5-208", "sv10-177", "face", "Team Rocket's Proton"],
  ["me02.5-209", "sv10-178", "face", "Team Rocket's Transceiver"],
  ["me02.5-210", "sv10-180", "face", "Team Rocket's Watchtower"],
  ["me02.5-212", "sv10.5w-085", "face", "Tool Scrapper"],
  ["me02.5-214", "sv01-180", "face", "Urbain"],
  ["me02.5-216", "sv10.5b-086", "face", "Prism Energy"],
  ["me02.5-222", "sv10-036", "pokemon", "Ethan's Magcargo"],
  ["me02.5-235", "sv08-072", "pokemon", "Togekiss"],
  ["me02.5-248", "sv06-129", "pokemon", "Drakloak"],
  ["me02.5-250", "sv07-118", "pokemon", "Fan Rotom"],
  ["me02.5-255", "sv08.5-096", "face", "Black Belt's Training"],
  ["me02.5-256", "sv02-172", "face", "Boss's Orders"],
  ["me02.5-258", "sv01-180", "face", "Cheren"],
  ["me02.5-259", "sv08-169", "face", "Counter Gain"],
  ["me02.5-260", "sv07-135", "face", "Glass Trumpet"],
  ["me02.5-261", "sv06-153", "face", "Jamming Tower"],
  ["me02.5-262", "sv09-153", "face", "N's PP Up"],
  ["me02.5-263", "sv10-178", "face", "Team Rocket's Transceiver"],
  ["me02.5-277", "sv08-057", "pokemon", "Pikachu ex"],
  ["me02.5-279", "sv09-053", "pokemon", "Iono's Bellibolt ex"],
  ["me02.5-280", "sv09-056", "pokemon", "Lillie's Clefairy ex"],
  ["me02.5-281", "svp-205", "pokemon", "Team Rocket's Mewtwo ex"],
  ["me02.5-286", "sv09-098", "pokemon", "N's Zoroark ex"],
  ["me02.5-287", "sv10-136", "pokemon", "Marnie's Grimmsnarl ex"],
  ["me02.5-288", "sv06.5-038", "pokemon", "Fezandipiti ex"],
  ["me02.5-289", "sv10-145", "pokemon", "Steven's Metagross ex"],
  ["me02.5-292", "sv09-149", "face", "Iris's Fighting Spirit"],
  ["me02.5-293", "sv08-187", "face", "Surfer"],
  ["me03-071", "sv01-168", "face", "Crushing Hammer"],
  ["me03-072", "sv01-172", "face", "Energy Search"],
  ["me03-076", "sv01-176", "face", "Judge"],
  ["me03-080", "sv01-185", "face", "Poké Ball"],
  ["me03-082", "sv01-187", "face", "Pokémon Catcher"],
  ["me03-083", "sv01-188", "face", "Potion"],
  ["me03-108", "sv10-164", "face", "Energy Recycler"],
  ["me03-115", "sv10-168", "face", "Sacred Ash"],
  ["me04-002", "sv01-121", "pokemon", "Kakuna"],
  ["me04-052", "sv05-008", "pokemon", "Qwilfish"],
  ["me04-108", "sv01-171", "face", "Energy Retrieval"],
  ["me04-115", "sv10.5w-085", "face", "Tool Scrapper"],
  ["me05-104", "sv10.5w-080", "face", "Brave Bangle"],
  ["me05-105", "sv01-168", "face", "Crushing Hammer"],
  ["me05-107", "sv01-173", "face", "Energy Switch"],
  ["me02-011", "sv10-036", "text", "Charmander"],
  ["me02-041", "sv02-150", "text", "Mega Diancie ex"],
  ["me02-070", "sv08-031", "text", "Empoleon ex"],
  ["me02-114", "sv08-031", "text", "Empoleon ex"],
  ["me02.5-267", "sv02-150", "text", "Mega Diancie ex"],
  ["me02.5-282", "sv02-150", "text", "Mega Diancie ex"],
  ["me05-038", "sv01-019", "text", "Mega Chandelure ex"],
  ["me05-099", "sv01-019", "text", "Mega Chandelure ex"],
  ["me05-115", "sv01-019", "text", "Mega Chandelure ex"],
  ["30th-028", "sv03-030", "text", "Pikachu"],
  ["30th-033", "sv06-020", "text", "Pikachu"],
];

/** The `me` printings that print a built TEXT and were deliberately NOT aliased, with why. */
const NOT_ALIASED: readonly (readonly [string, string])[] = [
  // The twin's program NAMES its Ability, so the alias would log the wrong name: a renamed copy.
  // [🆕🆕🆕 D584: ~~Cinccino ex `me04-073` / `-105` / `-119`~~ and ~~Turtonator `me03-017`~~ are KEYED at
  // D584 on the renamed copies `SMOOTH_COAT` / `SHELL_SPIKES` (reprintAliasMeD584.test.ts).]
  // The twin's TEXT and Ability name match, but the twin's program does not: Heatran `sv06-123`
  // ("Incandescent Body") is a D190 alias of Armarouge's SCORCHING_ARMOR, which logs "Scorching
  // Armor" (`triggered[0].name`). The defect is inherited from D190; D582 does not copy it further.
  // [🆕🆕🆕 D584: ~~Numel `me02.5-027` / `-223`~~ are KEYED at D584 on `INCANDESCENT_BODY`, and
  // Heatran moved there too — the defect is fixed.]
  // The face differs in `energy_type`: tcgdex tags the `me` row Normal, the `sv` twin Special.
  // [🆕🆕🆕 D583 (D539): ~~Team Rocket's Energy `me02.5-217`~~ is ALIASED at D583 — cards.ts reads a Special
  // Energy off its printed text, so the tag no longer separates the faces (specialEnergyTagD583.test.ts §4).]
  // A registry ATTACK sentence at another INDEX under another attack NAME: a new object each.
  // [🆕🆕🆕 D593: ~~Drifblim `mep-006`~~, ~~Meowth ex `me03-062` / `-107` / `-121`~~ and ~~Emolga
  // `me04-030`~~ are KEYED at D593 on the new `BALLOON_RETURN` / `TUCK_TAIL` / `SKY_RETURN` (Fade Out's
  // op at each printed index; clauseRowsMeD593.test.ts). Meowth ex's Last-Ditch Catch is still unbuilt. [🆕🆕🆕 D628 (D539): Last-Ditch Catch BUILT at D628 (A1)]]
  // [🆕🆕🆕 D584: ~~Drifloon `30th-073` / `-136`~~ (Float Up idx 0 ~ Gholdengo's Surf Back idx 1) are
  // KEYED at D584 on the new `FLOAT_UP` (Surf Back's ops at index 0).]
];

/** 🆕🆕🆕 D584 — the `me` ids the D584 tier 2 keys (reprintAliasMeD584.test.ts pins each one). */
const KEYED_AT_D584 = [
  "me02.5-213", "me02.5-264", "30th-096", "me02.5-068", "me04-073", "me04-105", "me04-119", "me03-017",
  "me02.5-027", "me02.5-223", "me05-068", "me05-094", "mep-101", "30th-088", "me01-024", "mep-086",
  "30th-073", "30th-136",
];

/** 🆕🆕🆕 D585 — the `me` ids WP19's parameter copies key (paramCopiesMeD585.test.ts pins each one). */
const KEYED_AT_D585 = [
  "me03-024", "me03-092", "me03-019", "me01-084", "me01-147", "me02.5-135", "me02.5-270", "me02.5-285",
  "mep-065", "me03-043", "me03-036", "me02.5-152", "me02.5-271", "me02.5-290", "me02.5-295", "mep-091",
  "me04-029", "me04-090", "mep-075",
];

/** 🆕🆕🆕 D586 — the `me` ids WP03 keys: Carbink "Double Type" (conditionRowsMeD586.test.ts pins the face). */
const KEYED_AT_D586 = ["me02.5-117", "me02.5-242"];

/** 🆕🆕🆕 D587 — the `me` ids WP04 keys: nine Trainer texts (trainerParamsMeD587.test.ts pins each face). */
const KEYED_AT_D587 = [
  "me02-094", "me03-117", "me04-079", "me04-110", "me03-075", "me03-110", "me03-122", "me02-089",
  "me02-119", "me01-116", "me01-168", "me02.5-187", "me03-085", "me03-116", "me02.5-198", "me03-081",
  "me03-113", "me03-073", "me01-126",
];

/** 🆕🆕🆕 D588 — the `me` ids WP22 keys: eight Trainer texts (trainerParamsMeD588.test.ts pins each face). */
const KEYED_AT_D588 = [
  "me02.5-185", "me02.5-257", "me02.5-291", "me01-119", "me01-169", "me01-184", "me02.5-192", "me05-080",
  "me05-111", "me03-084", "me03-114", "me03-123", "me05-081", "me05-112", "me02.5-215", "me03-074",
  "me03-078",
];

/** 🆕🆕🆕 D589 — the `me` ids WP08 keys: Mega Greninja ex ×5 "Mortal Shuriken" (optionalCostMeD589.test.ts pins the program). */
const KEYED_AT_D589 = ["mep-081", "me04-022", "me04-100", "me04-116", "me04-122"];

/** 🆕🆕🆕 D590 — the `me` ids WP05 keys: 13 on-evolve Ability printings (onEvolveMeD590.test.ts pins the programs). */
const KEYED_AT_D590 = [
  "me01-056",
  "mep-003",
  "mep-009",
  "me01-055",
  "me02-047",
  "me01-063",
  "me01-073",
  "me01-017",
  "me01-137",
  "me05-020",
  "me05-088",
  "me02.5-012",
  "me01-097",
];

/** 🆕🆕🆕 D591 — the `me` ids WP20a keys: 19 activated Ability printings (activatedMeD591.test.ts pins the programs). */
const KEYED_AT_D591 = [
  "me01-104",
  "me01-164",
  "me01-182",
  "mep-025",
  "me02.5-053",
  "mep-096",
  "30th-011",
  "30th-130",
  "mep-098",
  "30th-055",
  "30th-133",
  "mep-097",
  "30th-018",
  "30th-132",
  "me01-074",
  "mep-004",
  "me02.5-105",
  "me04-013",
  "mep-074",
];

/** 🆕🆕🆕 D593 — the `me` ids WP07 keys: "Fade Out" ×5 under three printed names (clauseRowsMeD593.test.ts). */
const KEYED_AT_D593 = ["mep-006", "me03-062", "me03-107", "me03-121", "me04-030"];

/** 🆕🆕🆕 D594 — the `me` ids WP33a keys: Luxio "Fighting Roar" and Chesnaught "Needly Armor" (conditionRowsMeD594.test.ts). */
const KEYED_AT_D594 = ["me03-027", "me04-007"];

/** 🆕🆕🆕 D597 — the `me` ids WP29 keys: the "[R]" Mega Charizard X ex "Inferno X" (discardScaledMeD597.test.ts). */
const KEYED_AT_D597 = ["mep-023", "mep-029"];

/** 🆕🆕🆕 D598 — the `me` ids WP32 keys: six KO / damage-taken Abilities (koAbilitiesMeD598.test.ts). */
const KEYED_AT_D598 = [
  ...["me02-056", "me02.5-125", "me02.5-269", "me02.5-284", "mep-073"],
  ...["me02.5-116", "me02.5-268", "me02.5-283", "me05-041"],
  ...["me01-061", "me01-144", "me03-050", "me02.5-143"],
];

/** 🆕🆕🆕 D599 — the `me` ids WP24a keys: Anthea & Concordia ×2 and Emma ×2 (supportersMeD599.test.ts). */
const KEYED_AT_D599 = ["me02.5-182", "me02.5-254", "me04-077", "me04-107"];

/** 🆕🆕🆕 D602 — the `me` ids WP20b keys: 9 activated Ability printings (activatedMeD602.test.ts pins the programs). */
const KEYED_AT_D602 = [
  "me05-070",
  "me05-095",
  "me02.5-007",
  "me02.5-218",
  "30th-008",
  "me01-011",
  "me01-136",
  "me02.5-003",
  "30th-105",
];

/** 🆕🆕🆕 D603 — the `me` ids WP11 keys: 11 Mega-gated printings (megaGatedMeD603.test.ts pins the programs). */
const KEYED_AT_D603 = [
  "mep-024",
  "me02-018",
  "me02-110",
  "me02-007",
  "me02-095",
  "me02-082",
  "me02-062",
  "me01-121",
  "me01-171",
  "me02.5-193",
  "me05-079",
];

/** 🆕🆕🆕 D604 — the `me` ids WP18 keys: the 8 typed Special Energies (typedSpecialEnergyMeD604.test.ts pins the programs). */
const KEYED_AT_D604 = ["me03-086", "me03-087", "me03-088", "me04-084", "me04-085", "me04-086", "me05-083", "me05-084"];

/** 🆕🆕🆕 D606 — the `me` ids WP25a keys: the 9 Stadiums (stadiumsMeD606.test.ts pins the programs). */
const KEYED_AT_D606 = ["me04-080", "me04-111", "me01-129", "me04-114", "me02.5-197", "me03-077", "me03-111", "mep-028", "mep-120"];

/** 🆕🆕🆕 D608 — the `30th` ids WP30 keys: Photon Bullets ×3, Stealthy Slash ×2 (snipeSpreadMeD608.test.ts). */
const KEYED_AT_D608 = ["30th-064", "30th-151", "30th-157", "30th-021", "30th-148"];

/** 🆕🆕🆕 D612 — the attack-only keys WP06's normaliser retires: Inferno X (`KEYED_AT_D597`) and the
    two Stealthy Slash of `KEYED_AT_D608` (cardTextD612.test.ts). */
const RETIRED_AT_D612 = ["mep-023", "mep-029", "30th-021", "30th-148"];

/** 🆕🆕🆕 D625 — the `me` ids T1 keys: Special Red Card ×2, Jumbo Ice Cream ×2, Dark Bell ×2, Wally's Compassion ×3,
    Blowtorch ×2, Great Haul Net, Strange Timepiece (trainersMeD625.test.ts). */
const KEYED_AT_D625 = [
  ...["me04-082", "me04-113", "me02-091", "me04-109", "me05-075", "me05-106"],
  ...["me01-132", "me01-176", "me01-186", "me02-086", "me02-117", "me04-078", "me01-128"],
];

/** 🆕🆕🆕 D626 — the `me` ids K1 keys: Flygon ×3, Miraidon ×2, Gengar ex ×2, Adversity Policy
    (koTriggerRestMeD626.test.ts). */
const KEYED_AT_D626 = [
  ...["mep-016", "me02-053", "me02-101", "mep-082", "me05-028", "30th-090", "30th-154", "me04-074"],
];

/** 🆕🆕🆕 D627 — the `me` ids H1 keys: Poltchageist, Sinistcha, Shuppet, Banette "Hide 'n' Sneak"
    (hideNSneakMeD627.test.ts). */
const KEYED_AT_D627 = ["me05-005", "me05-006", "me05-033", "me05-034"];

/** 🆕🆕🆕 D628 — the NEW `me` keys A1 adds: Latios "Lustrous Assist" and Larry's Komala "Lethargic Charge"
    (onBenchMoveMeD628.test.ts). Meowth ex ×3 "Last-Ditch Catch" rides `KEYED_AT_D593`'s keys. */
const KEYED_AT_D628 = ["me01-101", "me02.5-175"];

/** 🆕🆕🆕 D630 — the `me` ids M1 keys: Iron Defender ×2 (persistedRecordsMeD630.test.ts). */
const KEYED_AT_D630 = ["me01-118", "me05-110"];

/** 🆕🆕🆕 D631 — the `me` / `30th` ids P1 keys (passiveRestMeD631.test.ts). */
const KEYED_AT_D631 = ["mep-085", "me05-062", "me05-093", "me03-012", "me03-100", "me02.5-148", "me04-057", "30th-100", "30th-119"];

/** 🆕🆕🆕 D632 — the `me` ids D1 keys: Damp ×5 (dampD632.test.ts). */
const KEYED_AT_D632 = ["me02.5-039", "me02.5-040", "me02.5-226", "mep-007", "mep-008"];

/** 🆕🆕🆕 D635 — the `me` id F1 keys: Fossil Quarry (fossilQuarryD635.test.ts). */
const KEYED_AT_D635 = ["me05-076"];

/** 🆕🆕🆕 D636 — the `me` ids L1 + Clawitzer keys: Clawitzer ×2 (nextTurnLocksD636.test.ts). */
const KEYED_AT_D636 = ["me01-038", "me01-141"];

/** 🆕🆕🆕 D637 — the four `me` Antique Fossils (antiqueFossilsMeD637.test.ts). */
const KEYED_AT_D637 = ["me03-068", "me03-069", "me05-072", "me05-073"];

/** 🆕🆕🆕 D638 — Mew ex ×3 "Memory Helix" (copyBorrowedMeD638.test.ts). */
const KEYED_AT_D638 = ["30th-066", "30th-152", "30th-158"];

/** 🆕🆕🆕 D621 — the `me` ids WP24c + WP23 key: Gladion's Final Battle ×3, Premium Power Pro ×3, Acerola's
    Mischief ×4, Roxie's Performance ×3, Dawn ×3 (sideStateMeD621.test.ts). */
const KEYED_AT_D621 = [
  ...["me05-077", "me05-108", "me05-118", "me01-124", "me01-174", "me02.5-199"],
  ...["me01-113", "me01-165", "me01-183", "me02.5-180", "me04-081", "me04-112", "me04-121"],
  ...["me02-087", "me02-118", "me02-129"],
];

/** 🆕🆕🆕 D620 — the `me` ids WP26 keys: Light Ball, Punk Helmet ×2, Team Rocket's Hypnotizer, Core Memory,
    Tremendous Bomb ×2 (prizesToolsMeD620.test.ts). */
const KEYED_AT_D620 = [...["me02.5-191", "me02-092", "me02-121", "me02.5-206"], ...["me03-070", "me05-082", "me05-113"]];

/** 🆕🆕🆕 D619 — the `me` ids WP12 / WP15 key: Sacred Charm ×2, Thick Scale, Dewgong ×2, Heliolisk ×2
    (attackerClassMeD619.test.ts). */
const KEYED_AT_D619 = [
  ...["me02-093", "me02-122", "me02.5-211"],
  ...["me02-022", "me02-097"],
  ...["me02.5-064", "me02.5-229"],
];

/** 🆕🆕🆕 D618 — the `me` ids WP25b keys: 8 Stadium printings (stadiumsMeD618.test.ts). */
const KEYED_AT_D618 = [
  ...["me02-085", "me02-116"],
  ...["me01-122", "me01-172", "me02.5-194"],
  ...["me01-117", "me02.5-188", "me03-109"],
];

/** 🆕🆕🆕 D617 — the `me` ids WP24b keys: 11 Supporter printings (supportersMeD617.test.ts). */
const KEYED_AT_D617 = [
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

/** 🆕🆕🆕 D614 — the `me` ids WP37b keys: Mega Clefable ex ×4 "Luminous Wing" (abilityShieldMeD614.test.ts). */
const KEYED_AT_D614 = ["mep-072", "me03-031", "me03-103", "me03-119"];

/** 🆕🆕🆕 D611 — the `me` ids WP21 (+ Dragonair) keys: 17 activated Ability printings (activatedMeD611.test.ts). */
const KEYED_AT_D611 = [
  ...["me04-051", "me04-093", "mep-076", "me02-068", "me02-103", "mep-017", "me02.5-015", "me02.5-220", "me05-045"],
  ...["me05-100", "me01-110", "me01-153", "me03-014", "me03-091", "me03-009", "me04-038", "me02.5-151"],
];

/** 🆕🆕🆕 D610 — the `me` ids WP37a keys: 16 Ability / trigger / passive printings (onMoveHpMeD610.test.ts). */
const KEYED_AT_D610 = [
  ...["me01-003", "me01-155", "me01-177", "mep-013", "me02.5-084", "me04-064", "me04-103", "me02-036"],
  ...["me02-112", "me02.5-101", "me02.5-239", "mep-094", "30th-002", "30th-129", "mep-066", "me03-045"],
];

/** The five `me` Tera reprints banners.ts carries (each printed face checked on tcgdex's image). */
const ME_TERA = ["me02.5-038", "me02.5-057", "me02.5-160", "me02.5-179", "me02.5-277"] as const;

/** The Ability NAMES each aliased `me` Pokémon prints (LOCAL D1 `abilities_json`, 2026-10-07).
    Terapagos `me02.5-178` / Terapagos ex `me02.5-179` print none. */
const PRINTED_ABILITY: Readonly<Record<string, readonly string[]>> = {
  "me02.5-019": ["Charging Up"],
  "me02.5-024": ["Melt Away"],
  "me02.5-026": ["Golden Flame"],
  "me02.5-057": ["Resolute Heart"],
  "me02.5-060": ["Dynamotor"],
  "me02.5-070": ["Electric Streamer"],
  "me02.5-072": ["Flashing Draw"],
  "me02.5-076": ["Fairy Zone"],
  "me02.5-079": ["Power Saver"],
  "me02.5-082": ["Wonder Kiss"],
  "me02.5-099": ["Adrena-Brain"],
  "me02.5-110": ["Champion's Call"],
  "me02.5-137": ["Trade"],
  "me02.5-142": ["Flip the Script"],
  "me02.5-159": ["Recon Directive"],
  "me02.5-171": ["Fan Call"],
  "me02.5-178": [],
  "me02.5-179": [],
  "me02.5-222": ["Melt Away"],
  "me02.5-235": ["Wonder Kiss"],
  "me02.5-248": ["Recon Directive"],
  "me02.5-250": ["Fan Call"],
  "me02.5-277": ["Resolute Heart"],
  "me02.5-279": ["Electric Streamer"],
  "me02.5-280": ["Fairy Zone"],
  "me02.5-281": ["Power Saver"],
  "me02.5-286": ["Trade"],
  "me02.5-287": ["Punk Up"],
  "me02.5-288": ["Flip the Script"],
  "me02.5-289": ["X-Boot"],
  "me04-002": ["Exoskeleton"],
  "me04-052": ["Poison Point"],
  "me02-011": ["Agile"],
  "me02-041": ["Diamond Coat"],
  "me02-070": ["Emperor's Stance"],
  "me02-114": ["Emperor's Stance"],
  "me02.5-267": ["Diamond Coat"],
  "me02.5-282": ["Diamond Coat"],
  "me05-038": ["Binding Flame"],
  "me05-099": ["Binding Flame"],
  "me05-115": ["Binding Flame"],
  "30th-028": ["Lonely Gaze"],
  "30th-033": ["Keep Hidden"],
};

/** Every Ability name a program carries — `abilities[].name`, `triggered[].name`, and any
    `ability` string nested in a passive (e.g. `koPrizeBonus.ability`) — i.e. what the log shows. */
function programAbilityNames(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) programAbilityNames(x, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if ((k === "name" || k === "ability") && typeof x === "string") out.push(x);
      programAbilityNames(x, out);
    }
  return out;
}

describe("D582 — the `me` reprint-alias tier: 99 printings on 66 existing programs", () => {
  it("resolves every `me` id to the SAME PROGRAM OBJECT as its twin", () => {
    for (const [id, twin, , name] of ALIASES) {
      expect(programFor(twin), `${twin} (twin of ${id}) has no program`).toBeDefined();
      expect(programFor(id), `${id} (${name}) does not SHARE ${twin}'s program`).toBe(programFor(twin));
    }
  });

  it("99 rows: 56 faces, 32 same-Ability Pokémon, 11 same-text passives; 66 twins, 66 objects", () => {
    expect(ALIASES).toHaveLength(99);
    const tier = (t: string) => ALIASES.filter(([, , k]) => k === t).length;
    expect([tier("face"), tier("pokemon"), tier("text")]).toEqual([56, 32, 11]);
    expect(new Set(ALIASES.map(([id]) => id)).size).toBe(99);
    expect(new Set(ALIASES.map(([, twin]) => twin)).size).toBe(66);
    expect(new Set(ALIASES.map(([, twin]) => programFor(twin))).size).toBe(66);
  });

  it("the registry's `me` keys are EXACTLY this table — nothing keyed outside it (🆕🆕🆕 D583: plus Team Rocket's Energy `me02.5-217`; 🆕🆕🆕 D584: plus the 18 tier-2 keys; 🆕🆕🆕 D585: plus the 19 WP19 keys; 🆕🆕🆕 D586: plus Carbink ×2; 🆕🆕🆕 D587: plus the 19 WP04 Trainer keys; 🆕🆕🆕 D588: plus the 17 WP22 Trainer keys; 🆕🆕🆕 D589: plus Mega Greninja ex ×5; 🆕🆕🆕 D590: plus the 13 WP05 on-evolve keys; 🆕🆕🆕 D591: plus the 19 WP20a activated Ability keys; 🆕🆕🆕 D593: plus the 5 WP07 Fade Out keys; 🆕🆕🆕 D594: plus the 2 WP33a Ability keys; 🆕🆕🆕 D597: plus the 2 WP29 Inferno X keys; 🆕🆕🆕 D598: plus the 13 WP32 Ability keys; 🆕🆕🆕 D599: plus the 4 WP24a Supporter keys; 🆕🆕🆕 D602: plus the 9 WP20b activated Ability keys; 🆕🆕🆕 D603: plus the 11 WP11 Mega-gated keys; 🆕🆕🆕 D604: plus the 8 WP18 typed Special Energy keys; 🆕🆕🆕 D606: plus the 9 WP25a Stadium keys; 🆕🆕🆕 D608: plus the 5 WP30 `30th` attack keys; 🆕🆕🆕 D610: plus the 16 WP37a keys; 🆕🆕🆕 D611: plus the 17 WP21 keys; 🆕🆕🆕 D612: minus the 4 retired attack keys; 🆕🆕🆕 D614: plus the 4 WP37b keys; 🆕🆕🆕 D617: plus the 11 WP24b Supporter keys; 🆕🆕🆕 D618: plus the 8 WP25b Stadium keys; 🆕🆕🆕 D619: plus the 7 WP12 / WP15 keys; 🆕🆕🆕 D620: plus the 7 WP26 Tool keys; 🆕🆕🆕 D621: plus the 16 WP24c + WP23 Trainer keys; 🆕🆕🆕 D625: plus the 13 T1 Trainer keys; 🆕🆕🆕 D626: plus the 8 K1 keys; 🆕🆕🆕 D627: plus the 4 H1 keys; 🆕🆕🆕 D628: plus the 2 new A1 keys; 🆕🆕🆕 D630: plus the 2 M1 Trainer keys; 🆕🆕🆕 D631: plus the 9 P1 keys; 🆕🆕🆕 D632: plus the 5 D1 Damp keys; 🆕🆕🆕 D635: plus the F1 Fossil Quarry key; 🆕🆕🆕 D636: plus the 2 Clawitzer keys; 🆕🆕🆕 D637: plus the 4 `me` Antique Fossil keys; 🆕🆕🆕 D638: plus the 3 X1 Memory Helix keys)", () => {
    const me = registryCardIds().filter((id) => /^(me|30th)/.test(id));
    // 🆕🆕🆕 D583 — the one `me` key outside the D582 table: Team Rocket's Energy, on `sv10-182`'s object.
    // 🆕🆕🆕 D584 — and the 18 tier-2 keys (`KEYED_AT_D584`).
    expect(KEYED_AT_D584).toHaveLength(18);
    // 🆕🆕🆕 D585 — and WP19's 19 parameter-copy keys (`KEYED_AT_D585`).
    expect(KEYED_AT_D585).toHaveLength(19);
    // 🆕🆕🆕 D586 — and WP03's Carbink ×2 (`KEYED_AT_D586`).
    expect(KEYED_AT_D586).toHaveLength(2);
    // 🆕🆕🆕 D587 — and WP04's 19 Trainer keys (`KEYED_AT_D587`).
    expect(KEYED_AT_D587).toHaveLength(19);
    // 🆕🆕🆕 D588 — and WP22's 17 Trainer keys (`KEYED_AT_D588`).
    expect(KEYED_AT_D588).toHaveLength(17);
    // 🆕🆕🆕 D589 — and WP08's Mega Greninja ex ×5 (`KEYED_AT_D589`).
    expect(KEYED_AT_D589).toHaveLength(5);
    // 🆕🆕🆕 D590 — and WP05's 13 on-evolve keys (`KEYED_AT_D590`).
    expect(KEYED_AT_D590).toHaveLength(13);
    // 🆕🆕🆕 D591 — and WP20a's 19 activated Ability keys (`KEYED_AT_D591`).
    expect(KEYED_AT_D591).toHaveLength(19);
    // 🆕🆕🆕 D593 — and WP07's 5 attack-only Fade Out keys (`KEYED_AT_D593`).
    expect(KEYED_AT_D593).toHaveLength(5);
    // 🆕🆕🆕 D594 — and WP33a's 2 Ability keys (`KEYED_AT_D594`).
    expect(KEYED_AT_D594).toHaveLength(2);
    // 🆕🆕🆕 D597 — and WP29's 2 attack-only Inferno X keys (`KEYED_AT_D597`).
    expect(KEYED_AT_D597).toHaveLength(2);
    // 🆕🆕🆕 D598 — and WP32's 13 Ability keys (`KEYED_AT_D598`).
    expect(KEYED_AT_D598).toHaveLength(13);
    // 🆕🆕🆕 D599 — and WP24a's 4 Supporter keys (`KEYED_AT_D599`).
    expect(KEYED_AT_D599).toHaveLength(4);
    // 🆕🆕🆕 D602 — and WP20b's 9 activated Ability keys (`KEYED_AT_D602`).
    expect(KEYED_AT_D602).toHaveLength(9);
    // 🆕🆕🆕 D603 — and WP11's 11 Mega-gated keys (`KEYED_AT_D603`).
    expect(KEYED_AT_D603).toHaveLength(11);
    // 🆕🆕🆕 D604 — and WP18's 8 typed Special Energy keys (`KEYED_AT_D604`).
    expect(KEYED_AT_D604).toHaveLength(8);
    // 🆕🆕🆕 D606 — and WP25a's 9 Stadium keys (`KEYED_AT_D606`).
    expect(KEYED_AT_D606).toHaveLength(9);
    // 🆕🆕🆕 D608 — and WP30's 5 attack-only `30th` keys (`KEYED_AT_D608`).
    expect(KEYED_AT_D608).toHaveLength(5);
    // 🆕🆕🆕 D610 — and WP37a's 16 Ability / trigger / passive keys (`KEYED_AT_D610`).
    expect(KEYED_AT_D610).toHaveLength(16);
    // 🆕🆕🆕 D611 — and WP21's 17 activated Ability keys (`KEYED_AT_D611`).
    expect(KEYED_AT_D611).toHaveLength(17);
    // 🆕🆕🆕 D612 — minus the four attack-only keys WP06 retires (`RETIRED_AT_D612`): Inferno X ×2 and
    // Stealthy Slash ×2, whose normalised text a reader builds.
    expect(RETIRED_AT_D612).toHaveLength(4);
    // 🆕🆕🆕 D614 — and WP37b's 4 passive keys (`KEYED_AT_D614`).
    expect(KEYED_AT_D614).toHaveLength(4);
    // 🆕🆕🆕 D617 — and WP24b's 11 Supporter keys (`KEYED_AT_D617`).
    expect(KEYED_AT_D617).toHaveLength(11);
    // 🆕🆕🆕 D618 — and WP25b's 8 Stadium keys (`KEYED_AT_D618`).
    expect(KEYED_AT_D618).toHaveLength(8);
    // 🆕🆕🆕 D619 — and WP12 / WP15's 7 keys (`KEYED_AT_D619`).
    expect(KEYED_AT_D619).toHaveLength(7);
    // 🆕🆕🆕 D620 — and WP26's 7 Tool keys (`KEYED_AT_D620`).
    expect(KEYED_AT_D620).toHaveLength(7);
    // 🆕🆕🆕 D621 — and WP24c + WP23's 16 Trainer keys (`KEYED_AT_D621`).
    expect(KEYED_AT_D621).toHaveLength(16);
    // 🆕🆕🆕 D625 — and T1's 13 Trainer keys (`KEYED_AT_D625`).
    expect(KEYED_AT_D625).toHaveLength(13);
    // 🆕🆕🆕 D626 — and K1's 8 keys (`KEYED_AT_D626`).
    expect(KEYED_AT_D626).toHaveLength(8);
    // 🆕🆕🆕 D627 — and H1's 4 keys (`KEYED_AT_D627`).
    expect(KEYED_AT_D627).toHaveLength(4);
    // 🆕🆕🆕 D628 — and A1's 2 new keys (`KEYED_AT_D628`).
    expect(KEYED_AT_D628).toHaveLength(2);
    // 🆕🆕🆕 D630 — and M1's 2 Iron Defender keys (`KEYED_AT_D630`).
    expect(KEYED_AT_D630).toHaveLength(2);
    // 🆕🆕🆕 D631 — and P1's 9 passive / trigger keys (`KEYED_AT_D631`).
    expect(KEYED_AT_D631).toHaveLength(9);
    // 🆕🆕🆕 D632 — and D1's 5 Damp keys (`KEYED_AT_D632`).
    expect(KEYED_AT_D632).toHaveLength(5);
    // 🆕🆕🆕 D635 — and F1's Fossil Quarry key (`KEYED_AT_D635`).
    expect(KEYED_AT_D635).toHaveLength(1);
    // 🆕🆕🆕 D636 — and Clawitzer ×2 (`KEYED_AT_D636`).
    expect(KEYED_AT_D636).toHaveLength(2);
    // 🆕🆕🆕 D637 — and the four `me` Antique Fossils (`KEYED_AT_D637`).
    expect(KEYED_AT_D637).toHaveLength(4);
    // 🆕🆕🆕 D638 — and Mew ex ×3 (`KEYED_AT_D638`).
    expect(KEYED_AT_D638).toHaveLength(3);
    expect(me.sort()).toEqual(
      [
        ...ALIASES.map(([id]) => id),
        "me02.5-217",
        ...KEYED_AT_D584,
        ...KEYED_AT_D585,
        ...KEYED_AT_D586,
        ...KEYED_AT_D587,
        ...KEYED_AT_D588,
        ...KEYED_AT_D589,
        ...KEYED_AT_D590,
        ...KEYED_AT_D591,
        ...KEYED_AT_D593,
        ...KEYED_AT_D594,
        ...KEYED_AT_D597,
        ...KEYED_AT_D598,
        ...KEYED_AT_D599,
        ...KEYED_AT_D602,
        ...KEYED_AT_D603,
        ...KEYED_AT_D604,
        ...KEYED_AT_D606,
        ...KEYED_AT_D608,
        ...KEYED_AT_D610,
        ...KEYED_AT_D611,
        ...KEYED_AT_D614,
        ...KEYED_AT_D617,
        ...KEYED_AT_D618,
        ...KEYED_AT_D619,
        ...KEYED_AT_D620,
        ...KEYED_AT_D621,
        ...KEYED_AT_D625,
        ...KEYED_AT_D626,
        ...KEYED_AT_D627,
        ...KEYED_AT_D628,
        ...KEYED_AT_D630,
        ...KEYED_AT_D631,
        ...KEYED_AT_D632,
        ...KEYED_AT_D635,
        ...KEYED_AT_D636,
        ...KEYED_AT_D637,
        ...KEYED_AT_D638,
      ]
        .filter((id) => !RETIRED_AT_D612.includes(id))
        .sort(),
    );
    // …and no twin is a `me` id: every program the tier reaches was built for the `sv` serie.
    for (const [, twin] of ALIASES) expect(/^(me|30th)/.test(twin), twin).toBe(false);
  });

  it("a `text` alias's program names no Ability — the condition that makes the rename harmless", () => {
    for (const [id, twin, tier] of ALIASES) {
      if (tier !== "text") continue;
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
      expect(JSON.stringify(programFor(twin)), twin).not.toContain('"ability"');
    }
  });

  it("every Pokémon alias's program names only Abilities its `me` printing prints (no wrong-name log)", () => {
    const pokemon = ALIASES.filter(([, , t]) => t !== "face");
    expect(pokemon).toHaveLength(43);
    expect(Object.keys(PRINTED_ABILITY).sort()).toEqual(pokemon.map(([id]) => id).sort());
    for (const [id, , , name] of pokemon) {
      const printed = PRINTED_ABILITY[id] ?? [];
      for (const named of programAbilityNames(programFor(id)))
        expect(printed, `${id} (${name}) logs "${named}"`).toContain(named);
    }
    // The exclusion this rung enforces: Heatran's program (the Numel twin) names Armarouge's Ability.
    // [🆕🆕🆕 D584 (D539): ~~"Scorching Armor"~~ — WITHDRAWN: Heatran is keyed on the D584 renamed copy
    // and names its printed Ability, so the exclusion is lifted and Numel ×2 share it.]
    expect(programAbilityNames(programFor("sv06-123"))).toEqual(["Incandescent Body"]);
  });

  it("the deliberately NOT-aliased printings stay unregistered", () => {
    for (const [id, why] of NOT_ALIASED) expect(programFor(id), `${id}: ${why}`).toBeUndefined();
  });

  it("no `me` id is a fixture or a manifest printing — the reason this file pins no TEXT", () => {
    for (const [id] of ALIASES) {
      expect(FIXTURE_POOL[id], id).toBeUndefined();
      expect(M.printed[id], id).toBeUndefined();
    }
  });
});

describe("D582 — the five `me` Tera reprints carry the banner", () => {
  it("banners.ts marks them Tera, by id — and the three that are registry aliases share their twin's program", () => {
    for (const id of ME_TERA) expect(bannerOf(battler(id, { name: "x ex" })), id).toBe("Tera");
    expect(isTeraPokemon(battler("me02.5-057", { name: "Pikachu ex" }))).toBe(true);
    // A Pikachu ex printing the banner table does not name is NOT Tera — by id, never by name.
    expect(isTeraPokemon(battler("me02.5-276", { name: "Pikachu ex" }))).toBe(false);
    for (const [id, twin] of [
      ["me02.5-057", "sv08-057"],
      ["me02.5-277", "sv08-057"],
      ["me02.5-179", "sv07-128"],
    ] as const) {
      expect(programFor(id), id).toBe(programFor(twin));
      expect(bannerOf(battler(twin, { name: "x ex" })), twin).toBe("Tera");
    }
  });
});

// ── ON A BOARD: an aliased `me` Trainer plays through its twin's program ──

const URBAIN = "me02.5-214"; // Urbain prints Nemona's "Draw 3 cards." (twin `sv01-180`)
const FILLER = "d582a-filler";
const POOL: Record<string, Card> = {
  ...FIXTURE_POOL,
  [URBAIN]: { ...trainerCard(URBAIN, "Supporter", "Draw 3 cards."), name: "Urbain" },
  [FILLER]: battler(FILLER, { hp: 900 }),
};
const DECK = deckOf({ [URBAIN]: 4, [FILLER]: 36, "fix-energy": 20 });

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function p1Turn(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

describe("D582 — an aliased `me` Supporter on a board", () => {
  it("Urbain `me02.5-214` plays as Nemona: the card leaves the hand and 3 are drawn", () => {
    let state = p1Turn(5822);
    const side = state.players.p1;
    let uid = side.hand.find((u) => state.cardIdByUid[u] === URBAIN);
    if (uid === undefined) {
      uid = side.deck.find((u) => state.cardIdByUid[u] === URBAIN) as string;
      state = {
        ...state,
        players: { ...state.players, p1: { ...side, hand: [...side.hand, uid], deck: side.deck.filter((u) => u !== uid) } },
      };
    }
    const before = state.players.p1.hand.length;
    const deck = state.players.p1.deck.length;
    const after = must(applyAction(state, { type: "playTrainer", seat: "p1", uid }));
    expect(after.players.p1.hand.length).toBe(before - 1 + 3);
    expect(after.players.p1.deck.length).toBe(deck - 3);
    expect(after.players.p1.discard).toContain(uid);
  });
});
