import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BUILTINS} from '../dist/catalog.js';

test('each built standalone document identifies its own canonical instrument URL',()=>{
  for(const item of BUILTINS){
    const html=readFileSync(new URL('../dist/instruments/'+item.file,import.meta.url),'utf8');
    const head=html.split('</head>',1)[0];
    const tags=head.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/gi)||[];
    assert.equal(tags.length,1,item.id+' must have exactly one canonical link');
    assert.match(tags[0],new RegExp('href=["\']https://persona500\\.com/midi-room/instruments/'+item.file.replaceAll('.','\\.')+'["\']'),item.id);
  }
});
