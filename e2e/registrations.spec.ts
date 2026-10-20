import { expect, test, type Page } from '@playwright/test';

// SG2-63: the registration picture for an event, and the Event Organiser's
// control of its registration capacity and opening and closing times.

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
type Ledger = { event: Record<string, unknown>; audit: Record<string, unknown>[]; notifications: Record<string, unknown>[] };
async function ledger(page: Page): Promise<Ledger> { return (await page.request.get('/__e2e/registrations-ledger')).json(); }
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function openAsOrganiser(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'My events', exact: true }).click();
  await page.getByRole('button', { name: 'View Harbour Lecture', exact: true }).click();
  return page.getByRole('region', { name: 'Registration', exact: true });
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/registrations')).status()).toBe(204);
});

test('SG2-63-P01 | [NORMAL] [BOUNDARY] [SG2-63:AC1] [SG2-63:AC2] [SG2-63:AC4] [SG2-63:AC5] [SG2-63:AC6] [SG2-63:AC7] [SG2-63:AC9] [SG2-63:AC10] the organiser sees who is coming, raises capacity past the venue with a warning, closes registration early and reopens it', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'organiser');
  const panel = await openAsOrganiser(page);

  // AC1, AC2, AC4: the numbers and the people, with contact details for the creator.
  await expect(panel.getByText('Registration is open.', { exact: true })).toBeVisible();
  await expect(panel.getByTestId('registration-count')).toHaveText('2');
  await expect(panel.getByTestId('registration-remaining')).toHaveText('78');
  const attendees = panel.getByRole('list', { name: 'Registered attendees', exact: true }).getByRole('listitem');
  await expect(attendees).toHaveCount(2);
  await expect(attendees.nth(0)).toContainText('Regression attendee');
  await expect(attendees.nth(0).getByRole('link', { name: 'attendee@example.test', exact: true })).toBeVisible();
  await expect(attendees.nth(1)).toContainText('Guest Attendee');
  await expect(attendees.nth(1)).toContainText('No phone on record');
  expect(await noOverflow(page)).toBe(true);

  // AC5, AC7: a capacity above Regression Hall warns while typing and is still saved.
  const form = panel.getByRole('form', { name: 'Registration settings', exact: true });
  await form.getByLabel('Capacity', { exact: true }).fill('150');
  await expect(form.getByRole('list', { name: 'Capacity warnings' })).toHaveText('A capacity of 150 is more than Regression Hall holds (100).');
  await form.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Registration settings saved.');
  await expect(panel.getByTestId('registration-remaining')).toHaveText('148');
  await expect(panel.getByRole('list', { name: 'Capacity warnings' }).first()).toHaveText('A capacity of 150 is more than Regression Hall holds (100).');

  // AC6, AC10: closing early is announced to the organiser and the coordinator.
  await form.getByRole('button', { name: 'Close registration now', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Registration is closed.');
  await expect(panel.getByText('Registration has closed.', { exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Close registration now', exact: true })).toHaveCount(0);

  // AC6: a later closing time reopens it, and that is announced too.
  await page.setViewportSize({ width: 390, height: 900 });
  await form.getByLabel('Closes (Singapore time)', { exact: true }).fill('2030-07-18T18:00');
  await form.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(panel.getByText('Registration is open.', { exact: true })).toBeVisible();
  await expect(panel.getByText('18 Jul 2030, 18:00 SGT', { exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  // AC9: every change is in the event history with who made it.
  const stored = await ledger(page);
  expect(stored.event).toMatchObject({ registration_capacity: 150, registration_closes_at: '2030-07-18T10:00:00.000Z' });
  expect(stored.audit.map(row => [row.actor_id, row.field_name, row.old_value])).toEqual([
    ['user-organiser', 'registration_capacity', '80'],
    ['user-organiser', 'registration_closes_at', '2030-07-19T02:00:00.000Z'],
    ['user-organiser', 'registration_closes_at', stored.audit[1].new_value],
  ]);
  expect(stored.notifications.map(row => [row.recipient_id, row.kind, row.message])).toEqual([
    ['user-organiser', 'registration_closed', 'Registration for Harbour Lecture was closed early by the organiser.'],
    ['user-coordinator', 'registration_closed', 'Registration for Harbour Lecture was closed early by the organiser.'],
    ['user-organiser', 'registration_opened', 'Registration for Harbour Lecture is now open.'],
    ['user-coordinator', 'registration_opened', 'Registration for Harbour Lecture is now open.'],
  ]);

  // AC10: the coordinator's bell carries both notices.
  await signIn(page, 'coordinator');
  await page.getByRole('button', { name: 'Notifications (2)', exact: true }).click();
  const inbox = page.getByRole('complementary', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('Registration closed', { exact: true })).toBeVisible();
  await expect(inbox.getByText('Registration for Harbour Lecture is now open.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('SG2-63-P02 | [NORMAL] [SG2-63:AC3] [SG2-63:AC4] [SG2-63:AC8] the coordinator sees the picture with contact details but cannot change it, and a colleague sees names only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'coordinator');
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: /Harbour Lecture/ }).click();
  const pane = page.getByRole('article', { name: 'Event request' });
  const panel = pane.getByRole('region', { name: 'Registration', exact: true });
  await expect(panel.getByTestId('registration-count')).toHaveText('2');
  await expect(panel.getByRole('link', { name: 'attendee@example.test', exact: true })).toBeVisible();
  await expect(panel.getByText('Only the organiser who created this event can change its registration settings.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('form', { name: 'Registration settings' })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);

  // AC8: the planning drawer shows the settings without inputs for them.
  await pane.getByRole('button', { name: 'Edit Planning Information', exact: true }).click();
  const settings = page.getByTestId('epd-registration-settings');
  await expect(settings).toContainText('80');
  await expect(settings).toContainText('19 Jul 2030, 10:00 SGT');
  await expect(settings).toContainText('Set by the event organiser.');
  await expect(page.getByLabel('Registration Capacity', { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'colleague');
  const colleague = await openAsOrganiser(page);
  await expect(colleague.getByTestId('registration-count')).toHaveText('2');
  await expect(colleague.getByText('Regression attendee')).toBeVisible();
  await expect(colleague.getByText('attendee@example.test')).toHaveCount(0);
  await expect(colleague.getByText('Contact details are shown only to the organiser who created this event and its coordinator.', { exact: true })).toBeVisible();
  await expect(colleague.getByRole('form', { name: 'Registration settings' })).toHaveCount(0);
});

test('SG2-63-N01 | [FAILURE] [CONFLICT] [SG2-63:AC3] [SG2-63:AC5] [SG2-63:AC6] [SG2-63:AC8] only the creating organiser changes the settings, and only with valid times', async ({ page }) => {
  const [organiser, colleague, outsider, coordinator, attendee] = await Promise.all(
    ['organiser', 'colleague', 'organiser2', 'coordinator', 'attendee'].map(account => auth(page, account)));
  const settings = (headers: Record<string, string>, data: unknown) =>
    page.request.patch('/api/event-requests/631/registration-settings', { headers, data });

  // AC8 (replaces SG2-39 AC4): the coordinator's planning route refuses the settings.
  const planning = await page.request.patch('/api/event-requests/631/planning', { headers: coordinator, data: { registration_capacity: 500 } });
  expect([planning.status(), await planning.json()]).toEqual([403, {
    error: 'Registration capacity and opening and closing times are set by the Event Organiser.', fields: ['registration_capacity'],
  }]);
  expect((await settings(coordinator, { registration_capacity: 500 })).status()).toBe(403);
  const byColleague = await settings(colleague, { registration_capacity: 500 });
  expect([byColleague.status(), (await byColleague.json()).error])
    .toEqual([403, 'Only the organiser who created this event can change its registration settings.']);

  // AC3: another organisation learns nothing; attendees have no access.
  expect((await page.request.get('/api/event-requests/631/registrations', { headers: outsider })).status()).toBe(404);
  expect((await page.request.get('/api/event-requests/631/registrations', { headers: attendee })).status()).toBe(403);

  // AC5: a closing time after the event starts, or already past, is refused.
  const late = await settings(organiser, { registration_closes_at: '2030-07-20T02:00:00.000Z' });
  expect([late.status(), (await late.json()).details]).toEqual([400, ['Registration must close before the event starts.']]);
  const past = await settings(organiser, { registration_closes_at: '2026-01-01T00:00:00.000Z' });
  expect([past.status(), (await past.json()).details]).toEqual([400, [
    'Registration must close after it opens.',
    'A new closing time must be in the future. Use Close registration now to close it immediately.',
  ]]);

  // AC6: closing twice is refused the second time.
  expect((await page.request.post('/api/event-requests/631/registration-settings/close', { headers: organiser })).status()).toBe(200);
  const again = await page.request.post('/api/event-requests/631/registration-settings/close', { headers: organiser });
  expect([again.status(), (await again.json()).error]).toEqual([409, 'Registration is not open, so it cannot be closed early.']);

  const stored = await ledger(page);
  expect(stored.event.registration_capacity).toBe(80);
  expect(stored.audit.map(row => row.field_name)).toEqual(['registration_closes_at']);
});
