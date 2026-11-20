// What the window shows: the canvases in the document.
//
// A page shows every canvas it put in its document, laid out by CSS. Migo shows one canvas, the screen -- the first
// `migo.createCanvas()`, published as `globalThis.canvas`. document.js hands the screen to the first canvas an engine
// makes once the document is ready, and that canvas then draws straight into what the window shows (Phaser makes its
// canvas at DOMContentLoaded). An engine that makes its canvas earlier cannot be handed the screen: PixiJS v8 makes
// and initialises its renderer's canvas while its script loads -- WebGL context and all, before DOMContentLoaded --
// and then appends it to <body>. That canvas is offscreen, and the game drew into a buffer nothing showed.
//
// So at the end of every animation frame, when the document holds canvases and the screen is not one of them, the
// screen shows what the document's canvases show: each one, in document order, drawn into its CSS box (`boxOf`),
// through the screen's 2D context. A WebGL canvas is copied on the GPU for that (the runtime's drawImage copies an
// offscreen WebGL canvas's drawing buffer with a blit and keeps the copy until the context draws again), so the cost
// is a blit and a textured draw per frame, not a readback. A page whose canvas is the screen -- the canvas Phaser
// was handed, or an engine using `globalThis.canvas` -- composites nothing: the screen is already what it shows.
//
// "The end of every animation frame" is the end of the frame's `requestAnimationFrame` callbacks, which is where a
// browser composites. This module therefore runs a page's frame callbacks itself: one host frame request per frame,
// every callback registered for that frame called with its timestamp, in order, a callback registered during the
// frame running in the next one (as the HTML specification's "run the animation frame callbacks" takes the list at
// the start), then the composite. A game that draws from a timer and never asks for a frame is not composited until
// something does.

const CSS_LENGTH = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*(px|%|vw|vh)?\s*$/i;

/// A CSS length the adapter can resolve: px (or a bare number), %, vw, vh. `basis` is what 100% is. `null` for
/// anything else -- `auto`, `calc(...)`, an em -- which falls back to the default the caller gives.
function cssLength(value, basis, innerWidth, innerHeight) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = CSS_LENGTH.exec(String(value));
  if (!match) return null;
  const n = Number(match[1]);
  switch ((match[2] || "px").toLowerCase()) {
    case "%": return (n / 100) * basis;
    case "vw": return (n / 100) * innerWidth;
    case "vh": return (n / 100) * innerHeight;
    default: return n;
  }
}

/// Where `canvas` is laid out, in CSS pixels of the window: its `style` width and height when they are set, else its
/// own width and height (a canvas's intrinsic size is its backing size in CSS pixels), at its `left` / `top` plus its
/// margins. The positioned, block-level box an engine gives its game canvas; nothing of a stylesheet, which the
/// adapter does not read.
export function boxOf(canvas, innerWidth, innerHeight) {
  const style = canvas.style || {};
  const length = (value, basis) => cssLength(value, basis, innerWidth, innerHeight);
  const width = length(style.width, innerWidth) ?? canvas.width;
  const height = length(style.height, innerHeight) ?? canvas.height;
  const left = (length(style.left, innerWidth) ?? 0) + (length(style.marginLeft, innerWidth) ?? 0);
  const top = (length(style.top, innerHeight) ?? 0) + (length(style.marginTop, innerWidth) ?? 0);
  return { left, top, width, height };
}

const isCanvas = (node) => node !== null && typeof node === "object" && typeof node.getContext === "function"
  && typeof node.width === "number" && typeof node.height === "number";

function hidden(node) {
  const style = node.style;
  if (!style) return false;
  return style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || style.opacity === 0;
}

/// The canvases `root` shows, in document order: every canvas under it, leaving out a subtree that is not displayed
/// (`display: none` on it or an ancestor) and a canvas that is not visible.
export function shownCanvases(root) {
  const shown = [];
  const visit = (node, depth) => {
    if (!node || depth > 64 || hidden(node)) return;
    if (isCanvas(node)) {
      shown.push(node);
      return;
    }
    const children = node.children;
    if (children && typeof children.length === "number") {
      for (let i = 0; i < children.length; i++) visit(children[i], depth + 1);
    }
  };
  visit(root, 0);
  return shown;
}

function opacityOf(canvas) {
  const value = canvas.style && canvas.style.opacity;
  if (value === undefined || value === null || value === "") return 1;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function report(error) {
  if (typeof globalThis.reportError === "function") globalThis.reportError(error);
  else setTimeout(() => { throw error; }, 0);
}

/// Install the frame-callback runner and the composite. `win` is the global the page sees; `document` the adapter's.
export function installDisplay(win, document) {
  const hostRequest = win.requestAnimationFrame;
  const hostCancel = win.cancelAnimationFrame;
  if (typeof hostRequest !== "function") return null;

  let callbacks = new Map();
  // The frame's own list while its callbacks run: one cancelled by an earlier callback of the same frame is not called.
  let running = null;
  let nextId = 1;
  let pending = null;
  let screenContext = null;

  const composite = () => {
    const screen = win.canvas;
    if (!screen || !document.documentElement) return;
    const shown = shownCanvases(document.documentElement);
    if (shown.length === 0 || shown.includes(screen)) return;
    if (!screenContext) {
      // The screen is the page's only if nothing claimed it; one an engine draws into with WebGL is its own.
      if (screen._context && screen._contextKind !== "2d") return;
      screenContext = screen.getContext("2d");
      if (!screenContext) return;
      document._mainCanvasRouted = true;
    }
    const ctx = screenContext;
    const innerWidth = win.innerWidth || screen.width;
    const innerHeight = win.innerHeight || screen.height;
    const sx = screen.width / innerWidth;
    const sy = screen.height / innerHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, screen.width, screen.height);
    const background = document.body && document.body.style && document.body.style.backgroundColor;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, screen.width, screen.height);
    }
    for (const canvas of shown) {
      if (canvas.width === 0 || canvas.height === 0) continue;
      const box = boxOf(canvas, innerWidth, innerHeight);
      if (!(box.width > 0 && box.height > 0)) continue;
      ctx.globalAlpha = opacityOf(canvas);
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, box.left * sx, box.top * sy, box.width * sx, box.height * sy);
    }
    ctx.globalAlpha = 1;
  };

  const runFrame = (time) => {
    pending = null;
    const due = callbacks;
    callbacks = new Map();
    running = due;
    for (const callback of due.values()) {
      try {
        callback(time);
      } catch (error) {
        report(error);
      }
    }
    running = null;
    try {
      composite();
    } catch (error) {
      report(error);
    }
  };

  win.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Failed to execute 'requestAnimationFrame' on 'Window': parameter 1 is not of type 'Function'.");
    }
    const id = nextId++;
    callbacks.set(id, callback);
    if (pending === null) pending = hostRequest.call(win, runFrame);
    return id;
  };
  win.cancelAnimationFrame = function cancelAnimationFrame(id) {
    callbacks.delete(id);
    if (running !== null) running.delete(id);
    if (callbacks.size === 0 && pending !== null && typeof hostCancel === "function") {
      hostCancel.call(win, pending);
      pending = null;
    }
  };
  return { composite };
}
