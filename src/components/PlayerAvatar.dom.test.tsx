// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlayerAvatar } from "./PlayerAvatar";

afterEach(cleanup);

describe("PlayerAvatar (P5-2)", () => {
  it("draws the same face for the same seed, and a different one otherwise", () => {
    const styleOf = (seed: string) => {
      cleanup();
      render(<PlayerAvatar name="Ash" seed={seed} />);
      return (screen.getByText("A") as HTMLElement).style.backgroundImage;
    };
    expect(styleOf("1a2b3c4d")).toBe(styleOf("1a2b3c4d"));
    expect(styleOf("1a2b3c4d")).not.toBe(styleOf("9f8e7d6c"));
  });

  it("shows the initial the account control already shows", () => {
    render(<PlayerAvatar name="misty" seed="1a2b3c4d" />);
    expect(screen.getByText("M")).toBeTruthy();
  });

  it("falls back to a bare gradient rather than a wrong letter", () => {
    // An empty name is the server's own fallback case; a placeholder initial
    // would be a claim about someone we can't name.
    const { container } = render(<PlayerAvatar name="   " seed="1a2b3c4d" />);
    expect(container.textContent).toBe("");
  });

  it("keeps the generic figure for a seat with no account", () => {
    const { container } = render(<PlayerAvatar name="Player 4271" seed={null} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toBe("");
  });
});
