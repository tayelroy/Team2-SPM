-- SG2-54: real SQL public-contract checks; disposable fixtures roll back.
begin;
insert into auth.users(id)
 select ('d5400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8) n;
insert into public.users(user_id,name,role_id) values
 ('d5400000-0000-4000-8000-000000000001','Availability support',4),
 ('d5400000-0000-4000-8000-000000000002','Availability organiser',1);
insert into public.account_roles(user_id,role) values
 ('d5400000-0000-4000-8000-000000000001','technical_support_staff'),
 ('d5400000-0000-4000-8000-000000000002','event_organiser'),
 ('d5400000-0000-4000-8000-000000000003','event_coordinator'),
 ('d5400000-0000-4000-8000-000000000004','venue_staff'),
 ('d5400000-0000-4000-8000-000000000005','attendee'),
 ('d5400000-0000-4000-8000-000000000006','event_coordinator_lead'),
 ('d5400000-0000-4000-8000-000000000007','safety_officer');
insert into public.events(event_id,organiser_id,name,status,proposed_date)
 select 95400+n,'d5400000-0000-4000-8000-000000000002','Availability event '||n,'planning','2030-10-01T09:00Z'
 from generate_series(1,20) n;
insert into public.equipment(equipment_id,name,quantity_total) values
 (95401,'Availability microphones',10),(95402,'Available speakers',7),(95403,'Large inventory',2147483647);
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,notes,shortfall,arrangement_notes,starts_at,ends_at) values
 (95401,95401,95401,8,'Eight handhelds',2,'Manually recorded before check','2030-10-01T09:00Z','2030-10-01T17:00Z'),
 (95402,95401,95402,7,null,null,null,null,null),
 (95403,95420,95403,1,null,null,null,'2030-10-01T09:00Z','2030-10-01T17:00Z');
insert into public.equipment_reservations(reservation_id,event_id,equipment_id,quantity_reserved,starts_at,ends_at) values
 (95401,95402,95401,4,'2030-10-01T08:00Z','2030-10-01T12:00Z'),
 (95402,95403,95401,6,'2030-10-01T12:00Z','2030-10-01T18:00Z');
set local role authenticated;
select set_config('request.jwt.claim.sub','d5400000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95401);
 if result - array['checked_at','starts_at','ends_at'] is distinct from
  '{"outcome":"ok","event_id":95401,"request_id":95401,"equipment_id":95401,"equipment_type":"Availability microphones","quantity_requested":8,"quantity_held":10,"quantity_committed":6,"quantity_remaining":4,"shortfall":4,"undated_commitments":0,"operational_status":"operational","period_source":"request"}'::jsonb
  or (result->>'starts_at')::timestamptz is distinct from '2030-10-01T09:00Z'::timestamptz
  or (result->>'ends_at')::timestamptz is distinct from '2030-10-01T17:00Z'::timestamptz
  or (result->>'checked_at')::timestamptz is distinct from statement_timestamp() then
  raise exception '[SG2-54:half-open-peak-and-fields] [SG2-54:AC1] [SG2-54:AC3] [NORMAL] Held, peak committed, remaining, shortfall and snapshot timestamp must match the selected request interval';
 end if;
 result := public.check_equipment_availability(95401,95401,'2030-10-01T10:00Z','2030-10-01T12:00Z');
 if result->>'outcome' is distinct from 'ok' or result->>'quantity_committed' is distinct from '4'
   or result->>'quantity_remaining' is distinct from '6' or result->>'shortfall' is distinct from '2'
   or result->>'period_source' is distinct from 'chosen' then
  raise exception '[SG2-54:chosen-period-clipping] [SG2-54:AC1] [SG2-54:AC3] [BOUNDARY] A chosen period overrides request dates and excludes an arrival at the ending endpoint';
 end if;
 result := public.check_equipment_availability(95401,95401,'2030-10-01T18:00Z','2030-10-01T19:00Z');
 if result->>'quantity_committed' is distinct from '0' or result->>'quantity_remaining' is distinct from '10'
   or result->>'shortfall' is distinct from '0' then
  raise exception '[SG2-54:touching-endpoint-free] [SG2-54:AC1] [BOUNDARY] A commitment ending exactly when the selected period starts must not overlap';
 end if;
 result := public.check_equipment_availability(95401,95402);
 if result->>'outcome' is distinct from 'dates_required'
   or (result->>'proposed_start')::timestamptz is distinct from '2030-10-01T09:00Z'::timestamptz then
  raise exception '[SG2-54:dates-required-with-proposal] [SG2-54:AC1] [BOUNDARY] A proposal without an end time must ask for dates rather than invent a duration';
 end if;
 result := public.check_equipment_availability(95401,95402,'2030-10-01T09:00Z','2030-10-01T17:00Z');
 if result->>'outcome' is distinct from 'ok' or result->>'quantity_committed' is distinct from '0'
   or result->>'quantity_remaining' is distinct from '7' or result->>'shortfall' is distinct from '0' then
  raise exception '[SG2-54:exact-stock-covers-request] [SG2-54:AC1] [SG2-54:AC3] [BOUNDARY] Exactly enough held stock must cover the request with zero shortfall';
 end if;
 if public.check_equipment_availability(95401,95401,'2030-10-01T09:00Z',null)->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95401,95401,null,'2030-10-01T17:00Z')->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95401,95401,'2030-10-01T09:00Z','2030-10-01T09:00Z')->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95401,95401,'2030-10-01T17:00Z','2030-10-01T09:00Z')->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95401,95401,'-infinity','2030-10-01T09:00Z')->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95401,95401,'2030-10-01T09:00Z','infinity')->>'outcome' is distinct from 'invalid' then
  raise exception '[SG2-54:invalid-selected-period] [SG2-54:AC1] [FAILURE] Selected dates must form a complete finite positive interval';
 end if;
 if public.check_equipment_availability(null,95401)->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(0,95401)->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95401,0)->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95401,null)->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95401,9007199254740992)->>'outcome' is distinct from 'invalid'
   or public.check_equipment_availability(95402,95401)->>'outcome' is distinct from 'missing'
   or public.check_equipment_availability(95401,999999)->>'outcome' is distinct from 'missing' then
  raise exception '[SG2-54:invalid-or-mismatched-resource] [SG2-54:AC1] [FAILURE] Invalid identifiers and a request outside its event must be refused';
 end if;
end $$;
reset role;
insert into public.equipment_reservations(reservation_id,event_id,equipment_id,quantity_reserved,starts_at,ends_at)
 values (95403,95404,95401,3,'2030-10-01T11:00Z','2030-10-01T13:00Z');
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95401);
 if result->>'quantity_committed' is distinct from '9' or result->>'quantity_remaining' is distinct from '1'
   or result->>'shortfall' is distinct from '7' then
  raise exception '[SG2-54:overlapping-peak] [SG2-54:AC1] [SG2-54:AC3] [CONFLICT] Intersecting reservations must consume their peak simultaneous quantity, not their sum over the whole day';
 end if;
 result := public.check_equipment_availability(95401,95401,'2030-10-01T11:59:59.999999Z','2030-10-01T12:00Z');
 if result->>'quantity_committed' is distinct from '7' then
  raise exception '[SG2-54:microsecond-before-turnover] [SG2-54:AC1] [BOUNDARY] The last microsecond before a shared endpoint counts departing and continuing reservations only';
 end if;
 result := public.check_equipment_availability(95401,95401,'2030-10-01T12:00Z','2030-10-01T12:00:00.000001Z');
 if result->>'quantity_committed' is distinct from '9' then
  raise exception '[SG2-54:microsecond-after-turnover] [SG2-54:AC1] [BOUNDARY] The first microsecond after a shared endpoint counts arriving and continuing reservations only';
 end if;
end $$;
reset role;
insert into public.equipment_reservations(reservation_id,event_id,equipment_id,quantity_reserved)
 values (95404,95405,95401,2),(95405,95406,95401,0),(95406,95407,95401,-5),
 (95407,95401,95401,1000);
-- Other requests do not commit stock, regardless of pending/approved status.
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,status)
 values (95404,95408,95401,1000,'pending'),(95405,95409,95401,1000,'approved');
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95401);
 if result->>'quantity_committed' is distinct from '11' or result->>'quantity_remaining' is distinct from '0'
   or result->>'shortfall' is distinct from '8' or result->>'undated_commitments' is distinct from '1' then
  raise exception '[SG2-54:conservative-unknown-and-exclusions] [SG2-54:AC1] [SG2-54:AC3] [CONFLICT] Positive undated other-event reservations count throughout; own-event stock, nonpositive quantities and other requests do not';
 end if;
end $$;
reset role;
-- Released/completed event reservations do not consume current availability.
update public.events set status='cancelled' where event_id=95410;
update public.events set status='rejected',decision_reason='Fixture rejection' where event_id=95411;
update public.events set status='completed',completed_at=clock_timestamp(),
 completed_by='d5400000-0000-4000-8000-000000000002' where event_id=95412;
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved)
 values (95410,95401,200),(95411,95401,200),(95412,95401,200);
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95401);
 if result->>'quantity_committed' is distinct from '11' or result->>'undated_commitments' is distinct from '1' then
  raise exception '[SG2-54:terminal-events-excluded] [SG2-54:AC1] [NORMAL] Completed, cancelled and rejected events must not continue consuming stock';
 end if;
end $$;
reset role;
-- Refresh uses the latest statement snapshot, without modifying arrangements.
update public.equipment_reservations set quantity_reserved=1 where reservation_id=95404;
select set_config('availability.before_request',(select to_jsonb(r)::text from public.equipment_requests r where request_id=95401),true);
select set_config('availability.before_reservations',(select jsonb_agg(to_jsonb(r) order by reservation_id)::text from public.equipment_reservations r),true);
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95401);
 if result->>'quantity_committed' is distinct from '10' or result->>'shortfall' is distinct from '8' then
  raise exception '[SG2-54:refresh-observes-current-commitments] [SG2-54:AC1] [CONFLICT] A new availability statement must observe a changed reservation';
 end if;
end $$;
reset role;
do $$
begin
 if (select to_jsonb(r) from public.equipment_requests r where request_id=95401)
   is distinct from current_setting('availability.before_request')::jsonb
   or (select jsonb_agg(to_jsonb(r) order by reservation_id) from public.equipment_reservations r)
   is distinct from current_setting('availability.before_reservations')::jsonb then
  raise exception '[SG2-54:read-only-calculation] [SG2-54:AC1] [SG2-54:AC3] [NORMAL] Checking availability must neither reserve stock nor overwrite the manually recorded shortfall and arrangement';
 end if;
end $$;
-- Operational status changes availability base, never the displayed held stock.
update public.equipment set operational_status='damaged' where equipment_id=95402;
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95402,'2030-10-01T09:00Z','2030-10-01T17:00Z');
 if result->>'quantity_held' is distinct from '7' or result->>'quantity_remaining' is distinct from '0'
  or result->>'shortfall' is distinct from '7' or result->>'operational_status' is distinct from 'damaged' then
  raise exception '[SG2-54:damaged-stock-unavailable] [SG2-54:AC2] [SG2-54:AC3] [NORMAL] Damaged equipment must display quantity held but provide no available stock';
 end if;
end $$;
reset role;
update public.equipment set operational_status='maintenance' where equipment_id=95402;
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95402,'2030-10-01T09:00Z','2030-10-01T17:00Z');
 if result->>'quantity_held' is distinct from '7' or result->>'quantity_remaining' is distinct from '0'
  or result->>'shortfall' is distinct from '7' or result->>'operational_status' is distinct from 'maintenance' then
  raise exception '[SG2-54:maintenance-stock-unavailable] [SG2-54:AC2] [SG2-54:AC3] [NORMAL] Equipment under maintenance must be excluded from available stock';
 end if;
end $$;
reset role;
update public.equipment set operational_status='operational',quantity_total=0 where equipment_id=95402;
update public.events set proposed_date=null where event_id=95401;
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95402,'2030-10-01T09:00Z','2030-10-01T17:00Z');
 if result->>'quantity_held' is distinct from '0' or result->>'quantity_remaining' is distinct from '0'
  or result->>'shortfall' is distinct from '7' then
  raise exception '[SG2-54:zero-held-stock] [SG2-54:AC1] [SG2-54:AC3] [BOUNDARY] An operational record with zero stock must show the whole requirement as shortfall';
 end if;
 if public.check_equipment_availability(95401,95402) is distinct from '{"outcome":"dates_required","proposed_start":null}'::jsonb then
  raise exception '[SG2-54:no-dates-or-proposal] [SG2-54:AC1] [BOUNDARY] Missing period and proposal must remain explicit, without fabricated dates';
 end if;
end $$;
reset role;
-- Different venues avoid unrelated venue-conflict constraints in the fixture.
insert into public.venues(venue_id,name) select 95400+n,'Availability venue '||n from generate_series(1,8) n;
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status) values
 (95401,95401,'2030-10-01T09:00Z','2030-10-01T12:00Z','confirmed'),
 (95402,95401,'2030-10-01T14:00Z','2030-10-01T17:00Z','confirmed'),
 (95403,95401,'2030-10-01T06:00Z','2030-10-01T20:00Z','held'),
 (95404,95405,'2030-10-01T20:00Z','2030-10-01T21:00Z','confirmed'),
 (95405,95402,'2030-10-02T09:00Z','2030-10-02T17:00Z','confirmed');
insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status,cancelled_at,cancellation_reason)
 values(95406,95401,'2030-10-01T05:00Z','2030-10-01T22:00Z','cancelled',clock_timestamp(),'Fixture release');
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95402);
 if result->>'outcome' is distinct from 'ok' or result->>'period_source' is distinct from 'event_bookings'
   or (result->>'starts_at')::timestamptz is distinct from '2030-10-01T09:00Z'::timestamptz
   or (result->>'ends_at')::timestamptz is distinct from '2030-10-01T17:00Z'::timestamptz then
  raise exception '[SG2-54:confirmed-booking-envelope] [SG2-54:AC1] [NORMAL] Missing request dates use the confirmed booking envelope, ignoring held and cancelled bookings';
 end if;
 result := public.check_equipment_availability(95401,95401);
 if result->>'period_source' is distinct from 'request' or result->>'quantity_committed' is distinct from '9'
   or result->>'undated_commitments' is distinct from '0' then
  raise exception '[SG2-54:explicit-reservation-precedence] [SG2-54:AC1] [NORMAL] Explicit request and reservation periods override booking dates, while dated booking fallback removes unknown commitments';
 end if;
end $$;
reset role;
update public.venue_bookings set starts_at='2030-10-01T10:00Z',ends_at='2030-10-01T11:00Z' where venue_id=95404;
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95401,'2030-10-01T10:00Z','2030-10-01T11:00Z');
 if result->>'quantity_committed' is distinct from '5' or result->>'quantity_remaining' is distinct from '5'
   or result->>'shortfall' is distinct from '3' or result->>'undated_commitments' is distinct from '0' then
  raise exception '[SG2-54:reservation-booking-period] [SG2-54:AC1] [BOUNDARY] The legacy booking interval contributes one unit alongside four explicitly reserved units within the selected hour';
 end if;
end $$;
reset role;
-- The event may already be confirmed when Technical Support refreshes stock.
update public.events set status='confirmed' where event_id=95401;
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95401,95401);
 if result->>'outcome' is distinct from 'ok' or result->>'quantity_committed' is distinct from '9' then
  raise exception '[SG2-54:confirmed-event-readable] [SG2-54:AC1] [NORMAL] Support can inspect a confirmed event even after arrangement editing closes';
 end if;
end $$;
reset role;
-- More than int32 aggregate commitments must not overflow or wrap negative.
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at) values
 (95402,95403,2147483647,'2030-10-01T09:00Z','2030-10-01T17:00Z'),
 (95403,95403,2147483647,'2030-10-01T09:00Z','2030-10-01T17:00Z');
set local role authenticated;
do $$
declare result jsonb;
begin
 result := public.check_equipment_availability(95420,95403);
 if result->>'quantity_committed' is distinct from '4294967294' or result->>'quantity_held' is distinct from '2147483647'
  or result->>'quantity_remaining' is distinct from '0' or result->>'shortfall' is distinct from '1' then
  raise exception '[SG2-54:bigint-commitment-sum] [SG2-54:AC1] [SG2-54:AC3] [BOUNDARY] Commitments above int32 must sum accurately and clamp remaining stock at zero';
 end if;
end $$;
-- All other stored roles, and an identity without a role, are refused.
do $$
declare n integer;
begin
 for n in 2..8 loop
  perform set_config('request.jwt.claim.sub','d5400000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  begin
   perform public.check_equipment_availability(95401,95401);
   raise exception '[SG2-54:only-support-role] [SG2-54:AC1] [FAILURE] A non-support account must not inspect equipment commitments: %',n;
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.check_equipment_availability(95401,95401);
  raise exception '[SG2-54:missing-caller-identity] [SG2-54:AC1] [FAILURE] An authenticated database role without an identity must not inspect commitments';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.account_roles set role='attendee' where user_id='d5400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d5400000-0000-4000-8000-000000000001',true);
do $$
begin
 begin
  perform public.check_equipment_availability(95401,95401);
  raise exception '[SG2-54:current-role-rechecked] [SG2-54:AC1] [CONFLICT] Revoked support access must take effect on the next check with the same identity';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$
begin
 begin
  perform public.check_equipment_availability(95401,95401);
  raise exception '[SG2-54:anonymous-execute-denied] [SG2-54:AC1] [FAILURE] Anonymous callers must not execute the availability RPC';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare role_name text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  if has_table_privilege(role_name,'public.equipment_reservations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    or has_any_column_privilege(role_name,'public.equipment_reservations','SELECT,INSERT,UPDATE,REFERENCES') then
   raise exception '[SG2-54:reservation-grants-unchanged] [SG2-54:AC1] [FAILURE] Availability must not grant ordinary callers direct reservation access';
  end if;
 end loop;
 if not exists(select 1 from pg_proc where oid='public.check_equipment_availability(integer,bigint,timestamptz,timestamptz)'::regprocedure
     and provolatile='s' and prosecdef and proconfig @> array['search_path=""'])
    or not has_function_privilege('authenticated','public.check_equipment_availability(integer,bigint,timestamptz,timestamptz)','EXECUTE') then
  raise exception '[SG2-54:stable-scoped-snapshot] [SG2-54:AC1] [NORMAL] The guarded definer must use a stable statement snapshot and empty search path';
 end if;
 begin
  insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at)
   values(95402,95401,1,'2030-10-01T09:00Z');
  raise exception '[SG2-54:reservation-period-pair] [SG2-54:AC1] [FAILURE] A stored reservation period requires both dates';
 exception when check_violation then null; end;
 begin
  insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at)
   values(95402,95401,1,'2030-10-01T09:00Z','2030-10-01T09:00Z');
  raise exception '[SG2-54:reservation-period-order] [SG2-54:AC1] [BOUNDARY] A stored reservation must have a positive interval';
 exception when check_violation then null; end;
 begin
  insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at)
   values(95402,95401,1,'2030-10-01T09:00Z','infinity');
  raise exception '[SG2-54:reservation-period-finite] [SG2-54:AC1] [FAILURE] A stored reservation period must be finite';
 exception when check_violation then null; end;
end $$;
rollback;
