// Disposable CI PostgreSQL only. This deliberately changes schema inside a
// transaction which is rolled back when psql exits, including on expected errors.
// Never provide a hosted database connection or run mutations through SQL Editor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/checks/release_readiness.sql', import.meta.url), 'utf8');

function run(mutation = '') {
  const container = process.env.POSTGRES_CONTAINER;
  assert.match(container ?? '', /^[a-zA-Z0-9_.-]{1,128}$/, 'Set POSTGRES_CONTAINER to the disposable CI PostgreSQL container.');
  const input = mutation
    ? `BEGIN;\n${mutation}\n${sql}\nROLLBACK;\n`
    : `BEGIN READ ONLY;\n${sql}\nROLLBACK;\n`;
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1'], {
    input,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 65536,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function assertReadinessRejects(mutation, ...missingContracts) {
  const result = run(mutation);
  assert.notEqual(result.status, 0, 'The release gate must fail after the schema is damaged.');
  assert.match(result.output, /Release (schema|role catalogue) readiness failed:/);
  for (const contract of missingContracts) assert.ok(result.output.includes(contract), `Missing diagnostic: ${contract}`);
  // The failing connection must have rolled its transaction back: prove that a
  // subsequent independent, read-only check sees the original healthy schema.
  const restored = run();
  assert.equal(restored.status, 0, restored.output);
}

test('[NORMAL] [SG2-22:AC3] release readiness passes in an explicit read-only transaction after all migrations', () => {
  const result = run();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /ready/);
});

test('[BOUNDARY] [SG2-23:AC1] structural readiness does not require personal demo accounts or event content', () => {
  const result = run('TRUNCATE public.users CASCADE;');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /ready/);
});

test('[FAILURE] [SG2-22:AC3] missing hosted completion and submission columns block release with named diagnostics', () => {
  assertReadinessRejects('ALTER TABLE public.events DROP COLUMN completed_by CASCADE, DROP COLUMN completed_at CASCADE, DROP COLUMN submitted_at CASCADE;',
    'public.events.completed_by', 'public.events.completed_at', 'public.events.submitted_at');
});

test('[CONFLICT] [SG2-22:AC3] a stale work queue view cannot pass merely because its backing columns exist', () => {
  assertReadinessRejects(`DO $$ BEGIN
    EXECUTE 'CREATE OR REPLACE VIEW public.internal_work_items AS ' ||
      replace(pg_get_viewdef('public.internal_work_items'::regclass), '''planning_notes''', '''legacy_planning_notes''');
  END $$;`, 'internal_work_items planning key planning_notes');
});

test('[FAILURE] [SG2-23:AC1] missing Safety Officer role catalogue entry blocks release without requiring a seeded login', () => {
  assertReadinessRejects("UPDATE public.roles SET role_name = 'Retired Safety Officer' WHERE role_name = 'Safety Officer';", 'Safety Officer');
});

test('[FAILURE] [SG2-25:AC2] a missing privileged view read grant blocks release even with an intact schema', () => {
  assertReadinessRejects('REVOKE SELECT ON public.internal_work_items FROM service_role;', 'service_role SELECT public.internal_work_items');
});
