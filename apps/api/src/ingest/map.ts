// tcgdex → catalog-row mapping (P1 milestone 4, §3.4).
//
// Row types derive from the Drizzle insert types (src/db/catalog.ts) with
// optionality stripped: mapping always emits EVERY column, explicit `null`
// included, so the multi-row upserts in ./upserts.ts stay rectangular and a
// rerun overwrites stale values instead of leaving them behind.
//
// Rules (docs/workstreams/backend-data.md §5.3 + the M3 session notes):
// - missing upstream `legal` → false/false;
// - "no value" SENTINELS (the literal string "None", "") normalise to NULL on
//   the nullable VOCABULARY columns — ../sentinel.ts documents the sweep.
//   Upstream is inconsistent about absence and `?? null` alone doesn't catch
//   a string; prose (`effect`) and required columns are deliberately left
//   alone. This is the SOURCE fix: it stops the sentinel entering the
//   catalog, but does NOT repair rows already written — that needs a
//   re-ingest (docs/workstreams/backend-data.md §5.3);
// - Pokémon-only fields are NULL on Trainer/Energy (and vice versa) — EXCEPT
//   the printed Pokémon face a Trainer can carry (D581): `hp`, `abilities` and
//   `attacks` are kept on a Trainer row when tcgdex prints them (the Antique
//   Fossils' 60 HP and Ability, a Technical Machine's attack). Before D581 the
//   Trainer branch dropped them and the engine hand-wrote the faces;
// - `*_url` columns keep the tcgdex ORIGIN base URLs (extensionless, §4.4);
// - `*Json` fields stay raw objects here — ./sql.ts JSON.stringifies them
//   into the SQL text (these rows never pass through Drizzle's json mode);
// - 🆕 D612 — every printed TEXT (an attack's or Ability's `effect`, a Trainer's or
//   Energy's `effect`) is written through the engine's `normalizeCardText`: tcgdex's
//   `<em>` / energy-symbol `<span>` HTML, "[R]" tokens and type words ("Basic Fire
//   Energy", "ColorlessColorless") become the `sv` spelling ({R}, {C}{C}). The
//   engine reads a persisted raw face through the same function (cards.ts
//   `cardOfUid`), so a row ingested before D612 still plays right.

import { normalizeCardText } from "@colorless/engine";
import type { TcgdexCard, TcgdexSerie, TcgdexSet } from "@colorless/schema";
import type { cards, series, sets } from "../db/schema";
import { normalizeSentinel } from "../sentinel";
import { WEAK_RES_SUPPLEMENT } from "./weakResSupplement";

export type SeriesRow = Required<typeof series.$inferInsert>;
export type SetRow = Required<typeof sets.$inferInsert>;
export type CardRow = Required<typeof cards.$inferInsert>;

export function mapSerie(serie: TcgdexSerie): SeriesRow {
  return {
    id: serie.id,
    name: serie.name,
    releaseDate: serie.releaseDate ?? null,
    logoUrl: serie.logo ?? null,
  };
}

export function mapSet(set: TcgdexSet): SetRow {
  return {
    id: set.id,
    serieId: set.serie.id,
    name: set.name,
    logoUrl: set.logo ?? null,
    symbolUrl: set.symbol ?? null,
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
    imageUrl: card.image ?? null,
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
        // Sentinel-normalised like the other nullable VOCABULARY columns:
        // `suffix` is a small closed set ("ex"/"V"/"VMAX"/"MEGA"/…) destined
        // for a facet list, so a literal "None" would become a dead chip
        // exactly as it did for rarity/regulation_mark (D194).
        suffix: normalizeSentinel(card.suffix),
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
        // 🆕 D581 — the printed Pokémon face (header): null when not printed,
        // exactly as on the Pokémon branch.
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
    a match (card revision B39). */
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

/** 🆕 D612 — a Trainer's / Energy's rules text, normalised (null when not printed). */
function rulesText(effect: string | undefined): string | null {
  return effect === undefined ? null : normalizeCardText(effect);
}

/** 🆕 D612 — the printed attacks / Abilities with each `effect` normalised (null when not
    printed). A block without an `effect` is kept as tcgdex sent it. */
function textBlocks<T extends { effect?: string }>(blocks: T[] | undefined): T[] | null {
  if (blocks === undefined) return null;
  return blocks.map((block) =>
    block.effect === undefined ? block : { ...block, effect: normalizeCardText(block.effect) },
  );
}

/** 🆕🆕🆕 D583 — the Energy subtype the row stores. tcgdex tags `energyType: "Normal"` on 14
    Standard-legal Special Energies (every `me` one, and `sv` Reversal / Prism / Ignition — LOCAL
    D1, 2026-10-07), so a "Normal" Energy that PRINTS RULES TEXT is written "Special": a Basic
    Energy card prints none. The engine reads the same rule off the face (cards.ts
    `isSpecialEnergy`), so a row ingested before this fix still plays right. */
export function energyTypeOf(energyType: string | undefined, effect: string | undefined): string | null {
  const tag = normalizeSentinel(energyType);
  return tag === "Normal" && (effect ?? "").trim() !== "" ? "Special" : tag;
}
