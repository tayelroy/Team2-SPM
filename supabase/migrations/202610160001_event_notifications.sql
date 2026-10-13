-- SG2-68: be told when something affects my event.
--
-- AC1: the organiser is now told the outcome of their event's venue booking
-- requests too, not only the coordinator (SG2-49): a Venue Staff decision and
-- a tentative hold converted to a booking (SG2-84) both notify the organiser.
-- AC2: every notice names the event and the venue; created_at says when.
-- AC3: notices only go to the event's own organiser and coordinator, and the
-- existing notifications_recipient policy lets each read only their own rows.
--
-- The notices the server raises for submission, coordinator assignment,
-- clarification and event request decisions share this table, so their kinds
-- join the list 202610150001 (SG2-58) left. Both functions below are their
-- 202610120002 (SG2-78) definitions with only the organiser notice added.
begin;

alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in
    ('venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
     'equipment_reserved', 'venue_booking_clash', 'event_confirmed',
     'event_submitted', 'coordinator_assigned', 'clarification_requested',
     'event_approved', 'event_rejected'));

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
    -- SG2-68 AC1: the organiser is told their event now has the venue.
    if e.organiser_id is not null then
      insert into public.notifications(recipient_id,event_id,request_id,kind,message)
        values(e.organiser_id,h.event_id,h.request_id,'venue_request_approved',
          v.name || ' was approved for ' || coalesce(nullif(e.name,''),'Untitled event') || '.')
        on conflict (request_id, recipient_id, kind) do nothing;
    end if;
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
