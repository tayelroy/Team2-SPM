-- Run after account_roles.sql, in the same disposable/development Supabase
-- database as postgres. Test records and changes are rolled back. Never run
-- against production.
begin;

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'), -- organiser
  ('20000000-0000-4000-8000-000000000002'), -- another organiser
  ('30000000-0000-4000-8000-000000000003'); -- coordinator
insert into public.account_roles (user_id, role) values
  ('10000000-0000-4000-8000-000000000001', 'event_organiser'),
  ('20000000-0000-4000-8000-000000000002', 'event_organiser'),
  ('30000000-0000-4000-8000-000000000003', 'event_coordinator');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  own_draft_id uuid;
  affected int;
begin
  insert into public.event_requests (organiser_id, status, event_name)
    values ('10000000-0000-4000-8000-000000000001', 'draft', 'Own draft')
    returning id into own_draft_id;

  begin
    insert into public.event_requests (organiser_id, status)
      values ('20000000-0000-4000-8000-000000000002', 'draft');
    raise exception 'Organiser could create a draft for someone else';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.event_requests (organiser_id, status)
      values ('10000000-0000-4000-8000-000000000001', 'submitted');
    raise exception 'Organiser could insert a request already marked submitted';
  exception when insufficient_privilege then null;
  end;

  update public.event_requests set event_name = 'Renamed draft' where id = own_draft_id;
  if (select event_name from public.event_requests where id = own_draft_id) <> 'Renamed draft' then
    raise exception 'Organiser could not edit their own draft';
  end if;

  update public.event_requests set status = 'submitted' where id = own_draft_id;
  if (select status from public.event_requests where id = own_draft_id) <> 'submitted' then
    raise exception 'Organiser could not submit their own draft';
  end if;

  update public.event_requests set event_name = 'Edit after submission' where id = own_draft_id;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Organiser could edit a request after it was submitted';
  end if;
  if (select event_name from public.event_requests where id = own_draft_id) <> 'Renamed draft' then
    raise exception 'Submitted request changed despite the edit lock';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare
  other_draft_id uuid;
  affected int;
begin
  insert into public.event_requests (organiser_id, status, event_name)
    values ('20000000-0000-4000-8000-000000000002', 'draft', 'Second organiser draft')
    returning id into other_draft_id;

  if (select count(*) from public.event_requests) <> 1 then
    raise exception 'Organiser could see another organiser''s requests';
  end if;

  -- Out of policy scope, not a privilege error: the row is simply invisible
  -- to this organiser, so the UPDATE matches and changes zero rows.
  update public.event_requests set event_name = 'Hijacked'
    where organiser_id = '10000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Organiser updated a row scoped to someone else';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

do $$
declare
  affected int;
begin
  -- The coordinator sees only the one submitted request (SG2-30 AC1); the
  -- second organiser's still-draft request stays out of the review queue.
  if (select count(*) from public.event_requests) <> 1 then
    raise exception 'Coordinator visibility did not match exactly the submitted requests';
  end if;
  if (select status from public.event_requests limit 1) <> 'submitted' then
    raise exception 'Coordinator could see a draft request';
  end if;

  -- Not the row's organiser, so the update policy excludes it: 0 rows change.
  update public.event_requests set event_name = 'Coordinator edit'
    where status = 'submitted';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Coordinator could edit an event request';
  end if;

  begin
    insert into public.event_requests (organiser_id, status) values
      ('30000000-0000-4000-8000-000000000003', 'draft');
    raise exception 'Coordinator could create an event request';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role anon;
do $$
begin
  begin
    perform * from public.event_requests;
    raise exception 'Anonymous caller could read event requests';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.event_requests (organiser_id, status) values
      ('10000000-0000-4000-8000-000000000001', 'draft');
    raise exception 'Anonymous caller could create an event request';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role service_role;
do $$
begin
  if (select count(*) from public.event_requests) <> 2 then
    raise exception 'Service role did not see every event request';
  end if;
end $$;

rollback;
