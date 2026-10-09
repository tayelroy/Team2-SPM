-- SG2-100 Unit 2: submission now lands in `unassigned`, so `submitted`
-- means one thing only — a coordinator is assigned and has not yet opened
-- the request.
--
-- This is a separate file from 202610060001 on purpose: Postgres refuses to
-- *use* an enum value added in the same transaction that added it, so the
-- four new values could only be declared there and can only be read here.
begin;

-- Rows submitted before this story carry `submitted` with no coordinator,
-- which under the new vocabulary would read as "assigned, awaiting review"
-- — false for every one of them. Move them to the status that is true.
update public.events
set status = 'unassigned'
where status = 'submitted'
  and coordinator_id is null;

-- The coordinator work queue recognised exactly the five pre-Week-7 live
-- statuses. Without widening it, an `unassigned` request would vanish from
-- the queue the Event Coordinator Lead assigns from, and an event in safety
-- check or preparation would vanish from its own coordinator's list.
--
-- `completed` and `cancelled` are deliberately absent from every branch:
-- that is what keeps a completed event out of the active work list
-- (SG2-100 AC4) without a status exclusion to maintain.
--
-- Rebuilt from SG2-53's body (202610080001_equipment_requirements.sql), which
-- itself carries SG2-49's `venue_holds` join and `hold_id` detail. Both ran
-- first by filename order and this file replaces their view, so the venue
-- hold detail and SG2-53's equipment arrangement, shortfall, placement and
-- version details must all survive the widening below — dropping any of them
-- here would silently undo that story.
--
-- An event item's `ends_at` is the event's end time: the latest of its
-- confirmed venue bookings, the same rule `completeEvent` enforces. The
-- coordinator's work queue reads it to offer Mark as Completed only once the
-- event has been held (SG2-100 AC4); null means no confirmed booking, which
-- reads as "not finished".
create or replace view public.internal_work_items as
select 'event'::text as kind, e.event_id::bigint as item_id, e.event_id,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as title,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as event_name,
  e.status::text as status, e.proposed_date as starts_at,
  (select max(b.ends_at) from public.venue_bookings b
    where b.event_id = e.event_id and b.status = 'confirmed') as ends_at,
  'event_coordinator'::text as audience, e.coordinator_id as assigned_to,
  case when e.status in ('unassigned', 'submitted', 'under_review') then 'review' else 'assigned' end as category,
  jsonb_build_object('organisation', e.organisation, 'purpose', e.purpose,
    'description', e.description, 'expected_attendance', e.expected_attendance,
    'venue_requirements', e.venue_requirements, 'accessibility_needs', e.accessibility_needs,
    'equipment_requirements', e.equipment_requirements, 'registration_needed', e.registration_needed) as details
from public.events e
where e.status in ('unassigned', 'submitted', 'under_review')
  or (e.coordinator_id is not null and e.status in
      ('approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed'))
union all
select 'venue', r.request_id, e.event_id, v.name::text,
  coalesce(nullif(e.name, ''), 'Untitled event')::text,
  r.status, r.starts_at, r.ends_at, 'venue_staff', null::uuid, 'venue',
  jsonb_build_object('location', v.location, 'capacity', v.capacity,
    'expected_attendance', e.expected_attendance,
    'venue_requirements', coalesce(r.venue_requirements, e.venue_requirements),
    'accessibility_needs', e.accessibility_needs, 'notes', r.notes,
    'layout', r.layout, 'requested_by', u.name, 'hold_id', h.hold_id)
from public.venue_booking_requests r
join public.events e on e.event_id = r.event_id
join public.venues v on v.venue_id = r.venue_id
left join public.users u on u.user_id = r.requested_by
left join public.venue_holds h on h.request_id = r.request_id
where r.status = 'pending' and e.status in ('unassigned', 'submitted', 'under_review', 'approved',
  'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed')
union all
select 'equipment', r.request_id, e.event_id, q.name::text,
  coalesce(nullif(e.name, ''), 'Untitled event')::text,
  r.status, coalesce(r.starts_at, e.proposed_date), r.ends_at, 'technical_support_staff', null::uuid, 'equipment',
  jsonb_build_object('quantity', r.quantity, 'equipment_requirements', e.equipment_requirements,
    'notes', r.notes, 'arrangement_notes', r.arrangement_notes, 'shortfall', r.shortfall,
    'placement_venue_id', r.placement_venue_id, 'placement_venue_name', placement.name,
    'placement_position', r.placement_position, 'version', r.version)
from public.equipment_requests r
join public.events e on e.event_id = r.event_id
join public.equipment q on q.equipment_id = r.equipment_id
left join public.venues placement on placement.venue_id = r.placement_venue_id
where r.status = 'pending' and e.status in ('unassigned', 'submitted', 'under_review', 'approved',
  'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed');
-- Replacing a view keeps its privileges; restated here, as SG2-49 did, so the
-- rule stays visible at the point that last replaces the view.
revoke all on public.internal_work_items from public, anon, authenticated;
grant select on public.internal_work_items to service_role;

commit;
