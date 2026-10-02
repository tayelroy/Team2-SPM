-- Review trace: original PR #44 (SG2-39), 50 (SG2-40).
-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-39 & SG2-40: Event planning fields and audit log policy checks.
-- Disposable local/CI test script. All changes are rolled back.
begin;

-- Seed test identities:
-- 1: coordinator (internal staff)
-- 2: organiser A (owns event 93901)
-- 3: organiser B (owns event 93902)
-- 4: attendee (external user)
-- 5: venue staff (internal staff)
-- 6: technical support staff (internal staff)
insert into auth.users (id) values
  ('c0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000003'),
  ('c0000000-0000-4000-8000-000000000004'),
  ('c0000000-0000-4000-8000-000000000005'),
  ('c0000000-0000-4000-8000-000000000006');

insert into public.users (user_id, name, organisation, role_id) values
  ('c0000000-0000-4000-8000-000000000001', 'Coordinator C', 'Acme Corp', 2),
  ('c0000000-0000-4000-8000-000000000002', 'Organiser A', 'Acme Corp', 1),
  ('c0000000-0000-4000-8000-000000000003', 'Organiser B', 'Beta Inc', 1),
  ('c0000000-0000-4000-8000-000000000004', 'Attendee D', 'Acme Corp', 5),
  ('c0000000-0000-4000-8000-000000000005', 'Venue Staff V', 'Acme Corp', 3),
  ('c0000000-0000-4000-8000-000000000006', 'Tech Support T', 'Acme Corp', 4);

insert into public.account_roles (user_id, role) values
  ('c0000000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('c0000000-0000-4000-8000-000000000002', 'event_organiser'),
  ('c0000000-0000-4000-8000-000000000003', 'event_organiser'),
  ('c0000000-0000-4000-8000-000000000004', 'attendee'),
  ('c0000000-0000-4000-8000-000000000005', 'venue_staff'),
  ('c0000000-0000-4000-8000-000000000006', 'technical_support_staff');

insert into public.events (
  event_id, organiser_id, coordinator_id, organisation, name, status,
  registration_capacity, registration_opens_at, registration_closes_at, planning_notes,
  arrangements_recheck_needed, outstanding_arrangements
) values
  (93901, 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Acme Corp', 'Event A', 'planning',
   100, '2026-10-01 09:00:00+00', '2026-10-15 18:00:00+00', 'Initial notes', true, '["venue_recheck"]'::jsonb),
  (93902, 'c0000000-0000-4000-8000-000000000003', null, 'Beta Inc', 'Event B', 'planning',
   200, '2026-11-01 09:00:00+00', '2026-11-15 18:00:00+00', null, false, '[]'::jsonb);

insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value, created_at) values
  (93901, 'c0000000-0000-4000-8000-000000000001', 'expected_attendance', '50', '100', '2026-10-01 08:00:00+00'),
  (93902, 'c0000000-0000-4000-8000-000000000003', 'expected_attendance', '100', '200', '2026-10-01 09:00:00+00');

-- 1. Check constraints on public.events:
do $$
begin
  if not exists (select 1 from public.events where event_id = 93901
      and status = 'planning' and registration_capacity = 100
      and registration_opens_at = '2026-10-01 09:00:00+00' and registration_closes_at = '2026-10-15 18:00:00+00'
      and planning_notes = 'Initial notes' and arrangements_recheck_needed = true
      and outstanding_arrangements = '["venue_recheck"]'::jsonb) then
    raise exception '[SG2-39:stored-planning-details] [SG2-39:AC4] [NORMAL] Planning details and recheck state must match the saved values';
  end if;
  insert into public.events (event_id, organiser_id, organisation, name, registration_capacity,
      registration_opens_at, registration_closes_at)
    values (93907, 'c0000000-0000-4000-8000-000000000002', 'Acme Corp', 'Minimum registration window', 1,
      '2026-12-01 09:00:00+00', '2026-12-01 09:00:00.000001+00');
  if not exists (select 1 from public.events where event_id = 93907 and registration_capacity = 1
      and registration_opens_at = '2026-12-01 09:00:00+00' and registration_closes_at = '2026-12-01 09:00:00.000001+00') then
    raise exception '[SG2-39:minimum-registration-values] [SG2-39:AC4] [BOUNDARY] Capacity one and the first positive registration-window interval must persist';
  end if;
  -- registration_capacity must be > 0
  begin
    insert into public.events (event_id, organiser_id, name, registration_capacity)
    values (93903, 'c0000000-0000-4000-8000-000000000002', 'Invalid Capacity 0', 0);
    raise exception '[SG2-39:zero-registration-capacity] [SG2-39:AC4] [BOUNDARY] Zero registration capacity should have been rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.events (event_id, organiser_id, name, registration_capacity)
    values (93904, 'c0000000-0000-4000-8000-000000000002', 'Negative Capacity', -10);
    raise exception '[SG2-39:negative-registration-capacity] [SG2-39:AC4] [FAILURE] Negative registration capacity should have been rejected';
  exception when check_violation then null;
  end;

  -- registration window: closes_at must be > opens_at
  begin
    insert into public.events (event_id, organiser_id, name, registration_opens_at, registration_closes_at)
    values (93905, 'c0000000-0000-4000-8000-000000000002', 'Invalid Window',
            '2026-10-15 18:00:00+00', '2026-10-01 09:00:00+00');
    raise exception '[SG2-39:backwards-registration-window] [SG2-39:AC4] [FAILURE] Registration closes_at preceding opens_at should have been rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.events (event_id, organiser_id, name, registration_opens_at, registration_closes_at)
    values (93906, 'c0000000-0000-4000-8000-000000000002', 'Equal Window',
            '2026-10-01 09:00:00+00', '2026-10-01 09:00:00+00');
    raise exception '[SG2-39:empty-registration-window] [SG2-39:AC4] [BOUNDARY] Registration closes_at equal to opens_at should have been rejected';
  exception when check_violation then null;
  end;
  begin
    update public.events set registration_closes_at = '2026-10-01 09:00:00+00', planning_notes = 'Rejected edit'
      where event_id = 93901;
    raise exception '[SG2-39:invalid-planning-edit] [SG2-39:AC4] [CONFLICT] An edit must not move a saved registration window into an invalid state';
  exception when check_violation then null;
  end;
  if not exists (select 1 from public.events where event_id = 93901
      and registration_closes_at = '2026-10-15 18:00:00+00' and planning_notes = 'Initial notes') then
    raise exception '[SG2-39:rejected-edit-state] [SG2-39:AC4] [CONFLICT] A rejected planning edit must preserve both the window and notes';
  end if;
end $$;

-- 2. Internal staff can read all audit logs:
set local role authenticated;

-- Coordinator
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 2 then
    raise exception '[SG2-40:coordinator-history-read] [SG2-40:AC1] [NORMAL] Event coordinator should see all audit logs';
  end if;
  -- Cannot write directly
  begin
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (93901, 'c0000000-0000-4000-8000-000000000001', 'test', 'a', 'b');
    raise exception '[SG2-40:coordinator-history-insert] [FAILURE] Direct insert by coordinator should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Venue staff
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 2 then
    raise exception '[SG2-40:venue-staff-history-read] [SG2-40:AC1] [NORMAL] Venue staff should see all audit logs';
  end if;
end $$;

-- Tech support staff
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 2 then
    raise exception '[SG2-40:technical-support-history-read] [SG2-40:AC1] [NORMAL] Technical support staff should see all audit logs';
  end if;
end $$;

-- 3. Event Organiser A can only see audit logs for Event A (93901):
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 1 then
    raise exception '[SG2-40:organiser-history-count] [SG2-40:AC1] [NORMAL] Organiser A should only see audit logs for their own event';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 93901) then
    raise exception '[SG2-40:organiser-owned-history] [SG2-40:AC1] [NORMAL] Organiser A must see audit log for event 93901';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 93901
      and actor_id = 'c0000000-0000-4000-8000-000000000001'
      and field_name = 'expected_attendance' and old_value = '50' and new_value = '100'
      and created_at = '2026-10-01 08:00:00+00') then
    raise exception '[SG2-40:audit-record-values] [SG2-40:AC1] [SG2-40:AC2] [NORMAL] Event history must retain the actor, field, before/after values and timestamp';
  end if;
  if exists (select 1 from public.event_audit_logs where event_id = 93907) then
    raise exception '[SG2-40:no-history] [SG2-40:AC1] [BOUNDARY] An owned event without changes must have an empty history';
  end if;
  if exists (select 1 from public.event_audit_logs where event_id = 93902) then
    raise exception '[SG2-40:other-organiser-history] [SG2-40:AC3] [FAILURE] Organiser A must NOT see audit log for event 93902';
  end if;
  -- Cannot write directly
  begin
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (93901, 'c0000000-0000-4000-8000-000000000002', 'test', 'a', 'b');
    raise exception '[SG2-40:organiser-history-insert] [FAILURE] Direct insert by organiser should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Read permission must not allow any signed-in role to rewrite history.
do $$
declare caller uuid;
begin
  foreach caller in array array[
    'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004',
    'c0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000006'
  ]::uuid[] loop
    perform set_config('request.jwt.claim.sub', caller::text, true);
    begin
      update public.event_audit_logs set new_value = '999' where event_id = 93901;
      raise exception '[SG2-40:direct-history-update] [FAILURE] Caller % must not rewrite history', caller;
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.event_audit_logs where event_id = 93901;
      raise exception '[SG2-40:direct-history-delete] [FAILURE] Caller % must not delete history', caller;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- 4. Attendee cannot see any audit logs:
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 0 then
    raise exception '[SG2-40:attendee-history-read] [SG2-40:AC3] [FAILURE] Attendee should see 0 audit logs';
  end if;
end $$;

-- 5. Anonymous caller cannot read or write:
set local role anon;
do $$
begin
  begin
    perform * from public.event_audit_logs;
    raise exception '[SG2-40:anonymous-history-read] [SG2-40:AC3] [FAILURE] Anonymous caller should not be able to read audit logs';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (93901, 'c0000000-0000-4000-8000-000000000001', 'test', 'a', 'b');
    raise exception '[SG2-40:anonymous-history-insert] [FAILURE] Anonymous caller should not be able to write audit logs';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  begin
    insert into public.event_audit_logs (event_id, actor_id, field_name)
      values (-1, 'c0000000-0000-4000-8000-000000000001', 'name');
    raise exception '[SG2-40:history-event-reference] [FAILURE] History must reference an existing event';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.event_audit_logs (event_id, actor_id, field_name)
      values (93901, 'c0000000-0000-4000-8000-000000000099', 'name');
    raise exception '[SG2-40:history-actor-reference] [FAILURE] History must reference an existing actor';
  exception when foreign_key_violation then null;
  end;
end $$;
set local role service_role;
update public.account_roles set role = 'attendee'
  where user_id = 'c0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.event_audit_logs) then
    raise exception '[SG2-40:revoked-history-access] [SG2-40:AC3] [CONFLICT] History access must disappear as soon as an internal role is revoked';
  end if;
end $$;
reset role;
rollback;
