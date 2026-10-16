-- Upgrade database only: legacy fixture is seeded before170004. The runner
-- applies all migrations, records row versions, reapplies170004, then runs this.
-- This proves the real append migration, not a copied repair query. Never hosted.
begin;
do $$
begin
 if (select count(*) from hold_link_upgrade_fixture.before) <> 15 then
  raise exception '[SG2-84:hold-upgrade-fixture-complete] [SG2-84:AC5] [BOUNDARY] All fifteen legacy relationship variants are required';
 end if;
 if (select count(*) from public.venue_booking_requests r join hold_link_upgrade_fixture.before f using(request_id)
    where f.n in(1,2,3,4,12) and r.venue_booking_id=988401+f.n) <> 5 then
  raise exception '[SG2-84:legacy-hold-canonical-links-repaired] [SG2-84:AC5] [NORMAL] Exact matching converted holds must acquire their own booking link';
 end if;
 if exists(select 1 from public.venue_booking_requests r join hold_link_upgrade_fixture.before f using(request_id)
    where (f.n in(2,3,12) and r.status<>'cancelled') or(f.n in(1,4) and r.status<>'approved')) then
  raise exception '[SG2-51:legacy-released-hold-requests-cancelled] [SG2-51:AC2] [SG2-84:AC5] [NORMAL] Released bookings must not leave approved requests; cancelled requests must never reactivate';
 end if;
 if exists(select 1 from public.venue_booking_requests r join hold_link_upgrade_fixture.before f using(request_id)
    where (f.n between 5 and 11 or f.n>=13) and to_jsonb(r) is distinct from f.request_before) then
  raise exception '[SG2-84:legacy-hold-mismatches-not-guessed] [SG2-84:AC5] [FAILURE] Request/booking event, venue and period identities, conflicting direct links and non-converted/non-approved controls must not be repaired';
 end if;
 if exists(select 1 from hold_link_upgrade_fixture.before f
    join public.venue_booking_requests r using(request_id)
    join public.venue_holds h on h.request_id=r.request_id
    left join public.venue_bookings b on b.booking_id=h.booking_id
    join public.events e on e.event_id=h.event_id
    where (to_jsonb(r)-'venue_booking_id'-'status') is distinct from(f.request_before-'venue_booking_id'-'status')
     or to_jsonb(h) is distinct from f.hold_before or to_jsonb(b) is distinct from f.booking_before
     or to_jsonb(e) is distinct from f.event_before) then
  raise exception '[SG2-51:legacy-hold-release-metadata-preserved] [SG2-51:AC3] [SG2-51:AC5] [BOUNDARY] Repair must retain original request metadata, all hold/booking history and event information';
 end if;
 if exists(select 1 from hold_link_upgrade_fixture.activity_before a
    where a.audits<>(select count(*) from public.event_audit_logs where event_id between 988402 and 988416)
     or a.notices<>(select count(*) from public.notifications where event_id between 988402 and 988416)
     or a.hold_notices<>(select count(*) from public.venue_hold_notifications where event_id between 988402 and 988416)) then
  raise exception '[SG2-51:legacy-hold-repair-no-invented-activity] [SG2-51:AC5] [FAILURE] Reconciliation must not invent historical actors, audit entries or notifications';
 end if;
 if exists(select 1 from public.venue_booking_requests r join hold_link_upgrade_fixture.after_first a using(request_id)
    where r.xmin::text is distinct from a.row_version) then
  raise exception '[SG2-84:hold-link-upgrade-idempotent] [SG2-84:AC5] [CONFLICT] Reapplying the actual migration must not rewrite already reconciled request rows';
 end if;
end $$;
rollback;
