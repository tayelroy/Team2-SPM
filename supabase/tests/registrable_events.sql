-- SG2-59: attendees find the events they can register for (open now or
-- opening later) and read only their attendee-facing details. Isolated
-- fixture changes are rolled back.
begin;
insert into auth.users(id)
 select ('e5900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
insert into public.users(user_id,name,role_id,organisation) values
 ('e5900000-0000-4000-8000-000000000001','Find organiser',1,'Find org'),
 ('e5900000-0000-4000-8000-000000000002','Find coordinator',2,null),
 ('e5900000-0000-4000-8000-000000000003','Find attendee',5,null),
 ('e5900000-0000-4000-8000-000000000004','Find attendee and organiser',5,'Find org'),
 ('e5900000-0000-4000-8000-000000000005','Find roleless',5,null),
 ('e5900000-0000-4000-8000-000000000006','Find lead',6,null);
insert into public.account_roles(user_id,role) values
 ('e5900000-0000-4000-8000-000000000001','event_organiser'),
 ('e5900000-0000-4000-8000-000000000002','event_coordinator'),
 ('e5900000-0000-4000-8000-000000000003','attendee'),
 ('e5900000-0000-4000-8000-000000000004','attendee'),
 ('e5900000-0000-4000-8000-000000000004','event_organiser'),
 ('e5900000-0000-4000-8000-000000000006','event_coordinator_lead');
insert into public.venues(venue_id,name,location,capacity) values
 (95951,'Find Hall','Level 1, Find Building',200),
 (95952,'Find Annex','Level 2',40),
 (95953,'Find Released Room','Level 3',20);

-- 95901 Open forum: confirmed, open since yesterday, booked at Hall and Annex
--       (plus a cancelled booking at the Released Room), starts in 30 days.
-- 95902 Upcoming forum: confirmed, opens in 2 days, starts in 20 days.
-- 95903 Closed forum: confirmed, closed yesterday.
-- 95904 Planning forum: planning, inside its window.
-- 95905 Walk-in forum: confirmed, no registration.
-- 95906 Unset forum: confirmed, registration needed but no times.
-- 95907 Started forum: confirmed, started an hour ago, closing time still ahead.
-- 95908 Unanswered forum: confirmed, registration_needed null.
-- 95909 Cancelled forum: cancelled, inside its window.
-- 95910 Half-set forum: confirmed, a closing time but no opening time.
insert into public.events(event_id,organiser_id,coordinator_id,organisation,name,status,category,description,
  purpose,planning_notes,venue_requirements,accessibility_needs,equipment_requirements,expected_attendance,
  proposed_date,registration_needed,registration_capacity,registration_opens_at,registration_closes_at) values
 (95901,'e5900000-0000-4000-8000-000000000001','e5900000-0000-4000-8000-000000000002','Find org','Open forum',
  'confirmed','seminar','Talks and a panel.','Internal purpose text','Secret planning note','Big room',
  'Ramp for the speaker','Two lapel mics',120,now()+interval '30 days',true,100,now()-interval '1 day',now()+interval '10 days'),
 (95902,'e5900000-0000-4000-8000-000000000001',null,'Find org','Upcoming forum','confirmed','workshop',null,
  null,null,null,null,null,null,now()+interval '20 days',true,50,now()+interval '2 days',now()+interval '9 days'),
 (95903,'e5900000-0000-4000-8000-000000000001',null,'Find org','Closed forum','confirmed',null,null,
  null,null,null,null,null,null,now()+interval '30 days',true,10,now()-interval '5 days',now()-interval '1 day'),
 (95904,'e5900000-0000-4000-8000-000000000001',null,'Find org','Planning forum','planning',null,null,
  null,null,null,null,null,null,now()+interval '30 days',true,10,now()-interval '1 day',now()+interval '9 days'),
 (95905,'e5900000-0000-4000-8000-000000000001',null,'Find org','Walk-in forum','confirmed',null,null,
  null,null,null,null,null,null,now()+interval '30 days',false,10,now()-interval '1 day',now()+interval '9 days'),
 (95906,'e5900000-0000-4000-8000-000000000001',null,'Find org','Unset forum','confirmed',null,null,
  null,null,null,null,null,null,now()+interval '30 days',true,null,null,null),
 (95907,'e5900000-0000-4000-8000-000000000001',null,'Find org','Started forum','confirmed',null,null,
  null,null,null,null,null,null,now()-interval '1 hour',true,10,now()-interval '3 days',now()+interval '1 hour'),
 (95908,'e5900000-0000-4000-8000-000000000001',null,'Find org','Unanswered forum','confirmed',null,null,
  null,null,null,null,null,null,now()+interval '30 days',null,10,now()-interval '1 day',now()+interval '9 days'),
 (95909,'e5900000-0000-4000-8000-000000000001',null,'Find org','Cancelled forum','cancelled',null,null,
  null,null,null,null,null,null,now()+interval '30 days',true,10,now()-interval '1 day',now()+interval '9 days'),
 (95910,'e5900000-0000-4000-8000-000000000001',null,'Find org','Half-set forum','confirmed',null,null,
  null,null,null,null,null,null,now()+interval '30 days',true,10,null,now()+interval '9 days');
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
 (95952,95901,now()+interval '30 days',now()+interval '30 days 4 hours','confirmed'),
 (95951,95901,now()+interval '30 days',now()+interval '30 days 4 hours','confirmed');
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status,cancelled_at,cancellation_reason) values
 (95953,95901,now()+interval '30 days',now()+interval '30 days 4 hours','cancelled',now(),'Moved');

-- Ids of the listed fixture events, in order, as a comma list.
create function pg_temp.ids(result jsonb) returns text language sql as $$
 select coalesce(string_agg(e->>'event_id', ',' order by o), '') from jsonb_array_elements(result) with ordinality t(e, o)
  where (e->>'event_id')::integer between 95900 and 95999;
$$;
grant execute on function pg_temp.ids(jsonb) to authenticated;
create function pg_temp.act(p_user uuid, p_role text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', p_user::text, true);
 perform set_config('request.headers', case when p_role is null then '' else json_build_object('x-acting-role', p_role)::text end, true);
end $$;
grant execute on function pg_temp.act(uuid, text) to authenticated;

set local role authenticated;
do $$
declare listed jsonb; detail jsonb;
begin
 perform pg_temp.act('e5900000-0000-4000-8000-000000000003', null);
 listed := public.registrable_events();
 if pg_temp.ids(listed) <> '95902,95901' then
  raise exception '[SG2-59:lists-open-and-upcoming] [SG2-59:AC1] [SG2-59:AC2] [NORMAL] An attendee must find only the confirmed events open or opening for registration, soonest first: %', pg_temp.ids(listed);
 end if;

 detail := (select e from jsonb_array_elements(listed) e where e->>'event_id' = '95901');
 if detail->>'name' IS DISTINCT FROM 'Open forum' or (detail->>'proposed_date')::timestamptz is null
   or detail->'venues' IS DISTINCT FROM '[{"name":"Find Annex","location":"Level 2"},{"name":"Find Hall","location":"Level 1, Find Building"}]'::jsonb then
  raise exception '[SG2-59:list-name-date-venue] [SG2-59:AC1] [NORMAL] Each listed event must carry its name, date and time and its confirmed venues only: %', detail;
 end if;
 if (select e->'venues' from jsonb_array_elements(listed) e where e->>'event_id' = '95902') IS DISTINCT FROM '[]'::jsonb then
  raise exception '[SG2-59:no-venue-empty-list] [SG2-59:AC1] [BOUNDARY] An event with no confirmed booking must list no venue, not fail';
 end if;
 if (select (e->>'registration_opens_at')::timestamptz > now() from jsonb_array_elements(listed) e where e->>'event_id' = '95902') is not true then
  raise exception '[SG2-59:upcoming-opening-time] [SG2-59:AC1] [NORMAL] An event not yet open must carry the time its registration opens';
 end if;

 -- AC3: exactly the attendee-facing fields, and none of the planning values.
 -- SG2-60 added 'registered': whether the caller already holds a place.
 detail := public.registrable_event(95901);
 if (select array_agg(k order by k) from jsonb_object_keys(detail) k) <> array['category','description','event_id','name',
     'organisation','proposed_date','registered','registration_closes_at','registration_opens_at','venues'] then
  raise exception '[SG2-59:detail-fields-only] [SG2-59:AC3] [NORMAL] The detail must hold only the attendee-facing fields: %', detail;
 end if;
 if detail::text ~ '(Secret planning note|Internal purpose text|Big room|Ramp for the speaker|lapel|e5900000|confirmed"|"120"|: 120|: 100)' then
  raise exception '[SG2-59:detail-no-internal-values] [SG2-59:AC3] [FAILURE] No planning, requirement, people, status, attendance or capacity value may reach an attendee: %', detail;
 end if;
 if detail->>'description' IS DISTINCT FROM 'Talks and a panel.' or detail->>'category' IS DISTINCT FROM 'seminar' or detail->>'organisation' IS DISTINCT FROM 'Find org' then
  raise exception '[SG2-59:detail-attendee-facts] [SG2-59:AC3] [NORMAL] The detail must describe the event to an attendee: %', detail;
 end if;
 if public.registrable_event(95902)->>'name' IS DISTINCT FROM 'Upcoming forum' then
  raise exception '[SG2-59:detail-upcoming] [SG2-59:AC3] [NORMAL] An event opening later must open too';
 end if;
end $$;

do $$
declare target integer;
begin
 perform pg_temp.act('e5900000-0000-4000-8000-000000000003', null);
 foreach target in array array[95903,95904,95905,95906,95907,95908,95909,95910,95999] loop
  if public.registrable_event(target) is not null then
   raise exception '[SG2-59:detail-unlisted-null] [SG2-59:AC2] [FAILURE] Event % is not listed, so its detail must not open', target;
  end if;
 end loop;
end $$;

-- AC1: the acting role must be attendee, in the database as well as the route.
do $$
declare refused integer := 0; who record;
begin
 for who in select * from (values
   ('e5900000-0000-4000-8000-000000000001'::uuid, null::text),
   ('e5900000-0000-4000-8000-000000000002', null),
   ('e5900000-0000-4000-8000-000000000006', null),
   ('e5900000-0000-4000-8000-000000000005', null),
   ('e5900000-0000-4000-8000-000000000004', null),
   ('e5900000-0000-4000-8000-000000000004', 'event_organiser'),
   ('e5900000-0000-4000-8000-000000000003', 'event_organiser')) w(user_id, acting) loop
  perform pg_temp.act(who.user_id, who.acting);
  begin
   perform public.registrable_events();
  exception when insufficient_privilege then refused := refused + 1;
  end;
  begin
   perform public.registrable_event(95901);
  exception when insufficient_privilege then refused := refused + 1;
  end;
 end loop;
 if refused <> 14 then
  raise exception '[SG2-59:non-attendee-refused] [SG2-59:AC1] [FAILURE] Only an account acting as attendee may read the list or a detail; refused %/14', refused;
 end if;

 perform pg_temp.act('e5900000-0000-4000-8000-000000000004', 'attendee');
 if pg_temp.ids(public.registrable_events()) <> '95902,95901' then
  raise exception '[SG2-59:acting-attendee-allowed] [SG2-59:AC1] [CONFLICT] An account with two roles acting as attendee must find the events';
 end if;

 perform set_config('request.jwt.claim.sub', '', true);
 begin
  perform public.registrable_events();
  raise exception '[SG2-59:anonymous-refused] [SG2-59:AC1] [FAILURE] A caller with no account must be refused';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

do $$
begin
 if has_function_privilege('anon', 'public.registrable_events()', 'execute')
   or has_function_privilege('anon', 'public.registrable_event(integer)', 'execute')
   or has_function_privilege('service_role', 'public.registrable_events()', 'execute')
   or has_function_privilege('authenticated', 'private.registrable_events_json(integer)', 'execute')
   or not has_function_privilege('authenticated', 'public.registrable_event(integer)', 'execute') then
  raise exception '[SG2-59:grants] [SG2-59:AC3] [FAILURE] Only signed-in callers may run the reads, and never the unchecked helper';
 end if;
end $$;

rollback;
