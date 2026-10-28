-- Rollback for 202610270002_attendee_event_change_notices.sql (SG2-102).
--
-- Restores the database to how it was before that migration, so it can be
-- applied again later:
--   * The two constraint triggers and their functions are dropped.
--   * private.event_attendee_details is dropped. Applying the migration again
--     records the details as they then stand, so changes made in between are
--     never announced.
--   * The 'event_changed' notices are deleted and the kind removed from
--     notifications_kind_check; every other kind is kept.
--
-- Not undone (data, not schema): the changes themselves (dates, venues) that
-- were announced. Attendees lose the event_changed notices from their inbox.
-- Review this before rolling back on a live database; rehearse it first
-- inside BEGIN ... ROLLBACK.
--
-- Not a migration: keep it out of supabase/migrations, where every file is
-- applied in order.
begin;

drop trigger if exists venue_booking_attendee_details_changed on public.venue_bookings;
drop trigger if exists event_attendee_details_changed on public.events;
drop function if exists private.event_attendee_details_changed();
drop function if exists private.announce_event_attendee_details(integer);
drop table if exists private.event_attendee_details;

delete from public.notifications where kind = 'event_changed';

-- Removes only the kind this migration added, keeping the order of the rest.
do $$
declare
  kinds text[];
begin
  select array(select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1])
    into kinds from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass and c.conname = 'notifications_kind_check';
  kinds := array_remove(kinds, 'event_changed');
  alter table public.notifications drop constraint notifications_kind_check;
  execute format('alter table public.notifications add constraint notifications_kind_check check (kind in (%s))',
    (select string_agg(quote_literal(kind), ', ' order by position) from unnest(kinds) with ordinality as k(kind, position)));
end;
$$;

commit;
