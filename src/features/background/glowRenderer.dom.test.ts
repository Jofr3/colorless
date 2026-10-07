// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { animate, killTweens, initPixi } = vi.hoisted(() => ({
  animate: vi.fn(),
  killTweens: vi.fn(),
  initPixi: vi.fn(),
}));
vi.mock("gsap", () => ({
  gsap: { to: animate, killTweensOf: killTweens, registerPlugin: vi.fn() },
}));
vi.mock("gsap/CustomEase", () => ({ CustomEase: { create: () => "glowSweep" } }));
vi.mock("pixi.js", () => ({
  defaultFilterVert: "",
  Filter: vi.fn(),
  GlProgram: { from: vi.fn() },
  Graphics: vi.fn(),
  RendererType: { WEBGL: 1 },
  UniformGroup: vi.fn(),
}));
vi.mock("../../lib/pixi/initPixiApplication", () => ({ initPixiApplication: initPixi }));

import { GlowRenderer } from "./glowRenderer";

describe("glow animation without WebGL", () => {
  let renderer: GlowRenderer;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    initPixi.mockRejectedValue(new Error("WebGL unavailable"));
    animate.mockImplementation((state, target) => {
      state.angle = target.angle;
      target.onUpdate();
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    host = document.createElement("div");
    renderer = new GlowRenderer();
  });

  afterEach(() => {
    renderer.destroy();
    vi.unstubAllGlobals();
  });

  it("completes a turn swap in 0.8 seconds with a gradual ease-out", async () => {
    await renderer.mount(host);
    renderer.setLayout("sides");
    expect(animate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 1, ease: "glowSweep" }),
    );
    renderer.setLayout("stacked");
    renderer.setPerspective(-1);
    expect(animate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 0.8, ease: "power2.out" }),
    );
    expect(Number.parseFloat(host.style.getPropertyValue("--glow-angle"))).toBeCloseTo(
      (3 * Math.PI) / 2,
    );
    renderer.setPerspective(1);
    expect(animate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 0.8, ease: "power2.out" }),
    );
    expect(Number.parseFloat(host.style.getPropertyValue("--glow-angle"))).toBeCloseTo(Math.PI / 2);
  });

  it("times an interrupted swap from its current position", async () => {
    await renderer.mount(host);
    animate.mockImplementationOnce((state, target) => {
      state.angle = Math.PI;
      target.onUpdate();
    });
    renderer.setPerspective(-1);
    expect(Number.parseFloat(host.style.getPropertyValue("--glow-angle"))).toBeCloseTo(Math.PI);
    renderer.setPerspective(1);
    expect(animate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 0.4, overwrite: "auto" }),
    );
  });

  it("uses the CSS glow when Pixi automatically selects a Canvas renderer", async () => {
    const destroy = vi.fn();
    initPixi.mockResolvedValue({ renderer: { type: 4 }, destroy });
    await renderer.mount(host);
    expect(destroy).toHaveBeenCalled();
    renderer.setPerspective(-1);
    expect(animate).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 0.8 }),
    );
    expect(Number.parseFloat(host.style.getPropertyValue("--glow-angle"))).toBeCloseTo(
      (3 * Math.PI) / 2,
    );
  });

  it("snaps the fallback to the new player for reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await renderer.mount(host);
    renderer.setPerspective(-1);
    expect(animate).not.toHaveBeenCalled();
    expect(Number.parseFloat(host.style.getPropertyValue("--glow-angle"))).toBeCloseTo(
      (3 * Math.PI) / 2,
    );
  });

  it("stops the fallback animation when the renderer is destroyed", async () => {
    await renderer.mount(host);
    renderer.setPerspective(-1);
    renderer.destroy();
    expect(killTweens).toHaveBeenCalledWith(animate.mock.calls[0]?.[0]);
  });
});
