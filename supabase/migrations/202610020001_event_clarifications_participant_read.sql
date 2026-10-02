-- SG2-36: narrow direct reads of the clarification exchange to its two parties.
--
-- 202609300001 let any internal staff member read every thread, mirroring the
-- SG2-40 audit log. The API is stricter: only the assigned coordinator and the
-- owning organiser may read or post, and everyone else receives 404. A user
-- holding a Supabase token could read the table directly, so the policy must
-- match the API rather than the audit log.
--
-- Coordinators cannot read public.events under its own RLS (SG2-26 limits it
-- to organisers in the same organisation), so participation is checked by a
-- security definer function. It answers only whether the caller takes part in
-- the given event and exposes no event data.
begin;

create function public.is_clarification_participant(target_event_id integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    join public.account_roles ar on ar.user_id = (select auth.uid())
    where e.event_id = target_event_id
      and (
        (ar.role = 'event_coordinator' and e.coordinator_id = ar.user_id)
        or (ar.role = 'event_organiser' and e.organiser_id = ar.user_id)
      )
  );
$$;

revoke all on function public.is_clarification_participant(integer) from public, anon;
grant execute on function public.is_clarification_participant(integer) to authenticated, service_role;

drop policy event_clarifications_read on public.event_clarifications;

create policy event_clarifications_read on public.event_clarifications
  for select to authenticated
  using (public.is_clarification_participant(event_clarifications.event_id));

commit;
