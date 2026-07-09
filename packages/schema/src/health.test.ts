import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./health";

describe("healthResponseSchema", () => {
  it("accepts a well-formed payload", () => {
    const result = healthResponseSchema.safeParse({
      ok: true,
      service: "luminous-api",
      time: "2026-07-09T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a degraded payload", () => {
    const result = healthResponseSchema.safeParse({
      ok: false,
      service: "luminous-api",
      time: "not a timestamp",
    });
    expect(result.success).toBe(false);
  });
});
