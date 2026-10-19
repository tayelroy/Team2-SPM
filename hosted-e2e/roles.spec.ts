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
  // A heading can render before its effect starts fetching. Require a positive
  // loaded/empty state, rather than letting absence of loading text win that race.
  const screenshotReady = async (name: string) => {
    phase('page-settle');
    const main = page.getByRole('main');
    if (name.endsWith('-history')) {
      const drawer = page.getByRole('dialog', { name: 'Event Change History', exact: true });
      await expect(drawer.getByTestId(/^audit-entry-/).first()).toBeVisible();
    } else if (name === 'notifications-readonly') {
      const drawer = page.getByRole('complementary', { name: 'Notifications', exact: true });
      await expect(drawer.getByText(/SGT$/).or(drawer.getByText('No notifications yet.', { exact: true })).first()).toBeVisible();
    } else if (name === 'profile-readonly') {
      // Profile fields appear only after its load succeeds, never in the shell.
      await expect(main.getByLabel('Name', { exact: true })).toHaveValue(/\S/);
    } else if (name === 'signed-in-dashboard' || name === 'dashboard') {
      if (role === 'organiser') {
        // The dashboard card has no View prefix; keep the same named Draft23.
        await expect(main.getByRole('button', { name: /QA 16Oct Audit Probe/ })).toBeVisible();
      } else if (role === 'coordinator' || role === 'venue' || role === 'support') {
        await expect(main.getByRole('status').filter({ hasText: /^\d+ items? in your work queue$/ })).toBeVisible();
        if (role === 'coordinator' || role === 'venue') {
          const clashes = main.getByRole('region', { name: 'Clashing bookings', exact: true });
          await expect(clashes.getByRole('listitem').or(clashes.getByText('No bookings clash once setup and turnaround time are included.', { exact: true })).first()).toBeVisible();
        }
        if (role === 'coordinator') {
          await expect(main.getByRole('region', { name: 'My assigned events', exact: true })
            .getByRole('button', { name: /Event request #22 QA 15Oct Phone Request / })).toBeVisible();
        }
      } else if (role === 'lead') {
        await expect(main.getByText(/^\d+ requests? (?:is|are) awaiting a coordinator\.$/)).toBeVisible();
      } else if (role === 'safety') {
        await expect(main.getByRole('heading', { name: 'No safety checks yet', exact: true })).toBeVisible();
      } else {
        await expect(main.getByRole('heading', { name: 'Northbridge Investor Forum', exact: true })).toBeVisible();
      }
    } else if (name === 'my-events') {
      // Must precede this page's screenshots, not just the later detail click.
      await expect(main.getByRole('button', { name: 'View QA 16Oct Audit Probe', exact: true })).toBeVisible();
    } else if (name === 'my-drafts') {
      await expect(main.getByRole('region', { name: 'My draft requests', exact: true })
        .getByRole('heading', { name: 'QA 16Oct Audit Probe', exact: true })).toBeVisible();
    } else if (name === 'event-23-detail' || name === 'event-detail') {
      await expect(main.getByRole('heading', { name: 'QA 16Oct Audit Probe', exact: true })).toBeVisible();
      // Own Draft23 loads its stage separately after the event detail. The
      // heading alone cannot establish that this second read has completed.
      const stage = main.getByRole('region', { name: 'Event stage progress', exact: true });
      await expect(stage).toBeVisible();
      await expect(stage.getByTestId('stage-badge')).toHaveText('Draft');
      await expect(stage.getByTestId('waiting-on-persona')).toHaveText('Event Organiser');
      await expect(stage.getByTestId('waiting-on-action')).toHaveText('Next step: Complete and submit event request');
    } else if (name === 'event-22-detail-readiness') {
      await expect(main.getByRole('article', { name: 'Event request', exact: true })
        .getByRole('heading', { name: 'QA 15Oct Phone Request', exact: true })).toBeVisible();
      await expect(main.getByRole('region', { name: 'Equipment requirements', exact: true })).toBeVisible();
      const reservations = main.getByRole('region', { name: 'Equipment reservations', exact: true });
      await expect(reservations.getByRole('article').or(reservations.getByText('No equipment reservations recorded.', { exact: true })).first()).toBeVisible();
      await expect(main.getByTestId('readiness-badge')).toHaveText(/^(?:Ready for confirmation|Arrangements outstanding)$/);
    } else if (name === 'new-request') {
      await expect(main.getByLabel(/Event name/i)).toHaveValue('');
      await expect(main.getByRole('button', { name: 'Submit request', exact: true })).toBeDisabled();
    } else if (name === 'venues' || name === 'catalogue') {
      await expect(main.getByRole('region', { name: 'Venue catalogue', exact: true })
        .getByText(/^\d+ of \d+ venues$/)).toBeVisible();
    } else if (name === 'find-venues') {
      await expect(main.getByRole('form', { name: 'Venue search criteria', exact: true })
        .getByRole('button', { name: 'Search', exact: true })).toBeVisible();
    } else if (name === 'venue-availability') {
      await expect(main.getByLabel('Venue availability by day', { exact: true })).toBeVisible();
      await expect(main.getByRole('region', { name: 'Selected day availability', exact: true })).toBeVisible();
    } else if (name === 'venue-holds') {
      await expect(main.getByRole('article', { name: /^Hold #\d+$/ })
        .or(main.getByText('No venue holds yet.', { exact: true })).first()).toBeVisible();
    } else if (name === 'equipment') {
      await expect(main.getByRole('region', { name: 'Equipment records', exact: true })
        .getByText(/^\d+ equipment records\. Available quantities exclude damaged and maintenance stock\.$/)).toBeVisible();
    } else if (name === 'capacity-exceptions') {
      const requests = main.getByRole('region', { name: 'Capacity exception requests', exact: true });
      await expect(requests.getByRole('button', { name: /^Review exception for / })
        .or(requests.getByText('No booking requests need a capacity exception right now.', { exact: true })).first()).toBeVisible();
    } else if (name === 'unassigned-queue') {
      await expect(main.getByRole('region', { name: 'Unassigned queue', exact: true }).getByRole('article')
        .or(main.getByRole('heading', { name: 'No requests awaiting a coordinator', exact: true })).first()).toBeVisible();
    } else if (name === 'assign-coordinators') {
      await expect(main.getByRole('region', { name: 'Requests awaiting a coordinator', exact: true }).getByRole('combobox')
        .or(main.getByRole('heading', { name: 'Nothing to assign', exact: true })).first()).toBeVisible();
    } else if (name === 'my-registrations') {
      await expect(main.getByRole('heading', { name: 'Events I can register for', exact: true })).toBeVisible();
    } else if (name === 'event-page') {
      await expect(main.getByRole('heading', { name: 'Northbridge Investor Forum', exact: true })).toBeVisible();
    } else {
      throw new Error('Screenshot checkpoint has no reviewed positive ready-state oracle.');
    }
    await settle();
  };
  const proof = async (name: string) => {
    await screenshotReady(name);
    phase('page-evidence');
    await expect(page.locator('vite-error-overlay, nextjs-portal')).toHaveCount(0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      // Reset the document scroll after navigation/modal controls scrolled it.
      // This does not inspect storage or change any application/business state.
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.evaluate(async () => { await document.fonts.ready; });
      // Reassert the positive page result and strict health at each width,
      // immediately before capture; resizing cannot reuse an earlier shell pass.
      await screenshotReady(name);
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
