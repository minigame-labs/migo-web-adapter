// Pointer events from the host's touches and mouse, in the order the Pointer Events specification gives, with the fields
// engines read. Babylon.js and three.js's OrbitControls listen to pointer events and nothing else: before this a Babylon
// scene received no input at all on Migo.

import assert from "node:assert/strict";

const deliver = {};
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => {
    const listeners = new Map();
    return {
      width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:,",
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn.call(this, event); return true; },
    };
  },
  onTouchStart: (cb) => { deliver.touchstart = cb; },
  onTouchMove: (cb) => { deliver.touchmove = cb; },
  onTouchEnd: (cb) => { deliver.touchend = cb; },
  onTouchCancel: (cb) => { deliver.touchcancel = cb; },
  onMouseDown: (cb) => { deliver.mousedown = cb; },
  onMouseMove: (cb) => { deliver.mousemove = cb; },
  onMouseUp: (cb) => { deliver.mouseup = cb; },
};

await import("../src/index.js");
const canvas = globalThis.canvas;
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

const log = [];
for (const type of ["pointerover", "pointerenter", "pointerdown", "pointermove", "pointerup", "pointercancel", "pointerout", "pointerleave", "gotpointercapture", "lostpointercapture", "touchstart", "touchmove", "touchend", "touchcancel", "mousedown", "mousemove", "mouseup", "click"]) {
  canvas.addEventListener(type, (event) => log.push(event));
}
const names = () => log.map((e) => e.type);
const reset = () => { log.length = 0; };

assert.equal(typeof globalThis.PointerEvent, "function", "PointerEvent is a global (engines feature-detect it)");
assert.ok(new globalThis.PointerEvent("pointerdown") instanceof globalThis.MouseEvent, "PointerEvent is a MouseEvent");

const touchA = { identifier: 0, clientX: 10, clientY: 20, pageX: 10, pageY: 20, force: 0 };
const touchB = { identifier: 1, clientX: 100, clientY: 200, pageX: 100, pageY: 200, force: 0.8 };

// ---- a touch: pointer events first, in specification order ------------------------------------------------------------
deliver.touchstart({ touches: [touchA], changedTouches: [touchA], timeStamp: 5 });
assert.deepEqual(names(), ["pointerover", "pointerenter", "pointerdown", "touchstart"]);
let down = log[2];
assert.ok(down instanceof globalThis.PointerEvent);
assert.equal(down.pointerType, "touch");
assert.equal(down.pointerId, 2, "touch pointer ids start at 2: the mouse is pointer 1");
assert.equal(down.isPrimary, true);
assert.equal(down.button, 0);
assert.equal(down.buttons, 1);
assert.equal(down.pressure, 0.5, "a contact on hardware without pressure reports 0.5");
assert.equal(down.clientX, 10);
assert.equal(down.clientY, 20);
assert.equal(down.target, canvas);
assert.equal(down.bubbles, true);
assert.equal(log[1].bubbles, false, "pointerenter does not bubble");
assert.equal(down.timeStamp, 5, "the host's time stamp is kept");
reset();

// a second finger: not primary
deliver.touchstart({ touches: [touchA, touchB], changedTouches: [touchB], timeStamp: 6 });
down = log.find((e) => e.type === "pointerdown");
assert.equal(down.pointerId, 3);
assert.equal(down.isPrimary, false, "only the first contact down is primary");
assert.equal(down.pressure, 0.8, "a reported force is the pressure");
reset();

deliver.touchmove({ touches: [touchA, touchB], changedTouches: [touchA], timeStamp: 7 });
assert.deepEqual(names(), ["pointermove", "touchmove"]);
assert.equal(log[0].button, -1, "a move changes no button");
assert.equal(log[0].buttons, 1);
assert.equal(log[0].isPrimary, true);
reset();

canvas.setPointerCapture(2);
assert.equal(canvas.hasPointerCapture(2), true);
assert.deepEqual(names(), ["gotpointercapture"]);
assert.equal(log[0].pointerId, 2);
reset();

deliver.touchend({ touches: [touchB], changedTouches: [touchA], timeStamp: 8 });
assert.deepEqual(names(), ["pointerup", "pointerout", "pointerleave", "lostpointercapture", "touchend"]);
assert.equal(log[0].buttons, 0);
assert.equal(log[0].pressure, 0);
assert.equal(log[0].button, 0);
assert.equal(canvas.hasPointerCapture(2), false, "capture ends with the contact");
reset();

deliver.touchcancel({ touches: [], changedTouches: [touchB], timeStamp: 9 });
assert.deepEqual(names(), ["pointercancel", "pointerout", "pointerleave", "touchcancel"]);
reset();

// the next contact is primary again once nothing is down
deliver.touchstart({ touches: [touchA], changedTouches: [touchA], timeStamp: 10 });
assert.equal(log.find((e) => e.type === "pointerdown").isPrimary, true);
deliver.touchend({ touches: [], changedTouches: [touchA], timeStamp: 11 });
await flush();
reset();

// the pointer events reach window like touch events do
let atWindow = 0;
globalThis.addEventListener("pointerdown", () => atWindow++);
deliver.touchstart({ touches: [touchA], changedTouches: [touchA], timeStamp: 12 });
deliver.touchend({ touches: [], changedTouches: [touchA], timeStamp: 13 });
assert.equal(atWindow, 1, "pointerdown bubbles to window");
await flush();
reset();

// ---- a mouse -----------------------------------------------------------------------------------------------------------
deliver.mousedown({ x: 30, y: 40, button: 0, timeStamp: 20 });
assert.deepEqual(names(), ["pointerover", "pointerenter", "pointerdown"], "the pointer events are synchronous, the mouse event follows");
down = log[2];
assert.equal(down.pointerType, "mouse");
assert.equal(down.pointerId, 1);
assert.equal(down.isPrimary, true);
assert.equal(down.button, 0);
assert.equal(down.buttons, 1);
await flush();
assert.deepEqual(names(), ["pointerover", "pointerenter", "pointerdown", "mousedown"]);
reset();

deliver.mousemove({ x: 31, y: 41, button: 0, movementX: 1, movementY: 1, timeStamp: 21 });
assert.deepEqual(names(), ["pointermove"], "the mouse is already over the canvas: no second pointerover");
assert.equal(log[0].buttons, 1, "the button is still down");
assert.equal(log[0].movementX, 1);
await flush();
reset();

deliver.mouseup({ x: 31, y: 41, button: 0, timeStamp: 22 });
await flush();
assert.deepEqual(names(), ["pointerup", "mouseup", "click"]);
assert.equal(log[0].buttons, 0);
reset();

// a right button: DOM button 2, buttons bit 2
deliver.mousedown({ x: 5, y: 5, button: 2, timeStamp: 30 });
assert.equal(log.find((e) => e.type === "pointerdown").button, 2);
assert.equal(log.find((e) => e.type === "pointerdown").buttons, 2);
deliver.mouseup({ x: 5, y: 5, button: 2, timeStamp: 31 });
await flush();
reset();

// ---- cancelling pointerdown stops the mouse events of that contact, not the click ---------------------------------------
const cancel = (event) => event.preventDefault();
canvas.addEventListener("pointerdown", cancel);
deliver.mousedown({ x: 1, y: 1, button: 0, timeStamp: 40 });
deliver.mousemove({ x: 2, y: 2, button: 0, timeStamp: 41 });
deliver.mouseup({ x: 2, y: 2, button: 0, timeStamp: 42 });
await flush();
assert.deepEqual(names().filter((n) => !n.startsWith("pointer")), ["click"], "no mousedown, mousemove or mouseup after a cancelled pointerdown; the click still comes");
reset();
canvas.removeEventListener("pointerdown", cancel);

// ... and a cancelled touch pointerdown stops the compatibility mouse events that follow the touch
canvas.addEventListener("pointerdown", cancel);
deliver.touchstart({ touches: [touchA], changedTouches: [touchA], timeStamp: 50 });
deliver.mousedown({ x: 10, y: 20, button: 0, timeStamp: 50 });
await flush();
assert.ok(!names().includes("mousedown"), "the compatibility mousedown is dropped");
deliver.touchend({ touches: [], changedTouches: [touchA], timeStamp: 51 });
await flush();
canvas.removeEventListener("pointerdown", cancel);

// ---- capture on any element -------------------------------------------------------------------------------------------
const div = globalThis.document.createElement("div");
div.setPointerCapture(9);
assert.equal(div.hasPointerCapture(9), true);
div.releasePointerCapture(9);
assert.equal(div.hasPointerCapture(9), false);

// ---- the element members a handler calls (Babylon's pointer-down handler ends with canvas.focus()) --------------------------
assert.equal(canvas.nodeType, 1);
assert.equal(canvas.tagName, "CANVAS");
assert.equal(typeof canvas.focus, "function", "canvas.focus() exists: Babylon.js threw there and notified no pointer observer");
canvas.focus();
assert.equal(globalThis.document.activeElement, canvas, "focus() makes it the active element");
canvas.blur();
assert.equal(globalThis.document.activeElement, globalThis.document.body, "blur() gives focus back to <body>");
assert.equal(canvas.ownerDocument, globalThis.document);
assert.equal(canvas.contains(canvas), true);
assert.equal(canvas.isConnected, false, "a canvas nobody appended is not connected");
globalThis.document.body.appendChild(canvas);
assert.equal(canvas.isConnected, true, "appended to <body> it is");
assert.equal(canvas.parentElement, globalThis.document.body);
assert.equal("requestPointerLock" in canvas, false, "what Migo cannot do stays absent, so feature detection is honest");

console.log("pointer-events tests: all passed");
