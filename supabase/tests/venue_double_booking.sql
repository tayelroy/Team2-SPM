-- Review trace: SG2-50 prevent double-booking a venue.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-50: venue_bookings_no_double_booking keeps confirmed bookings apart, and
-- SG2-49's decide_venue_booking_request() refuses approval while one overlaps.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into public.venues (venue_id, name) values (95001, 'Double Booking Hall'), (95002, 'Second Hall');
-- Gala Night holds the hall 10:00-12:00.
insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
  values (95001, '2030-06-15 10:00+00', '2030-06-15 12:00+00', 'confirmed');

-- 1. Overlapping confirmed bookings are refused:
do $$
begin
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (95001, '2030-06-15 11:00+00', '2030-06-15 13:00+00', 'confirmed');
    raise exception '[SG2-50:overlapping-confirmed-refused] [SG2-50:AC2] [CONFLICT] A confirmed booking overlapping another at the same venue should have been refused';
  exception when exclusion_violation then null;
  end;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (95001, '2030-06-15 08:00+00', '2030-06-15 09:00+00', 'confirmed');
    update public.venue_bookings set ends_at = '2030-06-15 10:30+00'
      where venue_id = 95001 and starts_at = '2030-06-15 08:00+00';
    raise exception '[SG2-50:moved-into-overlap-refused] [SG2-50:AC2] [CONFLICT] Moving a booking so it overlaps another should have been refused';
  exception when exclusion_violation then null;
  end;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (95001, '2030-06-15 09:00+00', '2030-06-15 10:30+00', 'held');
    update public.venue_bookings set status = 'confirmed'
      where venue_id = 95001 and starts_at = '2030-06-15 09:00+00';
    raise exception '[SG2-50:confirming-into-overlap-refused] [SG2-50:AC2] [CONFLICT] Confirming a held booking that overlaps a confirmed one should have been refused';
  exception when exclusion_violation then null;
  end;
end $$;

-- 2. The limits: touching periods, other venues and unconfirmed holds are fine;
-- a microsecond of overlap is not:
do $$
begin
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (95001, '2030-06-15 12:00+00', '2030-06-15 14:00+00', 'confirmed');
  if not exists (select 1 from public.venue_bookings where venue_id = 95001 and starts_at = '2030-06-15 12:00+00') then
    raise exception '[SG2-50:adjacent-booking-accepted] [SG2-50:AC1] [BOUNDARY] A booking starting as another ends must be accepted';
  end if;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (95001, '2030-06-15 13:59:59.999999+00', '2030-06-15 15:00+00', 'confirmed');
    raise exception '[SG2-50:microsecond-overlap-refused] [SG2-50:AC1] [BOUNDARY] One microsecond of overlap should have been refused';
  exception when exclusion_violation then null;
  end;
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (95002, '2030-06-15 10:00+00', '2030-06-15 12:00+00', 'confirmed');
  if (select count(*) from public.venue_bookings where venue_id = 95002) <> 1 then
    raise exception '[SG2-50:other-venue-accepted] [SG2-50:AC1] [NORMAL] The same period at a different venue must be accepted';
  end if;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (95001, '2030-06-15 10:30+00', '2030-06-15 11:30+00', 'held');
  exception when exclusion_violation then
    raise exception '[SG2-50:held-not-committed] [SG2-50:AC1] [BOUNDARY] A held booking is not confirmed and must not be refused over a confirmed one';
  end;
end $$;

-- 3. Once the conflicting booking is gone its period is free again:
do $$
begin
  delete from public.venue_bookings where venue_id = 95001 and starts_at = '2030-06-15 10:00+00';
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (95001, '2030-06-15 10:30+00', '2030-06-15 11:30+00', 'confirmed');
  if not exists (select 1 from public.venue_bookings where venue_id = 95001 and starts_at = '2030-06-15 10:30+00' and status = 'confirmed') then
    raise exception '[SG2-50:released-period-free] [SG2-50:AC3] [NORMAL] A period freed by a removed booking must be bookable again';
  end if;
end $$;

-- 4. Only confirmed bookings are kept apart, so any other status (held, or
-- SG2-51's released bookings) does not commit the period:
do $$
begin
  if not exists (select 1 from pg_constraint
      where conrelid = 'public.venue_bookings'::regclass and conname = 'venue_bookings_no_double_booking'
        and pg_get_constraintdef(oid) like '%WHERE ((status = ''confirmed''::text))%') then
    raise exception '[SG2-50:committed-statuses-only] [SG2-50:AC3] [BOUNDARY] The double-booking rule must cover exactly confirmed bookings';
  end if;
end $$;

-- 5. Through SG2-49's approval: refused while a confirmed booking for another
-- event overlaps the request, approved once it is gone:
insert into auth.users (id) values
  ('e5000000-0000-4000-8000-000000000001'), ('e5000000-0000-4000-8000-000000000002'), ('e5000000-0000-4000-8000-000000000003');
insert into public.users (user_id, name, role_id) values
  ('e5000000-0000-4000-8000-000000000001', 'Clash staff', 3),
  ('e5000000-0000-4000-8000-000000000002', 'Clash coordinator', 2),
  ('e5000000-0000-4000-8000-000000000003', 'Clash organiser', 1);
insert into public.account_roles (user_id, role) values
  ('e5000000-0000-4000-8000-000000000001', 'venue_staff'),
  ('e5000000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('e5000000-0000-4000-8000-000000000003', 'event_organiser');
insert into public.venues (venue_id, name, capacity) values (95003, 'Clash Hall', 100);
insert into public.events (event_id, organiser_id, coordinator_id, name, status, expected_attendance) values
  (95001, 'e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000002', 'Gala Night', 'approved', 50),
  (95002, 'e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000002', 'Partner Lunch', 'approved', 50);
insert into public.venue_bookings (venue_id, event_id, starts_at, ends_at, status)
  values (95003, 95001, '2030-08-01 10:00+00', '2030-08-01 12:00+00', 'confirmed');
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by)
  values (95001, 95002, 95003, '2030-08-01 11:00+00', '2030-08-01 13:00+00', 'theatre', 'e5000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb;
begin
  result := public.decide_venue_booking_request(95001, 'approve', null);
  if result->>'outcome' <> 'conflict' or result->>'kind' <> 'booking' or result->>'label' <> 'Gala Night'
      or (select status from public.venue_booking_requests where request_id = 95001) <> 'pending'
      or (select count(*) from public.venue_bookings where venue_id = 95003) <> 1 then
    raise exception '[SG2-50:approval-refused-while-conflict] [SG2-50:AC2] [CONFLICT] Approval overlapping Gala Night''s confirmed booking was not refused: %', result;
  end if;
  -- Gala Night's booking is released.
  delete from public.venue_bookings where venue_id = 95003 and event_id = 95001;
  result := public.decide_venue_booking_request(95001, 'approve', null);
  if result->>'outcome' <> 'updated'
      or not exists (select 1 from public.venue_bookings where venue_id = 95003 and event_id = 95002 and status = 'confirmed') then
    raise exception '[SG2-50:approved-once-conflict-cleared] [SG2-50:AC3] [NORMAL] Approval was not allowed once the conflicting booking was gone: %', result;
  end if;
end $$;

rollback;
