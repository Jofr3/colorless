import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLogThrottle } from "../http/log";
import { MAX_ASSET_BYTES } from "./files";
import { ORIGIN_TIMEOUT_MS, serveMirroredAsset } from "./routes";

/** An empty R2 stand-in that records puts; `failPut` makes every put throw. */
function emptyBucket(failPut = false) {
  const puts: string[] = [];
  const bucket = {
    get: async () => null,
    put: async (key: string) => {
      puts.push(key);
      if (failPut) throw new Error("R2 put failed");
    },
  };
  return { env: { ASSETS: bucket as unknown as R2Bucket }, puts };
}

/** Runs deferred work at once, as the routes do outside the Workers runtime. */
const now = async (work: () => Promise<unknown>) => {
  await work().catch(() => {});
};

const ORIGIN_URL = "https://assets.tcgdex.net/en/sv/sv01/081/high.webp";

const serve = (env: { ASSETS: R2Bucket }, originUrl: string | null = ORIGIN_URL, later = now) =>
  serveMirroredAsset(env, "cards/x/high.webp", "image/webp", async () => originUrl, later);

/** The start of a WebP file. */
const WEBP = "RIFF\u0000\u0000\u0000\u0000WEBPVP8 img";

/** An origin 200 carrying a WebP body; `init` overrides its headers. */
const image = (body: BodyInit = WEBP, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "Content-Type": "image/webp", ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLogThrottle();
});

describe("serveMirroredAsset on an R2 miss", () => {
  it("mirrors a 200 from the origin into R2", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => image()),
    );
    const { env, puts } = emptyBucket();
    const res = await serve(env);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("x-colorless-cache")).toBe("miss");
    expect(puts).toEqual(["cards/x/high.webp"]);
  });

  it("answers before the R2 write, which it hands to the deferred runner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => image()),
    );
    const { env, puts } = emptyBucket();
    const deferred: (() => Promise<unknown>)[] = [];
    const res = await serve(env, ORIGIN_URL, async (work) => {
      deferred.push(work);
    });
    expect(await res?.text()).toBe(WEBP);
    expect(puts).toEqual([]);
    await deferred[0]?.();
    expect(puts).toEqual(["cards/x/high.webp"]);
  });

  it("still serves the image when the R2 write fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => image()),
    );
    const { env, puts } = emptyBucket(true);
    const res = await serve(env);
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe(WEBP);
    expect(puts).toEqual(["cards/x/high.webp"]);
  });

  it("is not found for an unknown row or an origin 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    const { env, puts } = emptyBucket();
    expect(await serve(env, null)).toBeNull();
    expect(await serve(env)).toBeNull();
    expect(puts).toEqual([]);
  });

  it.each([
    ["an origin 5xx", async () => new Response("", { status: 503 })],
    [
      "a network error",
      async () => {
        throw new TypeError("network down");
      },
    ],
  ])("answers %s with a 502 and stores nothing", async (_label, upstream) => {
    vi.stubGlobal("fetch", vi.fn(upstream));
    const { env, puts } = emptyBucket();
    const res = await serve(env);
    expect(res?.status).toBe(502);
    expect(await res?.json()).toEqual({ error: "asset origin unavailable" });
    expect(puts).toEqual([]);
  });

  it.each([
    // Ignores its signal, as a stalled socket might.
    ["an origin that never responds", () => new Promise<Response>(() => {})],
    ["an image body that never ends", async () => image(new ReadableStream())],
  ])("answers %s with a 502 once its time is up", async (_label, upstream) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.stubGlobal("fetch", vi.fn(upstream));
      const { env, puts } = emptyBucket();
      let settled = false;
      const pending = serve(env).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(ORIGIN_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(res?.status).toBe(502);
      expect(puts).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers a body that breaks off with a 502", async () => {
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new TypeError("connection reset"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => image(broken)),
    );
    const { env, puts } = emptyBucket();
    expect((await serve(env))?.status).toBe(502);
    expect(puts).toEqual([]);
  });
});

describe("serveMirroredAsset stores only images from the asset origin", () => {
  const refusals = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.map(([line]) => (JSON.parse(String(line)) as { reason: string }).reason);

  it("never fetches a URL off the asset origin", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async () => image());
    vi.stubGlobal("fetch", fetch);
    const { env, puts } = emptyBucket();
    expect(await serve(env, "http://evil.example/x.webp")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
    expect(refusals(warn)).toEqual(["origin_url"]);
  });

  it.each([
    [
      "a redirect off the origin",
      () => {
        const res = image();
        Object.defineProperty(res, "url", { value: "https://cdn.evil.example/x.webp" });
        return res;
      },
      "redirect",
    ],
    [
      "an HTML soft 404",
      () => image("<html>not found</html>", { "Content-Type": "text/html" }),
      "content_type",
    ],
    ["an image type over the wrong bytes", () => image("<html>not found</html>"), "magic"],
    ["a PNG where WebP was asked for", () => image("\u0089PNG\r\n\u001a\n...."), "magic"],
    [
      "a declared length over the cap",
      () => image(WEBP, { "Content-Length": String(MAX_ASSET_BYTES + 1) }),
      "too_large",
    ],
    [
      "an undeclared body over the cap",
      () =>
        image(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
          }),
        ),
      "too_large",
    ],
  ])("refuses %s as missing and stores nothing", async (_label, upstream, reason) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => upstream()),
    );
    const { env, puts } = emptyBucket();
    expect(await serve(env)).toBeNull();
    expect(puts).toEqual([]);
    expect(refusals(warn)).toEqual([reason]);
  });

  it("follows a redirect that stays on the origin", async () => {
    const res = image();
    Object.defineProperty(res, "url", { value: "https://assets.tcgdex.net/elsewhere/high.webp" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );
    const { env, puts } = emptyBucket();
    expect((await serve(env))?.status).toBe(200);
    expect(puts).toEqual(["cards/x/high.webp"]);
  });
});
