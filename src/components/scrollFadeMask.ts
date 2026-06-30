// The ScrollArea edge mask, drawn by a real fragment shader instead of a CSS
// linear-gradient. A WebGL pass evaluates a rounded-rectangle field — the box's
// corners are rounded (no hard 90° clip) and its top/bottom edges feather to
// transparent — and the result is baked to a PNG used as the scroll viewport's
// `mask-image`. CSS masks can't read a live WebGL canvas cheaply, so we bake on
// size change only: the mask is pinned to the viewport and independent of scroll,
// so there's nothing to redraw per frame.
//
// One shared offscreen GL context renders every ScrollArea's mask, so there's no
// context-per-instance churn. Mirrors the project's other shaders (CardSheen,
// glowRenderer) in spirit — a procedural full-screen quad — but baked once rather
// than driven live, since the output feeds a CSS mask rather than a canvas layer.

export interface FadeMaskOptions {
  /** Viewport size in CSS px (the mask is baked at this size, then stretched 1:1). */
  width: number;
  height: number;
  /** Feather heights (CSS px) at the top / bottom edges; 0 disables that edge. */
  fadeTop: number;
  fadeBottom: number;
  /** Corner radius (CSS px) for the rounded clip. */
  radius: number;
}

// GLSL ES 1.00 — alpha-only output (white RGB, the mask lives in the alpha
// channel, which is what CSS `mask-image` samples by default). gl_FragCoord has a
// bottom-left origin; yTop flips it so the top feather sits at the visual top.
const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 u_res;         // buffer size, px
uniform float u_radius;     // corner radius, px
uniform float u_fadeTop;    // top feather height, px
uniform float u_fadeBottom; // bottom feather height, px

// Signed distance to a rounded rectangle centred at the origin (negative inside).
float roundedBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 halfSize = u_res * 0.5;
  // Rounded-corner clip: 1 inside, 0 outside, ~1px antialiased boundary.
  float sd = roundedBox(p - halfSize, halfSize, u_radius);
  float corner = clamp(0.5 - sd, 0.0, 1.0);

  // Vertical feather at the top/bottom edges only (sides stay crisp so the edge
  // card columns aren't dimmed). yTop/yBottom are distances from each edge.
  float yTop = u_res.y - p.y;
  float top = u_fadeTop > 0.0 ? smoothstep(0.0, u_fadeTop, yTop) : 1.0;
  float bottom = u_fadeBottom > 0.0 ? smoothstep(0.0, u_fadeBottom, p.y) : 1.0;

  gl_FragColor = vec4(1.0, 1.0, 1.0, corner * top * bottom);
}
`;

let canvas: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let locations: {
  res: WebGLUniformLocation | null;
  radius: WebGLUniformLocation | null;
  fadeTop: WebGLUniformLocation | null;
  fadeBottom: WebGLUniformLocation | null;
} | null = null;
let failed = false;

function compile(context: WebGLRenderingContext, type: number, src: string) {
  const shader = context.createShader(type);
  if (!shader) return null;
  context.shaderSource(shader, src);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    console.warn("scrollFadeMask: shader compile failed —", context.getShaderInfoLog(shader));
    context.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Lazily build the shared GL context + program. Returns false if WebGL is
    unavailable, so the caller can fall back to a CSS gradient. */
function init(): boolean {
  if (gl) return true;
  if (failed) return false;

  const c = document.createElement("canvas");
  const context = c.getContext("webgl", {
    premultipliedAlpha: false, // straight alpha so the PNG's alpha is the mask
    alpha: true,
    antialias: false, // the SDF antialiases its own edges
    preserveDrawingBuffer: true, // keep the buffer readable for toDataURL
  });
  if (!context) {
    failed = true;
    return false;
  }

  const vs = compile(context, context.VERTEX_SHADER, VERT);
  const fs = compile(context, context.FRAGMENT_SHADER, FRAG);
  const program = vs && fs ? context.createProgram() : null;
  if (!vs || !fs || !program) {
    failed = true;
    return false;
  }
  context.attachShader(program, vs);
  context.attachShader(program, fs);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    console.warn("scrollFadeMask: program link failed —", context.getProgramInfoLog(program));
    failed = true;
    return false;
  }
  context.useProgram(program);

  // A single full-screen quad (two triangles) the fragment shader paints over.
  const buffer = context.createBuffer();
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(
    context.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    context.STATIC_DRAW,
  );
  const aPos = context.getAttribLocation(program, "a_pos");
  context.enableVertexAttribArray(aPos);
  context.vertexAttribPointer(aPos, 2, context.FLOAT, false, 0, 0);

  locations = {
    res: context.getUniformLocation(program, "u_res"),
    radius: context.getUniformLocation(program, "u_radius"),
    fadeTop: context.getUniformLocation(program, "u_fadeTop"),
    fadeBottom: context.getUniformLocation(program, "u_fadeBottom"),
  };
  canvas = c;
  gl = context;
  return true;
}

/** Render the edge mask and return it as a PNG data URL, or null if WebGL is
    unavailable. Cheap enough to call on resize; not meant for per-frame use. */
export function fadeMaskDataUrl(opts: FadeMaskOptions): string | null {
  if (!init() || !gl || !canvas || !locations) return null;

  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));
  const radius = Math.max(0, Math.min(opts.radius, Math.min(w, h) / 2));

  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  gl.viewport(0, 0, w, h);
  gl.uniform2f(locations.res, w, h);
  gl.uniform1f(locations.radius, radius);
  gl.uniform1f(locations.fadeTop, Math.max(0, opts.fadeTop));
  gl.uniform1f(locations.fadeBottom, Math.max(0, opts.fadeBottom));
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  return canvas.toDataURL("image/png");
}
