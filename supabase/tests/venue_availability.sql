-- Review trace: original PR #21.
-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
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
  ('a0000000-0000-4000-8000-000000000003'),  -- event_organiser
  ('a0000000-0000-4000-8000-000000000004'),  -- venue_staff
  ('a0000000-0000-4000-8000-000000000005');  -- technical_support_staff
insert into public.account_roles (user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', 'event_coordinator'),
  ('a0000000-0000-4000-8000-000000000002', 'attendee'),
  ('a0000000-0000-4000-8000-000000000003', 'event_organiser'),
  ('a0000000-0000-4000-8000-000000000004', 'venue_staff'),
  ('a0000000-0000-4000-8000-000000000005', 'technical_support_staff');

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
    raise exception '[SG2-44:coordinator-booking-read] [SG2-44:AC1] [NORMAL] Internal role must see venue bookings';
  end if;
  if (select count(*) from public.venue_unavailability) <> 1 then
    raise exception '[SG2-44:coordinator-block-read] [SG2-44:AC1] [NORMAL] Internal role must see venue unavailability';
  end if;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (900, '2026-11-01 09:00+00', '2026-11-01 10:00+00', 'held');
    raise exception '[SG2-44:direct-booking-insert] [FAILURE] Internal role could insert bookings directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Venue staff and technical support have the same availability read contract.
do $$
declare caller uuid;
begin
  foreach caller in array array[
    'a0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000005'
  ]::uuid[] loop
    perform set_config('request.jwt.claim.sub', caller::text, true);
    if (select count(*) from public.venue_bookings where venue_id = 900) <> 2
      or (select count(*) from public.venue_unavailability where venue_id = 900) <> 1 then
      raise exception '[SG2-44:internal-role-matrix] [SG2-44:AC1] [NORMAL] Internal role of % must see both bookings and the block', caller;
    end if;
    if not exists (select 1 from public.venue_bookings where venue_id = 900
        and starts_at = '2026-10-01 09:00+00' and ends_at = '2026-10-01 17:00+00' and status = 'confirmed')
      or not exists (select 1 from public.venue_unavailability where venue_id = 900
        and starts_at = '2026-10-10 00:00+00' and ends_at = '2026-10-11 00:00+00'
        and reason = 'Scheduled maintenance') then
      raise exception '[SG2-44:stored-availability-details] [SG2-44:AC2] [NORMAL] Availability must retain its venue, period, booking status and reason';
    end if;
    begin
      update public.venue_bookings set status = 'confirmed' where venue_id = 900;
      raise exception '[SG2-44:direct-booking-update] [FAILURE] Internal scheduling callers must not update bookings directly';
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.venue_bookings where venue_id = 900;
      raise exception '[SG2-44:direct-booking-delete] [FAILURE] Internal scheduling callers must not delete bookings directly';
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- Attendee: sees nothing.
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_bookings) <> 0 then
    raise exception '[SG2-44:attendee-booking-read] [SG2-44:AC3] [FAILURE] Attendee could see venue bookings';
  end if;
  if (select count(*) from public.venue_unavailability) <> 0 then
    raise exception '[SG2-44:attendee-block-read] [SG2-44:AC3] [FAILURE] Attendee could see venue unavailability';
  end if;
end $$;

-- Event organiser: sees nothing.
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_bookings) <> 0 then
    raise exception '[SG2-44:organiser-booking-read] [SG2-44:AC3] [FAILURE] Event organiser could see venue bookings';
  end if;
  if (select count(*) from public.venue_unavailability) <> 0 then
    raise exception '[SG2-44:organiser-block-read] [SG2-44:AC3] [FAILURE] Event organiser could see venue unavailability';
  end if;
end $$;

-- Anonymous: no access to the tables at all.
set local role anon;
do $$
begin
  begin
    perform * from public.venue_bookings;
    raise exception '[SG2-44:anonymous-booking-read] [SG2-44:AC3] [FAILURE] Anonymous caller could read venue bookings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.venue_unavailability;
    raise exception '[SG2-44:anonymous-block-read] [SG2-44:AC3] [FAILURE] Anonymous caller could read venue unavailability';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Constraints hold regardless of caller.
reset role;
do $$
begin
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (900, '2026-12-01 09:00+00', '2026-12-01 09:00+00', 'held');
    raise exception '[SG2-44:empty-booking-window] [BOUNDARY] Equal booking start and end must be rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-12-01 09:00+00', '2026-12-01 09:00+00', 'Empty block');
    raise exception '[SG2-44:empty-block-window] [BOUNDARY] Equal block start and end must be rejected';
  exception when check_violation then null;
  end;
  insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
    values (900, '2026-12-01 09:00+00', '2026-12-01 09:00:00.000001+00', 'held');
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
    values (900, '2026-12-02 09:00+00', '2026-12-02 09:00:00.000001+00', 'Minimum non-empty block');
  if not exists (select 1 from public.venue_bookings where venue_id = 900
      and starts_at = '2026-12-01 09:00+00' and ends_at = '2026-12-01 09:00:00.000001+00' and status = 'held')
    or not exists (select 1 from public.venue_unavailability where venue_id = 900
      and starts_at = '2026-12-02 09:00+00' and ends_at = '2026-12-02 09:00:00.000001+00') then
    raise exception '[SG2-44:minimum-stored-windows] [BOUNDARY] One-microsecond booking and block periods must persist';
  end if;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (900, '2026-10-01 17:00+00', '2026-10-01 09:00+00', 'held');
    raise exception '[SG2-44:backwards-booking-window] [FAILURE] Backwards time range accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (900, '2026-10-01 09:00+00', '2026-10-01 10:00+00', 'pencilled');
    raise exception '[SG2-44:unsupported-booking-status] [FAILURE] Unknown booking status accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
      values (999, '2026-10-01 09:00+00', '2026-10-01 10:00+00', 'held');
    raise exception '[SG2-44:booking-venue-reference] [FAILURE] Booking accepted for nonexistent venue';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-10-11 00:00+00', '2026-10-10 00:00+00', 'bad range');
    raise exception '[SG2-44:backwards-block-window] [FAILURE] Backwards unavailability range accepted';
  exception when check_violation then null;
  end;
end $$;

-- Access changes as soon as the server revokes an internal role.
set local role service_role;
update public.account_roles set role = 'attendee'
  where user_id = 'a0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.venue_bookings) or exists (select 1 from public.venue_unavailability) then
    raise exception '[SG2-44:revoked-role-access] [SG2-44:AC3] [CONFLICT] Revoked internal access must take effect with the same identity';
  end if;
end $$;
reset role;

rollback;
