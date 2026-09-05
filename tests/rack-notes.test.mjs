// Author: Aldrin Payopay. Ownership tests independent of Web Audio rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import {RackNotes,rackPlayingRange} from '../src/rack/engine.js';
import {validateProfile,defaultAssignments} from '../dist/surface-router.js';
test('latest held note falls back after release',()=>{const n=new RackNotes();n.on('a','x',60);n.on('b','x',64);assert.equal(n.latest().note,64);n.off('b');assert.equal(n.latest().note,60);n.off('a');assert.equal(n.latest(),null);});
test('repeated note releases use FIFO without deleting newer owner',()=>{const n=new RackNotes();n.midi([144,60,50],'a');n.midi([144,60,90],'a');n.midi([128,60,0],'a');assert.equal(n.held.size,1);assert.equal(n.latest().velocity,90);});
test('zero velocity note on is a release',()=>{const n=new RackNotes();n.midi([144,60,90]);n.midi([144,60,0]);assert.equal(n.held.size,0);});
test('sustain remains scoped to original source and channel',()=>{const n=new RackNotes();n.midi([144,60,90],'a');n.midi([145,64,90],'a');n.midi([144,67,90],'b');n.midi([176,64,127],'a');n.midi([128,60,0],'a');n.midi([129,64,0],'a');n.midi([128,67,0],'b');assert.equal(n.held.size,1);n.midi([176,64,0],'a');assert.equal(n.held.size,0);});
test('route cancel releases only its notes and pedals',()=>{const n=new RackNotes();n.on('a','route-a',60);n.on('b','route-b',64);n.cancel('route-a');assert.equal(n.held.size,1);assert.equal(n.latest().note,64);});
test('CC120 stops only original channel and device',()=>{const n=new RackNotes();n.midi([144,60,90],'a');n.midi([145,62,90],'a');n.midi([144,64,90],'b');n.midi([176,120,0],'a');assert.equal(n.held.size,2);assert.equal(n.latest(1).note,62);});
test('duplicates and malformed notes cannot create voice ownership',()=>{const n=new RackNotes();assert.equal(n.on('a','route',60),true);assert.equal(n.on('a','route',61),false);for(const d of [[144,255,30],[144,60,255],[144,60],[144,60,NaN]])n.midi(d);assert.equal(n.held.size,1);});
test('held note budget fails closed',()=>{const n=new RackNotes();for(let i=0;i<128;i++)n.on('n'+i,'x',60);assert.equal(n.held.size,128);assert.equal(n.on('over','x',60),false);assert.equal(n.held.size,0);});
test('surface defaults honor declared fixed MIDI channel',()=>{const p=validateProfile({version:1,definitionId:'fixed',definitionVersion:'1',profileId:'fixed',name:'Fixed',kind:'pitched',voices:[],noteRange:[36,90],recommendedRoot:60,recommendedChannel:9});assert.ok(p);assert.ok(defaultAssignments(p).every(a=>a.channel===9));assert.equal(validateProfile({...p,recommendedChannel:16}),null);});
const mapped=(min,max,channel=null)=>({plugin:{midi:{mode:'mono',channel,frequency:'/hz'},controls:[{id:'/hz',min,max}]}});
test('bass-only range moves touch root into playable notes',()=>{const r=rackPlayingRange({modules:[mapped(30,110)]});assert.equal(r.available,true);assert.ok(r.root<60);assert.ok(440*2**((r.root-69)/12)>=30);assert.ok(r.root+15<=r.high);});
test('disjoint MIDI channels do not erase each other’s touch ranges',()=>{const rack={modules:[mapped(30,110,9),mapped(440,1800,1)]};const bass=rackPlayingRange(rack);assert.equal(bass.channel,9);assert.equal(bass.available,true);const lead=rackPlayingRange(rack,1);assert.ok(lead.root>=69);assert.equal(lead.available,true);});
test('too-narrow and unmapped ranges are explicit',()=>{const r=rackPlayingRange({modules:[mapped(220,230)]});assert.equal(r.root,57);assert.equal(r.high,57);assert.equal(rackPlayingRange({modules:[]}).available,false);});
