// User-data tables. Timestamps are integer epoch milliseconds, and `created_at` columns default in
// the database so a row can never lack one.

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

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    /** Null for OAuth-only accounts (§3.5: password and OAuth can coexist). */
    passwordHash: text("password_hash"),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    /**
     * Ask this account, once, to choose its public name: its name may be the
     * email's local part or the Google account's real name, from before new accounts got a
     * generated handle. Cleared when the user saves a name or keeps the current one
     * (PATCH /auth/me). The default is true, so a row written by any path that does not say
     * otherwise (the Worker deployed before this column, a hand-written insert) is asked rather
     * than missed; register and OAuth sign-up write false. Migration 0012 cleared it for the
     * existing accounts whose name came neither from their email nor from Google.
     */
    namePrompt: integer("name_prompt", { mode: "boolean" }).notNull().default(true),
    /**
     * The account's favourite deck, or null. The thunk and `AnySQLiteColumn` type break the
     * users/decks reference cycle. drizzle-kit omits the referential action on ADD COLUMN, so the
     * migration restores `ON DELETE SET NULL` by hand.
     */
    favouriteDeckId: text("favourite_deck_id").references((): AnySQLiteColumn => decks.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  // Deleting a deck sets its favourite references to null, which scans users without this index.
  (t) => [index("users_favourite_deck_id_idx").on(t.favouriteDeckId)],
);

export const oauthIdentities = sqliteTable(
  "oauth_identities",
  {
    /** "google" (§ D2a); legacy identities remain stored when a provider is removed. */
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
    /** Manual sort slot, global per user. No route writes this table. */
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
    /** Play format ("standard" | "expanded" | …): free text, null when none is picked. */
    format: text("format"),
    /** Base hue 0–360 for the deck cover gradient (web `Deck.tint`). */
    tint: integer("tint").notNull(),
    /** The owner's CHOSEN cover card, or null for the derived default
        (`pickCoverCardId`). References the catalog like `deck_cards` does, so
        ingest can't orphan it; the read side falls back to the default anyway
        if the card has left the deck. */
    coverCardId: text("cover_card_id").references(() => cards.id),
    /** Manual sort slot, global per user (see @colorless/schema Deck.position). */
    position: integer("position").notNull().default(0),
    updated: integer("updated", { mode: "timestamp_ms" }).notNull().default(nowMs),
    /** Bumped by every write, so a save from a stale copy is refused instead of undoing the
        newer one (PATCH /decks/:id). */
    version: integer("version").notNull().default(0),
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

/**
 * Sign-in attempt counters (auth/rateLimit.ts): one row per limited key, counted by a single
 * atomic upsert. `key` is a hash, never the IP or email itself. Rows past `reset_at` are dead and
 * the daily sweep deletes them.
 */
export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: integer("reset_at").notNull(),
});
