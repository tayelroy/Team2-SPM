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

async function fullyInsideViewport(control: Locator, description: string) {
  await expect(control, description).toBeVisible();
  const bounds = await control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: rect.width, viewport: document.documentElement.clientWidth, height: innerHeight };
  });
  expect(bounds.width, `${description} has a usable width`).toBeGreaterThan(0);
  expect(bounds.left, `${description} starts inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds.right, `${description} ends inside the viewport`).toBeLessThanOrEqual(bounds.viewport);
  expect(bounds.top, `${description} starts above the viewport`).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom, `${description} ends below the viewport`).toBeLessThanOrEqual(bounds.height);
}

const roleAction: Record<string, string> = { 'Event Coordinator': 'Find an event', 'Venue Staff': 'Capacity exceptions',
  'Event Organiser': 'New request', Attendee: 'Find events' };

async function expectRole(page: Page, role: string) {
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('combobox', { name: 'Acting as', exact: true })).toHaveText(role);
  await expect(banner.getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
  await expect(banner.getByRole('navigation').getByRole('button', { name: roleAction[role], exact: true })).toBeVisible();
}

test('SG2-71-B01 | [BOUNDARY] [SG2-71:AC1] [SG2-71:AC2] every role\'s pages fit a 320px phone without sideways scrolling', async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 568 });
  const visited: string[] = [];
  for (const account of ['organiser', 'coordinator', 'lead', 'venue', 'support', 'safety', 'attendee']) {
    expect((await request.post('/__e2e/reset')).status()).toBe(204);
    await signIn(page, account);
    await fullyInsideViewport(page.getByRole('banner').getByLabel('Your role', { exact: true }), `${account} current role at 320px`);
    await expect(page.getByRole('combobox', { name: 'Acting as', exact: true })).toHaveCount(0);
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
  // held roles and the styled open menu on narrow phones and desktop.
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
    const listbox = page.getByRole('listbox', { name: 'Available roles', exact: true });
    await acting.click();
    await expect(listbox).toBeVisible();
    const roles = (await listbox.getByRole('option').allTextContents()).map(label => label.trim());
    expect(roles).toHaveLength(2);
    await acting.press('Escape');
    await expect(listbox).toHaveCount(0);
    for (const [width, height] of [[320, 568], [375, 812], [390, 844], [768, 1024], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      for (const role of roles) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await fullyInsideViewport(acting, `${account} role selector at ${width}px`);
        await acting.click();
        await expect(acting).toHaveAttribute('aria-expanded', 'true');
        await fullyInsideViewport(page.locator('.role-switcher-menu'), `${account} open role menu at ${width}px`);
        await expect(listbox.getByRole('option')).toHaveCount(2);
        await expect(listbox.getByRole('option', { selected: true })).toHaveCount(1);
        for (const held of roles) {
          const option = listbox.getByRole('option', { name: held, exact: true });
          await fullyInsideViewport(option, `${account} ${held} option at ${width}px`);
          expect(await option.evaluate(element => element.scrollWidth <= element.clientWidth), `${held} is not clipped`).toBe(true);
        }
        if (role === roles[0]) {
          const screenshot = test.info().outputPath(`role-menu-${account}-${width}.png`);
          await page.screenshot({ path: screenshot });
          await test.info().attach(`role-menu-${account}-${width}`, { path: screenshot, contentType: 'image/png' });
        }
        await listbox.getByRole('option', { name: role, exact: true }).click();
        await expect(listbox).toHaveCount(0);
        await expect(acting).toHaveAttribute('aria-expanded', 'false');
        await expectRole(page, role);
        expect(await acting.getByText(role, { exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth), `${role} trigger text is not clipped`).toBe(true);
        expect(await sideways(page), `${account} as ${role} scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
        const profile = banner.getByRole('button', { name: 'Profile', exact: true });
        await fullyInsideViewport(profile, `${account} Profile as ${role} at ${width}px`);
        await profile.click();
        const myProfile = page.getByRole('button', { name: 'My Profile', exact: true });
        await fullyInsideViewport(myProfile, `${account} profile menu at ${width}px`);
        await myProfile.click();
        await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
        // Choosing the current role closes the menu without resetting this screen
        // or leaving the navigation waiting for permissions that will never reload.
        await acting.click();
        await expect(listbox.getByRole('option', { name: role, exact: true })).toHaveAttribute('aria-selected', 'true');
        await listbox.getByRole('option', { name: role, exact: true }).click();
        await expect(listbox).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
        await expectRole(page, role);
        const notifications = banner.getByRole('button', { name: /^Notifications/ });
        await fullyInsideViewport(notifications, `${account} Notifications as ${role} at ${width}px`);
        await notifications.click();
        await expect(notifications).toHaveAttribute('aria-expanded', 'true');
        await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
        await expect(notifications).toHaveAttribute('aria-expanded', 'false');
        await expectRole(page, role);
      }
    }
    // Keyboard navigation changes the active option, commits with Enter or
    // Tab, and cancels with Escape or a pointer outside the menu.
    await acting.press('ArrowDown');
    await expect(listbox).toBeVisible();
    const options = listbox.getByRole('option');
    const firstId = await options.first().getAttribute('id');
    const lastId = await options.last().getAttribute('id');
    await acting.press('Home');
    await expect(acting).toHaveAttribute('aria-activedescendant', firstId!);
    await acting.press('ArrowDown');
    await expect(acting).toHaveAttribute('aria-activedescendant', lastId!);
    await acting.press('ArrowUp');
    await expect(acting).toHaveAttribute('aria-activedescendant', firstId!);
    await acting.press('Enter');
    await expect(listbox).toHaveCount(0);
    await expectRole(page, roles[0]);
    await acting.press('End');
    await expect(listbox).toBeVisible();
    await expect(acting).toHaveAttribute('aria-activedescendant', await listbox.getByRole('option').last().getAttribute('id') ?? '');
    await acting.press('Enter');
    await expect(listbox).toHaveCount(0);
    await expectRole(page, roles[1]);
    await acting.press('ArrowUp');
    await expect(listbox).toBeVisible();
    await acting.press('Home');
    await acting.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expectRole(page, roles[1]);
    await expect(acting).toBeFocused();
    await acting.press('Home');
    await expect(listbox).toBeVisible();
    await expect(acting).toHaveAttribute('aria-activedescendant', await listbox.getByRole('option').first().getAttribute('id') ?? '');
    await acting.press('Tab');
    await expect(listbox).toHaveCount(0);
    await expectRole(page, roles[0]);
    await expect(acting).not.toBeFocused();
    if (roles[0][0] !== roles[1][0]) {
      await acting.press(roles[1][0].toLowerCase());
      await expect(listbox).toBeVisible();
      await expect(acting).toHaveAttribute('aria-activedescendant', await listbox.getByRole('option').last().getAttribute('id') ?? '');
      await acting.press('Enter');
      await expectRole(page, roles[1]);
    }
    const persistedRole = (await acting.innerText()).trim();
    await acting.click();
    await acting.press(persistedRole === roles[0] ? 'End' : 'Home');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(listbox).toHaveCount(0);
    await expectRole(page, persistedRole);
    await page.reload();
    await expectRole(page, persistedRole);
  }
  expect(errors).toEqual([]);
});
