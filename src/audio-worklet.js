// AudioWorklet over the runtime's ScriptProcessorNode.
//
// The platform's WebAudioContext has no audioWorklet: its API reference names none, and createScriptProcessor is how it
// runs script on audio. A web game that uses a worklet stops at `ctx.audioWorklet.addModule` -- Godot 4's web export
// loads its position-reporting processor whatever its audio driver, and its default driver is a worklet.
//
// Here the processors run on the game's own thread, on a ScriptProcessorNode: each of its blocks is cut into the
// 128-frame render quanta a processor's process() is called with. What content sees is the AudioWorklet API --
// addModule, registerProcessor, AudioWorkletProcessor and its port, AudioWorkletNode with its port and parameters. What
// it costs is the ScriptProcessorNode's latency (two blocks of BLOCK frames) and that a processor shares the game's
// thread, which is where a single-threaded web export's audio is mixed anyway.

import { readScript } from "./worker.js";
import DOMException from "./dom-exception.js";

const QUANTUM = 128;
// Frames per ScriptProcessorNode block: four quanta. Smaller than a game's own output buffer (Godot's is about 1024
// frames), so a block never asks for more than the processor has been given; ~21 ms of latency at 48 kHz.
const BLOCK = 512;

// --- MessagePort, in-thread -------------------------------------------------------------------------------------------

/// A copy of `value` as postMessage would deliver it: a structured clone of the kinds a game posts to its processor.
function cloneMessage(value, seen = new Map()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  let copy;
  if (ArrayBuffer.isView(value)) {
    copy = value.slice();
  } else if (value instanceof ArrayBuffer) {
    copy = value.slice(0);
  } else if (Array.isArray(value)) {
    copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneMessage(item, seen));
    return copy;
  } else if (value instanceof Map) {
    copy = new Map();
    seen.set(value, copy);
    for (const [k, v] of value) copy.set(cloneMessage(k, seen), cloneMessage(v, seen));
    return copy;
  } else if (value instanceof Set) {
    copy = new Set();
    seen.set(value, copy);
    for (const v of value) copy.add(cloneMessage(v, seen));
    return copy;
  } else if (value instanceof Date) {
    copy = new Date(value.getTime());
  } else {
    copy = {};
    seen.set(value, copy);
    for (const key of Object.keys(value)) copy[key] = cloneMessage(value[key], seen);
    return copy;
  }
  seen.set(value, copy);
  return copy;
}

class WorkletPort {
  constructor() {
    this._peer = null;
    this._listeners = [];
    this._closed = false;
    this.onmessage = null;
    this.onmessageerror = null;
  }

  /// Delivered to the other end on a later microtask, as a copy: after the caller's own code has run, before the next
  /// block -- what a message between the game and the audio thread amounts to here.
  postMessage(message) {
    const peer = this._peer;
    if (this._closed || peer === null || peer._closed) return;
    const data = cloneMessage(message);
    queueMicrotask(() => peer._deliver(data));
  }

  _deliver(data) {
    if (this._closed) return;
    const event = { type: "message", data, target: this, currentTarget: this, ports: [] };
    for (const handler of [this.onmessage, ...this._listeners]) {
      if (typeof handler !== "function") continue;
      try {
        handler.call(this, event);
      } catch (error) {
        console.error("[migo-web-adapter] an AudioWorklet message handler threw:", error);
      }
    }
  }

  addEventListener(type, listener) {
    if (type === "message" && typeof listener === "function" && !this._listeners.includes(listener)) this._listeners.push(listener);
  }

  removeEventListener(type, listener) {
    if (type !== "message") return;
    const at = this._listeners.indexOf(listener);
    if (at !== -1) this._listeners.splice(at, 1);
  }

  start() {}

  close() {
    this._closed = true;
  }
}

function portPair() {
  const a = new WorkletPort();
  const b = new WorkletPort();
  a._peer = b;
  b._peer = a;
  return [a, b];
}

// --- AudioParam for a processor's parameterDescriptors ---------------------------------------------------------------

/// A parameter as a processor sees it: one value per quantum (k-rate), taken from the events scheduled on it.
class WorkletParam {
  constructor(descriptor, initial) {
    this.defaultValue = descriptor.defaultValue ?? 0;
    this.minValue = descriptor.minValue ?? -3.4028234663852886e38;
    this.maxValue = descriptor.maxValue ?? 3.4028234663852886e38;
    this.automationRate = descriptor.automationRate ?? "a-rate";
    this._value = initial ?? this.defaultValue;
    this._events = [];
  }

  get value() {
    return this._value;
  }

  set value(v) {
    this._events.length = 0;
    this._value = Number(v);
  }

  setValueAtTime(value, time) {
    this._events.push({ time: Number(time), value: Number(value) });
    this._events.sort((x, y) => x.time - y.time);
    return this;
  }

  // Ramps arrive at their value at their end time: a k-rate approximation.
  linearRampToValueAtTime(value, time) {
    return this.setValueAtTime(value, time);
  }

  exponentialRampToValueAtTime(value, time) {
    return this.setValueAtTime(value, time);
  }

  setTargetAtTime(value, time) {
    return this.setValueAtTime(value, time);
  }

  cancelScheduledValues(time) {
    this._events = this._events.filter((event) => event.time < Number(time));
    return this;
  }

  _at(time) {
    while (this._events.length > 0 && this._events[0].time <= time) this._value = this._events.shift().value;
    return Math.min(this.maxValue, Math.max(this.minValue, this._value));
  }
}

// --- AudioWorklet, one per context ----------------------------------------------------------------------------------

let constructingPort = null;

/// The base of the processors content registers. Its port is the one the node being constructed holds the other end of.
class AudioWorkletProcessor {
  constructor() {
    if (constructingPort === null) throw new TypeError("AudioWorkletProcessor is constructed by an AudioWorkletNode");
    this.port = constructingPort;
  }
}

class AudioWorklet {
  constructor(context) {
    this._context = context;
    this._processors = new Map();
    const worklet = this;
    // AudioWorkletGlobalScope: what a processor script sees before the game's globals.
    this._scope = {
      AudioWorkletProcessor,
      registerProcessor(name, processor) {
        name = String(name);
        if (name === "") throw new DOMException("a processor needs a name", "NotSupportedError");
        if (worklet._processors.has(name)) throw new DOMException(`a processor "${name}" is already registered`, "NotSupportedError");
        if (typeof processor !== "function" || !(processor.prototype instanceof AudioWorkletProcessor || processor === AudioWorkletProcessor)) {
          throw new TypeError("registerProcessor takes a class extending AudioWorkletProcessor");
        }
        const descriptors = processor.parameterDescriptors;
        worklet._processors.set(name, { processor, descriptors: Array.isArray(descriptors) ? descriptors : [] });
      },
      sampleRate: context.sampleRate,
      currentFrame: 0,
      currentTime: 0,
    };
  }

  /// Evaluates the processor script at `url` (a path in the game's package, a blob: or data: URL) in the worklet's
  /// scope. Rejects with what stopped it.
  addModule(url) {
    try {
      const source = readScript(url);
      const run = new Function("__migoWorkletScope", "with (__migoWorkletScope) {\n" + source + "\n}");
      run.call(this._scope, this._scope);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

const worklets = new WeakMap();
function workletOf(context) {
  let worklet = worklets.get(context);
  if (worklet === undefined) {
    worklet = new AudioWorklet(context);
    worklets.set(context, worklet);
  }
  return worklet;
}

// --- AudioWorkletNode -----------------------------------------------------------------------------------------------

const nodeState = new WeakMap();
// The worklet nodes something is connected into: only those hand their processor an input with channels, as a node
// with nothing connected gets an input of none.
const fed = new WeakSet();

function runBlock(node, event) {
  const state = nodeState.get(node);
  if (!state || !state.active) return;
  const { worklet, processor, parameters, inputChannels, outputChannels } = state;
  const scope = worklet._scope;
  const rate = scope.sampleRate;
  const inputData = [];
  for (let c = 0; c < inputChannels; c++) inputData.push(event.inputBuffer.getChannelData(c));
  const outputData = [];
  for (let c = 0; c < outputChannels; c++) outputData.push(event.outputBuffer.getChannelData(c));
  const values = {};
  for (let at = 0; at + QUANTUM <= event.outputBuffer.length; at += QUANTUM) {
    scope.currentTime = event.playbackTime + at / rate;
    scope.currentFrame = Math.round(scope.currentTime * rate);
    const inputs = state.numberOfInputs === 0 ? [] : [fed.has(node) ? inputData.map((d) => d.subarray(at, at + QUANTUM)) : []];
    const outputs = state.numberOfOutputs === 0 ? [] : [outputData.map((d) => d.subarray(at, at + QUANTUM))];
    for (const [name, param] of parameters) {
      const block = values[name] || (values[name] = new Float32Array(1));
      block[0] = param._at(scope.currentTime);
    }
    let keepGoing;
    try {
      keepGoing = processor.process(inputs, outputs, values);
    } catch (error) {
      state.active = false;
      console.error("[migo-web-adapter] AudioWorkletProcessor.process threw:", error);
      const handler = node.onprocessorerror;
      if (typeof handler === "function") {
        try {
          handler.call(node, { type: "processorerror", error, target: node, currentTarget: node });
        } catch (e) {
          console.error("[migo-web-adapter] onprocessorerror threw:", e);
        }
      }
      return;
    }
    if (!keepGoing) {
      state.active = false;
      return;
    }
  }
}

export function installAudioWorklet(global) {
  const AudioContextClass = global.AudioContext;
  const ScriptProcessorNode = global.ScriptProcessorNode;
  const AudioNode = global.AudioNode;
  if (typeof AudioContextClass !== "function" || typeof ScriptProcessorNode !== "function") return {};
  const base = Object.getPrototypeOf(AudioContextClass.prototype) && "createScriptProcessor" in Object.getPrototypeOf(AudioContextClass.prototype)
    ? Object.getPrototypeOf(AudioContextClass.prototype)
    : AudioContextClass.prototype;
  if ("audioWorklet" in base) return {};

  Object.defineProperty(base, "audioWorklet", {
    get() {
      return workletOf(this);
    },
    enumerable: true,
    configurable: true,
  });

  // A connection into a worklet node is what gives its processor an input.
  if (AudioNode && typeof AudioNode.prototype.connect === "function" && !AudioNode.prototype.connect._migoWorkletAware) {
    const connect = AudioNode.prototype.connect;
    const wrapped = function (destination, ...rest) {
      if (destination && nodeState.has(destination)) fed.add(destination);
      return connect.call(this, destination, ...rest);
    };
    wrapped._migoWorkletAware = true;
    AudioNode.prototype.connect = wrapped;
  }

  function AudioWorkletNode(context, name, options = {}) {
    if (!new.target) throw new TypeError("AudioWorkletNode must be constructed with new");
    const worklet = workletOf(context);
    const definition = worklet._processors.get(String(name));
    if (!definition) throw new DOMException(`no processor "${name}" is registered: addModule first`, "InvalidStateError");
    const numberOfInputs = options.numberOfInputs ?? 1;
    const numberOfOutputs = options.numberOfOutputs ?? 1;
    if (numberOfInputs > 1 || numberOfOutputs > 1) {
      throw new DOMException("an AudioWorkletNode here has at most one input and one output", "NotSupportedError");
    }
    if (numberOfInputs === 0 && numberOfOutputs === 0) {
      throw new DOMException("an AudioWorkletNode needs an input or an output", "NotSupportedError");
    }
    const inputChannels = numberOfInputs === 0 ? 0 : (options.channelCount ?? 2);
    const outputChannels = numberOfOutputs === 0
      ? 0
      : (Array.isArray(options.outputChannelCount) && options.outputChannelCount.length > 0 ? options.outputChannelCount[0] : inputChannels || 1);

    const node = context.createScriptProcessor(BLOCK, inputChannels, outputChannels);
    Object.setPrototypeOf(node, new.target.prototype);

    const [nodePort, processorPort] = portPair();
    const parameters = new Map();
    const initial = options.parameterData || {};
    for (const descriptor of definition.descriptors) {
      parameters.set(descriptor.name, new WorkletParam(descriptor, initial[descriptor.name]));
    }
    constructingPort = processorPort;
    let processor;
    try {
      processor = new definition.processor({
        numberOfInputs,
        numberOfOutputs,
        outputChannelCount: [outputChannels],
        parameterData: initial,
        processorOptions: cloneMessage(options.processorOptions),
      });
    } finally {
      constructingPort = null;
    }
    nodeState.set(node, {
      worklet, processor, parameters, inputChannels, outputChannels, numberOfInputs, numberOfOutputs,
      port: nodePort, active: true, onprocessorerror: null,
    });
    node.addEventListener("audioprocess", (event) => runBlock(node, event));
    // An AudioWorkletNode is processed whether or not anything downstream reads it (a node that only reports, like
    // Godot's position processor, is connected to nothing): a silent path to the destination keeps it in the graph.
    const keepAlive = context.createGain();
    keepAlive.gain.value = 0;
    ScriptProcessorNode.prototype.connect.call(node, keepAlive);
    keepAlive.connect(context.destination);
    return node;
  }
  AudioWorkletNode.prototype = Object.create(ScriptProcessorNode.prototype, {
    constructor: { value: AudioWorkletNode, writable: true, configurable: true },
    port: { get() { return nodeState.get(this)?.port; }, enumerable: true, configurable: true },
    parameters: { get() { return nodeState.get(this)?.parameters; }, enumerable: true, configurable: true },
    onprocessorerror: {
      get() { return nodeState.get(this)?.onprocessorerror ?? null; },
      set(handler) { const state = nodeState.get(this); if (state) state.onprocessorerror = typeof handler === "function" ? handler : null; },
      enumerable: true,
      configurable: true,
    },
  });

  return { AudioWorkletNode, AudioWorkletProcessor };
}

export { AudioWorkletProcessor };
