// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installDomShims } from "../../test/domShims";
import { CardBackStack } from "./CardBackStack";

// The tilt hook reads prefers-reduced-motion; jsdom has no matchMedia.
beforeAll(installDomShims);
afterEach(cleanup);

/** The interactive top card is the only one carrying a background image. */
const topCard = (container: HTMLElement): HTMLElement => {
  const card = container.querySelector<HTMLElement>(".pointer-events-auto");
  if (card === null) throw new Error("expected a top card");
  return card;
};

describe("CardBackStack cover art (P5-3)", () => {
  it("fronts the deck with its own card when there is one", () => {
    const { container } = render(<CardBackStack coverUrl="https://api.test/sv01-038.webp" />);
    expect(topCard(container).style.backgroundImage).toContain("sv01-038.webp");
  });

  it("keeps the card back for a deck with nothing to show", () => {
    // A brand-new deck, or one with no scanned Pokémon.
    const { container } = render(<CardBackStack />);
    expect(topCard(container).style.backgroundImage).not.toContain("sv01-038");
    expect(topCard(container).style.backgroundImage).toContain("url(");
  });

  it("scrims the label ONLY over real art, where white text stops reading", () => {
    // Caught in a browser run: the name sat on a flat blue back where white read
    // cleanly, and over a card scan it was barely legible.
    const withArt = render(
      <CardBackStack coverUrl="https://api.test/sv01-038.webp" label={<span>Candy Probe</span>} />,
    );
    expect(screen.getByText("Candy Probe")).toBeTruthy();
    expect(withArt.container.querySelector(".bg-gradient-to-t")).not.toBeNull();

    cleanup();
    const plain = render(<CardBackStack label={<span>Candy Probe</span>} />);
    expect(plain.container.querySelector(".bg-gradient-to-t")).toBeNull();
  });
});
