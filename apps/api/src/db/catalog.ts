// Catalog tables — ingested from tcgdex (§3.4), read-only to the app.
// Spec: docs/workstreams/backend-data.md §5.3. Source shapes: the Zod models
// in @luminous/schema (packages/schema/src/tcgdex/*), authored against live
// payloads — every column here maps 1:1 onto a field of those schemas.
//
// Conventions:
// - ids are tcgdex ids, stored as text PKs ("sv" / "sv01" / "sv01-001").
// - `*_url` asset columns store the tcgdex ORIGIN base URLs, extensionless
//   (§4.4) — NOT R2 URLs. Images are mirrored into R2 lazily by the
//   `/assets/*` Worker routes (cache-aside), which use these bases on a miss.
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
// - dp/neo-era Pokémon extras (`level`, `item`, `description`, `dexId`) — no
//   app feature reads them; the schema stays full-history *capable* (nothing
//   breaks when old sets are ingested, these fields are simply not persisted).
//   `suffix` used to sit in this list and left it in D197 — see the column.

import type { TcgdexAbility, TcgdexAttack, TcgdexVariants, TcgdexWeakRes } from "@luminous/schema";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    /** tcgdex's PRINT-KIND marker on a Pokémon's name line — "ex", "V",
        "VMAX", "MEGA", … (absent on ordinary Pokémon). The web currently
        re-derives this by reading the card NAME (src/features/builder/
        cards.ts), which is why an EX/Mega selection cannot be a server param
        and mixed selections page badly: the API pages a set the client then
        thins, so a 60-card page can render nearly empty while `total` claims
        hundreds. Added in D197 so the next ingest populates it. **STILL NULL ON
        EVERY PRODUCTION ROW** (re-verified 2026-08-04) — and stronger than that:
        migration `0006`, which ADDS the column, has never been applied to the
        remote database, so production has no `suffix` column at all. D198 then
        shipped `?suffix=` and the `/facets` `suffixes` vocabulary over it, which
        is why the deploy ORDER now matters — `/facets` selects this column inside
        its shared `db.batch`, so deploying ahead of the migration fails the whole
        endpoint. Runbook: docs/workstreams/backend-data.md §3.7. (D197's "nothing
        filters on it yet, on purpose" was true for exactly one slice; D198 made
        it false and D203 corrected it.) */
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
    /** The 5 print-run flags {normal, reverse, holo, firstEdition, wPromo}. */
    variantsJson: text("variants_json", { mode: "json" }).$type<TcgdexVariants>(),
    /** tcgdex origin image base URL, extensionless (§4.4: append `/high.webp` etc.). */
    imageUrl: text("image_url"),
    /** tcgdex `updated` ISO timestamp, verbatim — ingest skips unchanged rows. */
    updated: text("updated"),
  },
  (t) => [index("cards_set_id_idx").on(t.setId), index("cards_name_idx").on(t.name)],
);
