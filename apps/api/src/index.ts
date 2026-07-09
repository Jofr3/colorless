// The luminous api — a Hono app deployed as a Cloudflare Worker.
// Spec: docs/workstreams/backend-data.md (§6 is the target API surface).

import { type HealthResponse, healthResponseSchema } from "@luminous/schema";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => {
  const payload: HealthResponse = {
    ok: true,
    service: "luminous-api",
    time: new Date().toISOString(),
  };
  // Parse our own response at the boundary — the same pattern every future
  // route will use for its inputs, so a schema drift fails loudly here.
  return c.json(healthResponseSchema.parse(payload));
});

export default app;
