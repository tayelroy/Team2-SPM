-- SG2-96 capacity review: a year-3 data set for a DISPOSABLE local database only.
-- Never run against Supabase. Load after the auth fixture and every migration:
--   psql -d <disposable db> -v ON_ERROR_STOP=1 -v scale=1 -f integration/capacity-seed.sql
-- scale=1 is the year-3 estimate in docs/nfr-capacity-review.md (cumulative over
-- three years); scale=2 doubles it as head-room. Triggers are switched off for the
-- bulk load (session_replication_role = replica), so every row below is written
-- consistent by hand: one confirmed booking per venue and day, requests that match
-- their bookings, receipts that match their requests.
\set ON_ERROR_STOP on
\if :{?scale}
\else
  \set scale 1
\endif
begin;
set local session_replication_role = replica;
set local synchronous_commit = off;

create temporary table cap_size on commit drop as
select greatest(1, round(:scale * 600))::int as organisations,
  greatest(1, round(:scale * 1500))::int as organisers,
  greatest(1, round(:scale * 300))::int as coordinators,
  greatest(1, round(:scale * 200))::int as venue_staff,
  greatest(1, round(:scale * 250))::int as support,
  greatest(1, round(:scale * 20))::int as leads,
  greatest(1, round(:scale * 30))::int as safety,
  greatest(1, round(:scale * 60000))::int as attendees,
  greatest(1, round(:scale * 40))::int as venues,
  greatest(1, round(:scale * 1000))::int as equipment,
  greatest(1, round(:scale * 9500))::int as events;

-- People: one auth identity, one profile and one role row each (several roles per
-- account are allowed, SG2-104, but one is enough for load).
create temporary table cap_people on commit drop as
with plan(role, role_id, n) as (
  select 'event_organiser', 1, organisers from cap_size union all
  select 'event_coordinator', 2, coordinators from cap_size union all
  select 'venue_staff', 3, venue_staff from cap_size union all
  select 'technical_support_staff', 4, support from cap_size union all
  select 'attendee', 5, attendees from cap_size union all
  select 'event_coordinator_lead', 6, leads from cap_size union all
  select 'safety_officer', 7, safety from cap_size)
select gen_random_uuid() as user_id, p.role, p.role_id, g as n
from plan p, generate_series(1, p.n) g;
create index on cap_people (role, n);

insert into auth.users (id, email)
  select user_id, format('cap.%s.%s@capacity.test', role, n) from cap_people;
insert into public.users (user_id, name, organisation, role_id)
  select user_id, format('Capacity %s %s', replace(role, '_', ' '), n),
    case when role = 'event_organiser' then format('Client organisation %s', 1 + n % (select organisations from cap_size))
      when role = 'attendee' then null else 'ConnectSphere' end,
    role_id
  from cap_people;
insert into public.account_roles (user_id, role) select user_id, role from cap_people;

-- Venues, layouts and operations.
create temporary table cap_venues on commit drop as
with made as (
  insert into public.venues (name, location, capacity, facilities, accessibility_features, operating_information)
    select format('Capacity venue %s', g), format('Level %s, Capacity campus', 1 + g % 6), (array[40, 80, 120, 250, 500, 1200])[1 + g % 6],
      'Projector, PA system, Wi-Fi', 'Step-free access, hearing loop', '08:00-22:00'
    from generate_series(1, (select venues from cap_size)) g
    returning venue_id)
select venue_id, row_number() over (order by venue_id) as n from made;
insert into public.venue_layouts (venue_id, layout)
  select venue_id, l::public.venue_layout from cap_venues, unnest(array['classroom', 'theatre', 'banquet']) l;
insert into public.venue_operations (venue_id, setup_minutes, turnaround_minutes, emergency_access, known_restrictions)
  select venue_id, 30, 30, 'Two exits on the ground floor', null from cap_venues;

insert into public.equipment (name, quantity_total, description, location, operational_status)
  select format('Capacity equipment %s', g), 5 + g % 20, 'Load-test item', 'Store B', 'operational'
  from generate_series(1, (select equipment from cap_size)) g;

-- Events: three years around today, most finished, some in every live status.
create temporary table cap_events on commit drop as
with spread as (
  select g as n,
    -- ~2 years in the past, ~1 year ahead
    date_trunc('day', now()) - interval '730 days' + (g * 1095.0 / (select events from cap_size)) * interval '1 day' as day,
    (g * 37) % 100 as bucket
  from generate_series(1, (select events from cap_size)) g)
select n, day + interval '9 hours' - interval '8 hours' as starts_at,
  case
    when day < now() - interval '14 days' then (case when bucket < 4 then 'cancelled' when bucket < 6 then 'rejected' else 'completed' end)
    when day < now() then (case when bucket < 50 then 'completed' else 'confirmed' end)
    else (array['draft', 'unassigned', 'submitted', 'under_review', 'approved', 'planning', 'planning', 'awaiting_safety_check',
      'preparation', 'confirmed', 'confirmed', 'confirmed'])[1 + bucket % 12]
  end::public.event_status as status
from spread;

with org as (select user_id, n from cap_people where role = 'event_organiser'),
  coord as (select user_id, n from cap_people where role = 'event_coordinator')
insert into public.events (organiser_id, coordinator_id, organisation, name, purpose, description, proposed_date,
    expected_attendance, venue_requirements, equipment_requirements, registration_needed, status,
    registration_capacity, registration_opens_at, registration_closes_at, submitted_at, decided_by, decided_at, decision_reason,
    confirmed_by, confirmed_at, completed_by, completed_at, category, expected_crowd_movement)
  select o.user_id,
    case when e.status in ('draft', 'unassigned') then null else c.user_id end,
    format('Client organisation %s', 1 + o.n % (select organisations from cap_size)),
    format('%s %s', (array['Conference', 'Seminar', 'Workshop', 'Training day', 'Networking evening'])[1 + e.n % 5], e.n),
    'Capacity review event', 'Generated for the SG2-96 year-3 capacity review.', e.starts_at,
    (array[30, 60, 100, 200, 400])[1 + e.n % 5], 'Projector', 'Microphones', e.n % 10 < 7, e.status,
    case when e.n % 10 < 7 then (array[30, 60, 100, 200, 400])[1 + e.n % 5] end,
    case when e.n % 10 < 7 then e.starts_at - interval '30 days' end,
    case when e.n % 10 < 7 then e.starts_at - interval '1 day' end,
    case when e.status <> 'draft' then e.starts_at - interval '60 days' end,
    case when e.status in ('approved', 'planning', 'awaiting_safety_check', 'preparation', 'confirmed', 'completed', 'rejected') then c.user_id end,
    case when e.status in ('approved', 'planning', 'awaiting_safety_check', 'preparation', 'confirmed', 'completed', 'rejected') then e.starts_at - interval '50 days' end,
    case when e.status = 'rejected' then 'Outside the services we offer' end,
    case when e.status in ('confirmed', 'completed') then c.user_id end,
    case when e.status in ('confirmed', 'completed') then e.starts_at - interval '7 days' end,
    case when e.status = 'completed' then c.user_id end,
    case when e.status = 'completed' then e.starts_at + interval '1 day' end,
    (array['conference', 'seminar', 'workshop', 'training', 'networking'])[1 + e.n % 5],
    'Doors open 30 minutes before; one-way flow to the hall'
  from cap_events e
  join org o on o.n = 1 + (e.n * 7) % (select organisers from cap_size)
  join coord c on c.n = 1 + (e.n * 13) % (select coordinators from cap_size);

create temporary table cap_live on commit drop as
select event_id, proposed_date as starts_at, status, row_number() over (order by proposed_date, event_id) as n
from public.events
where purpose = 'Capacity review event'
  and status in ('approved', 'planning', 'awaiting_safety_check', 'preparation', 'confirmed', 'completed');

-- Venue bookings: event n books venue (n mod V) for its day; a quarter book a second
-- venue the same day (SG2-82). Same-day slots never repeat for a venue.
create temporary table cap_slots on commit drop as
select l.event_id, l.status, v.venue_id,
  date_trunc('day', l.starts_at) + interval '1 hour' as starts_at,
  date_trunc('day', l.starts_at) + interval '9 hours' as ends_at,
  k
from cap_live l
cross join lateral (select generate_series(0, case when l.n % 4 = 0 then 1 else 0 end) as k) ks
join cap_venues v on v.n = 1 + ((l.n * 2 + ks.k) % (select venues from cap_size));
delete from cap_slots a using cap_slots b
  where a.venue_id = b.venue_id and a.starts_at = b.starts_at and a.event_id > b.event_id;

create temporary table cap_bookings on commit drop as
with made as (
  insert into public.venue_bookings (venue_id, event_id, starts_at, ends_at, status)
    select venue_id, event_id, starts_at, ends_at, 'confirmed' from cap_slots
    returning booking_id, venue_id, event_id, starts_at, ends_at)
select * from made;
insert into public.venue_booking_requests (event_id, venue_id, starts_at, ends_at, status, layout, requested_by, requested_at,
    decided_by, decided_at, venue_booking_id)
  select b.event_id, b.venue_id, b.starts_at, b.ends_at, 'approved', 'classroom'::public.venue_layout, e.coordinator_id,
    b.starts_at - interval '45 days', (select user_id from cap_people where role = 'venue_staff' and n = 1), b.starts_at - interval '44 days', b.booking_id
  from cap_bookings b join public.events e using (event_id);
update public.events e set venue_booking_id = first.booking_id
  from (select distinct on (event_id) event_id, booking_id from cap_bookings order by event_id, booking_id) first
  where e.event_id = first.event_id;

-- Equipment: three requests per live event; reserved ones get a matching receipt.
create temporary table cap_requests on commit drop as
with made as (
  insert into public.equipment_requests (event_id, equipment_id, quantity, starts_at, ends_at, status, shortfall, placement_venue_id, placement_position)
    select l.event_id, (select min(equipment_id) from public.equipment) + ((l.n * 3 + k) % (select equipment from cap_size)),
      1 + k, date_trunc('day', l.starts_at) + interval '1 hour', date_trunc('day', l.starts_at) + interval '9 hours',
      case when l.status in ('approved', 'planning') and k = 2 then 'pending' else 'approved' end, 0,
      (select venue_id from cap_slots s where s.event_id = l.event_id order by s.k limit 1), 'Front of the room'
    from cap_live l, generate_series(0, 2) k
    returning request_id, event_id, equipment_id, quantity, starts_at, ends_at, status)
select * from made;
insert into public.equipment_reservations (event_id, equipment_id, quantity_reserved, starts_at, ends_at, request_id, reserved_at)
  select event_id, equipment_id, quantity, starts_at, ends_at, request_id, starts_at - interval '20 days'
  from cap_requests where status = 'approved';

-- Registrations: ~70% of confirmed and completed events, close to capacity.
insert into public.registrations (event_id, attendee_id, status, registered_at)
  select e.event_id, a.user_id, 'registered', e.registration_opens_at + (k % 29) * interval '1 day'
  from public.events e
  join cap_live l using (event_id)
  cross join lateral generate_series(0, greatest(e.registration_capacity * 9 / 10 - 1, 0)) k
  join cap_people a on a.role = 'attendee'
    and a.n = 1 + ((e.event_id::bigint * 7919 + k) % (select attendees from cap_size))
  where e.registration_needed and l.status in ('confirmed', 'completed');

-- History and notices at the rates the current workflow writes them.
insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value, created_at)
  select e.event_id, e.coordinator_id, (array['status', 'planning_notes', 'expected_attendance', 'coordinator_id', 'venue_booking'])[1 + k % 5],
    'before', 'after', e.proposed_date - (60 - k) * interval '1 day'
  from public.events e
  cross join generate_series(1, 25) k
  where e.coordinator_id is not null and e.purpose = 'Capacity review event';
insert into public.notifications (recipient_id, event_id, kind, message, created_at, read_at)
  select case when k % 2 = 0 then e.organiser_id else e.coordinator_id end, e.event_id,
    (array['event_submitted', 'coordinator_assigned', 'event_approved', 'venue_request_approved', 'clarification_requested', 'event_confirmed'])[1 + k % 6],
    'Capacity review notice', e.proposed_date - (40 - k) * interval '1 day',
    case when e.proposed_date < now() then e.proposed_date - (39 - k) * interval '1 day' end
  from public.events e
  cross join generate_series(1, 20) k
  where e.coordinator_id is not null and e.purpose = 'Capacity review event';

commit;
analyze;
select 'users' as rows, count(*) from public.users union all
select 'events', count(*) from public.events union all
select 'venues', count(*) from public.venues union all
select 'venue_bookings', count(*) from public.venue_bookings union all
select 'venue_booking_requests', count(*) from public.venue_booking_requests union all
select 'equipment', count(*) from public.equipment union all
select 'equipment_requests', count(*) from public.equipment_requests union all
select 'equipment_reservations', count(*) from public.equipment_reservations union all
select 'registrations', count(*) from public.registrations union all
select 'event_audit_logs', count(*) from public.event_audit_logs union all
select 'notifications', count(*) from public.notifications;
