-- SG2-48: an Event Coordinator requests a venue for an approved event. The
-- request carries the period, the layout the event needs and the event's
-- venue requirements as they stood when it was made (AC1), and reaches Venue
-- Staff through the internal work queue (AC2).
--
-- A pending request never writes to venue_bookings, so it does not hold the
-- venue or affect its availability; the venue is committed only when Venue
-- Staff approve the request (AC3, SG2-49).
--
-- Requests stay server-only, as SG2-41 set up: the API checks the caller is
-- the event's assigned coordinator before writing with the service role.
begin;

-- Earlier rows (seeded before this story) carry none of these, so the columns
-- are nullable; every request made through the API sets all of them.
alter table public.venue_booking_requests
  add column layout public.venue_layout,
  add column venue_requirements text,
  add column requested_by uuid references public.users(user_id),
  add column requested_at timestamptz not null default now();

-- A coordinator's request always says which layout it needs (AC1).
alter table public.venue_booking_requests
  add constraint venue_booking_requests_layout_required
  check (requested_by is null or layout is not null);

-- An event may ask for several venues, but not for the same venue twice over
-- an overlapping period while either request is still live (AC4). The API
-- checks first so it can name the earlier request; this is the backstop for a
-- coordinator submitting the same request twice at once. Rejected and
-- cancelled requests do not count, so a venue can be asked for again.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
alter table public.venue_booking_requests
  add constraint venue_booking_requests_no_duplicate
  exclude using gist (
    event_id with =,
    venue_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('pending', 'approved'));

-- Venue Staff see the layout, the requirements carried by the request and
-- who asked (AC2). Unchanged otherwise from SG2-41.
create or replace view public.internal_work_items as
select 'event'::text as kind, e.event_id::bigint as item_id, e.event_id,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as title,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as event_name,
  e.status::text as status, e.proposed_date as starts_at, null::timestamptz as ends_at,
  'event_coordinator'::text as audience, e.coordinator_id as assigned_to,
  case when e.status in ('submitted', 'under_review') then 'review' else 'assigned' end as category,
  jsonb_build_object('organisation', e.organisation, 'purpose', e.purpose,
    'description', e.description, 'expected_attendance', e.expected_attendance,
    'venue_requirements', e.venue_requirements, 'accessibility_needs', e.accessibility_needs,
    'equipment_requirements', e.equipment_requirements, 'registration_needed', e.registration_needed) as details
from public.events e
where e.status in ('submitted', 'under_review')
  or (e.coordinator_id is not null and e.status in ('approved', 'planning', 'confirmed'))
union all
select 'venue', r.request_id, e.event_id, v.name::text,
  coalesce(nullif(e.name, ''), 'Untitled event')::text,
  r.status, r.starts_at, r.ends_at, 'venue_staff', null::uuid, 'venue',
  jsonb_build_object('location', v.location, 'capacity', v.capacity,
    'expected_attendance', e.expected_attendance,
    'venue_requirements', coalesce(r.venue_requirements, e.venue_requirements),
    'accessibility_needs', e.accessibility_needs, 'notes', r.notes,
    'layout', r.layout, 'requested_by', u.name)
from public.venue_booking_requests r
join public.events e on e.event_id = r.event_id
join public.venues v on v.venue_id = r.venue_id
left join public.users u on u.user_id = r.requested_by
where r.status = 'pending' and e.status in ('submitted', 'under_review', 'approved', 'planning', 'confirmed')
union all
select 'equipment', r.request_id, e.event_id, q.name::text,
  coalesce(nullif(e.name, ''), 'Untitled event')::text,
  r.status, r.starts_at, r.ends_at, 'technical_support_staff', null::uuid, 'equipment',
  jsonb_build_object('quantity', r.quantity, 'equipment_requirements', e.equipment_requirements,
    'notes', r.notes)
from public.equipment_requests r
join public.events e on e.event_id = r.event_id
join public.equipment q on q.equipment_id = r.equipment_id
where r.status = 'pending' and e.status in ('submitted', 'under_review', 'approved', 'planning', 'confirmed');

commit;
