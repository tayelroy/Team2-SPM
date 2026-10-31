-- SG2-55: new equipment reservations must start in the future, including direct RPC callers.
begin;

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

    -- Recheck wall-clock time after lock waits and the stock calculation.
    -- Only new receipts are constrained; existing/ongoing records remain readable.
    if p_starts_at <= clock_timestamp() then return jsonb_build_object('outcome', 'invalid'); end if;

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

commit;
