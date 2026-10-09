-- SG2-51: Venue Staff, or the event's assigned coordinator, release a venue
-- booking the event no longer needs.
--
-- The booking is cancelled with a reason (AC1) and the period is free again
-- (AC2): only held and confirmed bookings appear in availability, search and
-- every conflict check. Only the released booking changes, so an event with
-- several venues keeps the others (AC3). The coordinator and the Event
-- Organiser are notified (AC4), and who released it, when and why are kept on
-- the booking and in the event's history (AC5).
--
-- Releases go through release_venue_booking(), run with the caller's own
-- login so cancelled_by is the real person. Like SG2-49's decisions it locks
-- the venue row first, then the booking.
begin;

alter table public.venue_bookings drop constraint venue_bookings_status_check;
alter table public.venue_bookings
  add constraint venue_bookings_status_check check (status in ('held', 'confirmed', 'cancelled')),
  add column cancelled_by uuid references public.users(user_id) on delete set null,
  add column cancelled_at timestamptz,
  add column cancellation_reason text;

-- A released booking always says when and why (AC5).
alter table public.venue_bookings
  add constraint venue_bookings_cancellation_recorded
  check ((status = 'cancelled') = (cancelled_at is not null)),
  add constraint venue_bookings_cancellation_reason
  check (status <> 'cancelled' or nullif(btrim(cancellation_reason), '') is not null),
  add constraint venue_bookings_cancellation_reason_length
  check (char_length(cancellation_reason) <= 500);

-- AC2: a released booking no longer occupies its venue anywhere the shared
-- occupancy view is read (availability and search). Unchanged otherwise from
-- SG2-84.
create or replace view public.venue_booking_occupancy with (security_invoker = true) as
select b.venue_id, b.starts_at, b.ends_at, b.status, b.event_id from public.venue_bookings b
where b.status in ('held', 'confirmed')
union all
select h.venue_id, h.starts_at, h.ends_at, h.status, h.event_id from public.venue_hold_occupancy() h;

-- AC4: release notices share SG2-49's notifications table.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('venue_request_approved', 'venue_request_rejected', 'venue_booking_released'));

create function public.release_venue_booking(p_booking_id bigint, p_reason text)
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
  select role into caller_role from public.account_roles where user_id = auth.uid();
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
revoke all on function public.release_venue_booking(bigint, text) from public, anon, authenticated;
grant execute on function public.release_venue_booking(bigint, text) to authenticated;

commit;
