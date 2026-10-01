// atob / btoa and DOMException, against the HTML Standard's rules and against the platform's own implementation:
// Node's `atob`/`btoa` are the WHATWG ones, so a randomised differential run covers what a hand-written table misses.

import assert from "node:assert/strict";
import { atob, btoa } from "../src/base64.js";
import DOMException from "../src/dom-exception.js";

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); }
};
// The exception is the platform's DOMException when there is one (Node has it) and the adapter's otherwise, so what
// is checked is what content can observe either way: its name, its legacy code, and that it is an Error.
const throwsInvalidCharacter = (fn) => assert.throws(fn, (e) => e instanceof Error && e.name === "InvalidCharacterError" && e.code === 5);

test("btoa: the RFC 4648 vectors", () => {
  for (const [plain, encoded] of [["", ""], ["f", "Zg=="], ["fo", "Zm8="], ["foo", "Zm9v"], ["foob", "Zm9vYg=="], ["fooba", "Zm9vYmE="], ["foobar", "Zm9vYmFy"]]) {
    assert.equal(btoa(plain), encoded);
    assert.equal(atob(encoded), plain);
  }
});

test("btoa: converts its argument to a string, as WebIDL does", () => {
  assert.equal(btoa(null), "bnVsbA==");
  assert.equal(btoa(undefined), "dW5kZWZpbmVk");
  assert.equal(btoa(12), "MTI=");
});

test("btoa: a character above U+00FF is InvalidCharacterError, wherever it is", () => {
  throwsInvalidCharacter(() => btoa("Ā"));
  throwsInvalidCharacter(() => btoa("abĀ"));
  throwsInvalidCharacter(() => btoa("abc中"));
  throwsInvalidCharacter(() => btoa("abcd😀"));
  assert.equal(btoa("ÿ\u0000\u0080"), "/wCA");
});

test("atob and btoa with no argument are a TypeError, not a conversion of undefined", () => {
  assert.throws(() => atob(), TypeError);
  assert.throws(() => btoa(), TypeError);
});

test("atob: ASCII whitespace is ignored anywhere; other whitespace is not", () => {
  assert.equal(atob(" Z\tm\n9\fv\rYg = = "), "foob");
  throwsInvalidCharacter(() => atob("Zm9v "));
  throwsInvalidCharacter(() => atob("Zm9v\u000b"));
});

test("atob: padding may be absent, but never wrong", () => {
  assert.equal(atob("Zg"), "f");
  assert.equal(atob("Zm8"), "fo");
  assert.equal(atob("Zg=="), "f");
  for (const bad of ["Zg=", "Zg===", "Z", "Zm9vY", "=", "==", "====", "Zg==Zg==", "Z=g=", "=Zg=", "Zm9v=", "Zm9v===="]) {
    throwsInvalidCharacter(() => atob(bad));
  }
});

test("atob: discarded trailing bits are not checked", () => {
  assert.equal(atob("YR=="), "a");
  assert.equal(atob("Zm9=" ), "fo");
});

test("atob: characters outside the alphabet, the URL-safe alphabet included, are refused", () => {
  for (const bad of ["Zm9v-", "Zm9_", "Zm 9v!", "Zm9vĀ", "中文"]) throwsInvalidCharacter(() => atob(bad));
});

test("every byte value survives a round trip, and a large input does too (chunking)", () => {
  let all = "";
  for (let i = 0; i < 256; i++) all += String.fromCharCode(i);
  assert.equal(atob(btoa(all)), all);
  let big = "";
  for (let i = 0; i < 300000; i++) big += String.fromCharCode((i * 31 + (i >> 8)) & 255);
  const encoded = btoa(big);
  assert.equal(encoded.length, Math.ceil(300000 / 3) * 4);
  assert.equal(atob(encoded), big);
});

test("randomised differential run against the platform's atob/btoa", () => {
  if (typeof globalThis.atob !== "function") return;
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
  for (let round = 0; round < 4000; round++) {
    const len = rnd() % 40;
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(rnd() % 256);
    assert.equal(btoa(s), globalThis.btoa(s));
    // Mutate a valid encoding so that both accepted and refused inputs are compared.
    let e = globalThis.btoa(s);
    if (e.length && rnd() % 2) {
      const at = rnd() % e.length;
      const pool = "A=+/- \n\t_!ĀZg";
      e = e.slice(0, at) + pool[rnd() % pool.length] + (rnd() % 3 ? e.slice(at + 1) : e.slice(at));
    }
    let want, got;
    try { want = globalThis.atob(e); } catch { want = null; }
    try { got = atob(e); } catch { got = null; }
    assert.equal(got, want, `atob(${JSON.stringify(e)})`);
  }
});

test("DOMException: name, message, legacy code, constants, instanceof Error", () => {
  const e = new DOMException("nope", "NotSupportedError");
  assert.ok(e instanceof Error && e instanceof DOMException);
  assert.equal(e.name, "NotSupportedError");
  assert.equal(e.message, "nope");
  assert.equal(e.code, 9);
  assert.equal(DOMException.NOT_SUPPORTED_ERR, 9);
  assert.equal(e.NOT_SUPPORTED_ERR, 9);
  assert.equal(new DOMException().name, "Error");
  assert.equal(new DOMException("x", "SomethingElseError").code, 0);
  assert.equal(JSON.stringify(new DOMException("x", "AbortError")), "{}");
});

if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("base64 tests: all passed");
