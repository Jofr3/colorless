import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./health";

describe("healthResponseSchema", () => {
  it("accepts a well-formed payload", () => {
    const result = healthResponseSchema.safeParse({
      ok: true,
      service: "colorless-api",
      time: "2026-07-09T00:00:00.000Z",
      version: { id: "0f3c-version", tag: "3d6b1a12" },
    });
    expect(result.success).toBe(true);
  });

  it("requires the version field, null where the binding is absent", () => {
    const base = { ok: true, service: "colorless-api", time: "2026-07-09T00:00:00.000Z" };
    expect(healthResponseSchema.safeParse({ ...base, version: null }).success).toBe(true);
    expect(healthResponseSchema.safeParse(base).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...base, version: { id: "v" } }).success).toBe(false);
  });

  it("rejects a degraded payload", () => {
    const result = healthResponseSchema.safeParse({
      ok: false,
      service: "colorless-api",
      time: "not a timestamp",
    });
    expect(result.success).toBe(false);
  });
});
