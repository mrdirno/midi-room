// Render real synthesizer samples, not a mock AudioContext or a score proxy.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const load=require('./original-engine-loader.cjs'),x=load(),baseline=load(false);
const out=path.join(__dirname,'audio-evidence');fs.mkdirSync(out,{recursive:true});
const tables=x.buildWavetables(),baseTables=baseline.buildWavetables();
const report={date:'2026-09-05',scope:'Fresh final 22 held-out seeds/styles, 6 seconds each from bar 3 at 24 kHz; separate 16-second audition excerpts at 44.1 kHz',priorEvaluation:'render-report-initial.json retained two failures from extreme metal ratios; those seeds are now explicit regressions in audio.test.cjs.',sourceHashes:Object.fromEntries(['composition.js','audio-runtime.js','engine.original.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',f))).digest('hex')])),results:[],auditions:[],failures:[],listeningStatus:'Rendered files are available for audition. This agent cannot receive audio input, so no subjective listening preference has been verified. Measurements below are sample/render checks only.'};
function metrics(L,R){let peak=0,sum=0,dc=0,maxDelta=0,zeros=0;for(let i=0;i<L.length;i++){peak=Math.max(peak,Math.abs(L[i]),Math.abs(R[i]));sum+=L[i]*L[i]+R[i]*R[i];dc+=L[i]+R[i];if(i)maxDelta=Math.max(maxDelta,Math.abs(L[i]-L[i-1]),Math.abs(R[i]-R[i-1]));if(L[i]===0&&R[i]===0)zeros++;}return {peak,rms:Math.sqrt(sum/(2*L.length)),dc:dc/(2*L.length),maxDelta,silentFrames:zeros,totalFrames:L.length};}
function render(world,sr,seconds,old=false){
 const frames=Math.ceil(seconds*sr),L=new Float32Array(frames),R=new Float32Array(frames);
 if(old){
  const e=new baseline.Engine(sr,{tables:baseTables,seed:world.seed});e.adapt=function(){};e.load(world);e.loop=false;e.seekBar(2);
  for(let at=0;at<frames;at+=128){const n=Math.min(128,frames-at),a=new Float32Array(n),b=new Float32Array(n);e.render(a,b,n);for(let i=0;i<n;i++){L[at+i]=a[i]*.70;R[at+i]=b[i]*.70;}}
  return {L,R,stats:{baseline:true}};
 }
 const renderer=new x.LuckyRenderer(sr,tables);renderer.msg({type:'load',world,loop:false});renderer.tp.eng.seekBar(2);
 for(let at=0;at<frames;at+=128){const n=Math.min(128,frames-at);renderer.process(L.subarray(at,at+n),R.subarray(at,at+n),n,at);}
 return {L,R,stats:renderer.stats()};
}
for(const style of x.KSTYLE_KEYS){
 const seed=crypto.createHash('sha256').update('lucky-audio-final-holdout:'+style).digest().readUInt32LE(0),world=x.luckyCompose(seed,{style}),start=performance.now();
 const r=render(world,24000,6),m=metrics(r.L,r.R),entry={style,seed,bpm:world.bpm,sampleRate:24000,...m,renderer:r.stats,wallSeconds:(performance.now()-start)/1000};report.results.push(entry);
 if(m.rms<.003||m.peak>=.985||r.stats.nonFinite||r.stats.clamped)report.failures.push(entry);
 console.log(style,JSON.stringify({rms:m.rms,peak:m.peak,nonFinite:r.stats.nonFinite,clamped:r.stats.clamped,seconds:entry.wallSeconds}));
 fs.writeFileSync(path.join(out,'render-report.json'),JSON.stringify(report,null,2));
}
for(const [style,seed] of [['knock',20260905],['bap',731],['house',42],['bembe',731]]){
 for(const old of (['knock','bap'].includes(style)?[true,false]:[false])){
  const w=old?baseline.buildBand(seed,{style}):x.luckyCompose(seed,{style});const r=render(w,44100,16,old),name=`${style}-${seed}-${old?'original':'candidate'}.wav`;
  const bytes=x.encodeWav(r.L,r.R,44100,x.makeRng(seed));fs.writeFileSync(path.join(out,name),Buffer.from(bytes));report.auditions.push({file:name,style,seed,version:old?'original':'candidate',sampleRate:44100,seconds:16,startsAtBar:3,...metrics(r.L,r.R)});console.log('Audition',name);
 }
}
report.summary={renders:report.results.length,failures:report.failures.length,peakMax:Math.max(...report.results.map(r=>r.peak)),rmsMin:Math.min(...report.results.map(r=>r.rms)),nonFinite:report.results.reduce((s,r)=>s+r.renderer.nonFinite,0),outputClamped:report.results.reduce((s,r)=>s+r.renderer.clamped,0)};
fs.writeFileSync(path.join(out,'render-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));if(report.failures.length)process.exitCode=1;
