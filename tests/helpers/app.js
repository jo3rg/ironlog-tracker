/* Hilfsfunktionen, um IRON.LOG im Browser zu bedienen. */
const { expect } = require('@playwright/test');

async function openApp(page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await page.getByRole('button', {name:/Beispielplan ausprobieren/}).click();
  await page.getByRole('button', {name:'Stats'}).click();
}

async function importFit(page, buffer, name = 'garmin-activity.fit') {
  await page.locator('#garminActivityFile').setInputFiles({name, mimeType:'application/octet-stream', buffer});
}

async function readHistory(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ironlog_v1') || '{}').workoutHistory || []);
}

async function expectToast(page, message) {
  await expect(page.locator('#toast')).toContainText(message, {timeout:5000});
}

async function planDays(page) {
  return page.evaluate(() => {
    const plan = getActivePlan();
    return plan.days.map((day, index) => ({
      index,
      code: day.code,
      name: day.name,
      format: day.format || 'standard',
      exercises: (day.exercises || []).map(ex => ({id:ex.id, name:ex.name}))
    }));
  });
}

async function buildWorkout(page, dayIndex) {
  return page.evaluate(index => {
    const workout = GarminAdapter.planToWorkout(getDay(index), state.workoutHistory);
    const bytes = GarminAdapter.workoutToFit(workout);
    return {
      name: workout.name,
      exercises: workout.exercises.map(ex => ({name:ex.name, category:ex.category, code:ex.code, reps:ex.reps, timed:ex.timed})),
      bytes: Array.from(bytes)
    };
  }, dayIndex);
}

module.exports = {buildWorkout, expectToast, importFit, openApp, planDays, readHistory};
