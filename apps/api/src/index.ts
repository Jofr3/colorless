// The luminous api — a Hono app deployed as a Cloudflare Worker.
// Spec: docs/workstreams/backend-data.md (§6 is the target API surface).

import { type HealthResponse, healthResponseSchema } from "@luminous/schema";
import { Hono } from "hono";
import { assetsRoutes } from "./assets/routes";
import { catalogRoutes } from "./catalog/routes";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

// Lazy R2 mirror for tcgdex images (D9): /assets/cards/…, /assets/sets/….
app.route("/assets", assetsRoutes);

// Public catalog reads (KV-cached): /cards, /sets, /series.
app.route("/", catalogRoutes);

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
