// /lobby — creating and joining real-time lobbies (§6, P1 milestone 8).
//
// Seat identity stays account-less: players are identified by lobby-scoped
// session ids the browser mints (net/session.ts), not by users/sessions rows, so
// these routes don't gate on auth (an anonymous player can create/join). But the
// upgrade request's `session` cookie IS forwarded to the DO, which resolves it to
// an account at /ws (P4 increment 3) — used ONLY to owner-scope that player's
// saved-deck read at the match handoff, never for seat identity.
//
// Both routes are limited per IP (wrangler.jsonc `ratelimits`): each wakes a Durable Object, and
// the Free plan's DO quota is account-wide. The limits sit far above what play needs. Creating a
// lobby is a click: 10 a minute. A socket opens on join, on every page reload and on every
// reconnect, whose backoff (src/online/channel.ts) runs from 400 ms to 8 s, about 11 a minute
// while a link stays down: 60 a minute leaves room for several tabs or players behind one
// address. A refused upgrade fails like any dropped link, and the client's backoff retries it.

import { generateLobbyCode, isValidLobbyCode } from "@colorless/schema";
import { type Context, Hono } from "hono";
import { appCorsOrigins, type Env } from "../env";
import { BINDING_PERIOD_SECONDS } from "../http/bindingLimit";
import { clientIpKey } from "../http/clientIp";
import { logEventThrottled } from "../http/log";
import {
  DO_CREATE_PATH,
  DO_WS_PATH,
  doUrl,
  isWebSocketUpgrade,
  LOBBY_CODE_HEADER,
} from "./doProtocol";

const CREATE_ATTEMPTS = 5;

/**
 * A 429 once the caller's address is over `binding`'s budget, else null. The binding counts per
 * Cloudflare location and approximately, which is enough to bound a flood. Without the binding
 * (unit tests), or when it throws, the request proceeds: a broken limiter must not close online
 * play.
 */
async function overIpLimit(
  c: Context<{ Bindings: Env }>,
  route: "create" | "ws",
  binding: RateLimit | undefined,
): Promise<Response | null> {
  if (binding === undefined) return null;
  try {
    if ((await binding.limit({ key: clientIpKey(c) })).success) return null;
  } catch (error) {
    logEventThrottled("lobby", "limiter_error", {
      route,
      error: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
  logEventThrottled("lobby", "rate_limited", { route });
  c.header("Retry-After", String(BINDING_PERIOD_SECONDS));
  return c.json({ error: "too many requests" }, 429);
}

/** POST /lobby — mounted behind the app-wide CORS like every fetched route. */
export const lobbyRoutes = new Hono<{ Bindings: Env }>();

lobbyRoutes.post("/", async (c) => {
  const limited = await overIpLimit(c, "create", c.env.LOBBY_CREATE_LIMIT);
  if (limited !== null) return limited;
  // Mint by randomness, claim through the DO: /create initializes an instance
  // exactly once, so a 409 means a live lobby already owns that code — draw
  // again. (Expired lobbies wipe their storage, which frees the code.)
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateLobbyCode();
    const stub = c.env.LOBBY.get(c.env.LOBBY.idFromName(code));
    const res = await stub.fetch(doUrl(DO_CREATE_PATH), {
      method: "POST",
      headers: { [LOBBY_CODE_HEADER]: code },
    });
    if (res.status === 201) return c.json({ code }, 201);
  }
  // 31^4 possible codes: five straight collisions means broken, not busy.
  return c.json({ error: "could not mint a lobby code" }, 503);
});

/** GET /lobby/:code/ws — validate, upgrade, and hand the socket to the code's
    Durable Object. Mounted BEFORE the CORS middleware (see index.ts):
    WebSocket handshakes aren't subject to CORS, and hono/cors would try to
    mutate the 101 response's immutable headers. */
export const lobbySocketRoutes = new Hono<{ Bindings: Env }>();

lobbySocketRoutes.get("/:code/ws", async (c) => {
  const code = c.req.param("code");
  // Strict, not normalizing: clients always build this URL from a normalized
  // code, so anything else is a bad link — same terse 404 as an expired lobby.
  if (!isValidLobbyCode(code)) {
    return c.json({ error: "no such lobby" }, 404);
  }
  if (!isWebSocketUpgrade(c.req.header("Upgrade"))) {
    return c.json({ error: "expected a websocket upgrade" }, 426);
  }
  // CORS does not govern a handshake and the DO trusts the forwarded cookie, so a page on another
  // site must not open a socket as its visitor (AU1). A client that sends no Origin is not a
  // browser and cannot carry a visitor's cookie.
  const origin = c.req.header("Origin");
  if (origin !== undefined && !appCorsOrigins(c.env).includes(origin)) {
    return c.json({ error: "forbidden origin" }, 403);
  }
  // Counted only here: a malformed, non-upgrade or foreign request never reaches a DO.
  const limited = await overIpLimit(c, "ws", c.env.LOBBY_SOCKET_LIMIT);
  if (limited !== null) return limited;
  const stub = c.env.LOBBY.get(c.env.LOBBY.idFromName(code));
  // Forward the original upgrade request, re-addressed to the DO's internal
  // /ws path; the 101 flows back as-is, for an expired code too (closed at once
  // with LOBBY_WS_NOT_FOUND).
  return stub.fetch(new Request(doUrl(DO_WS_PATH), c.req.raw));
});
