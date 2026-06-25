// Shared spring physics, ported from Balatro's engine/moveable.lua and used
// identically by the simulator card layer (features/playmat/pixi/CardView.ts)
// and the decks drag (features/decks/useDeckDrag.ts). Keeping one copy here is
// the single source of truth — tuning the spring no longer has to be mirrored
// across files. See CardView.ts's header for the full Balatro source references.

// Position spring (moveable.lua:405-421 + game.lua:2618-2624).
export const SPRING_C_XY = 50; // exp damping coefficient
export const SPRING_K_XY = 35; // stiffness (the *35 factor)
export const SPRING_MAX_VEL = 70; // max_vel per frame (70*dt)
export const SPRING_MAX_DT = 1 / 30; // clamp dt so a long frame can't explode the spring
export const SPRING_C_ROT_DRAG = 20; // underdamped rotation so a fast drag overshoots then settles

// Velocity-driven drag tilt (moveable.lua:448). A power slightly above linear:
// slow drags still tilt subtly, fast throws ramp to the cap.
export const DRAG_VEL_REF = 1200; // spring velocity (px/s) at which tilt reaches the cap
export const DRAG_TILT_EXPONENT = 1.3;
export const DRAG_TILT_CAP = 0.22; // radians

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * One position-spring step on `vel[key]`, mutating it in place and returning the
 * next position. Snaps to `desired` (zeroing velocity) once both are within
 * 0.01 — exp(-50·dt) damping with a *35·dt stiffness term.
 */
export function stepSpringXY<K extends string>(
  current: number,
  desired: number,
  dt: number,
  vel: Record<K, number>,
  key: K,
): number {
  const damping = Math.exp(-SPRING_C_XY * dt);
  vel[key] = damping * vel[key] + (1 - damping) * (desired - current) * SPRING_K_XY * dt;
  const next = current + vel[key];
  if (Math.abs(next - desired) < 0.01 && Math.abs(vel[key]) < 0.01) {
    vel[key] = 0;
    return desired;
  }
  return next;
}

/**
 * One scalar-spring step (rotation/scale) on `vel[key]`. Unlike the xy spring
 * the stiffness term carries no dt factor; `coefficient` sets the damping and
 * `stiffness` (default 1) scales the restoring force. Snaps within 0.001.
 */
export function stepSpringScalar<K extends string>(
  current: number,
  desired: number,
  dt: number,
  coefficient: number,
  vel: Record<K, number>,
  key: K,
  stiffness = 1,
): number {
  const damping = Math.exp(-coefficient * dt);
  vel[key] = damping * vel[key] + (1 - damping) * (desired - current) * stiffness;
  const next = current + vel[key];
  if (Math.abs(next - desired) < 0.001 && Math.abs(vel[key]) < 0.001) {
    vel[key] = 0;
    return desired;
  }
  return next;
}

/** Cap the xy velocity magnitude to SPRING_MAX_VEL·dt, mutating in place. */
export function clampVelocity(vel: { x: number; y: number }, dt: number): void {
  const maxVel = SPRING_MAX_VEL * dt;
  const magSq = vel.x * vel.x + vel.y * vel.y;
  if (magSq > maxVel * maxVel) {
    const mag = Math.sqrt(magSq);
    vel.x = (vel.x / mag) * maxVel;
    vel.y = (vel.y / mag) * maxVel;
  }
}

/**
 * Velocity → drag-tilt radians. Read the *uncapped* xy velocity (before
 * clampVelocity) so fast drags still register. `scale` (default 1) lets a
 * caller damp the tilt for non-dragged cards (e.g. reorder siblings).
 */
export function dragTiltFromVelocity(velX: number, dt: number, scale = 1): number {
  const velSec = velX / Math.max(dt, 0.001);
  const ratio = Math.abs(velSec) / DRAG_VEL_REF;
  return clamp(
    Math.sign(velSec) * ratio ** DRAG_TILT_EXPONENT * DRAG_TILT_CAP * scale,
    -DRAG_TILT_CAP,
    DRAG_TILT_CAP,
  );
}
