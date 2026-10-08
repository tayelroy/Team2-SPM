-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- Run after the migrations in a disposable/development database as postgres.
-- Test records are rolled back. Never run against production.
--
-- Covers SG2-80 (Week 7 customer change #2): Venue Staff mark a venue
-- unavailable with a reason and a note even over confirmed bookings; the
-- bookings inside the period are flagged, not cancelled; the recorder and
-- time are stamped from the session; only internal roles read the flags and
-- only Venue Staff list the periods with their affected events.
begin;

insert into auth.users (id) values
  ('f8000000-0000-4000-8000-000000000001'),  -- venue_staff
  ('f8000000-0000-4000-8000-000000000002'),  -- event_coordinator
  ('f8000000-0000-4000-8000-000000000003'),  -- event_organiser
  ('f8000000-0000-4000-8000-000000000004');  -- attendee
insert into public.users (user_id, name, role_id) values
  ('f8000000-0000-4000-8000-000000000001', 'Vera Staff', 3),
  ('f8000000-0000-4000-8000-000000000002', 'Colin Coordinator', 2),
  ('f8000000-0000-4000-8000-000000000003', 'Olive Organiser', 1),
  ('f8000000-0000-4000-8000-000000000004', 'Ada Attendee', 5);
insert into public.account_roles (user_id, role) values
  ('f8000000-0000-4000-8000-000000000001', 'venue_staff'),
  ('f8000000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('f8000000-0000-4000-8000-000000000003', 'event_organiser'),
  ('f8000000-0000-4000-8000-000000000004', 'attendee');

insert into public.venues (venue_id, name) values (980, 'Disruption Hall'), (981, 'Other Hall');
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (98001, 'f8000000-0000-4000-8000-000000000003', 'f8000000-0000-4000-8000-000000000002', 'Gala Night', 'confirmed'),
  (98002, 'f8000000-0000-4000-8000-000000000003', 'f8000000-0000-4000-8000-000000000002', 'Partner Lunch', 'confirmed'),
  (98003, 'f8000000-0000-4000-8000-000000000003', 'f8000000-0000-4000-8000-000000000002', 'Pencilled Talk', 'planning');
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (98001, 980, 98001, '2031-03-01 09:00+00', '2031-03-01 17:00+00', 'confirmed'),
  (98002, 980, 98002, '2031-03-02 09:00+00', '2031-03-02 12:00+00', 'confirmed'),
  (98003, 980, 98003, '2031-03-01 18:00+00', '2031-03-01 20:00+00', 'held'),
  (98004, 981, null,  '2031-03-01 09:00+00', '2031-03-01 17:00+00', 'confirmed'),
  (98005, 980, null,  '2031-03-05 09:00+00', '2031-03-05 12:00+00', 'confirmed');

-- Venue Staff mark the venue unavailable over two confirmed bookings.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"f8000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  period bigint;
begin
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, category, reason, created_by, created_at)
    values (980, '2031-03-01 00:00+00', '2031-03-03 00:00+00', 'equipment_failure', 'Air conditioning failed',
      'f8000000-0000-4000-8000-000000000002', '2000-01-01 00:00+00')
    returning unavailability_id into period;
  perform set_config('sg2_80.period', period::text, true);
  if not exists (select 1 from public.venue_unavailability where unavailability_id = period
      and category = 'equipment_failure' and reason = 'Air conditioning failed') then
    raise exception '[SG2-80:record-reason-and-note] [SG2-80:AC1] [NORMAL] The chosen reason and the note must both be recorded';
  end if;
  if not exists (select 1 from public.venue_unavailability where unavailability_id = period
      and starts_at = '2031-03-01 00:00+00' and ends_at = '2031-03-03 00:00+00') then
    raise exception '[SG2-80:mark-over-confirmed-bookings] [SG2-80:AC2] [NORMAL] Marking must be allowed when confirmed bookings fall in the period';
  end if;
  if (select created_by from public.venue_unavailability where unavailability_id = period) is distinct from 'f8000000-0000-4000-8000-000000000001'::uuid then
    raise exception '[SG2-80:recorder-from-session] [SG2-80:AC6] [CONFLICT] The recorder must be the signed-in caller, not a value they supply';
  end if;
  if (select created_at from public.venue_unavailability where unavailability_id = period) < now() then
    raise exception '[SG2-80:recorded-at-from-clock] [SG2-80:AC6] [CONFLICT] The recording time must come from the database clock, not the caller';
  end if;
  if (select array_agg(booking_id order by booking_id) from public.venue_booking_disruptions where unavailability_id = period)
      is distinct from array[98001, 98002]::bigint[] then
    raise exception '[SG2-80:flag-confirmed-bookings] [SG2-80:AC3] [NORMAL] Exactly the confirmed bookings within the period must be flagged';
  end if;
  if exists (select 1 from public.venue_booking_disruptions where booking_id in (98003, 98004, 98005)) then
    raise exception '[SG2-80:held-outside-and-other-venue-not-flagged] [SG2-80:AC3] [BOUNDARY] A held booking, one outside the period or one at another venue must not be flagged';
  end if;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, category, reason)
      values (980, '2031-04-01 00:00+00', '2031-04-02 00:00+00', 'flood', 'Not a listed reason');
    raise exception '[SG2-80:unlisted-reason] [SG2-80:AC1] [FAILURE] A reason outside the fixed list must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_booking_disruptions (unavailability_id, booking_id) values (period, 98004);
    raise exception '[SG2-80:staff-cannot-write-flags] [SG2-80:AC3] [FAILURE] Venue Staff wrote a flag directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- AC4: the affected events and bookings are untouched.
reset role;
do $$
begin
  if (select array_agg(status::text order by event_id) from public.events where event_id in (98001, 98002))
      is distinct from array['confirmed', 'confirmed']
    or (select array_agg(name::text order by event_id) from public.events where event_id in (98001, 98002))
      is distinct from array['Gala Night', 'Partner Lunch'] then
    raise exception '[SG2-80:events-not-cancelled] [SG2-80:AC4] [NORMAL] Affected events must keep their status and details';
  end if;
  if (select count(*) from public.venue_bookings where booking_id in (98001, 98002) and status = 'confirmed'
      and starts_at in ('2031-03-01 09:00+00', '2031-03-02 09:00+00')) <> 2 then
    raise exception '[SG2-80:bookings-kept] [SG2-80:AC4] [NORMAL] Affected bookings must stay confirmed with their original times';
  end if;
end $$;

-- AC3 edges: touching periods are not flagged; a one-microsecond overlap is.
set local role authenticated;
do $$
declare
  touching bigint;
  overlap bigint;
begin
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, category, reason)
    values (981, '2031-03-01 17:00+00', '2031-03-01 18:00+00', 'maintenance', 'Right after the booking')
    returning unavailability_id into touching;
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, category, reason)
    values (981, '2031-03-01 16:59:59.999999+00', '2031-03-01 17:30+00', 'renovation', 'One microsecond')
    returning unavailability_id into overlap;
  if exists (select 1 from public.venue_booking_disruptions where unavailability_id = touching) then
    raise exception '[SG2-80:touching-not-flagged] [SG2-80:AC3] [BOUNDARY] A period starting as a booking ends must not flag it';
  end if;
  if not exists (select 1 from public.venue_booking_disruptions where unavailability_id = overlap and booking_id = 98004) then
    raise exception '[SG2-80:one-microsecond-flagged] [SG2-80:AC3] [BOUNDARY] A one-microsecond overlap must flag the booking';
  end if;
  perform set_config('sg2_80.touching', touching::text, true);
end $$;

-- AC1/AC3/AC6: Venue Staff list each period with its reason, note, recorder,
-- time and affected events.
do $$
declare
  listed jsonb := public.list_venue_unavailability(980, '2031-01-01 00:00+00');
  item jsonb := listed->0;
begin
  if jsonb_array_length(listed) <> 1
    or item->>'category' <> 'equipment_failure' or item->>'reason' <> 'Air conditioning failed'
    or item->>'created_by_name' <> 'Vera Staff' or item->>'created_at' is null then
    raise exception '[SG2-80:list-recorded-details] [SG2-80:AC6] [NORMAL] The listing must show the reason, note, recorder and time';
  end if;
  if jsonb_array_length(item->'affected') <> 2
    or item#>>'{affected,0,event_name}' <> 'Gala Night' or item#>>'{affected,0,event_status}' <> 'confirmed'
    or item#>>'{affected,1,booking_id}' <> '98002' then
    raise exception '[SG2-80:list-affected-events] [SG2-80:AC3] [NORMAL] The listing must identify each affected event, earliest first';
  end if;
  if jsonb_array_length(public.list_venue_unavailability(980, '2031-03-03 00:00+00')) <> 0
    or jsonb_array_length(public.list_venue_unavailability(980, '2031-03-02 23:59:59.999999+00')) <> 1 then
    raise exception '[SG2-80:list-ended-boundary] [SG2-80:AC1] [BOUNDARY] A period is listed until the instant it ends';
  end if;
end $$;

-- Other roles: the coordinator reads the flags but cannot list periods with
-- event details; external roles see no flags at all.
do $$
declare
  caller uuid;
  seen integer;
begin
  perform set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000002', true);
  select count(*) into seen from public.venue_affected_bookings where venue_id = 980;
  if seen <> 2 then
    raise exception '[SG2-80:coordinator-reads-flags] [SG2-80:AC3] [NORMAL] Coordinators must see the affected bookings to rearrange them';
  end if;
  begin
    perform public.list_venue_unavailability(980, '2031-01-01 00:00+00');
    raise exception '[SG2-80:coordinator-list-refused] [SG2-80:AC6] [FAILURE] Only Venue Staff may list periods with their recorders';
  exception when insufficient_privilege then null;
  end;
  foreach caller in array array['f8000000-0000-4000-8000-000000000003', 'f8000000-0000-4000-8000-000000000004']::uuid[] loop
    perform set_config('request.jwt.claim.sub', caller::text, true);
    select count(*) into seen from public.venue_booking_disruptions;
    if seen <> 0 or (select count(*) from public.venue_affected_bookings) <> 0 then
      raise exception '[SG2-80:external-roles-no-flags] [SG2-80:AC3] [FAILURE] Role of % read venue disruption flags', caller;
    end if;
  end loop;
end $$;
reset role;

set local role anon;
do $$
begin
  begin
    perform public.list_venue_unavailability(980, '2031-01-01 00:00+00');
    raise exception '[SG2-80:anonymous-list-refused] [SG2-80:AC6] [FAILURE] An anonymous caller listed venue unavailability';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.venue_booking_disruptions;
    raise exception '[SG2-80:anonymous-flags-refused] [SG2-80:AC3] [FAILURE] An anonymous caller read venue disruption flags';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- AC3 backstop: bookings confirmed, released or moved by any path, and
-- periods moved, keep the flags accurate; the recorder never changes.
do $$
declare
  period bigint := current_setting('sg2_80.period')::bigint;
begin
  update public.venue_bookings set status = 'confirmed' where booking_id = 98003;
  if not exists (select 1 from public.venue_booking_disruptions where booking_id = 98003 and unavailability_id = period) then
    raise exception '[SG2-80:later-confirmation-flagged] [SG2-80:AC3] [CONFLICT] A booking confirmed inside an existing period must be flagged';
  end if;
  update public.venue_bookings set starts_at = '2031-03-02 13:00+00', ends_at = '2031-03-02 15:00+00' where booking_id = 98005;
  if not exists (select 1 from public.venue_booking_disruptions where booking_id = 98005 and unavailability_id = period) then
    raise exception '[SG2-80:booking-moved-in-flagged] [SG2-80:AC3] [CONFLICT] A confirmed booking moved into the period must be flagged';
  end if;
  update public.venue_bookings set status = 'held' where booking_id = 98002;
  if exists (select 1 from public.venue_booking_disruptions where booking_id = 98002) then
    raise exception '[SG2-80:released-booking-unflagged] [SG2-80:AC3] [CONFLICT] A booking no longer confirmed must no longer be flagged';
  end if;
  update public.venue_unavailability
    set starts_at = '2031-03-02 00:00+00', created_by = 'f8000000-0000-4000-8000-000000000002', created_at = '2000-01-01 00:00+00'
    where unavailability_id = period;
  if exists (select 1 from public.venue_booking_disruptions where booking_id in (98001, 98003))
    or not exists (select 1 from public.venue_booking_disruptions where booking_id = 98005) then
    raise exception '[SG2-80:period-moved-reflagged] [SG2-80:AC3] [CONFLICT] Moving a period must re-evaluate which bookings it affects';
  end if;
  if (select created_by from public.venue_unavailability where unavailability_id = period) is distinct from 'f8000000-0000-4000-8000-000000000001'::uuid
    or (select created_at from public.venue_unavailability where unavailability_id = period) < now() then
    raise exception '[SG2-80:record-immutable] [SG2-80:AC6] [CONFLICT] Who recorded a period, and when, cannot be rewritten';
  end if;
  delete from public.venue_unavailability where unavailability_id = period;
  if exists (select 1 from public.venue_booking_disruptions where unavailability_id = period)
    or (select count(*) from public.venue_bookings where booking_id in (98001, 98005)) <> 2 then
    raise exception '[SG2-80:remove-period-unflags] [SG2-80:AC4] [NORMAL] Removing a period clears its flags and keeps the bookings';
  end if;
end $$;

-- Allowing a period over confirmed bookings does not relax SG2-50: two
-- confirmed bookings still cannot overlap.
do $$
begin
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (981, '2031-03-01 08:00+00', '2031-03-01 18:30+00', 'confirmed');
    raise exception '[SG2-80:double-booking-still-refused] [SG2-80:AC2] [FAILURE] Allowing marks over bookings must not allow double bookings';
  exception when exclusion_violation then null;
  end;
end $$;

rollback;
