# Test audit and course case design

## Latest review — 11 September 2026

Reviewed all 24 automated test files and both SQL policy test files on the
SG2-42 working branch. The local build passed, along with 155 backend, 132
frontend, 19 reviewer and 4 Playwright tests: **310 passed**. Backend and
frontend coverage remained 100% for statements, branches, functions and lines.
Evidence: Node 22.23.2, base `1cdab2a3f2bb`, reviewed source SHA256 prefix
`e1ece8b2b408`; these results describe the uncommitted working tree.

Consolidated three redundant cases: complete-draft submission readiness into
the creation workflow, the 5000/5001-character draft boundary into one case,
and the shared field placeholder into its existing field contract. Strengthened
attendance coverage to accept 1 and reject 0/fractions. Corrected overstated
test names, made configuration variants distinguishable, used independent
expected venue error messages, and ensured global mocks are cleaned up even
when an assertion fails. Login/registration code and tests were not changed in
this review; their existing regressions are not acceptance requirements for
the agreed seeded-account flow.

SG2-42 has four browser scenarios: staff create/edit/search with reload
persistence (positive), coordinator write rejection including direct/forged
requests (negative), capacity 1/2147483647 versus 0/fractions/overflow
(boundary), and venue names of 255 versus 256 characters (boundary). One
additional course scenario groups component/API recovery, duplicate-submit,
cancel and stale-request assertions. Browser tests use the isolated test
server/store and injected test identities; they do not establish live Supabase
or login integration. The workflow runs these through `npm run test:e2e`.

Both SQL policy files passed locally in PGlite 0.5.8/PostgreSQL 18.3 with the
auth fixture and migrations. The anonymous venue read assertion uses
`PERFORM` so a missing-result-destination error cannot masquerade as an access
denial. This is additional local evidence; hosted PostgreSQL 17 and live
Supabase remain unverified. The actual CI aggregate script accepted all-success
results and rejected browser failure, cancellation and skip; hosted CI and
branch protection scenarios remain Not Executed.

## Earlier review — 9 September 2026

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

| Suite | Before | After |
| --- | ---: | ---: |
| Backend | 102 | 100 |
| Frontend | 118 | 111 |
| Security reviewer tooling | 19 | 19 |
| Total automated tests | **239** | **230** |

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
contains 18 backend scenarios, 19 frontend scenarios, 12 database/CI scenarios,
and an index of all 310 executed automated tests as of 11 September 2026.
These occupy the existing category tabs; the template tab is unchanged.
The five SG2-25 identifiers
are retained. Frontend permission-helper tests link to the same SG2-25 cases
instead of duplicating that feature's specifications.

The course template fields are preserved. Specification and execution sections
use different colours; explicit status labels distinguish Pass from Not
Executed. Seven SQL scenarios passed locally in PGlite/PostgreSQL 18.3;
the three hosted workflow scenarios remain Not Executed. Application, browser,
SQL and reviewer results are dated local automation records,
not deployed acceptance or hosted CI results. The automation index maps
supporting UI/component checks to their workflow context without claiming each
one independently proves an acceptance criterion.

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

Each spreadsheet record should contain the course fields: unique Test Case ID,
scenario, preconditions (including fixture/reset), numbered test steps, specific
test data, and observable expected result. After execution, record the actual
result, status, and build/evidence in remarks. Author and execution metadata are
optional. Leave unexecuted results unfilled or explicitly Not Executed; do not
copy an earlier build's Pass result onto a newer build.

## What the results establish

The suite provides repeatable regression evidence for the committed TypeScript
and TSX code. Mock application screens exercise local UI behaviour; they do not
establish persisted business transactions. Supabase HTTP mocks and the isolated
SQL fixture do not replace a deployed Auth/browser integration test. CSS and
configuration are outside the application coverage metric; SQL policies have
their own assertions. Full measured coverage is not a claim that the product is
bug-free or that every requirement is implemented.

Run `npm run ci` with the documented Node 22 runtime. The GitHub Actions workflow
also runs database-policy tests before and after merges. See [CI configuration
and required checks](ci.md) for execution triggers, coverage reports and the
repository rule needed to block a failing pull request.
