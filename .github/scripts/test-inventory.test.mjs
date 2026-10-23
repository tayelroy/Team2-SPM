import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('./test-inventory.mjs', import.meta.url);
const valid = `import test from 'node:test'; import assert from 'node:assert/strict';
test('[NORMAL] [SG2-22:AC3] accepts a valid record', () => assert.equal(2, 2));`;
function fixture(t, source = valid, sql = '') {
  const root = mkdtempSync(join(tmpdir(), 'spm-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['docs', 'server/src', 'client/src', 'e2e', 'integration', '.github/scripts', 'supabase/tests']) mkdirSync(join(root, directory), { recursive: true });
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
  assert.equal(ledger.methods[0].file, 'server/src/sample.test.mjs');
  assert.equal(ledger.methods[0].title, '[NORMAL] [SG2-22:AC3] accepts a valid record');
  assert.equal(Object.hasOwn(ledger.methods[0], 'id'), false);
  assert.equal(Object.hasOwn(ledger.methods[0], 'legacyId'), false);
  assert.deepEqual(ledger.methods[0].references, [{ story: 'SG2-22', criterion: 'AC3' }]);
  assert.deepEqual(ledger.methods[0].categories, ['NORMAL']);
});

test('[NORMAL] [BOUNDARY] [SG2-22:AC3] readable IDs and legacy aliases agree across exports and ignore line-only changes', t => {
  const { root, run } = fixture(t);
  const details = join(root, 'details.json');
  assert.equal(run('--write', '--details', details).status, 0);
  const first = JSON.parse(readFileSync(details, 'utf8')).methods[0];
  writeFileSync(join(root, 'server/src/sample.test.mjs'), '\n// Source formatting does not rename a case.\n' + valid);
  assert.equal(run('--write', '--details', details).status, 0);
  const after = JSON.parse(readFileSync(details, 'utf8')).methods[0];
  const committed = JSON.parse(readFileSync(join(root, 'docs/test-case-inventory.json'), 'utf8')).methods[0];
  assert.equal(after.id, 'SG2-22:accepts-a-valid-record');
  assert.equal(after.id, first.id);
  assert.equal(after.legacyId, first.legacyId);
  assert.equal(after.legacyId, 'TC-45b544aaf96a');
  assert.equal(committed.file, after.file);
  assert.equal(committed.line, after.line);
  assert.equal(committed.title, after.title);
  assert.deepEqual(committed.categories, after.categories);
  assert.deepEqual(committed.references, after.references);
  assert.ok(after.line > first.line);
});

test('[CONFLICT] [BOUNDARY] [SG2-22:AC3] equal readable names remain distinct across files and punctuation without changing explicit SQL IDs', t => {
  const sql = `do $$ begin
    raise exception '[SG2-22:accepts-a-valid-record] [SG2-22:AC3] [FAILURE] invalid record accepted';
  end $$;`;
  const { root, run } = fixture(t, valid + '\n' + valid.replace('accepts a valid record', 'accepts-a-valid-record'), sql);
  writeFileSync(join(root, 'client/src/sample.test.mjs'), valid);
  const details = join(root, 'details.json');
  assert.equal(run('--write', '--details', details).status, 0);
  const inventory = JSON.parse(readFileSync(details, 'utf8'));
  const ids = inventory.methods.map(method => method.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every(id => /^SG2-22:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)));
  assert.ok(ids.some(id => id.includes('client-src-sample')));
  assert.equal(ids.filter(id => id.includes('server-src-sample')).length, 2);
  assert.ok(ids.some(id => /-1$/.test(id)));
  assert.ok(ids.some(id => /-2$/.test(id)));
  assert.equal(inventory.sqlAssertions[0].id, 'SG2-22:accepts-a-valid-record');
  assert.ok(ids.every(id => id !== inventory.sqlAssertions[0].id));
  const firstIds = [...ids];
  assert.equal(run('--write', '--details', details).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(details, 'utf8')).methods.map(method => method.id), firstIds);

  const single = fixture(t, valid, sql);
  const singleDetails = join(single.root, 'details.json');
  assert.equal(single.run('--write', '--details', singleDetails).status, 0);
  const singleInventory = JSON.parse(readFileSync(singleDetails, 'utf8'));
  assert.equal(singleInventory.methods[0].id, 'SG2-22:accepts-a-valid-record-server-src-sample');
  assert.equal(singleInventory.sqlAssertions[0].id, 'SG2-22:accepts-a-valid-record');
});

test('[BOUNDARY] [SG2-22:AC3] long Unicode titles have readable bounded IDs while legacy aliases remain distinct', t => {
  const prefix = 'Café ' + 'a'.repeat(120);
  const source = valid.replace('accepts a valid record', prefix + ' one') + '\n'
    + valid.replace('accepts a valid record', prefix + ' two');
  const { root, run } = fixture(t, source);
  const details = join(root, 'details.json');
  assert.equal(run('--write', '--details', details).status, 0);
  const methods = JSON.parse(readFileSync(details, 'utf8')).methods;
  assert.equal(new Set(methods.map(method => method.id)).size, 2);
  assert.equal(new Set(methods.map(method => method.legacyId)).size, 2);
  assert.ok(methods.every(method => method.id.startsWith('SG2-22:cafe-')));
  assert.ok(methods.every(method => method.id.startsWith('SG2-22:cafe-server-src-sample-')));
  assert.ok(methods.every(method => method.id.length < 220));
  const wholeWords = fixture(t, valid.replace('accepts a valid record', 'word '.repeat(18) + 'lengthyword remainder'));
  const wholeWordDetails = join(wholeWords.root, 'details.json');
  assert.equal(wholeWords.run('--write', '--details', wholeWordDetails).status, 0);
  const wholeWordId = JSON.parse(readFileSync(wholeWordDetails, 'utf8')).methods[0].id;
  assert.equal(wholeWordId, 'SG2-22:' + Array(18).fill('word').join('-'));
});

test('[CONFLICT] [SG2-22:AC3] duplicate Supabase migration versions block the deployment inventory gate until renumbered', t => {
  const { root, run } = fixture(t);
  const directory = join(root, 'supabase/migrations');
  mkdirSync(directory);
  writeFileSync(join(directory, '202610200002_acting_role_functions.sql'), 'SELECT 1;');
  writeFileSync(join(directory, '202610200002_notifications_inbox_reminders.sql'), 'SELECT 2;');
  const rejected = run('--write');
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Duplicate migration version 202610200002: 202610200002_acting_role_functions.sql, 202610200002_notifications_inbox_reminders.sql/);
  renameSync(join(directory, '202610200002_notifications_inbox_reminders.sql'), join(directory, '202610200003_notifications_inbox_reminders.sql'));
  assert.equal(run('--write').status, 0);
  assert.equal(run().status, 0);
});

test('[BOUNDARY] [CONFLICT] [SG2-22:AC3] the exact historical migration pair remains accepted while another collision is refused', t => {
  const { root, run } = fixture(t);
  const directory = join(root, 'supabase/migrations');
  mkdirSync(directory);
  for (const name of ['202609220001_internal_work_queue.sql', '202609220001_venue_layouts.sql']) {
    writeFileSync(join(directory, name), 'SELECT 1;');
  }
  assert.equal(run('--write').status, 0);
  assert.equal(run().status, 0);
  writeFileSync(join(directory, '202609220001_unreleased.sql'), 'SELECT 3;');
  const rejected = run('--write');
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Duplicate migration version 202609220001:/);
});

test('[NORMAL] [SG2-22:AC3] database integration declarations enter the same auditable ledger', t => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'integration/app.test.mjs'), valid.replace('valid record', 'real database response'));
  const details = join(root, 'details.json');
  assert.equal(run('--write', '--details', details).status, 0);
  const ledger = JSON.parse(readFileSync(details, 'utf8'));
  const method = ledger.methods.find(item => item.file === 'integration/app.test.mjs');
  assert.equal(ledger.methods.length, 2);
  assert.equal(method.title, '[NORMAL] [SG2-22:AC3] accepts a real database response');
  assert.match(method.preconditions, /Disposable local PostgreSQL and PostgREST/);
  assert.match(method.preconditions, /No hosted Supabase/);
});

test('[BOUNDARY] [SG2-22:AC3] an empty integration directory adds no phantom test cases', t => {
  const { root, run } = fixture(t);
  assert.equal(run('--write').status, 0);
  const ledger = JSON.parse(readFileSync(join(root, 'docs/test-case-inventory.json'), 'utf8'));
  assert.equal(ledger.methods.length, 1);
  assert.equal(ledger.methods[0].file, 'server/src/sample.test.mjs');
});

test('[CONFLICT] [SG2-22:AC3] changed integration cases invalidate an earlier test register', t => {
  const { root, run } = fixture(t);
  const path = join(root, 'integration/app.test.mjs');
  writeFileSync(path, valid);
  assert.equal(run('--write').status, 0);
  writeFileSync(path, valid.replace('valid record', 'updated database contract'));
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /inventory is stale/);
});

test('[FAILURE] [SG2-22:AC3] integration tests cannot bypass category and story traceability', t => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'integration/app.test.mjs'), valid.replace('[NORMAL] [SG2-22:AC3] ', ''));
  const result = run('--write');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /integration\/app.test.mjs.*missing category or story reference/);
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


test('[NORMAL] [BOUNDARY] [SG2-22:AC3] optional hosted role declarations enter the ledger without a hosted directory being required', t => {
  const { root, run } = fixture(t);
  assert.equal(run('--write').status, 0);
  mkdirSync(join(root, 'hosted-e2e'));
  writeFileSync(join(root, 'hosted-e2e/roles.spec.ts'), valid.replace('valid record', 'read-only hosted role page'));
  const details=join(root,'hosted-details.json');
  assert.equal(run('--write','--details',details).status,0);
  const inventory=JSON.parse(readFileSync(details,'utf8'));
  const hosted=inventory.methods.find(item=>item.file==='hosted-e2e/roles.spec.ts');
  assert.equal(inventory.methods.length,2);
  assert.match(hosted.preconditions,/explicitly authorised authenticated shared-staging/);
  assert.match(hosted.preconditions,/runtime-only password/);
  assert.match(hosted.preconditions,/Not run by default CI/);
});
