/**
 * What a note means, written down once so both ends of a cable can read it.
 *
 * The bus carries MIDI bytes faithfully and that is all it should do. But a note
 * number is not a sound: note 49 is a crash cymbal to Lucky Dreamer and a snare to
 * TRITON, because TRITON's kit is twelve pitch-class zones and 49 % 12 lands on the
 * snare zone. Nothing was broken in transit; the two instruments simply never agreed
 * on what the number meant.
 *
 * So the agreement is a file, not code: dist/instrument-map.json names each drum with
 * a word, and each instrument says which numbers it uses for those words. Translating
 * is then a lookup in the sender's table and a lookup in the receiver's, and adding an
 * instrument is one entry in the JSON.
 *
 * Two rules keep this safe to ship. It FAILS OPEN: anything the map does not describe
 * is forwarded byte for byte, so a cable that works today cannot be broken by a gap in
 * the metadata. And it is PURE: same input, same output, no clock, no state. That
 * matters more than it looks — a receiver matches a note-off by channel and note, so a
 * translation that is not a function of the bytes alone would leave notes held down.
 */
export const MAP_FORMAT = 'midi-room.instrument-map/1';

const NOTE_OFF = 0x80, NOTE_ON = 0x90;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const midiNote = v => Number.isInteger(v) && v >= 0 && v <= 127;

function fail(message) { throw new Error('instrument map: ' + message); }

/** Reject a map a junior would otherwise only discover was wrong by ear. */
export function validateInstrumentMap(map) {
  if (!record(map)) fail('must be a JSON object.');
  if (map.format !== MAP_FORMAT) fail('unsupported format; expected ' + MAP_FORMAT + '.');
  if (map.version !== 1) fail('unsupported version; expected 1.');
  if (!record(map.slots) || !Object.keys(map.slots).length) fail('needs a slots vocabulary.');
  const known = new Set(Object.keys(map.slots));
  for (const [name, label] of Object.entries(map.slots)) {
    if (typeof label !== 'string' || !label.trim()) fail('slot ' + name + ' needs a plain-language name.');
  }
  // JSON.parse really does give you an own key called __proto__, and every later lookup
  // on it hands back something that is not a list. Refused by name, as the plugin
  // contract already refuses them, so the failure is a sentence and not a TypeError.
  for (const name of known) if (['__proto__', 'prototype', 'constructor'].includes(name)) fail('slot ' + name + ' is a reserved object key; choose another word.');
  if (map.fallbacks !== undefined) {
    if (!record(map.fallbacks)) fail('fallbacks must be an object.');
    for (const [name, chain] of Object.entries(map.fallbacks)) {
      if (!known.has(name) || !own(map.fallbacks, name)) fail('fallback for unknown slot ' + name + '.');
      if (!Array.isArray(chain) || !chain.length) fail('fallback chain for ' + name + ' must be a non-empty array.');
      for (const next of chain) if (!known.has(next)) fail('fallback ' + name + ' names unknown slot ' + next + '.');
    }
  }
  if (!record(map.instruments) || !Object.keys(map.instruments).length) fail('needs at least one instrument.');
  for (const [id, entry] of Object.entries(map.instruments)) {
    if (!record(entry)) fail(id + ' must be an object.');
    if (typeof entry.name !== 'string' || !entry.name.trim()) fail(id + ' needs a name.');
    const sendPerc = entry.sends && entry.sends.percussion;
    if (sendPerc) {
      checkChannel(id, 'sends', sendPerc.channel);
      if (!record(sendPerc.notes)) fail(id + ' sends percussion but lists no notes.');
      for (const [note, slot] of Object.entries(sendPerc.notes)) {
        if (!midiNote(Number(note)) || String(Number(note)) !== note) fail(id + ' sends note "' + note + '"; write it as a plain number.');
        if (!known.has(slot)) fail(id + ' sends note ' + note + ' as unknown slot ' + slot + '.');
      }
    }
    const recvPerc = entry.receives && entry.receives.percussion;
    if (recvPerc) {
      checkChannel(id, 'receives', recvPerc.channel);
      if (!Array.isArray(recvPerc.kits) || !recvPerc.kits.length) fail(id + ' receives percussion but declares no kit.');
      const spans = [], placed = new Set();
      for (const kit of recvPerc.kits) {
        if (!record(kit) || typeof kit.name !== 'string' || !kit.name.trim()) fail(id + ' has a kit with no name.');
        const span = kit.notes;
        if (!Array.isArray(span) || span.length !== 2 || !span.every(midiNote) || span[0] > span[1]) {
          fail(id + ' kit ' + kit.name + ' needs a note range [low, high].');
        }
        // Disjoint ranges are what lets a receiver pick the kit from the note alone.
        for (const other of spans) if (span[0] <= other[1] && other[0] <= span[1]) fail(id + ' kit ' + kit.name + ' overlaps another kit.');
        spans.push(span);
        if (!record(kit.slots) || !Object.keys(kit.slots).length) fail(id + ' kit ' + kit.name + ' lists no slots.');
        const taken = new Set();
        for (const [slot, note] of Object.entries(kit.slots)) {
          if (taken.has(note)) fail(id + ' kit ' + kit.name + ' puts two drums on note ' + note + '.');
          taken.add(note);
          if (placed.has(slot)) fail(id + ' lists ' + slot + ' in two kits; the note is how a kit is chosen.');
          placed.add(slot);
          if (!known.has(slot)) fail(id + ' kit ' + kit.name + ' names unknown slot ' + slot + '.');
          if (!midiNote(note)) fail(id + ' kit ' + kit.name + ' slot ' + slot + ' has an out-of-range note.');
          if (note < span[0] || note > span[1]) fail(id + ' kit ' + kit.name + ' slot ' + slot + ' sits outside its own range.');
        }
      }
    }
    for (const side of ['sends', 'receives']) {
      const pitched = entry[side] && entry[side].pitched;
      if (!pitched) continue;
      if (!Array.isArray(pitched.range) || pitched.range.length !== 2 || !pitched.range.every(midiNote) || pitched.range[0] > pitched.range[1]) {
        fail(id + ' ' + side + ' pitched needs a note range [low, high].');
      }
    }
  }
  return map;
}

function checkChannel(id, side, channel) {
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) fail(id + ' ' + side + ' percussion on channel ' + channel + '; use 0-15.');
}

const sends = (map, id) => (map && map.instruments && map.instruments[id] && map.instruments[id].sends) || null;
const receives = (map, id) => (map && map.instruments && map.instruments[id] && map.instruments[id].receives) || null;

/**
 * Find the receiver's note for a slot, walking the declared substitutes when it has
 * no such drum. Breadth-first, so the nearest substitute wins and a circular chain
 * cannot spin.
 */
export function resolveSlot(map, targetId, slot) {
  const percussion = (receives(map, targetId) || {}).percussion;
  if (!percussion) return null;
  const seen = new Set();
  const queue = [slot];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const kit of percussion.kits) {
      if (Object.prototype.hasOwnProperty.call(kit.slots, name)) {
        return { slot: name, note: kit.slots[name], kit: kit.name, substituted: name !== slot };
      }
    }
    const chain = own(map.fallbacks || {}, name) ? map.fallbacks[name] : [];
    if (Array.isArray(chain)) for (const next of chain) queue.push(next);
  }
  return null;
}

/** Fold a pitch into the octave range the receiver can actually sound. */
function foldPitched(map, targetId, bytes) {
  const pitched = (receives(map, targetId) || {}).pitched;
  if (!pitched) return bytes;
  const [low, high] = pitched.range;
  if (!Number.isInteger(bytes[1]) || high - low < 12) return bytes;
  let note = bytes[1];
  while (note < low) note += 12;
  while (note > high) note -= 12;
  if (note < low || note > high || note === bytes[1]) return bytes;
  return [bytes[0], note, bytes[2]];
}

/**
 * Rewrite one MIDI message from what the sender meant into what the receiver reads.
 * Returns the bytes to deliver — the same array when nothing needed changing.
 */
export function translateMIDI(map, fromId, toId, data) {
  if (!map || !(Array.isArray(data) || data instanceof Uint8Array)) return data;
  const out = carry(map, fromId, toId, Array.from(data));
  return out.length === data.length && out.every((byte, i) => byte === data[i]) ? data : out;
}

function carry(map, fromId, toId, bytes) {
  const status = bytes[0], type = status & 0xf0, channel = status & 0x0f;
  const sendPercussion = (sends(map, fromId) || {}).percussion;
  if (sendPercussion && !record(sendPercussion.notes)) return bytes;
  if (!sendPercussion || sendPercussion.channel !== channel) {
    return type === NOTE_ON || type === NOTE_OFF ? foldPitched(map, toId, bytes) : bytes;
  }
  const recvPercussion = (receives(map, toId) || {}).percussion;
  // The receiver has no kit. Carrying the bytes unchanged keeps whatever it does
  // today; inventing a pitch for a drum, or dropping it, would both be worse.
  if (!recvPercussion) return bytes;
  const moved = [(status & 0xf0) | recvPercussion.channel, ...bytes.slice(1)];
  // Every message on this channel moves together. A receiver that matches a
  // note-off by channel would otherwise never release the note it started.
  if (type !== NOTE_ON && type !== NOTE_OFF) return moved;
  const slot = own(sendPercussion.notes, String(bytes[1])) ? sendPercussion.notes[String(bytes[1])] : undefined;
  if (typeof slot !== 'string') return moved;
  const hit = resolveSlot(map, toId, slot);
  if (!hit) return moved;
  return [moved[0], hit.note, bytes[2]];
}

/** What this cable can and cannot carry, in words, for a person deciding to plug it in. */
export function describeRoute(map, fromId, toId) {
  const from = map && map.instruments && map.instruments[fromId];
  const to = map && map.instruments && map.instruments[toId];
  if (!from || !to) return 'One of these instruments is not in the map, so its notes are carried unchanged.';
  const sendPercussion = (from.sends || {}).percussion;
  const recvPercussion = (to.receives || {}).percussion;
  const lines = [];
  if (sendPercussion && recvPercussion) {
    const slots = Object.values(sendPercussion.notes);
    const exact = slots.filter(slot => { const hit = resolveSlot(map, toId, slot); return hit && !hit.substituted; }).length;
    const landings = new Set(slots.map(slot => (resolveSlot(map, toId, slot) || {}).note)).size;
    lines.push('Drums: ' + exact + ' of ' + slots.length + ' land on the same drum, the rest on the nearest one ' + to.name + ' has'
      + (landings < slots.length ? '; they share ' + landings + ' sounds between them, so some different drums will sound alike.' : '.'));
  } else if (sendPercussion) {
    lines.push('Drums: ' + to.name + ' has no kit, so its drum notes arrive as whatever it makes of them.');
  }
  const recvPitched = (to.receives || {}).pitched;
  if (recvPitched) lines.push('Notes: folded into ' + recvPitched.range[0] + '-' + recvPitched.range[1] + ', the range ' + to.name + ' can sound.');
  return lines.join(' ') || 'Nothing is translated between these two.';
}

/** A translate function shaped for InstrumentBus, bound to one map. */
export function busTranslator(map) {
  return (event, route) => {
    if (!event || event.kind !== 'midi' || !route || !route.from || !route.to) return event;
    const data = translateMIDI(map, route.from, route.to, event.data);
    return data === event.data ? event : { ...event, data };
  };
}
