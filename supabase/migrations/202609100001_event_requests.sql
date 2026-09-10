-- Event requests: an Event Organiser's draft, submitted for ConnectSphere
-- review (SG2-30). Fields follow the mandatory/optional list from SG2-28/29;
-- they are nullable here because a draft may still have them unset.
begin;

create table public.event_requests (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  event_name text,
  purpose text,
  description text,
  proposed_date_time timestamptz,
  expected_attendance integer,
  venue_requirements text,
  equipment_requirements text,
  registration_needed boolean,
  accessibility_needs text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.event_requests enable row level security;
alter table public.event_requests force row level security;

-- Supabase default grants may otherwise permit writes to newly created tables.
revoke all on table public.event_requests from public, anon, authenticated;
grant select, insert, update on table public.event_requests to authenticated;
grant select, insert, update, delete on table public.event_requests to service_role;

-- Organisers see only their own requests, draft or submitted.
create policy event_requests_select_own on public.event_requests
  for select to authenticated
  using (organiser_id = (select auth.uid()));

-- Drafts are not visible in coordinator review queues (SG2-30 AC1); only
-- requests that have left draft status are exposed to coordinators.
create policy event_requests_select_submitted_for_coordinators on public.event_requests
  for select to authenticated
  using (
    status = 'submitted'
    and exists (
      select 1 from public.account_roles
      where user_id = (select auth.uid()) and role = 'event_coordinator'
    )
  );

-- Only Event Organisers may create requests, and only their own drafts.
create policy event_requests_insert_own_draft on public.event_requests
  for insert to authenticated
  with check (
    organiser_id = (select auth.uid())
    and status = 'draft'
    and exists (
      select 1 from public.account_roles
      where user_id = (select auth.uid()) and role = 'event_organiser'
    )
  );

-- Direct table updates are limited to the owning organiser's own draft rows.
-- The API enforces the SG2-30 AC3 edit lock first for a clean 404/409, but
-- RLS blocks it here too even if application code has a bug: once a row's
-- status leaves 'draft' this policy's USING clause no longer matches it.
create policy event_requests_update_own_draft on public.event_requests
  for update to authenticated
  using (organiser_id = (select auth.uid()) and status = 'draft')
  with check (organiser_id = (select auth.uid()));

commit;
