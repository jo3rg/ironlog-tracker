/* Garmin BLE: Protokoll-Bausteine (Protobuf-Wire-Format, COBS) und der
   Datei-Upload zur Uhr. Ohne Fremdbibliotheken, lauffähig im Browser
   (Web Bluetooth) und im Node (Tests mit einem Mock-Gerät). */
(function (root) {
  'use strict';

  /* ---------- Protobuf (proto2, nur die benötigten Typen) ---------- */
  const WIRE_VARINT = 0, WIRE_FIXED64 = 1, WIRE_LENGTH = 2, WIRE_FIXED32 = 5;

  function encodeVarint(value) {
    const bytes = [];
    let v = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
    if (v < 0n) v += 1n << 64n;                       // negative int32 -> 10 Byte
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) byte |= 0x80;
      bytes.push(byte);
    } while (v > 0n);
    return bytes;
  }

  function decodeVarint(bytes, offset) {
    let result = 0n, shift = 0n, index = offset;
    for (;;) {
      if (index >= bytes.length) throw new Error('Protobuf: Varint unvollständig.');
      const byte = bytes[index++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
      if (shift > 70n) throw new Error('Protobuf: Varint zu lang.');
    }
    return {value: result, next: index};
  }

  function tag(number, wire) {
    return encodeVarint((number << 3) | wire);
  }

  const TYPE = {
    uint32: {wire: WIRE_VARINT, write: v => encodeVarint(v)},
    int32: {wire: WIRE_VARINT, write: v => encodeVarint(v)},
    uint64: {wire: WIRE_VARINT, write: v => encodeVarint(v)},
    bool: {wire: WIRE_VARINT, write: v => encodeVarint(v ? 1 : 0)},
    enum: {wire: WIRE_VARINT, write: v => encodeVarint(v)},
    fixed64: {wire: WIRE_FIXED64, write: v => {const b=[]; let n=BigInt(v); for(let i=0;i<8;i++){b.push(Number(n & 0xffn)); n >>= 8n;} return b;}},
    string: {wire: WIRE_LENGTH, write: v => {const b=[...new TextEncoder().encode(String(v))]; return [...encodeVarint(b.length), ...b];}},
    bytes: {wire: WIRE_LENGTH, write: v => [...encodeVarint(v.length), ...v]},
    message: {wire: WIRE_LENGTH, write: v => [...encodeVarint(v.length), ...v]}
  };

  /**
   * fields: [{no, type, value}] – value bei 'message' ist bereits ein Uint8Array.
   */
  function encodeMessage(fields) {
    const out = [];
    for (const field of fields) {
      if (field.value === undefined || field.value === null) continue;
      const spec = TYPE[field.type];
      if (!spec) throw new Error('Protobuf: unbekannter Typ ' + field.type);
      out.push(...tag(field.no, spec.wire), ...spec.write(field.value));
    }
    return Uint8Array.from(out);
  }

  function decodeMessage(bytes) {
    const fields = new Map();
    let offset = 0;
    while (offset < bytes.length) {
      const {value: tagValue, next} = decodeVarint(bytes, offset);
      offset = next;
      const number = Number(tagValue >> 3n), wire = Number(tagValue & 7n);
      if (wire === WIRE_VARINT) {
        const {value, next: after} = decodeVarint(bytes, offset);
        offset = after;
        push(fields, number, value);
      } else if (wire === WIRE_LENGTH) {
        const {value, next: after} = decodeVarint(bytes, offset);
        offset = after;
        const length = Number(value);
        if (offset + length > bytes.length) throw new Error('Protobuf: Feld abgeschnitten.');
        push(fields, number, bytes.subarray(offset, offset + length));
        offset += length;
      } else if (wire === WIRE_FIXED64) {
        if (offset + 8 > bytes.length) throw new Error('Protobuf: fixed64 abgeschnitten.');
        let value = 0n;
        for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(bytes[offset + i]);
        offset += 8;
        push(fields, number, value);
      } else if (wire === WIRE_FIXED32) {
        if (offset + 4 > bytes.length) throw new Error('Protobuf: fixed32 abgeschnitten.');
        let value = 0n;
        for (let i = 3; i >= 0; i--) value = (value << 8n) | BigInt(bytes[offset + i]);
        offset += 4;
        push(fields, number, value);
      } else {
        throw new Error('Protobuf: Wire-Typ ' + wire + ' nicht unterstützt.');
      }
    }
    return fields;
  }

  function push(fields, number, value) {
    if (!fields.has(number)) fields.set(number, []);
    fields.get(number).push(value);
  }

  /* ---------- COBS ----------
     Ein Block wird mit einem Code-Byte pro Lauf encodiert; der Decoder hängt
     immer eine Null an. Garmin rahmt seine Nachrichten als 00 <cobs> 00, die
     abschließende Null ist also der Trenner und kein Nutzinhalt. */
  function cobsEncode(data) {
    const out = [];
    let codeIndex = 0;
    out.push(0);
    let code = 1;
    for (const byte of data) {
      if (byte === 0) {
        out[codeIndex] = code;
        code = 1;
        codeIndex = out.length;
        out.push(0);
        continue;
      }
      out.push(byte);
      code++;
      if (code === 0xff) {
        out[codeIndex] = code;
        code = 1;
        codeIndex = out.length;
        out.push(0);
      }
    }
    out[codeIndex] = code;
    return Uint8Array.from(out);
  }

  function cobsDecode(data) {
    const out = [];
    let index = 0;
    while (index < data.length) {
      const code = data[index++];
      if (code === 0) break;
      for (let i = 1; i < code; i++) {
        if (index >= data.length) throw new Error('COBS: Daten abgeschnitten.');
        out.push(data[index++]);
      }
      if (code < 0xff) out.push(0);
    }
    if (out.length && out[out.length - 1] === 0) out.pop();   // Trenner-Null
    return Uint8Array.from(out);
  }

  /* ---------- CRC-16 (Garmin) ---------- */
  const CRC_TABLE = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];

  function crc16Step(crc, byte) {
    let t = CRC_TABLE[crc & 15];
    crc = (crc >>> 4) & 0x0fff;
    crc ^= t ^ CRC_TABLE[byte & 15];
    t = CRC_TABLE[crc & 15];
    crc = (crc >>> 4) & 0x0fff;
    return (crc ^ t ^ CRC_TABLE[(byte >>> 4) & 15]) & 0xffff;
  }

  /** CRC-16 über die Bytes; seed erlaubt die laufende Prüfsumme über mehrere Blöcke. */
  function crc16(data, seed = 0) {
    let crc = seed & 0xffff;
    for (const byte of data) crc = crc16Step(crc, byte);
    return crc;
  }

  root.GarminCodec = {cobsDecode, cobsEncode, crc16, decodeMessage, decodeVarint, encodeMessage, encodeVarint};
})(typeof window !== 'undefined' ? window : globalThis);
