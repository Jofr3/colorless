import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { gsap } from "gsap";
import { PixiPlugin } from "gsap/PixiPlugin";

let registered = false;

export function ensureGsapPixi() {
  if (registered) {
    return;
  }

  gsap.registerPlugin(PixiPlugin);
  // Register only the Pixi classes PixiPlugin may dereference (it reads
  // `_PIXI.Graphics` for color tweens and `_PIXI.filters` for filter tweens —
  // neither of which we use; we only tween x/y/scale/rotation/alpha). Passing
  // a curated object instead of `import * as PIXI` lets the bundler tree-shake
  // the unused Pixi subsystems out of the production build.
  PixiPlugin.registerPIXI({ Container, Graphics, Sprite, Texture });
  registered = true;
}

export { gsap };
