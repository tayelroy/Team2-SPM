-- SG2-77 AC5 (Week 7 customer change #6): the Safety Officer reviews a
-- venue's emergency access and known restrictions in the Operational Safety
-- Check, so reads venue_operations alongside the roles SG2-77 already let
-- read it. Changing the values, and reading who changed them
-- (venue_operation_history), stay with Venue Staff. The Event Coordinator
-- Lead is still not allowed (SG2-86 AC2).
--
-- Mirrors 'venues.operations.read' in server/src/auth/policy.ts; the two must
-- change together. Safe to re-run: the policy is dropped and recreated.
begin;

drop policy if exists venue_operations_read on public.venue_operations;
create policy venue_operations_read on public.venue_operations
  for select to authenticated
  using (exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role in ('venue_staff', 'event_coordinator', 'technical_support_staff', 'safety_officer')
  ));

commit;
