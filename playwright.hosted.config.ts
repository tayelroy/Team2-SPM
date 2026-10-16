import { defineConfig, devices } from '@playwright/test';
import policy from './hosted-e2e/policy.cjs';
const { HOSTED_ORIGIN } = policy;
import { resolve } from 'node:path';
if (!process.argv.includes('--list') && (process.env.SPM_HOSTED_QA_OPT_IN !== 'readonly' || !process.env.SPM_QA_PASSWORD)) {
  throw new Error('Hosted smoke requires explicit read-only opt-in and runtime credentials before launching a browser.');
}
// Opt-in command only. No webServer/reset fixture and no default-CI project.
export default defineConfig({
  testDir: './hosted-e2e', testMatch: 'roles.spec.ts', workers: 1,
  fullyParallel: false, retries: 0, maxFailures: 1, forbidOnly: true,
  timeout: 180_000, expect: { timeout: 20_000 },
  outputDir: resolve(process.env.SPM_HOSTED_OUTPUT_DIR || 'output/hosted-role-smoke/unstarted', 'media'),
  reporter: [[resolve('hosted-e2e/reporter.mjs')]],
  use: { baseURL: HOSTED_ORIGIN, ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Singapore',
    serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'on' },
});
