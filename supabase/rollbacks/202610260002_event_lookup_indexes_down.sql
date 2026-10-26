-- Rollback for 202610260002_event_lookup_indexes.sql (SG2-96).
--
-- Drops the four per-event lookup indexes. No data changes either way; the
-- reads they speed up keep working, only slower at volume (see
-- docs/nfr-capacity-review.md). supabase/checks/release_readiness.sql reports
-- the missing indexes until the migration is applied again.
--
-- Not a migration: keep it out of supabase/migrations, where every file is
-- applied in order.
begin;

drop index if exists public.venue_bookings_event_idx;
drop index if exists public.venue_booking_requests_event_idx;
drop index if exists public.equipment_requests_event_idx;
drop index if exists public.equipment_reservations_event_idx;

commit;
