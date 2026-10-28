import { expect, test, type Page } from '@playwright/test';

// SG2-59: an attendee finds the confirmed events open, or opening, for
// registration and reads their attendee-facing details.

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
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/registrable-events')).status()).toBe(204);
});

test('SG2-59-P01 | [NORMAL] [SG2-59:AC1] [SG2-59:AC2] [SG2-59:AC3] an attendee finds the events open or opening for registration and opens one without seeing planning details', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, 'attendee');
  await page.getByRole('navigation').getByRole('button', { name: 'Find events', exact: true }).click();

  // AC1: open and upcoming events, soonest first, with name, date, time and venue.
  const list = page.getByRole('region', { name: 'Events open for registration', exact: true });
  const cards = list.getByRole('article');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAccessibleName('Bayfront Workshop');
  await expect(cards.nth(0)).toContainText('Opening soon');
  await expect(cards.nth(0)).toContainText('RegistrationOpens 1 Jun 2030, 8:00 am');
  await expect(cards.nth(0)).toContainText('VenueTo be announced');
  const lecture = cards.nth(1);
  await expect(lecture).toHaveAccessibleName('Harbour Lecture');
  await expect(lecture).toContainText('Date and time20 Jul 2030, 7:00 pm');
  await expect(lecture).toContainText('VenueRegression Hall');
  await expect(lecture).toContainText('Registration open');
  await expect(lecture).toContainText('RegistrationCloses 19 Jul 2030, 10:00 am');

  // AC2: closed, unconfirmed and walk-in events are not listed.
  for (const hidden of ['Closed Briefing', 'Planning Forum', 'Walk-in Social', 'Planning workshop']) {
    await expect(list.getByText(hidden)).toHaveCount(0);
  }
  expect(await noOverflow(page)).toBe(true);

  // AC3: the details are attendee-facing only.
  await lecture.getByRole('button', { name: 'View details', exact: true }).click();
  const detail = page.getByRole('article', { name: 'Harbour Lecture', exact: true });
  await expect(detail).toContainText('An evening lecture on the harbour’s history, with questions after.');
  await expect(detail).toContainText('CategorySeminar');
  await expect(detail).toContainText('Hosted byHarbour Foundation');
  await expect(detail.getByRole('region', { name: 'Venue', exact: true }).getByRole('listitem')).toHaveText(['Regression Hall, Level 1']);
  for (const internal of ['Brief security on the VIP entrance', 'Grow the foundation’s donor list', 'Regression coordinator',
    'Projector', 'A room with seating', 'Classroom', 'Confirmed']) {
    await expect(detail.getByText(internal)).toHaveCount(0);
  }
  const body = await (await page.request.get('/api/registrable-events/591', { headers: await auth(page, 'attendee') })).json();
  // SG2-60 added 'registered': whether this attendee already holds a place;
  // SG2-61 'full' and 'waiting': whether every place is taken and where they stand on its list.
  expect(Object.keys(body.event).sort()).toEqual(['category', 'description', 'event_id', 'full', 'name', 'organisation', 'proposed_date',
    'registered', 'registration_closes_at', 'registration_opens_at', 'venues', 'waiting']);

  await page.setViewportSize({ width: 390, height: 900 });
  await expect(detail).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await detail.getByRole('button', { name: 'Back to events', exact: true }).click();
  await expect(cards).toHaveCount(2);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('SG2-59-N01 | [FAILURE] [SG2-59:AC1] [SG2-59:AC2] unlisted events do not open for an attendee, and other roles cannot browse', async ({ page }) => {
  const attendee = await auth(page, 'attendee');
  for (const eventId of [593, 594, 595, 1, 9999]) {
    const response = await page.request.get(`/api/registrable-events/${eventId}`, { headers: attendee });
    expect([eventId, response.status(), await response.json()]).toEqual([eventId, 404, { error: 'This event is not open for registration.' }]);
  }
  for (const account of ['organiser', 'coordinator', 'lead']) {
    const headers = await auth(page, account);
    for (const path of ['/api/registrable-events', '/api/registrable-events/591']) {
      const response = await page.request.get(path, { headers });
      expect([account, path, response.status()]).toEqual([account, path, 403]);
    }
  }
  await signIn(page, 'organiser');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Find events', exact: true })).toHaveCount(0);
});
