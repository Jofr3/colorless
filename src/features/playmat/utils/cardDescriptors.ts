import type {
  CardBackTone,
  CardModel,
  CardPlacement,
  PlayerBoard,
  PlayerId,
  SidePosition,
} from "../types";
import { prizeBackId, prizeSlotFaces } from "./piles";

// Pure (pixi-free) pieces of the animation layer's descriptor collection, so they are
// unit-testable without a canvas. AnimatedCardsLayer turns each descriptor into one
// CardView keyed by `card.id`.

/** One card the Pixi layer draws: its model, where it sits, and how it presents. */
export interface CardDescriptor {
  card: CardModel;
  placement: CardPlacement;
  draggable: boolean;
  zoneSize: number;
  attachedTo?: string;
  attachedHostPlacement?: CardPlacement;
  attachedPresentation?: "side" | "behind";
  attachedSide?: SidePosition;
  attachedCollapsed?: boolean;
}

/** 🆕🆕🆕 D551 — the prize grid's synthetic descriptors, one per still-present slot, read off
    `prizeSlotFaces` (the ONE row-index -> grid-slot mapping PrizeGrid reads too). zone
    "stadium" with a player owner routes them to the low-z fallback in zIndexForPlacement.

    ID-STABLE SLOTS (the D551 ruling): EVERY slot keeps the id `prizeBackId(owner, slot)`,
    face-up or not, so a Crescent Purge flips the slot's existing CardView in place — the
    layer's `setTextureUrl` sync swaps its texture — rather than destroying a back and
    spawning a new view. A face-up slot takes `cardId`, `name`, `type` and `imageUrl` from
    the face-up card's model; a scan-less card keeps `imageUrl` undefined (NOT the back),
    exactly as a scan-less Active or Benched card does. The accepted price: when a
    lower-index face-DOWN prize is taken the row compacts, the face-up card moves one slot,
    and those two slot views each swap texture (a later slice may reverse this if the
    flicker reads badly). */
export function prizeCardDescriptors(
  player: PlayerBoard,
  owner: PlayerId,
  flipped: boolean,
  tone: CardBackTone,
  backImageUrl: string,
): CardDescriptor[] {
  const descriptors: CardDescriptor[] = [];
  const faces = prizeSlotFaces(player.prizesRemaining, player.faceUpPrizes, flipped);
  for (const [slot, face] of faces.entries()) {
    if (face === null) continue;
    const card: CardModel =
      face === "back"
        ? {
            id: prizeBackId(owner, slot),
            cardId: `back-${tone}`,
            name: `${owner} prize ${slot}`,
            type: "trainer",
            imageUrl: backImageUrl,
          }
        : {
            id: prizeBackId(owner, slot),
            cardId: face.card.cardId,
            name: face.card.name,
            type: face.card.type,
            imageUrl: face.card.imageUrl,
          };
    descriptors.push({
      card,
      placement: { owner, zone: "stadium" },
      draggable: false,
      zoneSize: 1,
    });
  }
  return descriptors;
}
