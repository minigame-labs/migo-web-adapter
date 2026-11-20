// ReadableStream (WHATWG Streams): the part a page uses to read a body as it arrives and to make a body of its own.
//
// Engines that download big files read `response.body` chunk by chunk to show progress, and hand on what they read as a
// new Response over a ReadableStream of their own: Godot's web loader does both for its .wasm and .pck, and stops with
// "Fetch - Check web browser version" where `Response.prototype` has no `body`. The runtime has no WHATWG stream, so this
// is one: a default reader (read, releaseLock, cancel, closed), an underlying source's start / pull / cancel with a
// controller's enqueue / close / error, async iteration, tee (what Response.clone() of a streamed body is). Byte streams,
// BYOB readers and pipes are not modelled; there is one chunk of queue (the high-water mark is 1).

export class ReadableStream {
  constructor(source = {}, _strategy = undefined) {
    this._source = source || {};
    this._queue = [];
    this._state = "readable";
    this._error = undefined;
    this._closeRequested = false;
    this._started = false;
    this._pulling = false;
    this._pullAgain = false;
    this._reader = null;
    this._requests = [];
    this._disturbed = false;
    const stream = this;
    this._controller = {
      enqueue(chunk) { stream._enqueue(chunk); },
      close() { stream._requestClose(); },
      error(reason) { stream._fail(reason); },
      get desiredSize() {
        if (stream._state === "errored") return null;
        if (stream._state === "closed") return 0;
        return 1 - stream._queue.length;
      },
    };
    let started;
    try {
      started = typeof this._source.start === "function" ? this._source.start(this._controller) : undefined;
    } catch (e) {
      this._fail(e);
      return;
    }
    Promise.resolve(started).then(
      () => { this._started = true; this._pullIfNeeded(); },
      (e) => this._fail(e),
    );
  }

  get locked() { return this._reader !== null; }

  getReader(options) {
    if (options && options.mode === "byob") throw new TypeError("ReadableStream: BYOB readers are not supported");
    if (this._reader) throw new TypeError("ReadableStream is locked to a reader");
    this._reader = new ReadableStreamDefaultReader(this);
    return this._reader;
  }

  cancel(reason) {
    if (this._reader) return Promise.reject(new TypeError("ReadableStream is locked to a reader"));
    return this._cancel(reason);
  }

  async *[Symbol.asyncIterator]() {
    const reader = this.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  values() { return this[Symbol.asyncIterator](); }

  /// Two streams that each give every chunk of this one, which is locked to them from here on. A chunk is the same
  /// object in both, as the specification's default tee has it.
  tee() {
    const reader = this.getReader();
    const controllers = [null, null];
    const cancelled = [false, false];
    let reading = null;
    const pullFromSource = () => {
      if (reading) return reading;
      reading = reader.read().then(({ value, done }) => {
        reading = null;
        for (let k = 0; k < 2; k++) {
          if (cancelled[k]) continue;
          if (done) controllers[k].close();
          else controllers[k].enqueue(value);
        }
      }, (e) => {
        reading = null;
        for (let k = 0; k < 2; k++) if (!cancelled[k]) controllers[k].error(e);
      });
      return reading;
    };
    const branch = (k) => new ReadableStream({
      start(controller) { controllers[k] = controller; },
      pull() { return pullFromSource(); },
      cancel(reason) {
        cancelled[k] = true;
        if (cancelled[0] && cancelled[1]) return reader.cancel(reason);
        return undefined;
      },
    });
    return [branch(0), branch(1)];
  }

  _cancel(reason) {
    this._disturbed = true;
    if (this._state === "closed") return Promise.resolve();
    if (this._state === "errored") return Promise.reject(this._error);
    this._queue = [];
    this._close();
    const cancelled = typeof this._source.cancel === "function" ? this._source.cancel(reason) : undefined;
    return Promise.resolve(cancelled).then(() => undefined);
  }

  _enqueue(chunk) {
    if (this._state !== "readable" || this._closeRequested) throw new TypeError("ReadableStream: enqueue after close");
    const request = this._requests.shift();
    if (request) request.resolve({ value: chunk, done: false });
    else this._queue.push(chunk);
    this._pullIfNeeded();
  }

  _requestClose() {
    if (this._state !== "readable" || this._closeRequested) throw new TypeError("ReadableStream: close after close");
    this._closeRequested = true;
    if (this._queue.length === 0) this._close();
  }

  _close() {
    this._state = "closed";
    for (const request of this._requests.splice(0)) request.resolve({ value: undefined, done: true });
    if (this._reader) this._reader._settleClosed(true);
  }

  _fail(reason) {
    if (this._state !== "readable") return;
    this._state = "errored";
    this._error = reason;
    this._queue = [];
    for (const request of this._requests.splice(0)) request.reject(reason);
    if (this._reader) this._reader._settleClosed(false, reason);
  }

  _read() {
    this._disturbed = true;
    if (this._queue.length > 0) {
      const value = this._queue.shift();
      if (this._closeRequested && this._queue.length === 0) this._close();
      else this._pullIfNeeded();
      return Promise.resolve({ value, done: false });
    }
    if (this._state === "closed") return Promise.resolve({ value: undefined, done: true });
    if (this._state === "errored") return Promise.reject(this._error);
    const read = new Promise((resolve, reject) => this._requests.push({ resolve, reject }));
    this._pullIfNeeded();
    return read;
  }

  _pullIfNeeded() {
    if (!this._started || this._state !== "readable" || this._closeRequested) return;
    if (typeof this._source.pull !== "function") return;
    if (this._queue.length >= 1 && this._requests.length === 0) return;
    if (this._pulling) { this._pullAgain = true; return; }
    this._pulling = true;
    let pulled;
    try {
      pulled = this._source.pull(this._controller);
    } catch (e) {
      this._fail(e);
      return;
    }
    Promise.resolve(pulled).then(() => {
      this._pulling = false;
      if (this._pullAgain) { this._pullAgain = false; this._pullIfNeeded(); }
    }, (e) => this._fail(e));
  }
}

export class ReadableStreamDefaultReader {
  constructor(stream) {
    if (!(stream instanceof ReadableStream)) throw new TypeError("ReadableStreamDefaultReader needs a ReadableStream");
    if (stream._reader && stream._reader !== this) throw new TypeError("ReadableStream is locked to a reader");
    this._stream = stream;
    stream._reader = this;
    this.closed = new Promise((resolve, reject) => { this._closedResolve = resolve; this._closedReject = reject; });
    this.closed.catch(() => {});
    if (stream._state === "closed") this._settleClosed(true);
    if (stream._state === "errored") this._settleClosed(false, stream._error);
  }

  read() {
    if (!this._stream) return Promise.reject(new TypeError("ReadableStreamDefaultReader: the reader was released"));
    return this._stream._read();
  }

  releaseLock() {
    if (!this._stream) return;
    for (const request of this._stream._requests.splice(0)) request.reject(new TypeError("the reader was released"));
    this._stream._reader = null;
    this._stream = null;
  }

  cancel(reason) {
    if (!this._stream) return Promise.reject(new TypeError("ReadableStreamDefaultReader: the reader was released"));
    return this._stream._cancel(reason);
  }

  _settleClosed(ok, reason) {
    if (ok) this._closedResolve();
    else this._closedReject(reason);
  }
}

/// A stream of one chunk, `bytes`, then the end: a body held whole, as a stream.
export function streamOfBytes(bytes) {
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

/// Every chunk of `stream`, as one Uint8Array.
export async function readAllBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
    if (chunk === null) throw new TypeError("a body's stream gave a chunk that is not bytes");
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  reader.releaseLock();
  if (chunks.length === 1) return chunks[0].byteOffset === 0 && chunks[0].byteLength === chunks[0].buffer.byteLength ? chunks[0] : chunks[0].slice();
  const all = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { all.set(chunk, at); at += chunk.byteLength; }
  return all;
}
