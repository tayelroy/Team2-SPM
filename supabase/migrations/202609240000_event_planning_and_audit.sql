-- SG2-39 & SG2-40: Event planning fields and audit log table.
-- Adds planning fields, capacity/time constraints, arrangements recheck tracking,
-- and dedicated audit trail for event planning updates.
begin;

-- 1. Add planning and recheck columns to public.events
alter table public.events
  add column if not exists registration_capacity integer,
  add column if not exists registration_opens_at timestamptz,
  add column if not exists registration_closes_at timestamptz,
  add column if not exists planning_notes text,
  add column if not exists arrangements_recheck_needed boolean not null default false,
  add column if not exists outstanding_arrangements jsonb not null default '[]'::jsonb;

-- 2. Domain validation constraints on public.events
alter table public.events
  add constraint events_registration_capacity_positive
    check (registration_capacity is null or registration_capacity > 0),
  add constraint events_registration_window_valid
    check (
      registration_opens_at is null
      or registration_closes_at is null
      or registration_closes_at > registration_opens_at
    );

create index if not exists events_arrangements_recheck_idx
  on public.events (arrangements_recheck_needed)
  where arrangements_recheck_needed = true;

-- 3. Create event audit logs table
create table public.event_audit_logs (
  log_id bigserial primary key,
  event_id integer not null references public.events(event_id) on delete cascade,
  actor_id uuid not null references public.users(user_id),
  field_name text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index event_audit_logs_event_created_idx
  on public.event_audit_logs (event_id, created_at desc);

create index event_audit_logs_actor_idx
  on public.event_audit_logs (actor_id);

-- 4. Row Level Security & permissions on event_audit_logs
alter table public.event_audit_logs enable row level security;
alter table public.event_audit_logs force row level security;

revoke all on table public.event_audit_logs from public, anon, authenticated;
revoke all on sequence public.event_audit_logs_log_id_seq from public, anon, authenticated;

grant select on table public.event_audit_logs to authenticated;
grant select, insert, update, delete on table public.event_audit_logs to service_role;
grant usage, select on sequence public.event_audit_logs_log_id_seq to service_role;

-- Authenticated internal staff (coordinator, venue staff, tech support) and the
-- event's own organiser can read audit logs. Direct mutations by callers are refused.
create policy event_audit_logs_read on public.event_audit_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.account_roles ar
      where ar.user_id = (select auth.uid())
        and ar.role in ('event_coordinator', 'venue_staff', 'technical_support_staff')
    )
    or exists (
      select 1 from public.events e
      where e.event_id = event_audit_logs.event_id
        and e.organiser_id = (select auth.uid())
    )
  );

commit;
