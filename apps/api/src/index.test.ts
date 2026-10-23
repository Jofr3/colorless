import { healthResponseSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
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
