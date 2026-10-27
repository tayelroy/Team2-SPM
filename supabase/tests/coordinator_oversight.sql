-- SG2-89: disposable rollback tests for the Lead's supervision record and for
-- events awaiting clarification staying in the coordinator's work queue.
begin;
insert into auth.users(id) values
 ('e8900000-0000-4000-8000-000000000001'),
 ('e8900000-0000-4000-8000-000000000002'),
 ('e8900000-0000-4000-8000-000000000003'),
 ('e8900000-0000-4000-8000-000000000004'),
 ('e8900000-0000-4000-8000-000000000005');
insert into public.users(user_id,name,organisation,role_id) values
 ('e8900000-0000-4000-8000-000000000001','Oversight organiser','Oversight org',1),
 ('e8900000-0000-4000-8000-000000000002','Lead One',null,1),
 ('e8900000-0000-4000-8000-000000000003','Lead Two',null,1),
 ('e8900000-0000-4000-8000-000000000004','Coordinator Ada',null,1),
 ('e8900000-0000-4000-8000-000000000005','Coordinator Ben',null,1);
insert into public.account_roles(user_id,role) values
 ('e8900000-0000-4000-8000-000000000001','event_organiser'),
 ('e8900000-0000-4000-8000-000000000002','event_coordinator_lead'),
 ('e8900000-0000-4000-8000-000000000003','event_coordinator_lead'),
 ('e8900000-0000-4000-8000-000000000004','event_coordinator'),
 ('e8900000-0000-4000-8000-000000000005','event_coordinator');
insert into public.events(event_id,organiser_id,organisation,status,name,coordinator_id,coordinator_assigned_by) values
 (98901,'e8900000-0000-4000-8000-000000000001','Oversight org','needs_clarification','Awaiting answers',
  'e8900000-0000-4000-8000-000000000004','e8900000-0000-4000-8000-000000000002'),
 (98902,'e8900000-0000-4000-8000-000000000001','Oversight org','planning','In planning',
  'e8900000-0000-4000-8000-000000000005','e8900000-0000-4000-8000-000000000002'),
 (98903,'e8900000-0000-4000-8000-000000000001','Oversight org','draft','Still a draft',null,null);

do $$
declare
 lead_one uuid := 'e8900000-0000-4000-8000-000000000002';
 lead_two uuid := 'e8900000-0000-4000-8000-000000000003';
 ada uuid := 'e8900000-0000-4000-8000-000000000004';
 ben uuid := 'e8900000-0000-4000-8000-000000000005';
 changed integer;
begin
 if not exists (select 1 from public.internal_work_items where kind='event' and event_id=98901
     and assigned_to=ada and status='needs_clarification' and category='review') then
   raise exception '[SG2-89:clarification-in-queue] [NORMAL] [SG2-89:AC6] An event awaiting clarification must stay in its coordinator''s review queue';
 end if;
 if exists (select 1 from public.internal_work_items where kind='event' and event_id=98901 and assigned_to is distinct from ada) then
   raise exception '[SG2-89:clarification-own-coordinator] [BOUNDARY] [SG2-89:AC6] An event awaiting clarification must reach only its assigned coordinator';
 end if;
 if not (select details ? 'cancellation_requested_at' and details ? 'cancellation_reason' and details ? 'preferred_layout'
     from public.internal_work_items where kind='event' and event_id=98901) then
   raise exception '[SG2-89:queue-keeps-fields] [BOUNDARY] [SG2-89:AC6] Replacing the work queue view must keep the fields earlier stories added';
 end if;
 if exists (select 1 from public.internal_work_items where kind='event' and event_id=98903) then
   raise exception '[SG2-89:draft-not-in-queue] [BOUNDARY] [SG2-89:AC6] Adding the clarification status must not bring drafts into the work queue';
 end if;

 -- AC6: the Lead reassigns without moving the status; AC1: supervision moves
 -- to the Lead who made the reassignment, in the same write.
 update public.events set coordinator_id=ben, coordinator_assigned_by=lead_two
 where event_id=98901 and coordinator_id=ada;
 if (select status from public.events where event_id=98901) is distinct from 'needs_clarification'
     or (select coordinator_assigned_by from public.events where event_id=98901) is distinct from lead_two
     or not exists (select 1 from public.internal_work_items where kind='event' and event_id=98901 and assigned_to=ben) then
   raise exception '[SG2-89:reassign-keeps-clarification] [NORMAL] [SG2-89:AC6] [SG2-89:AC1] Reassigning must keep the status and move supervision and the queue entry';
 end if;

 -- A second Lead who read the old coordinator loses the race: the guarded
 -- write matches nothing, so the winner's coordinator and supervision stand.
 update public.events set coordinator_id=ada, coordinator_assigned_by=lead_one
 where event_id=98901 and coordinator_id=ada;
 get diagnostics changed = row_count;
 if changed <> 0 or (select coordinator_assigned_by from public.events where event_id=98901) is distinct from lead_two
     or (select coordinator_id from public.events where event_id=98901) is distinct from ben then
   raise exception '[SG2-89:stale-reassign-loses] [CONFLICT] [SG2-89:AC1] A reassignment read against a replaced coordinator must change nothing';
 end if;

 begin
   update public.events set coordinator_id=null where event_id=98902;
   raise exception '[SG2-89:assigner-needs-coordinator] [FAILURE] [SG2-89:AC1] An event with no coordinator must not keep a supervising Lead';
 exception when check_violation then null;
 end;
 begin
   update public.events set coordinator_assigned_by=lead_one where event_id=98903;
   raise exception '[SG2-89:unassigned-has-no-supervisor] [FAILURE] [SG2-89:AC1] An unassigned event must not be given a supervising Lead';
 exception when check_violation then null;
 end;
 update public.events set coordinator_id=null, coordinator_assigned_by=null where event_id=98902;
 if (select coordinator_assigned_by from public.events where event_id=98902) is not null then
   raise exception '[SG2-89:clear-both] [BOUNDARY] [SG2-89:AC1] Clearing the coordinator and the supervisor together must be allowed';
 end if;

 if (select is_nullable from information_schema.columns where table_schema='public' and table_name='events'
     and column_name='coordinator_assigned_by') is distinct from 'YES' then
   raise exception '[SG2-89:assigner-nullable] [BOUNDARY] [SG2-89:AC1] Events assigned before their history existed must be allowed no supervising Lead';
 end if;
end;
$$;
rollback;
