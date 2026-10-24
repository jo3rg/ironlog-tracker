const { test, expect } = require('@playwright/test');

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await page.getByRole('button', {name:/Beispielplan ausprobieren/}).click();
});

test('encodes and decodes the protobuf messages of the Garmin link', async ({page}) => {
  const result = await page.evaluate(() => {
    const {encodeMessage, decodeMessage, cobsEncode, cobsDecode} = GarminCodec;
    const uploadRequest = encodeMessage([
      {no:1, type:'message', value: encodeMessage([
        {no:1, type:'message', value: encodeMessage([{no:1, type:'fixed64', value:0x1122334455667788n}])},
        {no:2, type:'message', value: encodeMessage([{no:1, type:'uint32', value:0}, {no:2, type:'string', value:'FIT_TYPE_6'}, {no:3, type:'uint32', value:9}])},
        {no:3, type:'uint64', value:1823}
      ])},
      {no:2, type:'uint32', value:34},
      {no:3, type:'uint32', value:0},
      {no:4, type:'uint32', value:15}
    ]);
    const decoded = decodeMessage(uploadRequest);
    const file = decodeMessage(decoded.get(1)[0]);
    const type = decodeMessage(file.get(2)[0]);
    const fileId = decodeMessage(file.get(1)[0]);
    const cobsRoundTrip = decodeMessage(cobsDecode(cobsEncode(uploadRequest))).get(2)[0];
    return {
      unk2: Number(decoded.get(2)[0]),
      unk4: Number(decoded.get(4)[0]),
      fileSize: Number(file.get(3)[0]),
      typeName: new TextDecoder().decode(type.get(2)[0]),
      typeNameId: Number(type.get(3)[0]),
      id1: fileId.get(1)[0].toString(16),
      cobsUnk2: Number(cobsRoundTrip)
    };
  });
  expect(result.unk2).toBe(34);
  expect(result.unk4).toBe(15);
  expect(result.fileSize).toBe(1823);
  expect(result.typeName).toBe('FIT_TYPE_6');
  expect(result.typeNameId).toBe(9);
  expect(result.id1).toBe('1122334455667788');
  expect(result.cobsUnk2).toBe(34);
});

test('keeps zero bytes intact through COBS', async ({page}) => {
  const result = await page.evaluate(() => {
    const {cobsEncode, cobsDecode} = GarminCodec;
    const input = Uint8Array.from([0, 1, 0, 0, 2]);
    return Array.from(cobsDecode(cobsEncode(input)));
  });
  expect(result).toEqual([0, 1, 0, 0, 2]);
});
