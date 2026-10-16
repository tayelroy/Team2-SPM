import { test, expect, type Page, type TestInfo } from '@playwright/test';
import policy from './policy.cjs';
const { HOSTED_ORIGIN, ROLES, allowedRequest, excludedDeploymentRequest, excludedDeploymentConsole, consoleIssue } = policy;
// User-requested recorded Playwright proof. No reset/APIRequestContext,
// sessionStorage, storageState, token inspection, HAR or trace is used.
test.describe.configure({ mode: 'serial' });
let batchStopped = false;
type Role = keyof typeof ROLES;

async function expectHostedRole(role: Role, page: Page, info: TestInfo) {
  if (batchStopped || process.env.SPM_HOSTED_QA_OPT_IN !== 'readonly' || !process.env.SPM_QA_PASSWORD) {
    throw new Error('Hosted batch requires explicit read-only opt-in and runtime credentials.');
  }
  const phase = (description: string) => { info.annotations.push({ type: 'hosted-phase', description }); };
  const diagnostic = (description: string) => {
    if (!info.annotations.some(a => a.type === 'hosted-flag' && a.description === description)) info.annotations.push({ type: 'hosted-flag', description });
    if (!info.annotations.some(a => a.type === 'hosted-cause')) info.annotations.push({ type: 'hosted-cause', description });
  };
  phase('preflight');
  let blocked = false;
  let unhealthy = false;
  let signedIn = false;
  let feedbackBlocked = false;
  let authenticatedBannerVisible = false;
  const account = ROLES[role];
  phase('route-guard');
  await page.context().route('**/*', async route => {
    if (batchStopped) { await route.abort('blockedbyclient'); return; }
    const request = route.request();
    if (excludedDeploymentRequest(request.url(), request.method(), request.resourceType())) {
      feedbackBlocked = true;
      if (!info.annotations.some(a => a.type === 'hosted-exclusion')) info.annotations.push({ type: 'hosted-exclusion', description: 'vercel-feedback-script-blocked' });
      await route.abort('blockedbyclient');
      return;
    }
    if (!allowedRequest(request.url(), request.method(), request.resourceType())) {
      diagnostic(new URL(request.url()).origin === HOSTED_ORIGIN ? 'write-blocked' : 'cross-origin-blocked');
      blocked = true; batchStopped = true;
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.context().routeWebSocket('**/*', socket => { diagnostic('websocket-blocked'); blocked = true; batchStopped = true; socket.close(); });
  page.on('pageerror', () => { diagnostic('page-exception'); unhealthy = true; });
  page.on('console', message => {
    if (excludedDeploymentConsole(message.type(), message.text(), message.location().url, feedbackBlocked)) return;
    if (message.type() === 'error') {
      if (info.annotations.filter(a => a.type === 'hosted-console-issue').length < 5) {
        const issue = consoleIssue(message.text(), message.location().url, authenticatedBannerVisible, [process.env.SPM_QA_PASSWORD ?? '', account.email]);
        info.annotations.push({ type: 'hosted-console-issue', description: JSON.stringify(issue) });
      }
      diagnostic('console-error'); unhealthy = true;
    }
  });
  page.on('requestfailed', request => {
    if (feedbackBlocked && excludedDeploymentRequest(request.url(), request.method(), request.resourceType())) return;
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') { diagnostic('network-failure'); unhealthy = true; batchStopped = true; }
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === HOSTED_ORIGIN && url.pathname.startsWith('/api/') && response.status() >= 400) {
      diagnostic('http-error');
      info.annotations.push({ type: 'hosted-http-status', description: String(response.status()) });
      unhealthy = true; batchStopped = true;
    }
  });
  const health = () => {
    expect(blocked, 'Only read-only requests and normal sign-in/logout may leave the browser.').toBe(false);
    expect(unhealthy, 'The rendered page and its read requests must be healthy.').toBe(false);
    if (new URL(page.url()).origin !== HOSTED_ORIGIN) diagnostic('origin-mismatch');
    expect(new URL(page.url()).origin).toBe(HOSTED_ORIGIN);
  };
  const settle = async () => {
    phase('page-settle');
    await expect(page.getByText(/^Loading\b|^Searching venues|^Checking for clashing bookings/)).toHaveCount(0);
    if (['organiser','coordinator','venue','support','lead'].includes(role)) {
      await expect(page.getByRole('button', { name: /^Notifications \(\d+\)$/, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Notifications (unavailable)', exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText(/Couldn't load|temporarily unavailable|Could not reach the server/)).toHaveCount(0);
    health();
  };
  const proof = async (name: string) => {
    await settle();
    phase('page-evidence');
    await expect(page.locator('vite-error-overlay, nextjs-portal')).toHaveCount(0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.evaluate(async () => { await document.fonts.ready; });
      const path = info.outputPath(`${role}-${name}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      await info.attach(`${role}-${name}-${width}`, { path, contentType: 'image/png' });
    }
    info.annotations.push({ type: 'hosted-page', description: name });
  };
  const history = async (id: number) => {
    phase('event-history');
    await page.getByRole('button', { name: 'View Change History', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Event Change History' })).toBeVisible();
    await expect(page.getByRole('heading', { name: `Change History — #${id}`, exact: true })).toBeVisible();
    await proof(`event-${id}-history`);
    await page.getByRole('button', { name: 'Close change history', exact: true }).click();
  };
  try {
    // Deliberately catch and replace all sign-in exceptions. Built-in fill errors
    // can include the password argument; no raw error/cause is rethrown.
    try {
      phase('landing');
      await page.goto(HOSTED_ORIGIN);
      phase('open-login');
      await page.getByRole('button', { name: 'Open app', exact: true }).click();
      phase('email-input');
      await page.getByLabel('Email', { exact: true }).fill(account.email);
      phase('password-input');
      await page.getByLabel('Password', { exact: true }).fill(process.env.SPM_QA_PASSWORD);
      phase('submit-login');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      phase('authenticated-banner');
      await expect(page.getByRole('banner')).toBeVisible();
      authenticatedBannerVisible = true;
      info.annotations.push({ type: 'hosted-flag', description: 'authenticated-banner-visible' });
      phase('role-identity');
      await expect(page.getByLabel('Your role', { exact: true })).toHaveText(account.label);
      info.annotations.push({ type: 'hosted-flag', description: 'role-identity-matched' });
      phase('permissions-ready');
      await expect(page.getByRole('navigation')).toHaveAttribute('aria-busy', 'false');
      health(); signedIn = true;
    } catch {
      diagnostic('authentication-check-failed');
      batchStopped = true;
      throw new Error('Sign-in failed; sensitive call logs withheld. Later roles must not attempt login.');
    }
    phase('navigation-contract');
    await expect(page.getByRole('navigation').getByRole('button')).toHaveText(account.nav);
    await proof('signed-in-dashboard');
    for (const label of account.nav) {
      phase('page-navigation');
      await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();
      await settle();
      const slug = label.toLowerCase().replaceAll(' ', '-');
      if (label === 'Venue Availability') {
        phase('calendar-detail');
        await expect(page.getByLabel('Venue availability by day')).toBeVisible();
        await page.getByRole('button', { name: /^\d{4}-\d\d-\d\d:/ }).first().click();
        await expect(page.getByRole('region', { name: 'Selected day availability' })).toBeVisible();
      }
      if (label === 'Catalogue' || label === 'Venues') await expect(page.getByRole('region', { name: 'Venue catalogue', exact: true })).toBeVisible();
      if (label === 'Equipment') await expect(page.getByRole('region', { name: 'Equipment records', exact: true })).toBeVisible();
      if (label === 'Capacity exceptions') await expect(page.getByRole('region', { name: 'Capacity exception requests', exact: true })).toBeVisible();
      if (role === 'safety') await expect(page.getByRole('heading', { name: 'No safety checks yet', exact: true })).toBeVisible();
      await proof(slug);
      if (role === 'organiser' && label === 'My events') {
        phase('event-detail');
        await page.getByRole('button', { name: 'View QA 16Oct Audit Probe', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'QA 16Oct Audit Probe', exact: true })).toBeVisible();
        await proof('event-23-detail');
        await history(23);
      }
      if (role === 'coordinator' && label === 'Dashboard') {
        phase('event-detail');
        phase('event-card-locate');
        const selected = page.getByRole('region', { name: 'My assigned events', exact: true })
          .getByRole('button', { name: /Event request #22 QA 15Oct Phone Request / });
        phase('event-target-unique');
        try { await expect(selected).toHaveCount(1); }
        finally { info.annotations.push({ type: 'hosted-event-target-count', description: String(await selected.count()) }); }
        phase('event-target-click');
        // Submitted auto-review writes are blocked by the request guard above.
        await selected.click();
        phase('event-detail-visible');
        await expect(page.getByRole('article', { name: 'Event request', exact: true })).toBeVisible();
        phase('event-readiness-visible');
        await expect(page.getByRole('region', { name: 'Event arrangement readiness', exact: true })).toBeVisible();
        await proof('event-22-detail-readiness');
        await history(22);
      }
    }
    phase('profile-read');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'My Profile', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'My profile', exact: true })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
    await proof('profile-readonly');
    if (['organiser','coordinator','venue','support','lead'].includes(role)) {
      phase('notifications-read');
      await page.getByRole('button', { name: /^Notifications \(/ }).click();
      await expect(page.getByRole('complementary', { name: 'Notifications', exact: true })).toBeVisible();
      await proof('notifications-readonly');
      await page.getByRole('button', { name: 'Close notifications', exact: true }).click();
    }
    phase('logout');
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open app', exact: true })).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(0);
    health();
    phase('complete');
  } catch {
    diagnostic(signedIn ? 'page-check-failed' : 'authentication-check-failed');
    batchStopped = true;
    // No raw assertion/locator/body is retained. Close before throwing so the
    // automatic error-context snapshot cannot capture a populated login form.
    await page.context().close().catch(() => {});
    throw new Error(signedIn ? 'Read-only role/page smoke failed; see approved post-login media.' : 'Sign-in failed; sensitive call logs withheld.');
  }
}

test('HOSTED-ROLE-1 | [NORMAL] [BOUNDARY] [SG2-23:AC1] [SG2-86:AC2] [SG2-40:AC1] organiser pages and owned Draft23 history are read-only', async ({ page }, info) => { await expectHostedRole('organiser', page, info); });
test('HOSTED-ROLE-2 | [NORMAL] [BOUNDARY] [SG2-23:AC1] [SG2-86:AC2] [SG2-57:AC1] coordinator pages and assigned event22 readiness are read-only', async ({ page }, info) => { await expectHostedRole('coordinator', page, info); });
test('HOSTED-ROLE-3 | [NORMAL] [BOUNDARY] [SG2-23:AC1] [SG2-86:AC2] venue staff pages, calendar, holds and catalogue are read-only', async ({ page }, info) => { await expectHostedRole('venue', page, info); });
test('HOSTED-ROLE-4 | [NORMAL] [BOUNDARY] [SG2-23:AC1] [SG2-86:AC2] technical support pages and equipment are read-only', async ({ page }, info) => { await expectHostedRole('support', page, info); });
test('HOSTED-ROLE-5 | [NORMAL] [BOUNDARY] [SG2-23:AC1] [SG2-86:AC2] Lead queue and assignment pages are inspected without assigning', async ({ page }, info) => { await expectHostedRole('lead', page, info); });
test('HOSTED-ROLE-6 | [NORMAL] [BOUNDARY] [SG2-23:AC1] [SG2-86:AC2] Safety placeholder and profile render without claiming safety workflow delivery', async ({ page }, info) => { await expectHostedRole('safety', page, info); });
test('HOSTED-ROLE-7 | [NORMAL] [BOUNDARY] [SG2-23:AC1] [SG2-86:AC2] Attendee prototype pages and real profile render without registration mutations', async ({ page }, info) => { await expectHostedRole('attendee', page, info); });
