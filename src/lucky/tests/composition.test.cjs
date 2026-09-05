// Author: Aldrin Payopay. Structural acceptance; not a listening-quality score.
const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./original-engine-loader.cjs'), x=load();
const json=v=>JSON.stringify(v), lane=(w,l)=>w.events.filter(e=>e.ln===l);
test('replay is deterministic; tempo keeps lead notes and arrangement intact',()=>{
 for(const seed of [42,731,20260905]){
  const a=x.luckyCompose(seed),b=x.luckyCompose(seed);assert.equal(json(a),json(b));
  // Inherited drum microtiming is specified in milliseconds, so its step
  // offsets correctly differ with BPM. Do not demand byte identity there.
  const slow=x.luckyCompose(seed,{bpm:60}),fast=x.luckyCompose(seed,{bpm:200});assert.ok(json(lane(slow,'lead'))===json(lane(fast,'lead')));assert.equal(slow.bars,fast.bars);
 }
});
test('melody pattern and sound variants are independent of every drum lane',()=>{
 for(const style of x.KSTYLE_KEYS){
  const a=x.luckyCompose(731,{style}),p=x.luckyCompose(731,{style,roll:{lead:{p:1,s:0}}}),s=x.luckyCompose(731,{style,roll:{lead:{p:0,s:1}}});
  for(const l of ['kick','snare','hat','perc','aux','sub']){assert.equal(json(lane(a,l)),json(lane(p,l)));assert.equal(json(lane(a,l)),json(lane(s,l)));}
  assert.equal(json(lane(a,'lead')),json(lane(s,'lead')));
  assert.notEqual(json(lane(a,'lead')),json(lane(p,'lead')));
 }
});
test('all style lanes stay bounded, notes have room, and anchor tones match the sounding chord',()=>{
 for(const style of x.KSTYLE_KEYS)for(const seed of [42,731,20260905]){
  const w=x.luckyCompose(seed,{style});let at=-Infinity;
  for(const e of w.events){assert.ok(Number.isFinite(e.t)&&Number.isFinite(e.dur)&&Number.isFinite(e.vel));assert.ok(e.t>=at);at=e.t;assert.ok(e.t>=0&&e.dur>0&&e.t+e.dur<=w.bars*w.steps+1e-7);assert.ok(e.vel>0&&e.vel<=1);}
  const lead=lane(w,'lead');assert.ok(lead.length>20&&lead.length<140);
  for(let i=0;i<lead.length;i++){
   const e=lead[i];assert.ok(e.note>=62&&e.note<=83);if(i){assert.ok(Math.abs(e.note-lead[i-1].note)<=9);assert.ok(e.t>=lead[i-1].t+lead[i-1].dur-1e-7);}
   if(e.anchor)assert.ok(x.luckyChord(w,e.t/w.div).pcs.includes(e.note%12),`${style} ${seed} anchor ${e.note} at ${e.t}`);
  }
  for(const phrase of w.phrases){const notes=lead.filter(e=>e.phrase===phrase.id);if(!notes.length)continue;const last=notes.at(-1);assert.ok((phrase.bar+phrase.bars)*w.steps-last.t-last.dur>=w.div*0.7,`${style} phrase breath`);}
  for(const e of lane(w,'pad')){assert.ok(e.note>=55&&e.note<=79);const boundary=w.changes.find(c=>c.at*w.steps>e.t+1e-6);if(boundary)assert.ok(e.t+e.dur<=boundary.at*w.steps+1e-6);}
  for(const e of lane(w,'keys'))assert.ok(e.note>=52&&e.note<=79,`${style} keys ${e.note}`);
 }
});
test('breakdown breath is written into lead and pad, not just a UI name',()=>{
 const w=x.luckyCompose(20260905);const low=w.sections.find(s=>s.name==='low');assert.ok(low);
 for(const l of ['lead','pad'])assert.equal(lane(w,l).filter(e=>e.t>=low.startBar*w.steps&&e.t<(low.startBar+low.bars)*w.steps).length,0);
});
test('shell voicing takes previous voices into account without changing pitch classes',()=>{
 const pcs=[0,4,7,11],a=x.voiceCell(pcs,'shell',52,79,[52,55,59],()=>.5),b=x.voiceCell(pcs,'shell',52,79,[67,71,76],()=>.5);
 assert.notEqual(json(a),json(b));for(const notes of [a,b])for(const n of notes)assert.ok(pcs.slice(1).includes(n%12));
});
test('mix controls filter lanes without mutating the seed score',()=>{
 const w=x.luckyCompose(42),before=json(w),muted=x.luckyScoreFor(w,{mute:{lead:true}}),solo=x.luckyScoreFor(w,{solo:'lead'});assert.equal(lane(muted,'lead').length,0);assert.ok(solo.events.every(e=>e.ln==='lead'));assert.equal(json(w),before);
});
test('successive melody/Air variants change patterns; key movement changes static harmony too',()=>{
 for(const style of x.KSTYLE_KEYS){
  let prev=x.luckyCompose(42,{style});
  for(const laneName of ['lead','pad'])for(let p=1;p<=3;p++){
   const a=x.luckyCompose(42,{style,roll:{[laneName]:{p:p-1,s:0}}}),b=x.luckyCompose(42,{style,roll:{[laneName]:{p,s:0}}});assert.notEqual(json(lane(a,laneName)),json(lane(b,laneName)));
  }
  const moved=x.luckyCompose(42,{style,roll:{harm:{p:1,s:0}}});assert.notEqual(prev.tonic,moved.tonic);assert.notEqual(json(lane(prev,'lead')),json(lane(moved,'lead')));
  const silent=x.luckyScoreFor(prev,{volume:{hat:0,kick:0}});assert.equal(lane(silent,'hat').length,0);assert.equal(lane(silent,'kick').length,0);
 }
});
test('MIDI is a valid type-1 score with balanced note-ons and note-offs',()=>{
 const w=x.luckyCompose(42),bytes=Buffer.from(x.encodeMidi(w));assert.equal(bytes.toString('ascii',0,4),'MThd');assert.equal(bytes.readUInt16BE(8),1);const tracks=bytes.readUInt16BE(10);assert.ok(tracks>3);
 let offset=14,totalOn=0,totalOff=0;
 for(let t=0;t<tracks;t++){
  assert.equal(bytes.toString('ascii',offset,offset+4),'MTrk');const end=offset+8+bytes.readUInt32BE(offset+4);offset+=8;const active=new Map();
  function vlq(){let n=0,v;do{v=bytes[offset++];n=(n<<7)|(v&127);}while(v&128);return n;}
  while(offset<end){vlq();const status=bytes[offset++];if(status===255){offset++;const n=vlq();offset+=n;continue;}const hi=status&240,note=bytes[offset++];if(hi===192||hi===208)continue;const velocity=bytes[offset++];if(hi===144&&velocity){totalOn++;const k=`${status&15}:${note}`;active.set(k,(active.get(k)||0)+1);}else if(hi===128||(hi===144&&!velocity)){totalOff++;const k=`${status&15}:${note}`;assert.ok(active.get(k)>0,'unmatched off');active.set(k,active.get(k)-1);}}
  assert.ok([...active.values()].every(n=>n===0));assert.equal(offset,end);
 }
 assert.equal(offset,bytes.length);assert.equal(totalOn,totalOff);assert.ok(totalOn>100);
});
