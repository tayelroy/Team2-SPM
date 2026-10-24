-- SG2-93: a Request Changes safety decision marks the named arrangements
-- outstanding, sends their bookings and equipment back to Venue Staff and
-- Technical Support to be confirmed again, and the event returns to Awaiting
-- Safety Check once they are. Isolated fixture changes are rolled back.
begin;
insert into auth.users(id)
 select ('d9300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
insert into public.users(user_id,name,role_id) values
 ('d9300000-0000-4000-8000-000000000001','Changes organiser',1),
 ('d9300000-0000-4000-8000-000000000002','Changes coordinator',2),
 ('d9300000-0000-4000-8000-000000000003','Changes venue staff',3),
 ('d9300000-0000-4000-8000-000000000004','Changes support',4),
 ('d9300000-0000-4000-8000-000000000005','Changes officer',7),
 ('d9300000-0000-4000-8000-000000000006','Other coordinator',2);
insert into public.account_roles(user_id,role) values
 ('d9300000-0000-4000-8000-000000000001','event_organiser'),
 ('d9300000-0000-4000-8000-000000000002','event_coordinator'),
 ('d9300000-0000-4000-8000-000000000003','venue_staff'),
 ('d9300000-0000-4000-8000-000000000004','technical_support_staff'),
 ('d9300000-0000-4000-8000-000000000005','safety_officer'),
 ('d9300000-0000-4000-8000-000000000006','event_coordinator');
insert into public.venues(venue_id,name,location,capacity) values (99301,'Changes hall','Level 1',300);
insert into public.equipment(equipment_id,name,quantity_total) values (99301,'Changes speakers',20);
insert into public.events(event_id,organiser_id,coordinator_id,name,status,proposed_date,expected_attendance)
 select 99300+n,'d9300000-0000-4000-8000-000000000001','d9300000-0000-4000-8000-000000000002',
  'Changes event '||n,'planning','2031-11-01T10:00Z',120
 from generate_series(1,6) n;

-- Everything SG2-91 needs, written in the order that leaves the event
-- awaiting its check: equipment placed and reserved first (no venue yet, so
-- not ready), then the approved venue request and its confirmed booking.
create function pg_temp.ready(p_event integer, p_equipment boolean) returns void language plpgsql as $$
declare booking bigint; request bigint;
begin
 if p_equipment then
  insert into public.equipment_requests(event_id,equipment_id,quantity,status,shortfall,placement_venue_id,placement_position,starts_at,ends_at)
   values(p_event,99301,4,'approved',0,99301,'Stage left','2031-11-01T09:00Z'::timestamptz+(p_event-99300)*interval '1 day',
    '2031-11-01T13:00Z'::timestamptz+(p_event-99300)*interval '1 day') returning request_id into request;
  insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,request_id,reserved_at,starts_at,ends_at)
   values(p_event,99301,4,request,'2031-10-01T00:00Z','2031-11-01T09:00Z'::timestamptz+(p_event-99300)*interval '1 day',
    '2031-11-01T13:00Z'::timestamptz+(p_event-99300)*interval '1 day');
 end if;
 insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
  values(99301,p_event,'2031-11-01T09:00Z'::timestamptz+(p_event-99300)*interval '1 day',
   '2031-11-01T13:00Z'::timestamptz+(p_event-99300)*interval '1 day','confirmed') returning booking_id into booking;
 insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status,venue_booking_id)
  values(p_event,99301,'2031-11-01T09:00Z'::timestamptz+(p_event-99300)*interval '1 day',
   '2031-11-01T13:00Z'::timestamptz+(p_event-99300)*interval '1 day','approved',booking);
end $$;
create function pg_temp.rev(p_event integer) returns bigint language sql stable
 as $$ select safety_check_revision from public.events where event_id = p_event $$;
create function pg_temp.status(p_event integer) returns text language sql stable
 as $$ select status::text from public.events where event_id = p_event $$;
create function pg_temp.keys(p_event integer) returns jsonb language sql stable
 as $$ select outstanding_arrangements from public.events where event_id = p_event $$;
create function pg_temp.open_flags(p_event integer, p_arrangement text) returns bigint language sql stable
 as $$ select count(*) from public.safety_rereviews where event_id = p_event and arrangement = p_arrangement and resolved_at is null $$;
create function pg_temp.flag(p_event integer, p_arrangement text) returns bigint language sql stable
 as $$ select max(review_id) from public.safety_rereviews where event_id = p_event and arrangement = p_arrangement $$;
grant execute on function pg_temp.rev(integer) to service_role;
select pg_temp.ready(99301, true), pg_temp.ready(99302, true), pg_temp.ready(99303, true),
  pg_temp.ready(99304, false), pg_temp.ready(99305, true);
do $$
begin
 if (select count(*) from public.events where event_id between 99301 and 99305 and status = 'awaiting_safety_check') <> 5 then
  raise exception '[SG2-93:fixture-awaiting] [SG2-93:AC4] [NORMAL] Every fixture event must be awaiting its safety check';
 end if;
end $$;

-- AC1/AC3: Request Changes naming Venue and Other on an event with venue and
-- equipment marks exactly those outstanding and flags only the venue.
set local role service_role;
select public.record_safety_decision(99301,'d9300000-0000-4000-8000-000000000005','request_changes',
  'Move the stage away from the fire exit','["venue","other"]',pg_temp.rev(99301));
reset role;
do $$
begin
 if pg_temp.status(99301) is distinct from 'planning'
   or pg_temp.keys(99301) is distinct from '["safety_venue_recheck","safety_other_recheck"]'::jsonb
   or (select arrangements_recheck_needed from public.events where event_id=99301) is not true then
  raise exception '[SG2-93:named-outstanding] [SG2-93:AC1] [NORMAL] The named arrangements must be outstanding, in the order named, on an event back in Planning: %', pg_temp.keys(99301);
 end if;
 if pg_temp.open_flags(99301,'venue') <> 1 or pg_temp.open_flags(99301,'equipment') <> 0 then
  raise exception '[SG2-93:venue-flagged-only] [SG2-93:AC2] [SG2-93:AC3] [NORMAL] The venue booking must be flagged for Venue Staff and the equipment left alone';
 end if;
 if (select status||placement_position||shortfall from public.equipment_requests where event_id=99301) is distinct from 'approvedStage left0'
   or not exists(select 1 from public.equipment_reservations where event_id=99301)
   or (select status from public.venue_bookings where event_id=99301) <> 'confirmed'
   or (select status from public.venue_booking_requests where event_id=99301) <> 'approved' then
  raise exception '[SG2-93:arrangements-kept] [SG2-93:AC3] [BOUNDARY] Requesting changes must not release or reopen any booking, request or reservation';
 end if;
end $$;

-- AC1: the outstanding keys keep the event out of the check, even when an
-- unrelated arrangement write runs SG2-91's refresh.
update public.equipment_requests set arrangement_notes = 'Cable ramps' where event_id = 99301;
do $$
begin
 if pg_temp.status(99301) is distinct from 'planning' then
  raise exception '[SG2-93:stays-in-planning] [SG2-93:AC1] [CONFLICT] An unrelated arrangement change must not return the event to the check while changes are outstanding';
 end if;
end $$;

-- AC2: Venue Staff see the flag with the Safety Officer's reason; Technical
-- Support see nothing for this event.
set local role service_role;
do $$
declare queue jsonb := public.safety_rereview_queue('venue');
declare item jsonb;
begin
 select value into item from jsonb_array_elements(queue) where (value->>'event_id')::int = 99301;
 if item is null or item->>'reason' is distinct from 'Move the stage away from the fire exit'
   or item->>'label' is distinct from 'Changes hall (2 Nov 2031 17:00 – 21:00 SGT)'
   or item->>'decided_by_name' is distinct from 'Changes officer'
   or item->>'coordinator_name' is distinct from 'Changes coordinator' then
  raise exception '[SG2-93:venue-queue] [SG2-93:AC2] [NORMAL] Venue Staff must see the flagged booking with its reason, decider and coordinator: %', item;
 end if;
 if exists(select 1 from jsonb_array_elements(public.safety_rereview_queue('equipment')) where (value->>'event_id')::int = 99301) then
  raise exception '[SG2-93:equipment-queue-empty] [SG2-93:AC3] [BOUNDARY] Technical Support must see nothing for an event whose equipment was not named';
 end if;
end $$;

-- AC4: the coordinator cannot mark the venue change done while Venue Staff
-- have not confirmed the booking again, and the refusal says what is waiting.
do $$
declare result jsonb;
begin
 result := public.settle_arrangement_recheck(99301,'d9300000-0000-4000-8000-000000000002','safety_venue_recheck');
 if result is distinct from '{"outcome":"flagged","waiting":[{"arrangement":"venue","label":"Changes hall (2 Nov 2031 17:00 – 21:00 SGT)"}]}'::jsonb then
  raise exception '[SG2-93:settle-waits-for-staff] [SG2-93:AC4] [CONFLICT] A venue change must stay outstanding until Venue Staff confirm again: %', result;
 end if;
end $$;

-- AC2: only the staff role the flag belongs to confirms it.
do $$
begin
 if public.confirm_safety_rereview(pg_temp.flag(99301,'venue'),'d9300000-0000-4000-8000-000000000004','technical_support_staff') is distinct from '{"outcome":"forbidden"}'::jsonb
   or public.confirm_safety_rereview(pg_temp.flag(99301,'venue'),'d9300000-0000-4000-8000-000000000002','event_coordinator') is distinct from '{"outcome":"forbidden"}'::jsonb
   or public.confirm_safety_rereview(pg_temp.flag(99301,'venue'),null,'venue_staff') is distinct from '{"outcome":"forbidden"}'::jsonb
   or public.confirm_safety_rereview(null,'d9300000-0000-4000-8000-000000000003','venue_staff') is distinct from '{"outcome":"forbidden"}'::jsonb
   or public.confirm_safety_rereview(pg_temp.flag(99301,'venue'),'d9300000-0000-4000-8000-000000000003','technical_support_staff') is distinct from '{"outcome":"forbidden"}'::jsonb
   or public.confirm_safety_rereview(9007199254740991,'d9300000-0000-4000-8000-000000000003','venue_staff') is distinct from '{"outcome":"missing"}'::jsonb then
  raise exception '[SG2-93:confirm-wrong-role] [SG2-93:AC2] [FAILURE] Technical Support, the coordinator, no actor, Venue Staff acting as another role or an unknown flag must not confirm a venue booking again';
 end if;
end $$;
reset role;
do $$
begin
 if pg_temp.open_flags(99301,'venue') <> 1 or exists(select 1 from public.event_audit_logs where event_id=99301 and field_name='safety_rereview') then
  raise exception '[SG2-93:refused-confirm-no-writes] [SG2-93:AC2] [FAILURE] A refused confirmation must change nothing';
 end if;
end $$;

-- AC2/AC4: Venue Staff confirm the booking again; the venue key settles on its
-- own, the history says who confirmed what, and Other is still outstanding.
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.confirm_safety_rereview(pg_temp.flag(99301,'venue'),'d9300000-0000-4000-8000-000000000003','venue_staff');
 if result->>'outcome' is distinct from 'ok' or result->>'status' is distinct from 'planning'
   or result->'outstanding_arrangements' is distinct from '["safety_other_recheck"]'::jsonb then
  raise exception '[SG2-93:venue-confirmed] [SG2-93:AC4] [NORMAL] Confirming the last venue flag must settle the venue change and leave Other outstanding: %', result;
 end if;
 if public.confirm_safety_rereview(pg_temp.flag(99301,'venue'),'d9300000-0000-4000-8000-000000000003','venue_staff')
     is distinct from '{"outcome":"closed","resolution":"confirmed"}'::jsonb then
  raise exception '[SG2-93:confirm-twice] [SG2-93:AC2] [CONFLICT] A flag confirmed already must be reported closed, not confirmed twice';
 end if;
end $$;
reset role;
do $$
begin
 if (select array_agg(field_name||': '||new_value order by log_id) from public.event_audit_logs
       where event_id=99301 and field_name in ('safety_rereview','arrangement_recheck'))
     is distinct from array['safety_rereview: Venue Staff confirmed Changes hall (2 Nov 2031 17:00 – 21:00 SGT) again',
       'arrangement_recheck: safety_venue_recheck settled']
   or (select resolution||resolved_by::text from public.safety_rereviews where review_id=pg_temp.flag(99301,'venue'))
     is distinct from 'confirmedd9300000-0000-4000-8000-000000000003' then
  raise exception '[SG2-93:confirm-history] [SG2-93:AC5] [NORMAL] The confirmation and the settled change must be in the event history with who made them';
 end if;
end $$;

-- AC4: the coordinator marks Other done, and the event is back on the
-- Safety Officer's list with nothing outstanding.
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.settle_arrangement_recheck(99301,'d9300000-0000-4000-8000-000000000006','safety_other_recheck');
 if result is distinct from '{"outcome":"stale"}'::jsonb then
  raise exception '[SG2-93:other-coordinator-refused] [SG2-93:AC4] [FAILURE] Only the assigned coordinator marks a safety change done: %', result;
 end if;
 result := public.settle_arrangement_recheck(99301,'d9300000-0000-4000-8000-000000000002','safety_other_recheck');
 if result is distinct from '{"outcome":"ok","arrangements_recheck_needed":false,"outstanding_arrangements":[]}'::jsonb then
  raise exception '[SG2-93:other-settled] [SG2-93:AC4] [NORMAL] Marking Other done must clear the last outstanding change: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if pg_temp.status(99301) is distinct from 'awaiting_safety_check'
   or (select new_value from public.event_audit_logs where event_id=99301 and field_name='status' order by log_id desc limit 1)
     is distinct from 'awaiting_safety_check' then
  raise exception '[SG2-93:back-to-check] [SG2-93:AC4] [NORMAL] With every change confirmed the event must return to Awaiting Safety Check, recorded in its history';
 end if;
end $$;

-- AC4: Equipment named alone returns the event to the check by itself as
-- soon as Technical Support confirm the last flagged request again.
set local role service_role;
select public.record_safety_decision(99302,'d9300000-0000-4000-8000-000000000005','request_changes',
  'Speakers block the aisle','["equipment"]',pg_temp.rev(99302));
do $$
declare result jsonb;
begin
 if pg_temp.keys(99302) is distinct from '["safety_equipment_recheck"]'::jsonb
   or pg_temp.open_flags(99302,'equipment') <> 1 or pg_temp.open_flags(99302,'venue') <> 0 then
  raise exception '[SG2-93:equipment-flagged] [SG2-93:AC1] [SG2-93:AC2] [NORMAL] Naming equipment must flag the equipment request and only that';
 end if;
 if public.confirm_safety_rereview(pg_temp.flag(99302,'equipment'),'d9300000-0000-4000-8000-000000000003','venue_staff') is distinct from '{"outcome":"forbidden"}'::jsonb then
  raise exception '[SG2-93:equipment-needs-support] [SG2-93:AC2] [FAILURE] Venue Staff must not confirm equipment again';
 end if;
 result := public.confirm_safety_rereview(pg_temp.flag(99302,'equipment'),'d9300000-0000-4000-8000-000000000004','technical_support_staff');
 if result->>'status' is distinct from 'awaiting_safety_check' or result->'outstanding_arrangements' <> '[]'::jsonb then
  raise exception '[SG2-93:equipment-confirmed-returns] [SG2-93:AC4] [NORMAL] Confirming the last equipment flag must return the event to the check: %', result;
 end if;
end $$;
reset role;

-- AC4: withdrawing a flagged request also resolves its flag; nothing is left
-- waiting on staff for a request the event no longer has.
set local role service_role;
select public.record_safety_decision(99303,'d9300000-0000-4000-8000-000000000005','request_changes',
  'Drop the speakers','["equipment"]',pg_temp.rev(99303));
reset role;
update public.equipment_requests set status = 'cancelled' where event_id = 99303;
do $$
begin
 if (select resolution from public.safety_rereviews where review_id=pg_temp.flag(99303,'equipment')) is distinct from 'withdrawn'
   or pg_temp.keys(99303) is distinct from '[]'::jsonb
   or pg_temp.status(99303) is distinct from 'awaiting_safety_check' then
  raise exception '[SG2-93:withdrawn-closes-flag] [SG2-93:AC4] [BOUNDARY] A cancelled flagged request must close its flag and settle the change: % %', pg_temp.keys(99303), pg_temp.status(99303);
 end if;
end $$;

-- AC1/AC4: equipment named on an event that has none flags nothing; the
-- coordinator marks it done once it is arranged.
set local role service_role;
select public.record_safety_decision(99304,'d9300000-0000-4000-8000-000000000005','request_changes',
  'Add a public address system','["equipment"]',pg_temp.rev(99304));
do $$
declare result jsonb;
begin
 if pg_temp.keys(99304) is distinct from '["safety_equipment_recheck"]'::jsonb
   or exists(select 1 from public.safety_rereviews where event_id=99304) then
  raise exception '[SG2-93:nothing-to-flag] [SG2-93:AC1] [BOUNDARY] Equipment named on an event with none must be outstanding with nothing flagged';
 end if;
 result := public.settle_arrangement_recheck(99304,'d9300000-0000-4000-8000-000000000002','safety_equipment_recheck');
 if result->>'outcome' is distinct from 'ok' or pg_temp.status(99304) is distinct from 'awaiting_safety_check' then
  raise exception '[SG2-93:unflagged-settled] [SG2-93:AC4] [BOUNDARY] With nothing flagged the coordinator must be able to mark it done: %', result;
 end if;
end $$;

-- AC5: a second Request Changes on the same booking flags it again, and
-- both decisions and both flags are kept.
select public.record_safety_decision(99301,'d9300000-0000-4000-8000-000000000005','request_changes',
  'Widen the aisles','["venue"]',pg_temp.rev(99301));
do $$
begin
 if (select count(*) from public.event_safety_decisions where event_id=99301 and decision='request_changes') <> 2
   or (select count(*) from public.safety_rereviews where event_id=99301) <> 2
   or pg_temp.open_flags(99301,'venue') <> 1 then
  raise exception '[SG2-93:history-kept] [SG2-93:AC5] [NORMAL] Every decision and every flag must be kept, with only the newest open';
 end if;
 if (select jsonb_agg(value->>'resolution') from jsonb_array_elements(public.event_safety_rereviews(99301)))
     is distinct from '[null,"confirmed"]'::jsonb
   or public.event_safety_rereviews(99301)->1->>'resolved_by_name' is distinct from 'Changes venue staff' then
  raise exception '[SG2-93:event-rereviews] [SG2-93:AC5] [NORMAL] The event''s flags must read newest first with how each was resolved: %', public.event_safety_rereviews(99301);
 end if;
end $$;

-- AC3: Approve and Reject flag nothing and mark nothing outstanding.
select public.record_safety_decision(99305,'d9300000-0000-4000-8000-000000000005','approve',null,null,pg_temp.rev(99305));
reset role;
do $$
begin
 if exists(select 1 from public.safety_rereviews where event_id=99305) or pg_temp.keys(99305) is distinct from '[]'::jsonb then
  raise exception '[SG2-93:approve-flags-nothing] [SG2-93:AC3] [BOUNDARY] An approval must flag nothing and leave nothing outstanding';
 end if;
end $$;

-- AC2: flags, the queue and confirmation are server-only.
do $$
declare client text;
begin
 foreach client in array array['anon','authenticated'] loop
  execute format('set local role %I', client);
  begin
   perform 1 from public.safety_rereviews;
   raise exception '[SG2-93:flags-unreadable] [SG2-93:AC2] [FAILURE] % must not read safety flags', client;
  exception when insufficient_privilege then null; end;
  begin
   perform public.confirm_safety_rereview(1,'d9300000-0000-4000-8000-000000000003','venue_staff');
   raise exception '[SG2-93:confirm-server-only] [SG2-93:AC2] [FAILURE] % must not confirm a flag directly', client;
  exception when insufficient_privilege then null; end;
  begin
   perform public.safety_rereview_queue('venue');
   raise exception '[SG2-93:queue-server-only] [SG2-93:AC2] [FAILURE] % must not read the staff queue directly', client;
  exception when insufficient_privilege then null; end;
  begin
   perform public.event_safety_rereviews(99301);
   raise exception '[SG2-93:event-flags-server-only] [SG2-93:AC5] [FAILURE] % must not read an event''s flags directly', client;
  exception when insufficient_privilege then null; end;
  begin
   perform private.settle_safety_rechecks(99301, null);
   raise exception '[SG2-93:settle-helper-closed] [SG2-93:AC4] [FAILURE] % must not settle safety changes directly', client;
  exception when insufficient_privilege then null; end;
  reset role;
 end loop;
end $$;
do $$
begin
 begin
  insert into public.safety_rereviews(event_id,decision_id,arrangement,venue_request_id,equipment_request_id)
   select 99301,decision_id,'venue',null,null from public.event_safety_decisions where event_id=99301 limit 1;
  raise exception '[SG2-93:flag-needs-request] [SG2-93:AC2] [FAILURE] A flag without its request must break a constraint';
 exception when check_violation then null; end;
 begin
  update public.safety_rereviews set resolution='confirmed', resolved_at=clock_timestamp() where review_id=pg_temp.flag(99301,'venue');
  raise exception '[SG2-93:confirmed-needs-actor] [SG2-93:AC5] [FAILURE] A confirmation without who made it must break a constraint';
 exception when check_violation then null; end;
end $$;
rollback;
