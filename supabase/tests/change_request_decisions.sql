-- Review trace: SG2-65 decide on a change request.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-65: decide_event_change_request and the decision record on event_change_requests.
-- Disposable local/CI test script. All changes are rolled back.
begin;

-- Seed test identities:
-- 1: coordinator C (assigned to every event)
-- 2: organiser A (owns every event, raises every request)
-- 3: coordinator D (assigned to nothing)
insert into auth.users (id) values
  ('e6500000-0000-4000-8000-000000000001'),
  ('e6500000-0000-4000-8000-000000000002'),
  ('e6500000-0000-4000-8000-000000000003');

insert into public.users (user_id, name, organisation, role_id) values
  ('e6500000-0000-4000-8000-000000000001', 'Coordinator C', 'Acme Corp', 2),
  ('e6500000-0000-4000-8000-000000000002', 'Organiser A', 'Acme Corp', 1),
  ('e6500000-0000-4000-8000-000000000003', 'Coordinator D', 'Acme Corp', 2);

insert into public.account_roles (user_id, role) values
  ('e6500000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('e6500000-0000-4000-8000-000000000002', 'event_organiser'),
  ('e6500000-0000-4000-8000-000000000003', 'event_coordinator');

insert into public.events (event_id, organiser_id, coordinator_id, organisation, name, status,
    expected_attendance, description) values
  (96501, 'e6500000-0000-4000-8000-000000000002', 'e6500000-0000-4000-8000-000000000001',
    'Acme Corp', 'Partner Dinner', 'planning', 120, 'Old agenda'),
  (96502, 'e6500000-0000-4000-8000-000000000002', 'e6500000-0000-4000-8000-000000000001',
    'Acme Corp', 'Clarify Review', 'needs_clarification', 80, null),
  (96503, 'e6500000-0000-4000-8000-000000000002', 'e6500000-0000-4000-8000-000000000001',
    'Acme Corp', 'Clarify Resubmit', 'needs_clarification', 60, null);

-- Requests 1-3 on the planning event, 4 and 5 on the clarification ones.
do $$
begin
  perform public.raise_event_change_request(96501, 'e6500000-0000-4000-8000-000000000002',
    'expected_attendance', '200'::jsonb, 'More guests.');
  perform public.raise_event_change_request(96501, 'e6500000-0000-4000-8000-000000000002',
    'description', '"New agenda"'::jsonb, 'Agenda changed.');
  perform public.raise_event_change_request(96501, 'e6500000-0000-4000-8000-000000000002',
    'name', '"Partner Gala"'::jsonb, 'Rebranded.');
  perform public.raise_event_change_request(96502, 'e6500000-0000-4000-8000-000000000002',
    'expected_attendance', '90'::jsonb, 'Answering the clarification.');
  perform public.raise_event_change_request(96503, 'e6500000-0000-4000-8000-000000000002',
    'name', '"Clarified name"'::jsonb, 'Answering the clarification.');
end $$;

create temporary table ids on commit drop as
  select row_number() over (order by change_request_id) as n, change_request_id as id
  from public.event_change_requests where event_id between 96501 and 96503;

-- 1. Refusing needs a reason, leaves the event as it is, records who refused,
-- when and why, writes the history and notifies the organiser (AC2/AC3):
do $$
declare
  result jsonb;
  request_id bigint := (select id from ids where n = 1);
begin
  result := public.decide_event_change_request(96501, request_id, 'e6500000-0000-4000-8000-000000000001',
    'refused', '  No larger room is free.  ', null);
  if result ->> 'outcome' <> 'ok'
      or (select expected_attendance from public.events where event_id = 96501) <> 120
      or not exists (select 1 from public.event_change_requests where change_request_id = request_id
        and status = 'refused' and decided_by = 'e6500000-0000-4000-8000-000000000001'
        and decided_at is not null and decision_reason = 'No larger room is free.')
      or not exists (select 1 from public.event_audit_logs where event_id = 96501
        and field_name = 'change_request' and new_value = 'Refused change request ' || request_id
          || ': No larger room is free.')
      or not exists (select 1 from public.notifications
        where recipient_id = 'e6500000-0000-4000-8000-000000000002' and event_id = 96501
          and kind = 'change_refused'
          and message = 'Partner Dinner: your change request was refused. Reason: No larger room is free.') then
    raise exception '[SG2-65:refuse-records-decision] [SG2-65:AC2] [SG2-65:AC3] [NORMAL] Refusing must keep the event, record decider, time and trimmed reason, write history and notify the organiser, got %', result;
  end if;
end $$;

-- 2. A refusal reason is 1-1000 characters after trimming: blank and 1001 are
-- invalid and write nothing; 1000 is recorded (AC2):
do $$
declare
  request_id bigint := (select id from ids where n = 3);
  blank jsonb;
  too_long jsonb;
  at_limit jsonb;
begin
  blank := public.decide_event_change_request(96501, request_id, 'e6500000-0000-4000-8000-000000000001',
    'refused', '   ', null);
  too_long := public.decide_event_change_request(96501, request_id, 'e6500000-0000-4000-8000-000000000001',
    'refused', repeat('r', 1001), null);
  -- Had either been accepted, the request would no longer be pending and this
  -- 1000-character refusal would come back not_pending.
  at_limit := public.decide_event_change_request(96501, request_id, 'e6500000-0000-4000-8000-000000000001',
    'refused', repeat('r', 1000), null);
  if blank ->> 'outcome' <> 'invalid' or too_long ->> 'outcome' <> 'invalid' or at_limit ->> 'outcome' <> 'ok'
      or (select char_length(decision_reason) from public.event_change_requests
        where change_request_id = request_id) is distinct from 1000 then
    raise exception '[SG2-65:refusal-reason-boundary] [SG2-65:AC2] [BOUNDARY] A blank or 1001-character reason must be invalid and a 1000-character one recorded, got %, % and %', blank, too_long, at_limit;
  end if;
end $$;

-- 3. On an open status SG2-66 applies the change first; the decision then
-- records who accepted and when, notifies the organiser and leaves the
-- status to SG2-66 (AC1/AC3/AC5):
do $$
declare
  result jsonb;
  request_id bigint := (select id from ids where n = 2);
begin
  perform public.apply_accepted_event_change(96501, 'e6500000-0000-4000-8000-000000000001', 'planning',
    'change request ' || request_id, '{"description": "New agenda"}'::jsonb, '[]'::jsonb);
  result := public.decide_event_change_request(96501, request_id, 'e6500000-0000-4000-8000-000000000001',
    'accepted', null, null);
  if result ->> 'outcome' <> 'ok' or result ->> 'status' <> 'planning'
      or (select description from public.events where event_id = 96501) <> 'New agenda'
      or not exists (select 1 from public.event_change_requests where change_request_id = request_id
        and status = 'accepted' and decided_by = 'e6500000-0000-4000-8000-000000000001'
        and decided_at is not null and decision_reason is null)
      or not exists (select 1 from public.notifications
        where recipient_id = 'e6500000-0000-4000-8000-000000000002' and event_id = 96501
          and kind = 'change_accepted' and message = 'Partner Dinner: your change request was accepted.') then
    raise exception '[SG2-65:accept-records-decision] [SG2-65:AC1] [SG2-65:AC3] [NORMAL] Accepting an applied change must record the decider and notify the organiser, got %', result;
  end if;
end $$;

-- 3b. AC5: accepting a significant change on an event in Preparation or
-- Confirmed sends it back to Planning (SG2-66's apply, with the venue to
-- recheck), and the decision is still recorded and the organiser told both:
do $$
declare
  probe record;
  request_id bigint;
  applied jsonb;
  result jsonb;
begin
  insert into public.events (event_id, organiser_id, coordinator_id, organisation, name, status,
      expected_attendance, confirmed_by, confirmed_at) values
    (96504, 'e6500000-0000-4000-8000-000000000002', 'e6500000-0000-4000-8000-000000000001',
      'Acme Corp', 'Prep Forum', 'preparation', 100, null, null),
    (96505, 'e6500000-0000-4000-8000-000000000002', 'e6500000-0000-4000-8000-000000000001',
      'Acme Corp', 'Confirmed Forum', 'confirmed', 100, 'e6500000-0000-4000-8000-000000000001', now());
  for probe in select * from (values (96504, 'preparation'), (96505, 'confirmed')) v(event_id, status) loop
    perform public.raise_event_change_request(probe.event_id, 'e6500000-0000-4000-8000-000000000002',
      'expected_attendance', '150'::jsonb, 'More guests.');
    request_id := (select max(change_request_id) from public.event_change_requests where event_id = probe.event_id);
    applied := public.apply_accepted_event_change(probe.event_id, 'e6500000-0000-4000-8000-000000000001',
      probe.status::public.event_status, 'change request ' || request_id, '{"expected_attendance": 150}'::jsonb,
      '["venue_recheck"]'::jsonb);
    result := public.decide_event_change_request(probe.event_id, request_id, 'e6500000-0000-4000-8000-000000000001',
      'accepted', null, null);
    if applied ->> 'status' <> 'planning' or (applied ->> 'returned_to_planning')::boolean is not true
        or result ->> 'outcome' <> 'ok' or result ->> 'status' <> 'planning'
        or (select (status::text, expected_attendance) from public.events where event_id = probe.event_id)
          is distinct from ('planning'::text, 150)
        or not exists (select 1 from public.event_change_requests where change_request_id = request_id
          and status = 'accepted' and decided_by = 'e6500000-0000-4000-8000-000000000001' and decided_at is not null)
        or (select array_agg(kind::text order by kind) from public.notifications
            where recipient_id = 'e6500000-0000-4000-8000-000000000002' and event_id = probe.event_id)
          is distinct from array['change_accepted', 'event_returned_to_planning'] then
      raise exception '[SG2-65:significant-change-returns-to-planning] [SG2-65:AC5] [SG2-65:AC3] [NORMAL] A significant change accepted on a % event must return it to Planning and still record the decision, got % and %',
        probe.status, applied, result;
    end if;
  end loop;
end $$;

-- 4. On a request returned for clarification, accepting writes the change
-- onto the request; "review" sends it back to under_review, "resubmit"
-- leaves it with the organiser. Both record and notify (AC4/AC3):
do $$
declare
  review jsonb;
  resubmit jsonb;
begin
  review := public.decide_event_change_request(96502, (select id from ids where n = 4),
    'e6500000-0000-4000-8000-000000000001', 'accepted', null, 'review');
  resubmit := public.decide_event_change_request(96503, (select id from ids where n = 5),
    'e6500000-0000-4000-8000-000000000001', 'accepted', null, 'resubmit');
  if review ->> 'outcome' <> 'ok' or review ->> 'status' <> 'under_review'
      or (select (expected_attendance, status::text) from public.events where event_id = 96502)
        is distinct from (90, 'under_review'::text)
      or not exists (select 1 from public.event_audit_logs where event_id = 96502
        and field_name = 'status' and old_value = 'needs_clarification' and new_value = 'under_review')
      or not exists (select 1 from public.event_audit_logs where event_id = 96502
        and field_name = 'expected_attendance' and old_value = '80' and new_value = '90')
      or not exists (select 1 from public.notifications where event_id = 96502 and kind = 'change_accepted'
        and message = 'Clarify Review: your change request was accepted and the request is back in review.') then
    raise exception '[SG2-65:clarification-back-to-review] [SG2-65:AC4] [NORMAL] Accepting with review must apply the change and return the request to under_review, got %', review;
  end if;
  if resubmit ->> 'outcome' <> 'ok' or resubmit ->> 'status' <> 'needs_clarification'
      or (select (name::text, status::text) from public.events where event_id = 96503)
        is distinct from ('Clarified name'::text, 'needs_clarification'::text)
      or not exists (select 1 from public.event_change_requests where event_id = 96503
        and status = 'accepted' and decided_by = 'e6500000-0000-4000-8000-000000000001')
      or not exists (select 1 from public.notifications where event_id = 96503 and kind = 'change_accepted'
        and message = 'Clarify Resubmit: your change request was accepted. Resubmit the request for review.') then
    raise exception '[SG2-65:clarification-resubmit] [SG2-65:AC4] [NORMAL] Accepting with resubmit must apply the change and leave it with the organiser, got %', resubmit;
  end if;
end $$;

-- 5. The next step is required on a clarification request and refused on any
-- other status; another coordinator, a decided request and a refusal after
-- SG2-66 applied the change are all turned away (AC4, CONFLICT):
do $$
declare
  probe record;
  result jsonb;
  accepted jsonb;
  pending_id bigint;
  wrong text[] := array[]::text[];
begin
  perform public.raise_event_change_request(96502, 'e6500000-0000-4000-8000-000000000002',
    'name', '"Second"'::jsonb, 'Another.');
  update public.events set status = 'needs_clarification' where event_id = 96502;
  pending_id := (select max(change_request_id) from public.event_change_requests where event_id = 96502);
  for probe in select * from (values
      (96502, pending_id, 'e6500000-0000-4000-8000-000000000001'::uuid, 'accepted', null, null, 'invalid'),
      (96502, pending_id, 'e6500000-0000-4000-8000-000000000001'::uuid, 'accepted', null, 'later', 'invalid'),
      (96502, pending_id, 'e6500000-0000-4000-8000-000000000001'::uuid, 'refused', 'No.', 'review', 'invalid'),
      (96502, pending_id, 'e6500000-0000-4000-8000-000000000001'::uuid, 'withdrawn', null, null, 'invalid'),
      (96502, pending_id, 'e6500000-0000-4000-8000-000000000003'::uuid, 'refused', 'No.', null, 'not_found'),
      (96501, (select id from ids where n = 1), 'e6500000-0000-4000-8000-000000000001'::uuid,
        'accepted', null, null, 'not_pending'))
      v(event_id, request_id, actor, decision, reason, next_step, expected) loop
    result := public.decide_event_change_request(probe.event_id, probe.request_id, probe.actor,
      probe.decision, probe.reason, probe.next_step);
    if result ->> 'outcome' <> probe.expected then
      wrong := wrong || format('%s %s by %s with next %s must be %s, got %s',
        probe.decision, probe.request_id, probe.actor, probe.next_step, probe.expected, result);
    end if;
  end loop;
  if (select status from public.event_change_requests where change_request_id = pending_id) <> 'pending'
      or (select name from public.events where event_id = 96502) <> 'Clarify Review' then
    wrong := wrong || 'a turned-away decision changed the request or the event'::text;
  end if;
  if cardinality(wrong) > 0 then
    raise exception '[SG2-65:decision-guards] [SG2-65:AC4] [CONFLICT] Every guard must turn the decision away and change nothing: %', wrong;
  end if;

  -- SG2-66 applied it (its history line is written) but has not recorded the
  -- decision yet: a refusal in between is turned away, the acceptance is not.
  update public.events set status = 'planning' where event_id = 96502;
  perform public.apply_accepted_event_change(96502, 'e6500000-0000-4000-8000-000000000001', 'planning',
    'change request ' || pending_id, '{"name": "Second"}'::jsonb, '[]'::jsonb);
  result := public.decide_event_change_request(96502, pending_id, 'e6500000-0000-4000-8000-000000000001',
    'refused', 'Too late.', null);
  accepted := public.decide_event_change_request(96502, pending_id, 'e6500000-0000-4000-8000-000000000001',
    'accepted', null, null);
  if result ->> 'outcome' <> 'not_pending' or accepted ->> 'outcome' <> 'ok' then
    raise exception '[SG2-65:no-refusal-after-apply] [SG2-65:AC1] [SG2-65:AC2] [CONFLICT] An applied change must not be refused but must still be recorded as accepted, got % and %', result, accepted;
  end if;
end $$;

-- 6. The table keeps every decision whole: a decided request without its
-- decider or time, a pending one with them, and a refusal without a reason
-- are all rejected (AC3, FAILURE):
do $$
declare
  probe text;
  rejected boolean;
  request_id bigint := (select id from ids where n = 1);
begin
  foreach probe in array array[
      'update public.event_change_requests set decided_by = null where change_request_id = ' || request_id,
      'update public.event_change_requests set status = ''pending'' where change_request_id = ' || request_id,
      'update public.event_change_requests set decision_reason = '' '' where change_request_id = ' || request_id] loop
    begin
      execute probe;
      rejected := false;
    exception when check_violation then rejected := true;
    end;
    if not rejected then
      raise exception '[SG2-65:decision-record-whole] [SG2-65:AC3] [FAILURE] must be rejected: %', probe;
    end if;
  end loop;
end $$;

-- 7. No signed-in or anonymous caller decides directly; only the service role
-- may run the function:
do $$
declare
  probe text;
  refused boolean;
begin
  foreach probe in array array['authenticated', 'anon'] loop
    if has_function_privilege(probe, 'public.decide_event_change_request(integer,bigint,uuid,text,text,text)', 'execute') then
      raise exception '[SG2-65:no-execute-grant] [SG2-65:AC3] [FAILURE] % must not hold EXECUTE on the function', probe;
    end if;
    execute format('set local role %I', probe);
    begin
      perform public.decide_event_change_request(96501, 1, 'e6500000-0000-4000-8000-000000000001',
        'refused', 'Bypass', null);
      refused := false;
    exception when insufficient_privilege then refused := true;
    end;
    reset role;
    if not refused then
      raise exception '[SG2-65:no-direct-decision] [SG2-65:AC3] [FAILURE] % must not decide directly', probe;
    end if;
  end loop;
end $$;

rollback;
