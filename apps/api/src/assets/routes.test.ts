import { afterEach, describe, expect, it, vi } from "vitest";
import { serveMirroredAsset } from "./routes";

/** An empty R2 stand-in that records puts. */
function emptyBucket() {
  const puts: string[] = [];
  const bucket = {
    get: async () => null,
    put: async (key: string) => {
      puts.push(key);
    },
  };
  return { env: { ASSETS: bucket as unknown as R2Bucket }, puts };
}

const serve = (env: { ASSETS: R2Bucket }, originUrl: string | null = "https://origin/x.webp") =>
  serveMirroredAsset(env, "cards/x/high.webp", "image/webp", async () => originUrl);

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
