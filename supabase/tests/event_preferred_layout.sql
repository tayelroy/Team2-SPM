-- SG2-105: disposable rollback tests for the preferred room layout column.
begin;
insert into auth.users(id) values ('ef410000-0000-4000-8000-000000000001');
insert into public.users(user_id,name,organisation,role_id) values
 ('ef410000-0000-4000-8000-000000000001','Layout owner','Layout org',1);
insert into public.account_roles(user_id,role) values
 ('ef410000-0000-4000-8000-000000000001','event_organiser');
insert into public.events(event_id,organiser_id,organisation,status) values
 (94101,'ef410000-0000-4000-8000-000000000001','Layout org','draft');
-- Submitted before SG2-105: no layout, and nothing about it may change.
insert into public.events(event_id,organiser_id,organisation,status,name,purpose,description,
  proposed_date,expected_attendance,venue_requirements) values
 (94102,'ef410000-0000-4000-8000-000000000001','Layout org','unassigned','Earlier forum','Sharing',
  'Submitted before the layout was asked for','2090-06-15T02:00:00Z',40,'Projector');
insert into public.events(event_id,organiser_id,organisation,status,name,preferred_layout) values
 (94103,'ef410000-0000-4000-8000-000000000001','Layout org','unassigned','Layout review','Banquet rounds');

do $$
declare
 actor uuid := 'ef410000-0000-4000-8000-000000000001';
 result jsonb;
 invalid jsonb;
begin
 result := public.update_event_request_draft(94101,actor,'{"name":"Layout forum","preferred_layout":"Banquet rounds of ten"}');
 if result ->> 'outcome' is distinct from 'updated' or result -> 'request' ->> 'preferred_layout' is distinct from 'Banquet rounds of ten'
     or (select preferred_layout from public.events where event_id=94101) is distinct from 'Banquet rounds of ten' then
   raise exception '[SG2-105:draft-saves-layout] [NORMAL] [SG2-105:AC4] A draft save must store and return the preferred layout';
 end if;
 if not exists (select 1 from public.event_audit_logs where event_id=94101 and field_name='preferred_layout'
     and old_value is null and new_value='Banquet rounds of ten' and actor_id=actor) then
   raise exception '[SG2-105:layout-in-history] [NORMAL] [SG2-105:AC4] [SG2-40:AC2] A layout change must be recorded in the change history';
 end if;
 result := public.update_event_request_draft(94101,actor,'{"name":"Layout forum"}');
 if result ->> 'outcome' is distinct from 'updated' or (select preferred_layout from public.events where event_id=94101) is not null then
   raise exception '[SG2-105:draft-clears-layout] [BOUNDARY] [SG2-105:AC4] A draft may still be saved without a layout';
 end if;
 result := public.update_event_request_draft(94101,actor,jsonb_build_object('preferred_layout',repeat('x',5000)));
 if result ->> 'outcome' is distinct from 'updated' then
   raise exception '[SG2-105:layout-max-length] [BOUNDARY] [SG2-105:AC1] A 5000-character layout must be accepted';
 end if;
 foreach invalid in array array[jsonb_build_object('preferred_layout',repeat('x',5001)), '{"preferred_layout":3}'::jsonb] loop
   result := public.update_event_request_draft(94101,actor,invalid);
   if result ->> 'outcome' is distinct from 'invalid' then
     raise exception '[SG2-105:layout-invalid-rpc] [FAILURE] [SG2-105:AC1] An over-long or non-text layout must be refused: %',invalid;
   end if;
 end loop;
 if (select preferred_layout from public.events where event_id=94101) is distinct from repeat('x',5000) then
   raise exception '[SG2-105:layout-invalid-no-write] [FAILURE] [SG2-105:AC1] A refused save must leave the stored layout alone';
 end if;
 begin
   update public.events set preferred_layout=repeat('x',5001) where event_id=94101;
   raise exception '[SG2-105:layout-column-check] [FAILURE] [SG2-105:AC1] The column must refuse a layout over 5000 characters';
 exception when check_violation then null;
 end;
 if (select preferred_layout from public.events where event_id=94102) is not null
     or (select status from public.events where event_id=94102) is distinct from 'unassigned' then
   raise exception '[SG2-105:submitted-untouched] [BOUNDARY] [SG2-105:AC5] Requests already submitted must keep their status with no layout filled in';
 end if;
 if (select is_nullable from information_schema.columns where table_schema='public' and table_name='events'
     and column_name='preferred_layout') is distinct from 'YES'
     or (select column_default from information_schema.columns where table_schema='public' and table_name='events'
     and column_name='preferred_layout') is not null then
   raise exception '[SG2-105:layout-nullable] [BOUNDARY] [SG2-105:AC4] [SG2-105:AC5] The layout column must be nullable with no default';
 end if;
 if (select details ->> 'preferred_layout' from public.internal_work_items where kind='event' and event_id=94103) is distinct from 'Banquet rounds' then
   raise exception '[SG2-105:work-queue-layout] [NORMAL] [SG2-105:AC1] The coordinator review queue must carry the preferred layout';
 end if;
 if not (select details ? 'preferred_layout' and details ->> 'preferred_layout' is null
     from public.internal_work_items where kind='event' and event_id=94102) then
   raise exception '[SG2-105:work-queue-legacy-layout] [BOUNDARY] [SG2-105:AC5] An earlier request must show in the queue with no layout';
 end if;
 if not (select details ? 'expected_crowd_movement' and details ? 'planning_notes'
     from public.internal_work_items where kind='event' and event_id=94103) then
   raise exception '[SG2-105:work-queue-keeps-fields] [BOUNDARY] [SG2-105:AC1] Replacing the queue view must keep the fields earlier stories added';
 end if;
end;
$$;
rollback;
