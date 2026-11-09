// Workers Rate Limiting bindings (wrangler.jsonc `ratelimits`) in front of the auth and deck
// writes and the catalog's scanning reads; the lobby routes share the period. A binding call is
// free and touches no D1, so a flood is refused before it spends any of the Free plan's rows
// written. The binding counts per Cloudflare location and approximately, which is enough to bound
// a flood; exact budgets live in D1 where one is needed (auth/rateLimit).

import type { Context } from "hono";
import { logEventThrottled } from "./log";

/** Every binding's `simple.period` in wrangler.jsonc, so the longest a refusal lasts. */
export const BINDING_PERIOD_SECONDS = 60;

/**
 * Whether `key` is over `binding`'s budget, counting this request. Without the binding (unit
 * tests), or when it throws, the request is let through and the error logged as
 * `evt, kind = failureKind`: a broken limiter must not close sign-in, deck saves or the catalog,
 * and the D1 sign-in limiter behind the auth binding still fails closed.
 */
export async function bindingRefuses(
  binding: RateLimit | undefined,
  key: string,
  evt: string,
  route: string,
  failureKind = "binding_error",
): Promise<boolean> {
  if (binding === undefined) return false;
  try {
    return !(await binding.limit({ key })).success;
  } catch (error) {
    logEventThrottled(evt, failureKind, {
      route,
      error: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

/** The 429 a binding refusal answers, with the binding's period as Retry-After. */
export function bindingRefusal(c: Context, error: string): Response {
  c.header("Retry-After", String(BINDING_PERIOD_SECONDS));
  return c.json({ error }, 429);
}
