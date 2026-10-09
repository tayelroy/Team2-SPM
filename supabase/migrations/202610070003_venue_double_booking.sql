-- SG2-50: a venue is never committed to two overlapping events.
--
-- The API reports what a request overlaps when it is made and before it is
-- decided (AC1). SG2-49's decide_venue_booking_request() refuses approval
-- while a confirmed booking or live hold overlaps, under the venue lock (AC2).
-- This constraint is the backstop under every path that confirms a booking
-- (approving a request, converting a tentative hold, or a direct write): two
-- confirmed bookings for the same venue can never overlap, even when written
-- at the same moment.
--
-- Only confirmed bookings commit a venue, as for SG2-49's approval check,
-- venue search and blocks: a held booking is not confirmed, and a booking
-- given any other status (such as one released under SG2-51) frees its
-- period again (AC3). Periods that only touch, one ending as the next
-- starts, do not overlap.
begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

alter table public.venue_bookings
  add constraint venue_bookings_no_double_booking
  exclude using gist (
    venue_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed');

commit;
