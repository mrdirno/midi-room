const test=require('node:test'),assert=require('node:assert/strict');
const x=require('./original-engine-loader.cjs')(),tables=x.buildWavetables(),sr=24000;
function run(r,seconds,startFrame=0){let peak=0,sum=0,last=0,delta=0;const n=Math.ceil(seconds*sr/128)*128;for(let frame=0;frame<n;frame+=128){const L=new Float32Array(128),R=new Float32Array(128);r.process(L,R,128,frame+startFrame);for(let i=0;i<128;i++){peak=Math.max(peak,Math.abs(L[i]),Math.abs(R[i]));sum+=L[i]*L[i]+R[i]*R[i];delta=Math.max(delta,Math.abs(L[i]-last));last=L[i];}}return {peak,rms:Math.sqrt(sum/(n*2)),maxDelta:delta,frames:n};}
test('rendered band is finite, audible and stays below output protection',()=>{
 const r=new x.LuckyRenderer(sr,tables),w=x.luckyCompose(731,{style:'bap'});r.msg({type:'load',world:w,loop:false});r.tp.eng.seekBar(2);const m=run(r,6);assert.ok(m.rms>.005&&m.rms<.5,JSON.stringify(m));assert.ok(m.peak<.985);assert.equal(r.nonFinite,0);assert.equal(r.clamped,0);
});
test('stop fades to silence and removes held notes',()=>{
 const r=new x.LuckyRenderer(sr,tables),w=x.luckyCompose(42,{style:'house'});r.msg({type:'load',world:w});run(r,.5);r.msg({type:'note',note:72,on:true});run(r,.2,12032);r.msg({type:'stop'});run(r,.3,16896);const tail=run(r,.2,24192);assert.equal(r.tp.playing,false);assert.equal(Object.keys(r.liveNotes).length,0);assert.ok(tail.peak<.0001,JSON.stringify(tail));
});
test('late callback seeks once instead of bursting overdue notes',()=>{
 const r=new x.LuckyRenderer(sr,tables),w=x.luckyCompose(731);r.msg({type:'load',world:w});const a=run(r,.2);const L=new Float32Array(128),R=new Float32Array(128);r.process(L,R,128,a.frames+sr*3);assert.equal(r.recoveries,1);assert.ok(r.tp.eng.clock>=sr*3);assert.equal(r.nonFinite,0);r.process(L,R,128,a.frames+sr*3+128);assert.equal(r.recoveries,1);
});
test('a crossfade and live-key chord remain finite with mix headroom',()=>{
 const r=new x.LuckyRenderer(sr,tables),w=x.luckyCompose(20260905,{style:'funk'});r.msg({type:'load',world:w});r.tp.eng.seekBar(10);let a=run(r,.5);r.msg({type:'swap',world:x.luckyCompose(20260905,{style:'funk',roll:{lead:{p:1,s:1}}}),follow:true});for(const note of [60,64,67,72])r.msg({type:'note',note,on:true});const b=run(r,1,a.frames);assert.ok(b.peak<.985);assert.equal(r.nonFinite,0);assert.equal(r.clamped,0);r.msg({type:'release'});assert.equal(Object.keys(r.liveNotes).length,0);
});
test('destroy is silent and ignores further play messages',()=>{
 const r=new x.LuckyRenderer(sr,tables),w=x.luckyCompose(42);r.msg({type:'load',world:w});run(r,.1);r.msg({type:'destroy'});r.msg({type:'load',world:w});assert.equal(run(r,.1).peak,0);
});
test('loop boundaries stay on the exact sample, not the next render block',()=>{
 const w=x.luckyCompose(42,{style:'knock',bpm:111});w.bars=1;w.duration=w.steps*w.secPerStep;w.events=w.events.filter(e=>e.t<w.steps).map(e=>({...e,dur:Math.min(e.dur,w.steps-e.t)}));
 const r=new x.LuckyRenderer(sr,tables);r.msg({type:'load',world:w,loop:true});const result=run(r,w.duration*3.1);const total=r.tp.eng.totalSamples();assert.equal(r.tp.eng.clock,result.frames%total);
});
test('unseen extreme metal ratios cannot poison a low-rate mix',()=>{
 for(const [style,seed] of [['drill',1073869506],['foot',2210986801]]){
  const r=new x.LuckyRenderer(sr,tables),w=x.luckyCompose(seed,{style});r.msg({type:'load',world:w});r.tp.eng.seekBar(2);const m=run(r,1);assert.equal(r.nonFinite,0);assert.equal(r.clamped,0);assert.ok(m.rms>.003);
 }
 for(const rate of [16000,24000,44100,48000,96000]){
  const m=new x.MetalVoice(rate,x.makeRng(71),tables),patch=x.getPatch('kit','drillK').hatC;patch.hz=30000;patch.ratios=[1,2,3,4,6,8];m.set(patch);assert.ok([...m.dt].every(d=>d<.49));m.trig(.7);const buf=new Float32Array(128);m.render(buf,128);assert.ok([...buf].every(Number.isFinite));
 }
});
test('fixed score replay renders the same samples in the same runtime',()=>{
 function block(){const w=x.luckyCompose(42,{style:'house'}),r=new x.LuckyRenderer(sr,tables);r.msg({type:'load',world:w});const chunks=[];for(let at=0;at<4096;at+=128){const L=new Float32Array(128),R=new Float32Array(128);r.process(L,R,128,at);chunks.push(...L,...R);}return chunks;}
 assert.deepEqual(block(),block());
});
