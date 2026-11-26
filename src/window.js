// Window (HTML): the interface of the global object. Content asks `x instanceof Window` to tell the window from an element
// -- Excalibur's screen listens for resize on the window and watches an element with a ResizeObserver -- and threw a
// ReferenceError here, where no Window existed. It is an interface, not a constructor content may call.
import EventTarget from "./event-target.js";

export class Window extends EventTarget {
  constructor() {
    throw new TypeError("Illegal constructor");
  }

  // The global object is the one Window there is. A host whose global object already inherits from something of its
  // own cannot have Window.prototype put in that chain without losing what it inherits, so it is recognised by identity.
  static [Symbol.hasInstance](value) {
    return value === globalThis || Function.prototype[Symbol.hasInstance].call(this, value);
  }
}

// Makes the global object a Window as a browser's is, its prototype Window.prototype, when its prototype is still
// Object.prototype (nothing of the host's would be lost). Returns whether it did.
export function adoptWindowPrototype(global) {
  if (Object.getPrototypeOf(global) !== Object.prototype) return false;
  try {
    Object.setPrototypeOf(global, Window.prototype);
    return Object.getPrototypeOf(global) === Window.prototype;
  } catch {
    return false;
  }
}
