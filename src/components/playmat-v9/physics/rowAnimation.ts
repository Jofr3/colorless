// FLIP-style row layout animator. Each Hand/Bench wraps its children in
// a div whose ref is returned here; whenever layoutKey changes (cards
// added, reordered, or a drop preview slot inserted), this hook reads the
// previous and current bounding rects of every [data-layout-card] child
// and tweens the difference. Cards mid-release retain their in-flight
// transform — see C5 in the review for why we don't blanket-kill tweens.

import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { BALATRO_LAYOUT_DURATION, type ReleaseRectsRef } from "../types";
import {
  animateReleaseToElement,
  hasActiveReleaseAnimation,
  stopBalatroReleaseAnimation,
} from "./releaseAnimation";

function layoutRotationFromDelta(dx: number) {
  // Row previews can retarget several times during one drag. Keep their sway
  // gentler than a release throw so re-sorts slide instead of twitching.
  return Math.max(-3, Math.min(3, dx * 0.012));
}

export function useBalatroRowAnimation(layoutKey: string, releaseRectsRef?: ReleaseRectsRef) {
  const rowRef = useRef<HTMLDivElement>(null);
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const hasMeasuredRef = useRef(false);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const elements = Array.from(row.querySelectorAll<HTMLElement>("[data-layout-card]"));
    const previousRects = previousRectsRef.current;
    const liveRects = new Map<string, { rect: DOMRect; isAnimating: boolean; rotation: number }>();
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
      liveRects.set(id, {
        rect: element.getBoundingClientRect(),
        isAnimating: gsap.isTweening(element) || Boolean(transform && transform !== "none"),
        rotation: Number(gsap.getProperty(element, "rotation")) || 0,
      });
    }

    for (const element of elements) {
      if (releasingElements.has(element)) continue;
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
      return;
    }

    for (const element of elements) {
      const id = element.dataset.layoutCard;
      if (!id) continue;
      // Cards mid-release continue toward their original target. Don't kick
      // off a competing FLIP tween or the back.out fallback for them.
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
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      // Balatro's Moveable keeps a visible transform (VT) springing toward the
      // target transform (T). If a preview retargets mid-animation, continue
      // from the current visual rect instead of snapping back to the old slot.
      const rotation = liveRect?.isAnimating ? liveRect.rotation : layoutRotationFromDelta(dx);
      gsap.fromTo(
        element,
        { x: dx, y: dy, rotation },
        {
          x: 0,
          y: 0,
          rotation: 0,
          duration: BALATRO_LAYOUT_DURATION,
          ease: "power3.out",
          overwrite: "auto",
        },
      );
    }

    previousRectsRef.current = nextRects;
  }, [layoutKey, releaseRectsRef]);

  return rowRef;
}
