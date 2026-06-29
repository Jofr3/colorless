// Drag a card between the gallery and the deck. Reuses the decks-page drag feel
// — a body-level ghost that springs after the pointer with velocity tilt, a lift
// on pickup, and the Balatro juice pop — but instead of reordering/nesting it
// only hit-tests two drop zones: drop a gallery card on the deck to add a copy,
// drop a deck card off the deck to remove one. The spring/juice physics are the
// shared primitives in lib/animation, identical to useDeckDrag and CardView.
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { evaluateJuice, type JuiceState, startJuice } from "../../lib/animation/juice";
import {
  clampVelocity,
  dragTiltFromVelocity,
  SPRING_C_ROT_DRAG,
  SPRING_MAX_DT,
  stepSpringScalar,
  stepSpringXY,
} from "../../lib/animation/spring";
import type { BuilderCard } from "./cards";

export type DragSource = "gallery" | "deck";
export interface CardDragItem {
  card: BuilderCard;
  source: DragSource;
}

interface Options {
  /** A gallery card was dropped on the deck. */
  onAddToDeck: (card: BuilderCard) => void;
  /** A deck card was dropped off the deck. */
  onRemoveFromDeck: (card: BuilderCard) => void;
}

const RAD_TO_DEG = 180 / Math.PI;
const DRAG_THRESHOLD_PX = 5; // travel before a press becomes a drag
const PICKUP_SCALE = 1.1;
const PICKUP_LIFT_PX = 14;
const ACCEPTED_SCALE = 0.5; // shrink as it lands in/leaves the deck
const RELEASE_MS = 280;
const PICKUP_JUICE = { amount: 0.05, rotation: 0.025 };
const LAND_JUICE = { amount: 0.07, rotation: 0.03 };
const REJECT_JUICE = { amount: 0.05, rotation: 0.04 };

interface Drag {
  item: CardDragItem;
  sourceEl: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  reduced: boolean;
  pointer: { x: number; y: number };
  grab: { x: number; y: number };
  cur: { x: number; y: number; rot: number };
  vel: { x: number; y: number; rot: number };
  halfW: number;
  halfH: number;
  emph: number;
  lift: number;
  opacity: number;
  juice: JuiceState | null;
  releasing: boolean;
  releaseStart: number;
  releaseCenter: { x: number; y: number };
  accepted: boolean;
  wrapper: HTMLElement | null;
  raf: number | null;
  lastFrame: number;
}

function centerOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Clone the dragged card into a fixed, pointer-events-none ghost on the body. */
function makeGhost(source: HTMLElement, rect: DOMRect): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  // Strip the tilt/juice vars + transforms so the lifted card reads clean.
  const reset = (el: HTMLElement) => {
    for (const p of ["--rx", "--ry", "--s", "--js", "--jr"]) el.style.removeProperty(p);
    el.style.transform = "none";
    el.style.transition = "none";
  };
  reset(clone);
  for (const el of clone.querySelectorAll<HTMLElement>("[style]")) reset(el);
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = "0";
  clone.style.pointerEvents = "none";

  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "9999",
    pointerEvents: "none",
    transformOrigin: "center center",
    willChange: "transform",
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  return wrapper;
}

/** Which drop zone (if any) sits under the pointer. */
function zoneAt(x: number, y: number): DragSource | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-zone]");
  const z = el?.dataset.dropZone;
  return z === "deck" || z === "gallery" ? z : null;
}

export function useCardDrag({ onAddToDeck, onRemoveFromDeck }: Options) {
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const optsRef = useRef({ onAddToDeck, onRemoveFromDeck });
  optsRef.current = { onAddToDeck, onRemoveFromDeck };

  const finalize = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.raf !== null) cancelAnimationFrame(drag.raf);
    drag.wrapper?.remove();
    dragRef.current = null;
    document.body.style.userSelect = "";
    setDragging(false);
    setDragSource(null);
  }, []);

  const tick = useCallback(() => {
    const drag = dragRef.current;
    if (!drag || !drag.wrapper) return;
    const now = performance.now();
    const dt = Math.min((now - drag.lastFrame) / 1000, SPRING_MAX_DT);
    drag.lastFrame = now;

    const desired = drag.releasing
      ? drag.releaseCenter
      : { x: drag.pointer.x - drag.grab.x, y: drag.pointer.y - drag.grab.y };
    drag.cur.x = stepSpringXY(drag.cur.x, desired.x, dt, drag.vel, "x");
    drag.cur.y = stepSpringXY(drag.cur.y, desired.y, dt, drag.vel, "y");

    const velTilt = !drag.reduced && !drag.releasing ? dragTiltFromVelocity(drag.vel.x, dt) : 0;
    clampVelocity(drag.vel, dt);
    drag.cur.rot = stepSpringScalar(drag.cur.rot, velTilt, dt, SPRING_C_ROT_DRAG, drag.vel, "rot");

    const ease = drag.reduced ? 1 : 1 - Math.exp(-14 * dt);
    const emphTarget = drag.releasing ? (drag.accepted ? ACCEPTED_SCALE : 1) : PICKUP_SCALE;
    drag.emph += (emphTarget - drag.emph) * ease;
    const liftTarget = drag.releasing ? 0 : PICKUP_LIFT_PX;
    drag.lift += (liftTarget - drag.lift) * ease;
    const opacityTarget = drag.releasing && drag.accepted ? 0 : 1;
    drag.opacity += (opacityTarget - drag.opacity) * (drag.reduced ? 1 : 1 - Math.exp(-12 * dt));

    const juice = drag.reduced ? null : evaluateJuice(drag.juice, now / 1000);
    if (!juice) drag.juice = null;
    const juiceScale = juice ? juice.scale : 0;
    const juiceRot = juice ? juice.rotation * 2 : 0;

    const scale = Math.max(0.01, drag.emph * (1 + juiceScale));
    const rotDeg = (drag.cur.rot + juiceRot) * RAD_TO_DEG;
    const cx = drag.cur.x;
    const cy = drag.cur.y - drag.lift;
    drag.wrapper.style.transform = `translate(${cx - drag.halfW}px, ${cy - drag.halfH}px) rotate(${rotDeg}deg) scale(${scale})`;
    drag.wrapper.style.opacity = `${drag.opacity}`;

    if (drag.releasing && now - drag.releaseStart >= (drag.reduced ? 0 : RELEASE_MS)) {
      finalize();
      return;
    }
    drag.raf = requestAnimationFrame(tick);
  }, [finalize]);

  const beginDrag = useCallback(
    (drag: Drag) => {
      const rect = drag.sourceEl.getBoundingClientRect();
      drag.wrapper = makeGhost(drag.sourceEl, rect);
      drag.halfW = rect.width / 2;
      drag.halfH = rect.height / 2;
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      drag.cur = { x: center.x, y: center.y, rot: 0 };
      drag.vel = { x: 0, y: 0, rot: 0 };
      drag.grab = { x: drag.startX - center.x, y: drag.startY - center.y };
      drag.emph = 1;
      drag.lift = 0;
      drag.opacity = 1;
      drag.lastFrame = performance.now();
      if (!drag.reduced) {
        drag.juice = startJuice(PICKUP_JUICE.amount, PICKUP_JUICE.rotation, performance.now() / 1000);
      }
      document.body.style.userSelect = "none";
      setDragging(true);
      setDragSource(drag.item.source);
      drag.raf = requestAnimationFrame(tick);
    },
    [tick],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.started) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) {
          return;
        }
        drag.started = true;
        beginDrag(drag);
      }
      event.preventDefault();
      drag.pointer = { x: event.clientX, y: event.clientY };
    },
    [beginDrag],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      if (!drag.started) {
        // Never crossed the threshold — a plain click; let onClick handle it.
        dragRef.current = null;
        document.body.style.userSelect = "";
        return;
      }

      // Swallow the click that the browser fires after the drag so it can't also
      // trigger the card's onClick (which would add an extra copy).
      const suppress = (e: Event) => e.stopPropagation();
      window.addEventListener("click", suppress, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", suppress, true), 400);

      const zone = event.type === "pointercancel" ? null : zoneAt(event.clientX, event.clientY);
      const addAccepted = drag.item.source === "gallery" && zone === "deck";
      const removeAccepted = drag.item.source === "deck" && zone !== "deck";
      const accepted = addAccepted || removeAccepted;
      if (addAccepted) optsRef.current.onAddToDeck(drag.item.card);
      else if (removeAccepted) optsRef.current.onRemoveFromDeck(drag.item.card);

      drag.accepted = accepted;
      drag.releasing = true;
      drag.releaseStart = performance.now();
      drag.releaseCenter = accepted ? { x: drag.cur.x, y: drag.cur.y } : centerOf(drag.sourceEl);
      if (!drag.reduced) {
        const pop = accepted ? LAND_JUICE : REJECT_JUICE;
        drag.juice = startJuice(pop.amount, pop.rotation, performance.now() / 1000);
      }
      setDragSource(null);
      // Back the cleanup with a timer in case rAF is paused (hidden tab).
      window.setTimeout(
        () => {
          if (dragRef.current === drag) finalize();
        },
        (drag.reduced ? 0 : RELEASE_MS) + 120,
      );
    },
    [onPointerMove, finalize],
  );

  const startDrag = useCallback(
    (item: CardDragItem, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      dragRef.current = {
        item,
        sourceEl: event.currentTarget,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        pointer: { x: event.clientX, y: event.clientY },
        grab: { x: 0, y: 0 },
        cur: { x: 0, y: 0, rot: 0 },
        vel: { x: 0, y: 0, rot: 0 },
        halfW: 0,
        halfH: 0,
        emph: 1,
        lift: 0,
        opacity: 1,
        juice: null,
        releasing: false,
        releaseStart: 0,
        releaseCenter: { x: 0, y: 0 },
        accepted: false,
        wrapper: null,
        raf: null,
        lastFrame: performance.now(),
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  return { dragging, dragSource, startDrag };
}
