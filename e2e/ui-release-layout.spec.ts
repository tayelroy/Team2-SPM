import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Browser-captured release evidence from the isolated local fixture. These
// files are screenshots of the application under test, never generated art.
const evidenceDirectory = resolve('test-results/release-evidence');

async function saveEvidence(page: Page, name: string) {
  mkdirSync(evidenceDirectory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`), animations: 'disabled' });
}

async function expectInsideViewport(control: Locator, label: string) {
  await expect(control, label).toBeVisible();
  const bounds = await control.boundingBox();
  expect(bounds, `${label} has browser layout bounds`).not.toBeNull();
  expect(bounds!.x, `${label} starts inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width, `${label} ends inside the viewport`).toBeLessThanOrEqual(
    await control.evaluate(() => document.documentElement.clientWidth),
  );
}

async function signIn(page: Page, account: string) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('banner').getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
}

test.beforeEach(async ({ request, baseURL }) => {
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
});

test('UI-RELEASE-01 | [NORMAL] [SG2-96:release-layout] the mobile and desktop landing footer remain reachable through native scrolling', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  for (const viewport of [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const heading = page.getByRole('heading', { name: 'Exceptional Events Begin with the Perfect Space', exact: true });
    await expectInsideViewport(heading, `${viewport.name} landing heading`);
    await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // The landing uses ordinary browser scrolling: an overflow container and
    // an untransformed content track, so touch, keyboard and scrollbar work.
    const scrolling = await page.locator('footer').evaluate(footer => {
      const track = footer.parentElement!;
      const scroller = track.parentElement! as HTMLElement;
      return {
        overflowY: getComputedStyle(scroller).overflowY,
        trackTransform: getComputedStyle(track).transform,
        scrollTop: scroller.scrollTop,
      };
    });
    expect(['auto', 'scroll']).toContain(scrolling.overflowY);
    expect(scrolling.trackTransform).toBe('none');
    expect(scrolling.scrollTop).toBe(0);
    await saveEvidence(page, `landing-${viewport.name}-hero`);

    const copyright = page.getByText('©2026 ConnectSphere', { exact: true });
    await copyright.scrollIntoViewIfNeeded();
    await expect(copyright).toBeInViewport();
    expect(await page.locator('footer').evaluate(footer => (footer.parentElement!.parentElement! as HTMLElement).scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await saveEvidence(page, `landing-${viewport.name}-footer`);
  }
  expect(errors).toEqual([]);
});

test('UI-RELEASE-02 | [NORMAL] [SG2-96:release-layout] authenticated mobile headers stay compact and the native nav row scrolls and clicks', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });

  // The attendee lands on authenticated data, not the retired prototype.
  await signIn(page, 'attendee');
  await expect(page.getByRole('heading', { level: 1, name: 'Find events', exact: true })).toBeVisible();
  const attendeeBanner = page.getByRole('banner');
  const attendeeHeader = await attendeeBanner.boundingBox();
  expect(attendeeHeader).not.toBeNull();
  expect(attendeeHeader!.height, 'attendee mobile header height').toBeLessThanOrEqual(160);
  await expect(attendeeBanner.getByRole('navigation').getByRole('button')).toHaveText(['Find events', 'My registrations']);
  await expectInsideViewport(attendeeBanner.getByRole('button', { name: /^Notifications/ }), 'attendee notifications');
  await expectInsideViewport(attendeeBanner.getByRole('button', { name: 'Profile', exact: true }), 'attendee profile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await saveEvidence(page, 'signed-in-header-attendee-mobile-390');

  // A role with more destinations proves the navigation itself remains a
  // native horizontal scroll region and its off-screen buttons are operable.
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  await signIn(page, 'coordinator');
  const banner = page.getByRole('banner');
  const navigation = banner.getByRole('navigation');
  const mobileHeader = await banner.boundingBox();
  expect(mobileHeader).not.toBeNull();
  expect(mobileHeader!.height, 'coordinator mobile header height').toBeLessThanOrEqual(160);
  const dimensions = await navigation.evaluate(element => ({
    overflowX: getComputedStyle(element).overflowX,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(['auto', 'scroll']).toContain(dimensions.overflowX);
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  await navigation.evaluate(element => element.scrollTo({ left: element.scrollWidth, behavior: 'instant' }));
  expect(await navigation.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await navigation.getByRole('button', { name: 'Find an event', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Find an event', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await saveEvidence(page, 'signed-in-header-coordinator-mobile-390');

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopHeader = await banner.boundingBox();
  expect(desktopHeader).not.toBeNull();
  expect(desktopHeader!.height, 'desktop header height').toBeLessThanOrEqual(160);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await saveEvidence(page, 'signed-in-header-coordinator-desktop-1440');
  expect(errors).toEqual([]);
});

test('UI-RELEASE-03 | [NORMAL] [SG2-96:release-layout] venue editing and organiser requests use readable compact forms on desktop and mobile', async ({ page, request }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  for (const viewport of [
    { name: 'desktop-1440', width: 1440, height: 1000 },
    { name: 'mobile-390', width: 390, height: 844 },
  ]) {
    expect((await request.post('/__e2e/reset')).status()).toBe(204);
    // This catalogue setup belongs only to the resettable local fixture.
    const login = await request.post('/api/auth/login', {
      data: { email: 'venue@example.test', password: 'Regression123!' },
    });
    expect(login.status()).toBe(200);
    expect((await request.put('/api/venues/1/layouts', {
      headers: { Authorization: `Bearer ${(await login.json()).accessToken}` },
      data: { layouts: [{ layout: 'theatre' }, { layout: 'classroom' }] },
    })).status()).toBe(200);
    await page.setViewportSize(viewport);
    await signIn(page, 'venue');
    await page.getByRole('navigation').getByRole('button', { name: 'Catalogue', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Regression Hall', exact: true }).click();
    const venueForm = page.getByRole('form', { name: 'Edit venue', exact: true });
    await expect(venueForm.getByRole('checkbox', { name: 'Theatre', exact: true })).toBeChecked();
    await expect(venueForm.getByRole('checkbox', { name: 'Classroom', exact: true })).toBeChecked();
    await expectInsideViewport(venueForm.getByLabel('Venue name', { exact: true }), `${viewport.name} venue name`);
    await expectInsideViewport(venueForm.getByLabel('Operating information', { exact: true }), `${viewport.name} operating information`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await venueForm.getByLabel('Venue name', { exact: true }).scrollIntoViewIfNeeded();
    await saveEvidence(page, `venue-edit-${viewport.name}-fields`);

    await venueForm.getByRole('checkbox', { name: 'Other', exact: true }).check();
    await venueForm.getByLabel('Describe the other layout', { exact: true }).fill('U-shaped tables with a clear centre aisle');
    for (const checkbox of await venueForm.getByRole('checkbox').all()) {
      await expectInsideViewport(checkbox, `${viewport.name} layout checkbox`);
      const bounds = (await checkbox.boundingBox())!;
      expect(bounds.width, 'checkbox keeps its compact control size').toBeLessThanOrEqual(24);
      expect(bounds.height, 'checkbox keeps its compact control size').toBeLessThanOrEqual(24);
    }
    await expectInsideViewport(venueForm.getByLabel('Describe the other layout', { exact: true }), `${viewport.name} other layout description`);
    await venueForm.getByRole('checkbox', { name: 'Theatre', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await saveEvidence(page, `venue-edit-${viewport.name}-layouts`);

    await signIn(page, 'organiser');
    await page.getByRole('navigation').getByRole('button', { name: 'New request', exact: true }).click();
    await expect(page.getByText('What happens next', { exact: true })).toBeVisible();
    await expectInsideViewport(page.getByLabel(/^Event name/), `${viewport.name} request name`);
    await expectInsideViewport(page.getByLabel(/^Purpose/), `${viewport.name} request purpose`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByText('What happens next', { exact: true }).scrollIntoViewIfNeeded();
    await saveEvidence(page, `organiser-request-${viewport.name}-guidance`);
    await page.getByRole('button', { name: 'Save draft', exact: true }).scrollIntoViewIfNeeded();
    await expectInsideViewport(page.getByRole('button', { name: 'Save draft', exact: true }), `${viewport.name} save draft`);
    await expectInsideViewport(page.getByRole('button', { name: 'Submit request', exact: true }), `${viewport.name} submit request`);
    await expect(page.getByRole('button', { name: 'Submit request', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await saveEvidence(page, `organiser-request-${viewport.name}-actions`);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
