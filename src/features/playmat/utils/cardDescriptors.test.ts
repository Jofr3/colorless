import { describe, expect, it } from "vitest";
import type { CardModel, PlayerBoard } from "../types";
import { prizeCardDescriptors } from "./cardDescriptors";
import { prizeBackId } from "./piles";

// 🆕🆕🆕 D551 — the Pixi prize descriptors, pure. A face-up slot KEEPS the slot id
// `prizeBackId(owner, slot)` (so the existing CardView flips in place through the layer's
// `setTextureUrl` sync) and takes its face from the card model; every other present slot is
// a back painted with `backImageUrl`. 🛑 Every board here has taken a prize (remaining < 6),
// because at remaining 6 the top grid's slot `taken + i` IS slot `i` and a mapping that
// ignored the flip would pass.

const BACK = "back://twilight/red";
const cresselia: CardModel = {
  id: "p1#2",
  name: "Cresselia",
  cardId: "sv06.5-021",
  type: "pokemon",
  imageUrl: "https://assets.example/cards/sv06.5-021/high.webp",
};
const board = (faceUpPrizes: PlayerBoard["faceUpPrizes"], prizesRemaining = 5): PlayerBoard => ({
  hand: [],
  active: null,
  bench: [],
  prizesRemaining,
  faceUpPrizes,
});

describe("🛑 prizeCardDescriptors (D551)", () => {
  for (const flipped of [false, true]) {
    it(`🛑 ${flipped ? "flipped (top)" : "unflipped (bottom)"}: the face-up slot carries the card's imageUrl and cardId under the mapped slot id`, () => {
      const player = board([{ index: 2, card: cresselia }]);
      expect(player.prizesRemaining).toBeLessThan(6);
      const descriptors = prizeCardDescriptors(player, "opponent", flipped, "red", BACK);
      const slots = flipped ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
      const faceSlot = flipped ? 3 : 2; // taken + i on top, i on the bottom
      expect(descriptors.map((d) => d.card.id)).toEqual(
        slots.map((s) => prizeBackId("opponent", s)),
      );
      for (const d of descriptors) {
        expect(d.placement).toEqual({ owner: "opponent", zone: "stadium" });
        expect(d.draggable).toBe(false);
        expect(d.zoneSize).toBe(1);
        if (d.card.id === prizeBackId("opponent", faceSlot)) {
          expect(d.card).toEqual({
            id: prizeBackId("opponent", faceSlot),
            cardId: "sv06.5-021",
            name: "Cresselia",
            type: "pokemon",
            imageUrl: cresselia.imageUrl,
          });
        } else {
          expect(d.card.imageUrl).toBe(BACK);
          expect(d.card.cardId).toBe("back-red");
          expect(d.card.type).toBe("trainer");
        }
      }
    });
  }

  it("🛑 a scan-less face-up card keeps imageUrl UNDEFINED — never the back (as a scan-less Active does)", () => {
    const { imageUrl: _drop, ...scanless } = cresselia;
    for (const flipped of [false, true]) {
      const descriptors = prizeCardDescriptors(
        board([{ index: 0, card: scanless }]),
        "you",
        flipped,
        "blue",
        BACK,
      );
      const face = descriptors.find((d) => d.card.cardId === "sv06.5-021");
      expect(face?.card.id).toBe(prizeBackId("you", flipped ? 1 : 0));
      expect(face?.card.imageUrl).toBeUndefined();
    }
  });

  it("🛑 no face-up prize: every present slot is a back, and absent slots emit nothing", () => {
    for (const flipped of [false, true]) {
      const descriptors = prizeCardDescriptors(board([], 2), "you", flipped, "blue", BACK);
      expect(descriptors.map((d) => d.card.id)).toEqual(
        (flipped ? [4, 5] : [0, 1]).map((s) => prizeBackId("you", s)),
      );
      expect(descriptors.map((d) => d.card.imageUrl)).toEqual([BACK, BACK]);
      expect(descriptors.map((d) => d.card.name)).toEqual(
        (flipped ? [4, 5] : [0, 1]).map((s) => `you prize ${s}`),
      );
    }
  });
});
