-- Disposable upgrade database only. Seed immediately before170004; never hosted.
-- Each deliberately inconsistent legacy relationship is an exclusion control.
begin;
create schema hold_link_upgrade_fixture;
insert into auth.users(id) values
 ('f8840000-0000-4000-8000-000000000001'),('f8840000-0000-4000-8000-000000000002'),('f8840000-0000-4000-8000-000000000003');
insert into public.users(user_id,name,role_id) values
 ('f8840000-0000-4000-8000-000000000001','Legacy hold staff',3),
 ('f8840000-0000-4000-8000-000000000002','Legacy hold coordinator',2),
 ('f8840000-0000-4000-8000-000000000003','Legacy hold organiser',1);
insert into public.account_roles(user_id,role) values
 ('f8840000-0000-4000-8000-000000000001','venue_staff'),
 ('f8840000-0000-4000-8000-000000000002','event_coordinator'),
 ('f8840000-0000-4000-8000-000000000003','event_organiser');
insert into public.venues(venue_id,name,capacity) values(988401,'Legacy hold hall',100),(988402,'Different legacy venue',100);
insert into public.events(event_id,organiser_id,coordinator_id,name,status,expected_attendance,registration_needed)
 select 988401+n,'f8840000-0000-4000-8000-000000000003','f8840000-0000-4000-8000-000000000002',
  'Legacy hold case '||n,'planning'::public.event_status,10,false from generate_series(1,15)n;
insert into public.events(event_id,organiser_id,coordinator_id,name,status) values
 (988499,'f8840000-0000-4000-8000-000000000003','f8840000-0000-4000-8000-000000000002','Mismatching legacy event','planning');
insert into public.venue_bookings(booking_id,event_id,venue_id,starts_at,ends_at,status,cancelled_by,cancelled_at,cancellation_reason)
 select 988401+n,case when n=13 then 988499 else 988401+n end,case when n=14 then 988402 else 988401 end,'2035-01-01T09:00Z'::timestamptz+n*interval '1 day',
  '2035-01-01T10:00Z'::timestamptz+n*interval '1 day'+case when n=8 then interval '5 minutes' else interval '0' end,
  case when n in(2,12) then 'cancelled' else 'confirmed' end,
  case when n in(2,12) then 'f8840000-0000-4000-8000-000000000001'::uuid else null end,
  case when n in(2,12) then '2030-02-02T10:00Z'::timestamptz else null end,
  case when n in(2,12) then 'Original legacy release reason '||n else null end
 from generate_series(1,15)n where n<>10;
insert into public.venue_bookings(booking_id,event_id,venue_id,starts_at,ends_at,status,cancelled_by,cancelled_at,cancellation_reason) values
 (988499,988410,988401,'2035-12-01T09:00Z','2035-12-01T10:00Z','cancelled',
  'f8840000-0000-4000-8000-000000000001','2030-02-02T10:00Z','Unrelated historical booking');
insert into public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,status,notes,requested_at,
 decided_by,decided_at,decision_reason,venue_booking_id,withdrawn_by,withdrawn_at)
 select 988401+n,case when n=5 then 988499 else 988401+n end,case when n=6 then 988402 else 988401 end,
  '2035-01-01T09:00Z'::timestamptz+n*interval '1 day'+case when n=7 then interval '5 minutes' else interval '0' end,
  '2035-01-01T10:00Z'::timestamptz+n*interval '1 day',
  case when n=3 then 'cancelled' when n in(10,15) then 'pending' when n=11 then 'rejected' else 'approved' end,
  'Retained legacy notes '||n,'2030-01-01T09:00Z',
  'f8840000-0000-4000-8000-000000000001','2030-01-02T09:00Z','Retained legacy decision '||n,
  case when n in(4,12) then 988401+n when n=9 then 988499 else null end,
  case when n=3 then 'f8840000-0000-4000-8000-000000000002'::uuid else null end,
  case when n=3 then '2030-01-03T09:00Z'::timestamptz else null end
 from generate_series(1,15)n;
insert into public.venue_holds(hold_id,event_id,venue_id,request_id,booking_id,starts_at,ends_at,expires_at,status,created_by,created_at)
 select 988401+n,988401+n,988401,988401+n,case when n=10 then null else 988401+n end,
  '2035-01-01T09:00Z'::timestamptz+n*interval '1 day','2035-01-01T10:00Z'::timestamptz+n*interval '1 day',
  '2034-01-01T09:00Z',case when n=10 then 'tentative' else 'converted' end,
  'f8840000-0000-4000-8000-000000000001','2030-01-01T09:00Z'
 from generate_series(1,15)n;
create table hold_link_upgrade_fixture.before as
 select n,r.request_id,to_jsonb(r) as request_before,to_jsonb(h) as hold_before,to_jsonb(b) as booking_before,to_jsonb(e) as event_before
 from generate_series(1,15)n
 join public.venue_booking_requests r on r.request_id=988401+n
 join public.venue_holds h on h.hold_id=988401+n
 left join public.venue_bookings b on b.booking_id=h.booking_id
 join public.events e on e.event_id=h.event_id;
create table hold_link_upgrade_fixture.activity_before as
 select (select count(*) from public.event_audit_logs where event_id between 988402 and 988416) as audits,
        (select count(*) from public.notifications where event_id between 988402 and 988416) as notices,
        (select count(*) from public.venue_hold_notifications where event_id between 988402 and 988416) as hold_notices;
commit;
