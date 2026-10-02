-- Clarification exchange between a coordinator and an organiser (SG2-36).
--
-- A coordinator reviewing a request may return it to the organiser with a
-- question instead of deciding on incomplete information. The request then
-- sits in a state the organiser can edit and resubmit from, and the
-- conversation stays attached to the event record rather than living in
-- email.
--
-- `needs_clarification` is added to event_status rather than reusing
-- `rejected`: a rejection is a decision with a reason (SG2-37), while this is
-- an open question with the request still live. Postgres 12+ permits
-- ALTER TYPE ... ADD VALUE inside a transaction as long as the new value is
-- not used before commit, and nothing here writes it.
begin;

alter type public.event_status add value if not exists 'needs_clarification';

create table public.event_clarifications (
  clarification_id bigserial primary key,
  event_id         integer not null references public.events(event_id) on delete cascade,
  sender_id        uuid not null references public.users(user_id),
  message          text not null,
  created_at       timestamptz not null default now(),
  constraint event_clarifications_message_not_blank check (btrim(message) <> '')
);

-- The thread is read newest-last in event order, so index the read path.
create index event_clarifications_event_created_idx
  on public.event_clarifications (event_id, created_at);

alter table public.event_clarifications enable row level security;
alter table public.event_clarifications force row level security;

revoke all on table public.event_clarifications from public, anon, authenticated;
revoke all on sequence public.event_clarifications_clarification_id_seq from public, anon, authenticated;

grant select on table public.event_clarifications to authenticated;
grant select, insert, update, delete on table public.event_clarifications to service_role;
grant usage, select on sequence public.event_clarifications_clarification_id_seq to service_role;

-- Mirrors the audit log policy: internal staff read any event's thread, and an
-- organiser reads the threads on their own events. Writes go through the API
-- with the service role, so no insert policy is granted to callers.
create policy event_clarifications_read on public.event_clarifications
  for select to authenticated
  using (
    exists (
      select 1 from public.account_roles ar
      where ar.user_id = (select auth.uid())
        and ar.role in ('event_coordinator', 'venue_staff', 'technical_support_staff')
    )
    or exists (
      select 1 from public.events e
      where e.event_id = event_clarifications.event_id
        and e.organiser_id = (select auth.uid())
    )
  );

commit;
