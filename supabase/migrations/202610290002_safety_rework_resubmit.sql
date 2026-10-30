-- SG2-92 AC4: rework leaves an explicit resubmit step.
--
-- rework_safety_rejected_event() (202610190005) only moved a Safety Rejected
-- event back to Planning. Nothing re-entered the safety handoff afterwards:
-- refresh_safety_check_status() runs only when an arrangement or the event's
-- rechecks change, so an event whose arrangements were all still in place
-- stayed in Planning with no way to resubmit it. Rework now also marks the
-- SG2-93 key safety_other_recheck outstanding. That keeps the event out of
-- Awaiting Safety Check while the coordinator fixes the arrangements, and the
-- coordinator resubmits it by settling the key ("Mark other safety changes
-- done", settle_arrangement_recheck()); the existing refresh trigger on
-- events then returns it to Awaiting Safety Check once everything is ready.
--
-- Replaced from its only definition (202610190005), unchanged apart from the
-- SG2-92 resubmit block. It is service-only and takes the verified actor.
begin;

create or replace function public.rework_safety_rejected_event(p_event_id integer, p_actor_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  e public.events;
begin
  select * into e from public.events where event_id = p_event_id for update;
  if not found or p_actor_id is null or e.coordinator_id is distinct from p_actor_id then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if e.status is distinct from 'safety_rejected' then
    return jsonb_build_object('outcome', 'closed', 'status', e.status::text);
  end if;
  -- SG2-92 AC4: the event waits in Planning until the coordinator resubmits
  -- it by settling safety_other_recheck; other outstanding keys are kept.
  update public.events
    set status = 'planning',
      arrangements_recheck_needed = true,
      outstanding_arrangements = case
        when coalesce(outstanding_arrangements, '[]'::jsonb) @> '["safety_other_recheck"]'::jsonb
          then outstanding_arrangements
        else coalesce(outstanding_arrangements, '[]'::jsonb) || '["safety_other_recheck"]'::jsonb
      end
    where event_id = p_event_id;
  insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
    values (p_event_id, p_actor_id, 'status', 'safety_rejected', 'planning');
  return jsonb_build_object('outcome', 'ok', 'status', 'planning');
end;
$$;
revoke all on function public.rework_safety_rejected_event(integer, uuid) from public, anon, authenticated;
grant execute on function public.rework_safety_rejected_event(integer, uuid) to service_role;

commit;
