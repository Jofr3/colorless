// Catalog tables, ingested from tcgdex and read-only to the app. Ids are tcgdex ids. `*_url`
// columns store tcgdex origin base URLs without extension, not R2 URLs. Dates stay ISO text as
// tcgdex sends them.

import type { TcgdexAbility, TcgdexAttack, TcgdexVariants, TcgdexWeakRes } from "@colorless/schema";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const series = sqliteTable("series", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** "YYYY-MM-DD"; optional upstream (used to order series chronologically). */
  releaseDate: text("release_date"),
  /** tcgdex origin logo base URL, extensionless (§4.4: append `.png`/`.webp`). */
  logoUrl: text("logo_url"),
});

export const sets = sqliteTable(
  "sets",
  {
    id: text("id").primaryKey(),
    serieId: text("serie_id")
      .notNull()
      .references(() => series.id),
    name: text("name").notNull(),
    /** tcgdex origin logo/symbol base URLs, extensionless (§4.4: append `.png`/`.webp`). */
    logoUrl: text("logo_url"),
    symbolUrl: text("symbol_url"),
    /** "YYYY-MM-DD", required upstream. */
    releaseDate: text("release_date").notNull(),
    countTotal: integer("count_total").notNull(),
    countOfficial: integer("count_official").notNull(),
    legalStandard: integer("legal_standard", { mode: "boolean" }).notNull(),
    legalExpanded: integer("legal_expanded", { mode: "boolean" }).notNull(),
    /** PTCGO set code (e.g. swsh3 → "DAA"); only PTCGO-era sets have one. */
    tcgOnline: text("tcg_online"),
    /** The official set abbreviation printed on decklists (tcgdex
        `abbreviation.official`, e.g. sv08.5 → "PRE"); null when tcgdex has none. */
    abbreviation: text("abbreviation"),
  },
  (t) => [index("sets_serie_id_idx").on(t.serieId)],
);

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    setId: text("set_id")
      .notNull()
      .references(() => sets.id),
    localId: text("local_id").notNull(),
    name: text("name").notNull(),
    category: text("category", { enum: ["Pokemon", "Trainer", "Energy"] }).notNull(),
    illustrator: text("illustrator"),
    rarity: text("rarity"),
    regulationMark: text("regulation_mark"),

    // Pokémon-only fields, except `hp`, `abilities_json` and `attacks_json`, which a Trainer row
    // keeps when it prints them.
    hp: integer("hp"),
    stage: text("stage"),
    /**
     * tcgdex's print-kind marker on a Pokémon's name line, such as "ex", "V", "VMAX" or "MEGA";
     * absent on ordinary Pokémon. /facets selects this column, so its migration must be applied
     * before deploying.
     */
    suffix: text("suffix"),
    evolveFrom: text("evolve_from"),
    /** Energy types, e.g. ["Grass"]. */
    typesJson: text("types_json", { mode: "json" }).$type<string[]>(),
    retreat: integer("retreat"),
    abilitiesJson: text("abilities_json", { mode: "json" }).$type<TcgdexAbility[]>(),
    attacksJson: text("attacks_json", { mode: "json" }).$type<TcgdexAttack[]>(),
    weaknessesJson: text("weaknesses_json", { mode: "json" }).$type<TcgdexWeakRes[]>(),
    resistancesJson: text("resistances_json", { mode: "json" }).$type<TcgdexWeakRes[]>(),

    // Trainer/Energy-only fields.
    trainerType: text("trainer_type"),
    energyType: text("energy_type"),
    /** Trainer/Energy rules text (absent on basic energies). */
    effect: text("effect"),

    // `legal` is optional upstream; ingest maps a missing block to false/false.
    legalStandard: integer("legal_standard", { mode: "boolean" }).notNull(),
    legalExpanded: integer("legal_expanded", { mode: "boolean" }).notNull(),
    /** The reprint rule (Play! Pokémon: a print is legal wherever a print with
        the same name and text is legal). `print_key` is the card's functional
        identity (../ingest/map.ts `printKey`: name plus everything the rules
        compare); the `*_effective` flags are this print's legality OR'd across
        every print sharing its key, written by the ingest post-pass
        (../ingest/upserts.ts `reprintLegalitySql`). Null on rows ingested
        before the pass; readers fall back to the per-print flags. */
    printKey: text("print_key"),
    legalStandardEffective: integer("legal_standard_effective", { mode: "boolean" }),
    legalExpandedEffective: integer("legal_expanded_effective", { mode: "boolean" }),
    /** The 5 print-run flags {normal, reverse, holo, firstEdition, wPromo}. */
    variantsJson: text("variants_json", { mode: "json" }).$type<TcgdexVariants>(),
    /** tcgdex origin image base URL, extensionless (§4.4: append `/high.webp` etc.). */
    imageUrl: text("image_url"),
    /** tcgdex `updated` ISO timestamp, verbatim. Nothing reads it, and ingest does not compare
        it: tcgdex re-stamps whole sets at once. */
    updated: text("updated"),
  },
  // Each /cards sort and the exact-name lookup read an index in its own order, so a page
  // reads its own rows rather than scanning and sorting the table. The expression indexes
  // match `lower("cards"."name")` and catalog/query.ts `pokemonHp()` as that file writes them.
  // Collector order is unique, so every sort's tail makes pages deterministic.
  (t) => [
    uniqueIndex("cards_set_local_idx").on(t.setId, t.localId),
    index("cards_name_set_local_idx").on(t.name, t.setId, t.localId),
    index("cards_name_lower_idx").on(sql`lower(${t.name})`, t.setId, t.localId),
    index("cards_print_key_idx").on(t.printKey),
    index("cards_pokemon_hp_idx").on(
      sql`(case when ${t.category} = 'Pokemon' then ${t.hp} end) desc`,
      t.setId,
      t.localId,
    ),
  ],
);
