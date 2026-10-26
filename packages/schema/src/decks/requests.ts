// Deck request bodies, parsed by the api's validator at the boundary.
//
// Nullable-vs-absent matters on the PATCH shape: an absent field means "leave it alone", an
// explicit `null` means "clear it" (move a deck to the library root, unset its format). Empty
// patches are rejected so a buggy no-op call fails loudly instead of silently bumping `updated`.

import * as z from "zod";
import { deckCardSchema } from "./deck";

/** Hard cap on DISTINCT card entries per deck — a 60-card deck uses ~20;
    200 leaves room for oversized casual lists while bounding request size. */
export const MAX_DECK_CARD_ENTRIES = 200;

/** Deck names. */
export const DECK_NAME_MAX = 100;

const nameField = z.string().trim().min(1).max(DECK_NAME_MAX);
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
  /** Only the library root: there is no route that makes a folder to put a deck in. */
  folderId: z.null().optional(),
  cards: deckCardsField.default([]),
});
export type CreateDeckRequest = z.infer<typeof createDeckRequestSchema>;

export const patchDeckRequestSchema = nonEmptyPatch({
  name: nameField.optional(),
  tint: tintField.optional(),
  format: formatField.nullable().optional(),
  /** `null` moves a deck out of a folder it was filed in to the library root. */
  folderId: z.null().optional(),
  /** When present, REPLACES the whole card list (no per-entry merging). */
  cards: deckCardsField.optional(),
  /** The owner's cover pick (P5-6): a card id to pin, `null` for automatic.
      Must be a card in the deck AFTER this patch applies — sending one that
      isn't is a 400, since the request contradicts itself. */
  chosenCoverCardId: z.string().min(1).nullable().optional(),
});
export type PatchDeckRequest = z.infer<typeof patchDeckRequestSchema>;
