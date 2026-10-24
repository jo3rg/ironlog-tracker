/* FIT-Dateien für die Garmin-Tests. Baut echte FIT-Nachrichten (Header, Definitionen,
   Records, CRC) ohne Abhängigkeit von der App. */
const FIT_EPOCH = 631065600;
const CRC_TABLE = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];

const DEFS = {
  fileId: {global:0, fields:[{num:0,size:1},{num:4,size:4}]},
  session: {global:18, fields:[{num:2,size:4},{num:5,size:1},{num:6,size:1},{num:8,size:4},{num:11,size:2},{num:16,size:1},{num:17,size:1},{num:253,size:4}]},
  activity: {global:34, fields:[{num:0,size:4},{num:1,size:2},{num:2,size:1},{num:5,size:4},{num:253,size:4}]},
  set: {global:225, fields:[{num:0,size:4},{num:3,size:2},{num:4,size:2},{num:5,size:1},{num:6,size:4},{num:7,size:2},{num:8,size:2},{num:9,size:1},{num:10,size:2},{num:11,size:2}]},
  title: {global:264, fields:[{num:254,size:2},{num:0,size:2},{num:1,size:2},{num:2,size:40,string:true}]},
  record: {global:20, fields:[{num:3,size:1},{num:253,size:4}]}
};
const LOCAL = {fileId:0,session:1,activity:2,set:3,title:4,record:5};

function fitCrc(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    let t = CRC_TABLE[crc & 15];
    crc = (crc >>> 4) & 0x0fff;
    crc ^= t ^ CRC_TABLE[byte & 15];
    t = CRC_TABLE[crc & 15];
    crc = (crc >>> 4) & 0x0fff;
    crc = (crc ^ t ^ CRC_TABLE[(byte >>> 4) & 15]) & 0xffff;
  }
  return crc;
}

class FitWriter {
  constructor() {
    this.data = [];
    this.defined = new Set();
  }
  writeValue(field, value) {
    if (field.string) {
      const bytes = Buffer.from(String(value ?? ''), 'utf8');
      for (let i = 0; i < field.size; i++) this.data.push(bytes[i] || 0);
      return;
    }
    if (field.size === 1) this.data.push(value & 255);
    else if (field.size === 2) this.data.push(value & 255, (value >>> 8) & 255);
    else this.data.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  }
  message(kind, values) {
    const def = DEFS[kind], local = LOCAL[kind];
    if (!this.defined.has(local)) {
      this.data.push(0x40 | local, 0, 0);
      this.data.push(def.global & 255, (def.global >>> 8) & 255);
      this.data.push(def.fields.length);
      for (const field of def.fields) this.data.push(field.num, field.size, field.string ? 7 : (field.size === 1 ? 0 : field.size === 2 ? 0x84 : 0x86));
      this.defined.add(local);
    }
    this.data.push(local);
    for (const field of def.fields) this.writeValue(field, values[field.num]);
  }
  build() {
    const header = [14,0x20,0x98,0];
    const dataSize = this.data.length;
    header.push(dataSize & 255,(dataSize>>>8)&255,(dataSize>>>16)&255,(dataSize>>>24)&255,46,70,73,84);
    const headerCrc = fitCrc(header);
    header.push(headerCrc & 255,(headerCrc>>>8)&255);
    const all = [...header,...this.data];
    const fileCrc = fitCrc(all);
    all.push(fileCrc & 255,(fileCrc>>>8)&255);
    return Buffer.from(all);
  }
}

const SPORT_TRAINING = 10;
const SUB_SPORT_STRENGTH = 20;
const SET_ACTIVE = 1;
const SET_REST = 0;
const INVALID_UINT16 = 0xFFFF;

function fitTime(date) {
  return Math.floor(date.getTime() / 1000) - FIT_EPOCH;
}

/**
 * Baut eine abgeschlossene Krafttrainings-Aktivität.
 * exercises: [{category, code, name, sets:[{reps, weightKg, durationMs}]}]
 */
function strengthActivity({exercises = [], start = new Date('2026-10-20T17:00:00Z'), elapsedMs = 1_800_000, calories = 220, avgHr = 138, maxHr = 166, restMs = 0, localTimestamp = null} = {}) {
  const w = new FitWriter(), startTime = fitTime(start);
  w.message('fileId', {0:4, 4:startTime});
  w.message('session', {2:startTime, 5:SPORT_TRAINING, 6:SUB_SPORT_STRENGTH, 8:elapsedMs, 11:calories, 16:avgHr, 17:maxHr, 253:startTime});
  w.message('activity', {0:elapsedMs, 1:1, 2:0, 5:localTimestamp ?? startTime, 253:startTime});
  let setIndex = 0, clock = startTime;
  exercises.forEach((exercise, exerciseIndex) => {
    w.message('title', {254:exerciseIndex, 0:exercise.category, 1:exercise.code, 2:exercise.name});
    exercise.sets.forEach(set => {
      w.message('set', {
        0:set.durationMs ?? 30_000,
        3:set.reps ?? INVALID_UINT16,
        4:Math.round((set.weightKg ?? 0) * 16),
        5:SET_ACTIVE,
        6:clock,
        7:exercise.category,
        8:exercise.code,
        9:3,
        10:setIndex,
        11:exerciseIndex
      });
      setIndex++;
      clock += 45;
    });
    if (restMs) {
      w.message('set', {0:restMs, 3:INVALID_UINT16, 4:0, 5:SET_REST, 6:clock, 7:exercise.category, 8:exercise.code, 9:3, 10:setIndex, 11:exerciseIndex});
      setIndex++;
      clock += Math.round(restMs / 1000);
    }
  });
  return w.build();
}

/** Laufaktivität: gültige FIT-Datei, aber kein Krafttraining. */
function runningActivity({start = new Date('2026-10-20T17:00:00Z')} = {}) {
  const w = new FitWriter(), startTime = fitTime(start);
  w.message('fileId', {0:4, 4:startTime});
  w.message('session', {2:startTime, 5:1, 6:0, 8:2_400_000, 11:400, 16:150, 17:175, 253:startTime});
  w.message('activity', {0:2_400_000, 1:1, 2:0, 5:startTime, 253:startTime});
  for (let i = 0; i < 3; i++) w.message('record', {3:150 + i, 253:startTime + i});
  return w.build();
}

/** Beschädigte bzw. falsche Dateien. */
function garbageFile() {
  return Buffer.from('Das ist keine Garmin-FIT-Datei.', 'utf8');
}
function truncatedFit(bytes) {
  return bytes.subarray(0, bytes.length - 6);
}

module.exports = {
  FIT_EPOCH, INVALID_UINT16, SET_ACTIVE, SET_REST, SPORT_TRAINING, SUB_SPORT_STRENGTH,
  FitWriter, fitCrc, fitTime, garbageFile, runningActivity, strengthActivity, truncatedFit
};
