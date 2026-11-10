import { describe, expect, it } from "vitest";
import worker, { isBuildFile } from "./notFoundWorker";

const env = {
  ASSETS: {
    fetch: async (request: Request) =>
      new Response(`index for ${new URL(request.url).pathname}`, { status: 200 }),
  },
};
const get = (path: string) =>
  worker.fetch(new Request(`https://colorless.example${path}`), env) as Promise<Response>;

describe("notFoundWorker", () => {
  it("answers a missing build file with a 404 nothing stores", async () => {
    for (const path of ["/assets/onlineTable-OLDHASH0.js", "/love/game.wasm"]) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("serves the page for any other path, as the SPA fallback did", async () => {
    const response = await get("/decks/abc?x=1");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("index for /");
  });

  it("treats only the two build prefixes as build files", () => {
    expect(isBuildFile("/assets/x.js")).toBe(true);
    expect(isBuildFile("/love/host.js")).toBe(true);
    expect(isBuildFile("/assetsx")).toBe(false);
    expect(isBuildFile("/decks/love/")).toBe(false);
  });
});
