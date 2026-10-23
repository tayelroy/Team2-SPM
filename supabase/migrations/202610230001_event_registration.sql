-- SG2-60: an attendee registers for an event.
--
-- AC1: register_for_event() holds a place for an attendee on a confirmed
-- event whose registration is open (SG2-63's window: opens_at inclusive,
-- closes_at exclusive) while places remain under the capacity the organiser
-- set (SG2-63), and tells them so: the result carries the registration and
-- a registration_confirmed notice reaches their inbox (SG2-69) with the
-- event's name, date, time and venue.
-- AC2: an attendee holds at most one active registration per event. The
-- function refuses a second one and a partial unique index backs it up;
-- a cancelled registration (SG2-62) does not count.
-- AC3: outside the window the attempt is refused with the opening time, or
-- as closed.
-- AC4: a contact phone is required (SG2-27's rule: eight Singapore digits,
-- optionally +65, readability separators ignored) and any accessibility or
-- dietary needs are at most 500 characters. Name and email come from the
-- attendee's account. Team decision, 23 Oct 2026.
--
-- Every attempt locks the event row first, the same lock SG2-63's settings
-- changes take, so concurrent attempts on the last place are decided one at
-- a time and capacity cannot change under a check (SG2-61 AC2 relies on it).
-- Runs with the caller's JWT and rechecks the acting role is attendee
-- (SG2-104), as registrable_events() does.
begin;

alter table public.registrations
  add column contact_phone text
    constraint registrations_contact_phone_valid check (contact_phone is null or (char_length(contact_phone) <= 40
      and regexp_replace(contact_phone, '[().[:space:]-]', '', 'g') ~ '^(\+65)?[0-9]{8}$')),
  add column needs text
    constraint registrations_needs_length check (needs is null or char_length(needs) <= 500);

-- AC2: one active registration per attendee per event, counted as SG2-63
-- and SG2-66 count places (only a cancelled registration gives one back).
create unique index registrations_one_active_per_attendee on public.registrations (event_id, attendee_id)
  where lower(coalesce(status, '')) <> 'cancelled';

-- Adds the kind to whatever list is already allowed, as SG2-63 did.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['registration_confirmed']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- AC1-AC4: registers the calling attendee. Outcomes: ok (with the
-- registration), invalid (AC4), missing (not an event an attendee may find,
-- as registrable_event() answers), duplicate (AC2), not_open (with the
-- opening time) or closed (AC3), full (AC1: no places remain).
create function public.register_for_event(p_event_id integer, p_contact_phone text, p_needs text)
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
revoke all on function public.register_for_event(integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.register_for_event(integer, text, text) to authenticated;

-- SG2-59's attendee read, now also saying whether the caller already holds
-- an active registration, so the detail shows it instead of the form (AC2).
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

-- SG2-63's registration picture, now with the phone the attendee gave when
-- registering (their profile phone for earlier registrations) and their
-- needs. The server keeps both only for those who may see contact details.
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

commit;
