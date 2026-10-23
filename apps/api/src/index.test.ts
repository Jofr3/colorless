import { healthResponseSchema } from "@colorless/schema";
import { describe, expect, it, vi } from "vitest";
import app from "./index";

describe("GET /health", () => {
  it("returns a schema-valid health payload", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.ok).toBe(true);
  });

  it("404s unknown routes", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});

describe("CORS", () => {
  it("lets browsers cache a preflight", async () => {
    const res = await app.request("/decks", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5175",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });
});

describe("error responses", () => {
  it.each(["/nope", "/assets/cards/sv01-001/high.exe"])(
    "answers %s with a JSON 404",
    async (path) => {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not found" });
    },
  );

  it("answers an uncaught throw with a JSON 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // No CACHE binding: the catalog's KV read throws.
    const res = await app.request("/series", {}, {});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error" });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
