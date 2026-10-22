import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, account: string) {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function auth(page: Page, account: string) {
  const response = await page.request.post('/api/auth/login', { data: { email: `${account}@example.test`, password: 'Regression123!' } });
  expect(response.status()).toBe(200); return { Authorization: `Bearer ${(await response.json()).accessToken}` };
}
async function ledger(page: Page) { return (await page.request.get('/__e2e/event-confirmation-ledger')).json(); }
const eventRow = (stored: { events: { event_id: number; confirmed_at?: string }[] }, id: number) => stored.events.find(row => row.event_id === id);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function openAssigned(page: Page, name: string) {
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
// A footer inside the event article is not a landmark, so it has no role to query by.
const confirmPanel = (page: Page) => page.locator('footer[aria-label="Confirm this event"]');
async function openOrganiserEvent(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'My events', exact: true }).click();
  await page.getByRole('button', { name: `View ${name}`, exact: true }).click();
  return page.getByRole('region', { name: 'Confirmed arrangements', exact: true });
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/event-confirmation')).status()).toBe(204);
});

test('SG2-58-P01 | [NORMAL] [SG2-58:AC1] [SG2-58:AC3] the coordinator confirms a ready event and the organiser is notified and sees the confirmed arrangements', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'coordinator'); await openAssigned(page, 'Confirmation Forum');
  await expect(page.getByTestId('readiness-badge')).toHaveText('Ready for confirmation');
  await expect(page.getByTestId('arrangement-equipment')).toContainText('1 equipment request reserved and placed.');
  await confirmPanel(page).getByRole('button', { name: 'Confirm event', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event confirmed.' }))
    .toHaveText('Event confirmed. The Event Organiser has been notified.');
  await expect(page.locator('.work-queue-status')).toHaveText('confirmed');
  await expect(confirmPanel(page)).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  const stored = await ledger(page);
  expect(eventRow(stored, 581)).toMatchObject({ status: 'confirmed', confirmed_by: 'user-coordinator' });
  expect(Date.parse(String(eventRow(stored, 581)!.confirmed_at))).not.toBeNaN();
  expect(stored.audit).toEqual([expect.objectContaining({ event_id: 581, actor_id: 'user-coordinator', field_name: 'status', old_value: 'preparation', new_value: 'confirmed' })]);
  expect(stored.notifications).toEqual([expect.objectContaining({ recipient_id: 'user-organiser', event_id: 581, kind: 'event_confirmed', message: 'Your event Confirmation Forum is confirmed.' })]);

  await signIn(page, 'organiser');
  await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
  const inbox = page.getByRole('complementary', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('Event confirmed', { exact: true })).toBeVisible();
  await expect(inbox.getByText('Your event Confirmation Forum is confirmed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
  const confirmed = await openOrganiserEvent(page, 'Confirmation Forum');
  await expect(confirmed.getByRole('listitem')).toHaveText([
    'Regression Hall: 20 Jun 2030, 10:00 SGT – 20 Jun 2030, 14:00 SGT',
    'Quiet Room: 20 Jun 2030, 10:00 SGT – 20 Jun 2030, 14:00 SGT',
    '12 × Wireless microphones'
  ]);
  await expect(confirmed.getByText('Capacity', { exact: true }).locator('..')).toContainText('120');
  await expect(confirmed.getByText('Opens', { exact: true }).locator('..')).toContainText('1 Jan 2026, 08:00 SGT');
  await expect(confirmed.getByText('Closes', { exact: true }).locator('..')).toContainText('20 Jun 2030, 00:00 SGT');
  await expect(confirmed.getByText('Registration is open. Attendees can register now.', { exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  if (process.env.SG2_58_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_58_SCREENSHOTS}/confirmed-organiser-desktop.png`, fullPage: true });
  const view = await page.request.get('/api/event-requests/581/confirmation', { headers: await auth(page, 'organiser') });
  expect(view.status()).toBe(200);
  expect((await view.json()).registration).toEqual({ needed: true, capacity: 120,
    opens_at: '2026-01-01T00:00:00.000Z', closes_at: '2030-06-19T16:00:00.000Z', window: 'open' });
  expect(errors).toEqual([]);
});

test('SG2-58-N01 | [FAILURE] [SG2-58:AC2] [SG2-94:AC6] confirmation is refused while one of two venues is pending and equipment is unreserved, but not for a registration with no capacity', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'coordinator'); await openAssigned(page, 'Outstanding Forum');
  await expect(page.getByTestId('arrangement-venue')).toContainText('1 venue booking still awaiting approval.');
  await expect(page.getByTestId('arrangement-equipment')).toContainText('1 equipment request not yet reserved and placed with no shortfall.');
  // SG2-94 AC6: the organiser sets registration later; it does not hold confirmation up.
  await expect(page.getByTestId('arrangement-registration-state')).toHaveText('Ready');
  await confirmPanel(page).getByRole('button', { name: 'Confirm event', exact: true }).click();
  await expect(confirmPanel(page).getByRole('alert')).toHaveText('Confirmation refused: arrangements are still outstanding.');
  await expect(confirmPanel(page).getByRole('list', { name: 'Outstanding arrangements' }).getByRole('listitem'))
    .toHaveText(['Venue booking', 'Equipment']);
  await expect(page.locator('.work-queue-status')).toHaveText('preparation');
  const stored = await ledger(page);
  expect(eventRow(stored, 582)).toMatchObject({ status: 'preparation', confirmed_by: null, confirmed_at: null });
  expect(stored.audit).toEqual([]);
  expect(stored.notifications).toEqual([]);
  if (process.env.SG2_58_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_58_SCREENSHOTS}/refused-desktop.png`, fullPage: true });
});

test('SG2-58-N02 | [CONFLICT] [SG2-58:AC2] a booking converted from a hold and later released leaves Confirm refused with the venue listed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Venue staff convert a tentative hold while the event is in Planning: the
  // booking is recorded on the hold, never on the approved request.
  const venue = await auth(page, 'venue');
  const placed = await page.request.post('/api/venue-holds', { headers: venue, data: { event_id: 585, venue_id: 1,
    starts_at: '2030-07-01T02:00:00.000Z', ends_at: '2030-07-01T06:00:00.000Z', expires_at: '2030-06-25T02:00:00.000Z' } });
  expect(placed.status()).toBe(201);
  const holdId = (await placed.json()).hold.hold_id;
  expect((await page.request.post(`/api/venue-holds/${holdId}/convert`, { headers: venue })).status()).toBe(200);
  expect((await page.request.post('/__e2e/event-confirmation-prepare')).status()).toBe(204);
  let stored = await ledger(page);
  const bookingId = stored.holds.find((hold: { hold_id: number }) => hold.hold_id === holdId).booking_id;
  const converted = stored.venue_requests.filter((row: { event_id: number }) => row.event_id === 585);
  expect(converted).toEqual([expect.objectContaining({ status: 'approved' })]);
  expect(converted[0].venue_booking_id ?? null).toBeNull();

  // The hold-linked booking counts while it is confirmed.
  await signIn(page, 'coordinator'); await openAssigned(page, 'Converted Forum');
  await expect(page.getByTestId('arrangement-venue')).toContainText('1 venue booking approved.');
  await expect(page.getByTestId('readiness-badge')).toHaveText('Ready for confirmation');

  // Releasing it cancels the booking but leaves the request approved.
  const released = await page.request.post(`/api/venue-bookings/${bookingId}/release`,
    { headers: await auth(page, 'coordinator'), data: { reason: 'The speaker withdrew.' } });
  expect(released.status()).toBe(200);
  stored = await ledger(page);
  expect(stored.venue_requests.filter((row: { event_id: number }) => row.event_id === 585))
    .toEqual([expect.objectContaining({ status: 'approved' })]);
  const notices = stored.notifications.length;

  await signIn(page, 'coordinator'); await openAssigned(page, 'Converted Forum');
  await expect(page.getByTestId('arrangement-venue')).toContainText('1 approved venue request no longer has a confirmed booking.');
  await confirmPanel(page).getByRole('button', { name: 'Confirm event', exact: true }).click();
  await expect(confirmPanel(page).getByRole('alert')).toHaveText('Confirmation refused: arrangements are still outstanding.');
  await expect(confirmPanel(page).getByRole('list', { name: 'Outstanding arrangements' }).getByRole('listitem'))
    .toHaveText(['Venue booking']);
  await expect(page.locator('.work-queue-status')).toHaveText('preparation');
  stored = await ledger(page);
  expect(eventRow(stored, 585)).toMatchObject({ status: 'preparation', confirmed_by: null, confirmed_at: null });
  expect(stored.audit.filter((row: { field_name: string }) => row.field_name === 'status')).toEqual([]);
  expect(stored.notifications).toHaveLength(notices);
});

test('SG2-58-B01 | [BOUNDARY] [SG2-58:AC2] [SG2-58:AC1] equipment and registration that are not required do not block, and both views fit 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'coordinator'); await openAssigned(page, 'Simple Forum');
  await expect(page.getByTestId('arrangement-equipment-state')).toHaveText('Not required');
  await expect(page.getByTestId('arrangement-registration-state')).toHaveText('Not required');
  expect(await noOverflow(page)).toBe(true);
  await confirmPanel(page).getByRole('button', { name: 'Confirm event', exact: true }).click();
  await expect(page.getByText('Event confirmed. The Event Organiser has been notified.', { exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  if (process.env.SG2_58_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_58_SCREENSHOTS}/confirmed-coordinator-mobile.png`, fullPage: true });
  expect(eventRow(await ledger(page), 583)).toMatchObject({ status: 'confirmed' });
  await signIn(page, 'organiser');
  const confirmed = await openOrganiserEvent(page, 'Simple Forum');
  await expect(confirmed.getByText('Regression Hall: 20 Jun 2030, 10:00 SGT – 20 Jun 2030, 14:00 SGT', { exact: true })).toBeVisible();
  await expect(confirmed.getByText('No equipment reserved.', { exact: true })).toBeVisible();
  await expect(confirmed.getByText('Registration is not required for this event.', { exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  if (process.env.SG2_58_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_58_SCREENSHOTS}/confirmed-organiser-mobile.png`, fullPage: true });
});

test('SG2-58-C01 | [CONFLICT] [SG2-58:AC1] a double click sends one confirmation and a replay is refused without a second notice', async ({ page }) => {
  await signIn(page, 'coordinator'); await openAssigned(page, 'Confirmation Forum');
  let calls = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/event-requests/581/confirm', async route => { calls++; await gate; await route.continue(); });
  const submit = confirmPanel(page).getByRole('button', { name: 'Confirm event', exact: true });
  await submit.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(confirmPanel(page).getByRole('button', { name: 'Confirming…', exact: true })).toBeDisabled();
  release();
  await expect(page.getByText('Event confirmed. The Event Organiser has been notified.', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  const replay = await page.request.patch('/api/event-requests/581/confirm', { headers: await auth(page, 'coordinator') });
  expect(replay.status()).toBe(409);
  expect(await replay.json()).toEqual({ error: 'Only an event in Preparation can be confirmed.', code: 'closed' });
  const stored = await ledger(page);
  expect(stored.audit).toHaveLength(1);
  expect(stored.notifications).toHaveLength(1);
});

test('SG2-58-F01 | [FAILURE] [SG2-58:AC1] [SG2-58:AC3] only the assigned coordinator confirms, and only the organiser and coordinator see a confirmed event', async ({ page }) => {
  expect((await page.request.patch('/api/event-requests/581/confirm')).status()).toBe(401);
  for (const account of ['organiser', 'support', 'venue', 'attendee', 'lead', 'safety']) {
    const refused = await page.request.patch('/api/event-requests/581/confirm', { headers: await auth(page, account) });
    expect(refused.status(), account).toBe(403);
  }
  const coordinator = await auth(page, 'coordinator');
  const colleague = await page.request.patch('/api/event-requests/584/confirm', { headers: coordinator });
  expect(colleague.status()).toBe(404);
  expect(await colleague.json()).toEqual({ error: 'No event in preparation is assigned to this account.' });
  // Not confirmed yet: the arrangements view stays hidden even from the organiser.
  expect((await page.request.get('/api/event-requests/581/confirmation', { headers: await auth(page, 'organiser') })).status()).toBe(404);
  expect((await page.request.patch('/api/event-requests/581/confirm', { headers: coordinator })).status()).toBe(200);
  expect((await page.request.get('/api/event-requests/581/confirmation', { headers: await auth(page, 'organiser2') })).status()).toBe(404);
  expect((await page.request.get('/api/event-requests/581/confirmation', { headers: await auth(page, 'venue') })).status()).toBe(403);
  const own = await page.request.get('/api/event-requests/581/confirmation', { headers: coordinator });
  expect(own.status()).toBe(200);
  expect((await own.json()).equipment).toEqual([{ equipment_type: 'Wireless microphones', quantity_reserved: 12 }]);
  const stored = await ledger(page);
  expect(eventRow(stored, 584)).toMatchObject({ status: 'preparation', confirmed_at: null });
  expect(stored.notifications).toHaveLength(1);
});
