// Release-throw physics. When a card is dropped (no valid release_on
// target, or onto a target that gets overridden by the layout), the
// visible card springs back to its target rect with velocity-fed rotation
// — this module owns that tween, the lift/restore CSS class refcounts
// that keep the card above its surrounding stack while it's in flight,
// and the React hook that wires it up to a new mount.
//
// Tuning knobs (eases, accel, rotation factor) live on the runtime panel
// via balatroTuning. CARD_W and MAX_VELOCITY are physics math (paired
// with REFERENCE_DT) rather than feel knobs and stay as code constants.

import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { getBalatroHoverTuning } from "../../tcg/balatroTuning";
import { prefersReducedMotion } from "../../tcg/prefersReducedMotion";
import type { ReleaseMotion, ReleaseRectsRef } from "../types";

// Balatro source mapping for a card released with no new release_on target:
// Controller clears states.drag.is, CardArea:align_cards immediately gives the
// card a target transform (T), then Moveable:move lets the visible transform
// (VT) spring back with velocity-fed rotation.
//
// XY/scale/rotation eases, the XY accel, and the rotation-from-velocity factor
// live in balatroTuning (BALATRO_HOVER_TUNING_DEFAULTS) so the runtime tuning
// panel can dial them. CARD_W and MAX_VELOCITY are part of the engine physics
// math (paired with REFERENCE_DT) rather than feel knobs, so they stay here.
const BALATRO_RELEASE_CARD_W = (2.4 * 35) / 41;
const BALATRO_RELEASE_MAX_VELOCITY = 70;
const BALATRO_RELEASE_INITIAL_VELOCITY_DT = 1 / 60;

function finiteNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampVectorMagnitude(x: number, y: number, maxMagnitude: number) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maxMagnitude || magnitude <= 0) return { x, y };

  return {
    x: (x / magnitude) * maxMagnitude,
    y: (y / magnitude) * maxMagnitude,
  };
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

// Refcount lift toggles per ancestor. Two concurrent releases on cards in the
// same row used to flicker because the first one's restore would strip the
// shared ancestor's lift class while the second was still mid-flight. We now
// increment on add and only remove the class once the count drops to zero.
//
// The leaf flag is genuinely per-card (only the dragged card needs
// pointer-events:none), so it stays owned by each lift's own restore.
const liftRefcounts = new Map<HTMLElement, number>();
const liftRelativeRefcounts = new Map<HTMLElement, number>();

function addLift(element: HTMLElement) {
  const count = (liftRefcounts.get(element) ?? 0) + 1;
  liftRefcounts.set(element, count);
  if (count === 1) element.classList.add("balatro-release-lift");
}

function removeLift(element: HTMLElement) {
  const count = (liftRefcounts.get(element) ?? 0) - 1;
  if (count <= 0) {
    liftRefcounts.delete(element);
    element.classList.remove("balatro-release-lift");
  } else {
    liftRefcounts.set(element, count);
  }
}

function addLiftRelative(element: HTMLElement) {
  const count = (liftRelativeRefcounts.get(element) ?? 0) + 1;
  liftRelativeRefcounts.set(element, count);
  if (count === 1) element.classList.add("balatro-release-lift--needs-relative");
}

function removeLiftRelative(element: HTMLElement) {
  const count = (liftRelativeRefcounts.get(element) ?? 0) - 1;
  if (count <= 0) {
    liftRelativeRefcounts.delete(element);
    element.classList.remove("balatro-release-lift--needs-relative");
  } else {
    liftRelativeRefcounts.set(element, count);
  }
}

function liftReleaseAnimationStack(element: HTMLElement) {
  // Toggle CSS classes (defined in index.css) instead of mutating inline
  // styles. React can re-render between lift and restore; the previous
  // inline-restore approach captured `current.style.position` (often empty
  // because positioning came from a CSS class) and wrote it back, which —
  // if React or dnd-kit had set inline styles in the interim — would wipe
  // those styles. Class toggles are idempotent and survive reconciliation.
  const lifted: Array<{
    element: HTMLElement;
    isLeaf: boolean;
    addedRelative: boolean;
  }> = [];
  const root = element.closest<HTMLElement>(".playmat-wrapper");
  let current: HTMLElement | null = element;

  while (current && current !== root && current !== document.body) {
    // Read computed.position BEFORE addLift so we don't see this lift's own
    // applied class. Use raw classList to detect a sibling lift that already
    // applied --needs-relative (which would otherwise leave the second lift
    // thinking the element is "naturally" relative and skip the refcount
    // increment, breaking the symmetry between add and remove).
    const alreadyNeedsRelative = current.classList.contains(
      "balatro-release-lift--needs-relative",
    );
    const computed = getComputedStyle(current);
    const needsRelative = alreadyNeedsRelative || computed.position === "static";
    const isLeaf = current === element;

    addLift(current);
    if (needsRelative) addLiftRelative(current);
    if (isLeaf) current.classList.add("balatro-release-lift--leaf");

    lifted.push({ element: current, isLeaf, addedRelative: needsRelative });
    current = current.parentElement;
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;

    for (let index = lifted.length - 1; index >= 0; index -= 1) {
      const item = lifted[index];
      removeLift(item.element);
      if (item.addedRelative) removeLiftRelative(item.element);
      if (item.isLeaf) {
        item.element.classList.remove("balatro-release-lift--leaf");
      }
    }
  };
}

const releaseAnimationCleanups = new WeakMap<HTMLElement, () => void>();

export function stopBalatroReleaseAnimation(element: HTMLElement) {
  releaseAnimationCleanups.get(element)?.();
}

export function hasActiveReleaseAnimation(element: HTMLElement) {
  return releaseAnimationCleanups.has(element);
}

export function animateReleaseToElement(
  element: HTMLElement,
  releaseMotion: ReleaseMotion,
  onComplete?: () => void,
) {
  stopBalatroReleaseAnimation(element);

  const releaseRect = releaseMotion.rect;
  // Row cards can carry their Balatro fan/arc on a nested transformed face.
  // Use that visual face as the release target so a card released into a
  // lifted/rotated hand slot starts and settles at the same rendered center.
  const targetElement = element.querySelector<HTMLElement>("[data-balatro-release-target]") ?? element;
  const targetRect = targetElement.getBoundingClientRect();
  if (targetRect.width <= 0 || targetRect.height <= 0 || prefersReducedMotion()) {
    releaseAnimationCleanups.delete(element);
    onComplete?.();
    return;
  }

  // Capture tuning at start; release animations are short-lived so it's fine
  // to use a snapshot rather than re-reading every tick.
  const tuning = getBalatroHoverTuning();
  const restoreReleaseStack = liftReleaseAnimationStack(element);
  const unit = Math.max(1, targetRect.width / BALATRO_RELEASE_CARD_W);
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  const releaseCenterX = releaseRect.left + releaseRect.width / 2;
  const releaseCenterY = releaseRect.top + releaseRect.height / 2;
  let x = finiteNumber((releaseCenterX - targetCenterX) / unit);
  let y = finiteNumber((releaseCenterY - targetCenterY) / unit);
  let scaleX = finiteNumber(releaseRect.width / Math.max(targetRect.width, 1), 1);
  let scaleY = finiteNumber(releaseRect.height / Math.max(targetRect.height, 1), 1);
  let scaleVelocityX = 0;
  let scaleVelocityY = 0;

  // Velocities are in card-units / second (framerate-independent). The legacy
  // form pre-multiplied by 1/60 dt to mimic Balatro's per-frame step; we now
  // integrate with x += v * dt instead.
  const maxReleaseVelocityPerSec = BALATRO_RELEASE_MAX_VELOCITY / BALATRO_RELEASE_INITIAL_VELOCITY_DT;
  const initialVelocity = clampVectorMagnitude(
    finiteNumber(releaseMotion.velocityX / unit),
    finiteNumber(releaseMotion.velocityY / unit),
    maxReleaseVelocityPerSec,
  );
  let velocityX = initialVelocity.x;
  let velocityY = initialVelocity.y;
  // velocityX is already px/sec, so tuning.releaseRotationFromXVelocity * velocityX
  // matches Balatro's 0.015 * vel.x/dt.
  let rotation = tuning.releaseRotationFromXVelocity * velocityX;
  let rotationVelocity = 0;
  let lastTime = performance.now() / 1000;
  const startTime = lastTime;
  let settledFrames = 0;
  let active = true;

  const applyTransform = () => {
    // Per-tick writes only — transformOrigin/willChange/force3D are static
    // for the lifetime of this tween and are set once below before the
    // ticker starts. Setting them every frame churns style invalidation
    // for no behavioral change.
    gsap.set(element, {
      x: x * unit,
      y: y * unit,
      scaleX,
      scaleY,
      rotation: radiansToDegrees(rotation),
    });
  };

  const cleanup = (clearTransform: boolean, completeRelease = false) => {
    if (!active) return;
    active = false;
    gsap.ticker.remove(tick);
    releaseAnimationCleanups.delete(element);
    restoreReleaseStack();
    if (clearTransform) gsap.set(element, { clearProps: "transform,transformOrigin,willChange" });
    // The non-clearing path is reached only via finish(), which then writes
    // its own reset transform with clearProps "transform,transformOrigin,
    // willChange" — so willChange is always cleaned up regardless of which
    // branch we take here.
    if (completeRelease) onComplete?.();
  };

  const finish = () => {
    cleanup(false);
    gsap.set(element, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, clearProps: "transform,transformOrigin,willChange" });
    onComplete?.();
  };

  const tick = () => {
    if (!element.isConnected) {
      cleanup(false, true);
      return;
    }

    const now = performance.now() / 1000;
    const realDt = clampNumber(now - lastTime, 0, 0.05) || BALATRO_RELEASE_INITIAL_VELOCITY_DT;
    const moveDt = Math.min(1 / 20, realDt);
    lastTime = now;

    // Framerate-independent semi-implicit Euler. Velocities live in
    // card-units/sec (or radians/sec); (1 - ease) / dt converts the dt-encoded
    // exponential blend into a per-second spring gain.
    const safeRealDt = Math.max(realDt, 1 / 1000);
    const xyEase = Math.exp(-tuning.releaseXyEase * realDt);
    const xySpringStep = ((1 - xyEase) / safeRealDt) * tuning.releaseXyAccel * moveDt;
    velocityX = xyEase * velocityX + xySpringStep * (0 - x);
    velocityY = xyEase * velocityY + xySpringStep * (0 - y);

    const maxVelocity = BALATRO_RELEASE_MAX_VELOCITY / BALATRO_RELEASE_INITIAL_VELOCITY_DT;
    const clampedVelocity = clampVectorMagnitude(velocityX, velocityY, maxVelocity);
    velocityX = clampedVelocity.x;
    velocityY = clampedVelocity.y;
    x += velocityX * realDt;
    y += velocityY * realDt;

    const scaleEase = Math.exp(-tuning.releaseScaleEase * realDt);
    const scaleSpringGain = (1 - scaleEase) / safeRealDt;
    scaleVelocityX = scaleEase * scaleVelocityX + scaleSpringGain * (1 - scaleX);
    scaleVelocityY = scaleEase * scaleVelocityY + scaleSpringGain * (1 - scaleY);
    scaleX += scaleVelocityX * realDt;
    scaleY += scaleVelocityY * realDt;

    // Moveable:move_r in balatro-source/engine/moveable.lua:
    // des_r = self.T.r + 0.015*vel.x/dt + juice.r*2
    // velocityX is already in units/sec, so tuning.releaseRotationFromXVelocity *
    // velocityX matches Balatro's 0.015 * vel.x/dt with the user-tunable factor.
    const desiredRotation = tuning.releaseRotationFromXVelocity * velocityX;
    const rotationEase = Math.exp(-tuning.releaseRotationEase * realDt);
    rotationVelocity =
      rotationEase * rotationVelocity +
      ((1 - rotationEase) / safeRealDt) * (desiredRotation - rotation);
    rotation += rotationVelocity * realDt;

    applyTransform();

    // Velocity thresholds scaled from per-frame (legacy 60Hz) to per-second so
    // the spring still settles after the integrator switch (multiply ~60x).
    const positionSettled =
      Math.hypot(x, y) * unit < 0.45 &&
      Math.hypot(velocityX, velocityY) * unit < (0.18 / BALATRO_RELEASE_INITIAL_VELOCITY_DT);
    const scaleSettled =
      Math.abs(scaleX - 1) < 0.0015 &&
      Math.abs(scaleY - 1) < 0.0015 &&
      Math.abs(scaleVelocityX) < 0.0015 / BALATRO_RELEASE_INITIAL_VELOCITY_DT &&
      Math.abs(scaleVelocityY) < 0.0015 / BALATRO_RELEASE_INITIAL_VELOCITY_DT;
    const rotationSettled =
      Math.abs(rotation) < 0.0015 &&
      Math.abs(rotationVelocity) < 0.0015 / BALATRO_RELEASE_INITIAL_VELOCITY_DT;
    settledFrames = positionSettled && scaleSettled && rotationSettled ? settledFrames + 1 : 0;

    if (settledFrames >= 2 || now - startTime > 1.4) finish();
  };

  releaseAnimationCleanups.set(element, () => cleanup(true, true));
  // Set static transform hints (transformOrigin / force3D / willChange) once
  // before the tween starts. Previously the per-tick applyTransform() wrote
  // these every frame; they don't change for the lifetime of the release
  // tween and re-writing them just churns style invalidation. cleanup()'s
  // clearProps still wipes them on interrupt or finish.
  gsap.set(element, {
    transformOrigin: "center center",
    force3D: true,
    willChange: "transform",
  });
  applyTransform();
  gsap.ticker.add(tick);
}

export function useBalatroReleaseAnimation(
  cardId: string | undefined,
  releaseRectsRef?: ReleaseRectsRef,
  releaseAnimationKey = 0,
) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // releaseAnimationKey intentionally retriggers this effect when a drop
    // reuses the same card id/target but has a fresh release rect.
    void releaseAnimationKey;

    if (!cardId || !releaseRectsRef) return;

    const releaseMotion = releaseRectsRef.current.get(cardId);
    const element = ref.current;
    if (!releaseMotion || !element) return;

    animateReleaseToElement(element, releaseMotion, () => releaseRectsRef.current.delete(cardId));
  }, [cardId, releaseRectsRef, releaseAnimationKey]);

  return ref;
}
