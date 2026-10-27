import { expect, test, type Page, type TestInfo } from '@playwright/test';

// SG2-65: the coordinator accepts or refuses a change request, against the
// in-memory mirror of decide_event_change_request (e2e/support/change-requests.ts).
// The SQL suite supabase/tests/change_request_decisions.sql proves the real
// function's lock, decision record and grants.

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
function watchConsole(page: Page) {
  const issues: string[] = [];
  page.on('pageerror', error => issues.push(error.message));
  page.on('console', message => { if (message.type() === 'error') issues.push(message.text()); });
  return issues;
}
async function evidence(page: Page, info: TestInfo, name: string) {
  const panel = page.getByTestId('change-requests-panel');
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await info.attach(name, { body: await panel.screenshot(), contentType: 'image/png' });
}
async function raise(page: Page) {
  const response = await page.request.post('/api/event-requests/52/change-requests', {
    headers: await auth(page, 'organiser'),
    data: { field: 'expected_attendance', to: 34, reason: 'Two partner teams have joined.' }
  });
  expect(response.status()).toBe(201);
}
async function organiserNotices(page: Page, kind: string) {
  const body = await (await page.request.get('/api/notifications', { headers: await auth(page, 'organiser') })).json();
  return body.notifications.filter((notice: { kind: string }) => notice.kind === kind)
    .map((notice: { event_id: number; message: string }) => [notice.event_id, notice.message]);
}
async function stored(page: Page) {
  const body = await (await page.request.get('/api/event-requests/52', { headers: await auth(page, 'organiser') })).json();
  return [body.request.status, body.request.expected_attendance];
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/under-review')).status()).toBe(204);
});

test('SG2-65-P01 | [NORMAL] [SG2-65:AC2] [SG2-65:AC3] the coordinator refuses a change with a reason; the event is unchanged and the organiser is told why', async ({ page }, info) => {
  const issues = watchConsole(page);
  await raise(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'coordinator');
  await page.getByRole('region', { name: 'Awaiting review' }).getByRole('button', { name: /Decision Forum/ }).click();
  const card = page.getByTestId('change-requests-panel').getByRole('article');
  await card.getByRole('button', { name: 'Refuse change', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Confirm refusal', exact: true })).toBeDisabled();
  await card.getByLabel('Reason for refusing').fill('The Kelp Room cannot seat more.');
  await evidence(page, info, 'refuse-change-390');
  await page.setViewportSize({ width: 1440, height: 900 });
  await evidence(page, info, 'refuse-change-1440');
  await card.getByRole('button', { name: 'Confirm refusal', exact: true }).click();
  await expect(page.getByTestId('change-requests-panel').getByRole('status'))
    .toHaveText('Change refused. The event is unchanged and the organiser has been told why.');
  await expect(page.getByTestId('change-requests-panel').getByRole('article')).toHaveCount(0);
  expect(await stored(page)).toEqual(['under_review', 20]);
  expect(await organiserNotices(page, 'change_refused')).toEqual([[52,
    'Decision Forum: your change request was refused. Reason: The Kelp Room cannot seat more.']]);
  expect(issues).toEqual([]);
});

test('SG2-65-P02 | [NORMAL] [SG2-65:AC1] [SG2-65:AC4] on a request returned for clarification the coordinator accepts the change and sends it back to review', async ({ page }) => {
  const issues = watchConsole(page);
  const coordinator = await auth(page, 'coordinator');
  expect((await page.request.post('/api/event-requests/52/clarifications',
    { headers: coordinator, data: { message: 'How many guests now?' } })).status()).toBe(201);
  await raise(page);
  await signIn(page, 'coordinator');
  await page.getByRole('button', { name: /Decision Forum/ }).first().click();
  const card = page.getByTestId('change-requests-panel').getByRole('article');
  await expect(card.getByRole('button', { name: 'Accept change', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: 'Accept and return to review', exact: true }).click();
  await expect(page.getByTestId('change-requests-panel').getByRole('article')).toHaveCount(0);
  expect(await stored(page)).toEqual(['under_review', 34]);
  expect(await organiserNotices(page, 'change_accepted')).toEqual([[52,
    'Decision Forum: your change request was accepted and the request is back in review.']]);
  expect(issues).toEqual([]);
});

test('SG2-65-N01 | [BOUNDARY] [CONFLICT] [FAILURE] [SG2-65:AC2] [SG2-65:AC4] a blank reason, a missing next step, a second decision and other roles are refused', async ({ page }) => {
  await raise(page);
  const coordinator = await auth(page, 'coordinator');
  const listed = await (await page.request.get('/api/event-requests/52/change-requests', { headers: coordinator })).json();
  const id = listed.change_requests[0].id;
  const refuse = (data: unknown, headers = coordinator) =>
    page.request.post(`/api/event-requests/52/change-requests/${id}/refuse`, { headers, data: data as object });
  expect((await refuse({ reason: '   ' })).status()).toBe(400);
  expect((await refuse({ reason: 'r'.repeat(1001) })).status()).toBe(400);
  expect((await refuse({ reason: 'No.' }, await auth(page, 'organiser'))).status()).toBe(403);
  expect((await refuse({ reason: 'No.' })).status()).toBe(200);
  expect((await refuse({ reason: 'Again.' })).status()).toBe(404);
  expect(await stored(page)).toEqual(['under_review', 20]);
  expect((await page.request.post('/api/event-requests/52/clarifications',
    { headers: coordinator, data: { message: 'Which date?' } })).status()).toBe(201);
  await raise(page);
  const again = await (await page.request.get('/api/event-requests/52/change-requests', { headers: coordinator })).json();
  const accept = await page.request.post(`/api/event-requests/52/change-requests/${again.change_requests[0].id}/accept`,
    { headers: coordinator, data: {} });
  expect(accept.status()).toBe(400);
  expect(await stored(page)).toEqual(['needs_clarification', 20]);
});
