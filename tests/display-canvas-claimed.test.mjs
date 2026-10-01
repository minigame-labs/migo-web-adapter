// The other half of display-canvas routing: an engine that took the global onscreen canvas for itself (Pixi's
// `view: canvas`, Cocos) must not have a second canvas routed on top of it once the document is ready.

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
globalThis.canvas.getContext("webgl2");          // the engine claims the onscreen canvas before the document is ready

let later = null;
globalThis.document.addEventListener("DOMContentLoaded", () => { later = globalThis.document.createElement("canvas"); });
await new Promise((resolve) => setTimeout(resolve, 20));

assert.notEqual(later, globalThis.canvas, "a canvas the engine already holds a context on is never handed out twice");
assert.notEqual(later, null);
console.log("display-canvas-claimed tests: all passed");
