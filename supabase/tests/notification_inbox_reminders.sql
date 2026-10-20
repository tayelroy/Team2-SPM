-- SG2-69 public RPC behavior against native PostgreSQL; no hosted mutations.
begin;
select set_config('request.headers','{}',true);
insert into auth.users(id) select ('e6900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,9)n;
insert into public.users(user_id,name,role_id,organisation) select ('e6900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Inbox fixture '||n,
  case n when 1 then 2 when 2 then 2 when 3 then 1 when 4 then 3 when 5 then 4 when 6 then 5 when 7 then 6 when 8 then 7 else 5 end,'SG69 Org' from generate_series(1,9)n;
insert into public.account_roles(user_id,role) values
 ('e6900000-0000-4000-8000-000000000001','event_coordinator'),
 ('e6900000-0000-4000-8000-000000000002','event_coordinator'),
 ('e6900000-0000-4000-8000-000000000003','event_organiser'),
 ('e6900000-0000-4000-8000-000000000004','venue_staff'),
 ('e6900000-0000-4000-8000-000000000005','technical_support_staff'),
 ('e6900000-0000-4000-8000-000000000006','attendee'),
 ('e6900000-0000-4000-8000-000000000007','event_coordinator_lead'),
 ('e6900000-0000-4000-8000-000000000008','safety_officer');
insert into public.venues(venue_id,name,capacity) values(96901,'Inbox hall',100);
insert into public.equipment(equipment_id,name,quantity_total) values(96901,'Inbox screen',10);
insert into public.events(event_id,organiser_id,coordinator_id,organisation,name,status,proposed_date,registration_needed)
 values(96901,'e6900000-0000-4000-8000-000000000003','e6900000-0000-4000-8000-000000000001','SG69 Org','Upcoming forum','planning',clock_timestamp()+interval '100 days',true);
insert into public.venue_booking_requests(request_id,event_id,venue_id,starts_at,ends_at,status)
 values(96901,96901,96901,clock_timestamp()+interval '100 days',clock_timestamp()+interval '100 days 4 hours','pending');
insert into public.venue_holds(hold_id,event_id,venue_id,request_id,starts_at,ends_at,expires_at,created_by)
 values(96901,96901,96901,96901,clock_timestamp()+interval '100 days',clock_timestamp()+interval '100 days 4 hours',clock_timestamp()+interval '90 days','e6900000-0000-4000-8000-000000000001');
insert into public.notifications(notification_id,recipient_id,event_id,kind,message,created_at)
 select 96900+n,'e6900000-0000-4000-8000-000000000001',96901,'event_submitted','Event fixture '||n,'2030-01-01T00:00Z'::timestamptz from generate_series(1,55)n;
insert into public.venue_hold_notifications(notification_id,recipient_id,event_id,hold_id,kind,message,created_at)
 values(96955,'e6900000-0000-4000-8000-000000000001',96901,96901,'placed','Hold fixture','2030-01-01T00:00Z');
insert into public.notifications(notification_id,recipient_id,event_id,kind,message)
 select 97000+n,('e6900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,96901,'event_submitted','Own recipient fixture' from generate_series(2,8)n;
insert into public.notifications(notification_id,recipient_id,event_id,kind,message,created_at)
 values(97009,'e6900000-0000-4000-8000-000000000001',null,'event_submitted','A notice without an event','2031-01-01T00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000001',true);
do $$ declare result jsonb; next_page jsonb; cursor jsonb; begin
 result:=public.notification_inbox();
 if result->>'unread_count' is distinct from '57' or jsonb_array_length(result->'notifications') is distinct from 50 then raise exception '[SG2-69:count-beyond-page] [SG2-69:AC1] [BOUNDARY] Full unread count must include notices beyond page 50: %',result; end if;
 if result->'notifications'->1->>'source' is distinct from 'hold' or result->'notifications'->1->>'notification_id' is distinct from '96955'
   or result->'notifications'->2->>'source' is distinct from 'event' or result->'notifications'->2->>'notification_id' is distinct from '96955' then
   raise exception '[SG2-69:source-id-collision] [SG2-69:AC2] [CONFLICT] Equal timestamps and colliding identities must sort by source and descending id'; end if;
 cursor:=result->'next_cursor';
 next_page:=public.notification_inbox(50,(cursor->>'created_at')::timestamptz,cursor->>'source',(cursor->>'notification_id')::bigint);
 if jsonb_array_length(next_page->'notifications') is distinct from 7 or next_page->'next_cursor' is distinct from 'null'::jsonb
   or next_page->'notifications'->6->>'notification_id' is distinct from '96901' or next_page->>'unread_count' is distinct from '57' then
   raise exception '[SG2-69:cursor-completeness] [SG2-69:AC2] [BOUNDARY] Continuation must include each older identity once with stable global count: %',next_page; end if;
end $$;
do $$ declare result jsonb; first_read text; begin
 result:=public.read_notification('event',96955); first_read:=result->'notification'->>'read_at';
 if first_read is null or result->>'unread_count' is distinct from '56' or result->'notification'->>'message' is distinct from 'Event fixture 55' then
   raise exception '[SG2-69:read-single] [SG2-69:AC3] [NORMAL] Reading must preserve the public notice and decrement only the own unread count: %',result; end if;
 result:=public.read_notification('event',96955);
 if result->'notification'->>'read_at' is distinct from first_read or result->>'unread_count' is distinct from '56' then
   raise exception '[SG2-69:repeat-read-receipt] [SG2-69:AC3] [CONFLICT] Repeated read must keep the original receipt and count'; end if;
 if public.read_notification('event',97002) is not null or public.read_notification('event',999999) is not null then
   raise exception '[SG2-69:other-recipient-read] [SG2-69:AC3] [FAILURE] Other-recipient and absent identities must both remain missing'; end if;
 result:=public.read_notification('hold',96955);
 if result->'notification'->>'source' is distinct from 'hold' or result->>'unread_count' is distinct from '55' then raise exception '[SG2-69:hold-read] [SG2-69:AC3] [NORMAL] Hold and event identities must be independent'; end if;
 result:=public.read_all_notifications();
 if result->>'unread_count' is distinct from '0' or public.read_all_notifications()->>'unread_count' is distinct from '0' then
   raise exception '[SG2-69:read-all-idempotent] [SG2-69:AC4] [NORMAL] Clear all must handle both sources and repeated clicks'; end if;
 result:=public.notification_inbox();
 if result->>'unread_count' is distinct from '0' or jsonb_array_length(result->'notifications') is distinct from 50
   or exists(select 1 from jsonb_array_elements(result->'notifications')n where n->'read_at'='null'::jsonb) then
   raise exception '[SG2-69:read-list-history] [SG2-69:AC2] [NORMAL] Read history must remain listed with receipts and zero unread count'; end if;
 result:=public.notification_event('event',96955);
 if result->>'event_id' is distinct from '96901' or result->>'name' is distinct from 'Upcoming forum' or (select count(*) from jsonb_object_keys(result)) is distinct from 4 then
   raise exception '[SG2-69:open-event-projection] [SG2-69:AC3] [NORMAL] Own notice must open only the four-field event summary: %',result; end if;
 if public.notification_event('event',97002) is not null or public.notification_event('event',97009) is not null then
   raise exception '[SG2-69:missing-target] [SG2-69:AC3] [FAILURE] Other recipients and null event targets must return no event'; end if;
end $$;
do $$ declare bad text; begin
 foreach bad in array array['event','hold'] loop
   begin perform public.read_notification(bad,0); raise exception '[SG2-69:read-zero-id] [SG2-69:AC3] [BOUNDARY] Read ids must be positive'; exception when invalid_parameter_value then null; end;
 end loop;
 begin perform public.read_notification('other',1); raise exception '[SG2-69:read-invalid-source] [SG2-69:AC3] [FAILURE] Only event and hold identities are accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.notification_event('event',9007199254740992); raise exception '[SG2-69:target-unsafe-id] [SG2-69:AC3] [BOUNDARY] Target ids must be safe integers'; exception when invalid_parameter_value then null; end;
 begin perform public.notification_inbox(0); raise exception '[SG2-69:inbox-zero-limit] [SG2-69:AC2] [BOUNDARY] Page limit must be at least one'; exception when invalid_parameter_value then null; end;
 begin perform public.notification_inbox(101); raise exception '[SG2-69:inbox-excess-limit] [SG2-69:AC2] [BOUNDARY] Page limit cannot exceed one hundred'; exception when invalid_parameter_value then null; end;
 begin perform public.notification_inbox(50,clock_timestamp(),null,null); raise exception '[SG2-69:inbox-partial-cursor] [SG2-69:AC2] [FAILURE] Cursor fields must be supplied together'; exception when invalid_parameter_value then null; end;
 begin perform public.notification_inbox(50,'infinity','event',1); raise exception '[SG2-69:inbox-infinite-cursor] [SG2-69:AC2] [BOUNDARY] Cursor timestamp must be finite'; exception when invalid_parameter_value then null; end;
 raise notice '[SG2-69:rpc-invalid-identities] [SG2-69:AC2] [SG2-69:AC3] [BOUNDARY] Invalid sources, ids and cursor bounds are rejected';
end $$;
do $$ begin
 if public.notification_reminder_preferences()->>'frequency_days' is distinct from '1' then raise exception '[SG2-69:default-frequency] [SG2-69:AC6] [NORMAL] Default reminder frequency must be daily'; end if;
 perform public.set_notification_reminder_preferences(30);
 if public.notification_reminder_preferences()->>'frequency_days' is distinct from '30' then
   raise exception '[SG2-69:frequency-bounds-persist] [SG2-69:AC6] [BOUNDARY] Thirty days must persist'; end if;
 perform public.set_notification_reminder_preferences(1);
 if public.notification_reminder_preferences()->>'frequency_days' is distinct from '1' then
   raise exception '[SG2-69:frequency-minimum-persist] [SG2-69:AC6] [BOUNDARY] One day must persist'; end if;
 begin perform public.set_notification_reminder_preferences(0); raise exception '[SG2-69:frequency-below-minimum] [SG2-69:AC6] [BOUNDARY] Frequency must be at least one day'; exception when invalid_parameter_value then null; end;
 begin perform public.set_notification_reminder_preferences(31); raise exception '[SG2-69:frequency-above-maximum] [SG2-69:AC6] [BOUNDARY] Frequency cannot exceed thirty days'; exception when invalid_parameter_value then null; end;
 begin perform public.set_notification_reminder_preferences(null); raise exception '[SG2-69:frequency-null] [SG2-69:AC6] [FAILURE] Frequency is required'; exception when invalid_parameter_value then null; end;
 if public.notification_reminder_preferences()->>'frequency_days' is distinct from '1' then
   raise exception '[SG2-69:invalid-frequency-preserves-preference] [SG2-69:AC6] [FAILURE] Rejected frequency writes must preserve the last valid preference'; end if;
 begin perform public.send_outstanding_arrangement_reminders(); raise exception '[SG2-69:caller-scheduler-denied] [SG2-69:AC7] [FAILURE] Authenticated caller cannot execute global scheduler'; exception when insufficient_privilege then null; end;
 begin perform public.notification_unread_count('e6900000-0000-4000-8000-000000000002'); raise exception '[SG2-69:private-unread-counter-denied] [SG2-69:AC1] [FAILURE] Caller cannot inspect another recipient through the private helper'; exception when insufficient_privilege then null; end;
 begin update public.notifications set read_at=null where notification_id=96901; raise exception '[SG2-69:direct-receipt-write-denied] [SG2-69:AC3] [FAILURE] Caller cannot overwrite receipts through table writes'; exception when insufficient_privilege then null; end;
 begin insert into public.notification_reminder_settings(user_id,frequency_days) values('e6900000-0000-4000-8000-000000000002',2); raise exception '[SG2-69:direct-other-preference-denied] [SG2-69:AC6] [FAILURE] Caller cannot write another recipient preferences'; exception when insufficient_privilege then null; end;
 raise notice '[SG2-69:rpc-only-mutations] [SG2-69:AC4] [SG2-69:AC7] [FAILURE] Ordinary callers cannot run the scheduler, inspect private counts or write table receipts/preferences';
end $$;
reset role;
do $$ begin
 if (select count(*) from public.notifications where notification_id between 97002 and 97008 and read_at is null) is distinct from 7 then
   raise exception '[SG2-69:read-all-recipient-scope] [SG2-69:AC4] [FAILURE] Clearing one inbox must preserve all other recipients'; end if;
end $$;
-- Every stored role can read its own inbox, but only coordinators have preferences.
set local role authenticated;
do $$ declare n integer; result jsonb; begin
 for n in 2..8 loop
   perform set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
   result:=public.notification_inbox();
   if result->>'unread_count' is distinct from '1' or jsonb_array_length(result->'notifications') is distinct from 1 then
     raise exception '[SG2-69:all-role-inboxes] [SG2-69:AC1] [NORMAL] Role % must receive exactly its own inbox: %',n,result; end if;
   if n in (3,4,7) and public.notification_event('event',97000+n)->>'event_id' is distinct from '96901' then
     raise exception '[SG2-69:current-recipient-event-targets] [SG2-69:AC3] [NORMAL] Current organiser and related internal recipients must open only their notice event'; end if;
   if n in (2,5,8) and public.notification_event('event',97000+n) is not null then
     raise exception '[SG2-69:unrelated-internal-event-targets] [SG2-69:AC3] [SG2-104:AC6] [FAILURE] A recipient role without a current event relationship cannot open its summary'; end if;
   if n>2 then
     begin perform public.notification_reminder_preferences(); raise exception '[SG2-69:non-coordinator-preference-read-denied] [SG2-69:AC6] [FAILURE] Only coordinators may read reminder preferences'; exception when insufficient_privilege then null; end;
     begin perform public.set_notification_reminder_preferences(2); raise exception '[SG2-69:non-coordinator-preference-write-denied] [SG2-69:AC6] [FAILURE] Only coordinators may write reminder preferences'; exception when insufficient_privilege then null; end;
   end if;
 end loop;
 raise notice '[SG2-69:coordinator-only-preferences] [SG2-69:AC6] [FAILURE] Other roles cannot read or change reminder frequency';
 perform set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000006',true);
 if public.notification_event('event',97006) is not null then raise exception '[SG2-69:unregistered-attendee-target] [SG2-69:AC3] [FAILURE] An unrelated attendee cannot open event data'; end if;
 perform set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000009',true);
 begin perform public.notification_inbox(); raise exception '[SG2-69:inbox-missing-role-denied] [SG2-69:AC1] [FAILURE] Inbox requires an assigned stored role'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.read_all_notifications(); raise exception '[SG2-69:clear-missing-identity-denied] [SG2-69:AC4] [FAILURE] Clear all requires a current identity'; exception when insufficient_privilege then null; end;
 raise notice '[SG2-69:missing-identity-role] [SG2-69:AC1] [FAILURE] Missing subject or stored role is denied';
end $$;
reset role;
-- Inbox receipts belong to the person across held roles; the selected role
-- still gates event summaries and coordinator-only reminder settings.
insert into public.account_roles(user_id,role) values('e6900000-0000-4000-8000-000000000001','attendee');
set local role authenticated;
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000001',true);
select set_config('request.headers','{"x-acting-role":"attendee"}',true);
do $$ declare result jsonb; begin
 result:=public.notification_inbox();
 if jsonb_array_length(result->'notifications') is distinct from 50 or result->>'unread_count' is distinct from '0' then
   raise exception '[SG2-69:multi-role-inbox-ownership] [SG2-69:AC1] [SG2-104:AC1] [NORMAL] Switching role preserves the same recipient inbox and read receipts'; end if;
 perform public.read_notification('hold',96955);
 perform public.read_all_notifications();
 if public.notification_event('event',96955) is not null then
   raise exception '[SG2-69:acting-role-event-summary] [SG2-69:AC3] [SG2-104:AC6] [FAILURE] A held coordinator role cannot grant an acting attendee access to an unregistered event'; end if;
 begin perform public.notification_reminder_preferences(); raise exception '[SG2-69:acting-role-preference-read] [SG2-69:AC6] [SG2-104:AC2] [FAILURE] A held coordinator role cannot grant an acting attendee reminder preferences'; exception when insufficient_privilege then null; end;
 begin perform public.set_notification_reminder_preferences(2); raise exception '[SG2-69:acting-role-preference-write] [SG2-69:AC6] [SG2-104:AC2] [FAILURE] An acting attendee cannot edit coordinator preferences'; exception when insufficient_privilege then null; end;
 perform set_config('request.headers','{"x-acting-role":"event_coordinator"}',true);
 if public.notification_event('hold',96955)->>'event_id' is distinct from '96901' then
   raise exception '[SG2-69:multi-role-coordinator-target] [SG2-69:AC3] [SG2-104:AC6] [NORMAL] The selected held coordinator role can open its assigned event'; end if;
 perform public.set_notification_reminder_preferences(1);
 if public.notification_reminder_preferences()->>'frequency_days' is distinct from '1' then
   raise exception '[SG2-69:multi-role-coordinator-preferences] [SG2-69:AC6] [SG2-104:AC2] [NORMAL] A selected held coordinator role can edit its reminder preferences'; end if;
 foreach result in array array['{}'::jsonb,'{"x-acting-role":"venue_staff"}'::jsonb] loop
   perform set_config('request.headers',result::text,true);
   if public.notification_event('event',96955) is not null then
     raise exception '[SG2-69:unresolved-acting-role-summary] [SG2-69:AC3] [SG2-104:AC2] [FAILURE] Missing or unheld acting roles cannot resolve event summaries'; end if;
   begin perform public.set_notification_reminder_preferences(2); raise exception '[SG2-69:unresolved-acting-role-preferences] [SG2-69:AC6] [SG2-104:AC2] [FAILURE] Missing or unheld acting roles cannot edit preferences'; exception when insufficient_privilege then null; end;
 end loop;
end $$;
select set_config('request.headers','{}',true);
reset role;
insert into public.registrations(event_id,attendee_id,status) values(96901,'e6900000-0000-4000-8000-000000000006','confirmed');
set local role authenticated;
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000006',true);
do $$ begin if public.notification_event('event',97006)->>'event_id' is distinct from '96901' then raise exception '[SG2-69:registered-attendee-target] [SG2-69:AC3] [NORMAL] Registered attendee may open own notice minimal event'; end if; end $$;
reset role;
update public.users set organisation='Another org' where user_id='e6900000-0000-4000-8000-000000000003';
update public.events set coordinator_id='e6900000-0000-4000-8000-000000000002' where event_id=96901;
set local role authenticated;
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000001',true);
select set_config('request.headers','{"x-acting-role":"event_coordinator"}',true);
do $$ begin if public.notification_event('hold',96955) is not null then raise exception '[SG2-69:reassigned-target] [SG2-69:AC3] [CONFLICT] Former coordinator cannot open old event'; end if; end $$;
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000003',true);
select set_config('request.headers','{}',true);
do $$ begin if public.notification_event('event',97003) is not null then raise exception '[SG2-69:organisation-change-target] [SG2-69:AC3] [FAILURE] Former organisation membership cannot open event'; end if; end $$;
reset role;
update public.users set organisation='SG69 Org' where user_id='e6900000-0000-4000-8000-000000000003';
update public.events set coordinator_id='e6900000-0000-4000-8000-000000000001' where event_id=96901;
insert into public.equipment_requests(request_id,event_id,equipment_id,quantity) values(96901,96901,96901,2);
-- Scheduler public seam: first send lists all unmet SG2-57 arrangements exactly once.
do $$ declare sent integer; begin
 sent:=public.send_outstanding_arrangement_reminders();
 if sent is distinct from 1 or (select message from public.notifications where event_id=96901 and kind='outstanding_arrangements') is distinct from 'Upcoming event Upcoming forum still needs: Venue booking, Equipment, Registration.'
   or exists(select 1 from public.notifications where kind='outstanding_arrangements' and recipient_id is distinct from 'e6900000-0000-4000-8000-000000000001') then
   raise exception '[SG2-69:reminder-outstanding-list] [SG2-69:AC5] [SG2-69:AC7] [NORMAL] One reminder per assigned event must list all current unmet arrangements'; end if;
 if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:cadence-no-duplicate] [SG2-69:AC6] [CONFLICT] Same-day sweep must not duplicate reminders'; end if;
 update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '1 day 1 second' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 1 then raise exception '[SG2-69:daily-due] [SG2-69:AC6] [BOUNDARY] Daily reminder must become due after one day'; end if;
 update public.notification_reminder_settings set frequency_days=3 where user_id='e6900000-0000-4000-8000-000000000001';
 update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '2 days' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:custom-frequency-not-due] [SG2-69:AC6] [NORMAL] Three-day preference must suppress day-two reminder'; end if;
 update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '3 days 1 second' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 1 then raise exception '[SG2-69:custom-frequency-due] [SG2-69:AC6] [BOUNDARY] Three-day reminder must become due at its interval'; end if;
end $$;
-- Make all arrangements ready without altering event history. Approved requests
-- need actual confirmed booking links, equipment needs receipt and placement.
update public.venue_holds set status='released' where hold_id=96901;
insert into public.venue_bookings(booking_id,event_id,venue_id,starts_at,ends_at,status)
 values(96901,96901,96901,clock_timestamp()+interval '100 days',clock_timestamp()+interval '100 days 4 hours','confirmed');
update public.venue_booking_requests set status='approved',venue_booking_id=96901 where request_id=96901;
insert into public.equipment_reservations(event_id,equipment_id,quantity_reserved,request_id,reserved_at,starts_at,ends_at)
 values(96901,96901,2,96901,clock_timestamp(),clock_timestamp()+interval '100 days',clock_timestamp()+interval '100 days 4 hours');
update public.equipment_requests set shortfall=0,placement_venue_id=96901,placement_position='Stage' where request_id=96901;
update public.events set registration_capacity=50,registration_opens_at=clock_timestamp(),registration_closes_at=clock_timestamp()+interval '90 days',arrangements_recheck_needed=false,outstanding_arrangements='[]' where event_id=96901;
update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '31 days' where event_id=96901;
do $$ begin
 if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:ready-stops-reminders] [SG2-69:AC6] [NORMAL] Ready event must stop due reminders'; end if;
end $$;
-- Each persisted planning recheck must be reflected in the delivered reminder.
do $$ declare key text; expected text; before_count bigint; sent integer; begin
 foreach key in array array['venue','equipment','registration'] loop
  update public.events set arrangements_recheck_needed=true,outstanding_arrangements=jsonb_build_array(key||'_recheck') where event_id=96901;
  update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '31 days' where event_id=96901;
  expected:=case key when 'venue' then 'Venue booking' when 'equipment' then 'Equipment' else 'Registration' end;
  select count(*) into before_count from public.notifications where event_id=96901 and kind='outstanding_arrangements';
  sent:=public.send_outstanding_arrangement_reminders();
  if sent is distinct from 1 or (select count(*) from public.notifications where event_id=96901 and kind='outstanding_arrangements' and message='Upcoming event Upcoming forum still needs: '||expected||'.')<1
    or (select count(*) from public.notifications where event_id=96901 and kind='outstanding_arrangements') is distinct from before_count+1 then
    raise exception '[SG2-69:recheck-readiness-parity] [SG2-69:AC5] [CONFLICT] Recheck % must remain outstanding despite complete child rows',key; end if;
 end loop;
end $$;
update public.events set arrangements_recheck_needed=false,outstanding_arrangements='[]' where event_id=96901;
-- Broken linked booking, unplaced/missing-receipt equipment and disrupted venue
-- each remain outstanding at the public scheduler seam.
do $$ begin
 update public.venue_booking_requests set venue_booking_id=null where request_id=96901;
 update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '31 days' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 1 then raise exception '[SG2-69:unlinked-approved-booking] [SG2-69:AC5] [FAILURE] Approved request without booking link stays outstanding'; end if;
 update public.venue_booking_requests set venue_booking_id=96901 where request_id=96901;
 update public.equipment_requests set placement_venue_id=null,placement_position=null where request_id=96901;
 update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '31 days' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 1 then raise exception '[SG2-69:unplaced-equipment] [SG2-69:AC5] [FAILURE] Reservation without placement stays outstanding'; end if;
 update public.equipment_requests set placement_venue_id=96901,placement_position='Stage',shortfall=1 where request_id=96901;
 update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '31 days' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 1 then raise exception '[SG2-69:equipment-shortfall] [SG2-69:AC5] [FAILURE] Equipment shortfall stays outstanding'; end if;
 update public.equipment_requests set shortfall=0 where request_id=96901;
 delete from public.equipment_reservations where request_id=96901;
 update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '31 days' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 1 then raise exception '[SG2-69:equipment-no-receipt] [SG2-69:AC5] [FAILURE] Equipment without reservation receipt stays outstanding'; end if;
 update public.equipment_requests set status='cancelled' where request_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:cancelled-equipment-not-required] [SG2-69:AC5] [BOUNDARY] Cancelled equipment alone needs no reminder'; end if;
end $$;
insert into public.venue_unavailability(venue_id,starts_at,ends_at,reason,category)
 values(96901,clock_timestamp()+interval '100 days 1 hour',clock_timestamp()+interval '100 days 2 hours','Maintenance','maintenance');
update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '31 days' where event_id=96901;
do $$ begin if public.send_outstanding_arrangement_reminders() is distinct from 1 then raise exception '[SG2-69:disrupted-booking] [SG2-69:AC5] [CONFLICT] Confirmed booking affected by unavailability remains outstanding'; end if; end $$;
-- Terminal/past events stop even when otherwise outstanding and due.
do $$ declare stage text; sent integer; begin
 foreach stage in array array['cancelled','completed','rejected'] loop
  update public.events set status=stage::public.event_status,
    completed_by=case when stage='completed' then 'e6900000-0000-4000-8000-000000000001'::uuid else null end,
    completed_at=case when stage='completed' then clock_timestamp() else null end,
    decision_reason=case when stage='rejected' then 'No longer needed' else null end where event_id=96901;
  update public.notification_reminder_receipts set last_sent_at=clock_timestamp()-interval '31 days' where event_id=96901;
  if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:terminal-stops-reminders] [SG2-69:AC6] [NORMAL] Terminal stage % must stop reminders',stage; end if;
 end loop;
 update public.events set status='planning',proposed_date=clock_timestamp()-interval '1 second' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:past-event-stops] [SG2-69:AC6] [BOUNDARY] Past event must receive no reminders'; end if;
 update public.events set proposed_date=null where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:undated-event-stops] [SG2-69:AC6] [BOUNDARY] Undated event must receive no reminders'; end if;
 update public.events set proposed_date=clock_timestamp()+interval '100 days',coordinator_id=null where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:unassigned-event] [SG2-69:AC7] [FAILURE] Unassigned event must receive no reminders'; end if;
 update public.events set coordinator_id='e6900000-0000-4000-8000-000000000004' where event_id=96901;
 if public.send_outstanding_arrangement_reminders() is distinct from 0 then raise exception '[SG2-69:wrong-role-coordinator] [SG2-69:AC7] [FAILURE] Venue Staff cannot receive coordinator reminders'; end if;
 update public.events set coordinator_id='e6900000-0000-4000-8000-000000000002' where event_id=96901;
 sent:=public.send_outstanding_arrangement_reminders();
 if sent is distinct from 1 or not exists(select 1 from public.notifications where kind='outstanding_arrangements' and event_id=96901 and recipient_id='e6900000-0000-4000-8000-000000000002') then
   raise exception '[SG2-69:reassignment-new-recipient] [SG2-69:AC7] [CONFLICT] Reassigned event must notify only its current coordinator without old cadence suppressing first reminder'; end if;
end $$;
-- The summary uses the same current internal relationships as stage/history:
-- an equipment request creates the support relationship, and reaching the
-- safety stage creates the safety relationship.
set local role authenticated;
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000005',true);
do $$ begin
 if public.notification_event('event',97005)->>'event_id' is distinct from '96901' then
   raise exception '[SG2-69:related-support-summary] [SG2-69:AC3] [SG2-104:AC6] [NORMAL] Support staff with a current equipment relationship can open its own notice summary'; end if;
end $$;
reset role;
update public.events set status='awaiting_safety_check' where event_id=96901;
set local role authenticated;
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000008',true);
do $$ begin
 if public.notification_event('event',97008)->>'event_id' is distinct from '96901' then
   raise exception '[SG2-69:related-safety-summary] [SG2-69:AC3] [SG2-104:AC6] [NORMAL] Safety stage creates the current safety officer relationship'; end if;
end $$;
reset role;
update public.events set status='planning' where event_id=96901;
set local role authenticated;
select set_config('request.jwt.claim.sub','e6900000-0000-4000-8000-000000000008',true);
do $$ begin
 if public.notification_event('event',97008) is not null then
   raise exception '[SG2-69:revoked-safety-summary] [SG2-69:AC3] [SG2-104:AC6] [CONFLICT] Returning to planning removes the safety relationship while preserving the notice'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.notification_inbox(); raise exception '[SG2-69:anonymous-inbox-denied] [SG2-69:AC1] [FAILURE] Anonymous caller cannot read an inbox'; exception when insufficient_privilege then null; end;
 begin perform public.read_notification('event',96901); raise exception '[SG2-69:anonymous-read-denied] [SG2-69:AC3] [FAILURE] Anonymous caller cannot mark a notice read'; exception when insufficient_privilege then null; end;
 begin perform public.send_outstanding_arrangement_reminders(); raise exception '[SG2-69:anonymous-scheduler-denied] [SG2-69:AC7] [FAILURE] Anonymous caller cannot execute the global scheduler'; exception when insufficient_privilege then null; end;
 raise notice '[SG2-69:anonymous-denied] [SG2-69:AC1] [SG2-69:AC7] [FAILURE] Anonymous users cannot access inboxes or scheduler';
end $$;
reset role;
rollback;
