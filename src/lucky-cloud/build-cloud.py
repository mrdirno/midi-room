#!/usr/bin/env python3
"""Build the preserved cloud edition with bounded host adapters."""
from pathlib import Path
import hashlib, json, re

src=Path(__file__).resolve().parent
root=src.parents[1]
provenance=json.loads((src/'provenance.json').read_text())
for name,expected in provenance['inputs'].items():
    if hashlib.sha256((src/name).read_bytes()).hexdigest()!=expected['sha256']:
        raise SystemExit('Preserved cloud input changed: '+name)
original=root/'reference/lucky-dreamer'/provenance['sourceName']
if original.exists() and hashlib.sha256(original.read_bytes()).hexdigest()!=provenance['originalHtmlSha256']:
    raise SystemExit('Original cloud reference changed')
app=(src/'app.original.js').read_text()
def replace(old,new,count=1):
    global app
    if app.count(old)!=count:raise SystemExit('Cloud patch drift: '+old[:80])
    app=app.replace(old,new)
replace('S.locks[lane] = kCaptureLane(S.world, lane);','S.locks[lane] = LuckyCloudSoundBank.capture(S.world, lane);')
replace('setTimeout(function () {\n      enterApp();','var entranceIntent = ++C.intent;\n    later(function () {\n      if (entranceIntent !== C.intent) return;\n      enterApp();')
replace('try { localStorage.removeItem(HKEY); } catch (e) {}','clearSessionHistory();')

start=app.index("  $('sAddr').addEventListener('click', function () {")
end=app.index("\n  });",start)+len("\n  });")
app=app[:start]+"  $('sAddr').addEventListener('click', copyAddress);"+app[end:]

replace('because you cannot own a rhythm, only a recording of one.','with their source lineage retained for you to explore.')
replace('if (addr.w) {','if (addr.w !== undefined) {')
replace('if ((hadSession || addr.w) && S.seed) {','if (hadSession || addr.w !== undefined) {')
replace("build: function (n, opts) { return buildBeat(n >>> 0, opts); },","build: function (n, opts) { return LuckyCloudSoundBank.build(n >>> 0, opts); },")
start=app.index("  document.addEventListener('keydown', function (e) {")
end=app.index("\n  });\n}\nif (document.readyState",start)+len('\n  });')
app=app[:start]+app[end:]
start=app.index('var ABOUT = ')
end=app.index('/* ── SESSIONS ARE A HISTORY',start)
app=app[:start]+"var ABOUT = '';\n\n"+app[end:]
replace("if (document.readyState === 'loading')",(src/'lifecycle.js').read_text()+"\nif (document.readyState === 'loading')")
shell=(src/'shell.html').read_text()
shell=shell.replace('https://persona500.com/dream-drummer','https://persona500.com/midi-room/instruments/lucky-dreamer.html')
shell=re.sub(r'<meta (?:property="og:image[^\"]*"|name="twitter:image")[^>]*>\n?','',shell)
shell=re.sub(r'<script type="application/ld\+json">[\s\S]*?</script>','',shell)
shell=shell.replace('<button class="chip" id="bAbout">?</button>', '<button class="chip" id="bSounds">sounds</button><button class="chip" id="bAbout" aria-label="About Lucky Dreamer">?</button>')
shell=shell.replace('<div id="toast"></div>','<div id="toast" role="status" aria-live="polite"></div><button id="cancelExport" class="chip" hidden>cancel export</button>')
shell=shell.replace('<div id="sheet"><div class="sbox">','<div id="sheet" role="dialog" aria-modal="true" aria-label="Lucky Dreamer options" aria-hidden="true"><div class="sbox" tabindex="-1">')
shell=shell.replace('id="sClose">','id="sClose" aria-label="Close options">')
css=(src/'cloud.css').read_text()+'\n'+(src/'integration.css').read_text()
for marker,value in [('/*CLOUD_STYLE*/',css),('/*CLOUD_ENGINE*/',(src/'engine.original.js').read_text()),('/*CLOUD_SOUNDS*/',(src/'sound-bank.js').read_text()),('/*CLOUD_APP*/',app)]:
    if shell.count(marker)!=1:raise SystemExit('Cloud shell marker drift: '+marker)
    if marker!='/*CLOUD_STYLE*/' and re.search(r'</script',value,re.I):raise SystemExit('Raw script boundary in '+marker)
    shell=shell.replace(marker,value)
if re.search(r'<script\b[^>]*\bsrc\s*=',shell,re.I):raise SystemExit('External runtime script')
if 'RINGS · agent context' in shell or '<!-- ═══ RINGS' in shell:raise SystemExit('Private document tail leaked')
canonical='https://persona500.com/midi-room/instruments/lucky-dreamer.html'
if shell.count('<link rel="canonical" href="'+canonical+'">')!=1:raise SystemExit('Canonical missing')
target=root/'dist/instruments/lucky-dreamer.html'
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(shell)
print('Built cloud Lucky Dreamer:',len(shell.encode()),'bytes; immutable sources verified')
