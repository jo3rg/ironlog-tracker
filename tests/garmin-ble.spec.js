const { test, expect } = require('@playwright/test');
const { MockWatch } = require('./helpers/mock-watch');

globalThis.window = globalThis;
require('../garmin-codec.js');
require('../garmin-ble.js');
const { GarminLink } = globalThis.GarminBle;

const workout = Uint8Array.from(Array.from({length: 700}, (_, index) => index % 251));

function linkTo(watch) {
  const link = new GarminLink(watch.transport, {chunkSize: 19});
  watch.onData = value => link.onNotification(value);
  return link;
}

test('pushes a workout to the watch and the bytes arrive unchanged', async () => {
  const watch = new MockWatch();
  const link = linkTo(watch);
  const progress = [];

  await link.openSession();
  expect(link.handle).toBe(watch.handle);
  await link.uploadFile(workout, {onProgress: (sent, total) => progress.push([sent, total])});

  expect(watch.file.dataType).toBe(128);
  expect(watch.file.subType).toBe(5);
  expect(watch.file.size).toBe(workout.length);
  expect(watch.file.written).toBe(workout.length);
  expect(watch.file.crcOk).toBe(true);
  expect(Array.from(watch.file.bytes)).toEqual(Array.from(workout));
  expect(progress.at(-1)).toEqual([workout.length, workout.length]);
  const ids = watch.frames.map(frame => frame.id);
  expect(ids[0]).toBe(5005);
  expect(ids[1]).toBe(5003);
  expect(ids.filter(id => id === 5004).length).toBe(Math.ceil(workout.length / 15));
  expect(ids.filter(id => id === 5000).length).toBe(Math.ceil(workout.length / 15));
});

test('reports a refusal from the watch instead of pretending success', async () => {
  const watch = new MockWatch({refuseCreate: true});
  const link = linkTo(watch);
  await link.openSession();
  await expect(link.uploadFile(workout)).rejects.toThrow(/Datei konnte nicht angelegt werden/);
});

test('keeps the frame length and CRC of the GFDI messages consistent', async () => {
  const { buildFrame, parseFrame } = globalThis.GarminBle;
  const frame = buildFrame(5004, Uint8Array.from([1, 2, 3, 4]));
  const parsed = parseFrame(frame);
  expect(parsed.id).toBe(5004);
  expect(Array.from(parsed.payload)).toEqual([1, 2, 3, 4]);
  const broken = frame.slice();
  broken[broken.length - 1] ^= 0xff;
  expect(() => parseFrame(broken)).toThrow(/CRC/);
});
