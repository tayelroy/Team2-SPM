-- SG2-81 (Week 7 customer change #2): replace a venue that has become
-- unavailable.
--
-- SG2-80 flags every confirmed booking that falls in a venue's unavailable
-- period (venue_booking_disruptions) and leaves the booking and its event as
-- they were. This builds the coordinator's side on top of those flags:
--
-- AC1  The coordinator of an affected event is told the venue, the period and
--      the reason (a 'venue_unavailable' notice, raised once per flag).
-- AC2  An affected booking counts as outstanding in the event's arrangements
--      and in confirm_event(), the same rule server/src/events/
--      arrangementReadiness.ts applies. Nothing here changes the event or
--      the booking, so the event's date, time, attendance and requirements
--      stay as they were (AC3).
-- AC6  An event that is Confirmed or in Preparation moves back to Planning
--      when one of its bookings is flagged; the move is recorded in its
--      history and the Event Organiser is told the venue arrangement is being
--      changed.
-- AC4  A venue request can name the booking it replaces
--      (venue_booking_requests.replaces_booking_id). The API only accepts it
--      for an affected booking of the same event.
-- AC5  Approving that request releases the replaced booking in the same
--      transaction (release_replaced_booking(): the old request is cancelled,
--      the history records it, the coordinator and organiser are told), which
--      removes the flag, so the event no longer shows alternative
--      arrangements as required.
begin;

alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check check (kind in
    ('venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
     'equipment_reserved', 'venue_booking_clash', 'event_confirmed',
     'event_submitted', 'coordinator_assigned', 'clarification_requested',
     'event_approved', 'event_rejected', 'venue_unavailable'));

-- AC4/AC5: the booking a request replaces. The booking is never deleted, so
-- the link is only cleared if someone removes the row.
alter table public.venue_booking_requests
  add column replaces_booking_id bigint references public.venue_bookings(booking_id) on delete set null;
create index venue_booking_requests_replaces_idx on public.venue_booking_requests (replaces_booking_id)
  where replaces_booking_id is not null;

-- AC1: tell the event's coordinator when a booking of theirs is flagged. The
-- flag rows are unique per (period, booking) and written with "on conflict do
-- nothing", so a flag that stands through a later change of the period does
-- not notify again. Bookings flagged before this migration are not announced.
--
-- AC6: an event that is Confirmed or in Preparation moves back to Planning
-- (SG2-66), because its venue arrangement is no longer in place: the move is
-- recorded in the event's history and the Event Organiser is told the venue
-- arrangement is being changed. Only the status (and the confirmation stamp,
-- which is no longer true) change; the date, time, attendance and
-- requirements are kept (AC3). The trigger runs under the venue lock the
-- unavailability and booking writes take, then locks the event, the same
-- order release_venue_booking() uses.
create function public.venue_disruption_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.venue_bookings;
  u public.venue_unavailability;
  v public.venues;
  e public.events;
  was public.event_status;
  what text;
  moved text := ' The event has moved back to Planning.';
begin
  select * into b from public.venue_bookings where booking_id = new.booking_id;
  select * into u from public.venue_unavailability where unavailability_id = new.unavailability_id;
  select * into v from public.venues where venue_id = u.venue_id;
  select * into e from public.events where event_id = b.event_id for update;
  if e.event_id is null then return null; end if;
  was := e.status;

  what := coalesce(nullif(v.name, ''), 'A venue') || ' is unavailable from '
    || to_char(u.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' to '
    || to_char(u.ends_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' SGT ('
    || replace(initcap(replace(u.category, '_', ' ')), 'Other', 'Other') || ': ' || left(u.reason, 500) || ')';

  if was in ('confirmed', 'preparation') then
    update public.events set status = 'planning', confirmed_by = null, confirmed_at = null
      where event_id = e.event_id;
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (e.event_id, auth.uid(), 'status', was::text, 'planning');
    -- AC6: the organiser hears that the venue arrangement is being changed,
    -- unless they are the coordinator, who is told below.
    if e.organiser_id is not null and e.organiser_id is distinct from e.coordinator_id then
      insert into public.notifications (recipient_id, event_id, kind, message)
        values (e.organiser_id, e.event_id, 'venue_unavailable',
          left('The venue arrangement for ' || coalesce(nullif(e.name, ''), 'Untitled event') || ' is being changed. '
            || what || '. The event has moved back to Planning while a replacement venue is found; its date, time, attendance and requirements are unchanged.', 2000));
    end if;
  end if;

  if e.coordinator_id is not null then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (e.coordinator_id, e.event_id, 'venue_unavailable',
        left(what || '. Your booking for ' || coalesce(nullif(e.name, ''), 'Untitled event') || ' ('
          || to_char(b.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' – '
          || to_char(b.ends_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI')
          || ' SGT) is affected. Find a replacement venue; the event itself has not been changed.'
          || case when was in ('confirmed', 'preparation') then moved else '' end, 2000));
  end if;
  return null;
end;
$$;
revoke all on function public.venue_disruption_notify() from public, anon, authenticated;

create trigger venue_disruption_notify
  after insert on public.venue_booking_disruptions
  for each row execute function public.venue_disruption_notify();

-- AC2: confirm_event() treats an affected booking as an outstanding venue.
-- Only the venue check changes from 202610150003.
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
  select ar.role into caller_role from public.account_roles ar where ar.user_id = caller for share;
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
  if not exists (select 1 from public.venue_booking_requests r
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
  if exists (select 1 from public.equipment_requests r
      where r.event_id = p_event_id and lower(r.status) not in ('rejected', 'cancelled')
        and (r.placement_venue_id is null or r.shortfall is distinct from 0
          or not exists (select 1 from public.equipment_reservations receipt
            where receipt.request_id = r.request_id))) then
    outstanding := outstanding || 'equipment'::text;
  end if;
  if event_row.registration_needed is true and (event_row.registration_capacity is null
      or event_row.registration_opens_at is null or event_row.registration_closes_at is null) then
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
revoke all on function public.confirm_event(integer) from public, anon, authenticated;
grant execute on function public.confirm_event(integer) to authenticated;

-- AC5: the release that follows an approved replacement. This is the system's
-- own step in the approval, so it does not depend on who may release a booking
-- by hand (release_venue_booking(), whose caller permissions are SG2-83's to
-- decide). It is not callable by any role: only decide_venue_booking_request()
-- below reaches it. Same effect as a release: the booking is cancelled with
-- the replacement as the reason, its request stops counting, the event's
-- venue moves to a booking still confirmed, the history records it and the
-- coordinator and Event Organiser are told.
create function public.release_replaced_booking(p_booking_id bigint, p_replacement_venue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.venue_bookings;
  e public.events;
  v public.venues;
  venue integer;
  instant timestamptz;
  reason text := left('Replaced by ' || p_replacement_venue || ' after the original venue became unavailable.', 500);
  period text;
begin
  select venue_id into venue from public.venue_bookings where booking_id = p_booking_id;
  if not found then return; end if;
  -- Venue before booking before event: the order every booking write uses.
  select * into v from public.venues where venue_id = venue for update;
  select * into b from public.venue_bookings where booking_id = p_booking_id for update;
  instant := clock_timestamp();
  -- A booking already released, or already over, is left as it is.
  if b.status <> 'confirmed' or b.ends_at <= instant then return; end if;
  select * into e from public.events where event_id = b.event_id for update;

  update public.venue_bookings
    set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = instant, cancellation_reason = reason
    where booking_id = b.booking_id
    returning * into b;
  update public.venue_booking_requests set status = 'cancelled'
    where venue_booking_id = b.booking_id and status = 'approved';
  update public.events
    set venue_booking_id = (select x.booking_id from public.venue_bookings x
      where x.event_id = e.event_id and x.status = 'confirmed' and x.ends_at > instant
      order by x.starts_at, x.booking_id limit 1)
    where event_id = e.event_id and venue_booking_id = b.booking_id;
  period := to_char(b.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' – '
    || to_char(b.ends_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI');
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (e.event_id, auth.uid(), 'venue_booking',
      'Confirmed: ' || v.name || ' (booking ' || b.booking_id || ')',
      'Released: ' || v.name || ' (booking ' || b.booking_id || ') — ' || reason);
  insert into public.notifications (recipient_id, event_id, request_id, kind, message)
    select distinct recipient, e.event_id, null::bigint, 'venue_booking_released',
      v.name || ' was released for ' || coalesce(nullif(e.name, ''), 'Untitled event')
        || ' (' || period || ' SGT): ' || reason
    from unnest(array[e.coordinator_id, e.organiser_id]) as recipient
    where recipient is not null;
end;
$$;
revoke all on function public.release_replaced_booking(bigint, text) from public, anon, authenticated;

-- AC4/AC5: approving a replacement releases the booking it replaces. Only the
-- parts marked SG2-81 change from 202610160001.
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
revoke all on function public.decide_venue_booking_request(bigint, text, text) from public, anon, authenticated;
grant execute on function public.decide_venue_booking_request(bigint, text, text) to authenticated;

commit;
