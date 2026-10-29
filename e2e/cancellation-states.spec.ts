import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.use({ timezoneId: 'Asia/Singapore' });

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`SG2-67-CLOSED-${viewport.width} | [NORMAL] [BOUNDARY] [CONFLICT] [SG2-67:AC1] [SG2-67:AC4] [SG2-67:AC5] closed cancellation actions and final receipts at ${viewport.width}px`, async ({ page, request, baseURL }, info) => {
    expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
    expect((await request.post('/__e2e/reset')).status()).toBe(204);
    expect((await request.post('/__e2e/cancellation-states')).status()).toBe(204);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    const mutations: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/\/(cancellation-request|cancel)$/.test(request.url())) mutations.push(request.method());
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open app', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('organiser@example.test');
    await page.getByLabel('Password', { exact: true }).fill('Regression123!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('banner')).toBeVisible();
    await mkdir('test-results/release-evidence', { recursive: true });

    for (const status of ['draft', 'rejected', 'completed', 'cancelled', 'planning', 'safety_rejected']) {
      await page.getByRole('navigation').getByRole('button', { name: 'My events', exact: true }).click();
      await page.getByRole('button', { name: `View Cancellation ${status}`, exact: true }).click();
      await expect(page.getByRole('heading', { name: `Cancellation ${status}`, exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const path = `test-results/release-evidence/cancellation-${status}-${viewport.width}.png`;
      await page.screenshot({ path, fullPage: true, animations: 'disabled' });
      await info.attach(`cancellation-${status}-${viewport.width}`, { path, contentType: 'image/png' });
      const panel = page.getByRole('region', { name: 'Cancellation', exact: true });
      if (['planning', 'safety_rejected'].includes(status)) {
        await expect(panel.getByRole('button', { name: 'Ask to cancel', exact: true })).toBeVisible();
        await expect(panel.getByLabel('Reason for cancelling', { exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: /^(Ask to cancel|Cancel event|Yes, cancel event)$/ })).toHaveCount(0);
        await expect(page.getByLabel('Reason for cancelling', { exact: true })).toHaveCount(0);
        if (status === 'cancelled') {
          await expect(panel).toContainText('This event was cancelled on 21 Oct 2026, 10:30 SGT. Reason: The keynote speaker withdrew');
          await expect(panel).toContainText('A similar event needs a new request.');
        } else await expect(panel).toHaveCount(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
