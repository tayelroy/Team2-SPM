-- SG2-84/85: only disposable PostgreSQL, every fixture is rolled back.
begin;
insert into auth.users(id) values
 ('d8400000-0000-4000-8000-000000000001'),('d8400000-0000-4000-8000-000000000002'),
 ('d8400000-0000-4000-8000-000000000003'),('d8400000-0000-4000-8000-000000000004'),
 ('d8400000-0000-4000-8000-000000000005'),('d8400000-0000-4000-8000-000000000006');
insert into public.users(user_id,name,role_id) values
 ('d8400000-0000-4000-8000-000000000001','Hold staff',3),
 ('d8400000-0000-4000-8000-000000000002','Coordinator',2),
 ('d8400000-0000-4000-8000-000000000003','Organiser',1),
 ('d8400000-0000-4000-8000-000000000004','Other coordinator',2),
 ('d8400000-0000-4000-8000-000000000005','Attendee',5),
 ('d8400000-0000-4000-8000-000000000006','Hold technical support',4);
insert into public.account_roles(user_id,role) values
 ('d8400000-0000-4000-8000-000000000001','venue_staff'),
 ('d8400000-0000-4000-8000-000000000002','event_coordinator'),
 ('d8400000-0000-4000-8000-000000000003','event_organiser'),
 ('d8400000-0000-4000-8000-000000000004','event_coordinator'),
 ('d8400000-0000-4000-8000-000000000005','attendee'),
 ('d8400000-0000-4000-8000-000000000006','technical_support_staff');
insert into public.venues(venue_id,name,capacity,facilities) values
 (98401,'Hold Hall',100,'Stage, projection'),(98402,'Small Hall',20,null),(98403,'Missing facility',100,null);
insert into public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance,venue_requirements) values
 (98401,'d8400000-0000-4000-8000-000000000003','d8400000-0000-4000-8000-000000000002','Hold event','planning',80,'stage'),
 (98402,'d8400000-0000-4000-8000-000000000003',null,'Unassigned event','planning',80,null),
 (98403,'d8400000-0000-4000-8000-000000000003','d8400000-0000-4000-8000-000000000002','Small event','approved',30,null);

set local role authenticated;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb; id bigint; expiry timestamptz := clock_timestamp() + interval '2 days';
begin
 -- 
 result := public.create_venue_hold(98401,98401,now()+interval '10 days',now()+interval '10 days 2 hours',expiry);
 if result->>'outcome' <> 'created' or result#>>'{hold,status}' <> 'tentative'
   or (result#>>'{hold,expires_at}')::timestamptz <> expiry then raise exception '[SG2-84:placement-failed] [NORMAL] [SG2-84:AC1] [SG2-84:AC4] placement failed: %',result; end if;
 id := (result#>>'{hold,hold_id}')::bigint; perform set_config('holds.primary',id::text,true);
 if not exists(select 1 from public.venue_booking_occupancy where venue_id = 98401 and status = 'tentative') then raise exception '[SG2-84:occupancy-missing] [NORMAL] [SG2-84:AC3] occupancy missing'; end if;
 if exists(select 1 from public.venue_bookings where venue_id = 98401) then raise exception '[SG2-84:tentative-placement-confirmed-a-booking] [FAILURE] [SG2-84:AC4] Tentative placement confirmed a booking'; end if;
 -- 
 if public.create_venue_hold(98401,98401,now()+interval '10 days 1 hour',now()+interval '10 days 3 hours',expiry)->>'outcome' <> 'conflict' then raise exception '[SG2-84:overlapping-hold-accepted] [CONFLICT] [SG2-84:AC3] overlapping hold accepted'; end if;
 -- touching periods do not overlap.
 result := public.create_venue_hold(98401,98401,now()+interval '10 days 2 hours',now()+interval '10 days 3 hours',expiry);
 if result->>'outcome' <> 'created' then raise exception '[SG2-84:adjacent-hold-refused] [BOUNDARY] [SG2-84:AC3] adjacent hold refused'; end if;
 if public.change_venue_hold((result#>>'{hold,hold_id}')::bigint,'release')->>'outcome' <> 'updated' then raise exception '[SG2-84:release-failed] [NORMAL] [SG2-84:AC5] release failed'; end if;
 if public.change_venue_hold((result#>>'{hold,hold_id}')::bigint,'convert')->>'outcome' <> 'inactive' then raise exception '[SG2-84:released-hold-approved] [CONFLICT] [SG2-84:AC5] released hold approved'; end if;
 -- exact deadline and mandatory expiry.
 if public.create_venue_hold(98401,98401,now()+interval '11 days',now()+interval '12 days',null)->>'outcome' <> 'invalid'
   or public.create_venue_hold(98401,98401,now()+interval '11 days',now()+interval '12 days',clock_timestamp())->>'outcome' <> 'invalid'
   then raise exception '[SG2-84:invalid-expiry-accepted] [BOUNDARY] [SG2-84:AC2] invalid expiry accepted'; end if;
 -- public SQL seam validates finite instants and eligible events.
 if public.create_venue_hold(98402,98401,now()+interval '11 days',now()+interval '12 days',expiry)->>'outcome' <> 'invalid'
   or public.create_venue_hold(98401,98401,'-infinity',now()+interval '12 days',expiry)->>'outcome' <> 'invalid'
   or public.create_venue_hold(98401,98401,now()+interval '11 days','infinity',expiry)->>'outcome' <> 'invalid'
   or public.create_venue_hold(98401,98401,now()+interval '11 days',now()+interval '12 days','infinity')->>'outcome' <> 'invalid'
   then raise exception '[SG2-84:invalid-event-or-finite-instant-guard-failed] [FAILURE] [SG2-84:AC1] invalid event or finite instant guard failed'; end if;
 if public.create_venue_hold(-1,98401,now()+interval '11 days',now()+interval '12 days',expiry)->>'outcome' <> 'missing'
   or public.create_venue_hold(98401,-1,now()+interval '11 days',now()+interval '12 days',expiry)->>'outcome' <> 'missing'
   or public.change_venue_hold(-1,'convert')->>'outcome' <> 'missing'
   or public.change_venue_hold(id,'unknown')->>'outcome' <> 'invalid'
   then raise exception '[SG2-84:missing-or-invalid-selection-guard-failed] [FAILURE] [SG2-84:AC1] missing or invalid selection guard failed'; end if;
 begin
   update public.venue_holds set status = 'converted' where hold_id = id;
   raise exception '[SG2-84:staff-bypassed-atomic-approval] [FAILURE] [SG2-84:AC4] staff bypassed atomic approval';
 exception when insufficient_privilege then null; end;
end;
$$;
reset role;
-- the default 24-hour threshold is inclusive.
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.create_venue_hold(98401,98401,now()+interval '20 days',now()+interval '20 days 1 hour',clock_timestamp()+interval '24 hours');
 perform set_config('holds.warn_edge',result#>>'{hold,hold_id}',true);
 result := public.create_venue_hold(98401,98401,now()+interval '21 days',now()+interval '21 days 1 hour',clock_timestamp()+interval '24 hours 1 minute');
 perform set_config('holds.warn_later',result#>>'{hold,hold_id}',true);
end;
$$;
reset role;
do $$
begin
 if (select count(*) from public.venue_hold_notifications where hold_id = current_setting('holds.warn_edge')::bigint and kind = 'warning') <> 1
  or exists(select 1 from public.venue_hold_notifications where hold_id = current_setting('holds.warn_later')::bigint and kind = 'warning')
  then raise exception '[SG2-85:exact-default-threshold-did-not-warn-once-or-later-deadline-warne] [BOUNDARY] [SG2-85:AC4] exact default threshold did not warn once or later deadline warned too early'; end if;
end;
$$;
do $$
begin
 -- coordinator placement includes deadline.
 if (select count(*) from public.venue_hold_notifications where hold_id = current_setting('holds.primary')::bigint and kind = 'placed'
   and recipient_id = 'd8400000-0000-4000-8000-000000000002' and message like '%expiry %') <> 1 then raise exception '[SG2-84:placement-notification-missing] [NORMAL] [SG2-84:AC6] placement notification missing'; end if;
 if (select status from public.events where event_id = 98401) <> 'planning' or (select venue_booking_id from public.events where event_id = 98401) is not null then raise exception '[SG2-84:hold-changed-event-stage] [FAILURE] [SG2-84:AC4] hold changed event stage'; end if;
 begin
  insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values(98401,98401,now()+interval '10 days',now()+interval '10 days 1 hour','confirmed');
  raise exception '[SG2-84:direct-booking-bypassed-hold-conflict] [CONFLICT] [SG2-84:AC3] direct booking bypassed hold conflict';
 exception when exclusion_violation then null; end;
 -- adjustable default lead-time warns once before expiry.
 if (select warning_lead_seconds from public.venue_hold_settings) <> 86400 then raise exception '[SG2-85:default-warning-is-not-24-hours] [NORMAL] [SG2-85:AC4] default warning is not 24 hours'; end if;
 update public.venue_hold_settings set warning_lead_seconds = 259200;
 perform public.process_venue_hold_deadlines(); perform public.process_venue_hold_deadlines();
 if (select count(*) from public.venue_hold_notifications where hold_id = current_setting('holds.primary')::bigint and kind = 'warning') <> 1 then raise exception '[SG2-85:warning-missing-or-repeated] [NORMAL] [SG2-85:AC4] warning missing or repeated'; end if;
 -- availability frees immediately at deadline, before cron.
 update public.venue_holds set created_at = now()-interval '2 days', expires_at = clock_timestamp() where hold_id = current_setting('holds.primary')::bigint;
 if exists(select 1 from public.venue_booking_occupancy where venue_id = 98401 and starts_at = now()+interval '10 days') then raise exception '[SG2-85:overdue-hold-still-occupies-venue] [BOUNDARY] [SG2-85:AC2] overdue hold still occupies venue'; end if;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
 if public.change_venue_hold(current_setting('holds.primary')::bigint,'convert')->>'outcome' <> 'inactive' then raise exception '[SG2-85:deadline-hold-was-approved] [CONFLICT] [SG2-85:AC3] deadline hold was approved'; end if;
 result := public.create_venue_hold(98401,98401,now()+interval '10 days',now()+interval '10 days 2 hours',clock_timestamp()+interval '2 days');
 if result->>'outcome' <> 'created' then raise exception '[SG2-85:expired-period-cannot-accept-new-request] [NORMAL] [SG2-85:AC2] expired period cannot accept new request'; end if;
 perform set_config('holds.convert',(result#>>'{hold,hold_id}'),true);
 result := public.change_venue_hold((result#>>'{hold,hold_id}')::bigint,'convert');
 if result->>'outcome' <> 'updated' or result#>>'{hold,status}' <> 'converted' then raise exception '[SG2-84:normal-approval-conversion-failed] [NORMAL] [SG2-84:AC5] normal approval conversion failed: %',result; end if;
end;
$$;
reset role;
do $$
begin
 if (select status from public.venue_holds where hold_id = current_setting('holds.primary')::bigint) <> 'expired'
  or (select count(*) from public.venue_hold_notifications where hold_id = current_setting('holds.primary')::bigint and kind = 'expired') <> 1
  or not exists(select 1 from public.event_audit_logs where event_id = 98401 and actor_id is null and field_name = 'venue_hold_status' and new_value = 'Expired hold ' || current_setting('holds.primary'))
  then raise exception '[SG2-85:expiry-state-notification-or-automatic-history-missing] [NORMAL] [SG2-85:AC1] [SG2-85:AC4] [SG2-85:AC5] expiry state, notification or automatic history missing'; end if;
 perform public.process_venue_hold_deadlines();
 if (select status from public.venue_holds where hold_id = current_setting('holds.convert')::bigint) <> 'converted'
  or not exists(select 1 from public.venue_bookings where event_id = 98401 and status = 'confirmed')
  or not exists(select 1 from public.venue_booking_requests r join public.venue_holds h using(request_id) where h.hold_id = current_setting('holds.convert')::bigint and r.status = 'approved')
  then raise exception '[SG2-84:converted-booking-missing-or-timer-changed-it] [NORMAL] [SG2-84:AC5] converted booking missing or timer changed it'; end if;
 if (select status from public.events where event_id = 98401) <> 'planning' then raise exception '[SG2-84:venue-approval-falsely-confirmed-event] [FAILURE] [SG2-84:AC4] venue approval falsely confirmed event'; end if;
end;
$$;

-- Capacity and required facilities remain part of normal approval.
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.create_venue_hold(98403,98402,now()+interval '10 days',now()+interval '11 days',clock_timestamp()+interval '2 days');
 perform set_config('holds.capacity',result#>>'{hold,hold_id}',true);
 if public.change_venue_hold((result#>>'{hold,hold_id}')::bigint,'convert')->>'outcome' <> 'capacity' then raise exception '[SG2-84:oversized-booking-approved-without-exception] [CONFLICT] [SG2-84:AC5] oversized booking approved without exception'; end if;
 result := public.create_venue_hold(98401,98403,now()+interval '10 days',now()+interval '11 days',clock_timestamp()+interval '2 days');
 if public.change_venue_hold((result#>>'{hold,hold_id}')::bigint,'convert')->>'outcome' <> 'suitability' then raise exception '[SG2-84:missing-facility-approved] [CONFLICT] [SG2-84:AC5] missing facility approved'; end if;
 perform set_config('holds.stale',result#>>'{hold,hold_id}',true);
end;
$$;
reset role;
insert into public.venue_capacity_exceptions(request_id,approved_by,approver_role,expected_attendance,venue_capacity)
 select request_id,'d8400000-0000-4000-8000-000000000001','venue_staff',30,20 from public.venue_holds where hold_id = current_setting('holds.capacity')::bigint;
update public.venue_holds set starts_at = now()-interval '2 hours',ends_at = now()-interval '1 hour' where hold_id = current_setting('holds.stale')::bigint;
set local role authenticated;
do $$
begin
 if public.change_venue_hold(current_setting('holds.capacity')::bigint,'convert')->>'outcome' <> 'updated' then raise exception '[SG2-84:approved-capacity-exception-did-not-authorize-booking] [NORMAL] [SG2-84:AC5] approved capacity exception did not authorize booking'; end if;
 if public.change_venue_hold(current_setting('holds.stale')::bigint,'convert')->>'outcome' <> 'invalid' then raise exception '[SG2-84:finished-booking-period-was-converted] [BOUNDARY] [SG2-84:AC5] finished booking period was converted'; end if;
end;
$$;

-- RLS and RPCs check both role and assignment; recipients see only their notifications.
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000002',true);
do $$
begin
 if jsonb_array_length(public.list_venue_hold_notifications()) < 3 then raise exception '[SG2-85:coordinator-cannot-read-notifications] [NORMAL] [SG2-85:AC4] coordinator cannot read notifications'; end if;
 if jsonb_array_length(public.list_venue_holds()) = 0 then raise exception '[SG2-84:assigned-coordinator-cannot-read-holds] [NORMAL] [SG2-84:AC1] assigned coordinator cannot read holds'; end if;
 if exists(select 1 from public.venue_holds) then raise exception '[SG2-84:coordinator-details-require-scoped-rpc] [FAILURE] [SG2-84:AC1] Coordinator detailed reads must use the assigned-event RPC'; end if;
 if not exists(select 1 from public.venue_booking_occupancy where venue_id = 98401 and starts_at = now()+interval '20 days' and status = 'tentative' and event_id = 98401)
  then raise exception '[SG2-84:assigned-coordinator-occupancy-retained] [NORMAL] [SG2-84:AC3] Assigned coordinator lost the live occupied period'; end if;
 begin
  perform public.change_venue_hold(current_setting('holds.stale')::bigint,'release');
  raise exception '[SG2-84:coordinator-mutated-hold] [FAILURE] [SG2-84:AC5] coordinator mutated hold';
 exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000004',true);
do $$
begin
 if public.list_venue_hold_notifications() <> '[]'::jsonb or public.list_venue_holds() <> '[]'::jsonb or exists(select 1 from public.venue_hold_notifications) then raise exception '[SG2-84:unassigned-coordinator-saw-another-person-notifications-or-event] [FAILURE] [SG2-84:AC6] unassigned coordinator saw another person notifications or event details'; end if;
 if exists(select 1 from public.venue_holds) then raise exception '[SG2-84:unassigned-coordinator-direct-holds-denied] [FAILURE] [SG2-84:AC1] Unassigned coordinator must not read raw hold metadata in any lifecycle state'; end if;
 if not exists(select 1 from public.venue_booking_occupancy where venue_id = 98401 and starts_at = now()+interval '20 days' and status = 'tentative' and event_id is null)
  or exists(select 1 from public.venue_hold_occupancy() where event_id is not null)
  then raise exception '[SG2-84:shared-occupancy-redacts-unassigned-events] [NORMAL] [SG2-84:AC3] Shared live occupied periods must remain visible without unrelated event identifiers'; end if;
 if exists(select 1 from public.venue_hold_occupancy() o where to_jsonb(o) ?| array['hold_id','request_id','booking_id','created_by','expires_at','created_at','warning_sent_at'])
  then raise exception '[SG2-84:occupancy-projection-limits-metadata] [FAILURE] [SG2-84:AC3] Occupancy projection exposed detailed hold fields'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000005',true);
do $$
begin
 if exists(select 1 from public.venue_booking_occupancy) then raise exception '[SG2-84:external-attendee-saw-internal-occupancy] [FAILURE] [SG2-84:AC3] external attendee saw internal occupancy'; end if;
 if exists(select 1 from public.venue_holds) or exists(select 1 from public.venue_hold_occupancy())
  then raise exception '[SG2-84:external-hold-projection-denied] [FAILURE] [SG2-84:AC3] External role must not receive detailed or projected hold data'; end if;
 begin
  perform public.list_venue_holds(); raise exception '[SG2-84:attendee-read-holds-through-rpc] [FAILURE] [SG2-84:AC1] attendee read holds through RPC';
 exception when insufficient_privilege then null; end;
end;
$$;
reset role;
-- The corrected privacy boundary follows current assignment, without changing
-- event assignment workflows or hiding shared occupied periods.
update public.events set coordinator_id = 'd8400000-0000-4000-8000-000000000004' where event_id = 98401;
set local role authenticated;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000002',true);
do $$
begin
 if exists(select 1 from jsonb_array_elements(public.list_venue_holds()) h where (h->>'event_id')::integer = 98401)
  or not exists(select 1 from public.venue_hold_occupancy() where venue_id = 98401 and starts_at = now()+interval '20 days' and event_id is null)
  then raise exception '[SG2-84:former-assignment-details-removed] [CONFLICT] [SG2-84:AC1] [SG2-84:AC3] Former assignment must lose detailed records while retaining redacted occupancy'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000004',true);
do $$
begin
 if not exists(select 1 from jsonb_array_elements(public.list_venue_holds()) h where (h->>'event_id')::integer = 98401)
  or not exists(select 1 from public.venue_hold_occupancy() where venue_id = 98401 and starts_at = now()+interval '20 days' and event_id = 98401)
  or exists(select 1 from public.venue_holds)
  then raise exception '[SG2-84:current-assignment-rpc-read-retained] [NORMAL] [SG2-84:AC1] [SG2-84:AC3] Current assignment must retain its scoped RPC and occupancy without raw table access'; end if;
end;
$$;
reset role;
update public.events set coordinator_id = 'd8400000-0000-4000-8000-000000000002' where event_id = 98401;
select set_config('holds.raw_count',(select count(*)::text from public.venue_holds),true);
select set_config('holds.active_count',(select count(*)::text from public.venue_holds where status = 'tentative' and expires_at > clock_timestamp()),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000001',true);
do $$
begin
 if (select count(*) from public.venue_holds) <> current_setting('holds.raw_count')::integer
  or (select count(*) from public.venue_hold_occupancy()) <> current_setting('holds.active_count')::integer
  then raise exception '[SG2-84:staff-direct-read-compatibility] [NORMAL] [SG2-84:AC1] [SG2-84:AC3] Venue Staff lost detailed or live occupancy reads'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000006',true);
do $$
begin
 if (select count(*) from public.venue_holds) <> current_setting('holds.raw_count')::integer
  or (select count(*) from public.venue_hold_occupancy()) <> current_setting('holds.active_count')::integer
  then raise exception '[SG2-84:technical-direct-read-compatibility] [NORMAL] [SG2-84:AC3] Technical Support Staff lost existing internal read access'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','',true);
do $$
begin
 if exists(select 1 from public.venue_hold_occupancy()) or exists(select 1 from public.venue_holds)
  then raise exception '[SG2-84:missing-identity-hold-read-denied] [BOUNDARY] [SG2-84:AC1] [SG2-84:AC3] An authenticated database role without a caller identity must not receive hold data'; end if;
end;
$$;
reset role;
set local role service_role;
do $$
begin
 if (select count(*) from public.venue_holds) <> current_setting('holds.raw_count')::integer
  or (select count(*) from public.venue_hold_occupancy()) <> current_setting('holds.active_count')::integer
  or exists(select 1 from public.venue_hold_occupancy() where event_id is null)
  then raise exception '[SG2-84:trusted-service-occupancy-retained] [NORMAL] [SG2-84:AC3] Trusted service reads without an end-user identity lost hold occupancy'; end if;
end;
$$;
reset role;
do $$
begin
 if has_function_privilege('anon','public.venue_hold_occupancy()','EXECUTE')
  then raise exception '[SG2-84:anonymous-hold-projection-denied] [FAILURE] [SG2-84:AC3] Anonymous callers must not execute the occupancy projection'; end if;
end;
$$;
do $$
declare name text;
begin
 foreach name in array array['anon','authenticated'] loop
  if has_table_privilege(name,'public.venue_holds','INSERT,UPDATE,DELETE') or has_table_privilege(name,'public.venue_hold_notifications','INSERT,UPDATE,DELETE')
    or has_table_privilege(name,'public.venue_hold_settings','SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege(name,'public.process_venue_hold_deadlines()','EXECUTE') then raise exception '[SG2-85:direct-mutation-or-timer-privilege-escaped] [FAILURE] [SG2-85:AC1] direct mutation or timer privilege escaped: %',name; end if;
 end loop;
end;
$$;
-- notification failure rolls back hold, request and history.
create function pg_temp.reject_hold_notice() returns trigger language plpgsql as $$
begin raise exception using errcode = 'P0001',message = '[SG2-84:notification-failure-injection] [FAILURE] [SG2-84:AC6] injected_notification_failure'; end;
$$;
create trigger reject_hold_notice before insert on public.venue_hold_notifications for each row execute function pg_temp.reject_hold_notice();
select set_config('holds.before_requests',(select count(*)::text from public.venue_booking_requests),true);
select set_config('holds.before_audit',(select count(*)::text from public.event_audit_logs),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000001',true);
do $$
begin
 begin
  perform public.create_venue_hold(98401,98401,now()+interval '40 days',now()+interval '41 days',clock_timestamp()+interval '2 days');
  raise exception '[SG2-84:expected-injected-notification-failure] [FAILURE] [SG2-84:AC6] expected injected notification failure';
 exception when raise_exception then
  if sqlerrm not like '%injected_notification_failure' then raise; end if;
 end;
end;
$$;
reset role;
drop trigger reject_hold_notice on public.venue_hold_notifications;
do $$
begin
 if exists(select 1 from public.venue_holds where venue_id = 98401 and starts_at = now()+interval '40 days')
  or (select count(*) from public.venue_booking_requests) <> current_setting('holds.before_requests')::integer
  or (select count(*) from public.event_audit_logs) <> current_setting('holds.before_audit')::integer
  then raise exception '[SG2-84:failed-notification-partially-committed-hold-request-or-history] [FAILURE] [SG2-84:AC6] failed notification partially committed hold, request or history'; end if;
end;
$$;
-- Placement conflicts are checked against both forms of existing occupancy.
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
 values(98401,98401,now()+interval '30 days',now()+interval '31 days','confirmed');
insert into public.venue_unavailability(venue_id,starts_at,ends_at,reason)
 values(98401,now()+interval '32 days',now()+interval '33 days','Existing placement block');
set local role authenticated;
select set_config('request.jwt.claim.sub','d8400000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
 if public.create_venue_hold(98401,98401,now()+interval '30 days 1 hour',now()+interval '30 days 2 hours',clock_timestamp()+interval '2 days')->>'outcome' <> 'conflict'
  then raise exception '[SG2-84:placement-confirmed-booking-conflict] [CONFLICT] [SG2-84:AC3] Placement overlapped an existing confirmed booking'; end if;
 if public.create_venue_hold(98401,98401,now()+interval '32 days 1 hour',now()+interval '32 days 2 hours',clock_timestamp()+interval '2 days')->>'outcome' <> 'conflict'
  then raise exception '[SG2-84:placement-unavailability-conflict] [CONFLICT] [SG2-84:AC3] Placement overlapped existing venue unavailability'; end if;
 result := public.create_venue_hold(98401,98401,now()+interval '34 days',now()+interval '35 days',clock_timestamp()+interval '2 days');
 if result->>'outcome' <> 'created' then raise exception '[SG2-84:late-block-hold-fixture] [NORMAL] [SG2-84:AC1] Hold required for the late block test was not created'; end if;
 perform set_config('holds.late_block',result#>>'{hold,hold_id}',true);
end;
$$;
reset role;
insert into public.venue_unavailability(venue_id,starts_at,ends_at,reason)
 values(98401,now()+interval '34 days 1 hour',now()+interval '34 days 2 hours','Block added after tentative placement');
set local role authenticated;
do $$
begin
 if public.change_venue_hold(current_setting('holds.late_block')::bigint,'convert')->>'outcome' <> 'conflict'
  then raise exception '[SG2-84:conversion-new-unavailability-conflict] [CONFLICT] [SG2-84:AC5] Conversion approved a period made unavailable after placement'; end if;
end;
$$;
reset role;
do $$
begin
 if (select status from public.venue_holds where hold_id = current_setting('holds.late_block')::bigint) <> 'tentative'
  or exists(select 1 from public.venue_bookings where venue_id = 98401 and starts_at = now()+interval '34 days')
  or not exists(select 1 from public.venue_booking_requests r join public.venue_holds h using(request_id) where h.hold_id = current_setting('holds.late_block')::bigint and r.status = 'pending')
  then raise exception '[SG2-84:conversion-conflict-preserves-pending-hold] [CONFLICT] [SG2-84:AC5] Rejected late-block conversion changed hold, request or booking state'; end if;
end;
$$;

-- A failed expiry notice must not partially expire the hold or its request.
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.create_venue_hold(98401,98401,now()+interval '50 days',now()+interval '51 days',clock_timestamp()+interval '2 days');
 if result->>'outcome' <> 'created' then raise exception '[SG2-85:expiry-rollback-hold-fixture] [NORMAL] [SG2-85:AC1] Hold required for expiry rollback was not created'; end if;
 perform set_config('holds.expiry_rollback',result#>>'{hold,hold_id}',true);
end;
$$;
reset role;
update public.venue_holds set expires_at = created_at+interval '1 microsecond' where hold_id = current_setting('holds.expiry_rollback')::bigint;
create function pg_temp.reject_expiry_notice() returns trigger language plpgsql as $$
begin
 if new.kind = 'expired' and new.hold_id = current_setting('holds.expiry_rollback')::bigint then
  raise exception using errcode = 'P0001',message = '[SG2-85:expiry-notice-failure-injection] [FAILURE] [SG2-85:AC4] injected_expiry_notice_failure';
 end if;
 return new;
end;
$$;
create trigger reject_expiry_notice before insert on public.venue_hold_notifications for each row execute function pg_temp.reject_expiry_notice();
do $$
begin
 begin
  perform public.process_venue_hold_deadlines();
  raise exception '[SG2-85:expiry-notice-failure-expected] [FAILURE] [SG2-85:AC4] Expected injected expiry notification failure';
 exception when raise_exception then
  if sqlerrm not like '%injected_expiry_notice_failure' then raise; end if;
 end;
 if (select status from public.venue_holds where hold_id = current_setting('holds.expiry_rollback')::bigint) <> 'tentative'
  or not exists(select 1 from public.venue_booking_requests r join public.venue_holds h using(request_id) where h.hold_id = current_setting('holds.expiry_rollback')::bigint and r.status = 'pending')
  or exists(select 1 from public.event_audit_logs where actor_id is null and new_value = 'Expired hold ' || current_setting('holds.expiry_rollback'))
  or exists(select 1 from public.venue_hold_notifications where hold_id = current_setting('holds.expiry_rollback')::bigint and kind = 'expired')
  then raise exception '[SG2-85:expiry-notice-failure-atomic-rollback] [FAILURE] [SG2-85:AC1] [SG2-85:AC4] [SG2-85:AC5] Failed expiry partially changed hold, request, System history or notification'; end if;
end;
$$;
drop trigger reject_expiry_notice on public.venue_hold_notifications;
do $$
begin
 perform public.process_venue_hold_deadlines();
 if (select status from public.venue_holds where hold_id = current_setting('holds.expiry_rollback')::bigint) <> 'expired'
  or not exists(select 1 from public.venue_booking_requests r join public.venue_holds h using(request_id) where h.hold_id = current_setting('holds.expiry_rollback')::bigint and r.status = 'cancelled')
  or (select count(*) from public.event_audit_logs where actor_id is null and new_value = 'Expired hold ' || current_setting('holds.expiry_rollback')) <> 1
  or (select count(*) from public.venue_hold_notifications where hold_id = current_setting('holds.expiry_rollback')::bigint and kind = 'expired') <> 1
  then raise exception '[SG2-85:expiry-notice-retry-commits-once] [NORMAL] [SG2-85:AC1] [SG2-85:AC4] [SG2-85:AC5] Retried expiry did not commit hold, request, System history and notification exactly once'; end if;
end;
$$;
-- Warning delivery and its once-only marker share the same transaction.
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.create_venue_hold(98401,98401,now()+interval '52 days',now()+interval '53 days',clock_timestamp()+interval '4 days');
 if result->>'outcome' <> 'created' then raise exception '[SG2-85:warning-rollback-hold-fixture] [NORMAL] [SG2-85:AC4] Hold required for warning rollback was not created'; end if;
 perform set_config('holds.warning_rollback',result#>>'{hold,hold_id}',true);
end;
$$;
reset role;
update public.venue_holds set expires_at = clock_timestamp()+interval '2 days' where hold_id = current_setting('holds.warning_rollback')::bigint;
create function pg_temp.reject_warning_notice() returns trigger language plpgsql as $$
begin
 if new.kind = 'warning' and new.hold_id = current_setting('holds.warning_rollback')::bigint then
  raise exception using errcode = 'P0001',message = '[SG2-85:warning-notice-failure-injection] [FAILURE] [SG2-85:AC4] injected_warning_notice_failure';
 end if;
 return new;
end;
$$;
create trigger reject_warning_notice before insert on public.venue_hold_notifications for each row execute function pg_temp.reject_warning_notice();
do $$
begin
 begin
  perform public.process_venue_hold_deadlines();
  raise exception '[SG2-85:warning-notice-failure-expected] [FAILURE] [SG2-85:AC4] Expected injected warning notification failure';
 exception when raise_exception then
  if sqlerrm not like '%injected_warning_notice_failure' then raise; end if;
 end;
 if (select warning_sent_at from public.venue_holds where hold_id = current_setting('holds.warning_rollback')::bigint) is not null
  or exists(select 1 from public.venue_hold_notifications where hold_id = current_setting('holds.warning_rollback')::bigint and kind = 'warning')
  then raise exception '[SG2-85:warning-notice-failure-rolls-back-marker] [FAILURE] [SG2-85:AC4] Failed warning delivery left its sent marker or notification behind'; end if;
end;
$$;
drop trigger reject_warning_notice on public.venue_hold_notifications;
do $$
begin
 perform public.process_venue_hold_deadlines(); perform public.process_venue_hold_deadlines();
 if (select warning_sent_at from public.venue_holds where hold_id = current_setting('holds.warning_rollback')::bigint) is null
  or (select count(*) from public.venue_hold_notifications where hold_id = current_setting('holds.warning_rollback')::bigint and kind = 'warning') <> 1
  then raise exception '[SG2-85:warning-notice-retry-records-once] [NORMAL] [SG2-85:AC4] Retried warning failed to set its marker or was delivered more than once'; end if;
end;
$$;
rollback;
