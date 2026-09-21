-- Minimal Supabase identity schema for an empty CI database.
begin;

create role anon;
create role authenticated;
create role service_role bypassrls;

create schema auth;
create table auth.users (id uuid primary key);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Reproduce Supabase's default public-schema exposure so feature migrations
-- must explicitly revoke client access rather than pass with absent grants.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

commit;
