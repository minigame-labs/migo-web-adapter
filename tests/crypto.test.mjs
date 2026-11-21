// crypto.getRandomValues / randomUUID (src/crypto.js): the ChaCha20 block function against RFC 8439's own vectors and,
// differentially, against OpenSSL's ChaCha20 (Node's); the fast-key-erasure generator against the block function; the
// Web Crypto contract (integer arrays only, 65536 bytes at most, the same array back); and the seeding: nothing answered
// before the platform's source has, a failed source said, no crypto published over one that exists.

import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { chachaBlock, keyWords, ChaChaGenerator, createCrypto, installCrypto, MAX_RANDOM_BYTES } from "../src/crypto.js";

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const unhex = (text) => new Uint8Array(Buffer.from(text.replace(/[\s:]/g, ""), "hex"));
const nonceWords = (bytes) => { const w = keyWords(new Uint8Array([...bytes, ...new Uint8Array(20)])); return w.subarray(0, 3); };

function block(keyBytes, counter, nonceBytes) {
  const out = new Uint8Array(64);
  chachaBlock(keyWords(keyBytes), counter, nonceWords(nonceBytes), out);
  return out;
}

// OpenSSL's "chacha20" takes a 16-byte IV: the 32-bit block counter (little-endian), then the 96-bit nonce.
function opensslKeystream(keyBytes, counter, nonceBytes, length) {
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(counter >>> 0, 0);
  Buffer.from(nonceBytes).copy(iv, 4);
  const cipher = nodeCrypto.createCipheriv("chacha20", Buffer.from(keyBytes), iv);
  return new Uint8Array(Buffer.concat([cipher.update(Buffer.alloc(length)), cipher.final()]));
}

test("RFC 8439 2.3.2: the block function's test vector", () => {
  const key = unhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  const nonce = unhex("000000090000004a00000000");
  assert.equal(hex(block(key, 1, nonce)),
    "10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e" +
    "d2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e");
});

test("RFC 8439 A.1: block function test vectors 1 and 2 (zero key and nonce, counters 0 and 1)", () => {
  const zeroKey = new Uint8Array(32), zeroNonce = new Uint8Array(12);
  assert.equal(hex(block(zeroKey, 0, zeroNonce)),
    "76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7" +
    "da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586");
  assert.equal(hex(block(zeroKey, 1, zeroNonce)),
    "9f07e7be5551387a98ba977c732d080dcb0f29a048e3656912c6533e32ee7aed" +
    "29b721769ce64e43d57133b074d839d531ed1f28510afb45ace10a1f4b794d6f");
});

test("the block function agrees with OpenSSL's ChaCha20 over 200 random keys, counters and nonces", () => {
  for (let i = 0; i < 200; i++) {
    const key = new Uint8Array(nodeCrypto.randomBytes(32));
    const nonce = new Uint8Array(nodeCrypto.randomBytes(12));
    // Counters near the top of the 32-bit range included: the counter word is added as an unsigned 32-bit number.
    const counter = i < 100 ? nodeCrypto.randomInt(0, 2 ** 31) : 0xffffffff - (i - 100);
    assert.equal(hex(block(key, counter, nonce)), hex(opensslKeystream(key, counter, nonce, 64)), `key ${hex(key)} counter ${counter}`);
  }
});

test("the generator hands out the keystream after its first 32 bytes, and those 32 bytes are its next key", () => {
  const seed = new Uint8Array(nodeCrypto.randomBytes(32));
  const generator = new ChaChaGenerator(seed.slice());
  for (const length of [0, 1, 31, 32, 33, 63, 64, 65, 1000, MAX_RANDOM_BYTES]) {
    const out = generator.fill(new Uint8Array(length));
    const stream = opensslKeystream(seed, 0, new Uint8Array(12), 32 + length);
    assert.equal(hex(out), hex(stream.subarray(32)), `${length} bytes`);
    seed.set(stream.subarray(0, 32));
  }
});

test("two fills from one key differ, and no 16-byte block of a megabyte repeats", () => {
  const generator = new ChaChaGenerator(new Uint8Array(32));
  assert.notEqual(hex(generator.fill(new Uint8Array(32))), hex(generator.fill(new Uint8Array(32))));
  const seen = new Set();
  let ones = 0;
  for (let n = 0; n < 16; n++) {
    const out = generator.fill(new Uint8Array(MAX_RANDOM_BYTES));
    for (let i = 0; i < out.length; i += 16) seen.add(hex(out.subarray(i, i + 16)));
    for (const byte of out) { let b = byte; while (b) { ones += b & 1; b >>= 1; } }
  }
  assert.equal(seen.size, 16 * MAX_RANDOM_BYTES / 16);
  const bits = 16 * MAX_RANDOM_BYTES * 8, share = ones / bits;
  assert.ok(Math.abs(share - 0.5) < 0.001, `one bits are ${share} of the output`);
});

// A platform source that answers on a microtask, as the runtime's wrapAsync does.
function platform({ fail = null, length = 32 } = {}) {
  const asked = [];
  return {
    asked,
    getUserCryptoManager: () => ({
      getRandomValues(options) {
        asked.push(options.length);
        queueMicrotask(() => {
          if (fail) options.fail({ errMsg: fail });
          else options.success({ errMsg: "getRandomValues:ok", randomValues: new Uint8Array(nodeCrypto.randomBytes(length)).buffer });
        });
      },
    }),
  };
}

test("installCrypto asks the platform for 32 bytes and answers nothing before they arrive", async () => {
  const source = platform();
  const { crypto } = installCrypto({}, source);
  assert.deepEqual(source.asked, [32]);
  assert.throws(() => crypto.getRandomValues(new Uint8Array(4)), (e) => e.name === "InvalidStateError" && e.code === 11);
  await Promise.resolve();
  const out = new Uint8Array(4096);
  assert.equal(crypto.getRandomValues(out), out, "the same array back");
  assert.ok(out.some((b) => b !== 0));
});

test("every integer typed array is filled, through its own window of its buffer", async () => {
  const source = platform();
  const { crypto } = installCrypto({}, source);
  await Promise.resolve();
  for (const Type of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, BigInt64Array, BigUint64Array]) {
    const buffer = new ArrayBuffer(Type.BYTES_PER_ELEMENT * 64);
    const view = new Type(buffer, Type.BYTES_PER_ELEMENT * 8, 32);
    assert.equal(crypto.getRandomValues(view), view);
    const bytes = new Uint8Array(buffer);
    assert.ok(bytes.subarray(0, Type.BYTES_PER_ELEMENT * 8).every((b) => b === 0), `${Type.name}: nothing before the view`);
    assert.ok(bytes.subarray(Type.BYTES_PER_ELEMENT * 40).every((b) => b === 0), `${Type.name}: nothing after the view`);
    assert.ok(bytes.subarray(Type.BYTES_PER_ELEMENT * 8, Type.BYTES_PER_ELEMENT * 40).some((b) => b !== 0), `${Type.name}: filled`);
  }
  assert.equal(crypto.getRandomValues(new Uint8Array(0)).length, 0, "an empty array is fine");
});

test("what the Web Crypto API refuses: not a view, not an integer array, over 65536 bytes", async () => {
  const source = platform();
  const { crypto } = installCrypto({}, source);
  await Promise.resolve();
  for (const bad of [undefined, null, 4, [1, 2], new ArrayBuffer(8)]) {
    assert.throws(() => crypto.getRandomValues(bad), TypeError);
  }
  for (const [view, name] of [[new Float32Array(4), "Float32Array"], [new Float64Array(4), "Float64Array"], [new DataView(new ArrayBuffer(4)), "DataView"]]) {
    assert.throws(() => crypto.getRandomValues(view), (e) => e.name === "TypeMismatchError" && e.code === 17 && e.message.includes(name));
  }
  // A plain object that says it is a Uint8Array is not one.
  const pretender = { [Symbol.toStringTag]: "Uint8Array", buffer: new ArrayBuffer(4), byteOffset: 0, byteLength: 4 };
  assert.throws(() => crypto.getRandomValues(pretender), TypeError);
  assert.throws(() => crypto.getRandomValues(new Uint8Array(MAX_RANDOM_BYTES + 1)), (e) => e.name === "QuotaExceededError" && e.code === 22);
  assert.throws(() => crypto.getRandomValues(new Uint32Array(MAX_RANDOM_BYTES / 4 + 1)), (e) => e.name === "QuotaExceededError");
  assert.equal(crypto.getRandomValues(new Uint8Array(MAX_RANDOM_BYTES)).length, MAX_RANDOM_BYTES);
  // Refusals come first, as a browser's do: a refused call does not wait on the key.
  const early = installCrypto({}, platform()).crypto;
  assert.throws(() => early.getRandomValues(new Float32Array(1)), (e) => e.name === "TypeMismatchError");
});

test("randomUUID is a version 4 UUID, lower-case, and does not repeat", async () => {
  const source = platform();
  const { crypto, Crypto } = installCrypto({}, source);
  await Promise.resolve();
  const seen = new Set();
  for (let i = 0; i < 10000; i++) {
    const id = crypto.randomUUID();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 10000);
  assert.ok(crypto instanceof Crypto);
  assert.equal(Object.prototype.toString.call(crypto), "[object Crypto]");
});

test("a platform source that fails is said on every call", async () => {
  const { crypto } = installCrypto({}, platform({ fail: "getRandomValues:fail system error" }));
  await Promise.resolve();
  assert.throws(() => crypto.getRandomValues(new Uint8Array(4)), (e) => e.name === "OperationError" && e.message.includes("system error"));
  const short = installCrypto({}, platform({ length: 16 })).crypto;
  await Promise.resolve();
  assert.throws(() => short.getRandomValues(new Uint8Array(4)), (e) => e.name === "OperationError" && e.message.includes("16 bytes"));
  const throwing = createCrypto(() => { throw new Error("no source here"); }).crypto;
  assert.throws(() => throwing.getRandomValues(new Uint8Array(4)), (e) => e.name === "OperationError" && e.message.includes("no source here"));
});

test("nothing is published over a crypto that has getRandomValues, or without a platform source", () => {
  assert.equal(installCrypto({ crypto: { getRandomValues() {} } }, platform()), null);
  assert.equal(installCrypto({}, undefined), null);
  assert.equal(installCrypto({}, {}), null);
  // Node has a crypto of its own: the adapter's entry point must leave it alone.
  assert.equal(installCrypto(globalThis, platform()), null);
});

test("two generators keyed alike agree; keyed differently, they do not", async () => {
  const seed = new Uint8Array(nodeCrypto.randomBytes(32));
  const a = createCrypto((onSeed) => onSeed(seed.slice())).crypto;
  const b = createCrypto((onSeed) => onSeed(seed.slice())).crypto;
  const c = createCrypto((onSeed) => onSeed(new Uint8Array(nodeCrypto.randomBytes(32)))).crypto;
  const draw = (x) => hex(x.getRandomValues(new Uint8Array(64)));
  const first = draw(a);
  assert.equal(first, draw(b));
  assert.notEqual(first, draw(c));
  assert.notEqual(first, draw(a), "the next draw is a new key's");
});

for (const [name, fn] of tests) {
  try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); }
}
if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log("CRYPTO TEST PASSED");
