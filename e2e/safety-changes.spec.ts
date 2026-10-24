import { expect, test, type Page } from '@playwright/test';

// SG2-93: a Request Changes safety decision sends the named arrangements back
// to Venue Staff and Technical Support, and the event returns to the Safety
// Officer once they are confirmed again.

async function signIn(page: Page, account: string) {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app' }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function auth(page: Page, account: string) {
  const response = await page.request.post('/api/auth/login', { data: { email: `${account}@example.test`, password: 'Regression123!' } });
  expect(response.status()).toBe(200); return { Authorization: `Bearer ${(await response.json()).accessToken}` };
}
type Ledger = { events: Record<string, unknown>[]; audit: Record<string, unknown>[]; rereviews: Record<string, unknown>[] };
async function ledger(page: Page): Promise<Ledger> { return (await page.request.get('/__e2e/safety-decisions-ledger')).json(); }
const eventOf = (stored: Ledger, eventId: number) => stored.events.find(row => row.event_id === eventId)!;
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const HALL = 'Regression Hall (10 Jul 2030 10:00 – 14:00 SGT)';
const MICROPHONES = '4 × Wireless microphones';
const REASON = 'Move the stage away from the east fire exit';

async function requestChanges(page: Page, eventId: number, arrangements: string[]) {
  const response = await page.request.post(`/api/event-requests/${eventId}/safety-decision`, { headers: await auth(page, 'safety'),
    data: { decision: 'request_changes', reason: REASON, arrangements, safety_check_revision: 1 } });
  expect(response.status()).toBe(201);
}
async function openAssigned(page: Page, event: string) {
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: new RegExp(event) }).click();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/safety-decisions')).status()).toBe(204);
});

test('SG2-93-P01 | [NORMAL] [SG2-93:AC1] [SG2-93:AC2] [SG2-93:AC3] [SG2-93:AC4] [SG2-93:AC5] changes the Safety Officer asks for go back to Venue Staff and Technical Support, and the event returns to the check once they are confirmed again', async ({ page }) => {
  await requestChanges(page, 921, ['venue', 'equipment', 'other']);
  let stored = await ledger(page);
  expect(eventOf(stored, 921)).toMatchObject({ status: 'planning', arrangements_recheck_needed: true,
    outstanding_arrangements: ['safety_venue_recheck', 'safety_equipment_recheck', 'safety_other_recheck'] });
  // AC3: the other events and the event's own bookings are untouched.
  expect([eventOf(stored, 922).status, eventOf(stored, 923).status]).toEqual(['awaiting_safety_check', 'awaiting_safety_check']);
  expect(stored.rereviews.map(row => [row.arrangement, row.resolution])).toEqual([['venue', null], ['equipment', null]]);

  // AC1: the coordinator sees what was sent back, and cannot mark the venue done before Venue Staff confirm it.
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'coordinator');
  await openAssigned(page, 'Harbour Gala');
  const sentBack = page.getByTestId('safety-decision-summary').getByRole('list', { name: 'Sent back to staff' });
  await expect(sentBack.getByRole('listitem')).toHaveText([
    `${HALL}: waiting for Venue Staff to confirm it again`,
    `${MICROPHONES}: waiting for Technical Support to confirm it again`,
  ]);
  expect(await noOverflow(page)).toBe(true);
  await page.getByRole('button', { name: 'Mark venue safety changes done', exact: true }).click();
  await expect(page.getByTestId('recheck-blockers')).toContainText(`${HALL} is waiting for Venue Staff to confirm it again.`);

  // AC2: Venue Staff confirm the booking again; Technical Support the equipment.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'venue');
  const venueQueue = page.getByRole('region', { name: 'Safety changes to confirm', exact: true });
  const booking = venueQueue.getByRole('article', { name: HALL, exact: true });
  await expect(booking).toContainText('Harbour Gala');
  await expect(booking).toContainText(`Reason: ${REASON}`);
  await expect(venueQueue.getByRole('article')).toHaveCount(1);
  await booking.getByRole('button', { name: 'Confirm again', exact: true }).click();
  await expect(page.getByText(`Confirmed ${HALL} again for Harbour Gala.`, { exact: true })).toBeVisible();

  await signIn(page, 'support');
  const equipmentQueue = page.getByRole('region', { name: 'Safety changes to confirm', exact: true });
  await expect(equipmentQueue.getByRole('article', { name: MICROPHONES, exact: true })).toContainText('Placed at Regression Hall — Stage left');
  await equipmentQueue.getByRole('button', { name: 'Confirm again', exact: true }).click();
  await expect(page.getByText(`Confirmed ${MICROPHONES} again for Harbour Gala.`, { exact: true })).toBeVisible();
  await expect(equipmentQueue.getByRole('article')).toHaveCount(0);

  stored = await ledger(page);
  expect(eventOf(stored, 921)).toMatchObject({ status: 'planning', outstanding_arrangements: ['safety_other_recheck'] });

  // AC4: once the coordinator marks Other done, the event is back with the Safety Officer.
  await signIn(page, 'coordinator');
  await openAssigned(page, 'Harbour Gala');
  await expect(page.getByTestId('safety-decision-summary').getByRole('list', { name: 'Sent back to staff' }).getByRole('listitem')).toHaveText([
    `${HALL}: confirmed again by Regression venue`,
    `${MICROPHONES}: confirmed again by Regression support`,
  ]);
  await page.getByRole('button', { name: 'Mark other safety changes done', exact: true }).click();
  await expect.poll(async () => eventOf(await ledger(page), 921).status).toBe('awaiting_safety_check');

  await signIn(page, 'safety');
  await expect(page.getByText('3 events are awaiting a safety check.', { exact: true })).toBeVisible();

  // AC5: who confirmed what, and each change settling, are in the event history.
  stored = await ledger(page);
  expect(stored.audit.filter(row => row.event_id === 921 && ['safety_rereview', 'arrangement_recheck'].includes(String(row.field_name)))
    .map(row => row.new_value)).toEqual([
    `Venue Staff confirmed ${HALL} again`, 'safety_venue_recheck settled',
    `Technical Support confirmed ${MICROPHONES} again`, 'safety_equipment_recheck settled',
    'safety_other_recheck settled',
  ]);
});

test('SG2-93-N01 | [FAILURE] [CONFLICT] [SG2-93:AC2] [SG2-93:AC4] only the staff a change belongs to confirm it, once, and a change still with them cannot be marked done', async ({ page }) => {
  await requestChanges(page, 922, ['venue', 'equipment']);
  const [venue, support, coordinator] = await Promise.all(['venue', 'support', 'coordinator'].map(account => auth(page, account)));
  expect((await page.request.get('/api/safety-rereviews', { headers: coordinator })).status()).toBe(403);
  const flags = (await ledger(page)).rereviews;
  const venueFlag = flags.find(row => row.arrangement === 'venue')!.review_id;
  const equipmentFlag = flags.find(row => row.arrangement === 'equipment')!.review_id;
  const confirm = (headers: Record<string, string>, id: unknown) => page.request.post(`/api/safety-rereviews/${id}/confirm`, { headers });

  expect((await confirm(venue, equipmentFlag)).status()).toBe(403);
  expect((await confirm(support, venueFlag)).status()).toBe(403);
  const early = await page.request.post('/api/event-requests/922/rechecks/safety_equipment_recheck/settle', { headers: coordinator });
  expect([early.status(), (await early.json()).blockers]).toEqual([409, [`${MICROPHONES} is waiting for Technical Support to confirm it again.`]]);

  expect((await confirm(support, equipmentFlag)).status()).toBe(200);
  const twice = await confirm(support, equipmentFlag);
  expect([twice.status(), await twice.json()]).toEqual([409,
    { error: 'This booking or equipment request has already been dealt with.', resolution: 'confirmed' }]);
  expect((await confirm(venue, 999999)).status()).toBe(404);
  const stored = await ledger(page);
  expect(eventOf(stored, 922)).toMatchObject({ status: 'planning', outstanding_arrangements: ['safety_venue_recheck'] });
});
