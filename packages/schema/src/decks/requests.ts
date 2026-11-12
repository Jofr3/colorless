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

/** Decks one account can hold: bounds the unpaginated GET /decks and its deck_cards reads. */
export const MAX_DECKS_PER_USER = 500;

/** Deck names. */
export const DECK_NAME_MAX = 100;

/** Longest card id a write accepts. Catalog ids are a set id and a number ("swsh10.5-001", 12
    characters at most today); the cap leaves room for longer set ids without letting a request
    carry, or a 400 echo, an arbitrarily long string. */
export const CARD_ID_MAX = 40;

/** A card id as a write names it: the catalog's characters only. Read schemas stay loose, so a
    deck saved before this check always loads. */
export const cardIdSchema = z
  .string()
  .min(1)
  .max(CARD_ID_MAX)
  .regex(/^[A-Za-z0-9._-]+$/, "card ids use letters, digits, '.', '_' and '-'");

const nameField = z.string().trim().min(1).max(DECK_NAME_MAX);
const tintField = z.number().int().min(0).max(360);

/** The play formats a deck write may name: the engine's FORMATS ids, which an api test keeps
    equal to this list. The read schemas stay free text, so a deck saved before this check loads.
    The field takes any string as input, since the builder sends back the format it loaded. */
export const DECK_FORMAT_IDS = ["standard", "expanded"] as const;
const formatField = z.string().pipe(z.enum(DECK_FORMAT_IDS));

/** A deck's card list: capped, and each catalog card appears at most once —
    copies are expressed through `count`, never by repeating the entry. */
const deckCardsField = z
  .array(deckCardSchema.extend({ cardId: cardIdSchema }))
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

/** Requires at least one field other than `version`, which is a precondition rather than a change
    — the schema-level "empty patch" guard. */
function nonEmptyPatch<Shape extends z.ZodRawShape>(shape: Shape) {
  return z
    .object(shape)
    .refine(
      (patch) =>
        Object.entries(patch).some(([key, value]) => key !== "version" && value !== undefined),
      { error: "empty patch: provide at least one field" },
    );
}

export const createDeckRequestSchema = z.object({
  name: nameField,
  tint: tintField,
  format: formatField.nullish(),
  /** Only the library root: there is no route that makes a folder to put a deck in. */
  folderId: z.null().optional(),
  cards: deckCardsField.default([]),
});
/** What a client may send. */
export type CreateDeckRequest = z.input<typeof createDeckRequestSchema>;

export const patchDeckRequestSchema = nonEmptyPatch({
  name: nameField.optional(),
  tint: tintField.optional(),
  format: formatField.nullable().optional(),
  /** `null` moves a deck out of a folder it was filed in to the library root. */
  folderId: z.null().optional(),
  /** When present, REPLACES the whole card list (no per-entry merging). */
  cards: deckCardsField.optional(),
  /** The owner's cover pick: a card id to pin, `null` for automatic.
      Must be a card in the deck AFTER this patch applies — sending one that
      isn't is a 400, since the request contradicts itself. */
  chosenCoverCardId: cardIdSchema.nullable().optional(),
  /** The deck version this patch was made from. When present the patch applies only while the
      deck is still at it, and answers 409 with the current deck otherwise. Absent, the patch is
      last-writer-wins, as for the library's rename. */
  version: z.number().int().min(0).optional(),
});
export type PatchDeckRequest = z.input<typeof patchDeckRequestSchema>;
