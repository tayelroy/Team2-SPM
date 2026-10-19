-- SG2-104 separation of duties for accounts that hold several roles.
--
-- (a) The Event Coordinator Lead never makes an event's own organiser its
--     coordinator, so nobody reviews, decides or confirms their own request.
--     server/src/events/assignCoordinator.ts refuses it first; this check is
--     the backstop for any other write. Single-role accounts could not reach
--     this state (an organiser was never a coordinator), and the block below
--     stops the migration loudly rather than hide any row that breaks it.
-- (b) Venue Staff never approve or reject a venue booking request they raised
--     themselves. decide_venue_booking_request() is the latest definition from
--     202610170001_venue_replacement.sql, copied verbatim with only the
--     own-request check added after the request row is locked.
begin;

do $$
declare
  violations integer;
begin
  select count(*) into violations from public.events where coordinator_id = organiser_id;
  if violations > 0 then
    raise exception 'SG2-104: % event(s) have their organiser as coordinator; reassign them before applying this migration', violations;
  end if;
end $$;

alter table public.events
  add constraint events_coordinator_not_organiser
  check (coordinator_id is null or coordinator_id <> organiser_id);

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
