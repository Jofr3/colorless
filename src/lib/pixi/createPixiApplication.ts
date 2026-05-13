import { Application } from "pixi.js";

const MAX_RENDER_RESOLUTION = 2;

// Render at minimum 2× the device pixel ratio so the card art is
// supersampled at non-hi-DPI displays. Cards scale up dramatically on
// hover/drag — at DPR 1 alone, a 140 CSS px source rendered at the
// canvas's 1× backing store loses too much detail.
function renderResolution() {
  return Math.min(Math.max(window.devicePixelRatio || 1, 2), MAX_RENDER_RESOLUTION);
}

export async function createPixiApplication(resizeTo: HTMLElement) {
  const app = new Application();

  await app.init({
    resizeTo,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: renderResolution(),
  });

  app.canvas.className = "pixi-cards-canvas";
  app.canvas.setAttribute("aria-hidden", "true");

  return app;
}
