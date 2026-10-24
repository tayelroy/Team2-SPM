import { expect, test, type Page } from '@playwright/test';

// SG2-94: an event reaches Preparation, and can be confirmed, only on the
// Safety Officer's Approve; a significant change accepted afterwards withdraws
// that approval and the event must pass the check again.

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
type Ledger = { events: Record<string, unknown>[]; decisions: Record<string, unknown>[]; audit: Record<string, unknown>[]; notifications: Record<string, unknown>[] };
async function ledger(page: Page): Promise<Ledger> { return (await page.request.get('/__e2e/safety-approval-ledger')).json(); }
const eventRow = (stored: Ledger, eventId: number) => stored.events.find(row => row.event_id === eventId);
async function openAssigned(page: Page, name: string) {
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
const readiness = (page: Page) => page.getByRole('region', { name: 'Event arrangement readiness', exact: true });
// A footer inside the event article is not a landmark, so it has no role to query by.
const confirmPanel = (page: Page) => page.locator('footer[aria-label="Confirm this event"]');

const AWAITING = "Awaiting the Safety Officer's operational safety check.";
const WITHDRAWN_REASON = 'The approval was withdrawn after the event changed. It must pass the safety check again once its arrangements are in place.';
const WITHDRAWN_HINT = 'This approval was withdrawn because the event changed after it was approved. It must pass the safety check again.';
const REFUSED = { error: 'Confirmation refused: arrangements are still outstanding.', code: 'outstanding' };

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/safety-approval')).status()).toBe(204);
});

test('SG2-94-P01 | [NORMAL] [SG2-94:AC4] [SG2-94:AC5] the coordinator sees the safety check outstanding on an event awaiting it, and confirmation is refused for it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'coordinator'); await openAssigned(page, 'Lantern Forum');
  const panel = readiness(page);
  await expect(panel.getByTestId('arrangement-safety')).toContainText('Safety check');
  await expect(panel.getByTestId('arrangement-safety')).toContainText(AWAITING);
  await expect(panel.getByTestId('arrangement-safety-state')).toHaveText('Outstanding');
  await expect(panel.getByTestId('arrangement-venue-state')).toHaveText('Ready');
  await expect(panel.getByTestId('arrangement-equipment-state')).toHaveText('Ready');
  await expect(panel.getByTestId('readiness-badge')).toHaveText('Arrangements outstanding');
  await expect(confirmPanel(page)).toHaveCount(0);

  // AC5: the server refuses a direct attempt with the check listed.
  const refused = await page.request.patch('/api/event-requests/941/confirm', { headers: await auth(page, 'coordinator') });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toEqual({ ...REFUSED, outstanding: ['safety'] });
  const stored = await ledger(page);
  expect(eventRow(stored, 941)).toMatchObject({ status: 'awaiting_safety_check', confirmed_by: null });
  expect(stored.audit).toEqual([]);
});

test('SG2-94-P02 | [NORMAL] [SG2-94:AC2] [SG2-94:AC5] once the Safety Officer approves, the coordinator sees the safety check ready and confirms the event', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'safety');
  await page.getByRole('navigation').getByRole('button', { name: 'Safety checks', exact: true }).click();
  const review = page.getByRole('region', { name: 'Safety decision for Lantern Forum', exact: true });
  await review.getByRole('radio', { name: 'Approve', exact: true }).check();
  await review.getByRole('button', { name: 'Record decision', exact: true }).click();
  await expect(page.getByText('Approved for Lantern Forum. The organiser and the coordinator have been notified.', { exact: true })).toBeVisible();
  expect(eventRow(await ledger(page), 941)).toMatchObject({ status: 'preparation' });

  await signIn(page, 'coordinator'); await openAssigned(page, 'Lantern Forum');
  const panel = readiness(page);
  await expect(panel.getByTestId('arrangement-safety')).toContainText('Approved by the Safety Officer.');
  await expect(panel.getByTestId('arrangement-safety-state')).toHaveText('Ready');
  await expect(panel.getByTestId('readiness-badge')).toHaveText('Ready for confirmation');
  await confirmPanel(page).getByRole('button', { name: 'Confirm event', exact: true }).click();
  await expect(page.getByText('Event confirmed. The Event Organiser has been notified.', { exact: true })).toBeVisible();
  await expect(page.locator('.work-queue-status')).toHaveText('confirmed');
  const stored = await ledger(page);
  expect(eventRow(stored, 941)).toMatchObject({ status: 'confirmed', confirmed_by: 'user-coordinator' });
  expect(stored.decisions.filter(row => row.event_id === 941))
    .toEqual([expect.objectContaining({ decision: 'approve', reason: null, decided_by: 'user-safety' })]);
  expect(stored.audit.filter(row => row.field_name === 'status').map(row => [row.old_value, row.new_value]))
    .toEqual([['awaiting_safety_check', 'preparation'], ['preparation', 'confirmed']]);
});

test('SG2-94-C01 | [CONFLICT] [SG2-94:AC3] [SG2-94:AC5] accepting a significant change on an approved event withdraws the approval and the event must be checked again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'coordinator'); await openAssigned(page, 'Beacon Forum');
  await expect(readiness(page).getByTestId('arrangement-safety-state')).toHaveText('Ready');
  const summary = page.getByRole('region', { name: 'Latest safety decision', exact: true });
  await expect(summary).toContainText('Approved');
  await expect(summary.getByTestId('safety-approval-withdrawn')).toHaveCount(0);

  await page.getByTestId('change-request-mock-942-attendance').getByRole('button', { name: 'Accept change', exact: true }).click();
  await expect(page.getByTestId('arrangements-recheck-banner')).toBeVisible();
  await expect(page.locator('.work-queue-status').first()).toHaveText('planning');
  const stored = await ledger(page);
  expect(eventRow(stored, 942)).toMatchObject({ status: 'planning', expected_attendance: 120, confirmed_by: null });
  expect(stored.audit.map(row => row.field_name)).toEqual(['expected_attendance', 'change_request', 'status', 'safety_approval']);
  expect(stored.audit.at(-1)).toMatchObject({ actor_id: 'user-coordinator', old_value: 'Approved',
    new_value: 'Withdrawn: the accepted change request mock-942-attendance changed what was approved, so the event must pass the safety check again' });
  // The decision history itself is append-only: the Approve stays on record.
  expect(stored.decisions).toEqual([expect.objectContaining({ event_id: 942, decision: 'approve' })]);

  // The coordinator re-opens the event: the check is outstanding again, with why.
  await signIn(page, 'coordinator'); await openAssigned(page, 'Beacon Forum');
  const panel = readiness(page);
  await expect(panel.getByTestId('arrangement-safety')).toContainText(WITHDRAWN_REASON);
  await expect(panel.getByTestId('arrangement-safety-state')).toHaveText('Outstanding');
  await expect(panel.getByTestId('readiness-badge')).toHaveText('Arrangements outstanding');
  await expect(page.getByRole('region', { name: 'Latest safety decision', exact: true }).getByTestId('safety-approval-withdrawn'))
    .toHaveText(WITHDRAWN_HINT);
  // AC5: a confirmation attempt is refused with the check among what is outstanding.
  const refused = await page.request.patch('/api/event-requests/942/confirm', { headers: await auth(page, 'coordinator') });
  expect(refused.status()).toBe(409);
  const body = await refused.json();
  expect(body).toMatchObject(REFUSED);
  expect(body.outstanding.at(-1)).toBe('safety');
  expect(eventRow(await ledger(page), 942)).toMatchObject({ status: 'planning', confirmed_at: null });
});
