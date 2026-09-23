/* Lucky Dreamer's wire publisher exactly as origin/main shipped it at a7b9370, before the lead-in
   switch: the block of src/lucky-cloud/lifecycle.js from `var busList` to `var originalOnEngineMsg`,
   copied byte for byte (`git show a7b9370:src/lucky-cloud/lifecycle.js`). tests/lucky-wire.test.mjs
   runs it beside the current block and requires the two to put the same notes on a cable wherever
   the old one was right. It is a reference, never loaded by a page. */
var busList=null,busWorld=null,busCursor=-1,busLast=-1,busBpm=0,busSaid=-1e9,busSeats=Object.create(null);
function busScore(w){
 var out=[],melCh=0,pi,i;
 for(pi=0;pi<w.roster.length;pi++){
  var r=w.roster[pi];
  if(r.muted)continue;
  var evs=[];
  for(i=0;i<w.events.length;i++)if(w.events[i].part===r.id)evs.push(w.events[i]);
  if(!evs.length)continue;
  /* a kit part whose events carry NOTES is a tuned drum playing a line — a
     bass track, not a channel-10 kit. encodeMidi draws the same line. */
  var isDrum=r.engine==='kit'||r.engine==='perc';
  if(isDrum)for(i=0;i<evs.length;i++)if(evs[i].note!==undefined){isDrum=false;break;}
  var ch=isDrum?9:(melCh===9?++melCh:melCh);
  if(!isDrum)melCh=(melCh+1)%16;
  for(i=0;i<evs.length;i++){
   var e=evs[i],note,dur;
   if(isDrum){
    var map=r.engine==='kit'?GM_KIT:GM_PERC;
    note=map[e.slot>=0&&e.slot<map.length?e.slot:0];
    dur=w.secPerStep*0.5;
   }else{
    if(e.note===undefined||e.note<0||e.note>127)continue;
    note=e.note;dur=Math.max(w.secPerStep*0.5,e.dur*w.secPerStep*0.96);
   }
   /* Clamp to zero, exactly as encodeMidi's Math.max(0, ...) does. The
      humanizer can push the first hit of a beat a few milliseconds before
      the downbeat: measured, 2 of 12 seeds open with notes at -8ms and
      -3ms. Unclamped they sit behind the publisher's opening cursor and
      never reach the wire, so the file would have a hit the wire did not. */
   var at=Math.max(0,e.t*w.secPerStep);
   out.push({at:at,off:at+dur,ch:ch,note:note|0,vel:Math.max(1,Math.min(127,Math.round(e.vel*126)+1)),seat:r.id+':'+e.t});
  }
 }
 out.sort(function(a,b){return a.at-b.at;});
 return out;
}
function busReset(){busList=null;busWorld=null;busCursor=-1;busLast=-1;busBpm=0;busSaid=-1e9;busSeats=Object.create(null);}
/* Transport, so PLAY and STOP here mean PLAY and STOP over there. It also
   closes the one gap the note scheduler leaves open: notes are published
   400ms early, so a stop would otherwise be followed by up to 400ms of
   already-scheduled hits on the other instrument. The room turns a
   transport stop into panicSource, which sends all-notes-off down every
   wire out of here (app.js: cancelOutgoing). The stop is the eraser. */
function busTransport(action,bpm){
 var mr=window.MidiRoom;
 if(C.destroyed||!mr||typeof mr.emit!=='function')return;
 var e={kind:'transport',action:action};
 if(bpm)e.bpm=Math.max(20,Math.min(300,Math.round(bpm)));
 mr.emit(e);
}
function busPublish(t){
 var mr=window.MidiRoom;
 if(C.destroyed||!mr||typeof mr.emit!=='function')return;
 /* only the whole band: a solo or an audition is a different score in the
    engine than S.world, and publishing S.world then would be a lie. */
 if(!S.playing||S.solo||!S.world)return;
 if(busWorld!==S.world){
  /* Keep the cursor. It is the high-water mark of what has already gone down the
     wire, and a new world does not un-send those notes — it only re-times the same
     band. Rewinding it here re-published the whole 0.4 s horizon on every rebuild,
     and a held +/- button rebuilds every 80 ms. Measured over one second on real
     worlds: 38 note-ons where 7 were owed (seed 12345; 34/8 and 38/10 on two more),
     arriving as ~25 flams 3-90 ms apart on the same note — an audible stutter.
     Removing only the rewind collapses 38 to 10.

     THIS IS NOT A TEMPO BUG, and the first version of this note said it was. Freeze
     the tempo and hold the same button and the pile-up is WORSE (44 v 38), because
     the trigger is the rebuild, not the arithmetic. The engine is restruck once
     mid-hold, at +243 ms — not zero times as first written — and the two tempo
     readouts are byte-identical, so nothing here is two clocks disagreeing. It is
     one cable being told the same music twice. This is the same mistake the
     loop-around test below was written to avoid, one branch up. */
  busWorld=S.world;busList=busScore(S.world);busLast=-1;
 }
 /* Say the tempo again now and then, not only when the dial moves. A clock that
    states itself once cannot be joined late: a cable made a minute into the song
    carried notes while the follower's BPM tile stayed a dash forever, so the wire
    list said "Clock" and the instrument said "no clock" and nothing could settle
    it. Measured on the shipped file: eight seconds of steady play sent exactly one
    transport event, at t=0. Once a bar fills the tile within a bar of any connect,
    and `t<busSaid` catches the loop coming round. */
 if(S.world.bpm&&(S.world.bpm!==busBpm||t-busSaid>=S.world.secPerStep*16||t<busSaid)){
  busBpm=S.world.bpm;busSaid=t;busTransport('tempo',busBpm);
 }
 /* The loop came round. Test it against the PREVIOUS playhead, never against
    the cursor: the cursor sits a whole horizon ahead of the playhead by
    design, so `t < busCursor` is true on every single report and rewinds the
    cursor every 50ms. Measured before this line was written that way: 12 of
    12 seeds re-sent the same notes, 10,199 duplicates in one loop of the
    first. */
 if(busLast>=0&&t<busLast-1e-3){busCursor=t-1e-3;busSeats=Object.create(null);}
 busLast=t;
 var horizon=t+0.4,base=mr.now();
 for(var i=0;i<busList.length;i++){
  var n=busList[i];
  /* Skip what has already gone down the wire, by its seat in the music (part + step),
     never by its position in time. A rebuild re-times the same band, so the same note comes
     back with a different `at`; a time cursor either re-sends it (flams, ~half the notes on
     a held button) or, if the cursor is carried, silently drops material the rebuild ADDED
     inside the horizon — measured at 0 of the 4 notes owed in the first 400 ms after a lane
     is unmuted, its entry sliding 125 ms -> 500 ms. The seat is stable under re-timing, so
     it separates the two: a re-timed note is the same seat and is skipped; an unmuted lane
     is a new seat and goes out at once. */
  if(busSeats[n.seat])continue;
  if(n.at>horizon)break;                      /* sorted: nothing later matters */
  var on=base+(n.at-t)*1000,off=base+(n.off-t)*1000;
  if(on<base)on=base;
  if(off<on+40)off=on+40;
  mr.emit({kind:'midi',data:[0x90|n.ch,n.note,n.vel],at:on});
  mr.emit({kind:'midi',data:[0x80|n.ch,n.note,0],at:off});
  busSeats[n.seat]=1;
 }
 busCursor=horizon;
}
