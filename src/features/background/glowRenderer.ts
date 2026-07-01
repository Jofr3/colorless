// The shared blue/red background glow, rendered as a real fragment shader
// instead of two stacked CSS radial gradients. CSS gradients are computed and
// composited in 8-bit, so a low-contrast glow spread across the whole viewport
// shows concentric quantization contours (the "lighter lines"). Here the glow
// is evaluated in float precision and a triangular-PDF dither (~1 LSB) is added
// just before the 8-bit write — the textbook cure that removes banding outright
// rather than hiding it. The layout swap (home `sides` <-> `stacked`) and the
// playmat perspective flip become animated uniforms, tweened with gsap to match
// the 1s easing the CSS transition used to do.
//
// Mirrors the CardSheen pattern: a per-component Pixi Application driving a
// Filter over a full-screen quad, rendered on demand (mount, tween frames,
// resize) with the ticker stopped — the glow is static between transitions.
import { Application, defaultFilterVert, Filter, GlProgram, Graphics, UniformGroup } from "pixi.js";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(CustomEase);

// Quick start, fast middle, gentle settle. The control points cross over
// (x1 > x2) to steepen the mid-sweep while y2=1 keeps a soft landing. The same
// curve drives the CSS fallback: cubic-bezier(0.4, 0, 0.3, 1).
const GLOW_EASE = CustomEase.create("glowSweep", "M0,0 C0.4,0 0.3,1 1,1");

export type GlowLayout = "sides" | "stacked";

// The animatable glow parameters gsap tweens between layouts.
type GlowState = { angle: number; w: number; h: number; flip: number };

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
uniform vec2 uRadii;  // ellipse radii as viewport fractions (rx of width, ry of height)

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
  float d = length((uv - c) / uRadii); // 1.0 on the ellipse boundary
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

// Per-layout glow geometry, lifted straight from index.css:
//   sides  -> --glow-angle:180deg; --glow-w:52%;  --glow-h:120% (blue left, red right)
//   stacked-> --glow-angle:90deg;  --glow-w:120%; --glow-h:55%  (blue bottom, red top)
const LAYOUTS: Record<GlowLayout, { angle: number; w: number; h: number }> = {
  // Separation axis (sides=w, stacked=h) stays at the original tight value so
  // each glow hugs its edge; the long axis runs past 100% so it reaches the
  // far corners — the glow spans the full edge without bleeding to mid-screen.
  sides: { angle: Math.PI, w: 0.52, h: 1.2 },
  stacked: { angle: Math.PI / 2, w: 1.2, h: 0.55 },
};
// --glow-bulge: the orbit radius shrinks toward the 45° mid-points so the glows
// sweep on a rounded arc rather than sliding straight between layouts.
const BULGE = 0.14;
const TWEEN_DURATION = 1; // matches the CSS 1000ms transition

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
    w: LAYOUTS.stacked.w,
    h: LAYOUTS.stacked.h,
    flip: 1,
  };
  private layout: GlowLayout = "stacked";
  private flipTarget: 1 | -1 = 1;

  async mount(host: HTMLElement) {
    this.host = host;
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const app = new Application();
    try {
      await app.init({
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
      // No WebGL — the CSS gradient fallback in index.css stays visible.
      app.destroy({ removeView: true });
      return;
    }
    if (this.destroyed) {
      app.destroy({ removeView: true });
      return;
    }

    app.stop(); // render on demand only

    const { uBlue, uRed } = this.centres();
    const uniforms = new UniformGroup({
      uBlue: { value: new Float32Array(uBlue), type: "vec2<f32>" },
      uRed: { value: new Float32Array(uRed), type: "vec2<f32>" },
      uRadii: { value: new Float32Array([this.state.w, this.state.h]), type: "vec2<f32>" },
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
    // CSS gradient fallback in index.css shows through meanwhile) since nothing
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
    this.tweenTo({ angle: target.angle, w: target.w, h: target.h });
  }

  setPerspective(flip: 1 | -1) {
    if (flip === this.flipTarget) {
      return;
    }
    this.flipTarget = flip;
    this.tweenTo({ flip });
  }

  private tweenTo(vars: Partial<GlowState>) {
    // Before the app is ready (the layout/perspective effects can fire during
    // the async init), just snap the state — the first paint reflects it.
    if (!this.ready || this.reducedMotion) {
      Object.assign(this.state, vars);
      if (this.ready) {
        this.apply();
      }
      return;
    }
    gsap.to(this.state, {
      ...vars,
      duration: TWEEN_DURATION,
      // Quick start, brisk middle, gentle settle — see GLOW_EASE.
      ease: GLOW_EASE,
      overwrite: "auto",
      onUpdate: this.apply,
    });
  }

  // Blue/red glow centres derived from the orbit angle, exactly as index.css
  // derives --blue-glow-* / --red-glow-* via calc(cos/sin).
  private centres() {
    const { angle, flip } = this.state;
    const m = 0.5 - BULGE * Math.sin(2 * angle);
    const cos = m * Math.cos(angle);
    const sin = m * Math.sin(angle) * flip;
    return {
      uBlue: [0.5 + cos, 0.5 + sin] as [number, number],
      uRed: [0.5 - cos, 0.5 - sin] as [number, number],
    };
  }

  private readonly apply = () => {
    const { app, uniforms } = this;
    if (this.destroyed || !app || !uniforms) {
      return;
    }
    const { uBlue, uRed } = this.centres();
    // Reassign (don't mutate in place) so the UniformGroup flags itself dirty.
    uniforms.uniforms.uBlue = new Float32Array(uBlue);
    uniforms.uniforms.uRed = new Float32Array(uRed);
    uniforms.uniforms.uRadii = new Float32Array([this.state.w, this.state.h]);
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
    if (this.app) {
      gsap.killTweensOf(this.state);
      this.app.destroy({ removeView: true }, { children: true });
    }
    this.app = null;
    this.uniforms = null;
    this.quad = null;
    this.host = null;
  }
}
