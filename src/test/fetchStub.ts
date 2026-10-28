// Shared fetch-stubbing helpers for the suites that exercise the api client
// (it builds absolute urls via apiOrigin, so tests stub global fetch). Not a
// test file itself — vitest only collects *.test.* / *.spec.*.

import { vi } from "vitest";

/** A canned JSON Response (the api's content-type included, so the client's
    error-body parsing sees it as JSON). */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub fetch with a "METHOD /path" routing table; unrouted calls reject.
    Returns the mock plus a log of the routed keys, in call order. Routes are
    functions, so a test can vary the response per call (close over state);
    each receives the requested url, query string included. */
export function stubFetch(routes: Record<string, (url: URL) => Response | Promise<Response>>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    const key = `${init?.method ?? "GET"} ${parsed.pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unstubbed fetch: ${key}`);
    calls.push(key);
    return route(parsed);
  });
  vi.stubGlobal("fetch", impl);
  return { impl, calls };
}

/** Stub fetch with one canned response for every call, each call reading its
    own copy of it; returns the mock for call inspection (url/init assertions). */
export function stubFetchResponse(response: Response) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response.clone());
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Stub fetch with one canned response per successive call, in order (an
    Error entry makes that call reject); returns the mock for inspection. */
export function stubFetchSequence(...responses: (Response | Error)[]) {
  const mock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) mock.mockRejectedValueOnce(response);
    else mock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** A GET /cards/full route answering from `catalog`, leaving unknown ids out. */
export function fullCardsFrom(catalog: Record<string, unknown>) {
  return (url: URL): Response =>
    json(url.searchParams.getAll("id").flatMap((id) => (id in catalog ? [catalog[id]] : [])));
}
