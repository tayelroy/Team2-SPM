import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

// Explicitly requested repository Playwright coverage. The Browser plugin is
// not available in this agent; this suite targets only the resettable loopback app.
test.use({ timezoneId: 'Asia/Singapore', trace: 'on', video: 'on' });

async function signIn(page: Page, account: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}

async function headers(page: Page) {
  return { Authorization: `Bearer ${await page.evaluate(() => JSON.parse(sessionStorage.getItem('connectsphere.session')!).accessToken)}` };
}

async function withAccount<T>(request: APIRequestContext, account: string, read: (auth: Record<string, string>) => Promise<T>) {
  const login = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password: 'Regression123!' } });
  expect(login.status()).toBe(200);
  const auth = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  try { return await read(auth); }
  finally { expect((await request.post('/api/auth/logout', { headers: auth })).status()).toBe(200); }
}

async function requestsFor(page: Page, eventId: number) {
  return withAccount(page.request, 'venue', async auth => {
    const requests = await page.request.get(`/api/venue-booking-requests?event_id=${eventId}`, { headers: auth });
    const bookings = await page.request.get(`/api/venue-bookings?event_id=${eventId}`, { headers: auth });
    expect(requests.status()).toBe(200); expect(bookings.status()).toBe(200);
    return { requests: (await requests.json()).requests, bookings: (await bookings.json()).bookings };
  });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

function watchConsole(page: Page) {
  const issues: string[] = [];
  page.on('pageerror', error => issues.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) issues.push(message.text()); });
  return issues;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/capacity-exceptions')).status()).toBe(204);
});

test('SG2-47-P03 | [NORMAL] [BOUNDARY] [CONFLICT] [SG2-47:AC3] [SG2-47:AC5] [SG2-66:AC2] [SG2-66:AC5] Venue Staff discover pending and booked requests needing an exception and approve one without committing the venue', async ({ page }, info) => {
  const issues = watchConsole(page);
  await test.step('Venue Staff open the real worklist: uncovered pending requests and the booked venue whose attendance rose are listed', async () => {
    await signIn(page, 'venue');
    await page.getByRole('navigation').getByRole('button', { name: 'Capacity exceptions', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Capacity exceptions', exact: true })).toBeVisible();
    const response = await page.request.get('/api/venue-booking-requests/capacity-exceptions', { headers: await headers(page) });
    expect(response.status()).toBe(200);
    const row = { event_id: 61, event_name: 'Suitability Forum', venue_name: 'Lecture Theatre',
      starts_at: '2030-06-17T02:00:00Z', ends_at: '2030-06-17T10:00:00Z', expected_attendance: 150, venue_capacity: 120, booked: false };
    expect((await response.json()).requests).toEqual([
      { ...row, request_id: 21 },
      // Only Technical Support approved this one, before SG2-66: it no longer counts.
      { ...row, request_id: 23, event_id: 62, event_name: 'Colleague Capacity Forum', starts_at: '2030-06-18T02:00:00Z', ends_at: '2030-06-18T10:00:00Z' },
      { ...row, request_id: 28, event_id: 67, event_name: 'Booked Capacity Forum', starts_at: '2030-06-19T02:00:00Z', ends_at: '2030-06-19T10:00:00Z', booked: true },
    ]);
    await expect(page.getByRole('button', { name: /^Review exception for/ })).toHaveCount(3);
    await expect(page.getByText('Booked — attendance raised', { exact: true })).toHaveCount(1);
    for (const excluded of ['Covered Capacity Forum', 'Withdrawn Capacity Forum', 'Adequate Capacity Forum', 'Unknown Attendance Forum']) {
      await expect(page.getByRole('heading', { name: excluded, exact: true })).toHaveCount(0);
    }
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      await expect(page.getByRole('button', { name: 'Review exception for Suitability Forum at Lecture Theatre', exact: true })).toBeVisible();
      await screenshot(page, info, `venue-staff-eligible-worklist-${width}`);
    }
  });

  await test.step('Approval records the Venue Staff receipt while the booking stays pending and uncommitted', async () => {
    await page.getByRole('button', { name: 'Review exception for Suitability Forum at Lecture Theatre', exact: true }).click();
    const suitability = page.getByRole('region', { name: 'Venue suitability', exact: true });
    await suitability.getByRole('button', { name: 'Approve capacity exception', exact: true }).click();
    await expect(suitability.getByText(/Capacity exception for 150 people approved by Regression venue \(Venue Staff\) on/)).toBeVisible();
    await expect(suitability.getByText(/Invalid Date/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve booking', exact: true })).toHaveCount(0);
    const response = await page.request.get('/api/venue-booking-requests/21/suitability', { headers: await headers(page) });
    expect(response.status()).toBe(200);
    const fit = await response.json();
    expect(fit.booking).toBe('allowed');
    expect(fit.exceptions).toHaveLength(1);
    expect(fit.exceptions[0]).toMatchObject({ request_id: 21, expected_attendance: 150, venue_capacity: 120,
      approved_by: 'user-venue', approver_name: 'Regression venue', approver_role: 'venue_staff' });
    expect(Number.isFinite(Date.parse(fit.exceptions[0].approved_at))).toBe(true);
    const stored = await requestsFor(page, 61);
    expect(stored.requests.map((request: { request_id: number; status: string }) => [request.request_id, request.status])).toEqual([[21, 'pending'], [22, 'pending']]);
    expect(stored.bookings).toEqual([]);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      await expect(suitability.getByText(/approved by Regression venue/)).toBeVisible();
      await screenshot(page, info, `venue-staff-approval-receipt-${width}`);
    }
  });

  await test.step('Explicit refresh removes the covered request and its retained receipt from the worklist', async () => {
    await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Review exception for/ })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Review exception for Suitability Forum at Lecture Theatre', exact: true })).toHaveCount(0);
    await expect(page.getByText(/approved by Regression venue/)).toHaveCount(0);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await expect(page).toHaveTitle(/ConnectSphere/);
    expect(issues).toEqual([]);
  });
});

test('SG2-47-P04 | [NORMAL] [SG2-47:AC5] [SG2-49:AC1] [SG2-49:AC3] [SG2-66:AC2] [SG2-66:AC5] a legacy Technical Support approval does not let Venue Staff commit the booking until they record their own; a booked venue gets an exception for its revised attendance', async ({ page }, info) => {
  const issues = watchConsole(page);
  await test.step('The legacy approval is shown as no longer counting and the booking cannot be approved on it', async () => {
    await signIn(page, 'venue');
    const queue = page.getByRole('region', { name: 'Booking requests awaiting decision', exact: true });
    await queue.getByRole('button').filter({ hasText: 'Colleague Capacity Forum' }).click();
    await expect(page.getByText(/approved by Regression support \(Technical Support Staff\) on .* It no longer counts: only Venue Staff approve capacity exceptions\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve booking', exact: true })).toBeDisabled();
    const auth = await headers(page);
    const refused = await page.request.post('/api/venue-booking-requests/23/decision', { headers: auth, data: { decision: 'approve' } });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toEqual({ error: 'Approve a capacity exception for this request before approving the booking.' });
    await page.setViewportSize({ width: 390, height: 900 });
    await noOverflow(page);
    await screenshot(page, info, 'venue-staff-legacy-approval-390');
  });

  await test.step('Venue Staff record the exception that counts, then commit the booking as a separate decision', async () => {
    const suitability = page.getByRole('region', { name: 'Venue suitability', exact: true });
    await suitability.getByRole('button', { name: 'Approve capacity exception', exact: true }).click();
    await expect(suitability.getByText(/Capacity exception for 150 people approved by Regression venue \(Venue Staff\) on/)).toBeVisible();
    const approve = page.getByRole('button', { name: 'Approve booking', exact: true });
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.getByRole('status').filter({ hasText: 'Approved. The venue is committed to this event and the coordinator has been notified.' })).toBeVisible();
    const auth = await headers(page);
    const requests = await page.request.get('/api/venue-booking-requests?event_id=62', { headers: auth });
    const bookings = await page.request.get('/api/venue-bookings?event_id=62', { headers: auth });
    expect(requests.status()).toBe(200); expect(bookings.status()).toBe(200);
    expect((await requests.json()).requests[0]).toMatchObject({ request_id: 23, status: 'approved', decider_name: 'Regression venue' });
    const confirmed = (await bookings.json()).bookings;
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ event_id: 62, venue_id: 3, status: 'confirmed', starts_at: '2030-06-18T02:00:00Z', ends_at: '2030-06-18T10:00:00Z' });
    await withAccount(page.request, 'coordinator', async coordinator => {
      const notices = await page.request.get('/api/notifications', { headers: coordinator });
      expect(notices.status()).toBe(200);
      expect((await notices.json()).notifications).toContainEqual(expect.objectContaining({ event_id: 62, request_id: 23,
        kind: 'venue_request_approved', message: 'Lecture Theatre was approved for Colleague Capacity Forum.' }));
    });
  });

  await test.step('The booked venue whose attendance rose gets an exception for the revised attendance and keeps its booking', async () => {
    await page.getByRole('navigation').getByRole('button', { name: 'Capacity exceptions', exact: true }).click();
    await page.getByRole('button', { name: 'Review exception for Booked Capacity Forum at Lecture Theatre', exact: true }).click();
    const suitability = page.getByRole('region', { name: 'Venue suitability', exact: true });
    await expect(suitability.getByText(/Capacity exception for 130 people approved by Regression venue \(Venue Staff\) on/)).toBeVisible();
    await suitability.getByRole('button', { name: 'Approve capacity exception', exact: true }).click();
    await expect(suitability.getByText(/Capacity exception for 150 people approved by Regression venue \(Venue Staff\) on/)).toBeVisible();
    const stored = await requestsFor(page, 67);
    expect(stored.requests.map((request: { request_id: number; status: string }) => [request.request_id, request.status])).toEqual([[28, 'approved']]);
    expect(stored.bookings).toEqual([expect.objectContaining({ event_id: 67, venue_id: 3, status: 'confirmed' })]);
    await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review exception for Suitability Forum at Lecture Theatre', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Review exception for (Booked|Colleague) Capacity Forum/ })).toHaveCount(0);
    await expect(page.getByText('Booked — attendance raised', { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await noOverflow(page);
    await screenshot(page, info, 'venue-staff-booked-revised-attendance-1440');
    expect(issues).toEqual([]);
  });
});

test('SG2-47-N02 | [FAILURE] [SG2-47:AC3] [SG2-66:AC5] [SG2-25:AC1] [SG2-25:AC2] [SG2-25:AC3] coordinators, organisers and Technical Support have no discovery navigation and public API refusals leave the pending exception unchanged', async ({ page }, info) => {
  const issues = watchConsole(page);
  expect((await page.request.get('/api/venue-booking-requests/capacity-exceptions')).status()).toBe(401);
  for (const account of ['coordinator', 'organiser', 'support']) {
    await test.step(`${account}: no navigation entry, and direct list and approval requests are refused`, async () => {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await signIn(page, account);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByRole('navigation').getByRole('button', { name: 'Capacity exceptions', exact: true })).toHaveCount(0);
        await noOverflow(page);
        await screenshot(page, info, `${account}-no-capacity-navigation-${width}`);
      }
      const auth = await headers(page);
      const list = await page.request.get('/api/venue-booking-requests/capacity-exceptions', { headers: auth });
      const approval = await page.request.post('/api/venue-booking-requests/21/capacity-exception', { headers: auth });
      expect(list.status()).toBe(403); expect(await list.json()).toEqual({ error: 'Access denied' });
      expect(approval.status()).toBe(403); expect(await approval.json()).toEqual({ error: 'Access denied' });
      const response = await page.request.get('/api/venue-booking-requests/21/suitability', { headers: auth });
      expect(response.status()).toBe(200);
      const fit = await response.json();
      expect(fit.booking).toBe('needs_capacity_exception'); expect(fit.exceptions).toEqual([]);
    });
  }
  const stored = await requestsFor(page, 61);
  expect(stored.requests.map((request: { request_id: number; status: string }) => [request.request_id, request.status])).toEqual([[21, 'pending'], [22, 'pending']]);
  expect(stored.bookings).toEqual([]);
  expect(issues).toEqual([]);
});
