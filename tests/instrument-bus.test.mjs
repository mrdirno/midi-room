import test from 'node:test';
import assert from 'node:assert/strict';
import { BUS_LIMITS, InstrumentBus, cancellationMIDI, validateInstrumentEvent } from '../dist/instrument-bus.js';

function setup() {
  let now = 1_700_000_000_000;
  const received = { a: [], b: [], c: [] };
  const bus = new InstrumentBus({ now: () => now });
  for (const id of Object.keys(received)) bus.addSession({ id, send: event => received[id].push(event), capabilities: { send: ['midi', 'transport', 'field', 'signal'], receive: ['midi', 'transport', 'field', 'signal'] } });
  return { bus, received, advance: amount => { now += amount; } };
}

test('an explicit cable delivers once, preserves scheduled time, and authenticates identity', () => {
  const { bus, received } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b' });
  const at = bus.now() + 100;
  assert.equal(bus.publish('a', { kind: 'midi', data: [0x90, 60, 90], at, origin: 'c', destination: 'c', route: 'evil' }).delivered, 1);
  assert.equal(received.a.length, 0); assert.equal(received.c.length, 0);
  assert.equal(received.b.length, 1);
  assert.equal(received.b[0].origin, 'a'); assert.equal(received.b[0].destination, 'b');
  assert.equal(received.b[0].route, 'ab'); assert.equal(received.b[0].at, at);
  assert.equal(received.b[0].clock.unit, 'unix-ms');
});

test('there is no implicit forwarding; duplicates, self-loops and mixed-kind cycles are rejected', () => {
  const { bus, received } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b', kinds: ['midi'] });
  bus.addRoute({ id: 'bc', from: 'b', to: 'c', kinds: ['field'] });
  assert.throws(() => bus.addRoute({ id: 'ca', from: 'c', to: 'a', kinds: ['transport'] }), /feedback loop/);
  assert.throws(() => bus.addRoute({ id: 'aa', from: 'a', to: 'a' }), /different/);
  assert.throws(() => bus.addRoute({ id: 'ab2', from: 'a', to: 'b' }), /already exists/);
  bus.publish('a', { kind: 'midi', data: [0x90, 60, 90] });
  assert.equal(received.c.length, 0);
});

test('removing one cable releases its repeated notes, sustain and future queue without touching other cables', () => {
  const { bus, received } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b' });
  bus.addRoute({ id: 'cb', from: 'c', to: 'b' });
  bus.publish('a', { kind: 'midi', data: [0x91, 60, 90] });
  bus.publish('a', { kind: 'midi', data: [0x91, 60, 40], at: bus.now() + 50 });
  bus.publish('a', { kind: 'midi', data: [0xb1, 64, 127] });
  bus.publish('c', { kind: 'midi', data: [0x90, 64, 90] });
  assert.equal(bus.removeRoute('ab'), true);
  const cancel = received.b.at(-1);
  assert.equal(cancel.kind, 'cancel'); assert.equal(cancel.route, 'ab'); assert.equal(cancel.generation, 1);
  assert.equal(cancel.removed, true);
  assert.deepEqual(cancel.notes, [[1, 60, 2]]);
  const releases = cancellationMIDI(cancel);
  assert.equal(releases.filter(bytes => bytes[0] === 0x81 && bytes[1] === 60).length, 2);
  assert.ok(releases.some(bytes => bytes[0] === 0xb1 && bytes[1] === 64 && bytes[2] === 0));
  assert.ok(releases.every(bytes => (bytes[0] & 15) === 1));
  assert.equal(bus.snapshot().routes[0].id, 'cb'); assert.equal(bus.snapshot().routes[0].activeNotes, 1);
  assert.equal(bus.publish('a', { kind: 'midi', data: [0x90, 60, 100] }).delivered, 0);
});

test('session close and capability revocation tear down both incoming and outgoing wires', () => {
  const { bus, received } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b' });
  bus.addRoute({ id: 'bc', from: 'b', to: 'c' });
  bus.publish('b', { kind: 'midi', data: [0x90, 60, 90] });
  bus.removeSession('b');
  assert.equal(bus.snapshot().routes.length, 0);
  assert.equal(received.c.at(-1).reason, 'instrument-closed');
  assert.equal(bus.publish('b', { kind: 'midi', data: [0x90, 60, 90] }).reason, 'unknown-source');
  bus.addRoute({ id: 'ac', from: 'a', to: 'c' });
  assert.equal(bus.setCapabilities('a', { send: [], receive: ['midi'] }), true);
  assert.equal(bus.snapshot().routes.length, 0);
  assert.equal(received.c.at(-1).reason, 'capability-change');
});

test('malformed MIDI, oversized payloads, unauthorized kinds and invalid scheduling are ignored', () => {
  const { bus, received } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b', kinds: ['midi', 'transport', 'field'] });
  const bad = [null, {}, { kind: 'midi', data: [0xf0, 1, 2] }, { kind: 'midi', data: [0x90, 128, 90] },
    { kind: 'midi', data: [0xc0, 1, 2] }, { kind: 'transport', action: 'tempo', bpm: Infinity },
    { kind: 'transport', action: 'seek' }, { kind: 'field', groove: Array(33).fill(1) },
    { kind: 'field', density: -1 }, { kind: 'field', key: 12 }, { kind: 'field', energy: NaN },
    { kind: 'midi', data: [0x90, 60, 90], at: bus.now() + BUS_LIMITS.futureMs + 1 },
    { kind: 'midi', data: [0x90, 60, 90], at: 'now' }];
  for (const event of bad) assert.equal(bus.publish('a', event).ok, false);
  assert.equal(received.b.length, 0);
  bus.setCapabilities('a', { send: ['midi'], receive: [] });
  assert.equal(bus.publish('a', { kind: 'field', energy: 0.5 }).ok, false);
});

test('signal cables need an explicit allowlist and never leak unselected VibeBus signals', () => {
  const { bus, received } = setup();
  assert.throws(() => bus.addRoute({ id: 'ab', from: 'a', to: 'b', kinds: ['signal'] }), /Choose the signals/);
  bus.addRoute({ id: 'ab', from: 'a', to: 'b', kinds: ['signal'], signals: ['PARAM_UPDATE', 'CV_SOURCE'] });
  assert.equal(bus.publish('a', { kind: 'signal', signal: 'THERMAL_STATE', value: 0.7 }).delivered, 0);
  const value = { param: 'cutoff', value: 0.3 };
  assert.equal(bus.publish('a', { kind: 'signal', signal: 'PARAM_UPDATE', value }).delivered, 1);
  value.value = 1;
  assert.deepEqual(received.b[0].value, { param: 'cutoff', value: 0.3 });
  assert.deepEqual(bus.snapshot().routes[0].signals, ['PARAM_UPDATE', 'CV_SOURCE']);
});

test('signal payload validation enforces JSON, finite values, depth and UTF-8 byte bounds', () => {
  const invalid = [undefined, () => {}, NaN, new Date(), { x: { x: { x: { x: { x: 1 } } } } }, 'x'.repeat(8193), '🎹'.repeat(3000), Array(129).fill(1)];
  const cyclic = {}; cyclic.self = cyclic; invalid.push(cyclic);
  for (const value of invalid) assert.equal(validateInstrumentEvent({ kind: 'signal', signal: 'PARAM_UPDATE', value }), null);
  assert.ok(validateInstrumentEvent({ kind: 'signal', signal: 'PARAM_UPDATE', value: null }));
  assert.equal(validateInstrumentEvent({ kind: 'signal', signal: '*', value: null }), null);
  assert.equal(validateInstrumentEvent({ kind: 'signal', signal: 'X'.repeat(49), value: 1 }), null);
});

test('transport and musical field payloads cross only declared cables and strip extra input', () => {
  const { bus, received } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b', kinds: ['transport', 'field'] });
  bus.publish('a', { kind: 'transport', action: 'start', bpm: 92, beat: 0, meter: [4, 4], at: bus.now() + 100, unsafe: 'discard' });
  bus.publish('a', { kind: 'field', key: 9, scale: 'minor', energy: 0.7, density: 0.6, swing: 0.2, groove: [1, 0, 0.4, 0], unsafe: 'discard' });
  assert.equal(received.b.length, 2); assert.equal(received.b[0].unsafe, undefined);
  assert.equal(received.b[0].bpm, 92); assert.deepEqual(received.b[1].groove, [1, 0, 0.4, 0]);
  assert.equal(bus.publish('a', { kind: 'midi', data: [0x90, 60, 90] }).delivered, 0);
});

test('message flooding is bounded and releases notes instead of leaving a dropped note-off stuck', () => {
  const { bus, received, advance } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b' });
  bus.publish('a', { kind: 'midi', data: [0x90, 60, 90] });
  for (let i = 1; i < BUS_LIMITS.burst; i++) bus.publish('a', { kind: 'midi', data: [0xb0, 1, i % 128] });
  assert.equal(bus.publish('a', { kind: 'midi', data: [0x80, 60, 0] }).reason, 'rate-limit');
  assert.equal(received.b.at(-1).kind, 'cancel'); assert.deepEqual(received.b.at(-1).notes, [[0, 60, 1]]);
  const count = received.b.length;
  for (let i = 0; i < 100; i++) bus.publish('a', { kind: 'midi', data: [0x90, 60, 90] });
  assert.equal(received.b.length, count);
  advance(1000);
  assert.equal(bus.publish('a', { kind: 'midi', data: [0x90, 60, 90] }).delivered, 1);
});

test('route panic increments cancellation generation and the cable can play afterward', () => {
  const { bus, received } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b' });
  bus.publish('a', { kind: 'midi', data: [0x90, 60, 90] });
  bus.panic();
  assert.equal(received.b.at(-1).removed, false);
  assert.equal(bus.snapshot().routes[0].activeNotes, 0);
  bus.publish('a', { kind: 'midi', data: [0x90, 64, 90] });
  assert.equal(received.b.at(-1).generation, 1);
  assert.equal(received.b.at(-1).kind, 'midi');
});

test('source transport stop cancels only outgoing cables and preserves incoming routes', () => {
  const { bus, received } = setup();
  bus.addRoute({ id: 'ab', from: 'a', to: 'b' });
  bus.addRoute({ id: 'bc', from: 'b', to: 'c' });
  bus.publish('a', { kind: 'midi', data: [0x90, 60, 90] });
  bus.publish('b', { kind: 'midi', data: [0x90, 64, 90], at: bus.now() + 6000 });
  bus.panicSource('b');
  assert.equal(received.b.length, 1);
  assert.equal(received.c.at(-1).kind, 'cancel'); assert.equal(received.c.at(-1).removed, false);
  assert.equal(bus.snapshot().routes.length, 2);
  assert.equal(bus.snapshot().routes.find(r => r.id === 'ab').activeNotes, 1);
});

test('a failed delivery does not stop independent destinations', () => {
  const bus = new InstrumentBus({ now: () => 1000 });
  bus.addSession({ id: 'a', send: () => {}, capabilities: { send: ['midi'], receive: [] } });
  bus.addSession({ id: 'b', send: () => { throw new Error('closed'); } });
  const received = [];
  bus.addSession({ id: 'c', send: e => received.push(e) });
  bus.addRoute({ id: 'ab', from: 'a', to: 'b' }); bus.addRoute({ id: 'ac', from: 'a', to: 'c' });
  assert.equal(bus.publish('a', { kind: 'midi', data: [0x90, 60, 90] }).delivered, 1);
  assert.equal(received.length, 1); assert.equal(bus.snapshot().stats.failed, 1);
});
