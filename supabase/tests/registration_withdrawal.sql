-- SG2-62: an attendee sees and withdraws their registrations. Isolated
-- fixture changes are rolled back. The withdraw-and-register race for the
-- last place is test-registration-concurrency.mjs.
begin;
insert into auth.users(id)
 select ('e6200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
insert into public.users(user_id,name,role_id,organisation,phone) values
 ('e6200000-0000-4000-8000-000000000001','Wd organiser',1,'Wd org',null),
 ('e6200000-0000-4000-8000-000000000002','Wd coordinator',2,null,null),
 ('e6200000-0000-4000-8000-000000000003','Wd attendee A',5,null,null),
 ('e6200000-0000-4000-8000-000000000004','Wd attendee B',5,null,null),
 ('e6200000-0000-4000-8000-000000000005','Wd attendee and organiser',5,'Wd org',null),
 ('e6200000-0000-4000-8000-000000000006','',5,null,null);
insert into public.account_roles(user_id,role) values
 ('e6200000-0000-4000-8000-000000000001','event_organiser'),
 ('e6200000-0000-4000-8000-000000000002','event_coordinator'),
 ('e6200000-0000-4000-8000-000000000003','attendee'),
 ('e6200000-0000-4000-8000-000000000004','attendee'),
 ('e6200000-0000-4000-8000-000000000005','attendee'),
 ('e6200000-0000-4000-8000-000000000005','event_organiser'),
 ('e6200000-0000-4000-8000-000000000006','attendee');
insert into public.venues(venue_id,name,location,capacity) values (96251,'Wd Hall','Level 3',100);

-- 96201 Closed forum: registration closed yesterday, starts in 5 days, capacity 1 (full: A holds it).
-- 96202 Open forum: open, capacity 10, no coordinator, 20 Jul 2030 19:00 SGT at Wd Hall.
-- 96203 Started forum: started an hour ago.
-- 96204 Completed forum. 96205 Cancelled forum.
-- 96206 Unlimited forum: open, no capacity set.
-- 96207 Withdrawn forum: A withdrew earlier. 96208 B's forum: only B holds a place.
-- 96209 Edge forum: starts at the transaction's start, so every attempt is at or after it.
insert into public.events(event_id,organiser_id,coordinator_id,organisation,name,category,description,status,proposed_date,
  registration_needed,registration_capacity,registration_opens_at,registration_closes_at) values
 (96201,'e6200000-0000-4000-8000-000000000001','e6200000-0000-4000-8000-000000000002','Wd org','Closed forum','seminar','A closed one','confirmed',
  now()+interval '5 days',true,1,now()-interval '5 days',now()-interval '1 day'),
 (96202,'e6200000-0000-4000-8000-000000000001',null,'Wd org','Open forum',null,null,'confirmed',
  '2030-07-20 11:00+00',true,10,now()-interval '1 day',now()+interval '10 days'),
 (96203,'e6200000-0000-4000-8000-000000000001',null,'Wd org','Started forum',null,null,'confirmed',
  now()-interval '1 hour',true,10,now()-interval '3 days',now()+interval '1 hour'),
 (96204,'e6200000-0000-4000-8000-000000000001',null,'Wd org','Completed forum',null,null,'confirmed',
  now()+interval '3 days',true,10,now()-interval '9 days',now()-interval '8 days'),
 (96205,'e6200000-0000-4000-8000-000000000001',null,'Wd org','Cancelled forum',null,null,'cancelled',
  now()+interval '3 days',true,10,now()-interval '1 day',now()+interval '1 day'),
 (96206,'e6200000-0000-4000-8000-000000000001','e6200000-0000-4000-8000-000000000002','Wd org','Unlimited forum',null,null,'confirmed',
  now()+interval '6 days',true,null,now()-interval '1 day',now()+interval '2 days'),
 (96207,'e6200000-0000-4000-8000-000000000001',null,'Wd org','Withdrawn forum',null,null,'confirmed',
  now()+interval '7 days',true,10,now()-interval '1 day',now()+interval '2 days'),
 (96208,'e6200000-0000-4000-8000-000000000001',null,'Wd org','B''s forum',null,null,'confirmed',
  now()+interval '8 days',true,10,now()-interval '1 day',now()+interval '2 days'),
 (96209,'e6200000-0000-4000-8000-000000000001',null,'Wd org','Edge forum',null,null,'confirmed',
  now(),true,10,now()-interval '3 days',now()-interval '1 day');
-- Completion needs its record (SG2-100); the start stays ahead so only the status decides.
update public.events set status = 'completed', completed_by = 'e6200000-0000-4000-8000-000000000001', completed_at = now()
 where event_id = 96204;
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
 (96251,96202,'2030-07-20 10:00+00','2030-07-20 14:00+00','confirmed');
insert into public.registrations(registration_id,event_id,attendee_id,status,registered_at,contact_phone,needs,withdrawn_at) values
 (962001,96201,'e6200000-0000-4000-8000-000000000003','registered',now()-interval '4 days','91234567','Vegetarian',null),
 (962002,96202,'e6200000-0000-4000-8000-000000000003','registered',now()-interval '3 hours','91234567',null,null),
 (962003,96203,'e6200000-0000-4000-8000-000000000003','registered',now()-interval '2 days','91234567',null,null),
 (962004,96204,'e6200000-0000-4000-8000-000000000003','registered',now()-interval '9 days','91234567',null,null),
 (962005,96205,'e6200000-0000-4000-8000-000000000003','registered',now()-interval '1 day','91234567',null,null),
 (962006,96206,'e6200000-0000-4000-8000-000000000003','registered',now()-interval '1 day','91234567',null,null),
 (962007,96207,'e6200000-0000-4000-8000-000000000003','cancelled',now()-interval '1 day','91234567',null,now()-interval '1 hour'),
 (962008,96208,'e6200000-0000-4000-8000-000000000004','registered',now()-interval '1 day','98765432',null,null),
 (962009,96209,'e6200000-0000-4000-8000-000000000003','registered',now()-interval '4 days','91234567',null,null),
 (962010,96202,'e6200000-0000-4000-8000-000000000006','registered',now()-interval '1 hour','92345678',null,null);

create function pg_temp.act(p_user uuid, p_role text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', p_user::text, true);
 perform set_config('request.headers', case when p_role is null then '' else json_build_object('x-acting-role', p_role)::text end, true);
end $$;
grant execute on function pg_temp.act(uuid, text) to authenticated;
-- The outcome of one withdrawal.
create function pg_temp.try(p_registration integer) returns text language sql as $$
 select public.withdraw_registration(p_registration)->>'outcome';
$$;
grant execute on function pg_temp.try(integer) to authenticated;

set local role authenticated;
-- AC1: the attendee sees every registration they made, and where each stands.
do $$
declare mine jsonb; open jsonb;
begin
 perform pg_temp.act('e6200000-0000-4000-8000-000000000003', null);
 mine := public.my_registrations();
 if (select string_agg(m.v->>'event_id' || ':' || (m.v->>'standing') || ':' || (m.v->>'can_withdraw'), ',' order by m.ord)
     from jsonb_array_elements(mine) with ordinality m(v, ord))
   is distinct from '96201:registered:true,96206:registered:true,96202:registered:true,96203:event_started:false,96209:event_started:false,96204:event_completed:false,96205:event_cancelled:false,96207:withdrawn:false' then
  raise exception '[SG2-62:lists-mine-with-standing] [SG2-62:AC1] [NORMAL] Every registration the attendee made must be listed with where it stands, active upcoming ones first, soonest first: %', mine;
 end if;
 open := (select m from jsonb_array_elements(mine) m where m->>'event_id' = '96202');
 if open->'event'->>'name' <> 'Open forum' or open->'event'->>'organisation' <> 'Wd org'
   or (open->'event'->>'proposed_date')::timestamptz <> '2030-07-20 11:00+00'
   or open->'event'->'venues' <> '[{"name": "Wd Hall", "location": "Level 3"}]'::jsonb
   or open->>'contact_phone' <> '91234567' or (open->>'registration_id')::integer <> 962002 then
  raise exception '[SG2-62:event-details] [SG2-62:AC1] [NORMAL] Each registration must carry the event name, organiser, date, time, venue and what the attendee gave: %', open;
 end if;
 if (select m->'event'->>'category' || '|' || (m->'event'->>'description') || '|' || (m->>'needs')
     from jsonb_array_elements(mine) m where m->>'event_id' = '96201') is distinct from 'seminar|A closed one|Vegetarian' then
  raise exception '[SG2-62:closed-still-listed] [SG2-62:AC1] [BOUNDARY] A registration stays listed, with its details, after registration closes';
 end if;
 if exists(select 1 from jsonb_array_elements(mine) m, jsonb_object_keys(m->'event') k
     where k in ('status', 'organiser_id', 'coordinator_id', 'registration_capacity', 'planning_notes')) then
  raise exception '[SG2-62:attendee-facing-only] [SG2-62:AC1] [FAILURE] The list must carry only attendee-facing event fields';
 end if;
 if exists(select 1 from jsonb_array_elements(mine) m where m->>'event_id' = '96208') then
  raise exception '[SG2-62:only-own] [SG2-62:AC1] [FAILURE] Another attendee''s registration must never be listed';
 end if;

 -- Holding two roles, they say they act as an attendee (SG2-104).
 perform pg_temp.act('e6200000-0000-4000-8000-000000000005', 'attendee');
 if public.my_registrations() <> '[]'::jsonb then
  raise exception '[SG2-62:none-yet] [SG2-62:AC1] [BOUNDARY] An attendee with no registrations gets an empty list';
 end if;
end $$;

-- AC1, AC2: every role but attendee is refused, and anon cannot call either function.
do $$
declare role_name text; refused integer := 0;
begin
 foreach role_name in array array['event_organiser','event_coordinator','venue_staff','technical_support_staff','event_coordinator_lead','safety_officer'] loop
  perform pg_temp.act('e6200000-0000-4000-8000-000000000005', role_name);
  begin
   perform public.my_registrations();
  exception when insufficient_privilege then refused := refused + 1;
  end;
  begin
   perform public.withdraw_registration(962002);
  exception when insufficient_privilege then refused := refused + 1;
  end;
 end loop;
 if refused <> 12 then
  raise exception '[SG2-62:other-roles-refused] [SG2-62:AC1] [SG2-62:AC2] [FAILURE] Only an attendee acting role may list or withdraw registrations (% of 12 refused)', refused;
 end if;
 perform set_config('request.jwt.claim.sub', '', true);
 begin
  perform public.my_registrations();
  raise exception '[SG2-62:no-caller-refused] [SG2-62:AC1] [FAILURE] Without a signed-in caller the list must be refused';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

do $$
begin
 if has_function_privilege('anon', 'public.my_registrations()', 'EXECUTE')
   or has_function_privilege('anon', 'public.withdraw_registration(integer)', 'EXECUTE')
   or has_function_privilege('service_role', 'public.withdraw_registration(integer)', 'EXECUTE')
   or not has_function_privilege('authenticated', 'public.my_registrations()', 'EXECUTE')
   or not has_function_privilege('authenticated', 'public.withdraw_registration(integer)', 'EXECUTE') then
  raise exception '[SG2-62:grants] [SG2-62:AC2] [FAILURE] Only signed-in callers, through their own JWT, may list or withdraw';
 end if;
end $$;

-- AC2, AC3: withdrawing after registration closed, before the start, frees the full event's place.
set local role authenticated;
do $$
declare result jsonb;
begin
 perform pg_temp.act('e6200000-0000-4000-8000-000000000003', null);
 result := public.withdraw_registration(962001);
 if result->>'outcome' <> 'ok' or (result->'registration'->>'registration_id')::integer <> 962001
   or (result->'registration'->>'event_id')::integer <> 96201 or (result->'registration'->>'withdrawn_at') is null then
  raise exception '[SG2-62:withdraws-after-close] [SG2-62:AC2] [NORMAL] An active registration must be withdrawable before the start even though registration has closed: %', result;
 end if;
 if (select m->>'standing' || '|' || (m->>'can_withdraw') || '|' || ((m->>'withdrawn_at') is not null)::text
     from jsonb_array_elements(public.my_registrations()) m where m->>'event_id' = '96201') <> 'withdrawn|false|true' then
  raise exception '[SG2-62:shown-withdrawn] [SG2-62:AC1] [SG2-62:AC2] [NORMAL] Once withdrawn the list must say so, with when, and offer no withdrawal';
 end if;
 if pg_temp.try(962001) <> 'withdrawn' or pg_temp.try(962007) <> 'withdrawn' then
  raise exception '[SG2-62:withdraw-twice] [SG2-62:AC2] [CONFLICT] A registration already withdrawn cannot be withdrawn again';
 end if;
end $$;
reset role;

do $$
begin
 if (select status || '|' || (withdrawn_at is not null)::text from public.registrations where registration_id = 962001) <> 'cancelled|true' then
  raise exception '[SG2-62:stored-cancelled] [SG2-62:AC3] [NORMAL] A withdrawal must store the registration as cancelled with when it was withdrawn';
 end if;
 if (public.event_registration_overview(96201)->'attendees') <> '[]'::jsonb then
  raise exception '[SG2-62:left-the-picture] [SG2-62:AC3] [NORMAL] The withdrawn attendee must leave the organiser''s registration picture';
 end if;
 begin
  update public.registrations set withdrawn_at = now() where registration_id = 962002;
  raise exception '[SG2-62:withdrawn-means-cancelled] [SG2-62:AC3] [FAILURE] A withdrawal time must only be stored on a cancelled registration';
 exception when check_violation then null;
 end;
end $$;

-- AC3: the freed place on the full event can now be taken. 96201 has
-- closed, so it is opened again for the capacity, not the window, to decide.
update public.events set registration_closes_at = now() + interval '1 day' where event_id = 96201;
set local role authenticated;
do $$
begin
 perform pg_temp.act('e6200000-0000-4000-8000-000000000004', null);
 if public.register_for_event(96201, '98765432', null)->>'outcome' <> 'ok' then
  raise exception '[SG2-62:place-returned] [SG2-62:AC3] [NORMAL] The place a withdrawal frees must be available to register for';
 end if;
 if public.register_for_event(96201, '98765432', null)->>'outcome' <> 'duplicate' then
  raise exception '[SG2-62:capacity-counted] [SG2-62:AC3] [BOUNDARY] The new registration fills the place again';
 end if;
 -- The attendee who withdrew may come back when a place is free.
 perform pg_temp.act('e6200000-0000-4000-8000-000000000003', null);
 if public.register_for_event(96201, '91234567', null)->>'outcome' <> 'full' then
  raise exception '[SG2-62:refilled-full] [SG2-62:AC3] [BOUNDARY] With the freed place taken the event is full again';
 end if;
 if public.register_for_event(96207, '91234567', null)->>'outcome' <> 'ok' then
  raise exception '[SG2-62:register-again] [SG2-62:AC3] [NORMAL] An attendee who withdrew can register again while registration is open';
 end if;
end $$;
reset role;

-- AC4: at or after the start time the withdrawal is refused as started.
set local role authenticated;
do $$
declare result jsonb;
begin
 perform pg_temp.act('e6200000-0000-4000-8000-000000000003', null);
 result := public.withdraw_registration(962003);
 if result->>'outcome' <> 'started' or (result->>'proposed_date') is null then
  raise exception '[SG2-62:refused-after-start] [SG2-62:AC4] [FAILURE] After the start time the withdrawal must be refused as started, with the start time: %', result;
 end if;
 if pg_temp.try(962009) <> 'started' then
  raise exception '[SG2-62:refused-at-start] [SG2-62:AC4] [BOUNDARY] At the exact start time the withdrawal must be refused';
 end if;
 if pg_temp.try(962004) <> 'started' then
  raise exception '[SG2-62:refused-completed] [SG2-62:AC4] [FAILURE] A completed event''s registration cannot be withdrawn';
 end if;
 if pg_temp.try(962005) <> 'cancelled' then
  raise exception '[SG2-62:refused-cancelled-event] [SG2-62:AC2] [FAILURE] A cancelled event''s registration has nothing to withdraw from';
 end if;
 if pg_temp.try(962008) <> 'missing' or pg_temp.try(1) <> 'missing' then
  raise exception '[SG2-62:not-mine] [SG2-62:AC2] [FAILURE] Another attendee''s registration, or none, must not be withdrawn';
 end if;
end $$;
reset role;

do $$
begin
 if (select string_agg(registration_id::text || ':' || status, ',' order by registration_id) from public.registrations
     where registration_id in (962003, 962004, 962005, 962008, 962009))
   <> '962003:registered,962004:registered,962005:registered,962008:registered,962009:registered' then
  raise exception '[SG2-62:refusals-change-nothing] [SG2-62:AC4] [FAILURE] A refused withdrawal must leave the registration as it was';
 end if;
end $$;

-- AC5: a withdrawal tells the organiser and the coordinator, with the places now remaining.
set local role authenticated;
do $$
begin
 perform pg_temp.act('e6200000-0000-4000-8000-000000000003', null);
 if pg_temp.try(962002) <> 'ok' or pg_temp.try(962006) <> 'ok' then
  raise exception '[SG2-62:withdraws-open] [SG2-62:AC2] [NORMAL] An open event''s registration must be withdrawable';
 end if;
 perform pg_temp.act('e6200000-0000-4000-8000-000000000006', null);
 if pg_temp.try(962010) <> 'ok' then
  raise exception '[SG2-62:unnamed-withdraws] [SG2-62:AC2] [NORMAL] An attendee without a name can withdraw';
 end if;
end $$;
reset role;

do $$
begin
 if (select string_agg(recipient_id::text || '|' || kind || '|' || message, ';' order by notification_id) from public.notifications
     where event_id = 96201 and kind = 'registration_withdrawn')
   is distinct from 'e6200000-0000-4000-8000-000000000001|registration_withdrawn|Wd attendee A withdrew from Closed forum. 1 of 1 places now remain.;'
     || 'e6200000-0000-4000-8000-000000000002|registration_withdrawn|Wd attendee A withdrew from Closed forum. 1 of 1 places now remain.' then
  raise exception '[SG2-62:organiser-and-coordinator-told] [SG2-62:AC5] [NORMAL] The organiser and the assigned coordinator must each be told once, with the places remaining';
 end if;
 if (select string_agg(recipient_id::text || '|' || message, ';' order by notification_id) from public.notifications
     where event_id = 96202 and kind = 'registration_withdrawn')
   is distinct from 'e6200000-0000-4000-8000-000000000001|Wd attendee A withdrew from Open forum. 9 of 10 places now remain.;'
     || 'e6200000-0000-4000-8000-000000000001|An attendee withdrew from Open forum. 10 of 10 places now remain.' then
  raise exception '[SG2-62:no-coordinator] [SG2-62:AC5] [BOUNDARY] Without a coordinator only the organiser is told; an unnamed attendee is "An attendee"';
 end if;
 if (select string_agg(message, ';') from public.notifications where event_id = 96206 and kind = 'registration_withdrawn')
   is distinct from 'Wd attendee A withdrew from Unlimited forum.;Wd attendee A withdrew from Unlimited forum.' then
  raise exception '[SG2-62:unlimited-places] [SG2-62:AC5] [BOUNDARY] Without a capacity the notice names no place count';
 end if;
 if exists(select 1 from public.notifications where kind = 'registration_withdrawn'
     and (recipient_id in ('e6200000-0000-4000-8000-000000000003', 'e6200000-0000-4000-8000-000000000006')
       or event_id in (96203, 96204, 96205, 96207, 96208, 96209))) then
  raise exception '[SG2-62:only-staff-told] [SG2-62:AC5] [FAILURE] Only the organiser and coordinator are told, and only of withdrawals that happened';
 end if;
end $$;

rollback;
