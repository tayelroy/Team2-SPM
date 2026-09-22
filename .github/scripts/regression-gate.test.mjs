import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkRegressionReport, REQUIRED_REGRESSIONS } from './regression-gate.mjs';

// These are the acceptance contract, not values derived from the gate under test.
// Otherwise removing an ID from the gate would also remove it from our fixture.
const ACCEPTANCE_CASE_IDS = ['SG2-26-P01', 'SG2-26-P02', 'SG2-26-N01', 'SG2-26-N02'];

function passingTest(projectName = 'chromium') {
  return { projectName, expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] };
}

function passingReport() {
  return {
    suites: [{ suites: [{ specs: ACCEPTANCE_CASE_IDS.map((id) => ({
      title: `${id} | acceptance case`,
      tests: [passingTest()],
    })) }] }],
    errors: [],
  };
}

function specs(report) {
  return report.suites[0].suites[0].specs;
}

test('all required acceptance cases must execute and pass', () => {
  assert.deepEqual(REQUIRED_REGRESSIONS, ACCEPTANCE_CASE_IDS);
  assert.deepEqual(checkRegressionReport(passingReport()), []);
});

test('missing cases fail even when all remaining tests pass', () => {
  const report = passingReport();
  specs(report).pop();
  assert.match(checkRegressionReport(report).join('\n'), /SG2-26-N02: required regression is missing/);
});

test('similar IDs cannot satisfy a required case', () => {
  const report = passingReport();
  specs(report)[0].title = 'SG2-26-P010 | a different test';
  assert.match(checkRegressionReport(report).join('\n'), /SG2-26-P01: required regression is missing/);
});

for (const status of ['skipped', 'failed', 'timedOut', 'interrupted']) {
  test(`a ${status} result fails even if the reported outcome is expected`, () => {
    const report = passingReport();
    specs(report)[0].tests[0].results[0].status = status;
    assert.match(checkRegressionReport(report).join('\n'), /every executed attempt must pass/);
  });
}

test('test.fail annotations cannot turn a failing acceptance case green', () => {
  const report = passingReport();
  Object.assign(specs(report)[0].tests[0], { expectedStatus: 'failed', results: [{ status: 'failed' }] });
  assert.match(checkRegressionReport(report).join('\n'), /expectedStatus must be passed/);
});

test('flaky cases cannot pass by succeeding on a retry', () => {
  const report = passingReport();
  Object.assign(specs(report)[0].tests[0], {
    status: 'flaky', results: [{ status: 'failed' }, { status: 'passed' }],
  });
  const failures = checkRegressionReport(report).join('\n');
  assert.match(failures, /outcome must be expected/);
  assert.match(failures, /every executed attempt must pass/);
});

test('a passing project cannot hide a skipped project or duplicate required case', () => {
  for (const duplicateSpec of [false, true]) {
    const report = passingReport();
    const skipped = { ...passingTest('firefox'), status: 'skipped', results: [{ status: 'skipped' }] };
    if (duplicateSpec) specs(report).push({ ...specs(report)[0], tests: [skipped] });
    else specs(report)[0].tests.push(skipped);
    const failures = checkRegressionReport(report).join('\n');
    assert.match(failures, /SG2-26-P01 \(firefox\): outcome must be expected/);
    assert.match(failures, /SG2-26-P01 \(firefox\): every executed attempt must pass/);
    assert.doesNotMatch(failures, /chromium/);
  }
});

test('unexecuted cases and cases with no project results fail', () => {
  const report = passingReport();
  specs(report)[0].tests[0].results = [];
  specs(report)[1].tests = [];
  const failures = checkRegressionReport(report).join('\n');
  assert.match(failures, /the test did not execute/);
  assert.match(failures, /no project test results/);
});

test('missing report structure and runner errors fail', () => {
  for (const report of [null, {}]) {
    assert.deepEqual(checkRegressionReport(report), ['The Playwright report must contain a suites array.']);
  }
  assert.deepEqual(checkRegressionReport({ suites: [] }), ACCEPTANCE_CASE_IDS.map(
    (id) => `${id}: required regression is missing from the report.`,
  ));
  const report = passingReport();
  report.errors.push({ message: 'global setup failed' });
  assert.match(checkRegressionReport(report).join('\n'), /runner errors/);
});

test('CLI exits nonzero for unreadable, malformed or failing reports and zero for passing reports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sg2-26-gate-'));
  const path = join(directory, 'report.json');
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./regression-gate.mjs', import.meta.url)), path], {
    encoding: 'utf8', timeout: 5_000,
  });
  try {
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Cannot validate required SG2-26 regressions:.*ENOENT/);
    writeFileSync(path, 'invalid json');
    const malformed = run();
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /Cannot validate required SG2-26 regressions:/);
    writeFileSync(path, JSON.stringify({ suites: [] }));
    const failing = run();
    assert.equal(failing.status, 1);
    assert.match(failing.stderr, /SG2-26-P01: required regression is missing/);
    writeFileSync(path, JSON.stringify(passingReport()));
    const result = run();
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Required SG2-26 regressions passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
