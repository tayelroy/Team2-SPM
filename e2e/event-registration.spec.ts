import { expect, test, type Page } from '@playwright/test';

// SG2-60: an attendee registers for an event open for registration.

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
async function openEvent(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Find events', exact: true }).click();
  await page.getByRole('region', { name: 'Events open for registration', exact: true })
    .getByRole('article', { name, exact: true }).getByRole('button', { name: 'View details', exact: true }).click();
  return page.getByRole('region', { name: 'Registration', exact: true });
}
const ledger = async (page: Page) => (await page.request.get('/__e2e/event-registration-ledger')).json();
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/event-registration')).status()).toBe(204);
});

test('SG2-60-P01 | [NORMAL] [SG2-60:AC1] [SG2-60:AC2] [SG2-60:AC4] an attendee registers with their phone and needs, is confirmed with the event information, and cannot register twice', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'attendee');
  const registration = await openEvent(page, 'Harbour Lecture');

  // AC4: the phone comes from the profile; needs are optional.
  await expect(registration.getByLabel('Contact phone', { exact: true })).toHaveValue('+65 9123 4567');
  await registration.getByLabel('Accessibility or dietary needs (optional)', { exact: true }).fill('Step-free access');
  await expect(registration).toContainText('16/500 characters');
  expect(await noOverflow(page)).toBe(true);
  await registration.getByRole('button', { name: 'Register', exact: true }).click();

  // AC1: the place is held and confirmed with the date, time and venue.
  const confirmed = registration.getByRole('status');
  await expect(confirmed).toContainText('You are registered. Your place is held.');
  await expect(confirmed).toContainText('When20 Jul 2030, 7:00 pm');
  await expect(confirmed).toContainText('WhereRegression Hall');
  await expect(confirmed).toContainText('A confirmation is in your notifications.');
  await expect(registration.getByRole('button', { name: 'Register', exact: true })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  const stored = await ledger(page);
  expect(stored.registrations.filter((row: { event_id: number }) => row.event_id === 591)
    .map(({ attendee_id, status, contact_phone, needs }: Record<string, unknown>) => ({ attendee_id, status, contact_phone, needs })))
    .toEqual([{ attendee_id: 'user-attendee', status: 'registered', contact_phone: '+65 9123 4567', needs: 'Step-free access' }]);
  expect(stored.notifications.map(({ recipient_id, message }: Record<string, unknown>) => ({ recipient_id, message })))
    .toEqual([{ recipient_id: 'user-attendee', message: 'You are registered for Harbour Lecture on 20 Jul 2030 19:00 SGT at Regression Hall.' }]);

  // AC2: back on the list the event is marked, and its details show the place instead of the form.
  await page.getByRole('button', { name: 'Back to events', exact: true }).click();
  const lecture = page.getByRole('article', { name: 'Harbour Lecture', exact: true });
  await expect(lecture).toContainText('Registered');
  await lecture.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Registration', exact: true }).getByRole('status'))
    .toContainText('You are already registered for this event.');
  const again = await page.request.post('/api/registrable-events/591/registrations',
    { headers: await auth(page, 'attendee'), data: { contact_phone: '91234567' } });
  expect([again.status(), await again.json()]).toEqual([409, { error: 'You are already registered for this event.', reason: 'duplicate' }]);
  expect((await ledger(page)).registrations.filter((row: { event_id: number }) => row.event_id === 591)).toHaveLength(1);

  // AC1: the confirmation reaches the attendee's inbox.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /^Notifications \(\d+\)$/ }).click();
  const inbox = page.getByRole('complementary', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('Registration confirmed', { exact: true })).toBeVisible();
  await expect(inbox.getByText('You are registered for Harbour Lecture on 20 Jul 2030 19:00 SGT at Regression Hall.')).toBeVisible();

  // AC4: the assigned coordinator sees the phone and needs given.
  const picture = await (await page.request.get('/api/event-requests/591/registrations',
    { headers: await auth(page, 'coordinator') })).json();
  expect(picture.attendees.map(({ name, phone, needs }: Record<string, unknown>) => ({ name, phone, needs })))
    .toEqual([{ name: 'Regression attendee', phone: '+65 9123 4567', needs: 'Step-free access' }]);
  expect(errors).toEqual([]);
});

test('SG2-60-N01 | [FAILURE] [SG2-60:AC1] [SG2-60:AC3] [SG2-60:AC4] a full, not yet open or closed event, invalid details and other roles are refused, and nothing is stored', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'attendee');

  // AC1: the only place is taken (the attendee's own cancelled one gives none back).
  let registration = await openEvent(page, 'Small Recital');
  await registration.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(registration.getByRole('alert')).toHaveText('This event is full.');
  await expect(registration.getByRole('button', { name: 'Register', exact: true })).toHaveCount(0);

  // AC3: not yet open says when, with no form.
  await page.getByRole('button', { name: 'Back to events', exact: true }).click();
  registration = await openEvent(page, 'Bayfront Workshop');
  await expect(registration).toContainText('Registration opens 1 Jun 2030, 8:00 am. Come back then to register.');
  await expect(registration.getByRole('button', { name: 'Register', exact: true })).toHaveCount(0);

  // AC4: a missing phone and over-long needs are refused before sending.
  await page.getByRole('button', { name: 'Back to events', exact: true }).click();
  registration = await openEvent(page, 'Harbour Lecture');
  await expect(registration.getByLabel('Contact phone', { exact: true })).toHaveValue('+65 9123 4567');
  await registration.getByLabel('Contact phone', { exact: true }).fill('');
  await registration.getByLabel('Accessibility or dietary needs (optional)', { exact: true }).fill('n'.repeat(501));
  await registration.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(registration.getByRole('alert')).toContainText('Enter a contact phone number.');
  await expect(registration.getByRole('alert')).toContainText('Keep accessibility or dietary needs to 500 characters.');

  const attendee = await auth(page, 'attendee');
  const post = (eventId: number, data: unknown, headers = attendee) =>
    page.request.post(`/api/registrable-events/${eventId}/registrations`, { headers, data });
  const answers = [];
  for (const [eventId, data] of [[592, { contact_phone: '91234567' }], [593, { contact_phone: '91234567' }],
    [594, { contact_phone: '91234567' }], [591, { contact_phone: '9123 456' }], [591, { contact_phone: '91234567', needs: 'n'.repeat(501) }]] as const) {
    const response = await post(eventId, data);
    answers.push([eventId, response.status(), (await response.json()).error]);
  }
  expect(answers).toEqual([
    [592, 409, 'Registration opens 01 Jun 2030 08:00 SGT.'],
    [593, 409, 'Registration for this event has closed.'],
    [594, 404, 'This event is not open for registration.'],
    [591, 400, 'Check your registration details.'],
    [591, 400, 'Check your registration details.'],
  ]);
  for (const account of ['organiser', 'coordinator', 'lead']) {
    const response = await post(591, { contact_phone: '91234567' }, await auth(page, account));
    expect([account, response.status()]).toEqual([account, 403]);
  }
  const stored = await ledger(page);
  expect(stored.registrations.filter((row: { attendee_id: string; status: string }) =>
    row.attendee_id === 'user-attendee' && row.status !== 'cancelled')).toEqual([]);
  expect(stored.notifications).toEqual([]);
});
