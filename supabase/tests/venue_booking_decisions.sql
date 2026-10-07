-- SG2-49: run only in disposable CI/local PostgreSQL. Everything rolls back.
--
-- Venue Staff approve or reject a coordinator's venue request through
-- decide_venue_booking_request(). Approval commits the venue with a confirmed
-- booking only when nothing else occupies the period and capacity is covered;
-- rejection needs a reason. Both record who decided and when, in the request
-- and the event history, and notify the coordinator.
begin;
insert into auth.users (id) values
  ('c4900000-0000-4000-8000-000000000001'), ('c4900000-0000-4000-8000-000000000002'),
  ('c4900000-0000-4000-8000-000000000003'), ('c4900000-0000-4000-8000-000000000004');
insert into public.users (user_id, name, role_id) values
  ('c4900000-0000-4000-8000-000000000001', 'Decision staff', 3),
  ('c4900000-0000-4000-8000-000000000002', 'Decision coordinator', 2),
  ('c4900000-0000-4000-8000-000000000003', 'Decision organiser', 1),
  ('c4900000-0000-4000-8000-000000000004', 'Decision support', 4);
insert into public.account_roles (user_id, role) values
  ('c4900000-0000-4000-8000-000000000001', 'venue_staff'),
  ('c4900000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('c4900000-0000-4000-8000-000000000003', 'event_organiser'),
  ('c4900000-0000-4000-8000-000000000004', 'technical_support_staff');
insert into public.venues (venue_id, name, capacity) values
  (94901, 'Decision Hall', 100), (94902, 'Small Room', 20);
insert into public.events (event_id, organiser_id, coordinator_id, name, status, expected_attendance) values
  (94901, 'c4900000-0000-4000-8000-000000000003', 'c4900000-0000-4000-8000-000000000002', 'Decision forum', 'approved', 80),
  (94902, 'c4900000-0000-4000-8000-000000000003', 'c4900000-0000-4000-8000-000000000002', 'Other forum', 'planning', 50),
  (94903, 'c4900000-0000-4000-8000-000000000003', 'c4900000-0000-4000-8000-000000000002', 'Reviewing forum', 'under_review', 50);
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by) values
  (94901, 94901, 94901, '2030-07-01T02:00Z', '2030-07-01T06:00Z', 'theatre', 'c4900000-0000-4000-8000-000000000002'),
  (94902, 94902, 94901, '2030-07-01T05:00Z', '2030-07-01T08:00Z', 'theatre', 'c4900000-0000-4000-8000-000000000002'),
  (94903, 94901, 94902, '2030-07-02T02:00Z', '2030-07-02T06:00Z', 'boardroom', 'c4900000-0000-4000-8000-000000000002'),
  (94904, 94901, 94901, '2030-07-03T02:00Z', '2030-07-03T06:00Z', 'theatre', 'c4900000-0000-4000-8000-000000000002'),
  (94905, 94902, 94901, '2030-07-04T02:00Z', '2030-07-04T06:00Z', 'theatre', 'c4900000-0000-4000-8000-000000000002'),
  (94906, 94902, 94902, '2030-07-05T03:00Z', '2030-07-05T04:00Z', 'boardroom', 'c4900000-0000-4000-8000-000000000002'),
  (94907, 94903, 94901, '2030-07-06T02:00Z', '2030-07-06T06:00Z', 'theatre', 'c4900000-0000-4000-8000-000000000002'),
  (94908, 94902, 94901, '2020-07-06T02:00Z', '2020-07-06T06:00Z', 'theatre', 'c4900000-0000-4000-8000-000000000002');
insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
  values (94901, '2030-07-04T00:00Z', '2030-07-05T00:00Z', 'Floor resurfacing');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c4900000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb; booking bigint; hold jsonb;
begin
  result := public.decide_venue_booking_request(94901, 'approve', null);
  if result->>'outcome' is distinct from 'updated' or result->>'status' is distinct from 'approved' then
    raise exception '[SG2-49:approve-commits] [SG2-49:AC1] [NORMAL] A clear request was not approved: %', result;
  end if;
  booking := (result->>'venue_booking_id')::bigint;
  perform set_config('decisions.booking', booking::text, true);

  result := public.decide_venue_booking_request(94902, 'approve', null);
  if result->>'outcome' is distinct from 'conflict' or result->>'kind' is distinct from 'booking' or result->>'label' is distinct from 'Decision forum' then
    raise exception '[SG2-49:overlapping-booking-refused] [SG2-49:AC1] [CONFLICT] An approval overlapping a confirmed booking was not refused: %', result;
  end if;
  if public.decide_venue_booking_request(94901, 'reject', 'Changed my mind')->>'outcome' is distinct from 'decided' then
    raise exception '[SG2-49:second-decision-refused] [SG2-49:AC3] [CONFLICT] A decided request was decided again';
  end if;

  if public.decide_venue_booking_request(94903, 'approve', null)->>'outcome' is distinct from 'capacity' then
    raise exception '[SG2-49:capacity-needs-exception] [SG2-49:AC1] [FAILURE] A venue too small for the attendance was approved without an exception';
  end if;
  reset role;
  insert into public.venue_capacity_exceptions (request_id, approved_by, approver_role, expected_attendance, venue_capacity)
    values (94903, 'c4900000-0000-4000-8000-000000000003', 'event_organiser', 80, 20);
  set local role authenticated;
  if public.decide_venue_booking_request(94903, 'approve', 'Organiser accepted standing room')->>'outcome' is distinct from 'updated' then
    raise exception '[SG2-49:exception-allows-approval] [SG2-49:AC1] [NORMAL] An approved capacity exception did not allow the approval';
  end if;

  if public.decide_venue_booking_request(94904, 'reject', null)->>'outcome' is distinct from 'invalid'
      or public.decide_venue_booking_request(94904, 'reject', '   ')->>'outcome' is distinct from 'invalid' then
    raise exception '[SG2-49:reject-needs-reason] [SG2-49:AC2] [BOUNDARY] A rejection without a reason was accepted';
  end if;
  if public.decide_venue_booking_request(94904, 'reject', repeat('x', 501))->>'outcome' is distinct from 'invalid'
      or public.decide_venue_booking_request(94904, 'reject', ' ' || repeat('x', 500) || ' ')->>'outcome' is distinct from 'updated' then
    raise exception '[SG2-49:reason-length] [SG2-49:AC2] [BOUNDARY] The reason must allow exactly 500 characters after trimming, and no more';
  end if;

  result := public.decide_venue_booking_request(94905, 'approve', null);
  if result->>'outcome' is distinct from 'conflict' or result->>'kind' is distinct from 'block' or result->>'label' is distinct from 'Floor resurfacing' then
    raise exception '[SG2-49:block-refused] [SG2-49:AC1] [CONFLICT] An approval inside a venue block was not refused: %', result;
  end if;

  hold := public.create_venue_hold(94902, 94902, '2030-07-05T02:00Z', '2030-07-05T06:00Z', clock_timestamp() + interval '2 days');
  result := public.decide_venue_booking_request(94906, 'approve', null);
  if result->>'outcome' is distinct from 'conflict' or result->>'kind' is distinct from 'hold' then
    raise exception '[SG2-49:active-hold-refused] [SG2-49:AC1] [CONFLICT] An approval overlapping an active hold was not refused: %', result;
  end if;
  result := public.decide_venue_booking_request((hold#>>'{hold,request_id}')::bigint, 'approve', null);
  if result->>'outcome' is distinct from 'hold' or (result->>'hold_id')::bigint is distinct from (hold#>>'{hold,hold_id}')::bigint then
    raise exception '[SG2-49:hold-request-refused] [SG2-49:AC1] [FAILURE] A hold''s own request was decided outside the hold: %', result;
  end if;

  if public.decide_venue_booking_request(94907, 'approve', null)->>'outcome' is distinct from 'closed'
      or public.decide_venue_booking_request(94908, 'approve', null)->>'outcome' is distinct from 'closed' then
    raise exception '[SG2-49:closed-request-refused] [SG2-49:AC1] [BOUNDARY] An event under review or a period already past was approved';
  end if;
  if public.decide_venue_booking_request(94907, 'reject', 'Event not approved yet')->>'outcome' is distinct from 'updated' then
    raise exception '[SG2-49:reject-any-pending] [SG2-49:AC2] [NORMAL] A pending request for an unapproved event could not be rejected';
  end if;
  if public.decide_venue_booking_request(-1, 'approve', null)->>'outcome' is distinct from 'missing'
      or public.decide_venue_booking_request(94902, 'maybe', null)->>'outcome' is distinct from 'invalid'
      or public.decide_venue_booking_request(94902, null, null)->>'outcome' is distinct from 'invalid' then
    raise exception '[SG2-49:unknown-input-refused] [SG2-49:AC3] [FAILURE] An unknown request or decision was not refused';
  end if;
end $$;

reset role;
do $$
declare booking bigint := current_setting('decisions.booking')::bigint;
begin
  if not exists (select 1 from public.venue_bookings where booking_id = booking and venue_id = 94901 and event_id = 94901
      and status = 'confirmed' and starts_at = '2030-07-01T02:00Z' and ends_at = '2030-07-01T06:00Z') then
    raise exception '[SG2-49:booking-committed] [SG2-49:AC1] [NORMAL] Approval must commit the venue as a confirmed booking for the requested period';
  end if;
  if not exists (select 1 from public.venue_booking_requests where request_id = 94901 and status = 'approved'
      and decided_by = 'c4900000-0000-4000-8000-000000000001' and decided_at is not null and venue_booking_id = booking) then
    raise exception '[SG2-49:approval-recorded] [SG2-49:AC3] [NORMAL] The approval, approver, time and booking must be recorded on the request';
  end if;
  if (select venue_booking_id from public.events where event_id = 94901) is distinct from booking then
    raise exception '[SG2-49:event-venue-set] [SG2-49:AC1] [NORMAL] The event must point at its first committed venue';
  end if;
  if (select venue_booking_id from public.events where event_id = 94901) = (select venue_booking_id from public.venue_booking_requests where request_id = 94903) then
    raise exception '[SG2-49:first-venue-kept] [SG2-49:AC1] [BOUNDARY] A second approved venue must not replace the event''s first';
  end if;
  if not exists (select 1 from public.venue_booking_requests where request_id = 94904 and status = 'rejected'
      and decision_reason = repeat('x', 500) and decided_by = 'c4900000-0000-4000-8000-000000000001' and venue_booking_id is null) then
    raise exception '[SG2-49:rejection-recorded] [SG2-49:AC2] [SG2-49:AC3] [NORMAL] A rejection must keep its trimmed reason, decider and no booking';
  end if;
  if exists (select 1 from public.venue_bookings where venue_id = 94901 and starts_at >= '2030-07-03T00:00Z' and starts_at < '2030-07-04T00:00Z') then
    raise exception '[SG2-49:rejection-books-nothing] [SG2-49:AC2] [NORMAL] A rejection must not book the venue';
  end if;
  if (select count(*) from public.venue_booking_requests where request_id in (94902, 94905, 94906, 94908) and status = 'pending') <> 4 then
    raise exception '[SG2-49:refusal-leaves-pending] [SG2-49:AC1] [CONFLICT] A refused approval must leave the request pending';
  end if;
  if (select count(*) from public.event_audit_logs where field_name = 'venue_booking_request'
      and actor_id = 'c4900000-0000-4000-8000-000000000001' and event_id in (94901, 94903)) <> 4
    or not exists (select 1 from public.event_audit_logs where event_id = 94901 and field_name = 'venue_booking_request'
      and old_value = 'Pending: Decision Hall (request 94901)' and new_value = 'Approved: Decision Hall (request 94901)') then
    raise exception '[SG2-49:decision-history] [SG2-49:AC3] [NORMAL] Every decision must appear in the event history with its actor';
  end if;
  if not exists (select 1 from public.notifications where request_id = 94901 and kind = 'venue_request_approved'
      and recipient_id = 'c4900000-0000-4000-8000-000000000002' and message = 'Decision Hall was approved for Decision forum.')
    or not exists (select 1 from public.notifications where request_id = 94907 and kind = 'venue_request_rejected'
      and message = 'Decision Hall was rejected for Reviewing forum: Event not approved yet') then
    raise exception '[SG2-49:coordinator-notified] [SG2-49:AC1] [SG2-49:AC2] [NORMAL] The coordinator must be notified of each decision, with a rejection''s reason';
  end if;
  if (select details->>'hold_id' from public.internal_work_items where kind = 'venue'
      and item_id = (select request_id from public.venue_holds where venue_id = 94902)) is null then
    raise exception '[SG2-49:queue-marks-holds] [SG2-49:AC1] [NORMAL] The work queue must show which requests belong to a hold';
  end if;

  begin
    update public.venue_booking_requests set status = 'approved' where request_id = 94902;
    raise exception '[SG2-49:anonymous-approval] [SG2-49:AC3] [FAILURE] A coordinator request was approved without recording who decided';
  exception when check_violation then null; end;
  begin
    update public.venue_booking_requests set status = 'rejected', decided_by = 'c4900000-0000-4000-8000-000000000001', decided_at = now()
      where request_id = 94902;
    raise exception '[SG2-49:rejection-without-reason] [SG2-49:AC2] [FAILURE] A coordinator request was rejected without a reason';
  exception when check_violation then null; end;
  begin
    update public.venue_booking_requests set decided_by = 'c4900000-0000-4000-8000-000000000001' where request_id = 94902;
    raise exception '[SG2-49:decider-without-time] [SG2-49:AC3] [FAILURE] A decider was recorded without a time';
  exception when check_violation then null; end;
end $$;

-- Only Venue Staff decide; each person reads only their own notifications.
do $$
declare person text;
begin
  foreach person in array array['c4900000-0000-4000-8000-000000000002', 'c4900000-0000-4000-8000-000000000003', 'c4900000-0000-4000-8000-000000000004'] loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', person, true);
    begin
      perform public.decide_venue_booking_request(94902, 'reject', 'Not my call');
      raise exception '[SG2-49:only-venue-staff-decide] [SG2-49:AC1] [FAILURE] % decided a venue request', person;
    exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'c4900000-0000-4000-8000-000000000002', true);
  if (select count(*) from public.notifications) <> 4 then
    raise exception '[SG2-49:coordinator-reads-own] [SG2-49:AC1] [NORMAL] The coordinator must see their own decision notifications';
  end if;
  begin
    insert into public.notifications (recipient_id, kind, message) values ('c4900000-0000-4000-8000-000000000002', 'venue_request_approved', 'Forged');
    raise exception '[SG2-49:no-forged-notifications] [SG2-49:AC1] [FAILURE] A client wrote a notification directly';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', 'c4900000-0000-4000-8000-000000000003', true);
  if exists (select 1 from public.notifications) then
    raise exception '[SG2-49:others-notifications-hidden] [SG2-49:AC1] [FAILURE] Someone read another person''s notifications';
  end if;
  reset role;
  -- The recreated work queue view bypasses RLS as its owner, so only the
  -- server may read it.
  if has_table_privilege('authenticated', 'public.internal_work_items', 'SELECT')
      or has_table_privilege('anon', 'public.internal_work_items', 'SELECT')
      or not has_table_privilege('service_role', 'public.internal_work_items', 'SELECT') then
    raise exception '[SG2-49:queue-view-server-only] [SG2-49:AC1] [FAILURE] Only the server may read the work queue view';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.notifications'::regclass) then
    raise exception '[SG2-49:notifications-rls-forced] [SG2-49:AC1] [FAILURE] Row level security must be enabled and forced on notifications';
  end if;
end $$;

rollback;
