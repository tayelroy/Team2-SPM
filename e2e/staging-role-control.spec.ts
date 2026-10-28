import { expect, test, type Page } from '@playwright/test';
import actingRoleControl from '../.github/scripts/acting-role-control.cjs';

const { roleControlKind, getCurrentRole, getHeldRoles, selectActingRole } = actingRoleControl;

test('SG2-104-R03 | [BOUNDARY] [FAILURE] [SG2-104:AC4] the single-role staging header stays readable and cannot be switched to another role', async ({ page }) => {
  await page.setContent('<header><span aria-label="Your role">Safety Officer</span><button>Profile</button></header><main><h1>Safety desk</h1></main>');
  expect(await roleControlKind(page)).toBe('single');
  expect(await getCurrentRole(page)).toBe('Safety Officer');
  expect(await getHeldRoles(page)).toEqual(['Safety Officer']);
  await page.getByRole('button', { name: 'Profile', exact: true }).focus();
  expect(await selectActingRole(page, 'Safety Officer')).toBe(false);
  await expect(page.getByRole('button', { name: 'Profile', exact: true })).toBeFocused();
  await expect(selectActingRole(page, 'Event Coordinator')).rejects.toThrow('not listed by this account');
  expect(await getCurrentRole(page)).toBe('Safety Officer');
  await expect(page.getByRole('combobox')).toHaveCount(0);
});

async function signIn(page: Page, account: string) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
}

const navigationFor: Record<string, string> = {
  'Event Organiser': 'New request', 'Event Coordinator': 'Find an event',
  'Venue Staff': 'Capacity exceptions', Attendee: 'Find events',
};

test('SG2-104-R04 | [NORMAL] [CONFLICT] [FAILURE] [SG2-104:AC1] [SG2-104:AC2] the staging adapter reads and switches all three real custom account combinations while current-role selection leaves the screen alone', async ({ page, request }) => {
  test.setTimeout(60_000);
  const cases = [
    { account: 'venue', combination: 'venue-coordinator', roles: ['Event Coordinator', 'Venue Staff'] },
    { account: 'coordinator', combination: 'coordinator-attendee', roles: ['Attendee', 'Event Coordinator'] },
    { account: 'organiser', combination: 'organiser-coordinator', roles: ['Event Organiser', 'Event Coordinator'] },
  ];
  const listbox = page.getByRole('listbox', { name: 'Available roles', exact: true });
  const trigger = page.getByRole('combobox', { name: 'Acting as', exact: true });
  for (const { account, combination, roles } of cases) {
    expect((await request.post('/__e2e/reset')).status()).toBe(204);
    expect((await request.post('/__e2e/multi-role', { data: { combination } })).status()).toBe(204);
    await signIn(page, account);
    expect(await roleControlKind(page)).toBe('custom');
    expect((await getHeldRoles(page)).sort()).toEqual([...roles].sort());
    await expect(listbox).toHaveCount(0);
    // Enumeration also closes a menu that was already open when called.
    await trigger.click();
    await expect(listbox).toBeVisible();
    expect((await getHeldRoles(page)).sort()).toEqual([...roles].sort());
    await expect(listbox).toHaveCount(0);

    const current = await getCurrentRole(page);
    expect(roles).toContain(current);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'My Profile', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Profile', exact: true }).focus();
    expect(await selectActingRole(page, current)).toBe(false);
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
    await expect(listbox).toHaveCount(0);

    for (const role of roles) {
      const previous = await getCurrentRole(page);
      expect(await selectActingRole(page, role)).toBe(role !== previous);
      await expect(trigger).toHaveText(role);
      await expect(page.getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByRole('navigation').getByRole('button', { name: navigationFor[role], exact: true })).toBeVisible();
      expect(await getCurrentRole(page)).toBe(role);
      await expect(listbox).toHaveCount(0);
    }
    const selected = await getCurrentRole(page);
    await expect(selectActingRole(page, 'Safety Officer')).rejects.toThrow('not listed by this account');
    await expect(trigger).toHaveText(selected);
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
  }
});
