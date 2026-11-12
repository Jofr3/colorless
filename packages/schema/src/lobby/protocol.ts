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

/** How long a player may be away from a running match before forfeiting it. Shared because both
    ends use it: the DO arms an away seat's `forfeitAt` this far ahead, and the client, which reads
    that server stamp against its own clock, holds the countdown it shows to it. */
export const LOBBY_FORFEIT_MS = 90_000;

/** The transport keepalive pair. The client sends the literal `LOBBY_WS_PING`
    and the DO answers `LOBBY_WS_PONG` via `setWebSocketAutoResponse`, i.e.
    without ever waking a hibernated instance — these are raw strings on the
    socket, deliberately NOT JSON `LobbyMessage` frames. */
export const LOBBY_WS_PING = "ping";
export const LOBBY_WS_PONG = "pong";

/** How often the client pings an open lobby socket. */
export const LOBBY_PING_MS = 1500;

/** How long a lobby socket may go without a keepalive answer before either end gives it up: the
    client counts from its oldest unanswered ping, the DO from the last ping it auto-answered. */
export const LOBBY_SILENCE_MS = 10_000;

/** The raw string the DO sends a socket whose pings stopped arriving. A hidden tab's timers can be
    held back for most of a minute, so its pings stop while its link is fine; its message handlers
    still run at once, and the client answers with `LOBBY_WS_PING`, which the auto-response
    records. A page from before it ignores the string. */
export const LOBBY_WS_NUDGE = "nudge";

/** The lobby protocol this page speaks, sent in its hello; a hello without one is protocol 0.
    Raise it for a frame change an older page cannot work with, and raise the DO's
    `MIN_LOBBY_PROTOCOL` to it once older pages have had time to reload (docs/conventions.md,
    "Compat code has a sunset"). */
export const LOBBY_PROTOCOL = 1;

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

/** The close code for a socket whose hello names a protocol below the DO's minimum. A page that
    knows it stops reconnecting and asks for a reload; an older one reconnects after it. */
export const LOBBY_WS_OUTDATED = 4026;
