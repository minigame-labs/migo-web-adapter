// HTML's structured serialisation (StructuredSerializeInternal, forStorage) and deserialisation, to and from a
// JSON-able form: what IndexedDB stores is a value as it was when it was put, and what it reads back is a new copy each
// time, which this form gives in memory and in the database file alike.
//
// The form is a tree of arrays whose first element names the kind; an object met a second time is ["ref", n], the n-th
// object serialised, so shared references and cycles come back as they were. What the specification serialises:
// primitives (undefined, null, booleans, numbers -- NaN, the infinities and -0 included -- BigInts, strings), the
// Boolean, Number, BigInt and String objects, Date, RegExp, ArrayBuffer and its views, Map, Set, Error, Array, Blob
// and File, and any other non-callable object as its own enumerable string-keyed properties. A function, a symbol, a
// SharedArrayBuffer (not storable) or a WeakMap-like object is a DataCloneError.

import DOMException from "../dom-exception.js";
import { Blob, File } from "../blob.js";
import { atob, btoa } from "../base64.js";

const ERROR_NAMES = new Set(["Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError"]);
const VIEWS = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView,
};
if (typeof Float16Array === "function") VIEWS.Float16Array = Float16Array;

const toString = (value) => Object.prototype.toString.call(value);
const dataCloneError = (what) => new DOMException(`${what} could not be cloned.`, "DataCloneError");

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeNumber(n) {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "Infinity";
  if (n === -Infinity) return "-Infinity";
  if (n === 0 && 1 / n < 0) return "-0";
  return n;
}

function decodeNumber(n) {
  if (typeof n === "number") return n;
  return n === "NaN" ? NaN : n === "Infinity" ? Infinity : n === "-Infinity" ? -Infinity : -0;
}

/// The serialised form of `value`, or DataCloneError. Getters run as the serialisation reads them, and what they throw
/// is theirs.
export function serialize(value) {
  const memory = new Map();
  const walk = (v) => {
    switch (typeof v) {
      case "undefined": return ["u"];
      case "boolean": return ["b", v];
      case "number": return ["n", encodeNumber(v)];
      case "bigint": return ["i", v.toString()];
      case "string": return ["s", v];
      case "symbol": throw dataCloneError("Symbol()");
      case "function": throw dataCloneError("A function");
    }
    if (v === null) return ["z"];
    if (memory.has(v)) return ["ref", memory.get(v)];
    const id = memory.size;
    memory.set(v, id);
    const tag = toString(v);
    if (tag === "[object Boolean]") return ["Bo", id, Boolean.prototype.valueOf.call(v)];
    if (tag === "[object Number]") return ["No", id, encodeNumber(Number.prototype.valueOf.call(v))];
    if (tag === "[object BigInt]") return ["Io", id, BigInt.prototype.valueOf.call(v).toString()];
    if (tag === "[object String]") return ["So", id, String.prototype.valueOf.call(v)];
    if (v instanceof Date) return ["D", id, encodeNumber(v.getTime())];
    if (v instanceof RegExp) return ["R", id, v.source, v.flags];
    if (typeof SharedArrayBuffer === "function" && v instanceof SharedArrayBuffer) {
      throw dataCloneError("A SharedArrayBuffer");
    }
    if (v instanceof ArrayBuffer) {
      if (v.detached) throw dataCloneError("A detached ArrayBuffer");
      return ["AB", id, bytesToBase64(new Uint8Array(v))];
    }
    if (ArrayBuffer.isView(v)) {
      const kind = v instanceof DataView ? "DataView" : v.constructor && VIEWS[v.constructor.name] === v.constructor ? v.constructor.name : null;
      if (kind === null) throw dataCloneError("An array buffer view");
      const length = kind === "DataView" ? v.byteLength : v.length;
      return ["V", id, kind, walk(v.buffer), v.byteOffset, length];
    }
    if (v instanceof Map) {
      const entries = [];
      for (const [key, item] of v) entries.push([walk(key), walk(item)]);
      return ["M", id, entries];
    }
    if (v instanceof Set) {
      const items = [];
      for (const item of v) items.push(walk(item));
      return ["S", id, items];
    }
    if (v instanceof File) {
      return ["F", id, bytesToBase64(v._bytes), v.type, v.name, v.lastModified];
    }
    if (v instanceof Blob) return ["B", id, bytesToBase64(v._bytes), v.type];
    if (v instanceof Error) {
      const name = ERROR_NAMES.has(v.name) ? v.name : "Error";
      const message = Object.prototype.hasOwnProperty.call(v, "message") ? String(v.message) : undefined;
      return ["E", id, name, message === undefined ? null : message, typeof v.stack === "string" ? v.stack : null];
    }
    if (Array.isArray(v)) {
      const own = [];
      for (const key of Object.keys(v)) own.push([key, walk(v[key])]);
      return ["A", id, v.length, own];
    }
    if (v instanceof WeakMap || v instanceof WeakSet || v instanceof Promise ||
        (typeof WeakRef === "function" && v instanceof WeakRef)) {
      throw dataCloneError(tag);
    }
    const own = [];
    for (const key of Object.keys(v)) own.push([key, walk(v[key])]);
    return ["O", id, own];
  };
  return walk(value);
}

/// A new value from a serialised form.
export function deserialize(form) {
  const memory = [];
  const remember = (id, value) => { memory[id] = value; return value; };
  const walk = (f) => {
    switch (f[0]) {
      case "u": return undefined;
      case "z": return null;
      case "b": return f[1];
      case "n": return decodeNumber(f[1]);
      case "i": return BigInt(f[1]);
      case "s": return f[1];
      case "ref": return memory[f[1]];
      case "Bo": return remember(f[1], new Boolean(f[2]));
      case "No": return remember(f[1], new Number(decodeNumber(f[2])));
      case "Io": return remember(f[1], Object(BigInt(f[2])));
      case "So": return remember(f[1], new String(f[2]));
      case "D": return remember(f[1], new Date(decodeNumber(f[2])));
      case "R": return remember(f[1], new RegExp(f[2], f[3]));
      case "AB": return remember(f[1], base64ToBytes(f[2]).buffer);
      case "V": {
        const id = f[1];
        const buffer = walk(f[3]);
        const View = VIEWS[f[2]];
        return remember(id, new View(buffer, f[4], f[5]));
      }
      case "M": {
        const map = remember(f[1], new Map());
        for (const [key, item] of f[2]) map.set(walk(key), walk(item));
        return map;
      }
      case "S": {
        const set = remember(f[1], new Set());
        for (const item of f[2]) set.add(walk(item));
        return set;
      }
      case "B": {
        const blob = remember(f[1], new Blob([], { type: f[3] }));
        blob._bytes = base64ToBytes(f[2]);
        return blob;
      }
      case "F": {
        const file = remember(f[1], new File([], f[4], { type: f[3], lastModified: f[5] }));
        file._bytes = base64ToBytes(f[2]);
        return file;
      }
      case "E": {
        const ErrorClass = globalThis[f[2]] || Error;
        const error = remember(f[1], f[3] === null ? new ErrorClass() : new ErrorClass(f[3]));
        if (f[4] !== null) Object.defineProperty(error, "stack", { value: f[4], writable: true, configurable: true });
        return error;
      }
      case "A": {
        const array = remember(f[1], new Array(f[2]));
        for (const [key, item] of f[3]) array[key] = walk(item);
        return array;
      }
      case "O": {
        const object = remember(f[1], {});
        for (const [key, item] of f[2]) object[key] = walk(item);
        return object;
      }
      default:
        throw new DOMException("The stored value could not be read.", "DataError");
    }
  };
  return walk(form);
}
