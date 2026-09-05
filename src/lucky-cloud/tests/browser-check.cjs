const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {root, sha} = require('./engine-loader.cjs');
const out = path.join(__dirname, 'evidence'); fs.mkdirSync(out, {recursive: true});
const file = path.join(root, 'dist/instruments/lucky-dreamer.html');
const targetSha256 = sha(fs.readFileSync(file));
const report = {at: new Date().toISOString(), target: 'dist/instruments/lucky-dreamer.html', runs: [], limits: ['Playwright Chromium/WebKit are not physical Safari/iPhone or external MIDI hardware.', 'Browser audio checks use real audio nodes and sample measurements, without subjective listening claims.', 'Only visitor-generated MIDI exports are saved; no wishes or external requests are sent.']};
const csp = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' data: blob:;";
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith('/midi-room/')) {res.writeHead(404); return res.end();}
  const target = path.resolve(root, 'dist', url.pathname.slice('/midi-room/'.length) || 'index.html');
  if (!target.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {res.writeHead(404); return res.end();}
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Content-Type', ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json'})[path.extname(target)] || 'application/octet-stream');
  res.end(fs.readFileSync(target));
});

async function instrumentation(context) {
  await context.addInitScript(() => {
    window.__cloudAudit = {contexts: [], workers: [], created: [], revoked: [], violations: []};
    for (const key of ['AudioContext', 'webkitAudioContext']) if (window[key]) {
      const Native = window[key];
      window[key] = new Proxy(Native, {construct(Target, args) {const ctx = new Target(...args); __cloudAudit.contexts.push(ctx); return ctx;}});
    }
    if (window.Worker) {
      const Native = Worker;
      window.Worker = new Proxy(Native, {construct(Target, args) {
        const worker = new Target(...args), record = {terminated: false}; __cloudAudit.workers.push(record);
        const terminate = worker.terminate.bind(worker); worker.terminate = () => {record.terminated = true; return terminate();}; return worker;
      }});
    }
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = b => {const url = create(b); __cloudAudit.created.push(url); return url;};
    URL.revokeObjectURL = u => {__cloudAudit.revoked.push(u); return revoke(u);};
    document.addEventListener('securitypolicyviolation', e => __cloudAudit.violations.push({directive: e.effectiveDirective, blocked: e.blockedURI}));
  });
}
async function parked(page) {
  await page.waitForFunction(() => !KNOCK.state.playing && (!KNOCK.state.ctx || ['suspended', 'closed'].includes(KNOCK.state.ctx.state)), null, {timeout: 7000});
}
async function live(page) {
  await page.waitForFunction(() => KNOCK.state.playing && KNOCK.state.ctx?.state === 'running' && KNOCK.state.playhead > .15, null, {timeout: 15000});
}
async function samplePeak(page) {
  return page.evaluate(async () => {
    const s = KNOCK.state, a = s.ctx.createAnalyser(); a.fftSize = 1024; s.node.connect(a);
    let peak = 0; const buf = new Float32Array(1024);
    for (let i = 0; i < 10; i++) {a.getFloatTimeDomainData(buf); for (const value of buf) peak = Math.max(peak, Math.abs(value)); await new Promise(r => setTimeout(r, 40));}
    s.node.disconnect(a); a.disconnect(); return peak;
  });
}
async function snapshot(page) {return page.evaluate(() => ({state: LuckyCloud.getState(), score: JSON.stringify(KNOCK.world()?.events), hash: location.hash, resources: {contexts: __cloudAudit.contexts.map(c => c.state), activeWorkers: __cloudAudit.workers.filter(w => !w.terminated).length, unreleasedUrls: __cloudAudit.created.filter(u => !__cloudAudit.revoked.includes(u)).length}, violations: __cloudAudit.violations}));}

async function verifyAddress(page) {
  const expected = await page.evaluate(() => LuckyCloud.address()), parsed = new URL(expected);
  assert.equal(parsed.origin, 'https://persona500.com');
  assert.equal(parsed.pathname, '/midi-room/instruments/lucky-dreamer.html');
  assert.ok(parsed.hash.startsWith('#w='), 'canonical address contains the replay seed');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new Error('Test: clipboard denied');}}});
    document.execCommand = () => false;
  });
  assert.equal(await page.evaluate(() => LuckyCloud.copyAddress()), false, 'denied clipboard returns failure');
  await page.locator('#shareAddress').waitFor({state: 'visible'});
  assert.equal(await page.locator('#shareAddress').inputValue(), expected);
  assert.equal(await page.locator('#shareAddress').getAttribute('readonly'), '');
  await page.waitForFunction(() => document.activeElement?.id === 'shareAddress');
  assert.equal(await page.locator('#shareAddress').evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length), true);
  assert.match(await page.locator('#toast').innerText(), /clipboard unavailable/i);
  await page.keyboard.press('Escape');
  // Exercise the visible button as well; this must return focus when its fallback closes.
  await page.locator('#sAddr').focus(); await page.locator('#sAddr').click();
  await page.locator('#shareAddress').waitFor({state: 'visible'});
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sAddr');
  // A stub records the success branch without writing to the real clipboard.
  await page.evaluate(() => {navigator.clipboard.writeText = async value => {window.__copiedAddress = value;};});
  assert.equal(await page.evaluate(() => LuckyCloud.copyAddress()), true);
  assert.equal(await page.evaluate(() => window.__copiedAddress), expected);
  assert.match(await page.locator('#toast').innerText(), /^Address copied/);
  return {canonicalAddress: expected, deniedReturnsFalse: true, fallbackSelectable: true, successUsesSameAddress: true};
}

async function runBrowser(kind, origin) {
  const browser = await pw[kind].launch({headless: true, ...(kind === 'chromium' ? {args: ['--mute-audio']} : {})});
  const result = {browser: kind, cases: [], errors: [], blockedExternal: []};
  async function one(name, fn) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    await instrumentation(context);
    await context.route(/^https?:/, route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      result.blockedExternal.push({method: route.request().method(), url: route.request().url()}); return route.abort();
    });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {const detail = await fn(page, context); assert.deepEqual(errors, []); result.cases.push({name, pass: true, ...detail});}
    catch (error) {result.cases.push({name, pass: false, failure: String(error.stack || error), errors});}
    finally {await context.close();}
  }
  try {
    await one('actual cloud UI, audio, rolling, history, MIDI and export cancellation', async page => {
      await page.goto(pathToFileURL(file).href); await page.waitForFunction(() => !!window.LuckyCloud);
      assert.equal(await page.evaluate(() => __cloudAudit.contexts.length), 0, 'fresh load never starts audio');
      assert.ok(!(await page.locator('body').innerText()).includes('RING F4'), 'no private source diary visible');
      await page.locator('#dice').focus(); await page.keyboard.press('Enter'); await live(page);
      const peak = await samplePeak(page); assert.ok(peak > .001 && peak < 1.01, `real output peak ${peak}`);
      await page.evaluate(() => LuckyCloud.seed(948216731));
      if (!await page.evaluate(() => KNOCK.state.playing)) await page.locator('#bPlay').click();
      await live(page);
      const before = await page.evaluate(() => JSON.stringify(KNOCK.world().events));
      const lead = page.locator('#band .row').filter({has: page.locator('.role', {hasText: /^lead$/i})});
      await lead.getByRole('button', {name: 'SOUND', exact: true}).click();
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => JSON.stringify(KNOCK.world().events)), before, 'sound button keeps the whole score');
      assert.equal(await page.evaluate(() => KNOCK.state.playing), true, 'sound roll continues playback');
      await page.locator('#bPlay').click(); await parked(page);
      // A deterministic address round trip restores music but requires a new play gesture.
      const saved = await snapshot(page); await page.reload(); await page.waitForFunction(() => !!window.LuckyCloud);
      assert.equal(await page.evaluate(() => KNOCK.state.playing), false);
      assert.equal(await page.evaluate(() => __cloudAudit.contexts.length), 0);
      assert.equal(await page.evaluate(() => JSON.stringify(KNOCK.world().events)), saved.score);
      await page.locator('#gCont').click(); await live(page); await page.locator('#bPlay').click(); await parked(page);
      await page.evaluate(() => {LuckyCloud.seed(7812345); LuckyCloud.seed(948216731);});
      await page.locator('#bHist').click(); await page.locator('.histbtn').first().waitFor();
      await page.locator('.histbtn').nth(1).click();
      assert.equal(await page.evaluate(() => KNOCK.state.seed), 7812345);
      assert.equal(await page.evaluate(() => KNOCK.state.playing), false, 'choosing history while paused does not play');
      const address = await verifyAddress(page);
      await page.locator('#bSave').click(); const downloadPromise = page.waitForEvent('download');
      await page.locator('#svMidi').click(); const download = await downloadPromise;
      const midi = path.join(out, `${kind}-visitor-score.mid`); await download.saveAs(midi);
      assert.equal(fs.readFileSync(midi).toString('ascii', 0, 4), 'MThd');
      await page.locator('#bSave').click(); await page.locator('#svMix').click();
      await page.waitForTimeout(100); await page.evaluate(() => LuckyCloud.cancelExport());
      await page.waitForFunction(() => !document.querySelector('#bSave').disabled);
      await page.evaluate(() => LuckyCloud.destroy()); await parked(page);
      await page.waitForTimeout(200); const final = await snapshot(page);
      assert.equal(final.state.destroyed, true); assert.ok(final.resources.contexts.every(s => s === 'closed'));
      assert.equal(final.resources.activeWorkers, 0); assert.equal(final.resources.unreleasedUrls, 0);
      return {peak, address, midi: path.basename(midi), final};
    });

    await one('mobile cloud controls and dialog keyboard focus', async page => {
      await page.goto(pathToFileURL(file).href + '#w=9ix'); await page.waitForFunction(() => !!window.LuckyCloud);
      await page.locator('#gCont').click(); await live(page); await page.locator('#bPlay').click(); await parked(page);
      const layouts = [];
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({width, height: 1000});
        const dims = await page.evaluate(() => ({width: innerWidth, documentWidth: document.documentElement.scrollWidth}));
        assert.ok(dims.documentWidth <= width, JSON.stringify(dims)); layouts.push(dims);
        for (const id of ['bStyle', 'bAbout', 'bHist', 'bSave']) {
          await page.locator('#' + id).focus(); await page.keyboard.press('Enter');
          assert.equal(await page.locator('#sheet').evaluate(el => el.classList.contains('on')), true);
          assert.equal(await page.evaluate(() => document.querySelector('#sheet').contains(document.activeElement)), true, id + ' moves focus into dialog');
          for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab');
          assert.equal(await page.evaluate(() => document.querySelector('#sheet').contains(document.activeElement)), true, id + ' traps focus');
          const was = await page.evaluate(() => KNOCK.state.playing); await page.keyboard.press('r');
          assert.equal(await page.evaluate(() => KNOCK.state.playing), was, id + ' keyboard does not play behind dialog');
          await page.keyboard.press('Escape'); assert.equal(await page.locator('#sheet').evaluate(el => el.classList.contains('on')), false);
          assert.equal(await page.evaluate(id => document.activeElement.id === id, id), true, id + ' restores focus');
        }
        if ([390, 1440].includes(width)) await page.screenshot({path: path.join(out, `${kind}-cloud-${width}.png`)});
      }
      return {layouts};
    });

    await one('untrusted history/hash never crashes or starts a session', async page => {
      await page.goto(origin + '/midi-room/instruments/lucky-dreamer.html'); await page.waitForFunction(() => !!window.LuckyCloud);
      const malformed = ['null', '{}', '"oops"', '{bad json', '[null,{}, {"seed":-1,"style":"__proto__","roll":{"lead":{"s":1e100}}}]'];
      for (const raw of malformed) {
        await page.evaluate(raw => localStorage.setItem('knock.hist.v1', raw), raw); await page.reload(); await page.waitForFunction(() => !!window.LuckyCloud);
        assert.equal(await page.evaluate(() => KNOCK.state.playing), false);
        assert.equal(await page.evaluate(() => __cloudAudit.contexts.length), 0);
        const history = await page.evaluate(() => LuckyCloud.readHistory()); assert.ok(Array.isArray(history));
      }
      await page.goto(origin + '/midi-room/instruments/lucky-dreamer.html#w=zzzzzzzzzzzz&y=__proto__&r=constructor.999999999&t=NaN&v=0.999999999');
      await page.waitForFunction(() => !!window.LuckyCloud); assert.equal(await page.evaluate(() => KNOCK.state.playing), false);
      return {malformedCases: malformed.length, final: await snapshot(page)};
    });

    await one('opaque MIDI Room frame, cold-stop race and host dispose', async page => {
      await page.goto(origin + '/midi-room/?instrument=lucky-dreamer'); await page.waitForSelector('#rackTabs .rack-tab');
      const frame = page.frames().find(f => f.parentFrame()); await frame.waitForFunction(() => !!window.LuckyCloud);
      assert.ok(!(await page.locator('iframe').getAttribute('sandbox')).includes('allow-same-origin'));
      await frame.locator('#dice').click(); await page.locator('#stopButton').click(); await page.waitForTimeout(700);
      assert.equal(await frame.evaluate(() => KNOCK.state.playing), false, 'Stop during the entrance roll prevents delayed autoplay');
      assert.equal(await frame.evaluate(() => !KNOCK.state.ctx || KNOCK.state.ctx.state !== 'running'), true);
      await frame.locator('#dice').click(); await frame.waitForFunction(() => KNOCK.state.playing);
      await page.locator('#stopButton').click(); await parked(frame); await page.waitForTimeout(500);
      assert.equal(await frame.evaluate(() => KNOCK.state.playing), false, 'late initialization cannot undo host Stop');
      await frame.locator('#bPlay').click(); await live(frame); const peak = await samplePeak(frame); assert.ok(peak > .001);
      await frame.locator('#bPlay').click(); await parked(frame);
      await frame.evaluate(() => {LuckyCloud.seed(7812345); LuckyCloud.seed(948216731);});
      assert.equal(await frame.evaluate(() => LuckyCloud.getState().historyMode), 'session');
      await frame.locator('#bHist').click(); await frame.locator('.histbtn').first().waitFor();
      const historyCopy = await frame.locator('.history-scope').innerText();
      assert.match(historyCopy, /memory/i); assert.match(historyCopy, /clos.*reload.*clear/i);
      await frame.locator('.histbtn').nth(1).click(); assert.equal(await frame.evaluate(() => KNOCK.state.seed), 7812345);
      assert.equal(await frame.evaluate(() => KNOCK.state.playing), false);
      // Frame has no keyboard API; route key presses through its owning page.
      const address = await verifyAddress(Object.assign(frame, {keyboard: page.keyboard}));
      await frame.evaluate(() => window.dispatchEvent(new Event('midiroom:dispose'))); await parked(frame);
      const final = await snapshot(frame); assert.equal(final.state.destroyed, true);
      assert.deepEqual(final.violations, []); assert.equal(final.resources.activeWorkers, 0);
      assert.equal(await frame.evaluate(() => LuckyCloud.readHistory().length), 0, 'dispose clears session-only memory');
      await page.reload(); await page.waitForSelector('#rackTabs .rack-tab');
      const fresh = page.frames().find(f => f.parentFrame()); await fresh.waitForFunction(() => !!window.LuckyCloud);
      assert.equal(await fresh.evaluate(() => LuckyCloud.readHistory().length), 0, 'new opaque instrument starts with empty history');
      assert.equal(await fresh.evaluate(() => KNOCK.state.playing), false);
      return {peak, address, historyCopy, final};
    });
  } finally {await browser.close();}
  result.pass = result.cases.every(c => c.pass); return result;
}
(async () => {
  report.targetSha256 = targetSha256;
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  try {for (const kind of ['chromium', 'webkit']) {const run = await runBrowser(kind, origin); report.runs.push(run); fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(kind, JSON.stringify(run.cases.map(c => ({name: c.name, pass: c.pass, failure: c.failure}))));}}
  finally {server.close();}
  if (report.runs.some(r => !r.pass)) process.exitCode = 1;
})().catch(e => {console.error(e); process.exitCode = 1; server.close();});
