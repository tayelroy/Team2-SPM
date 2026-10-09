-- Review trace: SG2-78 setup and turnaround time in availability and conflict checks.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-78: approvals and holds keep setup and turnaround room around every
-- booking; stored booking times are the event's own.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users (id) values
  ('e7800000-0000-4000-8000-000000000001'), ('e7800000-0000-4000-8000-000000000002'),
  ('e7800000-0000-4000-8000-000000000003');
insert into public.users (user_id, name, role_id) values
  ('e7800000-0000-4000-8000-000000000001', 'Prep staff', 3),
  ('e7800000-0000-4000-8000-000000000002', 'Prep coordinator', 2),
  ('e7800000-0000-4000-8000-000000000003', 'Prep organiser', 1);
insert into public.account_roles (user_id, role) values
  ('e7800000-0000-4000-8000-000000000001', 'venue_staff'),
  ('e7800000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('e7800000-0000-4000-8000-000000000003', 'event_organiser');
-- Prep Hall needs 30 minutes to set up and 45 to turn around (SG2-77);
-- Plain Room has no times recorded, so 0 minutes each.
insert into public.venues (venue_id, name, capacity) values (97801, 'Prep Hall', 100), (97802, 'Plain Room', 100);
insert into public.venue_operations (venue_id, setup_minutes, turnaround_minutes) values (97801, 30, 45);
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (97801, 'e7800000-0000-4000-8000-000000000003', 'e7800000-0000-4000-8000-000000000002', 'Morning Talk', 'planning'),
  (97802, 'e7800000-0000-4000-8000-000000000003', 'e7800000-0000-4000-8000-000000000002', 'Afternoon Panel', 'approved'),
  (97803, 'e7800000-0000-4000-8000-000000000003', 'e7800000-0000-4000-8000-000000000002', 'Breakfast Briefing', 'approved'),
  (97804, 'e7800000-0000-4000-8000-000000000003', 'e7800000-0000-4000-8000-000000000002', 'Lunch Workshop', 'approved'),
  (97805, 'e7800000-0000-4000-8000-000000000003', 'e7800000-0000-4000-8000-000000000002', 'Early Meeting', 'approved');
-- Morning Talk holds Prep Hall 10:00-12:00, so its effective period is 09:30-12:45 (AC1).
insert into public.venue_bookings (venue_id, event_id, starts_at, ends_at, status) values
  (97801, 97801, '2030-09-10 10:00+00', '2030-09-10 12:00+00', 'confirmed'),
  (97801, 97801, '2030-09-11 10:00+00', '2030-09-11 12:00+00', 'confirmed'),
  (97802, 97801, '2030-09-12 10:00+00', '2030-09-12 12:00+00', 'confirmed');
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by) values
  (97801, 97802, 97801, '2030-09-10 13:14+00', '2030-09-10 14:00+00', 'theatre', 'e7800000-0000-4000-8000-000000000002'),
  (97802, 97804, 97801, '2030-09-10 13:15+00', '2030-09-10 14:00+00', 'theatre', 'e7800000-0000-4000-8000-000000000002'),
  (97803, 97803, 97801, '2030-09-10 08:00+00', '2030-09-10 08:46+00', 'theatre', 'e7800000-0000-4000-8000-000000000002'),
  (97804, 97805, 97801, '2030-09-10 08:00+00', '2030-09-10 08:45+00', 'theatre', 'e7800000-0000-4000-8000-000000000002'),
  (97805, 97802, 97802, '2030-09-12 12:00+00', '2030-09-12 13:00+00', 'boardroom', 'e7800000-0000-4000-8000-000000000002');

-- 1. The gap a venue keeps between bookings:
do $$
begin
  if public.venue_preparation_gap(97801) <> interval '75 minutes' or public.venue_preparation_gap(97802) <> interval '0' then
    raise exception '[SG2-78:preparation-gap] [SG2-78:AC1] [NORMAL] A venue must keep setup plus turnaround between bookings, and 0 minutes when none are recorded';
  end if;
end $$;

-- 2. Approvals (SG2-49) compare effective periods:
select set_config('request.jwt.claim.sub', 'e7800000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb;
begin
  -- Morning Talk's turnaround runs to 12:45; this request's setup starts at 12:44.
  result := public.decide_venue_booking_request(97801, 'approve', null);
  if result->>'outcome' <> 'conflict' or result->>'label' <> 'Morning Talk'
      or (select status from public.venue_booking_requests where request_id = 97801) <> 'pending' then
    raise exception '[SG2-78:turnaround-overlap-refused] [SG2-78:AC2] [CONFLICT] A request whose setup overlaps a booking''s turnaround was not refused, naming it: %', result;
  end if;
  result := public.decide_venue_booking_request(97802, 'approve', null);
  if result->>'outcome' <> 'updated' then
    raise exception '[SG2-78:turnaround-adjacent-approved] [SG2-78:AC2] [BOUNDARY] A request whose setup starts as the turnaround ends must be approved: %', result;
  end if;
  -- Before the talk: this request's turnaround would end at 09:31, inside the talk's setup.
  result := public.decide_venue_booking_request(97803, 'approve', null);
  if result->>'outcome' <> 'conflict' then
    raise exception '[SG2-78:setup-overlap-refused] [SG2-78:AC2] [BOUNDARY] A request whose turnaround overlaps a booking''s setup by one minute was not refused: %', result;
  end if;
  result := public.decide_venue_booking_request(97804, 'approve', null);
  if result->>'outcome' <> 'updated' then
    raise exception '[SG2-78:setup-adjacent-approved] [SG2-78:AC2] [BOUNDARY] A request whose turnaround ends as the next setup starts must be approved: %', result;
  end if;
  -- A venue with no times recorded needs no gap at all.
  result := public.decide_venue_booking_request(97805, 'approve', null);
  if result->>'outcome' <> 'updated' then
    raise exception '[SG2-78:no-times-no-gap] [SG2-78:AC1] [NORMAL] Back-to-back bookings must be approved at a venue with no setup or turnaround time: %', result;
  end if;
  -- AC5: the booking keeps the event's own times, not the effective period.
  if not exists (select 1 from public.venue_bookings where event_id = 97804 and venue_id = 97801
      and starts_at = '2030-09-10 13:15+00' and ends_at = '2030-09-10 14:00+00') then
    raise exception '[SG2-78:advertised-times-kept] [SG2-78:AC5] [NORMAL] An approved booking must keep the event''s start and end times';
  end if;
end $$;

-- 3. Tentative holds (SG2-84) need the same room, both when placed and when converted:
do $$
declare result jsonb; hold bigint;
begin
  result := public.create_venue_hold(97803, 97801, '2030-09-11 12:30+00', '2030-09-11 13:00+00', now() + interval '2 days');
  if result->>'outcome' <> 'conflict' then
    raise exception '[SG2-78:hold-in-turnaround-refused] [SG2-78:AC2] [CONFLICT] A hold inside a booking''s turnaround was placed: %', result;
  end if;
  result := public.create_venue_hold(97803, 97801, '2030-09-11 15:00+00', '2030-09-11 16:00+00', now() + interval '2 days');
  if result->>'outcome' <> 'created' then
    raise exception '[SG2-78:hold-clear-of-turnaround] [SG2-78:AC2] [NORMAL] A hold clear of every effective period was refused: %', result;
  end if;
  hold := (result->'hold'->>'hold_id')::bigint;
  -- There is no constraint on effective periods: a booking written straight
  -- into another's turnaround is kept (SG2-79 flags it rather than refuse it).
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (97801, '2030-09-11 16:30+00', '2030-09-11 17:00+00', 'confirmed');
  result := public.change_venue_hold(hold, 'convert');
  if result->>'outcome' <> 'conflict'
      or (select status from public.venue_holds where hold_id = hold) <> 'tentative' then
    raise exception '[SG2-78:convert-into-setup-refused] [SG2-78:AC2] [CONFLICT] Converting a hold whose turnaround overlaps the next booking''s setup was not refused: %', result;
  end if;
end $$;

-- 4. Only the database's own functions read the gap:
set local role authenticated;
do $$
begin
  begin
    perform public.venue_preparation_gap(97801);
    raise exception '[SG2-78:gap-not-public] [SG2-78:AC1] [FAILURE] Clients called venue_preparation_gap directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
