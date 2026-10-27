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
import roleControls from './acting-role-control.cjs';
import pageReadiness from './staging-page-readiness.cjs';

const { getCurrentRole: currentRole, getHeldRoles, selectActingRole, roleControlKind } = roleControls;
const { waitForStagingContent } = pageReadiness;

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

async function settle(page) {
  // Role permissions arrive separately from the page. Wait for them before
  // enumerating navigation, otherwise gated entries can be silently missed.
  await expect(page.getByRole('banner').getByRole('navigation')).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
  const role = await currentRole(page);
  expect(roleNavigation[role], 'The signed-in role must have a known navigation contract').toBeDefined();
  await expect(page.getByRole('banner').getByRole('navigation').getByRole('button', { name: roleNavigation[role], exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  // One observable-content budget replaces the old 20s network-idle barrier
  // followed by 15s for loading messages. Errors and unfinished pages still fail.
  await waitForStagingContent(page);
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
  let authenticated = false;
  try {
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Open app', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill(`${account}@${process.env.STAGING_EMAIL_DOMAIN || 'connectsphere.test'}`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('banner').waitFor({ timeout: 20_000 });
    authenticated = true;
    await settle(page);
  } catch {
    await page.screenshot({ path: join(dir, authenticated ? 'post-login-not-ready.png' : 'sign-in-failed.png') });
    if (authenticated) failures.push(`${account}: signed-in page did not reach healthy role navigation`);
    else {
      const shown = (await page.locator('body').innerText().catch(() => '')).match(/Too many sign-in attempts[^\n]*|Invalid[^\n]*/)?.[0];
      failures.push(`${account}: sign-in failed${shown ? ` (${shown})` : ''}`);
    }
    await context.close();
    continue;
  }
  report.push({ account, screen: 'sign in', ms: Date.now() - started });
  const switcher = page.getByRole('combobox', { name: 'Acting as', exact: true });
  const listbox = page.getByRole('listbox', { name: 'Available roles', exact: true });
  let kind, roles;
  try {
    kind = await roleControlKind(page);
    roles = await getHeldRoles(page);
    expect(roles.length, 'A multi-role switcher lists at least two held roles').toBeGreaterThan(kind === 'single' ? 0 : 1);
  } catch {
    failures.push(`${account}: signed-in role controls did not expose the held roles`);
    await page.screenshot({ path: join(dir, 'role-controls-not-ready.png') });
    await context.close();
    continue;
  }
  for (const role of roles) {
    try {
      await selectActingRole(page, role);
      expect(await currentRole(page)).toBe(role);
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
      if (kind !== 'single') {
        const native = kind === 'native';
        const screen = native ? 'Role selector (native, closed)' : 'Role menu';
        const file = join(dir, `${slug(role)}-${width}-00-${native ? 'role-selector' : 'role-menu'}.png`);
        try {
          await page.evaluate(() => window.scrollTo(0, 0));
          if (native) {
            expect(await currentRole(page)).toBe(role);
            expect(await getHeldRoles(page)).toEqual(roles);
          } else {
            await switcher.click();
            await expect(switcher).toHaveAttribute('aria-expanded', 'true');
            await expect(listbox.getByRole('option', { name: role, exact: true })).toHaveAttribute('aria-selected', 'true');
          }
          const bounds = await (native ? switcher : page.locator('.role-switcher-menu')).evaluate(element => {
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
          report.push({ account, role, width, screen, roleControl: kind, sideways: bounds.sideways, file });
        } catch {
          failures.push(`${account} › ${role} › ${screen} at ${width}px did not fit or expose the held roles`);
          await page.screenshot({ path: file });
          report.push({ account, role, width, screen, roleControl: kind, failure: 'menu-not-ready', file });
        } finally {
          if (!native) {
            await switcher.press('Escape');
            await expect(listbox).toHaveCount(0);
          }
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
writeFileSync(join(out, 'report.json'), JSON.stringify({ base, measurement: 'navigation-to-observed-ready-content (includes UI readiness waits; not a performance acceptance result)', failures, report }, null, 1));
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
