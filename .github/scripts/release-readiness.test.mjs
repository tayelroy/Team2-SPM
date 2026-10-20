// Disposable CI PostgreSQL only. This deliberately changes schema inside a
// transaction which is rolled back when psql exits, including on expected errors.
// Never provide a hosted database connection or run mutations through SQL Editor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/checks/release_readiness.sql', import.meta.url), 'utf8');
const confirmationRepair = readFileSync(new URL('../../supabase/migrations/202610160005_event_confirmation_record_repair.sql', import.meta.url), 'utf8')
  .replace(/^begin;\s*$/mi, '').replace(/^commit;\s*$/mi, '');

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

test('[FAILURE] [SG2-58:AC1] missing confirmation record columns block release even when the RPC exists', () => {
  assertReadinessRejects('ALTER TABLE public.events DROP COLUMN confirmed_by CASCADE, DROP COLUMN confirmed_at CASCADE;',
    'public.events.confirmed_by', 'public.events.confirmed_at');
});

test('[CONFLICT] [SG2-58:AC1] wrong confirmation types or missing record constraints block release', () => {
  for (const [mutation, diagnostic] of [
    ['ALTER TABLE public.events DROP CONSTRAINT events_confirmation_recorded_together;', 'confirmation record pair constraint'],
    ['ALTER TABLE public.events DROP CONSTRAINT events_confirmed_by_fkey;', 'embed FK public.events.confirmed_by'],
    ['ALTER TABLE public.events ALTER COLUMN confirmed_at TYPE text USING confirmed_at::text;', 'type public.events.confirmed_at = timestamptz'],
  ]) assertReadinessRejects(mutation, diagnostic);
});

test('[NORMAL] [BOUNDARY] [SG2-58:AC1] additive confirmation record repair is repeatable and preserves the installed RPC', () => {
  const result = run(`CREATE TEMP TABLE confirmation_repair_baseline AS
      SELECT md5(pg_get_functiondef('public.confirm_event(integer)'::regprocedure)) AS hash;
    ALTER TABLE public.events DROP COLUMN confirmed_by CASCADE, DROP COLUMN confirmed_at CASCADE;
    ${confirmationRepair}
    ${confirmationRepair}
    DO $$ BEGIN
      IF md5(pg_get_functiondef('public.confirm_event(integer)'::regprocedure))
          IS DISTINCT FROM (SELECT hash FROM confirmation_repair_baseline) THEN
        RAISE EXCEPTION 'The additive repair must not replace the tested confirmation function';
      END IF;
    END $$;`);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /ready/);
});

test('[FAILURE] [SG2-58:AC1] confirmation record repair refuses incompatible types, foreign keys and pair constraints', () => {
  for (const mutation of [
    'ALTER TABLE public.events ALTER COLUMN confirmed_at TYPE text USING confirmed_at::text;',
    `ALTER TABLE public.events DROP CONSTRAINT events_confirmed_by_fkey;
      ALTER TABLE public.events ADD CONSTRAINT events_confirmed_by_fkey FOREIGN KEY(confirmed_by) REFERENCES auth.users(id) NOT VALID;`,
    `ALTER TABLE public.events DROP CONSTRAINT events_confirmation_recorded_together;
      ALTER TABLE public.events ADD CONSTRAINT events_confirmation_recorded_together CHECK(confirmed_by IS NULL OR confirmed_at IS NULL) NOT VALID;`,
  ]) {
    const result = run(`${mutation}\n${confirmationRepair}`);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Confirmation record repair.*incompatible/);
    const restored = run();
    assert.equal(restored.status, 0, restored.output);
  }
});

test('[CONFLICT] [SG2-22:AC3] a stale work queue view cannot pass merely because its backing columns exist', () => {
  assertReadinessRejects(`DO $$ BEGIN
    EXECUTE 'CREATE OR REPLACE VIEW public.internal_work_items AS ' ||
      replace(pg_get_viewdef('public.internal_work_items'::regclass), '''planning_notes''', '''legacy_planning_notes''');
  END $$;`, 'internal_work_items planning key planning_notes');
});

test('[CONFLICT] [SG2-39:AC2] [SG2-58:AC2] a stale confirmation RPC missing any known planning recheck blocks release', () => {
  for (const marker of ['venue_recheck', 'equipment_recheck', 'registration_recheck']) {
    assertReadinessRejects(`DO $$ BEGIN
      EXECUTE replace(pg_get_functiondef('public.confirm_event(integer)'::regprocedure),
        '${marker}', 'legacy_${marker}');
    END $$;`, `confirm_event planning recheck ${marker}`);
  }
});

test('[CONFLICT] [SG2-81:AC2] [SG2-58:AC2] a stale confirmation RPC missing the venue disruption guard blocks release', () => {
  assertReadinessRejects(`DO $$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.confirm_event(integer)'::regprocedure),
      'public.venue_booking_disruptions', 'public.legacy_venue_booking_disruptions');
  END $$;`, 'confirm_event venue disruption guard');
});

test('[FAILURE] [SG2-23:AC1] missing Safety Officer role catalogue entry blocks release without requiring a seeded login', () => {
  assertReadinessRejects("UPDATE public.roles SET role_name = 'Retired Safety Officer' WHERE role_name = 'Safety Officer';", 'Safety Officer');
});

test('[FAILURE] [SG2-25:AC2] a missing privileged view read grant blocks release even with an intact schema', () => {
  assertReadinessRejects('REVOKE SELECT ON public.internal_work_items FROM service_role;', 'service_role SELECT public.internal_work_items');
});

test('[FAILURE] [SG2-40:AC2] release readiness refuses a missing atomic draft audit RPC', () => {
  assertReadinessRejects('DROP FUNCTION public.update_event_request_draft(integer,uuid,jsonb);',
    'RPC public.update_event_request_draft(integer,uuid,jsonb)');
});

test('[FAILURE] [SG2-25:AC2] [SG2-40:AC2] release readiness requires service-only execution of the draft audit RPC', () => {
  for (const [mutation, diagnostic] of [
    ['REVOKE EXECUTE ON FUNCTION public.update_event_request_draft(integer,uuid,jsonb) FROM service_role;', 'draft audit RPC EXECUTE service_role = true'],
    ['GRANT EXECUTE ON FUNCTION public.update_event_request_draft(integer,uuid,jsonb) TO anon;', 'draft audit RPC EXECUTE anon = false'],
    ['GRANT EXECUTE ON FUNCTION public.update_event_request_draft(integer,uuid,jsonb) TO authenticated;', 'draft audit RPC EXECUTE authenticated = false'],
    ['GRANT EXECUTE ON FUNCTION public.update_event_request_draft(integer,uuid,jsonb) TO PUBLIC;', 'draft audit RPC EXECUTE anon = false'],
  ]) assertReadinessRejects(mutation, diagnostic);
});

test('[FAILURE] [SG2-22:AC3] [SG2-68:AC1] [SG2-58:AC1] legacy notification kinds block release before lifecycle writes fail', () => {
  assertReadinessRejects(`TRUNCATE public.notifications;
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check,
      ADD CONSTRAINT notifications_kind_check CHECK (kind IN
        ('venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
         'equipment_reserved', 'venue_booking_clash'));`,
  'notifications_kind_check allows event_confirmed',
  'notifications_kind_check allows event_submitted',
  'notifications_kind_check allows coordinator_assigned',
  'notifications_kind_check allows clarification_requested',
  'notifications_kind_check allows event_approved',
  'notifications_kind_check allows event_rejected');
});

test('[FAILURE] [SG2-77:AC5] release readiness refuses a missing operations identity RPC', () => {
  assertReadinessRejects('DROP FUNCTION public.venue_exists_for_operations_read(integer);',
    'RPC public.venue_exists_for_operations_read(integer)');
});

test('[FAILURE] [SG2-25:AC2] [SG2-77:AC6] release readiness requires authenticated-only execution of the operations identity RPC', () => {
  for (const [mutation, diagnostic] of [
    ['REVOKE EXECUTE ON FUNCTION public.venue_exists_for_operations_read(integer) FROM authenticated;', 'operations identity RPC EXECUTE authenticated = true'],
    ['GRANT EXECUTE ON FUNCTION public.venue_exists_for_operations_read(integer) TO anon;', 'operations identity RPC EXECUTE anon = false'],
    ['GRANT EXECUTE ON FUNCTION public.venue_exists_for_operations_read(integer) TO service_role;', 'operations identity RPC EXECUTE service_role = false'],
    ['GRANT EXECUTE ON FUNCTION public.venue_exists_for_operations_read(integer) TO PUBLIC;', 'operations identity RPC EXECUTE anon = false'],
  ]) assertReadinessRejects(mutation, diagnostic);
});

test('[SG2-69:release-read-state-columns] [SG2-69:AC1] [FAILURE] deployment requires both real read receipt columns', () => {
  assertReadinessRejects('ALTER TABLE public.notifications DROP COLUMN read_at; ALTER TABLE public.venue_hold_notifications DROP COLUMN read_at;',
    'column public.notifications.read_at', 'column public.venue_hold_notifications.read_at');
});

test('[SG2-69:release-reminder-kind] [SG2-69:AC5] [FAILURE] deployment refuses a notification constraint missing the reminder kind', () => {
  assertReadinessRejects(`TRUNCATE public.notifications; DO $$ DECLARE definition text; BEGIN
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND conname='notifications_kind_check';
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
    EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check ' || replace(definition,
      '''outstanding_arrangements''', '''old_outstanding_arrangements''');
  END $$;`, 'notifications_kind_check allows outstanding_arrangements');
});

test('[SG2-69:release-inbox-grants] [SG2-69:AC1] [SG2-69:AC7] [FAILURE] deployment enforces caller inbox and service scheduler privilege separation', () => {
  for (const [mutation, diagnostic] of [
    ['REVOKE EXECUTE ON FUNCTION public.notification_inbox(integer,timestamptz,text,bigint) FROM authenticated;', 'notification RPC EXECUTE public.notification_inbox(integer,timestamptz,text,bigint) authenticated'],
    ['GRANT EXECUTE ON FUNCTION public.send_outstanding_arrangement_reminders() TO authenticated;', 'notification RPC EXECUTE public.send_outstanding_arrangement_reminders() authenticated'],
    ['GRANT EXECUTE ON FUNCTION public.notification_unread_count(uuid) TO anon;', 'notification RPC EXECUTE public.notification_unread_count(uuid) anon'],
    ['REVOKE EXECUTE ON FUNCTION public.send_outstanding_arrangement_reminders() FROM service_role;', 'notification RPC EXECUTE public.send_outstanding_arrangement_reminders() service_role'],
  ]) assertReadinessRejects(mutation, diagnostic);
});

test('[SG2-69:release-private-preferences] [SG2-69:AC6] [SG2-69:AC7] [FAILURE] deployment refuses disabled reminder RLS or direct caller grants', () => {
  for (const mutation of [
    'ALTER TABLE public.notification_reminder_settings DISABLE ROW LEVEL SECURITY;',
    'GRANT SELECT ON public.notification_reminder_settings TO authenticated;',
    'GRANT INSERT ON public.notification_reminder_settings TO anon;',
  ]) assertReadinessRejects(mutation, 'notification private RLS and grants public.notification_reminder_settings');
});

test('[SG2-69:release-empty-function-search-path] [SG2-69:AC7] [FAILURE] deployment requires the inbox functions to retain fixed empty search paths', () => {
  assertReadinessRejects('ALTER FUNCTION public.read_notification(text,bigint) SET search_path=public;',
    'notification RPC security definer empty search_path public.read_notification(text,bigint)');
});

test('[SG2-69:release-acting-role-dependencies] [SG2-69:AC7] [SG2-104:AC2] [FAILURE] deployment refuses missing acting-role or private relationship dependencies', () => {
  for (const [signature, replacement] of [
    ['public.acting_role()', 'readiness_missing_acting_role'],
    ['public.lock_acting_role()', 'readiness_missing_lock_acting_role'],
    ['private.event_relationship_exists(integer,text)', 'readiness_missing_event_relationship'],
  ]) assertReadinessRejects(`ALTER FUNCTION ${signature} RENAME TO ${replacement};`, `RPC ${signature}`);
});
