import { writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import policy from './policy.cjs';
const { HOSTED_ORIGIN, safeResult, junit, roleId } = policy;
export default class HostedReporter {
  records = [];
  root = resolve(process.env.SPM_HOSTED_OUTPUT_DIR);
  onBegin(_config, suite) {
    this.declaredCases = suite.allTests().map(test => roleId(test.title));
    if (this.declaredCases.join(',') !== 'HOSTED-ROLE-1,HOSTED-ROLE-2,HOSTED-ROLE-3,HOSTED-ROLE-4,HOSTED-ROLE-5,HOSTED-ROLE-6,HOSTED-ROLE-7') {
      throw new Error('Hosted scope must contain exactly the reviewed seven role cases.');
    }
  }
  onTestEnd(test, result) { this.records.push(safeResult(test, result, this.root)); }
  onError() { this.runnerFailed = true; }
  // Deliberately no stdout/stderr forwarding or raw configuration/error output.
  onEnd(result) {
    const prune = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) prune(path);
        else if (!/\.(png|webm)$/.test(entry.name)) rmSync(path);
      }
    };
    if (existsSync(this.root)) prune(this.root);
    writeFileSync(join(this.root, 'report.json'), JSON.stringify({ origin: HOSTED_ORIGIN,
      scope: 'Read-only role/page smoke. Safety/Attendee prototype pages are not delivered workflow acceptance.',
      status: this.runnerFailed ? 'failed' : result.status, declaredCases: this.declaredCases, records: this.records }, null, 2) + '\n');
    writeFileSync(join(this.root, 'report.xml'), junit(this.records));
  }
}
