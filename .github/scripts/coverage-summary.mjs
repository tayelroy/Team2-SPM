import { readFileSync } from 'node:fs';

const metrics = ['lines', 'statements', 'functions', 'branches'];
const rows = [
  '## Application test coverage',
  '',
  'Minimum: 80% for each metric in every application source file.',
  '',
  '| Application | Lines | Statements | Functions | Branches |',
  '| --- | ---: | ---: | ---: | ---: |',
];

for (const application of ['server', 'client']) {
  try {
    const report = JSON.parse(readFileSync(
      new URL(`../../${application}/coverage/coverage-summary.json`, import.meta.url),
      'utf8',
    ));
    if (!Object.keys(report).some((key) => key !== 'total')) {
      throw new Error('No source files were measured');
    }
    const percentages = metrics.map((metric) => {
      const percentage = report.total?.[metric]?.pct;
      if (typeof percentage !== 'number' || !Number.isFinite(percentage)) {
        throw new Error('Incomplete coverage report');
      }
      return `${percentage.toFixed(2)}%`;
    });
    rows.push(`| ${application} | ${percentages.join(' | ')} |`);
  } catch {
    rows.push(`| ${application} | Unavailable | Unavailable | Unavailable | Unavailable |`);
    process.exitCode = 1;
  }
}

rows.push('', 'Download the **application-coverage** artifact for HTML and LCOV reports.');
console.log(rows.join('\n'));
