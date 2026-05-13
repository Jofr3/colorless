import * as PIXI from "pixi.js";
import { gsap } from "gsap";
import { PixiPlugin } from "gsap/PixiPlugin";

let registered = false;

export function ensureGsapPixi() {
  if (registered) {
    return;
  }

  gsap.registerPlugin(PixiPlugin);
  PixiPlugin.registerPIXI(PIXI);
  registered = true;
}

export { gsap };
