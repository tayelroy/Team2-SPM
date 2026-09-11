-- SG2-42: real table permissions and RLS; all test data rolls back.
begin;
insert into auth.users (id) values
  ('42000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000002'),
  ('42000000-0000-4000-8000-000000000003');
insert into public.account_roles (user_id, role) values
  ('42000000-0000-4000-8000-000000000001', 'venue_staff'),
  ('42000000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('42000000-0000-4000-8000-000000000003', 'attendee');

set local role authenticated;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000001', true);
insert into public.venues (name, location, capacity, facilities, accessibility_features, operating_information)
  values ('SG2-42 test venue', 'North wing', 100, 'Stage', 'Lift', 'Weekdays');
update public.venues set capacity = 200 where name = 'SG2-42 test venue';
do $$ begin
  if not exists (select 1 from public.venues where name = 'SG2-42 test venue' and capacity = 200) then
    raise exception 'Venue Staff could not create/update their venue';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000002', true);
do $$ begin
  if not exists (select 1 from public.venues where name = 'SG2-42 test venue' and capacity = 200) then
    raise exception 'Coordinator cannot see the saved update';
  end if;
  begin
    insert into public.venues (name) values ('Unauthorized insert');
    raise exception 'Coordinator inserted a venue';
  exception when insufficient_privilege then null;
  end;
  update public.venues set capacity = 1 where name = 'SG2-42 test venue';
  if found then raise exception 'Coordinator edited a venue'; end if;
end $$;

select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000003', true);
do $$ begin
  if exists (select 1 from public.venues) then raise exception 'Attendee read internal venue records'; end if;
  begin
    insert into public.venues (name) values ('Unauthorized insert');
    raise exception 'Attendee inserted a venue';
  exception when insufficient_privilege then null;
  end;
  update public.venues set capacity = 1 where name = 'SG2-42 test venue';
  if found then raise exception 'Attendee edited a venue'; end if;
end $$;

reset role;
update public.account_roles set role = 'event_coordinator'
  where user_id = '42000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000001', true);
do $$ begin
  update public.venues set capacity = 1 where name = 'SG2-42 test venue';
  if found then raise exception 'Downgraded user edited a venue'; end if;
  begin
    delete from public.venues where name = 'SG2-42 test venue';
    raise exception 'Authenticated caller deleted a venue';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.venues;
    raise exception 'Anonymous caller read venues';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
