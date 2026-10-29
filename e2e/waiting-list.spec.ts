import { expect, test, type Page } from '@playwright/test';

// SG2-61: refused when full, the waiting list; SG2-62 AC6: a freed place is offered to it.

async function signIn(page: Page, account: string) {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function openConcert(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Find events', exact: true }).click();
  const card = page.getByRole('article', { name: 'Chamber Concert', exact: true });
  await expect(card).toBeVisible();
  return card;
}
const ledger = async (page: Page) => (await page.request.get('/__e2e/waiting-list-ledger')).json();
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** The same screen at phone and laptop width: still visible, and nothing scrolls sideways. */
async function atBothWidths(page: Page, visible: () => ReturnType<Page['getByText']>) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 900 : 1000 });
    await expect(visible()).toBeVisible();
    expect(await noOverflow(page), `overflow at ${width}px`).toBe(true);
  }
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/waiting-list')).status()).toBe(204);
});

test('SG2-61-P01 | [NORMAL] [SG2-61:AC1] [SG2-61:AC4] [SG2-61:AC5] [SG2-61:AC7] [SG2-62:AC6] [SG2-61:AC3] a full event offers its waiting list; the organiser sees it and raises capacity, and the waiting attendee takes the place held for them', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  // AC1, AC5: the attendee sees the event is full, joins the list and sees their position.
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'attendee');
  let card = await openConcert(page);
  await expect(card.getByText('Full', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'View details', exact: true }).click();
  let registration = page.getByRole('region', { name: 'Registration', exact: true });
  await expect(registration.getByRole('alert')).toContainText('This event is full.');
  await expect(registration.getByRole('button', { name: 'Register', exact: true })).toHaveCount(0);
  await atBothWidths(page, () => registration.getByRole('button', { name: 'Join the waiting list', exact: true }));
  await registration.getByRole('button', { name: 'Join the waiting list', exact: true }).click();
  await atBothWidths(page, () => registration.getByText('You are number 1 on the waiting list.', { exact: true }));
  expect((await ledger(page)).entries).toEqual([expect.objectContaining({ attendee_id: 'user-attendee', status: 'waiting' })]);

  // AC7, AC4: the organiser sees the list and raises capacity above nothing in its way; the place is offered (SG2-62 AC6).
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'organiser');
  await page.getByRole('navigation').getByRole('button', { name: 'My events', exact: true }).click();
  await page.getByRole('button', { name: 'View Chamber Concert', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Registration', exact: true });
  const waiting = panel.getByRole('list', { name: 'Waiting list', exact: true }).getByRole('listitem');
  await expect(waiting).toHaveCount(1);
  await expect(waiting.first()).toContainText('Regression attendee');
  await atBothWidths(page, () => waiting.first().getByText('Waiting, number 1', { exact: true }));
  const form = panel.getByRole('form', { name: 'Registration settings', exact: true });
  await form.getByLabel('Capacity', { exact: true }).fill('2');
  await form.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Registration settings saved.');
  await atBothWidths(page, () => waiting.first().getByText(/^Place offered, held until/));

  // SG2-62 AC6: the attendee sees the place held for them and takes it; AC3: the event is now full again.
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, 'attendee');
  card = await openConcert(page);
  await expect(card.getByText('Place held for you', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'View details', exact: true }).click();
  registration = page.getByRole('region', { name: 'Registration', exact: true });
  await expect(registration.getByRole('status')).toContainText('A place has opened for you from the waiting list. It is held until');
  await atBothWidths(page, () => registration.getByRole('button', { name: 'Register', exact: true }));
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(registration.getByLabel('Contact phone')).not.toHaveValue('');
  await registration.getByRole('button', { name: 'Register', exact: true }).click();
  await atBothWidths(page, () => registration.getByText('You are registered. Your place is held.', { exact: true }));

  const stored = await ledger(page);
  expect(stored.entries).toEqual([expect.objectContaining({ attendee_id: 'user-attendee', status: 'registered' })]);
  expect(stored.notifications.filter((row: { kind: string }) => row.kind === 'waiting_list_offer')
    .map((row: { recipient_id: string }) => row.recipient_id)).toEqual(['user-attendee']);
  expect(stored.notifications.filter((row: { kind: string }) => row.kind === 'registration_full')
    .map(({ recipient_id, message }: Record<string, unknown>) => ({ recipient_id, message })))
    .toEqual(['user-organiser', 'user-coordinator'].map(recipient_id =>
      ({ recipient_id, message: 'Chamber Concert is now full: all places are taken (capacity 2).' })));
  expect(errors).toEqual([]);
});

test('SG2-61-N01 | [CONFLICT] [SG2-61:AC6] an attendee cannot join the waiting list twice, can leave it at any time, and leaving again is refused', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await page.request.post('/api/auth/login', { data: { email: 'attendee@example.test', password: 'Regression123!' } });
  const headers = { Authorization: `Bearer ${(await response.json()).accessToken}` };

  // Joining twice is refused with where they already stand; a second entry is never made.
  expect((await page.request.post('/api/registrable-events/611/waiting-list', { headers })).status()).toBe(201);
  const again = await page.request.post('/api/registrable-events/611/waiting-list', { headers });
  expect([again.status(), (await again.json()).reason]).toEqual([409, 'already']);
  expect((await ledger(page)).entries).toHaveLength(1);

  // Leaving from the event's details; afterwards the list can be joined again.
  // Seed the API state before mounting the attendee's authenticated catalogue.
  await signIn(page, 'attendee');
  const card = await openConcert(page);
  await atBothWidths(page, () => card.getByText('Waiting list #1', { exact: true }));
  await card.getByRole('button', { name: 'View details', exact: true }).click();
  const registration = page.getByRole('region', { name: 'Registration', exact: true });
  await registration.getByRole('button', { name: 'Leave the waiting list', exact: true }).click();
  await expect(registration.getByRole('alert')).toHaveText('You have left the waiting list.');
  await atBothWidths(page, () => registration.getByRole('button', { name: 'Join the waiting list', exact: true }));
  expect((await ledger(page)).entries).toEqual([expect.objectContaining({ status: 'left', ended_at: expect.any(String) })]);
  expect((await page.request.delete('/api/registrable-events/611/waiting-list', { headers })).status()).toBe(404);
});
