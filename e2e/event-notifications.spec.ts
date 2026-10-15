import { expect, test, type Page } from '@playwright/test';

type Notice = { notification_id: number; recipient_id: string; event_id: number; request_id: number | null; kind: string; message: string; created_at: string };

async function signIn(page: Page, account: string) {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
// One sign-in per account per test keeps clear of the login rate limit.
const tokens = new Map<string, { Authorization: string }>();
async function auth(page: Page, account: string) {
  const cached = tokens.get(account);
  if (cached) return cached;
  const response = await page.request.post('/api/auth/login', { data: { email: `${account}@example.test`, password: 'Regression123!' } });
  expect(response.status()).toBe(200);
  const headers = { Authorization: `Bearer ${(await response.json()).accessToken}` };
  tokens.set(account, headers);
  return headers;
}
async function ledger(page: Page): Promise<{ notifications: Notice[]; events: Record<string, unknown>[] }> {
  return (await page.request.get('/__e2e/event-notifications-ledger')).json();
}
/** What the ledger holds for one person, without ids and times. */
async function received(page: Page, recipient: string) {
  return (await ledger(page)).notifications.filter(row => row.recipient_id === recipient)
    .map(({ event_id, request_id, kind, message }) => ({ event_id, request_id, kind, message }));
}
async function act(page: Page, account: string, method: 'patch' | 'post', path: string, data: Record<string, unknown> = {}) {
  return page.request[method](path, { headers: await auth(page, account), data });
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const SGT_TIME = /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} SGT$/;

/** Opens the bell, checks the count and each notice's label, message and time, then closes it. */
async function expectInbox(page: Page, notices: [label: string, message: string][]) {
  await page.getByRole('button', { name: `Notifications (${notices.length})`, exact: true }).click();
  const inbox = page.getByRole('complementary', { name: 'Notifications', exact: true });
  for (const [label, message] of notices) {
    await expect(inbox.getByText(label, { exact: true })).toBeVisible();
    await expect(inbox.getByText(message, { exact: true })).toBeVisible();
  }
  if (notices.length === 0) await expect(inbox.getByText('No notifications yet.', { exact: true })).toBeVisible();
  const times = inbox.getByText(SGT_TIME);
  await expect(times).toHaveCount(notices.length);
  return inbox;
}
async function closeInbox(page: Page) {
  await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
}

test.beforeEach(async ({ request }) => {
  tokens.clear();
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/event-notifications')).status()).toBe(204);
});

test('SG2-68-P01 | [NORMAL] [SG2-68:AC1] [SG2-68:AC2] submitting an event tells the Event Coordinator Lead, whose bell names the event, what happened and when', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/681/submit')).status()).toBe(200);
  const stored = await ledger(page);
  expect(stored.notifications).toEqual([expect.objectContaining({
    recipient_id: 'user-lead', event_id: 681, request_id: null, kind: 'event_submitted', message: 'Notice Forum was submitted and is waiting for a coordinator.'
  })]);
  expect(Date.parse(stored.notifications[0].created_at)).not.toBeNaN();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'lead');
  await expectInbox(page, [['Event submitted', 'Notice Forum was submitted and is waiting for a coordinator.']]);
  await closeInbox(page);
  expect(errors).toEqual([]);
});

test('SG2-68-P02 | [NORMAL] [SG2-68:AC1] [SG2-68:AC2] assigning and reassigning a coordinator tells the new coordinator, the organiser and the coordinator taken off', async ({ page }) => {
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/681/submit')).status()).toBe(200);
  expect((await act(page, 'lead', 'patch', '/api/event-requests/681/coordinator', { coordinatorId: 'user-coordinator' })).status()).toBe(200);
  expect(await received(page, 'user-coordinator')).toEqual([
    { event_id: 681, request_id: null, kind: 'coordinator_assigned', message: 'You are now coordinating Notice Forum.' }
  ]);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'coordinator');
  await expectInbox(page, [['Coordinator assigned', 'You are now coordinating Notice Forum.']]);
  await closeInbox(page);
  await signIn(page, 'organiser');
  await expectInbox(page, [['Coordinator assigned', 'Regression coordinator is now coordinating Notice Forum.']]);
  await closeInbox(page);

  expect((await act(page, 'lead', 'patch', '/api/event-requests/681/coordinator', { coordinatorId: 'user-coordinator2' })).status()).toBe(200);
  expect(await received(page, 'user-coordinator')).toEqual([
    { event_id: 681, request_id: null, kind: 'coordinator_assigned', message: 'You are now coordinating Notice Forum.' },
    { event_id: 681, request_id: null, kind: 'coordinator_assigned', message: 'Notice Forum was reassigned to another coordinator.' }
  ]);
  expect(await received(page, 'user-coordinator2')).toEqual([
    { event_id: 681, request_id: null, kind: 'coordinator_assigned', message: 'You are now coordinating Notice Forum.' }
  ]);
  expect((await received(page, 'user-organiser')).map(row => row.message)).toEqual([
    'Regression coordinator is now coordinating Notice Forum.', 'Regression second coordinator is now coordinating Notice Forum.'
  ]);
  // The Lead who made the change is told only about the submission.
  expect((await received(page, 'user-lead')).map(row => row.kind)).toEqual(['event_submitted']);
});

test('SG2-68-P03 | [NORMAL] [SG2-68:AC1] [SG2-68:AC2] a coordinator\'s question tells the organiser without the question, and the resubmission tells the coordinator', async ({ page }) => {
  const question = 'Which room layout do you need for the keynote?';
  expect((await act(page, 'coordinator', 'post', '/api/event-requests/682/clarifications', { message: question })).status()).toBe(201);
  expect(await received(page, 'user-organiser')).toEqual([
    { event_id: 682, request_id: null, kind: 'clarification_requested', message: 'Your coordinator has a question about Question Forum.' }
  ]);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'organiser');
  const inbox = await expectInbox(page, [['Question from your coordinator', 'Your coordinator has a question about Question Forum.']]);
  await expect(inbox.getByText(question)).toHaveCount(0);
  await closeInbox(page);

  // The organiser's answer is not a new question; the resubmission goes back to the coordinator.
  expect((await act(page, 'organiser', 'post', '/api/event-requests/682/clarifications', { message: 'Theatre style, please.' })).status()).toBe(201);
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/682/submit')).status()).toBe(200);
  expect(await received(page, 'user-coordinator')).toEqual([
    { event_id: 682, request_id: null, kind: 'event_submitted', message: 'Question Forum was resubmitted for your review.' }
  ]);
  expect(await received(page, 'user-lead')).toEqual([]);
  await signIn(page, 'coordinator');
  await expectInbox(page, [['Event submitted', 'Question Forum was resubmitted for your review.']]);
});

test('SG2-68-P04 | [NORMAL] [SG2-68:AC1] [SG2-68:AC2] approving one request and rejecting another tells the organiser each outcome and the reason', async ({ page }) => {
  expect((await act(page, 'coordinator', 'patch', '/api/event-requests/682/decision', { decision: 'approved' })).status()).toBe(200);
  expect((await act(page, 'coordinator', 'patch', '/api/event-requests/683/decision',
    { decision: 'rejected', reason: 'It clashes with the annual general meeting.' })).status()).toBe(200);
  expect(await received(page, 'user-organiser')).toEqual([
    { event_id: 682, request_id: null, kind: 'event_approved', message: 'Question Forum was approved.' },
    { event_id: 683, request_id: null, kind: 'event_rejected', message: 'Rejection Forum was not approved: It clashes with the annual general meeting.' }
  ]);
  expect(await received(page, 'user-coordinator')).toEqual([]);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'organiser');
  await expectInbox(page, [
    ['Event approved', 'Question Forum was approved.'],
    ['Event not approved', 'Rejection Forum was not approved: It clashes with the annual general meeting.']
  ]);
});

test('SG2-68-P05 | [NORMAL] [SG2-68:AC1] [SG2-68:AC2] a venue decision tells the organiser as well as the coordinator, with the same text', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-decision')).status()).toBe(204);
  expect((await act(page, 'venue', 'post', '/api/venue-booking-requests/101/decision', { decision: 'approve' })).status()).toBe(200);
  expect((await act(page, 'venue', 'post', '/api/venue-booking-requests/102/decision',
    { decision: 'reject', reason: 'The floor is being resurfaced that week.' })).status()).toBe(200);
  const expected = [
    { event_id: 91, request_id: 101, kind: 'venue_request_approved', message: 'Regression Hall was approved for Venue Request Forum.' },
    { event_id: 91, request_id: 102, kind: 'venue_request_rejected', message: 'Regression Hall was rejected for Venue Request Forum: The floor is being resurfaced that week.' }
  ];
  expect(await received(page, 'user-organiser')).toEqual(expected);
  expect(await received(page, 'user-coordinator')).toEqual(expected);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'organiser');
  await expectInbox(page, [
    ['Venue request approved', 'Regression Hall was approved for Venue Request Forum.'],
    ['Venue request rejected', 'Regression Hall was rejected for Venue Request Forum: The floor is being resurfaced that week.']
  ]);
});

test('SG2-68-P06 | [NORMAL] [SG2-68:AC1] converting a tentative hold into a booking tells the organiser their event has the venue', async ({ page, request }) => {
  expect((await request.post('/__e2e/venue-holds')).status()).toBe(204);
  const placed = await act(page, 'venue', 'post', '/api/venue-holds',
    { event_id: 81, venue_id: 1, starts_at: '2030-06-05T02:00:00.000Z', ends_at: '2030-06-05T04:00:00.000Z', expires_at: '2030-06-03T02:00:00.000Z' });
  expect(placed.status()).toBe(201);
  const holdId = (await placed.json()).hold.hold_id;
  expect((await act(page, 'venue', 'post', `/api/venue-holds/${holdId}/convert`)).status()).toBe(200);
  expect(await received(page, 'user-organiser')).toEqual([
    { event_id: 81, request_id: 1, kind: 'venue_request_approved', message: 'Regression Hall was approved for Tentative Hold Forum.' }
  ]);
  // The coordinator already follows the hold through its own inbox.
  expect(await received(page, 'user-coordinator')).toEqual([]);
});

test('SG2-68-N01 | [CONFLICT] [SG2-68:AC3] people with no part in the event are never notified, whoever else is', async ({ page }) => {
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/681/submit')).status()).toBe(200);
  expect((await act(page, 'lead', 'patch', '/api/event-requests/681/coordinator', { coordinatorId: 'user-coordinator2' })).status()).toBe(200);
  expect((await act(page, 'coordinator', 'post', '/api/event-requests/682/clarifications', { message: 'Which layout?' })).status()).toBe(201);
  expect((await act(page, 'coordinator', 'patch', '/api/event-requests/683/decision', { decision: 'approved' })).status()).toBe(200);
  const recipients = [...new Set((await ledger(page)).notifications.map(row => row.recipient_id))].sort();
  expect(recipients).toEqual(['user-coordinator2', 'user-lead', 'user-organiser']);

  // Another organisation's organiser, a colleague in the same organisation, the
  // unassigned coordinator and venue staff each read an empty inbox.
  for (const account of ['organiser2', 'colleague', 'venue']) {
    const response = await page.request.get('/api/notifications', { headers: await auth(page, account) });
    expect([response.status(), await response.json()]).toEqual([200, { notifications: [] }]);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'coordinator');
  // The signed-in coordinator's own question and decision notify the organiser, not them.
  await expectInbox(page, []);
  await closeInbox(page);
  await signIn(page, 'organiser2');
  await expectInbox(page, []);
});

test('SG2-68-B01 | [BOUNDARY] [SG2-68:AC2] the Lead\'s and the organiser\'s bells fit 390px and 1440px without horizontal overflow', async ({ page }) => {
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/681/submit')).status()).toBe(200);
  expect((await act(page, 'lead', 'patch', '/api/event-requests/681/coordinator', { coordinatorId: 'user-coordinator' })).status()).toBe(200);
  expect((await act(page, 'coordinator', 'patch', '/api/event-requests/683/decision',
    { decision: 'rejected', reason: 'A much longer reason that has to wrap inside the drawer rather than push it wider than a phone screen allows.' })).status()).toBe(200);
  for (const [account, notices] of [
    ['lead', [['Event submitted', 'Notice Forum was submitted and is waiting for a coordinator.']]],
    ['organiser', [['Coordinator assigned', 'Regression coordinator is now coordinating Notice Forum.'],
      ['Event not approved', 'Rejection Forum was not approved: A much longer reason that has to wrap inside the drawer rather than push it wider than a phone screen allows.']]],
  ] as [string, [string, string][]][]) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await signIn(page, account);
      expect(await noOverflow(page)).toBe(true);
      const inbox = await expectInbox(page, notices);
      const box = (await inbox.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await noOverflow(page)).toBe(true);
      await closeInbox(page);
    }
  }
});

test('SG2-68-F01 | [FAILURE] [SG2-68:AC1] [SG2-68:AC3] refused and replayed actions notify nobody, and only roles with an inbox may read one', async ({ page, request }) => {
  // Someone else's event, a role without the grant, and a replay are all refused before any notice.
  expect((await act(page, 'organiser2', 'patch', '/api/event-requests/681/submit')).status()).toBe(404);
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/681/coordinator', { coordinatorId: 'user-coordinator' })).status()).toBe(403);
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/682/decision', { decision: 'approved' })).status()).toBe(403);
  expect((await ledger(page)).notifications).toEqual([]);
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/681/submit')).status()).toBe(200);
  expect((await act(page, 'organiser', 'patch', '/api/event-requests/681/submit')).status()).toBe(409);
  expect((await act(page, 'coordinator', 'patch', '/api/event-requests/682/decision', { decision: 'approved' })).status()).toBe(200);
  expect((await act(page, 'coordinator', 'patch', '/api/event-requests/682/decision', { decision: 'rejected', reason: 'Changed my mind.' })).status()).toBe(404);
  expect((await request.post('/__e2e/venue-decision')).status()).toBe(204);
  expect((await act(page, 'venue', 'post', '/api/venue-booking-requests/101/decision', { decision: 'approve' })).status()).toBe(200);
  expect((await act(page, 'venue', 'post', '/api/venue-booking-requests/101/decision', { decision: 'approve' })).status()).toBe(409);
  expect((await ledger(page)).notifications.map(({ recipient_id, kind }) => [recipient_id, kind])).toEqual([
    ['user-lead', 'event_submitted'], ['user-organiser', 'event_approved'],
    ['user-coordinator', 'venue_request_approved'], ['user-organiser', 'venue_request_approved']
  ]);

  expect((await page.request.get('/api/notifications')).status()).toBe(401);
  for (const account of ['safety', 'attendee']) {
    expect((await page.request.get('/api/notifications', { headers: await auth(page, account) })).status()).toBe(403);
  }
});
