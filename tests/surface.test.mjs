// Author: Aldrin Payopay. Deterministic control/ownership tests, not hardware evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurfaceRouter,FocusRouter,validateProfile,defaultAssignments,validAssignment} from '../dist/surface-router.js';
const kit={version:1,definitionId:'test.kit',definitionVersion:'1',profileId:'kit-1',name:'Known kit',kind:'drums',voices:[{id:'kick',label:'Kick',note:36,channel:9,mode:'oneshot'},{id:'hat',label:'Hat',note:46,channel:9,mode:'oneshot',chokeGroup:'hats'}]};
const surface={...kit,kind:'surface',definitionId:'test.pad',voices:[]};
const pitched={...kit,kind:'pitched',voices:[],noteRange:[48,60],recommendedRoot:48};
test('bounded metadata preserves actual note numbers and leaves unsupported pads empty',()=>{
  assert.deepEqual(validateProfile(kit),kit);
  const a=defaultAssignments(kit);assert.equal(a.length,16);assert.equal(a[1].note,46);assert.equal(a[2],null);
  assert.equal(validateProfile({...kit,voices:[...kit.voices,kit.voices[0]]}),null);
  assert.equal(validateProfile({...kit,version:2}),null);
  assert.equal(validateProfile({...kit,name:'x'.repeat(17000)}),null);
  assert.equal(validateProfile({...kit,voices:[{...kit.voices[0],note:NaN}]}),null);
  assert.equal(defaultAssignments(pitched)[13],null);
  assert.equal(validAssignment(kit,{...a[0],note:35}),false);
});
function rig(){const events=[];let now=1000;const r=new SurfaceRouter({send:(to,e)=>events.push({to,...e}),now:()=>now});r.describe('pad',surface);r.describe('one',kit);r.describe('two',kit);r.bind('pad','one');return{r,events,tick:ms=>now+=ms};}
test('private identity, binding revision and captured hit own release after remap',()=>{
  const {r,events}=rig(),b=r.bindings.get('pad').id,a=defaultAssignments(kit)[0];
  assert.equal(r.hit('impostor',{bindingId:b,phase:'on',hitId:'h1',assignment:a,velocity:90}),false);
  assert.equal(r.hit('pad',{bindingId:b,phase:'on',hitId:'h1',assignment:a,velocity:90}),true);
  assert.equal(r.hit('pad',{bindingId:b,phase:'on',hitId:'h1',assignment:a,velocity:90}),false);
  assert.equal(r.hit('pad',{bindingId:b,phase:'off',hitId:'h1',assignment:{...a,note:46}}),true);
  assert.equal(events.at(-1).action,'note-off');assert.equal(events.at(-1).id,b+':h1');assert.equal(events.at(-1).to,'one');
  r.bind('pad','two');const next=r.bindings.get('pad').id;assert.notEqual(next,b);
  assert.equal(r.hit('pad',{bindingId:b,phase:'on',hitId:'h2',assignment:a,velocity:90}),false);
  assert.ok(events.some(e=>e.to==='one'&&e.action==='cancel'&&e.routeId===b));
});
test('target profile change invalidates old bindings; close cannot silently pick another instance',()=>{
  const {r,events}=rig(),old=r.bindings.get('pad').id;
  r.describe('one',{...pitched,profileId:'keys'});assert.notEqual(r.bindings.get('pad').id,old);
  r.remove('one');assert.equal(r.bindings.get('pad').target,null);
  assert.equal(events.some(e=>e.action==='binding'&&e.target==='two'),false);
});
test('an active hit stays protected after the bounded recent-history window rolls over',()=>{
  const {r,tick}=rig(),a=defaultAssignments(kit)[0],b=r.bindings.get('pad').id;
  const on=id=>r.hit('pad',{bindingId:b,phase:'on',hitId:id,assignment:a,velocity:90});
  assert.equal(on('long-held'),true);
  for(let i=0;i<2100;i++){tick(2);assert.equal(on('short-'+i),true);assert.equal(r.hit('pad',{bindingId:b,phase:'off',hitId:'short-'+i}),true);}
  assert.equal(r.sessions.get('pad').seen.has('long-held'),false);
  assert.equal(on('long-held'),false);
  assert.equal(r.hit('pad',{bindingId:b,phase:'off',hitId:'long-held'}),true);
});
test('note bursts cancel only the offending surface, and bounded release remains possible',()=>{
  const {r,events}=rig(),a=defaultAssignments(kit)[0],b=r.bindings.get('pad').id;
  for(let i=0;i<128;i++)assert.equal(r.hit('pad',{bindingId:b,phase:'on',hitId:'h'+i,assignment:a,velocity:90}),true);
  assert.equal(r.hit('pad',{bindingId:b,phase:'on',hitId:'overflow',assignment:a,velocity:90}),false);
  assert.equal(r.bindings.get('pad').hits.size,0);assert.equal(events.at(-1).to,'one');assert.equal(events.at(-1).action,'cancel');
});
test('a late note-off cannot release a same-numbered note on the newly focused surface',()=>{
  const sent=[],r=new FocusRouter((to,e)=>sent.push({to,...e})),e=data=>({inputId:'keyboard',data});
  r.focus('old');r.input(e([144,60,90]));r.release('old');r.focus('new');r.input(e([144,60,100]));
  r.input(e([128,60,0]));assert.equal(sent.length,2);
  r.input(e([128,60,0]));assert.equal(sent.length,3);assert.equal(sent[2].to,'new');
});
test('MIDI input identities and sustain ownership remain separate',()=>{
  const sent=[],r=new FocusRouter((to,e)=>sent.push({to,...e}));r.focus('a');r.input({inputId:'first',data:[176,64,127]});r.focus('b');r.input({inputId:'first',data:[176,64,0]});assert.equal(sent[1].to,'a');
  r.input({inputId:'first',data:[144,60,90]});r.focus('a');r.input({inputId:'second',data:[144,60,90]});r.input({inputId:'first',data:[128,60,0]});assert.equal(sent.at(-1).to,'b');
});
