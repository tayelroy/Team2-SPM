-- SG2-86: Week 7 customer changes #5 & #6 — add the Event Coordinator Lead
-- and Safety Officer account roles alongside the existing five.
begin;

insert into public.roles (role_id, role_name) values
  (6, 'Event Coordinator Lead'),
  (7, 'Safety Officer')
on conflict (role_id) do nothing;
select setval('public.roles_role_id_seq', (select max(role_id) from public.roles));

alter table public.account_roles drop constraint if exists account_roles_role_check;
alter table public.account_roles add constraint account_roles_role_check
  check (role in ('event_organiser', 'event_coordinator', 'venue_staff',
    'technical_support_staff', 'attendee', 'event_coordinator_lead', 'safety_officer'));

-- Mirrors INTERNAL_ROLES in server/src/auth/policy.ts; the two must change
-- together. Recreated identically to 202609240000 except for the role list.
drop policy if exists event_audit_logs_read on public.event_audit_logs;
create policy event_audit_logs_read on public.event_audit_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.account_roles ar
      where ar.user_id = (select auth.uid())
        and ar.role in ('event_coordinator', 'venue_staff', 'technical_support_staff',
          'event_coordinator_lead', 'safety_officer')
    )
    or exists (
      select 1 from public.events e
      where e.event_id = event_audit_logs.event_id
        and e.organiser_id = (select auth.uid())
    )
  );

commit;
