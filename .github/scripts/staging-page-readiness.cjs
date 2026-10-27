const { expect } = require('@playwright/test');

/** Wait for visible page work, not unrelated requests or persistent connections.
 * The former 20 s network-idle + 15 s content waits share one 35 s budget now. */
async function waitForStagingContent(page, { timeoutMs = 35_000 } = {}) {
  const deadline = performance.now() + timeoutMs;
  const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()));
  // Match complete loading messages, not venue content such as "Loading bay".
  const loading = page.getByText(/^(?:Loading\b[^\n]*|Searching (?:venues|events)|Checking (?:for clashing bookings|equipment availability))(?:…|\.{3})$/);
  const notificationsLoading = page.getByRole('banner').getByRole('button', {
    name: 'Notifications (loading)', exact: true,
  });

  await expect(loading, 'Page content is still loading').toHaveCount(0, { timeout: remaining() });
  await expect(notificationsLoading, 'Header notifications are still loading').toHaveCount(0, { timeout: remaining() });
  // Content may start another loading phase while the header settles.
  await expect(loading.or(notificationsLoading), 'Page content or notifications are still loading')
    .toHaveCount(0, { timeout: remaining() });
  expect(await page.getByRole('alert').count(), 'Page exposed an error alert').toBe(0);
  expect(await page.getByRole('button', { name: 'Notifications (unavailable)', exact: true }).count(),
    'Header notifications are unavailable').toBe(0);
}

module.exports = { waitForStagingContent };
