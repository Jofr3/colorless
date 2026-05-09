import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { gsap } from "gsap";
import BalatroHoverCard from "../tcg/BalatroHoverCard";
import {
  BALATRO_HOVER_TUNING_DEFAULTS,
  getBalatroHoverTuning,
  resetBalatroHoverTuning,
  setBalatroHoverTuning,
  subscribeBalatroHoverTuning,
  type BalatroHoverTuning,
} from "../tcg/balatroTuning";
import { prefersReducedMotion } from "../tcg/prefersReducedMotion";

type EnergyType =
  | "grass"
  | "fire"
  | "water"
  | "lightning"
  | "psychic"
  | "fighting"
  | "darkness"
  | "metal"
  | "fairy"
  | "dragon"
  | "colorless";

export const CARD_W = 140;
export const WRAPPER_CLASSES =
  "playmat-wrapper w-full h-screen flex flex-col text-white relative overflow-hidden";

const CENTER_LINE_TOP = "calc((100vh - var(--hand-h)) / 2)";

const SLOT_BASE =
  "relative rounded-xl bg-white/[0.045] backdrop-blur-[3px] ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]";

type CardBackTone = "blue" | "red";

type CardBackSize = "card" | "prize";

function CardBackAtSize({
  tone,
  size = "card",
}: {
  tone: CardBackTone;
  size?: CardBackSize;
}) {
  return (
    <div
      className={`card-back card-back--${size}`}
      data-card-back-tone={tone}
      aria-hidden="true"
      style={{
        width: size === "prize" ? "var(--prize-w)" : "var(--card-w)",
        height: size === "prize" ? "var(--prize-h)" : "var(--card-h)",
      }}
    />
  );
}

function PileFrame({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <div
      data-slot
      className={`${SLOT_BASE} ${active ? "ring-amber-300/60 shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_28px_rgba(252,211,77,0.30),inset_0_1px_0_rgba(255,255,255,0.15)]" : ""}`}
      style={{
        width: "calc(var(--card-w) + 12px)",
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      {children}
    </div>
  );
}

function DeckPileSized({ backTone }: { backTone: CardBackTone }) {
  return (
    <div className="relative inline-block">
      <PileFrame>
        <BalatroHoverCard back={backTone}>
          <CardBackAtSize tone={backTone} />
        </BalatroHoverCard>
      </PileFrame>
    </div>
  );
}

function DiscardPileSized() {
  return (
    <div className="relative inline-block">
      <PileFrame>
        <div style={{ width: "var(--card-w)", height: "var(--card-h)" }} />
      </PileFrame>
    </div>
  );
}

function PrizeGridCompact({
  remaining,
  backTone,
  flip = false,
}: {
  remaining: number;
  backTone: CardBackTone;
  flip?: boolean;
}) {
  const total = 6;
  const COLS = 2;
  const ROWS = 3;
  const taken = Math.max(0, Math.min(total, total - remaining));
  const slots = Array.from({ length: total }, (_, i) =>
    flip ? i >= taken : i < total - taken,
  );
  const rows = Array.from({ length: ROWS }, (_, r) =>
    slots.slice(r * COLS, r * COLS + COLS),
  );
  return (
    <div
      data-slot
      className={SLOT_BASE}
      style={{
        width: "calc(var(--prize-w) + var(--prize-w) + var(--prize-gap-x) + 12px)",
        height:
          "calc(var(--prize-h) + var(--prize-h) + var(--prize-h) + var(--prize-gap-y) + var(--prize-gap-y) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      <div className="flex flex-col">
        {rows.map((row, r) => (
          <div
            key={r}
            className="flex"
            style={{ marginTop: r === 0 ? 0 : "var(--prize-gap-y)" }}
          >
            {row.map((present, c) => (
              <div
                key={c}
                style={{
                  marginLeft: c === 0 ? 0 : "var(--prize-gap-x)",
                  zIndex: r * COLS + c,
                  width: "var(--prize-w)",
                  height: "var(--prize-h)",
                }}
              >
                {present && (
                  <BalatroHoverCard back={backTone} className="balatro-hover-card--prize">
                    <CardBackAtSize tone={backTone} size="prize" />
                  </BalatroHoverCard>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface PokeState {
  id: string;
  name: string;
  cardId: string;
  hp?: number;
  type?: EnergyType;
  damage?: number;
}

type PlayerId = "you" | "opponent";
type SidePosition = "top" | "bottom";

interface PlayerBoardState {
  active: PokeState | null;
  bench: PokeState[];
  prizesRemaining: number;
}

interface BoardState {
  hand: PokeState[];
  stadium: PokeState | null;
  you: PlayerBoardState;
  opponent: PlayerBoardState;
}

type CardLocation =
  | { kind: "hand"; owner: PlayerId; index: number }
  | { kind: "bench"; owner: PlayerId; index: number }
  | { kind: "active"; owner: PlayerId };

type DropTarget =
  | { kind: "hand"; owner: PlayerId; index?: number }
  | { kind: "bench"; owner: PlayerId; index?: number }
  | { kind: "active"; owner: PlayerId }
  | { kind: "stadium" };

interface DragCardData {
  card: PokeState;
  location: CardLocation;
}

interface DropTargetData {
  target: DropTarget;
}

type RowDropPreview = Extract<DropTarget, { kind: "hand" | "bench" }> & { index: number };

interface DragRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ReleaseMotion {
  rect: DragRect;
  velocityX: number;
  velocityY: number;
}

interface DragMotionSample {
  rect: DragRect;
  time: number;
  velocityX: number;
  velocityY: number;
}

interface DragState {
  card: PokeState;
  rect: DragRect;
}

type ReleaseRectsRef = { current: Map<string, ReleaseMotion> };

const BENCH_LIMIT = 5;
const BALATRO_LAYOUT_DURATION = 0.42;
// The release-animation z-index lives in index.css (.balatro-release-lift)
// rather than as a JS constant — the lift uses class toggles instead of
// inline-style writes for React-reconciliation safety.
const DRAG_OVERLAY_Z_INDEX = 1200;
const CARD_DRAG_HOVER_SUPPRESSION_MS = 600;
const CARD_DRAG_INTERACTION_EVENT = "tcg-card-drag-start";

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
const DRAG_MOTION_VELOCITY_SMOOTHING = 0.65;
const DRAG_MOTION_STALE_MS = 120;

function setCardDragInteractionLock(active: boolean) {
  if (typeof document === "undefined") return;

  if (active) {
    delete document.body.dataset.cardHoverSuppressedUntil;
    document.body.dataset.cardDragging = "true";
    document.dispatchEvent(new CustomEvent(CARD_DRAG_INTERACTION_EVENT));
  } else {
    delete document.body.dataset.cardDragging;
    document.body.dataset.cardHoverSuppressedUntil = String(
      performance.now() + CARD_DRAG_HOVER_SUPPRESSION_MS,
    );
  }
}

function playerBackTone(player: PlayerId): CardBackTone {
  return player === "you" ? "blue" : "red";
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === "you" ? "opponent" : "you";
}

const opponentActive: PokeState = {
  id: "opponent-active-mega-zygarde",
  name: "Mega Zygarde ex",
  hp: 340,
  type: "fighting",
  damage: 40,
  cardId: "me3-47",
};

const opponentBench: PokeState[] = [
  { id: "opponent-bench-yveltal", name: "Yveltal ex", hp: 270, type: "darkness", cardId: "me3-53" },
  { id: "opponent-bench-meowth", name: "Meowth ex", hp: 200, type: "colorless", cardId: "me3-62" },
];

const playerActive: PokeState = {
  id: "you-active-mega-starmie",
  name: "Mega Starmie ex",
  hp: 300,
  type: "water",
  damage: 20,
  cardId: "me3-21",
};

const playerBench: PokeState[] = [
  { id: "you-bench-decidueye", name: "Decidueye ex", hp: 280, type: "grass", cardId: "sv3-15" },
  { id: "you-bench-yveltal", name: "Yveltal ex", hp: 270, type: "darkness", cardId: "me3-53" },
  { id: "you-bench-meowth", name: "Meowth ex", hp: 200, type: "colorless", cardId: "me3-62" },
];

const initialStadium: PokeState = {
  id: "stadium-lumiose-city",
  name: "Lumiose City",
  cardId: "me3-111",
};

const playerHand: PokeState[] = [
  { id: "hand-decidueye", cardId: "sv3-15", name: "Decidueye ex" },
  { id: "hand-meowth", cardId: "me3-62", name: "Meowth ex" },
  { id: "hand-rosa-1", cardId: "me3-123", name: "Rosa's Encouragement" },
  { id: "hand-core-memory", cardId: "me3-70", name: "Core Memory" },
  { id: "hand-yveltal", cardId: "me3-53", name: "Yveltal ex" },
  { id: "hand-rosa-2", cardId: "me3-123", name: "Rosa's Encouragement" },
];

const initialBoard: BoardState = {
  hand: playerHand,
  stadium: initialStadium,
  you: {
    active: playerActive,
    bench: playerBench,
    prizesRemaining: 4,
  },
  opponent: {
    active: opponentActive,
    bench: opponentBench,
    prizesRemaining: 5,
  },
};

function dropTargetId(target: DropTarget) {
  switch (target.kind) {
    case "hand":
      return `drop-${target.owner}-hand`;
    case "bench":
      return `drop-${target.owner}-bench`;
    case "active":
      return `drop-${target.owner}-active`;
    case "stadium":
      return "drop-stadium";
  }
}

function cloneBoard(board: BoardState): BoardState {
  return {
    hand: [...board.hand],
    stadium: board.stadium,
    you: {
      ...board.you,
      bench: [...board.you.bench],
    },
    opponent: {
      ...board.opponent,
      bench: [...board.opponent.bench],
    },
  };
}

function getSingleCardTarget(board: BoardState, target: Extract<DropTarget, { kind: "active" | "stadium" }>) {
  return target.kind === "active" ? board[target.owner].active : board.stadium;
}

function setSingleCardTarget(
  board: BoardState,
  target: Extract<DropTarget, { kind: "active" | "stadium" }>,
  card: PokeState | null,
) {
  if (target.kind === "active") {
    board[target.owner].active = card;
  } else {
    board.stadium = card;
  }
}

function clampInsertIndex(index: number | undefined, length: number) {
  return Math.max(0, Math.min(length, index ?? length));
}

function insertCardAt(cards: PokeState[], index: number | undefined, card: PokeState) {
  cards.splice(clampInsertIndex(index, cards.length), 0, card);
}

function sourceBelongsToPlayer(source: CardLocation, player: PlayerId) {
  return source.owner === player;
}

function targetBelongsToPlayer(target: DropTarget, player: PlayerId) {
  return target.kind === "stadium" || target.owner === player;
}

function canActivePlayerMove(source: CardLocation, target: DropTarget, activePlayer: PlayerId) {
  return sourceBelongsToPlayer(source, activePlayer) && targetBelongsToPlayer(target, activePlayer);
}

function canPreviewRowDrop(
  board: BoardState,
  source: CardLocation,
  target: Extract<DropTarget, { kind: "hand" | "bench" }>,
  activePlayer: PlayerId,
) {
  if (!canActivePlayerMove(source, target, activePlayer)) return false;

  if (target.kind === "hand") {
    return source.kind === "hand" && source.owner === target.owner;
  }

  if (source.kind === "hand") {
    return board[target.owner].bench.length < BENCH_LIMIT;
  }

  if (source.kind === "bench") {
    return source.owner === target.owner;
  }

  if (source.kind === "active") {
    return source.owner === target.owner && board[target.owner].bench.length < BENCH_LIMIT;
  }

  return false;
}

function moveCard(board: BoardState, source: CardLocation, target: DropTarget): BoardState {
  if (source.kind === "hand" && target.kind === "hand" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const [sourceCard] = next.hand.splice(source.index, 1);
    if (!sourceCard) return board;
    insertCardAt(next.hand, target.index, sourceCard);
    return next;
  }

  if (source.kind === "hand") {
    const sourceCard = board.hand[source.index];
    if (!sourceCard) return board;

    const next = cloneBoard(board);
    next.hand.splice(source.index, 1);

    if (target.kind === "bench") {
      if (next[target.owner].bench.length >= BENCH_LIMIT) return board;
      insertCardAt(next[target.owner].bench, target.index, sourceCard);
      return next;
    }

    if (target.kind === "active" || target.kind === "stadium") {
      const displacedCard = getSingleCardTarget(next, target);
      setSingleCardTarget(next, target, sourceCard);
      if (displacedCard) insertCardAt(next.hand, source.index, displacedCard);
      return next;
    }

    return board;
  }

  if (source.kind === "bench" && target.kind === "bench" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const [sourceCard] = next[source.owner].bench.splice(source.index, 1);
    if (!sourceCard) return board;
    insertCardAt(next[source.owner].bench, target.index, sourceCard);
    return next;
  }

  if (source.kind === "bench" && target.kind === "active" && source.owner === target.owner) {
    const next = cloneBoard(board);
    const [sourceCard] = next[source.owner].bench.splice(source.index, 1);
    if (!sourceCard) return board;

    const displacedActive = next[source.owner].active;
    next[source.owner].active = sourceCard;
    if (displacedActive) insertCardAt(next[source.owner].bench, source.index, displacedActive);
    return next;
  }

  if (source.kind === "active" && target.kind === "bench" && source.owner === target.owner) {
    if (board[source.owner].bench.length >= BENCH_LIMIT) return board;

    const next = cloneBoard(board);
    const sourceCard = next[source.owner].active;
    if (!sourceCard) return board;

    next[source.owner].active = null;
    insertCardAt(next[source.owner].bench, target.index, sourceCard);
    return next;
  }

  return board;
}

function isDragCardData(data: unknown): data is DragCardData {
  return Boolean(data && typeof data === "object" && "card" in data && "location" in data);
}

function isDropTargetData(data: unknown): data is DropTargetData {
  return Boolean(data && typeof data === "object" && "target" in data);
}

function cardRowKey(kind: "hand" | "bench", owner: PlayerId) {
  return `${kind}-${owner}`;
}

function getDragCenterX(event: DragMoveEvent | DragEndEvent) {
  const rect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  return rect ? rect.left + rect.width / 2 : null;
}

function getInsertIndexFromRow(row: HTMLElement, centerX: number | null) {
  const cards = Array.from(row.querySelectorAll<HTMLElement>("[data-layout-card]"));
  if (centerX === null) return cards.length;

  const index = cards.findIndex((element) => {
    const rect = element.getBoundingClientRect();
    return centerX < rect.left + rect.width / 2;
  });

  return index === -1 ? cards.length : index;
}

function resolveDropTargetIndex(target: DropTarget, event: DragMoveEvent | DragEndEvent): DropTarget {
  if (target.kind !== "hand" && target.kind !== "bench") return target;
  if (typeof document === "undefined") return target;

  const row = document.querySelector<HTMLElement>(`[data-card-row="${cardRowKey(target.kind, target.owner)}"]`);
  if (!row) return target;

  return {
    ...target,
    index: getInsertIndexFromRow(row, getDragCenterX(event)),
  };
}

function toDragRect(rect: { left: number; top: number; width: number; height: number }): DragRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function fallbackDragRect() {
  return { left: 0, top: 0, width: CARD_W, height: CARD_W * 1.4 };
}

function dragRectFromEvent(event: DragStartEvent): DragRect {
  const rect = event.active.rect.current.initial;
  if (rect) return toDragRect(rect);

  // Both the visible source and the hidden in-place clone (used by Hand/Bench
  // to keep dnd-kit's measurement node in the layout while it animates the
  // dragged card via DragOverlay) carry data-draggable-card-id. The hidden
  // clone is marked with data-drag-source-clone="true" — exclude it so we
  // never measure a visibility:hidden, position:absolute, zero-laid-out node.
  const element = document.querySelector<HTMLElement>(
    `[data-draggable-card-id="${event.active.id}"]:not([data-drag-source-clone="true"])`,
  );
  const elementRect = element?.getBoundingClientRect();
  return elementRect ? toDragRect(elementRect) : fallbackDragRect();
}

function dragRectAtRelease(event: DragMoveEvent | DragEndEvent, fallback?: DragRect): DragRect {
  const translatedRect = event.active.rect.current.translated;
  if (translatedRect) return toDragRect(translatedRect);

  const initialRect = event.active.rect.current.initial;
  if (initialRect) {
    return {
      left: initialRect.left + event.delta.x,
      top: initialRect.top + event.delta.y,
      width: initialRect.width,
      height: initialRect.height,
    };
  }

  return fallback ?? fallbackDragRect();
}

function sampleDragMotion(samples: Map<string, DragMotionSample>, cardId: string, rect: DragRect) {
  const now = performance.now();
  const previous = samples.get(cardId);
  if (!previous) {
    samples.set(cardId, { rect, time: now, velocityX: 0, velocityY: 0 });
    return;
  }

  const dt = Math.max((now - previous.time) / 1000, 1 / 1000);
  const instantVelocityX = (rect.left - previous.rect.left) / dt;
  const instantVelocityY = (rect.top - previous.rect.top) / dt;

  samples.set(cardId, {
    rect,
    time: now,
    velocityX:
      previous.velocityX * DRAG_MOTION_VELOCITY_SMOOTHING +
      instantVelocityX * (1 - DRAG_MOTION_VELOCITY_SMOOTHING),
    velocityY:
      previous.velocityY * DRAG_MOTION_VELOCITY_SMOOTHING +
      instantVelocityY * (1 - DRAG_MOTION_VELOCITY_SMOOTHING),
  });
}

function releaseMotionFromDragSample(
  samples: Map<string, DragMotionSample>,
  cardId: string,
  rect: DragRect,
): ReleaseMotion {
  const sample = samples.get(cardId);
  if (!sample) return { rect, velocityX: 0, velocityY: 0 };

  const ageMs = performance.now() - sample.time;
  let velocityX = sample.velocityX;
  let velocityY = sample.velocityY;

  if (ageMs > 8 && ageMs <= DRAG_MOTION_STALE_MS) {
    const dt = Math.max(ageMs / 1000, 1 / 1000);
    velocityX = 0.5 * velocityX + 0.5 * ((rect.left - sample.rect.left) / dt);
    velocityY = 0.5 * velocityY + 0.5 * ((rect.top - sample.rect.top) / dt);
  } else if (ageMs > DRAG_MOTION_STALE_MS) {
    const fade = Math.max(0, 1 - (ageMs - DRAG_MOTION_STALE_MS) / DRAG_MOTION_STALE_MS);
    velocityX *= fade;
    velocityY *= fade;
  }

  return { rect, velocityX, velocityY };
}

function overlayCardStyle(rect: DragRect | undefined): CSSProperties | undefined {
  if (!rect) return undefined;

  return {
    "--card-w": `${rect.width}px`,
    "--card-h": `${rect.height}px`,
  } as CSSProperties;
}

function hiddenDraggedCardStyle(rect: DragRect | undefined): CSSProperties {
  if (!rect) {
    return {
      position: "absolute",
      width: "var(--card-w)",
      visibility: "hidden",
      pointerEvents: "none",
    };
  }

  return {
    // Avoid position: fixed here. Slot frames use backdrop-filter, which creates
    // a containing block for fixed descendants and can double-offset the hidden
    // source node. Keep the node mounted/in-place for dnd-kit measurement, but
    // remove it from layout and visibility.
    position: "absolute",
    width: rect.width,
    height: rect.height,
    visibility: "hidden",
    pointerEvents: "none",
    zIndex: -1,
  };
}

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

function layoutRotationFromDelta(dx: number) {
  // Row previews can retarget several times during one drag. Keep their sway
  // gentler than a release throw so re-sorts slide instead of twitching.
  return Math.max(-3, Math.min(3, dx * 0.012));
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

function stopBalatroReleaseAnimation(element: HTMLElement) {
  releaseAnimationCleanups.get(element)?.();
}

function hasActiveReleaseAnimation(element: HTMLElement) {
  return releaseAnimationCleanups.has(element);
}

function animateReleaseToElement(
  element: HTMLElement,
  releaseMotion: ReleaseMotion,
  onComplete?: () => void,
) {
  stopBalatroReleaseAnimation(element);

  const releaseRect = releaseMotion.rect;
  const targetRect = element.getBoundingClientRect();
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

function useBalatroReleaseAnimation(
  cardId: string | undefined,
  releaseRectsRef?: ReleaseRectsRef,
  releaseAnimationKey = 0,
) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!cardId || !releaseRectsRef) return;

    const releaseMotion = releaseRectsRef.current.get(cardId);
    const element = ref.current;
    if (!releaseMotion || !element) return;

    animateReleaseToElement(element, releaseMotion, () => releaseRectsRef.current.delete(cardId));
  }, [cardId, releaseRectsRef, releaseAnimationKey]);

  return ref;
}

function useBalatroRowAnimation(layoutKey: string, releaseRectsRef?: ReleaseRectsRef) {
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

function CardBox({
  cardId,
  instanceId,
  alt,
  priority,
  bendCenterBoost,
  pressed = false,
  dragging = false,
}: {
  cardId: string;
  instanceId?: string;
  alt: string;
  priority?: boolean;
  bendCenterBoost?: number;
  pressed?: boolean;
  dragging?: boolean;
}) {
  return (
    <div style={{ width: "var(--card-w)" }}>
      <BalatroHoverCard
        cardId={cardId}
        instanceId={instanceId}
        renderedWidth={CARD_W}
        alt={alt}
        priority={priority}
        bendCenterBoost={bendCenterBoost}
        pressed={pressed}
        dragging={dragging}
        className="w-full"
      />
    </div>
  );
}

function DropTargetPileFrame({
  target,
  children,
  active = false,
  disabled = false,
}: {
  target: DropTarget;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dropTargetId(target),
    data: { target } satisfies DropTargetData,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      data-slot
      data-drop-target={target.kind}
      data-drop-owner={"owner" in target ? target.owner : undefined}
      data-drop-disabled={disabled || undefined}
      className={`${SLOT_BASE} transition-all ${active ? "ring-amber-300/60 shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_28px_rgba(252,211,77,0.30),inset_0_1px_0_rgba(255,255,255,0.15)]" : ""} ${isOver ? "ring-2 ring-emerald-300/90 shadow-[0_0_0_1px_rgba(110,231,183,0.55),0_0_34px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]" : ""}`}
      style={{
        width: "calc(var(--card-w) + 12px)",
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      {children}
    </div>
  );
}

function DraggableCard({
  card,
  location,
  priority,
  bendCenterBoost,
  disabled = false,
  sourceClone = false,
}: {
  card: PokeState;
  location: CardLocation;
  priority?: boolean;
  bendCenterBoost?: number;
  disabled?: boolean;
  sourceClone?: boolean;
}) {
  const [pressing, setPressing] = useState(false);
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: card.id,
    data: { card, location } satisfies DragCardData,
    disabled,
  });

  useEffect(() => {
    if (!disabled) return;
    setPressing(false);
  }, [disabled]);

  useEffect(() => {
    if (!pressing) return;

    const stopPressing = () => setPressing(false);
    window.addEventListener("pointerup", stopPressing);
    window.addEventListener("pointercancel", stopPressing);
    window.addEventListener("blur", stopPressing);
    return () => {
      window.removeEventListener("pointerup", stopPressing);
      window.removeEventListener("pointercancel", stopPressing);
      window.removeEventListener("blur", stopPressing);
    };
  }, [pressing]);

  const handlePointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    setPressing(true);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(!disabled ? listeners : {})}
      aria-label={`Drag ${card.name}`}
      aria-disabled={disabled || undefined}
      data-draggable-card-id={card.id}
      // Hidden in-place clone (rendered alongside the visible card while it
      // is in flight via DragOverlay). Marked so dragRectFromEvent's
      // querySelector fallback can exclude it and never measure a
      // visibility:hidden zero-area node.
      data-drag-source-clone={sourceClone || undefined}
      className="relative touch-none select-none"
      style={{ touchAction: "none" }}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <CardBox
        cardId={card.cardId}
        instanceId={card.id}
        alt={card.name}
        priority={priority}
        bendCenterBoost={bendCenterBoost}
        pressed={pressing}
      />
    </div>
  );
}

function ReleasedCard({
  cardId,
  releaseRectsRef,
  releaseAnimationKey,
  children,
}: {
  cardId?: string;
  releaseRectsRef?: ReleaseRectsRef;
  releaseAnimationKey?: number;
  children: ReactNode;
}) {
  const ref = useBalatroReleaseAnimation(cardId, releaseRectsRef, releaseAnimationKey);

  return <div ref={ref}>{children}</div>;
}

function Bench({
  cards,
  owner,
  disabled = false,
  draggingCardId,
  draggingRect,
  dropPreview,
  releaseRectsRef,
}: {
  cards: PokeState[];
  owner: PlayerId;
  disabled?: boolean;
  draggingCardId?: string;
  draggingRect?: DragRect;
  dropPreview?: RowDropPreview | null;
  releaseRectsRef?: ReleaseRectsRef;
}) {
  const target: DropTarget = { kind: "bench", owner };
  const { setNodeRef, isOver } = useDroppable({
    id: dropTargetId(target),
    data: { target } satisfies DropTargetData,
    disabled,
  });
  const visibleCards = cards.filter((card) => card.id !== draggingCardId);
  const previewIndex = draggingCardId && dropPreview?.kind === "bench" && dropPreview.owner === owner
    ? clampInsertIndex(dropPreview.index, visibleCards.length)
    : null;
  const rowRef = useBalatroRowAnimation(
    `bench-${owner}:${visibleCards.map((card) => card.id).join("|")}:gap-${previewIndex ?? "none"}`,
    releaseRectsRef,
  );
  const draggedCard = cards.find((card) => card.id === draggingCardId);

  return (
    <div
      ref={setNodeRef}
      data-slot
      data-drop-target="bench"
      data-drop-owner={owner}
      data-drop-disabled={disabled || undefined}
      className={`${SLOT_BASE} transition-all ${isOver ? "ring-2 ring-emerald-300/90 shadow-[0_0_0_1px_rgba(110,231,183,0.55),0_0_34px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]" : ""}`}
      style={{
        width: `calc(var(--card-w) * ${BENCH_LIMIT} + var(--slot-gap) * ${BENCH_LIMIT - 1} + 12px)`,
        height: "calc(var(--card-h) + 12px)",
        padding: "var(--pile-pad)",
      }}
    >
      <div
        ref={rowRef}
        data-card-row={cardRowKey("bench", owner)}
        className="relative flex h-full w-full items-center justify-center"
        style={{ gap: "var(--slot-gap)" }}
      >
        {visibleCards.map((card, visibleIndex) => (
          <Fragment key={`bench-entry-${card.id}`}>
            {previewIndex === visibleIndex ? (
              <div
                key={`bench-gap-${owner}-${visibleIndex}`}
                aria-hidden="true"
                style={{ flex: "0 0 var(--card-w)", width: "var(--card-w)", height: "var(--card-h)" }}
              />
            ) : null}
            <div
              key={card.id}
              data-layout-card={card.id}
              style={{ width: "var(--card-w)", zIndex: visibleCards.length - visibleIndex }}
            >
              <DraggableCard
                card={card}
                location={{ kind: "bench", owner, index: cards.findIndex((candidate) => candidate.id === card.id) }}
                disabled={disabled}
              />
            </div>
          </Fragment>
        ))}
        {previewIndex === visibleCards.length ? (
          <div
            aria-hidden="true"
            style={{ flex: "0 0 var(--card-w)", width: "var(--card-w)", height: "var(--card-h)" }}
          />
        ) : null}
        {draggedCard ? (
          <div style={hiddenDraggedCardStyle(draggingRect)}>
            <DraggableCard
              card={draggedCard}
              location={{ kind: "bench", owner, index: cards.findIndex((card) => card.id === draggedCard.id) }}
              disabled={disabled}
              sourceClone
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Hand({
  cards,
  owner,
  draggingCardId,
  draggingRect,
  dropPreview,
  releaseRectsRef,
}: {
  cards: PokeState[];
  owner: PlayerId;
  draggingCardId?: string;
  draggingRect?: DragRect;
  dropPreview?: RowDropPreview | null;
  releaseRectsRef?: ReleaseRectsRef;
}) {
  const target: DropTarget = { kind: "hand", owner };
  const { setNodeRef } = useDroppable({
    id: dropTargetId(target),
    data: { target } satisfies DropTargetData,
  });
  const visibleCards = cards.filter((card) => card.id !== draggingCardId);
  const previewIndex = draggingCardId && dropPreview?.kind === "hand" && dropPreview.owner === owner
    ? clampInsertIndex(dropPreview.index, visibleCards.length)
    : null;
  const rowRef = useBalatroRowAnimation(
    `hand-${owner}:${visibleCards.map((card) => card.id).join("|")}:gap-${previewIndex ?? "none"}`,
    releaseRectsRef,
  );
  const draggedCard = cards.find((card) => card.id === draggingCardId);
  let renderedIndex = 0;

  return (
    <div
      ref={setNodeRef}
      data-drop-target="hand"
      data-drop-owner={owner}
      className="flex justify-center items-end px-6 relative z-10"
      style={{ height: "var(--hand-h)", paddingBottom: 8 }}
    >
      <div
        ref={rowRef}
        data-card-row={cardRowKey("hand", owner)}
        className="relative flex h-full items-end justify-center"
      >
        {visibleCards.map((card, visibleIndex) => {
          const cardRenderIndex = renderedIndex++;
          const gapBefore = previewIndex === visibleIndex;

          return (
            <Fragment key={`hand-entry-${card.id}`}>
              {gapBefore ? (
                <div
                  key={`hand-gap-${owner}-${visibleIndex}`}
                  aria-hidden="true"
                  style={{
                    flex: "0 0 var(--card-w)",
                    height: "var(--card-h)",
                    marginLeft: cardRenderIndex === 0 ? 0 : "calc(var(--card-w) * -0.2)",
                    width: "var(--card-w)",
                  }}
                />
              ) : null}
              <div
                key={card.id}
                data-layout-card={card.id}
                style={{
                  marginLeft: (gapBefore ? cardRenderIndex + 1 : cardRenderIndex) === 0 ? 0 : "calc(var(--card-w) * -0.2)",
                  width: "var(--card-w)",
                  zIndex: visibleCards.length - visibleIndex,
                }}
              >
                <DraggableCard
                  card={card}
                  location={{ kind: "hand", owner, index: cards.findIndex((candidate) => candidate.id === card.id) }}
                  priority
                  bendCenterBoost={0}
                />
              </div>
            </Fragment>
          );
        })}
        {previewIndex === visibleCards.length ? (
          <div
            aria-hidden="true"
            style={{
              flex: "0 0 var(--card-w)",
              height: "var(--card-h)",
              marginLeft: visibleCards.length === 0 ? 0 : "calc(var(--card-w) * -0.2)",
              width: "var(--card-w)",
            }}
          />
        ) : null}
        {draggedCard ? (
          <div style={hiddenDraggedCardStyle(draggingRect)}>
            <DraggableCard
              card={draggedCard}
              location={{ kind: "hand", owner, index: cards.findIndex((card) => card.id === draggedCard.id) }}
              priority
              bendCenterBoost={0}
              sourceClone
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IconButton({
  children,
  ariaLabel,
  size = "md",
  onClick,
}: {
  children: ReactNode;
  ariaLabel: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}) {
  const base =
    "relative flex cursor-pointer items-center justify-center rounded-full backdrop-blur-md ring-1 ring-inset transition-all active:scale-95";
  const variant =
    "bg-white/[0.045] hover:bg-white/[0.06] text-white/70 hover:text-white/85 ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]";
  const sizeCls = size === "lg" ? "w-20 h-20" : size === "sm" ? "w-9 h-9" : "w-10 h-10";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={`${base} ${variant} ${sizeCls}`}
    >
      {children}
    </button>
  );
}

function TurnControls({ onPassTurn }: { onPassTurn: () => void }) {
  return (
    <div
      className="absolute z-20 flex flex-col items-center gap-1"
      style={{ right: 24, top: "50%", transform: "translateY(-50%)" }}
    >
      <IconButton size="lg" ariaLabel="Pass turn" onClick={onPassTurn}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h13" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      </IconButton>
      <div className="flex gap-2">
        <IconButton size="sm" ariaLabel="Previous">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </IconButton>
        <IconButton size="sm" ariaLabel="Forward">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function SettingsButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className="absolute" style={{ right: 16, bottom: 16, zIndex: 1001 }}>
      <IconButton ariaLabel={active ? "Close animation tuning" : "Open animation tuning"} onClick={onClick}>
        <svg className="opacity-75" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </IconButton>
    </div>
  );
}

type TuningSliderKey = keyof BalatroHoverTuning;

interface TuningSliderConfig {
  key: TuningSliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const TUNING_SLIDERS: TuningSliderConfig[] = [
  { key: "hoverZoom", label: "Hover zoom", min: 0, max: 0.14, step: 0.005 },
  { key: "juiceDuration", label: "Juice duration", min: 0.08, max: 1.2, step: 0.01 },
  { key: "juiceScaleAmount", label: "Juice scale", min: 0, max: 0.08, step: 0.001 },
  { key: "juiceRotationAmount", label: "Juice rotation", min: 0, max: 0.05, step: 0.001 },
  { key: "scaleEase", label: "Scale spring ease", min: 5, max: 160, step: 1 },
  { key: "rotationEase", label: "Rotation spring ease", min: 20, max: 360, step: 1 },
  { key: "bendBase", label: "Perspective bend", min: 0, max: 0.1, step: 0.001 },
  { key: "bendCenterBoost", label: "Center bend boost", min: 0, max: 1, step: 0.01 },
  { key: "bendCenterRadius", label: "Center boost radius", min: 0, max: 0.8, step: 0.01 },
  { key: "minPerspectiveW", label: "Perspective clamp", min: 0.05, max: 0.8, step: 0.01 },
  { key: "pressZoom", label: "Press/drag zoom", min: 0, max: 0.3, step: 0.005 },
  { key: "dragScaleEase", label: "Drag scale ease", min: 5, max: 160, step: 1 },
  { key: "dragXyEase", label: "Drag XY ease", min: 5, max: 160, step: 1 },
  { key: "dragSway", label: "Drag sway", min: 0, max: 0.06, step: 0.001 },
  { key: "releaseXyEase", label: "Release XY ease", min: 5, max: 160, step: 1 },
  { key: "releaseScaleEase", label: "Release scale ease", min: 5, max: 160, step: 1 },
  { key: "releaseRotationEase", label: "Release rotation ease", min: 20, max: 360, step: 1 },
  { key: "releaseXyAccel", label: "Release XY accel", min: 5, max: 120, step: 1 },
  { key: "releaseRotationFromXVelocity", label: "Release sway", min: 0, max: 0.06, step: 0.001 },
];

function formatSliderValue(value: number, step: number) {
  if (step >= 1) return value.toFixed(0);
  if (step >= 0.01) return value.toFixed(2);
  return value.toFixed(3);
}

function AnimationTuningPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tuning, setTuningState] = useState(getBalatroHoverTuning);

  useEffect(() => {
    return subscribeBalatroHoverTuning(() => setTuningState(getBalatroHoverTuning()));
  }, []);

  if (!open) return null;

  function updateSlider(key: TuningSliderKey, value: number) {
    setBalatroHoverTuning({ [key]: value } as Partial<BalatroHoverTuning>);
  }

  return (
    <div
      className="absolute w-[340px] max-h-[calc(100vh-110px)] overflow-y-auto rounded-2xl border border-white/10 bg-[#10121b]/90 p-4 text-white shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl"
      style={{ right: 16, bottom: 64, zIndex: 1000 }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/65">Animation tuning</div>
          <p className="mt-1 text-xs leading-4 text-white/45">Hover a card while dragging sliders. Values are saved locally.</p>
        </div>
        <button
          type="button"
          aria-label="Close animation tuning"
          onClick={onClose}
          className="rounded-full px-2 py-1 text-sm text-white/55 transition hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </div>

      <div className="space-y-3">
        {TUNING_SLIDERS.map((slider) => {
          const value = tuning[slider.key];
          const defaultValue = BALATRO_HOVER_TUNING_DEFAULTS[slider.key];
          return (
            <label key={slider.key} className="block rounded-xl bg-white/[0.035] p-3 ring-1 ring-inset ring-white/7">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-white/75">{slider.label}</span>
                <span className="font-mono text-white/55">{formatSliderValue(value, slider.step)}</span>
              </div>
              <input
                type="range"
                aria-label={slider.label}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={value}
                onChange={(event) => updateSlider(slider.key, Number(event.currentTarget.value))}
                className="w-full accent-sky-300"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-white/35">
                <span>{formatSliderValue(slider.min, slider.step)}</span>
                <span>default {formatSliderValue(defaultValue, slider.step)}</span>
                <span>{formatSliderValue(slider.max, slider.step)}</span>
              </div>
            </label>
          );
        })}
      </div>

      <button
        type="button"
        onClick={resetBalatroHoverTuning}
        className="mt-4 w-full rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white/70 ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.10] hover:text-white"
      >
        Reset to tuned defaults
      </button>
    </div>
  );
}

interface TurnInfo {
  turn: number;
  activePlayer: PlayerId;
  youName: string;
  opponentName: string;
}

const turnInfo: TurnInfo = {
  turn: 7,
  activePlayer: "you",
  youName: "Jofre",
  opponentName: "Lillie",
};

function PlayerChip({
  name,
  color,
  active,
  align,
  passAnimationKey,
}: {
  name: string;
  color: "rose" | "sky";
  active: boolean;
  align: "left" | "right";
  passAnimationKey: number;
}) {
  const circleRing =
    color === "rose"
      ? active
        ? "ring-2 ring-rose-300/80 shadow-[0_0_18px_rgba(244,114,182,0.55)]"
        : "ring-2 ring-white/9"
      : active
        ? "ring-2 ring-sky-300/80 shadow-[0_0_18px_rgba(56,189,248,0.55)]"
        : "ring-2 ring-white/9";
  const dot = color === "sky" ? "bg-sky-500" : "bg-rose-500";
  const animateIndicator = active && passAnimationKey > 0;
  return (
    <div
      className={`relative flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""} ${active ? "" : "opacity-55"}`}
    >
      <div
        key={animateIndicator ? passAnimationKey : "idle"}
        className={`w-7 h-7 rounded-full ${dot} ${circleRing} ${animateIndicator ? "turn-chip-pass" : ""} flex items-center justify-center text-[12px] font-bold transition-all`}
      >
        {name[0]}
      </div>
      <span className="text-xs font-medium tracking-wide">{name}</span>
    </div>
  );
}

function TurnBanner({
  info,
  passAnimationKey,
}: {
  info: TurnInfo;
  passAnimationKey: number;
}) {
  const yours = info.activePlayer === "you";
  return (
    <div
      className="absolute z-20 flex items-center gap-3 pl-2 pr-2 py-1.5 rounded-full bg-white/[0.07] backdrop-blur-md ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_8px_28px_rgba(0,0,0,0.45)]"
      style={{ top: 16, left: 16 }}
    >
      <PlayerChip
        name={info.opponentName}
        color="rose"
        active={!yours}
        align="left"
        passAnimationKey={passAnimationKey}
      />
      <div className="flex flex-col items-center px-3 border-x border-white/9">
        <span className="text-[9px] uppercase tracking-[0.25em] text-white/45">Turn</span>
        <span className="text-sm font-bold text-white/85 tabular-nums leading-tight">
          {String(info.turn).padStart(2, "0")}
        </span>
      </div>
      <PlayerChip
        name={info.youName}
        color="sky"
        active={yours}
        align="right"
        passAnimationKey={passAnimationKey}
      />
    </div>
  );
}

type LogSource = "you" | "opponent" | "system";

type LogSegmentTone = "default" | "strong" | "energy" | "damage";

interface LogSegment {
  text: string;
  tone?: LogSegmentTone;
}

interface LogActionEntry {
  kind: "action";
  who: LogSource;
  elapsed: string;
  segments: LogSegment[];
}

interface LogTurnDivider {
  kind: "turn";
  turn: number;
}

type LogEntry = LogActionEntry | LogTurnDivider;

const gameLog: LogEntry[] = [
  {
    kind: "action",
    who: "you",
    elapsed: "+02:14",
    segments: [
      { text: "attached " },
      { text: "Water", tone: "energy" },
      { text: " → " },
      { text: "Mega Starmie ex", tone: "strong" },
    ],
  },
  {
    kind: "action",
    who: "you",
    elapsed: "+02:08",
    segments: [
      { text: "played " },
      { text: "Rosa's Encouragement", tone: "strong" },
    ],
  },
  { kind: "turn", turn: 7 },
  {
    kind: "action",
    who: "opponent",
    elapsed: "+01:42",
    segments: [
      { text: "Mega Zygarde ex", tone: "strong" },
      { text: " used Land Crush · " },
      { text: "-60", tone: "damage" },
    ],
  },
  {
    kind: "action",
    who: "opponent",
    elapsed: "+01:30",
    segments: [
      { text: "retreated " },
      { text: "Yveltal ex", tone: "strong" },
    ],
  },
  {
    kind: "action",
    who: "system",
    elapsed: "+01:24",
    segments: [
      { text: "Lillie", tone: "strong" },
      { text: " drew a prize card" },
    ],
  },
];

function SourceBadge({ who }: { who: LogSource }) {
  const label = who === "you" ? "YOU" : who === "opponent" ? "OPP" : "SYS";
  const style =
    who === "you"
      ? "bg-sky-400/95 text-white"
      : who === "opponent"
        ? "bg-rose-500/95 text-white"
        : "border border-dashed border-white/20 bg-white/[0.035] text-white/45";

  return (
    <span
      className={`inline-flex h-[18px] min-w-[24px] items-center justify-center self-center rounded-[5px] px-1 text-[9px] font-extrabold leading-none tracking-[0.04em] ${style}`}
    >
      {label}
    </span>
  );
}

function LogMessage({ segments }: { segments: LogSegment[] }) {
  const toneClass: Record<LogSegmentTone, string> = {
    default: "text-white/72",
    strong: "font-semibold text-white/92",
    energy: "font-semibold text-sky-200",
    damage: "font-extrabold text-rose-200",
  };

  return (
    <span className="min-w-0 flex-1 self-center text-[11.5px] leading-[1.35]">
      {segments.map((segment, index) => (
        <span key={index} className={toneClass[segment.tone ?? "default"]}>
          {segment.text}
        </span>
      ))}
    </span>
  );
}

function GameLog({
  entries,
  turn,
}: {
  entries: LogEntry[];
  turn: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="absolute z-30" style={{ left: 12, bottom: 12 }}>
      {open && (
        <section
          aria-label="Game log"
          className="absolute flex flex-col overflow-hidden rounded-[22px] bg-white/[0.045] backdrop-blur-md ring-1 ring-inset ring-white/9 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]"
          style={{ left: 0, bottom: 52, width: 360, height: "min(420px, calc(100vh - 112px))" }}
        >
          <div className="relative flex items-center justify-between px-4 pb-2.5 pt-3.5 border-b border-white/[0.07]">
            <span className="text-[10px] font-black uppercase tracking-[0.26em] text-white/72">
              Game log
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/48">
              T{turn}
            </span>
          </div>
          <div className="relative flex-1 overflow-y-auto px-3 py-2">
            {entries.map((entry, index) => {
              if (entry.kind === "turn") {
                return (
                  <div
                    key={`turn-${entry.turn}-${index}`}
                    className="-mx-3 flex items-center gap-2 border-y border-white/[0.055] bg-black/18 px-3 py-2"
                  >
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/12 to-white/4" />
                    <span className="text-[10px] font-black uppercase tracking-[0.26em] text-white/62">
                      Turn {entry.turn}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-white/4 via-white/12 to-transparent" />
                  </div>
                );
              }

              const nextEntry = entries[index + 1];
              const hideBottomBorder = nextEntry?.kind === "turn";

              return (
                <div
                  key={`${entry.who}-${entry.elapsed}-${index}`}
                  className={`flex items-center gap-2.5 px-0.5 py-2.5 ${hideBottomBorder ? "" : "border-b border-white/[0.055] last:border-b-0"}`}
                >
                  <SourceBadge who={entry.who} />
                  <LogMessage segments={entry.segments} />
                  <span className="shrink-0 self-center font-mono text-[10px] leading-none text-white/36">
                    {entry.elapsed}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <button
        type="button"
        aria-label={open ? "Hide game log" : "Show game log"}
        onClick={() => setOpen(!open)}
        className="relative w-10 h-10 flex cursor-pointer items-center justify-center rounded-full backdrop-blur-md ring-1 ring-inset ring-white/9 transition-all active:scale-95 bg-white/[0.045] hover:bg-white/[0.06] text-white/70 hover:text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_18px_rgba(0,0,0,0.32)]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </button>
    </div>
  );
}

function StadiumCard({
  card,
  releaseRectsRef,
  releaseAnimationKey,
}: {
  card: PokeState | null;
  releaseRectsRef?: ReleaseRectsRef;
  releaseAnimationKey?: number;
}) {
  return (
    <div className="relative">
      <DropTargetPileFrame target={{ kind: "stadium" }}>
        {card ? (
          <ReleasedCard
            cardId={card.id}
            releaseRectsRef={releaseRectsRef}
            releaseAnimationKey={releaseAnimationKey}
          >
            <CardBox cardId={card.cardId} instanceId={card.id} alt={card.name} priority />
          </ReleasedCard>
        ) : (
          <div style={{ width: "var(--card-w)", height: "var(--card-h)" }} />
        )}
      </DropTargetPileFrame>
    </div>
  );
}

function PlayerSide({
  owner,
  position,
  player,
  draggingCardId,
  draggingRect,
  dropPreview,
  releaseRectsRef,
  releaseAnimationKey,
  isActive = false,
}: {
  owner: PlayerId;
  position: SidePosition;
  player: PlayerBoardState;
  draggingCardId?: string;
  draggingRect?: DragRect;
  dropPreview?: RowDropPreview | null;
  releaseRectsRef?: ReleaseRectsRef;
  releaseAnimationKey?: number;
  isActive?: boolean;
}) {
  const isTop = position === "top";
  const active = player.active;
  const bench = player.bench;
  const prizesRemaining = player.prizesRemaining;
  const canInteract = isActive;
  const backTone = playerBackTone(owner);
  const benchRow = (
    <div className="relative">
      <Bench
        cards={bench}
        owner={owner}
        disabled={!canInteract}
        draggingCardId={draggingCardId}
        draggingRect={draggingRect}
        dropPreview={dropPreview}
        releaseRectsRef={releaseRectsRef}
      />
      <div
        className="absolute top-1/2"
        style={{
          transform: "translateY(calc(-50% + 2px))",
          ...(isTop
            ? { right: "100%", marginRight: "var(--side-gap)" }
            : { left: "100%", marginLeft: "var(--side-gap)" }),
        }}
      >
        <div className="relative">
          <DiscardPileSized />
          <div
            className="absolute left-0"
            style={isTop ? { top: "100%", marginTop: 8 } : { bottom: "100%", marginBottom: 8 }}
          >
            <DeckPileSized backTone={backTone} />
          </div>
        </div>
      </div>
      <div
        className="absolute"
        style={
          isTop
            ? { top: 0, left: "100%", marginLeft: "var(--side-gap)" }
            : { bottom: 0, right: "100%", marginRight: "var(--side-gap)" }
        }
      >
        <PrizeGridCompact remaining={prizesRemaining} backTone={backTone} flip={isTop} />
      </div>
    </div>
  );
  const activeNode = (
    <DropTargetPileFrame target={{ kind: "active", owner }} active={isActive} disabled={!canInteract}>
      {active ? (
        <div
          style={active.id === draggingCardId ? hiddenDraggedCardStyle(draggingRect) : undefined}
        >
          <ReleasedCard
            cardId={active.id}
            releaseRectsRef={releaseRectsRef}
            releaseAnimationKey={releaseAnimationKey}
          >
            <DraggableCard
              card={active}
              location={{ kind: "active", owner }}
              priority
              disabled={!canInteract}
            />
          </ReleasedCard>
        </div>
      ) : null}
    </DropTargetPileFrame>
  );

  return (
    <div
      data-player-owner={owner}
      data-side-position={position}
      className={`flex-1 min-h-0 px-6 flex flex-col items-center gap-2 relative ${isTop ? "justify-start" : "justify-end"}`}
      style={{ paddingTop: isTop ? 16 : 4, paddingBottom: 4 }}
    >
      {isTop ? (
        <>
          {benchRow}
          {activeNode}
        </>
      ) : (
        <>
          {activeNode}
          {benchRow}
        </>
      )}
    </div>
  );
}

export function PlaymatBody() {
  const [info, setInfo] = useState(turnInfo);
  const [board, setBoard] = useState<BoardState>(() => cloneBoard(initialBoard));
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropPreview, setDropPreview] = useState<RowDropPreview | null>(null);
  const [releaseAnimationKey, setReleaseAnimationKey] = useState(0);
  const [passAnimationKey, setPassAnimationKey] = useState(0);
  const [tuningOpen, setTuningOpen] = useState(false);
  const releaseRectsRef = useRef(new Map<string, ReleaseMotion>());
  const dragMotionRef = useRef(new Map<string, DragMotionSample>());
  const activeDragIdRef = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 6px is dnd-kit's common default for touch and sits comfortably above
      // the touch-noise floor on most devices. distance: 1 was below that
      // floor and could trigger drags from sub-pixel finger drift.
      activationConstraint: { distance: 6 },
    }),
  );
  const bottomOwner = info.activePlayer;
  const topOwner = otherPlayer(bottomOwner);
  const draggingCard = dragState?.card ?? null;

  useEffect(() => {
    return () => setCardDragInteractionLock(false);
  }, []);

  function passTurn() {
    setPassAnimationKey((key) => key + 1);
    setInfo((current) => ({
      ...current,
      turn: current.turn + 1,
      activePlayer: otherPlayer(current.activePlayer),
    }));
  }

  function indexedRowTarget(
    target: Extract<DropTarget, { kind: "hand" | "bench" }>,
    event: DragMoveEvent | DragEndEvent,
  ): RowDropPreview | null {
    const resolvedTarget = resolveDropTargetIndex(target, event);
    if (resolvedTarget.kind !== "hand" && resolvedTarget.kind !== "bench") return null;

    return {
      ...resolvedTarget,
      index: resolvedTarget.index ?? 0,
    };
  }

  function getRowDropPreview(event: DragMoveEvent | DragEndEvent) {
    const dragData = event.active.data.current;
    const dropData = event.over?.data.current;

    if (!isDragCardData(dragData)) return null;

    if (isDropTargetData(dropData) && (dropData.target.kind === "hand" || dropData.target.kind === "bench")) {
      const hoveredPreview = indexedRowTarget(dropData.target, event);
      if (hoveredPreview && canPreviewRowDrop(board, dragData.location, hoveredPreview, info.activePlayer)) {
        return hoveredPreview;
      }
    }

    // Balatro keeps the dragged card in its source card area while it is far
    // from valid release targets, so the source row keeps a live space and
    // continues sorting by X. It only transfers areas if released over a target.
    if (dragData.location.kind === "hand" || dragData.location.kind === "bench") {
      const sourcePreview = {
        kind: dragData.location.kind,
        owner: dragData.location.owner,
      } satisfies Extract<DropTarget, { kind: "hand" | "bench" }>;

      if (canPreviewRowDrop(board, dragData.location, sourcePreview, info.activePlayer)) {
        return indexedRowTarget(sourcePreview, event) ?? {
          ...sourcePreview,
          index: dragData.location.index,
        };
      }
    }

    return null;
  }

  function clearDragState() {
    if (activeDragIdRef.current) dragMotionRef.current.delete(activeDragIdRef.current);
    activeDragIdRef.current = null;
    setCardDragInteractionLock(false);
    setDragState(null);
    setDropPreview(null);
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;

    if (!isDragCardData(data) || !sourceBelongsToPlayer(data.location, info.activePlayer)) {
      clearDragState();
      return;
    }

    const sourceRowPreview =
      data.location.kind === "hand" || data.location.kind === "bench"
        ? {
            kind: data.location.kind,
            owner: data.location.owner,
            index: data.location.index,
          }
        : null;

    const dragRect = dragRectFromEvent(event);
    activeDragIdRef.current = data.card.id;
    sampleDragMotion(dragMotionRef.current, data.card.id, dragRect);
    setCardDragInteractionLock(true);
    setDragState({ card: data.card, rect: dragRect });
    setDropPreview(
      sourceRowPreview && canPreviewRowDrop(board, data.location, sourceRowPreview, info.activePlayer)
        ? sourceRowPreview
        : null,
    );
  }

  function handleDragMove(event: DragMoveEvent) {
    if (activeDragIdRef.current !== String(event.active.id)) return;

    const dragData = event.active.data.current;
    if (isDragCardData(dragData)) {
      sampleDragMotion(dragMotionRef.current, dragData.card.id, dragRectAtRelease(event, dragState?.rect));
    }

    setDropPreview((currentPreview) => {
      const nextPreview = getRowDropPreview(event);
      const samePreview =
        currentPreview?.kind === nextPreview?.kind &&
        currentPreview?.owner === nextPreview?.owner &&
        currentPreview?.index === nextPreview?.index;
      return samePreview ? currentPreview : nextPreview;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const dragData = event.active.data.current;
    const dropData = event.over?.data.current;
    const hoveredTarget = isDropTargetData(dropData)
      ? resolveDropTargetIndex(dropData.target, event)
      : null;
    const sourceAreaPreview =
      isDragCardData(dragData) &&
      dropPreview &&
      (dragData.location.kind === "hand" || dragData.location.kind === "bench") &&
      dropPreview.kind === dragData.location.kind &&
      dropPreview.owner === dragData.location.owner
        ? dropPreview
        : null;
    const resolvedTarget = hoveredTarget ?? sourceAreaPreview;

    if (isDragCardData(dragData)) {
      const releaseRect = dragRectAtRelease(event, dragState?.rect);
      releaseRectsRef.current.set(
        dragData.card.id,
        releaseMotionFromDragSample(dragMotionRef.current, dragData.card.id, releaseRect),
      );
      setReleaseAnimationKey((key) => key + 1);
    }

    clearDragState();

    if (!isDragCardData(dragData) || !resolvedTarget) return;

    setBoard((current) =>
      canActivePlayerMove(dragData.location, resolvedTarget, info.activePlayer)
        ? moveCard(current, dragData.location, resolvedTarget)
        : current,
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDragState}
    >
      <span className="sr-only" data-perspective-player={bottomOwner} aria-hidden="true" />
      <PlayerSide
        owner={topOwner}
        player={board[topOwner]}
        position="top"
        draggingCardId={draggingCard?.id}
        draggingRect={dragState?.rect}
        dropPreview={dropPreview}
        releaseRectsRef={releaseRectsRef}
        releaseAnimationKey={releaseAnimationKey}
        isActive={info.activePlayer === topOwner}
      />
      <PlayerSide
        owner={bottomOwner}
        player={board[bottomOwner]}
        position="bottom"
        draggingCardId={draggingCard?.id}
        draggingRect={dragState?.rect}
        dropPreview={dropPreview}
        releaseRectsRef={releaseRectsRef}
        releaseAnimationKey={releaseAnimationKey}
        isActive={info.activePlayer === bottomOwner}
      />
      <Hand
        cards={board.hand}
        owner={bottomOwner}
        draggingCardId={draggingCard?.id}
        draggingRect={dragState?.rect}
        dropPreview={dropPreview}
        releaseRectsRef={releaseRectsRef}
      />
      <div
        className="absolute z-10"
        style={{
          left: "50%",
          top: CENTER_LINE_TOP,
          transform: "translate(calc(-150% - var(--side-gap) - 24px), -50%)",
        }}
      >
        <StadiumCard
          card={board.stadium}
          releaseRectsRef={releaseRectsRef}
          releaseAnimationKey={releaseAnimationKey}
        />
      </div>
      <TurnControls onPassTurn={passTurn} />
      <AnimationTuningPanel open={tuningOpen} onClose={() => setTuningOpen(false)} />
      <SettingsButton active={tuningOpen} onClick={() => setTuningOpen((open) => !open)} />
      <TurnBanner info={info} passAnimationKey={passAnimationKey} />
      <GameLog entries={gameLog} turn={info.turn} />
      <DragOverlay dropAnimation={null} zIndex={DRAG_OVERLAY_Z_INDEX}>
        {draggingCard ? (
          <div className="pointer-events-none" style={overlayCardStyle(dragState?.rect)}>
            {/*
              Use a distinct instanceId for the overlay copy so it does not
              collide with the still-mounted (but hidden) source DraggableCard
              inside its row. Both register with the module-level
              BalatroDomCardAnimator, which keys visual state by instanceId
              and would otherwise have them stomp each other every frame.
            */}
            <CardBox
              cardId={draggingCard.cardId}
              instanceId={`${draggingCard.id}-overlay`}
              alt={draggingCard.name}
              priority
              bendCenterBoost={0}
              dragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
