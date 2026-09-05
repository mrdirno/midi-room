/* Author: Aldrin Payopay. Lucky Dreamer composition revision 1.
 * Original sound engine, rhythm families and harmonic vocabulary remain intact.
 * New material: bounded voicing search, eight-bar phrase plans and melodic path
 * search. No artist songs, private prompts or external model calls are used.
 */
var LUCKY_COMPOSITION_VERSION = '1.0.0';
var luckyOriginalBand = buildBand;
var luckyOriginalVoiceCell = voiceCell;

function luckyPC(n) { return ((n % 12) + 12) % 12; }
function luckyNearest(pc, target, lo, hi) {
  var best = null, cost = Infinity;
  for (var n = lo; n <= hi; n++) if (luckyPC(n) === luckyPC(pc)) {
    var d = Math.abs(n - target);
    if (d < cost) { cost = d; best = n; }
  }
  return best;
}

// Keep parallel/horn grammars parallel. Only close and shell grammars seek
// inversions. The old routine's register allowance extended an octave beyond
// both bounds, and prev was ignored; both are now part of the actual search.
voiceCell = function (pcs, grammar, lo, hi, prev, rng) {
  var basic = luckyOriginalVoiceCell(pcs, grammar, lo, hi, prev, rng);
  if (['par4', 'par7', 'oct', 'pow', 'brass', 'quart'].indexOf(grammar) >= 0) {
    while (basic.length && Math.max.apply(null, basic) > hi) basic = basic.map(function(n){ return n - 12; });
    return basic.filter(function(n){ return n >= lo && n <= hi; }).sort(function(a,b){ return a-b; });
  }
  var wanted = grammar === 'shell' ? pcs.slice(1, 4) : pcs.slice(0, 4);
  if (!wanted.length) wanted = pcs.slice(0, 1);
  var unique = [];
  wanted.forEach(function(p){ if (unique.indexOf(luckyPC(p)) < 0) unique.push(luckyPC(p)); });
  var best = null, bestCost = Infinity;
  function visit(i, notes) {
    if (i === unique.length) {
      var v = notes.slice().sort(function(a,b){return a-b;});
      for (var j=1;j<v.length;j++) if (v[j]-v[j-1] < (v[j-1] < 55 ? 5 : 2)) return;
      if (v[v.length-1]-v[0] > 23) return;
      var cost=0, mid=(lo+hi)/2;
      for (j=0;j<v.length;j++) {
        var target=prev && prev.length ? prev[Math.min(j,prev.length-1)] : mid + (j-(v.length-1)/2)*4;
        cost+=Math.abs(v[j]-target);
      }
      cost+=Math.max(0,v[v.length-1]-v[0]-16)*0.2;
      if (cost<bestCost) {bestCost=cost;best=v;}
      return;
    }
    for(var n=lo;n<=hi;n++) if(luckyPC(n)===unique[i]) visit(i+1,notes.concat(n));
  }
  visit(0,[]);
  return best || basic.filter(function(n){return n>=lo&&n<=hi;}).sort(function(a,b){return a-b;});
};

var LUCKY_PHRASES = {
  sparse: [
    {t:[0,1.5,2.5,4,5,6], d:[0,0,2,1,-1,0]},
    {t:[0.5,1.5,3,4,4.75,6], d:[0,2,1,0,-1,0]},
    {t:[0,1,2.75,4.5,5.5], d:[0,1,3,2,0]}
  ],
  dance: [
    {t:[0.5,1.5,2.5,3.5,4.5,5.25,6],d:[0,0,2,1,0,-1,0]},
    {t:[0,0.75,1.5,2.5,4,5,6.25],d:[0,1,2,1,0,2,0]},
    {t:[0.5,1,2.5,3,4.5,5.5,6],d:[0,2,1,0,1,3,2]}
  ],
  flowing: [
    {t:[0,0.75,1.5,2.5,3,4,4.75,5.5,6.25],d:[0,1,2,3,2,1,0,-1,0]},
    {t:[0.5,1,1.75,2.5,4,4.75,5.5,6],d:[0,2,1,0,1,3,2,1]},
    {t:[0,1,1.5,2.5,3.25,4.5,5,6],d:[0,-1,0,2,1,0,1,0]}
  ],
  ternary: [
    {t:[0,2/3,5/3,8/3,4,14/3,17/3,6],d:[0,1,2,1,0,2,1,0]},
    {t:[1/3,1,2,10/3,13/3,5,6],d:[0,2,1,0,-1,1,0]},
    {t:[0,1,5/3,3,4,5,17/3,19/3],d:[0,-1,0,2,1,0,1,0]}
  ]
};
function luckyFamily(world) {
  if(world.div===3)return 'ternary';
  if(['knock','trap','drill','crunk','bounce','miami'].indexOf(world.style)>=0)return 'sparse';
  if(['house','dembow','foot','jungle'].indexOf(world.style)>=0)return 'dance';
  return 'flowing';
}
function luckyChord(world, beat) {
  var bar=beat/world.beats, out=world.changes[0];
  for(var i=1;i<world.changes.length;i++) {
    if(world.changes[i].at>bar+1e-7)break;
    out=world.changes[i];
  }
  var pcs=out.pcs && out.pcs.length ? out.pcs.slice() : chordFromRoot(new Key(world.tonic,'aeolian'),out.rs,out.q).pcs;
  return {pcs:pcs.map(luckyPC),q:out.q,rs:out.rs,at:out.at,bars:out.bars};
}
function luckyScale(world, chord) {
  var major = /^(maj|dom)/.test(chord.q) && ['trap','drill','knock','miami','dembow','crunk','bounce'].indexOf(world.style)<0;
  var intervals=major?[0,2,4,5,7,9,10]:[0,2,3,5,7,8,10];
  return intervals.map(function(n){return luckyPC(n+world.tonic);});
}
function luckyPhrasePlan(world, opts) {
  var rolls=opts.roll || {}, variant=(rolls.lead && rolls.lead.p)||0;
  var rng=makeRng((world.seed^Math.imul(variant+1,0x85ebca6b)^0x71a46d29)>>>0);
  var family=luckyFamily(world), pool=LUCKY_PHRASES[family];
  var drawn=rInt(rng,pool.length);
  var baseRng=makeRng((world.seed^Math.imul(1,0x85ebca6b)^0x71a46d29)>>>0);
  var cell=pool[(rInt(baseRng,pool.length)+variant)%pool.length], shift=rInt(rng,3)-1;
  var home=66+rInt(rng,7), phrases=[];
  world.sections.forEach(function(sec,secIndex){
    if(sec.tension<0.6)return;
    for(var bar=0;bar<sec.bars;bar+=2){
      var length=Math.min(2,sec.bars-bar), index=Math.floor(bar/2), cycle=index%4;
      var type=cycle===0||cycle===2?'call':cycle===1?'answer':'close';
      var isLast=secIndex===world.sections.length-1&&bar+length>=sec.bars;
      if(isLast)type='close';
      var lift=sec.name==='B'?2:0;
      var t=cell.t.slice(), degrees=cell.d.map(function(d){return d+shift;});
      if(type==='answer') {
        // Retain the recognizable opening and rhythm, change the closing idea.
        for(var j=Math.ceil(degrees.length/2);j<degrees.length;j++) degrees[j]=Math.round(degrees[j]*0.5)-1;
      }
      if(type==='close') {
        t=t.slice(0,-1);degrees=degrees.slice(0,-1);
        t[t.length-1]=5.5;degrees[degrees.length-1]=-1;
      }
      if(sec.name==='B'&&type==='call'&&family==='flowing'){
        t.splice(2,0,(t[1]+t[2])/2);degrees.splice(2,0,degrees[1]+1);
      }
      var total=length*world.beats, scaled=world.beats/4;
      var notes=[];
      for(j=0;j<t.length;j++) {
        var onset=t[j]*scaled;
        if(onset>=total-1)continue;
        var next=j+1<t.length?Math.min(t[j+1]*scaled,total-0.8):total-1;
        var dur=Math.min(next-onset-0.08, j===t.length-1?1.3:0.88);
        notes.push({beat:onset,desired:home+(degrees[j]+lift)*1.65,duration:Math.max(0.18,dur),anchor:j===0||j===t.length-1||Math.abs(onset%world.beats)<0.01});
      }
      if(notes.length)notes[notes.length-1].anchor=true;
      phrases.push({id:phrases.length,bar:sec.startBar+bar,bars:length,section:sec.name,type:type,motif:family+':'+pool.indexOf(cell),notes:notes,tension:sec.tension,final:isLast});
    }
  });
  return phrases;
}

// Beam search plans a whole phrase. Strong notes belong to the sounding chord;
// weak notes may connect it through the local scale. The objective weighs the
// drawn contour, small intervals, recoveries after leaps and a stable ending.
// This is a heuristic composer, not a learned performance or quality score.
function luckySolvePhrase(world, phrase, previous) {
  var beam=[{cost:0,notes:[],last:previous,delta:0}], origin=phrase.bar*world.beats;
  for(var i=0;i<phrase.notes.length;i++) {
    var spec=phrase.notes[i], chord=luckyChord(world,origin+spec.beat), end=i===phrase.notes.length-1;
    var allowed=spec.anchor?chord.pcs:luckyScale(world,chord).concat(chord.pcs);
    if(end&&phrase.type!=='call')allowed=chord.pcs.slice(0,Math.min(3,chord.pcs.length));
    var candidates=[];
    for(var n=62;n<=83;n++)if(allowed.indexOf(luckyPC(n))>=0)candidates.push(n);
    var next=[];
    beam.forEach(function(path){
      candidates.forEach(function(note){
        var delta=path.last===null||path.last===undefined?0:note-path.last, leap=Math.abs(delta);
        if(i>0&&leap>7)return;
        if(i===0&&previous!==undefined&&previous!==null&&leap>9)return;
        var cost=path.cost+Math.pow((note-spec.desired)/3,2)*0.9;
        if(path.last!==null&&path.last!==undefined)cost+=leap*0.2+Math.max(0,leap-4)*1.9;
        if(i&&leap===0)cost+=0.75;
        if(i>1&&Math.abs(path.delta)>=5&&delta*path.delta>=0)cost+=3;
        if(i>0){
          var contour=spec.desired-phrase.notes[i-1].desired;
          if(Math.abs(contour)>0.5&&contour*delta<0)cost+=1.7;
        }
        if(end&&phrase.type!=='call'){
          if(luckyPC(note)===chord.pcs[0])cost-=1.25;
          cost+=Math.max(0,leap-2)*1.2;
        }
        next.push({cost:cost,notes:path.notes.concat(note),last:note,delta:delta});
      });
    });
    next.sort(function(a,b){return a.cost-b.cost || a.last-b.last;});
    if(!next.length)throw Error('No bounded melodic path');
    // Keep distinct recent paths; one last-note bucket must not consume beam.
    var counts={};beam=next.filter(function(x){var k=x.last+':'+Math.sign(x.delta);counts[k]=(counts[k]||0)+1;return counts[k]<=2;}).slice(0,28);
  }
  return beam[0].notes;
}

function luckyCompose(seed, options) {
  var opts=options||{}, harmTurn=opts.roll&&opts.roll.harm&&opts.roll.harm.p||0;
  if(harmTurn && !(opts.frame&&opts.frame.tonic!==undefined)){
    var initial=buildBeat(seed>>>0,{style:opts.style});
    var keyMoves=[0,2,-2,5,-5,1,-1,3,-3];
    opts=Object.assign({},opts,{frame:Object.assign({},opts.frame||{},{tonic:luckyPC(initial.tonic+keyMoves[harmTurn%keyMoves.length])})});
  }
  var world=luckyOriginalBand(seed>>>0,opts), events=[];
  if(opts.drumsOnly)return world;
  world.compositionVersion=LUCKY_COMPOSITION_VERSION;
  world.events.forEach(function(e){if(e.ln!=='lead'&&e.ln!=='pad')events.push(e);});
  var plan=luckyPhrasePlan(world,opts), previous=null, leadPart=world.laneParts.lead;
  if(leadPart!==undefined)plan.forEach(function(phrase){
    var pitches=luckySolvePhrase(world,phrase,previous);
    phrase.pitches=pitches;
    phrase.notes.forEach(function(n,i){
      // Human timing is a pure coordinate function. It never changes pitch,
      // consumes the sound stream or fills the phrase's deliberate breath.
      var rng=makeRng((world.seed^Math.imul(phrase.id+3,40503)^Math.imul(i+11,2246822519))>>>0);
      var jitter=n.anchor?rng()*0.008:(rng()-0.5)*0.018;
      var t=(phrase.bar*world.beats+n.beat+jitter)*world.div;
      // Articulation closes a note before the next phrase gesture. The first
      // holdout run found many lines occupied over half the whole arrangement
      // even with phrase-end rests; a four-fifths gate preserves their rhythm
      // while making the rests audible on sustained synth voices too.
      var duration=n.duration*world.div*0.8;
      events.push({t:Math.max(0,t),dur:duration,note:pitches[i],vel:Math.min(0.83,(n.anchor?0.64:0.53)*(0.82+0.22*phrase.tension)+(rng()-0.5)*0.045),part:leadPart,slot:-1,ln:'lead',phrase:phrase.id,anchor:n.anchor});
    });
    previous=pitches[pitches.length-1];
  });
  var padPart=world.laneParts.pad, previousPad=null;
  if(padPart!==undefined){
    var roll=opts.roll&&opts.roll.pad, padRng=makeRng((world.seed^Math.imul((roll&&roll.p||0)+1,0xc2b2ae35))>>>0);
    var upper=padRng()>0.5?75:79, padOffset=((roll&&roll.p||0)%2)*world.div*0.5;
    world.changes.forEach(function(ch,ci){
      var end=Math.min(world.bars,ci+1<world.changes.length?world.changes[ci+1].at:world.bars);
      // Split by section too: sparse breakdown and entry remain breathing rooms.
      world.sections.forEach(function(sec){
        var start=Math.max(ch.at,sec.startBar), stop=Math.min(end,sec.startBar+sec.bars);
        if(stop<=start||sec.tension<0.7)return;
        var pcs=luckyChord(world,start*world.beats).pcs;
        var v=voiceCell(pcs,'shell',55,upper,previousPad,padRng).slice(0,3);
        previousPad=v;
        v.forEach(function(note){events.push({t:start*world.steps+padOffset,dur:Math.max(0.3,(stop-start)*world.steps-0.25-padOffset),note:note,vel:0.28,part:padPart,slot:-1,ln:'pad'});});
      });
    });
  }
  // Consistent headroom precedes the inherited limiter. Preserve dry centered
  // bass; reduce pads and long lead releases rather than pushing the master.
  world.roster.forEach(function(part){
    if(part.role==='lead'){part.poly=2;part.level*=0.92;part.dly=Math.min(part.dly,0.14);part.rev=Math.min(part.rev,0.24);}
    if(part.role==='pad'){part.level*=0.78;part.poly=Math.min(part.poly,4);part.rev=Math.min(part.rev,0.3);}
  });
  var endStep=world.bars*world.steps;
  world.events=events.filter(function(e){return Number.isFinite(e.t)&&e.t<endStep&&e.dur>0;}).map(function(e){
    e.t=Math.max(0,e.t);e.dur=Math.min(e.dur,endStep-e.t);e.vel=Math.max(0.001,Math.min(1,e.vel));return e;
  }).sort(function(a,b){return a.t-b.t||a.part-b.part||(a.note||0)-(b.note||0);});
  world.phrases=plan;world.masterGain=0.9;
  return world;
}

function luckyScoreFor(world, settings) {
  settings=settings||{};var muted=settings.mute||{}, solo=settings.solo||null, vol=settings.volume||{};
  var out=Object.assign({},world);
  out.events=world.events.filter(function(e){return !muted[e.ln]&&vol[e.ln]!==0&&(!solo||e.ln===solo);}).map(function(e){
    var part=world.roster[e.part];
    if(part&&part.role!==e.ln&&vol[e.ln]!==undefined){var copy=Object.assign({},e);copy.vel=Math.min(1,e.vel*Math.max(0,Math.min(1.5,vol[e.ln])));return copy;}
    return e;
  });
  out.roster=world.roster.map(function(p){var q=Object.assign({},p);q.level*=vol[p.role]===undefined?1:Math.max(0,Math.min(1.5,vol[p.role]));return q;});
  return out;
}
var LuckyComposer = {version:LUCKY_COMPOSITION_VERSION,compose:luckyCompose,scoreFor:luckyScoreFor,phrasePlan:luckyPhrasePlan,solvePhrase:luckySolvePhrase,chordAt:luckyChord,family:luckyFamily};
