-- SG2-56: release an event's equipment when the event is cancelled.
-- AC1: whatever cancels the event (SG2-67's cancel_event(), not built yet)
-- only has to set events.status = 'cancelled'; this trigger releases every
-- reservation still held for it in the same transaction.
-- AC2: needs no new stock rule. check_equipment_availability() and
-- manage_equipment_reservations() already skip reservations of cancelled
-- events, and count only operational stock (damaged and maintenance count
-- as 0), less anything still committed to other events in the period.
-- AC3: each released reservation keeps who, when and why, and the event's
-- history (SG2-40) gets one entry per reservation.
begin;

alter table public.equipment_reservations
  add column released_at timestamptz,
  add column released_by uuid references public.users(user_id) on delete set null,
  add column release_reason text,
  add constraint equipment_reservations_release_recorded
    check ((released_at is null) = (release_reason is null)),
  add constraint equipment_reservations_release_reason
    check (release_reason is null or (btrim(release_reason) <> '' and char_length(release_reason) <= 500));

create function public.release_cancelled_event_equipment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  released record;
begin
  for released in
    update public.equipment_reservations r
      set released_at = clock_timestamp(), released_by = auth.uid(), release_reason = 'Event cancelled'
      from public.equipment q
      where r.event_id = new.event_id and r.released_at is null and q.equipment_id = r.equipment_id
      returning r.reservation_id, r.quantity_reserved, q.name
  loop
    insert into public.event_audit_logs (event_id, actor_id, field_name, old_value, new_value)
      values (new.event_id, auth.uid(), 'equipment_reservation',
        'Reserved: ' || released.quantity_reserved || ' × ' || released.name
          || ' (reservation ' || released.reservation_id || ')',
        'Released: ' || released.quantity_reserved || ' × ' || released.name
          || ' (reservation ' || released.reservation_id || ') — Event cancelled');
  end loop;
  return null;
end;
$$;
revoke all on function public.release_cancelled_event_equipment() from public, anon, authenticated;

create trigger release_cancelled_event_equipment after update of status on public.events
  for each row when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.release_cancelled_event_equipment();

commit;
