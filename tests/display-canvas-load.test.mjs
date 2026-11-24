// An engine that boots in a load handler, in a page with no canvas of its own in the document, still makes the display
// canvas.

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

let atLoad = null;
let inOnload = null;
globalThis.addEventListener("load", () => { atLoad = document.createElement("canvas"); });
globalThis.onload = () => { inOnload = document.createElement("canvas"); };
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(atLoad, onscreen, "the first canvas made in a load listener is the presented one");
assert.notEqual(inOnload, onscreen, "handed out once");
assert.notEqual(inOnload, null);

console.log("display-canvas-load tests: all passed");
