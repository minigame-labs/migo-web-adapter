import assert from "node:assert/strict";
import EventTarget from "../src/event-target.js";
import { Event } from "../src/events.js";
import { AbortController } from "../src/abort.js";

const target = new EventTarget();
const seen = [];

// once
target.addEventListener("a", () => seen.push("once"), { once: true });
target.dispatchEvent({ type: "a" });
target.dispatchEvent({ type: "a" });
assert.deepEqual(seen, ["once"], "a once listener runs once");

// the same listener added twice is one listener; removal by function
seen.length = 0;
const f = () => seen.push("f");
target.addEventListener("b", f);
target.addEventListener("b", f);
target.dispatchEvent({ type: "b" });
assert.deepEqual(seen, ["f"]);
target.removeEventListener("b", f);
target.dispatchEvent({ type: "b" });
assert.deepEqual(seen, ["f"], "removed listener is not called");

// handleEvent objects
seen.length = 0;
const object = { handleEvent(event) { seen.push("object:" + event.type); } };
target.addEventListener("c", object);
target.dispatchEvent({ type: "c" });
assert.deepEqual(seen, ["object:c"]);
target.removeEventListener("c", object);
target.dispatchEvent({ type: "c" });
assert.equal(seen.length, 1);

// signal
seen.length = 0;
const controller = new AbortController();
target.addEventListener("d", () => seen.push("d"), { signal: controller.signal });
target.dispatchEvent({ type: "d" });
controller.abort();
target.dispatchEvent({ type: "d" });
assert.deepEqual(seen, ["d"], "an aborted signal removes its listeners");
const already = new AbortController();
already.abort();
target.addEventListener("d", () => seen.push("late"), { signal: already.signal });
target.dispatchEvent({ type: "d" });
assert.deepEqual(seen, ["d"], "an already-aborted signal adds nothing");

// stopImmediatePropagation
seen.length = 0;
target.addEventListener("e", (event) => { seen.push(1); event.stopImmediatePropagation(); });
target.addEventListener("e", () => seen.push(2));
target.dispatchEvent(new Event("e"));
assert.deepEqual(seen, [1], "later listeners are skipped");

// a listener removed during dispatch by an earlier one is not called; one added during dispatch waits for the next
seen.length = 0;
const second = () => seen.push("second");
target.addEventListener("g", () => { seen.push("first"); target.removeEventListener("g", second); target.addEventListener("g", () => seen.push("added")); });
target.addEventListener("g", second);
target.dispatchEvent({ type: "g" });
assert.deepEqual(seen, ["first"]);

// a throwing listener does not stop the others
seen.length = 0;
const quiet = console.error;
console.error = () => {};
target.addEventListener("h", () => { throw new Error("boom"); });
target.addEventListener("h", () => seen.push("after"));
target.dispatchEvent({ type: "h" });
console.error = quiet;
assert.deepEqual(seen, ["after"]);

console.log("event-target tests: all passed");
