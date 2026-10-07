import { test, expect, type Page } from '@playwright/test';
import type { EquipmentRecord } from '../server/src/equipment/fields';

const values = { type: 'Browser projectors', description: 'Portable HDMI projectors', quantity_held: 7,
  location: 'North technical store', operational_status: 'operational' };

async function signIn(page: Page, account = 'support') {
  await page.clock.setFixedTime('2026-10-07T01:00:00.000Z');
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}

async function headers(page: Page) {
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('connectsphere.session')!).accessToken);
  return { Authorization: `Bearer ${token}` };
}

async function openEquipment(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Equipment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipment records', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add equipment', exact: true })).toBeVisible();
}

async function fillEquipment(page: Page, input = values) {
  await page.getByLabel('Equipment type', { exact: true }).fill(input.type);
  await page.getByLabel('Description', { exact: true }).fill(input.description);
  await page.getByLabel('Quantity held', { exact: true }).fill(String(input.quantity_held));
  await page.getByLabel('Location', { exact: true }).fill(input.location);
  await page.getByRole('combobox', { name: 'Operational status', exact: true }).selectOption(input.operational_status);
}

async function records(page: Page): Promise<EquipmentRecord[]> {
  const response = await page.request.get('/api/equipment', { headers: await headers(page) });
  expect(response.status()).toBe(200);
  return (await response.json()).equipment;
}

function card(page: Page, type: string) {
  return page.getByRole('article', { name: type, exact: true });
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
});

test('SG2-52-P01 | [SG2-52:AC1] [NORMAL] support staff create, update and reload every equipment field on phone and desktop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await openEquipment(page);
  await page.getByRole('button', { name: 'Add equipment', exact: true }).click();
  await fillEquipment(page);
  await page.getByRole('button', { name: 'Save equipment', exact: true }).click();
  await expect(page.getByText('Browser projectors saved.', { exact: true })).toBeVisible();
  await expect(card(page, values.type)).toContainText('Portable HDMI projectors');
  await expect(card(page, values.type)).toContainText('North technical store');
  expect((await records(page)).find(row => row.type === values.type)).toEqual({ ...values,
    equipment_id: 2, available_quantity: 7, version: 1 });

  const edited = { type: 'Conference displays', description: 'Large mobile conference displays', quantity_held: 4,
    location: 'South technical store', operational_status: 'maintenance' };
  await page.getByRole('button', { name: `Edit ${values.type}`, exact: true }).click();
  await fillEquipment(page, edited);
  await page.getByRole('button', { name: 'Save equipment', exact: true }).click();
  await expect(page.getByText('Conference displays saved.', { exact: true })).toBeVisible();
  await page.reload();
  await openEquipment(page);
  await expect(card(page, values.type)).toHaveCount(0);
  await expect(card(page, edited.type)).toContainText('Large mobile conference displays');
  await expect(card(page, edited.type)).toContainText('South technical store');
  await expect(card(page, edited.type)).toContainText('Under maintenance');
  expect((await records(page)).find(row => row.equipment_id === 2)).toEqual({ ...edited,
    equipment_id: 2, available_quantity: 0, version: 2 });
  expect((await records(page)).find(row => row.equipment_id === 1)).toMatchObject({ type: 'Wireless microphones', quantity_held: 20, version: 1 });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    await expect(card(page, edited.type)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page).toHaveURL('http://127.0.0.1:4173/');
    await expect(page).toHaveTitle(/ConnectSphere/i);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    if (process.env.SG2_52_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_52_SCREENSHOTS}/equipment-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: `Edit ${edited.type}`, exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.getByLabel('Equipment type', { exact: true })).toHaveValue(edited.type);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.SG2_52_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_52_SCREENSHOTS}/equipment-edit-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  expect(errors).toEqual([]);
});

test('SG2-52-P02 | [SG2-52:AC2] [NORMAL] damaged and maintenance stock remain held but contribute no available quantity', async ({ page }) => {
  await signIn(page);
  const auth = await headers(page);
  for (const input of [
    { ...values, type: 'Working projectors', quantity_held: 7, operational_status: 'operational' },
    { ...values, type: 'Damaged projectors', quantity_held: 3, operational_status: 'damaged' },
    { ...values, type: 'Serviced projectors', quantity_held: 5, operational_status: 'maintenance' },
  ]) expect((await page.request.post('/api/equipment', { headers: auth, data: input })).status()).toBe(201);
  await openEquipment(page);
  const fact = (type: string, label: string) => card(page, type).getByText(label, { exact: true }).locator('..').locator('span').last();
  for (const [type, held, available, status] of [
    ['Working projectors', '7', '7', 'Operational'],
    ['Damaged projectors', '3', '0', 'Damaged'],
    ['Serviced projectors', '5', '0', 'Under maintenance'],
  ]) {
    await expect(fact(type, 'Quantity held')).toHaveText(held);
    await expect(fact(type, 'Available quantity')).toHaveText(available);
    await expect(fact(type, 'Operational status')).toHaveText(status);
  }
  await page.getByRole('button', { name: 'Edit Damaged projectors', exact: true }).click();
  await page.getByRole('combobox', { name: 'Operational status', exact: true }).selectOption('operational');
  await page.getByRole('button', { name: 'Save equipment', exact: true }).click();
  await expect(fact('Damaged projectors', 'Available quantity')).toHaveText('3');
  expect((await records(page)).find(row => row.type === 'Damaged projectors')).toMatchObject({ quantity_held: 3, available_quantity: 3, version: 2 });
});

test('SG2-52-N01 | [SG2-52:AC1] [BOUNDARY] [FAILURE] zero and the maximum whole quantity save while incomplete and out-of-range records are refused', async ({ page }) => {
  await signIn(page);
  await openEquipment(page);
  await page.getByRole('button', { name: 'Add equipment', exact: true }).click();
  await page.getByRole('button', { name: 'Save equipment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Complete every field.');
  expect(await page.getByLabel('Equipment type', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  expect(await records(page)).toHaveLength(1);
  await fillEquipment(page, { ...values, type: 'No spare displays', quantity_held: 0 });
  await page.getByRole('button', { name: 'Save equipment', exact: true }).click();
  await expect(page.getByText('No spare displays saved.', { exact: true })).toBeVisible();
  expect((await records(page)).find(row => row.type === 'No spare displays')).toMatchObject({ quantity_held: 0, available_quantity: 0 });
  const auth = await headers(page);
  expect((await page.request.post('/api/equipment', { headers: auth, data: { ...values, quantity_held: 2147483647 } })).status()).toBe(201);
  for (const quantity_held of [-1, 0.5, 2147483648]) {
    const refused = await page.request.post('/api/equipment', { headers: auth, data: { ...values, quantity_held } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toContain('non-negative whole-number quantity');
  }
  expect(await records(page)).toHaveLength(3);
});

test('SG2-52-C01 | [SG2-52:AC1] [CONFLICT] rapid save sends one request and a stale editor cannot overwrite a newer record', async ({ page }) => {
  await signIn(page);
  await openEquipment(page);
  await page.getByRole('button', { name: 'Add equipment', exact: true }).click();
  await fillEquipment(page);
  // Hold only transport dispatch; the request continues to the real API/store.
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let saves = 0;
  await page.route('**/api/equipment', async route => {
    if (route.request().method() === 'POST') { saves += 1; await pending; }
    await route.continue();
  });
  const save = page.getByRole('button', { name: /^(Save equipment|Saving…)$/ });
  await save.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(save).toBeDisabled();
  await expect.poll(() => saves).toBe(1);
  release();
  await expect(page.getByText('Browser projectors saved.', { exact: true })).toBeVisible();
  await page.unroute('**/api/equipment');
  expect((await records(page)).filter(row => row.type === values.type)).toHaveLength(1);

  await page.getByRole('button', { name: `Edit ${values.type}`, exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Unsaved stale edit');
  const changed = await page.request.patch('/api/equipment/2', { headers: await headers(page),
    data: { ...values, quantity_held: 9, description: 'Saved by another staff session', version: 1 } });
  expect(changed.status()).toBe(200);
  await page.getByRole('button', { name: 'Save equipment', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('This record changed while you were editing. Reload records before editing again.');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Unsaved stale edit');
  await expect(page.getByRole('button', { name: 'Save equipment', exact: true })).toBeDisabled();
  expect((await records(page)).find(row => row.equipment_id === 2)).toMatchObject({ quantity_held: 9,
    description: 'Saved by another staff session', version: 2 });
  await page.getByRole('button', { name: 'Reload records', exact: true }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveCount(0);
  await expect(card(page, values.type)).toContainText('Saved by another staff session');
  await page.getByRole('button', { name: `Edit ${values.type}`, exact: true }).click();
  await expect(page.getByLabel('Quantity held', { exact: true })).toHaveValue('9');
});

test('SG2-52-N02 | [SG2-52:AC3] [FAILURE] every other role and unsigned caller are denied equipment writes by the API', async ({ page }) => {
  for (const account of ['organiser', 'coordinator', 'venue', 'attendee', 'lead', 'safety']) {
    await signIn(page, account);
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Equipment', exact: true })).toHaveCount(0);
    const auth = await headers(page);
    expect((await page.request.post('/api/equipment', { headers: auth, data: values })).status()).toBe(403);
    expect((await page.request.patch('/api/equipment/1', { headers: auth, data: { ...values, version: 1 } })).status()).toBe(403);
  }
  expect((await page.request.post('/api/equipment', { data: values })).status()).toBe(401);
  expect((await page.request.patch('/api/equipment/1', { data: { ...values, version: 1 } })).status()).toBe(401);
  await signIn(page);
  expect(await records(page)).toHaveLength(1);
  expect((await records(page))[0]).toMatchObject({ type: 'Wireless microphones', quantity_held: 20, version: 1 });
});
