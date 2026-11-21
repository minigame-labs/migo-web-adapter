// crypto -- the random half of the Web Crypto API: `crypto.getRandomValues` and `crypto.randomUUID`, which content calls
// synchronously. Emscripten fills `/dev/urandom` and `getentropy()` from it (Godot's mbedTLS takes its entropy there,
// and with no source it logs "Failed to initialize psa crypto. The mbedTLS modules will not work."); uuid and nanoid
// call it for every id.
//
// The platform's random source is asynchronous only: UserCryptoManager.getRandomValues answers through a success
// callback. So the adapter keeps a generator of its own, keyed from 32 bytes of that source, asked for when the
// adapter loads and answered before the game's next task. The generator is ChaCha20 (RFC 8439's block function) with
// fast key erasure: every call draws one keystream and takes its first 32 bytes as the next key before handing out
// the rest, so the state left behind after a call cannot reproduce anything that call returned. 256 bits of the
// operating system's entropy, as the platform's source gives them, are as much as the construction can use; nothing
// is mixed in from clocks or Math.random.
//
// Asked before the key has arrived -- only possible in the same task as the adapter's own load -- getRandomValues
// throws InvalidStateError rather than hand out bytes that are not cryptographically secure. A platform source that
// failed makes every call throw OperationError, naming why. Where the platform has no random source at all, no
// `crypto` is published: a game that feature-tests finds none, as it would without the adapter.
//
// `crypto.subtle` is not provided.

import DOMException from "./dom-exception.js";

/// The most bytes one getRandomValues call may fill, as the Web Crypto API says.
export const MAX_RANDOM_BYTES = 65536;

const SIGMA0 = 0x61707865, SIGMA1 = 0x3320646e, SIGMA2 = 0x79622d32, SIGMA3 = 0x6b206574; // "expand 32-byte k"
const ZERO_NONCE = new Uint32Array(3);

/// RFC 8439 section 2.3: the ChaCha20 block for `key` (eight little-endian words), the 32-bit block `counter` and
/// `nonce` (three words), written as 64 bytes into `out` at `offset`.
export function chachaBlock(key, counter, nonce, out, offset = 0) {
  const k0 = key[0] | 0, k1 = key[1] | 0, k2 = key[2] | 0, k3 = key[3] | 0;
  const k4 = key[4] | 0, k5 = key[5] | 0, k6 = key[6] | 0, k7 = key[7] | 0;
  const c = counter | 0, n0 = nonce[0] | 0, n1 = nonce[1] | 0, n2 = nonce[2] | 0;
  let x0 = SIGMA0, x1 = SIGMA1, x2 = SIGMA2, x3 = SIGMA3;
  let x4 = k0, x5 = k1, x6 = k2, x7 = k3, x8 = k4, x9 = k5, x10 = k6, x11 = k7;
  let x12 = c, x13 = n0, x14 = n1, x15 = n2;
  for (let round = 0; round < 10; round++) {
    // Column round.
    x0 = (x0 + x4) | 0; x12 ^= x0; x12 = (x12 << 16) | (x12 >>> 16);
    x8 = (x8 + x12) | 0; x4 ^= x8; x4 = (x4 << 12) | (x4 >>> 20);
    x0 = (x0 + x4) | 0; x12 ^= x0; x12 = (x12 << 8) | (x12 >>> 24);
    x8 = (x8 + x12) | 0; x4 ^= x8; x4 = (x4 << 7) | (x4 >>> 25);
    x1 = (x1 + x5) | 0; x13 ^= x1; x13 = (x13 << 16) | (x13 >>> 16);
    x9 = (x9 + x13) | 0; x5 ^= x9; x5 = (x5 << 12) | (x5 >>> 20);
    x1 = (x1 + x5) | 0; x13 ^= x1; x13 = (x13 << 8) | (x13 >>> 24);
    x9 = (x9 + x13) | 0; x5 ^= x9; x5 = (x5 << 7) | (x5 >>> 25);
    x2 = (x2 + x6) | 0; x14 ^= x2; x14 = (x14 << 16) | (x14 >>> 16);
    x10 = (x10 + x14) | 0; x6 ^= x10; x6 = (x6 << 12) | (x6 >>> 20);
    x2 = (x2 + x6) | 0; x14 ^= x2; x14 = (x14 << 8) | (x14 >>> 24);
    x10 = (x10 + x14) | 0; x6 ^= x10; x6 = (x6 << 7) | (x6 >>> 25);
    x3 = (x3 + x7) | 0; x15 ^= x3; x15 = (x15 << 16) | (x15 >>> 16);
    x11 = (x11 + x15) | 0; x7 ^= x11; x7 = (x7 << 12) | (x7 >>> 20);
    x3 = (x3 + x7) | 0; x15 ^= x3; x15 = (x15 << 8) | (x15 >>> 24);
    x11 = (x11 + x15) | 0; x7 ^= x11; x7 = (x7 << 7) | (x7 >>> 25);
    // Diagonal round.
    x0 = (x0 + x5) | 0; x15 ^= x0; x15 = (x15 << 16) | (x15 >>> 16);
    x10 = (x10 + x15) | 0; x5 ^= x10; x5 = (x5 << 12) | (x5 >>> 20);
    x0 = (x0 + x5) | 0; x15 ^= x0; x15 = (x15 << 8) | (x15 >>> 24);
    x10 = (x10 + x15) | 0; x5 ^= x10; x5 = (x5 << 7) | (x5 >>> 25);
    x1 = (x1 + x6) | 0; x12 ^= x1; x12 = (x12 << 16) | (x12 >>> 16);
    x11 = (x11 + x12) | 0; x6 ^= x11; x6 = (x6 << 12) | (x6 >>> 20);
    x1 = (x1 + x6) | 0; x12 ^= x1; x12 = (x12 << 8) | (x12 >>> 24);
    x11 = (x11 + x12) | 0; x6 ^= x11; x6 = (x6 << 7) | (x6 >>> 25);
    x2 = (x2 + x7) | 0; x13 ^= x2; x13 = (x13 << 16) | (x13 >>> 16);
    x8 = (x8 + x13) | 0; x7 ^= x8; x7 = (x7 << 12) | (x7 >>> 20);
    x2 = (x2 + x7) | 0; x13 ^= x2; x13 = (x13 << 8) | (x13 >>> 24);
    x8 = (x8 + x13) | 0; x7 ^= x8; x7 = (x7 << 7) | (x7 >>> 25);
    x3 = (x3 + x4) | 0; x14 ^= x3; x14 = (x14 << 16) | (x14 >>> 16);
    x9 = (x9 + x14) | 0; x4 ^= x9; x4 = (x4 << 12) | (x4 >>> 20);
    x3 = (x3 + x4) | 0; x14 ^= x3; x14 = (x14 << 8) | (x14 >>> 24);
    x9 = (x9 + x14) | 0; x4 ^= x9; x4 = (x4 << 7) | (x4 >>> 25);
  }
  const words = [
    x0 + SIGMA0, x1 + SIGMA1, x2 + SIGMA2, x3 + SIGMA3,
    x4 + k0, x5 + k1, x6 + k2, x7 + k3, x8 + k4, x9 + k5, x10 + k6, x11 + k7,
    x12 + c, x13 + n0, x14 + n1, x15 + n2,
  ];
  for (let i = 0; i < 16; i++) {
    const w = words[i], at = offset + i * 4;
    out[at] = w; out[at + 1] = w >>> 8; out[at + 2] = w >>> 16; out[at + 3] = w >>> 24;
  }
}

/// Eight little-endian words from 32 bytes of `bytes` at `offset`.
export function keyWords(bytes, offset = 0) {
  const key = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    const at = offset + i * 4;
    key[i] = (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  }
  return key;
}

/// ChaCha20 with fast key erasure, keyed by 32 bytes.
export class ChaChaGenerator {
  constructor(seed) {
    if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new TypeError("the key is 32 bytes");
    this._key = keyWords(seed);
  }

  /// Fill `bytes` (a Uint8Array) and move to a new key: the keystream's first 32 bytes, which are not handed out.
  fill(bytes) {
    const blocks = Math.ceil((bytes.length + 32) / 64);
    const stream = new Uint8Array(blocks * 64);
    for (let i = 0; i < blocks; i++) chachaBlock(this._key, i, ZERO_NONCE, stream, i * 64);
    this._key.set(keyWords(stream, 0));
    bytes.set(stream.subarray(32, 32 + bytes.length));
    stream.fill(0);
    return bytes;
  }
}

// [[TypedArrayName]], read the way the specification reads it: through %TypedArray%.prototype's @@toStringTag
// getter, which answers undefined for anything that is not a typed array, whatever it claims to be.
const typedArrayName = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get;
const INTEGER_ARRAYS = new Set([
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "BigInt64Array", "BigUint64Array",
]);

/// A `crypto` object whose generator is keyed by `requestSeed(onSeed, onFail)`: `onSeed` takes 32 bytes, `onFail` a
/// reason. Nothing is answered before `onSeed` has been called.
export function createCrypto(requestSeed) {
  let generator = null;
  let failure = null;
  const failed = (reason) => {
    if (!generator) failure = String(reason || "the platform's random source failed");
  };
  try {
    requestSeed((bytes) => {
      const seed = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      if (seed.length !== 32) return failed(`the platform's random source answered ${seed.length} bytes, not 32`);
      generator = new ChaChaGenerator(seed);
      seed.fill(0);
    }, failed);
  } catch (e) {
    failed(e && e.message || e);
  }

  class Crypto {
    getRandomValues(array) {
      const name = ArrayBuffer.isView(array) ? typedArrayName.call(array) : undefined;
      if (!ArrayBuffer.isView(array)) {
        throw new TypeError("Failed to execute 'getRandomValues' on 'Crypto': parameter 1 is not of type 'ArrayBufferView'.");
      }
      if (!INTEGER_ARRAYS.has(name)) {
        throw new DOMException(
          `Failed to execute 'getRandomValues' on 'Crypto': The provided ArrayBufferView is of type '${name || "DataView"}', which is not an integer array type.`,
          "TypeMismatchError");
      }
      if (array.byteLength > MAX_RANDOM_BYTES) {
        throw new DOMException(
          `Failed to execute 'getRandomValues' on 'Crypto': The ArrayBufferView's byte length (${array.byteLength}) exceeds the number of bytes of entropy available via this API (${MAX_RANDOM_BYTES}).`,
          "QuotaExceededError");
      }
      if (!generator) {
        if (failure) throw new DOMException(`crypto.getRandomValues: ${failure}`, "OperationError");
        throw new DOMException(
          "crypto.getRandomValues: the platform's random source has not answered yet; it answers before the game's next task after the adapter loads",
          "InvalidStateError");
      }
      generator.fill(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      return array;
    }

    /// RFC 9562 version 4: 122 random bits, the version and variant set, lower-case hexadecimal.
    randomUUID() {
      const b = this.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      let hex = "";
      for (let i = 0; i < 16; i++) {
        hex += (b[i] < 16 ? "0" : "") + b[i].toString(16);
        if (i === 3 || i === 5 || i === 7 || i === 9) hex += "-";
      }
      return hex;
    }

    get [Symbol.toStringTag]() { return "Crypto"; }
  }

  return { crypto: new Crypto(), Crypto };
}

/// The `crypto` and `Crypto` to publish on `target`, keyed from the platform's UserCryptoManager; null when `target`
/// has a crypto with getRandomValues already, or the platform has no random source.
export function installCrypto(target, platform = typeof migo !== "undefined" ? migo : undefined) {
  if (target.crypto && typeof target.crypto.getRandomValues === "function") return null;
  const manager = platform && typeof platform.getUserCryptoManager === "function" ? platform.getUserCryptoManager() : null;
  if (!manager || typeof manager.getRandomValues !== "function") return null;
  return createCrypto((onSeed, onFail) => {
    manager.getRandomValues({
      length: 32,
      success: (res) => onSeed(new Uint8Array(res && res.randomValues || 0)),
      fail: (res) => onFail(res && res.errMsg),
    });
  });
}
