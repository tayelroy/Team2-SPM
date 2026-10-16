import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';

// Real React/Express interactions on a resettable local fixture. The native
// integration suite independently verifies the transactional Postgres RPC.
test.use({ timezoneId: 'Asia/Singapore', trace: 'on', video: 'on' });

type Draft = {
  name: string; purpose: string; description: string; proposed_date: string;
  expected_attendance: number; venue_requirements: string; accessibility_needs: string | null;
  equipment_requirements: string; registration_needed: boolean;
};
type Entry = {
  log_id: number; event_id: number; actor_id: string; actor_name: string; actor_role: string;
  field_name: string; old_value: string | null; new_value: string | null; created_at: string;
};
const initial: Draft = {
  name: 'Draft History Workshop', purpose: 'Plan the first workshop', description: 'Initial workshop description',
  proposed_date: '2030-07-01T02:00:00.000Z', expected_attendance: 12, venue_requirements: 'Projector',
  accessibility_needs: 'Step-free entrance', equipment_requirements: 'Two microphones', registration_needed: false,
};
const revised: Draft = {
  name: 'Revised Draft History Workshop', purpose: 'Plan the revised workshop', description: 'Revised workshop description',
  proposed_date: '2030-07-02T03:00:00.000Z', expected_attendance: 18, venue_requirements: 'Projector and stage',
  accessibility_needs: null, equipment_requirements: 'Three microphones', registration_needed: true,
};

async function nav(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
async function signIn(page: Page, account = 'organiser') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open app', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Regression123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('banner')).toBeVisible();
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
}
async function headers(page: Page) {
  return { Authorization: `Bearer ${await page.evaluate(() => JSON.parse(sessionStorage.getItem('connectsphere.session')!).accessToken)}` };
}
async function withAccount<T>(request: APIRequestContext, account: string, action: (auth: Record<string, string>) => Promise<T>) {
  const login = await request.post('/api/auth/login', { data: { email: `${account}@example.test`, password: 'Regression123!' } });
  expect(login.status()).toBe(200);
  const auth = { Authorization: `Bearer ${(await login.json()).accessToken}` };
  try { return await action(auth); }
  finally { expect((await request.post('/api/auth/logout', { headers: auth })).status()).toBe(200); }
}
async function fill(page: Page, values: Draft) {
  for (const [label, value] of Object.entries({ 'Event name': values.name, Purpose: values.purpose,
    Description: values.description, 'Expected attendance': String(values.expected_attendance),
    'Venue requirements': values.venue_requirements })) {
    await page.getByLabel(new RegExp(`^${label}`)).fill(value);
  }
  const local = new Date(Date.parse(values.proposed_date) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
  await page.getByLabel(/^Date/).fill(local);
  await page.getByLabel('Accessibility needs (optional)', { exact: true }).fill(values.accessibility_needs ?? '');
  await page.getByLabel('Equipment requirements', { exact: true }).fill(values.equipment_requirements);
  const registration = page.getByRole('button', { name: 'Registration needed', exact: true });
  if ((await registration.getAttribute('aria-pressed')) !== String(values.registration_needed)) await registration.click();
}
async function save(page: Page, id?: number) {
  const response = page.waitForResponse(result => result.request().method() === (id ? 'PATCH' : 'POST')
    && new URL(result.url()).pathname === `/api/event-requests${id ? `/${id}` : ''}`);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(id ? 200 : 201);
  const data = await result.json();
  await expect(page.getByText(new RegExp(`Draft ${data.request.event_id} saved`))).toBeVisible();
  return data.request as Draft & { event_id: number; status: string };
}
async function editDraft(page: Page, name: string) {
  await nav(page, 'My drafts');
  const region = page.getByRole('region', { name: 'My draft requests', exact: true });
  const card = region.locator('div').filter({ has: page.getByRole('heading', { name, exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) }).last();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel(/^Event name/)).toHaveValue(name);
}
async function history(page: Page, id: number): Promise<Entry[]> {
  const response = await page.request.get(`/api/event-requests/${id}/history`, { headers: await headers(page) });
  expect(response.status()).toBe(200);
  return (await response.json()).history;
}
async function openHistory(page: Page, name: string) {
  await nav(page, 'My events');
  await page.getByRole('button', { name: `View ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'View Change History', exact: true }).click();
  return page.getByRole('dialog', { name: 'Event Change History', exact: true });
}
async function screenshot(page: Page, info: TestInfo, name: string, drawer?: Locator) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  if (drawer) await drawer.evaluate(element => { element.scrollTop = 0; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (drawer) expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await info.attach(name, { body: await page.screenshot({ fullPage: !drawer }), contentType: 'image/png' });
  if (drawer && await drawer.evaluate(element => element.scrollHeight > element.clientHeight)) {
    await drawer.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await info.attach(`${name}-bottom`, { body: await page.screenshot(), contentType: 'image/png' });
  }
}
function watchConsole(page: Page) {
  const issues: string[] = [];
  page.on('pageerror', error => issues.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) issues.push(message.text()); });
  return issues;
}
function text(value: unknown) { return value === null ? null : String(value); }

test.beforeEach(async ({ request }) => {
  expect((await request.post('/__e2e/reset')).status()).toBe(204);
});

test('SG2-40-P02 | [NORMAL] [BOUNDARY] [SG2-29:AC1] [SG2-29:AC2] [SG2-31:AC3] [SG2-40:AC1] [SG2-40:AC2] revising all nine saved draft fields records the exact organiser old and new values and reopens them intact', async ({ page }, info) => {
  const issues = watchConsole(page);
  let id = 0;
  await test.step('Create a real draft, leave the form and reopen its stored nine fields', async () => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await nav(page, 'New request');
    await fill(page, initial);
    const created = await save(page);
    id = created.event_id;
    expect(created).toMatchObject({ ...initial, status: 'draft' });
    expect(await history(page, id)).toEqual([]);
    await page.reload();
    await editDraft(page, initial.name);
    await expect(page.getByLabel(/^Expected attendance/)).toHaveValue('12');
    await expect(page.getByLabel(/^Description/)).toHaveValue(initial.description);
    await expect(page.getByLabel(/^Date/)).toHaveValue('2030-07-01T10:00');
    await screenshot(page, info, 'draft-nine-fields-before-edit-390');
  });
  let entries: Entry[] = [];
  await test.step('Change every supported field and verify one exact audit record per real change', async () => {
    await fill(page, revised);
    const saved = await save(page, id);
    expect(saved).toMatchObject({ ...revised, status: 'draft' });
    entries = await history(page, id);
    expect(entries).toHaveLength(9);
    expect(new Set(entries.map(entry => entry.field_name))).toEqual(new Set(Object.keys(revised)));
    for (const entry of entries) {
      const key = entry.field_name as keyof Draft;
      expect(entry).toMatchObject({ event_id: id, actor_id: 'user-organiser', actor_name: 'Regression organiser', actor_role: 'Event Organiser' });
      expect(Number.isFinite(Date.parse(entry.created_at))).toBe(true);
      if (key === 'proposed_date') {
        expect(Date.parse(entry.old_value!)).toBe(Date.parse(initial.proposed_date));
        expect(Date.parse(entry.new_value!)).toBe(Date.parse(revised.proposed_date));
      } else {
        expect(entry.old_value).toBe(text(initial[key])); expect(entry.new_value).toBe(text(revised[key]));
      }
    }
    expect(entries.map(entry => entry.created_at)).toEqual(entries.map(entry => entry.created_at).sort().reverse());
    await page.reload();
    await editDraft(page, revised.name);
    await expect(page.getByLabel(/^Expected attendance/)).toHaveValue('18');
    await expect(page.getByLabel(/^Description/)).toHaveValue(revised.description);
    await expect(page.getByLabel('Accessibility needs (optional)', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Registration needed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  await test.step('The actual change-history drawer renders actor, Singapore time and old/new values at both widths', async () => {
    const drawer = await openHistory(page, revised.name);
    await expect(drawer.getByTestId(/^audit-entry-/)).toHaveCount(9);
    for (const entry of entries) {
      const row = drawer.getByTestId(`audit-entry-${entry.log_id}`);
      await expect(row).toContainText('Regression organiser'); await expect(row).toContainText('Event Organiser');
      await expect(row).toContainText('SGT');
      await expect(row.getByTestId('diff-old')).toHaveText(entry.old_value ?? '(empty)');
      await expect(row.getByTestId('diff-new')).toHaveText(entry.new_value ?? '(empty)');
    }
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await screenshot(page, info, `draft-nine-field-audit-${width}`, drawer);
    }
    expect(issues).toEqual([]);
  });
});

test('SG2-40-N02 | [BOUNDARY] [CONFLICT] [FAILURE] [SG2-29:AC1] [SG2-40:AC2] [SG2-40:AC3] [SG2-25:AC1] [SG2-25:AC2] [SG2-25:AC3] unchanged and refused draft saves add no phantom history and other accounts cannot read the audit', async ({ page, request }, info) => {
  const issues = watchConsole(page);
  await signIn(page);
  await editDraft(page, 'Planning workshop');
  const auth = await headers(page);
  const before = await history(page, 1);
  const detail = await (await request.get('/api/event-requests/1', { headers: auth })).json();
  await test.step('An unchanged form save and an equivalent timestamp keep the audit byte-identical', async () => {
    await save(page, 1);
    expect(await history(page, 1)).toEqual(before);
    const equivalent = await request.patch('/api/event-requests/1', { headers: auth,
      data: { ...detail.request, proposed_date: '2030-06-15T10:00:00+08:00' } });
    expect(equivalent.status()).toBe(200);
    expect(await history(page, 1)).toEqual(before);
  });
  await test.step('Invalid and other-owner edits are refused without altering stored values or audit', async () => {
    const invalid = await request.patch('/api/event-requests/1', { headers: auth, data: { ...detail.request, expected_attendance: 0 } });
    expect(invalid.status()).toBe(400);
    await withAccount(request, 'colleague', async colleague => {
      expect((await request.patch('/api/event-requests/1', { headers: colleague, data: { ...detail.request, description: 'Not the creator' } })).status()).toBe(404);
      expect((await request.get('/api/event-requests/1/history', { headers: colleague })).status()).toBe(403);
    });
    await withAccount(request, 'attendee', async attendee => {
      expect((await request.get('/api/event-requests/1/history', { headers: attendee })).status()).toBe(403);
    });
    expect((await request.get('/api/event-requests/1/history')).status()).toBe(401);
    const after = await request.get('/api/event-requests/1', { headers: auth });
    expect((await after.json()).request).toEqual(detail.request);
    expect(await history(page, 1)).toEqual(before);
  });
  await test.step('The owner sees an honest empty history rather than fabricated changes', async () => {
    const drawer = await openHistory(page, 'Planning workshop');
    await expect(drawer.getByText('No change history recorded for this event yet.', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await screenshot(page, info, 'unchanged-draft-empty-history-390', drawer);
    expect(issues).toEqual([]);
  });
});

test('SG2-40-P03 | [NORMAL] [SG2-36:AC1] [SG2-36:AC2] [SG2-36:AC3] [SG2-40:AC1] [SG2-40:AC2] an explicit clarification revision records the organiser field changes while retaining the coordinator conversation and review history', async ({ page, request }, info) => {
  const issues = watchConsole(page);
  await test.step('The coordinator explicitly returns the reviewed event for clarification', async () => {
    expect((await request.post('/__e2e/under-review')).status()).toBe(204);
    await signIn(page, 'coordinator');
    await page.getByRole('region', { name: 'Awaiting review' }).getByRole('button', { name: /Decision Forum/ }).click();
    const thread = page.getByRole('region', { name: 'Clarification conversation' });
    await thread.getByLabel('Ask the organiser a question').fill('Please confirm attendance and describe the revised session.');
    await thread.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('needs clarification', { exact: true })).toBeVisible();
    await signOut(page);
  });
  await test.step('The organiser answers and saves the returned event with two audited field changes', async () => {
    await signIn(page);
    await nav(page, 'My events');
    await page.getByRole('button', { name: 'View Decision Forum', exact: true }).click();
    const thread = page.getByRole('region', { name: 'Clarification conversation' });
    await thread.getByLabel('Answer your coordinator').fill('Attendance is now 34 and the session includes a demonstration.');
    await thread.getByRole('button', { name: 'Send', exact: true }).click();
    await editDraft(page, 'Decision Forum');
    await page.getByLabel(/^Expected attendance/).fill('34');
    await page.getByLabel(/^Description/).fill('Revised session with a demonstration.');
    expect((await save(page, 52)).status).toBe('needs_clarification');
    const entries = await history(page, 52);
    expect(entries.filter(entry => entry.field_name !== 'status').map(entry => [entry.field_name, entry.old_value, entry.new_value]).sort()).toEqual([
      ['description', 'A planning workshop.', 'Revised session with a demonstration.'], ['expected_attendance', '20', '34'],
    ]);
    for (const entry of entries.filter(entry => entry.field_name !== 'status')) {
      expect(entry).toMatchObject({ actor_id: 'user-organiser', actor_name: 'Regression organiser', actor_role: 'Event Organiser' });
    }
    expect(entries).toContainEqual(expect.objectContaining({ actor_id: 'user-coordinator', field_name: 'status', old_value: 'under_review', new_value: 'needs_clarification' }));
    const drawer = await openHistory(page, 'Decision Forum');
    await expect(drawer.getByTestId(/^audit-entry-/)).toHaveCount(3);
    await page.setViewportSize({ width: 1440, height: 900 });
    await screenshot(page, info, 'clarification-revision-retained-history-1440', drawer);
    await page.getByRole('button', { name: 'Close change history', exact: true }).click();
  });
  await test.step('Resubmission adds only its real status transition and retains both conversation messages', async () => {
    await editDraft(page, 'Decision Forum');
    await page.getByRole('button', { name: 'Submit request', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Decision Forum has been submitted for review.' })).toBeVisible();
    const entries = await history(page, 52);
    expect(entries.filter(entry => entry.field_name !== 'status')).toHaveLength(2);
    expect(entries).toContainEqual(expect.objectContaining({ actor_id: 'user-organiser', field_name: 'status', old_value: 'needs_clarification', new_value: 'submitted' }));
    const messages = page.getByRole('region', { name: 'Clarification conversation' }).getByRole('list', { name: 'Messages' });
    await expect(messages.getByRole('listitem')).toHaveCount(2);
    await expect(messages).toContainText('Please confirm attendance and describe the revised session.');
    await expect(messages).toContainText('Attendance is now 34 and the session includes a demonstration.');
    expect(issues).toEqual([]);
  });
});
