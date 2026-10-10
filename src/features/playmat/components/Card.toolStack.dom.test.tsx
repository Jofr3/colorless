// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CardModel } from "../types";
import { PlaymatCard } from "./Card";

// 🆕🆕🆕 D643 — Rotom ex "Multi Adapter": a body may carry 2 Pokémon Tools, and the second steps off the first. Each
// Tool anchor carries its own `--attached-stack` (the Pixi layer reads the anchor's box), stack 0 being the old spot.

afterEach(cleanup);

const tool = (id: string, name: string): CardModel => ({ id, name, cardId: id, type: "tool" });
const rotom = (tools: CardModel[]): CardModel => ({
  id: "p1#1",
  name: "Rotom ex",
  cardId: "me02-029",
  type: "pokemon",
  attached: { tools, energies: [] },
});

const stacks = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(".playmat-card__attached")].map((el) => [
    el.dataset.cardId,
    el.style.getPropertyValue("--attached-stack"),
  ]);

describe("D643 — the Tool anchors stack", () => {
  it("two Tools: stack 0 and stack 1, side placement", () => {
    const { container } = render(<PlaymatCard card={rotom([tool("t1", "Vitality Band"), tool("t2", "Bravery Charm")])} />);
    expect(stacks(container)).toEqual([
      ["t1", "0"],
      ["t2", "1"],
    ]);
  });

  it("one Tool keeps stack 0, behind placement too", () => {
    const { container } = render(
      <PlaymatCard card={rotom([tool("t1", "Vitality Band")])} toolAttachmentPlacement="behind" />,
    );
    expect(stacks(container)).toEqual([["t1", "0"]]);
  });
});
