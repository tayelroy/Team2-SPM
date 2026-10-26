import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRegressionEvidence, readCheckoutSha, writeRegressionEvidence } from './regression-evidence.mjs';

const sha = 'a'.repeat(40);
// Literal acceptance jobs: deriving this list from the generator could hide a removed gate.
const passingJobs = () => Object.fromEntries([
  'build', 'application-tests', 'browser-tests', 'browser-smoke', 'database-tests', 'reviewer-tests',
].map(name => [name, { result: 'success', outputs: { irrelevantSecret: 'must-not-be-retained' } }]));
function context(overrides = {}) {
  return { GITHUB_ACTIONS: 'true', EXPECTED_TESTED_SHA: sha, GITHUB_REPOSITORY: 'example/connectsphere',
    GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_SERVER_URL: 'https://github.example.test', JOB_RESULTS: JSON.stringify(passingJobs()),
    SECRET_TOKEN: 'must-not-be-retained', ...overrides };
}
const create = env => createRegressionEvidence({ env, checkoutSha: sha, generatedAt: new Date('2026-10-26T14:30:00+08:00') });

test('[NORMAL] [SG2-22:AC3] run evidence identifies the exact tested checkout, UTC date and specific CI attempt without retaining credentials', () => {
  const evidence = create(context());
  assert.equal(evidence.testedCommit, sha);
  assert.equal(evidence.commitUrl, `https://github.example.test/example/connectsphere/commit/${sha}`);
  assert.equal(evidence.recordedAtUtc, '2026-10-26T06:30:00.000Z');
  assert.equal(evidence.runUrl, 'https://github.example.test/example/connectsphere/actions/runs/123456/attempts/2');
  assert.equal(evidence.artifactName, 'regression-evidence-123456-2');
  assert.equal(evidence.status, 'passed');
  assert.deepEqual(evidence.jobs, Object.fromEntries(Object.keys(passingJobs()).map(name => [name, 'success'])));
  assert.doesNotMatch(JSON.stringify(evidence), /must-not-be-retained|irrelevantSecret|SECRET_TOKEN/);
  assert.throws(() => create(context({ EXPECTED_TESTED_SHA: 'b'.repeat(40) })), /checkout differs/);
});

test('[FAILURE] [BOUNDARY] [SG2-22:AC3] missing, failed, skipped or cancelled required jobs cannot produce passing evidence', () => {
  for (const name of Object.keys(passingJobs())) {
    for (const result of ['failure', 'skipped', 'cancelled', undefined]) {
      const jobs = passingJobs(); jobs[name] = { result };
      assert.throws(() => create(context({ JOB_RESULTS: JSON.stringify(jobs) })), /did not succeed/);
    }
    const jobs = passingJobs(); delete jobs[name];
    assert.throws(() => create(context({ JOB_RESULTS: JSON.stringify(jobs) })), /is missing/);
  }
  assert.throws(() => create(context({ JOB_RESULTS: '{}' })), /is missing/);
  assert.throws(() => create(context({ JOB_RESULTS: 'null' })), /results are missing/);
  const jobs = { ...passingJobs(), 'future-gate': { result: 'failure' } };
  assert.throws(() => create(context({ JOB_RESULTS: JSON.stringify(jobs) })), /future-gate did not succeed/);
});

test('[FAILURE] [SG2-22:AC3] absent CI context, incomplete commit IDs and untrusted run destinations are rejected', () => {
  for (const overrides of [
    { GITHUB_ACTIONS: 'false' }, { EXPECTED_TESTED_SHA: '' }, { GITHUB_RUN_ID: '' }, { GITHUB_RUN_ATTEMPT: '0' },
    { GITHUB_REPOSITORY: 'example/repo?token=secret' }, { GITHUB_SERVER_URL: 'http://github.example.test' },
    { GITHUB_SERVER_URL: 'https://secret@github.example.test' }, { GITHUB_SERVER_URL: 'https://github.example.test/?secret=1' },
  ]) assert.throws(() => create(context(overrides)));
  assert.throws(() => createRegressionEvidence({ env: context(), checkoutSha: 'aaaaaaa' }), /complete Git SHA/);
});

test('[NORMAL] [CONFLICT] [SG2-22:AC3] evidence files and the existing step summary retain the same run identity and cannot be overwritten', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spm-regression-evidence-test-'));
  try {
    const summaryFile = join(directory, 'summary.md'); writeFileSync(summaryFile, 'Existing coverage summary\n');
    const evidence = create(context());
    const artifactDirectory = join(directory, 'artifact');
    writeRegressionEvidence(evidence, { directory: artifactDirectory, summaryFile });
    assert.deepEqual(JSON.parse(readFileSync(join(artifactDirectory, 'regression-evidence.json'), 'utf8')), evidence);
    const markdown = readFileSync(join(artifactDirectory, 'regression-evidence.md'), 'utf8');
    assert.ok(markdown.includes(evidence.runUrl));
    assert.ok(markdown.includes(evidence.testedCommit));
    assert.ok(markdown.includes(evidence.recordedAtUtc));
    assert.equal(readFileSync(summaryFile, 'utf8'), `Existing coverage summary\n\n${markdown}`);
    assert.throws(() => writeRegressionEvidence(evidence, { directory: artifactDirectory, summaryFile }), { code: 'EEXIST' });
    assert.deepEqual(JSON.parse(readFileSync(join(artifactDirectory, 'regression-evidence.json'), 'utf8')), evidence);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('[NORMAL] [FAILURE] [SG2-22:AC3] the generator reads the actual Git revision and a local CLI invocation refuses to manufacture hosted evidence', () => {
  const workspace = fileURLToPath(new URL('../../', import.meta.url));
  assert.match(readCheckoutSha(workspace), /^[0-9a-f]{40}$/);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./regression-evidence.mjs', import.meta.url))], {
    cwd: workspace, env: { ...process.env, GITHUB_ACTIONS: 'false' }, encoding: 'utf8', maxBuffer: 8192,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only be generated inside GitHub Actions/);
});
