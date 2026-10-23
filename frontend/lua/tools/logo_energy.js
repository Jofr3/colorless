// Code-drawn colorless energy, using the supplied silver-disc / six-ray reference.
// Build on the lettering's logical pixel grid so the rim and face share its finish.
export function insertEnergy(glyphs, w, h) {
  const ordered = [...glyphs].sort(
    (a, b) => Math.min(...a.map((p) => p % w)) - Math.min(...b.map((p) => p % w)),
  );
  const old = ordered[3];
  const originalLeft = Math.min(...old.map((p) => p % w));
  const originalTop = Math.min(...old.map((p) => Math.floor(p / w)));
  const bottom = Math.max(...old.map((p) => Math.floor(p / w)));
  const oldDiameter = bottom - originalTop + 1;
  const diameter = Math.round(oldDiameter * 1.2);
  const top = originalTop - Math.floor((diameter - oldDiameter) / 2);
  const points = ordered.map((pixels, i) =>
    i === 3 ? [] : pixels.map((p) => [p % w, Math.floor(p / w)]),
  );
  for (let y = top; y < top + diameter; y++)
    for (let x = originalLeft; x < originalLeft + diameter; x++) {
      const u = (x + 0.5 - originalLeft) / diameter - 0.5,
        v = (y + 0.5 - top) / diameter - 0.5;
      if (u * u + v * v <= 0.25) points[3].push([x, y]);
    }
  // Optical spacing follows the actual contours, including the flared feet.
  // Tighten the regular dark rims, and tuck L/R slightly behind the energy.
  const offsets = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const previous = new Float64Array(h).fill(-Infinity);
    const current = new Float64Array(h).fill(Infinity);
    for (const [x, y] of points[i - 1]) previous[y] = Math.max(previous[y], x + offsets[i - 1]);
    for (const [x, y] of points[i]) current[y] = Math.min(current[y], x);
    let gap = Infinity;
    for (let y = 0; y < h; y++)
      for (let dy = -6; dy <= 6; dy++) {
        if (y + dy < 0 || y + dy >= h) continue;
        gap = Math.min(gap, current[y + dy] - previous[y] - Math.sqrt(36 - dy * dy));
      }
    offsets[i] = -Math.floor(gap) - (i === 3 || i === 4 ? 8 : 2);
  }
  // Bring the left L farther into the energy; carry C/O with it to keep
  // their already joined borders intact.
  for (let i = 0; i < 3; i++) offsets[i] += 4;
  // Ease the R away from the energy, keeping the joined RLESS spacing.
  for (let i = 4; i < offsets.length; i++) offsets[i] += 3;
  const sourceRight = Math.max(...ordered.flatMap((pixels) => pixels.map((p) => p % w)));
  const right = Math.max(...points.flatMap((face, i) => face.map(([x]) => x + offsets[i])));
  const width = right + (w - sourceRight);
  const left = originalLeft + offsets[3];
  const mask = new Uint8Array(width * h);
  const faces = points.map((face, i) => face.map(([x, y]) => y * width + x + offsets[i]));
  for (const face of faces) for (const p of face) mask[p] = 1;
  return { mask, glyphs: faces, width, height: h, left, top, diameter, offsets };
}

export function paintEnergy(image, energy, layers = null) {
  const { width, left, top, diameter, glyphs } = energy;
  // The border is merged with the lettering by renderBorder. Only the face
  // paints last. Keep L/R faces and their pale ledges above the energy's gray
  // rim at the junctions; repainting that rim here would cut into the letters.
  // Six elongated points with broad, concave shoulders, rather than a polygon star.
  const star = new Path2D();
  star.moveTo(0.5, 0.045);
  star.bezierCurveTo(0.54, 0.34, 0.54, 0.44, 0.91, 0.27);
  star.bezierCurveTo(0.67, 0.46, 0.6, 0.49, 0.895, 0.725);
  star.bezierCurveTo(0.57, 0.59, 0.55, 0.59, 0.5, 0.95);
  star.bezierCurveTo(0.45, 0.59, 0.43, 0.59, 0.115, 0.725);
  star.bezierCurveTo(0.4, 0.5, 0.39, 0.49, 0.11, 0.275);
  star.bezierCurveTo(0.46, 0.44, 0.45, 0.35, 0.5, 0.045);
  star.closePath();
  const ctx = new OffscreenCanvas(1, 1).getContext("2d");
  let starPixels = 0;
  for (const p of glyphs[3]) {
    const u = ((p % width) + 0.5 - left) / diameter;
    const v = (Math.floor(p / width) + 0.5 - top) / diameter;
    const highlight = Math.exp(-((u - 0.72) ** 2 / 0.035 + (v - 0.27) ** 2 / 0.035));
    const silver = Math.round(218 + 22 * u - 32 * v + 27 * highlight);
    const faceColor = [Math.min(250, silver + 4), Math.min(248, silver + 2), silver];
    if (layers) layers.background.data.set([...faceColor, 255], p * 4);
    let color;
    if (ctx.isPointInPath(star, u, v)) {
      const light = Math.round(highlight * 43);
      color = [21 + light, 25 + light, 27 + light];
      if (layers) {
        const localX = (p % width) - left,
          localY = Math.floor(p / width) - top;
        layers.star.data.set([...color, 255], (localY * diameter + localX) * 4);
      }
      starPixels++;
    } else {
      color = faceColor;
    }
    image.data.set([...color, 255], p * 4);
  }
  // Use one continuous circular arc per contact, rather than independently
  // fading pixels according to the neighboring letter's irregular contour.
  // This prevents the right seam from pinching or breaking along R's stem.
  const radius = diameter / 2,
    cx = left + radius,
    cy = top + radius;
  const arcs = [-1, 1].map((side, i) => {
    let start = Infinity,
      end = -Infinity;
    for (const p of glyphs[i === 0 ? 2 : 4]) {
      const dx = (p % width) + 0.5 - cx,
        dy = Math.floor(p / width) + 0.5 - cy;
      if (side * dx <= 0 || Math.abs(Math.hypot(dx, dy) - radius) > 3) continue;
      const angle = Math.atan2(dy, side * dx);
      start = Math.min(start, angle);
      end = Math.max(end, angle);
    }
    return { side, start: start - 0.04, end: end + 0.04 };
  });
  // Trace the outside of the actual rasterized disc, not a second circle
  // whose rounding can drift across its edge and flatten parts of the seam.
  const disc = new Uint8Array(width * energy.height);
  for (const p of glyphs[3]) disc[p] = 1;
  let seamPixels = 0;
  for (let p = 0; p < width * energy.height; p++) {
    if (disc[p]) continue;
    const x = p % width,
      y = Math.floor(p / width);
    const touchesDisc =
      (x > 0 && disc[p - 1]) ||
      (x + 1 < width && disc[p + 1]) ||
      (y > 0 && disc[p - width]) ||
      (y + 1 < energy.height && disc[p + width]);
    if (!touchesDisc) continue;
    const dx = x + 0.5 - cx,
      dy = y + 0.5 - cy;
    const arc = arcs[dx < 0 ? 0 : 1];
    const angle = Math.atan2(dy, arc.side * dx);
    // One logical pixel of solid neutral gray, without transparency or taper.
    if (angle >= arc.start && angle <= arc.end) {
      image.data.set([132, 132, 132, 255], p * 4);
      if (layers) layers.background.data.set([132, 132, 132, 255], p * 4);
      seamPixels++;
    }
  }
  return { diameter, starPixels, seamPixels, facePixels: glyphs[3].length };
}
