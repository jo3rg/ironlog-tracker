const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers/app');

test('builds a Garmin Connect strength workout with sets, rest, reps, and saved weight', async ({page}) => {
  await openApp(page);
  const payload = await page.evaluate(() => GarminConnectAdapter.buildWorkout(getDay(0), [{ exercises: [{ id: 'ua1', sets: [{ w: 82.5 }] }] } ]));

  expect(payload.sportType).toMatchObject({ sportTypeId: 5, sportTypeKey: 'strength_training' });
  expect(payload.workoutSegments).toHaveLength(1);
  const groups = payload.workoutSegments[0].workoutSteps;
  expect(groups).toHaveLength(7);
  expect(groups[0]).toMatchObject({ type: 'RepeatGroupDTO', numberOfIterations: 4, skipLastRestStep: true });
  expect(groups[0].workoutSteps[0]).toMatchObject({
    type: 'ExecutableStepDTO', category: 'BENCH_PRESS', exerciseName: 'BARBELL_BENCH_PRESS',
    endCondition: { conditionTypeId: 10, conditionTypeKey: 'reps' }, endConditionValue: 6,
    weightValue: 82.5, weightUnit: { unitKey: 'kilogram' }
  });
  expect(groups[0].workoutSteps[1]).toMatchObject({ stepType: { stepTypeKey: 'rest' }, endConditionValue: 180 });
});

test('refuses to export an exercise without an explicit Garmin catalog mapping', async ({page}) => {
  await openApp(page);
  const result = await page.evaluate(() => {
    try {
      GarminConnectAdapter.buildWorkout({ name: 'Test', exercises: [{ name: 'Unbekannte Übung', sets: 3, reps: '8' }] }, []);
      return null;
    } catch (error) {
      return error.message;
    }
  });
  expect(result).toContain('Keine Garmin-Connect-Übung');
  expect(result).toContain('Unbekannte Übung');
});

test('downloads the selected workout as Connect JSON from the app UI', async ({page}) => {
  await openApp(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Connect-Workout/ }).click()
  ]);
  expect(download.suggestedFilename()).toBe('ironlog-ua-connect.json');
  const fs = require('node:fs/promises');
  const payload = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(payload.sportType.sportTypeKey).toBe('strength_training');
  expect(payload.workoutSegments[0].workoutSteps.length).toBeGreaterThan(0);
});
