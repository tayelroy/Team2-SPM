-- SG2-55 public RPC contracts, with isolated fixture changes rolled back.
begin;
insert into auth.users(id)
 select ('d5500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,9) n;
insert into public.users(user_id,name,role_id) values
 ('d5500000-0000-4000-8000-000000000001','Reservation support',4),
 ('d5500000-0000-4000-8000-000000000002','Reservation organiser',1),
 ('d5500000-0000-4000-8000-000000000003','Reservation coordinator',2),
 ('d5500000-0000-4000-8000-000000000004','Other coordinator',2);
insert into public.account_roles(user_id,role) values
 ('d5500000-0000-4000-8000-000000000001','technical_support_staff'),
 ('d5500000-0000-4000-8000-000000000002','event_organiser'),
 ('d5500000-0000-4000-8000-000000000003','event_coordinator'),
 ('d5500000-0000-4000-8000-000000000004','event_coordinator'),
 ('d5500000-0000-4000-8000-000000000005','venue_staff'),
 ('d5500000-0000-4000-8000-000000000006','attendee'),
 ('d5500000-0000-4000-8000-000000000007','event_coordinator_lead'),
 ('d5500000-0000-4000-8000-000000000008','safety_officer');
insert into public.events(event_id,organiser_id,coordinator_id,name,status)
 select 95500+n,'d5500000-0000-4000-8000-000000000002','d5500000-0000-4000-8000-000000000003',
  'Reservation event '||n,'planning' from generate_series(1,21) n;
insert into public.equipment(equipment_id,name,quantity_total) values
 (95501,'Reservation microphones',10),(95502,'Reservation speakers',3),
 (95503,'Large stock',2147483647),(95504,'Legacy projectors',10);
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,notes,shortfall,arrangement_notes)
 select 95500+n,95500+n,95501,case n when 1 then 6 when 2 then 4 else 1 end,
  'Coordinator notes',case when n=16 then null else 0 end,
  case when n=16 then null else 'Support arrangements' end from generate_series(1,20) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb; receipt jsonb;
begin
 if public.manage_equipment_reservations('read',95501) is distinct from
  '{"outcome":"ok","reservations":[],"can_reserve":true}'::jsonb then
  raise exception '[SG2-55:empty-reservations-readable] [SG2-55:AC4] [NORMAL] Support must see an empty event reservation list and reserve permission';
 end if;
 result := public.manage_equipment_reservations('reserve',95501,95501,1,'2031-10-01T09:00Z','2031-10-01T17:00Z');
 receipt := result->'reservations'->0;
 if result->>'outcome' is distinct from 'ok' or result->>'can_reserve' is distinct from 'true'
   or result->>'coordinator_notified' is distinct from 'true' or jsonb_array_length(result->'reservations') <> 1
   or receipt - array['reservation_id','starts_at','ends_at','reserved_at'] is distinct from
    '{"event_id":95501,"request_id":95501,"equipment_id":95501,"equipment_type":"Reservation microphones","quantity_reserved":6}'::jsonb
   or (receipt->>'starts_at')::timestamptz is distinct from '2031-10-01T09:00Z'::timestamptz
   or (receipt->>'ends_at')::timestamptz is distinct from '2031-10-01T17:00Z'::timestamptz
   or not isfinite((receipt->>'reserved_at')::timestamptz)
   or (receipt->>'reservation_id')::integer <= 0 then
  raise exception '[SG2-55:reserve-entire-request] [SG2-55:AC1] [SG2-55:AC4] [NORMAL] A successful reservation must persist the whole requested quantity and return its dated receipt';
 end if;
 if public.manage_equipment_reservations('reserve',95501,95501,1,'2031-10-01T09:00Z','2031-10-01T17:00Z')
   is distinct from '{"outcome":"conflict"}'::jsonb then
  raise exception '[SG2-55:replay-conflicts] [SG2-55:AC1] [CONFLICT] Replaying a reserved request must refuse a second receipt';
 end if;
 if public.manage_equipment_reservations('reserve',95502,95502,2,'2031-10-01T09:00Z','2031-10-01T17:00Z')
   is distinct from '{"outcome":"conflict"}'::jsonb then
  raise exception '[SG2-55:stale-request-conflicts] [SG2-55:AC1] [CONFLICT] A stale request version must not reserve';
 end if;
 if public.manage_equipment_reservations('reserve',95502,95502,1,'2031-10-01T09:00Z','2031-10-01T17:00Z')->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-55:exact-remaining-stock] [SG2-55:AC1] [SG2-55:AC3] [BOUNDARY] A request equal to remaining quantity must reserve successfully';
 end if;
 if public.manage_equipment_reservations('reserve',95503,95503,1,'2031-10-01T09:00Z','2031-10-01T17:00Z')
   is distinct from '{"outcome":"insufficient"}'::jsonb then
  raise exception '[SG2-55:over-remaining-stock] [SG2-55:AC3] [FAILURE] A request one above remaining must fail without oversubscribing';
 end if;
 result := public.check_equipment_availability(95503,95503,'2031-10-01T09:00Z','2031-10-01T17:00Z');
 if result->>'quantity_committed' is distinct from '10' or result->>'quantity_remaining' is distinct from '0'
   or result->>'shortfall' is distinct from '1' then
  raise exception '[SG2-55:reduces-other-event-availability] [SG2-55:AC2] [NORMAL] Committed reservations must immediately reduce overlapping event availability';
 end if;
 if public.manage_equipment_reservations('reserve',95503,95503,1,'2031-10-01T17:00Z','2031-10-01T18:00Z')->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-55:adjacent-period-free] [SG2-55:AC1] [SG2-55:AC2] [BOUNDARY] A period touching the prior end must not overlap';
 end if;
end $$;
reset role;
do $$
begin
 if (select status||'|'||version||'|'||notes||'|'||arrangement_notes||'|'||shortfall from public.equipment_requests where request_id=95501)
   is distinct from 'approved|2|Coordinator notes|Support arrangements|0'
   or not exists(select 1 from public.internal_work_items where kind='equipment' and item_id=95501 and status='approved') then
  raise exception '[SG2-55:freeze-approved-requirement] [SG2-55:AC1] [NORMAL] A reservation approves and versions its request, preserves arrangements, and retains support queue visibility';
 end if;
 -- Receipt and notification linkage is explicit, never a venue request id.
 if (select count(*) from public.notifications n join public.equipment_reservations r
   on r.reservation_id=n.equipment_reservation_id where r.request_id=95501
   and n.recipient_id='d5500000-0000-4000-8000-000000000003' and n.event_id=95501
   and n.kind='equipment_reserved' and n.request_id is null
   and n.message='Equipment reserved for Reservation event 1: 6 × Reservation microphones.') <> 1
   or (select count(*) from public.equipment_reservations where request_id=95501) <> 1 then
  raise exception '[SG2-55:notify-once-to-assigned-coordinator] [SG2-55:AC4] [NORMAL] Exactly one linked receipt and accurate notification must reach the assigned coordinator, including after replay';
 end if;
 if (select status||'|'||version from public.equipment_requests where request_id=95504) <> 'pending|1' then
  raise exception '[SG2-55:unrelated-request-unchanged] [SG2-55:AC1] [NORMAL] Reserving one event must leave an unrelated request unchanged';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
 result := public.manage_equipment_reservations('read',95501);
 if result->>'can_reserve' is distinct from 'false' or result->'reservations'->0->>'request_id' is distinct from '95501'
  or (select count(*) from public.notifications where event_id=95501 and kind='equipment_reserved') <> 1 then
  raise exception '[SG2-55:coordinator-sees-receipt-and-notice] [SG2-55:AC4] [NORMAL] The assigned coordinator must see the reservation and their notification';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000004',true);
do $$
begin
 if public.manage_equipment_reservations('read',95501) is distinct from '{"outcome":"missing"}'::jsonb
   or exists(select 1 from public.notifications where event_id=95501) then
  raise exception '[SG2-55:unassigned-coordinator-hidden] [SG2-55:AC4] [FAILURE] Another coordinator must see neither the event receipt nor its notification';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000008',true);
do $$
begin
 if public.manage_equipment_reservations('read',95501)->>'can_reserve' is distinct from 'false' then
  raise exception '[SG2-55:safety-read-only] [SG2-55:AC4] [NORMAL] Safety officers retain event visibility but cannot reserve';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000001',true);
do $$
begin
 if public.manage_equipment_reservations(null,95504)->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('delete',95504)->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('read',null)->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('read',0)->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('read',999999)->>'outcome' is distinct from 'missing'
  or public.manage_equipment_reservations('reserve',95504,null,1,'2031-10-02T09:00Z','2031-10-02T17:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,0,1,'2031-10-02T09:00Z','2031-10-02T17:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,9007199254740992,1,'2031-10-02T09:00Z','2031-10-02T17:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95504,null,'2031-10-02T09:00Z','2031-10-02T17:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95504,0,'2031-10-02T09:00Z','2031-10-02T17:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95504,9007199254740992,'2031-10-02T09:00Z','2031-10-02T17:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95505,1,'2031-10-02T09:00Z','2031-10-02T17:00Z')->>'outcome' is distinct from 'missing' then
  raise exception '[SG2-55:invalid-and-mismatched-resource] [SG2-55:AC1] [FAILURE] Invalid identifiers, versions and mismatched events must be refused';
 end if;
 if public.manage_equipment_reservations('reserve',95504,95504,1,null,'2031-10-02T17:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95504,1,'2031-10-02T09:00Z',null)->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95504,1,'2031-10-02T09:00Z','2031-10-02T09:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95504,1,'2031-10-02T17:00Z','2031-10-02T09:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95504,1,'-infinity','2031-10-02T09:00Z')->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_reservations('reserve',95504,95504,1,'2031-10-02T09:00Z','infinity')->>'outcome' is distinct from 'invalid' then
  raise exception '[SG2-55:finite-positive-period-required] [SG2-55:AC1] [FAILURE] Both selected dates must form a finite positive interval';
 end if;
end $$;
reset role;
-- Damaged, maintenance and zero-stock records each deny fresh requests.
do $$
declare state text; result jsonb;
begin
 foreach state in array array['damaged','maintenance','operational'] loop
  update public.equipment set operational_status=state,quantity_total=case when state='operational' then 0 else 10 end where equipment_id=95501;
  result := public.manage_equipment_reservations('reserve',95504,95504,1,'2031-10-02T09:00Z','2031-10-02T17:00Z');
  if result is distinct from '{"outcome":"insufficient"}'::jsonb then
   raise exception '[SG2-55:unavailable-stock-refused] [SG2-55:AC3] [FAILURE] Unavailable equipment must not reserve despite a previously positive check: %',state;
  end if;
 end loop;
 if exists(select 1 from public.equipment_reservations where request_id=95504)
  or (select status||'|'||version from public.equipment_requests where request_id=95504) <> 'pending|1' then
  raise exception '[SG2-55:insufficient-has-no-side-effects] [SG2-55:AC3] [FAILURE] Failed stock checks must not approve a request or persist a receipt';
 end if;
end $$;
update public.equipment set quantity_total=10 where equipment_id=95501;
-- Own-event legacy stock consumes the same shared equipment.
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved)
 values(95504,95501,10);
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.manage_equipment_reservations('read',95504);
 if result->'reservations'->0->>'quantity_reserved' is distinct from '10'
  or result->'reservations'->0->'request_id' is distinct from 'null'::jsonb
  or result->'reservations'->0->'starts_at' is distinct from 'null'::jsonb
  or result->'reservations'->0->'reserved_at' is distinct from 'null'::jsonb then
  raise exception '[SG2-55:legacy-receipt-visible] [SG2-55:AC4] [NORMAL] Legacy quantities and unknown dates must remain visible without fabricated receipt metadata';
 end if;
 if public.manage_equipment_reservations('reserve',95504,95504,1,'2031-10-02T09:00Z','2031-10-02T17:00Z')
  is distinct from '{"outcome":"insufficient"}'::jsonb then
  raise exception '[SG2-55:own-event-stock-counted] [SG2-55:AC3] [CONFLICT] Undated stock already reserved by this event must also consume availability';
 end if;
end $$;
reset role;
delete from public.equipment_reservations where event_id=95504;
-- Sequential commitments consume their peak, rather than their whole-day sum.
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at) values
 (95519,95501,9,'2031-10-02T09:00Z','2031-10-02T12:00Z'),
 (95520,95501,9,'2031-10-02T12:00Z','2031-10-02T17:00Z');
set local role authenticated;
do $$
begin
 if public.manage_equipment_reservations('reserve',95504,95504,1,'2031-10-02T09:00Z','2031-10-02T17:00Z')->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-55:peak-not-summed-commitments] [SG2-55:AC1] [SG2-55:AC2] [BOUNDARY] A single unit must fit alongside sequential nine-unit commitments in a ten-unit stock';
 end if;
end $$;
reset role;
-- Booking fallback and unknown legacy commitments remain conservative.
insert into public.venues(venue_id,name) values(95501,'Legacy equipment venue');
insert into public.venue_bookings(event_id,venue_id,starts_at,ends_at,status)
 values(95519,95501,'2031-10-03T09:00Z','2031-10-03T17:00Z','confirmed');
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved) values(95519,95504,10);
update public.equipment_requests set equipment_id=95504 where request_id=95505;
set local role authenticated;
do $$
begin
 if public.manage_equipment_reservations('reserve',95505,95505,2,'2031-10-03T09:00Z','2031-10-03T17:00Z')->>'outcome' is distinct from 'insufficient'
  or public.manage_equipment_reservations('reserve',95505,95505,2,'2031-10-03T17:00Z','2031-10-03T18:00Z')->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-55:legacy-booking-fallback] [SG2-55:AC1] [SG2-55:AC2] [BOUNDARY] Legacy reservations consume their confirmed booking interval and release at its endpoint';
 end if;
end $$;
reset role;
-- Cancellation/closure of another event releases its advisory commitments.
update public.events set status='cancelled' where event_id=95519;
update public.equipment_requests set equipment_id=95504 where request_id=95506;
set local role authenticated;
do $$
begin
 if public.manage_equipment_reservations('reserve',95506,95506,2,'2031-10-03T09:00Z','2031-10-03T17:00Z')->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-55:terminal-commitments-excluded] [SG2-55:AC1] [NORMAL] Cancelled-event equipment must no longer block another event';
 end if;
end $$;
reset role;
-- Current target stage and assignment always control writes and permission.
do $$
declare state public.event_status; result jsonb;
begin
 -- SG2-70: the loop moves the event from draft to submitted, which needs a category.
 update public.events set category='workshop' where event_id=95507;
 foreach state in array array['draft','submitted','under_review','cancelled']::public.event_status[] loop
  update public.events set status=state where event_id=95507;
  result := public.manage_equipment_reservations('reserve',95507,95507,1,'2031-10-04T09:00Z','2031-10-04T17:00Z');
  if result is distinct from '{"outcome":"closed"}'::jsonb
   or public.manage_equipment_reservations('read',95507)->>'can_reserve' is distinct from 'false' then
   raise exception '[SG2-55:closed-event-denied] [SG2-55:AC1] [FAILURE] An ineligible event must close reservation writes: %',state;
  end if;
 end loop;
 update public.events set status='planning',coordinator_id=null where event_id=95507;
 if public.manage_equipment_reservations('reserve',95507,95507,1,'2031-10-04T09:00Z','2031-10-04T17:00Z')->>'outcome' is distinct from 'closed'
  or public.manage_equipment_reservations('read',95507)->>'can_reserve' is distinct from 'false' then
  raise exception '[SG2-55:assigned-coordinator-required] [SG2-55:AC4] [FAILURE] A receipt may only be committed when its current coordinator can be notified';
 end if;
end $$;
update public.events set status='confirmed' where event_id=95508;
set local role authenticated;
do $$
begin
 if public.manage_equipment_reservations('reserve',95508,95508,1,'2031-10-04T09:00Z','2031-10-04T17:00Z')->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-55:confirmed-event-reservable] [SG2-55:AC1] [NORMAL] Support may reserve for a confirmed event even when requirement editing has closed';
 end if;
end $$;
reset role;
update public.equipment_requests set status='rejected' where request_id=95509;
set local role authenticated;
do $$
begin
 if public.manage_equipment_reservations('reserve',95509,95509,2,'2031-10-04T09:00Z','2031-10-04T17:00Z')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-55:closed-request-denied] [SG2-55:AC1] [FAILURE] A non-pending request without a receipt must not reserve';
 end if;
end $$;
reset role;
-- Failure of notification persistence must roll back every reservation effect.
alter table public.notifications add constraint reservation_test_notification_failure check(kind <> 'equipment_reserved') not valid;
set local role authenticated;
do $$
begin
 begin
  perform public.manage_equipment_reservations('reserve',95510,95510,1,'2031-10-04T09:00Z','2031-10-04T17:00Z');
  raise exception '[SG2-55:notification-failure-atomic] [SG2-55:AC4] [FAILURE] Notification failure must abort the reservation';
 exception when check_violation then null; end;
end $$;
reset role;
alter table public.notifications drop constraint reservation_test_notification_failure;
do $$
begin
 if exists(select 1 from public.equipment_reservations where request_id=95510)
  or exists(select 1 from public.notifications where event_id=95510)
  or (select status||'|'||version from public.equipment_requests where request_id=95510) <> 'pending|1' then
  raise exception '[SG2-55:notification-failure-no-partial-write] [SG2-55:AC4] [FAILURE] A failed notification must leave request, receipt and notification unchanged';
 end if;
end $$;
-- Aggregate arithmetic remains correct beyond int32 commitments.
update public.equipment_requests set equipment_id=95503 where request_id=95511;
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved)
 values(95512,95503,2147483647),(95513,95503,2147483647);
set local role authenticated;
do $$
begin
 if public.manage_equipment_reservations('reserve',95511,95511,2,'2031-10-04T09:00Z','2031-10-04T17:00Z')->>'outcome' is distinct from 'insufficient' then
  raise exception '[SG2-55:large-commitments-do-not-overflow] [SG2-55:AC3] [BOUNDARY] Commitments above int32 must not wrap into available stock';
 end if;
end $$;
reset role;
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,version)
 values(95521,95521,95501,1,9007199254740991);
set local role authenticated;
do $$
begin
 if public.manage_equipment_reservations('reserve',95521,95521,9007199254740991,'2031-10-05T09:00Z','2031-10-05T17:00Z')->>'outcome' is distinct from 'conflict' then
  raise exception '[SG2-55:version-exhaustion-conflicts] [SG2-55:AC1] [BOUNDARY] The maximum safe request version must fail without an overflowing approval update';
 end if;
end $$;
reset role;
update public.events set status='approved' where event_id=95513;
set local role authenticated;
do $$
begin
 if public.manage_equipment_reservations('reserve',95513,95513,1,'2031-10-05T09:00Z','2031-10-05T17:00Z')->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-55:approved-event-reservable] [SG2-55:AC1] [NORMAL] An approved event may reserve before planning starts';
 end if;
end $$;
reset role;
update public.events set name=null where event_id=95514;
set local role authenticated;
do $$
declare result jsonb; receipt jsonb; requirement jsonb;
begin
 result := public.manage_equipment_reservations('reserve',95514,95514,1,'2031-10-06T09:00Z','2031-10-06T17:00Z');
 receipt := result->'reservations'->0;
 perform set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000003',true);
 requirement := public.manage_equipment_requirements('read',95514)->'requests'->0;
 if result->>'outcome' is distinct from 'ok' or result->>'coordinator_notified' is distinct from 'true'
  or receipt->>'request_id' is distinct from '95514' or receipt->>'quantity_reserved' is distinct from '1'
  or public.manage_equipment_reservations('read',95514)->'reservations' is distinct from result->'reservations'
  or requirement->>'status' is distinct from 'approved' or requirement->>'version' is distinct from '2'
  or (select count(*) from public.notifications where event_id=95514 and kind='equipment_reserved'
    and equipment_reservation_id=(receipt->>'reservation_id')::integer and request_id is null
    and message='Equipment reserved for Untitled event: 1 × Reservation microphones.') <> 1 then
  raise exception '[SG2-55:null-event-name-notified] [SG2-55:AC1] [SG2-55:AC4] [BOUNDARY] A null event name must still produce one readable receipt, approved request and exact Untitled event notification';
 end if;
 perform set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000001',true);
end $$;
reset role;
update public.events set name='' where event_id=95515;
set local role authenticated;
do $$
declare result jsonb; receipt jsonb; requirement jsonb;
begin
 result := public.manage_equipment_reservations('reserve',95515,95515,1,'2031-10-06T09:00Z','2031-10-06T17:00Z');
 receipt := result->'reservations'->0;
 perform set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000003',true);
 requirement := public.manage_equipment_requirements('read',95515)->'requests'->0;
 if result->>'outcome' is distinct from 'ok' or result->>'coordinator_notified' is distinct from 'true'
  or receipt->>'request_id' is distinct from '95515' or receipt->>'quantity_reserved' is distinct from '1'
  or public.manage_equipment_reservations('read',95515)->'reservations' is distinct from result->'reservations'
  or requirement->>'status' is distinct from 'approved' or requirement->>'version' is distinct from '2'
  or (select count(*) from public.notifications where event_id=95515 and kind='equipment_reserved'
    and equipment_reservation_id=(receipt->>'reservation_id')::integer and request_id is null
    and message='Equipment reserved for Untitled event: 1 × Reservation microphones.') <> 1 then
  raise exception '[SG2-55:empty-event-name-notified] [SG2-55:AC1] [SG2-55:AC4] [BOUNDARY] A empty event name must still produce one readable receipt, approved request and exact Untitled event notification';
 end if;
 perform set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000001',true);
end $$;
-- A fresh requirement still needs placement after stock is committed.
do $$
declare result jsonb; requirement jsonb;
begin
 result := public.manage_equipment_reservations('reserve',95516,95516,1,'2031-10-07T09:00Z','2031-10-07T17:00Z');
 requirement := public.manage_equipment_requirements('read',95516)->'requests'->0;
 if result->>'outcome' is distinct from 'ok' or requirement->>'status' is distinct from 'approved'
  or requirement->>'version' is distinct from '2' or requirement->>'shortfall' is distinct from '0'
  or requirement->'placement_venue_id' is distinct from 'null'::jsonb
  or requirement->'arrangement_notes' is distinct from 'null'::jsonb then
  raise exception '[SG2-55:fresh-reservation-still-needs-placement] [SG2-55:AC1] [NORMAL] A full reservation clears stock shortfall but must not invent missing placement or arrangement details';
 end if;
 result := public.manage_equipment_requirements('arrange',95516,95516,2,
  '{"shortfall":0,"arrangement_notes":"Ready at stage","placement_venue_id":95501,"placement_position":"Stage left"}');
 requirement := result->'requests'->0;
 if result->>'outcome' is distinct from 'ok' or requirement->>'status' is distinct from 'approved'
  or requirement->>'version' is distinct from '3' or requirement->>'shortfall' is distinct from '0'
  or requirement->>'placement_venue_id' is distinct from '95501' or requirement->>'placement_position' is distinct from 'Stage left'
  or requirement->>'arrangement_notes' is distinct from 'Ready at stage' or requirement->>'quantity' is distinct from '1'
  or requirement->>'equipment_id' is distinct from '95501' then
  raise exception '[SG2-55:reserved-request-arrangeable] [SG2-55:AC1] [NORMAL] Support must be able to complete reserved equipment placement while preserving approved demand and advancing its version';
 end if;
 if public.manage_equipment_requirements('arrange',95516,95516,2,'{"shortfall":0}')->>'outcome' is distinct from 'conflict' then
  raise exception '[SG2-55:reserved-arrangement-version-conflict] [SG2-55:AC1] [CONFLICT] Reserved arrangement edits must still reject stale versions';
 end if;
 perform set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000003',true);
 if public.manage_equipment_requirements('amend',95516,95516,3,'{"equipment_id":95502,"quantity":2,"notes":"Change reserved demand"}')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-55:reserved-demand-remains-frozen] [SG2-55:AC1] [FAILURE] Arrangement access must never reopen reserved equipment or quantity amendments';
 end if;
 perform set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-000000000001',true);
end $$;
reset role;
do $$
declare request_before jsonb; receipts_before jsonb; notifications_before jsonb; result jsonb;
begin
 select to_jsonb(r) into request_before from public.equipment_requests r where request_id=95516;
 select jsonb_agg(to_jsonb(r) order by reservation_id) into receipts_before
  from public.equipment_reservations r where event_id=95516;
 select jsonb_agg(to_jsonb(n) order by notification_id) into notifications_before
  from public.notifications n where event_id=95516;
 set local role authenticated;
 result := public.manage_equipment_requirements('arrange',95516,95516,3,
  '{"shortfall":1,"arrangement_notes":"Must not overwrite saved placement","placement_venue_id":null,"placement_position":null}');
 reset role;
 if result is distinct from '{"outcome":"invalid"}'::jsonb
  or (select to_jsonb(r) from public.equipment_requests r where request_id=95516) is distinct from request_before
  or (select jsonb_agg(to_jsonb(r) order by reservation_id) from public.equipment_reservations r where event_id=95516) is distinct from receipts_before
  or (select jsonb_agg(to_jsonb(n) order by notification_id) from public.notifications n where event_id=95516) is distinct from notifications_before then
  raise exception '[SG2-55:reserved-shortfall-one-rejected] [SG2-55:AC1] [BOUNDARY] [FAILURE] A fully reserved requirement must reject even one unit of shortfall without changing its stored request, version, receipt or notification';
 end if;
end $$;
do $$
begin
 if not exists(select 1 from public.internal_work_items where kind='equipment' and item_id=95516 and status='approved'
   and details->>'placement_venue_id'='95501' and details->>'version'='3' and details->>'shortfall'='0')
  or (select quantity||'|'||equipment_id||'|'||status from public.equipment_requests where request_id=95516) <> '1|95501|approved'
  or (select count(*) from public.equipment_reservations where request_id=95516 and quantity_reserved=1 and equipment_id=95501) <> 1
  or (select count(*) from public.notifications where event_id=95516 and kind='equipment_reserved') <> 1 then
  raise exception '[SG2-55:arranged-reservation-remains-visible] [SG2-55:AC4] [NORMAL] Arranging reserved stock must retain the support queue item without changing or duplicating its receipt and notification';
 end if;
end $$;
update public.equipment_requests set status='approved' where request_id=95517;
set local role authenticated;
do $$
begin
 if public.manage_equipment_requirements('arrange',95517,95517,2,'{"shortfall":0}')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-55:legacy-approved-without-receipt-closed] [SG2-55:AC1] [FAILURE] An approved request without a reservation receipt must retain its original closed arrangement policy';
 end if;
 if public.manage_equipment_requirements('arrange',95508,95508,2,'{"shortfall":0}')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-55:confirmed-reserved-arrangement-closed] [SG2-55:AC1] [FAILURE] Reservation arrangement support must preserve the preconfirmation event-stage restriction';
 end if;
end $$;
-- Stored roles and database grants are the authority at every call.
do $$
declare n integer;
begin
 for n in 2..9 loop
  perform set_config('request.jwt.claim.sub','d5500000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  begin
   perform public.manage_equipment_reservations('reserve',95512,95512,1,'2031-10-05T09:00Z','2031-10-05T17:00Z');
   raise exception '[SG2-55:only-support-can-reserve] [SG2-55:AC1] [FAILURE] A non-support account must not reserve equipment: %',n;
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.manage_equipment_reservations('read',95501);
  raise exception '[SG2-55:identity-required] [SG2-55:AC4] [FAILURE] A database role without caller identity must not read receipts';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$
begin
 begin
  perform public.manage_equipment_reservations('read',95501);
  raise exception '[SG2-55:anonymous-execute-denied] [SG2-55:AC4] [FAILURE] Anonymous callers must not execute the reservation RPC';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare role_name text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  if has_table_privilege(role_name,'public.equipment_reservations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   or has_any_column_privilege(role_name,'public.equipment_reservations','SELECT,INSERT,UPDATE,REFERENCES') then
   raise exception '[SG2-55:no-direct-reservation-access] [SG2-55:AC1] [FAILURE] Reservation access must remain confined to the guarded RPC';
  end if;
 end loop;
 if not exists(select 1 from pg_proc where oid='public.manage_equipment_reservations(text,integer,bigint,bigint,timestamptz,timestamptz)'::regprocedure
   and prosecdef and provolatile='v' and proconfig @> array['search_path=""'])
  or not has_function_privilege('authenticated','public.manage_equipment_reservations(text,integer,bigint,bigint,timestamptz,timestamptz)','EXECUTE') then
  raise exception '[SG2-55:guarded-fresh-snapshot-rpc] [SG2-55:AC1] [NORMAL] Reservation writes must use a scoped definer and fresh statements after row-lock waits';
 end if;
end $$;
rollback;
