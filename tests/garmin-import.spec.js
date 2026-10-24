const { test, expect } = require('@playwright/test');
const { buildWorkout, expectToast, importFit, openApp, readHistory } = require('./helpers/app');
const {fitTime, garbageFile, runningActivity, strengthActivity, truncatedFit} = require('./helpers/fit');

test('imports a completed strength activity with plan exercises and session values', async ({page}) => {
  await openApp(page);
  const workout = await buildWorkout(page, 0);
  const bytes = strengthActivity({
    exercises: workout.exercises.map(ex => ({
      category: ex.category,
      code: ex.code,
      name: ex.name,
      sets: [{reps: 8, weightKg: 80, durationMs: 30_000}, {reps: 7, weightKg: 85, durationMs: 30_000}]
    }))
  });

  await importFit(page, bytes);
  await expectToast(page, `Garmin-Training importiert: ${workout.exercises.length * 2} Sätze.`);

  const history = await readHistory(page);
  expect(history).toHaveLength(1);
  const [entry] = history;
  expect(entry.dayCode).toBe('UA');
  expect(entry.exercises).toHaveLength(workout.exercises.length);
  expect(entry.exercises.map(ex => ex.name)).toEqual(workout.exercises.map(ex => ex.name));
  expect(entry.exercises.every(ex => ex.id)).toBe(true);
  expect(entry.exercises.flatMap(ex => ex.sets).map(set => [set.w, set.r])).toEqual(
    entry.exercises.flatMap(() => [[80, 8], [85, 7]])
  );
  expect(entry.garmin).toMatchObject({durationSec: 1800, calories: 220, avgHR: 138, maxHR: 166, totalSets: workout.exercises.length * 2});
});

test('ignores rest sets and keeps timed sets as seconds', async ({page}) => {
  await openApp(page);
  const workout = await buildWorkout(page, 1);
  const plank = workout.exercises.find(ex => ex.name === 'Plank');
  expect(plank).toBeTruthy();

  const bytes = strengthActivity({
    exercises: [{category: plank.category, code: plank.code, name: plank.name, sets: [{durationMs: 45_000}]}],
    restMs: 60_000
  });

  await importFit(page, bytes);
  await expectToast(page, 'Garmin-Training importiert: 1 Sätze.');

  const [entry] = await readHistory(page);
  expect(entry.exercises).toHaveLength(1);
  expect(entry.exercises[0].sets).toHaveLength(1);
  expect(entry.exercises[0].sets[0].time_s).toBe(45);
  expect(entry.exercises[0].sets[0].r).toBeUndefined();
});

test('dates the workout by the UTC start time, not the local activity time', async ({page}) => {
  await openApp(page);
  const workout = await buildWorkout(page, 0);
  const start = new Date('2026-10-20T23:30:00Z');
  const bytes = strengthActivity({
    exercises: workout.exercises.slice(0, 2).map(ex => ({
      category: ex.category, code: ex.code, name: ex.name, sets: [{reps: 8, weightKg: 60, durationMs: 30_000}]
    })),
    start,
    localTimestamp: fitTime(new Date('2026-10-21T01:30:00Z'))
  });

  await importFit(page, bytes);
  await expectToast(page, 'Garmin-Training importiert: 2 Sätze.');

  const [entry] = await readHistory(page);
  expect(entry.date).toBe('2026-10-20');
});

test('rejects files that are no strength activity and keeps the history untouched', async ({page}) => {
  await openApp(page);

  await importFit(page, runningActivity(), 'running.fit');
  await expectToast(page, 'Die FIT-Datei enthält keine Garmin-Krafttrainingsaktivität.');
  await expect(page.locator('#toast')).toHaveClass(/error/);

  await importFit(page, garbageFile(), 'not-a-fit.fit');
  await expectToast(page, 'Keine gültige Garmin-FIT-Datei.');

  const valid = strengthActivity({exercises: [{category: 0, code: 1, name: 'Bankdrücken Langhantel', sets: [{reps: 8, weightKg: 80, durationMs: 30_000}]}]});
  await importFit(page, truncatedFit(valid), 'truncated.fit');
  await expectToast(page, 'Die FIT-Datei ist unvollständig.');

  const prescription = await page.evaluate(() => Array.from(GarminAdapter.workoutToFit(GarminAdapter.planToWorkout(getDay(0), state.workoutHistory))));
  await importFit(page, Buffer.from(prescription), 'workout.fit');
  await expectToast(page, 'Das ist eine FIT-Workout-Datei, keine abgeschlossene Aktivität.');

  expect(await readHistory(page)).toHaveLength(0);
});

test('imports the same activity only once', async ({page}) => {
  await openApp(page);
  const workout = await buildWorkout(page, 0);
  const bytes = strengthActivity({
    exercises: workout.exercises.slice(0, 2).map(ex => ({
      category: ex.category, code: ex.code, name: ex.name, sets: [{reps: 8, weightKg: 80, durationMs: 30_000}]
    }))
  });

  await importFit(page, bytes);
  await expectToast(page, 'Garmin-Training importiert: 2 Sätze.');
  await importFit(page, bytes);
  await expectToast(page, 'Diese Garmin-FIT-Aktivität wurde bereits importiert.');

  expect(await readHistory(page)).toHaveLength(1);
});
