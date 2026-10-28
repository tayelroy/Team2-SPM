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

-- 1. Raising a request stores what, from, to and why (AC1), leaves the event
-- as it is, and notifies the assigned coordinator but not the organiser (AC2):
do $$
declare result jsonb;
begin
  result := public.raise_event_change_request(96401, 'e6400000-0000-4000-8000-000000000002',
    'expected_attendance', '180'::jsonb, '  More guests confirmed.  ');
  if result ->> 'outcome' IS DISTINCT FROM 'ok' or (result ->> 'coordinator_notified')::boolean is not true
      or not exists (select 1 from public.event_change_requests
        where event_id = 96401 and field = 'expected_attendance' and from_value = '120'::jsonb
          and to_value = '180'::jsonb and reason = 'More guests confirmed.' and status = 'pending'
          and requested_by = 'e6400000-0000-4000-8000-000000000002')
      or (select expected_attendance from public.events where event_id = 96401) IS DISTINCT FROM 120
      or not exists (select 1 from public.notifications
        where recipient_id = 'e6400000-0000-4000-8000-000000000001' and event_id = 96401
          and kind = 'change_requested'
          and message = 'Partner Dinner has a change request waiting for your decision.')
      or exists (select 1 from public.notifications
        where recipient_id = 'e6400000-0000-4000-8000-000000000002' and kind = 'change_requested') then
    raise exception '[SG2-64:raise-stores-request] [SG2-64:AC1] [SG2-64:AC2] [NORMAL] Raising must store field, value as it was, new value, trimmed reason and pending status, leave the event unchanged and notify only the coordinator, got %', result;
  end if;
end $$;

-- 2. Every submitted status accepts a request, kept without a notice while no
-- coordinator is assigned; draft, cancelled, rejected and completed refuse one
-- and store nothing (AC1/AC2/AC4). One event per status, seeded as the
-- service role would leave it (status gates such as SG2-92's apply to updates):
do $$
declare
  probe record;
  seq integer := 0;
  result jsonb;
begin
  for probe in select * from (values
      ('submitted', true), ('unassigned', true), ('under_review', true), ('needs_clarification', true),
      ('approved', true), ('planning', true), ('awaiting_safety_check', true), ('safety_rejected', true),
      ('preparation', true), ('confirmed', true),
      ('draft', false), ('cancelled', false), ('rejected', false), ('completed', false)) v(status, open) loop
    seq := seq + 1;
    -- A rejected event carries its decision reason and a completed one who
    -- completed it and when.
    insert into public.events (event_id, organiser_id, organisation, name, status, decision_reason,
        completed_by, completed_at)
      values (96410 + seq, 'e6400000-0000-4000-8000-000000000002', 'Acme Corp', probe.status,
        probe.status::public.event_status, 'Seeded decision',
        case when probe.status = 'completed' then 'e6400000-0000-4000-8000-000000000001'::uuid end,
        case when probe.status = 'completed' then now() end);
    result := public.raise_event_change_request(96410 + seq, 'e6400000-0000-4000-8000-000000000002',
      'description', to_jsonb('Agenda for ' || probe.status), 'Agenda changed.');
    if (probe.open and (result ->> 'outcome' IS DISTINCT FROM 'ok' or (result ->> 'coordinator_notified')::boolean is not false))
        or (not probe.open and (result ->> 'outcome' IS DISTINCT FROM 'closed' or result ->> 'status' IS DISTINCT FROM probe.status
          or exists (select 1 from public.event_change_requests where event_id = 96410 + seq))) then
      raise exception '[SG2-64:status-boundaries] [SG2-64:AC1] [SG2-64:AC2] [SG2-64:AC4] [BOUNDARY] A % event must % a change request, got %', probe.status, case when probe.open then 'accept' else 'refuse' end, result;
    end if;
  end loop;
end $$;

-- 3. Only the owning organiser may raise one, and only a real change; the same
-- instant written in another time zone is no change, a new date is:
do $$
declare
  probe record;
  result jsonb;
begin
  for probe in select * from (values
      ('e6400000-0000-4000-8000-000000000003', 'name', '"Hijacked"', 'not_found'),
      ('e6400000-0000-4000-8000-000000000001', 'name', '"Coordinator edit"', 'not_found'),
      ('e6400000-0000-4000-8000-000000000002', 'expected_attendance', '120', 'unchanged'),
      ('e6400000-0000-4000-8000-000000000002', 'proposed_date', '"2026-11-20T18:00:00.000+08:00"', 'unchanged'),
      ('e6400000-0000-4000-8000-000000000002', 'proposed_date', '"2026-11-27T10:00:00.000Z"', 'ok')) v(actor, field, value, expected) loop
    result := public.raise_event_change_request(96401, probe.actor::uuid, probe.field, probe.value::jsonb, 'Why');
    if result ->> 'outcome' is distinct from probe.expected then
      raise exception '[SG2-64:owner-and-real-change] [SG2-64:AC1] [CONFLICT] [NORMAL] % by % must be %, got %', probe.field, probe.actor, probe.expected, result;
    end if;
  end loop;
end $$;

-- 4. The table keeps a reason of 1 to 1000 characters, a changeable field and
-- a known status even when the service role writes it directly:
do $$
declare
  probe record;
  refused boolean;
begin
  insert into public.event_change_requests (event_id, requested_by, field, to_value, reason)
    values (96401, 'e6400000-0000-4000-8000-000000000002', 'name', '"Ok"'::jsonb, repeat('r', 1000));
  for probe in select * from (values
      ('1001-character reason', 'name', repeat('r', 1001), 'pending'),
      ('blank reason', 'name', '   ', 'pending'),
      ('field outside the changeable list', 'status', 'Sneaky', 'pending'),
      ('unknown status', 'name', 'Why', 'approved')) v(label, field, reason, status) loop
    begin
      insert into public.event_change_requests (event_id, requested_by, field, to_value, reason, status)
        values (96401, 'e6400000-0000-4000-8000-000000000002', probe.field, '"Ok"'::jsonb, probe.reason, probe.status);
      refused := false;
    exception when check_violation then refused := true;
    end;
    if not refused then
      raise exception '[SG2-64:table-constraints] [SG2-64:AC1] [BOUNDARY] [FAILURE] A % should have been rejected (a 1000-character reason is accepted)', probe.label;
    end if;
  end loop;
end $$;

-- 5. No signed-in or anonymous caller reads, writes or raises directly; the
-- API decides who sees a request (AC3). SET ROLE is checked against the
-- session user, so this block can switch to each role in turn:
do $$
declare
  probe record;
  refused boolean;
begin
  for probe in select * from (values
      ('authenticated', 'select * from public.event_change_requests'),
      ('authenticated', 'insert into public.event_change_requests (event_id, requested_by, field, to_value, reason)'
        || ' values (96401, ''e6400000-0000-4000-8000-000000000002'', ''name'', ''"Direct"'', ''Bypass'')'),
      ('authenticated', 'select public.raise_event_change_request(96401, ''e6400000-0000-4000-8000-000000000002'','
        || ' ''name'', ''"Direct"''::jsonb, ''Bypass'')'),
      ('anon', 'select * from public.event_change_requests')) v(caller, statement) loop
    execute format('set local role %I', probe.caller);
    begin
      execute probe.statement;
      refused := false;
    exception when insufficient_privilege then refused := true;
    end;
    reset role;
    if not refused then
      raise exception '[SG2-64:no-direct-access] [SG2-64:AC3] [FAILURE] % must not run: %', probe.caller, probe.statement;
    end if;
  end loop;
end $$;

rollback;
