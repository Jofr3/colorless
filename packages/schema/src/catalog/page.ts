// The list envelope every paginated catalog endpoint serves.

import { z } from "zod";

/**
 * Builds the `{ items, page, pageSize, total }` envelope schema for an item
 * schema — e.g. `paginatedSchema(cardBriefSchema)` for GET /cards. `page` is
 * 1-based; `total` counts every row matching the filters, not just this page.
 */
export function paginatedSchema<Item extends z.ZodType>(itemSchema: Item) {
  return z.object({
    items: z.array(itemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  });
}

/** The inferred envelope shape, generic over the item type. */
export type Paginated<Item> = {
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
};
