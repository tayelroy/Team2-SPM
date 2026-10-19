-- SG2-105: an event request records the organiser's preferred room layout,
-- one of the customer's minimum fields (clarification session 2). The column
-- is nullable on purpose: drafts may still be saved incomplete, and requests
-- submitted before this story are left exactly as they were. Completeness is
-- enforced when a request is submitted (server/src/events/fields.ts).
--
-- The draft-save RPC from SG2-40 lists its fields explicitly, so it is
-- replaced with the same body plus `preferred_layout`: saved with the draft
-- and recorded in the change history like every other request field.
begin;

alter table public.events
  add column preferred_layout text,
  add constraint events_preferred_layout_length check (char_length(preferred_layout) <= 5000);

create or replace function public.update_event_request_draft(
  p_event_id integer, p_actor_id uuid, p_values jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
set timezone = 'UTC'
as $function$
declare
  membership text;
  actor_role text;
  previous public.events%rowtype;
  updated public.events%rowtype;
  values_row public.events%rowtype;
  field text;
  previous_values jsonb;
  updated_values jsonb;
  saved_at timestamptz;
  fields constant text[] := array['name', 'purpose', 'description', 'proposed_date',
    'expected_attendance', 'venue_requirements', 'preferred_layout', 'accessibility_needs',
    'equipment_requirements', 'registration_needed'];
begin
  -- Keep membership/role stable until the transaction finishes, then lock the
  -- event. The event lock serializes saves and status changes (including submit).
  select ar.role into actor_role from public.account_roles ar
    where ar.user_id = p_actor_id for share;
  select u.organisation into membership from public.users u
    where u.user_id = p_actor_id for share;
  if actor_role is distinct from 'event_organiser' or membership is null
      or btrim(membership,
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '' then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select e.* into previous from public.events e
    where e.event_id = p_event_id and e.organiser_id = p_actor_id
      and e.organisation = membership for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if previous.status not in ('draft', 'needs_clarification') then
    return jsonb_build_object('outcome', 'not_editable');
  end if;

  -- The API has already normalized and validated a full replacement. Recheck
  -- the private RPC boundary: never accept status/ownership keys or wrong types.
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if exists (select 1 from jsonb_object_keys(p_values) k where not (k = any(fields))) then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  foreach field in array fields loop
    if p_values ? field and jsonb_typeof(p_values -> field) <> 'null' then
      if field = 'expected_attendance' then
        if jsonb_typeof(p_values -> field) <> 'number'
            or (p_values ->> field)::numeric <> trunc((p_values ->> field)::numeric)
            or (p_values ->> field)::numeric not between 1 and 2147483647 then
          return jsonb_build_object('outcome', 'invalid');
        end if;
      elsif field = 'registration_needed' then
        if jsonb_typeof(p_values -> field) <> 'boolean' then
          return jsonb_build_object('outcome', 'invalid');
        end if;
      elsif jsonb_typeof(p_values -> field) <> 'string'
          or (field = 'name' and char_length(p_values ->> field) > 255)
          or (field <> 'name' and char_length(p_values ->> field) > 5000) then
        return jsonb_build_object('outcome', 'invalid');
      end if;
    end if;
  end loop;
  begin
    values_row := jsonb_populate_record(null::public.events, p_values);
    if values_row.proposed_date is not null and not isfinite(values_row.proposed_date) then
      return jsonb_build_object('outcome', 'invalid');
    end if;
  exception when invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('outcome', 'invalid');
  end;

  update public.events set name = values_row.name, purpose = values_row.purpose,
    description = values_row.description, proposed_date = values_row.proposed_date,
    expected_attendance = values_row.expected_attendance,
    venue_requirements = values_row.venue_requirements,
    preferred_layout = values_row.preferred_layout,
    accessibility_needs = values_row.accessibility_needs,
    equipment_requirements = values_row.equipment_requirements,
    registration_needed = values_row.registration_needed
    where event_id = previous.event_id returning * into updated;

  previous_values := to_jsonb(previous);
  updated_values := to_jsonb(updated);
  saved_at := clock_timestamp();
  foreach field in array fields loop
    if previous_values -> field is distinct from updated_values -> field then
      insert into public.event_audit_logs(event_id, actor_id, field_name, old_value, new_value, created_at)
        values (previous.event_id, p_actor_id, field,
          previous_values ->> field, updated_values ->> field, saved_at);
    end if;
  end loop;
  -- Do not catch update/audit errors: Postgres rolls back both on any failure.
  return jsonb_build_object('outcome', 'updated', 'request',
    jsonb_build_object('event_id', updated.event_id, 'organiser_id', updated.organiser_id,
      'organisation', updated.organisation, 'status', updated.status)
    || (select jsonb_object_agg(k, updated_values -> k) from unnest(fields) k));
end;
$function$;

comment on function public.update_event_request_draft(integer, uuid, jsonb) is
  'SG2-40/SG2-105: creator draft/clarification save and per-field history commit atomically; server-verified actor only.';
commit;
