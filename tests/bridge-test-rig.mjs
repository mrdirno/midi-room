import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bootstrapSource } from '../dist/bridge.js';

export const tick = () => new Promise(resolve => setImmediate(resolve));
class CustomEventDouble extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } }
class DocumentDouble extends EventTarget {
  constructor() { super(); this.hidden = false; this.listeners = new Map(); }
  addEventListener(type, callback, options) { super.addEventListener(type, callback, options); const entries = this.listeners.get(type) || []; entries.push(callback); this.listeners.set(type, entries); }
  removeEventListener(type, callback, options) { super.removeEventListener(type, callback, options); this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback)); }
  gesture(type, isTrusted) { for (const callback of this.listeners.get(type) || []) callback({ isTrusted }); }
}
export function rig({ supported = true, boot = true } = {}) {
  const events = new EventTarget(), document = new DocumentDouble(), outgoing = [], hellos = [], revoked = [], intervals = new Map();
  let timerId = 0, urlId = 0, monotonic = 1000;
  const timeouts = new Map();
  class AudioDouble extends EventTarget {
    constructor() { super(); this.state = 'running'; this.currentTime = 5; this.suspends = 0; this.resumes = 0; this.closes = 0; }
    suspend() { this.suspends++; this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
    resume() { this.resumes++; this.state = 'running'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
    close() { this.closes++; this.state = 'closed'; this.dispatchEvent(new Event('statechange')); return Promise.resolve(); }
  }
  class AnchorDouble { constructor() { this.href = ''; this.download = ''; this.hasDownload = false; this.clicks = 0; } hasAttribute(name) { return name === 'download' && this.hasDownload; } click() { this.clicks++; } }
  class URLDouble { static createObjectURL() { return 'blob:null/' + (++urlId); } static revokeObjectURL(url) { revoked.push(url); } }
  const parent = { postMessage: message => hellos.push(message) };
  const port = { started: false, closed: false, postMessage: message => outgoing.push(message), start() { this.started = true; }, close() { this.closed = true; }, onmessage: null };
  const sandbox = {
    parent, document, navigator: {}, EventTarget, Event, CustomEvent: CustomEventDouble, DOMException, Blob,
    Uint8Array, URL: URLDouble, HTMLAnchorElement: AnchorDouble, AudioContext: AudioDouble, webkitAudioContext: AudioDouble,
    performance: { timeOrigin: 1_700_000_000_000, now: () => monotonic }, atob, console,
    setTimeout: (callback, delay) => { timeouts.set(++timerId, {callback, at: monotonic + delay}); return timerId; }, clearTimeout: id => timeouts.delete(id),
    setInterval: callback => { intervals.set(++timerId, callback); return timerId; }, clearInterval: id => intervals.delete(id),
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events)
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(bootstrapSource({ nonce: 'session-a', supported }), context);
  const emitWindow = (type, fields) => { const event = new Event(type); Object.assign(event, fields); events.dispatchEvent(event); };
  const bootFrame = (source = parent, nonce = 'session-a', selectedPort = port) => emitWindow('message', { source, data: { type: 'midiroom:boot', nonce }, ports: [selectedPort] });
  const send = message => port.onmessage?.({ data: message });
  const state = (inputs = [{ id: 'a', name: 'Keyboard', state: 'connected' }]) => send({ type: 'midi-state', state: { access: true, inputs, selection: 'auto' } });
  if (boot) bootFrame();
  const advance = amount => { monotonic += amount; for (const [id, timer] of [...timeouts]) if (timer.at <= monotonic) { timeouts.delete(id); timer.callback(); } };
  return { advance, timeouts, sandbox, context, port, outgoing, hellos, revoked, intervals, document, parent, bootFrame, send, state, dispose: () => send({ type: 'dispose' }), AudioDouble, AnchorDouble };
}

