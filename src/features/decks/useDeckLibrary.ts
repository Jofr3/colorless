// The one owner of "load my deck library from the api" — shared by the
// decks page and the online deck picker, which used to hand-roll the same
// effect (parallel GET /decks + GET /folders, phase tracking, a Retry
// nonce). Session expiry needs no handling here: the api client's session
// recovery re-probes on an unexpected 401 and, when the session is really
// gone, AuthProvider flips the app to signed-out — the caller's sign-in
// prompt takes over from `phase` entirely.

import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import { listDecks, listFolders } from "../../lib/api";
import { type Deck, type Folder, fromDeckSummary } from "./data";

export interface DeckLibrary {
  decks: Deck[];
  folders: Folder[];
  /** Exposed for the page's optimistic mutations. */
  setDecks: Dispatch<SetStateAction<Deck[]>>;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  /** "loading" until both lists land; a failure of either is "error" rather
      than a half-loaded grid. */
  phase: "loading" | "error" | "ready";
  /** Re-run the load (the error panel's Retry). */
  retry: () => void;
  /** Refetch both lists in place — honest recovery after a partially-applied
      compound mutation. Rejects on failure so the caller owns the surface. */
  resync: () => Promise<void>;
}

/** Load the library while `enabled` (typically "the session is resolved and
    authenticated"; the picker also gates on its dialog being open). Each
    false→true transition refetches, so a reopened picker sees fresh lists. */
export function useDeckLibrary(enabled: boolean): DeckLibrary {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  // Bumped by retry() to re-run the load effect.
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    // loadNonce has no value of its own — reading it here is what lets
    // retry() re-run this effect.
    void loadNonce;
    if (!enabled) return;
    let cancelled = false;
    setPhase("loading");
    Promise.all([listDecks(), listFolders()]).then(
      ([deckRows, folderRows]) => {
        if (cancelled) return;
        setDecks(deckRows.map(fromDeckSummary));
        setFolders(folderRows);
        setPhase("ready");
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, loadNonce]);

  const retry = useCallback(() => setLoadNonce((nonce) => nonce + 1), []);

  const resync = useCallback(async () => {
    const [deckRows, folderRows] = await Promise.all([listDecks(), listFolders()]);
    setDecks(deckRows.map(fromDeckSummary));
    setFolders(folderRows);
  }, []);

  return { decks, folders, setDecks, setFolders, phase, retry, resync };
}
