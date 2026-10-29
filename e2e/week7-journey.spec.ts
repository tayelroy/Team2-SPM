import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

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
async function auth(page: Page, account: string) {
  const response = await page.request.post('/api/auth/login', {
    data: { email: `${account}@example.test`, password: 'Regression123!' },
  });
  expect(response.status()).toBe(200);
  return { Authorization: `Bearer ${(await response.json()).accessToken}` };
}
async function evidence(
  page: Page,
  info: TestInfo,
  name: string,
  target: Locator = page.getByRole('main'),
  persist = false,
) {
  await target.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await target.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const path = persist ? `test-results/release-evidence/${name}.png` : undefined;
  if (path) await mkdir('test-results/release-evidence', { recursive: true });
  const body = await target.screenshot(path ? { path } : undefined);
  await info.attach(name, { body, contentType: 'image/png' });
}
async function nav(page: Page, name: string) {
  const target = page.getByRole('navigation').getByRole('button', { name, exact: true });
  await target.scrollIntoViewIfNeeded();
  await target.click();
}
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

/** Step 1: the organiser submits a complete request asking for two microphones. */
async function submitRequest(page: Page) {
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
}

/** Step 2: the Lead assigns Regression coordinator from the queue. */
async function assignCoordinator(page: Page) {
  await signIn(page, 'lead');
  await nav(page, 'Assign coordinators');
  await page.getByLabel(`Coordinator for ${EVENT}`, { exact: true }).selectOption({ label: 'Regression coordinator' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Assigned to Regression coordinator.', { exact: true })).toBeVisible();
  expect(await status(page)).toBe('submitted');
}

/** Step 3: the coordinator opens it (under review) and approves it. */
async function approveRequest(page: Page) {
  await signIn(page, 'coordinator');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'Awaiting review' }).getByRole('button', { name: new RegExp(EVENT) }).click();
  await expect(page.getByRole('heading', { name: EVENT })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
  expect(await status(page)).toBe('approved');
}

/** Step 4: the signed-in coordinator requests Regression Hall for the event's two hours. */
async function requestHall(page: Page) {
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
}

/** Step 5: the signed-in coordinator records the two microphones. */
async function addMicrophones(page: Page) {
  await openAssigned(page);
  await page.getByRole('button', { name: 'Add equipment requirement', exact: true }).click();
  await page.getByRole('combobox', { name: 'Equipment type', exact: true }).selectOption('1');
  await page.getByRole('textbox', { name: 'Quantity required', exact: true }).fill('2');
  await page.getByRole('textbox', { name: 'Technical notes', exact: true }).fill('Two handheld microphones for the briefing.');
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByText('Equipment requirement saved.', { exact: true })).toBeVisible();
}

/** Step 6: Technical Support place the microphones and reserve them. */
async function supportReserves(page: Page) {
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
}

/** Step 7: Venue Staff approve the Regression Hall request. */
async function venueApproves(page: Page) {
  await signIn(page, 'venue');
  await page.getByRole('region', { name: 'Booking requests awaiting decision' }).getByRole('button', { name: /Regression Hall/ }).click();
  const decision = page.getByRole('article', { name: 'Venue booking request' });
  await decision.getByRole('button', { name: 'Approve booking', exact: true }).click();
  await expect(decision.getByText('Approved. The venue is committed to this event and the coordinator has been notified.', { exact: true })).toBeVisible();
}

test('SG2-96-E2E01 | [NORMAL] [CONFLICT] [SG2-30:AC1] [SG2-88:AC1] [SG2-37:AC1] [SG2-48:AC1] [SG2-53:AC1] [SG2-55:AC1] [SG2-49:AC1] [SG2-91:AC1] [SG2-92:AC3] [SG2-94:AC5] [SG2-58:AC1] [SG2-100:AC1] the Week 7 journey runs in the browser from submission to a confirmed event', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 1. The organiser submits a complete request; it waits for the Lead.
  await submitRequest(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await evidence(page, info, 'week7-01-submitted-mobile-390', page.getByRole('main'), true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 2. The Lead assigns a coordinator from the queue.
  await assignCoordinator(page);

  // 3. The coordinator opens it (under review) and approves it.
  await approveRequest(page);
  await page.setViewportSize({ width: 390, height: 900 });
  const changePanel = page.getByTestId('change-requests-panel');
  await expect(changePanel).toBeVisible();
  const detail = page.locator('.organisation-detail');
  const [panelBox, detailBox] = await Promise.all([changePanel.boundingBox(), detail.boundingBox()]);
  expect(panelBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(panelBox!.x - detailBox!.x).toBeGreaterThanOrEqual(20);
  expect(detailBox!.x + detailBox!.width - panelBox!.x - panelBox!.width).toBeGreaterThanOrEqual(20);
  await evidence(page, info, 'week7-02-coordinator-change-panel-inset-mobile-390', detail, true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 4. The coordinator requests a venue for the event's two hours.
  await requestHall(page);

  // 5. ...and the equipment it needs.
  await addMicrophones(page);
  expect(await status(page)).toBe('approved');

  // 6. Technical Support place the microphones and reserve them.
  await supportReserves(page);
  // The venue is still pending, so the event is not ready for the safety check.
  expect(await status(page)).toBe('approved');

  // 7. Venue Staff approve the venue; the event is now ready and moves to the safety check by itself.
  await venueApproves(page);
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
  await evidence(page, info, 'week7-03-safety-approved', page.getByRole('main'), true);

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
  await evidence(page, info, 'week7-04-confirmed-arrangements', confirmed, true);

  const stored = await ledger(page);
  expect(stored.events[0].status).toBe('confirmed');
  expect(stored.audit.filter(row => row.field_name === 'status').map(row => row.new_value)).toEqual(
    ['unassigned', 'submitted', 'under_review', 'approved', 'awaiting_safety_check', 'preparation', 'confirmed']);
  expect(stored.decisions.map(row => row.decision)).toEqual(['approve']);
  expect(stored.notifications.filter(row => row.recipient_id === 'user-organiser').map(row => row.kind)).toEqual(
    expect.arrayContaining(['coordinator_assigned', 'event_approved', 'safety_decision', 'event_confirmed']));
  expect(errors).toEqual([]);
});

test('SG2-96-E2E02 | [NORMAL] [SG2-60:AC1] [SG2-62:AC2] mobile evidence shows attendee registration and withdrawal', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 900 });

  expect((await page.request.post('/__e2e/reset')).status()).toBe(204);
  expect((await page.request.post('/__e2e/event-registration')).status()).toBe(204);
  await signIn(page, 'attendee');
  await nav(page, 'Find events');
  await page.getByRole('region', { name: 'Events open for registration', exact: true })
    .getByRole('article', { name: 'Harbour Lecture', exact: true })
    .getByRole('button', { name: 'View details', exact: true }).click();
  const registration = page.getByRole('region', { name: 'Registration', exact: true });
  await registration.getByLabel('Accessibility or dietary needs (optional)', { exact: true }).fill('Step-free access');
  await evidence(page, info, 'week7-05-attendee-registration-form-mobile-390', registration);
  await registration.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(registration.getByRole('status')).toContainText('You are registered. Your place is held.');
  await evidence(page, info, 'week7-06-attendee-registration-confirmed-mobile-390', registration, true);

  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  expect((await page.request.post('/__e2e/reset')).status()).toBe(204);
  expect((await page.request.post('/__e2e/my-registrations')).status()).toBe(204);
  await signIn(page, 'attendee');
  await nav(page, 'My registrations');
  const list = page.getByRole('region', { name: 'Registrations', exact: true });
  const lantern = list.getByRole('article', { name: 'Lantern Talk', exact: true });
  await lantern.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const confirm = page.getByRole('group', { name: 'Withdraw from Lantern Talk', exact: true });
  await evidence(page, info, 'week7-07-attendee-withdraw-confirmation-mobile-390', lantern, true);
  await confirm.getByRole('button', { name: 'Confirm withdrawal', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'You have withdrawn from' }))
    .toContainText('You have withdrawn from Lantern Talk. Your place has been given back.');
  await evidence(page, info, 'week7-08-attendee-withdrawn-mobile-390', lantern);
  expect(errors).toEqual([]);
});

test('SG2-96-E2E03 | [NORMAL] [SG2-65:AC1] [SG2-65:AC2] mobile evidence shows coordinator refusal and acceptance', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 900 });
  const seedDecision = async () => {
    expect((await page.request.post('/__e2e/reset')).status()).toBe(204);
    expect((await page.request.post('/__e2e/under-review')).status()).toBe(204);
    const response = await page.request.post('/api/event-requests/52/change-requests', {
      headers: await auth(page, 'organiser'),
      data: { field: 'expected_attendance', to: 34, reason: 'Two partner teams have joined.' },
    });
    expect(response.status()).toBe(201);
  };
  const openDecision = async () => {
    await signIn(page, 'coordinator');
    await page.getByRole('button', { name: /Decision Forum/ }).first().click();
    return page.getByTestId('change-requests-panel');
  };

  await seedDecision();
  let panel = await openDecision();
  let card = panel.getByRole('article');
  await card.getByRole('button', { name: 'Refuse change', exact: true }).click();
  await card.getByLabel('Reason for refusing').fill('The Kelp Room cannot seat more.');
  await evidence(page, info, 'week7-09-change-refusal-mobile-390', panel, true);
  await card.getByRole('button', { name: 'Confirm refusal', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Change refused. The event is unchanged and the organiser has been told why.');
  await evidence(page, info, 'week7-10-change-refused-mobile-390', panel);

  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  expect((await page.request.post('/__e2e/reset')).status()).toBe(204);
  expect((await page.request.post('/__e2e/under-review')).status()).toBe(204);
  await signIn(page, 'coordinator');
  await page.getByRole('region', { name: 'Awaiting review' })
    .getByRole('button', { name: /Decision Forum/ }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
  const raised = await page.request.post('/api/event-requests/52/change-requests', {
    headers: await auth(page, 'organiser'),
    data: { field: 'expected_attendance', to: 34, reason: 'Two partner teams have joined.' },
  });
  expect(raised.status()).toBe(201);
  panel = await openDecision();
  card = panel.getByRole('article');
  await evidence(page, info, 'week7-11-change-acceptance-mobile-390', panel, true);
  await card.getByRole('button', { name: 'Accept change', exact: true }).click();
  await expect(panel.getByRole('article')).toHaveCount(0);
  await expect(panel).toContainText('No change requests are waiting for your decision.');
  await evidence(page, info, 'week7-12-change-accepted-mobile-390', panel);
  expect(errors).toEqual([]);
});

test('SG2-57-N01 | [CONFLICT] [SG2-57:AC1] [SG2-57:AC2] [SG2-94:AC4] equipment the organiser asked for stays outstanding until requested, so approving the venue first does not hand the event to the safety check', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });

  // The organiser asks for two wireless microphones; the venue is booked before anyone requests them.
  await submitRequest(page);
  await assignCoordinator(page);
  await approveRequest(page);
  await requestHall(page);
  await venueApproves(page);
  expect(await status(page)).toBe('approved');

  // The coordinator sees the microphones outstanding, naming what the organiser asked for.
  await signIn(page, 'coordinator');
  await openAssigned(page);
  await expect(page.getByTestId('arrangement-venue-state')).toHaveText('Ready');
  await expect(page.getByTestId('arrangement-equipment-state')).toHaveText('Outstanding');
  await expect(page.getByTestId('arrangement-equipment')).toContainText(
    'The organiser asked for equipment (Two wireless microphones) but none has been requested yet.');

  // Requesting, placing and reserving them completes the arrangements; only then does the event reach the safety check.
  await addMicrophones(page);
  expect(await status(page)).toBe('approved');
  await supportReserves(page);
  await expect.poll(() => status(page)).toBe('awaiting_safety_check');

  const stored = await ledger(page);
  expect(stored.audit.filter(row => row.field_name === 'status').map(row => row.new_value)).toEqual(
    ['unassigned', 'submitted', 'under_review', 'approved', 'awaiting_safety_check']);
  expect(errors).toEqual([]);
});
