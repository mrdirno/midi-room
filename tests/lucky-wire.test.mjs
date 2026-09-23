import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Lucky Dreamer's wire publisher, lifted out of the source the build inlines and run on its
// own — the same trick player.test.mjs uses on app.js. It publishes 400 ms ahead of the
// playhead, so the one thing it must never do is send a stretch of music twice.
const source = fs.readFileSync(new URL('../src/lucky-cloud/lifecycle.js', import.meta.url), 'utf8').split('\n');
const start = source.findIndex(line => line.startsWith('var busList=null,busWorld=null'));
const end = source.findIndex(line => line.startsWith('var originalOnEngineMsg=onEngineMsg;'));
assert.ok(start >= 0 && end > start, 'the publisher is still one block in lifecycle.js');

const current = source.slice(start, end).join('\n');
// The sendSwap wrapper is where the page tells the publisher where a song will come down. It sits
// outside the block above, so it is lifted by its own line and run against a stand-in sendSwap.
const swapLine = source.findIndex(line => line.startsWith('sendSwap=function(bar,follow)'));
assert.ok(swapLine > 0 && source[swapLine - 1] === 'var originalSendSwap=sendSwap;', 'the sendSwap wrapper is still one line');

function publisher(block = current) {
  const sent = [];
  let at = 0;                                     // the playhead of the call being made
  const S = { playing: true, solo: false, world: null };
  const context = { S, C: { destroyed: false }, GM_KIT: Array(64).fill(36), GM_PERC: Array(64).fill(60), console,
    window: { MidiRoom: { emit: event => sent.push({ ...event, playhead: at }), now: () => 0 } } };
  vm.createContext(context);
  vm.runInContext(block + '\nglobalThis.publish = busPublish; globalThis.reset = busReset;' +
    '\nglobalThis.land = typeof busLand === "function" ? busLand : function () {};', context);
  // A note's identity is its place in the music, not the millisecond it was addressed to:
  // the same note published from two different playheads carries two different `at` values,
  // so comparing `at` alone cannot see a duplicate at all.
  const onsets = () => sent.filter(e => e.kind === 'midi' && (e.data[0] & 0xf0) === 0x90 && e.data[2] > 0)
    .map(e => ({ note: e.data[1], where: Math.round((e.at / 1000 + e.playhead) * 1000) }));
  // reset() is what PLAY and pause do to the publisher before the engine's next report; land(bar) is
  // what every seeking swap (PLAY, a resume, the lead-in switch, the progress bar) tells it. The old
  // block has no landing, so there land() does nothing, exactly as origin/main did nothing.
  return { S, sent, context, publish: t => { at = t; context.publish(t); }, reset: () => context.reset(),
    land: bar => context.land(bar), onsets };
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

// Wish 44813890. A song does not always start at the top: the lead-in switch starts it at bar 2,
// a resume starts it at the bar it stopped in, and the progress bar moves it anywhere. Unguarded,
// the first report after any of those sent every earlier note at once (36 note-ons for the 4 owed
// starting at bar 2, 164 resuming at bar 10, in the world below). The first guard for that marked
// everything before the FIRST REPORT as sent, and its test reported exactly on a note, so it
// passed. The engine never reports on the start: its report counter runs on across a load, so the
// first 'pos' comes one audio block to 50 ms after the bar the song came down on (3-51 ms measured
// in Chromium; up to ~93 ms on the ScriptProcessor path). The downbeat lies before that report, so
// every song's first kick and bass note left the room's cables: 3 of the 4 owed notes, in all 12
// cases of the first test below. These tests report late, and tell the publisher where the song
// came down the way the page does, through land().
const bars = (bpm, count = 32) => ({ bpm, steps: 16, bars: count, secPerStep: 60 / bpm / 4, duration: count * 16 * 60 / bpm / 4,
  roster: [{ id: 'lead', engine: 'poly', muted: false }],
  events: Array.from({ length: count * 16 }, (_, i) => ({ part: 'lead', t: i, note: 20 + (i % 96), dur: 1, vel: 0.8 })) });
// What a report at playhead t owes the wire when the song came down on step `from`: each note from
// that step to the 400 ms horizon, once. A note carries its step, so a stray one is visible even
// when it was sent late (a late note is clamped to now, so its time cannot identify it).
const owed = (world, from, t) => {
  const notes = [];
  for (let i = from; i * world.secPerStep <= t + 0.4 + 1e-9; i++) notes.push(20 + (i % 96));
  return notes.sort((a, b) => a - b);
};
const notesSince = (p, mark = 0) => p.onsets().slice(mark).map(event => event.note).sort((a, b) => a - b);

test('a start sends the bar it came down on, downbeat included, however late the first report is', () => {
  for (const late of [0.0027, 0.02, 0.05, 0.093]) {
    for (const bar of [0, 2, 10]) {                  // the top of a song; the lead-in skipped; a resume
      const p = publisher();
      p.S.world = bars(120);                         // 120 bpm, 16 steps: a bar is 2 s, a note every 125 ms
      p.reset();                                     // PLAY
      p.land(bar);                                   // its swap seeks the engine to the start of `bar`
      const t = bar * 2 + late;
      p.publish(t);
      assert.deepEqual(notesSince(p), owed(p.S.world, bar * 16, t),
        `start at bar ${bar}, first report ${Math.round(late * 1000)} ms later`);
      // and the next second of play sends each note once, nothing from before the bar line
      let last = t;
      for (let u = t + 0.05; u < t + 1; u += 0.05) { p.publish(u); last = u; }
      assert.deepEqual(notesSince(p), owed(p.S.world, bar * 16, last), `the second after a start at bar ${bar}`);
    }
  }
});

test('a jump comes down on a bar: its downbeat goes out, nothing before it does, and the loop still repeats', () => {
  const p = publisher();
  p.S.world = bars(120);
  p.reset(); p.land(0);
  for (let t = 0.02; t < 1; t += 0.05) p.publish(t);         // a second from the top
  let mark = p.onsets().length;
  p.land(20); p.publish(40.03);                              // the progress bar: on to bar 20
  assert.deepEqual(notesSince(p, mark), owed(p.S.world, 320, 40.03), 'a jump forward to bar 20');
  mark = p.onsets().length;
  p.land(5); p.publish(10.04);                               // and back to bar 5
  assert.deepEqual(notesSince(p, mark), owed(p.S.world, 80, 10.04), 'a jump back to bar 5');
  mark = p.onsets().length;
  p.publish(0.03);                                           // the loop coming round to the top
  assert.deepEqual(notesSince(p, mark), owed(p.S.world, 0, 0.03), 'the loop coming round sends the top again');
});

test('a report already in flight when the swap went out does not publish the new song from the old place', () => {
  // ROLL while a song plays calls play(0): the rebuild takes long enough that a report of the OLD
  // song's position is queued behind it. Published, it would send the new song from 0 to there.
  const p = publisher();
  p.S.world = bars(120);
  p.reset(); p.land(0);
  p.publish(37.25);                                          // where the old song was
  assert.equal(p.onsets().length, 0, `a stale report sent ${p.onsets().length} notes`);
  p.publish(0.021);                                          // the new song, 21 ms after its start
  assert.deepEqual(notesSince(p), owed(p.S.world, 0, 0.021), 'then the new song starts on its downbeat');
  // A seek the engine never carried out (superseded in its queue) must not silence the wire:
  // after six reports from elsewhere the publisher goes on, owing nothing behind the report.
  const q = publisher();
  q.S.world = bars(120);
  q.reset(); q.land(12);
  for (let k = 0; k < 6; k++) q.publish(3 + k * 0.05);
  assert.deepEqual(notesSince(q), owed(q.S.world, Math.ceil((3.25 - 0.0125) / 0.125), 3.25), 'the wire resumes where the song really is');
});

test('the page tells the publisher where a seeking swap comes down, and a rebuild tells it nothing', () => {
  const p = publisher();
  const swaps = [];
  p.context.sendSwap = (bar, follow) => swaps.push([bar, follow]);
  p.S.send = () => {};
  p.S.bar = 3;
  vm.runInContext(source[swapLine - 1] + '\n' + source[swapLine], p.context);
  p.S.world = bars(120);
  p.reset();
  p.context.sendSwap(undefined, false);                     // PLAY: no bar given means S.bar
  p.publish(6.04);
  assert.deepEqual(notesSince(p), owed(p.S.world, 48, 6.04), 'PLAY lands on the start of S.bar');
  const mark = p.onsets().length;
  p.context.sendSwap(3, true);                              // a rebuild: follow, no landing
  p.S.world = bars(120);
  p.publish(6.14);                                          // its horizon reaches one new note, step 52
  assert.deepEqual(notesSince(p, mark), [20 + 52], 'a rebuild sends only what it had not sent');
  assert.deepEqual(swaps, [[undefined, false], [3, true]], 'and both still reach the engine unchanged');
});

test('the lead-in skipped, the loop still comes round through it and plays it', () => {
  // Wish 44813890 asks for the song to start past its intro, not for the intro to disappear.
  const world = bars(120, 6);                                // 6 bars, 12 s; the intro is bars 0-1
  const p = publisher();
  p.S.world = world;
  p.reset(); p.land(2);                                      // the switch starts it at bar 2
  const heard = [];
  for (let t = 4.03; t < world.duration; t += 0.05) { const mark = p.onsets().length; p.publish(t); heard.push(...notesSince(p, mark)); }
  assert.ok(heard.every(note => note >= 20 + 32), 'the first pass sent nothing from the intro');
  assert.deepEqual(heard.sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => 20 + 32 + i), 'and every note from bar 2 on, once');
  const wrap = p.onsets().length;
  for (let t = 0.013; t < 4.5; t += 0.05) p.publish(t);      // the loop comes round to the top
  const second = notesSince(p, wrap);
  const intro = Array.from({ length: 32 }, (_, i) => 20 + i);
  assert.deepEqual(second.filter(note => note < 20 + 32), intro, 'the second pass plays the intro, each note once');
});

test('with the switch off, a song from the top goes down the cable exactly as origin/main sent it', () => {
  // The same report stream through the a7b9370 block and the current one, on real Lucky Dreamer
  // worlds: a start, reports every 50 ms OFF the grid (the first one on no note), a held-button
  // rebuild in the middle, and the loop coming round. Every (note, place in the music) must match.
  const reference = fs.readFileSync(new URL('./fixtures/lucky-wire-a7b9370.js', import.meta.url), 'utf8');
  const { load } = createRequire(import.meta.url)('../src/lucky-cloud/tests/engine-loader.cjs');
  const { x } = load();
  const seeds = [12345, 7919, 424242, 90210, 31337, 2718281];
  for (const seed of seeds) {
    const world = x.buildBand(seed), again = x.buildBand(seed);
    const times = world.events.map(e => Math.max(0, e.t * world.secPerStep));
    let first = 0.0137;                                       // off the grid: no note within 2 ms of it
    while (times.some(at => Math.abs(at - first) < 0.002)) first += 0.0031;
    assert.ok(first < 0.1, `seed ${seed}: no gap in the first 100 ms`);
    const stream = [];
    for (let t = first; t < world.duration; t += 0.05) stream.push(t);
    for (let t = first + 0.011; t < 6; t += 0.05) stream.push(t);   // round again
    const run = block => {
      const p = publisher(block);
      p.S.world = world;
      p.reset(); p.land(0);
      stream.forEach((t, k) => { if (k === 60) p.S.world = again; p.publish(t); });
      return p.onsets().map(event => event.note + '@' + event.where);
    };
    const before = run(reference), after = run(current);
    assert.ok(before.length > 100, `seed ${seed}: the reference sent ${before.length} notes`);
    assert.deepEqual(after, before, `seed ${seed}: the cable differs from origin/main`);
  }
});
