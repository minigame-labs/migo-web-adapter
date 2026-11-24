// window.matchMedia and MediaQueryList against the game's window; Node.parentElement.

import assert from "node:assert/strict";

globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => ({ width: 0, height: 0, style: {}, getContext: () => ({}), toDataURL: () => "data:," }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};
delete globalThis.matchMedia;
await import("../src/index.js");
const win = globalThis;
assert.equal(typeof win.matchMedia, "function");
assert.equal(win.innerWidth, 390, "CSS pixels");

const cases = [
  ["(resolution: 3dppx)", true], // Defold's loader asks exactly this, with the window's devicePixelRatio
  ["(resolution: 2dppx)", false],
  ["(min-resolution: 192dpi)", true],
  ["(-webkit-min-device-pixel-ratio: 2)", true],
  ["(orientation: portrait)", true],
  ["not (orientation: landscape)", true],
  ["(min-width: 300px) and (max-width: 400px)", true],
  ["(width >= 400px)", false],
  ["(300px < width <= 390px)", true],
  ["(max-width: 24em)", false],
  ["screen and (max-width: 500px)", true],
  ["only screen and (hover: none)", true],
  ["print", false],
  ["not print", true],
  ["print, (orientation: portrait)", true],
  ["(pointer: coarse) or (hover: hover)", true],
  ["(hover)", false],
  ["(color)", true],
  ["(color-gamut: srgb)", true],
  ["(color-gamut: p3)", false],
  ["(prefers-color-scheme: dark)", false],
  ["(prefers-reduced-motion: no-preference)", true],
  ["(aspect-ratio: 390/844)", true],
  ["", true],
];
for (const [query, want] of cases) {
  assert.equal(win.matchMedia(query).matches, want, query);
}
assert.equal(win.matchMedia("(foo: bar)").matches, false, "an unknown feature matches nothing");
assert.equal(win.matchMedia("(foo: bar)").media, "not all", "and serializes as not all");
assert.equal(win.matchMedia("((").matches, false, "nor does a query that does not parse");
assert.equal(win.matchMedia("print, (foo: 1)").media, "print, not all", "each query of a list on its own");
assert.equal(win.matchMedia("screen   and  (max-width: 500px)").media, "screen and (max-width: 500px)");
assert.throws(() => win.matchMedia(), TypeError);
assert.ok(win.matchMedia("all") instanceof win.MediaQueryList);

// A resize that flips the answer fires change, through onchange, addEventListener and the legacy addListener alike.
const portrait = win.matchMedia("(orientation: portrait)");
const seen = [];
portrait.onchange = (event) => seen.push(["onchange", event.matches, event.media]);
portrait.addEventListener("change", (event) => seen.push(["listener", event.matches]));
const legacy = (event) => seen.push(["legacy", event.matches]);
portrait.addListener(legacy);
const wide = win.matchMedia("(min-width: 600px)");
let wideChanges = 0;
wide.addEventListener("change", () => wideChanges++);

win.innerWidth = 844;
win.innerHeight = 390;
win.dispatchEvent({ type: "resize" });
assert.equal(portrait.matches, false, "matches is read live");
assert.deepEqual(seen, [["onchange", false, "(orientation: portrait)"], ["listener", false], ["legacy", false]]);
assert.equal(wideChanges, 1);

win.dispatchEvent({ type: "resize" });
assert.equal(seen.length, 3, "a resize that does not flip the answer fires nothing");

portrait.removeListener(legacy);
win.innerWidth = 390;
win.innerHeight = 844;
win.dispatchEvent({ type: "resize" });
assert.deepEqual(seen.slice(3), [["onchange", true, "(orientation: portrait)"], ["listener", true]], "removeListener took the legacy one off");

// Node.parentElement: the parent when it is an element.
const { document } = win;
const outer = document.createElement("div");
const inner = document.createElement("span");
outer.appendChild(inner);
assert.equal(inner.parentElement, outer);
assert.equal(outer.parentElement, null, "detached");
document.body.appendChild(outer);
assert.equal(outer.parentElement, document.body);
inner.parentElement.removeChild(inner);
assert.equal(inner.parentElement, null);

console.log("match-media: ok");
