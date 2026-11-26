// IndexedDB keys (W3C Indexed Database API 3.0, "Keys", "Key path construct", "Key range"): what a value is as a key,
// how two keys compare, and the key ranges. A key is held as { type, value }: "number" (not NaN), "date" (its time,
// not NaN), "string", "binary" (a Uint8Array of the bytes) or "array" (a list of keys); `toValue` gives content back the
// value the specification says a key is: a number, a new Date, a string, a new ArrayBuffer, a new Array.

import DOMException from "../dom-exception.js";

const TYPE_ORDER = { number: 0, date: 1, string: 2, binary: 3, array: 4 };

export function dataError(message) {
  return new DOMException(message, "DataError");
}

/// "Convert a value to a key": the key, or null when `input` is not a valid key (the callers throw DataError).
export function valueToKey(input, seen = []) {
  if (typeof input === "number") return Number.isNaN(input) ? null : { type: "number", value: input };
  if (typeof input === "string") return { type: "string", value: input };
  if (input instanceof Date) {
    const time = input.getTime();
    return Number.isNaN(time) ? null : { type: "date", value: time };
  }
  if (input instanceof ArrayBuffer) return { type: "binary", value: new Uint8Array(input.slice(0)) };
  if (ArrayBuffer.isView(input)) {
    return { type: "binary", value: new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)) };
  }
  if (Array.isArray(input)) {
    if (seen.includes(input)) return null;
    seen.push(input);
    const keys = [];
    for (let index = 0; index < input.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(input, index)) return null;
      const key = valueToKey(input[index], seen);
      if (key === null) return null;
      keys.push(key);
    }
    seen.pop();
    return { type: "array", value: keys };
  }
  return null;
}

/// The key, or DataError.
export function requireKey(input, what = "The parameter is not a valid key.") {
  const key = valueToKey(input);
  if (key === null) throw dataError(what);
  return key;
}

/// "Convert a key to a value".
export function toValue(key) {
  switch (key.type) {
    case "number": return key.value;
    case "string": return key.value;
    case "date": return new Date(key.value);
    case "binary": return key.value.slice().buffer;
    default: return key.value.map(toValue);
  }
}

/// "Compare two keys": -1, 0 or 1.
export function compareKeys(a, b) {
  if (a.type !== b.type) return TYPE_ORDER[a.type] < TYPE_ORDER[b.type] ? -1 : 1;
  switch (a.type) {
    case "number":
    case "date":
      return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    case "string":
      // By code unit, as the specification compares strings.
      return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    case "binary": {
      const n = Math.min(a.value.length, b.value.length);
      for (let i = 0; i < n; i++) {
        if (a.value[i] !== b.value[i]) return a.value[i] < b.value[i] ? -1 : 1;
      }
      return a.value.length === b.value.length ? 0 : a.value.length < b.value.length ? -1 : 1;
    }
    default: {
      const n = Math.min(a.value.length, b.value.length);
      for (let i = 0; i < n; i++) {
        const c = compareKeys(a.value[i], b.value[i]);
        if (c !== 0) return c;
      }
      return a.value.length === b.value.length ? 0 : a.value.length < b.value.length ? -1 : 1;
    }
  }
}

/// A key as the JSON-able form the database file holds.
export function encodeKey(key) {
  switch (key.type) {
    case "binary": return { t: "b", v: Array.from(key.value) };
    case "array": return { t: "a", v: key.value.map(encodeKey) };
    default: return { t: key.type[0], v: key.value };
  }
}

export function decodeKey(form) {
  switch (form.t) {
    case "n": return { type: "number", value: form.v };
    case "d": return { type: "date", value: form.v };
    case "s": return { type: "string", value: form.v };
    case "b": return { type: "binary", value: Uint8Array.from(form.v) };
    default: return { type: "array", value: form.v.map(decodeKey) };
  }
}

// ---- Key paths ------------------------------------------------------------------------------------------------

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

/// "A valid key path": a string that is empty or identifiers joined by dots, or a non-empty list of those.
export function isValidKeyPath(keyPath) {
  if (typeof keyPath === "string") return keyPath === "" || keyPath.split(".").every((part) => IDENTIFIER.test(part));
  if (Array.isArray(keyPath)) return keyPath.length > 0 && keyPath.every((part) => typeof part === "string" && isValidKeyPath(part));
  return false;
}

/// WebIDL's conversion of a keyPath argument: a sequence of strings stays a list, anything else is a string.
export function normalizeKeyPath(keyPath) {
  if (keyPath === null || keyPath === undefined) return null;
  if (typeof keyPath === "object" && typeof keyPath[Symbol.iterator] === "function" && typeof keyPath !== "string") {
    return Array.from(keyPath, String);
  }
  return String(keyPath);
}

const MISSING = Symbol("no value at the key path");
export { MISSING };

/// "Evaluate a key path on a value": the value found, or MISSING.
export function evaluateKeyPath(value, keyPath) {
  if (Array.isArray(keyPath)) {
    const result = [];
    for (const part of keyPath) {
      const found = evaluateKeyPath(value, part);
      if (found === MISSING) return MISSING;
      result.push(found);
    }
    return result;
  }
  if (keyPath === "") return value;
  let current = value;
  for (const identifier of keyPath.split(".")) {
    if (typeof current === "string" && identifier === "length") {
      current = current.length;
    } else if (Array.isArray(current) && identifier === "length") {
      current = current.length;
    } else if (typeof Blob === "function" && current instanceof Blob && (identifier === "size" || identifier === "type")) {
      current = current[identifier];
    } else if (current !== null && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, identifier)) return MISSING;
      current = current[identifier];
    } else {
      return MISSING;
    }
  }
  return current;
}

/// "Extract a key from a value using a key path": the key, null when the path gives no value or no valid key.
export function extractKey(value, keyPath) {
  const found = evaluateKeyPath(value, keyPath);
  if (found === MISSING) return null;
  return valueToKey(found);
}

/// "Check that a key could be injected into a value": the last identifier's parent is an object or absent.
export function canInjectKey(value, keyPath) {
  const identifiers = keyPath.split(".");
  identifiers.pop();
  let current = value;
  for (const identifier of identifiers) {
    if (current === null || typeof current !== "object") return false;
    if (!Object.prototype.hasOwnProperty.call(current, identifier)) return true;
    current = current[identifier];
  }
  return current !== null && typeof current === "object";
}

/// "Inject a key into a value using a key path".
export function injectKey(value, key, keyPath) {
  const identifiers = keyPath.split(".");
  const last = identifiers.pop();
  let current = value;
  for (const identifier of identifiers) {
    if (!Object.prototype.hasOwnProperty.call(current, identifier)) {
      current[identifier] = {};
    }
    current = current[identifier];
  }
  current[last] = toValue(key);
}

// ---- Key ranges -----------------------------------------------------------------------------------------------

const RANGE = Symbol("IDBKeyRange");

export class IDBKeyRange {
  constructor() {
    if (arguments[0] !== RANGE) throw new TypeError("Illegal constructor");
    const [, lower, upper, lowerOpen, upperOpen] = arguments;
    this._lower = lower;
    this._upper = upper;
    this._lowerOpen = lowerOpen;
    this._upperOpen = upperOpen;
  }
  get lower() { return this._lower === null ? undefined : toValue(this._lower); }
  get upper() { return this._upper === null ? undefined : toValue(this._upper); }
  get lowerOpen() { return this._lowerOpen; }
  get upperOpen() { return this._upperOpen; }

  static only(value) {
    if (arguments.length < 1) throw new TypeError("IDBKeyRange.only: 1 argument required");
    const key = requireKey(value);
    return new IDBKeyRange(RANGE, key, key, false, false);
  }
  static lowerBound(lower, open = false) {
    if (arguments.length < 1) throw new TypeError("IDBKeyRange.lowerBound: 1 argument required");
    return new IDBKeyRange(RANGE, requireKey(lower), null, !!open, true);
  }
  static upperBound(upper, open = false) {
    if (arguments.length < 1) throw new TypeError("IDBKeyRange.upperBound: 1 argument required");
    return new IDBKeyRange(RANGE, null, requireKey(upper), true, !!open);
  }
  static bound(lower, upper, lowerOpen = false, upperOpen = false) {
    if (arguments.length < 2) throw new TypeError("IDBKeyRange.bound: 2 arguments required");
    const low = requireKey(lower);
    const high = requireKey(upper);
    const c = compareKeys(low, high);
    if (c > 0 || (c === 0 && (lowerOpen || upperOpen))) throw dataError("The lower key is greater than the upper key.");
    return new IDBKeyRange(RANGE, low, high, !!lowerOpen, !!upperOpen);
  }
  includes(key) {
    if (arguments.length < 1) throw new TypeError("IDBKeyRange.includes: 1 argument required");
    return rangeIncludes(this, requireKey(key));
  }
}

export function rangeIncludes(range, key) {
  if (range._lower !== null) {
    const c = compareKeys(range._lower, key);
    if (c > 0 || (c === 0 && range._lowerOpen)) return false;
  }
  if (range._upper !== null) {
    const c = compareKeys(range._upper, key);
    if (c < 0 || (c === 0 && range._upperOpen)) return false;
  }
  return true;
}

export const UNBOUNDED = new IDBKeyRange(RANGE, null, null, true, true);

/// "Convert a value to a key range": a range as it is, a key as `only` it; null/undefined the unbounded range unless
/// `nullDisallowed`, when it is DataError.
export function toKeyRange(value, nullDisallowed = false) {
  if (value instanceof IDBKeyRange) return value;
  if (value === undefined || value === null) {
    if (nullDisallowed) throw dataError("No key or key range specified.");
    return UNBOUNDED;
  }
  const key = requireKey(value);
  return new IDBKeyRange(RANGE, key, key, false, false);
}
