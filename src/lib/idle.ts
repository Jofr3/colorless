// Work the page can put off until the browser has nothing else to do.

/** The latest an idle task waits: a page that is never idle (a busy canvas) still runs it. */
export const IDLE_TIMEOUT_MS = 2000;
/** Where the browser has no requestIdleCallback (Safari), the task runs after this timer instead. */
export const IDLE_FALLBACK_MS = 200;

/** Runs `task` in the browser's next idle period, or after IDLE_TIMEOUT_MS at the latest. */
export function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === "function")
    requestIdleCallback(() => task(), { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(task, IDLE_FALLBACK_MS);
}
