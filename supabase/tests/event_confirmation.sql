-- SG2-58 confirm_event RPC contract, with isolated fixture changes rolled back.
begin;
insert into auth.users(id)
 select ('d5800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,9) n;
insert into public.users(user_id,name,role_id) values
 ('d5800000-0000-4000-8000-000000000001','Confirmation support',4),
 ('d5800000-0000-4000-8000-000000000002','Confirmation organiser',1),
 ('d5800000-0000-4000-8000-000000000003','Confirmation coordinator',2),
 ('d5800000-0000-4000-8000-000000000004','Other confirmation coordinator',2),
 ('d5800000-0000-4000-8000-000000000005','Confirmation venue staff',3),
 ('d5800000-0000-4000-8000-000000000006','Confirmation attendee',5),
 ('d5800000-0000-4000-8000-000000000007','Confirmation lead',2),
 ('d5800000-0000-4000-8000-000000000008','Confirmation safety',2),
 ('d5800000-0000-4000-8000-000000000009','Confirmation roleless',5);
insert into public.account_roles(user_id,role) values
 ('d5800000-0000-4000-8000-000000000001','technical_support_staff'),
 ('d5800000-0000-4000-8000-000000000002','event_organiser'),
 ('d5800000-0000-4000-8000-000000000003','event_coordinator'),
 ('d5800000-0000-4000-8000-000000000004','event_coordinator'),
 ('d5800000-0000-4000-8000-000000000005','venue_staff'),
 ('d5800000-0000-4000-8000-000000000006','attendee'),
 ('d5800000-0000-4000-8000-000000000007','event_coordinator_lead'),
 ('d5800000-0000-4000-8000-000000000008','safety_officer');
insert into public.venues(venue_id,name) values (95860,'Confirmation hall'),(95861,'Confirmation annex');
insert into public.equipment(equipment_id,name,quantity_total) values (95860,'Confirmation projectors',20);
-- Every event starts ready: Preparation on the Safety Officer's approval
-- (SG2-94), one approved venue request, no equipment, registration not
-- needed. Each case then removes one item.
insert into public.events(event_id,organiser_id,coordinator_id,name,status,registration_needed)
 select 95860+n,'d5800000-0000-4000-8000-000000000002','d5800000-0000-4000-8000-000000000003',
  'Confirmation event '||n,'preparation',false from generate_series(1,19) n;
insert into public.event_safety_decisions(event_id,decision,decided_by)
 select 95860+n,'approve','d5800000-0000-4000-8000-000000000008' from generate_series(1,19) n;
insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status)
 select 95860+n,95860,'2031-11-01T09:00Z'::timestamptz+n*interval '1 day','2031-11-01T17:00Z'::timestamptz+n*interval '1 day','approved'
 from generate_series(1,19) n where n not in (2,4,10);

-- AC1 event: several approved venues, live equipment reserved and placed,
-- registration fully set, plus non-live rows that must be ignored. SG2-82: a
-- rejected venue request counts until withdrawn, so the event's rejected
-- venue was withdrawn (cancelled) before confirming.
update public.events set name='Confirmation Gala',registration_needed=true,registration_capacity=1,
 registration_opens_at='2031-10-01T00:00Z',registration_closes_at='2031-10-01T00:00:01Z' where event_id=95861;
insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status,withdrawn_at) values
 (95861,95861,'2031-11-02T09:00Z','2031-11-02T17:00Z','approved',null),
 (95861,95861,'2031-11-03T09:00Z','2031-11-03T17:00Z','cancelled','2031-10-01T00:00Z'),
 (95861,95861,'2031-11-04T09:00Z','2031-11-04T17:00Z','cancelled',null);
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,status,shortfall,placement_venue_id,placement_position)
 values (95861,95861,95860,2,'approved',0,95860,'Stage left'),
  (95871,95861,95860,3,'rejected',null,null,null),
  (95881,95861,95860,3,'cancelled',null,null,null);
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at,request_id,reserved_at)
 values (95861,95860,2,'2031-11-02T09:00Z','2031-11-02T17:00Z',95861,'2031-10-01T00:00Z');
-- An approved request is only ready while its confirmed booking stands, so
-- give every approved fixture request the booking its approval created.
do $$
declare r record; booking bigint;
begin
 for r in select * from public.venue_booking_requests where event_id between 95861 and 95879
   and status='approved' and venue_booking_id is null loop
  insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
   values(r.venue_id,r.event_id,r.starts_at,r.ends_at,'confirmed') returning booking_id into booking;
  update public.venue_booking_requests set venue_booking_id=booking where request_id=r.request_id;
 end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
 result := public.confirm_event(95861);
 if result - 'confirmed_at' is distinct from
   '{"outcome":"ok","event_id":95861,"status":"confirmed","organiser_notified":true}'::jsonb
   or jsonb_typeof(result->'confirmed_at') is distinct from 'string'
   or not isfinite((result->>'confirmed_at')::timestamptz) then
  raise exception '[SG2-58:ready-event-confirms] [SG2-58:AC1] [NORMAL] A ready Preparation event must confirm and return its confirmation receipt: %', result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text||'|'||confirmed_by::text from public.events where event_id=95861)
   is distinct from 'confirmed|d5800000-0000-4000-8000-000000000003'
   or (select confirmed_at from public.events where event_id=95861) is null then
  raise exception '[SG2-58:confirmation-recorded] [SG2-58:AC1] [NORMAL] Confirmation must store status, confirmed_by and confirmed_at together';
 end if;
 if (select count(*) from public.event_audit_logs where event_id=95861) <> 1
   or (select actor_id::text||'|'||field_name||'|'||old_value||'|'||new_value from public.event_audit_logs where event_id=95861)
   is distinct from 'd5800000-0000-4000-8000-000000000003|status|preparation|confirmed' then
  raise exception '[SG2-58:confirmation-audited] [SG2-58:AC1] [NORMAL] Confirmation must add exactly one status history row by the coordinator';
 end if;
 if (select count(*) from public.notifications where event_id=95861) <> 1
   or (select recipient_id::text||'|'||kind||'|'||message||'|'||coalesce(request_id::text,'null')||'|'||coalesce(equipment_reservation_id::text,'null')
     from public.notifications where event_id=95861)
   is distinct from 'd5800000-0000-4000-8000-000000000002|event_confirmed|Your event Confirmation Gala is confirmed.|null|null' then
  raise exception '[SG2-58:organiser-notified-once] [SG2-58:AC1] [NORMAL] Exactly one accurate notification must reach the Event Organiser';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000002',true);
do $$
begin
 if (select count(*) from public.notifications where event_id=95861 and kind='event_confirmed') <> 1 then
  raise exception '[SG2-58:organiser-reads-notice] [SG2-58:AC1] [NORMAL] The Event Organiser must be able to read their confirmation notice';
 end if;
end $$;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
do $$
begin
 if exists(select 1 from public.notifications where event_id=95861) then
  raise exception '[SG2-58:notice-private-to-organiser] [SG2-58:AC1] [FAILURE] The confirmation notice must not be readable by another account';
 end if;
 if public.confirm_event(95861) is distinct from '{"outcome":"closed","status":"confirmed"}'::jsonb then
  raise exception '[SG2-58:replay-closed] [SG2-58:AC1] [CONFLICT] Replaying a confirmation must be refused as closed';
 end if;
end $$;
reset role;
do $$
begin
 if (select count(*) from public.notifications where event_id=95861) <> 1
   or (select count(*) from public.event_audit_logs where event_id=95861) <> 1 then
  raise exception '[SG2-58:replay-no-duplicate] [SG2-58:AC1] [CONFLICT] A replayed confirmation must not notify or audit again';
 end if;
end $$;

-- AC2: each outstanding arrangement is refused with its exact key.
update public.venue_booking_requests set status='pending' where event_id=95863;
insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status) values
 (95863,95861,'2031-12-03T09:00Z','2031-12-03T17:00Z','approved'),
 (95863,95861,'2031-12-04T09:00Z','2031-12-04T17:00Z','approved'),
 (95864,95861,'2031-12-05T09:00Z','2031-12-05T17:00Z','rejected'),
 (95864,95861,'2031-12-06T09:00Z','2031-12-06T17:00Z','cancelled');
do $$
declare r record; booking bigint;
begin
 for r in select * from public.venue_booking_requests where event_id=95863
   and status='approved' and venue_booking_id is null loop
  insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
   values(r.venue_id,r.event_id,r.starts_at,r.ends_at,'confirmed') returning booking_id into booking;
  update public.venue_booking_requests set venue_booking_id=booking where request_id=r.request_id;
 end loop;
end $$;
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,status,shortfall,placement_venue_id,placement_position) values
 (95865,95865,95860,1,'pending',0,95860,'Foyer'),
 (95866,95866,95860,1,'approved',0,null,null),
 (95867,95867,95860,1,'approved',0,95860,'Foyer'),
 (95868,95868,95860,1,'approved',null,95860,'Foyer');
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at,request_id,reserved_at) values
 (95866,95860,1,'2031-11-06T09:00Z','2031-11-06T17:00Z',95866,'2031-10-01T00:00Z'),
 (95868,95860,1,'2031-11-08T09:00Z','2031-11-08T17:00Z',95868,'2031-10-01T00:00Z');
-- SG2-94 AC6: registration needed with no capacity or window set yet.
update public.events set registration_needed=true,registration_capacity=null,
 registration_opens_at=null,registration_closes_at=null where event_id=95869;
-- Every kind outstanding at once: no venue, unreserved equipment, a
-- registration recheck (SG2-66) and no current safety approval (SG2-94).
update public.events set registration_needed=true,arrangements_recheck_needed=true,
 outstanding_arrangements='["registration_recheck"]' where event_id=95870;
delete from public.event_safety_decisions where event_id=95870;
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity) values (95870,95870,95860,1);
set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
do $$
begin
 if public.confirm_event(95862) is distinct from '{"outcome":"outstanding","outstanding":["venue"]}'::jsonb then
  raise exception '[SG2-58:no-venue-request-outstanding] [SG2-58:AC2] [BOUNDARY] An event with no venue request must list the venue as outstanding';
 end if;
 if public.confirm_event(95863) is distinct from '{"outcome":"outstanding","outstanding":["venue"]}'::jsonb then
  raise exception '[SG2-58:one-of-several-venues-pending] [SG2-58:AC2] [BOUNDARY] One pending venue among several approved ones must refuse confirmation';
 end if;
 if public.confirm_event(95864) is distinct from '{"outcome":"outstanding","outstanding":["venue"]}'::jsonb then
  raise exception '[SG2-58:only-dead-venue-requests-outstanding] [SG2-58:AC2] [SG2-82:AC5] [BOUNDARY] Rejected or cancelled venue requests must not count as an approved venue';
 end if;
 if public.confirm_event(95865) is distinct from '{"outcome":"outstanding","outstanding":["equipment"]}'::jsonb then
  raise exception '[SG2-58:unreserved-equipment-outstanding] [SG2-58:AC2] [NORMAL] A pending equipment request without a reservation must refuse confirmation';
 end if;
 if public.confirm_event(95866) is distinct from '{"outcome":"outstanding","outstanding":["equipment"]}'::jsonb then
  raise exception '[SG2-58:reserved-unplaced-outstanding] [SG2-58:AC2] [BOUNDARY] Reserved but unplaced equipment must refuse confirmation';
 end if;
 if public.confirm_event(95867) is distinct from '{"outcome":"outstanding","outstanding":["equipment"]}'::jsonb then
  raise exception '[SG2-58:placed-unreserved-outstanding] [SG2-58:AC2] [BOUNDARY] Placed equipment without a reservation receipt must refuse confirmation';
 end if;
 if public.confirm_event(95868) is distinct from '{"outcome":"outstanding","outstanding":["equipment"]}'::jsonb then
  raise exception '[SG2-58:unknown-shortfall-outstanding] [SG2-58:AC2] [BOUNDARY] Reserved placed equipment with an unknown shortfall must refuse confirmation';
 end if;
 if public.confirm_event(95870) is distinct from
   '{"outcome":"outstanding","outstanding":["venue","equipment","registration","safety"]}'::jsonb then
  raise exception '[SG2-58:all-outstanding-ordered] [SG2-58:AC2] [SG2-94:AC5] [NORMAL] Every outstanding item must be listed in venue, equipment, registration, safety order';
 end if;
end $$;
reset role;
-- Each remaining single gap: shortfall one unit, and each missing window field.
update public.equipment_requests set shortfall=1 where request_id=95868;
set local role authenticated;
do $$
begin
 if public.confirm_event(95868) is distinct from '{"outcome":"outstanding","outstanding":["equipment"]}'::jsonb then
  raise exception '[SG2-58:shortfall-one-outstanding] [SG2-58:AC2] [BOUNDARY] A one-unit equipment shortfall must refuse confirmation';
 end if;
end $$;
reset role;
do $$
begin
 if exists(select 1 from public.events where event_id between 95862 and 95870 and event_id <> 95869
     and (status <> 'preparation' or confirmed_by is not null or confirmed_at is not null))
   or exists(select 1 from public.event_audit_logs where event_id between 95862 and 95870 and event_id <> 95869)
   or exists(select 1 from public.notifications where event_id between 95862 and 95870 and event_id <> 95869) then
  raise exception '[SG2-58:refusal-has-no-side-effects] [SG2-58:AC2] [FAILURE] A refused confirmation must not change status, history or notifications';
 end if;
end $$;

-- SG2-94 AC6: registration settings belong to the organiser (SG2-63) and do
-- not hold confirmation up; attendees can register only once they are set.
set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
do $$
declare result jsonb;
begin
 result := public.confirm_event(95869);
 if result->>'outcome' is distinct from 'ok' or result->>'status' is distinct from 'confirmed' then
  raise exception '[SG2-94:registration-settings-do-not-block] [SG2-94:AC6] [NORMAL] An event needing registration must confirm before its capacity and times are set: %',result;
 end if;
end $$;
reset role;
do $$
begin
 if (select status::text||'|'||registration_needed||'|'||coalesce(registration_capacity::text,'null')
     ||'|'||coalesce(registration_opens_at::text,'null')||'|'||coalesce(registration_closes_at::text,'null')
     from public.events where event_id=95869) is distinct from 'confirmed|true|null|null|null' then
  raise exception '[SG2-94:registration-left-to-organiser] [SG2-94:AC6] [BOUNDARY] Confirming must leave the unset registration settings for the organiser';
 end if;
end $$;

-- AC2: equipment or registration that is not required does not block.
update public.events set registration_needed=null where event_id=95871;
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,status) values
 (95872,95872,95860,1,'rejected'),(95882,95872,95860,1,'cancelled');
update public.events set name='' where event_id=95872;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
do $$
begin
 if public.confirm_event(95871)->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-58:unknown-registration-not-required] [SG2-58:AC2] [BOUNDARY] Registration not marked needed must not block confirmation';
 end if;
 if public.confirm_event(95872)->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-58:no-live-equipment-not-required] [SG2-58:AC2] [NORMAL] Only rejected or cancelled equipment requests must not block confirmation';
 end if;
end $$;
reset role;
do $$
begin
 if (select message from public.notifications where event_id=95872 and kind='event_confirmed')
   is distinct from 'Your event Untitled event is confirmed.' then
  raise exception '[SG2-58:untitled-event-notice] [SG2-58:AC1] [BOUNDARY] A blank event name must be notified as Untitled event';
 end if;
end $$;

-- Decision 1: only Preparation can be confirmed. SG2-94 AC5: an event still
-- on its way to the safety check is refused with the check outstanding, even
-- with every arrangement in place and an earlier Approve on record; every
-- other status is closed.
do $$
declare state public.event_status; result jsonb;
begin
 foreach state in array (select array_agg(s) from unnest(enum_range(null::public.event_status)) s where s <> 'preparation') loop
  update public.events set status=state,
   decision_reason=case when state='rejected' then 'Not suitable' end,
   completed_by=case when state='completed' then 'd5800000-0000-4000-8000-000000000003'::uuid end,
   completed_at=case when state='completed' then '2031-12-01T00:00Z'::timestamptz end
   where event_id=95873;
  perform set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
  result := public.confirm_event(95873);
  if state in ('approved','planning','awaiting_safety_check','safety_rejected') then
   if result is distinct from '{"outcome":"outstanding","outstanding":["safety"]}'::jsonb then
    raise exception '[SG2-94:unapproved-stage-lists-safety] [SG2-94:AC5] [FAILURE] An event in % must be refused with the safety check outstanding: %',state,result;
   end if;
  elsif result is distinct from jsonb_build_object('outcome','closed','status',state::text) then
   raise exception '[SG2-58:non-preparation-closed] [SG2-58:AC1] [FAILURE] An event in % must not be confirmable: %',state,result;
  end if;
 end loop;
 if exists(select 1 from public.event_audit_logs where event_id=95873)
   or exists(select 1 from public.notifications where event_id=95873)
   or (select confirmed_at from public.events where event_id=95873) is not null then
  raise exception '[SG2-58:closed-has-no-side-effects] [SG2-58:AC1] [FAILURE] A closed confirmation must write nothing';
 end if;
end $$;

-- Ownership, identity, role and grant checks are enforced by the database.
update public.events set coordinator_id='d5800000-0000-4000-8000-000000000004' where event_id=95874;
update public.events set coordinator_id=null where event_id=95875;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
do $$
begin
 if public.confirm_event(95874) is distinct from '{"outcome":"missing"}'::jsonb
   or public.confirm_event(95875) is distinct from '{"outcome":"missing"}'::jsonb
   or public.confirm_event(999999) is distinct from '{"outcome":"missing"}'::jsonb
   or public.confirm_event(null) is distinct from '{"outcome":"missing"}'::jsonb then
  raise exception '[SG2-58:unassigned-event-missing] [SG2-58:AC1] [FAILURE] Another coordinator''s, unassigned or unknown events must be reported missing';
 end if;
end $$;
do $$
declare n integer;
begin
 foreach n in array array[1,2,5,6,7,8,9] loop
  perform set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  begin
   perform public.confirm_event(95876);
   raise exception '[SG2-58:only-coordinator-confirms] [SG2-58:AC1] [FAILURE] A non-coordinator account must not confirm: %',n;
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.confirm_event(95876);
  raise exception '[SG2-58:identity-required] [SG2-58:AC1] [FAILURE] A database role without caller identity must not confirm';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$
begin
 begin
  perform public.confirm_event(95876);
  raise exception '[SG2-58:anonymous-execute-denied] [SG2-58:AC1] [FAILURE] Anonymous callers must not execute the confirmation RPC';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
 if exists(select 1 from public.events where event_id between 95874 and 95876 and status <> 'preparation')
   or exists(select 1 from public.notifications where event_id between 95874 and 95876) then
  raise exception '[SG2-58:denied-has-no-side-effects] [SG2-58:AC1] [FAILURE] Denied callers must not confirm or notify';
 end if;
end $$;

-- Notification failure rolls back the whole confirmation.
alter table public.notifications add constraint confirmation_test_notification_failure check(kind <> 'event_confirmed') not valid;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
do $$
begin
 begin
  perform public.confirm_event(95877);
  raise exception '[SG2-58:notification-failure-atomic] [SG2-58:AC1] [FAILURE] Notification failure must abort the confirmation';
 exception when check_violation then null; end;
end $$;
reset role;
alter table public.notifications drop constraint confirmation_test_notification_failure;
do $$
begin
 if (select status::text||'|'||coalesce(confirmed_at::text,'null') from public.events where event_id=95877) <> 'preparation|null'
   or exists(select 1 from public.event_audit_logs where event_id=95877) then
  raise exception '[SG2-58:notification-failure-no-partial-write] [SG2-58:AC1] [FAILURE] A failed notification must leave the event and history unchanged';
 end if;
end $$;

-- Revision 1: an approved request counts only while a confirmed booking is
-- linked to it, directly or through the hold it was converted from.
insert into public.venues(venue_id,name) values (95862,'Confirmation hold hall');
insert into public.events(event_id,organiser_id,coordinator_id,name,status,registration_needed)
 select 95890+n,'d5800000-0000-4000-8000-000000000002','d5800000-0000-4000-8000-000000000003',
  'Confirmation booking event '||n,case when n=0 then 'preparation' else 'planning' end::public.event_status,false
 from generate_series(0,2) n;
do $$
declare booking bigint;
begin
 insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status,cancelled_by,cancelled_at,cancellation_reason)
  values(95862,95890,'2032-01-01T09:00Z','2032-01-01T17:00Z','cancelled',
   'd5800000-0000-4000-8000-000000000005','2031-10-01T00:00Z','Flooded') returning booking_id into booking;
 insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status,venue_booking_id)
  values(95890,95862,'2032-01-01T09:00Z','2032-01-01T17:00Z','approved',booking);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000005',true);
do $$
declare hold jsonb; result jsonb; n integer;
begin
 foreach n in array array[1,2] loop
  hold := public.create_venue_hold(95890+n,95862,('2032-01-0'||(n+1)||'T09:00Z')::timestamptz,
   ('2032-01-0'||(n+1)||'T17:00Z')::timestamptz,clock_timestamp()+interval '30 days');
  result := public.change_venue_hold((hold->'hold'->>'hold_id')::bigint,'convert');
  if hold->>'outcome' is distinct from 'created' or result->>'outcome' is distinct from 'updated'
    or result->'hold'->>'booking_id' is null then
   raise exception '[SG2-58:hold-convert-fixture] [SG2-58:AC2] [NORMAL] The hold fixture must convert into a booking: % %',hold,result;
  end if;
  if n=2 then
   result := public.release_venue_booking((result->'hold'->>'booking_id')::bigint,'Venue flooded');
   if result->>'outcome' is distinct from 'released' then
    raise exception '[SG2-58:hold-release-fixture] [SG2-58:AC2] [CONFLICT] The converted booking must release: %',result;
   end if;
  end if;
 end loop;
end $$;
reset role;
-- SG2-94: each reaches Preparation on the Safety Officer's approval.
update public.events set status='awaiting_safety_check' where event_id in (95891,95892);
insert into public.event_safety_decisions(event_id,decision,decided_by)
 select event_id,'approve','d5800000-0000-4000-8000-000000000008' from unnest(array[95890,95891,95892]) event_id;
update public.events set status='preparation' where event_id in (95891,95892);
do $$
begin
 if not exists(select 1 from public.venue_booking_requests r join public.venue_holds h using(request_id)
      where r.event_id=95891 and r.status='approved' and r.venue_booking_id=h.booking_id)
    or not exists(select 1 from public.venue_booking_requests r join public.venue_holds h using(request_id)
      where r.event_id=95892 and r.status='cancelled' and r.venue_booking_id=h.booking_id) then
  raise exception '[SG2-58:hold-requests-linked-and-released] [SG2-58:AC2] [CONFLICT] Converted requests must link to their booking and released requests must no longer remain required';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
do $$
begin
 if public.confirm_event(95890) is distinct from '{"outcome":"outstanding","outstanding":["venue"]}'::jsonb then
  raise exception '[SG2-58:cancelled-booking-outstanding] [SG2-58:AC2] [BOUNDARY] An approved request whose booking was cancelled must list the venue as outstanding';
 end if;
 if public.confirm_event(95891)->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-58:converted-hold-confirms] [SG2-58:AC1] [NORMAL] An approved request booked through a converted hold must confirm';
 end if;
 if public.confirm_event(95892) is distinct from '{"outcome":"outstanding","outstanding":["venue"]}'::jsonb then
  raise exception '[SG2-58:released-hold-booking-outstanding] [SG2-58:AC2] [CONFLICT] A converted hold booking released afterwards must list the venue as outstanding';
 end if;
end $$;
reset role;
do $$
begin
 if exists(select 1 from public.events where event_id in (95890,95892) and status <> 'preparation')
   or exists(select 1 from public.event_audit_logs where event_id=95890)
   -- SG2-91: building this fixture moves 95892 into the safety check and back
   -- (both audited), so only a confirmation row would be a side effect.
   or exists(select 1 from public.event_audit_logs where event_id=95892 and field_name='status' and new_value='confirmed')
   or exists(select 1 from public.notifications where event_id in (95890,95892) and kind='event_confirmed')
   or (select status from public.events where event_id=95891) <> 'confirmed' then
  raise exception '[SG2-58:unbooked-venue-no-side-effects] [SG2-58:AC2] [FAILURE] Refusing an unbooked venue must not confirm, audit or notify';
 end if;
end $$;

-- SG2-39: existing receipts do not settle a persisted planning-impact recheck.
insert into public.events(event_id,organiser_id,coordinator_id,name,status,registration_needed,
 registration_capacity,registration_opens_at,registration_closes_at,arrangements_recheck_needed,outstanding_arrangements)
 select 95900+n,'d5800000-0000-4000-8000-000000000002','d5800000-0000-4000-8000-000000000003',
  'Planning recheck event '||n,'preparation',true,20,'2049-10-01T00:00Z','2049-10-02T00:00Z',n<>5,
  case n when 1 then '["venue_recheck"]'::jsonb when 2 then '["equipment_recheck"]'::jsonb
   when 3 then '["registration_recheck"]'::jsonb
   when 4 then '["registration_recheck","unknown","equipment_recheck","venue_recheck","venue_recheck"]'::jsonb
   when 5 then '["venue_recheck","equipment_recheck","registration_recheck"]'::jsonb
   when 6 then '[]'::jsonb when 7 then '["unknown_recheck"]'::jsonb
   when 8 then 'null'::jsonb else '{"venue_recheck":true}'::jsonb end
 from generate_series(1,9) n;
insert into public.event_safety_decisions(event_id,decision,decided_by)
 select 95900+n,'approve','d5800000-0000-4000-8000-000000000008' from generate_series(1,9) n;
do $$
declare n integer; booking bigint;
begin
 for n in 1..9 loop
  insert into public.venue_bookings(venue_id,event_id,starts_at,ends_at,status)
   values(95860,95900+n,'2050-11-01T09:00Z'::timestamptz+n*interval '1 day',
    '2050-11-01T17:00Z'::timestamptz+n*interval '1 day','confirmed') returning booking_id into booking;
  insert into public.venue_booking_requests(event_id,venue_id,starts_at,ends_at,status,venue_booking_id)
   values(95900+n,95860,'2050-11-01T09:00Z'::timestamptz+n*interval '1 day',
    '2050-11-01T17:00Z'::timestamptz+n*interval '1 day','approved',booking);
  insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,status,shortfall,placement_venue_id,placement_position)
   values(95900+n,95900+n,95860,1,'approved',0,95860,'Stage left');
  insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,starts_at,ends_at,request_id,reserved_at)
   values(95900+n,95860,1,'2050-11-01T09:00Z'::timestamptz+n*interval '1 day',
    '2050-11-01T17:00Z'::timestamptz+n*interval '1 day',95900+n,'2049-10-01T00:00Z');
 end loop;
end $$;
do $$
declare n integer; result jsonb; expected jsonb; events_before jsonb; bookings_before jsonb; receipts_before jsonb;
begin
 select jsonb_agg(to_jsonb(e) order by event_id) into events_before from public.events e where event_id between 95901 and 95904;
 select jsonb_agg(to_jsonb(b) order by booking_id) into bookings_before from public.venue_bookings b where event_id between 95901 and 95904;
 select jsonb_agg(to_jsonb(r) order by reservation_id) into receipts_before from public.equipment_reservations r where event_id between 95901 and 95904;
 perform set_config('request.jwt.claim.sub','d5800000-0000-4000-8000-000000000003',true);
 for n in 1..4 loop
  expected := case n when 1 then '["venue"]'::jsonb when 2 then '["equipment"]'::jsonb
   when 3 then '["registration"]'::jsonb else '["venue","equipment","registration"]'::jsonb end;
  result := public.confirm_event(95900+n);
  if result is distinct from jsonb_build_object('outcome','outstanding','outstanding',expected) then
   raise exception '[SG2-39:known-rechecks-block-confirmation] [SG2-39:AC2] [SG2-58:AC2] [CONFLICT] Known planning rechecks must block only their affected arrangements, once each in display order: %',result;
  end if;
 end loop;
 if events_before is distinct from (select jsonb_agg(to_jsonb(e) order by event_id) from public.events e where event_id between 95901 and 95904)
  or bookings_before is distinct from (select jsonb_agg(to_jsonb(b) order by booking_id) from public.venue_bookings b where event_id between 95901 and 95904)
  or receipts_before is distinct from (select jsonb_agg(to_jsonb(r) order by reservation_id) from public.equipment_reservations r where event_id between 95901 and 95904)
  or exists(select 1 from public.event_audit_logs where event_id between 95901 and 95904)
  or exists(select 1 from public.notifications where event_id between 95901 and 95904) then
  raise exception '[SG2-39:recheck-refusal-preserves-arrangements] [SG2-39:AC2] [SG2-58:AC2] [FAILURE] Refused rechecks must preserve the entire event, flags, bookings and receipts without auditing or notifying';
 end if;
 for n in 5..9 loop
  result := public.confirm_event(95900+n);
  if result->>'outcome' is distinct from 'ok' then
   raise exception '[SG2-39:inactive-unknown-rechecks-compatible] [SG2-39:AC2] [SG2-58:AC1] [BOUNDARY] False flags or absent/unknown/malformed marker arrays must preserve ordinary readiness: %',result;
  end if;
 end loop;
end $$;

-- Hosted rows confirmed before SG2-58 keep a null record; halves are refused.
do $$
begin
 update public.events set status='confirmed' where event_id=95878;
 if (select confirmed_by is null and confirmed_at is null from public.events where event_id=95878) is not true then
  raise exception '[SG2-58:legacy-confirmed-valid] [SG2-58:AC1] [BOUNDARY] A confirmed event without a confirmation record must remain valid';
 end if;
 begin
  update public.events set confirmed_by='d5800000-0000-4000-8000-000000000003' where event_id=95878;
  raise exception '[SG2-58:confirmed-by-needs-confirmed-at] [SG2-58:AC1] [FAILURE] confirmed_by without confirmed_at must be refused';
 exception when check_violation then null; end;
 begin
  update public.events set confirmed_at='2031-12-01T00:00Z' where event_id=95878;
  raise exception '[SG2-58:confirmed-at-needs-confirmed-by] [SG2-58:AC1] [FAILURE] confirmed_at without confirmed_by must be refused';
 exception when check_violation then null; end;
 if not exists(select 1 from pg_proc where oid='public.confirm_event(integer)'::regprocedure
   and prosecdef and provolatile='v' and proconfig @> array['search_path=""'])
  or not has_function_privilege('authenticated','public.confirm_event(integer)','EXECUTE')
  or has_function_privilege('anon','public.confirm_event(integer)','EXECUTE') then
  raise exception '[SG2-58:guarded-fresh-snapshot-rpc] [SG2-58:AC1] [NORMAL] Confirmation must use a scoped volatile definer executable only by authenticated callers';
 end if;
end $$;
rollback;
