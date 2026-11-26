// Where things are laid out, in CSS pixels of the window: what the composite (display.js) draws a canvas into, and what the
// observers (resize-observer.js, intersection-observer.js) measure. Its own module so the three need not import each other.

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

// An element's layout box, as the observers (resize-observer.js, intersection-observer.js) measure it: a canvas's is its
// CSS box -- `style.width` / `height` and its offsets as the composite places it, its own size when it has none -- which is
// what a browser lays out; any other element answers getBoundingClientRect(). A canvas's own getBoundingClientRect() is the
// runtime's, its drawing buffer at the origin, which is not the box a page sized with `width: 100%` asked for: winit sizes
// its canvas from the box a ResizeObserver reports, and kept Bevy at its default 1280 x 720 drawn onto a portrait screen.
export function layoutBox(element) {
  if (isCanvas(element)) {
    const innerWidth = +globalThis.innerWidth || element.width;
    const innerHeight = +globalThis.innerHeight || element.height;
    const box = boxOf(element, innerWidth, innerHeight);
    return { x: box.left, y: box.top, width: Math.max(0, box.width), height: Math.max(0, box.height) };
  }
  const r = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  if (!r) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: num(r.left !== undefined ? r.left : r.x),
    y: num(r.top !== undefined ? r.top : r.y),
    width: Math.max(0, num(r.width)),
    height: Math.max(0, num(r.height)),
  };
}

export const isCanvas = (node) => node !== null && typeof node === "object" && typeof node.getContext === "function"
  && typeof node.width === "number" && typeof node.height === "number";
