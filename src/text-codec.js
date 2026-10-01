// `TextEncoder` and `TextDecoder`, which Migo's V8 does not have and which every loader that reads JSON, glTF or a font
// assumes (three.js's GLTFLoader decodes its JSON chunk with one, PlayCanvas and Pixi read text responses with one,
// FileReader below used one that did not exist).
//
// UTF-8 is the runtime's own codec (`migo.encode` / `migo.decode`, native); the other labels the Encoding Standard gives
// that engines meet are done here: UTF-16LE, windows-1252 (which "latin1", "iso-8859-1" and "ascii" all are) and GBK
// (the runtime's too). Anything else is a RangeError, as in a browser that lacks the encoding.

const hasNative = () => typeof migo !== "undefined" && typeof migo.encode === "function" && typeof migo.decode === "function";

// ---- UTF-8 in JavaScript: the fallback when the runtime's codec is absent, and the strict validator `fatal` needs ------

function utf8Encode(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;           // a lone surrogate encodes as U+FFFD
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/// Decodes UTF-8 the way the Encoding Standard does: each maximal invalid subpart is one U+FFFD. With `fatal` the first
/// invalid sequence is a TypeError instead.
function utf8Decode(bytes, fatal) {
  let out = "";
  let chunk = [];
  const flush = () => { if (chunk.length) { out += String.fromCharCode.apply(null, chunk); chunk = []; } };
  const push = (c) => {
    if (c > 0xffff) { c -= 0x10000; chunk.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff)); } else chunk.push(c);
    if (chunk.length >= 4096) flush();
  };
  const bad = () => { if (fatal) throw new TypeError("The encoded data was not valid for encoding utf-8"); push(0xfffd); };
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) { push(b); i++; continue; }
    let need, min, cp;
    if (b >= 0xc2 && b <= 0xdf) { need = 1; cp = b & 0x1f; min = 0x80; }
    else if (b >= 0xe0 && b <= 0xef) { need = 2; cp = b & 0x0f; min = 0x800; }
    else if (b >= 0xf0 && b <= 0xf4) { need = 3; cp = b & 0x07; min = 0x10000; }
    else { bad(); i++; continue; }
    let j = i + 1;
    let ok = true;
    for (let k = 0; k < need; k++, j++) {
      const lo = k === 0 ? (b === 0xe0 ? 0xa0 : b === 0xf0 ? 0x90 : 0x80) : 0x80;
      const hi = k === 0 ? (b === 0xed ? 0x9f : b === 0xf4 ? 0x8f : 0xbf) : 0xbf;
      if (j >= bytes.length || bytes[j] < lo || bytes[j] > hi) { ok = false; break; }
      cp = (cp << 6) | (bytes[j] & 63);
    }
    if (!ok || cp < min) { bad(); i = j > i + 1 ? j : i + 1; continue; }
    push(cp);
    i = j;
  }
  flush();
  return out;
}

// windows-1252: bytes 0x80..0x9f are not the C1 controls the Latin-1 table gives them.
const W1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];

const LABELS = {
  "utf-8": "utf-8", "utf8": "utf-8", "unicode-1-1-utf-8": "utf-8",
  "utf-16le": "utf-16le", "utf-16": "utf-16le", "ucs-2": "utf-16le", "unicode": "utf-16le",
  "gbk": "gbk", "gb2312": "gbk", "gb18030": "gbk", "chinese": "gbk", "x-gbk": "gbk",
  "windows-1252": "windows-1252", "latin1": "windows-1252", "iso-8859-1": "windows-1252", "ascii": "windows-1252",
  "us-ascii": "windows-1252", "l1": "windows-1252", "cp1252": "windows-1252", "x-cp1252": "windows-1252",
};

function bytesOf(input) {
  if (input === undefined) return new Uint8Array(0);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("The provided value is not of type '(ArrayBuffer or ArrayBufferView)'");
}

export class TextEncoder {
  get encoding() { return "utf-8"; }

  encode(input = "") {
    const text = String(input);
    if (hasNative()) return new Uint8Array(migo.encode({ data: text, format: "utf8" }));
    return utf8Encode(text);
  }

  encodeInto(source, destination) {
    const full = this.encode(source);
    // Whole code points only: stop before the one that does not fit.
    let written = 0;
    let read = 0;
    for (let i = 0; i < source.length;) {
      const cp = source.codePointAt(i);
      const units = cp > 0xffff ? 2 : 1;
      const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (written + size > destination.length) break;
      written += size;
      read += units;
      i += units;
    }
    destination.set(full.subarray(0, written));
    return { read, written };
  }
}

export class TextDecoder {
  constructor(label = "utf-8", options = {}) {
    const name = LABELS[String(label).trim().toLowerCase()];
    if (!name) throw new RangeError(`The encoding label provided ('${label}') is invalid.`);
    this._name = name;
    this._fatal = !!options.fatal;
    this._ignoreBOM = !!options.ignoreBOM;
    this._pending = null;       // bytes of an incomplete sequence carried between `stream: true` calls
    this._seenFirst = false;
  }

  get encoding() { return this._name; }
  get fatal() { return this._fatal; }
  get ignoreBOM() { return this._ignoreBOM; }

  decode(input, options = {}) {
    let bytes = bytesOf(input);
    const stream = !!(options && options.stream);
    if (this._pending) {
      const joined = new Uint8Array(this._pending.length + bytes.length);
      joined.set(this._pending);
      joined.set(bytes, this._pending.length);
      bytes = joined;
      this._pending = null;
    }
    if (stream && this._name === "utf-8") {
      // Hold back an incomplete sequence at the end: up to three bytes that could still become a character.
      let cut = bytes.length;
      for (let back = 1; back <= Math.min(3, bytes.length); back++) {
        const b = bytes[bytes.length - back];
        if ((b & 0xc0) === 0x80) continue;                       // a continuation byte: keep looking for its lead
        const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
        if (need > back) cut = bytes.length - back;
        break;
      }
      if (cut < bytes.length) { this._pending = bytes.slice(cut); bytes = bytes.subarray(0, cut); }
    }
    let text;
    switch (this._name) {
      case "utf-8": {
        let start = 0;
        if (!this._ignoreBOM && !this._seenFirst && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
        const body = start ? bytes.subarray(start) : bytes;
        text = hasNative() && !this._fatal ? migo.decode({ data: body, format: "utf8" }) : utf8Decode(body, this._fatal);
        break;
      }
      case "utf-16le": {
        const units = [];
        for (let i = 0; i + 1 < bytes.length; i += 2) units.push(bytes[i] | (bytes[i + 1] << 8));
        if (bytes.length % 2) units.push(0xfffd);
        if (!this._ignoreBOM && !this._seenFirst && units[0] === 0xfeff) units.shift();
        text = "";
        for (let i = 0; i < units.length; i += 4096) text += String.fromCharCode.apply(null, units.slice(i, i + 4096));
        break;
      }
      case "gbk":
        text = hasNative() ? migo.decode({ data: bytes, format: "gbk" }) : utf8Decode(bytes, false);
        break;
      default: {
        text = "";
        const units = new Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) units[i] = bytes[i] >= 0x80 && bytes[i] <= 0x9f ? W1252[bytes[i] - 0x80] : bytes[i];
        for (let i = 0; i < units.length; i += 4096) text += String.fromCharCode.apply(null, units.slice(i, i + 4096));
      }
    }
    if (bytes.length) this._seenFirst = true;
    if (!stream) { this._seenFirst = false; this._pending = null; }
    return text;
  }
}
