-- Hosted release gate (SG2-23 / SG2-25 / SG2-96). READ ONLY: no DDL, writes,
-- credentials, personal/event records, RPC execution or schema-cache reload.
-- Run as the database operator against the application's actual Supabase project.
-- A passing result verifies this structural contract, not complete workflow/RLS
-- correctness. See docs/release-readiness.md for the required browser follow-up.
do $readiness$
declare
  failures text[];
  reminder_job_ready boolean;
begin
  with required_columns(relation, columns) as (values
    ('events', 'event_id,organiser_id,coordinator_id,organisation,status,name,purpose,description,proposed_date,expected_attendance,venue_requirements,accessibility_needs,equipment_requirements,registration_needed,preferred_layout,category,registration_capacity,registration_opens_at,registration_closes_at,registration_announced,planning_notes,arrangements_recheck_needed,outstanding_arrangements,decided_at,decision_reason,completed_by,completed_at,submitted_at,confirmed_by,confirmed_at'),
    ('users', 'user_id,name,organisation,phone,department,communication_preferences'),
    ('roles', 'role_id,role_name'),
    ('account_roles', 'user_id,role'),
    ('registrations', 'registration_id,event_id,attendee_id,status,registered_at,contact_phone,needs,withdrawn_at'),
    ('event_audit_logs', 'log_id,event_id,actor_id,field_name,old_value,new_value,created_at'),
    ('notifications', 'notification_id,recipient_id,event_id,request_id,kind,message,created_at,read_at'),
    ('venue_hold_notifications', 'notification_id,recipient_id,event_id,kind,message,created_at,read_at'),
    ('notification_reminder_settings', 'user_id,frequency_days'),
    ('notification_reminder_receipts', 'event_id,recipient_id,last_sent_at'),
    ('venue_bookings', 'booking_id,venue_id,event_id,starts_at,ends_at,status'),
    ('venues', 'venue_id,name,deleted_at,deleted_by'),
    ('venue_booking_requests', 'request_id,event_id,venue_id,status,venue_booking_id,replaces_booking_id'),
    ('internal_work_items', 'kind,item_id,event_id,title,event_name,status,starts_at,ends_at,audience,assigned_to,category,details'),
    -- SG2-65: who decided a change request, when and why.
    ('event_change_requests', 'change_request_id,event_id,requested_by,field,from_value,to_value,reason,status,created_at,decided_by,decided_at,decision_reason')
  ), column_checks as (
    select 'column public.' || r.relation || '.' || col.name as name,
      exists (select 1 from pg_attribute a
        where a.attrelid = to_regclass('public.' || r.relation)
          and a.attname = col.name and a.attnum > 0 and not a.attisdropped) as passed
    from required_columns r cross join lateral unnest(string_to_array(r.columns, ',')) col(name)
  ), required_types(column_name, type_name) as (values
    ('completed_by', 'uuid'), ('completed_at', 'timestamptz'),
    ('confirmed_by', 'uuid'), ('confirmed_at', 'timestamptz'),
    ('submitted_at', 'timestamptz'), ('registration_capacity', 'integer'),
    ('registration_opens_at', 'timestamptz'), ('registration_closes_at', 'timestamptz'),
    ('planning_notes', 'text'), ('arrangements_recheck_needed', 'boolean'),
    ('outstanding_arrangements', 'jsonb')
  ), type_checks as (
    select 'type public.events.' || r.column_name || ' = ' || r.type_name as name,
      exists (select 1 from pg_attribute a
        where a.attrelid = to_regclass('public.events') and a.attname = r.column_name
          and not a.attisdropped and a.atttypid = to_regtype(r.type_name)) as passed
    from required_types r
  ), required_relations(name) as (values
    ('venues'), ('venue_layouts'), ('venue_unavailability'), ('venue_operations'),
    ('venue_operation_history'), ('venue_booking_requests'), ('venue_capacity_exceptions'),
    ('venue_holds'), ('venue_hold_settings'), ('venue_hold_notifications'),
    ('venue_booking_disruptions'), ('venue_booking_clashes'), ('venue_booking_occupancy'),
    ('equipment'), ('equipment_requests'), ('equipment_reservations'),
    ('event_clarifications'), ('notifications'), ('notification_reminder_settings'), ('notification_reminder_receipts'),
    -- SG2-93: arrangements a Request Changes decision sent back to staff.
    ('safety_rereviews'),
    -- SG2-64: change requests raised after submission.
    ('event_change_requests')
  ), relation_checks as (
    select 'relation public.' || name as name, to_regclass('public.' || name) is not null as passed
    from required_relations
  ), required_statuses(name) as (values
    ('draft'), ('submitted'), ('under_review'), ('approved'), ('planning'),
    ('confirmed'), ('completed'), ('cancelled'), ('rejected'), ('needs_clarification'),
    ('unassigned'), ('awaiting_safety_check'), ('safety_rejected'), ('preparation')
  ), status_checks as (
    select 'event_status.' || name as name,
      exists (select 1 from pg_enum e where e.enumtypid = to_regtype('public.event_status')
        and e.enumlabel = r.name) as passed
    from required_statuses r
  ), required_functions(signature) as (values
    -- SG2-69 must deploy after SG2-104's validated acting-role dependencies.
    ('public.acting_role()'), ('public.lock_acting_role()'),
    ('private.event_relationship_exists(integer,text)'),
    ('public.venue_exists_for_operations_read(integer)'),
    ('public.update_event_request_draft(integer,uuid,jsonb)'),
    ('public.confirm_event(integer)'),
    ('public.decide_venue_booking_request(bigint,text,text)'),
    ('public.manage_equipment_requirements(text,integer,bigint,bigint,jsonb)'),
    ('public.manage_equipment_reservations(text,integer,bigint,bigint,timestamptz,timestamptz)'),
    ('public.check_equipment_availability(integer,bigint,timestamptz,timestamptz)'),
    ('public.create_venue_hold(integer,integer,timestamptz,timestamptz,timestamptz)'),
    ('public.change_venue_hold(bigint,text)'), ('public.list_venue_holds()'),
    ('public.venue_hold_options()'), ('public.list_venue_hold_notifications()'),
    ('public.withdraw_venue_booking_request(bigint)'),
    ('public.release_venue_booking(bigint,text)'),
    ('public.list_venue_unavailability(integer,timestamptz)'),
    ('public.release_replaced_booking(bigint,text)'), ('public.venue_disruption_notify()'),
    -- SG2-106: venue delete and hold expiry change.
    ('public.delete_venue(integer)'), ('public.change_venue_hold_expiry(bigint,timestamptz)'),
    ('public.notification_inbox(integer,timestamptz,text,bigint)'), ('public.read_notification(text,bigint)'),
    ('public.read_all_notifications()'), ('public.notification_event(text,bigint)'),
    ('public.notification_reminder_preferences()'), ('public.set_notification_reminder_preferences(integer)'),
    ('private.notification_reminder_due(timestamptz,timestamptz,integer)'),
    ('public.send_outstanding_arrangement_reminders()'),
    ('public.update_registration_settings(integer,uuid,jsonb,boolean)'),
    ('public.event_registration_overview(integer)'), ('public.process_registration_windows()'),
    -- SG2-83: change or cancel one venue of a multi-venue event.
    ('public.release_venue_bookings(bigint,bigint[],text)'), ('public.venue_change_requested()'),
    ('public.venue_change_request_check()'),
    -- SG2-94: the safety approval that gates Preparation and confirmation.
    ('public.event_safety_approved(public.events)'), ('public.safety_approval_gate()'),
    -- SG2-59: attendees find events they can register for.
    ('public.registrable_events()'), ('public.registrable_event(integer)'),
    ('private.registrable_events_json(integer)'),
    -- SG2-60: attendees register for an event.
    ('public.register_for_event(integer,text,text)'),
    -- SG2-62: attendees see and withdraw their registrations.
    ('public.my_registrations()'), ('public.withdraw_registration(integer)'),
    -- SG2-93: Request Changes sends the named arrangements back to staff.
    ('public.confirm_safety_rereview(bigint,uuid,text)'), ('public.safety_rereview_queue(text)'),
    ('public.event_safety_rereviews(integer)'), ('public.safety_rereview_close_from_request()'),
    -- SG2-64: the organiser raises a change request after submitting.
    ('public.raise_event_change_request(integer,uuid,text,jsonb,text)'),
    -- SG2-65: the coordinator accepts or refuses a change request.
    ('public.decide_event_change_request(integer,bigint,uuid,text,text,text)')
  ), function_checks as (
    select 'RPC ' || signature as name, to_regprocedure(signature) is not null as passed
    from required_functions
  ), draft_rpc_grants as (
    select 'draft audit RPC EXECUTE ' || r.name || ' = ' || r.expected::text as name,
      coalesce(has_function_privilege((select oid from pg_roles where rolname = r.name),
        to_regprocedure('public.update_event_request_draft(integer,uuid,jsonb)'), 'EXECUTE') = r.expected, false) as passed
    from (values ('service_role', true), ('anon', false), ('authenticated', false)) r(name, expected)
  ), operations_rpc_grants as (
    select 'operations identity RPC EXECUTE ' || r.name || ' = ' || r.expected::text as name,
      coalesce(has_function_privilege((select oid from pg_roles where rolname = r.name),
        to_regprocedure('public.venue_exists_for_operations_read(integer)'), 'EXECUTE') = r.expected, false) as passed
    from (values ('authenticated', true), ('anon', false), ('service_role', false)) r(name, expected)
  ), inbox_rpc_contracts(signature, authenticated_execute, service_execute) as (values
    ('public.notification_inbox(integer,timestamptz,text,bigint)',true,false),
    ('public.read_notification(text,bigint)',true,false), ('public.read_all_notifications()',true,false),
    ('public.notification_event(text,bigint)',true,false), ('public.notification_reminder_preferences()',true,false),
    ('public.set_notification_reminder_preferences(integer)',true,false),
    ('public.send_outstanding_arrangement_reminders()',false,true),
    ('public.notification_inbox_caller()',false,false), ('public.notification_unread_count(uuid)',false,false),
    ('public.notification_outstanding_arrangements(public.events)',false,false)
  ), inbox_rpc_grants as (
    select 'notification RPC EXECUTE ' || f.signature || ' ' || role.name as name,
      coalesce(has_function_privilege((select oid from pg_roles where rolname=role.name),to_regprocedure(f.signature),'EXECUTE')=
        case role.name when 'authenticated' then f.authenticated_execute when 'service_role' then f.service_execute else false end,false) as passed
    from inbox_rpc_contracts f cross join (values('anon'),('authenticated'),('service_role')) role(name)
  ), reminder_cadence_helper as (
    select 'notification cadence helper private immutable invoker empty search_path' as name,
      coalesce(p.provolatile='i' and not p.prosecdef and p.proconfig @> array['search_path=""']::text[],false) as passed
    from (values(1)) singleton(n) left join pg_proc p
      on p.oid=to_regprocedure('private.notification_reminder_due(timestamptz,timestamptz,integer)')
  ), reminder_cadence_grants as (
    select 'notification cadence helper EXECUTE '||role.name||' = false' as name,
      coalesce(not has_function_privilege((select oid from pg_roles where rolname=role.name),
        to_regprocedure('private.notification_reminder_due(timestamptz,timestamptz,integer)'),'EXECUTE'),false) as passed
    from (values('anon'),('authenticated'),('service_role')) role(name)
  ), inbox_function_security as (
    select 'notification RPC security definer empty search_path ' || signature as name,
      coalesce(p.prosecdef and p.proconfig @> array['search_path=""']::text[],false) as passed
    from inbox_rpc_contracts f left join pg_proc p on p.oid=to_regprocedure(f.signature)
  ), inbox_column_types(relation,column_name,type_name) as (values
    ('notifications','read_at','timestamptz'), ('venue_hold_notifications','read_at','timestamptz'),
    ('notification_reminder_settings','frequency_days','integer'), ('notification_reminder_receipts','last_sent_at','timestamptz')
  ), inbox_type_checks as (
    select 'notification type public.' || r.relation || '.' || r.column_name as name,
      exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||r.relation)
        and a.attname=r.column_name and not a.attisdropped and a.atttypid=to_regtype(r.type_name)) as passed
    from inbox_column_types r
  ), inbox_private_relations(relation) as (values('notification_reminder_settings'),('notification_reminder_receipts')),
  inbox_table_checks as (
    select 'notification private RLS and grants public.' || relation as name,
      coalesce(c.relrowsecurity and c.relforcerowsecurity
        and not has_table_privilege((select oid from pg_roles where rolname='anon'),c.oid,'SELECT,INSERT,UPDATE,DELETE')
        and not has_table_privilege((select oid from pg_roles where rolname='authenticated'),c.oid,'SELECT,INSERT,UPDATE,DELETE'),false) as passed
    from inbox_private_relations r left join pg_class c on c.oid=to_regclass('public.'||r.relation)
  ), confirmation_definition as (
    select pg_get_functiondef(to_regprocedure('public.confirm_event(integer)')) as definition
  ), required_rechecks(name) as (values
    ('venue_recheck'), ('equipment_recheck'), ('registration_recheck')
  ), recheck_function_checks as (
    -- Structural deployment fingerprint only; rollback SQL tests prove behavior.
    select 'confirm_event planning recheck ' || name as name,
      coalesce(position('arrangements_recheck_needed' in definition) > 0
        and position('outstanding_arrangements' in definition) > 0
        and position('["' || name || '"]' in definition) > 0, false) as passed
    from required_rechecks cross join confirmation_definition
  ), disruption_function_check as (
    select 'confirm_event venue disruption guard' as name,
      coalesce(position('public.venue_booking_disruptions' in definition) > 0, false) as passed
    from confirmation_definition
  ), safety_approval_checks as (
    -- SG2-94: structural fingerprint only; safety_approval_gate.sql proves behavior.
    select 'confirm_event safety approval' as name,
      coalesce(position('public.event_safety_approved' in definition) > 0, false) as passed
    from confirmation_definition
    union all
    select 'events safety_approval_gate trigger' as name,
      exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.events')
        and t.tgname = 'safety_approval_gate' and not t.tgisinternal and t.tgenabled <> 'D'
        and t.tgfoid = to_regprocedure('public.safety_approval_gate()')) as passed
  ), required_foreign_keys(relation, column_name, target, target_column) as (values
    ('events', 'organiser_id', 'users', 'user_id'),
    ('events', 'coordinator_id', 'users', 'user_id'),
    ('events', 'confirmed_by', 'users', 'user_id'),
    ('venue_bookings', 'event_id', 'events', 'event_id'),
    ('venue_booking_requests', 'replaces_booking_id', 'venue_bookings', 'booking_id'),
    ('event_audit_logs', 'actor_id', 'users', 'user_id')
  ), foreign_key_checks as (
    select 'embed FK public.' || r.relation || '.' || r.column_name as name,
      exists (select 1 from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attname = r.column_name
        join pg_attribute b on b.attrelid = c.confrelid and b.attname = r.target_column
        where c.contype = 'f' and c.conrelid = to_regclass('public.' || r.relation)
          and c.confrelid = to_regclass('public.' || r.target)
          and c.conkey = array[a.attnum] and c.confkey = array[b.attnum]) as passed
    from required_foreign_keys r
  ), required_admin_reads(relation) as (values
    ('events'), ('users'), ('account_roles'), ('event_audit_logs'), ('internal_work_items')
  ), grant_checks as (
    select 'service_role SELECT public.' || relation as name,
      coalesce(has_table_privilege((select oid from pg_roles where rolname = 'service_role'),
        to_regclass('public.' || relation), 'SELECT'), false) as passed
    from required_admin_reads
  ), confirmation_pair_check as (
    select 'confirmation record pair constraint' as name,
      exists (select 1 from pg_constraint c
        where c.conrelid = to_regclass('public.events') and c.contype = 'c' and c.convalidated
          and regexp_replace(lower(pg_get_expr(c.conbin, c.conrelid)), '[[:space:]()]', '', 'g')
            in ('confirmed_byisnull=confirmed_atisnull', 'confirmed_atisnull=confirmed_byisnull')) as passed
  ), required_planning_keys(name) as (values
    ('registration_capacity'), ('registration_opens_at'), ('registration_closes_at'), ('planning_notes')
  ), view_checks as (
    select 'internal_work_items planning key ' || name as name,
      coalesce(position(quote_literal(name) in pg_get_viewdef(to_regclass('public.internal_work_items'))) > 0, false) as passed
    from required_planning_keys
  ), required_notification_kinds(name) as (values
    ('venue_request_approved'), ('venue_request_rejected'), ('venue_booking_released'),
    ('equipment_reserved'), ('venue_booking_clash'), ('event_confirmed'),
    ('event_submitted'), ('coordinator_assigned'), ('clarification_requested'),
    ('event_approved'), ('event_rejected'), ('venue_unavailable'), ('event_returned_to_planning'),
    ('safety_decision'), ('outstanding_arrangements'),
    ('registration_opened'), ('registration_closed'),
    -- SG2-60: the attendee's registration confirmation.
    ('registration_confirmed'),
    -- SG2-62: the organiser and coordinator hear of a withdrawal.
    ('registration_withdrawn'),
    -- SG2-64/SG2-65: a change is requested, accepted or refused.
    ('change_requested'), ('change_accepted'), ('change_refused')
  ), notification_constraint as (
    select c.convalidated, pg_get_expr(c.conbin, c.conrelid) as expression,
      array(select literal[1] from regexp_matches(pg_get_expr(c.conbin, c.conrelid),
        '''([^'']+)''::text', 'g') literal) as allowed_kinds
    from pg_constraint c
    where c.conrelid = to_regclass('public.notifications')
      and c.conname = 'notifications_kind_check' and c.contype = 'c'
  ), notification_checks as (
    select 'notifications_kind_check allows ' || r.name as name,
      exists (select 1 from notification_constraint c
        where c.convalidated and r.name = any(c.allowed_kinds)
          -- Verify the literal allow-list shape as well as each value. Merely
          -- finding a quoted kind in an unrelated/reversed predicate is unsafe.
          and c.expression = '(kind = ANY (ARRAY[' ||
            (select string_agg(quote_literal(kind) || '::text', ', ')
              from unnest(c.allowed_kinds) kind) || ']))') as passed
    from required_notification_kinds r
  ), index_checks as (
    -- SG2-96: per-event lookups on the arrangement tables (202610260002).
    select 'index public.' || expected.name as name, to_regclass('public.' || expected.name) is not null as passed
    from (values ('venue_bookings_event_idx'), ('venue_booking_requests_event_idx'),
      ('equipment_requests_event_idx'), ('equipment_reservations_event_idx')) expected(name)
  ), checks as (
    select * from column_checks union all select * from type_checks
    union all select * from relation_checks union all select * from status_checks
    union all select * from function_checks union all select * from foreign_key_checks
    union all select * from draft_rpc_grants
    union all select * from operations_rpc_grants
    union all select * from inbox_rpc_grants union all select * from inbox_function_security
    union all select * from reminder_cadence_helper union all select * from reminder_cadence_grants
    union all select * from inbox_type_checks union all select * from inbox_table_checks
    union all select * from recheck_function_checks
    union all select * from disruption_function_check
    union all select * from safety_approval_checks
    union all select * from grant_checks union all select * from view_checks
    union all select * from confirmation_pair_check
    union all select * from notification_checks
    union all select * from index_checks
  )
  select array_agg(name order by name) into failures from checks where not passed;

  if failures is not null then
    raise exception 'Release schema readiness failed: %', array_to_string(failures, '; ');
  end if;

  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    if to_regclass('cron.job') is null then
      raise exception 'Release schema readiness failed: SG2-69 hourly reminder cron job missing';
    end if;
    execute $cron$ select exists(select 1 from cron.job where jobname='sg2-69-arrangement-reminders'
      and schedule='0 * * * *' and active and command='select public.send_outstanding_arrangement_reminders();') $cron$
      into reminder_job_ready;
    if not coalesce(reminder_job_ready,false) then
      raise exception 'Release schema readiness failed: SG2-69 hourly reminder cron job missing or inactive';
    end if;
  end if;

  -- Only the fixed, non-personal catalogue is read; never inspect demo identities.
  select array_agg(expected.name order by expected.name) into failures
  from (values ('Event Organiser'), ('Event Coordinator'), ('Venue Staff'),
    ('Technical Support Staff'), ('Attendee'), ('Event Coordinator Lead'), ('Safety Officer')) expected(name)
  where not exists (select 1 from public.roles r where r.role_name = expected.name);
  if failures is not null then
    raise exception 'Release role catalogue readiness failed: %', array_to_string(failures, '; ');
  end if;
end
$readiness$;

select 'ready' as release_schema_status,
  'Structural checks passed; authenticated UI smoke tests and schema-cache verification still required.' as scope;
