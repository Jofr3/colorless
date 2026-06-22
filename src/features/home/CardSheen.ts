// A real Pixi.js shader sheen for the DOM menu cards. The card's pointer tilt
// is a CSS 3D transform (see Home.tsx); this canvas mounts *inside* that tilted
// element, so the sheen physically leans with the card while the fragment
// shader anchors its specular glint to the edge *opposite* the cursor — the
// face the card tilts toward, the way a real card catches the light. The two
// together read as light skating across a tilted glass surface.
//
// Kept deliberately faint (peak intensity ~0.06) — it's a glaze, not a flare.
import { Application, defaultFilterVert, Filter, GlProgram, Graphics, UniformGroup } from "pixi.js";

// rounded-2xl on the card (1rem). The quad is drawn in CSS px (autoDensity),
// so this matches the DOM corner radius directly.
const CORNER_RADIUS = 16;

// Per-frame easing of the hover fade — ~0.14s to settle, matching the card's
// own 140ms tilt transition so the sheen arrives with the lean, not after it.
const HOVER_EASE = 0.16;
const HOVER_EPSILON = 0.003;

// GLSL ES 3.00 fragment (Pixi injects the version/precision). vTextureCoord is
// 0..1 across the quad with origin top-left — the same frame the pointer offset
// is measured in, so uMouse needs no flip.
const SHEEN_FRAG = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// highp to match the vertex stage's default precision — these Pixi globals are
// declared highp there, and a precision mismatch across stages is a link error.
uniform highp vec4 uInputSize;   // input texture size (xy) + 1/size (zw)
uniform highp vec4 uOutputFrame; // filtered region origin (xy) + size (zw)
uniform vec2 uMouse;   // pointer position, 0..1 across the card
uniform float uHover;  // 0..1 fade
uniform float uTime;   // seconds, for a slow iridescent drift

void main() {
  // The quad is a white rounded rect; its alpha is our corner mask, so the
  // sheen is clipped to the exact card shape (incl. antialiased corners).
  float mask = texture(uTexture, vTextureCoord).a;
  if (mask <= 0.0 || uHover <= 0.0) {
    finalColor = vec4(0.0);
    return;
  }

  // Pixi allocates a filter's backing texture from a pool that rounds the size
  // up to the next power of two (144px card -> 256px texture), so vTextureCoord
  // only spans [0 .. region/texture], NOT [0..1]. Rescale to a true 0..1 quad
  // coordinate, or the pointer-relative sheen ends up off-centre.
  vec2 uv = vTextureCoord / (uOutputFrame.zw * uInputSize.zw);

  // A real card leans *away* from the cursor (see the tilt in Home.tsx), so the
  // face it turns toward the viewer — the edge opposite the pointer — is what
  // catches the light. Mirror the pointer through the centre and anchor the
  // specular there, so the glint slides against the cursor like a tilted card.
  vec2 light = vec2(1.0) - uMouse;

  // Specular falloff at the reflected point, built from several concentric
  // stops so the highlight is large and transitions through multiple stages
  // instead of one hard edge — a hot core, a broad halo, and a wide outer wash.
  float d = distance(uv, light);
  float spec =
    smoothstep(0.40, 0.0, d) * 0.40 +
    smoothstep(0.75, 0.0, d) * 0.32 +
    smoothstep(1.15, 0.0, d) * 0.18 +
    smoothstep(1.60, 0.0, d) * 0.10;

  // A whisper of iridescence: a diagonal band whose phase tracks the light
  // point, so the colour slides as the card tilts. uTime adds a barely
  // perceptible shimmer.
  float band = 0.5 + 0.5 * sin((uv.x - uv.y) * 7.0 + light.x * 6.2831853 + uTime * 0.6);
  vec3 cool = vec3(0.45, 0.72, 1.0);
  vec3 warm = vec3(1.0, 0.68, 0.38);
  vec3 tint = mix(cool, warm, band);

  // Mostly white glint with a touch of the iridescent tint layered in.
  vec3 col = mix(vec3(1.0), tint, 0.55);
  float intensity = (spec * 0.06 + spec * band * 0.025) * uHover * mask;

  // Premultiplied output (Pixi expects premultiplied alpha).
  finalColor = vec4(col * intensity, intensity);
}
`;

function renderResolution() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

export class CardSheen {
  private app: Application | null = null;

  private quad: Graphics | null = null;

  private uniforms: UniformGroup<{
    uMouse: { value: Float32Array; type: "vec2<f32>" };
    uHover: { value: number; type: "f32" };
    uTime: { value: number; type: "f32" };
  }> | null = null;

  private mouse: [number, number] = [0.5, 0.5];

  private hover = 0;

  private hoverTarget = 0;

  private startTime = performance.now() / 1000;

  private lastWidth = -1;

  private lastHeight = -1;

  private frame: number | null = null;

  private running = false;

  private destroyed = false;

  private readonly reducedMotion: boolean;

  constructor() {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  async mount(element: HTMLElement) {
    const app = new Application();
    try {
      await app.init({
        // Force WebGL so the GLSL-only filter (no WGSL twin) always runs.
        preference: "webgl",
        resizeTo: element,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: renderResolution(),
        powerPreference: "low-power",
      });
    } catch {
      // No WebGL / context creation failed — the card simply renders without a
      // sheen. Nothing else depends on this.
      app.destroy({ removeView: true });
      return;
    }

    if (this.destroyed) {
      app.destroy({ removeView: true });
      return;
    }

    // We drive renders by hand (only while hovered/fading), so kill the
    // always-on ticker — an idle menu shouldn't spin three render loops.
    app.stop();

    const uniforms = new UniformGroup({
      uMouse: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
      uHover: { value: 0, type: "f32" },
      uTime: { value: 0, type: "f32" },
    });

    const filter = new Filter({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: SHEEN_FRAG,
        name: "card-sheen",
      }),
      resources: { sheenUniforms: uniforms },
    });

    const quad = new Graphics();
    quad.filters = [filter];
    app.stage.addChild(quad);

    app.canvas.className = "card-sheen-canvas";
    app.canvas.setAttribute("aria-hidden", "true");
    // Fill the (absolute inset-0) mount span. autoDensity already sets the
    // canvas width/height style to the element's CSS size.
    app.canvas.style.position = "absolute";
    app.canvas.style.top = "0";
    app.canvas.style.left = "0";
    element.appendChild(app.canvas);

    this.app = app;
    this.quad = quad;
    this.uniforms = uniforms;
    this.startTime = performance.now() / 1000;
    this.redrawQuad();
    // Clear to transparent so the first paint isn't a stale buffer.
    app.render();
  }

  setPointer(x: number, y: number) {
    this.mouse[0] = x;
    this.mouse[1] = y;
    if (this.hoverTarget > 0) {
      this.ensureRunning();
    }
  }

  setHover(hovered: boolean) {
    this.hoverTarget = hovered ? 1 : 0;
    this.ensureRunning();
  }

  destroy() {
    this.destroyed = true;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.app?.destroy({ removeView: true }, { children: true });
    this.app = null;
    this.quad = null;
    this.uniforms = null;
  }

  private ensureRunning() {
    if (this.running || this.destroyed || !this.app) {
      return;
    }
    this.running = true;
    this.frame = requestAnimationFrame(this.tick);
  }

  private redrawQuad() {
    const app = this.app;
    const quad = this.quad;
    if (!app || !quad) {
      return;
    }
    const { width, height } = app.screen;
    if (width === this.lastWidth && height === this.lastHeight) {
      return;
    }
    this.lastWidth = width;
    this.lastHeight = height;
    quad.clear().roundRect(0, 0, width, height, CORNER_RADIUS).fill({ color: 0xffffff, alpha: 1 });
  }

  private readonly tick = () => {
    const app = this.app;
    const uniforms = this.uniforms;
    if (this.destroyed || !app || !uniforms) {
      this.running = false;
      return;
    }

    this.hover += (this.hoverTarget - this.hover) * HOVER_EASE;
    const settled = this.hoverTarget === 0 && this.hover < HOVER_EPSILON;
    if (settled) {
      this.hover = 0;
    }

    this.redrawQuad();

    const time = this.reducedMotion ? 0 : performance.now() / 1000 - this.startTime;
    // Reassign (don't mutate in place) so the UniformGroup flags itself dirty.
    uniforms.uniforms.uMouse = new Float32Array(this.mouse);
    uniforms.uniforms.uHover = this.hover;
    uniforms.uniforms.uTime = time;

    app.render();

    if (settled) {
      // Faded out and idle — stop the loop until the next hover.
      this.running = false;
      this.frame = null;
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
