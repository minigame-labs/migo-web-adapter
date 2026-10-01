// Canvas — engines either call `document.createElement('canvas')` or
// `new Canvas()`. Both must return a host canvas (with getContext, width,
// height, toDataURL). migo.createCanvas() already does that, so we just
// expose a constructor wrapper for the `new Canvas()` form.

import { installPointerCapture } from "./pointer.js";
import { ClassList } from "./class-list.js";

export default function Canvas() {
  if (typeof migo.createCanvas !== "function") {
    throw new Error("[migo-web-adapter] migo.createCanvas is not available");
  }
  const c = migo.createCanvas();
  // Engines may want addEventListener on the canvas (touch input). Forward
  // those to the global touch event source set up by index.js.
  if (typeof c.addEventListener !== "function") {
    c.addEventListener = () => {};
    c.removeEventListener = () => {};
    c.dispatchEvent = () => {};
  }
  // Pointer capture is bookkeeping here (every event goes to the one canvas) but engines call it.
  installPointerCapture(c);
  installElementMembers(c);
  return c;
}

// What a browser's <canvas> has and the runtime's host canvas does not, defined only where missing. Engines call these
// without feature detection because a DOM element always has them: Babylon.js's pointer-down handler ends with
// `canvas.focus()`, and the TypeError it threw there stopped every pointer observable of a Babylon scene. Things Migo
// cannot do (pointer lock, fullscreen) are left absent so `'requestPointerLock' in canvas` stays honest.
function installElementMembers(c) {
  const define = (name, descriptor) => {
    if (!(name in c)) Object.defineProperty(c, name, { configurable: true, ...descriptor });
  };
  define("nodeType", { value: 1, writable: true });
  define("tagName", { value: "CANVAS", writable: true });
  define("nodeName", { value: "CANVAS", writable: true });
  define("tabIndex", { value: -1, writable: true });
  define("offsetLeft", { value: 0, writable: true });
  define("offsetTop", { value: 0, writable: true });
  define("offsetParent", { value: null, writable: true });
  define("ownerDocument", { get() { return globalThis.document; } });
  define("parentElement", { get() { return this.parentNode || null; } });
  define("isConnected", {
    get() {
      const root = globalThis.document;
      for (let node = this.parentNode; node; node = node.parentNode) {
        if (node === root || node === root.body || node === root.documentElement) return true;
      }
      return false;
    },
  });
  define("getRootNode", {
    value() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node;
    },
    writable: true,
  });
  define("dataset", { get() { return this._dataset || (this._dataset = {}); } });
  define("className", { value: "", writable: true });
  define("classList", { get() { return this._classList || (this._classList = new ClassList(this)); } });
  define("contains", { value(other) { return other === this; }, writable: true });
  define("hasAttribute", { value(name) { return typeof this.getAttribute === "function" && this.getAttribute(name) != null; }, writable: true });
  define("focus", { value() { if (globalThis.document) globalThis.document.activeElement = this; }, writable: true });
  define("blur", {
    value() {
      const doc = globalThis.document;
      if (doc && doc.activeElement === this) doc.activeElement = doc.body;
    },
    writable: true,
  });
}
