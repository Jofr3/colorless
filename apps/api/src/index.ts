// The colorless api — a Hono app deployed as a Cloudflare Worker.
// Spec: docs/workstreams/backend-data.md (§6 is the target API surface).

import {
  type DbHealthResponse,
  dbHealthResponseSchema,
  type HealthResponse,
  healthResponseSchema,
} from "@colorless/schema";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { assetsRoutes } from "./assets/routes";
import { authRoutes } from "./auth/routes";
import { sweepExpired } from "./auth/sweep";
import { cardIndexRoutes } from "./catalog/cardIndex";
import { catalogRoutes } from "./catalog/routes";
import { deckRoutes } from "./decks/routes";
import { appCorsOrigins, type Env } from "./env";
import { errorFields } from "./http/errors";
import { logError, logEvent, logEventThrottled } from "./http/log";
import { lobbyRoutes, lobbySocketRoutes } from "./lobby/routes";

const app = new Hono<{ Bindings: Env }>();

// Every error body is JSON `{ error, ...extras }`, including unmatched routes, Hono's own
// HTTPExceptions (a malformed JSON body) and uncaught throws.
app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message || "request failed" }, error.status);
  }
  // Names and the SQL only: a failed query's message carries its bound values (./http/errors.ts).
  logError("http", "unhandled", {
    method: c.req.method,
    route: routePath(c, -1),
    ...errorFields(error),
  });
  return c.json({ error: "internal error" }, 500);
});

// The lobby WebSocket upgrade (§3.6) mounts BEFORE the CORS middleware:
// WebSocket handshakes aren't subject to CORS, and hono/cors would throw
// trying to mutate the 101 response's immutable headers.
app.route("/lobby", lobbySocketRoutes);

// Every response is what its Content-Type says, and is readable only by the same site: the web
// app and the API are both on the account's workers.dev subdomain, which is one site because
// `workers.dev` is the public suffix. Set after `next`, and outside CORS, so preflights and error
// responses carry them too.
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cross-Origin-Resource-Policy", "same-site");
});

// CORS on everything: the web app lives on a DIFFERENT origin of the same site (§3.5) and
// sends `credentials: "include"` so the SameSite=Lax session cookie rides
// along — that combination requires an exact allow-origin echo, never `*`.
// Configured per-request because env is only known per-request on Workers.
// Preflights (every JSON write) are cached for a day — browsers clamp it
// (Chromium to two hours) — instead of re-asking before each deck save. The
// web client sends no request header but Content-Type (src/lib/api.ts), and
// an explicit list stops hono echoing whatever a preflight asks for.
app.use("*", (c, next) =>
  cors({
    origin: appCorsOrigins(c.env),
    credentials: true,
    maxAge: 86400,
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
    // A 429's wait, which the deck saver honours before retrying.
    exposeHeaders: ["Retry-After"],
  })(c, next),
);

// A state-changing request from another site is refused (AEX1): the session cookie is Lax, so a
// browser leaves it off such requests anyway, but this also stops a request that needs no cookie
// (POST /lobby, register) and covers a cookie set before the move to Lax. A request with no Origin
// is not from a browser page, so it carries no visitor's cookie; `Sec-Fetch-Site` catches a
// browser that sent no Origin.
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use("*", async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    const foreignOrigin = origin !== undefined && !appCorsOrigins(c.env).includes(origin);
    if (foreignOrigin || c.req.header("Sec-Fetch-Site") === "cross-site") {
      logEventThrottled("http", "cross_site_refused", { method: c.req.method, route: c.req.path });
      return c.json({ error: "forbidden origin" }, 403);
    }
  }
  await next();
});

// No legitimate body is larger than about 8 KB: a 200-entry deck save of the longest card ids.
// The cap stops a large body being buffered and parsed (or a huge array validated) at all. A
// body with no Content-Length is counted as it streams in.
const MAX_BODY_BYTES = 64 * 1024;
app.use(
  "*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "body too large", limit: MAX_BODY_BYTES }, 413),
  }),
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

// Public catalog reads (KV-cached): /cards, /sets, /series. The whole-catalog search index mounts
// first, since /cards/:id would otherwise claim /cards/index.
app.route("/", cardIndexRoutes);
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

/** The daily Cron Trigger (wrangler.jsonc `triggers.crons`). A failure is logged and rethrown,
    so the run also shows as failed under the Worker's Cron Events. */
async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  try {
    logEvent("d1", "sweep", await sweepExpired(env.DB, controller.scheduledTime));
  } catch (error) {
    logEvent("d1", "sweep_failed", { error: error instanceof Error ? error.name : typeof error });
    throw error;
  }
}

// wrangler instantiates Durable Objects by the classes the entry module
// exports; LobbyDO backs the LOBBY binding (wrangler.jsonc).
export { LobbyDO } from "./lobby/lobbyDO";

// The Worker's handlers: Hono answers `fetch`, and `scheduled` rides on the same object so tests
// keep calling `app.request()` on the default export.
export default Object.assign(app, { scheduled });
