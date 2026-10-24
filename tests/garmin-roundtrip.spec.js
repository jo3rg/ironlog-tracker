const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const {buildWorkout, expectToast, importFit, openApp, readHistory} = require('./helpers/app');
const {strengthActivity} = require('./helpers/fit');

test('exports a plan and imports the completed activity without copying files by hand', async ({page}) => {
  await openApp(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', {name:/Garmin-Workout/}).click()
  ]);
  expect(download.suggestedFilename()).toBe('ironlog-ua.fit');
  const exportedBytes = await fs.readFile(await download.path());
  expect(exportedBytes.subarray(8, 12).toString('ascii')).toBe('.FIT');
  expect(exportedBytes.length).toBeGreaterThan(100);

  const workout = await buildWorkout(page, 0);
  const activityBytes = strengthActivity({
    exercises: workout.exercises.map(ex => ({
      category: ex.category,
      code: ex.code,
      name: ex.name,
      sets: [{reps: 8, weightKg: 80, durationMs: 30_000}, {reps: 7, weightKg: 85, durationMs: 30_000}]
    }))
  });

  await importFit(page, activityBytes, 'watch-activity.fit');
  await expectToast(page, `Garmin-Training importiert: ${workout.exercises.length * 2} Sätze.`);

  const history = await readHistory(page);
  expect(history).toHaveLength(1);
  expect(history[0].exercises).toHaveLength(workout.exercises.length);
  expect(history[0].exercises.reduce((sum, ex) => sum + ex.sets.length, 0)).toBe(workout.exercises.length * 2);
});
