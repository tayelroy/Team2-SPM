-- SG2-59: attendees find the events they can register for and read their
-- attendee-facing details.
--
-- AC1/AC2: an event is listed when it is confirmed, needs registration, has
-- both registration times set, has not started, and its registration is open
-- now or opens later. Team reading (22 Oct 2026): AC1 requires open events to
-- be listed and AC2 excludes unconfirmed events and those without
-- registration; an event whose registration has yet to open is neither, and
-- listing it lets SG2-60 AC3 tell an attendee when registration opens.
-- Events whose registration has closed are not listed. "Open" is the same
-- window as server/src/events/registrationWindow.ts and SG2-63's
-- announce_registration_window(): opens_at inclusive, closes_at exclusive.
-- AC3: only the fields built below leave the database: no coordinator,
-- organiser, status, planning notes, requirements, attendance or capacity.
-- Venues are the event's confirmed bookings, with their name and location.
--
-- Both reads run with the caller's JWT and recheck that the acting role
-- (SG2-104) is attendee, as search_events() does for internal roles.
begin;

-- The events an attendee may find (all of them, or the one asked for), soonest
-- first, each as its attendee-facing object.
create function private.registrable_events_json(p_event_id integer)
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
        where b.event_id = e.event_id and b.status = 'confirmed')), '[]'::jsonb)
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
revoke all on function private.registrable_events_json(integer) from public, anon, authenticated, service_role;

-- AC1/AC2: the list.
create function public.registrable_events()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.acting_role() is distinct from 'attendee' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  return private.registrable_events_json(null);
end $$;
revoke all on function public.registrable_events() from public, anon, authenticated, service_role;
grant execute on function public.registrable_events() to authenticated;

-- AC3: one event's details, or null when it is not an event an attendee may
-- find (the route answers 404 for both a missing and an unlisted event).
create function public.registrable_event(p_event_id integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.acting_role() is distinct from 'attendee' then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  return private.registrable_events_json(p_event_id) -> 0;
end $$;
revoke all on function public.registrable_event(integer) from public, anon, authenticated, service_role;
grant execute on function public.registrable_event(integer) to authenticated;

commit;
