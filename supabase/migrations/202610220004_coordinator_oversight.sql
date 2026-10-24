-- SG2-89: the Event Coordinator Lead oversees the coordinators they assigned.
--
-- AC1: a Lead supervises the events whose coordinator they assigned. When
-- another Lead reassigns the event, supervision moves with that reassignment
-- (the latest assigner supervises). `coordinator_assigned_by` is written in
-- the same UPDATE as `coordinator_id` (server/src/db/eventRequests.ts), so
-- two Leads reassigning at once can never leave the event naming one Lead's
-- coordinator under the other Lead's supervision: the loser's guarded write
-- matches zero rows. The check below is the database backstop for the one
-- rule a write could break on its own: nobody supervises an event that has
-- no coordinator.
--
-- Existing assignments are backfilled from SG2-40's event history: the actor
-- of each event's latest `coordinator_id` entry. An event whose assignment was
-- never recorded there (seeded or assigned before the history existed) is
-- left with no supervising Lead. It is still in its coordinator's work queue
-- and on the Lead's assignment screen, and the next Lead to reassign it takes
-- over its supervision.
--
-- AC6: an event awaiting the organiser's clarification stays in its
-- coordinator's work queue. internal_work_items is replaced unchanged from
-- SG2-67's 202610220002_event_cancellation.sql except that
-- `needs_clarification` joins the review statuses.
begin;

alter table public.events
  add column coordinator_assigned_by uuid references public.users(user_id) on delete set null,
  add constraint events_assigner_needs_coordinator
    check (coordinator_assigned_by is null or coordinator_id is not null);

comment on column public.events.coordinator_assigned_by is
  'SG2-89: the Event Coordinator Lead who last assigned or reassigned this event''s coordinator, and so supervises it.';

update public.events e
set coordinator_assigned_by = latest.actor_id
from (
  select distinct on (l.event_id) l.event_id, l.actor_id
  from public.event_audit_logs l
  where l.field_name = 'coordinator_id' and l.new_value is not null
  order by l.event_id, l.created_at desc, l.log_id desc
) latest
where latest.event_id = e.event_id and e.coordinator_id is not null;

create index events_coordinator_assigned_by_idx
  on public.events (coordinator_assigned_by) where coordinator_assigned_by is not null;

create or replace view public.internal_work_items as
select 'event'::text as kind, e.event_id::bigint as item_id, e.event_id,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as title,
  coalesce(nullif(e.name, ''), 'Untitled event')::text as event_name,
  e.status::text as status, e.proposed_date as starts_at,
  (select max(b.ends_at) from public.venue_bookings b
    where b.event_id = e.event_id and b.status = 'confirmed') as ends_at,
  'event_coordinator'::text as audience, e.coordinator_id as assigned_to,
  case when e.status in ('unassigned', 'submitted', 'under_review', 'needs_clarification') then 'review' else 'assigned' end as category,
  jsonb_build_object('organisation', e.organisation, 'purpose', e.purpose,
    'description', e.description, 'expected_attendance', e.expected_attendance,
    'venue_requirements', e.venue_requirements, 'preferred_layout', e.preferred_layout,
    'accessibility_needs', e.accessibility_needs,
    'equipment_requirements', e.equipment_requirements, 'registration_needed', e.registration_needed,
    'registration_capacity', e.registration_capacity, 'registration_opens_at', e.registration_opens_at,
    'registration_closes_at', e.registration_closes_at, 'planning_notes', e.planning_notes,
    'expected_crowd_movement', e.expected_crowd_movement,
    'cancellation_requested_at', e.cancellation_requested_at, 'cancellation_reason', e.cancellation_reason) as details
from public.events e
where e.status in ('unassigned', 'submitted', 'under_review', 'needs_clarification')
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
where (r.status = 'pending' or (r.status = 'approved' and exists (
  select 1 from public.equipment_reservations receipt where receipt.request_id = r.request_id))) and e.status in ('unassigned', 'submitted', 'under_review', 'approved',
  'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed');
-- Replacing a view keeps its privileges; restated here, as SG2-49 did, so the
-- rule stays visible at the point that last replaces the view.
revoke all on public.internal_work_items from public, anon, authenticated;
grant select on public.internal_work_items to service_role;
commit;
