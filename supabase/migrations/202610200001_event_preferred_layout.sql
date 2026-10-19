-- SG2-105: an event request records the organiser's preferred room layout,
-- one of the customer's minimum fields (clarification session 2). The column
-- is nullable on purpose: drafts may still be saved incomplete, and requests
-- submitted before this story are left exactly as they were. Completeness is
-- enforced when a request is submitted (server/src/events/fields.ts).
--
-- The draft-save RPC from SG2-40 lists its fields explicitly, so it is
-- replaced with the same body plus `preferred_layout`: saved with the draft
-- and recorded in the change history like every other request field.
--
-- The coordinator's review panel reads internal_work_items, so the view is
-- replaced too: unchanged from SG2-91's 202610190004_safety_check_queue.sql
-- (which added expected_crowd_movement) except for `preferred_layout`.
begin;

alter table public.events
  add column preferred_layout text,
  add constraint events_preferred_layout_length check (char_length(preferred_layout) <= 5000);

create or replace function public.update_event_request_draft(
  p_event_id integer, p_actor_id uuid, p_values jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
set timezone = 'UTC'
as $function$
declare
  membership text;
  actor_role text;
  previous public.events%rowtype;
  updated public.events%rowtype;
  values_row public.events%rowtype;
  field text;
  previous_values jsonb;
  updated_values jsonb;
  saved_at timestamptz;
  fields constant text[] := array['name', 'purpose', 'description', 'proposed_date',
    'expected_attendance', 'venue_requirements', 'preferred_layout', 'accessibility_needs',
    'equipment_requirements', 'registration_needed'];
begin
  -- Keep membership/role stable until the transaction finishes, then lock the
  -- event. The event lock serializes saves and status changes (including submit).
  select ar.role into actor_role from public.account_roles ar
    where ar.user_id = p_actor_id for share;
  select u.organisation into membership from public.users u
    where u.user_id = p_actor_id for share;
  if actor_role is distinct from 'event_organiser' or membership is null
      or btrim(membership,
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select e.* into previous from public.events e
    where e.event_id = p_event_id and e.organiser_id = p_actor_id
      and e.organisation = membership for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if previous.status not in ('draft', 'needs_clarification') then
    return jsonb_build_object('outcome', 'not_editable');
  end if;

  -- The API has already normalized and validated a full replacement. Recheck
  -- the private RPC boundary: never accept status/ownership keys or wrong types.
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if exists (select 1 from jsonb_object_keys(p_values) k where not (k = any(fields))) then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  foreach field in array fields loop
    if p_values ? field and jsonb_typeof(p_values -> field) <> 'null' then
      if field = 'expected_attendance' then
        if jsonb_typeof(p_values -> field) <> 'number'
            or (p_values ->> field)::numeric <> trunc((p_values ->> field)::numeric)
            or (p_values ->> field)::numeric not between 1 and 2147483647 then
          return jsonb_build_object('outcome', 'invalid');
        end if;
      elsif field = 'registration_needed' then
        if jsonb_typeof(p_values -> field) <> 'boolean' then
          return jsonb_build_object('outcome', 'invalid');
        end if;
      elsif jsonb_typeof(p_values -> field) <> 'string'
          or (field = 'name' and char_length(p_values ->> field) > 255)
          or (field <> 'name' and char_length(p_values ->> field) > 5000) then
        return jsonb_build_object('outcome', 'invalid');
      end if;
    end if;
  end loop;
  begin
    values_row := jsonb_populate_record(null::public.events, p_values);
    if values_row.proposed_date is not null and not isfinite(values_row.proposed_date) then
      return jsonb_build_object('outcome', 'invalid');
    end if;
  exception when invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('outcome', 'invalid');
  end;

  update public.events set name = values_row.name, purpose = values_row.purpose,
    description = values_row.description, proposed_date = values_row.proposed_date,
    expected_attendance = values_row.expected_attendance,
    venue_requirements = values_row.venue_requirements,
    preferred_layout = values_row.preferred_layout,
    accessibility_needs = values_row.accessibility_needs,
    equipment_requirements = values_row.equipment_requirements,
    registration_needed = values_row.registration_needed
    where event_id = previous.event_id returning * into updated;

  previous_values := to_jsonb(previous);
  updated_values := to_jsonb(updated);
  saved_at := clock_timestamp();
  foreach field in array fields loop
    if previous_values -> field is distinct from updated_values -> field then
      insert into public.event_audit_logs(event_id, actor_id, field_name, old_value, new_value, created_at)
        values (previous.event_id, p_actor_id, field,
          previous_values ->> field, updated_values ->> field, saved_at);
    end if;
  end loop;
  -- Do not catch update/audit errors: Postgres rolls back both on any failure.
  return jsonb_build_object('outcome', 'updated', 'request',
    jsonb_build_object('event_id', updated.event_id, 'organiser_id', updated.organiser_id,
      'organisation', updated.organisation, 'status', updated.status)
    || (select jsonb_object_agg(k, updated_values -> k) from unnest(fields) k));
end;
$function$;

comment on function public.update_event_request_draft(integer, uuid, jsonb) is
  'SG2-40/SG2-105: creator draft/clarification save and per-field history commit atomically; server-verified actor only.';

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
    'expected_crowd_movement', e.expected_crowd_movement) as details
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
