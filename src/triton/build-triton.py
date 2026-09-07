#!/usr/bin/env python3
"""Aldrin Payopay — reproducible, counted repairs of the exact TRITON16 handoff."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parent
project = root.parent.parent
source = root / 'inherited-runtime.html'
provenance = json.loads((root / 'inherited-runtime.provenance.json').read_text())
raw = source.read_bytes()
assert hashlib.sha256(raw).hexdigest() == provenance['public_sha256'], 'Inherited runtime changed; review provenance before building'
html = raw.decode()
patches = []

def replace(old, new, count=1):
    global html
    found = html.count(old)
    if found != count:
        raise RuntimeError(f'Expected {count}, found {found}: {old[:110]}')
    html = html.replace(old, new)
    patches.append({'anchor': old[:110], 'count': count})

# Public faceplate identifies this independent DRINOMAN instrument. Historical
# hardware references remain in its source and explanatory notes.
replace('<h1>KORG TRITON-Rack</h1>', '<h1>TRITON Rack</h1>')
replace('<div class="korg">KORG</div>', '<div class="korg">DRINOMAN</div>')
replace('.logo{position:absolute;right:64px;top:30px;text-align:right;color:var(--print);}', '.logo{position:absolute;right:44px;top:30px;max-width:112px;text-align:right;color:var(--print);}')
replace('.logo .korg{font-weight:800;font-size:26px;letter-spacing:.14em;color:#3d3117;}', '.logo .korg{font-weight:800;font-size:15px;letter-spacing:.06em;color:#3d3117;}')
replace('<div class="model">TRITON-Rack</div>', '<div class="model">TRITON Rack</div>')
replace('.logo .model{font-weight:700;font-size:15px;letter-spacing:.06em;margin-top:2px;}', '.logo .model{font-weight:700;font-size:13px;letter-spacing:.06em;margin-top:2px;}')
replace('No Korg ROM samples or firmware are included — those belong to Korg.', 'This independent DRINOMAN project is not affiliated with Korg. No Korg ROM samples or firmware are included — those belong to Korg.')

replace('let activeVoices=0, voiceList=[]', (root/'transport.js').read_text()+'\nlet activeVoices=0, voiceList=[]')
replace('state.tempo=Math.min(240,Math.max(40,state.tempo+d));', 'TritonTransport.set(Math.min(240,Math.max(40,state.tempo+d)),{reason:"rack tempo control"});')
replace('if(!dreaming) state.tempo=cur.tempo||100;', 'TritonTransport.preference(cur.tempo||100,"factory patch preference");', 2)
replace('state.tempo=cur.tempo||100;', 'TritonTransport.preference(cur.tempo||100,"user patch preference");')
replace('state.tempo=(typeof p.tempo==="number"&&isFinite(p.tempo))? p.tempo : (state.tempo||100);', 'TritonTransport.preference(p.tempo,"Dream song preference");')
replace('if(cur.arpDefault && !dreaming){ Object.assign(state.arp,cur.arpDefault); }\n  else if(!dreaming){ state.arp.on=false; }', '/* Patch preferences never arm or disarm the live arpeggiator. */')
replace('state.arp.on=false; latchSet.clear();\n  syncLeds(); if(dreaming', 'latchSet.clear();\n  syncLeds(); if(dreaming')
replace('if(cur.arpDefault){ Object.assign(state.arp,cur.arpDefault); } else { state.arp.on=false; }', '/* User patches preserve the explicit arpeggiator state too. */')

# Tempo expression is retained in note microtiming and velocity, with a fixed
# bar clock in both implementations (SoulComposer is the active constructor).
replace('bar.bpm = clamp(this.settings.bpm * (1 + shape * this.settings.humanize), 34, 132);', 'bar.bpm = this.settings.bpm; /* transport owns BPM; expression stays in notes */')
replace('bar.bpm=clamp(this.settings.bpm*(1+shape*this.settings.humanize),34,132);', 'bar.bpm=this.settings.bpm; /* transport owns BPM; expression stays in notes */')
replace('var settings=Object.assign({},K.PRESETS.reference,K.LOCKED_PERFORMANCE||{});', 'var settings=Object.assign({},K.PRESETS.reference,K.LOCKED_PERFORMANCE||{},{bpm:state.tempo});')
replace('id="spTempo" type="range" min="34" max="132" value="132"', 'id="spTempo" type="range" min="40" max="240" value="132"')
replace('state.tempo=+bar.bpm.toFixed(2);', '/* A planned bar cannot write shared tempo. */')
replace('settings.mode=p.mode;Object.assign(settings,K.LOCKED_PERFORMANCE||K.PRESETS.reference);', 'settings.mode=p.mode; /* Harmonic character retains tempo and performance controls. */')
replace('settings[key]=isBpm?v:v/100;', 'if(isBpm){TritonTransport.set(v,{reason:"Soul tempo control"});return;}settings[key]=v/100;')
replace('function soulStart(fresh){\n', 'function soulStart(fresh){\n  if(SP.on)return true; /* Proven donor fix: one scheduler per conductor. */\n  SP.startRequest=(SP.startRequest||0)+1;SP.startPending=false;\n')
replace('function soulStop(silent){\n', 'function soulStop(silent){\n  SP.startRequest=(SP.startRequest||0)+1;SP.startPending=false;\n')
replace("if(SP.on){soulStop(false);return;}\n  if(ctx&&ctx.state==='suspended'&&ctx.resume){ctx.resume().then(function(){soulStart(false);});return;}", "if(SP.on||SP.startPending){soulStop(false);return;}\n  if(ctx&&ctx.state==='suspended'&&ctx.resume){var request=(SP.startRequest||0)+1;SP.startRequest=request;SP.startPending=true;ctx.resume().then(function(){if(SP.startRequest===request&&SP.startPending)soulStart(false);},function(ex){if(SP.startRequest===request){SP.startPending=false;setStatus('Audio paused: '+ex.message);}});return;}")
replace("spawnVoice(p,e.pitch,vel,when,dur,SP.pans[role]);SP.diagnostics.notes++;", "var voice=spawnVoice(p,e.pitch,vel,when,dur,SP.pans[role]);if(voice){voice._conductor='soul';}SP.diagnostics.notes++;")
replace("allNotesOff();if(typeof takeStop==='function')takeStop();\n  if(typeof TAKE", "voiceList.slice().forEach(function(v){if(v._conductor==='soul'&&v.kill)v.kill();});if(typeof takeStop==='function')takeStop();\n  if(typeof TAKE")
replace('SP.selfTest=function(){', '''SP.start=soulStart;SP.stop=soulStop;SP.toggle=toggle;SP.chooseCharacter=applyCharacter;SP.chooseScene=selectScene;SP.refreshAudio=applySoulFX;
SP.retime=function(){settings.bpm=state.tempo;if(SP.composer){SP.composer.updateSettings(settings);if(SP.composer.pending)SP.composer.pending.length=0;}
  if(SP.on){SP.generation++;voiceList.slice().forEach(function(v){if(v._conductor==='soul'&&v.kill)v.kill();});SP.clock.stop();SP.clock.start(ctx.currentTime);tick();}syncControls();};
TritonTransport.subscribe(SP.retime);
SP.selfTest=function(){''')

# Adopt the donor's narrowly justified sound-source cancellation repair.
# Sources capture their creation context; live/offline context swaps cannot
# retime an old source. Stop must silence future notes before their onset.
replace('const t=Math.max(when,ctx.currentTime), out=ctx.createGain(); out.gain.value=0;', 'const voiceCtx=ctx,t=Math.max(when,ctx.currentTime),out=ctx.createGain();out.gain.value=0;')
replace('const stops=[], nodes=[];', 'const stops=[],transients=[],nodes=[];')
replace('g.connect(f1); s.start(t); s.stop(t+.3);', 'g.connect(f1); s.start(t); s.stop(t+.3);transients.push(s);')
replace('g.connect(f1); s.start(t); s.stop(t+.1);', 'g.connect(f1); s.start(t); s.stop(t+.1);transients.push(s);')
replace('const n0=Math.max(ctx.currentTime,t); holdEnv(n0);\n    out.gain.setTargetAtTime(0.0001,n0,.02);\n    stops.forEach(s=>{try{s.stop(n0+.12);}catch(e){}});', '''const n0=voiceCtx.currentTime;
    if(n0<t){out.gain.cancelScheduledValues(n0);out.gain.setValueAtTime(0,n0);stops.concat(transients).forEach(s=>{try{s.stop(n0);}catch(e){}});}
    else{holdEnv(n0);out.gain.setTargetAtTime(0.0001,n0,.02);stops.concat(transients).forEach(s=>{try{s.stop(n0+.12);}catch(e){}});}''')
replace('const r=Math.max(.03,prog.aEG.r), tr=Math.max(rt||ctx.currentTime,ctx.currentTime);', 'if(voiceCtx.currentTime<t&&(!rt||rt<t)){v.kill();return;}\n    const r=Math.max(.03,prog.aEG.r), tr=Math.max(rt||voiceCtx.currentTime,voiceCtx.currentTime);')
replace('Math.max(0,(st-ctx.currentTime)*1000)+80);', 'Math.max(0,(st-voiceCtx.currentTime)*1000)+80);')
replace('const v={units,note,t,killed:false,oscs:oscRefs,baseHz,lgP,lfoP:prog.lfo.pitch,_take:_tk||null};', 'const v={units,note,t,killed:false,oscs:oscRefs,baseHz,lgP,lfoP:prog.lfo.pitch,_take:_tk||null,_off:(typeof exporting!=="undefined"&&exporting)};')
replace('if(prog.cat==="DRUMS"){ drumHit(note,vel,when,prog.kit||"std"); return null; }', 'if(prog.cat==="DRUMS"){return drumHit(note,vel,when,prog.kit||"std");}')
a=html.index('function drumHit(note,vel,when,kit){')
b=html.index('\n</script>',a)
drums=html[a:b]
drums=drums.replace('const t=Math.max(when,ctx.currentTime), k=((note%12)+12)%12, o=drumOut();', "const sourceCtx=ctx,sources=[],t=Math.max(when,ctx.currentTime),k=((note%12)+12)%12,o=ctx.createGain();o.connect(drumOut());\n  function tracked(method){const node=sourceCtx[method]();sources.push(node);return node;}")
drums=drums.replace('ctx.createOscillator()',"tracked('createOscillator')").replace('ctx.createBufferSource()',"tracked('createBufferSource')")
drums=drums.replace('v.kill=()=>{ if(!v.killed){ v.killed=true; unreg(v); } };', 'v.kill=()=>{if(!v.killed){v.killed=true;o.gain.cancelScheduledValues(sourceCtx.currentTime);o.gain.setValueAtTime(0,sourceCtx.currentTime);sources.forEach(s=>{try{s.stop(sourceCtx.currentTime);}catch(_){}});unreg(v);}};')
drums=drums.replace('setTimeout(v.kill,1400)', 'setTimeout(v.kill,Math.max(2200,(t-sourceCtx.currentTime)*1000+2200))')
drums=drums.replace('pulseAt(when); return;', 'pulseAt(when); return v;').replace('  pulseAt(when);\n}', '  pulseAt(when); return v;\n}')
html=html[:a]+drums+html[b:]
replace('const v={units:1,t,killed:false};\n  v.kill=()=>{ if(!v.killed){ v.killed=true; unreg(v); } };', '''const v={units:1,t,killed:false,_ctx:ctx};
  v.kill=()=>{if(!v.killed){v.killed=true;
    try{g.gain.cancelScheduledValues(v._ctx.currentTime);g.gain.setValueAtTime(0,v._ctx.currentTime);src.stop(v._ctx.currentTime);}catch(_){}
    unreg(v);}};''',3)

# Replace eager, unscoped Web MIDI ownership with the same route-aware API
# used by the host. Connection is only requested by a real button gesture.
a=html.index('/* ---- Web MIDI in: notes, bend, mod wheel, sustain pedal ---- */')
b=html.index('/*EXPORT-UTILS-BEGIN*/',a)
html=html[:a]+'/* Web MIDI ownership is installed by triton-runtime below. */\n\n'+html[b:]
replace('</head>', '<style>'+ (root/'runtime.css').read_text()+'</style>\n</head>')
replace('<body class="soulMode">', '<body class="soulMode">\n'+(root/'runtime.html').read_text())
extra=(root/'runtime.js').read_text()
adapter=root/'room-target.js'
if adapter.exists(): extra+='\n'+adapter.read_text()
replace('</body>', '<script id="triton-runtime">\n'+extra+'\n</script>\n</body>')
# Keyboard input belongs to instruments, never to text fields or dialogs.
replace('if(e.repeat||e.metaKey||e.ctrlKey||e.altKey) return;', 'if(e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.target.closest?.("input,textarea,select,[contenteditable=true],dialog[open]")) return;')
html=html.replace('ctx.state==="suspended"','(ctx.state==="suspended"||ctx.state==="interrupted")').replace("ctx.state==='suspended'","(ctx.state==='suspended'||ctx.state==='interrupted')")
# Keep source notes in the repository, not in the public instrument document.
html=re.sub(r'<!--(?!\[if)[\s\S]*?-->', '', html)
# ---- persona500 port, 2026-09-05 (persona500 commit 006c8178bf) ------------------
# Ensemble opening scene, major/minor/both colour, a TRITON-kit drummer with rolled
# grooves, and a MIDI out for the Improvisator. These were written on persona500
# against the BUILT triton-rack/improvisator file and vendored there ahead of this
# repo; ported here so the build owns them. They sit after the comment strip so
# every anchor is the built text they were written against, and before the
# title/h1/strong/body/canonical derivation below. Order matters: later hunks use
# KIT, GROOVES, publishNote and settings.colour that earlier hunks introduce. The
# last hunk declares send:['midi'] from data-instrument on <body>, so one patch
# serves both files.
# dist 427-429 -> served 427-434
replace('''.sp-character.on{color:#aef0ff;border-color:#3d839d;background:#0d1a21;}
.sp-label{margin:15px 2px 7px;color:#526b7c;font-size:8px;letter-spacing:.24em;text-transform:uppercase;}
.sp-rack{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:11px;}''',
'''.sp-character.on{color:#aef0ff;border-color:#3d839d;background:#0d1a21;}
.sp-colours{display:flex;gap:7px;flex-wrap:wrap;padding:3px 1px;}
.sp-colour{flex:0 0 auto;min-height:44px;padding:0 15px;border-radius:999px;border:1px solid #243543;
  background:#0d141a;color:#728b9d;font:700 9px/1 -apple-system,"Helvetica Neue",Arial,sans-serif;letter-spacing:.11em;text-transform:uppercase;cursor:pointer;}
.sp-colour.on{color:#ffd7e6;border-color:#8a5070;background:#1a0f15;}
.sp-colour:active{transform:scale(.965);}
.sp-label{margin:15px 2px 7px;color:#526b7c;font-size:8px;letter-spacing:.24em;text-transform:uppercase;}
.sp-rack{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:10px;margin-top:11px;}''')
# dist 567-567 -> served 572-579 (+1 context line for uniqueness)
replace('''    <div class="sp-characters" id="spCharacters"></div>
''',
'''    <div class="sp-characters" id="spCharacters"></div>

    <div class="sp-label">colour · major, minor, or both</div>
    <div class="sp-colours" id="spColours">
      <button class="sp-colour" data-colour="major" type="button">Major</button>
      <button class="sp-colour" data-colour="minor" type="button">Minor</button>
      <button class="sp-colour" data-colour="both" type="button">Best of both</button>
    </div>
''')
# dist 580-586 -> served 592-604
replace('''      </div>
    </div>

    <div class="sp-actions">
      <button class="sp-small" id="spEvolve" type="button" aria-pressed="false">Voice motion off</button>
      <button class="sp-small save" id="spSave" type="button">Save take</button>
      <div id="spSaveDoors" aria-live="polite">PLAY creates one rolling take. Your MIDI or screen-key notes join it.</div>''',
'''      </div>
      <div class="sp-role" data-role="drums">
        <div class="sp-role-head"><span>PERCUSSION</span><span id="spDrumsTag">TRITON</span></div>
        <div class="sp-program"><button class="sp-nav" data-role="drums" data-dir="-1" type="button" aria-label="Previous drum kit">‹</button><div class="sp-progcopy"><b id="spDrumsName">—</b><small id="spDrumsMeta">—</small></div><button class="sp-nav" data-role="drums" data-dir="1" type="button" aria-label="Next drum kit">›</button></div>
      </div>
    </div>

    <div class="sp-actions">
      <button class="sp-small" id="spDrummer" type="button" aria-pressed="false">Drummer off</button>
      <button class="sp-small" id="spRollGroove" type="button">Roll groove</button>
      <button class="sp-small" id="spEvolve" type="button" aria-pressed="false">Voice motion off</button>
      <button class="sp-small save" id="spSave" type="button">Save take</button>
      <div id="spSaveDoors" aria-live="polite">PLAY creates one rolling take. Your MIDI or screen-key notes join it. The drummer plays the TRITON kit in the PERCUSSION slot.</div>''')
# dist 8769-8769 -> served 8787-8801
replace('''  if (f.b > journey * 0.85 + 0.05) return;''',
'''  if (f.b > journey * 0.85 + 0.05) return;
  /* "Both worlds" turns the light between major and minor on its OWN schedule, and
     it has to be decided up here, above the wander gate. Below that gate a mode change
     needs f.b <= 0.305 and then f.d < 0.126 at the default wander — about one section
     in sixty. Measured over 300 sections, simply widening the pool down there crossed
     the family line zero times. A setting you cannot hear is a label, not a setting. */
  var colour = this.settings.colour;
  if (colour === 'both') {
    var g = this.field.at(this.sectionIndex * 11 + 6);
    if (g.a < 0.5) {
      var want = MODE_DEFS[this.mode].family === 'major' ? 'minor' : 'major';
      var cross = MODE_KEYS.filter(function (k) { return MODE_DEFS[k].family === want; });
      this.mode = cross[Math.floor(g.b * cross.length) % cross.length];
    }
  }''')
# dist 8777-8778 -> served 8809-8813
replace('''    var fam = MODE_DEFS[this.mode].family;
    var pool = MODE_KEYS.filter(function (k) { return MODE_DEFS[k].family === fam; });''',
'''    /* Major and minor seal this step too, so a passage cannot drift out of the
       family the visitor chose. Both is left open — it has had its turn above. */
    var fam = (colour === 'major' || colour === 'minor') ? colour : MODE_DEFS[this.mode].family;
    var pool = colour === 'both' ? MODE_KEYS.slice()
             : MODE_KEYS.filter(function (k) { return MODE_DEFS[k].family === fam; });''')
# dist 10885-10892 -> served 10920-10932
replace('''
var SCENES={
  grand:{label:'Grand',bass:'A016',chord:'A016',lead:'A016'},
  tines:{label:'Tines',bass:'A008',chord:'A019',lead:'A021'},
  glass:{label:'Glass',bass:'A048',chord:'A090',lead:'A067'},
  chapel:{label:'Chapel',bass:'A099',chord:'A023',lead:'A071'},
  analog:{label:'Analog',bass:'A103',chord:'A084',lead:'A054'},
  cinema:{label:'Cinema',bass:'A100',chord:'A040',lead:'A126'}''',
'''
/* Ensemble opens the room. Grand is kept because some people want the piano on
   every part, but it must not be the first thing you hear: three roles holding one
   patch reads as a broken rack, not as a choice. Ensemble is an upright bass, a
   grand piano and a nylon guitar — three families, all acoustic. */
var SCENES={
  ensemble:{label:'Ensemble',bass:'A099',chord:'A016',lead:'A031',drums:'A015'},
  grand:{label:'Grand',bass:'A016',chord:'A016',lead:'A016',drums:'A118'},
  tines:{label:'Tines',bass:'A008',chord:'A019',lead:'A021',drums:'A015'},
  glass:{label:'Glass',bass:'A048',chord:'A090',lead:'A067',drums:'A118'},
  chapel:{label:'Chapel',bass:'A099',chord:'A023',lead:'A071',drums:'A063'},
  analog:{label:'Analog',bass:'A103',chord:'A084',lead:'A054',drums:'A062'},
  cinema:{label:'Cinema',bass:'A100',chord:'A040',lead:'A126',drums:'A117'}''')
# dist 10900-10910 -> served 10940-10968
replace('''var ROLE_CATS={bass:['BASS'],chord:['KEYBOARD','PAD','VOX','ORGAN','STRINGS'],lead:['KEYBOARD','BELL','PLUCK','LEAD','STRINGS','BRASS']};
var ROLE_LEVEL={bass:.92,chord:.82,lead:.94};
var ROLE_RELEASE={bass:.30,chord:.68,lead:.46};
var ROLE_DUR={bass:.92,chord:.92,lead:.98};

var settings=Object.assign({},K.PRESETS.reference,K.LOCKED_PERFORMANCE||{},{bpm:state.tempo});
var SP=window.SoulPilot={
  version:'16.0-soul-pilot',on:false,ownsTake:false,seed:seedName(),settings:settings,
  composer:null,clock:null,timer:null,pans:null,panCtx:null,scene:'grand',evolve:false,
  base:{bass:idx('A016'),chord:idx('A016'),lead:idx('A016')},
  active:{bass:idx('A016'),chord:idx('A016'),lead:idx('A016')},''',
'''var ROLE_CATS={bass:['BASS'],chord:['KEYBOARD','PAD','VOX','ORGAN','STRINGS'],lead:['KEYBOARD','BELL','PLUCK','LEAD','STRINGS','BRASS'],drums:['DRUMS']};
var ROLE_LEVEL={bass:.92,chord:.82,lead:.94,drums:.86};
var ROLE_RELEASE={bass:.30,chord:.68,lead:.46,drums:.40};
var ROLE_DUR={bass:.92,chord:.92,lead:.98,drums:.50};
/* The TRITON kits answer note%12, twelve slots from 48 up: drumHit() reads that,
   not a General MIDI map, so these are the only numbers that make a sound. */
var KIT={kick:48,snare:50,rim:51,tomLo:53,tomMid:55,tomHi:57,hat:54,hatOpen:58};
/* Sixteenth-note grids over one 4/4 bar: [step, voice, velocity]. Anything the
   drummer plays is one of these plus a fill, so a rolled groove is always a groove. */
var GROOVES={
  straight:{label:'straight',hits:[[0,'kick',1],[4,'snare',.9],[8,'kick',.86],[12,'snare',.92]],hat:2,hatVel:.42},
  backbeat:{label:'backbeat',hits:[[0,'kick',1],[4,'snare',.94],[7,'kick',.7],[10,'kick',.78],[12,'snare',.95]],hat:2,hatVel:.4},
  halftime:{label:'half time',hits:[[0,'kick',1],[8,'snare',.95],[11,'kick',.66]],hat:4,hatVel:.5},
  brushes:{label:'brushes',hits:[[0,'kick',.8],[4,'rim',.7],[8,'kick',.6],[12,'rim',.74]],hat:2,hatVel:.26},
  broken:{label:'broken',hits:[[0,'kick',1],[3,'kick',.62],[4,'snare',.9],[9,'kick',.8],[12,'snare',.9],[14,'snare',.5]],hat:2,hatVel:.36},
  drive:{label:'drive',hits:[[0,'kick',1],[2,'kick',.6],[4,'snare',.95],[8,'kick',1],[10,'kick',.6],[12,'snare',.95]],hat:1,hatVel:.3}
};
var GROOVE_KEYS=Object.keys(GROOVES);
var FILL=[[8,'tomHi',.8],[10,'tomMid',.84],[12,'tomLo',.88],[14,'snare',.9],[15,'snare',.7]];

/* colour starts on major because that is what the room has always opened in;
   the toggle is the new thing, not a new default sound. */
var settings=Object.assign({},K.PRESETS.reference,K.LOCKED_PERFORMANCE||{},{bpm:state.tempo,colour:'major'});
var SP=window.SoulPilot={
  version:'16.0-soul-pilot',on:false,ownsTake:false,seed:seedName(),settings:settings,
  composer:null,clock:null,timer:null,pans:null,panCtx:null,scene:'ensemble',evolve:false,
  base:{bass:idx('A099'),chord:idx('A016'),lead:idx('A031'),drums:idx('A015')},
  active:{bass:idx('A099'),chord:idx('A016'),lead:idx('A031'),drums:idx('A015')},
  drummer:false,grooveSalt:1,''')
# dist 10958-10958 -> served 11016-11016
replace('''function renderPrograms(){programLabel('bass');programLabel('chord');programLabel('lead');}''',
'''function renderPrograms(){programLabel('bass');programLabel('chord');programLabel('lead');programLabel('drums');}''')
# dist 10977-10977 -> served 11035-11075 (+1 context line for uniqueness)
replace('''  return Object.assign({},SP.active);
}''',
'''  return Object.assign({},SP.active);
}
/* One groove per section, chosen from the seed, so a passage keeps its feel;
   a fill lands on every eighth bar. Rolling changes the salt and nothing else —
   that is the whole mechanic. The room deals you a drummer, you keep what lands. */
function grooveName(bar){return GROOVE_KEYS[hashSeed(SP.seed+':groove:'+SP.grooveSalt+':'+(bar.sectionIndex||0))%GROOVE_KEYS.length];}
function grooveHits(bar,beats){
  var steps=Math.max(4,Math.round(beats*4)),g=GROOVES[grooveName(bar)],out=[],i,h;
  for(i=0;i<g.hits.length;i++){h=g.hits[i];if(h[0]<steps)out.push({step:h[0],voice:h[1],vel:h[2]});}
  if(g.hat)for(i=0;i<steps;i+=g.hat)out.push({step:i,voice:(i%(g.hat*4)===0?'hatOpen':'hat'),vel:g.hatVel*(i%4===0?1:.78)});
  if((bar.globalIndex+1)%8===0)for(i=0;i<FILL.length;i++){h=FILL[i];if(h[0]<steps)out.push({step:h[0],voice:h[1],vel:h[2]});}
  var human=(settings.humanize==null?1:settings.humanize)*0.014;
  return out.map(function(o,n){
    var jitter=(((hashSeed(SP.seed+':swing:'+bar.globalIndex+':'+n)%100)/100)-0.5)*human;
    /* Clamp inside the bar. Human jitter on a step-0 hit goes marginally negative,
       and emitBar drops anything before the downbeat — which silently loses the
       kick and the opening hat, the two hits a listener is most sure of. */
    return {beat:clamp(o.step/4+jitter,0,beats-0.001),note:KIT[o.voice],vel:clamp(o.vel*(0.86+0.14*(settings.motion||0.6)),0.05,0.98)};
  });
}
/* The room's wires carry MIDI, not audio, so this is what makes the Improvisator
   patchable into the TRITON Rack: every melodic note it plays locally also goes out
   as a note-on/note-off pair. Percussion stays home — a kit sent down a wire would
   arrive as whatever single program the far end has selected, which is noise.
   Times are unix-ms because that is the bus clock (bridge.js now()); the bus rejects
   anything more than 16 s ahead, and the Soul Pilot only ever schedules one bar. */
function publishNote(role,pitch,vel,when,dur){
  var mr=window.MidiRoom;if(!mr||typeof mr.emit!=='function')return;
  var n=Math.round(pitch);if(!isFinite(n)||n<0||n>127)return;
  var ch=role==='bass'?0:role==='chord'?1:2,t0=mr.now(),
      on=Math.max(t0,t0+(when-ctx.currentTime)*1000);
  if(on>t0+15000)return;
  var off=Math.min(on+Math.max(60,dur*1000),t0+15800);
  mr.emit({kind:'midi',data:[0x90|ch,n,Math.max(1,Math.min(127,Math.round(vel*127)))],at:on});
  mr.emit({kind:'midi',data:[0x80|ch,n,0],at:off});
}
function drumProgram(patches){
  var i=patches&&patches.drums!=null?patches.drums:SP.base.drums,p=PROGRAMS[i];
  /* A non-kit program here would play pitched notes at 48-58 instead of a kit,
     which is loud and wrong. Silence beats that. */
  return p&&p.cat==='DRUMS'?cleanProgram(i,'drums'):null;
}''')
# dist 10993-10994 -> served 11091-11100
replace('''    var voice=spawnVoice(p,e.pitch,vel,when,dur,SP.pans[role]);if(voice){voice._conductor='soul';}SP.diagnostics.notes++;
  }''',
'''    var voice=spawnVoice(p,e.pitch,vel,when,dur,SP.pans[role]);if(voice){voice._conductor='soul';}SP.diagnostics.notes++;
    publishNote(role,e.pitch,vel,when,dur);
  }
  if(SP.drummer){
    var kit=drumProgram(patches);
    if(kit){var hits=grooveHits(bar,beats);
      for(var d=0;d<hits.length;d++){var hd=hits[d];if(hd.beat<0||hd.beat>=beats||hd.note==null)continue;
        var dv=spawnVoice(kit,hd.note,hd.vel,at+hd.beat*spb,Math.max(.055,spb*ROLE_DUR.drums),null);
        if(dv)dv._conductor='soul';SP.diagnostics.notes++;}}
  }''')
# dist 11042-11042 -> served 11148-11148
replace('''function selectScene(name){var s=SCENES[name];if(!s)return;SP.scene=name;SP.base={bass:idx(s.bass),chord:idx(s.chord),lead:idx(s.lead)};SP.active=Object.assign({},SP.base);''',
'''function selectScene(name){var s=SCENES[name];if(!s)return;SP.scene=name;SP.base={bass:idx(s.bass),chord:idx(s.chord),lead:idx(s.lead),drums:idx(s.drums||'A015')};SP.active=Object.assign({},SP.base);''')
# dist 11046-11046 -> served 11152-11152
replace('''function dealVoices(){var roles=['bass','chord','lead'];roles.forEach(function(role){var list=roleList(role),h=hashSeed(SP.seed+':deal:'+role+':'+Date.now()+':'+Math.random());SP.base[role]=list[h%list.length];SP.active[role]=SP.base[role];});''',
'''function dealVoices(){var roles=['bass','chord','lead','drums'];roles.forEach(function(role){var list=roleList(role),h=hashSeed(SP.seed+':deal:'+role+':'+Date.now()+':'+Math.random());SP.base[role]=list[h%list.length];SP.active[role]=SP.base[role];});''')
# dist 11050-11050 -> served 11156-11169
replace('''  syncControls();renderCharacter(name);setStatus(name+' · performance locked',SP.on?'live':null);}''',
'''  syncControls();syncColourFromMode();renderCharacter(name);setStatus(name+' · performance locked',SP.on?'live':null);}
function renderColour(){document.querySelectorAll('.sp-colour').forEach(function(b){b.classList.toggle('on',b.dataset.colour===settings.colour);});}
function setColour(colour){
  settings.colour=colour;
  var fam=MODE_DEFS[settings.mode].family;
  if(colour==='major'&&fam!=='major')settings.mode='ionian';
  if(colour==='minor'&&fam!=='minor')settings.mode='aeolian';
  if(SP.composer){SP.composer.mode=settings.mode;SP.composer.updateSettings(settings);if(SP.composer.pending)SP.composer.pending.length=0;}
  syncControls();renderColour();
  setStatus(colour==='both'?'both worlds · it may turn either way':(colour+' · '+MODE_DEFS[settings.mode].label.toLowerCase()),SP.on?'live':null);
}
/* Picking a mode or a character by hand is also a statement about colour, so the
   buttons follow it — except on "both", which is a wider choice than either. */
function syncColourFromMode(){if(settings.colour==='both')return;settings.colour=MODE_DEFS[settings.mode].family;renderColour();}''')
# dist 11124-11124 -> served 11243-11249
replace('''document.querySelectorAll('.sp-nav').forEach(function(b){b.addEventListener('click',function(){cycleRole(b.dataset.role,Number(b.dataset.dir));});});''',
'''document.querySelectorAll('.sp-nav').forEach(function(b){b.addEventListener('click',function(){cycleRole(b.dataset.role,Number(b.dataset.dir));});});
document.querySelectorAll('.sp-colour').forEach(function(b){b.addEventListener('click',function(){setColour(b.dataset.colour);});});
$p('spDrummer').addEventListener('click',function(){SP.drummer=!SP.drummer;this.classList.toggle('on',SP.drummer);this.textContent='Drummer '+(SP.drummer?'on':'off');this.setAttribute('aria-pressed',String(SP.drummer));
  setStatus(SP.drummer?'drummer in · '+PROGRAMS[SP.active.drums||SP.base.drums].name:'drummer out',SP.on?'live':null);});
$p('spRollGroove').addEventListener('click',function(){SP.grooveSalt++;
  if(!SP.drummer){SP.drummer=true;var b=$p('spDrummer');b.classList.add('on');b.textContent='Drummer on';b.setAttribute('aria-pressed','true');}
  setStatus('groove rolled · '+GROOVES[grooveName({sectionIndex:SP.composer?SP.composer.sectionIndex:0})].label,SP.on?'live':null);});''')
# dist 11128-11130 -> served 11253-11258
replace('''$p('spMode').addEventListener('change',function(){settings.mode=this.value;if(SP.composer){SP.composer.mode=settings.mode;SP.composer.updateSettings(settings);if(SP.composer.pending)SP.composer.pending.length=0;}$p('spKey').textContent=keyText();});

SP.start=soulStart;SP.stop=soulStop;SP.toggle=toggle;SP.chooseCharacter=applyCharacter;SP.chooseScene=selectScene;SP.refreshAudio=applySoulFX;''',
'''$p('spMode').addEventListener('change',function(){settings.mode=this.value;if(SP.composer){SP.composer.mode=settings.mode;SP.composer.updateSettings(settings);if(SP.composer.pending)SP.composer.pending.length=0;}$p('spKey').textContent=keyText();syncColourFromMode();});

SP.start=soulStart;SP.stop=soulStop;SP.toggle=toggle;SP.chooseCharacter=applyCharacter;SP.chooseScene=selectScene;SP.refreshAudio=applySoulFX;
/* Exposed for the same reason selfTest is: the drummer's timing cannot be checked
   by ear without opening audio, and it can be checked exactly by reading its hits. */
SP.setColour=setColour;SP.grooveName=grooveName;SP.grooveHits=grooveHits;SP.kit=KIT;SP.grooves=GROOVES;''')
# dist 11138-11138 -> served 11266-11268
replace('''  ['bass','chord','lead'].forEach(function(r){if(!roleList(r).length)issues.push('empty '+r+' drawer');});''',
'''  ['bass','chord','lead','drums'].forEach(function(r){if(!roleList(r).length)issues.push('empty '+r+' drawer');});
  Object.keys(SCENES).forEach(function(sn){var dp=PROGRAMS[idx(SCENES[sn].drums)];if(!dp||dp.cat!=='DRUMS')issues.push(sn+' has no kit');});
  if(GROOVE_KEYS.some(function(g){return GROOVES[g].hits.some(function(h){return KIT[h[1]]==null;});}))issues.push('groove names a voice the kit has no note for');''')
# dist 11146-11146 -> served 11276-11276
replace('''populate();selectScene('grand');renderCharacter('reference');syncControls();renderPrograms();SP.composer=new K.Composer(SP.seed,settings);''',
'''populate();selectScene('ensemble');renderCharacter('reference');syncControls();renderColour();renderPrograms();SP.composer=new K.Composer(SP.seed,settings);''')
# dist 11319-11319 -> served 11449-11450
replace('''  sdk.declare({name:document.body.dataset.instrument==='improvisator'?'Improvisator':'TRITON Rack',send:[],receive:['midi']});''',
'''  const improv=document.body.dataset.instrument==='improvisator';
  sdk.declare({name:improv?'Improvisator':'TRITON Rack',send:improv?['midi']:[],receive:['midi']});''')
# ---- end persona500 port ------------------------------------------------------
html=html.replace('</head>','<style>'+(root/'views.css').read_text()+'</style></head>')
html=re.sub(r'<title>.*?</title>', '<title>TRITON Rack · MIDI Room</title>', html,count=1)
replace('<head>', '<head>\n<link rel="canonical" href="https://persona500.com/midi-room/instruments/triton-rack.html">')
out=project/'dist/instruments/triton-rack.html'
out.parent.mkdir(parents=True,exist_ok=True)
html=html.replace('<body class="soulMode">','<body class="soulMode engineOpen" data-instrument="triton-rack">')
out.write_text(html)
improvisator=html.replace('<body class="soulMode engineOpen" data-instrument="triton-rack">','<body class="soulMode" data-instrument="improvisator">').replace('<title>TRITON Rack · MIDI Room</title>','<title>Improvisator · MIDI Room</title>').replace('<h1>TRITON Rack</h1>','<h1>Improvisator ∞</h1>').replace('<strong>TRITON Rack</strong>','<strong>Improvisator</strong>')
improvisator=improvisator.replace('href="https://persona500.com/midi-room/instruments/triton-rack.html"','href="https://persona500.com/midi-room/instruments/improvisator.html"',1)
(project/'dist/instruments/improvisator.html').write_text(improvisator)
proof={'originalSourceSha256':provenance['original_sha256'],'source':source.name,'sourceSha256':hashlib.sha256(raw).hexdigest(),'artifact':str(out.relative_to(project)), 'artifactSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'countedPatches':patches,'donorChanges':['idempotent Soul start','cancel future pitched/drum source audio, including transients'],'notAdopted':['Ensemble conductor','Ensemble sound defaults','LiveKeys UI','unverified history claims']}
(project/'verification').mkdir(exist_ok=True)
(project/'verification/triton-build.json').write_text(json.dumps(proof,indent=2)+'\n')
print(f'Built {out}: {out.stat().st_size} bytes')
