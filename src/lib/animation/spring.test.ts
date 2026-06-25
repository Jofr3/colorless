import { describe, expect, it } from "vitest";
import {
  clampVelocity,
  DRAG_TILT_CAP,
  DRAG_VEL_REF,
  dragTiltFromVelocity,
  SPRING_MAX_VEL,
  stepSpringScalar,
  stepSpringXY,
} from "./spring";

const DT = 1 / 60;

describe("stepSpringXY", () => {
  it("converges to the target and zeroes velocity", () => {
    const vel = { x: 0, y: 0 };
    let pos = 0;
    for (let i = 0; i < 2000 && pos !== 100; i++) {
      pos = stepSpringXY(pos, 100, DT, vel, "x");
    }
    expect(pos).toBe(100);
    expect(vel.x).toBe(0);
  });

  it("moves toward the target on the first step", () => {
    const vel = { x: 0, y: 0 };
    const next = stepSpringXY(0, 100, DT, vel, "x");
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(100);
    expect(vel.x).toBeGreaterThan(0);
  });

  it("snaps when already at the target", () => {
    const vel = { x: 0, y: 0 };
    expect(stepSpringXY(100, 100, DT, vel, "x")).toBe(100);
    expect(vel.x).toBe(0);
  });
});

describe("stepSpringScalar", () => {
  it("converges to the target and zeroes velocity", () => {
    const vel = { rot: 0 };
    let r = 0;
    for (let i = 0; i < 2000 && r !== 1; i++) {
      r = stepSpringScalar(r, 1, DT, 45, vel, "rot");
    }
    expect(r).toBe(1);
    expect(vel.rot).toBe(0);
  });
});

describe("clampVelocity", () => {
  it("caps the magnitude to SPRING_MAX_VEL·dt while preserving direction", () => {
    const vel = { x: 1000, y: 0 };
    clampVelocity(vel, DT);
    expect(vel.x).toBeCloseTo(SPRING_MAX_VEL * DT, 6);
    expect(vel.y).toBe(0);
  });

  it("leaves a sub-cap velocity untouched", () => {
    const vel = { x: 0.5, y: -0.3 };
    clampVelocity(vel, DT);
    expect(vel.x).toBe(0.5);
    expect(vel.y).toBe(-0.3);
  });
});

describe("dragTiltFromVelocity", () => {
  it("is zero at zero velocity", () => {
    expect(dragTiltFromVelocity(0, DT)).toBe(0);
  });

  it("reaches the cap at the reference velocity and saturates beyond it", () => {
    // velSec === DRAG_VEL_REF when velX = DRAG_VEL_REF * dt (dt > 0.001).
    expect(dragTiltFromVelocity(DRAG_VEL_REF * DT, DT)).toBeCloseTo(DRAG_TILT_CAP, 6);
    expect(dragTiltFromVelocity(DRAG_VEL_REF * DT * 10, DT)).toBeCloseTo(DRAG_TILT_CAP, 6);
  });

  it("follows the sign of velocity and never exceeds the cap", () => {
    const negative = dragTiltFromVelocity(-DRAG_VEL_REF * DT * 5, DT);
    expect(negative).toBeCloseTo(-DRAG_TILT_CAP, 6);
    expect(Math.abs(dragTiltFromVelocity(50, DT))).toBeLessThanOrEqual(DRAG_TILT_CAP);
  });

  it("damps proportionally with the scale argument", () => {
    const full = dragTiltFromVelocity(8, DT, 1);
    const half = dragTiltFromVelocity(8, DT, 0.5);
    expect(half).toBeCloseTo(full * 0.5, 6);
  });
});
