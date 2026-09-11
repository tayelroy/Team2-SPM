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
| `npm run test:e2e` | Four SG2-42 Playwright scenarios in Chromium (run `npx playwright install chromium` once). |

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
**Test frontend**, **Test venue browser flows**, **Test database policies**, and **Test security reviewer**.
They run independently, so a failed build or backend test does not suppress
frontend or database results. Application jobs use Node 22 and install locked
dependencies with `npm ci`; the reviewer uses only Node built-ins. Backend and
frontend matrix fail-fast is disabled.

The browser job installs Chromium and its OS dependencies, runs `npm run test:e2e`,
and uploads **venue-playwright-report** (HTML plus failure screenshots/traces)
for 14 days. The [four venue cases](venues.md#playwright-acceptance-cases) cover
positive, negative and boundary scenarios using the real venue UI/API with
isolated test identity/storage. Login and deployed Supabase are outside this
fixture. Playwright starts/stops its local test server automatically.

The final **Build and test** check waits for every job and succeeds only when all
of them succeed. Failed, cancelled, or skipped dependencies fail this aggregate
check. Its established name is retained for existing required-check rules.

Build errors, failing tests, and coverage below the threshold fail the job.
Repository access is read-only, and application checks use no repository secrets.
The [AI Security Review workflow](../.github/workflows/ai-security-review.yml)
runs separately.

## Authorisation regression checks

Every pull request, subsequent commit update, and PR merge runs the backend
authorisation tests and frontend access-helper tests as part of the full
regression suite. The suite covers all committed automated application tests,
not just files changed by that pull request.

The **Test database policies** job starts a temporary PostgreSQL 17 service, loads the
[test identity schema](../supabase/tests/fixtures/auth.sql), applies the committed
migrations in filename order, and runs
[`supabase/tests/account_roles.sql`](../supabase/tests/account_roles.sql) and
[`supabase/tests/venues.sql`](../supabase/tests/venues.sql).
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
separates backend, frontend, and database/CI scenarios, with an index of all 230
automated tests. Spreadsheet results are dated execution records; CI does not
automatically overwrite them after a PR run.

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
deployment integration is configured separately; this workflow does not add a
deployment dependency or automatically roll back a release.

See the [project README](../README.md) for environment configuration and deployment,
and the [authorisation guide](authorization.md) for database policy tests.
