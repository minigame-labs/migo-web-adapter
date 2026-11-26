// IndexedDB (W3C Indexed Database API 3.0) for a page whose platform has none: IDBFactory, IDBDatabase,
// IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor(WithValue), IDBRequest, IDBOpenDBRequest, IDBVersionChangeEvent
// and IDBKeyRange, over the game's own files.
//
// A database lives in memory while the game runs and in one file of the game's user data (`storage`, below), written
// after each transaction that changed it commits; it is read when the database is first opened. Values are held as
// their structured serialisation (clone.js), so a read is a new copy of the value as it was put.
//
// Transactions run one at a time per database, in the order they were made (the specification lets read-only ones
// overlap; it does not ask that they do). A transaction is active in the task that made it and while its requests'
// events are dispatched, as the specification has it; it commits when it is inactive with no request left. Requests
// run in order, each answered in a task of its own. An error event that nothing cancels, or a listener that throws,
// aborts the transaction, which undoes what it did.
//
// Engines: a Unity build mounts its persistent data path on IndexedDB (emscripten's IDBFS: a versioned open, a store
// with a `timestamp` index walked by a key cursor, read-write transactions) and aborts without one; Godot, Construct
// and localForage keep their saves there.

import EventTarget from "../event-target.js";
import DOMException from "../dom-exception.js";
import { Event } from "../events.js";
import { reportException } from "../report.js";
import { serialize, deserialize } from "./clone.js";
import {
  IDBKeyRange, UNBOUNDED, rangeIncludes, toKeyRange, valueToKey, requireKey, toValue, compareKeys, dataError,
  encodeKey, decodeKey, isValidKeyPath, normalizeKeyPath, extractKey, evaluateKeyPath, MISSING, canInjectKey, injectKey,
} from "./keys.js";

const TOKEN = Symbol("IndexedDB internal");
const later = (fn) => setTimeout(fn, 0);
const domError = (name, message) => new DOMException(message, name);
const MAX_GENERATED_KEY = 2 ** 53;

// ---- Events ---------------------------------------------------------------------------------------------------

class IDBEvent extends Event {
  stopPropagation() { this._stopped = true; }
  stopImmediatePropagation() { this._stopped = true; this._stopImmediate = true; }
}

export class IDBVersionChangeEvent extends IDBEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.oldVersion = init.oldVersion === undefined ? 0 : Number(init.oldVersion);
    this.newVersion = init.newVersion === undefined || init.newVersion === null ? null : Number(init.newVersion);
  }
}

/// Dispatch `event` at `path[0]`, then -- when it bubbles -- at each target after it, the `on<type>` handler then the
/// listeners of each. Answers whether a listener threw; what it threw is reported.
function dispatch(path, event) {
  let threw = false;
  event.target = path[0];
  const targets = event.bubbles ? path : [path[0]];
  for (const current of targets) {
    event.currentTarget = current;
    const handler = current["on" + event.type];
    if (typeof handler === "function") {
      try { handler.call(current, event); } catch (error) { threw = true; reportException(error); }
    }
    const list = current._listeners && current._listeners[event.type];
    if (list) {
      for (const entry of list.slice()) {
        if (list.indexOf(entry) === -1) continue;
        if (entry.once) current.removeEventListener(event.type, entry.listener);
        try {
          if (typeof entry.listener === "function") entry.listener.call(current, event);
          else entry.listener.handleEvent(event);
        } catch (error) {
          threw = true;
          reportException(error);
        }
        if (event._stopImmediate) break;
      }
    }
    if (event._stopped) break;
  }
  event.currentTarget = null;
  return threw;
}

// ---- DOMStringList --------------------------------------------------------------------------------------------

export class DOMStringList {
  constructor(token, names) {
    if (token !== TOKEN) throw new TypeError("Illegal constructor");
    this._names = names.slice().sort();
    this._names.forEach((name, i) => Object.defineProperty(this, i, { value: name, enumerable: true }));
  }
  get length() { return this._names.length; }
  item(index) { return this._names[index >>> 0] ?? null; }
  contains(name) { return this._names.includes(String(name)); }
  [Symbol.iterator]() { return this._names[Symbol.iterator](); }
}

// ---- The database model ---------------------------------------------------------------------------------------

/// The index of the first entry whose key is not less than `key` (by `compare`).
function lowerIndex(list, key, compare) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compare(list[mid], key) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class IndexState {
  constructor(name, keyPath, unique, multiEntry) {
    this.name = name;
    this.keyPath = keyPath;
    this.unique = unique;
    this.multiEntry = multiEntry;
    this.entries = []; // { key, primaryKey }, by key then primary key
  }
  /// The index keys a stored value gives: none when the key path finds nothing valid.
  keysFor(value) {
    const found = evaluateKeyPath(value, this.keyPath);
    if (found === MISSING) return [];
    if (this.multiEntry && Array.isArray(found)) {
      const keys = [];
      for (const item of found) {
        const key = valueToKey(item);
        if (key !== null && !keys.some((k) => compareKeys(k, key) === 0)) keys.push(key);
      }
      return keys;
    }
    const key = valueToKey(found);
    return key === null ? [] : [key];
  }
  static compareEntry(a, b) {
    return compareKeys(a.key, b.key) || compareKeys(a.primaryKey, b.primaryKey);
  }
  add(key, primaryKey) {
    const entry = { key, primaryKey };
    this.entries.splice(lowerIndex(this.entries, entry, IndexState.compareEntry), 0, entry);
  }
  removePrimary(primaryKey) {
    this.entries = this.entries.filter((entry) => compareKeys(entry.primaryKey, primaryKey) !== 0);
  }
  hasKeyOtherThan(key, primaryKey) {
    const at = lowerIndex(this.entries, key, (entry, k) => compareKeys(entry.key, k));
    for (let i = at; i < this.entries.length && compareKeys(this.entries[i].key, key) === 0; i++) {
      if (compareKeys(this.entries[i].primaryKey, primaryKey) !== 0) return true;
    }
    return false;
  }
}

class StoreState {
  constructor(name, keyPath, autoIncrement) {
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this.current = 1; // the key generator's next number
    this.records = []; // { key, value }, by key; value is the serialised form
    this.indexes = new Map();
  }
  find(key) {
    const at = lowerIndex(this.records, key, (record, k) => compareKeys(record.key, k));
    return at < this.records.length && compareKeys(this.records[at].key, key) === 0 ? at : -1;
  }
  get(key) {
    const at = this.find(key);
    return at === -1 ? undefined : this.records[at];
  }
}

class DatabaseState {
  constructor(name) {
    this.name = name;
    this.version = 0;
    this.stores = new Map();
    this.connections = new Set();
    this.transactions = []; // waiting and running, in order
    this.exists = false;
  }
  toJSON() {
    return {
      name: this.name,
      version: this.version,
      stores: [...this.stores.values()].map((store) => ({
        name: store.name,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        current: store.current,
        indexes: [...store.indexes.values()].map((index) => ({
          name: index.name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry,
        })),
        records: store.records.map((record) => [encodeKey(record.key), record.value]),
      })),
    };
  }
  static fromJSON(data) {
    const db = new DatabaseState(data.name);
    db.version = data.version;
    db.exists = true;
    for (const s of data.stores) {
      const store = new StoreState(s.name, s.keyPath, s.autoIncrement);
      store.current = s.current;
      store.records = s.records.map(([key, value]) => ({ key: decodeKey(key), value }));
      for (const i of s.indexes) {
        const index = new IndexState(i.name, i.keyPath, i.unique, i.multiEntry);
        for (const record of store.records) {
          for (const key of index.keysFor(deserialize(record.value))) index.add(key, record.key);
        }
        store.indexes.set(index.name, index);
      }
      db.stores.set(store.name, store);
    }
    return db;
  }
}

// ---- Storage: the game's user data ----------------------------------------------------------------------------

function hexName(name) {
  return Array.from(new TextEncoder().encode(name), (b) => b.toString(16).padStart(2, "0")).join("");
}

/// The game's files, through its file system manager: a database in `<user data>/.indexeddb/<name as hex>.json`.
export function fileStorage(host = globalThis.migo) {
  const fs = host && typeof host.getFileSystemManager === "function" ? host.getFileSystemManager() : null;
  const base = host && host.env && host.env.USER_DATA_PATH;
  if (!fs || !base) return memoryStorage();
  const dir = base + "/.indexeddb";
  const call = (method, options) => new Promise((resolve, reject) => {
    fs[method]({ ...options, success: resolve, fail: (error) => reject(new Error(error && error.errMsg || String(error))) });
  });
  const path = (name) => `${dir}/${hexName(name)}.json`;
  let ready = null;
  const ensureDir = () => ready || (ready = call("mkdir", { dirPath: dir, recursive: true }).catch(() => {}));
  return {
    async load(name) {
      try {
        const res = await call("readFile", { filePath: path(name), encoding: "utf8" });
        return JSON.parse(res.data);
      } catch {
        return null;
      }
    },
    async save(name, data) {
      await ensureDir();
      const target = path(name);
      // Written beside it and renamed over it: a game stopped mid-write keeps the database it had.
      await call("writeFile", { filePath: target + ".tmp", data: JSON.stringify(data), encoding: "utf8" });
      await call("rename", { oldPath: target + ".tmp", newPath: target });
    },
    async remove(name) {
      await call("unlink", { filePath: path(name) }).catch(() => {});
    },
    async list() {
      try {
        const res = await call("readdir", { dirPath: dir });
        const out = [];
        for (const file of res.files || []) {
          if (!file.endsWith(".json")) continue;
          try {
            const read = await call("readFile", { filePath: `${dir}/${file}`, encoding: "utf8" });
            const data = JSON.parse(read.data);
            out.push({ name: data.name, version: data.version });
          } catch { /* a file that is not a database */ }
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

/// No files to keep them in: the databases last as long as the game runs.
export function memoryStorage() {
  const kept = new Map();
  return {
    async load(name) { return kept.has(name) ? JSON.parse(kept.get(name)) : null; },
    async save(name, data) { kept.set(name, JSON.stringify(data)); },
    async remove(name) { kept.delete(name); },
    async list() { return [...kept.values()].map((text) => { const d = JSON.parse(text); return { name: d.name, version: d.version }; }); },
  };
}

// ---- Requests -------------------------------------------------------------------------------------------------

export class IDBRequest extends EventTarget {
  constructor(token, source, transaction) {
    if (token !== TOKEN) throw new TypeError("Illegal constructor");
    super();
    this._source = source;
    this._transaction = transaction;
    this._done = false;
    this._result = undefined;
    this._error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
  get source() { return this._source; }
  get transaction() { return this._transaction; }
  get readyState() { return this._done ? "done" : "pending"; }
  get result() {
    if (!this._done) throw domError("InvalidStateError", "The request has not finished.");
    return this._result;
  }
  get error() {
    if (!this._done) throw domError("InvalidStateError", "The request has not finished.");
    return this._error;
  }
}

export class IDBOpenDBRequest extends IDBRequest {
  constructor(token) {
    super(token, null, null);
    this.onblocked = null;
    this.onupgradeneeded = null;
  }
}

// ---- Transactions ---------------------------------------------------------------------------------------------

export class IDBTransaction extends EventTarget {
  constructor(token, db, scope, mode, durability, upgrade = false) {
    if (token !== TOKEN) throw new TypeError("Illegal constructor");
    super();
    this._db = db;
    this._scope = scope;
    this._mode = mode;
    this._durability = durability;
    this._state = "active";
    this._requests = [];
    this._started = false;
    this._stepping = false;
    this._undo = [];
    this._error = null;
    this._stores = new Map();
    this._dirty = false;
    this._aborted = false;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    // Active until the task that made it ends. A versionchange transaction is active while its upgradeneeded event is
    // dispatched instead (IDBFactory._upgrade).
    if (!upgrade) {
      later(() => {
        if (this._state === "active") this._state = "inactive";
        this._step();
      });
    }
  }
  get db() { return this._db; }
  get mode() { return this._mode; }
  get durability() { return this._durability; }
  get error() { return this._error; }
  get objectStoreNames() {
    return new DOMStringList(TOKEN, this._mode === "versionchange" ? [...this._db._state.stores.keys()] : this._scope);
  }

  objectStore(name) {
    if (arguments.length < 1) throw new TypeError("IDBTransaction.objectStore: 1 argument required");
    name = String(name);
    if (this._state === "finished") throw domError("InvalidStateError", "The transaction has finished.");
    if (this._mode !== "versionchange" && !this._scope.includes(name)) {
      throw domError("NotFoundError", `No objectStore named ${name} in this transaction.`);
    }
    const state = this._db._state.stores.get(name);
    if (!state) throw domError("NotFoundError", `No objectStore named ${name} in this database.`);
    let store = this._stores.get(state);
    if (!store) {
      store = new IDBObjectStore(TOKEN, this, state);
      this._stores.set(state, store);
    }
    return store;
  }

  abort() {
    if (this._state === "committing" || this._state === "finished") {
      throw domError("InvalidStateError", "The transaction has already committed or aborted.");
    }
    this._abort(null);
  }

  commit() {
    if (this._state !== "active") throw domError("InvalidStateError", "The transaction is not active.");
    this._state = "inactive";
    this._step();
  }

  // -- internals --

  _assertActive() {
    if (this._state !== "active") throw domError("TransactionInactiveError", "The transaction is not active.");
  }

  _assertWritable() {
    if (this._mode === "readonly") throw domError("ReadOnlyError", "The transaction is read-only.");
  }

  /// Queue `operation` (answering the result, or throwing a DOMException) behind the transaction's other requests.
  _request(source, operation, request = new IDBRequest(TOKEN, source, this)) {
    request._done = false;
    this._requests.push({ request, operation });
    this._step();
    return request;
  }

  _start() {
    this._started = true;
    this._step();
  }

  _step() {
    if (!this._started || this._stepping || this._state === "finished" || this._state === "committing") return;
    if (this._requests.length === 0) {
      if (this._state === "inactive") this._commit();
      return;
    }
    this._stepping = true;
    later(() => {
      this._stepping = false;
      if (this._state === "finished") return;
      const { request, operation } = this._requests.shift();
      let result, error = null;
      try {
        result = operation();
      } catch (e) {
        if (!(e instanceof DOMException)) throw e;
        error = e;
      }
      request._done = true;
      const previous = this._state;
      this._state = "active";
      let threw;
      if (error === null) {
        request._result = result;
        request._error = null;
        threw = dispatch([request], new IDBEvent("success", { bubbles: false, cancelable: false }));
      } else {
        request._result = undefined;
        request._error = error;
        const event = new IDBEvent("error", { bubbles: true, cancelable: true });
        threw = dispatch([request, this, this._db], event);
        if (!threw && !event.defaultPrevented) {
          if (this._state === "active") this._state = previous === "active" ? "active" : "inactive";
          this._abort(error);
          return;
        }
      }
      if (this._state === "active") this._state = previous === "active" ? "active" : "inactive";
      if (threw) {
        this._abort(domError("AbortError", "A request's event listener threw."));
        return;
      }
      this._step();
    });
  }

  _commit() {
    this._state = "committing";
    const db = this._db._state;
    const finish = () => {
      this._state = "finished";
      this._finished();
      dispatch([this], new IDBEvent("complete", { bubbles: false, cancelable: false }));
    };
    if (this._dirty) {
      db.exists = true;
      this._db._factory._persist(db).then(() => later(finish), (error) => {
        console.warn("[migo-web-adapter] IndexedDB could not write " + db.name + ":", error);
        later(finish);
      });
    } else {
      later(finish);
    }
  }

  _abort(error) {
    if (this._state === "finished") return;
    this._state = "finished";
    this._aborted = true;
    this._error = error;
    for (let i = this._undo.length - 1; i >= 0; i--) this._undo[i]();
    this._undo = [];
    const pending = this._requests;
    this._requests = [];
    later(() => {
      for (const { request } of pending) {
        request._done = true;
        request._result = undefined;
        request._error = domError("AbortError", "The transaction was aborted.");
        dispatch([request, this, this._db], new IDBEvent("error", { bubbles: true, cancelable: true }));
      }
      dispatch([this, this._db], new IDBEvent("abort", { bubbles: true, cancelable: false }));
      this._finished();
    });
  }

  _finished() {
    const queue = this._db._state.transactions;
    const at = queue.indexOf(this);
    if (at !== -1) queue.splice(at, 1);
    if (this._onFinished) this._onFinished();
    this._db._factory._startNext(this._db._state);
  }
}

// ---- Object stores, indexes, cursors --------------------------------------------------------------------------

function checkStoreUsable(store) {
  if (store._deleted) throw domError("InvalidStateError", "The object store has been deleted.");
}

/// "Store a record into an object store": the key, or ConstraintError.
function storeRecord(transaction, state, value, key, noOverwrite) {
  const clone = deserialize(value);
  if (state.autoIncrement) {
    if (key === null) {
      if (state.current > MAX_GENERATED_KEY) throw domError("ConstraintError", "The key generator is exhausted.");
      key = { type: "number", value: state.current };
      const before = state.current;
      transaction._undo.push(() => { state.current = before; });
      state.current += 1;
      if (state.keyPath !== null) {
        injectKey(clone, key, state.keyPath);
        value = serialize(clone);
      }
    } else if (key.type === "number" && key.value >= state.current) {
      const before = state.current;
      transaction._undo.push(() => { state.current = before; });
      state.current = Math.min(Math.floor(key.value) + 1, MAX_GENERATED_KEY + 1);
    }
  }
  const at = state.find(key);
  if (at !== -1 && noOverwrite) throw domError("ConstraintError", "A record with that key already exists.");
  // Unique indexes first: a violation stores nothing.
  const indexKeys = new Map();
  for (const index of state.indexes.values()) {
    const keys = index.keysFor(clone);
    if (index.unique && keys.some((k) => index.hasKeyOtherThan(k, key))) {
      throw domError("ConstraintError", `The index ${index.name} already holds that key.`);
    }
    indexKeys.set(index, keys);
  }
  const previous = at === -1 ? undefined : state.records[at];
  if (previous) removeRecordAt(transaction, state, at);
  const record = { key, value };
  state.records.splice(lowerIndex(state.records, key, (r, k) => compareKeys(r.key, k)), 0, record);
  for (const [index, keys] of indexKeys) for (const k of keys) index.add(k, key);
  transaction._undo.push(() => {
    const now = state.find(key);
    if (now !== -1) state.records.splice(now, 1);
    for (const index of state.indexes.values()) index.removePrimary(key);
    if (previous) {
      state.records.splice(lowerIndex(state.records, key, (r, k) => compareKeys(r.key, k)), 0, previous);
      const old = deserialize(previous.value);
      for (const index of state.indexes.values()) for (const k of index.keysFor(old)) index.add(k, key);
    }
  });
  transaction._dirty = true;
  return key;
}

function removeRecordAt(transaction, state, at) {
  const [record] = state.records.splice(at, 1);
  for (const index of state.indexes.values()) index.removePrimary(record.key);
  transaction._dirty = true;
  return record;
}

function deleteRange(transaction, state, range) {
  const removed = [];
  for (let i = state.records.length - 1; i >= 0; i--) {
    if (rangeIncludes(range, state.records[i].key)) removed.push(removeRecordAt(transaction, state, i));
  }
  if (removed.length) {
    transaction._undo.push(() => {
      for (const record of removed) {
        state.records.splice(lowerIndex(state.records, record.key, (r, k) => compareKeys(r.key, k)), 0, record);
        const value = deserialize(record.value);
        for (const index of state.indexes.values()) for (const k of index.keysFor(value)) index.add(k, record.key);
      }
    });
  }
}

function countArgument(count) {
  if (count === undefined) return Infinity;
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) throw new TypeError("The count is not an unsigned long.");
  return Math.trunc(n) === 0 ? Infinity : Math.trunc(n);
}

export class IDBObjectStore {
  constructor(token, transaction, state) {
    if (token !== TOKEN) throw new TypeError("Illegal constructor");
    this._transaction = transaction;
    this._state = state;
    this._deleted = false;
    this._indexes = new Map();
  }
  get name() { return this._state.name; }
  set name(value) {
    const name = String(value);
    const tx = this._transaction;
    checkStoreUsable(this);
    if (tx._mode !== "versionchange") throw domError("InvalidStateError", "Not in a versionchange transaction.");
    tx._assertActive();
    if (name === this._state.name) return;
    const stores = tx._db._state.stores;
    if (stores.has(name)) throw domError("ConstraintError", `An objectStore named ${name} already exists.`);
    const old = this._state.name;
    stores.delete(old);
    this._state.name = name;
    stores.set(name, this._state);
    tx._dirty = true;
    tx._undo.push(() => { stores.delete(name); this._state.name = old; stores.set(old, this._state); });
  }
  get keyPath() { return this._state.keyPath; }
  get autoIncrement() { return this._state.autoIncrement; }
  get transaction() { return this._transaction; }
  get indexNames() { return new DOMStringList(TOKEN, [...this._state.indexes.keys()]); }

  _write(value, key, noOverwrite) {
    checkStoreUsable(this);
    const tx = this._transaction;
    tx._assertActive();
    tx._assertWritable();
    const state = this._state;
    let given = null;
    if (state.keyPath !== null) {
      if (key !== undefined) throw dataError("The object store uses in-line keys and the key parameter was provided.");
    } else if (key === undefined) {
      if (!state.autoIncrement) throw dataError("The object store uses out-of-line keys and has no key generator, and no key was provided.");
    } else {
      given = requireKey(key);
    }
    const form = serialize(value);
    if (state.keyPath !== null) {
      const clone = deserialize(form);
      const found = evaluateKeyPath(clone, state.keyPath);
      if (found !== MISSING) {
        given = valueToKey(found);
        if (given === null) throw dataError("The key path yielded an invalid key.");
      } else if (!state.autoIncrement) {
        throw dataError("The key path yielded no key and the object store has no key generator.");
      } else if (!canInjectKey(clone, state.keyPath)) {
        throw dataError("A generated key could not be put into the value.");
      }
    }
    return tx._request(this, () => toValue(storeRecord(tx, state, form, given, noOverwrite)));
  }

  put(value, key) {
    if (arguments.length < 1) throw new TypeError("IDBObjectStore.put: 1 argument required");
    return this._write(value, key, false);
  }
  add(value, key) {
    if (arguments.length < 1) throw new TypeError("IDBObjectStore.add: 1 argument required");
    return this._write(value, key, true);
  }
  delete(query) {
    if (arguments.length < 1) throw new TypeError("IDBObjectStore.delete: 1 argument required");
    checkStoreUsable(this);
    const tx = this._transaction;
    tx._assertActive();
    tx._assertWritable();
    const range = toKeyRange(query, true);
    return tx._request(this, () => { deleteRange(tx, this._state, range); return undefined; });
  }
  clear() {
    checkStoreUsable(this);
    const tx = this._transaction;
    tx._assertActive();
    tx._assertWritable();
    return tx._request(this, () => { deleteRange(tx, this._state, UNBOUNDED); return undefined; });
  }
  _records(query, count) {
    const range = toKeyRange(query);
    const out = [];
    for (const record of this._state.records) {
      if (out.length >= count) break;
      if (rangeIncludes(range, record.key)) out.push(record);
    }
    return out;
  }
  get(query) {
    if (arguments.length < 1) throw new TypeError("IDBObjectStore.get: 1 argument required");
    checkStoreUsable(this);
    this._transaction._assertActive();
    const range = toKeyRange(query, true);
    return this._transaction._request(this, () => {
      const [record] = this._records(range, 1);
      return record ? deserialize(record.value) : undefined;
    });
  }
  getKey(query) {
    if (arguments.length < 1) throw new TypeError("IDBObjectStore.getKey: 1 argument required");
    checkStoreUsable(this);
    this._transaction._assertActive();
    const range = toKeyRange(query, true);
    return this._transaction._request(this, () => {
      const [record] = this._records(range, 1);
      return record ? toValue(record.key) : undefined;
    });
  }
  getAll(query, count) {
    checkStoreUsable(this);
    this._transaction._assertActive();
    const range = toKeyRange(query);
    const limit = countArgument(count);
    return this._transaction._request(this, () => this._records(range, limit).map((r) => deserialize(r.value)));
  }
  getAllKeys(query, count) {
    checkStoreUsable(this);
    this._transaction._assertActive();
    const range = toKeyRange(query);
    const limit = countArgument(count);
    return this._transaction._request(this, () => this._records(range, limit).map((r) => toValue(r.key)));
  }
  count(query) {
    checkStoreUsable(this);
    this._transaction._assertActive();
    const range = toKeyRange(query);
    return this._transaction._request(this, () => this._records(range, Infinity).length);
  }
  openCursor(query, direction = "next") {
    return openCursor(this, toKeyRange(query), direction, true);
  }
  openKeyCursor(query, direction = "next") {
    return openCursor(this, toKeyRange(query), direction, false);
  }
  index(name) {
    if (arguments.length < 1) throw new TypeError("IDBObjectStore.index: 1 argument required");
    checkStoreUsable(this);
    if (this._transaction._state === "finished") throw domError("InvalidStateError", "The transaction has finished.");
    const state = this._state.indexes.get(String(name));
    if (!state) throw domError("NotFoundError", `No index named ${name}.`);
    let index = this._indexes.get(state);
    if (!index) {
      index = new IDBIndex(TOKEN, this, state);
      this._indexes.set(state, index);
    }
    return index;
  }
  createIndex(name, keyPath, options = {}) {
    if (arguments.length < 2) throw new TypeError("IDBObjectStore.createIndex: 2 arguments required");
    name = String(name);
    const tx = this._transaction;
    if (tx._mode !== "versionchange") throw domError("InvalidStateError", "Not in a versionchange transaction.");
    checkStoreUsable(this);
    tx._assertActive();
    const state = this._state;
    if (state.indexes.has(name)) throw domError("ConstraintError", `An index named ${name} already exists.`);
    keyPath = normalizeKeyPath(keyPath);
    if (!isValidKeyPath(keyPath)) throw domError("SyntaxError", "The keyPath is not a valid key path.");
    const unique = !!(options && options.unique);
    const multiEntry = !!(options && options.multiEntry);
    if (Array.isArray(keyPath) && multiEntry) throw domError("InvalidAccessError", "A multiEntry index cannot have an array key path.");
    const index = new IndexState(name, keyPath, unique, multiEntry);
    state.indexes.set(name, index);
    tx._dirty = true;
    tx._undo.push(() => { state.indexes.delete(name); });
    // Populating it is a request of its own, which a unique violation aborts.
    tx._request(this, () => {
      for (const record of state.records) {
        for (const key of index.keysFor(deserialize(record.value))) {
          if (unique && index.entries.some((e) => compareKeys(e.key, key) === 0)) {
            throw domError("ConstraintError", `The records violate the unique index ${name}.`);
          }
          index.add(key, record.key);
        }
      }
      return undefined;
    });
    return this.index(name);
  }
  deleteIndex(name) {
    if (arguments.length < 1) throw new TypeError("IDBObjectStore.deleteIndex: 1 argument required");
    name = String(name);
    const tx = this._transaction;
    if (tx._mode !== "versionchange") throw domError("InvalidStateError", "Not in a versionchange transaction.");
    checkStoreUsable(this);
    tx._assertActive();
    const index = this._state.indexes.get(name);
    if (!index) throw domError("NotFoundError", `No index named ${name}.`);
    this._state.indexes.delete(name);
    const wrapper = this._indexes.get(index);
    if (wrapper) wrapper._deleted = true;
    tx._dirty = true;
    tx._undo.push(() => { this._state.indexes.set(name, index); if (wrapper) wrapper._deleted = false; });
  }
}

export class IDBIndex {
  constructor(token, store, state) {
    if (token !== TOKEN) throw new TypeError("Illegal constructor");
    this._store = store;
    this._state = state;
    this._deleted = false;
  }
  get name() { return this._state.name; }
  get objectStore() { return this._store; }
  get keyPath() { return this._state.keyPath; }
  get multiEntry() { return this._state.multiEntry; }
  get unique() { return this._state.unique; }
  _usable() {
    if (this._deleted || this._store._deleted) throw domError("InvalidStateError", "The index has been deleted.");
    this._store._transaction._assertActive();
  }
  _entries(range, count) {
    const out = [];
    for (const entry of this._state.entries) {
      if (out.length >= count) break;
      if (rangeIncludes(range, entry.key)) out.push(entry);
    }
    return out;
  }
  _value(entry) {
    return deserialize(this._store._state.get(entry.primaryKey).value);
  }
  get(query) {
    if (arguments.length < 1) throw new TypeError("IDBIndex.get: 1 argument required");
    this._usable();
    const range = toKeyRange(query, true);
    return this._store._transaction._request(this, () => {
      const [entry] = this._entries(range, 1);
      return entry ? this._value(entry) : undefined;
    });
  }
  getKey(query) {
    if (arguments.length < 1) throw new TypeError("IDBIndex.getKey: 1 argument required");
    this._usable();
    const range = toKeyRange(query, true);
    return this._store._transaction._request(this, () => {
      const [entry] = this._entries(range, 1);
      return entry ? toValue(entry.primaryKey) : undefined;
    });
  }
  getAll(query, count) {
    this._usable();
    const range = toKeyRange(query);
    const limit = countArgument(count);
    return this._store._transaction._request(this, () => this._entries(range, limit).map((e) => this._value(e)));
  }
  getAllKeys(query, count) {
    this._usable();
    const range = toKeyRange(query);
    const limit = countArgument(count);
    return this._store._transaction._request(this, () => this._entries(range, limit).map((e) => toValue(e.primaryKey)));
  }
  count(query) {
    this._usable();
    const range = toKeyRange(query);
    return this._store._transaction._request(this, () => this._entries(range, Infinity).length);
  }
  openCursor(query, direction = "next") {
    return openCursor(this, toKeyRange(query), direction, true);
  }
  openKeyCursor(query, direction = "next") {
    return openCursor(this, toKeyRange(query), direction, false);
  }
}

const DIRECTIONS = new Set(["next", "nextunique", "prev", "prevunique"]);

function openCursor(source, range, direction, withValue) {
  direction = String(direction);
  if (!DIRECTIONS.has(direction)) throw new TypeError(`The direction "${direction}" is not a valid IDBCursorDirection.`);
  const isIndex = source instanceof IDBIndex;
  if (isIndex) source._usable();
  else {
    checkStoreUsable(source);
    source._transaction._assertActive();
  }
  const transaction = isIndex ? source._store._transaction : source._transaction;
  const Cursor = withValue ? IDBCursorWithValue : IDBCursor;
  const cursor = new Cursor(TOKEN, source, direction, range, transaction);
  const request = new IDBRequest(TOKEN, source, transaction);
  cursor._request = request;
  transaction._request(source, () => cursor._iterate(null, null, 1), request);
  return request;
}

export class IDBCursor {
  constructor(token, source, direction, range, transaction) {
    if (token !== TOKEN) throw new TypeError("Illegal constructor");
    this._source = source;
    this._direction = direction;
    this._range = range;
    this._transaction = transaction;
    this._key = undefined;
    this._primaryKey = undefined;
    this._position = null; // the current entry's { key, primaryKey }
    this._gotValue = false;
    this._valueForm = undefined;
  }
  get source() { return this._source; }
  get direction() { return this._direction; }
  get key() { return this._key === undefined ? undefined : toValue(this._key); }
  get primaryKey() { return this._primaryKey === undefined ? undefined : toValue(this._primaryKey); }
  get request() { return this._request; }

  /// The entries the cursor walks, in its direction: { key, primaryKey } for an index, the store's records as
  /// { key, primaryKey: key } for a store.
  _list() {
    const isIndex = this._source instanceof IDBIndex;
    const list = isIndex
      ? this._source._state.entries
      : this._source._state.records.map((r) => ({ key: r.key, primaryKey: r.key }));
    return this._direction.startsWith("prev") ? list.slice().reverse() : list;
  }

  /// "Iterate a cursor": the cursor at its next position (`count` steps, past `key` / `primaryKey`), or null at the end.
  _iterate(key, primaryKey, count) {
    const forward = this._direction.startsWith("next");
    const unique = this._direction.endsWith("unique");
    const isIndex = this._source instanceof IDBIndex;
    const list = this._list();
    let position = this._position;
    let found = null;
    for (let step = 0; step < count; step++) {
      found = null;
      for (const entry of list) {
        if (!rangeIncludes(this._range, entry.key)) continue;
        if (key !== null) {
          const c = compareKeys(entry.key, key);
          if (forward ? c < 0 : c > 0) continue;
          if (primaryKey !== null && c === 0) {
            const p = compareKeys(entry.primaryKey, primaryKey);
            if (forward ? p < 0 : p > 0) continue;
          }
        }
        if (position !== null) {
          const c = compareKeys(entry.key, position.key);
          if (unique) {
            if (forward ? c <= 0 : c >= 0) continue;
          } else if (isIndex) {
            const p = compareKeys(entry.primaryKey, position.primaryKey);
            if (forward ? c < 0 || (c === 0 && p <= 0) : c > 0 || (c === 0 && p >= 0)) continue;
          } else if (forward ? c <= 0 : c >= 0) {
            continue;
          }
        }
        found = entry;
        break;
      }
      if (found === null) break;
      if (unique && !forward) {
        // prevunique answers the first (lowest primary key) record of the key.
        const first = list.filter((e) => compareKeys(e.key, found.key) === 0 && rangeIncludes(this._range, e.key));
        found = first[first.length - 1];
      }
      position = found;
      key = null;
      primaryKey = null;
    }
    if (found === null) {
      this._key = undefined;
      this._primaryKey = undefined;
      this._position = null;
      this._gotValue = false;
      return null;
    }
    this._position = found;
    this._key = found.key;
    this._primaryKey = found.primaryKey;
    const store = isIndex ? this._source._store._state : this._source._state;
    this._valueForm = store.get(found.primaryKey).value;
    this._gotValue = true;
    return this;
  }

  _again() {
    const tx = this._transaction;
    tx._assertActive();
    const sourceDeleted = this._source._deleted || (this._source instanceof IDBIndex && this._source._store._deleted);
    if (sourceDeleted) throw domError("InvalidStateError", "The cursor's source has been deleted.");
    if (!this._gotValue) throw domError("InvalidStateError", "The cursor is being iterated or has iterated past its end.");
  }

  advance(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || Math.trunc(n) < 1 || n > 0xffffffff) throw new TypeError("advance: count must be at least 1.");
    this._again();
    this._gotValue = false;
    this._transaction._request(this._source, () => this._iterate(null, null, Math.trunc(n)), this._request);
  }

  continue(key) {
    this._again();
    let target = null;
    if (key !== undefined) {
      target = requireKey(key);
      const c = compareKeys(target, this._key);
      if (this._direction.startsWith("next") ? c <= 0 : c >= 0) {
        throw dataError("The key is not past the cursor's position in its direction.");
      }
    }
    this._gotValue = false;
    this._transaction._request(this._source, () => this._iterate(target, null, 1), this._request);
  }

  continuePrimaryKey(key, primaryKey) {
    if (arguments.length < 2) throw new TypeError("continuePrimaryKey: 2 arguments required");
    this._again();
    if (!(this._source instanceof IDBIndex)) throw domError("InvalidAccessError", "The cursor's source is not an index.");
    if (this._direction.endsWith("unique")) throw domError("InvalidAccessError", "The cursor's direction is unique.");
    const target = requireKey(key);
    const primary = requireKey(primaryKey);
    const c = compareKeys(target, this._key);
    const forward = this._direction === "next";
    if (forward ? c < 0 : c > 0) throw dataError("The key is not past the cursor's position.");
    if (c === 0) {
      const p = compareKeys(primary, this._primaryKey);
      if (forward ? p <= 0 : p >= 0) throw dataError("The primary key is not past the cursor's position.");
    }
    this._gotValue = false;
    this._transaction._request(this._source, () => this._iterate(target, primary, 1), this._request);
  }

  update(value) {
    if (arguments.length < 1) throw new TypeError("IDBCursor.update: 1 argument required");
    const tx = this._transaction;
    tx._assertActive();
    tx._assertWritable();
    if (!this._gotValue || !(this instanceof IDBCursorWithValue)) {
      throw domError("InvalidStateError", "The cursor is not at a record with a value.");
    }
    const store = this._source instanceof IDBIndex ? this._source._store : this._source;
    const state = store._state;
    const form = serialize(value);
    if (state.keyPath !== null) {
      const key = extractKey(deserialize(form), state.keyPath);
      if (key === null || compareKeys(key, this._primaryKey) !== 0) {
        throw dataError("The value's key is not the cursor's primary key.");
      }
    }
    const primary = this._primaryKey;
    return tx._request(this, () => toValue(storeRecord(tx, state, form, primary, false)));
  }

  delete() {
    const tx = this._transaction;
    tx._assertActive();
    tx._assertWritable();
    if (!this._gotValue || !(this instanceof IDBCursorWithValue)) {
      throw domError("InvalidStateError", "The cursor is not at a record with a value.");
    }
    const store = this._source instanceof IDBIndex ? this._source._store : this._source;
    const primary = this._primaryKey;
    return tx._request(this, () => {
      deleteRange(tx, store._state, toKeyRange(toValue(primary)));
      return undefined;
    });
  }
}

export class IDBCursorWithValue extends IDBCursor {
  get value() { return this._gotValue ? deserialize(this._valueForm) : undefined; }
}

// ---- Connections ----------------------------------------------------------------------------------------------

export class IDBDatabase extends EventTarget {
  constructor(token, factory, state) {
    if (token !== TOKEN) throw new TypeError("Illegal constructor");
    super();
    this._factory = factory;
    this._state = state;
    this._version = state.version;
    this._closePending = false;
    this._upgrade = null;
    this.onabort = null;
    this.onclose = null;
    this.onerror = null;
    this.onversionchange = null;
  }
  get name() { return this._state.name; }
  get version() { return this._version; }
  get objectStoreNames() { return new DOMStringList(TOKEN, [...this._state.stores.keys()]); }

  transaction(storeNames, mode = "readonly", options = {}) {
    if (arguments.length < 1) throw new TypeError("IDBDatabase.transaction: 1 argument required");
    if (this._upgrade && this._upgrade._state !== "finished") {
      throw domError("InvalidStateError", "A versionchange transaction is running.");
    }
    if (this._closePending) throw domError("InvalidStateError", "The connection is closing.");
    const names = typeof storeNames === "string" ? [storeNames]
      : Array.from(storeNames, String);
    const scope = [...new Set(names)];
    for (const name of scope) {
      if (!this._state.stores.has(name)) throw domError("NotFoundError", `No objectStore named ${name}.`);
    }
    mode = String(mode);
    if (mode !== "readonly" && mode !== "readwrite") throw new TypeError(`The mode "${mode}" is not a valid IDBTransactionMode.`);
    if (scope.length === 0) throw domError("InvalidAccessError", "The transaction's scope is empty.");
    const durability = options && options.durability !== undefined ? String(options.durability) : "default";
    const tx = new IDBTransaction(TOKEN, this, scope, mode, durability);
    this._state.transactions.push(tx);
    this._factory._startNext(this._state);
    return tx;
  }

  close() {
    this._closePending = true;
    this._state.connections.delete(this);
    this._factory._connectionClosed(this._state);
  }

  createObjectStore(name, options = {}) {
    if (arguments.length < 1) throw new TypeError("IDBDatabase.createObjectStore: 1 argument required");
    name = String(name);
    const tx = this._upgrade;
    if (!tx || tx._state === "finished") throw domError("InvalidStateError", "Not in a versionchange transaction.");
    tx._assertActive();
    const keyPath = normalizeKeyPath(options && options.keyPath !== undefined ? options.keyPath : null);
    if (keyPath !== null && !isValidKeyPath(keyPath)) throw domError("SyntaxError", "The keyPath is not a valid key path.");
    const stores = this._state.stores;
    if (stores.has(name)) throw domError("ConstraintError", `An objectStore named ${name} already exists.`);
    const autoIncrement = !!(options && options.autoIncrement);
    if (autoIncrement && (keyPath === "" || Array.isArray(keyPath))) {
      throw domError("InvalidAccessError", "An autoIncrement store's keyPath cannot be empty or a list.");
    }
    const state = new StoreState(name, keyPath, autoIncrement);
    stores.set(name, state);
    tx._dirty = true;
    tx._undo.push(() => { stores.delete(name); });
    return tx.objectStore(name);
  }

  deleteObjectStore(name) {
    if (arguments.length < 1) throw new TypeError("IDBDatabase.deleteObjectStore: 1 argument required");
    name = String(name);
    const tx = this._upgrade;
    if (!tx || tx._state === "finished") throw domError("InvalidStateError", "Not in a versionchange transaction.");
    tx._assertActive();
    const state = this._state.stores.get(name);
    if (!state) throw domError("NotFoundError", `No objectStore named ${name}.`);
    this._state.stores.delete(name);
    const wrapper = tx._stores.get(state);
    if (wrapper) wrapper._deleted = true;
    tx._dirty = true;
    tx._undo.push(() => { this._state.stores.set(name, state); if (wrapper) wrapper._deleted = false; });
  }
}

// ---- The factory ----------------------------------------------------------------------------------------------

export class IDBFactory {
  constructor(token, storage) {
    if (token !== TOKEN) throw new TypeError("Illegal constructor");
    this._storage = storage;
    this._databases = new Map(); // name -> DatabaseState
    this._queues = new Map(); // name -> promise chain of open/delete requests
    this._writes = new Map(); // name -> promise of the last write
  }

  _queue(name, work) {
    const previous = this._queues.get(name) || Promise.resolve();
    const next = previous.then(work, work);
    this._queues.set(name, next.catch(() => {}));
    return next;
  }

  async _load(name) {
    let db = this._databases.get(name);
    if (db) return db;
    const data = await this._storage.load(name);
    db = data ? DatabaseState.fromJSON(data) : new DatabaseState(name);
    this._databases.set(name, db);
    return db;
  }

  _persist(db) {
    const data = db.toJSON();
    const previous = this._writes.get(db.name) || Promise.resolve();
    const write = previous.then(() => this._storage.save(db.name, data));
    this._writes.set(db.name, write.catch(() => {}));
    return write;
  }

  _startNext(db) {
    const head = db.transactions[0];
    if (head && !head._started) head._start();
  }

  _connectionClosed(db) {
    if (db._waitingForClose) db._waitingForClose();
  }

  /// Fire versionchange at the other connections, and wait until they have all closed (firing blocked at `request`
  /// while one is open after its event).
  async _closeOthers(db, request, oldVersion, newVersion, except = null) {
    const others = [...db.connections].filter((c) => c !== except && !c._closePending);
    for (const connection of others) {
      if (!connection._closePending) {
        dispatch([connection], new IDBVersionChangeEvent("versionchange", { oldVersion, newVersion }));
      }
    }
    await new Promise((resolve) => later(resolve));
    if ([...db.connections].some((c) => c !== except && !c._closePending)) {
      dispatch([request], new IDBVersionChangeEvent("blocked", { oldVersion, newVersion }));
      await new Promise((resolve) => {
        db._waitingForClose = () => {
          if (![...db.connections].some((c) => c !== except && !c._closePending)) {
            db._waitingForClose = null;
            resolve();
          }
        };
        // A blocked listener may have closed them already.
        db._waitingForClose();
      });
    }
  }

  open(name, version) {
    if (arguments.length < 1) throw new TypeError("IDBFactory.open: 1 argument required");
    name = String(name);
    if (version !== undefined) {
      const n = Number(version);
      if (!Number.isFinite(n) || Math.trunc(n) < 1 || Math.trunc(n) > Number.MAX_SAFE_INTEGER) {
        throw new TypeError("The version is not a positive integer.");
      }
      version = Math.trunc(n);
    }
    const request = new IDBOpenDBRequest(TOKEN);
    this._queue(name, async () => {
      const db = await this._load(name);
      const target = version === undefined ? (db.exists || db.version > 0 ? db.version : 1) : version;
      if (db.version > target) {
        request._done = true;
        request._error = domError("VersionError", `The database is at version ${db.version}, above ${target}.`);
        dispatch([request], new IDBEvent("error", { bubbles: true, cancelable: true }));
        return;
      }
      const connection = new IDBDatabase(TOKEN, this, db);
      db.connections.add(connection);
      if (db.version < target) {
        await this._upgrade(db, connection, request, target);
        return;
      }
      request._done = true;
      request._result = connection;
      dispatch([request], new IDBEvent("success", { bubbles: false, cancelable: false }));
    });
    return request;
  }

  async _upgrade(db, connection, request, version) {
    const oldVersion = db.version;
    await this._closeOthers(db, request, oldVersion, version, connection);
    // Wait for the transactions already queued to finish.
    while (db.transactions.length) {
      await new Promise((resolve) => { db.transactions[db.transactions.length - 1]._onFinished = resolve; });
    }
    const tx = new IDBTransaction(TOKEN, connection, [], "versionchange", "default", true);
    connection._upgrade = tx;
    const existed = db.exists;
    db.version = version;
    connection._version = version;
    tx._dirty = true;
    tx._undo.push(() => {
      db.version = oldVersion;
      connection._version = oldVersion;
    });
    db.transactions.push(tx);
    await new Promise((resolve) => {
      tx._onFinished = resolve;
      request._done = true;
      request._result = connection;
      request._transaction = tx;
      tx._started = true; // its requests run once the event has been dispatched
      later(() => {
        tx._state = "active";
        const threw = dispatch([request], new IDBVersionChangeEvent("upgradeneeded", { oldVersion, newVersion: version }));
        if (tx._state === "active") tx._state = "inactive";
        if (threw) tx._abort(domError("AbortError", "An upgradeneeded listener threw."));
        else tx._step();
      });
    });
    request._transaction = null;
    if (tx._aborted) {
      connection._closePending = true;
      db.connections.delete(connection);
      if (!existed) this._databases.delete(db.name);
      request._result = undefined;
      request._error = domError("AbortError", "The versionchange transaction was aborted.");
      dispatch([request], new IDBEvent("error", { bubbles: true, cancelable: true }));
      return;
    }
    connection._upgrade = null;
    dispatch([request], new IDBEvent("success", { bubbles: false, cancelable: false }));
  }

  deleteDatabase(name) {
    if (arguments.length < 1) throw new TypeError("IDBFactory.deleteDatabase: 1 argument required");
    name = String(name);
    const request = new IDBOpenDBRequest(TOKEN);
    this._queue(name, async () => {
      const db = await this._load(name);
      const oldVersion = db.version;
      await this._closeOthers(db, request, oldVersion, null);
      this._databases.delete(name);
      await (this._writes.get(name) || Promise.resolve());
      await this._storage.remove(name);
      request._done = true;
      request._result = undefined;
      dispatch([request], new IDBVersionChangeEvent("success", { oldVersion, newVersion: null }));
    });
    return request;
  }

  databases() {
    return (async () => {
      const found = new Map();
      for (const entry of await this._storage.list()) found.set(entry.name, entry.version);
      for (const db of this._databases.values()) {
        if (db.exists || db.version > 0) found.set(db.name, db.version);
      }
      return [...found].map(([name, version]) => ({ name, version }));
    })();
  }

  cmp(first, second) {
    if (arguments.length < 2) throw new TypeError("IDBFactory.cmp: 2 arguments required");
    return compareKeys(requireKey(first), requireKey(second));
  }
}

export function createIndexedDB(storage) {
  return new IDBFactory(TOKEN, storage);
}

export { IDBKeyRange };
