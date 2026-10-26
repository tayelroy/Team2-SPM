import { expect, test, type Page, type TestInfo } from '@playwright/test';

// SG2-64: the organiser asks for a change after submitting, against the
// in-memory mirror of raise_event_change_request (e2e/support/change-requests.ts).
// The SQL suite supabase/tests/event_change_requests.sql proves the real
// function's lock, status rules and grants.

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
  const section = page.getByRole('region', { name: 'Change requests', exact: true });
  await section.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await info.attach(name, { body: await section.screenshot(), contentType: 'image/png' });
}

const NOTICE = 'Decision Forum has a change request waiting for your decision.';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/under-review')).status()).toBe(204);
});

test('SG2-64-P01 | [NORMAL] [SG2-64:AC1] [SG2-64:AC2] [SG2-64:AC3] the organiser asks for a change on a submitted event; it reaches the assigned coordinator and both see it outstanding', async ({ page }, info) => {
  const issues = watchConsole(page);
  await test.step('The organiser states what, to what and why on their event under review', async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    await signIn(page, 'organiser');
    await page.getByRole('button', { name: /Decision Forum/ }).first().click();
    const section = page.getByRole('region', { name: 'Change requests', exact: true });
    await expect(section.getByText('You have no outstanding change requests on this event.')).toBeVisible();
    await section.getByLabel('What should change').selectOption('expected_attendance');
    await section.getByLabel('New expected attendance').fill('34');
    await section.getByLabel('Why it should change').fill('Two partner teams have joined.');
    await section.getByRole('button', { name: 'Ask for this change', exact: true }).click();
    await expect(section.getByRole('status')).toHaveText('Your change request was sent to your coordinator.');
    await expect(section.getByRole('list', { name: 'Outstanding change requests' }))
      .toContainText('Expected attendance: 20 → 34. Reason: Two partner teams have joined.');
    await evidence(page, info, 'organiser-change-request-390');
    await page.setViewportSize({ width: 1440, height: 900 });
    await evidence(page, info, 'organiser-change-request-1440');
  });
  await test.step('The assigned coordinator is notified and sees the request on the event', async () => {
    const coordinator = await auth(page, 'coordinator');
    const notices = await (await page.request.get('/api/notifications', { headers: coordinator })).json();
    expect(notices.notifications).toContainEqual(expect.objectContaining({ kind: 'change_requested', event_id: 52, message: NOTICE }));
    const organiser = await auth(page, 'organiser');
    const own = await (await page.request.get('/api/notifications', { headers: organiser })).json();
    expect(own.notifications.filter((notice: { kind: string }) => notice.kind === 'change_requested')).toEqual([]);
    const listed = await (await page.request.get('/api/event-requests/52/change-requests', { headers: coordinator })).json();
    expect(listed.change_requests).toHaveLength(1);
    expect(listed.change_requests[0]).toMatchObject({ reason: 'Two partner teams have joined.',
      changes: [{ field: 'expected_attendance', from: 20, to: 34 }], significant: true });
    await signIn(page, 'coordinator');
    await page.getByRole('region', { name: 'Awaiting review' }).getByRole('button', { name: /Decision Forum/ }).click();
    const panel = page.getByTestId('change-requests-panel');
    await expect(panel).toContainText('Two partner teams have joined.');
    expect(issues).toEqual([]);
  });
});

test('SG2-64-N01 | [BOUNDARY] [CONFLICT] [FAILURE] [SG2-64:AC1] [SG2-64:AC3] [SG2-64:AC4] closed events, other accounts, the current value and a missing reason are refused and nothing is stored', async ({ page }) => {
  const organiser = await auth(page, 'organiser');
  const raise = (id: number, data: unknown, headers = organiser) =>
    page.request.post(`/api/event-requests/${id}/change-requests`, { headers, data: data as object });
  const body = { field: 'expected_attendance', to: 34, reason: 'More guests.' };
  // AC4: a draft is never a submitted event.
  const draft = await raise(1, body);
  expect([draft.status(), (await draft.json()).status]).toEqual([409, 'draft']);
  // The current value is not a change, and a reason is required.
  expect((await raise(52, { ...body, to: 20 })).status()).toBe(409);
  expect((await raise(52, { ...body, reason: '   ' })).status()).toBe(400);
  // Another organisation's organiser cannot see the event; a coordinator cannot raise.
  expect((await raise(52, body, await auth(page, 'organiser2'))).status()).toBe(404);
  expect((await raise(52, body, await auth(page, 'coordinator'))).status()).toBe(403);
  expect((await page.request.get('/api/event-requests/52/change-requests', { headers: await auth(page, 'organiser2') })).status()).toBe(404);
  const listed = await (await page.request.get('/api/event-requests/52/change-requests', { headers: organiser })).json();
  expect(listed.change_requests).toEqual([]);
});
