// Balatro-style row layout animator. Each Hand/Bench wraps its children in
// a div whose ref is returned here; whenever layoutKey changes (cards
// added, reordered, or a drop preview slot inserted), this hook reads the
// previous and current bounding rects of every [data-layout-card] child.
// Instead of a fixed-duration FLIP tween, cards now chase their new target
// with the same Moveable:move_xy / move_r spring Balatro uses while the
// dragged card re-sorts its source CardArea (see balatro-source/cardarea.lua
// and engine/moveable.lua). Cards mid-release retain their in-flight
// transform — see C5 in the review for why we don't blanket-kill tweens.

import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { getBalatroHoverTuning } from "../../tcg/balatroTuning";
import { prefersReducedMotion } from "../../tcg/prefersReducedMotion";
import type { ReleaseRectsRef } from "../types";
import {
  animateReleaseToElement,
  hasActiveReleaseAnimation,
  stopBalatroReleaseAnimation,
} from "./releaseAnimation";

const BALATRO_LAYOUT_CARD_W = (2.4 * 35) / 41;
const BALATRO_LAYOUT_MAX_VELOCITY = 70;
const BALATRO_LAYOUT_INITIAL_DT = 1 / 60;
const BALATRO_LAYOUT_MAX_DURATION = 1.15;

interface BalatroLayoutSpringState {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
  rotationVelocity: number;
  unit: number;
}

interface BalatroLayoutMotion {
  xPx: number;
  yPx: number;
  velocityXPx?: number;
  velocityYPx?: number;
  rotation?: number;
  rotationVelocity?: number;
}

interface BalatroRowAnimationOptions {
  layoutStaggerMs?: number;
  layoutStaggerMaxMs?: number;
  layoutStaggerOriginIndex?: number | null;
}

function finiteNumber(value: number | undefined, fallback = 0) {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeStaggerOriginIndex(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
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

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

const layoutAnimationCleanups = new WeakMap<HTMLElement, (clearTransform?: boolean) => void>();
const layoutAnimationStates = new WeakMap<HTMLElement, BalatroLayoutSpringState>();

function getActiveLayoutAnimationState(element: HTMLElement) {
  return layoutAnimationStates.get(element);
}

function stopBalatroLayoutAnimation(element: HTMLElement, clearTransform = false) {
  layoutAnimationCleanups.get(element)?.(clearTransform);
}

function animateBalatroLayoutToElement(
  element: HTMLElement,
  motion: BalatroLayoutMotion,
  startDelayMs = 0,
) {
  stopBalatroLayoutAnimation(element);

  const targetRect = element.getBoundingClientRect();
  if (targetRect.width <= 0 || targetRect.height <= 0 || prefersReducedMotion()) {
    layoutAnimationCleanups.delete(element);
    layoutAnimationStates.delete(element);
    gsap.set(element, { x: 0, y: 0, rotation: 0, clearProps: "transform,transformOrigin,willChange" });
    return;
  }

  const tuning = getBalatroHoverTuning();
  const unit = Math.max(1, targetRect.width / BALATRO_LAYOUT_CARD_W);
  const state: BalatroLayoutSpringState = {
    x: finiteNumber(motion.xPx / unit),
    y: finiteNumber(motion.yPx / unit),
    velocityX: finiteNumber(motion.velocityXPx) / unit,
    velocityY: finiteNumber(motion.velocityYPx) / unit,
    rotation: finiteNumber(motion.rotation),
    rotationVelocity: finiteNumber(motion.rotationVelocity),
    unit,
  };
  const startDelaySeconds = Math.max(0, finiteNumber(startDelayMs) / 1000);
  const startTime = performance.now() / 1000 + startDelaySeconds;
  let lastTime = startTime;
  let settledFrames = 0;
  let active = true;

  const applyTransform = () => {
    gsap.set(element, {
      x: state.x * state.unit,
      y: state.y * state.unit,
      rotation: radiansToDegrees(state.rotation),
    });
  };

  const cleanup = (clearTransform = false) => {
    if (!active) return;
    active = false;
    gsap.ticker.remove(tick);
    layoutAnimationCleanups.delete(element);
    if (layoutAnimationStates.get(element) === state) layoutAnimationStates.delete(element);
    if (clearTransform) gsap.set(element, { clearProps: "transform,transformOrigin,willChange" });
  };

  const finish = () => {
    cleanup(false);
    gsap.set(element, { x: 0, y: 0, rotation: 0, clearProps: "transform,transformOrigin,willChange" });
  };

  const tick = () => {
    if (!element.isConnected) {
      cleanup(false);
      return;
    }

    const now = performance.now() / 1000;
    if (now < startTime) return;

    const realDt = clampNumber(now - lastTime, 0, 0.05) || BALATRO_LAYOUT_INITIAL_DT;
    const moveDt = Math.min(1 / 20, realDt);
    lastTime = now;

    // Mirrors Balatro's Moveable:move_xy. G.exp_times.xy is exp(-50*real_dt),
    // then the target displacement is scaled by 35*move_dt before VT advances.
    const safeRealDt = Math.max(realDt, 1 / 1000);
    const xyEase = Math.exp(-tuning.releaseXyEase * realDt);
    const xySpringStep = ((1 - xyEase) / safeRealDt) * tuning.releaseXyAccel * moveDt;
    state.velocityX = xyEase * state.velocityX + xySpringStep * (0 - state.x);
    state.velocityY = xyEase * state.velocityY + xySpringStep * (0 - state.y);

    const maxVelocity = BALATRO_LAYOUT_MAX_VELOCITY / BALATRO_LAYOUT_INITIAL_DT;
    const clampedVelocity = clampVectorMagnitude(state.velocityX, state.velocityY, maxVelocity);
    state.velocityX = clampedVelocity.x;
    state.velocityY = clampedVelocity.y;
    state.x += state.velocityX * realDt;
    state.y += state.velocityY * realDt;

    // Mirrors Moveable:move_r: target rotation = card.T.r + 0.015*vel.x/dt.
    // The fan/card.T.r part is applied by the nested row-face transform; this
    // outer wrapper contributes only the velocity-fed sway toward zero.
    const desiredRotation = tuning.releaseRotationFromXVelocity * state.velocityX;
    const rotationEase = Math.exp(-tuning.releaseRotationEase * realDt);
    state.rotationVelocity =
      rotationEase * state.rotationVelocity +
      ((1 - rotationEase) / safeRealDt) * (desiredRotation - state.rotation);
    state.rotation += state.rotationVelocity * realDt;

    applyTransform();

    const positionSettled =
      Math.hypot(state.x, state.y) * state.unit < 0.35 &&
      Math.hypot(state.velocityX, state.velocityY) * state.unit < 0.18 / BALATRO_LAYOUT_INITIAL_DT;
    const rotationSettled =
      Math.abs(state.rotation) < 0.0015 &&
      Math.abs(state.rotationVelocity) < 0.0015 / BALATRO_LAYOUT_INITIAL_DT;
    settledFrames = positionSettled && rotationSettled ? settledFrames + 1 : 0;

    if (settledFrames >= 2 || now - startTime > BALATRO_LAYOUT_MAX_DURATION) finish();
  };

  layoutAnimationStates.set(element, state);
  layoutAnimationCleanups.set(element, cleanup);
  gsap.set(element, {
    transformOrigin: "center center",
    force3D: true,
    willChange: "transform",
  });
  applyTransform();
  gsap.ticker.add(tick);
}

export function useBalatroRowAnimation(
  layoutKey: string,
  releaseRectsRef?: ReleaseRectsRef,
  options?: BalatroRowAnimationOptions,
) {
  const rowRef = useRef<HTMLDivElement>(null);
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const previousStaggerOriginIndexRef = useRef<number | null>(null);
  const hasMeasuredRef = useRef(false);
  const layoutStaggerMs = Math.max(0, finiteNumber(options?.layoutStaggerMs, 0));
  const layoutStaggerMaxMs = Math.max(
    0,
    finiteNumber(options?.layoutStaggerMaxMs, Number.POSITIVE_INFINITY),
  );
  const layoutStaggerOriginIndex = normalizeStaggerOriginIndex(options?.layoutStaggerOriginIndex);

  useLayoutEffect(() => {
    // layoutKey intentionally acts as a React-trigger token for a fresh DOM
    // measurement pass; read it so hook linters don't treat it as accidental.
    void layoutKey;

    const rememberStaggerOrigin = () => {
      previousStaggerOriginIndexRef.current = layoutStaggerOriginIndex;
    };
    const row = rowRef.current;
    if (!row) {
      rememberStaggerOrigin();
      return;
    }

    const elements = Array.from(row.querySelectorAll<HTMLElement>("[data-layout-card]"));
    const effectiveStaggerOriginIndex = previousStaggerOriginIndexRef.current ?? layoutStaggerOriginIndex;
    const elementIndexes = new Map(elements.map((element, index) => [element, index]));
    const layoutStaggerDelayForElement = (element: HTMLElement) => {
      if (layoutStaggerMs <= 0 || effectiveStaggerOriginIndex === null) return 0;

      const elementIndex = elementIndexes.get(element);
      if (elementIndex === undefined) return 0;

      const distanceFromGap =
        elementIndex >= effectiveStaggerOriginIndex
          ? elementIndex - effectiveStaggerOriginIndex
          : effectiveStaggerOriginIndex - elementIndex - 1;
      return Math.min(Math.max(0, distanceFromGap) * layoutStaggerMs, layoutStaggerMaxMs);
    };
    const previousRects = previousRectsRef.current;
    const liveRects = new Map<
      string,
      {
        rect: DOMRect;
        isAnimating: boolean;
        rotation: number;
        rotationVelocity: number;
        velocityXPx: number;
        velocityYPx: number;
      }
    >();
    const nextRects = new Map<string, DOMRect>();
    // Cards mid-release should not have their tween killed/cleared by the row
    // layout pass — that would fire the release's onComplete (deleting its
    // entry from releaseRectsRef) and then the new-mount path below would find
    // nothing to read, falling back to the back.out(1.7) snap.
    const releasingElements = new Set<HTMLElement>();
    for (const element of elements) {
      if (hasActiveReleaseAnimation(element)) releasingElements.add(element);
    }

    for (const element of elements) {
      const id = element.dataset.layoutCard;
      if (!id) continue;
      const transform = element.style.transform;
      const activeLayoutState = getActiveLayoutAnimationState(element);
      liveRects.set(id, {
        rect: element.getBoundingClientRect(),
        isAnimating: Boolean(activeLayoutState) || gsap.isTweening(element) || Boolean(transform && transform !== "none"),
        rotation: activeLayoutState?.rotation ?? degreesToRadians(Number(gsap.getProperty(element, "rotation")) || 0),
        rotationVelocity: activeLayoutState?.rotationVelocity ?? 0,
        velocityXPx: activeLayoutState ? activeLayoutState.velocityX * activeLayoutState.unit : 0,
        velocityYPx: activeLayoutState ? activeLayoutState.velocityY * activeLayoutState.unit : 0,
      });
    }

    for (const element of elements) {
      if (releasingElements.has(element)) continue;
      stopBalatroLayoutAnimation(element);
      stopBalatroReleaseAnimation(element);
      gsap.killTweensOf(element);
      gsap.set(element, { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 });
    }

    for (const element of elements) {
      const id = element.dataset.layoutCard;
      if (!id) continue;
      // Releasing cards keep their in-flight transform; recording their
      // bounding rect post-tween would corrupt the FLIP "next" rect for the
      // surrounding cards. Use the layout-target rect implied by previousRect
      // (which was measured at the previous layout) instead.
      if (releasingElements.has(element)) {
        const cached = previousRects.get(id);
        if (cached) nextRects.set(id, cached);
        continue;
      }
      nextRects.set(id, element.getBoundingClientRect());
    }

    if (!hasMeasuredRef.current) {
      previousRectsRef.current = nextRects;
      hasMeasuredRef.current = true;
      rememberStaggerOrigin();
      return;
    }

    for (const element of elements) {
      const id = element.dataset.layoutCard;
      if (!id) continue;
      // Cards mid-release continue toward their original target. Don't kick
      // off a competing layout spring or the back.out fallback for them.
      if (releasingElements.has(element)) continue;

      const previousRect = previousRects.get(id);
      const nextRect = nextRects.get(id);
      if (!nextRect) continue;

      if (!previousRect) {
        const releaseMotion = releaseRectsRef?.current.get(id);

        if (releaseMotion) {
          animateReleaseToElement(element, releaseMotion, () => releaseRectsRef?.current.delete(id));
        } else {
          gsap.fromTo(
            element,
            { opacity: 0, scale: 0.9, y: 12, rotation: -2 },
            {
              opacity: 1,
              scale: 1,
              y: 0,
              rotation: 0,
              duration: 0.32,
              ease: "back.out(1.7)",
              overwrite: "auto",
            },
          );
        }
        continue;
      }

      const liveRect = liveRects.get(id);
      const fromRect = liveRect?.isAnimating ? liveRect.rect : previousRect;
      const dx = fromRect.left - nextRect.left;
      const dy = fromRect.top - nextRect.top;

      // Balatro's Moveable keeps a visible transform (VT) springing toward the
      // target transform (T). If a preview retargets mid-animation, continue
      // from the current visual rect and carry its velocity instead of
      // snapping back to the old slot.
      const velocityXPx = liveRect?.velocityXPx ?? 0;
      const velocityYPx = liveRect?.velocityYPx ?? 0;
      const rotation = liveRect?.isAnimating ? liveRect.rotation : 0;
      const rotationVelocity = liveRect?.rotationVelocity ?? 0;
      const shouldAnimate =
        Math.abs(dx) >= 0.5 ||
        Math.abs(dy) >= 0.5 ||
        Math.hypot(velocityXPx, velocityYPx) >= 0.5 ||
        Math.abs(rotation) >= 0.001;
      if (!shouldAnimate) {
        gsap.set(element, { clearProps: "transform,transformOrigin,willChange" });
        continue;
      }

      animateBalatroLayoutToElement(
        element,
        {
          xPx: dx,
          yPx: dy,
          velocityXPx,
          velocityYPx,
          rotation,
          rotationVelocity,
        },
        layoutStaggerDelayForElement(element),
      );
    }

    previousRectsRef.current = nextRects;
    rememberStaggerOrigin();
  }, [layoutKey, releaseRectsRef, layoutStaggerMs, layoutStaggerMaxMs, layoutStaggerOriginIndex]);

  return rowRef;
}
