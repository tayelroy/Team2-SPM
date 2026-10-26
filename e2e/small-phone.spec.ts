import { expect, test, type Locator, type Page } from '@playwright/test';

// SG2-96 walkthrough finding: the other phone checks use 390px. At 320px (the
// narrowest common phone) a grid track wider than the screen made the request
// form and the attendee pages scroll sideways. Every role's pages must fit.

async function signIn(page: Page, account: string) {
  await page.goto('/'); await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function fullyInsidePhone(control: Locator, description: string) {
  await expect(control, description).toBeVisible();
  const bounds = await control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewport: document.documentElement.clientWidth };
  });
  expect(bounds.width, `${description} has a usable width`).toBeGreaterThan(0);
  expect(bounds.left, `${description} starts inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds.right, `${description} ends inside the viewport`).toBeLessThanOrEqual(bounds.viewport);
}

test('SG2-71-B01 | [BOUNDARY] [SG2-71:AC1] [SG2-71:AC2] every role\'s pages fit a 320px phone without sideways scrolling', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 568 });
  const visited: string[] = [];
  for (const account of ['organiser', 'coordinator', 'lead', 'venue', 'support', 'safety', 'attendee']) {
    expect((await request.post('/__e2e/reset')).status()).toBe(204);
    await signIn(page, account);
    await expect(page.getByRole('banner').getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
    const nav = page.getByRole('banner').getByRole('navigation').getByRole('button');
    const labels = (await nav.allTextContents()).map(label => label.trim());
    expect(labels.length, `${account} has navigation`).toBeGreaterThan(0);
    for (const label of labels) {
      await page.getByRole('banner').getByRole('navigation').getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('banner').getByRole('navigation').getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await sideways(page), `${account} › ${label} scrolls sideways at 320px`).toBeLessThanOrEqual(0);
      visited.push(`${account} › ${label}`);
    }
  }
  // The organiser's request form is the longest phone form (SG2-71 AC2).
  expect(visited).toContain('organiser › New request');

  // Single-role pages previously passed while the extra role selector pushed
  // Profile off-screen. Exercise the three shared-account combinations, both
  // held roles and the actual header controls at the two narrow phone sizes.
  for (const [account, combination] of [
    ['venue', 'venue-coordinator'],
    ['coordinator', 'coordinator-attendee'],
    ['organiser', 'organiser-coordinator'],
  ]) {
    expect((await request.post('/__e2e/reset')).status()).toBe(204);
    expect((await request.post('/__e2e/multi-role', { data: { combination } })).status()).toBe(204);
    await signIn(page, account);
    const banner = page.getByRole('banner');
    const acting = banner.getByRole('combobox', { name: 'Acting as', exact: true });
    const roles = await acting.locator('option').allTextContents();
    expect(roles).toHaveLength(2);
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 812 });
      for (const role of roles) {
        await fullyInsidePhone(acting, `${account} role selector at ${width}px`);
        if (await acting.inputValue() !== role) await acting.selectOption({ label: role });
        await expect(banner.getByLabel('Your role', { exact: true })).toHaveText(role);
        await expect(banner.getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
        const roleAction = { 'Event Coordinator': 'Find an event', 'Venue Staff': 'Capacity exceptions',
          'Event Organiser': 'New request', Attendee: 'Find events' }[role];
        await expect(banner.getByRole('navigation').getByRole('button', { name: roleAction, exact: true })).toBeVisible();
        expect(await sideways(page), `${account} as ${role} scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
        const profile = banner.getByRole('button', { name: 'Profile', exact: true });
        await fullyInsidePhone(profile, `${account} Profile as ${role} at ${width}px`);
        await profile.click();
        const myProfile = page.getByRole('button', { name: 'My Profile', exact: true });
        await fullyInsidePhone(myProfile, `${account} profile menu at ${width}px`);
        await myProfile.click();
        await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
        const notifications = banner.getByRole('button', { name: /^Notifications/ });
        await fullyInsidePhone(notifications, `${account} Notifications as ${role} at ${width}px`);
        await notifications.click();
        await expect(notifications).toHaveAttribute('aria-expanded', 'true');
        await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
        await expect(notifications).toHaveAttribute('aria-expanded', 'false');
        await expect(banner.getByRole('navigation').getByRole('button', { name: roleAction, exact: true })).toBeVisible();
        if (account === 'venue' && width === 320 && role === 'Event Coordinator') {
          const screenshot = test.info().outputPath('multi-role-header-320.png');
          await page.screenshot({ path: screenshot });
          await test.info().attach('multi-role-header-320', { path: screenshot, contentType: 'image/png' });
        }
      }
    }
  }
  expect(errors).toEqual([]);
});
