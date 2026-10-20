import { test, expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';

// Fast deployment gate on the production build + real Express routes, with
// isolated external providers. Native PostgreSQL integration runs separately.
// Keep passing smoke journeys reviewable in CI; the full regression retains failure-only recording.
test.use({ timezoneId: 'Asia/Singapore', trace: 'on', video: 'on' });
const password = 'Regression123!';
async function token(request: APIRequestContext, account: string) {
  const response = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password } });
  expect(response.status()).toBe(200);
  return { Authorization: `Bearer ${(await response.json()).accessToken}` };
}
async function signIn(page: Page, account: string) {
  await page.clock.setFixedTime('2026-10-15T08:00:00Z');
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function openPlanning(page: Page) {
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: /Confirmation Forum/ }).click();
  await page.getByRole('button', { name: 'Edit Planning Information', exact: true }).click();
  return page.getByRole('dialog', { name: 'Event Planning Details' });
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function attachScreenshot(page: Page, info: TestInfo, name: string, fullPage = true) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage });
  await info.attach(name, { path, contentType: 'image/png' });
}

test.beforeEach(async ({ request, baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
});

test('SMOKE-INBOX-01 | [NORMAL] [SG2-69:AC1] [SG2-69:AC3] [SG2-69:AC4] a phone user opens an unread event, reaches assigned work and clears the remaining notices durably', async ({ page, request }, testInfo) => {
  expect((await request.post('/__e2e/notification-inbox')).status()).toBe(204);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'coordinator');
  await page.getByRole('button', { name: 'Notifications (2)', exact: true }).click();
  const drawer = page.getByRole('complementary', { name: 'Notifications', exact: true });
  await expect(drawer.getByRole('button', { name: /^Unread:/ })).toHaveCount(2);
  await drawer.getByRole('button', { name: 'Unread: Reminder Forum still needs: Venue booking, Equipment.', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reminder Forum', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View event details', exact: true }).click();
  const event = page.getByRole('article', { name: 'Event request', exact: true });
  await expect(event.getByRole('heading', { name: 'Reminder Forum', exact: true })).toBeVisible();
  await expect(event.getByRole('button', { name: 'Edit Planning Information', exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await attachScreenshot(page, testInfo, 'notification-assigned-work-mobile', false);
  await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
  await drawer.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Notifications (0)', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^Read:/ })).toHaveCount(3);
  await expect(drawer.getByRole('button', { name: 'Mark all as read', exact: true })).toBeDisabled();
  const stored = await (await request.get('/__e2e/notification-inbox-ledger')).json();
  expect(stored.notifications.find((row: { notification_id: number }) => row.notification_id === 90).read_at).toBeNull();
  expect(stored.holds[0].read_at).toEqual(expect.any(String));
  await page.reload();
  await page.getByRole('button', { name: 'Notifications (0)', exact: true }).click();
  await expect(drawer.getByRole('button', { name: /^Read:/ })).toHaveCount(3);
  await expect(drawer.getByText('Private other organisation notice.', { exact: true })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
  await attachScreenshot(page, testInfo, 'notification-cleared-mobile', false);
});

test('SMOKE-ROLES-01 | [NORMAL] [FAILURE] [SG2-23:AC1] [SG2-41:AC4] each role opens its desk and logout revokes access', async ({ page, request }, testInfo) => {
  expect((await request.post('/__e2e/work-queue')).status()).toBe(204);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Success screenshots are review evidence, not pixel comparison assertions.
  // Bounds checks independently verify that the entry text and action fit.
  await test.step('Landing stays usable at phone and desktop widths', async () => {
    await page.goto('/');
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const heading = page.getByRole('heading', { name: 'Exceptional Events Begin with the Perfect Space' });
      await expect(heading).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeInViewport();
      const bounds = (await heading.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await noOverflow(page)).toBe(true);
      await attachScreenshot(page, testInfo, `landing-${width}`);
    }
  });
  for (const [account, label] of [
    ['organiser', 'Event Organiser'], ['coordinator', 'Event Coordinator'], ['lead', 'Event Coordinator Lead'],
    ['venue', 'Venue Staff'], ['support', 'Technical Support Staff'], ['safety', 'Safety Officer'], ['attendee', 'Attendee'],
  ]) {
    await test.step(`${label}: open the correct desk and revoke the session on logout`, async () => {
      await signIn(page, account);
      await expect(page.getByRole('banner')).toContainText(label);
      if (account === 'venue' || account === 'support') {
        await expect(page.getByText('1 item in your work queue')).toBeVisible();
        const group = account === 'venue' ? 'Booking requests awaiting decision' : 'Equipment requests and reservations';
        await expect(page.getByRole('region', { name: group }).getByRole('button')).toHaveCount(1);
      }
      await attachScreenshot(page, testInfo, `role-${account}-desk`);
      if (account === 'venue') {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('navigation').getByRole('button', { name: 'Venue Availability', exact: true }).click();
        await page.getByLabel('Jump to year').selectOption('2030');
        await page.getByLabel('Jump to month').selectOption('5');
        await expect(page.getByRole('heading', { name: 'June 2030', exact: true })).toBeVisible();
        const occupiedDay = page.getByRole('button', { name: '2030-06-15: booked', exact: true });
        await occupiedDay.click();
        await expect(occupiedDay).toHaveAttribute('aria-pressed', 'true');
        const details = page.getByRole('region', { name: 'Selected day availability' });
        await expect(details.getByRole('listitem')).toHaveCount(1);
        await expect(details).toContainText('Regression Hall · confirmed · event 1');
        await expect(details).toContainText('15 Jun 2030, 10:00');
        await expect(details).toContainText('15 Jun 2030, 12:00');
        await details.scrollIntoViewIfNeeded();
        await expect(details).toBeInViewport();
        const bounds = (await details.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
        expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await noOverflow(page)).toBe(true);
        await attachScreenshot(page, testInfo, 'calendar-occupied-day-390', false);
        await page.setViewportSize({ width: 1440, height: 900 });
      }
      const headers = await page.evaluate(() => ({ Authorization: `Bearer ${JSON.parse(sessionStorage.getItem('connectsphere.session')!).accessToken}` }));
      await page.getByRole('button', { name: 'Profile', exact: true }).click();
      await page.getByRole('button', { name: 'Logout', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
      expect((await request.get('/api/auth/me', { headers })).status()).toBe(401);
    });
  }
  expect(errors).toEqual([]);
});

test('SMOKE-ASSIGN-01 | [NORMAL] [BOUNDARY] [SG2-28:AC1] [SG2-30:AC2] [SG2-87:AC5] empty drafts stay drafts and a complete submission reaches Lead assignment', async ({ page, request }, testInfo) => {
  const organiser = await test.step('An incomplete draft saves but cannot submit', async () => {
    const organiser = await token(request, 'organiser');
    const empty = await request.post('/api/event-requests', { headers: organiser, data: {} });
    expect(empty.status()).toBe(201);
    const emptyId = (await empty.json()).request.event_id;
    expect((await request.patch(`/api/event-requests/${emptyId}/submit`, { headers: organiser })).status()).toBe(400);
    return organiser;
  });
  const id = await test.step('The organiser submits a complete request to the assignment queue', async () => {
    await signIn(page, 'organiser');
    await page.getByRole('navigation').getByRole('button', { name: 'New request', exact: true }).click();
    for (const [label, value] of Object.entries({ 'Event name': 'Smoke workshop', Purpose: 'Release check',
      Description: 'Synthetic smoke event', Date: '2030-06-15T10:00', 'Expected attendance': '1', 'Venue requirements': 'One seat',
      'Preferred room layout': 'Boardroom' })) {
      await page.getByLabel(new RegExp(`^${label}`)).fill(value);
    }
    // SG2-105: "None" answers accessibility and equipment, and registration is a yes or no.
    for (const answer of ['No accessibility needs', 'No equipment needed', 'No registration needed']) {
      await page.getByRole('button', { name: answer, exact: true }).click();
    }
    await page.getByRole('button', { name: 'Submit request', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Smoke workshop', exact: true })).toBeVisible();
    await expect(page.getByTestId('stage-badge')).toContainText('Awaiting Assignment');
    const list = await (await request.get('/api/event-requests', { headers: organiser })).json();
    await attachScreenshot(page, testInfo, 'organiser-submitted-awaiting-assignment');
    const id = list.requests.find((row: { name: string }) => row.name === 'Smoke workshop').event_id;
    return id;
  });
  await test.step('Lead assigns the request and it leaves the unassigned queue', async () => {
    await signIn(page, 'lead');
    await page.getByRole('navigation').getByRole('button', { name: 'Unassigned queue', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Smoke workshop' })).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: 'Assign coordinators', exact: true }).click();
    await page.getByLabel('Coordinator for Smoke workshop', { exact: true }).selectOption('user-coordinator');
    await page.getByLabel('Coordinator for Smoke workshop', { exact: true }).locator('..').getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByText('Coordinator: Regression coordinator', { exact: true })).toBeVisible();
    const lead = await token(request, 'lead');
    expect((await (await request.get('/api/assignment-queue', { headers: lead })).json()).entries.some((row: { event_id: number }) => row.event_id === id)).toBe(false);
    expect((await (await request.get(`/api/event-requests/${id}`, { headers: organiser })).json()).request).toMatchObject({ status: 'submitted', coordinator_name: 'Regression coordinator' });
    await attachScreenshot(page, testInfo, 'lead-assignment-complete');
  });
});

test('SMOKE-PLANNING-01 | [NORMAL] [BOUNDARY] [SG2-39:AC1] [SG2-41:AC4] queue reload and unrelated edit retain stored registration settings on mobile and desktop', async ({ page, request }, testInfo) => {
  await test.step('Seed saved registration values through the application API', async () => {
    expect((await request.post('/__e2e/event-confirmation')).status()).toBe(204);
    const coordinator = await token(request, 'coordinator');
    expect((await request.patch('/api/event-requests/581/planning', { headers: coordinator, data: {
      registration_capacity: 136, registration_opens_at: '2026-10-01T13:30:00.000Z',
      registration_closes_at: '2026-10-01T13:31:00.000Z', planning_notes: 'Keep the loading bay clear', confirm_impact: true,
    } })).status()).toBe(200);
  });
  let drawer = await test.step('The coordinator opens the saved planning information', async () => {
    await signIn(page, 'coordinator');
    return openPlanning(page);
  });
  for (const width of [390, 1440]) {
    await test.step(`Stored planning values remain visible at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await expect(drawer.getByLabel('Registration Capacity')).toHaveValue('136');
      await expect(drawer.getByLabel('Opens At')).toHaveValue('2026-10-01T21:30');
      await expect(drawer.getByLabel('Closes At')).toHaveValue('2026-10-01T21:31');
      await expect(drawer.getByLabel(/Planning Notes/i)).toHaveValue('Keep the loading bay clear');
      expect(await noOverflow(page)).toBe(true);
      await drawer.getByLabel(/Planning Notes/i).scrollIntoViewIfNeeded();
      await attachScreenshot(page, testInfo, `planning-stored-values-${width}`, false);
    });
  }
  await test.step('An unrelated edit and page reload preserve the stored values', async () => {
    await drawer.getByLabel('Equipment Requirements').fill('12 microphones and 1 projector');
    await drawer.getByRole('button', { name: 'Save Planning Details' }).click();
    await expect(drawer).toHaveCount(0);
    await page.reload();
    drawer = await openPlanning(page);
    await expect(drawer.getByLabel('Registration Capacity')).toHaveValue('136');
    await expect(drawer.getByLabel(/Planning Notes/i)).toHaveValue('Keep the loading bay clear');
    const ledger = await (await request.get('/__e2e/event-confirmation-ledger')).json();
    expect(ledger.events.find((row: { event_id: number }) => row.event_id === 581)).toMatchObject({
      registration_capacity: 136, registration_opens_at: '2026-10-01T13:30:00.000Z',
      registration_closes_at: '2026-10-01T13:31:00.000Z', planning_notes: 'Keep the loading bay clear',
      equipment_requirements: '12 microphones and 1 projector',
    });
    await drawer.getByLabel(/Planning Notes/i).scrollIntoViewIfNeeded();
    await attachScreenshot(page, testInfo, 'planning-values-retained-after-save-and-reload', false);
  });
});

test('SMOKE-CONFLICT-01 | [CONFLICT] [FAILURE] [SG2-90:AC3] a coordinator loses write access after Lead reassignment while their drawer is open', async ({ page, request }, testInfo) => {
  const drawer = await test.step('Open a currently assigned coordinator planning drawer', async () => {
    expect((await request.post('/__e2e/event-confirmation')).status()).toBe(204);
    await signIn(page, 'coordinator');
    return openPlanning(page);
  });
  await test.step('Lead reassigns the event while the original drawer stays open', async () => {
    const lead = await token(request, 'lead');
    expect((await request.patch('/api/event-requests/581/coordinator', { headers: lead, data: { coordinatorId: 'user-coordinator2' } })).status()).toBe(200);
  });
  await test.step('The stale save is refused and the original data remains intact', async () => {
    await drawer.getByLabel(/Planning Notes/i).fill('Stale edit must not persist');
    await drawer.getByRole('button', { name: 'Save Planning Details' }).click();
    await expect(drawer.getByRole('alert')).toContainText('Only the assigned event coordinator can update planning details');
    const ledger = await (await request.get('/__e2e/event-confirmation-ledger')).json();
    const event = ledger.events.find((row: { event_id: number }) => row.event_id === 581);
    expect(event.coordinator_id).toBe('user-coordinator2');
    expect(event.planning_notes).not.toBe('Stale edit must not persist');
    await drawer.getByRole('alert').scrollIntoViewIfNeeded();
    await attachScreenshot(page, testInfo, 'stale-coordinator-save-refused', false);
  });
});

// SG2-106: venue delete and hold expiry change through the production build.
test('SMOKE-VENUE-DELETE-PAST-HOLD-01 | [NORMAL] [BOUNDARY] [CONFLICT] [SG2-106:AC1] [SG2-106:AC2] [SG2-106:AC5] a hold blocks deletion until its period ends, then the venue leaves the catalogue while hold history stays', async ({ page, request }, testInfo) => {
  expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
  const staff = await token(request, 'venue');
  const placed = await request.post('/api/venue-holds', { headers: staff, data: {
    event_id: 81, venue_id: 2, starts_at: '2030-06-01T01:00:00.000Z',
    ends_at: '2030-06-01T02:30:00.000Z', expires_at: '2030-06-03T02:00:00.000Z',
  } });
  expect(placed.status()).toBe(201);
  const original = (await placed.json()).hold;
  const blocked = await request.delete('/api/venues/2', { headers: staff });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).blockers.map((item: { kind: string; id: number }) => [item.kind, item.id])).toEqual([['hold', original.hold_id]]);

  // The reserved period has ended exactly, while its independent expiry is still two days away.
  expect((await request.post('/__e2e/hold-time', { data: { now: '2030-06-01T02:30:00.000Z' } })).status()).toBe(204);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'venue');
  await page.getByRole('navigation').getByRole('button', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Quiet Room', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Quiet Room deleted. It no longer appears in search, availability or new bookings.');
  await expect(page.getByRole('heading', { name: 'Quiet Room', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await attachScreenshot(page, testInfo, 'past-hold-venue-deleted-mobile', false);

  // Deletion preserves the full hold, including its name, status and future expiry.
  const history = await request.get('/api/venue-holds', { headers: staff });
  expect(history.status()).toBe(200);
  expect((await history.json()).holds.find((hold: { hold_id: number }) => hold.hold_id === original.hold_id)).toEqual(original);
  const choices = await request.get('/api/venue-holds/options', { headers: staff });
  expect(choices.status()).toBe(200);
  expect((await choices.json()).venues).toEqual([{ venue_id: 1, name: 'Regression Hall' }]);
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Catalogue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quiet Room', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toBeVisible();
});

test('SMOKE-VENUE-DELETE-01 | [NORMAL] [CONFLICT] [FAILURE] [SG2-106:AC1] [SG2-106:AC2] [SG2-106:AC5] staff see what blocks a delete, delete an unused venue, and it leaves every new-booking list', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'venue');
  await page.getByRole('navigation').getByRole('button', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Regression Hall', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  const blocked = page.getByRole('group', { name: 'Delete Regression Hall' });
  await expect(blocked.getByRole('alert')).toContainText('cannot be deleted while it has current or future work');
  await expect(blocked.getByRole('listitem').filter({ hasText: 'Booking #1 ·' })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await attachScreenshot(page, testInfo, 'venue-delete-blocked-mobile', false);
  await blocked.getByRole('button', { name: 'Close', exact: true }).click();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Delete Quiet Room', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Quiet Room deleted. It no longer appears in search, availability or new bookings.');
  await expect(page.getByRole('heading', { name: 'Quiet Room', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Regression Hall', exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await attachScreenshot(page, testInfo, 'venue-deleted-desktop', false);

  const staff = await token(request, 'venue');
  const coordinator = await token(request, 'coordinator');
  expect((await (await request.get('/api/venues', { headers: coordinator })).json()).venues.map((venue: { name: string }) => venue.name)).toEqual(['Regression Hall']);
  expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
  expect((await (await request.get('/api/venue-holds/options', { headers: staff })).json()).venues).toEqual([{ venue_id: 1, name: 'Regression Hall' }]);
  expect((await request.delete('/api/venues/2', { headers: staff })).status()).toBe(404);
  expect((await request.delete('/api/venues/1', { headers: coordinator })).status()).toBe(403);
  expect(errors).toEqual([]);
});

test('SMOKE-HOLD-EXPIRY-01 | [NORMAL] [BOUNDARY] [SG2-106:AC3] [SG2-106:AC4] staff move a hold expiry and the coordinator is told, with the warning following the new time', async ({ page, request }, testInfo) => {
  const now = '2030-06-01T02:00:00.000Z';
  expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
  const staff = await token(request, 'venue');
  const placed = await request.post('/api/venue-holds', { headers: staff, data: { event_id: 81, venue_id: 1,
    starts_at: '2030-06-05T02:00:00.000Z', ends_at: '2030-06-05T04:00:00.000Z', expires_at: '2030-06-03T02:00:00.000Z' } });
  expect(placed.status()).toBe(201);
  const holdId = (await placed.json()).hold.hold_id;
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'venue');
  await page.clock.setFixedTime(now);
  await page.getByRole('navigation').getByRole('button', { name: 'Venue holds', exact: true }).click();
  const card = page.getByRole('article', { name: `Hold #${holdId}` });
  await card.getByRole('button', { name: 'Change expiry', exact: true }).click();
  await card.getByLabel('New expiry (Singapore time)', { exact: true }).fill('2030-06-04T10:00');
  await card.getByRole('button', { name: 'Save expiry', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Expiry changed. The Event Coordinator has been notified of the new time.');
  await expect(card).toContainText('Expiry: 4 Jun 2030, 10:00 (SGT)');
  expect(await noOverflow(page)).toBe(true);
  await attachScreenshot(page, testInfo, 'hold-expiry-changed-mobile', false);

  // A time already passed is refused by the API as well as the form.
  expect((await request.post(`/api/venue-holds/${holdId}/expiry`, { headers: staff, data: { expires_at: '2030-05-31T00:00:00Z' } })).status()).toBe(400);
  const coordinator = await token(request, 'coordinator');
  expect((await request.post(`/api/venue-holds/${holdId}/expiry`, { headers: coordinator, data: { expires_at: '2030-06-06T00:00:00Z' } })).status()).toBe(403);
  // Past the old deadline the hold is still live, and the warning is for the new time.
  expect((await request.post('/__e2e/hold-time', { data: { now: '2030-06-03T03:00:00.000Z' } })).status()).toBe(204);
  const notices = (await (await request.get('/api/venue-holds/notifications', { headers: coordinator })).json()).notifications;
  expect(notices.map((notice: { kind: string }) => notice.kind)).toEqual(['warning', 'expiry_changed', 'placed']);
  expect(notices[1].message).toContain('2030-06-04T02:00:00.000Z');
  expect(notices[0].message).toContain('2030-06-04T02:00:00.000Z');
  expect((await (await request.get('/api/venue-holds', { headers: staff })).json()).holds[0].status).toBe('tentative');
});
