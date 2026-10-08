-- SG2-53: disposable PostgreSQL public-RPC and storage contracts.
-- All synthetic data and permission changes are rolled back.
begin;
insert into auth.users(id)
  select ('d5300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,8) n;
insert into public.users(user_id,name,role_id) values
 ('d5300000-0000-4000-8000-000000000001','Requirements coordinator',2),
 ('d5300000-0000-4000-8000-000000000002','Other coordinator',2),
 ('d5300000-0000-4000-8000-000000000003','Requirements support',4),
 ('d5300000-0000-4000-8000-000000000004','Requirements safety',7),
 ('d5300000-0000-4000-8000-000000000005','Requirements organiser',1);
insert into public.account_roles(user_id,role) values
 ('d5300000-0000-4000-8000-000000000001','event_coordinator'),
 ('d5300000-0000-4000-8000-000000000002','event_coordinator'),
 ('d5300000-0000-4000-8000-000000000003','technical_support_staff'),
 ('d5300000-0000-4000-8000-000000000004','safety_officer'),
 ('d5300000-0000-4000-8000-000000000005','event_organiser'),
 ('d5300000-0000-4000-8000-000000000006','attendee'),
 ('d5300000-0000-4000-8000-000000000007','event_coordinator_lead');
insert into public.events(event_id,organiser_id,coordinator_id,name,status,proposed_date) values
 (95301,'d5300000-0000-4000-8000-000000000005','d5300000-0000-4000-8000-000000000001','Equipment forum','approved','2030-10-01T09:00Z'),
 (95302,'d5300000-0000-4000-8000-000000000005','d5300000-0000-4000-8000-000000000002','Other forum','planning','2030-11-01T09:00Z'),
 (95303,'d5300000-0000-4000-8000-000000000005','d5300000-0000-4000-8000-000000000001','Draft forum','draft',null);
insert into public.equipment(equipment_id,name,quantity_total,operational_status) values
 (95301,'Microphones',5,'operational'),(95302,'Projectors',0,'maintenance'),(95303,'Speakers',20,'operational');
insert into public.venues(venue_id,name) values (95301,'Forum hall');
-- Model a pre-SG2-53 request: long free-text notes and its original period.
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,notes,starts_at,ends_at)
 values (95399,95302,95303,2,repeat('L',2001),'2030-11-01T09:00Z','2030-11-01T12:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb; item jsonb; bad jsonb;
begin
 result := public.manage_equipment_requirements('read',95301);
 if result->>'outcome' is distinct from 'ok' or result->'requests' is distinct from '[]'::jsonb
   or result->>'can_request' is distinct from 'true' or result->>'can_arrange' is distinct from 'false'
   or result->'event' is distinct from '{"event_id":95301,"name":"Equipment forum","status":"approved"}'::jsonb
   or (result->'equipment' @> '[{"equipment_id":95302,"type":"Projectors"}]'::jsonb) is not true then
  raise exception '[SG2-53:empty-options] [SG2-53:AC1] [NORMAL] Assigned coordinator must see the event and catalogue, including unavailable stock, without arrangement permission';
 end if;
 result := public.manage_equipment_requirements('create',95301,null,null,'{"equipment_id":95301,"quantity":8,"notes":"  Wireless handhelds  "}');
 item := result->'requests'->0;
 perform set_config('requirements.id',item->>'request_id',true);
 if result->>'outcome' is distinct from 'ok' or item - 'request_id' is distinct from
  '{"event_id":95301,"equipment_id":95301,"equipment_type":"Microphones","quantity":8,"notes":"Wireless handhelds","status":"pending","arrangement_notes":null,"shortfall":null,"placement_venue_id":null,"placement_venue_name":null,"placement_position":null,"version":1}'::jsonb
  or (item->>'request_id')::bigint is null then
  raise exception '[SG2-53:create-fields] [SG2-53:AC1] [SG2-53:AC5] [SG2-53:AC6] [NORMAL] A requirement must store all requested fields with unrecorded arrangement and placement';
 end if;
 if public.manage_equipment_requirements('create',95301,null,null,'{"equipment_id":95301,"quantity":1}')->>'outcome' is distinct from 'duplicate' then
  raise exception '[SG2-53:pending-duplicate] [SG2-53:AC1] [CONFLICT] A second pending requirement for the same equipment must be refused';
 end if;
 foreach bad in array array['0'::jsonb,'-1','1.5','2147483648','null','"2"','true'] loop
  if public.manage_equipment_requirements('create',95301,null,null,jsonb_build_object('equipment_id',95302,'quantity',bad))->>'outcome' is distinct from 'invalid' then
   raise exception '[SG2-53:invalid-quantity] [SG2-53:AC3] [BOUNDARY] Nonpositive, fractional, overflow and nonnumeric quantities must be refused: %',bad;
  end if;
 end loop;
 foreach bad in array array['{}'::jsonb,'[]','null','{"equipment_id":0,"quantity":1}',
  '{"equipment_id":999999,"quantity":1}','{"equipment_id":1.5,"quantity":1}',
  '{"equipment_id":"95302","quantity":1}','{"equipment_id":95302,"quantity":1,"notes":5}',
  '{"equipment_id":95302,"quantity":1,"status":"approved"}'] loop
  if public.manage_equipment_requirements('create',95301,null,null,bad)->>'outcome' is distinct from 'invalid' then
   raise exception '[SG2-53:invalid-request-shape] [SG2-53:AC1] [FAILURE] Malformed input, unknown equipment and unsupported fields must be refused: %',bad;
  end if;
 end loop;
 if public.manage_equipment_requirements('create',95301,null,null,
  jsonb_build_object('equipment_id',95302,'quantity',1,'notes',repeat('🎤',2001)))->>'outcome' is distinct from 'invalid' then
  raise exception '[SG2-53:notes-over-limit] [SG2-53:AC1] [BOUNDARY] Technical notes longer than 2000 Unicode characters must be refused';
 end if;
 result := public.manage_equipment_requirements('create',95301,null,null,
  jsonb_build_object('equipment_id',95302,'quantity',2147483647,'notes',repeat('🎤',2000)));
 if result->>'outcome' is distinct from 'ok' or not exists (select 1 from jsonb_array_elements(result->'requests') r
   where r->>'equipment_id'='95302' and r->>'quantity'='2147483647' and r->>'notes'=repeat('🎤',2000)) then
  raise exception '[SG2-53:exact-limits] [SG2-53:AC1] [SG2-53:AC3] [BOUNDARY] Exact integer and Unicode limits must persist even with unavailable equipment';
 end if;
 if public.manage_equipment_requirements('amend',95301,current_setting('requirements.id')::bigint,0,'{}')->>'outcome' is distinct from 'invalid'
   or public.manage_equipment_requirements('amend',95301,9007199254740992,1,'{}')->>'outcome' is distinct from 'invalid'
   or public.manage_equipment_requirements('amend',95301,999999,1,'{}')->>'outcome' is distinct from 'missing'
   or public.manage_equipment_requirements('read',999999)->>'outcome' is distinct from 'missing'
   or public.manage_equipment_requirements('read',95302)->>'outcome' is distinct from 'missing'
   or public.manage_equipment_requirements('unknown',95301)->>'outcome' is distinct from 'invalid' then
  raise exception '[SG2-53:invalid-or-inaccessible-selection] [SG2-53:AC1] [SG2-53:AC2] [FAILURE] Invalid IDs, versions and actions must be distinguished from inaccessible resources';
 end if;
 if public.manage_equipment_requirements('create',95303,null,null,'{"equipment_id":95301,"quantity":1}')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-53:unapproved-event] [SG2-53:AC1] [CONFLICT] A draft event must not accept requirements';
 end if;
 begin
  perform public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,1,'{"shortfall":0}');
  raise exception '[SG2-53:coordinator-arrangement-denied] [SG2-53:AC5] [FAILURE] Coordinators must not record Technical Support updates';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
 if exists (select 1 from public.equipment_requests where event_id=95301 and (starts_at is not null or ends_at is not null))
   or exists (select 1 from public.equipment_reservations where event_id=95301)
   or (select available_quantity from public.equipment where equipment_id=95301) is distinct from 5 then
  raise exception '[SG2-53:no-invented-period-or-reservation] [SG2-53:AC1] [NORMAL] Recording need must not invent a period, reserve equipment or change available stock';
 end if;
 if not exists (select 1 from public.internal_work_items where kind='equipment' and event_id=95301
   and title='Microphones' and audience='technical_support_staff' and starts_at='2030-10-01T09:00Z'
   and details @> '{"quantity":8,"notes":"Wireless handhelds","shortfall":null,"placement_position":null}'::jsonb) then
  raise exception '[SG2-53:support-queue] [SG2-53:AC4] [NORMAL] Pending need must reach Technical Support with notes, quantity and the event date';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb; bad jsonb;
begin
 result := public.manage_equipment_requirements('arrange',95302,95399,1,
  '{"shortfall":1,"arrangement_notes":"One speaker still needed"}');
 if result->>'outcome' is distinct from 'ok' or not exists (select 1 from jsonb_array_elements(result->'requests') item
   where item->>'request_id'='95399' and item->>'quantity'='2' and item->>'notes'=repeat('L',2001)
     and item->>'shortfall'='1' and item->>'arrangement_notes'='One speaker still needed' and item->>'version'='2') then
  raise exception '[SG2-53:arrange-legacy-long-notes] [SG2-53:AC5] [BOUNDARY] Support must arrange a legacy request with long notes while preserving its requirement fields';
 end if;
 foreach bad in array array['{"shortfall":-1}'::jsonb,'{"shortfall":9}','{"shortfall":1.5}','{"shortfall":null}',
  '{"shortfall":"0"}','{"shortfall":0,"placement_venue_id":95301}',
  '{"shortfall":0,"placement_position":"Stage"}','{"shortfall":0,"placement_venue_id":999999,"placement_position":"Stage"}',
  '{"shortfall":0,"placement_venue_id":1.5,"placement_position":"Stage"}',
  '{"shortfall":0,"placement_position":false}','{"shortfall":0,"arrangement_notes":[]}',
  '{"shortfall":0,"quantity":2}'] loop
  if public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,1,bad)->>'outcome' is distinct from 'invalid' then
   raise exception '[SG2-53:invalid-arrangement] [SG2-53:AC5] [SG2-53:AC6] [BOUNDARY] Shortfall and placement must be valid, paired and scoped to the arrangement fields: %',bad;
  end if;
 end loop;
 if public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,1,
    jsonb_build_object('shortfall',0,'arrangement_notes',repeat('🎤',2001)))->>'outcome' is distinct from 'invalid'
  or public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,1,
    jsonb_build_object('shortfall',0,'placement_venue_id',95301,'placement_position',repeat('🎤',2001)))->>'outcome' is distinct from 'invalid' then
  raise exception '[SG2-53:arrangement-text-limit] [SG2-53:AC5] [SG2-53:AC6] [BOUNDARY] Arrangement notes and positions must reject overlong Unicode text';
 end if;
 result := public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,1,
  '{"arrangement_notes":"  Five sourced; three still needed  ","shortfall":3,"placement_venue_id":95301,"placement_position":"  Stage left  "}');
 if result->>'outcome' is distinct from 'ok' or result->>'can_arrange' is distinct from 'true'
   or result->>'can_request' is distinct from 'false'
   or (result->'requests' @> '[{"equipment_id":95301,"quantity":8,"shortfall":3,"arrangement_notes":"Five sourced; three still needed","placement_venue_id":95301,"placement_venue_name":"Forum hall","placement_position":"Stage left","version":2}]'::jsonb) is not true then
  raise exception '[SG2-53:arrangement-persisted] [SG2-53:AC5] [SG2-53:AC6] [NORMAL] Support updates must retain requirement quantity and persist the shortfall and named placement';
 end if;
 if public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,1,'{"shortfall":0}')->>'outcome' is distinct from 'conflict' then
  raise exception '[SG2-53:stale-support-update] [SG2-53:AC5] [CONFLICT] A stale support editor must not overwrite an arrangement';
 end if;
 begin
  perform public.manage_equipment_requirements('create',95301,null,null,'{"equipment_id":95303,"quantity":1}');
  raise exception '[SG2-53:support-request-denied] [SG2-53:AC1] [FAILURE] Technical Support must not create coordinator requirements';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
 if not exists (select 1 from public.equipment_requests where request_id=95399 and event_id=95302
   and equipment_id=95303 and quantity=2 and notes=repeat('L',2001) and status='pending'
   and starts_at='2030-11-01T09:00Z' and ends_at='2030-11-01T12:00Z' and version=2) then
  raise exception '[SG2-53:legacy-requirement-fields-retained] [SG2-53:AC5] [NORMAL] Arranging a legacy request must retain its original type, quantity, long notes and period';
 end if;
 if not exists (select 1 from public.internal_work_items where kind='equipment' and event_id=95301
   and details @> '{"quantity":8,"shortfall":3,"arrangement_notes":"Five sourced; three still needed","placement_venue_id":95301,"placement_venue_name":"Forum hall","placement_position":"Stage left","version":2}'::jsonb) then
  raise exception '[SG2-53:queue-arrangement-details] [SG2-53:AC4] [SG2-53:AC5] [SG2-53:AC6] [NORMAL] The support queue must retain saved arrangement, shortfall and named placement per item';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000004',true);
do $$
declare result jsonb;
begin
 result := public.manage_equipment_requirements('read',95301);
 if result->>'outcome' is distinct from 'ok' or (result->'requests' @>
   '[{"equipment_id":95301,"placement_venue_id":95301,"placement_venue_name":"Forum hall","placement_position":"Stage left","shortfall":3}]'::jsonb) is not true then
  raise exception '[SG2-53:safety-recorded-placement] [SG2-53:AC6] [NORMAL] Safety Officer must see each recorded venue name and position';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
 result := public.manage_equipment_requirements('read',95301);
 if (result->'requests' @> '[{"equipment_id":95301,"shortfall":3,"arrangement_notes":"Five sourced; three still needed","placement_position":"Stage left"}]'::jsonb) is not true then
  raise exception '[SG2-53:coordinator-sees-update] [SG2-53:AC5] [NORMAL] Assigned coordinator must see the saved support update and shortfall';
 end if;
 if public.manage_equipment_requirements('amend',95301,current_setting('requirements.id')::bigint,1,'{"equipment_id":95301,"quantity":4}')->>'outcome' is distinct from 'conflict' then
  raise exception '[SG2-53:stale-amendment] [SG2-53:AC2] [CONFLICT] An amendment based on an old support version must be refused';
 end if;
 if public.manage_equipment_requirements('amend',95301,current_setting('requirements.id')::bigint,2,'{"equipment_id":95302,"quantity":4}')->>'outcome' is distinct from 'duplicate' then
  raise exception '[SG2-53:duplicate-amendment] [SG2-53:AC2] [CONFLICT] Changing equipment type must not duplicate another pending requirement';
 end if;
 result := public.manage_equipment_requirements('amend',95301,current_setting('requirements.id')::bigint,2,
  jsonb_build_object('equipment_id',95303,'quantity',1,'notes',U&'\00A0\2003\FEFF'));
 if result->>'outcome' is distinct from 'ok' or (result->'requests' @>
  '[{"equipment_id":95303,"equipment_type":"Speakers","quantity":1,"notes":null,"arrangement_notes":null,"shortfall":null,"placement_venue_id":null,"placement_venue_name":null,"placement_position":null,"version":3}]'::jsonb) is not true then
  raise exception '[SG2-53:amendment-resets-arrangement] [SG2-53:AC2] [SG2-53:AC5] [SG2-53:AC6] [NORMAL] Amendment must update the requirement, normalize blank notes and reset every support field for recheck';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
 result := public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,3,
  jsonb_build_object('shortfall',0,'arrangement_notes',repeat('🎤',2000),'placement_venue_id',95301,'placement_position',repeat('🎤',2000)));
 if result->>'outcome' is distinct from 'ok' or not exists (select 1 from jsonb_array_elements(result->'requests') r
   where r->>'equipment_id'='95303' and r->>'shortfall'='0' and r->>'arrangement_notes'=repeat('🎤',2000)
   and r->>'placement_position'=repeat('🎤',2000) and r->>'version'='4') then
  raise exception '[SG2-53:fully-covered-and-exact-position] [SG2-53:AC5] [SG2-53:AC6] [BOUNDARY] Zero shortfall records full coverage and exactly 2000 Unicode characters persist';
 end if;
 result := public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,4,
  '{"shortfall":1,"arrangement_notes":" ","placement_venue_id":null,"placement_position":" "}');
 if result->>'outcome' is distinct from 'ok' or (result->'requests' @>
  '[{"equipment_id":95303,"shortfall":1,"arrangement_notes":null,"placement_venue_id":null,"placement_position":null,"version":5}]'::jsonb) is not true then
  raise exception '[SG2-53:whole-quantity-shortfall-and-clear-placement] [SG2-53:AC5] [SG2-53:AC6] [BOUNDARY] Shortfall may equal the requested quantity and placement may be cleared together';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000004',true);
do $$
declare result jsonb; action text;
begin
 result := public.manage_equipment_requirements('read',95301);
 if result->>'outcome' is distinct from 'ok' or result->>'can_request' is distinct from 'false'
   or result->>'can_arrange' is distinct from 'false' or (result->'requests' @>
   '[{"equipment_id":95303,"quantity":1,"shortfall":1,"placement_venue_id":null,"placement_position":null}]'::jsonb) is not true then
  raise exception '[SG2-53:safety-read-with-unrecorded-placement] [SG2-53:AC6] [NORMAL] Safety Officer must read per-item arrangement with explicit null for unrecorded placement';
 end if;
 foreach action in array array['create','amend','arrange'] loop
  begin
   perform public.manage_equipment_requirements(action,95301,current_setting('requirements.id')::bigint,5,'{}');
   raise exception '[SG2-53:safety-read-only] [SG2-53:AC6] [FAILURE] Safety Officer must not mutate requirements or placement: %',action;
  exception when insufficient_privilege then null; end;
 end loop;
end $$;
reset role;
update public.events set coordinator_id='d5300000-0000-4000-8000-000000000002' where event_id=95301;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000001',true);
do $$
begin
 if public.manage_equipment_requirements('read',95301)->>'outcome' is distinct from 'missing'
  or public.manage_equipment_requirements('amend',95301,current_setting('requirements.id')::bigint,5,'{"equipment_id":95303,"quantity":2}')->>'outcome' is distinct from 'missing' then
  raise exception '[SG2-53:reassigned-coordinator] [SG2-53:AC1] [SG2-53:AC2] [CONFLICT] The former coordinator must lose read and edit access immediately';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000002',true);
do $$
begin
 if public.manage_equipment_requirements('read',95301)->>'outcome' is distinct from 'ok'
  or public.manage_equipment_requirements('amend',95302,current_setting('requirements.id')::bigint,5,'{}')->>'outcome' is distinct from 'missing' then
  raise exception '[SG2-53:current-assignment-and-event-pair] [SG2-53:AC2] [NORMAL] Current coordinator must read the request only under its owning event';
 end if;
end $$;
reset role;
update public.equipment_requests set status='approved' where request_id=current_setting('requirements.id')::bigint;
set local role authenticated;
do $$
begin
 if public.manage_equipment_requirements('amend',95301,current_setting('requirements.id')::bigint,6,'{"equipment_id":95303,"quantity":2}')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-53:decided-request-closed] [SG2-53:AC2] [CONFLICT] A decided request must not be amended';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-000000000003',true);
do $$
begin
 if public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,6,'{"shortfall":0}')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-53:decided-arrangement-closed] [SG2-53:AC5] [CONFLICT] Support must not change a decided request';
 end if;
end $$;
reset role;
update public.events set status='confirmed' where event_id=95301;
set local role authenticated;
do $$
declare result jsonb;
begin
 if public.manage_equipment_requirements('arrange',95301,current_setting('requirements.id')::bigint,6,'{"shortfall":0}')->>'outcome' is distinct from 'closed' then
  raise exception '[SG2-53:closed-event-update] [SG2-53:AC5] [CONFLICT] Support updates stop when the event leaves arrangement stages';
 end if;
 result := public.manage_equipment_requirements('read',95301);
 if result->>'outcome' is distinct from 'ok' or result->>'can_arrange' is distinct from 'false'
   or jsonb_array_length(result->'requests') is distinct from 2 then
  raise exception '[SG2-53:closed-event-history] [SG2-53:AC5] [NORMAL] Closed events retain read-only requirement history';
 end if;
end $$;
reset role;
update public.account_roles set role='attendee' where user_id='d5300000-0000-4000-8000-000000000003';
set local role authenticated;
do $$
begin
 begin
  perform public.manage_equipment_requirements('read',95301);
  raise exception '[SG2-53:current-role-revocation] [SG2-53:AC5] [CONFLICT] A stale support identity must lose access when its current role changes';
 exception when insufficient_privilege then null; end;
end $$;
do $$
declare n integer;
begin
 foreach n in array array[5,6,7,8] loop
  perform set_config('request.jwt.claim.sub','d5300000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  begin
   perform public.manage_equipment_requirements('read',95301);
   raise exception '[SG2-53:other-role-read-denied] [SG2-53:AC1] [FAILURE] External, lead and unassigned accounts cannot read requirements: %',n;
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.manage_equipment_requirements('read',95301);
  raise exception '[SG2-53:missing-identity] [SG2-53:AC1] [FAILURE] Missing caller identity must not access the RPC';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare role_name text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  if has_table_privilege(role_name,'public.equipment_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_sequence_privilege(role_name,'public.equipment_requests_request_id_seq','USAGE,SELECT,UPDATE') then
   raise exception '[SG2-53:no-direct-grants] [SG2-53:AC1] [SG2-53:AC5] [FAILURE] Ordinary clients must not bypass the guarded RPC';
  end if;
 end loop;
 if has_function_privilege('anon','public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb)','EXECUTE')
   or not has_function_privilege('authenticated','public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb)','EXECUTE')
   or not exists(select 1 from pg_proc where oid='public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb)'::regprocedure
      and prosecdef and proconfig @> array['search_path=""']) then
  raise exception '[SG2-53:rpc-execution-contract] [SG2-53:AC1] [FAILURE] Only authenticated callers may execute the scoped definer with an empty search path';
 end if;
 begin
  update public.equipment_requests set shortfall=quantity+1 where request_id=current_setting('requirements.id')::bigint;
  raise exception '[SG2-53:database-shortfall-bound] [SG2-53:AC5] [BOUNDARY] Database storage must reject shortfall beyond the requested quantity';
 exception when check_violation then null; end;
 begin
  update public.equipment_requests set placement_venue_id=95301,placement_position=null where request_id=current_setting('requirements.id')::bigint;
  raise exception '[SG2-53:database-placement-pair] [SG2-53:AC6] [BOUNDARY] Database storage must require a venue and position together';
 exception when check_violation then null; end;
end $$;
rollback;
