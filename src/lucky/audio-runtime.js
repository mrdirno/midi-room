/* Author: Aldrin Payopay. Shared worklet/fallback/test transport. */
var luckyOriginalMetalSet=MetalVoice.prototype.set;
var luckySilentTable=new Float32Array(WT_SIZE+1);
MetalVoice.prototype.set=function(p){
  luckyOriginalMetalSet.call(this,p);
  // Mutated metallic ratios can put an oscillator's fundamental above the
  // sample rate. Single-wrap phase accumulation then left its wavetable and
  // emitted NaNs. A component above Nyquist cannot be represented: omit it,
  // rather than folding it down or poisoning the whole mix. Audible partials
  // retain their original tuning, mip and phase behavior.
  for(var i=0;i<this.dt.length;i++)if(this.dt[i]>=0.49){this.dt[i]=0;this.tbl[i]=luckySilentTable;}
};
var luckyOriginalRenderSpan=Engine.prototype.renderSpan;
Engine.prototype.renderSpan=function(L,R,offset,n){
  // Split at the exact loop sample. The original checked the end only after
  // a render segment, making each lap up to 127 samples longer than the score.
  if(this.world&&this.loop){
    var total=this.totalSamples(),until=total-this.clock;
    if(until>=0&&until<n){
      if(until)luckyOriginalRenderSpan.call(this,L,R,offset,until);
      if(this.clock>=total){this.clock=0;this.evIdx=0;}
      luckyOriginalRenderSpan.call(this,L,R,offset+until,n-until);return;
    }
  }
  luckyOriginalRenderSpan.call(this,L,R,offset,n);
};
function LuckyRenderer(sr, tables, post) {
  this.sr=sr;this.tables=tables;this.post=post||function(){};
  var self=this;
  this.tp=new Transport(this.makeEngine(),sr,function(m){self.post(m);},function(){return self.makeEngine();});
  this.live=null;this.liveWorld=null;this.liveNotes={};this.lastFrame=null;
  this.recoveries=0;this.nonFinite=0;this.clamped=0;this.outputPeak=0;this.destroyed=false;
  this.scratch=new Float32Array(4096);this.liveL=new Float32Array(4096);this.liveR=new Float32Array(4096);
  this.endSent=false;
}
LuckyRenderer.prototype.makeEngine=function(){
  var eng=new Engine(this.sr,{tables:this.tables,seed:1});
  // Timing measurements must not silently change a replay's orchestration.
  // If a device cannot keep up, its diagnostic reports that limitation.
  eng.adapt=function(){};
  return eng;
};
LuckyRenderer.prototype.prepareLive=function(world){
  if(this.live)this.live.allOff();this.liveNotes={};this.liveWorld=world;
  var spec=world.roster.filter(function(p){return p.role==='lead';})[0] || world.roster.filter(function(p){return !['kit','perc'].includes(p.engine);})[0];
  if(!spec){this.live=null;return;}
  spec=Object.assign({},spec,{poly:6,level:0.24,pan:0,rev:0,dly:0});
  this.live=new Part(this.sr,makeRng(world.seed^0x67c51),spec,this.tables,this.tp.eng.wheels);
};
LuckyRenderer.prototype.msg=function(m){
  if(this.destroyed||!m)return;
  if(m.type==='prepare'){this.prepareLive(m.world);return;}
  if(m.type==='note'){
    if(!this.live||!Number.isFinite(m.note)||m.note<36||m.note>96)return;
    if(m.on){this.live.noteOff(m.note);this.live.noteOn(m.note,Math.max(0.05,Math.min(1,m.velocity||0.65)),0);this.liveNotes[m.note]=true;}
    else{this.live.noteOff(m.note);delete this.liveNotes[m.note];}
    return;
  }
  if(m.type==='release'){if(this.live)this.live.allOff();this.liveNotes={};return;}
  if(m.type==='destroy'){this.tp.msg({type:'stop'});if(this.live)this.live.allOff();this.liveNotes={};this.destroyed=true;return;}
  if(m.type==='loop'){this.tp.eng.loop=!!m.value;if(this.tp.spare)this.tp.spare.loop=!!m.value;return;}
  if(m.type==='load'||m.type==='swap'){
    this.endSent=false;this.lastFrame=null;
    this.prepareLive(m.world);this.tp.msg(m);
    this.tp.eng.loop=m.loop!==false;if(this.tp.spare)this.tp.spare.loop=m.loop!==false;
    return;
  }
  if(m.type==='stop'){if(this.live)this.live.allOff();this.liveNotes={};}
  this.tp.msg(m);
};
LuckyRenderer.prototype.process=function(L,R,n,frame){
  if(this.destroyed){L.fill(0);R.fill(0);return;}
  // ScriptProcessor can miss wall-clock buffers under main-thread pressure.
  // Seek once to the current musical location rather than firing overdue notes
  // in a burst. AudioWorklet's own sample clock normally has no such gap.
  if(Number.isFinite(frame)&&this.lastFrame!==null&&frame-this.lastFrame>n*2&&this.tp.playing){
    var e=this.tp.xfOn?this.tp.spare:this.tp.eng,w=e.world;
    if(w){var at=e.clock+frame-this.lastFrame;var total=e.totalSamples();if(e.loop)at%=total;else at=Math.min(at,total);e.alignTo(at);this.recoveries++;this.post({type:'recovered',count:this.recoveries});}
  }
  this.lastFrame=Number.isFinite(frame)?frame+n:null;
  this.tp.process(L,R,n);
  if(this.live&&this.live.active()){
    // Tonewheel voices need their clock even when the band is stopped.
    if(!this.tp.playing&&this.live.usesOrgan())this.tp.eng.wheels.stepBlock(n);
    this.liveL.fill(0,0,n);this.liveR.fill(0,0,n);
    this.live.render(this.liveL,this.liveR,n,this.scratch);
    for(var i=0;i<n;i++){L[i]+=this.liveL[i];R[i]+=this.liveR[i];}
  }
  for(var i=0;i<n;i++){
    var l=L[i]*0.70,r=R[i]*0.70;
    if(!Number.isFinite(l)||!Number.isFinite(r)){l=r=0;this.nonFinite++;}
    // Rare live-input overloads are bounded; ordinary scores stay below this.
    if(Math.abs(l)>0.985||Math.abs(r)>0.985)this.clamped++;
    l=Math.max(-0.985,Math.min(0.985,l));r=Math.max(-0.985,Math.min(0.985,r));
    L[i]=l;R[i]=r;this.outputPeak=Math.max(this.outputPeak,Math.abs(l),Math.abs(r));
  }
  var report=this.tp.xfOn?this.tp.spare:this.tp.eng;
  if(this.tp.playing&&report.world&&!report.loop&&report.clock>report.totalSamples()+this.sr*1.5&&!this.endSent){
    this.endSent=true;this.tp.msg({type:'stop'});this.post({type:'ended'});
  }
};
LuckyRenderer.prototype.stats=function(){return {playing:this.tp.playing,clock:this.tp.eng.clock,peak:this.outputPeak,nonFinite:this.nonFinite,clamped:this.clamped,recoveries:this.recoveries,liveNotes:Object.keys(this.liveNotes).length,cpuLoad:this.tp.eng.cpuLoad};};
