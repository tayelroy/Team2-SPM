import { expect, test, type Page } from '@playwright/test';

// SG2-66: change requests are sample data standing in for SG2-64/SG2-65; the
// impact, the acceptance, the return to Planning, the notices and the
// rechecks are real.

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
type Ledger = { events: Record<string, unknown>[]; audit: Record<string, unknown>[]; notifications: Record<string, unknown>[] };
async function ledger(page: Page): Promise<Ledger> { return (await page.request.get('/__e2e/change-impact-ledger')).json(); }
async function openAssigned(page: Page, name: string) {
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
const pane = (page: Page) => page.getByRole('article', { name: 'Event request' });
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const CAPACITY = "The revised attendance of 120 is above Regression Hall's capacity of 100. A new capacity check is needed: "
  + 'only Venue Staff can approve a capacity exception for the revised attendance.';
const ORGANISER_NOTICE = 'Harbour Showcase has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.';
const COORDINATOR_NOTICE = 'Harbour Showcase is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/change-impact')).status()).toBe(204);
});

test('SG2-66-P01 | [NORMAL] [SG2-66:AC1] [SG2-66:AC2] [SG2-66:AC3] [SG2-66:AC4] [SG2-66:AC7] the coordinator sees what a change breaks, accepts it, the event returns to Planning and the organiser is told', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'coordinator'); await openAssigned(page, 'Harbour Showcase');

  // AC1-AC3: the sample requests and what each would break.
  const panel = page.getByTestId('change-requests-panel');
  await expect(panel).toContainText('sample change requests');
  const attendance = panel.getByTestId('change-request-mock-661-attendance');
  await expect(attendance).toContainText('Expected attendance');
  await expect(attendance).toContainText('Significant change');
  const affected = attendance.getByTestId('affected-arrangement');
  await expect(affected).toHaveCount(3);
  await expect(affected.nth(0)).toContainText('Regression Hall');
  await expect(affected.nth(0)).toContainText(CAPACITY);
  await expect(affected.nth(1)).toContainText('Wireless microphones × 12');
  await expect(affected.nth(1)).not.toContainText('capacity');
  await expect(affected.nth(2)).toContainText('Registrations (2 received)');
  const date = panel.getByTestId('change-request-mock-661-date');
  await expect(date.getByTestId('affected-arrangement').nth(0)).toContainText(
    'Booked from 20 Jun 2030 10:00 SGT to 20 Jun 2030 14:00 SGT; recheck it against the new start of 27 Jun 2030 10:00 SGT.');
  await expect(date.getByTestId('affected-arrangement').nth(1)).toContainText(
    'Reserved from 20 Jun 2030 10:00 SGT to 20 Jun 2030 14:00 SGT; recheck it against the new start of 27 Jun 2030 10:00 SGT.');
  const description = panel.getByTestId('change-request-mock-661-description');
  await expect(description).toContainText('No revalidation needed');
  await expect(description.getByTestId('affected-arrangement')).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);

  // AC4: accepting it leaves the arrangements outstanding and the event back in Planning.
  await attendance.getByRole('button', { name: 'Accept change', exact: true }).click();
  const banner = page.getByTestId('arrangements-recheck-banner');
  await expect(banner).toBeVisible();
  await expect(pane(page).locator('.work-queue-status').first()).toHaveText('planning');
  await expect(banner.getByRole('button')).toHaveText(['Mark venue rechecked', 'Mark equipment rechecked', 'Mark registrations rechecked']);
  await expect(page.getByTestId('change-request-mock-661-attendance')).toHaveCount(0);
  let stored = await ledger(page);
  expect(stored.events[0]).toMatchObject({ status: 'planning', expected_attendance: 120, confirmed_by: null, confirmed_at: null,
    arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck', 'equipment_recheck', 'registration_recheck'] });
  // AC7: the move is in the history, and both people are told.
  expect(stored.audit).toEqual([
    expect.objectContaining({ actor_id: 'user-coordinator', field_name: 'expected_attendance', old_value: '80', new_value: '120' }),
    expect.objectContaining({ field_name: 'change_request', new_value: 'Accepted change request mock-661-attendance' }),
    expect.objectContaining({ field_name: 'status', old_value: 'confirmed', new_value: 'planning' })
  ]);
  expect(stored.notifications).toEqual([
    expect.objectContaining({ recipient_id: 'user-organiser', kind: 'event_returned_to_planning', message: ORGANISER_NOTICE }),
    expect.objectContaining({ recipient_id: 'user-coordinator', kind: 'event_returned_to_planning', message: COORDINATOR_NOTICE })
  ]);

  // AC2/AC4: the hall is still too small, so its recheck cannot be settled yet.
  await banner.getByRole('button', { name: 'Mark venue rechecked', exact: true }).click();
  const blockers = page.getByTestId('recheck-blockers');
  await expect(blockers).toContainText('This arrangement still needs attention before it can be marked rechecked.');
  await expect(blockers.getByRole('listitem')).toHaveText([CAPACITY]);
  // Registration still closes before the event and holds fewer than its capacity.
  await banner.getByRole('button', { name: 'Mark registrations rechecked', exact: true }).click();
  await expect(page.getByTestId('arrangements-recheck-banner').getByRole('button'))
    .toHaveText(['Mark venue rechecked', 'Mark equipment rechecked']);
  stored = await ledger(page);
  expect(stored.events[0]).toMatchObject({ status: 'planning', outstanding_arrangements: ['venue_recheck', 'equipment_recheck'] });
  expect(stored.audit.at(-1)).toMatchObject({ field_name: 'arrangement_recheck', new_value: 'registration_recheck settled' });

  await signIn(page, 'organiser');
  await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
  const inbox = page.getByRole('complementary', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('Back in Planning', { exact: true })).toBeVisible();
  await expect(inbox.getByText(ORGANISER_NOTICE, { exact: true })).toBeVisible();
  // The refused venue recheck is the only failed request the browser reports.
  expect(errors).toEqual(['Failed to load resource: the server responded with a status of 409 (Conflict)']);
});

test('SG2-66-F01 | [FAILURE] [SG2-66:AC1] [SG2-66:AC4] only the assigned coordinator sees or accepts change requests, and nothing outstanding cannot be settled', async ({ page }) => {
  const organiser = await auth(page, 'organiser');
  expect((await page.request.get('/api/event-requests/661/change-requests', { headers: organiser })).status()).toBe(403);
  expect((await page.request.post('/api/event-requests/661/change-requests/mock-661-attendance/accept', { headers: organiser })).status()).toBe(403);
  const coordinator = await auth(page, 'coordinator');
  expect((await page.request.get('/api/event-requests/1/change-requests', { headers: coordinator })).status()).toBe(404);
  const settle = await page.request.post('/api/event-requests/661/rechecks/venue_recheck/settle', { headers: coordinator });
  expect(settle.status()).toBe(409);
  expect(await settle.json()).toEqual({ error: 'That arrangement is not waiting for a recheck.' });
  const unknown = await page.request.post('/api/event-requests/661/change-requests/mock-1-attendance/accept', { headers: coordinator });
  expect(unknown.status()).toBe(404);
  const stored = await ledger(page);
  expect(stored.events[0]).toMatchObject({ status: 'confirmed', arrangements_recheck_needed: false });
  expect([stored.audit, stored.notifications]).toEqual([[], []]);
});
