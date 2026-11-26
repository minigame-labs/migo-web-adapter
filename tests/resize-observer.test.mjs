// ResizeObserver (src/resize-observer.js): observed at the next frame, after its animation callbacks and before it is
// painted; again when the size changes; a 0 x 0 element only when it gets a size; one pass a frame; errors reported and
// the other observers still told. Kaplay and Excalibur threw at start-up where there was none.
import assert from "node:assert/strict";

const reported = [];
globalThis.reportError = (e) => reported.push(e);
const { ResizeObserver, ResizeObserverEntry, deliverResizeObservations, setRenderingUpdate, requestResizeCheck } = await import("../src/resize-observer.js");

let frames = 0;
setRenderingUpdate(() => { frames++; });

const box = (w, h) => ({ w, h, getBoundingClientRect() { return { x: 0, y: 0, width: this.w, height: this.h }; } });
const canvas = box(720, 1280);
const empty = box(0, 0);
const seen = [];
const observer = new ResizeObserver(function (entries, self) {
  assert.equal(self, observer, "the callback is handed its observer");
  assert.equal(this, observer, "and called on it");
  for (const e of entries) seen.push([e.target === canvas ? "canvas" : "empty", e.contentRect.width, e.contentRect.height, e.contentBoxSize[0].inlineSize, e.borderBoxSize[0].blockSize]);
});
observer.observe(canvas);
observer.observe(empty);
assert.equal(frames, 2, "observing asks for a frame to be checked in");
assert.deepEqual(seen, [], "nothing is delivered before the frame");
deliverResizeObservations();
assert.deepEqual(seen, [["canvas", 720, 1280, 720, 1280]], "an element with a size is reported; one of 0 x 0 is not");
deliverResizeObservations();
assert.equal(seen.length, 1, "an unchanged size is not reported again");
canvas.w = 360;
empty.w = 10; empty.h = 20;
deliverResizeObservations();
assert.deepEqual(seen.slice(1), [["canvas", 360, 1280, 360, 1280], ["empty", 10, 20, 10, 20]], "changes are reported together, in observation order");
assert.ok(new ResizeObserverEntry(canvas, { width: 1, height: 2 }).target === canvas);

// Observing again starts over; unobserve and disconnect stop it.
observer.observe(canvas);
deliverResizeObservations();
assert.deepEqual(seen.at(-1), ["canvas", 360, 1280, 360, 1280], "a target observed again is reported again");
observer.unobserve(canvas);
canvas.w = 100;
deliverResizeObservations();
assert.equal(seen.filter((s) => s[0] === "canvas").length, 3, "an unobserved target is not reported");
observer.disconnect();
empty.w = 99;
deliverResizeObservations();
assert.equal(seen.length, 4, "a disconnected observer is told nothing");

// A device-pixel box is counted in device pixels.
globalThis.devicePixelRatio = 2;
const device = [];
const dpo = new ResizeObserver((entries) => device.push(entries[0].devicePixelContentBoxSize[0].inlineSize));
dpo.observe(box(50, 50), { box: "device-pixel-content-box" });
deliverResizeObservations();
assert.deepEqual(device, [100]);
dpo.disconnect();

// One observer's error is reported and the next is still told; a size the callback changes is the next frame's.
const late = [];
const target = box(5, 5);
const thrower = new ResizeObserver(() => { target.w = 6; throw new Error("from a resize callback"); });
const other = new ResizeObserver((entries) => late.push(entries[0].contentRect.width));
thrower.observe(target);
other.observe(target);
deliverResizeObservations();
assert.equal(reported.length, 1);
assert.equal(reported[0].message, "from a resize callback");
assert.deepEqual(late, [5], "every observer's entries are gathered before any is delivered");
deliverResizeObservations();
assert.deepEqual(late, [5, 6], "the change made in a callback is reported at the next frame");
thrower.disconnect(); other.disconnect();

// Arguments, as WebIDL has them.
assert.throws(() => new ResizeObserver(), TypeError);
assert.throws(() => new ResizeObserver({}), TypeError);
const o = new ResizeObserver(() => {});
assert.throws(() => o.observe(null), TypeError);
assert.throws(() => o.observe(box(1, 1), { box: "padding-box" }), TypeError);

// A canvas is measured by its CSS box, not its drawing buffer: winit sizes its canvas `width: 100%` of the window and
// waits to be told the box, while the buffer is still Bevy's default 1280 x 720.
globalThis.innerWidth = 360;
globalThis.innerHeight = 640;
const gameCanvas = { width: 1280, height: 720, style: {}, getContext() {}, getBoundingClientRect() { return { width: 1280, height: 720 }; } };
const boxes = [];
const co = new ResizeObserver((entries) => boxes.push([entries[0].contentRect.width, entries[0].contentRect.height]));
co.observe(gameCanvas);
deliverResizeObservations();
assert.deepEqual(boxes, [[1280, 720]], "a canvas with no CSS size is its own size");
gameCanvas.style.width = "100%";
gameCanvas.style.height = "100%";
deliverResizeObservations();
assert.deepEqual(boxes.at(-1), [360, 640], "a canvas sized 100% is the window's size");
co.disconnect();

// With no display a check is a task.
setRenderingUpdate(null);
const tasked = [];
const t = new ResizeObserver((entries) => tasked.push(entries.length));
t.observe(box(3, 3));
requestResizeCheck();
await new Promise((r) => setTimeout(r, 5));
assert.deepEqual(tasked, [1]);
t.disconnect();
console.log("resize-observer: ok");
