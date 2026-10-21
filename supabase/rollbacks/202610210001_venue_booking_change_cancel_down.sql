-- Rollback for 202610210001_venue_booking_change_cancel.sql (SG2-83).
--
-- Restores the database to how it was before that migration, so it can be
-- applied again later:
--   * release_venue_booking() goes back to SG2-104's body (Venue Staff or the
--     assigned coordinator may release; copied verbatim from
--     202610200002_acting_role_functions.sql).
--   * release_replaced_booking() goes back to SG2-81's body (copied verbatim
--     from 202610170001_venue_replacement.sql).
--   * The change-request triggers and the new functions are dropped.
--   * venue_booking_requests.change_reason is dropped. Each reason is still
--     in the event's history ('Change requested: ... — <reason>').
--   * The 'venue_booking_cancelled' and 'venue_change_requested' notices are
--     deleted and the two kinds removed from notifications_kind_check.
--
-- Not undone (data, not schema): bookings already cancelled, change requests
-- already raised (still pending with replaces_booking_id, so approving one
-- still releases the booking it names), and events already returned to
-- Planning with a venue_recheck. Review these before rolling back on a live
-- database; rehearse it first inside BEGIN ... ROLLBACK.
--
-- Not a migration: keep it out of supabase/migrations, where every file is
-- applied in order.
begin;

drop trigger if exists venue_change_requested on public.venue_booking_requests;
drop trigger if exists venue_change_request_check on public.venue_booking_requests;
drop function if exists public.venue_change_requested();
drop function if exists public.venue_change_request_check();

-- SG2-104's release_venue_booking(), verbatim. Replaced before
-- release_venue_bookings() is dropped, because the SG2-83 body calls it.
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

drop function if exists public.release_venue_bookings(bigint, bigint[], text);
drop function if exists public.return_event_to_planning_for_venue(integer, uuid, boolean);
drop function if exists public.notify_venue_staff(integer, uuid, text, text);

-- SG2-81's release_replaced_booking(), verbatim (create or replace keeps it
-- uncallable by any role, as before).
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

alter table public.venue_booking_requests
  drop constraint if exists venue_booking_requests_change_reason_replaces,
  drop constraint if exists venue_booking_requests_change_reason_length,
  drop column if exists change_reason;

-- Remove the two SG2-83 kinds from whatever list is allowed, keeping every
-- other kind, as 202610200004 adds kinds.
delete from public.notifications where kind in ('venue_booking_cancelled', 'venue_change_requested');
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := array(select kind from unnest(kinds) kind where kind not in ('venue_booking_cancelled', 'venue_change_requested'));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

commit;
