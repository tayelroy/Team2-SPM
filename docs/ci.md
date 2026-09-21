# Continuous integration

The CI workflow builds the frontend and backend, runs automated tests, checks
coverage, and tests database access policies. Pull requests show the result as
**Build and test**.

## Run locally

Use Node.js 22.22.2 or newer on the Node 22 LTS line. From the repository root:

```sh
npm ci
npm run ci
```

| Command | Checks |
| --- | --- |
| `npm run build` | TypeScript backend and React/Vite frontend builds. |
| `npm test` | Backend, frontend, and security reviewer tests. |
| `npm run test:coverage` | Tests and application coverage thresholds. |
| `npm run ci` | Builds followed by tests with coverage. |
| `npm run test:regression` | Builds then runs 18 Chromium journeys against real API routes with isolated in-memory providers. |
| `npm run ci:full` | Build, coverage, reviewer and Playwright checks; SQL remains a separate CI job. |

Tests mock Supabase responses and use temporary local HTTP sockets. They do not
need Supabase credentials or a running database.

## Workflow

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs when a pull request
opens, receives commits, reopens, or becomes ready for review; on merge queue
groups; on manual dispatch; and **after every pull request merge**. Closing a
pull request without merging skips the job.

After a merge, checkout uses the event's `merge_commit_sha`, so the regression
suite tests that exact revision even if the target branch has since advanced.
Each merge has its own concurrency group and cannot cancel another merge's run.
Newer pre-merge updates may cancel older checks for the same pull request.

The workflow exposes separate PR checks: **Build applications**, **Test backend**,
**Test frontend**, **Test browser regression**, **Test database policies**, and **Test security reviewer**.
They run independently, so a failed build or backend test does not suppress
frontend or database results. Application jobs use Node 22 and install locked
dependencies with `npm ci`; the reviewer uses only Node built-ins. Backend and
frontend matrix fail-fast is disabled.

The final **Build and test** check waits for every job and succeeds only when all
of them succeed. Failed, cancelled, or skipped dependencies fail this aggregate
check. Its established name is retained for existing required-check rules.

Build errors, failing tests, and coverage below the threshold fail the job.
Repository access is read-only, and application checks use no repository secrets.
The [AI Security Review workflow](../.github/workflows/ai-security-review.yml)
runs separately.

## Browser regression

The browser job installs locked dependencies and Chromium, builds both apps,
type-checks the harness and runs Playwright with one worker and no retries. A
test failure fails the existing required **Build and test** aggregate. PRs,
merge queues, manual runs and merged-PR events use the same full browser suite.

The fixture process serves the production React build and real Express routes
at `127.0.0.1:4173`. It substitutes only external identity and persistence
providers, resets state before every case, and has no shared Supabase access.
Its reset endpoint is defined only in `e2e/server.ts`, outside production.
Passing browser tests establish persistence across reloads within that fixture;
they do not establish deployed Auth, durable database storage or RLS.

The `browser-regression` artifact contains an HTML report, JSON/JUnit results,
and traces/screenshots/video for failures, retained for 14 days. Stable IDs in
test titles map to [the 27-case register](regression.md). Do not create a course
row for each low-level assertion or copy old Pass statuses into a new execution.

Vercel's existing build gate still runs `npm run ci`; Chromium is installed and
run by GitHub Actions, not Vercel. Requiring **Build and test** protects the merge,
but this change does not claim a new Vercel deployment gate or post-deploy smoke
test. Hosted execution of the modified workflow must be verified after push.

## Authorisation regression checks

Every pull request, subsequent commit update, and PR merge runs the backend
authorisation tests and frontend access-helper tests as part of the full
regression suite. The suite covers all committed automated application tests,
not just files changed by that pull request.

The **Test database policies** job starts a temporary PostgreSQL 17 service, loads the
[test identity schema](../supabase/tests/fixtures/auth.sql), applies the committed
migrations in filename order, and runs
[`supabase/tests/account_roles.sql`](../supabase/tests/account_roles.sql).
These checks cover role isolation, blocked role writes, role changes, and schema
constraints. SQL errors stop the step and fail **Build and test**.

The database is discarded after the job. It uses a test password and does not
connect to a deployed Supabase project. The identity fixture implements only the
Auth schema needed by these tests; it is not a production migration.

`npm run ci` runs the application checks locally. Database checks run as a
separate workflow step and can also be executed with the SQL test file against
a development database. Configure **Build and test** as a required status check
to prevent a failed application or database test from being merged.

## Coverage

Each application source file must reach 100% for lines, statements, functions,
and branches. Unimported source files count toward coverage.

| Application | Tool | Source files |
| --- | --- | --- |
| Backend | c8 | `server/src/**/*.ts` |
| Frontend | Vitest with V8 coverage | `client/src/**/*.{ts,tsx}` |

Tests and declaration files are excluded. CSS and build configuration are not
part of application coverage. Backend coverage uses a temporary, source-mapped
TypeScript build in `server/.coverage-build/`.

The settings live in [`server/.c8rc.json`](../server/.c8rc.json) and
[`client/vitest.config.ts`](../client/vitest.config.ts). Backend test commands
select `src/*.test.ts` and `src/db/*.test.ts`; update both the normal and compiled
coverage commands in `server/package.json` when adding another test directory.

Coverage measures execution, not the completeness of requirements or the
correctness of every possible input. Keep assertions tied to acceptance
criteria and observable results. See the [test audit and case design guide](testing.md)
for the course template, consolidation decisions, and measured results.

## Reports

Each application writes these files under its `coverage/` directory:

- `index.html`: browsable coverage report.
- `lcov.info`: LCOV data for editor or reporting tools.
- `coverage-summary.json`: machine-readable totals.

Each application job uploads **backend-coverage** or **frontend-coverage**.
The aggregate check downloads both, adds a coverage table to its summary, and
uploads the combined **application-coverage** artifact. Reports are retained for
14 days. Collection also runs after test failures when the run has not been
cancelled. Missing coverage summaries fail the summary step.

The [Google Sheet test register](https://docs.google.com/spreadsheets/d/1SPPWhdqrtvg7xQVbJaUia2ZbZDjwtciceW6-RgrzI8o/edit)
separates backend, frontend, and database/CI scenarios. Its current index maps
22 purposeful cases to their automation and evidence; individual helper tests
remain in their source suites and coverage reports. Spreadsheet results are
dated execution records; CI does not automatically overwrite them after a run.

The [14 September hosted verification](testing.md#hosted-verification-of-the-eight-pending-cases)
records the SQL, successful PR checks, overlapping merge runs, controlled
regression failure, artifact retention, recovery and unmerged-close behavior.

## Required checks

To block merges on a failing build or test, configure a ruleset or branch
protection rule for `main` that requires:

- A pull request before merging.
- The **Build and test** status check from GitHub Actions.

Apply the rule to the contributors it should cover and review bypass permissions.
Verify enforcement with a disposable pull request containing a failing test:
the check should fail and the merge box should report it as blocking. Restore
the test and confirm the check passes.

Committing this workflow does not configure repository rules. The workflow must
be pushed and merged to take effect; branch protection is a separate repository
setting. Post-merge failures flag a regression but cannot undo a merge. Vercel's
GitHub integration is separate; its repository build command now runs the
application regression gate described below. Neither gate automatically rolls
back an existing release.

See the [project README](../README.md) for environment configuration and deployment,
and the [authorisation guide](authorization.md) for database policy tests.


## Profile/logout regression and Vercel gate — 14 September 2026

The focused `npm run test:regression:sg2-42` command includes the server logout
and authorization suites as well as venue adapters/routes, catalogue and App
navigation. The existing CI globs already discover them; no duplicate job was
added. All four per-file coverage thresholds remain 100% with no new exclusions.

`server/vercel.json` now runs this command from Vercel's existing server root:

```sh
NODE_ENV=test SUPABASE_URL= SUPABASE_ANON_KEY= SUPABASE_SERVICE_ROLE_KEY= npm run ci --prefix ..
```

It builds the application, runs backend/frontend coverage and reviewer tests,
and exits unsuccessfully if any stage fails. The empty environment values apply
only to that build command; deployed runtime settings are unchanged. The server
build already builds/copies the client, so the duplicate root client build was
removed. Database policy tests remain in GitHub's isolated PostgreSQL job;
Vercel does not run Docker or touch hosted Supabase.

Validation of the exact Vercel command on Node 22 rejected a deliberate SDK-error
handling regression (exit 1), then passed after source restoration (exit 0):
179 backend + 152 frontend + 19 reviewer tests, all application source coverage
at 100%. The focused regression command passed 78 backend + 65 frontend tests.
Executing the actual aggregate script from `ci.yml` accepted all-success and
rejected all 12 single-dependency failure/cancelled/skipped combinations.

The latest inspected [PR #19 hosted run](https://github.com/tayelroy/Team2-SPM/actions/runs/34858630653)
passed all six jobs for `9c00a9081909`. It predates these uncommitted changes;
the new revision's hosted CI and Vercel deployment must still run after push.
Current branch-protection settings could not be reread through the connector
(403); earlier hosted required-check evidence is recorded in [testing.md](testing.md).


## Required SG2-26 cases

The browser regression command also validates its JSON results with
`.github/scripts/regression-gate.mjs`. Organisation sharing (`P01`), fresh
saved-data display (`P02`), organisation isolation (`N01`) and organiser-only
access (`N02`) must execute and pass. Skipping or removing one of these cases,
marking it as an expected failure, or accepting a failed attempt cannot produce
a successful regression command. This is inherited by the required **Build and
test** aggregate through **Test browser regression**. No layout checks are required.
The separate **Test database policies** job must also pass its organisation SQL
suite. Preview deployment readiness does not substitute for either check.
