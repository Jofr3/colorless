import { healthResponseSchema } from "@luminous/schema";
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
