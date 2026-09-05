import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rig, tick } from './bridge-test-rig.mjs';
import { InstrumentBus } from '../dist/instrument-bus.js';

const normalize = value => JSON.parse(JSON.stringify(value));
const routeState = (r, ids = ['ab']) => r.send({ type: 'routes-state', inputs: ids.map(id => ({ id: 'wire:' + id, name: 'Cable ' + id })) });
const envelope = (r, extra = {}) => ({ type: 'instrument-event', version: 1, origin: 'a', destination: 'b', route: 'ab', generation: 0, id: 'note-1', kind: 'midi', data: [0x90, 60, 90], at: r.sandbox.MidiRoom.now(), ...extra });

test('SDK declarations queue until authenticated boot and do not request hardware on load', t => {
  const r = rig({ boot: false }); t.after(() => r.dispose());
  assert.equal(r.sandbox.MidiRoom.declare({ name: 'Drummer', send: ['midi', 'field'], receive: ['field'] }), true);
  assert.equal(r.outgoing.length, 0);
  r.bootFrame({}, 'session-a'); assert.equal(r.outgoing.length, 0);
  r.bootFrame();
  const ready = r.outgoing.filter(e => e.type === 'instrument-ready');
  assert.equal(ready.length, 1);
  assert.deepEqual(normalize(ready[0]), { type: 'instrument-ready', name: 'Drummer', send: ['midi', 'field'], receive: ['field'], legacyVibeBus: false });
  assert.equal(r.outgoing.some(e => e.type === 'request-midi'), false);
  assert.equal(r.sandbox.MidiRoom.emit({ kind: 'signal', signal: 'PARAM_UPDATE', value: 1 }), false);
  assert.equal(r.sandbox.MidiRoom.emit({ kind: 'midi', data: [0x90, 60, 90] }), true);
  assert.equal(r.outgoing.at(-1).type, 'instrument-publish');
});

test('local route inputs work without native MIDI and remain distinct from hardware capability', async t => {
  const r = rig({ supported: false }); t.after(() => r.dispose());
  await assert.rejects(r.sandbox.navigator.requestMIDIAccess(), { name: 'NotSupportedError' });
  routeState(r);
  const access = await r.sandbox.navigator.requestMIDIAccess();
  assert.equal(access.inputs.size, 1); assert.ok(access.inputs.has('wire:ab')); assert.equal(access.outputs.size, 0);
  assert.equal(r.outgoing.some(e => e.type === 'request-midi'), false);
  r.send({ type: 'midi-state', state: { access: false, inputs: [] } });
  assert.ok(access.inputs.has('wire:ab'));
  r.send(envelope(r, { kind: 'cancel', removed: true, generation: 1 }));
  assert.equal(access.inputs.size, 0);
  await assert.rejects(r.sandbox.navigator.requestMIDIAccess(), { name: 'NotSupportedError' });
});

test('route state merges with real inputs and newly available local access resolves an existing request', async t => {
  const r = rig(); t.after(() => r.dispose());
  const waiting = r.sandbox.navigator.requestMIDIAccess(); routeState(r);
  const access = await waiting;
  r.state(); assert.equal(access.inputs.size, 2);
  r.state([]); assert.ok(access.inputs.has('wire:ab')); assert.equal(access.inputs.has('a'), false);
  r.state(); routeState(r, []); assert.ok(access.inputs.has('a')); assert.equal(access.inputs.has('wire:ab'), false);
});

test('a real core cable schedules legacy MIDI once and route removal cancels future notes without touching hardware', async t => {
  const r = rig(); t.after(() => r.dispose()); routeState(r); r.state();
  const access = await r.sandbox.navigator.requestMIDIAccess(), notes = [], hardware = [];
  access.inputs.get('wire:ab').onmidimessage = event => notes.push([...event.data]);
  access.inputs.get('a').onmidimessage = event => hardware.push([...event.data]);
  const bus = new InstrumentBus({ now: r.sandbox.MidiRoom.now });
  bus.addSession({ id: 'a', send: () => {}, capabilities: { send: ['midi'], receive: [] } });
  bus.addSession({ id: 'b', send: event => r.send(event) }); bus.addRoute({ id: 'ab', from: 'a', to: 'b' });
  bus.publish('a', { kind: 'midi', data: [0x90, 60, 90], at: bus.now() + 100 });
  bus.publish('a', { kind: 'midi', data: [0x80, 60, 0], at: bus.now() + 1000 });
  assert.equal(notes.length, 0); assert.equal(r.timeouts.size, 2);
  r.advance(100); assert.deepEqual(notes, [[0x90, 60, 90]]);
  bus.publish('a', { kind: 'midi', data: [0x90, 64, 90], at: bus.now() + 100 });
  bus.removeRoute('ab');
  assert.equal(r.timeouts.size, 0); assert.equal(access.inputs.has('wire:ab'), false);
  assert.ok(notes.some(data => data[0] === 0x80 && data[1] === 60));
  const after = notes.length; r.advance(2000); assert.equal(notes.length, after); assert.equal(hardware.length, 0);
});

test('SDK MIDI delivery provides future time immediately without double-triggering virtual Web MIDI', async t => {
  const r = rig(); t.after(() => r.dispose()); routeState(r);
  const access = await r.sandbox.navigator.requestMIDIAccess(), legacy = [], sdk = [], cancels = [];
  access.inputs.get('wire:ab').onmidimessage = e => legacy.push([...e.data]);
  const off = r.sandbox.MidiRoom.on('midi', e => sdk.push(e));
  r.sandbox.MidiRoom.on('cancel', e => cancels.push(e));
  const at = r.sandbox.MidiRoom.now() + 6000;
  r.send(envelope(r, { at }));
  assert.equal(sdk.length, 1); assert.equal(sdk[0].at, at); assert.equal(legacy.length, 0); assert.equal(r.timeouts.size, 0);
  const audio = vm.runInContext('new AudioContext()', r.context);
  assert.equal(r.sandbox.MidiRoom.audioTime(audio, at), 11);
  r.send(envelope(r, { kind: 'cancel', generation: 1, removed: false })); assert.equal(cancels.length, 1);
  off(); r.send(envelope(r, { generation: 1 })); assert.equal(legacy.length, 1);
});

test('VibeBus sends and receives scoped signals privately, without wildcard parent broadcasts', t => {
  const r = rig(); t.after(() => r.dispose()); const values = [];
  const before = r.hellos.length;
  const stop = r.sandbox.VibeBus.listen('PARAM_UPDATE', (value, event) => values.push([value, event.route]));
  assert.equal(r.sandbox.VibeBus.emit('CV_SOURCE', { amount: 0.5 }), true);
  assert.equal(r.hellos.length, before);
  assert.equal(r.outgoing.at(-1).type, 'instrument-publish');
  assert.equal(r.outgoing.at(-1).event.signal, 'CV_SOURCE');
  r.send(envelope(r, { kind: 'signal', signal: 'THERMAL_STATE', value: 0.9 }));
  r.send(envelope(r, { kind: 'signal', signal: 'PARAM_UPDATE', value: 0.2 }));
  assert.deepEqual(values, [[0.2, 'ab']]);
  stop(); r.send(envelope(r, { kind: 'signal', signal: 'PARAM_UPDATE', value: 0.3 })); assert.equal(values.length, 1);
  const ready = r.outgoing.filter(e => e.type === 'instrument-ready').at(-1);
  assert.ok(ready.send.includes('signal')); assert.ok(ready.receive.includes('signal'));
});

test('bounded scheduling rejects excessive horizon, clears overflow and ignores stale route generations', async t => {
  const r = rig(); t.after(() => r.dispose()); routeState(r);
  const access = await r.sandbox.navigator.requestMIDIAccess(), notes = [];
  access.inputs.get('wire:ab').onmidimessage = e => notes.push([...e.data]);
  r.send(envelope(r, { at: r.sandbox.MidiRoom.now() + 16001 })); assert.equal(r.timeouts.size, 0);
  for (let i = 0; i < 1024; i++) r.send(envelope(r, { at: r.sandbox.MidiRoom.now() + 1000, id: String(i) }));
  assert.equal(r.timeouts.size, 1024);
  r.send(envelope(r, { at: r.sandbox.MidiRoom.now() + 1000 })); assert.equal(r.timeouts.size, 0);
  r.send(envelope(r, { kind: 'cancel', generation: 2, removed: false }));
  r.send(envelope(r, { generation: 1 })); assert.equal(notes.length, 0);
  r.send(envelope(r, { generation: 2 })); assert.equal(notes.length, 1);
});

test('resume attempts are observable; only trusted gestures notify host and disposal cancels timers', async () => {
  const r = rig(); routeState(r); const access = await r.sandbox.navigator.requestMIDIAccess();
  access.inputs.get('wire:ab').onmidimessage = () => {};
  const audio = vm.runInContext('new AudioContext()', r.context); await audio.suspend();
  r.send({ type: 'resume' }); await tick(); assert.equal(audio.resumes, 1);
  r.document.gesture('pointerdown', false); assert.equal(r.outgoing.filter(e => e.type === 'gesture').length, 0);
  r.document.gesture('pointerdown', true); assert.equal(r.outgoing.filter(e => e.type === 'gesture').length, 1);
  r.send(envelope(r, { at: r.sandbox.MidiRoom.now() + 500 })); assert.equal(r.timeouts.size, 1);
  r.dispose(); assert.equal(r.timeouts.size, 0); assert.equal(audio.closes, 1);
  assert.equal(r.sandbox.MidiRoom.emit({ kind: 'midi', data: [0x90, 60, 90] }), false);
});

test('hardware panic releases native inputs while preserving wire notes, timers and SDK routes', async t => {
  const r = rig(); t.after(() => r.dispose()); routeState(r); r.state();
  const access = await r.sandbox.navigator.requestMIDIAccess(), wire = [], hardware = [], cancels = [];
  access.inputs.get('wire:ab').onmidimessage = e => wire.push([...e.data]);
  access.inputs.get('a').onmidimessage = e => hardware.push([...e.data]);
  r.sandbox.MidiRoom.on('cancel', event => cancels.push(event));
  const audio = vm.runInContext('new AudioContext()', r.context);
  r.send(envelope(r));
  r.send(envelope(r, { data: [0x90, 64, 90], at: r.sandbox.MidiRoom.now() + 500 }));
  r.send({ type: 'hardware-panic' });
  assert.equal(hardware.length, 80); assert.equal(wire.length, 1);
  assert.equal(r.timeouts.size, 1); assert.equal(cancels.length, 0); assert.equal(audio.suspends, 0);
  r.advance(500); assert.equal(wire.length, 2); assert.ok(access.inputs.has('wire:ab'));
});

test('a receiver-only legacy VibeBus replacement advertises immediately and keeps its object semantics', t => {
  const r = rig(); t.after(() => r.dispose());
  const defaultBus = r.sandbox.VibeBus, legacy = { listen() { return this; }, capabilities: { inputs: ['PARAM_UPDATE'] } };
  r.sandbox.VibeBus = legacy;
  assert.equal(r.sandbox.VibeBus, legacy); assert.equal(r.sandbox.VibeBus.listen(), legacy);
  let ready = r.outgoing.filter(e => e.type === 'instrument-ready').at(-1);
  assert.equal(ready.legacyVibeBus, true); assert.ok(ready.receive.includes('signal'));
  assert.equal(r.outgoing.some(e => e.type === 'instrument-publish'), false);
  r.sandbox.MidiRoom.declare({ name: 'Legacy panel', send: ['field'], receive: ['field'] });
  ready = r.outgoing.filter(e => e.type === 'instrument-ready').at(-1);
  assert.equal(ready.legacyVibeBus, true); assert.deepEqual(normalize(ready.receive), ['field', 'signal']);
  r.sandbox.VibeBus = defaultBus;
  ready = r.outgoing.filter(e => e.type === 'instrument-ready').at(-1);
  assert.equal(ready.legacyVibeBus, false); assert.deepEqual(normalize(ready.receive), ['field']);
});

test('legacy mode is queued before boot and catches descriptor replacement at DOM readiness without polling', t => {
  const r = rig({ boot: false }); t.after(() => r.dispose());
  const legacy = { listen() {} };
  Object.defineProperty(r.sandbox, 'VibeBus', { configurable: true, writable: true, value: legacy });
  r.document.dispatchEvent(new Event('DOMContentLoaded'));
  assert.equal(r.outgoing.length, 0);
  r.bootFrame();
  const ready = r.outgoing.filter(e => e.type === 'instrument-ready');
  assert.equal(ready.length, 1); assert.equal(ready[0].legacyVibeBus, true);
  assert.ok(ready[0].receive.includes('signal')); assert.equal(r.intervals.size, 0);
});

test('legacy mode does not duplicate a signal through SDK and window handlers', t => {
  const r = rig(); t.after(() => r.dispose()); let sdk = 0, legacy = 0;
  r.sandbox.VibeBus.listen('PARAM_UPDATE', () => sdk++);
  r.sandbox.VibeBus = { listen() {} };
  r.sandbox.addEventListener('message', event => { if (event.data?.type === 'VIBE_BUS_SIGNAL') legacy++; });
  r.send(envelope(r, { kind: 'signal', signal: 'PARAM_UPDATE', value: 0.4 }));
  const message = new Event('message'); Object.assign(message, { source: r.parent, data: { type: 'VIBE_BUS_SIGNAL', signal: 'PARAM_UPDATE', value: 0.4 } });
  r.sandbox.dispatchEvent(message);
  assert.equal(sdk, 0); assert.equal(legacy, 1);
});
