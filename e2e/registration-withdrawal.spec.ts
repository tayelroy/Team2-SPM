import { expect, test, type Page } from '@playwright/test';

// SG2-62: an attendee sees and withdraws their registrations.

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
async function openMine(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'My registrations', exact: true }).click();
  return page.getByRole('region', { name: 'Registrations', exact: true });
}
const ledger = async (page: Page) => (await page.request.get('/__e2e/my-registrations-ledger')).json();
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/my-registrations')).status()).toBe(204);
});

test('SG2-62-P01 | [NORMAL] [SG2-62:AC1] [SG2-62:AC2] [SG2-62:AC5] an attendee sees where each registration stands and withdraws after registration closed, and the organiser and coordinator are told', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'attendee');
  const list = await openMine(page);

  // AC1: every registration with the event details and where it stands, active ones first.
  await expect(page.getByRole('heading', { level: 1, name: 'My registrations' })).toBeVisible();
  await expect(list.getByRole('article')).toHaveText([/^Quartet Evening/, /^Lantern Talk/, /^Morning Run/, /^Closed Briefing/, /^Small Recital/]);
  const quartet = list.getByRole('article', { name: 'Quartet Evening', exact: true });
  await expect(quartet).toContainText('Registered');
  await expect(quartet).toContainText('Date and time1 Nov 2030, 7:00 pm');
  await expect(quartet).toContainText('VenueRegression Hall');
  await expect(quartet).toContainText('Hosted byHarbour Foundation');
  await expect(quartet).toContainText('Accessibility or dietary needsAisle seat');
  await expect(list.getByRole('article', { name: 'Morning Run', exact: true })).toContainText('Event started');
  await expect(list.getByRole('article', { name: 'Closed Briefing', exact: true })).toContainText('Withdrawn2 Oct 2026, 10:00 am');
  for (const name of ['Morning Run', 'Closed Briefing']) {
    await expect(list.getByRole('article', { name, exact: true }).getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
  }
  expect(await noOverflow(page)).toBe(true);

  // AC2: registration for Lantern Talk closed in 2020, and it can still be withdrawn after confirming.
  const lantern = list.getByRole('article', { name: 'Lantern Talk', exact: true });
  await lantern.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const confirm = page.getByRole('group', { name: 'Withdraw from Lantern Talk', exact: true });
  await expect(confirm).toContainText('Your place goes back to the event and someone else can take it.');
  expect(await noOverflow(page)).toBe(true);
  expect((await ledger(page)).registrations.find((row: { registration_id: number }) => row.registration_id === 6202).status).toBe('registered');
  await confirm.getByRole('button', { name: 'Confirm withdrawal', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('You have withdrawn from Lantern Talk. Your place has been given back.');
  await expect(lantern).toContainText('Withdrawn');
  await expect(lantern.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);

  // AC5: the organiser and the assigned coordinator are each told once, with the places remaining.
  const stored = await ledger(page);
  expect(stored.registrations.find((row: { registration_id: number }) => row.registration_id === 6202))
    .toMatchObject({ status: 'cancelled', withdrawn_at: expect.any(String) });
  expect(stored.notifications.map(({ recipient_id, event_id, message }: Record<string, unknown>) => ({ recipient_id, event_id, message })))
    .toEqual(['user-organiser', 'user-coordinator'].map(recipient_id =>
      ({ recipient_id, event_id: 598, message: 'Regression attendee withdrew from Lantern Talk. 40 of 40 places now remain.' })));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'organiser');
  await page.getByRole('button', { name: /^Notifications \(\d+\)$/ }).click();
  const inbox = page.getByRole('complementary', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('Attendee withdrew', { exact: true })).toBeVisible();
  await expect(inbox.getByText('Regression attendee withdrew from Lantern Talk. 40 of 40 places now remain.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('SG2-62-P02 | [NORMAL] [SG2-62:AC3] withdrawing from a full event gives the place back, so it can be taken again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'attendee');

  // The attendee holds Quartet Evening's only place, so it is full.
  const attendee = await auth(page, 'attendee');
  const held = await page.request.post('/api/registrable-events/597/registrations', { headers: attendee, data: { contact_phone: '91234567' } });
  expect([held.status(), (await held.json()).reason]).toEqual([409, 'duplicate']);

  const list = await openMine(page);
  await list.getByRole('article', { name: 'Quartet Evening', exact: true }).getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm withdrawal', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('You have withdrawn from Quartet Evening.');

  // AC3: the place is back. The coordinator's picture shows it, and registering takes it again.
  const picture = await (await page.request.get('/api/event-requests/597/registrations', { headers: await auth(page, 'coordinator') })).json();
  expect([picture.registered_count, picture.places_remaining, picture.attendees]).toEqual([0, 1, []]);
  expect((await ledger(page)).notifications.map(({ message }: Record<string, unknown>) => message))
    .toEqual(['Regression attendee withdrew from Quartet Evening. 1 of 1 places now remain.',
      'Regression attendee withdrew from Quartet Evening. 1 of 1 places now remain.']);

  await page.getByRole('navigation').getByRole('button', { name: 'Find events', exact: true }).click();
  await page.getByRole('article', { name: 'Quartet Evening', exact: true }).getByRole('button', { name: 'View details', exact: true }).click();
  const registration = page.getByRole('region', { name: 'Registration', exact: true });
  await registration.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(registration.getByRole('status')).toContainText('You are registered. Your place is held.');
  const mine = await (await page.request.get('/api/my-registrations', { headers: attendee })).json();
  expect(mine.registrations.filter((row: { event_id: number }) => row.event_id === 597).map(({ standing }: { standing: string }) => standing))
    .toEqual(['registered', 'withdrawn']);
});

test('SG2-62-N01 | [FAILURE] [SG2-62:AC2] [SG2-62:AC4] withdrawing after the start, twice, or someone else\'s registration is refused, other roles are refused, and nothing changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'attendee');
  const list = await openMine(page);
  // AC4: the started event offers no withdrawal.
  await expect(list.getByRole('article', { name: 'Morning Run', exact: true })).toContainText('Event started');
  await expect(list.getByRole('article', { name: 'Morning Run', exact: true }).getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);

  const attendee = await auth(page, 'attendee');
  const withdraw = (id: number, headers = attendee) => page.request.post(`/api/my-registrations/${id}/withdrawal`, { headers });
  const answers = [];
  for (const id of [6203, 6204, 6001, 999999]) {
    const response = await withdraw(id);
    answers.push([id, response.status(), (await response.json()).error]);
  }
  expect(answers).toEqual([
    [6203, 409, 'This event started 02 Oct 2026 07:00 SGT, so you can no longer withdraw.'],
    [6204, 409, 'You have already withdrawn from this event.'],
    [6001, 404, 'This registration was not found.'],
    [999999, 404, 'This registration was not found.'],
  ]);
  for (const account of ['organiser', 'coordinator', 'lead']) {
    const headers = await auth(page, account);
    const [read, write] = [await page.request.get('/api/my-registrations', { headers }), await withdraw(6201, headers)];
    expect([account, read.status(), write.status()]).toEqual([account, 403, 403]);
  }
  const stored = await ledger(page);
  expect(stored.registrations.map(({ registration_id, status }: Record<string, unknown>) => [registration_id, status]))
    .toEqual([[6201, 'registered'], [6202, 'registered'], [6203, 'registered'], [6204, 'cancelled']]);
  expect(stored.notifications).toEqual([]);
});
