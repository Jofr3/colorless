import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./scrollArea.css";
import { fadeMaskDataUrl } from "./scrollFadeMask";

const MIN_THUMB = 32; // px — keep the thumb grabbable on very long lists

/** A vertical scroll box whose scrollbar is a custom overlay rendered OUTSIDE
    the scrolling content — a single draggable thumb floating in the right
    gutter. Because it's absolutely positioned the native bar is hidden
    (`.scrollbar-none` in scrollArea.css) and the content never reflows to make
    room for it. Wheel/trackpad/keyboard still drive the real overflow. */
export function ScrollArea({
  children,
  className,
  outerClassName,
  trackTop = 0,
  trackBottom = 0,
  fadeTop = 0,
  fadeBottom = 0,
  maskRadius = 0,
  fadeTopOnScroll = false,
}: {
  children: ReactNode;
  /** Applied to the scrolling element (padding, negative margins, etc.). */
  className?: string;
  /** Applied to the outer wrapper — use for spacing that should sit OUTSIDE the
      scroll (e.g. a fixed gap below the toolbar that doesn't scroll away). */
  outerClassName?: string;
  /** Inset (px) of the scrollbar from the top/bottom of the viewport, so it can
      line up with the content (e.g. start at the first card, not the top
      padding) instead of spanning the raw scroll box. */
  trackTop?: number;
  trackBottom?: number;
  /** Height (px) of a soft fade-out at the top edge, so content dissolves to
      transparent as it scrolls up under whatever sits above (e.g. a search bar)
      instead of hard-cutting. Rendered by a fragment shader (see
      {@link fadeMaskDataUrl}) into the viewport's `mask-image`. */
  fadeTop?: number;
  /** Like {@link fadeTop}, but feathering the bottom edge. */
  fadeBottom?: number;
  /** Corner radius (px) of the masked viewport, so the scroll box clips on soft
      rounded corners instead of a hard 90°. Pairs with the feather above. */
  maskRadius?: number;
  /** Ramp the top feather with scroll: 0 at rest (so the first row sits crisp and
      flush at the top edge) growing to {@link fadeTop} over the first `fadeTop` px
      of scroll, so content only dissolves once it scrolls up under the top edge.
      The bottom feather ({@link fadeBottom}) is unaffected. */
  fadeTopOnScroll?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  // Last baked edge-mask signature (size + params) — so the shader only re-bakes
  // when the box actually changes, never on every scroll event.
  const maskKey = useRef("");
  // Baked masks keyed by `${w}x${h}:${fadeTop},${fadeBottom},${radius}`. With a
  // scroll-driven top feather the top value steps through a handful of quantized
  // values, so caching avoids re-baking (toDataURL) once each has been seen.
  const maskCache = useRef<Map<string, string>>(new Map());
  const [thumb, setThumb] = useState({ height: 0, top: 0, shown: false });

  // Recompute the thumb's size/offset (relative to the rail) from scroll metrics.
  // The thumb travels the full inset track — flush to the top, no arrow zones.
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight, clientWidth } = el;
    // Edge mask (rounded corners + top/bottom feather), drawn by a fragment
    // shader. It's pinned to the viewport — independent of scroll — so it only
    // (re)bakes when the box size or params change, never per scroll frame.
    // With fadeTopOnScroll the top feather grows from 0 (flush, crisp first row)
    // to `fadeTop` over the first `fadeTop` px of scroll, quantized to 4px steps so
    // only a handful of distinct masks are ever baked (then cached below).
    const effFadeTop = fadeTopOnScroll
      ? Math.round(Math.min(fadeTop, Math.max(0, scrollTop)) / 4) * 4
      : fadeTop;
    if (effFadeTop > 0 || fadeBottom > 0 || maskRadius > 0) {
      const key = `${clientWidth}x${clientHeight}:${effFadeTop},${fadeBottom},${maskRadius}`;
      if (key !== maskKey.current && clientWidth > 0 && clientHeight > 0) {
        maskKey.current = key;
        let url = maskCache.current.get(key);
        if (url === undefined) {
          url =
            fadeMaskDataUrl({
              width: clientWidth,
              height: clientHeight,
              fadeTop: effFadeTop,
              fadeBottom,
              radius: maskRadius,
            }) ?? "";
          maskCache.current.set(key, url);
        }
        if (url) {
          el.style.maskImage = `url("${url}")`;
          el.style.setProperty("-webkit-mask-image", `url("${url}")`);
          el.style.maskSize = "100% 100%";
          el.style.setProperty("-webkit-mask-size", "100% 100%");
          el.style.maskRepeat = "no-repeat";
          el.style.setProperty("-webkit-mask-repeat", "no-repeat");
        } else if (effFadeTop > 0) {
          // No WebGL — fall back to a plain CSS gradient top feather.
          const grad = `linear-gradient(to bottom, transparent, #000 ${effFadeTop}px)`;
          el.style.maskImage = grad;
          el.style.setProperty("-webkit-mask-image", grad);
        }
      }
    }
    if (scrollHeight <= clientHeight + 1) {
      setThumb((t) => (t.shown ? { ...t, shown: false } : t));
      return;
    }
    const travel = Math.max(clientHeight - trackTop - trackBottom, MIN_THUMB);
    const height = Math.max((clientHeight / scrollHeight) * travel, MIN_THUMB);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (travel - height);
    setThumb({ height, top, shown: true });
  }, [trackTop, trackBottom, fadeTop, fadeBottom, maskRadius, fadeTopOnScroll]);

  // Track scroll position and any size change (viewport or content growth).
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(content);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  // Dragging the thumb maps pointer travel back onto scrollTop.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      const el = scrollRef.current;
      if (!d || !el) return;
      const { scrollHeight, clientHeight } = el;
      const travel = Math.max(clientHeight - trackTop - trackBottom, MIN_THUMB);
      const height = Math.max((clientHeight / scrollHeight) * travel, MIN_THUMB);
      const trackRange = travel - height;
      if (trackRange <= 0) return;
      const scrollRange = scrollHeight - clientHeight;
      el.scrollTop = d.scrollTop + ((e.clientY - d.pointerY) / trackRange) * scrollRange;
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [trackTop, trackBottom]);

  const startDrag = (e: ReactPointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { pointerY: e.clientY, scrollTop: el.scrollTop };
    document.body.style.userSelect = "none";
  };

  return (
    <div className={`relative min-h-0 flex-1${outerClassName ? ` ${outerClassName}` : ""}`}>
      <div
        ref={scrollRef}
        className={`scrollbar-none h-full overflow-y-auto overflow-x-hidden${className ? ` ${className}` : ""}`}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {/* Scrollbar rail in the right gutter — outside the scroll box, so it never
          eats content width. Inset to the track span so it lines up with the
          content; a single thumb fills it, starting flush at the top. */}
      <div
        style={{ top: trackTop, bottom: trackBottom }}
        className={`pointer-events-none absolute -right-5 w-3 transition-opacity motion-reduce:transition-none duration-150 ${
          thumb.shown ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          aria-hidden
          onPointerDown={startDrag}
          style={{ height: thumb.height, transform: `translate(-50%, ${thumb.top}px)` }}
          className="pointer-events-auto absolute left-1/2 top-0 w-1.5 cursor-grab rounded-full bg-white/20 transition-colors motion-reduce:transition-none duration-150 hover:bg-white/30 active:cursor-grabbing active:bg-white/40"
        />
      </div>
    </div>
  );
}
