-- Optional development seed data. NOT a migration and NOT run by CI.
-- Run it by hand (Supabase SQL Editor or psql) against a development project to
-- give the venue availability view something to show. Safe to re-run: it clears
-- the rows it owns first. Never run against production.
begin;

-- Booking requests (and their capacity exceptions) go with their event.
delete from public.events where name like 'Demo · %';
delete from public.venue_bookings
  where venue_id in (select venue_id from public.venues where name like 'Demo · %');
delete from public.venue_unavailability
  where venue_id in (select venue_id from public.venues where name like 'Demo · %');
delete from public.venues where name like 'Demo · %';

with seeded as (
  insert into public.venues (name, location, capacity, facilities, accessibility_features)
  values
    ('Demo · Atrium Hall',  'Level 1, North Wing', 400, 'Stage, PA, projection', 'Step-free, hearing loop'),
    ('Demo · Seminar Room A', 'Level 3, East Wing',  60, 'Whiteboards, screen',    'Step-free'),
    ('Demo · Rooftop Terrace', 'Level 12',           120, 'Bar, outdoor power',     'Lift access')
  returning venue_id, name
)
insert into public.venue_bookings (venue_id, starts_at, ends_at, status)
select venue_id, starts_at, ends_at, status
from seeded
cross join lateral (
  values
    ('2026-10-06T09:00:00+00'::timestamptz, '2026-10-06T17:00:00+00'::timestamptz, 'confirmed'),
    ('2026-10-13T13:00:00+00'::timestamptz, '2026-10-13T16:00:00+00'::timestamptz, 'held'),
    ('2026-10-21T18:00:00+00'::timestamptz, '2026-10-21T22:00:00+00'::timestamptz, 'confirmed')
) as b(starts_at, ends_at, status)
where seeded.name <> 'Demo · Rooftop Terrace' or b.status = 'confirmed';

insert into public.venue_unavailability (venue_id, starts_at, ends_at, reason)
select venue_id, '2026-10-27T00:00:00+00'::timestamptz, '2026-10-29T00:00:00+00'::timestamptz, 'Scheduled maintenance'
from public.venues
where name = 'Demo · Atrium Hall';

-- SG2-47: an approved event too big for two of the demo venues, with a
-- pending booking request for each, so venue suitability warnings and
-- capacity exceptions can be tried before SG2-48 lets coordinators raise
-- requests. Uses the first seeded organiser and coordinator accounts; skipped
-- if either is missing.
insert into public.events (organiser_id, coordinator_id, organisation, name, purpose, proposed_date,
  expected_attendance, venue_requirements, accessibility_needs, status)
select organiser.user_id, coordinator.user_id, u.organisation, 'Demo · Suitability Forum',
  'Try venue suitability warnings', '2026-11-12T01:00:00+00', 150,
  'A stage, a projector and a PA system', 'Step-free entry and a hearing loop', 'approved'
from (select user_id from public.account_roles where role = 'event_organiser' order by user_id limit 1) organiser
cross join (select user_id from public.account_roles where role = 'event_coordinator' order by user_id limit 1) coordinator
join public.users u on u.user_id = organiser.user_id;

-- Lecture Theatre (120) has every facility but is too small: it needs a
-- capacity exception. Rooftop Terrace lacks a stage, projector and PA: booking
-- is blocked. Atrium Hall fits. Each request stays pending for Venue Staff.
insert into public.venues (name, location, capacity, facilities, accessibility_features)
values ('Demo · Lecture Theatre', 'Level 2, South Wing', 120, 'Stage, projector, PA', 'Step-free, hearing loop');

insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, notes)
select e.event_id, v.venue_id, '2026-11-12T01:00:00+00', '2026-11-12T09:00:00+00', 'Demo request for SG2-47'
from public.events e
cross join public.venues v
where e.name = 'Demo · Suitability Forum'
  and v.name in ('Demo · Atrium Hall', 'Demo · Lecture Theatre', 'Demo · Rooftop Terrace');

commit;
