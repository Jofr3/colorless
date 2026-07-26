// The decks page's client-side shapes plus the mapping from the api's wire
// types (M9 — the page loads the library from GET /decks + GET /folders
// instead of seed fixtures). The web `Deck` keeps its original vocabulary;
// `cardCount` is now the server-derived summed copy count, no longer a seed
// stand-in. Imports from @luminous/schema are types-only so the web bundle
// stays zod-free.

import type { Deck as ApiDeck, DeckSummary } from "@luminous/schema";
import { deleteFolder, patchDeck, patchFolder } from "../../lib/api";

export type Deck = {
  id: string;
  name: string;
  /** Owning folder, or null when the deck lives at the library root. */
  folderId: string | null;
  /** Summed copies across the deck's card list (server-derived). */
  cardCount: number;
  /** Base hue (0–360) for the deck's cover gradient, so the grid reads colourful.
      Still the backdrop behind a cover, and the whole cover when there is none. */
  tint: number;
  /** The card whose art fronts this deck (P5-3), or null for a deck with nothing
      to show yet — server-derived, so it follows the deck's contents. */
  coverCardId: string | null;
  /** Manual sort slot (server-persisted, global per user). The library array
      stays sorted by it — array order IS the manual order — so a reorder
      rewrites both together (see reorder.ts applyReorder). */
  position: number;
};

export type Folder = {
  id: string;
  name: string;
  /** Owning folder, or null when the folder lives at the library root. Folders
      nest indefinitely by pointing at a parent folder. */
  parentId: string | null;
  /** Manual sort slot — same semantics as `Deck.position`. */
  position: number;
};

/** A GET /decks list row as the grid renders it. */
export function fromDeckSummary(row: DeckSummary): Deck {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folderId,
    cardCount: row.cardCount,
    tint: row.tint,
    coverCardId: row.coverCardId,
    position: row.position,
  };
}

/** A full deck resource (create/patch responses) as the grid renders it —
    `cardCount` derived by summing the card list, matching the server's own
    summary maths. */
export function fromDeck(resource: ApiDeck): Deck {
  return {
    id: resource.id,
    name: resource.name,
    folderId: resource.folderId,
    cardCount: resource.cards.reduce((sum, card) => sum + card.count, 0),
    tint: resource.tint,
    // Only ever a just-CREATED deck here (the sole call site), which has no cards
    // and so no cover — the card back is the right face for it.
    coverCardId: null,
    position: resource.position,
  };
}

// The server `Folder` wire shape ({id, name, parentId}) is exactly the web
// shape, so folders need no mapper — the api rows are used as-is.

/** Delete a folder with the decks page's lift-up policy: its direct decks
    and subfolders move up to `parentId` first (rather than following the
    server's cascade, which would delete subfolders and drop decks to the
    root), so by the time DELETE runs the folder is empty and the cascade is
    a no-op. The child PATCHes fire in parallel — a partial failure leaves an
    arbitrary subset applied, which is fine because the caller resyncs the
    library from the server on ANY rejection here. */
export async function deleteFolderLiftingChildren(args: {
  folderId: string;
  /** The deleted folder's own parent — where the children land. */
  parentId: string | null;
  childFolderIds: string[];
  childDeckIds: string[];
}): Promise<void> {
  const { folderId, parentId, childFolderIds, childDeckIds } = args;
  await Promise.all([
    ...childFolderIds.map((id) => patchFolder(id, { parentId })),
    ...childDeckIds.map((id) => patchDeck(id, { folderId: parentId })),
  ]);
  await deleteFolder(folderId);
}
