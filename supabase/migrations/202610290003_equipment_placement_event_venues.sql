-- SG2-53 AC6: an equipment placement names a venue the event actually uses.
-- Hosted QA (29 Oct 2026) saved a placement at a venue event #48 had never
-- requested, so the Safety Officer reviewed equipment in the wrong building.
-- A placement venue must now have a pending or approved venue_booking_requests
-- row, or a confirmed venue_bookings row, for the same event; otherwise the
-- 'arrange' action returns outcome 'venue'. Pending requests count so
-- Technical Support can plan in parallel with Venue Staff decisions. The view's
-- `venues` choices list only those venues, so the editor offers the same set.
-- Existing placements are not rewritten: one that no longer qualifies is
-- refused on its next save.
--
-- Body copied from 202610200002_acting_role_functions.sql (the latest
-- definition), keeping its acting-role lookup; only the placement check and
-- the `venues` list changed. CREATE OR REPLACE keeps the existing grants,
-- which are restated below as in earlier definitions.
begin;

create or replace function public.manage_equipment_requirements(
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
  caller_role := public.lock_acting_role();
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
    if event_row.status not in ('approved', 'planning', 'awaiting_safety_check') then
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
      -- A reserved demand is frozen, but placement and support arrangements
      -- still need to be completed for SG2-57 readiness. Only linked receipts
      -- authorize this exception; legacy approved requests remain closed.
      if request_row.status <> 'pending' and not (p_action = 'arrange'
          and request_row.status = 'approved' and exists (
            select 1 from public.equipment_reservations where request_id = p_request_id)) then
        return jsonb_build_object('outcome', 'closed');
      end if;
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
      -- A linked reservation already covers the full approved demand. Its
      -- remaining arrangement edits must not contradict that committed stock.
      if number_value <> trunc(number_value) or number_value not between 0 and request_row.quantity
          or (request_row.status = 'approved' and number_value <> 0) then
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
      -- SG2-53 AC6: the Safety Officer reviews equipment in the event's own
      -- venues, so a placement names a venue the event has requested (pending
      -- or approved) or holds a confirmed booking for.
      if venue_value is not null and not exists (
          select 1 from public.venue_booking_requests q
            where q.event_id = p_event_id and q.venue_id = venue_value and q.status in ('pending', 'approved')
          union all
          select 1 from public.venue_bookings b
            where b.event_id = p_event_id and b.venue_id = venue_value and b.status = 'confirmed') then
        return jsonb_build_object('outcome', 'venue');
      end if;
      update public.equipment_requests set arrangement_notes = arrangement_value,
        shortfall = shortfall_value, placement_venue_id = venue_value,
        placement_position = position_value where request_id = p_request_id;
    end if;
  end if;

  -- SG2-91: a new or amended request sends an awaiting event back to
  -- Planning in this transaction, so report the status after the write.
  select * into event_row from public.events where event_id = p_event_id;
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
    -- SG2-53 AC6: placement choices are the event's own venues (same rule as above).
    'venues', coalesce((select jsonb_agg(jsonb_build_object('venue_id', v.venue_id, 'name', v.name) order by v.venue_id)
      from public.venues v where exists (select 1 from public.venue_booking_requests q
          where q.event_id = p_event_id and q.venue_id = v.venue_id and q.status in ('pending', 'approved'))
        or exists (select 1 from public.venue_bookings b
          where b.event_id = p_event_id and b.venue_id = v.venue_id and b.status = 'confirmed')), '[]'::jsonb),
    'can_request', caller_role = 'event_coordinator' and event_row.status in ('approved', 'planning', 'awaiting_safety_check'),
    'can_arrange', caller_role = 'technical_support_staff' and event_row.status in ('approved', 'planning', 'awaiting_safety_check'));
end;
$$;

revoke all on function public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb) to authenticated;

commit;
