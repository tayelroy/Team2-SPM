import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_JOBS = Object.freeze([
  'build', 'application-tests', 'browser-tests', 'browser-smoke', 'database-tests', 'reviewer-tests',
]);
const shaPattern = /^[0-9a-f]{40}$/;

export function readCheckoutSha(workspace) {
  assert.ok(workspace, 'GITHUB_WORKSPACE is required.');
  return execFileSync('git', ['-C', workspace, 'rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024,
  }).trim();
}

export function createRegressionEvidence({ env, checkoutSha, generatedAt = new Date() }) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Release evidence requires a real GitHub Actions execution context.');
  assert.match(checkoutSha, shaPattern, 'The checked-out commit must be a complete Git SHA.');
  assert.match(env.EXPECTED_TESTED_SHA ?? '', shaPattern, 'EXPECTED_TESTED_SHA must identify the workflow checkout.');
  assert.equal(checkoutSha, env.EXPECTED_TESTED_SHA, 'The checkout differs from the commit selected for the test jobs.');
  assert.match(env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Invalid GitHub repository.');
  assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9][0-9]*$/, 'A GitHub run ID is required.');
  assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9][0-9]*$/, 'A GitHub run attempt is required.');
  assert.match(env.GITHUB_EVENT_NAME ?? '', /^[a-z_]+$/, 'A GitHub event name is required.');
  const server = new URL(env.GITHUB_SERVER_URL);
  assert.ok(server.protocol === 'https:' && !server.username && !server.password
    && server.pathname === '/' && !server.search && !server.hash, 'Invalid GitHub server URL.');

  const needs = JSON.parse(env.JOB_RESULTS ?? 'null');
  assert.ok(needs && typeof needs === 'object' && !Array.isArray(needs), 'Required job results are missing.');
  for (const name of REQUIRED_JOBS) assert.ok(Object.hasOwn(needs, name), `Required job ${name} is missing.`);
  const jobs = {};
  for (const [name, job] of Object.entries(needs)) {
    assert.match(name, /^[A-Za-z0-9_-]+$/, 'Invalid job identifier.');
    assert.equal(job?.result, 'success', `Required job ${name} did not succeed (${job?.result ?? 'missing result'}).`);
    jobs[name] = job.result;
  }

  const runUrl = `${server.origin}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  return {
    schemaVersion: 1,
    status: 'passed',
    testedCommit: checkoutSha,
    commitUrl: `${server.origin}/${env.GITHUB_REPOSITORY}/commit/${checkoutSha}`,
    recordedAtUtc: generatedAt.toISOString(),
    repository: env.GITHUB_REPOSITORY,
    event: env.GITHUB_EVENT_NAME,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runUrl,
    artifactName: `regression-evidence-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    jobs,
    reportArtifacts: ['application-coverage', 'browser-regression', 'browser-smoke'],
  };
}

export function writeRegressionEvidence(evidence, { directory, summaryFile }) {
  const markdown = [
    '## SG2-96 regression evidence', '',
    `- Tested commit: [${evidence.testedCommit}](${evidence.commitUrl})`,
    `- Recorded (UTC): ${evidence.recordedAtUtc}`,
    `- CI run: [${evidence.runId}, attempt ${evidence.runAttempt}](${evidence.runUrl})`,
    `- Result: ${evidence.status}; every required regression job succeeded.`, '',
    '| Required job | Result |', '| --- | --- |',
    ...Object.entries(evidence.jobs).map(([name, result]) => `| ${name} | ${result} |`), '',
    `Evidence artifact: **${evidence.artifactName}** (JSON and Markdown).`,
    `Supporting artifacts: ${evidence.reportArtifacts.map(name => `**${name}**`).join(', ')}.`, '',
    'Retain this tested commit, UTC date and CI run link in the Managing Changes guide before the workflow artifacts expire.', '',
  ].join('\n');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'regression-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(join(directory, 'regression-evidence.md'), markdown, { flag: 'wx' });
  appendFileSync(summaryFile, `\n${markdown}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Release evidence can only be generated inside GitHub Actions.');
    assert.ok(process.env.RUNNER_TEMP && process.env.GITHUB_STEP_SUMMARY, 'GitHub artifact and summary destinations are required.');
    const checkoutSha = readCheckoutSha(process.env.GITHUB_WORKSPACE);
    execFileSync('git', ['-C', process.env.GITHUB_WORKSPACE, 'diff', '--quiet', 'HEAD', '--'], {
      timeout: 10_000, maxBuffer: 1024,
    });
    const evidence = createRegressionEvidence({ env: process.env, checkoutSha });
    writeRegressionEvidence(evidence, {
      directory: join(process.env.RUNNER_TEMP, evidence.artifactName), summaryFile: process.env.GITHUB_STEP_SUMMARY,
    });
    console.log(`Recorded regression evidence for ${evidence.testedCommit}.`);
  } catch (error) {
    console.error(`Cannot record regression evidence: ${error.message}`);
    process.exitCode = 1;
  }
}
