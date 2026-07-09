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
