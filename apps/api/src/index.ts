// The colorless api — a Hono app deployed as a Cloudflare Worker.
// Spec: docs/workstreams/backend-data.md (§6 is the target API surface).

import {
  type DbHealthResponse,
  dbHealthResponseSchema,
  type HealthResponse,
  healthResponseSchema,
} from "@colorless/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { assetsRoutes } from "./assets/routes";
import { authRoutes } from "./auth/routes";
import { catalogRoutes } from "./catalog/routes";
import { deckRoutes } from "./decks/routes";
import { appCorsOrigins, type Env } from "./env";
import { logEventThrottled } from "./http/log";
import { lobbyRoutes, lobbySocketRoutes } from "./lobby/routes";

const app = new Hono<{ Bindings: Env }>();

// Every error body is JSON `{ error, ...extras }`, including unmatched routes and uncaught throws.
app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return c.json({ error: "internal error" }, 500);
});

// The lobby WebSocket upgrade (§3.6) mounts BEFORE the CORS middleware:
// WebSocket handshakes aren't subject to CORS, and hono/cors would throw
// trying to mutate the 101 response's immutable headers.
app.route("/lobby", lobbySocketRoutes);

// CORS on everything: the web app lives on a DIFFERENT origin (§3.5) and
// sends `credentials: "include"` so the SameSite=None session cookie rides
// along — that combination requires an exact allow-origin echo, never `*`.
// Configured per-request because env is only known per-request on Workers.
// Preflights (every JSON write) are cached for a day — browsers clamp it
// (Chromium to two hours) — instead of re-asking before each deck save.
app.use("*", (c, next) =>
  cors({ origin: appCorsOrigins(c.env), credentials: true, maxAge: 86400 })(c, next),
);

// Accounts + sessions (§3.5): register/login/logout/me, OAuth, 501 stubs.
app.route("/auth", authRoutes);

// Lazy R2 mirror for tcgdex images (D9): /assets/cards/…, /assets/sets/….
app.route("/assets", assetsRoutes);

// The authenticated deck library (§6): deck CRUD, session-gated.
app.route("/decks", deckRoutes);

// Lobby creation (§3.6/§6): POST /lobby mints a code naming a LobbyDO. The
// matching WebSocket route is mounted above, ahead of CORS.
app.route("/lobby", lobbyRoutes);

// Public catalog reads (KV-cached): /cards, /sets, /series.
app.route("/", catalogRoutes);

app.get("/health", (c) => {
  const payload: HealthResponse = {
    ok: true,
    service: "colorless-api",
    time: new Date().toISOString(),
  };
  // Parse our own response at the boundary — the same pattern every future
  // route will use for its inputs, so a schema drift fails loudly here.
  return c.json(healthResponseSchema.parse(payload));
});

// One cheap D1 read, for the post-deploy check and an uptime probe: /health above answers without
// touching D1, so it stays green through a schema mismatch or a spent read quota. The body says
// only whether the read worked and how many migrations are applied, which the repo already tells
// anyone; a failure is logged as `evt = "d1"` and its error never reaches the caller.
app.get("/health/db", async (c) => {
  c.header("Cache-Control", "no-store");
  let payload: DbHealthResponse;
  try {
    const row = await c.env.DB.prepare("SELECT count(*) AS migrations FROM d1_migrations").first<{
      migrations: number;
    }>();
    payload = { ok: true, migrations: row?.migrations ?? 0 };
  } catch {
    logEventThrottled("d1", "health_failed");
    return c.json(dbHealthResponseSchema.parse({ ok: false }), 503);
  }
  return c.json(dbHealthResponseSchema.parse(payload));
});

// wrangler instantiates Durable Objects by the classes the entry module
// exports; LobbyDO backs the LOBBY binding (wrangler.jsonc).
export { LobbyDO } from "./lobby/lobbyDO";

export default app;
