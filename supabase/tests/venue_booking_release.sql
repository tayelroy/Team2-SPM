-- Review trace: SG2-51 release a venue booking.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-51: release_venue_booking() cancels a confirmed booking with a reason,
-- frees the period, keeps the event's other venues, notifies the coordinator
-- and organiser, and records who, when and why.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users (id) values
  ('e5100000-0000-4000-8000-000000000001'), ('e5100000-0000-4000-8000-000000000002'),
  ('e5100000-0000-4000-8000-000000000003'), ('e5100000-0000-4000-8000-000000000004'),
  ('e5100000-0000-4000-8000-000000000005');
insert into public.users (user_id, name, role_id) values
  ('e5100000-0000-4000-8000-000000000001', 'Release staff', 3),
  ('e5100000-0000-4000-8000-000000000002', 'Release coordinator', 2),
  ('e5100000-0000-4000-8000-000000000003', 'Release organiser', 1),
  ('e5100000-0000-4000-8000-000000000004', 'Other coordinator', 2),
  ('e5100000-0000-4000-8000-000000000005', 'Release support', 4);
insert into public.account_roles (user_id, role) values
  ('e5100000-0000-4000-8000-000000000001', 'venue_staff'),
  ('e5100000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('e5100000-0000-4000-8000-000000000003', 'event_organiser'),
  ('e5100000-0000-4000-8000-000000000004', 'event_coordinator'),
  ('e5100000-0000-4000-8000-000000000005', 'technical_support_staff');
insert into public.venues (venue_id, name) values (95101, 'Release Hall'), (95102, 'Release Annex');
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (95101, 'e5100000-0000-4000-8000-000000000003', 'e5100000-0000-4000-8000-000000000002', 'Release Summit', 'planning');
-- The summit has two venues (Week 7 change #3), plus a past booking.
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (95101, 95101, 95101, '2030-09-01 01:00+00', '2030-09-01 05:00+00', 'confirmed'),
  (95102, 95102, 95101, '2030-09-01 01:00+00', '2030-09-01 05:00+00', 'confirmed'),
  (95103, 95101, 95101, '2020-09-01 01:00+00', '2020-09-01 05:00+00', 'confirmed');
update public.events set venue_booking_id = 95101 where event_id = 95101;
insert into public.venue_booking_requests (request_id, event_id, venue_id, starts_at, ends_at, layout, requested_by,
    status, decided_by, decided_at, venue_booking_id) values
  (95101, 95101, 95101, '2030-09-01 01:00+00', '2030-09-01 05:00+00', 'theatre', 'e5100000-0000-4000-8000-000000000002',
    'approved', 'e5100000-0000-4000-8000-000000000001', now(), 95101);

-- 1. Who may release, and what is refused before anything changes:
select set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000004', true);
do $$
declare result jsonb;
begin
  result := public.release_venue_booking(95101, 'Not my event');
  if result->>'outcome' <> 'missing' or (select status from public.venue_bookings where booking_id = 95101) <> 'confirmed' then
    raise exception '[SG2-51:unassigned-coordinator-refused] [SG2-51:AC1] [FAILURE] A coordinator released a booking for an event not assigned to them: %', result;
  end if;
end $$;
select set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000005', true);
do $$
begin
  begin
    perform public.release_venue_booking(95101, 'Support cannot release');
    raise exception '[SG2-51:other-role-refused] [SG2-51:AC1] [FAILURE] Technical Support Staff released a venue booking';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000002', true);
do $$
declare result jsonb;
begin
  if public.release_venue_booking(95101, '   ')->>'outcome' <> 'invalid'
      or public.release_venue_booking(95101, null)->>'outcome' <> 'invalid'
      or public.release_venue_booking(95101, repeat('x', 501))->>'outcome' <> 'invalid' then
    raise exception '[SG2-51:reason-required] [SG2-51:AC1] [BOUNDARY] A release without a reason, or with more than 500 characters, was accepted';
  end if;
  result := public.release_venue_booking(95103, 'Already over');
  if result->>'outcome' <> 'past' then
    raise exception '[SG2-51:past-booking-refused] [SG2-51:AC1] [BOUNDARY] A booking that has already ended was released: %', result;
  end if;
  if public.release_venue_booking(-1, 'Nothing here')->>'outcome' <> 'missing' then
    raise exception '[SG2-51:unknown-booking] [SG2-51:AC1] [FAILURE] An unknown booking was not reported missing';
  end if;
end $$;

-- 2. The assigned coordinator releases one of the summit's two venues:
do $$
declare result jsonb;
begin
  result := public.release_venue_booking(95101, '  ' || repeat('r', 498) || '  ');
  if result->>'outcome' <> 'released' then
    raise exception '[SG2-51:coordinator-releases] [SG2-51:AC1] [NORMAL] The assigned coordinator could not release a booking: %', result;
  end if;
  if not exists (select 1 from public.venue_bookings where booking_id = 95101 and status = 'cancelled'
      and cancelled_by = 'e5100000-0000-4000-8000-000000000002' and cancelled_at is not null
      and cancellation_reason = repeat('r', 498)) then
    raise exception '[SG2-51:release-recorded] [SG2-51:AC5] [NORMAL] The release, who made it, when and the trimmed reason must be kept on the booking';
  end if;
  if exists (select 1 from public.venue_booking_occupancy where venue_id = 95101 and starts_at = '2030-09-01 01:00+00') then
    raise exception '[SG2-51:period-freed] [SG2-51:AC2] [NORMAL] A released booking must no longer occupy its venue';
  end if;
  if (select status from public.venue_booking_requests where request_id = 95101) <> 'cancelled' then
    raise exception '[SG2-51:request-no-longer-live] [SG2-51:AC2] [NORMAL] The request that committed the booking must no longer be live';
  end if;
  if (select status from public.venue_bookings where booking_id = 95102) <> 'confirmed'
      or not exists (select 1 from public.venue_booking_occupancy where venue_id = 95102)
      or (select venue_booking_id from public.events where event_id = 95101) <> 95102 then
    raise exception '[SG2-51:other-venues-kept] [SG2-51:AC3] [NORMAL] Releasing one venue must leave the event''s other booking confirmed and make it the main venue';
  end if;
  if (select count(*) from public.notifications where event_id = 95101 and kind = 'venue_booking_released'
      and recipient_id in ('e5100000-0000-4000-8000-000000000002', 'e5100000-0000-4000-8000-000000000003')
      and message like 'Release Hall was released for Release Summit (01 Sep 2030 09:00 – 01 Sep 2030 13:00 SGT): r%') <> 2 then
    raise exception '[SG2-51:coordinator-and-organiser-notified] [SG2-51:AC4] [NORMAL] The coordinator and the Event Organiser must each be notified with the reason';
  end if;
  if not exists (select 1 from public.event_audit_logs where event_id = 95101 and field_name = 'venue_booking'
      and actor_id = 'e5100000-0000-4000-8000-000000000002' and new_value like 'Released: Release Hall (booking 95101) — r%') then
    raise exception '[SG2-51:release-in-history] [SG2-51:AC5] [NORMAL] The release must appear in the event history with its actor and reason';
  end if;
  result := public.release_venue_booking(95101, 'Again');
  if result->>'outcome' <> 'inactive' or result->>'status' <> 'cancelled' then
    raise exception '[SG2-51:second-release-refused] [SG2-51:AC1] [CONFLICT] A booking already released was released again: %', result;
  end if;
end $$;

-- 3. Venue Staff release the other venue; the freed period can be booked again:
select set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000001', true);
do $$
declare result jsonb;
begin
  result := public.release_venue_booking(95102, 'Annex flooded');
  if result->>'outcome' <> 'released' or (select venue_booking_id from public.events where event_id = 95101) is not null then
    raise exception '[SG2-51:staff-releases] [SG2-51:AC1] [NORMAL] Venue Staff could not release a booking, or the event kept pointing at it: %', result;
  end if;
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (95101, '2030-09-01 02:00+00', '2030-09-01 03:00+00', 'confirmed');
  if not exists (select 1 from public.venue_booking_occupancy where venue_id = 95101 and starts_at = '2030-09-01 02:00+00') then
    raise exception '[SG2-51:period-rebookable] [SG2-51:AC2] [BOUNDARY] A released period must be bookable again';
  end if;
end $$;

-- 4. Direct writes cannot skip the record of a release:
reset role;
do $$
begin
  begin
    update public.venue_bookings set status = 'cancelled' where booking_id = 95103;
    raise exception '[SG2-51:release-without-time] [SG2-51:AC5] [FAILURE] A booking was cancelled without recording when';
  exception when check_violation then null;
  end;
  begin
    update public.venue_bookings set status = 'cancelled', cancelled_at = now(), cancellation_reason = ' ' where booking_id = 95103;
    raise exception '[SG2-51:release-without-reason] [SG2-51:AC5] [FAILURE] A booking was cancelled without a reason';
  exception when check_violation then null;
  end;
end $$;

-- 5. Clients cannot release by writing the table themselves:
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5100000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    update public.venue_bookings set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'x' where booking_id = 95103;
    raise exception '[SG2-51:no-direct-release] [SG2-51:AC1] [FAILURE] A client cancelled a booking directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
