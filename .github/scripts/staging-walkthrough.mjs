// SG2-96: read-only walkthrough of the deployed staging site, run by
// .github/workflows/staging-check.yml (or locally:
//   SPM_STAGING_PASSWORD='…' node .github/scripts/staging-walkthrough.mjs).
//
// Signs in through the visible form as accounts that together hold all seven
// roles, switches through every role an account holds, and opens every page
// in that role's navigation at 320, 375, 390, 768 and 1440 px. It clicks only the
// sign-in form, the role switcher and navigation, so it changes no records.
// Fails on a failed sign-in, unfinished/error page or a page wider than the screen;
// navigation-to-settled-page times above 2 s are diagnostic warnings, not an
// end-user performance benchmark. Screenshots and report.json
// go to $STAGING_OUTPUT_DIR (default output/staging-walkthrough).
import { chromium, expect } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = (process.env.STAGING_URL || 'https://team2-spm-server.vercel.app').replace(/\/$/, '');
const password = process.env.SPM_STAGING_PASSWORD;
if (!password) {
  console.error('SPM_STAGING_PASSWORD is not set.');
  process.exit(1);
}
// Six sign-ins cover all seven roles (sign-in allows 10 attempts per 15 minutes).
const accounts = (process.env.STAGING_ACCOUNTS || 'event.organiser3,event.coordinator3,venue.staff3,technical.support1,event.coordinator.lead1,safety.officer1')
  .split(',').map(account => account.trim()).filter(Boolean);
const viewports = [[320, 568], [375, 812], [390, 844], [768, 1024], [1440, 900]];
const out = process.env.STAGING_OUTPUT_DIR || join('output', 'staging-walkthrough');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const report = [];
const failures = [];
const roleNavigation = {
  'Event Organiser': 'New request',
  'Event Coordinator': 'Find an event',
  'Venue Staff': 'Capacity exceptions',
  'Technical Support Staff': 'Equipment',
  'Event Coordinator Lead': 'Unassigned queue',
  'Safety Officer': 'Safety checks',
  Attendee: 'Find events',
};

async function currentRole(page) {
  const banner = page.getByRole('banner');
  const switcher = banner.getByRole('combobox', { name: 'Acting as', exact: true });
  const control = await switcher.count() ? switcher : banner.getByLabel('Your role', { exact: true });
  return (await control.innerText()).trim();
}

async function settle(page) {
  // Role permissions arrive separately from the page. Wait for them before
  // enumerating navigation, otherwise gated entries can be silently missed.
  await expect(page.getByRole('banner').getByRole('navigation')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
  const role = await currentRole(page);
  expect(roleNavigation[role], 'The signed-in role must have a known navigation contract').toBeDefined();
  await expect(page.getByRole('banner').getByRole('navigation').getByRole('button', { name: roleNavigation[role], exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  // Match complete loading messages, not venue content such as "Loading bay".
  // A timeout must fail the view rather than produce a successful screenshot.
  await expect(page.getByText(/^(?:Loading\b[^\n]*|Searching venues|Checking for clashing bookings)(?:…|\.{3})$/))
    .toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notifications (unavailable)', exact: true })).toHaveCount(0);
}

const browser = await chromium.launch();
for (const account of accounts) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Singapore' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error).slice(0, 200)));
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text().slice(0, 200)); });
  const dir = join(out, account);
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  try {
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Open app', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill(`${account}@${process.env.STAGING_EMAIL_DOMAIN || 'connectsphere.test'}`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('banner').waitFor({ timeout: 20_000 });
    await settle(page);
  } catch {
    await page.screenshot({ path: join(dir, 'sign-in-failed.png') });
    const shown = (await page.locator('body').innerText().catch(() => '')).match(/Too many sign-in attempts[^\n]*|Invalid[^\n]*/)?.[0];
    failures.push(`${account}: sign-in failed${shown ? ` (${shown})` : ''}`);
    await context.close();
    continue;
  }
  report.push({ account, screen: 'sign in', ms: Date.now() - started });
  const switcher = page.getByRole('combobox', { name: 'Acting as', exact: true });
  const listbox = page.getByRole('listbox', { name: 'Available roles', exact: true });
  let roles = [null];
  if (await switcher.count()) {
    await switcher.click();
    await expect(listbox).toBeVisible();
    roles = (await listbox.getByRole('option').allTextContents()).map(label => label.trim());
    expect(roles.length, 'A multi-role switcher lists at least two held roles').toBeGreaterThan(1);
    await switcher.press('Escape');
    await expect(listbox).toHaveCount(0);
  }
  for (const role of roles) {
    try {
      if (role && await currentRole(page) !== role) {
        await switcher.click();
        await listbox.getByRole('option', { name: role, exact: true }).click();
        await expect(switcher).toHaveText(role);
        await expect(listbox).toHaveCount(0);
      }
      await settle(page);
    } catch {
      failures.push(`${account} › ${role ?? 'single role'}: role did not reach a healthy, fully loaded page`);
      await page.screenshot({ path: join(dir, `${slug(role || 'role')}-not-ready.png`), fullPage: true });
      continue;
    }
    const labels = (await page.getByRole('banner').getByRole('navigation').getByRole('button').allTextContents())
      .map(label => label.trim()).filter(Boolean);
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      if (role) {
        const file = join(dir, `${slug(role)}-${width}-00-role-menu.png`);
        try {
          await page.evaluate(() => window.scrollTo(0, 0));
          await switcher.click();
          await expect(switcher).toHaveAttribute('aria-expanded', 'true');
          await expect(listbox.getByRole('option', { name: role, exact: true })).toHaveAttribute('aria-selected', 'true');
          const bounds = await page.locator('.role-switcher-menu').evaluate(element => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
              width: innerWidth, height: innerHeight, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
          });
          expect(bounds.left).toBeGreaterThanOrEqual(0);
          expect(bounds.right).toBeLessThanOrEqual(bounds.width);
          expect(bounds.top).toBeGreaterThanOrEqual(0);
          expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
          expect(bounds.sideways).toBe(0);
          await page.screenshot({ path: file });
          report.push({ account, role, width, screen: 'Role menu', sideways: bounds.sideways, file });
        } catch {
          failures.push(`${account} › ${role} › role menu at ${width}px did not fit or expose the held roles`);
          await page.screenshot({ path: file });
          report.push({ account, role, width, screen: 'Role menu', failure: 'menu-not-ready', file });
        } finally {
          await switcher.press('Escape');
          await expect(listbox).toHaveCount(0);
        }
      }
      for (const [index, label] of labels.entries()) {
        const t0 = Date.now();
        const file = join(dir, `${slug(role || 'role')}-${width}-${String(index + 1).padStart(2, '0')}-${slug(label)}.png`);
        try {
          const target = page.getByRole('banner').getByRole('navigation').getByRole('button', { name: label, exact: true });
          await target.click();
          await expect(target).toHaveAttribute('aria-current', 'page');
          await settle(page);
          const ms = Date.now() - t0;
          await page.evaluate(() => window.scrollTo(0, 0));
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          await page.screenshot({ path: file, fullPage: true });
          report.push({ account, role, width, screen: label, ms, sideways, file });
          if (sideways > 0) failures.push(`${account} › ${role ?? ''} › ${label} at ${width}px scrolls sideways by ${sideways}px`);
        } catch {
          // Locator call logs can contain form values: retain only a stable
          // failure description and the rendered page for investigation.
          failures.push(`${account} › ${role ?? ''} › ${label} at ${width}px did not reach a healthy, fully loaded page`);
          await page.screenshot({ path: file, fullPage: true });
          report.push({ account, role, width, screen: label, failure: 'page-not-ready', file });
        }
      }
    }
  }
  for (const error of new Set(pageErrors)) failures.push(`${account}: console/page error: ${error}`);
  await context.close();
}
await browser.close();

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.json'), JSON.stringify({ base, measurement: 'navigation-to-settled-page (includes network-idle wait; not a performance acceptance result)', failures, report }, null, 1));
const slow = report.filter(row => row.ms > 2000);
const pages = report.filter(row => row.file).length;
const summary = [
  `### Staging walkthrough: ${base}`,
  `${pages} page and menu views across ${accounts.length} accounts at ${viewports.map(([w]) => w).join(', ')} px.`,
  failures.length ? `**${failures.length} failure(s):**\n${failures.map(f => `- ${f}`).join('\n')}` : '**No failures.**',
  slow.length ? `Navigation / sign-in above 2 s (diagnostic only; includes settling waits):\n${slow.map(r => `- ${r.account} › ${r.role ?? ''} › ${r.screen} at ${r.width ?? 1440}px: ${r.ms} ms`).join('\n')}` : 'Every measured navigation settled within 2 s (includes settling waits; not a performance acceptance result).',
].join('\n\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
process.exit(failures.length ? 1 : 0);
