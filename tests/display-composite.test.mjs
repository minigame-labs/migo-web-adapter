// What the window shows is the canvases in the document (src/display.js).
//
// PixiJS v8's shape: the renderer's canvas is made -- and given its WebGL context -- while the script loads, before
// DOMContentLoaded, so document.js cannot hand it the screen; the game then appends it to <body> and sizes it with
// `style.width` / `style.height` in CSS pixels. At the end of each animation frame the screen shows it, drawn into its
// CSS box. A page whose canvas is the screen composites nothing, and the frame callbacks keep a browser's contract.

import assert from "node:assert/strict";

const made = [];
const frames = [];
const draws = [];
const hostCancelled = [];
let hostIds = 0;

function hostCanvas() {
  const canvas = {
    n: made.length, width: 0, height: 0, style: {},
    getContext(kind) {
      if (this._context) return this._contextKind === kind ? this._context : null;
      this._contextKind = kind;
      this._context = kind === "2d" ? recordingContext(this) : { kind };
      return this._context;
    },
    toDataURL: () => "data:,",
  };
  made.push(canvas);
  return canvas;
}

function recordingContext(canvas) {
  return {
    canvas,
    globalAlpha: 1,
    setTransform() {},
    clearRect(x, y, w, h) { draws.push(["clear", x, y, w, h]); },
    fillRect(x, y, w, h) { draws.push(["fill", this.fillStyle, x, y, w, h]); },
    drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
      draws.push(["draw", source.n, sx, sy, sw, sh, dx, dy, dw, dh, this.globalAlpha]);
    },
  };
}

globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: hostCanvas,
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
};
// The runtime's own frame request: one host frame per call.
globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return ++hostIds; };
globalThis.cancelAnimationFrame = (id) => { hostCancelled.push(id); };
const runHostFrame = (time) => {
  const due = frames.splice(0);
  for (const callback of due) callback(time);
  return due.length;
};

await import("../src/index.js");
const { document } = globalThis;
const screen = globalThis.canvas;
screen.width = 1170; screen.height = 2532;   // 390 x 844 CSS pixels at 3x

// ---- frame callbacks ------------------------------------------------------------------------------------------------
{
  const order = [];
  const a = requestAnimationFrame((t) => order.push(["a", t]));
  requestAnimationFrame((t) => {
    order.push(["b", t]);
    cancelAnimationFrame(c);                                 // a later callback of this frame, cancelled by an earlier one
    requestAnimationFrame((t2) => order.push(["next", t2])); // registered during the frame: the next frame
  });
  const c = requestAnimationFrame(() => order.push(["c"]));
  assert.equal(typeof a, "number");
  assert.equal(frames.length, 1, "one host frame request for every callback of the frame");
  runHostFrame(16);
  assert.deepEqual(order, [["a", 16], ["b", 16]], "in order, with the frame's time; a cancelled one is not called");
  runHostFrame(32);
  assert.deepEqual(order.at(-1), ["next", 32]);
  assert.throws(() => requestAnimationFrame(null), TypeError);

  // An exception in one callback does not stop the next.
  const reported = [];
  globalThis.reportError = (error) => reported.push(error.message);
  const after = [];
  requestAnimationFrame(() => { throw new Error("boom"); });
  requestAnimationFrame(() => after.push("ran"));
  runHostFrame(48);
  assert.deepEqual(after, ["ran"]);
  assert.deepEqual(reported, ["boom"]);

  // Cancelling the only callback gives the host frame back.
  const only = requestAnimationFrame(() => assert.fail("cancelled"));
  cancelAnimationFrame(only);
  assert.equal(hostCancelled.length, 1);
  frames.length = 0;
}

// ---- nothing in the document: nothing composited, the screen left alone ----------------------------------------------
requestAnimationFrame(() => {});
runHostFrame(64);
assert.equal(draws.length, 0, "no canvas in the document: nothing drawn");
assert.equal(screen._context, undefined, "and the screen not claimed");

// ---- PixiJS v8: an early canvas, appended and sized in CSS pixels ---------------------------------------------------
const view = document.createElement("canvas");             // before DOMContentLoaded: offscreen
assert.notEqual(view, screen);
view.getContext("webgl2");
view.width = 780; view.height = 1688;                       // resolution 2
view.style.width = "390px"; view.style.height = "844px";
document.body.appendChild(view);

requestAnimationFrame(() => draws.push(["game frame"]));
runHostFrame(80);
assert.deepEqual(draws[0], ["game frame"], "the game draws first");
assert.deepEqual(draws[1], ["clear", 0, 0, 1170, 2532]);
assert.deepEqual(draws[2], ["draw", view.n, 0, 0, 780, 1688, 0, 0, 1170, 2532, 1],
  "then the screen shows it in its CSS box, in screen pixels");
assert.equal(screen._contextKind, "2d", "the screen is the page's: a 2D context composites into it");

// A later canvas is not handed the screen the page now composites into.
await new Promise((resolve) => setTimeout(resolve, 20));     // DOMContentLoaded has fired
assert.notEqual(document.createElement("canvas"), screen);

// ---- layout: margins, percentages, opacity, a hidden canvas, document order -----------------------------------------
draws.length = 0;
const hud = hostCanvas(); hud.width = 100; hud.height = 50;  // `new Canvas()`-made, intrinsic size: its own pixels
hud.style.marginLeft = "10px"; hud.style.top = "5%"; hud.style.opacity = "0.5";
document.body.appendChild(hud);
const gone = hostCanvas(); gone.width = 10; gone.height = 10; gone.style.display = "none";
document.body.appendChild(gone);
const wrapper = document.createElement("div"); wrapper.style.display = "none";
const insideHidden = hostCanvas(); insideHidden.width = 10; insideHidden.height = 10;
wrapper.appendChild(insideHidden);
document.body.appendChild(wrapper);
document.body.style.backgroundColor = "#123456";
requestAnimationFrame(() => {});
runHostFrame(96);
assert.deepEqual(draws.map((d) => d[0]), ["clear", "fill", "draw", "draw"], "the hidden ones are not drawn");
assert.deepEqual(draws[1], ["fill", "#123456", 0, 0, 1170, 2532], "the page's background under its canvases");
assert.equal(draws[2][1], view.n, "document order: the game canvas first");
assert.deepEqual(draws[3], ["draw", hud.n, 0, 0, 100, 50, 30, 0.05 * 844 * 3, 300, 150, 0.5],
  "a canvas without a CSS size is its own size in CSS pixels, at its margin and top");
document.body.style.backgroundColor = "";

// ---- removed: nothing more to show ----------------------------------------------------------------------------------
draws.length = 0;
view.parentNode.removeChild(view);
hud.parentNode.removeChild(hud);
requestAnimationFrame(() => {});
runHostFrame(112);
assert.equal(draws.length, 0, "with no canvas shown, the screen keeps its last picture");

console.log("display-composite tests: all passed");
