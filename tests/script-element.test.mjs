// A <script src> runs as HTML runs a script element (src/element.js): a script that cannot be had fires `error` and
// runs nothing; one that throws has its exception reported (src/report.js) and still fires `load`; a handler or a
// listener that throws is reported, and the rest still run. They were one failure: a Unity build's loader, whose
// `onload` threw, was logged as a script that failed to load, its `error` fired, and nothing that watches for errors
// heard of it. And the document's address is absolute, as a browser's is: that loader joins a path onto document.URL.
import assert from "node:assert/strict";

const reported = [];
globalThis.reportError = (error) => reported.push(error);
const files = {
  "throws.js": "globalThis.ranBeforeThrowing = true; throw new RangeError('from the script');",
  "fine.js": "globalThis.fineRan = (globalThis.fineRan || 0) + 1;",
};
globalThis.migo = {
  getFileSystemManager: () => ({
    readFileSync(path) {
      if (!(path in files)) throw new Error("readFileSync:fail no such file or directory " + path);
      return files[path];
    },
  }),
};

const { default: document } = await import("../src/document.js");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const script = (src, handlers = {}) => {
  const node = document.createElement("script");
  Object.assign(node, handlers);
  node.src = src;
  document.body.appendChild(node);
  return node;
};

// A script that throws: reported, and its load still fires; no error event.
{
  const seen = [];
  script("throws.js", { onload: () => seen.push("load"), onerror: () => seen.push("error") });
  await settle();
  assert.equal(globalThis.ranBeforeThrowing, true);
  assert.deepEqual(seen, ["load"], "a script that ran and threw has loaded");
  assert.equal(reported.length, 1);
  assert.ok(reported[0] instanceof RangeError && reported[0].message === "from the script", "the script's exception is reported");
}

// A script that is not there: error, nothing runs, nothing reported.
{
  reported.length = 0;
  const seen = [];
  script("missing.js", { onload: () => seen.push("load"), onerror: () => seen.push("error") });
  await settle();
  assert.deepEqual(seen, ["error"]);
  assert.equal(reported.length, 0, "a script that could not be had is an error event, not an exception");
}

// A remote script is refused: error.
{
  const seen = [];
  script("https://example.com/a.js", { onload: () => seen.push("load"), onerror: () => seen.push("error") });
  await settle();
  assert.deepEqual(seen, ["error"]);
}

// An onload that throws is reported; the script was loaded, so no error fires, and load listeners still run.
{
  reported.length = 0;
  const seen = [];
  const node = script("fine.js", {
    onload: () => { throw new TypeError("from onload"); },
    onerror: () => seen.push("error"),
  });
  node.addEventListener("load", () => seen.push("listener"));
  await settle();
  assert.equal(globalThis.fineRan, 1);
  assert.deepEqual(seen, ["listener"]);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].message, "from onload");
}

// A listener that throws is reported, and the next one runs.
{
  reported.length = 0;
  const seen = [];
  const node = document.createElement("div");
  node.addEventListener("ping", () => { throw new Error("from a listener"); });
  node.addEventListener("ping", () => seen.push("next"));
  node.dispatchEvent({ type: "ping" });
  assert.deepEqual(seen, ["next"]);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].message, "from a listener");
}

// The document's address is absolute, the location's, on the game's origin; a path joined onto it stays there.
{
  const { default: location } = await import("../src/location.js");
  assert.equal(location.href, "https://game/game.js");
  assert.equal(document.URL, location.href);
  assert.equal(document.documentURI, location.href);
  assert.equal(new URL("StreamingAssets", document.URL).href, "https://game/StreamingAssets");
  assert.equal(new URL(location.href).pathname, location.pathname);
  assert.equal(new URL(location.href).origin, location.origin);
}

console.log("script-element: ok");
