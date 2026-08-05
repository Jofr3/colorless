// User-data tables (read-write): accounts, auth and deck persistence.
// Spec: docs/workstreams/backend-data.md §5.3 (schema) + §3.5 (auth model).
//
// Timestamps here are INTEGER epoch milliseconds (`mode: "timestamp_ms"`,
// surfaced as Date by drizzle) — unlike the catalog, these are OUR clocks, so
// nothing forces ISO text on us, and integers give unambiguous SQL comparison
// (`expires_at < ?now` for session sweeps) with no string-format drift.
// `created_at`-style columns default to `unixepoch() * 1000` in the DB so a
// forgotten insert value can never produce a row without a timestamp.

import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { cards } from "./catalog";

/** DB-side default for epoch-ms timestamp columns. */
const nowMs = sql`(unixepoch() * 1000)`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  /** Null for OAuth-only accounts (§3.5: password and OAuth can coexist). */
  passwordHash: text("password_hash"),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  /** The account's chosen favourite deck (P5-7), or null. References `decks`
      below via a thunk (forward reference) so file order stays users→decks; the
      `AnySQLiteColumn` return type breaks the type cycle the mutual reference
      would otherwise create (users↔decks). ON DELETE SET NULL means deleting the
      deck clears the favourite instead of blocking the delete (a RESTRICT FK) or
      dangling a stale id — and D1 enforces FKs here (the deck DELETE leans on
      deck_cards' cascade). NB: drizzle-kit omits the referential action on an
      ADD COLUMN, so migration 0005 restores `ON DELETE SET NULL` by hand. */
  favouriteDeckId: text("favourite_deck_id").references((): AnySQLiteColumn => decks.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const oauthIdentities = sqliteTable(
  "oauth_identities",
  {
    /** "discord" | "google" (§ D2a); text so adding a provider is data-only. */
    provider: text("provider").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerId] }),
    index("oauth_identities_user_id_idx").on(t.userId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Owning folder; null at the library root. Folders nest indefinitely. */
    parentId: text("parent_id"),
    name: text("name").notNull(),
    /** Manual sort slot, global per user (see @luminous/schema Folder.position).
        Lists order by it ascending; creates take min-1 so new rows prepend. */
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("folders_user_id_idx").on(t.userId),
    // Self-reference declared here (not via .references()) to avoid the
    // "column referenced in its own initializer" TS error. Deleting a folder
    // deletes its subtree; decks inside fall back to the root via SET NULL.
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "folders_parent_id_fk",
    }).onDelete("cascade"),
  ],
);

export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /** Play format ("standard" | "expanded" | …); free text until §5.2 lands. */
    format: text("format"),
    /** Base hue 0–360 for the deck cover gradient (web `Deck.tint`). */
    tint: integer("tint").notNull(),
    /** The owner's CHOSEN cover card (P5-6), or null for the derived default
        (`pickCoverCardId`). References the catalog like `deck_cards` does, so
        ingest can't orphan it; the read side falls back to the default anyway
        if the card has left the deck. */
    coverCardId: text("cover_card_id").references(() => cards.id),
    /** Manual sort slot, global per user (see @luminous/schema Deck.position). */
    position: integer("position").notNull().default(0),
    updated: integer("updated", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (t) => [index("decks_user_id_idx").on(t.userId), index("decks_folder_id_idx").on(t.folderId)],
);

export const deckCards = sqliteTable(
  "deck_cards",
  {
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    /** References the catalog; RESTRICT-by-default so ingest can't orphan decks. */
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deckId, t.cardId] })],
);
