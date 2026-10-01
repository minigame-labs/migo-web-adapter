import assert from "node:assert/strict";
import { Blob, File } from "../src/blob.js";
import { AbortController, AbortSignal } from "../src/abort.js";

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); } };

await test("Blob: parts, size, type", async () => {
  const blob = new Blob(["a", new Uint8Array([98, 99]), new Uint16Array([0x6564]).buffer, new Blob(["f"])], { type: "Text/Plain" });
  assert.equal(blob.size, 6);
  assert.equal(blob.type, "text/plain", "the type is lower-cased");
  assert.equal(await blob.text(), "abcdef");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [97, 98, 99, 100, 101, 102]);
  assert.equal(new Blob([], { type: "café" }).type, "", "a type with a non-ASCII character is dropped");
  assert.equal(new Blob().size, 0);
  assert.throws(() => new Blob("abc"), TypeError, "a string is not a sequence of parts");
});

await test("Blob.slice follows Array.prototype.slice for ranges", async () => {
  const blob = new Blob(["abcdef"], { type: "x/y" });
  assert.equal(await blob.slice(1, 3).text(), "bc");
  assert.equal(await blob.slice(-2).text(), "ef");
  assert.equal(await blob.slice(4, 2).text(), "");
  assert.equal(await blob.slice(2, undefined, "a/b").text(), "cdef");
  assert.equal(blob.slice(0, 1, "a/b").type, "a/b");
  assert.equal(blob.slice(0, 1).type, "", "slice does not inherit the type");
});

await test("Blob copies what it is given, and hands out copies", async () => {
  const source = new Uint8Array([1, 2, 3]);
  const blob = new Blob([source]);
  source[0] = 9;
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  const out = new Uint8Array(await blob.arrayBuffer());
  out[0] = 7;
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
});

await test("File", () => {
  const file = new File(["x"], "a.txt", { type: "text/plain", lastModified: 5 });
  assert.equal(file.name, "a.txt");
  assert.equal(file.lastModified, 5);
  assert.equal(file.size, 1);
  assert.ok(file instanceof Blob);
});

await test("AbortController", () => {
  const controller = new AbortController();
  const seen = [];
  controller.signal.addEventListener("abort", () => seen.push("listener"));
  controller.signal.onabort = () => seen.push("onabort");
  assert.equal(controller.signal.aborted, false);
  controller.abort();
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason.name, "AbortError");
  assert.deepEqual(seen, ["onabort", "listener"]);
  controller.abort();
  assert.equal(seen.length, 2, "aborting twice fires once");
  assert.throws(() => controller.signal.throwIfAborted(), (e) => e.name === "AbortError");
  const custom = new AbortController();
  custom.abort("because");
  assert.equal(custom.signal.reason, "because");
});

await test("AbortSignal.abort and timeout", async () => {
  assert.equal(AbortSignal.abort().aborted, true);
  const signal = AbortSignal.timeout(5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, "TimeoutError");
});

if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("blob-abort tests: all passed");
