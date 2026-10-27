// Best-effort work that should not hold up a response, such as a cache write.

import type { Context } from "hono";

/** Runs `work` after the response through the ExecutionContext. Outside the Workers runtime
    there is none, so it is awaited instead. Its failure is dropped either way. */
export async function afterResponse(c: Context, work: () => Promise<unknown>): Promise<void> {
  const settled = work().catch(() => {});
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
