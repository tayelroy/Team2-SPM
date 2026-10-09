-- SG2-78 (Week 7 customer change #1): setup and turnaround time in
-- availability and conflict checks.
--
-- A booking occupies its venue from setup before it starts until turnaround
-- after it ends (AC1): 10:00-12:00 with 30 minutes setup and 45 minutes
-- turnaround occupies 09:30-12:45. Two bookings at one venue clash when those
-- effective periods overlap (AC2), which is exactly when the gap between them
-- is shorter than the venue's setup plus turnaround. The stored booking times
-- stay the event's own times (AC5); only the checks widen.
--
-- The checks that commit a venue use it here: approving a request (SG2-49),
-- placing a tentative hold and converting one (SG2-84). Venue blocks are not
-- padded: they are not events and need no setup or turnaround of their own.
-- There is deliberately no constraint on effective periods: when Venue Staff
-- change a venue's times, existing bookings that now clash are flagged, not
-- refused or removed (SG2-79).
begin;

-- Setup plus turnaround for a venue; 0 minutes when none are set (SG2-77 AC3).
create function public.venue_preparation_gap(p_venue_id integer)
returns interval
language sql
stable
security definer
set search_path = ''
as $$
  select make_interval(mins => coalesce(
    (select o.setup_minutes + o.turnaround_minutes from public.venue_operations o where o.venue_id = p_venue_id), 0));
$$;
revoke all on function public.venue_preparation_gap(integer) from public, anon, authenticated;

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
  -- Venue before request: the order every booking, block and hold write uses.
  select * into v from public.venues where venue_id = venue for update;
  select * into r from public.venue_booking_requests where request_id = p_request_id for update;
  if r.status <> 'pending' then
    return jsonb_build_object('outcome', 'decided', 'status', r.status);
  end if;
  -- A hold's request is converted or released through the hold (SG2-84).
  select hold_id into hold from public.venue_holds where request_id = r.request_id;
  if hold is not null then return jsonb_build_object('outcome', 'hold', 'hold_id', hold); end if;
  select * into e from public.events where event_id = r.event_id for update;
  instant := clock_timestamp();
  -- SG2-78: setup before and turnaround after every booking at this venue.
  gap := public.venue_preparation_gap(r.venue_id);

  if p_decision = 'approve' then
    if e.status not in ('approved', 'planning') or r.ends_at <= instant then
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
    -- (SG2-47). Missing facilities are refused by the API before this point.
    if e.expected_attendance is not null and (v.capacity is null or e.expected_attendance > v.capacity)
        and not exists (select 1 from public.venue_capacity_exceptions x
          where x.request_id = r.request_id and x.expected_attendance >= e.expected_attendance) then
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
  return jsonb_build_object('outcome', 'updated', 'request_id', r.request_id, 'status', r.status,
    'venue_booking_id', r.venue_booking_id, 'decided_at', r.decided_at);
end;
$$;

create or replace function public.create_venue_hold(p_event_id integer,p_venue_id integer,p_starts_at timestamptz,p_ends_at timestamptz,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.events; h public.venue_holds; r bigint; instant timestamptz; lead_seconds integer; gap interval;
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501',message = 'Access denied';
  end if;
  perform 1 from public.venues where venue_id = p_venue_id for update;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  select * into e from public.events where event_id = p_event_id for update;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  instant := clock_timestamp();
  -- SG2-78: a hold needs the same setup and turnaround room as a booking.
  gap := public.venue_preparation_gap(p_venue_id);
  if p_starts_at is null or p_ends_at is null or p_expires_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at) or not isfinite(p_expires_at) or p_ends_at <= p_starts_at or p_ends_at <= instant or p_expires_at <= instant
    or e.status not in ('approved','planning') or e.coordinator_id is null then return jsonb_build_object('outcome','invalid'); end if;
  if exists(select 1 from public.venue_bookings where venue_id = p_venue_id and status = 'confirmed' and starts_at < p_ends_at + gap and ends_at > p_starts_at - gap)
    or exists(select 1 from public.venue_holds where venue_id = p_venue_id and status = 'tentative' and expires_at > instant and starts_at < p_ends_at + gap and ends_at > p_starts_at - gap)
    or exists(select 1 from public.venue_unavailability where venue_id = p_venue_id and starts_at < p_ends_at and ends_at > p_starts_at)
    then return jsonb_build_object('outcome','conflict'); end if;
  insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,notes)
    values(p_event_id,p_venue_id,p_starts_at,p_ends_at,'Tentative hold — approval required') returning request_id into r;
  insert into public.venue_holds(event_id,venue_id,request_id,starts_at,ends_at,expires_at,created_by,created_at)
    values(p_event_id,p_venue_id,r,p_starts_at,p_ends_at,p_expires_at,auth.uid(),instant) returning * into h;
  insert into public.event_audit_logs(event_id,actor_id,field_name,old_value,new_value)
    values(h.event_id,auth.uid(),'venue_hold_status',null,'Tentative hold ' || h.hold_id || '; expires ' || h.expires_at);
  perform public.venue_hold_notice(h,'placed');
  select warning_lead_seconds into lead_seconds from public.venue_hold_settings where singleton;
  if h.expires_at <= instant + make_interval(secs => lead_seconds) then
    update public.venue_holds set warning_sent_at = instant where hold_id = h.hold_id;
    perform public.venue_hold_notice(h,'warning');
  end if;
  return jsonb_build_object('outcome','created','hold',public.venue_hold_json(h));
end;
$$;

create or replace function public.change_venue_hold(p_hold_id bigint,p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.venue_holds; venue integer; v public.venues; e public.events; booking bigint; instant timestamptz; gap interval;
begin
  if not exists(select 1 from public.account_roles where user_id = auth.uid() and role = 'venue_staff') then
    raise exception using errcode = '42501',message = 'Access denied';
  end if;
  if p_action not in ('release','convert') or p_action is null then return jsonb_build_object('outcome','invalid'); end if;
  select venue_id into venue from public.venue_holds where hold_id = p_hold_id;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  select * into v from public.venues where venue_id = venue for update;
  select * into h from public.venue_holds where hold_id = p_hold_id for update;
  instant := clock_timestamp();
  if h.status <> 'tentative' then return jsonb_build_object('outcome','inactive'); end if;
  if h.expires_at <= instant then
    -- Persist the transition, notifications and history in this same request.
    perform public.expire_venue_hold(h); return jsonb_build_object('outcome','inactive');
  end if;
  select * into e from public.events where event_id = h.event_id for update;
  perform 1 from public.venue_booking_requests where request_id = h.request_id and status = 'pending' for update;
  if not found then return jsonb_build_object('outcome','inactive'); end if;
  if h.expires_at <= clock_timestamp() then perform public.expire_venue_hold(h); return jsonb_build_object('outcome','inactive'); end if;
  if p_action = 'convert' then
    -- SG2-78: converting must leave setup and turnaround room either side.
    gap := public.venue_preparation_gap(venue);
    if e.status not in ('approved','planning') or h.ends_at <= clock_timestamp() then return jsonb_build_object('outcome','invalid'); end if;
    if exists(select 1 from public.venue_bookings where venue_id = venue and status = 'confirmed' and starts_at < h.ends_at + gap and ends_at > h.starts_at - gap)
      or exists(select 1 from public.venue_unavailability where venue_id = venue and starts_at < h.ends_at and ends_at > h.starts_at)
      or exists(select 1 from public.venue_holds where venue_id = venue and hold_id <> h.hold_id and status = 'tentative' and expires_at > instant and starts_at < h.ends_at + gap and ends_at > h.starts_at - gap)
      then return jsonb_build_object('outcome','conflict'); end if;
    -- The established capacity-exception workflow covers this request and
    -- attendance; a prior approval for lower attendance cannot authorize it.
    if e.expected_attendance is not null and (v.capacity is null or e.expected_attendance > v.capacity)
      and not exists(select 1 from public.venue_capacity_exceptions where request_id = h.request_id and expected_attendance >= e.expected_attendance)
      then return jsonb_build_object('outcome','capacity'); end if;
    if exists(select 1 from (values
      ('\yproject(or|ors|ion)\y'),('\yscreens?\y'),('\yPA\y|public address|sound system'),('\ymic(rophone)?s?\y'),
      ('\ystages?\y'),('\ywhiteboards?\y'),('\ywi-?fi\y|\yinternet\y'),('\ykitchens?\y|\ycatering\y'),
      ('\ybars?\y'),('\ypower\y'),('\yair[\s-]?con(ditioning|ditioned)?\y'),('\yvideo[\s-]?conferenc(e|ing)\y')
    ) requirements(pattern) where coalesce(e.venue_requirements,'') ~* pattern and not(coalesce(v.facilities,'') ~* pattern))
      then return jsonb_build_object('outcome','suitability'); end if;
    if h.expires_at <= clock_timestamp() then perform public.expire_venue_hold(h); return jsonb_build_object('outcome','inactive'); end if;
    -- Mark the hold inactive before the booking insert. The shared trigger
    -- still excludes every competing live hold under the same venue lock.
    update public.venue_holds set status = 'released' where hold_id = h.hold_id;
    insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
      values(venue,h.event_id,h.starts_at,h.ends_at,'confirmed') returning booking_id into booking;
    update public.venue_holds set status = 'converted',booking_id = booking where hold_id = h.hold_id returning * into h;
    update public.venue_booking_requests set status = 'approved' where request_id = h.request_id;
    update public.events set venue_booking_id = booking where event_id = h.event_id;
  else
    update public.venue_holds set status = 'released' where hold_id = h.hold_id returning * into h;
    update public.venue_booking_requests set status = 'cancelled' where request_id = h.request_id;
  end if;
  insert into public.event_audit_logs(event_id,actor_id,field_name,old_value,new_value)
    values(h.event_id,auth.uid(),'venue_hold_status','Tentative hold ' || h.hold_id,initcap(h.status) || ' hold ' || h.hold_id);
  return jsonb_build_object('outcome','updated','hold',public.venue_hold_json(h));
end;
$$;

commit;
