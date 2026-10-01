// `AbortController` / `AbortSignal`, which `fetch` takes (`fetch(url, { signal })`) and which loaders create to cancel a
// request they no longer want.

import EventTarget from "./event-target.js";
import DOMException from "./dom-exception.js";

const abortError = () => new (globalThis.DOMException || DOMException)("This operation was aborted", "AbortError");

export class AbortSignal extends EventTarget {
  constructor() {
    super();
    this.aborted = false;
    this.reason = undefined;
    this.onabort = null;
  }

  throwIfAborted() { if (this.aborted) throw this.reason; }

  static abort(reason) {
    const signal = new AbortSignal();
    signal.aborted = true;
    signal.reason = reason === undefined ? abortError() : reason;
    return signal;
  }

  static timeout(milliseconds) {
    const signal = new AbortSignal();
    setTimeout(() => signal._abort(new (globalThis.DOMException || DOMException)("The operation timed out.", "TimeoutError")), milliseconds);
    return signal;
  }

  _abort(reason) {
    if (this.aborted) return;
    this.aborted = true;
    this.reason = reason === undefined ? abortError() : reason;
    const event = { type: "abort", target: this, currentTarget: this, defaultPrevented: false, preventDefault() {}, stopPropagation() {} };
    if (typeof this.onabort === "function") { try { this.onabort(event); } catch (e) { console.error(e); } }
    this.dispatchEvent(event);
  }
}

export class AbortController {
  constructor() { this.signal = new AbortSignal(); }
  abort(reason) { this.signal._abort(reason); }
}
