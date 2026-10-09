import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, account = 'support') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function auth(page: Page) {
  return { Authorization: `Bearer ${await page.evaluate(() => JSON.parse(sessionStorage.getItem('connectsphere.session')!).accessToken)}` };
}
async function openRequest(page: Page) {
  await page.getByRole('button', { name: /Wireless microphones/ }).click();
  await expect(page.getByRole('region', { name: 'Equipment requirements', exact: true })).toBeVisible();
}
const availability = (page: Page, type = 'Wireless microphones') => page.getByRole('region', { name: `Availability for ${type}`, exact: true });
async function fact(page: Page, label: string, value: string, type = 'Wireless microphones') {
  const field = availability(page, type).getByText(label, { exact: true }).locator('..');
  await expect(field.getByText(value, { exact: true })).toBeVisible();
}
async function chosen(page: Page, start = '2030-06-20T10:00', end = '2030-06-20T14:00') {
  await availability(page).getByLabel('Availability starts (Singapore time)', { exact: true }).fill(start);
  await availability(page).getByLabel('Availability ends (Singapore time)', { exact: true }).fill(end);
  await availability(page).getByRole('button', { name: 'Check selected dates', exact: true }).click();
}
async function ledger(page: Page) { return (await page.request.get('/__e2e/equipment-availability-ledger')).json(); }

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/__e2e/reset')).status()).toBe(204);
  expect((await page.request.post('/__e2e/equipment-availability')).status()).toBe(204);
});

test('SG2-54-P01 | [NORMAL] [SG2-54:AC1] [SG2-54:AC2] [SG2-54:AC3] support sees peak commitments, shortfall and unavailable stock without altering the ledger', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page); await openRequest(page);
  const before = await ledger(page);
  await availability(page).getByRole('button', { name: 'Check availability for Wireless microphones', exact: true }).click();
  await fact(page, 'Quantity held', '20'); await fact(page, 'Committed to other events (peak)', '14');
  await fact(page, 'Quantity remaining', '6'); await fact(page, 'Quantity requested', '10'); await fact(page, 'Calculated shortfall', '4');
  await fact(page, 'Period source', 'Confirmed venue bookings');
  for (const [type, held, requested, note] of [['Maintenance projector', '5', '3', 'under maintenance'], ['Damaged speakers', '7', '2', 'Damaged equipment']]) {
    await availability(page, type).getByRole('button', { name: `Check availability for ${type}`, exact: true }).click();
    await fact(page, 'Quantity held', held, type); await fact(page, 'Quantity remaining', '0', type);
    await fact(page, 'Calculated shortfall', requested, type);
    await expect(availability(page, type).getByRole('note')).toContainText(note);
  }
  expect(await ledger(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.SG2_54_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_54_SCREENSHOTS}/availability-desktop.png`, fullPage: true });
});

test('SG2-54-P02 | [NORMAL] [BOUNDARY] [SG2-54:AC1] [SG2-54:AC3] mobile support supplies missing dates and conservatively includes undated commitments', async ({ page }) => {
  expect((await page.request.post('/__e2e/reset')).status()).toBe(204);
  expect((await page.request.post('/__e2e/equipment-availability', { data: { missing_dates: true, undated: true } })).status()).toBe(204);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page); await openRequest(page);
  await availability(page).getByRole('button', { name: 'Check availability for Wireless microphones', exact: true }).click();
  await expect(availability(page).getByRole('status')).toContainText('A complete period is needed');
  await expect(availability(page).getByLabel('Availability starts (Singapore time)', { exact: true })).toHaveValue('2030-06-20T10:00');
  await expect(availability(page).getByLabel('Availability ends (Singapore time)', { exact: true })).toHaveValue('');
  await chosen(page);
  await fact(page, 'Committed to other events (peak)', '17'); await fact(page, 'Quantity remaining', '3'); await fact(page, 'Calculated shortfall', '7');
  await fact(page, 'Period source', 'Selected dates');
  await expect(availability(page).getByRole('note')).toContainText('1 reservation(s) have no recorded period');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.SG2_54_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_54_SCREENSHOTS}/availability-mobile.png`, fullPage: true });
});

test('SG2-54-B01 | [BOUNDARY] [FAILURE] [SG2-54:AC1] [SG2-54:AC3] equal endpoints are refused and reservations ending at the chosen start do not overlap', async ({ page }) => {
  await signIn(page); await openRequest(page);
  await availability(page).getByRole('button', { name: 'Check availability for Wireless microphones', exact: true }).click();
  await fact(page, 'Quantity remaining', '6');
  await chosen(page, '2030-06-20T14:00', '2030-06-20T14:00');
  await expect(availability(page).getByRole('alert')).toHaveText('Choose both dates, with the end after the start.');
  await expect(availability(page).getByText('Quantity remaining', { exact: true })).toHaveCount(0);
  const response = await page.request.get('/api/equipment-requests/1/availability?event_id=54&starts_at=2030-06-20T06:00:00Z&ends_at=2030-06-20T06:00:00Z', { headers: await auth(page) });
  expect(response.status()).toBe(400);
  await chosen(page, '2030-06-20T14:00', '2030-06-20T15:00');
  await fact(page, 'Committed to other events (peak)', '0'); await fact(page, 'Quantity remaining', '20'); await fact(page, 'Calculated shortfall', '0');
});

test('SG2-54-C01 | [CONFLICT] [SG2-54:AC1] [SG2-54:AC3] refreshing a confirmed event reflects a newly committed quantity without recording an arrangement shortfall', async ({ page }) => {
  expect((await page.request.post('/__e2e/reset')).status()).toBe(204);
  expect((await page.request.post('/__e2e/equipment-availability', { data: { confirmed: true, request_dates: true } })).status()).toBe(204);
  await signIn(page); await openRequest(page);
  await expect(page.getByRole('button', { name: 'Update arrangement for Wireless microphones', exact: true })).toHaveCount(0);
  await availability(page).getByRole('button', { name: 'Check availability for Wireless microphones', exact: true }).click();
  await fact(page, 'Period source', 'Equipment request'); await fact(page, 'Calculated shortfall', '4');
  expect((await page.request.post('/__e2e/equipment-availability-change')).status()).toBe(204);
  await availability(page).getByRole('button', { name: 'Refresh availability', exact: true }).click();
  await fact(page, 'Committed to other events (peak)', '18'); await fact(page, 'Quantity remaining', '2'); await fact(page, 'Calculated shortfall', '8');
  expect((await ledger(page)).requests[0]).toMatchObject({ quantity: 10, shortfall: null, version: 1 });
});

test('SG2-54-N01 | [FAILURE] [SG2-54:AC1] [SG2-54:AC3] role guards deny access and a failed refresh clears the old calculation before successful retry', async ({ page }) => {
  expect((await page.request.get('/api/equipment-requests/1/availability?event_id=54')).status()).toBe(401);
  const login = await page.request.post('/api/auth/login', { data: { email: 'coordinator@example.test', password: 'Regression123!' } });
  expect(login.status()).toBe(200);
  expect((await page.request.get('/api/equipment-requests/1/availability?event_id=54', { headers: { Authorization: `Bearer ${(await login.json()).accessToken}` } })).status()).toBe(403);
  await signIn(page); await openRequest(page);
  await availability(page).getByRole('button', { name: 'Check availability for Wireless microphones', exact: true }).click();
  await fact(page, 'Calculated shortfall', '4');
  await page.route('**/api/equipment-requests/1/availability?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unavailable' }) }));
  await availability(page).getByRole('button', { name: 'Refresh availability', exact: true }).click();
  await expect(availability(page).getByRole('alert')).toContainText('try again');
  await expect(availability(page).getByText('Calculated shortfall', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/equipment-requests/1/availability?*');
  await availability(page).getByRole('button', { name: 'Refresh availability', exact: true }).click();
  await fact(page, 'Calculated shortfall', '4');
});
