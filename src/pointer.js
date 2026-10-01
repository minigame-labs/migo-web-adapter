// Pointer Events, from the touches and mouse events the host reports.
//
// Browsers fire `pointerdown`/`pointermove`/`pointerup` for every contact and engines pick them over touch and mouse
// events when `window.PointerEvent` exists: Babylon.js listens to nothing else (a Babylon scene received no input at
// all on Migo), three.js's OrbitControls listens to nothing else, Pixi's event system switches to them. So the adapter
// defines `PointerEvent` and synthesises the stream, in the order the Pointer Events specification gives:
//
//   touch  pointerover, pointerenter, pointerdown, [touchstart] ... pointermove, [touchmove] ... pointerup, [touchend],
//          pointerout, pointerleave                                      (pointercancel for a cancelled touch)
//   mouse  pointerover, pointerenter (once), pointerdown, [mousedown] ... pointermove, [mousemove] ... pointerup, [mouseup]
//
// A touch is `pointerType: "touch"`, its id the host's identifier + 2 (the mouse is pointer 1, as in Chrome), and the
// first one down is primary until it lifts. A host that sends a mouse and a touch for one click (a host configured to
// feed both streams) gets both, as on the web with a mouse and a touch screen. Calling `preventDefault()` on a
// `pointerdown` stops the compatibility mouse events of that contact, as the specification says; touch events are not
// affected.

import { PointerEvent } from "./events.js";

const TOUCH_ID_BASE = 2;
const MOUSE_ID = 1;
// DOM `button` -> `buttons` bit: primary 1, auxiliary (middle) 4, secondary (right) 2, back 8, forward 16.
const BUTTON_BIT = [1, 4, 2, 8, 16];

const CANCELABLE = new Set(["pointerdown", "pointermove", "pointerup", "pointerover", "pointerout"]);
const BUBBLES = new Set(["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout", "gotpointercapture", "lostpointercapture"]);

function make(type, init) {
  init.bubbles = BUBBLES.has(type);
  init.cancelable = CANCELABLE.has(type);
  return new PointerEvent(type, init);
}

/// Creates the bridge. `emit(event)` delivers an event to the canvas, document and window and returns whether a listener
/// called `preventDefault()`; `canvas` is the element pointer capture is released on when a contact ends.
export function createPointerBridge(emit, canvas) {
  let primaryTouch = null;
  let mouseInside = false;
  let mouseButtons = 0;

  const releaseCapture = (pointerId) => {
    if (canvas && typeof canvas.hasPointerCapture === "function" && canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  };

  const touchInit = (t, pointerId, isPrimary, extra) => ({
    pointerId,
    pointerType: "touch",
    isPrimary,
    clientX: t.clientX,
    clientY: t.clientY,
    pageX: t.pageX === undefined ? t.clientX : t.pageX,
    pageY: t.pageY === undefined ? t.clientY : t.pageY,
    screenX: t.screenX === undefined ? t.clientX : t.screenX,
    screenY: t.screenY === undefined ? t.clientY : t.screenY,
    width: (t.radiusX || 0.5) * 2,
    height: (t.radiusY || 0.5) * 2,
    ...extra,
  });

  return {
    /// A touch event from the host: `type` is touchstart/touchmove/touchend/touchcancel and `changed` its changed
    /// touches. Returns whether any `pointerdown` was cancelled.
    touch(type, changed, timeStamp) {
      let prevented = false;
      for (let i = 0; i < changed.length; i++) {
        const t = changed[i];
        const pointerId = TOUCH_ID_BASE + (t.identifier | 0);
        if (type === "touchstart") {
          const isPrimary = primaryTouch === null;
          if (isPrimary) primaryTouch = pointerId;
          const init = touchInit(t, pointerId, isPrimary, { button: 0, buttons: 1, pressure: t.force || 0.5 });
          emit(stamp(make("pointerover", init), timeStamp));
          emit(stamp(make("pointerenter", init), timeStamp));
          if (emit(stamp(make("pointerdown", init), timeStamp))) prevented = true;
        } else if (type === "touchmove") {
          emit(stamp(make("pointermove", touchInit(t, pointerId, primaryTouch === pointerId, { button: -1, buttons: 1, pressure: t.force || 0.5 })), timeStamp));
        } else {
          const isPrimary = primaryTouch === pointerId;
          const init = touchInit(t, pointerId, isPrimary, { button: type === "touchend" ? 0 : -1, buttons: 0, pressure: 0 });
          emit(stamp(make(type === "touchend" ? "pointerup" : "pointercancel", init), timeStamp));
          emit(stamp(make("pointerout", init), timeStamp));
          emit(stamp(make("pointerleave", init), timeStamp));
          releaseCapture(pointerId);
          if (isPrimary) primaryTouch = null;
        }
      }
      return prevented;
    },

    /// A mouse event from the host: `type` is mousedown/mousemove/mouseup, `src` carries `x`, `y`, `button`. Returns
    /// whether a `pointerdown` was cancelled (always false for the other two).
    mouse(type, src) {
      const button = src.button || 0;
      const bit = BUTTON_BIT[button] || 1;
      const base = { pointerId: MOUSE_ID, pointerType: "mouse", isPrimary: true, clientX: src.x, clientY: src.y };
      if (!mouseInside) {
        mouseInside = true;
        emit(stamp(make("pointerover", { ...base, button: -1, buttons: mouseButtons }), src.timeStamp));
        emit(stamp(make("pointerenter", { ...base, button: -1, buttons: mouseButtons }), src.timeStamp));
      }
      if (type === "mousedown") {
        mouseButtons |= bit;
        return emit(stamp(make("pointerdown", { ...base, button, buttons: mouseButtons, pressure: 0.5 }), src.timeStamp));
      }
      if (type === "mousemove") {
        const ev = make("pointermove", {
          ...base, button: -1, buttons: mouseButtons, pressure: mouseButtons ? 0.5 : 0,
          movementX: src.movementX, movementY: src.movementY,
        });
        emit(stamp(ev, src.timeStamp));
        return false;
      }
      mouseButtons &= ~bit;
      emit(stamp(make("pointerup", { ...base, button, buttons: mouseButtons, pressure: 0 }), src.timeStamp));
      if (!mouseButtons) releaseCapture(MOUSE_ID);
      return false;
    },
  };
}

function stamp(event, timeStamp) {
  if (timeStamp !== undefined) event.timeStamp = timeStamp;
  return event;
}

// Pointer capture: `setPointerCapture(id)` makes an element the target of a pointer's events until it is released. Every
// event of this app already goes to its one canvas, so capture is bookkeeping -- but engines call it and expect
// `hasPointerCapture` to agree and `gotpointercapture` / `lostpointercapture` to fire.
export const pointerCaptureMethods = {
  setPointerCapture(pointerId) {
    const held = this._pointerCaptures || (this._pointerCaptures = new Set());
    if (held.has(pointerId)) return;
    held.add(pointerId);
    fireCapture(this, "gotpointercapture", pointerId);
  },
  releasePointerCapture(pointerId) {
    if (!this._pointerCaptures || !this._pointerCaptures.delete(pointerId)) return;
    fireCapture(this, "lostpointercapture", pointerId);
  },
  hasPointerCapture(pointerId) {
    return !!this._pointerCaptures && this._pointerCaptures.has(pointerId);
  },
};

function fireCapture(target, type, pointerId) {
  if (typeof target.dispatchEvent !== "function") return;
  const ev = make(type, { pointerId });
  ev.target = target;
  target.dispatchEvent(ev);
}

/// Adds the capture methods to `element` where it has none of its own.
export function installPointerCapture(element) {
  for (const name of Object.keys(pointerCaptureMethods)) {
    if (typeof element[name] !== "function") {
      Object.defineProperty(element, name, { value: pointerCaptureMethods[name], writable: true, configurable: true });
    }
  }
}
