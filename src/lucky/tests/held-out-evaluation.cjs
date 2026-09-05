// Frozen evaluation seeds intentionally exclude the three development seeds.
// These are descriptive musical structure measurements, not taste ratings.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const load=require('./original-engine-loader.cjs'), original=load(false),candidate=load();
const seeds=Array.from({length:24},(_,i)=>crypto.createHash('sha256').update('lucky-qualification-v2-2026-09-05:'+i).digest().readUInt32LE(0));
const report={version:'1.0.0',date:'2026-09-05',developmentSeeds:[42,731,20260905],priorEvaluation:'held-out-evaluation-initial.json: first 528-world sweep retained. 406 worlds exceeded the predeclared 0.5 gate fraction. Articulation changed to 80%; those seeds are no longer the final holdout.',heldOutSeeds:seeds,scope:'Fresh 24 seeds × 22 style families, evaluated after articulation repair; same acceptance conditions',rows:[],failures:[],limitations:['Structural outcomes do not establish artistic preference or cultural authenticity.','Fixed phrase heuristics are not a learned human performer.','The inherited rhythm/harmony vocabulary remains credited to its original source, not independently cleared here.']};
function metrics(w){const lead=w.events.filter(e=>e.ln==='lead').sort((a,b)=>a.t-b.t),intervals=lead.slice(1).map((e,i)=>Math.abs(e.note-lead[i].note));let crossed=0,overlap=0;for(const e of w.events.filter(e=>e.ln==='pad')){if(w.changes.some(ch=>ch.at*w.steps>e.t+1e-6&&ch.at*w.steps<e.t+e.dur-1e-6))crossed++;}for(let i=1;i<lead.length;i++)if(lead[i-1].t+lead[i-1].dur>lead[i].t+.08)overlap++;return {leadNotes:lead.length,maxLeap:Math.max(0,...intervals),leapOver7:intervals.filter(n=>n>7).length,meanInterval:intervals.reduce((a,b)=>a+b,0)/Math.max(1,intervals.length),leadGateFraction:lead.reduce((sum,e)=>sum+e.dur,0)/(w.bars*w.steps),leadOverlaps:overlap,padChordCrossings:crossed};}
for(const style of candidate.KSTYLE_KEYS)for(const seed of seeds){
 const a=original.buildBand(seed,{style}),b=candidate.luckyCompose(seed,{style});const before=metrics(a),after=metrics(b);const row={style,seed,before,after};report.rows.push(row);
 const lead=b.events.filter(e=>e.ln==='lead');
 if(after.maxLeap>9||after.leadOverlaps||after.padChordCrossings||after.leadNotes<20||after.leadGateFraction>.5)report.failures.push({style,seed,reason:'structure',after});
 if(lead.some(e=>e.note<62||e.note>83))report.failures.push({style,seed,reason:'register'});
 if(lead.some(e=>e.anchor&&!candidate.luckyChord(b,e.t/b.div).pcs.includes(e.note%12)))report.failures.push({style,seed,reason:'chord anchor'});
 if(JSON.stringify(b)!==JSON.stringify(candidate.luckyCompose(seed,{style})))report.failures.push({style,seed,reason:'replay'});
}
const avg=(stage,key)=>report.rows.reduce((s,r)=>s+r[stage][key],0)/report.rows.length;
report.summary={worlds:report.rows.length,failures:report.failures.length,before:{},after:{}};
for(const key of Object.keys(report.rows[0].before))for(const stage of ['before','after'])report.summary[stage][key]=avg(stage,key);
const target=path.join(__dirname,'held-out-evaluation.json');fs.writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary,null,2));console.log('Saved',target);if(report.failures.length){console.error(report.failures.slice(0,8));process.exitCode=1;}
