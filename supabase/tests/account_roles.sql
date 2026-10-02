-- Review trace: original PR #12.
-- Numeric AC tags follow verified SPM Jira criteria; descriptive tags identify supporting contracts.
-- Run each suite in its own disposable database transaction.
-- Run after the migration in a disposable/development Supabase database as postgres.
-- Test records and role changes are rolled back. Never run against production.
begin;

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000004'); -- Provisioned, not assigned a role.
insert into public.account_roles (user_id, role) values
  ('10000000-0000-4000-8000-000000000001', 'event_organiser'),
  ('20000000-0000-4000-8000-000000000002', 'attendee');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.account_roles) <> 1 then
    raise exception '[SG2-24:self-role-count] [SG2-24:AC1] [NORMAL] RLS must expose exactly the caller role';
  end if;
  if (select role from public.account_roles) is distinct from 'event_organiser' then
    raise exception '[SG2-24:self-role-value] [SG2-24:AC3] [NORMAL] RLS returned another user role';
  end if;
  if exists (select 1 from public.account_roles where user_id = '20000000-0000-4000-8000-000000000002') then
    raise exception '[SG2-24:other-role-lookup] [FAILURE] Direct lookup exposed another user';
  end if;
  begin
    update public.account_roles set role = 'technical_support_staff';
    raise exception '[SG2-24:self-promotion] [SG2-24:AC2] [FAILURE] Authenticated caller could promote themselves';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.account_roles values ('10000000-0000-4000-8000-000000000001', 'technical_support_staff');
    raise exception '[SG2-24:direct-role-insert] [SG2-24:AC2] [FAILURE] Authenticated caller could insert roles';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.account_roles;
    raise exception '[SG2-24:direct-role-delete] [SG2-24:AC2] [FAILURE] Authenticated caller could delete roles';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role anon;
do $$
begin
  begin
    insert into public.account_roles (user_id, role)
      values ('40000000-0000-4000-8000-000000000004', 'attendee');
    raise exception '[SG2-24:anonymous-role-insert] [SG2-24:AC2] [FAILURE] Anonymous callers must not assign roles';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.account_roles;
    raise exception '[SG2-24:anonymous-role-delete] [SG2-24:AC2] [FAILURE] Anonymous callers must not remove roles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.account_roles;
    raise exception '[SG2-24:anonymous-role-read] [FAILURE] Anonymous caller could read roles';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.account_roles set role = 'technical_support_staff';
    raise exception '[SG2-24:anonymous-role-update] [SG2-24:AC2] [FAILURE] Anonymous caller could update roles';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role service_role;
update public.account_roles set role = 'attendee'
  where user_id = '10000000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
begin
  if (select role from public.account_roles) is distinct from 'attendee' then
    raise exception '[SG2-24:fresh-role-value] [SG2-24:AC3] [CONFLICT] Current role was not visible with unchanged identity claims';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000004', true);
do $$
begin
  if exists (select 1 from public.account_roles) then
    raise exception '[SG2-24:unassigned-account] [BOUNDARY] An account without an assignment must see no roles';
  end if;
end $$;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.account_roles) then
    raise exception '[SG2-24:missing-identity] [FAILURE] Missing identity must expose no roles';
  end if;
end $$;

set local role service_role;
do $$
declare
  supported_role text;
begin
  foreach supported_role in array array[
    'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'
  ] loop
    update public.account_roles set role = supported_role
      where user_id = '10000000-0000-4000-8000-000000000001';
    if (select role from public.account_roles
        where user_id = '10000000-0000-4000-8000-000000000001') is distinct from supported_role then
      raise exception '[SG2-24:supported-role-values] [SG2-24:AC1] [NORMAL] Supported role % was not stored', supported_role;
    end if;
  end loop;
end $$;

reset role;
do $$
begin
  begin
    update public.account_roles set role = 'admin';
    raise exception '[SG2-24:unknown-role] [SG2-24:AC1] [FAILURE] Unknown role accepted';
  exception when check_violation then null;
  end;
  begin
    update public.account_roles set role = null;
    raise exception '[SG2-24:required-role] [SG2-24:AC1] [BOUNDARY] Null role accepted';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.account_roles values ('10000000-0000-4000-8000-000000000001', 'attendee');
    raise exception '[SG2-24:single-role-per-account] [SG2-24:AC1] [CONFLICT] Multiple roles accepted for one account';
  exception when unique_violation then null;
  end;
  begin
    insert into public.account_roles values ('30000000-0000-4000-8000-000000000003', 'attendee');
    raise exception '[SG2-24:account-reference] [FAILURE] Role accepted for nonexistent account';
  exception when foreign_key_violation then null;
  end;
end $$;

rollback;
