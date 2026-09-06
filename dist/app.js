import { BUILTINS, instrumentRoute } from './catalog.js';
import { MidiBroker } from './midi.js';
import { INSTRUMENT_SANDBOX, LoadSequence, prepareInstrument, safeFilename, validateInstrument } from './loader.js';
import { InstrumentBus, validateInstrumentEvent } from './instrument-bus.js';
import { bindWishWell } from './wish.js';
import { SurfaceRouter, FocusRouter, validateProfile } from './surface-router.js';
import { extractPlugin, validatePlugin, validateRack, verifyPlugin } from './plugin-contract.js';

const $ = id => document.getElementById(id);
const supported = typeof navigator.requestMIDIAccess === 'function';
const loadSequence = new LoadSequence();
const saves = [];
const MAX_SAVES = 4;
const MAX_SAVE_BYTES = 256 * 1024 * 1024;
let active = null;
let staging = null;
let latestState = null;
let toastTimer;
let activityTimer;
let totalSaveBytes = 0;
let dragDepth = 0;
let broker;
const sessions = [];
const roomJournal = [];
function logRoom(event, detail = {}) { roomJournal.push({at: new Date().toISOString(),event,...detail}); if (roomJournal.length > 64) roomJournal.shift(); }
const MAX_INSTRUMENTS = 4;
const bus = new InstrumentBus();
const surfaceRouter = new SurfaceRouter({send:(id,event)=>post(present().find(s=>s.nonce===id),{type:'surface-control',...event})});
const focusRouter = new FocusRouter((id,event)=>post(present().find(s=>s.nonce===id),event.panic ? {type:'hardware-panic'} : {type:'midi',...event}));
let adding = false;
let autoAttempted = false;
const busKinds = ['midi', 'transport', 'field', 'signal'];
const legacySignals = ['PARAM_UPDATE', 'CELL_ISOLATED', 'THERMAL_STATE', 'CV_SOURCE', 'PHOTONIC_MOD'];
const sessionName = session => session?.displayName || session?.name.replace(/\.html?$/i, '') || 'Instrument';
const present = () => [...sessions, ...(staging ? [staging] : [])].filter(session => !session.retired);
const builtinPlugin=(id,name,role='instrument')=>validatePlugin({format:'midi-room.plugin/1',id,version:'1.0.0',name,role,engine:{type:'html-sandbox/1'},midi:{mode:'web-midi',channel:null}});

function notify(message, duration = 4800) {
  $('toast').textContent = String(message).slice(0, 220);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
}

function post(session, message) {
  if (!session || session.retired || !session.port) return;
  try { session.port.postMessage(message); } catch { /* A retired frame owns no active sound. */ }
}

function sendState() {
  if (!latestState) return;
  for (const session of present()) {
    post(session, { type: 'midi-state', state: { ...latestState, inputs: session === active ? latestState.inputs : [] } });
    const inputs = bus.snapshot().routes.filter(route => route.to === session.nonce && route.kinds.includes('midi')).map(route => ({ id: 'wire:' + route.id, name: sessionName(sessions.find(item => item.nonce === route.from)) + ' · wire', state: 'connected', type: 'input' }));
    post(session, { type: 'routes-state', inputs });
  }
}

function renderMIDI(state) {
  if (latestState?.status !== state.status || latestState?.inputs.length !== state.inputs.length) logRoom('midi.state',{status:state.status,inputs:state.inputs.length,permission:state.permission});
  latestState = state;
  const connected = state.access && state.inputs.length > 0;
  $('midiLight').classList.toggle('connected', connected);
  $('midiButton').classList.toggle('connected', connected);
  $('midiButton').disabled = state.status === 'requesting';
  // The label keeps a constant footprint; details live in the options dialog.
  $('midiLabel').textContent = 'MIDI';
  $('midiButton').setAttribute('aria-label', connected ? 'MIDI connected. Open input settings' : 'Connect MIDI');
  $('reconnectButton').textContent = state.status === 'requesting' ? 'Connecting…' : state.access ? 'Refresh MIDI' : 'Connect MIDI';
  $('reconnectButton').disabled = state.status === 'requesting';
  const select = $('inputSelect');
  const selected = state.selection || 'auto';
  const signature = JSON.stringify([selected, state.devices.map(d => [d.id, d.name, d.state])]);
  if (select.dataset.signature !== signature) {
    select.dataset.signature = signature;
    select.replaceChildren(new Option('Auto · all connected inputs', 'auto'));
    for (const device of state.devices) select.add(new Option(device.name || 'MIDI input', device.id));
    if (state.devices.length > 1) select.add(new Option('All controllers', 'all'));
    if (![...select.options].some(o => o.value === selected)) select.add(new Option('Selected controller · disconnected', selected));
    select.value = selected;
  }
  select.disabled = !state.access;
  if (!supported) $('midiDetail').textContent = 'Touch is ready. This browser does not expose hardware MIDI.';
  else if (state.error) $('midiDetail').textContent = state.error;
  else if (connected) $('midiDetail').textContent = (state.lastInput?.name ? 'Playing: ' + state.lastInput.name + ' · ' : '') + state.inputs.map(d => d.name || 'MIDI controller').join(' + ');
  else if (state.access) $('midiDetail').textContent = 'Plug in a controller. It will connect automatically.';
  else $('midiDetail').textContent = 'Tap Connect MIDI to allow your controller. Touch and computer keys are ready.';
  sendState();
}

function pulseMIDI() {
  if (activityTimer) return;
  $('midiLight').classList.add('activity');
  activityTimer = setTimeout(() => { $('midiLight').classList.remove('activity'); activityTimer = null; }, 90);
}

broker = new MidiBroker({
  supported,
  requestAccess: () => navigator.requestMIDIAccess({ sysex: false }),
  onState: renderMIDI,
  onMIDI: event => { focusRouter.input(event); pulseMIDI(); },
  onPanic: () => { focusRouter.panic(); for (const session of present()) { post(session, { type: 'hardware-panic' }); surfaceRouter.cancel(session.nonce,'hardware-panic'); } },
});
renderMIDI(broker.getState());

function midiFailure(error) {
  const failure = { name: error?.name || 'NotAllowedError', message: error?.message || 'MIDI access was not granted.' };
  for (const session of present()) {
    if (!session) continue;
    for (const requestId of session.requests) post(session, { type: 'midi-result', requestId, ok: false, error: failure });
    session.requests.clear();
  }
}

async function connectMIDI(quiet = false) {
  quiet = quiet === true;
  if (!supported) {
    if (quiet) return;
    $('settings').close();
    const android = /Android/i.test(navigator.userAgent || '');
    $('unsupportedText').textContent = android ? 'Open this app in Chrome to use your controller. Touch works in this browser.' : 'Hardware MIDI needs a MIDI-capable browser. Touch works here.';
    $('browserLink').hidden = android;
    $('copyAppLink').hidden = !android;
    if (!$('unsupported').open) $('unsupported').showModal();
    midiFailure({ name: 'NotSupportedError', message: 'This browser does not expose hardware MIDI. Touch playing is available.' });
    return;
  }
  try {
    await broker.connect();
    renderMIDI(broker.getState());
    for (const session of present()) session.requests.clear();
    if (!quiet && !latestState.inputs.length) notify('MIDI allowed. Plug in your controller.');
  } catch (error) {
    midiFailure(error);
    if (!quiet) notify(globalThis.isSecureContext === false ? 'MIDI needs HTTPS or localhost. Open the HTTPS app in a MIDI-capable browser.' : 'MIDI was not connected. Check this browser’s site permissions, then tap MIDI again.', 7000);
  }
}

function nonce() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
}

function retire(session) {
  if (!session || session.retired) return;
  clearTimeout(session.timer);
  bus.removeSession(session.nonce); surfaceRouter.remove(session.nonce); focusRouter.release(session.nonce); logRoom('instrument.closed');
  post(session, { type: 'dispose' });
  session.retired = true;
  const index = sessions.indexOf(session); if (index >= 0) sessions.splice(index, 1);
  session.port?.close();
  session.frame.remove();
  session.reject?.(new DOMException('A newer instrument was selected.', 'AbortError'));
  session.reject = null;
}

function cancelStaging() {
  if (!staging) return;
  retire(staging);
  staging = null;
}

function activate(session) {
  if (session !== staging || session.retired || !session.loaded || !session.ready) return;
  clearTimeout(session.timer);
  retire(session.replace);
  sessions.push(session); logRoom('instrument.opened',{slots:sessions.length});
  staging = null;
  session.frame.classList.remove('staging');
  $('frameMount').hidden = false;
  $('welcome').hidden = true;
  $('loading').hidden = true;
  $('transport').hidden = false;
  $('stopButton').disabled = false;
  $('instrumentName').textContent = sessionName(session);
  $('audioLight').classList.remove('running');
  $('audioLabel').textContent = 'Tap to play';
  for (const id of ['reloadButton', 'closeInstrument', 'saveInstrument']) $(id).disabled = false;
  document.title = `${session.name.replace(/\.html?$/i, '')} · MIDI Room`;
  focusSession(session);
  session.resolve();
  session.reject = null;
  session.frame.focus();
}

function rejectSave(session, id, name, message) {
  post(session, { type: 'save-result', id, ok: false, error: { name, message } });
}

function queueSave(session, data) {
  if ((typeof data.id !== 'string' && typeof data.id !== 'number') || !(data.blob instanceof Blob)) return;
  if (saves.some(save => save.session === session && save.id === data.id)) return;
  if (data.blob.size < 1 || data.blob.size > MAX_SAVE_BYTES || totalSaveBytes + data.blob.size > MAX_SAVE_BYTES || saves.length >= MAX_SAVES) {
    rejectSave(session, data.id, 'QuotaExceededError', 'Save or dismiss another file before exporting again. Maximum export size is 256 MB.');
    notify('Save or dismiss a prepared file before exporting again.');
    return;
  }
  const entry = { id: data.id, session, blob: data.blob, name: safeFilename(data.name, 'instrument-export.bin'), busy: false, downloadOnly: false };
  saves.push(entry);
  totalSaveBytes += entry.blob.size;
  renderSaves();
}

function removeSave(entry) {
  const index = saves.indexOf(entry);
  if (index < 0) return;
  saves.splice(index, 1);
  totalSaveBytes -= entry.blob.size;
  renderSaves();
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename(name, 'download.bin');
  document.body.append(link);
  link.click();
  link.remove();
  // Give mobile browsers time to consume the download URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function saveEntry(entry) {
  if (entry.busy) return;
  entry.busy = true;
  renderSaves();
  try {
    const file = new File([entry.blob], entry.name, { type: entry.blob.type || 'application/octet-stream' });
    const useShare = !entry.downloadOnly && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    if (useShare) await navigator.share({ files: [file] });
    else downloadBlob(entry.blob, entry.name);
    post(entry.session, { type: 'save-result', id: entry.id, ok: true });
    removeSave(entry);
    notify(useShare ? 'File handed to your save app.' : 'Download started.');
  } catch (error) {
    if (error?.name === 'AbortError') {
      rejectSave(entry.session, entry.id, 'AbortError', 'Save cancelled.');
      removeSave(entry);
      notify('Save cancelled. You can export again.');
    } else {
      entry.downloadOnly = true;
      entry.busy = false;
      renderSaves();
      notify('Sharing is unavailable. Tap Download to save this file.');
    }
  }
}

function renderSaves() {
  $('saveTray').hidden = saves.length === 0;
  $('saveTray').replaceChildren();
  for (const entry of saves) {
    const row = document.createElement('div');
    row.className = 'save-row';
    const info = document.createElement('span');
    info.className = 'save-info';
    const name = document.createElement('b');
    name.textContent = entry.name;
    const size = document.createElement('small');
    size.textContent = entry.blob.size < 1_048_576 ? `${Math.max(1, Math.round(entry.blob.size / 1024))} KB` : `${(entry.blob.size / 1_048_576).toFixed(1)} MB`;
    info.append(name, size);
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'primary';
    saveButton.textContent = entry.busy ? 'Saving…' : entry.downloadOnly ? 'Download' : 'Save';
    saveButton.disabled = entry.busy;
    saveButton.setAttribute('aria-label', `Save ${entry.name}`);
    saveButton.onclick = () => saveEntry(entry);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'icon-button';
    dismiss.textContent = '×';
    dismiss.disabled = entry.busy;
    dismiss.setAttribute('aria-label', `Dismiss ${entry.name}`);
    dismiss.onclick = () => { rejectSave(entry.session, entry.id, 'AbortError', 'Save dismissed.'); removeSave(entry); };
    row.append(info, saveButton, dismiss);
    $('saveTray').append(row);
  }
}

function handlePortMessage(session, data) {
  if (session.retired || !present().includes(session) || !data || typeof data !== 'object') return;
  if (data.type === 'surface-describe') { if (!surfaceRouter.describe(session.nonce,data.profile)) logRoom('surface.rejected'); return; }
  if (data.type === 'surface-request' && data.version === 1) {
    const payload=data.payload;
    if (!payload || typeof payload !== 'object') return;
    if (data.action === 'bind') surfaceRouter.bind(session.nonce,payload.target === null ? null : payload.target);
    else if (data.action === 'hit') surfaceRouter.hit(session.nonce,payload);
    else if (data.action === 'cancel') surfaceRouter.cancel(session.nonce);
    else if (['save-map','load-map'].includes(data.action) && surfaceRouter.sessions.get(session.nonce)?.profile.kind === 'surface') {
      if (typeof payload.key !== 'string' || !/^[a-zA-Z0-9_.:-]{1,240}$/.test(payload.key)) return;
      const key='midi-room.maps.v1:'+session.storageSlot+':'+payload.key;
      try {
        if (data.action === 'save-map' && JSON.stringify(payload.value).length <= 16000) localStorage.setItem(key,JSON.stringify(payload.value));
        else if (data.action === 'load-map') post(session,{type:'surface-control',version:1,action:'saved-map',key:payload.key,value:JSON.parse(localStorage.getItem(key)||'null')});
      } catch { post(session,{type:'surface-control',version:1,action:'storage-unavailable'}); }
    }
    return;
  }
  if (data.type === 'instrument-ready') {
    const meta = data.manifest || data;
    session.displayName = typeof meta.name === 'string' && meta.name !== 'HTML instrument' ? meta.name.trim().slice(0, 64) : sessionName(session);
    session.legacyVibeBus = meta.legacyVibeBus === true;
    session.capabilities = { send: Array.isArray(meta.send) ? [...new Set(meta.send)].filter(kind => busKinds.includes(kind)) : [], receive: Array.isArray(meta.receive) ? [...new Set(meta.receive)].filter(kind => busKinds.includes(kind)) : ['midi', 'signal'] };
    bus.setCapabilities(session.nonce, session.capabilities);
    renderRack(); sendState(); return;
  }
  if (data.type === 'instrument-publish') {
    const checked = validateInstrumentEvent(data.event);
    if (!checked) return;
    if (checked.kind === 'signal') { session.signals ||= []; if (!session.signals.includes(checked.signal) && session.signals.length < 27) session.signals.push(checked.signal); }
    const result = bus.publish(session.nonce, data.event);
    if (!result.ok && roomJournal[roomJournal.length - 1]?.reason !== result.reason) logRoom('wire.rejected',{reason:result.reason});
    if (checked.kind === 'transport' && checked.action === 'stop') cancelOutgoing(session);
    return;
  }
  if (data.type === 'gesture') {
    if (navigator.userActivation?.isActive) focusSession(session);
    return;
  }
  if (data.type === 'request-midi') {
    if (typeof data.requestId !== 'string' && typeof data.requestId !== 'number') return;
    if (!supported) {
      post(session, { type: 'midi-result', requestId: data.requestId, ok: false, error: { name: 'NotSupportedError', message: 'This browser supports touch playing but does not expose hardware MIDI.' } });
    } else if (latestState.access) {
      post(session, { type: 'midi-result', requestId: data.requestId, ok: true, state: { ...latestState, inputs: session === active ? latestState.inputs : [] } });
    } else if (session.requests.size < 32) {
      session.requests.add(data.requestId);
      if (navigator.userActivation?.isActive) autoConnect();
    }
  } else if (data.type === 'audio-state') {
    session.audio = data.state;
    renderRackActivity();
    if (session !== active) return;
    const running = data.state === 'running';
    $('audioLight').classList.toggle('running', running);
    $('audioLabel').textContent = running ? 'Audio on' : data.state === 'suspended' ? 'Tap to resume' : 'Tap to play';
  } else if (data.type === 'save') queueSave(session, data);
  else if (data.type === 'notice' && typeof data.message === 'string' && !session.noticeShown) {
    session.noticeShown = true;
    notify(data.message, 6500);
  }
}

window.addEventListener('message', event => {
  const data = event.data;
  if (data?.type === 'VIBE_BUS_SIGNAL') {
    const sender = present().find(session => event.source === session.frame.contentWindow);
    const signal = validateInstrumentEvent({ kind: 'signal', signal: data.signal, value: data.value });
    if (!sender || !signal || data.midiRoomRouted === true) return;
    sender.signals ||= []; if (!sender.signals.includes(signal.signal) && sender.signals.length < 27) sender.signals.push(signal.signal);
    if (!sender.capabilities.send.includes('signal')) { sender.capabilities.send.push('signal'); bus.setCapabilities(sender.nonce, sender.capabilities); renderRack(); }
    bus.publish(sender.nonce, signal); return;
  }
  if (!data || data.type !== 'midiroom:ready') return;
  const session = present().find(item => event.source === item.frame.contentWindow && data.nonce === item.nonce);
  if (!session || session.port) return;
  const channel = new MessageChannel();
  session.port = channel.port1;
  session.port.onmessage = event => handlePortMessage(session, event.data);
  session.port.start();
  session.frame.contentWindow.postMessage({ type: 'midiroom:boot', nonce: session.nonce }, '*', [channel.port2]);
  session.ready = true;
  post(session, { type: 'midi-state', state: { ...latestState, inputs: session === active ? latestState.inputs : [] } });
  activate(session);
});

async function mountInstrument(source, name, append = false, plugin = null) {
  cancelStaging();
  if (append && sessions.length >= MAX_INSTRUMENTS) throw new Error('Four instruments fit this rack. Close one to add another.');
  const session = { frame: document.createElement('iframe'), nonce: nonce(), source, name: safeFilename(name), port: null, ready: false, loaded: false, retired: false, requests: new Set(), replace: append ? null : active, capabilities: { send: [], receive: ['midi', 'signal'] }, audio: 'off' };
  session.plugin = plugin || extractPlugin(source,name);
  for(const requirement of session.plugin.requirements){
    if(requirement==='web-midi'&&!supported)throw Error('This instrument requires Web MIDI, unavailable in this browser.');
    if(requirement==='wasm'&&typeof WebAssembly==='undefined')throw Error('This instrument requires WebAssembly.');
    if(requirement==='audio-worklet'&&typeof AudioWorkletNode==='undefined')throw Error('This instrument requires AudioWorklet on localhost or HTTPS.');
  }
  session.storageSlot = session.replace?.storageSlot || Array.from({length:MAX_INSTRUMENTS},(_,i)=>String(i)).find(slot=>!sessions.some(s=>s.storageSlot===slot));
  const documentSource = prepareInstrument(source, { nonce: session.nonce, supported });
  staging = session;
  bus.addSession({ id: session.nonce, capabilities: session.capabilities, send: envelope => {
    if (envelope.kind !== 'signal' || !session.legacyVibeBus) post(session, envelope);
    if (envelope.kind === 'signal' && session.legacyVibeBus) session.frame.contentWindow.postMessage({ type: 'VIBE_BUS_SIGNAL', source: envelope.origin, signal: envelope.signal, value: envelope.value, timestamp: envelope.at, midiRoomRouted: true, id: envelope.id }, '*');
  } });
  session.frame.title = `${session.name.replace(/\.html?$/i, '')} instrument`;
  session.frame.setAttribute('sandbox', INSTRUMENT_SANDBOX);
  session.frame.setAttribute('allow', 'autoplay');
  session.frame.referrerPolicy = 'no-referrer';
  session.frame.className = 'instrument-frame staging';
  session.frame.addEventListener('load', () => { session.loaded = true; activate(session); });
  const complete = new Promise((resolve, reject) => { session.resolve = resolve; session.reject = reject; });
  session.timer = setTimeout(() => {
    if (session !== staging) return;
    session.reject(new Error('This instrument could not start. Try a standalone .html file.'));
    session.reject = null;
    cancelStaging();
    $('loading').hidden = true;
    if (!active) $('frameMount').hidden = true;
  }, 15_000);
  session.frame.srcdoc = documentSource;
  $('frameMount').hidden = false;
  $('frameMount').append(session.frame);
  await complete;
}

async function openFile(file, append = false) {
  if (!file) return;
  // A bad selection does not interrupt the playing instrument.
  try {
    if (/\.json$/i.test(file.name)) { if (file.size<1||file.size>16*1024*1024) throw Error('Choose plugin JSON smaller than 16 MiB.'); }
    else validateInstrument(file);
  } catch (error) { notify(error.message); return; }
  const current = loadSequence.next();
  cancelStaging();
  $('loading').hidden = false;
  try {
    const source = await file.text();
    if (!current()) return;
    let json;try { json=JSON.parse(source); } catch {}
    if (json?.format==='midi-room.rack/1') {
      const rack=validateRack(json);for(const m of rack.modules)await verifyPlugin(m.plugin);
      if(!current())return;await mountDSPRack(rack,append,current);
    } else {
      const plugin=extractPlugin(source,file.name);
      if(plugin.engine.type==='faust-wasm/1') {
        await verifyPlugin(plugin);if(!current())return;
        await mountDSPRack({format:'midi-room.rack/1',version:1,name:plugin.name,modules:[{instanceId:'imported-one',plugin,values:{},bypass:false}]},append,current);
      } else {
        if(/\.json$/i.test(file.name))throw Error('This HTML descriptor needs its standalone HTML instrument. Open that HTML file.');
        await mountInstrument(source,file.name,append,plugin);
      }
    }
  } catch (error) {
    if (current() && error?.name !== 'AbortError') notify(error.message || 'The instrument could not be opened.');
  } finally {
    if (current()) { $('loading').hidden = true; if (!active && !staging) $('frameMount').hidden = true; }
  }
}

async function mountDSPRack(rack=null,append=true,current=()=>true) {
  const embedded=$('bundledDSPRack');let source;
  if(embedded?.textContent)source=JSON.parse(embedded.textContent);
  else {const response=await fetch('./instruments/dsp-rack.html',{credentials:'same-origin'});if(!response.ok)throw Error('DSP Rack could not open.');source=await response.text();}
  if(!current())return;
  if(rack){rack=validateRack(rack);source=source.replace(/(<script id="room-rack-state" type="application\/json">)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(rack).replace(/</g,'\\u003c')+b);}
  await mountInstrument(source,(rack?.name||'DSP Rack')+'.html',append,validatePlugin({format:'midi-room.plugin/1',id:'midi-room-dsp-rack',version:'1.0.0',name:rack?.name||'DSP Rack',role:'instrument',engine:{type:'html-sandbox/1'},midi:{mode:'web-midi',channel:null}}));
}

async function openTriton(append = false) {
  append = append === true;
  const current = loadSequence.next();
  cancelStaging();
  $('loading').hidden = false;
  try {
    const embedded = document.getElementById('bundledTriton');
    let source;
    if (embedded?.textContent) source = JSON.parse(embedded.textContent);
    else {
      const response = await fetch('./instruments/triton-rack.html', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('TRITON Rack could not open. Check your connection and try again.');
      source = await response.text();
    }
    if (!current()) return;
    await mountInstrument(source, 'TRITON Rack.html', append,builtinPlugin('triton-rack','TRITON Rack'));
  } catch (error) {
    if (current() && error?.name !== 'AbortError') notify(error.message || 'TRITON Rack could not open.');
  } finally {
    if (current()) { $('loading').hidden = true; if (!active && !staging) $('frameMount').hidden = true; }
  }
}

function autoConnect() {
  if (!supported || autoAttempted || latestState.access || latestState.status === 'requesting') return;
  autoAttempted = true;
  connectMIDI(true);
}

function cancelOutgoing(session) { bus.panicSource(session.nonce); }

function focusSession(session) {
  if (!session || session.retired) return;
  if (active && active !== session) {
    surfaceRouter.cancel(active.nonce,'focus-changed');
    post(active,{type:'surface-control',version:1,action:'release-surface'});
  }
  focusRouter.focus(session.nonce);
  active = session;
  for (const item of sessions) {
    item.frame.classList.toggle('parked', item !== session);
    item.frame.setAttribute('aria-hidden', item === session ? 'false' : 'true');
    item.frame.tabIndex = item === session ? 0 : -1;
  }
  $('instrumentName').textContent = sessionName(session);
  $('audioLight').classList.toggle('running', session.audio === 'running');
  $('audioLabel').textContent = session.audio === 'running' ? 'Audio on' : 'Tap to play';
  document.title = sessionName(session) + ' · MIDI Room';
  sendState(); renderRack();
}

function renderRackActivity() {
  for (const session of sessions) session.tab?.classList.toggle('sounding', session.audio === 'running');
}

function renderRack() {
  $('rackTabs').replaceChildren();
  for (const session of sessions) {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'rack-tab';
    tab.textContent = sessionName(session);
    tab.setAttribute('aria-pressed', session === active ? 'true' : 'false');
    tab.setAttribute('aria-label', sessionName(session) + (session === active ? ' · keyboard focus' : ' · select for keyboard'));
    tab.classList.toggle('selected', session === active);
    tab.onclick = () => { focusSession(session); post(session, {type: 'resume'}); };
    session.tab = tab; $('rackTabs').append(tab);
  }
  $('addButton').disabled = sessions.length >= MAX_INSTRUMENTS;
  $('patchButton').textContent = 'Wires' + (bus.snapshot().routes.length ? ' · ' + bus.snapshot().routes.length : '');
  renderRackActivity(); renderConnections();
}

function renderConnections() {
  for (const id of ['wireFrom','wireTo']) {
    const select = $(id), saved = select.value;
    select.replaceChildren();
    for (const session of sessions) {
      // A player should not be able to pick an end of the wire that can never work
      // and only find out after pressing Connect.
      const mute = id === 'wireFrom' ? !session.capabilities.send.length : !session.capabilities.receive.length;
      select.add(new Option(sessionName(session) + (mute ? (id === 'wireFrom' ? ' — sends nothing' : ' — receives nothing') : ''), session.nonce));
    }
    select.value = sessions.some(session => session.nonce === saved) ? saved : (id === 'wireTo' ? active?.nonce : sessions.find(session => session !== active)?.nonce) || sessions[0]?.nonce || '';
  }
  $('wireConnect').disabled = sessions.length < 2;
  $('wireEmpty').hidden = bus.snapshot().routes.length > 0;
  $('wireList').replaceChildren();
  for (const route of bus.snapshot().routes) {
    const row = document.createElement('div'); row.className = 'wire-row';
    const label = document.createElement('span'), names = document.createElement('b'), kinds = document.createElement('small');
    names.textContent = sessionName(sessions.find(s => s.nonce === route.from)) + ' → ' + sessionName(sessions.find(s => s.nonce === route.to));
    kinds.textContent = route.kinds.map(kind => ({midi:'Notes',field:'Field',transport:'Clock',signal:'VibeBus'}[kind])).join(' · ');
    label.append(names,kinds);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button'; remove.textContent = '×'; remove.setAttribute('aria-label','Disconnect ' + names.textContent);
    remove.onclick = () => { bus.removeRoute(route.id); logRoom('wire.removed'); sendState(); renderRack(); };
    row.append(label,remove); $('wireList').append(row);
  }
}

function connectWire(from = $('wireFrom').value, to = $('wireTo').value, mode = $('wireMode').value) {
  const source = sessions.find(s => s.nonce === from), target = sessions.find(s => s.nonce === to);
  if (!source || !target) return false;
  const requested = ({notes:['midi'],field:['field','transport'],vibe:['signal'],follow:busKinds})[mode] || ['midi'];
  const kinds = requested.filter(kind => source.capabilities.send.includes(kind) && target.capabilities.receive.includes(kind));
  if (!kinds.length) {
    const from = sessionName(source), to = sessionName(target);
    const sends = requested.some(kind => source.capabilities.send.includes(kind));
    const receives = requested.some(kind => target.capabilities.receive.includes(kind));
    const why = !sends && !receives ? from + ' does not send this, and ' + to + ' does not receive it.'
      : !sends ? from + ' does not send this.'
      : to + ' does not receive this.';
    const others = sessions.filter(s => s !== target && s.capabilities.send.some(kind => target.capabilities.receive.includes(kind))).map(sessionName);
    $('wireStatus').textContent = why + (others.length ? ' These can play into ' + to + ': ' + others.join(', ') + '.' : ' Add another instrument to wire this one to.');
    return false;
  }
  try {
    bus.addRoute({id:'cable-' + nonce(),from,to,kinds,signals:[...new Set([...legacySignals,...(source.signals || [])])]});
    logRoom('wire.connected',{kinds});
    $('wireStatus').textContent = 'Connected. Enable audio in each instrument, then play.';
    sendState(); renderRack(); return true;
  } catch (error) { $('wireStatus').textContent = error.message || 'This connection would create a loop or duplicate.'; return false; }
}

async function openFieldKeys() {
  const current = loadSequence.next(); cancelStaging(); $('loading').hidden = false;
  try {
    const embedded = $('bundledFieldKeys');
    let source;
    if (embedded?.textContent) source = JSON.parse(embedded.textContent);
    else { const response = await fetch('./instruments/field-keys.html', {credentials:'same-origin'}); if (!response.ok) throw new Error('Field Keys could not open.'); source = await response.text(); }
    if (!current()) return;
    await mountInstrument(source, 'Field Keys.html', true,builtinPlugin('field-keys','Field Keys','hybrid'));
  } catch (error) { if (current() && error?.name !== 'AbortError') notify(error.message || 'Field Keys could not open.'); }
  finally { if (current()) $('loading').hidden = true; }
}

function stopSound(announce = false) {
  broker.panic(); bus.panic(); for (const session of present()) surfaceRouter.cancel(session.nonce,'room-stopped'); logRoom('room.stopped');
  for (const session of present()) post(session, { type: 'panic' });
  if (announce && active) notify('Stopped. Tap an instrument to play again.');
}

function closeInstrument() {
  loadSequence.cancel(); cancelStaging(); retire(active); active = null;
  $('settings').close(); $('loading').hidden = true;
  renderRack(); sendState();
  if (sessions.length) { focusSession(sessions[sessions.length - 1]); return; }
  $('frameMount').hidden = true; $('welcome').hidden = false; $('transport').hidden = false;
  $('stopButton').disabled = true; $('instrumentName').textContent = 'No instrument';
  $('audioLabel').textContent = 'Ready'; $('audioLight').classList.remove('running');
  for (const id of ['reloadButton', 'closeInstrument', 'saveInstrument']) $(id).disabled = true;
  document.title = 'MIDI Room'; $('openMain').focus();
}

function chooseFile(append = false) { adding = append === true; $('fileInput').value = ''; $('fileInput').click(); }
$('openMain').onclick = () => chooseFile();
$('openButton').onclick = () => chooseFile();
$('fileInput').onchange = () => { const append = adding; adding = false; openFile($('fileInput').files[0], append); };
$('addButton').onclick = () => $('addDialog').showModal();
$('closeAdd').onclick = () => $('addDialog').close();
$('addLocal').onclick = () => { $('addDialog').close(); chooseFile(true); };
$('addEnsemble').onclick = () => { $('addDialog').close(); openTriton(true); };
$('addFieldKeys').onclick = () => { $('addDialog').close(); openFieldKeys(); };
$('addDSPRack').onclick = async () => { $('addDialog').close();const current=loadSequence.next();cancelStaging();try{await mountDSPRack(null,true,current);}catch(error){if(current())notify(error.message);} };
$('patchButton').onclick = () => { renderConnections(); $('connections').showModal(); };
$('closeConnections').onclick = () => $('connections').close();
$('wireConnect').onclick = () => connectWire();
$('wishButton').onclick = () => { $('settings').close(); $('wishDialog').showModal(); };
$('closeWish').onclick = () => $('wishDialog').close();
$('wishDialog').addEventListener('close', () => $('wishButton').focus({preventScroll:true}));
function roomReport() {
  const graph = bus.snapshot(), liveMIDI = broker.getState();
  return JSON.stringify({app:'MIDI Room',version:'3.2-plugins',surfaceStats:{...surfaceRouter.stats},profiles:[...surfaceRouter.sessions.values()].map(s=>s.profile.definitionId),time:new Date().toISOString(),environment:{secure:globalThis.isSecureContext === true,hardwareAPI:supported,userAgent:String(navigator.userAgent || '').slice(0,300)},midi:{status:latestState.status,permission:latestState.permission,inputs:latestState.inputs.length,selection:latestState.selection === 'auto' || latestState.selection === 'all' ? latestState.selection : 'manual',messages:(liveMIDI.activity || []).reduce((sum,input)=>sum+input.messages,0),lastInputMessages:liveMIDI.lastInput?.messages || 0},instruments:sessions.map((s,i)=>({slot:i+1,focused:s === active,audio:s.audio,plugin:s.plugin ? {version:s.plugin.version,role:s.plugin.role,engine:s.plugin.engine.type,legacy:!!s.plugin.legacy}:null,capabilities:s.capabilities,legacyVibeBus:!!s.legacyVibeBus})),wires:graph.routes.map(route=>({from:sessions.findIndex(s=>s.nonce === route.from)+1,to:sessions.findIndex(s=>s.nonce === route.to)+1,kinds:route.kinds,activeNotes:route.activeNotes})),bus:graph.stats,journal:roomJournal,scope:'Software observations only. Hearing, physical latency and phone layout are unmeasured. No instrument filenames, note data or recordings included.'},null,2);
}
$('roomCheck').onclick = () => { $('settings').close(); $('roomLogText').value = roomReport(); $('roomLogStatus').textContent = 'Local report · copy and paste it into our chat.'; $('logDialog').showModal(); };
$('closeLog').onclick = () => $('logDialog').close();
$('copyRoomLog').onclick = async () => {
  const box = $('roomLogText');
  try { await navigator.clipboard.writeText(box.value); $('roomLogStatus').textContent = 'Copied'; }
  catch { box.focus(); box.select(); try { box.setSelectionRange(0,box.value.length); } catch {} let copied = false; try { copied = document.execCommand('copy') === true; } catch {} $('roomLogStatus').textContent = copied ? 'Copied' : 'Text selected · touch and hold to copy'; }
};
bindWishWell(document);
function openWishHash() { if (globalThis.location?.hash === '#wish' && !$('wishDialog').open) $('wishDialog').showModal(); }
window.addEventListener('hashchange',openWishHash); openWishHash();
$('demoButton').onclick = openTriton;
$('midiButton').onclick = () => latestState.access ? $('settings').showModal() : connectMIDI();
$('reconnectButton').onclick = connectMIDI;
$('inputSelect').onchange = () => broker.setSelection($('inputSelect').value);
$('menuButton').onclick = () => $('settings').showModal();
$('closeSettings').onclick = () => $('settings').close();
$('closeUnsupported').onclick = $('keepTouch').onclick = () => $('unsupported').close();
$('copyAppLink').onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); $('unsupported').close(); notify('Link copied. Paste it into Chrome.'); }
  catch { $('unsupportedText').textContent = 'Use this browser’s Share or Copy link action, then open the link in Chrome.'; }
};
$('stopButton').onclick = () => stopSound(true);
$('closeInstrument').onclick = closeInstrument;
$('reloadButton').onclick = async () => {
  if (!active) return;
  const source = active.source, name = active.name;
  $('settings').close();
  await openFile(new File([source], name, { type: 'text/html' }));
};
$('saveInstrument').onclick = async () => {
  if (!active) return;
  if (saves.length >= MAX_SAVES) { notify('Save or dismiss a prepared file first.'); return; }
  const entry = { id: `instrument-${nonce()}`, blob: new Blob([active.source], { type: 'text/html' }), name: safeFilename(active.name), busy: false, session: null };
  if (totalSaveBytes + entry.blob.size > MAX_SAVE_BYTES) { notify('Save or dismiss a prepared file first.'); return; }
  saves.push(entry);
  totalSaveBytes += entry.blob.size;
  $('settings').close();
  // This action starts in a direct user gesture; native Save to Files stays available.
  await saveEntry(entry);
};

$('savePortable').onclick = async () => {
  if (saves.length >= MAX_SAVES) { notify('Save or dismiss a prepared file first.'); return; }
  const button = $('savePortable');
  button.disabled = true;
  try {
    const response = await fetch('./midi-room-local.html', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('The portable player could not be prepared.');
    const source = await response.text();
    if (!source.includes('id="bundledTriton"')) throw new Error('The portable player is unavailable at this address.');
    const entry = { id: `portable-${nonce()}`, blob: new Blob([source], { type: 'text/html' }), name: 'midi-room-local.html', busy: false, session: null };
    if (saves.length >= MAX_SAVES || totalSaveBytes + entry.blob.size > MAX_SAVE_BYTES) throw new Error('Save or dismiss a prepared file first.');
    saves.push(entry); totalSaveBytes += entry.blob.size;
    $('settings').close(); renderSaves();
  } catch (error) { notify(error.message || 'The portable player could not be prepared.'); }
  finally { button.disabled = false; }
};
if (document.body.dataset.portable === 'true') $('savePortable').hidden = true;

for (const dialog of [$('settings'), $('unsupported'), $('connections'), $('addDialog'), $('wishDialog'), $('logDialog')]) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

function draggedFiles(event) { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
window.addEventListener('dragenter', event => { if (draggedFiles(event)) { event.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; } });
window.addEventListener('dragover', event => { if (draggedFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', event => { if (draggedFiles(event)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; } });
window.addEventListener('drop', event => {
  if (!draggedFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  $('dropOverlay').hidden = true;
  if (event.dataTransfer.files.length !== 1) { notify('Open one instrument, plugin or rack at a time.'); return; }
  openFile(event.dataTransfer.files[0]);
});
let stoppedWhileHidden = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stoppedWhileHidden = present().some(session => session.audio === 'running'); stopSound(); }
  else { broker.discover(); if (stoppedWhileHidden) { stoppedWhileHidden = false; notify('Sound stopped while this tab was in the background. Tap an instrument to play again.'); } }
});
window.addEventListener('pagehide', () => { stopSound(); });



window.addEventListener('pageshow', () => broker.discover());
broker.discover(); renderRack();

// The rack is independent; cards select input without changing the sound target.
// Launch is resolved after all catalog actions are bound below.

async function openPad() {
  const current=loadSequence.next(); cancelStaging(); $('loading').hidden=false;
  try {
    const embedded=$('bundledDrumPad');
    let source;
    if (embedded?.textContent) source=JSON.parse(embedded.textContent);
    else { const response=await fetch('./instruments/drum-pad.html',{credentials:'same-origin'}); if(!response.ok) throw new Error('Drum Pad could not open.'); source=await response.text(); }
    if(current()) await mountInstrument(source,'Drum Pad.html',true,builtinPlugin('drum-pad','Drum Pad','hybrid'));
  } catch(error) { if(current() && error?.name !== 'AbortError') notify(error.message); }
  finally { if(current()) $('loading').hidden=true; }
}
$('addDrumPad').onclick=()=>{ $('addDialog').close(); openPad(); };

// Public built-ins are allowlisted. Arbitrary paths and remote URLs never become frame sources.
async function openBuiltin(id, append = false, updateAddress = true) {
  const item = BUILTINS.find(entry => entry.id === id);
  if (!item) { notify('That instrument is not in this room. Choose one from the shelf.'); return; }
  const current = loadSequence.next(); cancelStaging(); $('loading').hidden = false;
  try {
    const embedded = $(item.embedded);
    let source;
    if (embedded?.textContent) source = JSON.parse(embedded.textContent);
    else {
      const response = await fetch(new URL('./instruments/' + item.file, document.baseURI), {credentials:'same-origin'});
      if (!response.ok) throw Error(item.name + ' could not open. Check your connection and try again.');
      source = await response.text();
    }
    if (!current()) return;
    await mountInstrument(source, item.name + '.html', append === true, builtinPlugin(item.id,item.name,item.role));
    if (current() && active) {
      active.builtinId = item.id;
      if (updateAddress && location.protocol !== 'file:') {
        const url = new URL(location.href); url.searchParams.delete('plugin'); url.searchParams.set('instrument',item.id); url.hash='';
        history.replaceState(null,'',url);
      }
    }
  } catch(error) { if(current() && error?.name !== 'AbortError') notify(error.message || item.name + ' could not open.'); }
  finally { if(current()) { $('loading').hidden=true; if(!active&&!staging) $('frameMount').hidden=true; } }
}
for (const item of BUILTINS) {
  const button = document.createElement('button'); button.type='button'; button.className='instrument-card'; button.dataset.instrument=item.id;
  const mark=document.createElement('span'); mark.className='card-icon'; mark.textContent=item.mark; mark.setAttribute('aria-hidden','true');
  const copy=document.createElement('span'), name=document.createElement('b'), detail=document.createElement('small'); name.textContent=item.name; detail.textContent=item.description; copy.append(name,detail); button.append(mark,copy);
  button.onclick=()=>openBuiltin(item.id); $('instrumentCatalog').append(button);
}
for (const [button,id] of [['addEnsemble','triton-rack'],['addLuckyDreamer','lucky-dreamer'],['addImprovisator','improvisator'],['addDrumPad','drum-pad'],['addFieldKeys','field-keys'],['addDSPRack','dsp-rack']]) {
  $(button).onclick=()=>{ $('addDialog').close(); openBuiltin(id,true); };
}
$('demoButton').onclick=()=>openBuiltin('triton-rack');
function launchAddress() {
  const route=instrumentRoute(location.href);
  if (route.instrument) { if(active?.builtinId!==route.instrument.id) openBuiltin(route.instrument.id,false,false); }
  else if(route.requested) notify('Unknown instrument. Choose one from the shelf.');
  else if(document.body.dataset.defaultInstrument==='triton') openBuiltin('triton-rack',false,false);
}
window.addEventListener('hashchange',launchAddress); window.addEventListener('popstate',launchAddress);
launchAddress();

// Installation improves launch/offline access. It does not add Web MIDI to a browser.
if(document.body.dataset.portable!=='true'&&'serviceWorker' in navigator&&globalThis.isSecureContext){
  let pendingInstall=null, waitingWorker=null, updateRequested=false;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pendingInstall=event;$('installApp').hidden=false;});
  $('installApp').onclick=async()=>{if(!pendingInstall)return;await pendingInstall.prompt();pendingInstall=null;$('installApp').hidden=true;};
  $('updateApp').onclick=()=>{if(!waitingWorker)return;updateRequested=true;stopSound();waitingWorker.postMessage({type:'ACTIVATE_UPDATE'});};
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested)location.reload();});
  navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{scope:'./'}).then(registration=>{
    function waiting(worker=registration.waiting){if(worker){waitingWorker=worker;$('updateApp').hidden=false;$('offlineStatus').textContent='An update is ready. Update and reload when you finish playing.';}}
    waiting();registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)waiting(worker);});});
    navigator.serviceWorker.ready.then(()=>{if(!waitingWorker)$('offlineStatus').textContent='Built-in instruments are ready offline. Your imported files stay local.';});
  }).catch(()=>{$('offlineStatus').textContent='Offline storage is unavailable here. You can still play while connected, or save the portable room.';});
}else if(document.body.dataset.portable==='true')$('offlineStatus').textContent='This portable room already contains its instruments. Keep the HTML file to play offline.';

$('creditsBody').append($('roomCredits').content.cloneNode(true));
