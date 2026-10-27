import { expect, test, type Page } from '@playwright/test';

// SG2-102: registered attendees are told when their event changes. SG2-66's
// Harbour Showcase is Confirmed with three registrations: `attendee` and
// `colleague` hold places and `organiser2` withdrew. Its sample change
// requests move the date a week (attendees see it) or raise the attendance
// (they do not).

async function signIn(page: Page, account: string) {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
type Notice = { recipient_id: string; kind: string; message: string };
async function changeNotices(page: Page): Promise<Notice[]> {
  const stored = await (await page.request.get('/__e2e/change-impact-ledger')).json() as { notifications: Notice[] };
  return stored.notifications.filter(row => row.kind === 'event_changed');
}
async function acceptSample(page: Page, sample: 'date' | 'attendance') {
  await signIn(page, 'coordinator');
  await page.getByRole('region', { name: 'My assigned events' }).getByRole('button', { name: /Harbour Showcase/ }).click();
  const request = page.getByTestId(`change-request-mock-661-${sample}`);
  await request.getByRole('button', { name: 'Accept change', exact: true }).click();
  await expect(page.getByTestId(`change-request-mock-661-${sample}`)).toHaveCount(0);
}
const inbox = (page: Page) => page.getByRole('complementary', { name: 'Notifications' });
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const DATE_NOTICE = 'Harbour Showcase has changed. Date and time: 20 Jun 2030 10:00 SGT → 27 Jun 2030 10:00 SGT.'
  + ' Open My registrations for the latest details.';

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/change-impact')).status()).toBe(204);
});

test('SG2-102-P01 | [SG2-102:AC1] [SG2-102:AC2] [SG2-102:AC3] [SG2-102:AC4] [NORMAL] an accepted date change tells each registered attendee the old and new date, skips the one who withdrew, and My registrations shows the new date', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await acceptSample(page, 'date');

  // AC1-AC3: one notice for each active registration, none for the withdrawal.
  const notices = await changeNotices(page);
  expect(notices.map(row => row.recipient_id).sort()).toEqual(['user-attendee', 'user-colleague']);
  expect(notices.every(row => row.message === DATE_NOTICE)).toBe(true);

  // AC2/AC4: the attendee reads it and goes on to the updated registration.
  await signIn(page, 'attendee');
  await page.getByRole('button', { name: /^Notifications \(/ }).click();
  const drawer = inbox(page);
  await expect(drawer.getByText('Event changed', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: `Unread: ${DATE_NOTICE}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Harbour Showcase', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View my registrations', exact: true }).click();
  const mine = page.getByRole('region', { name: 'Registrations', exact: true });
  const showcase = mine.getByRole('article', { name: 'Harbour Showcase', exact: true });
  await expect(showcase).toContainText('27 Jun 2030');
  await expect(showcase).not.toContainText('20 Jun 2030');
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('SG2-102-N01 | [SG2-102:AC5] [SG2-102:AC3] [BOUNDARY] an accepted change to internal planning information sends attendees nothing, at phone width', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await acceptSample(page, 'attendance');

  // AC5: attendance is not something attendees see.
  expect(await changeNotices(page)).toEqual([]);
  await signIn(page, 'attendee');
  await page.getByRole('button', { name: /^Notifications \(/ }).click();
  await expect(inbox(page).getByText('Event changed', { exact: true })).toHaveCount(0);
  await expect(inbox(page).getByText(/Harbour Showcase has changed/)).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});
