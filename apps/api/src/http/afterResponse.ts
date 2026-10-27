// Best-effort work that should not hold up a response, such as a cache write.

import type { Context } from "hono";
import { routePath } from "hono/route";
import { logEventThrottled } from "./log";

/** Runs `work` after the response through the ExecutionContext. Outside the Workers runtime
    there is none, so it is awaited instead. Its failure never reaches the response: it goes to
    `onError`, or by default to a throttled `after_response` log line naming the route. */
export async function afterResponse(
  c: Context,
  work: () => Promise<unknown>,
  onError?: (error: unknown) => void,
): Promise<void> {
  // Read now: the route index moves on once the response is under way.
  const route = routePath(c);
  const report = onError ?? (() => logEventThrottled("after_response", "failed", { route }));
  const settled = work().catch(report);
  let ctx: Context["executionCtx"] | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  if (ctx === undefined) {
    await settled;
  } else {
    ctx.waitUntil(settled);
  }
}
