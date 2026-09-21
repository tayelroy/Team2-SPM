import { test, expect, type Page } from '@playwright/test';

const password = 'Regression123!';
const venueValues = { name: 'Browser Hall', location: 'North Wing', capacity: 100,
  facilities: 'Projector', accessibility_features: 'Lift', operating_information: '09:00–18:00' };

async function signIn(page: Page, account = 'organiser') {
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
    Description: 'Review the release plan', Date: '2030-06-15T09:00:00Z',
    'Expected attendance': '25', 'Venue requirements': 'Projector' })) {
    await page.getByLabel(new RegExp(`^${label}`)).fill(value);
  }
}

async function eventRecords(page: Page) {
  const response = await page.request.get('/api/event-requests', { headers: await authHeaders(page) });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).requests as { event_id: number; name: string; status: string }[];
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).ok()).toBeTruthy();
});

test('PW-AUTH-01 | each seeded role reaches its assigned application', async ({ page }) => {
  const roles = { organiser: 'Event Organiser', coordinator: 'Event Coordinator', venue: 'Venue Staff',
    support: 'Technical Support Staff', attendee: 'Attendee' };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [account, role] of Object.entries(roles)) {
    await test.step(role, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      await expect(page.getByRole('banner')).toContainText(role);
      await expect(page.getByRole('navigation').getByRole('button').first()).toBeVisible();
      await expect(page).toHaveTitle(/ConnectSphere/i);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    });
  }
  expect(errors).toEqual([]);
});

test('PW-AUTH-02 | invalid login stays signed out with a generic message', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('organiser@example.test');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('connectsphere.session'))).toBeNull();
});

test('PW-AUTH-03 | logout removes browser access and revokes the fixture session', async ({ page }) => {
  await signIn(page);
  const headers = await authHeaders(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect((await page.request.get('/api/profile', { headers })).status()).toBe(401);
});

test('SG2-26-P01 | colleagues read the same organisation events with creator-only actions', async ({ page }) => {
  await signIn(page);
  const ownEvents = await eventRecords(page);
  expect(ownEvents.map(event => event.event_id)).toEqual([1]);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  await signIn(page, 'colleague');
  expect(await eventRecords(page)).toEqual(ownEvents.map(event => ({ ...event, can_manage: false })));
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
  const mine = await page.request.get('/api/event-requests?scope=mine', { headers });
  expect((await mine.json()).requests).toEqual([]);
  await nav(page, 'My drafts');
  await expect(page.getByRole('heading', { name: 'No event requests yet', exact: true })).toBeVisible();
  await page.reload();
  await nav(page, 'My events');
  await expect(page.getByRole('button', { name: 'View Planning workshop', exact: true })).toBeVisible();
});

test('SG2-26-P02 | saved event changes reach a colleague dashboard list and detail after reload', async ({ page, context }) => {
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

test('SG2-26-N01 | another organisation and an account without membership cannot read events', async ({ page }) => {
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

test('SG2-26-N02 | only Event Organisers can access organisation event records', async ({ page }) => {
  for (const account of ['coordinator', 'venue', 'support', 'attendee']) {
    await test.step(account, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      await expect(page.getByRole('navigation').getByRole('button', { name: 'My events', exact: true })).toHaveCount(0);
      const headers = await authHeaders(page);
      for (const endpoint of ['/api/event-requests', '/api/event-requests?scope=mine', '/api/event-requests/1']) {
        const response = await page.request.get(endpoint, { headers });
        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({ error: 'Access denied' });
      }
    });
  }
});

test('SG2-42-P01 | staff create edit search and reload persisted venue details', async ({ page }) => {
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

test('SG2-42-N01 | read-only users cannot create venues through UI or API', async ({ page }) => {
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

test('SG2-42-B01 | venue capacity accepts exact bounds and rejects adjacent values', async ({ page }) => {
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
});

test('SG2-42-B02 | venue names accept 255 characters and refuse 256 without writes', async ({ page }) => {
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

test('SG2-28-P01 | submit a fresh request and verify its saved data and status', async ({ page }) => {
  await signIn(page);
  await nav(page, 'New request');
  await fillEvent(page);
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect.poll(async () => (await eventRecords(page)).find(row => row.name === 'Browser workshop')?.status).toBe('submitted');
  await page.reload();
  await nav(page, 'My drafts');
  await expect(page.getByRole('heading', { name: 'Browser workshop', exact: true })).toBeVisible();
  const record = (await eventRecords(page)).find(row => row.name === 'Browser workshop')!;
  const detail = await page.request.get(`/api/event-requests/${record.event_id}`, { headers: await authHeaders(page) });
  expect((await detail.json()).request).toMatchObject({ name: 'Browser workshop', purpose: 'Team planning',
    description: 'Review the release plan', expected_attendance: 25, status: 'submitted' });
});

test('SG2-28-B01 | an empty draft saves once but cannot be submitted', async ({ page }) => {
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

test('SG2-29-P01 | editing then submitting preserves the latest field values', async ({ page }) => {
  await signIn(page);
  await nav(page, 'My drafts');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel(/^Event name/)).toHaveValue('Planning workshop');
  await page.getByLabel(/^Event name/).fill('Revised workshop');
  await page.getByLabel('Accessibility needs (optional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revised workshop', exact: true })).toBeVisible();
  await page.reload();
  const detail = await page.request.get('/api/event-requests/1', { headers: await authHeaders(page) });
  expect((await detail.json()).request).toMatchObject({ name: 'Revised workshop', status: 'submitted', accessibility_needs: null });
});

test('SG2-32-P01 | draft deletion requires confirmation and survives reload', async ({ page }) => {
  await signIn(page);
  await nav(page, 'My drafts');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await eventRecords(page)).some(r => r.event_id === 1)).toBeTruthy();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planning workshop', exact: true })).toHaveCount(0);
  await page.reload();
  await nav(page, 'My drafts');
  await expect(page.getByRole('heading', { name: 'No event requests yet', exact: true })).toBeVisible();
});

test('SG2-27-P01 | profile changes persist and external users have no department field', async ({ page }) => {
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

test('SG2-27-B01 | profile phone enforces the 7-to-15 digit boundary', async ({ page }) => {
  await signIn(page);
  await profile(page);
  for (const digits of [6, 7, 15, 16]) {
    await test.step(`${digits} digits`, async () => {
      const response = page.waitForResponse(r => r.url().endsWith('/api/profile') && r.request().method() === 'PUT');
      await page.getByLabel('Phone', { exact: true }).fill('1'.repeat(digits));
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      expect((await response).status()).toBe(digits === 6 || digits === 16 ? 400 : 200);
      await expect(page.getByRole(digits === 6 || digits === 16 ? 'alert' : 'status')).toBeVisible();
    });
  }
});

test('SG2-44-P01 | calendar renders real availability and changes its requested month', async ({ page }) => {
  await signIn(page, 'venue');
  await nav(page, 'Venue Availability');
  await page.getByLabel('Jump to year').selectOption('2030');
  await page.getByLabel('Jump to month').selectOption('5');
  await expect(page.getByRole('heading', { name: 'June 2030', exact: true })).toBeVisible();
  await expect(page.getByText('Regression Hall · confirmed · event 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Regression Hall · Scheduled maintenance', { exact: true })).toBeVisible();
  const next = page.waitForResponse(r => r.url().includes('/api/venues/availability') && r.url().includes('2030-07'));
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  expect((await next).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'July 2030', exact: true })).toBeVisible();
  await expect(page.getByText('Regression Hall · Scheduled maintenance', { exact: true })).toHaveCount(0);
});
