# Model notes: sources for the class and data-model diagrams

Revision note: the original 14 Oct design described main `1d1e336`. This revision describes PR90 head `61416cc`, including merged PR92; it does not claim that PR90 is merged or that every Done criterion has passed hosted acceptance. Jira status was refreshed on 16 Oct 2026.

The class diagram is as of main b7e2b1a (26 Oct 2026, SG2-96); the data model is still as of PR90 head 61416cc (16 Oct 2026), and the tables and columns added since are listed below. Migrations live in `supabase/migrations/` and are applied in filename order. "W7" marks a Week 7 change; "15 Oct" a change from the 15 Oct 2026 clarification session.

## Files

Both are draw.io files, edited in app.diagrams.net (see `c4-notes.md` for how to edit and render them).

| File | Pages |
|---|---|
| `class-diagram.drawio` | Class (1/3) events, people & coordination; (2/3) venues, availability & bookings; (3/3) equipment |
| `data-model.drawio` | Data (1/4) events & people; (2/4) venues, availability & bookings; (3/4) venue requests, capacity exceptions & holds; (4/4) equipment & notifications |

The data model has four pages, not two or three. With 13 venue tables on one page the text was too small to read on A4 landscape.

## Tables in the public schema (24) → where they come from

| Table | Created in | Later changes | ER page |
|---|---|---|---|
| roles | 202609080000_core_schema | W7 rows 6 and 7: 202610050004_week7_roles (SG2-86) | 1 |
| users | 202609080000 | phone, communication_preferences, department: 202609150001 | 1 |
| account_roles | 202609080001_account_roles | W7 role check widened: 202610050004 | 1 |
| events | 202609080000 | planning columns: 202609240000; decided_*: 202609250001; W7 completed_*: 202610090003; W7 submitted_at and queue index: 202610090004; confirmed_*: 202610150001, additive repair 202610160005; venue_booking_id FK: 202609080002 | 1 |
| event_audit_logs | 202609240000 | W7 actor_id made nullable: 202610050001 | 1 |
| event_clarifications | 202609300001 | (RLS only: 202610020001) | 1 |
| registrations | 202609080000 | — | 1 |
| venues | 202609080000 | — | 2 |
| venue_layouts | 202609220001_venue_layouts | — | 2 |
| venue_operations (W7) | 202610050003 (SG2-77) | — | 2 |
| venue_operation_history (W7) | 202610050003 (SG2-77) | — | 2 |
| venue_unavailability | 202609080002 | W7 category, created_by, created_at: 202610100001 (SG2-80) | 2 |
| venue_booking_disruptions (W7) | 202610100001 (SG2-80) | notification/reversion trigger: 202610170001 (SG2-81) | 2 |
| venue_bookings | 202609080002 | exclusion constraint: 202610070003; cancelled status and cancelled_*: 202610100002 | 2 |
| venue_booking_clashes (W7) | 202610140003 (SG2-79) | — | 2 |
| venue_booking_requests | 202609220001_internal_work_queue | layout, venue_requirements, requested_*, no-duplicate exclusion: 202610050002; decided_*, venue_booking_id: 202610060001; W7 withdrawn_*: 202610150002 (SG2-82); replaces_booking_id + partial index: 202610170001 (SG2-81) | 3 |
| venue_capacity_exceptions | 202610010001 | approver_role check narrowed to `venue_staff` (added NOT VALID so approvals other roles recorded under SG2-47 stay as history, inert) and the request/attendance unique index limited to Venue Staff rows: 202610190002 (SG2-66 AC5) | 3 |
| venue_holds (W7) | 202610050001 (SG2-84/85) | — | 3 |
| venue_hold_notifications (W7) | 202610050001 | — | 3 |
| venue_hold_settings (W7) | 202610050001 | — | 3 |
| equipment | 202609080000 | description, location, operational_status, version, available_quantity: 202610070001 | 4 |
| equipment_requests | 202609220001_internal_work_queue | requirement and placement columns: 202610080001 | 4 |
| equipment_reservations | 202609080000 | starts_at, ends_at: 202610120001; request_id, reserved_at: 202610140001 | 4 |
| notifications | 202610060001 | kind list widened: 202610100002, 202610140001 (+ equipment_reservation_id), W7 202610140003 (`venue_booking_clash`), 202610150001, 202610160001, 202610170001 (`venue_unavailable`) | 4 |

### Added after 16 Oct (in the class diagram; not yet drawn in the data model)

| Table or column | Migration | Story |
|---|---|---|
| `account_roles` keyed by (user_id, role): one row per role held | 202610180001_account_multi_roles; acting-role functions 202610200002 | 15 Oct SG2-104 |
| `venues.deleted_at`, `deleted_by`; `venue_holds.expiry_revision`; `delete_venue()`, `change_venue_hold_expiry()` | 202610170007_venue_delete_hold_expiry; past holds 202610190001 | 15 Oct SG2-106 |
| `events.expected_crowd_movement`, `awaiting_safety_check_since`, `safety_check_revision`; `refresh_safety_check_status()` | 202610190004_safety_check_queue | W7 SG2-91 |
| `event_safety_decisions` | 202610190005_safety_decisions; revision 202610190006; gate 202610220001 | W7 SG2-92/94 |
| `safety_rereviews` | 202610240001_safety_changes_requested | W7 SG2-93 |
| `notifications.read_at`; `notification_reminder_settings`, `notification_reminder_receipts` | 202610200003_notifications_inbox_reminders | 15 Oct SG2-69 |
| `events.preferred_layout` | 202610200001_event_preferred_layout | SG2-105 |
| `events.registration_announced`; `registrations.registered_at` | 202610200004_event_registration_settings | SG2-63 |
| `events.category` and search | 202610200005_event_search | SG2-70 |
| equipment release on cancellation | 202610210001_equipment_release | SG2-56 |
| change or cancel one venue (`change_reason`) | 202610210002_venue_booking_change_cancel | W7 SG2-83 |
| `events.cancellation_requested_*`, `cancelled_*`; `cancel_event()` | 202610220002_event_cancellation | SG2-67 |
| registrable events | 202610220003_registrable_events | SG2-59 |
| `events.coordinator_assigned_by` | 202610220004_coordinator_oversight | W7 SG2-89 |
| `apply_accepted_event_change()` | 202610190003_event_change_impact | 15 Oct SG2-66 |

Enums: `event_status` comes from 202609080000. `needs_clarification` was added in 202609300001, and the four W7 values in 202610090001. `venue_layout` comes from 202609220001_venue_layouts.

Views (listed in the legends, not drawn as tables): `internal_work_items` (202609220001, last redefined in 202610160003 (planning details)), `venue_booking_occupancy` (202610050001, then 202610100002), and `venue_affected_bookings` (202610100001).

pg_cron: `venue-hold-deadlines` runs `process_venue_hold_deadlines()` every minute (202610050001); `registration-windows` every minute (SG2-63); `sg2-69-arrangement-reminders` hourly (SG2-69).

## Class diagram → sources

| Class | Source |
|---|---|
| Event, EventStatus | `events`, `event_status`; `EVENT_STATUSES` and `STATUS_TRANSITIONS` in `server/src/events/fields.ts`; `confirm_event()` final body in 202610170002, combining affected bookings and persisted planning rechecks |
| User, AccountRole, AccountRoleName, Role | `users`, `account_roles`, `roles`; `server/src/auth/policy.ts` (`ROLES`); `changeAccountRoles` / `getHeldRoles` in `server/src/db/accountRoles.ts` |
| CoordinatorAssignment (W7) | Not a table: it is `events.coordinator_id`. Sources: `server/src/events/assignCoordinator.ts`, `assignEventCoordinator` and `COORDINATOR_ASSIGNABLE_STATUSES` in `server/src/db/eventRequests.ts`, `fetchUnassignedQueue` in `server/src/db/assignmentQueue.ts`, and permissions `event_request.assign_coordinator` and `event_request.queue.view` in `policy.ts` |
| EventAuditLog, Clarification, Registration | `event_audit_logs`, `event_clarifications`, `registrations` |
| Notification, NotificationKind | `notifications` and its final `notifications_kind_check` (202610170001), including `venue_unavailable` |
| SafetyDecision, SafetyRereview (W7) | `event_safety_decisions` (202610190005, revision 202610190006), `safety_rereviews` (202610240001); `record_safety_decision`, `rework_safety_rejected_event`, `confirm_safety_rereview`, `safety_check_queue`; routes in `server/src/safetyChecks/` and `server/src/events/safetyDecisionRoutes.ts`, `safetyRereviewRoutes.ts` |
| ReminderSettings, ReminderReceipt (15 Oct) | `notification_reminder_settings`, `notification_reminder_receipts` (202610200003); `send_outstanding_arrangement_reminders()` hourly (SG2-69) |
| ChangeRequest («planned» SG2-64/65) | No table: change requests come from `server/src/changeRequests/mockChangeRequests.ts`. The impact check and `apply_accepted_event_change()` (202610190003, SG2-66) are built |
| AttendeeRegistration, WaitingListEntry («planned» SG2-60/61/62) | No table yet; `registrations` holds rows from the older schema and the SG2-63 settings |
| Venue, VenueLayout | `venues`, `venue_layouts` |
| VenueOperations, VenueOperationHistory (W7) | `venue_operations`, `venue_operation_history`; `venue_preparation_gap()` in 202610120002 (SG2-78) |
| VenueUnavailability, VenueBookingDisruption (W7) | `venue_unavailability`, `venue_booking_disruptions` (202610100001) |
| VenueBookingRequest | `venue_booking_requests`; `decide_venue_booking_request()` (latest version in 202610190002, which counts only Venue Staff capacity exceptions); `withdraw_venue_booking_request()` (202610150002) |
| CapacityException | `venue_capacity_exceptions`; only rows with `approver_role = 'venue_staff'` cover attendance (SG2-66 AC5, `bookingReadiness` in `server/src/venues/suitability.ts`) |
| VenueBooking | `venue_bookings`; `release_venue_booking()` (202610100002) |
| BookingClash (W7) | `venue_booking_clashes`; `refresh_venue_booking_clashes()` (202610140003) |
| VenueHold, VenueHoldNotification, VenueHoldSettings (W7) | `venue_holds`, `venue_hold_notifications`, `venue_hold_settings`; `create_venue_hold` (202610050001, redefined in 202610120002), `change_venue_hold` (202610050001, redefined in 202610120002, 202610160001, 202610170004 and 202610190002) and `process_venue_hold_deadlines` (202610050001) |
| Replacement (SG2-81) | No separate table/class: `VenueBookingRequest.replacesBookingId` points to the old `VenueBooking`; approval calls internal `release_replaced_booking` in the decision transaction (202610170001) |
| ChangeOneVenue (W7 SG2-83) | No table: `venue_booking_requests.change_reason` and the change/cancel routes (202610210002); separate from the SG2-81 affected-booking replacement |
| Equipment, EquipmentRequest, EquipmentReservation | `equipment`, `equipment_requests`, `equipment_reservations`; `check_equipment_availability`, `manage_equipment_requirements` and `manage_equipment_reservations` |

## Where code and brief differ

- **Event to VenueBooking.** `venue_bookings.event_id` can be null (`on delete set null`), so the relationship is drawn as Event 0..1 to * VenueBooking. `events.venue_booking_id` (integer) is an older single-venue pointer. The RPCs set it to the first booking (`coalesce`, SG2-82), and no server code reads it.
- **Hold notices.** These are stored in their own table, `venue_hold_notifications`, not in `notifications`, and they go only to the event's coordinator.
- **Safety Officer and venue safety details.** Fixed since 16 Oct: `venues.operations.read` and the RLS policy include the Safety Officer (202610160002, 202610170005).
- **Assignment by the Lead (SG2-88 is Done in the 16 Oct Jira snapshot).** The Lead can already assign and reassign a coordinator through `PATCH /api/event-requests/:eventId/coordinator`, for any status in `COORDINATOR_ASSIGNABLE_STATUSES`.
- **Changing one venue (SG2-83).** Built since 16 Oct (202610210002): the coordinator changes or cancels one venue of a multi-venue event; a new venue goes through the normal request and approval.
- **Notification kinds.** The database check and server/client contracts now include `venue_unavailable` alongside the previous eleven kinds (`202610170001`; `server/src/db/notifications.ts`, `client/src/api/notificationsApi.ts`).
- **Affected-booking lifecycle.** `venue_disruption_notify` writes notices for new flags, returns Preparation/Confirmed to Planning, clears confirmation stamps and records status history while retaining event details. Approval releases the original booking atomically; unrelated persisted planning rechecks still block confirmation (202610170002).
