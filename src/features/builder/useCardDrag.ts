// Drag a card between the gallery and the deck. Reuses the shared ghost-drag
// primitive (a body-level clone that spring-follows the pointer with velocity
// tilt, a pickup lift, and the Balatro juice pop — see lib/animation/useGhostDrag
// and CardView) but, instead of reordering/nesting, only hit-tests two drop
// zones: drop a gallery card on the deck to add a copy, drop a deck card off the
// deck to remove one.
import { useState } from "react";
import type { GhostFeel } from "../../lib/animation/ghostDrag";
import { type ReleaseOutcome, useGhostDrag } from "../../lib/animation/useGhostDrag";
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

const CARD_FEEL: GhostFeel = {
  pickupScale: 1.1,
  pickupLiftPx: 14,
  acceptedScale: 0.5, // shrink as it lands in/leaves the deck
  releaseMs: 280,
  releaseSlackMs: 120,
  pickupJuice: { amount: 0.05, rotation: 0.025 },
  dragThresholdPx: 5, // travel before a press becomes a drag
};
const LAND_JUICE = { amount: 0.07, rotation: 0.03 };
const REJECT_JUICE = { amount: 0.05, rotation: 0.04 };

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
  const [dragging, setDragging] = useState(false);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);

  const { startDrag } = useGhostDrag<CardDragItem, null>({
    feel: CARD_FEEL,
    createData: () => null,
    createGhost: makeGhost,
    onBegin: (drag) => {
      document.body.style.userSelect = "none";
      setDragging(true);
      setDragSource(drag.item.source);
    },
    resolveRelease: (event, drag): ReleaseOutcome => {
      // Swallow the click the browser fires after the drag so it can't also
      // trigger the card's onClick (which would add an extra copy).
      const suppress = (e: Event) => e.stopPropagation();
      window.addEventListener("click", suppress, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", suppress, true), 400);

      // A pointercancel (OS gesture, context menu, focus loss) is an aborted
      // gesture, not a drop — bail so a deck card isn't silently removed when
      // `zone` collapses to null (`zone !== "deck"` would otherwise be true).
      const cancelled = event.type === "pointercancel";
      const zone = cancelled ? null : zoneAt(event.clientX, event.clientY);
      const addAccepted = !cancelled && drag.item.source === "gallery" && zone === "deck";
      const removeAccepted = !cancelled && drag.item.source === "deck" && zone !== "deck";
      const accepted = addAccepted || removeAccepted;
      if (addAccepted) onAddToDeck(drag.item.card);
      else if (removeAccepted) onRemoveFromDeck(drag.item.card);

      return {
        accepted,
        releaseCenter: accepted ? { x: drag.cur.x, y: drag.cur.y } : centerOf(drag.sourceEl),
        juice: accepted ? LAND_JUICE : REJECT_JUICE,
      };
    },
    onReleaseStart: () => setDragSource(null),
    finalize: (_drag, removeGhost) => {
      removeGhost();
      document.body.style.userSelect = "";
      setDragging(false);
      setDragSource(null);
    },
    onClick: () => {
      document.body.style.userSelect = "";
    },
    onUnmount: () => {
      document.body.style.userSelect = "";
    },
  });

  return { dragging, dragSource, startDrag };
}
