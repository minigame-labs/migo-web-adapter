// `atob` and `btoa`, as the HTML Standard defines them (section "Base64 utility methods"). A browser has both;
// Migo's V8 has neither, and PlayCanvas, three.js loaders, Babylon and every engine that inlines a data URI call
// them: `ReferenceError: atob is not defined` stopped PlayCanvas while it created its application.
//
// `btoa` takes a "binary string" (every UTF-16 unit <= 0xFF) and refuses anything else with InvalidCharacterError.
// `atob` is the "forgiving-base64 decode": ASCII whitespace is dropped, padding may be absent, but a `=` anywhere
// but the very end, a length of 1 mod 4, or a character outside the alphabet is InvalidCharacterError. Discarded
// trailing bits are not checked ("YR==" decodes like "YQ==").

import DOMException from "./dom-exception.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// charCode -> sextet, 255 for what is not in the alphabet. A Uint8Array lookup, not an `indexOf` per character.
const DECODE = new Uint8Array(256).fill(255);
const ENCODE = new Uint8Array(64);
for (let i = 0; i < 64; i++) {
  DECODE[ALPHABET.charCodeAt(i)] = i;
  ENCODE[i] = ALPHABET.charCodeAt(i);
}

// String.fromCharCode.apply takes its arguments off the stack: a few thousand at a time is safe everywhere.
const CHUNK = 8192;

function fromCodes(codes, length) {
  if (length <= CHUNK) {
    return String.fromCharCode.apply(null, length === codes.length ? codes : codes.subarray(0, length));
  }
  const parts = [];
  for (let i = 0; i < length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, codes.subarray(i, Math.min(i + CHUNK, length))));
  }
  return parts.join("");
}

export function btoa(data) {
  if (arguments.length === 0) {
    throw new TypeError("Failed to execute 'btoa': 1 argument required, but only 0 present.");
  }
  const input = String(data);
  const n = input.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const a = input.charCodeAt(i), b = input.charCodeAt(i + 1), c = input.charCodeAt(i + 2);
    if ((a | b | c) > 0xff) throw invalidBinaryString();
    out[o++] = ENCODE[a >> 2];
    out[o++] = ENCODE[((a & 3) << 4) | (b >> 4)];
    out[o++] = ENCODE[((b & 15) << 2) | (c >> 6)];
    out[o++] = ENCODE[c & 63];
  }
  const rest = n - i;
  if (rest === 1) {
    const a = input.charCodeAt(i);
    if (a > 0xff) throw invalidBinaryString();
    out[o++] = ENCODE[a >> 2];
    out[o++] = ENCODE[(a & 3) << 4];
    out[o++] = 61;
    out[o++] = 61;
  } else if (rest === 2) {
    const a = input.charCodeAt(i), b = input.charCodeAt(i + 1);
    if ((a | b) > 0xff) throw invalidBinaryString();
    out[o++] = ENCODE[a >> 2];
    out[o++] = ENCODE[((a & 3) << 4) | (b >> 4)];
    out[o++] = ENCODE[(b & 15) << 2];
    out[o++] = 61;
  }
  return fromCodes(out, o);
}

export function atob(data) {
  if (arguments.length === 0) {
    throw new TypeError("Failed to execute 'atob': 1 argument required, but only 0 present.");
  }
  const input = String(data);
  // Strip ASCII whitespace (TAB, LF, FF, CR, SPACE) and map to sextets in one pass; `=` is kept as 64 so the
  // padding rules below can see where it was.
  const sextets = new Uint8Array(input.length);
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) continue;
    if (code === 61) { sextets[n++] = 64; continue; }
    const v = code < 256 ? DECODE[code] : 255;
    if (v === 255) throw invalidBase64();
    sextets[n++] = v;
  }
  // A length that divides by four may end in one or two `=`; no other `=` is allowed.
  if (n % 4 === 0 && n > 0) {
    if (sextets[n - 1] === 64) n--;
    if (sextets[n - 1] === 64) n--;
  }
  if (n % 4 === 1) throw invalidBase64();
  for (let i = 0; i < n; i++) if (sextets[i] === 64) throw invalidBase64();

  const bytes = new Uint8Array((n * 3) >> 2);
  let o = 0;
  let i = 0;
  for (; i + 3 < n; i += 4) {
    const a = sextets[i], b = sextets[i + 1], c = sextets[i + 2], d = sextets[i + 3];
    bytes[o++] = (a << 2) | (b >> 4);
    bytes[o++] = ((b & 15) << 4) | (c >> 2);
    bytes[o++] = ((c & 3) << 6) | d;
  }
  const rest = n - i;
  if (rest === 2) {
    bytes[o++] = (sextets[i] << 2) | (sextets[i + 1] >> 4);
  } else if (rest === 3) {
    bytes[o++] = (sextets[i] << 2) | (sextets[i + 1] >> 4);
    bytes[o++] = ((sextets[i + 1] & 15) << 4) | (sextets[i + 2] >> 2);
  }
  return fromCodes(bytes, o);
}

function invalidBinaryString() {
  return new (globalThis.DOMException || DOMException)("The string to be encoded contains characters outside of the Latin1 range.", "InvalidCharacterError");
}

function invalidBase64() {
  return new (globalThis.DOMException || DOMException)("The string to be decoded is not correctly encoded.", "InvalidCharacterError");
}
