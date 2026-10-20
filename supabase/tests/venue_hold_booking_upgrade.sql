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
     -- SG2-106 adds expiry_revision (default 0) after this fixture was taken.
     or (to_jsonb(h)-'expiry_revision') is distinct from f.hold_before or to_jsonb(b) is distinct from f.booking_before
     -- SG2-91 adds columns and may move a ready event into the safety check
     -- after this repair; both are checked by the assertion below. SG2-105
     -- adds preferred_layout, which an event from before it never has, and
     -- SG2-70 gives every existing event a category.
     or (to_jsonb(e)-'status'-'expected_crowd_movement'-'awaiting_safety_check_since'-'safety_check_revision'-'preferred_layout'-'category')
       is distinct from (f.event_before-'status')) then
  raise exception '[SG2-51:legacy-hold-release-metadata-preserved] [SG2-51:AC3] [SG2-51:AC5] [BOUNDARY] Repair must retain original request metadata, all hold/booking history and event information';
 end if;
 -- SG2-70: each event that existed before the category was added is given the
 -- one its name implies (the column is left out of the comparison above).
 if exists(select 1 from hold_link_upgrade_fixture.before f join public.events e on e.event_id=(f.event_before->>'event_id')::integer
    where e.category is distinct from private.event_category_from_name(e.name)) then
  raise exception '[SG2-70:legacy-events-categorised] [SG2-70:AC2] [NORMAL] Every event from before the upgrade must be given the category its name implies';
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
 -- SG2-91: the upgrade moves exactly the repaired events whose venues are now
 -- all booked into the safety check, stamps the wait, and (checked above)
 -- writes no history row for a move nobody made.
 if (select count(*) from public.events where event_id between 988402 and 988416
      and status = 'awaiting_safety_check') = 0
    or exists(select 1 from public.events e where e.event_id between 988402 and 988416
      and (e.status = 'awaiting_safety_check') is distinct from public.safety_check_arrangements_ready(e))
    or exists(select 1 from public.events e where e.event_id between 988402 and 988416
      and (e.status = 'awaiting_safety_check') is distinct from (e.awaiting_safety_check_since is not null
        and e.safety_check_revision = 1)) then
  raise exception '[SG2-91:upgrade-moves-ready-events] [SG2-91:AC1] [BOUNDARY] The upgrade must move exactly the ready legacy events into the safety check and stamp their wait';
 end if;
end $$;
rollback;
