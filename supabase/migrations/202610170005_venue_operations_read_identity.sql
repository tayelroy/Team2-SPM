-- Safety Officers can read venue operations without catalogue access.
-- Reveal only venue existence to the exact operations-reader roles; keep
-- operations rows protected by caller RLS and Staff writes/history unchanged.
begin;

create or replace function public.venue_exists_for_operations_read(p_venue_id integer)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.account_roles ar
    where ar.user_id = (select auth.uid())
      and ar.role in ('venue_staff', 'event_coordinator', 'technical_support_staff', 'safety_officer')
  ) then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  return exists (select 1 from public.venues v where v.venue_id = p_venue_id);
end;
$$;

revoke all on function public.venue_exists_for_operations_read(integer) from public, anon, authenticated, service_role;
grant execute on function public.venue_exists_for_operations_read(integer) to authenticated;

commit;
