# ConnectSphere API specification — Sprint 4 revision (main `4881413`, 3 Nov 2026)

SG2-95. This spec covers every HTTP endpoint that `server/src/app.ts` mounts at the documented snapshot. It was written from the router and handler code, not from memory or older docs. Where a feature doc disagrees with the code, the code is what is described here, and [Doc vs code](#doc-vs-code) lists the differences.

- **Ground truth:** `server/src/app.ts` (mounts), the routers it mounts (`server/src/{auth,events,venues,equipment,notifications,profile,workQueue,assignmentQueue}/*.ts`), `server/src/auth/policy.ts` (`PERMISSIONS`), the `server/src/db/*` adapters, and the RPCs in `supabase/migrations/*.sql`.
- **Revision scope:** the whole Sprint 4 surface on `main` at `4881413` (3 Nov 2026), all 23 Sprint 4 stories merged. It supersedes the PR90 capacity and draft-history revision (baseline head `61416cc`, 16 Oct 2026). Registration (SG2-59 to SG2-63), cancellation (SG2-67), change requests (SG2-64 to SG2-66), the safety desk (SG2-91 to SG2-94), cross-system search (SG2-70), Lead oversight (SG2-89), the notification inbox (SG2-69), multi-role accounts (SG2-104), venue delete and hold expiry (SG2-106) and the other additions since the baseline are now in §2 and the sections below. Source line numbers quoted in §3 to §10 come from the earlier baseline and may have moved; the source filenames identify the code. This specification describes the code on `main`, not a claim of hosted acceptance or peer approval.
- **Endpoint count:** 108 method + path pairs, from 105 route registrations. Three registrations each serve two paths: the work queue and the two health checks.
- **Related design artefacts:** [architectural-decisions.md](architectural-decisions.md), `connectsphere.dsl` (C3 API components), `sequence-diagrams.puml`, `data-model.puml`, `class-diagram.puml`, `event-status-model.puml`.

## Contents
1. [Conventions](#1-conventions)
2. [Endpoint index](#2-endpoint-index) (all 108, one row each)
3. [Auth, accounts and profile](#3-auth-accounts-and-profile)
4. [Event requests](#4-event-requests)
5. [Queues and notifications](#5-queues-and-notifications)
6. [Venues](#6-venues)
7. [Venue booking requests](#7-venue-booking-requests)
8. [Venue holds, bookings and clashes](#8-venue-holds-bookings-and-clashes)
9. [Equipment](#9-equipment)
9A. [Event search](#9a-event-search-sg2-70)
9B. [Events open for registration](#9b-events-open-for-registration-sg2-59)
10. [Health](#10-health)
11. [Work still without an endpoint](#11-work-still-without-an-endpoint)
12. [Doc vs code](#doc-vs-code)
13. [How the route list was verified](#how-the-route-list-was-verified)

---

## 1. Conventions

### Transport and authentication
- **Format:** JSON request and response bodies; `express.json()` is applied globally. A malformed JSON body gets Express's default 400 response, because `app.ts` has no custom error handler.
- **Authentication:** every endpoint except login, logout and health needs `Authorization: Bearer <Supabase access token>`. Two pieces of middleware in `server/src/auth/index.ts` enforce this:
  - **`requireAuth`.** Checks there is exactly one well-formed Bearer header, verifies the token with Supabase Auth `getUser`, then reads **every** role the caller holds from `public.account_roles` (SG2-104) and picks the acting role (see [Acting role](#acting-role-sg2-104)). Neither the token claims nor the request body decide the roles. It stores `{ userId, role, roles }` on the request and sets `Cache-Control: no-store`.
  - **`requirePermission(action)`.** Checks `PERMISSIONS[action]` in `policy.ts` against that role. An action with no grant is denied.
- **`protectedRouter()`** is an Express `Router` with `router.use(requireAuth)`. Most routers are built this way, so a request entering one is authenticated even when no route in it matches.
  - **Exception:** the equipment-reservations router (`equipment/reservations.ts`) is a plain `Router` mounted at `/api`. It attaches `requireAuth` to each of its two routes, so it does not intercept other `/api/*` paths.

### Acting role (SG2-104)
- An account may hold several roles, but each request runs as exactly one: the **acting role**. The client names it in the `X-Acting-Role` header (`server/src/auth/actingRole.ts`). The server checks that the account holds it, then evaluates the request, its permissions and its database calls (the header is forwarded to PostgREST, where `public.acting_role()` and `lock_acting_role()` check it against the caller's own `account_roles` rows) as that role only.
- **No header:** a single-role account acts as its role; a multi-role account acts as its least-privileged role, in the order `attendee`, `event_organiser`, `safety_officer`, `event_coordinator_lead`, `event_coordinator`, `venue_staff`, `technical_support_staff`.
- **Refusals:** more than one `X-Acting-Role` header, or a value that is not one of the seven role codes, is 400 `{ error: "Invalid acting role", code: "invalid_acting_role" }`; a real role the account does not hold is 403 `{ error: "You do not hold that role", code: "role_not_held" }`.

### Errors common to every protected endpoint
These are not repeated per endpoint.

| Status | Body | When |
|---|---|---|
| 401 | `{ "error": "Authentication required" }` + `WWW-Authenticate: Bearer` | Missing, malformed or duplicate Bearer header, or token rejected by Supabase Auth |
| 403 | `{ "error": "Access denied" }` | Account has no known role in `account_roles`, or the acting role lacks the endpoint's permission |
| 503 | `{ "error": "Access service unavailable" }` | Supabase not configured over HTTPS, or the Auth / role lookup failed |
| 400 / 403 | `{ "error": "Invalid acting role" \| "You do not hold that role", "code": "invalid_acting_role" \| "role_not_held" }` | The `X-Acting-Role` header is malformed or names a role the account does not hold (see [Acting role](#acting-role-sg2-104)) |

Other conventions:
- **Handler errors** are `{ "error": string }`. Some add fields, e.g. `details[]`, `code`, `missing[]`, `conflict` or `outstanding[]`; these are noted per endpoint.
- **User-scoped endpoints** read and write with the caller's own token, so RLS applies. They also map database errors as follows: HTTP 401 → 401, HTTP 403 or Postgres `42501` → 403, anything else → 503.
- **IDs in paths and queries** must be positive decimal integers (`^[1-9]\d*$`). Most are capped at 2147483647; where the cap differs, the endpoint says so.

### Roles
| Abbr. | Role (`account_roles.role`) | Abbr. | Role |
|---|---|---|---|
| EO | Event Organiser (`event_organiser`) | VS | Venue Staff (`venue_staff`) |
| EC | Event Coordinator (`event_coordinator`) | TSS | Technical Support Staff (`technical_support_staff`) |
| ECL | Event Coordinator Lead (`event_coordinator_lead`) — **Week 7, SG2-86** | ATT | Attendee (`attendee`) |
| SO | Safety Officer (`safety_officer`) — **Week 7, SG2-86** | | |

### Week 7 markers (column "Week 7")
| Marker | Meaning |
|---|---|
| **W7 #n — SG2-xx** | Added or changed by a story delivering Week 7 customer change #n. Changes: #1 setup & turnaround, #2 temporary unavailability / replace venue, #3 several venues per event, #4 tentative holds with expiry, #5 Event Coordinator Lead, #6 safety check. |
| **New since W7 — SG2-xx** | Added on or after 5 Oct 2026, when the first Week 7 change merged (SG2-84/85), by a backlog story that is not one of the six changes. |
| — | Existed before Week 7 and not changed by it. |

---

## 2. Endpoint index

The **Roles** column lists the roles granted the permission in `policy.ts`. Several handlers narrow this further to a single row (e.g. "assigned coordinator only"); that is given in the endpoint's detail section.

| # | Method | Path | Permission | Roles | Week 7 | § |
|---|---|---|---|---|---|---|
| 1 | POST | `/api/auth/login` | public (rate-limited) | anyone | — | [3.1](#31-post-apiauthlogin) |
| 2 | POST | `/api/auth/logout` | public | anyone | — | [3.2](#32-post-apiauthlogout) |
| 3 | GET | `/api/auth/me` | authenticated (no permission key) | all 7 | — (ECL/SO valid since SG2-86; `roles` since SG2-104) | [3.3](#33-get-apiauthme) |
| 4 | PATCH | `/api/users/:userId/role` | `users.role.update` | TSS | — (accepts the two W7 roles since SG2-86; replaces all held roles, SG2-104) | [3.4](#34-patch-apiusersuseridrole) |
| 5 | GET | `/api/profile` | `profile.read` | all 7 | — | [3.5](#35-get-apiprofile) |
| 6 | PUT | `/api/profile` | `profile.update` | all 7 | — | [3.6](#36-put-apiprofile) |
| 7 | POST | `/api/event-requests` | `event_request.create` | EO | — | [4.1](#41-post-apievent-requests) |
| 8 | GET | `/api/event-requests` | `event_request.view` | EO | — | [4.2](#42-get-apievent-requests) |
| 9 | GET | `/api/event-requests/:eventId` | `event_request.view` | EO | — | [4.3](#43-get-apievent-requestseventid) |
| 10 | PATCH | `/api/event-requests/:eventId` | `event_request.update` | EO | — | [4.4](#44-patch-apievent-requestseventid) |
| 11 | DELETE | `/api/event-requests/:eventId` | `event_request.delete` | EO | — | [4.5](#45-delete-apievent-requestseventid) |
| 12 | PATCH | `/api/event-requests/:eventId/submit` | `event_request.submit` | EO | W7 #5 — SG2-100/SG2-87 (target `unassigned`); notices SG2-68 | [4.6](#46-patch-apievent-requestseventidsubmit) |
| 13 | GET | `/api/event-requests/assignable` | `event_request.assign_coordinator` | ECL | W7 #5 — SG2-97 (moved from TSS to ECL) | [4.7](#47-get-apievent-requestsassignable) |
| 14 | PATCH | `/api/event-requests/:eventId/coordinator` | `event_request.assign_coordinator` | ECL | W7 #5 — SG2-97; SG2-100 (`unassigned→submitted`); notices SG2-68 | [4.8](#48-patch-apievent-requestseventidcoordinator) |
| 15 | PATCH | `/api/event-requests/:eventId/review` | `event_request.review` | EC | — | [4.9](#49-patch-apievent-requestseventidreview) |
| 16 | GET | `/api/event-requests/:eventId/clarifications` | `event_request.clarify` | EC, EO | — | [4.10](#410-get-apievent-requestseventidclarifications) |
| 17 | POST | `/api/event-requests/:eventId/clarifications` | `event_request.clarify` | EC, EO | — (notice SG2-68) | [4.11](#411-post-apievent-requestseventidclarifications) |
| 18 | PATCH | `/api/event-requests/:eventId/decision` | `event_request.decide` | EC | — (notice SG2-68) | [4.12](#412-patch-apievent-requestseventiddecision) |
| 19 | PATCH | `/api/event-requests/:eventId/planning` | `event_request.planning.update` | EC | W7 #5 — SG2-90 (current assignee only) | [4.13](#413-patch-apievent-requestseventidplanning) |
| 20 | GET | `/api/event-requests/:eventId/arrangements` | `event_request.arrangements.view` | EC | New since W7 — SG2-57; W7 #3 — SG2-82 | [4.14](#414-get-apievent-requestseventidarrangements) |
| 21 | PATCH | `/api/event-requests/:eventId/confirm` | `event_request.confirm` | EC | New since W7 — SG2-58; W7 #3 — SG2-82 | [4.15](#415-patch-apievent-requestseventidconfirm) |
| 22 | GET | `/api/event-requests/:eventId/confirmation` | `event_request.confirmation.view` | EO, EC | New since W7 — SG2-58 | [4.16](#416-get-apievent-requestseventidconfirmation) |
| 23 | PATCH | `/api/event-requests/:eventId/complete` | `event_request.complete` | EC | W7 #6 — SG2-100 | [4.17](#417-patch-apievent-requestseventidcomplete) |
| 24 | GET | `/api/event-requests/:eventId/stage` | `event_request.stage.view` | EO, EC, VS, TSS, ECL, SO | W7 #5/#6 — SG2-100 (7-step lifecycle; ECL and SO added) | [4.18](#418-get-apievent-requestseventidstage) |
| 25 | GET | `/api/event-requests/:eventId/history` | `event_request.history.view` | EO, EC, VS, TSS, ECL, SO | W7 #5/#6 — SG2-97 (ECL), SG2-100 (SO) | [4.19](#419-get-apievent-requestseventidhistory) |
| 26 | GET | `/api/assignment-queue` | `event_request.queue.view` | ECL | W7 #5 — SG2-87 | [5.1](#51-get-apiassignment-queue) |
| 27 | GET | `/api/work-queue` | `work_queue.read` | EC, VS, TSS | W7 #5 — SG2-87 (unassigned events left the EC queue) | [5.2](#52-get-apiwork-queue-and-get-apiwork-queuekinditemid) |
| 28 | GET | `/api/work-queue/:kind/:itemId` | `work_queue.read` | EC, VS, TSS | W7 #5 — SG2-87 | [5.2](#52-get-apiwork-queue-and-get-apiwork-queuekinditemid) |
| 29 | GET | `/api/notifications` | `notifications.read` | EC, VS, TSS, EO, ECL | New since W7 — SG2-49; W7 #5 — ECL added by SG2-68 | [5.3](#53-get-apinotifications) |
| 30 | GET | `/api/venues` | `venues.read` | VS, EC | — | [6.1](#61-get-apivenues) |
| 31 | POST | `/api/venues` | `venues.create` | VS | — | [6.2](#62-post-apivenues) |
| 32 | PUT | `/api/venues/:venueId` | `venues.update` | VS | — | [6.3](#63-put-apivenuesvenueid) |
| 33 | GET | `/api/venues/:venueId/layouts` | `venues.layouts.read` | VS, EC | — | [6.4](#64-get-apivenuesvenueidlayouts) |
| 34 | PUT | `/api/venues/:venueId/layouts` | `venues.layouts.update` | VS | — | [6.5](#65-put-apivenuesvenueidlayouts) |
| 35 | GET | `/api/venues/:venueId/operations` | `venues.operations.read` | VS, EC, TSS | W7 #1/#6 — SG2-77 | [6.6](#66-get-apivenuesvenueidoperations) |
| 36 | PUT | `/api/venues/:venueId/operations` | `venues.operations.update` | VS | W7 #1/#6 — SG2-77 | [6.7](#67-put-apivenuesvenueidoperations) |
| 37 | GET | `/api/venues/availability` | `venues.availability.view` | EC, VS, TSS | W7 #1 — SG2-78; W7 #2 — SG2-80 | [6.8](#68-get-apivenuesavailability) |
| 38 | GET | `/api/venues/:venueId/availability` | `venues.availability.view` | EC, VS, TSS | W7 #1 — SG2-78; W7 #2 — SG2-80 | [6.9](#69-get-apivenuesvenueidavailability) |
| 39 | GET | `/api/venues/search` | `venues.search` | EC | W7 #1 — SG2-78 | [6.10](#610-get-apivenuessearch) |
| 40 | GET | `/api/venues/suitability` | `venues.suitability.view` | EC, VS, TSS, EO | — | [6.11](#611-get-apivenuessuitability) |
| 41 | GET | `/api/venues/:venueId/blocks` | `venues.blocks.manage` | VS | W7 #2 — SG2-80 | [6.12](#612-get-apivenuesvenueidblocks) |
| 42 | POST | `/api/venues/:venueId/blocks` | `venues.blocks.manage` | VS | W7 #2 — SG2-80 | [6.13](#613-post-apivenuesvenueidblocks) |
| 43 | DELETE | `/api/venues/:venueId/blocks/:blockId` | `venues.blocks.manage` | VS | — | [6.14](#614-delete-apivenuesvenueidblocksblockid) |
| 44 | POST | `/api/venue-booking-requests` | `venue_booking.request` | EC | New since W7 — SG2-48; W7 #1 — SG2-78 | [7.1](#71-post-apivenue-booking-requests) |
| 45 | GET | `/api/venue-booking-requests` | `venue_booking.request.view` | EC, VS | New since W7 — SG2-48; W7 #3 — SG2-82 | [7.2](#72-get-apivenue-booking-requests) |
| 46 | GET | `/api/venue-booking-requests/:requestId/conflicts` | `venue_booking.conflicts.view` | EC, VS | New since W7 — SG2-50; W7 #1 — SG2-78 | [7.3](#73-get-apivenue-booking-requestsrequestidconflicts) |
| 47 | POST | `/api/venue-booking-requests/:requestId/decision` | `venue_booking.decide` | VS | New since W7 — SG2-49; W7 #1 — SG2-78; W7 #3 — SG2-82 | [7.4](#74-post-apivenue-booking-requestsrequestiddecision) |
| 48 | POST | `/api/venue-booking-requests/:requestId/withdraw` | `venue_booking.withdraw` | EC | W7 #3 — SG2-82 | [7.5](#75-post-apivenue-booking-requestsrequestidwithdraw) |
| 49 | GET | `/api/venue-booking-requests/:requestId/suitability` | `venues.suitability.view` | EC, VS, TSS, EO | — | [7.6](#76-get-apivenue-booking-requestsrequestidsuitability) |
| 50 | POST | `/api/venue-booking-requests/:requestId/capacity-exception` | `venue_booking.capacity_exception.approve` | VS | SG2-66 AC5 | [7.7](#77-post-apivenue-booking-requestsrequestidcapacity-exception) |
| 51 | GET | `/api/venue-holds` | `venues.holds.read` | EC, VS, TSS | W7 #4 — SG2-84/85 | [8.1](#81-get-apivenue-holds) |
| 52 | GET | `/api/venue-holds/options` | `venues.holds.manage` | VS | W7 #4 — SG2-84 | [8.2](#82-get-apivenue-holdsoptions) |
| 53 | GET | `/api/venue-holds/notifications` | `venues.holds.read` | EC, VS, TSS | W7 #4 — SG2-84/85 | [8.3](#83-get-apivenue-holdsnotifications) |
| 54 | POST | `/api/venue-holds` | `venues.holds.manage` | VS | W7 #4 — SG2-84; W7 #1 — SG2-78 | [8.4](#84-post-apivenue-holds) |
| 55 | POST | `/api/venue-holds/:holdId/release` | `venues.holds.manage` | VS | W7 #4 — SG2-84 | [8.5](#85-post-apivenue-holdsholdidrelease) |
| 56 | POST | `/api/venue-holds/:holdId/convert` | `venues.holds.manage` | VS | W7 #4 — SG2-84/85; W7 #1 — SG2-78 | [8.6](#86-post-apivenue-holdsholdidconvert) |
| 57 | GET | `/api/venue-bookings` | `venue_bookings.view` (+ `venue_bookings.by_venue` for `?venue_id`) | VS, EC (by venue: VS) | New since W7 — SG2-51 | [8.7](#87-get-apivenue-bookings) |
| 58 | POST | `/api/venue-bookings/:bookingId/release` | `venue_bookings.release` | EC (VS until SG2-83) | New since W7 — SG2-51; W7 #3 — SG2-82, SG2-83 | [8.8](#88-post-apivenue-bookingsbookingidrelease) |
| 59 | GET | `/api/venue-clashes` | `venue_clashes.view` | VS, EC | W7 #1 — SG2-79 | [8.9](#89-get-apivenue-clashes) |
| 60 | GET | `/api/equipment` | `equipment.read` | TSS | New since W7 — SG2-52 | [9.1](#91-get-apiequipment) |
| 61 | POST | `/api/equipment` | `equipment.create` | TSS | New since W7 — SG2-52 | [9.2](#92-post-apiequipment) |
| 62 | PATCH | `/api/equipment/:equipmentId` | `equipment.update` | TSS | New since W7 — SG2-52 | [9.3](#93-patch-apiequipmentequipmentid) |
| 63 | GET | `/api/equipment-requests` | `equipment_requirements.read` | EC, TSS, SO | New since W7 — SG2-53 (SO grant for SG2-91) | [9.4](#94-get-apiequipment-requests) |
| 64 | POST | `/api/equipment-requests` | `equipment_requirements.request` | EC | New since W7 — SG2-53 | [9.5](#95-post-apiequipment-requests) |
| 65 | PATCH | `/api/equipment-requests/:requestId` | `equipment_requirements.request` | EC | New since W7 — SG2-53 | [9.6](#96-patch-apiequipment-requestsrequestid) |
| 66 | PATCH | `/api/equipment-requests/:requestId/arrangement` | `equipment_requirements.arrange` | TSS | New since W7 — SG2-53 | [9.7](#97-patch-apiequipment-requestsrequestidarrangement) |
| 67 | GET | `/api/equipment-requests/:requestId/availability` | `equipment.availability.read` | TSS | New since W7 — SG2-54 | [9.8](#98-get-apiequipment-requestsrequestidavailability) |
| 68 | POST | `/api/equipment-requests/:requestId/reservation` | `equipment.reservations.manage` | TSS | New since W7 — SG2-55 | [9.9](#99-post-apiequipment-requestsrequestidreservation) |
| 69 | GET | `/api/equipment-reservations` | `equipment_requirements.read` | EC, TSS, SO | New since W7 — SG2-55 | [9.10](#910-get-apiequipment-reservations) |
| 70 | GET | `/health` | public | anyone | — | [10.1](#101-get-health-and-get-apihealth) |
| 71 | GET | `/api/health` | public | anyone | — | [10.1](#101-get-health-and-get-apihealth) |
| 72 | GET | `/health/db` | public | anyone | — | [10.2](#102-get-healthdb-and-get-apihealthdb) |
| 73 | GET | `/api/health/db` | public | anyone | — | [10.2](#102-get-healthdb-and-get-apihealthdb) |
| 74 | GET | `/api/venue-booking-requests/capacity-exceptions` | `venue_booking.capacity_exception.approve` | VS | SG2-47 reachability repair; SG2-66 AC2/AC5 | [7.8](#78-get-apivenue-booking-requestscapacity-exceptions) |
| 75 | GET | `/api/event-requests/:eventId/registrations` | `event_request.registrations.view` | EO, EC | Sprint 4 — SG2-63 (waiting list: SG2-61) | [4.13a](#413a-sg2-63-registration-picture-and-settings) |
| 76 | PATCH | `/api/event-requests/:eventId/registration-settings` | `event_request.registration_settings.update` | EO | Sprint 4 — SG2-63 | [4.13a](#413a-sg2-63-registration-picture-and-settings) |
| 77 | POST | `/api/event-requests/:eventId/registration-settings/close` | `event_request.registration_settings.update` | EO | Sprint 4 — SG2-63 | [4.13a](#413a-sg2-63-registration-picture-and-settings) |
| 78 | POST | `/api/event-requests/:eventId/cancellation-request` | `event_request.cancellation.request` | EO | Sprint 4 — SG2-67 | [4.20](#420-post-apievent-requestseventidcancellation-request) |
| 79 | PATCH | `/api/event-requests/:eventId/cancel` | `event_request.cancel` | EC | Sprint 4 — SG2-67; equipment released by SG2-56 | [4.21](#421-patch-apievent-requestseventidcancel) |
| 80 | POST | `/api/event-requests/:eventId/change-requests` | `event_request.change_request.raise` | EO | Sprint 4 — SG2-64 | [4.22](#422-post-and-get-apievent-requestseventidchange-requests) |
| 81 | GET | `/api/event-requests/:eventId/change-requests` | `event_request.change_request.view` | EC, EO | Sprint 4 — SG2-64 (organiser), SG2-66 (coordinator) | [4.22](#422-post-and-get-apievent-requestseventidchange-requests) |
| 82 | POST | `/api/event-requests/:eventId/change-requests/:changeRequestId/accept` | `event_request.change_request.accept` | EC | Sprint 4 — SG2-66, SG2-65 | [4.23](#423-post-apievent-requestseventidchange-requestschangerequestidaccept) |
| 83 | POST | `/api/event-requests/:eventId/change-requests/:changeRequestId/refuse` | `event_request.change_request.refuse` | EC | Sprint 4 — SG2-65 | [4.24](#424-post-apievent-requestseventidchange-requestschangerequestidrefuse) |
| 84 | POST | `/api/event-requests/:eventId/rechecks/:key/settle` | `event_request.rechecks.settle` | EC | Sprint 4 — SG2-66; safety keys SG2-93 | [4.25](#425-post-apievent-requestseventidrecheckskeysettle) |
| 85 | POST | `/api/event-requests/:eventId/safety-decision` | `event_request.safety_decision.record` | SO | W7 #6 — SG2-92, SG2-93 | [4.26](#426-post-apievent-requestseventidsafety-decision) |
| 86 | GET | `/api/event-requests/:eventId/safety-decisions` | `event_request.safety_decisions.view` | SO, EC, EO | W7 #6 — SG2-92, SG2-93 | [4.27](#427-get-apievent-requestseventidsafety-decisions) |
| 87 | POST | `/api/event-requests/:eventId/rework` | `event_request.safety_rework` | EC | W7 #6 — SG2-92 | [4.28](#428-post-apievent-requestseventidrework) |
| 88 | GET | `/api/coordinator-overview` | `event_request.oversight.view` | ECL | W7 #5 — SG2-89 | [5.4](#54-get-apicoordinator-overview) |
| 89 | GET | `/api/safety-checks` | `safety_checks.read` | SO | W7 #6 — SG2-91 | [5.5](#55-get-apisafety-checks) |
| 90 | GET | `/api/safety-rereviews` | `safety_rereviews.read` | VS, TSS | W7 #6 — SG2-93 | [5.6](#56-get-apisafety-rereviews) |
| 91 | POST | `/api/safety-rereviews/:reviewId/confirm` | `safety_rereviews.confirm` | VS, TSS | W7 #6 — SG2-93 | [5.7](#57-post-apisafety-rereviewsreviewidconfirm) |
| 92 | GET | `/api/notifications/inbox` | `notifications.inbox` | all 7 | Sprint 4 — SG2-69 | [5.8](#58-get-apinotificationsinbox) |
| 93 | POST | `/api/notifications/read-all` | `notifications.inbox` | all 7 | Sprint 4 — SG2-69 | [5.9](#59-post-apinotificationsread-all) |
| 94 | GET | `/api/notifications/reminder-preferences` | `notifications.reminders.manage` | EC | Sprint 4 — SG2-69 | [5.10](#510-get-and-put-apinotificationsreminder-preferences) |
| 95 | PUT | `/api/notifications/reminder-preferences` | `notifications.reminders.manage` | EC | Sprint 4 — SG2-69 | [5.10](#510-get-and-put-apinotificationsreminder-preferences) |
| 96 | POST | `/api/notifications/:source/:id/read` | `notifications.inbox` | all 7 | Sprint 4 — SG2-69 | [5.11](#511-post-apinotificationssourceidread) |
| 97 | GET | `/api/notifications/:source/:id/event` | `notifications.inbox` | all 7 | Sprint 4 — SG2-69 | [5.12](#512-get-apinotificationssourceidevent) |
| 98 | DELETE | `/api/venues/:venueId` | `venues.delete` | VS | Sprint 4 — SG2-106 | [6.3a](#63a-delete-apivenuesvenueid) |
| 99 | POST | `/api/venue-holds/:holdId/expiry` | `venues.holds.manage` | VS | W7 #4 — SG2-106 | [8.6a](#86a-post-apivenue-holdsholdidexpiry) |
| 100 | GET | `/api/event-search` | `events.search` | EC, VS, TSS, ECL, SO | Sprint 4 — SG2-70 | [9A.1](#9a1-get-apievent-search) |
| 101 | GET | `/api/event-search/options` | `events.search` | EC, VS, TSS, ECL, SO | Sprint 4 — SG2-70 | [9A.2](#9a2-get-apievent-searchoptions) |
| 102 | GET | `/api/registrable-events` | `events.registrable.read` | ATT | Sprint 4 — SG2-59 | [9B.1](#9b1-get-apiregistrable-events) |
| 103 | GET | `/api/registrable-events/:eventId` | `events.registrable.read` | ATT | Sprint 4 — SG2-59 | [9B.2](#9b2-get-apiregistrable-eventseventid) |
| 104 | POST | `/api/registrable-events/:eventId/registrations` | `events.register` | ATT | Sprint 4 — SG2-60 | [9B.3](#9b3-post-apiregistrable-eventseventidregistrations-sg2-60) |
| 105 | POST | `/api/registrable-events/:eventId/waiting-list` | `events.register` | ATT | Sprint 4 — SG2-61 | [9B.6](#9b6-post-and-delete-apiregistrable-eventseventidwaiting-list-sg2-61) |
| 106 | DELETE | `/api/registrable-events/:eventId/waiting-list` | `events.register` | ATT | Sprint 4 — SG2-61 | [9B.6](#9b6-post-and-delete-apiregistrable-eventseventidwaiting-list-sg2-61) |
| 107 | GET | `/api/my-registrations` | `registrations.mine.read` | ATT | Sprint 4 — SG2-62 | [9B.4](#9b4-get-apimy-registrations-sg2-62) |
| 108 | POST | `/api/my-registrations/:registrationId/withdrawal` | `registrations.withdraw` | ATT | Sprint 4 — SG2-62 | [9B.5](#9b5-post-apimy-registrationsregistrationidwithdrawal-sg2-62) |

### What each role can call today
- **ATT:** rows 3, 5 and 6 (`/api/auth/me`, `/api/profile`), rows 92 to 97 other than 94 and 95 (the notification inbox; every role holds `notifications.inbox`), and rows 102 to 108 (find, register for and withdraw from events, and the waiting list), plus the public endpoints.
- **SO (Week 7):**
  - rows 24 and 25 (stage, history)
  - rows 63 and 69 (equipment requirements and reservations, read-only)
  - rows 85 and 86 (record and read safety decisions) and row 89 (the safety check list)
  - rows 100 and 101 (event search)
  - the inbox (rows 92, 93, 96, 97), profile and me
  - it does not hold `notifications.read` (row 29)
- **ECL (Week 7):**
  - rows 13 and 14 (assignable, assign/reassign)
  - row 26 (unassigned queue) and row 88 (coordinator overview)
  - rows 24, 25 and 29 (stage, history, notifications)
  - rows 100 and 101 (event search)
  - the inbox (rows 92, 93, 96, 97), profile and me

### Mount order that matters
- **`/api/event-requests/assignable`** is registered before `/:eventId`. Otherwise `/:eventId` would capture `assignable` as an id.
- **`/:eventId/complete`, `/:eventId/confirm`, `/:eventId/cancellation-request` and `/:eventId/cancel`** are registered before `PATCH /:eventId` (`app.ts:247-284`). `/assignable` is registered before `GET /:eventId`.
- **`POST /api/equipment-requests/:requestId/reservation`** is matched by the reservations router mounted at `/api` (`app.ts:145`). That mount comes before the two routers at `/api/equipment-requests` (`app.ts:146-147`).
- **Several routers share the `/api/venues` prefix:** availability, search, suitability, venues, layouts, operations and blocks. Each is a `protectedRouter`, so a request to one path runs `requireAuth` once per router it passes through.

---

## 3. Auth, accounts and profile

### 3.1 POST /api/auth/login
- **Source:** `app.ts:123`; `auth/login.ts`.
- **Callers:** anyone. Rate-limited per IP to 10 attempts per 15 minutes (`express-rate-limit`, `standardHeaders`). `trust proxy` is set to 1 for Vercel.
- **Body:** `{ email: string, password: string }`. Both must be non-empty; `email` is trimmed.
- **200:** `{ accessToken, user: { userId, email, role, roles } }`. `role` is the display form of the role the account starts acting as, e.g. `"Event Organiser"`: its only role, else the least-privileged one it holds (SG2-104). `roles` lists every role held, in display form. No refresh token is returned.
- **Errors:**
  - 401 `Invalid email or password.`
  - 403 `Your account setup is incomplete. Contact support.` (no role)
  - 429 `Too many sign-in attempts. Please try again later.`
  - 503 `Sign-in is temporarily unavailable. Please try again later.`
- **Data:** Supabase Auth `signInWithPassword`, then `account_roles`.
- **Accounts:** there is no self-registration endpoint; accounts are seeded (`app.ts:120-122`).

### 3.2 POST /api/auth/logout
- **Source:** `app.ts:124`; `auth/logout.ts`.
- **Callers:** anyone. The route is not behind `requireAuth`.
- **Request:** the token comes from the Bearer header only; there is no body.
- **200:** `{ message: "Signed out." }`. Also returned straight away, without calling Supabase, when there is no Bearer header.
- **Errors:** 503 `Unable to confirm server sign-out.`
- **Data:** Supabase Auth admin `signOut(token, 'local')`, which uses the service role.

### 3.3 GET /api/auth/me
- **Source:** `app.ts:125` (`access.router`); `auth/index.ts:63-67`.
- **Callers:** any authenticated account. There is no permission key.
- **200:** `{ userId, role, roles, permissions: string[] }`. `role` is the stored snake_case acting role (the `X-Acting-Role` header, else the default); `roles` is every role the account holds (SG2-104); `permissions` lists every `PERMISSIONS` key granted to the acting role. The client uses this list to decide which actions to show.
- **Errors:** common errors only.

### 3.4 PATCH /api/users/:userId/role
- **Source:** `app.ts:154-156`; `auth/roles.ts`.
- **Permission:** `users.role.update` (TSS).
- **Body:** `{ role }`. Must be a display role name, matched exactly: `Event Organiser`, `Event Coordinator`, `Venue Staff`, `Technical Support Staff`, `Attendee`, `Event Coordinator Lead` or `Safety Officer`. SG2-104: the account's **whole** role set is replaced by that one role (`auth/roles.ts`, `changeAccountRoles`); extra roles are granted in SQL.
- **200:** `{ message: "Role updated.", roles: string[] }`, the display names now held.
- **Errors:**
  - 400 `A target role is required.` / `Not a recognised role.`
  - 403 `You cannot change the roles on your own account.` (separation of duties, checked in the handler and again in the database) / `Only Technical Support Staff can change roles.`
  - 404 `No account with that id.`
  - 409 `An account must keep at least one role.`
  - 503 `Service temporarily unavailable. Please try again later.` / `Could not update the role. Please try again later.`
- **Data:** updates `account_roles` through the service-role client. `userId` is not format-checked.

### 3.5 GET /api/profile
- **Source:** `app.ts:273`; `profile/index.ts:89`.
- **Permission:** `profile.read` (all 7 roles).
- **200:** `{ profile: { user_id, name, organisation, phone, communication_preferences, department } }`. `department` is omitted for the external roles (EO, ATT); see `INTERNAL_ROLES` in `policy.ts`.
- **Errors:**
  - 409 `Your account is not fully set up yet. Please contact support.` (no `users` row)
  - 503 `Your profile is temporarily unavailable. Please try again later.`
- **Data:** the caller's own row in `users`, read with the service-role client.

### 3.6 PUT /api/profile
- **Source:** `profile/index.ts:90`; validation in `profile/fields.ts`.
- **Permission:** `profile.update` (all 7 roles).
- **Body** (full replace):
  - `name`: required, at most 200 characters.
  - `phone`: optional; a Singapore number, `^(?:\+65)?[0-9]{8}$` once separators are stripped.
  - `communication_preferences`: optional; a subset of `email`, `sms`, `phone_call`.
  - `department`: optional, at most 150 characters; internal roles only, ignored for EO and ATT.
- **200:** `{ profile }`, the same shape as GET.
- **Errors:**
  - 400 `{ error: "Invalid profile details", details: string[] }`
  - 409 not set up
  - 503

---

## 4. Event requests

All of these are mounted on one `protectedRouter` at `/api/event-requests` (`app.ts:158-265`). The event handlers use the **service-role client**, so the per-row checks below are enforced in the handler or in guarded `UPDATE` predicates, not by RLS.

The one exception is `confirm` (4.15), which runs an RPC as the caller.

`eventId` must be a positive integer, otherwise 400 `eventId must be a positive integer.` Unless stated otherwise, 503 means `Event requests are temporarily unavailable. Please try again later.`

**Shared record shapes** (`server/src/db/eventRequests.ts`):
- **DraftRecord:**
  - identity and status: `event_id, organiser_id, organisation, status`
  - details: `name, purpose, description, proposed_date, expected_attendance`
  - requirements: `venue_requirements, preferred_layout, accessibility_needs, equipment_requirements, registration_needed`
  - kind: `category` (SG2-70)
- **DetailRecord:** DraftRecord plus:
  - assignment: `coordinator_id, coordinator_name`
  - decision and completion: `decided_at, decision_reason, completed_by, completed_at`
  - `ends_at` (latest confirmed booking end)

### 4.1 POST /api/event-requests
- **Source:** `app.ts:160`; `events/createDraft.ts`.
- **Permission:** `event_request.create` (EO).
- **Body:** every field is optional and nullable.
  - `name`: at most 255 characters
  - `purpose`, `description`, `venue_requirements`, `preferred_layout`, `accessibility_needs`, `equipment_requirements`: each at most 5000 characters
  - `proposed_date`: ISO date-time
  - `expected_attendance`: integer from 1 to 2147483647
  - `registration_needed`: boolean
  - `category` (SG2-70): one of `conference`, `workshop`, `seminar`, `training`, `networking`, `social`, `other`
- **201:** `{ request: DraftRecord, missingForSubmission: string[] }`. `status` is `draft`; `organiser_id` and `organisation` come from the caller.
- **Errors:**
  - 400 `{ error: "Invalid event request details", details[] }`
  - 403 `Your account needs a client organisation before you can create event requests. Please contact support.`
  - 503
- **Data:** `users`, then an insert into `events`.

### 4.2 GET /api/event-requests
- **Source:** `app.ts:162`; `events/list.ts`.
- **Permission:** `event_request.view` (EO).
- **Query:**
  - `scope`: `organisation` (default) or `mine`
  - `status`: optional; `all`, or a value of `EVENT_STATUSES`, which includes the Week 7 statuses
- **200:** `{ requests: [{ event_id, name, proposed_date, status, coordinator_id, coordinator_name, can_manage }] }`, newest first.
- **Errors:** 400 `Invalid event scope.` / `Invalid status filter.`; 403; 503.
- **Rule:** returns events in the caller's organisation. A caller with no organisation gets `[]`.

### 4.3 GET /api/event-requests/:eventId
- **Source:** `app.ts:258`; `events/list.ts`.
- **Permission:** `event_request.view` (EO).
- **200:** `{ request }`. The record carries:
  - DetailRecord columns, plus `coordinator_phone` and `can_manage`
  - the raw embeds `coordinator { name, phone }` and `venue_bookings [{ ends_at, status }]`
- **Errors:** 404 `No event request found for this account.`; 503.
- **Rule:** any EO in the same organisation can read it.

### 4.4 PATCH /api/event-requests/:eventId
- **Source:** `events/updateDraft.ts` (`createUpdateEventDraftHandler`), `db/eventRequests.ts` (`updateEventRequestDraft`), migration `202610170003_event_draft_change_history.sql` (`update_event_request_draft`).
- **Permission:** `event_request.update` (EO).
- **Body:** the same eleven fields as 4.1, as a **full replace**: omitted fields become null. Incomplete drafts remain valid; malformed values are rejected. Status, ownership and actor fields supplied in the HTTP body are ignored by the existing validator.
- **200:** `{ request: DraftRecord, missingForSubmission }`. The DraftRecord shape is unchanged; this endpoint does not submit a request.
- **Errors:**
  - 400 `{ error: "Invalid event request details", details[] }` for HTTP validation; a private RPC validation refusal returns the same error without details.
  - 404 `No event request found for this account.` for a missing event, wrong creator or changed organisation membership.
  - 409 `Only a draft or returned event request can be edited.` if the status is no longer editable, including a change after the initial lookup.
  - 503 generic service error if storage or audit insertion fails; private database errors are not exposed.
- **Atomic write:** the service-only RPC `update_event_request_draft(p_event_id integer, p_actor_id uuid, p_values jsonb)` rechecks the actor's current EO role, exact nonblank organisation membership, creator ownership and `draft` / `needs_clarification` status. It locks the event before changing the eleven fields (`preferred_layout` added by migration `202610200001_event_preferred_layout.sql`, SG2-105; `category` by `202610200005_event_search.sql`, SG2-70, which also refuses a category outside the list). The actor comes from the verified principal, never the body. Only `service_role` can execute; `PUBLIC`, `anon` and `authenticated` cannot call it directly.
- **History:** the same transaction inserts one `event_audit_logs` row per actual changed field with verified actor, old/new values and a common save time. An audit failure rolls back the draft update. Unchanged saves, including equivalent timestamp offsets, add no history. Null remains null; numeric and boolean values are stored as text; dates use canonical UTC timestamp text. History reads still apply the existing owner/internal-field visibility rules.
- **Internal result:** JSON object `{ outcome: "updated", request }` or `{ outcome: "not_found"|"not_editable"|"invalid" }`; the adapter maps these to the public response above. A successful earlier precheck cannot override a later locked refusal.
- **Limits:** only the existing draft/clarification edit path is repaired. This adds no rejected-request rework policy and does not reconstruct edits made before the migration.

### 4.5 DELETE /api/event-requests/:eventId
- **Source:** `app.ts:215-219`; `events/deleteDraft.ts`.
- **Permission:** `event_request.delete` (EO).
- **200:** `{ message: "Draft deleted." }`
- **Errors:** 404; 409 `Only a draft event request can be deleted.`; 503.
- **Rule:** only the creating EO, and only while the status is `draft`. The guard is in the `DELETE` itself.

### 4.6 PATCH /api/event-requests/:eventId/submit
- **Week 7:** #5 — SG2-100, SG2-87. Notices SG2-68.
- **Source:** `app.ts:164-168`; `events/submit.ts`.
- **Permission:** `event_request.submit` (EO).
- **Body:** none.
- **200:** `{ request: DraftRecord }`. The new status is:
  - `unassigned` when the event has no coordinator; it then waits in the ECL's queue
  - `submitted` when a coordinator already holds it (a resubmission after `needs_clarification` or `rejected`)

  `submitted_at` is set.
- **Errors:**
  - 400 `{ error: "Event request is missing required fields.", missing[] }`, or `{ error: "proposed_date must be in the future.", missing: ["proposed_date_in_past"] }` when a past date is the only item
  - 404
  - 409 `Only a draft or rejected event request can be submitted.`
  - 503
- **Rule:** only the creating EO; status must be `draft`, `rejected` or `needs_clarification`.
- **Required to submit (SG2-105):** `name`, `purpose`, `description`, `proposed_date`, `expected_attendance`, `venue_requirements`, `preferred_layout`, `accessibility_needs`, `equipment_requirements` and `registration_needed`. Accessibility and equipment may be `"None"` but not blank; `registration_needed: false` is an answer. `missing[]` lists every one still blank and the request stays as it was. Requests already submitted are not rechecked. SG2-70's `category` is optional and not part of this list.
- **Future date (SG2-30 AC2):** a `proposed_date` at or before the server's current time adds `proposed_date_in_past` to `missing[]` (after any blank fields) and the submission is refused the same way. Saving a draft still accepts it; the create and update responses list the same item in `missingForSubmission`.
- **Side effects:**
  - an `event_audit_logs` status row
  - `notifications` of kind `event_submitted`: to every ECL when the status is `unassigned`, otherwise to the coordinator
- **Not atomic:** the status write happens first, so a 503 from the history or notice write can follow a status change that has already been saved.

### 4.7 GET /api/event-requests/assignable
- **Week 7:** #5 — SG2-97.
- **Source:** `app.ts:252-256`; `events/listAssignable.ts`.
- **Permission:** `event_request.assign_coordinator` (ECL). SG2-97 moved this grant from TSS.
- **200:** `{ requests: [{ event_id, name, organisation, status, coordinator_id, coordinator_name }], coordinators: [{ user_id, name }] }`
  - `requests`: every organisation, statuses in `COORDINATOR_ASSIGNABLE_STATUSES`
  - `coordinators`: every EC account
- **Errors:** 503.

### 4.8 PATCH /api/event-requests/:eventId/coordinator
- **Week 7:** #5 — SG2-97; SG2-100; notices SG2-68.
- **Source:** `app.ts:260-264`; `events/assignCoordinator.ts`.
- **Permission:** `event_request.assign_coordinator` (ECL).
- **Body:** `{ coordinatorId: string }`
- **200:** `{ request: DetailRecord }`. If `coordinatorId` already holds the event, the call writes nothing and returns 200.
- **Errors:**
  - 400 `coordinatorId is required.` / `No account exists with the given coordinatorId.` / `coordinatorId must belong to an Event Coordinator account.`
  - 404 `No event request found with that id.`
  - 409 `A coordinator can only be assigned to a submitted request that is not yet closed out.`
  - 409 `This request changed while you were assigning it. Reload the list and try again.`
  - 503
- **Rule:** this is both **assign and reassign**. Assignable statuses are `unassigned`, `submitted`, `under_review`, `approved`, `planning`, `awaiting_safety_check`, `safety_rejected`, `preparation` and `confirmed`. The first assignment moves the status `unassigned → submitted`; a reassignment leaves the status alone. The update is guarded on the expected current `coordinator_id`.
- **Side effects:**
  - history rows: `coordinator_id`, plus the status row on a first assignment
  - `coordinator_assigned` notices to the new coordinator, the organiser and the previous coordinator; the actor is excluded
  - If the history write fails, the assignment is rolled back and the call returns 503. If the notice write fails, it returns 503 but the assignment stands.

### 4.9 PATCH /api/event-requests/:eventId/review
- **Source:** `app.ts:170-174`; `events/review.ts`.
- **Permission:** `event_request.review` (EC).
- **200:** `{ request: DetailRecord }` with status `under_review`. Idempotent.
- **Errors:** 404 `No reviewable event request is assigned to this account.`; 503.
- **Rule:** only the assigned EC, from `submitted` (or already `under_review`).
- **Side effect:** a history row.

### 4.10 GET /api/event-requests/:eventId/clarifications
- **Source:** `app.ts:182-186`; `events/clarifications.ts`.
- **Permission:** `event_request.clarify` (EC, EO).
- **200:** `{ clarifications: [{ clarification_id, event_id, sender_id, sender_name, message, created_at }], status }`
- **Errors:** 404 `No event request found for this account.`; 503.
- **Rule:** only the assigned EC or the creating EO.

### 4.11 POST /api/event-requests/:eventId/clarifications
- **Source:** `app.ts:187-191`; `events/clarifications.ts`.
- **Permission:** `event_request.clarify` (EC, EO).
- **Body:** `{ message }`, at most 5000 characters.
- **201:** `{ clarification, status }`
- **Errors:**
  - 400 `message must be text.` / `A message is required.` / `message must be 5000 characters or fewer.`
  - 404
  - 503
- **Rule:** same participants as 4.10. When the assigned EC posts while the event is `under_review`:
  - the status moves to `needs_clarification`
  - a history row is written
  - a `clarification_requested` notice goes to the organiser (SG2-68)

### 4.12 PATCH /api/event-requests/:eventId/decision
- **Source:** `app.ts:193-197`; `events/decide.ts`.
- **Permission:** `event_request.decide` (EC).
- **Body:** `{ decision: "approved"|"rejected", reason? }`. `reason` is at most 5000 characters and is required when rejecting.
- **200:** `{ request: DetailRecord }`
- **Errors:**
  - 400 (decision or reason messages)
  - 404 `No event request under review is assigned to this account.`
  - 503
- **Rule:** only the assigned EC, and only from `under_review`.
- **Side effects:** a history row, and an `event_approved` or `event_rejected` notice to the organiser (SG2-68).

### 4.13 PATCH /api/event-requests/:eventId/planning
- **Week 7:** #5 — SG2-90.
- **Source:** `app.ts:176-180`; `events/updatePlanning.ts`.
- **Permission:** `event_request.planning.update` (EC).
- **Body** (partial update):
  - `expected_attendance`, `proposed_date`
  - `venue_requirements`, `equipment_requirements`, `accessibility_needs`, `planning_notes`
  - `registration_needed`
  - `confirm_impact`
- **SG2-63 AC8:** `registration_capacity`, `registration_opens_at` and `registration_closes_at` are the organiser's (§4.13a); a body carrying any of them is refused 403 `{ error: "Registration capacity and opening and closing times are set by the Event Organiser.", fields[] }` before anything is read.
- **Schedule rules:**
  - a changed date must be in the future
  - the stored registration opening and closing times must still be before the event
- **200:** `{ event: PlanningRecord, arrangements_recheck_needed, outstanding_arrangements[] }`. The status becomes `planning` when it was `approved` or when an arrangement impact is confirmed.
- **SG2-66 AC6:** on a `confirmed` or `preparation` event only `registration_needed` and `planning_notes` may change; unchanged values are ignored.
- **Errors:**
  - 400 `{ error: "Invalid planning details", details[] }`
  - 403 `Only the assigned event coordinator can update planning details.`
  - 404 `Event request not found.`
  - 409 `Cannot update planning information for a <status> event.`
  - 409 `{ error: "Arrangements require rechecking.", requires_confirmation: true, affected_arrangements[], impact_notes[] }`
  - 409 `{ error: "This event is <Confirmed|in Preparation>, so its details can no longer be edited directly. …", code: "change_request_required", fields[] }` (SG2-66 AC6)
  - 409 `This event is no longer assigned to you. Refresh and try again.` (SG2-90: the guarded update matched no row)
  - 503
- **Side effect:** one history row per audited field. `planning_notes` rows are internal-only. A move from `awaiting_safety_check`, `preparation` or `confirmed` back to `planning` clears `confirmed_by`/`confirmed_at` and sends `event_returned_to_planning` notices to the organiser and the coordinator (SG2-66 AC7; 503 if they cannot be stored).


### 4.13a SG2-63 registration picture and settings
- **Source:** `events/registrationRoutes.ts`, `events/registrationSettings.ts`, `db/registrations.ts`; migration `202610200004_event_registration_settings.sql`. See [Registrations](../registrations.md).
- **GET /api/event-requests/:eventId/registrations** — permission `event_request.registrations.view` (EO, EC). An organiser of the event's organisation or its assigned coordinator; anyone else gets 404.
  - **200:** `{ event_id, name, status, registration_needed, registration_capacity, registration_opens_at, registration_closes_at, window, registered_count, places_remaining, contact_details_visible, attendees[], venues[], capacity_warnings[], can_edit }`. `window` is SG2-58's `not_required | not_confirmed | not_yet_open | open | closed`. Each attendee has `registration_id, name, organisation, registered_at`, plus `email` and `phone` only when `contact_details_visible` (the creating organiser and the assigned coordinator).
- **PATCH /api/event-requests/:eventId/registration-settings** — permission `event_request.registration_settings.update` (EO); the creating organiser only (403 otherwise).
  - **Body:** any of `registration_capacity` (1–2147483647 or null), `registration_opens_at`, `registration_closes_at` (ISO date-time or null). Nothing else.
  - **Rules:** closes after it opens; a new closing time is in the future; both before the event starts; capacity not below the registrations already held; none of the three cleared once the event is confirmed; allowed in any status but completed, cancelled or rejected, and only before the event starts. A capacity above a booked venue is allowed and returned in `capacity_warnings`.
  - **200:** the registration picture as it now stands.
- **POST /api/event-requests/:eventId/registration-settings/close** — same permission; closes open registration now.
- **Errors:** 400 `{ error: "Invalid registration settings", details[] }`; 403; 404 `Event not found.`; 409 for a closed event (`status`), no registration, an event that has started, closing registration that is not open, or a registration arriving between the check and the write (`registered`); 503.
- **Side effects:** one `event_audit_logs` row per changed setting; a `registration_opened` or `registration_closed` notice to the organiser and the assigned coordinator when a confirmed event's registration opens or closes, including on schedule (`process_registration_windows()`, every minute through pg_cron).

### 4.14 GET /api/event-requests/:eventId/arrangements
- **Week 7:** New since W7 — SG2-57; #3 — SG2-82.
- **Source:** `app.ts:233-237`; `events/getArrangements.ts`, `events/arrangementReadiness.ts`.
- **Permission:** `event_request.arrangements.view` (EC).
- **200:** `{ event_id, arrangements: [{ key: "venue"|"equipment"|"registration"|"safety", label, state: "ready"|"outstanding"|"not_required", detail }], outstanding[], ready_for_confirmation, venue_requested }`
- **Errors:**
  - 403 `Only the assigned event coordinator can view these arrangements.`
  - 404 `Event not found.`
  - 503
- **Rule:** only the assigned EC. Since SG2-82, venue readiness covers **every** non-cancelled venue request: a pending, rejected or unbooked request is outstanding. SG2-81 additionally counts affected confirmed bookings as outstanding. Persisted `arrangements_recheck_needed` with `venue_recheck`, `equipment_recheck` or `registration_recheck` keeps the corresponding arrangement outstanding even when its booking/receipt data exists. SG2-94: registration with unset settings is `ready` (AC6), and a fourth item, `safety` ("Safety check"), is `ready` only for an event in Preparation or Confirmed whose latest safety decision is Approve, otherwise `outstanding` with the reason (AC4/AC5).

### 4.15 PATCH /api/event-requests/:eventId/confirm
- **Week 7:** New since W7 — SG2-58; #3 — SG2-82.
- **Source:** `app.ts:209-213`; `events/confirm.ts`.
- **Permission:** `event_request.confirm` (EC).
- **Body:** none.
- **200:** `{ event_id, status: "confirmed", confirmed_at, organiser_notified }`
- **Errors:**
  - 404 `No event in preparation is assigned to this account.`
  - 409 `{ error: "Only an event in Preparation can be confirmed.", code: "closed" }`
  - 409 `{ error: "Confirmation refused: arrangements are still outstanding.", code: "outstanding", outstanding[] }`
  - 401/403/503 mapped from the RPC
- **Data:** RPC `confirm_event(p_event_id)`, run as the caller. The latest definition is in `202610220001_safety_approval_gate.sql` (SG2-94). Under `for update` the RPC:
  - rechecks the caller's role and assignment
  - answers an event in `approved`, `planning`, `awaiting_safety_check` or `safety_rejected` with `outstanding` (the safety check included) and any other status but `preparation` with `closed`
  - refuses affected bookings, pending/rejected/unbooked venue requests, unmet equipment needs, persisted venue/equipment/registration rechecks and a missing safety approval (`safety`, SG2-94 AC5); unset registration settings no longer block (AC6); refusal changes no event, booking, receipt, history or notification
  - writes the status, a history row and an `event_confirmed` notice
- **Note:** the only way into `preparation` is the Safety Officer's Approve (`POST /api/event-requests/:eventId/safety-decision`); the `safety_approval_gate` trigger refuses any other move (SG2-94 AC1).

### 4.16 GET /api/event-requests/:eventId/confirmation
- **Week 7:** New since W7 — SG2-58.
- **Source:** `app.ts:239-243`; `events/getConfirmation.ts`.
- **Permission:** `event_request.confirmation.view` (EO, EC).
- **200:** `{ event_id, status, confirmed_at, venues: [{ venue_name, starts_at, ends_at }], equipment: [{ equipment_type, quantity_reserved }], registration: { needed, capacity, opens_at, closes_at, window } }`
- **Errors:** 404 `No confirmed event was found for this account.`; 503.
- **Rule:** only the creating EO or the assigned EC, and only for a `confirmed` or `completed` event.

### 4.17 PATCH /api/event-requests/:eventId/complete
- **Week 7:** #6 — SG2-100.
- **Source:** `app.ts:201-205`; `events/complete.ts`.
- **Permission:** `event_request.complete` (EC).
- **200:** `{ request: DetailRecord }` with status `completed`.
- **Errors:**
  - 404 `No completable event is assigned to this account.`
  - 409 `This event has not finished yet.`
  - 503
- **Rule:** only the assigned EC, from `preparation` or `confirmed`, after the latest confirmed booking has ended.
- **Note:** a failed history write is ignored, and the call still returns 200.

### 4.18 GET /api/event-requests/:eventId/stage
- **Week 7:** #5/#6 — SG2-100.
- **Source:** `app.ts:227-231`; `events/getStage.ts`, `events/stageCalculator.ts`.
- **Permission:** `event_request.stage.view` (EO, EC, VS, TSS, ECL, SO).
- **200:** `{ event_id, raw_status, stage, stage_key, description, waiting_on, stepper_steps: [{ key, label, status }], arrangements_recheck_needed, outstanding_arrangements[] }`. The 7 stepper keys are `draft`, `unassigned`, `under_review`, `in_planning`, `safety_check`, `preparation` and `confirmed`.
- **Errors:**
  - 403 `You are not authorized to view the stage of this event.` (an EO who is not the creator)
  - 404 `Event not found.`
  - 503
- **Rule:** an EO sees only their own events; every other granted role sees any event.

### 4.19 GET /api/event-requests/:eventId/history
- **Week 7:** #5/#6 — SG2-97, SG2-100.
- **Source:** `app.ts:245-249`; `events/getHistory.ts`.
- **Permission:** `event_request.history.view` (EO, EC, VS, TSS, ECL, SO).
- **200:** `{ event_id, history: [{ log_id, event_id, actor_id, actor_name, actor_role, field_name, old_value, new_value, created_at }] }`, newest first.
- **Errors:**
  - 403 `You are not authorized to view the change history of this event.`
  - 404 `Event not found.`
  - 503
- **Rule:** an EO sees only their own events, and never `planning_notes` rows (`INTERNAL_ONLY_AUDIT_FIELDS`).

### 4.20 POST /api/event-requests/:eventId/cancellation-request
- **Week 7:** Sprint 4 — SG2-67.
- **Source:** `app.ts:263`; `events/cancellation.ts`; `db/eventCancellation.ts`; migration `202610220002_event_cancellation.sql` (`request_event_cancellation`).
- **Permission:** `event_request.cancellation.request` (EO).
- **Body:** `{ reason: string }`, trimmed, not blank, at most 500 characters.
- **201:** `{ event_id, cancellation_requested_at, coordinator_notified }`.
- **Errors:**
  - 400 `Give a reason for the cancellation, up to 500 characters.`
  - 404 `Event not found.` (missing, or not created by the caller)
  - 409 `{ error: "A completed or cancelled event cannot be cancelled, and a draft is deleted instead.", code: "closed" }` (status `draft`, `completed`, `cancelled` or `rejected`)
  - 409 `{ error: "A cancellation has already been requested for this event.", code: "requested" }`
  - 401/403/503 mapped from the RPC
- **Data:** the RPC runs as the caller and rechecks the acting role with `lock_acting_role()`. It locks the event, then stores the reason, who asked and when on the event.
- **Side effects:** one `event_audit_logs` row (`cancellation_request`); a `cancellation_requested` notice to the assigned coordinator (an event still waiting for a coordinator keeps the request for whoever is assigned). Nothing is cancelled yet; the request also shows in the coordinator's work queue (`internal_work_items.details`).

### 4.21 PATCH /api/event-requests/:eventId/cancel
- **Week 7:** Sprint 4 — SG2-67; equipment release SG2-56.
- **Source:** `app.ts:268`; `events/cancellation.ts`; migrations `202610220002_event_cancellation.sql` (`cancel_event`), `202610210001_equipment_release.sql`.
- **Permission:** `event_request.cancel` (EC).
- **Body:** none.
- **200:** `{ event_id, status: "cancelled", cancelled_at, bookings_released, attendees_notified }`.
- **Errors:**
  - 404 `Event not found.` (missing, another coordinator's event, or an invalid id the RPC refuses)
  - 409 `{ error: "A completed or cancelled event cannot be cancelled, and a draft is deleted instead.", code: "closed" }` (status `completed`, `cancelled` or `rejected`)
  - 409 `{ error: "The organiser has not asked for this event to be cancelled.", code: "not_requested" }`
  - 400 `eventId must be a positive integer.`; 401/403/503 as 4.20
- **Rule:** only the assigned EC, and only once the organiser has asked (4.20).
- **Side effects (one transaction, `cancel_event`):**
  - every held or confirmed venue booking that has not ended is cancelled (reason `Event cancelled: …`), its approved request is cancelled and a history row is written
  - tentative holds are released and their pending requests cancelled; other pending venue and equipment requests are cancelled
  - the status becomes `cancelled` (`cancelled_at`, `cancelled_by`; `venue_booking_id` cleared) with a history row
  - the trigger `release_cancelled_event_equipment` releases the event's equipment reservations in the same statement (`released_at`, `released_by`, `release_reason = 'Event cancelled'`, one history row each; SG2-56)
  - an `event_cancelled` notice to each attendee with a non-cancelled registration and to the organiser
  - the trigger `keep_cancelled_events_cancelled` refuses any later status change (cancellation is final)

### 4.22 POST and GET /api/event-requests/:eventId/change-requests
- **Week 7:** Sprint 4 — SG2-64 (raise, organiser list), SG2-66 (coordinator list and impact).
- **Source:** `app.ts:307-316`; `events/changeRequests.ts`; `events/changeImpact.ts`; `db/changeRequests.ts`; migration `202610260001_event_change_requests.sql` (`raise_event_change_request`). Both routes share one path.
- **POST permission:** `event_request.change_request.raise` (EO). **GET permission:** `event_request.change_request.view` (EC, EO); the handler branches on the acting role.
- **POST body:** `{ field, to, reason }`.
  - `field`: one of `proposed_date`, `expected_attendance`, `venue_requirements`, `accessibility_needs`, `equipment_requirements`, `name`, `purpose`, `description`. The first five are "significant": they can invalidate arrangements.
  - `to`: the new value, checked with the draft rules of 4.1 for that field; null is refused.
  - `reason`: not blank, at most 1000 characters.
- **POST 201:** `{ change_request: { id, requested_at, reason, status: "pending", changes: [{ field, label, from, to }] }, coordinator_notified }`.
- **POST errors:**
  - 400 `{ error: "Invalid change request", details[] }`; 400 `eventId must be a positive integer.`
  - 403 `Access denied` (not an organiser)
  - 404 `Event not found.` (missing or not created by the caller)
  - 409 `{ error: "A change cannot be requested on a draft, cancelled, rejected or completed event.", status }`
  - 409 `The event already has that value.`
  - 503 `Change request service is temporarily unavailable. Please try again later.`
- **POST data:** the RPC runs with the service role under the event's row lock, checks ownership, status and the current value, stores the request in `event_change_requests` and sends a `change_requested` notice to the assigned coordinator.
- **GET as EO:** only the creating organiser; `200 { event: { event_id, status }, change_requests: [pending requests] }`; 404 `Event not found.` otherwise.
- **GET as EC:** only the assigned coordinator; `200 { event: { event_id, status }, can_accept, next_step_required, change_requests: [{ …request, significant, impact: { requires_revalidation, outstanding_arrangements[], arrangements: [{ kind, id, label, starts_at?, ends_at?, … }] } }] }`. `can_accept` is true for `approved`, `planning`, `awaiting_safety_check`, `preparation`, `confirmed` and `needs_clarification`; `next_step_required` is true only for `needs_clarification`. The impact is recomputed from fresh venue, equipment and registration facts on every call. Another coordinator's event is 404 `Event not found.`; any other role is 403.

### 4.23 POST /api/event-requests/:eventId/change-requests/:changeRequestId/accept
- **Week 7:** Sprint 4 — SG2-66 (impact, accept), SG2-65 (decision record, clarification path).
- **Source:** `app.ts:317`; `events/changeRequests.ts`; `db/changeImpact.ts` (`apply_accepted_event_change`); migration `202610270001_change_request_decisions.sql` (`decide_event_change_request`).
- **Permission:** `event_request.change_request.accept` (EC); the assigned coordinator only (404 otherwise).
- **Body:** none, except `{ next: "review" | "resubmit" }` when the event is `needs_clarification`.
- **200:** `{ event_id, previous_status, status, returned_to_planning, arrangements_recheck_needed, outstanding_arrangements[] }`.
- **Errors:**
  - 400 `eventId must be a positive integer.`
  - 400 `{ error: "Invalid change", details[] }` (the same schedule rules as 4.13)
  - 400 `Choose whether the request goes back to review or the organiser resubmits it.`
  - 403 `Access denied` (not a coordinator)
  - 404 `Event not found.` / `Change request not found.`
  - 409 `A change can only be accepted while the event is returned for clarification, Approved, in Planning, Awaiting Safety Check, in Preparation or Confirmed.`
  - 409 `This change request has already been decided. Refresh to see the latest.`
  - 409 `This event changed while you were deciding. Refresh and try again.`
  - 503 `Change request service is temporarily unavailable. Please try again later.`
- **Rule:** the impact is recomputed from fresh facts; the client is never trusted.
- **Side effects:**
  - the change is applied to the event with a history row per field and the arrangements it affects become outstanding (`venue_recheck`, `equipment_recheck`, `registration_recheck`)
  - an event in `awaiting_safety_check`, `preparation` or `confirmed` with affected arrangements returns to `planning`, clears `confirmed_by`/`confirmed_at` and sends `event_returned_to_planning` notices to the organiser and coordinator (SG2-66 AC4/AC7)
  - the decision (who, when) is stored on `event_change_requests` and a `change_accepted` notice goes to the requesting organiser
  - on `needs_clarification` the change is written onto the request and the status becomes `under_review` (`next: "review"`) or stays `needs_clarification` (`next: "resubmit"`)
  - if the event's start or confirmed venues change, every attendee with an active registration gets one `event_changed` notice at commit (SG2-102, migration `202610270002_attendee_event_change_notices.sql`)

### 4.24 POST /api/event-requests/:eventId/change-requests/:changeRequestId/refuse
- **Week 7:** Sprint 4 — SG2-65.
- **Source:** `app.ts:323`; `events/changeRequests.ts`; `decide_event_change_request`.
- **Permission:** `event_request.change_request.refuse` (EC); the assigned coordinator only.
- **Body:** `{ reason }`, trimmed, not blank, at most 1000 characters.
- **200:** `{ event_id, change_request_id, status: "refused" }`. The event is left as it is.
- **Errors:** 400 `Give a reason for refusing, up to 1000 characters.`; 400 `eventId must be a positive integer.`; 403; 404 `Event not found.` / `Change request not found.`; 409 `This change request has already been decided. Refresh to see the latest.`; 503.
- **Side effects:** the refusal reason, who and when are stored on the request; a history row; a `change_refused` notice with the reason goes to the requesting organiser.

### 4.25 POST /api/event-requests/:eventId/rechecks/:key/settle
- **Week 7:** Sprint 4 — SG2-66 AC4; safety keys SG2-93, SG2-92 AC4.
- **Source:** `app.ts:328`; `events/changeRequests.ts`; `db/changeImpact.ts` (`settle_arrangement_recheck`).
- **Permission:** `event_request.rechecks.settle` (EC); the assigned coordinator only.
- **Path:** `key` is one of `venue_recheck`, `equipment_recheck`, `registration_recheck`, `safety_venue_recheck`, `safety_equipment_recheck`, `safety_other_recheck`.
- **Body:** none.
- **200:** `{ event_id, arrangements_recheck_needed, outstanding_arrangements[] }`.
- **Errors:**
  - 400 `key must be one of …` / `eventId must be a positive integer.`
  - 403; 404 `Event not found.`
  - 409 `That arrangement is not waiting for a recheck.`
  - 409 `{ error: "This arrangement still needs attention before it can be marked rechecked.", blockers[] }` (arrangements still outstanding, or, for the safety keys, requests the Safety Officer flagged that Venue Staff or Technical Support have not confirmed again)
  - 409 `This event changed while you were deciding. Refresh and try again.`
  - 503
- **Note:** `safety_other_recheck` is also how a coordinator resubmits a reworked Safety Rejected event (4.28); the refresh trigger then returns it to Awaiting Safety Check once everything is ready (migration `202610290002_safety_rework_resubmit.sql`).

### 4.26 POST /api/event-requests/:eventId/safety-decision
- **Week 7:** #6 — SG2-92, SG2-93.
- **Source:** `app.ts:337`; `events/safetyDecisionRoutes.ts`, `events/safetyDecisions.ts`, `db/safetyDecisions.ts`; migrations `202610190005_safety_decisions.sql`, `202610190006_safety_decision_revision.sql`, `202610240001_safety_changes_requested.sql` (`record_safety_decision`).
- **Permission:** `event_request.safety_decision.record` (SO).
- **Body:** `{ decision: "approve" | "reject" | "request_changes", reason?, arrangements?, safety_check_revision }`.
  - `reason`: at most 2000 characters; required to reject or request changes, optional for approve.
  - `arrangements`: a non-empty set drawn from `venue`, `equipment`, `other`, each at most once, required for `request_changes` and refused otherwise.
  - `safety_check_revision`: the whole-number revision shown by 5.5 for the event.
- **201:** `{ decision: { decision_id, event_id, decision, reason, arrangements[], decided_by, decided_by_name, decided_at }, previous_status, status }`.
- **Errors:**
  - 400 `{ error: "Invalid safety decision", details[] }`; 400 `eventId must be a positive integer.`
  - 403 `Access denied` (role revoked since sign-in)
  - 404 `Event not found.`
  - 409 `{ error: "This event is no longer awaiting a safety check.", status }`
  - 409 `{ error: "This event changed after you opened it. Refresh the safety checks and review it again.", code: "stale", revision }`
  - 503 `Safety checks are temporarily unavailable. Please try again later.`
- **Data:** RPC `record_safety_decision`, one transaction, with the verified actor from the principal. Approve moves the event to `preparation`, Reject to `safety_rejected`, Request Changes back to `planning` with the named arrangements outstanding (`safety_venue_recheck`, `safety_equipment_recheck`, `safety_other_recheck`) and each affected venue booking or equipment request flagged for Venue Staff or Technical Support (5.6). Approve is the only way into Preparation (the `safety_approval_gate` trigger, SG2-94).
- **Side effects:** a `safety_decision` row in `event_safety_decisions`, an `event_audit_logs` row, and a `safety_decision` notice to the organiser and the coordinator.

### 4.27 GET /api/event-requests/:eventId/safety-decisions
- **Week 7:** #6 — SG2-92, SG2-93.
- **Source:** `app.ts:342`; `events/safetyDecisionRoutes.ts`.
- **Permission:** `event_request.safety_decisions.view` (SO, EC, EO).
- **200:** `{ decisions: [decision, …] newest first, rereviews: [{ review_id, decision_id, arrangement, label, flagged_at, resolution: "confirmed"|"withdrawn"|null, resolved_by_name, resolved_at }] }`; the decision shape is as in 4.26.
- **Errors:** 400 `eventId must be a positive integer.`; 404 `Event not found.` for an event the caller may not see; 503.
- **Rule:** any Safety Officer, the event's assigned coordinator, or its creating organiser.

### 4.28 POST /api/event-requests/:eventId/rework
- **Week 7:** #6 — SG2-92 AC4.
- **Source:** `app.ts:347`; `events/safetyDecisionRoutes.ts`; `db/safetyDecisions.ts` (`rework_safety_rejected_event`, latest in `202610290002_safety_rework_resubmit.sql`).
- **Permission:** `event_request.safety_rework` (EC); the assigned coordinator only.
- **Body:** none.
- **200:** `{ event_id, status }`, the new status being `planning`.
- **Errors:** 400 `eventId must be a positive integer.`; 404 `Event not found.`; 409 `{ error: "Only a Safety Rejected event can be reworked.", status }`; 503.
- **Side effects:** the event moves from `safety_rejected` to `planning` and `safety_other_recheck` is marked outstanding; the coordinator resubmits it by settling that key (4.25).

---

## 5. Queues and notifications

### 5.1 GET /api/assignment-queue
- **Week 7:** #5 — SG2-87.
- **Source:** `app.ts:149`; `assignmentQueue/index.ts`.
- **Permission:** `event_request.queue.view` (ECL).
- **200:** `{ entries: [{ event_id, name, organiser_name, proposed_date, expected_attendance, submitted_at }] }`
  - Covers events with status `unassigned` and no coordinator, across every organisation.
  - Oldest `submitted_at` first.
- **Errors:** 503 `The assignment queue is temporarily unavailable. Please try again.`
- **Data:** `events` joined to `users`, through the service-role client.

### 5.2 GET /api/work-queue and GET /api/work-queue/:kind/:itemId
- **Week 7:** #5 — SG2-87.
- **Source:** `app.ts:274`; `workQueue/index.ts:34`. One registration serves both paths.
- **Permission:** `work_queue.read` (EC, VS, TSS).
- **Path params:** `kind` is `event`, `venue` or `equipment`; `itemId` is a positive integer.
- **200:** `{ items: [{ kind, item_id, event_id, title, event_name, status, starts_at, ends_at, category, details, assigned_to_me }] }`. The item route returns the same envelope with one item.
- **Errors:**
  - 400 `Invalid work item.`
  - 404 `This item is no longer in your work queue. Return to the queue to refresh it.`
  - 503 `Your work queue is temporarily unavailable. Please try again.`
- **Rule:** rows come from the view `internal_work_items` for the caller's role. An EC sees only items assigned to them; since SG2-87 unassigned requests are in the ECL queue instead.

### 5.3 GET /api/notifications
- **Week 7:** New since W7 — SG2-49; ECL grant SG2-68.
- **Source:** `app.ts:138`; `notifications/index.ts`.
- **Permission:** `notifications.read` (EC, VS, TSS, EO, ECL). The Safety Officer and the Attendee do not hold it; every role reads its own notices through the inbox (5.8) instead.
- **200:** `{ notifications: [{ notification_id, event_id, request_id, kind, message, created_at }] }`
  - The newest 50 for the caller.
  - `kind` is one of: `venue_request_approved`, `venue_request_rejected`, `venue_booking_released`, `equipment_reserved`, `venue_booking_clash`, `event_confirmed`, `event_submitted`, `coordinator_assigned`, `clarification_requested`, `event_approved`, `event_rejected`, `venue_unavailable`, `event_returned_to_planning`, `safety_decision`, `outstanding_arrangements`, `change_requested`, `change_accepted`, `change_refused`, `cancellation_requested`, `event_cancelled`, `venue_booking_cancelled`, `venue_change_requested`, `event_changed`, `registration_confirmed`, `registration_withdrawn`, `registration_full`, `registration_opened`, `registration_closed`, `waiting_list_offer`, `waiting_list_offer_lapsed` (the `notifications_kind_check` list after migration `202610280001_waiting_list.sql`).
- **Errors:** 503.
- **Data:** `notifications`, filtered on `recipient_id` = caller and by RLS (user-scoped client).
- **Hold notices** are a separate endpoint: 8.3.

### 5.4 GET /api/coordinator-overview
- **Week 7:** #5 — SG2-89.
- **Source:** `app.ts:189`; `coordinatorOverview/index.ts`; `db/coordinatorOverview.ts`.
- **Permission:** `event_request.oversight.view` (ECL).
- **Query:** `coordinatorId` and `status`, each optional and at most once (400 `Give <key> at most once.`). `status` must be an active event status (400 `status must be the status of an active event.`); `coordinatorId` must be an Event Coordinator in the roster (400 `coordinatorId must be an Event Coordinator.`).
- **200:** `{ events: [{ event_id, name, organisation, status, proposed_date, coordinator_id, coordinator_name }], coordinators: [{ user_id, name, active_events, assignable }], statuses[] }`.
  - `events` are the active events whose coordinator the caller last assigned or reassigned (`events.coordinator_assigned_by`), soonest first, in every assignable status except `unassigned`.
  - `coordinators` lists every Event Coordinator with how many of the caller's active events they hold, counted before the filters apply; a former coordinator still holding events appears with `assignable: false`.
- **Errors:** 503 `The coordinator overview is temporarily unavailable. Please try again.`
- **Data:** `events` and `account_roles` through the service-role client.

### 5.5 GET /api/safety-checks
- **Week 7:** #6 — SG2-91.
- **Source:** `app.ts:181`; `safetyChecks/index.ts`; `db/safetyChecks.ts`; migration `202610190004_safety_check_queue.sql` (`safety_check_queue`).
- **Permission:** `safety_checks.read` (SO).
- **200:** `{ events: [{ event_id, safety_check_revision, name, organisation, proposed_date, awaiting_since, expected_attendance, accessibility_needs, expected_crowd_movement, venues: [{ request_id, venue_id, venue_name, location, capacity, layout, starts_at, ends_at, accessibility_features, emergency_access, known_restrictions }], equipment: [{ request_id, equipment_name, quantity, placement_venue_name, placement_position, arrangement_notes }] }] }`. `safety_check_revision` goes back with the decision in 4.26.
- **Errors:** 503 `The safety check list is temporarily unavailable. Please try again.`
- **Data:** RPC `safety_check_queue()` with the caller's token, which rechecks the stored role, so a Safety Officer whose role has changed is refused (403).

### 5.6 GET /api/safety-rereviews
- **Week 7:** #6 — SG2-93.
- **Source:** `app.ts:192-195`; `events/safetyRereviewRoutes.ts`; `db/safetyRereviews.ts`.
- **Permission:** `safety_rereviews.read` (VS, TSS). The acting role picks the kind: venue for Venue Staff, equipment for Technical Support.
- **200:** `{ arrangement: "venue"|"equipment", rereviews: [{ review_id, arrangement, event_id, event_name, proposed_date, coordinator_name, flagged_at, label, reason, decided_by_name, layout, placement_venue_name, placement_position }] }`, open flags only, oldest first.
- **Errors:** 503 `Safety checks are temporarily unavailable. Please try again later.`

### 5.7 POST /api/safety-rereviews/:reviewId/confirm
- **Week 7:** #6 — SG2-93.
- **Source:** `app.ts:194`; `events/safetyRereviewRoutes.ts` (`confirm_safety_rereview`).
- **Permission:** `safety_rereviews.confirm` (VS, TSS); the flag must be of the acting role's kind.
- **Body:** none.
- **200:** `{ review_id, event_id, status, outstanding_arrangements[] }`. The last flag of its kind settles that safety recheck, and the event returns to Awaiting Safety Check once nothing is outstanding.
- **Errors:** 400 `reviewId must be a positive integer.`; 403 `Access denied` (another kind of flag, or role revoked); 404 `That safety re-review was not found.`; 409 `{ error: "This booking or equipment request has already been dealt with.", resolution }`; 503.

### 5.8 GET /api/notifications/inbox
- **Week 7:** Sprint 4 — SG2-69.
- **Source:** `app.ts:168`; `notifications/index.ts`; `db/notificationInbox.ts`; migration `202610200003_notifications_inbox_reminders.sql` (`notification_inbox`). See [notification-inbox.md](../notification-inbox.md).
- **Permission:** `notifications.inbox` (all 7 roles); the rows are the caller's own.
- **Query:** none for the first page; for the next page all three of `before_created_at` (ISO date-time, microseconds kept), `before_source` (`event` or `hold`) and `before_id`, exactly as `next_cursor` returned them. Anything else is 400 `Enter a valid notification identity or complete pagination cursor.`
- **200:** `{ notifications: [{ source: "event"|"hold", notification_id, event_id, kind, message, created_at, read_at }], unread_count, next_cursor: { created_at, source, notification_id } | null }`. Page size 50, newest first, merging `notifications` and `venue_hold_notifications`; `unread_count` covers every unread row, not only the page.
- **Errors:** DB-mapped 401/403/503.
- **Data:** RPC with the caller's token; `Cache-Control: no-store`.

### 5.9 POST /api/notifications/read-all
- **Week 7:** Sprint 4 — SG2-69.
- **Source:** `notifications/index.ts`; RPC `read_all_notifications()`.
- **Permission:** `notifications.inbox` (all 7).
- **Body:** none. **200:** `{ unread_count }`. Marks the caller's unread rows read from one snapshot; a notice arriving meanwhile stays unread.

### 5.10 GET and PUT /api/notifications/reminder-preferences
- **Week 7:** Sprint 4 — SG2-69.
- **Source:** `notifications/index.ts`; RPCs `notification_reminder_preferences()`, `set_notification_reminder_preferences(p_frequency_days)`.
- **Permission:** `notifications.reminders.manage` (EC); the RPCs recheck the acting role.
- **GET 200:** `{ frequency_days }`, 1 when never set.
- **PUT body:** `{ frequency_days }`, the only key, a whole number from 1 to 30. **200:** `{ frequency_days }`.
- **Errors:** 400 `Choose a reminder interval from 1 to 30 whole days.`; DB-mapped 401/403/503.
- **Effect:** the setting is the cadence of the hourly pg_cron job `sg2-69-arrangement-reminders` (`send_outstanding_arrangement_reminders()`), which sends `outstanding_arrangements` notices to coordinators.

### 5.11 POST /api/notifications/:source/:id/read
- **Week 7:** Sprint 4 — SG2-69.
- **Source:** `notifications/index.ts`; RPC `read_notification(p_source, p_notification_id)`.
- **Permission:** `notifications.inbox` (all 7).
- **Path:** `source` is `event` or `hold`; `id` is a positive integer.
- **200:** `{ notification: { source, notification_id, event_id, kind, message, created_at, read_at }, unread_count }`. Idempotent: an already-read notice keeps its first `read_at`.
- **Errors:** 400 `Enter a valid notification identity or complete pagination cursor.`; 404 `Notification or related event is no longer available.` (not the caller's, or missing); DB-mapped 401/403/503.

### 5.12 GET /api/notifications/:source/:id/event
- **Week 7:** Sprint 4 — SG2-69.
- **Source:** `notifications/index.ts`; RPC `notification_event(p_source, p_notification_id)`.
- **Permission:** `notifications.inbox` (all 7).
- **200:** `{ event: { event_id, name, status, proposed_date } }`, the summary of the event a notice is about.
- **Errors:** 400 as 5.11; 404 `Notification or related event is no longer available.`; DB-mapped 401/403/503.
- **Rule:** the caller must own the notice and, as the acting role, still have a relationship to the event: the creating organiser of the organisation, a registered attendee, or an internal role passing `private.event_relationship_exists()`. Otherwise 404.

---

## 6. Venues

All venue routers are `protectedRouter`s mounted at `/api/venues`. Except for suitability (6.11), they read and write with the **caller's token**, so RLS applies. `venueId` is capped at 2147483647; the availability route (6.9) has no cap.

### 6.1 GET /api/venues
- **Source:** `venues/index.ts:43`.
- **Permission:** `venues.read` (VS, EC).
- **200:** `{ venues: [{ venue_id, name, location, capacity, facilities, accessibility_features, operating_information }] }`
- **Errors:** DB-mapped 401/403/503 only.

### 6.2 POST /api/venues
- **Source:** `venues/index.ts:44`; `venues/fields.ts`.
- **Permission:** `venues.create` (VS).
- **Body:** all fields required:
  - `name`: at most 255 characters
  - `location`, `facilities`, `accessibility_features`, `operating_information`: non-blank
  - `capacity`: integer from 1 to 2147483647
- **201:** `{ venue }`
- **Errors:**
  - 400 `Complete every venue field, keep the name within 255 characters and enter a positive whole-number capacity.`
  - 503 `Venue could not be saved.`

### 6.3 PUT /api/venues/:venueId
- **Source:** `venues/index.ts:45`.
- **Permission:** `venues.update` (VS).
- **Body:** the full record, as in 6.2.
- **200:** `{ venue }`
- **Errors:**
  - 400 `Invalid venue ID.`
  - 400 field message
  - 404 `Venue not found or no longer editable.`

### 6.3a DELETE /api/venues/:venueId
- **Week 7:** Sprint 4 — SG2-106.
- **Source:** `venues/index.ts:54`; `db/venues.ts` (`remove`); migrations `202610170007_venue_delete_hold_expiry.sql`, `202610190001_venue_delete_past_holds.sql` (`delete_venue`).
- **Permission:** `venues.delete` (VS); the RPC rechecks the stored role.
- **200:** `{ venue: { venue_id, name, deleted_at, deleted_by } }`. A soft delete: the row stays so past bookings, requests and history remain; the venue then drops out of `GET /api/venues` and the other lists.
- **Errors:**
  - 400 `Invalid venue ID.`
  - 404 `Venue not found or already deleted.`
  - 409 `{ error: "This venue still has current or future bookings, holds or pending requests.", blockers: [{ kind: "booking"|"hold"|"request", id, event_id, event_name, starts_at, ends_at }] }`
  - DB-mapped 401/403/503
- **Rule:** under the venue lock, tentative holds past their deadline are expired first; the delete is refused while a held or confirmed booking that has not ended, a live tentative hold or a pending request (not owned by a live hold) remains. Triggers refuse new requests, bookings, holds and unavailability blocks on a deleted venue.

### 6.4 GET /api/venues/:venueId/layouts
- **Source:** `venues/layouts.ts:54`.
- **Permission:** `venues.layouts.read` (VS, EC).
- **200:** `{ layouts: [{ layout, other_description }] }`
- **Errors:** 400 `Invalid venue ID.`

### 6.5 PUT /api/venues/:venueId/layouts
- **Source:** `venues/layouts.ts:55`; `venues/layoutFields.ts`.
- **Permission:** `venues.layouts.update` (VS).
- **Body:** `{ layouts: [{ layout, other_description? }] }`
  - `layout` is one of `classroom`, `theatre`, `boardroom`, `banquet`, `exhibition` or `other`, with no duplicates.
  - `other` needs a description of at most 255 characters.
- **200:** `{ layouts }`. The venue's whole set is replaced.
- **Errors:**
  - 400 `Invalid venue ID.`
  - 400 layout message
  - 404 `Venue not found.`

### 6.6 GET /api/venues/:venueId/operations
- **Week 7:** #1/#6 — SG2-77.
- **Source:** `venues/operations.ts:50`.
- **Permission:** `venues.operations.read` (VS, EC, TSS).
- **200:** `{ operations: { setup_minutes, turnaround_minutes, emergency_access, known_restrictions, updated_at } }`. With no saved row the defaults are 0, 0, null, null, null.
- **Errors:** 400 `Invalid venue ID.`; 404 `Venue not found.`
- **Data:** `venue_operations`.

### 6.7 PUT /api/venues/:venueId/operations
- **Week 7:** #1/#6 — SG2-77.
- **Source:** `venues/operations.ts:51`; `venues/operationFields.ts`.
- **Permission:** `venues.operations.update` (VS).
- **Body:**
  - `setup_minutes`, `turnaround_minutes`: required integers from 0 to 1440
  - `emergency_access`, `known_restrictions`: optional, at most 2000 characters
- **200:** `{ operations }` (upsert).
- **Errors:**
  - 400 `Invalid venue ID.`
  - 400 `Enter setup and turnaround times as whole minutes from 0 to 1440, and keep each safety note within 2000 characters.`
  - 404 `Venue not found.`
- **Side effects:** a trigger writes `venue_operation_history`. Triggers also refresh SG2-79 clash flags.

### 6.8 GET /api/venues/availability
- **Week 7:** #1 — SG2-78; #2 — SG2-80.
- **Source:** `venues/availability.ts:325`.
- **Permission:** `venues.availability.view` (EC, VS, TSS).
- **Query:** `from` and `to`, both required ISO date-times; `from` must be before `to`; the range is at most 366 days.
- **200:** `{ from, to, venues: [{ venueId, name, entries: [{ start, end, kind, label }] }] }`
  - `kind` is one of `booking`, `hold`, `unavailable`, `setup` or `turnaround`.
  - `setup` and `turnaround` bands come from `venue_operations` (SG2-78).
  - A confirmed booking inside an unavailable period gets the label suffix ` · affected by venue unavailability` (SG2-80).
- **Errors:**
  - 400 `from and to must be ISO 8601 date-times.` / `from must be earlier than to.` / `The date range must not exceed 366 days.`
  - 503 `Venue availability is temporarily unavailable.`
- **Data:** `venues`, view `venue_booking_occupancy`, `venue_unavailability`, view `venue_affected_bookings`, `venue_operations`.

### 6.9 GET /api/venues/:venueId/availability
- **Week 7:** #1 — SG2-78; #2 — SG2-80.
- **Source:** `venues/availability.ts:326`.
- **Permission:** `venues.availability.view` (EC, VS, TSS).
- **Query:** as 6.8.
- **200:** `{ venueId, from, to, entries: [...] }`. An unknown venue gives `entries: []`.
- **Errors:** 400 `A positive integer venue id is required.` or the range messages; 503.

### 6.10 GET /api/venues/search
- **Week 7:** #1 — SG2-78.
- **Source:** `venues/search.ts:108`; `venues/searchFields.ts`.
- **Permission:** `venues.search` (EC).
- **Query:**
  - `from`, `to`: required; at most 31 days apart
  - `attendance`: optional
  - `location`: optional, at most 255 characters
  - `layout`: optional
  - `facilities`, `accessibility`: optional comma-separated keywords, at most 12 each (255 characters per text criterion)
- **200:** `{ venues: [{ venue_id, name, location, capacity, facilities, accessibility_features, operating_information, layouts[], held[] }] }`
- **Matching:** event search prefills recognised facility requirements as well as attendance/accessibility. Exact canonical facility labels use the same aliases as suitability (for example projector/projection and wifi/Wi-Fi); other user phrases retain literal substring matching, and every supplied criterion must match. The 12-keyword limit accommodates the full recognised facility vocabulary. This SG2-46 correction follows the recorded `61416cc` snapshot.
- **Exclusions:** a venue is left out when:
  - it is unavailable for the period
  - a confirmed or tentative occupancy clashes once the venue's setup + turnaround gap is applied (SG2-78)
  - it is too small for `attendance`
  - it fails any text or layout filter
- **Errors:**
  - 400 (validation messages)
  - 503 `Venue search is temporarily unavailable.`

### 6.11 GET /api/venues/suitability
- **Source:** `venues/suitabilityRoutes.ts:68` (`createVenueSuitabilityRouter`).
- **Permission:** `venues.suitability.view` (EC, VS, TSS, EO).
- **Query:** `event_id` (required), `venue_id` (optional).
- **200:** `{ event: { event_id, name, expected_attendance, venue_requirements, accessibility_needs }, venues: [{ …venue, suitability: { suitable, issues[], required_facilities, required_accessibility } }] }`
- **Errors:**
  - 400 `event_id, and venue_id when given, must be positive whole numbers.`
  - 404 `Event not found.` / `Venue not found.`
  - 503
- **Rule:** EC sees only events assigned to them; EO only events they created; VS and TSS any event.
- **Data:** read through the service-role client.

### 6.12 GET /api/venues/:venueId/blocks
- **Week 7:** #2 — SG2-80.
- **Source:** `venues/blocks.ts:73`.
- **Permission:** `venues.blocks.manage` (VS).
- **200:** `{ blocks: [{ unavailability_id, starts_at, ends_at, category, reason, created_at, created_by_name, affected: [{ booking_id, event_id, event_name, event_status, starts_at, ends_at }] }] }`. Only blocks that have not ended.
- **Errors:** 400 `Invalid venue ID.`
- **Data:** RPC `list_venue_unavailability(p_venue_id, p_after)`, a security-definer function (`202610100001_venue_temporary_unavailability.sql`).

### 6.13 POST /api/venues/:venueId/blocks
- **Week 7:** #2 — SG2-80. Marks a venue temporarily unavailable.
- **Source:** `venues/blocks.ts:74`; `venues/blockFields.ts`.
- **Permission:** `venues.blocks.manage` (VS).
- **Body:**
  - `starts_at`, `ends_at`: start before end; the end must not be in the past
  - `category`: one of `maintenance`, `equipment_failure`, `renovation`, `safety_concern` or `other`
  - `reason`: the note, at most 500 characters
- **201:** `{ block }`, the same shape as 6.12.
- **Behaviour:**
  - A period that covers confirmed bookings is **accepted** (SG2-80 AC2).
  - Trigger `venue_unavailability_flag_bookings` writes those bookings to `venue_booking_disruptions`, and they appear in `affected`.
  - The booking is retained. Since SG2-81 (`202610170001`), each new disruption flag notifies the current Coordinator (`venue_unavailable`). If the event is in Preparation or Confirmed, the same trigger returns it to Planning, clears `confirmed_by/at`, writes status history and notifies the Organiser (unless the same recipient). Date, time, attendance and requirements remain unchanged. Other stages stay unchanged; pre-migration flags are not retrospectively announced.
- **Errors:**
  - 400 `Invalid venue ID.`
  - 400 `Enter a start and an end, with the end after the start and not in the past, a listed reason, and a note within 500 characters.`
  - 404 `Venue not found.`
  - 503

### 6.14 DELETE /api/venues/:venueId/blocks/:blockId
- **Source:** `venues/blocks.ts:75`.
- **Permission:** `venues.blocks.manage` (VS).
- **204:** no body.
- **Errors:** 400 `Invalid venue ID.` / `Invalid block ID.`; 404 `Block not found.`

---

## 7. Venue booking requests

The routers mounted at `/api/venue-booking-requests` are, in order:
- `createBookingRequestSuitabilityRouter` (`app.ts:132`)
- `createVenueBookingRequestsRouter` (`app.ts:134`)
- `createVenueConflictsRouter` (`app.ts:136`)

Request, conflict, suitability and listing reads use the service-role client. The decide and withdraw writes call RPCs with the caller's token.

**Scope:** an EC sees only assigned events on routes granting EC access; VS and TSS have cross-event suitability/exception authority. EO suitability and exception access is creator-only. Listing booking requests (§7.2) still grants only EC and VS. Discovery (§7.8) does not widen general event or venue permissions.

**Request record:**
- identity: `request_id, event_id, venue_id, venue_name`
- period and status: `starts_at, ends_at, status, layout, venue_requirements`
- requested: `requester_name, requested_at`
- decided: `decider_name, decided_at, decision_reason`
- withdrawn: `withdrawer_name, withdrawn_at`
- replacement: `replaces_booking_id` (nullable old booking reference, SG2-81)

### 7.1 POST /api/venue-booking-requests
- **Week 7:** New since W7 — SG2-48; #1 — SG2-78.
- **Source:** `venues/bookingRequests.ts:154`; `venues/bookingRequestFields.ts`.
- **Permission:** `venue_booking.request` (EC).
- **Body:**
  - `event_id`, `venue_id`: integers
  - `starts_at`: in the future
  - `ends_at`: after `starts_at`
  - `layout`: one of the layouts in 6.5
  - `replaces_booking_id`: optional positive whole ID of a confirmed booking belonging to this event; omit or send null for an ordinary request (SG2-81 replacement of an affected booking; SG2-83 change of any current booking, see below)
- **201:** `{ request, booking: "allowed"|"needs_capacity_exception", conflicts: [{ kind: "booking"|"hold", reference_id, event_id, event_name, starts_at, ends_at, status }] }`
- **Errors:**
  - 400 `Choose an event, a venue, a layout and a future period that starts before it ends.`
  - 404 `Event not found.` / `Venue not found.`
  - 409 ordinary request: event not `approved`, `planning` or `awaiting_safety_check`; replacement or change additionally permits `preparation` and `confirmed`
  - 409 replacement or change reference is not a current confirmed booking of this event (SG2-83: `That booking is not a current confirmed booking of this event, so it cannot be changed.`)
  - 409 layout not offered
  - 409 required facility missing
  - 409 overlapping duplicate request for the same event and venue
- **Rule:** only the assigned EC. An event may have **several** requests for different venues; SG2-82 is change #3.
- **Replacement:** uses this same route and the existing 7.4 decision route. A pending replacement reserves nothing. Approval creates the new booking and releases the referenced old one atomically; rejection leaves the old booking intact. The Coordinator UI prefills the affected booking's period and event requirements for the existing venue search.
- **Change one venue (SG2-83):** `replaces_booking_id` may name any confirmed booking of the event that has not ended. `change_reason` (at most 500 characters) is then required unless the booking is affected by a venue unavailability. A reference that is no longer a current confirmed booking is 409 `That booking is not a current confirmed booking of this event, so it cannot be changed.` On a Confirmed or Preparation event the new pending request returns the event to Planning with a venue recheck outstanding, and Venue Staff get a `venue_change_requested` notice (migration `202610210002_venue_booking_change_cancel.sql`). A request is also accepted while the event is `awaiting_safety_check` (SG2-91).
- **Conflicts:**
  - Cover confirmed bookings and live holds within the venue's setup + turnaround gap (SG2-78).
  - They are reported, not refused.
  - Unavailability blocks are not listed here.

### 7.2 GET /api/venue-booking-requests
- **Week 7:** New since W7 — SG2-48; #3 — SG2-82.
- **Source:** `venues/bookingRequests.ts:207`.
- **Permission:** `venue_booking.request.view` (EC, VS).
- **Query:** `event_id` (required).
- **200:** `{ requests[], arrangement: { state: "none"|"in_progress"|"ready", needed, approved, pending, rejected, unbooked, affected } }`. A rejected request keeps the state `in_progress` until it is withdrawn (SG2-82); affected confirmed bookings also prevent `ready` (SG2-81).
- **Errors:** 400 `event_id must be a positive whole number.`; 404 `Event not found.`

### 7.3 GET /api/venue-booking-requests/:requestId/conflicts
- **Week 7:** New since W7 — SG2-50; #1 — SG2-78.
- **Source:** `venues/conflicts.ts:74`.
- **Permission:** `venue_booking.conflicts.view` (EC, VS).
- **200:** `{ request_id, status, conflicts[] }`, with conflicts shaped as in 7.1. The list is `[]` unless the request is `pending`.
- **Errors:** 400 `Invalid booking request ID.`; 404 `Booking request not found.`

### 7.4 POST /api/venue-booking-requests/:requestId/decision
- **Week 7:** New since W7 — SG2-49; #1 — SG2-78; #3 — SG2-82.
- **Source:** `venues/bookingRequests.ts:259`.
- **Permission:** `venue_booking.decide` (VS).
- **Body:** `{ decision: "approve"|"reject", reason? }`. `reason` is at most 500 characters and is required to reject.
- **200:** `{ request }`
- **Errors:**
  - 400: invalid ID, invalid body, or RPC `invalid`
  - 404 `Booking request not found.`
  - 409 already decided
  - 409 the request belongs to a tentative hold
  - 409 facility missing
  - 409 `Approve a capacity exception for this request before approving the booking.`
  - 409 `closed`
  - 409 `{ error, conflict: { kind: "booking"|"block"|"hold", starts_at, ends_at, label } }`
- **Data:** RPC `decide_venue_booking_request(p_request_id, p_decision, p_reason)`, run as the caller. The latest definition is in `202610190002_venue_staff_capacity_exceptions.sql`: only a capacity exception recorded by Venue Staff covers the attendance (SG2-66 AC5). The API applies the same rule before calling it.
- **What the RPC does:**
  - Under the venue lock it refuses confirmed bookings and live holds within the setup + turnaround gap (`venue_preparation_gap`, SG2-78), and unavailability without the gap.
  - It inserts a confirmed `venue_bookings` row and keeps the event's first booking (`events.venue_booking_id = coalesce(...)`, SG2-82).
  - It writes history and notifies the coordinator and organiser.
  - For a replacement, it locks the relevant venues in ascending ID order, then approves the new booking and calls internal `release_replaced_booking` in the same transaction. The old confirmed booking becomes cancelled, its old request is cancelled, the primary booking pointer is updated when needed, and history plus `venue_booking_released` notices are written to distinct Coordinator/Organiser recipients. A failed approval rolls back.
  - The exclusion constraint `venue_bookings_no_double_booking` is the backstop.

### 7.5 POST /api/venue-booking-requests/:requestId/withdraw
- **Week 7:** #3 — SG2-82.
- **Source:** `venues/bookingRequests.ts:230`.
- **Permission:** `venue_booking.withdraw` (EC).
- **200:** `{ request }` with status `cancelled`.
- **Errors:**
  - 400 invalid ID
  - 404 not found or not assigned
  - 409 `This request has been approved. Release its booking instead if the event no longer needs the venue.`
  - 409 `This request has already been <status>.`
  - 409 `This request belongs to tentative hold #<id>. Venue Staff release it from Venue holds.`
- **Rule:** only the assigned EC; only `pending` or `rejected` requests that are not hold-owned.
- **Data:** RPC `withdraw_venue_booking_request(p_request_id)` (`202610150002_venue_request_withdrawal.sql`). It writes a history row.

### 7.6 GET /api/venue-booking-requests/:requestId/suitability
- **Source:** `venues/suitabilityRoutes.ts:125` (`createBookingRequestSuitabilityRouter`).
- **Permission:** `venues.suitability.view` (EC, VS, TSS, EO).
- **200:** `{ request, event, venue, suitability, exceptions[], booking: "allowed"|"needs_capacity_exception"|"blocked" }`
- **Errors:** 400 `Invalid booking request ID.`; 404 `Booking request not found.`; 503.

### 7.7 POST /api/venue-booking-requests/:requestId/capacity-exception
- **Source:** `venues/suitabilityRoutes.ts` (`createBookingRequestSuitabilityRouter`).
- **Permission:** `venue_booking.capacity_exception.approve` (VS only, SG2-66 AC5; this replaces the SG2-47 AC3 list of VS, TSS and EO). Every other role gets 403.
- **201:** `{ exception: { exception_id, request_id, approved_by, approver_role, expected_attendance, venue_capacity, approved_at, approver_name }, booking }`
- **Errors:**
  - 400
  - 404
  - 409 `Only a booking request awaiting a decision, or a booked venue for an event still going ahead, can be given a capacity exception.`
  - 409 facility missing (no exception allowed)
  - 409 no capacity issue
  - 409 exception already approved
  - 503
- **Eligible requests:** a pending request, or (SG2-66 AC2) an approved request that still holds its confirmed booking for an event in `approved`, `planning`, `awaiting_safety_check`, `preparation` or `confirmed` whose expected attendance now exceeds the venue's capacity. The exception is for the revised attendance; the booking is not changed.
- **Data:** inserts into `venue_capacity_exceptions`. Actor, role, attendance and capacity come from the verified session and current stored rows; no approval body is required. Request status, its booking, missing facilities and existing coverage are rechecked independently of discovery. Only exceptions recorded by Venue Staff count as coverage; exceptions recorded by Technical Support Staff or organisers before SG2-66 are still returned in GET suitability `exceptions[]` as history but never count.
- **Reachability:** Venue Staff navigation opens **Capacity exceptions**, then the existing suitability view and approval action; the same action is on the Venue Staff request queue. Approval shows the stored receipt but leaves a pending booking request pending and creates no booking; Venue Staff make a separate booking decision. Refreshing discovery removes a covered request.

### 7.8 GET /api/venue-booking-requests/capacity-exceptions
- **Source:** `venues/suitabilityRoutes.ts` (`createBookingRequestSuitabilityRouter`); `db/venueSuitability.ts` (`capacityCandidates`); `client/src/screens/CapacityExceptions.tsx`.
- **Permission:** existing `venue_booking.capacity_exception.approve` (VS only since SG2-66 AC5). Every other role is denied before the store is read.
- **Input:** no body or supported owner/event selector.
- **200:** `{ requests: [{ request_id, event_id, event_name, venue_name, starts_at, ends_at, expected_attendance, venue_capacity, booked }] }`. IDs and attendance are positive integers; periods are ISO timestamps. Capacity is an integer or `null` when not recorded. `booked` is true for an approved request that holds a confirmed booking (SG2-66 AC2); the screen marks it "Booked — attendance raised". Empty results are `{ requests: [] }`; blank names use `Untitled event` / `Unnamed venue`. Owner IDs, requirement text and approval records are not list fields.
- **Eligibility:** requests eligible under 7.7 with positive recorded attendance, a capacity issue not already covered by a Venue Staff exception, and no missing required facility. Suitability and coverage use the existing assessment rules, including unrecorded venue capacity. A list entry is not an approval or reservation.
- **Reads:** Venue Staff discover eligible requests across events. Named request-booking/event/venue/exception foreign keys avoid ambiguous PostgREST embeds. Ordered batches of 1,000 are read until exhausted; later-page failure returns 503 instead of a partial successful list. The response has the protected route's `Cache-Control: no-store`.
- **Errors:** common 401/403; 503 when the service or any read fails. Existing GET suitability and POST capacity-exception endpoints remain authoritative if a request changes after discovery.

---

## 8. Venue holds, bookings and clashes

**Holds (W7 #4):**
- All seven hold routes (`venues/holds.ts`) call SECURITY DEFINER RPCs with the caller's token and send `Cache-Control: no-store`.
- **Hold record:** `hold_id, event_id, event_name, venue_id, venue_name, request_id, booking_id, starts_at, ends_at, expires_at, status ("tentative"|"converted"|"released"|"expired"), created_at`.
- **Expiry** is not an endpoint:
  - pg_cron job `venue-hold-deadlines` runs `public.process_venue_hold_deadlines()` every minute (`202610050001_venue_holds.sql`).
  - The list RPCs (8.1, 8.3) also process due deadlines lazily.
  - The warning lead time is `venue_hold_settings.warning_lead_seconds`, default 86400 s (24 hours).

### 8.1 GET /api/venue-holds
- **Week 7:** #4 — SG2-84/85.
- **Source:** `holds.ts:39`.
- **Permission:** `venues.holds.read` (EC, VS, TSS).
- **200:** `{ holds: Hold[] }`, newest first.
- **Rule:** an EC sees holds only for their own events (inside the RPC).
- **Data:** RPC `list_venue_holds()`.

### 8.2 GET /api/venue-holds/options
- **Week 7:** #4 — SG2-84.
- **Source:** `holds.ts:40`.
- **Permission:** `venues.holds.manage` (VS).
- **200:** `{ events: [{ event_id, name }], venues: [{ venue_id, name }] }`. Events are `approved` or `planning` with a coordinator.
- **Data:** RPC `venue_hold_options()`.

### 8.3 GET /api/venue-holds/notifications
- **Week 7:** #4 — SG2-84/85.
- **Source:** `holds.ts:41`.
- **Permission:** `venues.holds.read` (EC, VS, TSS).
- **200:** `{ notifications: [{ notification_id, event_id, hold_id, kind: "placed"|"warning"|"expired"|"expiry_changed", message, created_at }] }`, the caller's own.
- **Data:** RPC `list_venue_hold_notifications()`, over the table `venue_hold_notifications`.

### 8.4 POST /api/venue-holds
- **Week 7:** #4 — SG2-84; #1 — SG2-78.
- **Source:** `holds.ts:42`; `venues/holdFields.ts`.
- **Permission:** `venues.holds.manage` (VS).
- **Body:** only these keys:
  - `event_id`, `venue_id`
  - `starts_at`, `ends_at`, `expires_at`: ISO strings with a time zone
  - `ends_at` and `expires_at` must be in the future
- **201:** `{ hold }`
- **Errors:**
  - 400 `Enter valid event and venue IDs, a start and end with time zones, and a mandatory future expiry.`
  - 400 `Choose a planning event with an assigned coordinator, a valid period and a future expiry.`
  - 404 `Event, venue or tentative hold not found.`
  - 409 `This venue is already booked, held or unavailable for that period.`
- **Data:** RPC `create_venue_hold(...)`. The latest definition is in `202610120002_setup_turnaround_checks.sql`. The RPC:
  - inserts a pending `venue_booking_requests` row and the `venue_holds` row
  - writes history
  - sends a `placed` notice, plus a `warning` at once if the hold is already inside the lead time

### 8.5 POST /api/venue-holds/:holdId/release
- **Week 7:** #4 — SG2-84.
- **Source:** `holds.ts:43`.
- **Permission:** `venues.holds.manage` (VS).
- **200:** `{ hold }` with status `released`; the hold's request becomes `cancelled`.
- **Errors:**
  - 400
  - 404
  - 409 `This hold is no longer active. Place a new request.`
- **Data:** RPC `change_venue_hold(p_hold_id, 'release')`.

### 8.6 POST /api/venue-holds/:holdId/convert
- **Week 7:** #4 — SG2-84/85; #1 — SG2-78.
- **Source:** `holds.ts:44`.
- **Permission:** `venues.holds.manage` (VS).
- **200:** `{ hold }` with status `converted` and `booking_id` set; a confirmed booking is created.
- **Errors:**
  - 400
  - 404
  - 409 inactive or expired
  - 409 conflict
  - 409 `Approve a capacity exception for this booking request before converting the hold.`
  - 409 `Required venue facilities are missing. Choose a suitable venue.`
- **Data:** RPC `change_venue_hold(p_hold_id, 'convert')`. The latest definition is in `202610190002_venue_staff_capacity_exceptions.sql` (only a Venue Staff capacity exception counts, SG2-66 AC5).

### 8.6a POST /api/venue-holds/:holdId/expiry
- **Week 7:** #4 — SG2-106.
- **Source:** `holds.ts:50`; `venues/holdFields.ts` (`validateHoldExpiry`); migration `202610170007_venue_delete_hold_expiry.sql` (`change_venue_hold_expiry`).
- **Permission:** `venues.holds.manage` (VS).
- **Body:** `{ expires_at }`, the only key, an ISO date-time with a time zone in the future.
- **200:** `{ hold }`, still `tentative`, with the new `expires_at`.
- **Errors:**
  - 400 `Enter a new future expiry with a time zone, different from the current one.`
  - 400 an invalid `holdId` gets the same message as 8.4
  - 404 `Event, venue or tentative hold not found.`
  - 409 `This hold is no longer active. Place a new request.` (not tentative, or already past its deadline)
- **Data:** RPC `change_venue_hold_expiry(p_hold_id, p_expires_at)` under the venue then hold locks. It bumps `expiry_revision` (a new notice round), resets the warning, writes a `venue_hold_expiry` history row and sends an `expiry_changed` notice, plus a `warning` at once when the new expiry is inside the lead time.

### 8.7 GET /api/venue-bookings
- **Week 7:** New since W7 — SG2-51.
- **Source:** `venues/bookings.ts:89`.
- **Permission:** `venue_bookings.view` (VS, EC). The `?venue_id` form also needs `venue_bookings.by_venue` (VS), checked in the handler.
- **Query:** exactly one of `event_id` or `venue_id`.
- **200:** `{ bookings: [{ booking_id, venue_id, venue_name, event_id, event_name, starts_at, ends_at, status, cancelled_at, cancellation_reason, canceller_name, affected_by: [{ starts_at, ends_at, category, reason }], replacement: { request_id, venue_name }|null }] }`
- **Errors:**
  - 400 `Give either event_id or venue_id.` (or a bad ID)
  - 403 `Access denied` (`venue_id` without VS)
  - 404 `Event not found.` / `Venue not found.`

### 8.8 POST /api/venue-bookings/:bookingId/release
- **Week 7:** New since W7 — SG2-51; W7 #3 — SG2-82, SG2-83.
- **Source:** `venues/bookings.ts:142`; `db/venueBookings.ts`; migration `202610210002_venue_booking_change_cancel.sql` (`release_venue_bookings`, replacing `release_venue_booking`).
- **Permission:** `venue_bookings.release` (EC only since SG2-83 AC5; Venue Staff mark the venue unavailable instead, 6.13). The RPC allows only the event's assigned coordinator.
- **Body:** `{ reason, also_cancel? }`. `reason` is required, at most 500 characters. `also_cancel` is an optional list of at most 50 other booking IDs of the same event to cancel in the same call; nothing else is touched unless named (SG2-83 AC1/AC2).
- **200:** `{ booking_id, status: "cancelled", cancelled_at, cancellation_reason, also_released: number[], returned_to_planning }`
- **Errors:**
  - 400 `Invalid booking ID.`
  - 400 `Give a reason for releasing this booking, in 500 characters or fewer.`
  - 400 `Choose at most 50 other bookings of this event to cancel as well.`
  - 404 `Booking not found.` (also another coordinator's booking)
  - 409 `This booking has already been released.` / `Only a confirmed booking can be released.` / `This booking has already ended, so there is nothing to release.`
  - 409 `Each other booking chosen must be a confirmed booking of this event that has not ended. Nothing was cancelled.`
- **Data:** RPC `release_venue_bookings(p_booking_id, p_also_cancel, p_reason)`, one transaction under the venue locks. The RPC:
  - cancels each booking and its approved request, and withdraws any pending replacement request that pointed at it
  - moves `events.venue_booking_id` to the earliest remaining confirmed booking (SG2-82)
  - writes history (who, when, why) and `venue_booking_released` notices to the coordinator and organiser, plus a `venue_booking_cancelled` notice to every Venue Staff account (SG2-83 AC4)
  - returns a Confirmed or Preparation event to Planning with a venue recheck outstanding (SG2-83 AC7)

### 8.9 GET /api/venue-clashes
- **Week 7:** #1 — SG2-79.
- **Source:** `venues/clashes.ts:50`.
- **Permission:** `venue_clashes.view` (VS, EC).
- **200:** `{ clashes: [{ booking: { booking_id, venue_id, venue_name, event_id, event_name, starts_at, ends_at }, clashes_with: {...}, flagged_at }] }`. Each pair appears from both sides.
- **Errors:** 503.
- **Rule:** an EC sees only rows whose `booking` is their event.
- **How flags are kept:**
  - Rows live in the `venue_booking_clashes` table.
  - `refresh_venue_booking_clashes()` rebuilds them from triggers on `venue_operations` and `venue_bookings` (`202610140003_venue_booking_clashes.sql`).
  - New flags send a `venue_booking_clash` notice; bookings themselves are never changed.

---

## 9. Equipment

### 9.1 GET /api/equipment
- **Week 7:** New since W7 — SG2-52.
- **Source:** `equipment/index.ts:43`.
- **Permission:** `equipment.read` (TSS).
- **200:** `{ equipment: [{ equipment_id, type, description, quantity_held, location, operational_status, available_quantity, version }] }`
- **Data:** table `equipment`, through the user-scoped client.

### 9.2 POST /api/equipment
- **Week 7:** New since W7 — SG2-52.
- **Source:** `equipment/index.ts:44`; `equipment/fields.ts`.
- **Permission:** `equipment.create` (TSS).
- **Body:**
  - `type`: at most 255 characters
  - `description`, `location`: at most 2000 characters
  - `quantity_held`: integer, 0 or more
  - `operational_status`: `operational`, `damaged` or `maintenance`
- **201:** `{ equipment }`
- **Errors:** 400 (field message); 503 `Equipment could not be saved.`

### 9.3 PATCH /api/equipment/:equipmentId
- **Week 7:** New since W7 — SG2-52.
- **Source:** `equipment/index.ts:45`.
- **Permission:** `equipment.update` (TSS).
- **Body:** the fields from 9.2 plus `version`.
- **200:** `{ equipment }`
- **Errors:**
  - 400 `Invalid equipment ID.`
  - 400 field message
  - 400 `Refresh the equipment record before saving.`
  - 409 `Equipment has changed or is no longer editable. Refresh the record before saving again.` (optimistic `version` check)

### 9.4 GET /api/equipment-requests
- **Week 7:** New since W7 — SG2-53.
- **Source:** `equipment/requirements.ts:77`.
- **Permission:** `equipment_requirements.read` (EC, TSS, SO).
- **Query:** `event_id` (required).
- **200:**
  - `event`: `{ event_id, name, status }`
  - `requests[]`: `{ request_id, equipment_id, equipment_type, quantity, notes, status, arrangement_notes, shortfall, placement_venue_id, placement_venue_name, placement_position, version }`
  - `equipment[]`, `venues[]` (`venues` lists only the event's placement venues: pending/approved venue requests or confirmed bookings for the event)
  - `can_request`, `can_arrange`
- **Errors:**
  - 400 `Choose a valid event.`
  - 404 `Event or equipment request not found.`
  - 400 `Check the equipment, quantity, shortfall and placement values.`
- **Rule:** an EC only for their own events.
- **Data:** RPC `manage_equipment_requirements('read', …)`. The latest definition is in `202610290003_equipment_placement_event_venues.sql`.

### 9.5 POST /api/equipment-requests
- **Week 7:** New since W7 — SG2-53.
- **Source:** `equipment/requirements.ts:78`.
- **Permission:** `equipment_requirements.request` (EC).
- **Body:** `event_id`, `equipment_id` and `quantity` (each at least 1); `notes` optional, at most 2000 characters.
- **201:** the RequirementsView, as in 9.4.
- **Errors:**
  - 400
  - 404
  - 409 `This event or request is no longer being arranged. Refresh before continuing.`
  - 409 `This equipment already has a pending request for the event.`
- **Rule:** only the assigned EC; the event must be `approved` or `planning`.
- **Data:** RPC `manage_equipment_requirements('create', …)`.

### 9.6 PATCH /api/equipment-requests/:requestId
- **Week 7:** New since W7 — SG2-53.
- **Source:** `equipment/requirements.ts:79`.
- **Permission:** `equipment_requirements.request` (EC).
- **Body:** as 9.5, plus `version`.
- **200:** RequirementsView.
- **Errors:**
  - as 9.5
  - 400 `Refresh a valid equipment request before saving.`
  - 409 `This request changed. Refresh before saving again.`
- **Rule:** only pending requests.

### 9.7 PATCH /api/equipment-requests/:requestId/arrangement
- **Week 7:** New since W7 — SG2-53.
- **Source:** `equipment/requirements.ts:80`.
- **Permission:** `equipment_requirements.arrange` (TSS).
- **Body:**
  - `event_id`, `version`
  - `shortfall`: 0 or more
  - `arrangement_notes`: optional
  - `placement_venue_id` and `placement_position`: either both set or both null; the venue must be one the event has requested (pending or approved) or booked (confirmed)
- **200:** RequirementsView.
- **Errors:**
  - as 9.6
  - 409 `Choose a venue this event has requested or booked.`
- **Data:** RPC `manage_equipment_requirements('arrange', …)`.

### 9.8 GET /api/equipment-requests/:requestId/availability
- **Week 7:** New since W7 — SG2-54.
- **Source:** `equipment/availability.ts:18`.
- **Permission:** `equipment.availability.read` (TSS).
- **Query:** `event_id` (required). `starts_at` and `ends_at` are optional but must be sent together, as ISO strings with a time zone.
- **200:** one of two shapes:
  - `{ status: "ready", event_id, request_id, equipment_id, equipment_type, quantity_requested, quantity_held, quantity_committed, quantity_remaining, shortfall, undated_commitments, operational_status, starts_at, ends_at, period_source, checked_at }`
  - `{ status: "dates_required", proposed_start }`
- **Errors:**
  - 400 `Choose a valid event and equipment request.`
  - 400 `Choose a complete time period with a time zone and an end after its start.`
  - 404
- **Data:** RPC `check_equipment_availability` (`202610120001_equipment_availability.sql`). Read-only.

### 9.9 POST /api/equipment-requests/:requestId/reservation
- **Week 7:** New since W7 — SG2-55.
- **Source:** `equipment/reservations.ts:76`. This is a plain router mounted at `/api`.
- **Permission:** `requireAuth` + `equipment.reservations.manage` (TSS).
- **Body:** only `event_id`, `version`, `starts_at` and `ends_at`; the times are ISO strings with a time zone.
- **Start time:** `starts_at` must be in the future, otherwise 400 `Choose a reservation start in the future.` (the RPC also enforces it, `202610310001_equipment_reservation_future_start.sql`).
- **201:** `{ can_reserve, reservations[], coordinator_notified: true }`
- **Errors:** `{ error, code }`, where `code` is one of:
  - 400 `invalid`
  - 404 `missing`
  - 409 `closed`
  - 409 `conflict`
  - 409 `insufficient`: `There is not enough operational equipment available for this period. Refresh availability before trying again.`
- **Data:** RPC `manage_equipment_reservations('reserve', …)` (`202610140001_equipment_reservations.sql`). Under a lock, the RPC:
  - inserts into `equipment_reservations`
  - sets the request to `approved`
  - sends an `equipment_reserved` notice to the coordinator

### 9.10 GET /api/equipment-reservations
- **Week 7:** New since W7 — SG2-55.
- **Source:** `equipment/reservations.ts:75`.
- **Permission:** `requireAuth` + `equipment_requirements.read` (EC, TSS, SO).
- **Query:** `event_id` (required); no other keys are allowed.
- **200:** `{ can_reserve, reservations: [{ reservation_id, event_id, request_id, equipment_id, equipment_type, quantity_reserved, starts_at, ends_at, reserved_at }] }`
- **Errors:** 400 `Choose a valid event.`; 404 / 400 `{ error, code }`.
- **Data:** RPC `manage_equipment_reservations('read', …)`.

---

## 9A. Event search (SG2-70)

### 9A.1 GET /api/event-search
- **Source:** `eventSearch/index.ts` (`createEventSearchRouter`), `db/eventSearch.ts`, migration `202610200005_event_search.sql` (`search_events`).
- **Permission:** `events.search` (EC, VS, TSS, Lead, Safety Officer). `search_events` runs with the caller's JWT and acting role (SG2-104) and rechecks that role, so a role changed after sign-in, or an account acting as a non-internal role, is refused (403). Results are only the events that acting role may see (`private.event_relationship_exists()`; see docs/authorization.md).
- **Query (all optional; blank leaves the filter out):** `q` (name or client organisation, case-insensitive, at most 255 characters), `from` and `to` (YYYY-MM-DD, inclusive, Singapore calendar days on `proposed_date`), `status` (any event status except `draft`), `venue` (venue id; an event booked, held or requested there), `category` (one of the list in 4.1), `coordinator` (account id, or `unassigned` for events with no coordinator). A repeated or malformed value is 400 naming it.
- **200:** `{ events: [{ event_id, name, organisation, category, status, proposed_date, coordinator_id, coordinator_name, venues[] }], truncated, filters }`. At most 100 events, soonest first; `truncated` is true when more matched. Drafts are never returned. `filters` echoes what was applied (`query, date_from, date_to, status, venue_id, category, coordinator_id`) for the empty state.
- **Errors:** 400 for a malformed filter, 401/403 for an unsigned or non-internal caller, 503 otherwise without database detail.

### 9A.2 GET /api/event-search/options
- **Permission:** as 9A.1 (`event_search_options`).
- **200:** `{ venues: [{ venue_id, name }], coordinators: [{ user_id, name }] }`: venues not deleted, and every Event Coordinator account plus anyone still assigned to a submitted event after losing that role.

## 9B. Events open for registration (SG2-59)

### 9B.1 GET /api/registrable-events
- **Source:** `registrableEvents/index.ts` (`createRegistrableEventsRouter`), `db/registrableEvents.ts`, migration `202610220003_registrable_events.sql` (`registrable_events`).
- **Permission:** `events.registrable.read` (Attendee). `registrable_events` runs with the caller's JWT and acting role (SG2-104) and refuses (403) unless that role is `attendee`.
- **Listed:** status `confirmed`, `registration_needed` true, both registration times set, `now < registration_closes_at` and the event not started. That covers registration open now and registration that opens later (team reading of AC1/AC2, 22 Oct 2026, so SG2-60 AC3 can say when it opens). Closed, unconfirmed and walk-in events are never returned. Soonest first.
- **200:** `{ events: [{ event_id, name, organisation, category, description, proposed_date, registration_opens_at, registration_closes_at, venues: [{ name, location }] }] }`. Venues are the event's confirmed bookings. No other event field is returned (AC3).
- **Errors:** 401/403 for an unsigned or non-attendee caller, 503 otherwise without database detail.

### 9B.2 GET /api/registrable-events/:eventId
- **Permission:** as 9B.1 (`registrable_event`).
- **200:** `{ event }` with the same fields as one list item.
- **Errors:** 400 for an id that is not a positive 32-bit integer; 404 `This event is not open for registration.` for any event the list would not show, whether it exists or not; 401/403/503 as 9B.1.

### 9B.3 POST /api/registrable-events/:eventId/registrations (SG2-60)
- **Source:** `registrableEvents/index.ts`, `registrableEvents/registration.ts` (`readRegistration`), `db/registrableEvents.ts` (`register`), migration `202610230001_event_registration.sql` (`register_for_event`).
- **Permission:** `events.register` (Attendee). `register_for_event` runs with the caller's JWT, rechecks the acting role with `lock_acting_role()` (403 otherwise) and registers only the caller.
- **Body:** `{ contact_phone: string, needs?: string | null }`. `contact_phone` is required: a Singapore number of 8 digits, optionally `+65`, `()-.` and spaces ignored, at most 40 characters. `needs` (accessibility or dietary) is optional, at most 500 characters; blank is none. Both are trimmed. Any other field is refused.
- **201:** `{ registration: { registration_id, event_id, registered_at, contact_phone, needs } }`. The place is held and a `registration_confirmed` notification is sent to the attendee.
- **Errors:** 400 for a bad event id (as 9B.2), or `{ error: 'Check your registration details.', errors: [...] }` for the body, checked before the database is asked (the database's own refusal has no `errors`); 404 `This event is not open for registration.` for any event SG2-59 would not list as registrable (not confirmed, no registration, unset times or date, missing); 409 `{ error, reason }` with `reason` `duplicate` (`You are already registered for this event.`), `closed` (`Registration for this event has closed.`, with `registration_closes_at`; also once the event has started), `not_open` (`Registration opens 01 Jun 2030 08:00 SGT.`, with `registration_opens_at`) or `full` (`This event is full.`); 401/403/503 as 9B.1. Checked in that order, under the event row lock.
- **9B.1/9B.2** also return `registered`: whether the caller already holds an active registration.

### 9B.4 GET /api/my-registrations (SG2-62)
- **Source:** `myRegistrations/index.ts`, `db/myRegistrations.ts` (`list`), migration `202610260003_registration_withdrawal.sql` (`my_registrations`).
- **Permission:** `registrations.mine.read` (Attendee). `my_registrations` runs with the caller's JWT, rechecks the acting role with `acting_role()` (403 otherwise) and reads only the caller's registrations.
- **200:** `{ registrations: [{ registration_id, event_id, standing, can_withdraw, registered_at, withdrawn_at, contact_phone, needs, event: { name, organisation, category, description, proposed_date, registration_closes_at, venues: [{ name, location }] } }] }`. `standing` is `registered`, `withdrawn`, `event_cancelled`, `event_completed` or `event_started`; `can_withdraw` is true only for `registered`. Active ones for events yet to start come first, then by date. Events stay listed after registration closes.
- **Errors:** 401/403; 503 `Your registrations are temporarily unavailable. Please try again.`

### 9B.5 POST /api/my-registrations/:registrationId/withdrawal (SG2-62)
- **Source:** `myRegistrations/index.ts`, `db/myRegistrations.ts` (`withdraw`), migration `202610260003_registration_withdrawal.sql` (`withdraw_registration`).
- **Permission:** `registrations.withdraw` (Attendee). `withdraw_registration` runs with the caller's JWT, rechecks the acting role with `lock_acting_role()` and withdraws only the caller's own registration. It locks the event row first, as 9B.3 does.
- **Body:** none.
- **200:** `{ withdrawal: { registration_id, event_id, withdrawn_at } }`. The registration is stored as `cancelled` with `withdrawn_at`, giving its place back, and the organiser and the assigned coordinator are each sent a `registration_withdrawn` notification.
- **Errors:** 400 `registrationId must be a positive integer.`; 404 `This registration was not found.` for one that is not the caller's or does not exist; 409 `{ error, reason }` with `reason` `withdrawn` (`You have already withdrawn from this event.`), `cancelled` (`This event has been cancelled.`) or `started` (`This event started 20 Jul 2030 19:00 SGT, so you can no longer withdraw.`, with `proposed_date`; also for a completed event); 401/403/503 as 9B.4. Checked in that order. Registration having closed does not stop a withdrawal.

### 9B.6 POST and DELETE /api/registrable-events/:eventId/waiting-list (SG2-61)
- **Source:** `registrableEvents/index.ts`, `db/registrableEvents.ts` (`joinWaitingList`, `leaveWaitingList`), migration `202610280001_waiting_list.sql` (`join_waiting_list`, `leave_waiting_list`).
- **Permission:** `events.register` (Attendee): joining the list is how an attendee registers for a full event. Both functions run with the caller's JWT, recheck the acting role with `lock_acting_role()` and lock the event row first, as 9B.3 does.
- **POST 201:** `{ waiting: { status: 'waiting', position, joined_at } }` (position 1 is next). Only a full event that is open for registration takes joins.
- **POST errors:** 400 for a bad event id; 404 as 9B.3; 409 `{ error, reason }` with `reason` `already` (`You are already on the waiting list for this event.`, with `waiting`: the position, or `{ status: 'offered', offer_expires_at, joined_at }`), `registered` (`You are already registered for this event.`), `not_full` (`Places are still available. Register instead.`), `not_open` or `closed` (as 9B.3); 401/403/503 as 9B.1.
- **DELETE 200:** `{ left: true }`, at any time. A place held for the caller passes to the next attendee. **404** `You are not on the waiting list for this event.`
- **9B.1/9B.2** also return `full` (every place is held by a registration or someone else's running offer) and `waiting` (the caller's standing on the list, or null). **9B.3** now takes a place offered to the caller even when the event otherwise reads as full, sends `registration_full` to the organiser and coordinator when it takes the last place, and takes the caller off the list.
- **SG2-63's picture** (`GET /api/event-requests/:eventId/registrations`) adds `waiting_list_response_hours` and `waiting_list: [{ entry_id, name, organisation, status, joined_at, offer_expires_at, position }]`; the settings (`PATCH .../registration-settings`) accept `waiting_list_response_hours`, a whole number from 1 to 168.

## 10. Health

### 10.1 GET /health and GET /api/health
- **Source:** `app.ts:277-289`. One registration serves both paths.
- **Callers:** public.
- **200:** `{ status: "ok", uptime, timestamp, service: "ConnectSphere Backend", database: { provider: "Supabase", configured, supabaseClient } }`

### 10.2 GET /health/db and GET /api/health/db
- **Source:** `app.ts:292-320`. One registration serves both paths.
- **Callers:** public.
- **200:** `{ status: "ok", …, database: { provider, configured, supabase: { configured, status } } }`
- **503:** `status: "degraded"` when Supabase is configured but unreachable, or `{ status: "degraded" }` if the check throws.
- **Data:** an HTTPS GET to `<SUPABASE_URL>/auth/v1/health`.

---

## 11. Work still without an endpoint

None. At `4881413` every route registered in `app.ts` and the routers it mounts is in §2 (108 pairs), and no Week 7 change or Sprint 4 story waits for an endpoint:
- **Week 7 changes #1 to #6:** setup and turnaround (6.6 to 6.10, 8.9), unavailability and replacement (6.12 to 6.14, 7.1, 7.4), several venues per event (7.1, 7.5, 8.8), tentative holds with expiry (§8, 8.6a), the Event Coordinator Lead (4.7, 4.8, 5.1, 5.4) and the safety check (4.26 to 4.28, 5.5 to 5.7).
- **Sprint 4:** registration (9B, 4.13a), cancellation (4.20, 4.21), change requests (4.22 to 4.25), the notification inbox (5.8 to 5.12), event search (9A), multi-role accounts ([Acting role](#acting-role-sg2-104), 3.1, 3.3, 3.4), required fields (4.6) and venue delete and hold expiry (6.3a, 8.6a).

The epics SG2-13, SG2-14, SG2-16, SG2-17 and SG2-18 are not built and have no endpoint; they are not part of this specification.

---

## Doc vs code
In each case the code wins, and this spec follows the code.
1. **`docs/authorization.md` vs `PATCH /api/users/:userId/role`.** The doc says the module "does not … expose an endpoint for changing roles", but `app.ts:201` mounts one (`users.role.update`, TSS).
2. **`docs/authorization.md` vs the service-role key.** The doc says the auth module "does not use the service-role key". That is true of `requireAuth`, but logout and most event, queue, profile, suitability, booking-request and clash handlers use the service-role client (`getSupabaseAdminClient`). See ADR-02 in [architectural-decisions.md](architectural-decisions.md).
3. **Status transitions.** `STATUS_TRANSITIONS` and `canTransition` no longer exist: PR #120 (SG2-22, commit `ca54162`) removed them from `events/fields.ts`, and nothing in `server/src` references them. Each handler or RPC enforces its own status guards (for example `confirm_event`, `cancel_event`, `record_safety_decision`), and database triggers guard two transitions: `safety_approval_gate` (no move into Preparation except through a Safety Officer Approve) and `keep_cancelled_events_cancelled`. Docs that still cite the table (`docs/event-cancellation.md`, `docs/event-confirmation.md`, `docs/organisation-events.md`, `docs/venues.md`) are out of date on this point.

## How the route list was verified
1. **Registrations:** every `app.(get|post|use)` in `app.ts`, and every `router.(get|post|patch|put|delete)` / `eventRequests.*` / `rolesRouter.*` / `safetyRereviews.*` registration in the mounted routers (`server/src/{auth,events,venues,equipment,notifications,profile,workQueue,assignmentQueue,safetyChecks,eventSearch,registrableEvents,myRegistrations,coordinatorOverview}/*.ts`), were listed with a regex and joined to their mount prefixes, re-run against `main` at `4881413` (3 Nov 2026).
2. **Count:** 105 registrations give 108 method + path pairs. Three registrations serve two paths each (the work queue and the two health checks). By area: auth 3, role update 1, event requests 32, safety re-reviews 2, venues 15 (availability 2, search 1, suitability 1, venues 4, layouts 2, operations 2, blocks 3), venue booking requests 8, notifications 7, venue holds 7, venue bookings 2, venue clashes 1, equipment 10, assignment queue 1, safety checks 1, event search 2, registrable events 5, my registrations 2, coordinator overview 1, profile 2, work queue 2, health 4. The earlier revision's 74 pairs are rows 1 to 74; rows 75 to 108 are the additions since.
3. **Permissions:** each permission key in §2 is the literal argument to `requirePermission` at that registration, and each role list is that key's entry in `PERMISSIONS` (`server/src/auth/policy.ts`). Routes that carry no key are login, logout, health and `/api/auth/me`.
