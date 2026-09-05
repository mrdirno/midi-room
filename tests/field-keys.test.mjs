// Explicit DOM/Web Audio/MIDI doubles. These checks do not render or hear audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.env.FIELD_KEYS_HTML || new URL('../dist/instruments/field-keys.html',import.meta.url),'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n');
class Param {
  constructor(value=0){this.value=value;this.events=[];}
  setValueAtTime(value,at){assert.ok(Number.isFinite(value)&&Number.isFinite(at));this.value=value;this.events.push(['set',value,at]);}
  setTargetAtTime(value,at,constant){assert.ok(Number.isFinite(value)&&Number.isFinite(at));this.value=value;this.events.push(['target',value,at,constant]);}
  linearRampToValueAtTime(value,at){assert.ok(Number.isFinite(value)&&Number.isFinite(at));this.value=value;this.events.push(['linear',value,at]);}
  cancelScheduledValues(at){this.events.push(['cancel',at]);}
  cancelAndHoldAtTime(at){this.events.push(['hold',at]);}
}
class Node {
  constructor(type){this.kind=type;this.connections=[];for(const name of ['gain','frequency','Q','threshold','knee','ratio','attack','release'])this[name]=new Param();}
  connect(target){this.connections.push(target);return target;} disconnect(){this.connections=[];}
  start(at){this.started=at;} stop(at){this.stopped=at;}
}
class Element {
  constructor(){this.children=[];this.attrs={};this.dataset={};this.listeners=new Map();this.textContent='';this.value='';this.classList={toggle:()=>{}};}
  append(...children){this.children.push(...children);} get firstChild(){return this.children[0];}
  setAttribute(key,value){this.attrs[key]=value;} addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==fn));}
  fire(type,event={}){event.preventDefault??=()=>{};return Promise.all((this.listeners.get(type)||[]).map(fn=>fn(event)));}
  setPointerCapture(){}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness({native=false, SDK=true}={}) {
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],new Element()]));elements.get('level').value='46';
  const document=new Element();document.getElementById=id=>elements.get(id);document.createElement=()=>new Element();document.hidden=false;
  const window=new Element(), events=new Map(), contexts=[], declarations=[], audioTimes=[], rafs=new Map();let serial=0, requests=0;
  class Context extends Element {
    constructor(){super();this.state='suspended';this.currentTime=10;this.nodes=[];this.destination=new Node('destination');contexts.push(this);}
    make(kind){const node=new Node(kind);this.nodes.push(node);return node;} createGain(){return this.make('gain');}createDynamicsCompressor(){return this.make('compressor');}createBiquadFilter(){return this.make('filter');}createOscillator(){return this.make('oscillator');}
    resume(){this.state='running';return Promise.resolve();} close(){this.state='closed';return Promise.resolve();}
  }
  const access=new Element();access.inputs=new Map();
  class Port extends Element {
    constructor(id){super();this.id=id;this.state='connected';this.opens=0;this.closes=0;this.reject=false;}
    open(){this.opens++;return this.reject?Promise.reject(new Error('busy')):Promise.resolve(this);}close(){this.closes++;return Promise.resolve(this);}
    play(data){return this.fire('midimessage',{data});}
  }
  if(native) for(const id of ['virtual-empty','keyboard','wire:demo'])access.inputs.set(id,new Port(id));
  const navigator=native?{requestMIDIAccess:options=>{assert.equal(options.sysex,false);requests++;return Promise.resolve(access);}}:{};
  if(SDK) window.MidiRoom={declare:value=>declarations.push(value),on:(kind,fn)=>{events.set(kind,fn);return()=>events.delete(kind);},audioTime:(ctx,at)=>{audioTimes.push(at);return Number.isFinite(at)?ctx.currentTime+(at-100000)/1000:null;}};
  const sandbox={window,document,navigator,console,performance:{now:()=>0},queueMicrotask,setTimeout,clearTimeout,requestAnimationFrame:fn=>{const id=++serial;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id)};
  window.AudioContext=Context;vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const draw=()=>{for(const [id,fn]of[...rafs]){rafs.delete(id);fn();}};
  return {window,document,elements,events,contexts,declarations,audioTimes,access,Port,requests:()=>requests,draw,snapshot:()=>JSON.parse(JSON.stringify(window.FieldKeys.snapshot())),send:(kind,event)=>events.get(kind)?.({kind,...event}),enable:()=>elements.get('enable').fire('click'),connect:()=>elements.get('midi').fire('click'),pointer:(index,type,id=1)=>elements.get('keys').children[index].fire(type,{pointerId:id}),dispose:()=>window.fire('pagehide')};
}

test('starts silent, declares receiver capabilities and requires the audio gesture',async t=>{
  const h=harness();t.after(()=>h.dispose());assert.equal(h.contexts.length,1);assert.equal(h.contexts[0].nodes[0].gain.value,0);
  h.send('midi',{route:'song',at:100000,data:[0x90,60,100]});await h.pointer(0,'pointerdown');assert.equal(h.snapshot().voices.length,0);
  assert.deepEqual(Array.from(h.declarations[0].receive),['midi','field','transport','signal']);
  await h.enable();await h.pointer(0,'pointerdown');assert.equal(h.snapshot().voices.length,1);assert.equal(h.snapshot().enabled,true);
});

test('wire notes schedule in audio time and route cancellation silences future notes without touching other owners',async t=>{
  const h=harness();t.after(()=>h.dispose());await h.enable();
  h.send('midi',{route:'a',at:101000,data:[0x90,60,100]});h.send('midi',{route:'b',at:100000,data:[0x90,60,100]});await h.pointer(0,'pointerdown',7);
  assert.equal(h.snapshot().voices[0].start,11);assert.ok(h.audioTimes.includes(101000));
  h.send('cancel',{route:'a',at:100000});const voices=h.snapshot().voices;
  assert.ok(voices.find(voice=>voice.owner==='wire:a').releaseAt<11);
  assert.equal(voices.find(voice=>voice.owner==='wire:b').releaseAt,null);assert.equal(voices.find(voice=>voice.owner==='touch:7').releaseAt,null);
  const canceledOscillators=h.contexts[0].nodes.filter(node=>node.kind==='oscillator'&&node.started===11);assert.equal(canceledOscillators.length,2);assert.ok(canceledOscillators.every(node=>node.stopped<11));
});

test('transport stop releases only its route; tempo and key/scale updates preserve held touch pitch',async t=>{
  const h=harness();t.after(()=>h.dispose());await h.enable();await h.pointer(0,'pointerdown',1);
  h.send('midi',{route:'a',at:100000,data:[0x90,60,100]});h.send('midi',{route:'b',at:100000,data:[0x90,62,100]});
  h.send('field',{route:'a',key:2,scale:'minor'});h.send('transport',{route:'a',action:'tempo',bpm:87.5});h.draw();
  assert.equal(h.snapshot().voices.find(voice=>voice.owner==='touch:1').note,48);assert.equal(h.elements.get('keys').children[0].firstChild.textContent,'C3');
  assert.equal(h.elements.get('keyReadout').textContent,'D');assert.equal(h.elements.get('scaleReadout').textContent,'Minor');assert.equal(h.elements.get('bpmReadout').textContent,'87.5');
  await h.pointer(0,'pointerup',1);await h.pointer(0,'pointerdown',2);assert.equal(h.snapshot().voices.find(voice=>voice.owner==='touch:2').note,50);
  h.send('transport',{route:'a',action:'stop',at:100000});assert.ok(h.snapshot().voices.find(voice=>voice.owner==='wire:a').releaseAt!==null);assert.equal(h.snapshot().voices.find(voice=>voice.owner==='wire:b').releaseAt,null);
});

test('same-pitch repeated notes, sustain and release stay owned by their route',async t=>{
  const h=harness();t.after(()=>h.dispose());await h.enable();
  for(const route of ['a','a','b'])h.send('midi',{route,at:100000,data:[0x90,60,100]});
  h.send('midi',{route:'a',at:100000,data:[0xb0,64,127]});h.send('midi',{route:'a',at:100010,data:[0x80,60,0]});
  const a=h.snapshot().voices.filter(voice=>voice.owner==='wire:a');assert.deepEqual(a.map(voice=>voice.held),[false,true]);assert.ok(a.every(voice=>voice.releaseAt===null));
  h.send('midi',{route:'a',at:100020,data:[0xb0,64,0]});
  assert.ok(h.snapshot().voices[0].releaseAt!==null);assert.equal(h.snapshot().voices[1].releaseAt,null);assert.equal(h.snapshot().voices[2].releaseAt,null);
});

test('explicit MIDI connection binds all native inputs while SDK wire inputs are excluded; hotplug releases its hardware notes',async t=>{
  const h=harness({native:true});t.after(()=>h.dispose());await h.enable();await h.connect();await flush();
  assert.deepEqual(h.snapshot().midiInputs,['virtual-empty','keyboard']);assert.equal(h.requests(),1);
  await h.access.inputs.get('keyboard').play([0x90,60,100]);await h.access.inputs.get('wire:demo').play([0x90,60,100]);assert.equal(h.snapshot().voices.length,1);
  const second=new h.Port('second');h.access.inputs.set('second',second);await h.access.fire('statechange');await flush();await second.play([0x90,64,100]);assert.equal(h.snapshot().voices.length,2);
  h.access.inputs.get('keyboard').state='disconnected';await h.access.fire('statechange');assert.ok(h.snapshot().voices[0].releaseAt!==null);assert.equal(h.snapshot().voices[1].releaseAt,null);
});

test('standalone MIDI accepts all ports and a failed open can retry without duplicate delivery',async t=>{
  const h=harness({native:true,SDK:false});t.after(()=>h.dispose());h.access.inputs.get('keyboard').reject=true;await h.enable();await h.connect();await flush();
  await h.access.inputs.get('keyboard').play([0x90,60,100]);assert.equal(h.snapshot().voices.length,0);
  h.access.inputs.get('keyboard').reject=false;await h.enable();await h.connect();await flush();await h.access.inputs.get('keyboard').play([0x90,60,100]);await h.access.inputs.get('wire:demo').play([0x90,64,100]);
  assert.equal(h.snapshot().voices.length,2);assert.equal(h.access.inputs.get('keyboard').opens,2);assert.equal(h.requests(),1);
});

test('CV_SOURCE clamps brightness, malformed MIDI creates no voice, and suspension cancels all future sound',async t=>{
  const h=harness();t.after(()=>h.dispose());await h.enable();
  for(const data of [[0x90,60],[0xf0,1,2],[0x90,128,90],[0xc0,1,2]])h.send('midi',{route:'a',at:100000,data});assert.equal(h.snapshot().voices.length,0);
  h.send('signal',{route:'cv',signal:'CV_SOURCE',value:9,at:100000});assert.equal(h.snapshot().field.brightness,1);
  h.send('signal',{route:'cv',signal:'CV_SOURCE',value:'bad',at:100000});assert.equal(h.snapshot().field.brightness,1);
  h.send('midi',{route:'a',at:104000,data:[0x90,60,100]});h.contexts[0].state='suspended';await h.contexts[0].fire('statechange');assert.equal(h.snapshot().enabled,false);assert.ok(h.snapshot().voices[0].releaseAt<14);
});

test('opening room controls releases local fingers while wire and hardware ownership survive blur',async t=>{
  const h=harness({native:true});t.after(()=>h.dispose());await h.enable();await h.connect();await flush();
  await h.pointer(0,'pointerdown',4);await h.access.inputs.get('keyboard').play([0x90,64,100]);
  h.send('midi',{route:'song',at:103000,data:[0x90,67,100]});
  await h.window.fire('blur');h.draw();const voices=h.snapshot().voices;
  assert.notEqual(voices.find(voice=>voice.owner==='touch:4').releaseAt,null);
  assert.equal(voices.find(voice=>voice.owner==='wire:song').releaseAt,null);
  assert.equal(voices.find(voice=>voice.owner==='hardware:keyboard').releaseAt,null);
  assert.equal(h.elements.get('keys').children[0].attrs['aria-pressed'],'false');
});

test('artifact is self-contained with fixed readout space and sixteen touch pads',()=>{
  assert.equal(/<(?:script|link|img|iframe)\b[^>]*(?:src|href)\s*=\s*["']https?:/i.test(html),false);
  assert.match(html,/height:71px/);assert.match(html,/height:3\.5em/);assert.match(html,/index < 16/);new vm.Script(source);
});

test('enabling audio never requests hardware MIDI until its explicit control',async t=>{const h=harness({native:true});t.after(()=>h.dispose());await h.enable();assert.equal(h.requests(),0);await h.connect();assert.equal(h.requests(),1);});
