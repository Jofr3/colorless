import { Application } from "pixi.js";

// Render at a fixed 2× the CSS pixel grid. Cards scale up dramatically on
// hover/drag, so a 1× backing store (at DPR 1) loses too much detail from the
// ~140 CSS px source; 2× supersamples cleanly. Deliberately a constant rather
// than the raw devicePixelRatio — capping at 2× bounds fill cost on hi-DPI /
// retina displays, where 3×+ would be far heavier for little visible gain.
const RENDER_RESOLUTION = 2;

export async function createPixiApplication(resizeTo: HTMLElement) {
  const app = new Application();

  await app.init({
    resizeTo,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: RENDER_RESOLUTION,
  });

  app.canvas.className = "pixi-cards-canvas";
  app.canvas.setAttribute("aria-hidden", "true");

  return app;
}
