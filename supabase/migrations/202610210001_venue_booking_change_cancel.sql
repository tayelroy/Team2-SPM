-- SG2-83 (Week 7 customer change #3): change or cancel one venue of a
-- multi-venue event.
--
-- AC1  Cancelling or changing one booking touches only that booking; the
--      event's other bookings stay as they were.
-- AC2  Other bookings of the event are cancelled only when the coordinator
--      names them in the same call (release_venue_bookings' p_also_cancel).
-- AC3  A cancelled booking leaves venue_booking_occupancy and every conflict
--      check (they read held and confirmed bookings only), so the period and
--      the setup/turnaround around it (SG2-78) are free again.
-- AC4  Each cancellation keeps who, when and why on the booking and in the
--      event's history; a change request keeps its reason on the request and
--      in the history. Venue Staff are told of both. Venues have no assigned
--      staff, so every Venue Staff account is told.
-- AC5  Only the event's assigned coordinator, acting as Event Coordinator,
--      cancels a booking. This replaces SG2-51's Venue Staff release: Venue
--      Staff mark the venue unavailable (SG2-80) instead.
-- AC7  On a Confirmed or Preparation event, cancelling a booking, or asking
--      to change one, returns the event to Planning with a venue recheck
--      outstanding (SG2-66), so it goes through the checks again before it
--      can be confirmed. A change is a replacement request (SG2-81) that
--      Venue Staff approve; the booking it replaces stays until then.
--
-- release_venue_booking() is redefined from its latest body
-- (202610200002_acting_role_functions.sql) and keeps lock_acting_role().
begin;

-- AC4: Venue Staff notices. Added to whatever list is already allowed, as
-- 202610200004 does, so no earlier kind is lost.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['venue_booking_cancelled', 'venue_change_requested']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- AC4: why the coordinator asked to change a booking. Only a request that
-- replaces a booking has one.
alter table public.venue_booking_requests
  add column change_reason text,
  add constraint venue_booking_requests_change_reason_length check (char_length(change_reason) <= 500),
  add constraint venue_booking_requests_change_reason_replaces
    check (change_reason is null or replaces_booking_id is not null);

-- AC4: every Venue Staff account hears about the venue, except the person
-- who made the change. Callers hold the event row lock.
create function public.notify_venue_staff(p_event_id integer, p_actor uuid, p_kind text, p_message text)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, event_id, kind, message)
    select distinct ar.user_id, p_event_id, p_kind, left(p_message, 2000)
    from public.account_roles ar
    where ar.role = 'venue_staff' and ar.user_id is distinct from p_actor;
$$;
revoke all on function public.notify_venue_staff(integer, uuid, text, text) from public, anon, authenticated;

-- AC7: a Confirmed or Preparation event goes back to Planning because one of
-- its venues is being cancelled or changed. Its confirmation stamp is no
-- longer true. A change keeps the venue outstanding by itself (its request is
-- pending until Venue Staff decide it); a cancellation leaves nothing
-- pending, so p_recheck marks a venue recheck outstanding (SG2-66) that keeps
-- the event in Planning until the coordinator settles it. The move is in the
-- history and the organiser and coordinator are told, in SG2-66's words.
-- Returns whether the event moved. Callers hold the event row lock.
create function public.return_event_to_planning_for_venue(p_event_id integer, p_actor uuid, p_recheck boolean)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
  label text;
begin
  select * into e from public.events where event_id = p_event_id;
  if not found or e.status not in ('confirmed', 'preparation') then return false; end if;
  update public.events set
      status = 'planning', confirmed_by = null, confirmed_at = null,
      arrangements_recheck_needed = coalesce(arrangements_recheck_needed, false) or p_recheck,
      outstanding_arrangements = case
        when not p_recheck or coalesce(outstanding_arrangements, '[]'::jsonb) @> '["venue_recheck"]'::jsonb
          then outstanding_arrangements
        else coalesce(outstanding_arrangements, '[]'::jsonb) || '["venue_recheck"]'::jsonb end
    where event_id = p_event_id;
  if p_actor is not null then
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (p_event_id, p_actor, 'status', e.status::text, 'planning');
  end if;
  label := left(coalesce(nullif(e.name, ''), 'Untitled event'), 500);
  insert into public.notifications (recipient_id, event_id, kind, message)
    values (e.organiser_id, p_event_id, 'event_returned_to_planning',
      label || ' has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.');
  if e.coordinator_id is not null and e.coordinator_id is distinct from e.organiser_id then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (e.coordinator_id, p_event_id, 'event_returned_to_planning',
        label || ' is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.');
  end if;
  return true;
end;
$$;
revoke all on function public.return_event_to_planning_for_venue(integer, uuid, boolean) from public, anon, authenticated;

-- AC1/AC2/AC5: the coordinator cancels one booking of their event, and only
-- the others they name as well. Everything is checked before anything
-- changes, so a refusal leaves every booking as it was. Locks the venues
-- lowest id first, then the bookings, then the event: the order every booking
-- write and decide_venue_booking_request() use.
create function public.release_venue_bookings(p_booking_id bigint, p_also_cancel bigint[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason text := nullif(btrim(p_reason), '');
  also bigint[];
  wanted bigint[];
  b public.venue_bookings;
  e public.events;
  v public.venues;
  instant timestamptz;
  period text;
  released bigint[] := array[]::bigint[];
  returned boolean;
  actor_name text;
begin
  -- AC5: only while acting as Event Coordinator. Venue Staff and every other
  -- role are refused here as well as by the API.
  if public.lock_acting_role() is distinct from 'event_coordinator' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  also := array(select distinct x from unnest(coalesce(p_also_cancel, array[]::bigint[])) x
    where x is not null and x <> p_booking_id order by x);
  if reason is null or char_length(reason) > 500 or cardinality(also) > 50 then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  wanted := p_booking_id || also;

  perform 1 from public.venue_bookings vb where vb.booking_id = p_booking_id;
  if not found then return jsonb_build_object('outcome', 'missing'); end if;
  perform 1 from public.venues where venue_id in
    (select vb.venue_id from public.venue_bookings vb where vb.booking_id = any(wanted))
    order by venue_id for update;
  perform 1 from public.venue_bookings where booking_id = any(wanted) order by booking_id for update;
  select * into b from public.venue_bookings where booking_id = p_booking_id;
  if b.event_id is not null then
    select * into e from public.events where events.event_id = b.event_id for update;
  end if;
  -- Only the event's assigned coordinator; any other booking is reported as
  -- missing so it is not revealed.
  if e.event_id is null or e.coordinator_id is distinct from auth.uid() then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if b.status <> 'confirmed' then
    return jsonb_build_object('outcome', 'inactive', 'status', b.status);
  end if;
  instant := clock_timestamp();
  if b.ends_at <= instant then
    return jsonb_build_object('outcome', 'past');
  end if;
  -- AC2: every other booking named must be a live booking of the same event.
  if exists (select 1 from unnest(also) x
      where not exists (select 1 from public.venue_bookings o where o.booking_id = x
        and o.event_id = e.event_id and o.status = 'confirmed' and o.ends_at > instant)) then
    return jsonb_build_object('outcome', 'others_invalid');
  end if;

  select u.name into actor_name from public.users u where u.user_id = auth.uid();
  for b in select * from public.venue_bookings where booking_id = any(wanted) order by starts_at, booking_id loop
    update public.venue_bookings
      set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = instant, cancellation_reason = reason
      where booking_id = b.booking_id;
    -- AC3: the request that committed the booking no longer counts, so the
    -- venue can be requested again.
    update public.venue_booking_requests set status = 'cancelled'
      where venue_booking_id = b.booking_id and status = 'approved';
    select * into v from public.venues where venue_id = b.venue_id;
    period := to_char(b.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' – '
      || to_char(b.ends_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI');
    -- AC4: who, when and why, in the event's history (SG2-40).
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (e.event_id, auth.uid(), 'venue_booking',
        'Confirmed: ' || v.name || ' (booking ' || b.booking_id || ')',
        'Released: ' || v.name || ' (booking ' || b.booking_id || ') — ' || reason);
    -- SG2-51 AC4: the coordinator and the Event Organiser are told, with the reason.
    insert into public.notifications (recipient_id, event_id, request_id, kind, message)
      select distinct recipient, e.event_id, null::bigint, 'venue_booking_released',
        v.name || ' was released for ' || coalesce(nullif(e.name, ''), 'Untitled event')
          || ' (' || period || ' SGT): ' || reason
      from unnest(array[e.coordinator_id, e.organiser_id]) as recipient
      where recipient is not null;
    -- AC4: and Venue Staff, who no longer release bookings themselves.
    perform public.notify_venue_staff(e.event_id, auth.uid(), 'venue_booking_cancelled',
      coalesce(actor_name, 'The coordinator') || ' cancelled the booking of ' || v.name || ' for '
        || coalesce(nullif(e.name, ''), 'Untitled event') || ' (' || period || ' SGT): ' || reason
        || '. The venue is available again for that period.');
    released := released || b.booking_id;
  end loop;

  -- AC1: the event keeps its other venues; its main venue moves to the
  -- earliest one still confirmed and not yet over, if any.
  update public.events
    set venue_booking_id = (select x.booking_id from public.venue_bookings x
      where x.event_id = e.event_id and x.status = 'confirmed' and x.ends_at > instant
      order by x.starts_at, x.booking_id limit 1)
    where events.event_id = e.event_id and venue_booking_id = any(released);
  -- AC7
  returned := public.return_event_to_planning_for_venue(e.event_id, auth.uid(), true);

  return jsonb_build_object('outcome', 'released', 'booking_id', p_booking_id, 'cancelled_at', instant,
    'also_released', to_jsonb(also), 'returned_to_planning', returned);
end;
$$;
revoke all on function public.release_venue_bookings(bigint, bigint[], text) from public, anon, authenticated;
grant execute on function public.release_venue_bookings(bigint, bigint[], text) to authenticated;

-- SG2-51's single release, kept for its callers: one booking and no others.
-- AC5: the role check now lives in release_venue_bookings().
create or replace function public.release_venue_booking(p_booking_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.release_venue_bookings(p_booking_id, array[]::bigint[], p_reason);
end;
$$;

-- AC1/AC4/AC7: a request that replaces a booking (SG2-81's link, now for any
-- confirmed booking of the event) is a change of that venue. The database
-- refuses one that names a booking of another event, or one already cancelled
-- or over, so a change raised while the booking is being cancelled cannot
-- slip through. Locks the event row, as every arrangement writer does.
create function public.venue_change_request_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.replaces_booking_id is null then return new; end if;
  if not exists (select 1 from public.venue_bookings b where b.booking_id = new.replaces_booking_id
      and b.event_id = new.event_id and b.status = 'confirmed' and b.ends_at > clock_timestamp()) then
    raise exception using errcode = '23514',
      message = 'A change must replace a confirmed booking of the same event that has not ended';
  end if;
  return new;
end;
$$;
revoke all on function public.venue_change_request_check() from public, anon, authenticated;

create trigger venue_change_request_check before insert on public.venue_booking_requests
  for each row when (new.replaces_booking_id is not null)
  execute function public.venue_change_request_check();

create function public.venue_change_requested()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  e public.events;
  b public.venue_bookings;
  old_venue text;
  new_venue text;
  actor uuid;
  period text;
begin
  select * into e from public.events where event_id = new.event_id for update;
  select * into b from public.venue_bookings where booking_id = new.replaces_booking_id;
  select name into old_venue from public.venues where venue_id = b.venue_id;
  select name into new_venue from public.venues where venue_id = new.venue_id;
  actor := coalesce(auth.uid(), new.requested_by, e.coordinator_id);
  period := to_char(new.starts_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' – '
    || to_char(new.ends_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI');
  -- AC4: the change and its reason, in the event's history.
  if actor is not null then
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (e.event_id, actor, 'venue_booking',
        'Confirmed: ' || old_venue || ' (booking ' || b.booking_id || ')',
        'Change requested: ' || old_venue || ' (booking ' || b.booking_id || ') to ' || new_venue
          || ' (request ' || new.request_id || ')' || coalesce(' — ' || new.change_reason, ''));
  end if;
  -- AC4: Venue Staff decide the change, so they are told.
  perform public.notify_venue_staff(e.event_id, actor, 'venue_change_requested',
    'A change is requested for ' || coalesce(nullif(e.name, ''), 'Untitled event') || ': ' || old_venue
      || ' (booking ' || b.booking_id || ') to ' || new_venue || ' (' || period || ' SGT)'
      || coalesce(': ' || new.change_reason, '') || '. The current booking stays until the change is approved.');
  -- AC7
  perform public.return_event_to_planning_for_venue(e.event_id, actor, false);
  return null;
end;
$$;
revoke all on function public.venue_change_requested() from public, anon, authenticated;

create trigger venue_change_requested after insert on public.venue_booking_requests
  for each row when (new.replaces_booking_id is not null)
  execute function public.venue_change_requested();

-- AC4: the release that follows an approved change gives the coordinator's
-- reason. Unchanged from 202610170001_venue_replacement.sql (SG2-81) except
-- the reason, which keeps SG2-81's wording for a replacement without one.
create or replace function public.release_replaced_booking(p_booking_id bigint, p_replacement_venue text)
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
  change text;
  reason text;
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
  select q.change_reason into change from public.venue_booking_requests q
    where q.replaces_booking_id = p_booking_id and q.status = 'approved'
    order by q.decided_at desc nulls last, q.request_id desc limit 1;
  reason := left(case when change is null
    then 'Replaced by ' || p_replacement_venue || ' after the original venue became unavailable.'
    else 'Changed to ' || p_replacement_venue || ': ' || change end, 500);

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

commit;
