-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- Run after the migrations in a disposable/development database as postgres.
-- Test records are rolled back. Never run against production.
--
-- Covers SG2-81 (Week 7 customer change #2): the coordinator of an event whose
-- confirmed booking a venue's unavailability affects is told the venue, the
-- period and the reason; the event shows the booking as outstanding while its
-- own details stay as they were; approving a replacement venue releases the
-- affected booking, so the event no longer shows alternative arrangements as
-- required; an event that was Confirmed or in Preparation moves back to
-- Planning and its Event Organiser is told.
begin;

insert into auth.users (id) values
  ('f8100000-0000-4000-8000-000000000001'),  -- venue_staff
  ('f8100000-0000-4000-8000-000000000002'),  -- event_coordinator (assigned)
  ('f8100000-0000-4000-8000-000000000003'),  -- event_organiser
  ('f8100000-0000-4000-8000-000000000004');  -- event_coordinator (not assigned)
insert into public.users (user_id, name, role_id) values
  ('f8100000-0000-4000-8000-000000000001', 'Vera Staff', 3),
  ('f8100000-0000-4000-8000-000000000002', 'Colin Coordinator', 2),
  ('f8100000-0000-4000-8000-000000000003', 'Olive Organiser', 1),
  ('f8100000-0000-4000-8000-000000000004', 'Other Coordinator', 2);
insert into public.account_roles (user_id, role) values
  ('f8100000-0000-4000-8000-000000000001', 'venue_staff'),
  ('f8100000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('f8100000-0000-4000-8000-000000000003', 'event_organiser'),
  ('f8100000-0000-4000-8000-000000000004', 'event_coordinator');

insert into public.venues (venue_id, name, capacity) values (982, 'Old Hall', 100), (983, 'New Hall', 100);
insert into public.events (event_id, organiser_id, coordinator_id, name, status, expected_attendance, venue_requirements) values
  (98101, 'f8100000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000002', 'Summit Day', 'preparation', 80, 'Projector and stage'),
  (98102, 'f8100000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000004', 'Other Event', 'preparation', 40, null),
  (98103, 'f8100000-0000-4000-8000-000000000003', null, 'Unassigned Event', 'approved', null, null),
  (98105, 'f8100000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000002', 'Confirmed Gala', 'confirmed', 60, 'Stage');
update public.events set confirmed_by = 'f8100000-0000-4000-8000-000000000002', confirmed_at = '2031-01-01 00:00+00'
  where event_id = 98105;
-- SG2-94: an event in Preparation or Confirmed holds the Safety Officer's
-- approval (the decision's author is not under test here).
insert into public.event_safety_decisions (event_id, decision, decided_by)
  select event_id, 'approve', 'f8100000-0000-4000-8000-000000000001' from unnest(array[98101, 98102, 98105]) event_id;
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (98101, 982, 98101, '2031-05-01 09:00+00', '2031-05-01 17:00+00', 'confirmed'),
  (98102, 982, 98102, '2031-05-10 09:00+00', '2031-05-10 17:00+00', 'confirmed'),
  (98103, 982, 98103, '2031-05-01 18:00+00', '2031-05-01 20:00+00', 'confirmed'),
  (98105, 982, 98105, '2031-05-01 20:30+00', '2031-05-01 22:00+00', 'confirmed');
update public.events set venue_booking_id = 98101 where event_id = 98101;
update public.events set venue_booking_id = 98102 where event_id = 98102;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    status, decided_by, decided_at, venue_booking_id) values
  (98101, 98101, 982, '2031-05-01 09:00+00', '2031-05-01 17:00+00', 'theatre', 'f8100000-0000-4000-8000-000000000002',
    'approved', 'f8100000-0000-4000-8000-000000000001', now(), 98101),
  (98102, 98102, 982, '2031-05-10 09:00+00', '2031-05-10 17:00+00', 'theatre', 'f8100000-0000-4000-8000-000000000004',
    'approved', 'f8100000-0000-4000-8000-000000000001', now(), 98102);

-- Before anything is marked unavailable the summit can be confirmed, so any
-- later refusal is because of the unavailability and nothing else.
-- (Checked inside a savepoint that is rolled back.)
savepoint before_unavailability;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"f8100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if public.confirm_event(98101)->>'outcome' IS DISTINCT FROM 'ok' then
    raise exception '[SG2-81:baseline-confirmable] [SG2-81:AC2] [NORMAL] The summit must be confirmable before its venue is unavailable';
  end if;
end $$;
reset role;
rollback to savepoint before_unavailability;

-- Venue Staff mark Old Hall unavailable over the summit's, the confirmed
-- gala's and the unassigned event's bookings (and not the other event's).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"f8100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  period bigint;
begin
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, category, reason)
    values (982, '2031-05-01 00:00+00', '2031-05-02 00:00+00', 'equipment_failure', 'Air conditioning failed')
    returning unavailability_id into period;
  perform set_config('sg2_81.period', period::text, true);
end $$;
reset role;

-- AC1: the assigned coordinator is told the venue, the period and the reason.
do $$
declare
  note text;
begin
  select message into note from public.notifications
    where recipient_id = 'f8100000-0000-4000-8000-000000000002' and kind = 'venue_unavailable' and event_id = 98101;
  if note is null then
    raise exception '[SG2-81:coordinator-told] [SG2-81:AC1] [NORMAL] The coordinator of an affected event must be notified';
  end if;
  if note not like '%Old Hall%' or note not like '%01 May 2031 08:00%' or note not like '%02 May 2031 08:00%'
      or note not like '%Equipment Failure: Air conditioning failed%' then
    raise exception '[SG2-81:notice-names-venue-period-reason] [SG2-81:AC1] [NORMAL] The notice must name the venue, the period (Singapore time) and the reason: %', note;
  end if;
  if note not like '%Summit Day%' or note not like '%01 May 2031 17:00%' then
    raise exception '[SG2-81:notice-names-event-booking] [SG2-81:AC1] [NORMAL] The notice must name the affected event and booking period: %', note;
  end if;
end $$;

-- AC1: only the affected event's coordinator hears of it; an event with no
-- coordinator raises no error and no notice; an unaffected booking is silent.
do $$
begin
  if exists (select 1 from public.notifications where kind = 'venue_unavailable'
      and recipient_id not in ('f8100000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000003')) then
    raise exception '[SG2-81:only-affected-coordinator] [SG2-81:AC1] [FAILURE] Another coordinator or Venue Staff were notified';
  end if;
  if (select count(*) from public.notifications where kind = 'venue_unavailable'
      and recipient_id = 'f8100000-0000-4000-8000-000000000002') <> 2 then
    raise exception '[SG2-81:one-notice-per-flag] [SG2-81:AC1] [BOUNDARY] Exactly one notice per affected booking with a coordinator is expected';
  end if;
  if not exists (select 1 from public.venue_booking_disruptions where booking_id = 98103) then
    raise exception '[SG2-81:unassigned-event-still-flagged] [SG2-81:AC1] [BOUNDARY] The booking of an event with no coordinator is still flagged';
  end if;
end $$;

-- AC1: widening the period keeps the same flag, so nobody is told twice.
update public.venue_unavailability set ends_at = '2031-05-03 00:00+00'
  where unavailability_id = current_setting('sg2_81.period')::bigint;
do $$
begin
  if (select count(*) from public.notifications where kind = 'venue_unavailable') <> 4 then
    raise exception '[SG2-81:no-repeat-notice] [SG2-81:AC1] [CONFLICT] A flag that stands through a change of the period must not notify again';
  end if;
end $$;

-- AC6: the Preparation and the Confirmed event move back to Planning, with
-- the move in their history and the Event Organiser told the venue
-- arrangement is being changed. An event the flag does not reach, or one still
-- being approved, keeps its status.
do $$
begin
  if (select status::text from public.events where event_id = 98101) IS DISTINCT FROM 'planning'
    or (select status::text from public.events where event_id = 98105) IS DISTINCT FROM 'planning' then
    raise exception '[SG2-81:preparation-and-confirmed-revert] [SG2-81:AC6] [NORMAL] A Preparation and a Confirmed event with an affected booking must move back to Planning';
  end if;
  if (select confirmed_by from public.events where event_id = 98105) is not null
    or (select confirmed_at from public.events where event_id = 98105) is not null then
    raise exception '[SG2-81:confirmation-cleared] [SG2-81:AC6] [NORMAL] A reverted event is no longer confirmed, so its confirmation stamp must be cleared';
  end if;
  if (select status::text from public.events where event_id = 98102) IS DISTINCT FROM 'preparation'
    or (select status::text from public.events where event_id = 98103) IS DISTINCT FROM 'approved' then
    raise exception '[SG2-81:unaffected-or-early-events-keep-status] [SG2-81:AC6] [BOUNDARY] An unaffected Preparation event and an Approved affected one must keep their status';
  end if;
  if (select array_agg(old_value order by event_id) from public.event_audit_logs
        where field_name = 'status' and new_value = 'planning' and event_id in (98101, 98102, 98103, 98105))
      is distinct from array['preparation', 'confirmed'] then
    raise exception '[SG2-81:revert-in-history] [SG2-81:AC6] [NORMAL] Exactly the two reverts must be recorded in the events'' history, with the status they left';
  end if;
  if (select count(*) from public.notifications where recipient_id = 'f8100000-0000-4000-8000-000000000003'
        and kind = 'venue_unavailable' and event_id in (98101, 98105)
        and message like '%venue arrangement for%is being changed%' and message like '%Old Hall is unavailable%'
        and message like '%moved back to Planning%') <> 2 then
    raise exception '[SG2-81:organiser-told-arrangement-changing] [SG2-81:AC6] [NORMAL] The Event Organiser must be told the venue arrangement is being changed, once per reverted event';
  end if;
  if exists (select 1 from public.notifications where recipient_id = 'f8100000-0000-4000-8000-000000000003'
        and event_id in (98102, 98103)) then
    raise exception '[SG2-81:organiser-not-told-when-not-reverted] [SG2-81:AC6] [FAILURE] The organiser must not be told about events that did not move back';
  end if;
  if (select message from public.notifications where recipient_id = 'f8100000-0000-4000-8000-000000000002'
        and event_id = 98101 and kind = 'venue_unavailable') not like '%The event has moved back to Planning.' then
    raise exception '[SG2-81:coordinator-told-of-revert] [SG2-81:AC6] [NORMAL] The coordinator must be told the event moved back to Planning';
  end if;
end $$;

-- A second flag on an event already back in Planning does not move it or
-- tell the organiser again.
do $$
begin
  insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status)
    values (98106, 982, 98101, '2031-05-01 22:30+00', '2031-05-01 23:30+00', 'confirmed');
  if (select count(*) from public.notifications where recipient_id = 'f8100000-0000-4000-8000-000000000003'
        and event_id = 98101 and kind = 'venue_unavailable') <> 1
    or (select count(*) from public.event_audit_logs where event_id = 98101 and field_name = 'status') <> 1 then
    raise exception '[SG2-81:second-flag-no-second-revert] [SG2-81:AC6] [CONFLICT] A further affected booking of an event already in Planning must not revert or notify the organiser again';
  end if;
  delete from public.venue_bookings where booking_id = 98106;
end $$;

-- AC2/AC3: the event advances to Preparation again with the booking still
-- affected: it is outstanding, so the event cannot be confirmed, and nothing
-- about the event or its booking has changed.
-- SG2-94: back to Preparation only through a new approval of a new check.
update public.events set status = 'awaiting_safety_check' where event_id = 98101;
insert into public.event_safety_decisions (event_id, decision, decided_by) values (98101, 'approve', 'f8100000-0000-4000-8000-000000000001');
update public.events set status = 'preparation' where event_id = 98101;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"f8100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare
  result jsonb := public.confirm_event(98101);
begin
  if result->>'outcome' IS DISTINCT FROM 'outstanding' or result->'outstanding' IS DISTINCT FROM '["venue"]'::jsonb then
    raise exception '[SG2-81:affected-booking-outstanding] [SG2-81:AC2] [NORMAL] An affected booking must leave the venue arrangement outstanding: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.events where event_id = 98101 and name = 'Summit Day'
      and expected_attendance = 80 and venue_requirements = 'Projector and stage' and venue_booking_id = 98101)
    or not exists (select 1 from public.events where event_id = 98105 and name = 'Confirmed Gala'
      and expected_attendance = 60 and venue_requirements = 'Stage' and venue_booking_id is null) then
    raise exception '[SG2-81:event-details-unchanged] [SG2-81:AC3] [NORMAL] The event''s name, attendance, requirements and venue must be kept';
  end if;
  if not exists (select 1 from public.venue_bookings where booking_id = 98101 and status = 'confirmed'
      and starts_at = '2031-05-01 09:00+00' and ends_at = '2031-05-01 17:00+00') then
    raise exception '[SG2-81:booking-unchanged] [SG2-81:AC3] [NORMAL] The affected booking must stay confirmed with its original times';
  end if;
end $$;

-- A venue disruption and separate planning rechecks must coexist. Roll back
-- these flags so the original replacement journey below tests its own rule.
savepoint combined_readiness;
update public.events set arrangements_recheck_needed=true,
  outstanding_arrangements='["equipment_recheck","registration_recheck"]'::jsonb where event_id=98101;
do $$
declare result jsonb; audits bigint; notices bigint;
begin
  select count(*) into audits from public.event_audit_logs where event_id=98101;
  select count(*) into notices from public.notifications where event_id=98101;
  result := public.confirm_event(98101);
  if result is distinct from '{"outcome":"outstanding","outstanding":["venue","equipment","registration"]}'::jsonb then
    raise exception '[SG2-39:disruptions-and-rechecks-combined] [SG2-39:AC2] [SG2-81:AC2] [SG2-58:AC2] [CONFLICT] A disrupted venue and independent equipment/registration rechecks must all remain outstanding: %',result;
  end if;
  if (select count(*) from public.event_audit_logs where event_id=98101) <> audits
    or (select count(*) from public.notifications where event_id=98101) <> notices
    or not exists(select 1 from public.events where event_id=98101 and status='preparation'
      and arrangements_recheck_needed and outstanding_arrangements='["equipment_recheck","registration_recheck"]'::jsonb)
    or not exists(select 1 from public.venue_bookings where booking_id=98101 and status='confirmed') then
    raise exception '[SG2-39:combined-readiness-no-side-effects] [SG2-39:AC2] [SG2-81:AC2] [SG2-58:AC2] [FAILURE] Combined readiness refusal must preserve the flags, event, booking, audit and notifications';
  end if;
end $$;
rollback to savepoint combined_readiness;

-- AC4: a venue request can name the booking it replaces.
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    venue_requirements, replaces_booking_id) values
  (98103, 98101, 983, '2031-05-01 09:00+00', '2031-05-01 17:00+00', 'theatre', 'f8100000-0000-4000-8000-000000000002',
    'Projector and stage', 98101),
  (98104, 98101, 983, '2031-05-04 09:00+00', '2031-05-04 17:00+00', 'theatre', 'f8100000-0000-4000-8000-000000000002',
    'Projector and stage', 98101);
do $$
begin
  if (select replaces_booking_id from public.venue_booking_requests where request_id = 98103) is distinct from 98101 then
    raise exception '[SG2-81:request-names-replaced-booking] [SG2-81:AC4] [NORMAL] A replacement request must record the booking it replaces';
  end if;
end $$;

-- The event is back in Planning, where its replacement is requested and decided.
update public.events set status = 'planning' where event_id = 98101;

-- Venue Staff decide the replacement requests.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"f8100000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- AC5 (CONFLICT): a rejected replacement releases nothing; the flag stands.
do $$
declare
  result jsonb := public.decide_venue_booking_request(98104, 'reject', 'Not available');
begin
  if result->>'outcome' IS DISTINCT FROM 'updated' then
    raise exception '[SG2-81:reject-replacement] [SG2-81:AC5] [CONFLICT] A replacement request must be rejectable: %', result;
  end if;
  if not exists (select 1 from public.venue_bookings where booking_id = 98101 and status = 'confirmed')
    or not exists (select 1 from public.venue_booking_disruptions where booking_id = 98101) then
    raise exception '[SG2-81:rejected-replacement-releases-nothing] [SG2-81:AC5] [CONFLICT] A rejected replacement must leave the affected booking and its flag in place';
  end if;
end $$;

-- AC5: approving the replacement books the new venue and releases the old.
do $$
declare
  result jsonb := public.decide_venue_booking_request(98103, 'approve', null);
begin
  if result->>'outcome' IS DISTINCT FROM 'updated' or result->>'status' IS DISTINCT FROM 'approved' then
    raise exception '[SG2-81:approve-replacement] [SG2-81:AC5] [NORMAL] An event back in Planning must be able to have a replacement approved: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.venue_bookings where venue_id = 983 and event_id = 98101 and status = 'confirmed'
      and starts_at = '2031-05-01 09:00+00' and ends_at = '2031-05-01 17:00+00') then
    raise exception '[SG2-81:replacement-booked] [SG2-81:AC5] [NORMAL] The replacement venue must be booked for the same period';
  end if;
  if not exists (select 1 from public.venue_bookings where booking_id = 98101 and status = 'cancelled'
      and cancelled_by = 'f8100000-0000-4000-8000-000000000001' and cancellation_reason like 'Replaced by New Hall%') then
    raise exception '[SG2-81:affected-booking-released] [SG2-81:AC5] [NORMAL] The affected booking must be released with the replacement as the reason';
  end if;
  if exists (select 1 from public.venue_booking_disruptions where booking_id = 98101) then
    raise exception '[SG2-81:flag-cleared] [SG2-81:AC5] [NORMAL] A released booking must no longer be flagged';
  end if;
  if not exists (select 1 from public.venue_booking_requests where request_id = 98101 and status = 'cancelled') then
    raise exception '[SG2-81:old-request-cancelled] [SG2-81:AC5] [NORMAL] The replaced booking''s request must stop counting as a venue the event needs';
  end if;
  if (select venue_booking_id from public.events where event_id = 98101)
      is distinct from (select booking_id from public.venue_bookings where venue_id = 983 and event_id = 98101) then
    raise exception '[SG2-81:event-venue-moves] [SG2-81:AC5] [NORMAL] The event''s venue must move to the replacement booking';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 98101 and field_name = 'venue_booking'
      and new_value like 'Released: Old Hall%') then
    raise exception '[SG2-81:release-in-history] [SG2-81:AC5] [NORMAL] The release must appear in the event''s history';
  end if;
  if (select count(*) from public.notifications where kind = 'venue_booking_released' and event_id = 98101
      and recipient_id in ('f8100000-0000-4000-8000-000000000002', 'f8100000-0000-4000-8000-000000000003')) <> 2 then
    raise exception '[SG2-81:release-notified] [SG2-81:AC5] [NORMAL] The coordinator and organiser must be told of the release';
  end if;
  -- AC3 again: replacing the venue does not change the event's own details.
  if not exists (select 1 from public.events where event_id = 98101 and status = 'planning' and name = 'Summit Day'
      and expected_attendance = 80 and venue_requirements = 'Projector and stage') then
    raise exception '[SG2-81:event-details-kept-after-replacement] [SG2-81:AC3] [NORMAL] The event''s details must be unchanged after the replacement';
  end if;
  -- The other event's booking in the same venue is untouched.
  if not exists (select 1 from public.venue_bookings where booking_id = 98102 and status = 'confirmed')
    or not exists (select 1 from public.venue_booking_requests where request_id = 98102 and status = 'approved') then
    raise exception '[SG2-81:other-events-untouched] [SG2-81:AC3] [CONFLICT] Another event''s booking in the same venue must not be released';
  end if;
end $$;

-- AC2/AC5: with nothing affected left, the event is ready to confirm again.
-- (The event is advanced to Preparation again, and the rejected replacement is withdrawn first: SG2-82 keeps a rejected
-- request outstanding until the coordinator withdraws it.)
update public.events set status = 'awaiting_safety_check' where event_id = 98101;
insert into public.event_safety_decisions (event_id, decision, decided_by) values (98101, 'approve', 'f8100000-0000-4000-8000-000000000001');
update public.events set status = 'preparation' where event_id = 98101;
update public.venue_booking_requests set status = 'cancelled', withdrawn_by = 'f8100000-0000-4000-8000-000000000002',
  withdrawn_at = now() where request_id = 98104;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"f8100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if public.confirm_event(98101)->>'outcome' IS DISTINCT FROM 'ok' then
    raise exception '[SG2-81:no-longer-outstanding] [SG2-81:AC5] [NORMAL] Once the replacement is approved the event must no longer show alternative arrangements as required';
  end if;
end $$;
reset role;

-- AC4/AC5 (FAILURE): a replacement that names another event's booking, and a
-- decision for an event that is not in preparation without a replacement,
-- release nothing and are not approved.
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (98104, 'f8100000-0000-4000-8000-000000000003', 'f8100000-0000-4000-8000-000000000004', 'Late Event', 'preparation');
-- SG2-83: the database now refuses a replacement naming another event's
-- booking outright, so there is nothing to approve or release.
do $$
begin
  begin
    insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
        venue_requirements, replaces_booking_id) values
      (98105, 98104, 983, '2031-06-01 09:00+00', '2031-06-01 17:00+00', 'theatre', 'f8100000-0000-4000-8000-000000000004',
        null, 98102);
    raise exception '[SG2-81:foreign-replacement-refused] [SG2-81:AC4] [SG2-83:AC1] [FAILURE] A replacement naming another event''s booking was accepted';
  exception when check_violation then null;
  end;
end $$;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    venue_requirements, replaces_booking_id) values
  (98106, 98104, 983, '2031-06-02 09:00+00', '2031-06-02 17:00+00', 'theatre', 'f8100000-0000-4000-8000-000000000004',
    null, null);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"f8100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.venue_bookings where booking_id = 98102 and status = 'confirmed') then
    raise exception '[SG2-81:foreign-booking-not-released] [SG2-81:AC4] [FAILURE] A replacement naming another event''s booking must not release it';
  end if;
  result := public.decide_venue_booking_request(98106, 'approve', null);
  if result->>'outcome' IS DISTINCT FROM 'closed' then
    raise exception '[SG2-81:ordinary-request-closed-in-preparation] [SG2-81:AC4] [FAILURE] Only a replacement may be approved for an event in preparation: %', result;
  end if;
end $$;
reset role;

-- Roles: a coordinator and an anonymous caller cannot decide, so cannot
-- trigger a release through a replacement.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"f8100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.decide_venue_booking_request(98106, 'approve', null);
    raise exception '[SG2-81:coordinator-cannot-decide] [SG2-81:AC5] [FAILURE] A coordinator approved a venue request';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.decide_venue_booking_request(98106, 'approve', null);
    raise exception '[SG2-81:anonymous-cannot-decide] [SG2-81:AC5] [FAILURE] An anonymous caller approved a venue request';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Replacing a booking converted from a hold must retire its original
-- request through the same release helper as an ordinary approved booking.
insert into public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance,registration_needed) values
 (98106,'f8100000-0000-4000-8000-000000000003','f8100000-0000-4000-8000-000000000002','Converted hold replacement','planning',10,false);
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f8100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare placed jsonb; converted jsonb;
begin
 placed := public.create_venue_hold(98106,982,'2031-08-01T09:00Z','2031-08-01T17:00Z',clock_timestamp()+interval '2 days');
 converted := public.change_venue_hold((placed#>>'{hold,hold_id}')::bigint,'convert');
 if converted->>'outcome' is distinct from 'updated' then
  raise exception '[SG2-81:converted-hold-replacement-fixture] [SG2-81:AC5] [SG2-84:AC5] [NORMAL] The held original venue must convert before replacement: %',converted;
 end if;
 perform set_config('hold_replacement.booking',converted#>>'{hold,booking_id}',true);
 perform set_config('hold_replacement.request',converted#>>'{hold,request_id}',true);
 insert into public.venue_unavailability(venue_id,starts_at,ends_at,category,reason)
  values(982,'2031-08-01T09:00Z','2031-08-01T17:00Z','maintenance','Held venue replacement regression');
end $$;
reset role;
insert into public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,layout,requested_by,replaces_booking_id)
 values(98107,98106,983,'2031-08-01T09:00Z','2031-08-01T17:00Z','theatre',
  'f8100000-0000-4000-8000-000000000002',current_setting('hold_replacement.booking')::bigint);
set local role authenticated;
do $$
begin
 if public.decide_venue_booking_request(98107,'approve',null)->>'outcome' is distinct from 'updated' then
  raise exception '[SG2-81:converted-hold-replacement-approved] [SG2-81:AC5] [NORMAL] A replacement for the converted hold booking must approve through normal Venue Staff decision';
 end if;
end $$;
reset role;
do $$
begin
 if not exists(select 1 from public.venue_booking_requests r join public.venue_bookings b on b.booking_id=r.venue_booking_id
      where r.request_id=current_setting('hold_replacement.request')::bigint and r.status='cancelled' and b.status='cancelled')
    or not exists(select 1 from public.venue_booking_requests r join public.venue_bookings b on b.booking_id=r.venue_booking_id
      where r.request_id=98107 and r.status='approved' and b.status='confirmed')
    or (select status from public.venue_bookings where booking_id=98102) is distinct from 'confirmed' then
  raise exception '[SG2-81:replacement-retires-converted-hold-request] [SG2-81:AC3] [SG2-81:AC5] [CONFLICT] Replacement must cancel the old held request/booking, preserve the new booking and leave other events untouched';
 end if;
end $$;
update public.events set status='awaiting_safety_check' where event_id=98106;
insert into public.event_safety_decisions(event_id,decision,decided_by) values (98106,'approve','f8100000-0000-4000-8000-000000000001');
update public.events set status='preparation' where event_id=98106;
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"f8100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
begin
 if public.confirm_event(98106)->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-81:replaced-held-venue-no-phantom-demand] [SG2-81:AC5] [SG2-58:AC1] [NORMAL] A released held venue request must not block confirmation after its replacement is approved';
 end if;
end $$;
reset role;
rollback;
