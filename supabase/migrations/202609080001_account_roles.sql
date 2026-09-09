-- Stores one role per provisioned Auth user.
begin;

create table public.account_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in (
    'event_organiser', 'event_coordinator', 'venue_staff',
    'technical_support_staff', 'attendee'
  ))
);

alter table public.account_roles enable row level security;
alter table public.account_roles force row level security;

-- Supabase default grants may otherwise permit writes to newly created tables.
revoke all on table public.account_roles from public, anon, authenticated;
grant select on table public.account_roles to authenticated;
grant select, insert, update, delete on table public.account_roles to service_role;

create policy account_roles_read_self on public.account_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Role writes are restricted to privileged server operations.
-- Accounts without an assigned role are denied by the API.
commit;
