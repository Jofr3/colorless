/** The page events that put unsaved deck edits at risk: the tab hidden (a mobile browser may
 * discard it later without another event), the page closing, and the network returning after a
 * save failed. */

export interface UnsavedEdits {
  hasUnsavedEdits(): boolean;
  /** Send the pending edits now, in a request that outlives the page. */
  persistNow(): void;
  /** Send edits whose save failed again. */
  retrySave(): void;
}

/** What `guardUnsavedEdits` listens on: the window, and the document whose visibility it reads. */
export interface PageTargets {
  window: EventTarget;
  document: EventTarget & { readonly visibilityState: string };
}

/** Listens for the page events that risk `edits`; returns the function that stops listening. */
export function guardUnsavedEdits(page: PageTargets, edits: UnsavedEdits): () => void {
  const hidden = () => {
    if (page.document.visibilityState === "hidden") edits.persistNow();
  };
  const closing = (event: Event) => {
    if (!edits.hasUnsavedEdits()) return;
    edits.persistNow();
    event.preventDefault();
  };
  const gone = () => edits.persistNow();
  const online = () => edits.retrySave();
  page.document.addEventListener("visibilitychange", hidden);
  page.window.addEventListener("beforeunload", closing);
  page.window.addEventListener("pagehide", gone);
  page.window.addEventListener("online", online);
  return () => {
    page.document.removeEventListener("visibilitychange", hidden);
    page.window.removeEventListener("beforeunload", closing);
    page.window.removeEventListener("pagehide", gone);
    page.window.removeEventListener("online", online);
  };
}
