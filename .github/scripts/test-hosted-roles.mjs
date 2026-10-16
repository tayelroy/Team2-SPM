// Optional user-run hosted proof. Never invoked by the default CI/loopback suite.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const list = process.argv.slice(2).join(' ') === '--list';
if (process.argv.length > 2 && !list) {
  console.error('Only --list is supported; application origin and role scope are fixed.'); process.exit(2);
}
if (!list && (process.env.SPM_HOSTED_QA_OPT_IN !== 'readonly' || !process.env.SPM_QA_PASSWORD)) {
  console.error('Hosted smoke requires explicit readonly opt-in and a runtime password. See docs/hosted-role-smoke.md.'); process.exit(2);
}
const output = resolve('output/hosted-role-smoke', new Date().toISOString().replaceAll(':','-'));
mkdirSync(output, { recursive: true });
const env = { ...process.env, SPM_HOSTED_OUTPUT_DIR: output,
  ...(list ? { SPM_QA_PASSWORD: '' } : {}), DEBUG: '', PWDEBUG: '0', DEBUG_FILE: '', PLAYWRIGHT_NO_COPY_PROMPT: '1' };
// Capture and discard Playwright console output: it can contain failed locator
// call logs. The dedicated reporter emits only whitelisted JSON/JUnit fields.
const run = spawnSync(process.execPath, [resolve('node_modules/playwright/cli.js'), 'test', '--config=playwright.hosted.config.ts', ...(list ? ['--list'] : [])],
  { env, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: list ? 60_000 : 1_500_000 });
// A killed/failed worker must not leave Playwright error-context markdown or
// other automatic non-approved artifacts behind. Never retain raw stdout.
const prune = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) prune(path);
    else if (!/\.(png|webm)$/.test(entry.name) && !['report.json','report.xml'].includes(entry.name)) rmSync(path);
  }
};
prune(output);
if (run.status === 0) console.log(list ? 'Hosted suite listed without browser or credential use (seven role cases).' : `Hosted read-only proof: ${output}`);
if (run.status !== 0 || run.error) console.error('Hosted smoke did not complete. Only sanitized reports are retained; no raw error log was saved.');
process.exit(run.status === 0 ? 0 : 1);
