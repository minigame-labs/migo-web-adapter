// ReadableStream (src/streams.js) and the bodies built on it (src/fetch.js): a body read as it arrives, and a body made
// of a stream -- the pair Godot's web loader uses for its .wasm and .pck, and three.js's FileLoader for progress.
import assert from "node:assert/strict";
import { ReadableStream, readAllBytes } from "../src/streams.js";
import { Response, Request } from "../src/fetch.js";
import { ProgressEvent } from "../src/events.js";

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); } };

await test("a stream of chunks from start(), read to the end", async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); } });
  const reader = stream.getReader();
  assert.equal(stream.locked, true);
  assert.deepEqual(await reader.read(), { value: new Uint8Array([1, 2]), done: false });
  assert.deepEqual(await reader.read(), { value: new Uint8Array([3]), done: false });
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
  await reader.closed;
  assert.throws(() => stream.getReader(), TypeError, "locked while a reader holds it");
  reader.releaseLock();
  assert.equal(stream.locked, false);
});

await test("pull() is asked for a chunk when a read is waiting, and its errors reach the reader", async () => {
  let n = 0;
  const stream = new ReadableStream({ pull(c) { n++; if (n <= 3) c.enqueue(n); else c.close(); } });
  const got = [];
  for await (const v of stream) got.push(v);
  assert.deepEqual(got, [1, 2, 3]);
  const broken = new ReadableStream({ pull() { throw new Error("source broke"); } });
  await assert.rejects(broken.getReader().read(), /source broke/);
  const errored = new ReadableStream({ start(c) { c.error(new TypeError("bad")); } });
  const reader = errored.getReader();
  await assert.rejects(reader.read(), TypeError);
  await assert.rejects(reader.closed, TypeError);
});

await test("tee gives every chunk to both branches, in order, whichever reads first", async () => {
  const [a, b] = new ReadableStream({ start(c) { c.enqueue("x"); c.enqueue("y"); c.close(); } }).tee();
  const fromA = []; for await (const v of a) fromA.push(v);
  const fromB = []; for await (const v of b) fromB.push(v);
  assert.deepEqual(fromA, ["x", "y"]);
  assert.deepEqual(fromB, ["x", "y"]);
});

await test("cancel runs the source's cancel and ends the stream", async () => {
  let reason = null;
  const stream = new ReadableStream({ start(c) { c.enqueue(1); }, cancel(r) { reason = r; } });
  await stream.cancel("enough");
  assert.equal(reason, "enough");
  assert.deepEqual(await stream.getReader().read(), { value: undefined, done: true });
});

await test("a Response's body is a stream of its bytes, and reading it uses the body", async () => {
  const res = new Response(new Uint8Array([7, 8, 9]));
  assert.equal(res.bodyUsed, false);
  const bytes = await readAllBytes(res.body);
  assert.deepEqual([...bytes], [7, 8, 9]);
  assert.equal(res.bodyUsed, true);
  await assert.rejects(res.arrayBuffer(), TypeError, "a body is read once");
  assert.equal(new Response(null).body, null, "a null body has no stream");
});

await test("a body asked for as a stream but never read is still read whole by arrayBuffer()", async () => {
  const res = new Response("hello");
  assert.ok(res.body instanceof ReadableStream);
  assert.equal(await res.text(), "hello");
  // A streamed body cloned is teed: both read every byte.
  const streamed = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); } }));
  const copy = streamed.clone();
  assert.deepEqual([...new Uint8Array(await copy.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual([...new Uint8Array(await streamed.arrayBuffer())], [1, 2, 3]);
  const req = new Request("https://example.com/", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([9])); c.close(); } }) });
  assert.deepEqual([...new Uint8Array(await req.clone().arrayBuffer())], [9]);
  assert.deepEqual([...new Uint8Array(await req.arrayBuffer())], [9]);
});

await test("Godot's shape: progress read from response.body, handed on as new Response(new ReadableStream(...))", async () => {
  const original = new Response(new Uint8Array(1000).fill(5), { headers: { "content-type": "application/wasm" } });
  let loaded = 0;
  const reader = original.body.getReader();
  const pump = (controller) => reader.read().then(({ value, done }) => {
    if (done) { controller.close(); return; }
    loaded += value.byteLength;
    controller.enqueue(value);
    return pump(controller);
  });
  const tracked = new Response(new ReadableStream({ start(controller) { return pump(controller); } }), { headers: original.headers });
  const buffer = await tracked.arrayBuffer();
  assert.equal(buffer.byteLength, 1000);
  assert.equal(loaded, 1000);
  assert.equal(new Uint8Array(buffer)[999], 5);
  assert.equal(tracked.headers.get("content-type"), "application/wasm");
});

await test("a Request whose body is a stream is read whole when sent", async () => {
  const req = new Request("https://example.com/up", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.enqueue(new Uint8Array([2])); c.close(); } }) });
  assert.deepEqual([...new Uint8Array(await req.arrayBuffer())], [1, 2]);
});

await test("ProgressEvent carries a load's progress", () => {
  const event = new ProgressEvent("progress", { lengthComputable: true, loaded: 10, total: 40 });
  assert.equal(event.type, "progress");
  assert.deepEqual([event.lengthComputable, event.loaded, event.total], [true, 10, 40]);
  assert.deepEqual([new ProgressEvent("load").lengthComputable, new ProgressEvent("load").loaded], [false, 0]);
});

if (failed) { console.log(`${failed} test(s) failed`); process.exit(1); }
