// Browser-style Event classes the engines occasionally `instanceof` against.
// All extend a plain Event base; the adapter never actually constructs them
// internally — touch/mouse events are dispatched as plain objects with a
// matching `type` field.

export class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.target = null;
    this.currentTarget = null;
    this.timeStamp = Date.now();
    this.defaultPrevented = false;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() {}
  // The listeners after the current one on the same target are skipped (EventTarget.dispatchEvent reads the flag).
  stopImmediatePropagation() { this._stopImmediate = true; }
}

export class TouchEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.touches = init.touches || [];
    this.targetTouches = init.targetTouches || this.touches;
    this.changedTouches = init.changedTouches || this.touches;
  }
}

export class MouseEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.clientX = init.clientX || 0;
    this.clientY = init.clientY || 0;
    this.pageX = init.pageX || this.clientX;
    this.pageY = init.pageY || this.clientY;
    // The app owns the screen and its canvas starts at the window's origin, so screen and offset are the client point.
    this.screenX = init.screenX === undefined ? this.clientX : init.screenX;
    this.screenY = init.screenY === undefined ? this.clientY : init.screenY;
    this.offsetX = init.offsetX === undefined ? this.clientX : init.offsetX;
    this.offsetY = init.offsetY === undefined ? this.clientY : init.offsetY;
    this.x = this.clientX;
    this.y = this.clientY;
    this.button = init.button || 0;
    this.buttons = init.buttons || 0;
    this.movementX = init.movementX || 0;
    this.movementY = init.movementY || 0;
    this.ctrlKey = !!init.ctrlKey;
    this.shiftKey = !!init.shiftKey;
    this.altKey = !!init.altKey;
    this.metaKey = !!init.metaKey;
    this.relatedTarget = init.relatedTarget || null;
  }
}

// The Pointer Events interface: what an engine reads when it listens for `pointerdown` instead of touch and mouse
// (Babylon.js, three.js's OrbitControls, Pixi when `PointerEvent` exists). `pointerType` says which device, `pointerId`
// which contact, `isPrimary` whether it is the first of its type still down.
export class PointerEvent extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.pointerId = init.pointerId || 0;
    this.width = init.width === undefined ? 1 : init.width;
    this.height = init.height === undefined ? 1 : init.height;
    this.pressure = init.pressure || 0;
    this.tangentialPressure = init.tangentialPressure || 0;
    this.tiltX = init.tiltX || 0;
    this.tiltY = init.tiltY || 0;
    this.twist = init.twist || 0;
    this.pointerType = init.pointerType || "";
    this.isPrimary = !!init.isPrimary;
  }
  getCoalescedEvents() { return []; }
  getPredictedEvents() { return []; }
}

// WheelEvent extends MouseEvent in the DOM. deltaMode reports the unit
// (0 = pixel, 1 = line, 2 = page); it is carried, not normalized.
export class WheelEvent extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.deltaX = init.deltaX || 0;
    this.deltaY = init.deltaY || 0;
    this.deltaZ = init.deltaZ || 0;
    this.deltaMode = init.deltaMode || 0;
  }
}

export class KeyboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key || "";
    this.code = init.code || "";
    this.ctrlKey = !!init.ctrlKey;
    this.shiftKey = !!init.shiftKey;
    this.altKey = !!init.altKey;
    this.metaKey = !!init.metaKey;
    this.repeat = !!init.repeat;
  }
}

export class CompositionEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.data = init.data != null ? init.data : "";
  }
}

export class DeviceMotionEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.acceleration = init.acceleration || null;
    this.accelerationIncludingGravity = init.accelerationIncludingGravity || null;
    this.rotationRate = init.rotationRate || null;
    this.interval = init.interval || 0;
  }
}
