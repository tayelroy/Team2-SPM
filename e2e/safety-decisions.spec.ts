import { expect, test, type Page } from '@playwright/test';

// SG2-92: the list of events awaiting a check stands in for SG2-91; the
// decision, the status move, the notices, the history and the rework are real.

async function signIn(page: Page, account: string) {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app' }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function auth(page: Page, account: string) {
  const response = await page.request.post('/api/auth/login', { data: { email: `${account}@example.test`, password: 'Regression123!' } });
  expect(response.status()).toBe(200); return { Authorization: `Bearer ${(await response.json()).accessToken}` };
}
type Ledger = { events: Record<string, unknown>[]; decisions: Record<string, unknown>[]; audit: Record<string, unknown>[]; notifications: Record<string, unknown>[] };
async function ledger(page: Page): Promise<Ledger> { return (await page.request.get('/__e2e/safety-decisions-ledger')).json(); }
const statusOf = (stored: Ledger, eventId: number) => stored.events.find(row => row.event_id === eventId)?.status;
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function decide(page: Page, event: string, decision: 'Approve' | 'Reject' | 'Request changes', reason?: string, arrangements: string[] = []) {
  await page.getByRole('button', { name: new RegExp(event) }).click();
  const review = page.getByTestId('safety-review');
  await expect(review.getByRole('heading', { name: event, exact: true })).toBeVisible();
  await review.getByRole('radio', { name: decision, exact: true }).check();
  if (reason) await review.getByLabel('Reason', { exact: true }).fill(reason);
  for (const arrangement of arrangements) await review.getByRole('checkbox', { name: arrangement, exact: true }).check();
  await review.getByRole('button', { name: 'Record decision', exact: true }).click();
}

const APPROVED = 'Harbour Gala passed its operational safety check and has moved to Preparation.';
const REJECTED = 'Riverside Fair did not pass its operational safety check: Crowd flow blocks the east fire exit. The coordinator will rework the arrangements for a new check.';
const CHANGES = 'Bayfront Talk needs changes before it can pass its operational safety check (Venue, Other): Widen the aisles. It has moved back to Planning.';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/safety-decisions')).status()).toBe(204);
});

test('SG2-92-P01 | [NORMAL] [SG2-92:AC1] [SG2-92:AC2] [SG2-92:AC3] [SG2-92:AC4] [SG2-92:AC5] [SG2-92:AC6] the Safety Officer approves, rejects and requests changes, and each event moves on with the organiser and coordinator told', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'safety');
  const queue = page.getByTestId('safety-check-queue');
  await expect(queue.getByTestId('safety-check-stand-in-note')).toContainText('stand-in for SG2-91');
  await expect(queue.getByRole('list', { name: 'Events awaiting a safety check' }).getByRole('button'))
    .toHaveText([/Harbour Gala/, /Riverside Fair/, /Bayfront Talk/]);

  // AC2: nothing is sent without a reason to reject.
  await page.getByRole('button', { name: /Riverside Fair/ }).click();
  const review = page.getByTestId('safety-review');
  await expect(review).toContainText('Regression Hall: capacity 100');
  await expect(review).toContainText('Wireless microphones × 4, placed Stage left');
  await expect(review).toContainText('No earlier safety decisions on this event.');
  await review.getByRole('radio', { name: 'Reject', exact: true }).check();
  await review.getByRole('button', { name: 'Record decision', exact: true }).click();
  await expect(review.getByRole('alert')).toHaveText('Give a reason to reject this event.');
  expect((await ledger(page)).decisions).toEqual([]);

  await decide(page, 'Harbour Gala', 'Approve');
  await expect(queue.getByRole('status')).toHaveText('Approved for Harbour Gala. The organiser and the coordinator have been notified.');
  await decide(page, 'Riverside Fair', 'Reject', 'Crowd flow blocks the east fire exit');
  await expect(queue.getByRole('status')).toHaveText('Rejected for Riverside Fair. The organiser and the coordinator have been notified.');
  await decide(page, 'Bayfront Talk', 'Request changes', 'Widen the aisles', ['Venue', 'Other']);
  await expect(queue.getByRole('status')).toHaveText('Changes requested for Bayfront Talk. The organiser and the coordinator have been notified.');
  await expect(queue.getByText('No events are awaiting a safety check.', { exact: true })).toBeVisible();

  // AC3/AC4: each event moved on; AC6: who, when and why are kept, with the history.
  const stored = await ledger(page);
  expect([statusOf(stored, 921), statusOf(stored, 922), statusOf(stored, 923)]).toEqual(['preparation', 'safety_rejected', 'planning']);
  expect(stored.decisions).toEqual([
    expect.objectContaining({ event_id: 921, decision: 'approve', reason: null, arrangements: [], decided_by: 'user-safety' }),
    expect.objectContaining({ event_id: 922, decision: 'reject', reason: 'Crowd flow blocks the east fire exit', decided_by: 'user-safety' }),
    expect.objectContaining({ event_id: 923, decision: 'request_changes', reason: 'Widen the aisles', arrangements: ['venue', 'other'] }),
  ]);
  expect(stored.audit.filter(row => row.field_name === 'safety_decision').map(row => row.new_value)).toEqual([
    'Approved', 'Rejected: Crowd flow blocks the east fire exit', 'Changes requested (Venue, Other): Widen the aisles',
  ]);
  // AC5: the organiser and the coordinator each get one notice per decision.
  expect(stored.notifications.map(row => [row.recipient_id, row.kind, row.message])).toEqual([
    ['user-organiser', 'safety_decision', APPROVED], ['user-coordinator', 'safety_decision', APPROVED],
    ['user-organiser', 'safety_decision', REJECTED], ['user-coordinator', 'safety_decision', REJECTED],
    ['user-organiser', 'safety_decision', CHANGES], ['user-coordinator', 'safety_decision', CHANGES],
  ]);

  await signIn(page, 'organiser');
  await page.getByRole('button', { name: 'Notifications (3)', exact: true }).click();
  const inbox = page.getByRole('complementary', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('Safety check', { exact: true })).toHaveCount(3);
  await expect(inbox.getByText(REJECTED, { exact: true })).toBeVisible();
});

test('SG2-92-P02 | [NORMAL] [SG2-92:AC4] [SG2-92:AC6] the coordinator sees the rejection and its reason, and reworks the event back to Planning', async ({ page }) => {
  const safety = await auth(page, 'safety');
  expect((await page.request.post('/api/event-requests/922/safety-decision', { headers: safety,
    data: { decision: 'reject', reason: 'Crowd flow blocks the east fire exit' } })).status()).toBe(201);

  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'coordinator');
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: /Riverside Fair/ }).click();
  const summary = page.getByTestId('safety-decision-summary');
  await expect(summary).toContainText('Rejected');
  await expect(summary).toContainText('Crowd flow blocks the east fire exit');
  await expect(summary).toContainText('Regression safety');
  expect(await noOverflow(page)).toBe(true);
  await summary.getByRole('button', { name: 'Rework arrangements', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Event request' }).locator('.work-queue-status').first()).toHaveText('planning');
  await expect(page.getByRole('button', { name: 'Rework arrangements', exact: true })).toHaveCount(0);
  const stored = await ledger(page);
  expect(statusOf(stored, 922)).toBe('planning');
  expect(stored.audit.filter(row => row.event_id === 922 && row.field_name === 'status').map(row => [row.old_value, row.new_value]))
    .toEqual([['awaiting_safety_check', 'safety_rejected'], ['safety_rejected', 'planning']]);
});

test('SG2-92-N01 | [FAILURE] [CONFLICT] [SG2-92:AC1] [SG2-92:AC2] [SG2-92:AC4] only the Safety Officer decides, only once per check, and only with what each decision needs', async ({ page }) => {
  const [safety, coordinator, organiser] = await Promise.all(['safety', 'coordinator', 'organiser'].map(account => auth(page, account)));
  const decide = (headers: Record<string, string>, eventId: number, data: unknown) =>
    page.request.post(`/api/event-requests/${eventId}/safety-decision`, { headers, data });
  for (const headers of [coordinator, organiser]) expect((await decide(headers, 921, { decision: 'approve' })).status()).toBe(403);
  const invalid = await decide(safety, 923, { decision: 'request_changes', reason: 'Widen the aisles' });
  expect([invalid.status(), (await invalid.json()).details]).toEqual([400, ['Name at least one arrangement to change.']]);
  expect((await decide(safety, 921, { decision: 'approve' })).status()).toBe(201);
  const again = await decide(safety, 921, { decision: 'reject', reason: 'Too late' });
  expect([again.status(), await again.json()]).toEqual([409, { error: 'This event is no longer awaiting a safety check.', status: 'preparation' }]);
  const rework = await page.request.post('/api/event-requests/921/rework', { headers: coordinator });
  expect([rework.status(), (await rework.json()).error]).toEqual([409, 'Only a Safety Rejected event can be reworked.']);
  expect((await page.request.get('/api/safety-checks', { headers: coordinator })).status()).toBe(403);
  const history = await page.request.get('/api/event-requests/921/safety-decisions', { headers: organiser });
  expect((await history.json()).decisions.map((row: { decision: string }) => row.decision)).toEqual(['approve']);
  const stored = await ledger(page);
  expect(stored.decisions).toHaveLength(1);
  expect([statusOf(stored, 922), statusOf(stored, 923)]).toEqual(['awaiting_safety_check', 'awaiting_safety_check']);
});
