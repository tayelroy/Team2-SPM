import { test, expect, type Page } from '@playwright/test';

async function session(page: Page, token: string) {
  // Cached role deliberately forged. Only /api/auth/me may grant access.
  await page.addInitScript(value => sessionStorage.setItem('connectsphere.session', JSON.stringify({
    accessToken: value, user: { userId: 'forged-user', role: 'Technical Support Staff' }
  })), token);
}
test.beforeEach(async ({ request }) => { await request.post('/__test/reset'); });

test('SG2-25-P01: organiser opens a permitted page and the protected API creates their draft', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await session(page, 'test-organiser');
  await page.goto('/?screen=form');
  await expect(page).toHaveTitle(/ConnectSphere/);
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();
  await expect(page.getByLabel('Your role')).toHaveText('Event Organiser');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved — you can come back to it any time.')).toBeVisible();
  const result = await request.post('/api/event-requests', { headers: { Authorization: 'Bearer test-organiser' },
    data: { name: 'Authorization acceptance fixture', organiser_id: 'someone-else', status: 'Approved' } });
  expect(result.status()).toBe(201);
  const writes = await (await request.get('/__test/writes')).json();
  expect(writes).toHaveLength(1);
  expect(writes[0].organiserId).toBe('organiser-1');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('SG2-25-N01: forged cached roles and direct requests cannot bypass authorization', async ({ page, request }) => {
  await session(page, 'test-attendee');
  await page.goto('/?screen=form');
  await expect(page.getByRole('alert')).toContainText('Access denied');
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  for (const endpoint of ['/api/event-requests', '/api/users/someone-else/role']) {
    const result = await request.fetch(endpoint, { method: endpoint.includes('/users/') ? 'PATCH' : 'POST',
      headers: { Authorization: 'Bearer test-attendee' },
      data: { role: 'technical_support_staff', permissions: ['event_request.create', 'users.role.update'] } });
    expect(result.status()).toBe(403);
  }
  expect(await (await request.get('/__test/writes')).json()).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('alert')).toBeVisible();
});

test('SG2-25-N02: logged-out and expired sessions cannot open pages or execute actions', async ({ page, request }) => {
  await page.goto('/?screen=form');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect((await request.post('/api/event-requests', { data: {} })).status()).toBe(401);
  await session(page, 'test-organiser');
  await request.post('/__test/expire');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open app' })).toBeVisible();
  expect((await request.post('/api/event-requests', { headers: { Authorization: 'Bearer test-organiser' }, data: {} })).status()).toBe(401);
  expect(await (await request.get('/__test/writes')).json()).toEqual([]);
});

test('SG2-25-B01: a role downgrade revokes the next action without a new token', async ({ page, request }) => {
  await session(page, 'test-organiser');
  await page.goto('/?screen=form');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();
  await request.post('/__test/downgrade');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('alert')).toContainText('Access denied');
  await expect(page.getByLabel('Your role')).toHaveText('Attendee');
  await expect(page.getByText('Draft saved — you can come back to it any time.')).toHaveCount(0);
  expect((await request.post('/api/event-requests', { headers: { Authorization: 'Bearer test-organiser' }, data: {} })).status()).toBe(403);
  expect(await (await request.get('/__test/writes')).json()).toEqual([]);
});
