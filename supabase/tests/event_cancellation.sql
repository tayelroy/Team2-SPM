-- Review trace: SG2-67 cancel an event.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-67: the organiser asks with a reason, only the assigned coordinator
-- cancels, venues and equipment are freed, registered attendees are told,
-- everything is recorded, and a cancelled event stays cancelled.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users(id)
 select ('d6700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,7) n;
insert into public.users(user_id,name,role_id) values
 ('d6700000-0000-4000-8000-000000000001','Cancel organiser',1),
 ('d6700000-0000-4000-8000-000000000002','Cancel colleague',1),
 ('d6700000-0000-4000-8000-000000000003','Cancel coordinator',2),
 ('d6700000-0000-4000-8000-000000000004','Other coordinator',2),
 ('d6700000-0000-4000-8000-000000000005','Registered attendee',5),
 ('d6700000-0000-4000-8000-000000000006','Withdrawn attendee',5),
 ('d6700000-0000-4000-8000-000000000007','Cancel venue staff',3);
insert into public.account_roles(user_id,role) values
 ('d6700000-0000-4000-8000-000000000001','event_organiser'),
 ('d6700000-0000-4000-8000-000000000002','event_organiser'),
 ('d6700000-0000-4000-8000-000000000003','event_coordinator'),
 ('d6700000-0000-4000-8000-000000000004','event_coordinator'),
 ('d6700000-0000-4000-8000-000000000005','attendee'),
 ('d6700000-0000-4000-8000-000000000006','attendee'),
 ('d6700000-0000-4000-8000-000000000007','venue_staff');
-- 96701 is the event cancelled below (its confirmed venues may move it on to
-- awaiting_safety_check through SG2-91's trigger); 96702 a draft; 96703 completed;
-- 96704 still waiting for a coordinator; 96705 another coordinator's;
-- 96706 cancelled before SG2-67, with no cancellation record.
insert into public.events(event_id,organiser_id,coordinator_id,name,status) values
 (96701,'d6700000-0000-4000-8000-000000000001','d6700000-0000-4000-8000-000000000003','Cancel Summit','planning'),
 (96702,'d6700000-0000-4000-8000-000000000001',null,'Cancel draft','draft'),
 (96703,'d6700000-0000-4000-8000-000000000001','d6700000-0000-4000-8000-000000000003','Cancel finished','planning'),
 (96704,'d6700000-0000-4000-8000-000000000001',null,'Cancel unassigned','submitted'),
 (96705,'d6700000-0000-4000-8000-000000000001','d6700000-0000-4000-8000-000000000004','Cancel other','planning'),
 (96706,'d6700000-0000-4000-8000-000000000001','d6700000-0000-4000-8000-000000000003','Cancel legacy','cancelled');
insert into public.events(event_id,organiser_id,coordinator_id,name,status,decision_reason) values
 (96707,'d6700000-0000-4000-8000-000000000001','d6700000-0000-4000-8000-000000000003','Cancel rejected','rejected','Not suitable');
insert into public.venues(venue_id,name) values (96701,'Cancel Hall'),(96702,'Cancel Annex'),(96703,'Cancel Studio');
insert into public.venue_bookings(booking_id,venue_id,event_id,starts_at,ends_at,status) values
 (96701,96701,96701,'2031-12-01 01:00+00','2031-12-01 05:00+00','confirmed'),
 (96702,96702,96701,'2031-12-01 01:00+00','2031-12-01 05:00+00','confirmed'),
 (96703,96701,96701,'2021-12-01 01:00+00','2021-12-01 05:00+00','confirmed');
update public.events set venue_booking_id = 96701 where event_id = 96701;
update public.events set status = 'completed', completed_by = 'd6700000-0000-4000-8000-000000000003',
  completed_at = now() where event_id = 96703;
insert into public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,layout,requested_by,
  status,decided_by,decided_at,venue_booking_id) values
 (96701,96701,96701,'2031-12-01 01:00+00','2031-12-01 05:00+00','theatre','d6700000-0000-4000-8000-000000000003',
  'approved','d6700000-0000-4000-8000-000000000007',now(),96701);
-- A third venue is only tentatively held, behind a pending request, and one
-- equipment request is still waiting for Technical Support.
insert into public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,layout,requested_by,status) values
 (96702,96701,96703,'2031-12-02 01:00+00','2031-12-02 05:00+00','theatre','d6700000-0000-4000-8000-000000000003','pending');
insert into public.venue_holds(hold_id,event_id,venue_id,request_id,starts_at,ends_at,expires_at,created_by) values
 (96701,96701,96703,96702,'2031-12-02 01:00+00','2031-12-02 05:00+00',now() + interval '7 days','d6700000-0000-4000-8000-000000000007');
insert into public.equipment(equipment_id,name,quantity_total) values (96701,'Cancel microphones',10);
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity) values (96701,96701,96701,2);
insert into public.equipment_reservations(reservation_id,event_id,equipment_id,quantity_reserved,starts_at,ends_at,reserved_at) values
 (96701,96701,96701,4,'2031-12-01 01:00+00','2031-12-01 05:00+00',now());
insert into public.registrations(registration_id,event_id,attendee_id,status) values
 (96701,96701,'d6700000-0000-4000-8000-000000000005','registered'),
 (96702,96701,'d6700000-0000-4000-8000-000000000006','cancelled');

do $$
begin
 begin
  insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
   values (96703,96705,'2031-12-02 01:00+00','2031-12-02 05:00+00','confirmed');
  raise exception '[SG2-67:hold-blocks-before-cancel] [SG2-67:AC2] [BOUNDARY] Another event booked a slot the tentative hold still covers';
 exception when exclusion_violation then null;
 end;
end $$;

set local role authenticated;

-- 1. Nothing can be cancelled before the organiser asks, and only the two
-- intended roles reach the functions at all.
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
 result := public.cancel_event(96701);
 if result->>'outcome' is distinct from 'not_requested' then
  raise exception '[SG2-67:cancel-needs-request] [SG2-67:AC1] [FAILURE] The coordinator cancelled before the organiser asked: %', result;
 end if;
 begin
  perform public.request_event_cancellation(96701, 'Coordinator asking');
  raise exception '[SG2-67:coordinator-cannot-ask] [SG2-67:AC1] [FAILURE] A coordinator asked for a cancellation';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000001',true);
do $$
begin
 begin
  perform public.cancel_event(96701);
  raise exception '[SG2-67:organiser-cannot-cancel] [SG2-67:AC1] [FAILURE] The organiser cancelled the event directly';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.events set status = 'cancelled' where event_id = 96701;
 exception when insufficient_privilege then null;
 end;
 if (select status from public.events where event_id = 96701) = 'cancelled' then
  raise exception '[SG2-67:direct-status-refused] [SG2-67:AC1] [FAILURE] The organiser set the status to cancelled through the table';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000007',true);
do $$
begin
 begin
  perform public.request_event_cancellation(96701, 'Venue staff asking');
  raise exception '[SG2-67:other-role-cannot-ask] [SG2-67:AC1] [FAILURE] Venue Staff asked for a cancellation';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.cancel_event(96701);
  raise exception '[SG2-67:other-role-cannot-cancel] [SG2-67:AC1] [FAILURE] Venue Staff cancelled an event';
 exception when insufficient_privilege then null;
 end;
end $$;

-- 2. The organiser's request: only the creator, only with a reason of at most
-- 500 characters, only once, and not for a draft or a finished event.
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000002',true);
do $$
begin
 if public.request_event_cancellation(96701, 'Colleague asking')->>'outcome' is distinct from 'missing' then
  raise exception '[SG2-67:colleague-cannot-ask] [SG2-67:AC1] [FAILURE] An organiser who did not create the event asked to cancel it';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
 if public.request_event_cancellation(96704, repeat('x', 501))->>'outcome' is distinct from 'invalid'
   or public.request_event_cancellation(96704, '   ')->>'outcome' is distinct from 'invalid' then
  raise exception '[SG2-67:reason-over-limit-refused] [SG2-67:AC1] [BOUNDARY] A blank reason or one of 501 characters was accepted';
 end if;
 result := public.request_event_cancellation(96704, repeat('y', 500));
 if result->>'outcome' is distinct from 'ok' or result->>'coordinator_notified' is distinct from 'false' then
  raise exception '[SG2-67:reason-at-limit-accepted] [SG2-67:AC1] [BOUNDARY] A 500-character reason must be accepted, with no coordinator yet to tell: %', result;
 end if;
 if public.request_event_cancellation(96702, 'Draft')->>'outcome' is distinct from 'closed'
   or public.request_event_cancellation(96703, 'Finished')->>'outcome' is distinct from 'closed'
   or public.request_event_cancellation(96707, 'Rejected')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-67:draft-or-completed-refused] [SG2-67:AC1] [FAILURE] A draft, completed or rejected event accepted a cancellation request';
 end if;

 result := public.request_event_cancellation(96701, '  The keynote speaker withdrew  ');
 if result->>'outcome' is distinct from 'ok' or result->>'coordinator_notified' is distinct from 'true' then
  raise exception '[SG2-67:organiser-asks] [SG2-67:AC1] [NORMAL] The creating organiser must be able to ask with a reason: %', result;
 end if;
 if public.request_event_cancellation(96701, 'Asking again')->>'outcome' is distinct from 'requested' then
  raise exception '[SG2-67:ask-once] [SG2-67:AC1] [CONFLICT] A second request replaced the first';
 end if;
end $$;
reset role;
do $$
begin
 if not exists (select 1 from public.events where event_id = 96701 and status <> 'cancelled'
     and cancellation_reason = 'The keynote speaker withdrew' and cancellation_requested_at is not null
     and cancellation_requested_by = 'd6700000-0000-4000-8000-000000000001')
   or not exists (select 1 from public.notifications where event_id = 96701 and kind = 'cancellation_requested'
     and recipient_id = 'd6700000-0000-4000-8000-000000000003'
     and message = 'The organiser asked to cancel Cancel Summit: The keynote speaker withdrew')
   or not exists (select 1 from public.event_audit_logs where event_id = 96701 and field_name = 'cancellation_request'
     and new_value = 'Requested: The keynote speaker withdrew') then
  raise exception '[SG2-67:request-recorded] [SG2-67:AC1] [SG2-67:AC4] [NORMAL] The request must keep its reason, asker and time, reach the coordinator and appear in the history';
 end if;
 if (select details->>'cancellation_reason' from public.internal_work_items where kind = 'event' and event_id = 96701)
     is distinct from 'The keynote speaker withdrew'
   or (select details->>'cancellation_requested_at' from public.internal_work_items where kind = 'event' and event_id = 96701) is null then
  raise exception '[SG2-67:request-in-work-queue] [SG2-67:AC1] [NORMAL] The coordinator''s work queue must show the organiser''s request';
 end if;
end $$;

-- 3. Only the assigned coordinator carries it out.
set local role authenticated;
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000004',true);
do $$
begin
 if public.cancel_event(96701)->>'outcome' is distinct from 'missing' then
  raise exception '[SG2-67:other-coordinator-refused] [SG2-67:AC1] [FAILURE] A coordinator not assigned to the event cancelled it';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
 result := public.cancel_event(96701);
 if result->>'outcome' is distinct from 'ok' or (result->>'bookings_released')::int IS DISTINCT FROM 2
   or (result->>'attendees_notified')::int IS DISTINCT FROM 1 then
  raise exception '[SG2-67:coordinator-cancels] [SG2-67:AC1] [SG2-67:AC2] [SG2-67:AC3] [NORMAL] The assigned coordinator must cancel, freeing both future venues and telling the one registered attendee: %', result;
 end if;
end $$;
reset role;

-- 4. AC2-AC4: what the cancellation changed.
do $$
begin
 if (select count(*) from public.venue_bookings where event_id = 96701 and status = 'cancelled'
     and cancelled_by = 'd6700000-0000-4000-8000-000000000003'
     and cancellation_reason = 'Event cancelled: The keynote speaker withdrew') <> 2
   or (select status from public.venue_bookings where booking_id = 96703) IS DISTINCT FROM 'confirmed'
   or (select status from public.venue_booking_requests where request_id = 96701) IS DISTINCT FROM 'cancelled'
   or (select venue_booking_id from public.events where event_id = 96701) is not null then
  raise exception '[SG2-67:venues-released] [SG2-67:AC2] [NORMAL] Both future bookings must be released with the reason, the past one kept and the committing request closed';
 end if;
 if not exists (select 1 from public.equipment_reservations where reservation_id = 96701
     and released_by = 'd6700000-0000-4000-8000-000000000003' and release_reason = 'Event cancelled') then
  raise exception '[SG2-67:equipment-released] [SG2-67:AC2] [NORMAL] Cancelling must release the equipment through SG2-56';
 end if;
 if (select status from public.venue_holds where hold_id = 96701) IS DISTINCT FROM 'released'
   or (select status from public.venue_booking_requests where request_id = 96702) IS DISTINCT FROM 'cancelled'
   or (select status from public.equipment_requests where request_id = 96701) IS DISTINCT FROM 'cancelled'
   or not exists (select 1 from public.event_audit_logs where event_id = 96701 and field_name = 'venue_hold_status'
     and new_value = 'Released hold 96701 — Event cancelled') then
  raise exception '[SG2-67:holds-and-requests-released] [SG2-67:AC2] [NORMAL] The tentative hold must be released with history, and pending venue and equipment requests cancelled';
 end if;
 begin
  insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
   values (96703,96705,'2031-12-02 01:00+00','2031-12-02 05:00+00','confirmed');
 exception when exclusion_violation then
  raise exception '[SG2-67:slot-free-for-another-event] [SG2-67:AC2] [NORMAL] Another event still cannot book the slot the cancelled event held';
 end;
 if (select count(*) from public.notifications where event_id = 96701 and kind = 'event_cancelled'
     and message = 'Cancel Summit has been cancelled: The keynote speaker withdrew') <> 2
   or not exists (select 1 from public.notifications where kind = 'event_cancelled'
     and recipient_id = 'd6700000-0000-4000-8000-000000000005')
   or not exists (select 1 from public.notifications where kind = 'event_cancelled'
     and recipient_id = 'd6700000-0000-4000-8000-000000000001')
   or exists (select 1 from public.notifications where kind = 'event_cancelled'
     and recipient_id = 'd6700000-0000-4000-8000-000000000006') then
  raise exception '[SG2-67:attendees-notified] [SG2-67:AC3] [NORMAL] The registered attendee and the organiser must be told, and the withdrawn attendee not';
 end if;
 if not exists (select 1 from public.events where event_id = 96701 and status = 'cancelled'
     and cancelled_by = 'd6700000-0000-4000-8000-000000000003' and cancelled_at is not null
     and cancellation_reason = 'The keynote speaker withdrew')
   or (select count(*) from public.event_audit_logs where event_id = 96701 and field_name = 'venue_booking'
     and new_value like 'Released: % — Event cancelled') <> 2
   or not exists (select 1 from public.event_audit_logs where event_id = 96701 and field_name = 'status'
     and old_value in ('planning', 'awaiting_safety_check') and new_value = 'cancelled'
     and actor_id = 'd6700000-0000-4000-8000-000000000003') then
  raise exception '[SG2-67:cancellation-recorded] [SG2-67:AC4] [NORMAL] The reason, who cancelled and when must stay on the event and in its history';
 end if;
 if exists (select 1 from public.internal_work_items where kind = 'event' and event_id = 96701) then
  raise exception '[SG2-67:cancelled-leaves-queue] [SG2-67:AC5] [NORMAL] A cancelled event must leave the coordinator''s work queue';
 end if;
end $$;

-- 5. AC5: cancellation is final, through the functions and the table alike.
set local role authenticated;
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000003',true);
do $$
begin
 if public.cancel_event(96701)->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-67:cancel-once] [SG2-67:AC5] [CONFLICT] A cancelled event was cancelled again';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d6700000-0000-4000-8000-000000000001',true);
do $$
begin
 if public.request_event_cancellation(96701, 'Again')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-67:no-request-after-cancel] [SG2-67:AC5] [CONFLICT] A cancelled event accepted another request';
 end if;
end $$;
reset role;
do $$
declare event_id_to_reinstate integer;
begin
 foreach event_id_to_reinstate in array array[96701, 96706] loop
  begin
   update public.events set status = 'planning' where event_id = event_id_to_reinstate;
   raise exception '[SG2-67:no-reinstatement] [SG2-67:AC5] [FAILURE] Cancelled event % was reinstated', event_id_to_reinstate;
  exception when check_violation then
   if sqlerrm <> 'A cancelled event cannot be reinstated.' then
    raise exception '[SG2-67:reinstatement-stopped-by-rule] [SG2-67:AC5] [FAILURE] Event % was refused for another reason: %', event_id_to_reinstate, sqlerrm;
   end if;
  end;
 end loop;
 update public.events set name = 'Cancel Summit (renamed)' where event_id = 96701;
 if (select status from public.events where event_id = 96701) IS DISTINCT FROM 'cancelled' then
  raise exception '[SG2-67:other-edits-kept-cancelled] [SG2-67:AC5] [CONFLICT] Another edit changed a cancelled event''s status';
 end if;
 begin
  update public.events set cancelled_at = now() where event_id = 96705;
  raise exception '[SG2-67:cancelled-at-needs-status] [SG2-67:AC4] [FAILURE] A cancellation time was stored on an event that is not cancelled';
 exception when check_violation then null;
 end;
end $$;

rollback;
