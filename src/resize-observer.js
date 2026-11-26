// ResizeObserver (Resize Observer, W3C): an observer is told an element's size when it is observed and each time the size
// changes, after the frame's animation callbacks -- the step of "update the rendering" where a browser delivers them,
// before the frame is painted. Kaplay sizes its view from one on its canvas and Excalibur's screen watches its parent with
// one; neither existed here, and both threw while starting.
//
// An element's size is its layout box as this document lays it out: getBoundingClientRect, which every element and canvas
// here answers (no padding or border is modelled, so the content box is the border box). An observation starts from a
// reported size of 0 x 0, as the specification's does, so an element with a size is reported at the next frame and one
// without is reported when it gets one. Deliveries are one pass a frame: a size a callback changes is reported at the next.
import { reportException } from "./report.js";

const BOXES = ["content-box", "border-box", "device-pixel-content-box"];
const active = new Set();
let schedule = null;

function sizeOf(target) {
  let rect = null;
  try {
    rect = typeof target.getBoundingClientRect === "function" ? target.getBoundingClientRect() : null;
  } catch (error) {
    reportException(error);
  }
  const width = rect && Number.isFinite(+rect.width) ? Math.max(0, +rect.width) : 0;
  const height = rect && Number.isFinite(+rect.height) ? Math.max(0, +rect.height) : 0;
  return { width, height };
}

const ratio = () => {
  const r = +globalThis.devicePixelRatio;
  return Number.isFinite(r) && r > 0 ? r : 1;
};

function reported(box, size) {
  if (box === "device-pixel-content-box") {
    const r = ratio();
    return [Math.round(size.width * r), Math.round(size.height * r)];
  }
  return [size.width, size.height];
}

export class ResizeObserverSize {
  constructor(inlineSize, blockSize) {
    Object.defineProperties(this, {
      inlineSize: { value: inlineSize, enumerable: true },
      blockSize: { value: blockSize, enumerable: true },
    });
  }
}

export class ResizeObserverEntry {
  constructor(target, size) {
    const box = [new ResizeObserverSize(size.width, size.height)];
    const r = ratio();
    const device = [new ResizeObserverSize(Math.round(size.width * r), Math.round(size.height * r))];
    const contentRect = Object.freeze({
      x: 0, y: 0, width: size.width, height: size.height, top: 0, left: 0, right: size.width, bottom: size.height,
    });
    Object.defineProperties(this, {
      target: { value: target, enumerable: true },
      contentRect: { value: contentRect, enumerable: true },
      contentBoxSize: { value: Object.freeze(box), enumerable: true },
      borderBoxSize: { value: Object.freeze(box.slice()), enumerable: true },
      devicePixelContentBoxSize: { value: Object.freeze(device), enumerable: true },
    });
  }
}

export class ResizeObserver {
  #callback;
  #observations = new Map();

  constructor(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Failed to construct 'ResizeObserver': parameter 1 is not of type 'Function'.");
    }
    this.#callback = callback;
  }

  observe(target, options) {
    if (target === null || typeof target !== "object") {
      throw new TypeError("Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not of type 'Element'.");
    }
    const box = options !== undefined && options !== null && options.box !== undefined ? String(options.box) : "content-box";
    if (!BOXES.includes(box)) {
      throw new TypeError(`Failed to execute 'observe' on 'ResizeObserver': The provided value '${box}' is not a valid enum value of type ResizeObserverBoxOptions.`);
    }
    // Observing a target again replaces its observation, which starts over from 0 x 0.
    this.#observations.set(target, { box, last: [0, 0] });
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

  // The entries for every observation whose size is not the one last reported; records the new sizes.
  _gather() {
    const entries = [];
    for (const [target, observation] of this.#observations) {
      const size = sizeOf(target);
      const now = reported(observation.box, size);
      if (now[0] === observation.last[0] && now[1] === observation.last[1]) continue;
      observation.last = now;
      entries.push(new ResizeObserverEntry(target, size));
    }
    return entries;
  }

  _deliver(entries) {
    try {
      this.#callback.call(this, entries, this);
    } catch (error) {
      reportException(error);
    }
  }
}

// The frame's resize step: called after the frame's animation callbacks. Every observer's entries are gathered before
// any is delivered, so a callback's changes are the next frame's.
export function deliverResizeObservations() {
  if (active.size === 0) return;
  const due = [];
  for (const observer of active) {
    const entries = observer._gather();
    if (entries.length > 0) due.push([observer, entries]);
  }
  for (const [observer, entries] of due) observer._deliver(entries);
}

// Who asks for a frame when there is something to check and nothing else may: the display (display.js), which runs
// the frame's callbacks and then this step. Without one, a check is a task.
export function setRenderingUpdate(request) {
  schedule = request;
}

export function hasResizeObservations() {
  return active.size > 0;
}

export function requestResizeCheck() {
  if (active.size === 0) return;
  if (schedule) schedule();
  else setTimeout(deliverResizeObservations, 0);
}
