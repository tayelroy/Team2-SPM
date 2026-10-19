# Model notes: sources for the class and data-model diagrams

Revision note: the original 14 Oct design described main `1d1e336`. This revision describes PR90 head `61416cc`, including merged PR92; it does not claim that PR90 is merged or that every Done criterion has passed hosted acceptance. Jira status was refreshed on 16 Oct 2026.

As of PR90 head 61416cc (16 Oct 2026). Migrations live in `supabase/migrations/` and are applied in filename order. "W7" marks a Week 7 change.

## Files

| File | Diagram blocks |
|---|---|
| `class-diagram.puml` | `class-events-people`, `class-venues-bookings`, `class-equipment` |
| `data-model.puml` | `er-events-people`, `er-venues-availability`, `er-requests-holds`, `er-equipment-notifications` |

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

Enums: `event_status` comes from 202609080000. `needs_clarification` was added in 202609300001, and the four W7 values in 202610090001. `venue_layout` comes from 202609220001_venue_layouts.

Views (listed in the legends, not drawn as tables): `internal_work_items` (202609220001, last redefined in 202610160003 (planning details)), `venue_booking_occupancy` (202610050001, then 202610100002), and `venue_affected_bookings` (202610100001).

pg_cron: the `venue-hold-deadlines` job runs `process_venue_hold_deadlines()` every minute (202610050001).

## Class diagram → sources

| Class | Source |
|---|---|
| Event, EventStatus | `events`, `event_status`; `EVENT_STATUSES` and `STATUS_TRANSITIONS` in `server/src/events/fields.ts`; `confirm_event()` final body in 202610170002, combining affected bookings and persisted planning rechecks |
| User, AccountRole, AccountRoleName, Role | `users`, `account_roles`, `roles`; `server/src/auth/policy.ts` (`ROLES`); `updateAccountRole` in `server/src/db/accountRoles.ts` |
| CoordinatorAssignment (W7) | Not a table: it is `events.coordinator_id`. Sources: `server/src/events/assignCoordinator.ts`, `assignEventCoordinator` and `COORDINATOR_ASSIGNABLE_STATUSES` in `server/src/db/eventRequests.ts`, `fetchUnassignedQueue` in `server/src/db/assignmentQueue.ts`, and permissions `event_request.assign_coordinator` and `event_request.queue.view` in `policy.ts` |
| EventAuditLog, Clarification, Registration | `event_audit_logs`, `event_clarifications`, `registrations` |
| Notification, NotificationKind | `notifications` and its final `notifications_kind_check` (202610170001), including `venue_unavailable` |
| SafetyCheck («planned» SG2-91/92/93/94) | No table, RPC or route. The statuses that exist and their intended use come from `fields.ts` comments and `server/src/events/stageCalculator.ts` |
| Venue, VenueLayout | `venues`, `venue_layouts` |
| VenueOperations, VenueOperationHistory (W7) | `venue_operations`, `venue_operation_history`; `venue_preparation_gap()` in 202610120002 (SG2-78) |
| VenueUnavailability, VenueBookingDisruption (W7) | `venue_unavailability`, `venue_booking_disruptions` (202610100001) |
| VenueBookingRequest | `venue_booking_requests`; `decide_venue_booking_request()` (latest version in 202610190002, which counts only Venue Staff capacity exceptions); `withdraw_venue_booking_request()` (202610150002) |
| CapacityException | `venue_capacity_exceptions`; only rows with `approver_role = 'venue_staff'` cover attendance (SG2-66 AC5, `bookingReadiness` in `server/src/venues/suitability.ts`) |
| VenueBooking | `venue_bookings`; `release_venue_booking()` (202610100002) |
| BookingClash (W7) | `venue_booking_clashes`; `refresh_venue_booking_clashes()` (202610140003) |
| VenueHold, VenueHoldNotification, VenueHoldSettings (W7) | `venue_holds`, `venue_hold_notifications`, `venue_hold_settings`; `create_venue_hold` (202610050001, redefined in 202610120002), `change_venue_hold` (202610050001, redefined in 202610120002, 202610160001, 202610170004 and 202610190002) and `process_venue_hold_deadlines` (202610050001) |
| Replacement (SG2-81) | No separate table/class: `VenueBookingRequest.replacesBookingId` points to the old `VenueBooking`; approval calls internal `release_replaced_booking` in the decision transaction (202610170001) |
| ChangeOneVenue («planned» SG2-83) | General one-venue change/cancellation is separate from implemented affected-booking replacement |
| Equipment, EquipmentRequest, EquipmentReservation | `equipment`, `equipment_requests`, `equipment_reservations`; `check_equipment_availability`, `manage_equipment_requirements` and `manage_equipment_reservations` |

## Where code and brief differ

- **Event to VenueBooking.** `venue_bookings.event_id` can be null (`on delete set null`), so the relationship is drawn as Event 0..1 to * VenueBooking. `events.venue_booking_id` (integer) is an older single-venue pointer. The RPCs set it to the first booking (`coalesce`, SG2-82), and no server code reads it.
- **Hold notices.** These are stored in their own table, `venue_hold_notifications`, not in `notifications`, and they go only to the event's coordinator.
- **Safety Officer and venue safety details.** The Safety Officer cannot read the SG2-77 safety details. `venues.operations.read` and the `venue_operations_read` RLS policy allow only venue_staff, event_coordinator and technical_support_staff.
- **Assignment by the Lead (SG2-88 is Done in the 16 Oct Jira snapshot).** The Lead can already assign and reassign a coordinator through `PATCH /api/event-requests/:eventId/coordinator`, for any status in `COORDINATOR_ASSIGNABLE_STATUSES`.
- **Changing one venue (SG2-83 is To Do).** One venue of a multi-venue event can already be dropped, through `release_venue_booking` (SG2-51) and `withdraw_venue_booking_request` (SG2-82).
- **Notification kinds.** The database check and server/client contracts now include `venue_unavailable` alongside the previous eleven kinds (`202610170001`; `server/src/db/notifications.ts`, `client/src/api/notificationsApi.ts`).
- **Affected-booking lifecycle.** `venue_disruption_notify` writes notices for new flags, returns Preparation/Confirmed to Planning, clears confirmation stamps and records status history while retaining event details. Approval releases the original booking atomically; unrelated persisted planning rechecks still block confirmation (202610170002).
