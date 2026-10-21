// Hand-drawn reflection shapes on COLORLESS's own 1024 × 380 authoring grid.
// Balatro is a visual reference only: no source texture or glyph is sampled.
// Each polygon is a sharp, irregular cutout through one shared reflection
// gradient. The gradient spans the lettering, not the thickness of each stripe.
// Tapers span long paths, often extending beyond a narrow stem's clipping mask.
// This keeps local width changes gradual instead of forming short triangular
// bulges. Visible endpoints on the E/S crowns taper to a point.
export const STREAKS = [
  // C: a rising shoulder wedge, short stem cuts, and a fine lower glint.
  [
    [[43,124],[66,111],[89,102],[111,94],[132,83],
     [119,99],[98,111],[75,122],[53,130],[43,132]],
    [[27,143],[50,150],[75,155],[100,158],[100,160],[75,160],[50,158],[27,154]],
    [[23,226],[47,219],[72,212],[96,206],[96,210],[72,221],[47,233],[23,245]],
    [[27,248],[50,251],[75,254],[98,257],[98,263],[75,259],[50,254],[27,249]],
  ],
  // First O: asymmetric cap, shallow curved lavender band, falling rose band.
  // Opposite stem marks are clipped from shared paths across the counter.
  [
    [[149,118],[169,105],[190,102],[212,108],[232,118],[247,123],
     [247,127],[232,125],[212,119],[190,117],[169,124],[149,138]],
    [[137,174],[163,180],[188,185],[212,184],[245,177],
     [245,180],[213,188],[188,191],[163,188],[137,178]],
    [[137,213],[164,217],[190,226],[215,237],[246,246],
     [246,249],[215,243],[190,235],[164,229],[137,228]],
  ],
  // First L: slim stem patches and one hairline crossing the flared foot.
  [
    [[242,115],[267,125],[291,135],[311,143],[311,148],[291,145],[267,138],[242,130]],
    [[248,185],[270,195],[292,204],[314,211],[314,214],[292,211],[270,205],[248,199]],
    [[258,251],[280,252],[301,258],[322,267],[344,277],
     [344,288],[322,275],[301,264],[280,255],[258,253]],
  ],
  // Second O: tilted cap and rising lavender/rose paths distinguish it from
  // the first O. A separate fine low glint keeps the lower face light.
  [
    [[359,122],[381,110],[403,109],[426,119],[451,125],
     [451,138],[426,131],[403,118],[381,116],[359,126]],
    [[344,196],[371,187],[397,181],[423,176],[454,169],
     [454,179],[423,185],[397,188],[371,192],[344,199]],
    [[341,235],[366,226],[392,216],[419,206],[454,193],
     [454,197],[419,213],[392,225],[366,237],[341,248]],
    [[409,250],[433,250],[458,254],[481,259],[481,266],[458,260],[433,254],[409,252]],
  ],
  // R: shared blue and rose paths continue across its open bowl and fork;
  // the face mask supplies the breaks, keeping the angles aligned.
  [
    [[465,106],[492,111],[518,116],[544,126],[571,143],
     [571,155],[544,136],[518,123],[492,116],[465,112]],
    [[474,172],[488,170],[505,162],[505,164],[490,174],[474,175]],
    [[470,221],[493,214],[517,205],[540,199],[562,193],[584,185],
     [584,195],[562,206],[540,214],[517,218],[493,228],[470,236]],
    [[550,247],[565,248],[580,242],[580,245],[566,251],[550,249]],
  ],
  // Second L: its own sloped cuts and a more gently falling foot reflection.
  [
    [[578,116],[601,125],[624,134],[647,144],[647,159],[624,147],[601,135],[578,123]],
    [[578,189],[600,195],[624,199],[648,201],[648,217],[624,211],[600,204],[578,194]],
    [[584,247],[609,253],[635,261],[660,271],[686,283],
     [686,285],[660,274],[635,266],[609,260],[584,257]],
  ],
  // E: a diagonal crown glint, an isolated stem patch, a thin middle-arm
  // slash, and a low red mark following the new stem-to-foot transition.
  [
    [[679,118],[704,113],[729,108],[753,98],[778,87],[787,83],
     [776,98],[753,113],[729,122],[704,119]],
    [[679,138],[702,146],[726,153],[750,157],[750,174],[726,166],[702,153],[679,140]],
    [[690,214],[714,209],[739,199],[764,186],[764,195],[739,207],[714,214],[690,216]],
    [[679,259],[702,252],[726,243],[750,231],[750,234],[726,249],[702,261],[679,271]],
    [[683,274],[708,265],[734,263],[760,268],[787,279],
     [787,283],[760,274],[734,270],[708,273],[683,284]],
  ],
  // First S: one rising blue ribbon crosses both upper shoulders. Its sections
  // share the same path through the open bowl, rather than meeting two arcs.
  [
    [[789,141],[813,129],[839,117],[864,107],[895,98],
     [895,104],[864,115],[839,127],[813,141],[789,155]],
    [[821,196],[842,184],[863,170],[884,153],[887,157],[867,178],[846,191],[826,202]],
    [[839,230],[857,211],[875,191],[893,173],[898,178],[883,202],[867,227],[850,248]],
    [[794,268],[820,261],[847,253],[874,243],[901,231],
     [901,234],[874,247],[847,258],[820,266],[794,273]],
  ],
  // Last S: a curved cap reflection, a higher fine waist mark, and a descending
  // rose sweep through the lower bowl give it a different rhythm and direction.
  [
    [[914,113],[937,102],[959,101],[982,110],[1000,122],
     [1000,125],[980,118],[957,111],[936,109]],
    [[905,154],[932,159],[958,164],[984,166],[1010,166],
     [1010,168],[984,170],[958,169],[932,163],[905,157]],
    [[907,220],[933,232],[959,247],[984,260],[1008,270],
     [1008,274],[984,267],[959,256],[933,243],[907,233]],
  ],
];

const SPECTRUM = [
  [88, [145, 214, 252]],
  [114, [151, 207, 246]],
  [143, [164, 190, 222]],
  [177, [187, 182, 206]],
  [194, [203, 166, 187]],
  [216, [216, 145, 160]],
  [240, [240, 156, 163]],
  [270, [243, 179, 179]],
  [300, [244, 195, 191]],
];
// The tall Ls start far above the other capitals. Shift their material's color
// progression so their stem cuts reach rose before the lower foot. Small
// differences on R/S follow the placement of those letters' diagonal cuts.
const TONE_SHIFT = [0, 0, 18, -3, 8, 16, 0, 8, 10];
export function reflectionColor(y) {
  if (y <= SPECTRUM[0][0]) return [...SPECTRUM[0][1]];
  for (let i = 1; i < SPECTRUM.length; i++) {
    const [end, b] = SPECTRUM[i], [start, a] = SPECTRUM[i - 1];
    if (y <= end) return a.map((v, c) => Math.round(v + (b[c] - v) * (y - start) / (end - start)));
  }
  return [...SPECTRUM.at(-1)[1]];
}
function inside(polygon, x, y) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

export function refineReflections(image, mask, glyphs, w, h, { pixelGrid = false } = {}) {
  if ((!pixelGrid && (w !== 1024 || h !== 380)) || glyphs.length !== 9)
    throw new Error('Hand-drawn COLORLESS reflections require nine faces on the 1024 × 380 grid');
  const ordered = glyphs.map(pixels => ({ pixels, left: Math.min(...pixels.map(p => p % w)) }))
    .sort((a, b) => a.left - b.left);
  const owner = new Int8Array(mask.length).fill(-1);
  for (const [i, glyph] of ordered.entries()) for (const p of glyph.pixels) owner[p] = i;
  const ivory = [248, 244, 240];
  const lips = new Set(['243,237,229', '221,209,194', '203,187,167']);
  const offsets = [];
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++)
    if (dx * dx + dy * dy <= 144) offsets.push({ dx, dy, d: dx * dx + dy * dy });
  offsets.sort((a, b) => a.d - b.d);
  let facePixels = 0, reflectionPixels = 0, bevelPixels = 0, highlightedPixels = 0;
  for (let p = 0; p < mask.length; p++) {
    const x = p % w, y = Math.floor(p / w);
    let letter = owner[p];
    let faceDistanceSquared = Infinity;
    const base = Array.from(image.data.subarray(p * 4, p * 4 + 3));
    if (mask[p]) { image.data.set(ivory, p * 4); facePixels++; }
    else {
      if (image.data[p * 4 + 3] !== 255 || !lips.has(base.join(','))) continue;
      for (const { dx, dy, d } of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && owner[ny * w + nx] >= 0) {
          letter = owner[ny * w + nx]; faceDistanceSquared = d; break;
        }
      }
    }
    if (letter < 0) continue;
    // Evaluate the original paths at each logical pixel's center. The grid
    // supplies the same steps for contours, streaks, gradients and highlights.
    // High-resolution authoring previews retain their original two-pixel snap.
    const sx = pixelGrid ? (x + .5) * 1024 / w : Math.floor(x / 2) * 2 + 1;
    const sy = pixelGrid ? (y + .5) * 380 / h : Math.floor(y / 2) * 2 + 1;
    if (!STREAKS[letter].some(polygon => inside(polygon, sx, sy))) continue;
    const color = reflectionColor((pixelGrid ? sy : y) + TONE_SHIFT[letter]);
    if (mask[p]) { image.data.set(color, p * 4); reflectionPixels++; }
    else {
      // The same drawn cut continues over the light bevel with its existing
      // light level. No nearest-source-pixel projection or texture stretching.
      const innerLip = base[0] === 243 && base[1] === 237 && base[2] === 229;
      if (innerLip) {
        // A color-tinted hairline catches light at the face/ledge junction.
        // The nearest pixel is gently whitened; the remainder of the existing
        // lip has a weaker highlight. Keep the streak hue and the bevel width.
        const light = faceDistanceSquared <= 2 ? .30 : .12;
        image.data.set(color.map(v => Math.round(v + (255 - v) * light)), p * 4);
        highlightedPixels++;
      } else {
        image.data.set(color.map((v, c) => Math.round(v * base[c] / ivory[c])), p * 4);
      }
      bevelPixels++;
    }
  }
  return { facePixels, reflectionPixels, bevelPixels, highlightedPixels, method: 'hand-drawn per-letter shapes' };
}
