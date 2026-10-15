-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Upgrade suite: run only on the disposable database prepared by
-- supabase/tests/fixtures/legacy_venue_blocks.sql (see the database-tests job
-- in .github/workflows/ci.yml). Test records are rolled back. Never run
-- against production.
--
-- Covers SG2-98 (remediation of SG2-45 AC2 for Week 7 change #2): blocks
-- recorded under SG2-45 survive SG2-80's migration as venue unavailability
-- records (AC3), a period holding a confirmed booking is now accepted and the
-- booking flagged (AC1), and SG2-45 AC1 and AC3 still hold for those blocks
-- (AC2).
begin;

-- AC3: every old block is still there, unchanged, filed under 'other', with
-- no recorder or time invented for it.
do $$
begin
  if (select count(*) from public.venue_unavailability where (unavailability_id, venue_id, starts_at, ends_at, reason) in (
      (98201, 9801, '2031-05-10 00:00+00'::timestamptz, '2031-05-12 00:00+00'::timestamptz, 'Scheduled maintenance'),
      (98202, 9801, '2031-05-20 09:00+00'::timestamptz, '2031-05-20 17:00+00'::timestamptz, 'Carpet replacement'),
      (98203, 9802, '2020-01-01 00:00+00'::timestamptz, '2020-01-02 00:00+00'::timestamptz, 'Past repair'))) <> 3 then
    raise exception '[SG2-98:legacy-blocks-kept] [SG2-98:AC3] [NORMAL] Every block recorded before SG2-80 must keep its venue, period and reason';
  end if;
  if exists (select 1 from public.venue_unavailability where unavailability_id in (98201, 98202, 98203) and category <> 'other') then
    raise exception '[SG2-98:legacy-reason-other] [SG2-98:AC3] [NORMAL] A block recorded before SG2-80 must be filed under the reason other';
  end if;
  if exists (select 1 from public.venue_unavailability where unavailability_id in (98201, 98202, 98203)
      and (created_by is not null or created_at is not null)) then
    raise exception '[SG2-98:legacy-recorder-unknown] [SG2-98:AC3] [BOUNDARY] The recorder and time of an old block must stay unknown, not be filled in by the upgrade';
  end if;
end $$;

-- AC1/AC3: the confirmed booking already inside an old block is flagged by
-- the upgrade and kept; one that only touches a block is not flagged.
do $$
begin
  if not exists (select 1 from public.venue_booking_disruptions where unavailability_id = 98201 and booking_id = 98301) then
    raise exception '[SG2-98:legacy-overlap-flagged] [SG2-98:AC1] [SG2-98:AC3] [CONFLICT] A confirmed booking inside an old block must be flagged by the upgrade';
  end if;
  if (select status from public.venue_bookings where booking_id = 98301) <> 'confirmed'
    or (select status from public.events where event_id = 98101) <> 'confirmed' then
    raise exception '[SG2-98:legacy-overlap-kept] [SG2-98:AC1] [NORMAL] A booking inside an old block and its event must stay confirmed';
  end if;
  if exists (select 1 from public.venue_booking_disruptions where booking_id = 98302) then
    raise exception '[SG2-98:legacy-touching-not-flagged] [SG2-98:AC3] [BOUNDARY] A booking starting as an old block ends must not be flagged';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'venue_unavailability_refuse_confirmed_overlap')
    or to_regprocedure('public.venue_unavailability_refuse_confirmed_overlap()') is not null then
    raise exception '[SG2-98:old-refusal-removed] [SG2-98:AC1] [SG2-98:AC4] [CONFLICT] The SG2-45 refusal of blocks over confirmed bookings must no longer exist';
  end if;
  -- An edit to an old block cannot invent who recorded it.
  update public.venue_unavailability set created_by = 'd9800000-0000-4000-8000-000000000001', created_at = now()
    where unavailability_id = 98203;
  if (select created_by is not null or created_at is not null from public.venue_unavailability where unavailability_id = 98203) then
    raise exception '[SG2-98:legacy-recorder-not-backfilled] [SG2-98:AC3] [CONFLICT] An edit to an old block must not set who recorded it or when';
  end if;
end $$;

-- Venue Staff see old blocks like any other unavailability record.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd9800000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"d9800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare
  listed jsonb := public.list_venue_unavailability(9801, '2031-01-01 00:00+00');
  item jsonb := listed->0;
begin
  if jsonb_array_length(listed) <> 2
    or item->>'unavailability_id' <> '98201' or item->>'category' <> 'other' or item->>'reason' <> 'Scheduled maintenance'
    or item->>'created_by_name' is not null or item->>'created_at' is not null
    or item#>>'{affected,0,event_name}' <> 'Alumni Dinner' or item#>>'{affected,0,event_status}' <> 'confirmed' then
    raise exception '[SG2-98:list-legacy-block] [SG2-98:AC3] [NORMAL] Venue Staff must see an old block with its reason, unknown recorder and affected event';
  end if;
  if jsonb_array_length(public.list_venue_unavailability(9802, '2026-01-01 00:00+00')) <> 0 then
    raise exception '[SG2-98:legacy-ended-not-listed] [SG2-98:AC3] [BOUNDARY] An old block that has ended must be kept but not listed as upcoming';
  end if;
end $$;

-- SG2-45 AC1 still holds: an old block keeps the venue unavailable, so a hold
-- cannot be placed in it.
do $$
begin
  if public.create_venue_hold(98102, 9801, '2031-05-10 10:00+00', '2031-05-10 12:00+00', clock_timestamp() + interval '2 days')->>'outcome'
      is distinct from 'conflict' then
    raise exception '[SG2-98:legacy-block-unavailable] [SG2-98:AC2] [CONFLICT] An old block must keep the venue unavailable for its period';
  end if;
end $$;

-- AC1: on the upgraded database, Venue Staff block a period holding a
-- confirmed booking; it is accepted and the booking flagged.
do $$
declare
  period bigint;
begin
  insert into public.venue_unavailability (venue_id, starts_at, ends_at, category, reason)
    values (9801, '2031-05-20 17:30+00', '2031-05-20 18:30+00', 'maintenance', 'Lights replaced over a booking')
    returning unavailability_id into period;
  if not exists (select 1 from public.venue_booking_disruptions where unavailability_id = period and booking_id = 98302) then
    raise exception '[SG2-98:block-over-booking-accepted] [SG2-98:AC1] [NORMAL] Blocking a period holding a confirmed booking must be accepted and flag the booking';
  end if;
end $$;

-- SG2-45 AC3 still holds for an old block; other roles still cannot remove one.
do $$
declare
  removed integer;
begin
  perform set_config('request.jwt.claim.sub', 'd9800000-0000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claims', '{"sub":"d9800000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  delete from public.venue_unavailability where unavailability_id = 98201;
  get diagnostics removed = row_count;
  if removed <> 0 then
    raise exception '[SG2-98:legacy-remove-staff-only] [SG2-98:AC2] [FAILURE] Only Venue Staff may remove an old block';
  end if;

  perform set_config('request.jwt.claim.sub', 'd9800000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"d9800000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  delete from public.venue_unavailability where unavailability_id = 98201;
  get diagnostics removed = row_count;
  if removed <> 1 or exists (select 1 from public.venue_booking_disruptions where booking_id = 98301)
    or not exists (select 1 from public.venue_bookings where booking_id = 98301 and status = 'confirmed')
    or public.create_venue_hold(98102, 9801, '2031-05-10 10:00+00', '2031-05-10 12:00+00', clock_timestamp() + interval '2 days')->>'outcome'
      is distinct from 'created' then
    raise exception '[SG2-98:legacy-remove-restores] [SG2-98:AC2] [NORMAL] Removing an old block must make the venue available again and clear its flag';
  end if;
end $$;
reset role;

rollback;
