# Model notes: sources for the class and data-model diagrams

Revision note: the original 14 Oct design described main `1d1e336`; the 16 Oct revision described PR90 head `61416cc`. This revision describes main `4881413` (3 Nov 2026), where all 23 Sprint 4 stories are merged. It was checked against `supabase/migrations/` through `202610310001` and `server/src/app.ts`; it does not claim hosted acceptance of every story (see `docs/requirements-alignment.md`).

As of main 4881413 (3 Nov 2026). Migrations live in `supabase/migrations/` and are applied in filename order. "W7" marks a Week 7 change (#1 setup/turnaround, #2 unavailable venue, #3 several venues per event incl. SG2-83, #4 holds with expiry incl. SG2-106, #5 Event Coordinator Lead incl. SG2-89, #6 operational safety check, SG2-91 to SG2-94). Later backlog stories are tagged with their migration and story id but not highlighted.

## Files

| File | Diagram blocks |
|---|---|
| `class-diagram.puml` | `class-events-people`, `class-venues-bookings`, `class-equipment`, `class-safety-changes`, `class-registrations` |
| `data-model.puml` | `er-events-people`, `er-venues-availability`, `er-requests-holds`, `er-equipment-notifications`, `er-registrations`, `er-safety-changes` |

The data model has six pages. With 13 venue tables on one page the text was too small to read on A4 landscape, and the registration, safety and change-request tables added since 16 Oct would not fit the first four pages.

## Tables in the public schema (30, plus `private.event_attendee_details`) → where they come from

| Table | Created in | Later changes | ER page |
|---|---|---|---|
| roles | 202609080000_core_schema | W7 rows 6 and 7: 202610050004_week7_roles (SG2-86) | 1 |
| users | 202609080000 | phone, communication_preferences, department: 202609150001 | 1 |
| account_roles | 202609080001_account_roles | W7 role check widened: 202610050004; key widened to (user_id, role) and index (role, user_id): 202610180001 (SG2-104) | 1 |
| events | 202609080000 | planning columns: 202609240000; decided_*: 202609250001; W7 completed_*: 202610090003; W7 submitted_at and queue index: 202610090004; confirmed_*: 202610150001, additive repair 202610160005; venue_booking_id FK: 202609080002; coordinator ≠ organiser check: 202610180003; W7 expected_crowd_movement, awaiting_safety_check_since, safety_check_revision and `safety_check_track_event`: 202610190004 (SG2-91); preferred_layout: 202610200001 (SG2-105); registration_announced: 202610200004 (SG2-63); category: 202610200005 (SG2-70); cancellation_requested_*, cancellation_reason, cancelled_*, `keep_cancelled_events_cancelled`: 202610220002 (SG2-67); W7 coordinator_assigned_by and index: 202610220004 (SG2-89); waiting_list_response_hours: 202610280001 (SG2-61); `safety_approval_gate`: 202610220001 (SG2-94) | 1 |
| event_audit_logs | 202609240000 | W7 actor_id made nullable: 202610050001; read policy now uses `private.event_relationship_exists()`: 202610180004 (SG2-104) | 1 |
| event_clarifications | 202609300001 | (RLS only: 202610020001) | 1 |
| registrations | 202609080000 | status default 'registered', registered_at, index (event_id, status): 202610200004; contact_phone, needs, one-active-per-attendee unique index: 202610230001 (SG2-60); withdrawn_at: 202610260003 (SG2-62) | 5 |
| waiting_list_entries | 202610280001_waiting_list (SG2-61/62) | — | 5 |
| private.event_attendee_details | 202610270002_attendee_event_change_notices (SG2-102) | — | 5 |
| venues | 202609080000 | W7 deleted_at, deleted_by, partial index and delete guards: 202610170007 (SG2-106) | 2 |
| venue_layouts | 202609220001_venue_layouts | — | 2 |
| venue_operations (W7) | 202610050003 (SG2-77) | stamp/record triggers: 202610170006; Safety Officer read policy: 202610160002 | 2 |
| venue_operation_history (W7) | 202610050003 (SG2-77) | — | 2 |
| venue_unavailability | 202609080002 | W7 category, created_by, created_at: 202610100001 (SG2-80) | 2 |
| venue_booking_disruptions (W7) | 202610100001 (SG2-80) | notification/reversion trigger: 202610170001 (SG2-81) | 2 |
| venue_bookings | 202609080002 | exclusion constraint: 202610070003; cancelled status and cancelled_*: 202610100002; event_id index: 202610260002 | 2 |
| venue_booking_clashes (W7) | 202610140003 (SG2-79) | — | 2 |
| venue_booking_requests | 202609220001_internal_work_queue | layout, venue_requirements, requested_*, no-duplicate exclusion: 202610050002; decided_*, venue_booking_id: 202610060001; W7 withdrawn_*: 202610150002 (SG2-82); replaces_booking_id + partial index: 202610170001 (SG2-81); W7 change_reason and the change/cancel triggers: 202610210002 (SG2-83); event_id index: 202610260002 | 3 |
| venue_capacity_exceptions | 202610010001 | approver_role check narrowed to `venue_staff` (added NOT VALID so approvals other roles recorded under SG2-47 stay as history, inert) and the request/attendance unique index limited to Venue Staff rows: 202610190002 (SG2-66 AC5) | 3 |
| venue_holds (W7) | 202610050001 (SG2-84/85) | expiry_revision: 202610170007 (SG2-106) | 3 |
| venue_hold_notifications (W7) | 202610050001 | expiry_revision, kind `expiry_changed`, unique (hold_id, recipient_id, kind, expiry_revision): 202610170007; read_at, inbox indexes: 202610200003 (SG2-69) | 3 |
| venue_hold_settings (W7) | 202610050001 | — | 3 |
| equipment | 202609080000 | description, location, operational_status, version, available_quantity: 202610070001 | 4 |
| equipment_requests | 202609220001_internal_work_queue | requirement and placement columns: 202610080001; event_id index: 202610260002; placement venue must be one the event uses (rule in `manage_equipment_requirements`): 202610290003 | 4 |
| equipment_reservations | 202609080000 | starts_at, ends_at: 202610120001; request_id, reserved_at: 202610140001; released_at, released_by, release_reason and `release_cancelled_event_equipment`: 202610210001 (SG2-56); event_id index: 202610260002 | 4 |
| notifications | 202610060001 | kind list widened (30 kinds, see the page 4 legend): 202610100002, 202610140001 (+ equipment_reservation_id), W7 202610140003 (`venue_booking_clash`), 202610150001, 202610160001, 202610170001 (`venue_unavailable`), 202610190003, 202610190005, 202610200003, 202610200004, 202610210002, 202610220002, 202610230001, 202610260001, 202610260003, 202610270001, 202610270002, 202610280001; read_at and inbox indexes: 202610200003 (SG2-69) | 4 |
| notification_reminder_settings | 202610200003_notifications_inbox_reminders (SG2-69) | — | 4 |
| notification_reminder_receipts | 202610200003 (SG2-69) | — | 4 |
| event_safety_decisions (W7) | 202610190005_safety_decisions (SG2-92) | revision check added to `record_safety_decision`: 202610190006 | 6 |
| safety_rereviews (W7) | 202610240001_safety_changes_requested (SG2-93) | closed by triggers on request status; `rework_safety_rejected_event` adds the resubmit key: 202610290002 | 6 |
| event_change_requests | 202610260001_event_change_requests (SG2-64) | decided_by, decided_at, decision_reason and their checks: 202610270001 (SG2-65) | 6 |

Enums: `event_status` comes from 202609080000. `needs_clarification` was added in 202609300001, and the four W7 values in 202610090001; no later migration adds a value (cancellation uses `cancelled`). `venue_layout` comes from 202609220001_venue_layouts.

Views (listed in the legends, not drawn as tables): `internal_work_items` (202609220001, last redefined in 202610220004; also replaced in 202610160003, 202610190004, 202610200001 and 202610220002), `venue_booking_occupancy` (202610050001, then 202610100002), and `venue_affected_bookings` (202610100001).

pg_cron jobs: `venue-hold-deadlines` runs `process_venue_hold_deadlines()` every minute (202610050001); `sg2-69-arrangement-reminders` runs `send_outstanding_arrangement_reminders()` hourly (202610200003); `registration-windows` runs `process_registration_windows()` every minute (202610200004); `waiting-list-offers` runs `process_waiting_list_offers()` every minute (202610280001). Each is scheduled only where `pg_cron` is available.

Migrations through `202610310001` that change functions only (no tables, columns, enums or indexes): 202610170003 (`update_event_request_draft`), 202610170004 (`change_venue_hold`), 202610170005 (`venue_exists_for_operations_read`), 202610170006 (venue operations triggers), 202610180004 (`private.event_relationship_exists` and the `event_audit_logs` read policy), 202610190001 (`delete_venue` ignores holds on past periods), 202610190006, 202610200002 (acting-role versions of the hold, booking, equipment, confirmation, draft, safety queue and venue decision functions), 202610220003 (`registrable_events`), 202610290001 (`event_equipment_needed`, `confirm_event`, readiness), 202610290002, 202610290003, 202610310001 (reservations must start in the future).

## Class diagram → sources

| Class | Source |
|---|---|
| Event, EventStatus | `events`, `event_status`; `EVENT_STATUSES` in `server/src/events/fields.ts`; `confirm_event()` final body in 202610290001 (affected bookings, persisted planning rechecks, safety approval, required equipment); `update_event_request_draft()` final body in 202610200005 |
| User, AccountRole, AccountRoleName, Role | `users`, `account_roles`, `roles`; `server/src/auth/policy.ts` (`ROLES`); `changeAccountRoles` / `getHeldRoles` in `server/src/db/accountRoles.ts` |
| ActingRole | Not a table: the `X-Acting-Role` header (`server/src/auth/actingRole.ts`, `client/src/auth/actingRole.ts`) and `acting_role()` / `lock_acting_role()` (202610180001, 202610200002) |
| CoordinatorAssignment (W7) | Not a table: it is `events.coordinator_id` and `events.coordinator_assigned_by`. Sources: `server/src/events/assignCoordinator.ts`, `assignEventCoordinator` and `COORDINATOR_ASSIGNABLE_STATUSES` in `server/src/db/eventRequests.ts`, `fetchUnassignedQueue` in `server/src/db/assignmentQueue.ts`, `fetchSupervisedEvents` in `server/src/db/coordinatorOverview.ts`, and permissions `event_request.assign_coordinator`, `event_request.queue.view` and `event_request.oversight.view` in `policy.ts` |
| EventAuditLog, Clarification | `event_audit_logs`, `event_clarifications` |
| Registration, WaitingListEntry, RegistrationSettings, AttendeeEventDetails | `registrations`, `waiting_list_entries`, the `events.registration_*` columns, `private.event_attendee_details`; `register_for_event`, `join_waiting_list`, `leave_waiting_list`, `withdraw_registration`, `my_registrations`, `registrable_events`, `event_registration_overview`, `update_registration_settings`, `process_registration_windows`, `process_waiting_list_offers` (202610200004, 202610220003, 202610230001, 202610260003, 202610270002, 202610280001); `server/src/registrableEvents/`, `myRegistrations/`, `events/registrationRoutes.ts` |
| Notification, NotificationKind, NotificationReminderSettings, NotificationReminderReceipt | `notifications` and its final `notifications_kind_check` (202610280001, 30 kinds), `notification_reminder_settings`, `notification_reminder_receipts`; `notification_inbox`, `read_notification`, `read_all_notifications`, `send_outstanding_arrangement_reminders` (202610200003); `server/src/db/notifications.ts`, `notificationInbox.ts` |
| SafetyCheck (W7) | Not a table: events in `awaiting_safety_check`. `safety_check_queue()` and the hand-off triggers (202610190004), `event_safety_approved()` and `safety_approval_gate` (202610220001); `server/src/safetyChecks/index.ts`, `server/src/events/arrangementReadiness.ts` |
| SafetyDecision (W7) | `event_safety_decisions`; `record_safety_decision()` (final signature 202610190006, reworked in 202610240001), `rework_safety_rejected_event()` (202610290002); `server/src/events/safetyDecisionRoutes.ts`, `safetyDecisions.ts`, `db/safetyDecisions.ts` |
| SafetyRereview (W7) | `safety_rereviews`; `safety_rereview_queue`, `event_safety_rereviews`, `confirm_safety_rereview` (202610240001); `server/src/events/safetyRereviewRoutes.ts`, `db/safetyRereviews.ts` |
| EventChangeRequest | `event_change_requests`; `raise_event_change_request` (202610260001), `decide_event_change_request` (202610270001), `apply_accepted_event_change` and `settle_arrangement_recheck` (202610190003, later versions in 202610220001 and 202610240001); `server/src/events/changeRequests.ts`, `changeImpact.ts`, `db/changeRequests.ts`, `db/changeImpact.ts` |
| EventCancellation | Not a table: `events.cancellation_*` and `cancelled_*` columns; `request_event_cancellation()` and `cancel_event()` (202610220002); `server/src/events/cancellation.ts`, `db/eventCancellation.ts` |
| Venue, VenueLayout | `venues`, `venue_layouts`; `delete_venue()` (202610170007, 202610190001) |
| VenueOperations, VenueOperationHistory (W7) | `venue_operations`, `venue_operation_history`; `venue_preparation_gap()` in 202610120002 (SG2-78) |
| VenueUnavailability, VenueBookingDisruption (W7) | `venue_unavailability`, `venue_booking_disruptions` (202610100001) |
| VenueBookingRequest | `venue_booking_requests`; `decide_venue_booking_request()` (latest version in 202610200002, which counts only Venue Staff capacity exceptions and refuses a Venue Staff member deciding their own request); `withdraw_venue_booking_request()` (202610150002) |
| CapacityException | `venue_capacity_exceptions`; only rows with `approver_role = 'venue_staff'` cover attendance (SG2-66 AC5, `bookingReadiness` in `server/src/venues/suitability.ts`) |
| VenueBooking | `venue_bookings`; `release_venue_bookings()` and `release_venue_booking()` (202610210002) |
| BookingClash (W7) | `venue_booking_clashes`; `refresh_venue_booking_clashes()` (202610140003) |
| VenueHold, VenueHoldNotification, VenueHoldSettings (W7) | `venue_holds`, `venue_hold_notifications`, `venue_hold_settings`; `create_venue_hold` (202610050001, redefined in 202610120002, 202610170007), `change_venue_hold` (202610050001, redefined in 202610120002, 202610160001, 202610170004 and 202610190002), `change_venue_hold_expiry` (202610170007) and `process_venue_hold_deadlines` (202610050001) |
| Replacement (SG2-81) | No separate table/class: `VenueBookingRequest.replacesBookingId` points to the old `VenueBooking`; approval calls internal `release_replaced_booking` in the decision transaction (202610170001, redefined in 202610210002) |
| ChangeOneVenue (W7, SG2-83) | No table: `release_venue_bookings()` cancels one booking (and any named in `p_also_cancel`); a change is a replacement request with `change_reason` (`venue_change_request_check`, `venue_change_requested`, `notify_venue_staff`, 202610210002); `server/src/venues/bookings.ts`, `bookingRequests.ts`, `db/venueBookings.ts` |
| Equipment, EquipmentRequest, EquipmentReservation | `equipment`, `equipment_requests`, `equipment_reservations`; `check_equipment_availability`, `manage_equipment_requirements` (final in 202610290003) and `manage_equipment_reservations` (final in 202610310001) |

## Where code and brief differ

- **Event to VenueBooking.** `venue_bookings.event_id` can be null (`on delete set null`), so the relationship is drawn as Event 0..1 to * VenueBooking. `events.venue_booking_id` (integer) is an older single-venue pointer. The RPCs set it to the first booking (`coalesce`, SG2-82), and no server code reads it.
- **Hold notices.** These are stored in their own table, `venue_hold_notifications`, not in `notifications`, and they go only to the event's coordinator. The SG2-69 inbox reads both tables (`notification_inbox`).
- **Safety Officer and venue safety details.** The Safety Officer reads the SG2-77 safety details: `venues.operations.read` and the `venue_operations_read` RLS policy allow venue_staff, event_coordinator, technical_support_staff and safety_officer (202610160002). Changing them and reading `venue_operation_history` stay with Venue Staff.
- **Assignment by the Lead (SG2-88).** The Lead assigns and reassigns a coordinator through `PATCH /api/event-requests/:eventId/coordinator`, for any status in `COORDINATOR_ASSIGNABLE_STATUSES`; `events.coordinator_assigned_by` records who supervises (SG2-89).
- **Changing one venue (SG2-83).** Built: the assigned coordinator cancels one booking, others only when named; a change is a replacement request with a reason (202610210002). Venue Staff no longer release bookings.
- **Notification kinds.** The database check now allows 30 kinds (see the page 4 legend). The server contract is split between `server/src/db/notifications.ts` and `server/src/db/eventNotifications.ts`.
- **Affected-booking lifecycle.** `venue_disruption_notify` writes notices for new flags, returns Preparation/Confirmed to Planning, clears confirmation stamps and records status history while retaining event details. Approval releases the original booking atomically; unrelated persisted planning rechecks still block confirmation (202610170002, final `confirm_event` in 202610290001).
- **Safety approval is not a column.** The approval is derived: the event's latest `event_safety_decisions` row is Approve and the event is still in Preparation or Confirmed (`event_safety_approved()`, 202610220001). Any move back to Planning withdraws it without touching the append-only history.
- **Registration status is free text.** `registrations.status` is still `varchar(50)`; `'registered'` is the default and `'cancelled'` (any case) is the only value that gives a place back (202610200004, 202610260003).
- **Change requests and safety tables have no client grants.** `event_change_requests`, `event_safety_decisions`, `safety_rereviews`, `waiting_list_entries` and the reminder tables grant only the service role; attendees and staff reach them through the API and SECURITY DEFINER functions.
