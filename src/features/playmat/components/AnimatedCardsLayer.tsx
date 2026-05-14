import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Container, type Application, type Ticker } from "pixi.js";
import { ensureGsapPixi } from "../../../lib/animation/gsapPixi";
import { createPixiApplication } from "../../../lib/pixi/createPixiApplication";
import type {
  BoardState,
  CardModel,
  CardMoveRequest,
  CardOwner,
  CardPlacement,
  CardType,
  CardZone,
  PlayerId,
} from "../types";
import { CardView, type CardViewTarget, type ReleaseVelocity } from "../pixi/CardView";
import { canPlace } from "../utils/cardMovement";

interface AnimatedCardsLayerProps {
  board: BoardState;
  perspectivePlayer: PlayerId;
  playmatRef: RefObject<HTMLDivElement | null>;
  onMoveCard: (request: CardMoveRequest) => void;
}

interface CardDescriptor {
  card: CardModel;
  placement: CardPlacement;
  draggable: boolean;
  zoneSize: number;
}

interface DropZoneSnapshot {
  placement: CardPlacement;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

interface DragState {
  pointerId: number;
  cardId: string;
  cardType: CardType;
  from: CardPlacement;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  velocity: ReleaseVelocity;
  moved: boolean;
  // Insertion index produced by the live reorder preview while the card
  // moves across siblings in whichever zone the cursor is hovering over
  // (hand or bench). On release this overrides the drop-zone's own index
  // when the cursor is still inside `previewZone`, so the landing slot
  // matches what the user just saw.
  reorderIndex: number | null;
  // Which zone the live reorder preview is currently applied to. Tracked
  // so we can snap the previously previewed zone back to canonical layout
  // when the cursor moves to a different zone.
  previewZone: { owner: PlayerId; zone: "hand" | "bench" } | null;
}

interface SlotAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

const CARD_TEXTURE_WIDTH = 600;
const PLAYER_IDS: PlayerId[] = ["opponent", "you"];
const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [aria-label='Game log']";

function localCardTexturePath(cardId: string) {
  return `/cards/${cardId}-${CARD_TEXTURE_WIDTH}.webp`;
}

function cardTextureUrl(card: CardModel) {
  return card.imageUrl ?? localCardTexturePath(card.cardId);
}

function cardSeed(cardId: string) {
  let hash = 0;
  for (let index = 0; index < cardId.length; index += 1) {
    hash = (hash * 31 + cardId.charCodeAt(index)) % 9973;
  }
  return hash / 9973;
}

function descriptorKey(descriptor: CardDescriptor) {
  return descriptor.card.id;
}

function collectCardDescriptors(board: BoardState, perspectivePlayer: PlayerId): CardDescriptor[] {
  const descriptors: CardDescriptor[] = [];

  for (const owner of PLAYER_IDS) {
    const player = board[owner];
    const active = player.active;

    if (active) {
      descriptors.push({
        card: active,
        placement: { owner, zone: "active" },
        draggable: owner === perspectivePlayer,
        zoneSize: 1,
      });
    }

    for (const [index, card] of player.bench.entries()) {
      descriptors.push({
        card,
        placement: { owner, zone: "bench", index },
        draggable: owner === perspectivePlayer,
        zoneSize: player.bench.length,
      });
    }

    if (owner === perspectivePlayer) {
      for (const [index, card] of player.hand.entries()) {
        descriptors.push({
          card,
          placement: { owner, zone: "hand", index },
          draggable: true,
          zoneSize: player.hand.length,
        });
      }
    }
  }

  if (board.stadium) {
    descriptors.push({
      card: board.stadium,
      placement: { owner: "global", zone: "stadium" },
      draggable: false,
      zoneSize: 1,
    });
  }

  return descriptors;
}

function parsePlacement(element: HTMLElement): CardPlacement | null {
  const owner = element.dataset.cardOwner as CardOwner | undefined;
  const zone = element.dataset.cardZone as CardZone | undefined;

  if (!owner || !zone) {
    return null;
  }

  const index = element.dataset.cardIndex ? Number(element.dataset.cardIndex) : undefined;

  return Number.isFinite(index) ? { owner, zone, index } : { owner, zone };
}

function pointFromEvent(root: HTMLElement, event: PointerEvent) {
  const rect = root.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function handRotation(index: number, count: number) {
  if (count <= 1) {
    return 0;
  }

  return (0.2 * (-count / 2 - 0.5 + index + 1)) / count;
}

function baseRotationForPlacement(placement: CardPlacement, zoneSize: number) {
  if (placement.zone === "hand") {
    return handRotation(placement.index ?? 0, zoneSize);
  }

  return 0;
}

function zIndexForPlacement(placement: CardPlacement, zoneSize: number) {
  if (placement.zone === "hand") {
    return 80 + zoneSize - (placement.index ?? 0);
  }

  if (placement.zone === "active") {
    return 55;
  }

  if (placement.zone === "bench") {
    return 35 + (placement.index ?? 0);
  }

  return 42;
}

// Drop legality is delegated to canPlace in utils/cardMovement, so the UI
// gating and the model-level guard stay in lockstep.

function isPointerOverZone(point: { x: number; y: number }, zone: DropZoneSnapshot) {
  return (
    point.x >= zone.x &&
    point.x <= zone.x + zone.width &&
    point.y >= zone.y &&
    point.y <= zone.y + zone.height
  );
}

function shouldIgnorePointer(event: PointerEvent) {
  return event.target instanceof Element && Boolean(event.target.closest(INTERACTIVE_SELECTOR));
}

export function AnimatedCardsLayer({
  board,
  perspectivePlayer,
  playmatRef,
  onMoveCard,
}: AnimatedCardsLayerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<Container | null>(null);
  const viewsRef = useRef(new Map<string, CardView>());
  const descriptorsRef = useRef(new Map<string, CardDescriptor>());
  const dropZonesRef = useRef<DropZoneSnapshot[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const hoveredCardIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  const onMoveCardRef = useRef(onMoveCard);
  const boardRef = useRef(board);

  const descriptors = useMemo(
    () => collectCardDescriptors(board, perspectivePlayer),
    [board, perspectivePlayer],
  );

  useEffect(() => {
    onMoveCardRef.current = onMoveCard;
  }, [onMoveCard]);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  function setCursor(cursor: string) {
    const root = playmatRef.current;
    if (root) {
      root.style.cursor = cursor;
    }
  }

  function clearHover() {
    const hoveredCardId = hoveredCardIdRef.current;
    if (hoveredCardId) {
      viewsRef.current.get(hoveredCardId)?.setHovered(false);
      hoveredCardIdRef.current = null;
    }
    setCursor("");
  }

  function hitTest(point: { x: number; y: number }, requireDraggable: boolean) {
    const descriptorsById = descriptorsRef.current;

    return [...viewsRef.current.values()]
      .filter((view) => {
        const descriptor = descriptorsById.get(view.id);
        return Boolean(
          descriptor && (!requireDraggable || descriptor.draggable) && view.hitTest(point),
        );
      })
      .sort((a, b) => b.zIndex - a.zIndex)[0];
  }

  function findDropZone(
    point: { x: number; y: number },
    source: CardPlacement,
    sourceType: CardType,
  ) {
    const board = boardRef.current;
    return dropZonesRef.current
      .filter(
        (zone) =>
          isPointerOverZone(point, zone) &&
          canPlace(board, source, zone.placement, sourceType),
      )
      .sort((a, b) => a.area - b.area)[0];
  }

  function measureCards() {
    const root = playmatRef.current;
    if (!root) {
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const descriptorsById = descriptorsRef.current;
    const measuredCardIds = new Set<string>();

    for (const element of root.querySelectorAll<HTMLElement>('[data-card-anchor="true"]')) {
      const cardId = element.dataset.cardId;
      if (!cardId) {
        continue;
      }

      const descriptor = descriptorsById.get(cardId);
      const view = viewsRef.current.get(cardId);
      if (!descriptor || !view) {
        continue;
      }

      measuredCardIds.add(cardId);

      // setPlaymatSize feeds the hover-offset math in CardView. Cheap to
      // call every measure pass and keeps the direction live across
      // resizes even for hovered cards.
      view.setPlaymatSize(rootRect.width, rootRect.height);

      if (view.isDragging) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const target: CardViewTarget = {
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        rotation: baseRotationForPlacement(descriptor.placement, descriptor.zoneSize),
        zIndex: zIndexForPlacement(descriptor.placement, descriptor.zoneSize),
        placement: descriptor.placement,
      };

      view.setTarget(target);
    }

    for (const [cardId, view] of viewsRef.current) {
      if (!measuredCardIds.has(cardId) && !view.isDragging) {
        view.hide();
      }
    }

    dropZonesRef.current = [...root.querySelectorAll<HTMLElement>('[data-card-drop-zone="true"]')]
      .map((element) => {
        const placement = parsePlacement(element);
        if (!placement) {
          return null;
        }

        const rect = element.getBoundingClientRect();
        return {
          placement,
          x: rect.left - rootRect.left,
          y: rect.top - rootRect.top,
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height,
        } satisfies DropZoneSnapshot;
      })
      .filter((zone): zone is DropZoneSnapshot => Boolean(zone));
  }

  function scheduleMeasure() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      measureCards();
    });
  }

  function syncViews(nextDescriptors: CardDescriptor[]) {
    const scene = sceneRef.current;
    const nextDescriptorMap = new Map(
      nextDescriptors.map((descriptor) => [descriptorKey(descriptor), descriptor]),
    );
    descriptorsRef.current = nextDescriptorMap;

    if (!scene) {
      return;
    }

    for (const [cardId, view] of viewsRef.current) {
      if (!nextDescriptorMap.has(cardId)) {
        view.destroy();
        viewsRef.current.delete(cardId);
      }
    }

    for (const descriptor of nextDescriptors) {
      const cardId = descriptorKey(descriptor);
      const existingView = viewsRef.current.get(cardId);
      const textureUrl = cardTextureUrl(descriptor.card);

      if (existingView) {
        existingView.setTextureUrl(textureUrl);
        continue;
      }

      const view = new CardView({
        id: descriptor.card.id,
        name: descriptor.card.name,
        textureUrl,
        seed: cardSeed(descriptor.card.id),
        reducedMotion: reducedMotionRef.current,
      });
      viewsRef.current.set(cardId, view);
      scene.addChild(view.container);
    }
  }

  function updateHover(point: { x: number; y: number }, event: PointerEvent) {
    if (dragRef.current || shouldIgnorePointer(event)) {
      clearHover();
      return;
    }

    // Hover applies to every card (incl. opponent's) — only the cursor
    // signals draggability via "grab".
    const view = hitTest(point, false);
    const nextHoveredCardId = view?.id ?? null;

    if (hoveredCardIdRef.current !== nextHoveredCardId) {
      if (hoveredCardIdRef.current) {
        viewsRef.current.get(hoveredCardIdRef.current)?.setHovered(false);
      }

      hoveredCardIdRef.current = nextHoveredCardId;
      if (view) {
        view.setHovered(true);
      }
    }

    if (view) {
      view.updateHoverPoint(point);
      const descriptor = descriptorsRef.current.get(view.id);
      setCursor(descriptor?.draggable ? "grab" : "");
      return;
    }

    setCursor("");
  }

  function handlePointerDown(event: PointerEvent) {
    const root = playmatRef.current;
    if (!root || event.button !== 0 || shouldIgnorePointer(event)) {
      return;
    }

    const point = pointFromEvent(root, event);
    const view = hitTest(point, true);
    const descriptor = view ? descriptorsRef.current.get(view.id) : undefined;
    const placement = view?.placement;

    if (!view || !descriptor?.draggable || !placement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearHover();

    const viewPosition = view.getPosition();

    dragRef.current = {
      pointerId: event.pointerId,
      cardId: view.id,
      cardType: descriptor.card.type,
      from: placement,
      offsetX: point.x - viewPosition.x,
      offsetY: point.y - viewPosition.y,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      lastTime: performance.now(),
      velocity: { x: 0, y: 0 },
      moved: false,
      reorderIndex: null,
      previewZone: null,
    };

    root.classList.add("is-card-dragging");
    setCursor("grabbing");
    view.startPress();
    view.startDrag();
  }

  function handlePointerMove(event: PointerEvent) {
    const root = playmatRef.current;
    if (!root) {
      return;
    }

    const point = pointFromEvent(root, event);
    const drag = dragRef.current;

    if (!drag) {
      updateHover(point, event);
      return;
    }

    if (event.pointerId !== drag.pointerId) {
      return;
    }

    event.preventDefault();
    const view = viewsRef.current.get(drag.cardId);
    if (!view) {
      return;
    }

    const now = performance.now();
    const dt = Math.max((now - drag.lastTime) / 1000, 1 / 120);
    const rawVelocity = { x: (point.x - drag.lastX) / dt, y: (point.y - drag.lastY) / dt };
    drag.velocity = {
      x: drag.velocity.x * 0.58 + rawVelocity.x * 0.42,
      y: drag.velocity.y * 0.58 + rawVelocity.y * 0.42,
    };
    drag.lastX = point.x;
    drag.lastY = point.y;
    drag.lastTime = now;
    drag.moved = drag.moved || Math.hypot(point.x - drag.startX, point.y - drag.startY) > 5;

    view.dragTo(point.x - drag.offsetX, point.y - drag.offsetY);

    const nextPreviewZone = detectPreviewZone(drag, point);

    // If the preview zone changed (or vanished), snap the previously
    // previewed zone back to its canonical DOM layout. Without this the
    // hand stays "open" with a gap after the cursor moves to the bench,
    // and vice versa.
    if (
      drag.previewZone &&
      (!nextPreviewZone ||
        nextPreviewZone.owner !== drag.previewZone.owner ||
        nextPreviewZone.zone !== drag.previewZone.zone)
    ) {
      resyncZoneCards(drag.previewZone.owner, drag.previewZone.zone);
    }

    if (nextPreviewZone) {
      applyReorderPreview(drag, nextPreviewZone.owner, nextPreviewZone.zone);
    } else {
      drag.reorderIndex = null;
    }
    drag.previewZone = nextPreviewZone;
  }

  function detectPreviewZone(
    drag: DragState,
    point: { x: number; y: number },
  ): { owner: PlayerId; zone: "hand" | "bench" } | null {
    const board = boardRef.current;
    // Iterate smallest-first so we prefer the most specific slot drop zone
    // when slot zones nest inside a wider zone container.
    const candidates = dropZonesRef.current
      .filter((dz) => isPointerOverZone(point, dz))
      .sort((a, b) => a.area - b.area);

    for (const dz of candidates) {
      const zone = dz.placement.zone;
      if (zone !== "hand" && zone !== "bench") continue;
      const owner = dz.placement.owner;
      if (owner !== "you" && owner !== "opponent") continue;
      // Source-zone reorder is always allowed (it's just rearranging).
      // External insertion requires the drop to be legal at all.
      const isSourceZone = drag.from.owner === owner && drag.from.zone === zone;
      if (!isSourceZone && !canPlace(board, drag.from, dz.placement, drag.cardType)) {
        continue;
      }
      return { owner, zone };
    }
    return null;
  }

  // Balatro's CardArea:align_cards (cardarea.lua:410-465) reorders cards by
  // sorting `self.cards` on their current x position each frame. We mirror
  // that: while a card is dragged across a hand/bench zone — its own source
  // zone OR a destination it could legally land in — sort that zone's cards
  // against the dragged card by current x, then move each into the slot at
  // its new index. The CardView spring carries them.
  function applyReorderPreview(
    drag: DragState,
    previewOwner: PlayerId,
    previewZone: "hand" | "bench",
  ) {
    const root = playmatRef.current;
    if (!root) return;

    const draggedView = viewsRef.current.get(drag.cardId);
    if (!draggedView) return;

    const isSourceZone =
      drag.from.owner === previewOwner && drag.from.zone === previewZone;

    // For a source-zone preview the dragged card is one of the siblings and
    // must be excluded so it doesn't try to occupy its own virtual slot.
    // For an external preview the dragged card isn't in this zone yet, so
    // every card counts as a sibling.
    const siblings = [...descriptorsRef.current.values()]
      .filter(
        (d) =>
          d.placement.zone === previewZone &&
          d.placement.owner === previewOwner &&
          (!isSourceZone || d.card.id !== drag.cardId),
      )
      .map((d) => {
        const view = viewsRef.current.get(d.card.id);
        return view ? { descriptor: d, view } : null;
      })
      .filter((s): s is { descriptor: CardDescriptor; view: CardView } => s !== null);

    if (siblings.length === 0) {
      drag.reorderIndex = 0;
      return;
    }

    const draggedX = draggedView.getPosition().x;
    siblings.sort((a, b) => a.view.getPosition().x - b.view.getPosition().x);

    let insertIdx = 0;
    for (const s of siblings) {
      if (s.view.getPosition().x < draggedX) {
        insertIdx += 1;
      } else {
        break;
      }
    }
    drag.reorderIndex = insertIdx;

    // siblings + 1 = the virtual layout we want: every existing card needs
    // a slot, plus one extra for the dragged card's gap. For source-zone
    // reorder this matches the DOM count exactly (N cards → N anchors).
    // For external insertion (hand → bench) we'll be one short on the DOM
    // side and getZoneSlots falls through to computing a centred layout.
    const slots = getZoneSlots(previewZone, previewOwner, siblings.length + 1);
    if (slots.length === 0) return;

    const zoneSize = slots.length;
    for (let j = 0; j < siblings.length; j += 1) {
      const virtualIndex = j < insertIdx ? j : j + 1;
      const slot = slots[virtualIndex];
      if (!slot) continue;

      const sibling = siblings[j];
      const placement: CardPlacement = {
        owner: previewOwner,
        zone: previewZone,
        index: virtualIndex,
      };
      sibling.view.setTarget({
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        rotation: baseRotationForPlacement(placement, zoneSize),
        zIndex: zIndexForPlacement(placement, zoneSize),
        placement,
      });
    }
  }

  // Reset the cards in a zone back to the targets implied by the current
  // DOM layout (the canonical board-state positions). Used when the live
  // preview zone changes so the old zone snaps closed.
  function resyncZoneCards(owner: PlayerId, zone: "hand" | "bench") {
    const root = playmatRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();

    for (const descriptor of descriptorsRef.current.values()) {
      if (descriptor.placement.zone !== zone) continue;
      if (descriptor.placement.owner !== owner) continue;
      const view = viewsRef.current.get(descriptor.card.id);
      if (!view || view.isDragging) continue;

      const element = root.querySelector<HTMLElement>(
        `[data-card-anchor="true"][data-card-id="${descriptor.card.id}"]`,
      );
      if (!element) continue;

      const rect = element.getBoundingClientRect();
      view.setTarget({
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        rotation: baseRotationForPlacement(descriptor.placement, descriptor.zoneSize),
        zIndex: zIndexForPlacement(descriptor.placement, descriptor.zoneSize),
        placement: descriptor.placement,
      });
    }
  }

  function getZoneSlots(
    zone: "hand" | "bench",
    owner: PlayerId,
    slotCount: number,
  ): SlotAnchor[] {
    const root = playmatRef.current;
    if (!root) return [];
    const rootRect = root.getBoundingClientRect();
    const selector = `[data-card-drop-zone="true"][data-card-owner="${owner}"][data-card-zone="${zone}"][data-card-index]`;
    const domSlots = [...root.querySelectorAll<HTMLElement>(selector)]
      .map((el) => {
        const index = Number(el.dataset.cardIndex);
        if (!Number.isFinite(index)) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left - rootRect.left + rect.width / 2,
          y: rect.top - rootRect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
          index,
        } satisfies SlotAnchor;
      })
      .filter((slot): slot is SlotAnchor => slot !== null)
      .sort((a, b) => a.index - b.index);

    // Source-zone reorders need exactly as many slots as the DOM already
    // renders (one per card) — return those directly. The dynamic path
    // below is for the hand→bench external case, where we need one extra
    // slot (the virtual gap for the incoming card) and the bench needs to
    // visually re-center around N+1 cards instead of N.
    if (domSlots.length >= slotCount) {
      return domSlots;
    }

    // We need more slots than the DOM has rendered. Compute a centred
    // layout for `slotCount` cards inside the zone's outer container so
    // existing cards animate from "N centred" to "N+1 centred", leaving
    // the dragged card's slot empty at the cursor's insertion point.
    const outerEl = root.querySelector<HTMLElement>(
      `[data-card-drop-zone="true"][data-card-owner="${owner}"][data-card-zone="${zone}"]:not([data-card-index])`,
    );
    if (!outerEl) return domSlots;
    const outerRect = outerEl.getBoundingClientRect();

    let cardW = 0;
    let cardH = 0;
    let gap = 0;
    if (domSlots.length > 0) {
      cardW = domSlots[0].width;
      cardH = domSlots[0].height;
      if (domSlots.length > 1) {
        gap = domSlots[1].x - domSlots[0].x - cardW;
      } else {
        gap = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--slot-gap"),
        ) || 0;
      }
    } else {
      const rootStyles = getComputedStyle(document.documentElement);
      cardW = Number.parseFloat(rootStyles.getPropertyValue("--card-w")) || 0;
      cardH = Number.parseFloat(rootStyles.getPropertyValue("--card-h")) || 0;
      gap = Number.parseFloat(rootStyles.getPropertyValue("--slot-gap")) || 0;
    }
    if (cardW === 0 || cardH === 0) return domSlots;

    const totalWidth = slotCount * cardW + (slotCount - 1) * gap;
    const centerX = outerRect.left + outerRect.width / 2 - rootRect.left;
    const centerY = outerRect.top + outerRect.height / 2 - rootRect.top;
    const startX = centerX - totalWidth / 2 + cardW / 2;

    const slots: SlotAnchor[] = [];
    for (let i = 0; i < slotCount; i += 1) {
      slots.push({
        x: startX + i * (cardW + gap),
        y: centerY,
        width: cardW,
        height: cardH,
        index: i,
      });
    }
    return slots;
  }

  function handlePointerUp(event: PointerEvent) {
    const root = playmatRef.current;
    const drag = dragRef.current;

    if (!root || !drag || event.pointerId !== drag.pointerId) {
      return;
    }

    event.preventDefault();
    const point = pointFromEvent(root, event);
    const view = viewsRef.current.get(drag.cardId);
    const dropZone = drag.moved ? findDropZone(point, drag.from, drag.cardType) : undefined;
    let toPlacement: CardPlacement | undefined = dropZone?.placement;

    // When the drop lands inside the zone we were previewing, prefer the
    // live reorder index the user just saw over whichever per-slot drop
    // zone the pointer happens to overlap. Works for source-zone reorders
    // (hand → hand, bench → bench) and for cross-zone insertions
    // (hand → bench).
    if (
      toPlacement &&
      drag.reorderIndex != null &&
      drag.previewZone &&
      toPlacement.zone === drag.previewZone.zone &&
      toPlacement.owner === drag.previewZone.owner
    ) {
      toPlacement = { ...toPlacement, index: drag.reorderIndex };
    }

    if (view) {
      view.stopPress();
      view.release(drag.velocity, Boolean(toPlacement));

      if (!drag.moved) {
        view.clickPunch();
      }
    }

    if (toPlacement) {
      onMoveCardRef.current({ cardId: drag.cardId, from: drag.from, to: toPlacement });
    }

    dragRef.current = null;
    // Always re-sync to DOM anchors so a rejected/cancelled drop springs
    // back to the source slot instead of staying at the pointer.
    requestAnimationFrame(measureCards);
    root.classList.remove("is-card-dragging");
    setCursor("");
  }

  function handlePointerCancel(event: PointerEvent) {
    const root = playmatRef.current;
    const drag = dragRef.current;

    if (!root || !drag || event.pointerId !== drag.pointerId) {
      return;
    }

    viewsRef.current.get(drag.cardId)?.stopPress();
    viewsRef.current.get(drag.cardId)?.release(drag.velocity, false);
    dragRef.current = null;
    requestAnimationFrame(measureCards);
    root.classList.remove("is-card-dragging");
    setCursor("");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync/measurement functions read mutable Pixi refs and should only react to descriptor changes.
  useEffect(() => {
    syncViews(descriptors);
    scheduleMeasure();
  }, [descriptors]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Pixi app lifecycle is tied to the mount node, not React render callbacks.
  useEffect(() => {
    const mountElement = mountRef.current;
    if (!mountElement) {
      return undefined;
    }
    const mount = mountElement;

    let disposed = false;
    let app: Application | null = null;
    const scene = new Container();
    scene.sortableChildren = true;

    ensureGsapPixi();

    const tick = (ticker: Ticker) => {
      const time = performance.now() / 1000;
      for (const view of viewsRef.current.values()) {
        view.update(ticker.deltaMS / 1000, time);
      }
    };

    async function start() {
      app = await createPixiApplication(mount);

      if (disposed) {
        app.destroy({ removeView: true }, { children: true });
        return;
      }

      app.stage.sortableChildren = true;
      app.stage.addChild(scene);
      app.ticker.add(tick);
      mount.appendChild(app.canvas);
      appRef.current = app;
      sceneRef.current = scene;
      syncViews(descriptorsRef.current.size ? [...descriptorsRef.current.values()] : descriptors);
      scheduleMeasure();
    }

    start();

    return () => {
      disposed = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      app?.ticker.remove(tick);
      for (const view of viewsRef.current.values()) {
        view.destroy();
      }
      viewsRef.current.clear();
      scene.destroy({ children: true });
      app?.destroy({ removeView: true }, { children: true });
      appRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: native pointer listeners use refs so handlers can stay stable for the root node.
  useEffect(() => {
    const root = playmatRef.current;
    if (!root) {
      return undefined;
    }

    root.addEventListener("pointerdown", handlePointerDown);
    root.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("resize", scheduleMeasure);

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(root);

    return () => {
      root.removeEventListener("pointerdown", handlePointerDown);
      root.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("resize", scheduleMeasure);
      observer.disconnect();
      root.classList.remove("is-card-dragging");
      setCursor("");
    };
  }, [playmatRef]);

  return <div ref={mountRef} className="pixi-cards-layer" aria-hidden="true" />;
}
