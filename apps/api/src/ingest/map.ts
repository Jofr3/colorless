// tcgdex to catalog-row mapping. Every column is always emitted, explicit null included, so upserts
// stay rectangular and reruns overwrite stale values. Sentinels normalise to null on vocabulary
// columns. A Trainer keeps the `hp`, abilities and attacks it prints. All printed text goes through
// `normalizeCardText`.

import { isSpecialEnergy, normalizeCardText } from "@colorless/engine";
import type { TcgdexCard, TcgdexSerie, TcgdexSet } from "@colorless/schema";
import { isAssetOriginUrl } from "../assets/files";
import type { cards, series, sets } from "../db/schema";
import { normalizeSentinel } from "../sentinel";
import { WEAK_RES_SUPPLEMENT } from "./weakResSupplement";

export type SeriesRow = Required<typeof series.$inferInsert>;
export type SetRow = Required<typeof sets.$inferInsert>;
export type CardRow = Required<typeof cards.$inferInsert>;

/** An upstream asset base URL, kept only on the asset origin: the /assets mirror fetches from it
    and stores what it gets for good, so any other host or scheme is dropped as no image. */
function assetBase(url: string | undefined): string | null {
  return url !== undefined && isAssetOriginUrl(url) ? url : null;
}

export function mapSerie(serie: TcgdexSerie): SeriesRow {
  return {
    id: serie.id,
    name: serie.name,
    releaseDate: serie.releaseDate ?? null,
    logoUrl: assetBase(serie.logo),
  };
}

export function mapSet(set: TcgdexSet): SetRow {
  return {
    id: set.id,
    serieId: set.serie.id,
    name: set.name,
    logoUrl: assetBase(set.logo),
    symbolUrl: assetBase(set.symbol),
    releaseDate: set.releaseDate,
    countTotal: set.cardCount.total,
    countOfficial: set.cardCount.official,
    legalStandard: set.legal.standard,
    legalExpanded: set.legal.expanded,
    tcgOnline: set.tcgOnline ?? null,
    abbreviation: set.abbreviation?.official ?? null,
  };
}

/** FNV-1a over UTF-16 code units, two independent 32-bit lanes → 16 hex chars.
    Pure JS so the Worker bundle needs no crypto import for a column it only reads. */
function fnv64(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + 1), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The functional identity of a print: everything the reprint rule compares.
    A Trainer or Energy is its name, subtype and rules text; a Pokémon also
    its HP, stage, suffix, evolution, types, retreat, abilities, attacks,
    weakness and resistance. Set, number, rarity, art, regulation mark and
    legality are NOT part of it — those are what differ between reprints.
    Strings compare whitespace-collapsed and case-insensitively. */
export function printKey(row: CardRow): string {
  const parts: unknown[] = [row.category, row.name];
  switch (row.category) {
    case "Pokemon":
      parts.push(
        row.hp,
        row.stage,
        row.suffix,
        row.evolveFrom,
        row.typesJson,
        row.retreat,
        row.abilitiesJson,
        row.attacksJson,
        row.weaknessesJson,
        row.resistancesJson,
      );
      break;
    case "Trainer":
      parts.push(row.trainerType, row.effect, row.hp, row.abilitiesJson, row.attacksJson);
      break;
    case "Energy":
      parts.push(row.energyType, row.effect);
      break;
  }
  const text = JSON.stringify(parts, (_key, value: unknown) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : value,
  );
  return fnv64(text);
}

export function mapCard(card: TcgdexCard): CardRow {
  const row = mapCardFields(card);
  // The post-pass OR's these across the key; until it runs they are this print's own.
  return {
    ...row,
    printKey: printKey(row),
    legalStandardEffective: row.legalStandard,
    legalExpandedEffective: row.legalExpanded,
  };
}

function mapCardFields(card: TcgdexCard): CardRow {
  // Every category-specific column defaults to null; each branch fills its own.
  const base: CardRow = {
    id: card.id,
    setId: card.set.id,
    localId: card.localId,
    name: card.name,
    category: card.category,
    illustrator: normalizeSentinel(card.illustrator),
    rarity: normalizeSentinel(card.rarity),
    regulationMark: normalizeSentinel(card.regulationMark),
    hp: null,
    stage: null,
    suffix: null,
    evolveFrom: null,
    typesJson: null,
    retreat: null,
    abilitiesJson: null,
    attacksJson: null,
    weaknessesJson: null,
    resistancesJson: null,
    trainerType: null,
    energyType: null,
    effect: null,
    legalStandard: card.legal?.standard ?? false,
    legalExpanded: card.legal?.expanded ?? false,
    printKey: null,
    legalStandardEffective: null,
    legalExpandedEffective: null,
    variantsJson: card.variants ?? null,
    imageUrl: assetBase(card.image),
    updated: card.updated ?? null,
  };
  switch (card.category) {
    case "Pokemon": {
      // A Pokémon tcgdex sends with neither field takes the supplement's
      // (./weakResSupplement.ts); either upstream field present means upstream wins.
      const supplement =
        card.weaknesses === undefined && card.resistances === undefined
          ? WEAK_RES_SUPPLEMENT[card.id]
          : undefined;
      return {
        ...base,
        hp: card.hp ?? null,
        stage: normalizeSentinel(card.stage),
        suffix: suffixOf(card.name, normalizeSentinel(card.suffix)),
        evolveFrom: normalizeSentinel(card.evolveFrom),
        typesJson: card.types ?? null,
        retreat: card.retreat ?? null,
        abilitiesJson: textBlocks(card.abilities),
        attacksJson: textBlocks(card.attacks),
        weaknessesJson: card.weaknesses ?? supplement?.weaknesses ?? null,
        resistancesJson: card.resistances ?? supplement?.resistances ?? null,
      };
    }
    case "Trainer":
      return {
        ...base,
        // The Pokémon face a Trainer prints, such as a fossil's HP or a Technical Machine's attack;
        // null when not printed.
        hp: card.hp ?? null,
        abilitiesJson: textBlocks(card.abilities),
        attacksJson: textBlocks(card.attacks),
        trainerType: normalizeSentinel(card.trainerType),
        effect: rulesText(card.effect),
      };
    case "Energy":
      return {
        ...base,
        energyType: energyTypeOf(card.energyType, card.effect),
        effect: rulesText(card.effect),
      };
  }
}

/** The rows the ingest refuses to call complete: a Standard-legal Pokémon with no
    Weakness that is not Dragon-type (Dragon is the one type printed without one).
    The ingest writes them anyway and exits non-zero naming them, so a new set
    whose tcgdex payload drops the field is seen the day it lands rather than in
    a match. */
export function weaklessLegalPokemon(rows: readonly CardRow[]): string[] {
  return rows
    .filter(
      (row) =>
        row.category === "Pokemon" &&
        row.legalStandard &&
        (row.weaknessesJson === null || row.weaknessesJson.length === 0) &&
        !(row.typesJson ?? []).includes("Dragon"),
    )
    .map((row) => row.id);
}

/** tcgdex spells some sets' Pokémon ex suffix "EX"; the name's own " ex" decides, so a
    Pokémon-EX keeps "EX". */
export function suffixOf(name: string, suffix: string | null): string | null {
  return suffix === "EX" && name.endsWith(" ex") ? "ex" : suffix;
}

/** A Trainer's or Energy's rules text, normalised; null when not printed. */
function rulesText(effect: string | undefined): string | null {
  return effect === undefined ? null : normalizeCardText(effect);
}

/** Printed attacks or Abilities with each `effect` normalised; null when not printed. */
function textBlocks<T extends { effect?: string }>(blocks: T[] | undefined): T[] | null {
  if (blocks === undefined) return null;
  return blocks.map((block) =>
    block.effect === undefined ? block : { ...block, effect: normalizeCardText(block.effect) },
  );
}

/**
 * tcgdex tags some Special Energies "Normal", so a "Normal" Energy the engine reads as Special is
 * stored as "Special".
 */
export function energyTypeOf(
  energyType: string | undefined,
  effect: string | undefined,
): string | null {
  const tag = normalizeSentinel(energyType);
  return tag === "Normal" && isSpecialEnergy({ category: "Energy", energyType: tag, effect })
    ? "Special"
    : tag;
}
