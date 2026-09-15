-- Run after the migrations in a disposable/development database as postgres.
-- Test records are rolled back. Never run against production.
--
-- Covers SG2-44 acceptance: internal scheduling roles read a venue's bookings
-- and recorded unavailability; Attendees and Event Organisers cannot; direct
-- writes by ordinary callers are refused; time-range and reference constraints
-- hold.
begin;

insert into auth.users (id) values
  ('a0000000-0000-4000-8000-000000000001'),  -- event_coordinator
  ('a0000000-0000-4000-8000-000000000002'),  -- attendee
  ('a0000000-0000-4000-8000-000000000003');  -- event_organiser
insert into public.account_roles (user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('a0000000-0000-4000-8000-000000000002', 'attendee'),
  ('a0000000-0000-4000-8000-000000000003', 'event_organiser');

insert into public.venues (venue_id, name) values (900, 'Test Hall');
insert into public.venue_bookings (venue_id, starts_at, ends_at, status) values
  (900, '2026-10-01 09:00+00', '2026-10-01 17:00+00', 'confirmed'),
  (900, '2026-10-05 09:00+00', '2026-10-05 12:00+00', 'held');
insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason) values
  (900, '2026-10-10 00:00+00', '2026-10-11 00:00+00', 'Scheduled maintenance');

-- Internal role: sees every entry, cannot write directly.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_bookings) <> 2 then
    raise exception 'Internal role must see venue bookings';
  end if;
  if (select count(*) from public.venue_unavailability) <> 1 then
    raise exception 'Internal role must see venue unavailability';
  end if;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (900, '2026-11-01 09:00+00', '2026-11-01 10:00+00', 'held');
    raise exception 'Internal role could insert bookings directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Attendee: sees nothing.
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_bookings) <> 0 then
    raise exception 'Attendee could see venue bookings';
  end if;
  if (select count(*) from public.venue_unavailability) <> 0 then
    raise exception 'Attendee could see venue unavailability';
  end if;
end $$;

-- Event organiser: sees nothing.
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_bookings) <> 0 then
    raise exception 'Event organiser could see venue bookings';
  end if;
  if (select count(*) from public.venue_unavailability) <> 0 then
    raise exception 'Event organiser could see venue unavailability';
  end if;
end $$;

-- Anonymous: no access to the tables at all.
set local role anon;
do $$
begin
  begin
    perform * from public.venue_bookings;
    raise exception 'Anonymous caller could read venue bookings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.venue_unavailability;
    raise exception 'Anonymous caller could read venue unavailability';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Constraints hold regardless of caller.
reset role;
do $$
begin
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (900, '2026-10-01 17:00+00', '2026-10-01 09:00+00', 'held');
    raise exception 'Backwards time range accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (900, '2026-10-01 09:00+00', '2026-10-01 10:00+00', 'pencilled');
    raise exception 'Unknown booking status accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (999, '2026-10-01 09:00+00', '2026-10-01 10:00+00', 'held');
    raise exception 'Booking accepted for nonexistent venue';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-10-11 00:00+00', '2026-10-10 00:00+00', 'bad range');
    raise exception 'Backwards unavailability range accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
