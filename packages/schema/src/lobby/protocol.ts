// Wire-protocol constants both ends of the lobby socket share. Kept in their
// own zod-free module: the web client imports these (and only these) from the
// wire layer, and the Zod schemas in wire.ts must not ride into its bundle
// along with them — the client trusts the server's frames; validation is the
// Durable Object's job.

import { DISPLAY_NAME_MAX } from "../displayName";

/** How long the "battle starting" countdown runs. Shared because both ends
    time it: the DO's alarm flips countdown → in-game when it elapses, and the
    client overlay animates the same window from `countdownStartedAt`. */
export const COUNTDOWN_MS = 3000;

/** The transport keepalive pair. The client sends the literal `LOBBY_WS_PING`
    and the DO answers `LOBBY_WS_PONG` via `setWebSocketAutoResponse`, i.e.
    without ever waking a hibernated instance — these are raw strings on the
    socket, deliberately NOT JSON `LobbyMessage` frames. */
export const LOBBY_WS_PING = "ping";
export const LOBBY_WS_PONG = "pong";

/** Length bounds on the strings a client puts in a lobby frame, which the DO stores and copies
    into every match log row. Ids are minted by code (seat secrets and public seat ids are
    base64url, seatId.ts; deck ids are UUIDs), so a longer one is refused; names are typed by people, so a longer one is clipped instead. The
    name bound is the account display name's. */
export const LOBBY_ID_MAX = 64;
export const LOBBY_NAME_MAX = DISPLAY_NAME_MAX;
export const LOBBY_DECK_NAME_MAX = 100;

/** The close code the DO ends a socket with when it closes the lobby for good (no commit or
    accepted action for an hour, then wiped). A client that sees it stops reconnecting, since the
    code no longer names a lobby; an older client retries and is answered 404 like any expired
    lobby. Every other close is a dropped link the client reconnects after. */
export const LOBBY_WS_CLOSED = 4000;

/** The close code a socket for a code that names no lobby (never created, expired or wiped) is
    accepted and closed with at once. It is the client's only definite "not found": a refused
    upgrade fails like any dropped link, and a slow first socket is the same silence. A client
    that sees it stops reconnecting; an older one reconnects after it, as after the 404 it got
    before, and its own window decides. */
export const LOBBY_WS_NOT_FOUND = 4004;
