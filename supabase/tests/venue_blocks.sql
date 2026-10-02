-- Review trace: original PR #45.
-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- Run after the migrations in a disposable/development database as postgres.
-- Test records are rolled back. Never run against production.
--
-- Covers SG2-45 acceptance: only Venue Staff block a venue from use (insert
-- into venue_unavailability) or remove a block (delete); other internal and
-- external roles cannot write directly; a period holding a confirmed booking
-- cannot be blocked by anyone, while a held booking or a free period can.
-- Conflicts below use committed fixture state within one transaction. They
-- do not establish safety between two simultaneous booking/block requests.
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
    raise exception '[SG2-45:free-and-held-periods] [SG2-45:AC1] [NORMAL] Venue staff could not block a free or held period';
  end if;
  if not exists (select 1 from public.venue_unavailability where venue_id = 900
      and starts_at = '2026-10-20 09:00+00' and ends_at = '2026-10-20 17:00+00'
      and reason = 'Carpet replacement') then
    raise exception '[SG2-45:create-block] [SG2-45:AC1] [NORMAL] Free-period block must retain its venue, period and reason';
  end if;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-10-01 16:00+00', '2026-10-01 18:00+00', 'Over a confirmed booking');
    raise exception '[SG2-45:confirmed-booking-overlap] [SG2-45:AC2] [CONFLICT] A period holding a confirmed booking was blocked';
  exception when exclusion_violation then null;
  end;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-10-01 08:00+00', '2026-10-01 09:00:00.000001+00', 'One microsecond from the left');
    raise exception '[SG2-45:overlap-start-edge] [SG2-45:AC2] [BOUNDARY] A block extending one microsecond past booking start must be rejected';
  exception when exclusion_violation then null;
  end;
  -- Touching intervals do not overlap: the booking ends as the block starts.
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
    values (900, '2026-10-01 17:00+00', '2026-10-01 18:00+00', 'Right after the booking');
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
    values (900, '2026-10-01 08:00+00', '2026-10-01 09:00+00', 'Right before the booking');
  if (select count(*) from public.venue_unavailability where venue_id = 900
      and reason in ('Right before the booking', 'Right after the booking')) <> 2 then
    raise exception '[SG2-45:touching-booking-edges] [SG2-45:AC2] [BOUNDARY] Blocks ending at booking start or starting at booking end must persist';
  end if;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-10-01 16:59:59.999999+00', '2026-10-01 18:00+00', 'One microsecond overlap');
    raise exception '[SG2-45:overlap-edge] [SG2-45:AC2] [BOUNDARY] A one-microsecond confirmed-booking overlap must be rejected';
  exception when exclusion_violation then null;
  end;
  delete from public.venue_unavailability where reason in ('Carpet replacement', 'Over a held booking', 'Right after the booking', 'Right before the booking');
  if (select count(*) from public.venue_unavailability where venue_id = 900) <> 1 then
    raise exception '[SG2-45:remove-block] [SG2-45:AC3] [NORMAL] Venue staff could not remove a block directly';
  end if;
  begin
    update public.venue_unavailability set ends_at = '2026-10-12 00:00+00' where venue_id = 900;
    raise exception '[SG2-45:direct-block-update] [FAILURE] Venue staff could update a block directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Every other signed-in role: cannot block or remove a block directly.
do $$
declare
  caller uuid;
  removed_rows integer;
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
      raise exception '[SG2-45:non-staff-insert] [SG2-45:AC1] [FAILURE] Role of % could block a venue directly', caller;
    exception when insufficient_privilege then null;
    end;
    -- A delete outside the row-matching policy silently removes zero rows
    -- rather than raising, so assert the targeted row survives instead.
    delete from public.venue_unavailability where venue_id = 900;
    get diagnostics removed_rows = row_count;
    if removed_rows <> 0 then
      raise exception '[SG2-45:non-staff-delete] [SG2-45:AC3] [FAILURE] Role of % removed a block directly', caller;
    end if;
  end loop;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.venue_unavailability where venue_id = 900) <> 1 then
    raise exception '[SG2-45:non-staff-delete-state] [SG2-45:AC3] [FAILURE] A role other than venue staff removed a block directly';
  end if;
end $$;

-- Anonymous: no write access at all.
set local role anon;
do $$
begin
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-11-01 09:00+00', '2026-11-01 10:00+00', 'Not allowed');
    raise exception '[SG2-45:anonymous-block-insert] [SG2-45:AC1] [FAILURE] Anonymous caller could block a venue';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.venue_unavailability;
    raise exception '[SG2-45:anonymous-block-delete] [SG2-45:AC3] [FAILURE] Anonymous caller could remove a block';
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
    raise exception '[SG2-45:privileged-overlap-insert] [SG2-45:AC2] [CONFLICT] A privileged insert blocked a confirmed booking';
  exception when exclusion_violation then null;
  end;
  begin
    update public.venue_unavailability set starts_at = '2026-10-01 12:00+00' where venue_id = 900;
    raise exception '[SG2-45:privileged-overlap-update] [SG2-45:AC2] [CONFLICT] An update moved a block over a confirmed booking';
  exception when exclusion_violation then null;
  end;
  if not exists (select 1 from public.venue_unavailability where venue_id = 900
      and starts_at = '2026-10-10 00:00+00' and ends_at = '2026-10-11 00:00+00'
      and reason = 'Scheduled maintenance') then
    raise exception '[SG2-45:failed-change-isolation] [SG2-45:AC2] [CONFLICT] Rejected block changes must preserve the original period and reason';
  end if;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-12-01 09:00+00', '2026-12-01 09:00+00', 'Empty period');
    raise exception '[SG2-45:empty-period] [BOUNDARY] Equal start and end must be rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (999, '2026-12-01 09:00+00', '2026-12-01 10:00+00', 'Unknown venue');
    raise exception '[SG2-45:venue-reference] [FAILURE] A block must reference an existing venue';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
      values (900, '2026-12-01 09:00+00', '2026-12-01 10:00+00', null);
    raise exception '[SG2-45:required-reason] [SG2-45:AC1] [FAILURE] A block must have a reason';
  exception when not_null_violation then null;
  end;
end $$;

rollback;
