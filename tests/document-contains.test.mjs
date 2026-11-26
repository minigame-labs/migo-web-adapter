// document.contains (src/document.js): the document contains itself and everything in its tree, and nothing outside it.
// winit sizes its canvas only when `document.contains(canvas)`; it threw "contains is not a function".
import assert from "node:assert/strict";

globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => ({ width: 0, height: 0, getContext() { return {}; }, toDataURL: () => "data:," }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};
await import("../src/index.js");
const { document } = globalThis;
assert.equal(document.contains(document), true, "a node contains itself");
assert.equal(document.contains(document.documentElement), true);
assert.equal(document.contains(document.body), true);
const div = document.createElement("div");
assert.equal(document.contains(div), false, "an element not in the tree");
document.body.appendChild(div);
assert.equal(document.contains(div), true, "an element put in the tree");
const inner = document.createElement("span");
div.appendChild(inner);
assert.equal(document.contains(inner), true, "a descendant");
div.removeChild(inner);
assert.equal(document.contains(inner), false, "one taken out again");
assert.equal(document.contains(null), false);
console.log("document-contains: ok");
