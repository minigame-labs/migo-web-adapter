// IntersectionObserver (src/intersection-observer.js): reported at the first step after observe(), in a task; again when
// a threshold is crossed or the element leaves the viewport or the document; rootMargin and thresholds as given. winit
// watches its canvas with one and panicked where there was none.
import assert from "node:assert/strict";

const reported = [];
globalThis.reportError = (e) => reported.push(e);
globalThis.innerWidth = 400;
globalThis.innerHeight = 800;
const inTree = new Set();
globalThis.document = { contains: (node) => inTree.has(node) };
const { IntersectionObserver, updateIntersectionObservations, setIntersectionRenderingUpdate } = await import("../src/intersection-observer.js");

let frames = 0;
setIntersectionRenderingUpdate(() => { frames++; });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const box = (x, y, w, h) => ({ x, y, w, h, style: {}, getBoundingClientRect() { return { left: this.x, top: this.y, width: this.w, height: this.h }; } });

const canvas = box(0, 0, 400, 800);
inTree.add(canvas);
const seen = [];
const observer = new IntersectionObserver(function (entries, self) {
  assert.equal(self, observer);
  for (const e of entries) seen.push([e.isIntersecting, Math.round(e.intersectionRatio * 100) / 100, e.target === canvas]);
});
assert.equal(observer.rootMargin, "0px 0px 0px 0px");
assert.deepEqual([...observer.thresholds], [0]);
observer.observe(canvas);
assert.equal(frames, 1, "observing asks for a frame");
updateIntersectionObservations(1);
assert.deepEqual(seen, [], "the records are delivered in a task, not in the step");
await tick();
assert.deepEqual(seen, [[true, 1, true]], "the first step reports the element");
updateIntersectionObservations(2);
await tick();
assert.equal(seen.length, 1, "nothing changed, nothing reported");
canvas.x = 500;
updateIntersectionObservations(3);
await tick();
assert.deepEqual(seen.at(-1), [false, 0, true], "out of the viewport");
canvas.x = 0;
canvas.style.display = "none";
updateIntersectionObservations(4);
await tick();
assert.equal(seen.length, 2, "not displayed is still not intersecting: no change");
canvas.style.display = "";
updateIntersectionObservations(5);
await tick();
assert.deepEqual(seen.at(-1), [true, 1, true], "displayed again");
inTree.delete(canvas);
updateIntersectionObservations(6);
await tick();
assert.deepEqual(seen.at(-1), [false, 0, true], "out of the document");
observer.disconnect();

// Thresholds and a root margin.
const half = box(0, 600, 100, 400);           // half of it below the viewport
inTree.add(half);
const ratios = [];
const t = new IntersectionObserver((entries) => ratios.push(entries.map((e) => [e.isIntersecting, e.intersectionRatio])), { threshold: [0.25, 0.75], rootMargin: "0px 0px 200px 0px" });
t.observe(half);
updateIntersectionObservations(7);
await tick();
assert.deepEqual(ratios, [[[true, 1]]], "the bottom margin takes in the half below");
const records = (() => { half.y = 700; updateIntersectionObservations(8); return t.takeRecords(); })();
assert.equal(records.length, 0, "a ratio still past the last threshold is no crossing");
half.y = 1000 - 40;                           // 40 of 400 inside the grown root
updateIntersectionObservations(9);
const taken = t.takeRecords();
assert.equal(taken.length, 1, "takeRecords takes what is not yet delivered");
assert.ok(Math.abs(taken[0].intersectionRatio - 0.1) < 1e-9);
await tick();
assert.equal(ratios.length, 1, "taken records are not delivered again");
t.disconnect();

// A callback's error is reported.
const thrower = new IntersectionObserver(() => { throw new Error("from an intersection callback"); });
thrower.observe(half);
updateIntersectionObservations(10);
await tick();
assert.equal(reported.length, 1);
thrower.disconnect();

assert.throws(() => new IntersectionObserver(), TypeError);
assert.throws(() => new IntersectionObserver(() => {}, { threshold: 2 }), RangeError);
assert.throws(() => new IntersectionObserver(() => {}, { rootMargin: "1em" }), SyntaxError);
console.log("intersection-observer: ok");
