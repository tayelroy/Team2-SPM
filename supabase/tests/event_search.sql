-- SG2-70: internal users find an event by name or client organisation and
-- narrow it by date, state, venue, category and coordinator; only internal
-- roles may search, drafts are never found, and the filters applied are
-- echoed for the empty state. Category is required before submission.
-- Isolated fixture changes are rolled back.
begin;
insert into auth.users(id)
 select ('d7000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,10) n;
insert into public.users(user_id,name,role_id,organisation) values
 ('d7000000-0000-4000-8000-000000000001','Search organiser',1,'Harbour Foundation'),
 ('d7000000-0000-4000-8000-000000000002','Search coordinator Alice',2,null),
 ('d7000000-0000-4000-8000-000000000003','Search venue staff',3,null),
 ('d7000000-0000-4000-8000-000000000004','Search support',4,null),
 ('d7000000-0000-4000-8000-000000000005','Search attendee',5,null),
 ('d7000000-0000-4000-8000-000000000006','Search lead',6,null),
 ('d7000000-0000-4000-8000-000000000007','Search safety officer',7,null),
 ('d7000000-0000-4000-8000-000000000008','Search roleless',5,null),
 ('d7000000-0000-4000-8000-000000000009','Search coordinator Bob',2,null),
 ('d7000000-0000-4000-8000-000000000010','Search moved coordinator',2,null);
insert into public.account_roles(user_id,role) values
 ('d7000000-0000-4000-8000-000000000001','event_organiser'),
 ('d7000000-0000-4000-8000-000000000002','event_coordinator'),
 ('d7000000-0000-4000-8000-000000000003','venue_staff'),
 ('d7000000-0000-4000-8000-000000000004','technical_support_staff'),
 ('d7000000-0000-4000-8000-000000000005','attendee'),
 ('d7000000-0000-4000-8000-000000000006','event_coordinator_lead'),
 ('d7000000-0000-4000-8000-000000000007','safety_officer'),
 ('d7000000-0000-4000-8000-000000000009','event_coordinator'),
 ('d7000000-0000-4000-8000-000000000010','event_coordinator');
insert into public.venues(venue_id,name,location,capacity) values
 (99701,'Search Atrium','Level 1',300),
 (99702,'Search Annex','Level 2',40),
 (99703,'Search Retired Room','Level 3',20);
update public.venues set deleted_at=now(),deleted_by='d7000000-0000-4000-8000-000000000003' where venue_id=99703;

-- 99701 Harbour Gala (social, Alice, booked at Atrium, 1 Nov SG)
-- 99702 Coastal Leaders Summit (conference, Bob, requested at Annex, 2 Nov SG
--       because 16:30Z is 00:30 the next day in Singapore)
-- 99703 Quiet workshop (workshop, unassigned, released booking at Atrium)
-- 99704 Secret draft (draft, Harbour in its name, never found)
-- 99705 100% Club (other, literal percent sign in the name)
insert into public.events(event_id,organiser_id,coordinator_id,organisation,name,status,category,proposed_date) values
 (99701,'d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000002','Harbour Foundation',
  'Harbour Gala','planning','social','2031-11-01T02:00Z'),
 (99702,'d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000009','Coastal Partners',
  'Coastal Leaders Summit','approved','conference','2031-11-01T16:30Z'),
 (99703,'d7000000-0000-4000-8000-000000000001',null,'Quiet Trust',
  'Quiet workshop','unassigned','workshop','2031-11-05T02:00Z'),
 (99704,'d7000000-0000-4000-8000-000000000001',null,'Harbour Foundation',
  'Harbour secret draft','draft','social','2031-11-01T02:00Z'),
 (99705,'d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000002','Quiet Trust',
  '100% Club','confirmed','other','2031-12-01T02:00Z');
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
 (99701,99701,'2031-11-01T01:00Z','2031-11-01T09:00Z','confirmed');
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status,cancelled_at,cancellation_reason) values
 (99701,99703,'2031-11-05T01:00Z','2031-11-05T09:00Z','cancelled','2031-10-01T00:00Z','No longer needed');
insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status) values
 (99702,99702,'2031-11-01T16:00Z','2031-11-01T23:00Z','pending');

-- Ids of the events a search returns, in order, as a comma list.
create function pg_temp.ids(result jsonb) returns text language sql as $$
 select coalesce(string_agg(e->>'event_id', ',' order by o), '') from jsonb_array_elements(result->'events') with ordinality t(e, o)
  where (e->>'event_id')::integer between 99700 and 99799;
$$;
grant execute on function pg_temp.ids(jsonb) to authenticated;

-- AC1-AC4 as an Event Coordinator.
set local role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000002',true);
do $$
declare result jsonb;
begin
 result := public.search_events(p_query => 'harbour');
 if pg_temp.ids(result) <> '99701' then
  raise exception '[SG2-70:search-by-name] [SG2-70:AC1] [NORMAL] Searching "harbour" must find Harbour Gala by name, case-insensitively, and not the draft: %', pg_temp.ids(result);
 end if;
 if pg_temp.ids(public.search_events(p_query => '  coastal partners ')) <> '99702' then
  raise exception '[SG2-70:search-by-organisation] [SG2-70:AC1] [NORMAL] Searching the client organisation (trimmed) must find its event';
 end if;
 if pg_temp.ids(public.search_events(p_query => '%')) <> '99705' then
  raise exception '[SG2-70:wildcard-escaped] [SG2-70:AC1] [BOUNDARY] A percent sign must match itself, not every event';
 end if;
 if pg_temp.ids(public.search_events(p_query => '_')) <> '' then
  raise exception '[SG2-70:underscore-escaped] [SG2-70:AC1] [BOUNDARY] An underscore must match itself, not any single character';
 end if;
 if pg_temp.ids(public.search_events(p_query => '   ')) <> '99701,99702,99703,99705' then
  raise exception '[SG2-70:blank-query-all] [SG2-70:AC1] [BOUNDARY] A blank search must apply no text filter and order by date: %', pg_temp.ids(public.search_events(p_query => '   '));
 end if;

 if pg_temp.ids(public.search_events(p_date_from => '2031-11-01', p_date_to => '2031-11-01')) <> '99701' then
  raise exception '[SG2-70:date-singapore-day] [SG2-70:AC2] [BOUNDARY] A one-day range must use the Singapore calendar day, so 16:30Z on 1 Nov counts as 2 Nov';
 end if;
 if pg_temp.ids(public.search_events(p_date_from => '2031-11-02', p_date_to => '2031-11-05')) <> '99702,99703' then
  raise exception '[SG2-70:date-inclusive] [SG2-70:AC2] [BOUNDARY] Both ends of a date range must be inclusive';
 end if;
 if pg_temp.ids(public.search_events(p_status => 'approved')) <> '99702' then
  raise exception '[SG2-70:filter-state] [SG2-70:AC2] [NORMAL] The state filter must keep only events in that state';
 end if;
 if pg_temp.ids(public.search_events(p_status => 'draft')) <> '' then
  raise exception '[SG2-70:draft-state-empty] [SG2-70:AC3] [BOUNDARY] Filtering on Draft must still never return a draft';
 end if;
 if pg_temp.ids(public.search_events(p_venue_id => 99701)) <> '99701' then
  raise exception '[SG2-70:filter-venue-booked] [SG2-70:AC2] [NORMAL] The venue filter must find the booked event but not one whose booking there was released';
 end if;
 if pg_temp.ids(public.search_events(p_venue_id => 99702)) <> '99702' then
  raise exception '[SG2-70:filter-venue-requested] [SG2-70:AC2] [NORMAL] The venue filter must find an event with a pending request for the venue';
 end if;
 if pg_temp.ids(public.search_events(p_category => 'conference')) <> '99702' then
  raise exception '[SG2-70:filter-category] [SG2-70:AC2] [NORMAL] The category filter must keep only that category';
 end if;
 if pg_temp.ids(public.search_events(p_coordinator_id => 'd7000000-0000-4000-8000-000000000002')) <> '99701,99705' then
  raise exception '[SG2-70:filter-coordinator] [SG2-70:AC2] [NORMAL] The coordinator filter must keep only events assigned to them';
 end if;
 if pg_temp.ids(public.search_events(p_coordinator_id => 'not-a-coordinator')) <> '' then
  raise exception '[SG2-70:unknown-coordinator-empty] [SG2-70:AC2] [BOUNDARY] An id that is no coordinator''s must match no event rather than fail';
 end if;
 result := public.search_events(p_query => 'quiet', p_status => 'confirmed', p_category => 'other',
   p_coordinator_id => 'd7000000-0000-4000-8000-000000000002');
 if pg_temp.ids(result) <> '99705' then
  raise exception '[SG2-70:filters-combine] [SG2-70:AC2] [NORMAL] Filters must all apply together';
 end if;
 result := public.search_events(p_query => 'Harbour', p_date_from => '2031-11-01');
 if result->'events'->0->>'coordinator_name' <> 'Search coordinator Alice'
   or result->'events'->0->'venues' <> '["Search Atrium"]'::jsonb
   or result->'events'->0->>'category' <> 'social' or result->'events'->0->>'organisation' <> 'Harbour Foundation' then
  raise exception '[SG2-70:result-details] [SG2-70:AC1] [NORMAL] Each result must carry its organisation, category, coordinator and venues: %', result->'events'->0;
 end if;

 result := public.search_events(p_query => 'nothing like this', p_status => 'planning', p_venue_id => 99702,
   p_category => 'social', p_date_from => '2031-01-01', p_date_to => '2031-12-31',
   p_coordinator_id => 'd7000000-0000-4000-8000-000000000009');
 if result->'events' <> '[]'::jsonb or (result->>'truncated')::boolean
   or result->'filters' <> jsonb_build_object('query','nothing like this','date_from','2031-01-01','date_to','2031-12-31',
     'status','planning','venue_id',99702,'category','social','coordinator_id','d7000000-0000-4000-8000-000000000009') then
  raise exception '[SG2-70:empty-echoes-filters] [SG2-70:AC4] [NORMAL] No match must return an empty list with every filter in force: %', result;
 end if;
 if public.search_events()->'filters' <> jsonb_build_object('query',null,'date_from',null,'date_to',null,'status',null,
   'venue_id',null,'category',null,'coordinator_id',null) then
  raise exception '[SG2-70:no-filters-echoed] [SG2-70:AC4] [BOUNDARY] With no filters every echoed filter must be null';
 end if;

 begin
  perform public.search_events(p_date_from => '2031-11-02', p_date_to => '2031-11-01');
  raise exception '[SG2-70:reversed-dates] [SG2-70:AC2] [FAILURE] A start date after the end date must be refused';
 exception when invalid_parameter_value then null;
 end;

 result := public.event_search_options();
 if (select count(*) from jsonb_array_elements(result->'venues') v where v->>'name' like 'Search %') <> 2
   or exists (select 1 from jsonb_array_elements(result->'venues') v where (v->>'venue_id')::integer = 99703) then
  raise exception '[SG2-70:options-venues] [SG2-70:AC2] [NORMAL] The venue filter must offer every venue still listed and no deleted one';
 end if;
 if (select string_agg(c->>'name', ',' order by c->>'name') from jsonb_array_elements(result->'coordinators') c
     where c->>'name' like 'Search %') <> 'Search coordinator Alice,Search coordinator Bob,Search moved coordinator' then
  raise exception '[SG2-70:options-coordinators] [SG2-70:AC2] [NORMAL] The coordinator filter must offer every Event Coordinator and no other role';
 end if;
end $$;
reset role;

-- AC1 boundary: at most 100 events, and truncated says more matched.
insert into public.events(event_id,organiser_id,organisation,name,status,category,proposed_date)
 select 99800+n,'d7000000-0000-4000-8000-000000000001','Bulk Org','Bulk event '||n,'submitted','seminar',
  '2032-01-01T02:00Z'::timestamptz+n*interval '1 hour' from generate_series(1,101) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000002',true);
do $$
declare result jsonb;
begin
 result := public.search_events(p_query => 'Bulk event');
 if jsonb_array_length(result->'events') <> 100 or not (result->>'truncated')::boolean
   or result->'events'->0->>'event_id' <> '99801' or result->'events'->99->>'event_id' <> '99900' then
  raise exception '[SG2-70:page-limit] [SG2-70:AC1] [BOUNDARY] More than 100 matches must return the first 100 by date and say it was truncated';
 end if;
end $$;
reset role;
delete from public.events where event_id = 99801;
set local role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000002',true);
do $$
declare result jsonb;
begin
 result := public.search_events(p_query => 'Bulk event');
 if jsonb_array_length(result->'events') <> 100 or (result->>'truncated')::boolean then
  raise exception '[SG2-70:page-exact] [SG2-70:AC1] [BOUNDARY] Exactly 100 matches must all be returned without being marked truncated';
 end if;
end $$;
reset role;

-- AC3: every internal role may search; nobody else may.
create function pg_temp.can_search(p_user uuid) returns boolean language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
 perform public.search_events(p_query => 'Harbour');
 perform public.event_search_options();
 return true;
exception when insufficient_privilege then return false;
end $$;
grant execute on function pg_temp.can_search(uuid) to authenticated;
set local role authenticated;
do $$
declare who uuid;
begin
 foreach who in array array['d7000000-0000-4000-8000-000000000002','d7000000-0000-4000-8000-000000000003',
   'd7000000-0000-4000-8000-000000000004','d7000000-0000-4000-8000-000000000006',
   'd7000000-0000-4000-8000-000000000007']::uuid[] loop
  if not pg_temp.can_search(who) then
   raise exception '[SG2-70:internal-roles-search] [SG2-70:AC3] [NORMAL] Internal account % must be able to search', who;
  end if;
 end loop;
 foreach who in array array['d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000005',
   'd7000000-0000-4000-8000-000000000008']::uuid[] loop
  if pg_temp.can_search(who) then
   raise exception '[SG2-70:external-roles-refused] [SG2-70:AC3] [FAILURE] Organiser, attendee or roleless account % must be refused', who;
  end if;
 end loop;
 if pg_temp.can_search(null) then
  raise exception '[SG2-70:anonymous-refused] [SG2-70:AC3] [FAILURE] A call with no signed-in user must be refused';
 end if;
end $$;
reset role;

-- AC3 conflict: a coordinator whose stored role changes after sign-in is
-- refused on the next search, not served from their old role.
update public.account_roles set role='event_organiser' where user_id='d7000000-0000-4000-8000-000000000010';
set local role authenticated;
do $$
begin
 if pg_temp.can_search('d7000000-0000-4000-8000-000000000010') then
  raise exception '[SG2-70:role-change-refused] [SG2-70:AC3] [CONFLICT] A role changed after sign-in must be refused by the stored-role check';
 end if;
end $$;
reset role;

-- AC3: the helpers and the table itself stay closed to clients.
set local role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000002',true);
do $$
begin
 begin
  perform public.event_search_venue_ids(99701);
  raise exception '[SG2-70:helper-closed] [SG2-70:AC3] [FAILURE] Clients must not call the venue helper directly';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.event_search_caller_is_internal();
  raise exception '[SG2-70:role-helper-closed] [SG2-70:AC3] [FAILURE] Clients must not call the role helper directly';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
set local role anon;
do $$
begin
 perform public.search_events();
 raise exception '[SG2-70:anon-execute-closed] [SG2-70:AC3] [FAILURE] The anon role must not execute search_events';
exception when insufficient_privilege then null;
end $$;
reset role;

-- AC2: category values and the submit backstop.
do $$
begin
 begin
  update public.events set category='party' where event_id=99701;
  raise exception '[SG2-70:category-known] [SG2-70:AC2] [FAILURE] A category outside the list must be refused';
 exception when check_violation then null;
 end;
 if (select category from public.events where event_id=99701) <> 'social' then
  raise exception '[SG2-70:category-unchanged] [SG2-70:AC2] [FAILURE] A refused category must leave the event unchanged';
 end if;
end $$;

insert into public.events(event_id,organiser_id,organisation,name,status) values
 (99710,'d7000000-0000-4000-8000-000000000001','Harbour Foundation','No category yet','draft'),
 (99711,'d7000000-0000-4000-8000-000000000001','Harbour Foundation','Asked a question','needs_clarification'),
 (99713,'d7000000-0000-4000-8000-000000000001','Harbour Foundation','Legacy planning','planning');
insert into public.events(event_id,organiser_id,organisation,name,status,decision_reason) values
 (99712,'d7000000-0000-4000-8000-000000000001','Harbour Foundation','Rejected before','rejected','Date clashes');
do $$
declare target integer;
begin
 foreach target in array array[99710, 99711, 99712] loop
  begin
   update public.events set status='unassigned' where event_id=target;
   raise exception '[SG2-70:submit-needs-category] [SG2-70:AC2] [FAILURE] Event % must not be submitted without a category', target;
  exception when check_violation then null;
  end;
 end loop;
 begin
  update public.events set status='submitted', coordinator_id='d7000000-0000-4000-8000-000000000002' where event_id=99711;
  raise exception '[SG2-70:resubmit-needs-category] [SG2-70:AC2] [FAILURE] A held request must not go back to its coordinator without a category';
 exception when check_violation then null;
 end;
 if (select status from public.events where event_id=99710) <> 'draft' then
  raise exception '[SG2-70:refused-stays-draft] [SG2-70:AC2] [FAILURE] A refused submission must leave the request a draft';
 end if;
 update public.events set status='awaiting_safety_check' where event_id=99713;
 if (select status from public.events where event_id=99713) <> 'awaiting_safety_check' then
  raise exception '[SG2-70:other-moves-unchecked] [SG2-70:AC2] [BOUNDARY] Moves other than submission must not need a category';
 end if;
 update public.events set category='seminar' where event_id=99710;
 update public.events set status='unassigned' where event_id=99710;
 if (select status from public.events where event_id=99710) <> 'unassigned' then
  raise exception '[SG2-70:submit-with-category] [SG2-70:AC2] [NORMAL] A request with a category must submit';
 end if;
end $$;

-- AC2: the draft save stores the category, records it in the history and
-- refuses one outside the list.
insert into public.events(event_id,organiser_id,organisation,name,status) values
 (99720,'d7000000-0000-4000-8000-000000000001','Harbour Foundation','Draft to categorise','draft');
do $$
declare result jsonb;
begin
 result := public.update_event_request_draft(99720,'d7000000-0000-4000-8000-000000000001',
   '{"name":"Draft to categorise","category":"training"}');
 if result->>'outcome' <> 'updated' or result->'request'->>'category' <> 'training'
   or (select category from public.events where event_id=99720) <> 'training' then
  raise exception '[SG2-70:draft-saves-category] [SG2-70:AC2] [NORMAL] Saving a draft must store its category: %', result;
 end if;
 if not exists (select 1 from public.event_audit_logs where event_id=99720 and field_name='category'
     and old_value is null and new_value='training') then
  raise exception '[SG2-70:category-in-history] [SG2-70:AC2] [NORMAL] The category change must be recorded in the history';
 end if;
 result := public.update_event_request_draft(99720,'d7000000-0000-4000-8000-000000000001',
   '{"name":"Draft to categorise","category":"party"}');
 if result->>'outcome' <> 'invalid' or (select category from public.events where event_id=99720) <> 'training' then
  raise exception '[SG2-70:draft-refuses-unknown] [SG2-70:AC2] [FAILURE] A draft save with an unknown category must be refused and change nothing';
 end if;
 result := public.update_event_request_draft(99720,'d7000000-0000-4000-8000-000000000001',
   '{"name":"Draft to categorise","category":7}');
 if result->>'outcome' <> 'invalid' then
  raise exception '[SG2-70:draft-refuses-non-text] [SG2-70:AC2] [FAILURE] A non-text category must be refused';
 end if;
 -- A draft may still clear its category; only submission needs one.
 result := public.update_event_request_draft(99720,'d7000000-0000-4000-8000-000000000001',
   '{"name":"Draft to categorise"}');
 if result->>'outcome' <> 'updated' or (select category from public.events where event_id=99720) is not null then
  raise exception '[SG2-70:draft-may-omit] [SG2-70:AC2] [BOUNDARY] A draft must still save without a category';
 end if;
 -- CONFLICT: the save above cleared the category the organiser had picked;
 -- a submission racing it reads the row the save wrote and is refused.
 begin
  update public.events set status='unassigned' where event_id=99720 and status='draft';
  raise exception '[SG2-70:race-save-then-submit] [SG2-70:AC2] [CONFLICT] A submission after a save that cleared the category must be refused';
 exception when check_violation then null;
 end;
end $$;

rollback;
