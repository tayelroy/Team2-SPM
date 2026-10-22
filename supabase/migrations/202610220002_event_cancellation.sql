-- SG2-67: the Event Organiser asks for a cancellation with a reason, and only
-- the assigned Event Coordinator carries it out.
-- AC1: request_event_cancellation() (the creating organiser) and cancel_event()
-- (the assigned coordinator) are the only ways in; both recheck the acting role
-- (SG2-104). Authenticated callers have no write access to events, so nobody
-- can set the status directly.
-- AC2: cancel_event() releases the event's held and confirmed venue bookings
-- that have not ended, as SG2-51 does for one, releases its tentative holds
-- (cancelling their requests) and cancels its other pending venue and
-- equipment requests; SG2-56's trigger releases the equipment when the
-- status moves into cancelled.
-- AC3: every registered attendee, and the organiser, gets an event_cancelled
-- notice in the SG2-69 inbox.
-- AC4: the reason, who asked and when, and who cancelled and when stay on the
-- event, and each step is in its history.
-- AC5: a trigger stops a cancelled event's status from ever changing again.
-- The coordinator's work queue shows the request (internal_work_items).
begin;

alter table public.events
  add column cancellation_requested_at timestamptz,
  add column cancellation_requested_by uuid references public.users(user_id) on delete set null,
  add column cancellation_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.users(user_id) on delete set null,
  add constraint events_cancellation_request_recorded
    check ((cancellation_requested_at is null) = (cancellation_reason is null)),
  add constraint events_cancellation_reason_valid
    check (cancellation_reason is null or (btrim(cancellation_reason) <> '' and char_length(cancellation_reason) <= 500)),
  add constraint events_cancelled_recorded
    check (cancelled_at is null or (status = 'cancelled' and cancellation_reason is not null));

-- Adds the two kinds to whatever list is already allowed, as SG2-63 did, so
-- no earlier or concurrently added kind is lost.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['cancellation_requested', 'event_cancelled']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- AC1: the creating organiser asks once, with a reason. A draft is deleted
-- instead (SG2-32); a completed or cancelled event cannot be cancelled.
create function public.request_event_cancellation(p_event_id integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  reason text := nullif(btrim(p_reason), '');
  e public.events;
  instant timestamptz;
begin
  if caller is null or public.lock_acting_role() is distinct from 'event_organiser' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_event_id is null or p_event_id <= 0 or reason is null or char_length(reason) > 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  select * into e from public.events where event_id = p_event_id for update;
  if not found or e.organiser_id is distinct from caller then
    return jsonb_build_object('outcome', 'missing');
  end if;
  -- A rejected event will not happen anyway, so there is nothing to cancel.
  if e.status in ('draft', 'completed', 'cancelled', 'rejected') then
    return jsonb_build_object('outcome', 'closed', 'status', e.status);
  end if;
  if e.cancellation_requested_at is not null then
    return jsonb_build_object('outcome', 'requested', 'cancellation_requested_at', e.cancellation_requested_at);
  end if;

  instant := clock_timestamp();
  update public.events
    set cancellation_requested_at = instant, cancellation_requested_by = caller, cancellation_reason = reason
    where event_id = e.event_id;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (e.event_id, caller, 'cancellation_request', null, 'Requested: ' || reason);
  -- The assigned coordinator is told; an event still waiting for one keeps
  -- the request for whoever is assigned.
  if e.coordinator_id is not null then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (e.coordinator_id, e.event_id, 'cancellation_requested',
        'The organiser asked to cancel ' || left(coalesce(nullif(e.name, ''), 'Untitled event'), 200) || ': ' || reason);
  end if;
  return jsonb_build_object('outcome', 'ok', 'event_id', e.event_id, 'cancellation_requested_at', instant,
    'coordinator_notified', e.coordinator_id is not null);
end;
$$;
revoke all on function public.request_event_cancellation(integer, text) from public, anon;
grant execute on function public.request_event_cancellation(integer, text) to authenticated;

-- AC1-AC4: the assigned coordinator carries out an outstanding request.
create function public.cancel_event(p_event_id integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  e public.events;
  instant timestamptz;
  released record;
  held record;
  bookings integer := 0;
  attendees integer;
begin
  if caller is null or public.lock_acting_role() is distinct from 'event_coordinator' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_event_id is null or p_event_id <= 0 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  -- Venue, then booking, then event: the lock order release_venue_booking()
  -- and every other booking writer uses.
  perform 1 from public.venues v
    where v.venue_id in (select b.venue_id from public.venue_bookings b
        where b.event_id = p_event_id and b.status in ('held', 'confirmed')
      union select h.venue_id from public.venue_holds h
        where h.event_id = p_event_id and h.status = 'tentative')
    order by v.venue_id for update;
  perform 1 from public.venue_bookings b
    where b.event_id = p_event_id and b.status in ('held', 'confirmed')
    order by b.booking_id for update;
  select * into e from public.events where event_id = p_event_id for update;
  -- Another coordinator's event is reported as missing so it is not revealed.
  if not found or e.coordinator_id is distinct from caller then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if e.status in ('completed', 'cancelled', 'rejected') then
    return jsonb_build_object('outcome', 'closed', 'status', e.status);
  end if;
  if e.cancellation_requested_at is null then
    return jsonb_build_object('outcome', 'not_requested');
  end if;

  instant := clock_timestamp();
  -- AC2: every venue still held or booked for the event is freed, with the
  -- organiser's reason, and its committing request is no longer live.
  for released in
    update public.venue_bookings b
      set status = 'cancelled', cancelled_by = caller, cancelled_at = instant,
        cancellation_reason = left('Event cancelled: ' || e.cancellation_reason, 500)
      from public.venues v
      where b.event_id = e.event_id and b.status in ('held', 'confirmed') and b.ends_at > instant
        and v.venue_id = b.venue_id
      returning b.booking_id, v.name
  loop
    bookings := bookings + 1;
    update public.venue_booking_requests set status = 'cancelled'
      where venue_booking_id = released.booking_id and status = 'approved';
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (e.event_id, caller, 'venue_booking',
        'Booked: ' || released.name || ' (booking ' || released.booking_id || ')',
        'Released: ' || released.name || ' (booking ' || released.booking_id || ') — Event cancelled');
  end loop;

  -- AC2: a tentative hold also keeps the venue from other events, so each one
  -- is released and its request cancelled, as change_venue_hold() does.
  for held in
    update public.venue_holds h set status = 'released'
      where h.event_id = e.event_id and h.status = 'tentative'
      returning h.hold_id, h.request_id
  loop
    update public.venue_booking_requests set status = 'cancelled'
      where request_id = held.request_id and status = 'pending';
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (e.event_id, caller, 'venue_hold_status', 'Tentative hold ' || held.hold_id,
        'Released hold ' || held.hold_id || ' — Event cancelled');
  end loop;
  -- Requests still waiting for Venue Staff or Technical Support would
  -- otherwise sit in their queues for an event that will not happen.
  update public.venue_booking_requests set status = 'cancelled'
    where event_id = e.event_id and status = 'pending';
  update public.equipment_requests set status = 'cancelled'
    where event_id = e.event_id and status = 'pending';

  -- SG2-56's trigger releases the equipment in this same statement.
  update public.events
    set status = 'cancelled', cancelled_at = instant, cancelled_by = caller, venue_booking_id = null
    where event_id = e.event_id;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (e.event_id, caller, 'status', e.status::text, 'cancelled');

  -- AC3: each registered attendee once, and the organiser.
  insert into public.notifications (recipient_id, event_id, kind, message)
    select recipient, e.event_id, 'event_cancelled',
      left(coalesce(nullif(e.name, ''), 'Untitled event'), 200) || ' has been cancelled: ' || e.cancellation_reason
    from (select distinct r.attendee_id as recipient from public.registrations r
      where r.event_id = e.event_id and lower(coalesce(r.status, '')) <> 'cancelled') registered;
  get diagnostics attendees = row_count;
  insert into public.notifications (recipient_id, event_id, kind, message)
    values (e.organiser_id, e.event_id, 'event_cancelled',
      left(coalesce(nullif(e.name, ''), 'Untitled event'), 200) || ' has been cancelled: ' || e.cancellation_reason);

  return jsonb_build_object('outcome', 'ok', 'event_id', e.event_id, 'status', 'cancelled',
    'cancelled_at', instant, 'bookings_released', bookings, 'attendees_notified', attendees);
end;
$$;
revoke all on function public.cancel_event(integer) from public, anon;
grant execute on function public.cancel_event(integer) to authenticated;

-- AC5: cancellation is final, whoever writes the row.
create function public.keep_cancelled_events_cancelled()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'A cancelled event cannot be reinstated.';
end;
$$;
revoke all on function public.keep_cancelled_events_cancelled() from public, anon, authenticated;

create trigger keep_cancelled_events_cancelled before update of status on public.events
  for each row when (old.status = 'cancelled' and new.status is distinct from 'cancelled')
  execute function public.keep_cancelled_events_cancelled();

-- AC1: coordinators open their events from the work queue, so its event
-- details carry the organiser's request. Copied from SG2-105's
-- 202610200001_event_preferred_layout.sql with only the two cancellation
-- fields added; a cancelled event leaves the queue as before.
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

commit;
