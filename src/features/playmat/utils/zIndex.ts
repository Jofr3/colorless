// Pure z-index math for the animated card layer, extracted from
// AnimatedCardsLayer so the stacking order — easy to get subtly wrong, and with
// no DOM to render in a test — is unit-tested. The layer keeps its
// descriptor-aware wrappers (zIndexForDescriptor, zIndexForDraggedAttachment)
// that build on these; getZoneSlots and friends read the DOM and can't move.

import type { CardPlacement, CardType } from "../types";

/** Reads the array index off a placement that may or may not carry one
    (active/stadium never do; bench/hand/attached may omit it for a whole-zone
    container drop), for host-relative attachment stacking. */
export function placementIndex(placement: CardPlacement): number {
  if (placement.zone === "active" || placement.zone === "stadium") return 0;
  return placement.index ?? 0;
}

/** Base z-index for a card by zone: hand rides highest, then bench, then the
    active Pokémon; attachments sit just under their host and the shared stadium
    lowest. Later cards in a zone sit *behind* earlier ones (higher index → lower
    z), so the leftmost/newest reads on top. */
export function zIndexForPlacement(
  placement: CardPlacement,
  zoneSize: number,
  cardType?: CardType,
): number {
  if (placement.zone === "hand") {
    return 80 + zoneSize - (placement.index ?? 0);
  }

  if (placement.zone === "active") {
    return 55;
  }

  if (placement.zone === "bench") {
    return 57 + zoneSize - (placement.index ?? 0);
  }

  // Fallback for attached cards without host metadata. Normal rendering uses
  // zIndexForDescriptor for host-relative tool/energy layering.
  if (placement.zone === "attached") {
    if (cardType === "tool") return 54.9 + (placement.index ?? 0) * 0.01;
    return 54.8 + (placement.index ?? 0) * 0.01;
  }

  // Synthetic back cards (deck/prize) ride the "stadium" zone with a player
  // owner; the real stadium is owner "global" and keeps the original z=42.
  if (placement.zone === "stadium" && placement.owner !== "global") {
    return 20;
  }

  return 42;
}

/** Host-relative z for an attached card: just behind its host, then a hair
    forward per stack position (capped at 9 so a deep stack can't overtake the
    host or the next slot). */
export function zIndexForAttached(
  hostPlacement: CardPlacement,
  hostZoneSize: number,
  stackIndex: number,
): number {
  const hostZIndex = zIndexForPlacement(hostPlacement, hostZoneSize);
  return hostZIndex - 0.2 + Math.min(stackIndex, 9) * 0.01;
}

/** Attached tools sit a touch in front of attached energy at the same slot. */
export function zIndexForAttachedTool(
  hostPlacement: CardPlacement,
  hostZoneSize: number,
  index: number,
): number {
  return zIndexForAttached(hostPlacement, hostZoneSize, index) + 0.1;
}

export function zIndexForAttachedEnergy(
  hostPlacement: CardPlacement,
  hostZoneSize: number,
  index: number,
): number {
  return zIndexForAttached(hostPlacement, hostZoneSize, index);
}
