import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
const required = ['build', 'application-tests', 'browser-tests', 'database-tests', 'reviewer-tests'];
// Execute the actual inline gate so this test cannot pass against a separate copy.
const gate = workflow.match(/- name: Require every regression job to pass[\s\S]*?run: \|\n([\s\S]*?)(?=      - name:)/)?.[1];
assert.ok(gate, 'CI aggregate gate must be present');
const script = gate.split('\n').map(line => line.replace(/^          /, '')).join('\n');
function runGate(jobs) {
  return spawnSync('sh', ['-c', script], {
    env: { ...process.env, JOB_RESULTS: JSON.stringify(jobs) }, encoding: 'utf8', timeout: 5000
  });
}
const successfulJobs = () => Object.fromEntries(required.map(name => [name, { result: 'success' }]));

test('SG2-25-CI-P01: browser regression is required on PRs and exact merge revisions', () => {
  const browser = workflow.match(/^  browser-tests:\n([\s\S]*?)(?=^  [\w-]+:)/m)?.[1];
  assert.ok(browser);
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review, closed\]/);
  assert.match(browser, /github\.event\.pull_request\.merge_commit_sha \|\| github\.sha/);
  assert.match(browser, /run: npm run test:e2e/);
  assert.match(browser, /if: \$\{\{ !cancelled\(\) \}\}[\s\S]*actions\/upload-artifact/);
  const dependencies = workflow.match(/needs: \[([^\]]+)\]/)?.[1].split(',').map(value => value.trim());
  assert.deepEqual(dependencies, required);
});

test('SG2-25-CI-P02: the aggregate passes when every required job succeeds', () => {
  const result = runGate(successfulJobs());
  assert.equal(result.status, 0, result.stderr);
});

test('SG2-25-CI-N01: failed, cancelled or skipped dependencies prevent a passing gate', () => {
  for (const name of required) {
    for (const state of ['failure', 'cancelled', 'skipped']) {
      const jobs = successfulJobs();
      jobs[name].result = state;
      const result = runGate(jobs);
      assert.equal(result.status, 1, `${name}: ${state}; ${result.stderr}`);
      assert.match(result.stderr, new RegExp(`${name}: ${state}`));
    }
  }
});
