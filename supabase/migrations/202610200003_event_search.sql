-- SG2-70: find an event across the system.
--
-- AC1  search_events() matches the search text against the event name and
--      the client organisation (case-insensitive, LIKE wildcards escaped).
-- AC2  It filters by date (an inclusive range of Singapore calendar days on
--      proposed_date), state, venue (one the event is booked, held or
--      requested at), category and assigned coordinator. Category is new:
--      events.category, from the fixed list below, chosen by the organiser on
--      the request form. It joins the customer minimum (SG2-30 / SG2-105), so
--      this story also changes what a request needs before it is submitted.
-- AC3  Only internal roles may call search_events() or event_search_options():
--      the acting role (SG2-104) is checked here as well as by the route permission
--      ('events.search' in server/src/auth/policy.ts, mirrored from
--      INTERNAL_ROLES). Drafts are never returned: they belong to their
--      organiser until submitted.
-- AC4  The result echoes the filters it applied, so an empty list can be shown
--      with the filters in force.
--
-- Existing events are given a category below so none is left uncategorised.
-- events_category_required_on_submit is the database backstop for "required
-- on submit": a request cannot leave draft, needs-clarification or rejected
-- without a category, whichever writer moves it, and it re-reads the row a
-- racing draft save just wrote. Rows written directly in another status are
-- not checked, so fixtures and earlier migrations are unaffected.
begin;

alter table public.events
  add column category text,
  add constraint events_category_known check (category is null or category in
    ('conference', 'workshop', 'seminar', 'training', 'networking', 'social', 'other'));
comment on column public.events.category is
  'Kind of event (SG2-70 AC2), chosen by the organiser; required before a request is submitted.';

-- Existing events: inferred from the name, otherwise Other. Live demo events
-- are then given hand-picked categories by
-- supabase/backfill_event_categories_live.sql (run by hand, not a migration).
update public.events set category = case
    when name ~* '(forum|summit|conference|symposium|convention|expo)' then 'conference'
    when name ~* '(gala|party|dinner|reception|celebration|festival)' then 'social'
    when name ~* '(workshop|hackathon|masterclass)' then 'workshop'
    when name ~* '(seminar|lecture|talk|webinar|briefing)' then 'seminar'
    when name ~* '(training|course|bootcamp|onboarding)' then 'training'
    when name ~* '(networking|mixer|meetup|meet-up)' then 'networking'
    else 'other'
  end
  where category is null;

create function public.events_require_category_on_submit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('draft', 'needs_clarification', 'rejected')
      and new.status in ('unassigned', 'submitted')
      and new.category is null then
    raise exception using errcode = '23514',
      message = 'An event request needs a category before it is submitted',
      constraint = 'events_category_required_on_submit';
  end if;
  return new;
end;
$$;
revoke all on function public.events_require_category_on_submit() from public, anon, authenticated;
create trigger events_category_required_on_submit before update of status on public.events
  for each row execute function public.events_require_category_on_submit();

-- Copied verbatim from its latest definition, SG2-104's
-- 202610200002_acting_role_functions.sql (which keeps SG2-105's fields and
-- checks the actor holds event_organiser), except for `category`: saved with
-- the draft, checked against the list, and recorded in the change history
-- like every other request field.
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
    'equipment_requirements', 'registration_needed', 'category'];
begin
  -- Keep membership/role stable until the transaction finishes, then lock the
  -- event. The event lock serializes saves and status changes (including submit).
  -- SG2-104: the actor may hold several roles; one of them must be
  -- event_organiser (the server has already checked it is the acting role).
  perform 1 from public.account_roles ar
    where ar.user_id = p_actor_id and ar.role = 'event_organiser' for share;
  actor_role := case when found then 'event_organiser' end;
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
      elsif field = 'category' then
        -- SG2-70: one of events_category_known's values, refused here rather
        -- than surfacing as a constraint error.
        if jsonb_typeof(p_values -> field) <> 'string' or (p_values ->> field) not in
            ('conference', 'workshop', 'seminar', 'training', 'networking', 'social', 'other') then
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
    registration_needed = values_row.registration_needed,
    category = values_row.category
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
  'SG2-40/SG2-105/SG2-70: creator draft/clarification save and per-field history commit atomically; server-verified actor only.';

-- AC3: the role the caller is acting as (SG2-104's acting_role(), checked
-- against their own account_roles rows) must be internal. An account that
-- also holds an organiser role cannot search while acting as the organiser.
-- Mirrored from INTERNAL_ROLES in server/src/auth/policy.ts; the two must
-- change together.
create function public.event_search_caller_is_internal()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.acting_role() in ('event_coordinator', 'venue_staff', 'technical_support_staff',
    'event_coordinator_lead', 'safety_officer'), false);
$$;
revoke all on function public.event_search_caller_is_internal() from public, anon, authenticated;

-- Venues an event is booked, held or requested at: what someone who
-- remembers "the one in Atrium Hall" means. Released bookings and withdrawn
-- or rejected requests no longer count.
create function public.event_search_venue_ids(p_event_id integer)
returns setof integer language sql stable security definer set search_path = '' as $$
  select b.venue_id from public.venue_bookings b
    where b.event_id = p_event_id and b.status in ('held', 'confirmed')
  union
  select r.venue_id from public.venue_booking_requests r
    where r.event_id = p_event_id and r.status in ('pending', 'approved');
$$;
revoke all on function public.event_search_venue_ids(integer) from public, anon, authenticated;

-- AC1-AC4. Every filter is optional; a null leaves that filter out. At most
-- 100 events are returned, soonest first, and `truncated` says whether more
-- matched, so the screen can ask for a narrower search. The coordinator is
-- compared as text, so an id that is no coordinator's simply matches nothing.
create function public.search_events(
  p_query text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_status text default null,
  p_venue_id integer default null,
  p_category text default null,
  p_coordinator_id text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  pattern text;
  matches jsonb;
  page_size constant integer := 100;
begin
  if auth.uid() is null or not public.event_search_caller_is_internal() then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'The start date must not be after the end date';
  end if;

  if nullif(btrim(p_query), '') is not null then
    pattern := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(jsonb_agg(item order by sort_date nulls last, id), '[]'::jsonb) into matches
  from (
    select e.proposed_date as sort_date, e.event_id as id, jsonb_build_object(
      'event_id', e.event_id,
      'name', e.name,
      'organisation', e.organisation,
      'category', e.category,
      'status', e.status,
      'proposed_date', e.proposed_date,
      'coordinator_id', e.coordinator_id,
      'coordinator_name', coordinator.name,
      'venues', coalesce((
        select jsonb_agg(v.name order by v.name, v.venue_id)
        from public.venues v
        where v.venue_id in (select public.event_search_venue_ids(e.event_id))), '[]'::jsonb)
    ) as item
    from public.events e
    left join public.users coordinator on coordinator.user_id = e.coordinator_id
    where e.status <> 'draft'
      and (pattern is null or e.name ilike pattern or e.organisation ilike pattern)
      and (p_date_from is null or (e.proposed_date at time zone 'Asia/Singapore')::date >= p_date_from)
      and (p_date_to is null or (e.proposed_date at time zone 'Asia/Singapore')::date <= p_date_to)
      and (p_status is null or e.status::text = p_status)
      and (p_venue_id is null or p_venue_id in (select public.event_search_venue_ids(e.event_id)))
      and (p_category is null or e.category = p_category)
      and (p_coordinator_id is null or e.coordinator_id::text = p_coordinator_id)
    order by e.proposed_date nulls last, e.event_id
    limit page_size + 1
  ) matched;

  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(matches)
      with ordinality where ordinality <= page_size), '[]'::jsonb),
    'truncated', jsonb_array_length(matches) > page_size,
    'filters', jsonb_build_object('query', nullif(btrim(p_query), ''), 'date_from', p_date_from,
      'date_to', p_date_to, 'status', p_status, 'venue_id', p_venue_id, 'category', p_category,
      'coordinator_id', p_coordinator_id));
end;
$$;
revoke all on function public.search_events(text, date, date, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.search_events(text, date, date, text, integer, text, text) to authenticated;

-- AC2: what the venue and coordinator filters can be set to. Deleted venues
-- are left out; every account currently holding the coordinator role is in.
create function public.event_search_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.event_search_caller_is_internal() then
    raise exception using errcode = '42501', message = 'Access denied';
  end if;
  return jsonb_build_object(
    'venues', coalesce((select jsonb_agg(jsonb_build_object('venue_id', v.venue_id, 'name', v.name)
      order by v.name, v.venue_id) from public.venues v where v.deleted_at is null), '[]'::jsonb),
    'coordinators', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'name', u.name)
      order by u.name, u.user_id) from public.users u
      join public.account_roles ar on ar.user_id = u.user_id
      where ar.role = 'event_coordinator'), '[]'::jsonb));
end;
$$;
revoke all on function public.event_search_options() from public, anon, authenticated;
grant execute on function public.event_search_options() to authenticated;

commit;
