// Shared physics for a body-level "ghost" drag: a cloned element that spring-
// follows the pointer with a velocity-driven tilt, a pickup lift + scale, and a
// Balatro juice pop, then flies to a release target — shrinking and fading into
// it when the drop is accepted, or springing home when it isn't. Both the deck-
// library drag (useDeckDrag) and the deck-builder card drag (useCardDrag) run
// this exact per-frame step through useGhostDrag; only the drop resolution, the
// ghost element and the feel constants below differ between them.
//
// This module is pure — no React, no DOM — so the frame integration (the part
// most likely to silently drift between the two drags) is unit-tested. The
// useGhostDrag hook owns the element, the pointer listeners and the lifecycle.

import { evaluateJuice, type JuiceState } from "./juice";
import {
  clampVelocity,
  dragTiltFromVelocity,
  SPRING_C_ROT_DRAG,
  SPRING_MAX_DT,
  stepSpringScalar,
  stepSpringXY,
} from "./spring";

const RAD_TO_DEG = 180 / Math.PI;

/** Per-drag feel constants — the two drags differ only in these numbers. */
export interface GhostFeel {
  /** Scale while picked up (e.g. 1.1). */
  pickupScale: number;
  /** Upward lift while picked up, px (e.g. 14). */
  pickupLiftPx: number;
  /** Scale the ghost shrinks to as it lands in an accepted target. */
  acceptedScale: number;
  /** Release fly-out / spring-home duration before the ghost is removed, ms. */
  releaseMs: number;
  /** Extra slack after `releaseMs` before the backup finalize timer fires, ms
      (covers a tab going hidden mid-release, where rAF is paused). */
  releaseSlackMs: number;
  /** Pickup juice pop. */
  pickupJuice: { amount: number; rotation: number };
  /** Pointer travel before a press becomes a drag (vs. a click), px. */
  dragThresholdPx: number;
}

/** The mutable per-frame physics state stepped by {@link stepGhostPhysics}. The
    hook's live drag object extends this with element/pointer bookkeeping. */
export interface GhostState {
  /** prefers-reduced-motion: mutes tilt, snaps the emphasis eases, drops juice. */
  reduced: boolean;
  /** Latest pointer position (viewport px). */
  pointer: { x: number; y: number };
  /** Offset from the ghost centre to the grabbed point, kept under the cursor. */
  grab: { x: number; y: number };
  /** Current ghost centre + tilt (rad). */
  cur: { x: number; y: number; rot: number };
  /** Position/tilt spring velocity. */
  vel: { x: number; y: number; rot: number };
  /** Eased emphasis scale (1 at rest, pickupScale while held). */
  emph: number;
  /** Eased upward lift, px. */
  lift: number;
  /** Eased opacity (fades to 0 on an accepted landing). */
  opacity: number;
  /** Active juice pop, or null. */
  juice: JuiceState | null;
  /** True once released (flying to `releaseCenter` instead of the pointer). */
  releasing: boolean;
  /** Where the ghost springs to during the release. */
  releaseCenter: { x: number; y: number };
  /** Accepted landing (shrink + fade into the target) vs. spring-home. */
  accepted: boolean;
  /** performance.now() timestamp of the previous frame. */
  lastFrame: number;
}

/** The rendered transform for one frame (ghost centre, tilt, scale, opacity). */
export interface GhostFrame {
  cx: number;
  cy: number;
  rotDeg: number;
  scale: number;
  opacity: number;
}

/** Advance the ghost one frame: integrate the position spring toward the pointer
    (or the release centre once released), derive the tilt from the spring's own
    velocity, ease the pickup emphasis/lift/opacity toward their phase targets,
    and fold in the current juice pop. Mutates `s` and returns the transform to
    paint; `now` is a performance.now()-style millisecond clock. */
export function stepGhostPhysics(s: GhostState, feel: GhostFeel, now: number): GhostFrame {
  const dt = Math.min((now - s.lastFrame) / 1000, SPRING_MAX_DT);
  s.lastFrame = now;

  const desired = s.releasing
    ? s.releaseCenter
    : { x: s.pointer.x - s.grab.x, y: s.pointer.y - s.grab.y };
  s.cur.x = stepSpringXY(s.cur.x, desired.x, dt, s.vel, "x");
  s.cur.y = stepSpringXY(s.cur.y, desired.y, dt, s.vel, "y");

  // Drag tilt comes from the position spring's own velocity (CardView does the
  // same) — quiet at low speed, ramping to the cap on a fast throw.
  const velTilt = !s.reduced && !s.releasing ? dragTiltFromVelocity(s.vel.x, dt) : 0;
  clampVelocity(s.vel, dt);
  s.cur.rot = stepSpringScalar(s.cur.rot, velTilt, dt, SPRING_C_ROT_DRAG, s.vel, "rot");

  // Emphasis scale, lift and opacity ease toward their phase targets.
  const ease = s.reduced ? 1 : 1 - Math.exp(-14 * dt);
  const emphTarget = s.releasing ? (s.accepted ? feel.acceptedScale : 1) : feel.pickupScale;
  s.emph += (emphTarget - s.emph) * ease;
  const liftTarget = s.releasing ? 0 : feel.pickupLiftPx;
  s.lift += (liftTarget - s.lift) * ease;
  const opacityTarget = s.releasing && s.accepted ? 0 : 1;
  s.opacity += (opacityTarget - s.opacity) * (s.reduced ? 1 : 1 - Math.exp(-12 * dt));

  const juice = s.reduced ? null : evaluateJuice(s.juice, now / 1000);
  if (!juice) s.juice = null;
  const juiceScale = juice ? juice.scale : 0;
  // *2 matches move_r's juice multiplier (CardView.applyJuiceTransform).
  const juiceRot = juice ? juice.rotation * 2 : 0;

  const scale = Math.max(0.01, s.emph * (1 + juiceScale));
  const rotDeg = (s.cur.rot + juiceRot) * RAD_TO_DEG;
  return { cx: s.cur.x, cy: s.cur.y - s.lift, rotDeg, scale, opacity: s.opacity };
}
