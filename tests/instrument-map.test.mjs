/**
 * The map is data, so these tests are mostly questions about data: does every drum a
 * sender can play have somewhere to land, and does every note that leaves land inside
 * something the receiver can actually sound.
 *
 * The route table is not written down anywhere. It is every pair of instruments the map
 * describes, generated here — so a new instrument is tested against all the others the
 * moment its entry exists, without anyone remembering to add a row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InstrumentBus } from '../dist/instrument-bus.js';
import { MAP_FORMAT, busTranslator, describeRoute, resolveSlot, translateMIDI, validateInstrumentMap } from '../dist/instrument-map.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(root, name), 'utf8');
const MAP = validateInstrumentMap(JSON.parse(read('dist/instrument-map.json')));

const senders = Object.entries(MAP.instruments).filter(([, e]) => e.sends).map(([id]) => id);
const receivers = Object.entries(MAP.instruments).filter(([, e]) => e.receives).map(([id]) => id);
const ROUTES = senders.flatMap(from => receivers.filter(to => to !== from).map(to => ({ from, to })));

const clone = () => JSON.parse(read('dist/instrument-map.json'));
const percussionOf = (id, side) => (MAP.instruments[id][side] || {}).percussion;
const sendable = id => {
  const percussion = percussionOf(id, 'sends');
  const pitched = (MAP.instruments[id].sends || {}).pitched;
  const rows = [];
  if (percussion) for (const note of Object.keys(percussion.notes)) rows.push({ channel: percussion.channel, note: Number(note), drum: true });
  if (pitched) for (const channel of pitched.channels) for (let note = pitched.range[0]; note <= pitched.range[1]; note++) rows.push({ channel, note, drum: false });
  return rows;
};

test('the shipped map is valid and every pair of instruments has a route', () => {
  assert.equal(MAP.format, MAP_FORMAT);
  assert.ok(ROUTES.length >= 8, 'expected a route table, got ' + ROUTES.length);
});

test('every drum a sender can play reaches a drum the receiver owns', () => {
  const unresolved = [];
  for (const { from, to } of ROUTES) {
    if (!percussionOf(from, 'sends') || !percussionOf(to, 'receives')) continue;
    for (const slot of Object.values(percussionOf(from, 'sends').notes)) {
      if (!resolveSlot(MAP, to, slot)) unresolved.push(from + ' -> ' + to + ': ' + slot);
    }
  }
  assert.deepEqual(unresolved, [], 'these drums have nowhere to land');
});

test('every note that leaves lands inside something the receiver can sound', () => {
  const stray = [];
  for (const { from, to } of ROUTES) {
    const percussion = percussionOf(to, 'receives');
    const pitched = (MAP.instruments[to].receives || {}).pitched;
    for (const row of sendable(from)) {
      const out = translateMIDI(MAP, from, to, [0x90 | row.channel, row.note, 100]);
      const channel = out[0] & 0x0f;
      if (percussion && channel === percussion.channel) {
        const kit = percussion.kits.find(k => out[1] >= k.notes[0] && out[1] <= k.notes[1]);
        const vocabulary = kit && Object.values(kit.slots).includes(out[1]);
        // A drum that arrived on a drum channel must be one of the drums that exist.
        if (row.drum && !vocabulary) stray.push(from + ' -> ' + to + ': note ' + row.note + ' arrived as ' + out[1]);
      } else if (pitched && !row.drum) {
        if (out[1] < pitched.range[0] || out[1] > pitched.range[1]) stray.push(from + ' -> ' + to + ': pitch ' + row.note + ' arrived as ' + out[1]);
      }
    }
  }
  assert.deepEqual(stray, [], 'these notes arrived somewhere the receiver has no sound for');
});

test('a note-off follows its note-on onto the same channel and the same note', () => {
  // Drum Pad matches a note-on by note alone but a note-off by input, channel and note.
  // Move one half without the other and the note is never released; at 128 held the
  // instrument stops answering its own pads.
  const mismatched = [];
  for (const { from, to } of ROUTES) {
    for (const row of sendable(from)) {
      const on = translateMIDI(MAP, from, to, [0x90 | row.channel, row.note, 100]);
      const off = translateMIDI(MAP, from, to, [0x80 | row.channel, row.note, 0]);
      if ((on[0] & 0x0f) !== (off[0] & 0x0f) || on[1] !== off[1]) mismatched.push(from + ' -> ' + to + ': note ' + row.note);
    }
  }
  assert.deepEqual(mismatched, [], 'these notes could never be released');
});

test('a substitute chain leads somewhere a receiver actually has', () => {
  // The chain that put a cowbell on the Drum Pad's snare read clave -> woodblk -> rim ->
  // snare: every hop named a drum no receiver in this file declares, so it ran to the end
  // of the line and landed on the only thing left. A chain has to reach for something real
  // within a hop or two, or it is not a substitute, it is a leak.
  const owned = new Set();
  for (const entry of Object.values(MAP.instruments)) {
    const percussion = (entry.receives || {}).percussion;
    if (percussion) for (const kit of percussion.kits) for (const slot of Object.keys(kit.slots)) owned.add(slot);
  }
  const leaks = [];
  for (const [slot, chain] of Object.entries(MAP.fallbacks || {})) {
    if (!chain.slice(0, 2).some(next => owned.has(next))) leaks.push(slot + ' -> ' + chain.join(', '));
  }
  assert.deepEqual(leaks, [], 'these chains reach for nothing any receiver has');
});

test('translation is a function of the bytes and nothing else', () => {
  for (const { from, to } of ROUTES) {
    for (const row of sendable(from).slice(0, 40)) {
      const message = [0x90 | row.channel, row.note, 100];
      assert.deepEqual(translateMIDI(MAP, from, to, message), translateMIDI(MAP, from, to, message));
    }
  }
});

test('the whole route table runs through the real bus without a rejection', () => {
  for (const { from, to } of ROUTES) {
    const delivered = [];
    // The clock has to advance or the bus rate-limits us, which would be the test
    // running out of tokens rather than the map doing anything wrong.
    let clock = 1_000;
    const bus = new InstrumentBus({ now: () => (clock += 10), translate: busTranslator(MAP) });
    bus.addSession({ id: 'source', instrument: from, send: () => true, capabilities: { send: ['midi'], receive: [] } });
    bus.addSession({ id: 'target', instrument: to, send: envelope => { delivered.push(envelope); return true; }, capabilities: { send: [], receive: ['midi'] } });
    bus.addRoute({ id: 'cable', from: 'source', to: 'target', kinds: ['midi'] });
    const rows = sendable(from);
    for (const row of rows) {
      bus.publish('source', { kind: 'midi', data: [0x90 | row.channel, row.note, 100] });
      bus.publish('source', { kind: 'midi', data: [0x80 | row.channel, row.note, 0] });
    }
    const snapshot = bus.snapshot();
    assert.equal(snapshot.stats.rejected, 0, from + ' -> ' + to + ' had rejected events');
    assert.equal(delivered.length, rows.length * 2, from + ' -> ' + to + ' lost messages');
    assert.equal(snapshot.routes[0].activeNotes, 0, from + ' -> ' + to + ' left notes held down');
  }
});

test('a cable the map knows nothing about still carries its bytes', () => {
  const message = [0x99, 49, 100];
  assert.deepEqual(translateMIDI(MAP, 'not-an-instrument', 'improvisator', message), message);
  assert.deepEqual(translateMIDI(MAP, 'lucky-dreamer', 'not-an-instrument', message), message);
  assert.deepEqual(translateMIDI(MAP, 'lucky-dreamer', 'field-keys', message), message, 'a receiver with no kit keeps what it had');
});

test('the numbers actually move for the pair the wish is about', () => {
  const lucky = percussionOf('lucky-dreamer', 'sends');
  const changed = Object.keys(lucky.notes).filter(note => {
    const out = translateMIDI(MAP, 'lucky-dreamer', 'improvisator', [0x90 | lucky.channel, Number(note), 100]);
    return out[1] !== Number(note);
  });
  assert.ok(changed.length >= 12, 'expected the map to move at least twelve drums, moved ' + changed.length);
  // Named because they are the loud ones: TRITON folds a note to note % 12, so before
  // the map a crash struck the snare zone, a ride struck the clap, a high tom the kick.
  assert.equal(translateMIDI(MAP, 'lucky-dreamer', 'improvisator', [0x99, 49, 100])[1], 47, 'crash');
  assert.equal(translateMIDI(MAP, 'lucky-dreamer', 'improvisator', [0x99, 51, 100])[1], 47, 'ride');
  assert.equal(translateMIDI(MAP, 'lucky-dreamer', 'improvisator', [0x99, 48, 100])[1], 45, 'high tom');
});

test('a map that names a drum nobody has is refused when it loads', () => {
  const broken = clone();
  broken.instruments['lucky-dreamer'].sends.percussion.notes['36'] = 'tabla';
  assert.throws(() => validateInstrumentMap(broken), /unknown slot tabla/);
  const badKit = clone();
  badKit.instruments['improvisator'].receives.percussion.kits[0].slots.tabla = 40;
  assert.throws(() => validateInstrumentMap(badKit), /unknown slot tabla/);
  const badFallback = clone();
  badFallback.fallbacks.kick = ['tabla'];
  assert.throws(() => validateInstrumentMap(badFallback), /unknown slot tabla/);
});

test('kit note ranges may not overlap, because the note is how a kit is chosen', () => {
  const overlap = clone();
  overlap.instruments['improvisator'].receives.percussion.kits[1].notes = [44, 59];
  assert.throws(() => validateInstrumentMap(overlap), /overlaps another kit/);
  const outside = clone();
  outside.instruments['improvisator'].receives.percussion.kits[0].slots.kick = 60;
  assert.throws(() => validateInstrumentMap(outside), /outside its own range/);
});

test('no instrument sends pitched music on another instrument percussion channel', () => {
  // If one ever did, its melody would be read as a drum part on arrival.
  const drumChannels = new Set(receivers.map(id => percussionOf(id, 'receives')).filter(Boolean).map(p => p.channel));
  for (const id of senders) {
    const pitched = (MAP.instruments[id].sends || {}).pitched;
    if (!pitched) continue;
    for (const channel of pitched.channels) assert.ok(!drumChannels.has(channel), id + ' sends pitched music on drum channel ' + channel);
  }
});

test('the copy of the note bands inside TRITON still matches the map', () => {
  // The instrument runs in a sandboxed frame and cannot read the JSON, so it carries a
  // copy. This is the only thing stopping the two from quietly drifting apart.
  const runtime = read('src/triton/runtime.js');
  const declared = runtime.match(/const ROOM_PERCUSSION=(\{.*?\});/);
  assert.ok(declared, 'ROOM_PERCUSSION is gone from src/triton/runtime.js');
  const copy = JSON.parse(declared[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
  for (const id of ['triton-rack', 'improvisator']) {
    const percussion = percussionOf(id, 'receives');
    assert.equal(copy.channel, percussion.channel, id + ' channel');
    assert.deepEqual(copy.kits.map(k => [k.name, k.low, k.high]), percussion.kits.map(k => [k.name, k.notes[0], k.notes[1]]), id + ' kits');
  }
});

test('the map ships with the room, online and in the single portable file', () => {
  assert.match(read('dist/sw.js'), /"instrument-map\.json"/, 'the offline cache does not carry the map');
  assert.match(read('dist/sw.js'), /"instrument-map\.js"/, 'the offline cache does not carry the reader');
  const portable = read('dist/midi-room-local.html');
  assert.match(portable, /<script id="instrumentMap" type="application\/json">/, 'the portable room has no map');
  assert.ok(portable.includes('function translateMIDI'), 'the portable room cannot read the map');
});

test('every route can be described to a person in one sentence', () => {
  for (const { from, to } of ROUTES) {
    const sentence = describeRoute(MAP, from, to);
    assert.ok(sentence.length > 20 && sentence.length < 320, from + ' -> ' + to + ': ' + sentence);
  }
});
