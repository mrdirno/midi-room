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
  // A report carries the number of the seek whose engine posted it (the page stamps each swap's score
  // and the engine echoes it). By default that is the latest seek: the engine has taken it. A report
  // that was already in flight is published with seek(), read before the land() it predates. The old
  // block takes one argument and never sees the number.
  return { S, sent, context, publish: (t, seek) => { at = t; context.publish(t, seek === undefined ? context.busSeek : seek); },
    reset: () => context.reset(), land: bar => context.land(bar), onsets, seek: () => context.busSeek,
    playhead: t => { at = t; } };
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
  const before = p.seek();
  p.reset(); p.land(0);
  p.publish(37.25, before);                                  // where the old song was
  assert.equal(p.onsets().length, 0, `a stale report sent ${p.onsets().length} notes`);
  p.publish(0.021);                                          // the new song, 21 ms after its start
  assert.deepEqual(notesSince(p), owed(p.S.world, 0, 0.021), 'then the new song starts on its downbeat');
  // A seek the engine never carried out must not silence the wire. A rebuild's swap, sent under the
  // same seek number, replaced it in the engine's one-deep queue, so the reports carry the current
  // number from where the song really is. The first of them is enough: nothing behind it is owed.
  // (Before reports carried a number, a stale report looked the same, and the wire waited six.)
  const q = publisher();
  q.S.world = bars(120);
  q.reset(); q.land(12);
  q.publish(3);
  assert.deepEqual(notesSince(q), owed(q.S.world, Math.ceil((3 - 0.0125) / 0.125), 3), 'the wire goes on at the first report');
  for (let k = 1; k < 6; k++) q.publish(3 + k * 0.05);
  assert.deepEqual(notesSince(q), owed(q.S.world, Math.ceil((3 - 0.0125) / 0.125), 3.25), 'the wire resumes where the song really is');
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

// Two ways a landing sent the same seat twice, found by the refute pass on 086d9f9. Both come from
// what a landing did to the publisher's memory: it forgot every seat already sent, and it took the
// accepted report's time as the last place the song had been.
const a7b9370 = fs.readFileSync(new URL('./fixtures/lucky-wire-a7b9370.js', import.meta.url), 'utf8');
const each = list => list.every((note, i) => i === 0 || note !== list[i - 1]);

test('a jump to the next bar, clicked inside the 400 ms already sent, sends that bar once', () => {
  // The progress bar clicked 0.2 s before the next bar line. The publisher is 400 ms ahead, so that
  // bar's downbeat is already on the wire, stamped for the moment it plays, and a forward seek plays
  // it exactly once. The landing forgot it had been sent and sent it again: 7, 5, 5, 5, 7 and 7 notes
  // twice on six real seeds. a7b9370 knew nothing of landings and sent each once; it is the control.
  const run = (block, world, bar, every = 0.05) => {
    const p = publisher(block), line = bar * world.steps * world.secPerStep;
    p.S.world = world;
    p.reset(); p.land(0);
    let k = 0;
    for (; 0.013 + k * every < line - 0.2; k++) p.publish(0.013 + k * every);   // from the top to 0.2 s before the line
    const old = p.seek();
    p.land(bar);                                               // click the next bar
    p.publish(0.013 + k * every, old);                         // a report of the old place was already in flight
    let last = 0;
    for (let u = line + 0.021; u < line + 1; u += every) { p.publish(u); last = u; }   // the engine, from the line
    return { p, last };
  };
  for (const block of [a7b9370, current]) {
    const { p, last } = run(block, bars(120), 2);
    const heard = notesSince(p);
    assert.ok(each(heard), `${block === current ? 'now' : 'a7b9370'}: a note went out twice`);
    assert.deepEqual(heard, owed(p.S.world, 0, last), `${block === current ? 'now' : 'a7b9370'}: every note from the top once`);
  }
  // The same on real songs: with nothing to skip, the cable must be note for note what a7b9370 sent.
  const { load } = createRequire(import.meta.url)('../src/lucky-cloud/tests/engine-loader.cjs');
  const { x } = load();
  for (const seed of [12345, 7919, 424242, 90210, 31337, 2718281]) {
    const world = x.buildBand(seed), block = 2304 / 44100;   // the worklet's report period
    const before = run(a7b9370, world, 6, block).p.onsets().map(key), after = run(current, world, 6, block).p.onsets().map(key);
    assert.deepEqual(after, before, `seed ${seed}: the next bar clicked 0.2 s before its line`);
  }
  // A seek the engine never carried out is the same case: the song goes on forward from where it was.
  // Its reports carry the current number (a rebuild replaced the seek in the engine's queue), the
  // first one lets the wire go on, and what it had already sent stays sent.
  for (const block of [a7b9370, current]) {
    const p = publisher(block);
    p.S.world = bars(120);
    p.reset(); p.land(0);
    for (let k = 0; k <= 100; k++) p.publish(0.005 + k * 0.05);   // to 5.005 s: sent to 5.405, step 43 is 5.375
    p.land(12);                                                   // superseded in the engine's queue
    for (let k = 101; k <= 120; k++) p.publish(0.005 + k * 0.05); // the sixth report is 5.305 s
    const heard = notesSince(p);
    assert.ok(each(heard), `${block === current ? 'now' : 'a7b9370'}: a seek that never happened sent a note twice`);
    assert.deepEqual(heard, owed(p.S.world, 0, 0.005 + 120 * 0.05), 'and nothing is lost');
  }
});

test('a report of the old place inside the new bar\'s first quarter second starts no burst', () => {
  // Click the bar that is playing, 120 ms into it: the song seeks back to its line. The report the
  // engine had already posted says 170 ms, inside the window a landing is accepted in, and no time
  // can tell it from the real first report; only its seek number can. The landing then remembered 170 ms as the last place,
  // the engine's real first report said 21 ms, and the loop test read that as the song coming round:
  // every note from bar 0 went out at once, as a7b9370 also did, and 6-12 of them twice. The last
  // place a landing leaves is its bar line, which every real report after it reaches.
  const p = publisher();
  p.S.world = bars(120);
  p.reset(); p.land(0);
  for (let k = 0; k <= 42; k++) p.publish(0.02 + k * 0.05);      // 120 ms into bar 1
  const mark = p.onsets().length, old = p.seek();
  p.land(1);                                                     // click bar 1
  p.publish(0.02 + 43 * 0.05, old);                              // the old place, 170 ms in: in the window
  let last = 0;
  for (let u = 2.021; u < 3; u += 0.05) { p.publish(u); last = u; }
  assert.deepEqual(notesSince(p, mark), owed(p.S.world, 16, last), 'bar 1 from its line, each note once, nothing from bar 0');
  // ROLL twice inside a quarter second is the same thing at the top of a song: the first song's
  // report is queued behind the second song's start and lands in its window.
  const q = publisher();
  q.S.world = bars(120);
  q.reset(); q.land(0);
  for (let k = 0; k < 3; k++) q.publish(0.013 + k * 0.05);
  const first = q.seek();
  q.reset(); q.S.world = bars(120); q.land(0);                   // ROLL again
  const roll = q.onsets().length;
  q.publish(0.163, first);                                       // the first song's report
  let end = 0;
  for (let u = 0.009; u < 1; u += 0.05) { q.publish(u); end = u; }
  assert.deepEqual(notesSince(q, roll), owed(q.S.world, 0, end), 'the second song from its top, each note once');
  // and the loop coming round after such a landing is still the loop coming round
  const wrap = q.onsets().length;
  q.publish(0.012);
  assert.ok(q.onsets().length > wrap, 'the top of the song goes out again when the playhead goes back');
});

// The refute pass on 1332b61 found the window it relied on could be beaten by a second report. With
// TWO reports of the old place in flight after a click on the bar that is playing, the second set the
// last place back to the old one; the engine's real first report then read as the loop coming round,
// and every note from bar 0 went out at once: 144-234 note-ons on six real seeds where 25-44 were owed,
// 6-13 of them twice. ROLL twice inside 250 ms doubled 5-15. No time can tell such a report from the
// real one, so each report now carries the number of the seek whose engine posted it. The bar these
// tests hold it to: a report from before the seek leaves the cable exactly as if it had never arrived.
const PERIOD = 2304 / 44100;                                     // the worklet's report period
// A seat (part + step) names one note in the music whatever time it was sent for, and the test context
// maps every drum slot to one note number, so (note, time) cannot tell a kick from a hat on the same
// step. These tests read the seat off a copy of the block whose note-on line also reports it.
const EMIT = "mr.emit({kind:'midi',data:[0x90|n.ch,n.note,n.vel],at:on});";
const withSeats = block => {
  assert.equal(block.split(EMIT).length, 2, 'the note-on line is still one line');
  return block.replace(EMIT, "mr.emit({kind:'midi',data:[0x90|n.ch,n.note,n.vel],at:on,seat:n.seat});");
};
const noteOns = (p, mark = 0) => p.sent.slice(mark).filter(e => e.kind === 'midi' && (e.data[0] & 0xf0) === 0x90);
const once = list => list.length === new Set(list).size;
const realBand = (() => { let x = null; return seed => { if (!x) ({ x } = createRequire(import.meta.url)('../src/lucky-cloud/tests/engine-loader.cjs').load()); return x.buildBand(seed); }; })();
const SEEDS = [12345, 7919, 424242, 90210, 31337, 2718281];

// Play from the top to `until`, click `bar`, let `stale` reports of the old place arrive, then the
// engine from the bar line. Returns each note-on sent after the click with its seat in the music.
function click(block, world, until, bar, stale, firstLate = 0.021) {
  const p = publisher(withSeats(block));
  p.S.world = world;
  p.reset(); p.land(0);
  let t = 0.013;
  for (; t < until; t += PERIOD) p.publish(t);
  const mark = p.sent.length, old = p.seek();
  p.land(bar);
  for (let k = 0; k < stale; k++) p.publish(t + k * PERIOD, old);  // posted before the engine took the click
  const line = bar * world.steps * world.secPerStep;
  for (let u = line + firstLate; u < line + 2; u += PERIOD) p.publish(u);
  const after = noteOns(p, mark);
  return { keys: after.map(e => e.data[1] + '@' + Math.round((e.at / 1000 + e.playhead) * 1000)), seats: after.map(e => e.seat) };
}

test('one, two or three reports still in flight after a click change nothing on the cable', () => {
  for (const seed of SEEDS) {
    const world = realBand(seed), bar = world.steps * world.secPerStep, n = 5;
    for (const [name, until, target] of [
      ['the bar that is playing, clicked 120 ms in', n * bar + 0.12, n],
      ['the next bar, clicked 0.2 s before its line', (n + 1) * bar - 0.2, n + 1],
      ['three bars back', n * bar + 0.7, n - 3]]) {
      const clean = click(current, world, until, target, 0);
      assert.ok(clean.keys.length >= 10, `seed ${seed}, ${name}: only ${clean.keys.length} notes after the click`);
      assert.ok(once(clean.seats), `seed ${seed}, ${name}: a note went out twice after the click`);
      for (const stale of [1, 2, 3]) {
        assert.deepEqual(click(current, world, until, target, stale), clean, `seed ${seed}, ${name}: ${stale} report(s) in flight`);
      }
    }
  }
  // The control: the block before this change passes with one report in flight and fails with two.
  const old = fs.readFileSync(new URL('./fixtures/lucky-wire-a7b9370.js', import.meta.url), 'utf8');
  const world = realBand(12345), bar = world.steps * world.secPerStep;
  const burst = click(old, world, 5 * bar + 0.12, 5, 2), owedNow = click(current, world, 5 * bar + 0.12, 5, 0);
  assert.ok(burst.keys.length > 3 * owedNow.keys.length && !once(burst.seats),
    'origin/main sends the burst from bar 0 on the same click, with notes twice, so this test can see one');
});

test('ROLL twice inside 250 ms: the first song\'s reports in flight send nothing of the second', () => {
  for (let i = 0; i < 6; i++) {
    const run = stale => {
      const p = publisher(withSeats(current));
      p.S.world = realBand(SEEDS[i]);
      p.reset(); p.land(0);
      for (let t = 0.013; t < 0.15; t += PERIOD) p.publish(t);
      const first = p.seek();
      p.reset(); p.S.world = realBand(SEEDS[(i + 1) % 6]); p.land(0);   // ROLL -> play(0)
      const mark = p.onsets().length;
      for (let k = 0; k < stale; k++) p.publish(0.169 + k * PERIOD, first);
      for (let t = 0.009; t < 2; t += PERIOD) p.publish(t);
      return { keys: p.onsets().slice(mark).map(key), seats: noteOns(p).slice(mark).map(e => e.seat) };
    };
    const clean = run(0);
    assert.ok(once(clean.seats), 'the second song, each note once');
    for (const stale of [1, 2, 3]) assert.deepEqual(run(stale), clean, `seed ${SEEDS[i]}: ${stale} report(s) of the first song in flight`);
  }
});

test('after reports in flight, a first report off the note grid still sends the downbeat', () => {
  // bars(120) has a note every 125 ms, so each of these first reports falls between two notes.
  for (const late of [0.0027, 0.02, 0.05, 0.093]) {
    for (const stale of [1, 2, 3]) {
      const p = publisher();
      p.S.world = bars(120);
      p.reset(); p.land(0);
      let t = 0.013;
      for (; t < 2.12; t += 0.05) p.publish(t);                   // 120 ms into bar 1
      const mark = p.onsets().length, old = p.seek();
      p.land(1);                                                  // click bar 1: the song seeks back to 2 s
      for (let k = 0; k < stale; k++) p.publish(t + k * 0.05, old);
      const first = 2 + late;
      p.publish(first);
      assert.deepEqual(notesSince(p, mark), owed(p.S.world, 16, first), `first report ${Math.round(late * 1000)} ms late, ${stale} in flight`);
      let last = first;
      for (let u = first + 0.05; u < first + 1; u += 0.05) { p.publish(u); last = u; }
      assert.deepEqual(notesSince(p, mark), owed(p.S.world, 16, last), `and the second after it, each note once`);
    }
  }
});

test('after a click with reports in flight, the loop still comes round and plays the top once', () => {
  const world = bars(120, 6);                                     // 6 bars, 12 s
  const p = publisher();
  p.S.world = world;
  p.reset(); p.land(0);
  let t = 0.013;
  for (; t < 6.12; t += 0.05) p.publish(t);                      // 120 ms into bar 3
  const mark = p.onsets().length, old = p.seek();
  p.land(3);
  for (let k = 0; k < 3; k++) p.publish(t + k * 0.05, old);
  for (let u = 6.021; u < world.duration; u += 0.05) p.publish(u);
  assert.deepEqual(notesSince(p, mark), Array.from({ length: 48 }, (_, i) => 20 + 48 + i), 'bars 3-5 once each after the click');
  const wrap = p.onsets().length;
  for (let u = 0.013; u < 4.5; u += 0.05) p.publish(u);          // the loop comes round
  const second = notesSince(p, wrap);
  assert.deepEqual(second.filter(note => note < 20 + 32), Array.from({ length: 32 }, (_, i) => 20 + i), 'the top, each note once');
});

test('with the switch off, PLAY through the page\'s own wrappers puts on the cable what origin/main did', () => {
  // The whole path a report takes, not only the publisher: the lead-in play wrapper, the sendSwap
  // wrapper that numbers the seek, the glue that stamps the number on the swapped score, and the hook
  // that hands the engine's report to the publisher. Only the app's sendSwap, the page's S.send and the
  // engine are stand-ins, each written to match its source (asserted below). If the number the page
  // sends is not the number the publisher expects, the cable goes silent and this fails.
  const lift = (prefix, lines = 1) => { const i = source.findIndex(l => l.startsWith(prefix)); assert.ok(i >= 0, prefix); return source.slice(i, i + lines).join('\n'); };
  const glueAt = source.findIndex(l => l.startsWith('function cloudTransportMessage(tp,m){'));
  const glue = source.slice(glueAt, source.indexOf('}', glueAt) + 1).join('\n');
  const hookAt = source.findIndex(l => l.startsWith('var originalOnEngineMsg=onEngineMsg;'));
  const hook = source.slice(hookAt, hookAt + 5).join('\n');
  assert.ok(hook.includes("busPublish(m.t,m.cloudSeek)"), 'the hook hands the report\'s number to the publisher');
  const lifecycle = source.join('\n');
  assert.equal(lifecycle.split('cloudSeek:busSeek').length - 1, 2, 'both S.send paths (worklet, ScriptProcessor) carry the seek number');
  const patch = JSON.parse(fs.readFileSync(new URL('../src/lucky-cloud/engine-patches.json', import.meta.url), 'utf8')).patches.find(p => p.id === 'wish-44813890-report-names-its-seek');
  assert.ok(patch && patch.new.includes('cloudSeek: rep.world.cloudSeek'), 'the engine reports the number of the score it is playing');
  const run = (seed, skip) => {
    const p = publisher();
    const c = p.context;
    c.MidiRoom = c.window.MidiRoom; c.MidiRoom.skipLeadIn = skip;
    vm.runInContext(glue + `
      var engine = { fadeTo: 1, world: null, msg: function (m) { if (m.type === 'swap') engine.world = m.world; } };
      function onEngineMsg() {}
      function auditionStop() {}
      function scoreFor(w) { return { seed: w.seed, bars: w.bars, steps: w.steps, secPerStep: w.secPerStep }; }
      function sendSwap(bar, follow) { if (!S.send) return; S.send({ type: 'swap', world: scoreFor(S.world), bar: bar === undefined ? S.bar : bar, follow: follow === true }); }
      S.send = function (m) { cloudTransportMessage(engine, Object.assign({}, m, { cloudSeek: busSeek })); };
      function play(fromBar) { S.playing = true; sendSwap(fromBar === undefined ? S.bar : fromBar, false); }
      ${hook}
      ${lift('var originalSendSwap=sendSwap;', 2)}
      ${lift('var originalPlay=play;')}
      ${lift('function leadInEnd(){')}
      ${lift('play=function(fromBar){')}
      globalThis.report = function (t) { onEngineMsg({ type: 'pos', t: t, cloudSeek: engine.world && engine.world.cloudSeek }); };`, c);
    const world = realBand(seed);
    p.S.world = world; p.S.bar = 0; p.S.playing = false;
    c.play(0);
    const from = world.steps * world.secPerStep * (skip ? c.leadInEnd() : 0);
    for (let t = from + 0.0137; t < from + 6; t += PERIOD) { p.playhead(t); c.report(t); }
    return p.onsets().map(key);
  };
  const reference = fs.readFileSync(new URL('./fixtures/lucky-wire-a7b9370.js', import.meta.url), 'utf8');
  for (const seed of [12345, 7919]) {
    const world = realBand(seed);
    const q = publisher(reference);
    q.S.world = world;
    q.reset();
    for (let t = 0.0137; t < 6; t += PERIOD) q.publish(t);
    const before = q.onsets().map(key), after = run(seed, false);
    assert.ok(before.length > 20, `seed ${seed}: origin/main sent ${before.length} notes in six seconds`);
    assert.deepEqual(after, before, `seed ${seed}: switch off, the cable differs from origin/main`);
    // and with the switch on, the same song starts on section A's downbeat, which goes out first
    const on = run(seed, true);
    const skipTo = world.sections.find(s => s.name !== 'in' && s.name !== 'intro').startBar * world.steps * world.secPerStep;
    assert.ok(skipTo > 0, `seed ${seed} has an intro to skip`);
    assert.ok(on.length > 20, `seed ${seed}: switch on sent ${on.length} notes`);
    const firstAt = Math.min(...on.map(k => +k.split('@')[1]));
    // A note due before the first report goes out at once, so its place reads as that report's time;
    // the humanizer may put section A's downbeat up to 15 ms ahead of its line. Nothing from the intro.
    assert.ok(firstAt >= Math.round(skipTo * 1000) - 16 && firstAt <= Math.round((skipTo + 0.0137) * 1000) + 1,
      `seed ${seed}: switch on, the first note is at ${firstAt} ms, section A starts at ${Math.round(skipTo * 1000)} ms`);
  }
});
