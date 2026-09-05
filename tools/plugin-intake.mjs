#!/usr/bin/env node
/* Author: Aldrin Payopay <aldrin.gdf@gmail.com>. Read-only by default; no source execution. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {extractPlugin,validateRack,verifyPlugin,PLUGIN_LIMITS} from '../dist/plugin-contract.js';
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
async function noSymlinkPath(target){const resolved=path.resolve(target);let current=path.parse(resolved).root;for(const part of resolved.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);let stat;try{stat=await fs.lstat(current);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(stat.isSymbolicLink())throw Error('Symlink paths are not accepted: '+current);}return resolved;}
async function readCandidate(filename){
  const full=await noSymlinkPath(filename),before=await fs.lstat(full);
  if(!before.isFile()||before.size>PLUGIN_LIMITS.fileBytes)throw Error('Choose a regular file of at most 32 MiB.');
  // Recheck the opened descriptor: a pathname can be replaced after lstat.
  // NONBLOCK prevents a replacement FIFO from waiting for a writer at open().
  const file=await fs.open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await file.stat();if(!stat.isFile()||stat.size>PLUGIN_LIMITS.fileBytes)throw Error('Choose a regular file of at most 32 MiB.');
    // Read at most the measured size plus one byte. A concurrently growing file
    // must not turn readFile() into an unbounded read/allocation or endless wait.
    const buffer=Buffer.allocUnsafe(stat.size+1);let count=0;
    while(count<buffer.length){const {bytesRead}=await file.read(buffer,count,buffer.length-count,count);if(bytesRead===0)break;count+=bytesRead;}
    const after=await file.stat();
    if(count!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)throw Error('Candidate changed while being read; retry once its writer has finished.');
    const bytes=buffer.subarray(0,count);return {full,bytes,source:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
  }finally{await file.close();}
}
async function exclusiveWrite(filename,data){await noSymlinkPath(path.dirname(filename));const file=await fs.open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await file.writeFile(data);}finally{await file.close();}}
export async function inspectCandidate(filename){const candidate=await readCandidate(filename);let parsed;try{if(candidate.source.trim().startsWith('{'))parsed=JSON.parse(candidate.source);}catch(e){throw Error('Invalid candidate JSON: '+e.message);}
  let manifest,compatibility;if(parsed?.format?.startsWith('midi-room.rack/')){manifest=validateRack(parsed);compatibility=[];for(const item of manifest.modules)compatibility.push({...await verifyPlugin(item.plugin),instanceId:item.instanceId});}else{manifest=extractPlugin(candidate.source,path.basename(candidate.full));compatibility=[await verifyPlugin(manifest)];}
  return {candidate,manifest,receipt:{format:'midi-room.intake/1',recordedAt:new Date().toISOString(),source:{name:path.basename(candidate.full),bytes:candidate.bytes.length,sha256:sha256(candidate.bytes)},kind:manifest.format==='midi-room.rack/1'?'rack':'plugin',identity:manifest.id??manifest.name,compatibility,execution:{html:false,native:false,wasmInstantiated:false,network:false},promotion:'candidate-only; no champion or runtime state changed'}};
}
async function main(args){if(args.length===0||args.includes('--help')){console.log('Usage: node tools/plugin-intake.mjs FILE [--output NEW_RECEIPT.json] [--stage DIRECTORY]\nInspects manifest and artifact hashes without executing imported code. Stage writes an exclusive content-addressed candidate directory; it does not promote or launch it.');return;}
  const filename=args.shift(),options={};while(args.length){const key=args.shift();if(!['--output','--stage'].includes(key)||options[key]||!args.length)throw Error('Expected --output NEW_FILE or --stage DIRECTORY exactly once.');options[key]=args.shift();}
  const {candidate,manifest,receipt}=await inspectCandidate(filename);let staged=null;
  if(options['--stage']){const root=await noSymlinkPath(options['--stage']);await fs.mkdir(root,{recursive:true,mode:0o700});await noSymlinkPath(root);staged=path.join(root,receipt.source.sha256);await fs.mkdir(staged,{mode:0o700});
    const extension=/\.html?$/i.test(candidate.full)?'.html':'.json';await exclusiveWrite(path.join(staged,'candidate'+extension),candidate.bytes);await exclusiveWrite(path.join(staged,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await exclusiveWrite(path.join(staged,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  }
  if(options['--output']){const output=await noSymlinkPath(options['--output']);await exclusiveWrite(output,JSON.stringify(receipt,null,2)+'\n');}
  console.log(JSON.stringify({...receipt,...(staged?{staged}: {})},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error('Plugin intake rejected: '+error.message);process.exitCode=1;});
