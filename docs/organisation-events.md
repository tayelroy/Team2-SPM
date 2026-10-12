# Organisation event access (SG2-26)

Event Organisers see the events belonging to their client organisation, including
events created by colleagues. The organisation is read from the signed-in user's
database profile on each request. A client-supplied organisation, user ID or
cached browser value cannot select the organisation to read.

## Behaviour

- `GET /api/event-requests` lists events with the exact same nonblank
  `organisation` value as the caller's `public.users` row. Status filters retain
  that boundary. `scope=mine` further restricts the list to the creator and is
  combined with `status=draft` by **My drafts**. Non-draft requests stay in
  **My events**; they are not shown in the draft list or its count.
- `GET /api/event-requests/:eventId` applies the same organisation boundary.
  Unrelated and nonexistent events both return 404. Missing, null or blank
  membership returns an empty list and 404 for details.
- Read responses include `can_manage`. It is true only for the event's creator.
  Colleagues can read, but the existing creator checks still protect editing,
  submission and deletion on the server. Those operations also recheck current
  membership, so moving an account to another organisation removes access to its
  former organisation’s events. Creation without membership is refused with 403.
- The organiser dashboard and event detail use actual API data. A missing
  selection never falls back to a fictional event from another company.
- Only Event Organisers can access the event list and detail UI or API.
  Coordinators, venue staff, technical support and attendees receive 403 from
  these endpoints. Coordinator assignment and review remain separate stories.

## Request form: new requests and draft edits (SG2-28, SG2-29, SG2-30)

**New request** and **My drafts → Edit** open the same form
(`client/src/screens/RequestForm.tsx`).

- **Date** is a `datetime-local` input in Singapore time. The form keeps the
  stored ISO instant and converts it only for display, so a stored
  `2030-06-15T02:00:00.000Z` shows as `15 Jun 2030, 10:00` and is sent back
  unchanged when untouched. An edited value is converted from Singapore time
  (`07:30` on 15 June is saved as `2030-06-14T23:30:00.000Z`).
- The form shows only what a request stores. The earlier prototype
  requirement chips (Step-free access, Hearing loop, Stage + lectern, …) were
  never sent to the server, so they silently discarded input and were removed;
  venue, accessibility and equipment needs are the free-text fields.
- **Venue fit** replaces the canned "180 expected attendance rules out 3 of 6
  venues…" banner. Once the request has a saved id, **Check venue fit** reads
  `GET /api/venues/suitability?event_id=` (SG2-47; organisers see only their
  own events) and lists every venue that does not fit and why. It reflects the
  last save, so each later save refreshes it. It checks capacity, facilities
  and accessibility, not date availability.
- After a successful submit, from either entry point, the organiser lands on
  the submitted event's detail page with a status message such as
  "Partner Forum has been submitted for review." (AC1). The message is cleared
  when they leave that page.

## Event status lifecycle (SG2-100)

An event moves through a 7-step stepper, shown on the event detail screen
alongside a plain-language stage and a "waiting on" card naming the persona
and action that moves it forward:

1. **Draft** — the organiser is still completing the request.
2. **Awaiting Assignment** (`unassigned`) — submitted with no coordinator yet;
   the Event Coordinator Lead assigns one. A fresh draft's submission lands
   here, not in `submitted`, which gives the Lead's assignment queue an
   indexable predicate instead of a `status = 'submitted' and coordinator_id
   is null` sniff. A request that already has a coordinator (resubmitted
   after a clarification question or a rejection) goes straight back to
   `submitted` instead — see step 3.
3. **Under Review** — covers both `submitted` (assigned, not yet opened) and
   `under_review` (the coordinator has opened it); `submitted` has no step of
   its own. `needs_clarification` also sits at this step while the organiser
   answers the coordinator's question and resubmits — which lands back in
   `submitted`, preserving the coordinator's hold on the request, not in
   `unassigned`.
4. **Arrangements** (`approved`/`planning`, `stage_key: 'in_planning'`) — the
   coordinator arranges the venue and equipment.
5. **Safety Check** (`awaiting_safety_check`) — the Safety Officer completes
   the operational safety check; `safety_rejected` is a stop at this step with
   no waiting-on card, not a recoverable state.
6. **Preparation** (`preparation`) — arrangements and the safety check are
   done; the event is being readied.
7. **Confirmed** (`confirmed`) — ready to be held. Once its end time has
   passed — derived from `max(venue_bookings.ends_at)` over its confirmed
   bookings, since `public.events` has no end-time column of its own — the
   assigned coordinator marks it **Completed**, which records who and when
   and removes it from the active work queue.

   The coordinator does this from their **Work Queue**: opening the event
   under **My assigned events** shows a **Mark as Completed** step once the
   event's end time has passed, and the event leaves the queue when it is
   done. The queue's event items carry that end time as `ends_at`
   (`internal_work_items`), so the button is only offered once it applies;
   the server re-checks ownership, status and the end time on every call.

`cancelled` and `rejected` are terminal off-stepper outcomes, same as
`completed`. The legal transition table enforcing which of these moves are
allowed lives in `server/src/events/fields.ts` (`STATUS_TRANSITIONS`,
`canTransition`).

## Event change history (SG2-40)

`GET /api/event-requests/:eventId/history` returns the event's
`event_audit_logs` rows, newest first, each with the actor, the time and the
old and new values. The owning organiser and every internal role may read it;
attendees and unrelated organisers receive 403.

**What is recorded.** Each row is one change to one field:

- Planning edits (SG2-39): each changed planning field, by the coordinator.
- Coordinator assignment and reassignment (SG2-33/34), by the Lead, with the
  coordinators' names as old and new values.
- Venue hold, booking decision and booking release changes written inside
  their SQL functions; the venue-hold expiry sweep writes a null actor,
  shown as **System**.
- **Every status transition**, as `field_name: 'status'` with the raw stored
  statuses as old and new values (the drawer shows them in plain language)
  and the caller who caused it as actor (`statusChange` in
  `server/src/db/auditLogs.ts`):

  | Transition | Path | Actor |
  | --- | --- | --- |
  | `draft`/`rejected`/`needs_clarification` → `unassigned` or `submitted` | `PATCH …/submit` | Organiser |
  | `unassigned` → `submitted` | `PATCH …/coordinator` (first assignment; same insert as the assignment row) | Lead |
  | `submitted` → `under_review` | `PATCH …/review` (re-opening a review in progress records nothing) | Coordinator |
  | `under_review` → `needs_clarification` | `POST …/clarifications` | Coordinator |
  | `under_review` → `approved`/`rejected` | `PATCH …/decision` | Coordinator |
  | any live status → `planning` | `PATCH …/planning` (approved event edited, or an edit that invalidates arrangements) | Coordinator |
  | `preparation`/`confirmed` → `completed` | `PATCH …/complete` | Coordinator |

  No SQL function or trigger changes `events.status`, so there are no
  system-authored status rows. The status write and the history insert are
  two calls, not a transaction. If the history insert fails, assignment is
  undone and reported as 503; submit, review, clarification, decision and
  planning answer 503 while the transition itself stands (a known gap, the
  same one SG2-39 planning edits already have); completion keeps its 200
  because `completed_by`/`completed_at` on the row are authoritative.

Each entry also carries `actor_role`: the actor's current role from
`account_roles` in Title Case (e.g. `Event Coordinator Lead`), or null for a
system row or an account without a role. The history drawer
(`client/src/components/EventAuditDrawer.tsx`) shows it as a badge next to
the actor's name — **Automatic** for system rows, no badge when the role is
unknown — and renders `status` values with the client's shared
`statusLabel` mapping (`draft` → Draft, `unassigned` → Awaiting Assignment,
`planning` → Arrangements, …).

**Internal-only fields.** Some entries are internal to ConnectSphere staff.
`INTERNAL_ONLY_AUDIT_FIELDS` in `server/src/auth/policy.ts` lists them —
currently `planning_notes`, the coordinators' internal planning log. A caller
whose role is not internal (`isInternalRole`) never receives those rows: the
handler reads with the admin client, so it filters them itself, and the
`event_audit_logs_read` RLS policy
(`supabase/migrations/202610130001_event_history_internal_fields.sql`)
excludes them from the organiser branch as well. Both lists must change
together; `supabase/tests/event_history_internal_fields.sql` proves an
organiser cannot select a planning-notes row while internal staff can.

## Provisioning and rollout

Apply the SG2-26 migration in `supabase/migrations` alongside the application
release. It protects event reads with row-level security and prevents direct
client writes to event records and user membership. The server's service role
continues to perform validated operations. Do not expose that key in the browser.

The existing schema uses organisation text as its membership identifier. An
administrator must assign exactly matching, nonblank values to colleague
accounts and their organisation's events. Different spellings, case or whitespace
are not merged automatically. Do not reuse an organisation value for unrelated
clients. Existing null memberships and events are deliberately not inferred or
backfilled: review and provision them explicitly before expecting shared access.

## Verification

Backend tests cover organisation scoping and unavailable membership lookups.
The browser cases `SG2-26-P01` and `SG2-26-N01` exercise colleague visibility,
read-only details, owner-only drafts, unrelated direct reads and an unassigned
account through the real application with isolated test providers. Database
policy tests separately verify the Postgres boundary; the in-memory browser
fixture does not emulate row-level security.

SG2-26 is organisation isolation. The older regression register incorrectly
associated the logout case `PW-AUTH-03` with this ticket; logout remains covered
as a separate authentication regression.

The local checkout needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` in `server/.env` to use the real database. Production
reads use Supabase; test preview records belong exclusively to the isolated
browser test provider. No mock record fallback is used by the organiser view.
