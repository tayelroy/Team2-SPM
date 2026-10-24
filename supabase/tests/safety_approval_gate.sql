-- SG2-94 safety_approval_gate / event_safety_approved / the approval
-- withdrawal in apply_accepted_event_change, with isolated fixture changes
-- rolled back. Confirmation's safety and registration rules (AC5, AC6) are
-- in event_confirmation.sql next to the rest of confirm_event.
begin;
insert into auth.users(id)
 select ('d9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.users(user_id,name,role_id) values
 ('d9400000-0000-4000-8000-000000000001','Gate organiser',1),
 ('d9400000-0000-4000-8000-000000000002','Gate coordinator',2),
 ('d9400000-0000-4000-8000-000000000003','Gate safety officer',2);
insert into public.account_roles(user_id,role) values
 ('d9400000-0000-4000-8000-000000000001','event_organiser'),
 ('d9400000-0000-4000-8000-000000000002','event_coordinator'),
 ('d9400000-0000-4000-8000-000000000003','safety_officer');
insert into public.venues(venue_id,name,capacity) values (99400,'Gate hall',500);
insert into public.events(event_id,organiser_id,coordinator_id,name,status,proposed_date,expected_attendance)
 select 99400+n,'d9400000-0000-4000-8000-000000000001','d9400000-0000-4000-8000-000000000002',
  'Gate event '||n,'planning','2031-11-01T09:00Z'::timestamptz+n*interval '1 day',120
 from generate_series(1,9) n;
update public.events set status='awaiting_safety_check' where event_id in (99402,99403,99404);
update public.events set status='safety_rejected' where event_id=99405;
insert into public.event_safety_decisions(event_id,decision,reason,decided_by) values
 (99405,'reject','Blocked exits','d9400000-0000-4000-8000-000000000003');
-- 99404's only approval predates the wait it is now in.
insert into public.event_safety_decisions(event_id,decision,decided_by,decided_at) values
 (99404,'approve','d9400000-0000-4000-8000-000000000003',clock_timestamp()-interval '1 day');
-- 99406-99409 get every arrangement in place, so SG2-91 moves each into the
-- check by itself; 99410 and 99411 are put straight into Preparation without
-- a current approval, as data from before SG2-94 could be.
insert into public.events(event_id,organiser_id,coordinator_id,name,status,proposed_date,expected_attendance) values
 (99410,'d9400000-0000-4000-8000-000000000001','d9400000-0000-4000-8000-000000000002','Unchecked forum','preparation','2031-12-10T09:00Z',80),
 (99411,'d9400000-0000-4000-8000-000000000001','d9400000-0000-4000-8000-000000000002','Changed forum','preparation','2031-12-11T09:00Z',80);
insert into public.event_safety_decisions(event_id,decision,reason,arrangements,decided_by,decided_at) values
 (99411,'approve',null,'{}','d9400000-0000-4000-8000-000000000003',clock_timestamp()-interval '2 days'),
 (99411,'request_changes','Move the stage','{venue}','d9400000-0000-4000-8000-000000000003',clock_timestamp()-interval '1 day');
do $$
declare n integer; booking bigint;
begin
 foreach n in array array[99406,99407,99408,99409,99410,99411] loop
  insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
   select 99400,n,proposed_date,proposed_date+interval '8 hours','confirmed' from public.events where event_id=n
   returning booking_id into booking;
  insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status,venue_booking_id)
   select n,99400,starts_at,ends_at,'approved',booking from public.venue_bookings where booking_id=booking;
 end loop;
end $$;
create function pg_temp.rev(p_event_id integer) returns bigint language sql stable
  as $$ select safety_check_revision from public.events where event_id = p_event_id $$;

do $$
begin
 if (select array_agg(status::text order by event_id) from public.events where event_id between 99406 and 99409)
   is distinct from array['awaiting_safety_check','awaiting_safety_check','awaiting_safety_check','awaiting_safety_check'] then
  raise exception '[SG2-94:ready-events-enter-check] [SG2-91:AC1] [NORMAL] Events with every arrangement in place must enter the safety check by themselves before any decision';
 end if;
end $$;

-- AC1: without an approval of this check, any move into Preparation is
-- refused in the database, with the reason, and nothing changes.
do $$
declare target integer; message text; detail text; constraint_name text; caught boolean;
begin
 foreach target in array array[99401,99402,99404,99405] loop
  caught := false;
  begin
   update public.events set status='preparation' where event_id=target;
  exception when check_violation then
   get stacked diagnostics message = message_text, detail = pg_exception_detail, constraint_name = constraint_name;
   caught := true;
  end;
  if not caught then
   raise exception '[SG2-94:unapproved-move-refused] [SG2-94:AC1] [FAILURE] Event % must not move to Preparation without an approval of its current check', target;
  end if;
  if message is distinct from 'An event can move to Preparation only once the Safety Officer has approved its safety check.'
    or constraint_name is distinct from 'events_preparation_needs_safety_approval' then
   raise exception '[SG2-94:refusal-reason] [SG2-94:AC1] [NORMAL] The refusal must give its reason: % / %', message, constraint_name;
  end if;
  if target = 99405 and detail is distinct from 'Event 99405 is safety_rejected and its latest safety decision is reject.' then
   raise exception '[SG2-94:refusal-detail] [SG2-94:AC1] [BOUNDARY] The refusal must name the status and latest decision: %', detail;
  end if;
 end loop;
 if (select array_agg(status::text order by event_id) from public.events where event_id in (99401,99402,99404,99405))
   is distinct from array['planning','awaiting_safety_check','awaiting_safety_check','safety_rejected'] then
  raise exception '[SG2-94:refusal-changes-nothing] [SG2-94:AC1] [FAILURE] A refused move must leave every status as it was';
 end if;
end $$;

-- AC1: changes requested, then a rejection, are not approval either; only
-- the latest decision counts, and it must be an Approve.
insert into public.event_safety_decisions(event_id,decision,reason,arrangements,decided_by) values
 (99402,'request_changes','Widen the aisles','{venue}','d9400000-0000-4000-8000-000000000003');
do $$
begin
 begin
  update public.events set status='preparation' where event_id=99402;
  raise exception '[SG2-94:changes-requested-not-approval] [SG2-94:AC1] [CONFLICT] Requested changes must not let the event into Preparation';
 exception when check_violation then null;
 end;
end $$;

-- AC2: an Approve made during this wait lets the event into Preparation.
insert into public.event_safety_decisions(event_id,decision,decided_by) values
 (99403,'approve','d9400000-0000-4000-8000-000000000003');
do $$
begin
 update public.events set status='preparation' where event_id=99403;
 if (select status::text from public.events where event_id=99403) is distinct from 'preparation' then
  raise exception '[SG2-94:approved-move-allowed] [SG2-94:AC2] [BOUNDARY] An Approve of the current check must let the event into Preparation';
 end if;
end $$;

-- AC2: the Safety Officer's Approve is the way in, and the approval then holds.
set local role service_role;
do $$
declare target integer; result jsonb;
begin
 foreach target in array array[99406,99407,99408,99409] loop
  result := public.record_safety_decision(target,'d9400000-0000-4000-8000-000000000003','approve',null,null,pg_temp.rev(target));
  if result->>'status' is distinct from 'preparation' then
   raise exception '[SG2-94:approve-moves-to-preparation] [SG2-94:AC2] [NORMAL] The Safety Officer''s Approve must move event % to Preparation: %', target, result;
  end if;
 end loop;
end $$;
reset role;
do $$
begin
 if not public.event_safety_approved((select e from public.events e where event_id=99406))
   or public.event_safety_approved((select e from public.events e where event_id=99410))
   or public.event_safety_approved((select e from public.events e where event_id=99411)) then
  raise exception '[SG2-94:latest-approve-is-approval] [SG2-94:AC2] [NORMAL] Only an event whose latest decision is Approve holds an approval';
 end if;
end $$;

-- AC5 on the way: 99408 is confirmed on its approval.
set local role authenticated;
select set_config('request.jwt.claim.sub','d9400000-0000-4000-8000-000000000002',true);
do $$
declare result jsonb;
begin
 result := public.confirm_event(99408);
 if result->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-94:approved-confirms] [SG2-94:AC5] [NORMAL] An approved event with its arrangements in place must confirm: %', result;
 end if;
end $$;
reset role;

-- AC3: a significant change accepted after approval withdraws it.
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.apply_accepted_event_change(99407,'d9400000-0000-4000-8000-000000000002','preparation',
  'change request mock-99407-attendance','{"expected_attendance":150}','["venue_recheck"]');
 if result->>'status' is distinct from 'planning' or (result->>'returned_to_planning')::boolean is not true then
  raise exception '[SG2-94:significant-change-withdraws] [SG2-94:AC3] [NORMAL] A significant change after approval must send the event back to Planning: %', result;
 end if;
 -- With no recheck named and every arrangement still in place, the event goes
 -- straight back to the check.
 result := public.apply_accepted_event_change(99408,'d9400000-0000-4000-8000-000000000002','confirmed',
  'change request mock-99408-access','{"accessibility_needs":"Step-free route to the stage"}','[]');
 if result->>'status' is distinct from 'awaiting_safety_check' or (result->>'returned_to_planning')::boolean is not true then
  raise exception '[SG2-94:withdrawn-without-recheck] [SG2-94:AC3] [BOUNDARY] A significant change with nothing to recheck must still withdraw the approval and return the event to the check: %', result;
 end if;
 -- Name, purpose and description are not significant.
 result := public.apply_accepted_event_change(99409,'d9400000-0000-4000-8000-000000000002','preparation',
  'change request mock-99409-name','{"name":"Gate Gala"}','[]');
 if result->>'status' is distinct from 'preparation' or (result->>'returned_to_planning')::boolean is not false then
  raise exception '[SG2-94:minor-change-keeps-approval] [SG2-94:AC3] [BOUNDARY] A change to the name only must keep the approval: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select string_agg(field_name||'|'||coalesce(old_value,'null')||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=99407 and field_name in ('status','safety_approval') and log_id >
       (select max(log_id) from public.event_audit_logs where event_id=99407 and field_name='change_request'))
   is distinct from 'status|preparation|planning'
     ||' ; safety_approval|Approved|Withdrawn: the accepted change request mock-99407-attendance changed what was approved, so the event must pass the safety check again' then
  raise exception '[SG2-94:withdrawal-in-history] [SG2-94:AC3] [NORMAL] The move back and the withdrawn approval must be in the history';
 end if;
 if (select status::text||'|'||coalesce(confirmed_by::text,'null')||'|'||coalesce(confirmed_at::text,'null')
     from public.events where event_id=99408) is distinct from 'awaiting_safety_check|null|null'
   or (select count(*) from public.event_audit_logs where event_id=99408 and field_name='safety_approval') <> 1
   or (select string_agg(old_value||'>'||new_value, ',' order by log_id) from public.event_audit_logs
       where event_id=99408 and field_name='status' and log_id >
         (select max(log_id) from public.event_audit_logs where event_id=99408 and field_name='change_request'))
     is distinct from 'confirmed>planning,planning>awaiting_safety_check' then
  raise exception '[SG2-94:withdrawn-confirmation-cleared] [SG2-94:AC3] [NORMAL] Withdrawing a confirmed event''s approval must clear its confirmation and record both moves';
 end if;
 if exists(select 1 from public.event_audit_logs where event_id=99409 and field_name='safety_approval')
   or not public.event_safety_approved((select e from public.events e where event_id=99409)) then
  raise exception '[SG2-94:minor-change-no-withdrawal] [SG2-94:AC3] [BOUNDARY] A minor change must leave the approval standing and unrecorded';
 end if;
 if (select count(*) from public.event_safety_decisions where event_id in (99407,99408)) <> 2 then
  raise exception '[SG2-94:history-untouched] [SG2-94:AC3] [CONFLICT] Withdrawing an approval must not touch the decision history';
 end if;
end $$;

-- AC3: the withdrawn approval no longer opens Preparation, although it is
-- still the latest decision; the event must be checked again.
do $$
begin
 begin
  update public.events set status='preparation' where event_id=99407;
  raise exception '[SG2-94:withdrawn-approval-not-reused] [SG2-94:AC3] [CONFLICT] A withdrawn approval must not let the event back into Preparation';
 exception when check_violation then null;
 end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d9400000-0000-4000-8000-000000000002',true);
do $$
begin
 if public.confirm_event(99407) is distinct from '{"outcome":"outstanding","outstanding":["venue","safety"]}'::jsonb then
  raise exception '[SG2-94:withdrawn-not-confirmable] [SG2-94:AC3] [SG2-94:AC5] [FAILURE] An event whose approval was withdrawn must list the recheck and the safety check';
 end if;
end $$;
reset role;
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.settle_arrangement_recheck(99407,'d9400000-0000-4000-8000-000000000002','venue_recheck');
 if (select status::text from public.events where event_id=99407) is distinct from 'awaiting_safety_check' then
  raise exception '[SG2-94:rechecked-back-to-check] [SG2-94:AC3] [NORMAL] Settling the recheck must return the event to the safety check: %', result;
 end if;
 result := public.record_safety_decision(99407,'d9400000-0000-4000-8000-000000000003','approve',null,null,pg_temp.rev(99407));
 if result->>'status' is distinct from 'preparation' then
  raise exception '[SG2-94:approved-again] [SG2-94:AC2] [SG2-94:AC3] [NORMAL] A new Approve must let the event into Preparation again: %', result;
 end if;
end $$;
reset role;

-- AC5: in Preparation without a current approval (none on record, or a
-- later Request Changes), confirmation lists the safety check.
set local role authenticated;
select set_config('request.jwt.claim.sub','d9400000-0000-4000-8000-000000000002',true);
do $$
begin
 if public.confirm_event(99410) is distinct from '{"outcome":"outstanding","outstanding":["safety"]}'::jsonb then
  raise exception '[SG2-94:no-decision-not-confirmable] [SG2-94:AC5] [FAILURE] An event with no safety decision must not confirm';
 end if;
 if public.confirm_event(99411) is distinct from '{"outcome":"outstanding","outstanding":["safety"]}'::jsonb then
  raise exception '[SG2-94:latest-not-approve-not-confirmable] [SG2-94:AC5] [CONFLICT] An earlier Approve must not count once a later decision is not Approve';
 end if;
 if public.confirm_event(99407)->>'outcome' is distinct from 'ok' or public.confirm_event(99409)->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-94:approved-again-confirms] [SG2-94:AC5] [NORMAL] Re-approved and still-approved events must confirm';
 end if;
end $$;
reset role;
do $$
begin
 if (select array_agg(status::text order by event_id) from public.events where event_id in (99410,99411))
   is distinct from array['preparation','preparation']
   or exists(select 1 from public.event_audit_logs where event_id in (99410,99411))
   or exists(select 1 from public.notifications where event_id in (99410,99411)) then
  raise exception '[SG2-94:safety-refusal-no-writes] [SG2-94:AC5] [FAILURE] A refusal for the safety check must write nothing';
 end if;
end $$;

-- Only definer functions read the decisions for the gate.
do $$
declare client text;
begin
 foreach client in array array['anon','authenticated'] loop
  execute format('set local role %I', client);
  begin
   perform public.event_safety_approved(null::public.events);
   raise exception '[SG2-94:approval-check-server-only] [SG2-94:AC1] [FAILURE] % must not call the approval check directly', client;
  exception when insufficient_privilege then null; end;
  reset role;
 end loop;
end $$;
rollback;
