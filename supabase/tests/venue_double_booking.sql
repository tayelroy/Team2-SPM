-- Review trace: SG2-50 prevent double-booking a venue.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-50: venue_bookings_no_double_booking keeps held and confirmed bookings apart.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into public.venues (venue_id, name) values (95001, 'Double Booking Hall'), (95002, 'Second Hall');
-- Gala Night holds the hall 10:00-12:00.
insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
  values (95001, '2030-06-15 10:00+00', '2030-06-15 12:00+00', 'confirmed');

-- 1. Overlapping commitments are refused:
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
      values (95001, '2030-06-15 09:00+00', '2030-06-15 13:00+00', 'held');
    raise exception '[SG2-50:overlapping-held-refused] [SG2-50:AC2] [CONFLICT] A held booking spanning a confirmed one should have been refused';
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
end $$;

-- 2. The limits: touching periods and other venues are fine; a microsecond of overlap is not:
do $$
begin
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (95001, '2030-06-15 12:00+00', '2030-06-15 14:00+00', 'confirmed');
  if not exists (select 1 from public.venue_bookings where venue_id = 95001 and starts_at = '2030-06-15 12:00+00') then
    raise exception '[SG2-50:adjacent-booking-accepted] [SG2-50:AC1] [BOUNDARY] A booking starting as another ends must be accepted';
  end if;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (95001, '2030-06-15 13:59:59.999999+00', '2030-06-15 15:00+00', 'held');
    raise exception '[SG2-50:microsecond-overlap-refused] [SG2-50:AC1] [BOUNDARY] One microsecond of overlap should have been refused';
  exception when exclusion_violation then null;
  end;
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (95002, '2030-06-15 10:00+00', '2030-06-15 12:00+00', 'confirmed');
  if (select count(*) from public.venue_bookings where venue_id = 95002) <> 1 then
    raise exception '[SG2-50:other-venue-accepted] [SG2-50:AC1] [NORMAL] The same period at a different venue must be accepted';
  end if;
end $$;

-- 3. Once the conflicting booking is gone its period is free again:
do $$
begin
  delete from public.venue_bookings where venue_id = 95001 and starts_at = '2030-06-15 10:00+00';
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (95001, '2030-06-15 10:30+00', '2030-06-15 11:30+00', 'confirmed');
  if not exists (select 1 from public.venue_bookings where venue_id = 95001 and starts_at = '2030-06-15 10:30+00') then
    raise exception '[SG2-50:released-period-free] [SG2-50:AC3] [NORMAL] A period freed by a removed booking must be bookable again';
  end if;
end $$;

-- 4. Only held and confirmed bookings are kept apart, so any other status
-- (SG2-51's released bookings) frees the period:
do $$
begin
  if not exists (select 1 from pg_constraint
      where conrelid = 'public.venue_bookings'::regclass and conname = 'venue_bookings_no_double_booking'
        and pg_get_constraintdef(oid) like '%status = ANY (ARRAY[''held''::text, ''confirmed''::text])%') then
    raise exception '[SG2-50:committed-statuses-only] [SG2-50:AC3] [BOUNDARY] The double-booking rule must cover exactly held and confirmed bookings';
  end if;
end $$;

rollback;
