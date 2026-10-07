// The shared blue/red background glow, rendered as a real fragment shader
// instead of two stacked CSS radial gradients. CSS gradients are computed and
// composited in 8-bit, so a low-contrast glow spread across the whole viewport
// shows concentric quantization contours (the "lighter lines"). Here the glow
// is evaluated in float precision and a triangular-PDF dither (~1 LSB) is added
// just before the 8-bit write — the textbook cure that removes banding outright
// rather than hiding it. The layout swap (home `sides` <-> `stacked`) and the
// playmat turn rotation become animated uniforms, tweened with gsap. Turn swaps
// use a brisk sweep that gradually eases into its final position.
//
// Mirrors the CardSheen pattern: a per-component Pixi Application driving a
// Filter over a full-screen quad, rendered on demand (mount, tween frames,
// resize) with the ticker stopped — the glow is static between transitions.
import {
  type Application,
  defaultFilterVert,
  Filter,
  GlProgram,
  Graphics,
  RendererType,
  UniformGroup,
} from "pixi.js";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { initPixiApplication } from "../../lib/pixi/initPixiApplication";
import { glowGeometry } from "./glowGeometry";

gsap.registerPlugin(CustomEase);

// Quick start, fast middle, gentle settle. The control points cross over
// (x1 > x2) to steepen the mid-sweep while y2=1 keeps a soft landing. The same
// curve also drives the CSS fallback through the shared animated angle.
const GLOW_EASE = CustomEase.create("glowSweep", "M0,0 C0.4,0 0.3,1 1,1");

export type GlowLayout = "sides" | "stacked";

// The animatable glow parameters gsap tweens between layouts.
type GlowState = { angle: number };

const MAX_RENDER_RESOLUTION = 2;

// GLSL ES 3.00 fragment (Pixi injects the version/precision). uInputSize /
// uOutputFrame / vTextureCoord are the standard filter uniforms Pixi provides.
const GLOW_FRAG = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform highp vec4 uInputSize;   // input texture size (xy) + 1/size (zw)
uniform highp vec4 uOutputFrame; // filtered region origin (xy) + size (zw)

uniform vec2 uBlue;   // blue glow centre, 0..1 across the viewport (top-left origin)
uniform vec2 uRed;    // red glow centre,  0..1
uniform vec2 uRadii;  // ellipse radii along the edge and into the screen
uniform vec2 uAxis;   // long axis, rotating with the sweep in viewport space

const vec3 BASE = vec3(0.05490, 0.05490, 0.07843); // #0e0e14, --color-bg
const vec3 BLUE = vec3(0.14902, 0.58431, 1.00000); // rgb(38,149,255)
const vec3 RED  = vec3(1.00000, 0.20392, 0.33725); // rgb(255,52,86)
const float BLUE_PEAK = 0.16;
const float RED_PEAK  = 0.13;
const float STOP = 0.80; // falloff reaches zero at 80% of the ellipse radius
const float PI = 3.14159265359;

// Raised-cosine elliptical falloff: peak at the centre, smoothly to 0 at STOP
// with zero slope at both ends (no hot core, no hard edge ring).
float glow(vec2 uv, vec2 c, float peak) {
  vec2 delta = uv - c;
  vec2 local = vec2(dot(delta, uAxis), dot(delta, vec2(-uAxis.y, uAxis.x)));
  float d = length(local / uRadii); // 1.0 on the rotated ellipse boundary
  float t = clamp(d / STOP, 0.0, 1.0);
  return peak * (0.5 + 0.5 * cos(PI * t));
}

// Dave Hoskins hash — cheap per-pixel white noise for the dither.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // vTextureCoord -> true 0..1 across the full-screen quad (top-left origin),
  // undoing Pixi's POT-padded input texture (same rescale as the card sheen).
  vec2 uv = vTextureCoord / (uOutputFrame.zw * uInputSize.zw);

  // Source-over compositing, matching the CSS layer order (blue listed first =
  // on top), over the base background.
  vec3 col = BASE;
  col = mix(col, RED,  glow(uv, uRed,  RED_PEAK));
  col = mix(col, BLUE, glow(uv, uBlue, BLUE_PEAK));

  // Triangular-PDF dither at ~1 LSB, per channel, in screen space. Two hashes
  // summed give a triangular distribution in [-1,1]/255 — randomises the 8-bit
  // rounding so no quantization contour can form. This is the actual fix.
  vec2 fc = gl_FragCoord.xy;
  vec3 n1 = vec3(hash(fc),       hash(fc + 17.3), hash(fc + 41.7));
  vec3 n2 = vec3(hash(fc + 3.1), hash(fc + 23.9), hash(fc + 59.5));
  col += (n1 + n2 - 1.0) / 255.0;

  finalColor = vec4(col, 1.0); // opaque: the bottommost layer, no further compositing
}
`;

// Resting angles match the CSS fallback: blue left on home, bottom elsewhere.
const LAYOUTS: Record<GlowLayout, { angle: number }> = {
  sides: { angle: Math.PI },
  stacked: { angle: Math.PI / 2 },
};
const QUARTER_TURN_DURATION = 1; // Home-to-Decks travels 90° in one second.
const TURN_QUARTER_DURATION = 0.4; // A full player swap takes 0.8 seconds.

export class GlowRenderer {
  private app: Application | null = null;
  private uniforms: UniformGroup | null = null;
  private quad: Graphics | null = null;
  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private ready = false;
  private reducedMotion = false;

  // Animated state — gsap mutates these in place; `apply` derives the glow
  // centres from them each frame. Starts at the `stacked` defaults.
  private readonly state: GlowState = {
    angle: LAYOUTS.stacked.angle,
  };
  private layout: GlowLayout = "stacked";
  private perspective: 1 | -1 = 1;

  async mount(host: HTMLElement) {
    this.host = host;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.apply();

    let app: Application;
    try {
      app = await initPixiApplication({
        preference: "webgl", // GLSL fragment shader required
        backgroundAlpha: 0,
        antialias: false, // full-screen quad: no geometry edges to smooth
        autoDensity: true,
        resolution: Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_RENDER_RESOLUTION),
        powerPreference: "low-power",
        width: host.clientWidth || window.innerWidth,
        height: host.clientHeight || window.innerHeight,
      });
    } catch {
      // Continue animating the CSS layers with the same clock without WebGL.
      this.ready = true;
      return;
    }
    if (this.destroyed) {
      app.destroy({ removeView: true });
      return;
    }
    // Pixi can fall back to Canvas even when WebGL is preferred. Canvas cannot
    // render this fragment filter; keep our CSS glow visible in that case.
    if (app.renderer.type !== RendererType.WEBGL) {
      app.destroy({ removeView: true }, { children: true });
      this.ready = true;
      return;
    }

    app.stop(); // render on demand only

    const { uBlue, uRed, axis, radii } = glowGeometry(this.state.angle);
    const uniforms = new UniformGroup({
      uBlue: { value: new Float32Array(uBlue), type: "vec2<f32>" },
      uRed: { value: new Float32Array(uRed), type: "vec2<f32>" },
      uRadii: { value: new Float32Array(radii), type: "vec2<f32>" },
      uAxis: { value: new Float32Array(axis), type: "vec2<f32>" },
    });
    const filter = new Filter({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: GLOW_FRAG,
        name: "glow-bg",
      }),
      resources: { glowUniforms: uniforms },
    });
    const quad = new Graphics();
    quad.filters = [filter];
    app.stage.addChild(quad);

    app.canvas.className = "glow-bg-canvas";
    app.canvas.setAttribute("aria-hidden", "true");
    host.appendChild(app.canvas);

    // After a GPU/context reset this on-demand canvas would stay blank (only the
    // CSS gradient fallback shows through meanwhile) since nothing
    // re-renders until the next layout tween or resize. Repaint once the browser
    // restores the context — Pixi rebuilds its own GL resources on restore, so we
    // just re-render on the next frame. No `webglcontextlost` handler: Pixi owns
    // that, and calling preventDefault there would block the restore.
    this.canvas = app.canvas;
    app.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.app = app;
    this.uniforms = uniforms;
    this.quad = quad;
    this.ready = true;

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(host);
    this.handleResize(); // sizes the quad and paints the first frame
  }

  setLayout(layout: GlowLayout) {
    if (layout === this.layout) {
      return;
    }
    this.layout = layout;
    const target = LAYOUTS[layout];
    this.tweenTo({
      angle: target.angle + (layout === "stacked" && this.perspective === -1 ? Math.PI : 0),
    });
  }

  setPerspective(perspective: 1 | -1) {
    if (perspective === this.perspective) {
      return;
    }
    this.perspective = perspective;
    this.tweenTo(
      {
        angle:
          LAYOUTS[this.layout].angle +
          (this.layout === "stacked" && perspective === -1 ? Math.PI : 0),
      },
      "power2.out",
      TURN_QUARTER_DURATION,
    );
  }

  private tweenTo(
    vars: GlowState,
    ease: string | gsap.EaseFunction = GLOW_EASE,
    quarterTurnDuration = QUARTER_TURN_DURATION,
  ) {
    // Before the app is ready (the layout/perspective effects can fire during
    // the async init), just snap the state — the first paint reflects it.
    if (!this.ready || this.reducedMotion) {
      Object.assign(this.state, vars);
      this.apply();
      return;
    }
    gsap.to(this.state, {
      ...vars,
      // Interrupted sweeps scale their duration to the remaining distance.
      duration: (quarterTurnDuration * Math.abs(vars.angle - this.state.angle)) / (Math.PI / 2),
      // Route changes keep their original ease; turn swaps have a longer,
      // gentler deceleration so the glow settles rather than stopping abruptly.
      ease,
      overwrite: "auto",
      onUpdate: this.apply,
    });
  }

  private readonly apply = () => {
    if (this.destroyed || !this.host) {
      return;
    }
    // The fallback follows the exact same angle/timing, including interrupted
    // swaps; it doesn't run an independent CSS transition behind the canvas.
    this.host.style.setProperty("--glow-angle", `${this.state.angle}rad`);
    const { app, uniforms } = this;
    if (!app || !uniforms) {
      return;
    }
    const { uBlue, uRed, axis, radii } = glowGeometry(this.state.angle);
    // Reassign (don't mutate in place) so the UniformGroup flags itself dirty.
    uniforms.uniforms.uBlue = new Float32Array(uBlue);
    uniforms.uniforms.uRed = new Float32Array(uRed);
    uniforms.uniforms.uRadii = new Float32Array(radii);
    uniforms.uniforms.uAxis = new Float32Array(axis);
    app.render();
  };

  private readonly handleResize = () => {
    const { app, quad, host } = this;
    if (this.destroyed || !app || !quad || !host) {
      return;
    }
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    app.renderer.resize(w, h);
    // The filter region tracks the quad bounds, so the quad must cover the
    // viewport for vTextureCoord to map to a true 0..1. Fill colour is unused
    // (the shader is fully procedural).
    quad.clear();
    quad.rect(0, 0, w, h).fill(0xffffff);
    this.apply();
  };

  private readonly handleContextRestored = () => {
    if (this.destroyed) return;
    // Repaint after Pixi has rebuilt its GL state for the restored context.
    requestAnimationFrame(this.apply);
  };

  destroy() {
    this.destroyed = true;
    this.canvas?.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.canvas = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    gsap.killTweensOf(this.state);
    if (this.app) {
      this.app.destroy({ removeView: true }, { children: true });
    }
    this.app = null;
    this.uniforms = null;
    this.quad = null;
    this.host = null;
  }
}
