-- SG2-53: equipment requirements and Technical Support arrangement updates.
-- Requests describe need; they neither reserve equipment nor promise stock.
begin;

alter table public.equipment_requests
  alter column starts_at drop not null,
  alter column ends_at drop not null,
  add column arrangement_notes text,
  add column shortfall integer,
  add column placement_venue_id integer references public.venues(venue_id),
  add column placement_position text,
  add column version bigint not null default 1,
  add constraint equipment_requirements_version check (version between 1 and 9007199254740991),
  add constraint equipment_requirements_shortfall check (shortfall between 0 and quantity),
  add constraint equipment_requirements_placement check (
    (placement_venue_id is null and placement_position is null) or
    (placement_venue_id is not null and placement_position is not null and btrim(placement_position) <> '')),
  add constraint equipment_requirements_arrangement_length check (char_length(arrangement_notes) <= 2000),
  add constraint equipment_requirements_position_length check (char_length(placement_position) <= 2000),
  add constraint equipment_requirements_period_pair check ((starts_at is null) = (ends_at is null));
-- Legacy notes retain their original contents and remain arrangeable. New
-- and amended coordinator notes are length-checked by the guarded RPC below.

create function public.advance_equipment_requirement_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;
revoke all on function public.advance_equipment_requirement_version() from public, anon, authenticated;
create trigger advance_equipment_requirement_version before update on public.equipment_requests
  for each row execute function public.advance_equipment_requirement_version();

-- No ordinary table/sequence access is needed. The RPC verifies current
-- identity, role, event assignment and lifecycle for every operation.
revoke all on public.equipment_requests from public, anon, authenticated;
revoke all on sequence public.equipment_requests_request_id_seq from public, anon, authenticated;

create function public.manage_equipment_requirements(
  p_action text, p_event_id integer, p_request_id bigint default null,
  p_version bigint default null, p_values jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  event_row public.events;
  request_row public.equipment_requests;
  equipment_value integer;
  quantity_value integer;
  shortfall_value integer;
  venue_value integer;
  notes_value text;
  arrangement_value text;
  position_value text;
  number_value numeric;
  whitespace constant text := E' \t\n\r\f\v' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if caller is null then raise exception using errcode = '42501', message = 'Access denied'; end if;
  -- A stored role change that wins this lock takes effect before any write.
  select ar.role into caller_role from public.account_roles ar where ar.user_id = caller for share;
  if caller_role is null or caller_role not in ('event_coordinator', 'technical_support_staff', 'safety_officer') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_action is null or p_action not in ('read', 'create', 'amend', 'arrange')
      or p_event_id is null or p_event_id <= 0 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if (p_action in ('create', 'amend') and caller_role <> 'event_coordinator')
      or (p_action = 'arrange' and caller_role <> 'technical_support_staff') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;

  -- Serialize requirements for one event and recheck the row after waiting:
  -- assignment/stage changes and duplicate creates cannot use stale context.
  select * into event_row from public.events where event_id = p_event_id for update;
  if not found or (caller_role = 'event_coordinator' and event_row.coordinator_id is distinct from caller) then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if p_action <> 'read' then
    if event_row.status not in ('approved', 'planning') then
      return jsonb_build_object('outcome', 'closed');
    end if;
    if jsonb_typeof(p_values) is distinct from 'object' then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    if p_action in ('amend', 'arrange') then
      if p_request_id is null or p_request_id not between 1 and 9007199254740991
          or p_version is null or p_version not between 1 and 9007199254740991 then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      select * into request_row from public.equipment_requests
        where request_id = p_request_id and event_id = p_event_id for update;
      if not found then return jsonb_build_object('outcome', 'missing'); end if;
      if request_row.status <> 'pending' then return jsonb_build_object('outcome', 'closed'); end if;
      if request_row.version <> p_version or request_row.version = 9007199254740991 then
        return jsonb_build_object('outcome', 'conflict');
      end if;
    end if;

    -- Validate JSON types before casting; reject fractional/overflow values
    -- without rounding, and count text in Unicode characters.
    if p_action in ('create', 'amend') then
      if exists (select 1 from jsonb_object_keys(p_values) key where key not in ('equipment_id', 'quantity', 'notes'))
          or jsonb_typeof(p_values->'equipment_id') is distinct from 'number'
          or jsonb_typeof(p_values->'quantity') is distinct from 'number'
          or coalesce(jsonb_typeof(p_values->'notes'), 'null') not in ('string', 'null') then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      number_value := (p_values->>'equipment_id')::numeric;
      if number_value <> trunc(number_value) or number_value not between 1 and 2147483647 then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      equipment_value := number_value::integer;
      number_value := (p_values->>'quantity')::numeric;
      if number_value <> trunc(number_value) or number_value not between 1 and 2147483647 then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      quantity_value := number_value::integer;
      notes_value := nullif(btrim(p_values->>'notes', whitespace), '');
      if char_length(notes_value) > 2000 or not exists (select 1 from public.equipment where equipment_id = equipment_value) then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      if exists (select 1 from public.equipment_requests r where r.event_id = p_event_id
          and r.equipment_id = equipment_value and r.status = 'pending'
          and (p_action = 'create' or r.request_id <> p_request_id)) then
        return jsonb_build_object('outcome', 'duplicate');
      end if;
      if p_action = 'create' then
        insert into public.equipment_requests(event_id, equipment_id, quantity, notes)
          values (p_event_id, equipment_value, quantity_value, notes_value);
      else
        update public.equipment_requests set equipment_id = equipment_value, quantity = quantity_value,
          notes = notes_value, arrangement_notes = null, shortfall = null,
          placement_venue_id = null, placement_position = null where request_id = p_request_id;
      end if;
    else
      if exists (select 1 from jsonb_object_keys(p_values) key where key not in
          ('arrangement_notes', 'shortfall', 'placement_venue_id', 'placement_position'))
          or jsonb_typeof(p_values->'shortfall') is distinct from 'number'
          or coalesce(jsonb_typeof(p_values->'arrangement_notes'), 'null') not in ('string', 'null')
          or coalesce(jsonb_typeof(p_values->'placement_position'), 'null') not in ('string', 'null')
          or coalesce(jsonb_typeof(p_values->'placement_venue_id'), 'null') not in ('number', 'null') then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      number_value := (p_values->>'shortfall')::numeric;
      if number_value <> trunc(number_value) or number_value not between 0 and request_row.quantity then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      shortfall_value := number_value::integer;
      arrangement_value := nullif(btrim(p_values->>'arrangement_notes', whitespace), '');
      position_value := nullif(btrim(p_values->>'placement_position', whitespace), '');
      if p_values->>'placement_venue_id' is not null then
        number_value := (p_values->>'placement_venue_id')::numeric;
        if number_value <> trunc(number_value) or number_value not between 1 and 2147483647 then
          return jsonb_build_object('outcome', 'invalid');
        end if;
        venue_value := number_value::integer;
      end if;
      if char_length(arrangement_value) > 2000 or char_length(position_value) > 2000
          or (venue_value is null) <> (position_value is null)
          or (venue_value is not null and not exists (select 1 from public.venues where venue_id = venue_value)) then
        return jsonb_build_object('outcome', 'invalid');
      end if;
      update public.equipment_requests set arrangement_notes = arrangement_value,
        shortfall = shortfall_value, placement_venue_id = venue_value,
        placement_position = position_value where request_id = p_request_id;
    end if;
  end if;

  return jsonb_build_object('outcome', 'ok',
    'event', jsonb_build_object('event_id', event_row.event_id, 'name', event_row.name, 'status', event_row.status),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
      'request_id', r.request_id, 'event_id', r.event_id, 'equipment_id', r.equipment_id,
      'equipment_type', q.name, 'quantity', r.quantity, 'notes', r.notes, 'status', r.status,
      'arrangement_notes', r.arrangement_notes, 'shortfall', r.shortfall,
      'placement_venue_id', r.placement_venue_id, 'placement_venue_name', v.name,
      'placement_position', r.placement_position, 'version', r.version) order by r.request_id)
      from public.equipment_requests r join public.equipment q using (equipment_id)
      left join public.venues v on v.venue_id = r.placement_venue_id where r.event_id = p_event_id), '[]'::jsonb),
    'equipment', coalesce((select jsonb_agg(jsonb_build_object('equipment_id', equipment_id, 'type', name) order by equipment_id)
      from public.equipment), '[]'::jsonb),
    'venues', coalesce((select jsonb_agg(jsonb_build_object('venue_id', venue_id, 'name', name) order by venue_id)
      from public.venues), '[]'::jsonb),
    'can_request', caller_role = 'event_coordinator' and event_row.status in ('approved', 'planning'),
    'can_arrange', caller_role = 'technical_support_staff' and event_row.status in ('approved', 'planning'));
end;
$$;
revoke all on function public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb) to authenticated;

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
    'layout', r.layout, 'requested_by', u.name, 'hold_id', h.hold_id)
from public.venue_booking_requests r
join public.events e on e.event_id = r.event_id
join public.venues v on v.venue_id = r.venue_id
left join public.users u on u.user_id = r.requested_by
left join public.venue_holds h on h.request_id = r.request_id
where r.status = 'pending' and e.status in ('submitted', 'under_review', 'approved', 'planning', 'confirmed')
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
where r.status = 'pending' and e.status in ('submitted', 'under_review', 'approved', 'planning', 'confirmed');

revoke all on public.internal_work_items from public, anon, authenticated;
grant select on public.internal_work_items to service_role;
commit;
