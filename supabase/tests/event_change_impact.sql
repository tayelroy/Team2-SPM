-- SG2-66 apply_accepted_event_change / settle_arrangement_recheck contract,
-- with isolated fixture changes rolled back.
begin;
-- Audit values of timestamps are rendered in the session time zone.
set local timezone to 'UTC';
insert into auth.users(id)
 select ('d6600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.users(user_id,name,role_id) values
 ('d6600000-0000-4000-8000-000000000001','Change organiser',1),
 ('d6600000-0000-4000-8000-000000000002','Change coordinator',2),
 ('d6600000-0000-4000-8000-000000000003','Other change coordinator',2);
insert into public.account_roles(user_id,role) values
 ('d6600000-0000-4000-8000-000000000001','event_organiser'),
 ('d6600000-0000-4000-8000-000000000002','event_coordinator'),
 ('d6600000-0000-4000-8000-000000000003','event_coordinator');
insert into public.events(event_id,organiser_id,coordinator_id,name,purpose,description,status,proposed_date,
  expected_attendance,venue_requirements,registration_needed)
 select 96600+n,'d6600000-0000-4000-8000-000000000001','d6600000-0000-4000-8000-000000000002',
  'Change event '||n,'Original purpose','Original agenda','planning','2031-11-01T09:00Z',120,'A stage',false
 from generate_series(1,12) n;
-- 96601 is Confirmed with an earlier outstanding recheck still recorded.
update public.events set name='Change Gala',status='confirmed',confirmed_by='d6600000-0000-4000-8000-000000000002',
 confirmed_at='2031-10-01T00:00Z',arrangements_recheck_needed=true,outstanding_arrangements='["equipment_recheck"]'
 where event_id=96601;
update public.events set status='approved' where event_id=96603;
update public.events set status='confirmed',confirmed_by='d6600000-0000-4000-8000-000000000002',
 confirmed_at='2031-10-01T00:00Z' where event_id in (96604,96606);
update public.events set status='awaiting_safety_check' where event_id=96607;
update public.events set status='preparation' where event_id=96608;
-- 96605: no name, coordinated by the other coordinator. (SG2-104: an event's
-- organiser can no longer be its coordinator, so each gets their own notice.)
update public.events set name='',status='confirmed',coordinator_id='d6600000-0000-4000-8000-000000000003',
 confirmed_by='d6600000-0000-4000-8000-000000000003',confirmed_at='2031-10-01T00:00Z' where event_id=96605;
update public.events set arrangements_recheck_needed=true,outstanding_arrangements='["venue_recheck","equipment_recheck"]'
 where event_id=96610;

set local role service_role;
do $$
declare result jsonb;
begin
 result := public.apply_accepted_event_change(96601,'d6600000-0000-4000-8000-000000000002','confirmed',
  'change request mock-96601-attendance','{"expected_attendance":180,"description":"New agenda"}',
  '["venue_recheck","equipment_recheck","registration_recheck"]');
 if result is distinct from '{"outcome":"ok","previous_status":"confirmed","status":"planning","returned_to_planning":true,
   "arrangements_recheck_needed":true,"outstanding_arrangements":["equipment_recheck","venue_recheck","registration_recheck"]}'::jsonb then
  raise exception '[SG2-66:accept-confirmed-returns] [SG2-66:AC4] [NORMAL] Accepting a change with affected arrangements must return a Confirmed event to Planning: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text||'|'||coalesce(confirmed_by::text,'null')||'|'||coalesce(confirmed_at::text,'null')||'|'
     ||expected_attendance||'|'||description||'|'||arrangements_recheck_needed||'|'||outstanding_arrangements::text
     from public.events where event_id=96601)
   is distinct from 'planning|null|null|180|New agenda|true|["equipment_recheck", "venue_recheck", "registration_recheck"]' then
  raise exception '[SG2-66:accept-confirmed-stored] [SG2-66:AC4] [NORMAL] The change, cleared confirmation and outstanding union must be stored';
 end if;
 if (select string_agg(actor_id::text||'|'||field_name||'|'||coalesce(old_value,'null')||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=96601)
   is distinct from 'd6600000-0000-4000-8000-000000000002|expected_attendance|120|180'
     ||' ; d6600000-0000-4000-8000-000000000002|description|Original agenda|New agenda'
     ||' ; d6600000-0000-4000-8000-000000000002|change_request|null|Accepted change request mock-96601-attendance'
     ||' ; d6600000-0000-4000-8000-000000000002|status|confirmed|planning' then
  raise exception '[SG2-66:accept-history] [SG2-66:AC7] [NORMAL] Each changed field, the accepted request and the move to Planning must be in the history';
 end if;
 if (select string_agg(recipient_id::text||'|'||kind||'|'||message||'|'||coalesce(request_id::text,'null'), ' ; ' order by notification_id)
     from public.notifications where event_id=96601)
   is distinct from 'd6600000-0000-4000-8000-000000000001|event_returned_to_planning|Change Gala has moved back to Planning. '
     ||'Its arrangements are being rechecked before it can be confirmed again.|null'
     ||' ; d6600000-0000-4000-8000-000000000002|event_returned_to_planning|Change Gala is back in Planning. '
     ||'Recheck its outstanding arrangements before it goes through the safety check again.|null' then
  raise exception '[SG2-66:returned-notices] [SG2-66:AC7] [NORMAL] The organiser and the coordinator must each get one exact back-to-Planning notice';
 end if;
end $$;

-- Each later stage returns to Planning too; Planning itself stays.
set local role service_role;
do $$
declare result jsonb; state text; target integer;
begin
 foreach target in array array[96607,96608] loop
  state := (select status::text from public.events where event_id=target);
  result := public.apply_accepted_event_change(target,'d6600000-0000-4000-8000-000000000002',state::public.event_status,
   'change request x','{"proposed_date":"2031-11-08T09:00:00Z"}','["venue_recheck"]');
  if result->>'status' is distinct from 'planning' or (result->>'returned_to_planning')::boolean is not true then
   raise exception '[SG2-66:later-stage-returns] [SG2-66:AC4] [NORMAL] An event % must return to Planning: %',state,result;
  end if;
 end loop;
 result := public.apply_accepted_event_change(96602,'d6600000-0000-4000-8000-000000000002','planning',
  'change request mock-96602-date','{"proposed_date":"2031-11-08T09:00:00Z"}','["venue_recheck","equipment_recheck"]');
 if result is distinct from '{"outcome":"ok","previous_status":"planning","status":"planning","returned_to_planning":false,
   "arrangements_recheck_needed":true,"outstanding_arrangements":["venue_recheck","equipment_recheck"]}'::jsonb then
  raise exception '[SG2-66:accept-planning-stays] [SG2-66:AC4] [BOUNDARY] A Planning event must stay in Planning: %', result;
 end if;
 result := public.apply_accepted_event_change(96603,'d6600000-0000-4000-8000-000000000002','approved',
  'change request mock-96603-attendance','{"expected_attendance":200}','["venue_recheck"]');
 if result->>'status' is distinct from 'planning' or (result->>'returned_to_planning')::boolean is not false then
  raise exception '[SG2-66:accept-approved-progresses] [SG2-66:AC4] [BOUNDARY] An Approved event moves on to Planning without a back-to-Planning notice: %', result;
 end if;
 result := public.apply_accepted_event_change(96604,'d6600000-0000-4000-8000-000000000002','confirmed',
  'change request mock-96604-description','{"description":"Wording only"}','[]');
 if result is distinct from '{"outcome":"ok","previous_status":"confirmed","status":"confirmed","returned_to_planning":false,
   "arrangements_recheck_needed":false,"outstanding_arrangements":[]}'::jsonb then
  raise exception '[SG2-66:nothing-affected-stays] [SG2-66:AC4] [BOUNDARY] A change affecting no arrangement must leave a Confirmed event confirmed: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select proposed_date from public.events where event_id=96602) is distinct from '2031-11-08T09:00Z'::timestamptz
   or (select string_agg(field_name||'|'||old_value||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=96602 and field_name <> 'change_request')
     is distinct from 'proposed_date|2031-11-01T09:00:00+00:00|2031-11-08T09:00:00Z' then
  raise exception '[SG2-66:date-change-audited] [SG2-66:AC3] [NORMAL] A new date must be stored and audited, with no status row for Planning';
 end if;
 if exists(select 1 from public.notifications where event_id in (96602,96603,96604)) then
  raise exception '[SG2-66:no-notice-unless-returned] [SG2-66:AC7] [BOUNDARY] Only a move back to Planning may notify';
 end if;
 if (select string_agg(field_name||'|'||old_value||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=96603 and field_name='status') is distinct from 'status|approved|planning' then
  raise exception '[SG2-66:approved-move-audited] [SG2-66:AC4] [NORMAL] Approved to Planning must be in the history';
 end if;
 if (select status::text||'|'||confirmed_by::text||'|'||arrangements_recheck_needed from public.events where event_id=96604)
     is distinct from 'confirmed|d6600000-0000-4000-8000-000000000002|false'
   or (select count(*) from public.event_audit_logs where event_id=96604) <> 2 then
  raise exception '[SG2-66:nothing-affected-recorded] [SG2-66:AC4] [BOUNDARY] An unaffecting change keeps the confirmation and records only the field and the request';
 end if;
end $$;

-- Untitled events: the organiser and the coordinator are each told once.
set local role service_role;
do $$ begin
 perform public.apply_accepted_event_change(96605,'d6600000-0000-4000-8000-000000000003','confirmed',
  'change request y','{"expected_attendance":300}','["venue_recheck"]');
end $$;
reset role;
do $$
begin
 if (select count(*) from public.notifications where event_id=96605) <> 2
   or (select message from public.notifications where event_id=96605 and recipient_id='d6600000-0000-4000-8000-000000000001')
     is distinct from 'Untitled event has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.'
   or (select message from public.notifications where event_id=96605 and recipient_id='d6600000-0000-4000-8000-000000000003')
     is distinct from 'Untitled event is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.' then
  raise exception '[SG2-66:untitled-single-notice] [SG2-66:AC7] [SG2-104:AC2] [BOUNDARY] A blank name reads Untitled event, and the organiser and coordinator each get exactly one notice';
 end if;
end $$;

-- Whitelist: only changeable fields are applied; unknown recheck keys are dropped.
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.apply_accepted_event_change(96606,'d6600000-0000-4000-8000-000000000002','confirmed','change request z',
  '{"name":"Renamed","status":"draft","organiser_id":"d6600000-0000-4000-8000-000000000003","coordinator_id":null,"registration_needed":true,"confirmed_at":null}',
  '["safety_recheck"]');
 if result is distinct from '{"outcome":"ok","previous_status":"confirmed","status":"confirmed","returned_to_planning":false,
   "arrangements_recheck_needed":false,"outstanding_arrangements":[]}'::jsonb then
  raise exception '[SG2-66:whitelist-result] [SG2-66:AC4] [FAILURE] Unknown recheck keys must be ignored: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select name||'|'||status::text||'|'||organiser_id::text||'|'||coordinator_id::text||'|'||registration_needed||'|'||(confirmed_at is not null)
     from public.events where event_id=96606)
   is distinct from 'Renamed|confirmed|d6600000-0000-4000-8000-000000000001|d6600000-0000-4000-8000-000000000002|false|true' then
  raise exception '[SG2-66:whitelist-only] [SG2-66:AC4] [FAILURE] Keys outside the changeable fields must be ignored';
 end if;
end $$;

-- Stale: status or assignment changed after the server read them, or no event.
set local role service_role;
do $$
begin
 if public.apply_accepted_event_change(96609,'d6600000-0000-4000-8000-000000000002','confirmed','r','{"expected_attendance":500}','["venue_recheck"]')
     is distinct from '{"outcome":"stale"}'::jsonb
   or public.apply_accepted_event_change(96609,'d6600000-0000-4000-8000-000000000003','planning','r','{"expected_attendance":500}','["venue_recheck"]')
     is distinct from '{"outcome":"stale"}'::jsonb
   or public.apply_accepted_event_change(96609,null,'planning','r','{"expected_attendance":500}','["venue_recheck"]')
     is distinct from '{"outcome":"stale"}'::jsonb
   or public.apply_accepted_event_change(999999,'d6600000-0000-4000-8000-000000000002','planning','r','{}','[]')
     is distinct from '{"outcome":"stale"}'::jsonb then
  raise exception '[SG2-66:accept-stale] [SG2-66:AC4] [CONFLICT] A changed status, another coordinator or a missing event must be stale';
 end if;
end $$;
reset role;
do $$
begin
 if (select expected_attendance||'|'||arrangements_recheck_needed from public.events where event_id=96609) is distinct from '120|false'
   or exists(select 1 from public.event_audit_logs where event_id=96609)
   or exists(select 1 from public.notifications where event_id=96609) then
  raise exception '[SG2-66:stale-no-writes] [SG2-66:AC4] [CONFLICT] A stale acceptance must write nothing';
 end if;
end $$;

-- Settling: one key at a time, the last one clears the flag.
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.settle_arrangement_recheck(96610,'d6600000-0000-4000-8000-000000000002','venue_recheck');
 if result is distinct from '{"outcome":"ok","arrangements_recheck_needed":true,"outstanding_arrangements":["equipment_recheck"]}'::jsonb then
  raise exception '[SG2-66:settle-one] [SG2-66:AC4] [NORMAL] Settling one recheck must leave the rest outstanding: %', result;
 end if;
 if public.settle_arrangement_recheck(96610,'d6600000-0000-4000-8000-000000000002','venue_recheck')
     is distinct from '{"outcome":"not_outstanding"}'::jsonb
   or public.settle_arrangement_recheck(96610,'d6600000-0000-4000-8000-000000000002',null)
     is distinct from '{"outcome":"not_outstanding"}'::jsonb then
  raise exception '[SG2-66:settle-not-outstanding] [SG2-66:AC4] [CONFLICT] A recheck that is not outstanding must be refused';
 end if;
 if public.settle_arrangement_recheck(96610,'d6600000-0000-4000-8000-000000000003','equipment_recheck')
     is distinct from '{"outcome":"stale"}'::jsonb
   or public.settle_arrangement_recheck(999999,'d6600000-0000-4000-8000-000000000002','equipment_recheck')
     is distinct from '{"outcome":"stale"}'::jsonb then
  raise exception '[SG2-66:settle-stale] [SG2-66:AC4] [FAILURE] Another coordinator or a missing event must be stale';
 end if;
 result := public.settle_arrangement_recheck(96610,'d6600000-0000-4000-8000-000000000002','equipment_recheck');
 if result is distinct from '{"outcome":"ok","arrangements_recheck_needed":false,"outstanding_arrangements":[]}'::jsonb then
  raise exception '[SG2-66:settle-last] [SG2-66:AC4] [BOUNDARY] Settling the last recheck must clear the flag: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select arrangements_recheck_needed||'|'||outstanding_arrangements::text from public.events where event_id=96610)
     is distinct from 'false|[]'
   or (select string_agg(actor_id::text||'|'||field_name||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=96610)
     is distinct from 'd6600000-0000-4000-8000-000000000002|arrangement_recheck|venue_recheck settled'
       ||' ; d6600000-0000-4000-8000-000000000002|arrangement_recheck|equipment_recheck settled' then
  raise exception '[SG2-66:settle-recorded] [SG2-66:AC4] [NORMAL] Each settled recheck must be stored and in the history';
 end if;
end $$;

-- Only the server's service role may call either function.
do $$
declare client text;
begin
 foreach client in array array['anon','authenticated'] loop
  execute format('set local role %I', client);
  perform set_config('request.jwt.claim.sub','d6600000-0000-4000-8000-000000000002',true);
  begin
   perform public.apply_accepted_event_change(96611,'d6600000-0000-4000-8000-000000000002','planning','r','{}','["venue_recheck"]');
   raise exception '[SG2-66:accept-server-only] [SG2-66:AC4] [FAILURE] % must not accept a change directly',client;
  exception when insufficient_privilege then null; end;
  begin
   perform public.settle_arrangement_recheck(96611,'d6600000-0000-4000-8000-000000000002','venue_recheck');
   raise exception '[SG2-66:settle-server-only] [SG2-66:AC4] [FAILURE] % must not settle a recheck directly',client;
  exception when insufficient_privilege then null; end;
  reset role;
 end loop;
end $$;
do $$
begin
 if (select status::text||'|'||arrangements_recheck_needed from public.events where event_id=96611) is distinct from 'planning|false' then
  raise exception '[SG2-66:client-calls-no-writes] [SG2-66:AC4] [FAILURE] A refused client call must write nothing';
 end if;
 if not exists(select 1 from pg_constraint where conname='notifications_kind_check'
     and pg_get_constraintdef(oid) like '%event_returned_to_planning%') then
  raise exception '[SG2-66:notice-kind-allowed] [SG2-66:AC7] [NORMAL] The back-to-Planning notice kind must be allowed';
 end if;
end $$;
rollback;
