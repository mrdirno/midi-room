/* Author: Aldrin Payopay. Lucky cloud sound bank, revision 1.
 * The original score builder and patch tables stay intact. Sound selection is
 * a later, independent operation: a keys die must not recast the entire band.
 * No DOM, assets, samples, hardware MIDI or network are required here.
 */
var LuckyCloudSoundBank = (function () {
  'use strict';
  var VERSION = '1.0.0';
  var originalBuild = buildBand;
  var originalCapture = kCaptureLane;
  var LANES = ['sub', 'kick', 'snare', 'hat', 'perc', 'aux', 'keys', 'lead', 'pad', 'bass'];
  var PITCHED = ['keys', 'lead', 'pad', 'bass'];
  var PALETTES = [
    { id: 'full', label: 'All colors' },
    { id: 'warm', label: 'Warm / rounded' },
    { id: 'glass', label: 'Glass / struck' },
    { id: 'acoustic', label: 'Wood / breath' },
    { id: 'electric', label: 'Electric / animated' },
    { id: 'airy', label: 'Air / strings' }
  ];
  var FAMILY_LABEL = { analog:'Analog', fm:'FM', tine:'Tine piano', organ:'Organ', station:'Wavetable', solina:'String machine', vox:'Formant voice', pluck:'Plucked string', bowed:'Bowed string', mallet:'Mallet', wind:'Wind', kit:'Drum kit', perc:'Percussion', stack:'Layered' };
  var FAMILY_PALETTES = {
    analog:['warm','electric'], fm:['glass','electric'], tine:['warm','glass'], organ:['warm','electric'],
    station:['electric','airy'], solina:['warm','airy'], vox:['airy'], pluck:['acoustic','glass'],
    bowed:['acoustic','airy'], mallet:['glass','acoustic'], wind:['acoustic','airy']
  };
  var BASS_IDS = ['analog/bass','analog/reso','fm/fmBass','organ/bassOrg','station/bassSt','pluck/bassGt','bowed/cello','wind/clarLo'];
  var KIT_GROUPS = {
    warm:['boombap','softK','ewf','funkK','subBoom','sub808'],
    glass:['neptune','timb','miamiK','houseK','subMiami','sub808'],
    acoustic:['dunK','afroK','latinK','gogoK','lineK','batucadaK','subLog','sub808'],
    electric:['trapK','hyphyK','trapTop','crunkK','bounceK','drillK','footK','knockK','subDrill','subMiami'],
    airy:['cine','softK','jungleK','pianoK','subJungle','subLog']
  };
  var STACK_PALETTES = { brass:['warm','electric'], bell:['glass'], flute:['acoustic','airy'], rhodes:['warm','glass'], pad:['airy'], lead:['electric'], bass:['warm','electric'], strings:['acoustic','airy'] };
  var catalogAll = [], byId = Object.create(null), sourceCache = new Map();
  function own(o,k) { return Object.prototype.hasOwnProperty.call(o,k); }
  function fail(message) { throw new Error('Sound bank: ' + message); }
  function object(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  function keysOnly(o, keys, label) {
    if (!object(o)) fail(label + ' must be an object');
    Object.keys(o).forEach(function(k){ if(keys.indexOf(k)<0 || /^(?:__proto__|prototype|constructor)$/.test(k)) fail('unknown '+label+' field '+k); });
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function integer(n,lo,hi,label) { if(!Number.isInteger(n)||n<lo||n>hi)fail('invalid '+label);return n; }
  function finite(n,lo,hi,label) { if(!Number.isFinite(n)||n<lo||n>hi)fail('invalid '+label);return n; }
  function hash(s) { var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0; }
  function pretty(s) { return s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' '); }
  function add(entry) { byId[entry.id]=entry;catalogAll.push(entry); }

  Object.keys(PATCHES).forEach(function(family){
    // These nine legacy presets need DrumMachine/DrumKit adapters. Part's
    // current dispatcher falls back to AnalogVoice for them; do not advertise
    // that silent substitution as an available instrument.
    if(family==='drumA'||family==='drumK')return;
    Object.keys(PATCHES[family]).filter(function(n){return n!=='_base';}).forEach(function(name){
      var id=family+'/'+name, roles, palettes;
      if(family==='kit'){
        roles=name.indexOf('sub')===0?['sub']:['kick','snare','hat'];
        palettes=Object.keys(KIT_GROUPS).filter(function(p){return KIT_GROUPS[p].indexOf(name)>=0;});
      }else if(family==='perc'){
        roles=['perc','aux'];palettes=name==='brightP'?['glass','electric']:name==='deepP'?['warm','airy']:['warm','acoustic'];
      }else{
        roles=['keys','lead','pad'];if(BASS_IDS.indexOf(id)>=0)roles.push('bass');
        palettes=FAMILY_PALETTES[family]||[];
      }
      add({id:id,label:FAMILY_LABEL[family]+' · '+pretty(name),engine:family,patch:name,roles:roles,palettes:palettes,kind:'patch'});
    });
  });
  Object.keys(STACKS).forEach(function(name){
    add({id:'stack/'+name,label:'Layered · '+pretty(name),engine:STACKS[name].layers[0].engine,patch:STACKS[name].layers[0].patch,
      roles:name==='bass'?['bass']:['keys','lead','pad'],palettes:STACK_PALETTES[name]||[],kind:'stack'});
  });

  function checkLane(lane) { if(LANES.indexOf(lane)<0)fail('unknown lane '+lane); }
  function checkPalette(p) { if(!PALETTES.some(function(x){return x.id===p;}))fail('unknown palette '+p);return p; }
  function catalog(lane,palette) {
    checkLane(lane);palette=checkPalette(palette||'full');
    var entries=catalogAll.filter(function(e){return e.roles.indexOf(lane)>=0&&(palette==='full'||e.palettes.indexOf(palette)>=0);});
    // A palette is a preference, never a request for silence. Each family has
    // an eligible fallback if a later palette lacks this rhythm-section role.
    if(!entries.length)entries=catalogAll.filter(function(e){return e.roles.indexOf(lane)>=0;});
    return entries.map(clone);
  }
  function normalize(config) {
    if(config===undefined||config===null)return {version:VERSION,palette:'full',lanes:{}};
    keysOnly(config,['version','palette','lanes'],'config');
    if(config.version!==VERSION)fail('unsupported version');
    var out={version:VERSION,palette:checkPalette(config.palette),lanes:{}};
    keysOnly(config.lanes||{},LANES,'lane choices');
    Object.keys(config.lanes||{}).forEach(function(lane){
      var id=config.lanes[lane];if(typeof id!=='string'||!own(byId,id)||byId[id].roles.indexOf(lane)<0)fail('ineligible preset for '+lane);
      out.lanes[lane]=id;
    });
    return out;
  }
  function baseOptions(opts) {
    opts=opts||{};var out={};
    if(opts.style!==undefined&&opts.style!==null&&opts.style!==''){
      if(typeof opts.style!=='string'||!own(KSTYLES,opts.style))fail('unknown style');out.style=opts.style;
    }
    if(opts.bpm!==undefined&&opts.bpm!==null)out.bpm=finite(opts.bpm,40,220,'tempo');
    if(opts.frame){
      keysOnly(opts.frame,['style','bpm','tonic'],'tonal frame');out.frame={};
      if(opts.frame.style!==undefined){if(typeof opts.frame.style!=='string'||!own(KSTYLES,opts.frame.style))fail('unknown frame style');out.frame.style=opts.frame.style;}
      if(opts.frame.bpm!==undefined)out.frame.bpm=finite(opts.frame.bpm,40,220,'frame tempo');
      if(opts.frame.tonic!==undefined)out.frame.tonic=integer(opts.frame.tonic,0,11,'frame tonic');
    }
    if(opts.roll){
      keysOnly(opts.roll,LANES.concat('harm'),'roll map');out.roll={};
      Object.keys(opts.roll).forEach(function(lane){keysOnly(opts.roll[lane],['p','s'],'roll');out.roll[lane]={p:integer(opts.roll[lane].p===undefined?0:opts.roll[lane].p,0,1000000,'pattern counter'),s:integer(opts.roll[lane].s===undefined?0:opts.roll[lane].s,0,1000000,'sound counter')};});
    }
    if(opts.mute){keysOnly(opts.mute,LANES,'mute map');out.mute={};Object.keys(opts.mute).forEach(function(lane){if(opts.mute[lane]!==true&&opts.mute[lane]!==false&&opts.mute[lane]!==0&&opts.mute[lane]!==1)fail('invalid mute');out.mute[lane]=!!opts.mute[lane];});}
    if(opts.drumsOnly!==undefined){if(typeof opts.drumsOnly!=='boolean')fail('invalid drums-only flag');out.drumsOnly=opts.drumsOnly;}
    return out;
  }
  function descriptor(seed,opts,config) { var b=baseOptions(opts);delete b.mute;return {seed:seed>>>0,options:b,soundBank:clone(config)}; }
  function orderPool(pool,seed,lane,palette,explicit) {
    var rng=makeRng((seed^hash(lane+'|'+palette+'|bank-v1'))>>>0),groups=Object.create(null),names=[];
    pool.forEach(function(e){var group=e.kind==='stack'?'stack':e.engine;if(!groups[group]){groups[group]=[];names.push(group);}groups[group].push(e);});
    function shuffle(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(rng()*(i+1)),v=a[i];a[i]=a[j];a[j]=v;}return a;}
    shuffle(names);names.forEach(function(n){shuffle(groups[n]);});
    var ordered=[],left=true;
    // Interleave architectures so a Sound roll often changes the physical
    // source of the tone, rather than traversing seven near-neighbor presets.
    while(left){left=false;names.forEach(function(n){if(groups[n].length){ordered.push(groups[n].shift());left=true;}});}
    if(explicit){ordered=ordered.filter(function(e){return e.id!==explicit;});ordered.unshift(byId[explicit]);}
    // Some inherited kits share an identical snare or top-end voice. Keep all
    // source IDs available for direct selection, but a Sound die should not
    // spend a turn on the same oscillator/envelope wearing another kit name.
    var seen=Object.create(null);
    return ordered.filter(function(e){
      var key=e.id;
      if(e.engine==='kit'&&SLOT_FIELDS[lane]){
        var p=getPatch('kit',e.patch);
        key=JSON.stringify(SLOT_FIELDS[lane].map(function(field){return p[field];}));
      }
      if(seen[key])return false;seen[key]=true;return true;
    });
  }
  function choose(seed,lane,opts,config) {
    var count=opts.roll&&opts.roll[lane]?opts.roll[lane].s||0:0;
    var pool=orderPool(catalog(lane,config.palette),seed,lane,config.palette,config.lanes[lane]);
    return {entry:pool[count%pool.length],count:count,cycle:Math.floor(count/pool.length),rng:makeRng((seed^hash(lane+'|'+config.palette+'|'+count+'|detail-v1'))>>>0)};
  }
  function partOf(world,lane){var id=world.laneParts[lane];for(var i=0;i<world.roster.length;i++)if(world.roster[i].id===id)return world.roster[i];return null;}
  function cookedPatch(engine,name,rng) {
    // Existing architecture and calibrated gain are kept. Small deterministic
    // detail changes use the inherited legal parameter ranges, not raw noise.
    return mutatePatch(getPatch(engine,name),rng,0.18);
  }
  var SLOT_FIELDS={kick:['kick','toms'],snare:['snare','clap'],hat:['hatC','hatO','ride'],sub:['kick']};
  var SLOT_NUMBERS={kick:[0,5,6,7],snare:[1,8],hat:[2,3,4],sub:[0]};
  function mergeKitLane(part,source,lane,sourceName) {
    var target=part.p, oldName=target.__name||part.patch;
    SLOT_FIELDS[lane].forEach(function(k){target[k]=clone(source[k]);});
    var fromTrim=KIT_TRIM[sourceName]||[],toTrim=KIT_TRIM[oldName]||[];
    var gainRatio=(source.gain||1)/(target.gain||1)*trimFor('kit',sourceName)/trimFor('kit',part.patch);
    SLOT_NUMBERS[lane].forEach(function(i){
      // Kit.setPatch applies its original per-slot trim later. Cancel that
      // trim and transfer the selected voice's measured trim on this slot only.
      target.lvl[i]=source.lvl[i]*(fromTrim[i]||1)/(toTrim[i]||1)*gainRatio*0.88;
    });
  }
  function voicePart(part,pick,lane) {
    var e=pick.entry,p=clone(part);p.engine=e.engine;p.patch=e.patch;
    p.p=cookedPatch(e.engine,e.patch,pick.rng);p.layers=null;
    if(e.kind==='stack'){
      var stack=STACKS[e.id.slice(6)],energy=Math.sqrt(stack.layers.reduce(function(n,l){return n+l.level*l.level;},0));
      p.layers=stack.layers.map(function(l,i){return {engine:l.engine,patch:l.patch,p:i===0?p.p:cookedPatch(l.engine,l.patch,pick.rng),level:l.level/energy,detune:l.detune||0,oct:l.oct||0,pan:l.pan||0,spread:l.spread,panSpread:l.panSpread};});
      p.credit=stack.credit;
    }
    p.poly=lane==='bass'?1:lane==='lead'?2:4;
    p.level=part.level*0.78;p.rev=Math.min(part.rev||0,lane==='pad'?0.25:0.2);p.dly=Math.min(part.dly||0,0.1);p.chorus=Math.min(part.chorus||0,0.25);
    if(lane==='bass'){
      p.pan=0;p.rev=0;p.dly=0;p.chorus=0;
      p.strip=Object.assign({},p.strip,{hp:25,width:1,monoBelow:180,lo:0,mid:0,hi:0});
      if(p.layers)p.layers.forEach(function(l){l.pan=0;l.spread=0;l.panSpread=0;});
    }
    return p;
  }
  function apply(world,seed,opts) {
    opts=opts||{};seed=integer(seed,0,4294967295,'seed');var config=normalize(opts.soundBank),out=Object.assign({},world);
    opts=Object.assign({},baseOptions(opts),{soundBank:config,locks:opts.locks});
    out.roster=world.roster.map(clone);out.events=world.events.map(clone);
    var source=descriptor(seed,opts,config),info={version:VERSION,palette:config.palette,lanes:{},sources:{}};
    LANES.forEach(function(lane){
      var part=partOf(out,lane);if(!part)return;
      var locked=opts.locks&&opts.locks[lane],pick;
      if(locked){
        var kept=validateCapture(locked,lane),saved=kept.bankPart;
        if(SLOT_FIELDS[lane]&&lane!=='sub'){
          SLOT_FIELDS[lane].forEach(function(k){part.p[k]=clone(saved.p[k]);});
          SLOT_NUMBERS[lane].forEach(function(i){part.p.lvl[i]=saved.p.lvl[i];});
        }else{var restored=clone(saved);restored.id=part.id;out.roster[out.roster.indexOf(part)]=restored;part=restored;}
        // The inherited drummer applies a later seed-dependent accent pass
        // even to captured hits. Restore all lanes after that pass; keeping a
        // kick must keep its velocity as exactly as keeping a melody's pitch.
        out.events=out.events.filter(function(e){return e.ln!==lane;});
        if(!(opts.mute&&opts.mute[lane]))kept.events.forEach(function(e){out.events.push(Object.assign({},e,{part:part.id,ln:lane}));});
        info.lanes[lane]=clone(kept.bankChoice);info.sources[lane]=clone(kept.bankSource);return;
      }
      pick=choose(seed,lane,opts,config);
      if(PITCHED.indexOf(lane)>=0){out.roster[out.roster.indexOf(part)]=voicePart(part,pick,lane);}
      else if(lane==='sub'){
        part.p=getPatch('kit',pick.entry.patch);part.patch=pick.entry.patch;part.level*=0.86;part.pan=0;part.rev=0;part.dly=0;
      }else if(lane==='perc'||lane==='aux'){
        part.p=getPatch('perc',pick.entry.patch);part.patch=pick.entry.patch;part.level*=0.86;
      }else{mergeKitLane(part,getPatch('kit',pick.entry.patch),lane,pick.entry.patch);}
      info.lanes[lane]={id:pick.entry.id,label:pick.entry.label,counter:pick.count};info.sources[lane]=clone(source);
    });
    if(opts.locks&&Object.keys(opts.locks).length)out.events.sort(function(a,b){return a.t-b.t||a.part-b.part||(a.note||0)-(b.note||0);});
    info.originalBandCredit=world.bandCredit;
    info.credit='Existing synthesis presets and layer stacks; sound palette '+config.palette+'. Rhythm and harmonic source credits are unchanged.';
    out.soundBank=info;return out;
  }
  function build(seed,opts) {
    opts=opts||{};seed=integer(seed,0,4294967295,'seed');var clean=baseOptions(opts),config=normalize(opts.soundBank),locks={};
    if(opts.locks){keysOnly(opts.locks,LANES,'locks');Object.keys(opts.locks).forEach(function(lane){locks[lane]=validateCapture(opts.locks[lane],lane);});clean.locks=locks;}
    // The old keys sound RNG also chooses the ensemble. Zero only the sound
    // counters in score generation; preserve every pattern/harmony counter.
    if(clean.roll)Object.keys(clean.roll).forEach(function(lane){clean.roll[lane].s=0;});
    var world=originalBuild(seed,clean);
    return apply(world,seed,Object.assign({},baseOptions(opts),{soundBank:config,locks:locks}));
  }
  function boundedEvents(events,lane,maxStep) {
    if(!Array.isArray(events)||events.length>8192)fail('invalid captured event count');
    return events.map(function(e){
      keysOnly(e,['t','dur','note','vel','slot','slide'],'captured event');
      // The original humanizer can anticipate the first downbeat and accents
      // can exceed nominal MIDI velocity. Keep those gestures; equality with
      // the regenerated source below is the authority, not clipping the score.
      var o={t:finite(e.t,-1,maxStep,'event time'),dur:finite(e.dur,0.000001,maxStep,'event duration')};
      if(e.note!==undefined)o.note=finite(e.note,-1,127,'note');
      o.vel=finite(e.vel,0,1.25,'velocity');o.slot=integer(e.slot,-1,21,'slot');
      if(PITCHED.indexOf(lane)>=0&&o.slot!==-1)fail('pitched lane has a drum slot');
      if(e.slide!==undefined)o.slide=finite(e.slide,0,4,'slide');
      return o;
    });
  }
  function sourceWorld(source) {
    keysOnly(source,['seed','options','soundBank'],'captured source');integer(source.seed,0,4294967295,'captured seed');
    keysOnly(source.options||{},['style','bpm','frame','roll','drumsOnly'],'source options');
    var options=baseOptions(source.options),config=normalize(source.soundBank),normalized={seed:source.seed,options:options,soundBank:config};
    var key=JSON.stringify(normalized);if(key.length>8192)fail('captured recipe is too large');
    if(sourceCache.has(key))return {source:normalized,world:sourceCache.get(key)};
    var world=build(source.seed,Object.assign({},options,{soundBank:config}));
    sourceCache.set(key,world);if(sourceCache.size>32)sourceCache.delete(sourceCache.keys().next().value);
    return {source:normalized,world:world};
  }
  function validateCapture(frame,lane) {
    checkLane(lane);keysOnly(frame,['events','sound','bankVersion','bankSource','bankPart','bankChoice'],'capture');
    if(frame.bankVersion!==VERSION)fail('captured sound needs a versioned source recipe');
    var regenerated=sourceWorld(frame.bankSource),part=partOf(regenerated.world,lane);
    if(!part)fail('captured source has no '+lane+' lane');
    var maxStep=regenerated.world.bars*regenerated.world.steps*2;
    var events=boundedEvents(frame.events,lane,maxStep);
    var legacy=originalCapture(regenerated.world,lane);
    var expected=boundedEvents(legacy.events,lane,maxStep);
    if(JSON.stringify(events)!==JSON.stringify(expected))fail('captured events differ from their source recipe');
    // Never trust persisted gain, envelope, engine or raw patch fields. Rebuild
    // them from the small validated source recipe, including its articulation.
    return {events:events,sound:legacy.sound,bankVersion:VERSION,bankSource:regenerated.source,bankPart:clone(part),bankChoice:clone(regenerated.world.soundBank.lanes[lane])};
  }
  function capture(world,lane) {
    checkLane(lane);if(!world.soundBank||!world.soundBank.sources[lane])fail('lane has no sound-bank source');
    // A muted lane still has its source pattern. Capturing that recipe keeps
    // its notes when it is unmuted, rather than turning a mute into deletion.
    var frame=originalCapture(sourceWorld(world.soundBank.sources[lane]).world,lane);
    return {events:frame.events,bankVersion:VERSION,bankSource:clone(world.soundBank.sources[lane])};
  }
  return Object.freeze({version:VERSION,palettes:PALETTES.map(clone),catalog:catalog,normalize:normalize,build:build,apply:apply,capture:capture,validateCapture:validateCapture,
    inventory:function(){return {supportedPresets:catalogAll.filter(function(e){return e.kind==='patch';}).length,existingStacks:catalogAll.filter(function(e){return e.kind==='stack';}).length,unsupportedLegacy:['drumA/eight','drumA/nine','drumA/boom','drumA/tight','drumA/deep','drumK/studio','drumK/jazzK','drumK/roomK','drumK/deepK']};}});
})();
