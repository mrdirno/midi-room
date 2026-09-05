/* Author: Aldrin Payopay. Lucky Dreamer standalone player, no network calls. */
(function(){
'use strict';
const $=id=>document.getElementById(id), VERSION='1.0.0';
const labels={sub:'Sub',kick:'Kick',snare:'Snare',hat:'Hi-hat',perc:'Percussion',aux:'Answer drums',keys:'Keys',lead:'Melody',pad:'Air',bass:'Bass'};
const sectionNames={in:'Arrive',A:'First idea',B:'Open up',low:'Breathe',C:'Come home'};
const S={seed:20260905,style:'',roll:{},mute:{},volume:{},locks:{},bpm:null,solo:null,world:null,loop:true,master:0.8,bar:0,time:0,playing:false,intent:0,ctx:null,node:null,send:null,audioPromise:null,tables:null,mode:'off',destroyed:false,history:[],stats:{},held:new Map(),keyOwners:new Map(),listeners:[],urls:new Set(),workers:new Set()};
let toastTimer=null,saveTimer=null,swapTimer=null,parkTimer=null,raf=null,skipHash=false;
const on=(target,type,fn,options)=>{target.addEventListener(type,fn,options);S.listeners.push(()=>target.removeEventListener(type,fn,options));};
const clone=v=>JSON.parse(JSON.stringify(v));
function notify(message){$('toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').textContent='';},3000);}
function freshSeed(){const a=new Uint32Array(1);if(globalThis.crypto&&crypto.getRandomValues)crypto.getRandomValues(a);else a[0]=Date.now()>>>0;return a[0];}
function recipe(){return {app:'lucky-dreamer',version:VERSION,seed:S.seed,style:S.style,roll:clone(S.roll),bpm:S.bpm,locks:clone(S.locks),mute:clone(S.mute),volume:clone(S.volume),loop:S.loop,master:S.master};}
function validateRecipe(r){
 if(!r||r.app!=='lucky-dreamer'||r.version!==VERSION||!Number.isInteger(r.seed)||r.seed<0||r.seed>4294967295)throw Error('Choose a Lucky Dreamer 1.0 recipe.');
 if(r.style!==''&&!KSTYLES[r.style])throw Error('The recipe has an unknown musical language.');
 if(r.bpm!==null&&(!Number.isFinite(r.bpm)||r.bpm<40||r.bpm>220))throw Error('The recipe tempo must be between 40 and 220.');
 const out={app:r.app,version:r.version,seed:r.seed,style:r.style,roll:{},bpm:r.bpm,locks:{},mute:{},volume:{},loop:r.loop!==false,master:Number.isFinite(r.master)?Math.max(0,Math.min(1,r.master)):0.8};
 const lanes=Object.keys(labels);
 for(const l of lanes.concat('harm'))if(r.roll&&r.roll[l]){
  const x=r.roll[l];if(!Number.isInteger(x.p)||!Number.isInteger(x.s)||x.p<0||x.s<0||x.p>1000000||x.s>1000000)throw Error('The recipe contains an invalid variation.');
  out.roll[l]={p:x.p,s:x.s};
 }
 for(const l of lanes){if(r.locks&&r.locks[l]===true)out.locks[l]=true;if(r.mute&&r.mute[l]===true)out.mute[l]=true;if(r.volume&&Number.isFinite(r.volume[l]))out.volume[l]=Math.max(0,Math.min(1.5,r.volume[l]));}
 return out;
}
function address(){const r=recipe();const p=new URLSearchParams();p.set('v','1');p.set('seed',r.seed);if(r.style)p.set('style',r.style);if(r.bpm)p.set('bpm',r.bpm);if(Object.keys(r.roll).length)p.set('r',JSON.stringify(r.roll));if(Object.keys(r.mute).length)p.set('m',Object.keys(r.mute).join(','));if(Object.keys(r.locks).length)p.set('k',Object.keys(r.locks).join(','));if(Object.keys(r.volume).length)p.set('vol',JSON.stringify(r.volume));if(!r.loop)p.set('loop','0');return '#'+p.toString();}
function readHash(){
 if(!location.hash||location.hash.length>12000)return null;
 try{const p=new URLSearchParams(location.hash.slice(1));if(p.get('v')!=='1'||!p.has('seed'))return null;const map=x=>Object.fromEntries((p.get(x)||'').split(',').filter(Boolean).map(k=>[k,true]));return validateRecipe({app:'lucky-dreamer',version:VERSION,seed:Number(p.get('seed')),style:p.get('style')||'',bpm:p.has('bpm')?Number(p.get('bpm')):null,roll:JSON.parse(p.get('r')||'{}'),mute:map('m'),locks:map('k'),volume:JSON.parse(p.get('vol')||'{}'),loop:p.get('loop')!=='0'});}catch(_){return null;}
}
function persist(){
 const hash=address();$('recipe').value=hash;
 try{skipHash=true;history.replaceState(null,'',hash);}catch(_){}finally{skipHash=false;}
 clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem('lucky-dreamer-v1',JSON.stringify(recipe()));}catch(_){}},180);
}
function remember(){S.history.push(recipe());if(S.history.length>24)S.history.shift();$('undo').disabled=false;}
function applyRecipe(r){const valid=validateRecipe(r);Object.assign(S,valid);S.solo=null;S.bar=0;S.time=0;rebuild(false);}
function opts(){return {style:S.style||undefined,roll:S.roll,bpm:S.bpm||undefined};}
function currentScore(){return LuckyComposer.scoreFor(S.world,{mute:S.mute,solo:S.solo,volume:S.volume});}
function rebuild(follow=true){
 const before=S.world;S.world=LuckyComposer.compose(S.seed,opts());
 if(before&&follow)S.bar=Math.min(S.bar,S.world.bars-1);else{S.bar=0;S.time=0;}
 paint();persist();
 if(S.send){if(S.playing)sendScore(follow);else S.send({type:'prepare',world:currentScore()});}
}
function rollAll(){
 remember();const held=Object.keys(S.locks).filter(l=>S.locks[l]);
 if(held.length){for(const l of S.world.lanes)if(!S.locks[l])bump(l,'p',true);}
 else{S.seed=freshSeed();S.roll={};S.volume={};S.mute={};S.bpm=null;}
 S.solo=null;rebuild(false);$('roll').classList.remove('rolling');void $('roll').offsetWidth;$('roll').classList.add('rolling');
 notify(held.length?'Kept lanes stayed. The rest of the band moved.':'A new band is ready.');
}
function bump(lane,kind,soundToo=false){const r=S.roll[lane]||(S.roll[lane]={p:0,s:0});r[kind]=(r[kind]+1)%1000000;if(soundToo)r.s=(r.s+1)%1000000;}
function variant(lane,kind='p'){
 if(!S.world.lanes.includes(lane)&&lane!=='harm')return false;
 if(S.locks[lane]){notify('Unkeep this lane before changing it.');return false;}
 if(lane==='harm'&&['lead','keys','pad','bass','sub'].some(l=>S.locks[l])){notify('Unkeep the pitched lanes before turning their harmony.');return false;}
 remember();bump(lane,kind);rebuild(true);notify(lane==='harm'?'The whole band moved to '+S.world.keyName+'.':`${labels[lane]} ${kind==='s'?'sound':'pattern'} changed.`);return true;
}
function toggleLock(lane){S.locks[lane]=!S.locks[lane];if(!S.locks[lane])delete S.locks[lane];paintLanes();persist();}
function queueMix(){clearTimeout(swapTimer);swapTimer=setTimeout(()=>{if(S.playing)sendScore(true);persist();},90);}
function sendScore(follow){S.send({type:'swap',world:currentScore(),bar:S.bar,follow:!!follow,loop:S.loop});}
function engineSource(){return $('lucky-engine').textContent;}
const workletGlue=`
class LuckyProcessor extends AudioWorkletProcessor {
 constructor(options){super();this.count=0;this.render=new LuckyRenderer(sampleRate,options.processorOptions.tables,m=>this.port.postMessage(m));this.port.onmessage=e=>this.render.msg(e.data);}
 process(inputs,outputs){const o=outputs[0];if(!o||!o.length)return true;this.render.process(o[0],o[1]||o[0],o[0].length,currentFrame);this.count+=o[0].length;if(this.count>=sampleRate/4){this.count=0;this.port.postMessage({type:'stats',value:this.render.stats()});}return !this.render.destroyed;}
}
registerProcessor('lucky-dreamer-v1',LuckyProcessor);`;
async function createAudio(){
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('This browser does not offer Web Audio. Try a current browser.');
 const ctx=new AC({latencyHint:'playback'});S.ctx=ctx;
 // Resume while still in the initiating touch/key event, before module work.
 await ctx.resume();if(S.destroyed){await ctx.close();throw Error('This instrument has closed.');}
 S.tables=S.tables||buildWavetables();
 let audioNode=null,failures=[];
 if(ctx.audioWorklet){
  const source=engineSource()+workletGlue;
  const blobURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));S.urls.add(blobURL);
  try{await ctx.audioWorklet.addModule(blobURL);}catch(error){
   failures.push(String(error.message||error));
   try{await ctx.audioWorklet.addModule('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));}catch(second){failures.push(String(second.message||second));}
  }finally{URL.revokeObjectURL(blobURL);S.urls.delete(blobURL);}
  if(failures.length<2){
   try{audioNode=new AudioWorkletNode(ctx,'lucky-dreamer-v1',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{tables:S.tables}});audioNode.port.onmessage=e=>audioMessage(e.data);audioNode.onprocessorerror=()=>{stop();$('status').textContent='The sound engine stopped. Press Play to try again.';resetAudio();};S.send=m=>audioNode.port.postMessage(m);S.mode='worklet';}catch(error){failures.push(String(error.message||error));}
  }
 }
 if(!audioNode){
  if(!ctx.createScriptProcessor)throw Error('Audio could not start. Try opening this file in Safari or Chrome.');
  audioNode=ctx.createScriptProcessor(2048,0,2);const render=new LuckyRenderer(ctx.sampleRate,S.tables,audioMessage);let blocks=0;
  audioNode.onaudioprocess=e=>{const L=e.outputBuffer.getChannelData(0),R=e.outputBuffer.getChannelData(1);for(let offset=0;offset<L.length;offset+=128){render.process(L.subarray(offset,offset+128),R.subarray(offset,offset+128),Math.min(128,L.length-offset),Math.round(e.playbackTime*ctx.sampleRate)+offset);}if(++blocks%8===0)audioMessage({type:'stats',value:render.stats()});};
  S.send=m=>render.msg(m);S.mode='fallback';
 }
 if(S.destroyed){audioNode.disconnect();await ctx.close();throw Error('This instrument has closed.');}
 S.node=audioNode;S.output=ctx.createGain();S.output.gain.value=S.master;audioNode.connect(S.output);S.output.connect(ctx.destination);
 S.send({type:'prepare',world:currentScore()});
 $('engine-label').textContent=S.mode==='worklet'?'Sound runs on its own audio thread.':'Compatibility audio mode.';
 ctx.onstatechange=()=>{if(ctx.state==='interrupted'||ctx.state==='suspended'){if(S.playing){S.playing=false;S.intent++;if(S.send)S.send({type:'stop'});releaseKeys();syncPlay();$('status').textContent='Audio paused. Press Play to continue.';}}};
 return ctx;
}
async function ensureAudio(){
 clearTimeout(parkTimer);
 if(S.destroyed)throw Error('This instrument has closed.');
 if(S.ctx&&S.ctx.state==='closed'){S.audioPromise=null;S.ctx=null;}
 if(!S.audioPromise)S.audioPromise=createAudio().catch(async error=>{await resetAudio();throw error;});
 const ctx=await S.audioPromise;if(ctx.state!=='running')await ctx.resume();return ctx;
}
async function resetAudio(){const ctx=S.ctx;try{if(S.send)S.send({type:'destroy'});if(S.node)S.node.disconnect();if(S.output)S.output.disconnect();if(ctx&&ctx.state!=='closed')await ctx.close();}catch(_){}S.ctx=null;S.node=null;S.output=null;S.send=null;S.audioPromise=null;S.mode='off';}
function audioMessage(m){
 if(S.destroyed)return;
 if(m.type==='pos'){
  S.time=m.t;S.bar=Math.min(S.world.bars-1,Math.floor(m.t/(S.world.steps*S.world.secPerStep)));paintPosition();
 }else if(m.type==='ended'){S.playing=false;S.bar=0;S.time=0;syncPlay();$('status').textContent='That was the band. Roll again, or replay it.';park();}
 else if(m.type==='stats'){
  S.stats=m.value;
  if(m.value.nonFinite>0&&S.playing){stop();$('status').textContent='This band hit an audio error. Roll another band, then press Play.';resetAudio();}
 }
 else if(m.type==='recovered')$('status').textContent='Audio clock recovered at the current bar.';
}
async function play(fromBar){
 const intent=++S.intent;S.playing=true;if(Number.isFinite(fromBar)){S.bar=Math.max(0,Math.min(S.world.bars-1,Math.floor(fromBar)));S.time=S.bar*S.world.steps*S.world.secPerStep;}
 syncPlay();$('status').textContent='Starting the band…';
 try{await ensureAudio();if(intent!==S.intent||!S.playing||S.destroyed)return false;sendScore(false);$('status').textContent='Playing';syncPlay();return true;}
 catch(error){if(intent===S.intent){S.playing=false;syncPlay();$('status').textContent=error.message||'Audio could not start. Press Play to retry.';}return false;}
}
function park(){clearTimeout(parkTimer);parkTimer=setTimeout(()=>{if(!S.playing&&!S.held.size&&S.ctx&&S.ctx.state==='running')S.ctx.suspend().catch(()=>{});},400);}
function stop(){S.intent++;S.playing=false;releaseKeys();if(S.send)S.send({type:'stop'});syncPlay();$('status').textContent='Paused. Pick up here, or start from the top.';park();}
function seek(bar){S.bar=Math.max(0,Math.min(S.world.bars-1,Math.round(bar)));S.time=S.bar*S.world.steps*S.world.secPerStep;if(S.playing)sendScore(false);paintPosition();}
function syncPlay(){const b=$('play');b.setAttribute('aria-label',S.playing?'Pause band':'Play band');$('play-icon').innerHTML=S.playing?'<path fill="currentColor" d="M5 3h5v18H5zm9 0h5v18h-5z"/>':'<path fill="currentColor" d="M7 3l15 9L7 21z"/>';}
function time(sec){return Math.floor(sec/60)+':'+String(Math.floor(sec%60)).padStart(2,'0');}
function paintPosition(){
 const ratio=S.world?Math.min(1,S.time/S.world.duration):0;$('playhead').style.left=(ratio*100)+'%';$('time').textContent=time(S.time)+' / '+time(S.world.duration);$('seek').value=S.bar;$('seek').setAttribute('aria-valuetext','Bar '+(S.bar+1)+' of '+S.world.bars);
 for(const b of $('sections').children)b.classList.toggle('active',S.bar>=Number(b.dataset.start)&&S.bar<Number(b.dataset.end));
}
function paintScore(){
 const canvas=$('score'),rect=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.round(126*dpr);const c=canvas.getContext('2d');c.scale(dpr,dpr);const width=rect.width,height=126,total=S.world.bars*S.world.steps;
 c.clearRect(0,0,width,height);for(let b=0;b<=S.world.bars;b++){c.strokeStyle=b%2?'#e4ebf5':'#c7d5e8';c.lineWidth=1;c.beginPath();c.moveTo(b/S.world.bars*width,0);c.lineTo(b/S.world.bars*width,height);c.stroke();}
 const notes=S.world.events.filter(e=>e.ln==='lead');for(const n of notes){const x=n.t/total*width,y=height-18-(n.note-60)/25*(height-30);c.fillStyle=n.anchor?'#bd315a':'#797ac7';c.fillRect(x,y,Math.max(2,n.dur/total*width),4);}
}
function paintLanes(){
 const root=$('lanes');root.replaceChildren();
 for(const lane of S.world.lanes){
  const row=document.createElement('div');row.className='lane'+(S.mute[lane]?' muted':'')+(S.locks[lane]?' lane-locked':'');
  const name=document.createElement('div'),main=document.createElement('div'),voice=document.createElement('div');main.className='lane-name';main.textContent=labels[lane]||lane;voice.className='lane-voice';const part=S.world.roster.find(p=>p.id===S.world.laneParts[lane]);voice.textContent=part?`${part.engine} / ${part.patch}`:'';name.append(main,voice);row.append(name);
  const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='150';volume.value=Math.round((S.volume[lane]===undefined?1:S.volume[lane])*100);volume.setAttribute('aria-label',(labels[lane]||lane)+' level');volume.addEventListener('input',()=>{S.volume[lane]=Number(volume.value)/100;queueMix();});row.append(volume);
  const buttons=document.createElement('div');buttons.className='lane-controls';
  function button(text,label,fn,pressed){const b=document.createElement('button');b.textContent=text;b.setAttribute('aria-label',label);if(pressed!==undefined)b.setAttribute('aria-pressed',String(pressed));b.addEventListener('click',fn);buttons.append(b);return b;}
  button('Pattern',`Another ${labels[lane]} pattern`,()=>variant(lane,'p'));button('Sound',`Another ${labels[lane]} sound`,()=>variant(lane,'s'));
  button('Keep',`Keep ${labels[lane]} when rolling`,()=>toggleLock(lane),!!S.locks[lane]);
  button('Solo',`Solo ${labels[lane]}`,()=>{S.solo=S.solo===lane?null:lane;paintLanes();queueMix();},S.solo===lane);
  button('Mute',`Mute ${labels[lane]}`,()=>{S.mute[lane]=!S.mute[lane];if(!S.mute[lane])delete S.mute[lane];paintLanes();queueMix();},!!S.mute[lane]);row.append(buttons);root.append(row);
 }
 $('roll-label').textContent=Object.keys(S.locks).length?'Roll around what you kept.':'One die. A whole idea.';
}
function paint(){
 $('song-title').textContent=S.world.name;$('song-meta').textContent=`${S.world.styleLabel} · ${S.world.keyName} · ${S.world.bars} bars`;$('style').value=S.style;$('tempo').value=S.world.bpm;$('master').value=Math.round(S.master*100);$('master-value').textContent=Math.round(S.master*100)+'%';$('loop').setAttribute('aria-pressed',String(S.loop));$('seek').max=S.world.bars-1;
 $('lineage').textContent=[S.world.styleOrigin,S.world.harmCredit,S.world.bandCredit].filter(Boolean).join(' ');
 $('sections').replaceChildren();for(const sec of S.world.sections){const b=document.createElement('button');b.className='section-button';b.style.flex=sec.bars;b.textContent=sectionNames[sec.name]||sec.name;b.dataset.start=sec.startBar;b.dataset.end=sec.startBar+sec.bars;b.setAttribute('aria-label',`${b.textContent}, bar ${sec.startBar+1}`);b.addEventListener('click',()=>seek(sec.startBar));$('sections').append(b);}
 paintLanes();paintScore();paintPosition();syncPlay();$('undo').disabled=!S.history.length;
}
async function keyDown(note,owner){
 if(S.keyOwners.has(owner))return;S.keyOwners.set(owner,note);S.held.set(note,(S.held.get(note)||0)+1);keyPaint(note,true);
 try{await ensureAudio();if(S.keyOwners.get(owner)!==note)return;S.send({type:'note',note:note,on:true,velocity:0.65});}catch(error){keyUp(owner);notify(error.message);}
}
function keyPaint(note,down){const el=$('keyboard').querySelector(`[data-note="${note}"]`);if(el)el.classList.toggle('down',down);}
function keyUp(owner){const note=S.keyOwners.get(owner);if(note===undefined)return;S.keyOwners.delete(owner);const remaining=Math.max(0,(S.held.get(note)||0)-1);if(remaining)S.held.set(note,remaining);else{S.held.delete(note);keyPaint(note,false);if(S.send)S.send({type:'note',note:note,on:false});}if(!S.held.size&&!S.playing)park();}
function releaseKeys(){for(const owner of [...S.keyOwners.keys()])keyUp(owner);if(S.send)S.send({type:'release'});}
function buildKeyboard(){
 const white=[60,62,64,65,67,69,71,72],names=['C','D','E','F','G','A','B','C'],keys=['A','S','D','F','G','H','J','K'];
 function add(note,label,black,left){const b=document.createElement('button');b.className='key'+(black?' black':'');b.dataset.note=note;b.textContent=label;b.setAttribute('aria-label','Play '+KNOTE[note%12]+Math.floor(note/12-1));if(black)b.style.left=left+'%';b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keyDown(note,'p'+e.pointerId);});b.addEventListener('pointerup',e=>keyUp('p'+e.pointerId));b.addEventListener('pointercancel',e=>keyUp('p'+e.pointerId));b.addEventListener('lostpointercapture',e=>keyUp('p'+e.pointerId));b.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();if(!e.repeat)keyDown(note,'button'+note);}});b.addEventListener('keyup',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();keyUp('button'+note);}});b.addEventListener('blur',()=>keyUp('button'+note));$('keyboard').append(b);}
 white.forEach((n,i)=>add(n,names[i]+' / '+keys[i],false));[[61,'W',8.5],[63,'E',21],[66,'T',46],[68,'Y',58.5],[70,'U',71]].forEach(x=>add(x[0],x[1],true,x[2]));
}
function deliver(bytes,type,name){const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob);S.urls.add(url);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);S.urls.delete(url);},8000);return blob;}
function exportMidi(download=true){const bytes=encodeMidi(currentScore());if(download)deliver(bytes,'audio/midi',`lucky-dreamer-${S.seed}.mid`);return bytes;}
async function destroy(){if(S.destroyed)return;stop();S.destroyed=true;clearTimeout(toastTimer);clearTimeout(saveTimer);clearTimeout(swapTimer);clearTimeout(parkTimer);if(raf)cancelAnimationFrame(raf);for(const remove of S.listeners)remove();S.listeners=[];for(const w of S.workers)w.terminate();for(const url of S.urls)URL.revokeObjectURL(url);S.urls.clear();await resetAudio();}

for(const style of KSTYLE_KEYS){const o=document.createElement('option');o.value=style;o.textContent=KSTYLES[style].label;$('style').append(o);}
let initial=readHash();if(!initial)try{const saved=localStorage.getItem('lucky-dreamer-v1');if(saved)initial=validateRecipe(JSON.parse(saved));}catch(_){}
if(initial)Object.assign(S,initial);rebuild(false);buildKeyboard();
on($('roll'),'click',rollAll);on($('play'),'click',()=>S.playing?stop():play());on($('restart'),'click',()=>play(0));on($('melody'),'click',()=>variant('lead'));
on($('loop'),'click',()=>{S.loop=!S.loop;$('loop').setAttribute('aria-pressed',String(S.loop));if(S.send)S.send({type:'loop',value:S.loop});persist();});
on($('style'),'change',()=>{remember();S.style=$('style').value;S.roll={};S.locks={};S.bpm=null;S.solo=null;rebuild(false);});
on($('tempo'),'change',()=>{const n=Number($('tempo').value);if(!Number.isFinite(n)||n<40||n>220){$('tempo').value=S.world.bpm;notify('Choose a tempo from 40 to 220 bpm.');return;}remember();S.bpm=Math.round(n);rebuild(true);});
on($('seek'),'input',()=>seek(Number($('seek').value)));on($('harmony'),'click',()=>variant('harm'));
on($('master'),'input',()=>{S.master=Number($('master').value)/100;$('master-value').textContent=Math.round(S.master*100)+'%';if(S.output&&S.ctx)S.output.gain.setTargetAtTime(S.master,S.ctx.currentTime,0.025);persist();});
on($('undo'),'click',()=>{const r=S.history.pop();if(r)applyRecipe(r);$('undo').disabled=!S.history.length;notify('Previous roll restored.');});
on($('keep'),'click',()=>{$('save-details').open=true;$('save-details').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});persist();notify('Save a recipe below to keep a copy of this band.');});
on($('midi'),'click',()=>{exportMidi();notify('Your band’s MIDI is ready.');});on($('recipe-save'),'click',()=>{deliver(JSON.stringify(recipe(),null,2),'application/json',`lucky-dreamer-${S.seed}.json`);notify('Recipe saved.');});
on($('recipe-load'),'click',()=>$('recipe-file').click());on($('recipe-file'),'change',async()=>{const file=$('recipe-file').files[0];if(!file)return;try{if(file.size>65536)throw Error('Choose a Lucky Dreamer recipe smaller than 64 KB.');const r=validateRecipe(JSON.parse(await file.text()));remember();applyRecipe(r);notify('Your band is back.');}catch(error){notify(error.message||'That file is not a Lucky Dreamer recipe.');}finally{$('recipe-file').value='';}});
on($('copy'),'click',async()=>{try{await navigator.clipboard.writeText(address());notify('Band address copied.');}catch(_){$('recipe').focus();$('recipe').select();notify('Select and copy this band address.');}});
const keyboardMap={a:60,w:61,s:62,e:63,d:64,f:65,t:66,g:67,y:68,h:69,u:70,j:71,k:72};
on(document,'keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable)return;if(e.key===' '){if(e.target.tagName==='BUTTON')return;e.preventDefault();if(!e.repeat)S.playing?stop():play();return;}const note=keyboardMap[e.key.toLowerCase()];if(note!==undefined&&!e.repeat){e.preventDefault();keyDown(note,'k'+e.code);}});
on(document,'keyup',e=>keyUp('k'+e.code));on(window,'blur',releaseKeys);on(document,'visibilitychange',()=>{if(document.hidden)releaseKeys();});
on(window,'resize',()=>{if(raf)cancelAnimationFrame(raf);raf=requestAnimationFrame(paintScore);});
on(window,'hashchange',()=>{if(skipHash)return;const r=readHash();if(r){remember();applyRecipe(r);}});
on(window,'midiroom:panic',stop);on(window,'midiroom:dispose',destroy);on(window,'pagehide',()=>{try{localStorage.setItem('lucky-dreamer-v1',JSON.stringify(recipe()));}catch(_){}destroy();});
if(window.MidiRoom)window.MidiRoom.declare({name:'Lucky Dreamer',send:[],receive:[]});
window.LuckyDreamer=Object.freeze({version:VERSION,getState:()=>({recipe:recipe(),playing:S.playing,bar:S.bar,time:S.time,mode:S.mode,audioState:S.ctx?S.ctx.state:'uninitialized',destroyed:S.destroyed,stats:clone(S.stats),liveNotes:S.held.size}),getWorld:()=>S.world,compose:LuckyComposer.compose,play:play,stop:stop,seek:seek,setSeed:(seed,options={})=>{remember();S.seed=seed>>>0;S.style=KSTYLES[options.style]?options.style:'';S.roll={};S.locks={};S.bpm=null;rebuild(false);},variant:variant,exportMidi:exportMidi,recipe:recipe,loadRecipe:r=>{remember();applyRecipe(r);},noteOn:(note,owner='api'+note)=>keyDown(note,owner),noteOff:(note,owner='api'+note)=>keyUp(owner),destroy:destroy});
})();
