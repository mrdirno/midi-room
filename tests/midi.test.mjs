import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiBroker, validChannelMessage } from '../dist/midi.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
class Port extends EventTarget {
  constructor(id, access) { super(); this.id = id; this.name = 'Controller ' + id; this.manufacturer = 'Test'; this.state = 'connected'; this.connection = 'closed'; this.access = access; this.opens = 0; this.closes = 0; this.rejectOpen = false; }
  open() { this.opens++; if (this.rejectOpen) return Promise.reject(new Error('Device is busy.')); if (this.connection !== 'open') { this.connection = 'open'; this.access.dispatchEvent(new Event('statechange')); } return Promise.resolve(this); }
  close() { this.closes++; if (this.connection !== 'closed') { this.connection = 'closed'; this.access.dispatchEvent(new Event('statechange')); } return Promise.resolve(this); }
  play(data) { const event = new Event('midimessage'); Object.assign(event, { data: new Uint8Array(data), receivedTime: 42 }); this.dispatchEvent(event); }
}
function rig(ids = ['a', 'b'], options = {}) {
  const access = new EventTarget(); access.inputs = new Map();
  for (const id of ids) access.inputs.set(id, new Port(id, access));
  let requests = 0; const states = [], messages = [], events = [];
  const broker = new MidiBroker({
    requestAccess: options => { requests++; assert.equal(options.sysex, false); return Promise.resolve(access); },
    onState: state => { states.push(state); events.push('state:' + state.inputs.map(p => p.id).join(',')); },
    onMIDI: message => messages.push(message), onPanic: () => events.push('panic'), ...options
  });
  return { access, broker, states, messages, events, requests: () => requests };
}

test('channel validator accepts notes/controllers/wheels and rejects malformed or system data', () => {
  for (const data of [[0x90, 60, 127], [0x90, 60, 0], [0x80, 60, 0], [0xbf, 64, 127], [0xef, 0, 64], [0xc0, 12], [0xdf, 99]]) assert.equal(validChannelMessage(data), true);
  for (const data of [[], [0x90, 60], [0xc0, 1, 2], [0x70, 60, 1], [0xf0, 1, 0xf7], [0xf8], [0x90, 128, 1], [0x90, -1, 1], [0x90, 1.5, 1], [0x90, 1, NaN], 'abc']) assert.equal(validChannelMessage(data), false);
});

test('Connect preserves activation and is idempotent; Auto listens to every input', async t => {
  const r = rig(); t.after(() => r.broker.dispose());
  assert.equal(r.requests(), 0);
  const first = r.broker.connect(), second = r.broker.connect();
  assert.equal(first, second); await first; await tick();
  assert.equal(r.requests(), 1); assert.deepEqual(r.broker.getState().inputs.map(p => p.id), ['a', 'b']);
  r.access.inputs.get('a').play([0x90, 60, 100]); r.access.inputs.get('b').play([0x90, 61, 100]);
  assert.equal(r.messages.length, 2); assert.equal(r.messages[0].inputId, 'a'); assert.equal(r.messages[1].inputId, 'b');
  await r.broker.connect(); r.access.inputs.get('a').play([0x80, 60, 0]);
  assert.equal(r.messages.length, 3); assert.equal(r.requests(), 1); assert.equal(r.access.inputs.get('a').opens, 1);
});

test('input changes release the old source before the replacement map and discard stale events', async t => {
  const r = rig(); t.after(() => r.broker.dispose()); await r.broker.connect(); await tick();
  r.events.length = 0; r.broker.setSelection('b'); await tick();
  assert.equal(r.events[0], 'panic'); assert.deepEqual(r.broker.getState().inputs.map(p => p.id), ['b']);
  r.access.inputs.get('a').play([0x90, 60, 1]); r.access.inputs.get('b').play([0x90, 60, 1]);
  assert.deepEqual(r.messages.map(m => m.inputId), ['b']);
  r.broker.setSelection('all'); await tick();
  r.access.inputs.get('a').play([0x90, 60, 1]); r.access.inputs.get('b').play([0x90, 60, 1]);
  assert.deepEqual(r.messages.map(m => m.inputId), ['b', 'a', 'b']);
});

test('Auto ignores enumeration order and follows disconnect/reconnect without duplicated delivery', async t => {
  const r = rig(); t.after(() => r.broker.dispose()); await r.broker.connect(); await tick();
  const a = r.access.inputs.get('a'), b = r.access.inputs.get('b');
  r.access.inputs = new Map([['b', b], ['a', a]]); r.access.dispatchEvent(new Event('statechange')); await tick();
  assert.deepEqual(r.broker.getState().inputs.map(p => p.id), ['a', 'b']);
  a.state = 'disconnected'; r.events.length = 0; r.access.dispatchEvent(new Event('statechange')); await tick();
  assert.equal(r.events[0], 'panic'); assert.deepEqual(r.broker.getState().inputs.map(p => p.id), ['b']);
  a.state = 'connected'; r.access.dispatchEvent(new Event('statechange')); await tick();
  assert.deepEqual(r.broker.getState().inputs.map(p => p.id), ['b', 'a']);
  a.play([0x90, 64, 90]); b.play([0x90, 67, 90]);
  assert.deepEqual(r.messages.map(message => message.inputId), ['a', 'b']);
  assert.equal(a.opens, 2); assert.equal(b.opens, 1);
});

test('permission failure can retry and unsupported browsers never request access', async t => {
  let tries = 0; const access = new EventTarget(); access.inputs = new Map();
  const broker = new MidiBroker({ requestAccess: () => ++tries === 1 ? Promise.reject(new DOMException('No permission.', 'NotAllowedError')) : access });
  t.after(() => broker.dispose());
  await assert.rejects(broker.connect(), { name: 'NotAllowedError' }); assert.equal(broker.getState().status, 'denied');
  await broker.connect(); assert.equal(broker.getState().status, 'ready'); assert.equal(broker.getState().access, true);
  const unsupported = new MidiBroker({ supported: false, requestAccess: () => { throw new Error('Must not be called.'); } });
  await assert.rejects(unsupported.connect(), { name: 'NotSupportedError' }); unsupported.dispose();
});

test('an input that fails to open is excluded; a later Connect retries it once', async t => {
  const r = rig(['a']); t.after(() => r.broker.dispose()); const a = r.access.inputs.get('a'); a.rejectOpen = true;
  await r.broker.connect(); await tick();
  assert.deepEqual(r.broker.getState().inputs, []); assert.equal(r.broker.getState().error, 'Device is busy.');
  a.play([0x90, 60, 100]); assert.equal(r.messages.length, 0);
  a.rejectOpen = false; await r.broker.connect(); await tick();
  assert.deepEqual(r.broker.getState().inputs.map(p => p.id), ['a']); assert.equal(r.broker.getState().error, null);
  assert.equal(a.opens, 2); a.play([0x90, 60, 100]); assert.equal(r.messages.length, 1);
});

test('disposing removes listeners, stops delivery, and prevents an outstanding grant from reviving access', async () => {
  const r = rig(['a']); await r.broker.connect(); await tick(); const a = r.access.inputs.get('a'); r.broker.dispose();
  a.play([0x90, 60, 1]); r.access.dispatchEvent(new Event('statechange')); assert.equal(r.messages.length, 0);
  let resolve; const pending = new MidiBroker({ requestAccess: () => new Promise(done => { resolve = done; }) });
  const request = pending.connect(); pending.dispose(); resolve(r.access);
  await assert.rejects(request, { name: 'AbortError' }); assert.equal(pending.getState().access, false);
});

test('an idle virtual input cannot hide a later keyboard and newly attached keyboards work automatically', async t => {
  const r = rig(['empty-virtual']); t.after(() => r.broker.dispose());
  await r.broker.connect(); await tick();
  const keys = new Port('keys', r.access); keys.name = 'My keyboard';
  r.access.inputs.set(keys.id, keys); r.access.dispatchEvent(new Event('statechange')); await tick();
  keys.play([0x90, 60, 96]); keys.play([0x80, 60, 0]);
  assert.equal(r.messages.length, 2); assert.equal(r.messages[0].inputName, 'My keyboard');
  assert.equal(r.broker.getState().lastInput.name, 'My keyboard');
  assert.equal(r.broker.getState().lastInput.messages, 2); assert.equal(r.broker.getState().lastInput.notes, 1);
  assert.equal(r.broker.getState().selection, 'auto'); assert.equal(r.requests(), 1);
  keys.state = 'disconnected'; r.access.dispatchEvent(new Event('statechange')); await tick();
  assert.equal(r.broker.getState().lastInput, null);
});

test('empty access remains armed for later hotplug', async t => {
  const r = rig([]); t.after(() => r.broker.dispose()); await r.broker.connect();
  assert.equal(r.broker.getState().access, true); assert.equal(r.broker.getState().inputs.length, 0);
  const keys = new Port('keys', r.access); r.access.inputs.set(keys.id, keys);
  r.access.dispatchEvent(new Event('statechange')); await tick(); keys.play([0x90, 60, 100]);
  assert.equal(r.messages.length, 1); assert.equal(r.requests(), 1);
});

test('manual override stays isolated across unrelated hotplug and Auto restores every input', async t => {
  const r = rig(); t.after(() => r.broker.dispose()); await r.broker.connect(); await tick();
  r.broker.setSelection('b'); await tick();
  const c = new Port('c', r.access); r.access.inputs.set(c.id, c); r.access.dispatchEvent(new Event('statechange')); await tick();
  assert.deepEqual(r.broker.getState().inputs.map(port => port.id), ['b']);
  c.play([0x90, 60, 100]); assert.equal(r.messages.length, 0);
  r.broker.setSelection('auto'); await tick();
  for (const port of r.access.inputs.values()) port.play([0x90, 60, 100]);
  assert.deepEqual(r.messages.map(message => message.inputId).sort(), ['a', 'b', 'c']);
});

test('silent discovery never prompts when permission is unknown, prompt, denied or unsupported', async t => {
  for (const state of ['prompt', 'denied', 'unknown']) {
    const r = rig([], { queryPermission: () => ({ state }) }); t.after(() => r.broker.dispose());
    await r.broker.discover(); assert.equal(r.requests(), 0); assert.equal(r.broker.getState().permission, state);
  }
  const unavailableQuery = rig([], { queryPermission: () => { throw new TypeError('MIDI permission not implemented.'); } });
  t.after(() => unavailableQuery.broker.dispose()); await unavailableQuery.broker.discover(); assert.equal(unavailableQuery.requests(), 0);
  let queries = 0; const unsupported = rig([], { supported: false, queryPermission: () => { queries++; return { state: 'granted' }; } });
  t.after(() => unsupported.broker.dispose()); await unsupported.broker.discover(); assert.equal(queries, 0); assert.equal(unsupported.requests(), 0);
});

test('silent discovery connects granted permission once and shares an overlapping gesture request', async t => {
  let queries = 0; const r = rig(['keys'], { queryPermission: () => { queries++; return { state: 'granted' }; } });
  t.after(() => r.broker.dispose()); const first = r.broker.discover(), second = r.broker.discover();
  assert.equal(first, second); const gesture = r.broker.connect(); assert.equal(r.requests(), 1);
  await Promise.all([first, gesture]); await tick();
  assert.equal(queries, 1); assert.equal(r.requests(), 1); assert.equal(r.broker.getState().permission, 'granted');
  r.access.inputs.get('keys').play([0x90, 60, 100]); assert.equal(r.messages.length, 1);
});

test('discover can recheck a permission that becomes granted and reports request failures', async t => {
  let state = 'prompt'; const r = rig(['a'], { queryPermission: () => ({ state }) }); t.after(() => r.broker.dispose());
  await r.broker.discover(); assert.equal(r.requests(), 0); state = 'granted';
  await r.broker.discover(); await tick(); assert.equal(r.requests(), 1);
  const broken = new MidiBroker({ queryPermission: () => ({ state: 'granted' }), requestAccess: () => { throw new Error('Native bridge failed.'); } });
  t.after(() => broken.dispose()); await assert.rejects(broken.discover(), /Native bridge failed/);
  assert.equal(broken.getState().status, 'error');
});

test('a stale discovery grant cannot override a later denial or open another permission prompt', async t => {
  let finishQuery, requests = 0;
  const broker = new MidiBroker({ queryPermission: () => new Promise(resolve => { finishQuery = resolve; }), requestAccess: () => {
    requests++; return Promise.reject(new DOMException('Permission denied.', 'NotAllowedError'));
  } });
  t.after(() => broker.dispose()); const discovery = broker.discover(); await tick();
  await assert.rejects(broker.connect(), { name: 'NotAllowedError' });
  finishQuery({ state: 'granted' }); await discovery;
  assert.equal(requests, 1); assert.equal(broker.getState().permission, 'denied');
});

test('transient port failure retries without selecting a device or duplicating messages', async t => {
  const r = rig(['a', 'b'], { retryDelays: [5] }); t.after(() => r.broker.dispose());
  const a = r.access.inputs.get('a'); a.rejectOpen = true; await r.broker.connect(); await tick();
  assert.deepEqual(r.broker.getState().inputs.map(port => port.id), ['b']);
  assert.equal(r.broker.getState().inputErrors.length, 1); assert.equal(r.broker.getState().pendingInputs.length, 1);
  a.rejectOpen = false; await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(a.opens, 2); assert.equal(r.broker.getState().error, null);
  a.play([0x90, 60, 100]); assert.equal(r.messages.length, 1);
});

test('automatic retries are bounded, can be restarted explicitly, and cancel on disposal', async () => {
  const r = rig(['a'], { retryDelays: [1, 1] }); const a = r.access.inputs.get('a'); a.rejectOpen = true;
  await r.broker.connect(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(a.opens, 3); assert.equal(r.broker.getState().pendingInputs.length, 0);
  a.rejectOpen = false; await r.broker.connect(); await tick();
  assert.equal(a.opens, 4); assert.equal(r.broker.getState().inputs.length, 1); r.broker.dispose();
  const pending = rig(['a'], { retryDelays: [5] }); const waitingPort = pending.access.inputs.get('a'); waitingPort.rejectOpen = true;
  await pending.broker.connect(); pending.broker.dispose(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(waitingPort.opens, 1);
});

test('replacing a native port with the same id discards stale events and late open completion', async t => {
  const r = rig(['a']); t.after(() => r.broker.dispose()); const old = r.access.inputs.get('a');
  let resolveOpen; old.open = () => { old.opens++; return new Promise(resolve => { resolveOpen = resolve; }); };
  await r.broker.connect(); await tick();
  const replacement = new Port('a', r.access); r.access.inputs.set('a', replacement); r.access.dispatchEvent(new Event('statechange')); await tick();
  resolveOpen(old); await tick();
  old.play([0x90, 60, 100]); replacement.play([0x90, 61, 100]);
  assert.equal(r.messages.length, 1); assert.equal(r.messages[0].data[1], 61); assert.ok(old.closes >= 1);
  assert.equal(replacement.closes, 0);
});
