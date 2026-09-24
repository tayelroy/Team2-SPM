-- Run after the migrations in a disposable/development database as postgres.
-- Test records are rolled back. Never run against production.
--
-- Covers SG2-43 acceptance: Venue Staff and Event Coordinators read a
-- venue's supported layouts; other internal and external roles cannot;
-- only Venue Staff can write directly; the "other" description constraint
-- holds regardless of caller.
begin;

insert into auth.users (id) values
  ('b0000000-0000-4000-8000-000000000001'),  -- venue_staff
  ('b0000000-0000-4000-8000-000000000002'),  -- event_coordinator
  ('b0000000-0000-4000-8000-000000000003'),  -- attendee
  ('b0000000-0000-4000-8000-000000000004');  -- event_organiser
insert into public.account_roles (user_id, role) values
  ('b0000000-0000-4000-8000-000000000001', 'venue_staff'),
  ('b0000000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('b0000000-0000-4000-8000-000000000003', 'attendee'),
  ('b0000000-0000-4000-8000-000000000004', 'event_organiser');

insert into public.venues (venue_id, name) values (900, 'Test Hall');
insert into public.venue_layouts (venue_id, layout, other_description) values
  (900, 'classroom', null),
  (900, 'other', 'U-shape with side tables');

-- Venue staff: reads every entry and can write directly.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_layouts) <> 2 then
    raise exception 'Venue staff must see venue layouts';
  end if;
  insert into public.venue_layouts (venue_id, layout) values (900, 'theatre');
  if (select count(*) from public.venue_layouts) <> 3 then
    raise exception 'Venue staff could not insert a venue layout directly';
  end if;
  delete from public.venue_layouts where venue_id = 900 and layout = 'theatre';
  if (select count(*) from public.venue_layouts) <> 2 then
    raise exception 'Venue staff could not delete a venue layout directly';
  end if;
end $$;

-- Event coordinator: reads every entry, cannot write directly.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_layouts) <> 2 then
    raise exception 'Event coordinator must see venue layouts';
  end if;
  begin
    insert into public.venue_layouts (venue_id, layout) values (900, 'theatre');
    raise exception 'Event coordinator could insert venue layouts directly';
  exception when insufficient_privilege then null;
  end;
  -- A delete outside the row-matching policy silently removes zero rows
  -- rather than raising, so assert the targeted row survives instead.
  delete from public.venue_layouts where venue_id = 900 and layout = 'classroom';
  if not exists (select 1 from public.venue_layouts where venue_id = 900 and layout = 'classroom') then
    raise exception 'Event coordinator could delete venue layouts directly';
  end if;
end $$;

-- Attendee: sees nothing.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_layouts) <> 0 then
    raise exception 'Attendee could see venue layouts';
  end if;
end $$;

-- Event organiser: sees nothing.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_layouts) <> 0 then
    raise exception 'Event organiser could see venue layouts';
  end if;
end $$;

-- Anonymous: no access to the table at all.
set local role anon;
do $$
begin
  begin
    perform * from public.venue_layouts;
    raise exception 'Anonymous caller could read venue layouts';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Constraints hold regardless of caller.
reset role;
do $$
begin
  begin
    insert into public.venue_layouts (venue_id, layout, other_description) values (900, 'other', null);
    raise exception '"other" accepted without a description';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_layouts (venue_id, layout, other_description) values (900, 'classroom', 'not allowed');
    raise exception 'A non-"other" layout accepted a description';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_layouts (venue_id, layout) values (999, 'classroom');
    raise exception 'Layout accepted for nonexistent venue';
  exception when foreign_key_violation then null;
  end;
end $$;

rollback;
