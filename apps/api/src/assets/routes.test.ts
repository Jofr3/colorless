import { afterEach, describe, expect, it, vi } from "vitest";
import { serveMirroredAsset } from "./routes";

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

const serve = (
  env: { ASSETS: R2Bucket },
  originUrl: string | null = "https://origin/x.webp",
  later = now,
) => serveMirroredAsset(env, "cards/x/high.webp", "image/webp", async () => originUrl, later);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serveMirroredAsset on an R2 miss", () => {
  it("mirrors a 200 from the origin into R2", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("img", { status: 200 })),
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
      vi.fn(async () => new Response("img", { status: 200 })),
    );
    const { env, puts } = emptyBucket();
    const deferred: (() => Promise<unknown>)[] = [];
    const res = await serve(env, "https://origin/x.webp", async (work) => {
      deferred.push(work);
    });
    expect(await res?.text()).toBe("img");
    expect(puts).toEqual([]);
    await deferred[0]?.();
    expect(puts).toEqual(["cards/x/high.webp"]);
  });

  it("still serves the image when the R2 write fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("img", { status: 200 })),
    );
    const { env, puts } = emptyBucket(true);
    const res = await serve(env);
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe("img");
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
});
