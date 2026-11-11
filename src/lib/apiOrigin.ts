// The ONE place the web app learns where the api lives. Everything that talks
// to the backend derives its URLs from here, so the origin is configured
// exactly once: `VITE_API_ORIGIN` at build time, falling back to `wrangler
// dev`'s default port for local development. A dev page keeps its own loopback
// name for the api: 127.0.0.1 and localhost are different sites, and the api
// refuses a cross-site write.

const DEV_API_PORT = 8787;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** The api's http(s) origin, without a trailing slash. */
export function apiOrigin(): string {
  const configured = import.meta.env.VITE_API_ORIGIN as string | undefined;
  return (configured ?? defaultApiOrigin()).replace(/\/+$/, "");
}

function defaultApiOrigin(): string {
  const host = typeof location === "undefined" ? undefined : location.hostname;
  if (import.meta.env.DEV && host !== undefined && LOOPBACK_HOSTS.has(host)) {
    return `http://${host}:${DEV_API_PORT}`;
  }
  return `http://localhost:${DEV_API_PORT}`;
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
