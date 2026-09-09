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
# ---- wishes a80f6280 / 5ab162f7: "those noise styled drums suck ... they sound like noise" ----
# Measured before the change, rendering the real drumHit() through a real OfflineAudioContext
# in headless Chromium, against a white-noise control put through the same window:
#     snare   centroid 12063 Hz  high-band 0.937  low-band 0.025
#     control centroid 12127 Hz  high-band 0.923  low-band 0.011
# The snare was, numerically, the control: a single triangle at 0.5*vel buried under a
# HIGHPASS-1700 noise at 0.8*vel, unbounded to Nyquist. A snare is a head with two audible
# modes plus wires, and the wires are band-limited — they are not hiss.
# The toms measured 0.000 energy above 2 kHz: a bare sine with no stick at all, which is why
# they read as a synth blip rather than a struck skin.
replace('''  else if(k===2||k===1){ const os=ctx.createOscillator(); os.type="triangle";
    os.frequency.setValueAtTime(ana?180:196,t); os.frequency.exponentialRampToValueAtTime(ana?140:150,t+.08);
    const og=ctx.createGain(); og.gain.setValueAtTime(.5*vel,t); og.gain.setTargetAtTime(0,t,ana?.04:.05);
    os.connect(og); og.connect(o); os.start(t); os.stop(t+.3);
    const sn=noise(), bp=ctx.createBiquadFilter(); bp.type="highpass"; bp.frequency.value=ana?1400:1700;
    g.gain.setValueAtTime(.8*vel,t); g.gain.setTargetAtTime(0,t+.002,.07);
    sn.connect(bp); bp.connect(g); sn.start(t); sn.stop(t+.4); }''',
'''  else if(k===2||k===1){
    /* head: the fundamental, and the second mode a fifth above it that makes a drum sound
       tuned rather than thudded. Both drop in pitch as the skin relaxes. */
    tone(ana?180:196, ana?140:150, .085, .70*vel, "triangle");
    tone(ana?312:332, ana?280:300, .05,  .34*vel, "triangle");
    /* wires: a broad band where a real snare carries its rattle, plus a narrower sheen on
       top. Band-limited on purpose — the old highpass let everything up to Nyquist through,
       which is the definition of hiss. */
    nz(ana?3100:3600, .075, .40*vel, .7);
    nz(ana?5600:6400, .045, .20*vel, 1.6);
    /* the stick hitting the head, before either of the above has moved */
    nz(ana?1200:1400, .012, .30*vel, 1.1); }''')
replace('''  else if(k===5||k===7||k===9){ const f=k===5?95:k===7?135:190; const os=ctx.createOscillator(); os.type="sine";
    os.frequency.setValueAtTime(f*1.6,t); os.frequency.exponentialRampToValueAtTime(f,t+.12);
    g.gain.setValueAtTime(.9*vel,t); g.gain.setTargetAtTime(0,t+.004,ana?.15:.12);
    os.connect(g); os.start(t); os.stop(t+.7); }''',
'''  else if(k===5||k===7||k===9){ const f=k===5?95:k===7?135:190; const os=ctx.createOscillator(); os.type="sine";
    os.frequency.setValueAtTime(f*1.6,t); os.frequency.exponentialRampToValueAtTime(f,t+.12);
    g.gain.setValueAtTime(.9*vel,t); g.gain.setTargetAtTime(0,t+.004,ana?.15:.12);
    os.connect(g); os.start(t); os.stop(t+.7);
    /* stick and shell. The pitch drop was already right; what was missing was any evidence
       that something hard hit something hollow. */
    nz(f*13, .018, .30*vel, 1.1);
    tone(f*2.7, f*2.4, .05, .16*vel, "sine"); }''')
# ---- end drum voices ----------------------------------------------------------

# The counted snare/tom repairs run HERE, before the block below rewrites
# ctx.createOscillator() to tracked(...) inside drumHit — after that rewrite the pinned
# anchors no longer exist. New oscillators added here are picked up by that same rewrite,
# so they are tracked and killed with the voice like every other one.
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

    <div class="sp-label">colour · minor is the sad one</div>
    <div class="sp-colours" id="spColours">
      <button class="sp-colour" data-colour="major" type="button">Major</button>
      <button class="sp-colour" data-colour="minor" type="button">Minor</button>
      <button class="sp-colour" data-colour="both" type="button">Best of both</button>
    </div>
''')

# A visitor wished the room was sadder. It already can be: tapping Minor takes it
# from 38.4% to 47.5% sad-sounding chords, and the mood chip called "procession"
# reaches 67.1% (25 seeds x 64 bars, counted off the built page). Nothing on screen
# said so. Both patches below move WORDS ONLY — no default, no interval, no tempo
# changes, and the same measurement must read 38.4/47.5/67.1 after the build.

# The mood row's caption described what these chips leave alone and never what they
# do. It now names the thing the visitor was looking for.
replace('<div class="sp-label">harmonic character · performance and mix stay pinned</div>',
        '<div class="sp-label">mood · sad or bright · your tempo and mix stay put</div>')

# The chips printed their own internal key — the row read "reference still luminous
# nocturne drift vigil ascent procession", so a stranger had to guess which of eight
# invented words was the sad one. MODE_DEFS already carries a family for every mode,
# so the gloss is read from the data rather than invented, and the author's names all
# survive. Family, not the mode name: "phrygian" tells a musician something and tells
# everyone else nothing, and the question asked was which ones are sad.
replace("b.dataset.character=k;b.textContent=k;",
        "b.dataset.character=k;b.textContent=k+' · '+(K.MODE_DEFS[K.PRESETS[k].mode].family==='minor'?'sad':'bright');")
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

# ---- wish 83d41a5c: Save said "Render failed: Load failed" after a good render ----
# The render already holds every byte as a Blob. prepareRenderedFiles threw that away and
# fetch()ed the blob: URL back instead — asking the network for a file that was already in
# memory. fetch() is governed by connect-src, and persona500 serves
# "connect-src 'self' https: ws: wss:" with no blob:; default-src's blob: does NOT fill in
# for a directive that is present. So every WAV/ZIP save ended in "Render failed: Load failed"
# (WebKit) / "Failed to fetch" (Chromium) after a render that had fully succeeded.
# Keeping the Blob costs nothing — it is the same object the URL already points at — and it
# makes Save work under any connect-src, including a host we do not control.
# The blob: URLs stay: the download chips are <a download href="blob:...">, which default-src
# allows, and they were never the failing half.
replace('''  if(!SAVE_OUT) SAVE_OUT={name,wavUrl:null,midUrl:null,zipUrl:null};
  SAVE_OUT.midUrl=URL.createObjectURL(new Blob([mid],{type:"audio/midi"}));''',
'''  if(!SAVE_OUT) SAVE_OUT={name,wavUrl:null,midUrl:null,zipUrl:null,wavBlob:null,midBlob:null,zipBlob:null};
  SAVE_OUT.midBlob=new Blob([mid],{type:"audio/midi"});
  SAVE_OUT.midUrl=URL.createObjectURL(SAVE_OUT.midBlob);''')
replace('''  SAVE_OUT={ name,
    wavUrl:wavBytes? URL.createObjectURL(new Blob([wavBytes],{type:"audio/wav"})) : null,
    midUrl:mid? URL.createObjectURL(new Blob([mid],{type:"audio/midi"})) : null,
    zipUrl:zipBlob? URL.createObjectURL(zipBlob) : null };''',
'''  const savWav=wavBytes? new Blob([wavBytes],{type:"audio/wav"}) : null,
        savMid=mid? new Blob([mid],{type:"audio/midi"}) : null;
  SAVE_OUT={ name, wavBlob:savWav, midBlob:savMid, zipBlob:zipBlob||null,
    wavUrl:savWav? URL.createObjectURL(savWav) : null,
    midUrl:savMid? URL.createObjectURL(savMid) : null,
    zipUrl:zipBlob? URL.createObjectURL(zipBlob) : null };''')
replace("""  if(SAVE_OUT.wavUrl)jobs.push(fetch(SAVE_OUT.wavUrl).then(function(r){return r.blob();}).then(function(b){SP.prepared.wav=preparedItem(b,'wav',outputName('.wav'));}));
  if(SAVE_OUT.midUrl)jobs.push(fetch(SAVE_OUT.midUrl).then(function(r){return r.blob();}).then(function(b){SP.prepared.mid=preparedItem(b,'mid',outputName('.mid'));}));
  if(SAVE_OUT.zipUrl)jobs.push(fetch(SAVE_OUT.zipUrl).then(function(r){return r.blob();}).then(function(b){SP.prepared.zip=preparedItem(b,'zip',outputName('-session.zip'));}));""",
"""  /* Blob first, network never. The fetch arm survives only for a SAVE_OUT built by an
     older copy of this page still sitting in a service-worker cache. */
  function blobOrFetch(blob,url){return blob?Promise.resolve(blob):(url?fetch(url).then(function(r){return r.blob();}):null);}
  var jWav=blobOrFetch(SAVE_OUT.wavBlob,SAVE_OUT.wavUrl);if(jWav)jobs.push(jWav.then(function(b){SP.prepared.wav=preparedItem(b,'wav',outputName('.wav'));}));
  var jMid=blobOrFetch(SAVE_OUT.midBlob,SAVE_OUT.midUrl);if(jMid)jobs.push(jMid.then(function(b){SP.prepared.mid=preparedItem(b,'mid',outputName('.mid'));}));
  var jZip=blobOrFetch(SAVE_OUT.zipBlob,SAVE_OUT.zipUrl);if(jZip)jobs.push(jZip.then(function(b){SP.prepared.zip=preparedItem(b,'zip',outputName('-session.zip'));}));""")
# ---- end wish 83d41a5c --------------------------------------------------------
# ---- wish 83d41a5c, second half: a FAILED render was reported as "mix ready · tap Save" ----
# exportTake catches its own exception and returns normally, so doExport's catch never fires on a
# failed render. doExport then ran prepareRenderedFiles()/renderDownloads() over the PREVIOUS
# take's SAVE_OUT and set "mix ready · tap Save" — the transient "RENDER FAILED" that setSaveUI
# mirrors into #spSaveDoors is painted over by renderDownloads() in the same turn. Measured on
# production bytes with renderPass forced to return null: status "mix ready · tap Save" and two
# working download buttons carrying the earlier take's audio, byte-identical to a successful
# render. That is the wisher's complaint pointing the other way.
# The signal is made explicit and FAIL-CLOSED: only the path that actually assigns SAVE_OUT
# returns true, so every early return in exportTake — the failure, the already-rendering race,
# and "nothing to save" — reads as "no file was produced". doExport says so and stops.
replace('''  if(!(window.SoulPilot&&window.SoulPilot.exportBusy)){
    if(SAVE_OUT.zipUrl) auto(SAVE_OUT.zipUrl,name+"-session.zip");
    else{ auto(SAVE_OUT.wavUrl,name+".wav");
      if(SAVE_OUT.midUrl) setTimeout(()=>auto(SAVE_OUT.midUrl,name+".mid"),450); }
  }
}''',
'''  if(!(window.SoulPilot&&window.SoulPilot.exportBusy)){
    if(SAVE_OUT.zipUrl) auto(SAVE_OUT.zipUrl,name+"-session.zip");
    else{ auto(SAVE_OUT.wavUrl,name+".wav");
      if(SAVE_OUT.midUrl) setTimeout(()=>auto(SAVE_OUT.midUrl,name+".mid"),450); }
  }
  return true;  /* the only exit that produced a file; every other return is a failure */
}''')
replace("""  try{await exportTake(kind,'take');await prepareRenderedFiles();renderDownloads();""",
"""  try{if(!await exportTake(kind,'take')){host.textContent='Render failed — nothing was saved. Try Save again.';setStatus('render failed');return;}
  await prepareRenderedFiles();renderDownloads();""")
# ---- end wish 83d41a5c, second half -------------------------------------------

# ---- wish 5ab162f7: "saving should save a full song length 3:20 ... give user option of length" ----
# Measured before the change: the save renders exactly what you sat and listened to — length
# comes from the last event in TAKE.ev plus a 2.6 s tail, not from any constant. Held PLAY for
# 0 s -> 8 notes / 2.77 s; 200 s -> 714 notes / 202.53 s. There was no length control anywhere.
# Neither hard part needed building. The render is ALREADY an offline bounce (renderPass sizes
# its OfflineAudioContext from the events it is handed), and the composer already sustains any
# length without repeating — 614 distinct bars over 20 minutes, written in 28 ms. What was
# missing was a way to ask for a song and a way to write it down without playing it, and
# spawnVoice has done the second since round 10: under DRY it logs to the take and returns
# before making a sound. So this composes the song, hands it to the bounce, and puts the live
# take back. 480 s is the ceiling because takeTrim() keeps a rolling 8 minutes.
replace('''      <button class="sp-small save" id="spSave" type="button">Save take</button>
      <div id="spSaveDoors" aria-live="polite">PLAY creates one rolling take. Your MIDI or screen-key notes join it. The drummer plays the TRITON kit in the PERCUSSION slot.</div>''',
'''      <button class="sp-small save" id="spSave" type="button">Save take</button>
      <label class="sp-small" for="spLength" style="display:inline-flex;gap:.4em;align-items:center;">Length
        <select id="spLength" style="font:inherit;padding:.15em .3em;">
          <option value="0">as played</option>
          <option value="60">1:00</option>
          <option value="120">2:00</option>
          <option value="200" selected>3:20</option>
          <option value="300">5:00</option>
          <option value="480">8:00</option>
        </select></label>
      <div id="spSaveDoors" aria-live="polite">PLAY creates one rolling take. Your MIDI or screen-key notes join it. The drummer plays the TRITON kit in the PERCUSSION slot. Save writes a whole song at the length you pick — it renders faster than it plays.</div>''')
replace("""$p('spSave').addEventListener('click',saveDoors);""",
"""$p('spSave').addEventListener('click',saveDoors);
SP.renderSeconds=Number($p('spLength').value)||0;
$p('spLength').addEventListener('change',function(){SP.renderSeconds=Number(this.value)||0;});""")
# emitBar's two wall-clock arms must not fire while the song is being written down: queueUI
# arms a setTimeout at (at - ctx.currentTime)*1000, so composing 200 s in a tight loop would
# schedule ~104 timers firing up to 200 s into the future, and pumpComposer would defer the
# very work the loop is waiting on. nextBar() generates a section synchronously when the
# queue is empty, so skipping the pump costs nothing. This is the same guard the Dream side
# has carried since round 10.
replace('''  if(SP.pendingFx){var g=SP.generation;setTimeout(function(){if(g===SP.generation)applySoulFX();},Math.max(0,(at-ctx.currentTime)*1000));SP.pendingFx=false;}''',
'''  if(SP.pendingFx&&!(typeof DRY!=="undefined"&&DRY)){var g=SP.generation;setTimeout(function(){if(g===SP.generation)applySoulFX();},Math.max(0,(at-ctx.currentTime)*1000));SP.pendingFx=false;}''')
replace('''  queueUI(at,bar,patches);pumpComposer();return barLen;''',
'''  if(!(typeof DRY!=="undefined"&&DRY)){queueUI(at,bar,patches);pumpComposer();}
  return barLen;''')
# The render percentage was being written into #ldrSaveLbl, which lives inside #ldrScale, which
# body.soulMode hides. On a 3:20 render that left "RENDERING" frozen with no sign of life.
replace('''function setSaveUI(t){
  const e=document.getElementById("ldrSaveLbl");''',
'''function setSaveUI(t){
  /* mirror into the Improvisator's own save area: #ldrSaveLbl sits inside #ldrScale, and
     body.soulMode hides that, so this text was invisible on the page that renders longest. */
  if(t){ const sd=document.getElementById("spSaveDoors"); if(sd&&document.body.classList.contains("soulMode")) sd.textContent=t; }
  const e=document.getElementById("ldrSaveLbl");''')
replace('''var _exportTake=exportTake;exportTake=async function(kind,src){
  if(!SP.ownsTake)return _exportTake(kind,src);
  var oldP=DREAM.p,oldSeed=DREAM.seed,oldCur=cur;DREAM.p=null;DREAM.seed=hashSeed(SP.seed)%100000;cur=fxProgram();
  try{return await _exportTake(kind,'take');}finally{DREAM.p=oldP;DREAM.seed=oldSeed;cur=oldCur;if(state.powered)applySoulFX();}
};''',
'''/* Write the whole song into the take without playing it. Every note goes through the same
   emitBar the live path uses, so this IS the music you would have heard — spawnVoice logs it
   and returns before making a sound while DRY is set. Yields to the event loop every 16 bars
   so a long render does not freeze the page. */
async function soulComposeSong(seconds){
  var at=0,n=0,barLen;
  DRY=true;
  TAKE.ev=[];TAKE.t0=0;TAKE.on=true;TAKE.open={};
  try{
    SP.composer=new K.Composer(SP.seed,settings);
    while(at<seconds&&n<4000){
      barLen=emitBar(at);
      if(!(barLen>0))break;
      at+=barLen;n++;
      if(n%16===0){setSaveUI('WRITING '+Math.round(at/seconds*100)+'%');await new Promise(function(r){setTimeout(r,0);});}
    }
  }finally{DRY=false;TAKE.on=false;}
  return {bars:n,span:at};
}
var _exportTake=exportTake;exportTake=async function(kind,src){
  if(!SP.ownsTake)return _exportTake(kind,src);
  var oldP=DREAM.p,oldSeed=DREAM.seed,oldCur=cur;DREAM.p=null;DREAM.seed=hashSeed(SP.seed)%100000;cur=fxProgram();
  var want=Math.min(480,Number(SP.renderSeconds)||0),keepTake=null,keepComposer=SP.composer,keepTempo=state.tempo;
  try{
    if(want>0){
      keepTake={ev:TAKE.ev,t0:TAKE.t0,on:TAKE.on,open:TAKE.open};
      var song=await soulComposeSong(want);
      SP.diagnostics.lastSongBars=song.bars;
    }
    return await _exportTake(kind,'take');
  }finally{
    if(keepTake){TAKE.ev=keepTake.ev;TAKE.t0=keepTake.t0;TAKE.on=keepTake.on;TAKE.open=keepTake.open;}
    SP.composer=keepComposer;state.tempo=keepTempo;
    DREAM.p=oldP;DREAM.seed=oldSeed;cur=oldCur;if(state.powered)applySoulFX();}
};''')
# ---- end wish 5ab162f7 ---------------------------------------------------------

# ---- wishes a80f6280 / e4c6e175 / 5ab162f7 / 4c01b6b4: the drummer's feel ----
# "The drums are inconsistent they keep switching beat types" — measured: grooveName() drew a
# fresh, unrelated groove from all six every section. Sections are eight bars, so at ~110 bpm
# that is a new beat type roughly every seventeen seconds, unrelated to what the music is doing.
# A song has ONE feel. The seed now picks one FAMILY for the piece and the section's own role
# picks how hard it is played inside that family — dissolve (density .55) and shadow (.72) get
# the open member, lift (1.26) and departure (1.18) the full one. Rolling still re-deals the
# family, because grooveSalt still feeds the draw: a different drummer, not a different drummer
# every seventeen seconds.
# "the African or syncopated rhythms are the coolest but we haven't translated them into the
# improvisator" / "Lucky dreamer still has the best rhythms ... need to see how to merge" —
# three twelve-pulse bell families now play here too. div is the pulse under the beat: 4 =
# sixteenths, 3 = a twelve-pulse bar, which is how these cycles are actually counted. The bar
# stays four beats long either way, so the harmony needs no meter change; only the grid moves.
replace('''var GROOVES={
  straight:{label:'straight',hits:[[0,'kick',1],[4,'snare',.9],[8,'kick',.86],[12,'snare',.92]],hat:2,hatVel:.42},
  backbeat:{label:'backbeat',hits:[[0,'kick',1],[4,'snare',.94],[7,'kick',.7],[10,'kick',.78],[12,'snare',.95]],hat:2,hatVel:.4},
  halftime:{label:'half time',hits:[[0,'kick',1],[8,'snare',.95],[11,'kick',.66]],hat:4,hatVel:.5},
  brushes:{label:'brushes',hits:[[0,'kick',.8],[4,'rim',.7],[8,'kick',.6],[12,'rim',.74]],hat:2,hatVel:.26},
  broken:{label:'broken',hits:[[0,'kick',1],[3,'kick',.62],[4,'snare',.9],[9,'kick',.8],[12,'snare',.9],[14,'snare',.5]],hat:2,hatVel:.36},
  drive:{label:'drive',hits:[[0,'kick',1],[2,'kick',.6],[4,'snare',.95],[8,'kick',1],[10,'kick',.6],[12,'snare',.95]],hat:1,hatVel:.3}
};
var GROOVE_KEYS=Object.keys(GROOVES);
var FILL=[[8,'tomHi',.8],[10,'tomMid',.84],[12,'tomLo',.88],[14,'snare',.9],[15,'snare',.7]];''',
'''/* Twelve-pulse timelines, transcribed, with the velocity shape they are played with.
   bemba: the Bemba of northern Zimbabwe, struck on axe blades; in Cuba the bell of the
   Sarabanda rhythm of Palo Monte. ashanti: the Ashanti and Akan peoples of Ghana, and the
   Dunumba of Guinea. bembe: Ewe and Yoruba of West Africa, and the whole Cuban 6/8 repertoire.
   These are the same figures the Lucky Dreamer plays. They are carried over rather than
   invented, and they are named so the credit travels with them. The bell is voiced on the
   kit's rim, which is the nearest thing the TRITON kit has to a struck blade — it is a stand-in,
   not a gankogui. */
var BELLS={
  bemba:[[0,1],[2,.68],[3,.82],[5,.55],[7,.55],[9,.82],[10,.68]],
  ashanti:[[0,1],[2,.68],[3,.82],[5,.55],[7,.55],[8,.68],[10,.68]],
  bembe:[[0,1],[2,.68],[4,.68],[5,.55],[7,.55],[9,.82],[11,.55]]
};
var GROOVES={
  straight:{label:'straight',div:4,hits:[[0,'kick',1],[4,'snare',.9],[8,'kick',.86],[12,'snare',.92]],hat:2,hatVel:.42},
  backbeat:{label:'backbeat',div:4,hits:[[0,'kick',1],[4,'snare',.94],[7,'kick',.7],[10,'kick',.78],[12,'snare',.95]],hat:2,hatVel:.4},
  halftime:{label:'half time',div:4,hits:[[0,'kick',1],[8,'snare',.95],[11,'kick',.66]],hat:4,hatVel:.5},
  brushes:{label:'brushes',div:4,hits:[[0,'kick',.8],[4,'rim',.7],[8,'kick',.6],[12,'rim',.74]],hat:2,hatVel:.26},
  broken:{label:'broken',div:4,hits:[[0,'kick',1],[3,'kick',.62],[4,'snare',.9],[9,'kick',.8],[12,'snare',.9],[14,'snare',.5]],hat:2,hatVel:.36},
  drive:{label:'drive',div:4,hits:[[0,'kick',1],[2,'kick',.6],[4,'snare',.95],[8,'kick',1],[10,'kick',.6],[12,'snare',.95]],hat:1,hatVel:.3},
  /* Go-go: the pocket from Chuck Brown's bands — the kick pushes the third beat and the
     conga-ish rim answers between the backbeats. Sixteenths, swung by the humanize term. */
  gogoOpen:{label:'go-go, open',div:4,hits:[[0,'kick',1],[6,'kick',.62],[4,'snare',.88],[12,'snare',.9],[7,'rim',.5],[15,'rim',.46]],hat:2,hatVel:.3},
  gogo:{label:'go-go',div:4,hits:[[0,'kick',1],[3,'kick',.6],[6,'kick',.7],[4,'snare',.9],[12,'snare',.94],[5,'rim',.52],[7,'rim',.46],[13,'rim',.52],[15,'rim',.44]],hat:2,hatVel:.32},
  gogoFull:{label:'go-go, full',div:4,hits:[[0,'kick',1],[3,'kick',.62],[6,'kick',.72],[10,'kick',.6],[4,'snare',.92],[12,'snare',.95],[14,'snare',.5],[5,'rim',.54],[7,'rim',.48],[11,'rim',.5],[13,'rim',.54],[15,'rim',.46]],hat:1,hatVel:.28},
  /* The kit answers the bell rather than marking a backbeat, which is why the drum hits sit
     off the beat here. Playing these as a backbeat is what makes a 6/8 sound like a mistake. */
  bellOpen:{label:'bell, open',div:3,hits:[[0,'kick',.95],[7,'snare',.7]]},
  bellMid:{label:'bell',div:3,hits:[[0,'kick',1],[3,'snare',.8],[6,'kick',.7],[9,'snare',.88]]},
  bellFull:{label:'bell, full',div:3,hits:[[0,'kick',1],[2,'kick',.6],[3,'snare',.84],[6,'kick',.74],[8,'snare',.6],[9,'snare',.9],[11,'kick',.58]]}
};
/* A family is the song's feel; the rungs run open -> full and the section's role picks one. */
var FAMILIES={
  pocket:{rungs:['brushes','straight','backbeat','drive']},
  broken:{rungs:['halftime','brushes','broken','drive']},
  gogo:{rungs:['gogoOpen','gogo','gogo','gogoFull']},
  bemba:{bell:'bemba',rungs:['bellOpen','bellMid','bellMid','bellFull']},
  ashanti:{bell:'ashanti',rungs:['bellOpen','bellMid','bellMid','bellFull']},
  bembe:{bell:'bembe',rungs:['bellOpen','bellMid','bellMid','bellFull']}
};
var FAMILY_KEYS=Object.keys(FAMILIES);
var GROOVE_KEYS=Object.keys(GROOVES);
var FILL=[[8,'tomHi',.8],[10,'tomMid',.84],[12,'tomLo',.88],[14,'snare',.9],[15,'snare',.7]];
var FILL12=[[6,'tomHi',.8],[7,'tomMid',.84],[8,'tomLo',.88],[10,'snare',.9],[11,'snare',.7]];''')
replace('''function grooveName(bar){return GROOVE_KEYS[hashSeed(SP.seed+':groove:'+SP.grooveSalt+':'+(bar.sectionIndex||0))%GROOVE_KEYS.length];}
function grooveHits(bar,beats){
  var steps=Math.max(4,Math.round(beats*4)),g=GROOVES[grooveName(bar)],out=[],i,h;
  for(i=0;i<g.hits.length;i++){h=g.hits[i];if(h[0]<steps)out.push({step:h[0],voice:h[1],vel:h[2]});}
  if(g.hat)for(i=0;i<steps;i+=g.hat)out.push({step:i,voice:(i%(g.hat*4)===0?'hatOpen':'hat'),vel:g.hatVel*(i%4===0?1:.78)});
  if((bar.globalIndex+1)%8===0)for(i=0;i<FILL.length;i++){h=FILL[i];if(h[0]<steps)out.push({step:h[0],voice:h[1],vel:h[2]});}''',
'''function feelName(){return FAMILY_KEYS[hashSeed(SP.seed+':feel:'+SP.grooveSalt)%FAMILY_KEYS.length];}
function grooveName(bar){
  var fam=FAMILIES[feelName()],d=(bar.sectionRole&&bar.sectionRole.density)||1;
  /* the six section roles carry densities .55 to 1.26 — that ladder IS the rung */
  return fam.rungs[d<0.75?0:d<1.0?1:d<1.2?2:3];
}
function grooveHits(bar,beats){
  var fam=FAMILIES[feelName()],g=GROOVES[grooveName(bar)],div=g.div||4,
      steps=Math.max(4,Math.round(beats*div)),out=[],i,h,bl;
  for(i=0;i<g.hits.length;i++){h=g.hits[i];if(h[0]<steps)out.push({step:h[0],voice:h[1],vel:h[2]});}
  if(fam.bell){bl=BELLS[fam.bell];for(i=0;i<bl.length;i++)if(bl[i][0]<steps)out.push({step:bl[i][0],voice:'rim',vel:bl[i][1]*.52});}
  if(g.hat)for(i=0;i<steps;i+=g.hat)out.push({step:i,voice:(i%(g.hat*4)===0?'hatOpen':'hat'),vel:g.hatVel*(i%4===0?1:.78)});
  if((bar.globalIndex+1)%8===0){var fl=(div===3)?FILL12:FILL;for(i=0;i<fl.length;i++){h=fl[i];if(h[0]<steps)out.push({step:h[0],voice:h[1],vel:h[2]});}}''')
replace('''    return {beat:clamp(o.step/4+jitter,0,beats-0.001),note:KIT[o.voice],vel:clamp(o.vel*(0.86+0.14*(settings.motion||0.6)),0.05,0.98)};''',
'''    return {beat:clamp(o.step/div+jitter,0,beats-0.001),note:KIT[o.voice],vel:clamp(o.vel*(0.86+0.14*(settings.motion||0.6)),0.05,0.98)};''')
# ---- end drummer feel ----------------------------------------------------------

# ---- wish e4c6e175: "the chord progression mapping and drum time signatures need to map" ----
# Measured: picking bemba7 instead of gogoConga changed 7 of 20 things and all seven were drums
# or timing — the chord in each bar, the bass notes, the chord notes and the lead notes came out
# identical, note for note. Run the other way, changing only the progression, four things moved
# and every drum onset stayed put. Two dials, neither aware of the other.
# The join was missing twice over: candChords is handed the BASS card and never the drums card,
# which is the only thing that knows which figure was picked; and PROG_BANK rows carry only
# {name, scale, prog} — no column a pulse could match on. Both halves are added here.
replace(''' {name:"dorian vamp",scale:"minor",prog:[thX(0,"m7","i7"),thX(5,"d7","IV7"),thX(0,"m7","i7"),thX(5,"d7","IV7")]}
];''',
''' {name:"dorian vamp",scale:"minor",prog:[thX(0,"m7","i7"),thX(5,"d7","IV7"),thX(0,"m7","i7"),thX(5,"d7","IV7")]}
];
/* Which of the twelve sit under a TWELVE-PULSE bell. The 6/8 repertoire these figures come from
   turns on a short modal vamp; a 12-bar blues or a Pachelbel canon over an agbadza bell is two
   traditions talking past each other, and that mismatch is what the wish is about. Named, not
   indexed, so reordering PROG_BANK above cannot silently repoint this. A figure on a sixteen-
   pulse grid still reaches every row — this only ever narrows the twelve-pulse case. */
const PROG_TWELVE=new Set(["doo-wop","axis","andalusian","aeolian vamp","epic minor","dorian vamp"]);
function figGrid(card){ const f=card&&card.fig&&LDR_FIG[card.fig]; return f? f.grid : null; }
function progPool(scale,grid){
  const all=PROG_BANK.filter(b=>b.scale===scale);
  if(grid!==12) return all;
  const fit=all.filter(b=>PROG_TWELVE.has(b.name));
  /* never hand back an empty pool — a scale with no twelve-pulse row must still deal a card */
  return fit.length? fit : all;
}''')
replace('''function candChords(rng,bassC){''','''function candChords(rng,bassC,drumC){''')
replace('''  const pool=PROG_BANK.filter(b=>b.scale===scale);
  const bp=pool[Math.floor(rng()*pool.length)];''',
'''  const pool=progPool(scale,figGrid(drumC));
  const bp=pool[Math.floor(rng()*pool.length)];''')
replace('''  if(stage===2) return candChords(rng,kept&&kept[1]);''',
'''  if(stage===2) return candChords(rng,kept&&kept[1],kept&&kept[0]); /* kept[0] is the drums card — the only one that knows the pulse */''')
replace('''  const bp=pick(PROG_BANK.filter(b=>b.scale===scale));''',
'''  const bp=pick(progPool(scale,f.grid));''')
# ---- end wish e4c6e175 --------------------------------------------------------
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
