import assert from 'node:assert/strict';
import { renderBorder } from '../tools/logo_border.js';

// Independent measurements from resources/textures/2x/balatro.png, O at
// x=610: painted face ends at y=285; the following pixels are its border.
// The two lightest bands use the user's subsequent softer highlight palette.
const bottom = [
  [2, [243, 237, 229, 255]],
  [2, [221, 209, 194, 255]],
  [6, [203, 187, 167, 255]],
  [4, [79, 99, 103, 255]],
  [2, [91, 117, 123, 255]],
  [2, [67, 81, 83, 255]],
  [4, [49, 58, 60, 255]],
  [2, [255, 255, 255, 100]],
  [2, [255, 255, 255, 59]],
  [2, [255, 255, 255, 29]],
  [2, [255, 255, 255, 11]],
  [2, [255, 255, 255, 3]],
];
const w = 180, h = 260, mask = new Uint8Array(w * h);
for (let y = 40; y <= 205; y++) for (let x = 50; x <= 129; x++) mask[y * w + x] = 1;
const pixels = renderBorder(mask, w, h);
const pixel = (x, y) => Array.from(pixels.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
let y = 206;
for (const [length, color] of bottom) for (let i = 0; i < length; i++) {
  assert.deepEqual(pixel(90, y), color, `Source bottom profile, offset ${y - 205}`);
  y++;
}
assert.deepEqual(pixel(90, y), [0, 0, 0, 0], 'Outer rim fades to transparent');

// Source top rows 112–119; source sides have the same 6px slate rim and
// 2px face-edge highlight, now softened to warm ivory.
const top = [
  [91, 117, 123, 255], [91, 117, 123, 255],
  ...Array(4).fill([79, 99, 103, 255]),
  [243, 237, 229, 255], [243, 237, 229, 255],
];
for (let i = 0; i < top.length; i++) {
  assert.deepEqual(pixel(90, 32 + i), top[i], `Source top profile ${i}`);
  assert.deepEqual(pixel(42 + i, 120), top[i], `Source left profile ${i}`);
  assert.deepEqual(pixel(137 - i, 120), top[i], `Source right profile ${i}`);
}
console.log('PASS: source border geometry and alpha preserved with softened highlights');
