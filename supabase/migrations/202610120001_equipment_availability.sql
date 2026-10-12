-- SG2-54: advisory availability from actual committed reservations.
-- Legacy reservations retain unknown periods; future reservations can record
-- their own interval instead of borrowing the event's confirmed bookings.
begin;

alter table public.equipment_reservations
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add constraint equipment_reservations_period_pair check ((starts_at is null) = (ends_at is null)),
  add constraint equipment_reservations_period_order check (
    starts_at is null or (isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at));

create index equipment_reservations_equipment_event_idx
  on public.equipment_reservations(equipment_id, event_id);

-- STABLE gives every query in this read-only function the caller statement's
-- snapshot. Nothing is locked, reserved or written by this calculation.
create function public.check_equipment_availability(
  p_event_id integer, p_request_id bigint,
  p_starts_at timestamptz default null, p_ends_at timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  requirement public.equipment_requests;
  equipment_row public.equipment;
  selected_start timestamptz;
  selected_end timestamptz;
  proposed_start timestamptz;
  period_source text;
  committed bigint;
  undated bigint;
  remaining bigint;
begin
  if auth.uid() is null or not exists (select 1 from public.account_roles
      where user_id = auth.uid() and role = 'technical_support_staff') then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_event_id is null or p_event_id <= 0 or p_request_id is null
      or p_request_id not between 1 and 9007199254740991
      or (p_starts_at is null) <> (p_ends_at is null)
      or (p_starts_at is not null and
        (not isfinite(p_starts_at) or not isfinite(p_ends_at) or p_ends_at <= p_starts_at)) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select * into requirement from public.equipment_requests
    where request_id = p_request_id and event_id = p_event_id;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  select * into equipment_row from public.equipment where equipment_id = requirement.equipment_id;
  select proposed_date into proposed_start from public.events where event_id = p_event_id;

  if p_starts_at is not null then
    selected_start := p_starts_at; selected_end := p_ends_at; period_source := 'chosen';
  elsif requirement.starts_at is not null and requirement.ends_at is not null
      and isfinite(requirement.starts_at) and isfinite(requirement.ends_at)
      and requirement.ends_at > requirement.starts_at then
    selected_start := requirement.starts_at; selected_end := requirement.ends_at; period_source := 'request';
  else
    select min(starts_at), max(ends_at) into selected_start, selected_end
      from public.venue_bookings where event_id = p_event_id and status = 'confirmed'
        and isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at;
    period_source := 'event_bookings';
  end if;
  if selected_start is null or selected_end is null then
    return jsonb_build_object('outcome', 'dates_required', 'proposed_start',
      case when isfinite(proposed_start) then proposed_start else null end);
  end if;

  with reservations as (
    select r.reservation_id, greatest(coalesce(r.quantity_reserved, 0), 0)::bigint as quantity,
      coalesce(r.starts_at, booking.starts_at) as starts_at,
      coalesce(r.ends_at, booking.ends_at) as ends_at
    from public.equipment_reservations r
    join public.events e on e.event_id = r.event_id
    left join lateral (
      select min(b.starts_at) as starts_at, max(b.ends_at) as ends_at
      from public.venue_bookings b where b.event_id = r.event_id and b.status = 'confirmed'
        and isfinite(b.starts_at) and isfinite(b.ends_at) and b.ends_at > b.starts_at
    ) booking on true
    where r.equipment_id = requirement.equipment_id and r.event_id <> p_event_id
      and e.status not in ('completed', 'cancelled', 'rejected')
  ), intervals as (
    select reservation_id, quantity,
      starts_at is null or ends_at is null as unknown_period,
      greatest(coalesce(starts_at, selected_start), selected_start) as starts_at,
      least(coalesce(ends_at, selected_end), selected_end) as ends_at
    from reservations where quantity > 0
      and (starts_at is null or ends_at is null or (starts_at < selected_end and ends_at > selected_start))
  ), deltas as (
    select starts_at as instant, quantity as delta from intervals
    union all
    select ends_at, -quantity from intervals
  ), simultaneous_deltas as (
    -- Group departures and arrivals at each instant before accumulating:
    -- adjacent half-open intervals must not briefly count both reservations.
    select instant, sum(delta)::bigint as delta from deltas group by instant
  ), running as (
    select sum(delta) over (order by instant rows unbounded preceding)::bigint as quantity
      from simultaneous_deltas
  )
  select coalesce((select max(quantity) from running), 0),
    (select count(*) from intervals where unknown_period) into committed, undated;

  remaining := greatest((case when equipment_row.operational_status = 'operational'
    then equipment_row.quantity_total::bigint else 0::bigint end) - committed, 0::bigint);
  return jsonb_build_object('outcome', 'ok', 'event_id', p_event_id,
    'request_id', p_request_id, 'equipment_id', requirement.equipment_id,
    'equipment_type', equipment_row.name, 'quantity_requested', requirement.quantity,
    'quantity_held', equipment_row.quantity_total, 'quantity_committed', committed,
    'quantity_remaining', remaining, 'shortfall', greatest(requirement.quantity::bigint - remaining, 0::bigint),
    'undated_commitments', undated, 'operational_status', equipment_row.operational_status,
    'starts_at', selected_start, 'ends_at', selected_end, 'period_source', period_source,
    'checked_at', statement_timestamp());
end;
$$;
revoke all on function public.check_equipment_availability(integer,bigint,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.check_equipment_availability(integer,bigint,timestamptz,timestamptz)
  to authenticated;

commit;
