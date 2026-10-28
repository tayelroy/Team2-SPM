-- SG2-61: refused when full, the capacity-reached notice and the waiting
-- list; SG2-62 AC6: a freed place is offered to the list. Isolated fixture
-- changes are rolled back. The races are test-registration-concurrency.mjs.
begin;
insert into auth.users(id)
 select ('e6110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8) n;
insert into public.users(user_id,name,role_id,organisation,phone) values
 ('e6110000-0000-4000-8000-000000000001','Wl organiser',1,'Wl org',null),
 ('e6110000-0000-4000-8000-000000000002','Wl coordinator',2,null,null),
 ('e6110000-0000-4000-8000-000000000003','Wl attendee 1',5,'Guest org',null),
 ('e6110000-0000-4000-8000-000000000004','Wl attendee 2',5,null,null),
 ('e6110000-0000-4000-8000-000000000005','Wl attendee 3',5,null,null),
 ('e6110000-0000-4000-8000-000000000006','Wl attendee 4',5,null,null),
 ('e6110000-0000-4000-8000-000000000007','Wl attendee 5',5,null,null),
 ('e6110000-0000-4000-8000-000000000008','Wl attendee and organiser',5,'Wl org',null);
insert into public.account_roles(user_id,role) values
 ('e6110000-0000-4000-8000-000000000001','event_organiser'),
 ('e6110000-0000-4000-8000-000000000002','event_coordinator'),
 ('e6110000-0000-4000-8000-000000000003','attendee'),
 ('e6110000-0000-4000-8000-000000000004','attendee'),
 ('e6110000-0000-4000-8000-000000000005','attendee'),
 ('e6110000-0000-4000-8000-000000000006','attendee'),
 ('e6110000-0000-4000-8000-000000000007','attendee'),
 ('e6110000-0000-4000-8000-000000000008','attendee'),
 ('e6110000-0000-4000-8000-000000000008','event_organiser');

-- 96101 Full forum: open, capacity 2, held by attendees 1 and 2.
-- 96102 Roomy forum: open, capacity 10, one held. 96103 Unlimited forum: no capacity set.
-- 96104 Closed forum: closed yesterday, full. 96105 Upcoming forum: opens tomorrow.
-- 96106 Draft forum: not confirmed. 96107 Closing forum: full, closes in 90 minutes.
insert into public.events(event_id,organiser_id,coordinator_id,organisation,name,status,proposed_date,
  registration_needed,registration_capacity,registration_opens_at,registration_closes_at) values
 (96101,'e6110000-0000-4000-8000-000000000001','e6110000-0000-4000-8000-000000000002','Wl org','Full forum','confirmed',
  now()+interval '20 days',true,2,now()-interval '1 day',now()+interval '10 days'),
 (96102,'e6110000-0000-4000-8000-000000000001','e6110000-0000-4000-8000-000000000002','Wl org','Roomy forum','confirmed',
  now()+interval '20 days',true,10,now()-interval '1 day',now()+interval '10 days'),
 (96103,'e6110000-0000-4000-8000-000000000001',null,'Wl org','Unlimited forum','confirmed',
  now()+interval '20 days',true,null,now()-interval '1 day',now()+interval '10 days'),
 (96104,'e6110000-0000-4000-8000-000000000001',null,'Wl org','Closed forum','confirmed',
  now()+interval '5 days',true,1,now()-interval '5 days',now()-interval '1 day'),
 (96105,'e6110000-0000-4000-8000-000000000001',null,'Wl org','Upcoming forum','confirmed',
  now()+interval '20 days',true,1,now()+interval '1 day',now()+interval '10 days'),
 (96106,'e6110000-0000-4000-8000-000000000001',null,'Wl org','Draft forum','draft',
  now()+interval '20 days',true,1,now()-interval '1 day',now()+interval '10 days'),
 (96107,'e6110000-0000-4000-8000-000000000001',null,'Wl org','Closing forum','confirmed',
  now()+interval '2 days',true,1,now()-interval '1 day',now()+interval '90 minutes');
insert into public.registrations(registration_id,event_id,attendee_id,status,registered_at,contact_phone) values
 (961001,96101,'e6110000-0000-4000-8000-000000000003','registered',now()-interval '3 hours','91234567'),
 (961002,96101,'e6110000-0000-4000-8000-000000000004','registered',now()-interval '2 hours','91234567'),
 (961003,96102,'e6110000-0000-4000-8000-000000000003','registered',now()-interval '2 hours','91234567'),
 (961004,96104,'e6110000-0000-4000-8000-000000000003','registered',now()-interval '2 days','91234567'),
 (961005,96107,'e6110000-0000-4000-8000-000000000003','registered',now()-interval '2 hours','91234567');

create function pg_temp.act(p_user uuid, p_role text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub', p_user::text, true);
 perform set_config('request.headers', case when p_role is null then '' else json_build_object('x-acting-role', p_role)::text end, true);
end $$;
grant execute on function pg_temp.act(uuid, text) to authenticated;
-- Who acts next, by fixture number (3 is attendee 1).
create function pg_temp.as_attendee(p_n integer) returns void language sql as $$
 select pg_temp.act(('e6110000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid, null);
$$;
grant execute on function pg_temp.as_attendee(integer) to authenticated;
create function pg_temp.join(p_event integer) returns text language sql as $$
 select public.join_waiting_list(p_event)->>'outcome';
$$;
grant execute on function pg_temp.join(integer) to authenticated;
-- Where one attendee stands on an event's list, as their own read shows it.
create function pg_temp.standing(p_event integer) returns text language sql as $$
 select coalesce((public.registrable_event(p_event)->'waiting'->>'status') || ':'
   || coalesce(public.registrable_event(p_event)->'waiting'->>'position', '-'), 'none');
$$;
grant execute on function pg_temp.standing(integer) to authenticated;
-- The assertions read the list directly; attendees never can (checked last).
grant select on public.waiting_list_entries to authenticated;
create policy waiting_list_test_read on public.waiting_list_entries for select to authenticated using (true);
grant select on public.notifications to authenticated;
create policy waiting_list_test_notices on public.notifications for select to authenticated using (true);

set local role authenticated;
-- AC1, AC5, AC6: a full event is shown full and refused; the attendee joins
-- its list instead, first come first served, once.
do $$
declare answer jsonb; outcome text;
begin
 perform pg_temp.as_attendee(5);
 if public.registrable_event(96101)->'full' <> 'true'::jsonb or public.registrable_event(96102)->'full' <> 'false'::jsonb
   or public.registrable_event(96103)->'full' <> 'false'::jsonb then
  raise exception '[SG2-61:shown-full] [SG2-61:AC1] [NORMAL] Only an event whose places are all taken is shown as full';
 end if;
 if public.register_for_event(96101, '91234567', null)->>'outcome' <> 'full' then
  raise exception '[SG2-61:refused-full] [SG2-61:AC1] [FAILURE] A further attendee registering for a full event must be refused as full';
 end if;
 answer := public.join_waiting_list(96101);
 if answer->>'outcome' <> 'ok' or answer->'waiting'->>'status' <> 'waiting' or answer->'waiting'->>'position' <> '1' then
  raise exception '[SG2-61:joins-full] [SG2-61:AC5] [NORMAL] An attendee refused by a full event can join its waiting list and is first: %', answer;
 end if;
 perform pg_temp.as_attendee(6);
 if public.join_waiting_list(96101)->'waiting'->>'position' <> '2' then
  raise exception '[SG2-61:first-come-first-served] [SG2-61:AC5] [NORMAL] The next attendee to join is second';
 end if;
 perform pg_temp.as_attendee(7);
 outcome := pg_temp.join(96101);
 if outcome <> 'ok' or pg_temp.standing(96101) <> 'waiting:3' then
  raise exception '[SG2-61:sees-position] [SG2-61:AC5] [NORMAL] An attendee sees their position on the event: %', pg_temp.standing(96101);
 end if;

 perform pg_temp.as_attendee(5);
 answer := public.join_waiting_list(96101);
 if answer->>'outcome' <> 'already' or answer->'waiting'->>'position' <> '1'
   or (select count(*) from public.waiting_list_entries where event_id = 96101
     and attendee_id = 'e6110000-0000-4000-8000-000000000005') <> 1 then
  raise exception '[SG2-61:no-second-entry] [SG2-61:AC6] [CONFLICT] An attendee already on the list cannot join it again: %', answer;
 end if;
 perform pg_temp.as_attendee(3);
 outcome := pg_temp.join(96101);
 if outcome <> 'registered' or pg_temp.standing(96101) <> 'none' then
  raise exception '[SG2-61:registered-cannot-join] [SG2-61:AC6] [CONFLICT] An attendee who already holds a place cannot join the list';
 end if;

 perform pg_temp.as_attendee(5);
 if pg_temp.join(96102) <> 'not_full' or pg_temp.join(96103) <> 'not_full' then
  raise exception '[SG2-61:only-when-full] [SG2-61:AC5] [BOUNDARY] An event with places left, or no capacity, has no waiting list to join';
 end if;
 if pg_temp.join(96104) <> 'closed' or pg_temp.join(96105) <> 'not_open' or pg_temp.join(96106) <> 'missing'
   or pg_temp.join(2147483647) <> 'missing' then
  raise exception '[SG2-61:only-while-open] [SG2-61:AC5] [BOUNDARY] The list is joined only while registration is open, on an event an attendee may find';
 end if;
end $$;

-- AC6: an attendee leaves at any time; those behind move up; rejoining goes to the back.
do $$
declare outcome text;
begin
 perform pg_temp.as_attendee(6);
 outcome := public.leave_waiting_list(96101)->>'outcome';
 if outcome <> 'ok' or pg_temp.standing(96101) <> 'none' then
  raise exception '[SG2-61:leaves] [SG2-61:AC6] [NORMAL] An attendee can leave the waiting list';
 end if;
 if public.leave_waiting_list(96101)->>'outcome' <> 'missing' then
  raise exception '[SG2-61:leave-not-on-list] [SG2-61:AC6] [FAILURE] Leaving a list the attendee is not on is refused as missing';
 end if;
 if public.leave_waiting_list(96102)->>'outcome' <> 'missing' then
  raise exception '[SG2-61:leave-other-event] [SG2-61:AC6] [FAILURE] Leaving the list of an event the attendee never joined is refused as missing';
 end if;
 perform pg_temp.as_attendee(7);
 if pg_temp.standing(96101) <> 'waiting:2' then
  raise exception '[SG2-61:moves-up] [SG2-61:AC5] [NORMAL] Those behind move up when someone leaves: %', pg_temp.standing(96101);
 end if;
 perform pg_temp.as_attendee(6);
 if public.join_waiting_list(96101)->'waiting'->>'position' <> '3' then
  raise exception '[SG2-61:rejoin-at-back] [SG2-61:AC5] [BOUNDARY] An attendee who left and joins again goes to the back';
 end if;
end $$;

-- AC1-AC6 are attendee actions: every other acting role is refused, and so is no one signed in.
do $$
declare role_name text; refused integer := 0;
begin
 foreach role_name in array array['event_organiser','event_coordinator','venue_staff','technical_support_staff','event_coordinator_lead','safety_officer'] loop
  perform pg_temp.act('e6110000-0000-4000-8000-000000000008', role_name);
  begin
   perform public.join_waiting_list(96101);
  exception when insufficient_privilege then refused := refused + 1;
  end;
  begin
   perform public.leave_waiting_list(96101);
  exception when insufficient_privilege then refused := refused + 1;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub', '', true);
 begin
  perform public.join_waiting_list(96101);
 exception when insufficient_privilege then refused := refused + 1;
 end;
 if refused <> 13 then
  raise exception '[SG2-61:other-roles-refused] [SG2-61:AC5] [SG2-61:AC6] [FAILURE] Only an attendee acting role may join or leave a waiting list (% of 13 refused)', refused;
 end if;
end $$;
reset role;

-- AC7: the organiser's and coordinator's picture holds the list in order.
do $$
declare picture jsonb := public.event_registration_overview(96101);
begin
 if (select string_agg(w->>'name' || ':' || (w->>'status'), ',' order by ord)
     from jsonb_array_elements(picture->'waiting_list') with ordinality x(w, ord))
   is distinct from 'Wl attendee 3:waiting,Wl attendee 5:waiting,Wl attendee 4:waiting' then
  raise exception '[SG2-61:organiser-sees-list] [SG2-61:AC7] [NORMAL] The registration picture must hold the waiting list in the order attendees joined: %', picture->'waiting_list';
 end if;
 if (picture->'event'->>'waiting_list_response_hours')::integer <> 24 then
  raise exception '[SG2-61:response-window-shown] [SG2-62:AC6] [NORMAL] The picture carries the response window, 24 hours by default';
 end if;
 if public.event_registration_overview(96102)->'waiting_list' <> '[]'::jsonb then
  raise exception '[SG2-61:empty-list] [SG2-61:AC7] [BOUNDARY] An event nobody is waiting for has an empty list';
 end if;
 begin
  insert into public.waiting_list_entries(event_id, attendee_id) values (96101, 'e6110000-0000-4000-8000-000000000005');
  raise exception '[SG2-61:one-active-entry-index] [SG2-61:AC6] [FAILURE] The database must hold one active entry per attendee per event';
 exception when unique_violation then null;
 end;
end $$;

set local role authenticated;
-- SG2-62 AC6: a withdrawal offers the place to the first waiting attendee,
-- who is told and can take it; nobody else can.
do $$
declare offer public.waiting_list_entries; outcome text;
begin
 perform pg_temp.as_attendee(3);
 perform public.withdraw_registration(961001);
 select * into offer from public.waiting_list_entries
  where event_id = 96101 and attendee_id = 'e6110000-0000-4000-8000-000000000005' and status in ('waiting', 'offered');
 if offer.status <> 'offered' or offer.offer_expires_at - offer.offered_at <> interval '24 hours' then
  raise exception '[SG2-62:withdrawal-offers-first] [SG2-62:AC6] [NORMAL] A withdrawal offers the place to the first attendee on the list for the response window: % %', offer.status, offer.offer_expires_at - offer.offered_at;
 end if;
 if (select count(*) from public.notifications where event_id = 96101 and kind = 'waiting_list_offer') <> 1
   or not exists(select 1 from public.notifications where event_id = 96101 and kind = 'waiting_list_offer'
     and recipient_id = 'e6110000-0000-4000-8000-000000000005'
     and message like 'A place has opened at Full forum. It is held for you until % SGT: register from Find events to take it.') then
  raise exception '[SG2-62:first-told] [SG2-62:AC6] [NORMAL] Only the first attendee on the list is told the place is theirs to take: %',
   (select string_agg(recipient_id::text || '|' || message, ';') from public.notifications where event_id = 96101);
 end if;
 perform pg_temp.as_attendee(7);
 outcome := public.register_for_event(96101, '91234567', null)->>'outcome';
 if outcome <> 'full' or pg_temp.standing(96101) <> 'waiting:1' or public.registrable_event(96101)->'full' <> 'true'::jsonb then
  raise exception '[SG2-62:offer-holds-place] [SG2-62:AC6] [CONFLICT] While the place is offered it is held: the next attendee is refused as full';
 end if;
 perform pg_temp.as_attendee(5);
 if pg_temp.standing(96101) <> 'offered:-' or public.registrable_event(96101)->'full' <> 'false'::jsonb then
  raise exception '[SG2-62:sees-offer] [SG2-62:AC6] [NORMAL] The attendee offered the place sees it held for them';
 end if;
 outcome := public.register_for_event(96101, '91234567', null)->>'outcome';
 if outcome <> 'ok' or (select status from public.waiting_list_entries where entry_id = offer.entry_id) <> 'registered' then
  raise exception '[SG2-62:takes-offer] [SG2-62:AC6] [NORMAL] The attendee offered the place registers for it and leaves the list';
 end if;
end $$;
reset role;

-- AC3: the registration that took the last place told the organiser and coordinator.
do $$
begin
 if (select string_agg(recipient_id::text || '|' || message, ';' order by recipient_id) from public.notifications
     where event_id = 96101 and kind = 'registration_full')
   is distinct from 'e6110000-0000-4000-8000-000000000001|Full forum is now full: all places are taken (capacity 2).;'
     || 'e6110000-0000-4000-8000-000000000002|Full forum is now full: all places are taken (capacity 2).' then
  raise exception '[SG2-61:full-notice] [SG2-61:AC3] [NORMAL] When an event reaches capacity the organiser and coordinator are each told once: %', (select string_agg(recipient_id::text || '|' || kind || '|' || message, ';') from public.notifications where event_id = 96101);
 end if;
 -- The organiser shortens the window before the next offer is made.
 perform public.update_registration_settings(96101, 'e6110000-0000-4000-8000-000000000001', '{"waiting_list_response_hours": 6}', false);
end $$;

set local role authenticated;
do $$
begin
 perform pg_temp.as_attendee(5);
 perform public.register_for_event(96102, '91234567', null);
 perform public.register_for_event(96103, '91234567', null);
 if exists(select 1 from public.notifications where kind = 'registration_full' and event_id in (96102, 96103)) then
  raise exception '[SG2-61:not-full-no-notice] [SG2-61:AC3] [BOUNDARY] A registration that leaves places, or with no capacity set, sends no capacity notice';
 end if;
 -- Attendee 2 withdraws: attendee 5 (first now) is offered the place.
 perform pg_temp.as_attendee(4);
 perform public.withdraw_registration(961002);
end $$;
reset role;

-- SG2-62 AC6: an offer not taken in time lapses and the place goes to the next.
do $$
begin
 if (select offer_expires_at - offered_at from public.waiting_list_entries
     where event_id = 96101 and attendee_id = 'e6110000-0000-4000-8000-000000000007' and status = 'offered') is distinct from interval '6 hours' then
  raise exception '[SG2-62:window-applies] [SG2-62:AC6] [NORMAL] An offer is held for the response window the organiser set, here 6 hours';
 end if;
 update public.waiting_list_entries set offered_at = clock_timestamp() - interval '25 hours',
   offer_expires_at = clock_timestamp() - interval '1 hour'
  where event_id = 96101 and attendee_id = 'e6110000-0000-4000-8000-000000000007' and status = 'offered';
 if public.process_waiting_list_offers() <> 1 then
  raise exception '[SG2-62:sweep-finds-lapsed] [SG2-62:AC6] [NORMAL] The scheduled sweep must find the event whose offer ran out';
 end if;
 if (select string_agg(u.name || ':' || w.status, ',' order by w.entry_id) from public.waiting_list_entries w
     join public.users u on u.user_id = w.attendee_id where w.event_id = 96101 and w.attendee_id in
       ('e6110000-0000-4000-8000-000000000006', 'e6110000-0000-4000-8000-000000000007'))
   is distinct from 'Wl attendee 4:left,Wl attendee 5:lapsed,Wl attendee 4:offered' then
  raise exception '[SG2-62:lapses-to-next] [SG2-62:AC6] [NORMAL] An offer not taken within the response window lapses and the place is offered to the next attendee';
 end if;
 if not exists(select 1 from public.notifications where event_id = 96101 and kind = 'waiting_list_offer_lapsed'
     and recipient_id = 'e6110000-0000-4000-8000-000000000007' and message like 'The place held for you at Full forum was not taken by %')
   or not exists(select 1 from public.notifications where event_id = 96101 and kind = 'waiting_list_offer'
     and recipient_id = 'e6110000-0000-4000-8000-000000000006') then
  raise exception '[SG2-62:lapse-told] [SG2-62:AC6] [NORMAL] The attendee whose offer lapsed is told, and the next one is offered the place';
 end if;
 if public.process_waiting_list_offers() <> 0 then
  raise exception '[SG2-62:sweep-idempotent] [SG2-62:AC6] [BOUNDARY] A second sweep finds nothing left to do';
 end if;
end $$;

set local role authenticated;
-- AC6 with SG2-62 AC6: leaving while offered passes the place on; with nobody
-- waiting it is free to anyone.
do $$
begin
 perform pg_temp.as_attendee(6);
 if public.leave_waiting_list(96101)->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-61:leave-while-offered] [SG2-61:AC6] [BOUNDARY] An attendee offered a place can still leave the list';
 end if;
 perform pg_temp.as_attendee(7);
 if pg_temp.standing(96101) <> 'none' or public.registrable_event(96101)->'full' <> 'false'::jsonb then
  raise exception '[SG2-62:free-when-list-empty] [SG2-62:AC6] [BOUNDARY] With nobody waiting a freed place is free to any attendee';
 end if;

 -- 96107 Closing forum is full: attendees 3 and 4 wait.
 perform pg_temp.as_attendee(5);
 perform public.join_waiting_list(96107);
 perform pg_temp.as_attendee(6);
 perform public.join_waiting_list(96107);
end $$;
reset role;

-- AC4, SG2-62 AC6: the organiser raises capacity (above any venue's: no
-- limit) and sets the response window; the new places go to the list, held
-- no later than registration closes.
do $$
declare result jsonb; refused integer := 0; bad jsonb; outcome text;
begin
 result := public.update_registration_settings(96107, 'e6110000-0000-4000-8000-000000000001',
   '{"registration_capacity": 500, "waiting_list_response_hours": 48}', false);
 if result->>'outcome' <> 'ok' or (result->>'waiting_list_response_hours')::integer <> 48 then
  raise exception '[SG2-61:organiser-raises] [SG2-61:AC4] [NORMAL] The organiser may raise capacity and set the response window: %', result;
 end if;
 if (select string_agg(w.status || ':' || (w.offer_expires_at = e.registration_closes_at)::text, ',' order by w.entry_id)
     from public.waiting_list_entries w join public.events e using (event_id) where w.event_id = 96107)
   is distinct from 'offered:true,offered:true' then
  raise exception '[SG2-62:raise-offers-list] [SG2-62:AC6] [BOUNDARY] A capacity increase offers each new place to the list, held only until registration closes';
 end if;
 if (select string_agg(field_name || ':' || old_value || '>' || new_value, ',' order by field_name) from public.event_audit_logs
     where event_id = 96107) is distinct from 'registration_capacity:1>500,waiting_list_response_hours:24>48' then
  raise exception '[SG2-62:window-in-history] [SG2-62:AC6] [NORMAL] Each setting changed, the response window included, is written to the event history';
 end if;
 foreach bad in array array['{"waiting_list_response_hours": 0}', '{"waiting_list_response_hours": 169}',
     '{"waiting_list_response_hours": 1.5}', '{"waiting_list_response_hours": null}', '{"waiting_list_response_hours": "5"}']::jsonb[] loop
  if public.update_registration_settings(96102, 'e6110000-0000-4000-8000-000000000001', bad, false)->>'outcome' = 'invalid' then
   refused := refused + 1;
  end if;
 end loop;
 if refused <> 5 or (select waiting_list_response_hours from public.events where event_id = 96102) <> 24 then
  raise exception '[SG2-62:window-range] [SG2-62:AC6] [BOUNDARY] The response window is whole hours from 1 to 168 (% of 5 refused)', refused;
 end if;
 if public.update_registration_settings(96102, 'e6110000-0000-4000-8000-000000000001', '{"waiting_list_response_hours": 1}', false)->>'outcome' <> 'ok'
   or public.update_registration_settings(96102, 'e6110000-0000-4000-8000-000000000001', '{"waiting_list_response_hours": 168}', false)->>'outcome' <> 'ok' then
  raise exception '[SG2-62:window-edges] [SG2-62:AC6] [BOUNDARY] One hour and one week are both allowed';
 end if;

 -- Closing early ends the offers still running, without a lapse notice.
 outcome := public.update_registration_settings(96107, 'e6110000-0000-4000-8000-000000000001', null, true)->>'outcome';
 if outcome <> 'ok'
   or exists(select 1 from public.waiting_list_entries where event_id = 96107 and status = 'offered')
   or exists(select 1 from public.notifications where event_id = 96107 and kind = 'waiting_list_offer_lapsed') then
  raise exception '[SG2-62:close-ends-offers] [SG2-62:AC6] [BOUNDARY] Closing registration ends every offer still running';
 end if;
end $$;

-- Only the functions reach the list: attendees and anon have no direct access
-- or internal helper.
do $$
begin
 if has_table_privilege('anon', 'public.waiting_list_entries', 'SELECT')
   or has_function_privilege('authenticated', 'private.offer_waiting_places(integer)', 'EXECUTE')
   or has_function_privilege('authenticated', 'public.process_waiting_list_offers()', 'EXECUTE')
   or has_function_privilege('anon', 'public.join_waiting_list(integer)', 'EXECUTE')
   or not has_function_privilege('authenticated', 'public.leave_waiting_list(integer)', 'EXECUTE') then
  raise exception '[SG2-61:grants] [SG2-61:AC6] [FAILURE] Attendees reach the list only through join and leave';
 end if;
end $$;

rollback;
