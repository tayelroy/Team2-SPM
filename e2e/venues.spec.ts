import { test, expect, type Page } from '@playwright/test';

const values = {
  name: 'Cove Studio', location: 'West wing', capacity: 80,
  facilities: 'Projector', accessibility_features: 'Step-free entrance', operating_information: '09:00–18:00'
};
const staffHeaders = { Authorization: 'Bearer test-staff' };

async function fillVenue(page: Page) {
  await page.getByRole('button', { name: 'Add venue', exact: true }).click();
  await page.getByLabel('Venue name', { exact: true }).fill(values.name);
  await page.getByLabel('Location', { exact: true }).fill(values.location);
  await page.getByLabel('Capacity', { exact: true }).fill(String(values.capacity));
  await page.getByLabel('Facilities', { exact: true }).fill(values.facilities);
  await page.getByLabel('Accessibility features', { exact: true }).fill(values.accessibility_features);
  await page.getByLabel('Operating information', { exact: true }).fill(values.operating_information);
}

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__test/reset')).status()).toBe(204);
});

test('SG2-42-P01: staff create, edit and search a venue; saved details survive reload', async ({ page }) => {
  await page.goto('/');
  await fillVenue(page);
  await page.getByRole('button', { name: 'Create venue', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Cove Studio saved. The catalogue is up to date.');
  await page.getByRole('button', { name: 'Edit Cove Studio', exact: true }).click();
  await page.getByLabel('Facilities', { exact: true }).fill('Piano, projector');
  await page.getByLabel('Capacity', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cove Studio saved.');
  await page.reload();
  await page.getByRole('searchbox', { name: 'Search venues' }).fill('piano');
  await expect(page.getByText('1 of 2 venues', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cove Studio', exact: true })).toBeVisible();
  await expect(page.getByText('Piano, projector', { exact: true })).toBeVisible();
  await expect(page.getByText('120', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atrium Hall', exact: true })).toHaveCount(0);
});

test('SG2-42-N01: coordinator cannot create/edit, including direct and forged requests', async ({ page, request }) => {
  await page.goto('/?actor=coordinator');
  await expect(page.getByRole('heading', { name: 'Atrium Hall', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add venue', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  const forged = { ...values, role: 'venue_staff' };
  const headers = { Authorization: 'Bearer test-coordinator' };
  expect((await request.post('/api/venues', { headers, data: forged })).status()).toBe(403);
  expect((await request.put('/api/venues/1', { headers, data: forged })).status()).toBe(403);
  expect((await request.post('/api/venues', { data: values })).status()).toBe(401);
  await page.reload();
  await expect(page.getByText('1 of 1 venues', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Atrium Hall', exact: true })).toBeVisible();
  await expect(page.getByText('100', { exact: true })).toBeVisible();
});

test('SG2-42-B01: capacity accepts 1 and 2147483647; rejects 0, fractions and overflow', async ({ page, request }) => {
  await page.goto('/');
  await fillVenue(page);
  const capacity = page.getByLabel('Capacity', { exact: true });
  for (const invalid of [0, 1.5, 2147483648]) {
    await capacity.fill(String(invalid));
    await page.getByRole('button', { name: 'Create venue', exact: true }).click();
    // Native constraint validation stays in the form and marks the field invalid.
    expect(await capacity.evaluate(input => (input as HTMLInputElement).validity.valid)).toBe(false);
    await expect(page.getByRole('form', { name: 'Add venue', exact: true })).toBeVisible();
    expect((await request.post('/api/venues', { headers: staffHeaders, data: { ...values, capacity: invalid } })).status()).toBe(400);
  }
  expect((await (await request.get('/api/venues', { headers: staffHeaders })).json()).venues).toHaveLength(1);
  await capacity.fill('1');
  await page.getByRole('button', { name: 'Create venue', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cove Studio saved.');
  await page.getByRole('button', { name: 'Edit Cove Studio', exact: true }).click();
  await expect(page.getByLabel('Capacity', { exact: true })).toHaveValue('1');
  await page.getByLabel('Capacity', { exact: true }).fill('2147483647');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Cove Studio saved.');
  await page.reload();
  await expect(page.getByText('2147483647', { exact: true })).toBeVisible();
});

test('SG2-42-B02: name accepts 255 characters and rejects 256 without saving', async ({ page, request }) => {
  await page.goto('/');
  await fillVenue(page);
  await page.getByLabel('Venue name', { exact: true }).fill('V'.repeat(256));
  await page.getByRole('button', { name: 'Create venue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('keep the name within 255 characters');
  expect((await request.post('/api/venues', { headers: staffHeaders, data: { ...values, name: 'V'.repeat(256) } })).status()).toBe(400);
  expect((await (await request.get('/api/venues', { headers: staffHeaders })).json()).venues).toHaveLength(1);
  await page.getByLabel('Venue name', { exact: true }).fill('V'.repeat(255));
  await page.getByRole('button', { name: 'Create venue', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved.');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'V'.repeat(255), exact: true })).toBeVisible();
});
