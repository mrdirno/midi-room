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
const key = event => event.note + '@' + event.where;

test('a rebuilt world does not re-send the stretch already on the wire', () => {
  // A held +/- button rebuilds the world every 80 ms while the engine, which debounces, is
  // restruck none of those times. The publisher used to rewind its high-water mark on every
  // rebuild, so each one re-published the whole horizon: measured 28 note-ons over a second
  // where 8 were owed, landing 4-11 ms off a 125 ms grid — two tempos inside one instrument.
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
