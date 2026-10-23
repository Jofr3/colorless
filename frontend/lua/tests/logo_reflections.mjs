import assert from "node:assert/strict";
import { refineReflections, reflectionColor } from "../tools/logo_reflections.js";

const w = 1024,
  h = 380,
  image = { data: new Uint8ClampedArray(w * h * 4) };
const mask = new Uint8Array(w * h),
  glyphs = [];
// Nine separated faces spanning the actual authoring positions. Old colored
// paint should be cleared, while gray sidewalls and alpha remain untouched.
const regions = [
  [44, 88, 131, 280],
  [155, 94, 241, 282],
  [264, 64, 337, 294],
  [365, 94, 449, 284],
  [482, 84, 579, 299],
  [598, 64, 675, 294],
  [694, 90, 782, 296],
  [807, 92, 891, 281],
  [918, 94, 998, 282],
];
for (const [left, top, right, bottom] of regions) {
  const pixels = [];
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const p = y * w + x;
      mask[p] = 1;
      pixels.push(p);
      image.data.set([246, 130, 153, 255], p * 4);
    }
  for (let y = top; y <= bottom; y++) {
    image.data.set([243, 237, 229, 255], (y * w + left - 1) * 4);
    image.data.set([79, 99, 103, 255], (y * w + left - 2) * 4);
  }
  glyphs.push(pixels);
}
const before = image.data.slice();
const stats = refineReflections(image, mask, [...glyphs].reverse(), w, h);
assert.equal(
  stats.facePixels,
  glyphs.reduce((sum, glyph) => sum + glyph.length, 0),
);
assert.ok(stats.reflectionPixels / stats.facePixels < 0.25, "Most of each face remains ivory");
assert.ok(stats.reflectionPixels / stats.facePixels > 0.05, "Reflection paint remains visible");
assert.ok(stats.bevelPixels > 0, "Hand-drawn streaks continue over the light lip");
for (let p = 0; p < mask.length; p++) {
  assert.equal(image.data[p * 4 + 3], before[p * 4 + 3], "Alpha and counters remain unchanged");
  if (!before[p * 4 + 3] || before.subarray(p * 4, p * 4 + 3).join(",") === "79,99,103")
    assert.deepEqual(image.data.subarray(p * 4, p * 4 + 4), before.subarray(p * 4, p * 4 + 4));
}
for (const glyph of glyphs) {
  const colors = new Set(glyph.map((p) => image.data.subarray(p * 4, p * 4 + 3).join(",")));
  assert.ok(colors.has("248,244,240"), "Old face paint is cleared to ivory");
  assert.ok(colors.size > 12, "Gradient detail survives within each letter");
}
const blue = reflectionColor(110),
  rose = reflectionColor(230);
assert.ok(
  blue[2] > blue[0] + 50 && rose[0] > rose[2] + 50,
  "The material progresses from blue to rose",
);
assert.throws(() => refineReflections(image, mask, glyphs, 512, 190), /1024/);
console.log(
  "PASS: sparse hand-drawn paint, gradients, bevel continuity and unchanged alpha/gray borders",
);
