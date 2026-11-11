// The web Worker's script (wrangler.jsonc `main`). It runs only when no static asset matches a
// request that is not a page navigation: navigations still get index.html from
// `not_found_handling: "single-page-application"` without it. Under /assets/ and /love/ a miss is
// a 404 that is never stored: answered with index.html, status 200 and /assets/'s one-year
// immutable cache, a stale tab that lazy-loaded a chunk across a deploy would keep that HTML under
// the chunk's URL, and a later web rollback that made the URL valid again would stay broken in
// that browser. Any other path is a page asked for without `Sec-Fetch-Mode: navigate` (Safari
// before 16.4, a link preview) and gets index.html. public/_headers does not reach a script's own responses, so the 404 sets
// the headers every response needs.

type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

const NOT_FOUND_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
};

/** Whether `pathname` names a build file, where a miss must never become the page. */
export function isBuildFile(pathname: string): boolean {
  return pathname.startsWith("/assets/") || pathname.startsWith("/love/");
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    if (isBuildFile(new URL(request.url).pathname))
      return new Response("Not found\n", { status: 404, headers: NOT_FOUND_HEADERS });
    return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
  },
};
