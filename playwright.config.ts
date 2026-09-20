import { defineConfig, devices } from '@playwright/test';

// A single worker owns the resettable local fixture. Never target shared data.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/regression.json' }],
    ['junit', { outputFile: 'test-results/regression.xml' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm exec --workspace server -- tsx ../e2e/server.ts',
    url: 'http://127.0.0.1:4173/__e2e/ready',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { NODE_ENV: 'test', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  },
});
