// Which canvas an engine's `document.createElement('canvas')` becomes the one Migo presents.
//
// Migo presents exactly one canvas: the first `migo.createCanvas()`, which the adapter publishes as `globalThis.canvas`.
// An engine that makes its own render canvas draws into an offscreen buffer nobody sees unless the adapter hands it that
// surface, so the first canvas created once the document is ready -- while the onscreen one is still unclaimed -- is the
// onscreen one. Canvases made while the script loads are feature probes and must not take it. Phaser boots on
// DOMContentLoaded, so that is where "ready" starts (the gate used to open at `load`, after Phaser had already made, and
// drawn into, an offscreen canvas).

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
assert.equal(made[0], onscreen, "the adapter's global canvas is the first host canvas, the presented one");

// While the script loads: a feature probe, not the display canvas -- even though the onscreen one is unclaimed.
const probe = document.createElement("canvas");
assert.notEqual(probe, onscreen, "a canvas made before the document is ready is a probe");
probe.getContext("webgl");

let atDomContentLoaded = null;
document.addEventListener("DOMContentLoaded", () => {
  // Phaser's boot, and the first thing it does is make its canvas.
  atDomContentLoaded = document.createElement("canvas");
});
let atLoad = null;
globalThis.addEventListener("load", () => { atLoad = document.createElement("canvas"); });

await new Promise((resolve) => setTimeout(resolve, 20));

assert.equal(atDomContentLoaded, onscreen, "the first canvas made at DOMContentLoaded is the presented one");
assert.notEqual(atLoad, onscreen, "the onscreen canvas is handed out once, not to every later canvas");
assert.notEqual(atLoad, null);

// A second engine boot after the display canvas is spoken for gets offscreen canvases, whenever it asks.
assert.notEqual(document.createElement("canvas"), onscreen);

// An engine that claimed the onscreen canvas itself (Pixi/Cocos: `view: canvas`) keeps it: nothing is routed over a
// canvas that already has a context.
console.log("display-canvas tests: all passed");
