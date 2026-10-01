// EventTarget — addEventListener / removeEventListener / dispatchEvent, with the parts of the options argument engines
// use: `once` (Phaser's and three.js's one-shot listeners), `signal` (a listener that goes away with an AbortController),
// listener objects with `handleEvent`, and `stopImmediatePropagation()` stopping the listeners after it. `capture` and
// `passive` are accepted and ignored: events here are dispatched at the target, not through a captured path.
// Listeners are stored in a plain map keyed by event type.

export default class EventTarget {
  constructor() {
    this._listeners = {};
  }

  addEventListener(type, listener, options) {
    if (typeof listener !== "function" && !(listener && typeof listener.handleEvent === "function")) return;
    const signal = options && typeof options === "object" ? options.signal : undefined;
    if (signal && signal.aborted) return;
    const list = this._listeners[type] || (this._listeners[type] = []);
    for (let i = 0; i < list.length; i++) if (list[i].listener === listener) return;
    const entry = { listener, once: !!(options && typeof options === "object" && options.once) };
    list.push(entry);
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", () => this.removeEventListener(type, listener));
    }
  }

  removeEventListener(type, listener) {
    const list = this._listeners[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      if (list[i].listener === listener) { list.splice(i, 1); return; }
    }
  }

  dispatchEvent(event) {
    if (!event || !event.type) return false;
    const list = this._listeners[event.type];
    if (!list || list.length === 0) return true;
    if (event.target == null) event.target = this;
    if (event.currentTarget == null) event.currentTarget = this;
    // Iterate over a copy: a listener may add/remove during dispatch.
    const snapshot = list.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const entry = snapshot[i];
      // A listener removed by an earlier one in this dispatch is not called.
      if (list.indexOf(entry) === -1) continue;
      if (entry.once) this.removeEventListener(event.type, entry.listener);
      try {
        if (typeof entry.listener === "function") entry.listener.call(this, event);
        else entry.listener.handleEvent(event);
      } catch (e) {
        // Match browser behavior: a listener throwing must not stop others.
        // Diagnostics are also untrusted embedder code. If console.error is
        // replaced with a throwing function, that failure must not escape this
        // catch block and abort the remaining listeners.
        try {
          if (typeof console !== "undefined" && console.error) console.error(e);
        } catch {
          // Reporting is best-effort; listener isolation is the contract.
        }
      }
      if (event._stopImmediate) break;
    }
    return !event.defaultPrevented;
  }
}
