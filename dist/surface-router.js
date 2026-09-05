/** Local instrument/surface control v1. Author: Aldrin Payopay. */
const token = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(v);
const midiInt = v => Number.isInteger(v) && v >= 0 && v <= 127;
const label = v => typeof v === 'string' && v.length > 0 && v.length <= 80;

export function validateProfile(raw) {
  try {
    if (!raw || JSON.stringify(raw).length > 16384 || raw.version !== 1 || !token(raw.definitionId) || !token(raw.definitionVersion) || !token(raw.profileId) || !label(raw.name) || !['drums','pitched','surface'].includes(raw.kind)) return null;
    if (!Array.isArray(raw.voices) || raw.voices.length > 64) return null;
    const ids = new Set(), voices = [];
    for (const v of raw.voices) {
      if (!v || !token(v.id) || ids.has(v.id) || !label(v.label) || !midiInt(v.note) || !Number.isInteger(v.channel) || v.channel < 0 || v.channel > 15 || !['oneshot','gate'].includes(v.mode) || v.chokeGroup !== undefined && !token(v.chokeGroup)) return null;
      ids.add(v.id); voices.push({id:v.id,label:v.label,note:v.note,channel:v.channel,mode:v.mode,...(v.chokeGroup ? {chokeGroup:v.chokeGroup} : {})});
    }
    const out = {version:1,definitionId:raw.definitionId,definitionVersion:raw.definitionVersion,profileId:raw.profileId,kind:raw.kind,name:raw.name,voices};
    if (raw.kind === 'pitched') {
      if (!Array.isArray(raw.noteRange) || raw.noteRange.length !== 2 || !raw.noteRange.every(midiInt) || raw.noteRange[0] > raw.noteRange[1] || !midiInt(raw.recommendedRoot)) return null;
      out.noteRange = [...raw.noteRange]; out.recommendedRoot = raw.recommendedRoot;
      if(raw.recommendedChannel!==undefined){if(!Number.isInteger(raw.recommendedChannel)||raw.recommendedChannel<0||raw.recommendedChannel>15)return null;out.recommendedChannel=raw.recommendedChannel;}
    }
    return out;
  } catch { return null; }
}

export function defaultAssignments(profile) {
  if (!profile) return Array(16).fill(null);
  if (profile.kind === 'pitched') return Array.from({length:16},(_,i) => {
    const note = profile.recommendedRoot + i;
    return note <= profile.noteRange[1] && note >= profile.noteRange[0] ? {voiceId:'note-'+note,label:'Note '+note,note,channel:profile.recommendedChannel??0,mode:'gate'} : null;
  });
  return Array.from({length:16},(_,i) => {const v=profile.voices[i]; return v ? {voiceId:v.id,label:v.label,note:v.note,channel:v.channel,mode:v.mode} : null;});
}

export function validAssignment(profile, a) {
  if (a === null) return true;
  if (!profile || !a || !midiInt(a.note) || !Number.isInteger(a.channel) || a.channel < 0 || a.channel > 15 || !label(a.label)) return false;
  if (profile.kind === 'pitched') return a.note >= profile.noteRange[0] && a.note <= profile.noteRange[1] && a.voiceId === 'note-'+a.note && a.mode === 'gate';
  return profile.voices.some(v => v.id === a.voiceId && v.note === a.note && v.channel === a.channel && v.mode === a.mode);
}

/** Private-port identities are supplied by the host, never by a caller's payload. */
export class SurfaceRouter {
  constructor({send, now=()=>Date.now()}) { this.send=send; this.now=now; this.sessions=new Map(); this.bindings=new Map(); this.serial=0; this.stats={accepted:0,rejected:0,cancelled:0}; }
  reject() { this.stats.rejected++; return false; }
  describe(id,raw) {
    const profile=validateProfile(raw); if (!profile) return this.reject();
    const prev=this.sessions.get(id);
    this.sessions.set(id,{profile,seen:prev?.seen || new Set(),tokens:256,last:this.now()});
    for (const [source,b] of [...this.bindings]) if (b.target === id && JSON.stringify(prev?.profile) !== JSON.stringify(profile)) this.bind(source,id);
    this.broadcast(); return true;
  }
  broadcast() {
    const targets=[...this.sessions].filter(([,s])=>s.profile.kind !== 'surface').map(([id,s])=>({id,profile:s.profile}));
    for (const [id,s] of this.sessions) if (s.profile.kind === 'surface') this.send(id,{action:'targets',version:1,targets});
  }
  bind(source,target) {
    if (this.sessions.get(source)?.profile.kind !== 'surface' || target !== null && (!this.sessions.has(target) || this.sessions.get(target).profile.kind === 'surface')) return this.reject();
    this.cancel(source,'target-changed');
    const b={id:'binding-'+(++this.serial),target,hits:new Map()}; this.bindings.set(source,b);
    this.send(source,{action:'binding',version:1,bindingId:b.id,target,profile:target ? this.sessions.get(target).profile : null});
    return true;
  }
  cancel(source,reason='surface-release') {
    const b=this.bindings.get(source); if (!b) return;
    if (b.target) this.send(b.target,{action:'cancel',version:1,routeId:b.id,reason});
    b.hits.clear(); this.stats.cancelled++;
  }
  hit(source,payload) {
    const s=this.sessions.get(source), b=this.bindings.get(source);
    if (!s || !b?.target || !payload || payload.bindingId !== b.id || !token(payload.hitId) || !['on','off'].includes(payload.phase)) return this.reject();
    const now=this.now(); s.tokens=Math.min(256,s.tokens+Math.max(0,now-s.last)*1.024); s.last=now;
    // Releases are never dropped due to a note-on burst.
    if (payload.phase === 'off') {
      if (!b.hits.has(payload.hitId)) return this.reject();
      const hit=b.hits.get(payload.hitId); b.hits.delete(payload.hitId);
      this.send(b.target,{action:'note-off',version:1,id:hit.id,routeId:b.id,at:now}); return true;
    }
    if (s.tokens < 1 || b.hits.size >= 128) { this.cancel(source,'rate-limit'); return this.reject(); }
    s.tokens--;
    if (s.seen.has(payload.hitId) || b.hits.has(payload.hitId) || !validAssignment(this.sessions.get(b.target)?.profile,payload.assignment) || !payload.assignment || !Number.isInteger(payload.velocity) || payload.velocity < 1 || payload.velocity > 127) return this.reject();
    s.seen.add(payload.hitId); if (s.seen.size > 2048) s.seen.delete(s.seen.values().next().value);
    const id=b.id+':'+payload.hitId, a=payload.assignment;
    b.hits.set(payload.hitId,{id});
    this.send(b.target,{action:'note-on',version:1,id,routeId:b.id,note:a.note,channel:a.channel,voiceId:a.voiceId,velocity:payload.velocity,at:now}); this.stats.accepted++; return true;
  }
  remove(id) {
    this.cancel(id,'surface-closed'); this.bindings.delete(id); this.sessions.delete(id);
    for (const [source,b] of this.bindings) if (b.target === id) this.bind(source,null);
    this.broadcast();
  }
}

/** Preserve old note-off ownership across focus changes (FIFO for repeated notes). */
export class FocusRouter {
  constructor(send) { this.send=send; this.active=null; this.notes=new Map(); this.pedals=new Map(); }
  focus(session) { this.active=session; }
  input(event) {
    const d=event.data, type=d[0]&240, ch=d[0]&15, key=event.inputId+':'+ch+':'+d[1];
    if (type === 144 && d[2] > 0) {
      let q=this.notes.get(key)||[];
      if (q.length >= 32 || this.notes.size >= 2048 && !q.length) { this.panic(); return; }
      q.push(this.active); this.notes.set(key,q); if (this.active) this.send(this.active,event);
    } else if (type === 128 || type === 144) {
      const q=this.notes.get(key), owner=q?.shift(); if (q && !q.length) this.notes.delete(key);
      if (owner) this.send(owner,event);
    } else if (type === 176 && d[1] === 64) {
      const pedal=event.inputId+':'+ch;
      if (d[2] >= 64) { this.pedals.set(pedal,this.active); if (this.active) this.send(this.active,event); }
      else { const owner=this.pedals.get(pedal); this.pedals.delete(pedal); if(owner) this.send(owner,event); }
    } else if (this.active) this.send(this.active,event);
  }
  release(session) {
    for (const q of this.notes.values()) for (let i=0;i<q.length;i++) if(q[i]===session) q[i]=null;
    for (const [k,s] of this.pedals) if(s===session) this.pedals.set(k,null);
  }
  panic() { for (const owner of new Set([...this.notes.values()].flat().filter(Boolean))) this.send(owner,{panic:true}); this.notes.clear(); this.pedals.clear(); }
}
