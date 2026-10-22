-- SG2-68 organiser venue notices and notification kinds, with isolated fixture changes rolled back.
begin;
insert into auth.users(id)
 select ('e6800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
insert into public.users(user_id,name,role_id) values
 ('e6800000-0000-4000-8000-000000000001','Notice venue staff',3),
 ('e6800000-0000-4000-8000-000000000002','Notice coordinator',2),
 ('e6800000-0000-4000-8000-000000000003','Notice organiser',1),
 ('e6800000-0000-4000-8000-000000000004','Unrelated organiser',1),
 ('e6800000-0000-4000-8000-000000000005','Unrelated coordinator',2),
 ('e6800000-0000-4000-8000-000000000006','Organising coordinator',2);
insert into public.account_roles(user_id,role) values
 ('e6800000-0000-4000-8000-000000000001','venue_staff'),
 ('e6800000-0000-4000-8000-000000000002','event_coordinator'),
 ('e6800000-0000-4000-8000-000000000003','event_organiser'),
 ('e6800000-0000-4000-8000-000000000004','event_organiser'),
 ('e6800000-0000-4000-8000-000000000005','event_coordinator'),
 ('e6800000-0000-4000-8000-000000000006','event_coordinator');
insert into public.venues(venue_id,name,capacity) values (96801,'Notice Hall',100),(96802,'Notice Annex',100);
-- 96801 approved and 96802 rejected (unnamed event) notify organiser and coordinator;
-- 96803 is organised by a user who also works as a coordinator, but (SG2-104
-- separation of duties) is coordinated by someone else; 96804 has no coordinator yet;
-- 96805 is converted from a hold and 96806 is released from one; the
-- unrelated organiser's 96807 is never decided.
insert into public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance) values
 (96801,'e6800000-0000-4000-8000-000000000003','e6800000-0000-4000-8000-000000000002','Notice forum','approved',50),
 (96802,'e6800000-0000-4000-8000-000000000003','e6800000-0000-4000-8000-000000000002','','planning',50),
 (96803,'e6800000-0000-4000-8000-000000000006','e6800000-0000-4000-8000-000000000002','Self-run forum','approved',50),
 (96804,'e6800000-0000-4000-8000-000000000003',null,'Unassigned forum','approved',50),
 (96805,'e6800000-0000-4000-8000-000000000003','e6800000-0000-4000-8000-000000000002','Hold forum','planning',50),
 (96806,'e6800000-0000-4000-8000-000000000003','e6800000-0000-4000-8000-000000000002','Released forum','planning',50),
 (96807,'e6800000-0000-4000-8000-000000000004','e6800000-0000-4000-8000-000000000005','Unrelated forum','approved',50);
insert into public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,layout,requested_by) values
 (96801,96801,96801,'2031-09-01T02:00Z','2031-09-01T06:00Z','theatre','e6800000-0000-4000-8000-000000000002'),
 (96802,96802,96801,'2031-09-02T02:00Z','2031-09-02T06:00Z','theatre','e6800000-0000-4000-8000-000000000002'),
 (96803,96803,96801,'2031-09-03T02:00Z','2031-09-03T06:00Z','theatre','e6800000-0000-4000-8000-000000000002'),
 (96804,96804,96801,'2031-09-04T02:00Z','2031-09-04T06:00Z','theatre','e6800000-0000-4000-8000-000000000003'),
 (96808,96804,96801,'2031-09-01T05:00Z','2031-09-01T08:00Z','theatre','e6800000-0000-4000-8000-000000000003'),
 (96809,96807,96801,'2031-09-09T02:00Z','2031-09-09T06:00Z','theatre','e6800000-0000-4000-8000-000000000005');

set local role authenticated;
select set_config('request.jwt.claim.sub','e6800000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
 result := public.decide_venue_booking_request(96801,'approve',null);
 if result->>'outcome' is distinct from 'updated' or result->>'status' is distinct from 'approved' then
  raise exception '[SG2-68:venue-approval-decided] [SG2-68:AC1] [NORMAL] Venue Staff must approve the organiser''s venue request: %', result;
 end if;
 result := public.decide_venue_booking_request(96802,'reject','Hall closed for repairs');
 if result->>'outcome' is distinct from 'updated' or result->>'status' is distinct from 'rejected' then
  raise exception '[SG2-68:venue-rejection-decided] [SG2-68:AC1] [NORMAL] Venue Staff must reject the organiser''s venue request: %', result;
 end if;
 result := public.decide_venue_booking_request(96803,'approve',null);
 if result->>'outcome' is distinct from 'updated' then
  raise exception '[SG2-68:self-run-approval-decided] [SG2-68:AC1] [NORMAL] Venue Staff must approve a request whose organiser coordinates it: %', result;
 end if;
 result := public.decide_venue_booking_request(96804,'approve',null);
 if result->>'outcome' is distinct from 'updated' then
  raise exception '[SG2-68:unassigned-approval-decided] [SG2-68:AC1] [NORMAL] Venue Staff must approve a request on an event without a coordinator: %', result;
 end if;
end $$;
reset role;

-- AC1/AC2: organiser and coordinator are each told once, naming venue and event, with the time.
do $$
begin
 if (select string_agg(recipient_id||'|'||event_id||'|'||kind||'|'||message, ' / ' order by recipient_id)
     from public.notifications where request_id=96801)
   is distinct from 'e6800000-0000-4000-8000-000000000002|96801|venue_request_approved|Notice Hall was approved for Notice forum. / '
     ||'e6800000-0000-4000-8000-000000000003|96801|venue_request_approved|Notice Hall was approved for Notice forum.'
   or exists(select 1 from public.notifications where request_id=96801 and created_at is null) then
  raise exception '[SG2-68:approval-notifies-organiser-and-coordinator] [SG2-68:AC1] [SG2-68:AC2] [NORMAL] An approval must notify organiser and coordinator exactly once each with the venue, event and time';
 end if;
 if (select string_agg(recipient_id||'|'||event_id||'|'||kind||'|'||message, ' / ' order by recipient_id)
     from public.notifications where request_id=96802)
   is distinct from 'e6800000-0000-4000-8000-000000000002|96802|venue_request_rejected|Notice Hall was rejected for Untitled event: Hall closed for repairs / '
     ||'e6800000-0000-4000-8000-000000000003|96802|venue_request_rejected|Notice Hall was rejected for Untitled event: Hall closed for repairs' then
  raise exception '[SG2-68:rejection-notifies-organiser-and-coordinator] [SG2-68:AC1] [SG2-68:AC2] [NORMAL] A rejection must notify organiser and coordinator exactly once each with the reason and a named event';
 end if;
end $$;

-- An organiser can no longer coordinate their own event (SG2-104), so the
-- organiser and the coordinator are each told once; with no coordinator, only the organiser.
do $$
begin
 if (select string_agg(recipient_id||'|'||kind||'|'||message, ' / ' order by recipient_id) from public.notifications where request_id=96803)
   is distinct from 'e6800000-0000-4000-8000-000000000002|venue_request_approved|Notice Hall was approved for Self-run forum. / e6800000-0000-4000-8000-000000000006|venue_request_approved|Notice Hall was approved for Self-run forum.' then
  raise exception '[SG2-68:organising-coordinator-told-once] [SG2-68:AC1] [SG2-104:AC2] [BOUNDARY] An organiser who also works as a coordinator, and the event''s own coordinator, must each get exactly one notice';
 end if;
 if (select string_agg(recipient_id||'|'||kind||'|'||message, ' / ') from public.notifications where request_id=96804)
   is distinct from 'e6800000-0000-4000-8000-000000000003|venue_request_approved|Notice Hall was approved for Unassigned forum.' then
  raise exception '[SG2-68:unassigned-event-organiser-told] [SG2-68:AC1] [BOUNDARY] With no coordinator, only the organiser must be notified';
 end if;
end $$;

-- Replays, refusals and non-staff calls add nothing.
set local role authenticated;
select set_config('request.jwt.claim.sub','e6800000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
 result := public.decide_venue_booking_request(96801,'reject','Changed my mind');
 if result is distinct from '{"outcome":"decided","status":"approved"}'::jsonb then
  raise exception '[SG2-68:replayed-decision-refused] [SG2-68:AC1] [CONFLICT] A second decision on a decided request must be refused: %', result;
 end if;
 result := public.decide_venue_booking_request(96808,'approve',null);
 if result->>'outcome' is distinct from 'conflict' then
  raise exception '[SG2-68:clashing-approval-refused] [SG2-68:AC1] [CONFLICT] An approval clashing with a booking must be refused: %', result;
 end if;
end $$;
select set_config('request.jwt.claim.sub','e6800000-0000-4000-8000-000000000003',true);
do $$
begin
 begin
  perform public.decide_venue_booking_request(96809,'approve',null);
  raise exception '[SG2-68:organiser-cannot-decide] [SG2-68:AC3] [FAILURE] An organiser decided a venue request';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
 if (select count(*) from public.notifications where request_id=96801) <> 2
   or exists(select 1 from public.notifications where request_id in (96808,96809) or event_id=96807) then
  raise exception '[SG2-68:refused-decisions-add-no-notice] [SG2-68:AC1] [CONFLICT] A replayed, clashing or forbidden decision must not add notifications';
 end if;
end $$;

-- AC1: converting a hold tells the organiser; releasing one tells nobody here.
set local role authenticated;
select set_config('request.jwt.claim.sub','e6800000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb; converting bigint; releasing bigint;
begin
 result := public.create_venue_hold(96805,96802,now()+interval '20 days',now()+interval '20 days 2 hours',clock_timestamp()+interval '2 days');
 converting := (result#>>'{hold,hold_id}')::bigint;
 result := public.create_venue_hold(96806,96802,now()+interval '21 days',now()+interval '21 days 2 hours',clock_timestamp()+interval '2 days');
 releasing := (result#>>'{hold,hold_id}')::bigint;
 if converting is null or releasing is null then
  raise exception '[SG2-68:holds-placed] [SG2-68:AC1] [NORMAL] Venue Staff must place both holds: %', result;
 end if;
 perform set_config('notice.convert',converting::text,true);
 result := public.change_venue_hold(converting,'convert');
 if result->>'outcome' is distinct from 'updated' or result#>>'{hold,status}' is distinct from 'converted' then
  raise exception '[SG2-68:hold-converted] [SG2-68:AC1] [NORMAL] Venue Staff must convert the hold: %', result;
 end if;
 result := public.change_venue_hold(releasing,'release');
 if result->>'outcome' is distinct from 'updated' or result#>>'{hold,status}' is distinct from 'released' then
  raise exception '[SG2-68:hold-released] [SG2-68:AC1] [NORMAL] Venue Staff must release the hold: %', result;
 end if;
 result := public.change_venue_hold(converting,'convert');
 if result->>'outcome' is distinct from 'inactive' then
  raise exception '[SG2-68:replayed-conversion-refused] [SG2-68:AC1] [CONFLICT] Converting a converted hold again must be refused: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select string_agg(n.recipient_id||'|'||n.event_id||'|'||n.kind||'|'||n.message, ' / ')
     from public.notifications n join public.venue_holds h using(request_id)
     where h.hold_id=current_setting('notice.convert')::bigint)
   is distinct from 'e6800000-0000-4000-8000-000000000003|96805|venue_request_approved|Notice Annex was approved for Hold forum.' then
  raise exception '[SG2-68:conversion-notifies-organiser] [SG2-68:AC1] [SG2-68:AC2] [NORMAL] A converted hold must notify the organiser exactly once, naming venue and event';
 end if;
 if exists(select 1 from public.notifications where event_id=96806) then
  raise exception '[SG2-68:release-adds-no-organiser-notice] [SG2-68:AC1] [BOUNDARY] Releasing a hold must not send an approval notice';
 end if;
end $$;

-- AC3: each person reads only their own notices; unrelated people read none.
set local role authenticated;
do $$
begin
 perform set_config('request.jwt.claim.sub','e6800000-0000-4000-8000-000000000003',true);
 if (select string_agg(event_id||'|'||kind||'|'||message, ' / ' order by event_id) from public.notifications)
   is distinct from '96801|venue_request_approved|Notice Hall was approved for Notice forum. / '
     ||'96802|venue_request_rejected|Notice Hall was rejected for Untitled event: Hall closed for repairs / '
     ||'96804|venue_request_approved|Notice Hall was approved for Unassigned forum. / '
     ||'96805|venue_request_approved|Notice Annex was approved for Hold forum.' then
  raise exception '[SG2-68:organiser-reads-own-notices] [SG2-68:AC3] [NORMAL] The organiser must read exactly their own notices';
 end if;
 perform set_config('request.jwt.claim.sub','e6800000-0000-4000-8000-000000000002',true);
 if (select string_agg(event_id||'|'||kind, ' / ' order by event_id) from public.notifications)
   is distinct from '96801|venue_request_approved / 96802|venue_request_rejected / 96803|venue_request_approved' then
  raise exception '[SG2-68:coordinator-reads-own-notices] [SG2-68:AC3] [NORMAL] The coordinator must read exactly their own notices';
 end if;
 perform set_config('request.jwt.claim.sub','e6800000-0000-4000-8000-000000000004',true);
 if exists(select 1 from public.notifications) then
  raise exception '[SG2-68:unrelated-organiser-reads-nothing] [SG2-68:AC3] [FAILURE] An organiser read notices about someone else''s event';
 end if;
 perform set_config('request.jwt.claim.sub','e6800000-0000-4000-8000-000000000005',true);
 if exists(select 1 from public.notifications) then
  raise exception '[SG2-68:unrelated-coordinator-reads-nothing] [SG2-68:AC3] [FAILURE] A coordinator read notices about an event they do not coordinate';
 end if;
 begin
  insert into public.notifications(recipient_id,event_id,kind,message)
   values('e6800000-0000-4000-8000-000000000004',96807,'event_submitted','Forged');
  raise exception '[SG2-68:client-cannot-write-notice] [SG2-68:AC3] [FAILURE] A client wrote a notification directly';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The server's new kinds are accepted, every earlier kind still is, and unknown kinds are refused.
do $$
declare kind_name text; reservation integer;
begin
 foreach kind_name in array array['event_submitted','coordinator_assigned','clarification_requested','event_approved','event_rejected'] loop
  insert into public.notifications(recipient_id,event_id,kind,message)
   values('e6800000-0000-4000-8000-000000000003',96801,kind_name,'Notice forum: '||kind_name);
 end loop;
 if (select count(*) from public.notifications where event_id=96801 and request_id is null) <> 5 then
  raise exception '[SG2-68:new-kinds-accepted] [SG2-68:AC1] [NORMAL] Every SG2-68 notification kind must be accepted';
 end if;
 foreach kind_name in array array['venue_request_approved','venue_request_rejected','venue_booking_released','venue_booking_clash','event_confirmed'] loop
  insert into public.notifications(recipient_id,event_id,kind,message)
   values('e6800000-0000-4000-8000-000000000004',96807,kind_name,'Unrelated forum: '||kind_name);
 end loop;
 insert into public.equipment(equipment_id,name,quantity_total) values (96801,'Notice projectors',5);
 insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at,reserved_at)
  values (96807,96801,1,'2031-09-09T02:00Z','2031-09-09T06:00Z','2031-08-01T00:00Z') returning reservation_id into reservation;
 insert into public.notifications(recipient_id,event_id,kind,equipment_reservation_id,message)
  values('e6800000-0000-4000-8000-000000000004',96807,'equipment_reserved',reservation,'Unrelated forum: equipment_reserved');
 if (select string_agg(kind, ',' order by kind) from public.notifications where event_id=96807)
   is distinct from 'equipment_reserved,event_confirmed,venue_booking_clash,venue_booking_released,venue_request_approved,venue_request_rejected' then
  raise exception '[SG2-68:earlier-kinds-still-accepted] [SG2-68:AC1] [BOUNDARY] Every notification kind allowed before SG2-68 must still be accepted';
 end if;
 begin
  insert into public.notifications(recipient_id,event_id,kind,message)
   values('e6800000-0000-4000-8000-000000000003',96801,'event_postponed','Notice forum was postponed.');
  raise exception '[SG2-68:unknown-kind-refused] [SG2-68:AC1] [FAILURE] A notification kind outside the agreed list was accepted';
 exception when check_violation then null; end;
end $$;

rollback;
