-- Run after the migrations in a disposable/development database as postgres.
-- Test records are rolled back. Never run against production.
--
-- Covers SG2-45 acceptance: only Venue Staff block a venue from use (insert
-- into venue_unavailability) or remove a block (delete); other internal and
-- external roles cannot write directly; a period holding a confirmed booking
-- cannot be blocked by anyone, while a held booking or a free period can.
begin;

insert into auth.users (id) values
  ('c0000000-0000-4000-8000-000000000001'),  -- venue_staff
  ('c0000000-0000-4000-8000-000000000002'),  -- event_coordinator
  ('c0000000-0000-4000-8000-000000000003'),  -- technical_support_staff
  ('c0000000-0000-4000-8000-000000000004'),  -- event_organiser
  ('c0000000-0000-4000-8000-000000000005');  -- attendee
insert into public.account_roles (user_id, role) values
  ('c0000000-0000-4000-8000-000000000001', 'venue_staff'),
  ('c0000000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('c0000000-0000-4000-8000-000000000003', 'technical_support_staff'),
  ('c0000000-0000-4000-8000-000000000004', 'event_organiser'),
  ('c0000000-0000-4000-8000-000000000005', 'attendee');

insert into public.venues (venue_id, name) values (900, 'Test Hall');
insert into public.venue_bookings (venue_id, starts_at, ends_at, status) values
  (900, '2026-10-01 09:00+00', '2026-10-01 17:00+00', 'confirmed'),
  (900, '2026-10-05 09:00+00', '2026-10-05 12:00+00', 'held');
insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason) values
  (900, '2026-10-10 00:00+00', '2026-10-11 00:00+00', 'Scheduled maintenance');

-- Venue staff: blocks free and held periods, is refused over a confirmed
-- booking, and removes blocks directly.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
    values (900, '2026-10-20 09:00+00', '2026-10-20 17:00+00', 'Carpet replacement');
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
    values (900, '2026-10-05 08:00+00', '2026-10-05 10:00+00', 'Over a held booking');
  if (select count(*) from public.venue_unavailability where venue_id = 900) <> 3 then
    raise exception 'Venue staff could not block a free or held period';
  end if;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-10-01 16:00+00', '2026-10-01 18:00+00', 'Over a confirmed booking');
    raise exception 'A period holding a confirmed booking was blocked';
  exception when exclusion_violation then null;
  end;
  -- Touching intervals do not overlap: the booking ends as the block starts.
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
    values (900, '2026-10-01 17:00+00', '2026-10-01 18:00+00', 'Right after the booking');
  delete from public.venue_unavailability where reason in ('Carpet replacement', 'Over a held booking', 'Right after the booking');
  if (select count(*) from public.venue_unavailability where venue_id = 900) <> 1 then
    raise exception 'Venue staff could not remove a block directly';
  end if;
  begin
    update public.venue_unavailability set ends_at = '2026-10-12 00:00+00' where venue_id = 900;
    raise exception 'Venue staff could update a block directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Every other signed-in role: cannot block or remove a block directly.
do $$
declare
  caller uuid;
begin
  foreach caller in array array[
    'c0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000003',
    'c0000000-0000-4000-8000-000000000004',
    'c0000000-0000-4000-8000-000000000005'
  ]::uuid[] loop
    perform set_config('request.jwt.claim.sub', caller::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', caller, 'role', 'authenticated')::text, true);
    begin
      insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
        values (900, '2026-11-01 09:00+00', '2026-11-01 10:00+00', 'Not allowed');
      raise exception 'Role of % could block a venue directly', caller;
    exception when insufficient_privilege then null;
    end;
    -- A delete outside the row-matching policy silently removes zero rows
    -- rather than raising, so assert the targeted row survives instead.
    delete from public.venue_unavailability where venue_id = 900;
  end loop;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.venue_unavailability where venue_id = 900) <> 1 then
    raise exception 'A role other than venue staff removed a block directly';
  end if;
end $$;

-- Anonymous: no write access at all.
set local role anon;
do $$
begin
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-11-01 09:00+00', '2026-11-01 10:00+00', 'Not allowed');
    raise exception 'Anonymous caller could block a venue';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.venue_unavailability;
    raise exception 'Anonymous caller could remove a block';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The confirmed-booking rule holds regardless of caller, including on update.
reset role;
do $$
begin
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-10-01 08:00+00', '2026-10-01 20:00+00', 'Privileged overlap');
    raise exception 'A privileged insert blocked a confirmed booking';
  exception when exclusion_violation then null;
  end;
  begin
    update public.venue_unavailability set starts_at = '2026-10-01 12:00+00' where venue_id = 900;
    raise exception 'An update moved a block over a confirmed booking';
  exception when exclusion_violation then null;
  end;
  begin
    perform public.venue_unavailability_refuse_confirmed_overlap();
    raise exception 'The trigger function could be called directly';
  exception when feature_not_supported then null;
  end;
end $$;

rollback;
