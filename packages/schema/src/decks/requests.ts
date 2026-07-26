// Deck & folder request bodies (backend-data.md §6) — parsed by the api's
// zValidator at the boundary and reusable by the web app's forms.
//
// Nullable-vs-absent matters on the PATCH shapes: an ABSENT field means
// "leave it alone", an explicit `null` means "clear it" (move a deck/folder
// to the library root, unset a deck's format). Empty patches are rejected so
// a buggy no-op call fails loudly instead of silently bumping `updated`.

import { z } from "zod";
import { deckCardSchema } from "./deck";

/** Hard cap on DISTINCT card entries per deck — a 60-card deck uses ~20;
    200 leaves room for oversized casual lists while bounding request size. */
export const MAX_DECK_CARD_ENTRIES = 200;

const nameField = z.string().trim().min(1).max(100);
const tintField = z.number().int().min(0).max(360);
const formatField = z.string().trim().min(1).max(32);

/** A deck's card list: capped, and each catalog card appears at most once —
    copies are expressed through `count`, never by repeating the entry. */
const deckCardsField = z
  .array(deckCardSchema)
  .max(MAX_DECK_CARD_ENTRIES)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const { cardId } of entries) {
      (seen.has(cardId) ? duplicates : seen).add(cardId);
    }
    if (duplicates.size > 0) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate cardId(s): ${[...duplicates].join(", ")}`,
      });
    }
  });

/** Requires at least one field — the schema-level "empty patch" guard. */
function nonEmptyPatch<Shape extends z.ZodRawShape>(shape: Shape) {
  return z
    .object(shape)
    .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
      message: "empty patch: provide at least one field",
    });
}

export const createDeckRequestSchema = z.object({
  name: nameField,
  tint: tintField,
  format: formatField.nullish(),
  /** Must be a folder the caller owns; absent/null = the library root. */
  folderId: z.string().nullish(),
  cards: deckCardsField.default([]),
});
export type CreateDeckRequest = z.infer<typeof createDeckRequestSchema>;

export const patchDeckRequestSchema = nonEmptyPatch({
  name: nameField.optional(),
  tint: tintField.optional(),
  format: formatField.nullable().optional(),
  folderId: z.string().nullable().optional(),
  /** When present, REPLACES the whole card list (no per-entry merging). */
  cards: deckCardsField.optional(),
  /** The owner's cover pick (P5-6): a card id to pin, `null` for automatic.
      Must be a card in the deck AFTER this patch applies — sending one that
      isn't is a 400, since the request contradicts itself. */
  chosenCoverCardId: z.string().min(1).nullable().optional(),
});
export type PatchDeckRequest = z.infer<typeof patchDeckRequestSchema>;

export const createFolderRequestSchema = z.object({
  name: nameField,
  /** Must be a folder the caller owns; absent/null = the library root. */
  parentId: z.string().nullish(),
});
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>;

export const patchFolderRequestSchema = nonEmptyPatch({
  name: nameField.optional(),
  parentId: z.string().nullable().optional(),
});
export type PatchFolderRequest = z.infer<typeof patchFolderRequestSchema>;

/** Cap on one reorder's row count — a manual drag permutes at most the rows
    of one view, so this is generous while bounding request size. */
export const MAX_REORDER_POSITIONS = 500;

/** POST /decks/reorder + /folders/reorder: absolute `position` assignments,
    applied atomically. Each id at most once; ids must all be the caller's
    (unknown/foreign ids → 400 naming them). */
export const reorderRequestSchema = z.object({
  positions: z
    .array(z.object({ id: z.string().min(1), position: z.number().int() }))
    .min(1)
    .max(MAX_REORDER_POSITIONS)
    .superRefine((entries, ctx) => {
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const { id } of entries) {
        (seen.has(id) ? duplicates : seen).add(id);
      }
      if (duplicates.size > 0) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate id(s): ${[...duplicates].join(", ")}`,
        });
      }
    }),
});
export type ReorderRequest = z.infer<typeof reorderRequestSchema>;
