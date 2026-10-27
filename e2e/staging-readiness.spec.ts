import { expect, test, type Page } from '@playwright/test';
import readiness from '../.github/scripts/staging-page-readiness.cjs';

const { waitForStagingContent } = readiness;

async function content(page: Page, main: string, notifications = 'Notifications (0)', script = '') {
  await page.setContent(`<!doctype html><html><body>
    <header><button id="notifications" aria-label="${notifications}">Notifications</button></header>
    <main><h1>Venue details</h1>${main}</main>
    <script>${script}</script>
  </body></html>`);
}

test('[NORMAL] [SG2-22:AC3] healthy content finishes while an unrelated browser request remains in flight', async ({ page }) => {
  let requestStarted!: () => void;
  let releaseRequest!: () => void;
  const started = new Promise<void>(resolve => { requestStarted = resolve; });
  const released = new Promise<void>(resolve => { releaseRequest = resolve; });
  await page.route('**/__readiness-background', async route => {
    requestStarted();
    await released;
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'finished' });
  });
  await page.route('**/__readiness-host', route => route.fulfill({
    status: 200, contentType: 'text/html', body: `<!doctype html><html><body>
      <header><button aria-label="Notifications (0)">Notifications</button></header>
      <main><h1>Venue details</h1><p>Available venue</p><p id="request-state">pending</p></main>
      <script>fetch('/__readiness-background').then(response => response.text()).then(text => {
        document.getElementById('request-state').textContent = text;
      });</script>
    </body></html>`,
  }));
  try {
    await page.goto('/__readiness-host', { waitUntil: 'domcontentloaded' });
    await started;
    await waitForStagingContent(page, { timeoutMs: 600 });
    expect(await page.locator('#request-state').innerText()).toBe('pending');
  } finally {
    releaseRequest();
    await expect(page.locator('#request-state')).toHaveText('finished');
  }
});

for (const message of ['Loading…', 'Loading venues...', 'Searching venues…', 'Searching events…', 'Checking for clashing bookings...', 'Checking equipment availability…']) {
  test(`[FAILURE] [BOUNDARY] [SG2-22:AC3] unfinished content "${message}" fails within a bounded readiness timeout`, async ({ page }) => {
    await content(page, `<p>${message}</p>`);
    const started = performance.now();
    await expect(waitForStagingContent(page, { timeoutMs: 150 })).rejects.toThrow('Page content is still loading');
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(await page.getByText(message, { exact: true }).count()).toBe(1);
  });
}

for (const problem of ['alert', 'notifications unavailable'] as const) {
  test(`[FAILURE] [SG2-22:AC3] apparently loaded content with ${problem} cannot pass readiness`, async ({ page }) => {
    await content(page, problem === 'alert' ? '<p role="alert">Venue service failed</p>' : '<p>Available venue</p>',
      problem === 'alert' ? 'Notifications (0)' : 'Notifications (unavailable)');
    await expect(waitForStagingContent(page, { timeoutMs: 150 })).rejects.toThrow(
      problem === 'alert' ? 'Page exposed an error alert' : 'Header notifications are unavailable');
  });
}

test('[NORMAL] [CONFLICT] [SG2-22:AC3] loaded content waits until header notifications finish loading', async ({ page }) => {
  await content(page, '<p>Available venue</p>', 'Notifications (loading)', `
    setTimeout(() => document.getElementById('notifications').setAttribute('aria-label', 'Notifications (0)'), 300);
  `);
  await waitForStagingContent(page, { timeoutMs: 1_500 });
  // Read the current value directly: a retrying assertion could hide an early return.
  expect(await page.locator('#notifications').getAttribute('aria-label')).toBe('Notifications (0)');
});

test('[BOUNDARY] [CONFLICT] [SG2-22:AC3] content and notification loading share one deadline instead of starting a second budget', async ({ page }) => {
  await content(page, '<p id="content-loading">Loading venues…</p>', 'Notifications (loading)', `
    setTimeout(() => document.getElementById('content-loading').remove(), 250);
  `);
  const started = performance.now();
  await expect(waitForStagingContent(page, { timeoutMs: 450 })).rejects.toThrow('Header notifications are still loading');
  expect(performance.now() - started).toBeLessThan(700);
  expect(await page.locator('#content-loading').count()).toBe(0);
  expect(await page.locator('#notifications').getAttribute('aria-label')).toBe('Notifications (loading)');
});

test('[NORMAL] [BOUNDARY] [SG2-22:AC3] a legitimate Loading bay venue label is healthy content', async ({ page }) => {
  await content(page, '<p>Loading bay</p><p>Accessible entrance beside the loading bay.</p>');
  await waitForStagingContent(page, { timeoutMs: 150 });
  expect(await page.getByText('Loading bay', { exact: true }).count()).toBe(1);
});
