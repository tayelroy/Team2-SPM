-- SG2-63: the registration picture for an event, and the Event Organiser's
-- control of its registration settings.
--
-- AC1/AC2: event_registration_overview() reads how many are registered, who
-- they are, and the venues the event has booked (for AC7's capacity warning).
-- The server decides who may see it (AC3) and strips contact details for
-- anyone not authorised to see them (AC4).
-- AC5/AC6: update_registration_settings() lets the organiser who created the
-- event set or change its registration capacity and opening and closing
-- times at any time before the event starts, including once it is confirmed,
-- close registration early (p_close_now), and reopen or extend it by setting a
-- later closing time. Capacity never drops below the registrations already
-- held: no story says who would lose their place (SG2-61 AC4 only raises it). The assigned coordinator can no longer change them
-- (AC8, replacing SG2-39 AC4); the planning route refuses the fields.
-- AC9: each changed setting is written to the event history (SG2-40).
-- AC10: when registration opens or closes on a confirmed event, on schedule
-- or closed early, the organiser and the assigned coordinator are told once.
-- process_registration_windows() catches scheduled times every minute;
-- events.registration_announced remembers what was last announced.
--
-- Registration is open only for a confirmed event that needs registration,
-- from opens_at (inclusive) to closes_at (exclusive), exactly as
-- server/src/events/registrationWindow.ts. The validation mirrors
-- server/src/events/registrationSettings.ts; they must change together.
begin;

-- SG2-60 writes registrations; SG2-62 cancels them when an attendee
-- withdraws. Every registration that is not cancelled holds a place, the
-- same rule SG2-66's change impact already counts by
-- (server/src/db/changeImpact.ts). The legacy status column stays free text.
alter table public.registrations
  alter column status set default 'registered',
  add column registered_at timestamptz not null default clock_timestamp();
create index registrations_event_status_idx on public.registrations (event_id, status);

alter table public.events
  add column registration_announced text
    constraint events_registration_announced_known check (registration_announced in ('open', 'closed'));

-- Adds the two kinds to whatever list is already allowed, rather than
-- restating it, so a kind another open story adds (e.g. SG2-69's
-- outstanding_arrangements) survives whichever order the migrations land in.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['registration_opened', 'registration_closed']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- AC10: tells the organiser and the assigned coordinator when a confirmed
-- event's registration has opened or closed since it was last announced.
-- p_closed_early words the notice for the organiser closing it by hand.
-- Callers hold the event row lock.
create function public.announce_registration_window(p_event_id integer, p_closed_early boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
  state text;
  event_label text;
  message text;
  instant timestamptz := clock_timestamp();
begin
  select * into e from public.events where event_id = p_event_id;
  if not found then return; end if;
  state := case
    when e.status is distinct from 'confirmed' or e.registration_needed is not true
      or e.registration_opens_at is null or e.registration_closes_at is null
      or instant < e.registration_opens_at then null
    when instant >= e.registration_closes_at then 'closed'
    else 'open' end;
  if state is not distinct from e.registration_announced then return; end if;
  update public.events set registration_announced = state where event_id = p_event_id;
  if state is null then return; end if;

  event_label := left(coalesce(nullif(e.name, ''), 'Untitled event'), 500);
  message := case
    when state = 'open' then 'Registration for ' || event_label || ' is now open.'
    when p_closed_early then 'Registration for ' || event_label || ' was closed early by the organiser.'
    else 'Registration for ' || event_label || ' has closed.' end;
  if e.organiser_id is not null then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (e.organiser_id, p_event_id, 'registration_' || case state when 'open' then 'opened' else 'closed' end, message);
  end if;
  if e.coordinator_id is not null and e.coordinator_id is distinct from e.organiser_id then
    insert into public.notifications (recipient_id, event_id, kind, message)
      values (e.coordinator_id, p_event_id, 'registration_' || case state when 'open' then 'opened' else 'closed' end, message);
  end if;
end;
$$;

-- AC10 on schedule: every confirmed event whose registration has opened or
-- closed since it was last announced.
create function public.process_registration_windows()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  target integer;
  announced integer := 0;
  instant timestamptz := clock_timestamp();
begin
  for target in
    select event_id from public.events
    where status = 'confirmed' and registration_needed is true
      and registration_opens_at <= instant and registration_closes_at is not null
      and registration_announced is distinct from
        case when instant >= registration_closes_at then 'closed' else 'open' end
    order by event_id
  loop
    -- Lock each event on its own; skip one a settings change is holding.
    perform 1 from public.events where event_id = target for update skip locked;
    if found then
      perform public.announce_registration_window(target, false);
      announced := announced + 1;
    end if;
  end loop;
  return announced;
end;
$$;

-- AC5, AC6, AC9, AC10: the organiser who created the event changes its
-- registration settings. p_values holds only the settings being changed
-- (registration_capacity, registration_opens_at, registration_closes_at);
-- p_close_now closes an open registration at this moment instead.
create function public.update_registration_settings(
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

-- AC1, AC2, AC4, AC7: what the registration picture is built from. The
-- server checks who is asking before it returns any of this, and removes
-- the contact details for anyone not authorised to see them.
create function public.event_registration_overview(p_event_id integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when e.event_id is null then null else jsonb_build_object(
    'event', jsonb_build_object('event_id', e.event_id, 'name', e.name, 'status', e.status::text,
      'organisation', e.organisation, 'organiser_id', e.organiser_id, 'coordinator_id', e.coordinator_id,
      'proposed_date', e.proposed_date, 'registration_needed', e.registration_needed,
      'registration_capacity', e.registration_capacity, 'registration_opens_at', e.registration_opens_at,
      'registration_closes_at', e.registration_closes_at),
    'attendees', coalesce((select jsonb_agg(jsonb_build_object('registration_id', r.registration_id,
        'name', u.name, 'organisation', u.organisation, 'email', a.email, 'phone', u.phone,
        'registered_at', r.registered_at) order by r.registered_at, r.registration_id)
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

revoke all on function public.announce_registration_window(integer, boolean),
  public.process_registration_windows(),
  public.update_registration_settings(integer, uuid, jsonb, boolean),
  public.event_registration_overview(integer) from public, anon, authenticated;
grant execute on function public.process_registration_windows(),
  public.update_registration_settings(integer, uuid, jsonb, boolean),
  public.event_registration_overview(integer) to service_role;

-- Supabase supports pg_cron. Plain CI PostgreSQL lacks it and runs the same
-- function deterministically in its database suite.
do $$
begin
  if exists(select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.schedule('registration-windows', '* * * * *', 'select public.process_registration_windows();');
  else
    raise notice 'pg_cron is unavailable: enable a scheduler running public.process_registration_windows() every minute before deployment.';
  end if;
end;
$$;

commit;
