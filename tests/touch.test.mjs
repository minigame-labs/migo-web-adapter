// Touches reach content as DOM Touch objects: `target` is the canvas the touch began on, the screen coordinates and the
// contact ellipse are there, lists have `item()`. Phaser 3 only emits a scene's `pointerdown` when the pointer's
// `downElement` -- taken from `touch.target` -- is its canvas.

import assert from "node:assert/strict";

let deliver = {};
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  // The engine's host canvas has working listener methods (web/03_canvas.js); so does this one.
  createCanvas: () => {
    const listeners = new Map();
    return {
      width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:,",
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn.call(this, event); return true; },
    };
  },
  onTouchStart: (cb) => { deliver.touchstart = cb; },
  onTouchMove: (cb) => { deliver.touchmove = cb; },
  onTouchEnd: (cb) => { deliver.touchend = cb; },
  onTouchCancel: (cb) => { deliver.touchcancel = cb; },
};

await import("../src/index.js");
const canvas = globalThis.canvas;
const seen = [];
canvas.addEventListener("touchstart", (event) => seen.push(event));
globalThis.addEventListener("touchmove", (event) => seen.push(event));

const first = { identifier: 7, clientX: 10.5, clientY: 20.25, pageX: 10.5, pageY: 20.25, force: 0.5 };
const second = { identifier: 8, clientX: 100, clientY: 200, pageX: 100, pageY: 200, force: 1 };
deliver.touchstart({ touches: [first, second], changedTouches: [second], timeStamp: 12 });

assert.equal(seen.length, 1, "the canvas got the touchstart");
const event = seen[0];
assert.equal(event.target, canvas);
assert.equal(event.touches.length, 2);
assert.equal(event.changedTouches.length, 1);
assert.equal(event.targetTouches.length, 2, "every point is on the one canvas, so each is a target touch");

const touch = event.changedTouches[0];
assert.equal(touch.identifier, 8);
assert.equal(touch.target, canvas, "a Touch names the element it began on");
assert.equal(touch.clientX, 100);
assert.equal(touch.clientY, 200);
assert.equal(touch.pageX, 100);
assert.equal(touch.screenX, 100, "the app owns the screen, so a screen coordinate is the client one");
assert.equal(touch.screenY, 200);
assert.equal(touch.force, 1);
assert.equal(touch.radiusX, 0);
assert.equal(touch.rotationAngle, 0);
assert.equal(event.touches.item(0).identifier, 7, "a TouchList has item()");
assert.equal(event.touches.item(5), null, "item() past the end is null, not undefined");
assert.ok(touch instanceof globalThis.Touch, "Touch is a global constructor");

// What the host sent is not touched: other listeners of migo.onTouchStart see the platform's own objects.
assert.equal(first.target, undefined, "the host's touch object is not modified");

// A move reaches window with the same shape.
deliver.touchmove({ touches: [first], changedTouches: [first], timeStamp: 30 });
assert.equal(seen[1].type, "touchmove");
assert.equal(seen[1].changedTouches[0].target, canvas);

// Absent lists are empty lists, not a crash.
deliver.touchend({ timeStamp: 40 });
console.log("touch tests: all passed");
