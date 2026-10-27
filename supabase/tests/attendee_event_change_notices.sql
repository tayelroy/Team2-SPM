-- Review trace: SG2-102 notify registered attendees when their event changes.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-102: the deferred event_changed check (202610270002). The suite is one
-- transaction that is rolled back, so it never commits: :announce fires the
-- deferred triggers at the point a commit would.
-- Disposable local/CI test script. All changes are rolled back.
begin;

\set announce 'set constraints public.event_attendee_details_changed, public.venue_booking_attendee_details_changed immediate; set constraints public.event_attendee_details_changed, public.venue_booking_attendee_details_changed deferred;'

-- Seed test identities:
-- 1: organiser O (owns every event)    2: coordinator C (assigned to every event)
-- 3: venue staff V                      4-6: attendees A, B, W (W withdrew)
insert into auth.users (id)
  select ('e1020000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 6) n;
insert into public.users (user_id, name, role_id, organisation) values
  ('e1020000-0000-4000-8000-000000000001', 'Ec organiser', 1, 'Ec org'),
  ('e1020000-0000-4000-8000-000000000002', 'Ec coordinator', 2, null),
  ('e1020000-0000-4000-8000-000000000003', 'Ec venue staff', 3, null),
  ('e1020000-0000-4000-8000-000000000004', 'Ec attendee A', 5, null),
  ('e1020000-0000-4000-8000-000000000005', 'Ec attendee B', 5, null),
  ('e1020000-0000-4000-8000-000000000006', 'Ec attendee W', 5, null);
insert into public.account_roles (user_id, role) values
  ('e1020000-0000-4000-8000-000000000001', 'event_organiser'),
  ('e1020000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('e1020000-0000-4000-8000-000000000003', 'venue_staff'),
  ('e1020000-0000-4000-8000-000000000004', 'attendee'),
  ('e1020000-0000-4000-8000-000000000005', 'attendee'),
  ('e1020000-0000-4000-8000-000000000006', 'attendee');
insert into public.venues (venue_id, name, location, capacity) values
  (91021, 'Ec Hall', 'Level 1', 200), (91022, 'Ec Annex', 'Level 2', 200), (91023, 'Ec Loft', 'Level 3', 200);

-- 91021 Spring Forum: confirmed, 01 Jun 2031 18:00 SGT at Ec Hall; A and B
--   registered, W withdrew. Its date changes through SG2-66.
-- 91022 Summer Forum: confirmed at Ec Hall; A registered. Its venue is
--   replaced through SG2-81.
-- 91023 Autumn Forum: confirmed at Ec Hall and Ec Annex; B registered. Used
--   for internal changes, a cancelled venue and same-transaction changes.
-- 91024 Winter Forum: confirmed at Ec Hall; A registered. It is cancelled.
-- 91025 Quiet Forum: confirmed at Ec Hall; nobody registered.
insert into public.events (event_id, organiser_id, coordinator_id, organisation, name, status, proposed_date,
    expected_attendance, venue_requirements, confirmed_by, confirmed_at) values
  (91021, 'e1020000-0000-4000-8000-000000000001', 'e1020000-0000-4000-8000-000000000002', 'Ec org', 'Spring Forum',
    'confirmed', '2031-06-01 10:00+00', 100, 'Stage', 'e1020000-0000-4000-8000-000000000002', now()),
  (91022, 'e1020000-0000-4000-8000-000000000001', 'e1020000-0000-4000-8000-000000000002', 'Ec org', 'Summer Forum',
    'confirmed', '2031-07-01 10:00+00', 100, 'Stage', 'e1020000-0000-4000-8000-000000000002', now()),
  (91023, 'e1020000-0000-4000-8000-000000000001', 'e1020000-0000-4000-8000-000000000002', 'Ec org', 'Autumn Forum',
    'confirmed', '2031-09-01 10:00+00', 100, 'Stage', 'e1020000-0000-4000-8000-000000000002', now()),
  (91024, 'e1020000-0000-4000-8000-000000000001', 'e1020000-0000-4000-8000-000000000002', 'Ec org', 'Winter Forum',
    'confirmed', '2031-12-01 10:00+00', 100, 'Stage', 'e1020000-0000-4000-8000-000000000002', now()),
  (91025, 'e1020000-0000-4000-8000-000000000001', 'e1020000-0000-4000-8000-000000000002', 'Ec org', 'Quiet Forum',
    'confirmed', '2031-10-01 10:00+00', 100, 'Stage', 'e1020000-0000-4000-8000-000000000002', now());
-- SG2-94: a Confirmed event holds the Safety Officer's approval.
insert into public.event_safety_decisions (event_id, decision, decided_by)
  select event_id, 'approve', 'e1020000-0000-4000-8000-000000000003' from generate_series(91021, 91025) event_id;
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (91021, 91021, 91021, '2031-06-01 09:00+00', '2031-06-01 17:00+00', 'confirmed'),
  (91022, 91021, 91022, '2031-07-01 09:00+00', '2031-07-01 17:00+00', 'confirmed'),
  (91023, 91021, 91023, '2031-09-01 09:00+00', '2031-09-01 17:00+00', 'confirmed'),
  (91024, 91022, 91023, '2031-09-01 09:00+00', '2031-09-01 17:00+00', 'confirmed'),
  (91025, 91021, 91024, '2031-12-01 09:00+00', '2031-12-01 17:00+00', 'confirmed'),
  (91026, 91021, 91025, '2031-10-01 09:00+00', '2031-10-01 17:00+00', 'confirmed');
update public.events set venue_booking_id = event_id where event_id between 91021 and 91022;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    status, decided_by, decided_at, venue_booking_id) values
  (91022, 91022, 91021, '2031-07-01 09:00+00', '2031-07-01 17:00+00', 'theatre', 'e1020000-0000-4000-8000-000000000002',
    'approved', 'e1020000-0000-4000-8000-000000000003', now(), 91022);
insert into public.registrations (event_id, attendee_id, status, registered_at, withdrawn_at) values
  (91021, 'e1020000-0000-4000-8000-000000000004', 'registered', now(), null),
  (91021, 'e1020000-0000-4000-8000-000000000005', 'registered', now(), null),
  (91021, 'e1020000-0000-4000-8000-000000000006', 'cancelled', now(), now()),
  (91022, 'e1020000-0000-4000-8000-000000000004', 'registered', now(), null),
  (91023, 'e1020000-0000-4000-8000-000000000005', 'registered', now(), null),
  (91024, 'e1020000-0000-4000-8000-000000000004', 'registered', now(), null);

-- 0. Both checks wait for commit, so one transaction is one announcement
-- (:announce below sets them back to deferred, which this pins as the default):
do $$
begin
  if (select count(*) from pg_trigger
      where tgname in ('event_attendee_details_changed', 'venue_booking_attendee_details_changed')
        and tgdeferrable and tginitdeferred) <> 2 then
    raise exception '[SG2-102:checked-at-commit] [SG2-102:AC1] [CONFLICT] Both attendee detail checks must be deferred to commit';
  end if;
end $$;

-- The new events are recorded as their attendees first see them.
:announce

-- 1. Recording a new event's details sends nobody anything:
do $$
begin
  if exists (select 1 from public.notifications where kind = 'event_changed' and event_id between 91021 and 91025)
      or (select count(*) from private.event_attendee_details where event_id between 91021 and 91025) <> 5
      or not exists (select 1 from private.event_attendee_details where event_id = 91023
        and proposed_date = '2031-09-01 10:00+00' and venue_ids = array[91021, 91022]
        and venue_names = 'Ec Annex, Ec Hall') then
    raise exception '[SG2-102:first-record-silent] [SG2-102:AC1] [BOUNDARY] A new event''s first details must be recorded without a notice';
  end if;
end $$;

-- 2. An accepted change request that moves the date tells every attendee with
-- an active registration, once, with the old and new value (AC1/AC2), and
-- not the one who withdrew (AC3):
do $$
declare
  result jsonb;
begin
  result := public.apply_accepted_event_change(91021, 'e1020000-0000-4000-8000-000000000002', 'confirmed',
    'change request 1', '{"proposed_date": "2031-06-02T10:00:00+00:00"}'::jsonb, '[]'::jsonb);
  if result ->> 'outcome' <> 'ok' then
    raise exception '[SG2-102:date-change-applied] [SG2-102:AC1] [NORMAL] SG2-66 must apply the accepted date change, got %', result;
  end if;
end $$;
:announce
do $$
begin
  if (select count(*) from public.notifications where kind = 'event_changed' and event_id = 91021) <> 2
      or (select count(*) from public.notifications where kind = 'event_changed' and event_id = 91021
        and recipient_id in ('e1020000-0000-4000-8000-000000000004', 'e1020000-0000-4000-8000-000000000005')
        and message = 'Spring Forum has changed. Date and time: 01 Jun 2031 18:00 SGT → 02 Jun 2031 18:00 SGT.'
          || ' Open My registrations for the latest details.') <> 2 then
    raise exception '[SG2-102:date-change-notifies] [SG2-102:AC1] [SG2-102:AC2] [NORMAL] Both active registrations must get one notice with the old and new date and time, got %',
      (select jsonb_agg(jsonb_build_object('to', recipient_id, 'message', message)) from public.notifications
        where kind = 'event_changed' and event_id = 91021);
  end if;
  if exists (select 1 from public.notifications where kind = 'event_changed'
      and recipient_id = 'e1020000-0000-4000-8000-000000000006') then
    raise exception '[SG2-102:withdrawn-not-notified] [SG2-102:AC3] [NORMAL] An attendee who withdrew must not be notified';
  end if;
  if exists (select 1 from public.notifications where kind = 'event_changed'
      and recipient_id in ('e1020000-0000-4000-8000-000000000001', 'e1020000-0000-4000-8000-000000000002')) then
    raise exception '[SG2-102:staff-not-notified] [SG2-102:AC1] [NORMAL] Only attendees get event_changed notices';
  end if;
end $$;

-- 3. Announcing again with nothing new sends nothing more:
:announce
do $$
begin
  if (select count(*) from public.notifications where kind = 'event_changed' and event_id = 91021) <> 2 then
    raise exception '[SG2-102:announced-once] [SG2-102:AC1] [BOUNDARY] A change must be announced once';
  end if;
end $$;

-- 4. The attendee's own view shows the new date (AC4):
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1020000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"e1020000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
declare
  mine jsonb := public.my_registrations();
begin
  if not exists (select 1 from jsonb_array_elements(mine) r where (r ->> 'event_id')::integer = 91021
      and (r -> 'event' ->> 'proposed_date')::timestamptz = '2031-06-02 10:00+00') then
    raise exception '[SG2-102:attendee-view-updated] [SG2-102:AC4] [NORMAL] My registrations must show the changed date, got %', mine;
  end if;
end $$;

-- 5. The record is out of every client's reach:
do $$
begin
  perform 1 from private.event_attendee_details;
  raise exception '[SG2-102:record-private] [SG2-102:AC1] [FAILURE] An authenticated caller must not read the attendee details record';
exception when insufficient_privilege then
  null;
end $$;
reset role;

-- 6. A replacement venue after the original became unavailable (SG2-81): the
-- new booking and the release of the old one are one change, so one notice
-- (AC1/AC2):
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    venue_requirements, replaces_booking_id) values
  (91023, 91022, 91023, '2031-07-01 09:00+00', '2031-07-01 17:00+00', 'theatre', 'e1020000-0000-4000-8000-000000000002',
    'Stage', 91022);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1020000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"e1020000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
declare
  result jsonb := public.decide_venue_booking_request(91023, 'approve', null);
begin
  if result ->> 'outcome' <> 'updated' then
    raise exception '[SG2-102:replacement-approved] [SG2-102:AC1] [NORMAL] The replacement must be approved, got %', result;
  end if;
end $$;
reset role;
:announce
do $$
begin
  if (select count(*) from public.notifications where kind = 'event_changed' and event_id = 91022) <> 1
      or not exists (select 1 from public.notifications where kind = 'event_changed' and event_id = 91022
        and recipient_id = 'e1020000-0000-4000-8000-000000000004'
        and message = 'Summer Forum has changed. Venue: Ec Hall → Ec Loft. Open My registrations for the latest details.') then
    raise exception '[SG2-102:replacement-notifies-once] [SG2-102:AC1] [SG2-102:AC2] [NORMAL] A replacement must send one notice naming the old and new venue, got %',
      (select jsonb_agg(message) from public.notifications where kind = 'event_changed' and event_id = 91022);
  end if;
end $$;

-- 7. Internal planning changes notify nobody (AC5): attendance and
-- requirements through SG2-66, a held booking, and a confirmed booking's
-- times at a venue the event already has:
do $$
declare
  result jsonb;
begin
  result := public.apply_accepted_event_change(91023, 'e1020000-0000-4000-8000-000000000002', 'confirmed',
    'change request 2', '{"expected_attendance": 150, "venue_requirements": "Stage and lights"}'::jsonb, '[]'::jsonb);
  if result ->> 'outcome' <> 'ok' then
    raise exception '[SG2-102:internal-change-applied] [SG2-102:AC5] [BOUNDARY] SG2-66 must apply the internal change, got %', result;
  end if;
end $$;
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (91027, 91023, 91023, '2031-09-02 09:00+00', '2031-09-02 17:00+00', 'held');
update public.venue_bookings set ends_at = '2031-09-01 18:00+00' where booking_id = 91023;
:announce
do $$
begin
  if exists (select 1 from public.notifications where kind = 'event_changed' and event_id = 91023) then
    raise exception '[SG2-102:internal-change-silent] [SG2-102:AC5] [BOUNDARY] Changes attendees do not see must not notify them';
  end if;
end $$;

-- 8. A date moved and moved back in one transaction is no change; a date and
-- a venue changed together are one notice with both (AC2):
update public.events set proposed_date = '2031-09-05 10:00+00' where event_id = 91023;
update public.events set proposed_date = '2031-09-01 10:00+00' where event_id = 91023;
:announce
do $$
begin
  if exists (select 1 from public.notifications where kind = 'event_changed' and event_id = 91023) then
    raise exception '[SG2-102:net-change-only] [SG2-102:AC1] [CONFLICT] A date moved back within the transaction must not notify';
  end if;
end $$;
update public.events set proposed_date = '2031-09-08 10:00+00' where event_id = 91023;
update public.venue_bookings set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Annex no longer needed.'
  where booking_id = 91024;
:announce
do $$
begin
  if (select count(*) from public.notifications where kind = 'event_changed' and event_id = 91023) <> 1
      or not exists (select 1 from public.notifications where kind = 'event_changed' and event_id = 91023
        and recipient_id = 'e1020000-0000-4000-8000-000000000005'
        and message = 'Autumn Forum has changed. Date and time: 01 Sep 2031 18:00 SGT → 08 Sep 2031 18:00 SGT.'
          || ' Venue: Ec Annex, Ec Hall → Ec Hall. Open My registrations for the latest details.') then
    raise exception '[SG2-102:combined-change] [SG2-102:AC1] [SG2-102:AC2] [CONFLICT] A date and a cancelled venue in one transaction must be one notice with both, got %',
      (select jsonb_agg(message) from public.notifications where kind = 'event_changed' and event_id = 91023);
  end if;
end $$;

-- 9. A change that is rolled back notifies nobody and leaves the record:
savepoint rolled_back_change;
update public.events set proposed_date = '2031-10-09 10:00+00' where event_id = 91025;
update public.registrations set status = 'registered', withdrawn_at = null where event_id = 91021 and status = 'cancelled';
rollback to savepoint rolled_back_change;
:announce
do $$
begin
  if exists (select 1 from public.notifications where kind = 'event_changed' and event_id = 91025)
      or not exists (select 1 from private.event_attendee_details where event_id = 91025
        and proposed_date = '2031-10-01 10:00+00') then
    raise exception '[SG2-102:rolled-back-silent] [SG2-102:AC1] [FAILURE] A rolled-back change must not notify or move the record';
  end if;
end $$;

-- 10. An event nobody registered for records the change and sends nothing:
update public.events set proposed_date = '2031-10-02 10:00+00' where event_id = 91025;
:announce
do $$
begin
  if exists (select 1 from public.notifications where kind = 'event_changed' and event_id = 91025)
      or not exists (select 1 from private.event_attendee_details where event_id = 91025
        and proposed_date = '2031-10-02 10:00+00') then
    raise exception '[SG2-102:no-registrations] [SG2-102:AC1] [BOUNDARY] A change with no registrations must be recorded without a notice';
  end if;
end $$;

-- 11. A cancelled event's released venues are SG2-67's event_cancelled
-- notice, not an event_changed one:
update public.events set status = 'cancelled', cancellation_requested_at = now(),
    cancellation_reason = 'Speaker unavailable.', cancelled_at = now()
  where event_id = 91024;
update public.venue_bookings set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Event cancelled.'
  where booking_id = 91025;
:announce
do $$
begin
  if exists (select 1 from public.notifications where kind = 'event_changed' and event_id = 91024)
      or not exists (select 1 from private.event_attendee_details where event_id = 91024 and venue_ids = '{}') then
    raise exception '[SG2-102:cancelled-event-silent] [SG2-102:AC1] [FAILURE] A cancelled event must not send event_changed notices';
  end if;
end $$;

-- 12. The kind is allowed alongside every earlier one:
do $$
declare
  definition text := (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_kind_check');
begin
  if position('''event_changed''' in definition) = 0 or position('''change_refused''' in definition) = 0
      or position('''registration_withdrawn''' in definition) = 0 then
    raise exception '[SG2-102:kind-added] [SG2-102:AC1] [NORMAL] event_changed must be added without losing other kinds: %', definition;
  end if;
end $$;

rollback;
