/* Mock-Uhr für die Garmin-BLE-Tests: spricht das Multi-Link- und GFDI-Protokoll
   auf der Uhrseite und prüft, was der Client sendet. */
require('../../garmin-codec.js');
const { cobsDecode, cobsEncode, crc16 } = globalThis.GarminCodec;

const concat = parts => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

class MockWatch {
  constructor(options = {}) {
    this.clientId = options.clientId ?? 2n;
    this.handle = options.handle ?? 0x11;
    this.onData = () => {};
    this.buffer = new Uint8Array(0);
    this.file = null;
    this.receivedCrc = 0;
    this.frames = [];
    this.refuseCreate = options.refuseCreate ?? false;
    this.transport = {write: bytes => this.onWrite(bytes)};
  }

  async onWrite(bytes) {
    const handle = bytes[0];
    const payload = bytes.subarray(1);
    if (handle === 0) { this.onManagement(payload); return; }
    this.buffer = concat([this.buffer, payload]);
    for (;;) {
      if (this.buffer.length < 2 || this.buffer[0] !== 0) return;
      let end = 1;
      while (end < this.buffer.length && this.buffer[end] !== 0) end++;
      if (end >= this.buffer.length) return;
      const frame = cobsDecode(this.buffer.subarray(1, end));
      this.buffer = this.buffer.subarray(end + 1);
      this.onFrame(frame);
    }
  }

  onManagement(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const type = view.getUint8(0);
    const clientId = view.getBigUint64(1, true);
    if (type === 5) {                                   // CLOSE_ALL_REQ
      this.sendManagement(concat([Uint8Array.of(6), this.u64(clientId)]));
      return;
    }
    if (type === 0) {                                   // REGISTER_ML_REQ
      const serviceCode = view.getUint16(9, true);
      const status = serviceCode === 1 ? 0 : 1;
      this.sendManagement(concat([Uint8Array.of(1), this.u64(clientId), Uint8Array.of(serviceCode & 255, serviceCode >> 8, status, this.handle, 2)]));
    }
  }

  u64(value) {
    const out = new Uint8Array(8);
    let n = BigInt(value);
    for (let i = 0; i < 8; i++) { out[i] = Number(n & 0xffn); n >>= 8n; }
    return out;
  }

  sendManagement(payload) {
    this.onData(concat([Uint8Array.of(0), payload]));
  }

  sendFrame(id, payload) {
    const body = concat([Uint8Array.of(id & 255, id >> 8), payload]);
    const frame = concat([Uint8Array.of((body.length + 4) & 255, ((body.length + 4) >> 8) & 255), body]);
    const withCrc = concat([frame, Uint8Array.of(crc16(frame) & 255, crc16(frame) >> 8)]);
    this.onData(concat([Uint8Array.of(this.handle), Uint8Array.of(0), cobsEncode(withCrc), Uint8Array.of(0)]));
  }

  onFrame(frame) {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const id = view.getUint16(2, true);
    const payload = frame.subarray(4, frame.length - 2);
    this.frames.push({id, payload});
    if (id === 5005) this.onCreateFile(payload);
    else if (id === 5003) this.onUploadRequest(payload);
    else if (id === 5004) this.onTransferData(payload);
  }

  onCreateFile(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const size = view.getUint32(0, true);
    const dataType = view.getUint8(4);
    const subType = view.getUint8(5);
    this.file = {size, dataType, subType, bytes: new Uint8Array(size), written: 0, crcOk: true};
    this.receivedCrc = 0;
    const status = this.refuseCreate ? 1 : 0;
    this.sendFrame(5000, concat([
      Uint8Array.of(5005 & 255, 5005 >> 8), Uint8Array.of(0, status),
      Uint8Array.of(1, 0), Uint8Array.of(dataType, subType), Uint8Array.of(0, 0)
    ]));
  }

  onUploadRequest(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const size = view.getUint32(2, true);
    this.sendFrame(5000, concat([
      Uint8Array.of(5003 & 255, 5003 >> 8), Uint8Array.of(0, 0),
      Uint8Array.of(0, 0, 0, 0), Uint8Array.of(size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >> 24) & 255),
      Uint8Array.of(0, 0)
    ]));
  }

  onTransferData(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const crc = view.getUint16(1, true);
    const offset = view.getUint32(3, true);
    const chunk = payload.subarray(7);
    this.receivedCrc = crc16(chunk, this.receivedCrc);
    if (crc !== this.receivedCrc) this.file.crcOk = false;
    if (offset !== this.file.written) this.file.crcOk = false;
    this.file.bytes.set(chunk, offset);
    this.file.written += chunk.length;
    this.sendFrame(5000, concat([
      Uint8Array.of(5004 & 255, 5004 >> 8), Uint8Array.of(0, 0),
      Uint8Array.of(this.file.written & 255, (this.file.written >> 8) & 255, (this.file.written >> 16) & 255, (this.file.written >> 24) & 255)
    ]));
  }
}

module.exports = {MockWatch};
