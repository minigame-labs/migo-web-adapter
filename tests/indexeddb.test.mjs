// IndexedDB (src/idb/): the specification's answers for what this implementation does -- versions and upgrades,
// transactions that are active only while they may be, requests answered in order, errors that abort and undo, key
// generators, indexes, cursors, key ranges -- and a database kept in the game's files across factories.
import assert from "node:assert/strict";

const reported = [];
globalThis.reportError = (error) => reported.push(error);
const { createIndexedDB, memoryStorage, fileStorage, IDBKeyRange, IDBCursorWithValue } = await import("../src/idb/api.js");

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const promise = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = (event) => { event.preventDefault(); reject(request.error); };
});
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });

function open(factory, name, version, upgrade) {
  const request = factory.open(name, version);
  if (upgrade) request.onupgradeneeded = (event) => upgrade(request.result, request.transaction, event);
  return promise(request);
}

// ---- Versions and upgrades ----
{
  const idb = createIndexedDB(memoryStorage());
  const seen = [];
  const db = await open(idb, "a", 2, (db, tx, event) => {
    seen.push([event.oldVersion, event.newVersion, tx.mode]);
    db.createObjectStore("s", { keyPath: "id" });
  });
  assert.deepEqual(seen, [[0, 2, "versionchange"]]);
  assert.equal(db.version, 2);
  assert.deepEqual([...db.objectStoreNames], ["s"]);
  assert.equal(db.objectStoreNames.contains("s"), true);
  await assert.rejects(open(idb, "a", 1), (e) => e.name === "VersionError");
  const again = await open(idb, "a");
  assert.equal(again.version, 2, "no version opens the database at its own");
  assert.throws(() => idb.open("a", 0), TypeError);
  db.close();
  again.close();
}

// ---- Transactions: active only while they may be; read-only; requests in order ----
{
  const idb = createIndexedDB(memoryStorage());
  const db = await open(idb, "t", 1, (db) => db.createObjectStore("s"));
  const tx = db.transaction("s", "readwrite");
  const store = tx.objectStore("s");
  const order = [];
  store.put("one", 1).onsuccess = () => order.push("put 1");
  store.put("two", 2).onsuccess = () => order.push("put 2");
  store.get(1).onsuccess = (e) => order.push("get " + e.target.result);
  await done(tx);
  assert.deepEqual(order, ["put 1", "put 2", "get one"]);
  assert.throws(() => store.put("late", 3), (e) => e.name === "TransactionInactiveError", "after it committed");
  const later = db.transaction("s", "readwrite");
  const laterStore = later.objectStore("s");
  await settle(5);
  assert.throws(() => laterStore.put("x", 9), (e) => e.name === "TransactionInactiveError", "after the task that made it");
  assert.throws(() => later.objectStore("s"), (e) => e.name === "InvalidStateError", "an empty transaction has committed by then");
  const ro = db.transaction("s");
  assert.throws(() => ro.objectStore("s").put("x", 9), (e) => e.name === "ReadOnlyError");
  assert.throws(() => db.transaction("missing"), (e) => e.name === "NotFoundError");
  assert.throws(() => db.transaction([]), (e) => e.name === "InvalidAccessError");
  // A request made in a request's callback is in the same transaction.
  const chain = db.transaction("s", "readwrite");
  chain.objectStore("s").get(1).onsuccess = () => chain.objectStore("s").put("again", 3);
  await done(chain);
  assert.equal(await promise(db.transaction("s").objectStore("s").get(3)), "again");
  db.close();
}

// ---- Values are copies; errors abort and undo; preventDefault keeps the transaction ----
{
  const idb = createIndexedDB(memoryStorage());
  const db = await open(idb, "v", 1, (db) => db.createObjectStore("s"));
  const value = { list: [1, 2], when: new Date(7), bytes: new Uint8Array([3]) };
  const tx = db.transaction("s", "readwrite");
  tx.objectStore("s").put(value, "k");
  value.list.push(99);
  await done(tx);
  const read = await promise(db.transaction("s").objectStore("s").get("k"));
  assert.deepEqual(read.list, [1, 2], "stored as it was put");
  assert.ok(read.when instanceof Date && read.bytes instanceof Uint8Array);
  const second = await promise(db.transaction("s").objectStore("s").get("k"));
  assert.notEqual(read, second, "each read is a new copy");
  assert.throws(() => db.transaction("s", "readwrite").objectStore("s").put(() => 1, "f"), (e) => e.name === "DataCloneError");

  // add() of an existing key: ConstraintError, which aborts the transaction and undoes its put.
  const failing = db.transaction("s", "readwrite");
  failing.objectStore("s").put("kept?", "other");
  const add = failing.objectStore("s").add("dup", "k");
  let addError = null;
  add.onerror = () => { addError = add.error.name; };
  await assert.rejects(done(failing), (e) => e.name === "ConstraintError");
  assert.equal(addError, "ConstraintError");
  assert.equal(await promise(db.transaction("s").objectStore("s").get("other")), undefined, "the aborted put was undone");

  // The same error prevented: the transaction goes on and commits.
  const kept = db.transaction("s", "readwrite");
  kept.objectStore("s").put("kept", "other");
  kept.objectStore("s").add("dup", "k").onerror = (e) => e.preventDefault();
  await done(kept);
  assert.equal(await promise(db.transaction("s").objectStore("s").get("other")), "kept");

  // A listener that throws aborts it, and what it threw is reported.
  reported.length = 0;
  const throwing = db.transaction("s", "readwrite");
  throwing.objectStore("s").put("gone", "thrown").onsuccess = () => { throw new Error("from a listener"); };
  await assert.rejects(done(throwing), (e) => e.name === "AbortError");
  assert.equal(reported[0].message, "from a listener");
  assert.equal(await promise(db.transaction("s").objectStore("s").get("thrown")), undefined);

  // abort() undoes, and the transaction's requests fail with AbortError.
  const aborted = db.transaction("s", "readwrite");
  const pending = aborted.objectStore("s").put("x", "y");
  aborted.abort();
  await assert.rejects(promise(pending), (e) => e.name === "AbortError");
  db.close();
}

// ---- Keys: generators, in-line keys, ranges, order ----
{
  const idb = createIndexedDB(memoryStorage());
  assert.equal(idb.cmp(1, "a"), -1);
  assert.equal(idb.cmp([1], "a"), 1);
  assert.equal(idb.cmp(new Date(0), 1), 1);
  assert.equal(idb.cmp(new Uint8Array([1]), "z"), 1);
  assert.equal(idb.cmp([1, 2], [1, 2]), 0);
  assert.throws(() => idb.cmp(NaN, 1), (e) => e.name === "DataError");
  assert.throws(() => idb.cmp({}, 1), (e) => e.name === "DataError");
  const db = await open(idb, "k", 1, (db) => {
    db.createObjectStore("auto", { keyPath: "id", autoIncrement: true });
    db.createObjectStore("plain");
  });
  const tx = db.transaction(["auto", "plain"], "readwrite");
  const auto = tx.objectStore("auto");
  const keys = [];
  auto.put({ name: "a" }).onsuccess = (e) => keys.push(e.target.result);
  auto.put({ id: 10, name: "b" }).onsuccess = (e) => keys.push(e.target.result);
  auto.put({ name: "c" }).onsuccess = (e) => keys.push(e.target.result);
  for (const k of [5, "e", new Date(3), [1, "x"], 1]) tx.objectStore("plain").put(String(k), k);
  await done(tx);
  assert.deepEqual(keys, [1, 10, 11], "the generator follows an explicit larger key");
  assert.deepEqual((await promise(db.transaction("auto").objectStore("auto").get(1))), { name: "a", id: 1 }, "the key is put into the value");
  const all = await promise(db.transaction("plain").objectStore("plain").getAllKeys());
  assert.equal(all.length, 5);
  assert.deepEqual([all[0], all[1]], [1, 5], "numbers first, in order");
  assert.ok(all[2] instanceof Date && all[3] === "e" && Array.isArray(all[4]), "then dates, strings, arrays");
  const ranged = await promise(db.transaction("plain").objectStore("plain").getAll(IDBKeyRange.bound(1, 5, true, false)));
  assert.deepEqual(ranged, ["5"]);
  assert.equal(await promise(db.transaction("plain").objectStore("plain").count(IDBKeyRange.lowerBound(2))), 4);
  assert.throws(() => IDBKeyRange.bound(5, 1), (e) => e.name === "DataError");
  assert.equal(IDBKeyRange.only(3).includes(3), true);
  assert.throws(() => db.transaction("auto", "readwrite").objectStore("auto").put({ id: {} }), (e) => e.name === "DataError");
  assert.throws(() => db.transaction("plain", "readwrite").objectStore("plain").put("no key"), (e) => e.name === "DataError");
  db.close();
}

// ---- Indexes and cursors ----
{
  const idb = createIndexedDB(memoryStorage());
  const db = await open(idb, "i", 1, (db) => {
    const store = db.createObjectStore("people", { keyPath: "id" });
    store.createIndex("byAge", "age");
    store.createIndex("byEmail", "email", { unique: true });
    store.createIndex("byTag", "tags", { multiEntry: true });
  });
  const tx = db.transaction("people", "readwrite");
  const people = tx.objectStore("people");
  people.put({ id: 1, age: 30, email: "a@x", tags: ["red", "blue"] });
  people.put({ id: 2, age: 20, email: "b@x", tags: ["blue"] });
  people.put({ id: 3, age: 30, email: "c@x", tags: [] });
  await done(tx);
  const index = (name) => db.transaction("people").objectStore("people").index(name);
  assert.deepEqual((await promise(index("byAge").getAll(30))).map((p) => p.id), [1, 3], "an index by key then primary key");
  assert.deepEqual(await promise(index("byTag").getAllKeys("blue")), [1, 2], "multiEntry");
  assert.equal(await promise(index("byEmail").getKey("c@x")), 3);
  const dup = db.transaction("people", "readwrite");
  dup.objectStore("people").put({ id: 4, email: "a@x" });
  await assert.rejects(done(dup), (e) => e.name === "ConstraintError", "a unique index refuses a second record");

  // A cursor in each direction, with continue, advance, update and delete.
  const walk = (source, direction) => new Promise((resolve) => {
    const out = [];
    source.openCursor(null, direction).onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(out);
      out.push(cursor.primaryKey);
      cursor.continue();
    };
  });
  assert.deepEqual(await walk(db.transaction("people").objectStore("people"), "prev"), [3, 2, 1]);
  assert.deepEqual(await walk(index("byAge"), "nextunique"), [2, 1]);
  assert.deepEqual(await walk(index("byAge"), "prevunique"), [1, 2]);
  const edits = db.transaction("people", "readwrite");
  edits.objectStore("people").openCursor().onsuccess = (e) => {
    const cursor = e.target.result;
    if (!cursor) return;
    assert.ok(cursor instanceof IDBCursorWithValue);
    if (cursor.key === 1) cursor.update({ ...cursor.value, age: 31 });
    if (cursor.key === 2) cursor.delete();
    cursor.continue();
  };
  await done(edits);
  assert.deepEqual((await promise(db.transaction("people").objectStore("people").getAll())).map((p) => [p.id, p.age]), [[1, 31], [3, 30]]);
  const advanced = await new Promise((resolve) => {
    const out = [];
    let first = true;
    db.transaction("people").objectStore("people").openKeyCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(out);
      out.push(cursor.key);
      if (first) { first = false; cursor.advance(2); } else cursor.continue();
    };
  });
  assert.deepEqual(advanced, [1], "advance past the end");
  db.close();
}

// ---- An aborted upgrade undoes itself; other connections hear versionchange; blocked; delete ----
{
  const idb = createIndexedDB(memoryStorage());
  const first = await open(idb, "u", 1, (db) => db.createObjectStore("one"));
  const events = [];
  first.onversionchange = (e) => { events.push(`versionchange ${e.oldVersion}->${e.newVersion}`); };
  const request = idb.open("u", 2);
  request.onblocked = () => { events.push("blocked"); first.close(); };
  request.onupgradeneeded = () => {
    request.result.createObjectStore("two");
    request.transaction.abort();
  };
  await assert.rejects(promise(request), (e) => e.name === "AbortError");
  assert.deepEqual(events, ["versionchange 1->2", "blocked"]);
  const back = await open(idb, "u");
  assert.equal(back.version, 1, "the version went back");
  assert.deepEqual([...back.objectStoreNames], ["one"], "the store it made is gone");
  back.close();
  assert.deepEqual((await idb.databases()).map((d) => [d.name, d.version]), [["u", 1]]);
  await promise(idb.deleteDatabase("u"));
  assert.deepEqual(await idb.databases(), []);
}

// ---- Kept in the game's files: a new factory over the same storage reads what was committed ----
{
  const files = new Map();
  const fs = {
    mkdir: ({ success }) => success({}),
    readFile: ({ filePath, success, fail }) => (files.has(filePath) ? success({ data: files.get(filePath) }) : fail({ errMsg: "no such file" })),
    writeFile: ({ filePath, data, success }) => { files.set(filePath, data); success({}); },
    rename: ({ oldPath, newPath, success }) => { files.set(newPath, files.get(oldPath)); files.delete(oldPath); success({}); },
    unlink: ({ filePath, success }) => { files.delete(filePath); success({}); },
    readdir: ({ dirPath, success }) => success({ files: [...files.keys()].filter((p) => p.startsWith(dirPath + "/")).map((p) => p.slice(dirPath.length + 1)) }),
  };
  const host = { env: { USER_DATA_PATH: "/user" }, getFileSystemManager: () => fs };
  const idb = createIndexedDB(fileStorage(host));
  const db = await open(idb, "/idbfs", 21, (db) => {
    db.createObjectStore("FILE_DATA").createIndex("timestamp", "timestamp");
  });
  const tx = db.transaction(["FILE_DATA"], "readwrite");
  tx.objectStore("FILE_DATA").put({ timestamp: new Date(5), mode: 33206, contents: new Uint8Array([1, 2]) }, "/idbfs/save");
  await done(tx);
  await settle(5);
  assert.deepEqual([...files.keys()], ["/user/.indexeddb/2f6964626673.json"], "one file, named by the database, the temporary renamed over it");
  const reopened = await open(createIndexedDB(fileStorage(host)), "/idbfs");
  assert.equal(reopened.version, 21);
  const entry = await promise(reopened.transaction("FILE_DATA").objectStore("FILE_DATA").index("timestamp").get(new Date(5)));
  assert.deepEqual([...entry.contents], [1, 2], "the record, and its index, from the file");
}

console.log("indexeddb: ok");
