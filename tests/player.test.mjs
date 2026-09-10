import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

// Exercises the actual host controller with explicit DOM, permission and frame doubles.
// This is a lifecycle simulation, not a browser/audio/hardware test.
const busCode = readFileSync(new URL('../dist/instrument-bus.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const surfaceCode = readFileSync(new URL('../dist/surface-router.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const pluginCode = readFileSync(new URL('../dist/plugin-contract.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const catalogCode = readFileSync(new URL('../dist/catalog.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const code = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8').replace(/^import .+;\n/gm, '');

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
  emit(type, detail = {}) { for (const fn of this.listeners.get(type) || []) fn(detail); }
}
class Element extends Target {
  constructor(tag = 'div') {
    super(); this.tagName = tag; this.children = []; this.options = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.value = '';
    this.classes = new Set(); this.classList = { add: (...values) => values.forEach(value => this.classes.add(value)), remove: (...values) => values.forEach(value => this.classes.delete(value)), toggle: (value, on) => on ? this.classes.add(value) : this.classes.delete(value) };
    if (tag === 'template') this.content = { cloneNode: () => new Element('fragment') };
    if (tag === 'iframe') this.contentWindow = { messages: [], postMessage(...args) { this.messages.push(args); } };
  }
  append(...children) { this.children.push(...children); for (const child of children) child.parentNode = this; }
  replaceChildren(...children) { this.children = []; this.options = []; this.append(...children); if (this.tagName === 'select') this.options = children.slice(); }
  add(option) { this.options.push(option); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  focus() { this.focused = true; }
  click() { return this.onclick?.(); }
  close() { this.open = false; }
  showModal() { this.open = true; }
}
class Port {
  constructor() { this.messages = []; this.closed = false; }
  postMessage(data) { this.messages.push(data); }
  start() {}
  close() { this.closed = true; }
  receive(data) { this.onmessage?.({ data }); }
}
class Sequence {
  generation = 0;
  next() { const generation = ++this.generation; return () => generation === this.generation; }
  cancel() { this.generation++; }
}

function harness({ supported = true, share, canShare, embedded } = {}) {
  const nodes = new Map();
  const document = new Target();
  document.body = new Element('body'); document.hidden = false; document.baseURI='https://example.test/midi-room/';
  document.getElementById = id => {
    if (!nodes.has(id)) nodes.set(id, new Element(id === 'inputSelect' ? 'select' : id === 'roomCredits' ? 'template' : 'div'));
    return nodes.get(id);
  };
  document.createElement = tag => new Element(tag);
  if (embedded) document.getElementById('bundledTriton').textContent = JSON.stringify(embedded);
  const window = new Target();
  const timers = new Map(); let clockId = 0;
  const prepared = [];
  const channels = [];
  const downloads = [];
  let nativeCalls = 0, fetchCalls = 0;
  const nav = { userActivation: { isActive: false }, share, canShare };
  if (supported) nav.requestMIDIAccess = () => { nativeCalls++; return Promise.resolve(); };
  class Broker {
    constructor(options) { this.options = options; this.state = { status: supported ? 'idle' : 'unavailable', access: false, inputs: [], devices: [], selection: 'auto', error: null }; }
    discover() { return Promise.resolve(this.state); }
    getState() { return this.state; }
    async connect() { await this.options.requestAccess(); this.state.access = true; this.state.status = 'ready'; this.options.onState(this.state); return this.state; }
    panic() { this.options.onPanic(); }
    setSelection(selection) { this.state.selection = selection; this.options.onState(this.state); }
  }
  const context = vm.createContext({
    window, document, navigator: nav, MidiBroker: Broker, TextEncoder, bindWishWell: () => null,
    INSTRUMENT_SANDBOX: 'allow-scripts allow-downloads allow-modals', LoadSequence: Sequence,
    prepareInstrument(source, options) { if (source === 'invalid') throw new Error('Invalid HTML'); prepared.push({ source, options }); return source; },
    safeFilename: name => String(name || 'instrument.html').split(/[\\/]/).pop(),
    validateInstrument(file) { if (!/\.html?$/i.test(file.name)) throw new Error('Choose HTML'); },
    crypto: webcrypto, Blob, File, DOMException, console, Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    MessageChannel: class { constructor() { this.port1 = new Port(); this.port2 = new Port(); channels.push(this); } },
    URL: class extends URL { static createObjectURL(blob) { downloads.push(blob); return `blob:download-${downloads.length}`; } static revokeObjectURL() {} }, URLSearchParams, location: {href:'https://example.test/midi-room/',protocol:'https:',hash:''}, history:{replaceState(){}},
    setTimeout(fn, delay) { const id = ++clockId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: async () => { fetchCalls++; if (embedded) throw new Error('Portable player must not fetch its instrument'); return { ok: true, text: async () => '<html>ensemble</html>' }; },
  });
  const pluginPrelude='const {extractPlugin,validatePlugin,validateRack,verifyPlugin}=(function(){'+pluginCode+'\nreturn {extractPlugin,validatePlugin,validateRack,verifyPlugin};})();\n';
  vm.runInContext(catalogCode + '\n' + pluginPrelude + busCode + '\n' + surfaceCode + '\n' + code + '\nglobalThis.appTest={openFile,openTriton,stopSound,closeInstrument,handlePortMessage,focusSession,connectWire,bus,sessions,get active(){return active},get staging(){return staging},get saves(){return saves},get broker(){return broker}};', context);
  const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  async function activate(file = new File(['<html>instrument</html>'], 'keys.html'), append = false) {
    const pending = context.appTest.openFile(file, append);
    await tick();
    const session = context.appTest.staging;
    assert.ok(session);
    window.emit('message', { source: session.frame.contentWindow, data: { type: 'midiroom:ready', nonce: session.nonce } });
    session.frame.emit('load');
    await pending;
    return session;
  }
  return { context, app: context.appTest, nodes, document, window, timers, prepared, channels, downloads, nav, tick, activate, get nativeCalls() { return nativeCalls; }, get fetchCalls() { return fetchCalls; } };
}

test('portable player opens its embedded instrument through the normal isolated handshake without a fetch', async () => {
  const source = '<!doctype html><html><body>Embedded instrument</body></html>';
  const h = harness({ embedded: source });
  const pending = h.app.openTriton(); await h.tick();
  const session = h.app.staging;
  assert.equal(h.prepared[0].source, source);
  assert.equal(h.fetchCalls, 0);
  assert.equal(h.nativeCalls, 0);
  assert.equal(session.frame.attributes.sandbox.includes('allow-same-origin'), false);
  h.window.emit('message', { source: session.frame.contentWindow, data: { type: 'midiroom:ready', nonce: session.nonce } });
  session.frame.emit('load'); await pending;
  assert.equal(h.app.active, session);
});

test('an HTML instrument is isolated and activates only after both handshake and load', async () => {
  const h = harness();
  const pending = h.app.openFile(new File(['<html/>'], 'keys.html'));
  await h.tick();
  const session = h.app.staging;
  assert.equal(session.frame.attributes.sandbox.includes('allow-same-origin'), false);
  session.frame.emit('load');
  assert.equal(h.app.active, null);
  h.window.emit('message', { source: {}, data: { type: 'midiroom:ready', nonce: session.nonce } });
  assert.equal(session.port, null);
  h.window.emit('message', { source: session.frame.contentWindow, data: { type: 'midiroom:ready', nonce: 'wrong' } });
  assert.equal(session.port, null);
  h.window.emit('message', { source: session.frame.contentWindow, data: { type: 'midiroom:ready', nonce: session.nonce } });
  await pending;
  assert.equal(h.app.active, session);
  assert.equal(h.nodes.get('welcome').hidden, true);
  assert.equal(h.nativeCalls, 0);
});

test('invalid or empty selections preserve the active instrument', async () => {
  const h = harness(); const first = await h.activate();
  await h.app.openFile(new File(['x'], 'song.mid'));
  assert.equal(h.app.active, first);
  await h.app.openFile(new File(['invalid'], 'broken.html'));
  assert.equal(h.app.active, first);
  assert.equal(first.retired, false);
  assert.equal(h.nodes.get('loading').hidden, true);
});

test('a slow earlier file cannot replace a later selection', async () => {
  const h = harness(); let finishRead;
  const slow = h.app.openFile({ name: 'slow.html', text: () => new Promise(resolve => { finishRead = resolve; }) });
  const fast = await h.activate(new File(['<html>fast</html>'], 'fast.html'));
  finishRead('<html>slow</html>');
  await slow;
  assert.equal(h.app.active, fast);
  assert.equal(h.app.staging, null);
});

test('successful replacement disposes the old frame and ignores old MIDI requests', async () => {
  const h = harness(); const old = await h.activate(); const current = await h.activate(new File(['<html>new</html>'], 'new.html'));
  assert.equal(old.retired, true);
  assert.equal(old.port.closed, true);
  assert.ok(old.port.messages.some(message => message.type === 'dispose'));
  const before = current.port.messages.length;
  old.port.receive({ type: 'request-midi', requestId: 'stale' });
  assert.equal(current.port.messages.length, before);
  assert.equal(h.nativeCalls, 0);
});

test('an imported file cannot automatically prompt for MIDI without activation', async () => {
  const h = harness(); const session = await h.activate();
  session.port.receive({ type: 'request-midi', requestId: 'request-1' });
  await h.tick();
  assert.equal(h.nativeCalls, 0);
  assert.equal(session.requests.size, 1);
  await h.nodes.get('midiButton').click();
  assert.equal(h.nativeCalls, 1);
  assert.ok(session.port.messages.some(message => message.type === 'midi-state' && message.state.access));
});

test('unsupported hardware MIDI rejects cleanly without blocking touch instruments', async () => {
  const h = harness({ supported: false }); const session = await h.activate();
  session.port.receive({ type: 'request-midi', requestId: 'request-1' });
  const response = session.port.messages.find(message => message.type === 'midi-result');
  assert.equal(response.ok, false);
  assert.equal(response.error.name, 'NotSupportedError');
  assert.equal(h.app.active, session);
  await h.nodes.get('midiButton').click();
  assert.equal(h.nodes.get('unsupported').open, true);
});

test('file exports require a direct save action; malformed exports cannot navigate the host', async () => {
  const h = harness(); const session = await h.activate();
  session.port.receive({ type: 'save', id: 'bad', blob: { url: 'https://invalid.example' }, name: 'bad' });
  assert.equal(h.app.saves.length, 0);
  session.port.receive({ type: 'save', id: 'take', blob: new Blob(['MThd'], { type: 'audio/midi' }), name: '../take.mid' });
  assert.equal(h.app.saves.length, 1);
  assert.equal(h.downloads.length, 0);
  assert.equal(session.port.messages.some(message => message.type === 'save-result'), false);
  const row = h.nodes.get('saveTray').children[0];
  await row.children[1].click();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.app.saves.length, 0);
  assert.ok(session.port.messages.some(message => message.type === 'save-result' && message.ok));
});

test('a cancelled native save rejects the instrument share promise', async () => {
  const h = harness({ canShare: () => true, share: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  const session = await h.activate();
  session.port.receive({ type: 'save', id: 'take', blob: new Blob(['MThd']), name: 'take.mid' });
  await h.nodes.get('saveTray').children[0].children[1].click();
  assert.equal(h.downloads.length, 0);
  const result = session.port.messages.find(message => message.type === 'save-result');
  assert.equal(result.ok, false);
  assert.equal(result.error.name, 'AbortError');
});

test('Save instrument retains an explicit download fallback after a native share failure', async () => {
  const h = harness({ canShare: () => true, share: async () => { throw new Error('Cannot share HTML'); } });
  await h.activate();
  await h.nodes.get('saveInstrument').click();
  assert.equal(h.app.saves.length, 1);
  assert.equal(h.app.saves[0].downloadOnly, true);
  assert.equal(h.downloads.length, 0);
  await h.nodes.get('saveTray').children[0].children[1].click();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.app.saves.length, 0);
});

test('Stop and backgrounding silence current sound; close removes the audio document', async () => {
  const h = harness(); const session = await h.activate();
  h.nodes.get('stopButton').click();
  assert.ok(session.port.messages.some(message => message.type === 'panic' && message.suspend !== false));
  session.port.messages = [];
  h.document.hidden = true; h.document.emit('visibilitychange');
  assert.ok(session.port.messages.some(message => message.type === 'panic' && message.suspend !== false));
  h.app.closeInstrument();
  assert.equal(h.app.active, null);
  assert.equal(session.frame.parentNode.children.includes(session.frame), false);
  assert.equal(h.nodes.get('welcome').hidden, false);
});

test('rack keeps instruments alive and hardware reaches only the focused slot', async () => {
  const h = harness();
  const a = await h.activate(new File(['<html>a</html>'],'a.html'));
  const b = await h.activate(new File(['<html>b</html>'],'b.html'),true);
  assert.equal(h.app.sessions.length,2); assert.equal(a.retired,false); assert.equal(a.port.closed,false);
  const notes = s => s.port.messages.filter(m=>m.type==='midi').length;
  h.app.broker.options.onMIDI({inputId:'keyboard',data:[0x90,60,90]});
  assert.equal(notes(a),0); assert.equal(notes(b),1);
  h.app.focusSession(a);
  // Leaving a slot no longer silences it. This used to send hardware-panic -- an
  // all-notes-off -- which stopped the instrument's sequencer and its wired notes
  // too, and a player reported exactly that on 2026-09-06. The panic was cleaning up
  // after focusRouter.release(), which had just dropped b's claim on the held note so
  // the real note-off went nowhere. Do neither, and the router does the right thing on
  // its own: it remembers which slot started each note and sends the off to that slot.
  assert.equal(b.port.messages.some(m=>m.type==='hardware-panic'),false);
  h.app.broker.options.onMIDI({inputId:'keyboard',data:[0x80,60,0]});
  assert.equal(notes(a),0);                           // the late off does not reach the new focus
  assert.equal(notes(b),2);                           // it reaches the slot holding the note, as a real note-off
  assert.equal(h.nodes.get('frameMount').children.length,2);
});

test('explicit wires carry authenticated notes and survive keyboard focus changes', async () => {
  const h = harness(); const a = await h.activate(), b = await h.activate(new File(['<html>b</html>'],'b.html'),true);
  a.port.receive({type:'instrument-ready',name:'Source',send:['midi','field','transport'],receive:['midi']});
  b.port.receive({type:'instrument-ready',name:'Target',send:[],receive:['midi','field','transport']});
  a.port.receive({type:'instrument-publish',event:{kind:'midi',data:[0x90,60,90]}});
  assert.equal(b.port.messages.filter(m=>m.type==='instrument-event').length,0);
  assert.equal(h.app.connectWire(a.nonce,b.nonce,'follow'),true);
  h.app.focusSession(a);
  a.port.receive({type:'instrument-publish',event:{kind:'midi',data:[0x90,60,90],origin:'forged'}});
  const delivered = b.port.messages.find(m=>m.kind==='midi');
  assert.equal(delivered.origin,a.nonce); assert.equal(delivered.destination,b.nonce);
  assert.equal(h.app.bus.snapshot().routes.length,1);
  a.port.receive({type:'instrument-publish',event:{kind:'transport',action:'stop'}});
  assert.ok(b.port.messages.some(m=>m.kind==='cancel' && !m.removed));
  assert.equal(h.app.bus.snapshot().routes.length,1);
});

test('the wire status names what a cable carries, what the target refused, and never lists the refused source as its own alternative', async () => {
  const h = harness(); const a = await h.activate(), b = await h.activate(new File(['<html>b</html>'],'b.html'),true);
  a.port.receive({type:'instrument-ready',name:'Lucky Dreamer',send:['midi','transport'],receive:[]});
  b.port.receive({type:'instrument-ready',name:'Improvisator',send:['midi'],receive:['midi']});
  assert.equal(h.app.connectWire(a.nonce,b.nonce,'follow'),true);
  const status = h.nodes.get('wireStatus').textContent;
  assert.match(status, /^Connected: Notes\. Improvisator does not take Clock; it keeps its own tempo\. Enable audio/);
  assert.equal(h.app.bus.snapshot().routes[0].kinds.join(), 'midi');
  assert.equal(h.app.connectWire(a.nonce,b.nonce,'field'),false);
  const refusal = h.nodes.get('wireStatus').textContent;
  assert.match(refusal, /^Improvisator does not take Field \+ Clock; it keeps its own tempo\./);
  assert.doesNotMatch(refusal, /Lucky Dreamer/);
  // a second clock master into one follower is refused by the bus, and the dialog shows why
  const c = await h.activate(new File(['<html>c</html>'],'c.html'),true), d = await h.activate(new File(['<html>d</html>'],'d.html'),true);
  c.port.receive({type:'instrument-ready',name:'Field Keys',send:[],receive:['midi','field','transport','signal']});
  d.port.receive({type:'instrument-ready',name:'Lucky Dreamer',send:['midi','transport'],receive:[]});
  assert.equal(h.app.connectWire(a.nonce,c.nonce,'follow'),true);
  assert.match(h.nodes.get('wireStatus').textContent, /^Connected: Notes \+ Clock\. Enable audio/);
  assert.equal(h.app.connectWire(d.nonce,c.nonce,'follow'),false);
  assert.match(h.nodes.get('wireStatus').textContent, /already follows another clock/);
  assert.equal(h.app.connectWire(d.nonce,c.nonce,'notes'),true);
  assert.equal(h.app.bus.snapshot().routes.length,3);
});

test('two of the same instrument are told apart everywhere the room names them', async () => {
  // Measured against the served room on 2026-09-09: two Lucky Dreamers both read
  // "Lucky Dreamer" in the From menu, the To menu, the wire list and the rack tabs, so a
  // player aiming the SECOND one's clock cable was guessing, and picking the first one
  // again answered "This connection already exists" — which says nothing about clocks.
  // That is what a report of overlapping masters looks like from the player's chair.
  const h = harness();
  const a = await h.activate(), b = await h.activate(new File(['<html>b</html>'],'b.html'),true), c = await h.activate(new File(['<html>c</html>'],'c.html'),true);
  a.port.receive({type:'instrument-ready',name:'Lucky Dreamer',send:['midi','transport'],receive:[]});
  b.port.receive({type:'instrument-ready',name:'Lucky Dreamer',send:['midi','transport'],receive:[]});
  c.port.receive({type:'instrument-ready',name:'Field Keys',send:[],receive:['midi','field','transport','signal']});
  assert.equal(h.app.connectWire(a.nonce,c.nonce,'field'),true);
  const menu = h.nodes.get('wireFrom').options.map(option => option.text);
  assert.equal(new Set(menu).size, menu.length, 'every source in the From menu reads differently');
  assert.deepEqual(menu.filter(text => text.startsWith('Lucky')), ['Lucky Dreamer 1','Lucky Dreamer 2']);
  assert.deepEqual(h.nodes.get('rackTabs').children.map(tab => tab.textContent), ['Lucky Dreamer 1','Lucky Dreamer 2','Field Keys']);
  assert.equal(h.nodes.get('wireList').children[0].children[0].children[0].textContent, 'Lucky Dreamer 1 → Field Keys');
  // The refusal a second clock earns now says which twin is already in the seat.
  assert.equal(h.app.connectWire(b.nonce,c.nonce,'field'),false);
  assert.match(h.nodes.get('wireStatus').textContent, /already follows another clock/);
  // One of a kind is still one plain name: close a twin and the survivor stops counting.
  h.app.focusSession(a); h.app.closeInstrument();
  assert.deepEqual(h.nodes.get('rackTabs').children.map(tab => tab.textContent), ['Lucky Dreamer','Field Keys']);
});

test('close removes only the selected slot and sends destination cancellation before teardown', async () => {
  const h = harness();const a = await h.activate(), b = await h.activate(new File(['<html>b</html>'],'b.html'),true);
  a.port.receive({type:'instrument-ready',send:['midi'],receive:['midi']});
  h.app.connectWire(a.nonce,b.nonce,'notes');
  h.app.focusSession(a); h.app.closeInstrument();
  assert.equal(a.retired,true); assert.equal(b.retired,false); assert.equal(h.app.active,b);
  assert.equal(h.nodes.get('frameMount').hidden,false); assert.equal(h.app.bus.snapshot().routes.length,0);
  assert.ok(b.port.messages.some(m=>m.kind==='cancel' && m.removed));
});

test('legacy VibeBus uses one delivery path and ignores unknown windows and reflected messages', async () => {
  const h = harness(); const a = await h.activate(), b = await h.activate(new File(['<html>b</html>'],'b.html'),true);
  a.port.receive({type:'instrument-ready',send:['signal'],receive:[]});
  b.port.receive({type:'instrument-ready',send:[],receive:['signal'],legacyVibeBus:true});
  assert.equal(h.app.connectWire(a.nonce,b.nonce,'vibe'),true);
  const signal = {type:'VIBE_BUS_SIGNAL',source:'forged',signal:'CV_SOURCE',value:3};
  h.window.emit('message',{source:{},data:signal});
  h.window.emit('message',{source:a.frame.contentWindow,data:{...signal,midiRoomRouted:true}});
  assert.equal(b.frame.contentWindow.messages.filter(([m])=>m.type==='VIBE_BUS_SIGNAL').length,0);
  h.window.emit('message',{source:a.frame.contentWindow,data:signal});
  const messages = b.frame.contentWindow.messages.filter(([m])=>m.type==='VIBE_BUS_SIGNAL');
  assert.equal(messages.length,1); assert.equal(messages[0][0].source,a.nonce);
  assert.equal(b.port.messages.filter(m=>m.kind==='signal').length,0);
});

test('touch and keyboard gestures do not request hardware MIDI; explicit MIDI does', async () => {
  const h = harness(); assert.equal(h.nativeCalls,0);
  h.document.emit('pointerdown',{isTrusted:false}); await h.tick(); assert.equal(h.nativeCalls,0);
  h.document.emit('pointerdown',{isTrusted:true}); h.document.emit('pointerdown',{isTrusted:true}); await h.tick();
  assert.equal(h.nativeCalls,0); await h.nodes.get('reconnectButton').click(); await h.tick(); assert.equal(h.nativeCalls,1); assert.equal(h.app.broker.state.access,true);
});

test('inactive instrument requests cannot expose focused hardware inputs', async () => {
  const h = harness(); const a = await h.activate(), b = await h.activate(new File(['<html>b</html>'],'b.html'),true);
  await h.app.broker.connect();
  h.app.broker.state.inputs = [{id:'keyboard',name:'Real keyboard'}];
  h.app.broker.options.onState(h.app.broker.state);
  a.port.receive({type:'request-midi',requestId:'background'});
  const reply = a.port.messages.find(m=>m.type==='midi-result' && m.requestId==='background');
  assert.equal(reply.ok,true); assert.equal(reply.state.inputs.length,0);
  assert.equal(b.port.messages.filter(m=>m.type==='midi-state').at(-1).state.inputs.length,1);
});

test('room log excludes instrument names and note content and has a manual copy fallback', async () => {
  const h = harness(); await h.activate(new File(['<html>private</html>'],'secret-song.html'));
  h.nodes.get('roomCheck').click();
  const report = h.nodes.get('roomLogText').value;
  assert.equal(report.includes('secret-song'),false); assert.equal(JSON.parse(report).instruments.length,1);
  const box = h.nodes.get('roomLogText'); box.select=()=>{box.selected=true};
  await h.nodes.get('copyRoomLog').click();
  assert.equal(box.selected,true); assert.match(h.nodes.get('roomLogStatus').textContent,/Text selected/);
});
