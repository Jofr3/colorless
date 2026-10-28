/** How long after one reload onto a new build another may follow. */
export const RELOAD_GAP_MS = 60_000;
const RELOAD_KEY = "colorless:screen-reload";

/** Reloads the page unless it reloaded this way within RELOAD_GAP_MS, so a broken build cannot
 * loop. The time is kept in `storage` (session storage, read through a getter because touching it
 * can throw); a page that cannot keep it does not reload. True when it reloaded. */
export function reloadUnlessRecent(
  storage: () => Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
  now = Date.now(),
): boolean {
  try {
    const store = storage();
    if (now - Number(store.getItem(RELOAD_KEY)) < RELOAD_GAP_MS) return false;
    store.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}
