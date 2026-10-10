-- SG2-40: planning notes are internal-only history entries.
-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Disposable local/CI test script. All changes are rolled back.
begin;

-- 1: coordinator, 2: owning organiser, 3: safety officer (internal)
insert into auth.users (id) values
  ('c4000000-0000-4000-8000-000000000001'),
  ('c4000000-0000-4000-8000-000000000002'),
  ('c4000000-0000-4000-8000-000000000003');

insert into public.users (user_id, name, organisation, role_id) values
  ('c4000000-0000-4000-8000-000000000001', 'Coordinator C', 'Acme Corp', 2),
  ('c4000000-0000-4000-8000-000000000002', 'Organiser O', 'Acme Corp', 1),
  ('c4000000-0000-4000-8000-000000000003', 'Safety S', 'Acme Corp', 7);

insert into public.account_roles (user_id, role) values
  ('c4000000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('c4000000-0000-4000-8000-000000000002', 'event_organiser'),
  ('c4000000-0000-4000-8000-000000000003', 'safety_officer');

insert into public.events (event_id, organiser_id, coordinator_id, organisation, name, status) values
  (94001, 'c4000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000001',
   'Acme Corp', 'Event With Notes', 'planning');

insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value) values
  (94001, 'c4000000-0000-4000-8000-000000000001', 'planning_notes', null, 'Internal coordinator note'),
  (94001, 'c4000000-0000-4000-8000-000000000001', 'expected_attendance', '50', '80'),
  (94001, 'c4000000-0000-4000-8000-000000000002', 'status', 'draft', 'unassigned');

set local role authenticated;

-- The owning organiser reads every entry except the internal planning notes.
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.event_audit_logs where field_name = 'planning_notes') then
    raise exception '[SG2-40:organiser-planning-notes-hidden] [SG2-40:AC3] [FAILURE] The organiser must not read planning-notes history';
  end if;
  if (select array_agg(field_name order by field_name) from public.event_audit_logs where event_id = 94001)
      is distinct from array['expected_attendance', 'status'] then
    raise exception '[SG2-40:organiser-other-history-visible] [SG2-40:AC1] [NORMAL] The organiser must still read the event''s other history entries';
  end if;
end $$;

-- Internal staff (the assigned coordinator and a Safety Officer) read all three.
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if not exists (select 1 from public.event_audit_logs where event_id = 94001
      and field_name = 'planning_notes' and new_value = 'Internal coordinator note') then
    raise exception '[SG2-40:coordinator-planning-notes-visible] [SG2-40:AC3] [NORMAL] The coordinator must read planning-notes history';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"c4000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs where event_id = 94001) <> 3 then
    raise exception '[SG2-40:internal-staff-full-history] [SG2-40:AC3] [NORMAL] Internal staff must read every history entry, planning notes included';
  end if;
end $$;
reset role;
rollback;
