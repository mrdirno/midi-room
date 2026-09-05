#!/usr/bin/env python3
"""Author: Aldrin Payopay. Build Lucky Dreamer without changing its original."""
from pathlib import Path
import hashlib
import re

root = Path(__file__).resolve().parents[2]
src = root / 'src/lucky'
original = root / 'reference/lucky-dreamer/luckydreamer_aug_27_2.html'
expected = 'ebde63754bc6d8db762b11a5d89abb604ac242af6ca06149ccd109f9f1b054ac'
runtime_expected = '7a2e62e9a15777bd5b096ea85a1c9731795288990dfe06095da8e447c8936ef4'
runtime = (src / 'engine.original.js').read_bytes()
if hashlib.sha256(runtime).hexdigest() != runtime_expected:
    raise SystemExit('Refusing build: preserved runtime engine changed')
# The public source package needs only the sanitized runtime, not the private
# source artifact. In the development tree, additionally check its provenance.
if original.exists():
    raw = original.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise SystemExit('Refusing build: immutable Lucky Dreamer original changed')
    match = re.search(r'<script id="engine-src">([\s\S]*?)</script>', raw.decode())
    if not match or match.group(1).encode() != runtime:
        raise SystemExit('Runtime is not the original engine-src extraction')
# Extract only executable runtime. Original embedded manuscript, app prompts,
# development diary and obsolete app UI are not copied into the new player.
engine = runtime.decode() + '\n' + (src / 'composition.js').read_text() + '\n' + (src / 'audio-runtime.js').read_text()
page = (src / 'player.html').read_text()
for marker, value in [('<!--LUCKY_ENGINE-->', '<script id="lucky-engine">\n' + engine + '\n</script>'),
                      ('<!--LUCKY_PLAYER-->', '<script>\n' + (src / 'player.js').read_text() + '\n</script>')]:
    if page.count(marker) != 1:
        raise SystemExit('Expected exactly one build marker: ' + marker)
    page = page.replace(marker, value)
if re.search(r'<(?:script|link)\b[^>]+(?:src|href)="(?:https?:|/|\./)', page):
    raise SystemExit('Standalone player has a runtime network dependency')
target = root / 'dist/instruments/lucky-dreamer.html'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(page)
print(f'Built {target.relative_to(root)} ({target.stat().st_size:,} bytes); runtime/provenance verified')
