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

insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value) values
  (93901, 'c0000000-0000-4000-8000-000000000001', 'expected_attendance', '50', '100'),
  (93902, 'c0000000-0000-4000-8000-000000000003', 'expected_attendance', '100', '200');

-- 1. Check constraints on public.events:
do $$
begin
  -- registration_capacity must be > 0
  begin
    insert into public.events (event_id, organiser_id, name, registration_capacity)
    values (93903, 'c0000000-0000-4000-8000-000000000002', 'Invalid Capacity 0', 0);
    raise exception 'Zero registration capacity should have been rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.events (event_id, organiser_id, name, registration_capacity)
    values (93904, 'c0000000-0000-4000-8000-000000000002', 'Negative Capacity', -10);
    raise exception 'Negative registration capacity should have been rejected';
  exception when check_violation then null;
  end;

  -- registration window: closes_at must be > opens_at
  begin
    insert into public.events (event_id, organiser_id, name, registration_opens_at, registration_closes_at)
    values (93905, 'c0000000-0000-4000-8000-000000000002', 'Invalid Window',
            '2026-10-15 18:00:00+00', '2026-10-01 09:00:00+00');
    raise exception 'Registration closes_at preceding opens_at should have been rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.events (event_id, organiser_id, name, registration_opens_at, registration_closes_at)
    values (93906, 'c0000000-0000-4000-8000-000000000002', 'Equal Window',
            '2026-10-01 09:00:00+00', '2026-10-01 09:00:00+00');
    raise exception 'Registration closes_at equal to opens_at should have been rejected';
  exception when check_violation then null;
  end;
end $$;

-- 2. Internal staff can read all audit logs:
set local role authenticated;

-- Coordinator
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 2 then
    raise exception 'Event coordinator should see all audit logs';
  end if;
  -- Cannot write directly
  begin
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (93901, 'c0000000-0000-4000-8000-000000000001', 'test', 'a', 'b');
    raise exception 'Direct insert by coordinator should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Venue staff
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 2 then
    raise exception 'Venue staff should see all audit logs';
  end if;
end $$;

-- Tech support staff
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 2 then
    raise exception 'Technical support staff should see all audit logs';
  end if;
end $$;

-- 3. Event Organiser A can only see audit logs for Event A (93901):
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 1 then
    raise exception 'Organiser A should only see audit logs for their own event';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 93901) then
    raise exception 'Organiser A must see audit log for event 93901';
  end if;
  if exists (select 1 from public.event_audit_logs where event_id = 93902) then
    raise exception 'Organiser A must NOT see audit log for event 93902';
  end if;
  -- Cannot write directly
  begin
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (93901, 'c0000000-0000-4000-8000-000000000002', 'test', 'a', 'b');
    raise exception 'Direct insert by organiser should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 4. Attendee cannot see any audit logs:
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.event_audit_logs) <> 0 then
    raise exception 'Attendee should see 0 audit logs';
  end if;
end $$;

-- 5. Anonymous caller cannot read or write:
set local role anon;
do $$
begin
  begin
    perform * from public.event_audit_logs;
    raise exception 'Anonymous caller should not be able to read audit logs';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (93901, 'c0000000-0000-4000-8000-000000000001', 'test', 'a', 'b');
    raise exception 'Anonymous caller should not be able to write audit logs';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
