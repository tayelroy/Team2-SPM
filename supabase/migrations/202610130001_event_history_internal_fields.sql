-- SG2-40: planning notes are the coordinators' internal log, but every
-- planning-notes edit is written to the event history and the organiser
-- branch of the read policy returned it to the event's organiser. Internal
-- staff keep reading every entry; an organiser now reads every entry of their
-- own event except the internal-only fields.
--
-- The internal role list mirrors INTERNAL_ROLES and the excluded field list
-- mirrors INTERNAL_ONLY_AUDIT_FIELDS, both in server/src/auth/policy.ts; they
-- must change together. Recreated identically to 202610050004_week7_roles.sql
-- except for the organiser branch's field condition.
begin;

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
    or (
      event_audit_logs.field_name <> all (array['planning_notes'])
      and exists (
        select 1 from public.events e
        where e.event_id = event_audit_logs.event_id
          and e.organiser_id = (select auth.uid())
      )
    )
  );

commit;
