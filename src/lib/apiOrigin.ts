// The ONE place the web app learns where the api lives. Everything that talks
// to the backend — the lobby WebSocket today, the full API client in the
// frontend-swap milestone — derives its URLs from here, so the origin is
// configured exactly once: `VITE_API_ORIGIN` at build time, falling back to
// `wrangler dev`'s default port for local development.

const DEFAULT_API_ORIGIN = "http://localhost:8787";

/** The api's http(s) origin, without a trailing slash. */
export function apiOrigin(): string {
  const configured = (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? DEFAULT_API_ORIGIN;
  return configured.replace(/\/+$/, "");
}

/** An absolute URL for an api route, e.g. `apiUrl("/lobby")`. */
export function apiUrl(path: string): string {
  return `${apiOrigin()}${path}`;
}

/** The ws(s):// twin of `apiUrl`, for the api's WebSocket routes: http → ws
    and https → wss, same host, same path. */
export function apiWebSocketUrl(path: string): string {
  return apiUrl(path).replace(/^http/, "ws");
}
