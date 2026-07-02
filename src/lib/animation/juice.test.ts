import { describe, expect, it } from "vitest";
import { evaluateJuice, initialSquish, JUICE_DURATION, startJuice } from "./juice";

describe("startJuice", () => {
  it("builds an end time one duration after the start", () => {
    const state = startJuice(0.05, 0.03, 10);
    expect(state).toEqual({
      scaleAmt: 0.05,
      rotAmt: 0.03,
      startTime: 10,
      endTime: 10 + JUICE_DURATION,
    });
  });
});

describe("evaluateJuice", () => {
  it("returns null when there is no juice", () => {
    expect(evaluateJuice(null, 5)).toBeNull();
  });

  it("returns null once the envelope has elapsed", () => {
    const state = startJuice(0.05, 0.03, 0);
    expect(evaluateJuice(state, JUICE_DURATION)).toBeNull();
    expect(evaluateJuice(state, JUICE_DURATION + 1)).toBeNull();
  });

  it("starts at zero offset (sin(0) = 0) on the first frame", () => {
    const state = startJuice(0.05, 0.03, 0);
    const value = evaluateJuice(state, 0);
    expect(value).not.toBeNull();
    expect(value?.scale).toBeCloseTo(0, 9);
    expect(value?.rotation).toBeCloseTo(0, 9);
  });

  it("stays within the seeded amplitude (envelope ≤ 1, |sin| ≤ 1)", () => {
    const state = startJuice(0.05, 0.03, 0);
    for (let t = 0; t < JUICE_DURATION; t += JUICE_DURATION / 50) {
      const value = evaluateJuice(state, t);
      expect(Math.abs(value?.scale ?? 0)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.abs(value?.rotation ?? 0)).toBeLessThanOrEqual(0.03 + 1e-9);
    }
  });

  it("decays toward zero as the envelope closes", () => {
    const state = startJuice(0.05, 0.03, 0);
    // Compare the oscillation peak envelope early vs late: the cubic/squared
    // envelopes shrink monotonically, so the bound at 90% elapsed is tiny.
    const late = evaluateJuice(state, JUICE_DURATION * 0.99);
    expect(Math.abs(late?.scale ?? 0)).toBeLessThan(0.05 * 0.01);
  });
});

describe("initialSquish", () => {
  it("is 1 - 0.6·amount", () => {
    expect(initialSquish(0)).toBe(1);
    expect(initialSquish(0.05)).toBeCloseTo(0.97, 9);
    expect(initialSquish(0.1)).toBeCloseTo(0.94, 9);
  });
});
