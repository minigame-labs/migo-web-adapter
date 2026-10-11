// W3C Gamepad API surface, tested against the REAL runtime transport.
//
// input/04_gamepad.js is dependency-free ESM (bar the input clock beside it), so this imports it directly
// instead of faking it. That matters: the properties under test here -- null
// slots, frozen views, object identity -- are the runtime's to provide, and a
// hand-written fake would happily agree with a broken adapter about all three.
// Importing the real module means this test fails if either side drifts.
//
// This adapter lives in its own repo, separate from the engine, so "import it
// directly" means fetching it from minigame-labs/migo at test time rather
// than a relative path within a shared tree. MIGO_GAMEPAD_REF picks the ref
// (default: master); failing closed on a fetch error is the point, the same
// way migo-examples' own namespace contract test does -- a skipped check here
// is exactly how a real drift would go unnoticed.
//
// Run with `node tests/gamepad.test.mjs` from this dir or via npm test.

import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REF = process.env.MIGO_GAMEPAD_REF || "master";
const BASE_URL = `https://raw.githubusercontent.com/minigame-labs/migo-runtime/${REF}/engine/crates/runtime-v8/src/`;

// MIGO_RUNTIME_DIR names a checkout of migo-runtime to read the files from instead of fetching them (offline, or a
// change to the engine's input code that is not on master yet). `path` is relative to the runtime's JS source root.
async function fetchSource(path) {
  if (process.env.MIGO_RUNTIME_DIR) {
    const { readFile } = await import("node:fs/promises");
    return readFile(join(process.env.MIGO_RUNTIME_DIR, "engine/crates/runtime-v8/src", path), "utf8");
  }
  const url = BASE_URL + path;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`could not fetch the real gamepad transport source for ref '${REF}' from ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

// 04_gamepad.js imports a few engine modules by `ext:` specifiers only the runtime's module loader resolves. Each is
// mapped here by name, and any other `ext:` import is the drift this test exists to notice, so it is refused:
//   - the input clock and the DOMException helper are dependency-free: the real files, fetched beside it;
//   - the timers and the visibility observer are the engine's own scheduling, stood in for by the host's timers and a
//     visibility switch this test flips;
//   - `ext:core/ops` is the native op table: the one op the transport calls, recording what the motors were told.
const tmpDir = await mkdtemp(join(tmpdir(), "migo-gamepad-test-"));
const realModules = {
  "ext:host_v8_touch/00_input_clock.js": ["00_input_clock.js", "input/00_input_clock.js"],
  "ext:host_v8_base/06_dom_exception.js": ["06_dom_exception.js", "base/06_dom_exception.js"],
};
const standIns = {
  "ext:host_v8_web/02_timers.js": ["timers.js",
    "export const setTimeout = globalThis.setTimeout;\nexport const clearTimeout = globalThis.clearTimeout;\n"],
  "ext:host_v8_lifecycle/01_lifecycle.js": ["lifecycle.js",
    "export const observers = [];\nexport function _internalObserveVisibility(observer) { observers.push(observer); }\n"],
  "ext:core/ops": ["ops.js",
    "export const rumbles = [];\nexport function op_gamepad_rumble(...args) { rumbles.push(args); }\n"],
};
let gamepadSource = await fetchSource("input/04_gamepad.js");
for (const [specifier, [file, path]] of Object.entries(realModules)) {
  const source = await fetchSource(path);
  if (/from\s+["']ext:/.test(source)) {
    throw new Error(`${path} now imports an engine module, so it can no longer be used as fetched; teach this test how`);
  }
  await writeFile(join(tmpDir, file), source, "utf8");
  gamepadSource = gamepadSource.split(specifier).join(`./${file}`);
}
for (const [specifier, [file, source]] of Object.entries(standIns)) {
  await writeFile(join(tmpDir, file), source, "utf8");
  gamepadSource = gamepadSource.split(specifier).join(`./${file}`);
}
const otherExt = [...gamepadSource.matchAll(/from\s+["'](ext:[^"']+)["']/g)].map((m) => m[1]);
if (otherExt.length) {
  throw new Error(`04_gamepad.js imports ${otherExt.join(", ")}, which this test cannot resolve; teach it how, rather than skipping the check`);
}
await writeFile(join(tmpDir, "04_gamepad.js"), gamepadSource, "utf8");
const runtime = await import(`file://${join(tmpDir, "04_gamepad.js")}`);
const ops = await import(`file://${join(tmpDir, "ops.js")}`);
await rm(tmpDir, { recursive: true, force: true });

// ---- Fake migo carrying the real gamepad transport ------------------------
// Only the public `migo` names are wired. The `_internalTrigger*` functions are
// driven directly from `runtime` below, standing in for the native host, so
// this test also demonstrates the adapter never needs them.
globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "zh-CN", version: "1.2.3" }),
  createCanvas: () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:," }),
  createImage: () => ({ src: null, onload: null, onerror: null, width: 0, height: 0 }),

  getGamepads: runtime.getGamepads,
  onGamepadConnected: runtime.onGamepadConnected,
  offGamepadConnected: runtime.offGamepadConnected,
  onGamepadDisconnected: runtime.onGamepadDisconnected,
  offGamepadDisconnected: runtime.offGamepadDisconnected,
};

await import("../src/index.js");

const { navigator, GamepadEvent, Event } = globalThis;

// Capture console.error so the deliberate throws below do not look like real
// failures in the output, and so isolation can be asserted rather than assumed.
const _errors = [];
const _realError = console.error;
console.error = (...args) => { _errors.push(args.join(" ")); };

// ---- 1. No pads connected yet ---------------------------------------------
assert.equal(typeof navigator.getGamepads, "function", "navigator.getGamepads exists");
assert.deepEqual([...navigator.getGamepads()], [], "no pads before any connect");

// ---- 2. Connection fires a GamepadEvent on window -------------------------
const connectEvents = [];
globalThis.addEventListener("gamepadconnected", (e) => connectEvents.push(e));

// Connect at index 2, skipping 0 and 1, to pin the sparse-slot rule below.
runtime._internalTriggerGamepadConnected(2, "Test Pad", "standard", 4, 8);

assert.equal(connectEvents.length, 1, "one gamepadconnected event");
const connectEvent = connectEvents[0];
assert.ok(connectEvent instanceof GamepadEvent, "event is a GamepadEvent");
assert.ok(connectEvent instanceof Event, "GamepadEvent extends Event");
assert.equal(connectEvent.type, "gamepadconnected");

// ---- 3. Empty slots are explicit nulls, not holes -------------------------
// Content stores an index, so a missing pad must read as null rather than
// shifting later pads down or exposing an array hole as undefined.
const pads = navigator.getGamepads();
assert.equal(pads.length, 3, "array is long enough to index the connected pad");
assert.equal(pads[0], null, "slot 0 is an explicit null");
assert.equal(pads[1], null, "slot 1 is an explicit null");
assert.ok(pads[2], "slot 2 holds the pad");
assert.ok(!(0 in pads) === false, "slot 0 is a real element, not a hole");
assert.equal(pads[2].index, 2, "pad reports the index it lives at");
assert.equal(pads[2].id, "Test Pad");
assert.equal(pads[2].mapping, "standard");

// ---- 4. Object identity ----------------------------------------------------
// Content compares the pad it stored last frame against this frame's. Wrapping
// or copying in the adapter would break that comparison silently.
assert.equal(connectEvent.gamepad, pads[2], "event pad is the same object getGamepads returns");
assert.equal(navigator.getGamepads()[2], pads[2], "pad identity is stable across calls");
assert.notEqual(navigator.getGamepads(), pads, "each call returns a fresh array, per spec");

// ---- 5. Button and axis counts are known at connection --------------------
// Content commonly reads buttons.length inside its gamepadconnected listener to
// decide a control layout, so the arrays must already be the right size there.
assert.equal(connectEvent.gamepad.axes.length, 4, "axis count known at connect");
assert.equal(connectEvent.gamepad.buttons.length, 8, "button count known at connect");

// ---- 6. The view is frozen -------------------------------------------------
const pad = pads[2];
assert.ok(Object.isFrozen(pad), "gamepad view is frozen");
assert.ok(Object.isFrozen(pad.axes), "axes array is frozen");
assert.ok(Object.isFrozen(pad.buttons), "buttons array is frozen");
assert.ok(Object.isFrozen(pad.buttons[0]), "each button is frozen");
assert.throws(() => { pad.id = "hacked"; }, TypeError, "cannot overwrite pad fields");
assert.throws(() => { pad.axes[0] = 1; }, TypeError, "cannot overwrite an axis");

// ---- 7. Live state still updates through the frozen view -------------------
// Frozen means the shape is fixed, not that the values are. `pressed` is
// carried, never derived from `value`: the device decides its own threshold.
runtime._internalTriggerGamepadState(2, 1234, [4, 8, 0.5, 0, 0, 0,
  1, 1, 1.0,   // button 0: pressed
  0, 0, 0.25,  // button 1: NOT pressed despite a non-zero value
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
assert.equal(pad.axes[0], 0.5, "axis value updates through the frozen view");
// The host's stamp is on the host's clock, which the C ABI does not name; the engine hands content the page's
// (`performance.now()`'s), never in the future, so the test says that rather than echoing the host's number.
assert.ok(Number.isFinite(pad.timestamp) && pad.timestamp > 0 && pad.timestamp <= performance.now(), "timestamp updates, on the page clock");
const firstStamp = pad.timestamp;
runtime._internalTriggerGamepadState(2, 1234 + 16, [4, 8, 0.5, 0, 0, 0,
  1, 1, 1.0,
  0, 0, 0.25,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
assert.ok(pad.timestamp >= firstStamp && pad.timestamp <= performance.now(), "a later sample is not earlier, and is not in the future");
assert.equal(pad.buttons[0].pressed, true, "digital press reported");
assert.equal(pad.buttons[1].pressed, false, "a non-zero value is not itself a press");
assert.equal(pad.buttons[1].value, 0.25, "analogue value preserved");

// ---- 8. Listener mutation during dispatch ---------------------------------
// A listener removed from inside an earlier listener is not called (the DOM Standard skips a listener whose "removed" flag is
// set), and removing it must not make the loop skip the listener after it.
const order = [];
const second = () => order.push("second");
const third = () => order.push("third");
const first = () => {
  order.push("first");
  globalThis.removeEventListener("gamepadconnected", second);
};
globalThis.addEventListener("gamepadconnected", first);
globalThis.addEventListener("gamepadconnected", second);
globalThis.addEventListener("gamepadconnected", third);
runtime._internalTriggerGamepadConnected(0, "Second Pad", "standard", 2, 4);
assert.deepEqual(order, ["first", "third"], "a listener removed mid-dispatch is not called, and the one after it still is");
globalThis.removeEventListener("gamepadconnected", first);
globalThis.removeEventListener("gamepadconnected", third);

// The pad that just connected fills the previously-null slot 0.
assert.equal(navigator.getGamepads()[0].id, "Second Pad", "slot 0 now holds a pad");

// ---- 9. Exception isolation ------------------------------------------------
const survived = [];
const thrower = () => { throw new Error("listener blew up"); };
const survivor = () => survived.push("ran");
globalThis.addEventListener("gamepaddisconnected", thrower);
globalThis.addEventListener("gamepaddisconnected", survivor);

// ---- 10. Disconnect --------------------------------------------------------
const disconnectEvents = [];
globalThis.addEventListener("gamepaddisconnected", (e) => disconnectEvents.push(e));
runtime._internalTriggerGamepadDisconnected(2);

assert.deepEqual(survived, ["ran"], "a throwing listener does not stop the others");
assert.ok(_errors.length > 0, "the failure was reported rather than swallowed");
assert.equal(disconnectEvents.length, 1, "one gamepaddisconnected event");
assert.equal(disconnectEvents[0].type, "gamepaddisconnected");
assert.equal(disconnectEvents[0].gamepad, pad, "disconnect carries the pad that left");
assert.equal(pad.connected, false, "the departed pad reports disconnected");
assert.equal(navigator.getGamepads()[2], null, "its slot is emptied, not removed");
assert.equal(navigator.getGamepads().length, 3, "later indices are not shifted down");

// ---- 11. The runtime transport stays private -------------------------------
// The adapter maps `migo.*` to Web names; it must not republish the native
// pump hooks, which content has no business calling.
for (const hidden of [
  "_internalTriggerGamepadConnected",
  "_internalTriggerGamepadDisconnected",
  "_internalTriggerGamepadState",
  "onGamepadConnected",
  "offGamepadConnected",
]) {
  assert.equal(globalThis[hidden], undefined, `${hidden} is not on globalThis`);
  assert.equal(navigator[hidden], undefined, `${hidden} is not on navigator`);
}

// ---- 12. A broken diagnostic sink cannot break dispatch -------------------
// Embedders may replace console.error. EventTarget's listener isolation must
// remain true even when that replacement itself throws.
globalThis.removeEventListener("gamepaddisconnected", thrower);
globalThis.removeEventListener("gamepaddisconnected", survivor);
const survivedBrokenLogger = [];
const loggerThrower = () => { throw new Error("listener still fails"); };
const afterBrokenLogger = () => survivedBrokenLogger.push("ran");
globalThis.addEventListener("gamepaddisconnected", loggerThrower);
globalThis.addEventListener("gamepaddisconnected", afterBrokenLogger);
const _capturingError = console.error;
console.error = () => { throw new Error("diagnostic sink failed"); };
try {
  assert.doesNotThrow(
    () => runtime._internalTriggerGamepadDisconnected(0),
    "a throwing diagnostic sink does not escape dispatch",
  );
} finally {
  console.error = _capturingError;
}
assert.deepEqual(
  survivedBrokenLogger,
  ["ran"],
  "later listeners still run when reporting an earlier failure also throws",
);
globalThis.removeEventListener("gamepaddisconnected", loggerThrower);
globalThis.removeEventListener("gamepaddisconnected", afterBrokenLogger);

// ---- 13. Haptics pass through ----------------------------------------------
// The pad navigator.getGamepads() returns is the runtime's, so its vibrationActuator is the runtime's too: the
// engine times the effect and settles the promise, and the adapter adds nothing in between.
runtime._internalTriggerGamepadConnected(1, "Rumble Pad", "standard", 4, 17, 1);
const rumblePad = navigator.getGamepads()[1];
assert.deepEqual([...rumblePad.vibrationActuator.effects], ["dual-rumble"], "the effects the host declared");
assert.equal(rumblePad.vibrationActuator, runtime.getGamepads()[1].vibrationActuator, "the runtime's own actuator");
const played = await rumblePad.vibrationActuator.playEffect("dual-rumble",
  { duration: 10, strongMagnitude: 1, weakMagnitude: 0.5 });
assert.equal(played, "complete", "an effect that ran its time completes");
assert.deepEqual(ops.rumbles, [[1, 1, 0.5, 0, 0, 10]], "the motors were told once, magnitudes and duration");
await assert.rejects(rumblePad.vibrationActuator.playEffect("trigger-rumble", { duration: 10 }),
  (e) => e.name === "NotSupportedError", "an effect the pad does not play is refused");

console.error = _realError;
console.log("ALL GAMEPAD ASSERTIONS PASSED (13 sections)");
