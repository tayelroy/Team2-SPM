-- SG2-92 record_safety_decision / rework_safety_rejected_event contract and
-- the event_safety_decisions table, with isolated fixture changes rolled back.
-- Every decision carries the safety_check_revision SG2-91's list showed
-- (202610190006); pg_temp.rev() reads the event as it stands.
begin;
insert into auth.users(id)
 select ('d9200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,5) n;
insert into public.users(user_id,name,role_id) values
 ('d9200000-0000-4000-8000-000000000001','Safety organiser',1),
 ('d9200000-0000-4000-8000-000000000002','Safety coordinator',2),
 ('d9200000-0000-4000-8000-000000000003','Other safety coordinator',2),
 ('d9200000-0000-4000-8000-000000000004','Safety officer',2),
 ('d9200000-0000-4000-8000-000000000005','Coordinator lead',2);
insert into public.account_roles(user_id,role) values
 ('d9200000-0000-4000-8000-000000000001','event_organiser'),
 ('d9200000-0000-4000-8000-000000000002','event_coordinator'),
 ('d9200000-0000-4000-8000-000000000003','event_coordinator'),
 ('d9200000-0000-4000-8000-000000000004','safety_officer'),
 ('d9200000-0000-4000-8000-000000000005','event_coordinator_lead');
insert into public.events(event_id,organiser_id,coordinator_id,name,status,proposed_date,expected_attendance)
 select 99200+n,'d9200000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000002',
  'Safety event '||n,'awaiting_safety_check','2031-11-01T09:00Z',120
 from generate_series(1,13) n;
update public.events set name='Harbour Gala' where event_id=99201;
-- 99205: no name, and its organiser also coordinates it (one notice only).
update public.events set name='',coordinator_id='d9200000-0000-4000-8000-000000000001' where event_id=99205;
-- 99206: nobody coordinates it, so only the organiser is told.
update public.events set coordinator_id=null where event_id=99206;
update public.events set status='planning' where event_id=99207;
update public.events set status='safety_rejected' where event_id=99210;
create function pg_temp.rev(p_event_id integer) returns bigint language sql stable
  as $$ select safety_check_revision from public.events where event_id = p_event_id $$;

-- AC1/AC3/AC5/AC6: Approve moves the event on to Preparation.
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.record_safety_decision(99201,'d9200000-0000-4000-8000-000000000004','approve',null,null,pg_temp.rev(99201));
 if result->>'outcome' is distinct from 'ok' or result->>'decision' is distinct from 'approve'
   or result->>'previous_status' is distinct from 'awaiting_safety_check' or result->>'status' is distinct from 'preparation'
   or (result->>'decision_id')::bigint is distinct from (select decision_id from public.event_safety_decisions where event_id=99201)
   or (result->>'decided_at')::timestamptz is distinct from (select decided_at from public.event_safety_decisions where event_id=99201) then
  raise exception '[SG2-92:approve-result] [SG2-92:AC3] [NORMAL] Approving must report the decision and the move to Preparation: %', result;
 end if;
 result := public.record_safety_decision(99202,'d9200000-0000-4000-8000-000000000004','approve','  Keep the fire exits clear.  ','[]',pg_temp.rev(99202));
 if result->>'status' is distinct from 'preparation' then
  raise exception '[SG2-92:approve-note-result] [SG2-92:AC3] [NORMAL] Approving with a note must move to Preparation: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text from public.events where event_id=99201) is distinct from 'preparation'
   or (select decision||'|'||coalesce(reason,'null')||'|'||arrangements::text||'|'||decided_by::text||'|'||(decided_at is not null)
     from public.event_safety_decisions where event_id=99201)
     is distinct from 'approve|null|{}|d9200000-0000-4000-8000-000000000004|true' then
  raise exception '[SG2-92:approve-stored] [SG2-92:AC6] [NORMAL] An approval must be stored with who and when, and the event moved on';
 end if;
 if (select string_agg(actor_id::text||'|'||field_name||'|'||coalesce(old_value,'null')||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=99201)
   is distinct from 'd9200000-0000-4000-8000-000000000004|safety_decision|null|Approved'
     ||' ; d9200000-0000-4000-8000-000000000004|status|awaiting_safety_check|preparation' then
  raise exception '[SG2-92:approve-history] [SG2-92:AC6] [NORMAL] The approval and the move to Preparation must be in the history';
 end if;
 if (select string_agg(recipient_id::text||'|'||kind||'|'||message||'|'||coalesce(request_id::text,'null'), ' ; ' order by notification_id)
     from public.notifications where event_id=99201)
   is distinct from 'd9200000-0000-4000-8000-000000000001|safety_decision|Harbour Gala passed its operational safety check and has moved to Preparation.|null'
     ||' ; d9200000-0000-4000-8000-000000000002|safety_decision|Harbour Gala passed its operational safety check and has moved to Preparation.|null' then
  raise exception '[SG2-92:approve-notices] [SG2-92:AC5] [NORMAL] The organiser and the coordinator must each get one exact approval notice';
 end if;
 if (select reason from public.event_safety_decisions where event_id=99202) is distinct from 'Keep the fire exits clear.'
   or (select new_value from public.event_audit_logs where event_id=99202 and field_name='safety_decision')
     is distinct from 'Approved: Keep the fire exits clear.'
   or (select string_agg(distinct message, ' ; ') from public.notifications where event_id=99202)
     is distinct from 'Safety event 2 passed its operational safety check and has moved to Preparation. Note: Keep the fire exits clear.' then
  raise exception '[SG2-92:approve-note] [SG2-92:AC5] [BOUNDARY] An approval note must be trimmed, stored, audited and passed on';
 end if;
end $$;

-- AC4: Reject stops the event as Safety Rejected.
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.record_safety_decision(99203,'d9200000-0000-4000-8000-000000000004','reject','No crowd management plan',null,pg_temp.rev(99203));
 if result->>'outcome' is distinct from 'ok' or result->>'decision' is distinct from 'reject'
   or result->>'status' is distinct from 'safety_rejected' then
  raise exception '[SG2-92:reject-result] [SG2-92:AC4] [NORMAL] Rejecting must leave the event Safety Rejected: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text from public.events where event_id=99203) is distinct from 'safety_rejected'
   or (select decision||'|'||reason||'|'||arrangements::text from public.event_safety_decisions where event_id=99203)
     is distinct from 'reject|No crowd management plan|{}' then
  raise exception '[SG2-92:reject-stored] [SG2-92:AC6] [NORMAL] A rejection must be stored with its reason';
 end if;
 if (select string_agg(field_name||'|'||coalesce(old_value,'null')||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=99203)
   is distinct from 'safety_decision|null|Rejected: No crowd management plan ; status|awaiting_safety_check|safety_rejected' then
  raise exception '[SG2-92:reject-history] [SG2-92:AC6] [NORMAL] The rejection and its reason must be in the history';
 end if;
 if (select string_agg(recipient_id::text||'|'||message, ' ; ' order by notification_id) from public.notifications where event_id=99203)
   is distinct from 'd9200000-0000-4000-8000-000000000001|Safety event 3 did not pass its operational safety check: No crowd management plan.'
     ||' The coordinator will rework the arrangements for a new check.'
     ||' ; d9200000-0000-4000-8000-000000000002|Safety event 3 did not pass its operational safety check: No crowd management plan.'
     ||' The coordinator will rework the arrangements for a new check.' then
  raise exception '[SG2-92:reject-notices] [SG2-92:AC5] [NORMAL] The organiser and the coordinator must be told the rejection and its reason';
 end if;
end $$;

-- Request Changes names the arrangements and returns the event to Planning.
set local role service_role;
do $$
declare result jsonb;
begin
 result := public.record_safety_decision(99204,'d9200000-0000-4000-8000-000000000004','request_changes',
  'Stage too close to the exit','["equipment","venue"]',pg_temp.rev(99204));
 if result->>'outcome' is distinct from 'ok' or result->>'decision' is distinct from 'request_changes'
   or result->>'status' is distinct from 'planning' then
  raise exception '[SG2-92:changes-result] [SG2-92:AC1] [NORMAL] Requesting changes must return the event to Planning: %', result;
 end if;
 perform public.record_safety_decision(99205,'d9200000-0000-4000-8000-000000000004','request_changes','Add a steward','["other"]',pg_temp.rev(99205));
 perform public.record_safety_decision(99206,'d9200000-0000-4000-8000-000000000004','reject','Unsafe rigging',null,pg_temp.rev(99206));
end $$;
reset role;
do $$
begin
 if (select status::text||'|'||(select arrangements::text from public.event_safety_decisions where event_id=99204)
     from public.events where event_id=99204) is distinct from 'planning|{equipment,venue}' then
  raise exception '[SG2-92:changes-stored] [SG2-92:AC2] [NORMAL] The named arrangements must be stored in the order given';
 end if;
 if (select string_agg(field_name||'|'||coalesce(old_value,'null')||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=99204)
   is distinct from 'safety_decision|null|Changes requested (Equipment and technical, Venue): Stage too close to the exit'
     ||' ; status|awaiting_safety_check|planning' then
  raise exception '[SG2-92:changes-history] [SG2-92:AC6] [NORMAL] The request, its arrangements and reason must be in the history';
 end if;
 if (select string_agg(recipient_id::text||'|'||message, ' ; ' order by notification_id) from public.notifications where event_id=99204)
   is distinct from 'd9200000-0000-4000-8000-000000000001|Safety event 4 needs changes before it can pass its operational safety check'
     ||' (Equipment and technical, Venue): Stage too close to the exit. It has moved back to Planning.'
     ||' ; d9200000-0000-4000-8000-000000000002|Safety event 4 needs changes before it can pass its operational safety check'
     ||' (Equipment and technical, Venue): Stage too close to the exit. It has moved back to Planning.' then
  raise exception '[SG2-92:changes-notices] [SG2-92:AC5] [NORMAL] The organiser and the coordinator must be told what to change and why';
 end if;
 if (select string_agg(recipient_id::text||'|'||message, ' ; ') from public.notifications where event_id=99205)
   is distinct from 'd9200000-0000-4000-8000-000000000001|Untitled event needs changes before it can pass its operational safety check'
     ||' (Other): Add a steward. It has moved back to Planning.' then
  raise exception '[SG2-92:untitled-single-notice] [SG2-92:AC5] [BOUNDARY] A blank name reads Untitled event and one person gets one notice';
 end if;
 if (select string_agg(recipient_id::text, ' ; ') from public.notifications where event_id=99206)
   is distinct from 'd9200000-0000-4000-8000-000000000001' then
  raise exception '[SG2-92:no-coordinator-notice] [SG2-92:AC5] [BOUNDARY] Without a coordinator only the organiser is told';
 end if;
end $$;

-- AC2: the reason and the arrangements are checked again here; a refused
-- decision writes nothing.
set local role service_role;
do $$
declare bad record; result jsonb;
begin
 for bad in select * from (values
   ('reject', null::text, null::jsonb, 'reject without a reason'),
   ('reject', '   ', null, 'reject with a blank reason'),
   ('request_changes', null, '["venue"]', 'request changes without a reason'),
   ('request_changes', 'Fix it', null, 'request changes without arrangements'),
   ('request_changes', 'Fix it', '[]', 'request changes with no arrangements'),
   ('request_changes', 'Fix it', '["venue","venue"]', 'a duplicate arrangement'),
   ('request_changes', 'Fix it', '["catering"]', 'an unknown arrangement'),
   ('request_changes', 'Fix it', '[1]', 'a non-text arrangement'),
   ('request_changes', 'Fix it', '{"venue":true}', 'arrangements that are not a list'),
   ('approve', null, '["venue"]', 'arrangements on an approval'),
   ('reject', 'Unsafe', '["other"]', 'arrangements on a rejection'),
   ('reject', repeat('r', 2001), null, 'a 2001-character reason'),
   ('escalate', 'Why', null, 'an unknown decision'),
   (null, 'Why', null, 'no decision')
 ) as cases(decision, reason, arrangements, label) loop
  result := public.record_safety_decision(99208,'d9200000-0000-4000-8000-000000000004',bad.decision,bad.reason,bad.arrangements,pg_temp.rev(99208));
  if result is distinct from '{"outcome":"invalid"}'::jsonb then
   raise exception '[SG2-92:invalid-refused] [SG2-92:AC2] [FAILURE] % must be refused: %', bad.label, result;
  end if;
 end loop;
 result := public.record_safety_decision(99209,'d9200000-0000-4000-8000-000000000004','reject',repeat('r', 2000),'null',pg_temp.rev(99209));
 if result->>'status' is distinct from 'safety_rejected' then
  raise exception '[SG2-92:reason-2000] [SG2-92:AC2] [BOUNDARY] A 2000-character reason must be accepted: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text from public.events where event_id=99208) is distinct from 'awaiting_safety_check'
   or exists(select 1 from public.event_safety_decisions where event_id=99208)
   or exists(select 1 from public.event_audit_logs where event_id=99208)
   or exists(select 1 from public.notifications where event_id=99208) then
  raise exception '[SG2-92:invalid-no-writes] [SG2-92:AC2] [FAILURE] A refused decision must write nothing';
 end if;
 if (select char_length(reason) from public.event_safety_decisions where event_id=99209) <> 2000
   or (select min(char_length(message))||'|'||max(char_length(message)) from public.notifications where event_id=99209)
     is distinct from '2000|2000' then
  raise exception '[SG2-92:reason-2000-stored] [SG2-92:AC5] [BOUNDARY] A 2000-character reason is stored whole and its notice cut to 2000';
 end if;
end $$;

-- AC1: only a Safety Officer decides, and only while the event awaits a check.
set local role service_role;
do $$
begin
 if public.record_safety_decision(99207,'d9200000-0000-4000-8000-000000000004','approve',null,null,pg_temp.rev(99207))
     is distinct from '{"outcome":"closed","status":"planning"}'::jsonb
   or public.record_safety_decision(99201,'d9200000-0000-4000-8000-000000000004','reject','Again',null,pg_temp.rev(99201))
     is distinct from '{"outcome":"closed","status":"preparation"}'::jsonb then
  raise exception '[SG2-92:closed] [SG2-92:AC1] [CONFLICT] An event not awaiting a check must be refused with its status';
 end if;
 if public.record_safety_decision(99211,'d9200000-0000-4000-8000-000000000002','approve',null,null,pg_temp.rev(99211))
     is distinct from '{"outcome":"forbidden"}'::jsonb
   or public.record_safety_decision(99211,'d9200000-0000-4000-8000-000000000005','approve',null,null,pg_temp.rev(99211))
     is distinct from '{"outcome":"forbidden"}'::jsonb
   or public.record_safety_decision(99211,null,'approve',null,null,pg_temp.rev(99211))
     is distinct from '{"outcome":"forbidden"}'::jsonb then
  raise exception '[SG2-92:forbidden] [SG2-92:AC1] [FAILURE] Anyone but a Safety Officer must be refused';
 end if;
 if public.record_safety_decision(999999,'d9200000-0000-4000-8000-000000000004','approve',null,null,0)
     is distinct from '{"outcome":"missing"}'::jsonb then
  raise exception '[SG2-92:missing] [SG2-92:AC1] [FAILURE] A missing event must be reported missing';
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text from public.events where event_id=99211) is distinct from 'awaiting_safety_check'
   or exists(select 1 from public.event_safety_decisions where event_id in (99207,99211))
   or (select count(*) from public.event_safety_decisions where event_id=99201) <> 1 then
  raise exception '[SG2-92:refused-no-writes] [SG2-92:AC1] [CONFLICT] A refused decision must write nothing';
 end if;
end $$;

-- AC4: the assigned coordinator reworks a Safety Rejected event back to Planning.
set local role service_role;
do $$
begin
 if public.rework_safety_rejected_event(99203,'d9200000-0000-4000-8000-000000000003')
     is distinct from '{"outcome":"missing"}'::jsonb
   or public.rework_safety_rejected_event(99203,null) is distinct from '{"outcome":"missing"}'::jsonb
   or public.rework_safety_rejected_event(999999,'d9200000-0000-4000-8000-000000000002')
     is distinct from '{"outcome":"missing"}'::jsonb then
  raise exception '[SG2-92:rework-missing] [SG2-92:AC4] [FAILURE] Another coordinator or a missing event must be reported missing';
 end if;
 if public.rework_safety_rejected_event(99211,'d9200000-0000-4000-8000-000000000002')
     is distinct from '{"outcome":"closed","status":"awaiting_safety_check"}'::jsonb
   or public.rework_safety_rejected_event(99201,'d9200000-0000-4000-8000-000000000002')
     is distinct from '{"outcome":"closed","status":"preparation"}'::jsonb then
  raise exception '[SG2-92:rework-closed] [SG2-92:AC4] [CONFLICT] Only a Safety Rejected event can be reworked';
 end if;
 if public.rework_safety_rejected_event(99203,'d9200000-0000-4000-8000-000000000002')
     is distinct from '{"outcome":"ok","status":"planning"}'::jsonb then
  raise exception '[SG2-92:rework-ok] [SG2-92:AC4] [NORMAL] The assigned coordinator must rework a Safety Rejected event to Planning';
 end if;
 if public.rework_safety_rejected_event(99203,'d9200000-0000-4000-8000-000000000002')
     is distinct from '{"outcome":"closed","status":"planning"}'::jsonb then
  raise exception '[SG2-92:rework-twice] [SG2-92:AC4] [CONFLICT] A reworked event cannot be reworked again';
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text from public.events where event_id=99203) is distinct from 'planning'
   or (select string_agg(actor_id::text||'|'||old_value||'|'||new_value, ' ; ' order by log_id)
     from public.event_audit_logs where event_id=99203 and field_name='status')
     is distinct from 'd9200000-0000-4000-8000-000000000004|awaiting_safety_check|safety_rejected'
       ||' ; d9200000-0000-4000-8000-000000000002|safety_rejected|planning'
   or (select count(*) from public.notifications where event_id=99203) <> 2 then
  raise exception '[SG2-92:rework-recorded] [SG2-92:AC4] [NORMAL] The rework must be in the history and send no notice';
 end if;
 if (select status::text from public.events where event_id in (99210)) is distinct from 'safety_rejected'
   or (select status::text from public.events where event_id=99211) is distinct from 'awaiting_safety_check' then
  raise exception '[SG2-92:rework-untouched] [SG2-92:AC4] [FAILURE] Refused reworks must write nothing';
 end if;
end $$;

-- AC6: the decisions are append-only and server-only.
do $$
declare client text;
begin
 foreach client in array array['anon','authenticated'] loop
  execute format('set local role %I', client);
  perform set_config('request.jwt.claim.sub','d9200000-0000-4000-8000-000000000004',true);
  begin
   perform 1 from public.event_safety_decisions;
   raise exception '[SG2-92:table-unreadable] [SG2-92:AC6] [FAILURE] % must not read safety decisions', client;
  exception when insufficient_privilege then null; end;
  begin
   insert into public.event_safety_decisions(event_id,decision,decided_by)
    values (99212,'approve','d9200000-0000-4000-8000-000000000004');
   raise exception '[SG2-92:table-unwritable] [SG2-92:AC6] [FAILURE] % must not write safety decisions', client;
  exception when insufficient_privilege then null; end;
  begin
   perform public.record_safety_decision(99212,'d9200000-0000-4000-8000-000000000004','approve',null,null,0);
   raise exception '[SG2-92:record-server-only] [SG2-92:AC1] [FAILURE] % must not record a decision directly', client;
  exception when insufficient_privilege then null; end;
  begin
   perform public.rework_safety_rejected_event(99210,'d9200000-0000-4000-8000-000000000002');
   raise exception '[SG2-92:rework-server-only] [SG2-92:AC4] [FAILURE] % must not rework an event directly', client;
  exception when insufficient_privilege then null; end;
  reset role;
 end loop;
 set local role service_role;
 begin
  update public.event_safety_decisions set reason='Rewritten' where event_id=99203;
  raise exception '[SG2-92:append-only-update] [SG2-92:AC6] [FAILURE] A decision must not be rewritten';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.event_safety_decisions where event_id=99203;
  raise exception '[SG2-92:append-only-delete] [SG2-92:AC6] [FAILURE] A decision must not be deleted';
 exception when insufficient_privilege then null; end;
 reset role;
end $$;
do $$
begin
 if (select status::text from public.events where event_id=99212) is distinct from 'awaiting_safety_check'
   or exists(select 1 from public.event_safety_decisions where event_id=99212)
   or (select reason from public.event_safety_decisions where event_id=99203) is distinct from 'No crowd management plan' then
  raise exception '[SG2-92:client-calls-no-writes] [SG2-92:AC6] [FAILURE] Refused calls must change nothing';
 end if;
 begin
  insert into public.event_safety_decisions(event_id,decision,decided_by)
   values (99212,'request_changes','d9200000-0000-4000-8000-000000000004');
  raise exception '[SG2-92:arrangements-constraint] [SG2-92:AC2] [FAILURE] Request Changes without arrangements must break a constraint';
 exception when check_violation then null; end;
 begin
  insert into public.event_safety_decisions(event_id,decision,reason,decided_by)
   values (99212,'reject',' ','d9200000-0000-4000-8000-000000000004');
  raise exception '[SG2-92:reason-constraint] [SG2-92:AC2] [FAILURE] A blank rejection reason must break a constraint';
 exception when check_violation then null; end;
 if not exists(select 1 from pg_constraint where conname='notifications_kind_check'
     and pg_get_constraintdef(oid) like '%safety_decision%'
     and pg_get_constraintdef(oid) like '%event_returned_to_planning%') then
  raise exception '[SG2-92:notice-kind-allowed] [SG2-92:AC5] [NORMAL] The safety decision notice kind must be allowed alongside every earlier kind';
 end if;
end $$;

-- SG2-92 with SG2-91: a decision on a review whose details have since changed
-- is refused with the current revision and writes nothing; the same decision
-- on the event as it now stands goes through.
set local role service_role;
do $$
declare
 seen bigint := pg_temp.rev(99213);
 result jsonb;
begin
 update public.events set expected_attendance = 450 where event_id = 99213;
 if pg_temp.rev(99213) is distinct from seen + 1 then
  raise exception '[SG2-92:revision-moves] [SG2-92:AC1] [BOUNDARY] A reviewed detail changing must move the safety check revision on';
 end if;
 result := public.record_safety_decision(99213,'d9200000-0000-4000-8000-000000000004','approve',null,null,seen);
 if result is distinct from jsonb_build_object('outcome','stale','revision',seen + 1) then
  raise exception '[SG2-92:stale-refused] [SG2-92:AC1] [CONFLICT] A decision on a review the event has moved on from must be refused with the current revision: %', result;
 end if;
 result := public.record_safety_decision(99213,'d9200000-0000-4000-8000-000000000004','approve',null,null,null);
 if result->>'outcome' is distinct from 'stale' then
  raise exception '[SG2-92:stale-missing-revision] [SG2-92:AC1] [FAILURE] A decision without the reviewed revision must be refused: %', result;
 end if;
 if (select status::text from public.events where event_id=99213) is distinct from 'awaiting_safety_check'
   or exists(select 1 from public.event_safety_decisions where event_id=99213)
   or exists(select 1 from public.notifications where event_id=99213)
   or exists(select 1 from public.event_audit_logs where event_id=99213 and field_name='safety_decision') then
  raise exception '[SG2-92:stale-no-writes] [SG2-92:AC1] [CONFLICT] A refused stale decision must write nothing';
 end if;
 result := public.record_safety_decision(99213,'d9200000-0000-4000-8000-000000000004','approve',null,null,seen + 1);
 if result->>'status' is distinct from 'preparation' then
  raise exception '[SG2-92:current-revision-accepted] [SG2-92:AC3] [NORMAL] The same decision on the current revision must go through: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if exists(select 1 from pg_proc where proname = 'record_safety_decision' and pronargs = 5) then
  raise exception '[SG2-92:old-signature-gone] [SG2-92:AC1] [FAILURE] The decision without a revision must no longer be callable';
 end if;
end $$;
rollback;
