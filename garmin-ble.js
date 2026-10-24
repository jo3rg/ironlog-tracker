/* Garmin BLE: schickt ein Workout (.FIT) direkt an die Uhr.
   Protokoll: Garmin Multi-Link über GATT, GFDI-Nachrichten in COBS, Datei-Upload
   über CREATE_FILE -> UPLOAD_REQUEST -> FILE_TRANSFER_DATA.
   Ohne Fremdbibliotheken. Im Browser über Web Bluetooth nutzbar, im Node testbar
   (der Link erwartet nur ein Transport-Objekt). */
(function (root) {
  'use strict';

  const codec = root.GarminCodec;
  if (!codec) throw new Error('garmin-codec.js wird vor garmin-ble.js geladen.');

  const BASE_UUID = '6A4E%04X-667B-11E3-949A-0800200C9A66';
  const uuid = suffix => BASE_UUID.replace('%04X', suffix.toString(16).toUpperCase().padStart(4, '0'));
  const SERVICE_UUID = uuid(0x2800);
  const CHARACTERISTIC_PAIRS = [0x2810, 0x2811, 0x2812, 0x2813, 0x2814]
    .map(index => ({receive: uuid(index), send: uuid(index + 0x10)}));

  const REQUEST = {REGISTER_ML_REQ:0, REGISTER_ML_RESP:1, CLOSE_HANDLE_REQ:2, CLOSE_HANDLE_RESP:3, UNK_HANDLE:4, CLOSE_ALL_REQ:5, CLOSE_ALL_RESP:6, UNK_REQ:7};
  const SERVICE_GFDI = 1;
  const MSG = {RESPONSE:5000, UPLOAD_REQUEST:5003, FILE_TRANSFER_DATA:5004, CREATE_FILE:5005};
  const FILE_TYPE = {workout:{dataType:128, subType:5}};
  const CLIENT_ID = 2n;

  const u8 = value => [value & 255];
  const u16 = value => [value & 255, (value >>> 8) & 255];
  const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
  const u64 = value => {
    let n = BigInt(value);
    const out = [];
    for (let i = 0; i < 8; i++) { out.push(Number(n & 0xffn)); n >>= 8n; }
    return out;
  };
  const concat = parts => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  };

  /** GFDI-Rahmen: [u16 Länge][u16 Nachrichten-ID][Nutzdaten][u16 CRC]. */
  function buildFrame(id, payload) {
    const body = concat([u16(id), payload]);
    const frame = concat([u16(body.length + 4), body]);
    return concat([frame, u16(codec.crc16(frame))]);
  }

  function parseFrame(bytes) {
    if (bytes.length < 6) throw new Error('GFDI: Rahmen zu kurz.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint16(0, true);
    if (length !== bytes.length) throw new Error(`GFDI: Längenfeld ${length} passt nicht zu ${bytes.length} Bytes.`);
    const crc = view.getUint16(length - 2, true);
    if (crc !== codec.crc16(bytes.subarray(0, length - 2))) throw new Error('GFDI: CRC stimmt nicht.');
    return {id: view.getUint16(2, true), payload: bytes.subarray(4, length - 2)};
  }

  /** Garmin rahmt COBS mit einer führenden und einer abschließenden Null. */
  function encodeCobsFrame(frame) {
    return concat([u8(0), codec.cobsEncode(frame), u8(0)]);
  }

  class GarminLink {
    constructor(transport, options = {}) {
      this.transport = transport;
      this.clientId = options.clientId ?? CLIENT_ID;
      this.handle = null;
      this.received = [];
      this.waiters = [];
      this.buffer = new Uint8Array(0);
      this.chunkSize = options.chunkSize ?? 19;
    }

    onNotification(value) {
      if (!value || !value.length) return;
      const handle = value[0];
      if (handle === 0) { this.onHandleManagement(value.subarray(1)); return; }
      this.buffer = concat([this.buffer, value.subarray(1)]);
      this.drainBuffer();
    }

    drainBuffer() {
      for (;;) {
        if (this.buffer.length < 2 || this.buffer[0] !== 0) return;
        let end = 1;
        while (end < this.buffer.length && this.buffer[end] !== 0) end++;
        if (end >= this.buffer.length) return;                 // Frame noch unvollständig
        const frame = codec.cobsDecode(this.buffer.subarray(1, end));
        this.buffer = this.buffer.subarray(end + 1);
        this.dispatch(frame);
      }
    }

    dispatch(frame) {
      let parsed;
      try {
        parsed = parseFrame(frame);
      } catch (err) {
        this.rejectWaiters(err);
        return;
      }
      if (parsed.id === MSG.RESPONSE) {
        const status = this.parseStatus(parsed.payload);
        this.resolveWaiters(status);
        if (status && status.originalId === MSG.FILE_TRANSFER_DATA) this.acknowledge(status);
      }
    }

    parseStatus(payload) {
      if (payload.length < 3) return null;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const originalId = view.getUint16(0, true);
      const status = {originalId, status: view.getUint8(2)};
      if (originalId === MSG.CREATE_FILE && payload.length >= 10) {
        status.createStatus = view.getUint8(3);
        status.fileIndex = view.getUint16(4, true);
        status.dataType = view.getUint8(6);
        status.subType = view.getUint8(7);
      } else if (originalId === MSG.UPLOAD_REQUEST && payload.length >= 14) {
        status.uploadStatus = view.getUint8(3);
        status.dataOffset = view.getInt32(4, true);
        status.maxFileSize = view.getInt32(8, true);
        status.crcSeed = view.getUint16(12, true);
      } else if (originalId === MSG.FILE_TRANSFER_DATA && payload.length >= 8) {
        status.transferStatus = view.getUint8(3);
        status.dataOffset = view.getInt32(4, true);
      }
      return status;
    }

    acknowledge(status) {
      const payload = concat([
        u16(MSG.RESPONSE), u16(status.originalId), u8(status.status),
        u8(status.transferStatus ?? 0), u32(status.dataOffset ?? 0)
      ]);
      this.sendFrame(buildFrame(MSG.RESPONSE, payload)).catch(() => {});
    }

    onHandleManagement(bytes) {
      if (bytes.length < 9) return;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const type = view.getUint8(0);
      const clientId = view.getBigUint64(1, true);
      if (clientId !== this.clientId) return;
      if (type === REQUEST.REGISTER_ML_RESP && bytes.length >= 14) {
        const status = view.getUint8(11);
        if (status === 0) this.handle = view.getUint8(12);
        this.resolveWaiters({kind:'register', status, handle: this.handle});
      } else if (type === REQUEST.CLOSE_ALL_RESP) {
        this.resolveWaiters({kind:'closeAll'});
      }
    }

    resolveWaiters(value) {
      const index = this.waiters.findIndex(waiter => waiter.match(value));
      if (index < 0) return;
      const [waiter] = this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(value);
    }

    rejectWaiters(error) {
      const waiters = this.waiters.splice(0, this.waiters.length);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }

    waitFor(match, timeoutMs = 8000, label = 'Antwort') {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter(waiter => waiter.resolve !== resolve);
          reject(new Error(`Garmin: keine ${label} erhalten (${timeoutMs} ms).`));
        }, timeoutMs);
        this.waiters.push({match, resolve, reject, timer});
      });
    }

    async writeRaw(bytes) {
      await this.transport.write(bytes);
    }

    async sendFrame(frame) {
      const payload = encodeCobsFrame(frame);
      for (let offset = 0; offset < payload.length; offset += this.chunkSize) {
        const piece = payload.subarray(offset, Math.min(offset + this.chunkSize, payload.length));
        await this.writeRaw(concat([u8(this.handle ?? 0), piece]));
      }
    }

    async openSession() {
      const closed = this.waitFor(value => value.kind === 'closeAll', 5000, 'CLOSE_ALL_RESP');
      await this.writeRaw(concat([u8(0), u8(REQUEST.CLOSE_ALL_REQ), u64(this.clientId), u16(0)]));
      await closed;
      const registered = this.waitFor(value => value.kind === 'register', 5000, 'REGISTER_ML_RESP');
      await this.writeRaw(concat([u8(0), u8(REQUEST.REGISTER_ML_REQ), u64(this.clientId), u16(SERVICE_GFDI), u8(2)]));
      const response = await registered;
      if (response.status !== 0 || response.handle === null) throw new Error('Garmin: Uhr hat den GFDI-Kanal nicht freigegeben.');
      return response.handle;
    }

    async sendRequest(id, payload, expectedId, label) {
      const answer = this.waitFor(status => status.originalId === expectedId, 8000, label);
      await this.sendFrame(buildFrame(id, payload));
      return answer;
    }

    /**
     * Legt die Datei auf der Uhr an und überträgt sie.
     * @param {Uint8Array} bytes Dateiinhalt
     * @param {{onProgress?: (sent:number,total:number)=>void, fileType?: string}} options
     */
    async uploadFile(bytes, options = {}) {
      const total = bytes.length;
      const fileType = FILE_TYPE[options.fileType || 'workout'];
      const onProgress = options.onProgress || (() => {});

      const create = concat([
        u32(total), u8(fileType.dataType), u8(fileType.subType), u16(0),
        u8(0), u8(0), u16(0xffff), u16(0), u64(BigInt.asUintN(64, (BigInt(Date.now()) << 16n) ^ BigInt(Math.floor(Math.random() * 0xffff))))
      ]);
      const created = await this.sendRequest(MSG.CREATE_FILE, create, MSG.CREATE_FILE, 'CREATE_FILE-Status');
      if (created.status !== 0 || created.createStatus !== 0) {
        throw new Error(`Garmin: Datei konnte nicht angelegt werden (Status ${created.status}/${created.createStatus}).`);
      }

      const upload = concat([u16(created.fileIndex ?? 0), u32(total), u32(0), u16(0)]);
      const started = await this.sendRequest(MSG.UPLOAD_REQUEST, upload, MSG.UPLOAD_REQUEST, 'UPLOAD_REQUEST-Status');
      if (started.status !== 0 || started.uploadStatus !== 0) {
        throw new Error(`Garmin: Übertragung nicht freigegeben (Status ${started.status}/${started.uploadStatus}).`);
      }
      if (started.dataOffset) throw new Error(`Garmin: Uhr erwartet Offset ${started.dataOffset}.`);

      let offset = 0;
      let runningCrc = 0;
      const budget = Math.max(1, this.chunkSize - 4);
      while (offset < total) {
        const size = Math.min(budget, total - offset);
        const chunk = bytes.subarray(offset, offset + size);
        runningCrc = codec.crc16(chunk, runningCrc);
        const payload = concat([u8(0), u16(runningCrc), u32(offset), chunk]);
        const done = await this.sendRequest(MSG.FILE_TRANSFER_DATA, payload, MSG.FILE_TRANSFER_DATA, 'FILE_TRANSFER_DATA-Status');
        if (done.status !== 0 || done.transferStatus !== 0) {
          throw new Error(`Garmin: Übertragung bei ${offset} Bytes abgebrochen (Status ${done.status}/${done.transferStatus}).`);
        }
        offset += size;
        onProgress(offset, total);
        if (done.dataOffset && done.dataOffset !== offset) {
          throw new Error(`Garmin: Uhr erwartet Offset ${done.dataOffset}, gesendet ${offset}.`);
        }
      }
      return {bytes: total};
    }
  }

  /** Transport über Web Bluetooth. */
  class WebBluetoothTransport {
    constructor(device) {
      this.device = device;
      this.onData = () => {};
    }
    async connect() {
      this.server = await this.device.gatt.connect();
      this.service = await this.server.getPrimaryService(SERVICE_UUID);
      for (const pair of CHARACTERISTIC_PAIRS) {
        try {
          this.receive = await this.service.getCharacteristic(pair.receive);
          this.send = await this.service.getCharacteristic(pair.send);
          this.pair = pair;
          break;
        } catch (err) {
          this.receive = this.send = null;
        }
      }
      if (!this.send) throw new Error('Garmin: Multi-Link-Kanal in der Uhr nicht gefunden.');
      this.receive.addEventListener('characteristicvaluechanged', event => {
        const value = event.target.value;
        this.onData(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      });
      await this.receive.startNotifications();
    }
    async write(bytes) {
      if (this.send.writeValueWithoutResponse) await this.send.writeValueWithoutResponse(bytes);
      else await this.send.writeValue(bytes);
    }
    disconnect() {
      if (this.device.gatt.connected) this.device.gatt.disconnect();
    }
  }

  function isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  async function requestDevice() {
    if (!isSupported()) throw new Error('Web Bluetooth wird von diesem Browser nicht unterstützt (Chrome, Edge oder Android).');
    return navigator.bluetooth.requestDevice({
      filters: [{services: [SERVICE_UUID]}],
      optionalServices: [SERVICE_UUID]
    });
  }

  /**
   * Schickt das Workout an die Uhr.
   * @param {object} device Web-Bluetooth-Gerät
   * @param {Uint8Array} bytes .FIT-Datei
   */
  async function pushWorkout(device, bytes, options = {}) {
    const transport = new WebBluetoothTransport(device);
    await transport.connect();
    const link = new GarminLink(transport, options);
    transport.onData = value => link.onNotification(value);
    try {
      await link.openSession();
      return await link.uploadFile(bytes, options);
    } finally {
      transport.disconnect();
    }
  }

  root.GarminBle = {GarminLink, SERVICE_UUID, CHARACTERISTIC_PAIRS, buildFrame, encodeCobsFrame, isSupported, parseFrame, pushWorkout, requestDevice};
})(typeof window !== 'undefined' ? window : globalThis);
