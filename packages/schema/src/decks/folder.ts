// The deck-library Folder (P1 milestone 7 — backend-data.md §5.2/§6): the
// server-persisted twin of the web app's existing `Folder` vocabulary
// (src/features/decks/data.ts). Folders come back as a FLAT list — nesting is
// expressed only through `parentId`, and the client builds the tree.

import { z } from "zod";

export const folderSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Owning folder, or null when the folder lives at the library root.
      Folders nest indefinitely by pointing at a parent folder. */
  parentId: z.string().nullable(),
  /** Manual sort slot within the library — same semantics as `Deck.position`
      (global per user, ascending, new folders take min-1). */
  position: z.number().int(),
});
export type Folder = z.infer<typeof folderSchema>;
