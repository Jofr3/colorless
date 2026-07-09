// The luminous api — a Hono app deployed as a Cloudflare Worker.
// Spec: docs/workstreams/backend-data.md (§6 is the target API surface).

import { type HealthResponse, healthResponseSchema } from "@luminous/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { assetsRoutes } from "./assets/routes";
import { authRoutes } from "./auth/routes";
import { catalogRoutes } from "./catalog/routes";
import { deckRoutes, folderRoutes } from "./decks/routes";
import { appOrigin, type Env } from "./env";
import { lobbyRoutes, lobbySocketRoutes } from "./lobby/routes";

const app = new Hono<{ Bindings: Env }>();

// The lobby WebSocket upgrade (§3.6) mounts BEFORE the CORS middleware:
// WebSocket handshakes aren't subject to CORS, and hono/cors would throw
// trying to mutate the 101 response's immutable headers.
app.route("/lobby", lobbySocketRoutes);

// CORS on everything: the web app lives on a DIFFERENT origin (§3.5) and
// sends `credentials: "include"` so the SameSite=None session cookie rides
// along — that combination requires an exact allow-origin echo, never `*`.
// Configured per-request because env is only known per-request on Workers.
app.use("*", (c, next) => cors({ origin: appOrigin(c.env), credentials: true })(c, next));

// Accounts + sessions (§3.5): register/login/logout/me, OAuth, 501 stubs.
app.route("/auth", authRoutes);

// Lazy R2 mirror for tcgdex images (D9): /assets/cards/…, /assets/sets/….
app.route("/assets", assetsRoutes);

// The authenticated deck library (§6): decks + folders CRUD, session-gated.
app.route("/decks", deckRoutes);
app.route("/folders", folderRoutes);

// Lobby creation (§3.6/§6): POST /lobby mints a code naming a LobbyDO. The
// matching WebSocket route is mounted above, ahead of CORS.
app.route("/lobby", lobbyRoutes);

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

// wrangler instantiates Durable Objects by the classes the entry module
// exports; LobbyDO backs the LOBBY binding (wrangler.jsonc).
export { LobbyDO } from "./lobby/lobbyDO";

export default app;
