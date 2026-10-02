-- Review trace: original PR #41, 42, 43.
-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
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
  ('b0000000-0000-4000-8000-000000000004'),  -- event_organiser
  ('b0000000-0000-4000-8000-000000000005');  -- technical_support_staff
insert into public.account_roles (user_id, role) values
  ('b0000000-0000-4000-8000-000000000001', 'venue_staff'),
  ('b0000000-0000-4000-8000-000000000002', 'event_coordinator'),
  ('b0000000-0000-4000-8000-000000000003', 'attendee'),
  ('b0000000-0000-4000-8000-000000000004', 'event_organiser'),
  ('b0000000-0000-4000-8000-000000000005', 'technical_support_staff');

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
    raise exception '[SG2-43:venue-staff-layout-read] [SG2-43:AC2] [NORMAL] Venue staff must see venue layouts';
  end if;
  if (select other_description from public.venue_layouts where venue_id = 900 and layout = 'other')
      is distinct from 'U-shape with side tables' then
    raise exception '[SG2-43:custom-description] [SG2-43:AC2] [NORMAL] Custom layout description must match the stored fixture';
  end if;
  insert into public.venue_layouts (venue_id, layout) values
    (900, 'theatre'), (900, 'boardroom'), (900, 'banquet'), (900, 'exhibition');
  if (select array_agg(layout::text order by layout::text) from public.venue_layouts where venue_id = 900)
      is distinct from array['banquet', 'boardroom', 'classroom', 'exhibition', 'other', 'theatre'] then
    raise exception '[SG2-43:supported-layout-set] [SG2-43:AC1] [NORMAL] Venue staff could not insert a venue layout directly';
  end if;
  begin
    insert into public.venue_layouts (venue_id, layout) values (900, 'classroom');
    raise exception '[SG2-43:duplicate-layout] [SG2-43:AC1] [CONFLICT] A venue must not store the same supported layout twice';
  exception when unique_violation then null;
  end;
  delete from public.venue_layouts where venue_id = 900 and layout in ('theatre', 'boardroom', 'banquet', 'exhibition');
  if (select count(*) from public.venue_layouts) <> 2 then
    raise exception '[SG2-43:remove-layouts] [SG2-43:AC1] [NORMAL] Venue staff could not delete a venue layout directly';
  end if;
  delete from public.venue_layouts where venue_id = 900;
  if exists (select 1 from public.venue_layouts where venue_id = 900) then
    raise exception '[SG2-43:empty-layout-set] [SG2-43:AC1] [BOUNDARY] Venue staff must be able to remove the last supported layout';
  end if;
  insert into public.venue_layouts (venue_id, layout, other_description) values
    (900, 'classroom', null), (900, 'other', 'U-shape with side tables');
end $$;

-- Event coordinator: reads every entry, cannot write directly.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_layouts) <> 2 then
    raise exception '[SG2-43:coordinator-layout-read] [SG2-43:AC2] [NORMAL] Event coordinator must see venue layouts';
  end if;
  begin
    insert into public.venue_layouts (venue_id, layout) values (900, 'theatre');
    raise exception '[SG2-43:coordinator-layout-insert] [SG2-43:AC1] [FAILURE] Event coordinator could insert venue layouts directly';
  exception when insufficient_privilege then null;
  end;
  -- A delete outside the row-matching policy silently removes zero rows
  -- rather than raising, so assert the targeted row survives instead.
  delete from public.venue_layouts where venue_id = 900 and layout = 'classroom';
  if not exists (select 1 from public.venue_layouts where venue_id = 900 and layout = 'classroom') then
    raise exception '[SG2-43:coordinator-layout-delete] [SG2-43:AC1] [FAILURE] Event coordinator could delete venue layouts directly';
  end if;
end $$;

-- Attendee: sees nothing.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_layouts) <> 0 then
    raise exception '[SG2-43:attendee-layout-read] [SG2-43:AC2] [FAILURE] Attendee could see venue layouts';
  end if;
end $$;

-- Event organiser: sees nothing.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.venue_layouts) <> 0 then
    raise exception '[SG2-43:organiser-layout-read] [SG2-43:AC2] [FAILURE] Event organiser could see venue layouts';
  end if;
end $$;

do $$
declare caller uuid; removed_rows integer;
begin
  foreach caller in array array[
    'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004'
  ]::uuid[] loop
    perform set_config('request.jwt.claim.sub', caller::text, true);
    begin
      insert into public.venue_layouts (venue_id, layout) values (900, 'theatre');
      raise exception '[SG2-43:external-layout-insert] [SG2-43:AC1] [FAILURE] External caller % must not record layouts', caller;
    exception when insufficient_privilege then null;
    end;
    delete from public.venue_layouts where venue_id = 900;
    get diagnostics removed_rows = row_count;
    if removed_rows <> 0 then
      raise exception '[SG2-43:external-layout-delete] [SG2-43:AC1] [FAILURE] External caller % must not remove layouts', caller;
    end if;
  end loop;
end $$;

-- Technical support is an internal role without layout read/write permission.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000005', true);
do $$
declare removed_rows integer;
begin
  if exists (select 1 from public.venue_layouts) then
    raise exception '[SG2-43:technical-support-read] [SG2-43:AC2] [FAILURE] Technical support must see no supported layouts';
  end if;
  begin
    insert into public.venue_layouts (venue_id, layout) values (900, 'theatre');
    raise exception '[SG2-43:technical-support-insert] [SG2-43:AC1] [FAILURE] Technical support must not add layouts';
  exception when insufficient_privilege then null;
  end;
  delete from public.venue_layouts where venue_id = 900;
  get diagnostics removed_rows = row_count;
  if removed_rows <> 0 then
    raise exception '[SG2-43:technical-support-delete] [SG2-43:AC1] [FAILURE] Technical support must not remove layouts';
  end if;
end $$;

-- Anonymous: no access to the table at all.
set local role anon;
do $$
begin
  begin
    perform * from public.venue_layouts;
    raise exception '[SG2-43:anonymous-layout-read] [SG2-43:AC2] [FAILURE] Anonymous caller could read venue layouts';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Constraints hold regardless of caller.
reset role;
do $$
begin
  begin
    insert into public.venue_layouts (venue_id, layout) values (900, 'cabaret');
    raise exception '[SG2-43:unsupported-layout] [SG2-43:AC1] [FAILURE] Unsupported layout values must be rejected';
  exception when invalid_text_representation then null;
  end;
  begin
    insert into public.venue_layouts (venue_id, layout) values (900, null);
    raise exception '[SG2-43:required-layout] [SG2-43:AC1] [BOUNDARY] A supported layout must have a type';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.venue_layouts (venue_id, layout, other_description) values (900, 'other', null);
    raise exception '[SG2-43:custom-layout-requires-description] [SG2-43:AC1] [BOUNDARY] "other" accepted without a description';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_layouts (venue_id, layout, other_description) values (900, 'classroom', 'not allowed');
    raise exception '[SG2-43:standard-layout-description] [SG2-43:AC1] [FAILURE] A non-"other" layout accepted a description';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_layouts (venue_id, layout) values (999, 'classroom');
    raise exception '[SG2-43:layout-venue-reference] [FAILURE] Layout accepted for nonexistent venue';
  exception when foreign_key_violation then null;
  end;
end $$;

rollback;
