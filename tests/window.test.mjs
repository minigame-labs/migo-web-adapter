// Window (src/window.js): the global object's interface. `window instanceof Window` is how Excalibur's screen tells the
// window from an element, and it threw a ReferenceError where there was no Window.
import assert from "node:assert/strict";
import EventTarget from "../src/event-target.js";
import { Window, adoptWindowPrototype } from "../src/window.js";

assert.throws(() => new Window(), TypeError, "an interface, not a constructor");
assert.ok(globalThis instanceof Window, "the global object is the Window");
assert.ok(!({} instanceof Window));
assert.ok(Window.prototype instanceof EventTarget);

// A global object whose prototype is still Object.prototype becomes a Window as a browser's is.
const plain = Object.create(Object.prototype);
assert.equal(adoptWindowPrototype(plain), true);
assert.equal(Object.getPrototypeOf(plain), Window.prototype);
assert.ok(plain instanceof Window && plain instanceof EventTarget);
// One that inherits from something of the host's keeps it.
const hosts = { fromTheHost() { return 1; } };
const hosted = Object.create(hosts);
assert.equal(adoptWindowPrototype(hosted), false);
assert.equal(hosted.fromTheHost(), 1);
console.log("window: ok");
