const { test, expect } = require('@playwright/test');

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await page.getByRole('button', {name:/Beispielplan ausprobieren/}).click();
  await page.getByRole('button', {name:'Stats'}).click();
});

test('offers the Bluetooth transfer and explains when the browser cannot do it', async ({page}) => {
  await page.getByRole('button', {name:/Workout an die Uhr senden/}).click();
  const supported = await page.evaluate(() => GarminBle.isSupported());
  if (supported) {
    // Im Browser mit Web Bluetooth: die Geräteauswahl muss der Nutzer bedienen.
    return;
  }
  await expect(page.locator('#toast')).toContainText('Web Bluetooth fehlt');
  await expect(page.locator('#toast')).toHaveClass(/error/);
});

test('builds the workout file that the Bluetooth transfer would send', async ({page}) => {
  const bytes = await page.evaluate(() => {
    const workout = GarminAdapter.planToWorkout(getDay(state.currentDayIdx), state.workoutHistory);
    return Array.from(GarminAdapter.workoutToFit(workout));
  });
  expect(bytes.length).toBeGreaterThan(100);
  expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT');
  const frame = await page.evaluate(payload => {
    const frame = GarminBle.buildFrame(5004, Uint8Array.from(payload));
    return {length: frame.length, id: GarminBle.parseFrame(frame).id};
  }, bytes.slice(0, 4));
  expect(frame.id).toBe(5004);
  expect(frame.length).toBeGreaterThan(4);
});
