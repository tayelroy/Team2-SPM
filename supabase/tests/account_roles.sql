-- Run after the migration in a disposable/development Supabase database as postgres.
-- Test records and role changes are rolled back. Never run against production.
begin;

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002');
insert into public.account_roles (user_id, role) values
  ('10000000-0000-4000-8000-000000000001', 'event_organiser'),
  ('20000000-0000-4000-8000-000000000002', 'attendee');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.account_roles) <> 1 then
    raise exception 'RLS must expose exactly the caller role';
  end if;
  if (select role from public.account_roles) <> 'event_organiser' then
    raise exception 'RLS returned another user role';
  end if;
  if exists (select 1 from public.account_roles where user_id = '20000000-0000-4000-8000-000000000002') then
    raise exception 'Direct lookup exposed another user';
  end if;
  begin
    update public.account_roles set role = 'technical_support_staff';
    raise exception 'Authenticated caller could promote themselves';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.account_roles values ('10000000-0000-4000-8000-000000000001', 'technical_support_staff');
    raise exception 'Authenticated caller could insert roles';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.account_roles;
    raise exception 'Authenticated caller could delete roles';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role anon;
do $$
begin
  begin
    perform * from public.account_roles;
    raise exception 'Anonymous caller could read roles';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.account_roles set role = 'technical_support_staff';
    raise exception 'Anonymous caller could update roles';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role service_role;
update public.account_roles set role = 'attendee'
  where user_id = '10000000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
begin
  if (select role from public.account_roles) <> 'attendee' then
    raise exception 'Current role was not visible with unchanged identity claims';
  end if;
end $$;

reset role;
do $$
begin
  begin
    update public.account_roles set role = 'admin';
    raise exception 'Unknown role accepted';
  exception when check_violation then null;
  end;
  begin
    update public.account_roles set role = null;
    raise exception 'Null role accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.account_roles values ('10000000-0000-4000-8000-000000000001', 'attendee');
    raise exception 'Multiple roles accepted for one account';
  exception when unique_violation then null;
  end;
  begin
    insert into public.account_roles values ('30000000-0000-4000-8000-000000000003', 'attendee');
    raise exception 'Role accepted for nonexistent account';
  exception when foreign_key_violation then null;
  end;
end $$;

rollback;
