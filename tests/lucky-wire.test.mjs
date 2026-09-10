import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Lucky Dreamer's wire publisher, lifted out of the source the build inlines and run on its
// own — the same trick player.test.mjs uses on app.js. It publishes 400 ms ahead of the
// playhead, so the one thing it must never do is send a stretch of music twice.
const source = fs.readFileSync(new URL('../src/lucky-cloud/lifecycle.js', import.meta.url), 'utf8').split('\n');
const start = source.findIndex(line => line.startsWith('var busList=null,busWorld=null'));
const end = source.findIndex(line => line.startsWith('var originalOnEngineMsg=onEngineMsg;'));
assert.ok(start >= 0 && end > start, 'the publisher is still one block in lifecycle.js');

function publisher() {
  const sent = [];
  let at = 0;                                     // the playhead of the call being made
  const S = { playing: true, solo: false, world: null };
  const context = { S, C: { destroyed: false }, GM_KIT: Array(64).fill(36), GM_PERC: Array(64).fill(60), console,
    window: { MidiRoom: { emit: event => sent.push({ ...event, playhead: at }), now: () => 0 } } };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end).join('\n') + '\nglobalThis.publish = busPublish;', context);
  // A note's identity is its place in the music, not the millisecond it was addressed to:
  // the same note published from two different playheads carries two different `at` values,
  // so comparing `at` alone cannot see a duplicate at all.
  const onsets = () => sent.filter(e => e.kind === 'midi' && (e.data[0] & 0xf0) === 0x90 && e.data[2] > 0)
    .map(e => ({ note: e.data[1], where: Math.round((e.at / 1000 + e.playhead) * 1000) }));
  return { S, sent, publish: t => { at = t; context.publish(t); }, onsets };
}

const band = (bpm, steps = 64) => ({ bpm, secPerStep: 60 / bpm / 4,
  roster: [{ id: 'lead', engine: 'poly', muted: false }],
  events: Array.from({ length: steps }, (_, i) => ({ part: 'lead', t: i, note: 60 + (i % 4), dur: 1, vel: 0.8 })) });
const lanes = (...ids) => ({ bpm: 120, secPerStep: 0.125,
  roster: ids.map(id => ({ id: id.id, engine: 'poly', muted: false })),
  events: ids.flatMap(l => Array.from({ length: 64 }, (_, i) => ({ part: l.id, t: i, note: l.note, dur: 1, vel: 0.8 }))) });
const key = event => event.note + '@' + event.where;

test('a rebuilt world does not re-send the stretch already on the wire', () => {
  // A held +/- button rebuilds the world every 80 ms, and the publisher used to rewind its
  // high-water mark on every rebuild, so each one re-published the whole horizon: measured
  // 38 note-ons over a second where 7 were owed, arriving as ~25 flams 3-90 ms apart on the
  // same note. Not a tempo bug — freeze the tempo and hold the button and it is worse
  // (44 v 38). The trigger is the rebuild; one cable is told the same music twice.
  const p = publisher();
  p.S.world = band(120);
  p.publish(0);
  const first = p.onsets();
  assert.ok(first.length > 0, 'the opening horizon reached the wire');
  p.S.world = band(120);                       // a NEW object at the same tempo, as any rebuild makes
  p.publish(0.05);                             // 50 ms later, still well inside the sent horizon
  const again = p.onsets().slice(first.length).filter(event => first.some(sent => key(sent) === key(event)));
  assert.deepEqual(again, [], `${again.length} notes already on the wire were sent a second time`);
});

test('a run of rebuilds sends each note once, and the loop coming round still repeats them', () => {
  const p = publisher();
  p.S.world = band(120);
  for (let step = 0; step <= 10; step++) {      // one second of held button, 80 ms apart
    if (step) p.S.world = band(120 + step);
    p.publish(step * 0.08);
  }
  const seen = p.onsets().map(key);
  assert.equal(seen.length, new Set(seen).size, 'a held button sent some note twice');
  const before = p.onsets().length;
  p.publish(0);                                  // the playhead goes backwards: the music genuinely repeats
  assert.ok(p.onsets().length > before, 'the loop coming round sends its notes again');
});

test('a clock that nobody touches still says its tempo, so a cable made late fills in', () => {
  // A follower learns the tempo only from a transport event. On the shipped file a steady
  // performance sent exactly one, at t=0: eight seconds of play, one event. So a cable made
  // a minute in carried notes while the follower's BPM tile stayed a dash — the wire list
  // said "Clock" and the instrument said "no clock", and nothing could settle it.
  const p = publisher();
  p.S.world = band(120, 256);
  for (let t = 0; t < 8; t = Number((t + 0.05).toFixed(2))) p.publish(t);
  const said = p.sent.filter(event => event.kind === 'transport');
  assert.ok(said.length >= 4, `eight seconds of steady play said the tempo ${said.length} time(s)`);
  assert.deepEqual([...new Set(said.map(event => event.bpm))], [120], 'and always the tempo it is actually playing');
  // Once a bar, not once a publish: this rides on a cable, and 160 events would be noise.
  assert.ok(said.length <= 8, `${said.length} tempo events in eight seconds is chatter`);
});

test('a rebuild that ADDS a part sends it at once; only what was already sent is skipped', () => {
  // The counterpart to the test above, and the reason the skip is keyed on a note's seat in
  // the music rather than its position in time. A time cursor that is carried across the swap
  // stops the duplicates but silently drops whatever the rebuild added inside the horizon:
  // measured 0 of the 4 notes owed in the first 400 ms after a lane is unmuted, its entry
  // sliding 125 ms -> 500 ms. Both properties are pinned here so neither can be traded away.
  const p = publisher();
  p.S.world = lanes({ id: 'lead', note: 60 });
  p.publish(0);
  p.S.world = lanes({ id: 'lead', note: 60 }, { id: 'bass', note: 36 });   // a lane is unmuted
  p.publish(0.05);
  const bass = p.onsets().filter(event => event.note === 36).map(event => event.where);
  const lead = p.onsets().filter(event => event.note === 60).map(event => event.where);
  assert.ok(bass.length >= 4, `the unmuted lane sent ${bass.length} notes into the first horizon`);
  assert.ok(Math.min(...bass) <= 125, `the unmuted lane came in at ${Math.min(...bass)} ms`);
  assert.equal(lead.length, new Set(lead).size, 'and the lane that did not change was not sent twice');
});
