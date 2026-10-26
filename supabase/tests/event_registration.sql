-- SG2-60: an attendee registers for an event. Isolated fixture changes are
-- rolled back. The last-place race is test-registration-concurrency.mjs.
begin;
insert into auth.users(id)
 select ('e6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8) n;
insert into public.users(user_id,name,role_id,organisation,phone) values
 ('e6000000-0000-4000-8000-000000000001','Reg organiser',1,'Reg org',null),
 ('e6000000-0000-4000-8000-000000000002','Reg coordinator',2,null,null),
 ('e6000000-0000-4000-8000-000000000003','Reg attendee A',5,null,null),
 ('e6000000-0000-4000-8000-000000000004','Reg attendee B',5,null,null),
 ('e6000000-0000-4000-8000-000000000005','Reg attendee C',5,null,'+65 6000 0005'),
 ('e6000000-0000-4000-8000-000000000006','Reg attendee and organiser',5,'Reg org',null),
 ('e6000000-0000-4000-8000-000000000007','Reg roleless',5,null,null),
 ('e6000000-0000-4000-8000-000000000008','Reg attendee D',5,null,null);
insert into public.account_roles(user_id,role) values
 ('e6000000-0000-4000-8000-000000000001','event_organiser'),
 ('e6000000-0000-4000-8000-000000000002','event_coordinator'),
 ('e6000000-0000-4000-8000-000000000003','attendee'),
 ('e6000000-0000-4000-8000-000000000004','attendee'),
 ('e6000000-0000-4000-8000-000000000005','attendee'),
 ('e6000000-0000-4000-8000-000000000006','attendee'),
 ('e6000000-0000-4000-8000-000000000006','event_organiser'),
 ('e6000000-0000-4000-8000-000000000008','attendee');
insert into public.venues(venue_id,name,location,capacity) values
 (96051,'Reg Hall','Level 1',200),(96052,'Reg Annex','Level 2',40);

-- 96001 Open forum: open since yesterday, capacity 100, at Reg Hall and Reg Annex, 20 Jul 2030 19:00 SGT.
-- 96002 Upcoming forum: opens in 2 days.
-- 96003 Closed forum: closed yesterday.
-- 96004 Just-closed forum: closes at the transaction's start, so every attempt is at or after it.
-- 96005 Just-opened forum: opens at the transaction's start; no capacity set.
-- 96006 Small forum: capacity 2, one place held by C, a cancelled one by D.
-- 96007 Planning forum, 96008 Walk-in forum (no registration), 96009 Cancelled forum,
-- 96010 Unset forum (no times): none is an event an attendee may find.
-- 96011 Started forum: started an hour ago, closing time still ahead.
-- 96012 (no name): open, no venue.
insert into public.events(event_id,organiser_id,coordinator_id,organisation,name,status,proposed_date,
  registration_needed,registration_capacity,registration_opens_at,registration_closes_at) values
 (96001,'e6000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000002','Reg org','Open forum','confirmed',
  '2030-07-20 11:00+00',true,100,now()-interval '1 day',now()+interval '10 days'),
 (96002,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Upcoming forum','confirmed',
  now()+interval '20 days',true,50,now()+interval '2 days',now()+interval '9 days'),
 (96003,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Closed forum','confirmed',
  now()+interval '30 days',true,10,now()-interval '5 days',now()-interval '1 day'),
 (96004,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Just-closed forum','confirmed',
  now()+interval '30 days',true,10,now()-interval '1 day',now()),
 (96005,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Just-opened forum','confirmed',
  now()+interval '30 days',true,null,now(),now()+interval '9 days'),
 (96006,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Small forum','confirmed',
  now()+interval '30 days',true,2,now()-interval '1 day',now()+interval '9 days'),
 (96007,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Planning forum','planning',
  now()+interval '30 days',true,10,now()-interval '1 day',now()+interval '9 days'),
 (96008,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Walk-in forum','confirmed',
  now()+interval '30 days',false,10,now()-interval '1 day',now()+interval '9 days'),
 (96009,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Cancelled forum','cancelled',
  now()+interval '30 days',true,10,now()-interval '1 day',now()+interval '9 days'),
 (96010,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Unset forum','confirmed',
  now()+interval '30 days',true,10,null,null),
 (96011,'e6000000-0000-4000-8000-000000000001',null,'Reg org','Started forum','confirmed',
  now()-interval '1 hour',true,10,now()-interval '3 days',now()+interval '1 hour'),
 (96012,'e6000000-0000-4000-8000-000000000001',null,'Reg org','','confirmed',
  '2030-08-01 02:30+00',true,10,now()-interval '1 day',now()+interval '9 days');
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
 (96052,96001,'2030-07-20 10:00+00','2030-07-20 14:00+00','confirmed'),
 (96051,96001,'2030-07-20 10:00+00','2030-07-20 14:00+00','confirmed');
insert into public.registrations(event_id,attendee_id,status) values
 (96006,'e6000000-0000-4000-8000-000000000005','registered'),
 (96006,'e6000000-0000-4000-8000-000000000008','cancelled');

create function pg_temp.act(p_user uuid, p_role text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', p_user::text, true);
 perform set_config('request.headers', case when p_role is null then '' else json_build_object('x-acting-role', p_role)::text end, true);
end $$;
grant execute on function pg_temp.act(uuid, text) to authenticated;
-- The outcome of one attempt.
create function pg_temp.try(p_event integer, p_phone text, p_needs text) returns text language sql as $$
 select public.register_for_event(p_event, p_phone, p_needs)->>'outcome';
$$;
grant execute on function pg_temp.try(integer, text, text) to authenticated;

set local role authenticated;
-- AC1 and AC4: a valid registration holds a place and confirms it.
do $$
declare result jsonb;
begin
 perform pg_temp.act('e6000000-0000-4000-8000-000000000003', null);
 if public.registrable_event(96001)->'registered' <> 'false'::jsonb then
  raise exception '[SG2-60:not-yet-registered] [SG2-60:AC2] [NORMAL] Before registering, the detail must say the attendee holds no place';
 end if;
 result := public.register_for_event(96001, '  +65 9123 4567 ', '  Wheelchair access  ');
 if result->>'outcome' <> 'ok' or result->'registration'->>'event_id' <> '96001'
   or result->'registration'->>'contact_phone' <> '+65 9123 4567' or result->'registration'->>'needs' <> 'Wheelchair access'
   or (result->'registration'->>'registration_id') is null or (result->'registration'->>'registered_at') is null then
  raise exception '[SG2-60:registers-open-event] [SG2-60:AC1] [SG2-60:AC4] [NORMAL] An open event with places must register the attendee with their trimmed details: %', result;
 end if;
 if public.registrable_event(96001)->'registered' <> 'true'::jsonb
   or not (select (e->'registered')::boolean from jsonb_array_elements(public.registrable_events()) e where e->>'event_id' = '96001') then
  raise exception '[SG2-60:detail-shows-registered] [SG2-60:AC1] [NORMAL] Once registered, the list and the detail must say the attendee holds a place';
 end if;
end $$;
reset role;

do $$
begin
 if (select count(*) from public.registrations where event_id = 96001) <> 1
   or (select status from public.registrations where event_id = 96001) <> 'registered' then
  raise exception '[SG2-60:place-held] [SG2-60:AC1] [NORMAL] Registering must store one registration that holds a place';
 end if;
 if (select string_agg(kind || '|' || message, ';') from public.notifications
     where recipient_id = 'e6000000-0000-4000-8000-000000000003' and event_id = 96001)
   is distinct from 'registration_confirmed|You are registered for Open forum on 20 Jul 2030 19:00 SGT at Reg Annex, Reg Hall.' then
  raise exception '[SG2-60:confirmation-notice] [SG2-60:AC1] [NORMAL] The attendee must be sent one confirmation with the event name, date, time and venue';
 end if;
 if exists(select 1 from public.notifications where event_id = 96001 and recipient_id <> 'e6000000-0000-4000-8000-000000000003') then
  raise exception '[SG2-60:confirmation-only-attendee] [SG2-60:AC1] [FAILURE] Only the attendee who registered is sent the confirmation';
 end if;
 -- SG2-63's picture shows the phone given at registration, and the needs.
 if (select string_agg(a->>'name' || '|' || coalesce(a->>'phone', '-') || '|' || coalesce(a->>'needs', '-'), ';')
     from jsonb_array_elements(public.event_registration_overview(96001)->'attendees') a)
   is distinct from 'Reg attendee A|+65 9123 4567|Wheelchair access' then
  raise exception '[SG2-60:organiser-sees-details] [SG2-60:AC4] [NORMAL] The registration picture must carry the phone and needs the attendee gave';
 end if;
 if (select a->>'phone' || '|' || coalesce(a->>'needs', '-') from jsonb_array_elements(public.event_registration_overview(96006)->'attendees') a)
   is distinct from '+65 6000 0005|-' then
  raise exception '[SG2-60:legacy-profile-phone] [SG2-60:AC4] [BOUNDARY] A registration made before SG2-60 still shows the profile phone and no needs';
 end if;
end $$;

-- AC2: the same attendee cannot hold two places.
set local role authenticated;
do $$
begin
 perform pg_temp.act('e6000000-0000-4000-8000-000000000003', null);
 if pg_temp.try(96001, '91234567', null) <> 'duplicate' then
  raise exception '[SG2-60:duplicate-refused] [SG2-60:AC2] [CONFLICT] A second registration for the same event must be refused';
 end if;
end $$;
reset role;

do $$
begin
 if (select count(*) from public.registrations where event_id = 96001) <> 1
   or (select count(*) from public.notifications where event_id = 96001) <> 1 then
  raise exception '[SG2-60:duplicate-no-write] [SG2-60:AC2] [CONFLICT] A refused duplicate must store nothing and send nothing';
 end if;
 begin
  insert into public.registrations(event_id, attendee_id, status) values (96001, 'e6000000-0000-4000-8000-000000000003', null);
  raise exception '[SG2-60:duplicate-index] [SG2-60:AC2] [CONFLICT] The table itself must refuse a second active registration';
 exception when unique_violation then null;
 end;
 -- Withdrawn (SG2-62): a cancelled registration holds no place.
 update public.registrations set status = 'cancelled' where event_id = 96001;
end $$;

set local role authenticated;
do $$
begin
 perform pg_temp.act('e6000000-0000-4000-8000-000000000003', null);
 if pg_temp.try(96001, '91234567', null) <> 'ok' then
  raise exception '[SG2-60:register-after-withdrawal] [SG2-60:AC2] [BOUNDARY] After withdrawing, the attendee may register again';
 end if;
end $$;
reset role;
delete from public.registrations where event_id = 96001 and status = 'cancelled';

-- AC3: outside the window, refused with when it opens or that it closed.
set local role authenticated;
do $$
declare result jsonb; target integer;
begin
 perform pg_temp.act('e6000000-0000-4000-8000-000000000004', null);
 result := public.register_for_event(96002, '91234567', null);
 if result->>'outcome' <> 'not_open'
   or (result->>'registration_opens_at')::timestamptz <> (select registration_opens_at from public.events where event_id = 96002) then
  raise exception '[SG2-60:not-open-says-when] [SG2-60:AC3] [FAILURE] Before opening, registration must be refused with the opening time: %', result;
 end if;
 result := public.register_for_event(96003, '91234567', null);
 if result->>'outcome' <> 'closed'
   or (result->>'registration_closes_at')::timestamptz <> (select registration_closes_at from public.events where event_id = 96003) then
  raise exception '[SG2-60:closed-refused] [SG2-60:AC3] [FAILURE] After closing, registration must be refused as closed: %', result;
 end if;
 if pg_temp.try(96004, '91234567', null) <> 'closed' then
  raise exception '[SG2-60:closing-time-exclusive] [SG2-60:AC3] [BOUNDARY] At the closing time registration is already closed';
 end if;
 if pg_temp.try(96011, '91234567', null) <> 'closed' then
  raise exception '[SG2-60:started-closed] [SG2-60:AC3] [BOUNDARY] Once the event has started registration is closed, even before its closing time';
 end if;
 if pg_temp.try(96005, '91234567', null) <> 'ok' then
  raise exception '[SG2-60:opening-time-inclusive] [SG2-60:AC3] [BOUNDARY] From the opening time registration is open, and no capacity means no limit';
 end if;
 foreach target in array array[96007,96008,96009,96010,96099] loop
  if pg_temp.try(target, '91234567', null) <> 'missing' then
   raise exception '[SG2-60:unlisted-missing] [SG2-60:AC3] [FAILURE] Event % is not open to attendees and must answer as missing', target;
  end if;
 end loop;
end $$;
reset role;

do $$
begin
 if exists(select 1 from public.registrations where attendee_id = 'e6000000-0000-4000-8000-000000000004'
     and event_id <> 96005) then
  raise exception '[SG2-60:refused-no-write] [SG2-60:AC3] [FAILURE] A refused attempt must store no registration';
 end if;
end $$;

-- AC1: the last place goes, then the event is full. A cancelled place is free.
set local role authenticated;
do $$
begin
 perform pg_temp.act('e6000000-0000-4000-8000-000000000003', null);
 if pg_temp.try(96006, '91234567', null) <> 'ok' then
  raise exception '[SG2-60:last-place] [SG2-60:AC1] [BOUNDARY] With one place left (a cancelled registration does not hold one) the attendee registers';
 end if;
 perform pg_temp.act('e6000000-0000-4000-8000-000000000004', null);
 if pg_temp.try(96006, '91234567', null) <> 'full' then
  raise exception '[SG2-60:full-refused] [SG2-60:AC1] [FAILURE] With no places remaining registration must be refused';
 end if;
 -- Duplicate is checked before capacity.
 perform pg_temp.act('e6000000-0000-4000-8000-000000000005', null);
 if pg_temp.try(96006, '91234567', null) <> 'duplicate' then
  raise exception '[SG2-60:duplicate-before-full] [SG2-60:AC2] [CONFLICT] An attendee already holding a place on a full event is told they are registered, not that it is full';
 end if;
end $$;
reset role;

do $$
begin
 if (select count(*) from public.registrations where event_id = 96006 and status = 'registered') <> 2 then
  raise exception '[SG2-60:full-no-write] [SG2-60:AC1] [FAILURE] A full event must not hold more registrations than its capacity';
 end if;
end $$;

-- AC4: the required information is validated first; nothing is written.
set local role authenticated;
do $$
declare phone text; refused integer := 0;
begin
 perform pg_temp.act('e6000000-0000-4000-8000-000000000004', null);
 foreach phone in array array[null, '', '   ', '9123456', '912345678', '+66 91234567', '6591234567', '9123 456a',
   '9123/4567', '9' || repeat(' ', 33) || '1234567'] loop
  if pg_temp.try(96001, phone, null) = 'invalid' then refused := refused + 1; end if;
 end loop;
 if refused <> 10 then
  raise exception '[SG2-60:phone-validated] [SG2-60:AC4] [FAILURE] A missing or non-Singapore phone must be refused; refused %/10', refused;
 end if;
 if pg_temp.try(96001, '91234567', repeat('n', 501)) <> 'invalid' then
  raise exception '[SG2-60:needs-too-long] [SG2-60:AC4] [BOUNDARY] Needs over 500 characters must be refused';
 end if;
 if pg_temp.try(96099, '', null) <> 'invalid' then
  raise exception '[SG2-60:validated-first] [SG2-60:AC4] [FAILURE] Invalid details are refused before the event is looked at';
 end if;
 if pg_temp.try(96012, '(9123)-4567', repeat('n', 500)) <> 'ok' then
  raise exception '[SG2-60:needs-at-limit] [SG2-60:AC4] [BOUNDARY] 500 characters of needs and a phone with separators must be accepted';
 end if;
 if pg_temp.try(96001, '9123 4567', '   ') <> 'ok' then
  raise exception '[SG2-60:blank-needs-optional] [SG2-60:AC4] [BOUNDARY] Blank needs are optional';
 end if;
end $$;
reset role;

do $$
begin
 if (select coalesce(needs, '-') from public.registrations where event_id = 96001 and attendee_id = 'e6000000-0000-4000-8000-000000000004') <> '-' then
  raise exception '[SG2-60:blank-needs-null] [SG2-60:AC4] [BOUNDARY] Blank needs are stored as none';
 end if;
 if (select message from public.notifications where event_id = 96012) <> 'You are registered for Untitled event on 01 Aug 2030 10:30 SGT.' then
  raise exception '[SG2-60:confirmation-no-venue] [SG2-60:AC1] [BOUNDARY] An unnamed event with no venue is confirmed as Untitled event, without a venue';
 end if;
 begin
  insert into public.registrations(event_id, attendee_id, contact_phone) values (96002, 'e6000000-0000-4000-8000-000000000005', '1234');
  raise exception '[SG2-60:phone-constraint] [SG2-60:AC4] [FAILURE] The table must refuse an invalid contact phone';
 exception when check_violation then null;
 end;
 begin
  insert into public.registrations(event_id, attendee_id, contact_phone, needs) values (96002, 'e6000000-0000-4000-8000-000000000005', '91234567', repeat('n', 501));
  raise exception '[SG2-60:needs-constraint] [SG2-60:AC4] [FAILURE] The table must refuse needs over 500 characters';
 exception when check_violation then null;
 end;
end $$;

-- Only an account acting as attendee registers.
set local role authenticated;
do $$
declare refused integer := 0; who record;
begin
 for who in select * from (values
   ('e6000000-0000-4000-8000-000000000001'::uuid, null::text),
   ('e6000000-0000-4000-8000-000000000002', null),
   ('e6000000-0000-4000-8000-000000000007', null),
   ('e6000000-0000-4000-8000-000000000006', null),
   ('e6000000-0000-4000-8000-000000000006', 'event_organiser'),
   ('e6000000-0000-4000-8000-000000000005', 'event_organiser')) w(user_id, acting) loop
  perform pg_temp.act(who.user_id, who.acting);
  begin
   perform public.register_for_event(96005, '91234567', null);
  exception when insufficient_privilege then refused := refused + 1;
  end;
 end loop;
 if refused <> 6 then
  raise exception '[SG2-60:non-attendee-refused] [SG2-60:AC1] [FAILURE] Only an account acting as attendee may register; refused %/6', refused;
 end if;
 perform pg_temp.act('e6000000-0000-4000-8000-000000000006', 'attendee');
 if pg_temp.try(96005, '91234567', null) <> 'ok' then
  raise exception '[SG2-60:acting-attendee-registers] [SG2-60:AC1] [CONFLICT] An account with two roles acting as attendee registers';
 end if;
 perform set_config('request.jwt.claim.sub', '', true);
 begin
  perform public.register_for_event(96005, '91234567', null);
  raise exception '[SG2-60:anonymous-refused] [SG2-60:AC1] [FAILURE] A caller with no account must be refused';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

do $$
begin
 if has_function_privilege('anon', 'public.register_for_event(integer,text,text)', 'execute')
   or has_function_privilege('service_role', 'public.register_for_event(integer,text,text)', 'execute')
   or not has_function_privilege('authenticated', 'public.register_for_event(integer,text,text)', 'execute') then
  raise exception '[SG2-60:grants] [SG2-60:AC1] [FAILURE] Only signed-in callers may register, through their own JWT';
 end if;
end $$;

rollback;
