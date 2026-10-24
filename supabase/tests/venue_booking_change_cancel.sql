-- Review trace: SG2-83 change or cancel one venue of a multi-venue event.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-83: only the assigned coordinator cancels a venue booking, the others
-- stay unless named, the period (with setup/turnaround) is free again, the
-- change or cancellation is recorded and Venue Staff are told, and a
-- Confirmed or Preparation event returns to Planning.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users (id) values
  ('e8300000-0000-4000-8000-000000000001'), ('e8300000-0000-4000-8000-000000000002'),
  ('e8300000-0000-4000-8000-000000000003'), ('e8300000-0000-4000-8000-000000000004'),
  ('e8300000-0000-4000-8000-000000000005'), ('e8300000-0000-4000-8000-000000000006');
insert into public.users (user_id, name, role_id) values
  ('e8300000-0000-4000-8000-000000000001', 'Change staff', 3),
  ('e8300000-0000-4000-8000-000000000002', 'Change coordinator', 2),
  ('e8300000-0000-4000-8000-000000000003', 'Change organiser', 1),
  ('e8300000-0000-4000-8000-000000000004', 'Neighbour coordinator', 2),
  ('e8300000-0000-4000-8000-000000000005', 'Change support', 4),
  ('e8300000-0000-4000-8000-000000000006', 'Second staff', 3);
insert into public.account_roles (user_id, role) values
  ('e8300000-0000-4000-8000-000000000001', 'venue_staff'),
  ('e8300000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('e8300000-0000-4000-8000-000000000003', 'event_organiser'),
  ('e8300000-0000-4000-8000-000000000004', 'event_coordinator'),
  ('e8300000-0000-4000-8000-000000000005', 'technical_support_staff'),
  ('e8300000-0000-4000-8000-000000000006', 'venue_staff');
insert into public.venues (venue_id, name) values (98301, 'Change Hall A'), (98302, 'Change Hall B'), (98303, 'Change Hall C');
-- AC3: Hall A needs 30 minutes' setup and 45 minutes' turnaround.
insert into public.venue_operations (venue_id, setup_minutes, turnaround_minutes) values (98301, 30, 45);
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (98301, 'e8300000-0000-4000-8000-000000000003', 'e8300000-0000-4000-8000-000000000002', 'Change Summit', 'planning'),
  (98302, 'e8300000-0000-4000-8000-000000000003', 'e8300000-0000-4000-8000-000000000004', 'Neighbour Fair', 'planning'),
  (98303, 'e8300000-0000-4000-8000-000000000003', 'e8300000-0000-4000-8000-000000000002', 'Confirmed Gala', 'confirmed'),
  (98304, 'e8300000-0000-4000-8000-000000000003', 'e8300000-0000-4000-8000-000000000002', 'Prep Expo', 'preparation');
update public.events set confirmed_by = 'e8300000-0000-4000-8000-000000000002', confirmed_at = now() where event_id = 98303;
-- The summit has three venues at once; the gala and the expo two each.
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (98311, 98301, 98301, '2031-03-01 01:00+00', '2031-03-01 05:00+00', 'confirmed'),
  (98312, 98302, 98301, '2031-03-01 01:00+00', '2031-03-01 05:00+00', 'confirmed'),
  (98313, 98303, 98301, '2031-03-01 01:00+00', '2031-03-01 05:00+00', 'confirmed'),
  (98314, 98302, 98301, '2020-03-01 01:00+00', '2020-03-01 05:00+00', 'confirmed'),
  (98331, 98301, 98303, '2031-04-01 01:00+00', '2031-04-01 05:00+00', 'confirmed'),
  (98332, 98302, 98303, '2031-04-01 01:00+00', '2031-04-01 05:00+00', 'confirmed'),
  (98341, 98303, 98304, '2031-05-01 01:00+00', '2031-05-01 05:00+00', 'confirmed'),
  (98342, 98302, 98304, '2031-05-01 01:00+00', '2031-05-01 05:00+00', 'confirmed'),
  (98321, 98303, 98302, '2031-06-01 01:00+00', '2031-06-01 05:00+00', 'confirmed');
update public.events set venue_booking_id = 98311 where event_id = 98301;
update public.events set venue_booking_id = 98331 where event_id = 98303;
update public.events set venue_booking_id = 98341 where event_id = 98304;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    status, decided_by, decided_at, venue_booking_id) values
  (98311, 98301, 98301, '2031-03-01 01:00+00', '2031-03-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    'approved', 'e8300000-0000-4000-8000-000000000001', now(), 98311),
  (98312, 98301, 98302, '2031-03-01 01:00+00', '2031-03-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    'approved', 'e8300000-0000-4000-8000-000000000001', now(), 98312),
  (98313, 98301, 98303, '2031-03-01 01:00+00', '2031-03-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    'approved', 'e8300000-0000-4000-8000-000000000001', now(), 98313),
  (98331, 98303, 98301, '2031-04-01 01:00+00', '2031-04-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    'approved', 'e8300000-0000-4000-8000-000000000001', now(), 98331),
  (98332, 98303, 98302, '2031-04-01 01:00+00', '2031-04-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    'approved', 'e8300000-0000-4000-8000-000000000001', now(), 98332),
  (98341, 98304, 98303, '2031-05-01 01:00+00', '2031-05-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    'approved', 'e8300000-0000-4000-8000-000000000001', now(), 98341),
  (98342, 98304, 98302, '2031-05-01 01:00+00', '2031-05-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    'approved', 'e8300000-0000-4000-8000-000000000001', now(), 98342);
-- AC3: the neighbour wants Hall A from 05:30, inside the summit booking's
-- 45-minute turnaround.
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by) values
  (98320, 98302, 98301, '2031-03-01 05:30+00', '2031-03-01 07:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000004');

-- 1. AC5: only the assigned coordinator, in the database as well as the API.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    perform public.release_venue_bookings(98311, array[]::bigint[], 'Staff cannot cancel');
    raise exception '[SG2-83:staff-refused] [SG2-83:AC5] [FAILURE] Venue Staff cancelled a venue booking';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.release_venue_booking(98311, 'Staff cannot release');
    raise exception '[SG2-83:staff-single-release-refused] [SG2-83:AC5] [FAILURE] Venue Staff released a venue booking through the SG2-51 call';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000005', true);
do $$
begin
  begin
    perform public.release_venue_bookings(98311, array[]::bigint[], 'Support cannot cancel');
    raise exception '[SG2-83:other-role-refused] [SG2-83:AC5] [FAILURE] Technical Support Staff cancelled a venue booking';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000003', true);
do $$
begin
  begin
    perform public.release_venue_bookings(98311, array[]::bigint[], 'Organiser cannot cancel');
    raise exception '[SG2-83:organiser-refused] [SG2-83:AC5] [FAILURE] The Event Organiser cancelled a venue booking';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000004', true);
do $$
begin
  if public.release_venue_bookings(98311, array[]::bigint[], 'Not my event')->>'outcome' <> 'missing' then
    raise exception '[SG2-83:unassigned-coordinator-hidden] [SG2-83:AC5] [FAILURE] A coordinator not assigned to the event must see the booking as missing';
  end if;
end $$;

-- 2. AC2/AC3 boundaries, refused before anything changes.
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000002', true);
do $$
begin
  if public.release_venue_bookings(98311, array[98321]::bigint[], 'Another event''s booking')->>'outcome' <> 'others_invalid'
      or public.release_venue_bookings(98311, array[98314]::bigint[], 'A past booking')->>'outcome' <> 'others_invalid'
      or public.release_venue_bookings(98311, array[-1]::bigint[], 'An unknown booking')->>'outcome' <> 'others_invalid' then
    raise exception '[SG2-83:others-must-belong] [SG2-83:AC2] [BOUNDARY] Other bookings cancelled alongside must be live bookings of the same event';
  end if;
  if public.release_venue_bookings(98311, array(select generate_series(1, 51)::bigint), 'Too many')->>'outcome' <> 'invalid'
      or public.release_venue_bookings(98311, array[]::bigint[], repeat('x', 501))->>'outcome' <> 'invalid'
      or public.release_venue_bookings(98311, array[]::bigint[], '  ')->>'outcome' <> 'invalid' then
    raise exception '[SG2-83:limits] [SG2-83:AC4] [BOUNDARY] A cancellation needs a reason of 500 characters or fewer and at most 50 other bookings';
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.venue_bookings where booking_id in (98311, 98312, 98313, 98321) and status = 'confirmed') <> 4
      or exists (select 1 from public.notifications where event_id in (98301, 98302))
      or exists (select 1 from public.event_audit_logs where event_id = 98301 and field_name = 'venue_booking') then
    raise exception '[SG2-83:refusals-no-side-effects] [SG2-83:AC5] [FAILURE] A refused cancellation must leave every booking, notice and history entry unchanged';
  end if;
end $$;

-- 3. AC3: the neighbour's request clashes with the turnaround while the
-- summit holds Hall A.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb := public.decide_venue_booking_request(98320, 'approve', null);
begin
  if result->>'outcome' <> 'conflict' or result->>'kind' <> 'booking' then
    raise exception '[SG2-83:turnaround-held] [SG2-83:AC3] [CONFLICT] A request inside the booked turnaround must clash before the cancellation: %', result;
  end if;
end $$;

-- 4. AC1/AC4: the coordinator cancels Hall A only, with a 500-character reason.
reset role;
select set_config('sg2_83.summit_status', (select status::text from public.events where event_id = 98301), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb := public.release_venue_bookings(98311, array[]::bigint[], '  ' || repeat('h', 500) || '  ');
begin
  if result->>'outcome' <> 'released' or result->'also_released' <> '[]'::jsonb
      or (result->>'returned_to_planning')::boolean then
    raise exception '[SG2-83:cancel-one] [SG2-83:AC1] [NORMAL] The coordinator could not cancel one venue: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.venue_bookings where booking_id in (98312, 98313) and status = 'confirmed'
      and starts_at = '2031-03-01 01:00+00' and ends_at = '2031-03-01 05:00+00') <> 2
      or (select count(*) from public.venue_booking_requests where request_id in (98312, 98313) and status = 'approved') <> 2
      or (select venue_booking_id from public.events where event_id = 98301) <> 98312 then
    raise exception '[SG2-83:others-unchanged] [SG2-83:AC1] [NORMAL] The event''s other venue bookings must stay as they were';
  end if;
  if not exists (select 1 from public.venue_bookings where booking_id = 98311 and status = 'cancelled'
      and cancelled_by = 'e8300000-0000-4000-8000-000000000002' and cancelled_at is not null
      and cancellation_reason = repeat('h', 500)) then
    raise exception '[SG2-83:cancel-recorded] [SG2-83:AC4] [NORMAL] Who cancelled, when and why must be kept on the booking';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 98301 and field_name = 'venue_booking'
      and actor_id = 'e8300000-0000-4000-8000-000000000002' and new_value like 'Released: Change Hall A (booking 98311) — h%') then
    raise exception '[SG2-83:cancel-in-history] [SG2-83:AC4] [NORMAL] The cancellation must appear in the event history with its actor and reason';
  end if;
  if (select count(*) from public.notifications where event_id = 98301 and kind = 'venue_booking_cancelled'
      and recipient_id in ('e8300000-0000-4000-8000-000000000001', 'e8300000-0000-4000-8000-000000000006')
      and message like 'Change coordinator cancelled the booking of Change Hall A for Change Summit (01 Mar 2031 09:00 – 01 Mar 2031 13:00 SGT): h%') <> 2
      or exists (select 1 from public.notifications where kind = 'venue_booking_cancelled'
        and recipient_id not in ('e8300000-0000-4000-8000-000000000001', 'e8300000-0000-4000-8000-000000000006')) then
    raise exception '[SG2-83:staff-notified] [SG2-83:AC4] [NORMAL] Every Venue Staff account, and only Venue Staff, must be told of the cancellation';
  end if;
  -- The summit had not reached Preparation, so the cancellation does not move
  -- it (SG2-91 still keeps its safety-check status up to date).
  if current_setting('sg2_83.summit_status') in ('preparation', 'confirmed')
      or exists (select 1 from public.event_audit_logs where event_id = 98301 and field_name = 'status' and new_value = 'planning'
        and old_value in ('preparation', 'confirmed'))
      or exists (select 1 from public.events where event_id = 98301 and outstanding_arrangements @> '["venue_recheck"]'::jsonb) then
    raise exception '[SG2-83:before-preparation-not-moved] [SG2-83:AC7] [BOUNDARY] An event not yet in Preparation must not be sent back or given a venue recheck';
  end if;
end $$;

-- 5. AC3: the period and its setup/turnaround are free again.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb := public.decide_venue_booking_request(98320, 'approve', null);
begin
  if result->>'outcome' <> 'updated' then
    raise exception '[SG2-83:turnaround-freed] [SG2-83:AC3] [NORMAL] A request inside the cancelled booking''s turnaround must now be approvable: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.venue_booking_occupancy where venue_id = 98301 and starts_at = '2031-03-01 01:00+00') then
    raise exception '[SG2-83:occupancy-freed] [SG2-83:AC3] [NORMAL] A cancelled booking must no longer occupy its venue';
  end if;
end $$;

-- 6. AC2: cancelling Hall B and, explicitly, Hall C as well.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb := public.release_venue_bookings(98312, array[98313, 98313]::bigint[], 'Event moved online');
begin
  if result->>'outcome' <> 'released' or result->'also_released' <> '[98313]'::jsonb then
    raise exception '[SG2-83:cancel-others-chosen] [SG2-83:AC2] [NORMAL] Bookings the coordinator names must be cancelled too: %', result;
  end if;
  result := public.release_venue_bookings(98312, array[]::bigint[], 'Again');
  if result->>'outcome' <> 'inactive' or result->>'status' <> 'cancelled' then
    raise exception '[SG2-83:cancel-twice] [SG2-83:AC1] [CONFLICT] A booking already cancelled was cancelled again: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.venue_bookings where event_id = 98301 and status = 'cancelled'
      and cancellation_reason = 'Event moved online') <> 2
      or (select count(*) from public.event_audit_logs where event_id = 98301 and field_name = 'venue_booking'
        and new_value like '%— Event moved online') <> 2
      or (select venue_booking_id from public.events where event_id = 98301) is not null then
    raise exception '[SG2-83:others-recorded] [SG2-83:AC2] [NORMAL] Each booking cancelled alongside must be recorded and the event left without a main venue';
  end if;
  if (select status from public.venue_bookings where booking_id = 98321) <> 'confirmed' then
    raise exception '[SG2-83:other-events-kept] [SG2-83:AC1] [CONFLICT] Another event''s booking must not be touched';
  end if;
end $$;

-- 7. AC7: cancelling one venue of a Confirmed event returns it to Planning,
-- keeps the other venue, and leaves a venue recheck outstanding.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb := public.release_venue_bookings(98331, null, 'Hall A no longer needed');
begin
  if result->>'outcome' <> 'released' or not (result->>'returned_to_planning')::boolean then
    raise exception '[SG2-83:confirmed-cancel] [SG2-83:AC7] [NORMAL] Cancelling a venue of a Confirmed event must return it to Planning: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.events where event_id = 98303 and status = 'planning'
      and confirmed_by is null and confirmed_at is null and arrangements_recheck_needed
      and outstanding_arrangements @> '["venue_recheck"]'::jsonb and venue_booking_id = 98332) then
    raise exception '[SG2-83:confirmed-back-to-planning] [SG2-83:AC7] [NORMAL] The event must be in Planning with its confirmation cleared and a venue recheck outstanding';
  end if;
  if (select status from public.venue_bookings where booking_id = 98332) <> 'confirmed' then
    raise exception '[SG2-83:confirmed-others-intact] [SG2-83:AC7] [NORMAL] The Confirmed event''s other venue must stay booked';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 98303 and field_name = 'status'
      and old_value = 'confirmed' and new_value = 'planning' and actor_id = 'e8300000-0000-4000-8000-000000000002')
      or (select count(*) from public.notifications where event_id = 98303 and kind = 'event_returned_to_planning'
        and recipient_id in ('e8300000-0000-4000-8000-000000000002', 'e8300000-0000-4000-8000-000000000003')) <> 2 then
    raise exception '[SG2-83:confirmed-move-recorded] [SG2-83:AC7] [NORMAL] The move to Planning must be in the history and the organiser and coordinator told';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb := public.confirm_event(98303);
begin
  -- SG2-94 AC5: back in Planning, the refusal lists the safety check among what is outstanding.
  if result->>'outcome' is distinct from 'outstanding' or not (result->'outstanding' @> '["safety"]'::jsonb) then
    raise exception '[SG2-83:confirmed-must-recheck] [SG2-83:AC7] [SG2-94:AC5] [FAILURE] An event returned to Planning must not confirm straight away: %', result;
  end if;
end $$;
reset role;

-- 8. AC4/AC7: asking to change one venue of a Preparation event. The change
-- is a request Venue Staff decide; the current booking stays until then.
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    replaces_booking_id, change_reason) values
  (98343, 98304, 98301, '2031-05-01 01:00+00', '2031-05-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    98341, 'Hall C is too small for the new seating plan');
do $$
begin
  if not exists (select 1 from public.events where event_id = 98304 and status = 'planning' and confirmed_at is null
      and not coalesce(outstanding_arrangements, '[]'::jsonb) @> '["venue_recheck"]'::jsonb) then
    raise exception '[SG2-83:change-back-to-planning] [SG2-83:AC7] [NORMAL] Asking to change a venue of a Preparation event must return it to Planning, the pending change keeping the venue outstanding';
  end if;
  if (select count(*) from public.venue_bookings where booking_id in (98341, 98342) and status = 'confirmed') <> 2 then
    raise exception '[SG2-83:change-keeps-bookings] [SG2-83:AC1] [NORMAL] Asking for a change must leave every current booking in place until it is approved';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 98304 and field_name = 'venue_booking'
      and actor_id = 'e8300000-0000-4000-8000-000000000002'
      and new_value = 'Change requested: Change Hall C (booking 98341) to Change Hall A (request 98343) — Hall C is too small for the new seating plan')
      or (select count(*) from public.notifications where event_id = 98304 and kind = 'venue_change_requested'
        and message like 'A change is requested for Prep Expo: Change Hall C (booking 98341) to Change Hall A%Hall C is too small%') <> 2 then
    raise exception '[SG2-83:change-recorded] [SG2-83:AC4] [NORMAL] The change and its reason must be in the history and every Venue Staff account told';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000006', true);
do $$
declare result jsonb := public.decide_venue_booking_request(98343, 'approve', null);
begin
  if result->>'outcome' <> 'updated' then
    raise exception '[SG2-83:change-approved] [SG2-83:AC7] [NORMAL] Venue Staff must be able to approve the change: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.venue_bookings where booking_id = 98341 and status = 'cancelled'
      and cancellation_reason = 'Changed to Change Hall A: Hall C is too small for the new seating plan')
      or (select status from public.venue_bookings where booking_id = 98342) <> 'confirmed'
      or not exists (select 1 from public.venue_bookings where event_id = 98304 and venue_id = 98301 and status = 'confirmed') then
    raise exception '[SG2-83:change-applied] [SG2-83:AC1] [NORMAL] Approving the change must release only the replaced booking, with the coordinator''s reason';
  end if;
end $$;

-- 8a. AC5: the internal helpers are callable by no API role, the service
-- role included (Supabase grants it EXECUTE by default).
do $$
declare
  fn text;
  who text;
begin
  foreach fn in array array['public.notify_venue_staff(integer,uuid,text,text)',
      'public.return_event_to_planning_for_venue(integer,uuid,boolean)',
      'public.venue_change_request_check()', 'public.venue_change_requested()'] loop
    foreach who in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(who, fn, 'execute') then
        raise exception '[SG2-83:internal-functions-private] [SG2-83:AC5] [FAILURE] % may execute %', who, fn;
      end if;
    end loop;
  end loop;
  if not has_function_privilege('authenticated', 'public.release_venue_bookings(bigint,bigint[],text)', 'execute') then
    raise exception '[SG2-83:release-callable] [SG2-83:AC5] [NORMAL] Signed-in callers must reach release_venue_bookings(), which checks the role itself';
  end if;
end $$;

-- 8b. AC1/AC7: cancelling a booking withdraws a change still waiting to
-- replace it, so Venue Staff cannot approve it later as a new booking.
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    replaces_booking_id, change_reason) values
  (98344, 98303, 98303, '2031-04-01 01:00+00', '2031-04-01 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002',
    98332, 'Hall B is being repainted');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000002', true);
do $$
begin
  if public.release_venue_bookings(98332, array[]::bigint[], 'Gala moved off site')->>'outcome' <> 'released' then
    raise exception '[SG2-83:cancel-with-pending-change] [SG2-83:AC1] [NORMAL] The coordinator could not cancel a booking with a pending change';
  end if;
end $$;
select set_config('request.jwt.claim.sub', 'e8300000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb := public.decide_venue_booking_request(98344, 'approve', null);
begin
  if result->>'outcome' <> 'decided' or result->>'status' <> 'cancelled' then
    raise exception '[SG2-83:withdrawn-change-not-approvable] [SG2-83:AC1] [CONFLICT] A change whose booking was cancelled must not be approvable: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.venue_booking_requests where request_id = 98344 and status = 'cancelled'
      and withdrawn_by = 'e8300000-0000-4000-8000-000000000002' and withdrawn_at is not null) then
    raise exception '[SG2-83:pending-change-withdrawn] [SG2-83:AC1] [NORMAL] Cancelling a booking must withdraw the change waiting to replace it, as the coordinator';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 98303 and field_name = 'venue_booking_request'
      and new_value = 'Withdrawn: Change Hall C (request 98344) — the booking it would replace, Change Hall B (booking 98332), was released')
      or exists (select 1 from public.venue_bookings where event_id = 98303 and venue_id = 98303) then
    raise exception '[SG2-83:pending-change-withdrawal-recorded] [SG2-83:AC4] [NORMAL] The withdrawal must be in the history and no booking made for it';
  end if;
end $$;

-- 9. The database backstop: a change must name a live booking of the same
-- event, so one raised as the booking is cancelled, or for another event's
-- booking, is refused.
do $$
begin
  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by, replaces_booking_id)
      values (98301, 98302, '2031-03-02 01:00+00', '2031-03-02 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002', 98311);
    raise exception '[SG2-83:change-cancelled-refused] [SG2-83:AC1] [CONFLICT] A change was raised for a booking already cancelled';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by, replaces_booking_id)
      values (98301, 98302, '2031-03-02 01:00+00', '2031-03-02 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002', 98321);
    raise exception '[SG2-83:change-other-event-refused] [SG2-83:AC1] [FAILURE] A change was raised for another event''s booking';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by, change_reason)
      values (98301, 98302, '2031-03-02 01:00+00', '2031-03-02 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002', 'No booking');
    raise exception '[SG2-83:reason-needs-change] [SG2-83:AC4] [FAILURE] A change reason was kept on a request that changes nothing';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, layout, requested_by, replaces_booking_id, change_reason)
      values (98304, 98302, '2031-05-02 01:00+00', '2031-05-02 05:00+00', 'theatre', 'e8300000-0000-4000-8000-000000000002', 98342, repeat('x', 501));
    raise exception '[SG2-83:change-reason-length] [SG2-83:AC4] [BOUNDARY] A change reason longer than 500 characters was kept';
  exception when check_violation then null;
  end;
end $$;

rollback;
