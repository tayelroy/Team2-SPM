import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REQUIRED_REGRESSIONS = Object.freeze([
  'SG2-26-P01',
  'SG2-26-P02',
  'SG2-26-N01',
  'SG2-26-N02',
]);

// Playwright can exit successfully when a test is skipped or marked test.fail().
// Required acceptance cases must actually execute and pass in every project.
export function checkRegressionReport(report) {
  const failures = [];
  const found = new Set();

  if (!report || !Array.isArray(report.suites)) {
    return ['The Playwright report must contain a suites array.'];
  }
  if (report.errors?.length) failures.push('The Playwright report contains runner errors.');

  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        const id = REQUIRED_REGRESSIONS.find((candidate) =>
          typeof spec.title === 'string' &&
          new RegExp(`^${candidate}(?=$|[^A-Za-z0-9-])`).test(spec.title),
        );
        if (!id) continue;
        found.add(id);
        if (!Array.isArray(spec.tests) || spec.tests.length === 0) {
          failures.push(`${id}: no project test results were recorded.`);
          continue;
        }
        for (const test of spec.tests) {
          const label = `${id} (${test.projectName || 'unnamed project'})`;
          if (test.expectedStatus !== 'passed') {
            failures.push(`${label}: expectedStatus must be passed, received ${test.expectedStatus}.`);
          }
          if (test.status !== 'expected') {
            failures.push(`${label}: outcome must be expected, received ${test.status}.`);
          }
          if (!Array.isArray(test.results) || test.results.length === 0) {
            failures.push(`${label}: the test did not execute.`);
          } else if (test.results.some((result) => result.status !== 'passed')) {
            failures.push(`${label}: every executed attempt must pass.`);
          }
        }
      }
      visit(suite.suites ?? []);
    }
  }

  visit(report.suites);
  for (const id of REQUIRED_REGRESSIONS) {
    if (!found.has(id)) failures.push(`${id}: required regression is missing from the report.`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const reportPath = process.argv[2] ?? 'test-results/regression.json';
    const failures = checkRegressionReport(JSON.parse(readFileSync(reportPath, 'utf8')));
    if (failures.length) {
      console.error(`Required SG2-26 regressions failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log(`Required SG2-26 regressions passed: ${REQUIRED_REGRESSIONS.join(', ')}`);
    }
  } catch (error) {
    console.error(`Cannot validate required SG2-26 regressions: ${error.message}`);
    process.exitCode = 1;
  }
}
