import { expect, test, type Page } from '@playwright/test';
import type { RequirementsView } from '../server/src/db/equipmentRequirements';

async function signIn(page: Page, account = 'coordinator') {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function auth(page: Page) {
  return { Authorization: `Bearer ${await page.evaluate(() => JSON.parse(sessionStorage.getItem('connectsphere.session')!).accessToken)}` };
}
async function asRole(page: Page, account: string) {
  const result = await page.request.post('/api/auth/login', { data: { email: `${account}@example.test`, password: 'Regression123!' } });
  expect(result.status()).toBe(200);
  return { Authorization: `Bearer ${(await result.json()).accessToken}` };
}
async function view(page: Page): Promise<RequirementsView> {
  const response = await page.request.get('/api/equipment-requests?event_id=53', { headers: await auth(page) });
  expect(response.status()).toBe(200);
  return response.json();
}
async function openEvent(page: Page) {
  await page.getByRole('button', { name: /Equipment Requirements Forum/ }).click();
  await expect(page.getByRole('region', { name: 'Equipment requirements', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add equipment requirement', exact: true })).toBeVisible();
}
async function fillRequest(page: Page, equipment = '1', quantity = '4', notes = 'Four handheld microphones for the panel.') {
  await page.getByRole('combobox', { name: 'Equipment type', exact: true }).selectOption(equipment);
  await page.getByRole('textbox', { name: 'Quantity required', exact: true }).fill(quantity);
  await page.getByRole('textbox', { name: 'Technical notes', exact: true }).fill(notes);
}
async function createRequest(page: Page) {
  await page.getByRole('button', { name: 'Add equipment requirement', exact: true }).click();
  await fillRequest(page);
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByText('Equipment requirement saved.', { exact: true })).toBeVisible();
}
const microphone = (page: Page) => page.getByRole('article', { name: 'Equipment requirement: Wireless microphones', exact: true });
const empty = { request_id: 1, event_id: 53, equipment_id: 1, equipment_type: 'Wireless microphones', quantity: 4,
  notes: 'Four handheld microphones for the panel.', status: 'pending', arrangement_notes: null, shortfall: null,
  placement_venue_id: null, placement_venue_name: null, placement_position: null, version: 1 };

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
  expect((await request.post('/__e2e/equipment-requirements')).status()).toBe(204);
});

test('SG2-53-P01 | [NORMAL] [SG2-53:AC1] [SG2-53:AC2] [SG2-53:AC4] [SG2-53:AC5] [SG2-53:AC6] coordinator requests reach support and saved shortfall and placement return to the coordinator', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page); await openEvent(page); await createRequest(page);
  expect((await view(page)).requests).toEqual([empty]);
  await page.reload(); await openEvent(page);
  await expect(microphone(page)).toContainText('Four handheld microphones for the panel.');
  await expect(microphone(page).getByText('Not recorded', { exact: true })).toHaveCount(4);

  await signIn(page, 'support');
  await page.getByRole('button', { name: /Wireless microphones/ }).click();
  await page.getByRole('button', { name: 'Update arrangement for Wireless microphones', exact: true }).click();
  await page.getByRole('textbox', { name: 'Arrangement notes', exact: true }).fill('Two units still need arranging.');
  await page.getByRole('textbox', { name: 'Shortfall quantity', exact: true }).fill('2');
  await page.getByRole('combobox', { name: 'Placement venue', exact: true }).selectOption('1');
  await page.getByRole('textbox', { name: 'Placement position', exact: true }).fill('Stage left, clear of emergency exit.');
  await page.getByRole('button', { name: 'Save equipment arrangement', exact: true }).click();
  await expect(page.getByText('Equipment arrangement saved.', { exact: true })).toBeVisible();
  const arranged = { ...empty, arrangement_notes: 'Two units still need arranging.', shortfall: 2,
    placement_venue_id: 1, placement_venue_name: 'Regression Hall', placement_position: 'Stage left, clear of emergency exit.', version: 2 };
  expect((await view(page)).requests).toEqual([arranged]);
  const stock = await page.request.get('/api/equipment', { headers: await auth(page) });
  expect((await stock.json()).equipment.find((item: { equipment_id: number }) => item.equipment_id === 1)).toMatchObject({ quantity_held: 20, version: 1, available_quantity: 20 });
  const safety = await asRole(page, 'safety');
  const reviewed = await page.request.get('/api/equipment-requests?event_id=53', { headers: safety });
  expect((await reviewed.json()).requests).toEqual([arranged]);
  expect((await reviewed.json()).can_arrange).toBe(false);

  await signIn(page); await openEvent(page);
  await expect(microphone(page)).toContainText('Two units still need arranging.');
  await expect(microphone(page)).toContainText('Regression Hall');
  await expect(microphone(page)).toContainText('Stage left, clear of emergency exit.');
  if (process.env.SG2_53_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_53_SCREENSHOTS}/requirements-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Edit requirement for Wireless microphones', exact: true }).click();
  await expect(page.getByText(/Saving changes clears the previous arrangement update/)).toBeVisible();
  await fillRequest(page, '1', '6', 'Six handheld microphones for the revised panel.');
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByText('Equipment requirement saved.', { exact: true })).toBeVisible();
  expect((await view(page)).requests).toEqual([{ ...empty, quantity: 6, notes: 'Six handheld microphones for the revised panel.', version: 3 }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('SG2-53-P02 | [NORMAL] [BOUNDARY] [SG2-53:AC1] [SG2-53:AC5] [SG2-53:AC6] phone users save requirements and support shortfall while missing placement is Not recorded', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page); await openEvent(page);
  await page.getByRole('button', { name: 'Add equipment requirement', exact: true }).click();
  await fillRequest(page, '2', '1', 'One HDMI projector, despite stock under maintenance.');
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByText('Equipment requirement saved.', { exact: true })).toBeVisible();
  await signIn(page, 'support');
  await page.getByRole('button', { name: /Portable projector/ }).click();
  await page.getByRole('button', { name: 'Update arrangement for Portable projector', exact: true }).click();
  await page.getByRole('textbox', { name: 'Arrangement notes', exact: true }).fill('Replacement projector needed.');
  await page.getByRole('textbox', { name: 'Shortfall quantity', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save equipment arrangement', exact: true }).click();
  await expect(page.getByText('Equipment arrangement saved.', { exact: true })).toBeVisible();
  const card = page.getByRole('article', { name: 'Equipment requirement: Portable projector', exact: true });
  await expect(card.getByText('Not recorded', { exact: true })).toHaveCount(2);
  expect((await view(page)).requests[0]).toEqual({ ...empty, equipment_id: 2, equipment_type: 'Portable projector', quantity: 1,
    notes: 'One HDMI projector, despite stock under maintenance.', arrangement_notes: 'Replacement projector needed.', shortfall: 1, version: 2 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SG2_53_SCREENSHOTS) await page.screenshot({ path: `${process.env.SG2_53_SCREENSHOTS}/requirements-mobile.png`, fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: /Portable projector/ }).click();
  await expect(card).toContainText('Replacement projector needed.');
});

test('SG2-53-B01 | [BOUNDARY] [FAILURE] [SG2-53:AC3] zero and fractional quantities are refused and a corrected positive quantity saves', async ({ page }) => {
  await signIn(page); await openEvent(page);
  await page.getByRole('button', { name: 'Add equipment requirement', exact: true }).click();
  await fillRequest(page, '1', '0');
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('whole-number quantity from 1');
  expect((await view(page)).requests).toEqual([]);
  const response = await page.request.post('/api/equipment-requests', { headers: await auth(page), data: { event_id: 53, equipment_id: 1, quantity: 0.5 } });
  expect(response.status()).toBe(400);
  await page.getByRole('textbox', { name: 'Quantity required', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByText('Equipment requirement saved.', { exact: true })).toBeVisible();
  expect((await view(page)).requests).toEqual([{ ...empty, quantity: 1 }]);
});

test('SG2-53-C01 | [CONFLICT] [SG2-53:AC2] [SG2-53:AC5] a stale coordinator save preserves the newer support update and duplicate requests are refused', async ({ page }) => {
  await signIn(page); await openEvent(page); await createRequest(page);
  const duplicate = await page.request.post('/api/equipment-requests', { headers: await auth(page), data: { event_id: 53, equipment_id: 1, quantity: 9 } });
  expect(duplicate.status()).toBe(409);
  await page.getByRole('button', { name: 'Edit requirement for Wireless microphones', exact: true }).click();
  await fillRequest(page, '1', '5', 'A stale coordinator draft.');
  const support = await asRole(page, 'support');
  const update = await page.request.patch('/api/equipment-requests/1/arrangement', { headers: support,
    data: { event_id: 53, version: 1, arrangement_notes: 'New support arrangement.', shortfall: 2, placement_venue_id: 1, placement_position: 'Front row' } });
  expect(update.status()).toBe(200);
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Reload requirements');
  await expect(page.getByRole('textbox', { name: 'Quantity required', exact: true })).toHaveValue('5');
  expect((await view(page)).requests).toEqual([{ ...empty, version: 2, arrangement_notes: 'New support arrangement.', shortfall: 2,
    placement_venue_id: 1, placement_venue_name: 'Regression Hall', placement_position: 'Front row' }]);
  await page.getByRole('button', { name: 'Reload requirements', exact: true }).click();
  await expect(microphone(page)).toContainText('New support arrangement.');
});

test('SG2-53-N01 | [FAILURE] [SG2-53:AC1] [SG2-53:AC5] [SG2-53:AC6] role guards refuse unauthorized requests and outages retain drafts for retry', async ({ page }) => {
  expect((await page.request.get('/api/equipment-requests?event_id=53')).status()).toBe(401);
  await signIn(page); await openEvent(page);
  expect((await page.request.get('/api/equipment-requests?event_id=1', { headers: await auth(page) })).status()).toBe(404);
  for (const role of ['attendee', 'venue', 'safety', 'support']) {
    expect((await page.request.post('/api/equipment-requests', { headers: await asRole(page, role), data: { event_id: 53, equipment_id: 1, quantity: 4 } })).status()).toBe(403);
  }
  await page.getByRole('button', { name: 'Add equipment requirement', exact: true }).click();
  await fillRequest(page);
  await page.route('**/api/equipment-requests', route => route.fulfill({ status: 503, json: { error: 'Private database detail must not be shown' } }));
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to reach');
  await expect(page.getByRole('textbox', { name: 'Technical notes', exact: true })).toHaveValue(empty.notes);
  await expect(page.getByText('Private database detail must not be shown')).toHaveCount(0);
  await page.unroute('**/api/equipment-requests');
  await page.getByRole('button', { name: 'Save equipment requirement', exact: true }).click();
  await expect(page.getByText('Equipment requirement saved.', { exact: true })).toBeVisible();
  expect((await view(page)).requests).toEqual([empty]);
});
