import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bootstrapSource } from '../dist/bridge.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
class CustomEventDouble extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } }
class DocumentDouble extends EventTarget {
  constructor() { super(); this.hidden = false; this.listeners = new Map(); }
  addEventListener(type, callback, options) { super.addEventListener(type, callback, options); const entries = this.listeners.get(type) || []; entries.push(callback); this.listeners.set(type, entries); }
  removeEventListener(type, callback, options) { super.removeEventListener(type, callback, options); this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback)); }
  gesture(type, isTrusted) { for (const callback of this.listeners.get(type) || []) callback({ isTrusted }); }
}
function rig({ supported = true, boot = true } = {}) {
  const events = new EventTarget(), document = new DocumentDouble(), outgoing = [], hellos = [], revoked = [], intervals = new Map();
  let timerId = 0, urlId = 0;
  class AudioDouble extends EventTarget {
    constructor() { super(); this.state = 'running'; this.suspends = 0; this.resumes = 0; this.closes = 0; }
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
    performance: { now: () => performance.now() }, atob, console,
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
  return { sandbox, context, port, outgoing, hellos, revoked, intervals, document, parent, bootFrame, send, state, dispose: () => send({ type: 'dispose' }), AudioDouble, AnchorDouble };
}

test('bootstrap source escapes tag-breaking configuration and remains valid JavaScript', () => {
  const source = bootstrapSource({ nonce: '</script><script>bad()</script>\u2028', supported: true });
  assert.equal(source.includes('</script>'), false); assert.doesNotThrow(() => new vm.Script(source));
});

test('handshake rejects the wrong source/nonce and sends queued requests once over the private port', async t => {
  const r = rig({ boot: false }); t.after(() => r.dispose());
  assert.equal(r.hellos[0].type, 'midiroom:ready');
  const waiting = r.sandbox.navigator.requestMIDIAccess();
  r.bootFrame({}, 'session-a'); r.bootFrame(r.parent, 'wrong'); assert.equal(r.port.started, false);
  r.bootFrame(); assert.equal(r.port.started, true); assert.equal(r.intervals.size, 0);
  assert.equal(r.outgoing.filter(message => message.type === 'request-midi').length, 1);
  r.state(); const access = await waiting; assert.equal(access.inputs.size, 1);
});

test('virtual MIDI access waits for permission and exposes valid note/control events through implicit open', async t => {
  const r = rig(); t.after(() => r.dispose()); let resolved = false;
  const request = r.sandbox.navigator.requestMIDIAccess({ sysex: false }).then(access => { resolved = true; return access; });
  await tick(); assert.equal(resolved, false);
  r.state(); const access = await request; assert.equal(access.outputs.size, 0); assert.equal(access.sysexEnabled, false); assert.equal(access.inputs.set, undefined);
  const input = access.inputs.get('a'), messages = []; input.onmidimessage = event => messages.push(event);
  assert.equal(input.connection, 'open');
  r.send({ type: 'midi', inputId: 'a', data: [0x90, 60, 100], timestamp: 1 });
  r.send({ type: 'midi', inputId: 'a', data: [0xbf, 64, 127] });
  r.send({ type: 'midi', inputId: 'a', data: [0xf0, 1, 0xf7] });
  r.send({ type: 'midi', inputId: 'other', data: [0x90, 60, 100] });
  assert.equal(messages.length, 2); assert.deepEqual([...messages[0].data], [0x90, 60, 100]); assert.ok(messages[0].receivedTime >= 0);
  await input.close(); r.send({ type: 'midi', inputId: 'a', data: [0x80, 60, 0] }); assert.equal(messages.length, 2);
  await assert.rejects(r.sandbox.navigator.requestMIDIAccess({ sysex: true }), { name: 'NotSupportedError' });
});

test('hotplug updates maps and existing port references without replacing a reconnecting input', async t => {
  const r = rig(); t.after(() => r.dispose()); r.state(); const access = await r.sandbox.navigator.requestMIDIAccess();
  const input = access.inputs.get('a'), changes = []; access.onstatechange = event => changes.push(event.port.state); await input.open();
  r.state([]); assert.equal(input.state, 'disconnected'); assert.equal(input.connection, 'pending'); assert.equal(access.inputs.size, 0);
  r.state(); assert.equal(access.inputs.get('a'), input); assert.equal(input.connection, 'open'); assert.ok(changes.includes('disconnected')); assert.ok(changes.includes('connected'));
});

test('permission rejections reject only their request and a later request succeeds', async t => {
  const r = rig(); t.after(() => r.dispose()); const request = r.sandbox.navigator.requestMIDIAccess();
  const message = r.outgoing.find(item => item.type === 'request-midi');
  r.send({ type: 'midi-result', requestId: message.requestId, ok: false, error: { name: 'NotAllowedError', message: 'Permission denied.' } });
  await assert.rejects(request, { name: 'NotAllowedError' }); const retry = r.sandbox.navigator.requestMIDIAccess(); r.state(); await retry;
});

test('missing native MIDI rejects cleanly and excessive queued requests are bounded', async t => {
  const unsupported = rig({ supported: false }); t.after(() => unsupported.dispose());
  await assert.rejects(unsupported.sandbox.navigator.requestMIDIAccess(), { name: 'NotSupportedError' });
  assert.equal(unsupported.outgoing.some(message => message.type === 'request-midi'), false);
  const r = rig(); const pending = Array.from({ length: 32 }, () => r.sandbox.navigator.requestMIDIAccess().catch(error => error.name));
  await assert.rejects(r.sandbox.navigator.requestMIDIAccess(), { name: 'QuotaExceededError' }); r.dispose();
  assert.ok((await Promise.all(pending)).every(name => name === 'AbortError'));
});

test('soft panic releases every MIDI channel; hard Stop suspends audio until a trusted gesture', async t => {
  const r = rig(); t.after(() => r.dispose()); r.state(); const access = await r.sandbox.navigator.requestMIDIAccess(), messages = [], panics = [];
  access.inputs.get('a').onmidimessage = event => messages.push([...event.data]);
  r.sandbox.addEventListener('midiroom:panic', event => panics.push(event.detail.suspend));
  const audio = vm.runInContext('new AudioContext()', r.context); assert.ok(audio instanceof r.AudioDouble); assert.ok(audio instanceof r.sandbox.AudioContext);
  r.send({ type: 'panic', suspend: false }); assert.equal(audio.suspends, 0); assert.equal(messages.length, 80); assert.equal(panics[0], false);
  for (let ch = 0; ch < 16; ch++) assert.ok(messages.some(data => data[0] === (0xb0 | ch) && data[1] === 120));
  r.send({ type: 'panic' }); await tick(); assert.equal(audio.state, 'suspended'); assert.equal(panics[1], true);
  r.document.gesture('pointerdown', false); assert.equal(audio.resumes, 0);
  r.document.gesture('pointerdown', true); await tick(); assert.equal(audio.state, 'running');
  r.dispose(); assert.equal(audio.state, 'closed'); assert.equal(r.port.closed, true);
});

test('file sharing resolves only after the host confirms a save and propagates cancellation', async t => {
  const r = rig(); t.after(() => r.dispose()); const file = new Blob(['MThd'], { type: 'audio/midi' }); Object.defineProperty(file, 'name', { value: '../take.mid' });
  assert.equal(r.sandbox.navigator.canShare({ files: [file] }), true);
  let finished = false; const saving = r.sandbox.navigator.share({ files: [file] }).then(() => { finished = true; });
  await tick(); assert.equal(finished, false);
  const message = r.outgoing.find(item => item.type === 'save'); assert.equal(message.name, 'take.mid'); assert.equal(await message.blob.text(), 'MThd');
  r.send({ type: 'save-result', id: message.id, ok: true }); await saving; assert.equal(finished, true);
  const canceling = r.sandbox.navigator.share({ files: [file] }); const last = r.outgoing.filter(item => item.type === 'save').at(-1);
  r.send({ type: 'save-result', id: last.id, ok: false, error: { name: 'AbortError', message: 'Canceled.' } }); await assert.rejects(canceling, { name: 'AbortError' });
});

test('Blob download clicks pass a file safely even when the instrument immediately revokes its URL', async t => {
  const r = rig(); t.after(() => r.dispose()); const file = new Blob(['wave']), url = r.sandbox.URL.createObjectURL(file);
  const anchor = new r.AnchorDouble(); anchor.href = url; anchor.download = 'take.wav'; anchor.hasDownload = true; anchor.click(); r.sandbox.URL.revokeObjectURL(url);
  const message = r.outgoing.find(item => item.type === 'save'); assert.equal(message.name, 'take.wav'); assert.equal(await message.blob.text(), 'wave'); assert.equal(anchor.clicks, 0); assert.deepEqual(r.revoked, [url]);
  r.send({ type: 'save-result', id: message.id, ok: true });
  const external = new r.AnchorDouble(); external.href = 'https://example.invalid/file'; external.hasDownload = true; external.click(); assert.equal(external.clicks, 0);
  assert.equal(r.outgoing.filter(item => item.type === 'save').length, 1);
});

test('sharing validates the whole queue atomically and disposal cancels waiting exports', async () => {
  const r = rig(), file = new Blob(['x']);
  const first = r.sandbox.navigator.share({ files: [file, file] }).catch(error => error.name);
  const before = r.outgoing.filter(item => item.type === 'save').length;
  await assert.rejects(r.sandbox.navigator.share({ files: [file, file, file] }), { name: 'QuotaExceededError' });
  assert.equal(r.outgoing.filter(item => item.type === 'save').length, before);
  r.dispose(); assert.equal(await first, 'AbortError');
});
