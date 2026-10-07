// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureGsapPixi, gsap } from "../../../lib/animation/gsapPixi";
import { CardView, type CardViewTarget } from "./CardView";

beforeEach(() => {
  ensureGsapPixi();
  gsap.globalTimeline.clear();
  gsap.ticker.sleep();
});
afterEach(() => {
  gsap.globalTimeline.clear();
  gsap.ticker.sleep();
});

describe("setup card sling", () => {
  const source: CardViewTarget = {
    x: 80,
    y: 120,
    width: 80,
    height: 110,
    rotation: 0,
    zIndex: 10_000,
    placement: { owner: "you", zone: "stadium" },
  };
  const destination = { ...source, x: 440, y: 300, width: 40, height: 55 };

  it("travels along a straight line and settles into the destination", () => {
    const view = card();
    view.setPresentationOptions({ slotLocked: true });
    view.setTarget(source, true);
    view.slingTo(destination);
    expect(view.getPosition()).toEqual({ x: source.x, y: source.y });
    for (let frame = 1; frame <= 30; frame++) {
      view.update(1 / 60, frame / 60);
      const point = view.getPosition();
      // Each spring axis snaps independently within 0.01px at rest.
      expect(Math.abs(point.y - source.y - (point.x - source.x) / 2)).toBeLessThan(0.02);
    }
    expect(view.getPosition().x).toBeCloseTo(destination.x, 1);
    expect(view.getPosition().y).toBeCloseTo(destination.y, 1);
    view.destroy();
  });

  it("uses the same motion as an accepted card release", () => {
    const sling = card();
    const released = card();
    sling.setPresentationOptions({ slotLocked: true });
    sling.setTarget(source, true);
    sling.slingTo(destination);
    released.setTarget(source, true);
    released.setTarget(destination);
    // Suppress ambient drift in both views so their release paths can be compared.
    released.setPresentationOptions({ slotLocked: true });
    released.release({ x: 0, y: 0 }, true);
    for (let frame = 1; frame <= 30; frame++) {
      sling.update(1 / 60, frame / 60);
      released.update(1 / 60, frame / 60);
      expect(sling.getPosition()).toEqual(released.getPosition());
    }
    sling.destroy();
    released.destroy();
  });

  it("places cards immediately when reduced motion is enabled", () => {
    const view = card();
    view.setTarget(source, true);
    view.setReducedMotion(true);
    view.slingTo(destination);
    expect(view.getPosition()).toEqual({ x: destination.x, y: destination.y });
    view.destroy();
  });
});

function card() {
  return new CardView({ id: "test", name: "Test", textureUrl: "", seed: 0, reducedMotion: false });
}

describe("evolution target shake", () => {
  it("wobbles in its slot and settles without changing its placement", () => {
    const view = card();
    const target: CardViewTarget = {
      x: 240,
      y: 250,
      width: 80,
      height: 110,
      rotation: 0,
      zIndex: 1,
      placement: { owner: "you", zone: "bench", index: 0 },
    };
    view.setPresentationOptions({ slotLocked: true });
    view.setTarget(target, true);
    view.update(1 / 60, performance.now() / 1000);
    const width = view.container.width;
    const position = view.getPosition();
    view.shake();
    const time = performance.now() / 1000;
    view.update(1 / 60, time + 0.04);
    expect(view.container.width).not.toBeCloseTo(width);
    expect(view.getPosition()).toEqual(position);
    expect(view.placement).toEqual(target.placement);
    view.update(1 / 60, time + 1);
    expect(view.container.width).toBeCloseTo(width);
    view.destroy();
  });

  it("respects reduced motion", () => {
    const view = card();
    view.setReducedMotion(true);
    const width = view.container.width;
    view.shake();
    expect(view.container.width).toBe(width);
    view.destroy();
  });
});

describe("Prize flip entrance", () => {
  it("opens from edge-on to full width while staying in its slot", () => {
    const view = card();
    view.setPresentationOptions({ slotLocked: true });
    view.setTarget(
      {
        x: 400,
        y: 200,
        width: 40,
        height: 55,
        rotation: 0,
        zIndex: 1,
        placement: { owner: "you", zone: "stadium" },
      },
      true,
    );
    const width = view.container.width;
    const position = view.getPosition();
    const start = gsap.globalTimeline.time();
    view.flipIntoView();
    expect(view.container.width).toBe(0);
    gsap.globalTimeline.totalTime(start + 0.12);
    expect(view.container.width).toBeGreaterThan(0);
    expect(view.container.width).toBeLessThan(width);
    expect(view.getPosition()).toEqual(position);
    gsap.globalTimeline.totalTime(start + 0.3);
    expect(view.container.width).toBeCloseTo(width);
    view.destroy();
  });

  it("shows the full card immediately with reduced motion", () => {
    const view = card();
    view.setReducedMotion(true);
    const width = view.container.width;
    view.flipIntoView();
    expect(view.container.width).toBe(width);
    view.destroy();
  });
});

describe("card animation cleanup", () => {
  it.each([
    ["Prize flip entrance", (view: CardView) => view.flipIntoView()],
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
