-- SG2-98 AC3 upgrade fixture. Run as postgres on a disposable database that
-- has the migrations before 202610100001_venue_temporary_unavailability.sql
-- and none after, then run the remaining migrations and
-- supabase/tests/venue_block_upgrade.sql. Never run against production.
--
-- Writes the venue blocks SG2-45 recorded before SG2-80 changed the table:
-- a period and a free-text reason, with no category, recorder or time. The
-- SG2-45 trigger only checked a new block, so a confirmed booking written
-- afterwards could still land inside one; that pair is seeded here too.
begin;

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

commit;
