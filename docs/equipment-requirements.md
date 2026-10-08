# SG2-53: Record what equipment an event needs

The assigned Event Coordinator can add and amend equipment requirements in an
approved or planning event's dashboard detail or event detail. Technical Support
Staff open pending equipment requests from their dashboard and save arrangement
notes, a shortfall and the placement venue/position. Reloading either view retrieves
the saved information. Jira's six acceptance criteria were verified on 8 October
2026 through the authenticated in-app browser.

| AC | Implemented behaviour | Evidence |
| --- | --- | --- |
| AC1 | Equipment type, positive whole quantity and optional technical notes against an approved event | Router/component tests, SQL create-fields and SG2-53-P01 |
| AC2 | Assigned coordinator amends a pending requirement while the event is approved/planning; support must recheck after changes | Versioned RPC, SQL stage/assignment checks, amendment reset and SG2-53-C01 |
| AC3 | Zero, negative, fractional and nonnumeric quantities refused before storage | Router/component validation, SQL limits and SG2-53-B01 |
| AC4 | A new requirement appears in Technical Support Staff's pending dashboard queue | Real queue SQL contract and SG2-53-P01 handoff |
| AC5 | Support saves arrangement notes and a shortfall; the coordinator sees both | Arrangement RPC/component tests and SG2-53-P01/P02 |
| AC6 | Each item has a venue/position pair, visible to Safety Officer through the read-only API; absent placement says **Not recorded** | Role/placement SQL checks and SG2-53-P01/P02; full SG2-91 safety workflow is subsequent work |

Requests describe demand. They do not reserve equipment, promise available stock
or change quantity held. Maintenance/damaged catalogue types remain selectable
because support may need to report a shortfall. Legacy request start/end periods
are preserved; new requirements do not invent a duration. Their queue date uses
the event's proposed date when no request period exists.

## API and permissions

All endpoints require the existing bearer token. The current assigned coordinator,
Technical Support Staff and Safety Officer can read the event requirements.
Only the assigned coordinator can create/amend; only support can arrange. Safety
Officer receives read-only data for SG2-91. The equipment catalogue editor retains
its Technical Support Staff-only permission.

| Endpoint | Input | Response |
| --- | --- | --- |
| `GET /api/equipment-requests?event_id=…` | Event ID | 200 complete view |
| `POST /api/equipment-requests` | `event_id`, `equipment_id`, `quantity`, `notes` | 201 complete view |
| `PATCH /api/equipment-requests/:requestId` | Requirement fields, `event_id`, `version` | 200 complete view |
| `PATCH /api/equipment-requests/:requestId/arrangement` | `event_id`, `version`, `arrangement_notes`, `shortfall`, `placement_venue_id`, `placement_position` | 200 complete view |

The view contains event identity/status, requirements, equipment/venue choices and
`can_request`/`can_arrange`. Each requirement carries its version. Quantity is an
integer from 1 to 2,147,483,647. Optional notes and placement position are trimmed,
blank becomes null, and new text allows up to 2,000 Unicode code points. Shortfall
is an integer from zero to the requested quantity: zero means support recorded no
shortfall, whereas null displays **Not recorded**. Placement is either absent or
both a valid venue and nonblank position.

An amendment resets arrangement notes, shortfall and placement to null. The editor
states this before saving so support can reassess the changed requirement.
Decided requests and events outside approved/planning remain read-only. Duplicate
pending equipment selections and stale versions return 409. Malformed fields
return 400, missing credentials 401, denied roles 403, unavailable/unassigned
records 404 and provider failures 503. Failed saves keep drafts; conflicts require
reload. Event/session changes cancel stale loads and saves.

## Database and deployment

Apply `supabase/migrations/202610080001_equipment_requirements.sql` after the
existing migrations **before deploying this branch**. No new environment variables,
paid feature, scheduler, plan or billing change is required. This task does not
apply SG2-53 to hosted Supabase.

The migration adds nullable arrangement/placement fields and a guarded version to
`equipment_requests`, permits absent paired periods and updates only the equipment
branch of the service queue view. Existing periods and requests are retained,
including legacy duplicates and long technical notes. Support can arrange those
legacy records without rewriting their original requirement. New or amended notes
still obey the current limit.

Authenticated callers invoke `manage_equipment_requirements` with their own JWT;
they cannot write the underlying request table directly. The RPC has an empty
search path, denies anonymous execution, and checks the current role, event
assignment, request state and version under transaction locks. Locks follow role,
event, then request order. The event lock serializes duplicate checks and state
changes, preserving legacy rows without adding a conflicting uniqueness rule.
Every request update advances its version once. Existing event/venue queue branches
and equipment stock remain intact.

## Verification and review limits

Run `npm run ci` for build, inventory guards, application coverage and reviewer
checks; all four metrics must remain 100% in every application file. The repository
does not configure a linter. Run `npm run test:regression` for the browser journeys.
`supabase/tests/equipment_requirements.sql` adds 42 SQL sentinel contracts, and
`.github/scripts/test-equipment-requirements-concurrency.mjs` checks six races using
separate PostgreSQL sessions and observed lock waits. Both run in the database CI
job, independently of browser storage fixtures.

| Category | Concrete check |
| --- | --- |
| NORMAL | Coordinator/support handoff, saved fields, coordinator readback and unchanged stock |
| BOUNDARY | Exact quantity/text limits, zero shortfall versus missing data, phone layout |
| CONFLICT | Duplicate pending type, stale amendment, simultaneous updates, closing/reassigning events and revoking roles |
| FAILURE | Denied roles/assignment, invalid fields, provider errors, retained drafts and reload recovery |

SG2-53-P01/P02 exercise the production React build and real Express router at
1440px and 390px, with disposable identity/storage. Set `SG2_53_SCREENSHOTS` to a
directory outside the repository to capture both layouts. Browser verification
uses isolated Playwright Chromium and the in-app browser; the user's Chrome
session is untouched. Browser fixtures prove application interaction/readback;
the SQL suite separately proves database constraints, permissions and locking.

Local verification and automated source review do not supply independent teammate
sign-off, deployed Supabase workflow testing or current-head hosted CI evidence.
The PR records measured results and leaves any incomplete DoD gates pending.

### Local execution — 8 October 2026

The final `npm run ci` passed: **1,092 backend runner cases**, **994 frontend
runner cases**, both inventory runs and all **19 reviewer-tool tests**. Every
application file has **100% statements, branches, functions and lines**. Local
execution used Node 24.10.0; hosted CI checks Node 22. The log is
`/tmp/sg2-53-final-ci.log`.

The full isolated Chromium regression passed **62/62 journeys**. E2E TypeScript
compilation, all **13 report-gate tests** and the required SG2-26 report gate passed.
The final log/report and 1440px/390px screenshots are under
`/tmp/sg2-53-browser-final.log` and `/tmp/sg2-53-qa`. The in-app browser additionally
verified the coordinator-to-support handoff and support editor at both widths;
controls wrapped cleanly and saved values were visible.

Disposable native **PostgreSQL 17** passed the auth fixture, all **22 migrations**,
all **17 SQL suites** and **14 concurrency scenarios** across four scripts. A final
fresh-database run after the legacy-note compatibility adjustment passed all 42
SG2-53 SQL contracts and six SG2-53 races. Logs:
`/tmp/sg2-53-sql-validation.log` and `/tmp/sg2-53-sql-final-targeted.log`.
The test containers and volumes were removed after verification.

An initial browser selector matched both the existing request heading and new
requirement headings; it now checks the selected request's level-2 heading and
stored definition fields. One coverage run stalled in an existing venue test and
was stopped; the complete retry passed. A browser run overlapped that rebuild and
lost the generated page briefly; the final browser run began after the build and
passed without retries. These attempts are not counted as passing evidence.
