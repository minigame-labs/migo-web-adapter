// A page that already has a canvas of its own in its document does not hand the screen to a canvas it makes later: a
// loader's WebGL feature probe, made once its assets have arrived (Defold's dmloader.js `hasWebGLSupport`), took the
// screen and its context, the composite then could not show the page's canvas, and the game ran on a black screen.

import assert from "node:assert/strict";

const made = [];
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => {
    const canvas = { n: made.length, width: 0, height: 0, getContext() { this._context = {}; return this._context; }, toDataURL: () => "data:," };
    made.push(canvas);
    return canvas;
  },
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};

await import("../src/index.js");
const { document } = globalThis;
const onscreen = globalThis.canvas;

// The page's own canvas, made while its script loads (as Defold's page writes it in its body).
const pageCanvas = document.createElement("canvas");
document.body.appendChild(pageCanvas);
assert.notEqual(pageCanvas, onscreen);

await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(document.readyState, "complete");

// The loader's assets have arrived; it checks for WebGL with a canvas of its own.
const probe = document.createElement("canvas");
const gl = probe.getContext("webgl");
assert.ok(gl);
assert.notEqual(probe, onscreen, "a probe made once the page has a canvas in its document is offscreen");
assert.equal(onscreen._context, undefined, "and the screen stays unclaimed, for the composite to show the page's canvas");

console.log("display-canvas-late-probe tests: all passed");
