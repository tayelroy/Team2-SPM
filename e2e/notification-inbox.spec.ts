import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, account = 'coordinator') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
const inbox = (page: Page) => page.getByRole('complementary', { name: 'Notifications', exact: true });
const ledger = async (page: Page) => (await page.request.get('/__e2e/notification-inbox-ledger')).json();
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.beforeEach(async ({ request }) => { expect((await request.post('/__e2e/reset')).status()).toBe(204); });

test('SG2-69-P01 | [NORMAL] [SG2-69:AC1] [SG2-69:AC2] [SG2-69:AC3] the global inbox distinguishes unread notices and opening one marks only that source identity read before showing its event', async ({ page, request }) => {
  expect((await request.post('/__e2e/notification-inbox')).status()).toBe(204);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await page.getByRole('button', { name: 'Notifications (2)', exact: true }).click();
  const drawer = inbox(page);
  await expect(drawer.getByText('Private other organisation notice.')).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: /^Unread:/ })).toHaveCount(2);
  await expect(drawer.getByRole('button', { name: /^Read:/ })).toHaveCount(1);
  expect(await drawer.getByRole('button', { name: /^(Unread|Read):/ }).evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')))).toEqual([
    'Unread: Reminder Forum still needs: Venue booking, Equipment.',
    'Unread: Reminder Forum tentative venue hold expired.',
    'Read: You are coordinating Reminder Forum.',
  ]);
  await drawer.getByRole('button').filter({ hasText: 'Reminder Forum still needs: Venue booking, Equipment.' }).click();
  await expect(page.getByRole('heading', { name: 'Reminder Forum', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications (1)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View event details', exact: true }).click();
  const event = page.getByRole('article', { name: 'Event request', exact: true });
  await expect(event.getByRole('heading', { name: 'Reminder Forum', exact: true })).toBeVisible();
  await expect(event.getByRole('button', { name: 'Edit Planning Information', exact: true })).toBeVisible();
  await expect(page.getByText('Your session has expired. Please sign in again.', { exact: true })).toHaveCount(0);
  const stored = await ledger(page);
  expect(stored.notifications.find((row: { notification_id: number }) => row.notification_id === 1)).toEqual(expect.objectContaining({
    recipient_id: 'user-coordinator', event_id: 691, kind: 'outstanding_arrangements', message: 'Reminder Forum still needs: Venue booking, Equipment.', read_at: expect.any(String),
  }));
  expect(stored.holds[0].read_at).toBeNull();
  expect(stored.notifications.find((row: { notification_id: number }) => row.notification_id === 2).read_at).toBe('2030-06-01T01:05:00.000Z');
  await page.reload();
  await page.getByRole('button', { name: 'Notifications (1)', exact: true }).click();
  await expect(inbox(page).getByRole('button', { name: /^Unread:/ })).toHaveCount(1);
  expect(errors).toEqual([]);
  expect(await noOverflow(page)).toBe(true);
});

test('SG2-69-B01 | [BOUNDARY] [SG2-69:AC1] [SG2-69:AC2] [SG2-69:AC4] unread totals include older pages and mark-all clears both sources beyond the first fifty at phone width', async ({ page, request }) => {
  expect((await request.post('/__e2e/notification-inbox', { data: { large: true } })).status()).toBe(204);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole('button', { name: 'Notifications (53)', exact: true }).click();
  const drawer = inbox(page);
  await expect(drawer.getByText('Earlier notice 3', { exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Load older notifications', exact: true }).click();
  await expect(drawer.getByText('Earlier notice 3', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^Unread:/ })).toHaveCount(53);
  await drawer.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Notifications (0)', exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  const stored = await ledger(page);
  const own = [...stored.notifications, ...stored.holds].filter(row => row.recipient_id === 'user-coordinator');
  expect(own).toHaveLength(54);
  expect(own.every(row => typeof row.read_at === 'string')).toBe(true);
  expect(stored.notifications.find((row: { notification_id: number }) => row.notification_id === 90).read_at).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Notifications (0)', exact: true })).toBeVisible();
});

test('SG2-69-P02 | [NORMAL] [BOUNDARY] [SG2-69:AC5] [SG2-69:AC6] a coordinator saves the daily default and thirty-day reminder frequency and sees it after reload', async ({ page, request }) => {
  expect((await request.post('/__e2e/notification-inbox')).status()).toBe(204);
  await signIn(page);
  await page.getByRole('button', { name: 'Notifications (2)', exact: true }).click();
  const frequency = inbox(page).getByLabel('Reminder frequency (days)', { exact: true });
  await expect(frequency).toHaveValue('1');
  await frequency.fill('30');
  await inbox(page).getByRole('button', { name: 'Save reminder frequency', exact: true }).click();
  await expect(inbox(page).getByRole('status')).toContainText('saved');
  expect((await ledger(page)).preferences).toEqual([{ user_id: 'user-coordinator', frequency_days: 30 }]);
  await page.reload();
  await page.getByRole('button', { name: 'Notifications (2)', exact: true }).click();
  await expect(inbox(page).getByLabel('Reminder frequency (days)', { exact: true })).toHaveValue('30');
});

test('SG2-69-N01 | [CONFLICT] [SG2-69:AC3] [SG2-69:AC4] [SG2-69:AC7] an unrelated account cannot read the target, mark another notice, or change coordinator reminder settings', async ({ page, request }) => {
  expect((await request.post('/__e2e/notification-inbox')).status()).toBe(204);
  const response = await request.post('/api/auth/login', { data: { email: 'organiser2@example.test', password: 'Regression123!' } });
  expect(response.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await response.json()).accessToken}` };
  expect((await request.post('/api/notifications/event/1/read', { headers })).status()).toBe(404);
  expect((await request.get('/api/notifications/event/1/event', { headers })).status()).toBe(404);
  expect((await request.put('/api/notifications/reminder-preferences', { headers, data: { frequency_days: 30 } })).status()).toBe(403);
  expect((await request.post('/api/notifications/read-all', { headers })).status()).toBe(200);
  const stored = await ledger(page);
  expect(stored.notifications.find((row: { notification_id: number }) => row.notification_id === 1).read_at).toBeNull();
  expect(stored.holds[0].read_at).toBeNull();
  expect(stored.preferences).toEqual([]);
  await signIn(page, 'attendee');
  await page.getByRole('button', { name: 'Notifications (0)', exact: true }).click();
  await expect(inbox(page).getByText('No notifications yet.', { exact: true })).toBeVisible();
  await expect(inbox(page).getByLabel('Reminder frequency (days)', { exact: true })).toHaveCount(0);
});

test('SG2-69-F01 | [FAILURE] [SG2-69:AC1] [SG2-69:AC3] an unavailable read mutation keeps the drawer and unread count until a successful retry', async ({ page, request }) => {
  expect((await request.post('/__e2e/notification-inbox')).status()).toBe(204);
  await signIn(page);
  await page.getByRole('button', { name: 'Notifications (2)', exact: true }).click();
  await page.route('**/api/notifications/event/1/read', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Service temporarily unavailable."}' }));
  const reminder = () => inbox(page).getByRole('button').filter({ hasText: 'Reminder Forum still needs: Venue booking, Equipment.' });
  await reminder().click();
  await expect(inbox(page).getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications (2)', exact: true })).toBeVisible();
  expect((await ledger(page)).notifications.find((row: { notification_id: number }) => row.notification_id === 1).read_at).toBeNull();
  await page.unroute('**/api/notifications/event/1/read');
  await reminder().click();
  await expect(page.getByRole('heading', { name: 'Reminder Forum', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications (1)', exact: true })).toBeVisible();
});

test('SG2-69-R01 | [NORMAL] [CONFLICT] [SG2-69:AC1] [SG2-69:AC2] [SG2-69:AC3] a focus refresh reconciles another session read without losing or duplicating loaded history', async ({ page, request }) => {
  expect((await request.post('/__e2e/notification-inbox', { data: { large: true } })).status()).toBe(204);
  await signIn(page);
  await page.getByRole('button', { name: 'Notifications (53)', exact: true }).click();
  const drawer = inbox(page);
  await drawer.getByRole('button', { name: 'Load older notifications', exact: true }).click();
  const rows = drawer.getByRole('button', { name: /^(Unread|Read):/ });
  await expect(rows).toHaveCount(54);
  const orderedMessages = () => rows.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')!.replace(/^(Unread|Read): /, '')));
  const originalOrder = await orderedMessages();
  await expect(drawer.getByRole('button', { name: 'Unread: Earlier notice 3', exact: true })).toBeVisible();
  // A second authenticated session uses the same real read route, rather than
  // modifying the first page's component state or database fixture directly.
  const login = await request.post('/api/auth/login', { data: { email: 'coordinator@example.test', password: 'Regression123!' } });
  expect(login.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  const marked = await request.post('/api/notifications/event/3/read', { headers });
  expect(marked.status()).toBe(200);
  expect((await marked.json()).unread_count).toBe(52);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Notifications (52)', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Read: Earlier notice 3', exact: true })).toBeVisible();
  await expect(rows).toHaveCount(54);
  expect(await orderedMessages()).toEqual(originalOrder);
  expect(new Set(await orderedMessages()).size).toBe(54);
  await expect(drawer.getByRole('button', { name: /^Unread:/ })).toHaveCount(52);
  await expect(drawer.getByRole('button', { name: /^Read:/ })).toHaveCount(2);
  await expect(drawer.getByRole('button', { name: 'Load older notifications', exact: true })).toHaveCount(0);
  await expect(drawer.getByText('Private other organisation notice.', { exact: true })).toHaveCount(0);
  const stored = await ledger(page);
  expect(stored.notifications.find((row: { notification_id: number }) => row.notification_id === 3).read_at).toEqual(expect.any(String));
  expect(stored.holds[0].read_at).toBeNull();
});
