const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Decoder, Stream } = require('@garmin/fitsdk');
const { buildWorkout, openApp, planDays } = require('./helpers/app');

test('exports every plan day as a valid Garmin workout', async ({page}) => {
  await openApp(page);
  const days = await planDays(page);
  expect(days.length).toBeGreaterThan(0);

  for (const day of days) {
    const workout = await buildWorkout(page, day.index);
    const decoder = new Decoder(Stream.fromByteArray(workout.bytes));
    expect(decoder.checkIntegrity(), `CRC von ${day.code}`).toBe(true);

    const {messages, errors} = decoder.read();
    expect(errors, `Decode-Fehler in ${day.code}`).toEqual([]);
    expect(messages.workoutMesgs).toHaveLength(1);
    expect(messages.workoutMesgs[0].wktName).toBe(day.name.slice(0, 32));
    expect(messages.workoutStepMesgs.length).toBeGreaterThan(0);
    expect(messages.exerciseTitleMesgs).toHaveLength(day.exercises.length);
    expect(messages.exerciseTitleMesgs.map(m => m.wktStepName)).toEqual(day.exercises.map(ex => ex.name));
  }
});

test('keeps unmapped exercises as custom titles inside the workout', async ({page}) => {
  await openApp(page);
  const days = await planDays(page);
  const upperA = days.find(day => day.code === 'UA');
  const unmapped = upperA.exercises.find(ex => /Klimmzüge/.test(ex.name));
  expect(unmapped).toBeTruthy();

  const workout = await buildWorkout(page, upperA.index);
  const {messages} = new Decoder(Stream.fromByteArray(workout.bytes)).read();
  const title = messages.exerciseTitleMesgs.find(m => m.wktStepName === unmapped.name);
  expect(title).toBeTruthy();
  expect(title.exerciseCategory).toBe('unknown');
});

test('the file for the watch matches the workout the app exports', async ({page}) => {
  await openApp(page);
  const workout = await buildWorkout(page, 0);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ironlog-fit-'));
  execFileSync('node', ['tools/export-workout.mjs', '--day', 'UA', '--out', outDir], {cwd: path.resolve(__dirname, '..')});
  const cliBytes = fs.readFileSync(path.join(outDir, 'ironlog-ua.fit'));

  const fromApp = new Decoder(Stream.fromByteArray(workout.bytes)).read();
  const fromCli = new Decoder(Stream.fromByteArray(Array.from(cliBytes))).read();
  expect(fromCli.messages.workoutMesgs[0].wktName).toBe(fromApp.messages.workoutMesgs[0].wktName);
  expect(fromCli.messages.workoutStepMesgs).toEqual(fromApp.messages.workoutStepMesgs);
  expect(fromCli.messages.exerciseTitleMesgs).toEqual(fromApp.messages.exerciseTitleMesgs);
});
