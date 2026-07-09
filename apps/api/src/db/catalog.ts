// Catalog tables — ingested from tcgdex (§3.4), read-only to the app.
// Spec: docs/workstreams/backend-data.md §5.3. Source shapes: the Zod models
// in @luminous/schema (packages/schema/src/tcgdex/*), authored against live
// payloads — every column here maps 1:1 onto a field of those schemas.
//
// Conventions:
// - ids are tcgdex ids, stored as text PKs ("sv" / "sv01" / "sv01-001").
// - Catalog dates/timestamps stay ISO TEXT, verbatim from tcgdex ("YYYY-MM-DD"
//   dates; `cards.updated` mixes `Z` and `+HH:MM` offsets). User-data tables
//   use integer epoch ms instead — see ./users.ts.
// - Structured sub-shapes persist as JSON text (`mode: "json"`), typed with
//   the tcgdex types so ingest round-trips without hand mapping.
//
// Deliberately NOT stored (revisit when a feature needs them):
// - `variants_detailed` — per-physical-print foil/stamp/per-print pricing;
//   irrelevant to the app today (we keep the 5-flag `variants_json`).
// - `pricing` — volatile market aggregates, not catalog data.
// - `boosters` — documented upstream, never observed on live `en` payloads.
// - dp/neo-era Pokémon extras (`level`, `item`, `suffix`, `description`,
//   `dexId`) — no app feature reads them; the schema stays full-history
//   *capable* (nothing breaks when old sets are ingested, these fields are
//   simply not persisted).

import type { TcgdexAbility, TcgdexAttack, TcgdexVariants, TcgdexWeakRes } from "@luminous/schema";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const series = sqliteTable("series", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** "YYYY-MM-DD"; optional upstream (used to order series chronologically). */
  releaseDate: text("release_date"),
  logoR2Url: text("logo_r2_url"),
});

export const sets = sqliteTable(
  "sets",
  {
    id: text("id").primaryKey(),
    serieId: text("serie_id")
      .notNull()
      .references(() => series.id),
    name: text("name").notNull(),
    logoR2Url: text("logo_r2_url"),
    symbolR2Url: text("symbol_r2_url"),
    /** "YYYY-MM-DD", required upstream. */
    releaseDate: text("release_date").notNull(),
    countTotal: integer("count_total").notNull(),
    countOfficial: integer("count_official").notNull(),
    legalStandard: integer("legal_standard", { mode: "boolean" }).notNull(),
    legalExpanded: integer("legal_expanded", { mode: "boolean" }).notNull(),
    /** PTCGO set code (e.g. swsh3 → "DAA"); only PTCGO-era sets have one. */
    tcgOnline: text("tcg_online"),
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

    // Pokémon-only fields (null on Trainer/Energy).
    hp: integer("hp"),
    stage: text("stage"),
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
    /** The 5 print-run flags {normal, reverse, holo, firstEdition, wPromo}. */
    variantsJson: text("variants_json", { mode: "json" }).$type<TcgdexVariants>(),
    imageR2Url: text("image_r2_url"),
    /** tcgdex `updated` ISO timestamp, verbatim — ingest skips unchanged rows. */
    updated: text("updated"),
  },
  (t) => [index("cards_set_id_idx").on(t.setId), index("cards_name_idx").on(t.name)],
);
