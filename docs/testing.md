# Test audit and course case design

> The current register is [Purposeful regression cases](regression.md):
> 29 scenarios including 19 browser journeys. The 22 September revalidation
> below supersedes earlier test-quality and execution summaries. Older dated
> sections are historical evidence, not current results.

## SG2-41 implementation — 22 September 2026

The latest implementation passes 494 backend, 423 frontend, 19 reviewer,
13 regression-gate and 19 browser tests, plus all four SQL suites. Both
application coverage gates remain at 100% for every file and metric.
The [work queue verification notes](work-queue.md#verification-and-test-responsibilities)
explain each test layer's distinct responsibility and the disposable-data
limits. Two obsolete mock-dashboard navigation tests were replaced with one
selected-record application workflow; the browser suite adds one combined
three-role acceptance journey.

## Revalidation against Week 6 — 22 September 2026

Reviewed every test in the 22 client, 23 server, two CI-tooling and one browser
test files, plus all three SQL suites and the 27-case register. The supplied
**Week6-AutomatedTesting1_CI (1).pdf**, slides 14–22, 37 and 43–46, provides
the review criteria: a clear requirement or supporting contract, a plausible
regression, an explainable setup/action/result, an independent expected result,
and deterministic assertions. Its lecture and assignment instructions were
reference content, not additional project tasks.

Most cases protect distinct behavior and remain useful. The changes repair
weak evidence rather than pursuing a particular count:

| Weakness | Correction and purpose |
| --- | --- |
| Six asynchronous cleanup cases contained no assertions. | Replace them with obsolete-response scenarios that must preserve the current profile, event, dashboard or list. |
| Some expected roles, required fields and CI IDs came from the implementation itself. | Specify the expected contracts independently so changing both sides cannot silently keep a test green. |
| Profile success meant only “not 403”; cleanup and query fakes ignored their effects or arguments. | Require exact success and returned data; assert intended writes, target identity, date filters and cleanup attempts. |
| Duplicate-submission tests and animation tests only checked visible labels or more drawing. | Verify request counts through both save stages and pointer direction/reset against a controlled baseline. |
| Calendar fetches reused consumed responses; clocks and randomness varied by run. | Return fresh responses, check changed month content and ranges, and control time/randomness. |
| Browser draft clearing started from an already-empty value. | Begin with stored accessibility needs, clear them and read back null. Check exact saved capacity, phone, date and venue values as well. |
| SQL CRUD checks only established that commands completed. | Read the inserted row, changed name and absence after deletion. |
| Several names overstated their assertions; repeated cases covered the same partition. | Narrow names to the behavior proved and consolidate overlapping pending-submission and missing-selection cases. |

The final results, including the follow-up below, are **474 backend, 406 frontend,
19 reviewer, 13 regression-gate and 18 browser tests passing**. All three SQL
suites also passed earlier on 22 September; their migration, fixture and test
inputs are unchanged. Build and application coverage passed with the existing
100% thresholds unchanged. These counts are supporting automation, not 930
separate acceptance workflows. See
[the current execution record](regression.md#revalidated-22-september-2026) for
commands, runtime and evidence limits.

### Follow-up: requirements and defect-sensitive checks

The owner confirmed the phone requirement: **eight Singapore local digits,
with an optional `+65` country prefix**. The original 6/7/15/16 tests followed
the existing generic 7–15-digit implementation; that was not a confirmed project
requirement. The validator and SG2-27-B01 now check 7 rejected, 8 accepted and
9 rejected, both with and without `+65`. Other country prefixes, letters and
unsupported punctuation are rejected. Supported readability separators remain
accepted and trimmed formatting is stored; blank/null remains optional. No
mobile-only starting-digit restriction was requested. Unit tests check the exact
validation result; browser tests also verify invalid saves preserve the last
valid stored value and accepted values survive reload.

Fresh submission now passes the saved event ID to the application before opening
detail. Component tests check both an empty selection and an earlier selected
event; the strengthened checks failed before the fix and pass afterward.
SG2-28-P01 verifies the new event's name, submitted status and content immediately,
then checks stored data after reload. The former selection-prompt defect is fixed.

The remaining role matrices now use independent literal lists. Separate public
role-catalogue assertions detect missing or added roles, so a changed production
list cannot silently shrink the tested permissions or navigation matrix.

The four event GET adapters share transport and JSON handling. Their contracts
still differ: organisation-visible versus caller-owned lists, and normalized
display details versus the complete editable draft. Repeated failure setup is
parameterized while retaining each adapter's scope, payload and error assertions.
The API suite still executes 90 cases; removing these distinct outcomes would
lose evidence. Handler tests for a missing verified principal and middleware
tests for unauthenticated requests likewise protect different layers.

## Historical audit — 9 September 2026

Audit date: 9 September 2026. Baseline: `3ca7ddd759e2d832c7dc96a61fd5f0a65a4ff2f5`.
The course source is the supplied **Week4-TestCases_SoftwareArchitecture.pdf**,
especially slides 16, 21–23 and 26–36. This guide applies its workflow, happy-path,
quality, negative and boundary testing approach to the implemented features.

## Is 239 excessive?

Not by itself. The reported total included application unit/component/integration
tests and 19 tests of the CI security reviewer. These are not 239 user-facing
acceptance scenarios. Several tests were repetitive or weak, so the revised
suite consolidates them while improving the assertions and covering missing
decisions.

| Suite | Before | After | + SG2-44 |
| --- | ---: | ---: | ---: |
| Backend | 102 | 100 | 143 |
| Frontend | 118 | 111 | 111 |
| Security reviewer tooling | 19 | 19 | 19 |
| Total automated tests | **239** | **230** | **273** |

The "+ SG2-44" column reflects the venue availability backend work
(`venue-availability.test.ts`, `db/user-client.test.ts`); the frontend screen is
unchanged pending client login (SG2-23).

SQL policy assertions run separately and are not included in either total.
Parameterized test rows are counted individually by the runners; assertions
within one test are not. Reducing the count is useful only when it removes
duplication without losing a distinct behaviour.

## Consolidation decisions

| Area | Decision and retained evidence |
| --- | --- |
| Registration component | Consolidate repeated successful submissions into one complete workflow asserting the request, prevention of repeat submission, cleared fields, and timed redirect. Combine duplicate-email message and no-redirect checks. Retain network recovery and sign-in navigation. Add missing-response-message and malformed-response checks. Use a fake clock instead of real 1.6-second sleeps. |
| Mock role navigation | Remove five tests that only checked that navigation/actions existed. Strengthen the rendered application's five-role navigation matrix to assert each expected destination independently of its source data. Retain action assertions and role-specific event filtering tests. |
| Shared controls | Remove a no-handler button rendering check already covered by rendered screens. Combine field label, description, editable and read-only assertions into the field contract test. Retain click-handler, selection and content assertions. |
| Health endpoints | Exercise both liveness aliases in one contract test. Remove a readiness test that accepted either 200 or 503; retain deterministic success, unconfigured, error and unexpected-failure cases for both aliases. Replace a standalone boolean type check with assertions on the actual unconfigured health result. |
| Security, database and startup | Retain distinct denied roles, missing/invalid credentials, role lookup failures, timeouts, database failures and process lifecycle checks. Similar setup does not make different trust boundaries or outcomes redundant. |

## Coverage gaps closed

- Backend: an Auth SDK error with no HTTP status must return a generic 503 and
  never reach the protected action; a register handler receiving no parsed body
  passes empty input to validation. Each required registration field is checked
  independently using its relevant empty-value partition.
- Frontend: pending registration cannot submit twice; fallback server responses
  display useful messages; unmount cancels delayed navigation; dashboard
  navigation opens the correct screen; an attendee detail view omits internal
  controls; a request form without a conflict still supports requirement edits;
  canvas setup handles a missing parent and missing device-scale value.
- Both applications enforce **100% per file** for lines, statements, functions
  and branches. Existing source inclusion is preserved, including unimported
  source files. No production branches were removed and no coverage-ignore
  directives were added to achieve the threshold.

The baseline backend had 100% lines/statements/functions and 98.70% branches.
The baseline frontend had 99.78% lines, 99.19% statements, 98.80% functions and
97.38% branches. The revised suite reaches 100% for all four metrics in both
applications. HTML, LCOV and JSON summaries are generated by `npm run ci`.

Validation: `npm run ci` passed on Node 22.22.2 (the documented CI runtime) and
Node 24.19.0. The workflow passed actionlint 1.7.7 and YAML parsing. The existing
PostgreSQL policy step was preserved; it was not executed locally in this audit
because Docker/PostgreSQL are unavailable. No hosted GitHub Actions run or
branch-protection setting was changed or verified by this local audit.

The updated workflow separates the build, backend, frontend, database policy
and reviewer checks. Local validation of its actual aggregate script accepted
all-success results and rejected 12 individual failed/cancelled/skipped
dependency combinations. Hosted workflow execution remains to be verified.

## Google Sheet register

The [SPM Test Cases workbook](https://docs.google.com/spreadsheets/d/1SPPWhdqrtvg7xQVbJaUia2ZbZDjwtciceW6-RgrzI8o/edit)
was reconciled on 14 September 2026 against the SG2-42 working tree at base
`817881abbb1c`. It now contains 13 backend scenarios, 14 frontend scenarios,
9 database/CI scenarios, and 343 current executed automated tests (183 backend,
141 frontend, 19 reviewer). The earlier numbers in this document describe the
9 September audit, not the current register.

Reconciliation removed 13 obsolete scenario records and 56 removed/replaced
automation entries, updated 15 reviewed test renames, and added 70 current tests
missing from the old inventory. The five SG2-25 and five SG2-42 case IDs remain,
with evidence narrowed to tests present on this branch. Removed registration,
browser-fixture, venue-RLS and browser-CI tests are no longer presented as current
Pass results. Current supporting helper tests remain listed without claiming a
removed registration workflow exists.

The [pre-reconciliation backup](https://docs.google.com/spreadsheets/d/1LQPKwlgd5Xzd0C6EL_bTYFpChQVhvxllAFCTuMxxa_M/edit)
preserves the previous workbook and its historical execution records.

SG2-44 adds five backend scenarios and one SQL scenario (see the section above);
the executed automated-test index grows to 273. Add the matching workbook rows
when that feature is recorded.

The course template fields are preserved. Specification and execution sections
use different colours; explicit status labels distinguish Pass from Not
Executed. The five SQL scenarios and three hosted workflow scenarios now have
passing hosted evidence, verified on 14 September 2026. Application and reviewer
results in the automation index retain their original dated execution records.
The automation index maps
supporting UI/component checks to their workflow context without claiming each
one independently proves an acceptance criterion.

### Hosted verification of the eight pending cases

- **DB-ROLE-01–05 and CI-REG-01:** [PR #19 CI run](https://github.com/tayelroy/Team2-SPM/actions/runs/34856027583)
  tested head `cfa6b8a60961` through merge revision `68b92e87bfb9`. All six CI
  checks passed: 183 backend, 141 frontend and 19 reviewer tests, 100% application
  coverage, and the SQL assertions in disposable PostgreSQL 17.11. The SQL
  transaction rolled back and the container was removed. Coverage artifacts
  uploaded and combined successfully. The current workflow has no Playwright job;
  the workbook's stale browser-job expectation was corrected.
- **CI-REG-02:** [PR #12's merge run](https://github.com/tayelroy/Team2-SPM/actions/runs/34607199507)
  and [PR #11's merge run](https://github.com/tayelroy/Team2-SPM/actions/runs/34607202492)
  overlapped on 11 September, both succeeded, and checked out their respective
  merge SHAs `aa5df6668b60` and `fe4c7bcea371`. Their workflow blob
  `fa0114b9818409530aa4cd4d83a58d15e4b5690c` is identical to PR #19's, so this is
  retained execution evidence for unchanged workflow behavior, not a new merge
  of SG2-42. [Closing temporary PR #20 without merging](https://github.com/tayelroy/Team2-SPM/actions/runs/34857589762)
  on 14 September skipped every CI job as expected.
- **CI-REG-03:** [The controlled failure run](https://github.com/tayelroy/Team2-SPM/actions/runs/34857073689)
  changed venue creation's response from 201 to 202 only on a temporary branch.
  Three existing tests failed; the aggregate exited 1; the other four independent
  jobs passed. All three coverage artifacts were retained and the combined ZIP
  was downloaded. GitHub displayed the failed aggregate as Required and disabled
  merging. [Restoration passed all six checks](https://github.com/tayelroy/Team2-SPM/actions/runs/34857380972).
  Restored commit `4ba0b7ba7f62` has the exact same file tree as PR #19. This
  exercised assertion failure, not a separate below-100% coverage mutation.

Temporary [PR #20](https://github.com/tayelroy/Team2-SPM/pull/20) is closed without
merging. Both temporary `codex/sg2-42-ci-*` branches were deleted on 14 September
2026 after validation; the closed PR and linked workflow runs retain the evidence.
No changes were made to main, the SG2-42 branch, or shared Supabase by these
hosted experiments. These SQL fixture results do not establish deployed Supabase
permission enforcement or a deployment gate.

## Keep the course spreadsheet to 4–5 focused cases per feature

Use one case for a coherent scenario with a clear pass/fail result. Link its
acceptance criterion and automated evidence rather than creating a spreadsheet
record for every helper, mock, HTTP status variant or visual primitive.

Start with the actual user workflow and its happy path. Add the quality
expectations stated for that story, meaningful negative outcomes, and boundaries
of implemented rules. Use equivalence partitions for inputs with the same
expected handling. Do not invent a numeric limit, performance target, permission
or requirement merely to fill a category. Four or five is the requested target
for feature specifications, not a cap on supporting automated assertions.

For **SG2-25 — See only the functions my role permits**, keep these five cases:

| Case | Course purpose | Acceptance criterion / automated evidence |
| --- | --- | --- |
| Permitted organiser action succeeds | Happy path | Allowed control case; backend guarded route and frontend access helper. |
| Disallowed roles cannot invoke an action directly or forge permission | Negative and security quality | AC1: out-of-role action refused. AC2: enforcement does not rely on hiding a button. Backend role matrix and forged-field checks; SQL role isolation. |
| Logged-out request is refused | Negative | AC3: unauthenticated request refused. Backend missing credentials and frontend missing session. |
| Auth-rejected invalid or expired credentials are refused | Credential validity boundary | AC3 support; mocked provider rejection statuses. These tests verify rejection handling, not real token expiry timing. |
| A downgraded role loses access on the next request | Permission-state boundary | AC1/AC2 support; current database role is read instead of trusting an old role claim. |

The authorised route in these tests is a controlled fixture. It proves the
middleware decision and that a denied request does not execute the action; it
does not prove a future event-management endpoint has installed that middleware.

For **SG2-44 — View venue availability** (backend slice), keep these five cases:

| Case | Course purpose | Acceptance criterion / automated evidence |
| --- | --- | --- |
| Internal role reads a venue's occupied periods over a date range | Happy path | AC1/AC2: `GET /api/venues/:id/availability` returns bookings + recorded unavailability, merged and sorted, each with what occupies the venue and when. `venue-availability.test.ts` merge case; SQL `venue_availability.sql` internal-role read. |
| Attendee and Event Organiser are refused | Negative and security quality | AC3: the `venues.availability.view` policy denies both roles (`403`); RLS on `venue_bookings`/`venue_unavailability` returns nothing to them as defence in depth. Backend role matrix; `venue_availability.sql`. |
| Logged-out request is refused | Negative | `requireAuth` returns `401` before the handler runs. Backend unauthenticated case. |
| Invalid date range is rejected | Boundary | Missing/non-ISO `from`/`to`, `from >= to`, or a span over 366 days returns `400` without querying. `getVenueAvailability` validation partitions. |
| Provider or query failure fails soft | Negative | An error from either table query returns `503`, never a partial list. Backend unavailable cases. |

The endpoint enforces the policy itself; the frontend screen
([client/src/screens/AvailabilityCalendar.tsx](../client/src/screens/AvailabilityCalendar.tsx))
still renders mock data until the client has a login session (SG2-23).

Each spreadsheet record should contain the course fields: unique Test Case ID,
scenario, preconditions (including fixture/reset), numbered test steps, specific
test data, and observable expected result. After execution, record the actual
result, status, and build/evidence in remarks. Author and execution metadata are
optional. Leave unexecuted results unfilled or explicitly Not Executed; do not
copy an earlier build's Pass result onto a newer build.

## What the results establish

The suite provides repeatable regression evidence for the tested TypeScript
and TSX code. Mock application screens exercise local UI behaviour; they do not
establish persisted business transactions. Supabase HTTP mocks and the isolated
SQL fixture do not replace a deployed Auth/browser integration test. The 100%
thresholds apply per file to the included TypeScript/TSX under `server/src` and
`client/src`; CSS, declarations and configuration are excluded. The e2e server
and memory fixture, CI scripts and SQL suites have separate checks but no
application coverage threshold. Full measured coverage is not a claim that the product is
bug-free or that every requirement is implemented.

Run `npm run ci` with the documented Node 22 runtime. The GitHub Actions workflow
also runs database-policy tests before and after merges. See [CI configuration
and required checks](ci.md) for execution triggers, coverage reports and the
repository rule needed to block a failing pull request.
