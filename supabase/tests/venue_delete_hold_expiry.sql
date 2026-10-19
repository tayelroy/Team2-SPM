-- SG2-106: venue delete and hold expiry change. Disposable PostgreSQL only;
-- every fixture is rolled back.
begin;
insert into auth.users(id) values
 ('d8600000-0000-4000-8000-000000000001'),('d8600000-0000-4000-8000-000000000002'),
 ('d8600000-0000-4000-8000-000000000003'),('d8600000-0000-4000-8000-000000000004');
insert into public.users(user_id,name,role_id) values
 ('d8600000-0000-4000-8000-000000000001','Delete staff',3),
 ('d8600000-0000-4000-8000-000000000002','Delete coordinator',2),
 ('d8600000-0000-4000-8000-000000000003','Delete organiser',1),
 ('d8600000-0000-4000-8000-000000000004','Delete support',4);
insert into public.account_roles(user_id,role) values
 ('d8600000-0000-4000-8000-000000000001','venue_staff'),
 ('d8600000-0000-4000-8000-000000000002','event_coordinator'),
 ('d8600000-0000-4000-8000-000000000003','event_organiser'),
 ('d8600000-0000-4000-8000-000000000004','technical_support_staff');
insert into public.venues(venue_id,name,capacity,facilities) values
 (98601,'Busy Hall',100,null),(98602,'Unused Room',40,null),(98603,'Old Studio',40,null),(98604,'Hold Room',40,null);
insert into public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance) values
 (98601,'d8600000-0000-4000-8000-000000000003','d8600000-0000-4000-8000-000000000002','Delete event','planning',30),
 (98602,'d8600000-0000-4000-8000-000000000003','d8600000-0000-4000-8000-000000000002','Past event','planning',30);
-- Busy Hall: a future confirmed booking and a pending request.
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
 (98601,98601,now()+interval '20 days',now()+interval '20 days 2 hours','confirmed');
insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status) values
 (98601,98601,now()+interval '25 days',now()+interval '25 days 2 hours','pending');
-- Old Studio: only a finished booking, which must keep its venue name.
alter table public.venue_bookings disable trigger user;
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
 (98603,98602,now()-interval '5 days',now()-interval '5 days'+interval '2 hours','confirmed');
alter table public.venue_bookings enable trigger user;

set local role authenticated;
select set_config('request.jwt.claim.sub','d8600000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb; hold bigint; expiry timestamptz := clock_timestamp() + interval '2 days';
begin
 result := public.create_venue_hold(98601,98601,now()+interval '30 days',now()+interval '30 days 2 hours',expiry);
 if result->>'outcome' is distinct from 'created' then raise exception '[SG2-106:hold-fixture] [NORMAL] [SG2-106:AC1] hold fixture failed: %',result; end if;
 perform set_config('sg2106.busy_hold',result#>>'{hold,hold_id}',true);
 -- AC1: every live booking, hold and pending request is listed, and nothing is deleted.
 result := public.delete_venue(98601);
 if result->>'outcome' is distinct from 'blocked'
   or (select array_agg(item->>'kind' order by item->>'kind') from jsonb_array_elements(result->'blockers') item) is distinct from array['booking','hold','request']
   or exists(select 1 from jsonb_array_elements(result->'blockers') item where item->>'event_name' is distinct from 'Delete event' or item->>'starts_at' is null)
   then raise exception '[SG2-106:blockers-listed] [CONFLICT] [SG2-106:AC1] delete with live work must be refused and list it: %',result; end if;
 if exists(select 1 from public.venues where venue_id = 98601 and deleted_at is not null) then
   raise exception '[SG2-106:blocked-venue-kept] [CONFLICT] [SG2-106:AC1] a refused delete must leave the venue in place'; end if;
 -- AC1/AC5: an unused venue is deleted and records who and when.
 result := public.delete_venue(98602);
 if result->>'outcome' is distinct from 'deleted' or result#>>'{venue,deleted_by}' is distinct from 'd8600000-0000-4000-8000-000000000001'
   or (result#>>'{venue,deleted_at}') is null then raise exception '[SG2-106:unused-deleted] [NORMAL] [SG2-106:AC1] [SG2-106:AC5] unused venue delete failed: %',result; end if;
 -- AC1 boundary: finished bookings do not block.
 if public.delete_venue(98603)->>'outcome' is distinct from 'deleted' then
   raise exception '[SG2-106:past-work-allowed] [BOUNDARY] [SG2-106:AC1] past bookings must not block a delete'; end if;
 if public.delete_venue(98602)->>'outcome' is distinct from 'missing' or public.delete_venue(-1)->>'outcome' is distinct from 'missing' then
   raise exception '[SG2-106:repeat-delete-missing] [FAILURE] [SG2-106:AC1] deleting twice or an unknown venue must report missing'; end if;
 -- AC2: a deleted venue is not offered and cannot take a hold.
 if exists(select 1 from jsonb_array_elements(public.venue_hold_options()->'venues') v where (v->>'venue_id')::integer in (98602,98603)) then
   raise exception '[SG2-106:options-hide-deleted] [NORMAL] [SG2-106:AC2] deleted venues must not be offered for holds'; end if;
 if public.create_venue_hold(98601,98602,now()+interval '40 days',now()+interval '40 days 2 hours',expiry)->>'outcome' is distinct from 'missing' then
   raise exception '[SG2-106:hold-refused] [FAILURE] [SG2-106:AC2] a deleted venue must not take a hold'; end if;
end;
$$;

-- AC2: direct writes for a deleted venue are refused; history keeps the name.
reset role;
do $$
begin
 begin
   insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at) values(98601,98602,now()+interval '41 days',now()+interval '41 days 1 hour');
   raise exception '[SG2-106:request-refused] [FAILURE] [SG2-106:AC2] a deleted venue accepted a booking request';
 exception when check_violation then null;
 end;
 begin
   insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values(98602,98601,now()+interval '41 days',now()+interval '41 days 1 hour','confirmed');
   raise exception '[SG2-106:booking-refused] [FAILURE] [SG2-106:AC2] a deleted venue accepted a booking';
 exception when check_violation then null;
 end;
 begin
   update public.venues set name = 'Renamed' where venue_id = 98602;
   raise exception '[SG2-106:deleted-read-only] [FAILURE] [SG2-106:AC2] a deleted venue was edited';
 exception when check_violation then null;
 end;
 if (select v.name from public.venue_bookings b join public.venues v using (venue_id) where b.venue_id = 98603) is distinct from 'Old Studio' then
   raise exception '[SG2-106:history-name] [NORMAL] [SG2-106:AC2] past bookings must keep the deleted venue name'; end if;
end;
$$;

-- AC5: the service role can write the delete columns, but even it cannot
-- delete outside delete_venue(), including with a session flag set.
set local role service_role;
select set_config('app.venue_delete','on',true);
do $$
begin
 begin
   update public.venues set deleted_at = now(), deleted_by = 'd8600000-0000-4000-8000-000000000001' where venue_id = 98604;
   raise exception '[SG2-106:direct-delete-refused] [FAILURE] [SG2-106:AC5] deleting outside delete_venue() must be refused, whatever session settings are set';
 exception when insufficient_privilege then null;
 end;
end;
$$;
reset role;

-- AC5: only Venue Staff can delete or change an expiry.
set local role authenticated;
select set_config('request.jwt.claim.sub','d8600000-0000-4000-8000-000000000002',true);
do $$
begin
 begin perform public.delete_venue(98604); raise exception '[SG2-106:coordinator-delete] [FAILURE] [SG2-106:AC5] a coordinator deleted a venue';
 exception when insufficient_privilege then null; end;
 begin perform public.change_venue_hold_expiry(current_setting('sg2106.busy_hold')::bigint, now()+interval '5 days');
   raise exception '[SG2-106:coordinator-expiry] [FAILURE] [SG2-106:AC5] a coordinator changed a hold expiry';
 exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub','d8600000-0000-4000-8000-000000000004',true);
do $$
begin
 begin perform public.delete_venue(98604); raise exception '[SG2-106:support-delete] [FAILURE] [SG2-106:AC5] technical support deleted a venue';
 exception when insufficient_privilege then null; end;
end;
$$;

-- AC3/AC4/AC5: expiry changes.
select set_config('request.jwt.claim.sub','d8600000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb; hold bigint; soon bigint; later timestamptz := date_trunc('second', clock_timestamp()) + interval '5 days'; before timestamptz;
begin
 hold := current_setting('sg2106.busy_hold')::bigint;
 select expires_at into before from public.venue_holds where hold_id = hold;
 result := public.change_venue_hold_expiry(hold, later);
 if result->>'outcome' is distinct from 'updated' or (result#>>'{hold,expires_at}')::timestamptz is distinct from later
   or (result#>>'{hold,status}') is distinct from 'tentative' then raise exception '[SG2-106:expiry-changed] [NORMAL] [SG2-106:AC3] expiry change failed: %',result; end if;
 if not exists(select 1 from public.event_audit_logs where event_id = 98601 and field_name = 'venue_hold_expiry'
     and actor_id = 'd8600000-0000-4000-8000-000000000001' and old_value like '%' || to_char(before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
     and new_value like '%' || to_char(later at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') and created_at is not null) then
   raise exception '[SG2-106:expiry-audited] [NORMAL] [SG2-106:AC5] expiry change must record who, when, old and new'; end if;
 perform set_config('sg2106.later',later::text,true);
 -- AC3 boundary/failure: the new time must be a different future time.
 if public.change_venue_hold_expiry(hold, later)->>'outcome' is distinct from 'invalid'
   or public.change_venue_hold_expiry(hold, clock_timestamp())->>'outcome' is distinct from 'invalid'
   or public.change_venue_hold_expiry(hold, now()-interval '1 day')->>'outcome' is distinct from 'invalid'
   or public.change_venue_hold_expiry(hold, null)->>'outcome' is distinct from 'invalid'
   or public.change_venue_hold_expiry(hold, 'infinity')->>'outcome' is distinct from 'invalid'
   then raise exception '[SG2-106:expiry-invalid] [BOUNDARY] [SG2-106:AC3] same, past, missing or infinite expiry accepted'; end if;
 if public.change_venue_hold_expiry(-1, later)->>'outcome' is distinct from 'missing' then
   raise exception '[SG2-106:expiry-missing] [FAILURE] [SG2-106:AC3] an unknown hold must report missing'; end if;
 -- AC4: a hold inside the warning window, moved out of it, warns again for its new time.
 result := public.create_venue_hold(98601,98604,now()+interval '50 days',now()+interval '50 days 2 hours',clock_timestamp()+interval '2 hours');
 soon := (result#>>'{hold,hold_id}')::bigint;
 if (select warning_sent_at from public.venue_holds where hold_id = soon) is null then
   raise exception '[SG2-106:warning-fixture] [NORMAL] [SG2-106:AC4] warning fixture did not warn'; end if;
 perform public.change_venue_hold_expiry(soon, clock_timestamp()+interval '3 days');
 if (select warning_sent_at from public.venue_holds where hold_id = soon) is not null then
   raise exception '[SG2-106:warning-reset] [BOUNDARY] [SG2-106:AC4] the warning must follow the new expiry, not the old one'; end if;
 perform public.change_venue_hold_expiry(soon, clock_timestamp()+interval '3 hours');
 perform set_config('sg2106.soon',soon::text,true);
 -- AC3: released, converted or expired holds cannot be changed.
 perform public.change_venue_hold(soon,'release');
 if public.change_venue_hold_expiry(soon, later)->>'outcome' is distinct from 'inactive' then
   raise exception '[SG2-106:released-locked] [FAILURE] [SG2-106:AC3] a released hold expiry changed'; end if;
end;
$$;

-- AC4: notices are checked as the database owner; RLS shows each
-- recipient only their own.
reset role;
do $$
declare hold bigint := current_setting('sg2106.busy_hold')::bigint; soon bigint := current_setting('sg2106.soon')::bigint;
  later timestamptz := current_setting('sg2106.later')::timestamptz;
begin
 if not exists(select 1 from public.venue_hold_notifications where hold_id = hold and kind = 'expiry_changed'
     and recipient_id = 'd8600000-0000-4000-8000-000000000002' and message like '%' || to_char(later at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') || '%') then
   raise exception '[SG2-106:coordinator-told] [NORMAL] [SG2-106:AC4] the coordinator was not notified of the new expiry'; end if;
 if (select count(*) from public.venue_hold_notifications where hold_id = soon and kind = 'warning') <> 2
   or (select count(*) from public.venue_hold_notifications where hold_id = soon and kind = 'expiry_changed') <> 2 then
   raise exception '[SG2-106:warning-new-time] [BOUNDARY] [SG2-106:AC4] each new expiry needs its own notice and warning'; end if;
end;
$$;

-- AC3: a hold already past its deadline is expired, not extended.
update public.venue_holds set expires_at = clock_timestamp() - interval '1 second', created_at = clock_timestamp() - interval '1 day'
  where hold_id = current_setting('sg2106.busy_hold')::bigint;
set local role authenticated;
do $$
declare hold bigint := current_setting('sg2106.busy_hold')::bigint;
begin
 if public.change_venue_hold_expiry(hold, now()+interval '9 days')->>'outcome' is distinct from 'inactive' then
   raise exception '[SG2-106:expired-refused] [FAILURE] [SG2-106:AC3] an expired hold expiry changed'; end if;
 -- A separate statement, so it sees the transition the call just made.
 if (select status from public.venue_holds where hold_id = hold) is distinct from 'expired' then
   raise exception '[SG2-106:expired-locked] [FAILURE] [SG2-106:AC3] an expired hold must stay expired'; end if;
end;
$$;

-- Past reserved periods do not become current work just because the hold's
-- expiry is later. Seed the state left by ordinary passage of time, without
-- sleeps or changing clocks; ends_at = transaction start is the end boundary.
reset role;
insert into public.venues(venue_id,name,capacity) values
 (98605,'Past Hold Hall',40),(98606,'Ended Hold Hall',40),
 (98607,'Current Hold Hall',40),(98608,'Future Hold Hall',40);
insert into public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance) values
 (98603,'d8600000-0000-4000-8000-000000000003','d8600000-0000-4000-8000-000000000002','Hold period event','planning',30);
with periods(venue_id,starts_at,ends_at) as (values
 (98605,now()-interval '2 hours',now()-interval '1 hour'),
 (98606,now()-interval '1 hour',now()),
 (98607,now()-interval '1 hour',now()+interval '1 hour'),
 (98607,now()-interval '6 hours',now()-interval '5 hours'),
 (98608,now()+interval '1 day',now()+interval '1 day 1 hour')
), requests as (
 insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at)
 select 98603,venue_id,starts_at,ends_at from periods returning *
)
insert into public.venue_holds(event_id,venue_id,request_id,starts_at,ends_at,expires_at,created_by,created_at)
select event_id,venue_id,request_id,starts_at,ends_at,now()+interval '5 days',
 'd8600000-0000-4000-8000-000000000001',now()-interval '2 days' from requests;
insert into public.event_audit_logs(event_id,actor_id,field_name,old_value,new_value)
select event_id,created_by,'venue_hold_status',null,'Tentative hold ' || hold_id || '; expires ' || expires_at
 from public.venue_holds where event_id = 98603;
select public.venue_hold_notice(h,'placed') from public.venue_holds h where event_id = 98603;
do $$
begin
perform set_config('sg2106.past_records',jsonb_build_object(
 'holds',(select jsonb_agg(to_jsonb(h) order by hold_id) from public.venue_holds h where event_id = 98603),
 'requests',(select jsonb_agg(to_jsonb(r) order by request_id) from public.venue_booking_requests r where event_id = 98603),
 'notices',(select jsonb_agg(to_jsonb(n) order by notification_id) from public.venue_hold_notifications n where event_id = 98603),
 'audit',(select jsonb_agg(to_jsonb(a) order by log_id) from public.event_audit_logs a where event_id = 98603)
)::text,true);
end;
$$;

set local role authenticated;
do $$
declare result jsonb; venue integer; current_hold bigint;
begin
 result := public.delete_venue(98605);
 if result->>'outcome' is distinct from 'deleted' then
   raise exception '[SG2-106:past-hold-period-allowed] [NORMAL] [SG2-106:AC1] a finished hold period must not block deletion even when its expiry is still future: %',result; end if;
 result := public.delete_venue(98606);
 if result->>'outcome' is distinct from 'deleted' then
   raise exception '[SG2-106:ended-hold-boundary] [BOUNDARY] [SG2-106:AC1] a hold ending at the transaction boundary must not block deletion: %',result; end if;
 -- Current/future periods remain blockers. The current venue also has a past
 -- hold; only its current hold belongs in the refusal, not the past one.
 for venue in select unnest(array[98607,98608]) loop
   select hold_id into current_hold from public.venue_holds
     where venue_id = venue and ends_at > clock_timestamp();
   result := public.delete_venue(venue);
   if result->>'outcome' is distinct from 'blocked' or jsonb_array_length(result->'blockers') is distinct from 1
     or result#>>'{blockers,0,kind}' is distinct from 'hold'
     or (result#>>'{blockers,0,id}')::bigint is distinct from current_hold
     or result#>>'{blockers,0,event_name}' is distinct from 'Hold period event'
     or exists(select 1 from public.venues where venue_id = venue and deleted_at is not null) then
     raise exception '[SG2-106:current-future-hold-period-refused] [FAILURE] [SG2-106:AC1] current or future hold periods must still be listed and keep venue % undeleted: %',venue,result; end if;
 end loop;
end;
$$;
reset role;
do $$
declare records jsonb;
begin
 select jsonb_build_object(
   'holds',(select jsonb_agg(to_jsonb(h) order by hold_id) from public.venue_holds h where event_id = 98603),
   'requests',(select jsonb_agg(to_jsonb(r) order by request_id) from public.venue_booking_requests r where event_id = 98603),
   'notices',(select jsonb_agg(to_jsonb(n) order by notification_id) from public.venue_hold_notifications n where event_id = 98603),
   'audit',(select jsonb_agg(to_jsonb(a) order by log_id) from public.event_audit_logs a where event_id = 98603)
 ) into records;
 if records is distinct from current_setting('sg2106.past_records')::jsonb
   or exists(select 1 from public.venues where venue_id in (98605,98606)
     and (deleted_at is null or deleted_by is distinct from 'd8600000-0000-4000-8000-000000000001'::uuid))
   or (select array_agg(v.name::text order by v.venue_id) from public.venues v join public.venue_holds h using (venue_id)
     where h.event_id = 98603 and v.venue_id in (98605,98606)) is distinct from array['Past Hold Hall','Ended Hold Hall'] then
   raise exception '[SG2-106:past-hold-history-retained] [NORMAL] [SG2-106:AC2] [SG2-106:AC5] deletion must retain complete holds, requests, notices, event history and venue names, and record the deleting actor and time'; end if;
end;
$$;
rollback;
