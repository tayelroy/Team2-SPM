-- Review trace: SG2-64 ask for a change after submitting.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-64: raise_event_change_request and the event_change_requests lockdown.
-- Disposable local/CI test script. All changes are rolled back.
begin;

-- Seed test identities:
-- 1: coordinator (assigned to every event)
-- 2: organiser A (owns every event below)
-- 3: organiser B (same organisation, owns nothing)
insert into auth.users (id) values
  ('e6400000-0000-4000-8000-000000000001'),
  ('e6400000-0000-4000-8000-000000000002'),
  ('e6400000-0000-4000-8000-000000000003');

insert into public.users (user_id, name, organisation, role_id) values
  ('e6400000-0000-4000-8000-000000000001', 'Coordinator C', 'Acme Corp', 2),
  ('e6400000-0000-4000-8000-000000000002', 'Organiser A', 'Acme Corp', 1),
  ('e6400000-0000-4000-8000-000000000003', 'Organiser B', 'Acme Corp', 1);

insert into public.account_roles (user_id, role) values
  ('e6400000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('e6400000-0000-4000-8000-000000000002', 'event_organiser'),
  ('e6400000-0000-4000-8000-000000000003', 'event_organiser');

insert into public.events (event_id, organiser_id, coordinator_id, organisation, name, status,
    expected_attendance, proposed_date) values
  (96401, 'e6400000-0000-4000-8000-000000000002', 'e6400000-0000-4000-8000-000000000001',
    'Acme Corp', 'Partner Dinner', 'under_review', 120, '2026-11-20 10:00:00+00'),
  (96402, 'e6400000-0000-4000-8000-000000000002', 'e6400000-0000-4000-8000-000000000001',
    'Acme Corp', 'Draft event', 'draft', 50, null);

-- 1. Raising a request stores what, from, to and why (AC1) and names the
-- coordinator it is for (AC2):
do $$
declare result jsonb;
begin
  result := public.raise_event_change_request(96401, 'e6400000-0000-4000-8000-000000000002',
    'expected_attendance', '180'::jsonb, '  More guests confirmed.  ');
  if result ->> 'outcome' <> 'ok' or (result ->> 'coordinator_notified')::boolean is not true then
    raise exception '[SG2-64:raise-stores-request] [SG2-64:AC1] [SG2-64:AC2] [NORMAL] Raising must succeed and notify the coordinator, got %', result;
  end if;
  if not exists (select 1 from public.notifications
      where recipient_id = 'e6400000-0000-4000-8000-000000000001' and event_id = 96401
        and kind = 'change_requested'
        and message = 'Partner Dinner has a change request waiting for your decision.') then
    raise exception '[SG2-64:coordinator-notified] [SG2-64:AC2] [NORMAL] The assigned coordinator must get a change_requested notice';
  end if;
  if exists (select 1 from public.notifications
      where recipient_id = 'e6400000-0000-4000-8000-000000000002' and kind = 'change_requested') then
    raise exception '[SG2-64:organiser-not-notified] [SG2-64:AC2] [NORMAL] The organiser must not be told about their own request';
  end if;
  if not exists (select 1 from public.event_change_requests
      where event_id = 96401 and field = 'expected_attendance' and from_value = '120'::jsonb
        and to_value = '180'::jsonb and reason = 'More guests confirmed.' and status = 'pending'
        and requested_by = 'e6400000-0000-4000-8000-000000000002') then
    raise exception '[SG2-64:raise-stores-fields] [SG2-64:AC1] [NORMAL] The stored request must keep field, current value, new value, trimmed reason and pending status';
  end if;
  if (select expected_attendance from public.events where event_id = 96401) <> 120 then
    raise exception '[SG2-64:raise-leaves-event] [SG2-64:AC1] [NORMAL] Raising a request must not change the event itself';
  end if;
end $$;

-- 2. Every submitted status accepts a request; draft, cancelled, rejected and
-- completed refuse one (AC1/AC4). One event per status, seeded as the service
-- role would leave it (status gates such as SG2-92's apply to updates):
do $$
declare
  open_status text;
  closed_status text;
  seq integer := 0;
  result jsonb;
begin
  foreach open_status in array array['submitted', 'unassigned', 'under_review', 'needs_clarification',
      'approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed'] loop
    seq := seq + 1;
    insert into public.events (event_id, organiser_id, organisation, name, status)
      values (96410 + seq, 'e6400000-0000-4000-8000-000000000002', 'Acme Corp', open_status,
        open_status::public.event_status);
    result := public.raise_event_change_request(96410 + seq, 'e6400000-0000-4000-8000-000000000002',
      'description', to_jsonb('Agenda for ' || open_status), 'Agenda changed.');
    if result ->> 'outcome' <> 'ok' then
      raise exception '[SG2-64:open-statuses] [SG2-64:AC1] [BOUNDARY] A % event must accept a change request, got %', open_status, result;
    end if;
    -- These events have no coordinator yet: the request waits for one.
    if (result ->> 'coordinator_notified')::boolean is not false then
      raise exception '[SG2-64:no-coordinator-yet] [SG2-64:AC2] [BOUNDARY] An event with no coordinator must store the request without a notice, got %', result;
    end if;
  end loop;
  foreach closed_status in array array['draft', 'cancelled', 'rejected', 'completed'] loop
    seq := seq + 1;
    -- A rejected event carries its decision reason and a completed one who
    -- completed it and when.
    insert into public.events (event_id, organiser_id, organisation, name, status, decision_reason,
        completed_by, completed_at)
      values (96410 + seq, 'e6400000-0000-4000-8000-000000000002', 'Acme Corp', closed_status,
        closed_status::public.event_status, 'Seeded decision',
        case when closed_status = 'completed' then 'e6400000-0000-4000-8000-000000000001'::uuid end,
        case when closed_status = 'completed' then now() end);
    result := public.raise_event_change_request(96410 + seq, 'e6400000-0000-4000-8000-000000000002',
      'description', '"Too late"'::jsonb, 'Agenda changed.');
    if result ->> 'outcome' <> 'closed' or result ->> 'status' <> closed_status then
      raise exception '[SG2-64:closed-statuses] [SG2-64:AC4] [BOUNDARY] A % event must refuse a change request, got %', closed_status, result;
    end if;
  end loop;
  if exists (select 1 from public.event_change_requests where to_value = '"Too late"'::jsonb) then
    raise exception '[SG2-64:closed-not-stored] [SG2-64:AC4] [BOUNDARY] A refused request must not be stored';
  end if;
end $$;

-- 3. Only the owning organiser may raise one, and only a real change:
do $$
declare result jsonb;
begin
  result := public.raise_event_change_request(96401, 'e6400000-0000-4000-8000-000000000003',
    'name', '"Hijacked"'::jsonb, 'Not my event.');
  if result ->> 'outcome' <> 'not_found' then
    raise exception '[SG2-64:other-organiser] [SG2-64:AC1] [CONFLICT] Another organiser must get not_found, got %', result;
  end if;
  result := public.raise_event_change_request(96401, 'e6400000-0000-4000-8000-000000000001',
    'name', '"Coordinator edit"'::jsonb, 'Not an organiser.');
  if result ->> 'outcome' <> 'not_found' then
    raise exception '[SG2-64:coordinator-raise] [SG2-64:AC1] [CONFLICT] A coordinator must get not_found, got %', result;
  end if;
  result := public.raise_event_change_request(96401, 'e6400000-0000-4000-8000-000000000002',
    'expected_attendance', '120'::jsonb, 'Same number.');
  if result ->> 'outcome' <> 'unchanged' then
    raise exception '[SG2-64:unchanged-value] [SG2-64:AC1] [CONFLICT] Asking for the current value must be unchanged, got %', result;
  end if;
  -- The same instant written another way is still no change.
  result := public.raise_event_change_request(96401, 'e6400000-0000-4000-8000-000000000002',
    'proposed_date', '"2026-11-20T18:00:00.000+08:00"'::jsonb, 'Same time.');
  if result ->> 'outcome' <> 'unchanged' then
    raise exception '[SG2-64:unchanged-date] [SG2-64:AC1] [CONFLICT] The same instant in another time zone must be unchanged, got %', result;
  end if;
  result := public.raise_event_change_request(96401, 'e6400000-0000-4000-8000-000000000002',
    'proposed_date', '"2026-11-27T10:00:00.000Z"'::jsonb, 'Speaker moved a week.');
  if result ->> 'outcome' <> 'ok' then
    raise exception '[SG2-64:date-change] [SG2-64:AC1] [NORMAL] A new date must be accepted, got %', result;
  end if;
end $$;

-- 4. The table rejects malformed rows even from the service role:
do $$
begin
  insert into public.event_change_requests (event_id, requested_by, field, to_value, reason)
    values (96401, 'e6400000-0000-4000-8000-000000000002', 'name', '"Ok"'::jsonb, repeat('r', 1000));
  begin
    insert into public.event_change_requests (event_id, requested_by, field, to_value, reason)
      values (96401, 'e6400000-0000-4000-8000-000000000002', 'name', '"Ok"'::jsonb, repeat('r', 1001));
    raise exception '[SG2-64:reason-limit] [SG2-64:AC1] [BOUNDARY] A 1001-character reason should have been rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.event_change_requests (event_id, requested_by, field, to_value, reason)
      values (96401, 'e6400000-0000-4000-8000-000000000002', 'name', '"Ok"'::jsonb, '   ');
    raise exception '[SG2-64:reason-required] [SG2-64:AC1] [BOUNDARY] A blank reason should have been rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.event_change_requests (event_id, requested_by, field, to_value, reason)
      values (96401, 'e6400000-0000-4000-8000-000000000002', 'status', '"approved"'::jsonb, 'Sneaky');
    raise exception '[SG2-64:field-whitelist] [SG2-64:AC1] [FAILURE] A field outside the changeable list should have been rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.event_change_requests (event_id, requested_by, field, to_value, reason, status)
      values (96401, 'e6400000-0000-4000-8000-000000000002', 'name', '"Ok"'::jsonb, 'Why', 'approved');
    raise exception '[SG2-64:status-known] [FAILURE] An unknown request status should have been rejected';
  exception when check_violation then null;
  end;
end $$;

-- 5. No signed-in or anonymous caller reads, writes or raises directly; the
-- API decides who sees a request (AC3):
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e6400000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"e6400000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  begin
    perform * from public.event_change_requests;
    raise exception '[SG2-64:direct-read] [SG2-64:AC3] [FAILURE] An organiser must not read change requests directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.event_change_requests (event_id, requested_by, field, to_value, reason)
      values (96401, 'e6400000-0000-4000-8000-000000000002', 'name', '"Direct"'::jsonb, 'Bypass');
    raise exception '[SG2-64:direct-insert] [FAILURE] An organiser must not insert change requests directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.raise_event_change_request(96401, 'e6400000-0000-4000-8000-000000000002',
      'name', '"Direct"'::jsonb, 'Bypass');
    raise exception '[SG2-64:direct-raise] [FAILURE] An organiser must not call raise_event_change_request directly';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role anon;
do $$
begin
  begin
    perform * from public.event_change_requests;
    raise exception '[SG2-64:anonymous-read] [SG2-64:AC3] [FAILURE] An anonymous caller must not read change requests';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
