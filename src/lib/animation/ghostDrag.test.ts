import { describe, expect, it } from "vitest";
import { type GhostFeel, type GhostState, stepGhostPhysics } from "./ghostDrag";

const FEEL: GhostFeel = {
  pickupScale: 1.1,
  pickupLiftPx: 14,
  acceptedScale: 0.5,
  releaseMs: 280,
  releaseSlackMs: 120,
  pickupJuice: { amount: 0.05, rotation: 0.025 },
  dragThresholdPx: 5,
};

function state(over: Partial<GhostState> = {}): GhostState {
  return {
    reduced: false,
    pointer: { x: 100, y: 100 },
    grab: { x: 0, y: 0 },
    cur: { x: 100, y: 100, rot: 0 },
    vel: { x: 0, y: 0, rot: 0 },
    emph: 1,
    lift: 0,
    opacity: 1,
    juice: null,
    releasing: false,
    releaseCenter: { x: 0, y: 0 },
    accepted: false,
    lastFrame: 0,
    ...over,
  };
}

describe("stepGhostPhysics", () => {
  it("eases emphasis, lift and scale toward the pickup targets (reduced motion snaps in one step)", () => {
    const s = state({ reduced: true });
    const frame = stepGhostPhysics(s, FEEL, 16);
    expect(s.emph).toBeCloseTo(FEEL.pickupScale);
    expect(s.lift).toBeCloseTo(FEEL.pickupLiftPx);
    expect(s.opacity).toBe(1);
    expect(frame.scale).toBeCloseTo(FEEL.pickupScale);
    expect(s.juice).toBeNull(); // reduced motion drops the juice pop
    expect(s.lastFrame).toBe(16); // advances the frame clock
  });

  it("shrinks and fades toward the target on an accepted release", () => {
    const s = state({ reduced: true, releasing: true, accepted: true, emph: 1.1, lift: 14 });
    stepGhostPhysics(s, FEEL, 16);
    expect(s.emph).toBeCloseTo(FEEL.acceptedScale);
    expect(s.lift).toBeCloseTo(0);
    expect(s.opacity).toBeCloseTo(0);
  });

  it("returns to full scale and stays opaque on a rejected release (spring-home)", () => {
    const s = state({ reduced: true, releasing: true, accepted: false, emph: 1.1, opacity: 1 });
    stepGhostPhysics(s, FEEL, 16);
    expect(s.emph).toBeCloseTo(1);
    expect(s.opacity).toBe(1); // not accepted → never fades
  });

  it("springs the position toward the pointer (minus the grab offset) while held", () => {
    const s = state({
      cur: { x: 0, y: 0, rot: 0 },
      pointer: { x: 100, y: 0 },
      grab: { x: 0, y: 0 },
    });
    const frame = stepGhostPhysics(s, FEEL, 16);
    expect(s.cur.x).toBeGreaterThan(0); // moved toward the target...
    expect(s.cur.x).toBeLessThanOrEqual(100); // ...but not overshooting it in one step
    expect(frame.cx).toBe(s.cur.x);
  });

  it("springs toward the release centre once released", () => {
    const s = state({
      releasing: true,
      cur: { x: 0, y: 0, rot: 0 },
      releaseCenter: { x: 200, y: 0 },
      pointer: { x: 0, y: 0 },
    });
    stepGhostPhysics(s, FEEL, 16);
    expect(s.cur.x).toBeGreaterThan(0); // heads for releaseCenter, not the pointer
  });

  it("clamps the rendered scale to a floor so the ghost never inverts", () => {
    const s = state({ reduced: true, releasing: true, accepted: true, emph: 0.005 });
    const frame = stepGhostPhysics(s, { ...FEEL, acceptedScale: 0 }, 16);
    expect(s.emph).toBeCloseTo(0);
    expect(frame.scale).toBe(0.01);
  });
});
