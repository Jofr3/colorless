import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import CardImage from "./CardImage";
import {
  getBalatroHoverTuning,
  subscribeBalatroHoverTuning,
} from "./balatroTuning";

type CardBackTone = "blue" | "red";

// Values copied/adapted from Balatro's Card/Moveable/Sprite path:
// - globals.lua: CARD_W = 2.4*35/41
// - card.lua: Card:init() sets ambient_tilt = 0.2, T.scale = 0.95, zoom = true
// - card.lua: Card:draw() drives idle tilt with
//   G.TIMERS.REAL*(1.56 + (ID/1.14212)%1) + ID/1.35122
// - card.lua: Card:hover() -> juice_up(0.05, 0.03)
// - card.lua: Card:juice_up() multiplies both inputs by 0.4
// - moveable.lua: hover zoom adds 0.05, scale easing exp(-60*dt), rotation easing exp(-190*dt)
// - resources/shaders/dissolve.fs: bend adjusts clip-space w by the
//   mouse/idle-tilt distance from each vertex, with an extra boost near screen center.
const BALATRO_CARD_W = (2.4 * 35) / 41;
const BALATRO_CARD_BASE_SCALE = 0.95;
const BALATRO_CARD_AMBIENT_TILT = 0.2;
const BALATRO_IDLE_TILT_BASE_SPEED = 1.56;
const BALATRO_IDLE_TILT_ID_SPEED_DIVISOR = 1.14212;
const BALATRO_IDLE_TILT_ID_PHASE_DIVISOR = 1.35122;
const BALATRO_IDLE_ID_HASH_MOD = 10_000;
const BALATRO_IDLE_BEND_BASE = 0.015;
const BALATRO_IDLE_BEND_CENTER_BOOST = 0.2;
const BALATRO_IDLE_BEND_CENTER_RADIUS = 0.3;
const BALATRO_IDLE_SIZE_COMPENSATION_MAX = 4;
const MATRIX_EPSILON = 1e-8;

interface BalatroHoverCardProps {
  cardId?: string;
  back?: CardBackTone;
  renderedWidth?: number;
  alt?: string;
  priority?: boolean;
  className?: string;
  bendCenterBoost?: number;
  children?: ReactNode;
}

interface Point {
  x: number;
  y: number;
}

interface DomCard {
  token: number;
  idleSeed: number;
  host: HTMLElement;
  surface: HTMLElement;
  mouseClient: Point;
  targetHover: number;
  juiceStart: number;
  juiceSign: number;
  visibleScale: number;
  scaleVelocity: number;
  rotation: number;
  rotationVelocity: number;
  ambientTilt: number;
  bendCenterBoost?: number;
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function formatMatrixNumber(value: number) {
  const safe = Math.abs(value) < MATRIX_EPSILON ? 0 : finite(value);
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(8);
}

function makeBalatroIdleSeed(token: number) {
  // Balatro uses Node.ID, but card IDs are interleaved with many non-card
  // engine nodes. Hash the DOM registration token so adjacent cards do not get
  // adjacent tilt speeds/phases.
  let seed = Math.imul(token ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  seed ^= seed >>> 16;
  seed = Math.imul(seed, 0xc2b2ae35) >>> 0;
  seed ^= seed >>> 13;
  return 1 + (seed % BALATRO_IDLE_ID_HASH_MOD);
}

function matrix3dFromQuad(width: number, height: number, quad: [Point, Point, Point, Point]) {
  const [p0, p1, p2, p3] = quad;

  // Projective transform from the element's pixel rectangle to the projected
  // quad. CSS matrix3d stores a 2D homography as:
  // x' = (a*x + c*y + e) / (g*x + h*y + 1)
  // y' = (b*x + d*y + f) / (g*x + h*y + 1)
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;

  let a: number;
  let b: number;
  let c: number;
  let d: number;
  let e: number;
  let f: number;
  let g: number;
  let h: number;

  if (Math.abs(sx) < MATRIX_EPSILON && Math.abs(sy) < MATRIX_EPSILON) {
    a = p1.x - p0.x;
    b = p1.y - p0.y;
    c = p3.x - p0.x;
    d = p3.y - p0.y;
    e = p0.x;
    f = p0.y;
    g = 0;
    h = 0;
  } else {
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const determinant = dx1 * dy2 - dx2 * dy1;

    if (Math.abs(determinant) < MATRIX_EPSILON) {
      a = p1.x - p0.x;
      b = p1.y - p0.y;
      c = p3.x - p0.x;
      d = p3.y - p0.y;
      e = p0.x;
      f = p0.y;
      g = 0;
      h = 0;
    } else {
      g = (sx * dy2 - dx2 * sy) / determinant;
      h = (dx1 * sy - sx * dy1) / determinant;
      a = p1.x - p0.x + g * p1.x;
      b = p1.y - p0.y + g * p1.y;
      c = p3.x - p0.x + h * p3.x;
      d = p3.y - p0.y + h * p3.y;
      e = p0.x;
      f = p0.y;
    }
  }

  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const m11 = a / safeWidth;
  const m12 = b / safeWidth;
  const m14 = g / safeWidth;
  const m21 = c / safeHeight;
  const m22 = d / safeHeight;
  const m24 = h / safeHeight;

  return `matrix3d(${[
    m11, m12, 0, m14,
    m21, m22, 0, m24,
    0, 0, 1, 0,
    e, f, 0, 1,
  ].map(formatMatrixNumber).join(",")})`;
}

class BalatroDomCardAnimator {
  private readonly cards = new Map<HTMLElement, DomCard>();
  private token = 0;
  private root: HTMLElement | null = null;
  private ticking = false;
  private lastTime = 0;
  private prefersReducedMotion = false;
  private reduceMotionQuery: MediaQueryList | null = null;
  private unsubscribeTuning: (() => void) | null = null;

  register(host: HTMLElement, surface: HTMLElement, bendCenterBoost?: number) {
    this.watchReducedMotion();
    this.watchTuning();
    this.setRootFrom(host);

    const existingCard = this.cards.get(host);
    if (existingCard) {
      existingCard.bendCenterBoost = bendCenterBoost;
      if (!this.prefersReducedMotion) this.startTicker();
      return;
    }

    const token = ++this.token;
    const card: DomCard = {
      token,
      idleSeed: makeBalatroIdleSeed(token),
      host,
      surface,
      mouseClient: { x: 0, y: 0 },
      targetHover: 0,
      juiceStart: Number.NEGATIVE_INFINITY,
      juiceSign: 1,
      visibleScale: 1,
      scaleVelocity: 0,
      rotation: 0,
      rotationVelocity: 0,
      ambientTilt: BALATRO_CARD_AMBIENT_TILT,
      bendCenterBoost,
    };

    this.cards.set(host, card);
    gsap.set(surface, { "--balatro-transform": "none" });
    if (!this.prefersReducedMotion) this.startTicker();
  }

  unregister(host: HTMLElement) {
    const card = this.cards.get(host);
    if (!card) return;

    this.cards.delete(host);
    card.host.removeAttribute("data-balatro-hovered");
    gsap.set(card.host, { clearProps: "zIndex" });
    gsap.set(card.surface, { "--balatro-transform": "none" });

    if (this.cards.size === 0) {
      this.unsubscribeTuning?.();
      this.unsubscribeTuning = null;
      this.stopTicker();
    }
  }

  hover(host: HTMLElement, event: PointerEvent) {
    const card = this.cards.get(host);
    if (!card) return;

    card.mouseClient.x = event.clientX;
    card.mouseClient.y = event.clientY;

    if (this.prefersReducedMotion) {
      card.targetHover = 0;
      card.juiceStart = Number.NEGATIVE_INFINITY;
      this.clearCardTransform(card);
      return;
    }

    const tuning = getBalatroHoverTuning();
    card.targetHover = 1;
    card.juiceStart = performance.now() / 1000;
    card.juiceSign = Math.random() > 0.5 ? 1 : -1;
    // Match Moveable:juice_up — snap VT.scale to pop value, leave velocity.
    card.visibleScale = (1 - 0.6 * tuning.juiceScaleAmount) / BALATRO_CARD_BASE_SCALE;
    card.host.setAttribute("data-balatro-hovered", "true");
    gsap.set(card.host, { zIndex: 30 + card.token });
    this.startTicker();
  }

  unhover(host: HTMLElement) {
    const card = this.cards.get(host);
    if (!card) return;

    card.targetHover = 0;
    card.host.removeAttribute("data-balatro-hovered");
    this.startTicker();
  }

  move(host: HTMLElement, event: PointerEvent) {
    const card = this.cards.get(host);
    if (!card) return;

    card.mouseClient.x = event.clientX;
    card.mouseClient.y = event.clientY;
    if (card.targetHover > 0) this.startTicker();
  }

  private watchReducedMotion() {
    if (this.reduceMotionQuery || typeof window === "undefined") return;

    this.reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.prefersReducedMotion = this.reduceMotionQuery.matches;

    const updatePreference = () => {
      this.prefersReducedMotion = this.reduceMotionQuery?.matches ?? false;
      if (this.prefersReducedMotion) {
        for (const card of this.cards.values()) {
          card.targetHover = 0;
          card.visibleScale = 1;
          card.scaleVelocity = 0;
          card.rotation = 0;
          card.rotationVelocity = 0;
          card.juiceStart = Number.NEGATIVE_INFINITY;
          card.host.removeAttribute("data-balatro-hovered");
          gsap.set(card.host, { clearProps: "zIndex" });
          this.clearCardTransform(card);
        }
        this.stopTicker();
      } else if (this.cards.size > 0) {
        this.startTicker();
      }
    };

    this.reduceMotionQuery.addEventListener("change", updatePreference);
  }

  private watchTuning() {
    if (this.unsubscribeTuning) return;
    this.unsubscribeTuning = subscribeBalatroHoverTuning(() => this.startTicker());
  }

  private setRootFrom(element: HTMLElement) {
    this.root = element.closest<HTMLElement>(".playmat-wrapper") ?? document.body;
  }

  private startTicker() {
    if (this.ticking) return;
    this.ticking = true;
    this.lastTime = 0;
    gsap.ticker.add(this.frame);
  }

  private stopTicker() {
    if (!this.ticking) return;
    gsap.ticker.remove(this.frame);
    this.ticking = false;
    this.lastTime = 0;
  }

  private readonly frame = () => {
    if (this.cards.size === 0 || this.prefersReducedMotion) {
      this.stopTicker();
      return;
    }

    const now = performance.now() / 1000;
    // Clamp non-negative — mirrors the old WebGL renderer's physics step.
    const dt = this.lastTime > 0 ? Math.max(0, Math.min(0.05, now - this.lastTime)) : 1 / 60;
    this.lastTime = now;

    const tuning = getBalatroHoverTuning();
    const referenceWidth = this.referenceCardWidth();
    const staleCards: HTMLElement[] = [];
    let needsAnotherFrame = false;

    for (const [host, card] of this.cards) {
      if (!host.isConnected || !card.surface.isConnected) {
        staleCards.push(host);
        continue;
      }

      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      // Scale juice/rotation amplitude by card size relative to a regular card.
      // Linear falloff so prize cards still feel snappy (a 55%-sized prize gets
      // ~55% of the juice rather than 30% from quadratic).
      const sizeRatio = referenceWidth && rect.width > 0 ? Math.min(1, rect.width / referenceWidth) : 1;
      const sizeFactor = sizeRatio;
      const juiceScaleAmt = tuning.juiceScaleAmount * sizeFactor;
      const juiceRotAmt = tuning.juiceRotationAmount * sizeFactor;

      const juiceT = now - card.juiceStart;
      const juiceAlive = juiceT >= 0 && juiceT < tuning.juiceDuration;
      const juiceRemaining = juiceAlive ? (tuning.juiceDuration - juiceT) / tuning.juiceDuration : 0;
      const juiceScale = juiceAlive
        ? juiceScaleAmt * Math.sin(50.8 * juiceT) * Math.pow(juiceRemaining, 3)
        : 0;
      const juiceRotation = juiceAlive
        ? card.juiceSign * juiceRotAmt * Math.sin(40.8 * juiceT) * Math.pow(juiceRemaining, 2)
        : 0;

      const desiredScale =
        (BALATRO_CARD_BASE_SCALE + card.targetHover * tuning.hoverZoom + juiceScale) /
        BALATRO_CARD_BASE_SCALE;
      const scaleEase = Math.exp(-tuning.scaleEase * dt);
      card.scaleVelocity = scaleEase * card.scaleVelocity + (1 - scaleEase) * (desiredScale - card.visibleScale);
      card.visibleScale += card.scaleVelocity;

      const desiredRotation = juiceRotation * 2;
      const rotationEase = Math.exp(-tuning.rotationEase * dt);
      card.rotationVelocity =
        rotationEase * card.rotationVelocity + (1 - rotationEase) * (desiredRotation - card.rotation);
      card.rotation += card.rotationVelocity;

      this.applyCardTransform(card, rect, referenceWidth ?? rect.width, tuning, now);

      const restScale = 1;
      const scaleStillMoving =
        Math.abs(card.visibleScale - desiredScale) > 0.0005 || Math.abs(card.scaleVelocity) > 0.0005;
      const rotationStillMoving =
        Math.abs(card.rotation - desiredRotation) > 0.0005 || Math.abs(card.rotationVelocity) > 0.0005;
      const atRest =
        card.targetHover === 0 &&
        !juiceAlive &&
        !scaleStillMoving &&
        !rotationStillMoving &&
        Math.abs(card.visibleScale - restScale) < 0.001;

      if (atRest) {
        card.visibleScale = 1;
        card.scaleVelocity = 0;
        card.rotation = 0;
        card.rotationVelocity = 0;
        card.juiceStart = Number.NEGATIVE_INFINITY;
        if (card.host.style.zIndex) gsap.set(card.host, { clearProps: "zIndex" });
      }

      // Balatro keeps sending the idle tilt pseudo-cursor every draw, so cards
      // never truly go transform-idle unless reduced motion is active.
      needsAnotherFrame = true;
    }

    for (const host of staleCards) this.unregister(host);

    if (!needsAnotherFrame) this.stopTicker();
  };

  private referenceCardWidth(): number | null {
    // --card-w is defined via clamp() so getPropertyValue returns the unresolved
    // expression. Track the max width of registered cards instead — full-size
    // cards (hand/active/stadium) yield the live --card-w in pixels.
    let maxWidth = 0;
    for (const card of this.cards.values()) {
      const width = card.host.getBoundingClientRect().width;
      if (width > maxWidth) maxWidth = width;
    }
    return maxWidth > 0 ? maxWidth : null;
  }

  private applyCardTransform(
    card: DomCard,
    rect: DOMRect,
    referenceWidth: number,
    tuning = getBalatroHoverTuning(),
    now = performance.now() / 1000,
  ) {
    const root = this.root ?? card.host.closest<HTMLElement>(".playmat-wrapper") ?? document.body;
    const rootRect = root.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0 || rootRect.width <= 0 || rootRect.height <= 0) return;

    const originX = rect.left - rootRect.left;
    const originY = rect.top - rootRect.top;
    const centerX = originX + width / 2;
    const centerY = originY + height / 2;
    const rootCenterX = rootRect.width / 2;
    const rootCenterY = rootRect.height / 2;
    const rootDiagonal = Math.hypot(rootRect.width, rootRect.height) || 1;
    const screenScale = Math.max(1, referenceWidth / BALATRO_CARD_W);
    const isHovered = card.targetHover > 0;
    const ambientTilt = card.ambientTilt;
    const idleTiltAngle =
      now * (BALATRO_IDLE_TILT_BASE_SPEED + (card.idleSeed / BALATRO_IDLE_TILT_ID_SPEED_DIVISOR) % 1) +
      card.idleSeed / BALATRO_IDLE_TILT_ID_PHASE_DIVISOR;
    const idleMouseOffsetX = 0.5 * ambientTilt * Math.cos(idleTiltAngle) * width;
    const idleMouseOffsetY = 0.5 * ambientTilt * Math.sin(idleTiltAngle) * height;
    const mouseX = isHovered
      ? card.mouseClient.x - rootRect.left + idleMouseOffsetX
      : originX + width / 2 + idleMouseOffsetX;
    const mouseY = isHovered
      ? card.mouseClient.y - rootRect.top + idleMouseOffsetY
      : originY + height / 2 + idleMouseOffsetY;
    const cos = Math.cos(card.rotation);
    const sin = Math.sin(card.rotation);
    const hoverBendCenterBoost = card.bendCenterBoost ?? tuning.bendCenterBoost;
    const idleSizeCompensation = Math.min(
      BALATRO_IDLE_SIZE_COMPENSATION_MAX,
      Math.pow(referenceWidth / Math.max(width, 1), 2),
    );

    const projectCorner = (localX: number, localY: number): Point => {
      const dx = (localX - width / 2) * card.visibleScale;
      const dy = (localY - height / 2) * card.visibleScale;

      // Three.js rendered in a y-up world; CSS is y-down. This sign pattern
      // matches the visual z-rotation from the old WebGL mesh.
      let x = centerX + dx * cos + dy * sin;
      let y = centerY - dx * sin + dy * cos;

      if (isHovered || ambientTilt > 0) {
        const midDist = Math.hypot(x - rootCenterX, y - rootCenterY) / rootDiagonal;
        const mouseOffsetX = (x - mouseX) / screenScale;
        const mouseOffsetY = (y - mouseY) / screenScale;
        const bendBase = isHovered ? tuning.bendBase : BALATRO_IDLE_BEND_BASE;
        const bendCenterBoost = isHovered ? hoverBendCenterBoost : BALATRO_IDLE_BEND_CENTER_BOOST;
        const bendCenterRadius = isHovered ? tuning.bendCenterRadius : BALATRO_IDLE_BEND_CENTER_RADIUS;
        const bendStrength =
          0.2 * (-bendBase - bendCenterBoost * Math.max(0, bendCenterRadius - midDist));
        const bend =
          bendStrength *
          (isHovered ? 1 : idleSizeCompensation) *
          (mouseOffsetX * mouseOffsetX + mouseOffsetY * mouseOffsetY) /
          Math.max(0.001, 2 - midDist);
        const clipW = Math.max(tuning.minPerspectiveW, 1 + bend);
        x = rootCenterX + (x - rootCenterX) / clipW;
        y = rootCenterY + (y - rootCenterY) / clipW;
      }

      return { x: x - originX, y: y - originY };
    };

    const projectedQuad: [Point, Point, Point, Point] = [
      projectCorner(0, 0),
      projectCorner(width, 0),
      projectCorner(width, height),
      projectCorner(0, height),
    ];

    if (!isHovered && ambientTilt > 0) {
      // Balatro's shader bends vertices without affecting game-space layout.
      // Our CSS homography would otherwise pull idle cards toward screen center,
      // so re-center idle-only quads. Hover keeps the full displacement/pop.
      const projectedCenterX = projectedQuad.reduce((sum, point) => sum + point.x, 0) / projectedQuad.length;
      const projectedCenterY = projectedQuad.reduce((sum, point) => sum + point.y, 0) / projectedQuad.length;
      const recenterX = width / 2 - projectedCenterX;
      const recenterY = height / 2 - projectedCenterY;
      for (const point of projectedQuad) {
        point.x += recenterX;
        point.y += recenterY;
      }
    }

    const matrix = matrix3dFromQuad(width, height, projectedQuad);

    gsap.set(card.surface, { "--balatro-transform": matrix });
  }

  private clearCardTransform(card: DomCard) {
    gsap.set(card.surface, { "--balatro-transform": "none" });
  }
}

let sharedAnimator: BalatroDomCardAnimator | null = null;

function getBalatroDomCardAnimator() {
  sharedAnimator ??= new BalatroDomCardAnimator();
  return sharedAnimator;
}

export default function BalatroHoverCard({
  cardId,
  renderedWidth,
  alt,
  priority = false,
  className,
  bendCenterBoost,
  children,
}: BalatroHoverCardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const surface = surfaceRef.current;
    if (!host || !surface) return;

    const animator = getBalatroDomCardAnimator();
    animator.register(host, surface, bendCenterBoost);

    const handlePointerEnter = (event: PointerEvent) => {
      animator.hover(host, event);
    };
    const handlePointerMove = (event: PointerEvent) => {
      animator.move(host, event);
    };
    const handlePointerLeave = () => {
      animator.unhover(host);
    };

    host.addEventListener("pointerenter", handlePointerEnter);
    host.addEventListener("pointermove", handlePointerMove);
    host.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      host.removeEventListener("pointerenter", handlePointerEnter);
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerleave", handlePointerLeave);
      animator.unregister(host);
    };
  }, [bendCenterBoost]);

  const placeholder =
    children ??
    (cardId && renderedWidth && alt ? (
      <CardImage
        cardId={cardId}
        renderedWidth={renderedWidth}
        alt={alt}
        priority={priority}
        className="balatro-hover-card__image"
      />
    ) : null);

  return (
    <div ref={hostRef} className={`balatro-hover-card ${className ?? ""}`.trim()}>
      <div ref={surfaceRef} className="balatro-hover-card__surface">
        {placeholder}
      </div>
    </div>
  );
}
