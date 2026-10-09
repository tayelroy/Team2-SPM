import { test, expect, type Page } from '@playwright/test';

const password = 'Regression123!';
const venueValues = { name: 'Browser Hall', location: 'North Wing', capacity: 100,
  facilities: 'Projector', accessibility_features: 'Lift', operating_information: '09:00–18:00' };

async function signIn(page: Page, account = 'organiser') {
  // Keep the calendar's year options independent of the machine's date.
  await page.clock.setFixedTime('2026-09-22T04:00:00.000Z');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}

async function authHeaders(page: Page) {
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('connectsphere.session')!).accessToken);
  return { Authorization: `Bearer ${token}` };
}

async function nav(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function profile(page: Page) {
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'My Profile', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
}

async function fillVenue(page: Page, name = venueValues.name, capacity = '100') {
  for (const [label, value] of Object.entries({ 'Venue name': name, Location: venueValues.location,
    Capacity: capacity, Facilities: venueValues.facilities, 'Accessibility features': venueValues.accessibility_features,
    'Operating information': venueValues.operating_information })) await page.getByLabel(label, { exact: true }).fill(value);
}

async function fillEvent(page: Page, name = 'Browser workshop') {
  for (const [label, value] of Object.entries({ 'Event name': name, Purpose: 'Team planning',
    Description: 'Review the release plan', Date: '2030-06-15T17:00',
    'Expected attendance': '25', 'Venue requirements': 'Projector' })) {
    await page.getByLabel(new RegExp(`^${label}`)).fill(value);
  }
}

async function eventRecords(page: Page) {
  const response = await page.request.get('/api/event-requests', { headers: await authHeaders(page) });
  expect(response.status()).toBe(200);
  return (await response.json()).requests as { event_id: number; name: string; status: string }[];
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
});

test('SG2-41-P01 | [SG2-41:AC1] [SG2-41:AC2] [SG2-41:AC3] [SG2-41:AC4] [SG2-87:AC1] [NORMAL] [FAILURE] internal users open the exact events and requests waiting on their role', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'coordinator');
  await expect(page.getByText('0 items in your work queue')).toBeVisible();
  expect((await request.post('/__e2e/work-queue')).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  // SG2-87: unassigned request #41 waits in the Lead's queue, so the
  // coordinator's queue holds only their own assignment.
  await expect(page.getByText('1 item in your work queue')).toBeVisible();
  await expect(page.getByText('Sustainability Leadership Forum')).toHaveCount(0);
  await expect(page.getByText('Another coordinator’s event')).toHaveCount(0);
  await expect(page.getByText('Completed event')).toHaveCount(0);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page).toHaveTitle(/ConnectSphere/i);
  if (process.env.SG2_41_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_41_SCREENSHOTS}/coordinator-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SG2_41_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_41_SCREENSHOTS}/coordinator-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const assignment = page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: /Partner Innovation Summit/ });
  await assignment.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Partner Innovation Summit', exact: true })).toBeFocused();
  await expect(page.getByText('Event request #42', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to work queue', exact: true }).click();
  await expect(page.getByText('1 item in your work queue')).toBeVisible();
  // The coordinator keeps an empty review section. Wait for the loaded queue
  // before checking its contents, rather than passing during the loading gap.
  await expect(page.getByRole('region', { name: 'Awaiting review' }).getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'My assigned events' }).getByRole('button')).toHaveText(/Partner Innovation Summit/);
  if (process.env.SG2_41_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_41_SCREENSHOTS}/event-detail.png`, fullPage: true });

  for (const [account, kind, title, group, fact] of [
    ['venue', 'venue', 'Regression Hall', 'Booking requests awaiting decision', 'Venue capacity'],
    ['support', 'equipment', 'Wireless microphones', 'Equipment requests awaiting decision', 'Quantity requested'],
  ]) {
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
    await signIn(page, account);
    await expect(page.getByText('1 item in your work queue')).toBeVisible();
    const region = page.getByRole('region', { name: group });
    await expect(region.getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Awaiting review' })).toHaveCount(0);
    if (process.env.SG2_41_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_41_SCREENSHOTS}/${kind}-desktop.png`, fullPage: true });
    await region.getByRole('button', { name: new RegExp(title) }).click();
    await expect(page.getByRole('heading', { name: title, exact: true, level: 2 })).toBeVisible();
    await expect(page.getByText('Sustainability Leadership Forum · Event #41')).toBeVisible();
    await expect(page.getByText(/15 Jun 2030, 10:00 – 15 Jun 2030, 18:00/)).toBeVisible();
    await expect(page.getByRole('term').filter({ hasText: new RegExp(`^${fact}$`) })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: /^Set up before guests arrive\.$/ })).toBeVisible();
    const headers = await authHeaders(page);
    expect((await page.request.get('/api/work-queue/event/41', { headers })).status()).toBe(404);
    if (process.env.SG2_41_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_41_SCREENSHOTS}/${kind}-detail.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('PW-AUTH-01 | [SG2-23:AC1] [SG2-24:AC1] [NORMAL] each seeded role reaches its assigned application', async ({ page }) => {
  const roles = [
    { account: 'organiser', role: 'Event Organiser', action: 'New request' },
    { account: 'coordinator', role: 'Event Coordinator', action: 'Venues' },
    { account: 'venue', role: 'Venue Staff', action: 'Catalogue' },
    { account: 'support', role: 'Technical Support Staff', action: 'Equipment' },
    { account: 'attendee', role: 'Attendee', action: 'Event page' },
  ];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const { account, role, action } of roles) {
    await test.step(role, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      await expect(page.getByRole('banner')).toContainText(role);
      await expect(page.getByRole('navigation').getByRole('button', { name: action, exact: true })).toBeVisible();
      await expect(page).toHaveTitle(/ConnectSphere/i);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    });
  }
  expect(errors).toEqual([]);
});

test('PW-AUTH-02 | [SG2-23:AC2] [FAILURE] invalid login stays signed out with a generic message', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('organiser@example.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('connectsphere.session'))).toBeNull();
});

test('PW-AUTH-03 | [SG2-23:AC3] [CONFLICT] logout removes browser access and revokes the fixture session', async ({ page }) => {
  await signIn(page);
  const headers = await authHeaders(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect((await page.request.get('/api/profile', { headers })).status()).toBe(401);
});

test('SG2-26-P01 | [SG2-26:AC1] [SG2-26:AC2] [SG2-26:AC3] [SG2-25:AC2] [NORMAL] [FAILURE] colleagues read the same organisation events with creator-only actions', async ({ page }) => {
  await signIn(page);
  const ownEvents = await eventRecords(page);
  expect(ownEvents.map(event => event.event_id)).toEqual([1]);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  await signIn(page, 'colleague');
  expect(await eventRecords(page)).toEqual([{
    event_id: 1, name: 'Planning workshop', proposed_date: '2030-06-15T02:00:00.000Z',
    status: 'draft', coordinator_id: null, coordinator_name: null, can_manage: false,
  }]);
  await nav(page, 'My events');
  await expect(page.getByRole('button', { name: 'View Planning workshop', exact: true })).toBeVisible();
  await expect(page.getByText('Other organisation draft')).toHaveCount(0);
  await page.getByRole('button', { name: 'Draft', exact: true }).click();
  await page.getByRole('button', { name: 'View Planning workshop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planning workshop', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit request', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit request', exact: true })).toHaveCount(0);
  const headers = await authHeaders(page);
  expect((await page.request.get('/api/event-requests/1', { headers })).status()).toBe(200);
  expect((await page.request.patch('/api/event-requests/1', { headers, data: { name: 'Colleague edit' } })).status()).toBe(404);
  expect((await page.request.patch('/api/event-requests/1/submit', { headers })).status()).toBe(404);
  expect((await page.request.delete('/api/event-requests/1', { headers })).status()).toBe(404);
  const mine = await page.request.get('/api/event-requests?scope=mine&status=draft', { headers });
  expect((await mine.json()).requests).toEqual([]);
  await nav(page, 'My drafts');
  await expect(page.getByRole('heading', { name: 'No draft requests', exact: true })).toBeVisible();
  await page.reload();
  await nav(page, 'My events');
  await expect(page.getByRole('button', { name: 'View Planning workshop', exact: true })).toBeVisible();
});

test('SG2-26-P02 | [SG2-26:AC3] [SG2-29:AC2] [CONFLICT] saved event changes reach a colleague dashboard list and detail after reload', async ({ page, context }) => {
  const owner = await context.newPage();
  try {
    await signIn(owner);
    await signIn(page, 'colleague');
    await expect(page.getByText('Planning workshop', { exact: true })).toBeVisible();

    // Write through the real handler and storage adapter, without mocking a
    // browser response. The colleague must fetch the new persisted values.
    const saved = {
      name: 'Updated organisation planning', purpose: 'Confirm the revised programme',
      description: 'The organiser saved this update while their colleague was signed in.',
      proposed_date: '2030-07-16T12:00:00.000Z', expected_attendance: 37,
      venue_requirements: 'A meeting room with 37 seats', accessibility_needs: 'Step-free entrance',
      equipment_requirements: 'Two microphones', registration_needed: true,
    };
    const updated = await owner.request.patch('/api/event-requests/1', {
      headers: await authHeaders(owner), data: saved,
    });
    expect(updated.status()).toBe(200);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your organisation’s events', exact: true })).toBeVisible();
    await expect(page.getByText(saved.name, { exact: true })).toBeVisible();
    await expect(page.getByText('Planning workshop', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Other organisation draft', { exact: true })).toHaveCount(0);
    for (const [label, value] of [['Organisation events', '1'], ['My drafts', '0'], ['Waiting on me', '0']]) {
      await expect(page.locator('.organisation-summary-stat').filter({ hasText: label }).locator('strong')).toHaveText(value);
    }

    await nav(page, 'My events');
    await expect(page.getByRole('button', { name: `View ${saved.name}`, exact: true })).toBeVisible();
    await expect(page.getByText('16 Jul 2030', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `View ${saved.name}`, exact: true }).click();
    await expect(page.getByRole('heading', { name: saved.name, exact: true })).toBeVisible();
    await expect(page.getByText(saved.purpose, { exact: true })).toBeVisible();
    await expect(page.getByText(saved.description, { exact: true })).toBeVisible();
    for (const [label, value] of Object.entries({
      Organisation: 'Regression Organisation', 'Proposed date': '16 Jul 2030',
      'Expected attendance': '37', 'Venue requirements': saved.venue_requirements,
      'Accessibility needs': saved.accessibility_needs, 'Equipment requirements': saved.equipment_requirements,
      'Registration required': 'Yes', Coordinator: 'Unassigned',
    })) {
      await expect(page.locator('dl > div').filter({ has: page.locator('dt').getByText(label, { exact: true }) }).locator('dd')).toHaveText(value);
    }
    await expect(page.getByText(/View only\. This event is shared/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit request', exact: true })).toHaveCount(0);
    const detail = await page.request.get('/api/event-requests/1', { headers: await authHeaders(page) });
    expect(detail.status()).toBe(200);
    expect((await detail.json()).request).toMatchObject({ ...saved, can_manage: false });
  } finally {
    await owner.close();
  }
});

test('SG2-26-N01 | [SG2-26:AC1] [SG2-26:AC2] [BOUNDARY] [FAILURE] another organisation and an account without membership cannot read events', async ({ page }) => {
  await signIn(page, 'organiser2');
  await nav(page, 'My events');
  await expect(page.getByRole('button', { name: 'View Other organisation draft', exact: true })).toBeVisible();
  await expect(page.getByText('Planning workshop')).toHaveCount(0);
  const headers = await authHeaders(page);
  const foreign = await page.request.get('/api/event-requests/1', { headers });
  const absent = await page.request.get('/api/event-requests/9999', { headers });
  expect(foreign.status()).toBe(404);
  expect(absent.status()).toBe(404);
  expect(await foreign.json()).toEqual(await absent.json());
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  await signIn(page, 'unassigned');
  await nav(page, 'My events');
  await expect(page.getByText('No event requests found.', { exact: true })).toBeVisible();
  expect(await eventRecords(page)).toEqual([]);
  const unassigned = await authHeaders(page);
  expect((await page.request.get('/api/event-requests/1', { headers: unassigned })).status()).toBe(404);
});

test('SG2-26-N02 | [SG2-25:AC1] [SG2-25:AC2] [FAILURE] only Event Organisers can access organisation event records', async ({ page }) => {
  for (const account of ['coordinator', 'venue', 'support', 'attendee']) {
    await test.step(account, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      await expect(page.getByRole('navigation').getByRole('button', { name: 'My events', exact: true })).toHaveCount(0);
      const headers = await authHeaders(page);
      for (const endpoint of ['/api/event-requests', '/api/event-requests?scope=mine&status=draft', '/api/event-requests/1']) {
        const response = await page.request.get(endpoint, { headers });
        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({ error: 'Access denied' });
      }
    });
  }
});

test('SG2-42-P01 | [SG2-42:AC1] [SG2-42:AC2] [NORMAL] staff create edit search and reload persisted venue details', async ({ page }) => {
  await signIn(page, 'venue');
  await nav(page, 'Catalogue');
  await page.getByRole('button', { name: 'Add venue', exact: true }).click();
  await fillVenue(page);
  await page.getByRole('button', { name: 'Create venue', exact: true }).click();
  await expect(page.getByRole('heading', { name: venueValues.name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Edit ${venueValues.name}`, exact: true }).click();
  await page.getByLabel('Venue name', { exact: true }).fill('Updated Browser Hall');
  await page.getByLabel('Capacity', { exact: true }).fill('125');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated Browser Hall', exact: true })).toBeVisible();
  await page.reload();
  await nav(page, 'Catalogue');
  await page.getByRole('searchbox').fill('Updated Browser');
  await expect(page.getByRole('heading', { name: 'Updated Browser Hall', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toHaveCount(0);
  await test.info().attach('venue-persistence', { body: await page.screenshot(), contentType: 'image/png' });
  const saved = await page.request.get('/api/venues', { headers: await authHeaders(page) });
  expect((await saved.json()).venues).toContainEqual(expect.objectContaining({ ...venueValues, name: 'Updated Browser Hall', capacity: 125 }));
});

test('SG2-77-P01 | [SG2-77:AC1] [SG2-77:AC3] [SG2-77:AC5] [NORMAL] staff record setup, turnaround and safety details that coordinators can read', async ({ page }) => {
  await signIn(page, 'venue');
  await nav(page, 'Catalogue');
  const hall = page.getByRole('heading', { name: 'Regression Hall', exact: true }).locator('xpath=ancestor::*[contains(@class, "venue-grid")]/*[.//h2[text()="Regression Hall"]]');
  // AC3: nothing recorded yet reads as 0 minutes and "Not recorded".
  await expect(hall.getByText('0 min setup · 0 min turnaround', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Regression Hall', exact: true }).click();
  await page.getByLabel('Setup time (minutes)', { exact: true }).fill('30');
  await page.getByLabel('Turnaround time (minutes)', { exact: true }).fill('45');
  await page.getByLabel('Emergency access', { exact: true }).fill('Two exits to the car park');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Regression Hall saved. The catalogue is up to date.', { exact: true })).toBeVisible();
  await page.reload();
  await nav(page, 'Catalogue');
  await expect(hall.getByText('30 min setup · 45 min turnaround', { exact: true })).toBeVisible();
  await expect(hall.getByText('Two exits to the car park', { exact: true })).toBeVisible();
  await expect(hall.getByText('Not recorded', { exact: true })).toBeVisible();
  const saved = await page.request.get('/api/venues/1/operations', { headers: await authHeaders(page) });
  expect((await saved.json()).operations).toMatchObject({
    setup_minutes: 30, turnaround_minutes: 45, emergency_access: 'Two exits to the car park', known_restrictions: null
  });
  // AC4: a negative value is refused by the API as well as the form.
  const refused = await page.request.put('/api/venues/1/operations', {
    headers: await authHeaders(page), data: { setup_minutes: -1, turnaround_minutes: 0 }
  });
  expect(refused.status()).toBe(400);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();

  // AC6: a coordinator reads the times but cannot change them.
  await signIn(page, 'coordinator');
  const coordinatorHeaders = await authHeaders(page);
  const read = await page.request.get('/api/venues/1/operations', { headers: coordinatorHeaders });
  expect((await read.json()).operations.turnaround_minutes).toBe(45);
  const write = await page.request.put('/api/venues/1/operations', {
    headers: coordinatorHeaders, data: { setup_minutes: 0, turnaround_minutes: 0 }
  });
  expect(write.status()).toBe(403);
});

test('SG2-42-N01 | [SG2-42:AC3] [FAILURE] read-only users cannot create venues through UI or API', async ({ page }) => {
  await signIn(page, 'coordinator');
  await nav(page, 'Venues');
  await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add venue', exact: true })).toHaveCount(0);
  const headers = await authHeaders(page);
  expect((await page.request.post('/api/venues', { headers, data: venueValues })).status()).toBe(403);
  expect((await page.request.put('/api/venues/1', { headers, data: venueValues })).status()).toBe(403);
  expect((await page.request.post('/api/venues', { data: venueValues })).status()).toBe(401);
  const response = await page.request.get('/api/venues', { headers });
  expect((await response.json()).venues).toHaveLength(2);
});

test('SG2-42-B01 | [SG2-42:AC1] [BOUNDARY] venue capacity accepts exact bounds and rejects adjacent values', async ({ page }) => {
  await signIn(page, 'venue');
  await nav(page, 'Catalogue');
  const headers = await authHeaders(page);
  for (const capacity of ['0', '1', '2147483647', '2147483648']) {
    await test.step(`capacity ${capacity}`, async () => {
      await page.getByRole('button', { name: 'Add venue', exact: true }).click();
      await fillVenue(page, `Capacity ${capacity}`, capacity);
      await page.getByRole('button', { name: 'Create venue', exact: true }).click();
      if (capacity === '0' || capacity === '2147483648') {
        expect(await page.getByLabel('Capacity', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
        expect((await page.request.post('/api/venues', { headers, data: { ...venueValues, capacity: Number(capacity) } })).status()).toBe(400);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      } else {
        await expect(page.getByRole('heading', { name: `Capacity ${capacity}`, exact: true })).toBeVisible();
      }
    });
  }
  const saved = await page.request.get('/api/venues', { headers });
  expect(saved.status()).toBe(200);
  const venues = (await saved.json()).venues;
  expect(venues).toHaveLength(4); // two seeds and exactly two accepted boundaries
  expect(venues).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Capacity 1', capacity: 1 }),
    expect.objectContaining({ name: 'Capacity 2147483647', capacity: 2147483647 }),
  ]));
});

test('SG2-42-B02 | [SG2-42:AC1] [BOUNDARY] venue names accept 255 characters and refuse 256 without writes', async ({ page }) => {
  await signIn(page, 'venue');
  await nav(page, 'Catalogue');
  await page.getByRole('button', { name: 'Add venue', exact: true }).click();
  await fillVenue(page, '界'.repeat(256));
  await page.getByRole('button', { name: 'Create venue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('255');
  const headers = await authHeaders(page);
  expect((await page.request.post('/api/venues', { headers, data: { ...venueValues, name: '界'.repeat(256) } })).status()).toBe(400);
  await page.getByLabel('Venue name', { exact: true }).fill('界'.repeat(255));
  await page.getByRole('button', { name: 'Create venue', exact: true }).click();
  await expect(page.getByRole('heading', { name: '界'.repeat(255), exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/venues', { headers })).json()).venues).toHaveLength(3);
});

test('SG2-28-P01 | [SG2-28:AC1] [SG2-30:AC1] [SG2-31:AC3] [SG2-87:AC4] [NORMAL] submit a fresh request and verify its saved data and status', async ({ page }) => {
  await signIn(page);
  // A new submission must replace an earlier selected event as well.
  await nav(page, 'My events');
  await page.getByRole('button', { name: 'View Planning workshop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planning workshop', exact: true })).toBeVisible();
  await nav(page, 'New request');
  await fillEvent(page);
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Browser workshop has been submitted for review.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browser workshop', exact: true })).toBeVisible();
  // SG2-100: a fresh submission with no coordinator lands in `unassigned`,
  // shown as Awaiting Assignment, not `submitted`.
  await expect(page.getByTestId('stage-badge')).toContainText('Awaiting Assignment');
  await expect(page.getByText('Team planning', { exact: true })).toBeVisible();
  await expect(page.getByText('Review the release plan', { exact: true })).toBeVisible();
  await expect(page.getByText(/Select an event from your organisation/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit request', exact: true })).toHaveCount(0);
  await test.info().attach('submitted-event-detail', { body: await page.screenshot(), contentType: 'image/png' });
  await expect.poll(async () => (await eventRecords(page)).find(row => row.name === 'Browser workshop')?.status).toBe('unassigned');
  await page.reload();
  await nav(page, 'My drafts');
  await expect(page.getByRole('heading', { name: 'Planning workshop', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browser workshop', exact: true })).toHaveCount(0);
  await nav(page, 'My events');
  await page.getByRole('button', { name: 'View Browser workshop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser workshop', exact: true })).toBeVisible();
  const record = (await eventRecords(page)).find(row => row.name === 'Browser workshop')!;
  const detail = await page.request.get(`/api/event-requests/${record.event_id}`, { headers: await authHeaders(page) });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).request).toMatchObject({ name: 'Browser workshop', purpose: 'Team planning',
    description: 'Review the release plan', proposed_date: '2030-06-15T09:00:00.000Z',
    expected_attendance: 25, venue_requirements: 'Projector', status: 'unassigned' });
});

test('SG2-28-B01 | [SG2-28:AC4] [SG2-29:AC1] [SG2-30:AC2] [BOUNDARY] [CONFLICT] an empty draft saves once but cannot be submitted', async ({ page }) => {
  await signIn(page);
  await nav(page, 'New request');
  await expect(page.getByRole('button', { name: 'Submit request', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText(/Draft \d+ saved/)).toBeVisible();
  await page.getByLabel(/^Event name/).fill('Partial draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(async () => (await eventRecords(page)).filter(r => r.name === 'Partial draft').length).toBe(1);
  const records = await eventRecords(page);
  expect(records).toHaveLength(2); // one seeded own draft + one newly-created draft
  const created = records.find(r => r.name === 'Partial draft')!;
  expect((await page.request.patch(`/api/event-requests/${created.event_id}/submit`, { headers: await authHeaders(page) })).status()).toBe(400);
  expect((await eventRecords(page)).find(r => r.event_id === created.event_id)?.status).toBe('draft');
});

test('SG2-29-P01 | [SG2-29:AC1] [SG2-29:AC2] [SG2-30:AC1] [NORMAL] editing then submitting preserves the latest field values', async ({ page }) => {
  await signIn(page);
  // Clearing a value must start with something stored; clearing an already-null
  // field would also pass if the edit never persisted at all.
  const headers = await authHeaders(page);
  const initial = await page.request.get('/api/event-requests/1', { headers });
  expect(initial.status()).toBe(200);
  const seed = await page.request.patch('/api/event-requests/1', {
    headers, data: { ...(await initial.json()).request, accessibility_needs: 'Step-free entrance' },
  });
  expect(seed.status()).toBe(200);
  await nav(page, 'My drafts');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel(/^Event name/)).toHaveValue('Planning workshop');
  // The stored 02:00 UTC instant shows as 10:00 Singapore time in a date-time input.
  await expect(page.getByLabel(/^Date/)).toHaveValue('2030-06-15T10:00');
  await expect(page.getByLabel('Accessibility needs (optional)', { exact: true })).toHaveValue('Step-free entrance');
  // No prototype requirement chips or canned suitability banner on a real draft.
  await expect(page.getByRole('button', { name: 'Hearing loop', exact: true })).toHaveCount(0);
  await expect(page.getByText(/expected attendance rules out/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Check venue fit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /fit this request$/ })).toBeVisible();
  await page.getByLabel(/^Event name/).fill('Revised workshop');
  await page.getByLabel('Accessibility needs (optional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Revised workshop has been submitted for review.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revised workshop', exact: true })).toBeVisible();
  await nav(page, 'My drafts');
  await expect(page.getByRole('heading', { name: 'No draft requests', exact: true })).toBeVisible();
  await page.reload();
  const detail = await page.request.get('/api/event-requests/1', { headers: await authHeaders(page) });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).request).toMatchObject({ name: 'Revised workshop', status: 'unassigned', accessibility_needs: null,
    proposed_date: '2030-06-15T02:00:00.000Z' });
});

test('SG2-32-P01 | [SG2-32:AC1] [SG2-32:AC2] [NORMAL] [FAILURE] My drafts excludes non-drafts and confirmed deletion survives reload', async ({ page, request }) => {
  // Reuse the existing mixed-status fixture: the owner has one draft plus
  // submitted, planning, under-review and completed requests.
  expect((await request.post('/__e2e/work-queue')).status()).toBe(204);
  await signIn(page);
  await expect(page.locator('.organisation-summary-stat').filter({ hasText: 'My drafts' }).locator('strong')).toHaveText('1');
  await nav(page, 'My drafts');
  await expect(page.getByRole('region', { name: 'My draft requests' }).getByRole('heading')).toHaveText(['Planning workshop']);
  await expect(page.getByText('Other organisation draft')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await eventRecords(page)).some(r => r.event_id === 1)).toBeTruthy();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planning workshop', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.organisation-summary-stat').filter({ hasText: 'My drafts' }).locator('strong')).toHaveText('0');
  await nav(page, 'My drafts');
  await expect(page.getByRole('heading', { name: 'No draft requests', exact: true })).toBeVisible();
  // Non-drafts were hidden, not deleted: all four still appear in My events.
  await nav(page, 'My events');
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(4);
});

test('SG2-27-P01 | [SG2-27:AC2] [SG2-27:AC4] [NORMAL] profile changes persist and external users have no department field', async ({ page }) => {
  await signIn(page);
  await profile(page);
  await expect(page.getByLabel('Department', { exact: true })).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill('Updated Organiser');
  await page.getByLabel('Phone', { exact: true }).fill('91234567');
  await page.getByLabel('SMS', { exact: true }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Profile updated.');
  await page.reload();
  await profile(page);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Updated Organiser');
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue('91234567');
  await expect(page.getByLabel('SMS', { exact: true })).toBeChecked();
});

test('SG2-27-B01 | [SG2-27:AC3] [BOUNDARY] profile phone accepts eight Singapore digits with optional +65', async ({ page }) => {
  await signIn(page);
  await profile(page);
  const headers = await authHeaders(page);
  for (const { label, phone, status, savedPhone } of [
    { label: '7 local digits', phone: '9123456', status: 400, savedPhone: '+6581234567' },
    { label: '8 local digits', phone: '91234567', status: 200, savedPhone: '91234567' },
    { label: '9 local digits', phone: '912345678', status: 400, savedPhone: '91234567' },
    { label: '8 digits with +65 and spaces', phone: '+65 6123 4567', status: 200, savedPhone: '+65 6123 4567' },
    { label: '7 digits with +65', phone: '+65 9123456', status: 400, savedPhone: '+65 6123 4567' },
    { label: '9 digits with +65', phone: '+65 912345678', status: 400, savedPhone: '+65 6123 4567' },
    { label: 'a different country prefix', phone: '+61 41234567', status: 400, savedPhone: '+65 6123 4567' },
  ]) {
    await test.step(label, async () => {
      const response = page.waitForResponse(r => r.url().endsWith('/api/profile') && r.request().method() === 'PUT');
      await page.getByLabel('Phone', { exact: true }).fill(phone);
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      expect((await response).status()).toBe(status);
      if (status === 400) {
        await expect(page.getByRole('alert')).toHaveText('phone must be a Singapore number with 8 digits, optionally prefixed with +65.');
      } else {
        await expect(page.getByRole('status')).toHaveText('Profile updated.');
      }
      const stored = await page.request.get('/api/profile', { headers });
      expect(stored.status()).toBe(200);
      expect((await stored.json()).profile.phone).toBe(savedPhone);
    });
  }
  await page.reload();
  await profile(page);
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue('+65 6123 4567');
});

test('SG2-44-P01 | [SG2-44:AC1] [SG2-44:AC2] [NORMAL] calendar renders fixture availability and changes its requested month', async ({ page }) => {
  await signIn(page, 'venue');
  await nav(page, 'Venue Availability');
  await page.getByLabel('Jump to year').selectOption('2030');
  await page.getByLabel('Jump to month').selectOption('5');
  await expect(page.getByRole('heading', { name: 'June 2030', exact: true })).toBeVisible();
  await expect(page.getByText('Regression Hall · confirmed · event 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Regression Hall · Scheduled maintenance', { exact: true })).toBeVisible();
  const next = page.waitForResponse(r => r.url().includes('/api/venues/availability') && r.url().includes('2030-07'));
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  expect((await next).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'July 2030', exact: true })).toBeVisible();
  await expect(page.getByText('Regression Hall · Scheduled maintenance', { exact: true })).toHaveCount(0);
});

test('SG2-35-P01 | [SG2-35:AC1] [SG2-35:AC2] [NORMAL] opening an assigned submitted request moves it to under review', async ({ page, request }) => {
  await signIn(page, 'coordinator');
  expect((await request.post('/__e2e/assigned-review')).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();

  const queue = page.getByRole('region', { name: 'Awaiting review' });
  await queue.getByRole('button', { name: /Assigned Review Forum/ }).click();

  // Opening it is the review: the organiser sees under_review without the
  // coordinator pressing anything further.
  await expect(page.getByRole('heading', { name: 'Assigned Review Forum' })).toBeVisible();
  await expect(page.getByText('under review')).toBeVisible();
  await expect(page.getByText('Decide whether the forum proceeds')).toBeVisible();

  // The transition is persisted, not just reflected in the open screen.
  const detail = await page.request.get('/api/work-queue/event/51', { headers: await authHeaders(page) });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).items[0].status).toBe('under_review');
});

test('SG2-35-N01 | [SG2-35:AC3] [SG2-87:AC1] [CONFLICT] a request awaiting assignment never reaches a coordinator and never enters review', async ({ page, request }) => {
  await signIn(page, 'coordinator');
  expect((await request.post('/__e2e/work-queue')).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('1 item in your work queue')).toBeVisible();

  // SG2-87: unassigned request #41 waits in the Lead's queue, not in a
  // coordinator's, and reviewing it is refused even when called directly.
  await expect(page.getByText('Sustainability Leadership Forum')).toHaveCount(0);
  const headers = await authHeaders(page);
  expect((await page.request.patch('/api/event-requests/41/review', { headers })).status()).toBe(404);
  expect((await page.request.get('/api/work-queue/event/41', { headers })).status()).toBe(404);
});

test('SG2-34-P01 | [SG2-33:AC4] [SG2-34:AC2] [SG2-34:AC3] [SG2-34:AC4] [SG2-97:AC4] [NORMAL] an assignment and a reassignment are recorded and the previous coordinator stays in the history', async ({ page, request }) => {
  expect((await request.post('/__e2e/coordinator-assignment')).status()).toBe(204);
  // SG2-97: assignment belongs to the Event Coordinator Lead.
  await signIn(page, 'lead');
  await nav(page, 'Assign coordinators');

  const picker = page.getByLabel('Coordinator for Assignment Forum', { exact: true });
  await picker.selectOption({ label: 'Regression coordinator' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Assigned to Regression coordinator.', { exact: true })).toBeVisible();

  await picker.selectOption({ label: 'Regression second coordinator' });
  await page.getByRole('button', { name: 'Reassign', exact: true }).click();
  await expect(page.getByText('Assigned to Regression second coordinator.', { exact: true })).toBeVisible();

  // SG2-33 AC4 / SG2-34 AC4: who made each change and the previous coordinator, newest first.
  await page.getByRole('button', { name: 'View change history for Assignment Forum', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Event Change History' });
  const entries = drawer.getByTestId(/^audit-entry-/);
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText('Regression lead');
  await expect(entries.nth(0)).toContainText('Regression coordinator');
  await expect(entries.nth(0)).toContainText('Regression second coordinator');
  await expect(entries.nth(1)).toContainText('(empty)');
  await expect(entries.nth(1)).toContainText('Regression coordinator');

  // The history is stored, not just rendered: actor and old/new values persist.
  const history = await page.request.get('/api/event-requests/71/history', { headers: await authHeaders(page) });
  expect(history.status()).toBe(200);
  expect((await history.json()).history.map((entry: Record<string, unknown>) =>
    [entry.actor_id, entry.field_name, entry.old_value, entry.new_value])).toEqual([
    ['user-lead', 'coordinator_id', 'Regression coordinator', 'Regression second coordinator'],
    ['user-lead', 'coordinator_id', null, 'Regression coordinator']
  ]);

  const tokenFor = async (account: string) => {
    const login = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password } });
    expect(login.status()).toBe(200);
    return { Authorization: `Bearer ${(await login.json()).accessToken}` };
  };
  // SG2-34 AC2: the previous coordinator no longer holds the request.
  expect((await request.patch('/api/event-requests/71/review', { headers: await tokenFor('coordinator') })).status()).toBe(404);
  // SG2-34 AC3: the organiser sees the new contact.
  const detail = await request.get('/api/event-requests/71', { headers: await tokenFor('organiser') });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).request.coordinator_name).toBe('Regression second coordinator');
});

test('SG2-90-P01 | [SG2-90:AC1] [SG2-90:AC2] [SG2-90:AC3] [SG2-90:AC4] [NORMAL] [CONFLICT] [FAILURE] a coordinator acts only on events assigned to them and loses an event the moment it is reassigned', async ({ request }) => {
  expect((await request.post('/__e2e/coordinator-access')).status()).toBe(204);
  const tokenFor = async (account: string) => {
    const login = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password } });
    expect(login.status()).toBe(200);
    return { Authorization: `Bearer ${(await login.json()).accessToken}` };
  };
  const coordinator = await tokenFor('coordinator');
  const support = await tokenFor('support');
  const lead = await tokenFor('lead');

  // Every action a coordinator can take on an event, attempted directly on the API.
  const attempt = async (eventId: number) => ({
    review: (await request.patch(`/api/event-requests/${eventId}/review`, { headers: coordinator })).status(),
    decision: (await request.patch(`/api/event-requests/${eventId}/decision`, { headers: coordinator, data: { decision: 'approved' } })).status(),
    planning: (await request.patch(`/api/event-requests/${eventId}/planning`, { headers: coordinator, data: { planning_notes: 'Not mine' } })).status(),
    clarification: (await request.post(`/api/event-requests/${eventId}/clarifications`, { headers: coordinator, data: { message: 'Not mine' } })).status(),
    venue: (await request.post('/api/venue-booking-requests', { headers: coordinator, data: {
      event_id: eventId, venue_id: 1, starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T10:00:00.000Z', layout: 'theatre' } })).status()
  });
  const refused = { review: 404, decision: 404, planning: 403, clarification: 404, venue: 404 };

  // SG2-90 AC2 / AC4: another coordinator's events and unassigned events are refused, whatever
  // state they are in (approved, awaiting review, under review).
  const notMine = [82, 83, 84, 85, 86, 87];
  for (const eventId of notMine) expect({ eventId, ...await attempt(eventId) }).toEqual({ eventId, ...refused });
  // Refused attempts changed nothing: no history was written for any of them.
  for (const eventId of notMine) {
    const history = await request.get(`/api/event-requests/${eventId}/history`, { headers: support });
    expect((await history.json()).history).toEqual([]);
  }

  // SG2-90 AC1: on their own events the same coordinator can review, decide, update planning and request a venue.
  expect((await request.patch('/api/event-requests/88/review', { headers: coordinator })).status()).toBe(200);
  expect((await request.patch('/api/event-requests/89/decision', { headers: coordinator, data: { decision: 'approved' } })).status()).toBe(200);
  const own = await request.patch('/api/event-requests/81/planning', { headers: coordinator, data: { planning_notes: 'Catering confirmed' } });
  expect(own.status()).toBe(200);
  expect((await own.json()).event.planning_notes).toBe('Catering confirmed');
  const venue = await request.post('/api/venue-booking-requests', { headers: coordinator, data: {
    event_id: 81, venue_id: 1, starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T10:00:00.000Z', layout: 'theatre' } });
  expect(venue.status()).toBe(201);

  // SG2-90 AC3: once the Event Coordinator Lead hands each event on, the previous coordinator is refused everywhere.
  for (const eventId of [81, 90, 91]) {
    const reassign = await request.patch(`/api/event-requests/${eventId}/coordinator`, { headers: lead, data: { coordinatorId: 'user-coordinator2' } });
    expect(reassign.status()).toBe(200);
    expect({ eventId, ...await attempt(eventId) }).toEqual({ eventId, ...refused });
  }
});

test('SG2-90-P02 | [SG2-90:AC1] [SG2-90:AC3] [BOUNDARY] rights follow the current assignment exactly: handing an event back restores them and reassigning to the same coordinator changes nothing', async ({ request }) => {
  expect((await request.post('/__e2e/coordinator-access')).status()).toBe(204);
  const tokenFor = async (account: string) => {
    const login = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password } });
    expect(login.status()).toBe(200);
    return { Authorization: `Bearer ${(await login.json()).accessToken}` };
  };
  const coordinator = await tokenFor('coordinator');
  const support = await tokenFor('support');
  const lead = await tokenFor('lead');
  const assignTo = async (coordinatorId: string) =>
    (await request.patch('/api/event-requests/81/coordinator', { headers: lead, data: { coordinatorId } })).status();
  const plan = async (notes: string) =>
    (await request.patch('/api/event-requests/81/planning', { headers: coordinator, data: { planning_notes: notes } })).status();

  // Reassigning to the coordinator who already holds the event is a no-op: rights stay, nothing is recorded.
  expect(await assignTo('user-coordinator')).toBe(200);
  expect(await plan('Still mine')).toBe(200);

  // Away and back again: refused while away, restored the moment it returns.
  expect(await assignTo('user-coordinator2')).toBe(200);
  expect(await plan('Away')).toBe(403);
  expect(await assignTo('user-coordinator')).toBe(200);
  expect(await plan('Back again')).toBe(200);

  // Only the two real handovers are in the history, newest first.
  const history = await request.get('/api/event-requests/81/history', { headers: support });
  expect((await history.json()).history
    .filter((entry: Record<string, unknown>) => entry.field_name === 'coordinator_id')
    .map((entry: Record<string, unknown>) => [entry.old_value, entry.new_value])).toEqual([
    ['Regression second coordinator', 'Regression coordinator'],
    ['Regression coordinator', 'Regression second coordinator']
  ]);
});

test('SG2-37-P01 | [SG2-37:AC1] [NORMAL] approving a request under review persists the approved outcome', async ({ page, request }) => {
  await signIn(page, 'coordinator');
  expect((await request.post('/__e2e/under-review')).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'Awaiting review' })
    .getByRole('button', { name: /Decision Forum/ }).click();

  await expect(page.getByRole('heading', { name: 'Decision Forum' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('approved')).toBeVisible();

  // The decision persisted rather than only showing on the open screen. A
  // coordinator reads it back through their own queue: the organiser event
  // endpoints are restricted to Event Organisers (SG2-26).
  const headers = await authHeaders(page);
  const item = await page.request.get('/api/work-queue/event/52', { headers });
  expect((await item.json()).items[0].status).toBe('approved');
});

test('SG2-37-P02 | [SG2-37:AC2] [NORMAL] [FAILURE] rejecting requires a reason and shows it to the organiser', async ({ page, request }) => {
  await signIn(page, 'coordinator');
  expect((await request.post('/__e2e/under-review')).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'Awaiting review' })
    .getByRole('button', { name: /Decision Forum/ }).click();

  // A rejection without a reason is refused rather than recorded silently.
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('reason is required');
  await expect(page.getByText('under review')).toBeVisible();

  await page.getByLabel(/Reason/).fill('Clashes with the AGM on the same evening.');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('rejected')).toBeVisible();

  // AC2 in full: the organiser who raised it is told why, in their own view.
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  await signIn(page, 'organiser');

  const headers = await authHeaders(page);
  const detail = await page.request.get('/api/event-requests/52', { headers });
  const decided = (await detail.json()).request;
  expect(decided.status).toBe('rejected');
  expect(decided.decision_reason).toBe('Clashes with the AGM on the same evening.');

  await nav(page, 'My events');
  await page.getByRole('button', { name: /Decision Forum/ }).click();
  await expect(page.getByRole('region', { name: 'Why this request was rejected' }))
    .toContainText('Clashes with the AGM on the same evening.');
});

test('SG2-37-N01 | [SG2-35:AC3] [SG2-37:AC1] [CONFLICT] a request another coordinator is reviewing cannot be decided', async ({ page, request }) => {
  await signIn(page, 'coordinator');
  expect((await request.post('/__e2e/work-queue')).status()).toBe(204);
  const headers = await authHeaders(page);

  // Event 43 is under review by a different coordinator.
  const refused = await page.request.patch('/api/event-requests/43/decision', {
    headers, data: { decision: 'approved' },
  });
  expect(refused.status()).toBe(404);

  // Event 41 is submitted but unassigned, so it is not under anyone's review.
  const unassigned = await page.request.patch('/api/event-requests/41/decision', {
    headers, data: { decision: 'approved' },
  });
  expect(unassigned.status()).toBe(404);
});

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
}

test('SG2-36-P01 | [SG2-36:AC1] [SG2-36:AC2] [SG2-36:AC3] [NORMAL] a question goes to the organiser, who answers and resubmits for review', async ({ page, request }) => {
  // AC1: the reviewing coordinator returns the request with a question.
  await signIn(page, 'coordinator');
  expect((await request.post('/__e2e/under-review')).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'Awaiting review' })
    .getByRole('button', { name: /Decision Forum/ }).click();
  const coordinatorThread = page.getByRole('region', { name: 'Clarification conversation' });
  await expect(coordinatorThread.getByText('No questions have been asked yet.')).toBeVisible();
  await coordinatorThread.getByLabel('Ask the organiser a question').fill('Is 15 June firm, or could it move a week?');
  await coordinatorThread.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('needs clarification', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Decide this request' })).toHaveCount(0);
  await signOut(page);

  // AC1: the organiser sees that a response is needed, and the question itself.
  await signIn(page, 'organiser');
  await nav(page, 'My events');
  await page.getByRole('button', { name: /Decision Forum/ }).click();
  await expect(page.getByRole('status', { name: 'Your coordinator has a question' })).toBeVisible();
  const organiserThread = page.getByRole('region', { name: 'Clarification conversation' });
  await expect(organiserThread.getByText('Is 15 June firm, or could it move a week?')).toBeVisible();
  await organiserThread.getByLabel('Answer your coordinator').fill('It can move to 22 June if needed.');
  await organiserThread.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(organiserThread.getByText('It can move to 22 June if needed.')).toBeVisible();

  // AC2: the organiser amends and resubmits from My drafts.
  await page.getByRole('button', { name: 'Edit request', exact: true }).click();
  await page.getByRole('region', { name: 'My draft requests' }).locator('div')
    .filter({ hasText: /^Your coordinator has a question/ })
    .getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel(/^Purpose/).fill('Decide whether the forum proceeds (date flexible)');
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect.poll(async () => (await eventRecords(page)).find(r => r.event_id === 52)?.status).toBe('submitted');
  await signOut(page);

  // AC2 + AC3: it is back in the coordinator's review queue with the whole exchange.
  await signIn(page, 'coordinator');
  await page.getByRole('region', { name: 'Awaiting review' })
    .getByRole('button', { name: /Decision Forum/ }).click();
  await expect(page.getByText('under review', { exact: true })).toBeVisible();
  const history = page.getByRole('region', { name: 'Clarification conversation' }).getByRole('list', { name: 'Messages' });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history).toContainText('Is 15 June firm, or could it move a week?');
  await expect(history).toContainText('It can move to 22 June if needed.');
  await expect(page.getByRole('region', { name: 'Decide this request' })).toBeVisible();
});

test('SG2-36-N01 | [SG2-36:AC3] [CONFLICT] only the two parties to the request can read or join the exchange', async ({ page, request }) => {
  expect((await request.post('/__e2e/under-review')).ok()).toBeTruthy();
  await signIn(page, 'colleague');
  const colleague = await authHeaders(page);
  // A colleague in the same organisation still is not the requester.
  expect((await page.request.get('/api/event-requests/52/clarifications', { headers: colleague })).status()).toBe(404);
  expect((await page.request.post('/api/event-requests/52/clarifications', {
    headers: colleague, data: { message: 'Can I weigh in?' },
  })).status()).toBe(404);
  await signOut(page);

  await signIn(page, 'venue');
  expect((await page.request.get('/api/event-requests/52/clarifications', { headers: await authHeaders(page) })).status()).toBe(403);
  await signOut(page);

  // The organiser cannot reopen the request by posting while it is under review.
  await signIn(page, 'organiser');
  const organiser = await authHeaders(page);
  const posted = await page.request.post('/api/event-requests/52/clarifications', {
    headers: organiser, data: { message: 'Any update?' },
  });
  expect(posted.status()).toBe(201);
  expect((await posted.json()).status).toBe('under_review');
});

test('SG2-45-P01 | [SG2-45:AC1] [SG2-45:AC3] [NORMAL] staff block a free period, see it on the calendar, then remove it', async ({ page }) => {
  await signIn(page, 'venue');
  await nav(page, 'Catalogue');
  await page.getByRole('button', { name: 'Block Regression Hall', exact: true }).click();
  await expect(page.getByRole('listitem', { name: 'Scheduled maintenance' })).toBeVisible();
  await page.getByLabel('Unavailable from', { exact: true }).fill('2030-06-20T09:00');
  await page.getByLabel('Unavailable until', { exact: true }).fill('2030-06-20T17:00');
  await page.getByLabel('Reason', { exact: true }).selectOption('renovation');
  await page.getByLabel('Note', { exact: true }).fill('Carpet replacement');
  await page.getByRole('button', { name: 'Block venue', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Regression Hall is blocked');
  await expect(page.getByRole('listitem', { name: 'Carpet replacement' })).toBeVisible();

  // AC1: the block is recorded and shown as unavailable for that period.
  await nav(page, 'Venue Availability');
  await page.getByLabel('Jump to year').selectOption('2030');
  await page.getByLabel('Jump to month').selectOption('5');
  await expect(page.getByText('Regression Hall · Carpet replacement', { exact: true })).toBeVisible();

  // AC3: removing it makes the venue available for that period again.
  await nav(page, 'Catalogue');
  await page.getByRole('button', { name: 'Block Regression Hall', exact: true }).click();
  await page.getByRole('listitem', { name: 'Carpet replacement' }).getByRole('button', { name: 'Remove block', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Block removed');
  await expect(page.getByRole('listitem', { name: 'Carpet replacement' })).toHaveCount(0);
  const blocks = await page.request.get('/api/venues/1/blocks', { headers: await authHeaders(page) });
  expect((await blocks.json()).blocks.map((block: { reason: string }) => block.reason)).toEqual(['Scheduled maintenance']);
  await nav(page, 'Venue Availability');
  await page.getByLabel('Jump to year').selectOption('2030');
  await page.getByLabel('Jump to month').selectOption('5');
  await expect(page.getByText('Regression Hall · Scheduled maintenance', { exact: true })).toBeVisible();
  await expect(page.getByText('Regression Hall · Carpet replacement', { exact: true })).toHaveCount(0);
});

test('SG2-45-N01 | [SG2-45:AC1] [SG2-45:AC3] [SG2-25:AC1] [FAILURE] other roles cannot block or remove a block', async ({ page }) => {
  await signIn(page, 'venue');
  const staffHeaders = await authHeaders(page);
  const block = { starts_at: '2030-07-01T00:00:00Z', ends_at: '2030-07-02T00:00:00Z', category: 'other', reason: 'Not allowed' };
  for (const account of ['coordinator', 'support', 'organiser', 'attendee']) {
    await test.step(account, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      const headers = await authHeaders(page);
      expect((await page.request.post('/api/venues/1/blocks', { headers, data: block })).status()).toBe(403);
      expect((await page.request.delete('/api/venues/1/blocks/1', { headers })).status()).toBe(403);
      expect((await page.request.get('/api/venues/1/blocks', { headers })).status()).toBe(403);
      if (account === 'coordinator') {
        await nav(page, 'Venues');
        await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Block Regression Hall', exact: true })).toHaveCount(0);
      }
    });
  }
  expect((await page.request.post('/api/venues/1/blocks', { data: block })).status()).toBe(401);
  const remaining = await page.request.get('/api/venues/1/blocks', { headers: staffHeaders });
  expect((await remaining.json()).blocks.map((item: { reason: string }) => item.reason)).toEqual(['Scheduled maintenance']);
});

test('SG2-80-P01 | [SG2-80:AC1] [SG2-80:AC2] [SG2-80:AC3] [SG2-80:AC4] [SG2-80:AC5] [SG2-80:AC6] [NORMAL] staff mark a booked venue unavailable; the booking is flagged, kept and the venue leaves search', async ({ page }) => {
  // AC5 baseline: the coordinator can find Regression Hall at 05:00–06:00 on 15 June 2030, after booking #1 ends.
  const freeSlot = `/api/venues/search?from=${encodeURIComponent('2030-06-15T05:00:00Z')}&to=${encodeURIComponent('2030-06-15T06:00:00Z')}`;
  await signIn(page, 'coordinator');
  const searchNames = async () => ((await (await page.request.get(freeSlot, { headers: await authHeaders(page) })).json()).venues as { name: string }[]).map(venue => venue.name);
  expect(await searchNames()).toContain('Regression Hall');

  // AC1/AC2: Venue Staff mark 14–16 June 2030 unavailable over confirmed booking #1 (event 1, 15 June 02:00–04:00 UTC).
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'venue');
  await nav(page, 'Catalogue');
  await page.getByRole('button', { name: 'Block Regression Hall', exact: true }).click();
  await page.getByLabel('Unavailable from', { exact: true }).fill('2030-06-14T00:00');
  await page.getByLabel('Unavailable until', { exact: true }).fill('2030-06-16T00:00');
  await page.getByLabel('Reason', { exact: true }).selectOption('equipment_failure');
  await page.getByLabel('Note', { exact: true }).fill('Air conditioning failed');
  await page.getByRole('button', { name: 'Block venue', exact: true }).click();

  // AC3/AC4: the booked event is flagged and reported as not cancelled.
  await expect(page.getByRole('status')).toContainText('1 booked event is flagged as affected and not cancelled.');
  const item = page.getByRole('listitem', { name: 'Air conditioning failed' });
  await expect(item).toContainText('Equipment failure: Air conditioning failed');
  // AC6: who recorded it and when.
  await expect(item).toContainText(/Recorded by Regression venue on \d{1,2} \w+ 20\d\d/);
  await expect(page.getByRole('list', { name: 'Events affected by Air conditioning failed' }))
    .toContainText(/^Planning workshop \(draft\) · 15 Jun 2030, /);
  const listed = (await (await page.request.get('/api/venues/1/blocks', { headers: await authHeaders(page) })).json()).blocks
    .find((block: { reason: string }) => block.reason === 'Air conditioning failed');
  expect(listed).toMatchObject({ category: 'equipment_failure', created_by_name: 'Regression venue',
    affected: [{ booking_id: 1, event_id: 1, event_name: 'Planning workshop', event_status: 'draft',
      starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T04:00:00.000Z' }] });

  // AC3/AC5: the coordinator sees the period as unavailable, the booking kept and flagged, and the venue gone from search.
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'coordinator');
  await nav(page, 'Venue Availability');
  await page.getByLabel('Jump to year').selectOption('2030');
  await page.getByLabel('Jump to month').selectOption('5');
  await expect(page.getByText('Regression Hall · Air conditioning failed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Regression Hall · confirmed · event 1 · affected by venue unavailability', { exact: true })).toBeVisible();
  expect(await searchNames()).not.toContain('Regression Hall');
});

test('SG2-80-N01 | [SG2-80:AC1] [SG2-80:AC6] [SG2-25:AC1] [BOUNDARY] [FAILURE] a mark needs a listed reason and a note, and only Venue Staff can make one', async ({ page }) => {
  await signIn(page, 'venue');
  await nav(page, 'Catalogue');
  await page.getByRole('button', { name: 'Block Regression Hall', exact: true }).click();
  await expect(page.getByRole('listitem', { name: 'Scheduled maintenance' })).toBeVisible();
  await page.getByLabel('Unavailable from', { exact: true }).fill('2030-07-01T09:00');
  await page.getByLabel('Unavailable until', { exact: true }).fill('2030-07-01T17:00');
  await page.getByLabel('Note', { exact: true }).fill('No reason chosen');
  // Bypass the browser's required-field check so the screen's own validation runs.
  await page.getByRole('form', { name: 'Block venue' }).evaluate(form => (form as HTMLFormElement).noValidate = true);
  await page.getByRole('button', { name: 'Block venue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('choose a reason, and add a note within 500 characters');
  await page.getByLabel('Reason', { exact: true }).selectOption('safety_concern');
  await page.getByLabel('Note', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Block venue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('choose a reason, and add a note within 500 characters');
  await expect(page.getByRole('listitem', { name: 'No reason chosen' })).toHaveCount(0);

  const staffHeaders = await authHeaders(page);
  const period = { starts_at: '2030-07-01T09:00:00Z', ends_at: '2030-07-01T17:00:00Z' };
  for (const data of [{ ...period, reason: 'Flooded' }, { ...period, category: 'flood', reason: 'Flooded' }, { ...period, category: 'maintenance', reason: ' ' }]) {
    expect((await page.request.post('/api/venues/1/blocks', { headers: staffHeaders, data })).status()).toBe(400);
  }
  // AC6: a recorder or time supplied by the caller is ignored.
  const created = await page.request.post('/api/venues/1/blocks', { headers: staffHeaders,
    data: { ...period, category: 'other', reason: 'Spoof attempt', created_by_name: 'Someone else', created_at: '2000-01-01T00:00:00Z' } });
  expect(created.status()).toBe(201);
  expect((await created.json()).block).toMatchObject({ created_by_name: 'Regression venue', affected: [] });
  expect((await created.json()).block.created_at).not.toBe('2000-01-01T00:00:00Z');

  for (const account of ['coordinator', 'support']) {
    await test.step(account, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      const headers = await authHeaders(page);
      expect((await page.request.post('/api/venues/1/blocks', { headers, data: { ...period, category: 'maintenance', reason: 'Not allowed' } })).status()).toBe(403);
    });
  }
  const remaining = await page.request.get('/api/venues/1/blocks', { headers: staffHeaders });
  expect((await remaining.json()).blocks.map((item: { reason: string }) => item.reason)).toEqual(['Scheduled maintenance', 'Spoof attempt']);
});

test('SG2-46-P01 | [SG2-46:AC1] [SG2-46:AC2] [SG2-46:AC3] [SG2-46:AC4] [NORMAL] an approved event opens a pre-filled venue search that leaves out busy venues', async ({ page, request }) => {
  await signIn(page, 'coordinator');
  expect((await request.post('/__e2e/under-review')).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'Awaiting review' }).getByRole('button', { name: /Decision Forum/ }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Find venues for this event', exact: true }).click();

  // AC1: the whole Singapore day of 15 June 2030 and 20 guests, straight from the event.
  await expect(page.getByText('For: Decision Forum (#52)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('From (Singapore time)')).toHaveValue('2030-06-15T00:00');
  await expect(page.getByLabel('Until (Singapore time)')).toHaveValue('2030-06-15T23:59');
  await expect(page.getByLabel('Attendance', { exact: true })).toHaveValue('20');
  // AC3: this event has no accessibility needs, so accessibility is not matched.
  await expect(page.getByText(/No accessibility needs were specified/)).toBeVisible();
  // AC2: Regression Hall holds a confirmed booking that day, so only Quiet Room fits.
  await expect(page.getByText(/^1 venue available/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quiet Room', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toHaveCount(0);

  // The seeded SG2-45 block keeps Regression Hall out on 16 June too.
  await page.getByLabel('From (Singapore time)').fill('2030-06-16T00:00');
  await page.getByLabel('Until (Singapore time)').fill('2030-06-16T23:59');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/^1 venue available/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toHaveCount(0);

  // A free day returns both.
  await page.getByLabel('From (Singapore time)').fill('2030-06-17T00:00');
  await page.getByLabel('Until (Singapore time)').fill('2030-06-17T23:59');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/^2 venues available/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toBeVisible();

  // AC4: nothing fits 500 guests; say so and show what was searched.
  await page.getByLabel('Attendance', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No venues match', exact: true })).toBeVisible();
  await expect(page.getByText(/^Searched: .*500\+ people$/)).toBeVisible();
});

test('SG2-46-N01 | [SG2-25:AC1] [SG2-25:AC3] [SG2-46:AC2] [FAILURE] only coordinators can search venues', async ({ page }) => {
  const query = `/api/venues/search?from=${encodeURIComponent('2030-06-17T00:00:00Z')}&to=${encodeURIComponent('2030-06-17T12:00:00Z')}`;
  for (const account of ['venue', 'support', 'organiser', 'attendee']) {
    await test.step(account, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      await expect(page.getByRole('navigation').getByRole('button', { name: 'Find venues', exact: true })).toHaveCount(0);
      expect((await page.request.get(query, { headers: await authHeaders(page) })).status()).toBe(403);
    });
  }
  expect((await page.request.get(query)).status()).toBe(401);
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'coordinator');
  await nav(page, 'Find venues');
  await expect(page.getByText('Search venues', { exact: true })).toBeVisible();
  const allowed = await page.request.get(query, { headers: await authHeaders(page) });
  expect(allowed.status()).toBe(200);
  expect((await allowed.json()).venues.map((venue: { name: string }) => venue.name)).toEqual(['Quiet Room', 'Regression Hall']);
});

test('SG2-47-P01 | [SG2-47:AC1] [SG2-47:AC2] [SG2-47:AC4] [NORMAL] a coordinator sees which venues do not fit an approved event and why', async ({ page, request }) => {
  await signIn(page, 'coordinator');
  expect((await request.post('/__e2e/venue-suitability')).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: /Suitability Forum/ }).click();
  await page.getByRole('button', { name: 'Find venues for this event', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Grand Ballroom', exact: true })).toBeVisible();

  const unfit = page.getByRole('region', { name: 'Venues that do not fit Suitability Forum' });
  await expect(unfit.getByRole('heading', { name: '3 of 4 venues do not fit Suitability Forum', exact: true })).toBeVisible();
  await expect(unfit.getByRole('heading', { name: 'Grand Ballroom', exact: true })).toHaveCount(0);
  // AC1: too small, with the reason.
  const theatre = unfit.locator('.venue-grid > *').filter({ has: page.getByRole('heading', { name: 'Lecture Theatre', exact: true }) });
  await expect(theatre.getByText("Expected attendance of 150 is above this venue's capacity of 120.", { exact: true })).toBeVisible();
  await expect(theatre.getByText(/^Can be booked only once .* approve a capacity exception\.$/)).toBeVisible();
  // AC2 and AC4: the missing facility and accessibility feature are named; booking is blocked.
  const hall = unfit.locator('.venue-grid > *').filter({ has: page.getByRole('heading', { name: 'Regression Hall', exact: true }) });
  await expect(hall.getByText('Missing required facility: stage.', { exact: true })).toBeVisible();
  await expect(hall.getByText('Missing accessibility feature: hearing loop.', { exact: true })).toBeVisible();
  await expect(hall.getByText('Cannot be booked: no exception is permitted for a missing facility.', { exact: true })).toBeVisible();
});

test('SG2-47-P02 | [SG2-47:AC3] [SG2-47:AC5] [NORMAL] venue staff approve a capacity exception without approving the booking', async ({ page, request }) => {
  await signIn(page, 'venue');
  expect((await request.post('/__e2e/venue-suitability')).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'Booking requests awaiting decision' }).getByRole('button', { name: /Lecture Theatre/ }).click();
  const panel = page.getByRole('region', { name: 'Venue suitability' });
  await expect(panel.getByText("Expected attendance of 150 is above this venue's capacity of 120.", { exact: true })).toBeVisible();
  await expect(panel.getByText(/does not approve the booking/)).toBeVisible();
  await panel.getByRole('button', { name: 'Approve capacity exception', exact: true }).click();
  // AC3: the approval and approver are recorded against the request.
  await expect(panel.getByText(/^Capacity exception for 150 people approved by Regression venue \(Venue Staff\) on /)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approve capacity exception', exact: true })).toHaveCount(0);

  // AC5: the booking request is still pending and still waiting for Venue Staff.
  await page.getByRole('button', { name: 'Back to work queue', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Booking requests awaiting decision' });
  await expect(queue.getByRole('button', { name: /Lecture Theatre/ })).toContainText('pending');
  const fit = await page.request.get('/api/venue-booking-requests/21/suitability', { headers: await authHeaders(page) });
  expect(await fit.json()).toMatchObject({ request: { status: 'pending' }, booking: 'allowed',
    exceptions: [{ approver_role: 'venue_staff', approved_by: 'user-venue', expected_attendance: 150 }] });
});

test('SG2-47-N01 | [SG2-47:AC2] [SG2-47:AC3] [FAILURE] a missing facility cannot be excepted, and coordinators cannot approve exceptions', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-suitability')).ok()).toBeTruthy();
  await signIn(page, 'venue');
  await page.getByRole('region', { name: 'Booking requests awaiting decision' }).getByRole('button', { name: /Regression Hall/ }).click();
  const panel = page.getByRole('region', { name: 'Venue suitability' });
  await expect(panel.getByText('Cannot be booked: no exception is permitted for a missing facility.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approve capacity exception', exact: true })).toHaveCount(0);
  const blocked = await page.request.post('/api/venue-booking-requests/22/capacity-exception', { headers: await authHeaders(page) });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error).toMatch(/Missing required facility: stage\. No exception is permitted/);

  // Acknowledging the warning is all a coordinator can do; another organiser's event is not found.
  for (const [account, status] of [['coordinator', 403], ['attendee', 403], ['organiser2', 404]] as const) {
    await test.step(account, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      const response = await page.request.post('/api/venue-booking-requests/21/capacity-exception', { headers: await authHeaders(page) });
      expect(response.status()).toBe(status);
    });
  }
  expect((await page.request.post('/api/venue-booking-requests/21/capacity-exception')).status()).toBe(401);
});

test.describe('Tentative venue holds (SG2-84/85)', () => {
  test.use({ timezoneId: 'Asia/Singapore' });
  const holdNow = '2030-06-01T02:00:00.000Z';
  const holdExpiry = '2030-06-03T02:00:00.000Z';
  const holdValues = { event_id: 81, venue_id: 1, starts_at: '2030-06-05T02:00:00.000Z', ends_at: '2030-06-05T04:00:00.000Z', expires_at: holdExpiry };

  async function openHolds(page: Page, account = 'venue', now = holdNow) {
    await signIn(page, account);
    await page.clock.setFixedTime(now);
    await nav(page, 'Venue holds');
    await expect(page.getByRole('heading', { name: 'Tentative venue holds', exact: true })).toBeVisible();
  }

  async function fillHold(page: Page, values: { event?: string; venue?: string; start?: string; end?: string; expiry?: string } = {}) {
    await page.getByRole('combobox', { name: 'Event', exact: true }).selectOption(values.event ?? '81');
    await page.getByRole('combobox', { name: 'Venue', exact: true }).selectOption(values.venue ?? '1');
    await page.getByLabel('Period starts', { exact: true }).fill(values.start ?? '2030-06-05T10:00');
    await page.getByLabel('Period ends', { exact: true }).fill(values.end ?? '2030-06-05T12:00');
    await page.getByLabel('Hold expires', { exact: true }).fill(values.expiry ?? '2030-06-03T10:00');
  }

  async function placeHold(page: Page, values: Parameters<typeof fillHold>[1] = {}) {
    await fillHold(page, values);
    await page.getByRole('button', { name: 'Place hold', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Hold placed. The Event Coordinator has been notified of its expiry.');
  }

  async function clockAt(page: Page, now: string) {
    expect((await page.request.post('/__e2e/hold-time', { data: { now } })).status()).toBe(204);
    await page.clock.setFixedTime(now);
  }

  async function switchAccount(page: Page, account: string, now = holdNow) {
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
    await signIn(page, account);
    await page.clock.setFixedTime(now);
  }

  async function capture(page: Page, name: string, fullPage = true) {
    if (process.env.SG2_HOLDS_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_HOLDS_SCREENSHOTS}/${name}.png`, fullPage });
  }

  test('SG2-84-P01 | [SG2-84:AC1] [SG2-84:AC2] [SG2-84:AC3] [SG2-84:AC4] [SG2-84:AC6] [NORMAL] [FAILURE] [BOUNDARY] [CONFLICT] staff require an expiry, place a Tentative hold and refuse overlaps while allowing adjacent periods', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/status of (400|409)/.test(message.text())) errors.push(message.text()); });
    expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHolds(page);
    await expect(page).toHaveTitle(/ConnectSphere/i);
    expect(new URL(page.url()).origin).toBe('http://127.0.0.1:4173');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page.getByLabel('Hold expires', { exact: true })).toHaveAttribute('required', '');
    await fillHold(page, { expiry: '' });
    await page.getByRole('button', { name: 'Place hold', exact: true }).click();
    expect(await page.getByLabel('Hold expires', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
    const headers = await authHeaders(page);
    expect((await page.request.get('/api/venue-holds', { headers })).ok()).toBe(true);
    expect((await (await page.request.get('/api/venue-holds', { headers })).json()).holds).toEqual([]);
    expect((await page.request.post('/api/venue-holds', { headers, data: { ...holdValues, expires_at: undefined } })).status()).toBe(400);

    await placeHold(page);
    const first = page.getByRole('article', { name: 'Hold #1', exact: true });
    await expect(first.getByText('Tentative', { exact: true })).toBeVisible();
    await expect(first.getByText('Expiry: 3 Jun 2030, 10:00 (SGT) · Hold #1', { exact: true })).toBeVisible();
    const list = await (await page.request.get('/api/venue-holds', { headers })).json();
    expect(list.holds[0]).toMatchObject({ status: 'tentative', booking_id: null, ...holdValues });
    await fillHold(page, { start: '2030-06-05T11:00', end: '2030-06-05T13:00' });
    await page.getByRole('button', { name: 'Place hold', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('This venue is already booked, held or unavailable for that period.');
    await placeHold(page, { start: '2030-06-05T12:00', end: '2030-06-05T13:00' });
    await expect(page.getByRole('article', { name: 'Hold #2', exact: true })).toBeVisible();
    await capture(page, 'staff-holds-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, 'staff-holds-mobile');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await nav(page, 'Venue Availability');
    await expect(page.getByRole('heading', { name: 'June 2030', exact: true })).toBeVisible();
    await expect(page.getByText('Tentative', { exact: true })).toBeVisible();
    await expect(page.getByText('Regression Hall · Tentative · event 81').first()).toBeVisible();
    await capture(page, 'tentative-calendar-desktop');
    expect(errors).toEqual([]);
  });

  test('SG2-84-P02 | [SG2-84:AC5] [SG2-85:AC1] [SG2-85:AC2] [NORMAL] [CONFLICT] staff approve a live hold through its booking request and release a second hold', async ({ page, request }) => {
    expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
    await openHolds(page);
    await placeHold(page);
    const first = page.getByRole('article', { name: 'Hold #1', exact: true });
    await first.getByRole('button', { name: 'Approve booking', exact: true }).click();
    await expect(first.getByText('Confirmed booking', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Booking approved. The hold is now a confirmed booking.');
    const headers = await authHeaders(page);
    const converted = (await (await page.request.get('/api/venue-holds', { headers })).json()).holds[0];
    expect(converted.status).toBe('converted');
    expect(converted.booking_id).toBeGreaterThan(0);
    expect((await page.request.post('/api/venue-holds/1/convert', { headers })).status()).toBe(409);
    await placeHold(page, { venue: '2' });
    const second = page.getByRole('article', { name: 'Hold #2', exact: true });
    await second.getByRole('button', { name: 'Release hold', exact: true }).click();
    await expect(second.getByText('Released', { exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Hold released. The period is available for other requests.');
    await clockAt(page, '2030-06-04T02:00:00.000Z');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(first.getByText('Confirmed booking', { exact: true })).toBeVisible();
    await expect(second.getByText('Released', { exact: true })).toBeVisible();
    const availability = await page.request.get('/api/venues/availability?from=2030-06-05T00:00:00Z&to=2030-06-06T00:00:00Z', { headers });
    const venues = (await availability.json()).venues;
    expect(venues.find((venue: { venueId: number }) => venue.venueId === 1).entries).toEqual([expect.objectContaining({ kind: 'booking', label: 'confirmed · event 81' })]);
    expect(venues.find((venue: { venueId: number }) => venue.venueId === 2).entries).toEqual([]);
    await capture(page, 'converted-and-released');
  });

  test('SG2-85-P01 | [SG2-84:AC6] [SG2-85:AC1] [SG2-85:AC2] [SG2-85:AC3] [SG2-85:AC4] [SG2-85:AC5] [NORMAL] [BOUNDARY] [CONFLICT] an assigned coordinator receives one 24-hour warning, exact expiry and System history, then staff place a new request', async ({ page, request }) => {
    expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
    await openHolds(page);
    await placeHold(page);
    await placeHold(page, { event: '82', venue: '2' });
    await switchAccount(page, 'coordinator');
    await nav(page, 'Venue holds');
    await expect(page.getByRole('article', { name: 'Hold #1', exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Hold #2', exact: true })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Place a tentative hold' })).toHaveCount(0);
    const headers = await authHeaders(page);
    expect((await page.request.post('/api/venue-holds/1/convert', { headers })).status()).toBe(403);
    await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
    await expect(page.getByText('Tentative hold placed', { exact: true })).toBeVisible();
    await expect(page.getByText('Hold expiring soon', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
    await clockAt(page, '2030-06-02T01:59:59.999Z');
    expect((await (await page.request.get('/api/venue-holds/notifications', { headers })).json()).notifications.map((notice: { kind: string }) => notice.kind)).toEqual(['placed']);
    await clockAt(page, '2030-06-02T02:00:00.000Z');
    await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
    await expect(page.getByText('Hold expiring soon', { exact: true })).toBeVisible();
    await expect(page.getByText('2 Jun 2030, 10:00 SGT', { exact: true })).toBeVisible();
    const notices = (await (await page.request.get('/api/venue-holds/notifications', { headers })).json()).notifications;
    expect(notices).toHaveLength(2);
    expect(notices.every((notice: { event_id: number }) => notice.event_id === 81)).toBe(true);
    expect(notices.filter((notice: { kind: string }) => notice.kind === 'warning')).toHaveLength(1);
    await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
    await clockAt(page, '2030-06-03T01:59:59.999Z');
    expect((await (await page.request.get('/api/venue-holds', { headers })).json()).holds[0].status).toBe('tentative');
    await clockAt(page, holdExpiry);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Hold #1', exact: true }).getByText('Expired', { exact: true })).toBeVisible();
    await expect(page.getByText('A new request is needed. This expired hold cannot be approved.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Notifications (2)', exact: true }).click();
    await expect(page.getByText('Hold expired', { exact: true })).toBeVisible();
    expect(await page.getByRole('complementary', { name: 'Notifications', exact: true }).evaluate(panel => panel.getBoundingClientRect().height)).toBeGreaterThan(600);
    await capture(page, 'coordinator-expiry-notifications', false);
    await page.setViewportSize({ width: 390, height: 844 });
    const panel = page.getByRole('complementary', { name: 'Notifications', exact: true });
    expect(await panel.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.top === 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.height === innerHeight && element.scrollWidth <= element.clientWidth;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(panel.getByText('Hold expired', { exact: true })).toBeVisible();
    await capture(page, 'coordinator-notifications-mobile', false);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
    await nav(page, 'Dashboard');
    await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: /Tentative Hold Forum/ }).click();
    await page.getByRole('button', { name: 'View Change History', exact: true }).click();
    await expect(page.getByText('System', { exact: true })).toBeVisible();
    await expect(page.getByText('Automatic', { exact: true })).toBeVisible();
    await expect(page.getByText('Expired hold 1', { exact: true })).toBeVisible();
    await capture(page, 'system-expiry-history', false);
    await page.getByRole('button', { name: 'Close change history', exact: true }).click();
    await switchAccount(page, 'venue', holdExpiry);
    await nav(page, 'Venue holds');
    const expired = page.getByRole('article', { name: 'Hold #1', exact: true });
    await expect(expired.getByRole('button', { name: 'Approve booking', exact: true })).toHaveCount(0);
    const staffHeaders = await authHeaders(page);
    expect((await page.request.post('/api/venue-holds/1/convert', { headers: staffHeaders })).status()).toBe(409);
    await placeHold(page, { expiry: '2030-06-04T10:00' });
    await expect(page.getByRole('article', { name: 'Hold #3', exact: true }).getByText('Tentative', { exact: true })).toBeVisible();
  });

  test('SG2-85-P02 | [SG2-84:AC6] [SG2-85:AC4] [NORMAL] [BOUNDARY] existing notices populate the bell and new warning/expiry arrivals refresh without reopening', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.clock.install();
    expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
    await openHolds(page);
    await placeHold(page);
    await switchAccount(page, 'coordinator');
    await nav(page, 'Venue holds');
    await expect(page.getByRole('button', { name: 'Notifications (1)', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Notifications', exact: true })).toHaveCount(0);

    // The coordinator keeps the drawer closed as the 24-hour warning becomes due.
    await clockAt(page, '2030-06-02T02:00:00.000Z');
    await page.clock.fastForward(30_000);
    await expect(page.getByRole('button', { name: 'Notifications (2)', exact: true })).toBeVisible();
    await capture(page, 'coordinator-automatic-warning-badge', false);
    // Opening shows cached notices immediately and also refreshes both inboxes.
    // Finish that refresh before advancing expiry, otherwise its in-flight guard
    // can correctly skip our only simulated polling tick on a slower CI runner.
    const openingRefresh = Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/venue-holds/notifications') && response.request().method() === 'GET'),
      page.waitForResponse(response => response.url().endsWith('/api/notifications') && response.request().method() === 'GET'),
    ]);
    await page.getByRole('button', { name: 'Notifications (2)', exact: true }).click();
    for (const response of await openingRefresh) {
      expect(response.status()).toBe(200);
      expect(await response.finished()).toBeNull();
    }
    // Let response-consumption microtasks settle before simulating the next tick.
    await page.clock.runFor(1);
    await expect(page.getByText('Hold expiring soon', { exact: true })).toBeVisible();

    // Leave the drawer open: expiry must arrive without closing/reopening it.
    await clockAt(page, holdExpiry);
    await page.clock.fastForward(30_000);
    await expect(page.getByText('Hold expired', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notifications (3)', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await capture(page, 'coordinator-live-expiry-desktop', false);
    await page.setViewportSize({ width: 390, height: 844 });
    const panel = page.getByRole('complementary', { name: 'Notifications', exact: true });
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, 'coordinator-live-expiry-mobile', false);
    expect(errors).toEqual([]);
  });

  test('SG2-84-N01 | [SG2-84:AC1] [SG2-84:AC5] [SG2-85:AC3] [FAILURE] role restrictions protect hold creation, release and approval through the real HTTP routes', async ({ page, request }) => {
    expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
    await openHolds(page);
    await placeHold(page);
    for (const account of ['coordinator', 'support', 'organiser', 'attendee']) {
      await switchAccount(page, account);
      const headers = await authHeaders(page);
      for (const [url, data] of [['/api/venue-holds', holdValues], ['/api/venue-holds/1/release', {}], ['/api/venue-holds/1/convert', {}]] as const) {
        expect((await page.request.post(url, { headers, data })).status()).toBe(403);
      }
    }
    expect((await page.request.post('/api/venue-holds', { data: holdValues })).status()).toBe(401);
  });
});

async function openVenueRequestSearch(page: Page) {
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: /Venue Request Forum/ }).click();
  await page.getByRole('button', { name: 'Find venues for this event', exact: true }).click();
  await expect(page.getByText('For: Venue Request Forum (#91)', { exact: true })).toBeVisible();
}

function venueCard(page: Page, venue: string) {
  return page.locator('.venue-grid > *').filter({ has: page.getByRole('heading', { name: venue, exact: true }) }).first();
}

/** Fills and sends an open request form for the venue. */
async function sendVenueRequest(page: Page, venue: string, from: string, until: string) {
  const form = page.getByRole('form', { name: `Request ${venue}` });
  await form.getByLabel('Request from (Singapore time)').fill(from);
  await form.getByLabel('Request until (Singapore time)').fill(until);
  await form.getByRole('button', { name: 'Send request', exact: true }).click();
  return form;
}

async function requestVenue(page: Page, venue: string, from: string, until: string) {
  await venueCard(page, venue).getByRole('button', { name: 'Request this venue', exact: true }).click();
  return sendVenueRequest(page, venue, from, until);
}

test('SG2-48-P01 | [SG2-48:AC1] [SG2-48:AC2] [SG2-48:AC3] [NORMAL] a coordinator requests a venue; it waits pending for Venue Staff without holding the venue', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-request')).status()).toBe(204);
  await signIn(page, 'coordinator');
  await openVenueRequestSearch(page);
  // 80 guests leaves out Quiet Room; Regression Hall is free all day.
  await expect(page.getByText(/^1 venue available/)).toBeVisible();
  const list = page.getByRole('region', { name: 'Venue requests for Venue Request Forum' });
  await expect(list.getByText('No venues have been requested for this event yet.', { exact: true })).toBeVisible();

  // AC1: the request carries the period, the layout and the event's venue requirements.
  const card = venueCard(page, 'Regression Hall');
  await card.getByRole('button', { name: 'Request this venue', exact: true }).click();
  await expect(card.getByLabel('Required layout')).toHaveValue('theatre');
  await expect(card.getByText('A projector', { exact: true })).toBeVisible();
  await sendVenueRequest(page, 'Regression Hall', '2030-06-20T09:00', '2030-06-20T12:00');
  await expect(page.getByText('Regression Hall requested. It is pending until Venue Staff decide, and the venue is not held until then.', { exact: true })).toBeVisible();

  // AC3: shown as pending, and the venue is neither held nor shown as unavailable.
  await expect(list.getByText('Pending', { exact: true })).toBeVisible();
  await expect(list.getByText(/Awaiting a Venue Staff decision/)).toBeVisible();
  const period = `from=${encodeURIComponent('2030-06-20T01:00:00.000Z')}&to=${encodeURIComponent('2030-06-20T04:00:00.000Z')}`;
  const availability = await page.request.get(`/api/venues/1/availability?${period}`, { headers: await authHeaders(page) });
  expect((await availability.json()).entries).toEqual([]);
  const search = await page.request.get(`/api/venues/search?${period}`, { headers: await authHeaders(page) });
  expect((await search.json()).venues.map((venue: { name: string; held: unknown[] }) => [venue.name, venue.held]))
    .toEqual([['Quiet Room', []], ['Regression Hall', []]]);

  // AC2: Venue Staff receive it, awaiting their decision, with what they need to decide.
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'venue');
  const queue = page.getByRole('region', { name: 'Booking requests awaiting decision' });
  await expect(queue.getByRole('button', { name: /Regression Hall/ })).toContainText('pending');
  await queue.getByRole('button', { name: /Regression Hall/ }).click();
  const detail = page.getByRole('article', { name: 'Venue booking request' });
  await expect(detail.getByText('Venue Request Forum · Event #91', { exact: true })).toBeVisible();
  for (const [label, value] of [['Required layout', 'Theatre'], ['Venue requirements', 'A projector'], ['Requested by', 'Regression coordinator']]) {
    await expect(detail.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd')).toHaveText(value);
  }
  await expect(detail.getByText(/20 Jun 2030, 09:00 – 20 Jun 2030, 12:00/)).toBeVisible();
});

test('SG2-48-P02 | [SG2-48:AC4] [NORMAL] one event requests several different venues, each pending on its own', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-request')).status()).toBe(204);
  await signIn(page, 'coordinator');
  await openVenueRequestSearch(page);
  await page.getByLabel('Attendance', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/^2 venues available/)).toBeVisible();
  await requestVenue(page, 'Regression Hall', '2030-06-20T09:00', '2030-06-20T12:00');
  await expect(page.getByText(/^Regression Hall requested\./)).toBeVisible();
  await requestVenue(page, 'Quiet Room', '2030-06-20T09:00', '2030-06-20T12:00');
  await expect(page.getByText(/^Quiet Room requested\./)).toBeVisible();
  const list = page.getByRole('region', { name: 'Venue requests for Venue Request Forum' });
  await expect(list.getByRole('heading', { level: 3 })).toHaveText(['Regression Hall', 'Quiet Room']);
  await expect(list.getByText('Pending', { exact: true })).toHaveCount(2);
  await expect(list.getByText(/Boardroom/)).toBeVisible();
});

test('SG2-48-N01 | [SG2-48:AC1] [SG2-48:AC4] [CONFLICT] [FAILURE] a duplicate request, an unoffered layout or a non-coordinator is refused', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-request')).status()).toBe(204);
  await signIn(page, 'coordinator');
  await openVenueRequestSearch(page);
  await requestVenue(page, 'Regression Hall', '2030-06-20T09:00', '2030-06-20T12:00');
  await expect(page.getByText(/^Regression Hall requested\./)).toBeVisible();

  // AC4: the same venue over an overlapping period is refused, naming the earlier request.
  const form = await requestVenue(page, 'Regression Hall', '2030-06-20T11:00', '2030-06-20T14:00');
  await expect(form.getByRole('alert')).toHaveText(/^This event already requested Regression Hall for an overlapping period \(request #\d+, pending\)\.$/);
  const list = page.getByRole('region', { name: 'Venue requests for Venue Request Forum' });
  await expect(list.getByText('Pending', { exact: true })).toHaveCount(1);

  // AC1: only a layout the venue offers, a valid period, and an event the caller coordinates.
  const headers = await authHeaders(page);
  const values = { event_id: 91, venue_id: 1, layout: 'theatre', starts_at: '2030-06-21T01:00:00.000Z', ends_at: '2030-06-21T04:00:00.000Z' };
  const layout = await page.request.post('/api/venue-booking-requests', { headers, data: { ...values, layout: 'banquet' } });
  expect([layout.status(), (await layout.json()).error]).toEqual([409, 'Regression Hall does not offer the banquet layout. It offers: theatre, classroom.']);
  expect((await page.request.post('/api/venue-booking-requests', { headers, data: { ...values, event_id: 1 } })).status()).toBe(404);
  expect((await page.request.post('/api/venue-booking-requests', { headers, data: { ...values, ends_at: values.starts_at } })).status()).toBe(400);

  for (const account of ['venue', 'organiser', 'attendee']) {
    await test.step(account, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      const refused = await page.request.post('/api/venue-booking-requests', { headers: await authHeaders(page), data: values });
      expect(refused.status()).toBe(403);
    });
  }
  expect((await page.request.post('/api/venue-booking-requests', { data: values })).status()).toBe(401);
});

test('SG2-50-P01 | [SG2-50:AC1] [SG2-50:AC2] [CONFLICT] a request overlapping a confirmed booking is reported to the coordinator and to Venue Staff, and cannot be approved while it stands', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-request')).status()).toBe(204);
  await signIn(page, 'coordinator');
  await openVenueRequestSearch(page);
  // Regression Hall already has confirmed booking #1 on 15 Jun 2030, 10:00-12:00.
  await requestVenue(page, 'Regression Hall', '2030-06-15T11:00', '2030-06-15T13:00');
  // AC1: the request is made, and the coordinator is told what it overlaps.
  // Booking #1 is another coordinator's event, so only its number and period show.
  // Times follow the browser's en-SG clock style ("10:00" or "10:00 am").
  await expect(page.getByText(/^Regression Hall requested\./)).toHaveText(new RegExp('^Regression Hall requested\\. It is pending until Venue Staff decide, and the venue is not held until then\\.'
    + ' It overlaps Confirmed booking #1 for another event, 15 Jun 2030, 10:00( am)? – 15 Jun 2030, 12:00( pm)?, so it cannot be approved while that conflict stands\\.$'));
  // A period ending as the booking starts overlaps nothing.
  await requestVenue(page, 'Regression Hall', '2030-06-15T08:00', '2030-06-15T10:00');
  await expect(page.getByText(/^Regression Hall requested\./)).toHaveText('Regression Hall requested. It is pending until Venue Staff decide, and the venue is not held until then.');

  // AC1/AC2: Venue Staff see the clash, by event, before deciding.
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'venue');
  const queue = page.getByRole('region', { name: 'Booking requests awaiting decision' });
  const detail = page.getByRole('article', { name: 'Venue booking request' });
  const conflicts = detail.getByRole('region', { name: 'Booking conflicts' });
  await queue.getByRole('button', { name: /Regression Hall/ }).filter({ hasText: /11:00/ }).click();
  await expect(conflicts.getByRole('listitem')).toHaveText([/^Confirmed booking #1 for Planning workshop, 15 Jun 2030, 10:00( am)? – 15 Jun 2030, 12:00( pm)?$/]);
  await expect(conflicts.getByText('This request cannot be approved while this conflict stands.', { exact: true })).toBeVisible();
  // AC2: approving it is refused while booking #1 stands, and it stays pending.
  const decision = detail.getByRole('region', { name: 'Decide this booking request' });
  await decision.getByRole('button', { name: 'Approve booking', exact: true }).click();
  await expect(decision.getByRole('alert')).toHaveText('Regression Hall is already booked for Planning workshop during this period.');
  await expect(detail.getByText('pending', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to work queue' }).click();
  await queue.getByRole('button', { name: /Regression Hall/ }).filter({ hasText: /08:00/ }).click();
  await expect(conflicts.getByText('Nothing else is booked at this venue over the requested period.', { exact: true })).toBeVisible();
  // The adjacent request overlaps nothing, so it can be approved.
  await decision.getByRole('button', { name: 'Approve booking', exact: true }).click();
  await expect(decision.getByRole('status')).toHaveText('Approved. The venue is committed to this event and the coordinator has been notified.');
});

test('SG2-51-P01 | [SG2-51:AC1] [SG2-51:AC2] [SG2-51:AC3] [SG2-51:AC4] [SG2-51:AC5] [NORMAL] a coordinator releases one of two venues with a reason; the period is free, the other venue stays and both coordinator and organiser are told', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-release')).status()).toBe(204);
  await signIn(page, 'coordinator');
  await openVenueRequestSearch(page);
  const booked = page.getByRole('region', { name: 'Booked venues for Venue Request Forum' });
  const hall = booked.getByRole('listitem', { name: 'Booking #21' });
  const room = booked.getByRole('listitem', { name: 'Booking #22' });
  await expect(hall.getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(room.getByText('Confirmed', { exact: true })).toBeVisible();
  const requests = page.getByRole('region', { name: 'Venue requests for Venue Request Forum' });
  await expect(requests.getByText('Approved', { exact: true })).toBeVisible();

  // AC1: a reason is required, then the release goes through.
  await hall.getByRole('button', { name: 'Release booking', exact: true }).click();
  await hall.getByRole('button', { name: 'Confirm release', exact: true }).click();
  await expect(hall.getByRole('alert')).toHaveText('Give a reason for releasing this booking. The coordinator and Event Organiser will see it.');
  await hall.getByLabel('Reason for releasing').fill('The keynote moved online');
  await hall.getByRole('button', { name: 'Confirm release', exact: true }).click();
  await expect(booked.getByRole('status')).toContainText('Regression Hall released for');
  // AC5: who released it and why; AC3: the other venue is untouched.
  await expect(hall.getByText('Released', { exact: true })).toBeVisible();
  await expect(hall.getByText(/^Released by Regression coordinator on .*: The keynote moved online$/)).toBeVisible();
  await expect(room.getByText('Confirmed', { exact: true })).toBeVisible();
  // AC2: the request that committed the booking is no longer live, so the venue can be requested again.
  await expect(requests.getByText('Cancelled', { exact: true })).toBeVisible();

  // AC2: the period is free again at Regression Hall, but not at Quiet Room.
  const period = `from=${encodeURIComponent('2030-06-20T01:00:00.000Z')}&to=${encodeURIComponent('2030-06-20T05:00:00.000Z')}`;
  const headers = await authHeaders(page);
  expect((await (await page.request.get(`/api/venues/1/availability?${period}`, { headers })).json()).entries).toEqual([]);
  expect((await (await page.request.get(`/api/venues/2/availability?${period}`, { headers })).json()).entries).toHaveLength(1);

  // AC4: the coordinator and the Event Organiser are told, with the reason.
  await page.reload();
  await page.getByRole('button', { name: /^Notifications \(1\)$/ }).click();
  const drawer = page.getByRole('complementary', { name: 'Notifications' });
  await expect(drawer.getByText('Venue booking released', { exact: true })).toBeVisible();
  await expect(drawer.getByText(/^Regression Hall was released for Venue Request Forum \(.*\): The keynote moved online$/)).toBeVisible();
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'organiser');
  await page.getByRole('button', { name: /^Notifications \(1\)$/ }).click();
  await expect(page.getByRole('complementary', { name: 'Notifications' }).getByText(/The keynote moved online$/)).toBeVisible();
});

test('SG2-51-P02 | [SG2-51:AC1] [SG2-51:AC3] [NORMAL] [FAILURE] Venue Staff release a booking from the catalogue; other roles cannot release', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-release')).status()).toBe(204);
  await signIn(page, 'venue');
  await page.getByRole('button', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'Bookings for Quiet Room', exact: true }).click();
  const upcoming = page.getByRole('region', { name: 'Upcoming bookings for Quiet Room' });
  const booking = upcoming.getByRole('listitem', { name: 'Booking #22' });
  await expect(booking.getByText('Venue Request Forum', { exact: true })).toBeVisible();
  await booking.getByRole('button', { name: 'Release booking', exact: true }).click();
  await booking.getByLabel('Reason for releasing').fill('Flooded floor');
  await booking.getByRole('button', { name: 'Confirm release', exact: true }).click();
  await expect(booking.getByText(/^Released by Regression venue on .*: Flooded floor$/)).toBeVisible();
  // Releasing it again is refused; the event's other venue is still booked.
  const again = await page.request.post('/api/venue-bookings/22/release', { headers: await authHeaders(page), data: { reason: 'Again' } });
  expect([again.status(), (await again.json()).error]).toEqual([409, 'This booking has already been released.']);
  const listed = await page.request.get('/api/venue-bookings?event_id=91', { headers: await authHeaders(page) });
  expect((await listed.json()).bookings.map((row: { booking_id: number; status: string }) => [row.booking_id, row.status]))
    .toEqual([[21, 'confirmed'], [22, 'cancelled']]);

  for (const account of ['organiser', 'support', 'attendee']) {
    await test.step(account, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      const refused = await page.request.post('/api/venue-bookings/21/release', { headers: await authHeaders(page), data: { reason: 'Not mine' } });
      expect(refused.status()).toBe(403);
    });
  }
  expect((await page.request.post('/api/venue-bookings/21/release', { data: { reason: 'x' } })).status()).toBe(401);
});

test('SG2-78-P01 | [SG2-78:AC1] [SG2-78:AC2] [SG2-78:AC3] [SG2-78:AC4] [SG2-78:AC5] [NORMAL] [CONFLICT] setup and turnaround widen a booking in the calendar, conflicts, approval and search, without changing its times', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-request')).status()).toBe(204);
  // Venue Staff record 30 minutes setup and 45 minutes turnaround for Regression Hall (SG2-77).
  await signIn(page, 'venue');
  const times = await page.request.put('/api/venues/1/operations', { headers: await authHeaders(page),
    data: { setup_minutes: 30, turnaround_minutes: 45, emergency_access: null, known_restrictions: null } });
  expect(times.status()).toBe(200);

  // AC1: booking #1 (15 Jun 2030, 10:00-12:00 SGT) occupies 09:30-12:45.
  // AC3: its setup and turnaround are occupied, marked separately from the event.
  const day = `from=${encodeURIComponent('2030-06-15T00:00:00.000Z')}&to=${encodeURIComponent('2030-06-16T00:00:00.000Z')}`;
  const availability = await page.request.get(`/api/venues/1/availability?${day}`, { headers: await authHeaders(page) });
  expect((await availability.json()).entries.map((entry: { kind: string; start: string; end: string }) => [entry.kind, entry.start, entry.end])).toEqual([
    ['setup', '2030-06-15T01:30:00.000Z', '2030-06-15T02:00:00.000Z'],
    ['booking', '2030-06-15T02:00:00.000Z', '2030-06-15T04:00:00.000Z'],
    ['turnaround', '2030-06-15T04:00:00.000Z', '2030-06-15T04:45:00.000Z']
  ]);
  await nav(page, 'Venue Availability');
  await page.getByLabel('Jump to year').selectOption('2030');
  await page.getByLabel('Jump to month').selectOption('5');
  for (const item of ['Setup (30 min) for confirmed · event 1', 'confirmed · event 1', 'Turnaround (45 min) after confirmed · event 1']) {
    await expect(page.getByText(`Regression Hall · ${item}`, { exact: true })).toBeVisible();
  }

  // AC4: search leaves Regression Hall out while the requested time cuts into its
  // setup or turnaround, and returns it once the 75 minutes are clear.
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'coordinator');
  const search = async (from: string, to: string) => {
    const found = await page.request.get(`/api/venues/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: await authHeaders(page) });
    return (await found.json()).venues.map((venue: { name: string }) => venue.name);
  };
  expect(await search('2030-06-15T04:30:00.000Z', '2030-06-15T05:00:00.000Z')).toEqual(['Quiet Room']);
  expect(await search('2030-06-15T05:15:00.000Z', '2030-06-15T06:00:00.000Z')).toEqual(['Quiet Room', 'Regression Hall']);

  // AC2: a request starting 30 minutes after booking #1 ends is reported as clashing with it.
  await openVenueRequestSearch(page);
  await requestVenue(page, 'Regression Hall', '2030-06-15T12:30', '2030-06-15T13:00');
  await expect(page.getByText(/^Regression Hall requested\./)).toHaveText(new RegExp('It overlaps Confirmed booking #1 for another event, '
    + '15 Jun 2030, 10:00( am)? – 15 Jun 2030, 12:00( pm)?, so it cannot be approved while that conflict stands\\.$'));
  // Exactly setup plus turnaround after it, a request is clear.
  await requestVenue(page, 'Regression Hall', '2030-06-15T13:15', '2030-06-15T14:00');
  await expect(page.getByText(/^Regression Hall requested\./)).toHaveText('Regression Hall requested. It is pending until Venue Staff decide, and the venue is not held until then.');

  // AC2: Venue Staff see the clash by event and cannot approve it; the clear request is approved.
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'venue');
  const queue = page.getByRole('region', { name: 'Booking requests awaiting decision' });
  const detail = page.getByRole('article', { name: 'Venue booking request' });
  const decision = detail.getByRole('region', { name: 'Decide this booking request' });
  await queue.getByRole('button', { name: /Regression Hall/ }).filter({ hasText: /12:30/ }).click();
  await expect(detail.getByRole('region', { name: 'Booking conflicts' }).getByRole('listitem')).toHaveText([/^Confirmed booking #1 for Planning workshop/]);
  await decision.getByRole('button', { name: 'Approve booking', exact: true }).click();
  await expect(decision.getByRole('alert')).toHaveText('Regression Hall is already booked for Planning workshop during this period.');
  await page.getByRole('button', { name: 'Back to work queue' }).click();
  await queue.getByRole('button', { name: /Regression Hall/ }).filter({ hasText: /13:15/ }).click();
  await decision.getByRole('button', { name: 'Approve booking', exact: true }).click();
  await expect(decision.getByRole('status')).toHaveText('Approved. The venue is committed to this event and the coordinator has been notified.');

  // AC5: the booking keeps the event's own times; only the checks widen.
  const booked = await page.request.get('/api/venue-bookings?event_id=91', { headers: await authHeaders(page) });
  expect((await booked.json()).bookings.map((row: { starts_at: string; ends_at: string }) => [row.starts_at, row.ends_at]))
    .toEqual([['2030-06-15T05:15:00.000Z', '2030-06-15T06:00:00.000Z']]);
});

test('SG2-86-P01 | [SG2-86:AC1/AC3/AC4] [NORMAL] a new Week 7 role signs in, sees its own role and is denied ungranted operations', async ({ page }) => {
  await signIn(page, 'safety');
  await expect(page.getByLabel('Your role', { exact: true })).toHaveText('Safety Officer');

  await profile(page);
  await expect(page.getByLabel('Department', { exact: true })).toBeVisible();
  // The header role badge and the page eyebrow also read "Safety Officer";
  // the profile card's Role fact is the last matching element on the page.
  await expect(page.getByText('Safety Officer', { exact: true }).last()).toBeVisible();

  expect((await page.request.get('/api/work-queue', { headers: await authHeaders(page) })).status()).toBe(403);
});

test('SG2-87-P01 | [SG2-87:AC1] [SG2-87:AC2] [SG2-87:AC3] [SG2-87:AC4] [SG2-87:AC5] [NORMAL] [FAILURE] a submitted request waits in the Lead\'s unassigned queue until it is assigned', async ({ page, request }) => {
  expect((await request.post('/__e2e/coordinator-assignment')).status()).toBe(204);
  const tokenFor = async (account: string) => {
    const login = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password } });
    expect(login.status()).toBe(200);
    return { Authorization: `Bearer ${(await login.json()).accessToken}` };
  };
  const [organiser, coordinator, lead] = [await tokenFor('organiser'), await tokenFor('coordinator'), await tokenFor('lead')];
  const queue = async () => (await (await request.get('/api/assignment-queue', { headers: lead })).json()).entries as Record<string, unknown>[];

  // AC1: the organiser submits draft #1; it enters the queue with a submission time and reaches no coordinator.
  const before = Date.now();
  expect((await request.patch('/api/event-requests/1/submit', { headers: organiser })).status()).toBe(200);
  const entry = (await queue()).find(item => item.event_id === 1)!;
  // AC3: the entry carries the basic event details.
  expect({ ...entry, submitted_at: undefined }).toEqual({
    event_id: 1, name: 'Planning workshop', organiser_name: 'Regression organiser',
    proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 20, submitted_at: undefined
  });
  expect(Date.parse(String(entry.submitted_at))).toBeGreaterThanOrEqual(before - 1000);
  expect(((await (await request.get('/api/work-queue', { headers: coordinator })).json()).items as Record<string, unknown>[])
    .some(item => item.event_id === 1)).toBe(false);

  // AC2: only the Event Coordinator Lead can view the queue. (Tokens are reused:
  // the login rate limit allows ten sign-ins per window, UI sign-ins included.)
  const others = [organiser, coordinator];
  for (const account of ['support', 'venue', 'safety', 'attendee']) others.push(await tokenFor(account));
  for (const headers of others) {
    expect((await request.get('/api/assignment-queue', { headers })).status()).toBe(403);
  }

  // AC4: the organiser sees the request as Unassigned.
  await signIn(page, 'organiser');
  await nav(page, 'My events');
  await expect(page.getByRole('button', { name: 'View Planning workshop' }).getByText('Unassigned').first()).toBeVisible();

  // AC3 on screen: the Lead's queue shows the entry cleanly on a phone and a laptop (DoD v2.1).
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await signIn(page, 'lead');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await nav(page, 'Unassigned queue');
    const card = page.getByRole('article', { name: 'Planning workshop' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Regression organiser')).toBeVisible();
    await expect(card.getByText('15 Jun 2030, 10:00 am')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // AC5: once the Lead assigns it, it leaves the queue and the organiser no longer sees Unassigned.
  expect((await request.patch('/api/event-requests/1/coordinator', { headers: lead, data: { coordinatorId: 'user-coordinator' } })).status()).toBe(200);
  expect((await queue()).some(item => item.event_id === 1)).toBe(false);
  await nav(page, 'Dashboard');
  await nav(page, 'Unassigned queue');
  await expect(page.getByRole('article', { name: 'Planning workshop' })).toHaveCount(0);
  const detail = await (await request.get('/api/event-requests/1', { headers: organiser })).json();
  expect([detail.request.status, detail.request.coordinator_name]).toEqual(['submitted', 'Regression coordinator']);
});

test('SG2-97-P01 | [SG2-97:AC1] [SG2-97:AC2] [SG2-97:AC3] [NORMAL] [FAILURE] assignment moves to the Event Coordinator Lead while earlier assignments, their history and the organiser contact stay', async ({ page, request }) => {
  expect((await request.post('/__e2e/legacy-assignment')).status()).toBe(204);
  const tokenFor = async (account: string) => {
    const login = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password } });
    expect(login.status()).toBe(200);
    return { Authorization: `Bearer ${(await login.json()).accessToken}` };
  };
  const support = await tokenFor('support');

  // AC1: Technical Support Staff are refused on the server for listing and for assigning, and the event is untouched.
  expect((await request.get('/api/event-requests/assignable', { headers: support })).status()).toBe(403);
  expect((await request.patch('/api/event-requests/95/coordinator', { headers: support, data: { coordinatorId: 'user-coordinator' } })).status()).toBe(403);

  // AC2: the assignment Technical Support made earlier is still in place, with its history.
  const history = await request.get('/api/event-requests/95/history', { headers: support });
  expect((await history.json()).history.map((entry: Record<string, unknown>) =>
    [entry.actor_id, entry.field_name, entry.old_value, entry.new_value])).toEqual([
    ['user-support', 'coordinator_id', null, 'Regression coordinator']
  ]);

  // AC3: the organiser still sees who their coordinator is and how to reach them.
  const detail = await request.get('/api/event-requests/95', { headers: await tokenFor('organiser') });
  expect(detail.status()).toBe(200);
  const event = (await detail.json()).request;
  expect([event.coordinator_name, event.coordinator_phone]).toEqual(['Regression coordinator', '+6581234567']);

  // AC1: the Event Coordinator Lead is offered the assignment screen and it lists the event,
  // laid out cleanly on a phone and on a laptop (DoD v2.1).
  await signIn(page, 'lead');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await nav(page, 'Assign coordinators');
    await expect(page.getByRole('heading', { name: 'Legacy Forum' })).toBeVisible();
    await expect(page.getByLabel('Coordinator for Legacy Forum', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('SG2-97-P02 | [SG2-97:AC2] [CONFLICT] the Event Coordinator Lead takes over an assignment Technical Support made, keeping its history', async ({ request }) => {
  expect((await request.post('/__e2e/legacy-assignment')).status()).toBe(204);
  const tokenFor = async (account: string) => {
    const login = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password } });
    expect(login.status()).toBe(200);
    return { Authorization: `Bearer ${(await login.json()).accessToken}` };
  };
  expect((await request.post('/__e2e/coordinator-assignment')).status()).toBe(204);
  const lead = await tokenFor('lead');
  const coordinator = await tokenFor('coordinator');

  // Before: the coordinator Technical Support assigned can plan the event.
  const plan = async () => (await request.patch('/api/event-requests/95/planning', { headers: coordinator, data: { planning_notes: 'Mine?' } })).status();
  expect(await plan()).toBe(200);

  // The Lead reassigns it under the new rules; the earlier coordinator loses it at once.
  expect((await request.patch('/api/event-requests/95/coordinator', { headers: lead, data: { coordinatorId: 'user-coordinator2' } })).status()).toBe(200);
  expect(await plan()).toBe(403);

  // Both assignments stay in the history, the earlier one still credited to Technical Support.
  const history = await request.get('/api/event-requests/95/history', { headers: lead });
  expect((await history.json()).history
    .filter((entry: Record<string, unknown>) => entry.field_name === 'coordinator_id')
    .map((entry: Record<string, unknown>) => [entry.actor_id, entry.old_value, entry.new_value])).toEqual([
    ['user-lead', 'Regression coordinator', 'Regression second coordinator'],
    ['user-support', null, 'Regression coordinator']
  ]);
});

async function openVenueDecision(page: Page, requestId: number) {
  await page.getByRole('region', { name: 'Booking requests awaiting decision' })
    .getByRole('button', { name: new RegExp(`Venue booking request #${requestId}\\b`) }).click();
  return page.getByRole('article', { name: 'Venue booking request' });
}

async function switchAccount(page: Page, account: string) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, account);
}

test('SG2-49-P01 | [SG2-49:AC1] [SG2-49:AC3] [NORMAL] venue staff approve a clear request; the venue is committed and the coordinator is notified', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-decision')).status()).toBe(204);
  await signIn(page, 'venue');
  const detail = await openVenueDecision(page, 101);
  await expect(detail.getByText('This venue fits the event.', { exact: true })).toBeVisible();
  const approve = detail.getByRole('button', { name: 'Approve booking', exact: true });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(detail.getByText('Approved. The venue is committed to this event and the coordinator has been notified.', { exact: true })).toBeVisible();
  await expect(detail.locator('.work-queue-status')).toHaveText('approved');

  // AC1: the venue is now committed for that period, shown as a confirmed booking.
  const period = `from=${encodeURIComponent('2030-06-20T00:00:00.000Z')}&to=${encodeURIComponent('2030-06-20T06:00:00.000Z')}`;
  const availability = await page.request.get(`/api/venues/1/availability?${period}`, { headers: await authHeaders(page) });
  expect((await availability.json()).entries).toEqual([expect.objectContaining({ kind: 'booking', label: 'confirmed · event 91',
    start: '2030-06-20T01:00:00.000Z', end: '2030-06-20T04:00:00.000Z' })]);
  // The decided request leaves the queue.
  await page.getByRole('button', { name: 'Back to work queue', exact: true }).click();
  await expect(page.getByRole('button', { name: /Venue booking request #101\b/ })).toHaveCount(0);

  // AC1 and AC3: the coordinator is notified and sees who approved it and when.
  await switchAccount(page, 'coordinator');
  await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
  const drawer = page.getByRole('complementary', { name: 'Notifications' });
  await expect(drawer.getByText('Venue request approved', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Regression Hall was approved for Venue Request Forum.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
  await openVenueRequestSearch(page);
  const list = page.getByRole('region', { name: 'Venue requests for Venue Request Forum' });
  await expect(list.getByText(/^Approved by Regression venue on /)).toBeVisible();
});

test('SG2-49-P02 | [SG2-49:AC2] [SG2-49:AC3] [NORMAL] venue staff reject a request with a reason the coordinator can see', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-decision')).status()).toBe(204);
  await signIn(page, 'venue');
  const detail = await openVenueDecision(page, 102);
  await detail.getByLabel('Decision note (required to reject; shared with the coordinator)').fill('The floor is being resurfaced that week.');
  await detail.getByRole('button', { name: 'Reject with reason', exact: true }).click();
  await expect(detail.getByText('Rejected. The coordinator has been notified and can see your reason.', { exact: true })).toBeVisible();
  await expect(detail.locator('.work-queue-status')).toHaveText('rejected');

  await switchAccount(page, 'coordinator');
  await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
  const drawer = page.getByRole('complementary', { name: 'Notifications' });
  await expect(drawer.getByText('Venue request rejected', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Regression Hall was rejected for Venue Request Forum: The floor is being resurfaced that week.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
  await openVenueRequestSearch(page);
  const list = page.getByRole('region', { name: 'Venue requests for Venue Request Forum' });
  await expect(list.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(list.getByText(/^Rejected by Regression venue on .*\. Reason: The floor is being resurfaced that week\.$/)).toBeVisible();
  // A rejection books nothing.
  const period = `from=${encodeURIComponent('2030-06-21T00:00:00.000Z')}&to=${encodeURIComponent('2030-06-21T06:00:00.000Z')}`;
  const availability = await page.request.get(`/api/venues/1/availability?${period}`, { headers: await authHeaders(page) });
  expect((await availability.json()).entries).toEqual([]);
});

test('SG2-49-N01 | [SG2-49:AC1] [SG2-49:AC2] [CONFLICT] [FAILURE] a clash, an uncovered capacity shortfall, a missing reason or another role cannot decide', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-decision')).status()).toBe(204);
  await signIn(page, 'venue');

  // AC1: Quiet Room is too small for 80 guests and no capacity exception is approved.
  let detail = await openVenueDecision(page, 103);
  await expect(detail.getByText('Approve a capacity exception above before approving the booking.', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Approve booking', exact: true })).toBeDisabled();
  // AC2: a rejection needs a reason.
  await detail.getByRole('button', { name: 'Reject with reason', exact: true }).click();
  await expect(detail.getByRole('alert')).toHaveText('Give a reason for rejecting this request. The coordinator will see it.');
  await page.getByRole('button', { name: 'Back to work queue', exact: true }).click();

  // AC1: Regression Hall is already booked for the Planning workshop then.
  detail = await openVenueDecision(page, 104);
  await detail.getByRole('button', { name: 'Approve booking', exact: true }).click();
  await expect(detail.getByRole('alert')).toHaveText('Regression Hall is already booked for Planning workshop during this period.');
  await expect(detail.locator('.work-queue-status')).toHaveText('pending');

  // A request decided once cannot be decided again.
  const headers = await authHeaders(page);
  expect((await page.request.post('/api/venue-booking-requests/101/decision', { headers, data: { decision: 'approve' } })).status()).toBe(200);
  const again = await page.request.post('/api/venue-booking-requests/101/decision', { headers, data: { decision: 'reject', reason: 'Changed mind' } });
  expect([again.status(), (await again.json()).error]).toEqual([409, 'This request has already been approved.']);

  // Only Venue Staff decide.
  for (const account of ['coordinator', 'organiser', 'support']) {
    await test.step(account, async () => {
      await switchAccount(page, account);
      const refused = await page.request.post('/api/venue-booking-requests/102/decision', { headers: await authHeaders(page), data: { decision: 'reject', reason: 'Not mine' } });
      expect(refused.status()).toBe(403);
    });
  }
  expect((await page.request.post('/api/venue-booking-requests/102/decision', { data: { decision: 'approve' } })).status()).toBe(401);
});

test('SG2-100-P01 | [SG2-100:AC2] [SG2-100:AC3] [SG2-100:AC5] [SG2-100:AC9] [SG2-100:AC13] [NORMAL] [BOUNDARY] a request moves through the Week 7 lifecycle with the stage tracker and waiting-on text at each hop', async ({ page, request }) => {
  await signIn(page, 'organiser');
  // AC2: submission with no coordinator lands in unassigned, not submitted.
  expect((await request.patch('/api/event-requests/1/submit', { headers: await authHeaders(page) })).status()).toBe(200);
  await nav(page, 'My events');
  await page.getByRole('button', { name: 'View Planning workshop', exact: true }).click();
  await expect(page.getByTestId('stage-badge')).toContainText('Awaiting Assignment');
  await expect(page.getByTestId('waiting-on-persona')).toContainText('Event Coordinator Lead');
  await expect(page.getByTestId('waiting-on-action')).toContainText('Assign an event coordinator');

  // AC9: EventDetail and the 7-step stepper render without layout breakage
  // or horizontal overflow at both a phone and a laptop viewport. The
  // stepper track scrolls internally (EventStageTracker.tsx) rather than
  // widening the page, so the document itself must never overflow even
  // though all 7 steps stay present and legible.
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(page.getByTestId('stage-badge')).toBeVisible();
    const steps = page.getByTestId('stepper-track').getByRole('listitem');
    await expect(steps).toHaveCount(7);
    for (const label of ['Draft', 'Awaiting Assignment', 'Under Review', 'Arrangements', 'Safety Check', 'Preparation', 'Confirmed']) {
      await expect(page.getByTestId('stepper-track').getByText(label, { exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await signOut(page);

  // AC3: assigning a coordinator on an unassigned event moves it to submitted.
  await signIn(page, 'lead');
  await nav(page, 'Assign coordinators');
  await page.getByLabel('Coordinator for Planning workshop', { exact: true }).selectOption({ label: 'Regression coordinator' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Assigned to Regression coordinator.', { exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, 'organiser');
  await nav(page, 'My events');
  await page.getByRole('button', { name: 'View Planning workshop', exact: true }).click();
  await expect(page.getByTestId('stage-badge')).toContainText('Under Review');
  await expect(page.getByTestId('waiting-on-persona')).toContainText('Regression coordinator');
  await signOut(page);

  // The coordinator opening it moves it on to under_review (SG2-35), then approves it.
  await signIn(page, 'coordinator');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('region', { name: 'Awaiting review' })
    .getByRole('button', { name: /Planning workshop/ }).click();
  await expect(page.getByRole('heading', { name: 'Planning workshop' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('approved')).toBeVisible();
  await signOut(page);

  // AC5: the stepper and waiting-on card reflect the approved stage.
  await signIn(page, 'organiser');
  await nav(page, 'My events');
  await page.getByRole('button', { name: 'View Planning workshop', exact: true }).click();
  await expect(page.getByTestId('stage-badge')).toContainText('Arrangements');
  await expect(page.getByTestId('waiting-on-action')).toContainText('Complete venue suitability check and equipment reservation');

  const detail = await request.get('/api/event-requests/1', { headers: await authHeaders(page) });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).request.status).toBe('approved');
});

// SG2-100 AC4: the coordinator closes out a held event from their own work
// queue — the screen they already use for every event assigned to them.
test('SG2-100-P02 | [SG2-100:AC6] [SG2-100:AC7] [SG2-100:AC8] [SG2-100:AC9] [NORMAL] [BOUNDARY] marking a held event completed makes it read-only, clears it from the work queue and is recorded in history', async ({ page, request }) => {
  expect((await request.post('/__e2e/lifecycle')).status()).toBe(204);
  await signIn(page, 'coordinator');
  const assigned = page.getByRole('region', { name: 'My assigned events' });

  // BOUNDARY: an event whose confirmed booking has not ended yet does not
  // offer the action at all.
  await assigned.getByRole('button', { name: /Future Forum/ }).click();
  await expect(page.getByRole('heading', { name: 'Future Forum' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as Completed' })).toHaveCount(0);
  // The server refuses it too, should anything call it directly.
  const tooSoon = await page.request.patch('/api/event-requests/121/complete', { headers: await authHeaders(page) });
  expect(tooSoon.status()).toBe(409);
  expect((await tooSoon.json()).error).toBe('This event has not finished yet.');
  await page.getByRole('button', { name: 'Back to work queue' }).click();

  // AC9: the panel with the action fits a phone and a laptop without
  // pushing the page sideways.
  await assigned.getByRole('button', { name: /Held Forum/ }).click();
  await expect(page.getByRole('heading', { name: 'Held Forum' })).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(page.getByRole('button', { name: 'Mark as Completed' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // NORMAL: the held event completes from the screen, recording who and when.
  const completion = page.waitForResponse(response => response.url().endsWith('/api/event-requests/120/complete'));
  await page.getByRole('button', { name: 'Mark as Completed' }).click();
  expect((await completion).status()).toBe(200);
  await expect(page.getByText('Marked as completed. This event has left your active work queue.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as Completed' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Planning Information' })).toHaveCount(0);

  // AC7: a completed event is absent from the work queue once it refreshes.
  await page.getByRole('button', { name: 'Back to work queue' }).click();
  await expect(assigned.getByRole('button', { name: /Future Forum/ })).toBeVisible();
  await expect(assigned.getByRole('button', { name: /Held Forum/ })).toHaveCount(0);

  const coordinator = await authHeaders(page);
  const history = await page.request.get('/api/event-requests/120/history', { headers: coordinator });
  expect(history.status()).toBe(200);
  // AC8: exactly one audit row records the transition.
  const statusEntries = (await history.json()).history
    .filter((entry: Record<string, unknown>) => entry.field_name === 'status');
  expect(statusEntries).toEqual([
    expect.objectContaining({ old_value: 'confirmed', new_value: 'completed', actor_id: 'user-coordinator' })
  ]);

  // AC7: a completed event refuses further planning updates.
  expect((await page.request.patch('/api/event-requests/120/planning', { headers: coordinator, data: { planning_notes: 'Too late' } })).status()).toBe(409);

  // A second attempt on an already-completed event reports not found, not a repeat success.
  expect((await page.request.patch('/api/event-requests/120/complete', { headers: coordinator })).status()).toBe(404);

  // AC6/AC7: the organiser can still read the completed event, with who
  // completed it and when.
  const login = await request.post('/api/auth/login', { data: { email: 'organiser@example.test', password } });
  expect(login.status()).toBe(200);
  const detail = await request.get('/api/event-requests/120', { headers: { Authorization: `Bearer ${(await login.json()).accessToken}` } });
  expect(detail.status()).toBe(200);
  const record = (await detail.json()).request;
  expect(record).toMatchObject({ status: 'completed', completed_by: 'user-coordinator' });
  expect(record.completed_at).not.toBeNull();
});
