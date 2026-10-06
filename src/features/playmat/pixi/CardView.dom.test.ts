// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureGsapPixi, gsap } from "../../../lib/animation/gsapPixi";
import { CardView } from "./CardView";

beforeEach(() => {
  ensureGsapPixi();
  gsap.globalTimeline.clear();
  gsap.ticker.sleep();
});
afterEach(() => {
  gsap.globalTimeline.clear();
  gsap.ticker.sleep();
});

function card() {
  return new CardView({ id: "test", name: "Test", textureUrl: "", seed: 0, reducedMotion: false });
}

describe("card animation cleanup", () => {
  it.each([
    ["press", (view: CardView) => view.startPress()],
    ["hover", (view: CardView) => view.setHovered(true)],
    [
      "drag release",
      (view: CardView) => {
        view.startPress();
        view.startDrag();
        view.stopPress();
        view.release({ x: 0, y: 0 }, true);
      },
    ],
    [
      "turn handoff",
      (view: CardView) => {
        view.setHovered(true);
        view.startPress();
        view.playFlip();
      },
    ],
  ] as const)(
    "removing a card during %s leaves the shared animation loop working",
    (_name, animate) => {
      const view = card();
      animate(view);
      // Remove the card before GSAP initializes its queued Pixi tweens, as a
      // played/discarded card or outgoing hand can disappear in the same frame.
      const ongoing = { progress: 0 };
      gsap.to(ongoing, { progress: 1, duration: 0.2 });
      view.destroy();

      expect(() => gsap.globalTimeline.totalTime(gsap.globalTimeline.time() + 1)).not.toThrow();
      expect(ongoing.progress).toBe(1);
    },
  );
});
