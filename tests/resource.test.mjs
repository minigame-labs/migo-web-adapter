// XMLHttpRequest and fetch over the three kinds of URL: the network, data: URLs, and the game package. A fake `migo` stands
// in for the runtime: `request` for the network, a file system manager over a map for the package.

import assert from "node:assert/strict";

const files = new Map([
  ["assets/tone.wav", new Uint8Array([82, 73, 70, 70, 1, 2, 3]).buffer],
  ["data/a b.json", new TextEncoder().encode('{"hello":"wörld"}').buffer],
  ["data/utf16.txt", new Uint8Array([0x68, 0, 0x69, 0, 0x2d, 0x4e]).buffer],
  ["/user/save.bin", new Uint8Array([9, 9]).buffer],
]);
const reads = [];
const requests = [];
let netResponse = { statusCode: 200, header: { "Content-Type": "text/plain; charset=utf-8", "X-Thing": "1" }, data: new TextEncoder().encode("net ok").buffer };

globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:," }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
  getFileSystemManager: () => ({
    readFile({ filePath, success, fail }) {
      reads.push(filePath);
      queueMicrotask(() => {
        if (files.has(filePath)) success({ data: files.get(filePath).slice(0) });
        else if (filePath.includes("forbidden")) fail({ errMsg: "readFile:fail Path not allowed: " + filePath });
        else fail({ errMsg: "readFile:fail Path resolution failed: " + filePath });
      });
    },
  }),
  request(options) {
    requests.push(options);
    let aborted = false;
    queueMicrotask(() => {
      if (aborted) return;
      if (options.url.includes("fail")) options.fail({ errMsg: "request:fail" });
      else options.success({ ...netResponse, data: netResponse.data.slice(0) });
    });
    return { abort() { aborted = true; } };
  },
};

await import("../src/index.js");
// Node has its own fetch, Response and AbortController, which the adapter leaves alone, so the adapter's are imported.
const { XMLHttpRequest } = globalThis;
const { fetch, Response, Request, Headers } = await import("../src/fetch.js");
const { AbortController } = await import("../src/abort.js");

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); } };

const xhr = (url, { type = "", method = "GET", body, setup } = {}) => new Promise((resolve) => {
  const x = new XMLHttpRequest();
  const events = [];
  for (const name of ["loadstart", "progress", "load", "error", "abort", "timeout", "loadend"]) x.addEventListener(name, () => events.push(name));
  x.onreadystatechange = () => events.push("rs" + x.readyState);
  x.open(method, url);
  x.responseType = type;
  if (setup) setup(x);
  x.onloadend = () => resolve({ x, events });
  x.send(body);
});

await test("XHR: a package file by relative path, as an arraybuffer", async () => {
  const { x, events } = await xhr("assets/tone.wav", { type: "arraybuffer" });
  assert.equal(x.status, 200);
  assert.equal(x.statusText, "OK");
  assert.deepEqual([...new Uint8Array(x.response)], [82, 73, 70, 70, 1, 2, 3]);
  assert.equal(x.getResponseHeader("Content-Type"), "audio/wav");
  assert.equal(x.getResponseHeader("content-length"), "7");
  assert.equal(x.responseURL, "assets/tone.wav");
  assert.deepEqual(events, ["rs1", "loadstart", "rs2", "rs3", "progress", "rs4", "load", "loadend"].filter((e) => e !== "rs1" || true));
});

await test("XHR: path forms all name the same file", async () => {
  reads.length = 0;
  for (const url of ["./assets/tone.wav", "/assets/tone.wav", "assets/tone.wav?v=3#frag", "assets/tone%2Ewav"]) {
    const { x } = await xhr(url, { type: "arraybuffer" });
    assert.equal(x.status, 200, url);
  }
  assert.deepEqual(reads, ["assets/tone.wav", "assets/tone.wav", "assets/tone.wav", "assets/tone.wav"]);
  const { x } = await xhr("/user/save.bin", { type: "arraybuffer" });
  assert.equal(x.status, 200, "the runtime's own roots keep their leading slash");
  assert.equal(reads.at(-1), "/user/save.bin");
});

await test("XHR: text, json, blob, charset", async () => {
  let r = await xhr("data/a b.json");
  assert.equal(r.x.responseText, '{"hello":"wörld"}');
  assert.equal(r.x.response, r.x.responseText);
  assert.equal(r.x.getResponseHeader("content-type"), "application/json");
  r = await xhr("data/a%20b.json", { type: "json" });
  assert.deepEqual(r.x.response, { hello: "wörld" });
  r = await xhr("data/a b.json", { type: "blob" });
  assert.equal(r.x.response.type, "application/json");
  assert.equal(await r.x.response.text(), '{"hello":"wörld"}');
  r = await xhr("data/utf16.txt", { setup: (x) => x.overrideMimeType("text/plain; charset=utf-16le") });
  assert.equal(r.x.responseText, "hi\u4e2d", "the charset the response is declared in decides how the text is read");
  r = await xhr("data/utf16.txt", { type: "json" });
  assert.equal(r.x.response, null, "invalid JSON is null");
});

await test("XHR: a missing file is a completed request with status 404", async () => {
  const { x, events } = await xhr("assets/missing.wav", { type: "arraybuffer" });
  assert.equal(x.status, 404);
  assert.equal(x.statusText, "Not Found");
  assert.ok(events.includes("load") && !events.includes("error"), events.join());
  assert.equal(x.response.byteLength, 0);
  const forbidden = await xhr("/forbidden/x");
  assert.equal(forbidden.x.status, 403);
});

await test("XHR: data URLs", async () => {
  let r = await xhr("data:text/plain;base64,aGVsbG8=");
  assert.equal(r.x.responseText, "hello");
  assert.equal(r.x.getResponseHeader("content-type"), "text/plain");
  r = await xhr("data:,a%20b%2Cc");
  assert.equal(r.x.responseText, "a b,c");
  r = await xhr("data:application/octet-stream;base64,AAEC", { type: "arraybuffer" });
  assert.deepEqual([...new Uint8Array(r.x.response)], [0, 1, 2]);
  r = await xhr("data:text/plain;base64,!!!");
  assert.ok(r.events.includes("error"), "an invalid data URL is a network error");
});

await test("XHR: the network, with headers and a body", async () => {
  requests.length = 0;
  const { x } = await xhr("https://example.com/api", {
    method: "POST", body: "x=1",
    setup: (r) => { r.setRequestHeader("X-A", "1"); r.setRequestHeader("x-a", "2"); },
  });
  assert.equal(x.status, 200);
  assert.equal(x.responseText, "net ok");
  assert.equal(x.getResponseHeader("X-THING"), "1");
  assert.equal(x.getAllResponseHeaders(), "content-type: text/plain; charset=utf-8\r\nx-thing: 1\r\n");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].header["X-A"], "1, 2", "repeated headers combine");
  assert.equal(requests[0].responseType, "arraybuffer");
  const failed = await xhr("https://example.com/fail");
  assert.equal(failed.x.status, 0);
  assert.ok(failed.events.includes("error") && !failed.events.includes("load"));
});

await test("XHR: abort, state errors, sync", async () => {
  const x = new XMLHttpRequest();
  assert.throws(() => x.send(), (e) => e.name === "InvalidStateError");
  assert.throws(() => x.setRequestHeader("a", "b"), (e) => e.name === "InvalidStateError");
  assert.throws(() => x.open("GET", "a", false), (e) => e.name === "InvalidAccessError");
  const events = [];
  x.open("GET", "assets/tone.wav");
  x.onabort = () => events.push("abort");
  x.onloadend = () => events.push("loadend");
  x.onload = () => events.push("load");
  x.send();
  x.abort();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["abort", "loadend"]);
  assert.equal(x.readyState, 0);
  assert.equal(x.status, 0);
});

await test("XHR: the constants", () => {
  assert.equal(XMLHttpRequest.DONE, 4);
  assert.equal(new XMLHttpRequest().LOADING, 3);
});

await test("fetch: package file, text, json, arrayBuffer, blob, headers", async () => {
  const res = await fetch("data/a b.json");
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.url, "data/a b.json");
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.equal("body" in res, false, "no ReadableStream body: streaming readers detect that and read the whole body");
  assert.deepEqual(await res.clone().json(), { hello: "wörld" });
  assert.equal(res.bodyUsed, false);
  assert.equal(await res.text(), '{"hello":"wörld"}');
  assert.equal(res.bodyUsed, true);
  await assert.rejects(res.text(), TypeError, "a body is read once");
  const wav = await fetch("assets/tone.wav");
  assert.equal((await wav.arrayBuffer()).byteLength, 7);
  assert.equal((await (await fetch("assets/tone.wav")).blob()).type, "audio/wav");
});

await test("fetch: 404 resolves, network failure rejects with TypeError", async () => {
  const missing = await fetch("assets/missing.wav");
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);
  assert.equal(missing.statusText, "Not Found");
  await assert.rejects(fetch("https://example.com/fail"), (e) => e instanceof TypeError && e.message === "Failed to fetch");
  const net = await fetch("https://example.com/x", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "Content-Type": "application/json" } });
  assert.equal(await net.text(), "net ok");
  assert.equal(requests.at(-1).method, "POST");
  assert.equal(requests.at(-1).header["content-type"], "application/json");
});

await test("fetch: data URL, Request object, abort", async () => {
  assert.equal(await (await fetch("data:text/plain,hi")).text(), "hi");
  assert.equal(await (await fetch(new Request("data:text/plain,req"))).text(), "req");
  const controller = new AbortController();
  const pending = fetch("assets/tone.wav", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e.name === "AbortError");
  const already = new AbortController();
  already.abort();
  await assert.rejects(fetch("assets/tone.wav", { signal: already.signal }), (e) => e.name === "AbortError");
});

await test("Headers, Response, Request", async () => {
  const h = new Headers({ "Content-Type": "a", "X-B": "1" });
  h.append("x-b", "2");
  assert.equal(h.get("X-B"), "1, 2");
  assert.deepEqual([...h], [["content-type", "a"], ["x-b", "1, 2"]], "iteration is sorted and lower-cased");
  assert.throws(() => h.get("bad name"), TypeError);
  const r = new Response("hi", { status: 201, statusText: "Created" });
  assert.equal(r.headers.get("content-type"), "text/plain;charset=UTF-8");
  assert.equal(r.ok, true);
  assert.equal(await r.text(), "hi");
  assert.throws(() => new Response("x", { status: 100 }), RangeError);
  assert.deepEqual(await Response.json({ a: 1 }).json(), { a: 1 });
  assert.throws(() => new Request("a", { method: "GET", body: "x" }), TypeError);
  const req = new Request("a", { method: "post", body: "x", headers: { a: "b" } });
  assert.equal(req.method, "POST");
  assert.equal(await req.text(), "x");
});

if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("resource tests: all passed");
