-- Rollback for 202610280001_waiting_list.sql (SG2-61, SG2-62 AC6).
--
-- One transaction: unschedules the offer sweep, puts back the versions of
-- the five functions the migration replaced (copied from the migrations that
-- last defined them, so register, withdraw and the settings never point at a
-- dropped table), then drops the waiting list, its functions and the
-- response-window column. CREATE OR REPLACE keeps each function's grants.
--
-- Not undone (data, not schema): who waited, was offered or lapsed is lost
-- with the table. `registration_full`, `waiting_list_offer` and
-- `waiting_list_offer_lapsed` stay allowed on notifications so notices
-- already sent remain valid. Rehearse it first inside BEGIN ... ROLLBACK on a
-- live database.
--
-- Not a migration: keep it out of supabase/migrations, where every file is
-- applied in order.
begin;

do $$
begin
  if exists(select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'waiting-list-offers';
  end if;
end;
$$;

-- SG2-60's version, from 202610230001_event_registration.sql.
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
  if e.registration_capacity is not null and e.registration_capacity <= (select count(*) from public.registrations r
      where r.event_id = p_event_id and lower(coalesce(r.status, '')) <> 'cancelled') then
    return jsonb_build_object('outcome', 'full');
  end if;

  insert into public.registrations (event_id, attendee_id, status, registered_at, contact_phone, needs)
    values (p_event_id, caller, 'registered', instant, phone, needs)
    returning * into created;

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

  return jsonb_build_object('outcome', 'ok', 'registration', jsonb_build_object(
    'registration_id', created.registration_id, 'event_id', created.event_id,
    'registered_at', created.registered_at, 'contact_phone', created.contact_phone, 'needs', created.needs));
end;
$$;

-- SG2-60's version, from 202610230001_event_registration.sql.
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
      and r.attendee_id = auth.uid() and lower(coalesce(r.status, '')) <> 'cancelled')
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

-- SG2-60's version, from 202610230001_event_registration.sql.
create or replace function public.event_registration_overview(p_event_id integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when e.event_id is null then null else jsonb_build_object(
    'event', jsonb_build_object('event_id', e.event_id, 'name', e.name, 'status', e.status::text,
      'organisation', e.organisation, 'organiser_id', e.organiser_id, 'coordinator_id', e.coordinator_id,
      'proposed_date', e.proposed_date, 'registration_needed', e.registration_needed,
      'registration_capacity', e.registration_capacity, 'registration_opens_at', e.registration_opens_at,
      'registration_closes_at', e.registration_closes_at),
    'attendees', coalesce((select jsonb_agg(jsonb_build_object('registration_id', r.registration_id,
        'name', u.name, 'organisation', u.organisation, 'email', a.email, 'phone', coalesce(r.contact_phone, u.phone),
        'needs', r.needs, 'registered_at', r.registered_at) order by r.registered_at, r.registration_id)
      from public.registrations r
      join public.users u on u.user_id = r.attendee_id
      left join auth.users a on a.id = r.attendee_id
      where r.event_id = e.event_id and lower(coalesce(r.status, '')) <> 'cancelled'), '[]'::jsonb),
    'venues', coalesce((select jsonb_agg(jsonb_build_object('venue_id', v.venue_id, 'name', v.name,
        'capacity', v.capacity) order by v.venue_id)
      from public.venues v
      where v.venue_id in (select b.venue_id from public.venue_booking_requests b
        where b.event_id = e.event_id and b.status in ('pending', 'approved'))), '[]'::jsonb)
  ) end
  from (select 1) one left join public.events e on e.event_id = p_event_id;
$$;

-- SG2-62's version, from 202610260003_registration_withdrawal.sql.
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

  return jsonb_build_object('outcome', 'ok', 'registration', jsonb_build_object(
    'registration_id', r.registration_id, 'event_id', e.event_id, 'withdrawn_at', instant));
end;
$$;

-- SG2-63's version, from 202610200004_event_registration_settings.sql.
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
          where key not in ('registration_capacity', 'registration_opens_at', 'registration_closes_at')) then
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
    registration_closes_at = closes where event_id = p_event_id;
  -- AC9: one history row per setting that actually changed.
  foreach field in array array['registration_capacity', 'registration_opens_at', 'registration_closes_at'] loop
    old_value := case field when 'registration_capacity' then e.registration_capacity::text
      when 'registration_opens_at' then to_char(e.registration_opens_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      else to_char(e.registration_closes_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
    new_value := case field when 'registration_capacity' then capacity::text
      when 'registration_opens_at' then to_char(opens, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      else to_char(closes, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
    if old_value is distinct from new_value then
      insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
        values (p_event_id, p_actor_id, field, old_value, new_value);
      changed := changed || field;
    end if;
  end loop;
  perform public.announce_registration_window(p_event_id, p_close_now);

  return jsonb_build_object('outcome', 'ok', 'changed', to_jsonb(changed),
    'registration_capacity', capacity, 'registration_opens_at', opens, 'registration_closes_at', closes);
end;
$$;

drop function if exists public.join_waiting_list(integer);
drop function if exists public.leave_waiting_list(integer);
drop function if exists public.process_waiting_list_offers();
drop function if exists private.offer_waiting_places(integer);
drop function if exists private.waiting_entry_json(bigint);
drop function if exists private.waiting_position(bigint);
drop function if exists private.places_held(integer, uuid);
drop table if exists public.waiting_list_entries;
alter table public.events
  drop constraint if exists events_waiting_list_response_hours_range,
  drop column if exists waiting_list_response_hours;

commit;
