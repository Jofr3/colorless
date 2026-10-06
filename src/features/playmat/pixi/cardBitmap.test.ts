import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCardBitmap } from "./cardBitmap";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("card image loading", () => {
  it("recovers both newly benched cards after their first requests fail", async () => {
    const attempts = new Map<string, number>();
    const fetchImage = vi.fn(async (url: string) => {
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      return new Response(attempt === 1 ? null : new Blob([url]), {
        status: attempt === 1 ? 503 : 200,
      });
    });
    vi.stubGlobal("fetch", fetchImage);
    const decode = vi.fn(async (blob: Blob) => ({ url: await blob.text() }));
    vi.stubGlobal("createImageBitmap", decode);
    const loaded = Promise.all([loadCardBitmap("pokemon-a"), loadCardBitmap("pokemon-b")]);
    await vi.runAllTimersAsync();
    expect(await loaded).toEqual([{ url: "pokemon-a" }, { url: "pokemon-b" }]);
    expect(attempts).toEqual(
      new Map([
        ["pokemon-a", 2],
        ["pokemon-b", 2],
      ]),
    );
    expect(fetchImage).toHaveBeenCalledWith("pokemon-a", {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  });

  it("retries network and decoding failures", async () => {
    const fetchImage = vi
      .fn(async () => new Response(new Blob(["image"])))
      .mockRejectedValueOnce(new TypeError("Network unavailable"));
    const decode = vi
      .fn()
      .mockRejectedValueOnce(new Error("Incomplete image"))
      .mockResolvedValue({ width: 733, height: 1024 });
    vi.stubGlobal("fetch", fetchImage);
    vi.stubGlobal("createImageBitmap", decode);
    const loaded = loadCardBitmap("pokemon");
    await vi.runAllTimersAsync();
    expect(await loaded).toEqual({ width: 733, height: 1024 });
    expect(fetchImage).toHaveBeenCalledTimes(3);
  });

  it("bounds retries while the service remains unavailable", async () => {
    const fetchImage = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchImage);
    const rejected = expect(loadCardBitmap("pokemon")).rejects.toThrow("(503)");
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetchImage).toHaveBeenCalledTimes(4);
  });

  it("does not retry a missing card image", async () => {
    const fetchImage = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchImage);
    await expect(loadCardBitmap("pokemon")).rejects.toThrow("(404)");
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });
});
