// A second reading of each Pokémon's Prize value, rule-box suffix and Rule Box, from its printed name
// family and the catalog's suffix tag, held against the engine's own `prizeValueOf`,
// `pokemonSuffixOf` and `hasRuleBox`.
// The ingest exits 1 on a disagreement over a legal card, and db-check runs it over the stored
// catalog.

import { hasRuleBox, pokemonSuffixOf, prizeValueOf } from "@colorless/engine";
import { mapCardRow } from "../catalog/map";
import type { CardRow } from "./map";

/** A printed family: how the name shows it, the suffix tags the catalog gives it, the suffix the
    engine should read, the Prizes it gives up, and whether it has a Rule Box. */
interface Family {
  name: string;
  matches: (name: string) => boolean;
  catalogSuffixes: readonly (string | null)[];
  engineSuffix: string | null;
  prizes: number;
  ruleBox: boolean;
}

const ends = (suffix: string) => (name: string) => name.endsWith(suffix);

/** Most specific first: the first family whose name test passes is the card's, else PLAIN. */
const FAMILIES: readonly Family[] = [
  {
    name: "TAG TEAM",
    matches: (n) => n.includes(" & ") && n.endsWith(" GX"),
    catalogSuffixes: ["GX"],
    engineSuffix: "GX",
    prizes: 3,
    ruleBox: true,
  },
  {
    name: "LEGEND",
    matches: ends(" LEGEND"),
    catalogSuffixes: ["Legend"],
    engineSuffix: null,
    prizes: 2,
    ruleBox: true,
  },
  {
    name: "Mega Evolution ex",
    matches: (n) => n.startsWith("Mega ") && n.endsWith(" ex"),
    catalogSuffixes: ["ex"],
    engineSuffix: "ex",
    prizes: 3,
    ruleBox: true,
  },
  {
    name: "ex",
    matches: ends(" ex"),
    catalogSuffixes: ["ex"],
    engineSuffix: "ex",
    prizes: 2,
    ruleBox: true,
  },
  {
    name: "EX",
    matches: ends(" EX"),
    catalogSuffixes: ["EX"],
    engineSuffix: "EX",
    prizes: 2,
    ruleBox: true,
  },
  {
    name: "GX",
    matches: ends(" GX"),
    catalogSuffixes: ["GX"],
    engineSuffix: "GX",
    prizes: 2,
    ruleBox: true,
  },
  {
    name: "VMAX",
    matches: ends(" VMAX"),
    catalogSuffixes: ["V", null],
    engineSuffix: "VMAX",
    prizes: 3,
    ruleBox: true,
  },
  {
    name: "VSTAR",
    matches: ends(" VSTAR"),
    catalogSuffixes: ["V", null],
    engineSuffix: "VSTAR",
    prizes: 2,
    ruleBox: true,
  },
  {
    name: "V",
    matches: ends(" V"),
    catalogSuffixes: ["V"],
    engineSuffix: "V",
    prizes: 2,
    ruleBox: true,
  },
  {
    name: "BREAK",
    matches: ends(" BREAK"),
    catalogSuffixes: [null],
    engineSuffix: null,
    prizes: 1,
    ruleBox: true,
  },
  {
    name: "Radiant",
    matches: (n) => n.startsWith("Radiant "),
    catalogSuffixes: [null],
    engineSuffix: null,
    prizes: 1,
    ruleBox: true,
  },
];

/** Any other name. Pokémon SP (Crobat G) is read as a plain Pokémon, unchecked against the
    printed card. */
const PLAIN: Family = {
  name: "plain",
  matches: () => true,
  catalogSuffixes: [null, "SP"],
  engineSuffix: null,
  prizes: 1,
  ruleBox: false,
};

/** Cards whose catalog suffix disagrees with the printed name, the name being right. */
export const RULE_BOX_EXCEPTIONS: Readonly<Record<string, string>> = {
  "sv02-064": 'a plain-named Raichu the catalog tags "ex"',
  "sv02-211": 'a plain-named Raichu the catalog tags "ex"',
};

/** A card's printed family, by name. */
function familyOf(name: string): Family {
  return FAMILIES.find((f) => f.matches(name)) ?? PLAIN;
}

/** The legal Pokémon (Standard or Expanded) whose engine Prize value, suffix or Rule Box is not what its
    printed family has, or whose catalog suffix is not one its family is tagged with, each as
    "id: why"; RULE_BOX_EXCEPTIONS are skipped. */
export function ruleBoxMismatches(rows: readonly CardRow[]): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    const card = mapCardRow(row);
    if (card.category !== "Pokemon" || !(card.legal.standard || card.legal.expanded)) continue;
    if (Object.hasOwn(RULE_BOX_EXCEPTIONS, card.id)) continue;
    const family = familyOf(card.name);
    const what = `${card.id}: ${card.name} (${family.name})`;
    const prizes = prizeValueOf(card);
    if (prizes !== family.prizes) {
      problems.push(`${what} gives ${prizes} Prizes, not ${family.prizes}`);
    }
    const engineSuffix = pokemonSuffixOf(card);
    if (engineSuffix !== family.engineSuffix) {
      problems.push(`${what} reads as suffix ${String(engineSuffix)} in the engine`);
    }
    if (hasRuleBox(card) !== family.ruleBox) {
      problems.push(`${what} ${family.ruleBox ? "has no" : "has a"} Rule Box in the engine`);
    }
    if (!family.catalogSuffixes.includes(row.suffix)) {
      problems.push(`${what} carries catalog suffix ${String(row.suffix)}`);
    }
  }
  return problems;
}
