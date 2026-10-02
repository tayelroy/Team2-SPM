import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('./test-inventory.mjs', import.meta.url);
const valid = `import test from 'node:test'; import assert from 'node:assert/strict';
test('[NORMAL] [SG2-22:AC3] accepts a valid record', () => assert.equal(2, 2));`;
function fixture(t, source = valid, sql = '') {
  const root = mkdtempSync(join(tmpdir(), 'spm-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['docs', 'server/src', 'client/src', 'e2e', '.github/scripts', 'supabase/tests']) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, 'docs/test-acceptance-criteria.json'), JSON.stringify({ reviewDate: '2026-10-01', stories: [{ id: 'SG2-22', acceptanceCriteria: { AC3: 'Failing checks block the merge' } }] }));
  writeFileSync(join(root, 'server/src/sample.test.mjs'), source);
  if (sql) writeFileSync(join(root, 'supabase/tests/sample.sql'), sql);
  const run = (...args) => spawnSync(process.execPath, [cli.pathname, '--root', root, ...args], { encoding: 'utf8', timeout: 10_000 });
  return { root, run };
}

test('[NORMAL] [SG2-22:AC3] the CLI writes and verifies a current method ledger', t => {
  const { root, run } = fixture(t);
  assert.equal(run('--write').status, 0);
  assert.equal(run().status, 0);
  const ledger = JSON.parse(readFileSync(join(root, 'docs/test-case-inventory.json'), 'utf8'));
  assert.equal(ledger.methods.length, 1);
  assert.deepEqual(ledger.methods[0].references, [{ story: 'SG2-22', criterion: 'AC3' }]);
  assert.deepEqual(ledger.methods[0].categories, ['NORMAL']);
});

test('[CONFLICT] [SG2-22:AC3] source changes cannot pass with the previous ledger', t => {
  const { root, run } = fixture(t);
  assert.equal(run('--write').status, 0);
  writeFileSync(join(root, 'server/src/sample.test.mjs'), valid.replace('valid record', 'edited record'));
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /inventory is stale/);
});

test('[FAILURE] [SG2-22:AC3] missing category or story tags are refused', t => {
  for (const title of ['[SG2-22:AC3] unclassified', '[NORMAL] untraced']) {
    const { run } = fixture(t, valid.replace('[NORMAL] [SG2-22:AC3] accepts a valid record', title));
    const result = run('--write');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing category or story reference/);
  }
});

test('[BOUNDARY] [FAILURE] [SG2-22:AC3] an adjacent nonexistent AC and unknown story are refused', t => {
  for (const ref of ['SG2-22:AC4', 'SG2-999:AC3']) {
    const { run } = fixture(t, valid.replace('SG2-22:AC3', ref));
    const result = run('--write');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown (SG2-22:AC4|story SG2-999)/);
  }
});

test('[FAILURE] [SG2-22:AC3] todo declarations and skipped or focused suites cannot disappear from the audit', t => {
  for (const source of ["test.todo('unfinished');", "test.skip('unexecuted');", `describe.skip('omitted suite', () => { ${valid} });`, `describe.only('focused suite', () => { ${valid} });`]) {
    const { run } = fixture(t, source);
    const result = run('--write');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /focused or unexecuted/);
  }
});

test('[FAILURE] [SG2-22:AC3] duplicate method identities are refused', t => {
  const { run } = fixture(t, valid + '\n' + valid);
  const result = run('--write');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Duplicate method ID/);
});

test('[FAILURE] [SG2-22:AC3] assertion words in comments or logged strings cannot satisfy the assertion gate', t => {
  for (const body of ['// expect\n', "console.log('expect(');"]) {
    const { run } = fixture(t, `test('[NORMAL] [SG2-22:AC3] no assertion', () => { ${body} });`);
    const result = run('--write');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no observable assertion or assertion helper/);
  }
});

test('[FAILURE] [SG2-22:AC3] untagged SQL sentinels cannot be silently omitted', t => {
  const { run } = fixture(t, valid, "do $$ begin raise exception 'lost assertion'; end $$;");
  const result = run('--write');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /untagged SQL assertion/);
});

test('[NORMAL] [SG2-22:AC3] SQL export uses the denial SQLSTATE rather than a closed action-selection branch', t => {
  const { root, run } = fixture(t, valid, `do $$ begin
  begin
    if object_name = 'users' then
      insert into users values (1);
    end if;
    raise exception '[SG2-22:direct-insert] [SG2-22:AC3] [FAILURE] insert was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;`);
  const details = join(root, 'details.json');
  assert.equal(run('--write', '--details', details).status, 0);
  const ledger = JSON.parse(readFileSync(details, 'utf8'));
  assert.match(ledger.sqlAssertions[0].expectedAssertions[0], /^Reject with insufficient_privilege:/);
  assert.doesNotMatch(ledger.sqlAssertions[0].expectedAssertions[0], /^Must be false:/);
});
