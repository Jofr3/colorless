// /lobby — creating and joining real-time lobbies (§6, P1 milestone 8).
//
// Seat identity stays account-less: players are identified by lobby-scoped
// session ids the browser mints (net/session.ts), not by users/sessions rows, so
// these routes don't gate on auth (an anonymous player can create/join). But the
// upgrade request's `session` cookie IS forwarded to the DO, which resolves it to
// an account at /ws (P4 increment 3) — used ONLY to owner-scope that player's
// saved-deck read at the match handoff, never for seat identity.

import { generateLobbyCode, isValidLobbyCode } from "@luminous/schema";
import { Hono } from "hono";
import type { Env } from "../env";

const CREATE_ATTEMPTS = 5;

/** POST /lobby — mounted behind the app-wide CORS like every fetched route. */
export const lobbyRoutes = new Hono<{ Bindings: Env }>();

lobbyRoutes.post("/", async (c) => {
  // Mint by randomness, claim through the DO: /create initializes an instance
  // exactly once, so a 409 means a live lobby already owns that code — draw
  // again. (Expired lobbies wipe their storage, which frees the code.)
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateLobbyCode();
    const stub = c.env.LOBBY.get(c.env.LOBBY.idFromName(code));
    const res = await stub.fetch("https://lobby-do/create", {
      method: "POST",
      headers: { "x-lobby-code": code },
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
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "expected a websocket upgrade" }, 426);
  }
  const stub = c.env.LOBBY.get(c.env.LOBBY.idFromName(code));
  // Forward the original upgrade request, re-addressed to the DO's internal
  // /ws path; the 101 (or the DO's 404 for an expired code) flows back as-is.
  return stub.fetch(new Request("https://lobby-do/ws", c.req.raw));
});
