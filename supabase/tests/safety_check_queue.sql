-- SG2-91: events move into (and out of) Awaiting Safety Check as their venue
-- and equipment arrangements complete (or fall through), and only a Safety
-- Officer reads the list. Isolated fixture changes are rolled back.
begin;
insert into auth.users(id)
 select ('d9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8) n;
insert into public.users(user_id,name,role_id) values
 ('d9100000-0000-4000-8000-000000000001','Safety organiser',1),
 ('d9100000-0000-4000-8000-000000000002','Safety coordinator',2),
 ('d9100000-0000-4000-8000-000000000003','Safety venue staff',3),
 ('d9100000-0000-4000-8000-000000000004','Safety support',4),
 ('d9100000-0000-4000-8000-000000000005','Safety attendee',5),
 ('d9100000-0000-4000-8000-000000000006','Safety lead',6),
 ('d9100000-0000-4000-8000-000000000007','Safety officer',7),
 ('d9100000-0000-4000-8000-000000000008','Safety roleless',5);
insert into public.account_roles(user_id,role) values
 ('d9100000-0000-4000-8000-000000000001','event_organiser'),
 ('d9100000-0000-4000-8000-000000000002','event_coordinator'),
 ('d9100000-0000-4000-8000-000000000003','venue_staff'),
 ('d9100000-0000-4000-8000-000000000004','technical_support_staff'),
 ('d9100000-0000-4000-8000-000000000005','attendee'),
 ('d9100000-0000-4000-8000-000000000006','event_coordinator_lead'),
 ('d9100000-0000-4000-8000-000000000007','safety_officer');
insert into public.venues(venue_id,name,location,capacity,accessibility_features) values
 (99101,'Safety hall','Level 1',300,'Step-free entrance'),
 (99102,'Safety annex','Level 2',40,null),
 (99103,'Safety studio','Level 3',60,null);
insert into public.venue_operations(venue_id,emergency_access,known_restrictions) values
 (99101,'Two exits onto the east concourse','No open flames');
insert into public.equipment(equipment_id,name,quantity_total) values (99101,'Safety speakers',20);
-- 99101-99112: Planning events; 99113 Approved; 99114 Preparation.
insert into public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance,accessibility_needs,
  expected_crowd_movement,registration_needed)
 select 99100+n,'d9100000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000002',
  'Safety event '||n,case n when 13 then 'approved' when 14 then 'preparation' else 'planning' end::public.event_status,
  100+n,'Wheelchair seating for '||n,'Enter by the east doors, leave by the west doors',true
 from generate_series(1,14) n;

-- A confirmed booking and the approved request it backs, as a venue decision
-- leaves them. Written as one fixture step per event.
create function pg_temp.book(p_event integer, p_venue integer, p_day integer) returns bigint
language plpgsql as $$
declare booking bigint;
begin
 insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
  values(p_venue,p_event,'2031-11-01T09:00Z'::timestamptz+p_day*interval '1 day',
   '2031-11-01T17:00Z'::timestamptz+p_day*interval '1 day','confirmed') returning booking_id into booking;
 insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status,venue_booking_id)
  values(p_event,p_venue,'2031-11-01T09:00Z'::timestamptz+p_day*interval '1 day',
   '2031-11-01T17:00Z'::timestamptz+p_day*interval '1 day','approved',booking);
 return booking;
end $$;

-- AC1: the real writers, in the order a coordinator, Venue Staff and
-- Technical Support use them. The event only moves once the last arrangement
-- (the equipment reservation) is in place, and the move names who made it.
set local role authenticated;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000002',true);
do $$
begin
 if public.manage_equipment_requirements('create',99101,null,null,'{"equipment_id":99101,"quantity":2}')->>'outcome' <> 'ok' then
  raise exception '[SG2-91:fixture-equipment-request] [SG2-91:AC1] [NORMAL] The coordinator must be able to request equipment';
 end if;
end $$;
reset role;
insert into public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,status,requested_by,layout)
 values (99101,99101,99101,'2031-11-01T09:00Z','2031-11-01T17:00Z','pending','d9100000-0000-4000-8000-000000000002','theatre');
set local role authenticated;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000003',true);
do $$
begin
 if public.decide_venue_booking_request(99101,'approve',null)->>'status' is distinct from 'approved' then
  raise exception '[SG2-91:fixture-venue-approved] [SG2-91:AC1] [NORMAL] Venue Staff must be able to approve the venue';
 end if;
end $$;
reset role;
do $$
begin
 if (select status from public.events where event_id=99101) <> 'planning' then
  raise exception '[SG2-91:waits-for-equipment] [SG2-91:AC1] [FAILURE] An approved venue alone must not move an event whose requested equipment is not reserved';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000004',true);
do $$
declare request bigint; result jsonb;
begin
 result := public.manage_equipment_requirements('read',99101);
 request := (result#>>'{requests,0,request_id}')::bigint;
 result := public.manage_equipment_requirements('arrange',99101,request,(result#>>'{requests,0,version}')::bigint,
  '{"shortfall":0,"placement_venue_id":99101,"placement_position":"Stage left","arrangement_notes":"Cable ramps"}');
 if result->>'outcome' <> 'ok' or result#>>'{event,status}' <> 'planning' then
  raise exception '[SG2-91:waits-for-reservation] [SG2-91:AC1] [FAILURE] Placed equipment that is not yet reserved must keep the event in Planning: %',result;
 end if;
 result := public.manage_equipment_reservations('reserve',99101,request,(result#>>'{requests,0,version}')::bigint,
  '2031-11-01T09:00Z','2031-11-01T17:00Z');
 if result->>'outcome' <> 'ok' then
  raise exception '[SG2-91:fixture-equipment-reserved] [SG2-91:AC1] [NORMAL] Technical Support must be able to reserve the equipment: %',result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status from public.events where event_id=99101) <> 'awaiting_safety_check'
   or (select awaiting_safety_check_since from public.events where event_id=99101) is null then
  raise exception '[SG2-91:ready-event-awaits-check] [SG2-91:AC1] [NORMAL] Approved venues and reserved equipment must move the event to Awaiting Safety Check and stamp the wait';
 end if;
 if (select count(*) from public.event_audit_logs where event_id=99101 and field_name='status') <> 1
   or (select actor_id::text||'|'||old_value||'|'||new_value from public.event_audit_logs where event_id=99101 and field_name='status')
   is distinct from 'd9100000-0000-4000-8000-000000000004|planning|awaiting_safety_check' then
  raise exception '[SG2-91:move-audited-by-actor] [SG2-91:AC1] [NORMAL] The move must be one history row naming the person whose change completed the arrangements';
 end if;
end $$;

-- AC1: an Approved event with one booked venue and no equipment is
-- ready (no equipment requested means none required). A fixture write has no
-- caller, so the history names the assigned coordinator.
select set_config('request.jwt.claim.sub','',true);
select pg_temp.book(99113,99102,13);
-- A rejected equipment request is not required either.
select pg_temp.book(99109,99103,9);
insert into public.equipment_requests(event_id,equipment_id,quantity,status) values (99109,99101,1,'rejected');
do $$
begin
 if (select status from public.events where event_id=99113) <> 'awaiting_safety_check'
   or (select actor_id::text||'|'||old_value from public.event_audit_logs where event_id=99113 and field_name='status')
   is distinct from 'd9100000-0000-4000-8000-000000000002|approved' then
  raise exception '[SG2-91:approved-event-without-equipment-awaits] [SG2-91:AC1] [BOUNDARY] An Approved event with a booked venue and no equipment must await the check, attributed to its coordinator when there is no caller';
 end if;
 if (select status from public.events where event_id=99109) <> 'awaiting_safety_check' then
  raise exception '[SG2-91:rejected-equipment-not-required] [SG2-91:AC1] [BOUNDARY] A rejected equipment request must not hold the event back';
 end if;
end $$;

-- AC1/: each missing arrangement keeps the event where it
-- is, and events outside Approved/Planning are never moved.
insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status) values
 (99103,99103,'2031-12-03T09:00Z','2031-12-03T17:00Z','cancelled'),
 (99104,99103,'2031-12-04T09:00Z','2031-12-04T17:00Z','approved');
insert into public.equipment_requests(event_id,equipment_id,quantity,status,shortfall,placement_venue_id,placement_position)
 values (99105,99101,1,'approved',1,99103,'Corner');
select pg_temp.book(99105,99103,5);
update public.events set arrangements_recheck_needed=true,outstanding_arrangements='["venue_recheck"]' where event_id=99106;
select pg_temp.book(99106,99103,6);
select pg_temp.book(99114,99103,14);
do $$
begin
 if (select status from public.events where event_id=99103) <> 'planning' then
  raise exception '[SG2-91:no-venue-not-ready] [SG2-91:AC1] [BOUNDARY] An event whose only venue request was cancelled has no venue and must stay in Planning';
 end if;
 if (select status from public.events where event_id=99104) <> 'planning' then
  raise exception '[SG2-91:unbooked-approval-not-ready] [SG2-91:AC1] [FAILURE] An approved request without a confirmed booking must not count as a booked venue';
 end if;
 if (select status from public.events where event_id=99105) <> 'planning' then
  raise exception '[SG2-91:shortfall-not-ready] [SG2-91:AC1] [FAILURE] Equipment with a shortfall and no reservation must keep the event in Planning';
 end if;
 if (select status from public.events where event_id=99106) <> 'planning' then
  raise exception '[SG2-91:recheck-not-ready] [SG2-91:AC1] [FAILURE] A venue flagged for recheck by a planning edit must keep the event in Planning';
 end if;
 if (select status from public.events where event_id=99114) <> 'preparation'
   or exists(select 1 from public.event_audit_logs where event_id in (99103,99104,99105,99106,99114)) then
  raise exception '[SG2-91:other-statuses-untouched] [SG2-91:AC1] [BOUNDARY] Events that do not move must keep their status and history unchanged';
 end if;
end $$;

-- AC1: two venue approvals landing in one statement make exactly
-- one move and one history row.
do $$
declare first_booking bigint; second_booking bigint;
begin
 insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
  (99102,99107,'2031-12-07T09:00Z','2031-12-07T17:00Z','confirmed') returning booking_id into first_booking;
 insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
  (99102,99107,'2031-12-08T09:00Z','2031-12-08T17:00Z','confirmed') returning booking_id into second_booking;
 insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status,venue_booking_id) values
  (99107,99102,'2031-12-07T09:00Z','2031-12-07T17:00Z','pending',first_booking),
  (99107,99102,'2031-12-08T09:00Z','2031-12-08T17:00Z','pending',second_booking);
 if (select status from public.events where event_id=99107) <> 'planning' then
  raise exception '[SG2-91:pending-not-ready] [SG2-91:AC1] [FAILURE] Pending venue requests must keep the event in Planning';
 end if;
 update public.venue_booking_requests set status='approved' where event_id=99107;
 if (select status from public.events where event_id=99107) <> 'awaiting_safety_check'
   or (select count(*) from public.event_audit_logs where event_id=99107 and field_name='status') <> 1 then
  raise exception '[SG2-91:simultaneous-completion-moves-once] [SG2-91:AC1] [CONFLICT] Arrangements completed together must move the event once with one history row';
 end if;
end $$;

-- AC1: what the Safety Officer reviews changes while the event
-- waits. Details shown by the review bump the revision; internal notes do not.
do $$
declare revision bigint; since timestamptz;
begin
 select safety_check_revision,awaiting_safety_check_since into revision,since from public.events where event_id=99113;
 update public.events set planning_notes='Called the organiser' where event_id=99113;
 if (select safety_check_revision from public.events where event_id=99113) <> revision then
  raise exception '[SG2-91:unreviewed-edit-keeps-revision] [SG2-91:AC3] [BOUNDARY] An edit the review does not show must not change the revision';
 end if;
 update public.events set accessibility_needs='Hearing loop and wheelchair seating' where event_id=99113;
 if (select safety_check_revision from public.events where event_id=99113) <> revision+1
   or (select status::text||'|'||awaiting_safety_check_since::text from public.events where event_id=99113)
   is distinct from 'awaiting_safety_check|'||since::text then
  raise exception '[SG2-91:reviewed-edit-bumps-revision] [SG2-91:AC3] [CONFLICT] A reviewed detail changed while awaiting must bump the revision and keep the event and its wait';
 end if;
 select safety_check_revision into revision from public.events where event_id=99101;
 update public.equipment_requests set placement_position='Stage right' where event_id=99101;
 if (select status from public.events where event_id=99101) <> 'awaiting_safety_check'
   or (select safety_check_revision from public.events where event_id=99101) <> revision+1 then
  raise exception '[SG2-91:arrangement-edit-bumps-revision] [SG2-91:AC3] [CONFLICT] A placement moved while awaiting must bump the revision without leaving the list';
 end if;
end $$;

-- AC1: while awaiting, the coordinator can still add equipment.
-- The new request sends the event back to Planning in the same call, and the
-- event returns once the request is reserved.
select set_config('sg2_91.revision',(select safety_check_revision from public.events where event_id=99113)::text,true);
set local role authenticated;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000002',true);
do $$
declare result jsonb;
begin
 result := public.manage_equipment_requirements('create',99113,null,null,'{"equipment_id":99101,"quantity":1}');
 if result->>'outcome' <> 'ok' or result#>>'{event,status}' <> 'planning' or (result->>'can_request')::boolean is not true then
  raise exception '[SG2-91:awaiting-event-takes-equipment] [SG2-91:AC1] [CONFLICT] A coordinator adding equipment to an awaiting event must succeed and report it back in Planning: %',result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text||'|'||coalesce(awaiting_safety_check_since::text,'none') from public.events where event_id=99113)
   is distinct from 'planning|none'
   or (select safety_check_revision from public.events where event_id=99113) <> current_setting('sg2_91.revision')::bigint+1
   or (select actor_id::text||'|'||old_value||'|'||new_value from public.event_audit_logs
     where event_id=99113 and field_name='status' order by log_id desc limit 1)
   is distinct from 'd9100000-0000-4000-8000-000000000002|awaiting_safety_check|planning' then
  raise exception '[SG2-91:added-request-returns-to-planning] [SG2-91:AC1] [CONFLICT] The added request must return the event to Planning, clear the wait, bump the revision and record the coordinator';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000004',true);
do $$
declare request bigint; result jsonb;
begin
 result := public.manage_equipment_requirements('read',99113);
 request := (result#>>'{requests,0,request_id}')::bigint;
 result := public.manage_equipment_requirements('arrange',99113,request,(result#>>'{requests,0,version}')::bigint,
  '{"shortfall":0,"placement_venue_id":99102,"placement_position":"Back wall"}');
 result := public.manage_equipment_reservations('reserve',99113,request,(result#>>'{requests,0,version}')::bigint,
  '2031-11-14T09:00Z','2031-11-14T17:00Z');
 if result->>'outcome' <> 'ok'
   or public.manage_equipment_requirements('read',99113)#>>'{event,status}' <> 'awaiting_safety_check' then
  raise exception '[SG2-91:rearranged-event-returns] [SG2-91:AC1] [NORMAL] Once the added equipment is reserved the event must await the check again: %',result;
 end if;
end $$;

-- AC1: Venue Staff can still hold another venue for an awaiting
-- event; the hold's pending request sends it back, and releasing the hold
-- brings it straight back.
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000003',true);
do $$
declare hold jsonb;
begin
 hold := public.create_venue_hold(99109,99101,'2031-12-20T09:00Z','2031-12-20T17:00Z',clock_timestamp()+interval '5 days');
 if hold->>'outcome' <> 'created' then
  raise exception '[SG2-91:awaiting-event-takes-hold] [SG2-91:AC1] [CONFLICT] Venue Staff must be able to hold a venue for an awaiting event: %',hold;
 end if;
 perform set_config('sg2_91.hold',hold#>>'{hold,hold_id}',true);
end $$;
reset role;
do $$
begin
 if (select status from public.events where event_id=99109) <> 'planning' then
  raise exception '[SG2-91:hold-returns-to-planning] [SG2-91:AC1] [CONFLICT] The hold''s pending request must return the event to Planning';
 end if;
end $$;
set local role authenticated;
do $$
declare released jsonb;
begin
 released := public.change_venue_hold(current_setting('sg2_91.hold')::bigint,'release');
 if released->>'outcome' <> 'updated' then
  raise exception '[SG2-91:hold-release-fixture] [SG2-91:AC1] [CONFLICT] Venue Staff must be able to release the hold: %',released;
 end if;
end $$;
reset role;
do $$
begin
 if (select status from public.events where event_id=99109) <> 'awaiting_safety_check' then
  raise exception '[SG2-91:released-hold-returns] [SG2-91:AC1] [CONFLICT] Releasing that hold must put the event back in the list';
 end if;
end $$;

-- AC1: a booking of an awaiting event released by Venue Staff, or
-- made unavailable, takes the event off the list.
select set_config('sg2_91.booking',
 (select venue_booking_id from public.venue_booking_requests where event_id=99109 and status='approved')::text,true);
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.release_venue_booking(current_setting('sg2_91.booking')::bigint,'Ceiling repairs');
 if result->>'outcome' <> 'released' then
  raise exception '[SG2-91:booking-release-fixture] [SG2-91:AC1] [CONFLICT] Venue Staff must be able to release the booking: %',result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status from public.events where event_id=99109) <> 'planning'
   or (select awaiting_safety_check_since from public.events where event_id=99109) is not null then
  raise exception '[SG2-91:released-booking-returns-to-planning] [SG2-91:AC1] [CONFLICT] Releasing an awaiting event''s booking must return it to Planning and clear the wait';
 end if;
end $$;
insert into public.venue_unavailability(venue_id,starts_at,ends_at,category,reason)
 values (99102,'2031-12-07T00:00Z','2031-12-08T00:00Z','equipment_failure','Sprinklers under repair');
do $$
begin
 if (select status from public.events where event_id=99107) <> 'planning' then
  raise exception '[SG2-91:disrupted-booking-returns-to-planning] [SG2-91:AC1] [CONFLICT] A booked venue made unavailable must return an awaiting event to Planning';
 end if;
end $$;

-- AC1 with SG2-66: any outstanding recheck, registration included, keeps a
-- ready event in Planning; settling the last one moves it into the check, and
-- accepting a change with affected arrangements takes it back out.
-- SG2-66 calls these with the service role, so there is no caller.
select set_config('request.jwt.claim.sub','',true);
update public.events set arrangements_recheck_needed=true,outstanding_arrangements='["registration_recheck"]' where event_id=99112;
select pg_temp.book(99112,99103,12);
do $$
declare result jsonb;
begin
 if (select status from public.events where event_id=99112) <> 'planning' then
  raise exception '[SG2-91:any-recheck-not-ready] [SG2-91:AC1] [FAILURE] An outstanding registration recheck must keep the event in Planning until it is settled';
 end if;
 result := public.settle_arrangement_recheck(99112,'d9100000-0000-4000-8000-000000000002','registration_recheck');
 if result->>'outcome' <> 'ok' or (select status from public.events where event_id=99112) <> 'awaiting_safety_check'
   or (select actor_id::text||'|'||old_value||'|'||new_value from public.event_audit_logs
     where event_id=99112 and field_name='status' order by log_id desc limit 1)
   is distinct from 'd9100000-0000-4000-8000-000000000002|planning|awaiting_safety_check' then
  raise exception '[SG2-91:settled-recheck-awaits] [SG2-91:AC1] [NORMAL] Settling the last recheck of a ready event must move it to Awaiting Safety Check: %',result;
 end if;
 perform set_config('sg2_91.revision',(select safety_check_revision from public.events where event_id=99112)::text,true);
 result := public.apply_accepted_event_change(99112,'d9100000-0000-4000-8000-000000000002','awaiting_safety_check',
  'CR-1','{"expected_attendance":150}','["venue_recheck"]');
 if result->>'status' <> 'planning'
   or (select awaiting_safety_check_since from public.events where event_id=99112) is not null
   or (select safety_check_revision from public.events where event_id=99112) <= current_setting('sg2_91.revision')::bigint
   or (select count(*) from public.event_audit_logs where event_id=99112 and field_name='status'
     and old_value='awaiting_safety_check') <> 1 then
  raise exception '[SG2-91:accepted-change-leaves-check] [SG2-91:AC1] [CONFLICT] An accepted change with affected arrangements must return an awaiting event to Planning once, clear its wait and change its revision: %',result;
 end if;
end $$;

-- AC3: expected crowd movement takes up to 5000 characters.
do $$
begin
 update public.events set expected_crowd_movement=repeat('x',5000) where event_id=99112;
 begin
  update public.events set expected_crowd_movement=repeat('x',5001) where event_id=99112;
  raise exception '[SG2-91:crowd-movement-limit] [SG2-91:AC3] [BOUNDARY] Expected crowd movement over 5000 characters must be refused';
 exception when check_violation then null;
 end;
end $$;

-- AC2/AC3: the Safety Officer sees every awaiting event, oldest wait
-- first, with what the review needs; no other event is listed.
set local role authenticated;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000007',true);
do $$
declare queue jsonb; item jsonb;
begin
 queue := public.safety_check_queue();
 if (select array_agg((value->>'event_id')::integer order by ordinality) from jsonb_array_elements(queue) with ordinality)
   is distinct from array[99101,99113]
   or (queue->0->>'awaiting_since')::timestamptz > (queue->1->>'awaiting_since')::timestamptz then
  raise exception '[SG2-91:queue-lists-awaiting-oldest-first] [SG2-91:AC2] [NORMAL] The list must hold exactly the awaiting events, oldest wait first: %',queue;
 end if;
 item := queue->0;
 if item - 'awaiting_since' - 'proposed_date' - 'venues' - 'equipment' - 'safety_check_revision' is distinct from jsonb_build_object(
     'event_id',99101,'name','Safety event 1','organisation',null,'expected_attendance',101,
     'accessibility_needs','Wheelchair seating for 1','expected_crowd_movement','Enter by the east doors, leave by the west doors')
   or (item->>'safety_check_revision')::bigint <> (select safety_check_revision from public.events where event_id=99101) then
  raise exception '[SG2-91:queue-event-details] [SG2-91:AC3] [NORMAL] Each event must show attendance, accessibility needs, crowd movement and its revision: %',item;
 end if;
 if jsonb_array_length(item->'venues') <> 1
   or (item->'venues'->0) - 'request_id' - 'starts_at' - 'ends_at' is distinct from jsonb_build_object(
     'venue_id',99101,'venue_name','Safety hall','location','Level 1','capacity',300,'layout','theatre',
     'accessibility_features','Step-free entrance','emergency_access','Two exits onto the east concourse',
     'known_restrictions','No open flames') then
  raise exception '[SG2-91:queue-venue-details] [SG2-91:AC3] [NORMAL] Each venue must show capacity, layout, emergency access and known restrictions: %',item->'venues';
 end if;
 if jsonb_array_length(item->'equipment') <> 1
   or (item->'equipment'->0) - 'request_id' is distinct from jsonb_build_object(
     'equipment_name','Safety speakers','quantity',2,'placement_venue_name','Safety hall',
     'placement_position','Stage right','arrangement_notes','Cable ramps') then
  raise exception '[SG2-91:queue-equipment-details] [SG2-91:AC3] [NORMAL] Each piece of equipment must show where it will be placed: %',item->'equipment';
 end if;
 item := queue->1;
 if (item->'venues'->0)->>'emergency_access' is not null or (item->'venues'->0)->>'known_restrictions' is not null
   or (item->'venues'->0)->>'layout' is not null then
  raise exception '[SG2-91:queue-unrecorded-details-null] [SG2-91:AC3] [BOUNDARY] Details a venue never recorded must be listed as null, not invented: %',item->'venues';
 end if;
end $$;

-- AC2: with nothing awaiting, the list is empty, not null.
reset role;
savepoint empty_list;
update public.events set status='planning' where status='awaiting_safety_check';
set local role authenticated;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000007',true);
do $$
begin
 if public.safety_check_queue() is distinct from '[]'::jsonb then
  raise exception '[SG2-91:queue-empty-list] [SG2-91:AC2] [BOUNDARY] An empty list must be returned as []';
 end if;
end $$;
reset role;
rollback to savepoint empty_list;

-- AC4: every other role, a caller without a role, and an anonymous
-- caller are refused; nobody calls the internal functions directly.
set local role authenticated;
do $$
declare caller text; refused integer := 0;
begin
 foreach caller in array array['d9100000-0000-4000-8000-000000000001','d9100000-0000-4000-8000-000000000002',
   'd9100000-0000-4000-8000-000000000003','d9100000-0000-4000-8000-000000000004','d9100000-0000-4000-8000-000000000005',
   'd9100000-0000-4000-8000-000000000006','d9100000-0000-4000-8000-000000000008',''] loop
  perform set_config('request.jwt.claim.sub',caller,true);
  begin
   perform public.safety_check_queue();
  exception when insufficient_privilege then refused := refused + 1;
  end;
 end loop;
 if refused <> 8 then
  raise exception '[SG2-91:queue-safety-officer-only] [SG2-91:AC4] [FAILURE] Only a Safety Officer may read the list; % of 8 other callers were refused',refused;
 end if;
end $$;
select set_config('request.jwt.claim.sub','d9100000-0000-4000-8000-000000000007',true);
do $$
begin
 begin
  perform public.refresh_safety_check_status(99112);
  raise exception '[SG2-91:refresh-not-callable] [SG2-91:AC4] [FAILURE] A client must not be able to move an event directly';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.events set status='awaiting_safety_check' where event_id=99112;
  if found then
   raise exception '[SG2-91:status-not-writable] [SG2-91:AC4] [FAILURE] A Safety Officer must not be able to set an event''s status';
  end if;
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

rollback;
