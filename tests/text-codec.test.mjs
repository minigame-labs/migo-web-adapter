// TextEncoder / TextDecoder against the platform's own (Node's are the WHATWG ones): hand-written cases, then a
// randomised differential run over valid and invalid byte sequences.

import assert from "node:assert/strict";
import { TextEncoder, TextDecoder } from "../src/text-codec.js";

let failed = 0;
const test = (name, fn) => { try { fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); } };

test("encode", () => {
  const enc = new TextEncoder();
  assert.equal(enc.encoding, "utf-8");
  assert.deepEqual([...enc.encode("")], []);
  assert.deepEqual([...enc.encode("aé中😀")], [0x61, 0xc3, 0xa9, 0xe4, 0xb8, 0xad, 0xf0, 0x9f, 0x98, 0x80]);
  assert.deepEqual([...enc.encode("\ud800")], [0xef, 0xbf, 0xbd], "a lone surrogate is U+FFFD");
  assert.deepEqual([...enc.encode()], [], "no argument is the empty string");
});

test("encodeInto stops before a code point that does not fit", () => {
  const enc = new TextEncoder();
  const buf = new Uint8Array(5);
  assert.deepEqual(enc.encodeInto("a中中", buf), { read: 2, written: 4 });
  assert.deepEqual([...buf.subarray(0, 4)], [0x61, 0xe4, 0xb8, 0xad]);
  const emoji = new Uint8Array(3);
  assert.deepEqual(enc.encodeInto("😀", emoji), { read: 0, written: 0 });
});

test("decode: labels, BOM, views", () => {
  assert.equal(new TextDecoder().encoding, "utf-8");
  assert.equal(new TextDecoder("UTF8").encoding, "utf-8");
  assert.equal(new TextDecoder("latin1").encoding, "windows-1252");
  assert.throws(() => new TextDecoder("klingon"), RangeError);
  assert.equal(new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), "a", "a leading BOM is dropped");
  assert.equal(new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), "﻿a");
  const buf = new Uint8Array([0, 0x68, 0x69, 0]).buffer;
  assert.equal(new TextDecoder().decode(new DataView(buf, 1, 2)), "hi", "a view's own window is decoded");
  assert.equal(new TextDecoder().decode(), "");
  assert.throws(() => new TextDecoder().decode("string"), TypeError);
});

test("decode: fatal", () => {
  assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])), TypeError);
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xe4, 0xb8, 0xad])), "中");
  assert.equal(new TextDecoder().decode(new Uint8Array([0xff, 0x61])), "�a", "not fatal: U+FFFD");
});

test("decode: streaming holds an incomplete sequence", () => {
  const d = new TextDecoder();
  assert.equal(d.decode(new Uint8Array([0xe4, 0xb8]), { stream: true }), "");
  assert.equal(d.decode(new Uint8Array([0xad, 0x61]), { stream: true }), "中a");
  assert.equal(d.decode(new Uint8Array([0xf0, 0x9f]), { stream: true }), "");
  assert.equal(d.decode(), "�", "the stream ended mid-sequence");
});

test("decode: utf-16le and windows-1252", () => {
  assert.equal(new TextDecoder("utf-16le").decode(new Uint8Array([0x61, 0, 0x2d, 0x4e])), "a中");
  assert.equal(new TextDecoder("windows-1252").decode(new Uint8Array([0x80, 0x41, 0xe9])), "€Aé");
});

test("decode: randomised differential run against the platform's decoder", () => {
  let seed = 0x1234567;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
  const pool = [0x00, 0x41, 0x7f, 0x80, 0xbf, 0xc0, 0xc2, 0xdf, 0xe0, 0xa0, 0xed, 0x9f, 0xa0, 0xef, 0xbb, 0xf0, 0x90, 0xf4, 0x8f, 0xf5, 0xff, 0xe4, 0xb8, 0xad, 0x98];
  for (let round = 0; round < 6000; round++) {
    const bytes = new Uint8Array(rnd() % 12);
    for (let i = 0; i < bytes.length; i++) bytes[i] = rnd() % 3 ? pool[rnd() % pool.length] : rnd() & 255;
    for (const ignoreBOM of [false, true]) {
      const want = new globalThis.TextDecoder("utf-8", { ignoreBOM }).decode(bytes);
      const got = new TextDecoder("utf-8", { ignoreBOM }).decode(bytes);
      assert.equal(got, want, JSON.stringify([...bytes]));
    }
    let wantFatal, gotFatal;
    try { wantFatal = new globalThis.TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { wantFatal = null; }
    try { gotFatal = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { gotFatal = null; }
    assert.equal(gotFatal, wantFatal, "fatal " + JSON.stringify([...bytes]));
    const text = new globalThis.TextDecoder().decode(bytes);
    assert.deepEqual([...new TextEncoder().encode(text)], [...new globalThis.TextEncoder().encode(text)]);
  }
});

if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("text-codec tests: all passed");
