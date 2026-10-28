-- SG2-102: registered attendees are told when their event changes.
--
-- What an attendee sees of an event's date, time and venue is the event's
-- start (events.proposed_date) and the venues of its confirmed bookings
-- (registrable_events_json, my_registrations, register_for_event's notice).
-- private.event_attendee_details keeps the last start and venues attendees
-- were told about, one row per event.
--
-- AC1: whenever a transaction leaves an event's start or confirmed venues
-- different from that record, every attendee with an active registration
-- gets one event_changed notice and the record moves on. The check runs from
-- deferred constraint triggers at commit, so it catches every writer: an
-- accepted change request (SG2-66's apply_accepted_event_change, SG2-65's
-- decide_event_change_request), a replacement venue after the original
-- became unavailable (SG2-81: the new booking and the release of the old one
-- land in one transaction, so attendees get one notice, not two), and a venue
-- changed or cancelled by SG2-83.
-- AC2: the notice names the event and gives the old and new value of each
-- part that changed.
-- AC3: a withdrawn registration is 'cancelled' (SG2-62), and only active
-- registrations are notified.
-- AC4: the attendee views already read the event live; nothing to change.
-- AC5: only the start and the confirmed venues are compared, so internal
-- planning changes (attendance, requirements, layout, booking times, a held
-- booking) never notify attendees.
--
-- A cancelled event is not announced here: cancel_event releases its
-- bookings and already sends attendees an event_cancelled notice (SG2-67).
--
-- Every writer of an event's start or bookings locks the event row, and so
-- does withdraw_registration; the check locks it too (already held by then)
-- before its record, so a change and a withdrawal or a second change are
-- announced one at a time, each against the record the last one left.
--
-- A transaction that writes an event's start or a booking and then alters
-- public.events or public.venue_bookings must first run
-- `set constraints public.event_attendee_details_changed,
-- public.venue_booking_attendee_details_changed immediate`: PostgreSQL will
-- not alter a table with pending trigger events.
begin;

create table private.event_attendee_details (
  event_id      integer primary key references public.events(event_id) on delete cascade,
  proposed_date timestamptz,
  venue_ids     integer[] not null default '{}',
  venue_names   text
);

alter table private.event_attendee_details enable row level security;
alter table private.event_attendee_details force row level security;
revoke all on table private.event_attendee_details from public, anon, authenticated;
-- No grants and no policies: only the security definer function below reads
-- or writes it.

-- The details as they stand, so nothing already shown is announced as new.
insert into private.event_attendee_details (event_id, proposed_date, venue_ids, venue_names)
  select e.event_id, e.proposed_date,
    coalesce((select array_agg(v.venue_id order by v.venue_id) from public.venues v
      where v.venue_id in (select b.venue_id from public.venue_bookings b
        where b.event_id = e.event_id and b.status = 'confirmed')), '{}'),
    (select string_agg(v.name, ', ' order by v.name, v.venue_id) from public.venues v
      where v.venue_id in (select b.venue_id from public.venue_bookings b
        where b.event_id = e.event_id and b.status = 'confirmed'))
  from public.events e;

-- Adds the kind to whatever list is already allowed, as SG2-63 did.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := kinds || array(select kind from unnest(array['event_changed']) kind
    where not kind = any(kinds));
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

-- AC1-AC3, AC5: compares one event with what its attendees were last told,
-- notifies its active registrations of any difference and records the new
-- details. A new event's first record is written without a notice.
create function private.announce_event_attendee_details(p_event_id integer)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
  known private.event_attendee_details;
  ids integer[];
  names text;
  changes text[] := array[]::text[];
begin
  if p_event_id is null then return; end if;
  select * into e from public.events where event_id = p_event_id for update;
  if not found then return; end if;

  select coalesce(array_agg(v.venue_id order by v.venue_id), '{}'), string_agg(v.name, ', ' order by v.name, v.venue_id)
    into ids, names
    from public.venues v
    where v.venue_id in (select b.venue_id from public.venue_bookings b
      where b.event_id = p_event_id and b.status = 'confirmed');

  select * into known from private.event_attendee_details where event_id = p_event_id for update;
  if not found then
    insert into private.event_attendee_details (event_id, proposed_date, venue_ids, venue_names)
      values (p_event_id, e.proposed_date, ids, names)
      on conflict (event_id) do nothing;
    return;
  end if;
  if known.proposed_date is not distinct from e.proposed_date and known.venue_ids = ids then return; end if;

  -- AC2: each part that changed, old value first, in the wording
  -- register_for_event's notice uses.
  if known.proposed_date is distinct from e.proposed_date then
    changes := changes || ('Date and time: '
      || coalesce(to_char(known.proposed_date at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' SGT', 'not set')
      || ' → '
      || coalesce(to_char(e.proposed_date at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' SGT', 'not set') || '.');
  end if;
  if known.venue_ids <> ids then
    changes := changes || ('Venue: ' || left(coalesce(known.venue_names, 'none confirmed'), 400)
      || ' → ' || left(coalesce(names, 'none confirmed'), 400) || '.');
  end if;

  if e.status <> 'cancelled' then
    insert into public.notifications (recipient_id, event_id, kind, message)
      select r.attendee_id, p_event_id, 'event_changed',
        left(left(coalesce(nullif(e.name, ''), 'Untitled event'), 200) || ' has changed. '
          || array_to_string(changes, ' ') || ' Open My registrations for the latest details.', 2000)
      from (select distinct x.attendee_id from public.registrations x
        where x.event_id = p_event_id and lower(coalesce(x.status, '')) <> 'cancelled') r;
  end if;

  update private.event_attendee_details
    set proposed_date = e.proposed_date, venue_ids = ids, venue_names = names
    where event_id = p_event_id;
end;
$$;
revoke all on function private.announce_event_attendee_details(integer) from public, anon, authenticated;

create function private.event_attendee_details_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.announce_event_attendee_details(new.event_id);
  end if;
  -- A booking moved off, or removed from, an event changes that event too.
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.event_id is distinct from new.event_id) then
    perform private.announce_event_attendee_details(old.event_id);
  end if;
  return null;
end;
$$;
revoke all on function private.event_attendee_details_changed() from public, anon, authenticated;

-- Deferred to commit, so a transaction's changes are compared once they are
-- all in place (SG2-81's add-then-release is one notice).
create constraint trigger event_attendee_details_changed
  after insert or update of proposed_date on public.events
  deferrable initially deferred
  for each row execute function private.event_attendee_details_changed();

create constraint trigger venue_booking_attendee_details_changed
  after insert or update of status, event_id or delete on public.venue_bookings
  deferrable initially deferred
  for each row execute function private.event_attendee_details_changed();

commit;
