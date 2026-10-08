import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Container, type Application, type Ticker } from "pixi.js";
import { ensureGsapPixi } from "../../../lib/animation/gsapPixi";
import { createPixiApplication } from "../../../lib/pixi/createPixiApplication";
import type {
  BoardState,
  CardModel,
  CardBackTone,
  CardMoveRequest,
  CardSelection,
  CardOwner,
  CardPlacement,
  CardType,
  CardZone,
  PlayerId,
  PileState,
  SidePosition,
} from "../types";
import { cardBackImageUrl } from "../pixi/cardBackTexture";
import type { CardBackDesign } from "../pixi/cardBackDesigns";
import {
  CardView,
  type CardViewPresentationOptions,
  type CardViewTarget,
  type ReleaseVelocity,
} from "../pixi/CardView";
import { canPlace, type PlacementPredicate } from "../utils/cardMovement";
import { shouldCollapseBenchAttachments } from "../utils/benchLayout";
import { deckBackId, prizeBackId } from "../utils/piles";
import { energyDiscardsBetween, type EnergyDiscardSnapshot } from "../utils/energyDiscards";
import {
  BONUS_DEAL_DURATION,
  PRIZE_FLIP_DURATION,
  BONUS_TRAVEL_DURATION,
  SETUP_DEAL_STAGGER,
  ownerForTone,
  setupDealsBetween,
  prizeTakesBetween,
  turnDrawsBetween,
  pendingMulliganDrawCounts,
  type SetupAnimationStage,
  type SetupDeal,
  type SetupDealSnapshot,
} from "../utils/setupDeals";
import {
  type CardDescriptor,
  inPlayCardForDisplay,
  prizeCardDescriptors,
} from "../utils/cardDescriptors";
import {
  ATTACHED_CARD_SCALE,
  benchLimitFor,
  CROWDED_BENCH_ATTACHED_ENERGY_STICK,
  DEFAULT_ATTACHED_VISIBLE_STICK,
} from "../constants";
import { cardBackToneFor } from "../utils/players";
import {
  placementIndex,
  zIndexForAttachedEnergy,
  zIndexForAttachedTool,
  zIndexForPlacement,
} from "../utils/zIndex";

interface AnimatedCardsLayerProps {
  board: BoardState;
  perspectivePlayer: PlayerId;
  backDesign: CardBackDesign;
  blueBackPlayer?: PlayerId;
  turnNumber: number;
  activePlayer?: PlayerId;
  deckCounts?: Record<PlayerId, number>;
  piles?: Record<PlayerId, PileState>;
  holdSetupReveal?: boolean;
  onSetupAnimationChange?: (stage: SetupAnimationStage | null) => void;
  onPendingMulliganDrawsChange?: (counts: Record<CardBackTone, number>) => void;
  playmatRef: RefObject<HTMLElement | null>;
  onMoveCard: (request: CardMoveRequest) => void;
  /** Drop-legality gate consulted for drop-zone filtering, the live reorder
      previews and the accept/reject release animation. Defaults to the mock
      sandbox's phase-unaware canPlace; a driver with real rules (/play)
      supplies its own so affordance, preview and dispatch never promise a
      drop the page's engine cannot express. */
  placementPredicate?: PlacementPredicate;
  usableTrainerIds?: ReadonlySet<string>;
  cardSelection?: CardSelection;
}

interface DropZoneSnapshot {
  placement: CardPlacement;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

interface AttachedDragTarget {
  cardId: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  placement: CardPlacement;
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
  attachedCards: AttachedDragTarget[];
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
  evolutionTargetId: string | null;
}

interface PressRevealState {
  pointerId: number;
  revealedCardIds: Set<string>;
  pressedViewId?: string;
}

interface SlotAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

interface CardBadgeAnchor {
  element: HTMLElement;
  cardId: string;
  x: number;
  y: number;
}

interface SetupFlight {
  deal: SetupDeal;
  view: CardView;
  startAt: number;
  endsAt: number;
  source: CardViewTarget | null;
  destination: CardViewTarget | null;
  destinationId?: string;
  faceUrl: string;
  revealed: boolean;
  started: boolean;
  landed: boolean;
}

interface DiscardFlight {
  owner: PlayerId;
  view: CardView;
  startAt: number;
  endsAt: number;
  destination: CardViewTarget;
  started: boolean;
}

const DISCARD_FLIGHT_DURATION = 0.65;
const DISCARD_FLIGHT_STAGGER = 0.07;

// Slightly larger than the CSS protrusion: the host Pokémon still covers the
// extra painted area, but the attached card no longer looks overly sliced off
// at the inner edge.
const ATTACHED_CLIP_FRACTION = 0.3;
const TOOL_BEHIND_PEEK = 0.12;
const TOOL_BEHIND_PRESS_PEEK = 0.18;
// Larger than the press peek so tool labels don't get clipped by
// sub-pixel/perspective movement. The host Pokémon still sits above the
// tool, hiding the extra masked area behind it.
const TOOL_BEHIND_CLIP_FRACTION = 0.24;
const PLAYER_IDS: PlayerId[] = ["opponent", "you"];
const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [aria-label='Game log']";

function cardTextureUrl(card: CardModel) {
  // Card faces come from remote image URLs; backs use the synthetic `back://`
  // scheme. Cards without catalog artwork keep the empty fallback.
  return card.imageUrl ?? "";
}

function cardPresentationOptions(descriptor: CardDescriptor): CardViewPresentationOptions {
  const isAttached = descriptor.placement.zone === "attached";
  const isBehindAttachment = descriptor.attachedPresentation === "behind";
  const isBehindTool = isBehindAttachment && descriptor.card.type === "tool";
  // Deck/prize backs deliberately get the FULL treatment now — idle float,
  // ambient mesh tilt, and hover lift/scale/tilt — so they animate exactly like
  // playable cards. (Their radial hover lift is already damped by
  // BACK_HOVER_LIFT_SCALE in CardView.) Only attached tool/energy cards stay
  // juice-only, since their host Pokémon owns the hover gesture. They are also
  // no longer slot-locked: locking is what suppressed idle float + mesh warp,
  // and their slots are static so springing to them looks identical at rest.
  return {
    hoverMode: isAttached ? "juice-only" : "full",
    clipTopFraction: isBehindTool
      ? descriptor.attachedSide === "bottom"
        ? TOOL_BEHIND_CLIP_FRACTION
        : null
      : isAttached && !isBehindAttachment
        ? ATTACHED_CLIP_FRACTION
        : null,
    clipBottomFraction:
      isBehindTool && descriptor.attachedSide === "top" ? TOOL_BEHIND_CLIP_FRACTION : null,
    slotLocked: false,
  };
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

function pushAttachedDescriptors(
  descriptors: CardDescriptor[],
  host: CardModel,
  owner: PlayerId,
  hostPlacement: CardPlacement,
  hostZoneSize: number,
  attachedSide: SidePosition,
  attachedPresentation: "side" | "behind" = "side",
  attachedCollapsed = false,
) {
  if (!host.attached) return;
  for (const [index, tool] of host.attached.tools.entries()) {
    descriptors.push({
      card: tool,
      placement: { owner, zone: "attached", index },
      draggable: false,
      zoneSize: hostZoneSize,
      attachedTo: host.id,
      attachedHostPlacement: { ...hostPlacement },
      attachedPresentation,
      attachedSide,
      attachedCollapsed,
    });
  }
  for (const [index, energy] of host.attached.energies.entries()) {
    descriptors.push({
      card: energy,
      placement: { owner, zone: "attached", index },
      draggable: false,
      zoneSize: hostZoneSize,
      attachedTo: host.id,
      attachedHostPlacement: { ...hostPlacement },
      attachedSide,
      attachedCollapsed,
    });
  }
}

function collectCardDescriptors(
  board: BoardState,
  perspectivePlayer: PlayerId,
  backDesign: CardBackDesign,
  blueBackPlayer: PlayerId,
  turnNumber: number,
  holdSetupReveal = false,
): CardDescriptor[] {
  const descriptors: CardDescriptor[] = [];

  for (const owner of PLAYER_IDS) {
    const player = board[owner];
    const tone = cardBackToneFor(owner, blueBackPlayer);
    const backImageUrl = cardBackImageUrl(backDesign, tone);
    // 🆕🆕🆕 D577 — per seat (Area Zero Underdepths widens only a side with a Tera Pokémon).
    const benchLimit = benchLimitFor(board, owner);
    const active = player.active;
    const side: SidePosition = owner === perspectivePlayer ? "bottom" : "top";

    if (active) {
      const placement: CardPlacement = { owner, zone: "active" };
      descriptors.push({
        card: inPlayCardForDisplay(active, backImageUrl, turnNumber === 0 || holdSetupReveal),
        placement,
        draggable: owner === perspectivePlayer,
        zoneSize: 1,
      });
      pushAttachedDescriptors(descriptors, active, owner, placement, 1, side);
    }

    const collapseBenchAttachments = shouldCollapseBenchAttachments(player.bench, benchLimit);

    for (const [index, card] of player.bench.entries()) {
      const placement: CardPlacement = { owner, zone: "bench", index };
      descriptors.push({
        card: inPlayCardForDisplay(card, backImageUrl, turnNumber === 0 || holdSetupReveal),
        placement,
        draggable: owner === perspectivePlayer,
        zoneSize: player.bench.length,
      });
      pushAttachedDescriptors(
        descriptors,
        card,
        owner,
        placement,
        player.bench.length,
        side,
        collapseBenchAttachments ? "behind" : "side",
        collapseBenchAttachments,
      );
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

    // Synthetic back-card descriptors: the deck pile and each still-present
    // prize slot. Routed through the same CardView pipeline as playable cards
    // so they pick up the spring physics, mesh tilt, juice pop, and radial
    // hover lift for free. zone "stadium" with a player owner (vs. the real
    // stadium's owner "global") routes them to the low-z fallback in
    // zIndexForPlacement so they sit beneath the playable cards.
    descriptors.push({
      card: {
        id: deckBackId(owner),
        cardId: `back-${tone}`,
        name: `${owner} deck`,
        type: "trainer",
        imageUrl: backImageUrl,
      },
      placement: { owner, zone: "stadium" },
      draggable: false,
      zoneSize: 1,
    });

    // 🆕🆕🆕 D551 — the prize slots, face-up ones included, off the one mapping
    // (`prizeSlotFaces`); pure and unit-tested in utils/cardDescriptors.ts.
    descriptors.push(
      ...prizeCardDescriptors(player, owner, owner !== perspectivePlayer, tone, backImageUrl),
    );
  }

  if (board.stadium) {
    descriptors.push({
      card: board.stadium,
      placement: { owner: "global", zone: "stadium" },
      draggable: false,
      zoneSize: 1,
    });
  }

  for (const [index, card] of (board.energyChoice?.cards ?? []).entries()) {
    descriptors.push({
      card,
      placement: { owner: perspectivePlayer, zone: "choice", index },
      draggable: true,
      zoneSize: board.energyChoice?.cards.length ?? 0,
    });
  }
  return descriptors;
}

function isCardOwner(value: string): value is CardOwner {
  return value === "you" || value === "opponent" || value === "global";
}

function isPlayerId(value: string): value is PlayerId {
  return value === "you" || value === "opponent";
}

function isCardZone(value: string): value is CardZone {
  return (
    value === "hand" ||
    value === "active" ||
    value === "bench" ||
    value === "stadium" ||
    value === "attached" ||
    value === "playmat" ||
    value === "choice"
  );
}

function parsePlacement(element: HTMLElement): CardPlacement | null {
  const owner = element.dataset.cardOwner;
  const zone = element.dataset.cardZone;

  // Validate the DOM strings against the known literal sets rather than
  // blindly casting — a typo'd data-card-* attribute now fails loudly here
  // instead of flowing a garbage placement into the move logic.
  if (!owner || !zone || !isCardOwner(owner) || !isCardZone(zone)) {
    return null;
  }

  const rawIndex = element.dataset.cardIndex;
  const index = rawIndex !== undefined ? Number(rawIndex) : undefined;
  // A present-but-unparseable index is malformed → reject. A MISSING index is
  // legitimate: the bench frame / hand wrapper container drop zones carry no
  // index and mean "anywhere in this zone" (the move logic appends to the end).
  if (rawIndex !== undefined && !Number.isFinite(index)) {
    return null;
  }

  if (zone === "hand" || zone === "bench" || zone === "attached" || zone === "choice") {
    if (!isPlayerId(owner)) return null;
    return index !== undefined ? { owner, zone, index } : { owner, zone };
  }

  if (zone === "active" || zone === "playmat") {
    if (!isPlayerId(owner)) return null;
    return { owner, zone };
  }

  // stadium — may be the shared global slot or a player's synthetic back.
  return { owner, zone };
}

function pointFromEvent(root: HTMLElement, event: PointerEvent) {
  const rect = root.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

// Descriptor-aware z helpers stay here (they read CardDescriptor); the pure
// placement math they build on lives in ../utils/zIndex (unit-tested).
function zIndexForDraggedAttachment(descriptor: CardDescriptor) {
  if (descriptor.card.type === "tool") return 9_999;
  return 9_998 + placementIndex(descriptor.placement) * 0.01;
}

function zIndexForDescriptor(descriptor: CardDescriptor) {
  if (descriptor.placement.zone === "attached") {
    const hostPlacement = descriptor.attachedHostPlacement;
    if (hostPlacement && descriptor.card.type === "tool") {
      return zIndexForAttachedTool(
        hostPlacement,
        descriptor.zoneSize,
        descriptor.placement.index ?? 0,
      );
    }

    if (hostPlacement && descriptor.card.type === "energy") {
      return zIndexForAttachedEnergy(
        hostPlacement,
        descriptor.zoneSize,
        descriptor.placement.index ?? 0,
      );
    }
  }

  return zIndexForPlacement(descriptor.placement, descriptor.zoneSize, descriptor.card.type);
}

// Drop legality is delegated to the placement predicate — canPlace in
// utils/cardMovement by default (the mock sandbox), or a driver-supplied
// phase-aware gate (/play's gamePlacementPredicate) — so the UI gating and
// whatever actually judges the move stay in lockstep.

function isPointerOverZone(point: { x: number; y: number }, zone: DropZoneSnapshot) {
  return (
    point.x >= zone.x &&
    point.x <= zone.x + zone.width &&
    point.y >= zone.y &&
    point.y <= zone.y + zone.height
  );
}

function shouldIgnorePointer(event: PointerEvent, drag?: DragState) {
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest<HTMLElement>(INTERACTIVE_SELECTOR);
  if (!control) return false;
  // The used-card gallery is also a play target. Only a Trainer dragged
  // from this player's hand may bypass its normal button interaction.
  return !(
    drag?.moved &&
    drag.cardType === "trainer" &&
    drag.from.zone === "hand" &&
    control.dataset.usedTrainersDropZone === "true" &&
    control.dataset.cardOwner === drag.from.owner
  );
}

export function AnimatedCardsLayer({
  board,
  perspectivePlayer,
  backDesign,
  blueBackPlayer = "you",
  turnNumber,
  activePlayer = perspectivePlayer,
  deckCounts,
  piles,
  holdSetupReveal = false,
  onSetupAnimationChange,
  onPendingMulliganDrawsChange,
  playmatRef,
  onMoveCard,
  placementPredicate,
  usableTrainerIds,
  cardSelection,
}: AnimatedCardsLayerProps) {
  const previousTurnRef = useRef(turnNumber);
  const previousSetupRef = useRef<SetupDealSnapshot | null>(null);
  const setupFlightsRef = useRef<SetupFlight[]>([]);
  const previousDiscardRef = useRef<EnergyDiscardSnapshot | null>(null);
  const discardFlightsRef = useRef<DiscardFlight[]>([]);
  const setupFlightSequenceRef = useRef(0);
  const setupAnimationRef = useRef<SetupAnimationStage | null>(null);
  const onSetupAnimationChangeRef = useRef(onSetupAnimationChange);
  const pendingMulliganDrawsRef = useRef({ blue: 0, red: 0 });
  const onPendingMulliganDrawsChangeRef = useRef(onPendingMulliganDrawsChange);
  const currentSetupRef = useRef({ blueBackPlayer, perspectivePlayer, backDesign });
  currentSetupRef.current = { blueBackPlayer, perspectivePlayer, backDesign };
  onSetupAnimationChangeRef.current = onSetupAnimationChange;
  onPendingMulliganDrawsChangeRef.current = onPendingMulliganDrawsChange;
  const mountRef = useRef<HTMLDivElement>(null);
  const liftedMountRef = useRef<HTMLDivElement>(null);
  const trainerUseLabelRef = useRef<HTMLOutputElement>(null);
  const trainerUseCardIdRef = useRef<string | null>(null);
  const appRef = useRef<Application | null>(null);
  const sceneRef = useRef<Container | null>(null);
  const liftedSceneRef = useRef<Container | null>(null);
  const viewsRef = useRef(new Map<string, CardView>());
  const descriptorsRef = useRef(new Map<string, CardDescriptor>());
  const dropZonesRef = useRef<DropZoneSnapshot[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const pressedRevealRef = useRef<PressRevealState | null>(null);
  const hoveredCardIdRef = useRef<string | null>(null);
  const hoveredCardIdsRef = useRef(new Set<string>());
  const rafRef = useRef<number | null>(null);
  const cardBadgesRef = useRef<CardBadgeAnchor[]>([]);
  const reducedMotionRef = useRef(false);
  const onMoveCardRef = useRef(onMoveCard);
  const boardRef = useRef(board);
  // Read through a ref like onMoveCard/board: the pointer handlers are bound
  // once (to the playmat node) and would otherwise capture a stale predicate.
  const placementPredicateRef = useRef(placementPredicate ?? canPlace);
  const usableTrainerIdsRef = useRef(usableTrainerIds);
  const cardSelectionRef = useRef(cardSelection);
  cardSelectionRef.current = cardSelection;
  const blueBackPlayerRef = useRef(blueBackPlayer);
  blueBackPlayerRef.current = blueBackPlayer;
  const abilityCardIdRef = useRef<string | undefined>(undefined);
  const selectedIdsRef = useRef(new Set<string>());
  const selectionPhaseRef = useRef<CardSelection["phase"] | undefined>(undefined);
  const selectionButtonsRef = useRef(new Map<string, HTMLButtonElement>());

  const descriptors = useMemo(
    () =>
      collectCardDescriptors(
        board,
        perspectivePlayer,
        backDesign,
        blueBackPlayer,
        turnNumber,
        holdSetupReveal,
      ),
    [board, perspectivePlayer, backDesign, blueBackPlayer, turnNumber, holdSetupReveal],
  );

  useEffect(() => {
    onMoveCardRef.current = onMoveCard;
  }, [onMoveCard]);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    placementPredicateRef.current = placementPredicate ?? canPlace;
  }, [placementPredicate]);

  useEffect(() => {
    usableTrainerIdsRef.current = usableTrainerIds;
  }, [usableTrainerIds]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = query.matches;
    // Keep the preference live: propagate runtime OS toggles to every existing
    // card so motion is muted/restored without a reload.
    const handleChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
      for (const view of viewsRef.current.values()) {
        view.setReducedMotion(event.matches);
      }
      if (event.matches) {
        clearSetupFlights();
        clearDiscardFlights();
      }
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  function setCursor(cursor: string) {
    const root = playmatRef.current;
    if (root) {
      root.style.cursor = cursor;
    }
  }

  function hoverGroupForCard(cardId: string | null) {
    const ids = new Set<string>();
    if (!cardId) return ids;

    ids.add(cardId);

    // When a Pokémon is hovered, the attached cards should share the hover
    // juice. If the pointer is directly over an attached strip, keep that as
    // the primary hover instead of lifting/tilting the host Pokémon.
    const descriptor = descriptorsRef.current.get(cardId);
    if (!descriptor || descriptor.placement.zone === "attached") {
      return ids;
    }

    for (const attachedDescriptor of descriptorsRef.current.values()) {
      if (attachedDescriptor.attachedTo === cardId) {
        ids.add(attachedDescriptor.card.id);
      }
    }

    return ids;
  }

  function pressRevealOffsetForAttached(descriptor: CardDescriptor) {
    if (descriptor.placement.zone !== "attached") {
      return { x: 0, y: 0 };
    }

    const view = viewsRef.current.get(descriptor.card.id);
    const target = view?.getTargetSnapshot();
    if (!target) {
      return { x: 0, y: 0 };
    }

    if (descriptor.card.type === "tool" && descriptor.attachedPresentation === "behind") {
      const hostCardHeight = target.height / ATTACHED_CARD_SCALE;
      const direction = descriptor.attachedSide === "top" ? 1 : -1;
      return { x: 0, y: direction * hostCardHeight * (TOOL_BEHIND_PRESS_PEEK - TOOL_BEHIND_PEEK) };
    }

    if (
      descriptor.card.type === "energy" &&
      descriptor.attachedHostPlacement?.zone === "bench" &&
      descriptor.attachedCollapsed
    ) {
      return {
        x: target.height * (DEFAULT_ATTACHED_VISIBLE_STICK - CROWDED_BENCH_ATTACHED_ENERGY_STICK),
        y: 0,
      };
    }

    return { x: 0, y: 0 };
  }

  function applyHoveredCards(nextHoveredCardIds: Set<string>) {
    const previousHoveredCardIds = hoveredCardIdsRef.current;

    for (const cardId of previousHoveredCardIds) {
      if (!nextHoveredCardIds.has(cardId)) {
        const view = viewsRef.current.get(cardId);
        view?.setHovered(false);
      }
    }

    for (const cardId of nextHoveredCardIds) {
      const view = viewsRef.current.get(cardId);
      if (!previousHoveredCardIds.has(cardId)) {
        view?.setHovered(true);
      }
    }

    hoveredCardIdsRef.current = nextHoveredCardIds;
  }

  function startPressedReveal(hostCardId: string, pointerId: number, pressedViewId?: string) {
    const revealEntries: Array<{
      cardId: string;
      view: CardView;
      offset: { x: number; y: number };
    }> = [];

    for (const descriptor of descriptorsRef.current.values()) {
      if (descriptor.attachedTo !== hostCardId) {
        continue;
      }

      const view = viewsRef.current.get(descriptor.card.id);
      if (!view) {
        continue;
      }

      const offset = pressRevealOffsetForAttached(descriptor);
      if (offset.x === 0 && offset.y === 0) {
        continue;
      }

      revealEntries.push({ cardId: descriptor.card.id, view, offset });
    }

    if (revealEntries.length === 0) {
      return false;
    }

    stopPressedReveal();

    const revealedCardIds = new Set<string>();
    for (const entry of revealEntries) {
      entry.view.setRevealOffset(entry.offset);
      revealedCardIds.add(entry.cardId);
    }

    pressedRevealRef.current = { pointerId, revealedCardIds, pressedViewId };
    return true;
  }

  function stopPressedReveal(pointerId?: number) {
    const state = pressedRevealRef.current;
    if (!state || (pointerId !== undefined && state.pointerId !== pointerId)) {
      return;
    }

    for (const cardId of state.revealedCardIds) {
      viewsRef.current.get(cardId)?.setRevealOffset({ x: 0, y: 0 });
    }

    if (state.pressedViewId) {
      viewsRef.current.get(state.pressedViewId)?.stopPress();
    }

    pressedRevealRef.current = null;
  }

  function clearHover() {
    if (hoveredCardIdsRef.current.size > 0) {
      applyHoveredCards(new Set());
    }
    hoveredCardIdRef.current = null;
    setCursor("");
  }

  function hitTest(point: { x: number; y: number }, requireDraggable: boolean) {
    const descriptorsById = descriptorsRef.current;

    // Runs on every pointermove — keep it a single linear pass tracking the
    // top-most hit instead of spreading the Map, filtering, and sorting (which
    // allocated an array + closures per move).
    let best: CardView | undefined;
    for (const view of viewsRef.current.values()) {
      const descriptor = descriptorsById.get(view.id);
      if (!descriptor || (requireDraggable && !descriptor.draggable) || !view.hitTest(point)) {
        continue;
      }
      if (!best || view.zIndex > best.zIndex) {
        best = view;
      }
    }

    return best;
  }

  function findDropZone(
    point: { x: number; y: number },
    source: CardPlacement,
    sourceType: CardType,
  ) {
    const board = boardRef.current;
    const legalDrop = placementPredicateRef.current;
    return dropZonesRef.current
      .filter(
        (zone) =>
          isPointerOverZone(point, zone) && legalDrop(board, source, zone.placement, sourceType),
      )
      .sort((a, b) => a.area - b.area)[0];
  }

  function measureCards(snap = false) {
    const root = playmatRef.current;
    if (!root) {
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const descriptorsById = descriptorsRef.current;
    const measuredCardIds = new Set<string>();
    const cardCenters = new Map<string, { x: number; y: number }>();

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

      const rect = element.getBoundingClientRect();
      cardCenters.set(cardId, {
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top + rect.height / 2,
      });

      if (view.isDragging) {
        continue;
      }

      const rotation = Number(element.dataset.cardRotation ?? "0") || 0;
      const target: CardViewTarget = {
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        rotation,
        zIndex: zIndexForDescriptor(descriptor),
        placement: descriptor.placement,
      };

      view.setTarget(target, snap);
    }

    for (const [cardId, view] of viewsRef.current) {
      if (!measuredCardIds.has(cardId) && !view.isDragging) {
        view.hide();
      }
    }

    clearCardBadges();
    for (const element of root.querySelectorAll<HTMLElement>("[data-card-badge-for]")) {
      const cardId = element.dataset.cardBadgeFor;
      const center = cardId ? cardCenters.get(cardId) : undefined;
      if (cardId && center) cardBadgesRef.current.push({ element, cardId, ...center });
    }
    positionCardBadges();

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
    positionTrainerUseLabel();
    measureSetupFlights();
    measureDiscardFlights();
  }

  function positionCardBadges() {
    // Follow the rendered spring position rather than the pointer or slot,
    // so badges stay with their card during drags, reorders, and release.
    for (const badge of cardBadgesRef.current) {
      const view = viewsRef.current.get(badge.cardId);
      const center = view?.getCardCenter();
      if (center) {
        badge.element.style.transform = `translate3d(${center.x - badge.x}px, ${center.y - badge.y}px, 0)`;
      }
      badge.element.toggleAttribute(
        "data-card-badge-lifted",
        Boolean(liftedSceneRef.current && view?.container.parent === liftedSceneRef.current),
      );
    }
    positionSelectionButtons();
  }

  function positionSelectionButtons() {
    const root = playmatRef.current;
    if (!root || selectionButtonsRef.current.size === 0) return;
    for (const [id, button] of selectionButtonsRef.current) {
      const view = viewsRef.current.get(id);
      const target = view?.getTargetSnapshot();
      const rect = target
        ? undefined
        : root
            .querySelector<HTMLElement>(`[data-card-anchor="true"][data-card-id="${id}"]`)
            ?.getBoundingClientRect();
      const rootRect = rect ? root.getBoundingClientRect() : null;
      const center =
        view?.getCardCenter() ??
        (rect &&
          rootRect && {
            x: rect.left - rootRect.left + rect.width / 2,
            y: rect.top - rootRect.top + rect.height / 2,
          });
      if (!center) continue;
      button.style.left = `${center.x}px`;
      button.style.top = `${center.y}px`;
      button.style.width = `${target?.width ?? rect?.width ?? 0}px`;
      button.style.height = `${target?.height ?? rect?.height ?? 0}px`;
    }
  }

  function finishingCardSelection(id: string) {
    const selection = cardSelectionRef.current;
    return (
      (selection?.phase === "submitted" || selection?.phase === "shake") &&
      selection.selectedIds.includes(id)
    );
  }

  function syncCardSelection() {
    const selection = cardSelectionRef.current;
    const selected = new Set(selection?.selectedIds ?? []);
    const glowing = new Set([...selectedIdsRef.current, ...selected]);
    if (abilityCardIdRef.current) glowing.add(abilityCardIdRef.current);
    if (selection?.abilityCardId) glowing.add(selection.abilityCardId);
    for (const id of glowing) {
      viewsRef.current.get(id)?.setSelected(selected.has(id));
      const abilityTone =
        id === selection?.abilityCardId
          ? descriptorsRef.current.get(id)?.placement.owner === blueBackPlayerRef.current
            ? "blue"
            : "red"
          : undefined;
      viewsRef.current
        .get(id)
        ?.setAbilityGlow(
          abilityTone === "blue" ? 0x2695ff : abilityTone === "red" ? 0xff3456 : null,
        );
      const anchor = playmatRef.current?.querySelector<HTMLElement>(
        `[data-card-anchor="true"][data-card-id="${id}"]`,
      );
      if (anchor) {
        if (selected.has(id)) anchor.dataset.adrenaSelected = "true";
        else delete anchor.dataset.adrenaSelected;
        if (abilityTone) anchor.dataset.adrenaAbilityGlow = abilityTone;
        else delete anchor.dataset.adrenaAbilityGlow;
      }
    }
    selectedIdsRef.current = selected;
    abilityCardIdRef.current = selection?.abilityCardId;
    if (selection?.phase === "shake" && selectionPhaseRef.current !== "shake") {
      for (const id of selected) viewsRef.current.get(id)?.shake();
    }
    selectionPhaseRef.current = selection?.phase;
    for (const [id, view] of viewsRef.current) {
      if (!descriptorsRef.current.has(id) && !finishingCardSelection(id)) {
        view.destroy();
        viewsRef.current.delete(id);
      }
    }
    positionSelectionButtons();
  }

  function clearCardBadges() {
    for (const badge of cardBadgesRef.current) {
      badge.element.style.removeProperty("transform");
      badge.element.removeAttribute("data-card-badge-lifted");
    }
    cardBadgesRef.current = [];
  }

  function positionLiftedCards() {
    const scene = sceneRef.current;
    const liftedScene = liftedSceneRef.current;
    if (!scene || !liftedScene) return;
    // DOM badges sit above the board canvas. Lift dragged cards (and their
    // attachments/flights) into a second canvas to preserve that depth order.
    const positionView = (view: CardView) => {
      const parent = view.zIndex >= 9_998 ? liftedScene : scene;
      view.setRenderParent(parent);
    };
    for (const view of viewsRef.current.values()) positionView(view);
    for (const flight of setupFlightsRef.current) positionView(flight.view);
    for (const flight of discardFlightsRef.current) positionView(flight.view);
  }

  function discardTarget(owner: PlayerId): CardViewTarget | null {
    const root = playmatRef.current;
    const element = root?.querySelector<HTMLElement>(
      `[data-card-pile="discard"][data-card-owner="${owner}"] > div`,
    );
    if (!root || !element) return null;
    const rootRect = root.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    // The frame includes padding; the flight lands on the card inside it.
    const card = element.querySelector<HTMLElement>("[data-discard-card], button");
    const targetRect = card?.getBoundingClientRect() ?? rect;
    if (targetRect.width === 0 || targetRect.height === 0) return null;
    return {
      x: targetRect.left - rootRect.left + targetRect.width / 2,
      y: targetRect.top - rootRect.top + targetRect.height / 2,
      width: targetRect.width,
      height: targetRect.height,
      rotation: 0,
      zIndex: 10_000,
      placement: { owner, zone: "stadium" },
    };
  }

  function clearDiscardFlights() {
    for (const flight of discardFlightsRef.current) flight.view.destroy();
    discardFlightsRef.current = [];
  }

  function queueEnergyDiscards(snapshot: EnergyDiscardSnapshot) {
    const previous = previousDiscardRef.current;
    previousDiscardRef.current = snapshot;
    if (
      previous &&
      (previous.turn !== snapshot.turn || previous.blueBackPlayer !== snapshot.blueBackPlayer)
    ) {
      clearDiscardFlights();
    }
    if (reducedMotionRef.current || !sceneRef.current) return;
    const time = performance.now() / 1000;
    for (const [index, { cardId, owner }] of energyDiscardsBetween(previous, snapshot).entries()) {
      const view = viewsRef.current.get(cardId);
      const source = view?.getTargetSnapshot();
      const destination = discardTarget(owner);
      if (!view || !source || !destination) continue;
      // Transfer the existing face from the board to the flight before syncViews removes it.
      viewsRef.current.delete(cardId);
      view.setHovered(false);
      view.stopPress();
      view.setPresentationOptions({ slotLocked: true });
      view.setTarget({ ...source, ...view.getPosition(), zIndex: 10_000 + index }, true);
      const startAt = time + index * DISCARD_FLIGHT_STAGGER;
      discardFlightsRef.current.push({
        owner,
        view,
        startAt,
        endsAt: startAt + DISCARD_FLIGHT_DURATION,
        destination: { ...destination, zIndex: 10_000 + index },
        started: false,
      });
    }
  }

  function measureDiscardFlights() {
    for (const flight of discardFlightsRef.current) {
      const target = discardTarget(flight.owner);
      if (!target) continue;
      const previous = flight.destination;
      flight.destination = { ...target, zIndex: previous.zIndex };
      if (
        flight.started &&
        (previous.x !== target.x ||
          previous.y !== target.y ||
          previous.width !== target.width ||
          previous.height !== target.height)
      ) {
        flight.view.slingTo(flight.destination);
      }
    }
  }

  function advanceDiscardFlights(time: number, dt: number) {
    const remaining: DiscardFlight[] = [];
    for (const flight of discardFlightsRef.current) {
      if (time >= flight.endsAt) {
        flight.view.destroy();
        continue;
      }
      if (!flight.started && time >= flight.startAt) {
        flight.view.slingTo(flight.destination);
        flight.started = true;
      }
      flight.view.update(dt, time);
      remaining.push(flight);
    }
    discardFlightsRef.current = remaining;
  }

  function publishSetupAnimation(stage: SetupAnimationStage | null) {
    if (setupAnimationRef.current === stage) return;
    setupAnimationRef.current = stage;
    onSetupAnimationChangeRef.current?.(stage);
  }

  function publishPendingMulliganDraws() {
    const counts = pendingMulliganDrawCounts(setupFlightsRef.current);
    const previous = pendingMulliganDrawsRef.current;
    if (counts.blue === previous.blue && counts.red === previous.red) return;
    pendingMulliganDrawsRef.current = counts;
    onPendingMulliganDrawsChangeRef.current?.(counts);
  }

  function clearSetupFlights(announce = true) {
    for (const flight of setupFlightsRef.current) {
      if (flight.destinationId) {
        const destination = viewsRef.current.get(flight.destinationId);
        if (destination) destination.container.visible = true;
      }
      flight.view.destroy();
    }
    setupFlightsRef.current = [];
    if (announce) {
      publishSetupAnimation(null);
      publishPendingMulliganDraws();
    } else {
      setupAnimationRef.current = null;
      pendingMulliganDrawsRef.current = { blue: 0, red: 0 };
    }
  }

  function queueSetupDeals(deals: SetupDeal[]) {
    const scene = sceneRef.current;
    if (!scene || reducedMotionRef.current || deals.length === 0) return;
    let nextStart = Math.max(
      performance.now() / 1000,
      ...setupFlightsRef.current.map((flight) => flight.endsAt),
    );
    for (const kind of ["prizes", "draw", "prize-take", "turn-draw"] as const) {
      const batch = deals.filter((deal) => deal.kind === kind);
      if (!batch.length) continue;
      const duration = kind === "prizes" ? PRIZE_FLIP_DURATION : BONUS_DEAL_DURATION;
      for (const [index, deal] of batch.entries()) {
        const startAt = nextStart + index * SETUP_DEAL_STAGGER;
        const view = new CardView({
          id: `setup-deal-${++setupFlightSequenceRef.current}`,
          name:
            kind === "prizes"
              ? "Face-down Prize card"
              : kind === "draw"
                ? "Mulligan bonus card"
                : kind === "prize-take"
                  ? "Prize card"
                  : "Start-of-turn card",
          textureUrl: cardBackImageUrl(currentSetupRef.current.backDesign, deal.tone),
          seed: index / batch.length,
          reducedMotion: false,
          animateTexture: false,
          slotLocked: true,
        });
        view.hide();
        scene.addChild(view.container);
        setupFlightsRef.current.push({
          deal,
          view,
          startAt,
          endsAt: startAt + duration,
          source: null,
          destination: null,
          faceUrl: "",
          revealed: false,
          started: false,
          landed: false,
        });
      }
      nextStart += (batch.length - 1) * SETUP_DEAL_STAGGER + duration;
    }
    publishSetupAnimation(setupFlightsRef.current[0]?.deal.kind ?? null);
    publishPendingMulliganDraws();
  }

  function measureSetupFlights() {
    const root = playmatRef.current;
    const snapshot = previousSetupRef.current;
    if (!root || !snapshot) return;
    for (const flight of setupFlightsRef.current) {
      const owner = ownerForTone(flight.deal.tone, currentSetupRef.current.blueBackPlayer);
      let source = viewsRef.current.get(deckBackId(owner))?.getTargetSnapshot();
      // Empty Prize slots and an exhausted deck retain a measurable source,
      // including after a hot-seat handoff.
      const sourceSlot = root.querySelector<HTMLElement>(
        flight.deal.kind === "prize-take"
          ? `[data-prize-source="${flight.deal.prizeSlot}"][data-card-owner="${owner}"]`
          : `[data-card-pile="deck"][data-card-owner="${owner}"] [data-deck-draw-source="true"]`,
      );
      if (flight.deal.kind === "prize-take") source = undefined;
      if (sourceSlot) {
        const rect = sourceSlot.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        source = {
          x: rect.left + rect.width / 2 - rootRect.left,
          y: rect.top + rect.height / 2 - rootRect.top,
          width: rect.width,
          height: rect.height,
          rotation: 0,
          zIndex: 1,
          placement: { owner, zone: "stadium" },
        };
      }
      if (!source && flight.deal.kind !== "prizes") continue;
      flight.source = source ?? null;
      let destinationId: string | undefined;
      let faceUrl = "";
      if (flight.deal.kind === "prizes") {
        destinationId = prizeBackId(owner, flight.deal.index);
      } else if (owner === currentSetupRef.current.perspectivePlayer) {
        const card = snapshot.board[owner].hand[flight.deal.index];
        destinationId = card?.id;
        faceUrl = card?.imageUrl ?? "";
      }
      flight.destinationId = destinationId;
      flight.destination = destinationId
        ? (viewsRef.current.get(destinationId)?.getTargetSnapshot() ?? null)
        : source
          ? {
              ...source,
              x: root.clientWidth / 2 + ((flight.deal.index % 5) - 2) * 14,
              y: -source.height * 0.6,
            }
          : null;
      // A local handoff can move a draw to the hidden side while it is in flight.
      if (flight.faceUrl !== faceUrl && flight.revealed) {
        flight.view.setTextureUrl(
          cardBackImageUrl(currentSetupRef.current.backDesign, flight.deal.tone),
          false,
        );
        flight.revealed = false;
      }
      flight.faceUrl = faceUrl;
      if (destinationId) viewsRef.current.get(destinationId)?.hide();
    }
  }

  function advanceSetupFlights(time: number, dt: number) {
    const remaining: SetupFlight[] = [];
    for (const flight of setupFlightsRef.current) {
      if (time >= flight.endsAt) {
        if (flight.destinationId) {
          const destination = viewsRef.current.get(flight.destinationId);
          if (destination) destination.container.visible = true;
        }
        flight.view.destroy();
        continue;
      }
      remaining.push(flight);
      if (
        time < flight.startAt ||
        !flight.destination ||
        (flight.deal.kind !== "prizes" && !flight.source)
      ) {
        flight.view.hide();
        continue;
      }
      const elapsed = time - flight.startAt;
      const destination = flight.destination;
      if (flight.deal.kind === "prizes") {
        flight.view.setTarget(destination, true);
        if (!flight.started) flight.view.flipIntoView(PRIZE_FLIP_DURATION);
        flight.started = true;
      } else if (flight.source && !flight.landed) {
        const source = flight.source;
        const distance = Math.hypot(destination.x - source.x, destination.y - source.y);
        // Stop just short of the slot so the drop spring finishes the landing.
        const landingGap = Math.min(destination.height * 0.16, distance * 0.08);
        const progress = Math.min(1, elapsed / BONUS_TRAVEL_DURATION);
        const eased = 1 - (1 - progress) ** 2;
        const travel = eased * (distance > 0 ? 1 - landingGap / distance : 1);
        flight.view.setTarget(
          {
            ...destination,
            x: source.x + (destination.x - source.x) * travel,
            y: source.y + (destination.y - source.y) * travel,
            width: source.width + (destination.width - source.width) * eased,
            height: source.height + (destination.height - source.height) * eased,
            rotation: source.rotation + (destination.rotation - source.rotation) * eased,
            zIndex: 10_000 + flight.deal.index,
          },
          true,
        );
        flight.started = true;
        if (progress === 1) {
          flight.view.slingTo({ ...destination, zIndex: 10_000 + flight.deal.index });
          flight.landed = true;
        }
      } else {
        const target = flight.view.getTargetSnapshot();
        if (
          target?.x !== destination.x ||
          target?.y !== destination.y ||
          target?.width !== destination.width ||
          target?.height !== destination.height
        ) {
          flight.view.slingTo({ ...destination, zIndex: 10_000 + flight.deal.index });
        }
      }
      if (
        flight.deal.kind !== "prizes" &&
        elapsed >= BONUS_TRAVEL_DURATION - 0.04 &&
        !flight.revealed &&
        flight.faceUrl
      ) {
        flight.view.setTextureUrl(flight.faceUrl);
        flight.revealed = true;
      }
      flight.view.container.alpha =
        flight.deal.kind !== "prizes" && !flight.destinationId
          ? 1 -
            Math.max(
              0,
              (elapsed - BONUS_TRAVEL_DURATION) / (BONUS_DEAL_DURATION - BONUS_TRAVEL_DURATION),
            )
          : 1;
      flight.view.update(dt, time);
    }
    setupFlightsRef.current = remaining;
    publishPendingMulliganDraws();
    const active = remaining.find((flight) => time >= flight.startAt) ?? remaining[0];
    publishSetupAnimation(active?.deal.kind ?? null);
  }

  function clearTrainerPlayPreview() {
    trainerUseLabelRef.current?.classList.remove("is-visible");
    if (reducedMotionRef.current) trainerUseCardIdRef.current = null;
  }

  function updateTrainerPlayPreview(
    drag: DragState,
    point: { x: number; y: number },
    event: PointerEvent,
  ) {
    const playmatZone = dropZonesRef.current.find(
      (zone) => zone.placement.zone === "playmat" && isPointerOverZone(point, zone),
    );
    const isTrainerPlay =
      drag.moved &&
      drag.cardType === "trainer" &&
      drag.from.zone === "hand" &&
      !shouldIgnorePointer(event, drag) &&
      playmatZone !== undefined;
    const canUse =
      isTrainerPlay &&
      (usableTrainerIdsRef.current?.has(drag.cardId) ?? true) &&
      placementPredicateRef.current(
        boardRef.current,
        drag.from,
        playmatZone.placement,
        drag.cardType,
      );
    if (isTrainerPlay) trainerUseCardIdRef.current = drag.cardId;
    else if (reducedMotionRef.current) trainerUseCardIdRef.current = null;
    trainerUseLabelRef.current?.classList.toggle("is-visible", isTrainerPlay);
    trainerUseLabelRef.current?.classList.toggle("is-unusable", isTrainerPlay && !canUse);
    positionTrainerUseLabel();
  }

  function positionTrainerUseLabel() {
    const label = trainerUseLabelRef.current;
    const cardId = trainerUseCardIdRef.current;
    if (!label || !cardId) return;
    const view = viewsRef.current.get(cardId);
    let position: { x: number; y: number } | undefined = view?.getCardCenter();
    if (!position) {
      const root = playmatRef.current;
      const card = root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`);
      if (!root || !card) return;
      const rootRect = root.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      position = {
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top + rect.height / 2,
      };
    }
    label.style.removeProperty("left");
    label.style.removeProperty("top");
    label.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) translate(-50%, -50%)`;
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

  function syncViews(nextDescriptors: CardDescriptor[], turnChanged = false) {
    const scene = sceneRef.current;
    const nextDescriptorMap = new Map(
      nextDescriptors.map((descriptor) => [descriptorKey(descriptor), descriptor]),
    );
    descriptorsRef.current = nextDescriptorMap;

    if (!scene) {
      return;
    }

    for (const [cardId, view] of viewsRef.current) {
      if (!nextDescriptorMap.has(cardId) && !finishingCardSelection(cardId)) {
        view.destroy();
        viewsRef.current.delete(cardId);
      }
    }

    for (const descriptor of nextDescriptors) {
      const cardId = descriptorKey(descriptor);
      const existingView = viewsRef.current.get(cardId);
      const textureUrl = cardTextureUrl(descriptor.card);

      const presentationOptions = cardPresentationOptions(descriptor);

      if (existingView) {
        existingView.setTextureUrl(textureUrl, !turnChanged);
        existingView.setPresentationOptions(presentationOptions);
        continue;
      }

      const view = new CardView({
        id: descriptor.card.id,
        name: descriptor.card.name,
        textureUrl,
        seed: cardSeed(descriptor.card.id),
        reducedMotion: reducedMotionRef.current,
        animateTexture: !turnChanged,
        ...presentationOptions,
      });
      viewsRef.current.set(cardId, view);
      scene.addChild(view.container);
    }
  }

  function updateHover(point: { x: number; y: number }, event: PointerEvent) {
    // Selection buttons cover the card faces, so their pointer movement still
    // drives card hover. Other controls continue to suppress card interaction.
    const selectingCard =
      event.target instanceof Element && event.target.closest(".adrena-brain-target") !== null;
    if (dragRef.current || (shouldIgnorePointer(event) && !selectingCard)) {
      clearHover();
      return;
    }

    // Hover applies to every card (incl. opponent's) — only the cursor
    // signals draggability via "grab".
    const view = hitTest(point, false);
    const nextHoveredCardId = view?.id ?? null;

    if (hoveredCardIdRef.current !== nextHoveredCardId) {
      hoveredCardIdRef.current = nextHoveredCardId;
      applyHoveredCards(hoverGroupForCard(nextHoveredCardId));
    }

    if (view) {
      view.updateHoverPoint(point);
      const descriptor = descriptorsRef.current.get(view.id);
      setCursor(
        selectingCard
          ? "pointer"
          : descriptor?.draggable && !cardSelectionRef.current
            ? "grab"
            : "",
      );
      return;
    }

    setCursor("");
  }

  function collectAttachedDragTargets(
    hostCardId: string,
    hostPosition: { x: number; y: number },
  ): AttachedDragTarget[] {
    const attachedCards: AttachedDragTarget[] = [];

    for (const descriptor of descriptorsRef.current.values()) {
      if (descriptor.attachedTo !== hostCardId) {
        continue;
      }

      const attachedView = viewsRef.current.get(descriptor.card.id);
      const target = attachedView?.getTargetSnapshot();
      if (!attachedView || !target) {
        continue;
      }

      const position = attachedView.getPosition();
      attachedCards.push({
        cardId: descriptor.card.id,
        offsetX: position.x - hostPosition.x,
        offsetY: position.y - hostPosition.y,
        width: target.width,
        height: target.height,
        rotation: target.rotation,
        zIndex: zIndexForDraggedAttachment(descriptor),
        placement: target.placement,
      });
    }

    return attachedCards;
  }

  function moveAttachedCardsWithHost(drag: DragState, hostX: number, hostY: number) {
    for (const attached of drag.attachedCards) {
      const view = viewsRef.current.get(attached.cardId);
      if (!view) {
        continue;
      }

      view.setTarget({
        x: hostX + attached.offsetX,
        y: hostY + attached.offsetY,
        width: attached.width,
        height: attached.height,
        rotation: attached.rotation,
        zIndex: attached.zIndex,
        placement: attached.placement,
      });
    }
  }

  function setCardTargetWithAttached(
    descriptor: CardDescriptor,
    view: CardView,
    target: CardViewTarget,
  ) {
    const previousHostTarget = view.getTargetSnapshot();
    view.setTarget(target);

    if (!previousHostTarget) {
      return;
    }

    for (const attachedDescriptor of descriptorsRef.current.values()) {
      if (attachedDescriptor.attachedTo !== descriptor.card.id) {
        continue;
      }

      const attachedView = viewsRef.current.get(attachedDescriptor.card.id);
      const previousAttachedTarget = attachedView?.getTargetSnapshot();
      if (!attachedView || !previousAttachedTarget || attachedView.isDragging) {
        continue;
      }

      const attachedIndex = placementIndex(attachedDescriptor.placement);
      const zIndex =
        attachedDescriptor.card.type === "tool"
          ? target.zIndex - 0.1 + Math.min(attachedIndex, 9) * 0.01
          : attachedDescriptor.card.type === "energy"
            ? target.zIndex - 0.2 + Math.min(attachedIndex, 9) * 0.01
            : previousAttachedTarget.zIndex;

      attachedView.setTarget({
        ...previousAttachedTarget,
        x: target.x + previousAttachedTarget.x - previousHostTarget.x,
        y: target.y + previousAttachedTarget.y - previousHostTarget.y,
        zIndex,
      });
    }
  }

  function startAttachedCardsDrag(drag: DragState, hostX: number, hostY: number) {
    moveAttachedCardsWithHost(drag, hostX, hostY);

    for (const attached of drag.attachedCards) {
      viewsRef.current.get(attached.cardId)?.startLinkedDrag(attached.zIndex);
    }
  }

  function releaseAttachedCards(drag: DragState, accepted: boolean, clicked = false) {
    for (const attached of drag.attachedCards) {
      const view = viewsRef.current.get(attached.cardId);
      if (!view) {
        continue;
      }

      view.releaseLinkedDrag(drag.velocity, accepted);
      if (clicked) {
        view.clickPunch();
      }
    }
  }

  function handlePointerDown(event: PointerEvent) {
    if (setupFlightsRef.current.length > 0 || cardSelectionRef.current !== undefined) return;
    const root = playmatRef.current;
    if (!root || event.button !== 0 || shouldIgnorePointer(event)) {
      return;
    }

    // A drag is already in flight (e.g. a second touch on a multitouch screen).
    // Ignore the extra pointer — otherwise it would overwrite dragRef with the
    // new pointerId, and the first card's pointerup (carrying the old id) would
    // be dropped by handlePointerUp's id guard, stranding it in a dragging state.
    if (dragRef.current) {
      return;
    }

    const point = pointFromEvent(root, event);
    const view = hitTest(point, false);
    const descriptor = view ? descriptorsRef.current.get(view.id) : undefined;
    const placement = view?.placement;

    if (!view || !descriptor || !placement) {
      return;
    }

    const revealHostCardId =
      descriptor.placement.zone === "attached" ? descriptor.attachedTo : view.id;

    if (!descriptor.draggable) {
      if (!revealHostCardId || !startPressedReveal(revealHostCardId, event.pointerId, view.id)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearHover();
      view.startPress();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearHover();

    const viewPosition = view.getPosition();
    const attachedCards = collectAttachedDragTargets(view.id, viewPosition);
    const dragState: DragState = {
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
      attachedCards,
      reorderIndex: null,
      previewZone: null,
      evolutionTargetId: null,
    };
    dragRef.current = dragState;

    root.classList.add("is-card-dragging");
    setCursor("grabbing");
    view.startPress();
    view.startDrag();
    startAttachedCardsDrag(dragState, viewPosition.x, viewPosition.y);
    positionLiftedCards();
    positionCardBadges();
    startPressedReveal(revealHostCardId ?? view.id, event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    const root = playmatRef.current;
    if (!root) {
      return;
    }

    const point = pointFromEvent(root, event);
    const drag = dragRef.current;

    if (!drag) {
      if (pressedRevealRef.current?.pointerId === event.pointerId) {
        event.preventDefault();
        return;
      }

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

    const draggedX = point.x - drag.offsetX;
    const draggedY = point.y - drag.offsetY;
    view.dragTo(draggedX, draggedY);
    moveAttachedCardsWithHost(drag, draggedX, draggedY);
    updateTrainerPlayPreview(drag, point, event);
    updateEvolutionPreview(drag, point, event);

    const nextPreviewZone = detectPreviewZone(drag, point);

    // If the preview zone changed (or vanished), snap the previously
    // previewed zone back to its canonical DOM layout. Without this the
    // hand stays "open" with a gap after the cursor moves to the bench,
    // and vice versa.
    const isOldSource =
      !!drag.previewZone &&
      drag.previewZone.owner === drag.from.owner &&
      drag.previewZone.zone === drag.from.zone;
    const isNewSource =
      !!nextPreviewZone &&
      nextPreviewZone.owner === drag.from.owner &&
      nextPreviewZone.zone === drag.from.zone;

    // Resync the previously previewed *external* zone if the cursor has
    // moved off it. The source zone is re-applied below in either reorder
    // or compact mode every frame, so it doesn't need to be resynced.
    if (drag.previewZone && !isOldSource) {
      const externalChanged =
        !nextPreviewZone ||
        nextPreviewZone.owner !== drag.previewZone.owner ||
        nextPreviewZone.zone !== drag.previewZone.zone;
      if (externalChanged) {
        resyncZoneCards(drag.previewZone.owner, drag.previewZone.zone);
      }
    }

    drag.reorderIndex = null;

    // Source-zone preview is applied every frame for any hand/bench drag.
    // "reorder" leaves the dragged card's slot empty inside the source so
    // the user can slide it back into place. "compact" closes the gap when
    // the cursor leaves the source — the hand should look like it has one
    // fewer card while the player is staging a play onto the bench. Whether
    // sliding into a NEW slot is even possible is the predicate's call: the
    // mock's canPlace allows hand/bench reorders, while /play's phase-aware
    // gate allows bench reorders during setup and the viewer's turn. Previewing a
    // reorder that can never dispatch would be a lie, so an illegal source
    // reorder previews as "compact" too and the drop springs back.
    if (
      (drag.from.zone === "hand" || drag.from.zone === "bench") &&
      (drag.from.owner === "you" || drag.from.owner === "opponent")
    ) {
      const sourceReorderLegal =
        isNewSource &&
        placementPredicateRef.current(
          boardRef.current,
          drag.from,
          { owner: drag.from.owner, zone: drag.from.zone },
          drag.cardType,
        );
      applyReorderPreview(
        drag,
        drag.from.owner,
        drag.from.zone,
        sourceReorderLegal ? "reorder" : "compact",
      );
    }

    // External zone preview: only when the cursor is over a different
    // reorderable zone (e.g. dragging a hand card across the bench).
    if (nextPreviewZone && !isNewSource) {
      applyReorderPreview(drag, nextPreviewZone.owner, nextPreviewZone.zone, "reorder");
    }

    drag.previewZone = nextPreviewZone;
  }

  function updateEvolutionPreview(
    drag: DragState,
    point: { x: number; y: number },
    event: PointerEvent,
  ) {
    let targetId: string | null = null;
    if (drag.cardType === "pokemon" && drag.from.zone === "hand" && !shouldIgnorePointer(event)) {
      const board = boardRef.current;
      const card = board[drag.from.owner].hand.find((candidate) => candidate.id === drag.cardId);
      const placement = findDropZone(point, drag.from, drag.cardType)?.placement;
      if (placement?.owner === drag.from.owner) {
        const target =
          placement.zone === "active"
            ? board[placement.owner].active
            : placement.zone === "bench" && placement.index !== undefined
              ? board[placement.owner].bench[placement.index]
              : undefined;
        if (target && card?.evolutionTargetIds?.includes(target.id)) targetId = target.id;
      }
    }
    if (targetId !== null && targetId !== drag.evolutionTargetId) {
      viewsRef.current.get(targetId)?.shake();
    }
    drag.evolutionTargetId = targetId;
  }

  function detectPreviewZone(
    drag: DragState,
    point: { x: number; y: number },
  ): { owner: PlayerId; zone: "hand" | "bench" } | null {
    const board = boardRef.current;
    // Tools/energies attach to an existing Pokémon when dropped on the
    // bench/active — they aren't inserted as a new sibling there, so the
    // reorder preview must not shuffle a board zone around them (which would
    // also let the pointer-up reorderIndex override rewrite the attach slot to
    // an insertion position). Inside the hand they're ordinary cards and
    // rearrange like any other, so only board zones are skipped for them.
    const attachesOnBoard = drag.cardType === "tool" || drag.cardType === "energy";
    // Iterate smallest-first so we prefer the most specific slot drop zone
    // when slot zones nest inside a wider zone container.
    const candidates = dropZonesRef.current
      .filter((dz) => isPointerOverZone(point, dz))
      .sort((a, b) => a.area - b.area);

    for (const dz of candidates) {
      const zone = dz.placement.zone;
      if (zone !== "hand" && zone !== "bench") continue;
      if (attachesOnBoard && zone !== "hand") continue;
      const owner = dz.placement.owner;
      if (owner !== "you" && owner !== "opponent") continue;
      // Cursor over the source zone always yields a preview zone (whether it
      // previews as a reorder or a compacted gap is the pointermove handler's
      // predicate call). External insertion requires the drop to be legal.
      const isSourceZone = drag.from.owner === owner && drag.from.zone === zone;
      // An occupied bench slot can accept an evolution without adding a
      // sibling. Only preview insertion when the whole zone accepts a new
      // occupant, preserving the original slot index for evolution drops.
      const previewTarget: CardPlacement =
        zone === "bench" && !isSourceZone ? { owner, zone } : dz.placement;
      if (
        !isSourceZone &&
        !placementPredicateRef.current(board, drag.from, previewTarget, drag.cardType)
      ) {
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
    mode: "reorder" | "compact",
  ) {
    const root = playmatRef.current;
    if (!root) return;

    const draggedView = viewsRef.current.get(drag.cardId);
    if (!draggedView) return;

    const isSourceZone = drag.from.owner === previewOwner && drag.from.zone === previewZone;

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

    // "reorder": siblings + 1 slots, the extra one is the gap for the
    // dragged card at insertIdx. "compact": exactly `siblings.length`
    // slots, no gap — used to close up the source zone when the cursor
    // leaves it.
    const slotCount = mode === "reorder" ? siblings.length + 1 : siblings.length;

    if (siblings.length === 0) {
      if (mode === "reorder") {
        drag.reorderIndex = 0;
      }
      return;
    }

    if (mode === "compact") {
      const slots = getPreviewSlots(
        previewZone,
        previewOwner,
        siblings.length,
        siblings.map((s) => s.descriptor),
      );
      if (slots.length === 0) return;
      const zoneSize = slots.length;

      // Place each sibling at slot[j] of the (N-1)-card layout. No gap is
      // reserved, so the source zone looks like the dragged card has been
      // taken out.
      for (let j = 0; j < siblings.length; j += 1) {
        const slot = slots[j];
        const sibling = siblings[j];
        if (!slot || !sibling) continue;
        const placement: CardPlacement = {
          owner: previewOwner,
          zone: previewZone,
          index: j,
        };
        setCardTargetWithAttached(sibling.descriptor, sibling.view, {
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
          rotation: 0,
          zIndex: zIndexForPlacement(placement, zoneSize),
          placement,
        });
      }
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

    const draggedDescriptor = descriptorsRef.current.get(drag.cardId);
    const virtualDescriptors = siblings.map((s) => s.descriptor);
    if (draggedDescriptor) {
      virtualDescriptors.splice(insertIdx, 0, draggedDescriptor);
    }

    const slots = getPreviewSlots(
      previewZone,
      previewOwner,
      slotCount,
      virtualDescriptors.length === slotCount ? virtualDescriptors : undefined,
    );
    if (slots.length === 0) return;
    const zoneSize = slots.length;

    for (let j = 0; j < siblings.length; j += 1) {
      const virtualIndex = j < insertIdx ? j : j + 1;
      const slot = slots[virtualIndex];
      if (!slot) continue;

      const sibling = siblings[j];
      if (!sibling) continue;
      const placement: CardPlacement = {
        owner: previewOwner,
        zone: previewZone,
        index: virtualIndex,
      };
      setCardTargetWithAttached(sibling.descriptor, sibling.view, {
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        rotation: 0,
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
      setCardTargetWithAttached(descriptor, view, {
        x: rect.left - rootRect.left + rect.width / 2,
        y: rect.top - rootRect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
        rotation: 0,
        zIndex: zIndexForDescriptor(descriptor),
        placement: descriptor.placement,
      });
    }
  }

  function getPreviewSlots(
    zone: "hand" | "bench",
    owner: PlayerId,
    slotCount: number,
    orderedDescriptors?: CardDescriptor[],
  ): SlotAnchor[] {
    if (zone === "bench" && orderedDescriptors?.length === slotCount) {
      const attachmentAwareSlots = getBenchSlotsForOrder(owner, orderedDescriptors);
      if (attachmentAwareSlots.length > 0) {
        return attachmentAwareSlots;
      }
    }

    return getZoneSlots(zone, owner, slotCount);
  }

  function getBenchSlotsForOrder(owner: PlayerId, orderedDescriptors: CardDescriptor[]) {
    const root = playmatRef.current;
    if (!root || orderedDescriptors.length === 0) return [];

    const outerEl = root.querySelector<HTMLElement>(
      `[data-card-drop-zone="true"][data-card-owner="${owner}"][data-card-zone="bench"]:not([data-card-index])`,
    );
    if (!outerEl) return [];

    const rootRect = root.getBoundingClientRect();
    const outerRect = outerEl.getBoundingClientRect();
    const rootStyles = getComputedStyle(root);
    const gap = Number.parseFloat(rootStyles.getPropertyValue("--slot-gap")) || 0;

    const shouldCollapseAttachments = shouldCollapseBenchAttachments(
      orderedDescriptors.map((descriptor) => descriptor.card),
      benchLimitFor(boardRef.current, owner),
    );

    let cardW = 0;
    let cardH = 0;
    for (const descriptor of orderedDescriptors) {
      if (descriptor.placement.zone !== "bench" || descriptor.placement.owner !== owner) {
        continue;
      }

      const target = viewsRef.current.get(descriptor.card.id)?.getTargetSnapshot();
      if (target) {
        cardW = target.width;
        cardH = target.height;
        break;
      }
    }
    if (cardW === 0 || cardH === 0) {
      const slot = root.querySelector<HTMLElement>(
        `[data-card-drop-zone="true"][data-card-owner="${owner}"][data-card-zone="bench"][data-card-index]`,
      );
      const rect = slot?.getBoundingClientRect();
      cardW = rect?.width ?? 0;
      cardH = rect?.height ?? 0;
    }
    if (cardW === 0 || cardH === 0) return [];

    const attachedStrip = cardH * ATTACHED_CARD_SCALE * DEFAULT_ATTACHED_VISIBLE_STICK;
    const crowdedEnergyStrip = cardH * ATTACHED_CARD_SCALE * CROWDED_BENCH_ATTACHED_ENERGY_STICK;
    const margins = orderedDescriptors.map((descriptor, index) => {
      const hasTool = (descriptor.card.attached?.tools.length ?? 0) > 0;
      const hasEnergy = (descriptor.card.attached?.energies.length ?? 0) > 0;
      const previousHasEnergy =
        (orderedDescriptors[index - 1]?.card.attached?.energies.length ?? 0) > 0;
      return {
        left:
          shouldCollapseAttachments && previousHasEnergy
            ? -crowdedEnergyStrip
            : hasTool && !shouldCollapseAttachments
              ? attachedStrip
              : 0,
        right:
          hasEnergy && (!shouldCollapseAttachments || index < orderedDescriptors.length - 1)
            ? shouldCollapseAttachments
              ? crowdedEnergyStrip
              : attachedStrip
            : 0,
      };
    });

    const totalWidth =
      cardW * orderedDescriptors.length +
      gap * Math.max(0, orderedDescriptors.length - 1) +
      margins.reduce((sum, margin) => sum + margin.left + margin.right, 0);
    const centerX = outerRect.left + outerRect.width / 2 - rootRect.left;
    const centerY = outerRect.top + outerRect.height / 2 - rootRect.top;
    let cursorX = centerX - totalWidth / 2;

    return orderedDescriptors.map((_descriptor, index) => {
      const margin = margins[index] ?? { left: 0, right: 0 };
      cursorX += margin.left;
      const x = cursorX + cardW / 2;
      cursorX += cardW + margin.right + gap;
      return {
        x,
        y: centerY,
        width: cardW,
        height: cardH,
        index,
      } satisfies SlotAnchor;
    });
  }

  function getZoneSlots(zone: "hand" | "bench", owner: PlayerId, slotCount: number): SlotAnchor[] {
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

    // DOM positions match the canonical layout for N rendered cards. Use
    // them directly when the requested count matches — that keeps source-
    // zone reorder pixel-perfect against the DOM. For any other count
    // (compact = N-1, external insertion = N+1) we compute a fresh
    // centred layout below, inferring card width and per-slot step from
    // existing DOM slots so hand overlap and bench gap both work.
    if (domSlots.length === slotCount) {
      return domSlots;
    }

    const outerEl = root.querySelector<HTMLElement>(
      `[data-card-drop-zone="true"][data-card-owner="${owner}"][data-card-zone="${zone}"]:not([data-card-index])`,
    );
    if (!outerEl) return domSlots;
    const outerRect = outerEl.getBoundingClientRect();

    let cardW = 0;
    let cardH = 0;
    // Per-slot step = card_w + gap (bench) or card_w + overlap (hand,
    // overlap negative so step < card_w). Read from two adjacent DOM
    // slots when available; otherwise fall back to CSS-derived defaults
    // for that zone.
    let step = 0;
    const first = domSlots[0];
    const second = domSlots[1];
    if (first && second) {
      cardW = first.width;
      cardH = first.height;
      step = second.x - first.x;
    } else if (first) {
      cardW = first.width;
      cardH = first.height;
      if (zone === "hand") {
        // Hand.tsx: marginLeft = -0.2 * card-w
        step = cardW * 0.8;
      } else {
        const gap =
          Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--slot-gap"),
          ) || 0;
        step = cardW + gap;
      }
    } else {
      const rootStyles = getComputedStyle(document.documentElement);
      cardW = Number.parseFloat(rootStyles.getPropertyValue("--card-w")) || 0;
      cardH = Number.parseFloat(rootStyles.getPropertyValue("--card-h")) || 0;
      if (zone === "hand") {
        step = cardW * 0.8;
      } else {
        const gap = Number.parseFloat(rootStyles.getPropertyValue("--slot-gap")) || 0;
        step = cardW + gap;
      }
    }
    if (cardW === 0 || cardH === 0) return domSlots;

    const totalWidth = cardW + (slotCount - 1) * step;
    const centerX = outerRect.left + outerRect.width / 2 - rootRect.left;
    const centerY = outerRect.top + outerRect.height / 2 - rootRect.top;
    const startX = centerX - totalWidth / 2 + cardW / 2;

    const slots: SlotAnchor[] = [];
    for (let i = 0; i < slotCount; i += 1) {
      slots.push({
        x: startX + i * step,
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

    if (!root) {
      return;
    }

    if (!drag) {
      if (pressedRevealRef.current?.pointerId === event.pointerId) {
        event.preventDefault();
        stopPressedReveal(event.pointerId);
        setCursor("");
      }
      return;
    }

    if (event.pointerId !== drag.pointerId) {
      return;
    }

    event.preventDefault();
    const point = pointFromEvent(root, event);
    clearTrainerPlayPreview();
    const view = viewsRef.current.get(drag.cardId);
    const dropZone =
      drag.moved && !shouldIgnorePointer(event, drag)
        ? findDropZone(point, drag.from, drag.cardType)
        : undefined;
    let toPlacement: CardPlacement | undefined = dropZone?.placement;
    if (
      toPlacement?.zone === "playmat" &&
      drag.cardType === "trainer" &&
      usableTrainerIdsRef.current !== undefined &&
      !usableTrainerIdsRef.current.has(drag.cardId)
    ) {
      toPlacement = undefined;
    }

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
    releaseAttachedCards(drag, Boolean(toPlacement), !drag.moved);
    stopPressedReveal(event.pointerId);

    if (toPlacement) {
      onMoveCardRef.current({ cardId: drag.cardId, from: drag.from, to: toPlacement });
    }

    dragRef.current = null;
    // Always re-sync to DOM anchors so a rejected/cancelled drop springs
    // back to the source slot instead of staying at the pointer.
    requestAnimationFrame(() => measureCards());
    root.classList.remove("is-card-dragging");
    setCursor("");
  }

  function handlePointerCancel(event: PointerEvent) {
    const root = playmatRef.current;
    const drag = dragRef.current;

    if (!root) {
      return;
    }

    if (!drag) {
      if (pressedRevealRef.current?.pointerId === event.pointerId) {
        stopPressedReveal(event.pointerId);
        setCursor("");
      }
      return;
    }

    if (event.pointerId !== drag.pointerId) {
      return;
    }

    viewsRef.current.get(drag.cardId)?.stopPress();
    clearTrainerPlayPreview();
    viewsRef.current.get(drag.cardId)?.release(drag.velocity, false);
    releaseAttachedCards(drag, false);
    stopPressedReveal(event.pointerId);
    dragRef.current = null;
    requestAnimationFrame(() => measureCards());
    root.classList.remove("is-card-dragging");
    setCursor("");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync/measurement functions read mutable Pixi refs and should only react to descriptor changes.
  useLayoutEffect(() => {
    const snapshot = { board, blueBackPlayer, turn: turnNumber, activePlayer, deckCounts };
    const handoff =
      previousSetupRef.current !== null &&
      previousSetupRef.current.blueBackPlayer !== blueBackPlayer;
    const deals = [
      ...setupDealsBetween(previousSetupRef.current, snapshot),
      ...prizeTakesBetween(previousSetupRef.current, snapshot, perspectivePlayer),
      ...turnDrawsBetween(previousSetupRef.current, snapshot),
    ];
    previousSetupRef.current = snapshot;
    const turnChanged = previousTurnRef.current !== turnNumber;
    previousTurnRef.current = turnNumber;
    queueEnergyDiscards({ board, piles, turn: turnNumber, blueBackPlayer });
    syncViews(descriptors, turnChanged || handoff);
    queueSetupDeals(deals);
    measureCards(turnChanged || handoff);
    scheduleMeasure();
  }, [
    descriptors,
    turnNumber,
    blueBackPlayer,
    activePlayer,
    deckCounts?.you,
    deckCounts?.opponent,
    piles,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: selection synchronisation reads the current Pixi views through refs.
  useLayoutEffect(() => {
    syncCardSelection();
  }, [cardSelection, descriptors]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Pixi app lifecycle is tied to the mount node, not React render callbacks.
  useEffect(() => {
    const mountElement = mountRef.current;
    const liftedMountElement = liftedMountRef.current;
    if (!mountElement || !liftedMountElement) {
      return undefined;
    }
    const mount = mountElement;
    const liftedMount = liftedMountElement;

    let disposed = false;
    let app: Application | null = null;
    let liftedApp: Application | null = null;
    const scene = new Container();
    scene.sortableChildren = true;
    const liftedScene = new Container();
    liftedScene.sortableChildren = true;
    let liftedWasVisible = false;

    ensureGsapPixi();

    const tick = (ticker: Ticker) => {
      const time = performance.now() / 1000;
      for (const view of viewsRef.current.values()) {
        view.update(ticker.deltaMS / 1000, time);
      }
      advanceSetupFlights(time, ticker.deltaMS / 1000);
      advanceDiscardFlights(time, ticker.deltaMS / 1000);
      positionLiftedCards();
      positionCardBadges();
      positionTrainerUseLabel();
      const liftedVisible = liftedScene.children.length > 0;
      if (liftedVisible || liftedWasVisible) liftedApp?.render();
      liftedWasVisible = liftedVisible;
    };

    async function start() {
      let created: Application | null = null;
      let createdLifted: Application | null = null;
      try {
        created = await createPixiApplication(mount);
        if (!disposed) {
          createdLifted = await createPixiApplication(liftedMount, { autoStart: false });
        }
      } catch (error) {
        // WebGL is unavailable/blocked or the context failed to create. Drop the
        // class that hides the static DOM card faces so the playmat degrades to
        // those instead of rendering nothing (mirrors GlowRenderer's fallback).
        console.error(
          "Pixi cards layer failed to initialise; falling back to static DOM cards.",
          error,
        );
        playmatRef.current?.classList.remove("has-pixi-cards");
        clearSetupFlights();
        created?.destroy({ removeView: true }, { children: true });
        createdLifted?.destroy({ removeView: true }, { children: true });
        return;
      }

      if (disposed) {
        created.destroy({ removeView: true }, { children: true });
        createdLifted?.destroy({ removeView: true }, { children: true });
        return;
      }
      app = created;
      liftedApp = createdLifted;

      app.stage.sortableChildren = true;
      app.stage.addChild(scene);
      if (liftedApp) {
        liftedApp.stage.addChild(liftedScene);
        liftedMount.appendChild(liftedApp.canvas);
      }
      app.ticker.add(tick);
      mount.appendChild(app.canvas);
      appRef.current = app;
      sceneRef.current = scene;
      liftedSceneRef.current = liftedScene;
      syncViews(descriptorsRef.current.size ? [...descriptorsRef.current.values()] : descriptors);
      syncCardSelection();
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
      clearCardBadges();
      clearSetupFlights(false);
      clearDiscardFlights();
      for (const view of viewsRef.current.values()) {
        view.destroy();
      }
      viewsRef.current.clear();
      scene.destroy({ children: true });
      liftedScene.destroy({ children: true });
      app?.destroy({ removeView: true }, { children: true });
      liftedApp?.destroy({ removeView: true }, { children: true });
      appRef.current = null;
      sceneRef.current = null;
      liftedSceneRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: native pointer listeners use refs so handlers can stay stable for the root node.
  useEffect(() => {
    const root = playmatRef.current;
    if (!root) {
      return undefined;
    }

    const rootElement = root;

    rootElement.addEventListener("pointerdown", handlePointerDown);
    rootElement.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("resize", scheduleMeasure);

    const observedElements = new Set<Element>();
    const resizeObserver = new ResizeObserver(scheduleMeasure);

    function observeElement(element: Element) {
      if (observedElements.has(element)) return;
      resizeObserver.observe(element);
      observedElements.add(element);
    }

    function observeMeasurementTargets() {
      observeElement(rootElement);
      for (const element of rootElement.querySelectorAll<HTMLElement>(
        '[data-card-anchor="true"], [data-card-drop-zone="true"]',
      )) {
        observeElement(element);
      }
    }

    // Coalesce the full-subtree discovery scan to once per frame. The DOM
    // mutates in bursts during a board change/reorder; previously the
    // querySelectorAll above ran once per MutationObserver batch. scheduleMeasure
    // is already rAF-coalesced, so now both the scan and the measure run at
    // most once per frame.
    let observeRaf: number | null = null;
    function scheduleObserveTargets() {
      if (observeRaf !== null) return;
      observeRaf = requestAnimationFrame(() => {
        observeRaf = null;
        observeMeasurementTargets();
      });
    }

    const mutationObserver = new MutationObserver(() => {
      scheduleObserveTargets();
      scheduleMeasure();
    });
    observeMeasurementTargets();
    scheduleMeasure();
    mutationObserver.observe(rootElement, { childList: true, subtree: true });

    return () => {
      rootElement.removeEventListener("pointerdown", handlePointerDown);
      rootElement.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("resize", scheduleMeasure);
      if (observeRaf !== null) {
        cancelAnimationFrame(observeRaf);
      }
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      rootElement.classList.remove("is-card-dragging");
      clearTrainerPlayPreview();
      setCursor("");
    };
  }, [playmatRef]);

  return (
    <>
      <div ref={mountRef} className="pixi-cards-layer" aria-hidden="true" />
      <div
        ref={liftedMountRef}
        className="pixi-cards-layer pixi-cards-layer--lifted"
        aria-hidden="true"
      />
      {cardSelection?.candidates.map((card) => (
        <button
          key={card.id}
          ref={(element) => {
            if (element) selectionButtonsRef.current.set(card.id, element);
            else selectionButtonsRef.current.delete(card.id);
          }}
          type="button"
          aria-label={`Select ${card.name} for Adrena-Brain`}
          className="adrena-brain-target"
          onClick={() => cardSelection.onSelect(card.id)}
        />
      ))}
      <output
        ref={trainerUseLabelRef}
        className="trainer-use-label"
        aria-hidden="true"
        onTransitionEnd={(event) => {
          if (
            event.propertyName === "opacity" &&
            !event.currentTarget.classList.contains("is-visible")
          ) {
            trainerUseCardIdRef.current = null;
          }
        }}
      >
        USE
      </output>
    </>
  );
}
