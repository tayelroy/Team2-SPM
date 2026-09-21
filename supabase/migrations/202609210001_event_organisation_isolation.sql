-- SG2-26: organisation membership is server-owned. The API uses service_role
-- and applies its own authorisation; these policies also protect direct
-- Supabase reads using an ordinary user's JWT.
begin;

alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.events enable row level security;
alter table public.events force row level security;

-- Never let a client change its organisation or an event's organisation.
-- Profile edits and event mutations must pass through the authorised API.
revoke all on table public.users, public.events from public, anon, authenticated;
grant select on table public.users, public.events to authenticated;
grant select, insert, update, delete on table public.users, public.events to service_role;
revoke all on sequence public.events_event_id_seq from public, anon, authenticated;
grant usage, select on sequence public.events_event_id_seq to service_role;

create policy users_read_self on public.users
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy events_read_organisation on public.events
  for select to authenticated
  using (exists (
    select 1
    from public.users membership
    join public.account_roles assignment on assignment.user_id = membership.user_id
    where membership.user_id = (select auth.uid())
      and assignment.role = 'event_organiser'
      -- Use the same whitespace set as JavaScript trim() for blank detection,
      -- including nonbreaking spaces and BOM, without changing the identifier.
      and btrim(membership.organisation,
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') <> ''
      -- Do not trim or lowercase equality: similarly named organisations
      -- must not become a shared tenant. Missing/blank membership fails closed.
      and membership.organisation = events.organisation
  ));

create index events_organisation_idx on public.events (organisation);

commit;
