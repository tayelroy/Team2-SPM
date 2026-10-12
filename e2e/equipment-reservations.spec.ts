import { expect, test, type Page } from '@playwright/test';

const period = { starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' };
async function signIn(page: Page, account = 'support') {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function auth(page: Page, account = 'support') {
  const response = await page.request.post('/api/auth/login', { data: { email: `${account}@example.test`, password: 'Regression123!' } });
  expect(response.status()).toBe(200); return { Authorization: `Bearer ${(await response.json()).accessToken}` };
}
const panel = (page: Page) => page.getByRole('region', { name: 'Equipment reservations', exact: true });
const receipt = (page: Page) => panel(page).getByRole('article', { name: 'Reserved equipment: Wireless microphones', exact: true });
async function openSupport(page: Page, name = 'Equipment Reservation Forum') {
  await page.getByRole('button', { name: new RegExp(`Wireless microphones.*${name}`) }).click();
  await expect(panel(page).getByText('No equipment reservations recorded.', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Reserve Wireless microphones', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Reserve equipment', exact: true })).toBeEnabled();
}
async function fact(page: Page, name: string, expected: string) {
  await expect(receipt(page).getByText(name, { exact: true }).locator('..').getByText(expected, { exact: true })).toBeVisible();
}
async function ledger(page: Page) { return (await page.request.get('/__e2e/equipment-reservations-ledger')).json(); }

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/equipment-reservations')).status()).toBe(204);
});

test('SG2-55-P01 | [NORMAL] [SG2-55:AC1] [SG2-55:AC2] [SG2-55:AC4] support reserves stock and the coordinator sees the saved event receipt and notification', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 }); await signIn(page); await openSupport(page);
  await expect(panel(page).getByText('Reserve the full request: 12 × Wireless microphones.', { exact: true })).toBeVisible();
  await expect(panel(page).getByLabel('Reserve from (Singapore time)', { exact: true })).toHaveValue('2030-06-20T10:00');
  await expect(panel(page).getByLabel('Reserve until (Singapore time)', { exact: true })).toHaveValue('2030-06-20T14:00');
  await panel(page).getByRole('button', { name: 'Reserve equipment', exact: true }).click();
  await expect(panel(page).getByRole('status')).toHaveText('Equipment reserved for this event. The assigned Event Coordinator has been notified.');
  await fact(page, 'Quantity reserved', '12');
  await expect(receipt(page)).toContainText('20 Jun 2030');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SG2_55_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_55_SCREENSHOTS}/reservations-desktop.png`, fullPage: true });
  const stored = await ledger(page);
  expect(stored.reservations).toHaveLength(1);
  expect(stored.reservations[0]).toMatchObject({ event_id: 55, request_id: 551, equipment_id: 1, quantity_reserved: 12, ...period });
  expect(stored.requests.find((row: { request_id: number }) => row.request_id === 551)).toMatchObject({ status: 'approved', version: 2 });
  expect(stored.notifications).toHaveLength(1);
  expect(stored.notifications[0]).toMatchObject({ recipient_id: 'user-coordinator', event_id: 55, kind: 'equipment_reserved' });
  const invalidArrangement = await page.request.patch('/api/equipment-requests/551/arrangement', {
    headers: await auth(page), data: { event_id: 55, version: 2, arrangement_notes: 'Must not persist', shortfall: 1, placement_venue_id: null, placement_position: null },
  });
  expect(invalidArrangement.status()).toBe(400);
  expect(await ledger(page)).toEqual(stored);
  const available = await page.request.get('/api/equipment-requests/552/availability?event_id=551', { headers: await auth(page) });
  expect((await available.json())).toMatchObject({ quantity_held: 20, quantity_committed: 12, quantity_remaining: 8, shortfall: 2 });
  // A committed quantity must not trap an unfinished physical arrangement.
  await page.reload();
  await page.getByRole('button', { name: /Wireless microphones.*Equipment Reservation Forum/ }).click();
  await page.getByRole('button', { name: 'Update arrangement for Wireless microphones', exact: true }).click();
  await expect(page.getByLabel('Shortfall quantity', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Shortfall quantity', { exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Placement venue', exact: true }).selectOption('1');
  await page.getByLabel('Placement position', { exact: true }).fill('Stage left, clear of the exit.');
  await page.getByRole('button', { name: 'Save equipment arrangement', exact: true }).click();
  await expect(page.getByText('Equipment arrangement saved.', { exact: true })).toBeVisible();
  expect((await ledger(page)).requests.find((row: { request_id: number }) => row.request_id === 551)).toMatchObject({
    status: 'approved', shortfall: 0, placement_venue_id: 1, placement_position: 'Stage left, clear of the exit.', version: 3 });
  await signIn(page, 'coordinator');
  const readiness = await page.request.get('/api/event-requests/55/arrangements', { headers: await auth(page, 'coordinator') });
  expect(readiness.status()).toBe(200);
  expect((await readiness.json()).arrangements).toContainEqual(expect.objectContaining({ key: 'equipment', state: 'ready' }));
  await page.getByRole('button', { name: /Equipment Reservation Forum/ }).click();
  await fact(page, 'Quantity reserved', '12');
  await expect(panel(page).getByRole('button', { name: 'Reserve Wireless microphones', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
  const inbox = page.getByRole('complementary', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('Equipment reserved', { exact: true })).toBeVisible();
  await expect(inbox.getByText('Equipment reserved for Equipment Reservation Forum: 12 × Wireless microphones.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('SG2-55-B01 | [BOUNDARY] [FAILURE] [SG2-55:AC1] [SG2-55:AC3] mobile support supplies missing dates and equal endpoints cannot create a receipt', async ({ page }) => {
  await page.request.post('/__e2e/reset'); await page.request.post('/__e2e/equipment-reservations', { data: { missing_dates: true } });
  await page.setViewportSize({ width: 390, height: 844 }); await signIn(page); await openSupport(page);
  await expect(panel(page).getByRole('note')).toHaveText('Choose a complete reservation period. No event duration has been assumed.');
  await expect(panel(page).getByLabel('Reserve from (Singapore time)', { exact: true })).toHaveValue('2030-06-20T10:00');
  await expect(panel(page).getByLabel('Reserve until (Singapore time)', { exact: true })).toHaveValue('');
  await panel(page).getByLabel('Reserve until (Singapore time)', { exact: true }).fill('2030-06-20T10:00');
  await panel(page).getByRole('button', { name: 'Reserve equipment', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('Choose both dates, with the end after the start.');
  expect((await ledger(page)).reservations).toEqual([]);
  await panel(page).getByLabel('Reserve until (Singapore time)', { exact: true }).fill('2030-06-20T14:00');
  await panel(page).getByRole('button', { name: 'Reserve equipment', exact: true }).click(); await fact(page, 'Quantity reserved', '12');
  expect((await ledger(page)).reservations[0]).toMatchObject(period);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SG2_55_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_55_SCREENSHOTS}/reservations-mobile.png`, fullPage: true });
});

test('SG2-55-C01 | [CONFLICT] [SG2-55:AC2] [SG2-55:AC3] a reservation made after the advisory check refuses the stale competing promise without another notice', async ({ page }) => {
  await signIn(page); await openSupport(page, 'Overlapping Equipment Forum');
  await expect(panel(page).getByText('Available for the suggested period', { exact: true }).locator('..')).toContainText('20');
  const response = await page.request.post('/api/equipment-requests/551/reservation', { headers: await auth(page), data: { event_id: 55, version: 1, ...period } });
  expect(response.status()).toBe(201);
  await panel(page).getByRole('button', { name: 'Reserve equipment', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('There is not enough available equipment for these dates. Refresh reservations and requirements before trying again.');
  await expect(panel(page).getByRole('button', { name: 'Reserve equipment', exact: true })).toBeDisabled();
  const stored = await ledger(page); expect(stored.reservations).toHaveLength(1); expect(stored.notifications).toHaveLength(1);
  expect(stored.requests.find((row: { request_id: number }) => row.request_id === 552)).toMatchObject({ status: 'pending', version: 1 });
  await panel(page).getByRole('button', { name: 'Refresh reservations and requirements', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Reserve Wireless microphones', exact: true }).click();
  await expect(panel(page).getByText('Available for the suggested period', { exact: true }).locator('..')).toContainText('8');
});

test('SG2-55-C02 | [CONFLICT] [SG2-55:AC1] [SG2-55:AC4] rapid repeated clicks send one reservation and replays keep one receipt and one notice', async ({ page }) => {
  await signIn(page); await openSupport(page);
  let calls = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/equipment-requests/551/reservation', async route => { calls++; await gate; await route.continue(); });
  const submit = panel(page).getByRole('button', { name: 'Reserve equipment', exact: true });
  await submit.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(panel(page).getByRole('button', { name: 'Reserving…', exact: true })).toBeDisabled();
  release(); await fact(page, 'Quantity reserved', '12'); expect(calls).toBe(1);
  const repeated = await page.request.post('/api/equipment-requests/551/reservation', { headers: await auth(page), data: { event_id: 55, version: 1, ...period } });
  expect(repeated.status()).toBe(409);
  expect((await repeated.json()).code).toBe('conflict');
  const stored = await ledger(page); expect(stored.reservations).toHaveLength(1); expect(stored.notifications).toHaveLength(1);
});

test('SG2-55-N01 | [FAILURE] [CONFLICT] [SG2-55:AC1] [SG2-55:AC4] role guards refuse writes and a lost response after commit recovers the sole receipt through refresh', async ({ page }) => {
  const data = { event_id: 55, version: 1, ...period };
  expect((await page.request.post('/api/equipment-requests/551/reservation', { data })).status()).toBe(401);
  expect((await page.request.post('/api/equipment-requests/551/reservation', { data, headers: await auth(page, 'coordinator') })).status()).toBe(403);
  await signIn(page); await openSupport(page);
  await page.route('**/api/equipment-requests/551/reservation', async route => {
    const committed = await route.fetch(); expect(committed.status()).toBe(201);
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"private provider detail"}' });
  }, { times: 1 });
  await panel(page).getByRole('button', { name: 'Reserve equipment', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('Refresh reservations and requirements');
  await expect(page.getByText('private provider detail', { exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Reserve equipment', exact: true })).toBeDisabled();
  expect((await ledger(page)).reservations).toHaveLength(1);
  await panel(page).getByRole('button', { name: 'Refresh reservations and requirements', exact: true }).click();
  await fact(page, 'Quantity reserved', '12');
  expect((await ledger(page)).notifications).toHaveLength(1);
});
