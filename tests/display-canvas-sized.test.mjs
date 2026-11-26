// An onscreen canvas the page has sized itself is the page's: a canvas it makes afterwards, once the document is ready, is
// a buffer, not the screen. Kaplay handed `canvas: globalThis.canvas` sizes it and then makes its font cache's canvas
// before taking a context; that 2D canvas was handed the screen and Kaplay's getContext('webgl') returned null.
import assert from "node:assert/strict";

const made = [];
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => {
    // The runtime's canvas records a width or height the content sets (web/03_canvas.js).
    const canvas = {
      n: made.length, _w: 0, _h: 0, _sizedByContent: false,
      get width() { return this._w; }, set width(v) { this._w = v; this._sizedByContent = true; },
      get height() { return this._h; }, set height(v) { this._h = v; this._sizedByContent = true; },
      getContext() { this._context = {}; return this._context; }, toDataURL: () => "data:,",
    };
    made.push(canvas);
    return canvas;
  },
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};

await import("../src/index.js");
const onscreen = globalThis.canvas;
let fontCache = null;
globalThis.document.addEventListener("DOMContentLoaded", () => {
  onscreen.width = 390;                                    // the page sizes the canvas it handed its engine
  fontCache = globalThis.document.createElement("canvas"); // and the engine makes a buffer of its own
});
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(fontCache, "DOMContentLoaded fired");
assert.notEqual(fontCache, onscreen, "a canvas made after the page sized the screen is not the screen");
assert.equal(onscreen._context, undefined, "and the screen is left for the engine's own context");
console.log("display-canvas-sized: ok");
