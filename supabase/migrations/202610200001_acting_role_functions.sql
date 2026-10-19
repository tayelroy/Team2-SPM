-- SG2-104: the functions that read the caller's role act as the request's
-- acting role (202610180001), and decide_venue_booking_request() refuses a
-- request the deciding Venue Staff member raised themselves.
--
-- Each body below is the LATEST definition, copied verbatim; only its role
-- lookup (or, for the venue decision, the own-request check) changed. This
-- migration is deliberately the last one: if a later migration redefines one
-- of these functions, it must keep the acting-role line (and the own-request
-- check), or this story's behaviour is lost.
--
-- Before SG2-104 these read a single account_roles row with SELECT INTO,
-- which with several roles picks an arbitrary one. Writes take
-- lock_acting_role(), which share-locks all of the caller's role rows, so a
-- role change waits for the action in progress. update_event_request_draft()
-- is service-only and receives the verified actor; it now asks whether that
-- actor holds event_organiser instead of reading one role.
-- CREATE OR REPLACE keeps each function's existing grants.
--
-- Sources:
--   venue_hold_occupancy() from 202610050001_venue_holds.sql
--   list_venue_holds() from 202610050001_venue_holds.sql
--   release_venue_booking() from 202610100002_venue_booking_release.sql
--   manage_equipment_requirements() from 202610190004_safety_check_queue.sql
--   manage_equipment_reservations() from 202610140001_equipment_reservations.sql
--   confirm_event() from 202610170002_confirmation_rechecks_and_disruptions.sql
--   update_event_request_draft() from 202610170003_event_draft_change_history.sql
--   safety_check_queue() from 202610190004_safety_check_queue.sql
--   decide_venue_booking_request() from 202610190002_venue_staff_capacity_exceptions.sql
begin;

create or replace function public.venue_hold_occupancy()
returns table(venue_id integer,starts_at timestamptz,ends_at timestamptz,status text,event_id integer)
language plpgsql security definer set search_path = '' as $$
declare caller_role text; trusted_service boolean := coalesce(current_setting('role',true) = 'service_role',false);
begin
  caller_role := public.acting_role();
  if not trusted_service and (caller_role is null or caller_role not in ('venue_staff','event_coordinator','technical_support_staff')) then return; end if;
  return query
    select h.venue_id,h.starts_at,h.ends_at,'tentative'::text,
      case when trusted_service or caller_role <> 'event_coordinator' or e.coordinator_id = auth.uid() then h.event_id else null::integer end
    from public.venue_holds h join public.events e on e.event_id = h.event_id
    where h.status = 'tentative' and h.expires_at > clock_timestamp();
end;
$$;

create or replace function public.list_venue_holds() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare caller_role text;
begin
  caller_role := public.acting_role();
  if caller_role is null or caller_role not in ('venue_staff','event_coordinator','technical_support_staff') then raise exception using errcode = '42501',message = 'Access denied'; end if;
  perform public.process_venue_hold_deadlines();
  return coalesce((select jsonb_agg(public.venue_hold_json(h) order by h.created_at desc,h.hold_id desc)
    from public.venue_holds h join public.events e on e.event_id = h.event_id
    where caller_role <> 'event_coordinator' or e.coordinator_id = auth.uid()),'[]'::jsonb);
end;
$$;

create or replace function public.release_venue_booking(p_booking_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  b public.venue_bookings;
  e public.events;
  v public.venues;
  venue integer;
  reason text := nullif(btrim(p_reason), '');
  instant timestamptz;
  period text;
begin
  caller_role := public.lock_acting_role();
  if caller_role is null or caller_role not in ('venue_staff', 'event_coordinator') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if reason is null or char_length(reason) > 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select venue_id into venue from public.venue_bookings where booking_id = p_booking_id;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  -- Venue before booking: the order every booking, block and hold write uses.
  select * into v from public.venues where venue_id = venue for update;
  select * into b from public.venue_bookings where booking_id = p_booking_id for update;
  if b.event_id is not null then
    select * into e from public.events where event_id = b.event_id for update;
  end if;
  -- A coordinator releases only bookings for events assigned to them; any
  -- other booking is reported as missing so it is not revealed.
  if caller_role = 'event_coordinator' and (e.coordinator_id is null or e.coordinator_id <> auth.uid()) then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if b.status <> 'confirmed' then
    return jsonb_build_object('outcome', 'inactive', 'status', b.status);
  end if;
  instant := clock_timestamp();
  if b.ends_at <= instant then
    return jsonb_build_object('outcome', 'past');
  end if;

  update public.venue_bookings
    set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = instant, cancellation_reason = reason
    where booking_id = b.booking_id
    returning * into b;
  -- The request that committed this booking (SG2-49) is no longer live, so
  -- the venue can be requested again (AC2).
  update public.venue_booking_requests set status = 'cancelled'
    where venue_booking_id = b.booking_id and status = 'approved';

  if e.event_id is not null then
    -- AC3: the event keeps its other venues; its main venue moves to the
    -- earliest one still confirmed and not yet over, if any.
    update public.events
      set venue_booking_id = (select x.booking_id from public.venue_bookings x
        where x.event_id = e.event_id and x.status = 'confirmed' and x.ends_at > instant
        order by x.starts_at, x.booking_id limit 1)
      where event_id = e.event_id and venue_booking_id = b.booking_id;
    period := to_char(b.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' – '
      || to_char(b.ends_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI');
    -- AC5: the release appears in the event's history (SG2-40).
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (e.event_id, auth.uid(), 'venue_booking',
        'Confirmed: ' || v.name || ' (booking ' || b.booking_id || ')',
        'Released: ' || v.name || ' (booking ' || b.booking_id || ') — ' || reason);
    -- AC4: the coordinator and the Event Organiser are told, with the reason.
    insert into public.notifications (recipient_id, event_id, request_id, kind, message)
      select distinct recipient, e.event_id, null::bigint, 'venue_booking_released',
        v.name || ' was released for ' || coalesce(nullif(e.name, ''), 'Untitled event')
          || ' (' || period || ' SGT): ' || reason
      from unnest(array[e.coordinator_id, e.organiser_id]) as recipient
      where recipient is not null;
  end if;
  return jsonb_build_object('outcome', 'released', 'booking_id', b.booking_id, 'cancelled_at', b.cancelled_at);
end;
$$;

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
    'venues', coalesce((select jsonb_agg(jsonb_build_object('venue_id', venue_id, 'name', name) order by venue_id)
      from public.venues), '[]'::jsonb),
    'can_request', caller_role = 'event_coordinator' and event_row.status in ('approved', 'planning', 'awaiting_safety_check'),
    'can_arrange', caller_role = 'technical_support_staff' and event_row.status in ('approved', 'planning', 'awaiting_safety_check'));
end;
$$;

create or replace function public.manage_equipment_reservations(
  p_action text, p_event_id integer, p_request_id bigint default null,
  p_version bigint default null, p_starts_at timestamptz default null, p_ends_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller_role text;
  event_row public.events;
  request_row public.equipment_requests;
  equipment_row public.equipment;
  permission_result jsonb;
  receipt_id integer;
  committed bigint;
  remaining bigint;
  response jsonb;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Access denied'; end if;
  caller_role := public.lock_acting_role();
  if caller_role is null or caller_role not in ('event_coordinator', 'technical_support_staff', 'safety_officer') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_action is null or p_action not in ('read', 'reserve') or p_event_id is null or p_event_id <= 0 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if p_action = 'reserve' and caller_role <> 'technical_support_staff' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  -- Reuse the established event visibility contract, including reassignment.
  -- This locks role -> event, matching equipment requirement writers.
  permission_result := public.manage_equipment_requirements('read', p_event_id);
  if permission_result->>'outcome' <> 'ok' then return permission_result; end if;
  select * into event_row from public.events where event_id = p_event_id;

  if p_action = 'reserve' then
    if p_request_id is null or p_request_id not between 1 and 9007199254740991
      or p_version is null or p_version not between 1 and 9007199254740991
      or p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at)
      or not isfinite(p_ends_at) or p_ends_at <= p_starts_at then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    if event_row.status not in ('approved', 'planning', 'confirmed') or event_row.coordinator_id is null then
      return jsonb_build_object('outcome', 'closed');
    end if;
    select * into request_row from public.equipment_requests
      where request_id = p_request_id and event_id = p_event_id for update;
    if not found then return jsonb_build_object('outcome', 'missing'); end if;
    if exists (select 1 from public.equipment_reservations where request_id = p_request_id) then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if request_row.status <> 'pending' then return jsonb_build_object('outcome', 'closed'); end if;
    if request_row.version <> p_version or request_row.version = 9007199254740991 then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    -- Every app reservation for this equipment takes this lock. A waiting
    -- caller's following statements see the winner's committed receipt;
    -- direct inventory updates also finish before stock/status is read.
    select * into equipment_row from public.equipment
      where equipment_id = request_row.equipment_id for update;

    with reservations as (
      select r.reservation_id, greatest(r.quantity_reserved, 0)::bigint as quantity,
        coalesce(r.starts_at, booking.starts_at) as starts_at,
        coalesce(r.ends_at, booking.ends_at) as ends_at
      from public.equipment_reservations r join public.events e on e.event_id = r.event_id
      left join lateral (
        select min(b.starts_at) as starts_at, max(b.ends_at) as ends_at
        from public.venue_bookings b where b.event_id = r.event_id and b.status = 'confirmed'
          and isfinite(b.starts_at) and isfinite(b.ends_at) and b.ends_at > b.starts_at
      ) booking on true
      where r.equipment_id = request_row.equipment_id and e.status not in ('completed', 'cancelled', 'rejected')
      -- Include this event's earlier/legacy reservations: they also use stock.
    ), intervals as (
      select quantity, greatest(coalesce(starts_at, p_starts_at), p_starts_at) as starts_at,
        least(coalesce(ends_at, p_ends_at), p_ends_at) as ends_at
      from reservations where quantity > 0 and (starts_at is null or ends_at is null
        or (starts_at < p_ends_at and ends_at > p_starts_at))
    ), deltas as (
      select starts_at as instant, quantity as delta from intervals
      union all select ends_at, -quantity from intervals
    ), grouped as (
      select instant, sum(delta)::bigint as delta from deltas group by instant
    ), running as (
      select sum(delta) over (order by instant rows unbounded preceding)::bigint as quantity from grouped
    ) select coalesce(max(quantity), 0) into committed from running;
    remaining := greatest((case when equipment_row.operational_status = 'operational'
      then equipment_row.quantity_total::bigint else 0::bigint end) - committed, 0::bigint);
    if request_row.quantity > remaining then return jsonb_build_object('outcome', 'insufficient'); end if;

    insert into public.equipment_reservations(event_id, equipment_id, quantity_reserved, starts_at, ends_at, request_id, reserved_at)
      values (p_event_id, request_row.equipment_id, request_row.quantity, p_starts_at, p_ends_at, p_request_id, clock_timestamp())
      returning reservation_id into receipt_id;
    -- The entire demand is now committed, so its remaining stock shortfall is zero.
    -- Placement and other arrangements remain editable by Support below.
    update public.equipment_requests set status = 'approved', shortfall = 0 where request_id = p_request_id;
    insert into public.notifications(recipient_id, event_id, kind, equipment_reservation_id, message)
      values (event_row.coordinator_id, p_event_id, 'equipment_reserved', receipt_id,
        'Equipment reserved for ' || left(coalesce(nullif(event_row.name, ''), 'Untitled event'), 500) || ': ' || request_row.quantity::text || ' × ' || equipment_row.name || '.');
  end if;

  response := jsonb_build_object('outcome', 'ok',
    'can_reserve', caller_role = 'technical_support_staff' and event_row.status in ('approved', 'planning', 'confirmed')
      and event_row.coordinator_id is not null,
    'reservations', coalesce((select jsonb_agg(jsonb_build_object(
      'reservation_id', r.reservation_id, 'event_id', r.event_id, 'request_id', r.request_id,
      'equipment_id', r.equipment_id, 'equipment_type', q.name, 'quantity_reserved', r.quantity_reserved,
      'starts_at', r.starts_at, 'ends_at', r.ends_at, 'reserved_at', r.reserved_at) order by r.reservation_id)
      from public.equipment_reservations r join public.equipment q using (equipment_id)
      where r.event_id = p_event_id), '[]'::jsonb));
  if p_action = 'reserve' then response := response || jsonb_build_object('coordinator_notified', true); end if;
  return response;
end;
$$;

create or replace function public.confirm_event(p_event_id integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  event_row public.events;
  outstanding text[] := array[]::text[];
  instant timestamptz;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Access denied'; end if;
  -- A stored role change that wins this lock takes effect before any write.
  caller_role := public.lock_acting_role();
  if caller_role is distinct from 'event_coordinator' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;

  -- Every writer of venue requests/bookings and equipment requests/receipts
  -- locks this row first, and planning edits update it. Locking it before
  -- reading any child row serialises confirmation against all of them; the
  -- readiness statements below run after the wait and see committed changes.
  select * into event_row from public.events where event_id = p_event_id for update;
  if not found or event_row.coordinator_id is distinct from caller then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if event_row.status <> 'preparation' then
    return jsonb_build_object('outcome', 'closed', 'status', event_row.status::text);
  end if;

  -- Readiness rules are shared with server/src/events/arrangementReadiness.ts.
  -- SG2-82: every request except a cancelled (withdrawn or released) one is
  -- a venue the event needs (case-insensitive); pending or rejected ones are
  -- outstanding.
  if (event_row.arrangements_recheck_needed is true
      and coalesce(event_row.outstanding_arrangements, '[]'::jsonb) @> '["venue_recheck"]'::jsonb)
    or not exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) <> 'cancelled')
    or exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) in ('pending', 'rejected'))
    -- An approved request counts only while a confirmed booking is linked to
    -- it, directly or through the hold it was converted from.
    or exists (select 1 from public.venue_booking_requests r
      where r.event_id = p_event_id and lower(r.status) = 'approved'
        and not exists (select 1 from public.venue_bookings b
          where b.status = 'confirmed'
            and (b.booking_id = r.venue_booking_id
              or b.booking_id in (select h.booking_id from public.venue_holds h
                where h.request_id = r.request_id))))
    -- SG2-81: a confirmed booking the venue's unavailability affects is
    -- outstanding until it is replaced and released.
    or exists (select 1 from public.venue_booking_disruptions d
      join public.venue_bookings b on b.booking_id = d.booking_id
      where b.event_id = p_event_id and b.status = 'confirmed') then
    outstanding := outstanding || 'venue'::text;
  end if;
  if (event_row.arrangements_recheck_needed is true
      and coalesce(event_row.outstanding_arrangements, '[]'::jsonb) @> '["equipment_recheck"]'::jsonb)
    or exists (select 1 from public.equipment_requests r
      where r.event_id = p_event_id and lower(r.status) not in ('rejected', 'cancelled')
        and (r.placement_venue_id is null or r.shortfall is distinct from 0
          or not exists (select 1 from public.equipment_reservations receipt
            where receipt.request_id = r.request_id))) then
    outstanding := outstanding || 'equipment'::text;
  end if;
  if (event_row.arrangements_recheck_needed is true
      and coalesce(event_row.outstanding_arrangements, '[]'::jsonb) @> '["registration_recheck"]'::jsonb)
    or (event_row.registration_needed is true and (event_row.registration_capacity is null
      or event_row.registration_opens_at is null or event_row.registration_closes_at is null)) then
    outstanding := outstanding || 'registration'::text;
  end if;
  if cardinality(outstanding) > 0 then
    return jsonb_build_object('outcome', 'outstanding', 'outstanding', to_jsonb(outstanding));
  end if;

  instant := clock_timestamp();
  update public.events set status = 'confirmed', confirmed_by = caller, confirmed_at = instant
    where event_id = p_event_id;
  -- AC1: the confirmation appears in the event's history (SG2-40).
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (p_event_id, caller, 'status', 'preparation', 'confirmed');
  insert into public.notifications (recipient_id, event_id, kind, message)
    values (event_row.organiser_id, p_event_id, 'event_confirmed',
      'Your event ' || left(coalesce(nullif(event_row.name, ''), 'Untitled event'), 500) || ' is confirmed.');

  return jsonb_build_object('outcome', 'ok', 'event_id', p_event_id, 'status', 'confirmed',
    'confirmed_at', instant, 'organiser_notified', true);
end;
$$;

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
    'expected_attendance', 'venue_requirements', 'accessibility_needs',
    'equipment_requirements', 'registration_needed'];
begin
  -- Keep membership/role stable until the transaction finishes, then lock the
  -- event. The event lock serializes saves and status changes (including submit).
  -- SG2-104: the actor may hold several roles; one of them must be
  -- event_organiser (the server has already checked it is the acting role).
  perform 1 from public.account_roles ar
    where ar.user_id = p_actor_id and ar.role = 'event_organiser' for share;
  actor_role := case when found then 'event_organiser' end;
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

create or replace function public.safety_check_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role text;
begin
  if caller is null then raise exception using errcode = '42501', message = 'Access denied'; end if;
  caller_role := public.acting_role();
  if caller_role is distinct from 'safety_officer' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;

  return coalesce((
    select jsonb_agg(item order by since, id)
    from (
      select e.awaiting_safety_check_since as since, e.event_id as id, jsonb_build_object(
        'event_id', e.event_id,
        'safety_check_revision', e.safety_check_revision,
        'name', e.name,
        'organisation', e.organisation,
        'proposed_date', e.proposed_date,
        'awaiting_since', e.awaiting_safety_check_since,
        'expected_attendance', e.expected_attendance,
        'accessibility_needs', e.accessibility_needs,
        'expected_crowd_movement', e.expected_crowd_movement,
        'venues', coalesce((
          select jsonb_agg(jsonb_build_object(
            'request_id', r.request_id,
            'venue_id', v.venue_id,
            'venue_name', v.name,
            'location', v.location,
            'capacity', v.capacity,
            'layout', r.layout,
            'starts_at', r.starts_at,
            'ends_at', r.ends_at,
            'accessibility_features', v.accessibility_features,
            'emergency_access', o.emergency_access,
            'known_restrictions', o.known_restrictions
          ) order by r.starts_at, r.request_id)
          from public.venue_booking_requests r
          join public.venues v on v.venue_id = r.venue_id
          left join public.venue_operations o on o.venue_id = v.venue_id
          where r.event_id = e.event_id and lower(r.status) = 'approved'), '[]'::jsonb),
        'equipment', coalesce((
          select jsonb_agg(jsonb_build_object(
            'request_id', q.request_id,
            'equipment_name', eq.name,
            'quantity', q.quantity,
            'placement_venue_name', pv.name,
            'placement_position', q.placement_position,
            'arrangement_notes', q.arrangement_notes
          ) order by q.starts_at, q.request_id)
          from public.equipment_requests q
          join public.equipment eq on eq.equipment_id = q.equipment_id
          left join public.venues pv on pv.venue_id = q.placement_venue_id
          where q.event_id = e.event_id and lower(q.status) not in ('rejected', 'cancelled')), '[]'::jsonb)
      ) as item
      from public.events e
      where e.status = 'awaiting_safety_check'
    ) awaiting
  ), '[]'::jsonb);
end;
$$;

create or replace function public.decide_venue_booking_request(p_request_id bigint, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.venue_booking_requests;
  e public.events;
  v public.venues;
  venue integer;
  hold bigint;
  booking bigint;
  clash record;
  replaced_venue integer;
  reason text := nullif(btrim(p_reason), '');
  instant timestamptz;
  gap interval;
begin
  if not exists (select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject')
      or (p_decision = 'reject' and reason is null) or char_length(reason) > 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select venue_id into venue from public.venue_booking_requests where request_id = p_request_id;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  -- SG2-81: a replacement also releases the booking it replaces, which takes
  -- that venue's lock. Take the two venue locks lowest id first so two
  -- decisions on swapped venues cannot wait on each other.
  select b.venue_id into replaced_venue
    from public.venue_booking_requests q join public.venue_bookings b on b.booking_id = q.replaces_booking_id
    where q.request_id = p_request_id;
  if replaced_venue is not null and replaced_venue < venue then
    perform 1 from public.venues where venue_id = replaced_venue for update;
  end if;
  -- Venue before request: the order every booking, block and hold write uses.
  select * into v from public.venues where venue_id = venue for update;
  select * into r from public.venue_booking_requests where request_id = p_request_id for update;
  if r.status <> 'pending' then
    return jsonb_build_object('outcome', 'decided', 'status', r.status);
  end if;
  -- SG2-104 separation of duties: Venue Staff never decide a request they
  -- raised themselves as the event's coordinator. Requests a hold or an older
  -- release created have no requester and are not anyone's own.
  if r.requested_by = auth.uid() then
    return jsonb_build_object('outcome', 'own_request');
  end if;
  -- A hold's request is converted or released through the hold (SG2-84).
  select hold_id into hold from public.venue_holds where request_id = r.request_id;
  if hold is not null then return jsonb_build_object('outcome', 'hold', 'hold_id', hold); end if;
  select * into e from public.events where event_id = r.event_id for update;
  instant := clock_timestamp();
  -- SG2-78: setup before and turnaround after every booking at this venue.
  gap := public.venue_preparation_gap(r.venue_id);

  if p_decision = 'approve' then
    -- SG2-81: a replacement for an unavailable venue is also decided once the
    -- event has reached preparation or been confirmed.
    if (e.status not in ('approved', 'planning')
        and not (r.replaces_booking_id is not null and e.status in ('preparation', 'confirmed')))
      or r.ends_at <= instant then
      return jsonb_build_object('outcome', 'closed');
    end if;
    -- AC1: no booking conflict, under the venue lock taken above. SG2-78: the
    -- effective periods (setup and turnaround included) must not overlap.
    select 'booking'::text as kind, b.starts_at, b.ends_at, coalesce(nullif(oe.name, ''), 'Untitled event')::text as label
      into clash
      from public.venue_bookings b left join public.events oe on oe.event_id = b.event_id
      where b.venue_id = r.venue_id and b.status = 'confirmed' and b.starts_at < r.ends_at + gap and b.ends_at > r.starts_at - gap
      order by b.starts_at limit 1;
    if not found then
      select 'block'::text as kind, u.starts_at, u.ends_at, u.reason::text as label
        into clash
        from public.venue_unavailability u
        where u.venue_id = r.venue_id and u.starts_at < r.ends_at and u.ends_at > r.starts_at
        order by u.starts_at limit 1;
    end if;
    if not found then
      select 'hold'::text as kind, h.starts_at, h.ends_at, coalesce(nullif(he.name, ''), 'Untitled event')::text as label
        into clash
        from public.venue_holds h join public.events he on he.event_id = h.event_id
        where h.venue_id = r.venue_id and h.status = 'tentative' and h.expires_at > instant
          and h.starts_at < r.ends_at + gap and h.ends_at > r.starts_at - gap
        order by h.starts_at limit 1;
    end if;
    if found then
      return jsonb_build_object('outcome', 'conflict', 'kind', clash.kind,
        'starts_at', clash.starts_at, 'ends_at', clash.ends_at, 'label', clash.label);
    end if;
    -- AC1: enough capacity, or an approved exception covering the attendance
    -- (SG2-47), recorded by Venue Staff (SG2-66 AC5). Missing facilities are
    -- refused by the API before this point.
    if e.expected_attendance is not null and (v.capacity is null or e.expected_attendance > v.capacity)
        and not exists (select 1 from public.venue_capacity_exceptions x
          where x.request_id = r.request_id and x.expected_attendance >= e.expected_attendance
            and x.approver_role = 'venue_staff') then
      return jsonb_build_object('outcome', 'capacity');
    end if;

    insert into public.venue_bookings (venue_id, event_id, starts_at, ends_at, status)
      values (r.venue_id, r.event_id, r.starts_at, r.ends_at, 'confirmed')
      returning booking_id into booking;
    -- The event's own venue, unless an earlier one is already set (SG2-82).
    update public.events set venue_booking_id = coalesce(venue_booking_id, booking) where event_id = e.event_id;
    update public.venue_booking_requests
      set status = 'approved', decided_by = auth.uid(), decided_at = instant,
        decision_reason = reason, venue_booking_id = booking
      where request_id = r.request_id
      returning * into r;
    -- SG2-81 AC5: once the replacement is approved, the booking it replaces is
    -- released (its request is cancelled, the event's history records it and
    -- the coordinator and organiser are told), so the event no longer shows
    -- alternative arrangements as required. A booking already released, or
    -- over, is left as it is.
    if r.replaces_booking_id is not null and exists (select 1 from public.venue_bookings x
        where x.booking_id = r.replaces_booking_id and x.event_id = r.event_id) then
      perform public.release_replaced_booking(r.replaces_booking_id, v.name);
    end if;
  else
    update public.venue_booking_requests
      set status = 'rejected', decided_by = auth.uid(), decided_at = instant, decision_reason = reason
      where request_id = r.request_id
      returning * into r;
  end if;

  -- AC3: the decision appears in the event's history (SG2-40).
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (r.event_id, auth.uid(), 'venue_booking_request',
      'Pending: ' || v.name || ' (request ' || r.request_id || ')',
      initcap(r.status) || ': ' || v.name || ' (request ' || r.request_id || ')' || coalesce(' — ' || reason, ''));
  -- AC1/AC2: the coordinator is told, with the reason for a rejection.
  if e.coordinator_id is not null then
    insert into public.notifications (recipient_id, event_id, request_id, kind, message)
      values (e.coordinator_id, r.event_id, r.request_id, 'venue_request_' || r.status,
        v.name || ' was ' || r.status || ' for ' || coalesce(nullif(e.name, ''), 'Untitled event')
          || case when r.status = 'rejected' then ': ' || reason else '.' end)
      on conflict (request_id, recipient_id, kind) do nothing;
  end if;
  -- SG2-68 AC1: the organiser is told the same, unless they are the coordinator just told.
  if e.organiser_id is not null and e.organiser_id is distinct from e.coordinator_id then
    insert into public.notifications (recipient_id, event_id, request_id, kind, message)
      values (e.organiser_id, r.event_id, r.request_id, 'venue_request_' || r.status,
        v.name || ' was ' || r.status || ' for ' || coalesce(nullif(e.name, ''), 'Untitled event')
          || case when r.status = 'rejected' then ': ' || reason else '.' end)
      on conflict (request_id, recipient_id, kind) do nothing;
  end if;
  return jsonb_build_object('outcome', 'updated', 'request_id', r.request_id, 'status', r.status,
    'venue_booking_id', r.venue_booking_id, 'decided_at', r.decided_at);
end;
$$;

commit;
