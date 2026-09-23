-- SG2-41: pending requests are separate from confirmed bookings/reservations.
-- Decision and request-creation workflows can write these records through
-- privileged server operations; this story exposes only a read-only queue.
begin;

create table public.venue_booking_requests (
  request_id bigserial primary key,
  event_id integer not null references public.events(event_id) on delete cascade,
  venue_id integer not null references public.venues(venue_id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  notes text,
  check (ends_at > starts_at)
);

create table public.equipment_requests (
  request_id bigserial primary key,
  event_id integer not null references public.events(event_id) on delete cascade,
  equipment_id integer not null references public.equipment(equipment_id),
  quantity integer not null check (quantity > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  notes text,
  check (ends_at > starts_at)
);

create index venue_booking_requests_pending_idx on public.venue_booking_requests (event_id) where status = 'pending';
create index equipment_requests_pending_idx on public.equipment_requests (event_id) where status = 'pending';
create index events_coordinator_status_idx on public.events (coordinator_id, status);

alter table public.venue_booking_requests enable row level security;
alter table public.venue_booking_requests force row level security;
alter table public.equipment_requests enable row level security;
alter table public.equipment_requests force row level security;
revoke all on public.venue_booking_requests, public.equipment_requests from public, anon, authenticated;
revoke all on sequence public.venue_booking_requests_request_id_seq, public.equipment_requests_request_id_seq from public, anon, authenticated;
grant select, insert, update, delete on public.venue_booking_requests, public.equipment_requests to service_role;
grant usage, select on sequence public.venue_booking_requests_request_id_seq, public.equipment_requests_request_id_seq to service_role;

-- Only service_role may read this view. The API further constrains audience
-- and coordinator assignment from the verified caller, including detail reads.
create view public.internal_work_items as
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
    'expected_attendance', e.expected_attendance, 'venue_requirements', e.venue_requirements,
    'accessibility_needs', e.accessibility_needs, 'notes', r.notes)
from public.venue_booking_requests r
join public.events e on e.event_id = r.event_id
join public.venues v on v.venue_id = r.venue_id
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

revoke all on public.internal_work_items from public, anon, authenticated;
grant select on public.internal_work_items to service_role;

commit;
