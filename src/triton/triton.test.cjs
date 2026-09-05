// Aldrin Payopay — actual original/candidate code, explicit browser/audio doubles.
// These assertions do not establish heard audio, browser layout or hardware MIDI.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {E,AudioContext}=require('../ensemble/audio-dom-doubles.cjs');
const project=path.resolve(__dirname,'../..');
const candidate=fs.readFileSync(path.join(project,'dist/instruments/triton-rack.html'),'utf8');
const original=fs.readFileSync(path.join(project,'src/triton/inherited-runtime.html'),'utf8');
E.prototype.querySelectorAll=function(){return [];};E.prototype.querySelector=function(){return new E();};E.prototype.focus=function(){};E.prototype.select=function(){};
const originalCreateBuffer=AudioContext.prototype.createBuffer;
AudioContext.prototype.createBuffer=function(ch,n,sr){const b=originalCreateBuffer.call(this,ch,n,sr);b.duration=n/sr;b.numberOfChannels=ch;return b;};
const results=[],observations=[];
function between(text,start,end){const a=text.indexOf(start);assert(a>=0,start);const b=text.indexOf(end,a);assert(b>a,end);return text.slice(a,b);}
function env(html){
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!m[1].includes('application/json'));
  for(const m of scripts)new vm.Script(m[2]);
  const nodes=new Map(),doc=new E('document');doc.getElementById=id=>{if(!nodes.has(id))nodes.set(id,new E('div',id));return nodes.get(id);};
  doc.querySelector=s=>s.startsWith('#')?doc.getElementById(s.slice(1)):new E();doc.querySelectorAll=()=>[];doc.createElement=t=>new E(t);doc.body=new E('body');doc.hidden=false;
  const intervals=new Map(),timeouts=new Map();let seq=0;
  const world={console:{...console,info(){}},Math,Number,Array,Map,Set,JSON,Promise,Uint8Array,Uint32Array,Float32Array,DataView,ArrayBuffer,TextEncoder,Blob,Date,document:doc,AudioContext,navigator:{},location:{protocol:'http:',hash:''},performance:{now:()=>world.now||1000},
    setInterval:(f,ms)=>{const id=++seq;intervals.set(id,{f,ms});return id;},clearInterval:id=>intervals.delete(id),setTimeout:(f,ms)=>{const id=++seq;timeouts.set(id,{f,ms,at:(world.now||0)+ms});return id;},clearTimeout:id=>timeouts.delete(id),requestAnimationFrame(){},addEventListener:(n,f)=>doc.addEventListener('window:'+n,f),removeEventListener:(n,f)=>doc.removeEventListener('window:'+n,f)};
  world.window=world;world.globalThis=world;
  const context=vm.createContext(world),run=s=>vm.runInContext(s,context);
  run(scripts[0][2]);
  run(`const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
    function updVoiceUI(){};function keyVis(){};function pulseAt(){};function flashRow(){};function render(){};function syncLeds(){};function fit(){};
    var DREAM={on:false,pans:null,seed:0,p:null,pending:null},exporting=false,DRY=false;
    var SAVE_OUT=null,VERB={pct:12};
    function quickBoot(){state.powered=true;ctx=new AC();buildGraph();cur=JSON.parse(JSON.stringify(PROGRAMS[12]));applyFXP(cur);}
    function ctxEnsure(){};function noteOn(){};function noteOff(){};
    function allNotesOff(playerOnly){if(!playerOnly)voiceList.slice().forEach(v=>v.kill&&v.kill());}
    function transportStop(){DREAM.on=false;LDR.on=false;allNotesOff();takeStop();}
    function powerOff(){transportStop();state.powered=false;}
    function startWith(){DREAM.on=true;return true;}
    function dreamStop(){DREAM.on=false;takeStop();}
    function verbSet(p){VERB.pct=p;};async function exportTake(){};
  `);
  run(between(scripts[1][2],'function clone(o)','/* ── USER BANK B:'));
  run('var USER_BANK=new Array(16).fill(null);');
  run(between(scripts[1][2],'function setUserProgram(slot)','function bankCountUI'));
  run(scripts[3][2]);
  run(between(html,'/*MIDI-BEGIN*/','/*MIDI-END*/'));
  run(scripts.find(m=>m[1].includes('improvisatorCoreDonor'))[2]);
  run(scripts.find(m=>m[1].includes('improvisatorSoulDonor'))[2]);
  let controller=scripts.find(m=>m[1].includes('soulPilotController'))[2];
  if(!html.includes('triton-runtime'))controller=controller.replace('SP.selfTest=function(){','SP.start=soulStart;SP.stop=soulStop;SP.toggle=toggle;SP.chooseCharacter=applyCharacter;SP.chooseScene=selectScene;SP.selfTest=function(){');
  run(controller);
  if(html.includes('triton-runtime'))run(scripts.find(m=>m[1].includes('triton-runtime'))[2]);
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  function advance(seconds){run('ctx.currentTime+='+seconds);world.now=(world.now||0)+seconds*1000;for(const entry of [...intervals.values()])entry.f();
    for(const [id,t] of [...timeouts])if(t.at<=world.now){timeouts.delete(id);t.f();}}
  return {world,run,intervals,timeouts,el:id=>doc.getElementById(id),flush,advance,boot:()=>run('quickBoot()')};
}
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.stack);}}
async function main(){
await test('Reproduce original patch and user-bank tempo writers; candidate rejects both',()=>{
  const row={action:'tempo 117, browse A000 then user B000 with preferred tempo 84',original:{},candidate:{}};
  for(const [name,html] of [['original',original],['candidate',candidate]]){const e=env(html);e.boot();e.run(name==='original'?'state.tempo=117':'TritonEngine.setTempo(117)');
    e.run('setProgram(0)');row[name].afterFactory=e.run('state.tempo');
    e.run('USER_BANK[0]=JSON.parse(JSON.stringify(PROGRAMS[1]));setUserProgram(0)');row[name].afterUser=e.run('state.tempo');}
  assert.equal(row.original.afterFactory,96);assert.equal(row.original.afterUser,84);assert.equal(row.candidate.afterFactory,117);assert.equal(row.candidate.afterUser,117);observations.push(row);
});
await test('Reproduce original character resetting selected tempo and performance overrides',()=>{
  const row={action:'settings BPM 117, melody .31, sustain .44; change character',original:{},candidate:{}};
  for(const [name,html] of [['original',original],['candidate',candidate]]){const e=env(html);e.run(name==='original'?'SoulPilot.settings.bpm=117':'TritonEngine.setTempo(117)');e.run('SoulPilot.settings.melody=.31;SoulPilot.settings.sustain=.44;SoulPilot.chooseCharacter(Object.keys(IMPROV.PRESETS)[1])');row[name]={bpm:e.run('SoulPilot.settings.bpm'),melody:e.run('SoulPilot.settings.melody'),sustain:e.run('SoulPilot.settings.sustain')};}
  assert.equal(row.original.bpm,132);assert.equal(row.original.melody,.02);assert.equal(row.candidate.bpm,117);assert.equal(row.candidate.melody,.31);assert.equal(row.candidate.sustain,.44);observations.push(row);
});
await test('Active SoulComposer locks 32 expressive bars at 117 and preserves event microtiming',()=>{
  const row={action:'same seed, active composer, humanize 1, requested BPM 117, 32 bars',original:{},candidate:{}};
  for(const [name,html] of [['original',original],['candidate',candidate]]){const e=env(html);e.run('var testSettings=Object.assign({},IMPROV.PRESETS.reference,{bpm:117,humanize:1});var testComposer=new IMPROV.Composer("tempo-proof",testSettings);var bars=Array.from({length:32},()=>testComposer.nextBar())');
    row[name]={minBpm:e.run('Math.min(...bars.map(b=>b.bpm))'),maxBpm:e.run('Math.max(...bars.map(b=>b.bpm))'),microEvents:e.run('bars.flatMap(b=>b.events).filter(e=>e.micro!==0).length')};}
  assert.notEqual(row.original.minBpm,row.original.maxBpm);assert.equal(row.candidate.minBpm,117);assert.equal(row.candidate.maxBpm,117);assert(row.candidate.microEvents>0);observations.push(row);
});
await test('Repeated Play owns one timer; Stop defeats a delayed resume',async()=>{
  const e=env(candidate);e.boot();const base=e.intervals.size;e.world.SoulPilot.start(false);e.world.SoulPilot.start(false);assert.equal(e.intervals.size,base+1);e.world.SoulPilot.stop(true);assert.equal(e.intervals.size,base);
  e.run('ctx.state="suspended";var resolveResume;ctx.resume=()=>new Promise(r=>resolveResume=r)');e.world.SoulPilot.toggle();e.world.SoulPilot.stop(true);e.run('ctx.state="running";resolveResume()');await e.flush();assert(!e.world.SoulPilot.on);assert.equal(e.intervals.size,base);
});
await test('Actual original duplicates its scheduler on repeated start',()=>{const e=env(original);e.boot();const base=e.intervals.size;e.world.SoulPilot.start(false);e.world.SoulPilot.start(false);assert.equal(e.intervals.size,base+2);observations.push({action:'two Soul start calls',originalTimers:2,candidateTimers:1});});
await test('Pitched future source cancellation stops oscillator and transient before onset',()=>{
  const row={action:'schedule original A016 at context time +1, then kill at time 0'};
  for(const [name,html] of [['original',original],['candidate',candidate]]){const e=env(html);e.boot();e.run('var voice=spawnVoice(PROGRAMS[16],60,.7,ctx.currentTime+1,null);var scheduled=ctx.nodes.filter(n=>n.started>=1);voice.kill()');row[name]={sources:e.run('scheduled.length'),latestStop:e.run('Math.max(...scheduled.map(n=>n.stopped))')};}
  assert(row.original.latestStop>=1);assert.equal(row.candidate.latestStop,0);observations.push(row);
});
await test('Future drums stop actual source audio, not only voice ledger',()=>{
  const row={action:'schedule standard kick +1 second, kill all voices immediately'};
  for(const [name,html] of [['original',original],['candidate',candidate]]){const e=env(html);e.boot();e.run('drumHit(36,.7,ctx.currentTime+1,"std");var scheduled=ctx.nodes.filter(n=>n.started>=1);allNotesOff()');row[name]={sources:e.run('scheduled.length'),latestStop:e.run('Math.max(...scheduled.map(n=>n.stopped))')};}
  assert(row.original.latestStop>1);assert.equal(row.candidate.latestStop,0);observations.push(row);
});
await test('Legacy physical percussion stops its generated buffer source before future onset',()=>{
  const row={action:'physical agogoL at context time +1, immediate panic'};
  for(const [name,html] of [['original',original],['candidate',candidate]]){const e=env(html);e.boot();e.run('drumHitP("agogoL",.7,1,{});var scheduled=ctx.nodes.filter(n=>n.started>=1);allNotesOff()');row[name]={sources:e.run('scheduled.length'),latestStop:e.run('Math.max(...scheduled.map(n=>n.stopped))')};}
  assert(row.original.latestStop>1);assert.equal(row.candidate.latestStop,0);observations.push(row);
});
await test('Voice ownership survives patch changes and same-pitch route cancellation',()=>{
  const e=env(candidate);e.boot();const engine=e.world.TritonEngine;
  assert(engine.noteOn({id:'held-a',routeId:'a',note:60,velocity:.5}));assert(engine.noteOn({id:'held-b',routeId:'b',note:60,velocity:.5}));
  e.run('var heldA=voiceList[0],heldB=voiceList[1]');engine.selectProgram('A001');engine.cancelRoute('a');assert(e.run('heldA.killed'));assert(!e.run('heldB.killed'));engine.noteOff({id:'held-b',routeId:'b'});assert(e.run('heldB.released'));
});
await test('Future release retains ownership so route close cancels the still-future onset',()=>{
  const e=env(candidate),engine=e.world.TritonEngine;e.boot();engine.noteOn({id:'future',routeId:'wire',note:60,velocity:.5,at:1});
  e.run('var future=voiceList[voiceList.length-1];var source=future.oscs[0].src');engine.noteOff({id:'future',routeId:'wire',at:1.5});assert(!e.run('future.killed'));engine.cancelRoute('wire');assert(e.run('future.killed'));assert.equal(e.run('source.stopped'),0);
});
await test('Initial visible Soul posture retains 132 BPM and all original performance values',()=>{
  const e=env(candidate);assert.equal(e.world.TritonEngine.transportState().bpm,132);
  const settings=e.world.SoulPilot.settings,reference=e.world.IMPROV.LOCKED_PERFORMANCE;
  for(const key of Object.keys(reference))assert.equal(settings[key],reference[key],key);
});
await test('Live source release and cancellation retain their original AudioContext after a render swap',()=>{
  const e=env(candidate);e.boot();e.run('ctx.currentTime=.2;var liveContext=ctx;var liveVoice=spawnVoice(PROGRAMS[16],60,.7,.2,null);ctx=new AC();ctx.currentTime=12;liveVoice.release();');
  assert(e.run('liveVoice.oscs.every(o=>o.src.stopped<2)'));e.run('liveVoice.kill()');assert(e.run('liveVoice.oscs.every(o=>o.src.stopped<.4)'));
});
await test('Tempo controls cannot mutate an active offline render',()=>{
  const e=env(candidate);e.run('exporting=true');assert.equal(e.world.TritonEngine.setTempo(90),false);assert.equal(e.world.TritonEngine.transportState().bpm,132);
});
await test('Actual renderNote restores live graph, pitch settings and voice ledger on success and failure',async()=>{
  const e=env(candidate);e.boot();
  const io=[...candidate.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>m[2].includes('function renderNote('))[2];
  e.run(between(io,'function velLayers(prog)','function trimTail(f)'));
  class OfflineDouble extends AudioContext{constructor(ch,n,sr){super();this.ch=ch;this.length=n;this.sampleRate=sr;}startRendering(){return this.fail?Promise.reject(new Error('render rejected')):Promise.resolve(this.createBuffer(this.ch,this.length,this.sampleRate));}}
  e.world.OfflineAudioContext=OfflineDouble;
  e.run('state.transpose=3;state.tune=12;var liveContext=ctx;var liveBus=progBus;var liveLedger=voiceList;exporting=true;');
  const beforeTimers=e.timeouts.size;
  await e.run('renderNote(PROGRAMS[16],60,.6,{hold:.25,total:.6,loop:false})');
  assert.equal(e.timeouts.size,beforeTimers,'offline source lifetimes must not add wall-clock timers');
  assert(e.run('ctx===liveContext&&progBus===liveBus&&voiceList===liveLedger&&state.transpose===3&&state.tune===12'));
  OfflineDouble.prototype.fail=true;
  await assert.rejects(e.run('renderNote(PROGRAMS[15],36,.6,{hold:null,total:.6,loop:false})'),/render rejected/);
  assert(e.run('ctx===liveContext&&progBus===liveBus&&voiceList===liveLedger&&state.transpose===3&&state.tune===12'));
});
await test('Metadata distinguishes pitched voices and nine verified standard kit roles',()=>{
  const e=env(candidate),engine=e.world.TritonEngine;e.boot();assert.equal(engine.metadata().kind,'pitched');engine.selectProgram('A015');const p=engine.metadata();
  assert.equal(p.kind,'drums');assert.deepEqual(Array.from(p.voices,v=>v.note),[36,38,39,41,42,43,45,46,47]);assert(p.voices.every(v=>v.channel===9&&v.mode==='oneshot'));
  for(const v of p.voices)for(const velocity of [.1,.5,1])assert(engine.noteOn({id:'pad-'+v.note+'-'+velocity,routeId:'pad',note:v.note,velocity}));assert(e.run('ctx.nodes.some(n=>n.started===0)'));
});
await test('Hat choke cancels its future group, preserves independent route, and oneshot release leaves decay',()=>{
  const e=env(candidate),engine=e.world.TritonEngine;e.boot();engine.selectProgram('A015');
  engine.noteOn({id:'open',routeId:'pad',note:46,velocity:.5,at:1});e.run('var openHat=voiceList[voiceList.length-1]');
  engine.noteOn({id:'other',routeId:'wire',note:46,velocity:.5,at:1});e.run('var otherHat=voiceList[voiceList.length-1]');
  engine.noteOn({id:'closed',routeId:'pad',note:42,velocity:.5,at:.5});e.run('var closedHat=voiceList[voiceList.length-1]');assert(e.run('openHat.killed'));assert(!e.run('otherHat.killed'));engine.noteOff({id:'closed',routeId:'pad'});assert(!e.run('closedHat.killed'));
});
await test('Foreign tempo rejected; patch and MIDI selection cannot change authority',()=>{
  const e=env(candidate),engine=e.world.TritonEngine;e.boot();engine.setTempo(143);assert.equal(engine.setTempo(75,{owner:'foreign'}),false);engine.selectProgram('A013');engine.midi([144,60,80]);assert.equal(engine.transportState().bpm,143);assert.equal(engine.transportState().owner,'local');assert.equal(e.run('state.arp.on'),false);
});
await test('Soul retime cancels its queued generation while a manual route survives',()=>{
  const e=env(candidate),engine=e.world.TritonEngine;e.boot();e.world.SoulPilot.start(false);engine.noteOn({id:'manual',routeId:'wire',note:64,velocity:.4});e.run('var manual=voiceList[voiceList.length-1];var oldSoul=voiceList.filter(v=>v._conductor==="soul");var oldGeneration=SoulPilot.generation');
  engine.setTempo(120);assert(e.run('SoulPilot.generation>oldGeneration'));assert(e.run('oldSoul.every(v=>v.killed)'));assert(!e.run('manual.killed'));assert.equal(e.world.SoulPilot.settings.bpm,120);
});
await test('All connected MIDI sources receive; stale disconnected port callbacks do not',async()=>{
  const e=env(candidate),engine=e.world.TritonEngine;e.boot();let requests=0;
  const idle={id:'idle',state:'connected',open:()=>Promise.resolve()},keyboard={id:'keys',state:'connected',open:()=>Promise.resolve()};const access={inputs:new Map([['idle',idle],['keys',keyboard]])};e.world.navigator.requestMIDIAccess=async()=>{requests++;return access;};
  assert.equal(requests,0);await engine.connectMidi();assert.equal(requests,1);keyboard.onmidimessage({data:[144,60,90]});assert.equal(engine.report().ownedVoices,1);const old=keyboard.onmidimessage;keyboard.state='disconnected';await access.onstatechange();assert.equal(engine.report().ownedVoices,0);old({data:[144,60,90]});assert.equal(engine.report().ownedVoices,0);
});
await test('MIDI sustain and same note are isolated by input and channel',()=>{
  const e=env(candidate),engine=e.world.TritonEngine;e.boot();engine.midi([144,60,90],'one');engine.midi([144,60,90],'two');engine.midi([176,64,127],'one');engine.midi([128,60,0],'one');assert.equal(engine.report().ownedVoices,2);engine.midi([128,60,0],'two');assert.equal(engine.report().ownedVoices,1);engine.midi([176,64,0],'one');assert.equal(engine.report().ownedVoices,0);
});
const proof={testedAt:new Date().toISOString(),artifactSha256:crypto.createHash('sha256').update(candidate).digest('hex'),method:'Node VM execution of original and candidate implementation with explicit DOM, AudioContext and timer doubles',tests:results,observations,pass:results.every(r=>r.pass),notRun:['Physical MIDI controller','Listening/audio output','Actual browser layout','Phone/Spck','Real offline export waveform']};
fs.writeFileSync(path.join(project,'verification/triton-regressions.json'),JSON.stringify(proof,null,2)+'\n');console.log(results.filter(r=>r.pass).length+'/'+results.length+' passed');if(!proof.pass)process.exitCode=1;
}
main();
