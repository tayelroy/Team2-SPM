-- SG2-98: current reads, edits, availability and removal of retained old records.
-- Disposable current-schema PostgreSQL only; every fixture change rolls back.
-- The fixed rows represent already-stored records with unknown recorder/time.
-- Suppress origin triggers only while arranging that historical starting state;
-- restore them before every operation whose current behavior is asserted.
begin;
set local session_replication_role = replica;
insert into auth.users (id) values
  ('d9800000-0000-4000-8000-000000000001'),  -- venue_staff
  ('d9800000-0000-4000-8000-000000000002'),  -- event_coordinator
  ('d9800000-0000-4000-8000-000000000003');  -- event_organiser
insert into public.users (user_id, name, role_id) values
  ('d9800000-0000-4000-8000-000000000001', 'Vince Staff', 3),
  ('d9800000-0000-4000-8000-000000000002', 'Cora Coordinator', 2),
  ('d9800000-0000-4000-8000-000000000003', 'Otto Organiser', 1);
insert into public.account_roles (user_id, role) values
  ('d9800000-0000-4000-8000-000000000001', 'venue_staff'),
  ('d9800000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('d9800000-0000-4000-8000-000000000003', 'event_organiser');

insert into public.venues (venue_id, name) values (9801, 'Legacy Hall'), (9802, 'Quiet Room');
insert into public.events (event_id, organiser_id, coordinator_id, name, status) values
  (98101, 'd9800000-0000-4000-8000-000000000003', 'd9800000-0000-4000-8000-000000000002', 'Alumni Dinner', 'confirmed'),
  (98102, 'd9800000-0000-4000-8000-000000000003', 'd9800000-0000-4000-8000-000000000002', 'Planning Workshop', 'planning');

-- Blocks as SG2-45 wrote them: an upcoming one, one ending as a booking
-- starts, and one that has already ended.
insert into public.venue_unavailability (unavailability_id, venue_id, starts_at, ends_at, reason) values
  (98201, 9801, '2031-05-10 00:00+00', '2031-05-12 00:00+00', 'Scheduled maintenance'),
  (98202, 9801, '2031-05-20 09:00+00', '2031-05-20 17:00+00', 'Carpet replacement'),
  (98203, 9802, '2020-01-01 00:00+00', '2020-01-02 00:00+00', 'Past repair');

-- 98301 was written after block 98201 and inside it; 98302 starts as block
-- 98202 ends.
insert into public.venue_bookings (booking_id, venue_id, event_id, starts_at, ends_at, status) values
  (98301, 9801, 98101, '2031-05-11 09:00+00', '2031-05-11 17:00+00', 'confirmed'),
  (98302, 9801, null,  '2031-05-20 17:00+00', '2031-05-20 19:00+00', 'confirmed');


insert into public.venue_booking_disruptions(unavailability_id,booking_id) values(98201,98301);
set local session_replication_role = origin;

do $$
begin
  -- An edit to an old block cannot invent who recorded it.
  update public.venue_unavailability set created_by = 'd9800000-0000-4000-8000-000000000001', created_at = now()
    where unavailability_id = 98203;
  if (select created_by is not null or created_at is not null from public.venue_unavailability where unavailability_id = 98203) is distinct from false then
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
    or item->>'unavailability_id' IS DISTINCT FROM '98201' or item->>'category' IS DISTINCT FROM 'other' or item->>'reason' IS DISTINCT FROM 'Scheduled maintenance'
    or item->>'created_by_name' is not null or item->>'created_at' is not null
    or item#>>'{affected,0,event_name}' IS DISTINCT FROM 'Alumni Dinner' or item#>>'{affected,0,event_status}' IS DISTINCT FROM 'confirmed' then
    raise exception '[SG2-98:list-legacy-block] [SG2-98:AC3] [NORMAL] Venue Staff must see an old block with its reason, unknown recorder and affected event';
  end if;
  if jsonb_array_length(public.list_venue_unavailability(9802, '2026-01-01 00:00+00')) IS DISTINCT FROM 0 then
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
