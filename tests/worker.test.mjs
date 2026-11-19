// A Worker made from a script this adapter can read runs that script in a scope of its own (src/worker.js): the shape
// PixiJS v8 builds -- a blob: URL of inline source, `self.onmessage`, `self.postMessage(result, [transfer])` -- and the
// rest of a dedicated worker's contract.
import assert from "node:assert/strict";
import Worker from "../src/worker.js";
import { Blob } from "../src/blob.js";
import { createObjectURL, revokeObjectURL } from "../src/blob-url.js";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const nextMessage = (worker) => new Promise((resolve) => { worker.onmessage = (event) => resolve(event); });

// PixiJS's shape: inline source as a blob URL; the script answers through self.postMessage; a global (setTimeout)
// is the game's.
const pixiLike = `
  self.onmessage = async (event) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    self.postMessage({ uuid: event.data.uuid, data: event.data.data[0] * 2 }, []);
  };
`;
const url = createObjectURL(new Blob([pixiLike], { type: "application/javascript" }));
const worker = new Worker(url);
let sentSync = null;
worker.onmessage = (event) => { sentSync = event; };
worker.postMessage({ uuid: 7, data: [21] });
assert.equal(sentSync, null, "nothing arrives during the call that sent it");
const reply = await nextMessage(worker);
assert.deepEqual(reply.data, { uuid: 7, data: 42 });
assert.equal(reply.target, worker);

// Bare names reach the worker's scope: `onmessage = ...` and `postMessage(...)` written without `self`.
const bare = new Worker("data:text/javascript," + encodeURIComponent("onmessage = function (e) { postMessage(e.data + '!'); };"));
const bareReply = nextMessage(bare);
bare.postMessage("hi");
assert.equal((await bareReply).data, "hi!");
assert.equal(typeof globalThis.onmessage, "undefined", "the worker's onmessage is not the game's");

// addEventListener on both sides; the scope's own `self`.
const listened = new Worker("data:text/javascript," + encodeURIComponent("self.addEventListener('message', (e) => self.postMessage(self === this && e.data));"));
const heard = new Promise((resolve) => listened.addEventListener("message", (event) => resolve(event.data)));
listened.postMessage(5);
assert.equal(await heard, 5);

// An exception in the script is the worker's error event, not the caller's.
const thrower = new Worker("data:text/javascript," + encodeURIComponent("throw new Error('boom');"));
const failed = await new Promise((resolve) => { thrower.onerror = resolve; });
assert.match(failed.message, /boom/);

// importScripts runs another readable script in the same scope.
const lib = createObjectURL(new Blob(["self.double = (n) => n * 2;"]));
const importer = new Worker("data:text/javascript," + encodeURIComponent(`importScripts(${JSON.stringify(lib)}); onmessage = (e) => postMessage(double(e.data));`));
const imported = nextMessage(importer);
importer.postMessage(4);
assert.equal((await imported).data, 8);

// terminate() stops delivery both ways; close() inside the script does too.
const stopped = new Worker("data:text/javascript," + encodeURIComponent("onmessage = (e) => postMessage(e.data);"));
let after = 0;
stopped.onmessage = () => { after += 1; };
await tick();
stopped.terminate();
stopped.postMessage(1);
await tick();
assert.equal(after, 0, "nothing after terminate()");
const closer = new Worker("data:text/javascript," + encodeURIComponent("onmessage = (e) => { close(); postMessage('late'); };"));
let late = 0;
closer.onmessage = () => { late += 1; };
await tick();
closer.postMessage(0);
await tick();
assert.equal(late, 0, "nothing after close()");

// What cannot be read is an error event, never a throw from the constructor: a revoked blob, a network script, a module.
revokeObjectURL(url);
for (const [what, make] of [
  ["a revoked blob URL", () => new Worker(url)],
  ["a network script", () => new Worker("https://example.com/w.js")],
  ["a module worker", () => new Worker("data:text/javascript,", { type: "module" })],
]) {
  const refused = make();
  const event = await new Promise((resolve) => { refused.onerror = resolve; });
  assert.ok(event.message, what);
}

console.log("worker: PASS");
