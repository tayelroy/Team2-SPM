-- SG2-61: refused when the event is full, the capacity-reached notice and
-- the waiting list; with SG2-62 AC6, offering a freed place to the list.
--
-- AC1: register_for_event() already refuses a full event (SG2-60); the
-- attendee's read now says so (registrable_events_json 'full').
-- AC2: every function here locks the event row first, as SG2-60/62/63 do,
-- so the last place is decided one attempt at a time.
-- AC3: the registration that takes the last place sends a registration_full
-- notice to the organiser and the assigned coordinator.
-- AC4: capacity stays the organiser's setting (SG2-63); raising it offers the
-- new places to the waiting list first.
-- AC5: join_waiting_list() puts the caller on a full event's list, first
-- come first served; their read carries their position.
-- AC6: one active entry per attendee per event (function and partial unique
-- index), none while registered; leave_waiting_list() works at any time.
-- AC7: event_registration_overview() carries the list for the organiser and
-- coordinator; the server decides who sees it, as for the attendees.
-- SG2-62 AC6: when a withdrawal or a capacity increase frees a place, the
-- first waiting attendee is offered it (waiting_list_offer notice) and the
-- place is held for them for the organiser's response window
-- (events.waiting_list_response_hours), or until registration closes if
-- sooner. An offer not taken in time lapses (waiting_list_offer_lapsed) and
-- the place goes to the next attendee. process_waiting_list_offers() catches
-- lapsed offers every minute; every write here also catches them first.
--
-- A place counts as held by an active registration (not cancelled, as
-- before) or an offer that has not run out (private.places_held).
begin;

-- Team decision, 28 Oct 2026 (PO to confirm): hours, from 1 to a week, 24
-- by default. SG2-62 AC6 names the window but no story sets it.
alter table public.events
  add column waiting_list_response_hours integer not null default 24
    constraint events_waiting_list_response_hours_range check (waiting_list_response_hours between 1 and 168);

create table public.waiting_list_entries (
  entry_id          bigserial primary key,
  event_id          integer not null references public.events(event_id) on delete cascade,
  attendee_id       uuid not null references public.users(user_id) on delete cascade,
  status            text not null default 'waiting',
  joined_at         timestamptz not null default clock_timestamp(),
  offered_at        timestamptz,
  offer_expires_at  timestamptz,
  ended_at          timestamptz,
  -- waiting and offered are on the list; the rest have left it.
  constraint waiting_list_entries_status_known
    check (status in ('waiting', 'offered', 'registered', 'left', 'lapsed')),
  constraint waiting_list_entries_offer_recorded
    check (status <> 'offered' or (offered_at is not null and offer_expires_at is not null)),
  constraint waiting_list_entries_ended_recorded
    check ((status in ('waiting', 'offered')) = (ended_at is null))
);

-- AC6: at most one active entry per attendee per event.
create unique index waiting_list_one_active_per_attendee on public.waiting_list_entries (event_id, attendee_id)
  where status in ('waiting', 'offered');
-- AC5: the queue, first come first served.
create index waiting_list_entries_queue_idx on public.waiting_list_entries (event_id, joined_at, entry_id)
  where status in ('waiting', 'offered');

alter table public.waiting_list_entries enable row level security;
alter table public.waiting_list_entries force row level security;
revoke all on table public.waiting_list_entries from public, anon, authenticated;
revoke all on sequence public.waiting_list_entries_entry_id_seq from public, anon, authenticated;
grant select on table public.waiting_list_entries to service_role;
-- No policies: attendees reach their entries only through the functions below.

-- Adds the kinds to whatever list is already allowed, as SG2-63 did.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['registration_full', 'waiting_list_offer', 'waiting_list_offer_lapsed']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- Places held on an event: active registrations and offers still running,
-- leaving out p_except's own offer (they may take the place it holds).
create function private.places_held(p_event_id integer, p_except uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select ((select count(*) from public.registrations r
      where r.event_id = p_event_id and lower(coalesce(r.status, '')) <> 'cancelled')
    + (select count(*) from public.waiting_list_entries w
      where w.event_id = p_event_id and w.status = 'offered' and w.offer_expires_at > clock_timestamp()
        and w.attendee_id is distinct from p_except))::integer;
$$;

-- An attendee's place on an event's list: 1 for the next to be offered.
create function private.waiting_position(p_entry_id bigint)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.waiting_list_entries w
    join public.waiting_list_entries mine on mine.entry_id = p_entry_id
    where w.event_id = mine.event_id and w.status = 'waiting'
      and (w.joined_at, w.entry_id) <= (mine.joined_at, mine.entry_id);
$$;

-- SG2-62 AC6: lapses offers that ran out, then offers every free place to
-- the next waiting attendee while registration is open. Callers hold the
-- event row lock.
create function private.offer_waiting_places(p_event_id integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
  instant timestamptz := clock_timestamp();
  event_label text;
  next_entry public.waiting_list_entries;
  expires timestamptz;
  lapsed record;
begin
  select * into e from public.events where event_id = p_event_id;
  if not found then return; end if;
  event_label := left(coalesce(nullif(e.name, ''), 'Untitled event'), 200);

  -- An offer ends when its time runs out, or when registration can no longer
  -- be taken (closed early, the event moved, cancelled). Only an attendee
  -- whose time ran out is told: the other cases have their own notices.
  for lapsed in
    update public.waiting_list_entries set status = 'lapsed', ended_at = instant
      where event_id = p_event_id and status = 'offered'
        and (instant >= offer_expires_at or e.status is distinct from 'confirmed'
          or e.registration_closes_at is null or instant >= e.registration_closes_at
          or e.proposed_date is null or instant >= e.proposed_date)
      returning attendee_id, offer_expires_at
  loop
    if instant >= lapsed.offer_expires_at then
      insert into public.notifications (recipient_id, event_id, kind, message)
        values (lapsed.attendee_id, p_event_id, 'waiting_list_offer_lapsed',
          'The place held for you at ' || event_label || ' was not taken by '
            || to_char(lapsed.offer_expires_at at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' SGT, so it was released.');
    end if;
  end loop;

  if e.status is distinct from 'confirmed' or e.registration_needed is not true
      or e.registration_opens_at is null or e.registration_closes_at is null or e.proposed_date is null
      or instant < e.registration_opens_at or instant >= e.registration_closes_at or instant >= e.proposed_date then
    return;
  end if;
  loop
    exit when e.registration_capacity is not null and private.places_held(p_event_id, null) >= e.registration_capacity;
    select * into next_entry from public.waiting_list_entries
      where event_id = p_event_id and status = 'waiting'
      order by joined_at, entry_id limit 1 for update;
    exit when not found;
    expires := least(instant + make_interval(hours => e.waiting_list_response_hours), e.registration_closes_at, e.proposed_date);
    update public.waiting_list_entries set status = 'offered', offered_at = instant, offer_expires_at = expires
      where entry_id = next_entry.entry_id;
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (next_entry.attendee_id, p_event_id, 'waiting_list_offer',
        'A place has opened at ' || event_label || '. It is held for you until '
          || to_char(expires at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' SGT: register from Find events to take it.');
  end loop;
end;
$$;

-- Lapsed offers on schedule: every event with an offer that has run out or
-- whose registration can no longer be taken.
create function public.process_waiting_list_offers()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  target integer;
  processed integer := 0;
  instant timestamptz := clock_timestamp();
begin
  for target in
    select distinct w.event_id from public.waiting_list_entries w
      join public.events e on e.event_id = w.event_id
      where w.status = 'offered'
        and (instant >= w.offer_expires_at or e.status is distinct from 'confirmed'
          or e.registration_closes_at is null or instant >= e.registration_closes_at
          or e.proposed_date is null or instant >= e.proposed_date)
      order by w.event_id
  loop
    -- Lock each event on its own; skip one a registration is holding.
    perform 1 from public.events where event_id = target for update skip locked;
    if found then
      perform private.offer_waiting_places(target);
      processed := processed + 1;
    end if;
  end loop;
  return processed;
end;
$$;

-- SG2-60's registration, now taking a place offered from the waiting list
-- (SG2-62 AC6) and telling the organiser and coordinator when it fills the
-- event (AC3). A place held for someone else's offer is not free.
create or replace function public.register_for_event(p_event_id integer, p_contact_phone text, p_needs text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  phone text := nullif(btrim(p_contact_phone), '');
  needs text := nullif(btrim(p_needs), '');
  e public.events;
  instant timestamptz;
  created public.registrations;
  venues text;
  registered integer;
begin
  -- A write: lock_acting_role() holds the caller's roles until it commits (SG2-104).
  if caller is null or public.lock_acting_role() is distinct from 'attendee' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if phone is null or char_length(phone) > 40
      or regexp_replace(phone, '[().[:space:]-]', '', 'g') !~ '^(\+65)?[0-9]{8}$'
      or char_length(needs) > 500 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select * into e from public.events where event_id = p_event_id for update;
  -- The clock is read after the lock, so a wait never lets a late attempt in.
  instant := clock_timestamp();
  if not found or e.status is distinct from 'confirmed' or e.registration_needed is not true
      or e.registration_opens_at is null or e.registration_closes_at is null or e.proposed_date is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if exists(select 1 from public.registrations r where r.event_id = p_event_id and r.attendee_id = caller
      and lower(coalesce(r.status, '')) <> 'cancelled') then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if instant >= e.registration_closes_at or instant >= e.proposed_date then
    return jsonb_build_object('outcome', 'closed', 'registration_closes_at', e.registration_closes_at);
  end if;
  if instant < e.registration_opens_at then
    return jsonb_build_object('outcome', 'not_open', 'registration_opens_at', e.registration_opens_at);
  end if;
  -- Offers that ran out are released first, so their places count as free.
  perform private.offer_waiting_places(p_event_id);
  if e.registration_capacity is not null and e.registration_capacity <= private.places_held(p_event_id, caller) then
    return jsonb_build_object('outcome', 'full');
  end if;

  insert into public.registrations (event_id, attendee_id, status, registered_at, contact_phone, needs)
    values (p_event_id, caller, 'registered', instant, phone, needs)
    returning * into created;
  -- Registered, so off the waiting list (an offer taken, or a place found).
  update public.waiting_list_entries set status = 'registered', ended_at = instant
    where event_id = p_event_id and attendee_id = caller and status in ('waiting', 'offered');

  -- The event information, in the wording the other database notices use.
  select string_agg(v.name, ', ' order by v.name, v.venue_id) into venues
    from public.venues v
    where v.venue_id in (select b.venue_id from public.venue_bookings b
      where b.event_id = p_event_id and b.status = 'confirmed');
  insert into public.notifications (recipient_id, event_id, kind, message)
    values (caller, p_event_id, 'registration_confirmed',
      'You are registered for ' || left(coalesce(nullif(e.name, ''), 'Untitled event'), 200) || ' on '
        || to_char(e.proposed_date at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' SGT'
        || coalesce(' at ' || left(venues, 500), '') || '.');

  -- AC3: this registration took the last place.
  select count(*) into registered from public.registrations r
    where r.event_id = p_event_id and lower(coalesce(r.status, '')) <> 'cancelled';
  if e.registration_capacity is not null and registered = e.registration_capacity then
    insert into public.notifications (recipient_id, event_id, kind, message)
      select recipient, p_event_id, 'registration_full',
        left(coalesce(nullif(e.name, ''), 'Untitled event'), 200) || ' is now full: all places are taken (capacity '
          || e.registration_capacity || ').'
      from (select distinct recipient from unnest(array[e.organiser_id, e.coordinator_id]) recipient
        where recipient is not null) staff;
  end if;

  return jsonb_build_object('outcome', 'ok', 'registration', jsonb_build_object(
    'registration_id', created.registration_id, 'event_id', created.event_id,
    'registered_at', created.registered_at, 'contact_phone', created.contact_phone, 'needs', created.needs));
end;
$$;

-- AC5, AC6: puts the calling attendee on a full event's waiting list.
-- Outcomes: ok and already (with where they stand), missing (as
-- register_for_event), registered (AC6: holds a place), not_open, closed,
-- not_full (a place is free: register instead).
create function public.join_waiting_list(p_event_id integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  e public.events;
  instant timestamptz;
  entry public.waiting_list_entries;
begin
  if caller is null or public.lock_acting_role() is distinct from 'attendee' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  select * into e from public.events where event_id = p_event_id for update;
  instant := clock_timestamp();
  if not found or e.status is distinct from 'confirmed' or e.registration_needed is not true
      or e.registration_opens_at is null or e.registration_closes_at is null or e.proposed_date is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if exists(select 1 from public.registrations r where r.event_id = p_event_id and r.attendee_id = caller
      and lower(coalesce(r.status, '')) <> 'cancelled') then
    return jsonb_build_object('outcome', 'registered');
  end if;
  if instant >= e.registration_closes_at or instant >= e.proposed_date then
    return jsonb_build_object('outcome', 'closed', 'registration_closes_at', e.registration_closes_at);
  end if;
  if instant < e.registration_opens_at then
    return jsonb_build_object('outcome', 'not_open', 'registration_opens_at', e.registration_opens_at);
  end if;
  perform private.offer_waiting_places(p_event_id);
  select * into entry from public.waiting_list_entries
    where event_id = p_event_id and attendee_id = caller and status in ('waiting', 'offered');
  if found then
    return jsonb_build_object('outcome', 'already', 'waiting', private.waiting_entry_json(entry.entry_id));
  end if;
  if e.registration_capacity is null or private.places_held(p_event_id, null) < e.registration_capacity then
    return jsonb_build_object('outcome', 'not_full');
  end if;

  insert into public.waiting_list_entries (event_id, attendee_id, joined_at)
    values (p_event_id, caller, instant) returning * into entry;
  return jsonb_build_object('outcome', 'ok', 'waiting', private.waiting_entry_json(entry.entry_id));
end;
$$;

-- AC6: takes the calling attendee off an event's waiting list, at any time.
-- An offer they held passes to the next attendee. Outcomes: ok, missing
-- (not on the list).
create function public.leave_waiting_list(p_event_id integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  instant timestamptz;
  entry public.waiting_list_entries;
begin
  if caller is null or public.lock_acting_role() is distinct from 'attendee' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  perform 1 from public.events where event_id = p_event_id for update;
  instant := clock_timestamp();
  select * into entry from public.waiting_list_entries
    where event_id = p_event_id and attendee_id = caller and status in ('waiting', 'offered') for update;
  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;
  update public.waiting_list_entries set status = 'left', ended_at = instant where entry_id = entry.entry_id;
  if entry.status = 'offered' then
    perform private.offer_waiting_places(p_event_id);
  end if;
  return jsonb_build_object('outcome', 'ok', 'left_at', instant);
end;
$$;

-- Where one entry stands, as the attendee sees it: waiting with a position,
-- or offered with the time the place is held until.
create function private.waiting_entry_json(p_entry_id bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', w.status, 'joined_at', w.joined_at,
    'position', case when w.status = 'waiting' then private.waiting_position(w.entry_id) end,
    'offer_expires_at', case when w.status = 'offered' then w.offer_expires_at end)
  from public.waiting_list_entries w where w.entry_id = p_entry_id;
$$;

-- SG2-59/60's attendee read, now saying whether the event is full for the
-- caller (AC1) and where they stand on its waiting list (AC5).
create or replace function private.registrable_events_json(p_event_id integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', e.event_id,
    'name', e.name,
    'organisation', e.organisation,
    'category', e.category,
    'description', e.description,
    'proposed_date', e.proposed_date,
    'registration_opens_at', e.registration_opens_at,
    'registration_closes_at', e.registration_closes_at,
    'venues', coalesce((
      select jsonb_agg(jsonb_build_object('name', v.name, 'location', v.location) order by v.name, v.venue_id)
      from public.venues v
      where v.venue_id in (select b.venue_id from public.venue_bookings b
        where b.event_id = e.event_id and b.status = 'confirmed')), '[]'::jsonb),
    'registered', exists(select 1 from public.registrations r where r.event_id = e.event_id
      and r.attendee_id = auth.uid() and lower(coalesce(r.status, '')) <> 'cancelled'),
    'full', e.registration_capacity is not null
      and private.places_held(e.event_id, auth.uid()) >= e.registration_capacity,
    'waiting', (select private.waiting_entry_json(w.entry_id) from public.waiting_list_entries w
      where w.event_id = e.event_id and w.attendee_id = auth.uid()
        and (w.status = 'waiting' or (w.status = 'offered' and w.offer_expires_at > clock_timestamp())))
  ) order by e.proposed_date, e.event_id), '[]'::jsonb)
  from public.events e
  where e.status = 'confirmed'
    and e.registration_needed is true
    and e.registration_opens_at is not null
    and e.registration_closes_at is not null
    and clock_timestamp() < e.registration_closes_at
    and e.proposed_date > clock_timestamp()
    and (p_event_id is null or e.event_id = p_event_id);
$$;

-- SG2-62's withdrawal, now offering the freed place to the waiting list
-- (SG2-62 AC6).
create or replace function public.withdraw_registration(p_registration_id integer)
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
  -- AC6: the freed place goes to the waiting list first.
  perform private.offer_waiting_places(e.event_id);

  return jsonb_build_object('outcome', 'ok', 'registration', jsonb_build_object(
    'registration_id', r.registration_id, 'event_id', e.event_id, 'withdrawn_at', instant));
end;
$$;

-- SG2-63's settings change, now also setting the waiting-list response
-- window (SG2-62 AC6) and offering places it frees to the waiting list.
create or replace function public.update_registration_settings(
  p_event_id integer,
  p_actor_id uuid,
  p_values jsonb,
  p_close_now boolean
) returns jsonb language plpgsql volatile security definer set search_path = '' set timezone = 'UTC' as $$
declare
  membership text;
  e public.events;
  instant timestamptz := clock_timestamp();
  capacity integer;
  opens timestamptz;
  closes timestamptz;
  response_hours integer;
  field text;
  old_value text;
  new_value text;
  changed text[] := array[]::text[];
begin
  select u.organisation into membership from public.users u where u.user_id = p_actor_id for share;
  if p_actor_id is null or membership is null or not exists(
      select 1 from public.account_roles where user_id = p_actor_id and role = 'event_organiser') then
    return jsonb_build_object('outcome', 'missing');
  end if;
  -- Only the creating organiser, still in the event's organisation (SG2-26).
  select * into e from public.events
    where event_id = p_event_id and organiser_id = p_actor_id and organisation = membership for update;
  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if e.status in ('completed', 'cancelled', 'rejected') then
    return jsonb_build_object('outcome', 'closed', 'status', e.status::text);
  end if;
  if e.registration_needed is not true then
    return jsonb_build_object('outcome', 'not_needed');
  end if;
  if e.proposed_date is not null and instant >= e.proposed_date then
    return jsonb_build_object('outcome', 'started');
  end if;

  capacity := e.registration_capacity;
  opens := e.registration_opens_at;
  closes := e.registration_closes_at;
  response_hours := e.waiting_list_response_hours;
  if p_close_now then
    if p_values is not null and p_values <> '{}'::jsonb then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    -- Open means open to attendees: a confirmed event inside its window.
    if e.status is distinct from 'confirmed' or opens is null or closes is null
        or instant < opens or instant >= closes then
      return jsonb_build_object('outcome', 'not_open');
    end if;
    closes := instant;
  else
    if p_values is null or jsonb_typeof(p_values) <> 'object' or p_values = '{}'::jsonb
        or exists(select 1 from jsonb_object_keys(p_values) key
          where key not in ('registration_capacity', 'registration_opens_at', 'registration_closes_at',
            'waiting_list_response_hours')) then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    begin
      if p_values ? 'registration_capacity' then
        if jsonb_typeof(p_values -> 'registration_capacity') = 'null' then
          capacity := null;
        elsif jsonb_typeof(p_values -> 'registration_capacity') <> 'number'
            or (p_values ->> 'registration_capacity')::numeric not between 1 and 2147483647
            or (p_values ->> 'registration_capacity')::numeric % 1 <> 0 then
          return jsonb_build_object('outcome', 'invalid');
        else
          capacity := (p_values ->> 'registration_capacity')::integer;
        end if;
      end if;
      -- SG2-62 AC6: the waiting-list response window, whole hours up to a week.
      if p_values ? 'waiting_list_response_hours' then
        if jsonb_typeof(p_values -> 'waiting_list_response_hours') <> 'number'
            or (p_values ->> 'waiting_list_response_hours')::numeric not between 1 and 168
            or (p_values ->> 'waiting_list_response_hours')::numeric % 1 <> 0 then
          return jsonb_build_object('outcome', 'invalid');
        end if;
        response_hours := (p_values ->> 'waiting_list_response_hours')::integer;
      end if;
      if p_values ? 'registration_opens_at' then
        if jsonb_typeof(p_values -> 'registration_opens_at') not in ('string', 'null') then
          return jsonb_build_object('outcome', 'invalid');
        end if;
        opens := (p_values ->> 'registration_opens_at')::timestamptz;
      end if;
      if p_values ? 'registration_closes_at' then
        if jsonb_typeof(p_values -> 'registration_closes_at') not in ('string', 'null') then
          return jsonb_build_object('outcome', 'invalid');
        end if;
        closes := (p_values ->> 'registration_closes_at')::timestamptz;
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('outcome', 'invalid');
    end;
    -- Once confirmed, clearing a setting would end registration with no
    -- notice and undo what confirmation needed (SG2-57): close early instead.
    if e.status = 'confirmed' and ((p_values ? 'registration_capacity' and capacity is null)
        or (p_values ? 'registration_opens_at' and opens is null)
        or (p_values ? 'registration_closes_at' and closes is null)) then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    -- Nobody already registered loses their place (counted under the event lock).
    if capacity is not null and capacity < (select count(*) from public.registrations r
        where r.event_id = p_event_id and lower(coalesce(r.status, '')) <> 'cancelled') then
      return jsonb_build_object('outcome', 'below_registered', 'registered', (select count(*) from public.registrations r
        where r.event_id = p_event_id and lower(coalesce(r.status, '')) <> 'cancelled'));
    end if;
    -- A new closing time is in the future: closing now is p_close_now.
    if (opens is not null and closes is not null and closes <= opens)
        or (p_values ? 'registration_closes_at' and closes is not null and closes <= instant)
        or (e.proposed_date is not null and (opens >= e.proposed_date or closes >= e.proposed_date)) then
      return jsonb_build_object('outcome', 'invalid');
    end if;
  end if;

  update public.events set registration_capacity = capacity, registration_opens_at = opens,
    registration_closes_at = closes, waiting_list_response_hours = response_hours where event_id = p_event_id;
  -- AC9: one history row per setting that actually changed.
  foreach field in array array['registration_capacity', 'registration_opens_at', 'registration_closes_at',
      'waiting_list_response_hours'] loop
    old_value := case field when 'registration_capacity' then e.registration_capacity::text
      when 'waiting_list_response_hours' then e.waiting_list_response_hours::text
      when 'registration_opens_at' then to_char(e.registration_opens_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      else to_char(e.registration_closes_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
    new_value := case field when 'registration_capacity' then capacity::text
      when 'waiting_list_response_hours' then response_hours::text
      when 'registration_opens_at' then to_char(opens, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      else to_char(closes, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
    if old_value is distinct from new_value then
      insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
        values (p_event_id, p_actor_id, field, old_value, new_value);
      changed := changed || field;
    end if;
  end loop;
  perform public.announce_registration_window(p_event_id, p_close_now);
  -- SG2-62 AC6: places a higher capacity or a reopening frees go to the
  -- waiting list first; closing ends any offer still running.
  perform private.offer_waiting_places(p_event_id);

  return jsonb_build_object('outcome', 'ok', 'changed', to_jsonb(changed),
    'registration_capacity', capacity, 'registration_opens_at', opens, 'registration_closes_at', closes,
    'waiting_list_response_hours', response_hours);
end;
$$;

-- SG2-63/60's registration picture, now with the waiting list (AC7) and the
-- response window. The server keeps it for those who see the picture.
create or replace function public.event_registration_overview(p_event_id integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when e.event_id is null then null else jsonb_build_object(
    'event', jsonb_build_object('event_id', e.event_id, 'name', e.name, 'status', e.status::text,
      'organisation', e.organisation, 'organiser_id', e.organiser_id, 'coordinator_id', e.coordinator_id,
      'proposed_date', e.proposed_date, 'registration_needed', e.registration_needed,
      'registration_capacity', e.registration_capacity, 'registration_opens_at', e.registration_opens_at,
      'registration_closes_at', e.registration_closes_at, 'waiting_list_response_hours', e.waiting_list_response_hours),
    'attendees', coalesce((select jsonb_agg(jsonb_build_object('registration_id', r.registration_id,
        'name', u.name, 'organisation', u.organisation, 'email', a.email, 'phone', coalesce(r.contact_phone, u.phone),
        'needs', r.needs, 'registered_at', r.registered_at) order by r.registered_at, r.registration_id)
      from public.registrations r
      join public.users u on u.user_id = r.attendee_id
      left join auth.users a on a.id = r.attendee_id
      where r.event_id = e.event_id and lower(coalesce(r.status, '')) <> 'cancelled'), '[]'::jsonb),
    -- AC7: the waiting list in the order attendees joined it; those offered
    -- a place joined first.
    'waiting_list', coalesce((select jsonb_agg(jsonb_build_object('entry_id', w.entry_id,
        'name', u.name, 'organisation', u.organisation, 'status', w.status, 'joined_at', w.joined_at,
        'offer_expires_at', w.offer_expires_at) order by w.joined_at, w.entry_id)
      from public.waiting_list_entries w
      join public.users u on u.user_id = w.attendee_id
      where w.event_id = e.event_id and w.status in ('waiting', 'offered')), '[]'::jsonb),
    'venues', coalesce((select jsonb_agg(jsonb_build_object('venue_id', v.venue_id, 'name', v.name,
        'capacity', v.capacity) order by v.venue_id)
      from public.venues v
      where v.venue_id in (select b.venue_id from public.venue_booking_requests b
        where b.event_id = e.event_id and b.status in ('pending', 'approved'))), '[]'::jsonb)
  ) end
  from (select 1) one left join public.events e on e.event_id = p_event_id;
$$;

revoke all on function private.places_held(integer, uuid), private.waiting_position(bigint),
  private.waiting_entry_json(bigint), private.offer_waiting_places(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.join_waiting_list(integer), public.leave_waiting_list(integer),
  public.process_waiting_list_offers() from public, anon, authenticated, service_role;
grant execute on function public.join_waiting_list(integer), public.leave_waiting_list(integer) to authenticated;
grant execute on function public.process_waiting_list_offers() to service_role;

-- Supabase supports pg_cron. Plain CI PostgreSQL lacks it and runs the same
-- function deterministically in its database suite.
do $$
begin
  if exists(select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.schedule('waiting-list-offers', '* * * * *', 'select public.process_waiting_list_offers();');
  else
    raise notice 'pg_cron is unavailable: enable a scheduler running public.process_waiting_list_offers() every minute before deployment.';
  end if;
end;
$$;

commit;
