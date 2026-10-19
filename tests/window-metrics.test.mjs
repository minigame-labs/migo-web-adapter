// The viewport and the screen are whole CSS pixels (CSSOM View: `long`), on a display whose density is not a whole
// number too. 1080 x 2400 physical pixels at 2.625 is 411.43 x 914.29 CSS pixels; the host reports the fraction, a
// browser and the adapter report 411 x 914 -- the size migo gives the presented canvas.

import assert from "node:assert/strict";

globalThis.migo = {
  getWindowInfo: () => ({
    windowWidth: 1080 / 2.625, windowHeight: 2400 / 2.625, screenWidth: 1080 / 2.625, screenHeight: 2400 / 2.625,
    pixelRatio: 2.625,
  }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", pixelRatio: 2.625 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => ({ width: 411, height: 914, getContext() { return {}; }, toDataURL: () => "data:," }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};

await import("../src/index.js");

for (const [name, value, want] of [
  ["innerWidth", globalThis.innerWidth, 411],
  ["innerHeight", globalThis.innerHeight, 914],
  ["outerWidth", globalThis.outerWidth, 411],
  ["outerHeight", globalThis.outerHeight, 914],
  ["screen.width", globalThis.screen.width, 411],
  ["screen.height", globalThis.screen.height, 914],
  ["screen.availWidth", globalThis.screen.availWidth, 411],
  ["screen.availHeight", globalThis.screen.availHeight, 914],
]) {
  assert.equal(value, want, `${name} is ${value}, want the whole CSS pixel ${want}`);
}
assert.equal(globalThis.devicePixelRatio, 2.625, "the ratio itself is not rounded");
assert.equal(globalThis.innerWidth, globalThis.canvas.width, "a canvas sized to innerWidth is the one it already is");
console.log("window-metrics: ok");
