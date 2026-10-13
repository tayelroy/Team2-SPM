-- Review trace: SG2-79 flag existing bookings that conflict once setup and turnaround time apply.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-79: venue_booking_clashes flags confirmed bookings closer together than
-- setup plus turnaround, leaves the bookings alone, notifies coordinators and
-- clears when the clash is resolved.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users (id) values
  ('e7900000-0000-4000-8000-000000000001'), ('e7900000-0000-4000-8000-000000000002'),
  ('e7900000-0000-4000-8000-000000000003'), ('e7900000-0000-4000-8000-000000000004');
insert into public.users (user_id, name, role_id) values
  ('e7900000-0000-4000-8000-000000000001', 'Clash coordinator one', 2),
  ('e7900000-0000-4000-8000-000000000002', 'Clash coordinator two', 2),
  ('e7900000-0000-4000-8000-000000000003', 'Clash organiser', 1),
  ('e7900000-0000-4000-8000-000000000004', 'Clash staff', 3);
insert into public.account_roles (user_id, role) values
  ('e7900000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('e7900000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('e7900000-0000-4000-8000-000000000003', 'event_organiser'),
  ('e7900000-0000-4000-8000-000000000004', 'venue_staff');
insert into public.venues (venue_id, name) values (97901, 'Clash Hall'), (97902, 'Clash Room');
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (97901, 'e7900000-0000-4000-8000-000000000003', 'e7900000-0000-4000-8000-000000000001', 'Morning Summit', 'planning'),
  (97902, 'e7900000-0000-4000-8000-000000000003', 'e7900000-0000-4000-8000-000000000002', 'Afternoon Forum', 'planning'),
  (97903, 'e7900000-0000-4000-8000-000000000003', 'e7900000-0000-4000-8000-000000000001', 'Board Lunch', 'planning');
-- Booked before Clash Hall had any times: 10:00-12:00 and 12:30-13:30 leave 30 minutes between them.
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (97901, 97901, 97901, '2030-10-01 10:00+00', '2030-10-01 12:00+00', 'confirmed'),
  (97902, 97901, 97902, '2030-10-01 12:30+00', '2030-10-01 13:30+00', 'confirmed'),
  (97903, 97902, 97901, '2030-10-02 10:00+00', '2030-10-02 12:00+00', 'confirmed'),
  (97904, 97902, 97903, '2030-10-02 12:10+00', '2030-10-02 13:00+00', 'confirmed');

-- 1. Without times there is nothing to flag:
do $$
begin
  if exists (select 1 from public.venue_booking_clashes) then
    raise exception '[SG2-79:no-times-no-flags] [SG2-79:AC1] [BOUNDARY] Bookings at a venue without setup or turnaround time must not be flagged';
  end if;
end $$;

-- 2. Introducing times flags the pair, leaves both bookings alone and tells both coordinators:
insert into public.venue_operations (venue_id, setup_minutes, turnaround_minutes) values (97901, 30, 45);
do $$
begin
  if not exists (select 1 from public.venue_booking_clashes where booking_id = 97901 and other_booking_id = 97902 and venue_id = 97901) then
    raise exception '[SG2-79:times-introduced-flagged] [SG2-79:AC1] [NORMAL] Bookings closer together than the new setup plus turnaround must be flagged';
  end if;
  if (select count(*) from public.venue_bookings where booking_id in (97901, 97902) and status = 'confirmed'
        and ((booking_id = 97901 and starts_at = '2030-10-01 10:00+00' and ends_at = '2030-10-01 12:00+00')
          or (booking_id = 97902 and starts_at = '2030-10-01 12:30+00' and ends_at = '2030-10-01 13:30+00'))) <> 2 then
    raise exception '[SG2-79:bookings-untouched] [SG2-79:AC2] [NORMAL] Flagged bookings must not be cancelled, moved or otherwise altered';
  end if;
  if (select count(*) from public.notifications where kind = 'venue_booking_clash' and event_id = 97901
        and recipient_id = 'e7900000-0000-4000-8000-000000000001'
        and message = 'Clash Hall: Morning Summit (01 Oct 2030 18:00 – 01 Oct 2030 20:00 SGT) now clashes with another event '
          || '(01 Oct 2030 20:30 – 01 Oct 2030 21:30 SGT) once setup and turnaround time are included. Neither booking has been changed.') <> 1
     or (select count(*) from public.notifications where kind = 'venue_booking_clash' and event_id = 97902
        and recipient_id = 'e7900000-0000-4000-8000-000000000002') <> 1 then
    raise exception '[SG2-79:coordinators-notified] [SG2-79:AC4] [NORMAL] The coordinator of each affected event must be told once, without another coordinator''s event name';
  end if;
end $$;

-- 3. Changing the times while the pair still clashes keeps one flag and does not notify again:
update public.venue_operations set turnaround_minutes = 40 where venue_id = 97901;
do $$
begin
  if (select count(*) from public.venue_booking_clashes where venue_id = 97901) <> 1
     or (select count(*) from public.notifications where kind = 'venue_booking_clash' and event_id in (97901, 97902)) <> 2 then
    raise exception '[SG2-79:no-repeat-notices] [SG2-79:AC4] [CONFLICT] A clash that stands through a change of times must stay one flag with no new notices';
  end if;
end $$;

-- 4. The limits: exactly setup plus turnaround apart clears; a minute closer flags again:
update public.venue_operations set setup_minutes = 15, turnaround_minutes = 15 where venue_id = 97901;
do $$
begin
  if exists (select 1 from public.venue_booking_clashes where venue_id = 97901) then
    raise exception '[SG2-79:exact-gap-clears] [SG2-79:AC5] [BOUNDARY] Bookings exactly setup plus turnaround apart must no longer be flagged';
  end if;
end $$;
update public.venue_operations set turnaround_minutes = 16 where venue_id = 97901;
do $$
begin
  if not exists (select 1 from public.venue_booking_clashes where booking_id = 97901 and other_booking_id = 97902) then
    raise exception '[SG2-79:one-minute-short-flagged] [SG2-79:AC1] [BOUNDARY] Bookings one minute closer than setup plus turnaround must be flagged';
  end if;
end $$;

-- 5. Moving or releasing a booking resolves the clash:
update public.venue_bookings set starts_at = '2030-10-01 14:00+00', ends_at = '2030-10-01 15:00+00' where booking_id = 97902;
do $$
begin
  if exists (select 1 from public.venue_booking_clashes where venue_id = 97901) then
    raise exception '[SG2-79:moved-booking-clears] [SG2-79:AC5] [NORMAL] Moving a booking clear of the other must clear the flag';
  end if;
end $$;
update public.venue_bookings set starts_at = '2030-10-01 12:30+00', ends_at = '2030-10-01 13:30+00' where booking_id = 97902;
update public.venue_bookings set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Moved to another venue'
  where booking_id = 97902;
do $$
begin
  if exists (select 1 from public.venue_booking_clashes where venue_id = 97901) then
    raise exception '[SG2-79:released-booking-clears] [SG2-79:AC5] [NORMAL] Releasing one of the bookings must clear the flag';
  end if;
end $$;

-- 6. A coordinator whose own two events clash sees both names:
insert into public.venue_operations (venue_id, setup_minutes, turnaround_minutes) values (97902, 0, 15);
do $$
begin
  if not exists (select 1 from public.notifications where kind = 'venue_booking_clash' and event_id = 97903
      and recipient_id = 'e7900000-0000-4000-8000-000000000001'
      and message like 'Clash Room: Board Lunch (02 Oct 2030 20:10 – 02 Oct 2030 21:00 SGT) now clashes with Morning Summit (%') then
    raise exception '[SG2-79:own-events-named] [SG2-79:AC3] [NORMAL] A coordinator must see the name of their own event on the other side of a clash';
  end if;
end $$;

-- 7. Only the server reads flags, and nobody triggers a re-check directly:
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e7900000-0000-4000-8000-000000000004', true);
do $$
begin
  begin
    perform 1 from public.venue_booking_clashes;
    raise exception '[SG2-79:flags-server-only] [SG2-79:AC3] [FAILURE] Clients must not read clash flags directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.refresh_venue_booking_clashes(97901);
    raise exception '[SG2-79:refresh-not-public] [SG2-79:AC1] [FAILURE] Clients must not call the re-check directly';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
