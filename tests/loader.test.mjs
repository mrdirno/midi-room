import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { INSTRUMENT_POLICY, INSTRUMENT_SANDBOX, LoadSequence, MAX_INSTRUMENT_BYTES, prepareInstrument, safeFilename, validateInstrument, validateSource } from '../dist/loader.js';

test('file validation accepts an HTML instrument and rejects unsupported/empty/oversized files', () => {
  assert.doesNotThrow(() => validateInstrument(new File(['<!doctype html><body>Keys'], 'rack.HTML')));
  assert.throws(() => validateInstrument(new File(['MThd'], 'song.mid')), /html instrument/i);
  assert.throws(() => validateInstrument(new File([], 'empty.html')), /empty/);
  assert.throws(() => validateInstrument({ name: 'big.html', size: MAX_INSTRUMENT_BYTES + 1, text() {} }), /32 MB/);
  assert.throws(() => validateInstrument(null), /Choose/);
});

test('HTML source checks allow complete and fragment instruments, while catching non-HTML payloads', () => {
  for (const source of ['<!doctype html><html></html>', '<canvas id="synth"></canvas><script>0;</script>', '<div>Keys</div>']) assert.doesNotThrow(() => validateSource(source));
  for (const source of ['', 'MThd', '{"midi":true}', null]) assert.throws(() => validateSource(source));
});

test('safe download names remove path/control characters and retain long filename extensions', () => {
  assert.equal(safeFilename('../../take.mid'), 'take.mid');
  assert.equal(safeFilename('C:\\files\\take.wav'), 'take.wav');
  assert.equal(safeFilename('..'), 'instrument.html');
  assert.equal(safeFilename('\u0000<take>.html'), '__take_.html');
  const long = safeFilename('instrument-'.repeat(30) + '.html');
  assert.ok(long.endsWith('.html'));
  assert.equal(long.length, 140);
});

test('instrument policy isolates the document and blocks external resources', () => {
  assert.equal(INSTRUMENT_SANDBOX.includes('allow-same-origin'), false);
  assert.equal(INSTRUMENT_SANDBOX.includes('allow-top-navigation'), false);
  assert.match(INSTRUMENT_POLICY, /default-src 'none'/);
  assert.match(INSTRUMENT_POLICY, /frame-src 'none'/);
  assert.match(INSTRUMENT_POLICY, /connect-src blob: data:/);
  assert.match(INSTRUMENT_POLICY, /base-uri 'none'/);
  assert.equal(/https?:|\*/.test(INSTRUMENT_POLICY), false);
});

test('preparation inserts policy and safe bootstrap before instrument code', () => {
  const removed = [], inserted = [], parseCalls = [];
  // The browser owns HTML parsing; this double checks our ordering and injected payload.
  const doc = {
    querySelectorAll(selector) { assert.equal(selector, 'base, meta[http-equiv]'); return [0, 1].map(id => ({ remove: () => removed.push(id) })); },
    createElement(tag) { return { tag, textContent: '' }; },
    head: { prepend(...nodes) { inserted.push(...nodes); } },
    documentElement: { outerHTML: '<html>serialized</html>' },
  };
  const result = prepareInstrument('<html><script>instrument()</script></html>', { nonce: '</script>', supported: true, parser: { parseFromString(...args) { parseCalls.push(args); return doc; } } });
  assert.equal(parseCalls[0][1], 'text/html');
  assert.deepEqual(removed, [0, 1]);
  assert.equal(inserted[0].httpEquiv, 'Content-Security-Policy');
  assert.equal(inserted[0].content, INSTRUMENT_POLICY);
  assert.equal(inserted[1].tag, 'script');
  assert.equal(inserted[1].textContent.includes('</script>'), false);
  assert.doesNotThrow(() => new vm.Script(inserted[1].textContent));
  assert.equal(result, '<!doctype html>\n<html>serialized</html>');
});

test('new selections and close invalidate older reads without starting a transport', () => {
  const sequence = new LoadSequence();
  const first = sequence.next();
  assert.equal(first(), true);
  const second = sequence.next();
  assert.equal(first(), false);
  assert.equal(second(), true);
  sequence.cancel();
  assert.equal(second(), false);
});
