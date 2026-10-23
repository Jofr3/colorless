// The internal Worker → LobbyDO contract. The DO is reached through its stub, so the origin is a
// placeholder; only the path, method and header matter.

/** POST: claim a minted lobby code (201, or 409 when a live lobby already owns it). */
export const DO_CREATE_PATH = "/create";
/** GET: upgrade a client socket into the lobby. */
export const DO_WS_PATH = "/ws";
/** The code being claimed by a create request. */
export const LOBBY_CODE_HEADER = "x-lobby-code";

/** The URL a stub fetch uses to reach `path` on the DO. */
export function doUrl(path: typeof DO_CREATE_PATH | typeof DO_WS_PATH): string {
  return `https://lobby-do${path}`;
}

/** Whether a request asks for a WebSocket upgrade. */
export function isWebSocketUpgrade(upgradeHeader: string | null | undefined): boolean {
  return upgradeHeader?.toLowerCase() === "websocket";
}
