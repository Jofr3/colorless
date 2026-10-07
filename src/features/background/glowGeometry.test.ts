import { describe, expect, it } from "vitest";
import { glowGeometry } from "./glowGeometry";

describe("glowGeometry", () => {
  it.each([
    [90, [0.5, 1], [1, 0], [1.2, 0.55]],
    [180, [0, 0.5], [0, 1], [1.2, 0.52]],
    [270, [0.5, 0], [-1, 0], [1.2, 0.55]],
  ] as const)(
    "keeps the %s° resting glow aligned along its screen edge",
    (degrees, centre, axis, radii) => {
      const geometry = glowGeometry((degrees * Math.PI) / 180);
      for (const index of [0, 1] as const) {
        expect(geometry.uBlue[index]).toBeCloseTo(centre[index]);
        expect(geometry.axis[index]).toBeCloseTo(axis[index]);
        expect(geometry.radii[index]).toBeCloseTo(radii[index]);
      }
    },
  );

  it("hugs the rounded corners and turns the ellipse as it passes them", () => {
    const { uBlue, axis } = glowGeometry((3 * Math.PI) / 4);
    expect(uBlue[0]).toBeGreaterThan(0);
    expect(uBlue[0]).toBeLessThan(0.05);
    expect(uBlue[1]).toBeGreaterThan(0.95);
    expect(uBlue[1]).toBeLessThan(1);
    expect(axis[0]).toBeCloseTo(Math.SQRT1_2);
    expect(axis[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it("keeps opposite glows on the perimeter throughout a swap", () => {
    for (let step = 0; step <= 180; step++) {
      const { uBlue, uRed, axis } = glowGeometry(((90 + step) * Math.PI) / 180);
      const x = 2 * (uBlue[0] - 0.5);
      const y = 2 * (uBlue[1] - 0.5);
      expect(Math.abs(x) ** 8 + Math.abs(y) ** 8).toBeCloseTo(1);
      expect(Math.hypot(...axis)).toBeCloseTo(1);
      for (const index of [0, 1] as const) {
        expect(uBlue[index]).toBeGreaterThanOrEqual(0);
        expect(uBlue[index]).toBeLessThanOrEqual(1);
        expect(uBlue[index] + uRed[index]).toBeCloseTo(1);
      }
    }
  });

  it("rotates steadily through corners and the midpoint without pauses or bursts", () => {
    for (let degrees = 90; degrees < 270; degrees++) {
      const before = glowGeometry((degrees * Math.PI) / 180).axis;
      const after = glowGeometry(((degrees + 1) * Math.PI) / 180).axis;
      const rotation = Math.acos(before[0] * after[0] + before[1] * after[1]);
      expect((rotation * 180) / Math.PI).toBeCloseTo(1);
    }
  });

  it("exchanges the positions and preserves the ellipse shape after half a turn", () => {
    const before = glowGeometry(Math.PI / 3);
    const after = glowGeometry(Math.PI / 3 + Math.PI);
    for (const index of [0, 1] as const) {
      expect(after.uBlue[index]).toBeCloseTo(before.uRed[index]);
      expect(after.uRed[index]).toBeCloseTo(before.uBlue[index]);
      expect(after.axis[index]).toBeCloseTo(-before.axis[index]);
      expect(after.radii[index]).toBeCloseTo(before.radii[index]);
    }
  });
});
