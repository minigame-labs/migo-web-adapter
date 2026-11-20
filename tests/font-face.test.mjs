// FontFace and document.fonts over `migo.loadFont` (src/font-face.js): the shape PixiJS v8's web-font loader uses --
// `new FontFace(name, "url(" + encodeURI(url) + ")")`, `await face.load()`, `document.fonts.add(face)` -- and the rest
// of the CSS Font Loading API a game reaches for. A fake `migo` stands in for the runtime: `loadFont` records what it
// was asked to register, a file system manager over a map holds the temporary files, `request` is the network.

import assert from "node:assert/strict";

const registered = [];
const written = new Map();
const unlinked = [];
const requests = [];
// Paths the fake runtime refuses, as it refuses a file that is not a font.
const notFonts = new Set(["fonts/broken.woff2"]);

globalThis.migo = {
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ platform: "android", system: "Android 14", language: "en", version: "1.0.0", screenWidth: 390, screenHeight: 844, pixelRatio: 3 }),
  onWindowResize: () => {},
  createImage: () => ({}),
  createCanvas: () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:," }),
  onTouchStart: () => {}, onTouchMove: () => {}, onTouchEnd: () => {}, onTouchCancel: () => {},
  env: { USER_DATA_PATH: "/user", TEMP_PATH: "/tmp" },
  loadFont(path, family) {
    const bytes = written.get(path);
    registered.push({ path, family, bytes: bytes && [...new Uint8Array(bytes)] });
    if (notFonts.has(path) || (bytes && new Uint8Array(bytes)[0] === 0xff)) return null;
    return family;
  },
  getFileSystemManager: () => ({
    writeFileSync(path, data) { written.set(path, data.slice(0)); },
    unlinkSync(path) { unlinked.push(path); written.delete(path); },
    readFile({ fail }) { queueMicrotask(() => fail({ errMsg: "readFile:fail" })); },
  }),
  request(options) {
    requests.push(options);
    queueMicrotask(() => {
      if (options.url.includes("missing")) options.success({ statusCode: 404, header: {}, data: new ArrayBuffer(0) });
      else options.success({ statusCode: 200, header: { "Content-Type": "font/woff2" }, data: new Uint8Array([0x77, 0x4f, 0x46, 0x32]).buffer });
    });
    return { abort() {} };
  },
};

await import("../src/index.js");
const { FontFace, FontFaceSet, FontFaceSetLoadEvent, document } = globalThis;
const { sourceUrls, shorthandFamilies } = await import("../src/font-face.js");

let failed = 0;
const test = async (name, fn) => {
  registered.length = 0; requests.length = 0; unlinked.length = 0;
  try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + (e && e.stack || e)); }
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

await test("the API is installed: FontFace, FontFaceSet, and the document's set", () => {
  assert.equal(typeof FontFace, "function");
  assert.equal(typeof FontFaceSetLoadEvent, "function");
  assert.ok(document.fonts instanceof FontFaceSet);
  assert.equal(document.fonts.status, "loaded");
});

await test("PixiJS's shape: a URL on the game's origin is registered by its package path, nothing copied", async () => {
  const url = "https://game/assets/fonts/Bungee Regular.woff2";
  const face = new FontFace("Bungee", `url(${encodeURI(url)})`, { weight: "normal", style: "normal" });
  assert.equal(face.status, "unloaded");
  assert.equal(registered.length, 0, "nothing is loaded before load()");
  const loading = face.load();
  assert.equal(face.status, "loading");
  assert.equal(face.load(), loading, "a second load() is the same promise");
  assert.equal(await loading, face);
  assert.equal(face.status, "loaded");
  assert.deepEqual(registered.map((r) => [r.path, r.family]), [["assets/fonts/Bungee Regular.woff2", "Bungee"]]);
  assert.equal(written.size, 0);
  document.fonts.add(face);
  assert.ok(document.fonts.has(face));
  assert.equal(document.fonts.check("16px Bungee"), true);
  document.fonts.delete(face);
});

await test("a quoted family and a relative URL with a format hint", async () => {
  const face = new FontFace(" 'My Font' ", 'url("fonts/a b.ttf") format("truetype")');
  assert.equal(face.family, "My Font");
  await face.load();
  assert.deepEqual(registered.map((r) => [r.path, r.family]), [["fonts/a b.ttf", "My Font"]]);
});

await test("the sources are tried in order: the first that registers wins", async () => {
  const face = new FontFace("Fallback", "local(Fallback), url(fonts/broken.woff2) format('woff2'), url(fonts/good.woff)");
  await face.load();
  assert.deepEqual(registered.map((r) => r.path), ["fonts/broken.woff2", "fonts/good.woff"]);
});

await test("no source registers: status error, a NetworkError, and the same rejected promise after", async () => {
  const face = new FontFace("Broken", "url(fonts/broken.woff2)");
  await assert.rejects(face.load(), (e) => e.name === "NetworkError");
  assert.equal(face.status, "error");
  await assert.rejects(face.load(), (e) => e.name === "NetworkError");
  assert.equal(registered.length, 1, "a failed face is not retried");
});

await test("a src that is not a source list is a SyntaxError at construction", async () => {
  const face = new FontFace("Bad", "fonts/a.ttf");
  assert.equal(face.status, "error");
  await assert.rejects(face.loaded, (e) => e.name === "SyntaxError");
  assert.equal(registered.length, 0);
});

await test("bytes: loading starts at construction, through a temporary file that is removed after", async () => {
  const bytes = new Uint8Array([0x00, 0x01, 0x00, 0x00, 7, 7]);
  const face = new FontFace("FromBytes", bytes.subarray(0, 4));
  assert.equal(face.status, "loading");
  assert.equal(await face.loaded, face);
  assert.equal(face.status, "loaded");
  assert.equal(registered.length, 1);
  assert.match(registered[0].path, /^\/tmp\/migo-font-face-\d+\.font$/);
  assert.equal(registered[0].family, "FromBytes");
  assert.deepEqual(registered[0].bytes, [0x00, 0x01, 0x00, 0x00], "only the view's bytes are written");
  assert.deepEqual(unlinked, [registered[0].path]);
  assert.equal(written.size, 0);
});

await test("bytes that are not a font: a SyntaxError", async () => {
  // The fake runtime refuses bytes starting with 0xFF, as the engine refuses data that is no font.
  const face = new FontFace("NotAFont", new Uint8Array([0xff, 0, 0, 0]).buffer);
  await assert.rejects(face.loaded, (e) => e.name === "SyntaxError");
  assert.equal(face.status, "error");
  assert.equal(written.size, 0, "the temporary file is removed on failure too");
});

await test("a network URL is fetched as bytes, then registered from a temporary file", async () => {
  const face = new FontFace("Remote", "url(https://cdn.example.com/f.woff2)");
  await face.load();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://cdn.example.com/f.woff2");
  assert.equal(requests[0].responseType, "arraybuffer");
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].bytes, [0x77, 0x4f, 0x46, 0x32]);
  const missing = new FontFace("Missing", "url(https://cdn.example.com/missing.woff2)");
  await assert.rejects(missing.load(), (e) => e.name === "NetworkError");
});

await test("the set's loading events and ready promise follow its faces", async () => {
  const set = new FontFaceSet();
  const events = [];
  set.addEventListener("loading", (e) => events.push(["loading", e.fontfaces.length]));
  set.onloadingdone = (e) => events.push(["done", e.fontfaces.map((f) => f.family)]);
  set.addEventListener("loadingerror", (e) => events.push(["error", e.fontfaces.map((f) => f.family)]));
  const good = new FontFace("Good", "url(fonts/good.woff)");
  const bad = new FontFace("Bad", "url(fonts/broken.woff2)");
  set.add(good).add(bad);
  assert.equal(set.size, 2);
  assert.equal(await set.ready, set, "nothing loading: ready is resolved");
  good.load();
  bad.load().catch(() => {});
  assert.equal(set.status, "loading");
  const ready = set.ready;
  let resolved = false;
  ready.then(() => { resolved = true; });
  await tick();
  assert.equal(await ready, set);
  assert.ok(resolved);
  assert.equal(set.status, "loaded");
  assert.deepEqual(events, [["loading", 0], ["done", ["Good"]], ["error", ["Bad"]]]);
  assert.deepEqual(new FontFaceSetLoadEvent("loadingdone").fontfaces, []);
});

await test("a face already loading when it is added makes the set loading", async () => {
  const set = new FontFaceSet();
  const face = new FontFace("Late", new Uint8Array([1, 2, 3, 4]));
  set.add(face);
  assert.equal(set.status, "loading");
  await set.ready;
  assert.equal(set.status, "loaded");
});

await test("load(font) loads the faces the shorthand names; check(font) says whether a load is needed", async () => {
  const set = new FontFaceSet();
  const a = new FontFace("Title Font", "url(fonts/title.woff2)");
  const b = new FontFace("Other", "url(fonts/other.woff2)");
  set.add(a); set.add(b);
  assert.equal(set.check("bold 16px/1.2 'Title Font', sans-serif"), false);
  assert.equal(set.check("16px Nobody"), true, "a family no face has needs no load");
  const loaded = await set.load("bold 16px/1.2 'Title Font', sans-serif");
  assert.deepEqual(loaded, [a]);
  assert.equal(b.status, "unloaded", "a face the shorthand does not name is left alone");
  assert.equal(set.check("italic 2em title font"), true, "families match case-insensitively");
  assert.throws(() => set.check("Title Font"), (e) => e.name === "SyntaxError");
  await assert.rejects(set.load("no size here"), (e) => e.name === "SyntaxError");
});

await test("the set is set-like: iteration, forEach, delete, clear", () => {
  const set = new FontFaceSet();
  const a = new FontFace("A", "url(a.ttf)");
  const b = new FontFace("B", "url(b.ttf)");
  set.add(a); set.add(b); set.add(a);
  assert.equal(set.size, 2);
  assert.deepEqual([...set], [a, b]);
  assert.deepEqual([...set.values()], [a, b]);
  assert.deepEqual([...set.entries()], [[a, a], [b, b]]);
  const seen = [];
  set.forEach((face, again, owner) => { assert.equal(face, again); assert.equal(owner, set); seen.push(face.family); });
  assert.deepEqual(seen, ["A", "B"]);
  assert.equal(set.delete(a), true);
  assert.equal(set.delete(a), false);
  set.clear();
  assert.equal(set.size, 0);
  assert.throws(() => set.add({ family: "x" }), TypeError);
});

await test("source lists and shorthands parse as CSS writes them", () => {
  assert.deepEqual(sourceUrls(`url("a.woff2") format("woff2"), url('b.woff'), url(c.ttf) tech(variations), local("A B")`), ["a.woff2", "b.woff", "c.ttf"]);
  assert.deepEqual(sourceUrls("url(data:font/woff2;base64,d09GMg==)"), ["data:font/woff2;base64,d09GMg=="]);
  assert.equal(sourceUrls("a.ttf"), null);
  assert.equal(sourceUrls(""), null);
  assert.deepEqual(shorthandFamilies('italic small-caps bold 12px/30px Georgia, "Times New Roman", serif'), ["georgia", "times new roman", "serif"]);
  assert.deepEqual(shorthandFamilies("large Bungee"), ["bungee"]);
  assert.deepEqual(shorthandFamilies("Bungee"), []);
});

if (failed) {
  console.log(`${failed} test(s) failed`);
  process.exit(1);
}
