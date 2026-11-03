# ConnectSphere architectural decisions and Week 7 change log — as of main `4881413` (3 Nov 2026)

Revision note: the original 14 Oct design described main `1d1e336`, and the 16 Oct revision described PR90 head `61416cc`. This revision describes main `4881413` (3 Nov 2026), after the 23 Sprint 4 stories (SG2-56, SG2-59 to SG2-67, SG2-69, SG2-70, SG2-83, SG2-89, SG2-91 to SG2-94, SG2-96, SG2-102, SG2-104 to SG2-106) were merged. It does not claim hosted acceptance of every criterion. Story status comes from the Sprint 4 Jira state supplied for this revision; the implementation claims below were checked against the code, migrations and tests on `main`.

SG2-95. This document has three parts:

- **Part A** records the architecture decisions that are visible in the code at this snapshot today, as short ADRs.
- **Part B** is the Week 7 change log for customer changes #1–#6.
- **Part C** lists known limits.

Every statement cites the code or doc it comes from, and the code wins over the docs. Points that were reasoned out rather than read in the code are marked **[inference]**.

The companion artefacts in `docs/design/` are:

| File | Contents |
|---|---|
| `connectsphere.dsl` | C4 L1–L3 |
| `class-diagram.puml` | domain classes |
| `data-model.puml` | ER model |
| `sequence-diagrams.puml` | eight flows (the five Week 7 flows, plus registration, change request and cancellation) |
| `event-status-model.puml` | event status state machine |
| [`api-specification.md`](api-specification.md) | every endpoint |

---

## Part A — Architecture decisions (ADRs)

Each ADR is **Accepted**, meaning it is in force at this snapshot.

### ADR-01 Three tiers: React SPA, Express API, Supabase

**Context.** ConnectSphere serves seven roles. Its rules, such as approvals, double-booking and hold expiry, have to hold no matter which screen or client calls them. The team needed managed Postgres and authentication, plus a single place to enforce those rules.

**Decision.** The system has three tiers:

- **Client:** a React + Vite single-page app (`client/`). Its only contact with the server is HTTP calls to `/api/*`, sending the Supabase access token as a Bearer header.
- **API:** an Express 4 + TypeScript application (`server/src/app.ts`). It is the only place business rules run outside the database.
- **Data:** Supabase, providing Postgres (schema, RLS, RPCs, pg_cron) and Supabase Auth (identity and tokens). The schema history is in `supabase/migrations/*.sql`.

**Hosting.** The app is hosted on Vercel (`server/vercel.json`):

- The server build copies `client/dist` into `server/public`, which Vercel serves as static files.
- `/api/*` and `/health*` are routed to one serverless function, `api/index.js`, which wraps the Express app.
- `app.set('trust proxy', 1)` is there because of Vercel's single proxy hop (`app.ts:145`).
- In local development, Vite proxies `/api/*` to Express on port 5000 (`README.md`).

**Consequences.**

- One API surface: 108 endpoints, all listed in `api-specification.md`.
- Login goes through the API (`POST /api/auth/login`), and the browser never talks to Postgres directly.
- The serverless runtime has no long-running process, so time-based work runs in the database (ADR-08) **[inference about the motive]**.
- Each router builds its own Supabase client per request (`auth/supabase.ts`, `db/user-client.ts`). These clients use a 5 s timeout and `redirect: 'error'`.

**Where:** `client/`, `server/src/app.ts`, `server/vercel.json`, `server/api/index.js`, `README.md`.

### ADR-02 Server-side RBAC through a permission map, with RLS as defence in depth

**Context.** There are seven roles: the original five, plus Event Coordinator Lead and Safety Officer, which Week 7 added (SG2-86). An account may hold several of them (SG2-104, ADR-09). Many rules depend on the particular record ("only the assigned coordinator", "only the creating organiser"). Roles must take effect without waiting for a new token to be issued.

**Decision.**

1. **Authenticate each request.** `requireAuth` (`server/src/auth/index.ts`) verifies the Bearer token with Supabase Auth, then reads every role the account holds from `public.account_roles` and picks the request's acting role (ADR-09). Token claims and request bodies never decide the roles. `protectedRouter()` applies this to every router; sibling routers on one request reuse the identity already verified for the same headers instead of calling Supabase Auth again.
2. **Check the permission.** `requirePermission(action)` checks one central map, `PERMISSIONS` in `server/src/auth/policy.ts`, where actions without a grant are denied. The client hides actions using `GET /api/auth/me`'s `permissions` list, but the server is the authority.
3. **Check the record.** Each handler enforces the per-row rule after the role check. Where possible it puts that rule inside the write itself, as a guarded `UPDATE … WHERE coordinator_id = caller AND status = …` (`server/src/db/eventRequests.ts`).
4. **Keep RLS on as a second line.** Row level security stays enabled on the tables. Examples:
   - `notifications_recipient` lets a user read only their own notifications.
   - `event_audit_logs_read` mirrors `INTERNAL_ROLES` and `INTERNAL_ONLY_AUDIT_FIELDS` from `policy.ts`.
   - `202610070002_legacy_table_rls.sql` turned RLS back on for older tables.

**Two database access modes are in use.** This matters for review.

| Mode | Client | RLS applies? | Used by |
|---|---|---|---|
| User-scoped | `createUserScopedClient(token)` (`db/user-client.ts`) | **Yes**. The caller's JWT (and `X-Acting-Role`) is sent to PostgREST | Venues (including delete), layouts, operations, blocks, availability, search, equipment (all), notifications and the inbox, holds (including expiry), event search, registrable events, my registrations, safety checks, and the RPC writes `confirm_event`, `decide_venue_booking_request`, `withdraw_venue_booking_request`, `release_venue_bookings`, `request_event_cancellation`, `cancel_event`, `register_for_event`, `withdraw_registration`, `join_waiting_list`, `leave_waiting_list` |
| Service role | `getSupabaseAdminClient()` (`db/supabase.ts`) | **No**, RLS is bypassed | Event-request handlers (`server/src/events/*` except `confirm` and `cancellation`), including change requests, safety decisions and the registration picture and settings; safety re-reviews, coordinator overview, profile, work queue, assignment queue, role update, logout, suitability, booking-request create/list/conflicts, bookings list, clashes |

**Consequences.**

- For service-role paths, the handler's per-row check is the **only** row-level gate. Tests and reviews must cover it there.
- Lists that the code says "must change together" are duplicated between TypeScript and SQL: `INTERNAL_ROLES` and the `event_audit_logs` policy (`202610130001_event_history_internal_fields.sql`).
- `docs/authorization.md` says the auth module "does not use the service-role key". That holds for `requireAuth`, but not for the handlers listed above.

**Where:** `server/src/auth/{index,policy,supabase}.ts`, `server/src/db/{user-client,supabase}.ts`, `docs/authorization.md`.

### ADR-03 Concurrency-sensitive writes run in SECURITY DEFINER RPCs that take row locks

**Context.** Two people can act on the same venue or event at the same moment: two approvals for one period, a hold expiring while it is being converted, or a withdrawal racing a decision. Checking and then writing from the API would leave a gap between the two steps.

**Decision.** Writes that must be atomic are Postgres functions. Each is declared `security definer`, `set search_path = ''` and granted to `authenticated`. Each:

- rechecks the caller (`auth.uid()` plus `account_roles`, raising `42501` on refusal),
- takes row locks in a fixed order (**venue → request/hold → event**, `select … for update`),
- re-reads the clock, checks, and then writes the row, the history entry and the notifications in **one transaction**.

The RPCs are:

| Area | Functions |
|---|---|
| Venue decisions | `decide_venue_booking_request` |
| Holds | `create_venue_hold`, `change_venue_hold`, `change_venue_hold_expiry`, `process_venue_hold_deadlines` |
| Bookings, requests, venues | `release_venue_bookings` (replaced `release_venue_booking`, SG2-83), `withdraw_venue_booking_request`, `delete_venue` |
| Events | `confirm_event`, `request_event_cancellation`, `cancel_event` |
| Registration | `register_for_event`, `withdraw_registration`, `join_waiting_list`, `leave_waiting_list` |
| Equipment | `manage_equipment_requirements`, `manage_equipment_reservations` |
| Notifications | `notification_inbox`, `read_notification`, `read_all_notifications`, `set_notification_reminder_preferences` |

A second group is granted to `service_role` only and called by the API after its own checks, with the verified actor passed in: `raise_event_change_request`, `decide_event_change_request`, `apply_accepted_event_change`, `settle_arrangement_recheck`, `record_safety_decision`, `rework_safety_rejected_event`, `confirm_safety_rereview`, `update_event_request_draft`. Each is a single database function call; the API does not stitch their steps together.

The setup and turnaround gap is a shared internal function, `venue_preparation_gap()`. The hold sweep uses `for update skip locked` on venues so that a batch cannot deadlock (`202610050001_venue_holds.sql`).

Constraints act as a backstop below the RPCs:

- The exclusion constraint `venue_bookings_no_double_booking` stops two confirmed bookings overlapping, whichever path writes them (`202610070003_venue_double_booking.sql`).
- Check constraints guard state combinations, for example that `withdrawn_at` is set only when the request is `cancelled`.

**Consequences.**

- Business rules for these flows live in SQL. The API maps the RPC's `outcome` to an HTTP status.
- The TypeScript and SQL versions of a rule must agree. For example, readiness is checked in `arrangementReadiness.ts` and again in `confirm_event` (`docs/event-arrangements.md`).
- RPCs are redefined by later migrations, so the latest definition is in the newest migration that contains it.

**Where:** `supabase/migrations/2026100*`–`2026103*`, `server/src/db/venueBookingDecisions.ts`, `venueHolds.ts`, `eventConfirmation.ts`, `equipmentReservations.ts`, `eventCancellation.ts`, `registrableEvents.ts`, `safetyDecisions.ts`.

### ADR-04 Handler-side writes are guarded (optimistic) updates, not read-then-write

**Context.** Event-request flows written in TypeScript through the service-role client (ADR-02) cannot hold row locks across several calls.

**Decision.** Handlers guard their writes in two ways:

- **State guards.** Each `UPDATE`/`DELETE` repeats its preconditions in the `WHERE` clause (status, `coordinator_id`, `organiser_id`). Zero rows changed means a race was lost, and the handler returns 409, 404 or 503. Examples are `assignEventCoordinator`, `completeEvent` and the SG2-90 planning guard.
- **Version guards.** Editable inventory records carry a `version` column (equipment, equipment requests). A save that matches no `(id, version)` returns 409.

**Consequences.**

- There are no lost updates on a single row.
- Writes that span several statements are not atomic (Part C, items 1–2).

**Where:** `server/src/db/eventRequests.ts`, `server/src/db/equipment.ts`, `server/src/events/*`.

### ADR-05 Times are stored as UTC instants and shown in Singapore time

**Context.** All users are in Singapore. Postgres and JavaScript both work in instants.

**Decision.**

- **Storage.** All columns are `timestamptz`; there is no local-time column. The API exchanges ISO 8601 strings.
- **Input.** The client treats every `datetime-local` input as Singapore time and converts it before sending. `sgtToIso()` appends `+08:00` (`client/src/venues/searchApi.ts`), and the request form and venue-holds screen do the same.
- **Display.** The client formats every date with `Intl.DateTimeFormat(…, { timeZone: 'Asia/Singapore' })` (`formatSgt`, `WorkQueue.tsx`, `VenueHolds.tsx`, `blocksApi.ts`) and labels it "(SGT)" or "Singapore time".
- **Explicit offsets.** The newer endpoints insist on an explicit offset: holds (`holdFields.ts`), equipment availability and reservations.

**Consequences.**

- Singapore has no daylight saving, so a fixed `+08:00` is safe.
- The server does not depend on its own time zone, except for the endpoints that accept zone-less strings (Part C, item 5).

**Where:** `client/src/venues/searchApi.ts`, `client/src/screens/*`, `server/src/venues/holdFields.ts`, `server/src/equipment/{availability,reservations}.ts`.

### ADR-06 Every change to an event is kept as field-level history

**Context.** Organisers, coordinators and staff need to see who changed what on an event, and when (SG2-40). Week 7 needs the Lead to see previous coordinators (SG2-97) and the expiry of a hold to be recorded (SG2-85).

**Decision.** A single append-only table, `event_audit_logs`, stores one row per changed field: `event_id, actor_id, field_name, old_value, new_value, created_at`.

- **Status changes** are rows with `field_name = 'status'` (`statusChange()`, `server/src/db/auditLogs.ts`).
- **Who writes the rows.** Some existing handlers write through the service-role client after the main write. RPCs write within the transaction for venue decisions, holds, release, withdraw and confirm. The SG2-40 draft-history repair adds `update_event_request_draft`: existing draft/clarification saves and all nine field diffs commit together. It locks and rechecks the verified creator, role, exact membership and editable status; only the service role may call it. Unchanged values create no history, and an audit failure rolls back the saved values. Earlier missing draft edits are not backfilled.
- **System actions** have `actor_id = null`, for example hold expiry.
- **Internal-only fields** (`INTERNAL_ONLY_AUDIT_FIELDS = ['planning_notes']`) are hidden from Event Organisers, both by the handler and by RLS.
- **Venue settings** have their own history table: `venue_operation_history` is written only by a trigger (SG2-77 AC6, `202610050003_venue_operations.sql`).

**Consequences.**

- One history drawer covers every flow.
- History still written separately by other handlers is not atomic with the change it records (Part C, item 1). The repaired draft-save RPC is an explicit exception; this change does not claim that every existing handler has been converted.

**Where:** `supabase/migrations/202609240000_event_planning_and_audit.sql`, `202610130001_event_history_internal_fields.sql`, `202610170003_event_draft_change_history.sql`, `server/src/db/{auditLogs,eventRequests}.ts`, `server/src/events/{getHistory,updateDraft}.ts`.

### ADR-07 Notices are rows in a notifications table, which the client polls

**Context.** People must learn about decisions that affect them: a venue approved or rejected, a booking released, equipment reserved, a clash, an event confirmed or submitted, a coordinator assigned. Week 7 adds hold warnings and expiry notices (SG2-84/85) and the Lead's "waiting for a coordinator" notice (SG2-68). Sprint 4 adds change-request, safety, cancellation, registration, waiting-list and attendee event-change notices, and a recipient-scoped inbox (SG2-69).

**Decision.**

- **One notices table.** `public.notifications` holds one row per recipient, with a `kind` check list that each Sprint 4 migration extends. RLS lets a user `select` only their own rows; only `service_role` and SECURITY DEFINER functions can insert.
- **Writers.** Rows come from RPCs (venue decision, release, reservation, clash refresh, confirm, cancellation, registration, change-request decisions) or from handlers through `notifyEvent()` (`server/src/db/eventNotifications.ts`, SG2-68). The actor is never notified of their own action.
- **Reading.** `GET /api/notifications` returns the newest 50 of the `notifications` table for the roles holding `notifications.read`. Since SG2-69 every role reads through `GET /api/notifications/inbox` (`notifications.inbox`), which merges `notifications` and `venue_hold_notifications` newest first with a keyset cursor, an unread count and `read_at` (migration `202610200003_notifications_inbox_reminders.sql`); the client polls, there is no push.
- **Hold notices** (`placed`, `warning`, `expired`, `expiry_changed`) live in the separate table `venue_hold_notifications`, read through `GET /api/venue-holds/notifications` and through the inbox. The client refreshes them every 30 s and on focus (`docs/venue-holds.md`).

**Consequences.**

- Notices are simple to secure, because RLS limits each user to their own rows.
- There are still two tables; only the inbox presents them as one list.
- Read/unread state exists (`read_at` on both tables), but only on the inbox endpoints; `GET /api/notifications` does not return it.

**Where:** `202610060001_venue_booking_decisions.sql` (table and policy), `202610160001_event_notifications.sql`, `202610050001_venue_holds.sql`, `202610200003_notifications_inbox_reminders.sql`, `server/src/notifications/index.ts`, `docs/notifications.md`, `docs/notification-inbox.md`.

### ADR-08 Time-based work runs in the database on pg_cron

**Context.** Tentative holds must expire on time, with a warning beforehand (Week 7 change #4), even when nobody has the app open. Sprint 4 added three more time-driven jobs: registration windows, waiting-list offers and arrangement reminders.

**Decision.**

- **Scheduled job.** pg_cron job `venue-hold-deadlines` runs `public.process_venue_hold_deadlines()` every minute (`* * * * *`) inside Supabase.
- **Expiry.** The function expires overdue holds, which cancels the pending request and writes system history and an `expired` notice.
- **Warning.** It sends one `warning` notice once a hold falls within `venue_hold_settings.warning_lead_seconds`, which defaults to 86400 s (24 h).
- **Lazy processing.** The list RPCs run the same processing before they read.
- **Enforcement.** Every occupancy check filters on `expires_at > now`, so the clock is enforced at read and decision time regardless of the job.
- **No pg_cron.** If the extension is missing, the migration emits a notice telling operators to provision a scheduler.
- **Sprint 4 jobs.** `registration-windows` (every minute, `process_registration_windows()`, which opens and closes registration and sends `registration_opened` / `registration_closed`, `202610200004_event_registration_settings.sql`), `waiting-list-offers` (every minute, `process_waiting_list_offers()`, which lapses unanswered offers and offers the place to the next attendee, `202610280001_waiting_list.sql`) and `sg2-69-arrangement-reminders` (hourly, `send_outstanding_arrangement_reminders()`, at each coordinator's chosen cadence, `202610200003_notifications_inbox_reminders.sql`).

**Consequences.**

- No server timer is needed (ADR-01).
- Notices can arrive up to one minute late, but enforcement is never late.

**Where:** `supabase/migrations/202610050001_venue_holds.sql:126-150,302-312`, `202610200003`, `202610200004`, `202610280001`, `docs/venue-holds.md`.

### ADR-09 One request, one acting role (multi-role accounts, SG2-104)

**Context.** The customer clarified that one account can hold several of the seven roles, replacing "exactly one role" (SG2-24 AC1). Row level security and the permission map each ask "does the caller hold role X", so letting a multi-role account use every role at once would merge their powers (`202610180001_account_multi_roles.sql`).

**Decision.**

- **One acting role per request.** The client names it in the `X-Acting-Role` header; `requireAuth` checks that the account holds it and runs the rest of the request, including its database calls, as that role (`server/src/auth/actingRole.ts`, `AsyncLocalStorage`). A malformed or repeated header is 400, a role not held is 403.
- **Defaults.** With no header a single-role account acts as its role; a multi-role account acts as the least-privileged role it holds (`ACTING_ROLE_DEFAULT_ORDER`: attendee first, Technical Support last).
- **The database re-checks.** The header is forwarded to PostgREST; `public.acting_role()` returns it only if the caller's own `account_roles` rows contain it, and `lock_acting_role()` is used by the write RPCs. The acting role only ever narrows what the account holds (`202610200002_acting_role_functions.sql`).
- **Separation of duties.** Nobody changes their own roles: refused in `auth/roles.ts` and again in the database's `change_account_roles()` (`202610180001_account_multi_roles.sql`); `PATCH /api/users/:userId/role` replaces the whole role set and refuses to remove an account's last role. The Lead never makes an event's own organiser its coordinator, and Venue Staff never decide a venue request they raised themselves (`202610180003_separation_of_duties.sql`, `202610200002_acting_role_functions.sql`).

**Consequences.**

- Every `PERMISSIONS` check and RLS policy sees one role, so no endpoint needed a multi-role special case.
- `GET /api/auth/me` and login return both `role` (acting) and `roles` (held).
- Extra roles are granted in SQL, not through the API.

**Where:** `server/src/auth/{index,actingRole,roles,login}.ts`, `supabase/migrations/202610180001_account_multi_roles.sql`, `202610180003_separation_of_duties.sql`, `202610200002_acting_role_functions.sql`.

### ADR-10 Waiting-list places are offered with an expiring hold, decided under the event lock (SG2-61, SG2-62)

**Context.** When an event is full, attendees join a waiting list; when a place frees up it must go to the first person in line without two people taking the same place.

**Decision.**

- **Lock first.** `register_for_event`, `withdraw_registration`, `join_waiting_list`, `leave_waiting_list` and the capacity change all lock the event row before reading counts, so the last place is decided one attempt at a time.
- **Offers, not auto-registration.** A freed place (a withdrawal, or a capacity increase) is offered to the first waiting attendee (`waiting_list_offer` notice) and held for them for `events.waiting_list_response_hours` (1 to 168, default 24, team decision 28 Oct 2026), or until registration closes if sooner. A place counts as held by an active registration or an unexpired offer (`private.places_held`).
- **Lapse.** An unanswered offer lapses (`waiting_list_offer_lapsed`) and the place passes to the next attendee. The `waiting-list-offers` pg_cron job catches lapsed offers every minute (ADR-08) and every write catches them first.
- **Rules in the schema.** One active entry per attendee per event (partial unique index `waiting_list_one_active_per_attendee`); statuses `waiting`, `offered`, `registered`, `left`, `lapsed`.

**Consequences.** Offers are time-limited rather than instant, so a place can sit unfilled until its offer lapses. The response window is the organiser's setting (`PATCH …/registration-settings`).

**Where:** `supabase/migrations/202610280001_waiting_list.sql`, `server/src/registrableEvents/index.ts`, `server/src/db/registrableEvents.ts`, `server/src/events/registrationSettings.ts`.

### ADR-11 The safety approval is a database gate, and decisions are bound to a revision (SG2-92, SG2-94)

**Context.** Week 7 change #6 requires a Safety Officer's approval before an event can be prepared and confirmed. A check made only in the API could be bypassed by any other writer.

**Decision.**

- **Trigger gate.** `safety_approval_gate` refuses any move into `preparation` unless the event is leaving `awaiting_safety_check` on an Approve decision made during that wait; `record_safety_decision()` is the only writer that passes (`202610220001_safety_approval_gate.sql`). `confirm_event()` additionally lists `safety` as outstanding unless a current approval exists.
- **Stale-review guard.** `events.safety_check_revision` changes whenever an event moves into or out of the check; a decision carries the revision the Safety Officer reviewed and is refused (409 `code: "stale"`) if the event has since changed (`202610190006_safety_decision_revision.sql`).
- **History is append-only.** Decisions go to `event_safety_decisions`; an approval stops counting when the event leaves Preparation/Confirmed, without editing the history.
- **Request Changes** sends named venue bookings or equipment requests back to Venue Staff or Technical Support (`safety_rereviews`), and the event waits in Planning with `safety_*_recheck` keys until each is confirmed again and the coordinator settles the rest (`202610240001_safety_changes_requested.sql`). Rework of a Safety Rejected event leaves an explicit resubmit step (`202610290002_safety_rework_resubmit.sql`).

**Consequences.** The rule holds whichever client calls; the cost is that the TypeScript readiness mirror (`arrangementReadiness.ts`) and the SQL must change together (ADR-03).

**Where:** `supabase/migrations/202610190004_safety_check_queue.sql` to `202610290002_safety_rework_resubmit.sql`, `server/src/events/{safetyDecisions,safetyDecisionRoutes,safetyRereviewRoutes}.ts`, `server/src/safetyChecks/index.ts`, `docs/safety-checks.md`.

---

## Part B — Week 7 change log

The log follows the IS212 Managing Changes guide:

- **§1 Record the change:** what changed and why.
- **§2 Classify it:** a new requirement, or a clarification/change of an existing one, together with the stories.
- **§5 Update the design artefacts:** which artefacts changed, and how.

The guide itself is not in the repo, so the headings follow the SG2-95 brief.

**Story status** originally came from the SG2-95 brief and is refreshed against the Sprint 4 Jira state: all stories listed in this Part are Done and merged on `main` at `4881413`. Implementation claims below were checked against the code at that head; status alone is not acceptance evidence. Diagrams mark Week 7 additions `<<Week 7>>` (`#FFF4CC`); the `<<planned>>` style was for work not yet built, and no Week 7 change is unbuilt any more.

### Summary
| # | Change | Type | Built at this snapshot | Not built |
|---|---|---|---|---|
| 1 | Venue setup & turnaround time in availability and conflicts | New requirement that changes the existing conflict rule | SG2-77, SG2-78, SG2-79 | — |
| 2 | Venue temporarily unavailable; replace it | Change to an existing requirement (supersedes SG2-45 AC2) + new requirement (replace) | SG2-80, SG2-81 (replace), SG2-98 (remediation) | — |
| 3 | More than one venue per event | Clarification of an existing requirement (SG2-48 AC4 already allowed several requests) | SG2-82, SG2-83 (change/cancel one venue) | — |
| 4 | Tentative venue holds with expiry | New requirement (the legacy `held` booking status had no expiry or lifecycle) | SG2-84, SG2-85, SG2-106 (hold expiry change) | — |
| 5 | Event Coordinator Lead assigns coordinators | Change to an existing requirement: the assigning role moves from TSS to a new role | SG2-86, SG2-87, SG2-88, SG2-89, SG2-90, SG2-97 | — |
| 6 | Operational safety check by a Safety Officer | New requirement | SG2-86 (role), SG2-77 (venue safety details), SG2-100 (statuses), SG2-91, SG2-92, SG2-93, SG2-94 (epic SG2-76) | — |

### Change #1 — Setup and turnaround time count towards availability and conflicts

**§1 The change.**
- Each venue now records how many minutes it needs before an event to set up and after it to reset.
- A booking occupies the venue for that whole widened period.
- Bookings that already sit too close together are flagged and are never moved automatically.

**Why** (`202610050003_venue_operations.sql`, `202610140003_venue_booking_clashes.sql`):
- Back-to-back bookings ignored the time needed to prepare and reset a venue.
- Venue Staff and coordinators need to see existing pairs that no longer fit.

**§2 Type.** A new requirement. It changes the existing definition of a conflict used by search (SG2-46), approval (SG2-49), conflicts (SG2-50) and holds (SG2-84).

**Stories, all built:**
- **SG2-77:** record setup and turnaround minutes (0–1440) plus the safety notes `emergency_access` and `known_restrictions`.
- **SG2-78:** apply the gap in availability, search, conflict lists, approvals and holds.
- **SG2-79:** flag clashing pairs and notify the coordinators.

**§5 Artefacts changed:**

| Artefact | What changed |
|---|---|
| C4 (`connectsphere.dsl`) | The C3 API components gain a venue-operations router and a clashes router. Supabase gains the `venue_preparation_gap` function and the clash-refresh triggers. |
| Class (`class-diagram.puml`) | Venue gains setup, turnaround and safety attributes, from table `venue_operations`. New class BookingClash. |
| Data model (`data-model.puml`) | New tables: `venue_operations` and `venue_operation_history` (`202610050003`), `venue_booking_clashes` (`202610140003`). |
| Sequence (`sequence-diagrams.puml`) | Diagram 1 shows availability, then the booking decision with the gap applied, then clash flags. |
| API | New: `GET`/`PUT /api/venues/:venueId/operations` and `GET /api/venue-clashes`. Changed: availability (adds `setup` and `turnaround` entries), search, `POST /api/venue-booking-requests`, `…/conflicts`, `…/decision`, `POST /api/venue-holds`, `…/convert`. Notification kind `venue_booking_clash`. |

### Change #2 — A venue can become temporarily unavailable, and can be replaced

**§1 The change.**
- Venue Staff can mark a venue unavailable for a period, choosing a reason category (maintenance, equipment failure, renovation, safety concern, other) and adding a note.
- This is allowed even when confirmed bookings fall inside the period.
- Those bookings are flagged as affected and retained. Since SG2-81, each new flag notifies the current Coordinator; Preparation/Confirmed events return to Planning, clear confirmation stamps, record history and notify the Organiser. Date, time, attendance and requirements remain unchanged; other stages stay unchanged.
- An assigned Coordinator requests a replacement through the existing booking-request POST with `replaces_booking_id`. The reference must identify an affected confirmed booking of that event. Pending replacements reserve nothing.
- Venue Staff approval atomically creates the new confirmed booking, releases the original booking/cancels its request, updates the primary booking pointer and writes history/notices. Failure rolls back. Rejection leaves the old booking intact.
- `202610170002` is the final confirmation RPC: affected bookings and persisted venue/equipment/registration rechecks both prevent confirmation. Other ready arrangements do not erase a recheck flag.

**Why** (`202610100001_venue_temporary_unavailability.sql`): the venue may genuinely be unusable. The old refusal (SG2-45 AC2) made it impossible to record that.

**§2 Type.** A change to an existing requirement: SG2-45 AC2 is replaced, and the trigger `venue_unavailability_refuse_confirmed_overlap` is dropped. Replacing a venue is a new requirement.

**Stories:**
- **Built / Jira Done:** SG2-80, SG2-81 replacement and SG2-98 overlapping-unavailability remediation. SG2-98 AC1/AC4 are historical delivered context; AC2/AC3 cover retained blocks, removal and restored search.
- **Related:** SG2-83 (general change/cancellation of one venue, change #3) reuses the same replacement route; it is not the affected-booking replacement contract.

**§5 Artefacts changed:**

| Artefact | What changed |
|---|---|
| C4 | Venue Staff marks unavailability; the built replacement responsibility extends existing booking routes and DB adapters. General change/cancel of one venue (SG2-83) is built on the same routes (change #3). |
| Class | VenueUnavailability links affected bookings; VenueBookingRequest optionally references the booking it replaces. No separate replacement entity is invented. |
| Data model | `venue_unavailability` gains `category`, `created_by` and `created_at`. New table `venue_booking_disruptions` and view `venue_affected_bookings` (`202610100001`); replacement FK/partial index, notification kind and notify/reversion trigger (`202610170001`). |
| Sequence | Diagram 2 shows new disruption notices/status reversion, replacement request and atomic approval/release, with combined confirmation gates. |
| API | Changed: `GET`/`POST /api/venues/:venueId/blocks` (category, note, who/when, `affected[]`), and both availability endpoints (affected-booking label). Replacement extends existing `POST /api/venue-booking-requests` (`replaces_booking_id`) and its decision route; lists expose affected periods/pending replacement, and readiness counts affected bookings. No new replacement endpoint is added. |

### Change #3 — An event can have more than one venue

**§1 The change.**
- An event's venue arrangement is ready only when **every** venue it needs is approved and booked.
- A coordinator can withdraw a pending or rejected request the event no longer needs.
- Releasing one booking leaves the others in place; the coordinator can name further bookings of the event to cancel in the same call (SG2-83).
- A coordinator can change one venue through a replacement request with a reason, on any current confirmed booking; Venue Staff are told of cancellations and change requests, and a Confirmed or Preparation event returns to Planning (SG2-83).

**Why** (`202610150002_venue_request_withdrawal.sql`): events use several spaces, and one rejected venue must not leave the event looking ready.

**§2 Type.** A clarification and tightening of an existing requirement. SG2-48 AC4 already allowed several requests; SG2-82 fixes what "ready" means and adds withdrawal. Changing or cancelling one venue is a new requirement.

**Stories, both built:**
- **SG2-82:** readiness over every venue, and withdrawal.
- **SG2-83:** change or cancel one venue (`POST /api/venue-bookings/:bookingId/release` with `also_cancel`, `replaces_booking_id` + `change_reason` on `POST /api/venue-booking-requests`, `202610210002_venue_booking_change_cancel.sql`). Only the event's assigned coordinator cancels a booking; Venue Staff no longer release bookings and mark the venue unavailable instead.

**§5 Artefacts changed:**

| Artefact | What changed |
|---|---|
| Class | Event 1–* VenueBookingRequest and Event 1–* VenueBooking. `events.venue_booking_id` stays as a "first or earliest confirmed venue" pointer. |
| Data model | `venue_booking_requests` gains `withdrawn_by`, `withdrawn_at` and a check constraint (`202610150002`). The `confirm_event` venue gate is replaced (`202610150003`). |
| API | New: `POST /api/venue-booking-requests/:requestId/withdraw`. Changed: `GET /api/venue-booking-requests` (`arrangement` tally), `GET …/arrangements` and `PATCH …/confirm` (a rejected or pending venue is outstanding), and the `decision` and `release` RPCs (pointer handling). SG2-83: `POST /api/venue-bookings/:bookingId/release` is coordinator-only and takes `also_cancel`; `POST /api/venue-booking-requests` takes `change_reason`; new notice kinds `venue_booking_cancelled` and `venue_change_requested`. |
| C4 / Sequence | No new container or flow. Diagram 1 shows decisions per request. |

### Change #4 — Tentative venue holds with expiry

**§1 The change.**
- Venue Staff place a **tentative** hold for an event, with a mandatory future expiry.
- The hold blocks the period, creates a pending request and notifies the coordinator.
- One warning is sent before expiry; the default lead time is 24 h.
- At expiry the hold expires, the request is cancelled, a notice is sent and system history is written.
- Before expiry, staff can convert the hold to a confirmed booking or release it.

**Why** (`docs/venue-holds.md`): to reserve a venue while the event is still being arranged, without committing it indefinitely.

**§2 Type.** A new requirement. The legacy `venue_bookings.status = 'held'` value is kept only for old data.

**Stories, all built:** SG2-84 (placement, convert, release), SG2-85 (expiry, warning and expiry notices, history) and SG2-106 (change a hold's expiry; hold-expiry sweep and venue delete, `202610170007_venue_delete_hold_expiry.sql`).

**§5 Artefacts changed:**

| Artefact | What changed |
|---|---|
| C4 | Supabase gains the pg_cron job `venue-hold-deadlines`, which calls `process_venue_hold_deadlines()`. |
| Class | New classes VenueHold (status `tentative`/`converted`/`released`/`expired`, `expires_at`, `warning_sent_at`) and VenueHoldNotification. |
| Data model | New tables `venue_holds`, `venue_hold_notifications` and `venue_hold_settings`, plus the effective occupancy view (`202610050001`). |
| Sequence | Diagram 3 shows the hold placed, then pg_cron sending the 24-hour warning and the expiry notice. |
| API | New: the seven `/api/venue-holds` endpoints (including `POST …/:holdId/expiry`, SG2-106). |

### Change #5 — The Event Coordinator Lead assigns coordinators

**§1 The change.**
- A new role, the Event Coordinator Lead, is the only role that assigns or reassigns a coordinator. Technical Support Staff lose this.
- A submitted request with no coordinator waits in a new status, `unassigned`, in the Lead's queue.
- Coordinators can act only on events currently assigned to them.

**Why:** the Jira change gives the reason. In the code, `policy.ts` and `docs/authorization.md` record the move from TSS to the Lead.

**§2 Type.** A change to an existing requirement. SG2-33 and SG2-34 built assignment for TSS; the role and queue are new.

**Stories:**
- **Built:**
  - SG2-86: the role.
  - SG2-87: the unassigned queue and `GET /api/assignment-queue`.
  - SG2-90: only the current assignee may act.
  - SG2-97: the permission moves to the Lead, and the Lead sees history.
  - SG2-88: assignment/reassignment as Lead through the existing coordinator route (Done in the refreshed Jira snapshot).
  - SG2-89: oversight, `GET /api/coordinator-overview` (the events whose coordinator the Lead last assigned, with each coordinator's workload; `events.coordinator_assigned_by`, `202610220004_coordinator_oversight.sql`).
  - Related: SG2-68 (the Lead is notified of submissions) and SG2-100 (`unassigned` status).

**§5 Artefacts changed:**

| Artefact | What changed |
|---|---|
| C4 | New person: Event Coordinator Lead. The API gains the assignment-queue component. |
| Class | AccountRole gains `event_coordinator_lead`. A coordinator assignment links Event → User (coordinator) and is recorded as history. |
| Data model | `account_roles` check constraint and `roles` rows (`202610050004_week7_roles.sql`). Status `unassigned` (`202610090001`), backfill (`202610090002`), `events.submitted_at` (`202610090004`). |
| Sequence | Diagram 4 shows the Lead picking from the unassigned queue, then assigning, then the SG2-68 notices. |
| State (`event-status-model.puml`) | Adds `unassigned`; transitions `draft → unassigned → submitted`. |
| API | New: `GET /api/assignment-queue`, `GET /api/coordinator-overview`. Changed: `GET /api/event-requests/assignable` and `PATCH …/coordinator` (TSS → ECL; first assignment moves `unassigned → submitted`), `PATCH …/submit` (target `unassigned`), `PATCH …/planning` (409 once reassigned), `…/history` and `…/stage` (ECL added), `GET /api/notifications` (ECL added), `GET /api/work-queue` (no unassigned items for EC). |

### Change #6 — Operational safety check by a Safety Officer

**§1 The change.**
- A Safety Officer checks an event's operational safety before it can go into Preparation and be confirmed: Approve, Reject, or Request Changes naming the arrangements to redo.
- Venues carry emergency-access details and known restrictions for that check.

**Why:** the Jira change (epic SG2-76) gives the reason. The code records the intended gate in `202610090001_event_status_flow.sql`: "give the Safety Officer gate (SG2-91/92/93/94) somewhere to stand between Arrangements and Confirmed".

**§2 Type.** A new requirement.

**Stories, all built:**
- SG2-86: the role, with read-only grants for stage, history, equipment requirements and reservations.
- SG2-77: venue safety details.
- SG2-100: the statuses `awaiting_safety_check`, `safety_rejected` and `preparation`; the 7-step stepper; `PATCH …/complete`.
- SG2-91: the safety-check list `GET /api/safety-checks` and the automatic move into `awaiting_safety_check` (`202610190004_safety_check_queue.sql`).
- SG2-92: `POST …/safety-decision`, `GET …/safety-decisions`, `POST …/rework` (`202610190005`, `202610190006`).
- SG2-93: Request Changes and the re-review confirmations by Venue Staff and Technical Support, `GET /api/safety-rereviews`, `POST /api/safety-rereviews/:reviewId/confirm` (`202610240001`).
- SG2-94: the preparation gate, ADR-11 (`202610220001`).

**§5 Artefacts changed:**

| Artefact | What changed |
|---|---|
| C4 | New person: Safety Officer. The API gains the safety-check, safety-decision and safety re-review routes (see `connectsphere.dsl`). |
| Class | AccountRole gains `safety_officer`. Event gains the new statuses. SafetyDecision and the re-review flag map to the tables below. |
| Data model | `event_status` enum values (`202610090001`). Completion columns (`202610090003`). `venue_operations` safety fields. New: `event_safety_decisions`, `safety_rereviews`, `events.safety_check_revision` (`202610190004` to `202610240001`). |
| Sequence | Diagram 5 shows the safety-check decision flow. |
| State | Adds `planning → awaiting_safety_check → preparation \| safety_rejected → planning …`. The move into Preparation is guarded in the database (ADR-11), not by a transition table. |
| API | New: `PATCH /api/event-requests/:eventId/complete`, `GET /api/safety-checks`, `POST …/safety-decision`, `GET …/safety-decisions`, `POST …/rework`, `GET /api/safety-rereviews`, `POST /api/safety-rereviews/:reviewId/confirm`. Changed: `…/stage` and `…/history` (SO added), `GET /api/equipment-requests` and `GET /api/equipment-reservations` (SO read), `GET …/arrangements` and `PATCH …/confirm` (a `safety` item). |

### Also at this snapshot since Week 7 (not one of the six changes)

These stories changed the same artefacts, so each artefact shows them as current, without the `<<Week 7>>` stereotype:

| Story | What it added |
|---|---|
| SG2-58 | Confirm the event: `PATCH …/confirm`, `GET …/confirmation`, RPC `confirm_event` |
| SG2-68 | Event lifecycle notices in `notifications` |
| SG2-55 | Equipment reservations |
| SG2-57 | Arrangement readiness |
| SG2-48–SG2-54 | Venue requests, decisions, conflicts, release, and equipment records, requirements and availability |
| SG2-59, SG2-60, SG2-61, SG2-62 | The Attendee backend: find registrable events, register, join the waiting list when full (ADR-10), see and withdraw own registrations (`202610220003`, `202610230001`, `202610260003`, `202610280001`) |
| SG2-63 | The organiser's and coordinator's registration picture and the organiser's registration settings (`202610200004`) |
| SG2-64, SG2-65, SG2-66 | Change requests after submit: raise, accept or refuse with a reason, and the impact of each (`202610190003`, `202610260001`, `202610270001`) |
| SG2-67, SG2-56 | Cancel an event on the organiser's request, releasing venues and equipment (`202610220002`, `202610210001`) |
| SG2-102 | Registered attendees are told when an event's start or venues change (`202610270002`) |
| SG2-69 | The notification inbox and reminder preference (ADR-07, ADR-08) |
| SG2-70 | Cross-system event search, `GET /api/event-search` (`202610200005`) |
| SG2-104 | Multi-role accounts, ADR-09 |
| SG2-105 | Required fields on submission (`preferred_layout` added, `202610200001`) |
| SG2-106 | Venue delete (`202610170007`, `202610190001`) and hold-expiry change |
| SG2-96 | End-to-end and release checks (`docs/release-readiness.md`) |

---

## Replacement revision sources (16 Oct 2026)

- PR92 implemented SG2-81: `venues/bookingRequests.ts`, `db/venueBookings.ts`, `db/venueDisruptions.ts`, `202610170001_venue_replacement.sql`.
- PR90 combines persisted planning rechecks with disruption checks in `202610170002_confirmation_rechecks_and_disruptions.sql`; additive `202610160005_event_confirmation_record_repair.sql` supplies confirmation columns without replacing that function.
- Client/API/server notification contracts accept and render `venue_unavailable` at head 61416cc. New disruption flags notify once; flags predating the trigger are not announced retrospectively. Organiser warning is conditional on Preparation/Confirmed reverting to Planning.
- The source model documents implemented contracts. Since SG2-91 to SG2-94 (19 to 24 Oct 2026), an event reaches Preparation through the Safety Officer's Approve, so the end of the lifecycle is reachable through the API (see Part C, former item 4). The 16 Oct statement that this still depended on planned Safety stories is superseded.

## Part C — Known limits

1. **History and notice writes are not atomic in handler-written flows.** Submit, review, decision, clarification, planning and complete write the event first. History and notices follow as separate statements through the service-role client.
   - A 503 can follow a status change that was already saved (`events/submit.ts`, `decide.ts`, `clarifications.ts`, `updatePlanning.ts`).
   - `assignCoordinator.ts` rolls the assignment back if history fails. If the notice write fails, the assignment stands and the caller still gets a 503.
   - `complete.ts` ignores a failed history write.
   - Accepting a change request applies the change (`apply_accepted_event_change`) and then records the decision in a second call (`events/changeRequests.ts`); if recording fails the change stands and the caller gets a 503.
   - Flows written as RPCs (ADR-03) that commit their own history and notices do not have this problem.
2. **Submission is two guarded updates, with a gap between them.** `submitEventRequest` (`server/src/db/eventRequests.ts`, around line 369) runs the `unheld` update and then the `held` one. A coordinator cleared in between leaves the request in its old status with a 503. This is a documented, accepted gap.
3. **Replacing a venue's layouts is delete-then-insert**, not a single transaction (`db/venueLayouts.ts`).
4. **No table enforces the status graph.**
   - `STATUS_TRANSITIONS` and `canTransition` were removed from `server/src/events/fields.ts` by PR #120 (SG2-22, commit `ca54162`); nothing in `server/src` references them.
   - Each handler or RPC keeps its own status list. Two transitions are also guarded by database triggers: `safety_approval_gate` (into Preparation) and `keep_cancelled_events_cancelled` (a cancelled event never changes status).
   - Submit (`rejected`/`needs_clarification → submitted`) and planning (`… → planning` after a confirmed impact) go beyond what the diagrams draw as the main path.
5. **Some endpoints accept times without a zone.**
   - `POST /api/venue-booking-requests` (`bookingRequestFields.ts`) and `POST /api/venues/:venueId/blocks` (`blockFields.ts`) use `Date.parse` and do not require an offset, so a string without a zone would be read in the server's local time zone.
   - The shipped client always sends UTC ISO strings, so this only affects other callers. **[inference]**
6. **Time-driven notices and offers run on a one-minute (or hourly) cadence.**
   - Hold warnings and expiry, registration opening and closing, and waiting-list offer lapses depend on pg_cron, so they can arrive up to a minute late; arrangement reminders are hourly (ADR-08). Expiry enforcement itself is never late.
   - Where pg_cron is unavailable, operators must provide their own scheduler.
7. **Notifications have gaps.**
   - Two tables back the notices: `notifications` and `venue_hold_notifications`. Only the inbox (`GET /api/notifications/inbox`) merges them and shows read state; `GET /api/notifications` returns the newest 50 of the first table only, without read state.
   - The Safety Officer and the Attendee do not hold `notifications.read`; they, like every role, read through the inbox (`notifications.inbox`).
   - The client polls; there is no push.
8. **Epics SG2-13, SG2-14, SG2-16, SG2-17 and SG2-18 are not built.** All six Week 7 changes and all 23 Sprint 4 stories are built, so nothing from them is left unbuilt; these five epics were not delivered (see api-specification §11). Their Jira status was supplied for this revision and is not visible in the repo **[inference]**.
