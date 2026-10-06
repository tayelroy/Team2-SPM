-- SG2-50: a venue is never committed to two overlapping events.
--
-- The API reports what a request overlaps when it is made and before it is
-- decided (AC1), and the decision step refuses approval while a conflict
-- stands (AC2). This constraint is the backstop under every path that commits
-- a venue (approving a request, converting a tentative hold, or a direct
-- write): two held or confirmed bookings for the same venue can never
-- overlap, even when written at the same moment.
--
-- Only held and confirmed bookings count, so a booking given any other status
-- (such as one released under SG2-51) frees its period again (AC3). Periods
-- that only touch, one ending as the next starts, do not overlap.
--
-- Live tentative holds are already kept apart from bookings by
-- venue_booking_refuse_overlap and change_venue_hold (SG2-84).
begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

alter table public.venue_bookings
  add constraint venue_bookings_no_double_booking
  exclude using gist (
    venue_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('held', 'confirmed'));

commit;
