// screen.orientation is a ScreenOrientation (src/screen-orientation.js): an EventTarget whose type follows the window,
// with a change event when it turns, and a lock() the platform cannot honour. It was a plain { angle, type }, and a Unity
// build's start-up threw on its addEventListener.
import assert from "node:assert/strict";
import EventTarget from "../src/event-target.js";

let size = { windowWidth: 400, windowHeight: 800 };
globalThis.migo = { getWindowInfo: () => size, getSystemInfoSync: () => ({ platform: "android" }) };
const windowTarget = new EventTarget();
globalThis.addEventListener = windowTarget.addEventListener.bind(windowTarget);
const { ScreenOrientation } = await import("../src/screen-orientation.js");

const orientation = new ScreenOrientation();
assert.ok(orientation instanceof EventTarget);
assert.equal(orientation.type, "portrait-primary");
assert.equal(orientation.angle, 0, "a phone's natural orientation is portrait");
const seen = [];
orientation.addEventListener("change", () => seen.push("listener " + orientation.type));
orientation.onchange = () => seen.push("handler " + orientation.angle);
size = { windowWidth: 800, windowHeight: 400 };
windowTarget.dispatchEvent({ type: "resize" });
assert.deepEqual(seen, ["handler 90", "listener landscape-primary"]);
windowTarget.dispatchEvent({ type: "resize" });
assert.equal(seen.length, 2, "a resize that does not turn it is no change");

await assert.rejects(orientation.lock("landscape"), (e) => e.name === "NotSupportedError");
await assert.rejects(orientation.lock("sideways"), TypeError);
assert.equal(orientation.unlock(), undefined);

// On a desktop the natural orientation is landscape.
globalThis.migo.getSystemInfoSync = () => ({ platform: "windows" });
assert.equal(new ScreenOrientation().angle, 0);
console.log("screen-orientation: ok");
