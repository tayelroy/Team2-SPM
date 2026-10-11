# SG2-55 — Reserve equipment for an event

Technical Support Staff can reserve the full quantity of a pending equipment
request for an approved, planning or confirmed event with an assigned Event
Coordinator. The form shows the quantity and Singapore-time period before
submission. A successful reservation appears in the event's equipment panel and
creates an in-app notification for its assigned coordinator.

## Stock and transaction rules

The database checks current stock while holding the equipment row lock. It
commits the receipt, approves the request, sets its shortfall to zero and inserts
the coordinator notification in one transaction. The request version advances;
existing placement and arrangement notes are preserved. Replays or concurrent
submissions cannot create a second receipt for that request or duplicate its
notice. No partial quantity or client quantity override is accepted.

The stock check uses the peak simultaneous committed quantity over half-open
intervals: an existing reservation ending exactly when the new one begins does
not overlap. Damaged and maintenance equipment contribute no available stock.
Active undated legacy reservations use their confirmed-booking envelope, or
count throughout the proposed period when no complete period is known. Completed,
cancelled and rejected events no longer consume stock.

The commit check includes reservations already held by this same event. This is
deliberately stricter than the [SG2-54 advisory check](equipment-availability.md),
which excludes the event's own commitments when showing what it can use. A new
request for the same equipment consumes additional stock; a previous legacy
receipt does not make that stock free again. Availability is checked again at
submission, so an earlier successful check is not a guarantee.

Insufficient stock, a stale request, an existing receipt or a closed event is
refused without partial changes. A lost response or HTTP 5xx requires refreshing
reservations and requirements before another attempt: the transaction may
already have committed.

## Dates, receipts and continued arrangement

Suggested dates come from SG2-54's request or confirmed-booking period. Otherwise
the form offers the proposed start and requires an explicit end. Inputs preserve
seconds and milliseconds. Finer source precision is expanded outwards to whole
milliseconds, with a visible notice, so the suggested reservation still covers
the complete original period. The API accepts zoned ISO timestamps at up to
millisecond precision and requires a finite end after the start.

Event Coordinators can read receipts for their assigned events. Technical Support
Staff and Safety Officers use the existing equipment-requirement visibility
rules. Receipts show equipment, quantity, period and reservation time; historical
unknown timestamps remain explicitly unrecorded. Only Technical Support can
reserve, and the server supplies that capability to the interface.

Reservation freezes the approved request's demand. Technical Support can still
edit its arrangement and placement while the event is approved or planning,
provided an actual reservation receipt links to that request. Unlinked legacy
approved requests remain closed. Reserved requests remain in the active support
queue so this work can be completed. Event confirmation continues to close
arrangement editing.

## API and deployment

- `GET /api/equipment-reservations?event_id=<id>` reads event receipts and
  `can_reserve` with the existing `equipment_requirements.read` permission.
- `POST /api/equipment-requests/:requestId/reservation` accepts `event_id`,
  `version`, `starts_at` and `ends_at`; it requires
  `equipment.reservations.manage`, granted to Technical Support. Success is 201
  with the updated receipt view and `coordinator_notified: true`. Invalid input
  is 400, lost access is 401/403, inaccessible records are 404 and refused current
  state or stock is 409.

The caller's JWT reaches the guarded
`manage_equipment_reservations(text,integer,bigint,bigint,timestamptz,timestamptz)`
RPC. Its stored-role, event-visibility and version checks remain authoritative.
It uses an empty search path; ordinary clients gain no direct reservation-table
or sequence access.

Apply `supabase/migrations/202610140001_equipment_reservations.sql` once, after
all earlier migrations, before deploying this application version to hosted
Supabase. It adds request-linked receipts and notification references, replaces
the guarded requirements RPC to support continued arrangement, and updates the
support queue. Existing receipt rows are retained. Missing hosted RPCs are
reported as an unavailable service; a preview build does not establish that the
migration has been applied.

No new environment variables, paid service, subscription or Supabase plan change
is required. Keep the existing Free plan. A rollback must preserve committed
receipts and compatibility with `equipment_reserved` notifications.

## Verification

`e2e/equipment-reservations.spec.ts` contains five focused journeys:

| Case | Observable result |
| --- | --- |
| SG2-55-P01 | Reserve 12 of 20, reduce another event's remaining stock to 8, finish placement after reloading, then show the coordinator's receipt and notification; 1440px layout and browser error checks. |
| SG2-55-B01 | At 390px, reject equal endpoints without a receipt, accept a complete period and retain the exact dates without horizontal overflow. |
| SG2-55-C01 | A competing reservation after the advisory check causes a refusal; the losing request stays pending and refresh shows the reduced stock. |
| SG2-55-C02 | Rapid clicks send one request, and an API replay leaves one receipt and one notification. |
| SG2-55-N01 | Deny unsigned/coordinator writes; simulate commit followed by HTTP 503, then recover the sole receipt through refresh without duplicate notification. |

Run the build and application coverage checks with `npm run ci`, and browser
journeys with `npm run test:e2e` after the build. The browser fixtures exercise
the real rendered UI and Express routes with disposable memory storage; they
do not prove hosted database behavior. `supabase/tests/equipment_reservations.sql`
and `.github/scripts/test-equipment-reservations-concurrency.mjs` exercise the
actual SQL and independent database sessions in disposable PostgreSQL.

The scenario register is [regression-cases.json](regression-cases.json); detailed
method mapping is [test-case-inventory.json](test-case-inventory.json). Execution
fields must cite a matching completed run. Hosted migration verification and
independent teammate approval remain separate release requirements.

### Local validation — 11 October 2026

The final build passed with 1,295 backend and 1,189 frontend test cases and
100% statement, branch, function and line coverage on every measured file.
All 81 browser journeys and 13 report-gate checks passed. Disposable native
PostgreSQL accepted all 32 migrations, 24 SQL suites (including 46 SG2-55
contracts), and all 22 concurrency scenarios across five scripts.

In-app browser checks at 1440×1000 and 390×844 verified the saved receipt,
immediate approved badge, reduced stock and refusal, and assigned-coordinator
notification. Both widths had no horizontal overflow; no warning/error console
entries appeared in the final visual session. The local fixture is separate from
hosted Supabase, whose migration and deployed workflow remain unverified.

![Desktop reservation receipt](screenshots/sg2-55/iab-desktop.png)
![Mobile reservation receipt](screenshots/sg2-55/iab-mobile.png)
![Mobile stock refusal](screenshots/sg2-55/iab-mobile-conflict.png)
![Coordinator notification](screenshots/sg2-55/iab-coordinator.png)
