import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Read the actual shipped modules without relying on a scratch package.json.
const configSource = await readFile(new URL('../dist/wish-config.js', import.meta.url), 'utf8');
const configModule = await import('data:text/javascript;base64,' + Buffer.from(configSource).toString('base64'));
const { WISH_CONFIG } = configModule;
const source = (await readFile(new URL('../dist/wish.js', import.meta.url), 'utf8'))
  .replace("import { WISH_CONFIG } from './wish-config.js';", 'const WISH_CONFIG = ' + JSON.stringify(WISH_CONFIG) + ';');
const { bindWishWell } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

class Element {
  constructor() { this.value = ''; this.textContent = ''; this.disabled = false; this.listeners = new Map(); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  fire(type) {
    const event = { preventDefault() { this.prevented = true; } };
    return Promise.all([...this.listeners.get(type) || []].map(fn => fn(event)));
  }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  setSelectionRange(start, end) { this.range = [start, end]; }
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup(options = {}) {
  const nodes = Object.fromEntries(['wishForm', 'wishText', 'wishSubmit', 'wishCopy', 'wishStatus'].map(id => [id, new Element()]));
  const calls = [], copied = [], tasks = new Map(), stored = new Map(options.draft ? [['midi-room.wish-draft.v1', options.draft]] : []);
  let timerID = 0, legacyCalls = 0;
  const document = {
    getElementById(id) { return nodes[id] || null; },
    execCommand(command) { assert.equal(command, 'copy'); legacyCalls++; return options.legacy === true; }
  };
  const storage = options.blockStorage ? { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } : {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key)
  };
  const dependencies = {
    navigator: options.navigator || { clipboard: { writeText: text => { copied.push(text); return Promise.resolve(); } } },
    fetch: (...args) => { calls.push(args); return options.request ? options.request(...args) : Promise.resolve({ ok: true, status: 201 }); },
    setTimeout: (fn, ms) => { const id = ++timerID; tasks.set(id, { fn, ms }); return id; },
    clearTimeout: id => tasks.delete(id),
    storage
  };
  const controller = bindWishWell(document, dependencies);
  const edit = text => { nodes.wishText.value = text; return nodes.wishText.fire('input'); };
  return { nodes, calls, copied, tasks, stored, controller, document, dependencies, edit,
    submit: () => nodes.wishForm.fire('submit'),
    timeout: () => { for (const [id, task] of [...tasks]) { if (task.ms === 12000) { tasks.delete(id); task.fn(); } } },
    legacyCalls: () => legacyCalls };
}

test('binding and draft restoration never send; explicit submit sends only visible text and fixed schema', async () => {
  const app = setup({ draft: 'Keep the groove steady' });
  assert.equal(app.calls.length, 0);
  assert.equal(app.nodes.wishText.value, 'Keep the groove steady');
  await app.edit('  Connect my keyboard automatically  ');
  assert.equal(app.calls.length, 0);
  await app.submit();
  assert.equal(app.calls.length, 1);
  const [url, request] = app.calls[0];
  assert.equal(url, WISH_CONFIG.endpoint);
  assert.deepEqual(JSON.parse(request.body), {
    card_id: 'midi-room-card', wish: 'Connect my keyboard automatically', kind: 'improve', lang: 'en',
    page_url: 'https://persona500.com/midi-room/'
  });
  assert.equal(request.headers.apikey, WISH_CONFIG.anonKey);
  assert.equal(request.headers.Authorization, 'Bearer ' + WISH_CONFIG.anonKey);
  assert.equal(request.headers.Prefer, 'return=minimal');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.referrerPolicy, 'no-referrer');
  assert.equal(app.nodes.wishText.value, '');
  assert.equal(app.nodes.wishStatus.textContent, 'Sent');
  assert.equal(app.stored.size, 0);
  assert.equal(app.tasks.size, 0);
});

test('HTTP failure and network rejection retain the draft and never call it sent', async () => {
  for (const request of [() => Promise.resolve({ ok: false, status: 401 }), () => Promise.reject(Error('offline')), () => { throw Error('sync failure'); }]) {
    const app = setup({ request });
    await app.edit('Let me save my setup');
    await app.submit();
    assert.equal(app.nodes.wishText.value, 'Let me save my setup');
    assert.equal(app.nodes.wishStatus.textContent, 'Not sent · draft kept');
    assert.equal(app.nodes.wishSubmit.disabled, false);
    assert.equal(app.calls.length, 1);
    assert.equal(app.stored.get('midi-room.wish-draft.v1'), 'Let me save my setup');
    assert.equal(app.tasks.size, 0);
  }
});

test('12 second timeout releases the button, aborts request and ignores a late success', async () => {
  const request = deferred();
  const app = setup({ request: () => request.promise });
  await app.edit('Fix sound after switching apps');
  const sending = app.submit();
  assert.equal(app.controller.snapshot().pending, true);
  assert.equal([...app.tasks.values()][0].ms, 12000);
  app.timeout();
  await sending;
  assert.equal(app.nodes.wishStatus.textContent, 'No confirmation · draft kept');
  assert.equal(app.calls[0][1].signal.aborted, true);
  assert.equal(app.nodes.wishSubmit.disabled, false);
  request.resolve({ ok: true, status: 201 });
  await Promise.resolve();
  assert.equal(app.nodes.wishText.value, 'Fix sound after switching apps');
  assert.equal(app.nodes.wishStatus.textContent, 'No confirmation · draft kept');
  assert.equal(app.calls.length, 1);
});

test('double submit and repeated binding make one request; edits during pending send survive', async () => {
  const request = deferred();
  const app = setup({ request: () => request.promise });
  assert.equal(bindWishWell(app.document, app.dependencies), app.controller);
  await app.edit('First wish');
  const sending = app.submit();
  await app.submit();
  assert.equal(app.calls.length, 1);
  await app.edit('A new second wish');
  request.resolve({ ok: true, status: 201 });
  await sending;
  assert.equal(app.nodes.wishText.value, 'A new second wish');
  assert.equal(app.nodes.wishStatus.textContent, 'Sent · new draft kept');
  assert.equal(app.stored.get('midi-room.wish-draft.v1'), 'A new second wish');
});

test('typing and undoing back to the submitted value does not silently erase new draft work', async () => {
  const request = deferred();
  const app = setup({ request: () => request.promise });
  await app.edit('More drum variation');
  const sending = app.submit();
  await app.edit('More drum variation please');
  await app.edit('More drum variation');
  request.resolve({ ok: true });
  await sending;
  assert.equal(app.nodes.wishText.value, 'More drum variation');
  assert.equal(app.nodes.wishStatus.textContent, 'Sent · new draft kept');
});

test('clipboard denial uses legacy copy, then manual text selection when both are blocked', async () => {
  for (const legacy of [true, false]) {
    const app = setup({ legacy, navigator: { clipboard: { writeText: () => Promise.reject(Error('denied')) } } });
    await app.edit('Wish preserved for copy');
    const result = await app.controller.copy();
    assert.equal(result, legacy);
    assert.equal(app.legacyCalls(), 1);
    assert.deepEqual(app.nodes.wishText.range, [0, 'Wish preserved for copy'.length]);
    assert.equal(app.nodes.wishStatus.textContent, legacy ? 'Copied' : 'Text selected · touch and hold to copy');
    assert.equal(app.nodes.wishText.value, 'Wish preserved for copy');
    assert.equal(app.calls.length, 0);
  }
});

test('blocked storage does not block sending or copying; primary copy keeps exact user text', async () => {
  const app = setup({ blockStorage: true });
  await app.edit('  My wish\nwith a second line  ');
  assert.equal(await app.controller.copy(), true);
  assert.deepEqual(app.copied, ['  My wish\nwith a second line  ']);
  assert.equal(app.legacyCalls(), 0);
  await app.submit();
  assert.equal(app.nodes.wishStatus.textContent, 'Sent');
});

test('invalid lengths do not send; restored/persisted drafts remain bounded', async () => {
  const app = setup({ draft: 'x'.repeat(9000) });
  assert.equal(app.nodes.wishText.value.length, 2000);
  for (const invalid of [' ', 'a', '🎶', 'x'.repeat(2001)]) {
    await app.edit(invalid);
    await app.submit();
    assert.equal(app.nodes.wishStatus.textContent, 'Use 2–2000 characters');
  }
  assert.equal(app.calls.length, 0);
  assert.equal(app.stored.get('midi-room.wish-draft.v1').length, 2000);
});

test('destroy removes listeners, cancels pending work and prevents stale UI changes', async () => {
  const request = deferred();
  const app = setup({ request: () => request.promise });
  await app.edit('Keep this draft');
  const sending = app.submit();
  app.controller.destroy();
  assert.equal(app.tasks.size, 0);
  assert.equal(app.calls[0][1].signal.aborted, true);
  await app.submit();
  request.resolve({ ok: true });
  await sending;
  assert.equal(app.calls.length, 1);
  assert.equal(app.nodes.wishText.value, 'Keep this draft');
  assert.equal(app.nodes.wishStatus.textContent, 'Sending…');
});
