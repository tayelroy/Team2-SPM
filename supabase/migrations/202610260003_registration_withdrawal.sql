-- SG2-62: an attendee sees and withdraws their registrations.
--
-- AC1: my_registrations() lists every registration the calling attendee has
-- made, with the event's attendee-facing details (SG2-59 AC3's fields) and
-- where it stands: registered, withdrawn, or the event was cancelled, has
-- started or is completed. Unlike registrable_events() it keeps an event
-- after registration closes, so an attendee still sees what they signed up
-- for.
-- AC2: withdraw_registration() withdraws an active registration at any time
-- before the event's current start time (events.proposed_date, which SG2-66
-- changes may move), whether or not registration is still open. The screen
-- asks the attendee to confirm first.
-- AC3: a withdrawal sets the status to 'cancelled', the one status that
-- gives a place back wherever places are counted (SG2-63, SG2-66,
-- register_for_event), and records withdrawn_at.
-- AC4: at or after the start time the withdrawal is refused as started.
-- AC5: the organiser and the assigned coordinator are sent a
-- registration_withdrawn notice with the places now remaining.
-- AC6 (waiting-list promotion) is delivered with SG2-61's waiting list.
--
-- A withdrawal locks the event row first, the same lock register_for_event
-- and SG2-63's settings changes take, so a freed place and a registration
-- for it are decided one at a time. Both functions run with the caller's
-- JWT and recheck the acting role is attendee (SG2-104).
begin;

alter table public.registrations
  add column withdrawn_at timestamptz,
  add constraint registrations_withdrawn_cancelled
    check (withdrawn_at is null or lower(coalesce(status, '')) = 'cancelled');

-- Adds the kind to whatever list is already allowed, as SG2-63 did.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['registration_withdrawn']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- AC1: the caller's registrations, still-active upcoming ones first.
create function public.my_registrations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  instant timestamptz := clock_timestamp();
begin
  if caller is null or public.acting_role() is distinct from 'attendee' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'registration_id', mine.registration_id,
      'event_id', mine.event_id,
      'standing', mine.standing,
      'can_withdraw', mine.standing = 'registered',
      'registered_at', mine.registered_at,
      'withdrawn_at', mine.withdrawn_at,
      'contact_phone', mine.contact_phone,
      'needs', mine.needs,
      'event', jsonb_build_object(
        'name', mine.name,
        'organisation', mine.organisation,
        'category', mine.category,
        'description', mine.description,
        'proposed_date', mine.proposed_date,
        'registration_closes_at', mine.registration_closes_at,
        'venues', coalesce((
          select jsonb_agg(jsonb_build_object('name', v.name, 'location', v.location) order by v.name, v.venue_id)
          from public.venues v
          where v.venue_id in (select b.venue_id from public.venue_bookings b
            where b.event_id = mine.event_id and b.status = 'confirmed')), '[]'::jsonb))
    ) order by mine.standing = 'registered' desc, mine.proposed_date, mine.registration_id), '[]'::jsonb)
    from (
      select r.registration_id, r.event_id, r.registered_at, r.withdrawn_at, r.contact_phone, r.needs,
        e.name, e.organisation, e.category, e.description, e.proposed_date, e.registration_closes_at,
        case
          when lower(coalesce(r.status, '')) = 'cancelled' then 'withdrawn'
          when e.status = 'cancelled' then 'event_cancelled'
          when e.status = 'completed' then 'event_completed'
          when e.proposed_date is not null and instant >= e.proposed_date then 'event_started'
          else 'registered' end as standing
      from public.registrations r
      join public.events e on e.event_id = r.event_id
      where r.attendee_id = caller) mine);
end;
$$;

-- AC2-AC5: withdraws one of the caller's registrations. Outcomes: ok (with
-- the withdrawal), missing (not the caller's), withdrawn (already),
-- cancelled (the event was cancelled), started (AC4: with the start time).
create function public.withdraw_registration(p_registration_id integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target integer;
  e public.events;
  r public.registrations;
  instant timestamptz;
  remaining integer;
  attendee_name text;
  message text;
begin
  -- A write: lock_acting_role() holds the caller's roles until it commits (SG2-104).
  if caller is null or public.lock_acting_role() is distinct from 'attendee' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;

  -- A registration never moves event, so its event can be locked before it.
  select event_id into target from public.registrations
    where registration_id = p_registration_id and attendee_id = caller;
  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;
  select * into e from public.events where event_id = target for update;
  select * into r from public.registrations where registration_id = p_registration_id for update;
  -- The clock is read after the locks, so a wait never lets a late attempt in.
  instant := clock_timestamp();
  if lower(coalesce(r.status, '')) = 'cancelled' then
    return jsonb_build_object('outcome', 'withdrawn');
  end if;
  if e.status = 'cancelled' then
    return jsonb_build_object('outcome', 'cancelled');
  end if;
  if e.status = 'completed' or (e.proposed_date is not null and instant >= e.proposed_date) then
    return jsonb_build_object('outcome', 'started', 'proposed_date', e.proposed_date);
  end if;

  update public.registrations set status = 'cancelled', withdrawn_at = instant
    where registration_id = r.registration_id;

  -- AC3, AC5: the place is back; tell the organiser and the coordinator.
  if e.registration_capacity is not null then
    remaining := greatest(e.registration_capacity - (select count(*) from public.registrations x
      where x.event_id = e.event_id and lower(coalesce(x.status, '')) <> 'cancelled'), 0);
  end if;
  select left(coalesce(nullif(u.name, ''), 'An attendee'), 200) into attendee_name
    from public.users u where u.user_id = caller;
  message := coalesce(attendee_name, 'An attendee') || ' withdrew from '
    || left(coalesce(nullif(e.name, ''), 'Untitled event'), 200) || '.'
    || coalesce(' ' || remaining || ' of ' || e.registration_capacity || ' places now remain.', '');
  insert into public.notifications (recipient_id, event_id, kind, message)
    select recipient, e.event_id, 'registration_withdrawn', message
    from (select distinct recipient from unnest(array[e.organiser_id, e.coordinator_id]) recipient
      where recipient is not null) staff;

  return jsonb_build_object('outcome', 'ok', 'registration', jsonb_build_object(
    'registration_id', r.registration_id, 'event_id', e.event_id, 'withdrawn_at', instant));
end;
$$;

revoke all on function public.my_registrations(), public.withdraw_registration(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.my_registrations(), public.withdraw_registration(integer) to authenticated;

commit;
