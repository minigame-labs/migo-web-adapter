// ScreenOrientation (W3C Screen Orientation): `screen.orientation` is an EventTarget with the screen's `type` and
// `angle`, a `change` event when the window turns, and `lock()` / `unlock()`. It was a plain { angle, type } snapshot,
// so a Unity build -- whose start-up listens for its `change` -- threw before its first frame.
//
// The type follows the window as the platform reports it now (migo.getWindowInfo); the angle is from the device's
// natural orientation, portrait on a phone or tablet and landscape on a desktop. Locking is the platform's
// (migo.setDeviceOrientation, where there is one), not a page's: lock() is NotSupportedError, as a browser answers
// where it cannot lock, and unlock() does nothing.

import EventTarget from "./event-target.js";
import DOMException from "./dom-exception.js";
import { reportException } from "./report.js";

const LOCK_TYPES = new Set([
  "any", "natural", "landscape", "portrait", "portrait-primary", "portrait-secondary", "landscape-primary", "landscape-secondary",
]);
const HANDHELD = new Set(["android", "ios", "ohos", "harmonyos"]);

function windowSize() {
  try {
    const info = migo.getWindowInfo();
    return [info.windowWidth || info.screenWidth || 0, info.windowHeight || info.screenHeight || 0];
  } catch {
    return [globalThis.innerWidth || 0, globalThis.innerHeight || 0];
  }
}

function naturalIsPortrait() {
  try {
    return HANDHELD.has(String(migo.getSystemInfoSync().platform).toLowerCase());
  } catch {
    return true;
  }
}

export class ScreenOrientation extends EventTarget {
  constructor() {
    super();
    this._onchange = null;
    this._watching = false;
    this._type = this._current();
  }
  _current() {
    const [width, height] = windowSize();
    return width > height ? "landscape-primary" : "portrait-primary";
  }
  get type() { return this._watching ? this._type : this._current(); }
  get angle() {
    const portrait = this.type.startsWith("portrait");
    return portrait === naturalIsPortrait() ? 0 : 90;
  }
  get onchange() { return this._onchange; }
  set onchange(handler) { this._onchange = typeof handler === "function" ? handler : null; this._watch(); }
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (type === "change") this._watch();
  }
  lock(orientation) {
    if (arguments.length < 1) return Promise.reject(new TypeError("Failed to execute 'lock' on 'ScreenOrientation': 1 argument required, but only 0 present."));
    const value = String(orientation);
    if (!LOCK_TYPES.has(value)) {
      return Promise.reject(new TypeError(`Failed to execute 'lock' on 'ScreenOrientation': The provided value '${value}' is not a valid enum value of type OrientationLockType.`));
    }
    return Promise.reject(new DOMException("screen.orientation.lock() is not available on this device.", "NotSupportedError"));
  }
  unlock() {}

  _watch() {
    if (this._watching || typeof globalThis.addEventListener !== "function") return;
    this._watching = true;
    this._type = this._current();
    globalThis.addEventListener("resize", () => {
      const now = this._current();
      if (now === this._type) return;
      this._type = now;
      const event = { type: "change", target: this, currentTarget: this };
      if (this._onchange) {
        try { this._onchange.call(this, event); } catch (error) { reportException(error); }
      }
      this.dispatchEvent(event);
    });
  }
}
Object.defineProperty(ScreenOrientation.prototype, Symbol.toStringTag, { value: "ScreenOrientation", configurable: true });
