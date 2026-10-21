-- Review trace: SG2-56 release equipment when an event will not happen.
-- Numeric AC tags follow the SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- SG2-56: cancelling an event releases its equipment reservations, returns
-- only operational stock not committed elsewhere, and records the release.
-- Disposable local/CI test script. All changes are rolled back.
begin;

insert into auth.users(id)
 select ('d5600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into public.users(user_id,name,role_id) values
 ('d5600000-0000-4000-8000-000000000001','Release support',4),
 ('d5600000-0000-4000-8000-000000000002','Release organiser',1),
 ('d5600000-0000-4000-8000-000000000003','Release coordinator',2);
insert into public.account_roles(user_id,role) values
 ('d5600000-0000-4000-8000-000000000001','technical_support_staff'),
 ('d5600000-0000-4000-8000-000000000002','event_organiser'),
 ('d5600000-0000-4000-8000-000000000003','event_coordinator');
-- 95601 is cancelled; 95602 keeps its overlapping reservation; 95603 asks for
-- the freed stock; 95604 is untouched by the cancellation.
insert into public.events(event_id,organiser_id,coordinator_id,name,status)
 select 95600+n,'d5600000-0000-4000-8000-000000000002','d5600000-0000-4000-8000-000000000003',
  'Release event '||n,'planning' from generate_series(1,4) n;
insert into public.equipment(equipment_id,name,quantity_total) values
 (95601,'Release microphones',10),(95602,'Release projectors',3);
insert into public.equipment_reservations(reservation_id,event_id,equipment_id,quantity_reserved,starts_at,ends_at,reserved_at) values
 (95601,95601,95601,6,'2031-11-01T09:00Z','2031-11-01T17:00Z',now()),
 (95602,95601,95602,3,'2031-11-01T09:00Z','2031-11-01T17:00Z',now()),
 (95603,95602,95601,4,'2031-11-01T09:00Z','2031-11-01T17:00Z',now()),
 (95604,95604,95601,2,'2032-11-01T09:00Z','2032-11-01T17:00Z',now());
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity,notes,shortfall,arrangement_notes) values
 (95601,95603,95601,7,'Seven microphones',0,'Support arrangements'),
 (95602,95603,95601,6,'Six microphones',0,'Support arrangements'),
 (95603,95603,95602,1,'One projector',0,'Support arrangements');

-- STAND-IN FOR SG2-67: cancel_event() is not built yet. It will set the
-- status as the assigned coordinator, which is all this stand-in does.
create function pg_temp.cancel_event_stand_in(p_event_id integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub','d5600000-0000-4000-8000-000000000003',true);
  update public.events set status = 'cancelled' where event_id = p_event_id;
$$;

-- 1. Before cancelling, 95601 and 95602 hold every microphone (6 + 4 of 10).
set local role authenticated;
select set_config('request.jwt.claim.sub','d5600000-0000-4000-8000-000000000001',true);
do $$
begin
 if (public.check_equipment_availability(95603,95602,'2031-11-01T09:00Z','2031-11-01T17:00Z')->>'quantity_remaining')::int <> 0 then
  raise exception '[SG2-56:held-before-cancel] [SG2-56:AC2] [NORMAL] Reserved microphones were counted as free before any cancellation';
 end if;
end $$;
reset role;

select pg_temp.cancel_event_stand_in(95601);

-- 2. AC1/AC3: both reservations are released with who, when and why.
do $$
begin
 if (select count(*) from public.equipment_reservations where event_id = 95601 and released_at is not null
     and released_by = 'd5600000-0000-4000-8000-000000000003' and release_reason = 'Event cancelled') <> 2 then
  raise exception '[SG2-56:cancel-releases-all] [SG2-56:AC1] [SG2-56:AC3] [NORMAL] Cancelling must release every reservation and record the coordinator, time and reason';
 end if;
 if (select count(*) from public.event_audit_logs where event_id = 95601 and field_name = 'equipment_reservation'
     and actor_id = 'd5600000-0000-4000-8000-000000000003') <> 2
   or not exists (select 1 from public.event_audit_logs where event_id = 95601
     and old_value = 'Reserved: 6 × Release microphones (reservation 95601)'
     and new_value = 'Released: 6 × Release microphones (reservation 95601) — Event cancelled') then
  raise exception '[SG2-56:release-in-history] [SG2-56:AC3] [NORMAL] Each released reservation must appear in the event history';
 end if;
 if exists (select 1 from public.equipment_reservations where event_id in (95602,95604) and released_at is not null) then
  raise exception '[SG2-56:other-events-kept] [SG2-56:AC1] [CONFLICT] Cancelling one event released another event''s equipment';
 end if;
end $$;

-- 3. AC2: the freed 6 return, but 95602's 4 stay committed elsewhere, so
-- 6 can be reserved for the same period and 7 cannot.
update public.equipment set operational_status = 'maintenance' where equipment_id = 95602;
set local role authenticated;
select set_config('request.jwt.claim.sub','d5600000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
 if (public.check_equipment_availability(95603,95602,'2031-11-01T09:00Z','2031-11-01T17:00Z')->>'quantity_remaining')::int <> 6 then
  raise exception '[SG2-56:freed-not-committed] [SG2-56:AC2] [NORMAL] Released microphones must return, less those still committed to another event';
 end if;
 result := public.manage_equipment_reservations('reserve',95603,95601,1,'2031-11-01T09:00Z','2031-11-01T17:00Z');
 if result->>'outcome' is distinct from 'insufficient' then
  raise exception '[SG2-56:above-freed-refused] [SG2-56:AC2] [BOUNDARY] Reserving 7 when 6 were freed must be refused: %', result;
 end if;
 result := public.manage_equipment_reservations('reserve',95603,95602,1,'2031-11-01T09:00Z','2031-11-01T17:00Z');
 if result->>'outcome' is distinct from 'ok' then
  raise exception '[SG2-56:exactly-freed-reserved] [SG2-56:AC2] [BOUNDARY] Reserving exactly the 6 freed microphones must succeed: %', result;
 end if;
 -- The projectors were released, but they are under maintenance.
 if (public.check_equipment_availability(95603,95603,'2031-11-01T09:00Z','2031-11-01T17:00Z')->>'quantity_remaining')::int <> 0 then
  raise exception '[SG2-56:maintenance-stays-unavailable] [SG2-56:AC2] [BOUNDARY] Released equipment under maintenance must remain unavailable';
 end if;
end $$;
reset role;

-- 4. Updating a cancelled event again, or another event's status, releases
-- nothing more and adds no history.
update public.events set status = 'cancelled', name = 'Release event 1 renamed' where event_id = 95601;
update public.events set status = 'confirmed' where event_id = 95602;
do $$
begin
 if (select count(*) from public.event_audit_logs where field_name = 'equipment_reservation'
     and event_id between 95601 and 95604) <> 2
   or exists (select 1 from public.equipment_reservations where event_id = 95602 and released_at is not null) then
  raise exception '[SG2-56:release-once] [SG2-56:AC1] [SG2-56:AC3] [CONFLICT] Only the move into Cancelled may release equipment, and only once';
 end if;
end $$;

-- 5. Nobody can write a release by hand or run the release function.
set local role authenticated;
select set_config('request.jwt.claim.sub','d5600000-0000-4000-8000-000000000001',true);
do $$
begin
 begin
  update public.equipment_reservations set released_at = now(), release_reason = 'Manual' where reservation_id = 95603;
  raise exception '[SG2-56:direct-release-refused] [SG2-56:AC3] [FAILURE] An authenticated caller wrote a release directly';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.release_cancelled_event_equipment();
  raise exception '[SG2-56:release-function-private] [SG2-56:AC1] [FAILURE] An authenticated caller ran the release trigger function';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
do $$
begin
 begin
  update public.equipment_reservations set released_at = now(), release_reason = '  ' where reservation_id = 95603;
  raise exception '[SG2-56:blank-reason-refused] [SG2-56:AC3] [FAILURE] A release was stored without a reason';
 exception when check_violation then null;
 end;
end $$;

rollback;
