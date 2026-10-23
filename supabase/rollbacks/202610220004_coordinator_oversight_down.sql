-- Rollback for 202610220004_coordinator_oversight.sql (SG2-89).
--
-- Restores the database to how it was before that migration, so it can be
-- applied again later:
--   * internal_work_items goes back to SG2-67's body (copied verbatim from
--     202610220002_event_cancellation.sql), so events awaiting the
--     organiser's clarification leave the coordinator's work queue again.
--   * events.coordinator_assigned_by, its index and the
--     events_assigner_needs_coordinator check are dropped.
--
-- Not undone (data, not schema): which Lead supervised each event is lost
-- with the column. Every assignment is still in the event's history, which is
-- what the migration backfills from, so re-applying it restores supervision
-- for every assignment recorded there. Coordinators reassigned while the
-- event awaited clarification keep their assignment. Rehearse it first inside
-- BEGIN ... ROLLBACK on a live database.
--
-- Not a migration: keep it out of supabase/migrations, where every file is
-- applied in order.
begin;

-- SG2-67's internal_work_items, verbatim.
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
    'venue_requirements', e.venue_requirements, 'preferred_layout', e.preferred_layout,
    'accessibility_needs', e.accessibility_needs,
    'equipment_requirements', e.equipment_requirements, 'registration_needed', e.registration_needed,
    'registration_capacity', e.registration_capacity, 'registration_opens_at', e.registration_opens_at,
    'registration_closes_at', e.registration_closes_at, 'planning_notes', e.planning_notes,
    'expected_crowd_movement', e.expected_crowd_movement,
    'cancellation_requested_at', e.cancellation_requested_at, 'cancellation_reason', e.cancellation_reason) as details
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
where (r.status = 'pending' or (r.status = 'approved' and exists (
  select 1 from public.equipment_reservations receipt where receipt.request_id = r.request_id))) and e.status in ('unassigned', 'submitted', 'under_review', 'approved',
  'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed');
-- Replacing a view keeps its privileges; restated here, as SG2-49 did, so the
-- rule stays visible at the point that last replaces the view.
revoke all on public.internal_work_items from public, anon, authenticated;
grant select on public.internal_work_items to service_role;

drop index if exists public.events_coordinator_assigned_by_idx;
alter table public.events
  drop constraint if exists events_assigner_needs_coordinator,
  drop column if exists coordinator_assigned_by;
commit;
