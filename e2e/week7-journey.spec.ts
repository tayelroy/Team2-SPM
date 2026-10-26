import { expect, test, type Page } from '@playwright/test';

// SG2-96: the whole Week 7 journey in the browser, one person at a time:
// the organiser submits, the Lead assigns, the coordinator approves and
// arranges a venue and equipment, Technical Support places and reserves the
// equipment, Venue Staff approve the venue, the event moves to the safety
// check by itself (the fixture's mirror of the database trigger), the Safety
// Officer approves it into Preparation and the coordinator confirms it.
// The native integration suite runs the same journey against PostgreSQL
// (SG2-96-INT01); this case proves the screens carry it.

const EVENT = 'Week 7 journey';

async function signIn(page: Page, account: string) {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
async function ledger(page: Page) {
  return (await page.request.get(`/__e2e/journey-ledger?name=${encodeURIComponent(EVENT)}`)).json() as Promise<{
    events: { event_id: number; status: string; safety_check_revision?: number }[]; audit: { field_name: string; new_value: string }[];
    notifications: { recipient_id: string; kind: string }[]; decisions: { decision: string }[];
  }>;
}
const status = async (page: Page) => (await ledger(page)).events[0]?.status;
async function openAssigned(page: Page) {
  await nav(page, 'Dashboard');
  const back = page.getByRole('button', { name: 'Back to work queue', exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: new RegExp(EVENT) }).click();
  await expect(page.getByRole('heading', { name: EVENT, exact: true })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/safety-handoff')).status()).toBe(204);
  // The catalogue's Regression Hall offers a theatre layout, recorded by Venue Staff (SG2-43).
  const login = await request.post('/api/auth/login', { data: { email: 'venue@example.test', password: 'Regression123!' } });
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  expect((await request.put('/api/venues/1/layouts', { headers, data: { layouts: [{ layout: 'theatre' }] } })).status()).toBe(200);
});

test('SG2-96-E2E01 | [NORMAL] [CONFLICT] [SG2-30:AC1] [SG2-88:AC1] [SG2-37:AC1] [SG2-48:AC1] [SG2-53:AC1] [SG2-55:AC1] [SG2-49:AC1] [SG2-91:AC1] [SG2-92:AC3] [SG2-94:AC5] [SG2-58:AC1] [SG2-100:AC1] the Week 7 journey runs in the browser from submission to a confirmed event', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 1. The organiser submits a complete request; it waits for the Lead.
  await signIn(page, 'organiser');
  await nav(page, 'New request');
  for (const [label, value] of Object.entries({ 'Event name': EVENT, Purpose: 'Week 7 release check',
    Description: 'Two-hour briefing for the Week 7 changes', Date: '2030-06-15T17:00',
    'Expected attendance': '40', 'Venue requirements': 'Projector', 'Preferred room layout': 'Theatre' })) {
    await page.getByLabel(new RegExp(`^${label}`)).fill(value);
  }
  for (const answer of ['No accessibility needs', 'No registration needed', 'Workshop']) {
    await page.getByRole('button', { name: answer, exact: true }).click();
  }
  await page.getByLabel(/^Equipment requirements/).fill('Two wireless microphones');
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `${EVENT} has been submitted for review.` })).toBeVisible();
  await expect(page.getByTestId('stage-badge')).toContainText('Awaiting Assignment');
  expect(await status(page)).toBe('unassigned');

  // 2. The Lead assigns a coordinator from the queue.
  await signIn(page, 'lead');
  await nav(page, 'Assign coordinators');
  await page.getByLabel(`Coordinator for ${EVENT}`, { exact: true }).selectOption({ label: 'Regression coordinator' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Assigned to Regression coordinator.', { exact: true })).toBeVisible();
  expect(await status(page)).toBe('submitted');

  // 3. The coordinator opens it (under review) and approves it.
  await signIn(page, 'coordinator');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'Awaiting review' }).getByRole('button', { name: new RegExp(EVENT) }).click();
  await expect(page.getByRole('heading', { name: EVENT })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
  expect(await status(page)).toBe('approved');

  // 4. The coordinator requests a venue for the event's two hours.
  await openAssigned(page);
  await page.getByRole('button', { name: 'Find venues for this event', exact: true }).click();
  // The search starts with the whole day, when Regression Hall already hosts the seeded workshop; ask for the event's two hours.
  const criteria = page.getByRole('form', { name: 'Venue search criteria' });
  await criteria.getByLabel('From (Singapore time)').fill('2030-06-15T17:00');
  await criteria.getByLabel('Until (Singapore time)').fill('2030-06-15T19:00');
  await criteria.getByRole('button', { name: 'Search', exact: true }).click();
  const hall = page.locator('.venue-grid > *').filter({ has: page.getByRole('heading', { name: 'Regression Hall', exact: true }) }).first();
  await hall.getByRole('button', { name: 'Request this venue', exact: true }).click();
  const form = page.getByRole('form', { name: 'Request Regression Hall' });
  await form.getByLabel('Request from (Singapore time)').fill('2030-06-15T17:00');
  await form.getByLabel('Request until (Singapore time)').fill('2030-06-15T19:00');
  await form.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByText('Regression Hall requested. It is pending until Venue Staff decide, and the venue is not held until then.', { exact: true })).toBeVisible();

  // 5. ...and the equipment it needs.
  await openAssigned(page);
  await page.getByRole('button', { name: 'Add equipment requirement', exact: true }).click();
  await page.getByRole('combobox', { name: 'Equipment type', exact: true }).selectOption('1');
  await page.getByRole('textbox', { name: 'Quantity required', exact: true }).fill('2');
  await page.getByRole('textbox', { name: 'Technical notes', exact: true }).fill('Two handheld microphones for the briefing.');
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByText('Equipment requirement saved.', { exact: true })).toBeVisible();
  expect(await status(page)).toBe('approved');

  // 6. Technical Support place the microphones and reserve them.
  await signIn(page, 'support');
  await page.getByRole('button', { name: new RegExp(`Wireless microphones.*${EVENT}`) }).click();
  await page.getByRole('button', { name: 'Update arrangement for Wireless microphones', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shortfall quantity', exact: true }).fill('0');
  await page.getByRole('combobox', { name: 'Placement venue', exact: true }).selectOption('1');
  await page.getByRole('textbox', { name: 'Placement position', exact: true }).fill('Lectern, clear of the exits.');
  await page.getByRole('button', { name: 'Save equipment arrangement', exact: true }).click();
  await expect(page.getByText('Equipment arrangement saved.', { exact: true })).toBeVisible();
  const reservations = page.getByRole('region', { name: 'Equipment reservations', exact: true });
  await reservations.getByRole('button', { name: 'Reserve Wireless microphones', exact: true }).click();
  await reservations.getByLabel('Reserve from (Singapore time)', { exact: true }).fill('2030-06-15T17:00');
  await reservations.getByLabel('Reserve until (Singapore time)', { exact: true }).fill('2030-06-15T19:00');
  await reservations.getByRole('button', { name: 'Reserve equipment', exact: true }).click();
  await expect(reservations.getByRole('status')).toHaveText('Equipment reserved for this event. The assigned Event Coordinator has been notified.');
  // The venue is still pending, so the event is not ready for the safety check.
  expect(await status(page)).toBe('approved');

  // 7. Venue Staff approve the venue; the event is now ready and moves to the safety check by itself.
  await signIn(page, 'venue');
  await page.getByRole('region', { name: 'Booking requests awaiting decision' }).getByRole('button', { name: /Regression Hall/ }).click();
  const decision = page.getByRole('article', { name: 'Venue booking request' });
  await decision.getByRole('button', { name: 'Approve booking', exact: true }).click();
  await expect(decision.getByText('Approved. The venue is committed to this event and the coordinator has been notified.', { exact: true })).toBeVisible();
  await expect.poll(() => status(page)).toBe('awaiting_safety_check');

  // CONFLICT: before the Safety Officer approves, the event cannot be confirmed.
  await signIn(page, 'coordinator');
  await openAssigned(page);
  await expect(page.locator('footer[aria-label="Confirm this event"]')).toHaveCount(0);

  // 8. The Safety Officer sees it with its venue and equipment, and approves it.
  await signIn(page, 'safety');
  await nav(page, 'Safety checks');
  const list = page.getByRole('region', { name: 'Events awaiting a safety check', exact: true });
  const awaiting = list.getByRole('article', { name: EVENT, exact: true });
  await expect(awaiting.getByRole('region', { name: `Venues for ${EVENT}` })).toContainText('Regression Hall');
  await expect(awaiting.getByRole('region', { name: `Equipment for ${EVENT}` })).toContainText('2 × Wireless microphones');
  const review = page.getByRole('region', { name: `Safety decision for ${EVENT}`, exact: true });
  await review.getByRole('radio', { name: 'Approve', exact: true }).check();
  await review.getByRole('button', { name: 'Record decision', exact: true }).click();
  await expect(page.getByText(`Approved for ${EVENT}. The organiser and the coordinator have been notified.`, { exact: true })).toBeVisible();
  expect(await status(page)).toBe('preparation');

  // 9. The coordinator confirms the event.
  await signIn(page, 'coordinator');
  await openAssigned(page);
  await expect(page.getByTestId('readiness-badge')).toHaveText('Ready for confirmation');
  await page.locator('footer[aria-label="Confirm this event"]').getByRole('button', { name: 'Confirm event', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event confirmed.' })).toHaveText('Event confirmed. The Event Organiser has been notified.');

  // 10. The organiser sees a confirmed event with its arrangements.
  await signIn(page, 'organiser');
  await nav(page, 'My events');
  await page.getByRole('button', { name: `View ${EVENT}`, exact: true }).click();
  await expect(page.getByTestId('stage-badge')).toContainText('Confirmed');
  const confirmed = page.getByRole('region', { name: 'Confirmed arrangements', exact: true });
  await expect(confirmed).toContainText('Regression Hall');
  await expect(confirmed).toContainText('Wireless microphones');

  const stored = await ledger(page);
  expect(stored.events[0].status).toBe('confirmed');
  expect(stored.audit.filter(row => row.field_name === 'status').map(row => row.new_value)).toEqual(
    ['unassigned', 'submitted', 'under_review', 'approved', 'awaiting_safety_check', 'preparation', 'confirmed']);
  expect(stored.decisions.map(row => row.decision)).toEqual(['approve']);
  expect(stored.notifications.filter(row => row.recipient_id === 'user-organiser').map(row => row.kind)).toEqual(
    expect.arrayContaining(['coordinator_assigned', 'event_approved', 'safety_decision', 'event_confirmed']));
  expect(errors).toEqual([]);
});
