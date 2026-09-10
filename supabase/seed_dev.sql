-- Optional development seed data. NOT a migration and NOT run by CI.
-- Run it by hand (Supabase SQL Editor or psql) against a development project to
-- give the venue availability view something to show. Safe to re-run: it clears
-- the rows it owns first. Never run against production.
begin;

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

commit;
