// Wire-protocol constants both ends of the lobby socket share. Kept in their
// own zod-free module: the web client imports these (and only these) from the
// wire layer, and the Zod schemas in wire.ts must not ride into its bundle
// along with them — the client trusts the server's frames; validation is the
// Durable Object's job.

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
