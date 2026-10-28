-- SG2-29/36/40: disposable rollback tests, never run as a hosted repair.
begin;
insert into auth.users(id) values
 ('ef400000-0000-4000-8000-000000000001'), ('ef400000-0000-4000-8000-000000000002'),
 ('ef400000-0000-4000-8000-000000000003');
insert into public.users(user_id,name,organisation,role_id) values
 ('ef400000-0000-4000-8000-000000000001','Draft audit owner','Draft audit A',1),
 ('ef400000-0000-4000-8000-000000000002','Draft audit colleague','Draft audit A',1),
 ('ef400000-0000-4000-8000-000000000003','Draft audit attendee','Draft audit A',5);
insert into public.account_roles(user_id,role) values
 ('ef400000-0000-4000-8000-000000000001','event_organiser'),
 ('ef400000-0000-4000-8000-000000000002','event_organiser'),
 ('ef400000-0000-4000-8000-000000000003','attendee');
insert into public.events(event_id,organiser_id,organisation,status) values
 (94091,'ef400000-0000-4000-8000-000000000001','Draft audit A','draft');

do $$
declare
 actor uuid := 'ef400000-0000-4000-8000-000000000001';
 payload jsonb := '{"name":"Audit forum","purpose":"Knowledge sharing","description":"Original description","proposed_date":"2090-06-15T10:00:00+08:00","expected_attendance":12,"venue_requirements":"projector","accessibility_needs":"step-free","equipment_requirements":"microphone","registration_needed":true}';
 result jsonb;
 invalid jsonb;
 before_count integer;
begin
 result := public.update_event_request_draft(94091,actor,payload);
 if result ->> 'outcome' IS DISTINCT FROM 'updated' or result -> 'request' ->> 'name' IS DISTINCT FROM 'Audit forum'
     or (select count(*) from public.event_audit_logs where event_id=94091) <> 9 then
   raise exception '[SG2-40:draft-all-field-diffs] [NORMAL] [SG2-29:AC1] [SG2-40:AC2] Every changed draft field must commit with its history';
 end if;
 if exists (select 1 from public.event_audit_logs where event_id=94091
      and (actor_id<>actor or old_value is not null or created_at is null or new_value is null))
     or (select count(distinct created_at) from public.event_audit_logs where event_id=94091) <> 1 then
   raise exception '[SG2-40:draft-actor-save-time] [NORMAL] [SG2-40:AC1] Saved changes must identify one verified actor and save time';
 end if;
 if not exists (select 1 from public.event_audit_logs where event_id=94091 and field_name='registration_needed' and new_value='true')
     or not exists (select 1 from public.event_audit_logs where event_id=94091 and field_name='expected_attendance' and new_value='12')
     or not exists (select 1 from public.event_audit_logs where event_id=94091 and field_name='proposed_date' and new_value::timestamptz='2090-06-15T02:00:00Z') then
   raise exception '[SG2-40:draft-typed-values] [BOUNDARY] [SG2-40:AC2] Typed date, number and boolean history must retain their actual values';
 end if;
 result := public.update_event_request_draft(94091,actor,payload || '{"proposed_date":"2090-06-15T02:00:00Z"}');
 if result ->> 'outcome' IS DISTINCT FROM 'updated' or (select count(*) from public.event_audit_logs where event_id=94091) <> 9 then
   raise exception '[SG2-40:draft-equivalent-no-op] [BOUNDARY] [SG2-40:AC2] An unchanged save including equivalent timestamp offsets must not invent history';
 end if;
 update public.events set status='needs_clarification' where event_id=94091;
 payload := payload || '{"description":null,"registration_needed":false}';
 result := public.update_event_request_draft(94091,actor,payload);
 if result ->> 'outcome' IS DISTINCT FROM 'updated' or (select count(*) from public.event_audit_logs where event_id=94091) <> 11
     or not exists (select 1 from public.event_audit_logs where event_id=94091 and field_name='description' and old_value='Original description' and new_value is null)
     or not exists (select 1 from public.event_audit_logs where event_id=94091 and field_name='registration_needed' and old_value='true' and new_value='false') then
   raise exception '[SG2-40:draft-clarification-null-boolean] [NORMAL] [SG2-36:AC2] [SG2-40:AC2] Clarification edits must record null clears and true-to-false changes';
 end if;
 before_count := (select count(*) from public.event_audit_logs where event_id=94091);
 foreach invalid in array array['null'::jsonb, '[]', '{"status":"planning"}', '{"name":2}', '{"expected_attendance":"twelve"}',
     '{"expected_attendance":1.5}', '{"expected_attendance":0}', '{"expected_attendance":2147483648}', '{"registration_needed":"false"}',
     '{"proposed_date":"not-a-date"}', '{"proposed_date":"infinity"}', jsonb_build_object('name',repeat('a',256)),jsonb_build_object('purpose',repeat('a',5001))] loop
   result := public.update_event_request_draft(94091,actor,invalid);
   if result ->> 'outcome' IS DISTINCT FROM 'invalid' then
     raise exception '[SG2-40:draft-invalid-rpc-shape] [FAILURE] [SG2-29:AC1] Invalid private RPC values must be refused before a save: %',invalid;
   end if;
 end loop;
 if (select count(*) from public.event_audit_logs where event_id=94091) <> before_count
     or (select name from public.events where event_id=94091) IS DISTINCT FROM 'Audit forum' then
   raise exception '[SG2-40:draft-invalid-save-unchanged] [FAILURE] [SG2-40:AC2] Invalid saves must not alter values or history';
 end if;
 if public.update_event_request_draft(94091,'ef400000-0000-4000-8000-000000000002',payload) ->> 'outcome' IS DISTINCT FROM 'not_found'
     or public.update_event_request_draft(94091,'ef400000-0000-4000-8000-000000000003',payload) ->> 'outcome' IS DISTINCT FROM 'not_found'
     or public.update_event_request_draft(94092,actor,payload) ->> 'outcome' IS DISTINCT FROM 'not_found' then
   raise exception '[SG2-40:draft-creator-role-scope] [FAILURE] [SG2-26:AC2] [SG2-29:AC1] A colleague, wrong role or missing event must not save as the creator';
 end if;
 update public.users set organisation='Different organisation' where user_id=actor;
 if public.update_event_request_draft(94091,actor,payload) ->> 'outcome' IS DISTINCT FROM 'not_found' then
   raise exception '[SG2-40:draft-stale-membership] [FAILURE] [SG2-26:AC2] A stale membership precheck must not permit a save';
 end if;
 update public.users set organisation=U&'\00A0\2003\FEFF' where user_id=actor;
 if public.update_event_request_draft(94091,actor,payload) ->> 'outcome' IS DISTINCT FROM 'not_found' then
   raise exception '[SG2-40:draft-blank-membership] [BOUNDARY] [SG2-26:AC2] Unicode blank membership must not authorize a save';
 end if;
 update public.users set organisation='Draft audit A' where user_id=actor;
 update public.events set status='submitted' where event_id=94091;
 if public.update_event_request_draft(94091,actor,payload) ->> 'outcome' IS DISTINCT FROM 'not_editable'
     or (select count(*) from public.event_audit_logs where event_id=94091) <> before_count then
   raise exception '[SG2-40:draft-stale-status] [CONFLICT] [SG2-30:AC3] [SG2-40:AC2] A status change before the locked write must refuse the stale edit without history';
 end if;
end;
$$;

-- This deliberately failing trigger exists only inside this rollback suite.
create function pg_temp.refuse_draft_audit() returns trigger language plpgsql as $$
begin raise sqlstate 'P0001' using message = 'injected draft audit failure'; end;
$$;
create trigger draft_audit_failure before insert on public.event_audit_logs
 for each row when (new.event_id=94091) execute function pg_temp.refuse_draft_audit();
do $$
declare
 before_row jsonb;
 before_count integer;
 failed boolean := false;
begin
 update public.events set status='draft' where event_id=94091;
 before_row := (select to_jsonb(e) from public.events e where event_id=94091);
 before_count := (select count(*) from public.event_audit_logs where event_id=94091);
 begin
   perform public.update_event_request_draft(94091,'ef400000-0000-4000-8000-000000000001','{"name":"Must roll back"}');
 exception when raise_exception then
   if sqlerrm <> 'injected draft audit failure' then raise; end if;
   failed := true;
 end;
 if not failed or (select to_jsonb(e) from public.events e where event_id=94091) is distinct from before_row
     or (select count(*) from public.event_audit_logs where event_id=94091) <> before_count then
   raise exception '[SG2-40:draft-audit-failure-rollback] [FAILURE] [SG2-40:AC2] An audit insert failure must roll back all draft fields and all history';
 end if;
end;
$$;

set local role authenticated;
do $$
begin
 begin
   perform public.update_event_request_draft(94091,'ef400000-0000-4000-8000-000000000001','{}');
   raise exception '[SG2-40:draft-authenticated-execute] [FAILURE] [SG2-25:AC2] Authenticated clients must not execute the service-only draft RPC';
 exception when insufficient_privilege then null;
 end;
end;
$$;
reset role;
do $$
begin
 if has_function_privilege('anon','public.update_event_request_draft(integer,uuid,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.update_event_request_draft(integer,uuid,jsonb)','EXECUTE') then
   raise exception '[SG2-40:draft-effective-execute-grants] [FAILURE] [SG2-25:AC2] Anonymous RPC access must be absent and service execution available';
 end if;
end;
$$;
rollback;
