/* Author: Aldrin Payopay. Cloud edition host, replay and resource adapters.
   Inserted inside the preserved app closure; engine and artwork stay pinned. */
var C={destroyed:false,intent:0,urls:new Set(),timers:new Set(),listeners:[],exportJob:null,observer:null,focus:null,lateRecoveries:0,history:[],historyMode:'persistent'};
S.soundBank=LuckyCloudSoundBank.normalize({version:'1.0.0',palette:'full',lanes:{}});
LANE_ORDER.push('bass');MELODIC.bass=1;LANE_LABEL.bass='bass';LANE_COLOR.bass='#80b5df';
function escT(v){var el=document.createElement('span');el.textContent=String(v==null?'':v);return el.innerHTML;}
var originalLaneVoiceLabel=laneVoiceLabel;
laneVoiceLabel=function(l){return S.world&&S.world.soundBank&&S.world.soundBank.lanes[l]?S.world.soundBank.lanes[l].label:originalLaneVoiceLabel(l);};
function cloudOn(target,type,fn,opts){target.addEventListener(type,fn,opts);C.listeners.push(function(){target.removeEventListener(type,fn,opts);});}
function later(fn,ms){var id=setTimeout(function(){C.timers.delete(id);if(!C.destroyed)fn();},ms);C.timers.add(id);return id;}
/* ── AUDITION — the sound controls make a sound ──────────────────────────
   Every control that changes how a lane SOUNDS reached the engine through
   the same line: `if (S.playing) sendSwap(...)`. The SOUND die on the row,
   the palette, the per-lane instrument. With the transport stopped all
   three changed the state, changed the label and fired a toast, and
   produced no audio whatsoever. From outside the page that is exactly
   "clicking sound didn't change the sound", which is the wish that asked
   for this.
   The engine already knew how to play a score once and stop — Transport.msg
   forwards m.loop to handover, and the WAV export sets eng.loop=false — the
   UI had simply never asked for it. So a sound change while stopped now
   plays that lane's own four bars once. It does NOT set S.playing: turning
   a knob is not a reason to take the transport, and PLAY must still read as
   stopped when the four bars are out. */
var audT=null,audGen=0;
function auditionStop(){if(audT!==null){clearTimeout(audT);C.timers.delete(audT);audT=null;}++audGen;}
/* The palette is not a lane, so a palette change has to pick one to speak
   for it. Take the first melodic lane this beat actually has and that is not
   muted — keys, then lead, pad, bass — because a palette that changed nothing
   audible is the bug this whole block exists to fix. */
function firstAudible(){
 var order=['keys','lead','pad','bass'],w=S.world;
 for(var i=0;i<order.length;i++){var l=order[i];
  if(w&&w.laneParts[l]!==undefined&&!S.mute[l])return l;}
 return null;
}
function audition(lane){
 if(!lane)return false;
 if(C.destroyed||S.playing||S.mute[lane])return false;
 var solo=soloScore(lane);
 if(!solo)return false;
 auditionStop();
 var gen=audGen;
 ensureAudio().then(function(ctx){
  if(C.destroyed||gen!==audGen||S.playing||!S.send)return;
  if(ctx.state==='suspended')ctx.resume();
  S.send({type:'load',world:solo,loop:false});
  /* loop:false runs the events out but leaves the engine rendering silence:
     it posts 'stopped' only when something asks it to fade. So ask — after
     the last note AND its tail. The tail budget is the export's own
     (1.2 + 5*space seconds, renderOffline) plus two, because the export's
     figure alone is not enough: measured over 40 seeds, the loudest tail
     still runs 3.84s past the final note, and 3 of the first 8 seeds were
     still above -60 dBFS when the export's budget expired. Stopping is a
     100ms fade, so anything under that floor is inaudible; overshooting
     costs a second of silence and nothing else. */
  audT=later(function(){
   audT=null;
   if(gen===audGen&&!S.playing&&!S.solo&&S.send)S.send({type:'stop'});
  },(solo.duration+1.2+5*((solo.climate&&solo.climate.space)||0)+2)*1000);
 }).catch(function(){});
 return true;
}
function cloudURL(blob){var u=URL.createObjectURL(blob);C.urls.add(u);return u;}
function revoke(u){if(!u)return;try{URL.revokeObjectURL(u);}catch(_){}C.urls.delete(u);}
function bounded(p,ms,label){return new Promise(function(resolve,reject){var done=false,id=setTimeout(function(){if(!done){done=true;reject(new Error(label+' timed out'));}},ms);p.then(function(v){if(!done){done=true;clearTimeout(id);resolve(v);}},function(e){if(!done){done=true;clearTimeout(id);reject(e);}});});}
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);}
function safeTree(v,depth,budget){if(--budget.n<0||depth>12)throw Error('Session is too large');if(v===null||typeof v==='boolean')return;if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)throw Error('Invalid session number');return;}if(typeof v==='string'){if(v.length>12000)throw Error('Invalid session text');return;}if(Array.isArray(v)){if(v.length>16000)throw Error('Session array is too large');v.forEach(function(x){safeTree(x,depth+1,budget);});return;}if(!plain(v))throw Error('Invalid session object');Object.keys(v).forEach(function(k){if(['__proto__','prototype','constructor'].indexOf(k)>=0)throw Error('Invalid session key');safeTree(v[k],depth+1,budget);});}
function normalizeRecord(o){
 if(!plain(o))throw Error('Invalid session');safeTree(o,0,{n:60000});
 if(!Number.isInteger(o.seed)||o.seed<0||o.seed>4294967295)throw Error('Invalid seed');
 if(o.style!==null&&o.style!==undefined&&!Object.prototype.hasOwnProperty.call(KSTYLES,o.style))throw Error('Invalid style');
 var r={seed:o.seed,style:o.style||null,roll:{},locks:{},mute:{},frame:null,tempo:null,vol:{},soundBank:LuckyCloudSoundBank.normalize(o.soundBank||{version:'1.0.0',palette:'full',lanes:{}}),addr:'',at:0};
 if(o.tempo!=null){if(!Number.isInteger(o.tempo)||o.tempo<40||o.tempo>220)throw Error('Invalid tempo');r.tempo=o.tempo;}
 if(o.roll!=null){if(!plain(o.roll))throw Error('Invalid rolls');Object.keys(o.roll).forEach(function(l){if(LANE_ORDER.concat('harm').indexOf(l)<0)throw Error('Unknown lane');var x=o.roll[l];if(!plain(x)||!Number.isInteger(x.p)||!Number.isInteger(x.s)||x.p<0||x.s<0||x.p>1000000||x.s>1000000)throw Error('Invalid lane roll');r.roll[l]={p:x.p,s:x.s};});}
 ['mute','vol','locks'].forEach(function(type){if(o[type]!=null&&!plain(o[type]))throw Error('Invalid lane state');Object.keys(o[type]||{}).forEach(function(l){if(LANE_ORDER.indexOf(l)<0)throw Error('Unknown lane');var v=o[type][l];if(type==='mute'){if(v===true||v===1)r.mute[l]=1;else if(v!==false&&v!==0)throw Error('Invalid mute');}else if(type==='vol'){if(!Number.isInteger(v)||v<0||v>KVOL_MAX)throw Error('Invalid volume');r.vol[l]=v;}else r.locks[l]=LuckyCloudSoundBank.validateCapture(v,l);});});
 if(o.frame!=null){if(!plain(o.frame)||!Object.prototype.hasOwnProperty.call(KSTYLES,o.frame.style)||!Number.isFinite(o.frame.bpm)||o.frame.bpm<40||o.frame.bpm>220||!Number.isFinite(o.frame.tonic)||o.frame.tonic<0||o.frame.tonic>127)throw Error('Invalid locked frame');r.frame={style:o.frame.style,bpm:o.frame.bpm,tonic:o.frame.tonic};}
 if(hasAny(r.locks)&&!r.frame)throw Error('Locked lanes need their frame');
 if(typeof o.addr==='string'&&o.addr.length<=12000)r.addr=o.addr;
 if(Number.isFinite(o.at)&&o.at>=0&&o.at<=Date.now()+86400000)r.at=o.at;
 return r;
}
function sessionRecord(){return normalizeRecord({seed:S.seed>>>0,style:S.style,roll:S.roll,locks:S.locks,mute:S.mute,frame:S.frame,tempo:S.tempo,vol:S.vol,soundBank:S.soundBank,addr:S.wrote.replace(/^#/,''),at:Date.now()});}
function validHistory(list){if(!Array.isArray(list)||list.length>100)return[];return list.map(function(x){try{return normalizeRecord(x);}catch(_){return null;}}).filter(Boolean);}
function readHistory(){if(C.destroyed)return[];if(C.historyMode==='session')return validHistory(C.history);try{var raw=localStorage.getItem(HKEY);if(!raw||raw.length>3000000){C.history=[];return[];}C.history=validHistory(JSON.parse(raw));return C.history;}catch(_){C.historyMode='session';return validHistory(C.history);}}
function clearSessionHistory(){C.history=[];try{localStorage.removeItem(HKEY);}catch(_){C.historyMode='session';}}
var originalOpenHistory=openHistory;
openHistory=function(){originalOpenHistory();var note=document.createElement('p');note.className='history-scope';note.textContent=C.historyMode==='session'?'These sessions are kept in memory while this instrument is open. Closing or reloading it clears them.':'Sessions stay in this browser only. Clearing browser data removes them.';$('sheetBody').querySelector('h2').after(note);};
function restoreRecord(o){try{var r=normalizeRecord(o);Object.assign(S,{seed:r.seed,style:r.style,roll:r.roll,locks:r.locks,mute:r.mute,frame:r.frame,tempo:r.tempo,vol:r.vol,soundBank:r.soundBank});return true;}catch(_){toast('That session could not be opened.');return false;}}
function saveSession(){if(C.destroyed||!S.world)return;try{var rec=sessionRecord(),h=readHistory().filter(function(x){return x.addr!==rec.addr;});h.unshift(rec);h=h.slice(0,100);while(JSON.stringify(h).length>2800000&&h.length>1)h.pop();var value=JSON.stringify(h);if(value.length>2800000)return;C.history=h;if(C.historyMode!=='session')try{localStorage.setItem(HKEY,value);}catch(_){C.historyMode='session';}}catch(_){/* An invalid session never interrupts music or replaces valid history. */}}
function decodeRoll(str){var out={};if(!str)return out;if(str.length>1000)return out;str.split('-').slice(0,LANE_ORDER.length).forEach(function(e){var m=/^([0-9a-z]+)\.([0-9a-z]+)\.([0-9a-z]+)$/.exec(e);if(!m)return;var i=parseInt(m[1],36),s=parseInt(m[2],36),p=parseInt(m[3],36);if(i<LANE_ORDER.length&&s<=1000000&&p<=1000000)out[LANE_ORDER[i]]={s:s,p:p};});return out;}
function readAddress(){var h=location.hash.slice(1),out={};if(h.length>12000)return out;try{var p=new URLSearchParams(h),w=p.get('w');if(!w||!/^[0-9a-z]{1,7}$/.test(w))return{};var seed=parseInt(w,36);if(seed>4294967295)return{};out.w=seed;['y','m','t'].forEach(function(k){var v=p.get(k);if(v&&/^[0-9a-z]{1,7}$/.test(v))out[k]=parseInt(v,36);});if(out.y>KSTYLE_KEYS.length)delete out.y;if(out.t&&(out.t<40||out.t>220))delete out.t;out.r=p.get('r')||'';out.v=p.get('v')||'';if(out.r.length>1000||out.v.length>1000)return{};if(p.has('sb'))out.sb=LuckyCloudSoundBank.normalize(JSON.parse(p.get('sb')));if(p.has('h')){var n=Number(p.get('h'));if(Number.isInteger(n)&&n>=0&&n<=1000000)out.h=n;}return out;}catch(_){return{};}}
function writeAddress(){var p=new URLSearchParams();p.set('w',(S.seed>>>0).toString(36));if(S.style)p.set('y',(KSTYLE_KEYS.indexOf(S.style)+1).toString(36));var r=encodeRoll(),m=encodeMute(),v=encodeVol();if(r)p.set('r',r);if(m)p.set('m',m);if(v)p.set('v',v);if(S.tempo)p.set('t',S.tempo.toString(36));if(S.roll.harm)p.set('h',String(S.roll.harm.p));p.set('sb',JSON.stringify(S.soundBank));S.wrote='#'+p.toString();try{history.replaceState(null,'',S.wrote);}catch(_){}}
function onHashChange(){if(C.destroyed||location.hash===S.wrote)return;var a=readAddress();if(a.w===undefined)return;S.seed=a.w;S.style=a.y?KSTYLE_KEYS[a.y-1]:null;S.roll=decodeRoll(a.r);if(a.h)S.roll.harm={p:a.h,s:0};S.mute=decodeMute(a.m);S.vol=decodeVol(a.v);S.tempo=a.t||null;S.soundBank=a.sb||LuckyCloudSoundBank.normalize({version:'1.0.0',palette:'full',lanes:{}});S.locks={};S.frame=null;S.bar=0;rebuildWorld();paintSong();syncStyleChip();saveSession();if(S.playing)sendSwap(0,false);}
function rebuildWorld(){if(C.destroyed)return S.world;var o=buildOpts();o.soundBank=S.soundBank;S.world=LuckyCloudSoundBank.build(S.seed>>>0,o);return S.world;}
function engineSource(){return $('engine-src').textContent+'\n'+$('sound-bank-src').textContent;}
function cloudRenderBlock(tp,meta,L,R,n,frame){
 if(meta.next!==null&&Number.isFinite(frame)&&frame-meta.next>tp.sr*.05&&tp.playing){var gap=Math.round(frame-meta.next);tp.eng.alignTo(tp.eng.clock+gap);if(tp.xfOn&&tp.spare)tp.spare.alignTo(tp.spare.clock+gap);meta.lateRecoveries++;}
 if(Number.isFinite(frame))meta.next=frame+n;
 tp.process(L,R,n);
 for(var i=0;i<n;i++){var l=L[i],r=R[i];if(!Number.isFinite(l)){meta.nonFinite++;l=0;}if(!Number.isFinite(r)){meta.nonFinite++;r=0;}var peak=Math.max(Math.abs(l),Math.abs(r));if(peak>meta.peak)meta.peak=peak;if(Math.abs(l)>1){meta.clamps++;l=Math.max(-1,Math.min(1,l));}if(Math.abs(r)>1){meta.clamps++;r=Math.max(-1,Math.min(1,r));}L[i]=l;R[i]=r;}
 meta.frames+=n;
}
// A host may suspend immediately, before Transport's fade-to-stop completes.
// A subsequent Play starts a fresh transport lane; ordinary live rolls still crossfade.
function cloudTransportMessage(tp,m){
 if((m.type==='load'||m.type==='swap')&&tp.fadeTo===0){tp.playing=false;tp.fade=0;tp.eng.reset();if(tp.spare)tp.spare.reset();tp.xfOn=false;tp.queued=null;}
 tp.msg(m);
}
WORKLET_GLUE='\n'+cloudTransportMessage.toString()+'\n'+cloudRenderBlock.toString()+'\nclass KnockProcessor extends AudioWorkletProcessor { constructor(opts){super();var tables=opts.processorOptions.tables;this.intent=0;this.tp=new Transport(new Engine(sampleRate,{tables:tables,seed:1}),sampleRate,m=>this.port.postMessage(Object.assign({},m,{cloudIntent:this.intent})),()=>new Engine(sampleRate,{tables:tables,seed:2}));this.health={next:null,peak:0,nonFinite:0,clamps:0,frames:0,lateRecoveries:0};this.tick=0;this.dead=false;this.port.onmessage=e=>{this.intent=e.data.cloudIntent;if(e.data.type==="destroy"){this.dead=true;this.tp.msg({type:"stop"});}else cloudTransportMessage(this.tp,e.data);};}process(inputs,outputs){var o=outputs[0];if(this.dead){o[0].fill(0);if(o[1])o[1].fill(0);return false;}cloudRenderBlock(this.tp,this.health,o[0],o[1]||o[0],o[0].length,currentFrame);this.tick+=o[0].length;if(this.tick>=sampleRate/4){this.tick=0;this.port.postMessage({type:"health",value:this.health});}return true;}}registerProcessor("knock",KnockProcessor);';
var originalCloudMessage=onEngineMsg;
onEngineMsg=function(m){if(C.destroyed)return;if(m.type==='health'){C.health=m.value;C.lateRecoveries=m.value.lateRecoveries;}else if(m.cloudIntent===undefined||m.cloudIntent===C.intent)originalCloudMessage(m);};
function resetAudio(){var ctx=S.ctx,node=S.node;S.audioPromise=null;S.ctx=null;S.node=null;S.send=null;S.tp=null;S.ready=false;S.mode='off';try{if(node){node.onprocessorerror=null;if(node.port)node.port.onmessage=null;node.onaudioprocess=null;node.disconnect();}}catch(_){}if(ctx&&ctx.state!=='closed')return ctx.close().catch(function(){});return Promise.resolve();}
function ensureAudio(){
 if(C.destroyed)return Promise.reject(Error('Instrument closed'));
 if(S.ctx&&S.ctx.state!=='closed'){var resume=S.ctx.state==='running'?Promise.resolve():S.ctx.resume();return Promise.all([resume,S.audioPromise||Promise.resolve(S.ctx)]).then(function(){if(C.destroyed)throw Error('Instrument closed');return S.ctx;});}
 var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return Promise.reject(Error('Web Audio unavailable'));
 var ctx=new AC({latencyHint:'playback'});S.ctx=ctx;var resumed=ctx.resume();buildTables();
 S.audioPromise=Promise.resolve(resumed).then(function(){return startWorklet(ctx);}).catch(function(e){if(C.destroyed)throw e;return startWorkletData(ctx);}).catch(function(e){if(C.destroyed)throw e;return startScriptProcessor(ctx,e);}).then(function(){if(C.destroyed||S.ctx!==ctx)throw Error('Instrument closed');return ctx;}).catch(function(e){resetAudio();throw e;});
 return S.audioPromise;
}
function finishWorklet(ctx){if(C.destroyed||ctx!==S.ctx)throw Error('Instrument closed');var node=new AudioWorkletNode(ctx,'knock',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{tables:S.tables}});node.connect(ctx.destination);node.port.onmessage=function(e){if(!C.destroyed&&ctx===S.ctx)onEngineMsg(e.data);};node.onprocessorerror=function(){pause();resetAudio();toast('Audio stopped. Press Play to restart.');};S.node=node;S.send=function(m){if(!C.destroyed&&ctx===S.ctx)node.port.postMessage(Object.assign({},m,{cloudIntent:C.intent}));};S.mode='worklet';S.ready=true;return ctx;}
function startWorklet(ctx){if(C.destroyed||ctx!==S.ctx||!ctx.audioWorklet)return Promise.reject(Error('AudioWorklet unavailable'));var url=cloudURL(new Blob([engineSource()+WORKLET_GLUE],{type:'application/javascript'}));return bounded(ctx.audioWorklet.addModule(url),15000,'Audio worklet').then(function(){return finishWorklet(ctx);}).finally(function(){revoke(url);});}
function startWorkletData(ctx){if(C.destroyed||!ctx.audioWorklet)return Promise.reject(Error('AudioWorklet unavailable'));return bounded(ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,'+encodeURIComponent(engineSource()+WORKLET_GLUE)),15000,'Audio worklet').then(function(){return finishWorklet(ctx);});}
function startScriptProcessor(ctx,why){if(C.destroyed||ctx!==S.ctx||!ctx.createScriptProcessor)throw(why||Error('Audio unavailable'));var transportIntent=C.intent,tp=new Transport(new Engine(ctx.sampleRate,{tables:S.tables,seed:1}),ctx.sampleRate,function(m){onEngineMsg(Object.assign({},m,{cloudIntent:transportIntent}));},function(){return new Engine(ctx.sampleRate,{tables:S.tables,seed:2});}),node=ctx.createScriptProcessor(2048,0,2),health={next:null,peak:0,nonFinite:0,clamps:0,frames:0,lateRecoveries:0};node.onaudioprocess=function(e){if(C.destroyed)return;cloudRenderBlock(tp,health,e.outputBuffer.getChannelData(0),e.outputBuffer.getChannelData(1),e.outputBuffer.length,Math.round(e.playbackTime*ctx.sampleRate));C.health=health;C.lateRecoveries=health.lateRecoveries;};node.connect(ctx.destination);S.node=node;S.tp=tp;S.send=function(m){if(!C.destroyed&&ctx===S.ctx){transportIntent=C.intent;cloudTransportMessage(tp,m);}};S.mode='script';S.ready=true;return ctx;}
function play(fromBar){if(C.destroyed)return Promise.resolve(false);if(!S.world){S.seed=S.seed||1;rebuildWorld();enterApp();paintSong();}var intent=++C.intent;S.solo=null;S.playing=true;syncPlay();paintBand();return ensureAudio().then(function(){if(C.destroyed||intent!==C.intent||!S.playing||S.solo)return false;sendSwap(fromBar===undefined?S.bar:fromBar,false);return true;}).catch(function(e){if(intent===C.intent&&!C.destroyed){S.playing=false;syncPlay();toast('Audio could not start. Press Play to try again.',4000);}return false;});}
function toggleSolo(lane){if(C.destroyed||!S.world||LANE_ORDER.indexOf(lane)<0)return;if(S.solo===lane){pause();return;}var score=soloScore(lane);if(!score)return;var intent=++C.intent;S.solo=lane;S.playing=true;syncPlay();paintBand();return ensureAudio().then(function(){if(C.destroyed||intent!==C.intent||S.solo!==lane)return;S.send({type:'load',world:score});}).catch(function(){if(intent===C.intent)pause();});}
function rollAll(){if(C.destroyed)return;var a=new Uint32Array(1);if(globalThis.crypto&&crypto.getRandomValues)crypto.getRandomValues(a);else a[0]=(Math.random()*4294967296)>>>0;S.seed=a[0];S.roll={};S.bar=0;S.solo=null;rebuildWorld();play(0);paintSoon();writeAddress();saveSessionSoon();}
function pause(){++C.intent;S.playing=false;S.solo=null;if(S.send)S.send({type:'stop'});if($('bPlay')){syncPlay();paintBand();}var ctx=S.ctx,intent=C.intent;if(ctx&&ctx.state==='running')later(function(){if(intent===C.intent&&!S.playing&&S.ctx===ctx)ctx.suspend().catch(function(){});},140);}
function cloudStop(){pause();cancelExport();return S.ctx&&S.ctx.state!=='closed'?S.ctx.suspend().catch(function(){}):Promise.resolve();}
function holdable(el,fn){var id=null;function stop(){clearTimeout(id);C.timers.delete(id);id=null;}function step(){if(C.destroyed)return;fn();id=later(step,80);}cloudOn(el,'pointerdown',function(e){e.preventDefault();stop();fn();id=later(step,380);});['pointerup','pointerleave','pointercancel','blur'].forEach(function(n){cloudOn(el,n,stop);});cloudOn(el,'keydown',function(e){if((e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();fn();}});}
function cleanExport(job){if(!job)return;clearTimeout(job.timer);C.timers.delete(job.timer);if(job.worker){job.worker.onmessage=null;job.worker.onerror=null;job.worker.terminate();job.worker=null;}revoke(job.url);if(C.exportJob===job)C.exportJob=null;worker=null;Object.keys(saving).forEach(function(k){delete saving[k];});if($('bSave')){$('bSave').disabled=false;$('saveLbl').textContent='SAVE';$('cancelExport').hidden=true;}}
function cancelExport(){var job=C.exportJob;if(job){job.cancelled=true;cleanExport(job);if(!C.destroyed)toast('Export cancelled.');}return !!job;}
function exportMidi(){if(C.destroyed||!S.world)return null;var blob=new Blob([encodeMidi(scoreFor(S.world))],{type:'audio/midi'});anchorSave(blob,baseName()+'.mid');return blob;}
function renderWorkerSource(){return engineSource()+'\nself.onmessage=function(e){var m=e.data;if(m.type!=="render")return;try{var tables=buildWavetables(),world=m.world,files=[],stems=m.kind==="bundle"?stemScores(world):[],jobs=stems.map(function(s){return {name:"stems/"+s.role+".wav",score:s.score};});jobs.push({name:"mix.wav",score:world});for(var i=0;i<jobs.length;i++){var job=jobs[i];var r=renderOffline(job.score,m.sr,tables,{onProgress:function(p){self.postMessage({type:"progress",id:m.id,p:(i+p)/jobs.length});}});files.push({name:job.name,data:new Uint8Array(encodeWav(r.L,r.R,m.sr,makeRng(world.seed>>>0)))});}var buf;if(m.kind==="bundle"){files.push({name:"beat.mid",data:new Uint8Array(encodeMidi(world))});buf=encodeZipStore(files);}else buf=files[0].data.buffer;self.postMessage({type:"done",id:m.id,buf:buf},[buf]);}catch(error){self.postMessage({type:"error",id:m.id,message:String(error.message||error)});}};self.postMessage({type:"ready"});';}
function startExport(kind){
 if(C.destroyed||!S.world||C.exportJob)return false;
 var world=JSON.parse(JSON.stringify(scoreFor(S.world))),sr=S.ctx?S.ctx.sampleRate:44100;
 if(!Number.isFinite(world.duration)||world.duration<=0||world.duration>600){toast('This score is too long to export in one file.');return false;}
 var job={id:++saveId,kind:kind,worker:null,url:null,cancelled:false,timer:null};C.exportJob=job;$('bSave').disabled=true;$('saveLbl').textContent='STARTING';$('cancelExport').hidden=false;
 try{
  job.url=cloudURL(new Blob([renderWorkerSource()],{type:'application/javascript'}));job.worker=new Worker(job.url);worker=job.worker;
  job.worker.onmessage=function(e){if(C.exportJob!==job||job.cancelled||C.destroyed)return;var m=e.data;
   if(m.type==='ready'){revoke(job.url);job.url=null;job.worker.postMessage({type:'render',kind:kind,id:job.id,world:world,sr:sr});return;}
   if(m.id!==job.id)return;
   if(m.type==='progress'){$('saveLbl').textContent='RENDERING '+Math.round(Math.max(0,Math.min(1,m.p))*100)+'%';return;}
   if(m.type==='done'){var blob=new Blob([m.buf],{type:kind==='bundle'?'application/zip':'audio/wav'}),name=baseName()+(kind==='bundle'?'-session.zip':'.wav');cleanExport(job);anchorSave(blob,name);return;}
   if(m.type==='error'){cleanExport(job);toast('Export could not finish. Try a shorter score.',4000);}
  };
  job.worker.onerror=function(){if(C.exportJob===job){cleanExport(job);toast('Export could not start in this browser. MIDI is still available.',4500);}};
  job.timer=later(function(){if(C.exportJob===job){cleanExport(job);toast('Export timed out. MIDI is still available.',4000);}},300000);
 }catch(_){cleanExport(job);toast('Export could not start in this browser. MIDI is still available.',4500);return false;}
 return true;
}
function saveScore(){return startExport('mix');}
function saveBundle(){return startExport('bundle');}
function openSaveMenu(){if(C.destroyed||!S.world)return;$('sheetBody').innerHTML='<h2>SAVE</h2><p>Take this composition into your own session. WAV renders the browser instruments; MIDI saves their notes. Rendering stays on this device and can be cancelled.</p><div class="stylegrid"><button class="stylebtn" id="svMix">the mix<em>one WAV</em></button><button class="stylebtn" id="svMidi">the score<em>MIDI</em></button><button class="stylebtn" id="svStems">the session<em>stems + mix + MIDI</em></button></div>';$('sheet').classList.add('on');$('svMix').onclick=function(){closeSheet();startExport('mix');};$('svMidi').onclick=function(){closeSheet();exportMidi();};$('svStems').onclick=function(){closeSheet();startExport('bundle');};}
function anchorSave(blob,filename){if(C.destroyed)return;var url=cloudURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();later(function(){revoke(url);},1500);toast('File prepared — '+filename,2800);}
function cloudAddress(){
 var canonical=document.querySelector('link[rel="canonical"]');
 // This base is pinned by the builder; never inspect or trust an opaque parent URL.
 var base='https://persona500.com/midi-room/instruments/lucky-dreamer.html';
 if(canonical&&canonical.getAttribute('href')===base)base=canonical.getAttribute('href');
 return base+(S.wrote||('#w='+(S.seed>>>0).toString(36)));
}
function legacyCopyAddress(text){var active=document.activeElement,ta=document.createElement('textarea'),ok=false;ta.value=text;ta.setAttribute('aria-label','Composition address');ta.style.cssText='position:fixed;left:0;top:0;opacity:0';document.body.appendChild(ta);ta.select();try{ok=document.execCommand('copy')===true;}catch(_){}ta.remove();if(active&&active.isConnected)active.focus();return ok;}
function showAddressFallback(url){if(C.destroyed)return;$('sheetBody').innerHTML='<h2>KEEP THIS ADDRESS</h2><p>Clipboard access is unavailable. Select and copy the address below. It saves this version’s seed and controls; locked snapshots stay in PAST.</p><label class="bank-label" for="shareAddress">Composition address</label><textarea id="shareAddress" class="bank-select" readonly rows="5"></textarea>';$('shareAddress').value=url;C.modalReturn=$('sAddr');C.focus=C.modalReturn;$('sheet').classList.add('on');var sharedField=$('shareAddress');later(function(){if($('sheet').classList.contains('on')&&sharedField===$('shareAddress')){sharedField.focus();sharedField.select();}},0);}
async function copyAddress(){if(C.destroyed||!S.world)return false;var url=cloudAddress(),ok=false;try{if(navigator.clipboard&&navigator.clipboard.writeText){await bounded(navigator.clipboard.writeText(url),1500,'Clipboard');ok=true;}}catch(_){}if(C.destroyed)return false;if(!ok)ok=legacyCopyAddress(url);if(ok)toast(hasAny(S.locks)?'Address copied — locked snapshots stay in PAST.':'Address copied — this version’s seed and controls.',3200);else{toast('Clipboard unavailable — copy the address shown.',3200);showAddressFallback(url);}return ok;}
function initSaveBridge(){/* Host save tray intercepts the normal Blob download. No app-specific account API. */}
function deliver(blob,filename){anchorSave(blob,filename);}
function closeSheet(){var target=C.modalReturn||C.focus;$('sheet').classList.remove('on');['gate','bar','stage','deck'].forEach(function(id){$(id).inert=false;});C.modalReturn=null;if(target&&target.isConnected)target.focus();}
function openSounds(){
 var html='<h2>SOUNDS</h2><p>Choose a palette, then roll each lane’s SOUND die. The notes stay put while the instrument changes. Locked lanes keep their sound.</p><label class="bank-label" for="bankPalette">Palette</label><select class="bank-select" id="bankPalette">';
 LuckyCloudSoundBank.palettes.forEach(function(p){html+='<option value="'+p.id+'"'+(S.soundBank.palette===p.id?' selected':'')+'>'+escT(p.label)+'</option>';});html+='</select>';
 var melodic=['keys','lead','pad','bass'].filter(function(l){return S.world&&S.world.lanes.indexOf(l)>=0;});
 melodic.forEach(function(l){html+='<label class="bank-label" for="bank-'+l+'">'+l+'</label><div class="bank-row"><select class="bank-select" id="bank-'+l+'"'+(S.locks[l]?' disabled':'')+'><option value="">let the SOUND die choose</option>';LuckyCloudSoundBank.catalog(l,S.soundBank.palette).forEach(function(p){html+='<option value="'+escT(p.id)+'"'+(S.soundBank.lanes[l]===p.id?' selected':'')+'>'+escT(p.label||p.id)+'</option>';});html+='</select><button type="button" class="bank-hear" id="hear-'+l+'"'+(S.mute[l]?' disabled':'')+' title="play these four bars of '+escT(l)+', alone">hear it</button></div>';});
 if(S.world&&S.world.soundBank)html+='<p>'+escT(S.world.soundBank.credit)+'</p>';
 $('sheetBody').innerHTML=html;$('sheet').classList.add('on');
 $('bankPalette').onchange=function(){var config={version:'1.0.0',palette:this.value,lanes:{}};S.soundBank=LuckyCloudSoundBank.normalize(config);rebuildWorld();paintSong();writeAddress();saveSession();if(S.playing)sendSwap(S.bar,true);else audition(firstAudible());openSounds();$('bankPalette').focus();};
 melodic.forEach(function(l){$('bank-'+l).onchange=function(){var config=JSON.parse(JSON.stringify(S.soundBank));if(this.value)config.lanes[l]=this.value;else delete config.lanes[l];S.soundBank=LuckyCloudSoundBank.normalize(config);var roll=S.roll[l]||(S.roll[l]={s:0,p:0});roll.s=0;rebuildWorld();paintSong();writeAddress();saveSession();if(S.playing)sendSwap(S.bar,true);else audition(l);};var hear=$('hear-'+l);if(hear)hear.onclick=function(){if(S.playing){toast('the beat is running — tap the lane on the stage to hear it alone',2600);return;}if(!audition(l))toast(LANE_LABEL[l]+' rests in this beat',2000);};});
}
ABOUT='<h2>LUCKY DREAMER</h2><p>A whole-band cloud instrument by Aldrin Payopay, who makes music as DRINOMAN. It grew from Dream Drummer and Lucky Sounds: separate rhythm and melodic instruments brought into one place.</p><p>Roll patterns and sounds independently, keep a lane, or bring back a past session. Your sound choices, notes and exports are made locally. No model calls, samples or uploads are needed for playback.</p><h3>THE SOURCES</h3><p>The drum and melodic families retain their source lineage. This is synthesized music, not a recording of the people or traditions named there. Source attribution does not establish blanket rights clearance.</p><h3>KEEP WHAT LANDS</h3><p>PAST holds up to one hundred sessions in this browser. When browser storage is unavailable, they last only while this instrument is open. A saved address reproduces its seed and controls in this version; locked snapshots stay in local history. WAV, MIDI and stems export your own generated composition.</p>';
/* The dice on a row roll the lane whether or not the transport is running,
   so they are the same silence as the sounds sheet. Both kinds get the
   audition: SOUND changes how it hits, PATTERN changes what it plays, and
   neither was audible from a standing start. Harmony is left alone — it
   moves every melodic lane at once, so auditioning any single one of them
   would misreport what changed. */
/* ── MIDI OUT — the band leaves the room ──────────────────────────────────
   Lucky Dreamer already knows all of its music as MIDI: encodeMidi() writes
   a format-1 file with GM programs and the kit on channel 9, and ships it
   through SAVE. It wrote those notes to a file and never to the room, so the
   wish to "link lucky drummer to the percussive instruments on the Triton"
   had nowhere to plug in.
   The notes are published, not the audio: same translation encodeMidi uses,
   scheduled ahead with MidiRoom.emit's `at`, exactly as the Improvisator
   does. That matters because the engine reports its playhead every 50ms —
   half a sixteenth at 140bpm — so a receiver fed on those reports would be
   audibly loose. Emitting 400ms early with a timestamp is the difference
   between a wire and a rumour. Nothing is sent unless a listener has drawn
   a wire; the room fans only to matching routes. */
var busList=null,busWorld=null,busCursor=-1,busLast=-1,busBpm=0,busSaid=-1e9,busSeats=Object.create(null);
function busScore(w){
 var out=[],melCh=0,pi,i;
 for(pi=0;pi<w.roster.length;pi++){
  var r=w.roster[pi];
  if(r.muted)continue;
  var evs=[];
  for(i=0;i<w.events.length;i++)if(w.events[i].part===r.id)evs.push(w.events[i]);
  if(!evs.length)continue;
  /* a kit part whose events carry NOTES is a tuned drum playing a line — a
     bass track, not a channel-10 kit. encodeMidi draws the same line. */
  var isDrum=r.engine==='kit'||r.engine==='perc';
  if(isDrum)for(i=0;i<evs.length;i++)if(evs[i].note!==undefined){isDrum=false;break;}
  var ch=isDrum?9:(melCh===9?++melCh:melCh);
  if(!isDrum)melCh=(melCh+1)%16;
  for(i=0;i<evs.length;i++){
   var e=evs[i],note,dur;
   if(isDrum){
    var map=r.engine==='kit'?GM_KIT:GM_PERC;
    note=map[e.slot>=0&&e.slot<map.length?e.slot:0];
    dur=w.secPerStep*0.5;
   }else{
    if(e.note===undefined||e.note<0||e.note>127)continue;
    note=e.note;dur=Math.max(w.secPerStep*0.5,e.dur*w.secPerStep*0.96);
   }
   /* Clamp to zero, exactly as encodeMidi's Math.max(0, ...) does. The
      humanizer can push the first hit of a beat a few milliseconds before
      the downbeat: measured, 2 of 12 seeds open with notes at -8ms and
      -3ms. Unclamped they sit behind the publisher's opening cursor and
      never reach the wire, so the file would have a hit the wire did not. */
   var at=Math.max(0,e.t*w.secPerStep);
   out.push({at:at,off:at+dur,ch:ch,note:note|0,vel:Math.max(1,Math.min(127,Math.round(e.vel*126)+1)),seat:r.id+':'+e.t});
  }
 }
 out.sort(function(a,b){return a.at-b.at;});
 return out;
}
function busReset(){busList=null;busWorld=null;busCursor=-1;busLast=-1;busBpm=0;busSaid=-1e9;busSeats=Object.create(null);}
/* Transport, so PLAY and STOP here mean PLAY and STOP over there. It also
   closes the one gap the note scheduler leaves open: notes are published
   400ms early, so a stop would otherwise be followed by up to 400ms of
   already-scheduled hits on the other instrument. The room turns a
   transport stop into panicSource, which sends all-notes-off down every
   wire out of here (app.js: cancelOutgoing). The stop is the eraser. */
function busTransport(action,bpm){
 var mr=window.MidiRoom;
 if(C.destroyed||!mr||typeof mr.emit!=='function')return;
 var e={kind:'transport',action:action};
 if(bpm)e.bpm=Math.max(20,Math.min(300,Math.round(bpm)));
 mr.emit(e);
}
function busPublish(t){
 var mr=window.MidiRoom;
 if(C.destroyed||!mr||typeof mr.emit!=='function')return;
 /* only the whole band: a solo or an audition is a different score in the
    engine than S.world, and publishing S.world then would be a lie. */
 if(!S.playing||S.solo||!S.world)return;
 if(busWorld!==S.world){
  /* Keep the cursor. It is the high-water mark of what has already gone down the
     wire, and a new world does not un-send those notes — it only re-times the same
     band. Rewinding it here re-published the whole 0.4 s horizon on every rebuild,
     and a held +/- button rebuilds every 80 ms. Measured over one second on real
     worlds: 38 note-ons where 7 were owed (seed 12345; 34/8 and 38/10 on two more),
     arriving as ~25 flams 3-90 ms apart on the same note — an audible stutter.
     Removing only the rewind collapses 38 to 10.

     THIS IS NOT A TEMPO BUG, and the first version of this note said it was. Freeze
     the tempo and hold the same button and the pile-up is WORSE (44 v 38), because
     the trigger is the rebuild, not the arithmetic. The engine is restruck once
     mid-hold, at +243 ms — not zero times as first written — and the two tempo
     readouts are byte-identical, so nothing here is two clocks disagreeing. It is
     one cable being told the same music twice. This is the same mistake the
     loop-around test below was written to avoid, one branch up. */
  busWorld=S.world;busList=busScore(S.world);busLast=-1;
 }
 /* Say the tempo again now and then, not only when the dial moves. A clock that
    states itself once cannot be joined late: a cable made a minute into the song
    carried notes while the follower's BPM tile stayed a dash forever, so the wire
    list said "Clock" and the instrument said "no clock" and nothing could settle
    it. Measured on the shipped file: eight seconds of steady play sent exactly one
    transport event, at t=0. Once a bar fills the tile within a bar of any connect,
    and `t<busSaid` catches the loop coming round. */
 if(S.world.bpm&&(S.world.bpm!==busBpm||t-busSaid>=S.world.secPerStep*16||t<busSaid)){
  busBpm=S.world.bpm;busSaid=t;busTransport('tempo',busBpm);
 }
 /* The loop came round. Test it against the PREVIOUS playhead, never against
    the cursor: the cursor sits a whole horizon ahead of the playhead by
    design, so `t < busCursor` is true on every single report and rewinds the
    cursor every 50ms. Measured before this line was written that way: 12 of
    12 seeds re-sent the same notes, 10,199 duplicates in one loop of the
    first. */
 if(busLast>=0&&t<busLast-1e-3){busCursor=t-1e-3;busSeats=Object.create(null);}
 busLast=t;
 var horizon=t+0.4,base=mr.now();
 for(var i=0;i<busList.length;i++){
  var n=busList[i];
  /* Skip what has already gone down the wire, by its seat in the music (part + step),
     never by its position in time. A rebuild re-times the same band, so the same note comes
     back with a different `at`; a time cursor either re-sends it (flams, ~half the notes on
     a held button) or, if the cursor is carried, silently drops material the rebuild ADDED
     inside the horizon — measured at 0 of the 4 notes owed in the first 400 ms after a lane
     is unmuted, its entry sliding 125 ms -> 500 ms. The seat is stable under re-timing, so
     it separates the two: a re-timed note is the same seat and is skipped; an unmuted lane
     is a new seat and goes out at once. */
  if(busSeats[n.seat])continue;
  if(n.at>horizon)break;                      /* sorted: nothing later matters */
  var on=base+(n.at-t)*1000,off=base+(n.off-t)*1000;
  if(on<base)on=base;
  if(off<on+40)off=on+40;
  mr.emit({kind:'midi',data:[0x90|n.ch,n.note,n.vel],at:on});
  mr.emit({kind:'midi',data:[0x80|n.ch,n.note,0],at:off});
  busSeats[n.seat]=1;
 }
 busCursor=horizon;
}
var originalOnEngineMsg=onEngineMsg;
onEngineMsg=function(m){
 originalOnEngineMsg(m);
 if(m&&m.type==='pos')busPublish(m.t);
};
/* ── TAP A LANE ──────────────────────────────────────────────────────────
   Two things made "tap a lane to hear it alone" read as a dead button.
   First, this file declares toggleSolo twice, and the later copy — the live
   one — dropped both of the toasts the earlier one had. Tapping a lane that
   rests in this beat therefore did nothing whatever: no sound, no message,
   nothing on screen. Second, only the name cell was ever a target. Every
   other child of the row already calls e.stopPropagation(), so the plumbing
   for a row-level handler was written and the handler never was; at phone
   width the five fixed siblings take about 240px and leave the name cell
   near 100px, with the rest of the row inert.
   Both are restored here rather than edited into the late copy, so the two
   definitions of toggleSolo stay diffable against each other. */
var originalToggleSolo=toggleSolo;
toggleSolo=function(lane){
 if(C.destroyed||!S.world||LANE_ORDER.indexOf(lane)<0)return;
 var wasSolo=S.solo;
 var r=originalToggleSolo(lane);
 if(wasSolo===lane)return r;                       /* a second tap stops it */
 if(S.solo!==lane){toast(LANE_LABEL[lane]+' rests in this beat',2000);return r;}
 toast(LANE_LABEL[lane]+' alone — '+laneVoiceLabel(lane),2400);
 return r;
};
var originalRowFor=rowFor;
rowFor=function(lane){
 var row=originalRowFor(lane);
 row.addEventListener('click',function(e){
  /* the name cell has its own handler and the volume cell is not a target;
     everything else in the row already stops here */
  if(e.target&&e.target.closest&&e.target.closest('.rname, .rvol'))return;
  if(S.mute[lane]){toast(LANE_LABEL[lane]+' is muted — tap the speaker to bring it back',2200);return;}
  toggleSolo(lane);
 });
 return row;
};
var originalRollPart=rollPart;
rollPart=function(lane,kind,btn){
 var wasPlaying=S.playing,wasSolo=S.solo,wasLocked=!!S.locks[lane];
 var r=originalRollPart(lane,kind,btn);
 if(wasLocked)return r;
 if(!wasPlaying&&wasSolo!==lane){audition(lane);return r;}
 /* One state stays silent on purpose: another lane is soloed, so you asked
    to be listening to that one and a roll must not yank it away. But the
    toast underneath had been naming a brand-new instrument for a lane you
    cannot hear, which reads as the same broken button. Say what is true
    instead — a second toast replaces the first. */
 if(wasSolo&&wasSolo!==lane)toast(LANE_LABEL[lane]+' \u2192 '+laneVoiceLabel(lane)+' \u2014 you are hearing '+LANE_LABEL[wasSolo]+' alone',2800);
 return r;
};
/* Both take the engine, so both cancel a running audition. Their return
   values are not ours to swallow: the cloud play() at the head of this layer
   answers with a Promise, and callers wait on it. */
var originalPause=pause;
pause=function(){auditionStop();busReset();busTransport('stop');return originalPause();};
var originalPlay=play;
play=function(fromBar){auditionStop();busReset();var r=originalPlay(fromBar);busTransport('start',S.world&&S.world.bpm);return r;};
function cloudState(){return {historyMode:C.historyMode,historyCount:C.history.length,seed:S.seed,style:S.style,playing:S.playing,solo:S.solo,bar:S.bar,time:S.playhead,mode:S.mode,audioState:S.ctx?S.ctx.state:(C.destroyed?'closed':'off'),destroyed:C.destroyed,soundBank:JSON.parse(JSON.stringify(S.soundBank)),stats:C.health||null,lateRecoveries:C.lateRecoveries,resources:{urls:C.urls.size,workers:C.exportJob&&C.exportJob.worker?1:0,timers:C.timers.size,exporting:!!C.exportJob},roll:JSON.parse(JSON.stringify(S.roll)),locks:Object.keys(S.locks)};}
async function cloudDestroy(){if(C.destroyed)return;saveSession();C.destroyed=true;C.history=[];++C.intent;S.playing=false;S.solo=null;cancelExport();[toastT,saveT,swapT].forEach(clearTimeout);C.timers.forEach(clearTimeout);C.timers.clear();C.listeners.splice(0).forEach(function(off){off();});if(C.observer)C.observer.disconnect();C.urls.forEach(revoke);if(S.send)try{S.send({type:'stop'});}catch(_){}document.body.inert=true;await resetAudio();}
function cloudInstall(){
 if(C.destroyed)return;
 cloudOn($('dice'),'click',function(){if(!C.destroyed)ensureAudio().catch(function(){});},true);
 cloudOn($('bRoll'),'click',function(){if(!C.destroyed)ensureAudio().catch(function(){});},true);
 cloudOn($('bSounds'),'click',openSounds);cloudOn($('cancelExport'),'click',cancelExport);
 cloudOn(document,'visibilitychange',function(){if(document.hidden)cloudStop();});cloudOn(window,'blur',function(){cloudStop();});
 cloudOn(window,'pagehide',cloudDestroy);cloudOn(window,'midiroom:panic',cloudStop);cloudOn(window,'midiroom:dispose',cloudDestroy);
 if(window.MidiRoom&&MidiRoom.declare)MidiRoom.declare({name:'Lucky Dreamer',send:['midi','transport'],receive:[]});  /* send: it plays a whole band and, until now, was the only instrument in the room that could not be     wired to anything — the wire dialog offered it and then refused with "no compatible output".     receive stays empty: there is no note-in path here, and claiming one would put Lucky Dreamer in the     TO menu only to swallow whatever arrived. */
 var sheet=$('sheet'),wasOpen=false;
 C.observer=new MutationObserver(function(){var open=sheet.classList.contains('on');sheet.setAttribute('aria-hidden',String(!open));if(open&&!wasOpen){C.focus=C.modalReturn||document.activeElement;C.modalReturn=null;[ 'gate','bar','stage','deck' ].forEach(function(id){$(id).inert=true;});var first=sheet.querySelector('button:not([disabled]),select:not([disabled]),[tabindex]');if(first)first.focus();}else if(!open&&wasOpen){[ 'gate','bar','stage','deck' ].forEach(function(id){$(id).inert=false;});if(C.focus&&C.focus.isConnected)C.focus.focus();}wasOpen=open;});C.observer.observe(sheet,{attributes:true,attributeFilter:['class']});
 cloudOn(document,'keydown',function(e){if(C.destroyed)return;var open=sheet.classList.contains('on');if(open){if(e.key==='Escape'){e.preventDefault();closeSheet();}else if(e.key==='Tab'){var f=Array.from(sheet.querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea,[tabindex="0"]')).filter(function(x){return x.getClientRects().length;});if(f.length){var i=f.indexOf(document.activeElement),next=e.shiftKey?(i<=0?f.length-1:i-1):(i>=f.length-1?0:i+1);e.preventDefault();f[next].focus();}}return;}var t=e.target;if(t&&t.closest&&t.closest('input,textarea,select,[contenteditable="true"],button,a'))return;if(e.repeat||e.altKey||e.ctrlKey||e.metaKey)return;if(e.key===' '){e.preventDefault();if(!$('gate').classList.contains('gone'))$('dice').click();else if(S.playing)pause();else play();}else if((e.key==='r'||e.key==='R')&&S.world)rollAll();});
}
var originalCloudBoot=boot;
boot=function(){if(C.destroyed)return;var a=readAddress();if(a.sb)S.soundBank=a.sb;originalCloudBoot();if(a.h&&S.world){S.roll.harm={p:a.h,s:0};rebuildWorld();}cloudInstall();};
window.LuckyCloud={getState:cloudState,address:cloudAddress,copyAddress:copyAddress,world:function(){return S.world;},play:play,stop:cloudStop,destroy:cloudDestroy,seed:function(n,opts){if(C.destroyed||!Number.isInteger(n)||n<0||n>4294967295)return false;var r=normalizeRecord(Object.assign({seed:n,style:null,roll:{},locks:{},mute:{},frame:null,tempo:null,vol:{},soundBank:S.soundBank},opts||{}));if(!restoreRecord(r))return false;rebuildWorld();enterApp();paintSong();writeAddress();saveSession();return true;},roll:function(l,k){if(C.destroyed||LANE_ORDER.indexOf(l)<0||(k!=='s'&&k!=='p'))return false;rollPart(l,k);return true;},lock:function(l){if(!C.destroyed&&S.world&&LANE_ORDER.indexOf(l)>=0)toggleLock(l);},mute:function(l){if(!C.destroyed&&S.world&&LANE_ORDER.indexOf(l)>=0)toggleMute(l);},solo:function(l){if(!C.destroyed&&S.world&&LANE_ORDER.indexOf(l)>=0)toggleSolo(l);},exportMidi:exportMidi,exportWav:function(){return startExport('mix');},cancelExport:cancelExport,readHistory:readHistory,restore:function(o){if(C.destroyed||!restoreRecord(o))return false;rebuildWorld();enterApp();paintSong();writeAddress();return true;}};
window.LuckyDreamer=window.LuckyCloud;
