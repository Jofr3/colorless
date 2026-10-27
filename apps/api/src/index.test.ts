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

  it("allows only the headers and methods the web client sends, whatever a preflight asks", async () => {
    const res = await app.request("/decks", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5175",
        "Access-Control-Request-Method": "PUT",
        // The quadratic split of GHSA-8j4g-w8fx-2239 ran on this header; it is no longer read.
        "Access-Control-Request-Headers": `x-evil,${" ".repeat(30_000)}content-type`,
      },
    });
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,HEAD,POST,PATCH,DELETE");
  });

  it("lets the web client read a 429's Retry-After", async () => {
    const res = await app.request("/health", { headers: { Origin: "http://localhost:5175" } });
    expect(res.headers.get("access-control-expose-headers")).toBe("Retry-After");
  });
});

describe("response headers", () => {
  it.each([
    ["a JSON 200", "/health", {}],
    ["a JSON 404", "/nope", {}],
    ["a preflight", "/decks", { method: "OPTIONS", headers: { Origin: "http://localhost:5175" } }],
  ] as const)("marks %s nosniff and same-site", async (_, path, init) => {
    const res = await app.request(path, init);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-site");
  });
});

describe("request bodies", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });

  it("refuses a body over 64 KB with a JSON 413, before parsing or any D1 access", async () => {
    const big = JSON.stringify({ email: "a@b.co", password: "x".repeat(70 * 1024) });
    const res = await post(big);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "body too large", limit: 65536 });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("counts a streamed body without a Content-Length", async () => {
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = await app.request(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
  });

  it("lets the largest real body through: a 200-entry deck save (about 8 KB)", async () => {
    // The longest catalog ids are 12 characters (`swsh10.5-001`); the name is 100 4-byte emoji.
    const cards = Array.from({ length: 200 }, (_, i) => ({
      cardId: `swsh10.5-${String(i).padStart(3, "0")}`,
      count: 99,
    }));
    const body = JSON.stringify({ name: "😀".repeat(100), tint: 360, cards, version: 2 ** 31 });
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(7000);
    const res = await app.request("/decks/d1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
    // Past the cap, stopped by the session gate.
    expect(res.status).toBe(401);
  });

  it("answers malformed JSON with a JSON 400", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(((await res.json()) as { error: string }).error).toMatch(/malformed json/i);
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
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      evt: "http",
      kind: "unhandled",
      method: "GET",
      route: "/series",
      error: "TypeError",
      quota: false,
    });
    log.mockRestore();
  });
});
