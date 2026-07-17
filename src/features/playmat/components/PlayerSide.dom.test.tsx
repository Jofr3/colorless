// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CardModel, CardStatus, PlayerBoard } from "../types";
import { PlayerSide } from "./PlayerSide";

afterEach(cleanup);

const card = (id: string): CardModel => ({ id, name: id, cardId: id, type: "pokemon" });

const player: PlayerBoard = {
  hand: [],
  active: card("active-1"),
  bench: [card("bench-1"), card("bench-2")],
  prizesRemaining: 6,
};

const statuses: Record<string, CardStatus> = {
  "active-1": { damage: 30, hp: 120 },
  "bench-1": { damage: 50, hp: null },
  "bench-2": { damage: 0, hp: 60 },
};

const renderSide = (withStatuses: boolean) =>
  render(
    <PlayerSide
      owner="you"
      side="bottom"
      player={player}
      benchLimit={5}
      statuses={withStatuses ? statuses : undefined}
    />,
  ).container;

const chipsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-damage-chip]"));

describe("damage chips", () => {
  it("renders one chip per damaged in-play Pokémon, none at zero damage", () => {
    const chips = chipsOf(renderSide(true));
    expect(chips.map((chip) => chip.textContent)).toEqual(["30/120", "50"]);
  });

  it("renders no chips when statuses are absent (mock board)", () => {
    expect(chipsOf(renderSide(false))).toEqual([]);
  });

  // The z-[61] chip only clears the Pixi canvas (z-60, resolved in the playmat
  // section's stacking context) if NO ancestor forms a lower stacking context:
  // element-level backdrop-filter (the old FRAME_CLASS blur) or a positioned
  // inline z-index (the old bench slot wrapper) both trapped it underneath.
  it("keeps every chip free of stacking-context ancestors", () => {
    const container = renderSide(true);
    const chips = chipsOf(container);
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      for (let node = chip.parentElement; node && node !== container; node = node.parentElement) {
        const backdropTokens = Array.from(node.classList).filter((token) =>
          token.startsWith("backdrop-"),
        );
        expect(backdropTokens).toEqual([]);
        expect(node.style.zIndex).toBe("");
      }
    }
  });

  // The bench drop zones keep their paint-order z-index (earlier slots must
  // hit-test above later ones where collapsed attachments overlap), with no
  // statuses-dependent lift — and the chip lives beside them, never inside.
  it("leaves bench drop-zone z-order identical with and without statuses", () => {
    for (const withStatuses of [true, false]) {
      const container = renderSide(withStatuses);
      const slots = Array.from(
        container.querySelectorAll<HTMLElement>('[data-card-zone="bench"][data-card-index]'),
      );
      expect(slots.map((slot) => slot.style.zIndex)).toEqual(["2", "1"]);
      for (const slot of slots) {
        expect(slot.querySelector("[data-damage-chip]")).toBeNull();
      }
      cleanup();
    }
  });
});
