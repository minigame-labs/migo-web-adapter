// IntersectionObserver (Intersection Observer, W3C): whether an element is in the viewport, reported when it is observed
// and each time it crosses one of the observer's thresholds. winit -- the window layer of Bevy and every Rust game engine
// on the web -- watches its canvas with one to know when the game is hidden, and panicked where there was none.
//
// The intersection is computed in the frame's rendering step, after the resize observations (display.js runs both), from
// each element's layout box (getBoundingClientRect) against the viewport (the window's inner size, grown or shrunk by the
// observer's rootMargin). An element out of the document, or not displayed, is not intersecting. An observation starts
// from "no threshold crossed yet", so the first step after observe() always reports it; the records are delivered to the
// callback in a task, as the specification queues them, and takeRecords() takes those not yet delivered.
import { reportException } from "./report.js";
import { layoutBox } from "./layout.js";

const active = new Set();
let schedule = null;

function connected(target) {
  const doc = globalThis.document;
  if (!doc) return false;
  if (target === globalThis.canvas && !target.parentNode) return true;   // the screen is shown whether or not it is in the tree
  if (typeof doc.contains === "function") return doc.contains(target);
  return true;
}

function displayed(target) {
  for (let node = target; node; node = node.parentNode) {
    const style = node.style;
    if (style && (style.display === "none")) return false;
  }
  return true;
}

function rect(target) {
  try {
    return layoutBox(target);
  } catch (error) {
    reportException(error);
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

const domRect = ({ x, y, width, height }) => Object.freeze({
  x, y, width, height, left: x, top: y, right: x + width, bottom: y + height,
});

// rootMargin: one to four lengths in px or %, as CSS margin shorthand; a percentage is of the root's width or height.
function parseMargin(text) {
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) parts.push("0px");
  if (parts.length > 4) throw new SyntaxError("Failed to construct 'IntersectionObserver': Extra text found at the end of rootMargin.");
  const lengths = parts.map((p) => {
    const m = /^(-?\d*\.?\d+)(px|%)$/.exec(p) || (p === "0" ? ["0", "0", "px"] : null);
    if (!m) throw new SyntaxError("Failed to construct 'IntersectionObserver': rootMargin must be specified in pixels or percent.");
    return { value: Number(m[1]), unit: m[2] };
  });
  const [top, right = top, bottom = top, left = right] = lengths;
  return { top, right, bottom, left, text: [top, right, bottom, left].map((l) => `${l.value}${l.unit}`).join(" ") };
}

function thresholdsOf(value) {
  const list = value === undefined ? [0] : Array.isArray(value) ? value.map(Number) : [Number(value)];
  for (const t of list) {
    if (!(t >= 0 && t <= 1)) throw new RangeError("Failed to construct 'IntersectionObserver': Threshold values must be numbers between 0 and 1");
  }
  return Object.freeze([...list].sort((a, b) => a - b));
}

export class IntersectionObserverEntry {
  constructor(init) {
    for (const key of ["time", "rootBounds", "boundingClientRect", "intersectionRect", "isIntersecting", "intersectionRatio", "target"]) {
      Object.defineProperty(this, key, { value: init[key], enumerable: true });
    }
  }
}

export class IntersectionObserver {
  #callback;
  #margin;
  #thresholds;
  #observations = new Map();
  #records = [];
  #queued = false;

  constructor(callback, options = undefined) {
    if (typeof callback !== "function") {
      throw new TypeError("Failed to construct 'IntersectionObserver': The callback provided as parameter 1 is not a function.");
    }
    const opts = options === undefined || options === null ? {} : options;
    // No root, or the document, is the viewport; an element is its own box.
    this._root = opts.root === undefined ? null : opts.root;
    this.#callback = callback;
    this.#margin = parseMargin(opts.rootMargin === undefined ? "0px" : opts.rootMargin);
    this.#thresholds = thresholdsOf(opts.threshold);
  }

  get root() { return this._root; }
  get rootMargin() { return this.#margin.text; }
  get thresholds() { return this.#thresholds; }

  observe(target) {
    if (target === null || typeof target !== "object") {
      throw new TypeError("Failed to execute 'observe' on 'IntersectionObserver': parameter 1 is not of type 'Element'.");
    }
    if (this.#observations.has(target)) return;
    this.#observations.set(target, { index: -1, intersecting: false });
    active.add(this);
    if (schedule) schedule();
  }

  unobserve(target) {
    this.#observations.delete(target);
    if (this.#observations.size === 0) active.delete(this);
  }

  disconnect() {
    this.#observations.clear();
    active.delete(this);
  }

  takeRecords() {
    const records = this.#records;
    this.#records = [];
    return records;
  }

  #rootBounds() {
    let box;
    if (this._root && this._root !== globalThis.document && typeof this._root.getBoundingClientRect === "function") box = rect(this._root);
    else box = { x: 0, y: 0, width: +globalThis.innerWidth || 0, height: +globalThis.innerHeight || 0 };
    const px = (l, basis) => (l.unit === "%" ? (l.value / 100) * basis : l.value);
    const m = this.#margin;
    const top = px(m.top, box.height), right = px(m.right, box.width), bottom = px(m.bottom, box.height), left = px(m.left, box.width);
    return { x: box.x - left, y: box.y - top, width: Math.max(0, box.width + left + right), height: Math.max(0, box.height + top + bottom) };
  }

  // The step's entries for this observer: every target whose threshold index or intersecting state changed.
  _update(time) {
    const root = this.#rootBounds();
    for (const [target, previous] of this.#observations) {
      const box = rect(target);
      const shown = connected(target) && displayed(target);
      const x0 = Math.max(box.x, root.x), y0 = Math.max(box.y, root.y);
      const x1 = Math.min(box.x + box.width, root.x + root.width), y1 = Math.min(box.y + box.height, root.y + root.height);
      // Intersecting covers edge-adjacent boxes and an element of no area inside the root, as the specification has it.
      const intersecting = shown && x1 >= x0 && y1 >= y0;
      const clipped = intersecting ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: 0, height: 0 };
      const area = box.width * box.height;
      const ratio = !intersecting ? 0 : area > 0 ? (clipped.width * clipped.height) / area : 1;
      let index = 0;
      while (index < this.#thresholds.length && ratio >= this.#thresholds[index]) index++;
      if (!intersecting) index = 0;
      if (index === previous.index && intersecting === previous.intersecting) continue;
      previous.index = index;
      previous.intersecting = intersecting;
      this.#records.push(new IntersectionObserverEntry({
        time, rootBounds: domRect(root), boundingClientRect: domRect(box), intersectionRect: domRect(clipped),
        isIntersecting: intersecting, intersectionRatio: ratio, target,
      }));
    }
    if (this.#records.length > 0 && !this.#queued) {
      this.#queued = true;
      setTimeout(() => this.#notify(), 0);
    }
  }

  #notify() {
    this.#queued = false;
    const records = this.takeRecords();
    if (records.length === 0) return;
    try {
      this.#callback.call(this, records, this);
    } catch (error) {
      reportException(error);
    }
  }
}

// The frame's intersection step: called after its resize observations (display.js).
export function updateIntersectionObservations(time) {
  if (active.size === 0) return;
  const now = typeof time === "number" ? time : (globalThis.performance ? globalThis.performance.now() : Date.now());
  for (const observer of [...active]) observer._update(now);
}

export function setIntersectionRenderingUpdate(request) {
  schedule = request;
}

export function requestIntersectionCheck() {
  if (active.size === 0) return;
  if (schedule) schedule();
  else setTimeout(() => updateIntersectionObservations(), 0);
}
