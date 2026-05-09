// Single source of truth for the "prefers-reduced-motion" media query.
//
// Two consumers were independently reading the OS preference:
//   - Body.tsx (`prefersReducedMotion()` function) — re-queried on each call
//     via window.matchMedia, with no listener for live changes.
//   - BalatroHoverCard's animator class — owned its own MediaQueryList and
//     subscription state.
//
// They were prone to drift (one would update mid-session while the other
// stayed stale until next render). This module owns the MediaQueryList
// once at module scope and exposes:
//   - `prefersReducedMotion()` — synchronous read of the cached value.
//   - `subscribePrefersReducedMotion(listener)` — fires whenever the OS
//     preference flips. Returns an unsubscribe function.
//
// The query is created lazily on first call so the module is safe to
// import in non-DOM environments (SSR, tests).

let mediaQuery: MediaQueryList | null = null;
let cachedValue = false;
const listeners = new Set<(value: boolean) => void>();

function ensureQuery() {
  if (mediaQuery || typeof window === "undefined") return;
  mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  cachedValue = mediaQuery.matches;
  mediaQuery.addEventListener("change", () => {
    cachedValue = mediaQuery!.matches;
    for (const listener of listeners) listener(cachedValue);
  });
}

export function prefersReducedMotion(): boolean {
  ensureQuery();
  return cachedValue;
}

export function subscribePrefersReducedMotion(
  listener: (value: boolean) => void,
): () => void {
  ensureQuery();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
