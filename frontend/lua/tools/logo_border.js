// Authoring only: retain the approved angular faces and replace their noisy
// generated sidewalls with the original Balatro sprite's measured border.
import { refineReflections } from './logo_reflections.js';
export function rebuildBorder(ctx) {
  const { width: w, height: h } = ctx.canvas;
  const source = ctx.getImageData(0, 0, w, h);
  const count = w * h;
  const mask = new Uint8Array(count);
  for (let p = 0; p < count; p++) {
    const [r, g, b, a] = source.data.subarray(p * 4, p * 4 + 4);
    const ivory = Math.min(r, g, b) > 202;
    const blue = b > 170 && g > 145 && b > r * .98 && b > g * 1.04;
    const coral = r > 200 && g > 90 && r > g * 1.15 && r > b * 1.15;
    mask[p] = a > 192 && (ivory || blue || coral) ? 1 : 0;
  }
  function components(value, visit) {
    const seen = new Uint8Array(count);
    for (let start = 0; start < count; start++) {
      if (seen[start] || mask[start] !== value) continue;
      const queue = [start];
      seen[start] = 1;
      let boundary = false;
      for (let head = 0; head < queue.length; head++) {
        const p = queue[head], x = p % w, y = Math.floor(p / w);
        if (!x || !y || x === w - 1 || y === h - 1) boundary = true;
        for (const n of [x ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
          if (n < 0 || n >= count || seen[n] || mask[n] !== value) continue;
          seen[n] = 1; queue.push(n);
        }
      }
      visit(queue, boundary);
    }
  }
  let letters = 0, counters = 0, repairedPixels = 0;
  const bounds = [];
  components(1, (pixels) => {
    if (pixels.length < 32) for (const p of pixels) mask[p] = 0;
    else {
      letters++;
      bounds.push({
        left: Math.min(...pixels.map(p => p % w)),
        height: Math.floor(Math.max(...pixels) / w) - Math.floor(Math.min(...pixels) / w) + 1,
        pixels,
      });
    }
  });
  const originalFace = mask.slice();
  components(0, (pixels, boundary) => {
    if (boundary) return;
    if (pixels.length <= 24) {
      for (const p of pixels) { mask[p] = 1; repairedPixels++; }
    } else counters++;
  });
  if (letters !== 9 || counters !== 3)
    throw new Error(`Unexpected face topology: ${letters} letters, ${counters} counters`);

  bounds.sort((a, b) => a.left - b.left);
  reshapeE(mask, originalFace, source, bounds[6].pixels, w, h);
  // The original 2x O's painted face spans rows 120–285 (166 px).
  const scale = (bounds[1].height + bounds[3].height) / (2 * 166);
  // A small inward offset slims the strokes without squeezing the word or
  // moving its reflections. Keep the existing bevel dimensions and palette.
  const inward = squaredDistances(mask.map(value => 1 - value), w, h);
  let thinnedPixels = 0;
  for (let p = 0; p < count; p++) {
    if (mask[p] && inward[p] <= 3 ** 2) { mask[p] = 0; thinnedPixels++; }
  }
  let slimLetters = 0, slimCounters = 0;
  components(1, pixels => {
    if (pixels.length < 8) {
      for (const p of pixels) { mask[p] = 0; thinnedPixels++; }
    } else slimLetters++;
  });
  components(0, (_, boundary) => { if (!boundary) slimCounters++; });
  if (slimLetters !== 9 || slimCounters !== 3)
    throw new Error(`Thinning changed face topology: ${slimLetters} letters, ${slimCounters} counters`);
  // Balatro's 2x sprite repeats every logical pixel as an exact 2x2 block.
  // Match its base grid using the measured O height, then draw all surfaces on
  // that grid. Rebuilding the ledges here preserves their one-pixel highlights;
  // simply reducing the finished high-resolution sprite would drop some lines.
  const logicalWidth = Math.round(w / (2 * scale));
  const logicalHeight = Math.round(h / (2 * scale));
  const pixelMask = new Uint8Array(logicalWidth * logicalHeight);
  for (let y = 0; y < logicalHeight; y++) for (let x = 0; x < logicalWidth; x++) {
    const sx = Math.floor((x + .5) * w / logicalWidth);
    const sy = Math.floor((y + .5) * h / logicalHeight);
    pixelMask[y * logicalWidth + x] = mask[sy * w + sx];
  }
  const pixelGlyphs = [], seen = new Uint8Array(pixelMask.length);
  let pixelCounters = 0;
  for (let start = 0; start < pixelMask.length; start++) {
    if (seen[start]) continue;
    const value = pixelMask[start], pixels = [start]; seen[start] = 1;
    let boundary = false;
    for (let head = 0; head < pixels.length; head++) {
      const p = pixels[head], x = p % logicalWidth, y = Math.floor(p / logicalWidth);
      if (!x || !y || x === logicalWidth - 1 || y === logicalHeight - 1) boundary = true;
      const neighbors = [x ? p - 1 : -1, x < logicalWidth - 1 ? p + 1 : -1, p - logicalWidth, p + logicalWidth];
      // Logical pixel art can join at a diagonal. Use eight-connected faces
      // and four-connected empty space so angled tips survive intact.
      if (value) neighbors.push(
        x ? p - logicalWidth - 1 : -1, x < logicalWidth - 1 ? p - logicalWidth + 1 : -1,
        x ? p + logicalWidth - 1 : -1, x < logicalWidth - 1 ? p + logicalWidth + 1 : -1);
      for (const n of neighbors) {
        if (n < 0 || n >= pixelMask.length || seen[n] || pixelMask[n] !== value) continue;
        seen[n] = 1; pixels.push(n);
      }
    }
    // Sampling a pointed tip can leave a detached single-pixel fleck. Drop
    // only these tiny islands, as in the higher-resolution face cleanup.
    if (value && pixels.length <= 2) for (const p of pixels) pixelMask[p] = 0;
    else if (value) pixelGlyphs.push(pixels);
    else if (!boundary) pixelCounters++;
  }
  if (pixelGlyphs.length !== 9 || pixelCounters !== 3)
    throw new Error(`Pixel grid changed face topology: ${pixelGlyphs.length} letters, ${pixelCounters} counters`);
  const logical = ctx.createImageData(logicalWidth, logicalHeight);
  logical.data.set(renderBorder(pixelMask, logicalWidth, logicalHeight, .5));
  for (let p = 0; p < pixelMask.length; p++) if (pixelMask[p]) logical.data[p * 4 + 3] = 255;
  const reflections = refineReflections(logical, pixelMask, pixelGlyphs, logicalWidth, logicalHeight, { pixelGrid: true });
  const result = ctx.createImageData(logicalWidth * 2, logicalHeight * 2);
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
    const p = (Math.floor(y / 2) * logicalWidth + Math.floor(x / 2)) * 4;
    result.data.set(logical.data.subarray(p, p + 4), (y * result.width + x) * 4);
  }
  ctx.canvas.width = result.width; ctx.canvas.height = result.height;
  ctx.putImageData(result, 0, 0);
  return { letters: slimLetters, counters: slimCounters, repairedPixels, thinnedPixels, sourceScale: scale,
    pixelGrid: { width: logicalWidth, height: logicalHeight, exportScale: 2, letters: pixelGlyphs.length, counters: pixelCounters }, reflections };
}

function reshapeE(mask, originalFace, source, glyph, w, h) {
  if (w !== 1024 || h !== 380) throw new Error('E contour uses the 1024 × 380 authoring grid');
  // Replace the lower stem and foot as one contour. The stem gently flares
  // into a swept left serif; a shallow arch carries the foot to a tapered
  // right terminal instead of the previous squared, drooping block.
  const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(702, 225);
  ctx.lineTo(725, 225);
  ctx.quadraticCurveTo(725, 240, 724, 249);
  ctx.quadraticCurveTo(724, 254, 729, 254);
  ctx.lineTo(759, 254);
  ctx.quadraticCurveTo(770, 254, 778, 247);
  ctx.lineTo(782, 244);
  ctx.quadraticCurveTo(784, 260, 785, 284);
  ctx.quadraticCurveTo(778, 275, 765, 274);
  ctx.quadraticCurveTo(748, 273, 732, 274);
  ctx.quadraticCurveTo(714, 275, 689, 298);
  ctx.quadraticCurveTo(696, 275, 698, 253);
  ctx.quadraticCurveTo(702, 238, 702, 225);
  ctx.closePath();
  ctx.fill();
  const outline = ctx.getImageData(0, 0, w, h).data;
  // Only remove this connected glyph's lower face, never adjacent L pixels.
  for (const p of glyph) if (Math.floor(p / w) >= 225) mask[p] = 0;
  for (let y = 225; y < 304; y++) for (let x = 684; x < 790; x++) {
    const p = y * w + x;
    if (outline[p * 4 + 3] < 128) continue;
    if (!originalFace[p]) {
      let paint = -1, nearest = Infinity;
      for (const candidate of glyph) {
        const dx = candidate % w - x, dy = Math.floor(candidate / w) - y;
        const distance = dx * dx + dy * dy;
        if (distance < nearest) { nearest = distance; paint = candidate; }
      }
      source.data.set(source.data.slice(paint * 4, paint * 4 + 3), p * 4);
      source.data[p * 4 + 3] = 255;
    }
    mask[p] = 1;
    originalFace[p] = 1;
  }
}

// Exact squared Euclidean distance, via separable lower envelopes of parabolas.
// Rounded rims must keep the same width on diagonals and at acute terminals.
function squaredDistances(mask, w, h) {
  const field = new Float64Array(w * h);
  for (let p = 0; p < field.length; p++) field[p] = mask[p] ? 0 : 1e9;
  const n = Math.max(w, h), f = new Float64Array(n), out = new Float64Array(n);
  const vertices = new Int32Array(n), breaks = new Float64Array(n + 1);
  function transform(length) {
    let k = 0;
    vertices[0] = 0; breaks[0] = -Infinity; breaks[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let crossing;
      do {
        const v = vertices[k];
        crossing = ((f[q] + q * q) - (f[v] + v * v)) / (2 * (q - v));
        if (crossing > breaks[k]) break;
        k--;
      } while (k >= 0);
      k++; vertices[k] = q; breaks[k] = crossing; breaks[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (breaks[k + 1] < q) k++;
      out[q] = (q - vertices[k]) ** 2 + f[vertices[k]];
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = field[y * w + x];
    transform(h);
    for (let y = 0; y < h; y++) field[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = field[y * w + x];
    transform(w);
    for (let x = 0; x < w; x++) field[y * w + x] = out[x];
  }
  return field;
}

export function renderBorder(mask, w, h, scale = 1) {
  const distance = squaredDistances(mask, w, h);
  const result = new Uint8ClampedArray(w * h * 4);
  // Measurements from the 2x source O, x=610: the top has white 2px,
  // slate 4px, lighter slate 2px. Below the face: white 2, pale 2, taupe 6,
  // slate 4, lighter slate 2, dark slate 2, charcoal 4. Side edges have
  // no horizontal displacement. The 14px extrusion points straight down.
  // Soften only the two lightest bands per the user's marked lower bevel:
  // warm ivory replaces pure white, and the lip sits closer to the taupe.
  const bands = [
    ...[[18, 3], [16, 11], [14, 29], [12, 59], [10, 100]]
      .map(([radius, alpha]) => ({ radius, depth: 14, color: [255, 255, 255, alpha] })),
    { radius: 8, depth: 14, color: [49, 58, 60, 255] },
    { radius: 8, depth: 10, color: [67, 81, 83, 255] },
    { radius: 8, depth: 8, color: [91, 117, 123, 255] },
    { radius: 6, depth: 8, color: [79, 99, 103, 255] },
    { radius: 2, depth: 8, color: [203, 187, 167, 255] },
    { radius: 2, depth: 2, color: [221, 209, 194, 255] },
    { radius: 2, depth: 0, color: [243, 237, 229, 255] },
  ];
  for (const band of bands) {
    const radiusSquared = (band.radius * scale) ** 2;
    const depth = Math.round(band.depth * scale);
    for (let x = 0; x < w; x++) {
      let lastHit = -Infinity;
      for (let y = 0; y < h; y++) {
        const p = y * w + x;
        if (distance[p] <= radiusSquared) lastHit = y;
        if (y - lastHit <= depth) result.set(band.color, p * 4);
      }
    }
  }
  return result;
}
